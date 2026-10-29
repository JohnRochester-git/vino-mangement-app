from .conftest import signup


def test_create_list_rename_collection(frank):
    resp = frank.post("/api/v1/collections", json={"collectionName": "Beach House"})
    assert resp.status_code == 201
    new = resp.get_json()
    assert new["memberRole"] == "owner" and new["collectionSumValueCents"] == 0
    names = [c["collectionName"] for c in frank.get("/api/v1/collections").get_json()["collections"]]
    assert names == ["My Cellar", "Beach House"]
    resp = frank.patch(f"/api/v1/collections/{new['collectionId']}", json={"collectionName": "Lake House"})
    assert resp.get_json()["collectionName"] == "Lake House"


def test_collection_name_validation(frank):
    resp = frank.post("/api/v1/collections", json={"collectionName": ""})
    assert resp.status_code == 400
    assert resp.get_json()["error"]["fields"]["collectionName"] == "Collection name is required."


def test_other_household_gets_404(frank, eric):
    cid = frank.collection_id
    assert eric.get(f"/api/v1/collections/{cid}").status_code == 404
    assert eric.patch(f"/api/v1/collections/{cid}", json={"collectionName": "Mine"}).status_code == 404
    assert eric.delete(f"/api/v1/collections/{cid}").status_code == 404
    assert eric.get(f"/api/v1/collections/{cid}/members").status_code == 404
    assert eric.post(f"/api/v1/collections/{cid}/members", json={"userEmail": "eric@example.com"}).status_code == 404


def test_requires_login(client):
    assert client.get("/api/v1/collections").status_code == 401


def test_household_sharing(frank, make_client):
    maria = make_client()
    signup(maria, email="maria@example.com", first="Maria")
    cid = frank.collection_id
    resp = frank.post(f"/api/v1/collections/{cid}/members", json={"userEmail": "Maria@example.com"})
    assert resp.status_code == 201 and resp.get_json()["memberRole"] == "member"
    assert frank.post(f"/api/v1/collections/{cid}/members", json={"userEmail": "maria@example.com"}).status_code == 409
    assert frank.post(f"/api/v1/collections/{cid}/members", json={"userEmail": "ghost@example.com"}).status_code == 404

    # Maria sees and can rename the shared collection...
    assert maria.get(f"/api/v1/collections/{cid}").get_json()["memberRole"] == "member"
    assert maria.patch(f"/api/v1/collections/{cid}", json={"collectionName": "Delgado Cellar"}).status_code == 200
    members = maria.get(f"/api/v1/collections/{cid}/members").get_json()["members"]
    assert [m["memberRole"] for m in members] == ["owner", "member"]
    # ...but can't do owner-only actions.
    assert maria.delete(f"/api/v1/collections/{cid}").status_code == 403
    assert maria.post(f"/api/v1/collections/{cid}/members", json={"userEmail": "frank@example.com"}).status_code == 403
    assert maria.delete(f"/api/v1/collections/{cid}/members/{frank.user['userID']}").status_code == 403

    # Owner can't remove themselves; can remove Maria.
    assert frank.delete(f"/api/v1/collections/{cid}/members/{frank.user['userID']}").status_code == 409
    maria_id = members[1]["userID"]
    assert frank.delete(f"/api/v1/collections/{cid}/members/{maria_id}").status_code == 200
    assert maria.get(f"/api/v1/collections/{cid}").status_code == 404


def test_owner_deletes_collection(frank):
    cid = frank.collection_id
    assert frank.delete(f"/api/v1/collections/{cid}").status_code == 200
    assert frank.get(f"/api/v1/collections/{cid}").status_code == 404
