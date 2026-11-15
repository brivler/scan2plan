/**
 * QA export validation with independent parsers: DXF via dxf-parser, PDF via qpdf --check,
 * SVG via @xmldom/xmldom (REQ-051…REQ-054).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import DxfParser from 'dxf-parser';
import { DOMParser } from '@xmldom/xmldom';
import { drawingToDxf } from '../../src/export/dxf.js';
import { sheetToPdf } from '../../src/export/pdf.js';
import { sheetToSvg } from '../../src/export/svg.js';
import { layoutSheet, fitScale } from '../../src/export/sheet.js';
import { buildPlanDrawing, buildElevationDrawing, buildSectionDrawing } from '../../src/core/drawing.js';
import { slicePolylines, planFrame } from '../../src/core/slice.js';
import { detectWallPairs } from '../../src/core/walls.js';
import { elevation, section } from '../../src/core/views.js';
import { box, concat } from '../helpers/meshes.js';

const jpeg = readFileSync(new URL('./fixtures/gradient.jpg', import.meta.url));
const gray = readFileSync(new URL('./fixtures/gray.jpg', import.meta.url));
const DEMO = { id: 'd1', type: 'demolition', a: [0, 0], b: [3, 0], height: 2.5, thickness: 0.24, side: 1, note: 'Wand Küche' };
const NEW = { id: 'n1', type: 'new', a: [1, -1], b: [1, -2.5], thickness: 0.115, align: 'center', note: 'KS 11,5' };
const SEC = { id: 's1', type: 'section', label: 'A', a: [2, 1], b: [2, -4], side: 1 };

function twoRoomPlan(annotations = [DEMO, NEW, SEC]) {
  const m = concat(box(4, 3, 2.5), box(3, 3, 2.5, [4.24, 0, 0]));
  const outline = slicePolylines(m, planFrame(1));
  return buildPlanDrawing({ h: 1, outline, walls: detectWallPairs(outline), openings: [] }, annotations);
}

const sheetOf = (d, extra = {}) => layoutSheet(d, { paper: 'A4', orientation: 'landscape', scale: 100, project: 'Küche Süd', date: '2026-11-15', ...extra });

const hasQpdf = spawnSync('qpdf', ['--version']).status === 0;
function qpdfCheck(bytes) {
  const dir = mkdtempSync(join(tmpdir(), 's2p-qa-'));
  const f = join(dir, 'x.pdf');
  writeFileSync(f, bytes);
  const r = spawnSync('qpdf', ['--check', f], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

// ---------- DXF ----------

test('QA DXF opens in dxf-parser with layers, closed polylines and metre coordinates', () => {
  const dxf = new DxfParser().parseSync(drawingToDxf(twoRoomPlan()));
  const layers = Object.keys(dxf.tables.layer.layers);
  for (const l of ['S2P_EXISTING', 'S2P_BEYOND', 'S2P_DEMOLITION', 'S2P_NEW', 'S2P_DIMENSIONS', 'S2P_TEXT', 'S2P_SECTIONLINES', 'S2P_EXCAVATION']) assert.ok(layers.includes(l), l);
  assert.equal(dxf.tables.layer.layers.S2P_DEMOLITION.color !== undefined, true);
  const existing = dxf.entities.filter((e) => e.layer === 'S2P_EXISTING' && e.type === 'POLYLINE');
  assert.ok(existing.length >= 2);
  for (const p of existing) assert.equal(p.shape, true, 'closed flag');
  const xs = existing.flatMap((p) => p.vertices.map((v) => v.x));
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 7.24) < 1e-3, 'overall width 7.24 m');
  assert.ok(dxf.entities.some((e) => e.layer === 'S2P_DEMOLITION'));
  assert.ok(dxf.entities.some((e) => e.layer === 'S2P_NEW'));
  assert.ok(dxf.entities.some((e) => e.layer === 'S2P_SECTIONLINES'));
  assert.ok(dxf.entities.some((e) => e.type === 'TEXT' && e.text === '724'), 'overall dimension text');
  assert.ok(dxf.entities.some((e) => e.type === 'TEXT' && /Kueche/.test(e.text)), 'umlauts transliterated');
  assert.ok(!dxf.entities.some((e) => e.type === 'DIMENSION'), 'no DIMENSION entities (R12 plain)');
  assert.ok(dxf.tables.lineType.lineTypes.DASHED, 'DASHED linetype');
});

test('QA DXF of an elevation and a section parse (images dropped)', () => {
  const m = box(4, 3, 2.5);
  for (const d of [buildElevationDrawing(elevation(m, 'front'), [], 'elev-front'), buildSectionDrawing(section(m, [2, -1], [2, 4], 1), { label: 'A', a: [2, -1], b: [2, 4], side: 1 }, [])]) {
    const dxf = new DxfParser().parseSync(drawingToDxf(d));
    assert.ok(dxf.entities.length > 0);
  }
});

test('QA DXF stays valid when a markup note contains a line break', { todo: 'DEF-07: newline in TEXT value breaks the group-code/value pairing' }, () => {
  const note = { ...DEMO, note: 'Wand\nKüche' };
  const text = drawingToDxf(twoRoomPlan([note]));
  const lines = text.split('\n');
  // every even line must be an integer group code
  const bad = [];
  for (let i = 0; i + 1 < lines.length; i += 2) if (!/^-?\d+$/.test(lines[i].trim())) bad.push(`${i}: ${lines[i]}`);
  assert.deepEqual(bad.slice(0, 3), []);
  const dxf = new DxfParser().parseSync(text);
  assert.ok(dxf.entities.some((e) => e.type === 'TEXT' && /Wand/.test(e.text)));
});

// ---------- PDF ----------

test('QA PDF passes qpdf --check (plan with markup, A3 portrait 1:50)', { skip: !hasQpdf && 'qpdf not installed' }, () => {
  const r = qpdfCheck(sheetToPdf(sheetOf(twoRoomPlan(), { paper: 'A3', orientation: 'portrait', scale: 50 })));
  assert.equal(r.status, 0, r.out);
  assert.ok(!/WARNING/i.test(r.out), r.out);
});

test('QA PDF with embedded RGB and greyscale JPEGs passes qpdf --check', { skip: !hasQpdf && 'qpdf not installed' }, () => {
  const e = elevation(box(4, 3, 2.5), 'front');
  const d = buildElevationDrawing(e, [], 'elev-front');
  for (const img of [jpeg, gray]) {
    const r = qpdfCheck(sheetToPdf(sheetOf(d, { scale: 50 }), { view: { jpeg: new Uint8Array(img) } }));
    assert.equal(r.status, 0, r.out);
  }
});

test('QA PDF trailer /Info is an indirect reference (ISO 32000 §7.5.5)', { todo: 'DEF-11: /Info is written as a direct dictionary' }, () => {
  const s = Buffer.from(sheetToPdf(sheetOf(twoRoomPlan()))).toString('latin1');
  assert.match(s, /\/Info \d+ 0 R/);
});

test('QA PDF text with characters outside WinAnsi does not corrupt the file', { skip: !hasQpdf && 'qpdf not installed' }, () => {
  const d = twoRoomPlan([{ ...DEMO, note: 'Δ 😀 (paren) back\\slash ±' }]);
  const r = qpdfCheck(sheetToPdf(sheetOf(d, { project: 'Projekt (Test) \\ Ü', author: 'Zoë' })));
  assert.equal(r.status, 0, r.out);
});

test('QA PDF exact scale on A3 landscape 1:20 and 1:500', () => {
  for (const scale of [20, 500]) {
    const s = Buffer.from(sheetToPdf(sheetOf(twoRoomPlan([]), { paper: 'A3', scale }))).toString('latin1');
    const m = /\/s-cut BMC\n[^\n]*\n([^\n]*)\nEMC/.exec(s);
    const xs = [...m[1].matchAll(/([\d.]+) ([\d.]+) [ml]/g)].map((x) => Number(x[1]));
    const span = Math.max(...xs) - Math.min(...xs);
    assert.ok(Math.abs(span - (4000 / scale) * 72 / 25.4) <= 0.1, `1:${scale} span ${span}`);
  }
});

test('QA fit picks the largest scale that fits, including dimension margins', () => {
  assert.deepEqual(fitScale(twoRoomPlan([]), 'A4', 'landscape'), { scale: 50 });
});

// ---------- SVG ----------

const parseSvg = (svg) => {
  const errors = [];
  const doc = new DOMParser({ onError: (lvl, msg) => { if (lvl !== 'warning') errors.push(msg); } }).parseFromString(svg, 'image/svg+xml');
  return { doc, errors };
};

test('QA SVG with images, markup and hostile text parses as XML and keeps mm units', () => {
  const e = elevation(box(4, 3, 2.5), 'front');
  const svg = sheetToSvg(sheetOf(buildElevationDrawing(e, [], 'elev-front'), { project: '<script>alert(1)</script> & "x"', author: "O'Brien" }), { view: { jpeg: new Uint8Array(jpeg) } });
  const { doc, errors } = parseSvg(svg);
  assert.deepEqual(errors, []);
  assert.equal(doc.documentElement.getAttribute('width'), '297mm');
  assert.equal(doc.getElementsByTagName('script').length, 0);
  assert.ok(doc.getElementsByTagName('image')[0].getAttribute('href').startsWith('data:image/jpeg;base64,'));
  const svg2 = sheetToSvg(sheetOf(twoRoomPlan()));
  assert.deepEqual(parseSvg(svg2).errors, []);
});

test('QA SVG stays well-formed with a control character in a name (e.g. from a pasted/restored name)', { todo: 'DEF-17: XML-forbidden control characters are not stripped' }, () => {
  const svg = sheetToSvg(sheetOf(twoRoomPlan(), { project: 'Bad\u0001Name\u000B' }));
  // xmldom does not enforce the XML 1.0 Char production; expat/Safari do. Check it directly.
  // eslint-disable-next-line no-control-regex
  assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/.test(svg), 'XML-forbidden control character in SVG');
});
