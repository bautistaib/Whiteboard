import { useEffect, useRef, useState, type CSSProperties } from "react";
import { diceColor } from "../dice";
import { ANIMATION_DURATION_MS, ROLL_DURATION_MS, visualDice, type DiceAnimation } from "../dice3d/animation";
import type { DiceScene } from "../dice3d/scene";
import { useStore } from "../store";

const loadScene = () => import("../dice3d/scene");

export default function DiceOverlay() {
  const animations = useStore((s) => s.diceAnimations);
  // Descargar el chunk 3D en segundo plano antes de la primera tirada.
  useEffect(() => { void loadScene().catch(() => {}); }, []);
  if (!animations.length) return null;
  return (
    <div className="dice-overlay" aria-label="Tiradas de la mesa" data-count={animations.length}>
      <div className={`dice-trays ${animations.length === 1 ? "single" : animations.length === 2 ? "pair" : animations.length > 4 ? "many" : ""}`}>
        {animations.map((animation) => <AnimatedRoll key={animation.roll.id} animation={animation} />)}
      </div>
    </div>
  );
}

function AnimatedRoll({ animation }: { animation: DiceAnimation }) {
  const { roll, startsAt } = animation;
  const host = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState("waiting");
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    const element = host.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false, failed = false, frame = 0;
    let scene: DiceScene | undefined;
    const fail = () => {
      if (disposed) return;
      failed = true;
      setFallback(true);
    };
    void loadScene().then(({ createDiceScene }) => {
      if (!disposed) scene = createDiceScene(element, roll, fail);
    }).catch(fail);

    const tick = () => {
      if (disposed) return;
      const elapsed = Date.now() + useStore.getState().serverClockOffsetMs - startsAt;
      if (elapsed >= ANIMATION_DURATION_MS) {
        useStore.getState().finishDiceAnimation(roll.id);
        return;
      }
      const settled = reduced.matches || failed || elapsed >= ROLL_DURATION_MS;
      setPhase(settled ? "settled" : elapsed < 0 ? "waiting" : "rolling");
      if (!failed) {
        try { scene?.render(reduced.matches ? ROLL_DURATION_MS : Math.max(0, elapsed)); }
        catch { fail(); }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      scene?.dispose();
    };
  }, [roll, startsAt]);

  const dice = visualDice(roll);
  const colorStyle: CSSProperties & { "--dice-color": string } = { "--dice-color": diceColor(roll) };
  return (
      <section className="dice-tray" style={colorStyle} aria-label={`Tirada de ${roll.author}`} data-roll-id={roll.id} data-client-id={roll.clientId} data-phase={phase}>
        <div className="dice-tray-heading">
          <span className="dice-tray-icon" aria-hidden="true">●</span>
          <div><strong>{roll.author}</strong><span>{roll.label || roll.expression}</span></div>
          <span className="dice-tray-state">{phase === "settled" ? (roll.visibility === "screen" ? "Pantalla" : "Resultado") : "Rodando dados…"}</span>
        </div>
        <div className="dice-stage" ref={host} />
        {fallback && <div className="dice-3d-fallback">La vista 3D no está disponible en este navegador.</div>}
        <div className="dice-tray-result" role="status" aria-live="polite" aria-atomic="true">
          {phase === "settled" ? <>
            <span>{roll.expression}</span><strong>{roll.total ?? "??"}</strong>
            <span className="dice-tray-detail">{roll.hidden ? "Resultado detrás de la pantalla." : roll.terms.filter((t) => t.kind === "dice").map((term) => term.kind === "dice" ? `${term.notation}: ${term.rolls.map((n, i) => term.kept[i] ? n : `(${n})`).join(", ")}` : "").join(" · ")}</span>
          </> : <span>{dice.length} {dice.length === 1 ? "dado en la mesa" : "dados en la mesa"}</span>}
        </div>
      </section>
  );
}
