import assert from "node:assert/strict";
import test from "node:test";
import type { DiceRoll } from "../dice";
import { useStore } from "../store";
import {
  ANIMATION_DURATION_MS, ANIMATION_LIMIT, ROLL_DELAY_MS, ROLL_DURATION_MS,
  planMotion, addDiceAnimation, sampleMotion, visualDice, type DiceAnimation,
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

test("varios jugadores ruedan simultáneamente en ambos clientes, sin esperar turnos", () => {
  let a: DiceAnimation[] = [], b: DiceAnimation[] = [];
  for (let i = 0; i < 5; i++) {
    const result = { ...roll(`r${i}`), clientId: `player${i}` };
    a = addDiceAnimation(a, result, 1000010);
    b = addDiceAnimation(b, result, 1000140);
  }
  assert.deepEqual(a, b);
  assert.equal(a[0].startsAt, 1000000 + ROLL_DELAY_MS);
  assert.ok(a.every((entry) => entry.startsAt === a[0].startsAt));
  for (const entry of a) {
    const pose = sampleMotion(planMotion(entry.roll.id, 0, 2), 1000);
    assert.equal(pose.settled, false);
    assert.ok(pose.height > 0);
  }
  assert.deepEqual(addDiceAnimation(a, a[0].roll, 1000020), a);
});

test("una tirada nueva no reinicia ni retrasa la animación que ya está rodando", () => {
  const original = addDiceAnimation([], roll("first"), 1000000);
  const nextRoll = { ...roll("second"), clientId: "p2", createdAt: 1001.25 };
  const concurrent = addDiceAnimation(original, nextRoll, 1001260);
  assert.deepEqual(concurrent[0], original[0]);
  assert.equal(concurrent[1].startsAt, 1001250 + ROLL_DELAY_MS);
  assert.ok(concurrent[1].startsAt < concurrent[0].startsAt + ROLL_DURATION_MS);
});

test("una ráfaga conserva hasta ocho vistas recientes sin acumular esperas", () => {
  let animations: DiceAnimation[] = [];
  for (let i = 0; i < 100; i++) animations = addDiceAnimation(animations, roll(`r${i}`), 1000000);
  assert.equal(animations.length, ANIMATION_LIMIT);
  assert.equal(animations[0].roll.id, "r92");
  assert.equal(animations[animations.length - 1]?.roll.id, "r99");
  assert.ok(animations.every((entry) => entry.startsAt === 1000000 + ROLL_DELAY_MS));
  assert.deepEqual(addDiceAnimation([], roll(), 1000000 + ANIMATION_DURATION_MS + 1000), []);
});

test("cada tirada vence a su tiempo y conserva las otras animaciones activas", () => {
  const first = addDiceAnimation([], roll("first"), 1000000);
  const second = addDiceAnimation(first, { ...roll("second"), createdAt: 1001 }, 1001000);
  const third = addDiceAnimation(second, { ...roll("third"), createdAt: 1004 }, 1004500);
  assert.deepEqual(third.map((entry) => entry.roll.id), ["second", "third"]);
  assert.equal(third[0].startsAt, second[1].startsAt);
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
  const other = { ...roll("other"), clientId: "p2", author: "Berta", createdAt: now };
  st.addDiceRoll(current);
  st.addDiceRoll(other);
  st.addDiceRoll(current);
  assert.equal(useStore.getState().diceAnimations.length, 2);
  const originalStart = useStore.getState().diceAnimations[1].startsAt;
  st.finishDiceAnimation(current.id);
  assert.deepEqual(useStore.getState().diceAnimations.map((entry) => entry.roll.id), [other.id]);
  assert.equal(useStore.getState().diceAnimations[0].startsAt, originalStart);
  assert.equal(useStore.getState().diceRolls.length, 3);
});
