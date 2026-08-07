import { Image as KImage, Layer } from "react-konva";
import { useStore } from "../store";
import { useAssetImage } from "./useImage";

/** Capa de fondo: imagen del mapa, no seleccionable (listening=false). */
export default function BackgroundLayer() {
  const backgroundAssetId = useStore((s) => s.backgroundAssetId);
  const assets = useStore((s) => s.library.assets);
  const asset = assets.find((a) => a.id === backgroundAssetId);
  const img = useAssetImage(asset?.filename);

  return (
    <Layer listening={false}>
      {img && <KImage image={img} x={0} y={0} />}
    </Layer>
  );
}
