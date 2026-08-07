/** GridSystem del cliente: interfaz idéntica a server/app/grid.py. */

export interface BackgroundTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export interface GridConfig {
  type: "square" | "hex";
  orientation: "flat" | "pointy";
  cellSize: number;
  offsetX: number;
  offsetY: number;
  color: string;
  opacity: number;
  enabled: boolean;
  snap: boolean;
  metersPerCell: number;
  playersMoveAny: boolean;
  backgroundColor: string | null;
  backgroundTransform: BackgroundTransform | null;
}

export const defaultBackgroundTransform = (): BackgroundTransform => ({
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
});

export const defaultGridConfig = (): GridConfig => ({
  type: "square",
  orientation: "flat",
  cellSize: 64,
  offsetX: 0,
  offsetY: 0,
  color: "#ffffff",
  opacity: 0.4,
  enabled: true,
  snap: true,
  metersPerCell: 1.5,
  playersMoveAny: true,
  backgroundColor: null,
  backgroundTransform: null,
});

export interface Point {
  x: number;
  y: number;
}

/** (col,row) en cuadrada; (q,r) axial en hex */
export type Cell = [number, number];

export interface GridSystem {
  readonly config: GridConfig;
  cellOf(p: Point): Cell;
  cellCenter(cell: Cell): Point;
  snap(p: Point): Point;
  cellDistance(a: Cell, b: Cell): number;
  distance(a: Point, b: Point): number;
  distanceMeters(a: Point, b: Point): number;
  cellsBetween(a: Point, b: Point): Cell[];
}

export function normalizeGridConfig(data: Partial<GridConfig> | null | undefined): GridConfig {
  const base = defaultGridConfig();
  const merged = { ...base, ...(data ?? {}) } as GridConfig;
  // asegurar transform válido
  if (!merged.backgroundTransform) {
    merged.backgroundTransform = defaultBackgroundTransform();
  }
  return merged;
}
