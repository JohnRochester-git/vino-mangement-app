from .conftest import add_item, signup


def test_value_summary_and_gain_loss(frank):
    add_item(frank, itemQuantity=2, itemPurchasePrice=900)                         # $1,150 each, paid $900
    add_item(frank, itemQuantity=3, wine={"wineName": "Josh", "wineType": "Red", "wineValue": 22})  # no price paid
    add_item(frank, itemQuantity=4, wine={"wineName": "Mystery", "wineType": "White"}, itemPurchasePrice=10)  # no value
    v = frank.get(f"/api/v1/collections/{frank.collection_id}/value").get_json()
    assert v["bottleCount"] == 9 and v["notValuedBottleCount"] == 4
    assert v["totalValueCents"] == 2 * 115000 + 3 * 2200
    assert v["totalPurchaseCostCents"] == 2 * 90000 + 4 * 1000
    assert v["gainLossCents"] == 2 * (115000 - 90000)
    assert v["totalValueFormatted"] == "$2,366.00"
    assert [t["wineType"] for t in v["byType"]] == ["Red", "White"]
    assert v["byType"][1]["notValuedBottles"] == 4 and v["byType"][1]["valueCents"] == 0
    assert [b["wine"]["wineName"] for b in v["topBottles"]] == ["Château Margaux", "Josh"]
    assert frank.get("/api/v1/collections").get_json()["collections"][0]["collectionSumValueCents"] == v["totalValueCents"]


def test_empty_items_skipped_in_totals(frank):
    iid = add_item(frank, itemQuantity=1)["itemID"]
    frank.post(f"/api/v1/items/{iid}/consume", json={"quantity": 1})
    v = frank.get(f"/api/v1/collections/{frank.collection_id}/value").get_json()
    assert v["bottleCount"] == 0 and v["totalValueCents"] == 0


def test_item_value_overrides_and_history(frank):
    item = add_item(frank)
    iid, wid = item["itemID"], item["wineID"]
    r = frank.post(f"/api/v1/items/{iid}/value", json={"itemValue": "1300.00"}).get_json()
    assert r["currentValueCents"] == 130000 and r["currentValueSource"] == "item"
    frank.patch(f"/api/v1/wines/{wid}", json={"wineValue": 1175})
    hist = frank.get(f"/api/v1/items/{iid}/value-history").get_json()["history"]
    assert [(h["level"], h["valueCents"]) for h in hist] == [("catalog", 115000), ("item", 130000), ("catalog", 117500)]
    r = frank.post(f"/api/v1/items/{iid}/value", json={"itemValue": None}).get_json()
    assert r["currentValueCents"] == 117500 and r["currentValueSource"] == "wine"
    assert frank.post(f"/api/v1/items/{iid}/value", json={}).status_code == 400
    assert frank.post(f"/api/v1/items/{iid}/value", json={"itemValue": -5}).status_code == 400


def test_one_households_value_never_changes_anothers(frank, eric):
    wid = add_item(frank)["wineID"]
    eric_item = add_item(eric, wineId=wid, itemQuantity=2)
    frank_before = frank.get(f"/api/v1/collections/{frank.collection_id}/value").get_json()["totalValueCents"]
    eric.post(f"/api/v1/items/{eric_item['itemID']}/value", json={"itemValue": 5})
    assert frank.get(f"/api/v1/collections/{frank.collection_id}/value").get_json()["totalValueCents"] == frank_before
    assert eric.get(f"/api/v1/collections/{eric.collection_id}/value").get_json()["totalValueCents"] == 1000
    # Frank's history doesn't show Eric's private estimate.
    frank_item = frank.get(f"/api/v1/collections/{frank.collection_id}/items").get_json()["items"][0]
    hist = frank.get(f"/api/v1/items/{frank_item['itemID']}/value-history").get_json()["history"]
    assert all(h["level"] == "catalog" for h in hist)
    # And Eric can't touch Frank's values.
    assert eric.post(f"/api/v1/items/{frank_item['itemID']}/value", json={"itemValue": 1}).status_code == 404
    assert eric.get(f"/api/v1/items/{frank_item['itemID']}/value-history").status_code == 404
    assert eric.get(f"/api/v1/collections/{frank.collection_id}/value").status_code == 404
    assert eric.get(f"/api/v1/collections/{frank.collection_id}/stats").status_code == 404


def test_stats(frank):
    a = add_item(frank, itemQuantity=3, itemStoredAt="Rack A")
    add_item(frank, itemQuantity=1, wine={"wineName": "NV", "wineType": "Sparkling"}, itemStoredAt="Fridge")
    frank.post(f"/api/v1/items/{a['itemID']}/consume", json={"quantity": 1, "rating": 4})
    frank.post(f"/api/v1/items/{a['itemID']}/consume", json={"quantity": 1, "rating": 5})
    s = frank.get(f"/api/v1/collections/{frank.collection_id}/stats").get_json()
    assert s["bottleCount"] == 2 and s["itemCount"] == 2
    assert {x["label"]: x["bottles"] for x in s["byType"]} == {"Red": 1, "Sparkling": 1}
    assert {x["label"] for x in s["byVintageDecade"]} == {"2010s", "Non-vintage"}
    assert {x["label"] for x in s["byStorageLocation"]} == {"Rack A", "Fridge"}
    assert s["bottlesAddedLast30Days"] == 4 and s["bottlesOpenedLast30Days"] == 2
    assert s["averageRating"] == 4.5 and s["ratingCount"] == 2


def test_suggest_by_pairing(frank):
    add_item(frank, wine={"wineName": "Steak Red", "wineType": "Red", "pairings": ["Beef"]},
             itemDrinkFrom="2020-01-01", itemDrinkBy="2099-01-01")
    add_item(frank, wine={"wineName": "Young Red", "wineType": "Red", "pairings": ["Beef"]},
             itemDrinkFrom="2090-01-01", itemDrinkBy="2099-01-01")
    r = frank.get(f"/api/v1/collections/{frank.collection_id}/suggest?pairing=beef").get_json()
    assert [i["wine"]["wineName"] for i in r["items"]] == ["Steak Red"]
    assert frank.get(f"/api/v1/collections/{frank.collection_id}/suggest?pairing=Tacos").status_code == 400
