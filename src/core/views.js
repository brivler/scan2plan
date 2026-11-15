/**
 * Elevations (REQ-025) and vertical sections (REQ-026) built on the software rasterizer.
 * Pure: no DOM, no three.js.
 */
import { rasterize, projectedExtent } from './raster.js';
import { isoLines, gridToModel } from './contour.js';
import { chainSegments, simplify } from './polyline.js';
import { Grow } from './mesh.js';
import { slicePolylines, sectionFrame } from './slice.js';

/** Default elevation resolution: 1 cm per pixel. */
export const VIEW_RES = 0.01;
/** Longest image side. */
export const MAX_VIEW_PX = 4096;
/** Depth jump treated as an edge (m). */
export const DEPTH_EDGE = 0.05;

/** Elevation directions: camera position → viewing direction. */
export const ELEVATIONS = Object.freeze({
  front: { name: 'Front', forward: [0, 0, 1] },
  right: { name: 'Right', forward: [-1, 0, 0] },
  back: { name: 'Back', forward: [0, 0, -1] },
  left: { name: 'Left', forward: [1, 0, 0] },
});

/** @param {number[]} f horizontal unit viewing direction */
function viewFromForward(f) {
  return { right: [-f[2], 0, f[0]], up: [0, 1, 0], forward: f };
}

/**
 * Renders an orthographic view: shaded RGBA image + vector outlines (coverage boundary and
 * depth discontinuities > 5 cm), coordinates in view metres (x = right, y = up).
 * @param {{positions:Float32Array, indices:Uint32Array}} mesh
 * @param {{right:number[], up:number[], forward:number[], zOffset?:number}} view
 * @param {{res?:number, maxPx?:number, zMin?:number, zMax?:number}} [opts]
 */
export function renderView(mesh, view, opts = {}) {
  const ext = projectedExtent(mesh.positions, view);
  const longest = Math.max(ext.maxX - ext.minX, ext.maxY - ext.minY);
  const maxPx = opts.maxPx ?? MAX_VIEW_PX;
  let res = opts.res ?? VIEW_RES;
  if (longest / res + 3 > maxPx) res = longest / (maxPx - 3);
  const x0 = Math.floor(ext.minX / res) * res - res, y0 = Math.floor(ext.minY / res) * res - res;
  const w = Math.min(maxPx, Math.ceil((ext.maxX - x0) / res) + 1), h = Math.min(maxPx, Math.ceil((ext.maxY - y0) / res) + 1);
  const grid = { x0, y0, res, w, h };
  const { depth, shade } = rasterize(mesh.positions, mesh.indices, view, grid, { zMin: opts.zMin, zMax: opts.zMax });
  const mask = new Uint8Array(w * h);
  let zLo = Infinity, zHi = -Infinity;
  for (let k = 0; k < w * h; k++) if (depth[k] !== Infinity) { mask[k] = 1; zLo = Math.min(zLo, depth[k]); zHi = Math.max(zHi, depth[k]); }
  const outline = gridToModel(isoLines(mask, w, h, 0.5, 0), x0, y0, res).map((p) => simplify(p, res));
  const edges = gridToModel(depthEdges(depth, w, h), x0, y0, res).map((p) => simplify(p, res));
  const rgba = shadeImage(depth, shade, w, h, zLo, zHi);
  return { grid, rgba, width: w, height: h, outline, edges, empty: zLo === Infinity };
}

/** Pixel-edge segments where neighbouring depths differ by more than DEPTH_EDGE. */
function depthEdges(depth, w, h) {
  const out = new Grow(Float64Array, 1024);
  const seg = (a, b, c, d) => { out.push(a); out.push(b); out.push(c); out.push(d); };
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const z = depth[i + j * w];
    if (z === Infinity) continue;
    if (i + 1 < w) { const z2 = depth[i + 1 + j * w]; if (z2 !== Infinity && Math.abs(z2 - z) > DEPTH_EDGE) seg(i + 0.5, j - 0.5, i + 0.5, j + 0.5); }
    if (j + 1 < h) { const z2 = depth[i + (j + 1) * w]; if (z2 !== Infinity && Math.abs(z2 - z) > DEPTH_EDGE) seg(i - 0.5, j + 0.5, i + 0.5, j + 0.5); }
  }
  return chainSegments(out.a, out.n / 4, 1e-6);
}

/** Lambert shading with depth fog; image rows top-down; empty = transparent. */
function shadeImage(depth, shade, w, h, zLo, zHi) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  const span = zHi > zLo ? zHi - zLo : 1;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = i + j * w;
    if (depth[k] === Infinity) continue;
    const fog = ((depth[k] - zLo) / span) * 0.6;
    const g = (70 + 150 * shade[k]) * (1 - fog) + 245 * fog;
    const o = (i + (h - 1 - j) * w) * 4;
    rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
    rgba[o + 3] = 255;
  }
  return rgba;
}

/**
 * Elevation in one of the four directions (REQ-025).
 * @param {{positions:Float32Array, indices:Uint32Array}} mesh
 * @param {'front'|'right'|'back'|'left'} dir
 * @param {{res?:number, maxPx?:number}} [opts]
 */
export function elevation(mesh, dir, opts = {}) {
  const def = ELEVATIONS[dir];
  if (!def) throw new Error(`Unknown elevation ${dir}`);
  return { ...renderView(mesh, viewFromForward(def.forward), opts), title: `Elevation ${def.name}` };
}

/**
 * Vertical section along a plan cut line (REQ-026): cut outline + view of geometry beyond
 * the plane within `depth` metres.
 * @param {{positions:Float32Array, indices:Uint32Array}} mesh
 * @param {number[]} a plan point
 * @param {number[]} b plan point
 * @param {1|-1} side viewing side (+1 = left of a→b)
 * @param {{depth?:number, simplify?:number, res?:number, maxPx?:number}} [opts]
 */
export function section(mesh, a, b, side = 1, opts = {}) {
  const frame = sectionFrame(a, b, side);
  const cut = slicePolylines(mesh, frame, { simplify: opts.simplify });
  const view = { right: frame.u, up: frame.v, forward: frame.forward, zOffset: frame.offset };
  const beyond = renderView(mesh, view, { res: opts.res, maxPx: opts.maxPx, zMin: 0.001, zMax: opts.depth ?? 5 });
  return { frame, cut, beyond };
}
