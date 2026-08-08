"""WebSocket: salas por campaña, snapshot al conectar, dispatch de ops."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket

from . import db, ops
from .state import AppState, Role, state
from .undo import undo_manager

log = logging.getLogger("ws")


@dataclass
class Connection:
    ws: WebSocket
    campaign_id: str
    client_id: str
    name: str
    role: Role
    cursor: tuple[float, float] | None = None
    extra: dict[str, Any] = field(default_factory=dict)


class Room:
    def __init__(self) -> None:
        self.conns: list[Connection] = []
        self.seq = 0

    def next_seq(self) -> int:
        self.seq += 1
        return self.seq


rooms: dict[str, Room] = {}


def get_room(campaign_id: str) -> Room:
    if campaign_id not in rooms:
        rooms[campaign_id] = Room()
    return rooms[campaign_id]


async def send(conn: Connection, msg: dict[str, Any]) -> None:
    await conn.ws.send_text(json.dumps(msg))


async def broadcast(room: Room, msg: dict[str, Any]) -> None:
    dead: list[Connection] = []
    text = json.dumps(msg)
    for conn in room.conns:
        try:
            await conn.ws.send_text(text)
        except Exception:  # noqa: BLE001
            dead.append(conn)
    for conn in dead:
        if conn in room.conns:
            room.conns.remove(conn)


def presence_list(room: Room) -> list[dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = {}
    for c in room.conns:
        seen[c.client_id] = {
            "clientId": c.client_id,
            "name": c.name,
            "role": c.role,
            "cursor": c.cursor,
        }
    return list(seen.values())


def _object_json(obj: db.SceneObject) -> dict[str, Any]:
    return {
        "id": obj.id,
        "type": obj.type,
        "z": obj.z_index,
        "owner": obj.owner,
        "data": json.loads(obj.data_json),
    }


def _scene_summary(s: db.Scene) -> dict[str, Any]:
    return {"id": s.id, "name": s.name, "isActive": s.is_active}


def build_snapshot(conn: Connection) -> dict[str, Any]:
    scene = state.active_scene(conn.campaign_id)
    if scene is None:
        raise ops.OpError("la campaña no tiene escena activa")
    campaign = state.campaigns[conn.campaign_id]
    assets = [a for a in state.assets.values() if a.campaign_id == conn.campaign_id]
    characters = [
        c for c in state.characters.values() if c.campaign_id == conn.campaign_id
    ]
    variants = [
        v
        for v in state.variants.values()
        if state.characters.get(v.character_id)
        and state.characters[v.character_id].campaign_id == conn.campaign_id
    ]
    return {
        "type": "scene.snapshot",
        "you": {"clientId": conn.client_id, "name": conn.name, "role": conn.role},
        "campaign": {"id": campaign.id, "name": campaign.name},
        "scene": {
            "id": scene.id,
            "name": scene.name,
            "grid": json.loads(scene.grid_config_json),
            "backgroundAssetId": scene.background_asset_id,
        },
        "scenes": [
            _scene_summary(s) for s in state.campaign_scenes(conn.campaign_id)
        ],
        "objects": [_object_json(o) for o in state.scene_objects(scene.id)],
        "users": presence_list(get_room(conn.campaign_id)),
        "library": {
            "assets": [
                {
                    "id": a.id,
                    "filename": a.filename,
                    "kind": a.kind,
                    "uploadedBy": a.uploaded_by,
                }
                for a in assets
            ],
            "characters": [{"id": c.id, "name": c.name} for c in characters],
            "variants": [
                {
                    "id": v.id,
                    "characterId": v.character_id,
                    "assetId": v.asset_id,
                    "label": v.label,
                    "sizeCells": v.size_cells,
                }
                for v in variants
            ],
        },
    }


async def broadcast_library(campaign_id: str) -> None:
    """Avisa a la sala que la biblioteca cambió (upload/variantes vía REST)."""
    room = rooms.get(campaign_id)
    if room is None:
        return
    assets = [a for a in state.assets.values() if a.campaign_id == campaign_id]
    characters = [c for c in state.characters.values() if c.campaign_id == campaign_id]
    variants = [
        v
        for v in state.variants.values()
        if state.characters.get(v.character_id)
        and state.characters[v.character_id].campaign_id == campaign_id
    ]
    await broadcast(
        room,
        {
            "type": "library.update",
            "library": {
                "assets": [
                    {
                        "id": a.id,
                        "filename": a.filename,
                        "kind": a.kind,
                        "uploadedBy": a.uploaded_by,
                    }
                    for a in assets
                ],
                "characters": [{"id": c.id, "name": c.name} for c in characters],
                "variants": [
                    {
                        "id": v.id,
                        "characterId": v.character_id,
                        "assetId": v.asset_id,
                        "label": v.label,
                        "sizeCells": v.size_cells,
                    }
                    for v in variants
                ],
            },
        },
    )


def _player_url(conn: Connection) -> str | None:
    if state.tunnel_url is None:
        return None
    campaign = state.campaigns.get(conn.campaign_id)
    if campaign is None:
        return state.tunnel_url
    return f"{state.tunnel_url}/j/{campaign.player_token}"


async def broadcast_tunnel_url(url: str | None) -> None:
    state.tunnel_url = url
    for room in rooms.values():
        for conn in room.conns:
            if conn.role == "dm":
                try:
                    await send(conn, {"type": "tunnel.url", "url": _player_url(conn)})
                except Exception:  # noqa: BLE001
                    pass


async def handle_connection(ws: WebSocket, token: str, name: str, client_id: str) -> None:
    resolved = state.resolve_token(token)
    if resolved is None:
        await ws.close(code=4401)
        return
    campaign_id, role = resolved
    scene = state.active_scene(campaign_id)
    if scene is None:
        await ws.close(code=4409)
        return

    await ws.accept()
    conn = Connection(ws=ws, campaign_id=campaign_id, client_id=client_id, name=name, role=role)
    room = get_room(campaign_id)
    room.conns.append(conn)
    try:
        await send(conn, build_snapshot(conn))
        if role == "dm":
            await send(conn, {"type": "tunnel.url", "url": _player_url(conn)})
        await broadcast(
            room,
            {"type": "presence", "users": presence_list(room)},
        )

        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            # Re-resolver la escena activa en cada mensaje: el DM pudo haber
            # cambiado de escena desde que se abrió esta conexión (si no, las
            # ops se validan/aplican contra la escena vieja).
            current = state.active_scene(campaign_id)
            if current is None:
                continue
            await dispatch(conn, room, current, msg)
    except Exception:  # noqa: BLE001 — desconexión o error de red
        pass
    finally:
        if conn in room.conns:
            room.conns.remove(conn)
        try:
            await broadcast(room, {"type": "presence", "users": presence_list(room)})
        except Exception:  # noqa: BLE001
            pass


async def dispatch(
    conn: Connection, room: Room, scene: db.Scene, msg: dict[str, Any]
) -> None:
    op_type = msg.get("type", "")
    payload = msg.get("payload") or {}
    op_id = msg.get("opId")

    if op_type == "heartbeat":
        await send(conn, {"type": "heartbeat"})
        return

    # ---- efímeras: no persisten ni entran al undo -----------------------
    if op_type == "cursor.move":
        conn.cursor = (payload.get("x", 0), payload.get("y", 0))
        await broadcast(
            room,
            {
                "type": "presence.cursor",
                "clientId": conn.client_id,
                "x": conn.cursor[0],
                "y": conn.cursor[1],
            },
        )
        return
    if op_type == "ping":
        await broadcast(
            room,
            {
                "type": "ping",
                "clientId": conn.client_id,
                "name": conn.name,
                "x": payload.get("x", 0),
                "y": payload.get("y", 0),
            },
        )
        return
    if op_type == "camera.sync":
        if conn.role != "dm":
            return
        await broadcast(
            room,
            {
                "type": "camera",
                "x": payload.get("x", 0),
                "y": payload.get("y", 0),
                "scale": payload.get("scale", 1),
            },
        )
        return

    # ---- undo / redo ------------------------------------------------------
    if op_type in ("undo", "redo"):
        await handle_undo_redo(conn, room, scene, op_type)
        return

    # ---- ops normales -----------------------------------------------------
    try:
        ops.validate(state, conn.role, conn.client_id, scene, op_type, payload)
        inverse = ops.compute_inverse(state, scene, op_type, payload)
        ops.apply(state, scene, conn.client_id, op_type, payload)
    except ops.OpError as exc:
        await send(conn, {"type": "error", "opId": op_id, "reason": str(exc)})
        return

    undo_manager.push_undo(conn.campaign_id, conn.client_id, inverse)

    prefix = op_type.split(".", 1)[0]
    if prefix == "scene":
        await state.flush()  # persistir cambio de escena/calibración de inmediato
        await broadcast_scene_state(conn, room, scene, op_type, payload)
        return

    # Normalización del broadcast
    bcast_type, bcast_payload = op_type, payload
    if op_type.endswith(".duplicate"):
        new_id = payload["newId"]
        obj = state.objects[new_id]
        bcast_type = op_type.replace(".duplicate", ".add")
        bcast_payload = {
            "id": new_id,
            "z_index": obj.z_index,
            "data": json.loads(obj.data_json),
        }
    elif op_type.endswith(".setVariant"):
        obj = state.objects[payload["id"]]
        bcast_payload = {
            "id": payload["id"],
            "variantId": payload["variantId"],
            "data": json.loads(obj.data_json),
        }

    await broadcast(
        room,
        {
            "type": "op",
            "op": {
                "type": bcast_type,
                "opId": op_id,
                "payload": bcast_payload,
                "author": conn.name,
                "clientId": conn.client_id,
                "seq": room.next_seq(),
            },
        },
    )


async def handle_undo_redo(
    conn: Connection, room: Room, scene: db.Scene, kind: str
) -> None:
    inverse = ops.undo_step(
        state, scene, undo_manager, conn.campaign_id, conn.client_id, kind
    )
    if inverse is None:
        return
    await broadcast(
        room,
        {
            "type": "op",
            "op": {
                "type": inverse["type"],
                "opId": None,
                "payload": inverse["payload"],
                "author": conn.name,
                "clientId": conn.client_id,
                "seq": room.next_seq(),
            },
        },
    )


async def broadcast_scene_state(
    conn: Connection,
    room: Room,
    scene: db.Scene,
    op_type: str,
    payload: dict[str, Any],
) -> None:
    if op_type == "scene.switch":
        # Todos siguen a la nueva escena activa: snapshot fresco para cada uno.
        for c in list(room.conns):
            try:
                await send(c, build_snapshot(c))
            except Exception:  # noqa: BLE001
                pass
        await broadcast(room, {"type": "scene.switched", "sceneId": payload["sceneId"]})
        return

    await broadcast(
        room,
        {
            "type": "scene.update",
            "scenes": [
                _scene_summary(s) for s in state.campaign_scenes(conn.campaign_id)
            ],
            "scene": {
                "id": scene.id,
                "name": scene.name,
                "grid": json.loads(scene.grid_config_json),
                "backgroundAssetId": scene.background_asset_id,
            },
        },
    )
