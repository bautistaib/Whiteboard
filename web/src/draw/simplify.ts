/**
 * Simplificación de trazos libres. Opera sobre arrays planos de puntos:
 * [x0, y0, x1, y1, ...]. (El adelgazado por distancia mínima se hace en
 * streaming durante la captura, en Board.tsx.)
 */

/** Distancia de un punto al segmento (a → b), en coords planas. */
function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  // proyección del punto sobre el segmento, clamp a [0,1]
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Ramer–Douglas–Peucker sobre la polilínea: conserva primero/último y los
 * puntos que se desvían más de `epsilon` del segmento simplificado.
 */
export function simplifyRdp(points: number[], epsilon: number): number[] {
  const n = points.length / 2;
  if (n <= 2) return points;
  const keep = new Array<boolean>(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const ax = points[2 * a];
    const ay = points[2 * a + 1];
    const bx = points[2 * b];
    const by = points[2 * b + 1];
    // punto intermedio más alejado del segmento a–b
    let maxD = -1;
    let maxI = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(points[2 * i], points[2 * i + 1], ax, ay, bx, by);
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > epsilon) {
      keep[maxI] = true;
      stack.push([a, maxI], [maxI, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push(points[2 * i], points[2 * i + 1]);
  }
  return out;
}
