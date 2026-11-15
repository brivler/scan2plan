/** Shared test pipeline: box mesh → plan → drawing → sheet. */
import { slicePolylines, planFrame } from '../../src/core/slice.js';
import { buildPlanDrawing } from '../../src/core/drawing.js';
import { layoutSheet } from '../../src/export/sheet.js';
import { box } from './meshes.js';

export function boxPlan(annotations = [], opts = {}) {
  const outline = slicePolylines(box(4, 3, 2.5), planFrame(1.0));
  return buildPlanDrawing({ h: 1.0, outline, walls: [], openings: [] }, annotations, opts);
}

export function boxSheet(scale, annotations = [], extra = {}) {
  return layoutSheet(boxPlan(annotations), { paper: 'A4', orientation: 'landscape', scale, project: 'Küche Süd', date: '2026-11-15', calibration: null, ...extra });
}

/** Bounding box of all "M x y L …" coordinates in path elements with the given class. */
export function svgPathBBox(svg, cls) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const re = new RegExp(`<path d="([^"]+)"[^>]*class="${cls}"`, 'g');
  for (const m of svg.matchAll(re)) {
    for (const [, x, y] of m[1].matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)) {
      minX = Math.min(minX, +x); maxX = Math.max(maxX, +x); minY = Math.min(minY, +y); maxY = Math.max(maxY, +y);
    }
  }
  return { w: maxX - minX, h: maxY - minY };
}
