/**
 * PLY reader (REQ-003): ASCII and binary (little/big endian), mesh or point cloud.
 * Gaussian-splat PLY files (vertex properties f_dc_0 / opacity / scale_0 / rot_0)
 * are rejected with E-IMP-03. Pure: no DOM, no three.js.
 */
import { ImportError } from './errors.js';
import { Grow } from './mesh.js';

const SPLAT_PROPS = ['f_dc_0', 'opacity', 'scale_0', 'rot_0'];
const TYPE_INFO = {
  char: ['getInt8', 1], int8: ['getInt8', 1], uchar: ['getUint8', 1], uint8: ['getUint8', 1],
  short: ['getInt16', 2], int16: ['getInt16', 2], ushort: ['getUint16', 2], uint16: ['getUint16', 2],
  int: ['getInt32', 4], int32: ['getInt32', 4], uint: ['getUint32', 4], uint32: ['getUint32', 4],
  float: ['getFloat32', 4], float32: ['getFloat32', 4], double: ['getFloat64', 8], float64: ['getFloat64', 8],
};

/**
 * Parses the PLY header.
 * @param {Uint8Array} bytes
 */
function parseHeader(bytes) {
  const max = Math.min(bytes.length, 65536);
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, max));
  const endIdx = head.indexOf('end_header');
  if (!head.startsWith('ply') || endIdx < 0) throw new ImportError('E-IMP-02', 'bad PLY header');
  let bodyStart = endIdx + 'end_header'.length;
  if (head[bodyStart] === '\r') bodyStart++;
  if (head[bodyStart] === '\n') bodyStart++;
  const lines = head.slice(0, endIdx).split(/\r?\n/);
  let format = null;
  const elements = [];
  for (const line of lines) {
    const t = line.trim().split(/\s+/);
    if (t[0] === 'format') format = t[1];
    else if (t[0] === 'element') elements.push({ name: t[1], count: parseInt(t[2], 10), props: [] });
    else if (t[0] === 'property' && elements.length) {
      const el = elements[elements.length - 1];
      if (t[1] === 'list') el.props.push({ name: t[4], list: true, countType: t[2], type: t[3] });
      else el.props.push({ name: t[2], type: t[1] });
    }
  }
  if (!['ascii', 'binary_little_endian', 'binary_big_endian'].includes(format)) throw new ImportError('E-IMP-02', 'unknown PLY format');
  for (const el of elements) {
    if (!Number.isFinite(el.count) || el.count < 0) throw new ImportError('E-IMP-02', 'bad element count');
    for (const p of el.props) {
      if (!TYPE_INFO[p.type] || (p.list && !TYPE_INFO[p.countType])) throw new ImportError('E-IMP-02', 'unknown PLY type');
    }
  }
  return { format, elements, bodyStart };
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {{mesh: object, kind: 'mesh'|'points'}}
 */
export function parsePLY(buffer) {
  const bytes = new Uint8Array(buffer);
  const { format, elements, bodyStart } = parseHeader(bytes);
  const vertexEl = elements.find((e) => e.name === 'vertex');
  // Compressed splat PLY (SuperSplat/PlayCanvas): `element chunk` + `packed_*` vertex properties (DEF-15)
  const isCompressedSplat = elements.some((e) => e.name === 'chunk') || (vertexEl && vertexEl.props.some((p) => p.name.startsWith('packed_')));
  if (isCompressedSplat) throw new ImportError('E-IMP-03');
  if (!vertexEl || vertexEl.count === 0) throw new ImportError('E-IMP-07');
  const names = vertexEl.props.map((p) => p.name);
  if (SPLAT_PROPS.some((p) => names.includes(p))) throw new ImportError('E-IMP-03');
  if (!['x', 'y', 'z'].every((p) => names.includes(p))) throw new ImportError('E-IMP-07');
  const reader = format === 'ascii' ? asciiReader(bytes, bodyStart) : binaryReader(buffer, bodyStart, format === 'binary_little_endian');
  const nv = vertexEl.count;
  const positions = new Float64Array(nv * 3); // float64 until recentred (DEF-05)
  const colIdx = ['red', 'green', 'blue'].map((c) => names.indexOf(c));
  const colIdx2 = ['diffuse_red', 'diffuse_green', 'diffuse_blue'].map((c) => names.indexOf(c));
  const cIdx = colIdx.every((k) => k >= 0) ? colIdx : colIdx2.every((k) => k >= 0) ? colIdx2 : null;
  const colors = cIdx ? new Uint8Array(nv * 3) : undefined;
  const ix = names.indexOf('x'), iy = names.indexOf('y'), iz = names.indexOf('z');
  const indices = new Grow(Uint32Array, 1 << 16);
  const row = [];
  for (const el of elements) {
    for (let r = 0; r < el.count; r++) {
      row.length = 0;
      for (const p of el.props) row.push(p.list ? reader.list(p.countType, p.type) : reader.scalar(p.type));
      if (el === vertexEl) {
        positions[3 * r] = row[ix]; positions[3 * r + 1] = row[iy]; positions[3 * r + 2] = row[iz];
        if (colors) {
          const isFloat = vertexEl.props[cIdx[0]].type.startsWith('float') || vertexEl.props[cIdx[0]].type === 'double';
          for (let k = 0; k < 3; k++) colors[3 * r + k] = Math.max(0, Math.min(255, Math.round(row[cIdx[k]] * (isFloat ? 255 : 1))));
        }
      } else if (el.name === 'face') {
        const li = el.props.findIndex((p) => p.list && (p.name === 'vertex_indices' || p.name === 'vertex_index'));
        const f = row[li];
        if (!f) continue;
        for (let t = 1; t + 1 < f.length; t++) {
          if (f[0] >= nv || f[t] >= nv || f[t + 1] >= nv || f[0] < 0 || f[t] < 0 || f[t + 1] < 0) throw new ImportError('E-IMP-02', 'face index out of range');
          indices.push(f[0]); indices.push(f[t]); indices.push(f[t + 1]);
        }
      }
    }
  }
  for (let i = 0; i < positions.length; i++) if (!Number.isFinite(positions[i])) throw new ImportError('E-IMP-02', 'non-finite coordinate');
  const mesh = { positions, indices: indices.n ? indices.toArray() : null };
  if (colors) mesh.colors = colors;
  return { mesh, kind: mesh.indices ? 'mesh' : 'points' };
}

function asciiReader(bytes, start) {
  const text = new TextDecoder('latin1').decode(bytes.subarray(start));
  const tokens = text.split(/\s+/).filter(Boolean);
  let k = 0;
  const next = () => {
    if (k >= tokens.length) throw new ImportError('E-IMP-02', 'PLY body truncated');
    const v = Number(tokens[k++]);
    if (Number.isNaN(v)) throw new ImportError('E-IMP-02', 'bad PLY number');
    return v;
  };
  return {
    scalar: () => next(),
    list: () => { const c = next(); const a = new Array(c); for (let i = 0; i < c; i++) a[i] = next(); return a; },
  };
}

function binaryReader(buffer, start, little) {
  const dv = new DataView(buffer);
  let o = start;
  const scalar = (type) => {
    const [fn, size] = TYPE_INFO[type];
    if (o + size > buffer.byteLength) throw new ImportError('E-IMP-02', 'PLY body truncated');
    const v = dv[fn](o, little);
    o += size;
    return v;
  };
  return {
    scalar,
    list: (countType, type) => { const c = scalar(countType); const a = new Array(c); for (let i = 0; i < c; i++) a[i] = scalar(type); return a; },
  };
}
