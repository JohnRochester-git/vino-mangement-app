from vino import create_app, db, demo_login
from vino.seed_demo import DEMO_WINES

from .conftest import JSONClient, make_config


def demo(client):
    resp = client.post("/api/v1/auth/demo")
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()


def test_providers_report_demo(client):
    assert client.get("/api/v1/auth/providers").get_json()["demo"] is True


def test_demo_signs_in_to_a_sample_cellar(client):
    resp = client.post("/api/v1/auth/demo")
    assert resp.status_code == 201
    cookie = resp.headers["Set-Cookie"]
    assert "HttpOnly" in cookie and "Max-Age=86400" in cookie  # one day
    data = resp.get_json()
    assert data["user"]["userEmail"].endswith("@demo.invalid")
    assert data["user"]["userFullname"] == "Demo Guest"

    collection_id = data["collections"][0]["collectionId"]
    items = client.get(f"/api/v1/collections/{collection_id}/items").get_json()["items"]
    assert len(items) == len(DEMO_WINES)
    assert sum(i["itemQuantity"] for i in items) == sum(q for _, _, q in DEMO_WINES)
    assert all(i["itemDrinkFrom"] for i in items)  # drinking windows estimated

    journal = client.get(f"/api/v1/collections/{collection_id}/consumptions").get_json()["consumptions"]
    assert len(journal) == len(demo_login.DEMO_JOURNAL)


def test_each_visitor_gets_their_own_cellar(app, make_client):
    a, b = make_client(), make_client()
    da, dbb = demo(a), demo(b)
    assert da["user"]["userID"] != dbb["user"]["userID"]
    ca, cb = da["collections"][0]["collectionId"], dbb["collections"][0]["collectionId"]
    # Drinking a bottle in one demo doesn't change the other.
    item = a.get(f"/api/v1/collections/{ca}/items").get_json()["items"][0]
    assert a.post(f"/api/v1/items/{item['itemID']}/consume", json={"quantity": 1}).status_code == 201
    assert b.get(f"/api/v1/collections/{ca}/items").status_code in (403, 404)
    before = {i["wine"]["wineName"]: i["itemQuantity"] for i in b.get(f"/api/v1/collections/{cb}/items").get_json()["items"]}
    assert before[item["wine"]["wineName"]] == item["itemQuantity"]


def test_demo_wines_are_shared_not_duplicated(app, make_client):
    for _ in range(3):
        demo(make_client())
    with app.app_context():
        count = db.query_one("SELECT count(*) AS n FROM wine")["n"]
    assert count == len(DEMO_WINES)


def test_demo_account_has_no_usable_password(client, make_client):
    address = demo(client)["user"]["userEmail"]
    resp = make_client().post("/api/v1/auth/login", json={"userEmail": address, "password": "anything123"})
    assert resp.status_code in (400, 401)


def test_old_demo_accounts_are_cleaned_up(app, make_client):
    old = demo(make_client())
    old_email = old["user"]["userEmail"]
    with app.app_context():
        db.execute("UPDATE user SET userCreatedAt = '2020-01-01T00:00:00Z' WHERE userEmail = ?", [old_email])
    demo(make_client())  # the next demo sign-in tidies up
    # (Check by email: SQLite can reuse a deleted user's ID for the new one.)
    with app.app_context():
        assert db.query_one("SELECT 1 AS x FROM user WHERE userEmail = ?", [old_email]) is None
        assert db.query_one("SELECT count(*) AS n FROM user")["n"] == 1
        assert db.query_one("SELECT count(*) AS n FROM consumption")["n"] == len(demo_login.DEMO_JOURNAL)
        assert db.query_one("SELECT count(*) AS n FROM inventory_item")["n"] == len(DEMO_WINES)
        assert db.query_one("SELECT count(*) AS n FROM wine")["n"] == len(DEMO_WINES)  # shared wines stay


def test_real_accounts_are_never_cleaned_up(app, make_client):
    from .conftest import signup
    real = make_client()
    data = signup(real, email="frank@example.com")
    with app.app_context():
        db.execute("UPDATE user SET userCreatedAt = '2020-01-01T00:00:00Z'")
    demo(make_client())
    assert real.get("/api/v1/auth/me").get_json()["user"]["userID"] == data["user"]["userID"]


def test_demo_rate_limit(client, monkeypatch):
    monkeypatch.setattr(demo_login, "MAX_DEMOS_PER_HOUR", 2)
    demo(client)
    demo(client)
    resp = client.post("/api/v1/auth/demo")
    assert resp.status_code == 429 and resp.get_json()["error"]["code"] == "demo_busy"


def test_demo_can_be_switched_off(tmp_path):
    app = create_app(make_config(tmp_path, demo_login=False))
    c = JSONClient(app.test_client())
    assert c.post("/api/v1/auth/demo").status_code == 404
    assert c.get("/api/v1/auth/providers").get_json()["demo"] is False


def test_demo_through_d1_bridge(tmp_path):
    """The live site runs on D1 through the Worker's bridge: sign-in, the
    sample cellar and the cleanup must all work through it too."""
    from vino.migrate import apply_migrations

    from .fake_bridge import FakeBridge

    path = str(tmp_path / "bridge.db")
    apply_migrations(path, log=lambda *_: None)
    bridge = FakeBridge(path).start()
    try:
        app = create_app(make_config(tmp_path, db_backend="d1", d1_bridge_url=bridge.url))
        first = JSONClient(app.test_client())
        data = demo(first)
        cid = data["collections"][0]["collectionId"]
        assert len(first.get(f"/api/v1/collections/{cid}/items").get_json()["items"]) == len(DEMO_WINES)
        with app.app_context():
            db.execute("UPDATE user SET userCreatedAt = '2020-01-01T00:00:00Z' WHERE userEmail = ?",
                       [data["user"]["userEmail"]])
        demo(JSONClient(app.test_client()))
        with app.app_context():
            assert db.query_one("SELECT 1 AS x FROM user WHERE userEmail = ?", [data["user"]["userEmail"]]) is None
    finally:
        bridge.stop()
