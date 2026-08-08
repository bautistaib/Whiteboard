import type Konva from "konva";
import { useRef } from "react";
import { Group, Image as KImage, Layer, Rect, Text } from "react-konva";
import { gridFromConfig } from "../grid";
import { sortedObjects, useStore, type SceneObj } from "../store";
import { sendThrottled, wsClient } from "../ws";
import { useAssetImage } from "./useImage";
import { eraseJustDragged } from "./eraseFlag";
import { registerNode } from "./nodeRegistry";
import { useCanModify } from "./DrawLayer";

/** Capa de tokens (tope de la pila de capas). */
export default function TokenLayer() {
  const objects = useStore((s) => s.objects);
  const tokens = sortedObjects(objects).filter((o) => o.type === "token");
  // posiciones iniciales del grupo al arrastrar (multi-select group move)
  const groupStart = useRef<Record<string, { x: number; y: number }>>({});

  return (
    <Layer>
      {tokens.map((obj) => (
        <Token key={obj.id} obj={obj} groupStart={groupStart} />
      ))}
    </Layer>
  );
}

function Token({
  obj,
  groupStart,
}: {
  obj: SceneObj;
  groupStart: React.MutableRefObject<Record<string, { x: number; y: number }>>;
}) {
  const tool = useStore((s) => s.tool);
  const selected = useStore((s) => s.selection.includes(obj.id));
  const selection = useStore((s) => s.selection);
  const objects = useStore((s) => s.objects);
  const gridConfig = useStore((s) => s.grid);
  const canModify = useCanModify(obj);
  const setSelection = useStore((s) => s.setSelection);
  const toggleSelected = useStore((s) => s.toggleSelected);
  const setContextMenu = useStore((s) => s.setContextMenu);
  const updateObjectLocal = useStore((s) => s.updateObjectLocal);
  const assets = useStore((s) => s.library.assets);

  const d = obj.data;
  const sizePx = (d.size_cells ?? 1) * gridConfig.cellSize;
  const asset = assets.find((a) => a.id === d.asset_id);
  const img = useAssetImage(asset?.filename);

  const draggable = tool === "select" && canModify;
  const isGroupLeader = selected && selection.length > 1;

  const onClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return;
    e.cancelBubble = true;
    if (tool === "eraser") {
      if (eraseJustDragged()) return;
      if (canModify) {
        useStore.getState().removeObjectLocal(obj.id);
        wsClient.send("token.remove", { id: obj.id });
      }
      return;
    }
    if (tool !== "select") return;
    if (e.evt.shiftKey) toggleSelected(obj.id);
    else if (!selected) setSelection([obj.id]);
  };

  const onDragStart = () => {
    groupStart.current = {};
    const ids = isGroupLeader ? selection : [obj.id];
    for (const id of ids) {
      const o = objects[id];
      if (o && o.type === "token") {
        groupStart.current[id] = { x: o.data.x ?? 0, y: o.data.y ?? 0 };
      }
    }
  };

  const onDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const pos = e.target.position();
    const start = groupStart.current[obj.id] ?? pos;
    const delta = { x: pos.x - start.x, y: pos.y - start.y };
    for (const [id, s] of Object.entries(groupStart.current)) {
      const nx = s.x + delta.x;
      const ny = s.y + delta.y;
      updateObjectLocal(id, { x: nx, y: ny });
      // todos los miembros del grupo streamean su posición (throttled por id):
      // los demás clientes ven el grupo moverse en vivo, no solo al soltar
      sendThrottled(`drag-${id}`, "token.move", { id, x: nx, y: ny });
    }
  };

  const onDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const grid = gridFromConfig(gridConfig);
    let pos = e.target.position();
    if (gridConfig.snap) pos = grid.snap(pos);
    const start = groupStart.current[obj.id] ?? pos;
    const delta = { x: pos.x - start.x, y: pos.y - start.y };
    const ids = Object.keys(groupStart.current);
    for (const [id, s] of Object.entries(groupStart.current)) {
      const nx = s.x + delta.x;
      const ny = s.y + delta.y;
      updateObjectLocal(id, { x: nx, y: ny });
      // posición final garantizada al soltar
      wsClient.send("token.move", { id, x: nx, y: ny });
    }
    if (ids.length === 0) {
      updateObjectLocal(obj.id, { x: pos.x, y: pos.y });
      wsClient.send("token.move", { id: obj.id, x: pos.x, y: pos.y });
    }
    groupStart.current = {};
  };

  const badges: { emoji: string; color: string; label: string }[] = d.badges ?? [];

  return (
    <Group
      x={d.x ?? 0}
      y={d.y ?? 0}
      rotation={d.rotation ?? 0}
      draggable={draggable}
      onClick={onClick}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onContextMenu={(e) => {
        e.evt.preventDefault();
        e.cancelBubble = true;
        if (canModify) setContextMenu({ objId: obj.id, x: e.evt.clientX, y: e.evt.clientY });
      }}
      ref={(node) => registerNode(obj.id, node)}
    >
      {img ? (
        <KImage
          image={img}
          width={sizePx}
          height={sizePx}
          offsetX={sizePx / 2}
          offsetY={sizePx / 2}
          cornerRadius={sizePx / 8}
        />
      ) : (
        <Rect
          width={sizePx}
          height={sizePx}
          offsetX={sizePx / 2}
          offsetY={sizePx / 2}
          fill="#555"
          cornerRadius={sizePx / 8}
        />
      )}
      {selected && (
        <Rect
          width={sizePx + 8}
          height={sizePx + 8}
          offsetX={sizePx / 2 + 4}
          offsetY={sizePx / 2 + 4}
          stroke="#4fc3f7"
          strokeWidth={2}
          dash={[6, 4]}
          listening={false}
        />
      )}
      {d.show_name !== false && d.name && (
        <Text
          text={d.name}
          fontSize={14}
          fill="#fff"
          x={-sizePx / 2}
          y={sizePx / 2 + 2}
          width={sizePx}
          align="center"
          listening={false}
          shadowColor="#000"
          shadowBlur={3}
        />
      )}
      {badges.map((b, i) => (
        <Text
          key={`${b.emoji}-${i}`}
          text={b.emoji}
          fontSize={18}
          x={sizePx / 2 - 20}
          y={-sizePx / 2 + i * 20}
          listening={false}
        />
      ))}
    </Group>
  );
}
