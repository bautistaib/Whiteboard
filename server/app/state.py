"""Estado autoritativo en memoria.

El servidor mantiene el estado completo en dicts en memoria; SQLite es solo
persistencia write-through con flush debounced (~1 s). Al arrancar se carga
todo con `load_from_db`.
"""

from __future__ import annotations

import asyncio
import time
from typing import Literal

from . import db

Role = Literal["dm", "player"]

FLUSH_INTERVAL = 1.0


class AppState:
    def __init__(self) -> None:
        self.campaigns: dict[str, db.Campaign] = {}
        self.scenes: dict[str, db.Scene] = {}
        self.assets: dict[str, db.Asset] = {}
        self.characters: dict[str, db.Character] = {}
        self.variants: dict[str, db.CharacterVariant] = {}
        self.objects: dict[str, db.SceneObject] = {}

        # token de acceso → (campaign_id, role)
        self.tokens: dict[str, tuple[str, Role]] = {}

        # URL pública del quick tunnel de Cloudflare (None si no hay)
        self.tunnel_url: str | None = None

        # Dirty tracking para el flush debounced
        self._dirty: dict[str, db.SQLModel] = {}
        self._deleted: list[db.SQLModel] = []
        self._flush_task: asyncio.Task | None = None

    # ---- carga inicial -------------------------------------------------

    def load_from_db(self) -> None:
        data = db.load_all()
        for c in data.campaigns:
            self.campaigns[c.id] = c
            self.tokens[c.dm_token] = (c.id, "dm")
            self.tokens[c.player_token] = (c.id, "player")
        for s in data.scenes:
            self.scenes[s.id] = s
        for a in data.assets:
            self.assets[a.id] = a
        for ch in data.characters:
            self.characters[ch.id] = ch
        for v in data.character_variants:
            self.variants[v.id] = v
        for o in data.objects:
            self.objects[o.id] = o

    # ---- resolución de tokens ------------------------------------------

    def resolve_token(self, token: str) -> tuple[str, Role] | None:
        return self.tokens.get(token)

    # ---- helpers de dominio ---------------------------------------------

    def active_scene(self, campaign_id: str) -> db.Scene | None:
        for scene in self.scenes.values():
            if scene.campaign_id == campaign_id and scene.is_active:
                return scene
        return None

    def campaign_scenes(self, campaign_id: str) -> list[db.Scene]:
        scenes = [s for s in self.scenes.values() if s.campaign_id == campaign_id]
        return sorted(scenes, key=lambda s: (s.sort_order, s.name))

    def scene_objects(self, scene_id: str) -> list[db.SceneObject]:
        objs = [o for o in self.objects.values() if o.scene_id == scene_id]
        return sorted(objs, key=lambda o: o.z_index)

    # ---- dirty tracking / flush -----------------------------------------

    def mark_dirty(self, row: db.SQLModel) -> None:
        key = f"{row.__class__.__name__}:{getattr(row, 'id', '')}"
        self._dirty[key] = row

    def mark_deleted(self, row: db.SQLModel) -> None:
        key = f"{row.__class__.__name__}:{getattr(row, 'id', '')}"
        self._dirty.pop(key, None)
        self._deleted.append(row)

    async def flush(self) -> None:
        if not self._dirty and not self._deleted:
            return
        dirty = list(self._dirty.values())
        deleted = self._deleted[:]
        self._dirty.clear()
        self._deleted.clear()
        # SQLite síncrono: correr fuera del loop para no bloquear el WS.
        await asyncio.to_thread(db.upsert_many, dirty)
        if deleted:
            await asyncio.to_thread(db.delete_many, deleted)

    async def _flush_loop(self) -> None:
        while True:
            await asyncio.sleep(FLUSH_INTERVAL)
            try:
                await self.flush()
            except Exception:  # noqa: BLE001 — nunca matar el loop de flush
                import logging

                logging.getLogger("state").exception("error en flush de DB")

    def start_flush_loop(self) -> None:
        if self._flush_task is None:
            self._flush_task = asyncio.create_task(self._flush_loop())

    async def stop_flush_loop(self) -> None:
        if self._flush_task is not None:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass
            self._flush_task = None
        await self.flush()


def touch(obj: db.SceneObject) -> None:
    obj.updated_at = time.time()


state = AppState()
