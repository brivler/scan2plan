import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectOpenings } from '../src/core/walls.js';
import { slicePolylines, planFrame } from '../src/core/slice.js';
import { Builder, wallWithHoles } from './helpers/meshes.js';

/** box(5,4,2.5) built from quads: door 0.90×2.00 in wall z=0, window 1.20×1.00 (sill 0.90) in wall x=5. */
export function roomWithOpenings() {
  const b = new Builder(true);
  wallWithHoles(b, 'x', 0, 5, 2.5, [{ from: 1.0, to: 1.9, bottom: 0, top: 2.0 }]);
  wallWithHoles(b, 'z', 5, 4, 2.5, [{ from: 1.4, to: 2.6, bottom: 0.9, top: 1.9 }]);
  wallWithHoles(b, 'x', 4, 5, 2.5, []);
  wallWithHoles(b, 'z', 0, 4, 2.5, []);
  b.quad([0, 0, 0], [5, 0, 0], [5, 0, 4], [0, 0, 4]);
  b.quad([0, 2.5, 0], [0, 2.5, 4], [5, 2.5, 4], [5, 2.5, 0]);
  return b.mesh();
}

test('door and window', () => {
  const m = roomWithOpenings();
  const high = slicePolylines(m, planFrame(1.0)), low = slicePolylines(m, planFrame(0.3));
  const ops = detectOpenings(high, low);
  const doors = ops.filter((o) => o.type === 'door'), windows = ops.filter((o) => o.type === 'window');
  assert.equal(doors.length, 1);
  assert.equal(windows.length, 1);
  assert.ok(Math.abs(doors[0].width - 0.9) <= 0.01, `door ${doors[0].width}`);
  assert.ok(Math.abs(windows[0].width - 1.2) <= 0.01, `window ${windows[0].width}`);
});
