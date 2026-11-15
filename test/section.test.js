import { test } from 'node:test';
import assert from 'node:assert/strict';
import { section } from '../src/core/views.js';
import { polylineLength, polylinesBBox } from '../src/core/polyline.js';
import { formatLevel } from '../src/core/measure.js';
import { heightMap } from '../src/core/terrain.js';
import { buildSectionDrawing } from '../src/core/drawing.js';
import { layoutSheet } from '../src/export/sheet.js';
import { sheetToSvg } from '../src/export/svg.js';
import { box, plane } from './helpers/meshes.js';

test('box section', () => {
  const s = section(box(4, 3, 2.5), [2, -1], [2, 4], 1);
  assert.equal(s.cut.length, 1);
  const bb = polylinesBBox(s.cut);
  assert.ok(Math.abs(bb.maxX - bb.minX - 3) <= 0.005);
  assert.ok(Math.abs(bb.maxY - bb.minY - 2.5) <= 0.005);
  assert.ok(Math.abs(polylineLength(s.cut[0]) - 11) <= 0.01);
  assert.equal(s.beyond.empty, false);
});

test('level label format', () => {
  assert.equal(formatLevel(2.47), '+2.47');
  assert.equal(formatLevel(-0.18), '−0.18');
  assert.equal(formatLevel(0.001), '±0.00');
  assert.equal(formatLevel(2.5), '+2.50');
});

test('excavation hatch', () => {
  const terrain = plane(10, 100, (x) => 0.1 * x);
  const hm = heightMap(terrain, 0.05);
  const cut = { type: 'section', label: 'A', a: [0, -3], b: [10, -3], side: 1 };
  const s = section(terrain, cut.a, cut.b, cut.side, { depth: 1 });
  const ex = { id: 'e1', type: 'excavation', polygon: [2, -1, 6, -1, 6, -6, 2, -6], mode: 'level', level: -0.5 };
  const d = buildSectionDrawing(s, cut, [ex], hm);
  assert.ok(d.items.some((i) => i.k === 'fill' && i.style === 'cutHatch'));
  assert.ok(d.items.some((i) => i.k === 'line' && i.style === 'target'));
  const svg = sheetToSvg(layoutSheet(d, { paper: 'A4', orientation: 'landscape', scale: 100, project: 'T', date: '2026-11-15' }));
  assert.ok(svg.includes('#8B5A2B'));
});

test('saved view measurements appear in the drawing', () => {
  const s = section(box(4, 3, 2.5), [2, -1], [2, 4], 1);
  const cut = { type: 'section', label: 'A', a: [2, -1], b: [2, 4], side: 1 };
  const m = { id: 'm1', type: 'measure', view: 'section-A', a: [0, 0], b: [0, 2.5] };
  const d = buildSectionDrawing(s, cut, [m, { ...m, id: 'm2', view: 'elev-front' }], null);
  assert.equal(d.items.filter((i) => i.k === 'line' && i.style === 'measure').length, 1);
  assert.ok(d.items.some((i) => i.k === 'text' && i.text === '250.0 cm'));
});
