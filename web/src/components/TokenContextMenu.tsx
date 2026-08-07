import { useState } from "react";
import { uploadImage } from "../api";
import { BADGE_PRESETS, useStore } from "../store";
import { wsClient } from "../ws";
import { prefixOf } from "../pages/BoardPage";
import { getNode } from "./nodeRegistry";

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
    const node = getNode(obj.id);
    if (!node || busy) return;
    setBusy(true);
    try {
      const rect = node.getClientRect();
      const dataUrl = node.toDataURL({ pixelRatio: 1 });
      const blob = await (await fetch(dataUrl)).blob();
      const tokenName = window.prompt("Nombre del personaje:", "Dibujo") ?? "Dibujo";
      const uploaded = await uploadImage(token, blob, {
        kind: "token",
        name: tokenName,
        filename: "dibujo.png",
      });
      wsClient.send("token.add", {
        id: crypto.randomUUID(),
        data: {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          asset_id: uploaded.id,
          character_id: uploaded.characterId,
          active_variant_id: uploaded.variantId,
          size_cells: Math.max(1, Math.round(rect.width / 64)),
          name: tokenName,
          show_name: true,
          rotation: 0,
          badges: [],
        },
      });
      wsClient.send(`${prefixOf(obj.type)}.remove`, { id: obj.id });
    } finally {
      setBusy(false);
      close();
    }
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
              onClick={() =>
                send("token.duplicate", {
                  id: obj.id,
                  newId: crypto.randomUUID(),
                  x: (d.x ?? 0) + 64,
                  y: d.y ?? 0,
                })
              }
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
        {obj.type === "path" && (
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
