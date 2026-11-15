/**
 * Wall-pair (poche) detection (REQ-023) and opening detection (REQ-024) on plan polylines.
 * Pure: no DOM, no three.js.
 */
import { segmentsOf, distToSeg } from './polyline.js';

const PAIR_MAX_ANGLE = 2;     // degrees
const PAIR_MIN_DIST = 0.05;   // m
const PAIR_MAX_DIST = 0.60;   // m
const PAIR_MIN_OVERLAP = 0.5; // fraction of the shorter segment

/** Segment geometry helper. */
function geom(s) {
  const dx = s.bx - s.ax, dy = s.by - s.ay, len = Math.hypot(dx, dy);
  return { ...s, len, ux: dx / len, uy: dy / len };
}

/**
 * Finds parallel segment pairs forming walls of 5–60 cm thickness.
 * Each segment is used in at most one pair (closest partner wins).
 * @param {Array<{pts:number[], closed:boolean}>} polys simplified plan polylines
 * @returns {Array<{a:object, b:object, thickness:number, polygon:number[]}>}
 */
export function detectWallPairs(polys) {
  const segs = segmentsOf(polys).map(geom).filter((s) => s.len > 0.05);
  const sinMax = Math.sin((PAIR_MAX_ANGLE * Math.PI) / 180);
  const cands = [];
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const s = segs[i], t = segs[j];
    if (Math.abs(s.ux * t.uy - s.uy * t.ux) > sinMax) continue;
    const nx = -s.uy, ny = s.ux;
    const mx = (t.ax + t.bx) / 2, my = (t.ay + t.by) / 2;
    const d = Math.abs((mx - s.ax) * nx + (my - s.ay) * ny);
    if (d < PAIR_MIN_DIST || d > PAIR_MAX_DIST) continue;
    const p0 = (t.ax - s.ax) * s.ux + (t.ay - s.ay) * s.uy, p1 = (t.bx - s.ax) * s.ux + (t.by - s.ay) * s.uy;
    const lo = Math.max(0, Math.min(p0, p1)), hi = Math.min(s.len, Math.max(p0, p1));
    if (hi - lo < PAIR_MIN_OVERLAP * Math.min(s.len, t.len)) continue;
    cands.push({ i, j, d, lo, hi });
  }
  cands.sort((x, y) => x.d - y.d);
  const used = new Set();
  const out = [];
  for (const c of cands) {
    if (used.has(c.i) || used.has(c.j)) continue;
    used.add(c.i); used.add(c.j);
    const s = segs[c.i], t = segs[c.j];
    const nx = -s.uy, ny = s.ux;
    const side = Math.sign(((t.ax + t.bx) / 2 - s.ax) * nx + ((t.ay + t.by) / 2 - s.ay) * ny) || 1;
    const P = (u, off) => [s.ax + s.ux * u + nx * side * off, s.ay + s.uy * u + ny * side * off];
    const polygon = [...P(c.lo, 0), ...P(c.hi, 0), ...P(c.hi, c.d), ...P(c.lo, c.d)];
    out.push({ a: { poly: s.poly, index: s.index }, b: { poly: t.poly, index: t.index }, thickness: c.d, polygon });
  }
  return out;
}

// ---- openings (REQ-024) ----

const LINE_MIN_LEN = 0.5;
const COLLINEAR_TOL = 0.02;
const GAP_MIN = 0.5, GAP_MAX = 3.0;
const GAP_CLEAR = 0.05;

/** Fraction of sample points in (a,b) that lie within GAP_CLEAR of any segment. */
function coveredFraction(ax, ay, bx, by, segs) {
  const len = Math.hypot(bx - ax, by - ay);
  const n = Math.max(3, Math.ceil(len / 0.02));
  let hit = 0, total = 0;
  for (let k = 1; k < n; k++) {
    const t = k / n, d = t * len;
    if (d < GAP_CLEAR + 0.01 || d > len - GAP_CLEAR - 0.01) continue;
    const x = ax + t * (bx - ax), y = ay + t * (by - ay);
    total++;
    if (segs.some((s) => distToSeg(x, y, s.ax, s.ay, s.bx, s.by) < GAP_CLEAR)) hit++;
  }
  return total ? hit / total : 1;
}

/**
 * Door/window detection from slices at h₁ = 0.30 m (`low`) and h₂ = 1.00 m (`high`).
 * @param {Array<{pts:number[], closed:boolean}>} high
 * @param {Array<{pts:number[], closed:boolean}>} low
 * @returns {Array<{type:'door'|'window', width:number, a:number[], b:number[]}>}
 */
export function detectOpenings(high, low) {
  const hs = segmentsOf(high).map(geom).filter((s) => s.len > 1e-6);
  const ls = segmentsOf(low).map(geom).filter((s) => s.len > 1e-6);
  const assigned = new Set();
  const out = [];
  const seeds = hs.map((s, i) => i).filter((i) => hs[i].len >= LINE_MIN_LEN).sort((i, j) => hs[j].len - hs[i].len);
  for (const si of seeds) {
    if (assigned.has(si)) continue;
    const L = hs[si];
    const nx = -L.uy, ny = L.ux;
    const off = (x, y) => Math.abs((x - L.ax) * nx + (y - L.ay) * ny);
    const intervals = [];
    hs.forEach((s, k) => {
      if (assigned.has(k) || off(s.ax, s.ay) > COLLINEAR_TOL || off(s.bx, s.by) > COLLINEAR_TOL) return;
      assigned.add(k);
      const p0 = (s.ax - L.ax) * L.ux + (s.ay - L.ay) * L.uy, p1 = (s.bx - L.ax) * L.ux + (s.by - L.ay) * L.uy;
      intervals.push([Math.min(p0, p1), Math.max(p0, p1)]);
    });
    intervals.sort((x, y) => x[0] - y[0]);
    const merged = [];
    for (const iv of intervals) {
      const last = merged[merged.length - 1];
      if (last && iv[0] <= last[1] + 0.01) last[1] = Math.max(last[1], iv[1]); else merged.push(iv.slice());
    }
    for (let k = 0; k + 1 < merged.length; k++) {
      const g0 = merged[k][1], g1 = merged[k + 1][0], width = g1 - g0;
      if (width < GAP_MIN || width > GAP_MAX) continue;
      const a = [L.ax + L.ux * g0, L.ay + L.uy * g0], b = [L.ax + L.ux * g1, L.ay + L.uy * g1];
      if (coveredFraction(a[0], a[1], b[0], b[1], hs) > 0) continue; // something else crosses the gap
      const type = coveredFraction(a[0], a[1], b[0], b[1], ls) < 0.5 ? 'door' : 'window';
      out.push({ type, width, a, b });
    }
  }
  return out;
}
