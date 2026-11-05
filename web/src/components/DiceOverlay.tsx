import { useEffect, useRef, useState } from "react";
import { ANIMATION_DURATION_MS, ROLL_DURATION_MS, visualDice, type DiceAnimation } from "../dice3d/animation";
import type { DiceScene } from "../dice3d/scene";
import { useStore } from "../store";

const loadScene = () => import("../dice3d/scene");

export default function DiceOverlay() {
  const animation = useStore((s) => s.diceAnimations[0]);
  // Descargar el chunk 3D en segundo plano antes de la primera tirada.
  useEffect(() => { void loadScene().catch(() => {}); }, []);
  return animation ? <AnimatedRoll key={animation.roll.id} animation={animation} /> : null;
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
  return (
    <div className={`dice-overlay ${phase === "settled" ? "settled" : ""}`} data-roll-id={roll.id} data-phase={phase}>
      <div className="dice-tray">
        <div className="dice-tray-heading">
          <span className="dice-tray-icon" aria-hidden="true">✦</span>
          <div><strong>{roll.author}</strong><span>{roll.label || roll.expression}</span></div>
          <span className="dice-tray-state">{phase === "settled" ? "Resultado" : "Rodando dados…"}</span>
        </div>
        <div className="dice-stage" ref={host} />
        {fallback && <div className="dice-3d-fallback">La vista 3D no está disponible en este navegador.</div>}
        <div className="dice-tray-result" role="status" aria-live="polite" aria-atomic="true">
          {phase === "settled" ? <>
            <span>{roll.expression}</span><strong>{roll.total}</strong>
            <span className="dice-tray-detail">{roll.terms.filter((t) => t.kind === "dice").map((term) => term.kind === "dice" ? `${term.notation}: ${term.rolls.map((n, i) => term.kept[i] ? n : `(${n})`).join(", ")}` : "").join(" · ")}</span>
          </> : <span>{dice.length} {dice.length === 1 ? "dado en la mesa" : "dados en la mesa"}</span>}
        </div>
      </div>
    </div>
  );
}
