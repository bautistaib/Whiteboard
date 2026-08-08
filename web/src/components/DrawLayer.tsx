import type Konva from "konva";
import { useRef } from "react";
import { Arrow, Circle, Ellipse, Group, Layer, Line, Rect, Text } from "react-konva";
import { sortedObjects, useStore, type Role, type SceneObj } from "../store";
import { sendThrottled, wsClient } from "../ws";
import { prefixOf } from "../pages/BoardPage";
import { eraseJustDragged } from "./eraseFlag";
import { registerNode } from "./nodeRegistry";
import { objectBounds } from "./objectBounds";

/** Capa de dibujos: paths (lápiz), formas y textos. */
export default function DrawLayer({
  onStartTextEdit,
}: {
  onStartTextEdit?: (worldX: number, worldY: number, editId?: string) => void;
}) {
  const objects = useStore((s) => s.objects);
  const drawing = sortedObjects(objects).filter(
    (o) => o.type === "path" || o.type === "shape" || o.type === "text",
  );
  // posiciones iniciales del grupo al arrastrar (multi-select group move)
  const groupStart = useRef<Record<string, { x: number; y: number }>>({});
  return (
    <Layer>
      {drawing.map((obj) => (
        <DrawObject key={obj.id} obj={obj} onStartTextEdit={onStartTextEdit} groupStart={groupStart} />
      ))}
    </Layer>
  );
}

export function canModifyObject(
  obj: SceneObj,
  role: Role,
  clientId: string,
  playersMoveAny: boolean,
): boolean {
  if (role === "dm") return true;
  if (obj.owner === clientId) return true;
  if (obj.type === "token" && playersMoveAny) return true;
  return false;
}

export function useCanModify(obj: SceneObj): boolean {
  const role = useStore((s) => s.role);
  const clientId = useStore((s) => s.clientId);
  const playersMoveAny = useStore((s) => s.grid.playersMoveAny);
  return canModifyObject(obj, role, clientId, playersMoveAny);
}

/**
 * Handlers comunes de objetos dibujables (path/shape/text/aoe).
 * `groupStart` (compartido por capa) habilita el movimiento en grupo:
 * al arrastrar un objeto de una multi-selección, todos los seleccionados
 * (no-tokens — los tokens tienen su propio group-move) se mueven juntos.
 */
export function useObjectHandlers(
  obj: SceneObj,
  movable: boolean,
  groupStart?: React.MutableRefObject<Record<string, { x: number; y: number }>>,
) {
  const tool = useStore((s) => s.tool);
  const canModify = useCanModify(obj);
  const selection = useStore((s) => s.selection);
  const setSelection = useStore((s) => s.setSelection);
  const toggleSelected = useStore((s) => s.toggleSelected);
  const setContextMenu = useStore((s) => s.setContextMenu);
  const updateObjectLocal = useStore((s) => s.updateObjectLocal);

  const draggable = movable && tool === "select" && canModify;

  const onClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return;
    e.cancelBubble = true;
    if (tool === "eraser") {
      // si recién hubo un arrastre de borrado parcial, este click es espurio
      if (eraseJustDragged()) return;
      if (canModify) {
        useStore.getState().removeObjectLocal(obj.id);
        wsClient.send(`${prefixOf(obj.type)}.remove`, { id: obj.id });
      }
      return;
    }
    if (tool !== "select") return;
    if (e.evt.shiftKey) toggleSelected(obj.id);
    else if (!selection.includes(obj.id)) setSelection([obj.id]);
  };

  const onContextMenu = (e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    e.cancelBubble = true;
    if (!canModify) return;
    setContextMenu({ objId: obj.id, x: e.evt.clientX, y: e.evt.clientY });
  };

  /** Snapshot de las posiciones del grupo (selección multi, no-tokens modificables). */
  const onDragStart = () => {
    if (!groupStart) return;
    groupStart.current = {};
    const st = useStore.getState();
    if (st.selection.length <= 1 || !st.selection.includes(obj.id)) return;
    for (const id of st.selection) {
      const o = st.objects[id];
      if (o && o.type !== "token" && canModifyObject(o, st.role, st.clientId, st.grid.playersMoveAny)) {
        groupStart.current[id] = { x: o.data.x ?? 0, y: o.data.y ?? 0 };
      }
    }
  };

  /** Aplica el delta del líder a todo el grupo; devuelve false si no hay grupo. */
  const moveGroup = (leaderPos: { x: number; y: number }, final: boolean): boolean => {
    const group = groupStart?.current ?? {};
    const start = group[obj.id];
    if (!start) return false;
    const delta = { x: leaderPos.x - start.x, y: leaderPos.y - start.y };
    for (const [id, s] of Object.entries(group)) {
      const nx = s.x + delta.x;
      const ny = s.y + delta.y;
      updateObjectLocal(id, { x: nx, y: ny });
      const o = useStore.getState().objects[id];
      if (!o) continue;
      const payload = { id, patch: { x: nx, y: ny } };
      const op = `${prefixOf(o.type)}.update`;
      if (final) wsClient.send(op, payload);
      else sendThrottled(`drag-${id}`, op, payload);
    }
    if (final && groupStart) groupStart.current = {};
    return true;
  };

  const onDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const pos = e.target.position();
    if (moveGroup(pos, false)) return;
    updateObjectLocal(obj.id, { x: pos.x, y: pos.y });
    // solo tokens tienen op move; el resto va por update (patch)
    if (obj.type === "token") {
      sendThrottled(`drag-${obj.id}`, "token.move", { id: obj.id, x: pos.x, y: pos.y });
    } else {
      sendThrottled(`drag-${obj.id}`, `${prefixOf(obj.type)}.update`, {
        id: obj.id,
        patch: { x: pos.x, y: pos.y },
      });
    }
  };

  const onDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const pos = e.target.position();
    if (moveGroup(pos, true)) return;
    updateObjectLocal(obj.id, { x: pos.x, y: pos.y });
    if (obj.type === "token") {
      wsClient.send("token.move", { id: obj.id, x: pos.x, y: pos.y });
    } else {
      wsClient.send(`${prefixOf(obj.type)}.update`, {
        id: obj.id,
        patch: { x: pos.x, y: pos.y },
      });
    }
  };

  return { draggable, onClick, onContextMenu, onDragStart, onDragMove, onDragEnd };
}

function DrawObject({
  obj,
  onStartTextEdit,
  groupStart,
}: {
  obj: SceneObj;
  onStartTextEdit?: (worldX: number, worldY: number, editId?: string) => void;
  groupStart: React.MutableRefObject<Record<string, { x: number; y: number }>>;
}) {
  const selected = useStore((s) => s.selection.includes(obj.id));
  const handlers = useObjectHandlers(obj, true, groupStart);
  const canModify = useCanModify(obj);
  const d = obj.data;

  const common = {
    x: d.x ?? 0,
    y: d.y ?? 0,
    rotation: d.rotation ?? 0,
    ref: (node: Konva.Node | null) => registerNode(obj.id, node),
    ...handlers,
  };

  if (obj.type === "path") {
    const pts = d.points ?? [];
    // un solo punto (click del lápiz) → puntito relleno.
    // Va en un Group en (d.x, d.y) con el círculo en coords relativas:
    // arrastrar el Group reporta position() = d.x (consistente con el resto).
    if (pts.length === 2) {
      return (
        <>
          <Group {...common}>
            <Circle
              x={pts[0]}
              y={pts[1]}
              radius={(d.width ?? 4) / 2}
              fill={d.color ?? "#fff"}
              hitRadius={Math.max(8, (d.width ?? 4) / 2 + 4)}
            />
          </Group>
          {selected && <SelectionHalo obj={obj} />}
        </>
      );
    }
    return (
      <>
        <Line
          {...common}
          points={pts}
          stroke={d.color ?? "#fff"}
          strokeWidth={d.width ?? 4}
          lineCap="round"
          lineJoin="round"
          tension={0.4}
          hitStrokeWidth={Math.max(12, (d.width ?? 4) * 2)}
        />
        {selected && <SelectionHalo obj={obj} />}
      </>
    );
  }

  if (obj.type === "text") {
    return (
      <>
        <Text
          {...common}
          text={d.text ?? ""}
          fontSize={d.fontSize ?? 22}
          fill={d.color ?? "#fff"}
          onDblClick={() => {
            // doble click → edición inline (patrón estándar)
            if (canModify && onStartTextEdit) {
              onStartTextEdit(d.x ?? 0, d.y ?? 0, obj.id);
            }
          }}
        />
        {selected && <SelectionHalo obj={obj} />}
      </>
    );
  }

  // shape
  const stroke = d.color ?? "#fff";
  const width = d.width ?? 4;
  switch (d.shape) {
    case "rect":
      return (
        <>
          <Rect {...common} width={d.w ?? 0} height={d.h ?? 0} stroke={stroke} strokeWidth={width} />
          {selected && <SelectionHalo obj={obj} />}
        </>
      );
    case "circle":
      return (
        <>
          <Ellipse
            {...common}
            radiusX={Math.abs(d.w ?? 0) / 2}
            radiusY={Math.abs(d.h ?? 0) / 2}
            stroke={stroke}
            strokeWidth={width}
          />
          {selected && <SelectionHalo obj={obj} />}
        </>
      );
    case "arrow":
      return (
        <>
          <Arrow
            {...common}
            points={d.points ?? [0, 0, 0, 0]}
            stroke={stroke}
            fill={stroke}
            strokeWidth={width}
            pointerLength={12}
            pointerWidth={10}
          />
          {selected && <SelectionHalo obj={obj} />}
        </>
      );
    default: // line
      return (
        <>
          <Line {...common} points={d.points ?? [0, 0, 0, 0]} stroke={stroke} strokeWidth={width} />
          {selected && <SelectionHalo obj={obj} />}
        </>
      );
  }
}

function SelectionHalo({ obj }: { obj: SceneObj }) {
  const cellSize = useStore((s) => s.grid.cellSize);
  // halo = bounding box del objeto (los paths tienen el origen en (0,0) del
  // mundo: hay que mirar los puntos, no d.x/d.y)
  const b = objectBounds(obj, cellSize);
  return (
    <Rect
      x={b.minX - 4}
      y={b.minY - 4}
      width={Math.max(b.maxX - b.minX, 24) + 8}
      height={Math.max(b.maxY - b.minY, 24) + 8}
      stroke="#4fc3f7"
      strokeWidth={1.5}
      dash={[6, 4]}
      listening={false}
    />
  );
}
