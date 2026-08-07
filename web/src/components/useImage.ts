import { useEffect, useState } from "react";

const cache = new Map<string, HTMLImageElement>();

export function useAssetImage(filename: string | null | undefined): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(
    filename ? cache.get(filename) ?? null : null,
  );
  useEffect(() => {
    if (!filename) {
      setImg(null);
      return;
    }
    const cached = cache.get(filename);
    if (cached) {
      setImg(cached);
      return;
    }
    const el = new Image();
    el.src = `/assets/${filename}`;
    el.onload = () => {
      cache.set(filename, el);
      setImg(el);
    };
    return () => {
      el.onload = null;
    };
  }, [filename]);
  return img;
}
