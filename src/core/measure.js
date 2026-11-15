/**
 * Tap-to-measure formatting and snapping (REQ-030), level labels (REQ-027) and scale
 * calibration (REQ-031). Pure: no DOM, no three.js.
 */
import { multiply, scaling } from './mat4.js';
import { distToSeg } from './polyline.js';

/** 3D snap radius to the nearest full-resolution vertex (m). */
export const SNAP_3D_M = 0.02;
/** 2D snap radius to polyline vertices / lines (CSS px). */
export const SNAP_2D_PX = 24;
/** Accepted calibration range without confirmation. */
export const CAL_MIN = 0.8, CAL_MAX = 1.25;

/** @param {number} m metres → "345.2 cm" */
export function cm1(m) {
  return `${(Math.round(m * 1000 + 1e-9) / 10).toFixed(1)} cm`;
}

/**
 * Distance and components between two 3D points.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {{distance:number, horizontal:number, vertical:number, text:string, components:string}}
 */
export function measure3D(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const distance = Math.hypot(dx, dy, dz), horizontal = Math.hypot(dx, dz), vertical = Math.abs(dy);
  return { distance, horizontal, vertical, text: cm1(distance), components: `Δh ${cm1(horizontal)}, Δv ${cm1(vertical)}` };
}

/**
 * Level label relative to ±0.00 with sign and 2 decimals: "+2.47", "−0.18", "±0.00".
 * @param {number} y metres
 */
export function formatLevel(y) {
  const r = Math.round(Math.abs(y) * 100 + 1e-9) / 100;
  if (r === 0) return '±0.00';
  return `${y > 0 ? '+' : '−'}${r.toFixed(2)}`;
}

/**
 * Nearest vertex within `radius` of p, or null.
 * @param {Float32Array} positions
 * @param {number[]} p
 * @param {number} [radius]
 * @returns {number[]|null}
 */
export function nearestVertex(positions, p, radius = SNAP_3D_M) {
  let best = -1, bd = radius * radius;
  for (let i = 0; i < positions.length; i += 3) {
    const dx = positions[i] - p[0], dy = positions[i + 1] - p[1], dz = positions[i + 2] - p[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d <= bd) { bd = d; best = i; }
  }
  return best < 0 ? null : [positions[best], positions[best + 1], positions[best + 2]];
}

/**
 * 2D snapping: polyline vertex within `radius`, else the nearest point on a polyline segment
 * within `radius`, else the point itself.
 * @param {number[]} p model point
 * @param {Array<{pts:number[], closed:boolean}>} polys
 * @param {number} radius model units (= SNAP_2D_PX converted by the view)
 * @returns {{point:number[], snapped:'vertex'|'line'|null}}
 */
export function snap2D(p, polys, radius) {
  let best = null, bd = radius;
  for (const pl of polys) for (let i = 0; i < pl.pts.length; i += 2) {
    const d = Math.hypot(pl.pts[i] - p[0], pl.pts[i + 1] - p[1]);
    if (d <= bd) { bd = d; best = [pl.pts[i], pl.pts[i + 1]]; }
  }
  if (best) return { point: best, snapped: 'vertex' };
  bd = radius;
  for (const pl of polys) {
    const n = pl.pts.length / 2, ns = pl.closed ? n : n - 1;
    for (let i = 0; i < ns; i++) {
      const j = (i + 1) % n;
      const ax = pl.pts[2 * i], ay = pl.pts[2 * i + 1], bx = pl.pts[2 * j], by = pl.pts[2 * j + 1];
      const d = distToSeg(p[0], p[1], ax, ay, bx, by);
      if (d <= bd) {
        bd = d;
        const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
        const t = l2 ? Math.max(0, Math.min(1, ((p[0] - ax) * (bx - ax) + (p[1] - ay) * (by - ay)) / l2)) : 0;
        best = [ax + t * (bx - ax), ay + t * (by - ay)];
      }
    }
  }
  return best ? { point: best, snapped: 'line' } : { point: p.slice(), snapped: null };
}

/**
 * Calibration factor s = real / measured (REQ-031).
 * @param {number} measuredM measured length (m)
 * @param {number} realCm true length (cm)
 * @returns {{factor:number, unusual:boolean, percent:number}}
 */
export function calibrationFactor(measuredM, realCm) {
  if (!(measuredM > 0)) throw new Error('Measure the reference first.');
  if (!(realCm > 0)) throw new Error('Enter the real length in cm (greater than 0).');
  const factor = realCm / 100 / measuredM;
  return { factor, unusual: factor < CAL_MIN || factor > CAL_MAX, percent: (factor - 1) * 100 };
}

/**
 * Applies a uniform scale about the origin to a transform (multiplies onto existing scale).
 * @param {number[]} transform
 * @param {number} factor
 */
export function applyScale(transform, factor) {
  return multiply(scaling(factor), transform);
}

/**
 * Calibration status text for project info and title blocks. `factor` is the scale applied by
 * this project's transform; `baked` (restored backups) was already applied to the mesh.
 * @param {{factor:number, refCm:number, baked?:number}|null} cal
 */
export function calibrationText(cal) {
  const total = cal ? cal.factor * (cal.baked || 1) : 1;
  if (!cal || total === 1) return 'Scale: as scanned (not calibrated)';
  return `Scale calibrated ×${total.toFixed(4)} on ${cal.refCm.toFixed(1)} cm reference`;
}
