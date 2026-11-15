import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrationFactor, applyScale, calibrationText } from '../src/core/measure.js';
import { identity } from '../src/core/mat4.js';
import { transformPositions } from '../src/core/mesh.js';
import { slicePolylines, planFrame } from '../src/core/slice.js';
import { polylineLength } from '../src/core/polyline.js';
import { box } from './helpers/meshes.js';

test('factor', () => {
  const { factor, unusual } = calibrationFactor(0.987, 100.0);
  assert.ok(Math.abs(factor - 1.01317) <= 1e-5);
  assert.equal(unusual, false);
  assert.equal(calibrationText({ factor: 1.0123, refCm: 100 }), 'Scale calibrated ×1.0123 on 100.0 cm reference');
  assert.equal(calibrationText(null), 'Scale: as scanned (not calibrated)');
  assert.throws(() => calibrationFactor(0, 100));
});

test('rescaled perimeter', () => {
  const { factor } = calibrationFactor(0.987, 100.0);
  const m = box(4, 3, 2.5);
  const t = applyScale(identity(), factor);
  const polys = slicePolylines({ positions: transformPositions(m.positions, t), indices: m.indices }, planFrame(1.2));
  assert.ok(Math.abs(polylineLength(polys[0]) - 14.184) <= 0.005);
  // second calibration multiplies onto the current scale
  const t2 = applyScale(t, 2);
  assert.ok(Math.abs(t2[0] - 2 * factor) < 1e-12);
});

test('warning range', () => {
  const r = calibrationFactor(1.0, 140);
  assert.ok(Math.abs(r.factor - 1.4) < 1e-12);
  assert.equal(r.unusual, true);
  assert.equal(calibrationFactor(1.0, 79).unusual, true);
  assert.equal(calibrationFactor(1.0, 124).unusual, false);
});
