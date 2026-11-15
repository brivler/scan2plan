import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { sheetToSvg } from '../src/export/svg.js';
import { scaleBarPrims, ACCURACY_NOTE } from '../src/export/sheet.js';
import { LINE_CUT_MM, LINE_BEYOND_MM } from '../src/core/styles.js';
import { boxSheet, svgPathBBox } from './helpers/pipeline.js';

test('box plan 1:50', () => {
  const svg = sheetToSvg(boxSheet(50));
  assert.match(svg, /width="297mm" height="210mm" viewBox="0 0 297 210"/);
  const bb = svgPathBBox(svg, 's-cut');
  assert.ok(Math.abs(bb.w - 80) <= 0.1, `w ${bb.w}`);
  assert.ok(Math.abs(bb.h - 60) <= 0.1, `h ${bb.h}`);
});

test('well-formed', () => {
  const errors = [];
  const doc = new DOMParser({ onError: (lvl, msg) => errors.push(msg) }).parseFromString(sheetToSvg(boxSheet(50, [], { author: 'A & B <x>' })), 'image/svg+xml');
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(doc.documentElement.nodeName, 'svg');
});

test('stroke widths', () => {
  assert.equal(LINE_CUT_MM, 0.5);
  assert.equal(LINE_BEYOND_MM, 0.18);
  const svg = sheetToSvg(boxSheet(50));
  const cut = [...svg.matchAll(/<path [^>]*class="s-cut"/g)];
  assert.ok(cut.length > 0);
  for (const m of cut) assert.match(m[0], /stroke-width="0.5"/);
});

test('scale bar', () => {
  const prims = scaleBarPrims(10, 100, 100);
  const labels = prims.filter((p) => p.cls === 'scalebar-label');
  const zero = labels.find((p) => p.text === '0'), one = labels.find((p) => p.text === '1');
  assert.ok(Math.abs(one.x - zero.x - 10) < 1e-9);
  const svg = sheetToSvg(boxSheet(100));
  assert.ok(svg.includes('1:100'));
  // bar length between 40 and 100 mm for all scales
  for (const s of [20, 25, 50, 100, 200, 500]) {
    const segs = scaleBarPrims(0, 0, s).filter((p) => p.cls === 'scalebar');
    const len = Math.max(...segs.flatMap((p) => p.pts.filter((_, i) => i % 2 === 0)));
    assert.ok(len >= 40 && len <= 100, `1:${s} bar ${len} mm`);
  }
});

test('title block', () => {
  const svg = sheetToSvg(boxSheet(50, [], { author: 'Jo', calibration: { factor: 1.0123, refCm: 100 } }));
  for (const t of ['Küche Süd', 'Floor plan +1.00', 'Scale 1:50', 'A4 landscape', '2026-11-15', 'Scale calibrated ×1.0123 on 100.0 cm reference', ACCURACY_NOTE, 'Scan2Plan', 'Jo']) {
    assert.ok(svg.includes(t), `missing ${t}`);
  }
  assert.ok(sheetToSvg(boxSheet(50)).includes('Scale: as scanned (not calibrated)'));
});
