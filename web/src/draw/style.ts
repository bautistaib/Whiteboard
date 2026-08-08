/** Helpers de estilo compartidos para el render de trazos (Konva y previews SVG). */

/** Convierte "#rrggbb" + alpha (0–1, se clampa) a "rgba(r,g,b,a)". */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.min(1, Math.max(0, alpha));
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/** Patrón de trazo punteado de Konva escalado por el grosor del trazo. */
export function dashPattern(width: number): number[] {
  return [width * 3, width * 2];
}
