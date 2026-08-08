import type Konva from "konva";
import { useEffect, useMemo, useRef, useState } from "react";
import { Stage } from "react-konva";
import { gridFromConfig } from "../grid";
import { useStore, type SceneObj } from "../store";
import { sendThrottled, wsClient } from "../ws";
import AoELayer from "./AoELayer";
import BackgroundLayer from "./BackgroundLayer";
import DrawLayer from "./DrawLayer";
import { markEraseDragged } from "./eraseFlag";
import GridLayer from "./GridLayer";
import OverlayLayer, { type Preview } from "./OverlayLayer";
import TokenContextMenu from "./TokenContextMenu";
import TokenLayer from "./TokenLayer";
import { registerNode } from "./nodeRegistry";

interface Point {
  x: number;
  y: number;
}

export default function Board() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });

  const camera = useStore((s) => s.camera);
  const setCamera = useStore((s) => s.setCamera);
  const tool = useStore((s) => s.tool);
  const gridConfig = useStore((s) => s.grid);
  const role = useStore((s) => s.role);
  const setFollowDm = useStore((s) => s.setFollowDm);
  const followDm = useStore((s) => s.followDm);
  const drawColor = useStore((s) => s.drawColor);
  const drawWidth = useStore((s) => s.drawWidth);
  const setMeasure = useStore((s) => s.setMeasure);
  const setSelection = useStore((s) => s.setSelection);
  const setContextMenu = useStore((s) => s.setContextMenu);
  const snapshotReceived = useStore((s) => s.snapshotReceived);
  const textEdit = useStore((s) => s.textEdit);
  const setTextEdit = useStore((s) => s.setTextEdit);
  const setToolOptionsOpen = useStore((s) => s.setToolOptionsOpen);
  const addObjectLocal = useStore((s) => s.addObjectLocal);
  const updateObjectLocal = useStore((s) => s.updateObjectLocal);

  const grid = useMemo(() => gridFromConfig(gridConfig), [gridConfig]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selRect, setSelRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const longPressTimer = useRef<number | null>(null);
  // pan con click derecho (drag sobre canvas vacío)
  const rightPan = useRef<{ sx: number; sy: number; camX: number; camY: number } | null>(null);
  // trazo del borrador parcial (puntos en coords de mundo)
  const eraseStroke = useRef<Point[] | null>(null);
  // medición solo mientras el botón está apretado
  const measureDragging = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // el stage queda registrado para la exportación a PNG (Toolbar)
  useEffect(() => {
    registerNode("stage", stageRef.current);
    return () => registerNode("stage", null);
  }, []);

  const worldPos = (): Point => {
    const stage = stageRef.current!;
    const p = stage.getPointerPosition() ?? { x: 0, y: 0 };
    return {
      x: (p.x - stage.x()) / stage.scaleX(),
      y: (p.y - stage.y()) / stage.scaleY(),
    };
  };

  const applyCamera = (cam: { x: number; y: number; scale: number }, fromUser: boolean) => {
    setCamera(cam);
    if (fromUser) {
      if (followDm) setFollowDm(false);
      if (role === "dm") {
        sendThrottled("camera", "camera.sync", cam);
      }
    }
  };

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current!;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const oldScale = camera.scale;
    const world = {
      x: (pointer.x - camera.x) / oldScale,
      y: (pointer.y - camera.y) / oldScale,
    };
    const factor = e.evt.deltaY > 0 ? 1 / 1.12 : 1.12;
    const scale = Math.min(8, Math.max(0.1, oldScale * factor));
    applyCamera({ x: pointer.x - world.x * scale, y: pointer.y - world.y * scale, scale }, true);
  };

  const isEmptyTarget = (e: Konva.KonvaEventObject<any>) => e.target === stageRef.current;

  const nextZ = (): number => {
    const objects = useStore.getState().objects;
    let top = 0;
    for (const o of Object.values(objects)) top = Math.max(top, o.z);
    return top + 1;
  };

  /** Alta optimista: se ve al instante; el eco del server pisa con el mismo id. */
  const optimisticAdd = (type: SceneObj["type"], data: Record<string, any>): string => {
    const id = crypto.randomUUID();
    const clientId = useStore.getState().clientId;
    addObjectLocal({ id, type, z: nextZ(), owner: clientId, data });
    return id;
  };

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    setContextMenu(null);
    if (e.evt.button === 0) setToolOptionsOpen(false); // cerrar panel de opciones al dibujar
    const pos = worldPos();

    // click de rueda → ping
    if (e.evt.button === 1) {
      e.evt.preventDefault();
      wsClient.send("ping", pos);
      return;
    }

    // click derecho sobre canvas vacío → arrastrar para mover la cámara
    if (e.evt.button === 2) {
      if (isEmptyTarget(e)) {
        const p = stageRef.current!.getPointerPosition();
        if (p) {
          rightPan.current = { sx: p.x, sy: p.y, camX: camera.x, camY: camera.y };
        }
      }
      return;
    }
    if (e.evt.button !== 0) return;

    if (tool === "select" && isEmptyTarget(e)) {
      setSelRect({ x: pos.x, y: pos.y, w: 0, h: 0 });
      return;
    }
    if (tool === "eraser") {
      // arrastre (desde donde sea) → borrado parcial de trazos;
      // click simple sobre un objeto lo borra entero (onClick del objeto)
      eraseStroke.current = [pos];
      return;
    }
    if (tool === "pencil") {
      setPreview({ tool, start: pos, current: pos, points: [pos.x, pos.y] });
      return;
    }
    if (tool === "rect" || tool === "circle" || tool === "line" || tool === "arrow") {
      setPreview({ tool, start: pos, current: pos });
      return;
    }
    if (tool === "text") {
      if (!isEmptyTarget(e)) return;
      startTextEdit(pos.x, pos.y);
      return;
    }
    if (tool === "measure") {
      measureDragging.current = true;
      setMeasure({ ax: pos.x, ay: pos.y, bx: pos.x, by: pos.y });
      return;
    }
    if (tool.startsWith("aoe-")) {
      setPreview({ tool, start: pos, current: pos });
      return;
    }
  };

  const onMouseMove = () => {
    // pan con click derecho
    if (rightPan.current) {
      const p = stageRef.current!.getPointerPosition();
      if (p) {
        applyCamera(
          {
            x: rightPan.current.camX + (p.x - rightPan.current.sx),
            y: rightPan.current.camY + (p.y - rightPan.current.sy),
            scale: useStore.getState().camera.scale,
          },
          true,
        );
      }
      return;
    }

    const pos = worldPos();
    sendThrottled("cursor", "cursor.move", pos);

    if (eraseStroke.current) {
      eraseStroke.current.push(pos);
      return;
    }
    if (selRect) {
      setSelRect({ ...selRect, w: pos.x - selRect.x, h: pos.y - selRect.y });
      return;
    }
    if (preview) {
      if (preview.tool === "pencil") {
        setPreview({ ...preview, current: pos, points: [...(preview.points ?? []), pos.x, pos.y] });
      } else {
        setPreview({ ...preview, current: pos });
      }
      return;
    }
    const measure = useStore.getState().measure;
    if (tool === "measure" && measureDragging.current && measure) {
      setMeasure({ ...measure, bx: pos.x, by: pos.y });
    }
  };

  const onMouseUp = () => {
    measureDragging.current = false;
    if (rightPan.current) {
      rightPan.current = null;
      return;
    }
    if (eraseStroke.current) {
      finishEraseStroke(eraseStroke.current);
      eraseStroke.current = null;
      return;
    }
    if (selRect) {
      finishSelection();
      return;
    }
    if (!preview) return;
    finishPreview(preview);
    setPreview(null);
  };

  // ---- borrador parcial: corta los puntos del trazo bajo el cursor -----------

  const finishEraseStroke = (stroke: Point[]) => {
    if (stroke.length < 2) return; // click simple: lo maneja el onClick del objeto
    markEraseDragged();

    const st = useStore.getState();
    const radius = Math.max(6, st.drawWidth) / st.camera.scale;
    const clientId = st.clientId;
    const isDm = st.role === "dm";

    for (const obj of Object.values(st.objects)) {
      if (obj.type !== "path") continue;
      if (!isDm && obj.owner !== clientId) continue;
      const pts: number[] = obj.data.points ?? [];
      const ox = obj.data.x ?? 0;
      const oy = obj.data.y ?? 0;
      const halfWidth = (obj.data.width ?? 4) / 2;

      // runs de puntos que sobreviven; el radio incluye la mitad del grosor del trazo
      const effRadius = radius + halfWidth;
      const runs: number[][] = [];
      let current: number[] = [];
      for (let i = 0; i < pts.length; i += 2) {
        const px = ox + pts[i];
        const py = oy + pts[i + 1];
        let erased = false;
        for (const p of stroke) {
          const ddx = p.x - px;
          const ddy = p.y - py;
          if (ddx * ddx + ddy * ddy < effRadius * effRadius) {
            erased = true;
            break;
          }
        }
        if (erased) {
          if (current.length >= 4) runs.push(current);
          current = [];
        } else {
          current.push(pts[i], pts[i + 1]);
        }
      }
      if (current.length >= 4) runs.push(current);

      const totalKept = runs.reduce((n, r) => n + r.length, 0);
      if (totalKept === pts.length) continue; // no se tocó

      st.removeObjectLocal(obj.id);
      wsClient.send("draw.remove", { id: obj.id });
      for (const run of runs) {
        const data = { x: ox, y: oy, points: run, color: obj.data.color, width: obj.data.width };
        const newId = optimisticAdd("path", data);
        wsClient.send("draw.add", { id: newId, data });
      }
    }
  };

  const finishSelection = () => {
    const rect = selRect!;
    setSelRect(null);
    const rx = Math.min(rect.x, rect.x + rect.w);
    const ry = Math.min(rect.y, rect.y + rect.h);
    const rw = Math.abs(rect.w);
    const rh = Math.abs(rect.h);
    if (rw < 4 && rh < 4) {
      setSelection([]);
      return;
    }
    const objects = useStore.getState().objects;
    const hits: string[] = [];
    for (const o of Object.values(objects)) {
      const ox = o.data.x ?? 0;
      const oy = o.data.y ?? 0;
      const half = o.type === "token" ? ((o.data.size_cells ?? 1) * gridConfig.cellSize) / 2 : 0;
      if (ox + half >= rx && ox - half <= rx + rw && oy + half >= ry && oy - half <= ry + rh) {
        hits.push(o.id);
      }
    }
    setSelection(hits);
  };

  const finishPreview = (p: Preview) => {
    const dx = p.current.x - p.start.x;
    const dy = p.current.y - p.start.y;
    const distPx = Math.hypot(dx, dy);

    if (p.tool === "pencil") {
      const pts = p.points ?? [];
      if (pts.length >= 2) {
        // un click = 1 punto (2 valores) → puntito; un trazo = varios
        const data = { x: 0, y: 0, points: pts, color: drawColor, width: drawWidth };
        const id = optimisticAdd("path", data);
        wsClient.send("draw.add", { id, data });
      }
      return;
    }

    // AoE: un click simple basta para colocar (1 celda); el arrastre define tamaño/ángulo
    if (p.tool.startsWith("aoe-")) {
      const cells = Math.max(1, Math.round(distPx / gridConfig.cellSize));
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const data = {
        shape: p.tool.replace("aoe-", ""),
        x: p.start.x,
        y: p.start.y,
        size_cells: cells,
        rotation: p.tool === "aoe-circle" ? 0 : angle,
        color: drawColor,
      };
      const id = optimisticAdd("aoe", data);
      wsClient.send("aoe.add", { id, data });
      return;
    }

    if (distPx < 3) return; // click sin arrastre para el resto de las formas

    if (p.tool === "rect" || p.tool === "circle") {
      const data =
        p.tool === "rect"
          ? {
              shape: "rect",
              x: Math.min(p.start.x, p.current.x),
              y: Math.min(p.start.y, p.current.y),
              w: Math.abs(dx),
              h: Math.abs(dy),
              color: drawColor,
              width: drawWidth,
            }
          : {
              shape: "circle",
              x: (p.start.x + p.current.x) / 2,
              y: (p.start.y + p.current.y) / 2,
              w: Math.abs(dx),
              h: Math.abs(dy),
              color: drawColor,
              width: drawWidth,
            };
      const id = optimisticAdd("shape", data);
      wsClient.send("shape.add", { id, data });
      return;
    }
    if (p.tool === "line" || p.tool === "arrow") {
      const data = {
        shape: p.tool,
        x: p.start.x,
        y: p.start.y,
        points: [0, 0, dx, dy],
        color: drawColor,
        width: drawWidth,
      };
      const id = optimisticAdd("shape", data);
      wsClient.send("shape.add", { id, data });
      return;
    }
  };

  // ---- texto inline ----------------------------------------------------------

  const startTextEdit = (worldX: number, worldY: number, editId?: string) => {
    const st = useStore.getState();
    const existing = editId ? st.objects[editId]?.data : undefined;
    setTextEdit({
      worldX,
      worldY,
      value: existing?.text ?? "",
      editId,
    });
  };

  const commitTextEdit = (value: string) => {
    const te = useStore.getState().textEdit;
    setTextEdit(null);
    if (!te) return;
    const v = value.trim();
    if (te.editId) {
      if (v) {
        updateObjectLocal(te.editId, { text: v });
        wsClient.send("text.update", { id: te.editId, patch: { text: v } });
      }
    } else if (v) {
      const data = { x: te.worldX, y: te.worldY, text: v, color: drawColor, fontSize: 22 };
      const id = optimisticAdd("text", data);
      wsClient.send("text.add", { id, data });
    }
  };

  // ---- pan (drag del stage con tool pan) --------------------------------------
  const onStageDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    if (e.target !== stageRef.current) return;
    applyCamera({ x: e.target.x(), y: e.target.y(), scale: camera.scale }, true);
  };

  // ---- ping táctil: mantener presionado -----------------------------------------
  const onTouchStart = () => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      wsClient.send("ping", worldPos());
    }, 550);
  };
  const onTouchMoveOrEnd = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // ---- drop desde la biblioteca ----------------------------------------------------
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/x-ttrpg-character");
    if (!raw) return;
    try {
      const { characterId, variantId } = JSON.parse(raw);
      const st = useStore.getState();
      const variant = st.library.variants.find((v) => v.id === variantId);
      const character = st.library.characters.find((c) => c.id === characterId);
      if (!variant || !character) return;
      const stage = stageRef.current!;
      const rect = containerRef.current!.getBoundingClientRect();
      const stagePoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      let world = {
        x: (stagePoint.x - stage.x()) / stage.scaleX(),
        y: (stagePoint.y - stage.y()) / stage.scaleY(),
      };
      if (st.grid.snap) world = gridFromConfig(st.grid).snap(world);
      const data = {
        x: world.x,
        y: world.y,
        asset_id: variant.assetId,
        character_id: characterId,
        active_variant_id: variantId,
        size_cells: variant.sizeCells,
        name: character.name,
        show_name: true,
        rotation: 0,
        badges: [],
      };
      const id = optimisticAdd("token", data);
      wsClient.send("token.add", { id, data });
    } catch {
      // drag inválido: ignorar
    }
  };

  // posición en pantalla del editor de texto (coords de mundo → px del contenedor)
  const textEditScreen = textEdit
    ? {
        left: textEdit.worldX * camera.scale + camera.x,
        top: textEdit.worldY * camera.scale + camera.y,
      }
    : null;

  const bgColor = gridConfig.backgroundColor ?? undefined;

  return (
    <div
      ref={containerRef}
      className="board-canvas"
      style={bgColor ? { backgroundColor: bgColor } : undefined}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        x={camera.x}
        y={camera.y}
        scaleX={camera.scale}
        scaleY={camera.scale}
        draggable={tool === "pan"}
        onDragEnd={onStageDragEnd}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMoveOrEnd}
        onTouchEnd={onTouchMoveOrEnd}
        onContextMenu={(e) => e.evt.preventDefault()}
      >
        <BackgroundLayer />
        <GridLayer width={size.width} height={size.height} />
        <DrawLayer onStartTextEdit={startTextEdit} />
        <AoELayer />
        <TokenLayer />
        <OverlayLayer preview={preview} selectionRect={selRect} />
      </Stage>
      {!snapshotReceived && <div className="board-loading">Cargando escena…</div>}
      {textEdit && textEditScreen && (
        <TextEditor
          key={textEdit.editId ?? "new"}
          left={textEditScreen.left}
          top={textEditScreen.top}
          scale={camera.scale}
          color={drawColor}
          initial={textEdit.value}
          onCommit={commitTextEdit}
          onCancel={() => setTextEdit(null)}
        />
      )}
      <TokenContextMenu />
    </div>
  );
}

/** Editor de texto inline con estado local (sin re-renders del store por tecla). */
function TextEditor({
  left,
  top,
  scale,
  color,
  initial,
  onCommit,
  onCancel,
}: {
  left: number;
  top: number;
  scale: number;
  color: string;
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const committed = useRef(false);
  return (
    <textarea
      autoFocus
      className="text-editor"
      style={{ left, top, fontSize: Math.max(12, 22 * scale), color }}
      value={value}
      placeholder="Escribí…"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          committed.current = true;
          onCommit(value);
        } else if (e.key === "Escape") {
          committed.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (committed.current) return;
        committed.current = true;
        onCommit(value);
      }}
    />
  );
}


