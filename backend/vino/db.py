"""Data-access layer. All SQL in the app runs through this module.

Two adapters, picked by the DB_BACKEND setting:

- "sqlite" (default): Python's sqlite3 against the file at SQLITE_PATH.
  Used for local development, Docker on laptops, and tests.
- "d1": HTTP requests to D1_BRIDGE_URL. A Worker outbound handler runs the
  SQL against Cloudflare D1. The contract is in docs/d1-bridge.md.

Use the module-level functions inside a request:

    rows = db.query("SELECT * FROM wine WHERE wineID = ?", [wine_id])
    result = db.execute("UPDATE ...", [...])        # result.changes, result.last_row_id
    results = db.batch([(sql, params), (sql, params)])  # all-or-nothing

Never build SQL by string formatting with user input. Use ? placeholders.
"""

import json
import sqlite3
import urllib.error
import urllib.request
from dataclasses import dataclass, field

from flask import current_app


class DatabaseError(Exception):
    """The database rejected a statement."""


class IntegrityError(DatabaseError):
    """A constraint failed: UNIQUE, CHECK, NOT NULL or FOREIGN KEY."""


class DatabaseUnavailable(DatabaseError):
    """The database (or the D1 bridge) couldn't be reached."""


@dataclass
class Result:
    rows: list = field(default_factory=list)
    changes: int = 0
    last_row_id: int | None = None


def _is_constraint_error(message):
    return "constraint failed" in message.lower()


def _clean_params(params):
    # D1 doesn't accept booleans, so send them as 0/1 to both adapters.
    return [int(p) if isinstance(p, bool) else p for p in (params or [])]


class SQLiteAdapter:
    def __init__(self, path):
        self.path = path

    def connect(self):
        conn = sqlite3.connect(self.path, timeout=15, isolation_level=None)
        conn.row_factory = sqlite3.Row
        # D1 enforces foreign keys; plain SQLite doesn't unless told to.
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _run(self, conn, sql, params):
        try:
            cur = conn.execute(sql, _clean_params(params))
        except sqlite3.IntegrityError as err:
            raise IntegrityError(str(err)) from err
        except sqlite3.OperationalError as err:
            if "locked" in str(err) or "unable to open" in str(err):
                raise DatabaseUnavailable(str(err)) from err
            raise DatabaseError(str(err)) from err
        except sqlite3.Error as err:
            raise DatabaseError(str(err)) from err
        rows = [dict(r) for r in cur.fetchall()] if cur.description else []
        return Result(rows=rows, changes=cur.rowcount if cur.rowcount > 0 else 0, last_row_id=cur.lastrowid)

    def run(self, sql, params):
        conn = self.connect()
        try:
            return self._run(conn, sql, params)
        finally:
            conn.close()

    def batch(self, statements):
        conn = self.connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            try:
                results = [self._run(conn, sql, params) for sql, params in statements]
            except Exception:
                conn.execute("ROLLBACK")
                raise
            conn.execute("COMMIT")
            return results
        finally:
            conn.close()


class D1BridgeAdapter:
    def __init__(self, base_url, timeout=10.0, opener=None):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        # Tests can swap in a different opener; normally urllib's default.
        self.opener = opener or urllib.request.urlopen

    def _post(self, path, payload):
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            self.base_url + path,
            data=data,
            method="POST",
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        try:
            with self.opener(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            message = _bridge_error_message(err)
            if err.code == 400:
                if _is_constraint_error(message):
                    raise IntegrityError(message) from err
                raise DatabaseError(message) from err
            raise DatabaseUnavailable(f"D1 bridge returned {err.code}: {message}") from err
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as err:
            raise DatabaseUnavailable(f"D1 bridge unreachable: {err}") from err
        except ValueError as err:
            raise DatabaseUnavailable(f"D1 bridge sent invalid JSON: {err}") from err

    @staticmethod
    def _to_result(body):
        if not isinstance(body, dict) or not isinstance(body.get("results", []), list):
            raise DatabaseUnavailable("D1 bridge sent an unexpected response")
        meta = body.get("meta") or {}
        return Result(
            rows=body.get("results") or [],
            changes=int(meta.get("changes") or 0),
            last_row_id=meta.get("last_row_id"),
        )

    def run(self, sql, params):
        body = self._post("/query", {"sql": sql, "params": _clean_params(params)})
        return self._to_result(body)

    def batch(self, statements):
        payload = [{"sql": sql, "params": _clean_params(params)} for sql, params in statements]
        body = self._post("/batch", payload)
        if not isinstance(body, list) or len(body) != len(statements):
            raise DatabaseUnavailable("D1 bridge sent an unexpected batch response")
        return [self._to_result(item) for item in body]


def _bridge_error_message(err):
    try:
        body = json.loads(err.read().decode("utf-8"))
        return str(body["error"]["message"])
    except Exception:
        return err.reason if isinstance(err.reason, str) else "unknown error"


def make_adapter(config):
    if config.db_backend == "d1":
        return D1BridgeAdapter(config.d1_bridge_url, timeout=config.d1_timeout)
    return SQLiteAdapter(config.sqlite_path)


def _adapter():
    return current_app.extensions["vino_db"]


def query(sql, params=None):
    """Run a SELECT and return a list of dicts."""
    return _adapter().run(sql, params).rows


def query_one(sql, params=None):
    """Run a SELECT and return the first row as a dict, or None."""
    rows = query(sql, params)
    return rows[0] if rows else None


def execute(sql, params=None):
    """Run one INSERT/UPDATE/DELETE. Returns a Result (changes, last_row_id)."""
    return _adapter().run(sql, params)


def batch(statements):
    """Run several statements as one transaction. If any statement fails with
    an error, none of them take effect. Returns one Result per statement."""
    if not statements:
        return []
    return _adapter().batch(statements)
