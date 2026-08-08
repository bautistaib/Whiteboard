"""App factory: estáticos, REST, WebSocket, startup (DB + túnel)."""

from __future__ import annotations

import json
import logging
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Query, UploadFile, WebSocket
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import config, db, uploads, ws
from .grid import GridConfig
from .state import state
from .tunnel import tunnel_manager
from .undo import undo_manager

log = logging.getLogger("main")

WEB_DIST = Path(__file__).resolve().parent.parent / "web_dist"


class CreateCampaign(BaseModel):
    name: str = "Mi campaña"
    # token de DM de una campaña existente (prueba de que ya sos DM del server)
    dm: str = ""


def _is_dm_token(token: str) -> bool:
    resolved = state.resolve_token(token) if token else None
    return resolved is not None and resolved[1] == "dm"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logging.basicConfig(level=logging.INFO)
    config.ensure_dirs()
    db.get_engine()
    state.load_from_db()
    state.load_settings()
    state.start_flush_loop()
    await tunnel_manager.start(ws.broadcast_tunnel_url)
    yield
    await tunnel_manager.stop()
    await state.stop_flush_loop()


def create_app() -> FastAPI:
    app = FastAPI(title="Whiteboard TTRPG", lifespan=lifespan)

    # ---- WebSocket ------------------------------------------------------
    @app.websocket("/ws/{token}")
    async def websocket_endpoint(
        ws_conn: WebSocket,
        token: str,
        name: str = Query(default="Anónimo"),
        clientId: str = Query(default=""),
    ) -> None:
        await ws.handle_connection(ws_conn, token, name[:32] or "Anónimo", clientId or uuid.uuid4().hex)

    # ---- REST: campañas y acceso -----------------------------------------
    @app.post("/api/campaigns")
    async def create_campaign(body: CreateCampaign):
        # La primera campaña del server es libre (bootstrap); después hay que
        # probar que ya sos DM (evita que cualquier jugador cree campañas).
        if state.campaigns and not _is_dm_token(body.dm):
            raise HTTPException(status_code=403, detail="solo el DM puede crear campañas")
        campaign_id = uuid.uuid4().hex
        dm_token = secrets.token_urlsafe(16)
        player_token = secrets.token_urlsafe(16)
        campaign = db.Campaign(
            id=campaign_id,
            name=body.name.strip() or "Mi campaña",
            dm_token=dm_token,
            player_token=player_token,
            created_at=time.time(),
        )
        scene = db.Scene(
            id=uuid.uuid4().hex,
            campaign_id=campaign_id,
            name="Escena 1",
            grid_config_json=json.dumps(
                {**GridConfig().to_dict(), **state.default_grid}
            ),
            is_active=True,
            sort_order=0,
        )
        state.campaigns[campaign.id] = campaign
        state.tokens[dm_token] = (campaign_id, "dm")
        state.tokens[player_token] = (campaign_id, "player")
        state.scenes[scene.id] = scene
        state.mark_dirty(campaign)
        state.mark_dirty(scene)
        await state.flush()
        return {
            "dm_url": f"/dm/{dm_token}",
            "player_url": f"/j/{player_token}",
        }

    @app.get("/api/campaigns")
    async def list_campaigns(dm: str = Query(default="")):
        """Lista de campañas existentes (para reabrir sin crear una nueva).

        Incluye los links de DM: exige un token de DM válido si ya hay
        campañas (los jugadores no pueden ver esta lista).
        """
        campaigns = sorted(
            state.campaigns.values(), key=lambda c: c.created_at, reverse=True
        )
        if campaigns and not _is_dm_token(dm):
            raise HTTPException(
                status_code=403, detail="solo el DM puede listar las campañas"
            )
        return [
            {
                "id": c.id,
                "name": c.name,
                "dm_url": f"/dm/{c.dm_token}",
                "player_url": f"/j/{c.player_token}",
                "created_at": c.created_at,
            }
            for c in campaigns
        ]

    @app.delete("/api/campaigns/{token}")
    async def delete_campaign(token: str):
        """Borra una campaña y todo lo que contiene (solo su DM)."""
        resolved = state.resolve_token(token)
        if resolved is None:
            raise HTTPException(status_code=404, detail="link inválido")
        campaign_id, role = resolved
        if role != "dm":
            raise HTTPException(status_code=403, detail="solo el DM puede borrar la campaña")
        campaign = state.campaigns[campaign_id]

        # cascada: objetos → escenas → variantes → personajes → assets (+archivos)
        scene_ids = {
            s.id for s in state.scenes.values() if s.campaign_id == campaign_id
        }
        for obj in [o for o in state.objects.values() if o.scene_id in scene_ids]:
            state.mark_deleted(obj)
            del state.objects[obj.id]
        for s in [s for s in state.scenes.values() if s.campaign_id == campaign_id]:
            state.mark_deleted(s)
            del state.scenes[s.id]
        char_ids = {
            c.id for c in state.characters.values() if c.campaign_id == campaign_id
        }
        for v in [v for v in state.variants.values() if v.character_id in char_ids]:
            state.mark_deleted(v)
            del state.variants[v.id]
        for c in [c for c in state.characters.values() if c.campaign_id == campaign_id]:
            state.mark_deleted(c)
            del state.characters[c.id]
        for a in [a for a in state.assets.values() if a.campaign_id == campaign_id]:
            state.mark_deleted(a)
            del state.assets[a.id]
            file_path = config.ASSETS_DIR / a.filename
            if file_path.exists():
                file_path.unlink()
        state.mark_deleted(campaign)
        del state.campaigns[campaign_id]
        state.tokens.pop(campaign.dm_token, None)
        state.tokens.pop(campaign.player_token, None)
        undo_manager.clear_campaign(campaign_id)
        await state.flush()

        # cerrar la sala: la campaña deja de existir
        room = ws.rooms.pop(campaign_id, None)
        if room is not None:
            for conn in list(room.conns):
                try:
                    await conn.ws.close(code=4409)
                except Exception:  # noqa: BLE001 — ya estaba caída
                    pass
        return {"ok": True}

    @app.get("/api/settings")
    async def get_settings():
        return {"defaultGrid": state.default_grid}

    @app.post("/api/settings")
    async def save_settings(body: dict):
        state.save_settings(body.get("defaultGrid", {}))
        return {"ok": True}

    @app.get("/api/session/{token}")
    async def session_info(token: str):
        resolved = state.resolve_token(token)
        if resolved is None:
            raise HTTPException(status_code=404, detail="link inválido")
        campaign_id, role = resolved
        campaign = state.campaigns[campaign_id]
        return {"role": role, "campaignName": campaign.name}

    # ---- REST: uploads y biblioteca ---------------------------------------
    @app.post("/api/upload/{token}")
    async def upload_image(
        token: str,
        file: UploadFile = File(...),
        kind: str = Query(default="token"),
        name: str = Query(default=""),
        characterId: str = Query(default=""),
        variantLabel: str = Query(default=""),
        sizeCells: int = Query(default=1),
    ):
        resolved = state.resolve_token(token)
        if resolved is None:
            raise HTTPException(status_code=403, detail="link inválido")
        campaign_id, _role = resolved
        if kind not in ("token", "map", "other"):
            raise HTTPException(status_code=400, detail="kind inválido")

        content = await file.read()
        try:
            filename = uploads.process_image(content, kind)
        except uploads.UploadError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        asset = db.Asset(
            id=uuid.uuid4().hex,
            campaign_id=campaign_id,
            filename=filename,
            kind=kind,
            uploaded_by=name,
            created_at=time.time(),
        )
        state.assets[asset.id] = asset
        state.mark_dirty(asset)

        # Si viene characterId (o es token sin personaje), mantener el modelo
        # personaje+variantes: un asset suelto de token crea su personaje.
        character_id = characterId
        variant_id = ""
        if kind == "token":
            if not character_id:
                character = db.Character(
                    id=uuid.uuid4().hex,
                    campaign_id=campaign_id,
                    name=name or (file.filename or "Token"),
                )
                state.characters[character.id] = character
                state.mark_dirty(character)
                character_id = character.id
            variant = db.CharacterVariant(
                id=uuid.uuid4().hex,
                character_id=character_id,
                asset_id=asset.id,
                label=variantLabel or "Base",
                size_cells=max(1, sizeCells),
                sort_order=len(
                    [v for v in state.variants.values() if v.character_id == character_id]
                ),
            )
            state.variants[variant.id] = variant
            state.mark_dirty(variant)
            variant_id = variant.id

        await state.flush()
        await ws.broadcast_library(campaign_id)
        return {
            "id": asset.id,
            "filename": filename,
            "characterId": character_id,
            "variantId": variant_id,
        }

    @app.post("/api/characters/{token}/{character_id}/variants")
    async def add_variant(
        token: str,
        character_id: str,
        assetId: str = Query(...),
        label: str = Query(default=""),
        sizeCells: int = Query(default=1),
    ):
        resolved = state.resolve_token(token)
        if resolved is None:
            raise HTTPException(status_code=403, detail="link inválido")
        campaign_id, _role = resolved
        character = state.characters.get(character_id)
        asset = state.assets.get(assetId)
        if character is None or character.campaign_id != campaign_id:
            raise HTTPException(status_code=404, detail="personaje inexistente")
        if asset is None or asset.campaign_id != campaign_id:
            raise HTTPException(status_code=404, detail="asset inexistente")
        variant = db.CharacterVariant(
            id=uuid.uuid4().hex,
            character_id=character_id,
            asset_id=assetId,
            label=label or "Variante",
            size_cells=max(1, sizeCells),
            sort_order=len(
                [v for v in state.variants.values() if v.character_id == character_id]
            ),
        )
        state.variants[variant.id] = variant
        state.mark_dirty(variant)
        await state.flush()
        await ws.broadcast_library(campaign_id)
        return {"id": variant.id}

    @app.delete("/api/assets/{token}/{asset_id}")
    async def delete_asset(token: str, asset_id: str, name: str = Query(default="")):
        resolved = state.resolve_token(token)
        if resolved is None:
            raise HTTPException(status_code=403, detail="link inválido")
        campaign_id, role = resolved
        asset = state.assets.get(asset_id)
        if asset is None or asset.campaign_id != campaign_id:
            raise HTTPException(status_code=404, detail="asset inexistente")
        if role != "dm" and asset.uploaded_by != name:
            raise HTTPException(status_code=403, detail="solo el DM o quien lo subió")

        # borrar variantes que lo referencian (y personajes que queden vacíos)
        for variant in list(state.variants.values()):
            if variant.asset_id == asset_id:
                state.mark_deleted(variant)
                del state.variants[variant.id]
        for character in list(state.characters.values()):
            if character.campaign_id != campaign_id:
                continue
            remaining = [
                v for v in state.variants.values() if v.character_id == character.id
            ]
            if not remaining:
                state.mark_deleted(character)
                del state.characters[character.id]

        state.mark_deleted(asset)
        del state.assets[asset_id]
        file_path = config.ASSETS_DIR / asset.filename
        if file_path.exists():
            file_path.unlink()
        await state.flush()
        await ws.broadcast_library(campaign_id)
        return {"ok": True}

    # ---- assets en disco (inmutables: cache agresivo) ----------------------
    @app.get("/assets/{filename}")
    async def serve_asset(filename: str):
        if "/" in filename or "\\" in filename or ".." in filename:
            raise HTTPException(status_code=400, detail="filename inválido")
        path = config.ASSETS_DIR / filename
        if not path.exists():
            raise HTTPException(status_code=404, detail="no encontrado")
        return FileResponse(
            path,
            media_type="image/webp",
            headers={"Cache-Control": "public, max-age=31536000, immutable"},
        )

    # ---- estado del túnel (para el banner del DM) ---------------------------
    @app.get("/api/tunnel/{token}")
    async def tunnel_info(token: str):
        resolved = state.resolve_token(token)
        if resolved is None:
            raise HTTPException(status_code=403, detail="link inválido")
        campaign_id, role = resolved
        if role != "dm":
            raise HTTPException(status_code=403, detail="solo el DM")
        campaign = state.campaigns[campaign_id]
        player_url = (
            f"{state.tunnel_url}/j/{campaign.player_token}" if state.tunnel_url else None
        )
        return {"url": state.tunnel_url, "player_url": player_url}

    # ---- frontend estático (SPA) --------------------------------------------
    if WEB_DIST.exists():
        from fastapi.staticfiles import StaticFiles

        app.mount(
            "/static",
            StaticFiles(directory=WEB_DIST / "static"),
            name="static",
        )

        @app.get("/{full_path:path}")
        async def spa_fallback(full_path: str):
            index = WEB_DIST / "index.html"
            if not index.exists():
                raise HTTPException(status_code=404, detail="frontend no buildeado")
            return FileResponse(index)

    return app


app = create_app()
