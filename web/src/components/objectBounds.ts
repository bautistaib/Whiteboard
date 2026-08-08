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
    return {
      minX: x - half * (d.scaleX ?? 1),
      minY: y - half * (d.scaleY ?? 1),
      maxX: x + half * (d.scaleX ?? 1),
      maxY: y + half * (d.scaleY ?? 1),
    };
  }
  // scaleX/scaleY del nodo (resize libre)
  const sx = d.scaleX ?? 1;
  const sy = d.scaleY ?? 1;
  if (o.type === "path") {
    const pts: number[] = d.points ?? [];
    // OJO: no sembrar con (x,y) — los trazos guardan x,y en (0,0) con puntos
    // absolutos; sembrar con (0,0) hace que la caja siempre vuelva al origen.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const px = x + pts[i] * sx;
      const py = y + pts[i + 1] * sy;
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
    if (!Number.isFinite(minX)) return { minX: x, minY: y, maxX: x, maxY: y };
    return { minX, minY, maxX, maxY };
  }
  if (o.type === "shape") {
    if (d.shape === "rect") {
      const w = (d.w ?? 0) * sx;
      const h = (d.h ?? 0) * sy;
      return {
        minX: Math.min(x, x + w),
        minY: Math.min(y, y + h),
        maxX: Math.max(x, x + w),
        maxY: Math.max(y, y + h),
      };
    }
    if (d.shape === "circle") {
      const rx = (Math.abs(d.w ?? 0) / 2) * sx;
      const ry = (Math.abs(d.h ?? 0) / 2) * sy;
      return { minX: x - rx, minY: y - ry, maxX: x + rx, maxY: y + ry };
    }
    // line / arrow: bbox de los dos extremos
    const pts: number[] = d.points ?? [0, 0, 0, 0];
    const ex = (pts[2] ?? 0) * sx;
    const ey = (pts[3] ?? 0) * sy;
    return {
      minX: Math.min(x, x + ex),
      minY: Math.min(y, y + ey),
      maxX: Math.max(x, x + ex),
      maxY: Math.max(y, y + ey),
    };
  }
  if (o.type === "group") {
    // union de bounds de las parts, trasladadas al origen del grupo
    const parts: { type: string; data: Record<string, any> }[] = d.parts ?? [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of parts) {
      const fake: SceneObj = {
        id: "", type: p.type, z: 0, owner: "",
        data: { ...p.data, x: (p.data.x ?? 0) + x, y: (p.data.y ?? 0) + y },
      };
      const b = objectBounds(fake, cellSize);
      minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
    }
    if (!Number.isFinite(minX)) return { minX: x, minY: y, maxX: x, maxY: y };
    return { minX, minY, maxX, maxY };
  }
  if (o.type === "aoe") {
    const r = (d.size_cells ?? 1) * cellSize;
    return { minX: x - r * sx, minY: y - r * sy, maxX: x + r * sx, maxY: y + r * sy };
  }
  // text (y fallback): caja aproximada desde el origen
  const s = (d.fontSize ?? 22) * sy;
  return { minX: x, minY: y, maxX: x + s * 3 * sx, maxY: y + s };
}
