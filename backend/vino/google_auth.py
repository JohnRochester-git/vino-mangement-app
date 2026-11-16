"""Sign in with Google: OpenID Connect, authorization code flow with PKCE.

    GET /auth/providers         which sign-in methods are on
    GET /auth/google/start      sends the browser to Google's sign-in page
    GET /auth/google/callback   Google sends the browser back here

The backend swaps Google's one-time code for an ID token by calling Google
directly over HTTPS, so the token can be trusted without checking its
signature (OpenID Connect Core, section 3.1.3.7). Its issuer, audience, expiry,
nonce and email_verified are still checked.

A Google sign-in finds the account by its Google ID, then by verified email
(linking an existing password account), or creates a new one. Either way it
ends with the same session cookie as a password login.

Settings: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, and
FRONTEND_URL (where the pages are, when they're on a different address from
the API, as in local development). See backend/.env.example.
"""

import base64
import hashlib
import json
import logging
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

from flask import Blueprint, current_app, jsonify, redirect, request

from . import db
from .auth import (
    NO_PASSWORD,
    new_account_statements,
    new_session_statements,
    set_session_cookie,
)
from .util import iso_ago, now_iso

bp = Blueprint("google_auth", __name__)
log = logging.getLogger(__name__)

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
ISSUERS = ("https://accounts.google.com", "accounts.google.com")
STATE_MINUTES = 10
TOKEN_TIMEOUT = 10


class GoogleSignInError(Exception):
    """Any reason a Google sign-in can't finish. Logged, never shown to users."""


def _hash(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _config():
    return current_app.config["VINO"]


def _pages(path):
    """A page's address: on the API's own site in production (FRONTEND_URL
    empty), or the local web server in development."""
    return f"{_config().frontend_url}/{path}"


def _back_to_login(reason):
    return redirect(_pages(f"login.html?error={reason}"))


def exchange_code(code, verifier):
    """Swaps the one-time code for Google's tokens. Replaced in tests."""
    config = _config()
    body = urllib.parse.urlencode({
        "code": code,
        "client_id": config.google_client_id,
        "client_secret": config.google_client_secret,
        "redirect_uri": config.google_redirect_uri,
        "grant_type": "authorization_code",
        "code_verifier": verifier,
    }).encode()
    req = urllib.request.Request(TOKEN_URL, data=body, method="POST", headers={
        "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TOKEN_TIMEOUT) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as err:
        raise GoogleSignInError(f"token exchange returned {err.code}: {err.read()[:200]!r}") from None
    except (urllib.error.URLError, TimeoutError, ValueError) as err:
        raise GoogleSignInError(f"token exchange failed: {err}") from None


def verified_claims(id_token, nonce):
    """The ID token's claims, after checking it's for us and still valid."""
    try:
        payload = id_token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (AttributeError, IndexError, ValueError):
        raise GoogleSignInError("ID token missing or malformed") from None

    if claims.get("iss") not in ISSUERS:
        raise GoogleSignInError(f"wrong issuer {claims.get('iss')!r}")
    if claims.get("aud") != _config().google_client_id:
        raise GoogleSignInError("ID token is for a different app")
    if not isinstance(claims.get("exp"), (int, float)) or claims["exp"] < time.time():
        raise GoogleSignInError("ID token expired")
    if not nonce or claims.get("nonce") != nonce:
        raise GoogleSignInError("nonce doesn't match")
    if not claims.get("sub") or not claims.get("email"):
        raise GoogleSignInError("ID token has no account ID or email")
    if claims.get("email_verified") is not True:
        raise GoogleSignInError("Google hasn't verified this email address")
    return claims


def find_or_create_user(claims):
    """The account for this Google identity: by Google ID, then by email
    (linking it), or a new one."""
    sub = claims["sub"]
    address = claims["email"].strip().lower()

    user = db.query_one("SELECT * FROM user WHERE userGoogleSub = ?", [sub])
    if user:
        return user

    user = db.query_one("SELECT * FROM user WHERE userEmail = ?", [address])
    if user:
        if user["userGoogleSub"]:
            raise GoogleSignInError("email already linked to a different Google account")
        db.execute("UPDATE user SET userGoogleSub = ? WHERE userID = ?", [sub, user["userID"]])
        return db.query_one("SELECT * FROM user WHERE userID = ?", [user["userID"]])

    first = (claims.get("given_name") or claims.get("name") or address.split("@")[0]).strip()[:50]
    last = (claims.get("family_name") or "").strip()[:50]
    try:
        db.batch(new_account_statements(address, NO_PASSWORD, first, last, google_sub=sub))
    except db.IntegrityError:
        pass  # the same person finished a sign-in in another tab first
    user = db.query_one("SELECT * FROM user WHERE userGoogleSub = ?", [sub])
    if not user:
        raise GoogleSignInError("couldn't create the account")
    return user


@bp.get("/auth/providers")
def providers():
    return jsonify({"password": True, "google": _config().google_enabled})


@bp.get("/auth/google/start")
def google_start():
    config = _config()
    if not config.google_enabled:
        return _back_to_login("google_unavailable")

    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    nonce = secrets.token_urlsafe(32)
    db.batch([
        ("DELETE FROM oauth_state WHERE stateCreatedAt < ?", [iso_ago(minutes=STATE_MINUTES)]),
        ("INSERT INTO oauth_state (stateHash, codeVerifier, nonce, stateCreatedAt) VALUES (?, ?, ?, ?)",
         [_hash(state), verifier, nonce, now_iso()]),
    ])
    params = {
        "client_id": config.google_client_id,
        "redirect_uri": config.google_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "nonce": nonce,
        "code_challenge": _b64url(hashlib.sha256(verifier.encode("ascii")).digest()),
        "code_challenge_method": "S256",
        "prompt": "select_account",
    }
    return redirect(f"{AUTH_URL}?{urllib.parse.urlencode(params)}")


@bp.get("/auth/google/callback")
def google_callback():
    if not _config().google_enabled:
        return _back_to_login("google_unavailable")
    if request.args.get("error"):
        # The person cancelled on Google's page, or Google refused.
        return _back_to_login("google_cancelled")

    state = request.args.get("state", "")
    code = request.args.get("code", "")
    if not state or not code or len(state) > 200:
        return _back_to_login("google_failed")

    # Each state works once, and only for STATE_MINUTES.
    row = db.query_one(
        "SELECT codeVerifier, nonce FROM oauth_state WHERE stateHash = ? AND stateCreatedAt >= ?",
        [_hash(state), iso_ago(minutes=STATE_MINUTES)],
    )
    db.execute("DELETE FROM oauth_state WHERE stateHash = ?", [_hash(state)])
    if not row:
        return _back_to_login("google_failed")

    try:
        tokens = exchange_code(code, row["codeVerifier"])
        claims = verified_claims(tokens.get("id_token"), row["nonce"])
        user = find_or_create_user(claims)
    except GoogleSignInError as err:
        log.warning("Google sign-in failed: %s", err)
        return _back_to_login("google_failed")

    token, session_sql = new_session_statements(user["userEmail"])
    db.batch(session_sql)
    return set_session_cookie(redirect(_pages("welcome.html")), token)
