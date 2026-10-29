"""Small shared helpers: time, money formatting, request bodies."""

from datetime import date, datetime, timedelta, timezone

from flask import request

from .errors import APIError


def utcnow():
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt):
    """A datetime as ISO 8601 UTC text, e.g. 2026-10-29T14:03:00Z."""
    return dt.astimezone(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def now_iso():
    return iso(utcnow())


def iso_ago(**kwargs):
    return iso(utcnow() - timedelta(**kwargs))


def today():
    return utcnow().date()


def parse_date(text):
    return date.fromisoformat(text) if text else None


def format_money(cents):
    """Integer cents -> "$1,150.00". None stays None."""
    if cents is None:
        return None
    sign = "-" if cents < 0 else ""
    cents = abs(int(cents))
    return f"{sign}${cents // 100:,}.{cents % 100:02d}"


def money_fields(name, cents):
    """{"<name>Cents": 115000, "<name>Formatted": "$1,150.00"}"""
    return {f"{name}Cents": cents, f"{name}Formatted": format_money(cents)}


def json_body(required=True):
    """The request body as a dict, or a 400 if it isn't a JSON object."""
    data = request.get_json(silent=True)
    if data is None and not required and not request.get_data():
        return {}
    if not isinstance(data, dict):
        raise APIError(400, "bad_request", "The request body must be a JSON object.")
    return data
