import csv
import io

from vino import db

from .conftest import MARGAUX, add_item

HEADER = "wineName,wineType,wineVint,blendStyle,pairings,itemQuantity,itemPurchasePrice,itemValue,itemStoredAt,wineBarcode\n"


def post_csv(client, collection_id, content):
    return client.client.post(f"/api/v1/collections/{collection_id}/import", data=content.encode("utf-8"),
                              content_type="text/csv")


def test_export_csv(frank):
    add_item(frank, itemPurchasePrice=900, itemStoredAt="=HYPERLINK(\"x\")")
    resp = frank.get(f"/api/v1/collections/{frank.collection_id}/export.csv")
    assert resp.status_code == 200 and resp.mimetype == "text/csv"
    rows = list(csv.DictReader(io.StringIO(resp.get_data(as_text=True).lstrip("﻿"))))
    assert rows[0]["wineName"] == "Château Margaux"
    assert rows[0]["wineValue"] == "1150.00" and rows[0]["itemPurchasePrice"] == "900.00"
    assert rows[0]["pairings"] == "Beef; Lamb"
    assert rows[0]["itemStoredAt"].startswith("'=")  # formulas are neutralized


def test_export_import_round_trip(frank, eric):
    add_item(frank, itemPurchasePrice=900)
    exported = frank.get(f"/api/v1/collections/{frank.collection_id}/export.csv").get_data(as_text=True)
    resp = eric.client.post(f"/api/v1/collections/{eric.collection_id}/import", data=exported.encode(),
                            content_type="text/csv")
    assert resp.status_code == 201, resp.get_json()
    items = eric.get(f"/api/v1/collections/{eric.collection_id}/items").get_json()["items"]
    assert items[0]["wine"]["wineName"] == "Château Margaux" and items[0]["itemPurchasePriceCents"] == 90000


def test_import_valid_file(app, frank):
    content = HEADER + (
        "Barolo Falletto,Red,2016,Nebbiolo,Beef; Pasta,2,150,180,Rack B,089744000026\n"
        "NV Brut,sparkling,,,,1,,,Fridge,\n"
    )
    resp = post_csv(frank, frank.collection_id, content)
    assert resp.status_code == 201 and resp.get_json() == {"imported": 2, "bottles": 3}
    items = {i["wine"]["wineName"]: i for i in frank.get(f"/api/v1/collections/{frank.collection_id}/items").get_json()["items"]}
    barolo = items["Barolo Falletto"]
    assert barolo["wine"]["blendStyle"] == "Nebbiolo" and barolo["wine"]["pairings"] == ["Beef", "Pasta"]
    assert barolo["itemValueCents"] == 18000 and barolo["itemDrinkWindowSource"] == "estimate"
    hist = frank.get(f"/api/v1/items/{barolo['itemID']}/value-history").get_json()["history"]
    assert [h["level"] for h in hist] == ["item"]
    assert items["NV Brut"]["wine"]["wineType"] == "Sparkling"
    # The imported barcode is now in the catalog.
    assert frank.get("/api/v1/wines/barcode/089744000026").get_json()["found"] is True


def test_import_reuses_catalog_wine_by_barcode(frank, eric):
    wid = add_item(frank, wine={**MARGAUX, "wineBarcode": "089744000026"})["wineID"]
    resp = post_csv(eric, eric.collection_id, HEADER + "Château Margaux,Red,2010,,,3,,,,089744000026\n")
    assert resp.status_code == 201
    assert eric.get(f"/api/v1/collections/{eric.collection_id}/items").get_json()["items"][0]["wineID"] == wid


def test_import_reports_every_bad_row_and_imports_nothing(app, frank):
    content = HEADER + (
        "Good Wine,Red,2018,,,1,,,,\n"
        ",Beer,1700,Nope,Tacos,0,-1,,,\n"
        "Dup A,Red,,,,1,,,,089744000026\n"
        "Dup B,Red,,,,1,,,,089744000026\n"
    )
    resp = post_csv(frank, frank.collection_id, content)
    body = resp.get_json()["error"]
    assert resp.status_code == 400 and body["code"] == "import_errors"
    by_row = {r["row"]: r["fields"] for r in body["rows"]}
    assert set(by_row) == {3, 5}
    assert {"wineName", "wineType", "wineVint", "blendStyle", "pairings", "itemQuantity", "itemPurchasePrice"} <= set(by_row[3])
    assert "row 4" in by_row[5]["wineBarcode"]
    with app.app_context():
        assert db.query_one("SELECT count(*) AS n FROM inventory_item")["n"] == 0
        assert db.query_one("SELECT count(*) AS n FROM wine")["n"] == 0


def test_import_header_and_type_checks(frank, eric):
    r = post_csv(frank, frank.collection_id, "name,colour\nx,y\n")
    assert r.status_code == 400 and "missing column" in r.get_json()["error"]["fields"]["file"]
    r = post_csv(frank, frank.collection_id, HEADER)
    assert r.get_json()["error"]["fields"]["file"] == "The file has no rows to import."
    r = frank.client.post(f"/api/v1/collections/{frank.collection_id}/import", data="{}", content_type="application/json")
    assert r.status_code == 415
    r = frank.client.post(f"/api/v1/collections/{frank.collection_id}/import",
                          data={"file": (io.BytesIO((HEADER + "A,Red,,,,1,,,,\n").encode()), "cellar.csv")},
                          content_type="multipart/form-data")
    assert r.status_code == 201
    assert post_csv(eric, frank.collection_id, HEADER + "A,Red,,,,1,,,,\n").status_code == 404
    too_many = HEADER + "A,Red,,,,1,,,,\n" * 201
    assert "at most 200 rows" in post_csv(frank, frank.collection_id, too_many).get_json()["error"]["fields"]["file"]


def test_wishlist(frank, eric):
    base = f"/api/v1/collections/{frank.collection_id}/wishlist"
    r = frank.post(base, json={"wishName": "Opus One", "wishVint": 2019, "wishNotes": "Try for 50th birthday"})
    assert r.status_code == 201
    wish = r.get_json()
    assert wish["wishAddedByName"] == "Frank Delgado"
    wid = add_item(frank)["wineID"]
    from_catalog = frank.post(base, json={"wineId": wid}).get_json()
    assert from_catalog["wishName"] == "Château Margaux" and from_catalog["wishVint"] == 2010
    assert [w["wishName"] for w in frank.get(base).get_json()["wishlist"]] == ["Château Margaux", "Opus One"]
    assert frank.post(base, json={"wishNotes": "no name"}).status_code == 400
    assert frank.post(base, json={"wishName": "X", "price": 10}).status_code == 400
    r = frank.patch(f"/api/v1/wishlist/{wish['wishID']}", json={"wishNotes": "Done waiting"})
    assert r.get_json()["wishNotes"] == "Done waiting"
    assert eric.get(base).status_code == 404
    assert eric.patch(f"/api/v1/wishlist/{wish['wishID']}", json={"wishNotes": "x"}).status_code == 404
    assert eric.delete(f"/api/v1/wishlist/{wish['wishID']}").status_code == 404
    assert frank.delete(f"/api/v1/wishlist/{wish['wishID']}").status_code == 200
    assert len(frank.get(base).get_json()["wishlist"]) == 1
