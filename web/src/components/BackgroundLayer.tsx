import type Konva from "konva";
import { useEffect, useRef, useState } from "react";
import { Image as KImage, Layer, Transformer } from "react-konva";
import { defaultBackgroundTransform } from "../grid";
import { useStore } from "../store";
import { wsClient } from "../ws";
import { useAssetImage } from "./useImage";

/**
 * Capa de fondo: imagen del mapa. Por defecto no seleccionable (locked);
 * el DM puede desbloquearla para mover/rotar/redimensionar. El transform
 * persiste en la config de grilla de la escena.
 */
export default function BackgroundLayer() {
  const backgroundAssetId = useStore((s) => s.backgroundAssetId);
  const assets = useStore((s) => s.library.assets);
  const unlocked = useStore((s) => s.backgroundUnlocked);
  const grid = useStore((s) => s.grid);
  const asset = assets.find((a) => a.id === backgroundAssetId);
  const img = useAssetImage(asset?.filename);

  const imageRef = useRef<Konva.Image>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [editing, setEditing] = useState(false);

  const tf = grid.backgroundTransform ?? defaultBackgroundTransform();

  useEffect(() => {
    if (unlocked && imageRef.current && trRef.current) {
      trRef.current.nodes([imageRef.current]);
      trRef.current.getLayer()?.batchDraw();
      setEditing(true);
    } else {
      setEditing(false);
    }
  }, [unlocked]);

  if (!img) return <Layer listening={false} />;

  const commitTransform = () => {
    const node = imageRef.current;
    if (!node) return;
    const next = {
      x: node.x(),
      y: node.y(),
      scale: node.scaleX(),
      rotation: node.rotation(),
    };
    // reset visual: aplicamos el transform via props (grid), no via node escalado
    useStore.setState({
      grid: { ...grid, backgroundTransform: next },
    });
    wsClient.send("scene.setGrid", { grid: { ...grid, backgroundTransform: next } });
  };

  return (
    <Layer listening={unlocked}>
      <KImage
        ref={imageRef}
        image={img}
        x={tf.x}
        y={tf.y}
        scaleX={tf.scale}
        scaleY={tf.scale}
        rotation={tf.rotation}
        draggable={unlocked}
        onTransformEnd={commitTransform}
        onDragEnd={commitTransform}
      />
      {editing && (
        <Transformer
          ref={trRef}
          rotateEnabled={true}
          enabledAnchors={[
            "top-left",
            "top-right",
            "bottom-left",
            "bottom-right",
            "middle-left",
            "middle-right",
          ]}
          boundBoxFunc={(_old, neo) => {
            // evitar scale 0 o negativo
            if (neo.width < 10 || neo.height < 10) return _old;
            return neo;
          }}
        />
      )}
    </Layer>
  );
}
