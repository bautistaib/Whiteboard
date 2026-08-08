/**
 * Tinta de ancho variable: convierte muestras de presión (stylus real o
 * velocidad simulada con mouse) en un ancho ABSOLUTO por punto del trazo.
 * Funciones puras, sin dependencias.
 */

/**
 * Ancho por punto: baseWidth * (0.35 + 0.65 * p), con p clampeado a [0,1].
 * Devuelve un array de largo points.length/2 (un ancho por par x,y).
 */
export function strokeWidths(points: number[], baseWidth: number, pressures: number[]): number[] {
  const n = points.length / 2;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const p = Math.min(1, Math.max(0, pressures[i] ?? 0.5));
    out[i] = baseWidth * (0.35 + 0.65 * p);
  }
  return out;
}

/**
 * Suavizado EMA (alpha ~0.4) de las muestras de presión para que el ancho
 * no tiemble con el ruido del sensor/velocidad.
 */
export function smoothPressure(samples: number[]): number[] {
  if (samples.length === 0) return [];
  const alpha = 0.4;
  const out = new Array<number>(samples.length);
  out[0] = samples[0];
  for (let i = 1; i < samples.length; i++) {
    out[i] = alpha * samples[i] + (1 - alpha) * out[i - 1];
  }
  return out;
}
