# vino-mangement-app
Vino is a personal wine cellar management application designed to help users organize, track, and manage their wine collection.

## Run it locally

This runs the whole app on your computer: the backend (the server that stores accounts and wines) and the pages you click through. It takes two terminals: one for the backend, one for the pages.

The backend uses Docker, which runs the app inside a container: a sealed-off package with everything the app needs, so it runs the same way on every laptop and on the live site.

### What you need

- **Docker Desktop.** Download it from https://www.docker.com/products/docker-desktop/ and install it. Open it before running anything below, and leave it open. Nothing here works while Docker Desktop is closed.
- **Python 3**, to run the helper scripts. If you've set up the backend before, you already have it.

Run every command below from the main folder of the repo, the one with `docker-compose.yml` in it.

### Start the app

**Windows (PowerShell):**

```powershell
py scripts\start.py
```

**Mac or Linux:**

```bash
python3 scripts/start.py
```

The first time, this can take a few minutes while Docker downloads what it needs and builds the app. After that it starts in seconds. When it's ready you'll see:

```
Application is up at http://localhost:8000/health
```

### Check that it's working

Open http://localhost:8000/health in a browser. You should see `OK`.

### Load the demo cellar (optional)

This adds a demo account holding the seven sample wines. Run it once, while the app is running. Pick any password of 8 or more characters in place of `choose-a-password`.

The command is the same on Windows, Mac and Linux:

```
docker compose exec -e DEMO_PASSWORD=choose-a-password backend python -m vino.seed_demo
```

It prints the login: `demo@example.com` and the password you chose. Running it again changes nothing.

### Open the pages

In a **second** terminal, from the same main folder, start a small web server for the pages:

**Windows (PowerShell):**

```powershell
py -m http.server 5500
```

**Mac or Linux:**

```bash
python3 -m http.server 5500
```

Leave it running, and open **http://localhost:5500/login.html**. Sign up, or log in with the demo account. Press Ctrl+C in that terminal to stop the web server.

Two things to know:

- **Use `localhost`, not `127.0.0.1`.** The browser treats them as different sites, so a login made on one doesn't count on the other.
- **Opening the HTML files directly (double-clicking `login.html`) no longer works.** A page opened from a file can't keep you logged in or reach the backend, so it shows a message telling you to use the web server instead.

### Stop the app

**Windows (PowerShell):**

```powershell
py scripts\stop.py
```

**Mac or Linux:**

```bash
python3 scripts/stop.py
```

You'll see `Application has stopped.`

### Run the test

The test starts the app, checks that `/health` answers `OK`, then stops the app again.

**Windows (PowerShell):**

```powershell
py scripts\test.py
```

**Mac or Linux:**

```bash
python3 scripts/test.py
```

It ends with `PASS` or `FAIL`. On a `FAIL`, the lines just above it say what went wrong.

The test always stops the app when it finishes, even if you started it yourself beforehand. Run `start.py` again afterwards if you still need it.

### What this runs

`start.py` runs the backend: the API at http://localhost:8000/api/v1, with a local database that sets itself up on first start. The database is kept in a Docker volume called `vino-data`, so accounts and wines survive `stop.py` and restarts. Every endpoint is described in [docs/api.md](docs/api.md).

The pages (`login.html`, `welcome.html` and `vino_cellar_dashboard.html`) are served separately on port 5500 (see [Open the pages](#open-the-pages)). They get everything from the backend: nothing is saved in the browser any more, so the backend must be running. If it isn't, the pages say "Can't reach the Vino server".

To load demo data, or to start the database over, see [backend/README.md](backend/README.md#the-database).

### If something goes wrong

- **An error about connecting to Docker or the Docker daemon:** Docker Desktop isn't open, or hasn't finished starting. Open it, wait until it says it's running, then try again.
- **A long Python error ending in `FileNotFoundError`:** Docker isn't installed, or your computer can't find it. Install Docker Desktop, then close and reopen your terminal.
- **`ports are not available` or `address already in use`:** something else is already using port 8000. Usually it's the backend still running from `python app.py` in another terminal. Stop that one (Ctrl+C in its terminal), then try again.
- **Windows says `py` is not recognized:** Python isn't installed. Install it from https://www.python.org/downloads/, then close and reopen your terminal.

If you're stuck, message Noah with what you ran and the error you saw.

## Working on the backend code

To set up Python on your computer and run the backend without Docker, see [backend/README.md](backend/README.md). It also lists the rules for changes that keep the app deployable.
