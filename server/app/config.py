"""Configuración de la aplicación vía variables de entorno."""

from __future__ import annotations

import os
from pathlib import Path

# Directorio de datos persistentes (SQLite + imágenes). En Docker es /data (volumen).
DATA_DIR = Path(os.environ.get("DATA_DIR", "./data")).resolve()

# TUNNEL=off desactiva el quick tunnel de Cloudflare (desarrollo local).
TUNNEL = os.environ.get("TUNNEL", "on").strip().lower() != "off"

# Puerto HTTP interno (el túnel apunta a este).
PORT = int(os.environ.get("PORT", "8000"))

ASSETS_DIR = DATA_DIR / "assets"
DB_PATH = DATA_DIR / "ttrpg.db"
SETTINGS_PATH = DATA_DIR / "settings.json"


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
