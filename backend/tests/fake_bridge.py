"""A stand-in for the Cloudflare Worker's D1 outbound handler.

It speaks the HTTP contract in docs/d1-bridge.md and runs the SQL against a
local SQLite file, so tests can exercise the d1 adapter end to end.
"""

import json
import sqlite3
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class FakeBridge:
    def __init__(self, sqlite_path):
        self.sqlite_path = sqlite_path
        self.requests = []
        self.fail_next = None  # set to an HTTP status to fail the next request
        bridge = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                length = int(self.headers.get("Content-Length", 0))
                payload = json.loads(self.rfile.read(length))
                bridge.requests.append((self.path, payload))
                if bridge.fail_next:
                    status, bridge.fail_next = bridge.fail_next, None
                    return self._send(status, {"error": {"message": "bridge failure"}})
                if self.path == "/query":
                    return self._send(*bridge.run_batch([payload], single=True))
                if self.path == "/batch":
                    return self._send(*bridge.run_batch(payload))
                return self._send(404, {"error": {"message": "unknown path"}})

            def _send(self, status, body):
                data = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def run_batch(self, statements, single=False):
        conn = sqlite3.connect(self.sqlite_path, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            conn.execute("BEGIN IMMEDIATE")
            out = []
            for stmt in statements:
                cur = conn.execute(stmt["sql"], stmt.get("params") or [])
                rows = [dict(r) for r in cur.fetchall()] if cur.description else []
                out.append({
                    "results": rows,
                    "meta": {"changes": max(cur.rowcount, 0), "last_row_id": cur.lastrowid},
                })
            conn.execute("COMMIT")
        except sqlite3.Error as err:
            conn.execute("ROLLBACK")
            return 400, {"error": {"message": f"D1_ERROR: {err}"}}
        finally:
            conn.close()
        return 200, (out[0] if single else out)

    def start(self):
        self.thread.start()
        return self

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
