import { useState } from "react";
import { useStore, type Tool } from "../store";
import { wsClient } from "../ws";
import CalibrationPanel from "./CalibrationPanel";
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
  const [showGrid, setShowGrid] = useState(false);

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
      <button className="tool" title="Deshacer (Ctrl+Z)" onClick={() => wsClient.send("undo")}>
        ↩
      </button>
      <button className="tool" title="Rehacer (Ctrl+Shift+Z)" onClick={() => wsClient.send("redo")}>
        ↪
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
