from vino import create_app
from vino.auth import LOGIN_FAILED_MESSAGE

from .conftest import make_config, signup


def test_signup_creates_user_collection_and_session(client):
    data = signup(client, email="Frank@Example.com ")
    assert data["user"]["userEmail"] == "frank@example.com"
    assert data["user"]["userFullname"] == "Frank Delgado"
    assert "userPasshash" not in data["user"]
    [col] = data["collections"]
    assert col["collectionName"] == "My Cellar" and col["memberRole"] == "owner"
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.get_json()["user"]["userEmail"] == "frank@example.com"


def test_session_cookie_flags(client):
    resp = client.post("/api/v1/auth/signup", json={
        "userEmail": "a@example.com", "password": "password1", "userFname": "A", "userLname": "B"})
    cookie = resp.headers["Set-Cookie"]
    assert "HttpOnly" in cookie and "SameSite=Lax" in cookie and "Secure" not in cookie


def test_secure_cookie_when_configured(tmp_path):
    app = create_app(make_config(tmp_path, cookie_secure=True))
    resp = app.test_client().post("/api/v1/auth/signup", json={
        "userEmail": "a@example.com", "password": "password1", "userFname": "A", "userLname": "B"})
    assert "Secure" in resp.headers["Set-Cookie"]


def test_password_is_hashed(app, client):
    signup(client, email="a@example.com", password="password1")
    from vino import db
    with app.app_context():
        row = db.query_one("SELECT userPasshash FROM user")
    assert "password1" not in row["userPasshash"]


def test_duplicate_email_409(client, make_client):
    signup(client, email="frank@example.com")
    resp = make_client().post("/api/v1/auth/signup", json={
        "userEmail": "FRANK@example.com", "password": "password1", "userFname": "F", "userLname": "D"})
    assert resp.status_code == 409
    assert resp.get_json()["error"]["fields"]["userEmail"]


def test_signup_validation(client):
    resp = client.post("/api/v1/auth/signup", json={
        "userEmail": "not-an-email", "password": "short", "userFname": "  ", "userLname": "x" * 51, "extra": 1})
    assert resp.status_code == 400
    fields = resp.get_json()["error"]["fields"]
    assert fields["userEmail"] == "Enter a valid email address."
    assert fields["password"] == "Password must be at least 8 characters."
    assert fields["userFname"] == "First name is required."
    assert fields["userLname"] == "Last name must be at most 50 characters."
    assert fields["extra"] == "Unknown field 'extra'."
    resp = client.post("/api/v1/auth/signup", json={
        "userEmail": "a" * 250 + "@x.com", "password": "password1", "userFname": "A", "userLname": "B"})
    assert resp.get_json()["error"]["fields"]["userEmail"] == "Email must be at most 254 characters."


def test_login_logout(client, make_client):
    signup(client, email="frank@example.com", password="password1")
    c = make_client()
    assert c.get("/api/v1/auth/me").status_code == 401
    resp = c.post("/api/v1/auth/login", json={"userEmail": "frank@example.com", "password": "password1"})
    assert resp.status_code == 200
    assert resp.get_json()["collections"][0]["collectionName"] == "My Cellar"
    assert c.get("/api/v1/auth/me").status_code == 200
    assert c.post("/api/v1/auth/logout").status_code == 200
    assert c.get("/api/v1/auth/me").status_code == 401


def test_logout_invalidates_session_server_side(client):
    signup(client, email="frank@example.com")
    cookie = client.client.get_cookie("vino_session").value
    client.post("/api/v1/auth/logout")
    client.client.set_cookie("vino_session", cookie)
    assert client.get("/api/v1/auth/me").status_code == 401


def test_wrong_password_and_unknown_email_same_message(client, make_client):
    signup(client, email="frank@example.com", password="password1")
    c = make_client()
    a = c.post("/api/v1/auth/login", json={"userEmail": "frank@example.com", "password": "wrong-pass"})
    b = c.post("/api/v1/auth/login", json={"userEmail": "nobody@example.com", "password": "wrong-pass"})
    assert a.status_code == b.status_code == 401
    assert a.get_json() == b.get_json()
    assert a.get_json()["error"]["message"] == LOGIN_FAILED_MESSAGE


def test_lockout_after_five_failures(client, make_client):
    signup(client, email="frank@example.com", password="password1")
    c = make_client()
    for _ in range(5):
        assert c.post("/api/v1/auth/login", json={"userEmail": "frank@example.com", "password": "nope-nope"}).status_code == 401
    resp = c.post("/api/v1/auth/login", json={"userEmail": "frank@example.com", "password": "password1"})
    assert resp.status_code == 429
    # Other accounts aren't affected.
    signup(make_client(), email="maria@example.com", password="password1")
    assert c.post("/api/v1/auth/login", json={"userEmail": "maria@example.com", "password": "password1"}).status_code == 200


def test_lockout_expires(app, client, make_client):
    signup(client, email="frank@example.com", password="password1")
    c = make_client()
    for _ in range(5):
        c.post("/api/v1/auth/login", json={"userEmail": "frank@example.com", "password": "nope-nope"})
    from vino import db
    from vino.util import iso_ago
    with app.app_context():
        db.execute("UPDATE login_attempt SET attemptAt = ?", [iso_ago(minutes=6)])
    assert c.post("/api/v1/auth/login", json={"userEmail": "frank@example.com", "password": "password1"}).status_code == 200


def test_expired_sessions_rejected_and_cleaned(app, client, make_client):
    signup(client, email="frank@example.com", password="password1")
    from vino import db
    with app.app_context():
        db.execute("UPDATE session SET sessionExpiresAt = '2000-01-01T00:00:00Z'")
    assert client.get("/api/v1/auth/me").status_code == 401
    make_client().post("/api/v1/auth/login", json={"userEmail": "frank@example.com", "password": "password1"})
    with app.app_context():
        assert db.query_one("SELECT count(*) AS n FROM session")["n"] == 1


def test_writes_require_json(client):
    resp = client.client.post("/api/v1/auth/logout")
    assert resp.status_code == 415


def test_cors_only_for_allowed_origins(tmp_path):
    app = create_app(make_config(tmp_path, allowed_origins=["http://localhost:5500"]))
    c = app.test_client()
    ok = c.get("/api/v1", headers={"Origin": "http://localhost:5500"})
    assert ok.headers["Access-Control-Allow-Origin"] == "http://localhost:5500"
    assert ok.headers["Access-Control-Allow-Credentials"] == "true"
    bad = c.get("/api/v1", headers={"Origin": "http://evil.example"})
    assert "Access-Control-Allow-Origin" not in bad.headers
    pre = c.open("/api/v1/auth/login", method="OPTIONS", headers={
        "Origin": "http://localhost:5500", "Access-Control-Request-Method": "POST"})
    assert pre.status_code == 204


def test_unreachable_bridge_returns_503(tmp_path):
    app = create_app(make_config(tmp_path, db_backend="d1", d1_bridge_url="http://127.0.0.1:9", d1_timeout=1))
    c = app.test_client()
    c.set_cookie("vino_session", "abc")
    resp = c.get("/api/v1/auth/me")
    assert resp.status_code == 503
    assert resp.get_json()["error"]["code"] == "service_unavailable"
