"""Authorization: who may see and change which collection's data.

Everything collection-scoped goes through these helpers. Anyone who isn't a
member gets a 404, so other households' collections aren't even revealed.
"""

from . import db
from .auth import current_user
from .errors import Forbidden, NotFound


def require_member(collection_id):
    """Return the membership row (with memberRole) or raise 404."""
    row = db.query_one(
        "SELECT c.collectionId, c.collectionName, c.userID, m.memberRole "
        "FROM collection c JOIN collection_member m ON m.collectionId = c.collectionId "
        "WHERE c.collectionId = ? AND m.userID = ?",
        [collection_id, current_user()["userID"]],
    )
    if row is None:
        raise NotFound("Collection not found.")
    return row


def require_owner(collection_id):
    row = require_member(collection_id)
    if row["memberRole"] != "owner":
        raise Forbidden("Only the collection owner can do that.")
    return row


def require_item(item_id):
    """The inventory item, if the current user is a member of its collection."""
    row = db.query_one(
        "SELECT i.*, m.memberRole FROM inventory_item i "
        "JOIN collection_member m ON m.collectionId = i.collectionId AND m.userID = ? "
        "WHERE i.itemID = ?",
        [current_user()["userID"], item_id],
    )
    if row is None:
        raise NotFound("Bottle not found.")
    return row


def require_consumption(consume_id):
    row = db.query_one(
        "SELECT c.*, i.collectionId, i.wineID FROM consumption c "
        "JOIN inventory_item i ON i.itemID = c.itemID "
        "JOIN collection_member m ON m.collectionId = i.collectionId AND m.userID = ? "
        "WHERE c.consumeID = ?",
        [current_user()["userID"], consume_id],
    )
    if row is None:
        raise NotFound("Journal entry not found.")
    return row
