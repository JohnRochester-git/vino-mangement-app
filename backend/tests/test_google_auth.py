import base64
import json
import time
import urllib.parse

import pytest

from vino import create_app, google_auth

from .conftest import JSONClient, make_config, signup

CLIENT_ID = "test-client.apps.googleusercontent.com"
REDIRECT = "https://www.vinowine.org/api/v1/auth/google/callback"


def _b64(obj):
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()


def id_token(**claims):
    base = {
        "iss": "https://accounts.google.com", "aud": CLIENT_ID, "exp": int(time.time()) + 300,
        "sub": "google-sub-1", "email": "Frank@Gmail.com", "email_verified": True,
        "given_name": "Frank", "family_name": "Delgado",
    }
    base.update(claims)
    return f"{_b64({'alg': 'RS256'})}.{_b64(base)}.signature"


@pytest.fixture
def gapp(tmp_path):
    return create_app(make_config(tmp_path, google_client_id=CLIENT_ID, google_client_secret="secret",
                                  google_redirect_uri=REDIRECT))


@pytest.fixture
def gclient(gapp):
    return JSONClient(gapp.test_client())


@pytest.fixture
def google(monkeypatch):
    """Stands in for Google's token endpoint. Set .claims to change the ID token;
    the nonce from /start is filled in automatically."""
    fake = type("FakeGoogle", (), {"claims": {}, "calls": []})()

    def exchange(code, verifier):
        fake.calls.append((code, verifier))
        return {"id_token": id_token(**{"nonce": fake.nonce, **fake.claims})}

    monkeypatch.setattr(google_auth, "exchange_code", exchange)
    return fake


def start(client, fake=None):
    """Runs /start; returns the state and the query sent to Google."""
    resp = client.get("/api/v1/auth/google/start")
    assert resp.status_code == 302
    url = urllib.parse.urlparse(resp.headers["Location"])
    assert f"{url.scheme}://{url.netloc}{url.path}" == google_auth.AUTH_URL
    query = dict(urllib.parse.parse_qsl(url.query))
    if fake is not None:
        fake.nonce = query["nonce"]
    return query


def finish(client, query, code="one-time-code"):
    return client.get(f"/api/v1/auth/google/callback?code={code}&state={query['state']}")


def test_providers(client, gclient):
    assert client.get("/api/v1/auth/providers").get_json()["google"] is False
    assert gclient.get("/api/v1/auth/providers").get_json()["google"] is True


def test_start_sends_browser_to_google_with_pkce(gclient):
    query = start(gclient)
    assert query["client_id"] == CLIENT_ID and query["redirect_uri"] == REDIRECT
    assert query["response_type"] == "code" and query["scope"] == "openid email profile"
    assert query["code_challenge_method"] == "S256" and len(query["code_challenge"]) == 43
    assert query["state"] and query["nonce"]


def test_new_google_user_gets_account_cellar_and_session(gclient, google):
    query = start(gclient, google)
    resp = finish(gclient, query)
    assert resp.status_code == 302 and resp.headers["Location"] == "/welcome.html"
    assert "vino_session=" in resp.headers["Set-Cookie"] and "HttpOnly" in resp.headers["Set-Cookie"]

    me = gclient.get("/api/v1/auth/me").get_json()
    assert me["user"]["userEmail"] == "frank@gmail.com"
    assert me["user"]["userFullname"] == "Frank Delgado"
    assert me["collections"][0]["collectionName"] == "My Cellar"

    # The PKCE verifier sent to Google matches the challenge from /start.
    import hashlib
    [(code, verifier)] = google.calls
    assert code == "one-time-code"
    assert google_auth._b64url(hashlib.sha256(verifier.encode()).digest()) == query["code_challenge"]


def test_second_google_sign_in_reuses_the_account(gclient, gapp, google):
    finish(gclient, start(gclient, google))
    other = JSONClient(gapp.test_client())
    google.claims = {"email": "new-address@gmail.com"}  # same Google ID, changed email
    finish(other, start(other, google))
    assert other.get("/api/v1/auth/me").get_json()["user"]["userEmail"] == "frank@gmail.com"


def test_google_links_existing_password_account_by_verified_email(gclient, gapp, google):
    signup(gclient, email="frank@gmail.com", password="correct horse")
    other = JSONClient(gapp.test_client())
    finish(other, start(other, google))
    assert other.get("/api/v1/auth/me").get_json()["user"]["userEmail"] == "frank@gmail.com"
    # The password still works too.
    login = JSONClient(gapp.test_client()).post(
        "/api/v1/auth/login", json={"userEmail": "frank@gmail.com", "password": "correct horse"})
    assert login.status_code == 200


def test_google_only_account_has_no_usable_password(gclient, gapp, google):
    finish(gclient, start(gclient, google))
    for attempt in ("!google", "", "password1"):
        resp = JSONClient(gapp.test_client()).post(
            "/api/v1/auth/login", json={"userEmail": "frank@gmail.com", "password": attempt or "x"})
        assert resp.status_code in (400, 401)
        assert gclient.get("/api/v1/auth/me").status_code == 200  # the Google session still works


@pytest.mark.parametrize("claims", [
    {"email_verified": False},
    {"aud": "someone-elses-app"},
    {"iss": "https://evil.example.com"},
    {"exp": int(time.time()) - 10},
    {"nonce": "not-the-nonce-we-sent"},
    {"email": ""},
])
def test_bad_id_tokens_are_refused(gclient, google, claims):
    google.claims = claims
    resp = finish(gclient, start(gclient, google))
    assert resp.status_code == 302 and resp.headers["Location"] == "/login.html?error=google_failed"
    assert "Set-Cookie" not in resp.headers or "vino_session=;" in resp.headers.get("Set-Cookie", "")
    assert gclient.get("/api/v1/auth/me").status_code == 401


def test_state_must_match_and_works_once(gclient, google):
    query = start(gclient, google)
    forged = dict(query, state="made-up-state")
    assert finish(gclient, forged).headers["Location"] == "/login.html?error=google_failed"
    assert finish(gclient, query).headers["Location"] == "/welcome.html"
    # Replaying the same callback fails: the state was used up.
    assert finish(gclient, query).headers["Location"] == "/login.html?error=google_failed"


def test_cancelled_on_google_page(gclient):
    resp = gclient.get("/api/v1/auth/google/callback?error=access_denied&state=x")
    assert resp.headers["Location"] == "/login.html?error=google_cancelled"


def test_google_off_when_not_configured(client):
    for path in ("/api/v1/auth/google/start", "/api/v1/auth/google/callback?code=a&state=b"):
        resp = client.get(path)
        assert resp.status_code == 302 and resp.headers["Location"] == "/login.html?error=google_unavailable"


def test_frontend_url_for_local_development(tmp_path, monkeypatch):
    app = create_app(make_config(tmp_path, google_client_id=CLIENT_ID, google_client_secret="s",
                                 google_redirect_uri="http://localhost:8000/api/v1/auth/google/callback",
                                 frontend_url="http://localhost:5500"))
    c = JSONClient(app.test_client())
    fake = type("F", (), {})()
    monkeypatch.setattr(google_auth, "exchange_code",
                        lambda code, verifier: {"id_token": id_token(nonce=fake.nonce)})
    query = start(c, fake)
    assert finish(c, query).headers["Location"] == "http://localhost:5500/welcome.html"


def test_token_exchange_failure_goes_back_to_login(gclient, monkeypatch):
    def broken(code, verifier):
        raise google_auth.GoogleSignInError("Google is down")
    monkeypatch.setattr(google_auth, "exchange_code", broken)
    query = start(gclient)
    assert finish(gclient, query).headers["Location"] == "/login.html?error=google_failed"
