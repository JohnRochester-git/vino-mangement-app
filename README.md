# vino-mangement-app
Vino is a personal wine cellar management application designed to help users organize, track, and manage their wine collection.

## Run it locally

This starts the app's backend on your computer with one command. It uses Docker, which runs the app inside a container: a sealed-off package with everything the app needs, so it runs the same way on every laptop and on the live site.

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

Only the backend. The frontend pages (`login.html` and the others) don't talk to the backend yet, so open them straight from the files in your browser.

### If something goes wrong

- **An error about connecting to Docker or the Docker daemon:** Docker Desktop isn't open, or hasn't finished starting. Open it, wait until it says it's running, then try again.
- **A long Python error ending in `FileNotFoundError`:** Docker isn't installed, or your computer can't find it. Install Docker Desktop, then close and reopen your terminal.
- **`ports are not available` or `address already in use`:** something else is already using port 8000. Usually it's the backend still running from `python app.py` in another terminal. Stop that one (Ctrl+C in its terminal), then try again.
- **Windows says `py` is not recognized:** Python isn't installed. Install it from https://www.python.org/downloads/, then close and reopen your terminal.

If you're stuck, message Noah with what you ran and the error you saw.

## Working on the backend code

To set up Python on your computer and run the backend without Docker, see [backend/README.md](backend/README.md). It also lists the rules for changes that keep the app deployable.
