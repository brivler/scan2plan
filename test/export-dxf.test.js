import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawingToDxf } from '../src/export/dxf.js';
import { boxPlan } from './helpers/pipeline.js';

/** Minimal group-code parser → array of entities {type, codes:[[code,value]…]}. */
function parse(dxf) {
  const lines = dxf.split('\n');
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i].trim()), lines[i + 1]]);
  return pairs;
}

test('box polyline', () => {
  const dxf = drawingToDxf(boxPlan());
  const pairs = parse(dxf);
  const i = pairs.findIndex(([c, v], k) => c === 0 && v === 'POLYLINE' && pairs[k + 1][1] === 'S2P_EXISTING');
  assert.ok(i >= 0);
  const flags = pairs.slice(i, i + 8).find(([c]) => c === 70);
  assert.equal(flags[1], '1');
  const verts = [];
  for (let k = i + 1; pairs[k][1] !== 'SEQEND'; k++) {
    if (pairs[k][0] === 10) verts.push([Number(pairs[k][1]), Number(pairs[k + 1][1])]);
  }
  const vs = verts.slice(1); // first 10/20 belongs to the POLYLINE header
  assert.equal(vs.length, 4);
  const xs = vs.map((v) => v[0]), ys = vs.map((v) => v[1]);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 4) <= 1e-4);
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 3) <= 1e-4);
});

test('layers', () => {
  const dxf = drawingToDxf(boxPlan());
  for (const l of ['S2P_EXISTING', 'S2P_BEYOND', 'S2P_DEMOLITION', 'S2P_NEW', 'S2P_DIMENSIONS', 'S2P_TEXT', 'S2P_SECTIONLINES', 'S2P_EXCAVATION']) {
    assert.ok(dxf.includes(`0\nLAYER\n2\n${l}\n`), `layer ${l}`);
  }
  assert.ok(dxf.includes('$ACADVER\n1\nAC1009'));
  assert.ok(dxf.includes('$INSUNITS\n70\n6'));
  assert.ok(dxf.includes('2\nDASHED'));
  assert.ok(!dxf.includes('\r'), 'LF only');
  assert.ok(dxf.endsWith('0\nEOF\n'));
});
