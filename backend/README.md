# Backend

The Python backend for the Wine Cellar app, built with Flask. Right now it's a skeleton: it runs and answers a health check, and features get built on top of it.

## Set it up (first time only)

From the `backend/` folder.

**Windows (PowerShell):**

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

If PowerShell says running scripts is disabled, run this once, then try again:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

**Mac or Linux:**

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

The `.venv` folder is a private Python install for this project, so packages don't mix with the rest of your computer. Turn it on again (the second line above) each time you open a new terminal. You'll see `(.venv)` at the start of the prompt when it's on.

## Run it

On any computer, start the development server:

```bash
python app.py
```

This is what you'll use day to day.

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

## Settings

Settings come from environment variables, not from the code. `.env.example` lists every setting the app reads, with no real values.

| Setting | What it does | Default |
| --- | --- | --- |
| `PORT` | Port the development server listens on | `8000` |

Never put real keys or passwords in the code, and never commit a `.env` file. Git is set to ignore `.env`.

## Rules for changes

These keep the app deployable. If you use an AI tool, paste them in when you ask for changes.

- **Keep `/health` working.** Deploys and monitoring use it to check that the app is alive.
- **Pin exact versions.** After adding a package, run `pip freeze > requirements.txt` so every version is exact (`Flask==3.1.3`, not `Flask`).
- **New settings go in environment variables,** and each new one gets added to `.env.example` and the table above.
- **Don't save files to the server's disk.** It's wiped whenever the server restarts. Data goes in the database, and uploaded files go to object storage.
- **Tell Noah before you rename a setting or change the database,** so a deploy doesn't break without warning.
