"""Presence: rename en vivo (presence.rename)."""

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(fresh_state):
    with TestClient(create_app()) as c:
        yield c


def _drain_until(sock, msg_type):
    """Lee mensajes hasta encontrar uno del tipo pedido."""
    for _ in range(20):
        msg = sock.receive_json()
        if msg["type"] == msg_type:
            return msg
    raise AssertionError(f"no llegó mensaje {msg_type}")


def test_presence_rename_broadcasts_new_name(client, campaign):
    with client.websocket_connect("/ws/dmtoken?name=DM&clientId=dm1") as dm:
        dm.receive_json()  # snapshot
        dm.receive_json()  # tunnel.url
        dm.receive_json()  # presence
        with client.websocket_connect("/ws/playertoken?name=Ana&clientId=p1") as player:
            player.receive_json()  # snapshot
            player.receive_json()  # presence (join)
            dm.receive_json()  # presence por el join

            player.send_json(
                {"type": "presence.rename", "opId": "1", "payload": {"name": "Berta"}}
            )
            msg = _drain_until(dm, "presence")
            names = {u["clientId"]: u["name"] for u in msg["users"]}
            assert names["p1"] == "Berta"
            assert names["dm1"] == "DM"


def test_presence_rename_empty_falls_back_to_anonimo(client, campaign):
    with client.websocket_connect("/ws/dmtoken?name=DM&clientId=dm1") as dm:
        dm.receive_json()  # snapshot
        dm.receive_json()  # tunnel.url
        dm.receive_json()  # presence

        dm.send_json({"type": "presence.rename", "opId": "1", "payload": {"name": ""}})
        msg = _drain_until(dm, "presence")
        names = {u["clientId"]: u["name"] for u in msg["users"]}
        assert names["dm1"] == "Anónimo"
