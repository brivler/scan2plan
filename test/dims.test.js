import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDimensions, formatCm } from '../src/core/dims.js';
import { slicePolylines, planFrame } from '../src/core/slice.js';
import { box } from './helpers/meshes.js';

test('box dims', () => {
  const dims = planDimensions(slicePolylines(box(4, 3, 2.5), planFrame(1.0)));
  const overall = dims.filter((d) => d.kind === 'overall').map((d) => d.text);
  assert.equal(overall.filter((t) => t === '400').length, 2);
  assert.equal(overall.filter((t) => t === '300').length, 2);
  assert.ok(dims.some((d) => d.kind === 'segment'));
});

test('rounding', () => {
  assert.equal(formatCm(3.4549), '345');
  assert.equal(formatCm(3.455), '346');
  assert.equal(formatCm(4), '400');
});
