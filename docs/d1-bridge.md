# D1 bridge contract

The backend runs in a Cloudflare Container, and a container can't connect to D1 (Cloudflare's database) directly. Instead, the backend sends ordinary HTTP requests to a made-up hostname, and the Worker in front of the container catches them with an **outbound handler** and runs the SQL using its D1 binding.

This page is the contract between the two sides. The backend side is done (`backend/vino/db.py`, the `d1` adapter). The Worker side is for the infrastructure lead to write.

## How the backend uses it

Settings on the container:

| Setting | Value |
| --- | --- |
| `DB_BACKEND` | `d1` |
| `D1_BRIDGE_URL` | The bridge's base URL, for example `http://d1.internal`. No trailing slash needed. |
| `D1_TIMEOUT` | Seconds to wait for a response. Default `10`. |

The backend makes two kinds of request: `POST {D1_BRIDGE_URL}/query` and `POST {D1_BRIDGE_URL}/batch`. Both send and expect `Content-Type: application/json`.

Use plain `http://`. Cloudflare's docs say outbound handlers only intercept ports 80 and 443, and HTTPS is only intercepted when the container class sets `interceptHttps = true` and the container trusts Cloudflare's certificate. Plain HTTP on port 80 avoids that setup. The traffic never leaves Cloudflare: the handler "runs inside the Workers runtime, outside the container sandbox."

Map the hostname with `outboundByHost` on the container class. Cloudflare's docs also say `ContainerProxy` must be exported from the Worker entrypoint for interception to work. The bridge must **not** be reachable through the Worker's public routes. Only the container should be able to send SQL.

## POST /query: one statement

Request:

```json
{"sql": "SELECT * FROM wine WHERE wineID = ?", "params": [12]}
```

- `sql` is one SQL statement with `?` placeholders.
- `params` is a list of values for the placeholders, in order. Values are only `null`, numbers, and strings. The backend turns `true`/`false` into `1`/`0` before sending.

The handler should prepare the statement, bind the params, run it with `.all()`, and return:

```json
{
  "results": [{"wineID": 12, "wineName": "Château Margaux"}],
  "meta": {"changes": 0, "last_row_id": 0}
}
```

- `results`: the rows as objects keyed by column name. An empty list for statements that return no rows.
- `meta.changes`: rows changed by an INSERT, UPDATE or DELETE.
- `meta.last_row_id`: the id of the row an INSERT created. The backend needs this after inserts.

These are the field names D1 uses in its own `D1Result` (`results`, `meta.changes`, `meta.last_row_id`), so the handler can pass them through. Other `meta` fields are ignored.

## POST /batch: several statements, all or nothing

Request: a JSON **list** of the same statement objects.

```json
[
  {"sql": "INSERT INTO consumption (itemID, consumeTime, consumeQuantity, consumeNotes, consumeRating, consumedByUserID) VALUES (?, ?, ?, ?, ?, ?)",
   "params": [7, "2026-10-29T19:30:00Z", 1, "Anniversary", 4.5, 3]},
  {"sql": "UPDATE inventory_item SET itemQuantity = itemQuantity - ? WHERE itemID = ?",
   "params": [1, 7]}
]
```

The handler should prepare each statement and run them all with **one** `env.DB.batch([...])` call, then return a list with one result per statement, in the same order:

```json
[
  {"results": [], "meta": {"changes": 1, "last_row_id": 41}},
  {"results": [], "meta": {"changes": 1, "last_row_id": 41}}
]
```

The list must be the same length as the request. If it isn't, the backend treats the response as broken.

## Errors

| Situation | Status | Body |
| --- | --- | --- |
| D1 rejected a statement (bad SQL, or a constraint failed) | `400` | `{"error": {"message": "<D1's error message>"}}` |
| Anything else (bad request JSON, D1 unavailable, handler crashed) | `500` or `503` | `{"error": {"message": "<what went wrong>"}}` |

**Pass D1's error message through unchanged.** The backend reads it:

- A message containing `constraint failed` (for example `CHECK constraint failed: itemQuantity >= 0` or `UNIQUE constraint failed: wine.wineBarcode`) becomes a 409 conflict for the user. The bottle-count check depends on this: drinking more bottles than exist fails the CHECK, and the backend turns that into "There aren't that many bottles left."
- Any other `400` becomes a 500 for the user, logged on the backend.
- Any `5xx`, a timeout, or no answer at all makes the backend return `503 service_unavailable` ("The database is unavailable. Please try again shortly.") instead of crashing.

I checked the message format against wrangler's local D1 (wrangler 4.156.0). It reported `CHECK constraint failed: itemQuantity >= 0: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_CHECK)` and `FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)`. Both contain `constraint failed`. When `batch()` throws in the Worker, put the error's message in the body as shown.

## What D1 guarantees, and what the backend relies on

From Cloudflare's D1 Workers API page (`developers.cloudflare.com/d1/worker-api/d1-database/`), checked on 2026-10-29:

- "D1 operates in auto-commit." Each statement on its own commits immediately.
- `batch()`: "Batched statements are SQL transactions. If a statement in the sequence fails, then an error is returned for that specific statement, and it aborts or rolls back the entire sequence."
- `exec()` runs raw SQL without parameters and isn't for app queries. The page says to use it only for "maintenance and one-shot tasks (for example, migration jobs)." The bridge should never use `exec()`.
- The page doesn't mention `BEGIN TRANSACTION`, so the backend never sends `BEGIN` or `COMMIT`. All multi-statement atomicity comes from `/batch`.

What that means for the design:

- A batch rolls back only when a statement **fails with an error**. An `UPDATE ... WHERE` that matches no rows isn't an error, so it can't stop a batch. That's why bottle counts are protected by a `CHECK (itemQuantity >= 0)` constraint: the count is lowered unconditionally in the same batch as the journal entry, and taking out too many bottles breaks the CHECK, which fails the whole batch.
- Foreign keys: D1 enforces them by default. Local SQLite doesn't, so the backend turns them on for every local connection to match.
- The local `sqlite` adapter copies the same behavior: `batch()` runs in one transaction and rolls back everything if a statement fails.

## Migrations

The bridge doesn't run migrations. The SQL files in `backend/migrations/` are applied to D1 with wrangler, which tracks them in a `d1_migrations` table:

```bash
npx wrangler d1 migrations apply vino-db-test --remote
npx wrangler d1 migrations apply vino-db --remote
```

This needs `migrations_dir = "backend/migrations"` on the D1 binding in the wrangler config. The backend never migrates D1 itself: `AUTO_MIGRATE` only applies to local SQLite.

I checked that both migrations apply cleanly with `wrangler d1 migrations apply --local` (wrangler 4.156.0, local only, no Cloudflare account touched).

## Testing the contract without Cloudflare

`backend/tests/fake_bridge.py` is a small stand-in server that follows this contract and runs the SQL on a local SQLite file. The tests run the whole sign-up, add, drink, and value flow through it (`tests/test_smoke.py`). If the Worker handler behaves like the fake bridge, the backend will work with it.
