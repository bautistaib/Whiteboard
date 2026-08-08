"""Tests de aplicación de ops, permisos e inversas (undo por usuario)."""

import json

import pytest

from app import ops
from app.state import state

DM = ("dm", "dm-client")
PLAYER = ("player", "player-client")


def add_token(scene, client_id="dm-client", obj_id="tok1", x=0, y=0):
    ops.apply(
        state,
        scene,
        client_id,
        "token.add",
        {"id": obj_id, "data": {"x": x, "y": y, "asset_id": "a1", "size_cells": 1}},
    )
    return state.objects[obj_id]


# ---- aplicación básica ----------------------------------------------------


def test_token_add_and_move(campaign):
    scene = campaign["scene"]
    add_token(scene)
    ops.apply(state, scene, "dm-client", "token.move", {"id": "tok1", "x": 5, "y": 7})
    data = json.loads(state.objects["tok1"].data_json)
    assert (data["x"], data["y"]) == (5, 7)


def test_add_is_idempotent_by_client_uuid(campaign):
    scene = campaign["scene"]
    payload = {"id": "tok1", "data": {"x": 1, "y": 1}}
    ops.apply(state, scene, "dm-client", "token.add", payload)
    ops.apply(state, scene, "dm-client", "token.add", payload)  # retry de reconexión
    assert len([o for o in state.objects.values() if o.id == "tok1"]) == 1


def test_update_merges_patch(campaign):
    scene = campaign["scene"]
    add_token(scene)
    ops.apply(
        state, scene, "dm-client", "token.update",
        {"id": "tok1", "patch": {"name": "Goblin", "rotation": 90}},
    )
    data = json.loads(state.objects["tok1"].data_json)
    assert data["name"] == "Goblin"
    assert data["rotation"] == 90
    assert data["x"] == 0  # no pisa lo que no viene en el patch


def test_remove(campaign):
    scene = campaign["scene"]
    add_token(scene)
    ops.apply(state, scene, "dm-client", "token.remove", {"id": "tok1"})
    assert "tok1" not in state.objects


# ---- permisos ---------------------------------------------------------------


def test_player_cannot_touch_scene(campaign):
    scene = campaign["scene"]
    with pytest.raises(ops.OpError):
        ops.validate(state, "player", "player-client", scene, "scene.switch", {"sceneId": "x"})
    with pytest.raises(ops.OpError):
        ops.validate(state, "player", "player-client", scene, "scene.setGrid", {"grid": {}})


def test_player_moves_own_token_but_not_others(campaign):
    scene = campaign["scene"]
    grid = json.loads(scene.grid_config_json)
    grid["playersMoveAny"] = False  # default es True; acá probamos el modo restrictivo
    scene.grid_config_json = json.dumps(grid)
    add_token(scene, client_id="player-client", obj_id="mine")
    add_token(scene, client_id="other-client", obj_id="theirs")
    ops.validate(state, "player", "player-client", scene, "token.move",
                 {"id": "mine", "x": 1, "y": 1})
    with pytest.raises(ops.OpError):
        ops.validate(state, "player", "player-client", scene, "token.move",
                     {"id": "theirs", "x": 1, "y": 1})


def test_player_moves_any_token_when_scene_allows(campaign):
    scene = campaign["scene"]
    grid = json.loads(scene.grid_config_json)
    grid["playersMoveAny"] = True
    scene.grid_config_json = json.dumps(grid)
    add_token(scene, client_id="other-client", obj_id="theirs")
    ops.validate(state, "player", "player-client", scene, "token.move",
                 {"id": "theirs", "x": 1, "y": 1})


def test_player_deletes_own_drawing_only(campaign):
    scene = campaign["scene"]
    ops.apply(state, scene, "player-client", "draw.add",
              {"id": "d1", "data": {"points": [0, 0, 10, 10], "color": "#f00"}})
    ops.apply(state, scene, "other-client", "draw.add",
              {"id": "d2", "data": {"points": [0, 0, 5, 5], "color": "#0f0"}})
    ops.validate(state, "player", "player-client", scene, "draw.remove", {"id": "d1"})
    with pytest.raises(ops.OpError):
        ops.validate(state, "player", "player-client", scene, "draw.remove", {"id": "d2"})
    # el DM borra cualquiera
    ops.validate(state, "dm", "dm-client", scene, "draw.remove", {"id": "d2"})


def test_player_only_dm_camera_sync(campaign):
    scene = campaign["scene"]
    with pytest.raises(ops.OpError):
        ops.validate(state, "player", "player-client", scene, "camera.sync", {})
    ops.validate(state, "dm", "dm-client", scene, "camera.sync", {})


def test_op_on_other_scene_rejected(campaign):
    scene = campaign["scene"]
    ops.apply(state, scene, "dm-client", "token.add",
              {"id": "t-other", "data": {"x": 0, "y": 0}})
    # forzar objeto en otra escena
    state.objects["t-other"].scene_id = "otra-escena"
    with pytest.raises(ops.OpError):
        ops.validate(state, "dm", "dm-client", scene, "token.move",
                     {"id": "t-other", "x": 1, "y": 1})


# ---- inversas ----------------------------------------------------------------


def test_inverse_of_add_is_remove(campaign):
    scene = campaign["scene"]
    payload = {"id": "tok1", "data": {"x": 0, "y": 0}}
    inv = ops.compute_inverse(state, scene, "token.add", payload)
    assert inv == {"type": "token.remove", "payload": {"id": "tok1"}}


def test_inverse_of_remove_recreates_with_snapshot(campaign):
    scene = campaign["scene"]
    add_token(scene, x=3, y=4)
    inv = ops.compute_inverse(state, scene, "token.remove", {"id": "tok1"})
    assert inv is not None
    assert inv["type"] == "token.add"
    assert inv["payload"]["id"] == "tok1"
    assert inv["payload"]["data"]["x"] == 3


def test_inverse_of_move_is_move_back(campaign):
    scene = campaign["scene"]
    add_token(scene, x=3, y=4)
    inv = ops.compute_inverse(state, scene, "token.move", {"id": "tok1", "x": 9, "y": 9})
    assert inv == {"type": "token.move", "payload": {"id": "tok1", "x": 3, "y": 4}}


def test_inverse_of_update_is_full_restore(campaign):
    scene = campaign["scene"]
    add_token(scene)
    before = json.loads(state.objects["tok1"].data_json)
    inv = ops.compute_inverse(
        state, scene, "token.update", {"id": "tok1", "patch": {"name": "X"}}
    )
    assert inv is not None
    assert inv["type"] == "token.restore"
    assert inv["payload"]["data"] == before


def test_apply_inverse_discards_missing_object(campaign):
    scene = campaign["scene"]
    ok = ops.apply_inverse(
        state, scene, "dm-client",
        {"type": "token.move", "payload": {"id": "ghost", "x": 1, "y": 1}},
    )
    assert ok is False


# ---- group (dibujos compuestos) ----------------------------------------------


def test_group_add_update_remove_and_undo(campaign):
    scene = campaign["scene"]
    parts = [
        {"type": "path", "data": {"x": -10, "y": 0, "points": [0, 0, 20, 20]}},
        {"type": "text", "data": {"x": 5, "y": 5, "text": "hola"}},
    ]
    ops.apply(state, scene, "dm-client", "group.add",
              {"id": "g1", "data": {"x": 50, "y": 50, "rotation": 0, "parts": parts}})
    obj = state.objects["g1"]
    assert obj.type == "group"
    assert json.loads(obj.data_json)["parts"] == parts

    ops.apply(state, scene, "dm-client", "group.update",
              {"id": "g1", "patch": {"x": 99, "rotation": 90}})
    data = json.loads(state.objects["g1"].data_json)
    assert data["x"] == 99
    assert data["rotation"] == 90

    # la inversa del add es remove (undo genérico por prefijo)
    inv = ops.compute_inverse(state, scene, "group.add", {"id": "g1", "data": {}})
    assert inv == {"type": "group.remove", "payload": {"id": "g1"}}

    ops.apply(state, scene, "dm-client", "group.remove", {"id": "g1"})
    assert "g1" not in state.objects
