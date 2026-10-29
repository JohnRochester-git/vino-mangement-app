"""Collections and household members."""

from flask import Blueprint, jsonify

from .. import db
from ..access import require_member, require_owner
from ..auth import current_user, login_required
from ..errors import APIError, Conflict, NotFound
from ..util import json_body, money_fields, now_iso
from ..validation import Field, email, text, validate

bp = Blueprint("collections", __name__)

COLLECTION_SPEC = {"collectionName": Field(text(1, 80, "Collection name"), required=True)}
MEMBER_SPEC = {"userEmail": Field(email, required=True)}

# Value per bottle: the household's own estimate if set, otherwise the catalog value.
_SUMMARY_SQL = (
    "SELECT c.collectionId, c.collectionName, c.userID, m.memberRole, "
    "  coalesce(sum(CASE WHEN i.itemQuantity > 0 THEN i.itemQuantity * coalesce(i.itemValue, w.wineValue) END), 0) AS sumValue, "
    "  coalesce(sum(i.itemQuantity), 0) AS bottleCount "
    "FROM collection c "
    "JOIN collection_member m ON m.collectionId = c.collectionId AND m.userID = ? "
    "LEFT JOIN inventory_item i ON i.collectionId = c.collectionId "
    "LEFT JOIN wine w ON w.wineID = i.wineID "
)


def _collection_json(row):
    return {
        "collectionId": row["collectionId"],
        "collectionName": row["collectionName"],
        "userID": row["userID"],
        "memberRole": row["memberRole"],
        "bottleCount": row["bottleCount"],
        **money_fields("collectionSumValue", row["sumValue"]),
    }


def list_collections_for(user_id):
    rows = db.query(_SUMMARY_SQL + "GROUP BY c.collectionId ORDER BY c.collectionId", [user_id])
    return [_collection_json(r) for r in rows]


def _get_collection(collection_id):
    row = db.query_one(_SUMMARY_SQL + "WHERE c.collectionId = ? GROUP BY c.collectionId",
                       [current_user()["userID"], collection_id])
    if row is None:
        raise NotFound("Collection not found.")
    return _collection_json(row)


@bp.get("/collections")
@login_required
def list_collections():
    return jsonify({"collections": list_collections_for(current_user()["userID"])})


@bp.post("/collections")
@login_required
def create_collection():
    data = validate(json_body(), COLLECTION_SPEC)
    user_id = current_user()["userID"]
    # One batch, so a collection never exists without its owner membership.
    # The second statement adds the owner to any of this user's collections
    # that has no members yet, which is the one just inserted.
    created, _ = db.batch([
        ("INSERT INTO collection (collectionName, userID) VALUES (?, ?)", [data["collectionName"], user_id]),
        (
            "INSERT INTO collection_member (collectionId, userID, memberRole, memberAddedAt) "
            "SELECT c.collectionId, c.userID, 'owner', ? FROM collection c WHERE c.userID = ? "
            "AND NOT EXISTS (SELECT 1 FROM collection_member m WHERE m.collectionId = c.collectionId)",
            [now_iso(), user_id],
        ),
    ])
    return jsonify(_get_collection(created.last_row_id)), 201


@bp.get("/collections/<int:collection_id>")
@login_required
def get_collection(collection_id):
    return jsonify(_get_collection(collection_id))


@bp.patch("/collections/<int:collection_id>")
@login_required
def update_collection(collection_id):
    require_member(collection_id)
    data = validate(json_body(), COLLECTION_SPEC)
    db.execute("UPDATE collection SET collectionName = ? WHERE collectionId = ?",
               [data["collectionName"], collection_id])
    return jsonify(_get_collection(collection_id))


@bp.delete("/collections/<int:collection_id>")
@login_required
def delete_collection(collection_id):
    require_owner(collection_id)
    db.execute("DELETE FROM collection WHERE collectionId = ?", [collection_id])
    return jsonify({"deleted": True})


@bp.get("/collections/<int:collection_id>/members")
@login_required
def list_members(collection_id):
    require_member(collection_id)
    rows = db.query(
        "SELECT u.userID, u.userEmail, u.userFname, u.userLname, m.memberRole, m.memberAddedAt "
        "FROM collection_member m JOIN user u ON u.userID = m.userID "
        "WHERE m.collectionId = ? ORDER BY m.memberRole DESC, m.memberAddedAt",
        [collection_id],
    )
    return jsonify({"members": [_member_json(r) for r in rows]})


def _member_json(row):
    return {
        "userID": row["userID"],
        "userEmail": row["userEmail"],
        "userFullname": f"{row['userFname']} {row['userLname']}",
        "memberRole": row["memberRole"],
        "memberAddedAt": row["memberAddedAt"],
    }


@bp.post("/collections/<int:collection_id>/members")
@login_required
def add_member(collection_id):
    require_owner(collection_id)
    data = validate(json_body(), MEMBER_SPEC)
    user = db.query_one("SELECT * FROM user WHERE userEmail = ?", [data["userEmail"]])
    if user is None:
        raise APIError(404, "user_not_found", "No account uses that email. Ask them to sign up first.",
                       {"userEmail": "No account uses that email."})
    try:
        db.execute(
            "INSERT INTO collection_member (collectionId, userID, memberRole, memberAddedAt) VALUES (?, ?, 'member', ?)",
            [collection_id, user["userID"], now_iso()],
        )
    except db.IntegrityError:
        raise Conflict("That person is already a member of this collection.", code="already_member") from None
    row = db.query_one(
        "SELECT u.*, m.memberRole, m.memberAddedAt FROM collection_member m JOIN user u ON u.userID = m.userID "
        "WHERE m.collectionId = ? AND m.userID = ?",
        [collection_id, user["userID"]],
    )
    return jsonify(_member_json(row)), 201


@bp.delete("/collections/<int:collection_id>/members/<int:user_id>")
@login_required
def remove_member(collection_id, user_id):
    require_owner(collection_id)
    if user_id == current_user()["userID"]:
        raise Conflict("The owner can't be removed from their own collection.", code="owner_cannot_leave")
    result = db.execute("DELETE FROM collection_member WHERE collectionId = ? AND userID = ?",
                        [collection_id, user_id])
    if result.changes == 0:
        raise NotFound("That person isn't a member of this collection.")
    return jsonify({"deleted": True})
