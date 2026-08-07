"""Tests de GridSystem: cuadrada y hexagonal (snap, distancia, calibración)."""

import math

import pytest

from app.grid import GridConfig, HexGrid, SquareGrid, grid_from_config


# ---- cuadrada ----------------------------------------------------------


def sq(**kw) -> SquareGrid:
    return SquareGrid(GridConfig(type="square", **kw))


def test_square_cell_of_origin():
    g = sq(cellSize=64)
    assert g.cell_of((0, 0)) == (0, 0)
    assert g.cell_of((63.9, 63.9)) == (0, 0)
    assert g.cell_of((64, 64)) == (1, 1)
    assert g.cell_of((-1, -1)) == (-1, -1)


def test_square_snap_to_center():
    g = sq(cellSize=64)
    assert g.snap((0, 0)) == (32, 32)
    assert g.snap((70, 10)) == (96, 32)


def test_square_snap_with_offset():
    g = sq(cellSize=50, offsetX=10, offsetY=20)
    # celda (0,0) va de (10,20) a (60,70); centro (35,45)
    assert g.cell_of((10, 20)) == (0, 0)
    assert g.cell_of((59.9, 69.9)) == (0, 0)
    assert g.snap((11, 21)) == (35, 45)
    assert g.cell_of((-40, -30)) == (-1, -1)  # [-40,-30]→ x:-50..0? no: floor((-40-10)/50)=-1
    assert g.snap((-40, -30)) == (-15, -5)


def test_square_distance_chebyshev():
    g = sq(cellSize=64)
    assert g.distance((32, 32), (32, 32)) == 0
    assert g.distance((32, 32), (96, 32)) == 1  # una celda al lado
    assert g.distance((32, 32), (96, 96)) == 1  # diagonal = 1
    assert g.distance((32, 32), (32 + 3 * 64, 32 + 2 * 64)) == 3


def test_square_distance_meters():
    g = sq(cellSize=64, metersPerCell=1.5)
    assert g.distance_meters((32, 32), (32 + 4 * 64, 32)) == 6.0


def test_square_cells_between_line():
    g = sq(cellSize=64)
    cells = g.cells_between((32, 32), (32 + 3 * 64, 32))
    assert cells == [(0, 0), (1, 0), (2, 0), (3, 0)]


def test_square_cells_between_diagonal_corner():
    g = sq(cellSize=64)
    cells = g.cells_between((32, 32), (32 + 2 * 64, 32 + 2 * 64))
    assert cells == [(0, 0), (1, 1), (2, 2)]


# ---- hexagonal ----------------------------------------------------------


def hx(orientation="flat", **kw) -> HexGrid:
    return HexGrid(GridConfig(type="hex", orientation=orientation, **kw))


def test_hex_size_from_visual_width():
    # cellSize = ancho visual: flat → 2*size; pointy → sqrt(3)*size
    assert hx("flat", cellSize=64).size == pytest.approx(32)
    assert hx("pointy", cellSize=64).size == pytest.approx(64 / math.sqrt(3))


def test_hex_flat_center_roundtrip():
    g = hx("flat", cellSize=64)
    for cell in [(0, 0), (1, 0), (0, 1), (2, -1), (-3, 2), (4, 4)]:
        center = g.cell_center(cell)
        assert g.cell_of(center) == cell


def test_hex_pointy_center_roundtrip():
    g = hx("pointy", cellSize=64)
    for cell in [(0, 0), (1, 0), (0, 1), (2, -1), (-3, 2), (4, 4)]:
        center = g.cell_center(cell)
        assert g.cell_of(center) == cell


def test_hex_flat_known_centers():
    g = hx("flat", cellSize=64)  # size=32
    # flat-top: x = 1.5*s*q ; y = s*sqrt(3)*(r + q/2)
    assert g.cell_center((0, 0)) == (0, 0)
    assert g.cell_center((1, 0)) == (pytest.approx(48), pytest.approx(32 * math.sqrt(3) / 2))
    assert g.cell_center((0, 1)) == (pytest.approx(0), pytest.approx(32 * math.sqrt(3)))


def test_hex_pointy_known_centers():
    g = hx("pointy", cellSize=64)  # size=64/sqrt(3)
    s = g.size
    assert g.cell_center((0, 0)) == (0, 0)
    # pointy-top: x = s*sqrt(3)*(q + r/2) ; y = s*1.5*r
    assert g.cell_center((1, 0)) == (pytest.approx(s * math.sqrt(3)), pytest.approx(0))
    assert g.cell_center((0, 1)) == (pytest.approx(s * math.sqrt(3) / 2), pytest.approx(s * 1.5))


def test_hex_snap_flat():
    g = hx("flat", cellSize=64)
    # cerca del centro de (1,0) debe snapear a ese centro
    center = g.cell_center((1, 0))
    near = (center[0] + 3, center[1] - 3)
    snapped = g.snap(near)
    assert snapped == pytest.approx(center)


def test_hex_snap_with_offset_flat_and_pointy():
    for orientation in ("flat", "pointy"):
        g = hx(orientation, cellSize=64, offsetX=13, offsetY=-7)
        for cell in [(0, 0), (2, -1), (-1, 3)]:
            center = g.cell_center(cell)
            assert g.cell_of(center) == cell
            assert g.snap((center[0] + 2, center[1] + 2)) == pytest.approx(center)


def test_hex_distance_is_hexagonal_not_euclidean():
    g = hx("flat", cellSize=64)
    origin = (0.0, 0.0)  # centro de (0,0)
    # vecinos axiales a distancia 1
    for neighbor in [(1, 0), (0, 1), (-1, 1), (-1, 0), (0, -1), (1, -1)]:
        assert g.distance(origin, g.cell_center(neighbor)) == 1
    # (2,0) está a distancia 2 en hex aunque euclídea < 2 anchos de celda
    assert g.distance(origin, g.cell_center((2, 0))) == 2
    # (2,-1): dq=2, dr=-1 → (2+1+1)/2 = 2
    assert g.distance(origin, g.cell_center((2, -1))) == 2
    # (3,-1): (3+1+2)/2 = 3
    assert g.distance(origin, g.cell_center((3, -1))) == 3


def test_hex_distance_pointy_matches_flat():
    flat = hx("flat", cellSize=64)
    pointy = hx("pointy", cellSize=64)
    for cell in [(2, -1), (-3, 2), (0, 4)]:
        assert flat.distance((0, 0), flat.cell_center(cell)) == pointy.distance(
            (0, 0), pointy.cell_center(cell)
        )


def test_hex_cells_between_line():
    g = hx("flat", cellSize=64)
    cells = g.cells_between(g.cell_center((0, 0)), g.cell_center((3, 0)))
    assert cells == [(0, 0), (1, 0), (2, 0), (3, 0)]


def test_hex_cells_between_no_duplicates():
    g = hx("flat", cellSize=64)
    cells = g.cells_between(g.cell_center((0, 0)), g.cell_center((3, -2)))
    assert len(cells) == len(set(cells))
    assert cells[0] == (0, 0)
    assert cells[-1] == (3, -2)
    # consecutivas deben ser adyacentes
    for a, b in zip(cells, cells[1:]):
        assert g.cell_distance(a, b) == 1


def test_hex_corners_count_and_radius():
    for orientation in ("flat", "pointy"):
        g = hx(orientation, cellSize=64)
        corners = g.cell_corners((2, 1))
        assert len(corners) == 6
        cx, cy = g.cell_center((2, 1))
        for x, y in corners:
            assert math.hypot(x - cx, y - cy) == pytest.approx(g.size)


# ---- factory ------------------------------------------------------------


def test_factory():
    assert isinstance(grid_from_config({"type": "square"}), SquareGrid)
    assert isinstance(grid_from_config({"type": "hex"}), HexGrid)
    assert isinstance(grid_from_config(None), SquareGrid)
    assert isinstance(grid_from_config({}), SquareGrid)
