"""Tests del parseo de URL de cloudflared y del flush debounced."""

import asyncio

from app.tunnel import URL_RE


def test_tunnel_url_regex_matches_real_output():
    # formato real de la salida de cloudflared quick tunnel
    sample_lines = [
        "2024-01-01T00:00:00Z INF +--------------------------------------------------------------------------------------------+",
        "2024-01-01T00:00:00Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |",
        "2024-01-01T00:00:00Z INF |  https://palabra-otra-mas-algo.trycloudflare.com  |",
        "2024-01-01T00:00:00Z INF +--------------------------------------------------------------------------------------------+",
    ]
    found = None
    for line in sample_lines:
        match = URL_RE.search(line)
        if match:
            found = match.group(0)
    assert found == "https://palabra-otra-mas-algo.trycloudflare.com"


def test_tunnel_url_regex_rejects_lookalikes():
    assert URL_RE.search("https://trycloudflare.com") is None
    assert URL_RE.search("https://evil.com/x.trycloudflare.com.evil.com") is None
    assert URL_RE.search("ver http://localhost:8000") is None


def test_flush_writes_dirty_only(fresh_state, campaign):
    """El flush persiste lo dirty y limpia la cola."""
    import json

    from app import db as dbm

    scene = campaign["scene"]
    scene.name = "Renombrada"
    fresh_state.mark_dirty(scene)
    assert fresh_state._dirty  # hay algo pendiente
    asyncio.run(fresh_state.flush())
    assert not fresh_state._dirty

    fresh = dbm.load_all()
    scenes = [s for s in fresh.scenes if s.id == scene.id]
    assert scenes[0].name == "Renombrada"


def test_flush_handles_add_then_delete_same_window(fresh_state, campaign):
    """Objeto creado y borrado antes del flush: no debe romper ni persistir."""
    import time

    from app import db as dbm

    obj = dbm.SceneObject(
        id="ghost",
        scene_id=campaign["scene"].id,
        type="shape",
        z_index=1,
        owner="x",
        data_json="{}",
        updated_at=time.time(),
    )
    fresh_state.objects[obj.id] = obj
    fresh_state.mark_dirty(obj)
    del fresh_state.objects[obj.id]
    fresh_state.mark_deleted(obj)
    asyncio.run(fresh_state.flush())

    fresh = dbm.load_all()
    assert not [o for o in fresh.objects if o.id == "ghost"]
