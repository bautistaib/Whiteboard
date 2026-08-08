import { useEffect } from "react";
import Board from "../components/Board";
import LibraryPanel from "../components/LibraryPanel";
import SceneTabs from "../components/SceneTabs";
import Toolbar, { TOOLS } from "../components/Toolbar";
import TunnelBanner from "../components/TunnelBanner";
import { gridFromConfig } from "../grid";
import { useStore, type Tool } from "../store";
import { wsClient } from "../ws";

// derivado de TOOLS (Toolbar.tsx) para no duplicar las teclas
const TOOL_KEYS: Record<string, Tool> = Object.fromEntries(
  TOOLS.map((t) => [t.key.toLowerCase(), t.id]),
);

export default function BoardPage() {
  const token = useStore((s) => s.token);
  const name = useStore((s) => s.name);
  const clientId = useStore((s) => s.clientId);
  const connected = useStore((s) => s.connected);
  const campaignName = useStore((s) => s.campaignName);
  const role = useStore((s) => s.role);
  const tunnelUrl = useStore((s) => s.tunnelUrl);
  const tunnelBannerOpen = useStore((s) => s.tunnelBannerOpen);
  const setTunnelBannerOpen = useStore((s) => s.setTunnelBannerOpen);
  const fatalReason = useStore((s) => s.fatalReason);

  useEffect(() => {
    wsClient.connect(token, name, clientId);
    return () => wsClient.disconnect();
  }, [token, name, clientId]);

  // atajos de teclado globales
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      const st = useStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        wsClient.send(e.shiftKey ? "redo" : "undo");
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelection();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        for (const id of st.selection) {
          const obj = st.objects[id];
          if (!obj) continue;
          wsClient.send(`${prefixOf(obj.type)}.remove`, { id });
        }
        st.setSelection([]);
      } else if (e.key === "Escape") {
        // Esc → modo agarrar (pan) y limpia selección
        st.setTool("pan");
        st.setSelection([]);
        st.setContextMenu(null);
      } else if (e.altKey && e.key === "ArrowLeft" && st.previousSceneId) {
        e.preventDefault();
        wsClient.send("scene.switch", { sceneId: st.previousSceneId });
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = TOOL_KEYS[e.key.toLowerCase()];
        if (t) st.setTool(t);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (fatalReason) {
    return (
      <div className="home">
        <h1>Sesión terminada</h1>
        <p className="error">{fatalReason}</p>
      </div>
    );
  }

  return (
    <div className="board-page">
      <div className="topbar">
        <span className="campaign-name">{campaignName || "…"}</span>
        {role === "dm" && <span className="badge-dm">DM</span>}
        <SceneTabs />
        {role === "dm" && tunnelUrl && !tunnelBannerOpen && (
          <button className="mini" title="Mostrar el link para compartir" onClick={() => setTunnelBannerOpen(true)}>
            🔗 Link
          </button>
        )}
        <span className={`conn ${connected ? "ok" : "off"}`}>
          {connected ? "conectado" : "reconectando…"}
        </span>
      </div>
      <TunnelBanner />
      <div className="board-main">
        <Toolbar />
        <Board />
        <LibraryPanel />
      </div>
    </div>
  );
}

export function prefixOf(objType: string): string {
  switch (objType) {
    case "token":
      return "token";
    case "path":
      return "draw";
    case "shape":
      return "shape";
    case "text":
      return "text";
    default:
      return "aoe";
  }
}

/** Ctrl+D: clona cada token seleccionado en una celda contigua libre. */
export function duplicateSelection() {
  duplicateTokens(useStore.getState().selection);
}

/**
 * Clona los tokens dados en celdas libres cercanas.
 * Las celdas se calculan con el GridSystem activo (snap/cellOf), así funciona
 * igual en grilla cuadrada y hexagonal; el set de ocupadas es compartido,
 * así dos clones nunca caen en la misma celda.
 */
export function duplicateTokens(ids: string[]) {
  const st = useStore.getState();
  const { grid, objects } = st;
  const g = gridFromConfig(grid);
  const cell = grid.cellSize;
  const keyOf = (p: { x: number; y: number }) => {
    const c = g.cellOf(p);
    return `${c[0]},${c[1]}`;
  };
  const occupied = new Set(
    Object.values(objects)
      .filter((o) => o.type === "token")
      .map((o) => keyOf({ x: o.data.x ?? 0, y: o.data.y ?? 0 })),
  );
  for (const id of ids) {
    const obj = objects[id];
    if (!obj || obj.type !== "token") continue;
    const x = obj.data.x ?? 0;
    const y = obj.data.y ?? 0;
    // buscar la celda libre más cercana (anillos alrededor del token)
    let placed: { x: number; y: number } | null = null;
    outer: for (const ring of [1, 2, 3]) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const candidate = g.snap({ x: x + dx * cell, y: y + dy * cell });
          const key = keyOf(candidate);
          if (!occupied.has(key)) {
            placed = candidate;
            occupied.add(key);
            break outer;
          }
        }
      }
    }
    wsClient.send("token.duplicate", {
      id,
      newId: crypto.randomUUID(),
      x: placed?.x ?? x + cell,
      y: placed?.y ?? y,
    });
  }
}
