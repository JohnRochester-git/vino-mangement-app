import sqlite3

import pytest

from vino import create_app, db
from vino.config import Config
from vino.db import D1BridgeAdapter, DatabaseUnavailable, IntegrityError
from vino.migrate import apply_migrations, split_statements

from .conftest import make_config
from .fake_bridge import FakeBridge


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.get_data(as_text=True) == "OK"


def test_migrations_apply_once(tmp_path):
    path = str(tmp_path / "m.db")
    first = apply_migrations(path, log=lambda *_: None)
    assert first[:2] == ["0001_initial_schema.sql", "0002_seed_reference_data.sql"]
    assert apply_migrations(path, log=lambda *_: None) == []
    conn = sqlite3.connect(path)
    assert conn.execute("SELECT count(*) FROM blends").fetchone()[0] > 10
    assert conn.execute("SELECT count(*) FROM d1_migrations").fetchone()[0] == len(first)


def test_split_statements_rejects_incomplete():
    assert split_statements("-- c\nSELECT 1;\nSELECT 2;\n") == ["-- c\nSELECT 1;", "SELECT 2;"]
    with pytest.raises(ValueError):
        split_statements("SELECT 1;\nSELECT 2")


def test_sqlite_foreign_keys_on(app):
    with app.app_context():
        with pytest.raises(IntegrityError):
            db.execute("INSERT INTO collection (collectionName, userID) VALUES ('x', 999)")


def test_sqlite_batch_is_all_or_nothing(app):
    with app.app_context():
        with pytest.raises(IntegrityError):
            db.batch([
                ("INSERT INTO pairings (pairingName) VALUES (?)", ["Tacos"]),
                ("INSERT INTO pairings (pairingName) VALUES (?)", ["Beef"]),  # duplicate
            ])
        assert db.query_one("SELECT * FROM pairings WHERE pairingName = 'Tacos'") is None


def test_sqlite_execute_reports_changes(app):
    with app.app_context():
        r = db.execute("INSERT INTO pairings (pairingName) VALUES (?)", ["Tacos"])
        assert r.changes == 1 and r.last_row_id
        r = db.execute("UPDATE pairings SET pairingName = ? WHERE pairingID = ?", ["Tapas", r.last_row_id])
        assert r.changes == 1


@pytest.fixture
def bridge(tmp_path):
    path = str(tmp_path / "d1.db")
    apply_migrations(path, log=lambda *_: None)
    b = FakeBridge(path).start()
    yield b
    b.stop()


@pytest.fixture
def d1_app(bridge, tmp_path):
    return create_app(make_config(tmp_path, db_backend="d1", d1_bridge_url=bridge.url))


def test_d1_query_and_execute(d1_app, bridge):
    with d1_app.app_context():
        r = db.execute("INSERT INTO pairings (pairingName) VALUES (?)", ["Tacos"])
        assert r.changes == 1 and r.last_row_id
        row = db.query_one("SELECT pairingName FROM pairings WHERE pairingID = ?", [r.last_row_id])
        assert row == {"pairingName": "Tacos"}
    assert bridge.requests[0] == ("/query", {"sql": "INSERT INTO pairings (pairingName) VALUES (?)", "params": ["Tacos"]})


def test_d1_batch_rolls_back_on_error(d1_app, bridge):
    with d1_app.app_context():
        with pytest.raises(IntegrityError):
            db.batch([
                ("INSERT INTO pairings (pairingName) VALUES (?)", ["Tacos"]),
                ("INSERT INTO pairings (pairingName) VALUES (?)", ["Beef"]),
            ])
        assert db.query_one("SELECT * FROM pairings WHERE pairingName = 'Tacos'") is None
        results = db.batch([
            ("INSERT INTO pairings (pairingName) VALUES (?)", ["Tacos"]),
            ("SELECT count(*) AS n FROM pairings WHERE pairingName = ?", ["Tacos"]),
        ])
        assert results[1].rows == [{"n": 1}]
    assert bridge.requests[-1][0] == "/batch"


def test_d1_booleans_sent_as_integers(d1_app, bridge):
    with d1_app.app_context():
        db.query("SELECT ? AS t", [True])
    assert bridge.requests[-1][1]["params"] == [1]


def test_d1_bridge_server_error_is_unavailable(d1_app, bridge):
    bridge.fail_next = 500
    with d1_app.app_context():
        with pytest.raises(DatabaseUnavailable):
            db.query("SELECT 1")


def test_d1_bridge_unreachable(tmp_path):
    adapter = D1BridgeAdapter("http://127.0.0.1:9", timeout=1)
    with pytest.raises(DatabaseUnavailable):
        adapter.run("SELECT 1", [])


def test_d1_bridge_timeout():
    def slow_opener(req, timeout):
        raise TimeoutError("timed out")
    adapter = D1BridgeAdapter("http://d1.internal", opener=slow_opener)
    with pytest.raises(DatabaseUnavailable):
        adapter.batch([("SELECT 1", [])])


def test_d1_never_auto_migrates(tmp_path, bridge):
    path = tmp_path / "should-not-exist.db"
    create_app(make_config(tmp_path, db_backend="d1", d1_bridge_url=bridge.url, sqlite_path=str(path)))
    assert not path.exists()


def test_config_requires_bridge_url():
    with pytest.raises(ValueError):
        Config(db_backend="d1").validate()


def test_json_errors(client):
    resp = client.get("/api/v1/nope")
    assert resp.status_code == 404
    assert resp.get_json()["error"]["code"] == "not_found"
    resp = client.client.post("/api/v1/auth/login", data="x=1", content_type="application/x-www-form-urlencoded")
    assert resp.status_code == 415
