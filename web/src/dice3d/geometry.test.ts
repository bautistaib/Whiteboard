import assert from "node:assert/strict";
import test from "node:test";
import { Vector3 } from "three";
import { buildDieShape, restingQuaternion } from "./geometry";

for (const sides of [4, 6, 8, 10, 12, 20]) {
  test(`d${sides}: caras planas, cerradas y orientadas al resultado autoritativo`, () => {
    const shape = buildDieShape(sides);
    assert.equal(shape.faces.length, sides);
    const edges = new Map<string, number>();
    for (const face of shape.faces) {
      const distance = face.normal.dot(face.center);
      assert.ok(distance > 0);
      for (const vertex of face.vertices) assert.ok(Math.abs(face.normal.dot(vertex) - distance) < 0.00001);
      for (let i = 0; i < face.vertices.length; i++) {
        const endpoints = [face.vertices[i], face.vertices[(i + 1) % face.vertices.length]];
        const key = endpoints.map((p) => p.toArray().map((n) => Math.round(n * 10000)).join(",")).sort().join("|");
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
      const rest = restingQuaternion(face);
      assert.ok(face.normal.clone().applyQuaternion(rest).distanceTo(new Vector3(0, 0, 1)) < 0.00001);
      assert.ok(face.up.clone().applyQuaternion(rest).distanceTo(new Vector3(0, 1, 0)) < 0.00001);
    }
    assert.ok([...edges.values()].every((count) => count === 2), "cada arista pertenece a dos caras");
    const uv = shape.geometry.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) {
      assert.ok(uv.getX(i) >= 0 && uv.getX(i) <= 1);
      assert.ok(uv.getY(i) >= 0 && uv.getY(i) <= 1);
    }
    shape.geometry.dispose();
  });
}

test("un dado especial usa una ficha con cara superior legible", () => {
  const shape = buildDieShape(37);
  const top = shape.faces.find((face) => face.normal.z > 0.9);
  assert.ok(top);
  assert.equal(top.vertices.length, 4);
  shape.geometry.dispose();
});
