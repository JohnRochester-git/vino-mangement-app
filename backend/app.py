from vino import create_app

# gunicorn runs this module-level app (see the Dockerfile: gunicorn app:app).
app = create_app()


if __name__ == "__main__":
    # Development server only. In production the app runs under gunicorn.
    app.run(host="0.0.0.0", port=8000)
