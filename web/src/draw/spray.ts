/**
 * Aerógrafo: siembra puntos aleatorios ("dots") a lo largo del segmento
 * barrido por el puntero. points = centros de los dots (plano x,y);
 * widths = radio de cada dot. Sin determinismo: Math.random alcanza.
 */

/** Techo de dots por trazo de spray (protege memoria/render). */
export const MAX_SPRAY_POINTS = 3000;

/**
 * Dots a lo largo del segmento (x0,y0)→(x1,y1). Densidad ~ un dot por cada
 * (radius/3)² de área barrida; cada dot cae uniforme dentro de un disco de
 * `radius` alrededor de un punto del segmento y tiene radio
 * radius * (0.15 + random * 0.25).
 */
export function sprayAlong(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
): { points: number[]; widths: number[] } {
  const points: number[] = [];
  const widths: number[] = [];
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len === 0 || radius <= 0) return { points, widths };
  // área barrida ≈ rectángulo largo × diámetro (las tapas se desprecian)
  const area = len * 2 * radius;
  const count = Math.min(MAX_SPRAY_POINTS, Math.round(area / ((radius / 3) ** 2)));
  for (let i = 0; i < count; i++) {
    const t = Math.random();
    const bx = x0 + (x1 - x0) * t;
    const by = y0 + (y1 - y0) * t;
    // desplazamiento uniforme dentro del disco (sqrt para densidad uniforme)
    const ang = Math.random() * Math.PI * 2;
    const rr = radius * Math.sqrt(Math.random());
    points.push(bx + rr * Math.cos(ang), by + rr * Math.sin(ang));
    widths.push(radius * (0.15 + Math.random() * 0.25));
  }
  return { points, widths };
}
