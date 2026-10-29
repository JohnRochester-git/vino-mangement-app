"""The shared wine catalog, barcode lookup, and reference data.

One wine row per wine and vintage, reused by every household. Because it's
shared, only the wine's creator may edit it, and only while no other
household holds it. Households keep their own values on their items.
"""

import re

from flask import Blueprint, current_app, jsonify, request

from .. import db
from ..auth import current_user, login_required
from ..errors import Conflict, NotFound, ValidationError
from ..services import barcode as barcode_service
from ..util import json_body, money_fields, now_iso
from ..validation import (
    Field, FieldError, barcode, money, name_list, positive_id, text, validate, vintage, wine_type,
)

bp = Blueprint("wines", __name__)


def image_key(value):
    value = text(1, 300, "Image key")(value)
    if not re.fullmatch(r"[A-Za-z0-9/_.\-]+", value) or ".." in value:
        raise FieldError("Image key may only contain letters, digits, '/', '_', '-' and '.'.")
    return value


WINE_SPEC = {
    "wineName": Field(text(1, 120, "Wine name"), required=True),
    "wineProducer": Field(text(0, 120, "Producer")),
    "wineRegion": Field(text(0, 120, "Region")),
    "wineType": Field(wine_type, required=True),
    "wineVint": Field(vintage),
    "wineDescription": Field(text(0, 2000, "Description", multiline=True)),
    "wineProfile": Field(text(0, 2000, "Profile", multiline=True)),
    "wineValue": Field(money),
    "blendID": Field(positive_id),
    "wineBarcode": Field(barcode),
    "wineImageKey": Field(image_key),
    "pairings": Field(name_list()),
}

# Columns a wine's creator may change. Keys are trusted names, never user input.
_WINE_COLUMNS = [
    "wineName", "wineProducer", "wineRegion", "wineType", "wineVint", "wineDescription",
    "wineProfile", "wineValue", "blendID", "wineBarcode", "wineImageKey",
]

WINE_SELECT = "SELECT w.*, b.blendStyle FROM wine w LEFT JOIN blends b ON b.blendID = w.blendID "


def wine_json(row, pairings=None):
    return {
        "wineID": row["wineID"],
        "wineName": row["wineName"],
        "wineProducer": row["wineProducer"],
        "wineRegion": row["wineRegion"],
        "wineType": row["wineType"],
        "wineVint": row["wineVint"],
        "wineDescription": row["wineDescription"],
        "wineProfile": row["wineProfile"],
        "blendID": row["blendID"],
        "blendStyle": row.get("blendStyle"),
        "wineBarcode": row["wineBarcode"],
        "wineImageKey": row["wineImageKey"],
        **money_fields("wineValue", row["wineValue"]),
        "wineCreatedAt": row["wineCreatedAt"],
        "wineCreatedByUserID": row["wineCreatedByUserID"],
        "pairings": pairings if pairings is not None else [],
    }


def pairings_for(wine_ids):
    """{wineID: [pairing names]} for the given wines, in one query."""
    wine_ids = sorted(set(wine_ids))
    if not wine_ids:
        return {}
    placeholders = ",".join("?" for _ in wine_ids)
    rows = db.query(
        "SELECT wp.wineID, p.pairingName FROM wine_pairing wp JOIN pairings p ON p.pairingID = wp.pairingID "
        f"WHERE wp.wineID IN ({placeholders}) ORDER BY p.pairingName",
        wine_ids,
    )
    out = {wid: [] for wid in wine_ids}
    for r in rows:
        out[r["wineID"]].append(r["pairingName"])
    return out


def get_wine_json(wine_id):
    row = db.query_one(WINE_SELECT + "WHERE w.wineID = ?", [wine_id])
    if row is None:
        raise NotFound("Wine not found.")
    return wine_json(row, pairings_for([wine_id])[wine_id])


def _resolve_references(data, field_prefix=""):
    """Check blendID and pairing names exist. Returns pairing ids (or None)."""
    errors = {}
    if data.get("blendID") is not None:
        if db.query_one("SELECT 1 FROM blends WHERE blendID = ?", [data["blendID"]]) is None:
            errors[field_prefix + "blendID"] = "Unknown blend. See GET /api/v1/blends."
    pairing_ids = None
    if "pairings" in data:
        pairing_ids = []
        known = {r["pairingName"].lower(): r["pairingID"] for r in db.query("SELECT * FROM pairings")}
        for name in data["pairings"] or []:
            if name.lower() not in known:
                errors[field_prefix + "pairings"] = f"Unknown pairing '{name}'. See GET /api/v1/pairings."
                break
            pairing_ids.append(known[name.lower()])
    if errors:
        raise ValidationError(errors)
    return sorted(set(pairing_ids)) if pairing_ids is not None else None


def _barcode_conflict(code, field="wineBarcode"):
    existing = db.query_one("SELECT wineID, wineName FROM wine WHERE wineBarcode = ?", [code])
    message = "A wine with this barcode is already in the catalog."
    if existing:
        message += f" Use wineId {existing['wineID']} ({existing['wineName']}) instead."
    return Conflict(message, code="barcode_exists", fields={field: message})


def create_wine(data, user_id, field_prefix=""):
    """Insert a validated wine (WINE_SPEC output) and return its id."""
    pairing_ids = _resolve_references(data, field_prefix) or []
    now = now_iso()
    columns = [c for c in _WINE_COLUMNS if data.get(c) is not None]
    values = [data[c] for c in columns]
    sql = (
        f"INSERT INTO wine ({', '.join(columns)}, wineCreatedAt, wineCreatedByUserID) "
        f"VALUES ({', '.join('?' for _ in columns)}, ?, ?)"
    )
    try:
        wine_id = db.execute(sql, values + [now, user_id]).last_row_id
    except db.IntegrityError:
        if data.get("wineBarcode"):
            raise _barcode_conflict(data["wineBarcode"], field_prefix + "wineBarcode") from None
        raise

    extras = [("INSERT INTO wine_pairing (wineID, pairingID) VALUES (?, ?)", [wine_id, pid]) for pid in pairing_ids]
    if data.get("wineValue") is not None:
        extras.append((
            "INSERT INTO value_history (wineID, itemID, valueCents, valueSource, valueRecordedAt) VALUES (?, NULL, ?, 'user', ?)",
            [wine_id, data["wineValue"], now],
        ))
    try:
        db.batch(extras)
    except Exception:
        # Don't leave a half-made wine behind.
        db.execute("DELETE FROM wine WHERE wineID = ?", [wine_id])
        raise
    return wine_id


@bp.get("/wines")
@login_required
def search_wines():
    search = (request.args.get("search") or "").strip()[:120]
    sql, params = WINE_SELECT, []
    if search:
        like = "%" + search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        sql += ("WHERE w.wineName LIKE ? ESCAPE '\\' OR w.wineProducer LIKE ? ESCAPE '\\' "
                "OR w.wineRegion LIKE ? ESCAPE '\\' ")
        params = [like, like, like]
    sql += "ORDER BY w.wineName, w.wineVint LIMIT 50"
    rows = db.query(sql, params)
    pairings = pairings_for(r["wineID"] for r in rows)
    return jsonify({"wines": [wine_json(r, pairings[r["wineID"]]) for r in rows]})


@bp.get("/wines/<int:wine_id>")
@login_required
def get_wine(wine_id):
    return jsonify(get_wine_json(wine_id))


@bp.post("/wines")
@login_required
def add_wine():
    data = validate(json_body(), WINE_SPEC)
    wine_id = create_wine(data, current_user()["userID"])
    return jsonify(get_wine_json(wine_id)), 201


@bp.patch("/wines/<int:wine_id>")
@login_required
def update_wine(wine_id):
    data = validate(json_body(), WINE_SPEC, partial=True)
    user_id = current_user()["userID"]
    wine = db.query_one("SELECT * FROM wine WHERE wineID = ?", [wine_id])
    if wine is None:
        raise NotFound("Wine not found.")
    if wine["wineCreatedByUserID"] != user_id:
        raise Conflict("Only the person who added this wine to the catalog can edit it. "
                       "To change your own bottle's value or drinking window, edit your bottle instead.",
                       code="wine_not_editable")
    pairing_ids = _resolve_references(data)

    columns = [c for c in _WINE_COLUMNS if c in data]
    assignments = ", ".join(f"{c} = ?" for c in columns) or "wineName = wineName"
    # The NOT EXISTS guard is part of the UPDATE, so another household adding
    # the wine at the same moment can't slip past the check.
    sql = (
        f"UPDATE wine SET {assignments} WHERE wineID = ? AND wineCreatedByUserID = ? "
        "AND NOT EXISTS (SELECT 1 FROM inventory_item i WHERE i.wineID = wine.wineID AND NOT EXISTS ("
        "    SELECT 1 FROM collection_member m WHERE m.collectionId = i.collectionId AND m.userID = ?))"
    )
    try:
        result = db.execute(sql, [data[c] for c in columns] + [wine_id, user_id, user_id])
    except db.IntegrityError:
        if data.get("wineBarcode"):
            raise _barcode_conflict(data["wineBarcode"]) from None
        raise
    if result.changes == 0:
        raise Conflict("Another household has this wine in their cellar, so its catalog details can't be changed. "
                       "Edit your own bottle instead.", code="wine_in_use")

    extras = []
    if pairing_ids is not None:
        extras.append(("DELETE FROM wine_pairing WHERE wineID = ?", [wine_id]))
        extras += [("INSERT INTO wine_pairing (wineID, pairingID) VALUES (?, ?)", [wine_id, p]) for p in pairing_ids]
    if data.get("wineValue") is not None and data["wineValue"] != wine["wineValue"]:
        extras.append((
            "INSERT INTO value_history (wineID, itemID, valueCents, valueSource, valueRecordedAt) VALUES (?, NULL, ?, 'user', ?)",
            [wine_id, data["wineValue"], now_iso()],
        ))
    db.batch(extras)
    return jsonify(get_wine_json(wine_id))


@bp.get("/wines/barcode/<code>")
@login_required
def lookup_barcode(code):
    try:
        code = barcode(code)
    except FieldError as err:
        raise ValidationError({"code": str(err)}) from None

    row = db.query_one(WINE_SELECT + "WHERE w.wineBarcode = ?", [code])
    if row:
        return jsonify({"found": True, "source": "catalog",
                        "wine": wine_json(row, pairings_for([row["wineID"]])[row["wineID"]])})

    provider = barcode_service.get_provider(current_app.config["VINO"])
    try:
        found = provider.lookup(code)
    except Exception:  # a provider must never turn into a 500
        current_app.logger.exception("Barcode provider failed")
        found = None
    if not found:
        return jsonify({"found": False})

    # Not saved yet: the user confirms or corrects these details, then adds
    # the bottle with a nested "wine" (including this barcode), which saves it
    # to the catalog so the next scan finds it.
    wine = {k: None for k in ("wineID", "wineProducer", "wineRegion", "wineType", "wineVint")}
    wine.update(found)
    wine["wineBarcode"] = code
    return jsonify({"found": True, "source": "provider", "provider": provider.name, "wine": wine})


@bp.get("/wines/<int:wine_id>/pairings")
@login_required
def wine_pairings(wine_id):
    if db.query_one("SELECT 1 FROM wine WHERE wineID = ?", [wine_id]) is None:
        raise NotFound("Wine not found.")
    rows = db.query(
        "SELECT p.pairingID, p.pairingName FROM wine_pairing wp JOIN pairings p ON p.pairingID = wp.pairingID "
        "WHERE wp.wineID = ? ORDER BY p.pairingName",
        [wine_id],
    )
    return jsonify({"pairings": rows})


@bp.get("/blends")
@login_required
def list_blends():
    return jsonify({"blends": db.query("SELECT blendID, blendStyle FROM blends ORDER BY blendStyle")})


@bp.get("/pairings")
@login_required
def list_pairings():
    return jsonify({"pairings": db.query("SELECT pairingID, pairingName FROM pairings ORDER BY pairingName")})
