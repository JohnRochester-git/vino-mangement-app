"""End to end: start the app, migrate a fresh database, sign up, add a wine,
drink some, read the value. Runs against local SQLite and through the D1
bridge contract (using the fake bridge)."""

import pytest

from vino import create_app
from vino.migrate import apply_migrations

from .conftest import JSONClient, make_config
from .fake_bridge import FakeBridge


def run_flow(app):
    c = JSONClient(app.test_client())
    assert c.get("/health").get_data(as_text=True) == "OK"
    me = c.post("/api/v1/auth/signup", json={
        "userEmail": "smoke@example.com", "password": "smoke-test-pw", "userFname": "Smoke", "userLname": "Test"})
    assert me.status_code == 201
    cid = me.get_json()["collections"][0]["collectionId"]
    item = c.post(f"/api/v1/collections/{cid}/items", json={
        "itemQuantity": 3, "itemPurchasePrice": 20,
        "wine": {"wineName": "Josh Cellars Craftsman", "wineType": "Red", "wineVint": 2020, "wineValue": 22}})
    assert item.status_code == 201
    iid = item.get_json()["itemID"]
    assert c.post(f"/api/v1/items/{iid}/consume", json={"quantity": 1, "rating": 4}).status_code == 201
    assert c.post(f"/api/v1/items/{iid}/consume", json={"quantity": 5}).status_code == 409
    value = c.get(f"/api/v1/collections/{cid}/value").get_json()
    assert value["bottleCount"] == 2
    assert value["totalValueCents"] == 4400 and value["gainLossCents"] == 400


def test_smoke_sqlite(tmp_path):
    run_flow(create_app(make_config(tmp_path)))


def test_smoke_through_d1_bridge(tmp_path):
    path = str(tmp_path / "bridge.db")
    apply_migrations(path, log=lambda *_: None)
    bridge = FakeBridge(path).start()
    try:
        run_flow(create_app(make_config(tmp_path, db_backend="d1", d1_bridge_url=bridge.url)))
    finally:
        bridge.stop()
    assert any(p == "/batch" for p, _ in bridge.requests)


def test_seed_demo(tmp_path, monkeypatch, capsys):
    from vino import seed_demo
    monkeypatch.setenv("SQLITE_PATH", str(tmp_path / "demo.db"))
    monkeypatch.setenv("DB_BACKEND", "sqlite")
    monkeypatch.setenv("DEMO_PASSWORD", "demo-password")
    assert seed_demo.main() == 0
    out = capsys.readouterr().out
    assert "7 wines, 16 bottles, $3,869.00" in out and "demo-password" in out
    assert seed_demo.main() == 0  # second run changes nothing
    monkeypatch.setenv("DB_BACKEND", "d1")
    monkeypatch.setenv("D1_BRIDGE_URL", "http://d1.internal")
    assert seed_demo.main() == 1
