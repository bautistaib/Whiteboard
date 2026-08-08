import type Konva from "konva";
import { useState } from "react";
import { useStore, type Tool } from "../store";
import { wsClient } from "../ws";
import CalibrationPanel from "./CalibrationPanel";
import { getNode } from "./nodeRegistry";
import ToolOptionsPanel from "./ToolOptionsPanel";

const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: "select", label: "Seleccionar / mover", icon: "⬚" },
  { id: "pan", label: "Mover cámara", icon: "✋" },
  { id: "pencil", label: "Lápiz", icon: "✏️" },
  { id: "rect", label: "Rectángulo", icon: "▭" },
  { id: "circle", label: "Círculo", icon: "◯" },
  { id: "line", label: "Línea", icon: "╱" },
  { id: "arrow", label: "Flecha", icon: "➶" },
  { id: "text", label: "Texto", icon: "T" },
  { id: "eraser", label: "Borrador", icon: "🧽" },
  { id: "measure", label: "Medir distancia", icon: "📏" },
  { id: "aoe-circle", label: "AoE: círculo", icon: "◎" },
  { id: "aoe-cone", label: "AoE: cono", icon: "◣" },
  { id: "aoe-line", label: "AoE: línea", icon: "━" },
];

export default function Toolbar() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const role = useStore((s) => s.role);
  const followDm = useStore((s) => s.followDm);
  const setFollowDm = useStore((s) => s.setFollowDm);
  const toolOptionsOpen = useStore((s) => s.toolOptionsOpen);
  const setToolOptionsOpen = useStore((s) => s.setToolOptionsOpen);
  const [showGrid, setShowGrid] = useState(false);

  const hasOptions = TOOLS.some((t) => t.id === tool);

  return (
    <div className="toolbar">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          title={t.label}
          className={`tool ${tool === t.id ? "active" : ""}`}
          onClick={() => setTool(t.id)}
        >
          {t.icon}
        </button>
      ))}
      <div className="tool-sep" />
      {hasOptions && !toolOptionsOpen && (
        <button
          className="tool"
          title="Mostrar opciones de color y grosor"
          onClick={() => setToolOptionsOpen(true)}
        >
          ⚙
        </button>
      )}
      <div className="tool-sep" />
      <button className="tool" title="Deshacer (Ctrl+Z)" onClick={() => wsClient.send("undo")}>
        ↩
      </button>
      <button className="tool" title="Rehacer (Ctrl+Shift+Z)" onClick={() => wsClient.send("redo")}>
        ↪
      </button>
      <button
        className="tool"
        title="Exportar lo visible como imagen PNG (para el recap en Discord)"
        onClick={exportVisiblePng}
      >
        📷
      </button>
      <div className="tool-sep" />
      {role === "dm" && (
        <button
          className={`tool ${showGrid ? "active" : ""}`}
          title="Grilla y calibración"
          onClick={() => setShowGrid(!showGrid)}
        >
          #
        </button>
      )}
      {role === "player" && (
        <button
          className={`tool ${followDm ? "active" : ""}`}
          title="Seguir al DM (se apaga si movés la cámara)"
          onClick={() => setFollowDm(!followDm)}
        >
          👁
        </button>
      )}
      {showGrid && role === "dm" && <CalibrationPanel onClose={() => setShowGrid(false)} />}
      <ToolOptionsPanel />
    </div>
  );
}

/** Descarga un PNG de lo que se ve en pantalla, con el fondo compuesto. */
function exportVisiblePng() {
  const stage = getNode("stage") as Konva.Stage | undefined;
  if (!stage) return;
  const shot = stage.toCanvas({ pixelRatio: 2 });
  const out = document.createElement("canvas");
  out.width = shot.width;
  out.height = shot.height;
  const ctx = out.getContext("2d");
  if (!ctx) return;
  const st = useStore.getState();
  ctx.fillStyle = st.grid.backgroundColor ?? "#16181d";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(shot, 0, 0);
  out.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${st.sceneName || "escena"}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, "image/png");
}
