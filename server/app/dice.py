"""Tiradas autoritativas: notación acotada, sin eval ni reglas de juego."""

from __future__ import annotations

import re
import secrets
from colorsys import hls_to_rgb
from dataclasses import dataclass
from typing import Any

HISTORY_LIMIT = 50
MAX_EXPRESSION_LENGTH = 200
MAX_DICE = 100
MAX_SIDES = 1000
MAX_TERMS = 20
MAX_MODIFIER = 100_000
PLAYER_COLORS = ("#8dc5ff", "#e4b2ff", "#ffd38c", "#89e5cb", "#ffabc3", "#8ce7f4", "#ffad82", "#c4e985")


def player_color(index: int) -> str:
    if index < len(PLAYER_COLORS):
        return PLAYER_COLORS[index]
    # Continuar la paleta sin reciclar los primeros colores al entrar más gente.
    rgb = hls_to_rgb(((index - len(PLAYER_COLORS)) * 0.61803398875) % 1, 0.74, 0.8)
    return "#" + "".join(f"{round(channel * 255):02x}" for channel in rgb)

_TERM = re.compile(
    r"(?P<sign>[+-]?)(?:"
    r"(?P<count>[0-9]*)d(?P<sides>[0-9]+)(?:(?P<keep>kh|kl)(?P<keep_count>[0-9]+))?"
    r"|(?P<constant>[0-9]+))"
)


class DiceError(ValueError):
    pass


@dataclass(frozen=True)
class Term:
    sign: int
    count: int = 0
    sides: int = 0
    keep: str | None = None
    keep_count: int = 0
    value: int = 0

    @property
    def notation(self) -> str:
        if not self.sides:
            return str(self.value)
        suffix = f"{self.keep}{self.keep_count}" if self.keep else ""
        return f"{self.count}d{self.sides}{suffix}"


def parse_expression(expression: object) -> list[Term]:
    if not isinstance(expression, str) or not 1 <= len(expression) <= MAX_EXPRESSION_LENGTH:
        raise DiceError("La fórmula debe tener entre 1 y 200 caracteres.")
    text = re.sub(r"\s+", "", expression).lower()
    terms: list[Term] = []
    position = 0
    dice_count = 0
    while position < len(text):
        match = _TERM.match(text, position)
        if match is None or (position > 0 and not match["sign"]):
            raise DiceError("Fórmula inválida. Probá 1d20+5, 2d6+1d4-2 o 2d20kh1.")
        sign = -1 if match["sign"] == "-" else 1
        if match["constant"] is not None:
            value = int(match["constant"])
            if value > MAX_MODIFIER:
                raise DiceError("Cada modificador puede ser de hasta 100000.")
            terms.append(Term(sign=sign, value=value))
        else:
            count = int(match["count"] or "1")
            sides = int(match["sides"])
            keep = match["keep"]
            keep_count = int(match["keep_count"]) if keep else count
            dice_count += count
            if not 1 <= count <= MAX_DICE or dice_count > MAX_DICE:
                raise DiceError("Podés tirar hasta 100 dados por tirada.")
            if not 2 <= sides <= MAX_SIDES:
                raise DiceError("Los dados deben tener entre 2 y 1000 caras.")
            if not 1 <= keep_count <= count:
                raise DiceError("La cantidad de dados a conservar debe estar entre 1 y los dados tirados.")
            terms.append(Term(sign, count, sides, keep, keep_count))
        if len(terms) > MAX_TERMS:
            raise DiceError("La fórmula puede tener hasta 20 términos.")
        position = match.end()
    if not dice_count:
        raise DiceError("Incluí al menos un dado en la fórmula, por ejemplo 1d20+5.")
    return terms


def roll_expression(expression: object) -> dict[str, Any]:
    # Validar toda la fórmula antes de generar cualquier número aleatorio.
    terms = parse_expression(expression)
    parts: list[dict[str, Any]] = []
    normalized = ""
    total = 0
    for term in terms:
        normalized += ("-" if term.sign < 0 else "+" if normalized else "") + term.notation
        if term.sides:
            rolls = [secrets.randbelow(term.sides) + 1 for _ in range(term.count)]
            indices = sorted(range(term.count), key=lambda i: rolls[i], reverse=term.keep == "kh")
            kept_indices = set(indices[:term.keep_count])
            kept = [i in kept_indices for i in range(term.count)]
            subtotal = term.sign * sum(value for value, keep in zip(rolls, kept) if keep)
            parts.append({
                "kind": "dice", "notation": term.notation, "sign": term.sign,
                "sides": term.sides, "rolls": rolls, "kept": kept, "subtotal": subtotal,
            })
        else:
            subtotal = term.sign * term.value
            parts.append({
                "kind": "constant", "notation": term.notation, "sign": term.sign,
                "value": term.value, "subtotal": subtotal,
            })
        total += subtotal
    return {"expression": normalized, "total": total, "terms": parts}


def roll_for_client(roll: dict[str, Any], client_id: str) -> dict[str, Any]:
    """La pantalla oculta los resultados incluso en snapshots y reconexiones."""
    if roll.get("visibility") != "screen" or roll["clientId"] == client_id:
        return roll
    return {
        **roll,
        "hidden": True,
        "total": None,
        "terms": [
            {
                "kind": "dice", "notation": term["notation"], "sign": term["sign"],
                "sides": term["sides"], "count": len(term["rolls"]),
            }
            for term in roll["terms"] if term["kind"] == "dice"
        ],
    }
