import json

from vino import create_app
from vino.services.barcode import OpenFoodFactsProvider

from .conftest import MARGAUX, add_item, make_config, signup

BARCODE = "089744000026"   # valid UPC-A check digit
EAN = "0089744000026"      # same code as EAN-13


def test_add_item_with_new_wine(frank):
    item = add_item(frank, itemPurchasePrice="900.50", itemStoredAt="Rack A, Row 3", itemAquiredDate="2024-05-01")
    assert item["itemQuantity"] == 2 and item["isLastBottle"] is False
    assert item["wine"]["wineName"] == "Château Margaux"
    assert item["wine"]["wineValueCents"] == 115000
    assert item["wine"]["wineValueFormatted"] == "$1,150.00"
    assert item["wine"]["pairings"] == ["Beef", "Lamb"]
    assert item["itemPurchasePriceCents"] == 90050
    assert item["gainLossPerBottleCents"] == 115000 - 90050
    assert item["itemDrinkWindowSource"] == "estimate"
    assert (item["itemDrinkFrom"], item["itemDrinkBy"]) == ("2013-01-01", "2022-12-31")
    assert item["drinkStatus"] == "pastPeak"


def test_add_item_with_existing_wine_and_user_window(frank):
    first = add_item(frank)
    item = add_item(frank, wineId=first["wineID"], itemQuantity=1, itemDrinkFrom="2020-01-01", itemDrinkBy="2040-12-31")
    assert item["wineID"] == first["wineID"]
    assert item["itemDrinkWindowSource"] == "user" and item["drinkStatus"] == "ready"
    assert item["isLastBottle"] is True


def test_add_item_needs_exactly_one_wine_source(frank):
    r = frank.post(f"/api/v1/collections/{frank.collection_id}/items", json={"itemQuantity": 1})
    assert r.status_code == 400 and "wineId" in r.get_json()["error"]["fields"]
    r = frank.post(f"/api/v1/collections/{frank.collection_id}/items",
                   json={"itemQuantity": 1, "wineId": 999})
    assert r.status_code == 400 and r.get_json()["error"]["fields"]["wineId"].startswith("No wine")


def test_barcode_lookup_and_add_by_barcode(frank, eric):
    assert frank.get(f"/api/v1/wines/barcode/{BARCODE}").get_json() == {"found": False}
    add_item(frank, wine={**MARGAUX, "wineBarcode": BARCODE})
    # Anyone's next scan finds it, in UPC or EAN form.
    found = eric.get(f"/api/v1/wines/barcode/{EAN}").get_json()
    assert found["found"] is True and found["source"] == "catalog"
    item = add_item(eric, wineId=found["wine"]["wineID"], itemQuantity=1)
    assert item["wine"]["wineBarcode"] == EAN
    # Adding the same barcode as a new wine is a conflict that names the existing one.
    r = eric.post(f"/api/v1/collections/{eric.collection_id}/items",
                  json={"itemQuantity": 1, "wine": {**MARGAUX, "wineBarcode": BARCODE}})
    assert r.status_code == 409 and "wine.wineBarcode" in r.get_json()["error"]["fields"]


def test_barcode_validation(frank):
    for bad, msg in [("12345", "8, 12, 13 or 14 digits"), ("08974400002x", "digits only"),
                     ("089744000027", "check digit")]:
        r = frank.get(f"/api/v1/wines/barcode/{bad}")
        assert r.status_code == 400 and msg in r.get_json()["error"]["fields"]["code"]


class _FakeResponse:
    def __init__(self, body):
        self.body = json.dumps(body).encode()

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_openfoodfacts_mapping():
    p = OpenFoodFactsProvider("test@example.com", opener=lambda req, timeout: _FakeResponse({
        "status": 1, "product": {"product_name": "Josh Cellars Cabernet Sauvignon 2020", "brands": "Josh Cellars, Deutsch",
                                 "categories_tags": ["en:beverages", "en:wines", "en:red-wines"]}}))
    assert p.lookup(BARCODE) == {"wineName": "Josh Cellars Cabernet Sauvignon 2020", "wineProducer": "Josh Cellars",
                                 "wineType": "Red", "wineVint": 2020}
    water = OpenFoodFactsProvider("x", opener=lambda req, timeout: _FakeResponse({
        "status": 1, "product": {"product_name": "Spring water", "categories_tags": ["en:waters", "en:wine-vinegars"]}}))
    assert water.lookup(BARCODE) is None


def test_provider_timeout_falls_back_to_not_found(tmp_path, monkeypatch):
    def timeout(req, timeout):
        raise TimeoutError("timed out")
    monkeypatch.setattr("urllib.request.urlopen", timeout)
    app = create_app(make_config(tmp_path, barcode_provider="openfoodfacts"))
    from .conftest import JSONClient
    c = JSONClient(app.test_client())
    signup(c)
    r = c.get(f"/api/v1/wines/barcode/{BARCODE}")
    assert r.status_code == 200 and r.get_json() == {"found": False}


def test_provider_found_is_returned_unsaved(tmp_path, monkeypatch):
    monkeypatch.setattr("urllib.request.urlopen", lambda req, timeout: _FakeResponse({
        "status": 1, "product": {"product_name": "Some Rosé", "categories_tags": ["en:rose-wines"]}}))
    app = create_app(make_config(tmp_path, barcode_provider="openfoodfacts"))
    from .conftest import JSONClient
    c = JSONClient(app.test_client())
    signup(c)
    body = c.get(f"/api/v1/wines/barcode/{BARCODE}").get_json()
    assert body["found"] and body["source"] == "provider"
    assert body["wine"]["wineID"] is None and body["wine"]["wineType"] == "Rosé"
    assert body["wine"]["wineBarcode"] == EAN


def test_wine_search_and_reference_data(frank):
    add_item(frank)
    add_item(frank, wine={"wineName": "Barolo, Falletto", "wineType": "Red", "wineRegion": "Piedmont, Italy"})
    names = [w["wineName"] for w in frank.get("/api/v1/wines?search=piedmont").get_json()["wines"]]
    assert names == ["Barolo, Falletto"]
    assert frank.get("/api/v1/wines?search=%25").get_json()["wines"] == []
    assert any(b["blendStyle"] == "Nebbiolo" for b in frank.get("/api/v1/blends").get_json()["blends"])
    assert any(p["pairingName"] == "Beef" for p in frank.get("/api/v1/pairings").get_json()["pairings"])
    wid = add_item(frank)["wineID"]
    assert [p["pairingName"] for p in frank.get(f"/api/v1/wines/{wid}/pairings").get_json()["pairings"]] == ["Beef", "Lamb"]


def test_wine_edit_rules(frank, eric):
    wid = add_item(frank)["wineID"]
    # Creator can edit while only their household holds it.
    r = frank.patch(f"/api/v1/wines/{wid}", json={"wineProducer": "Château Margaux", "wineValue": 1200})
    assert r.status_code == 200 and r.get_json()["wineValueCents"] == 120000
    # Someone else can't edit it at all.
    assert eric.patch(f"/api/v1/wines/{wid}", json={"wineName": "Mine"}).status_code == 409
    # Once another household holds it, not even the creator can.
    add_item(eric, wineId=wid, itemQuantity=1)
    r = frank.patch(f"/api/v1/wines/{wid}", json={"wineName": "Renamed"})
    assert r.status_code == 409 and r.get_json()["error"]["code"] == "wine_in_use"
    assert frank.get(f"/api/v1/wines/{wid}").get_json()["wineName"] == "Château Margaux"


def test_wine_validation_messages(frank):
    bad = {"wineName": "", "wineType": "Beer", "wineVint": 1700, "wineValue": -1, "wineProducer": "x" * 121,
           "wineDescription": "x" * 2001, "wineBarcode": "123", "blendID": 9999, "pairings": ["Tacos"], "colour": "red"}
    r = frank.post("/api/v1/wines", json=bad)
    fields = r.get_json()["error"]["fields"]
    assert r.status_code == 400
    assert fields["wineName"] == "Wine name is required."
    assert fields["wineType"].startswith("Wine type must be one of")
    assert fields["wineVint"].startswith("Vintage must be between 1800 and")
    assert fields["wineValue"] == "Amount can't be negative."
    assert fields["wineProducer"] == "Producer must be at most 120 characters."
    assert fields["wineDescription"] == "Description must be at most 2,000 characters."
    assert fields["wineBarcode"] == "Barcode must be 8, 12, 13 or 14 digits long."
    assert fields["colour"] == "Unknown field 'colour'."
    r = frank.post("/api/v1/wines", json={"wineName": "X", "wineType": "red", "blendID": 9999})
    assert r.get_json()["error"]["fields"]["blendID"].startswith("Unknown blend")
    r = frank.post("/api/v1/wines", json={"wineName": "X", "wineType": "Red", "pairings": ["Tacos"]})
    assert r.get_json()["error"]["fields"]["pairings"].startswith("Unknown pairing")
    r = frank.post("/api/v1/wines", json={"wineName": "X", "wineType": "Red", "wineValue": 10_000_001})
    assert r.get_json()["error"]["fields"]["wineValue"] == "Amount must be at most $10,000,000."
    r = frank.post("/api/v1/wines", json={"wineName": "X", "wineType": "Red", "wineValue": "1.234"})
    assert r.get_json()["error"]["fields"]["wineValue"] == "Amount can have at most 2 decimal places."


def test_wine_text_is_cleaned(frank):
    r = frank.post("/api/v1/wines", json={"wineName": "  Rosé\x00 du​ Jour ", "wineType": "rose", "wineVint": None})
    assert r.status_code == 201
    assert r.get_json()["wineName"] == "Rosé du Jour" and r.get_json()["wineType"] == "Rosé"


def test_item_validation_messages(frank):
    url = f"/api/v1/collections/{frank.collection_id}/items"
    r = frank.post(url, json={"wine": MARGAUX, "itemQuantity": 0, "itemAquiredDate": "2999-01-01",
                              "itemDrinkFrom": "2030-13-01", "itemDrinkBy": "soon", "itemPurchasePrice": "abc"})
    f = r.get_json()["error"]["fields"]
    assert f["itemQuantity"] == "Quantity must be between 1 and 9,999."
    assert f["itemAquiredDate"] == "Date can't be in the future."
    assert f["itemDrinkFrom"] == "That date doesn't exist."
    assert f["itemDrinkBy"] == "Use the date format YYYY-MM-DD."
    assert f["itemPurchasePrice"] == "Enter an amount in dollars, like 24.99."
    r = frank.post(url, json={"wine": MARGAUX, "itemQuantity": 10000})
    assert r.get_json()["error"]["fields"]["itemQuantity"] == "Quantity must be between 1 and 9,999."
    r = frank.post(url, json={"wine": MARGAUX, "itemQuantity": 1.5})
    assert r.get_json()["error"]["fields"]["itemQuantity"] == "Quantity must be a whole number."
    r = frank.post(url, json={"wine": MARGAUX, "itemQuantity": 1, "itemDrinkFrom": "2030-01-01", "itemDrinkBy": "2029-01-01"})
    assert r.get_json()["error"]["fields"]["itemDrinkFrom"].startswith("Drink-from date must be on or before")
    r = frank.post(url, json={"wine": {**MARGAUX, "wineVint": 3000}, "itemQuantity": 1})
    assert r.get_json()["error"]["fields"]["wine.wineVint"].startswith("Vintage must be between")
    r = frank.post(url, json=["not", "an", "object"])
    assert r.status_code == 400 and r.get_json()["error"]["code"] == "bad_request"


def test_list_items_filters_and_sorting(frank):
    add_item(frank, itemStoredAt="Rack A")
    add_item(frank, wine={"wineName": "Chablis Grand Cru", "wineType": "White", "wineVint": 2019,
                          "wineRegion": "Les Clos, Burgundy, France", "wineValue": 120}, itemStoredAt="Kitchen fridge")
    add_item(frank, wine={"wineName": "Josh Cellars Craftsman", "wineType": "Red", "wineVint": 2020, "wineValue": 22},
             itemDrinkFrom="2020-01-01", itemDrinkBy="2099-01-01")
    base = f"/api/v1/collections/{frank.collection_id}/items"
    names = lambda q: [i["wine"]["wineName"] for i in frank.get(base + q).get_json()["items"]]
    assert names("") == ["Chablis Grand Cru", "Château Margaux", "Josh Cellars Craftsman"]
    assert names("?type=White") == ["Chablis Grand Cru"]
    assert names("?region=burgundy") == ["Chablis Grand Cru"]
    assert names("?storedAt=fridge") == ["Chablis Grand Cru"]
    assert names("?search=josh") == ["Josh Cellars Craftsman"]
    assert names("?drinkStatus=ready") == ["Josh Cellars Craftsman"]
    assert names("?sort=value&order=desc") == ["Château Margaux", "Chablis Grand Cru", "Josh Cellars Craftsman"]
    assert names("?sort=vintage") == ["Château Margaux", "Chablis Grand Cru", "Josh Cellars Craftsman"]
    r = frank.get(base + "?sort=price&drinkStatus=old&type=Beer&colour=red")
    assert r.status_code == 400 and "colour" in r.get_json()["error"]["fields"]
    r = frank.get(base + "?sort=price")
    assert r.get_json()["error"]["fields"]["sort"].startswith("sort must be one of")


def test_empty_items_hidden_unless_requested(app, frank):
    item = add_item(frank)
    frank.patch(f"/api/v1/items/{item['itemID']}", json={"itemQuantity": 0})
    base = f"/api/v1/collections/{frank.collection_id}/items"
    assert frank.get(base).get_json()["count"] == 0
    assert frank.get(base + "?includeEmpty=true").get_json()["count"] == 1


def test_patch_item_window_and_reestimate(frank):
    item = add_item(frank, wine={"wineName": "NV Brut", "wineType": "Sparkling"}, itemAquiredDate="2024-06-01")
    iid = item["itemID"]
    assert (item["itemDrinkFrom"], item["itemDrinkBy"]) == ("2025-06-01", "2029-06-01")
    r = frank.patch(f"/api/v1/items/{iid}", json={"itemAquiredDate": "2025-01-15"}).get_json()
    assert (r["itemDrinkFrom"], r["itemDrinkBy"], r["itemDrinkWindowSource"]) == ("2026-01-15", "2030-01-15", "estimate")
    r = frank.patch(f"/api/v1/items/{iid}", json={"itemDrinkBy": "2027-01-01"}).get_json()
    assert (r["itemDrinkFrom"], r["itemDrinkBy"], r["itemDrinkWindowSource"]) == ("2026-01-15", "2027-01-01", "user")
    r = frank.patch(f"/api/v1/items/{iid}", json={"itemDrinkFrom": "2028-01-01"})
    assert r.status_code == 400
    r = frank.patch(f"/api/v1/items/{iid}", json={"itemDrinkFrom": None, "itemDrinkBy": None}).get_json()
    assert r["itemDrinkWindowSource"] == "estimate" and r["itemDrinkBy"] == "2030-01-15"
    r = frank.patch(f"/api/v1/items/{iid}", json={"itemQuantity": None})
    assert r.status_code == 400


def test_items_isolated_between_households(frank, eric):
    item = add_item(frank)
    iid = item["itemID"]
    assert eric.get(f"/api/v1/items/{iid}").status_code == 404
    assert eric.patch(f"/api/v1/items/{iid}", json={"itemQuantity": 9}).status_code == 404
    assert eric.delete(f"/api/v1/items/{iid}").status_code == 404
    assert eric.get(f"/api/v1/collections/{frank.collection_id}/items").status_code == 404
    assert eric.post(f"/api/v1/collections/{frank.collection_id}/items",
                     json={"wineId": item["wineID"], "itemQuantity": 1}).status_code == 404
    assert frank.get(f"/api/v1/items/{iid}").get_json()["itemQuantity"] == 2


def test_delete_item(frank):
    iid = add_item(frank)["itemID"]
    assert frank.delete(f"/api/v1/items/{iid}").status_code == 200
    assert frank.get(f"/api/v1/items/{iid}").status_code == 404
