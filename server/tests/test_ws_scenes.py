"""Tests de ops de escena y de normalización de broadcast vía WS."""

import json

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.state import state


@pytest.fixture
def client(fresh_state):
    with TestClient(create_app()) as c:
        yield c


@pytest.fixture
def campaign(client):
    resp = client.post("/api/campaigns", json={"name": "Mesa"})
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


def test_scene_create_rename_setgrid_setbackground(client, campaign):
    with client.websocket_connect(
        f"/ws/{campaign['dm_token']}?name=DM&clientId=dm1"
    ) as dm:
        dm.receive_json()  # snapshot
        dm.receive_json()  # tunnel.url
        dm.receive_json()  # presence

        dm.send_json({"type": "scene.create", "opId": "1", "payload": {"id": "s2", "name": "Calabozo"}})
        msg = _drain_until(dm, "scene.update")
        names = [s["name"] for s in msg["scenes"]]
        assert "Calabozo" in names

        dm.send_json({"type": "scene.rename", "opId": "2", "payload": {"sceneId": "s2", "name": "Cueva"}})
        msg = _drain_until(dm, "scene.update")
        assert any(s["name"] == "Cueva" for s in msg["scenes"])

        dm.send_json(
            {
                "type": "scene.setGrid",
                "opId": "3",
                "payload": {"grid": {"type": "hex", "orientation": "flat", "cellSize": 100}},
            }
        )
        msg = _drain_until(dm, "scene.update")
        assert msg["scene"]["grid"]["type"] == "hex"
        assert msg["scene"]["grid"]["cellSize"] == 100

        dm.send_json(
            {"type": "scene.setBackground", "opId": "4", "payload": {"assetId": "bg1"}}
        )
        msg = _drain_until(dm, "scene.update")
        assert msg["scene"]["backgroundAssetId"] == "bg1"


def test_scene_switch_sends_fresh_snapshot_to_all(client, campaign):
    with client.websocket_connect(
        f"/ws/{campaign['dm_token']}?name=DM&clientId=dm1"
    ) as dm:
        snap = dm.receive_json()
        scene1 = snap["scene"]["id"]
        dm.receive_json()  # tunnel.url
        dm.receive_json()  # presence

        with client.websocket_connect(
            f"/ws/{campaign['player_token']}?name=Ana&clientId=c1"
        ) as player:
            player.receive_json()  # snapshot
            player.receive_json()  # presence
            dm.receive_json()  # presence (player join)

            # objeto en escena 1
            dm.send_json(
                {
                    "type": "token.add",
                    "opId": "1",
                    "payload": {"id": "tok-esc1", "data": {"x": 0, "y": 0}},
                }
            )
            _drain_until(dm, "op")

            # crear escena 2 y cambiar a ella
            dm.send_json({"type": "scene.create", "opId": "2", "payload": {"id": "s2", "name": "Nueva"}})
            _drain_until(dm, "scene.update")
            dm.send_json({"type": "scene.switch", "opId": "3", "payload": {"sceneId": "s2"}})

            # ambos reciben snapshot fresco de la escena 2 (vacía)
            snap_dm = _drain_until(dm, "scene.snapshot")
            snap_player = _drain_until(player, "scene.snapshot")
            assert snap_dm["scene"]["id"] == "s2"
            assert snap_player["scene"]["id"] == "s2"
            assert snap_player["objects"] == []

            # y la escena 1 conserva su token al volver
            dm.send_json({"type": "scene.switch", "opId": "4", "payload": {"sceneId": scene1}})
            snap_back = _drain_until(dm, "scene.snapshot")
            assert snap_back["scene"]["id"] == scene1
            assert [o["id"] for o in snap_back["objects"]] == ["tok-esc1"]


def test_ops_after_switch_apply_to_new_scene(client, campaign):
    """Regresión: la conexión no debe quedar atada a la escena vieja tras un
    scene.switch (si no, los objetos nuevos se persisten en la escena anterior
    y las ops sobre objetos de la escena nueva se rechazan)."""
    with client.websocket_connect(
        f"/ws/{campaign['dm_token']}?name=DM&clientId=dm1"
    ) as dm:
        dm.receive_json()  # snapshot
        dm.receive_json()  # tunnel.url
        dm.receive_json()  # presence

        dm.send_json({"type": "scene.create", "opId": "1", "payload": {"id": "s2", "name": "Nueva"}})
        _drain_until(dm, "scene.update")
        dm.send_json({"type": "scene.switch", "opId": "2", "payload": {"sceneId": "s2"}})
        snap = _drain_until(dm, "scene.snapshot")
        assert snap["scene"]["id"] == "s2"

        # crear DESPUÉS del switch: debe persistir en la escena nueva
        dm.send_json(
            {"type": "token.add", "opId": "3", "payload": {"id": "tok-new", "data": {"x": 1, "y": 2}}}
        )
        _drain_until(dm, "op")
        assert state.objects["tok-new"].scene_id == "s2"

        # modificar ese objeto: la validación debe usar la escena activa
        dm.send_json({"type": "token.move", "opId": "4", "payload": {"id": "tok-new", "x": 5, "y": 6}})
        msg = _drain_until(dm, "op")
        assert msg["op"]["type"] == "token.move"
        data = json.loads(state.objects["tok-new"].data_json)
        assert (data["x"], data["y"]) == (5, 6)


def test_player_ops_after_switch_apply_to_new_scene(client, campaign):
    """Misma regresión para un jugador conectado antes del switch."""
    with client.websocket_connect(
        f"/ws/{campaign['dm_token']}?name=DM&clientId=dm1"
    ) as dm:
        dm.receive_json()
        dm.receive_json()
        dm.receive_json()
        with client.websocket_connect(
            f"/ws/{campaign['player_token']}?name=Ana&clientId=c1"
        ) as player:
            player.receive_json()
            player.receive_json()
            dm.receive_json()  # presence (player join)

            dm.send_json({"type": "scene.create", "opId": "1", "payload": {"id": "s2", "name": "Nueva"}})
            _drain_until(dm, "scene.update")
            dm.send_json({"type": "scene.switch", "opId": "2", "payload": {"sceneId": "s2"}})
            _drain_until(dm, "scene.snapshot")
            _drain_until(player, "scene.snapshot")

            dm.send_json(
                {"type": "token.add", "opId": "3", "payload": {"id": "tok-s2", "data": {"x": 0, "y": 0}}}
            )
            _drain_until(player, "op")
            # el add post-switch debe persistir en la escena nueva
            assert state.objects["tok-s2"].scene_id == "s2"

            # el jugador mueve el token de la escena nueva: debe aceptarse
            player.send_json({"type": "token.move", "opId": "4", "payload": {"id": "tok-s2", "x": 9, "y": 9}})
            msg = _drain_until(player, "op")
            assert msg["op"]["type"] == "token.move"
            data = json.loads(state.objects["tok-s2"].data_json)
            assert (data["x"], data["y"]) == (9, 9)


def test_scene_delete(client, campaign):
    with client.websocket_connect(
        f"/ws/{campaign['dm_token']}?name=DM&clientId=dm1"
    ) as dm:
        snap = dm.receive_json()
        scene1 = snap["scene"]["id"]
        dm.receive_json()
        dm.receive_json()

        # no se puede borrar la única/activa escena
        dm.send_json({"type": "scene.delete", "opId": "1", "payload": {"sceneId": scene1}})
        msg = _drain_until(dm, "error")
        assert "activa" in msg["reason"] or "última" in msg["reason"]

        # crear s2, ponerle un objeto, volver a scene1 y borrar s2
        dm.send_json({"type": "scene.create", "opId": "2", "payload": {"id": "s2", "name": "Temp"}})
        _drain_until(dm, "scene.update")
        dm.send_json({"type": "scene.switch", "opId": "3", "payload": {"sceneId": "s2"}})
        _drain_until(dm, "scene.snapshot")
        dm.send_json(
            {"type": "token.add", "opId": "4", "payload": {"id": "tok-temp", "data": {"x": 0, "y": 0}}}
        )
        _drain_until(dm, "op")
        dm.send_json({"type": "scene.switch", "opId": "5", "payload": {"sceneId": scene1}})
        _drain_until(dm, "scene.snapshot")

        dm.send_json({"type": "scene.delete", "opId": "6", "payload": {"sceneId": "s2"}})
        msg = _drain_until(dm, "scene.update")
        assert [s["id"] for s in msg["scenes"]] == [scene1]
        assert "s2" not in state.scenes
        assert "tok-temp" not in state.objects  # cascada de objetos

        # la conexión sigue viva y la escena activa intacta
        dm.send_json(
            {"type": "token.add", "opId": "7", "payload": {"id": "tok-ok", "data": {"x": 0, "y": 0}}}
        )
        _drain_until(dm, "op")
        assert state.objects["tok-ok"].scene_id == scene1


def test_scene_delete_requires_dm(client, campaign):
    with client.websocket_connect(
        f"/ws/{campaign['dm_token']}?name=DM&clientId=dm1"
    ) as dm:
        dm.receive_json()
        dm.receive_json()
        dm.receive_json()
        dm.send_json({"type": "scene.create", "opId": "1", "payload": {"id": "s2", "name": "Temp"}})
        _drain_until(dm, "scene.update")
        with client.websocket_connect(
            f"/ws/{campaign['player_token']}?name=Ana&clientId=c1"
        ) as player:
            player.receive_json()
            player.receive_json()
            player.send_json({"type": "scene.delete", "opId": "2", "payload": {"sceneId": "s2"}})
            msg = _drain_until(player, "error")
            assert "DM" in msg["reason"]
        assert "s2" in state.scenes


def test_scene_switch_to_missing_scene_is_rejected(client, campaign):
    """Un switch a una escena borrada/inexistente es un error limpio,
    no una excepción que tumba la conexión."""
    with client.websocket_connect(
        f"/ws/{campaign['dm_token']}?name=DM&clientId=dm1"
    ) as dm:
        dm.receive_json()
        dm.receive_json()
        dm.receive_json()
        dm.send_json({"type": "scene.switch", "opId": "1", "payload": {"sceneId": "nope"}})
        msg = _drain_until(dm, "error")
        assert "inexistente" in msg["reason"]
        # la conexión sigue viva
        dm.send_json(
            {"type": "token.add", "opId": "2", "payload": {"id": "tok1", "data": {"x": 0, "y": 0}}}
        )
        _drain_until(dm, "op")
        assert "tok1" in state.objects


def test_duplicate_broadcasts_as_add(client, campaign):
    with client.websocket_connect(
        f"/ws/{campaign['dm_token']}?name=DM&clientId=dm1"
    ) as dm:
        dm.receive_json()
        dm.receive_json()
        dm.receive_json()
        dm.send_json(
            {
                "type": "token.add",
                "opId": "1",
                "payload": {"id": "tok1", "data": {"x": 0, "y": 0, "name": "Goblin"}},
            }
        )
        _drain_until(dm, "op")
        dm.send_json(
            {
                "type": "token.duplicate",
                "opId": "2",
                "payload": {"id": "tok1", "newId": "tok2", "x": 64, "y": 0},
            }
        )
        msg = _drain_until(dm, "op")
        assert msg["op"]["type"] == "token.add"
        assert msg["op"]["payload"]["id"] == "tok2"
        assert msg["op"]["payload"]["data"]["name"] == "Goblin"
        assert msg["op"]["payload"]["data"]["x"] == 64
        assert json.loads(state.objects["tok2"].data_json)["name"] == "Goblin"


def test_set_variant_swaps_asset_and_size(client, campaign):
    # personaje con dos variantes
    from app import db as dbm

    char = dbm.Character(id="char1", campaign_id=next(iter(state.campaigns)), name="Druida")
    state.characters[char.id] = char
    v1 = dbm.CharacterVariant(id="v1", character_id="char1", asset_id="a-human", label="Humano", size_cells=1, sort_order=0)
    v2 = dbm.CharacterVariant(id="v2", character_id="char1", asset_id="a-wolf", label="Lobo", size_cells=2, sort_order=1)
    state.variants[v1.id] = v1
    state.variants[v2.id] = v2

    with client.websocket_connect(
        f"/ws/{campaign['dm_token']}?name=DM&clientId=dm1"
    ) as dm:
        dm.receive_json()
        dm.receive_json()
        dm.receive_json()
        dm.send_json(
            {
                "type": "token.add",
                "opId": "1",
                "payload": {
                    "id": "tok1",
                    "data": {
                        "x": 0,
                        "y": 0,
                        "character_id": "char1",
                        "active_variant_id": "v1",
                        "asset_id": "a-human",
                        "size_cells": 1,
                    },
                },
            }
        )
        _drain_until(dm, "op")
        dm.send_json(
            {"type": "token.setVariant", "opId": "2", "payload": {"id": "tok1", "variantId": "v2"}}
        )
        msg = _drain_until(dm, "op")
        data = msg["op"]["payload"]["data"]
        assert data["active_variant_id"] == "v2"
        assert data["asset_id"] == "a-wolf"
        assert data["size_cells"] == 2  # el tamaño se adapta al de la variante
