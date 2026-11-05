"""Notación de dados y contrato WS: autoridad, historial, aislamiento y undo."""

import pytest
from fastapi.testclient import TestClient

from app import dice, ws
from app.main import create_app
from app.state import state
from app.undo import undo_manager


def fixed_rolls(monkeypatch, values):
    results = iter(values)
    monkeypatch.setattr(dice.secrets, "randbelow", lambda sides: next(results) - 1)


def test_multiple_groups_modifiers_and_normalization(monkeypatch):
    fixed_rolls(monkeypatch, [3, 6, 2])
    result = dice.roll_expression(" 2D6 + d4 - 2 ")
    assert result["expression"] == "2d6+1d4-2"
    assert result["total"] == 9
    assert [t["subtotal"] for t in result["terms"]] == [9, 2, -2]
    assert result["terms"][0]["rolls"] == [3, 6]
    assert result["terms"][0]["kept"] == [True, True]


@pytest.mark.parametrize("suffix,kept,total", [
    ("kh1", [False, True], 18),
    ("kl1", [True, False], 4),
])
def test_advantage_and_disadvantage(monkeypatch, suffix, kept, total):
    fixed_rolls(monkeypatch, [4, 18])
    result = dice.roll_expression(f"2d20{suffix}")
    assert result["total"] == total
    assert result["terms"][0]["kept"] == kept


def test_keep_ties_keeps_exactly_requested_count(monkeypatch):
    fixed_rolls(monkeypatch, [6, 1, 6, 6])
    result = dice.roll_expression("4d6kh2")
    assert result["total"] == 12
    assert sum(result["terms"][0]["kept"]) == 2
    assert result["terms"][0]["rolls"] == [6, 1, 6, 6]


def test_signed_dice_and_leading_modifier(monkeypatch):
    fixed_rolls(monkeypatch, [5, 2])
    assert dice.roll_expression("3+1d6-1d4")["total"] == 6
    fixed_rolls(monkeypatch, [5])
    assert dice.roll_expression("-1d6+2")["total"] == -3


def test_limits_and_die_boundaries(monkeypatch):
    monkeypatch.setattr(dice.secrets, "randbelow", lambda sides: sides - 1)
    assert dice.roll_expression("100d1000+100000")["total"] == 200000
    monkeypatch.setattr(dice.secrets, "randbelow", lambda sides: 0)
    assert dice.roll_expression("d2")["total"] == 1


@pytest.mark.parametrize("expression", [
    None, 20, [], {}, "", "   ", "5", "d", "d1", "d0", "0d6", "101d6",
    "50d6+51d4", "1d1001", "2d20kh0", "2d20kh3", "2d20kl3", "d6+100001",
    "2d6++3", "1d6-", "1d6*2", "(1d6)", "1d6/2", "1d6d6", "1d6garbage",
    "__import__('os')", "9" * 201, "+".join(["d6"] * 21), "2d6kh", "1.5d6",
])
def test_invalid_formulas_rejected_before_rolling(monkeypatch, expression):
    def must_not_roll(sides):
        raise AssertionError("no debe generar dados con una fórmula inválida")
    monkeypatch.setattr(dice.secrets, "randbelow", must_not_roll)
    with pytest.raises(dice.DiceError):
        dice.roll_expression(expression)


@pytest.fixture
def client(fresh_state):
    ws.rooms.clear()
    with TestClient(create_app()) as app_client:
        yield app_client
    ws.rooms.clear()


@pytest.fixture
def tokens(client):
    urls = client.post("/api/campaigns", json={"name": "Mesa"}).json()
    return {"dm": urls["dm_url"].split("/")[-1], "player": urls["player_url"].split("/")[-1]}


def receive(sock, kind):
    for _ in range(20):
        msg = sock.receive_json()
        if msg["type"] == kind:
            return msg
        if msg["type"] in ("error", "dice.error"):
            raise AssertionError(f"Pedido rechazado: {msg}")
    raise AssertionError(f"No llegó {kind}")


def roll(sock, expression="1d20+5", op_id="roll-1", **extra):
    sock.send_json({"type": "dice.roll", "opId": op_id, "payload": {"expression": expression, **extra}})
    return receive(sock, "dice.result")["roll"]


def test_roll_broadcasts_identical_server_result_to_everyone(client, tokens, monkeypatch):
    fixed_rolls(monkeypatch, [17])
    with client.websocket_connect(f"/ws/{tokens['dm']}?name=DM&clientId=dm") as dm:
        receive(dm, "presence")
        with client.websocket_connect(f"/ws/{tokens['player']}?name=Ana&clientId=p1") as player:
            receive(player, "presence")
            result = roll(player, label="Ataque", author="Falso", total=999, rolls=[20], color="#123456")
            assert receive(dm, "dice.result")["roll"] == result
            assert result["author"] == "Ana"
            assert result["clientId"] == "p1"
            assert result["label"] == "Ataque"
            assert result["total"] == 22
            assert result["terms"][0]["rolls"] == [17]
            assert result["createdAt"] > 0
            assert result["color"] == dice.PLAYER_COLORS[0]


def test_reconnect_and_scene_switch_retain_history(client, tokens):
    url = f"/ws/{tokens['dm']}?name=DM&clientId=dm"
    with client.websocket_connect(url) as dm:
        receive(dm, "presence")
        result = roll(dm)
        dm.send_json({"type": "scene.create", "payload": {"id": "other-scene", "name": "Otra escena"}})
        update = receive(dm, "scene.update")
        other_scene = next(s["id"] for s in update["scenes"] if s["name"] == "Otra escena")
        dm.send_json({"type": "scene.switch", "payload": {"sceneId": other_scene}})
        snapshot = receive(dm, "scene.snapshot")
        assert snapshot["diceRolls"] == [result]
        assert snapshot["scene"]["id"] == other_scene
    with client.websocket_connect(url) as dm:
        assert receive(dm, "scene.snapshot")["diceRolls"] == [result]


def test_history_is_bounded_and_duplicate_request_does_not_reroll(client, tokens, monkeypatch):
    fixed_rolls(monkeypatch, [1] * 55)
    url = f"/ws/{tokens['player']}?name=Ana&clientId=p1"
    with client.websocket_connect(url) as player:
        receive(player, "presence")
        results = [roll(player, "d6", f"r{i}") for i in range(55)]
        assert roll(player, "d6", "r54") == results[-1]
    with client.websocket_connect(url) as player:
        assert receive(player, "scene.snapshot")["diceRolls"] == results[-50:]


@pytest.mark.parametrize("payload", [
    {"expression": "101d6"}, {"expression": "d20", "label": "x" * 81},
    {"expression": "d20", "label": 5}, {"expression": {"total": 20}}, [1, 2],
])
def test_bad_request_returns_visible_error_and_connection_survives(client, tokens, payload):
    with client.websocket_connect(f"/ws/{tokens['player']}?clientId=p1") as player:
        receive(player, "presence")
        player.send_json({"type": "dice.roll", "opId": "bad", "payload": payload})
        error = receive(player, "dice.error")
        assert error["opId"] == "bad"
        assert error["reason"]
        assert roll(player)["total"] >= 6


def test_campaign_isolation(client, tokens):
    other_urls = client.post("/api/campaigns", json={"name": "Otra mesa"}).json()
    other_token = other_urls["player_url"].split("/")[-1]
    with client.websocket_connect(f"/ws/{tokens['player']}?clientId=p1") as player:
        receive(player, "presence")
        roll(player)
        with client.websocket_connect(f"/ws/{other_token}?clientId=p1") as other:
            assert receive(other, "scene.snapshot")["diceRolls"] == []
            roll(other)
            player.send_json({"type": "heartbeat"})
            assert player.receive_json()["type"] == "heartbeat"


def test_rolls_do_not_persist_or_change_undo_redo(client, tokens):
    resolved = state.resolve_token(tokens["player"])
    assert resolved is not None
    campaign_id = resolved[0]
    inverse = {"type": "token.remove", "payload": {"id": "t1"}}
    undo_manager.push_undo(campaign_id, "p1", inverse)
    undo_manager.push_redo(campaign_id, "p1", inverse)
    with client.websocket_connect(f"/ws/{tokens['player']}?clientId=p1") as player:
        receive(player, "presence")
        roll(player)
        assert not state._dirty
        assert not state.objects
        assert undo_manager.pop_undo(campaign_id, "p1") == inverse
        assert undo_manager.pop_redo(campaign_id, "p1") == inverse
    # Simular pérdida del estado efímero: un Room nuevo no tiene historial.
    ws.rooms.clear()
    with client.websocket_connect(f"/ws/{tokens['player']}?clientId=p1") as player:
        assert receive(player, "scene.snapshot")["diceRolls"] == []


def test_clock_sync_provides_server_time_and_echoes_client_timestamp(client, tokens):
    with client.websocket_connect(f"/ws/{tokens['player']}?clientId=p1") as player:
        snapshot = receive(player, "scene.snapshot")
        assert snapshot["serverTime"] > 0
        receive(player, "presence")
        player.send_json({"type": "heartbeat", "sentAt": 1234567890000})
        sync = receive(player, "heartbeat")
        assert sync["sentAt"] == 1234567890000
        assert sync["serverTime"] >= snapshot["serverTime"]
        player.send_json({"type": "heartbeat"})
        assert receive(player, "heartbeat")["serverTime"] >= sync["serverTime"]


def test_simultaneous_players_receive_rolls_in_identical_order(client, tokens):
    with client.websocket_connect(f"/ws/{tokens['dm']}?name=DM&clientId=dm") as dm:
        receive(dm, "presence")
        with client.websocket_connect(f"/ws/{tokens['player']}?name=Ana&clientId=p1") as player:
            receive(player, "presence")
            dm.send_json({"type": "dice.roll", "opId": "dm-roll", "payload": {"expression": "d6"}})
            player.send_json({"type": "dice.roll", "opId": "player-roll", "payload": {"expression": "d20"}})
            dm_rolls = [receive(dm, "dice.result")["roll"] for _ in range(2)]
            player_rolls = [receive(player, "dice.result")["roll"] for _ in range(2)]
            assert dm_rolls == player_rolls
            assert {r["opId"] for r in dm_rolls} == {"dm-roll", "player-roll"}
            assert len({r["color"] for r in dm_rolls}) == 2


def test_player_color_survives_rename_reconnect_and_is_not_shared_by_names(client, tokens):
    url = f"/ws/{tokens['player']}?name=Ana&clientId=p1"
    with client.websocket_connect(url) as player:
        receive(player, "presence")
        first = roll(player)
        player.send_json({"type": "presence.rename", "payload": {"name": "Berta"}})
        receive(player, "presence")
        renamed = roll(player, op_id="renamed")
        assert renamed["author"] == "Berta"
        assert renamed["color"] == first["color"]
    with client.websocket_connect(url) as player:
        receive(player, "presence")
        assert roll(player, op_id="reconnected")["color"] == first["color"]
        with client.websocket_connect(f"/ws/{tokens['player']}?name=Ana&clientId=p2") as other:
            receive(other, "presence")
            assert roll(other)["color"] != first["color"]


def test_many_participants_have_distinct_colors():
    room = ws.Room()
    colors = [room.dice_color(f"p{i}") for i in range(32)]
    assert len(set(colors)) == len(colors)
    assert all(len(color) == 7 and color.startswith("#") for color in colors)
    assert [room.dice_color(f"p{i}") for i in range(32)] == colors
