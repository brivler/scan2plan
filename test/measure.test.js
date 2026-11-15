import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure3D, SNAP_3D_M, SNAP_2D_PX, nearestVertex, snap2D } from '../src/core/measure.js';

test('distance format', () => {
  // See IMPLEMENTATION_NOTES (REQ-030): |(3, 0.583, 1)| = 3.2156 m, the spec's "317.0" is an arithmetic slip.
  const r = measure3D([0, 0, 0], [3, 0.583, 1]);
  assert.equal(r.text, '321.6 cm');
  assert.equal(r.components, 'Δh 316.2 cm, Δv 58.3 cm');
  assert.equal(measure3D([0, 0, 0], [3.452, 0, 0]).text, '345.2 cm');
  assert.match(r.text, /^\d+\.\d cm$/);
});

test('snapping constants', () => {
  assert.equal(SNAP_3D_M, 0.02);
  assert.equal(SNAP_2D_PX, 24);
  const pos = new Float32Array([0, 0, 0, 1, 1, 1]);
  assert.deepEqual(nearestVertex(pos, [1.01, 1, 1]), [1, 1, 1]);
  assert.equal(nearestVertex(pos, [1.05, 1, 1]), null);
  const polys = [{ pts: [0, 0, 4, 0, 4, 3], closed: false }];
  assert.equal(snap2D([3.95, 0.02], polys, 0.1).snapped, 'vertex');
  assert.deepEqual(snap2D([2, 0.05], polys, 0.1), { point: [2, 0], snapped: 'line' });
  assert.equal(snap2D([2, 1], polys, 0.1).snapped, null);
});
