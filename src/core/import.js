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
  const firstData = lines.find((l) => l.trim() && !/^\s*(#|\/\/)/.test(l));
  if (firstData && firstData.trim().split(/[\s,;]+/).slice(0, 3).filter((t) => t !== '' && Number.isFinite(Number(t))).length === 3) return 'xyz';
  if (!trimmed) throw new ImportError('E-IMP-07');
  throw new ImportError('E-IMP-01');
}

/**
 * Reads a whitespace/comma separated `x y z [...]` point cloud (REQ-006, COULD).
 * @param {ArrayBuffer} buffer
 */
export function parseXYZ(buffer) {
  const b = new Uint8Array(buffer);
  const pos = new Grow(Float32Array, 1 << 16);
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
  return { mesh: res.mesh, kind: res.kind, format, extras: res.extras || null };
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
