import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectWallPairs } from '../src/core/walls.js';
import { slicePolylines, planFrame } from '../src/core/slice.js';
import { box, concat } from './helpers/meshes.js';

test('double wall', () => {
  const m = concat(box(4, 3, 2.5), box(3, 3, 2.5, [4.24, 0, 0]));
  const polys = slicePolylines(m, planFrame(1.0));
  const pairs = detectWallPairs(polys);
  assert.equal(pairs.length, 1);
  assert.ok(Math.abs(pairs[0].thickness - 0.24) <= 0.005, `thickness ${pairs[0].thickness}`);
  assert.equal(pairs[0].polygon.length, 8);
});
