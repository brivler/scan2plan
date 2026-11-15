/**
 * Point-cloud slicing (REQ-022b), terrain height map (REQ-045) and excavation volumes (REQ-046).
 * Height maps live in plan coordinates (x = X, y = −Z). Pure: no DOM, no three.js.
 */
import { rasterize } from './raster.js';
import { isoLines, gridToModel } from './contour.js';
import { simplify, orthoSnap, pointInPolygon, signedArea } from './polyline.js';
import { computeBBox } from './mesh.js';

/** Default terrain cell (m). */
export const TERRAIN_CELL = 0.05;
/** Default bulking factor (loose / bank volume). */
export const DEFAULT_BULKING = 1.25;
/** Default truck capacity (m³). */
export const DEFAULT_TRUCK_M3 = 10;
/** Coverage below which a warning is shown. */
export const COVERAGE_WARN = 0.95;
const IDW_RADIUS = 0.5;

/**
 * Plan outline of a point cloud at height h: points within ±2 cm are rasterized to a 1 cm
 * grid, boundaries extracted with marching squares and simplified like REQ-022.
 * @param {Float32Array} positions
 * @param {number} h
 * @param {{cell?:number, band?:number, simplify?:number, snap?:boolean}} [opts]
 */
export function slicePoints(positions, h, opts = {}) {
  const cell = opts.cell ?? 0.01, band = opts.band ?? 0.02;
  const xs = [], ys = [];
  for (let i = 0; i < positions.length; i += 3) {
    if (Math.abs(positions[i + 1] - h) <= band) { xs.push(positions[i]); ys.push(-positions[i + 2]); }
  }
  if (!xs.length) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let k = 0; k < xs.length; k++) {
    minX = Math.min(minX, xs[k]); maxX = Math.max(maxX, xs[k]); minY = Math.min(minY, ys[k]); maxY = Math.max(maxY, ys[k]);
  }
  const x0 = Math.floor(minX / cell) * cell, y0 = Math.floor(minY / cell) * cell;
  const nx = Math.floor((maxX - x0) / cell) + 1, ny = Math.floor((maxY - y0) / cell) + 1;
  if (nx * ny > 64e6) throw new Error('Point slice area too large');
  const mask = new Uint8Array(nx * ny);
  for (let k = 0; k < xs.length; k++) mask[Math.floor((xs[k] - x0) / cell) + Math.floor((ys[k] - y0) / cell) * nx] = 1;
  const eps = opts.simplify ?? 0.01;
  return gridToModel(isoLines(mask, nx, ny, 0.5, 0), x0, y0, cell)
    .map((p) => simplify(p, eps))
    .filter((p) => p.pts.length >= 4)
    .map((p) => (opts.snap ?? true ? orthoSnap(p) : p));
}

/**
 * Top-surface height map: max Y per cell (cell centres on multiples of `cell` + cell/2).
 * @param {{positions:Float32Array, indices:Uint32Array|null}} mesh
 * @param {number} [cell]
 * @returns {{x0:number, y0:number, cell:number, nx:number, ny:number, h:Float32Array}} NaN = no data
 */
export function heightMap(mesh, cell = TERRAIN_CELL) {
  if (!(cell >= 0.02 && cell <= 0.2)) throw new Error('Cell size must be between 2 and 20 cm');
  const bb = computeBBox(mesh.positions);
  const minX = bb.min[0], maxX = bb.max[0], minY = -bb.max[2], maxY = -bb.min[2];
  const x0 = Math.floor(minX / cell) * cell, y0 = Math.floor(minY / cell) * cell;
  const nx = Math.max(1, Math.ceil((maxX - x0) / cell)), ny = Math.max(1, Math.ceil((maxY - y0) / cell));
  if (nx * ny > 16e6) throw new Error('Terrain too large for this cell size — choose a larger cell.');
  const h = new Float32Array(nx * ny).fill(NaN);
  if (mesh.indices) {
    const view = { right: [1, 0, 0], up: [0, 0, -1], forward: [0, -1, 0] };
    const { depth } = rasterize(mesh.positions, mesh.indices, view, { x0, y0, res: cell, w: nx, h: ny });
    for (let k = 0; k < h.length; k++) if (depth[k] !== Infinity) h[k] = -depth[k];
  } else {
    const p = mesh.positions;
    for (let i = 0; i < p.length; i += 3) {
      const ix = Math.min(nx - 1, Math.floor((p[i] - x0) / cell)), iy = Math.min(ny - 1, Math.floor((-p[i + 2] - y0) / cell));
      const k = ix + iy * nx;
      if (!(h[k] >= p[i + 1])) h[k] = p[i + 1];
    }
  }
  return { x0, y0, cell, nx, ny, h };
}

/**
 * Contour lines every `interval` metres; every `majorEvery`-th metre level is major.
 * @param {ReturnType<typeof heightMap>} hm
 * @param {number} [interval]
 * @param {number} [major]
 * @returns {Array<{level:number, major:boolean, polys:Array}>}
 */
export function contours(hm, interval = 0.1, major = 0.5) {
  let lo = Infinity, hi = -Infinity;
  for (const v of hm.h) if (!Number.isNaN(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (lo === Infinity) return [];
  const out = [];
  const k0 = Math.ceil(lo / interval), k1 = Math.floor(hi / interval);
  if (k1 - k0 > 500) return out; // too many levels: caller should raise the interval
  for (let k = k0; k <= k1; k++) {
    const level = Math.round(k * interval * 1000) / 1000;
    const polys = gridToModel(isoLines(hm.h, hm.nx, hm.ny, level), hm.x0, hm.y0, hm.cell).map((p) => simplify(p, hm.cell / 2));
    const isMajor = Math.abs(level / major - Math.round(level / major)) < 1e-6;
    if (polys.length) out.push({ level, major: isMajor, polys });
  }
  return out;
}

/**
 * Hypsometric RGBA image of the height map (rows top-down; no data = transparent).
 * @param {ReturnType<typeof heightMap>} hm
 */
export function heightImage(hm) {
  let lo = Infinity, hi = -Infinity;
  for (const v of hm.h) if (!Number.isNaN(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const span = hi > lo ? hi - lo : 1;
  const stops = [[0, [40, 110, 60]], [0.35, [150, 190, 90]], [0.65, [225, 200, 120]], [1, [150, 90, 50]]];
  const rgba = new Uint8ClampedArray(hm.nx * hm.ny * 4);
  for (let j = 0; j < hm.ny; j++) for (let i = 0; i < hm.nx; i++) {
    const v = hm.h[i + j * hm.nx];
    if (Number.isNaN(v)) continue;
    const t = (v - lo) / span;
    let s = 1;
    while (s < stops.length - 1 && stops[s][0] < t) s++;
    const [t0, c0] = stops[s - 1], [t1, c1] = stops[s];
    const f = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
    const o = (i + (hm.ny - 1 - j) * hm.nx) * 4;
    for (let k = 0; k < 3; k++) rgba[o + k] = c0[k] + f * (c1[k] - c0[k]);
    rgba[o + 3] = 255;
  }
  return rgba;
}

/**
 * Height at a plan point (nearest cell; NaN if outside / no data).
 * @param {ReturnType<typeof heightMap>} hm
 */
export function heightAt(hm, x, y) {
  const i = Math.floor((x - hm.x0) / hm.cell), j = Math.floor((y - hm.y0) / hm.cell);
  if (i < 0 || j < 0 || i >= hm.nx || j >= hm.ny) return NaN;
  return hm.h[i + j * hm.nx];
}

/** Truck loads for a loose volume. */
export function truckLoads(loose, capacity = DEFAULT_TRUCK_M3) {
  if (!(capacity > 0)) throw new Error('Truck capacity must be positive');
  return loose <= 0 ? 0 : Math.ceil(loose / capacity - 1e-9);
}

/**
 * Excavation quantities (REQ-046).
 * @param {ReturnType<typeof heightMap>} hm
 * @param {number[]} polygon plan ring (flat x,y)
 * @param {{mode:'level'|'depth', level?:number, depth?:number, bulking?:number, truck?:number}} opts
 */
export function excavation(hm, polygon, opts) {
  if (!polygon || polygon.length < 6) throw new Error('The excavation polygon needs at least 3 points.');
  const bulking = opts.bulking ?? DEFAULT_BULKING;
  if (!(bulking >= 1 && bulking <= 1.6)) throw new Error('Bulking factor must be between 1.00 and 1.60.');
  const { x0, y0, cell, nx, ny, h } = hm;
  const inside = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let k = 0; k < polygon.length; k += 2) {
    minX = Math.min(minX, polygon[k]); maxX = Math.max(maxX, polygon[k]);
    minY = Math.min(minY, polygon[k + 1]); maxY = Math.max(maxY, polygon[k + 1]);
  }
  const i0 = Math.max(0, Math.floor((minX - x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((maxX - x0) / cell));
  const j0 = Math.max(0, Math.floor((minY - y0) / cell)), j1 = Math.min(ny - 1, Math.ceil((maxY - y0) / cell));
  if (opts.mode === 'depth' && !(opts.depth > 0)) throw new Error('Depth must be greater than 0.');
  // cells of the polygon that lie beyond the height map extent count as missing
  const totalEstimate = Math.round(Math.abs(signedArea(polygon)) / (cell * cell));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (pointInPolygon(x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell, polygon)) inside.push(i + j * nx);
  }
  const cellsOutsideMap = Math.max(0, totalEstimate - inside.length);
  const A = cell * cell;
  const r = Math.ceil(IDW_RADIUS / cell);
  let valid = 0, filled = 0, excluded = cellsOutsideMap, cut = 0, fill = 0;
  for (const k of inside) {
    let v = h[k];
    if (Number.isNaN(v)) {
      v = idw(hm, k % nx, Math.floor(k / nx), r);
      if (Number.isNaN(v)) { excluded++; continue; }
      filled++;
    } else valid++;
    if (opts.mode === 'depth') cut += (opts.depth ?? 0) * A;
    else {
      const t = opts.level ?? 0;
      cut += Math.max(0, v - t) * A; fill += Math.max(0, t - v) * A;
    }
  }
  const total = inside.length + cellsOutsideMap;
  const coverage = total ? valid / total : 0;
  const loose = cut * bulking;
  return {
    area: Math.abs(signedArea(polygon)),
    cut, fill, loose,
    trucks: truckLoads(loose, opts.truck ?? DEFAULT_TRUCK_M3),
    coverage,
    warning: coverage < COVERAGE_WARN,
    interpolatedCells: filled,
    excludedCells: excluded,
  };
}

function idw(hm, i, j, r) {
  let sw = 0, s = 0;
  for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    const ii = i + di, jj = j + dj;
    if (ii < 0 || jj < 0 || ii >= hm.nx || jj >= hm.ny) continue;
    const d2 = (di * di + dj * dj) * hm.cell * hm.cell;
    if (d2 === 0 || d2 > IDW_RADIUS * IDW_RADIUS) continue;
    const v = hm.h[ii + jj * hm.nx];
    if (Number.isNaN(v)) continue;
    sw += 1 / d2; s += v / d2;
  }
  return sw ? s / sw : NaN;
}
