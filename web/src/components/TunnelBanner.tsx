import { useState } from "react";
import { useStore } from "../store";

/** Banner para el DM con el link público del túnel de Cloudflare. */
export default function TunnelBanner() {
  const role = useStore((s) => s.role);
  const tunnelUrl = useStore((s) => s.tunnelUrl);
  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (role !== "dm" || !tunnelUrl || dismissed) return null;

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
      <button className="mini" onClick={() => setDismissed(true)}>
        ✕
      </button>
    </div>
  );
}
