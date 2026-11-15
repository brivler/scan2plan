/**
 * Synthetic mesh fixtures for tests (spec §4 conventions): meters, +Y up.
 * box(w,d,h): X ∈ [0,w], Y ∈ [0,h], Z ∈ [0,d]; outward normals; 12 triangles.
 */
import { applyToPoint, rotationAxis } from '../../src/core/mat4.js';

/** Seeded RNG (mulberry32). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mesh builder with optional vertex sharing (by rounded coordinates). */
export class Builder {
  constructor(share = false) { this.p = []; this.i = []; this.share = share; this.map = new Map(); }
  v(x, y, z) {
    if (this.share) {
      const k = `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`;
      const e = this.map.get(k);
      if (e !== undefined) return e;
      this.map.set(k, this.p.length / 3);
    }
    this.p.push(x, y, z);
    return this.p.length / 3 - 1;
  }
  /** Quad a,b,c,d (counter-clockwise seen from the normal side). */
  quad(a, b, c, d) {
    const [ia, ib, ic, id] = [a, b, c, d].map((q) => this.v(...q));
    this.i.push(ia, ib, ic, ia, ic, id);
  }
  /** Quad subdivided into n×m cells. */
  grid(a, b, c, d, n, m) {
    const lerp = (p, q, t) => p.map((v, k) => v + (q[k] - v) * t);
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      const P = (s, t) => lerp(lerp(a, b, s), lerp(d, c, s), t);
      this.quad(P(i / n, j / m), P((i + 1) / n, j / m), P((i + 1) / n, (j + 1) / m), P(i / n, (j + 1) / m));
    }
  }
  mesh() { return { positions: new Float32Array(this.p), indices: new Uint32Array(this.i) }; }
}

/** The six outward faces of an axis-aligned box as quads. */
function boxFaces(x0, y0, z0, w, d, h) {
  const x1 = x0 + w, y1 = y0 + h, z1 = z0 + d;
  return [
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], // bottom −Y
    [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], // top +Y
    [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]], // z0 −Z
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], // z1 +Z
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], // x0 −X
    [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], // x1 +X
  ];
}

/** Closed box, 8 shared vertices, 12 triangles. */
export function box(w, d, h, origin = [0, 0, 0]) {
  const b = new Builder(true);
  for (const f of boxFaces(origin[0], origin[1], origin[2], w, d, h)) b.quad(...f);
  return b.mesh();
}

/** Box subdivided into cells of ~`cell` metres with shared vertices. */
export function subdividedBox(w, d, h, cell) {
  const b = new Builder(true);
  const faces = boxFaces(0, 0, 0, w, d, h);
  for (const f of faces) {
    const n = Math.max(1, Math.round(dist(f[0], f[1]) / cell)), m = Math.max(1, Math.round(dist(f[0], f[3]) / cell));
    b.grid(f[0], f[1], f[2], f[3], n, m);
  }
  return b.mesh();
}

function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }

/** Applies a 4×4 matrix to a mesh (new positions). */
export function transformMesh(mesh, m) {
  const p = new Float32Array(mesh.positions.length);
  for (let i = 0; i < p.length; i += 3) p.set(applyToPoint(m, [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]), i);
  return { ...mesh, positions: p };
}

/** Rotation helper in degrees. */
export function rot(axis, deg) { return rotationAxis(axis, (deg * Math.PI) / 180); }

/** Concatenates meshes. */
export function concat(...meshes) {
  const p = [], idx = [];
  for (const m of meshes) {
    const o = p.length / 3;
    p.push(...m.positions);
    for (const i of m.indices) idx.push(i + o);
  }
  return { positions: new Float32Array(p), indices: new Uint32Array(idx) };
}

/** L-shaped prism: 6×4 m footprint minus the 3×2 m corner at (3..6, 2..4) in X/Z; height h. */
export function lPrism(h = 2.5) {
  const ring = [[0, 0], [6, 0], [6, 2], [3, 2], [3, 4], [0, 4]]; // X,Z
  const b = new Builder(true);
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length];
    b.quad([x0, 0, z0], [x0, h, z0], [x1, h, z1], [x1, 0, z1]);
  }
  for (const y of [0, h]) { // floor/ceiling as two rectangles
    b.quad([0, y, 0], [6, y, 0], [6, y, 2], [0, y, 2]);
    b.quad([0, y, 2], [3, y, 2], [3, y, 4], [0, y, 4]);
  }
  return b.mesh();
}

/** Subdivided horizontal plane (n×n quads = 2n² triangles) over size×size metres. */
export function plane(size, n, heightFn = () => 0) {
  const p = new Float32Array((n + 1) * (n + 1) * 3), idx = new Uint32Array(n * n * 6);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = (i / n) * size, z = (j / n) * size, k = (i + j * (n + 1)) * 3;
    p[k] = x; p[k + 1] = heightFn(x, z); p[k + 2] = z;
  }
  let o = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = i + j * (n + 1), b = a + 1, c = a + n + 2, d = a + n + 1;
    idx[o++] = a; idx[o++] = d; idx[o++] = c; idx[o++] = a; idx[o++] = c; idx[o++] = b;
  }
  return { positions: p, indices: idx };
}

/**
 * Wall with rectangular holes, as quads (single-sided). Wall runs along `axis` ('x' or 'z')
 * at the fixed coordinate `at`, from 0 to `len`, height h. Holes: [{from, to, bottom, top}].
 */
export function wallWithHoles(b, axis, at, len, h, holes) {
  const P = (u, y) => (axis === 'x' ? [u, y, at] : [at, y, u]);
  const cuts = [0, len, ...holes.flatMap((o) => [o.from, o.to])].sort((x, y) => x - y);
  for (let k = 0; k + 1 < cuts.length; k++) {
    const u0 = cuts[k], u1 = cuts[k + 1];
    if (u1 - u0 < 1e-9) continue;
    const hole = holes.find((o) => o.from <= u0 + 1e-9 && o.to >= u1 - 1e-9);
    const spans = hole ? [[0, hole.bottom], [hole.top, h]] : [[0, h]];
    for (const [y0, y1] of spans) if (y1 - y0 > 1e-9) b.quad(P(u0, y0), P(u1, y0), P(u1, y1), P(u0, y1));
  }
}
