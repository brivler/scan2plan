/**
 * Plane sections of a triangle mesh (REQ-022 floor plan, REQ-026 vertical section).
 * Pure: no DOM, no three.js.
 */
import { Grow } from './mesh.js';
import { chainSegments, simplify, orthoSnap } from './polyline.js';

/** Default plan cut height above ±0.00 (m). */
export const DEFAULT_PLAN_HEIGHT = 1.0;
/** Default Douglas–Peucker tolerance (m). */
export const DEFAULT_SIMPLIFY = 0.01;
/** Endpoint weld tolerance (m). */
export const WELD_TOL = 0.001;
const ON_PLANE_EPS = 1e-7;

/**
 * Plan frame: plan x = world X, plan y = −world Z, cut plane Y = h.
 * @param {number} h
 */
export function planFrame(h) {
  return { normal: [0, 1, 0], offset: h, u: [1, 0, 0], v: [0, 0, -1] };
}

/**
 * Vertical section frame from a plan cut line a→b (plan coords). `side` = +1 views to the
 * left of a→b, −1 to the right. Horizontal axis = viewer's right, vertical = world Y.
 * @param {number[]} a plan point
 * @param {number[]} b plan point
 * @param {1|-1} side
 */
export function sectionFrame(a, b, side = 1) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = Math.hypot(dx, dy);
  if (l < 1e-6) throw new Error('Cut line too short');
  // plan left normal of a→b is (−dy, dx); in world: X = x, Z = −y
  const fx = (side * -dy) / l, fz = -(side * dx) / l; // viewing direction (world)
  const forward = [fx, 0, fz];
  const right = [-fz, 0, fx]; // forward × up
  const offset = forward[0] * a[0] + forward[2] * -a[1];
  return { normal: forward, offset, u: right, v: [0, 1, 0], forward };
}

/**
 * Raw triangle/plane intersection segments in 2D frame coordinates.
 * @param {Float32Array} positions
 * @param {Uint32Array} indices
 * @param {{normal:number[], offset:number, u:number[], v:number[]}} frame
 * @returns {{segs: Float64Array, count: number}}
 */
export function sliceSegments(positions, indices, frame) {
  const [nx, ny, nz] = frame.normal, [ux, uy, uz] = frame.u, [vx, vy, vz] = frame.v;
  const nv = positions.length / 3;
  const dist = new Float64Array(nv);
  for (let i = 0; i < nv; i++) {
    const d = positions[3 * i] * nx + positions[3 * i + 1] * ny + positions[3 * i + 2] * nz - frame.offset;
    dist[i] = d === 0 ? ON_PLANE_EPS : d;
  }
  const out = new Grow(Float64Array, 4096);
  const pt = (a, b) => {
    if (a > b) { const t = a; a = b; b = t; } // consistent order → identical points from both faces
    const t = dist[a] / (dist[a] - dist[b]);
    const x = positions[3 * a] + t * (positions[3 * b] - positions[3 * a]);
    const y = positions[3 * a + 1] + t * (positions[3 * b + 1] - positions[3 * a + 1]);
    const z = positions[3 * a + 2] + t * (positions[3 * b + 2] - positions[3 * a + 2]);
    out.push(x * ux + y * uy + z * uz);
    out.push(x * vx + y * vy + z * vz);
  };
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    const sa = dist[a] > 0, sb = dist[b] > 0, sc = dist[c] > 0;
    if (sa === sb && sb === sc) continue;
    if (sa === sb) { pt(a, c); pt(b, c); } else if (sa === sc) { pt(a, b); pt(c, b); } else { pt(b, a); pt(c, a); }
  }
  return { segs: out.a, count: out.n / 4 };
}

/**
 * Full section pipeline: intersect → weld 1 mm → chain → simplify → optional ortho snap.
 * @param {{positions:Float32Array, indices:Uint32Array}} mesh
 * @param {object} frame from planFrame/sectionFrame
 * @param {{simplify?:number, snap?:boolean, snapDeg?:number}} [opts]
 * @returns {Array<{pts:number[], closed:boolean}>}
 */
export function slicePolylines(mesh, frame, opts = {}) {
  const eps = opts.simplify ?? DEFAULT_SIMPLIFY;
  const snap = opts.snap ?? true;
  const { segs, count } = sliceSegments(mesh.positions, mesh.indices, frame);
  const chains = chainSegments(segs, count, WELD_TOL);
  const out = [];
  for (const c of chains) {
    let p = simplify(c, eps);
    if (p.pts.length < 4) continue;
    if (snap) p = orthoSnap(p, opts.snapDeg ?? 3);
    out.push(p);
  }
  return out;
}
