"""Settings, read from environment variables.

Every setting the app reads is listed here and in backend/.env.example.
"""

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = BACKEND_DIR / "migrations"


def _bool(name, default):
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def _int(name, default):
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        return default
    return int(value)


def _list(name):
    value = os.environ.get(name, "")
    return [item.strip().rstrip("/") for item in value.split(",") if item.strip()]


@dataclass
class Config:
    flask_env: str = "production"
    db_backend: str = "sqlite"
    sqlite_path: str = str(BACKEND_DIR / "vino.db")
    d1_bridge_url: str = ""
    d1_timeout: float = 10.0
    auto_migrate: bool = True
    allowed_origins: list = field(default_factory=list)
    cookie_secure: bool = False
    session_days: int = 14
    barcode_provider: str = "none"
    barcode_api_key: str = ""
    barcode_contact: str = ""
    provider_timeout: float = 3.0
    max_content_length: int = 2 * 1024 * 1024

    @classmethod
    def from_env(cls):
        return cls(
            flask_env=os.environ.get("FLASK_ENV", "production"),
            db_backend=os.environ.get("DB_BACKEND", "sqlite").strip().lower(),
            sqlite_path=os.environ.get("SQLITE_PATH", str(BACKEND_DIR / "vino.db")),
            d1_bridge_url=os.environ.get("D1_BRIDGE_URL", "").rstrip("/"),
            d1_timeout=float(os.environ.get("D1_TIMEOUT", "10")),
            auto_migrate=_bool("AUTO_MIGRATE", True),
            allowed_origins=_list("ALLOWED_ORIGINS"),
            cookie_secure=_bool("COOKIE_SECURE", False),
            session_days=_int("SESSION_DAYS", 14),
            barcode_provider=os.environ.get("BARCODE_PROVIDER", "none").strip().lower(),
            barcode_api_key=os.environ.get("BARCODE_API_KEY", ""),
            barcode_contact=os.environ.get("BARCODE_CONTACT", ""),
        )

    def validate(self):
        if self.db_backend not in ("sqlite", "d1"):
            raise ValueError("DB_BACKEND must be 'sqlite' or 'd1'")
        if self.db_backend == "d1" and not self.d1_bridge_url:
            raise ValueError("D1_BRIDGE_URL is required when DB_BACKEND=d1")
        if self.session_days < 1:
            raise ValueError("SESSION_DAYS must be at least 1")
