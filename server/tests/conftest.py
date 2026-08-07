import pytest

from app import config, db
from app.state import state
from app.undo import undo_manager


@pytest.fixture(autouse=True)
def fresh_state(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "TUNNEL", False)
    db.reset_engine_for_tests(tmp_path / "test.db")
    state.__init__()
    undo_manager.__init__()
    state.load_from_db()
    return state


@pytest.fixture
def campaign(fresh_state):
    """Campaña con una escena activa y tokens dm/player."""
    import json
    import time

    from app.grid import GridConfig

    c = db.Campaign(
        id="camp1",
        name="Test",
        dm_token="dmtoken",
        player_token="playertoken",
        created_at=time.time(),
    )
    s = db.Scene(
        id="scene1",
        campaign_id="camp1",
        name="Escena 1",
        grid_config_json=json.dumps(GridConfig().to_dict()),
        is_active=True,
        sort_order=0,
    )
    fresh_state.campaigns[c.id] = c
    fresh_state.tokens[c.dm_token] = (c.id, "dm")
    fresh_state.tokens[c.player_token] = (c.id, "player")
    fresh_state.scenes[s.id] = s
    return {"campaign": c, "scene": s}
