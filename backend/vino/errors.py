"""Consistent JSON errors.

Every error response looks like:
    {"error": {"code": "...", "message": "...", "fields": {...}}}
"""

import logging

from flask import jsonify
from werkzeug.exceptions import HTTPException

from .db import DatabaseUnavailable, IntegrityError

log = logging.getLogger(__name__)


class APIError(Exception):
    def __init__(self, status, code, message, fields=None, extra=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.fields = fields
        self.extra = extra


class ValidationError(APIError):
    def __init__(self, fields, message="Some fields need attention."):
        super().__init__(400, "validation_error", message, fields)


class NotFound(APIError):
    def __init__(self, message="Not found."):
        super().__init__(404, "not_found", message)


class Conflict(APIError):
    def __init__(self, message, code="conflict", fields=None):
        super().__init__(409, code, message, fields)


class Forbidden(APIError):
    def __init__(self, message="Only the collection owner can do that."):
        super().__init__(403, "forbidden", message)


def error_response(status, code, message, fields=None, extra=None):
    body = {"code": code, "message": message}
    if fields:
        body["fields"] = fields
    if extra:
        body.update(extra)
    return jsonify({"error": body}), status


_HTTP_CODES = {
    400: ("bad_request", "The request could not be understood."),
    401: ("not_authenticated", "Please log in."),
    403: ("forbidden", "You can't do that."),
    404: ("not_found", "Not found."),
    405: ("method_not_allowed", "That method isn't allowed here."),
    413: ("too_large", "The request is too large."),
    415: ("unsupported_media_type", "Send the request body as JSON with Content-Type: application/json."),
    429: ("too_many_requests", "Too many requests. Please wait and try again."),
}


def register_error_handlers(app):
    @app.errorhandler(APIError)
    def handle_api_error(err):
        return error_response(err.status, err.code, err.message, err.fields, err.extra)

    @app.errorhandler(HTTPException)
    def handle_http_error(err):
        code, message = _HTTP_CODES.get(err.code, ("http_error", err.description or "Request failed."))
        return error_response(err.code, code, message)

    @app.errorhandler(IntegrityError)
    def handle_integrity_error(err):
        log.warning("Unhandled integrity error: %s", err)
        return error_response(409, "conflict", "That change conflicts with existing data.")

    @app.errorhandler(DatabaseUnavailable)
    def handle_db_unavailable(err):
        log.error("Database unavailable: %s", err)
        return error_response(503, "service_unavailable", "The database is unavailable. Please try again shortly.")

    @app.errorhandler(Exception)
    def handle_unexpected(err):
        log.exception("Unexpected error")
        return error_response(500, "internal_error", "Something went wrong on our side. Please try again.")
