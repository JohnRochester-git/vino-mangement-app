"""Accounts and sessions: signup, login, logout, me, and login_required.

Sessions live in the database (session table), so any container instance can
serve any request. The cookie holds a random token; the table stores only its
SHA-256 hash, so a leaked database can't be used to log in.
"""

import hashlib
import secrets
from datetime import timedelta
from functools import wraps

from flask import Blueprint, current_app, g, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

from . import db
from .errors import APIError
from .util import iso, iso_ago, json_body, now_iso, utcnow
from .validation import Field, email, login_password, name_field, password, validate

bp = Blueprint("auth", __name__)

COOKIE_NAME = "vino_session"
LOCKOUT_FAILURES = 5
LOCKOUT_WINDOW_MINUTES = 15
LOCKOUT_MINUTES = 5
LOGIN_FAILED_MESSAGE = "That email and password don't match an account."

# userPasshash for accounts created by signing in with Google. It isn't a valid
# hash, so check_password_hash never accepts any password for it.
NO_PASSWORD = "!google"

# Checked against when the email is unknown, so both cases take the same time.
_DUMMY_HASH = generate_password_hash("not-a-real-password")


def _hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_session_statements(email_address, days=None):
    """SQL that creates a session for the user with this email, and the token
    for the cookie. Returned as statements so callers can batch them. Lasts
    SESSION_DAYS unless `days` is given."""
    token = secrets.token_urlsafe(32)
    days = days or current_app.config["VINO"].session_days
    expires = iso(utcnow() + timedelta(days=days))
    sql = (
        "INSERT INTO session (sessionID, userID, sessionCreatedAt, sessionExpiresAt) "
        "SELECT ?, userID, ?, ? FROM user WHERE userEmail = ?"
    )
    return token, [(sql, [_hash_token(token), now_iso(), expires, email_address])]


def set_session_cookie(response, token, days=None):
    config = current_app.config["VINO"]
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=(days or config.session_days) * 24 * 3600,
        httponly=True,
        samesite="Lax",
        secure=config.cookie_secure,
        path="/",
    )
    return response


def _clear_cookie(response):
    config = current_app.config["VINO"]
    response.delete_cookie(COOKIE_NAME, path="/", httponly=True, samesite="Lax", secure=config.cookie_secure)
    return response


def user_json(row):
    return {
        "userID": row["userID"],
        "userEmail": row["userEmail"],
        "userFname": row["userFname"],
        "userLname": row["userLname"],
        "userFullname": f"{row['userFname']} {row['userLname']}".strip(),
        "userCreatedAt": row["userCreatedAt"],
    }


def current_user():
    """The logged-in user's row, or None. Cached for the request."""
    if "user" in g:
        return g.user
    g.user = None
    token = request.cookies.get(COOKIE_NAME)
    if token and len(token) < 200:
        g.user = db.query_one(
            "SELECT u.userID, u.userEmail, u.userFname, u.userLname, u.userCreatedAt "
            "FROM session s JOIN user u ON u.userID = s.userID "
            "WHERE s.sessionID = ? AND s.sessionExpiresAt > ?",
            [_hash_token(token), now_iso()],
        )
    return g.user


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if current_user() is None:
            raise APIError(401, "not_authenticated", "Please log in.")
        return view(*args, **kwargs)
    return wrapper


def me_payload(user):
    from .api.collections import list_collections_for

    return {"user": user_json(user), "collections": list_collections_for(user["userID"])}


SIGNUP_SPEC = {
    "userEmail": Field(email, required=True),
    "password": Field(password, required=True),
    "userFname": Field(name_field("First name"), required=True),
    "userLname": Field(name_field("Last name"), required=True),
}

LOGIN_SPEC = {
    "userEmail": Field(email, required=True),
    "password": Field(login_password, required=True),
}


def new_account_statements(email_address, passhash, first, last, google_sub=None):
    """SQL that creates a user with their own "My Cellar" collection.
    Shared by password signup and Google sign-in."""
    now = now_iso()
    return [
        (
            "INSERT INTO user (userEmail, userPasshash, userFname, userLname, userCreatedAt, userGoogleSub) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [email_address, passhash, first, last, now, google_sub],
        ),
        (
            "INSERT INTO collection (collectionName, userID) SELECT ?, userID FROM user WHERE userEmail = ?",
            ["My Cellar", email_address],
        ),
        (
            "INSERT INTO collection_member (collectionId, userID, memberRole, memberAddedAt) "
            "SELECT c.collectionId, c.userID, 'owner', ? FROM collection c "
            "JOIN user u ON u.userID = c.userID WHERE u.userEmail = ?",
            [now, email_address],
        ),
    ]


@bp.post("/auth/signup")
def signup():
    data = validate(json_body(), SIGNUP_SPEC)
    token, session_sql = new_session_statements(data["userEmail"])
    statements = [
        *new_account_statements(data["userEmail"], generate_password_hash(data["password"]),
                                data["userFname"], data["userLname"]),
        *session_sql,
    ]
    try:
        db.batch(statements)
    except db.IntegrityError:
        if db.query_one("SELECT 1 FROM user WHERE userEmail = ?", [data["userEmail"]]):
            raise APIError(409, "email_taken", "An account with that email already exists. Please log in instead.",
                           {"userEmail": "An account with that email already exists."}) from None
        raise
    user = db.query_one("SELECT * FROM user WHERE userEmail = ?", [data["userEmail"]])
    response = jsonify(me_payload(user))
    response.status_code = 201
    return set_session_cookie(response, token)


def _is_locked_out(email_address):
    """Locked when there were LOCKOUT_FAILURES failures since the last
    success within the window, and the latest was under LOCKOUT_MINUTES ago."""
    row = db.query_one(
        "SELECT count(*) AS failures, max(attemptAt) AS latest FROM login_attempt "
        "WHERE attemptEmail = ? AND attemptSucceeded = 0 AND attemptAt > ? "
        "AND attemptAt > coalesce((SELECT max(attemptAt) FROM login_attempt "
        "    WHERE attemptEmail = ? AND attemptSucceeded = 1), '')",
        [email_address, iso_ago(minutes=LOCKOUT_WINDOW_MINUTES), email_address],
    )
    return row["failures"] >= LOCKOUT_FAILURES and row["latest"] > iso_ago(minutes=LOCKOUT_MINUTES)


@bp.post("/auth/login")
def login():
    data = validate(json_body(), LOGIN_SPEC)
    address = data["userEmail"]

    # Housekeeping, so these tables don't grow forever.
    db.batch([
        ("DELETE FROM session WHERE sessionExpiresAt <= ?", [now_iso()]),
        ("DELETE FROM login_attempt WHERE attemptAt < ?", [iso_ago(days=1)]),
    ])

    if _is_locked_out(address):
        raise APIError(429, "too_many_attempts",
                       f"Too many failed attempts. Please wait {LOCKOUT_MINUTES} minutes and try again.")

    user = db.query_one("SELECT * FROM user WHERE userEmail = ?", [address])
    ok = check_password_hash(user["userPasshash"] if user else _DUMMY_HASH, data["password"]) and user is not None

    record = ("INSERT INTO login_attempt (attemptEmail, attemptAt, attemptSucceeded) VALUES (?, ?, ?)",
              [address, now_iso(), 1 if ok else 0])
    if not ok:
        db.execute(*record)
        raise APIError(401, "invalid_credentials", LOGIN_FAILED_MESSAGE)

    token, session_sql = new_session_statements(address)
    db.batch([record, *session_sql])
    return set_session_cookie(jsonify(me_payload(user)), token)


@bp.post("/auth/logout")
def logout():
    token = request.cookies.get(COOKIE_NAME)
    if token and len(token) < 200:
        db.execute("DELETE FROM session WHERE sessionID = ?", [_hash_token(token)])
    return _clear_cookie(jsonify({"loggedOut": True}))


@bp.get("/auth/me")
@login_required
def me():
    return jsonify(me_payload(current_user()))
