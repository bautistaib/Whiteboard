import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { sessionInfo } from "../api";
import BoardPage from "./BoardPage";
import { useStore } from "../store";

function getClientId(): string {
  let id = localStorage.getItem("ttrpg:clientId");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("ttrpg:clientId", id);
  }
  return id;
}

export default function JoinPage() {
  const { token = "" } = useParams();
  const [info, setInfo] = useState<{ role: "dm" | "player"; campaignName: string } | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState(localStorage.getItem("ttrpg:name") ?? "");
  const [joined, setJoined] = useState(false);
  const setSession = useStore((s) => s.setSession);

  useEffect(() => {
    sessionInfo(token)
      .then(setInfo)
      .catch(() => setError("Este link no es válido. Pedile al DM que lo vuelva a compartir."));
  }, [token]);

  if (error) {
    return (
      <div className="home">
        <h1>Link inválido</h1>
        <p className="error">{error}</p>
      </div>
    );
  }
  if (!info) return <div className="home">Cargando…</div>;

  if (!joined) {
    return (
      <div className="home">
        <h1>{info.campaignName}</h1>
        <p className="muted">
          Entrás como {info.role === "dm" ? "DM" : "jugador"}. ¿Cómo te llamás?
        </p>
        <form
          className="home-form"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) return;
            localStorage.setItem("ttrpg:name", trimmed);
            // recordar el token de DM: la home lo usa para listar/crear campañas
            if (info.role === "dm") localStorage.setItem("ttrpg:dmToken", token);
            setSession({ token, role: info.role, name: trimmed, clientId: getClientId() });
            setJoined(true);
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tu nombre"
            maxLength={32}
          />
          <button type="submit">Entrar</button>
        </form>
      </div>
    );
  }

  return <BoardPage />;
}
