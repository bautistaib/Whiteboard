import { useRef, useState } from "react";
import { addVariant, deleteAsset, uploadImage } from "../api";
import { useStore } from "../store";
import { wsClient } from "../ws";

/** Biblioteca de assets de la campaña: personajes (expandibles) y mapas. */
export default function LibraryPanel() {
  const library = useStore((s) => s.library);
  const token = useStore((s) => s.token);
  const name = useStore((s) => s.name);
  const role = useStore((s) => s.role);
  const sceneId = useStore((s) => s.sceneId);
  const backgroundAssetId = useStore((s) => s.backgroundAssetId);
  const fileInput = useRef<HTMLInputElement>(null);
  const mapInput = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [addingVariantTo, setAddingVariantTo] = useState<string | null>(null);
  const variantInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  const doUpload = async (file: File, kind: "token" | "map") => {
    setError("");
    try {
      await uploadImage(token, file, {
        kind,
        name: kind === "token" ? file.name.replace(/\.[^.]+$/, "") : file.name,
        filename: file.name,
      });
    } catch (err: any) {
      setError(err.message ?? "error subiendo");
    }
  };

  const doAddVariant = async (characterId: string, file: File) => {
    setError("");
    try {
      const label = window.prompt("Label de la forma (ej: Lobo, Humano):", "Forma") ?? "Forma";
      const size = Number(window.prompt("Tamaño en celdas:", "1")) || 1;
      const uploaded = await uploadImage(token, file, {
        kind: "other",
        name: file.name,
        filename: file.name,
      });
      await addVariant(token, characterId, uploaded.id, label, Math.max(1, size));
    } catch (err: any) {
      setError(err.message ?? "error");
    } finally {
      setAddingVariantTo(null);
    }
  };

  const characters = library.characters.map((c) => ({
    ...c,
    variants: library.variants.filter((v) => v.characterId === c.id),
  }));
  const maps = library.assets.filter((a) => a.kind === "map");

  return (
    <div className="library">
      <div className="library-header">
        <strong>Biblioteca</strong>
      </div>
      <div className="library-actions">
        <button onClick={() => fileInput.current?.click()}>+ Token</button>
        {role === "dm" && <button onClick={() => mapInput.current?.click()}>+ Mapa</button>}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) doUpload(f, "token");
          e.target.value = "";
        }}
      />
      <input
        ref={mapInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) doUpload(f, "map");
          e.target.value = "";
        }}
      />
      <input
        ref={variantInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && addingVariantTo) doAddVariant(addingVariantTo, f);
          e.target.value = "";
        }}
      />
      {error && <div className="error small">{error}</div>}

      <div className="library-list">
        {characters.map((c) => {
          const mainVariant = c.variants[0];
          const mainAsset = library.assets.find((a) => a.id === mainVariant?.assetId);
          const isOpen = expanded[c.id] ?? false;
          return (
            <div key={c.id} className="library-character">
              <div
                className="library-item"
                draggable={!!mainVariant}
                onDragStart={(e) => {
                  if (!mainVariant) return;
                  e.dataTransfer.setData(
                    "application/x-ttrpg-character",
                    JSON.stringify({ characterId: c.id, variantId: mainVariant.id }),
                  );
                }}
                onClick={() => setExpanded({ ...expanded, [c.id]: !isOpen })}
                title="Arrastrar al canvas para crear un token"
              >
                {mainAsset && <img src={`/assets/${mainAsset.filename}`} alt={c.name} />}
                <span>{c.name}</span>
                {c.variants.length > 1 && <span className="muted">({c.variants.length})</span>}
              </div>
              {isOpen && (
                <div className="library-variants">
                  {c.variants.map((v) => {
                    const asset = library.assets.find((a) => a.id === v.assetId);
                    return (
                      <div
                        key={v.id}
                        className="library-item small"
                        draggable
                        onDragStart={(e) =>
                          e.dataTransfer.setData(
                            "application/x-ttrpg-character",
                            JSON.stringify({ characterId: c.id, variantId: v.id }),
                          )
                        }
                      >
                        {asset && <img src={`/assets/${asset.filename}`} alt={v.label} />}
                        <span>
                          {v.label} · {v.sizeCells}×{v.sizeCells}
                        </span>
                        {asset && (role === "dm" || asset.uploadedBy === name) && (
                          <button
                            className="mini danger"
                            title="Borrar asset"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              if (window.confirm("¿Borrar este asset?")) {
                                deleteAsset(token, asset.id, name).catch(() => {});
                              }
                            }}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    );
                  })}
                  <button
                    className="mini"
                    onClick={() => {
                      setAddingVariantTo(c.id);
                      variantInput.current?.click();
                    }}
                  >
                    + Agregar forma
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {characters.length === 0 && <p className="muted small">Sin tokens todavía.</p>}

        {maps.length > 0 && <div className="library-section">Mapas</div>}
        {maps.map((m) => (
          <div key={m.id} className="library-item">
            <img src={`/assets/${m.filename}`} alt="mapa" />
            <span className="muted">{m.uploadedBy}</span>
            {role === "dm" && (
              <button
                className="mini"
                title="Usar como fondo de la escena actual"
                onClick={() =>
                  wsClient.send("scene.setBackground", {
                    sceneId,
                    assetId: backgroundAssetId === m.id ? null : m.id,
                  })
                }
              >
                {backgroundAssetId === m.id ? "Quitar fondo" : "Fondo"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
