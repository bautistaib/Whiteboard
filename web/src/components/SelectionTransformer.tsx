import type Konva from "konva";
import { useEffect, useRef } from "react";
import { Transformer } from "react-konva";
import { useStore } from "../store";
import { sendThrottled, wsClient } from "../ws";
import { prefixOf } from "../pages/BoardPage";
import { canModifyObject } from "./DrawLayer";
import { getNode } from "./nodeRegistry";

/** Tipos con transformer (resize + rotación). Los tokens también rotan de a 90° por menú contextual. */
const TRANSFORMABLE = new Set(["aoe", "shape", "text", "path", "token", "group", "image"]);

/**
 * Handle de transformación sobre el objeto seleccionado (selección simple,
 * herramienta select): rotación libre + resize. El Transformer de Konva
 * opera con rotation + scaleX/scaleY + x/y; como el render aplica esos
 * mismos campos, no hace falta "hornear" la geometría por tipo.
 */
export default function SelectionTransformer() {
  const trRef = useRef<Konva.Transformer>(null);
  // true mientras el usuario arrastra un handle (no re-sincronizar abajo)
  const transforming = useRef(false);

  const tool = useStore((s) => s.tool);
  const selection = useStore((s) => s.selection);
  const obj = useStore((s) => (selection.length === 1 ? s.objects[selection[0]] : undefined));
  const role = useStore((s) => s.role);
  const clientId = useStore((s) => s.clientId);
  const playersMoveAny = useStore((s) => s.grid.playersMoveAny);

  const objId = obj?.id;
  const transformable =
    tool === "select" &&
    !!obj &&
    TRANSFORMABLE.has(obj.type) &&
    canModifyObject(obj, role, clientId, playersMoveAny);

  // attach/detach del nodo
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = transformable && objId ? getNode(objId) : undefined;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [transformable, objId]);

  // re-sync visual cuando el objeto cambia por fuera (otro cliente, undo, drag)
  useEffect(() => {
    if (transforming.current) return;
    trRef.current?.forceUpdate();
  }, [obj]);

  if (!transformable || !obj) return null;

  const patch = () => {
    const node = trRef.current?.nodes()[0];
    if (!node) return null;
    return {
      rotation: node.rotation(),
      x: node.x(),
      y: node.y(),
      scaleX: node.scaleX(),
      scaleY: node.scaleY(),
    };
  };

  return (
    <Transformer
      ref={trRef}
      rotateEnabled
      resizeEnabled
      flipEnabled={false}
      anchorSize={8}
      // los tokens "pisan" a los cuartos de giro al rotar (coherente con el menú contextual)
      rotationSnaps={obj.type === "token" ? [0, 90, 180, 270] : []}
      anchorStroke="#4fc3f7"
      borderStroke="#4fc3f7"
      onTransformStart={() => {
        transforming.current = true;
      }}
      onTransform={() => {
        const p = patch();
        if (!p) return;
        useStore.getState().updateObjectLocal(obj.id, p);
        sendThrottled(`transform-${obj.id}`, `${prefixOf(obj.type)}.update`, {
          id: obj.id,
          patch: p,
        });
      }}
      onTransformEnd={() => {
        transforming.current = false;
        const p = patch();
        if (p) {
          useStore.getState().updateObjectLocal(obj.id, p);
          wsClient.send(`${prefixOf(obj.type)}.update`, { id: obj.id, patch: p });
        }
      }}
    />
  );
}
