/**
 * Node-measurable performance budgets (REQ-075). Device rows are on the owner checklist.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderView } from '../src/core/views.js';
import { heightMap, excavation } from '../src/core/terrain.js';
import { slicePolylines, planFrame } from '../src/core/slice.js';
import { buildPlanDrawing } from '../src/core/drawing.js';
import { layoutSheet } from '../src/export/sheet.js';
import { sheetToSvg } from '../src/export/svg.js';
import { sheetToPdf } from '../src/export/pdf.js';
import { drawingToDxf } from '../src/export/dxf.js';
import { autoOrient } from '../src/core/orient.js';
import { subdividedBox, plane } from './helpers/meshes.js';

const time = (fn) => { const t = performance.now(); const r = fn(); return [performance.now() - t, r]; };
const big = subdividedBox(10, 8, 2.5, 0.022); // ≈ 1.03 M triangles

test('elevation raster 1M triangles at 1024×768 ≤ 3 s', () => {
  const view = { right: [-1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1] };
  const [dt, v] = time(() => renderView(big, view, { res: 10 / 1024 }));
  assert.ok(v.width <= 1030);
  assert.ok(dt < 3000, `${dt.toFixed(0)} ms`);
});

test('terrain volume 100 m² at 5 cm ≤ 1 s', () => {
  const terrain = plane(12, 240, (x, z) => 0.1 * x + 0.05 * Math.sin(z));
  const [dt, r] = time(() => excavation(heightMap(terrain, 0.05), [1, -1, 11, -1, 11, -11, 1, -11], { mode: 'level', level: -1 }));
  assert.ok(r.area === 100);
  assert.ok(dt < 1000, `${dt.toFixed(0)} ms`);
});

test('PDF/SVG/DXF generation ≤ 2 s', () => {
  const outline = slicePolylines(big, planFrame(1));
  const d = buildPlanDrawing({ h: 1, outline, walls: [], openings: [] }, []);
  const [dt] = time(() => {
    const sheet = layoutSheet(d, { paper: 'A3', orientation: 'landscape', scale: 100, project: 'P', date: '2026-11-15' });
    sheetToSvg(sheet); sheetToPdf(sheet); drawingToDxf(d);
  });
  assert.ok(dt < 2000, `${dt.toFixed(0)} ms`);
});

test('orientation of 1M triangles (part of the 10 s import budget)', () => {
  const [dt] = time(() => autoOrient(big.positions, big.indices, { format: 'obj' }));
  assert.ok(dt < 5000, `${dt.toFixed(0)} ms`);
});
