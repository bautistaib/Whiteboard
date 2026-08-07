import { useEffect } from "react";
import Board from "../components/Board";
import LibraryPanel from "../components/LibraryPanel";
import SceneTabs from "../components/SceneTabs";
import Toolbar from "../components/Toolbar";
import TunnelBanner from "../components/TunnelBanner";
import { useStore } from "../store";
import { wsClient } from "../ws";

export default function BoardPage() {
  const token = useStore((s) => s.token);
  const name = useStore((s) => s.name);
  const clientId = useStore((s) => s.clientId);
  const connected = useStore((s) => s.connected);
  const campaignName = useStore((s) => s.campaignName);
  const role = useStore((s) => s.role);

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
        st.setSelection([]);
        st.setContextMenu(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="board-page">
      <div className="topbar">
        <span className="campaign-name">{campaignName || "…"}</span>
        {role === "dm" && <span className="badge-dm">DM</span>}
        <SceneTabs />
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
  const st = useStore.getState();
  const { grid, objects, selection } = st;
  const cell = grid.cellSize;
  for (const id of selection) {
    const obj = objects[id];
    if (!obj || obj.type !== "token") continue;
    const x = obj.data.x ?? 0;
    const y = obj.data.y ?? 0;
    // buscar celda contigua libre (derecha, abajo, izquierda, arriba, …)
    const occupied = new Set(
      Object.values(objects)
        .filter((o) => o.type === "token")
        .map((o) => `${Math.round(o.data.x / cell)},${Math.round(o.data.y / cell)}`),
    );
    let placed: { x: number; y: number } | null = null;
    outer: for (const ring of [1, 2, 3]) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const nx = x + dx * cell;
          const ny = y + dy * cell;
          if (!occupied.has(`${Math.round(nx / cell)},${Math.round(ny / cell)}`)) {
            placed = { x: nx, y: ny };
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
