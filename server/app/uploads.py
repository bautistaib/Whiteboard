"""Uploads de imágenes: validación, recompresión a WebP y guardado en disco.

Límites (spec): 10 MB por imagen; mapas máx. 4096 px de lado, tokens máx. 512 px.
Los archivos son inmutables (nombre uuid) → cache headers agresivos al servir.
"""

from __future__ import annotations

import io
import uuid

from PIL import Image

from . import config

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_SIDE = {"map": 4096, "token": 512, "other": 2048}


class UploadError(Exception):
    pass


def process_image(content: bytes, kind: str) -> str:
    """Valida y recomprime a WebP. Devuelve el filename guardado."""
    if len(content) > MAX_UPLOAD_BYTES:
        raise UploadError("la imagen supera el límite de 10 MB")
    try:
        img = Image.open(io.BytesIO(content))
        img.load()
    except Exception as exc:  # noqa: BLE001
        raise UploadError("el archivo no es una imagen válida") from exc

    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if "transparency" in img.info or "A" in img.mode else "RGB")

    max_side = MAX_SIDE.get(kind, MAX_SIDE["other"])
    if max(img.size) > max_side:
        scale = max_side / max(img.size)
        new_size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
        img = img.resize(new_size, Image.Resampling.LANCZOS)

    filename = f"{uuid.uuid4().hex}.webp"
    config.ensure_dirs()
    out = config.ASSETS_DIR / filename
    img.save(out, "WEBP", quality=85, method=4)
    return filename
