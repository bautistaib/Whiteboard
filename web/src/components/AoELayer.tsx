import { useRef } from "react";
import { Circle, Group, Layer, Rect, Wedge } from "react-konva";
import { sortedObjects, useStore, type SceneObj } from "../store";
import { useObjectHandlers } from "./DrawLayer";
import { registerNode } from "./nodeRegistry";

/** Plantillas de área de efecto: círculo, cono, línea. Semitransparentes. */
export default function AoELayer() {
  const objects = useStore((s) => s.objects);
  const cellSize = useStore((s) => s.grid.cellSize);
  const aoes = sortedObjects(objects).filter((o) => o.type === "aoe");
  // posiciones iniciales del grupo al arrastrar (multi-select group move)
  const groupStart = useRef<Record<string, { x: number; y: number }>>({});

  return (
    <Layer>
      {aoes.map((obj) => (
        <AoE key={obj.id} obj={obj} cellSize={cellSize} groupStart={groupStart} />
      ))}
    </Layer>
  );
}

function AoE({
  obj,
  cellSize,
  groupStart,
}: {
  obj: SceneObj;
  cellSize: number;
  groupStart: React.MutableRefObject<Record<string, { x: number; y: number }>>;
}) {
  const handlers = useObjectHandlers(obj, true, groupStart);
  const d = obj.data;
  const radius = (d.size_cells ?? 1) * cellSize;
  const color = d.color ?? "#ff9800";

  return (
    <Group
      x={d.x ?? 0}
      y={d.y ?? 0}
      rotation={d.rotation ?? 0}
      scaleX={d.scaleX ?? 1}
      scaleY={d.scaleY ?? 1}
      opacity={0.4}
      ref={(node) => registerNode(obj.id, node)}
      {...handlers}
    >
      {d.shape === "circle" && <Circle radius={radius} fill={color} stroke={color} strokeWidth={2} />}
      {d.shape === "cone" && (
        <Wedge radius={radius} angle={60} fill={color} stroke={color} strokeWidth={2} rotation={-30} />
      )}
      {d.shape === "line" && (
        <Rect width={radius} height={cellSize / 2} y={-cellSize / 4} fill={color} stroke={color} strokeWidth={2} />
      )}
    </Group>
  );
}
