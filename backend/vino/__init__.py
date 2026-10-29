"""Vino backend package. create_app() builds the Flask app."""

import logging

from flask import Flask, jsonify, request

from . import db
from .config import Config
from .errors import error_response, register_error_handlers

log = logging.getLogger(__name__)

# Paths that may change data without a JSON body (CSV upload).
_NON_JSON_WRITES = ("/import",)
_WRITE_METHODS = ("POST", "PUT", "PATCH", "DELETE")


def create_app(config=None):
    config = config or Config.from_env()
    config.validate()

    app = Flask(__name__)
    app.config["VINO"] = config
    app.config["MAX_CONTENT_LENGTH"] = config.max_content_length
    app.json.sort_keys = False
    app.json.ensure_ascii = False
    app.extensions["vino_db"] = db.make_adapter(config)

    if config.db_backend == "sqlite" and config.auto_migrate:
        from .migrate import apply_migrations

        apply_migrations(config.sqlite_path, log=log.info)

    register_error_handlers(app)
    _register_request_guards(app, config)

    @app.get("/health")
    def health():
        return "OK", 200

    from .api import register_blueprints

    register_blueprints(app)
    return app


def _register_request_guards(app, config):
    allowed = set(config.allowed_origins)

    @app.before_request
    def guard():
        origin = request.headers.get("Origin", "").rstrip("/")
        if request.method == "OPTIONS" and origin in allowed:
            # CORS preflight from an allowed local dev origin.
            return "", 204

        if request.method in _WRITE_METHODS and request.path.startswith("/api/"):
            # CSRF protection: a cross-site HTML form can't send JSON, so
            # requiring Content-Type: application/json blocks forged writes.
            if not request.path.endswith(_NON_JSON_WRITES) and request.mimetype != "application/json":
                return error_response(
                    415,
                    "unsupported_media_type",
                    "Send the request with Content-Type: application/json.",
                )
        return None

    @app.after_request
    def cors(response):
        origin = request.headers.get("Origin", "").rstrip("/")
        if origin and origin in allowed:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type"
            response.headers["Access-Control-Max-Age"] = "600"
            response.vary.add("Origin")
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        if request.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    @app.get("/api/v1")
    def api_root():
        return jsonify({"name": "Vino API", "version": 1})
