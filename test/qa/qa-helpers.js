/**
 * QA-only fixtures (independent of the coder's helpers where it matters).
 * Interior rooms are built with INWARD normals, as a scanner produces them
 * (the surface faces the camera that walked inside the room).
 */
import { Builder } from '../helpers/meshes.js';

/**
 * Interior room scan, +Y up, inward normals.
 * @param {number} w X extent
 * @param {number} d Z extent
 * @param {number} h height
 * @param {{floorFraction?:number, bed?:number[]|null, ceiling?:boolean, walls?:boolean, floor?:boolean, n?:number}} [o]
 *   bed = [x0, z0, x1, z1, topY] adds an up-facing horizontal surface (furniture top)
 */
export function room(w, d, h, o = {}) {
  const { floorFraction = 1, bed = null, ceiling = true, walls = true, floor = true, n = 1 } = o;
  const b = new Builder(true);
  const g = (a, bb, c, dd) => (n > 1 ? b.grid(a, bb, c, dd, n, n) : b.quad(a, bb, c, dd));
  if (floor) g([0, 0, 0], [0, 0, d * floorFraction], [w, 0, d * floorFraction], [w, 0, 0]); // +Y
  if (ceiling) g([0, h, 0], [w, h, 0], [w, h, d], [0, h, d]); // −Y
  if (walls) {
    g([0, 0, 0], [w, 0, 0], [w, h, 0], [0, h, 0]); // z=0, +Z
    g([0, 0, d], [0, h, d], [w, h, d], [w, 0, d]); // z=d, −Z
    g([0, 0, 0], [0, h, 0], [0, h, d], [0, 0, d]); // x=0, +X
    g([w, 0, 0], [w, 0, d], [w, h, d], [w, h, 0]); // x=w, −X
  }
  if (bed) { const [x0, z0, x1, z1, y] = bed; b.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]); }
  return b.mesh();
}

/** Mesh → OBJ text (1-based indices). Optional coordinate offset applied in float64 text. */
export function toObj(mesh, offset = [0, 0, 0], digits = 4) {
  const lines = [];
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) lines.push(`v ${(p[i] + offset[0]).toFixed(digits)} ${(p[i + 1] + offset[1]).toFixed(digits)} ${(p[i + 2] + offset[2]).toFixed(digits)}`);
  for (let i = 0; i < mesh.indices.length; i += 3) lines.push(`f ${mesh.indices[i] + 1} ${mesh.indices[i + 1] + 1} ${mesh.indices[i + 2] + 1}`);
  return `${lines.join('\n')}\n`;
}

/** Swaps a +Y-up mesh into Z-up convention: (x, y, z) → (x, −z, y). Keeps winding. */
export function yUpToZUp(mesh) {
  const p = new Float32Array(mesh.positions.length);
  for (let i = 0; i < p.length; i += 3) { p[i] = mesh.positions[i]; p[i + 1] = -mesh.positions[i + 2]; p[i + 2] = mesh.positions[i + 1]; }
  return { ...mesh, positions: p };
}

/** String → ArrayBuffer (UTF-8). */
export const enc = (s) => new TextEncoder().encode(s).buffer;

/** Error code thrown by fn, or null. */
export const codeOf = (fn) => { try { fn(); } catch (e) { return e.code ?? e.message; } return null; };

/** |a − b| ≤ eps assertion message helper. */
export const near = (assert, a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg}: got ${a}, expected ${b} ± ${eps}`);

/** Square pyramid terrain (apex height `top` at centre of a size×size base), regular grid mesh. */
export function pyramidTerrain(size, n, top) {
  const c = size / 2;
  const p = new Float32Array((n + 1) * (n + 1) * 3), idx = new Uint32Array(n * n * 6);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = (i / n) * size, z = (j / n) * size, k = (i + j * (n + 1)) * 3;
    p[k] = x; p[k + 2] = z;
    p[k + 1] = top * Math.max(0, 1 - Math.max(Math.abs(x - c), Math.abs(z - c)) / c);
  }
  let o = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = i + j * (n + 1), b = a + 1, cc = a + n + 2, d = a + n + 1;
    idx[o++] = a; idx[o++] = d; idx[o++] = cc; idx[o++] = a; idx[o++] = cc; idx[o++] = b;
  }
  return { positions: p, indices: idx };
}

/**
 * Loads the real geometry worker module in Node with a `self` shim and returns a
 * synchronous call function: call(op, args) → result (throws on {ok:false}).
 */
export async function loadWorker() {
  const posted = [];
  globalThis.self = { postMessage: (m) => posted.push(m) };
  await import(`../../src/worker/geometry.worker.js?qa=${Math.random()}`);
  const handler = globalThis.self.onmessage;
  let id = 0;
  return (op, args = {}) => {
    posted.length = 0;
    handler({ data: { id: ++id, op, args } });
    const msg = posted.find((m) => m.ok !== undefined);
    if (!msg.ok) { const e = new Error(msg.error.message); e.code = msg.error.code; throw e; }
    return msg.result;
  };
}
