import { useState } from "react";
import { dashPattern } from "../draw/style";
import { lsGet, lsSet, useStore, type Tool } from "../store";

/** Herramientas que tienen opciones de color/grosor. */
export const TOOLS_WITH_OPTIONS: Tool[] = [
  "pencil",
  "marker",
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

const MARKER_WIDTH_PRESETS = [6, 14, 22, 30];

const ANGLE_PRESETS = [30, 45, 60, 90];

const MAX_PRESETS = 24;

/** Nombre visible de cada herramienta en el encabezado del panel. */
const TOOL_NAMES: Partial<Record<Tool, string>> = {
  pencil: "Lápiz",
  marker: "Resaltador",
  rect: "Rectángulo",
  circle: "Círculo",
  line: "Línea",
  arrow: "Flecha",
  text: "Texto",
  eraser: "Borrador",
  "aoe-circle": "AoE: círculo",
  "aoe-cone": "AoE: cono",
  "aoe-line": "AoE: línea",
};

/** Herramientas con preview de trazo (línea recta para line/arrow, curva para el resto). */
const PREVIEW_TOOLS: Tool[] = ["pencil", "marker", "rect", "circle", "line", "arrow"];

/** Presets de color guardados; fallback a los swatches por defecto. */
function loadPresets(): string[] {
  const raw = lsGet("ttrpg:colorPresets");
  if (raw) {
    try {
      const arr: unknown = JSON.parse(raw);
      if (
        Array.isArray(arr) &&
        arr.every((c) => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c as string))
      ) {
        return arr as string[];
      }
    } catch {
      // JSON inválido: se usan los defaults
    }
  }
  return COLOR_SWATCHES;
}

/** Panel contextual de opciones por herramienta: color, grosor, opacidad, trazo, relleno. */
export default function ToolOptionsPanel() {
  const tool = useStore((s) => s.tool);
  const open = useStore((s) => s.toolOptionsOpen);
  const setOpen = useStore((s) => s.setToolOptionsOpen);
  const drawColor = useStore((s) => s.drawColor);
  const setDrawColor = useStore((s) => s.setDrawColor);
  const drawWidth = useStore((s) => s.drawWidth);
  const setDrawWidth = useStore((s) => s.setDrawWidth);
  const drawOpacity = useStore((s) => s.drawOpacity);
  const setDrawOpacity = useStore((s) => s.setDrawOpacity);
  const drawLineStyle = useStore((s) => s.drawLineStyle);
  const setDrawLineStyle = useStore((s) => s.setDrawLineStyle);
  const shapeFill = useStore((s) => s.shapeFill);
  const setShapeFill = useStore((s) => s.setShapeFill);
  const eraserWidth = useStore((s) => s.eraserWidth);
  const setEraserWidth = useStore((s) => s.setEraserWidth);
  const markerColor = useStore((s) => s.markerColor);
  const setMarkerColor = useStore((s) => s.setMarkerColor);
  const markerWidth = useStore((s) => s.markerWidth);
  const setMarkerWidth = useStore((s) => s.setMarkerWidth);
  const markerOpacity = useStore((s) => s.markerOpacity);
  const setMarkerOpacity = useStore((s) => s.setMarkerOpacity);
  const aoeAngle = useStore((s) => s.aoeAngle);
  const setAoeAngle = useStore((s) => s.setAoeAngle);
  const [presets, setPresets] = useState<string[]>(loadPresets);

  const savePresets = (next: string[]) => {
    setPresets(next);
    lsSet("ttrpg:colorPresets", JSON.stringify(next));
  };

  const isMarker = tool === "marker";
  // color/grosor/opacidad activos: el resaltador usa sus propios valores
  const color = isMarker ? markerColor : drawColor;
  const setColor = isMarker ? setMarkerColor : setDrawColor;
  const width = isMarker ? markerWidth : drawWidth;
  const setWidth = isMarker ? setMarkerWidth : setDrawWidth;
  const opacity = isMarker ? markerOpacity : drawOpacity;
  const setOpacity = isMarker ? setMarkerOpacity : setDrawOpacity;
  const widthPresets = isMarker ? MARKER_WIDTH_PRESETS : WIDTH_PRESETS;

  const addPreset = () => {
    if (presets.includes(color)) return;
    // máximo 24: llena, el botón + se deshabilita (click derecho quita colores)
    if (presets.length >= MAX_PRESETS) return;
    savePresets([...presets, color]);
  };

  const removePreset = (c: string) => savePresets(presets.filter((p) => p !== c));

  if (!TOOLS_WITH_OPTIONS.includes(tool)) return null;
  if (!open) return null;

  const isEraser = tool === "eraser";
  const hasPreview = PREVIEW_TOOLS.includes(tool);
  const hasOpacity = hasPreview; // pencil, marker, rect, circle, line, arrow
  const hasLineStyle = hasPreview && !isMarker;
  const hasFill = tool === "rect" || tool === "circle";
  const hasColor = !isEraser;
  const straightPreview = tool === "line" || tool === "arrow";
  // grosor del preview capado para que entre en la tira de 28px
  const previewWidth = Math.max(1.5, Math.min(width, 16));

  return (
    <div className="tool-options">
      <div className="panel-header">
        <strong>{TOOL_NAMES[tool] ?? "Opciones"}</strong>
        <button title="Cerrar" onClick={() => setOpen(false)}>
          ✕
        </button>
      </div>
      {hasPreview && (
        <svg className="stroke-preview" viewBox="0 0 160 28" preserveAspectRatio="none">
          <path
            d={
              straightPreview
                ? "M6 14 H154"
                : "M6 18 C 26 4, 46 26, 66 14 S 106 4, 126 16 S 150 20, 154 12"
            }
            fill="none"
            stroke={color}
            strokeWidth={previewWidth}
            strokeOpacity={opacity}
            strokeDasharray={hasLineStyle && drawLineStyle === "dash" ? dashPattern(previewWidth).join(" ") : undefined}
            strokeLinecap="round"
          />
        </svg>
      )}
      {hasColor && (
        <>
          <div className="tool-options-label">Color</div>
          <div className="swatches">
            {presets.map((c) => (
              <button
                key={c}
                className={`swatch ${color === c ? "active" : ""}`}
                style={{ background: c }}
                title={`${c} — Click derecho para quitar`}
                onClick={() => setColor(c)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  removePreset(c);
                }}
              />
            ))}
            <button
              className="swatch add"
              title={
                presets.length >= MAX_PRESETS
                  ? "Lista llena — click derecho en un color para quitarlo"
                  : "Guardar color actual"
              }
              disabled={presets.length >= MAX_PRESETS}
              onClick={addPreset}
            >
              +
            </button>
            <input
              type="color"
              className="swatch custom"
              value={color}
              title="Color personalizado"
              onChange={(e) => setColor(e.target.value)}
            />
          </div>
        </>
      )}
      {isEraser ? (
        <>
          <div className="tool-options-label">Tamaño</div>
          <label className="width-row">
            <input
              type="range"
              min={2}
              max={64}
              value={eraserWidth}
              onChange={(e) => setEraserWidth(Number(e.target.value))}
            />
            <span className="muted small">{eraserWidth}</span>
          </label>
          <div className="tool-options-hint">
            Arrastrá sobre un trazo para borrarlo parcialmente.
          </div>
        </>
      ) : (
        <>
          <div className="tool-options-label">Grosor</div>
          <label className="width-row">
            <input
              type="range"
              min={isMarker ? 4 : 1}
              max={40}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
            />
            <span className="muted small">{width}</span>
          </label>
          <div className="width-presets">
            {widthPresets.map((w) => (
              <button
                key={w}
                className={`width-preset ${width === w ? "active" : ""}`}
                title={`Grosor ${w}`}
                onClick={() => setWidth(w)}
              >
                <span style={{ height: Math.max(2, w / 2), borderRadius: w / 4 }} />
              </button>
            ))}
          </div>
        </>
      )}
      {hasOpacity && (
        <>
          <div className="tool-options-label">Opacidad</div>
          <label className="width-row">
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
            />
            <span className="muted small">{Math.round(opacity * 100)}%</span>
          </label>
        </>
      )}
      {hasLineStyle && (
        <>
          <div className="tool-options-label">Trazo</div>
          <div className="style-toggles">
            <button
              className={`style-toggle ${drawLineStyle === "solid" ? "active" : ""}`}
              onClick={() => setDrawLineStyle("solid")}
            >
              Sólido
            </button>
            <button
              className={`style-toggle ${drawLineStyle === "dash" ? "active" : ""}`}
              onClick={() => setDrawLineStyle("dash")}
            >
              Punteado
            </button>
          </div>
        </>
      )}
      {hasFill && (
        <label className="fill-row">
          <input
            type="checkbox"
            checked={shapeFill}
            onChange={(e) => setShapeFill(e.target.checked)}
          />
          Relleno
        </label>
      )}
      {tool === "aoe-cone" && (
        <>
          <div className="tool-options-label">Ángulo</div>
          <label className="width-row">
            <input
              type="range"
              min={15}
              max={120}
              step={5}
              value={aoeAngle}
              onChange={(e) => setAoeAngle(Number(e.target.value))}
            />
            <span className="muted small">{aoeAngle}°</span>
          </label>
          <div className="width-presets">
            {ANGLE_PRESETS.map((a) => (
              <button
                key={a}
                className={`width-preset ${aoeAngle === a ? "active" : ""}`}
                title={`Ángulo ${a}°`}
                onClick={() => setAoeAngle(a)}
              >
                <span className="muted small">{a}°</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
