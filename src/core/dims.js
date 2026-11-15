/**
 * Automatic plan dimensions (REQ-029). Dimensions are model-space objects
 * `{a, b, n, offsetMm, text, kind}`: measured points a→b, unit offset direction n, offset of
 * the dimension line in paper millimetres (converted by the renderer at the sheet scale).
 * Pure: no DOM, no three.js.
 */
import { polylinesBBox, signedArea, segmentsOf } from './polyline.js';

/** Minimum segment length for an individual dimension (m). */
export const MIN_SEGMENT_DIM = 0.3;
/** Chain points closer than this are merged (m). */
export const CHAIN_MERGE = 0.05;
/** Offsets of chain / overall dimension lines from the bbox (paper mm). */
export const CHAIN_OFFSET_MM = 8;
export const OVERALL_OFFSET_MM = 16;
export const SEGMENT_OFFSET_MM = 5;

/**
 * Formats metres as integer centimetres, rounding half up ("345", "346").
 * @param {number} m
 */
export function formatCm(m) {
  return String(Math.floor(m * 100 + 0.5 + 1e-9));
}

/** Merges sorted coordinates closer than CHAIN_MERGE. */
function mergeSorted(values) {
  const out = [];
  for (const v of values.sort((x, y) => x - y)) if (!out.length || v - out[out.length - 1] >= CHAIN_MERGE) out.push(v);
  return out;
}

/**
 * Overall dimensions + chains on all four sides, segment dimensions and opening widths.
 * @param {Array<{pts:number[], closed:boolean}>} polys plan outline polylines
 * @param {Array<{a:number[], b:number[], width:number}>} [openings]
 * @returns {Array<{a:number[], b:number[], n:number[], offsetMm:number, text:string, kind:string}>}
 */
export function planDimensions(polys, openings = []) {
  const bb = polylinesBBox(polys);
  if (!bb) return [];
  const out = [];
  const xs = [], ys = [];
  for (const p of polys) for (let i = 0; i < p.pts.length; i += 2) { xs.push(p.pts[i]); ys.push(p.pts[i + 1]); }
  const chainX = mergeSorted(xs), chainY = mergeSorted(ys);
  const sides = [
    { n: [0, -1], at: (v) => [v, bb.minY], vals: chainX, lo: bb.minX, hi: bb.maxX },
    { n: [0, 1], at: (v) => [v, bb.maxY], vals: chainX, lo: bb.minX, hi: bb.maxX },
    { n: [-1, 0], at: (v) => [bb.minX, v], vals: chainY, lo: bb.minY, hi: bb.maxY },
    { n: [1, 0], at: (v) => [bb.maxX, v], vals: chainY, lo: bb.minY, hi: bb.maxY },
  ];
  for (const s of sides) {
    if (s.hi - s.lo < 0.01) continue;
    out.push({ a: s.at(s.lo), b: s.at(s.hi), n: s.n, offsetMm: OVERALL_OFFSET_MM, text: formatCm(s.hi - s.lo), kind: 'overall' });
    if (s.vals.length > 2) {
      for (let k = 0; k + 1 < s.vals.length; k++) {
        out.push({ a: s.at(s.vals[k]), b: s.at(s.vals[k + 1]), n: s.n, offsetMm: CHAIN_OFFSET_MM, text: formatCm(s.vals[k + 1] - s.vals[k]), kind: 'chain' });
      }
    }
  }
  for (const seg of segmentsOf(polys)) {
    const dx = seg.bx - seg.ax, dy = seg.by - seg.ay, len = Math.hypot(dx, dy);
    if (len < MIN_SEGMENT_DIM) continue;
    const poly = polys[seg.poly];
    // interior side: left of a→b for counter-clockwise rings
    const ccw = poly.closed ? signedArea(poly.pts) > 0 : true;
    const s = ccw ? 1 : -1;
    out.push({ a: [seg.ax, seg.ay], b: [seg.bx, seg.by], n: [(-dy / len) * s, (dx / len) * s], offsetMm: SEGMENT_OFFSET_MM, text: formatCm(len), kind: 'segment' });
  }
  for (const o of openings) {
    const dx = o.b[0] - o.a[0], dy = o.b[1] - o.a[1], len = Math.hypot(dx, dy);
    out.push({ a: o.a, b: o.b, n: [-dy / len, dx / len], offsetMm: SEGMENT_OFFSET_MM, text: formatCm(o.width), kind: 'opening' });
  }
  return out;
}
