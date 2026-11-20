"""Try the demo: one click signs a visitor into their own sample cellar.

    POST /auth/demo

Each click creates a fresh, private demo account (email
demo-<random>@demo.invalid, no password) holding the sample wines from
seed_demo.py and two tasting-journal entries, then logs it in for one day.
Visitors never see each other's changes, so nothing needs resetting between
judges. Demo accounts older than DEMO_HOURS are deleted on the next demo
sign-in; deleting a user removes their cellar, journal and sessions with it.

The demo wines are shared catalog entries (created once, wineCreatedByUserID
NULL), so the wine catalog doesn't grow with every click.

Switched off with DEMO_LOGIN=false.
"""

import secrets
from datetime import timedelta

from flask import Blueprint, current_app, jsonify

from . import db
from .api.items import insert_item
from .api.wines import WINE_SPEC, create_wine
from .auth import (
    NO_PASSWORD,
    me_payload,
    new_account_statements,
    new_session_statements,
    set_session_cookie,
)
from .errors import APIError
from .seed_demo import DEMO_WINES
from .util import iso, iso_ago, utcnow
from .validation import validate

bp = Blueprint("demo_login", __name__)

DEMO_DOMAIN = "demo.invalid"  # .invalid can never be a real address
DEMO_HOURS = 24
DEMO_SESSION_DAYS = 1
MAX_DEMOS_PER_HOUR = 300  # stops a script from filling the database

# (wine name, days ago, rating, notes) for the journal, so it isn't empty.
DEMO_JOURNAL = [
    ("Barolo, Falletto", 6, 4.5, "Birthday dinner with braised short ribs. Still young, but beautiful."),
    ("Josh Cellars Craftsman", 13, 3.5, "Burgers in the backyard. Easy and fruity."),
]


def _demo_wine_id(wine, blend_style, blend_ids):
    """The shared catalog entry for a demo wine, created the first time."""
    row = db.query_one(
        "SELECT wineID FROM wine WHERE wineName = ? AND wineVint = ? AND wineCreatedByUserID IS NULL "
        "ORDER BY wineID LIMIT 1",
        [wine["wineName"], wine["wineVint"]],
    )
    if row:
        return row["wineID"]
    data = validate({**wine, "blendID": blend_ids[blend_style]}, WINE_SPEC)
    return create_wine(data, None)


@bp.post("/auth/demo")
def demo_login():
    if not current_app.config["VINO"].demo_login:
        raise APIError(404, "not_found", "The demo isn't available.")

    pattern = f"%@{DEMO_DOMAIN}"
    db.execute("DELETE FROM user WHERE userEmail LIKE ? AND userCreatedAt < ?", [pattern, iso_ago(hours=DEMO_HOURS)])
    recent = db.query_one("SELECT count(*) AS n FROM user WHERE userEmail LIKE ? AND userCreatedAt >= ?",
                          [pattern, iso_ago(hours=1)])
    if recent["n"] >= MAX_DEMOS_PER_HOUR:
        raise APIError(429, "demo_busy", "The demo is busy right now. Please try again in a few minutes.")

    address = f"demo-{secrets.token_hex(6)}@{DEMO_DOMAIN}"
    db.batch(new_account_statements(address, NO_PASSWORD, "Demo", "Guest"))
    user = db.query_one("SELECT * FROM user WHERE userEmail = ?", [address])
    collection_id = db.query_one("SELECT collectionId FROM collection WHERE userID = ?",
                                 [user["userID"]])["collectionId"]

    blend_ids = {row["blendStyle"]: row["blendID"] for row in db.query("SELECT blendID, blendStyle FROM blends")}
    item_ids = {}
    for wine, blend_style, quantity in DEMO_WINES:
        wine_id = _demo_wine_id(wine, blend_style, blend_ids)
        item_ids[wine["wineName"]] = insert_item(
            collection_id, wine_id, {"wineType": wine["wineType"], "wineVint": wine["wineVint"]},
            {"itemQuantity": quantity})

    db.batch([
        ("INSERT INTO consumption (itemID, consumeTime, consumeQuantity, consumeNotes, consumeRating, consumedByUserID) "
         "VALUES (?, ?, 1, ?, ?, ?)",
         [item_ids[name], iso(utcnow() - timedelta(days=days_ago)), notes, rating, user["userID"]])
        for name, days_ago, rating, notes in DEMO_JOURNAL
    ])

    token, session_sql = new_session_statements(address, days=DEMO_SESSION_DAYS)
    db.batch(session_sql)
    response = jsonify(me_payload(user))
    response.status_code = 201
    return set_session_cookie(response, token, days=DEMO_SESSION_DAYS)
