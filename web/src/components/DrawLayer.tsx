import type Konva from "konva";
import { useEffect, useMemo, useRef, useState } from "react";
import { Arrow, Circle, Ellipse, Group, Image as KImage, Layer, Line, Rect, Shape, Text } from "react-konva";
import { dashPattern, withAlpha } from "../draw/style";
import { sortedObjects, useStore, type Role, type SceneObj } from "../store";
import { sendThrottled, wsClient } from "../ws";
import { prefixOf } from "../pages/BoardPage";
import { eraseJustDragged } from "./eraseFlag";
import { registerNode } from "./nodeRegistry";
import { objectBounds } from "./objectBounds";

/** Mezcla canvas: solo multiply/screen; el resto es source-over. */
function blendOp(blend: unknown): GlobalCompositeOperation {
  return blend === "multiply" || blend === "screen" ? blend : "source-over";
}

/** cache de imágenes por URL (mismo patrón que useAssetImage, pero con path completo) */
const urlImgCache = new Map<string, HTMLImageElement>();

function useUrlImage(url: string | undefined): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(url ? urlImgCache.get(url) ?? null : null);
  useEffect(() => {
    if (!url) {
      setImg(null);
      return;
    }
    const cached = urlImgCache.get(url);
    if (cached) {
      setImg(cached);
      return;
    }
    const el = new Image();
    el.src = url;
    el.onload = () => {
      urlImgCache.set(url, el);
      setImg(el);
    };
    return () => {
      el.onload = null;
    };
  }, [url]);
  return img;
}

/**
 * Polígono que bordea un trazo de ancho variable: lado izquierdo hacia
 * adelante + lado derecho hacia atrás, usando la normal de cada punto
 * (dirección centrada entre vecinos) ± widths[i]/2.
 */
function taperedStrokePolygon(pts: number[], widths: number[]): number[] {
  const n = Math.min(widths.length, pts.length / 2);
  const out: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2];
    const y = pts[i * 2 + 1];
    const pi = Math.max(0, i - 1) * 2;
    const ni = Math.min(n - 1, i + 1) * 2;
    let dx = pts[ni] - pts[pi];
    let dy = pts[ni + 1] - pts[pi + 1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const half = widths[i] / 2;
    out.push(x - dy * half, y + dx * half);
    right.push(x + dy * half, y - dx * half);
  }
  for (let i = right.length - 2; i >= 0; i -= 2) out.push(right[i], right[i + 1]);
  return out;
}

function tracePolygon(ctx: Konva.Context, poly: number[]) {
  ctx.beginPath();
  ctx.moveTo(poly[0], poly[1]);
  for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
  ctx.closePath();
}

/** Un círculo relleno por punto, con radio widths[i]. */
function traceSpray(ctx: Konva.Context, pts: number[], widths: number[]) {
  ctx.beginPath();
  const n = Math.min(widths.length, pts.length / 2);
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2];
    const y = pts[i * 2 + 1];
    const r = Math.max(0.1, widths[i]);
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
}

/** Trazo de ancho variable (pressureWidth): polígono cónico relleno. */
function TaperedStroke({ d, common }: { d: Record<string, any>; common: Record<string, any> }) {
  const pts: number[] = d.points ?? [];
  const widths: number[] = d.widths ?? [];
  const poly = useMemo(() => taperedStrokePolygon(pts, widths), [pts, widths]);
  if (poly.length < 6) return null;
  return (
    <Shape
      {...common}
      sceneFunc={(ctx, shape) => {
        tracePolygon(ctx, poly);
        ctx.fillShape(shape);
      }}
      hitFunc={(ctx, shape) => {
        // hit = el mismo polígono (aproximación suficiente para seleccionar/borrar)
        tracePolygon(ctx, poly);
        ctx.fillStrokeShape(shape);
      }}
      fill={d.color ?? "#fff"}
      opacity={d.opacity ?? 1}
      globalCompositeOperation={blendOp(d.blend)}
    />
  );
}

/** Spray: puntos = centros de dots, widths = radio por dot. */
function SprayStroke({ d, common }: { d: Record<string, any>; common: Record<string, any> }) {
  const pts: number[] = d.points ?? [];
  const widths: number[] = d.widths ?? [];
  if (!widths.length) return null;
  return (
    <Shape
      {...common}
      sceneFunc={(ctx, shape) => {
        traceSpray(ctx, pts, widths);
        ctx.fillShape(shape);
      }}
      hitFunc={(ctx, shape) => {
        // hit barato: bbox de los puntos inflada por el radio máximo
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let maxR = 0;
        for (let i = 0; i < widths.length; i++) {
          minX = Math.min(minX, pts[i * 2]);
          maxX = Math.max(maxX, pts[i * 2]);
          minY = Math.min(minY, pts[i * 2 + 1]);
          maxY = Math.max(maxY, pts[i * 2 + 1]);
          maxR = Math.max(maxR, widths[i]);
        }
        ctx.beginPath();
        ctx.rect(minX - maxR, minY - maxR, maxX - minX + maxR * 2, maxY - minY + maxR * 2);
        ctx.fillStrokeShape(shape);
      }}
      fill={d.color ?? "#fff"}
      opacity={d.opacity ?? 1}
      globalCompositeOperation={blendOp(d.blend)}
    />
  );
}

/** Objeto imagen (asset same-origin pegado en el lienzo). */
function ImageObject({ d, common }: { d: Record<string, any>; common: Record<string, any> }) {
  const img = useUrlImage(d.url);
  if (!img) {
    // placeholder mientras carga
    return <Rect {...common} width={d.w ?? 0} height={d.h ?? 0} fill="#333" opacity={0.5} />;
  }
  return <KImage {...common} image={img} width={d.w ?? 0} height={d.h ?? 0} opacity={d.opacity ?? 1} />;
}

/** Capa de dibujos: paths (lápiz), formas y textos. */
export default function DrawLayer({
  onStartTextEdit,
}: {
  onStartTextEdit?: (worldX: number, worldY: number, editId?: string) => void;
}) {
  const objects = useStore((s) => s.objects);
  const drawing = sortedObjects(objects).filter(
    (o) =>
      o.type === "path" ||
      o.type === "shape" ||
      o.type === "text" ||
      o.type === "group" ||
      o.type === "image",
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
    scaleX: d.scaleX ?? 1,
    scaleY: d.scaleY ?? 1,
    ref: (node: Konva.Node | null) => registerNode(obj.id, node),
    ...handlers,
  };

  if (obj.type === "path") {
    const pts = d.points ?? [];
    // spray: dots con radio por punto
    if (d.spray && d.widths?.length) {
      return (
        <>
          <SprayStroke d={d} common={common} />
          {selected && <SelectionHalo obj={obj} />}
        </>
      );
    }
    // ancho variable (presión/velocidad): trazo cónico relleno
    if (d.widths?.length === pts.length / 2 && pts.length > 2) {
      return (
        <>
          <TaperedStroke d={d} common={common} />
          {selected && <SelectionHalo obj={obj} />}
        </>
      );
    }
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
              opacity={d.opacity ?? 1}
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
          opacity={d.opacity ?? 1}
          dash={d.dash ? dashPattern(d.width ?? 4) : undefined}
          lineCap="round"
          lineJoin="round"
          tension={0.4}
          hitStrokeWidth={Math.max(12, (d.width ?? 4) * 2)}
          globalCompositeOperation={blendOp(d.blend)}
        />
        {selected && <SelectionHalo obj={obj} />}
      </>
    );
  }

  if (obj.type === "image") {
    return (
      <>
        <ImageObject d={d} common={common} />
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

  if (obj.type === "group") {
    // dibujo compuesto: las parts son estáticas; los handlers del Group padre
    // (eventos burbujean desde los hijos) hacen todo el grupo arrastrable.
    return (
      <>
        <Group {...common}>
          {(d.parts ?? []).map((p: any, i: number) => (
            <GroupPart key={i} part={p} />
          ))}
        </Group>
        {selected && <SelectionHalo obj={obj} />}
      </>
    );
  }

  // shape
  const stroke = d.color ?? "#fff";
  const width = d.width ?? 4;
  // estilo opcional: opacidad, dash, mezcla y relleno translúcido (rect/circle)
  const shapeStyle = {
    opacity: d.opacity ?? 1,
    dash: d.dash ? dashPattern(width) : undefined,
    globalCompositeOperation: blendOp(d.blend),
  };
  const fill = d.filled ? withAlpha(stroke, 0.25 * (d.opacity ?? 1)) : undefined;
  switch (d.shape) {
    case "rect":
      return (
        <>
          <Rect {...common} width={d.w ?? 0} height={d.h ?? 0} stroke={stroke} strokeWidth={width} {...shapeStyle} fill={fill} />
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
            {...shapeStyle}
            fill={fill}
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
            {...shapeStyle}
            pointerLength={12}
            pointerWidth={10}
          />
          {selected && <SelectionHalo obj={obj} />}
        </>
      );
    default: // line
      return (
        <>
          <Line {...common} points={d.points ?? [0, 0, 0, 0]} stroke={stroke} strokeWidth={width} {...shapeStyle} />
          {selected && <SelectionHalo obj={obj} />}
        </>
      );
  }
}

/**
 * Una parte de un `group`: se renderiza igual que la rama de su tipo pero
 * estática (sin handlers ni halo — el Group padre ya los tiene). Las coords
 * de la part son relativas al origen del grupo.
 */
function GroupPart({ part }: { part: { type: string; data: Record<string, any> } }) {
  const d = part.data;
  const common = {
    x: d.x ?? 0,
    y: d.y ?? 0,
    rotation: d.rotation ?? 0,
    scaleX: d.scaleX ?? 1,
    scaleY: d.scaleY ?? 1,
  };

  if (part.type === "path") {
    const pts: number[] = d.points ?? [];
    const color = d.color ?? "#fff";
    const width = d.width ?? 4;
    // spray / ancho variable: mismos renderers que la rama principal
    if (d.spray && d.widths?.length) return <SprayStroke d={d} common={common} />;
    if (d.widths?.length === pts.length / 2 && pts.length > 2) return <TaperedStroke d={d} common={common} />;
    // un solo punto (click del lápiz) → puntito relleno
    if (pts.length === 2) {
      return (
        <Group x={common.x} y={common.y} rotation={common.rotation}
               scaleX={common.scaleX} scaleY={common.scaleY}>
          <Circle
            x={pts[0]}
            y={pts[1]}
            radius={width / 2}
            fill={color}
            opacity={d.opacity ?? 1}
            hitRadius={Math.max(8, width / 2 + 4)}
          />
        </Group>
      );
    }
    return (
      <Line
        {...common}
        points={pts}
        stroke={color}
        strokeWidth={width}
        opacity={d.opacity ?? 1}
        dash={d.dash ? dashPattern(width) : undefined}
        lineCap="round"
        lineJoin="round"
        tension={0.4}
        hitStrokeWidth={Math.max(12, width * 2)}
        globalCompositeOperation={blendOp(d.blend)}
      />
    );
  }

  if (part.type === "text") {
    return <Text {...common} text={d.text ?? ""} fontSize={d.fontSize ?? 22} fill={d.color ?? "#fff"} />;
  }

  if (part.type === "image") {
    return <ImageObject d={d} common={common} />;
  }

  // shape (mismo estilo opcional que la rama principal)
  const stroke = d.color ?? "#fff";
  const width = d.width ?? 4;
  const shapeStyle = {
    opacity: d.opacity ?? 1,
    dash: d.dash ? dashPattern(width) : undefined,
    globalCompositeOperation: blendOp(d.blend),
  };
  const fill = d.filled ? withAlpha(stroke, 0.25 * (d.opacity ?? 1)) : undefined;
  switch (d.shape) {
    case "rect":
      return <Rect {...common} width={d.w ?? 0} height={d.h ?? 0} stroke={stroke} strokeWidth={width} {...shapeStyle} fill={fill} />;
    case "circle":
      return (
        <Ellipse
          {...common}
          radiusX={Math.abs(d.w ?? 0) / 2}
          radiusY={Math.abs(d.h ?? 0) / 2}
          stroke={stroke}
          strokeWidth={width}
          {...shapeStyle}
          fill={fill}
        />
      );
    case "arrow":
      return (
        <Arrow
          {...common}
          points={d.points ?? [0, 0, 0, 0]}
          stroke={stroke}
          fill={stroke}
          strokeWidth={width}
          {...shapeStyle}
          pointerLength={12}
          pointerWidth={10}
        />
      );
    default: // line
      return <Line {...common} points={d.points ?? [0, 0, 0, 0]} stroke={stroke} strokeWidth={width} {...shapeStyle} />;
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
