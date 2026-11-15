/**
 * File-type detection by content and dispatch to the parsers (REQ-001…REQ-006).
 * Pure: no DOM, no three.js.
 */
import { ImportError, MAX_TRIANGLES, MAX_POINTS } from './errors.js';
import { parseGLB, parseGLTFJson } from './parse-gltf.js';
import { parseOBJ, readNumber } from './parse-obj.js';
import { parsePLY } from './parse-ply.js';
import { Grow } from './mesh.js';

/**
 * Detects the format from the first bytes (magic numbers / text records), never from the extension.
 * @param {Uint8Array} bytes
 * @returns {'glb'|'gltf'|'ply'|'obj'|'xyz'}
 */
export function detectFormat(bytes) {
  if (bytes.length === 0) throw new ImportError('E-IMP-07');
  if (bytes.length >= 4 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46) return 'glb';
  const head = bytes.subarray(0, Math.min(bytes.length, 65536));
  if (head[0] === 0x70 && head[1] === 0x6c && head[2] === 0x79 && (head[3] === 10 || head[3] === 13)) return 'ply';
  for (let i = 0; i < head.length; i++) {
    const c = head[i];
    if (c === 0 || (c < 32 && c !== 9 && c !== 10 && c !== 13)) throw new ImportError('E-IMP-01'); // binary, unknown
  }
  const text = new TextDecoder('latin1').decode(head);
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) {
    if (text.includes('"asset"')) return 'gltf';
    throw new ImportError('E-IMP-01');
  }
  const lines = text.split(/\r?\n/);
  if (lines.some((l) => /^\s*v\s/.test(l))) return 'obj';
  if (bytes.length > head.length && /^\s*(#|mtllib|vt|vn|o |g |s )/m.test(text) && hasObjVertexLine(bytes)) return 'obj'; // long OBJ header (DEF-16)
  const firstData = lines.find((l) => l.trim() && !/^\s*(#|\/\/)/.test(l));
  if (firstData && firstData.trim().split(/[\s,;]+/).slice(0, 3).filter((t) => t !== '' && Number.isFinite(Number(t))).length === 3) return 'xyz';
  if (!trimmed) throw new ImportError('E-IMP-07');
  throw new ImportError('E-IMP-01');
}

/**
 * Scans the whole buffer for a line starting with "v " / "v\t" (OBJ vertex record).
 * @param {Uint8Array} b
 */
function hasObjVertexLine(b) {
  for (let i = 0; i + 1 < b.length; i++) {
    if ((i === 0 || b[i - 1] === 10) && b[i] === 118 && (b[i + 1] === 32 || b[i + 1] === 9)) return true;
  }
  return false;
}

/**
 * Reads a whitespace/comma separated `x y z [...]` point cloud (REQ-006, COULD).
 * @param {ArrayBuffer} buffer
 */
export function parseXYZ(buffer) {
  const b = new Uint8Array(buffer);
  const pos = new Grow(Float64Array, 1 << 16);
  const num = { v: 0, end: 0 };
  let i = 0;
  while (i < b.length) {
    while (i < b.length && (b[i] === 32 || b[i] === 9)) i++;
    const vals = [];
    while (i < b.length && b[i] !== 10 && b[i] !== 13 && vals.length < 3) {
      if (b[i] === 32 || b[i] === 9 || b[i] === 44 || b[i] === 59) { i++; continue; }
      if (!readNumber(b, i, num)) break;
      vals.push(num.v); i = num.end;
    }
    if (vals.length === 3) { pos.push(vals[0]); pos.push(vals[1]); pos.push(vals[2]); }
    while (i < b.length && b[i] !== 10) i++;
    i++;
  }
  if (!pos.n) throw new ImportError('E-IMP-07');
  return { mesh: { positions: pos.toArray(), indices: null }, kind: 'points' };
}

/**
 * Parses any supported scan file.
 * @param {ArrayBuffer} buffer
 * @param {(fraction:number)=>void} [onProgress]
 * @returns {{mesh: object, kind: 'mesh'|'points', format: string, extras: object|null}}
 */
export function importScan(buffer, onProgress) {
  const bytes = new Uint8Array(buffer);
  const format = detectFormat(bytes);
  let res;
  try {
    if (format === 'glb') res = parseGLB(buffer);
    else if (format === 'gltf') res = parseGLTFJson(new TextDecoder().decode(bytes));
    else if (format === 'ply') res = parsePLY(buffer);
    else if (format === 'obj') res = parseOBJ(buffer, onProgress);
    else res = parseXYZ(buffer);
  } catch (e) {
    if (e instanceof ImportError) throw e;
    if (e instanceof RangeError) throw new ImportError('E-IMP-05', e.message); // allocation failure
    throw new ImportError('E-IMP-02', e && e.message);
  }
  validateMesh(res.mesh, res.kind);
  const origin = recenter(res.mesh);
  return { mesh: res.mesh, kind: res.kind, format, extras: res.extras || null, origin };
}

/** Coordinates beyond this magnitude (m) are recentred before the float32 conversion. */
export const RECENTER_LIMIT = 10_000;

/**
 * Converts parsed float64 positions to float32 (DEF-05). Axes whose coordinates exceed
 * ±10 km (georeferenced scans, e.g. UTM) are first shifted by a whole-metre origin, so
 * centimetre precision survives (float32 has ~0.5 m resolution at 5·10⁶ m).
 * @param {{positions: Float32Array|Float64Array}} mesh modified in place
 * @returns {number[]} origin subtracted per axis (zeros for normal scans)
 */
export function recenter(mesh) {
  const p = mesh.positions;
  const origin = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    let lo = Infinity, hi = -Infinity;
    for (let i = k; i < p.length; i += 3) { if (p[i] < lo) lo = p[i]; if (p[i] > hi) hi = p[i]; }
    if (Math.max(Math.abs(lo), Math.abs(hi)) > RECENTER_LIMIT) origin[k] = Math.round((lo + hi) / 2);
  }
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    out[i] = p[i] - origin[0]; out[i + 1] = p[i + 1] - origin[1]; out[i + 2] = p[i + 2] - origin[2];
  }
  mesh.positions = out;
  return origin;
}

/** Throws on empty geometry, non-finite values or size limits. */
function validateMesh(mesh, kind) {
  const nv = mesh.positions.length / 3;
  if (nv === 0) throw new ImportError('E-IMP-07');
  if (kind === 'mesh' && mesh.indices.length / 3 > MAX_TRIANGLES) throw new ImportError('E-IMP-05');
  if (kind === 'points' && nv > MAX_POINTS) throw new ImportError('E-IMP-05');
  const p = mesh.positions;
  for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) throw new ImportError('E-IMP-02', 'non-finite coordinate');
}
