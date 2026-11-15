import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decimateForDisplay } from '../src/core/decimate.js';
import { computeBBox } from '../src/core/mesh.js';
import { plane } from './helpers/meshes.js';

test('1M to 500k', () => {
  const m = plane(10, 708, (x, z) => 0.05 * Math.sin(x) * Math.cos(z));
  assert.ok(m.indices.length / 3 >= 1_000_000);
  const { mesh, cellSize } = decimateForDisplay(m);
  assert.ok(mesh.indices.length / 3 <= 500_000, `${mesh.indices.length / 3} triangles`);
  const a = computeBBox(m.positions), b = computeBBox(mesh.positions);
  for (let k = 0; k < 3; k++) {
    assert.ok(Math.abs(a.min[k] - b.min[k]) <= cellSize, `min ${k}`);
    assert.ok(Math.abs(a.max[k] - b.max[k]) <= cellSize, `max ${k}`);
  }
});

test('small unchanged', () => {
  const m = plane(5, 71); // 10,082 triangles
  const r = decimateForDisplay(m);
  assert.equal(r.mesh, m);
  assert.equal(r.cellSize, null);
});
