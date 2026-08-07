import { useStore, type Tool } from "../store";

/** Herramientas que tienen opciones de color/grosor. */
const TOOLS_WITH_OPTIONS: Tool[] = [
  "pencil",
  "rect",
  "circle",
  "line",
  "arrow",
  "text",
  "eraser",
  "aoe-circle",
  "aoe-cone",
  "aoe-line",
];

const COLOR_SWATCHES = [
  "#ff5252",
  "#ff9800",
  "#ffeb3b",
  "#69db7c",
  "#4fc3f7",
  "#b197fc",
  "#f783ac",
  "#ffffff",
  "#8b949e",
  "#000000",
];

const WIDTH_PRESETS = [2, 4, 8, 16];

/** Panel contextual de opciones: aparece al elegir una herramienta de dibujo. */
export default function ToolOptionsPanel() {
  const tool = useStore((s) => s.tool);
  const drawColor = useStore((s) => s.drawColor);
  const setDrawColor = useStore((s) => s.setDrawColor);
  const drawWidth = useStore((s) => s.drawWidth);
  const setDrawWidth = useStore((s) => s.setDrawWidth);

  if (!TOOLS_WITH_OPTIONS.includes(tool)) return null;

  return (
    <div className="tool-options">
      <div className="swatches">
        {COLOR_SWATCHES.map((c) => (
          <button
            key={c}
            className={`swatch ${drawColor === c ? "active" : ""}`}
            style={{ background: c }}
            title={c}
            onClick={() => setDrawColor(c)}
          />
        ))}
        <input
          type="color"
          className="swatch custom"
          value={drawColor}
          title="Color personalizado"
          onChange={(e) => setDrawColor(e.target.value)}
        />
      </div>
      <div className="width-presets">
        {WIDTH_PRESETS.map((w) => (
          <button
            key={w}
            className={`width-preset ${drawWidth === w ? "active" : ""}`}
            title={`Grosor ${w}`}
            onClick={() => setDrawWidth(w)}
          >
            <span style={{ height: Math.max(2, w / 2), borderRadius: w / 4 }} />
          </button>
        ))}
      </div>
    </div>
  );
}
