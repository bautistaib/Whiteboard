"""Pilas de undo/redo por usuario (solo memoria, cap 50 — per spec).

Cada entrada es una inversa tal como la genera `ops.compute_inverse`.
Deshacer aplica la inversa como op nueva (broadcasteada); rehacer reaplica.
"""

from __future__ import annotations

from collections import deque
from typing import Any

CAP = 50


class UserStacks:
    def __init__(self) -> None:
        self.undo: deque[dict[str, Any]] = deque(maxlen=CAP)
        self.redo: deque[dict[str, Any]] = deque(maxlen=CAP)


class UndoManager:
    def __init__(self) -> None:
        # (campaign_id, client_id) → pilas
        self._stacks: dict[tuple[str, str], UserStacks] = {}

    def _for(self, campaign_id: str, client_id: str) -> UserStacks:
        key = (campaign_id, client_id)
        if key not in self._stacks:
            self._stacks[key] = UserStacks()
        return self._stacks[key]

    def push_undo(
        self, campaign_id: str, client_id: str, inverse: dict[str, Any] | None
    ) -> None:
        """Registra la inversa de una op normal. Una op nueva invalida el redo."""
        if inverse is None:
            return
        stacks = self._for(campaign_id, client_id)
        stacks.undo.append(inverse)
        stacks.redo.clear()

    def push_redo(self, campaign_id: str, client_id: str, inverse: dict[str, Any]) -> None:
        self._for(campaign_id, client_id).redo.append(inverse)

    def push_undo_from_redo(
        self, campaign_id: str, client_id: str, inverse: dict[str, Any]
    ) -> None:
        """Rehacer vuelve a apilar en undo sin tocar redo."""
        self._for(campaign_id, client_id).undo.append(inverse)

    def pop_undo(self, campaign_id: str, client_id: str) -> dict[str, Any] | None:
        stacks = self._for(campaign_id, client_id)
        return stacks.undo.pop() if stacks.undo else None

    def pop_redo(self, campaign_id: str, client_id: str) -> dict[str, Any] | None:
        stacks = self._for(campaign_id, client_id)
        return stacks.redo.pop() if stacks.redo else None

    def clear_campaign(self, campaign_id: str) -> None:
        """Descarta las pilas de una campaña eliminada."""
        for key in [k for k in self._stacks if k[0] == campaign_id]:
            del self._stacks[key]


undo_manager = UndoManager()
