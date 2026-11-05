import assert from "node:assert/strict";
import test from "node:test";
import type { DiceRoll } from "../dice";
import { useStore } from "../store";
import {
  ANIMATION_DURATION_MS, ANIMATION_QUEUE_LIMIT, ROLL_DELAY_MS, ROLL_DURATION_MS,
  planMotion, queueDiceAnimation, sampleMotion, visualDice, type DiceAnimation,
} from "./animation";

function roll(id = "roll1", sides = 20, values = [4, 18]): DiceRoll {
  return {
    id, opId: id, clientId: "p1", author: "Ana", label: "", createdAt: 1000,
    expression: `2d${sides}kh1`, total: values[1],
    terms: [{ kind: "dice", notation: `2d${sides}kh1`, sides, sign: 1, rolls: values, kept: [false, true], subtotal: values[1] }],
  };
}

test("el d100 representa 1, 10 y 100 con decenas y unidades correctas", () => {
  const dice = visualDice(roll("percentile", 100, [1, 10, 100]));
  assert.deepEqual(dice.map((d) => d.value), [0, 1, 1, 0, 0, 0]);
  assert.deepEqual(dice.map((d) => d.kind), ["tens", "units", "tens", "units", "tens", "units"]);
  assert.deepEqual(dice.slice(0, 2).map((d) => d.kept), [false, false]);
});

test("los modificadores no crean dados y los dados especiales conservan su valor", () => {
  const result = roll("custom", 37, [12, 35]);
  result.terms.push({ kind: "constant", notation: "5", sign: 1, value: 5, subtotal: 5 });
  assert.deepEqual(visualDice(result).map((d) => [d.kind, d.sides, d.value]), [["custom", 37, 12], ["custom", 37, 35]]);
});

test("dos clientes reproducen la misma trayectoria, independientemente de los frames", () => {
  const a = planMotion("server-id", 0, 6), b = planMotion("server-id", 0, 6);
  assert.deepEqual(a, b);
  for (const elapsed of [0, 220, 812, 1500, ROLL_DURATION_MS]) {
    assert.deepEqual(sampleMotion(a, elapsed), sampleMotion(b, elapsed));
  }
  assert.notDeepEqual(a, planMotion("another-id", 0, 6));
  assert.notDeepEqual(a, planMotion("server-id", 1, 6));
});

test("todos los dados se detienen, sin salto de posición ni rotación al final", () => {
  for (let i = 0; i < 200; i++) {
    const motion = planMotion("many-dice", i, 200);
    const final = sampleMotion(motion, ROLL_DURATION_MS);
    assert.equal(final.x, motion.x);
    assert.equal(final.y, motion.y);
    assert.equal(final.height, 0);
    assert.ok(final.spin.every((angle) => angle === 0));
    assert.equal(final.settled, true);
  }
});

test("tiradas simultáneas se programan en el mismo orden en ambos clientes", () => {
  let a: DiceAnimation[] = [], b: DiceAnimation[] = [];
  for (let i = 0; i < 5; i++) {
    const result = roll(`r${i}`);
    a = queueDiceAnimation(a, result, 1000010);
    b = queueDiceAnimation(b, result, 1000140);
  }
  assert.deepEqual(a, b);
  assert.equal(a[0].startsAt, 1000000 + ROLL_DELAY_MS);
  assert.equal(a[1].startsAt, a[0].startsAt + ANIMATION_DURATION_MS);
  assert.deepEqual(queueDiceAnimation(a, a[0].roll, 1000020), a);
});

test("una ráfaga mantiene acotados la cola y el tiempo de espera", () => {
  let queue: DiceAnimation[] = [];
  for (let i = 0; i < 100; i++) queue = queueDiceAnimation(queue, roll(`r${i}`), 1000000);
  assert.equal(queue.length, ANIMATION_QUEUE_LIMIT);
  assert.equal(queue[0].roll.id, "r0");
  assert.equal(queue[queue.length - 1]?.roll.id, "r99");
  assert.equal(queue[queue.length - 1]?.startsAt, queue[0].startsAt + (ANIMATION_QUEUE_LIMIT - 1) * ANIMATION_DURATION_MS);
  assert.deepEqual(queueDiceAnimation([], roll(), 1000000 + ANIMATION_DURATION_MS + 1000), []);
});

test("snapshot de reconexión no anima el historial; cada resultado nuevo se anima una sola vez", () => {
  const st = useStore.getState();
  const now = Date.now() / 1000;
  const previous = { ...roll("previous"), createdAt: now - 60 };
  st.setSession({ diceRolls: [], diceAnimations: [], serverClockOffsetMs: 0 });
  st.applySnapshot({
    campaign: { name: "Mesa" }, scene: { id: "scene", name: "Escena", grid: {} },
    objects: [], users: [], scenes: [], library: {}, diceRolls: [previous],
  });
  assert.equal(useStore.getState().diceAnimations.length, 0);
  const current = { ...roll("live"), createdAt: now };
  st.addDiceRoll(current);
  st.addDiceRoll(current);
  assert.equal(useStore.getState().diceAnimations.length, 1);
  st.finishDiceAnimation(current.id);
  assert.equal(useStore.getState().diceAnimations.length, 0);
  assert.equal(useStore.getState().diceRolls.length, 2);
});
