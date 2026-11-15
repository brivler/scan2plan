import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sheetToPdf, winAnsi } from '../src/export/pdf.js';
import { fitScale } from '../src/export/sheet.js';
import { boxSheet } from './helpers/pipeline.js';
import { buildPlanDrawing } from '../src/core/drawing.js';

const text = (bytes) => Buffer.from(bytes).toString('latin1');

test('structure', () => {
  const pdf = sheetToPdf(boxSheet(100));
  const s = text(pdf);
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.equal(s.trimEnd().slice(-5), '%%EOF');
  const startxref = Number(/startxref\n(\d+)/.exec(s)[1]);
  assert.ok(s.slice(startxref).startsWith('xref'));
  const lines = s.slice(startxref).split('\n');
  const count = Number(lines[1].split(' ')[1]);
  for (let id = 1; id < count; id++) {
    const off = Number(lines[2 + id].slice(0, 10));
    assert.ok(s.slice(off).startsWith(`${id} 0 obj`), `object ${id} offset`);
  }
  const mb = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(s);
  assert.ok(Math.abs(Number(mb[1]) - 841.89) <= 0.01 && Math.abs(Number(mb[2]) - 595.28) <= 0.01);
  assert.deepEqual(winAnsi('äöüß–'), [0xe4, 0xf6, 0xfc, 0xdf, 0x96]);
});

test('scale 1:100', () => {
  const s = text(sheetToPdf(boxSheet(100)));
  const m = /\/s-cut BMC\n[^\n]*\n([^\n]*)\nEMC/.exec(s);
  assert.ok(m, 'cut path present');
  const xs = [...m[1].matchAll(/([\d.]+) ([\d.]+) [ml]/g)].map((x) => Number(x[1]));
  const span = Math.max(...xs) - Math.min(...xs);
  assert.ok(Math.abs(span - 113.39) <= 0.1, `span ${span}`);
});

test('fit', () => {
  const d = buildPlanDrawing({ h: 1, outline: [{ pts: [0, 0, 30, 0, 30, 4, 0, 4], closed: true }] }, []);
  assert.deepEqual(fitScale(d, 'A4', 'landscape'), { scale: 200 });
  const huge = buildPlanDrawing({ h: 1, outline: [{ pts: [0, 0, 300, 0, 300, 4, 0, 4], closed: true }] }, []);
  const r = fitScale(huge, 'A3', 'landscape');
  assert.equal(r.error, 'Drawing does not fit A3 at 1:500');
  assert.equal(r.suggest, 1000);
});
