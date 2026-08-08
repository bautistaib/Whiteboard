import type { SceneObj } from "../store";

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Bounding box aproximada de un objeto (para la selección por rectángulo y
 * el halo de selección). Ignora rotación — para esos usos alcanza. Clave
 * para los trazos del lápiz: guardan x,y en (0,0) con puntos absolutos,
 * así que hay que mirar los puntos.
 */
export function objectBounds(o: SceneObj, cellSize: number): Bounds {
  const d = o.data;
  const x = d.x ?? 0;
  const y = d.y ?? 0;
  if (o.type === "token") {
    const half = ((d.size_cells ?? 1) * cellSize) / 2;
    return { minX: x - half, minY: y - half, maxX: x + half, maxY: y + half };
  }
  if (o.type === "path") {
    const pts: number[] = d.points ?? [];
    const b: Bounds = { minX: x, minY: y, maxX: x, maxY: y };
    for (let i = 0; i + 1 < pts.length; i += 2) {
      b.minX = Math.min(b.minX, x + pts[i]);
      b.maxX = Math.max(b.maxX, x + pts[i]);
      b.minY = Math.min(b.minY, y + pts[i + 1]);
      b.maxY = Math.max(b.maxY, y + pts[i + 1]);
    }
    return b;
  }
  if (o.type === "shape") {
    if (d.shape === "rect") {
      return {
        minX: Math.min(x, x + (d.w ?? 0)),
        minY: Math.min(y, y + (d.h ?? 0)),
        maxX: Math.max(x, x + (d.w ?? 0)),
        maxY: Math.max(y, y + (d.h ?? 0)),
      };
    }
    if (d.shape === "circle") {
      const rx = Math.abs(d.w ?? 0) / 2;
      const ry = Math.abs(d.h ?? 0) / 2;
      return { minX: x - rx, minY: y - ry, maxX: x + rx, maxY: y + ry };
    }
    // line / arrow: bbox de los dos extremos
    const pts: number[] = d.points ?? [0, 0, 0, 0];
    return {
      minX: Math.min(x, x + (pts[2] ?? 0)),
      minY: Math.min(y, y + (pts[3] ?? 0)),
      maxX: Math.max(x, x + (pts[2] ?? 0)),
      maxY: Math.max(y, y + (pts[3] ?? 0)),
    };
  }
  if (o.type === "aoe") {
    const r = (d.size_cells ?? 1) * cellSize;
    return { minX: x - r, minY: y - r, maxX: x + r, maxY: y + r };
  }
  // text (y fallback): caja aproximada desde el origen
  const s = d.fontSize ?? 22;
  return { minX: x, minY: y, maxX: x + s * 3, maxY: y + s };
}
