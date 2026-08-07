"""Abstracción GridSystem: interfaz idéntica en server y cliente.

Config de grilla (grid_config_json de la escena):
    type: "square" | "hex"
    orientation: "flat" | "pointy"      (solo hex)
    cellSize: float                      (px; en hex = ancho visual de la celda)
    offsetX, offsetY: float              (calibración, px)
    color: str, opacity: float, enabled: bool
    snap: bool
    metersPerCell: float                 (default 1.5)
    playersMoveAny: bool                 (jugadores pueden mover cualquier token)

Convenciones:
- Cuadrada: líneas de grilla en offset + n*cellSize; snap al centro de celda.
- Hex: coordenadas axiales (q, r). cellSize = ancho visual del hex:
  flat-top  → ancho = 2*size          ⇒ size = cellSize/2
  pointy-top → ancho = sqrt(3)*size    ⇒ size = cellSize/sqrt(3)
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

Point = tuple[float, float]
Cell = tuple[int, int]  # (col, row) en cuadrada; (q, r) axial en hex


@dataclass
class GridConfig:
    type: str = "square"
    orientation: str = "flat"
    cellSize: float = 64.0
    offsetX: float = 0.0
    offsetY: float = 0.0
    color: str = "#ffffff"
    opacity: float = 0.4
    enabled: bool = True
    snap: bool = True
    metersPerCell: float = 1.5
    playersMoveAny: bool = True

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "GridConfig":
        cfg = cls()
        if not data:
            return cfg
        for key in (
            "type",
            "orientation",
            "cellSize",
            "offsetX",
            "offsetY",
            "color",
            "opacity",
            "enabled",
            "snap",
            "metersPerCell",
            "playersMoveAny",
        ):
            if key in data:
                setattr(cfg, key, data[key])
        return cfg

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "orientation": self.orientation,
            "cellSize": self.cellSize,
            "offsetX": self.offsetX,
            "offsetY": self.offsetY,
            "color": self.color,
            "opacity": self.opacity,
            "enabled": self.enabled,
            "snap": self.snap,
            "metersPerCell": self.metersPerCell,
            "playersMoveAny": self.playersMoveAny,
        }


class GridSystem:
    """Interfaz común (espejo de web/src/grid/types.ts)."""

    def __init__(self, config: GridConfig):
        self.config = config

    def cell_of(self, point: Point) -> Cell:
        raise NotImplementedError

    def cell_center(self, cell: Cell) -> Point:
        raise NotImplementedError

    def snap(self, point: Point) -> Point:
        return self.cell_center(self.cell_of(point))

    def cell_distance(self, a: Cell, b: Cell) -> int:
        raise NotImplementedError

    def distance(self, a: Point, b: Point) -> float:
        """Distancia en celdas entre dos puntos (para la herramienta de medición)."""
        return float(self.cell_distance(self.cell_of(a), self.cell_of(b)))

    def distance_meters(self, a: Point, b: Point) -> float:
        return self.distance(a, b) * self.config.metersPerCell

    def cells_between(self, a: Point, b: Point) -> list[Cell]:
        """Celdas que atraviesa la línea a→b (para medición/preview)."""
        raise NotImplementedError


class SquareGrid(GridSystem):
    def cell_of(self, point: Point) -> Cell:
        c = self.config
        col = math.floor((point[0] - c.offsetX) / c.cellSize)
        row = math.floor((point[1] - c.offsetY) / c.cellSize)
        return (col, row)

    def cell_center(self, cell: Cell) -> Point:
        c = self.config
        return (
            c.offsetX + (cell[0] + 0.5) * c.cellSize,
            c.offsetY + (cell[1] + 0.5) * c.cellSize,
        )

    def cell_distance(self, a: Cell, b: Cell) -> int:
        # Chebyshev: diagonales cuestan 1 (estilo D&D 5e).
        return max(abs(a[0] - b[0]), abs(a[1] - b[1]))

    def cells_between(self, a: Point, b: Point) -> list[Cell]:
        # Línea supercover sobre celdas (Amanatides & Woo simplificado).
        c = self.config
        x0 = (a[0] - c.offsetX) / c.cellSize
        y0 = (a[1] - c.offsetY) / c.cellSize
        x1 = (b[0] - c.offsetX) / c.cellSize
        y1 = (b[1] - c.offsetY) / c.cellSize
        cells: list[Cell] = []
        col, row = math.floor(x0), math.floor(y0)
        end_col, end_row = math.floor(x1), math.floor(y1)
        dx, dy = x1 - x0, y1 - y0
        step_col = 1 if dx > 0 else -1
        step_row = 1 if dy > 0 else -1
        t_max_x = (
            ((col + (1 if dx > 0 else 0)) - x0) / dx if dx != 0 else math.inf
        )
        t_max_y = (
            ((row + (1 if dy > 0 else 0)) - y0) / dy if dy != 0 else math.inf
        )
        t_delta_x = abs(1 / dx) if dx != 0 else math.inf
        t_delta_y = abs(1 / dy) if dy != 0 else math.inf
        cells.append((col, row))
        guard = 0
        while (col, row) != (end_col, end_row) and guard < 10000:
            if t_max_x < t_max_y:
                t_max_x += t_delta_x
                col += step_col
            elif t_max_y < t_max_x:
                t_max_y += t_delta_y
                row += step_row
            else:  # esquina exacta: avanzar en diagonal
                t_max_x += t_delta_x
                t_max_y += t_delta_y
                col += step_col
                row += step_row
            cells.append((col, row))
            guard += 1
        return cells


class HexGrid(GridSystem):
    """Hexágonos en coordenadas axiales. flat-top y pointy-top."""

    @property
    def size(self) -> float:
        c = self.config
        if c.orientation == "flat":
            return c.cellSize / 2.0
        return c.cellSize / math.sqrt(3.0)

    # -- pixel ↔ axial ---------------------------------------------------

    def cell_center(self, cell: Cell) -> Point:
        c = self.config
        q, r = cell
        s = self.size
        if c.orientation == "flat":
            x = s * 1.5 * q
            y = s * math.sqrt(3) * (r + q / 2.0)
        else:
            x = s * math.sqrt(3) * (q + r / 2.0)
            y = s * 1.5 * r
        return (x + c.offsetX, y + c.offsetY)

    def cell_of(self, point: Point) -> Cell:
        c = self.config
        x = point[0] - c.offsetX
        y = point[1] - c.offsetY
        s = self.size
        if c.orientation == "flat":
            q = (2.0 / 3.0 * x) / s
            r = (-1.0 / 3.0 * x + math.sqrt(3) / 3.0 * y) / s
        else:
            q = (math.sqrt(3) / 3.0 * x - 1.0 / 3.0 * y) / s
            r = (2.0 / 3.0 * y) / s
        return _axial_round(q, r)

    def cell_distance(self, a: Cell, b: Cell) -> int:
        dq = a[0] - b[0]
        dr = a[1] - b[1]
        return int((abs(dq) + abs(dr) + abs(dq + dr)) / 2)

    def cells_between(self, a: Point, b: Point) -> list[Cell]:
        ca, cb = self.cell_of(a), self.cell_of(b)
        n = self.cell_distance(ca, cb)
        if n == 0:
            return [ca]
        # Lerp en coords cúbicas con redondeo (redblobgames hex line).
        results: list[Cell] = []
        for i in range(n + 1):
            t = i / n
            q = _lerp(ca[0], cb[0], t)
            r = _lerp(ca[1], cb[1], t)
            cell = _axial_round(q, r)
            if not results or results[-1] != cell:
                results.append(cell)
        return results

    def cell_corners(self, cell: Cell) -> list[Point]:
        """Vértices del hex (para render en cliente; espejo en HexGrid.ts)."""
        cx, cy = self.cell_center(cell)
        s = self.size
        start_angle = 0.0 if self.config.orientation == "flat" else 30.0
        corners = []
        for i in range(6):
            angle = math.radians(start_angle + 60.0 * i)
            corners.append((cx + s * math.cos(angle), cy + s * math.sin(angle)))
        return corners


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _axial_round(q: float, r: float) -> Cell:
    x, z = q, r
    y = -x - z
    rx, ry, rz = round(x), round(y), round(z)
    dx, dy, dz = abs(rx - x), abs(ry - y), abs(rz - z)
    if dx > dy and dx > dz:
        rx = -ry - rz
    elif dy > dz:
        ry = -rx - rz
    else:
        rz = -rx - ry
    return (int(rx), int(rz))


def grid_from_config(data: dict[str, Any] | GridConfig | None) -> GridSystem:
    cfg = data if isinstance(data, GridConfig) else GridConfig.from_dict(data)
    if cfg.type == "hex":
        return HexGrid(cfg)
    return SquareGrid(cfg)
