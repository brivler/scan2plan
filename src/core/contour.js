/**
 * Marching squares on regular grids (binary masks and scalar fields), used for elevation
 * outlines (REQ-025), point-cloud slices (REQ-022b) and terrain contours (REQ-045).
 * Grid coordinates: sample (i, j) sits at (i, j). Pure: no DOM, no three.js.
 */
import { Grow } from './mesh.js';
import { chainSegments } from './polyline.js';

// Edge ids: 0 bottom (c0–c1), 1 right (c1–c2), 2 top (c2–c3), 3 left (c3–c0).
const TABLE = [[], [3, 0], [0, 1], [3, 1], [1, 2], null, [0, 2], [3, 2], [2, 3], [0, 2], null, [1, 2], [1, 3], [0, 1], [3, 0], []];

/**
 * Iso-line segments of a scalar grid.
 * @param {Float32Array|Uint8Array} field row-major, index i + j·nx
 * @param {number} nx
 * @param {number} ny
 * @param {number} iso
 * @param {number} [pad] value assumed outside the grid (NaN = cells touching the border are skipped)
 * @returns {{segs: Float64Array, count: number}}
 */
export function isoSegments(field, nx, ny, iso, pad = NaN) {
  const out = new Grow(Float64Array, 4096);
  const padded = !Number.isNaN(pad);
  const at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? pad : field[i + j * nx]);
  const lo = padded ? -1 : 0;
  for (let j = lo; j < ny - (padded ? 0 : 1); j++) {
    for (let i = lo; i < nx - (padded ? 0 : 1); i++) {
      const v0 = at(i, j), v1 = at(i + 1, j), v2 = at(i + 1, j + 1), v3 = at(i, j + 1);
      if (Number.isNaN(v0) || Number.isNaN(v1) || Number.isNaN(v2) || Number.isNaN(v3)) continue;
      const c = (v0 > iso ? 1 : 0) | (v1 > iso ? 2 : 0) | (v2 > iso ? 4 : 0) | (v3 > iso ? 8 : 0);
      if (c === 0 || c === 15) continue;
      const edgePt = (e) => {
        if (e === 0) return [i + (iso - v0) / (v1 - v0), j];
        if (e === 1) return [i + 1, j + (iso - v1) / (v2 - v1)];
        if (e === 2) return [i + (iso - v3) / (v2 - v3), j + 1];
        return [i, j + (iso - v0) / (v3 - v0)];
      };
      let pairs = TABLE[c];
      if (!pairs) {
        const centerAbove = (v0 + v1 + v2 + v3) / 4 > iso;
        if (c === 5) pairs = centerAbove ? [0, 1, 2, 3] : [3, 0, 1, 2];
        else pairs = centerAbove ? [3, 0, 1, 2] : [0, 1, 2, 3];
      }
      for (let k = 0; k < pairs.length; k += 2) {
        const a = edgePt(pairs[k]), b = edgePt(pairs[k + 1]);
        out.push(a[0]); out.push(a[1]); out.push(b[0]); out.push(b[1]);
      }
    }
  }
  return { segs: out.a, count: out.n / 4 };
}

/**
 * Iso-lines chained into polylines (grid coordinates).
 * @returns {Array<{pts:number[], closed:boolean}>}
 */
export function isoLines(field, nx, ny, iso, pad = NaN) {
  const { segs, count } = isoSegments(field, nx, ny, iso, pad);
  return chainSegments(segs, count, 1e-6);
}

/**
 * Maps grid-coordinate polylines to model coordinates: x = x0 + (gx + 0.5)·cell.
 * @param {Array<{pts:number[], closed:boolean}>} polys
 * @param {number} x0
 * @param {number} y0
 * @param {number} cell
 */
export function gridToModel(polys, x0, y0, cell) {
  return polys.map((p) => ({ pts: p.pts.map((v, k) => (k % 2 === 0 ? x0 : y0) + (v + 0.5) * cell), closed: p.closed }));
}
