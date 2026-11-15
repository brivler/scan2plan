/**
 * Display decimation by uniform-grid vertex clustering (REQ-016).
 * The display copy is only for rendering; measurements always use the full mesh.
 * Pure: no DOM, no three.js.
 */
import { computeBBox } from './mesh.js';

/** Display triangle budget. */
export const DISPLAY_MAX_TRIANGLES = 500_000;
const START_CELL = 0.005;

/**
 * Returns the mesh unchanged if within budget, otherwise a clustered copy.
 * Cell size doubles from 5 mm until the triangle count fits.
 * @param {{positions:Float32Array, indices:Uint32Array, colors?:Uint8Array, uvs?:Float32Array}} mesh
 * @param {number} [maxTriangles]
 * @returns {{mesh: object, cellSize: number|null}}
 */
export function decimateForDisplay(mesh, maxTriangles = DISPLAY_MAX_TRIANGLES) {
  if (!mesh.indices || mesh.indices.length / 3 <= maxTriangles) return { mesh, cellSize: null };
  let cell = START_CELL;
  for (;;) {
    const out = clusterOnce(mesh, cell);
    if (out.indices.length / 3 <= maxTriangles) return { mesh: out, cellSize: cell };
    cell *= 2;
  }
}

/**
 * One clustering pass with the given cell size.
 * @param {object} mesh
 * @param {number} cell
 */
export function clusterOnce(mesh, cell) {
  const { positions, indices, colors, uvs } = mesh;
  const nv = positions.length / 3;
  const bb = computeBBox(positions);
  const nx = Math.floor((bb.max[0] - bb.min[0]) / cell) + 1;
  const ny = Math.floor((bb.max[1] - bb.min[1]) / cell) + 1;
  const map = new Map();
  const remap = new Uint32Array(nv);
  const sum = [];
  let nc = 0;
  for (let v = 0; v < nv; v++) {
    const ix = Math.floor((positions[3 * v] - bb.min[0]) / cell);
    const iy = Math.floor((positions[3 * v + 1] - bb.min[1]) / cell);
    const iz = Math.floor((positions[3 * v + 2] - bb.min[2]) / cell);
    const key = ix + nx * (iy + ny * iz);
    let c = map.get(key);
    if (c === undefined) { c = nc++; map.set(key, c); sum.push(0, 0, 0, 0, v); }
    remap[v] = c;
    sum[5 * c] += positions[3 * v]; sum[5 * c + 1] += positions[3 * v + 1]; sum[5 * c + 2] += positions[3 * v + 2]; sum[5 * c + 3]++;
  }
  const outPos = new Float32Array(nc * 3);
  const outCol = colors ? new Uint8Array(nc * 3) : undefined;
  const outUv = uvs ? new Float32Array(nc * 2) : undefined;
  for (let c = 0; c < nc; c++) {
    const n = sum[5 * c + 3], first = sum[5 * c + 4];
    outPos[3 * c] = sum[5 * c] / n; outPos[3 * c + 1] = sum[5 * c + 1] / n; outPos[3 * c + 2] = sum[5 * c + 2] / n;
    if (outCol) for (let k = 0; k < 3; k++) outCol[3 * c + k] = colors[3 * first + k];
    if (outUv) { outUv[2 * c] = uvs[2 * first]; outUv[2 * c + 1] = uvs[2 * first + 1]; }
  }
  const tri = new Uint32Array(indices.length);
  let nt = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = remap[indices[i]], b = remap[indices[i + 1]], c = remap[indices[i + 2]];
    if (a === b || b === c || a === c) continue;
    tri[nt++] = a; tri[nt++] = b; tri[nt++] = c;
  }
  const out = { positions: outPos, indices: tri.slice(0, nt) };
  if (outCol) out.colors = outCol;
  if (outUv) { out.uvs = outUv; out.texture = mesh.texture; }
  return out;
}
