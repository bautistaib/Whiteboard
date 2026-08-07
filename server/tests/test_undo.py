"""Escenarios de undo/redo por usuario (spec §8): interleaved, borrados, redo."""

import json

from app import ops
from app.state import state
from app.undo import undo_manager as um


def do(state, scene, client_id, campaign_id, op_type, payload):
    """Aplica una op normal y apila su inversa (lo que hace ws.dispatch)."""
    inverse = ops.compute_inverse(state, scene, op_type, payload)
    ops.apply(state, scene, client_id, op_type, payload)
    um.push_undo(campaign_id, client_id, inverse)


def data_of(state, obj_id):
    return json.loads(state.objects[obj_id].data_json)


def test_undo_only_own_actions(campaign):
    """Interleaved: A y B editan; el undo de A no toca lo de B."""
    scene = campaign["scene"]
    do(state, scene, "userA", "camp1", "token.add", {"id": "tA", "data": {"x": 0, "y": 0}})
    do(state, scene, "userB", "camp1", "token.add", {"id": "tB", "data": {"x": 5, "y": 5}})
    do(state, scene, "userB", "camp1", "token.move", {"id": "tB", "x": 9, "y": 9})
    do(state, scene, "userA", "camp1", "token.move", {"id": "tA", "x": 2, "y": 2})

    # undo de A: solo deshace su propio move
    inv = ops.undo_step(state, scene, um, "camp1", "userA", "undo")
    assert inv is not None and inv["type"] == "token.move"
    assert data_of(state, "tA")["x"] == 0
    assert data_of(state, "tB")["x"] == 9  # intacto

    # undo de A otra vez: deshace su add
    inv = ops.undo_step(state, scene, um, "camp1", "userA", "undo")
    assert inv is not None and inv["type"] == "token.remove"
    assert "tA" not in state.objects
    assert "tB" in state.objects


def test_undo_of_deleted_object_recreates(campaign):
    scene = campaign["scene"]
    do(state, scene, "userA", "camp1", "token.add", {"id": "tA", "data": {"x": 3, "y": 4, "name": "Orco"}})
    do(state, scene, "userA", "camp1", "token.remove", {"id": "tA"})
    assert "tA" not in state.objects

    inv = ops.undo_step(state, scene, um, "camp1", "userA", "undo")
    assert inv is not None and inv["type"] == "token.add"
    assert data_of(state, "tA")["name"] == "Orco"
    assert data_of(state, "tA")["x"] == 3


def test_undo_move_after_other_deleted_discards_and_continues(campaign):
    """A mueve un token, B lo borra: el undo del move se descarta y pasa al anterior."""
    scene = campaign["scene"]
    do(state, scene, "userA", "camp1", "token.add", {"id": "tA", "data": {"x": 0, "y": 0}})
    do(state, scene, "userA", "camp1", "token.move", {"id": "tA", "x": 7, "y": 7})
    # B (DM) borra el token
    do(state, scene, "userB", "camp1", "token.remove", {"id": "tA"})

    # undo de A: el move-back no encuentra el objeto → descarta → deshace el add (que tampoco está…)
    # el add tampoco puede deshacerse (remove de objeto ausente) → ambas descartadas
    inv = ops.undo_step(state, scene, um, "camp1", "userA", "undo")
    assert inv is None
    assert "tA" not in state.objects


def test_undo_remove_after_other_recreated(campaign):
    """A borra; undo recrea aunque el objeto ya no exista (snapshot)."""
    scene = campaign["scene"]
    do(state, scene, "userA", "camp1", "shape.add",
       {"id": "s1", "data": {"shape": "rect", "x": 0, "y": 0, "w": 10, "h": 10}})
    do(state, scene, "userA", "camp1", "shape.remove", {"id": "s1"})
    inv = ops.undo_step(state, scene, um, "camp1", "userA", "undo")
    assert inv is not None and inv["type"] == "shape.add"
    assert data_of(state, "s1")["shape"] == "rect"


def test_redo_reapplies(campaign):
    scene = campaign["scene"]
    do(state, scene, "userA", "camp1", "token.add", {"id": "tA", "data": {"x": 0, "y": 0}})
    do(state, scene, "userA", "camp1", "token.move", {"id": "tA", "x": 5, "y": 5})

    ops.undo_step(state, scene, um, "camp1", "userA", "undo")
    assert data_of(state, "tA")["x"] == 0
    inv = ops.undo_step(state, scene, um, "camp1", "userA", "redo")
    assert inv is not None
    assert data_of(state, "tA")["x"] == 5


def test_new_op_clears_redo(campaign):
    scene = campaign["scene"]
    do(state, scene, "userA", "camp1", "token.add", {"id": "tA", "data": {"x": 0, "y": 0}})
    ops.undo_step(state, scene, um, "camp1", "userA", "undo")
    # acción nueva invalida el redo
    do(state, scene, "userA", "camp1", "token.add", {"id": "tB", "data": {"x": 1, "y": 1}})
    assert ops.undo_step(state, scene, um, "camp1", "userA", "redo") is None


def test_undo_update_restores_previous_props_lww(campaign):
    """Otro usuario modificó después: la inversa pisa (last-writer-wins)."""
    scene = campaign["scene"]
    do(state, scene, "userA", "camp1", "token.add",
       {"id": "tA", "data": {"x": 0, "y": 0, "name": "A"}})
    do(state, scene, "userA", "camp1", "token.update",
       {"id": "tA", "patch": {"name": "B"}})
    # B lo renombra después
    do(state, scene, "userB", "camp1", "token.update",
       {"id": "tA", "patch": {"name": "C"}})
    # undo de A de su update: pisa el nombre de B con el valor previo a su edición
    ops.undo_step(state, scene, um, "camp1", "userA", "undo")
    assert data_of(state, "tA")["name"] == "A"


def test_stacks_are_per_user(campaign):
    scene = campaign["scene"]
    do(state, scene, "userA", "camp1", "token.add", {"id": "tA", "data": {"x": 0, "y": 0}})
    # userB no tiene nada que deshacer
    assert ops.undo_step(state, scene, um, "camp1", "userB", "undo") is None
