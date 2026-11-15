import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markupQuantities, markupPolygon, markupCsv, validateMarkup } from '../src/core/markup.js';
import { UndoableState } from '../src/store/annotations.js';
import { sheetToSvg } from '../src/export/svg.js';
import { boxSheet } from './helpers/pipeline.js';
import { identity } from '../src/core/mat4.js';

const DEMO = { id: 'd1', type: 'demolition', a: [0, 0], b: [3, 0], height: 2.5, thickness: 0.24, side: 1, note: 'Wand Küche' };
const NEW = { id: 'n1', type: 'new', a: [1, -1], b: [1, -2.5], thickness: 0.115, align: 'center' };

test('demolition quantities', () => {
  const q = markupQuantities(DEMO);
  assert.ok(Math.abs(q.length - 3) < 1e-12);
  assert.ok(Math.abs(q.area - 7.5) < 1e-9);
  assert.ok(Math.abs(q.volume - 1.8) < 1e-9);
  const poly = markupPolygon(NEW);
  const xs = poly.filter((_, i) => i % 2 === 0);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 0.115) < 1e-9);
  assert.throws(() => validateMarkup({ ...NEW, thickness: 2 }), /between 1 and 100 cm/);
  assert.throws(() => validateMarkup({ ...DEMO, note: 'x'.repeat(201) }), /200/);
});

test('svg colors', () => {
  const svg = sheetToSvg(boxSheet(50, [DEMO, NEW]));
  assert.match(svg, /<path [^>]*fill="#FFD600"[^>]*stroke-dasharray="3 1.5"/);
  assert.match(svg, /<path [^>]*fill="#E30613"/);
  for (const t of ['Existing (Bestand)', 'Demolition (Abbruch)', 'New (Neubau)']) assert.ok(svg.includes(t));
});

test('bw mode', () => {
  const svg = sheetToSvg(boxSheet(50, [DEMO, NEW], { bw: true }));
  assert.ok(!svg.includes('#FFD600') && !svg.includes('#E30613'));
  assert.ok(svg.includes('class="cross"'));
  assert.ok(svg.includes('class="hatch"'));
  assert.ok(svg.includes('stroke-dasharray'));
});

test('undo redo', () => {
  const s = new UndoableState({ annotations: [], orientation: identity(), calibration: null });
  const ids = [];
  for (let i = 0; i < 60; i++) ids.push(s.add({ type: 'new', a: [0, i], b: [1, i], thickness: 0.115, align: 'left' }));
  s.update(ids[0], { a: [5, 5] });
  s.remove(ids[1]);
  assert.equal(s.state.annotations.length, 59);
  assert.ok(s.undo()); // delete
  assert.equal(s.state.annotations.length, 60);
  assert.ok(s.undo()); // move
  assert.deepEqual(s.get(ids[0]).a, [0, 0]);
  assert.ok(s.redo());
  assert.deepEqual(s.get(ids[0]).a, [5, 5]);
  s.undo();
  let n = 0;
  while (s.undo()) n++;
  assert.ok(n >= 50, `only ${n} undo steps`);
  s.apply((d) => { d.calibration = { factor: 1.01, refCm: 100 }; });
  s.undo();
  assert.equal(s.state.calibration, null);
});

test('csv', () => {
  const csv = markupCsv([DEMO, NEW, { ...DEMO, id: 'd2', note: 'a;b' }]);
  assert.ok(csv.startsWith('﻿'));
  const rows = csv.slice(1).trim().split('\r\n');
  assert.equal(rows[0], 'Type;Length (m);Height (m);Area (m²);Thickness (m);Volume (m³);Note');
  assert.equal(rows[1], 'Demolition (Abbruch);3,00;2,50;7,50;0,240;1,800;Wand Küche');
  assert.ok(rows.some((r) => r.startsWith('Total Demolition (Abbruch);6,00;;15,00;;3,600')));
  assert.ok(rows.some((r) => r.endsWith('"a;b"')));
});
