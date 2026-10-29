"""Wishlist: wines a household wants to remember. A list only, with no
prices, shops or links to buy."""

from flask import Blueprint, jsonify

from .. import db
from ..access import require_member
from ..auth import current_user, login_required
from ..errors import NotFound, ValidationError
from ..util import json_body, now_iso
from ..validation import Field, positive_id, text, validate, vintage

bp = Blueprint("wishlist", __name__)

WISH_SPEC = {
    "wineId": Field(positive_id),
    "wishName": Field(text(1, 120, "Wine name")),
    "wishProducer": Field(text(0, 120, "Producer")),
    "wishVint": Field(vintage),
    "wishNotes": Field(text(0, 2000, "Notes", multiline=True)),
}

WISH_SELECT = (
    "SELECT x.*, u.userFname, u.userLname FROM wishlist_item x LEFT JOIN user u ON u.userID = x.wishAddedByUserID "
)


def wish_json(row):
    return {
        "wishID": row["wishID"],
        "collectionId": row["collectionId"],
        "wineID": row["wineID"],
        "wishName": row["wishName"],
        "wishProducer": row["wishProducer"],
        "wishVint": row["wishVint"],
        "wishNotes": row["wishNotes"],
        "wishAddedByUserID": row["wishAddedByUserID"],
        "wishAddedByName": f"{row['userFname']} {row['userLname']}" if row.get("userFname") else None,
        "wishAddedAt": row["wishAddedAt"],
    }


def _require_wish(wish_id):
    row = db.query_one(
        WISH_SELECT + "JOIN collection_member m ON m.collectionId = x.collectionId AND m.userID = ? WHERE x.wishID = ?",
        [current_user()["userID"], wish_id],
    )
    if row is None:
        raise NotFound("Wishlist entry not found.")
    return row


def _fill_from_catalog(data):
    """With a wineId, copy the wine's name, producer and vintage unless sent."""
    if data.get("wineId") is None:
        return data
    wine = db.query_one("SELECT wineName, wineProducer, wineVint FROM wine WHERE wineID = ?", [data["wineId"]])
    if wine is None:
        raise ValidationError({"wineId": "No wine with that id."})
    data.setdefault("wishName", wine["wineName"])
    data.setdefault("wishProducer", wine["wineProducer"])
    data.setdefault("wishVint", wine["wineVint"])
    return data


@bp.get("/collections/<int:collection_id>/wishlist")
@login_required
def list_wishes(collection_id):
    require_member(collection_id)
    rows = db.query(WISH_SELECT + "WHERE x.collectionId = ? ORDER BY x.wishAddedAt DESC, x.wishID DESC", [collection_id])
    return jsonify({"wishlist": [wish_json(r) for r in rows]})


@bp.post("/collections/<int:collection_id>/wishlist")
@login_required
def add_wish(collection_id):
    require_member(collection_id)
    data = _fill_from_catalog(validate(json_body(), WISH_SPEC))
    if not data.get("wishName"):
        raise ValidationError({"wishName": "Wine name is required (or send a wineId from the catalog)."})
    result = db.execute(
        "INSERT INTO wishlist_item (collectionId, wineID, wishName, wishProducer, wishVint, wishNotes, wishAddedByUserID, wishAddedAt) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [collection_id, data.get("wineId"), data["wishName"], data.get("wishProducer"), data.get("wishVint"),
         data.get("wishNotes"), current_user()["userID"], now_iso()],
    )
    return jsonify(wish_json(_require_wish(result.last_row_id))), 201


@bp.patch("/wishlist/<int:wish_id>")
@login_required
def update_wish(wish_id):
    _require_wish(wish_id)
    data = validate(json_body(), WISH_SPEC, partial=True)
    if "wishName" in data and not data["wishName"]:
        raise ValidationError({"wishName": "Wine name is required."})
    columns = {"wineId": "wineID", "wishName": "wishName", "wishProducer": "wishProducer",
               "wishVint": "wishVint", "wishNotes": "wishNotes"}
    sent = [k for k in columns if k in data]
    if data.get("wineId") is not None:
        _fill_from_catalog(dict(data))
    if sent:
        db.execute(
            f"UPDATE wishlist_item SET {', '.join(columns[k] + ' = ?' for k in sent)} WHERE wishID = ?",
            [data[k] for k in sent] + [wish_id],
        )
    return jsonify(wish_json(_require_wish(wish_id)))


@bp.delete("/wishlist/<int:wish_id>")
@login_required
def delete_wish(wish_id):
    _require_wish(wish_id)
    db.execute("DELETE FROM wishlist_item WHERE wishID = ?", [wish_id])
    return jsonify({"deleted": True})
