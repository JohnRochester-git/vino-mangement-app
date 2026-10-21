import os

from flask import Flask

app = Flask(__name__)


@app.get("/health")
def health():
    return "OK", 200


if __name__ == "__main__":
    # Development server only. In production the app runs under gunicorn.
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
