import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elevation } from '../src/core/views.js';
import { polylinesBBox } from '../src/core/polyline.js';
import { box } from './helpers/meshes.js';

test('box front', () => {
  const m = box(4, 3, 2.5);
  const f = elevation(m, 'front');
  const bb = polylinesBBox(f.outline);
  assert.ok(Math.abs(bb.maxX - bb.minX - 4) <= 0.02, `width ${bb.maxX - bb.minX}`);
  assert.ok(Math.abs(bb.maxY - bb.minY - 2.5) <= 0.02, `height ${bb.maxY - bb.minY}`);
  assert.equal(f.title, 'Elevation Front');
  assert.equal(f.rgba.length, f.width * f.height * 4);
  const r = polylinesBBox(elevation(m, 'right').outline);
  assert.ok(Math.abs(r.maxX - r.minX - 3) <= 0.02, `right width ${r.maxX - r.minX}`);
});

test('resolution cap', () => {
  const f = elevation(box(60, 2, 3), 'front');
  assert.ok(Math.max(f.width, f.height) <= 4096, `${f.width}×${f.height}`);
  const bb = polylinesBBox(f.outline);
  assert.ok(Math.abs(bb.maxX - bb.minX - 60) <= 2 * f.grid.res);
});
