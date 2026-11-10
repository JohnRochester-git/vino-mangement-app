"""Collection value, value history, stats, and pairing suggestions."""

from collections import defaultdict

from flask import Blueprint, jsonify, request

from .. import db
from ..access import require_item, require_member
from ..auth import login_required
from ..errors import ValidationError
from ..util import iso_ago, json_body, money_fields, now_iso
from ..validation import Field, money, validate
from .consumption import ready_groups
from .items import get_item_json, item_json, load_items

bp = Blueprint("insights", __name__)

VALUE_SPEC = {"itemValue": Field(money)}


def _active_items(collection_id):
    rows, pairings = load_items("i.collectionId = ? AND i.itemQuantity > 0", [collection_id])
    return [item_json(r, pairings[r["wineID"]]) for r in rows]


@bp.get("/collections/<int:collection_id>/value")
@login_required
def collection_value(collection_id):
    require_member(collection_id)
    items = _active_items(collection_id)

    total = cost = gain_cost = gain_value = 0
    bottles = valued_bottles = 0
    by_type = defaultdict(lambda: {"bottles": 0, "valueCents": 0, "notValuedBottles": 0})
    for item in items:
        qty, per_bottle, paid = item["itemQuantity"], item["currentValueCents"], item["itemPurchasePriceCents"]
        bottles += qty
        bucket = by_type[item["wine"]["wineType"]]
        bucket["bottles"] += qty
        if per_bottle is None:
            bucket["notValuedBottles"] += qty
        else:
            valued_bottles += qty
            total += per_bottle * qty
            bucket["valueCents"] += per_bottle * qty
        if paid is not None:
            cost += paid * qty
            if per_bottle is not None:
                gain_cost += paid * qty
                gain_value += per_bottle * qty

    top = sorted((i for i in items if i["currentValueCents"] is not None),
                 key=lambda i: i["currentValueCents"], reverse=True)[:5]
    return jsonify({
        "collectionId": collection_id,
        "bottleCount": bottles,
        "valuedBottleCount": valued_bottles,
        "notValuedBottleCount": bottles - valued_bottles,
        **money_fields("totalValue", total),
        **money_fields("totalPurchaseCost", cost),
        # Gain/loss only counts bottles with both a purchase price and a value.
        **money_fields("gainLoss", gain_value - gain_cost),
        **money_fields("gainLossCostBasis", gain_cost),
        "byType": [
            {"wineType": t, "bottles": v["bottles"], "notValuedBottles": v["notValuedBottles"],
             **money_fields("value", v["valueCents"])}
            for t, v in sorted(by_type.items(), key=lambda kv: -kv[1]["valueCents"])
        ],
        "topBottles": top,
    })


def _history_json(row):
    return {
        "valueID": row["valueID"],
        "level": "item" if row["itemID"] else "catalog",
        **money_fields("value", row["valueCents"]),
        "valueSource": row["valueSource"],
        "valueRecordedAt": row["valueRecordedAt"],
    }


@bp.get("/items/<int:item_id>/value-history")
@login_required
def value_history(item_id):
    item = require_item(item_id)
    # Catalog-level rows for the wine, plus this item's own rows only, so one
    # household never sees another's private estimates.
    rows = db.query(
        "SELECT * FROM value_history WHERE wineID = ? AND (itemID IS NULL OR itemID = ?) "
        "ORDER BY valueRecordedAt, valueID",
        [item["wineID"], item_id],
    )
    return jsonify({"itemID": item_id, "wineID": item["wineID"], "history": [_history_json(r) for r in rows]})


@bp.post("/items/<int:item_id>/value")
@login_required
def set_item_value(item_id):
    item = require_item(item_id)
    data = validate(json_body(), VALUE_SPEC)
    if "itemValue" not in data:
        raise ValidationError({"itemValue": "This field is required. Send null to go back to the catalog value."})
    statements = [("UPDATE inventory_item SET itemValue = ? WHERE itemID = ?", [data["itemValue"], item_id])]
    if data["itemValue"] is not None:
        statements.append((
            "INSERT INTO value_history (wineID, itemID, valueCents, valueSource, valueRecordedAt) VALUES (?, ?, ?, 'user', ?)",
            [item["wineID"], item_id, data["itemValue"], now_iso()],
        ))
    db.batch(statements)
    return jsonify(get_item_json(item_id))


@bp.get("/collections/<int:collection_id>/stats")
@login_required
def stats(collection_id):
    require_member(collection_id)
    items = _active_items(collection_id)

    def count_by(key):
        counts = defaultdict(lambda: {"bottles": 0, "items": 0})
        for item in items:
            counts[key(item)]["bottles"] += item["itemQuantity"]
            counts[key(item)]["items"] += 1
        return [{"label": k, **v} for k, v in sorted(counts.items(), key=lambda kv: (-kv[1]["bottles"], str(kv[0])))]

    def decade(item):
        vint = item["wine"]["wineVint"]
        return f"{vint // 10 * 10}s" if vint else "Non-vintage"

    since = iso_ago(days=30)
    added = db.query_one(
        "SELECT coalesce(sum(i.itemQuantity + coalesce((SELECT sum(c.consumeQuantity) FROM consumption c "
        "WHERE c.itemID = i.itemID), 0)), 0) AS n FROM inventory_item i WHERE i.collectionId = ? AND i.itemCreatedAt >= ?",
        [collection_id, since],
    )["n"]
    opened = db.query_one(
        "SELECT coalesce(sum(c.consumeQuantity), 0) AS n FROM consumption c JOIN inventory_item i ON i.itemID = c.itemID "
        "WHERE i.collectionId = ? AND c.consumeTime >= ?",
        [collection_id, since],
    )["n"]
    ratings = db.query_one(
        "SELECT avg(c.consumeRating) AS avg, count(c.consumeRating) AS n FROM consumption c "
        "JOIN inventory_item i ON i.itemID = c.itemID WHERE i.collectionId = ?",
        [collection_id],
    )
    return jsonify({
        "collectionId": collection_id,
        "bottleCount": sum(i["itemQuantity"] for i in items),
        "itemCount": len(items),
        "byType": count_by(lambda i: i["wine"]["wineType"]),
        "byRegion": count_by(lambda i: i["wine"]["wineRegion"] or "Unknown"),
        "byVintageDecade": count_by(decade),
        "byStorageLocation": count_by(lambda i: i["itemStoredAt"] or "Not set"),
        "bottlesAddedLast30Days": added,
        "bottlesOpenedLast30Days": opened,
        "averageRating": round(ratings["avg"], 2) if ratings["avg"] is not None else None,
        "ratingCount": ratings["n"],
    })


@bp.get("/collections/<int:collection_id>/suggest")
@login_required
def suggest(collection_id):
    require_member(collection_id)
    name = (request.args.get("pairing") or "").strip()
    pairing = db.query_one("SELECT pairingName FROM pairings WHERE lower(pairingName) = lower(?)", [name[:60]])
    if pairing is None:
        raise ValidationError({"pairing": "Choose a pairing from GET /api/v1/pairings."})
    groups = ready_groups(collection_id, 180)
    matches = [i for i in groups["drinkSoon"] + groups["ready"] if pairing["pairingName"] in i["wine"]["pairings"]]
    return jsonify({"pairing": pairing["pairingName"], "items": matches})
