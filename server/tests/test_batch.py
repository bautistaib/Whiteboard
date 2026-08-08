"""Tests del tipo "image", de la op compuesta "batch" y del tope de payload."""

import json

import pytest
from fastapi.testclient import TestClient

from app import ops
from app.main import create_app
from app.state import state
from app.undo import undo_manager as um


def do(state, scene, client_id, campaign_id, op_type, payload):
    """Aplica una op normal y apila su inversa (lo que hace ws.dispatch)."""
    inverse = ops.compute_inverse(state, scene, op_type, payload)
    ops.apply(state, scene, client_id, op_type, payload)
    um.push_undo(campaign_id, client_id, inverse)


def do_batch(state, scene, role, client_id, campaign_id, sub_ops):
    """Aplica un batch y apila su inversa (lo que hace ws.dispatch)."""
    inverse = ops.apply_batch(state, role, client_id, scene, {"ops": sub_ops})
    um.push_undo(campaign_id, client_id, inverse)
    return inverse


def data_of(state, obj_id):
    return json.loads(state.objects[obj_id].data_json)


# ---- tipo "image" (path genérico) -------------------------------------------


def test_image_add_update_remove_undo_roundtrip(campaign):
    scene = campaign["scene"]
    do(state, scene, "player-client", "camp1", "image.add",
       {"id": "img1", "data": {"x": 0, "y": 0, "asset_id": "a9", "w": 100, "h": 80}})
    assert state.objects["img1"].type == "image"

    do(state, scene, "player-client", "camp1", "image.update",
       {"id": "img1", "patch": {"x": 50, "rotation": 90}})
    assert data_of(state, "img1")["x"] == 50

    # undo del update: restaura el snapshot previo
    ops.undo_step(state, scene, um, "camp1", "player-client", "undo")
    assert data_of(state, "img1")["x"] == 0
    assert "rotation" not in data_of(state, "img1")

    # remove + undo: recrea con snapshot
    do(state, scene, "player-client", "camp1", "image.remove", {"id": "img1"})
    assert "img1" not in state.objects
    ops.undo_step(state, scene, um, "camp1", "player-client", "undo")
    assert state.objects["img1"].type == "image"
    assert data_of(state, "img1")["asset_id"] == "a9"


def test_image_permissions_like_draw(campaign):
    """Add cualquiera; update/remove solo DM u owner (reglas genéricas)."""
    scene = campaign["scene"]
    do(state, scene, "player-client", "camp1", "image.add",
       {"id": "img1", "data": {"x": 0, "y": 0}})
    with pytest.raises(ops.OpError):
        ops.validate(state, "player", "other-client", scene, "image.update",
                     {"id": "img1", "patch": {"x": 9}})
    with pytest.raises(ops.OpError):
        ops.validate(state, "player", "other-client", scene, "image.remove",
                     {"id": "img1"})
    ops.validate(state, "dm", "dm-client", scene, "image.remove", {"id": "img1"})


# ---- batch: aplicación e inversa ---------------------------------------------


def test_batch_remove_and_adds_undo_redo_single_step(campaign):
    scene = campaign["scene"]
    ops.apply(state, scene, "dm-client", "draw.add",
              {"id": "d1", "data": {"points": [0, 0, 5, 5], "color": "#f00"}})
    batch = [
        {"type": "draw.remove", "payload": {"id": "d1"}},
        {"type": "draw.add", "payload": {"id": "s1", "data": {"points": [0, 0, 1, 1]}}},
        {"type": "draw.add", "payload": {"id": "s2", "data": {"points": [2, 2, 3, 3]}}},
    ]
    inverse = do_batch(state, scene, "dm", "dm-client", "camp1", batch)
    assert "d1" not in state.objects
    assert "s1" in state.objects and "s2" in state.objects

    # la inversa es un batch de las sub-inversas en orden inverso
    assert inverse["type"] == "batch"
    assert [(s["type"], s["payload"]["id"]) for s in inverse["payload"]["ops"]] == [
        ("draw.remove", "s2"), ("draw.remove", "s1"), ("draw.add", "d1"),
    ]

    # UNA sola entrada en la pila de undo del autor
    assert len(um._stacks[("camp1", "dm-client")].undo) == 1

    # undo: un solo paso restaura d1 y borra s1/s2
    inv = ops.undo_step(state, scene, um, "camp1", "dm-client", "undo")
    assert inv is not None and inv["type"] == "batch"
    assert "d1" in state.objects
    assert "s1" not in state.objects and "s2" not in state.objects

    # redo: un solo paso reaplica el batch original (mismo orden de sub-ops)
    inv = ops.undo_step(state, scene, um, "camp1", "dm-client", "redo")
    assert inv is not None and inv["type"] == "batch"
    assert [s["type"] for s in inv["payload"]["ops"]] == [
        "draw.remove", "draw.add", "draw.add"]
    assert "d1" not in state.objects
    assert "s1" in state.objects and "s2" in state.objects


def test_batch_remove_then_add_same_id(campaign):
    """La inversa se computa contra el estado evolucionado (remove-then-add)."""
    scene = campaign["scene"]
    ops.apply(state, scene, "dm-client", "draw.add",
              {"id": "d1", "data": {"points": [0, 0, 5, 5]}})
    batch = [
        {"type": "draw.remove", "payload": {"id": "d1"}},
        {"type": "draw.add", "payload": {"id": "d1", "data": {"points": [9, 9, 9, 9]}}},
    ]
    do_batch(state, scene, "dm", "dm-client", "camp1", batch)
    assert data_of(state, "d1")["points"] == [9, 9, 9, 9]

    # undo: primero borra el nuevo d1, después recrea el original
    ops.undo_step(state, scene, um, "camp1", "dm-client", "undo")
    assert data_of(state, "d1")["points"] == [0, 0, 5, 5]


def test_batch_with_forbidden_subop_rejected_atomically(campaign):
    """Jugador borrando dibujo ajeno: se rechaza TODO el batch, nada aplicado."""
    scene = campaign["scene"]
    ops.apply(state, scene, "other-client", "draw.add",
              {"id": "ajeno", "data": {"points": [0, 0, 5, 5]}})
    batch = [
        {"type": "draw.add", "payload": {"id": "mio", "data": {"points": [1, 1, 2, 2]}}},
        {"type": "draw.remove", "payload": {"id": "ajeno"}},
    ]
    with pytest.raises(ops.OpError):
        ops.apply_batch(state, "player", "player-client", scene, {"ops": batch})
    # el add ya aplicado se revirtió; el dibujo ajeno sigue intacto
    assert "mio" not in state.objects
    assert "ajeno" in state.objects


def test_nested_batch_rejected(campaign):
    scene = campaign["scene"]
    batch = [{"type": "batch", "payload": {"ops": [
        {"type": "draw.add", "payload": {"id": "x", "data": {}}}]}}]
    with pytest.raises(ops.OpError):
        ops.apply_batch(state, "dm", "dm-client", scene, {"ops": batch})


def test_batch_subop_limits(campaign):
    scene = campaign["scene"]
    # más de 16 sub-ops
    big = [{"type": "draw.add", "payload": {"id": f"d{i}", "data": {}}}
           for i in range(17)]
    with pytest.raises(ops.OpError):
        ops.apply_batch(state, "dm", "dm-client", scene, {"ops": big})
    assert not state.objects
    # batch vacío
    with pytest.raises(ops.OpError):
        ops.apply_batch(state, "dm", "dm-client", scene, {"ops": []})
    # sub-op de escena o efímera: no admitida
    with pytest.raises(ops.OpError):
        ops.apply_batch(state, "dm", "dm-client", scene,
                        {"ops": [{"type": "scene.rename", "payload": {"name": "X"}}]})


# ---- tope de payload (256 KB) -------------------------------------------------


def test_check_payload_size(campaign):
    ops.check_payload_size({"data": "x" * 1024})
    with pytest.raises(ops.OpError):
        ops.check_payload_size({"data": "x" * ops.MAX_PAYLOAD_BYTES})


# ---- wire format vía WS --------------------------------------------------------


@pytest.fixture
def ws_client(fresh_state):
    with TestClient(create_app()) as c:
        yield c


@pytest.fixture
def ws_campaign(ws_client):
    resp = ws_client.post("/api/campaigns", json={"name": "Mesa"})
    urls = resp.json()
    return {
        "dm_token": urls["dm_url"].split("/")[-1],
        "player_token": urls["player_url"].split("/")[-1],
    }


def _drain_until(sock, msg_type):
    """Lee mensajes hasta encontrar uno del tipo pedido."""
    for _ in range(20):
        msg = sock.receive_json()
        if msg["type"] == msg_type:
            return msg
    raise AssertionError(f"no llegó mensaje {msg_type}")


def _connect_dm(ws_client, ws_campaign):
    dm = ws_client.websocket_connect(
        f"/ws/{ws_campaign['dm_token']}?name=DM&clientId=dm1")
    return dm


def test_batch_broadcasts_as_single_op(ws_client, ws_campaign):
    with _connect_dm(ws_client, ws_campaign) as dm:
        dm.receive_json()  # snapshot
        dm.receive_json()  # tunnel.url
        dm.receive_json()  # presence

        dm.send_json({
            "type": "batch", "opId": "b1",
            "payload": {"ops": [
                {"type": "draw.add", "payload": {"id": "s1", "data": {"points": [0, 0, 1, 1]}}},
                {"type": "draw.add", "payload": {"id": "s2", "data": {"points": [2, 2, 3, 3]}}},
            ]},
        })
        msg = _drain_until(dm, "op")
        # UN solo mensaje de broadcast con el batch completo
        assert msg["op"]["type"] == "batch"
        assert msg["op"]["opId"] == "b1"
        assert msg["op"]["clientId"] == "dm1"
        assert [s["type"] for s in msg["op"]["payload"]["ops"]] == [
            "draw.add", "draw.add"]

        # UNA entrada de undo para todo el batch
        campaign_id = next(iter(state.campaigns))
        assert len(um._stacks[(campaign_id, "dm1")].undo) == 1

        # el undo broadcastea la inversa como UN op "batch"
        dm.send_json({"type": "undo"})
        msg = _drain_until(dm, "op")
        assert msg["op"]["type"] == "batch"
        assert [s["type"] for s in msg["op"]["payload"]["ops"]] == [
            "draw.remove", "draw.remove"]


def test_batch_invalid_sends_error_and_applies_nothing(ws_client, ws_campaign):
    with _connect_dm(ws_client, ws_campaign) as dm:
        dm.receive_json()  # snapshot
        dm.receive_json()  # tunnel.url
        dm.receive_json()  # presence

        # batch anidado → error, nada aplicado, nada en el undo
        dm.send_json({"type": "batch", "opId": "nb", "payload": {"ops": [
            {"type": "draw.add", "payload": {"id": "ok1", "data": {}}},
            {"type": "batch", "payload": {"ops": []}},
        ]}})
        msg = _drain_until(dm, "error")
        assert msg["opId"] == "nb"
        assert "ok1" not in state.objects
        campaign_id = next(iter(state.campaigns))
        assert (campaign_id, "dm1") not in um._stacks


def test_payload_over_256kb_rejected(ws_client, ws_campaign):
    with _connect_dm(ws_client, ws_campaign) as dm:
        dm.receive_json()  # snapshot
        dm.receive_json()  # tunnel.url
        dm.receive_json()  # presence

        # op single con payload > 256 KB
        dm.send_json({"type": "draw.add", "opId": "big1",
                      "payload": {"id": "big", "data": {"points": "x" * (256 * 1024)}}})
        msg = _drain_until(dm, "error")
        assert msg["opId"] == "big1"
        assert "big" not in state.objects

        # batch: se mide el payload COMPLETO del mensaje, no por sub-op
        half = "x" * (140 * 1024)
        dm.send_json({"type": "batch", "opId": "bigb", "payload": {"ops": [
            {"type": "draw.add", "payload": {"id": "b1", "data": {"pad": half}}},
            {"type": "draw.add", "payload": {"id": "b2", "data": {"pad": half}}},
        ]}})
        msg = _drain_until(dm, "error")
        assert msg["opId"] == "bigb"
        assert "b1" not in state.objects and "b2" not in state.objects
