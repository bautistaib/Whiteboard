import { useState } from "react";
import { useStore } from "../store";

/** Banner para el DM con el link público del túnel de Cloudflare. */
export default function TunnelBanner() {
  const role = useStore((s) => s.role);
  const tunnelUrl = useStore((s) => s.tunnelUrl);
  const open = useStore((s) => s.tunnelBannerOpen);
  const setOpen = useStore((s) => s.setTunnelBannerOpen);
  const [copied, setCopied] = useState(false);

  if (role !== "dm" || !tunnelUrl || !open) return null;

  return (
    <div className="tunnel-banner">
      <span>
        Link para compartir con la mesa: <code>{tunnelUrl}</code>
      </span>
      <button
        onClick={() => {
          navigator.clipboard.writeText(tunnelUrl);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "¡Copiado!" : "Copiar"}
      </button>
      <button className="mini" onClick={() => setOpen(false)}>
        ✕
      </button>
    </div>
  );
}
