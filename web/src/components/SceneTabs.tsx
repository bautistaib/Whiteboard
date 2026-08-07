import { useStore } from "../store";
import { wsClient } from "../ws";

/** Pestañas de escenas: el DM cambia/crea/renombra; todos siguen la activa. */
export default function SceneTabs() {
  const scenes = useStore((s) => s.scenes);
  const role = useStore((s) => s.role);
  const sceneName = useStore((s) => s.sceneName);

  if (role !== "dm") {
    return <span className="scene-tabs player">{sceneName}</span>;
  }

  return (
    <span className="scene-tabs">
      {scenes.map((s) => (
        <button
          key={s.id}
          className={`scene-tab ${s.isActive ? "active" : ""}`}
          onClick={() => !s.isActive && wsClient.send("scene.switch", { sceneId: s.id })}
          onDoubleClick={() => {
            const name = window.prompt("Nombre de la escena:", s.name);
            if (name?.trim()) wsClient.send("scene.rename", { sceneId: s.id, name: name.trim() });
          }}
          title={s.isActive ? "Escena activa (doble click para renombrar)" : "Cambiar a esta escena"}
        >
          {s.name}
        </button>
      ))}
      <button
        className="scene-tab add"
        title="Nueva escena"
        onClick={() => {
          const name = window.prompt("Nombre de la escena:", `Escena ${scenes.length + 1}`);
          wsClient.send("scene.create", {
            id: crypto.randomUUID(),
            name: name?.trim() || `Escena ${scenes.length + 1}`,
          });
        }}
      >
        +
      </button>
    </span>
  );
}
