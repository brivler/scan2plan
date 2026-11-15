import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestUnitScale, autoOrient, detectYaw, reorient } from '../src/core/orient.js';
import { computeBBox, transformPositions, faceData } from '../src/core/mesh.js';
import { identity } from '../src/core/mat4.js';
import { box, transformMesh, rot, Builder } from './helpers/meshes.js';

const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);

test('unit heuristic', () => {
  const bb = (m) => computeBBox(m.positions);
  assert.equal(suggestUnitScale(bb(box(4000, 3000, 2500)), 'glb').scale, 0.001);
  assert.equal(suggestUnitScale(bb(box(400, 300, 250)), 'obj').scale, 0.01);
  assert.equal(suggestUnitScale(bb(box(400, 300, 250)), 'glb').scale, null);
  const ok = suggestUnitScale(bb(box(4, 3, 2.5)), 'obj');
  assert.equal(ok.scale, null);
  assert.equal(ok.warning, null);
  assert.equal(suggestUnitScale(bb(box(0.01, 0.01, 0.01)), 'obj').warning, 'tiny');
});

test('z-up box', () => {
  // height 2.5 along Z: box(4, 2.5, 3) has Z extent 2.5
  const m = box(4, 2.5, 3);
  const r = autoOrient(m.positions, m.indices, { format: 'obj' });
  const bb = computeBBox(transformPositions(m.positions, r.matrix));
  near(bb.max[1] - bb.min[1], 2.5, 0.001, 'Y extent');
  near(bb.min[1], 0, 0.001, 'floor');
});

test('tilted floor', () => {
  const m = transformMesh(box(4, 3, 2.5), rot([1, 0, 0], 2));
  const r = autoOrient(m.positions, m.indices, { format: 'glb' });
  const p = transformPositions(m.positions, r.matrix);
  const { normals, areas, centroids } = faceData(p, m.indices);
  let floorY = null;
  for (let t = 0; t < areas.length; t++) {
    if (Math.abs(normals[3 * t + 1]) > 0.97 && centroids[3 * t + 1] < 1) {
      const ang = (Math.acos(Math.min(1, Math.abs(normals[3 * t + 1]))) * 180) / Math.PI;
      assert.ok(ang < 0.05, `floor normal angle ${ang}`);
      floorY = centroids[3 * t + 1];
    }
  }
  assert.ok(floorY !== null);
  near(floorY, 0, 0.001, 'floor Y');
  near(r.tiltDeg, 2, 0.05, 'tilt');
});

test('facade no floor', () => {
  // single vertical 10×6 m plane (normal −Z), glTF so +Y is the up axis
  const b = new Builder(true);
  b.grid([0, 0.7, 0], [0, 6.7, 0], [10, 6.7, 0], [10, 0.7, 0], 10, 10);
  const m = b.mesh();
  const r = autoOrient(m.positions, m.indices, { format: 'glb' });
  assert.equal(r.hasFloor, false);
  assert.equal(r.tiltDeg, 0);
  const bb = computeBBox(transformPositions(m.positions, r.matrix));
  near(bb.min[1], 0, 1e-6, 'min Y');
  near(bb.max[1], 6, 1e-5, 'height kept');
});

for (const deg of [23, 67, 89.7]) {
  test(`yaw ${deg}deg`, () => {
    const m = transformMesh(box(4, 3, 2.5), rot([0, 1, 0], deg));
    const yaw = detectYaw(m.positions, m.indices);
    let d = Math.abs(yaw - deg) % 90;
    if (d > 45) d = 90 - d;
    assert.ok(d <= 0.5, `detected ${yaw}`);
    const r = reorient(m.positions, m.indices, identity());
    const { normals, areas } = faceData(transformPositions(m.positions, r.matrix), m.indices);
    for (let t = 0; t < areas.length; t++) {
      const nx = normals[3 * t], nz = normals[3 * t + 2];
      if (Math.abs(normals[3 * t + 1]) > 0.2) continue;
      const ang = (Math.acos(Math.min(1, Math.max(Math.abs(nx), Math.abs(nz)))) * 180) / Math.PI;
      assert.ok(ang < 0.5, `wall normal off by ${ang}°`);
    }
  });
}
