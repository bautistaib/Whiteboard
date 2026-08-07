import { useEffect, useState } from "react";
import { createCampaign, listCampaigns, tunnelInfo, type CampaignSummary } from "../api";

export default function HomePage() {
  const [name, setName] = useState("Mi campaña");
  const [links, setLinks] = useState<{ dm_url: string; player_url: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);

  const refresh = () => listCampaigns().then(setCampaigns).catch(() => {});
  useEffect(() => {
    refresh();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setLinks(await createCampaign(name));
      refresh();
    } catch (err: any) {
      setError(err.message ?? "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="home">
      <h1>Whiteboard TTRPG</h1>
      <p className="muted">
        Whiteboard colaborativo para tus sesiones de rol. Creá una campaña y compartí el
        link con tu mesa.
      </p>
      {!links ? (
        <>
          <form onSubmit={submit} className="home-form">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre de la campaña"
              maxLength={80}
            />
            <button type="submit" disabled={busy}>
              {busy ? "Creando…" : "Crear campaña"}
            </button>
            {error && <p className="error">{error}</p>}
          </form>
          {campaigns.length > 0 && (
            <div className="home-campaigns">
              <h2>Tus campañas</h2>
              <p className="muted">Reabrí una campaña anterior con sus tokens y mapas.</p>
              {campaigns.map((c) => (
                <div key={c.id} className="campaign-row">
                  <a className="campaign-open" href={c.dm_url}>
                    {c.name}
                  </a>
                  <span className="muted small">
                    {new Date(c.created_at * 1000).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <CampaignCreated dmUrl={links.dm_url} playerUrl={links.player_url} />
      )}
    </div>
  );
}

function CampaignCreated({ dmUrl, playerUrl }: { dmUrl: string; playerUrl: string }) {
  const dmToken = dmUrl.split("/").pop() ?? "";
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [tunnelFailed, setTunnelFailed] = useState(false);

  // El túnel de Cloudflare tarda unos segundos: consultar hasta que esté.
  useEffect(() => {
    let tries = 0;
    const timer = window.setInterval(async () => {
      tries++;
      try {
        const info = await tunnelInfo(dmToken);
        if (info.player_url) {
          setPublicUrl(info.player_url);
          window.clearInterval(timer);
        }
      } catch {
        // reintentar
      }
      if (tries >= 20) {
        window.clearInterval(timer);
        setTunnelFailed(true);
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [dmToken]);

  return (
    <div className="home-links">
      <div className="link-box highlight">
        <h2>Link para compartir con la mesa</h2>
        {publicUrl ? (
          <>
            <p className="muted">
              Este es el link público: pegalo en Discord. Cambia cada vez que se
              reinicia el server.
            </p>
            <CopyableLink url={publicUrl} />
          </>
        ) : tunnelFailed ? (
          <p className="muted">
            El túnel público no está disponible (¿TUNNEL=off?). Tus jugadores solo
            pueden entrar desde tu red con el link local de abajo.
          </p>
        ) : (
          <p className="muted">Generando el link público (tarda unos segundos)…</p>
        )}
      </div>
      <div className="link-box">
        <h2>Tu link de DM (secreto)</h2>
        <p className="muted">
          Con este link administrás todo. Guardalo y no lo compartas.
        </p>
        <CopyableLink url={`${location.origin}${dmUrl}`} />
        <a className="button" href={dmUrl}>
          Entrar como DM
        </a>
      </div>
      <div className="link-box">
        <h2>Link local de jugadores</h2>
        <p className="muted">
          Solo funciona en tu computadora (o tu red). Para jugar por internet usá el
          link público de arriba.
        </p>
        <CopyableLink url={`${location.origin}${playerUrl}`} />
      </div>
    </div>
  );
}

function CopyableLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copyable">
      <input readOnly value={url} onFocus={(e) => e.target.select()} />
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "¡Copiado!" : "Copiar"}
      </button>
    </div>
  );
}
