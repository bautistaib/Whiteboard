/**
 * Balde de pintura: flood fill sobre el canvas compuesto del stage y
 * conversión de la máscara resultante a un PNG recortado (para subirlo
 * como asset y colocarlo como objeto "image").
 */

/**
 * Flood fill (scanline con cola) desde el píxel (sx,sy) sobre img.data.
 * Un píxel matchea si la diferencia por canal (RGBA incluido) contra el
 * color semilla es ≤ tolerancia (0–100 mapeado a 0–255: tolerance * 2.55).
 * Devuelve la máscara (1 = rellenado) o null si la semilla es inválida.
 */
export function floodFillMask(
  img: ImageData,
  sx: number,
  sy: number,
  tolerance: number,
): Uint8Array | null {
  const w = img.width;
  const h = img.height;
  const data = img.data;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  const tol = tolerance * 2.55;
  const seed = (sy * w + sx) * 4;
  const sr = data[seed];
  const sg = data[seed + 1];
  const sb = data[seed + 2];
  const sa = data[seed + 3];
  const matches = (px: number): boolean => {
    const i = px * 4;
    return (
      Math.abs(data[i] - sr) <= tol &&
      Math.abs(data[i + 1] - sg) <= tol &&
      Math.abs(data[i + 2] - sb) <= tol &&
      Math.abs(data[i + 3] - sa) <= tol
    );
  };

  const mask = new Uint8Array(w * h);
  const stack: number[] = [sy * w + sx];
  while (stack.length > 0) {
    const px = stack.pop()!;
    if (mask[px] || !matches(px)) continue;
    // expandir el span horizontal que contiene a px
    const y = Math.floor(px / w);
    let x0 = px % w;
    let x1 = x0;
    while (x0 > 0 && !mask[y * w + x0 - 1] && matches(y * w + x0 - 1)) x0--;
    while (x1 < w - 1 && !mask[y * w + x1 + 1] && matches(y * w + x1 + 1)) x1++;
    for (let x = x0; x <= x1; x++) {
      mask[y * w + x] = 1;
      if (y > 0) stack.push((y - 1) * w + x);
      if (y < h - 1) stack.push((y + 1) * w + x);
    }
  }
  return mask;
}

export interface FillPng {
  blob: Blob;
  /** esquina superior izquierda del bbox, en píxeles del canvas original */
  offsetX: number;
  offsetY: number;
  /** tamaño del bbox (= tamaño del PNG) */
  width: number;
  height: number;
  /** cantidad de píxeles rellenados (para filtrar misclicks) */
  count: number;
}

/**
 * Convierte la máscara en un PNG recortado a su bounding box: los píxeles
 * de la máscara reciben colorHex con alfa = opacity*255, el resto queda
 * transparente. Devuelve null si la máscara está vacía o falla el encode.
 */
export async function maskToPngBlob(
  mask: Uint8Array,
  w: number,
  h: number,
  colorHex: string,
  opacity: number,
): Promise<FillPng | null> {
  // bounding box + conteo en una sola pasada
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (count === 0) return null;

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const r = parseInt(colorHex.slice(1, 3), 16);
  const g = parseInt(colorHex.slice(3, 5), 16);
  const b = parseInt(colorHex.slice(5, 7), 16);
  const a = Math.round(Math.min(1, Math.max(0, opacity)) * 255);

  const out = new ImageData(bw, bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      if (!mask[(minY + y) * w + (minX + x)]) continue;
      const i = (y * bw + x) * 4;
      out.data[i] = r;
      out.data[i + 1] = g;
      out.data[i + 2] = b;
      out.data[i + 3] = a;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = bw;
  canvas.height = bh;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(out, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return null;
  return { blob, offsetX: minX, offsetY: minY, width: bw, height: bh, count };
}
