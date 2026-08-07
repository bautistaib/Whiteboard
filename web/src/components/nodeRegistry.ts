import type Konva from "konva";

/** Registro de nodos Konva por object id (para "convertir dibujo en token"). */
const registry = new Map<string, Konva.Node>();

export function registerNode(id: string, node: Konva.Node | null) {
  if (node) registry.set(id, node);
  else registry.delete(id);
}

export function getNode(id: string): Konva.Node | undefined {
  return registry.get(id);
}
