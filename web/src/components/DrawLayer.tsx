import type Konva from "konva";
import { Arrow, Ellipse, Layer, Line, Rect, Text } from "react-konva";
import { sortedObjects, useStore, type SceneObj } from "../store";
import { sendThrottled, wsClient } from "../ws";
import { prefixOf } from "../pages/BoardPage";
import { eraseJustDragged } from "./eraseFlag";
import { registerNode } from "./nodeRegistry";

/** Capa de dibujos: paths (lápiz), formas y textos. */
export default function DrawLayer() {
  const objects = useStore((s) => s.objects);
  const drawing = sortedObjects(objects).filter(
    (o) => o.type === "path" || o.type === "shape" || o.type === "text",
  );
  return (
    <Layer>
      {drawing.map((obj) => (
        <DrawObject key={obj.id} obj={obj} />
      ))}
    </Layer>
  );
}

export function useCanModify(obj: SceneObj): boolean {
  const role = useStore((s) => s.role);
  const clientId = useStore((s) => s.clientId);
  const playersMoveAny = useStore((s) => s.grid.playersMoveAny);
  if (role === "dm") return true;
  if (obj.owner === clientId) return true;
  if (obj.type === "token" && playersMoveAny) return true;
  return false;
}

export function useObjectHandlers(obj: SceneObj, movable: boolean) {
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

  const onDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const pos = e.target.position();
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

  return { draggable, onClick, onContextMenu, onDragMove, onDragEnd };
}

function DrawObject({ obj }: { obj: SceneObj }) {
  const selected = useStore((s) => s.selection.includes(obj.id));
  const movable = obj.type !== "path"; // los paths no tienen op de update
  const handlers = useObjectHandlers(obj, movable);
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
    return (
      <>
        <Line
          {...common}
          points={d.points ?? []}
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
            if (canModify) {
              useStore.getState().setTextEdit({
                worldX: d.x ?? 0,
                worldY: d.y ?? 0,
                value: d.text ?? "",
                editId: obj.id,
              });
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
  const node = useStore((s) => s.objects[obj.id]);
  void node;
  const d = obj.data;
  // halo aproximado: rect alrededor del origen (suficiente para feedback)
  const w = Math.abs(d.w ?? d.fontSize ?? 40);
  const h = Math.abs(d.h ?? d.fontSize ?? 40);
  return (
    <Rect
      x={(d.x ?? 0) - 4}
      y={(d.y ?? 0) - 4}
      width={Math.max(w, 24) + 8}
      height={Math.max(h, 24) + 8}
      stroke="#4fc3f7"
      strokeWidth={1.5}
      dash={[6, 4]}
      listening={false}
    />
  );
}
