"""Drinking bottles, the cellar journal, and the ready-to-drink list.

Bottle counts change in the same batch as the journal entry. The column has
CHECK (itemQuantity >= 0), so taking out more bottles than exist makes the
whole batch fail and roll back: no journal entry, no count change, and a 409.
"""

from flask import Blueprint, jsonify, request

from .. import db
from ..access import require_consumption, require_item, require_member
from ..auth import current_user, login_required
from ..errors import Conflict
from ..services import drink_window
from ..util import json_body, now_iso
from ..validation import Field, int_range, past_timestamp, quantity, query_param, rating, text, validate
from .items import get_item_json, item_json, load_items

bp = Blueprint("consumption", __name__)

CONSUME_SPEC = {
    "quantity": Field(quantity(1), required=True),
    "notes": Field(text(0, 2000, "Notes", multiline=True)),
    "rating": Field(rating),
    "consumedAt": Field(past_timestamp),
}

CONSUME_PATCH_SPEC = {
    "quantity": Field(quantity(1), nullable=False),
    "notes": Field(text(0, 2000, "Notes", multiline=True)),
    "rating": Field(rating),
    "consumedAt": Field(past_timestamp, nullable=False),
}

NOT_ENOUGH = "There aren't that many bottles left. Nothing was changed."

JOURNAL_SELECT = (
    "SELECT c.*, i.collectionId, i.wineID, w.wineName, w.wineVint, w.wineType, w.wineProducer, "
    "  u.userFname, u.userLname "
    "FROM consumption c JOIN inventory_item i ON i.itemID = c.itemID JOIN wine w ON w.wineID = i.wineID "
    "LEFT JOIN user u ON u.userID = c.consumedByUserID "
)


def consumption_json(row):
    return {
        "consumeID": row["consumeID"],
        "itemID": row["itemID"],
        "collectionId": row["collectionId"],
        "wineID": row["wineID"],
        "wineName": row["wineName"],
        "wineProducer": row["wineProducer"],
        "wineVint": row["wineVint"],
        "wineType": row["wineType"],
        "consumeTime": row["consumeTime"],
        "consumeQuantity": row["consumeQuantity"],
        "consumeNotes": row["consumeNotes"],
        "consumeRating": row["consumeRating"],
        "consumedByUserID": row["consumedByUserID"],
        "consumedByName": f"{row['userFname']} {row['userLname']}" if row.get("userFname") else None,
    }


def _get_consumption_json(consume_id):
    return consumption_json(db.query_one(JOURNAL_SELECT + "WHERE c.consumeID = ?", [consume_id]))


def _is_quantity_check(err):
    return "itemQuantity" in str(err) or "CHECK constraint failed" in str(err)


@bp.post("/items/<int:item_id>/consume")
@login_required
def consume(item_id):
    require_item(item_id)
    data = validate(json_body(), CONSUME_SPEC)
    try:
        results = db.batch([
            (
                "INSERT INTO consumption (itemID, consumeTime, consumeQuantity, consumeNotes, consumeRating, consumedByUserID) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                [item_id, data.get("consumedAt") or now_iso(), data["quantity"], data.get("notes"),
                 data.get("rating"), current_user()["userID"]],
            ),
            ("UPDATE inventory_item SET itemQuantity = itemQuantity - ? WHERE itemID = ?", [data["quantity"], item_id]),
        ])
    except db.IntegrityError as err:
        if _is_quantity_check(err):
            raise Conflict(NOT_ENOUGH, code="not_enough_bottles") from None
        raise
    return jsonify({
        "consumption": _get_consumption_json(results[0].last_row_id),
        "item": get_item_json(item_id),
    }), 201


@bp.get("/collections/<int:collection_id>/consumptions")
@login_required
def journal(collection_id):
    require_member(collection_id)
    rows = db.query(JOURNAL_SELECT + "WHERE i.collectionId = ? ORDER BY c.consumeTime DESC, c.consumeID DESC",
                    [collection_id])
    return jsonify({"consumptions": [consumption_json(r) for r in rows]})


@bp.patch("/consumptions/<int:consume_id>")
@login_required
def update_consumption(consume_id):
    entry = require_consumption(consume_id)
    data = validate(json_body(), CONSUME_PATCH_SPEC, partial=True)
    statements = []
    if "quantity" in data:
        # Adjust the bottle count by the difference, using the stored quantity
        # inside the batch so two edits at once can't both use a stale value.
        statements.append((
            "UPDATE inventory_item SET itemQuantity = itemQuantity "
            "+ (SELECT consumeQuantity FROM consumption WHERE consumeID = ?) - ? WHERE itemID = ?",
            [consume_id, data["quantity"], entry["itemID"]],
        ))
    columns = {"quantity": "consumeQuantity", "notes": "consumeNotes", "rating": "consumeRating", "consumedAt": "consumeTime"}
    sent = [k for k in columns if k in data]
    if sent:
        statements.append((
            f"UPDATE consumption SET {', '.join(columns[k] + ' = ?' for k in sent)} WHERE consumeID = ?",
            [data[k] for k in sent] + [consume_id],
        ))
    try:
        db.batch(statements)
    except db.IntegrityError as err:
        if _is_quantity_check(err):
            raise Conflict(NOT_ENOUGH, code="not_enough_bottles") from None
        raise
    return jsonify({"consumption": _get_consumption_json(consume_id), "item": get_item_json(entry["itemID"])})


@bp.delete("/consumptions/<int:consume_id>")
@login_required
def delete_consumption(consume_id):
    entry = require_consumption(consume_id)
    # Put the bottles back, then remove the entry, in one batch.
    db.batch([
        ("UPDATE inventory_item SET itemQuantity = itemQuantity + (SELECT consumeQuantity FROM consumption WHERE consumeID = ?) "
         "WHERE itemID = ?", [consume_id, entry["itemID"]]),
        ("DELETE FROM consumption WHERE consumeID = ?", [consume_id]),
    ])
    return jsonify({"deleted": True, "item": get_item_json(entry["itemID"])})


@bp.get("/collections/<int:collection_id>/ready")
@login_required
def ready_list(collection_id):
    require_member(collection_id)
    soon_days = query_param(request.args, "soonDays", int_range(0, 3650, "soonDays"), drink_window.DEFAULT_SOON_DAYS)
    groups = ready_groups(collection_id, soon_days)
    return jsonify({"soonDays": soon_days, **groups})


def ready_groups(collection_id, soon_days):
    """Bottles grouped by urgency. Within each group, the nearest drink-by
    date comes first (for pastPeak, the longest past its peak)."""
    rows, pairings = load_items("i.collectionId = ? AND i.itemQuantity > 0", [collection_id])
    groups = {"drinkSoon": [], "ready": [], "pastPeak": []}
    for row in rows:
        item = item_json(row, pairings[row["wineID"]], soon_days=soon_days)
        if item["drinkStatus"] in groups:
            groups[item["drinkStatus"]].append(item)
    for items in groups.values():
        items.sort(key=lambda i: (i["itemDrinkBy"] is None, i["itemDrinkBy"] or "", i["wine"]["wineName"]))
    return groups
