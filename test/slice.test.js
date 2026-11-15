import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slicePolylines, planFrame } from '../src/core/slice.js';
import { slicePoints } from '../src/core/terrain.js';
import { polylineLength, signedArea } from '../src/core/polyline.js';
import { box, lPrism, subdividedBox, mulberry32 } from './helpers/meshes.js';

const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);

test('box perimeter', () => {
  const polys = slicePolylines(box(4, 3, 2.5), planFrame(1.2));
  assert.equal(polys.length, 1);
  assert.equal(polys[0].closed, true);
  near(polylineLength(polys[0]), 14, 0.005, 'perimeter');
  near(Math.abs(signedArea(polys[0].pts)), 12, 0.005, 'area');
});

test('L-shape', () => {
  const polys = slicePolylines(lPrism(2.5), planFrame(1.0));
  assert.equal(polys.length, 1);
  near(polylineLength(polys[0]), 20, 0.005, 'perimeter');
  assert.equal(polys[0].pts.length / 2, 6);
});

test('noise', () => {
  const m = subdividedBox(4, 3, 2.5, 0.02);
  const rnd = mulberry32(42);
  for (let i = 0; i < m.positions.length; i++) m.positions[i] += (rnd() * 2 - 1) * 0.003;
  const polys = slicePolylines(m, planFrame(1.2));
  assert.equal(polys.length, 1);
  assert.equal(polys[0].pts.length / 2, 4);
  near(polylineLength(polys[0]), 14, 0.02, 'perimeter');
});

test('performance', () => {
  // ~1,000,000 triangles: 1 cm-ish subdivided box
  const m = subdividedBox(10, 8, 2.5, 0.022);
  const nt = m.indices.length / 3;
  assert.ok(nt >= 1_000_000, `only ${nt} triangles`);
  const t0 = performance.now();
  const polys = slicePolylines(m, planFrame(1.0));
  const dt = performance.now() - t0;
  assert.equal(polys.length, 1);
  assert.ok(dt < 1500, `slice took ${dt.toFixed(0)} ms`);
});

test('points ring', () => {
  const pts = [];
  const step = 0.005;
  for (let y = 0.9; y <= 1.1; y += step) {
    for (let x = 0; x <= 4 + 1e-9; x += step) { pts.push(x, y, 0, x, y, 3); }
    for (let z = 0; z <= 3 + 1e-9; z += step) { pts.push(0, y, z, 4, y, z); }
  }
  const polys = slicePoints(new Float32Array(pts), 1.0);
  const outer = polys.reduce((a, b) => (Math.abs(signedArea(b.pts)) > Math.abs(signedArea(a.pts)) ? b : a));
  near(polylineLength(outer), 14, 0.05, 'perimeter');
});
