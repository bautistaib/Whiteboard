"""Operaciones del whiteboard: validación, aplicación al estado e inversas.

Wire format (cliente→server): {"type": "token.move", "opId": "<uuid>", "payload": {...}}
Broadcast (server→cliente):  {"type": "op", "op": {...campos + author, seq}}

Semántica de undo (spec): las inversas se aplican como ops nuevas broadcasteadas;
best-effort ante conflictos (objeto ausente → descartar; last-writer-wins).
"""

from __future__ import annotations

import copy
import json
from typing import Any

from . import db
from .grid import GridConfig
from .state import AppState, Role, touch

# prefijo → tipo de objeto en la tabla objects
OBJECT_TYPES: dict[str, str] = {
    "token": "token",
    "draw": "path",
    "shape": "shape",
    "text": "text",
    "aoe": "aoe",
    "group": "group",
}

SCENE_OPS = {"switch", "create", "rename", "setGrid", "setBackground", "delete"}
EPHEMERAL_OPS = {"cursor.move", "ping", "camera.sync", "presence.rename"}
META_OPS = {"undo", "redo"}


class OpError(Exception):
    """Op rechazada: se responde al autor con {"type": "error", ...}."""


def split_op(op_type: str) -> tuple[str, str]:
    """'token.move' → ('token', 'move')."""
    if "." not in op_type:
        raise OpError(f"tipo de op inválido: {op_type}")
    return tuple(op_type.split(".", 1))  # type: ignore[return-value]


# ---- validación de permisos ----------------------------------------------


def validate(
    state: AppState,
    role: Role,
    client_id: str,
    scene: db.Scene,
    op_type: str,
    payload: dict[str, Any],
) -> None:
    if op_type in META_OPS or op_type in EPHEMERAL_OPS:
        if op_type == "camera.sync" and role != "dm":
            raise OpError("solo el DM puede sincronizar la cámara")
        return

    prefix, action = split_op(op_type)

    if prefix == "scene":
        if role != "dm":
            raise OpError("solo el DM puede modificar escenas")
        if action not in SCENE_OPS:
            raise OpError(f"op de escena desconocida: {op_type}")
        return

    if prefix not in OBJECT_TYPES:
        raise OpError(f"tipo de op desconocido: {op_type}")

    if action == "add":
        if not payload.get("id"):
            raise OpError("add requiere id (uuid generado por el cliente)")
        return

    obj_id = payload.get("id")
    if not obj_id:
        raise OpError(f"{op_type} requiere id")
    obj = state.objects.get(obj_id)
    if obj is None or obj.scene_id != scene.id:
        raise OpError("objeto inexistente o de otra escena")

    if action in ("move", "update", "remove", "setVariant", "duplicate"):
        if role == "dm":
            return
        # Jugadores: tokens propios siempre; cualquiera si la escena lo permite.
        if obj.type == "token":
            grid = GridConfig.from_dict(json.loads(scene.grid_config_json))
            if grid.playersMoveAny or obj.owner == client_id:
                return
            raise OpError("no podés modificar tokens ajenos")
        if obj.owner == client_id:
            return
        raise OpError("solo podés modificar tus propios objetos")

    raise OpError(f"acción desconocida: {op_type}")


# ---- aplicación al estado -------------------------------------------------


def apply(
    state: AppState,
    scene: db.Scene,
    client_id: str,
    op_type: str,
    payload: dict[str, Any],
) -> None:
    """Muta el estado en memoria y marca dirty. Asume op ya validada."""
    prefix, action = split_op(op_type)

    if prefix == "scene":
        _apply_scene(state, scene, action, payload)
        return

    obj_type = OBJECT_TYPES[prefix]

    if action == "add" or action == "duplicate":
        data = payload.get("data", {})
        if action == "duplicate":
            src = state.objects[payload["id"]]
            data = copy.deepcopy(json.loads(src.data_json))
            data["x"] = payload.get("x", data.get("x", 0))
            data["y"] = payload.get("y", data.get("y", 0))
        new_id = payload.get("newId") if action == "duplicate" else payload.get("id")
        assert new_id
        obj = db.SceneObject(
            id=new_id,
            scene_id=scene.id,
            type=obj_type,
            z_index=int(payload.get("z_index", _next_z(state, scene.id))),
            owner=client_id,
            data_json=json.dumps(data),
        )
        touch(obj)
        state.objects[obj.id] = obj
        state.mark_dirty(obj)
        return

    obj = state.objects[payload["id"]]
    data = json.loads(obj.data_json)

    if action == "move":
        data["x"], data["y"] = payload["x"], payload["y"]
    elif action == "update":
        patch = payload.get("patch", {})
        data.update(patch)
    elif action == "setVariant":
        data["active_variant_id"] = payload["variantId"]
        variant = state.variants.get(payload["variantId"])
        if variant is not None:
            data["asset_id"] = variant.asset_id
            data["size_cells"] = variant.size_cells
    elif action == "remove":
        del state.objects[obj.id]
        state.mark_deleted(obj)
        return
    else:
        raise OpError(f"acción desconocida: {op_type}")

    obj.data_json = json.dumps(data)
    touch(obj)
    state.mark_dirty(obj)


def _apply_scene(
    state: AppState, scene: db.Scene, action: str, payload: dict[str, Any]
) -> None:
    if action == "setGrid":
        scene.grid_config_json = json.dumps(payload.get("grid", {}))
        state.mark_dirty(scene)
    elif action == "setBackground":
        scene.background_asset_id = payload.get("assetId")
        state.mark_dirty(scene)
    elif action == "rename":
        target = state.scenes.get(payload.get("sceneId", scene.id))
        if target is None or target.campaign_id != scene.campaign_id:
            raise OpError("escena inexistente o de otra campaña")
        target.name = payload["name"]
        state.mark_dirty(target)
    elif action == "create":
        campaign_id = scene.campaign_id
        new_scene = db.Scene(
            id=payload["id"],
            campaign_id=campaign_id,
            name=payload.get("name", "Nueva escena"),
            grid_config_json=json.dumps(GridConfig().to_dict()),
            is_active=False,
            sort_order=len(state.campaign_scenes(campaign_id)),
        )
        state.scenes[new_scene.id] = new_scene
        state.mark_dirty(new_scene)
    elif action == "switch":
        target = state.scenes.get(payload["sceneId"])
        if target is None:
            raise OpError("escena inexistente")
        if target.campaign_id != scene.campaign_id:
            raise OpError("escena de otra campaña")
        scene.is_active = False
        state.mark_dirty(scene)
        target.is_active = True
        state.mark_dirty(target)
    elif action == "delete":
        target = state.scenes.get(payload["sceneId"])
        if target is None or target.campaign_id != scene.campaign_id:
            raise OpError("escena inexistente o de otra campaña")
        if target.is_active:
            raise OpError("no se puede borrar la escena activa")
        if len(state.campaign_scenes(scene.campaign_id)) <= 1:
            raise OpError("no se puede borrar la última escena")
        for obj in [o for o in state.objects.values() if o.scene_id == target.id]:
            state.mark_deleted(obj)
            del state.objects[obj.id]
        state.mark_deleted(target)
        del state.scenes[target.id]
    else:
        raise OpError(f"op de escena desconocida: {action}")


def _next_z(state: AppState, scene_id: str) -> int:
    top = 0
    for o in state.objects.values():
        if o.scene_id == scene_id:
            top = max(top, o.z_index)
    return top + 1


# ---- inversas (para undo por usuario) --------------------------------------


def compute_inverse(
    state: AppState,
    scene: db.Scene,
    op_type: str,
    payload: dict[str, Any],
) -> dict[str, Any] | None:
    """Inversa de una op de objetos. None si no es deshacible (escena/efímera)."""
    prefix, action = split_op(op_type)
    if prefix not in OBJECT_TYPES:
        return None

    if action == "add":
        return {"type": f"{prefix}.remove", "payload": {"id": payload["id"]}}

    if action == "duplicate":
        return {"type": f"{prefix}.remove", "payload": {"id": payload["newId"]}}

    if action == "remove":
        obj = state.objects.get(payload["id"])
        if obj is None:
            return None
        return {
            "type": f"{prefix}.add",
            "payload": {
                "id": obj.id,
                "z_index": obj.z_index,
                # escena donde se borró: si el DM cambió de escena, la
                # recreación se descarta (no resucita en la escena activa)
                "scene_id": obj.scene_id,
                "data": json.loads(obj.data_json),
            },
        }

    obj = state.objects.get(payload["id"])
    if obj is None:
        return None
    data = json.loads(obj.data_json)

    if action == "move":
        return {
            "type": f"{prefix}.move",
            "payload": {"id": obj.id, "x": data.get("x", 0), "y": data.get("y", 0)},
        }
    if action == "update":
        # snapshot completo previo: la inversa pisa con last-writer-wins
        return {
            "type": f"{prefix}.restore",
            "payload": {"id": obj.id, "data": data},
        }
    if action == "setVariant":
        return {
            "type": f"{prefix}.restore",
            "payload": {"id": obj.id, "data": data},
        }
    if action == "restore":
        # inversa de una inversa (para redo): snapshot del estado actual
        return {
            "type": f"{prefix}.restore",
            "payload": {"id": obj.id, "data": data},
        }
    return None


def apply_inverse(
    state: AppState,
    scene: db.Scene,
    client_id: str,
    inverse: dict[str, Any],
) -> bool:
    """Aplica una inversa. False si se descartó (objeto ausente, per spec)."""
    op_type = inverse["type"]
    payload = inverse["payload"]
    prefix, action = split_op(op_type)

    if action == "restore":
        obj = state.objects.get(payload["id"])
        if obj is None or obj.scene_id != scene.id:
            return False
        obj.data_json = json.dumps(payload["data"])
        touch(obj)
        state.mark_dirty(obj)
        return True

    if action in ("move", "remove"):
        obj = state.objects.get(payload["id"])
        if obj is None or obj.scene_id != scene.id:
            return False  # descartar y seguir con el anterior
        apply(state, scene, client_id, op_type, payload)
        return True

    if action == "add":
        # recrear objeto borrado (idempotente por uuid del cliente).
        # Solo si seguimos en la escena donde se borró: las demás ramas
        # descartan cuando el objeto no es de la escena activa; acá no hay
        # objeto que chequear, así que manda el scene_id registrado.
        if payload.get("scene_id") != scene.id:
            return False
        apply(state, scene, client_id, op_type, payload)
        return True

    raise OpError(f"inversa desconocida: {op_type}")


def undo_step(
    state: AppState,
    scene: db.Scene,
    undo_mgr: Any,
    campaign_id: str,
    client_id: str,
    kind: str,  # "undo" | "redo"
) -> dict[str, Any] | None:
    """Un paso de undo/redo: devuelve la inversa aplicada (para broadcast).

    Si la inversa se descarta (objeto ausente), sigue con la anterior (spec).
    """
    import logging

    log = logging.getLogger("ops.undo")
    guard = 0
    while guard < 50:
        guard += 1
        if kind == "undo":
            inverse = undo_mgr.pop_undo(campaign_id, client_id)
        else:
            inverse = undo_mgr.pop_redo(campaign_id, client_id)
        if inverse is None:
            return None

        re_inverse = compute_inverse(state, scene, inverse["type"], inverse["payload"])
        try:
            applied = apply_inverse(state, scene, client_id, inverse)
        except OpError:
            applied = False
        if not applied:
            log.info("inversa descartada (%s de %s): %s", kind, client_id, inverse)
            continue

        if re_inverse is not None:
            if kind == "undo":
                undo_mgr.push_redo(campaign_id, client_id, re_inverse)
            else:
                undo_mgr.push_undo_from_redo(campaign_id, client_id, re_inverse)
        return inverse
    return None
