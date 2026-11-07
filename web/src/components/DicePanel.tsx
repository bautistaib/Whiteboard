import { useEffect, useRef, useState, type FormEvent } from "react";
import { diceColor, type DiceRoll, type DiceVisibility } from "../dice";
import { useStore } from "../store";
import { wsClient } from "../ws";

const QUICK_DICE = [4, 6, 8, 10, 12, 20, 100];

export default function DicePanel() {
  const open = useStore((s) => s.diceOpen);
  const setOpen = useStore((s) => s.setDiceOpen);
  const rolls = useStore((s) => s.diceRolls);
  const connected = useStore((s) => s.connected);
  const pending = useStore((s) => s.dicePendingId);
  const error = useStore((s) => s.diceError);
  const [expression, setExpression] = useState("1d20");
  const [label, setLabel] = useState("");
  const [visibility, setVisibility] = useState<DiceVisibility>("public");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  if (!open) return null;
  const disabled = !connected || !!pending;
  const latest = rolls[rolls.length - 1];

  const quickRoll = (formula: string) => {
    setExpression(formula);
    wsClient.rollDice(formula, label, visibility);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    wsClient.rollDice(expression, label, visibility);
  };

  return (
    <section
      id="dice-panel"
      className="dice-panel"
      aria-labelledby="dice-title"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          setOpen(false);
          document.getElementById("dice-toggle")?.focus();
        }
      }}
    >
      <div className="panel-header">
        <h2 id="dice-title">🎲 Dados</h2>
        <button className="mini" aria-label="Cerrar dados" onClick={() => setOpen(false)}>✕</button>
      </div>
      <label className="dice-visibility" htmlFor="dice-visibility">
        Visibilidad
        <select id="dice-visibility" value={visibility} onChange={(event) => setVisibility(event.target.value as DiceVisibility)}>
          <option value="public">Pública</option>
          <option value="screen">Pantalla (solo vos)</option>
        </select>
      </label>
      <p className="muted small dice-intro">{visibility === "screen"
        ? "Solo vos ves las caras y el total. El resto ve la animación con caras ocultas y ?? como total."
        : "Toda la mesa ve las caras y el total."}</p>
      <div className="dice-quick" aria-label="Dados rápidos">
        {QUICK_DICE.map((sides) => (
          <button key={sides} disabled={disabled} title={`Tirar 1d${sides}`} onClick={() => quickRoll(`1d${sides}`)}>
            d{sides}
          </button>
        ))}
      </div>
      <form className="dice-form" onSubmit={submit}>
        <label htmlFor="dice-expression">Fórmula</label>
        <div className="dice-form-row">
          <input
            ref={input}
            id="dice-expression"
            value={expression}
            maxLength={200}
            required
            autoComplete="off"
            spellCheck={false}
            aria-describedby="dice-help"
            aria-invalid={!!error}
            onChange={(event) => {
              setExpression(event.target.value);
              useStore.setState({ diceError: null });
            }}
          />
          <button className="dice-submit" type="submit" disabled={disabled || !expression.trim()}>
            {pending ? "Tirando…" : "Tirar"}
          </button>
        </div>
        <label htmlFor="dice-label">Etiqueta <span className="muted">(opcional)</span></label>
        <input id="dice-label" value={label} maxLength={80} placeholder="Ataque, daño, percepción…" onChange={(e) => setLabel(e.target.value)} />
        <p id="dice-help" className="muted small">Ej.: 1d20+5 · 2d6+1d4-2 · 4d6kh3. kh conserva los mayores y kl los menores.</p>
      </form>
      <div className="dice-advantage">
        <button disabled={disabled} title="Tirar 2d20 y conservar el mayor" onClick={() => quickRoll("2d20kh1")}>Ventaja (d20)</button>
        <button disabled={disabled} title="Tirar 2d20 y conservar el menor" onClick={() => quickRoll("2d20kl1")}>Desventaja (d20)</button>
      </div>
      {error && <div className="error small" role="alert">{error}</div>}
      {!connected && <div className="muted small">Reconectando… Podrás tirar cuando vuelva la conexión.</div>}
      <div className="dice-latest" role="status" aria-live="polite" aria-atomic="true">
        {latest ? <><span>{latest.author}: {latest.expression}</span><strong>{latest.total ?? "??"}</strong></> : <span>Listo para la primera tirada.</span>}
      </div>
      <h3>Historial de la mesa <span className="muted">({rolls.length}/50)</span></h3>
      <p className="muted small dice-history-hint">Se conserva entre escenas y al reconectar; se vacía al reiniciar el servidor.</p>
      <ol className="dice-history" aria-label="Historial de tiradas">
        {[...rolls].reverse().map((roll) => <RollEntry key={roll.id} roll={roll} onRepeat={() => quickRoll(roll.expression)} disabled={disabled} />)}
      </ol>
      {!rolls.length && <p className="muted small">Todavía no hay tiradas. Elegí un dado o escribí una fórmula.</p>}
    </section>
  );
}

function RollEntry({ roll, onRepeat, disabled }: { roll: DiceRoll; onRepeat: () => void; disabled: boolean }) {
  return (
    <li className="dice-entry">
      <div className="dice-entry-head">
        <span className="dice-owner-color" style={{ backgroundColor: diceColor(roll) }} aria-hidden="true" />
        <strong>{roll.author}</strong>
        {roll.visibility === "screen" && <span className="muted small">Pantalla</span>}
        <time dateTime={new Date(roll.createdAt * 1000).toISOString()}>
          {new Date(roll.createdAt * 1000).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
        </time>
      </div>
      {roll.label && <div className="dice-label">{roll.label}</div>}
      <div className="dice-entry-result"><code>{roll.expression}</code><strong>{roll.total ?? "??"}</strong></div>
      {roll.hidden ? <p className="muted small">Resultado detrás de la pantalla.</p> : <div className="dice-breakdown" aria-label="Desglose de la tirada">
        {roll.terms.map((term, i) => (
          <span className="dice-term" key={i}>
            {(i > 0 || term.sign < 0) && <span>{term.sign < 0 ? "−" : "+"}</span>}
            {term.kind === "constant" ? term.value : <>
              <span className="muted">{term.notation}:</span>
              {term.rolls.map((value, index) => (
                <span key={index} className={`die-value ${term.kept[index] ? "" : "discarded"}`} title={term.kept[index] ? "Conservado" : "Descartado"}>
                  {term.kept[index] ? value : <s>{value}</s>}
                </span>
              ))}
            </>}
          </span>
        ))}
      </div>}
      <button className="mini dice-repeat" disabled={disabled} title={`Volver a tirar ${roll.expression}`} onClick={onRepeat}>Repetir fórmula</button>
    </li>
  );
}
