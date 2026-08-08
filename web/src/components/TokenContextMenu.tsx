import type Konva from "konva";
import { useState } from "react";
import { uploadImage } from "../api";
import { BADGE_PRESETS, useStore } from "../store";
import { wsClient } from "../ws";
import { prefixOf, duplicateTokens } from "../pages/BoardPage";
import { getNode } from "./nodeRegistry";
import { objectBounds } from "./objectBounds";

// tipos que se pueden fusionar en un dibujo compuesto (group)
const MERGEABLE = new Set(["path", "shape", "text", "group", "image"]);

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/** Menú contextual (click derecho) sobre tokens, dibujos y AoE. */
export default function TokenContextMenu() {
  const menu = useStore((s) => s.contextMenu);
  const objects = useStore((s) => s.objects);
  const library = useStore((s) => s.library);
  const token = useStore((s) => s.token);
  const name = useStore((s) => s.name);
  const setContextMenu = useStore((s) => s.setContextMenu);
  const [showVariants, setShowVariants] = useState(false);
  const [showBadges, setShowBadges] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!menu) return null;
  const obj = objects[menu.objId];
  if (!obj) return null;
  const d = obj.data;
  const close = () => {
    setContextMenu(null);
    setShowVariants(false);
    setShowBadges(false);
  };

  const send = (type: string, payload: Record<string, any>) => {
    wsClient.send(type, payload);
    close();
  };

  const variants = d.character_id
    ? library.variants.filter((v) => v.characterId === d.character_id)
    : [];

  const convertToToken = async () => {
    if (busy) return;
    // convertir la selección entera (varios trazos) en un solo token
    const st = useStore.getState();
    const ids = st.selection.length > 1 ? st.selection : [obj.id];
    const nodes = ids.map((id) => getNode(id)).filter(Boolean) as Konva.Node[];
    if (!nodes.length) return;
    setBusy(true);
    try {
      // bounding box absoluto (px de pantalla) de todos los nodos
      const rects = nodes.map((n) => n.getClientRect());
      const minX = Math.min(...rects.map((r) => r.x));
      const minY = Math.min(...rects.map((r) => r.y));
      const maxX = Math.max(...rects.map((r) => r.x + r.width));
      const maxY = Math.max(...rects.map((r) => r.y + r.height));
      const pad = 4;
      const W = Math.max(1, Math.ceil(maxX - minX + pad * 2));
      const H = Math.max(1, Math.ceil(maxY - minY + pad * 2));

      // componer todos los nodos en un canvas del tamaño del bbox
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = true;
      for (const n of nodes) {
        const url = n.toDataURL({ pixelRatio: 1 });
        const imgEl = await loadImage(url);
        const r = n.getClientRect();
        ctx.drawImage(imgEl, r.x - minX + pad, r.y - minY + pad);
      }
      const blob: Blob = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b!), "image/png"),
      );
      const tokenName = window.prompt("Nombre del personaje:", "Dibujo") ?? "Dibujo";
      const uploaded = await uploadImage(token, blob, {
        kind: "token",
        name: tokenName,
        filename: "dibujo.png",
      });
      wsClient.send("token.add", {
        id: crypto.randomUUID(),
        data: {
          x: minX + W / 2,
          y: minY + H / 2,
          asset_id: uploaded.id,
          character_id: uploaded.characterId,
          active_variant_id: uploaded.variantId,
          size_cells: Math.max(1, Math.round(W / st.grid.cellSize)),
          name: tokenName,
          show_name: true,
          rotation: 0,
          badges: [],
        },
      });
      // borrar los originales
      for (const id of ids) {
        const o = st.objects[id];
        if (o) wsClient.send(`${prefixOf(o.type)}.remove`, { id });
      }
    } finally {
      setBusy(false);
      close();
    }
  };

  // cantidad de objetos fusionables en la selección (para mostrar "Fusionar selección")
  const mergeableCount = useStore.getState().selection.filter((id) => {
    const o = objects[id];
    return o && MERGEABLE.has(o.type);
  }).length;

  /** Fusiona la selección en un objeto `group` con parts relativas a su origen. */
  const mergeSelection = () => {
    const st = useStore.getState();
    const ids = st.selection.filter((id) => {
      const o = st.objects[id];
      return o && MERGEABLE.has(o.type);
    });
    if (ids.length < 2) return;
    // orden por z: las partes conservan el apilado original
    const objs = ids.map((id) => st.objects[id]).sort((a, b) => a.z - b.z);
    // aplanar: un group aporta sus parts con su traslación aplicada
    // (si el group estaba rotado/escalado, las parts se toman sin esa transformación)
    const flat: { type: string; data: Record<string, any> }[] = [];
    for (const o of objs) {
      if (o.type === "group") {
        const gx = o.data.x ?? 0;
        const gy = o.data.y ?? 0;
        for (const p of o.data.parts ?? []) {
          flat.push({ type: p.type, data: { ...p.data, x: (p.data.x ?? 0) + gx, y: (p.data.y ?? 0) + gy } });
        }
      } else {
        flat.push({ type: o.type, data: { ...o.data } });
      }
    }
    // origen = centro del bbox combinado
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const f of flat) {
      const b = objectBounds({ id: "", type: f.type, z: 0, owner: "", data: f.data }, st.grid.cellSize);
      minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
    }
    if (!Number.isFinite(minX)) return;
    const ox = (minX + maxX) / 2;
    const oy = (minY + maxY) / 2;
    const parts = flat.map((f) => ({
      type: f.type,
      data: { ...f.data, x: (f.data.x ?? 0) - ox, y: (f.data.y ?? 0) - oy },
    }));
    const newId = crypto.randomUUID();
    wsClient.send("group.add", { id: newId, data: { x: ox, y: oy, rotation: 0, parts } });
    // borrar los originales
    for (const o of objs) wsClient.send(`${prefixOf(o.type)}.remove`, { id: o.id });
    st.setSelection([newId]);
    close();
  };

  const badges: { emoji: string; label: string; color: string }[] = d.badges ?? [];

  return (
    <div className="context-overlay" onClick={close} onContextMenu={(e) => e.preventDefault()}>
      <div
        className="context-menu"
        style={{ left: menu.x, top: menu.y }}
        onClick={(e) => e.stopPropagation()}
      >
        {obj.type === "token" && (
          <>
            {variants.length > 1 && (
              <div className="menu-item" onClick={() => setShowVariants(!showVariants)}>
                Cambiar forma ▸
              </div>
            )}
            {showVariants && (
              <div className="submenu">
                {variants.map((v) => {
                  const asset = library.assets.find((a) => a.id === v.assetId);
                  return (
                    <div
                      key={v.id}
                      className={`menu-item variant ${v.id === d.active_variant_id ? "active" : ""}`}
                      onClick={() =>
                        send("token.setVariant", { id: obj.id, variantId: v.id })
                      }
                    >
                      {asset && <img src={`/assets/${asset.filename}`} alt="" />}
                      <span>
                        {v.label} ({v.sizeCells}×{v.sizeCells})
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <div
              className="menu-item"
              onClick={() => {
                duplicateTokens([obj.id]);
                close();
              }}
            >
              Duplicar
            </div>
            <div
              className="menu-item"
              onClick={() =>
                send("token.update", { id: obj.id, patch: { rotation: ((d.rotation ?? 0) + 90) % 360 } })
              }
            >
              Rotar 90°
            </div>
            <div
              className="menu-item"
              onClick={() =>
                send("token.update", {
                  id: obj.id,
                  patch: { size_cells: (d.size_cells ?? 1) + 1 },
                })
              }
            >
              Tamaño +
            </div>
            <div
              className="menu-item"
              onClick={() =>
                (d.size_cells ?? 1) > 1 &&
                send("token.update", {
                  id: obj.id,
                  patch: { size_cells: (d.size_cells ?? 1) - 1 },
                })
              }
            >
              Tamaño −
            </div>
            <div
              className="menu-item"
              onClick={() =>
                send("token.update", { id: obj.id, patch: { show_name: d.show_name === false } })
              }
            >
              {d.show_name === false ? "Mostrar nombre" : "Ocultar nombre"}
            </div>
            <div className="menu-item" onClick={() => setShowBadges(!showBadges)}>
              Badges de estado ▸
            </div>
            {showBadges && (
              <div className="submenu">
                {BADGE_PRESETS.map((b) => {
                  const active = badges.some((x) => x.emoji === b.emoji);
                  return (
                    <div
                      key={b.emoji}
                      className={`menu-item ${active ? "active" : ""}`}
                      onClick={() => {
                        const next = active
                          ? badges.filter((x) => x.emoji !== b.emoji)
                          : [...badges, b];
                        send("token.update", { id: obj.id, patch: { badges: next } });
                      }}
                    >
                      {b.emoji} {b.label}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
        {obj.type === "aoe" && (
          <div
            className="menu-item"
            onClick={() =>
              send("aoe.update", { id: obj.id, patch: { rotation: (d.rotation ?? 0) + 45 } })
            }
          >
            Rotar 45°
          </div>
        )}
        {MERGEABLE.has(obj.type) && mergeableCount >= 2 && (
          <div className="menu-item" onClick={mergeSelection}>
            Fusionar selección
          </div>
        )}
        {MERGEABLE.has(obj.type) && (
          <div className="menu-item" onClick={convertToToken}>
            {busy ? "Convirtiendo…" : "Convertir en token"}
          </div>
        )}
        <div
          className="menu-item danger"
          onClick={() => send(`${prefixOf(obj.type)}.remove`, { id: obj.id })}
        >
          Eliminar
        </div>
      </div>
    </div>
  );
}
