import type Konva from "konva";
import { useEffect, useMemo, useRef, useState } from "react";
import { Layer, Stage } from "react-konva";
import { uploadImage } from "../api";
import { floodFillMask, maskToPngBlob } from "../draw/fill";
import { smoothPressure, strokeWidths } from "../draw/ink";
import { simplifyRdp } from "../draw/simplify";
import { MAX_SPRAY_POINTS, sprayAlong } from "../draw/spray";
import { gridFromConfig } from "../grid";
import { useStore, type SceneObj, type Tool } from "../store";
import { sendThrottled, wsClient } from "../ws";
import AoELayer from "./AoELayer";
import BackgroundLayer from "./BackgroundLayer";
import DrawLayer from "./DrawLayer";
import { markEraseDragged } from "./eraseFlag";
import GridLayer from "./GridLayer";
import OverlayLayer, { type Preview } from "./OverlayLayer";
import SelectionTransformer from "./SelectionTransformer";
import TokenContextMenu from "./TokenContextMenu";
import TokenLayer from "./TokenLayer";
import { getNode, registerNode } from "./nodeRegistry";
import { objectBounds } from "./objectBounds";

interface Point {
  x: number;
  y: number;
}

/** El preview del spray lleva también el radio de cada dot (OverlayLayer lo lee). */
type SprayPreview = Preview & { widths?: number[] };

/** Herramientas con las que Alt+click actúa como cuentagotas. */
const EYEDROP_TOOLS: Tool[] = ["pencil", "marker", "spray", "rect", "circle", "line", "arrow", "fill"];

/**
 * Índices de punto de `raw` que sobrevivieron en `kept`: los puntos que
 * devuelve el RDP son copias exactas (float) de los crudos, así que se
 * matchean por valor con un scan lineal desde el último hallazgo.
 */
function keptPointIndices(raw: number[], kept: number[]): number[] {
  const out: number[] = [];
  let j = 0; // offset (en valores) de raw desde donde seguir buscando
  for (let i = 0; i < kept.length; i += 2) {
    let found = -1;
    for (let k = j; k < raw.length; k += 2) {
      if (raw[k] === kept[i] && raw[k + 1] === kept[i + 1]) {
        found = k / 2;
        j = k + 2;
        break;
      }
    }
    out.push(found >= 0 ? found : (out[out.length - 1] ?? 0));
  }
  return out;
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
  const drawOpacity = useStore((s) => s.drawOpacity);
  const drawLineStyle = useStore((s) => s.drawLineStyle);
  const shapeFill = useStore((s) => s.shapeFill);
  const markerColor = useStore((s) => s.markerColor);
  const markerWidth = useStore((s) => s.markerWidth);
  const markerOpacity = useStore((s) => s.markerOpacity);
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
  // estabilizador: posición suavizada del pincel durante el trazo activo
  const brushPos = useRef<Point | null>(null);
  // muestras de presión crudas, una por punto capturado (lápiz + pressureWidth;
  // vacío = muestreo apagado)
  const pressureSamples = useRef<number[]>([]);
  // radios por dot del spray en curso (paralelo a preview.points)
  const sprayWidths = useRef<number[]>([]);
  // última posición desde la que se sembró spray
  const sprayLast = useRef<Point | null>(null);

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
    // con el editor de texto abierto no zoomeamos: quedaría desalineado
    if (useStore.getState().textEdit) return;
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

  /**
   * Presión del puntero: real si el PointerEvent la reporta (stylus/touch;
   * el mouse reporta 0.5 con botón apretado → no es presión real). Con mouse
   * se simula por velocidad: p = clamp(12 / (speed + 12), 0.15, 1), donde
   * speed = distancia desde la última muestra (en unidades de mundo).
   */
  const samplePressure = (e: Konva.KonvaEventObject<PointerEvent>, from: Point, to: Point): number => {
    const pe = e.evt;
    if (pe.pointerType !== "mouse" && pe.pressure > 0) {
      return Math.min(1, Math.max(0, pe.pressure));
    }
    const speed = Math.hypot(to.x - from.x, to.y - from.y);
    return Math.min(1, Math.max(0.15, 12 / (speed + 12)));
  };

  /** Restricción con Shift: línea/flecha a ángulos de 45°; rect/circle con w = h. */
  const shiftConstrain = (start: Point, cur: Point, t: Tool): Point => {
    const dx = cur.x - start.x;
    const dy = cur.y - start.y;
    if (t === "line" || t === "arrow") {
      const len = Math.hypot(dx, dy);
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      return { x: start.x + len * Math.cos(ang), y: start.y + len * Math.sin(ang) };
    }
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: start.x + Math.sign(dx || 1) * s, y: start.y + Math.sign(dy || 1) * s };
  };

  /** Cuentagotas (Alt+click): samplea el píxel del canvas compuesto y fija el color. */
  const tryEyedrop = (): boolean => {
    if (!EYEDROP_TOOLS.includes(tool)) return false;
    const stage = stageRef.current;
    const p = stage?.getPointerPosition();
    if (!stage || !p) return false;
    try {
      const ctx = stage.toCanvas({ pixelRatio: 1 }).getContext("2d");
      if (!ctx) return true;
      const d = ctx.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data;
      if (d[3] === 0) return true; // píxel transparente: ignorar
      const hex = `#${((1 << 24) | (d[0] << 16) | (d[1] << 8) | d[2]).toString(16).slice(1)}`;
      const st = useStore.getState();
      if (tool === "marker") st.setMarkerColor(hex);
      else st.setDrawColor(hex);
    } catch (err) {
      console.warn("cuentagotas falló:", err);
    }
    return true; // nunca iniciar trazo/forma/fill con Alt apretado
  };

  /** Balde de pintura: flood fill sobre el canvas compuesto → asset + image.add. */
  const runFill = async () => {
    try {
      const stage = stageRef.current;
      const p = stage?.getPointerPosition();
      if (!stage || !p) return;
      // la grilla no participa del fill: las líneas están todas conectadas y
      // click en una inundaría la red entera (además de acotar celdas)
      const gridLayer = getNode("grid");
      gridLayer?.visible(false);
      const shot = stage.toCanvas({ pixelRatio: 1 }); // sync: no hay repintado entre hide/show
      gridLayer?.visible(true);
      const ctx = shot.getContext("2d");
      if (!ctx) return;
      const img = ctx.getImageData(0, 0, shot.width, shot.height);
      const st = useStore.getState();
      const mask = floodFillMask(img, Math.round(p.x), Math.round(p.y), st.fillTolerance);
      if (!mask) return;
      // la opacidad se hornea en el PNG; data.opacity queda en su default
      const out = await maskToPngBlob(mask, img.width, img.height, st.drawColor, st.drawOpacity);
      if (!out || out.count < 100) return; // área ínfima: probablemente misclick
      // kind "fill": conserva el tamaño (≤4096 px) y el alfa, pero NO se
      // lista como mapa en la biblioteca (son artefactos de dibujo)
      const up = await uploadImage(st.token, out.blob, {
        kind: "fill",
        name: "relleno",
        filename: "relleno.png",
      });
      const scale = stage.scaleX();
      const data = {
        url: `/assets/${up.filename}`,
        x: (out.offsetX - stage.x()) / scale,
        y: (out.offsetY - stage.y()) / scale,
        w: out.width / scale,
        h: out.height / scale,
      };
      const id = optimisticAdd("image", data);
      wsClient.send("image.add", { id, data });
    } catch (err) {
      // el fill nunca debe romper el board
      console.warn("fill falló:", err);
    }
  };

  /**
   * Envía un trazo libre (pencil/marker/spray) aplicando simetría: el eje es
   * la vertical (y la horizontal, en "quad") que pasa por el centro del
   * viewport en coords de mundo. Con copias se manda UN "batch" de draw.add
   * (una sola entrada de undo); widths/blend/opacity/dash se copian igual.
   */
  const sendPath = (data: Record<string, any>) => {
    const symmetry = useStore.getState().symmetry;
    if (symmetry === "off") {
      const id = optimisticAdd("path", data);
      wsClient.send("draw.add", { id, data });
      return;
    }
    const stage = stageRef.current!;
    const cx = (stage.width() / 2 - stage.x()) / stage.scaleX();
    const cy = (stage.height() / 2 - stage.y()) / stage.scaleY();
    const pts: number[] = data.points;
    const flipX = pts.map((v, i) => (i % 2 === 0 ? 2 * cx - v : v));
    const flipY = (arr: number[]) => arr.map((v, i) => (i % 2 === 1 ? 2 * cy - v : v));
    const variants =
      symmetry === "mirror" ? [pts, flipX] : [pts, flipX, flipY(pts), flipY(flipX)];
    const ops: { type: string; payload: Record<string, any> }[] = [];
    for (const vpts of variants) {
      const d = { ...data, points: vpts };
      const id = optimisticAdd("path", d);
      ops.push({ type: "draw.add", payload: { id, data: d } });
    }
    wsClient.send("batch", { ops });
  };

  const onPointerDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
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
    // (bloqueado mientras se edita texto: el editor quedaría desalineado)
    if (e.evt.button === 2) {
      if (isEmptyTarget(e) && !useStore.getState().textEdit) {
        const p = stageRef.current!.getPointerPosition();
        if (p) {
          rightPan.current = { sx: p.x, sy: p.y, camX: camera.x, camY: camera.y };
        }
      }
      return;
    }
    if (e.evt.button !== 0) return;

    // Alt+click con herramienta de dibujo → cuentagotas (no inicia nada)
    if (e.evt.altKey && tryEyedrop()) return;

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
    if (tool === "pencil" || tool === "marker") {
      brushPos.current = pos;
      pressureSamples.current = [];
      if (tool === "pencil" && useStore.getState().pressureWidth) {
        pressureSamples.current.push(samplePressure(e, pos, pos));
      }
      setPreview({ tool, start: pos, current: pos, points: [pos.x, pos.y] });
      return;
    }
    if (tool === "spray") {
      // los dots se siembran en el move; un click sin arrastre es un cluster
      sprayWidths.current = [];
      sprayLast.current = pos;
      setPreview({ tool, start: pos, current: pos, points: [] });
      return;
    }
    if (tool === "fill") {
      void runFill(); // click-only: sin preview de arrastre
      return;
    }
    if (tool === "rect" || tool === "circle" || tool === "line" || tool === "arrow") {
      setPreview({ tool, start: pos, current: pos });
      return;
    }
    if (tool === "text") {
      // ya hay un editor abierto: el blur del textarea lo commitea
      if (useStore.getState().textEdit) return;
      // solo canvas vacío o el fondo del mapa; sobre tokens/dibujos/textos no
      // (esos tienen sus propios handlers; el doble click edita textos)
      if (!isEmptyTarget(e) && e.target.name() !== "background") return;
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

  const onPointerMove = (e: Konva.KonvaEventObject<PointerEvent>) => {
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
      if (preview.tool === "pencil" || preview.tool === "marker") {
        // estabilizador: el pincel persigue al puntero con un factor (1 - s)
        const stab = useStore.getState().stabilizer;
        let drawPos = pos;
        if (stab > 0 && brushPos.current) {
          brushPos.current = {
            x: brushPos.current.x + (pos.x - brushPos.current.x) * (1 - stab),
            y: brushPos.current.y + (pos.y - brushPos.current.y) * (1 - stab),
          };
          drawPos = brushPos.current;
        }
        const pts = preview.points ?? [];
        // adelgazado en captura: densidad ~constante en px de pantalla
        const minDist = Math.max(1.5, 2 / camera.scale);
        const dx = drawPos.x - pts[pts.length - 2];
        const dy = drawPos.y - pts[pts.length - 1];
        if (dx * dx + dy * dy >= minDist * minDist) {
          if (pressureSamples.current.length > 0) {
            const last = { x: pts[pts.length - 2], y: pts[pts.length - 1] };
            pressureSamples.current.push(samplePressure(e, last, drawPos));
          }
          setPreview({ ...preview, current: pos, points: [...pts, drawPos.x, drawPos.y] });
        }
      } else if (preview.tool === "spray") {
        const st = useStore.getState();
        const last = sprayLast.current ?? pos;
        let pts = preview.points ?? [];
        // siembra dots hasta el techo; después el preview sigue el puntero
        const room = MAX_SPRAY_POINTS - sprayWidths.current.length;
        if (room > 0) {
          const seg = sprayAlong(last.x, last.y, pos.x, pos.y, st.drawWidth);
          const take = Math.min(room, seg.widths.length);
          if (take > 0) {
            pts = [...pts, ...seg.points.slice(0, take * 2)];
            sprayWidths.current = [...sprayWidths.current, ...seg.widths.slice(0, take)];
          }
        }
        sprayLast.current = pos;
        const next: SprayPreview = {
          ...preview,
          current: pos,
          points: pts,
          widths: sprayWidths.current,
        };
        setPreview(next);
      } else {
        // Shift: cuadrado/círculo perfecto, líneas a 45°
        const cur =
          (preview.tool === "rect" ||
            preview.tool === "circle" ||
            preview.tool === "line" ||
            preview.tool === "arrow") &&
          e.evt.shiftKey
            ? shiftConstrain(preview.start, pos, preview.tool)
            : pos;
        setPreview({ ...preview, current: cur });
      }
      return;
    }
    const measure = useStore.getState().measure;
    if (tool === "measure" && measureDragging.current && measure) {
      setMeasure({ ...measure, bx: pos.x, by: pos.y });
    }
  };

  const onPointerUp = (e: Konva.KonvaEventObject<PointerEvent>) => {
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
    let final = preview;
    // con estabilizador el pincel queda atrás: cerrar el trazo donde el
    // usuario levantó el puntero (posición cruda, antes del RDP)
    if (
      (preview.tool === "pencil" || preview.tool === "marker") &&
      useStore.getState().stabilizer > 0 &&
      stageRef.current?.getPointerPosition()
    ) {
      const pos = worldPos();
      const pts = preview.points ?? [];
      if (pressureSamples.current.length > 0 && pts.length >= 2) {
        const last = { x: pts[pts.length - 2], y: pts[pts.length - 1] };
        pressureSamples.current.push(samplePressure(e, last, pos));
      }
      final = { ...preview, current: pos, points: [...pts, pos.x, pos.y] };
    }
    brushPos.current = null;
    finishPreview(final);
    setPreview(null);
  };

  // ---- borrador parcial: corta los puntos del trazo bajo el cursor -----------

  const finishEraseStroke = (stroke: Point[]) => {
    if (stroke.length < 2) return; // click simple: lo maneja el onClick del objeto
    markEraseDragged();

    const st = useStore.getState();
    const radius = st.eraserWidth / st.camera.scale;
    const clientId = st.clientId;
    const isDm = st.role === "dm";
    // todo el borrado se manda como "batch" (1–16 sub-ops por batch, una
    // sola entrada de undo); los cambios locales son optimistas como siempre
    const ops: { type: string; payload: Record<string, any> }[] = [];

    for (const obj of Object.values(st.objects)) {
      if (obj.type !== "path") continue;
      if (!isDm && obj.owner !== clientId) continue;
      const pts: number[] = obj.data.points ?? [];
      const ox = obj.data.x ?? 0;
      const oy = obj.data.y ?? 0;
      const halfWidth = (obj.data.width ?? 4) / 2;

      // el trazo del borrador pasa a coords LOCALES del path. Mundo =
      // (ox,oy) + rot(rotation)·scale·punto  →  local = scale⁻¹·rot⁻¹·(mundo-(ox,oy))
      const rot = obj.data.rotation ?? 0;
      const sx = obj.data.scaleX ?? 1;
      const sy = obj.data.scaleY ?? 1;
      const rad = (-rot * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const localStroke = stroke.map((p) => {
        const dx = p.x - ox;
        const dy = p.y - oy;
        const rx = dx * cos - dy * sin;
        const ry = dx * sin + dy * cos;
        return { x: rx / sx, y: ry / sy };
      });

      // el radio del borrador también pasa a local (escala distinta por eje
      // → test elíptico)
      const er = radius + halfWidth;
      const erx = er / sx;
      const ery = er / sy;
      const isErased = (px: number, py: number): boolean => {
        for (const p of localStroke) {
          const ddx = p.x - px;
          const ddy = p.y - py;
          if ((ddx * ddx) / (erx * erx) + (ddy * ddy) / (ery * ery) < 1) return true;
        }
        return false;
      };

      // spray: se borran los DOTS bajo el cursor (no hay runs que cortar)
      if (obj.data.spray) {
        const keptPts: number[] = [];
        const keptW: number[] = [];
        for (let i = 0; i < pts.length; i += 2) {
          if (!isErased(pts[i], pts[i + 1])) {
            keptPts.push(pts[i], pts[i + 1]);
            if (obj.data.widths) keptW.push(obj.data.widths[i / 2]);
          }
        }
        if (keptPts.length === pts.length) continue; // no se tocó
        st.removeObjectLocal(obj.id);
        ops.push({ type: "draw.remove", payload: { id: obj.id } });
        if (keptPts.length >= 2) {
          const data = {
            ...obj.data,
            points: keptPts,
            ...(obj.data.widths ? { widths: keptW } : {}),
          };
          const newId = optimisticAdd("path", data);
          ops.push({ type: "draw.add", payload: { id: newId, data } });
        }
        continue;
      }

      // runs de puntos que sobreviven
      const widths: number[] | undefined = obj.data.widths;
      const runs: number[][] = [];
      const widthRuns: number[][] = [];
      let current: number[] = [];
      let currentW: number[] = [];
      for (let i = 0; i < pts.length; i += 2) {
        if (isErased(pts[i], pts[i + 1])) {
          if (current.length >= 4) {
            runs.push(current);
            widthRuns.push(currentW);
          }
          current = [];
          currentW = [];
        } else {
          current.push(pts[i], pts[i + 1]);
          if (widths) currentW.push(widths[i / 2]);
        }
      }
      if (current.length >= 4) {
        runs.push(current);
        widthRuns.push(currentW);
      }

      const totalKept = runs.reduce((n, r) => n + r.length, 0);
      if (totalKept === pts.length) continue; // no se tocó

      st.removeObjectLocal(obj.id);
      ops.push({ type: "draw.remove", payload: { id: obj.id } });
      for (let ri = 0; ri < runs.length; ri++) {
        const data = {
          x: ox,
          y: oy,
          points: runs[ri],
          color: obj.data.color,
          width: obj.data.width,
          rotation: rot,
          scaleX: sx,
          scaleY: sy,
          // heredar estilo del trazo original
          ...(obj.data.opacity != null ? { opacity: obj.data.opacity } : {}),
          ...(obj.data.dash ? { dash: true } : {}),
          ...(obj.data.blend ? { blend: obj.data.blend } : {}),
          ...(widths ? { widths: widthRuns[ri] } : {}),
        };
        const newId = optimisticAdd("path", data);
        ops.push({ type: "draw.add", payload: { id: newId, data } });
      }
    }

    // el server valida batches de 1–16 sub-ops: trocear si hace falta
    for (let i = 0; i < ops.length; i += 16) {
      wsClient.send("batch", { ops: ops.slice(i, i + 16) });
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
      const b = objectBounds(o, gridConfig.cellSize);
      if (b.maxX >= rx && b.minX <= rx + rw && b.maxY >= ry && b.minY <= ry + rh) {
        hits.push(o.id);
      }
    }
    setSelection(hits);
  };

  const finishPreview = (p: Preview) => {
    const dx = p.current.x - p.start.x;
    const dy = p.current.y - p.start.y;
    const distPx = Math.hypot(dx, dy);
    const blendMode = useStore.getState().blendMode;

    // estilo opcional de formas (se omite cuando es el default)
    const style: Record<string, any> = {};
    if (drawOpacity < 1) style.opacity = drawOpacity;
    if (drawLineStyle === "dash") style.dash = true;
    if (blendMode !== "normal") style.blend = blendMode;

    if (p.tool === "pencil" || p.tool === "marker") {
      const raw = p.points ?? [];
      if (raw.length >= 2) {
        // un click = 1 punto (2 valores) → puntito; un trazo = varios
        // simplificación RDP con epsilon relativo a pantalla; si dejara < 2
        // puntos conservamos el trazo adelgazado sin simplificar
        const simplified = simplifyRdp(raw, 0.75 / camera.scale);
        const points = simplified.length < 4 && raw.length >= 4 ? raw : simplified;
        const isMarker = p.tool === "marker";
        const opacity = isMarker ? markerOpacity : drawOpacity;
        const data: Record<string, any> = {
          x: 0,
          y: 0,
          points,
          color: isMarker ? markerColor : drawColor,
          width: isMarker ? markerWidth : drawWidth,
        };
        if (opacity < 1) data.opacity = opacity;
        if (!isMarker && drawLineStyle === "dash") data.dash = true; // el marcador nunca dashea
        if (blendMode !== "normal") data.blend = blendMode;
        // ancho variable (solo lápiz): widths alineados a los puntos FINALES
        // (post-RDP) vía los índices crudos que sobrevivieron
        const samples = pressureSamples.current;
        pressureSamples.current = [];
        if (!isMarker && useStore.getState().pressureWidth && points.length / 2 <= 4000) {
          let lo = Infinity;
          let hi = -Infinity;
          for (const s of samples) {
            if (s < lo) lo = s;
            if (s > hi) hi = s;
          }
          if (samples.length >= 3 && samples.length === raw.length / 2 && hi - lo > 0.01) {
            const smoothed = smoothPressure(samples);
            const kept = keptPointIndices(raw, points);
            data.widths = strokeWidths(
              points,
              drawWidth,
              kept.map((ki) => smoothed[ki]),
            );
          }
        }
        sendPath(data);
      }
      return;
    }

    if (p.tool === "spray") {
      let pts = p.points ?? [];
      let ws = sprayWidths.current;
      sprayWidths.current = [];
      sprayLast.current = null;
      if (ws.length === 0) {
        // click sin arrastre: cluster de ~8 dots alrededor del click
        pts = [];
        ws = [];
        for (let i = 0; i < 8; i++) {
          const ang = Math.random() * Math.PI * 2;
          const rr = drawWidth * Math.sqrt(Math.random());
          pts.push(p.start.x + rr * Math.cos(ang), p.start.y + rr * Math.sin(ang));
          ws.push(drawWidth * (0.15 + Math.random() * 0.25));
        }
      }
      if (pts.length >= 2) {
        const data: Record<string, any> = {
          x: 0,
          y: 0,
          points: pts,
          widths: ws,
          color: drawColor,
          width: drawWidth,
          spray: true,
        };
        if (drawOpacity < 1) data.opacity = drawOpacity;
        if (blendMode !== "normal") data.blend = blendMode;
        sendPath(data);
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
        ...(p.tool === "aoe-cone" ? { angle: useStore.getState().aoeAngle } : {}),
        ...(p.tool === "aoe-line" ? { width_px: drawWidth } : {}),
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
              ...style,
              ...(shapeFill ? { filled: true } : {}),
            }
          : {
              shape: "circle",
              x: (p.start.x + p.current.x) / 2,
              y: (p.start.y + p.current.y) / 2,
              w: Math.abs(dx),
              h: Math.abs(dy),
              color: drawColor,
              width: drawWidth,
              ...style,
              ...(shapeFill ? { filled: true } : {}),
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
        ...style,
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
        draggable={tool === "pan" && !textEdit}
        onDragEnd={onStageDragEnd}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
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
        {/* capa del handle de rotación (necesita listening, OverlayLayer no lo tiene) */}
        <Layer>
          <SelectionTransformer />
        </Layer>
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


