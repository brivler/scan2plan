/**
 * Mesh container helpers. A mesh is
 * `{positions: Float32Array, indices: Uint32Array|null, colors?: Uint8Array, uvs?: Float32Array,
 *   texture?: {bytes: Uint8Array, mimeType: string}}`.
 * `indices === null` means a point cloud. Colors are RGB bytes per vertex.
 */

/** Growable typed array (amortized doubling). */
export class Grow {
  /** @param {Float32ArrayConstructor|Uint32ArrayConstructor|Uint8ArrayConstructor|Float64ArrayConstructor} Type */
  constructor(Type, initial = 1024) {
    this.Type = Type;
    this.a = new Type(initial);
    this.n = 0;
  }
  /** @param {number} v */
  push(v) {
    if (this.n === this.a.length) this.grow();
    this.a[this.n++] = v;
  }
  grow() {
    const b = new this.Type(this.a.length * 2);
    b.set(this.a);
    this.a = b;
  }
  /** @returns {any} a trimmed copy */
  toArray() {
    return this.a.slice(0, this.n);
  }
}

/**
 * Axis-aligned bounding box of positions.
 * @param {Float32Array|Float64Array} positions
 * @returns {{min:number[], max:number[]}}
 */
export function computeBBox(positions) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

/** @param {{min:number[],max:number[]}} b */
export function bboxDiagonal(b) {
  return Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
}

/** @param {{indices: Uint32Array|null}} mesh */
export function triangleCount(mesh) {
  return mesh.indices ? mesh.indices.length / 3 : 0;
}

/**
 * Applies a column-major 4×4 matrix to all positions, returning new positions.
 * @param {Float32Array} positions
 * @param {number[]} m
 * @returns {Float32Array}
 */
export function transformPositions(positions, m) {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  return out;
}

/**
 * Per-triangle unit normals, areas and centroids (Float64 for accuracy).
 * @param {Float32Array} positions
 * @param {Uint32Array} indices
 */
export function faceData(positions, indices) {
  const nt = indices.length / 3;
  const normals = new Float32Array(nt * 3);
  const areas = new Float64Array(nt);
  const centroids = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = indices[3 * t] * 3, b = indices[3 * t + 1] * 3, c = indices[3 * t + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    areas[t] = len / 2;
    if (len > 0) {
      normals[3 * t] = nx / len; normals[3 * t + 1] = ny / len; normals[3 * t + 2] = nz / len;
    }
    for (let k = 0; k < 3; k++) centroids[3 * t + k] = (positions[a + k] + positions[b + k] + positions[c + k]) / 3;
  }
  return { normals, areas, centroids };
}

/**
 * Merges several meshes into one indexed mesh. Colors/UVs are kept if any part has them
 * (missing parts get grey / zero UVs).
 * @param {Array<{positions:Float32Array, indices:Uint32Array|null, colors?:Uint8Array, uvs?:Float32Array}>} parts
 */
export function mergeMeshes(parts) {
  let nv = 0, ni = 0;
  const anyColors = parts.some((p) => p.colors), anyUvs = parts.some((p) => p.uvs);
  const isPoints = parts.every((p) => !p.indices);
  for (const p of parts) { nv += p.positions.length / 3; ni += p.indices ? p.indices.length : 0; }
  const positions = new Float32Array(nv * 3);
  const indices = isPoints ? null : new Uint32Array(ni);
  const colors = anyColors ? new Uint8Array(nv * 3).fill(176) : undefined;
  const uvs = anyUvs ? new Float32Array(nv * 2) : undefined;
  let vo = 0, io = 0;
  for (const p of parts) {
    positions.set(p.positions, vo * 3);
    if (colors && p.colors) colors.set(p.colors, vo * 3);
    if (uvs && p.uvs) uvs.set(p.uvs, vo * 2);
    if (indices && p.indices) {
      for (let i = 0; i < p.indices.length; i++) indices[io + i] = p.indices[i] + vo;
      io += p.indices.length;
    }
    vo += p.positions.length / 3;
  }
  return { positions, indices, colors, uvs };
}
