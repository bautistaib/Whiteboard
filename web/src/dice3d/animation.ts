import type { DiceRoll } from "../dice";

export const ROLL_DELAY_MS = 350;
export const ROLL_DURATION_MS = 2200;
export const ROLL_HOLD_MS = 1800;
export const ANIMATION_DURATION_MS = ROLL_DURATION_MS + ROLL_HOLD_MS;
export const ANIMATION_QUEUE_LIMIT = 8;

export interface DiceAnimation {
  roll: DiceRoll;
  startsAt: number; // reloj del servidor, en ms
}

export interface VisualDie {
  sides: number;
  value: number;
  kept: boolean;
  termIndex: number;
  kind: "standard" | "tens" | "units" | "custom";
}

const STANDARD_SIDES = new Set([4, 6, 8, 10, 12, 20]);

export function visualDice(roll: DiceRoll): VisualDie[] {
  return roll.terms.flatMap((term, termIndex) => term.kind === "constant" ? [] : term.rolls.flatMap((value, i): VisualDie[] => {
    const base = { kept: term.kept[i], termIndex };
    if (term.sides === 100) {
      return [
        { ...base, sides: 10, value: Math.floor((value % 100) / 10), kind: "tens" },
        { ...base, sides: 10, value: value % 10, kind: "units" },
      ];
    }
    return [{ ...base, sides: term.sides, value, kind: STANDARD_SIDES.has(term.sides) ? "standard" : "custom" }];
  }));
}

/** Semilla pública: el ID autoritativo hace reproducible la coreografía. */
export function seededRandom(seed: string): () => number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return () => {
    hash += 0x6d2b79f5;
    let n = Math.imul(hash ^ (hash >>> 15), 1 | hash);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

export function queueDiceAnimation(queue: DiceAnimation[], roll: DiceRoll, now: number): DiceAnimation[] {
  // Los snapshots no pasan por acá. Un duplicado tampoco vuelve a animarse.
  if (queue.some((entry) => entry.roll.id === roll.id)) return queue;
  const live = queue.filter((entry) => entry.startsAt + ANIMATION_DURATION_MS > now);
  const last = live[live.length - 1];
  const startsAt = Math.max(roll.createdAt * 1000 + ROLL_DELAY_MS, last ? last.startsAt + ANIMATION_DURATION_MS : 0);
  if (startsAt + ANIMATION_DURATION_MS <= now) return live;
  // Si hay una ráfaga, conservar la animación activa y las más recientes.
  // Todo resultado, incluso los omitidos de la animación, sigue en el historial.
  if (live.length >= ANIMATION_QUEUE_LIMIT) {
    const kept = [live[0], ...live.slice(-(ANIMATION_QUEUE_LIMIT - 2)), { roll, startsAt }];
    return kept.map((entry, i) => ({
      ...entry,
      startsAt: Math.max(entry.roll.createdAt * 1000 + ROLL_DELAY_MS, live[0].startsAt + i * ANIMATION_DURATION_MS),
    }));
  }
  return [...live, { roll, startsAt }];
}

export interface DieMotion {
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  spin: [number, number, number];
  twist: number;
  delay: number;
  duration: number;
}

export function planMotion(rollId: string, index: number, count: number): DieMotion {
  const random = seededRandom(`${rollId}:${index}`);
  const columns = Math.ceil(Math.sqrt(count * 1.8));
  const rows = Math.ceil(count / columns);
  const row = Math.floor(index / columns);
  const inRow = Math.min(columns, count - row * columns);
  return {
    x: ((index % columns) - (inRow - 1) / 2) * 2.5 + (random() - 0.5) * 0.22,
    y: ((rows - 1) / 2 - row) * 2.5 + (random() - 0.5) * 0.22,
    fromX: -columns * 1.25 - 4 - random() * 3,
    fromY: (random() - 0.5) * (rows * 2 + 4),
    spin: [random() * 12 + 10, random() * 12 + 10, (random() - 0.5) * 18],
    twist: (random() - 0.5) * 0.4,
    delay: random() * 160,
    duration: ROLL_DURATION_MS - 160,
  };
}

export function sampleMotion(motion: DieMotion, elapsed: number) {
  const progress = Math.max(0, Math.min(1, (elapsed - motion.delay) / motion.duration));
  const remaining = 1 - progress;
  const drift = remaining ** 3;
  return {
    x: motion.x + (motion.fromX - motion.x) * drift,
    y: motion.y + (motion.fromY - motion.y) * drift,
    height: Math.abs(Math.sin(remaining * Math.PI * 3.5)) * 3.2 * remaining,
    spin: motion.spin.map((n) => n * remaining ** 2) as [number, number, number],
    settled: progress >= 1,
  };
}
