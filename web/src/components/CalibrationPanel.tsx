import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { wsClient } from "../ws";
import type { GridConfig } from "../grid";

/** Panel de grilla y calibración (solo DM): sliders con preview en vivo. */
export default function CalibrationPanel({ onClose }: { onClose: () => void }) {
  const grid = useStore((s) => s.grid);
  const timer = useRef<number | null>(null);

  // debounce: preview local inmediato (vía scene.update del server) + envío
  const send = (patch: Partial<GridConfig>) => {
    const next = { ...grid, ...patch };
    useStore.setState({ grid: next });
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      wsClient.send("scene.setGrid", { grid: next });
    }, 250);
  };
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  return (
    <div className="calibration-panel">
      <div className="panel-header">
        <strong>Grilla</strong>
        <button onClick={onClose}>✕</button>
      </div>
      <label>
        Tipo
        <select
          value={grid.type === "hex" ? `hex-${grid.orientation}` : "square"}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "square") send({ type: "square" });
            else send({ type: "hex", orientation: v === "hex-flat" ? "flat" : "pointy" });
          }}
        >
          <option value="square">Cuadrada</option>
          <option value="hex-flat">Hexagonal (flat-top)</option>
          <option value="hex-pointy">Hexagonal (pointy-top)</option>
        </select>
      </label>
      <label>
        <input type="checkbox" checked={grid.enabled} onChange={(e) => send({ enabled: e.target.checked })} />
        Visible
      </label>
      <label>
        <input type="checkbox" checked={grid.snap} onChange={(e) => send({ snap: e.target.checked })} />
        Snap-to-grid
      </label>
      <label>
        <input
          type="checkbox"
          checked={grid.playersMoveAny}
          onChange={(e) => send({ playersMoveAny: e.target.checked })}
        />
        Jugadores mueven cualquier token
      </label>
      <label>
        Tamaño de celda: {Math.round(grid.cellSize)} px
        <input
          type="range"
          min={16}
          max={400}
          value={grid.cellSize}
          onChange={(e) => send({ cellSize: Number(e.target.value) })}
        />
      </label>
      <label>
        Offset X: {Math.round(grid.offsetX)} px
        <input
          type="range"
          min={-400}
          max={400}
          value={grid.offsetX}
          onChange={(e) => send({ offsetX: Number(e.target.value) })}
        />
      </label>
      <label>
        Offset Y: {Math.round(grid.offsetY)} px
        <input
          type="range"
          min={-400}
          max={400}
          value={grid.offsetY}
          onChange={(e) => send({ offsetY: Number(e.target.value) })}
        />
      </label>
      <label>
        Opacidad: {Math.round(grid.opacity * 100)}%
        <input
          type="range"
          min={0}
          max={100}
          value={grid.opacity * 100}
          onChange={(e) => send({ opacity: Number(e.target.value) / 100 })}
        />
      </label>
      <label>
        Color
        <input type="color" value={grid.color} onChange={(e) => send({ color: e.target.value })} />
      </label>
      <label>
        Metros por celda
        <input
          type="number"
          step={0.5}
          min={0.1}
          value={grid.metersPerCell}
          onChange={(e) => send({ metersPerCell: Number(e.target.value) || 1.5 })}
        />
      </label>
    </div>
  );
}
