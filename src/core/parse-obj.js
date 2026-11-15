/**
 * Byte-level OBJ reader (REQ-002): `v x y z [r g b]` and `f` records only.
 * Polygons are triangulated as fans, negative (relative) indices are supported,
 * `o`/`g` groups are merged, materials and textures are ignored.
 * Pure: no DOM, no three.js. Works on bytes to avoid huge strings for 100+ MB files.
 */
import { ImportError } from './errors.js';
import { Grow } from './mesh.js';

const NL = 10, CR = 13, SP = 32, TAB = 9, SLASH = 47;

/**
 * @param {ArrayBuffer} buffer
 * @param {(fraction:number)=>void} [onProgress]
 * @returns {{mesh: object, kind: 'mesh'|'points'}}
 */
export function parseOBJ(buffer, onProgress) {
  const b = new Uint8Array(buffer);
  const pos = new Grow(Float32Array, 1 << 16);
  const col = new Grow(Uint8Array, 1 << 16);
  const idx = new Grow(Uint32Array, 1 << 16);
  let hasColor = false;
  const face = [];
  const n = b.length;
  let i = 0, nextReport = 1 << 22;
  const num = { v: 0, end: 0 };

  while (i < n) {
    if (i > nextReport && onProgress) { onProgress(i / n); nextReport += 1 << 22; }
    // skip leading whitespace
    while (i < n && (b[i] === SP || b[i] === TAB)) i++;
    const c0 = b[i], c1 = b[i + 1];
    if (c0 === 118 /* v */ && (c1 === SP || c1 === TAB)) {
      i += 2;
      const vals = [];
      while (i < n && b[i] !== NL && b[i] !== CR) {
        if (b[i] === SP || b[i] === TAB) { i++; continue; }
        if (!readNumber(b, i, num)) break;
        vals.push(num.v); i = num.end;
      }
      if (vals.length < 3) throw new ImportError('E-IMP-02', 'bad vertex record');
      pos.push(vals[0]); pos.push(vals[1]); pos.push(vals[2]);
      if (vals.length >= 6) {
        hasColor = true;
        const scale = vals[3] > 1 || vals[4] > 1 || vals[5] > 1 ? 1 : 255;
        col.push(clamp255(vals[3] * scale)); col.push(clamp255(vals[4] * scale)); col.push(clamp255(vals[5] * scale));
      } else { col.push(176); col.push(176); col.push(176); }
    } else if (c0 === 102 /* f */ && (c1 === SP || c1 === TAB)) {
      i += 2;
      face.length = 0;
      const nv = pos.n / 3;
      while (i < n && b[i] !== NL && b[i] !== CR) {
        if (b[i] === SP || b[i] === TAB) { i++; continue; }
        if (!readNumber(b, i, num)) throw new ImportError('E-IMP-02', 'bad face record');
        let k = num.v;
        i = num.end;
        while (i < n && b[i] !== SP && b[i] !== TAB && b[i] !== NL && b[i] !== CR) i++; // skip /vt/vn
        k = k < 0 ? nv + k : k - 1;
        if (!(k >= 0 && k < nv) || !Number.isInteger(k)) throw new ImportError('E-IMP-02', 'face index out of range');
        face.push(k);
      }
      for (let t = 1; t + 1 < face.length; t++) { idx.push(face[0]); idx.push(face[t]); idx.push(face[t + 1]); }
    }
    while (i < n && b[i] !== NL) i++; // to end of line
    i++;
  }
  if (pos.n === 0) throw new ImportError('E-IMP-07');
  const mesh = { positions: pos.toArray(), indices: idx.n ? idx.toArray() : null };
  if (hasColor) mesh.colors = col.toArray();
  return { mesh, kind: mesh.indices ? 'mesh' : 'points' };
}

function clamp255(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * Parses a decimal number starting at b[i]. Stops at whitespace, '/', or EOL.
 * @returns {boolean} false if no number was found
 */
export function readNumber(b, i, out) {
  let sign = 1, v = 0, digits = 0;
  if (b[i] === 45) { sign = -1; i++; } else if (b[i] === 43) i++;
  while (b[i] >= 48 && b[i] <= 57) { v = v * 10 + (b[i] - 48); i++; digits++; }
  if (b[i] === 46) {
    i++;
    let f = 0.1;
    while (b[i] >= 48 && b[i] <= 57) { v += (b[i] - 48) * f; f *= 0.1; i++; digits++; }
  }
  if (!digits) return false;
  if (b[i] === 101 || b[i] === 69) {
    i++;
    let es = 1, e = 0;
    if (b[i] === 45) { es = -1; i++; } else if (b[i] === 43) i++;
    while (b[i] >= 48 && b[i] <= 57) { e = e * 10 + (b[i] - 48); i++; }
    v *= Math.pow(10, es * e);
  }
  const c = b[i];
  if (!(c === undefined || c === SP || c === TAB || c === NL || c === CR || c === SLASH || c === 44)) return false;
  out.v = sign * v;
  out.end = i;
  return true;
}
