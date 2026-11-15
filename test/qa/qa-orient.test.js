/**
 * QA adversarial orientation tests (REQ-020, REQ-021) on realistic interior scans
 * (inward normals, partial floors, furniture, Z-up exports).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoOrient, chooseUpAxis, levelFloor, detectYaw } from '../../src/core/orient.js';
import { computeBBox, transformPositions, faceData } from '../../src/core/mesh.js';
import { slicePolylines, planFrame } from '../../src/core/slice.js';
import { polylineLength } from '../../src/core/polyline.js';
import { transformMesh, rot } from '../helpers/meshes.js';
import { room, yUpToZUp, near } from './qa-helpers.js';

const oriented = (m, format) => {
  const o = autoOrient(m.positions, m.indices, { format });
  return { ...o, positions: transformPositions(m.positions, o.matrix) };
};

test('QA Y-up OBJ of a normal room (4×3×2.5, inward normals) stays upright', () => {
  const m = room(4, 3, 2.5);
  assert.deepEqual(chooseUpAxis(m.positions, m.indices), [0, 1, 0]);
  const bb = computeBBox(oriented(m, 'obj').positions);
  near(assert, bb.max[1] - bb.min[1], 2.5, 0.001, 'height');
});

for (const [w, d, label] of [[2, 1.5, 'bathroom 2×1.5'], [5, 2, 'corridor 5×2'], [1.2, 1.0, 'WC 1.2×1.0']]) {
  test(`QA Y-up OBJ of a ${label} m room stays upright`, { todo: 'DEF-03: a wall larger than the floor wins the up-axis vote' }, () => {
    const m = room(w, d, 2.5);
    assert.deepEqual(chooseUpAxis(m.positions, m.indices), [0, 1, 0]);
  });
}

test('QA Y-up OBJ with partly scanned floor (60 %) is not turned upside down', { todo: 'DEF-03: ceiling area beats the visible floor → −Y chosen' }, () => {
  const m = room(4, 3, 2.5, { floorFraction: 0.6 });
  assert.deepEqual(chooseUpAxis(m.positions, m.indices), [0, 1, 0]);
});

test('QA Z-up OBJ of a normal room is levelled (inward normals)', () => {
  const m = yUpToZUp(room(4, 3, 2.5));
  const bb = computeBBox(oriented(m, 'obj').positions);
  near(assert, bb.max[1] - bb.min[1], 2.5, 0.001, 'height after levelling');
  near(assert, bb.min[1], 0, 0.001, 'floor at 0');
});

test('QA low furniture (bed top at 0.45 m) must not tilt the floor', { todo: 'DEF-04: LSQ plane over all horizontal faces in the lowest 20 % includes the bed' }, () => {
  const m = room(4, 3, 2.5, { bed: [0, 0, 2, 1.6, 0.45], n: 4 });
  const lv = levelFloor(m.positions, m.indices);
  assert.ok(lv.tiltDeg < 0.05, `tilt applied ${lv.tiltDeg.toFixed(2)}°`);
  near(assert, lv.floorY, 0, 0.005, 'floor level');
});

test('QA room rotated 30° about Y and tilted 1.5° (glTF) is fully aligned', () => {
  const m = transformMesh(transformMesh(room(4, 3, 2.5, { n: 4 }), rot([0, 1, 0], 30)), rot([1, 0, 0], 1.5));
  const o = oriented(m, 'glb');
  const { normals, areas } = faceData(o.positions, m.indices);
  for (let t = 0; t < areas.length; t++) {
    const n = [normals[3 * t], normals[3 * t + 1], normals[3 * t + 2]];
    const best = Math.max(...n.map(Math.abs));
    assert.ok(Math.acos(Math.min(1, best)) * 180 / Math.PI < 0.5, `face ${t} not axis-parallel`);
  }
  const plan = slicePolylines({ positions: o.positions, indices: m.indices }, planFrame(1));
  near(assert, polylineLength(plan[0]), 14, 0.01, 'perimeter');
});

test('QA ceiling-only mesh and floor-only mesh do not crash orientation', () => {
  for (const m of [room(4, 3, 2.5, { floor: false, walls: false }), room(4, 3, 2.5, { ceiling: false, walls: false })]) {
    const o = autoOrient(m.positions, m.indices, { format: 'obj' });
    assert.ok(o.matrix.every(Number.isFinite));
    assert.equal(detectYaw(m.positions, m.indices), null, 'no walls → no yaw');
  }
});

test('QA degenerate triangles do not produce NaN orientation', () => {
  const m = room(4, 3, 2.5);
  const idx = new Uint32Array([...m.indices, 0, 0, 0, 1, 1, 2]);
  const o = autoOrient(m.positions, idx, { format: 'obj' });
  assert.ok(o.matrix.every(Number.isFinite));
});
