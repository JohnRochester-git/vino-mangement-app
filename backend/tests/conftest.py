import pytest

from vino import create_app
from vino.config import Config


def make_config(tmp_path, **overrides):
    values = dict(
        flask_env="testing",
        db_backend="sqlite",
        sqlite_path=str(tmp_path / "test.db"),
        auto_migrate=True,
        barcode_provider="none",
    )
    values.update(overrides)
    return Config(**values)


class JSONClient:
    """Wraps Flask's test client so every write sends JSON."""

    def __init__(self, client):
        self.client = client

    def get(self, path, **kwargs):
        return self.client.get(path, **kwargs)

    def _send(self, method, path, json=None, **kwargs):
        kwargs.setdefault("content_type", "application/json")
        if json is not None:
            import json as _json
            kwargs["data"] = _json.dumps(json)
        return self.client.open(path, method=method, **kwargs)

    def post(self, path, json=None, **kwargs):
        return self._send("POST", path, json, **kwargs)

    def patch(self, path, json=None, **kwargs):
        return self._send("PATCH", path, json, **kwargs)

    def delete(self, path, json=None, **kwargs):
        return self._send("DELETE", path, json, **kwargs)


@pytest.fixture
def app(tmp_path):
    return create_app(make_config(tmp_path))


@pytest.fixture
def make_client(app):
    def factory():
        return JSONClient(app.test_client())
    return factory


@pytest.fixture
def client(make_client):
    return make_client()


_counter = [0]


def signup(client, email=None, password="correct horse", first="Frank", last="Delgado"):
    _counter[0] += 1
    email = email or f"user{_counter[0]}@example.com"
    resp = client.post("/api/v1/auth/signup", json={
        "userEmail": email, "password": password, "userFname": first, "userLname": last,
    })
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()


@pytest.fixture
def frank(make_client):
    c = make_client()
    data = signup(c, email="frank@example.com", first="Frank", last="Delgado")
    c.user = data["user"]
    c.collection_id = data["collections"][0]["collectionId"]
    return c


@pytest.fixture
def eric(make_client):
    c = make_client()
    data = signup(c, email="eric@example.com", first="Eric", last="Lindqvist")
    c.user = data["user"]
    c.collection_id = data["collections"][0]["collectionId"]
    return c
