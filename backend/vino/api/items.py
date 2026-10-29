"""Inventory items: the bottles of one wine held in one collection."""

from flask import Blueprint, jsonify, request

from .. import db
from ..access import require_item, require_member
from ..auth import current_user, login_required
from ..errors import NotFound, ValidationError
from ..services import drink_window
from ..services.valuation import current_value, gain_loss
from ..util import json_body, money_fields, now_iso, today
from ..validation import (
    Field, FieldError, check, check_window, int_range, iso_date, money, past_date, positive_id,
    quantity, query_param, text, validate, wine_type,
)
from .wines import WINE_SPEC, create_wine, pairings_for, wine_json

bp = Blueprint("items", __name__)

DRINK_STATUSES = ("notSet", "tooYoung", "ready", "drinkSoon", "pastPeak")
SORTS = ("name", "vintage", "value", "drinkBy", "acquired")


def nested_wine(value):
    if not isinstance(value, dict):
        raise FieldError("Must be an object with the new wine's details.")
    return value


ITEM_CREATE_SPEC = {
    "wineId": Field(positive_id),
    "wine": Field(nested_wine),
    "itemQuantity": Field(quantity(1), required=True),
    "itemAquiredDate": Field(past_date),
    "itemPurchasePrice": Field(money),
    "itemStoredAt": Field(text(0, 120, "Storage location")),
    "itemDrinkFrom": Field(iso_date),
    "itemDrinkBy": Field(iso_date),
}

ITEM_PATCH_SPEC = {
    "itemQuantity": Field(quantity(0), nullable=False),
    "itemAquiredDate": Field(past_date),
    "itemPurchasePrice": Field(money),
    "itemStoredAt": Field(text(0, 120, "Storage location")),
    "itemDrinkFrom": Field(iso_date),
    "itemDrinkBy": Field(iso_date),
}

ITEM_SELECT = (
    "SELECT i.*, w.wineName, w.wineProducer, w.wineRegion, w.wineType, w.wineVint, w.wineDescription, "
    "  w.wineProfile, w.wineValue, w.blendID, w.wineBarcode, w.wineImageKey, w.wineCreatedAt, "
    "  w.wineCreatedByUserID, b.blendStyle "
    "FROM inventory_item i JOIN wine w ON w.wineID = i.wineID LEFT JOIN blends b ON b.blendID = w.blendID "
)


def item_json(row, pairings=None, on=None, soon_days=drink_window.DEFAULT_SOON_DAYS):
    on = on or today()
    per_bottle, source = current_value(row["itemValue"], row["wineValue"])
    qty = row["itemQuantity"]
    per_bottle_gain = gain_loss(per_bottle, row["itemPurchasePrice"], 1)
    return {
        "itemID": row["itemID"],
        "collectionId": row["collectionId"],
        "wineID": row["wineID"],
        "itemQuantity": qty,
        "isLastBottle": qty == 1,
        "itemStoredAt": row["itemStoredAt"],
        "itemAquiredDate": row["itemAquiredDate"],
        "itemDrinkFrom": row["itemDrinkFrom"],
        "itemDrinkBy": row["itemDrinkBy"],
        "itemDrinkWindowSource": row["itemDrinkWindowSource"],
        "drinkStatus": drink_window.drink_status(row["itemDrinkFrom"], row["itemDrinkBy"], on, soon_days),
        **money_fields("itemPurchasePrice", row["itemPurchasePrice"]),
        **money_fields("itemValue", row["itemValue"]),
        **money_fields("currentValue", per_bottle),
        "currentValueSource": source,
        **money_fields("totalValue", per_bottle * qty if per_bottle is not None else None),
        **money_fields("gainLossPerBottle", per_bottle_gain),
        **money_fields("gainLoss", per_bottle_gain * qty if per_bottle_gain is not None else None),
        "itemCreatedAt": row["itemCreatedAt"],
        "wine": wine_json(row, pairings),
    }


def load_items(where, params, order="i.itemID"):
    rows = db.query(ITEM_SELECT + "WHERE " + where + " ORDER BY " + order, params)
    return rows, pairings_for(r["wineID"] for r in rows)


def get_item_json(item_id):
    rows, pairings = load_items("i.itemID = ?", [item_id])
    if not rows:
        raise NotFound("Bottle not found.")
    return item_json(rows[0], pairings[rows[0]["wineID"]])


def _estimate(wine_type_value, vintage, acquired):
    return drink_window.get_provider().window(wine_type_value, vintage, acquired)


@bp.get("/collections/<int:collection_id>/items")
@login_required
def list_items(collection_id):
    require_member(collection_id)
    args = request.args
    unknown = set(args) - {"type", "region", "drinkStatus", "storedAt", "search", "sort", "order", "includeEmpty", "soonDays"}
    if unknown:
        raise ValidationError({name: f"Unknown filter '{name}'." for name in unknown})

    where, params = ["i.collectionId = ?"], [collection_id]
    if args.get("includeEmpty", "").lower() != "true":
        where.append("i.itemQuantity > 0")
    wtype = query_param(args, "type", wine_type)
    if wtype:
        where.append("w.wineType = ?")
        params.append(wtype)
    for name, column in (("region", "w.wineRegion"), ("storedAt", "i.itemStoredAt")):
        value = (args.get(name) or "").strip()[:120]
        if value:
            where.append(f"{column} LIKE ? ESCAPE '\\'")
            params.append(_like(value))
    search = (args.get("search") or "").strip()[:120]
    if search:
        where.append("(w.wineName LIKE ? ESCAPE '\\' OR w.wineProducer LIKE ? ESCAPE '\\' OR w.wineRegion LIKE ? ESCAPE '\\')")
        params += [_like(search)] * 3

    status = query_param(args, "drinkStatus", _choice(DRINK_STATUSES, "drinkStatus"))
    sort = query_param(args, "sort", _choice(SORTS, "sort"), "name")
    order = query_param(args, "order", _choice(("asc", "desc"), "order"), "asc")
    soon_days = query_param(args, "soonDays", int_range(0, 3650, "soonDays"), drink_window.DEFAULT_SOON_DAYS)

    rows, pairings = load_items(" AND ".join(where), params)
    items = [item_json(r, pairings[r["wineID"]], soon_days=soon_days) for r in rows]
    if status:
        items = [i for i in items if i["drinkStatus"] == status]
    items = sort_items(items, sort, reverse=(order == "desc"))
    return jsonify({"items": items, "count": len(items)})


def _like(value):
    return "%" + value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _choice(options, label):
    def parse(value):
        if value not in options:
            raise FieldError(f"{label} must be one of: {', '.join(options)}.")
        return value
    return parse


def sort_items(items, sort, reverse=False):
    keys = {
        "name": lambda i: (i["wine"]["wineName"].lower(), i["wine"]["wineVint"] or 0),
        "vintage": lambda i: i["wine"]["wineVint"],
        "value": lambda i: i["currentValueCents"],
        "drinkBy": lambda i: i["itemDrinkBy"],
        "acquired": lambda i: i["itemAquiredDate"],
    }
    key = keys[sort]
    present = [i for i in items if key(i) is not None]
    missing = [i for i in items if key(i) is None]
    # Items without the sort value always go last.
    return sorted(present, key=key, reverse=reverse) + missing


@bp.post("/collections/<int:collection_id>/items")
@login_required
def add_item(collection_id):
    require_member(collection_id)
    body = json_body()
    data = validate(body, ITEM_CREATE_SPEC)
    errors = {}
    if (data.get("wineId") is None) == (data.get("wine") is None):
        errors["wineId"] = "Send either wineId (an existing wine) or wine (a new wine's details), not both."
    check_window(errors, data.get("itemDrinkFrom"), data.get("itemDrinkBy"))
    check(errors)

    user_id = current_user()["userID"]
    if data.get("wine") is not None:
        try:
            wine_data = validate(data["wine"], WINE_SPEC)
        except ValidationError as err:
            raise ValidationError({f"wine.{k}": v for k, v in err.fields.items()}) from None
        wine_id = create_wine(wine_data, user_id, field_prefix="wine.")
    else:
        wine_id = data["wineId"]
    wine = db.query_one("SELECT wineType, wineVint FROM wine WHERE wineID = ?", [wine_id])
    if wine is None:
        raise ValidationError({"wineId": "No wine with that id. Search with GET /api/v1/wines."})

    drink_from, drink_by = data.get("itemDrinkFrom"), data.get("itemDrinkBy")
    if drink_from or drink_by:
        source = "user"
    else:
        drink_from, drink_by, source = _estimate(wine["wineType"], wine["wineVint"], data.get("itemAquiredDate"))

    result = db.execute(
        "INSERT INTO inventory_item (wineID, collectionId, itemQuantity, itemStoredAt, itemAquiredDate, "
        "itemDrinkFrom, itemDrinkBy, itemDrinkWindowSource, itemPurchasePrice, itemCreatedAt) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [wine_id, collection_id, data["itemQuantity"], data.get("itemStoredAt"), data.get("itemAquiredDate"),
         drink_from, drink_by, source, data.get("itemPurchasePrice"), now_iso()],
    )
    return jsonify(get_item_json(result.last_row_id)), 201


@bp.get("/items/<int:item_id>")
@login_required
def get_item(item_id):
    require_item(item_id)
    return jsonify(get_item_json(item_id))


@bp.patch("/items/<int:item_id>")
@login_required
def update_item(item_id):
    item = require_item(item_id)
    data = validate(json_body(), ITEM_PATCH_SPEC, partial=True)

    changes = {k: v for k, v in data.items() if k not in ("itemDrinkFrom", "itemDrinkBy")}
    window_sent = "itemDrinkFrom" in data or "itemDrinkBy" in data
    drink_from = data.get("itemDrinkFrom", item["itemDrinkFrom"]) if window_sent else item["itemDrinkFrom"]
    drink_by = data.get("itemDrinkBy", item["itemDrinkBy"]) if window_sent else item["itemDrinkBy"]

    if window_sent:
        errors = {}
        check_window(errors, drink_from, drink_by)
        check(errors)
        if drink_from or drink_by:
            changes.update(itemDrinkFrom=drink_from, itemDrinkBy=drink_by, itemDrinkWindowSource="user")
        else:
            window_sent = False  # both cleared: go back to an estimate below
            item = dict(item, itemDrinkWindowSource="estimate")

    acquired_changed = "itemAquiredDate" in data and data["itemAquiredDate"] != item["itemAquiredDate"]
    if not window_sent and item["itemDrinkWindowSource"] in ("estimate", None) and (
        acquired_changed or ("itemDrinkFrom" in data or "itemDrinkBy" in data)
    ):
        wine = db.query_one("SELECT wineType, wineVint FROM wine WHERE wineID = ?", [item["wineID"]])
        f, b, s = _estimate(wine["wineType"], wine["wineVint"], data.get("itemAquiredDate", item["itemAquiredDate"]))
        changes.update(itemDrinkFrom=f, itemDrinkBy=b, itemDrinkWindowSource=s)

    if changes:
        columns = list(changes)  # trusted names from the specs above
        db.execute(
            f"UPDATE inventory_item SET {', '.join(f'{c} = ?' for c in columns)} WHERE itemID = ?",
            [changes[c] for c in columns] + [item_id],
        )
    return jsonify(get_item_json(item_id))


@bp.delete("/items/<int:item_id>")
@login_required
def delete_item(item_id):
    require_item(item_id)
    db.execute("DELETE FROM inventory_item WHERE itemID = ?", [item_id])
    return jsonify({"deleted": True})
