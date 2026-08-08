import { useMemo } from "react";
import { Layer, Shape } from "react-konva";
import { gridFromConfig, HexGrid } from "../grid";
import { useStore } from "../store";
import { registerNode } from "./nodeRegistry";

/** Grilla: dibuja solo el viewport visible. No escucha eventos (perf). */
export default function GridLayer({ width, height }: { width: number; height: number }) {
  const gridConfig = useStore((s) => s.grid);
  const camera = useStore((s) => s.camera);
  const grid = useMemo(() => gridFromConfig(gridConfig), [gridConfig]);

  if (!gridConfig.enabled) return <Layer listening={false} />;

  // viewport en coords de mundo
  const x0 = -camera.x / camera.scale;
  const y0 = -camera.y / camera.scale;
  const x1 = x0 + width / camera.scale;
  const y1 = y0 + height / camera.scale;

  return (
    // registrada como "grid": el balde de pintura la oculta al capturar el canvas
    <Layer listening={false} ref={(n) => registerNode("grid", n)}>
      <Shape
        // strokeShape usa el stroke DEL SHAPE (no del contexto): configurarlo acá
        stroke={gridConfig.color}
        strokeWidth={1 / camera.scale}
        opacity={gridConfig.opacity}
        sceneFunc={(ctx, shape) => {
          ctx.beginPath();
          if (gridConfig.type === "square") {
            const c = gridConfig.cellSize;
            const startX = gridConfig.offsetX + Math.floor((x0 - gridConfig.offsetX) / c) * c;
            for (let x = startX; x <= x1; x += c) {
              ctx.moveTo(x, y0);
              ctx.lineTo(x, y1);
            }
            const startY = gridConfig.offsetY + Math.floor((y0 - gridConfig.offsetY) / c) * c;
            for (let y = startY; y <= y1; y += c) {
              ctx.moveTo(x0, y);
              ctx.lineTo(x1, y);
            }
          } else {
            const hex = grid as HexGrid;
            // rango de celdas que cubre el viewport (con margen)
            const approxCols = Math.ceil((x1 - x0) / gridConfig.cellSize) + 4;
            const approxRows = Math.ceil((y1 - y0) / gridConfig.cellSize) + 4;
            const centerCell = hex.cellOf({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
            const seen = new Set<string>();
            for (let dq = -approxCols; dq <= approxCols; dq++) {
              for (let dr = -approxRows; dr <= approxRows; dr++) {
                const cell: [number, number] = [centerCell[0] + dq, centerCell[1] + dr];
                const center = hex.cellCenter(cell);
                if (
                  center.x < x0 - gridConfig.cellSize ||
                  center.x > x1 + gridConfig.cellSize ||
                  center.y < y0 - gridConfig.cellSize ||
                  center.y > y1 + gridConfig.cellSize
                ) {
                  continue;
                }
                const key = `${cell[0]},${cell[1]}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const corners = hex.cellCorners(cell);
                ctx.moveTo(corners[0].x, corners[0].y);
                for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
                ctx.closePath();
              }
            }
          }
          ctx.strokeShape(shape);
        }}
      />
    </Layer>
  );
}
