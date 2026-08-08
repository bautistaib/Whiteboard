import { useEffect, useRef } from "react";
import Konva from "konva";
import { Arrow, Circle, Ellipse, Group, Label, Layer, Line, Rect, Tag, Text, Wedge } from "react-konva";
import { gridFromConfig } from "../grid";
import { useStore, type PingInfo, type Tool } from "../store";

export interface Preview {
  tool: Tool;
  start: { x: number; y: number };
  current: { x: number; y: number };
  points?: number[];
}

/** Capa overlay (no persiste): preview de dibujo, selección, medición, cursores, pings. */
export default function OverlayLayer({
  preview,
  selectionRect,
}: {
  preview: Preview | null;
  selectionRect: { x: number; y: number; w: number; h: number } | null;
}) {
  const cursors = useStore((s) => s.cursors);
  const clientId = useStore((s) => s.clientId);
  const pings = useStore((s) => s.pings);
  const measure = useStore((s) => s.measure);
  const gridConfig = useStore((s) => s.grid);
  const drawColor = useStore((s) => s.drawColor);
  const drawWidth = useStore((s) => s.drawWidth);

  const grid = gridFromConfig(gridConfig);

  return (
    <Layer listening={false}>
      {/* preview de dibujo en curso */}
      {preview?.tool === "pencil" && preview.points && (
        <Line
          points={preview.points}
          stroke={drawColor}
          strokeWidth={drawWidth}
          lineCap="round"
          lineJoin="round"
          tension={0.4}
        />
      )}
      {preview && (preview.tool === "rect" || preview.tool === "circle") && (
        <>
          {preview.tool === "rect" ? (
            <Rect
              x={Math.min(preview.start.x, preview.current.x)}
              y={Math.min(preview.start.y, preview.current.y)}
              width={Math.abs(preview.current.x - preview.start.x)}
              height={Math.abs(preview.current.y - preview.start.y)}
              stroke={drawColor}
              strokeWidth={drawWidth}
            />
          ) : (
            <Ellipse
              x={(preview.start.x + preview.current.x) / 2}
              y={(preview.start.y + preview.current.y) / 2}
              radiusX={Math.abs(preview.current.x - preview.start.x) / 2}
              radiusY={Math.abs(preview.current.y - preview.start.y) / 2}
              stroke={drawColor}
              strokeWidth={drawWidth}
            />
          )}
        </>
      )}
      {preview && (preview.tool === "line" || preview.tool === "arrow") && (
        <Arrow
          points={[preview.start.x, preview.start.y, preview.current.x, preview.current.y]}
          stroke={drawColor}
          fill={drawColor}
          strokeWidth={drawWidth}
          pointerLength={preview.tool === "arrow" ? 12 : 0}
          pointerWidth={preview.tool === "arrow" ? 10 : 0}
        />
      )}
      {preview && preview.tool.startsWith("aoe-") && (
        <AoEPreview preview={preview} cellSize={gridConfig.cellSize} color={drawColor} />
      )}

      {/* rectángulo de multi-selección */}
      {selectionRect && (
        <Rect
          x={selectionRect.x}
          y={selectionRect.y}
          width={selectionRect.w}
          height={selectionRect.h}
          stroke="#4fc3f7"
          strokeWidth={1}
          dash={[4, 4]}
          fill="rgba(79,195,247,0.08)"
        />
      )}

      {/* herramienta de medición */}
      {measure && (
        <Group>
          <Line
            points={[measure.ax, measure.ay, measure.bx, measure.by]}
            stroke="#ffeb3b"
            strokeWidth={2}
            dash={[8, 4]}
          />
          <Label x={measure.bx + 8} y={measure.by - 8}>
            <Tag fill="#000" opacity={0.8} cornerRadius={4} />
            <Text
              text={`${grid.distance({ x: measure.ax, y: measure.ay }, { x: measure.bx, y: measure.by })} celdas · ${grid
                .distanceMeters({ x: measure.ax, y: measure.ay }, { x: measure.bx, y: measure.by })
                .toFixed(1)} m`}
              fontSize={14}
              fill="#ffeb3b"
              padding={6}
            />
          </Label>
        </Group>
      )}

      {/* cursores de los demás */}
      {Object.entries(cursors)
        .filter(([id]) => id !== clientId)
        .map(([id, c]) => (
          <Group key={id} x={c.x} y={c.y}>
            <Line points={[0, 0, 0, 16, 5, 12, 12, 12]} closed fill="#4fc3f7" stroke="#000" strokeWidth={0.5} />
            <Text text={c.name} x={14} y={12} fontSize={12} fill="#fff" shadowColor="#000" shadowBlur={2} />
          </Group>
        ))}

      {/* pings efímeros (~3 s) */}
      {pings.map((p) => (
        <Ping key={p.id} ping={p} />
      ))}
    </Layer>
  );
}

function AoEPreview({
  preview,
  cellSize,
  color,
}: {
  preview: Preview;
  cellSize: number;
  color: string;
}) {
  const dx = preview.current.x - preview.start.x;
  const dy = preview.current.y - preview.start.y;
  const distPx = Math.hypot(dx, dy);
  const cells = Math.max(1, Math.round(distPx / cellSize));
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const aoeAngle = useStore((s) => s.aoeAngle);
  const lineWidth = useStore((s) => s.drawWidth);

  return (
    <Group x={preview.start.x} y={preview.start.y} opacity={0.4}>
      {preview.tool === "aoe-circle" && (
        <Circle radius={cells * cellSize} fill={color} stroke={color} strokeWidth={2} />
      )}
      {preview.tool === "aoe-cone" && (
        <Wedge
          radius={cells * cellSize}
          angle={aoeAngle}
          rotation={angle - aoeAngle / 2}
          fill={color}
          stroke={color}
          strokeWidth={2}
        />
      )}
      {preview.tool === "aoe-line" && (
        <Rect
          width={cells * cellSize}
          height={lineWidth}
          y={-lineWidth / 2}
          rotation={angle}
          fill={color}
          stroke={color}
          strokeWidth={2}
        />
      )}
      <Label x={preview.current.x - preview.start.x + 8} y={preview.current.y - preview.start.y - 8}>
        <Tag fill="#000" opacity={0.8} cornerRadius={4} />
        <Text text={`${cells} ${cells === 1 ? "celda" : "celdas"}`} fontSize={14} fill="#ffeb3b" padding={6} />
      </Label>
    </Group>
  );
}

function Ping({ ping }: { ping: PingInfo }) {
  const circleRef = useRef<Konva.Circle>(null);
  const start = useRef(performance.now());

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = (performance.now() - start.current) / 3000;
      const node = circleRef.current;
      if (node) {
        if (t >= 1) {
          node.visible(false);
          return;
        }
        node.radius(10 + t * 50);
        node.opacity(1 - t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <Group x={ping.x} y={ping.y}>
      <Circle ref={circleRef} radius={10} stroke="#ff5252" strokeWidth={3} />
      <Text text={ping.name} x={14} y={-8} fontSize={13} fill="#ff5252" shadowColor="#000" shadowBlur={2} />
    </Group>
  );
}
