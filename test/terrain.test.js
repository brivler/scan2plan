import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heightMap, excavation, truckLoads, contours, heightImage } from '../src/core/terrain.js';
import { plane } from './helpers/meshes.js';

const terrain = () => plane(10, 100, (x) => 0.1 * x);
// polygon x ∈ [2,6], z ∈ [1,6] → plan y = −z ∈ [−6, −1]
const POLY = [2, -1, 6, -1, 6, -6, 2, -6];

test('heightmap', () => {
  const hm = heightMap(terrain(), 0.05);
  const i = Math.round((5.025 - hm.x0) / hm.cell - 0.5), j = Math.floor((-5 - hm.y0) / hm.cell);
  assert.ok(Math.abs(hm.x0 + (i + 0.5) * hm.cell - 5.025) < 1e-9);
  assert.ok(Math.abs(hm.h[i + j * hm.nx] - 0.5025) <= 0.002, `${hm.h[i + j * hm.nx]}`);
  assert.equal(heightImage(hm).length, hm.nx * hm.ny * 4);
  const c = contours(hm, 0.1, 0.5);
  assert.ok(c.some((l) => l.major && Math.abs(l.level - 0.5) < 1e-9));
});

test('volume level', () => {
  const r = excavation(heightMap(terrain(), 0.05), POLY, { mode: 'level', level: -0.5 });
  assert.ok(Math.abs(r.area - 20) < 1e-9);
  assert.ok(Math.abs(r.cut - 18) <= 0.1, `cut ${r.cut}`);
  assert.equal(r.fill, 0);
});

test('constant depth', () => {
  const r = excavation(heightMap(terrain(), 0.05), POLY, { mode: 'depth', depth: 0.3 });
  assert.ok(Math.abs(r.cut - 6) <= 0.05, `cut ${r.cut}`);
  assert.throws(() => excavation(heightMap(terrain(), 0.05), POLY, { mode: 'depth', depth: 0 }));
});

test('trucks', () => {
  const loose = 18 * 1.25;
  assert.equal(loose, 22.5);
  assert.equal(truckLoads(loose, 10), 3);
  assert.equal(truckLoads(20, 10), 2);
  const r = excavation(heightMap(terrain(), 0.05), POLY, { mode: 'level', level: -0.5, bulking: 1.25, truck: 10 });
  assert.ok(Math.abs(r.loose - r.cut * 1.25) < 1e-9);
  assert.equal(r.trucks, 3);
});

test('coverage', () => {
  const hm = heightMap(terrain(), 0.05);
  // remove every 10th cell inside the polygon area (isolated holes are interpolated)
  let k = 0;
  for (let j = 0; j < hm.ny; j++) for (let i = 0; i < hm.nx; i++) if (k++ % 10 === 0) hm.h[i + j * hm.nx] = NaN;
  const r = excavation(hm, POLY, { mode: 'level', level: -0.5 });
  assert.ok(Math.abs(r.coverage * 100 - 90) <= 1, `coverage ${r.coverage}`);
  assert.equal(r.warning, true);
  assert.ok(r.interpolatedCells > 0);
  assert.ok(Math.abs(r.cut - 18) <= 0.1, 'interpolated volume still correct');
});
