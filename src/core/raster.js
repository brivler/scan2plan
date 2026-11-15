/**
 * Pure-JS orthographic depth rasterizer (REQ-025 elevations, REQ-026 sections, REQ-045 terrain).
 * Pure: no DOM, no three.js.
 */

/**
 * @typedef {object} RasterView
 * @property {number[]} right  image +x direction (world, unit)
 * @property {number[]} up     image +y direction (world, unit)
 * @property {number[]} forward viewing direction (world, unit); depth = p·forward − zOffset
 * @property {number} [zOffset]
 */

/**
 * @typedef {object} RasterGrid
 * @property {number} x0 left edge (model units along `right`)
 * @property {number} y0 bottom edge (along `up`)
 * @property {number} res cell size (m)
 * @property {number} w
 * @property {number} h
 */

/**
 * Extent of the mesh projected into the view plane.
 * @param {Float32Array} positions
 * @param {RasterView} view
 */
export function projectedExtent(positions, view) {
  const [rx, ry, rz] = view.right, [ux, uy, uz] = view.up;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] * rx + positions[i + 1] * ry + positions[i + 2] * rz;
    const y = positions[i] * ux + positions[i + 1] * uy + positions[i + 2] * uz;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Rasterizes triangles keeping the nearest depth within [zMin, zMax].
 * Pixel (i, j) centre is at (x0 + (i+0.5)·res, y0 + (j+0.5)·res); j grows upward.
 * @param {Float32Array} positions
 * @param {Uint32Array} indices
 * @param {RasterView} view
 * @param {RasterGrid} grid
 * @param {{zMin?:number, zMax?:number}} [range]
 * @returns {{depth: Float32Array, shade: Float32Array}} depth = Infinity where empty; shade = |n·forward|
 */
export function rasterize(positions, indices, view, grid, range = {}) {
  const { x0, y0, res, w, h } = grid;
  const zMin = range.zMin ?? -Infinity, zMax = range.zMax ?? Infinity;
  const [rx, ry, rz] = view.right, [ux, uy, uz] = view.up, [fx, fy, fz] = view.forward;
  const zo = view.zOffset || 0;
  const depth = new Float32Array(w * h).fill(Infinity);
  const shade = new Float32Array(w * h);
  const nv = positions.length / 3;
  const px = new Float64Array(nv), py = new Float64Array(nv), pz = new Float64Array(nv);
  for (let v = 0; v < nv; v++) {
    const X = positions[3 * v], Y = positions[3 * v + 1], Z = positions[3 * v + 2];
    px[v] = (X * rx + Y * ry + Z * rz - x0) / res - 0.5;
    py[v] = (X * ux + Y * uy + Z * uz - y0) / res - 0.5;
    pz[v] = X * fx + Y * fy + Z * fz - zo;
  }
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    const ax = px[a], ay = py[a], bx = px[b], by = py[b], cx = px[c], cy = py[c];
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) continue;
    const za = pz[a], zb = pz[b], zc = pz[c];
    if ((za < zMin && zb < zMin && zc < zMin) || (za > zMax && zb > zMax && zc > zMax)) continue;
    const i0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx))), i1 = Math.min(w - 1, Math.floor(Math.max(ax, bx, cx)));
    const j0 = Math.max(0, Math.ceil(Math.min(ay, by, cy))), j1 = Math.min(h - 1, Math.floor(Math.max(ay, by, cy)));
    if (i0 > i1 || j0 > j1) continue;
    // face shade
    const ex = positions[3 * b] - positions[3 * a], ey = positions[3 * b + 1] - positions[3 * a + 1], ez = positions[3 * b + 2] - positions[3 * a + 2];
    const gx = positions[3 * c] - positions[3 * a], gy = positions[3 * c + 1] - positions[3 * a + 1], gz = positions[3 * c + 2] - positions[3 * a + 2];
    const nx = ey * gz - ez * gy, ny = ez * gx - ex * gz, nz = ex * gy - ey * gx;
    const s = Math.abs(nx * fx + ny * fy + nz * fz) / (Math.hypot(nx, ny, nz) || 1);
    const inv = 1 / area;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const w0 = ((bx - i) * (cy - j) - (by - j) * (cx - i)) * inv;
        const w1 = ((cx - i) * (ay - j) - (cy - j) * (ax - i)) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
        const z = w0 * za + w1 * zb + w2 * zc;
        if (z < zMin || z > zMax) continue;
        const k = i + j * w;
        if (z < depth[k]) { depth[k] = z; shade[k] = s; }
      }
    }
  }
  return { depth, shade };
}
