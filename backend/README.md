# Backend

The Python backend for the Vino app, built with Flask. It's the API the frontend calls: accounts, households, the wine catalog, bottles, drinking notes, and values. Every endpoint is described in [docs/api.md](../docs/api.md).

## Set it up (first time only)

From the `backend/` folder.

**Windows (PowerShell):**

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
```

If PowerShell says running scripts is disabled, run this once, then try again:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

**Mac or Linux:**

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
```

The `.venv` folder is a private Python install for this project, so packages don't mix with the rest of your computer. Turn it on again (the second line above) each time you open a new terminal. You'll see `(.venv)` at the start of the prompt when it's on.

`requirements-dev.txt` installs everything in `requirements.txt` plus the testing tools. The live app only installs `requirements.txt`.

## Run it

On any computer, start the development server:

```bash
python app.py
```

This is what you'll use day to day. The first time, it creates a database file, `backend/vino.db`, and sets up its tables. Git ignores that file.

The live app runs under a production server called gunicorn instead. Gunicorn doesn't work on Windows, but you don't need to install it anywhere: the Docker setup runs the app under gunicorn on any computer. See [Run it locally](../README.md#run-it-locally) in the main README. On Mac or Linux you can also run gunicorn directly:

```bash
gunicorn --bind 0.0.0.0:8000 app:app
```

## Check that it's running

Open http://localhost:8000/health in a browser. You should see `OK`.

Or from a terminal:

```powershell
curl.exe http://localhost:8000/health
```

On Mac or Linux, use `curl` without the `.exe`.

## The database

### Where it lives

- **On your computer:** a SQLite file, a whole database in one file. `python app.py` uses `backend/vino.db`. Docker keeps its own in a Docker volume called `vino-data`, so it survives restarts.
- **On the live site:** Cloudflare D1. The backend reaches it through the Worker in front of it. See [docs/d1-bridge.md](../docs/d1-bridge.md).

The same code works with both. The `DB_BACKEND` setting picks which one.

### Migrations

A migration is a numbered SQL file in `migrations/` that changes the database's structure: `0001_initial_schema.sql`, `0002_seed_reference_data.sql`, and so on. They run in order, and each runs only once. A table called `d1_migrations` records which have run.

**Locally they run by themselves** when the app starts. To run them by hand, or see which have run:

```bash
python -m vino.migrate
python -m vino.migrate --status
```

**On Cloudflare D1 they never run by themselves.** They're applied with wrangler, Cloudflare's command-line tool. The infrastructure lead does this:

```bash
npx wrangler d1 migrations apply vino-db --remote
```

**To change the database,** add a new file with the next number, like `0004_add_something.sql`. Never edit a migration that's already been merged: databases that already ran it won't run it again. Stick to plain SQLite statements, and don't add `BEGIN` or `COMMIT`: the migration tools handle that. Then list the change in [docs/schema-changes.md](../docs/schema-changes.md) and tell Noah before it's merged.

To start your local database over, stop the app and delete `backend/vino.db` (and any `vino.db-wal` and `vino.db-shm` next to it). For Docker, run `docker compose down -v`, which deletes the `vino-data` volume.

### Demo data

To load a demo household with the same seven wines as the current prototype:

**Windows (PowerShell):**

```powershell
$env:DEMO_PASSWORD="choose-a-password"
python -m vino.seed_demo
```

**Mac or Linux:**

```bash
DEMO_PASSWORD=choose-a-password python -m vino.seed_demo
```

It prints the email (`demo@example.com` unless you set `DEMO_EMAIL`) and password to log in with. Running it again changes nothing. It only works on a local database: it refuses to run when `DB_BACKEND=d1`.

To load it into the Docker app's database while it's running:

```bash
docker compose exec -e DEMO_PASSWORD=choose-a-password backend python -m vino.seed_demo
```

## Run the tests

From the `backend/` folder, with `.venv` turned on:

```bash
pytest
```

Every test makes its own temporary database, so the tests never touch `vino.db`. It ends with a line saying how many tests passed. Any `FAILED` line names the test that broke. Run `pytest -x` to stop at the first failure, or `pytest tests/test_auth.py` to run one file.

The tests don't need Docker. The Docker health check is separate: see [Run the test](../README.md#run-the-test) in the main README.

## Settings

Settings come from environment variables, not from the code. `.env.example` lists every setting the app reads, with no real values. Copy it to `.env` to change them locally.

| Setting | What it does | Default |
| --- | --- | --- |
| `FLASK_ENV` | `production` or `development`. Only a label for now. | `production` |
| `DB_BACKEND` | `sqlite` (a local file) or `d1` (Cloudflare D1 through the bridge) | `sqlite` |
| `SQLITE_PATH` | The SQLite file to use | `backend/vino.db` (Docker: `/data/vino.db`) |
| `D1_BRIDGE_URL` | Where the D1 bridge is, when `DB_BACKEND=d1` | none |
| `D1_TIMEOUT` | Seconds to wait for the bridge | `10` |
| `AUTO_MIGRATE` | Run pending migrations at startup. Local SQLite only; never with D1. | `true` |
| `ALLOWED_ORIGINS` | Frontend addresses on another port allowed to call the API, comma-separated. Only for local development. | none (Docker: ports 5500) |
| `COOKIE_SECURE` | Only send the login cookie over HTTPS. Set `true` on the live site. | `false` |
| `SESSION_DAYS` | How long a login lasts | `14` |
| `BARCODE_PROVIDER` | `none` or `openfoodfacts` | `none` |
| `BARCODE_API_KEY` | Reserved for a barcode service that needs a key. Open Food Facts doesn't. | none |
| `BARCODE_CONTACT` | Team email sent to Open Food Facts, which its terms ask for | none |
| `DEMO_EMAIL`, `DEMO_PASSWORD` | Login for the demo data | `demo@example.com`, none |

`PORT` is gone. The development server and gunicorn both use port 8000, and the Docker setup and Cloudflare expect 8000.

Never put real keys or passwords in the code, and never commit a `.env` file. Git is set to ignore `.env`.

## How the code is organized

```
backend/
  app.py              Starts the app (gunicorn runs app:app)
  vino/
    __init__.py       create_app(): builds the app, JSON and CORS rules
    config.py         Reads the settings
    db.py             The only place SQL runs: query, execute, batch
    migrate.py        Applies migrations/ to local SQLite
    errors.py         Turns every error into the same JSON shape
    validation.py     Every input rule
    auth.py           Signup, login, logout, sessions, login_required
    access.py         Who can see which collection, bottle, journal entry
    seed_demo.py      Demo data
    services/         Business rules: drink windows, values, barcode lookup
    api/              The endpoints, one file per area
  migrations/         Numbered SQL files
  tests/              pytest tests
```

## Add a new endpoint

Follow the pattern the existing endpoints use. Here's a made-up one that returns a collection's storage locations.

1. **Pick the file** in `vino/api/` for that area (here `items.py`), or make a new file and add its blueprint in `vino/api/__init__.py`.

2. **Write the route.** Put `@login_required` on it, and check access with a helper from `access.py` before touching data. It answers 404 for anyone who isn't a member.

   ```python
   @bp.get("/collections/<int:collection_id>/locations")
   @login_required
   def list_locations(collection_id):
       require_member(collection_id)
       rows = db.query(
           "SELECT DISTINCT itemStoredAt FROM inventory_item "
           "WHERE collectionId = ? AND itemStoredAt IS NOT NULL ORDER BY itemStoredAt",
           [collection_id],
       )
       return jsonify({"locations": [r["itemStoredAt"] for r in rows]})
   ```

3. **Run SQL only through `db`:** `db.query()` and `db.query_one()` read, `db.execute()` changes one thing, and `db.batch()` makes several changes that must all happen or none. Always use `?` placeholders for values. **Never** put user input into SQL with f-strings or `+`.

4. **Validate input** with a spec from `validation.py`:

   ```python
   SPEC = {"itemStoredAt": Field(text(1, 120, "Storage location"), required=True)}
   data = validate(json_body(), SPEC)
   ```

   Unknown fields and bad values come back as a 400 with a message per field. You don't need to handle that yourself.

5. **Raise errors, don't return them:** `raise NotFound("...")`, `raise Conflict("...")`, `raise ValidationError({"field": "message"})`. `errors.py` turns them into the standard JSON.

6. **Add tests** in `tests/`, including one that checks another household gets a 404. Run `pytest`.

7. **Document it** in [docs/api.md](../docs/api.md).

## Rules for changes

These keep the app deployable. If you use an AI tool, paste them in when you ask for changes.

- **Keep `/health` working.** Deploys and monitoring use it to check that the app is alive.
- **All SQL goes through `vino/db.py`,** with `?` placeholders. No ORM: it can't talk to D1 through the bridge.
- **No `BEGIN` or `COMMIT`.** Use `db.batch()` for changes that must happen together. A batch only rolls back when a statement fails with an error, so protect counts with `CHECK` constraints, not `WHERE` conditions.
- **Pin exact versions.** After adding a package, put its exact version in `requirements.txt` (`Flask==3.1.3`, not `Flask`). Testing-only packages go in `requirements-dev.txt`.
- **New settings go in environment variables,** and each new one gets added to `.env.example` and the table above.
- **Don't save files to the server's disk, and don't keep logins in memory.** The disk is wiped whenever the container sleeps, and several copies may run at once. Data goes in the database, and uploaded files go to object storage (R2).
- **Database changes are new migration files,** listed in `docs/schema-changes.md`.
- **Tell Noah before you rename a setting or change the database,** so a deploy doesn't break without warning.
