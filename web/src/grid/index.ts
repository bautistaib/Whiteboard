import { HexGrid } from "./HexGrid";
import { SquareGrid } from "./SquareGrid";
import type { GridConfig, GridSystem } from "./types";

export function gridFromConfig(config: GridConfig): GridSystem {
  return config.type === "hex" ? new HexGrid(config) : new SquareGrid(config);
}

export * from "./types";
export { HexGrid } from "./HexGrid";
export { SquareGrid } from "./SquareGrid";
