import type { Cell, GridConfig, GridSystem, Point } from "./types";

function axialRound(q: number, r: number): Cell {
  const x = q;
  const z = r;
  const y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) {
    rx = -ry - rz;
  } else if (dy > dz) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }
  return [rx, rz];
}

export class HexGrid implements GridSystem {
  constructor(readonly config: GridConfig) {}

  get size(): number {
    const c = this.config;
    return c.orientation === "flat" ? c.cellSize / 2 : c.cellSize / Math.sqrt(3);
  }

  cellCenter(cell: Cell): Point {
    const c = this.config;
    const [q, r] = cell;
    const s = this.size;
    if (c.orientation === "flat") {
      return {
        x: s * 1.5 * q + c.offsetX,
        y: s * Math.sqrt(3) * (r + q / 2) + c.offsetY,
      };
    }
    return {
      x: s * Math.sqrt(3) * (q + r / 2) + c.offsetX,
      y: s * 1.5 * r + c.offsetY,
    };
  }

  cellOf(p: Point): Cell {
    const c = this.config;
    const x = p.x - c.offsetX;
    const y = p.y - c.offsetY;
    const s = this.size;
    if (c.orientation === "flat") {
      return axialRound(((2 / 3) * x) / s, ((-1 / 3) * x + (Math.sqrt(3) / 3) * y) / s);
    }
    return axialRound(((Math.sqrt(3) / 3) * x - (1 / 3) * y) / s, ((2 / 3) * y) / s);
  }

  snap(p: Point): Point {
    return this.cellCenter(this.cellOf(p));
  }

  cellDistance(a: Cell, b: Cell): number {
    const dq = a[0] - b[0];
    const dr = a[1] - b[1];
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
  }

  distance(a: Point, b: Point): number {
    return this.cellDistance(this.cellOf(a), this.cellOf(b));
  }

  distanceMeters(a: Point, b: Point): number {
    return this.distance(a, b) * this.config.metersPerCell;
  }

  cellsBetween(a: Point, b: Point): Cell[] {
    const ca = this.cellOf(a);
    const cb = this.cellOf(b);
    const n = this.cellDistance(ca, cb);
    if (n === 0) return [ca];
    const results: Cell[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const cell = axialRound(ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t);
      const last = results[results.length - 1];
      if (!last || last[0] !== cell[0] || last[1] !== cell[1]) results.push(cell);
    }
    return results;
  }

  /** Vértices del hex en px absolutos (para render). */
  cellCorners(cell: Cell): Point[] {
    const center = this.cellCenter(cell);
    const s = this.size;
    const startAngle = this.config.orientation === "flat" ? 0 : 30;
    const corners: Point[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = ((startAngle + 60 * i) * Math.PI) / 180;
      corners.push({
        x: center.x + s * Math.cos(angle),
        y: center.y + s * Math.sin(angle),
      });
    }
    return corners;
  }
}
