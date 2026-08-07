"""Tests de biblioteca REST: variantes, borrado de assets y cascadas."""

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

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


def png() -> bytes:
    img = Image.new("RGB", (32, 32), (0, 255, 0))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def upload(client, token, kind="token", name="Ana", character_id=""):
    return client.post(
        f"/api/upload/{token}?kind={kind}&name={name}&characterId={character_id}",
        files={"file": ("img.png", png(), "image/png")},
    )


def test_upload_token_creates_character_and_variant(client, campaign):
    resp = upload(client, campaign["player_token"])
    assert resp.status_code == 200
    body = resp.json()
    assert body["characterId"] in state.characters
    variants = [v for v in state.variants.values() if v.character_id == body["characterId"]]
    assert len(variants) == 1
    assert variants[0].asset_id == body["id"]
    assert variants[0].id == body["variantId"]


def test_upload_with_character_adds_variant_to_existing(client, campaign):
    first = upload(client, campaign["player_token"]).json()
    char_id = first["characterId"]
    second = upload(client, campaign["player_token"], character_id=char_id).json()
    assert second["characterId"] == char_id
    variants = [v for v in state.variants.values() if v.character_id == char_id]
    assert len(variants) == 2


def test_add_variant_endpoint(client, campaign):
    char = upload(client, campaign["player_token"]).json()
    other = client.post(
        f"/api/upload/{campaign['player_token']}?kind=other&name=Ana",
        files={"file": ("o.png", png(), "image/png")},
    ).json()
    resp = client.post(
        f"/api/characters/{campaign['player_token']}/{char['characterId']}/variants"
        f"?assetId={other['id']}&label=Lobo&sizeCells=2"
    )
    assert resp.status_code == 200
    variants = [v for v in state.variants.values() if v.character_id == char["characterId"]]
    assert len(variants) == 2
    wolf = [v for v in variants if v.label == "Lobo"][0]
    assert wolf.size_cells == 2


def test_delete_asset_permission_rules(client, campaign):
    # Ana sube un token; otro jugador no puede borrarlo; el DM sí
    uploaded = upload(client, campaign["player_token"], name="Ana").json()
    resp = client.delete(
        f"/api/assets/{campaign['player_token']}/{uploaded['id']}?name=Otro"
    )
    assert resp.status_code == 403
    resp = client.delete(f"/api/assets/{campaign['dm_token']}/{uploaded['id']}")
    assert resp.status_code == 200
    assert uploaded["id"] not in state.assets


def test_delete_asset_cascades_variants_and_empty_character(client, campaign):
    uploaded = upload(client, campaign["player_token"], name="Ana").json()
    char_id = uploaded["characterId"]
    resp = client.delete(
        f"/api/assets/{campaign['player_token']}/{uploaded['id']}?name=Ana"
    )
    assert resp.status_code == 200
    # la variante desaparece y el personaje vacío también
    assert not [v for v in state.variants.values() if v.character_id == char_id]
    assert char_id not in state.characters


def test_delete_asset_removes_file(client, campaign):
    from app import config

    uploaded = upload(client, campaign["player_token"], name="Ana").json()
    path = config.ASSETS_DIR / uploaded["filename"]
    assert path.exists()
    client.delete(f"/api/assets/{campaign['dm_token']}/{uploaded['id']}")
    assert not path.exists()


def test_serve_asset_path_traversal_blocked(client, campaign):
    # ".." encoded llega al endpoint como filename literal → rechazado
    assert client.get("/assets/%2E%2E").status_code == 400
    assert client.get("/assets/nope.webp").status_code == 404
    # ".." literal lo normaliza el propio HTTP client antes de enviar → cae al
    # fallback SPA, que solo sirve index.html (nunca un archivo del disco)
    resp = client.get("/assets/..")
    assert resp.status_code == 200
    assert "<div id=\"root\">" in resp.text


def test_tunnel_info_dm_only(client, campaign):
    assert client.get(f"/api/tunnel/{campaign['player_token']}").status_code == 403
    resp = client.get(f"/api/tunnel/{campaign['dm_token']}")
    assert resp.status_code == 200
    assert resp.json()["url"] is None  # TUNNEL=off en tests
