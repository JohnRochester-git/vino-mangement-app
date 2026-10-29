from vino import db

from .conftest import add_item, signup


def qty(client, item_id):
    return client.get(f"/api/v1/items/{item_id}").get_json()["itemQuantity"]


def journal_count(app):
    with app.app_context():
        return db.query_one("SELECT count(*) AS n FROM consumption")["n"]


def test_consume_exact_remaining_then_one_more_is_atomic(app, frank):
    item = add_item(frank, itemQuantity=2)
    iid = item["itemID"]
    r = frank.post(f"/api/v1/items/{iid}/consume", json={"quantity": 2, "notes": "Anniversary", "rating": 4.5})
    assert r.status_code == 201
    body = r.get_json()
    assert body["item"]["itemQuantity"] == 0
    assert body["consumption"]["consumeRating"] == 4.5
    assert body["consumption"]["consumedByName"] == "Frank Delgado"
    assert journal_count(app) == 1

    r = frank.post(f"/api/v1/items/{iid}/consume", json={"quantity": 1})
    assert r.status_code == 409 and r.get_json()["error"]["code"] == "not_enough_bottles"
    assert qty(frank, iid) == 0
    assert journal_count(app) == 1  # no consumption row created
    # The finished item and its notes survive.
    assert frank.get(f"/api/v1/items/{iid}").status_code == 200


def test_consume_too_many_leaves_everything_unchanged(app, frank):
    iid = add_item(frank, itemQuantity=3)["itemID"]
    r = frank.post(f"/api/v1/items/{iid}/consume", json={"quantity": 4})
    assert r.status_code == 409
    assert qty(frank, iid) == 3 and journal_count(app) == 0


def test_consume_validation(frank):
    iid = add_item(frank)["itemID"]
    url = f"/api/v1/items/{iid}/consume"
    f = frank.post(url, json={"quantity": 0, "rating": 4.3, "notes": "x" * 2001, "consumedAt": "2999-01-01"}).get_json()["error"]["fields"]
    assert f["quantity"] == "Quantity must be between 1 and 9,999."
    assert f["rating"] == "Rating must be from 1 to 5 in half-star steps."
    assert f["notes"] == "Notes must be at most 2,000 characters."
    assert f["consumedAt"] == "This can't be in the future."
    assert frank.post(url, json={"quantity": 1, "rating": 0.5}).status_code == 400
    assert frank.post(url, json={"quantity": 1, "rating": True}).status_code == 400
    r = frank.post(url, json={"quantity": 1, "consumedAt": "2026-01-02"})
    assert r.get_json()["consumption"]["consumeTime"] == "2026-01-02T12:00:00Z"


def test_delete_consumption_restores_bottles(frank):
    iid = add_item(frank, itemQuantity=3)["itemID"]
    cid = frank.post(f"/api/v1/items/{iid}/consume", json={"quantity": 2}).get_json()["consumption"]["consumeID"]
    assert qty(frank, iid) == 1
    r = frank.delete(f"/api/v1/consumptions/{cid}")
    assert r.status_code == 200 and r.get_json()["item"]["itemQuantity"] == 3
    assert frank.delete(f"/api/v1/consumptions/{cid}").status_code == 404


def test_edit_consumption_quantity_adjusts_count(frank):
    iid = add_item(frank, itemQuantity=5)["itemID"]
    cid = frank.post(f"/api/v1/items/{iid}/consume", json={"quantity": 2}).get_json()["consumption"]["consumeID"]
    assert qty(frank, iid) == 3
    r = frank.patch(f"/api/v1/consumptions/{cid}", json={"quantity": 4, "notes": "Big party", "rating": 3})
    assert r.status_code == 200 and r.get_json()["item"]["itemQuantity"] == 1
    assert r.get_json()["consumption"]["consumeNotes"] == "Big party"
    frank.patch(f"/api/v1/consumptions/{cid}", json={"quantity": 1})
    assert qty(frank, iid) == 4
    r = frank.patch(f"/api/v1/consumptions/{cid}", json={"quantity": 6})  # needs 5 more, only 4 left
    assert r.status_code == 409
    assert qty(frank, iid) == 4
    assert frank.get(f"/api/v1/collections/{frank.collection_id}/consumptions").get_json()["consumptions"][0]["consumeQuantity"] == 1


def test_journal_newest_first(frank):
    iid = add_item(frank, itemQuantity=5)["itemID"]
    frank.post(f"/api/v1/items/{iid}/consume", json={"quantity": 1, "consumedAt": "2025-01-01", "notes": "old"})
    frank.post(f"/api/v1/items/{iid}/consume", json={"quantity": 1, "notes": "new"})
    entries = frank.get(f"/api/v1/collections/{frank.collection_id}/consumptions").get_json()["consumptions"]
    assert [e["consumeNotes"] for e in entries] == ["new", "old"]
    assert entries[0]["wineName"] == "Château Margaux"


def test_consumptions_isolated(frank, eric):
    iid = add_item(frank)["itemID"]
    cid = frank.post(f"/api/v1/items/{iid}/consume", json={"quantity": 1}).get_json()["consumption"]["consumeID"]
    assert eric.post(f"/api/v1/items/{iid}/consume", json={"quantity": 1}).status_code == 404
    assert eric.get(f"/api/v1/collections/{frank.collection_id}/consumptions").status_code == 404
    assert eric.patch(f"/api/v1/consumptions/{cid}", json={"notes": "mine"}).status_code == 404
    assert eric.delete(f"/api/v1/consumptions/{cid}").status_code == 404
    assert qty(frank, iid) == 1


def test_household_member_can_consume(frank, make_client):
    maria = make_client()
    signup(maria, email="maria@example.com", first="Maria")
    frank.post(f"/api/v1/collections/{frank.collection_id}/members", json={"userEmail": "maria@example.com"})
    iid = add_item(frank)["itemID"]
    r = maria.post(f"/api/v1/items/{iid}/consume", json={"quantity": 1, "rating": 5})
    assert r.status_code == 201 and r.get_json()["consumption"]["consumedByName"] == "Maria Delgado"


def test_ready_list_groups(frank):
    base = {"wine": {"wineName": "W", "wineType": "Red"}}
    add_item(frank, **base, itemDrinkFrom="2020-01-01", itemDrinkBy="2099-01-01")   # ready
    add_item(frank, **base, itemDrinkFrom="2020-01-01", itemDrinkBy="2021-01-01")   # pastPeak
    add_item(frank, **base, itemDrinkFrom="2090-01-01", itemDrinkBy="2099-01-01")   # tooYoung
    from vino.util import today
    from datetime import timedelta
    soon = (today() + timedelta(days=30)).isoformat()
    sooner = (today() + timedelta(days=10)).isoformat()
    add_item(frank, **base, itemDrinkFrom="2020-01-01", itemDrinkBy=soon)
    add_item(frank, **base, itemDrinkFrom="2020-01-01", itemDrinkBy=sooner)
    body = frank.get(f"/api/v1/collections/{frank.collection_id}/ready").get_json()
    assert [i["itemDrinkBy"] for i in body["drinkSoon"]] == [sooner, soon]
    assert len(body["ready"]) == 1 and len(body["pastPeak"]) == 1
    body = frank.get(f"/api/v1/collections/{frank.collection_id}/ready?soonDays=5").get_json()
    assert len(body["drinkSoon"]) == 0 and len(body["ready"]) == 3
    assert frank.get(f"/api/v1/collections/{frank.collection_id}/ready?soonDays=-1").status_code == 400
