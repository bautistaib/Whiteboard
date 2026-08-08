"""Tests de REST (campañas, tokens, uploads), WS (snapshot + broadcast) y
persistencia round-trip."""

import asyncio
import io
import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from starlette.websockets import WebSocketDisconnect

from app import db
from app.main import create_app
from app.state import AppState, state


@pytest.fixture
def client(fresh_state):
    with TestClient(create_app()) as c:
        yield c


@pytest.fixture
def campaign(client):
    resp = client.post("/api/campaigns", json={"name": "Mesa de prueba"})
    assert resp.status_code == 200
    urls = resp.json()
    return {
        "dm_token": urls["dm_url"].split("/")[-1],
        "player_token": urls["player_url"].split("/")[-1],
    }


def png_bytes(size=(64, 64), color=(255, 0, 0)) -> bytes:
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


# ---- tokens / sesión ---------------------------------------------------------


def test_create_campaign_returns_two_links(client, campaign):
    assert campaign["dm_token"] != campaign["player_token"]


def test_list_campaigns_includes_existing(client, campaign):
    # crear una segunda campaña (con prueba de DM: ya hay campañas)
    resp = client.post(
        "/api/campaigns", json={"name": "Otra", "dm": campaign["dm_token"]}
    )
    assert resp.status_code == 200
    resp = client.get("/api/campaigns", params={"dm": campaign["dm_token"]})
    assert resp.status_code == 200
    names = [c["name"] for c in resp.json()]
    assert "Mesa de prueba" in names
    assert "Otra" in names
    # cada una trae sus links
    first = resp.json()[0]
    assert first["dm_url"].startswith("/dm/")
    assert first["player_url"].startswith("/j/")


# el edge de Cloudflare siempre agrega estos headers al tráfico del túnel
# (y pisa los que mande el cliente); su ausencia = tráfico local
TUNNEL_HEADERS = {"Cf-Connecting-Ip": "203.0.113.7", "Cf-Ray": "8f1a2b3c4d5e6f7a-EZE"}


def test_campaign_admin_endpoints_require_dm(client, campaign):
    """Los links de DM no pueden quedar expuestos a quien entre por el túnel."""
    dm = campaign["dm_token"]
    player = campaign["player_token"]

    # tráfico local (sin headers Cf-*): abierto — es el DM en su propia PC
    assert client.get("/api/campaigns").status_code == 200
    assert client.post("/api/campaigns", json={"name": "Local"}).status_code == 200

    # vía túnel sin token / con token de jugador → prohibido
    assert client.get("/api/campaigns", headers=TUNNEL_HEADERS).status_code == 403
    assert (
        client.get(
            "/api/campaigns", headers=TUNNEL_HEADERS, params={"dm": player}
        ).status_code
        == 403
    )
    assert (
        client.get(
            "/api/campaigns", headers=TUNNEL_HEADERS, params={"dm": "cualquiera"}
        ).status_code
        == 403
    )
    # crear campañas extra por el túnel sin prueba de DM → prohibido
    assert (
        client.post("/api/campaigns", headers=TUNNEL_HEADERS, json={"name": "Colada"}).status_code
        == 403
    )
    assert (
        client.post(
            "/api/campaigns",
            headers=TUNNEL_HEADERS,
            json={"name": "Colada", "dm": player},
        ).status_code
        == 403
    )
    assert len(state.campaigns) == 2  # solo la del fixture + "Local"

    # vía túnel CON token de DM → permitido (el DM puede usar el link público)
    assert (
        client.get("/api/campaigns", headers=TUNNEL_HEADERS, params={"dm": dm}).status_code
        == 200
    )
    assert (
        client.post(
            "/api/campaigns", headers=TUNNEL_HEADERS, json={"name": "Remota", "dm": dm}
        ).status_code
        == 200
    )


def test_first_campaign_bootstrap_is_open(client):
    """Sin campañas previas, cualquiera puede crear la primera (setup inicial)."""
    assert client.get("/api/campaigns").status_code == 200
    resp = client.post("/api/campaigns", json={"name": "Primera"})
    assert resp.status_code == 200


def test_delete_campaign_cascades(client, campaign):
    """Borrar una campaña elimina escenas, objetos, biblioteca, tokens y undo."""
    from app import config
    from app.undo import undo_manager

    dm = campaign["dm_token"]
    player = campaign["player_token"]
    resolved = state.resolve_token(dm)
    assert resolved is not None
    campaign_id = resolved[0]

    # sembrar contenido: asset (+archivo), personaje+variante, objeto, undo
    asset = db.Asset(
        id="a1", campaign_id=campaign_id, filename="mapa.webp", kind="map"
    )
    state.assets[asset.id] = asset
    config.ensure_dirs()
    (config.ASSETS_DIR / "mapa.webp").write_bytes(b"fake")
    char = db.Character(id="ch1", campaign_id=campaign_id, name="Druida")
    state.characters[char.id] = char
    variant = db.CharacterVariant(
        id="v1", character_id="ch1", asset_id="a1", label="Base"
    )
    state.variants[variant.id] = variant
    scene_id = next(
        s.id for s in state.scenes.values() if s.campaign_id == campaign_id
    )
    obj = db.SceneObject(
        id="o1", scene_id=scene_id, type="token", data_json="{}"
    )
    state.objects[obj.id] = obj
    undo_manager.push_undo(campaign_id, "c1", {"type": "token.remove", "payload": {"id": "o1"}})

    # jugador no puede borrar
    assert client.delete(f"/api/campaigns/{player}").status_code == 403
    # token inválido → 404
    assert client.delete("/api/campaigns/nope").status_code == 404

    assert client.delete(f"/api/campaigns/{dm}").status_code == 200
    assert not state.campaigns
    assert not state.scenes
    assert not state.objects
    assert not state.assets
    assert not state.characters
    assert not state.variants
    assert state.resolve_token(dm) is None
    assert state.resolve_token(player) is None
    assert undo_manager.pop_undo(campaign_id, "c1") is None
    assert not (config.ASSETS_DIR / "mapa.webp").exists()

    # round-trip de persistencia: nada queda en la DB
    fresh = AppState()
    fresh.load_from_db()
    assert not fresh.campaigns
    assert not fresh.scenes
    assert not fresh.objects
    assert not fresh.assets


def test_delete_campaign_closes_room(client, campaign):
    """Los clientes conectados a una campaña borrada quedan desconectados."""
    with client.websocket_connect(
        f"/ws/{campaign['player_token']}?name=Ana&clientId=c1"
    ) as sock:
        sock.receive_json()  # snapshot
        sock.receive_json()  # presence
        resp = client.delete(f"/api/campaigns/{campaign['dm_token']}")
        assert resp.status_code == 200
        with pytest.raises(WebSocketDisconnect):
            sock.receive_json()


def test_settings_persist_default_grid(client):
    assert client.get("/api/settings").json() == {"defaultGrid": {}}
    resp = client.post(
        "/api/settings",
        json={"defaultGrid": {"cellSize": 100, "metersPerCell": 2.0}},
    )
    assert resp.status_code == 200
    from app import config

    assert client.get("/api/settings").json()["defaultGrid"]["cellSize"] == 100
    # una nueva campaña usa el default guardado
    urls = client.post("/api/campaigns", json={"name": "Con default"}).json()
    token = urls["dm_url"].split("/")[-1]
    with client.websocket_connect(f"/ws/{token}?name=DM&clientId=c1") as sock:
        snap = sock.receive_json()
        assert snap["scene"]["grid"]["cellSize"] == 100
        assert snap["scene"]["grid"]["metersPerCell"] == 2.0


def test_scene_op_flushes_immediately(client, campaign):
    """Un setGrid debe quedar persistido aunque el server se caiga antes del debounce."""
    with client.websocket_connect(
        f"/ws/{campaign['dm_token']}?name=DM&clientId=dm1"
    ) as sock:
        sock.receive_json()
        sock.receive_json()
        sock.receive_json()
        sock.send_json(
            {
                "type": "scene.setGrid",
                "opId": "1",
                "payload": {"grid": {"type": "hex", "cellSize": 80, "backgroundColor": "#202020"}},
            }
        )
        sock.receive_json()

    fresh = AppState()
    fresh.load_from_db()
    scene = next(iter(fresh.scenes.values()))
    grid = json.loads(scene.grid_config_json)
    assert grid["type"] == "hex"
    assert grid["backgroundColor"] == "#202020"


def test_session_info_roles(client, campaign):
    dm = client.get(f"/api/session/{campaign['dm_token']}").json()
    player = client.get(f"/api/session/{campaign['player_token']}").json()
    assert dm["role"] == "dm"
    assert player["role"] == "player"
    assert dm["campaignName"] == "Mesa de prueba"


def test_invalid_token_404(client):
    assert client.get("/api/session/nope").status_code == 404


def test_ws_invalid_token_rejected(client):
    with pytest.raises(Exception):
        with client.websocket_connect("/ws/nope?name=X&clientId=c0"):
            pass


# ---- WS: snapshot y broadcast ---------------------------------------------------


def test_ws_snapshot_on_connect(client, campaign):
    with client.websocket_connect(
        f"/ws/{campaign['player_token']}?name=Ana&clientId=c1"
    ) as socket:
        snap = socket.receive_json()
        assert snap["type"] == "scene.snapshot"
        assert snap["you"]["role"] == "player"
        assert snap["you"]["name"] == "Ana"
        assert snap["scene"]["grid"]["type"] == "square"
        assert snap["objects"] == []
        assert any(u["name"] == "Ana" for u in snap["users"])
        presence = socket.receive_json()
        assert presence["type"] == "presence"


def test_ws_op_broadcast_to_both_including_sender(client, campaign):
    with client.websocket_connect(
        f"/ws/{campaign['dm_token']}?name=DM&clientId=dm1"
    ) as dm_sock:
        dm_sock.receive_json()  # snapshot
        dm_sock.receive_json()  # tunnel.url
        dm_sock.receive_json()  # presence
        with client.websocket_connect(
            f"/ws/{campaign['player_token']}?name=Ana&clientId=c1"
        ) as player_sock:
            player_sock.receive_json()  # snapshot
            player_sock.receive_json()  # presence (self join)
            dm_sock.receive_json()  # presence (player join)

            player_sock.send_json(
                {
                    "type": "shape.add",
                    "opId": "op-1",
                    "payload": {
                        "id": "shape1",
                        "data": {"shape": "rect", "x": 0, "y": 0, "w": 100, "h": 50},
                    },
                }
            )
            for sock in (player_sock, dm_sock):
                msg = sock.receive_json()
                assert msg["type"] == "op"
                assert msg["op"]["type"] == "shape.add"
                assert msg["op"]["payload"]["id"] == "shape1"
                assert msg["op"]["author"] == "Ana"
                assert msg["op"]["seq"] == 1

    # el objeto quedó en el estado
    assert "shape1" in state.objects


def test_ws_reconnect_resyncs_from_snapshot(client, campaign):
    with client.websocket_connect(
        f"/ws/{campaign['player_token']}?name=Ana&clientId=c1"
    ) as sock:
        sock.receive_json()
        sock.receive_json()
        sock.send_json(
            {
                "type": "token.add",
                "opId": "op-1",
                "payload": {"id": "tok1", "data": {"x": 1, "y": 2}},
            }
        )
        sock.receive_json()

    with client.websocket_connect(
        f"/ws/{campaign['player_token']}?name=Ana&clientId=c1"
    ) as sock:
        snap = sock.receive_json()
        assert len(snap["objects"]) == 1
        assert snap["objects"][0]["id"] == "tok1"
        assert snap["objects"][0]["data"]["x"] == 1


def test_ws_player_scene_op_rejected(client, campaign):
    with client.websocket_connect(
        f"/ws/{campaign['player_token']}?name=Ana&clientId=c1"
    ) as sock:
        sock.receive_json()
        sock.receive_json()
        sock.send_json(
            {"type": "scene.switch", "opId": "op-x", "payload": {"sceneId": "x"}}
        )
        msg = sock.receive_json()
        assert msg["type"] == "error"
        assert msg["opId"] == "op-x"


def test_ws_undo_via_ws(client, campaign):
    with client.websocket_connect(
        f"/ws/{campaign['player_token']}?name=Ana&clientId=c1"
    ) as sock:
        sock.receive_json()
        sock.receive_json()
        sock.send_json(
            {
                "type": "draw.add",
                "opId": "op-1",
                "payload": {"id": "d1", "data": {"points": [0, 0, 5, 5]}},
            }
        )
        sock.receive_json()
        sock.send_json({"type": "undo", "opId": "op-2", "payload": {}})
        msg = sock.receive_json()
        assert msg["type"] == "op"
        assert msg["op"]["type"] == "draw.remove"
        assert "d1" not in state.objects


# ---- uploads --------------------------------------------------------------------


def test_upload_recompresses_to_webp(client, campaign):
    resp = client.post(
        f"/api/upload/{campaign['player_token']}?kind=token&name=Ana",
        files={"file": ("goblin.png", png_bytes(), "image/png")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["filename"].endswith(".webp")

    served = client.get(f"/assets/{body['filename']}")
    assert served.status_code == 200
    assert "immutable" in served.headers["cache-control"]

    # el asset quedó en la biblioteca con su personaje+variante
    assert body["characterId"]
    asset = state.assets[body["id"]]
    assert asset.kind == "token"
    variants = [v for v in state.variants.values() if v.asset_id == asset.id]
    assert len(variants) == 1


def test_upload_token_downscales_to_512(client, campaign):
    resp = client.post(
        f"/api/upload/{campaign['dm_token']}?kind=token&name=DM",
        files={"file": ("big.png", png_bytes(size=(1000, 800)), "image/png")},
    )
    assert resp.status_code == 200
    from app import config

    saved = Image.open(config.ASSETS_DIR / resp.json()["filename"])
    assert max(saved.size) <= 512


def test_upload_map_downscales_to_4096(client, campaign):
    resp = client.post(
        f"/api/upload/{campaign['dm_token']}?kind=map&name=DM",
        files={"file": ("map.png", png_bytes(size=(5000, 100)), "image/png")},
    )
    assert resp.status_code == 200
    from app import config

    saved = Image.open(config.ASSETS_DIR / resp.json()["filename"])
    assert max(saved.size) <= 4096


def test_upload_over_10mb_rejected(client, campaign):
    big = b"\x00" * (10 * 1024 * 1024 + 1)
    resp = client.post(
        f"/api/upload/{campaign['dm_token']}?kind=map&name=DM",
        files={"file": ("huge.png", big, "image/png")},
    )
    assert resp.status_code == 400


def test_upload_invalid_image_rejected(client, campaign):
    resp = client.post(
        f"/api/upload/{campaign['dm_token']}?kind=token&name=DM",
        files={"file": ("fake.png", b"not an image", "image/png")},
    )
    assert resp.status_code == 400


def test_upload_invalid_token_403(client):
    resp = client.post(
        "/api/upload/nope?kind=token",
        files={"file": ("x.png", png_bytes(), "image/png")},
    )
    assert resp.status_code == 403


# ---- persistencia round-trip -------------------------------------------------


def test_persistence_roundtrip(client, campaign):
    with client.websocket_connect(
        f"/ws/{campaign['dm_token']}?name=DM&clientId=dm1"
    ) as sock:
        sock.receive_json()
        sock.receive_json()
        sock.receive_json()
        sock.send_json(
            {
                "type": "token.add",
                "opId": "op-1",
                "payload": {"id": "tok1", "data": {"x": 3, "y": 4, "name": "Orco"}},
            }
        )
        sock.receive_json()
        sock.send_json(
            {
                "type": "scene.setGrid",
                "opId": "op-2",
                "payload": {"grid": {"type": "hex", "orientation": "pointy", "cellSize": 80}},
            }
        )
        sock.receive_json()

    asyncio.run(state.flush())

    # estado fresco desde la DB: debe ser idéntico
    fresh = AppState()
    fresh.load_from_db()
    assert "tok1" in fresh.objects
    assert json.loads(fresh.objects["tok1"].data_json)["name"] == "Orco"
    scene = fresh.active_scene("camp1") or next(iter(fresh.scenes.values()))
    grid = json.loads(scene.grid_config_json)
    assert grid["type"] == "hex"
    assert grid["orientation"] == "pointy"
    assert grid["cellSize"] == 80
    # tokens de acceso resuelven igual
    dm_resolved = fresh.resolve_token(campaign["dm_token"])
    player_resolved = fresh.resolve_token(campaign["player_token"])
    assert dm_resolved is not None and dm_resolved[1] == "dm"
    assert player_resolved is not None and player_resolved[1] == "player"
