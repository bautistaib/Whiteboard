import { useEffect, useRef, useState } from "react";
import { saveSettings } from "../api";
import { useStore } from "../store";
import { wsClient } from "../ws";
import type { GridConfig } from "../grid";

/** Panel de grilla y calibración (solo DM): sliders con preview en vivo. */
export default function CalibrationPanel({ onClose }: { onClose: () => void }) {
  const grid = useStore((s) => s.grid);
  const token = useStore((s) => s.token);
  const backgroundUnlocked = useStore((s) => s.backgroundUnlocked);
  const setBackgroundUnlocked = useStore((s) => s.setBackgroundUnlocked);
  const timer = useRef<number | null>(null);
  const [saved, setSaved] = useState(false);

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
      <div className="panel-sep" />
      <label>
        <input
          type="checkbox"
          checked={backgroundUnlocked}
          onChange={(e) => setBackgroundUnlocked(e.target.checked)}
        />
        Editar fondo (mover/rotar/escalar)
      </label>
      <label>
        Color de fondo
        <input
          type="color"
          value={grid.backgroundColor ?? "#16181d"}
          onChange={(e) => send({ backgroundColor: e.target.value })}
        />
      </label>
      <button
        className="full"
        onClick={async () => {
          try {
            await saveSettings(grid);
            setSaved(true);
            setTimeout(() => setSaved(false), 1500);
          } catch {
            /* ignore */
          }
        }}
      >
        {saved ? "¡Guardado!" : "Guardar como predeterminado"}
      </button>
      <p className="muted small">
        Las nuevas campañas y escenas arrancan con esta config.
      </p>
    </div>
  );
}
