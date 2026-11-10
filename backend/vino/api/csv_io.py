"""CSV export and import of a collection's bottles.

Import checks every row first. If any row has a problem, nothing is imported
and the response lists each problem by row number. If every row is fine, the
whole file is added in one batch, so it's never half imported.
"""

import csv
import io

from flask import Blueprint, Response, request

from .. import db
from ..access import require_member
from ..auth import current_user, login_required
from ..errors import APIError, ValidationError
from ..services import drink_window
from ..util import now_iso
from ..validation import Field, check_window, iso_date, money, past_date, quantity, text, validate
from .items import load_items
from .wines import WINE_SPEC

bp = Blueprint("csv_io", __name__)

# Kept small so one import stays well inside D1's per-request limits.
MAX_IMPORT_ROWS = 200

COLUMNS = [
    "wineName", "wineProducer", "wineRegion", "wineType", "wineVint", "blendStyle", "wineBarcode",
    "wineValue", "pairings", "itemQuantity", "itemStoredAt", "itemAquiredDate", "itemPurchasePrice",
    "itemValue", "itemDrinkFrom", "itemDrinkBy", "wineDescription",
]

ROW_ITEM_SPEC = {
    "itemQuantity": Field(quantity(1), required=True),
    "itemStoredAt": Field(text(0, 120, "Storage location")),
    "itemAquiredDate": Field(past_date),
    "itemPurchasePrice": Field(money),
    "itemValue": Field(money),
    "itemDrinkFrom": Field(iso_date),
    "itemDrinkBy": Field(iso_date),
}


def _dollars(cents):
    return "" if cents is None else f"{cents / 100:.2f}"


def _safe_cell(value):
    """Stop spreadsheet apps from running a cell as a formula."""
    if value is None:
        return ""
    value = str(value)
    if value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


@bp.get("/collections/<int:collection_id>/export.csv")
@login_required
def export_csv(collection_id):
    collection = require_member(collection_id)
    rows, pairings = load_items("i.collectionId = ? AND i.itemQuantity > 0", [collection_id], order="w.wineName, i.itemID")
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(COLUMNS)
    for r in rows:
        writer.writerow([_safe_cell(v) for v in [
            r["wineName"], r["wineProducer"], r["wineRegion"], r["wineType"], r["wineVint"], r["blendStyle"],
            r["wineBarcode"], _dollars(r["wineValue"]), "; ".join(pairings[r["wineID"]]), r["itemQuantity"],
            r["itemStoredAt"], r["itemAquiredDate"], _dollars(r["itemPurchasePrice"]), _dollars(r["itemValue"]),
            r["itemDrinkFrom"], r["itemDrinkBy"], r["wineDescription"],
        ]])
    filename = "".join(ch for ch in collection["collectionName"] if ch.isalnum() or ch in " -_").strip() or "cellar"
    return Response(
        "﻿" + out.getvalue(),  # the BOM makes Excel read accented names correctly
        mimetype="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}.csv"'},
    )


def _read_upload():
    if request.mimetype == "multipart/form-data":
        upload = request.files.get("file")
        if upload is None:
            raise ValidationError({"file": "Attach the CSV file in a field named 'file'."})
        raw = upload.read()
    elif request.mimetype in ("text/csv", "text/plain", "application/csv"):
        raw = request.get_data()
    else:
        raise APIError(415, "unsupported_media_type", "Send the file as text/csv or as multipart/form-data.")
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ValidationError({"file": "Save the file as CSV UTF-8 and try again."}) from None


def _parse_rows(content):
    reader = csv.DictReader(io.StringIO(content))
    headers = [h.strip() for h in (reader.fieldnames or [])]
    reader.fieldnames = headers
    unknown = [h for h in headers if h and h not in COLUMNS]
    missing = [h for h in ("wineName", "wineType", "itemQuantity") if h not in headers]
    if not headers or unknown or missing:
        problems = []
        if missing:
            problems.append("missing column(s): " + ", ".join(missing))
        if unknown:
            problems.append("unknown column(s): " + ", ".join(unknown))
        raise ValidationError({"file": "The header row has " + "; ".join(problems or ["no columns"])
                               + ". Allowed columns: " + ", ".join(COLUMNS) + "."})
    rows = []
    for line_no, row in enumerate(reader, start=2):  # row 1 is the header
        if None in row:
            rows.append((line_no, None))  # more cells than headers
            continue
        cleaned = {k: (v or "").strip() for k, v in row.items() if k}
        if any(cleaned.values()):
            rows.append((line_no, cleaned))
        if len(rows) > MAX_IMPORT_ROWS:
            raise ValidationError({"file": f"Import at most {MAX_IMPORT_ROWS} rows at a time. Split the file and import each part."})
    if not rows:
        raise ValidationError({"file": "The file has no rows to import."})
    return rows


def _validate_row(row, blends, pairing_ids, catalog_barcodes, seen_barcodes):
    errors = {}
    wine_in = {k: row[k] for k in WINE_SPEC if k in row and k != "pairings" and row[k] != ""}
    item_in = {k: row[k] for k in ROW_ITEM_SPEC if k in row and row[k] != ""}
    wine, item = {}, {}
    try:
        wine = validate(wine_in, WINE_SPEC)
    except ValidationError as err:
        errors.update(err.fields)
    try:
        item = validate(item_in, ROW_ITEM_SPEC)
    except ValidationError as err:
        errors.update(err.fields)
    check_window(errors, item.get("itemDrinkFrom"), item.get("itemDrinkBy"))

    if row.get("blendStyle"):
        blend_id = blends.get(row["blendStyle"].lower())
        if blend_id is None:
            errors["blendStyle"] = f"Unknown blend '{row['blendStyle']}'."
        wine["blendID"] = blend_id
    pairings = []
    for name in filter(None, (p.strip() for p in row.get("pairings", "").split(";"))):
        if name.lower() not in pairing_ids:
            errors["pairings"] = f"Unknown pairing '{name}'. Separate pairings with ';'."
        else:
            pairings.append(pairing_ids[name.lower()])
    code = wine.get("wineBarcode")
    if code:
        if code in seen_barcodes:
            errors["wineBarcode"] = f"Same barcode as row {seen_barcodes[code]}. Put both in one row and add up the quantity."
        seen_barcodes.setdefault(code, row["_line"])
    return errors, wine, item, sorted(set(pairings)), catalog_barcodes.get(code)


@bp.post("/collections/<int:collection_id>/import")
@login_required
def import_csv(collection_id):
    require_member(collection_id)
    rows = _parse_rows(_read_upload())

    blends = {b["blendStyle"].lower(): b["blendID"] for b in db.query("SELECT blendID, blendStyle FROM blends")}
    pairing_ids = {p["pairingName"].lower(): p["pairingID"] for p in db.query("SELECT pairingID, pairingName FROM pairings")}
    catalog_barcodes = {r["wineBarcode"]: r["wineID"]
                        for r in db.query("SELECT wineID, wineBarcode FROM wine WHERE wineBarcode IS NOT NULL")}

    row_errors, parsed, seen = [], [], {}
    for line_no, row in rows:
        if row is None:
            row_errors.append({"row": line_no, "fields": {"file": "This row has more cells than the header row."}})
            continue
        row["_line"] = line_no
        errors, wine, item, pairings, existing_wine = _validate_row(row, blends, pairing_ids, catalog_barcodes, seen)
        if errors:
            row_errors.append({"row": line_no, "fields": errors})
        else:
            parsed.append((wine, item, pairings, existing_wine))
    if row_errors:
        raise APIError(400, "import_errors",
                       f"{len(row_errors)} row(s) need fixing. Nothing was imported.", extra={"rows": row_errors})

    user_id, now = current_user()["userID"], now_iso()
    statements = []
    new_wine = "(SELECT max(wineID) FROM wine)"  # the wine inserted just before, inside this batch
    for wine, item, pairings, existing_wine in parsed:
        if existing_wine:
            wine_ref, wine_params = "?", [existing_wine]
        else:
            columns = [c for c in ("wineName", "wineProducer", "wineRegion", "wineType", "wineVint", "wineDescription",
                                   "wineValue", "blendID", "wineBarcode") if wine.get(c) is not None]
            statements.append((
                f"INSERT INTO wine ({', '.join(columns)}, wineCreatedAt, wineCreatedByUserID) "
                f"VALUES ({', '.join('?' for _ in columns)}, ?, ?)",
                [wine[c] for c in columns] + [now, user_id],
            ))
            statements += [(f"INSERT INTO wine_pairing (wineID, pairingID) VALUES ({new_wine}, ?)", [p]) for p in pairings]
            if wine.get("wineValue") is not None:
                statements.append((
                    f"INSERT INTO value_history (wineID, itemID, valueCents, valueSource, valueRecordedAt) "
                    f"VALUES ({new_wine}, NULL, ?, 'user', ?)", [wine["wineValue"], now]))
            wine_ref, wine_params = new_wine, []

        drink_from, drink_by = item.get("itemDrinkFrom"), item.get("itemDrinkBy")
        source = "user"
        if not (drink_from or drink_by):
            if existing_wine:
                w = db.query_one("SELECT wineType, wineVint FROM wine WHERE wineID = ?", [existing_wine])
            else:
                w = wine
            drink_from, drink_by, source = drink_window.get_provider().window(
                w["wineType"], w.get("wineVint"), item.get("itemAquiredDate"))
        statements.append((
            "INSERT INTO inventory_item (wineID, collectionId, itemQuantity, itemStoredAt, itemAquiredDate, itemDrinkFrom, "
            f"itemDrinkBy, itemDrinkWindowSource, itemPurchasePrice, itemValue, itemCreatedAt) "
            f"VALUES ({wine_ref}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            wine_params + [collection_id, item["itemQuantity"], item.get("itemStoredAt"), item.get("itemAquiredDate"),
                           drink_from, drink_by, source, item.get("itemPurchasePrice"), item.get("itemValue"), now],
        ))
        if item.get("itemValue") is not None:
            statements.append((
                "INSERT INTO value_history (wineID, itemID, valueCents, valueSource, valueRecordedAt) "
                "SELECT wineID, itemID, ?, 'user', ? FROM inventory_item WHERE itemID = (SELECT max(itemID) FROM inventory_item)",
                [item["itemValue"], now],
            ))
    try:
        db.batch(statements)
    except db.IntegrityError:
        raise APIError(409, "conflict", "The import clashed with data added at the same time. Nothing was imported. "
                                        "Try again.") from None
    return {"imported": len(parsed), "bottles": sum(i["itemQuantity"] for _, i, _, _ in parsed)}, 201
