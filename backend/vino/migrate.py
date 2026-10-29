"""Apply backend/migrations/*.sql to the local SQLite database.

    python -m vino.migrate            # apply pending migrations
    python -m vino.migrate --status   # list applied and pending migrations

This tracks applied files in a d1_migrations table, the same table
`wrangler d1 migrations apply` uses on Cloudflare, so local and cloud schemas
stay in step. It only ever touches local SQLite. The live D1 database is
migrated with wrangler, never with this.

It's safe to run from several processes at once (for example, several
gunicorn workers starting together): it takes an exclusive lock on the
database file, and each migration is applied in one transaction.
"""

import argparse
import sqlite3
import sys

from .config import MIGRATIONS_DIR, Config

TRACKING_TABLE = """
CREATE TABLE IF NOT EXISTS d1_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)
"""


def migration_files(directory=MIGRATIONS_DIR):
    return sorted(p for p in directory.glob("*.sql") if p.name[:4].isdigit())


def split_statements(sql):
    """Split a SQL file into single statements (sqlite3 runs one at a time)."""
    statements, buf = [], ""
    for line in sql.splitlines(keepends=True):
        buf += line
        if sqlite3.complete_statement(buf):
            if buf.strip():
                statements.append(buf.strip())
            buf = ""
    leftover = "\n".join(l for l in buf.splitlines() if not l.strip().startswith("--")).strip()
    if leftover:
        raise ValueError(f"Incomplete SQL statement at end of file: {leftover[:80]}")
    return statements


def apply_migrations(sqlite_path, directory=MIGRATIONS_DIR, log=print):
    conn = sqlite3.connect(sqlite_path, timeout=60, isolation_level=None)
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA foreign_keys = ON")
        # EXCLUSIVE makes other processes wait here until we're done.
        conn.execute("BEGIN EXCLUSIVE")
        try:
            conn.execute(TRACKING_TABLE)
            applied = {row[0] for row in conn.execute("SELECT name FROM d1_migrations")}
            newly = []
            for path in migration_files(directory):
                if path.name in applied:
                    continue
                for statement in split_statements(path.read_text(encoding="utf-8")):
                    conn.execute(statement)
                conn.execute("INSERT INTO d1_migrations (name) VALUES (?)", [path.name])
                newly.append(path.name)
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
    finally:
        conn.close()
    for name in newly:
        log(f"Applied migration {name}")
    return newly


def status(sqlite_path, directory=MIGRATIONS_DIR):
    conn = sqlite3.connect(sqlite_path)
    try:
        conn.execute(TRACKING_TABLE)
        applied = {row[0] for row in conn.execute("SELECT name FROM d1_migrations")}
    finally:
        conn.close()
    return [(p.name, p.name in applied) for p in migration_files(directory)]


def main(argv=None):
    parser = argparse.ArgumentParser(description="Apply Vino migrations to local SQLite.")
    parser.add_argument("--status", action="store_true", help="list migrations without applying")
    args = parser.parse_args(argv)

    config = Config.from_env()
    if config.db_backend != "sqlite":
        print("DB_BACKEND is not 'sqlite'. Cloudflare D1 is migrated with wrangler:")
        print("  npx wrangler d1 migrations apply vino-db --remote")
        return 1

    if args.status:
        for name, done in status(config.sqlite_path):
            print(f"{'applied' if done else 'pending'}  {name}")
        return 0

    newly = apply_migrations(config.sqlite_path)
    if not newly:
        print(f"Database is up to date ({config.sqlite_path}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
