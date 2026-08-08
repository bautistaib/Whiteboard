import { create } from "zustand";
import { defaultGridConfig, normalizeGridConfig } from "./grid";
import type { GridConfig } from "./grid";

/** Lectura/escritura segura de localStorage (nunca rompe si no está disponible). */
export function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function lsSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // almacenamiento no disponible: se ignora
  }
}

function initialDrawColor(): string {
  const c = lsGet("ttrpg:drawColor");
  return c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#ff5252";
}

function initialDrawWidth(): number {
  const n = Number(lsGet("ttrpg:drawWidth"));
  return Number.isFinite(n) && n >= 1 && n <= 40 ? n : 4;
}

function initialDrawOpacity(): number {
  const n = Number(lsGet("ttrpg:drawOpacity"));
  return Number.isFinite(n) && n >= 0.1 && n <= 1 ? n : 1;
}

function initialDrawLineStyle(): LineStyle {
  return lsGet("ttrpg:drawLineStyle") === "dash" ? "dash" : "solid";
}

function initialShapeFill(): boolean {
  return lsGet("ttrpg:shapeFill") === "1";
}

function initialEraserWidth(): number {
  const n = Number(lsGet("ttrpg:eraserWidth"));
  return Number.isFinite(n) && n >= 2 && n <= 64 ? n : 10;
}

function initialMarkerColor(): string {
  const c = lsGet("ttrpg:markerColor");
  return c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#ffeb3b";
}

function initialMarkerWidth(): number {
  const n = Number(lsGet("ttrpg:markerWidth"));
  return Number.isFinite(n) && n >= 4 && n <= 40 ? n : 14;
}

function initialMarkerOpacity(): number {
  const n = Number(lsGet("ttrpg:markerOpacity"));
  return Number.isFinite(n) && n >= 0.1 && n <= 1 ? n : 0.45;
}

function initialBool(key: string, def: boolean): boolean {
  const v = lsGet(key);
  return v === null ? def : v === "1";
}

function initialAdvancedMode(): boolean {
  return initialBool("ttrpg:advancedMode", false);
}

function initialStabilizer(): number {
  const n = Number(lsGet("ttrpg:stabilizer"));
  return Number.isFinite(n) && n >= 0 && n <= 0.9 ? n : 0;
}

function initialPressureWidth(): boolean {
  return initialBool("ttrpg:pressureWidth", false);
}

function initialBlendMode(): BlendMode {
  const v = lsGet("ttrpg:blendMode");
  return v === "multiply" || v === "screen" ? v : "normal";
}

function initialSymmetry(): SymmetryMode {
  const v = lsGet("ttrpg:symmetry");
  return v === "mirror" || v === "quad" ? v : "off";
}

function initialFillTolerance(): number {
  const n = Number(lsGet("ttrpg:fillTolerance"));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 32;
}

export type Role = "dm" | "player";

export type LineStyle = "solid" | "dash";

/** Modo de mezcla al renderizar (globalCompositeOperation de Konva). */
export type BlendMode = "normal" | "multiply" | "screen";

/** Simetría al crear trazos: espejo vertical (viewport) o cuádruple. */
export type SymmetryMode = "off" | "mirror" | "quad";

export interface SceneObj {
  id: string;
  type: string; // token | path | shape | text | aoe | group
  z: number;
  owner: string;
  data: Record<string, any>;
}

export interface AssetInfo {
  id: string;
  filename: string;
  kind: string; // token | map | other
  uploadedBy: string;
}

export interface CharacterInfo {
  id: string;
  name: string;
}

export interface VariantInfo {
  id: string;
  characterId: string;
  assetId: string;
  label: string;
  sizeCells: number;
}

export interface Library {
  assets: AssetInfo[];
  characters: CharacterInfo[];
  variants: VariantInfo[];
}

export interface SceneSummary {
  id: string;
  name: string;
  isActive: boolean;
}

export interface UserInfo {
  clientId: string;
  name: string;
  role: Role;
}

export interface PingInfo {
  id: number;
  x: number;
  y: number;
  name: string;
}

export type Tool =
  | "select"
  | "pan"
  | "pencil"
  | "marker"
  | "spray"
  | "fill"
  | "rect"
  | "circle"
  | "line"
  | "arrow"
  | "text"
  | "eraser"
  | "measure"
  | "aoe-circle"
  | "aoe-cone"
  | "aoe-line";

interface Camera {
  x: number;
  y: number;
  scale: number;
}

export const BADGE_PRESETS = [
  { emoji: "☠️", label: "Veneno", color: "#4caf50" },
  { emoji: "🔥", label: "Quemando", color: "#ff5722" },
  { emoji: "🧊", label: "Congelado", color: "#03a9f4" },
  { emoji: "💤", label: "Dormido", color: "#9c27b0" },
  { emoji: "👁️", label: "Invisible", color: "#607d8b" },
  { emoji: "⬇️", label: "Caído", color: "#795548" },
  { emoji: "✨", label: "Bendito", color: "#ffc107" },
  { emoji: "🩸", label: "Sangrando", color: "#e91e63" },
];

let pingSeq = 1;

interface BoardState {
  // sesión
  token: string;
  role: Role;
  name: string;
  clientId: string;
  campaignName: string;
  connected: boolean;
  snapshotReceived: boolean;
  /** cierre fatal del WS (link inválido o campaña borrada): no reconectar */
  fatalReason: string | null;

  // escena
  sceneId: string;
  sceneName: string;
  grid: GridConfig;
  backgroundAssetId: string | null;
  scenes: SceneSummary[];
  objects: Record<string, SceneObj>;
  users: UserInfo[];
  cursors: Record<string, { x: number; y: number; name: string }>;
  pings: PingInfo[];
  library: Library;
  tunnelUrl: string | null;

  // local UI
  camera: Camera;
  followDm: boolean;
  tool: Tool;
  drawColor: string;
  drawWidth: number;
  drawOpacity: number;
  drawLineStyle: LineStyle;
  /** relleno de formas cerradas (rect/circle) */
  shapeFill: boolean;
  eraserWidth: number;
  markerColor: string;
  markerWidth: number;
  markerOpacity: number;
  /** modo avanzado de dibujo: muestra herramientas/opciones extra */
  advancedMode: boolean;
  /** fuerza del estabilizador de trazo (0 = apagado) */
  stabilizer: number;
  /** ancho variable por presión (stylus) o velocidad (mouse) */
  pressureWidth: boolean;
  blendMode: BlendMode;
  symmetry: SymmetryMode;
  /** tolerancia del balde de pintura (0–100) */
  fillTolerance: number;
  /** apertura del cono AoE (grados) */
  aoeAngle: number;
  selection: string[];
  contextMenu: { objId: string; x: number; y: number } | null;
  measure: { ax: number; ay: number; bx: number; by: number } | null;
  /** editor de texto inline: worldX/worldY + valor; editId si edita uno existente */
  textEdit: { worldX: number; worldY: number; value: string; editId?: string } | null;
  /** panel de opciones de herramienta visible/oculto */
  toolOptionsOpen: boolean;
  /** DM: edición del fondo de mapa desbloqueada (transform) */
  backgroundUnlocked: boolean;
  /** escena anterior (para volver con Alt+Izq) */
  previousSceneId: string | null;
  /** banner del túnel visible (DM) */
  tunnelBannerOpen: boolean;

  // acciones
  setSession: (s: Partial<BoardState>) => void;
  applySnapshot: (msg: any) => void;
  applyServerOp: (op: any) => void;
  applyPresence: (users: UserInfo[]) => void;
  applyCursor: (clientId: string, x: number, y: number) => void;
  addPing: (x: number, y: number, name: string) => void;
  removePing: (id: number) => void;
  setSceneUpdate: (msg: any) => void;
  setLibrary: (lib: Library) => void;
  setTunnelUrl: (url: string | null) => void;
  setCamera: (cam: Camera) => void;
  setFollowDm: (v: boolean) => void;
  setTool: (t: Tool) => void;
  setDrawColor: (c: string) => void;
  setDrawWidth: (w: number) => void;
  setDrawOpacity: (o: number) => void;
  setDrawLineStyle: (s: LineStyle) => void;
  setShapeFill: (v: boolean) => void;
  setEraserWidth: (w: number) => void;
  setMarkerColor: (c: string) => void;
  setMarkerWidth: (w: number) => void;
  setMarkerOpacity: (o: number) => void;
  setAdvancedMode: (v: boolean) => void;
  setStabilizer: (v: number) => void;
  setPressureWidth: (v: boolean) => void;
  setBlendMode: (v: BlendMode) => void;
  setSymmetry: (v: SymmetryMode) => void;
  setFillTolerance: (v: number) => void;
  setAoeAngle: (a: number) => void;
  setSelection: (ids: string[]) => void;
  toggleSelected: (id: string) => void;
  setContextMenu: (m: { objId: string; x: number; y: number } | null) => void;
  setMeasure: (m: BoardState["measure"]) => void;
  setTextEdit: (t: BoardState["textEdit"]) => void;
  setToolOptionsOpen: (v: boolean) => void;
  setBackgroundUnlocked: (v: boolean) => void;
  setPreviousSceneId: (id: string | null) => void;
  setTunnelBannerOpen: (v: boolean) => void;
  updateObjectLocal: (id: string, patch: Record<string, any>) => void;
  /** Alta optimista: el objeto aparece ya; el eco del server (mismo uuid) lo pisa. */
  addObjectLocal: (obj: SceneObj) => void;
  removeObjectLocal: (id: string) => void;
}

export const useStore = create<BoardState>((set, get) => ({
  token: "",
  role: "player",
  name: "",
  clientId: "",
  campaignName: "",
  connected: false,
  snapshotReceived: false,
  fatalReason: null,

  sceneId: "",
  sceneName: "",
  grid: defaultGridConfig(),
  backgroundAssetId: null,
  scenes: [],
  objects: {},
  users: [],
  cursors: {},
  pings: [],
  library: { assets: [], characters: [], variants: [] },
  tunnelUrl: null,

  camera: { x: 0, y: 0, scale: 1 },
  followDm: false,
  tool: "select",
  drawColor: initialDrawColor(),
  drawWidth: initialDrawWidth(),
  drawOpacity: initialDrawOpacity(),
  drawLineStyle: initialDrawLineStyle(),
  shapeFill: initialShapeFill(),
  eraserWidth: initialEraserWidth(),
  markerColor: initialMarkerColor(),
  markerWidth: initialMarkerWidth(),
  markerOpacity: initialMarkerOpacity(),
  advancedMode: initialAdvancedMode(),
  stabilizer: initialStabilizer(),
  pressureWidth: initialPressureWidth(),
  blendMode: initialBlendMode(),
  symmetry: initialSymmetry(),
  fillTolerance: initialFillTolerance(),
  aoeAngle: 60,
  selection: [],
  contextMenu: null,
  measure: null,
  textEdit: null,
  toolOptionsOpen: true,
  backgroundUnlocked: false,
  previousSceneId: null,
  tunnelBannerOpen: true,

  setSession: (s) => set(s),

  applySnapshot: (msg) => {
    const objects: Record<string, SceneObj> = {};
    for (const o of msg.objects) objects[o.id] = o;
    set({
      snapshotReceived: true,
      connected: true,
      campaignName: msg.campaign.name,
      sceneId: msg.scene.id,
      sceneName: msg.scene.name,
      grid: normalizeGridConfig(msg.scene.grid),
      backgroundAssetId: msg.scene.backgroundAssetId ?? null,
      scenes: msg.scenes,
      objects,
      users: msg.users,
      library: msg.library,
      selection: [],
      pings: [],
      measure: null,
    });
  },

  applyServerOp: (op) => {
    const { type, payload } = op;
    // batch: aplica sub-ops en orden (una sola entrada de undo en el server)
    if (type === "batch") {
      const subs: { type: string; payload: any }[] = payload?.ops ?? [];
      for (const sub of subs) {
        get().applyServerOp({ ...sub, author: op.author, clientId: op.clientId });
      }
      return;
    }
    const dot = type.indexOf(".");
    if (dot < 0) return;
    const action = type.slice(dot + 1);
    set((st) => {
      const objects = { ...st.objects };
      if (action === "add" || action === "duplicate") {
        const objType =
          type.startsWith("token") ? "token"
          : type.startsWith("draw") ? "path"
          : type.startsWith("shape") ? "shape"
          : type.startsWith("text") ? "text"
          : type.startsWith("group") ? "group"
          : type.startsWith("image") ? "image"
          : "aoe";
        objects[payload.id] = {
          id: payload.id,
          type: objType,
          z: payload.z_index ?? 0,
          owner: op.clientId ?? "",
          data: payload.data ?? {},
        };
      } else if (action === "remove") {
        delete objects[payload.id];
      } else if (action === "move") {
        const o = objects[payload.id];
        if (o) objects[payload.id] = { ...o, data: { ...o.data, x: payload.x, y: payload.y } };
      } else if (action === "update") {
        const o = objects[payload.id];
        if (o) objects[payload.id] = { ...o, data: { ...o.data, ...(payload.patch ?? {}) } };
      } else if (action === "restore") {
        const o = objects[payload.id];
        if (o) objects[payload.id] = { ...o, data: payload.data ?? {} };
      } else if (action === "setVariant") {
        const o = objects[payload.id];
        if (o) objects[payload.id] = { ...o, data: { ...o.data, ...(payload.data ?? {}) } };
      }
      return { objects };
    });
  },

  applyPresence: (users) =>
    set((st) => {
      const cursors = { ...st.cursors };
      const ids = new Set(users.map((u) => u.clientId));
      for (const id of Object.keys(cursors)) {
        if (!ids.has(id)) delete cursors[id];
      }
      return { users, cursors };
    }),

  applyCursor: (clientId, x, y) =>
    set((st) => {
      const user = st.users.find((u) => u.clientId === clientId);
      if (!user) return st;
      return { cursors: { ...st.cursors, [clientId]: { x, y, name: user.name } } };
    }),

  addPing: (x, y, name) => {
    const id = pingSeq++;
    set((st) => ({ pings: [...st.pings, { id, x, y, name }] }));
    setTimeout(() => get().removePing(id), 3000);
  },

  removePing: (id) => set((st) => ({ pings: st.pings.filter((p) => p.id !== id) })),

  setSceneUpdate: (msg) =>
    set((st) => ({
      scenes: msg.scenes,
      sceneId: msg.scene.id,
      sceneName: msg.scene.name,
      grid: normalizeGridConfig(msg.scene.grid),
      backgroundAssetId: msg.scene.backgroundAssetId ?? null,
      // la escena a la que apunta Alt+Izq pudo haberse borrado
      previousSceneId: msg.scenes.some((s: SceneSummary) => s.id === st.previousSceneId)
        ? st.previousSceneId
        : null,
    })),

  setLibrary: (lib) => set({ library: lib }),
  setTunnelUrl: (url) => set({ tunnelUrl: url }),

  setCamera: (cam) => set({ camera: cam }),
  setFollowDm: (v) => set({ followDm: v }),
  setTool: (t) => set({ tool: t, selection: [], contextMenu: null, measure: null, toolOptionsOpen: true }),
  setDrawColor: (c) => {
    lsSet("ttrpg:drawColor", c);
    set({ drawColor: c });
  },
  setDrawWidth: (w) => {
    lsSet("ttrpg:drawWidth", String(w));
    set({ drawWidth: w });
  },
  setDrawOpacity: (o) => {
    lsSet("ttrpg:drawOpacity", String(o));
    set({ drawOpacity: o });
  },
  setDrawLineStyle: (s) => {
    lsSet("ttrpg:drawLineStyle", s);
    set({ drawLineStyle: s });
  },
  setShapeFill: (v) => {
    lsSet("ttrpg:shapeFill", v ? "1" : "0");
    set({ shapeFill: v });
  },
  setEraserWidth: (w) => {
    lsSet("ttrpg:eraserWidth", String(w));
    set({ eraserWidth: w });
  },
  setMarkerColor: (c) => {
    lsSet("ttrpg:markerColor", c);
    set({ markerColor: c });
  },
  setMarkerWidth: (w) => {
    lsSet("ttrpg:markerWidth", String(w));
    set({ markerWidth: w });
  },
  setMarkerOpacity: (o) => {
    lsSet("ttrpg:markerOpacity", String(o));
    set({ markerOpacity: o });
  },
  setAdvancedMode: (v) => {
    lsSet("ttrpg:advancedMode", v ? "1" : "0");
    set({ advancedMode: v });
  },
  setStabilizer: (v) => {
    lsSet("ttrpg:stabilizer", String(v));
    set({ stabilizer: v });
  },
  setPressureWidth: (v) => {
    lsSet("ttrpg:pressureWidth", v ? "1" : "0");
    set({ pressureWidth: v });
  },
  setBlendMode: (v) => {
    lsSet("ttrpg:blendMode", v);
    set({ blendMode: v });
  },
  setSymmetry: (v) => {
    lsSet("ttrpg:symmetry", v);
    set({ symmetry: v });
  },
  setFillTolerance: (v) => {
    lsSet("ttrpg:fillTolerance", String(v));
    set({ fillTolerance: v });
  },
  setAoeAngle: (a) => set({ aoeAngle: a }),

  setSelection: (ids) => set({ selection: ids }),
  toggleSelected: (id) =>
    set((st) => ({
      selection: st.selection.includes(id)
        ? st.selection.filter((s) => s !== id)
        : [...st.selection, id],
    })),
  setContextMenu: (m) => set({ contextMenu: m }),
  setMeasure: (m) => set({ measure: m }),
  setTextEdit: (t) => set({ textEdit: t }),
  setToolOptionsOpen: (v) => set({ toolOptionsOpen: v }),
  setBackgroundUnlocked: (v) => set({ backgroundUnlocked: v }),
  setPreviousSceneId: (id) => set({ previousSceneId: id }),
  setTunnelBannerOpen: (v) => set({ tunnelBannerOpen: v }),

  addObjectLocal: (obj) =>
    set((st) => ({ objects: { ...st.objects, [obj.id]: obj } })),

  removeObjectLocal: (id) =>
    set((st) => {
      const objects = { ...st.objects };
      delete objects[id];
      return { objects };
    }),

  updateObjectLocal: (id, patch) =>
    set((st) => {
      const o = st.objects[id];
      if (!o) return st;
      return { objects: { ...st.objects, [id]: { ...o, data: { ...o.data, ...patch } } } };
    }),
}));

/** GridSystem activo, derivado del config de la escena. */
export function useGrid() {
  const grid = useStore((s) => s.grid);
  return grid;
}

export function sortedObjects(objects: Record<string, SceneObj>): SceneObj[] {
  return Object.values(objects).sort((a, b) => a.z - b.z);
}
