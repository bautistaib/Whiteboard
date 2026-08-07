import type { Cell, GridConfig, GridSystem, Point } from "./types";

export class SquareGrid implements GridSystem {
  constructor(readonly config: GridConfig) {}

  cellOf(p: Point): Cell {
    const c = this.config;
    return [
      Math.floor((p.x - c.offsetX) / c.cellSize),
      Math.floor((p.y - c.offsetY) / c.cellSize),
    ];
  }

  cellCenter(cell: Cell): Point {
    const c = this.config;
    return {
      x: c.offsetX + (cell[0] + 0.5) * c.cellSize,
      y: c.offsetY + (cell[1] + 0.5) * c.cellSize,
    };
  }

  snap(p: Point): Point {
    return this.cellCenter(this.cellOf(p));
  }

  cellDistance(a: Cell, b: Cell): number {
    // Chebyshev: diagonales cuestan 1 (estilo D&D 5e)
    return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
  }

  distance(a: Point, b: Point): number {
    return this.cellDistance(this.cellOf(a), this.cellOf(b));
  }

  distanceMeters(a: Point, b: Point): number {
    return this.distance(a, b) * this.config.metersPerCell;
  }

  cellsBetween(a: Point, b: Point): Cell[] {
    const c = this.config;
    const x0 = (a.x - c.offsetX) / c.cellSize;
    const y0 = (a.y - c.offsetY) / c.cellSize;
    const x1 = (b.x - c.offsetX) / c.cellSize;
    const y1 = (b.y - c.offsetY) / c.cellSize;
    const cells: Cell[] = [];
    let col = Math.floor(x0);
    let row = Math.floor(y0);
    const endCol = Math.floor(x1);
    const endRow = Math.floor(y1);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const stepCol = dx > 0 ? 1 : -1;
    const stepRow = dy > 0 ? 1 : -1;
    let tMaxX = dx !== 0 ? (col + (dx > 0 ? 1 : 0) - x0) / dx : Infinity;
    let tMaxY = dy !== 0 ? (row + (dy > 0 ? 1 : 0) - y0) / dy : Infinity;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    cells.push([col, row]);
    let guard = 0;
    while ((col !== endCol || row !== endRow) && guard < 10000) {
      if (tMaxX < tMaxY) {
        tMaxX += tDeltaX;
        col += stepCol;
      } else if (tMaxY < tMaxX) {
        tMaxY += tDeltaY;
        row += stepRow;
      } else {
        tMaxX += tDeltaX;
        tMaxY += tDeltaY;
        col += stepCol;
        row += stepRow;
      }
      cells.push([col, row]);
      guard++;
    }
    return cells;
  }
}
