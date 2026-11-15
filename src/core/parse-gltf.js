/**
 * Minimal glTF 2.0 / GLB geometry reader (REQ-001, REQ-012).
 * Reads all mesh primitives of the default scene, applies node world transforms
 * and merges them into one indexed triangle mesh. Keeps COLOR_0, TEXCOORD_0 and
 * the first base-colour texture image (bytes) for display.
 * Pure: no DOM, no three.js (runs in the worker and in Node tests).
 */
import { ImportError } from './errors.js';
import { identity, multiply, fromTRS } from './mat4.js';
import { mergeMeshes } from './mesh.js';

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const UNSUPPORTED_EXT = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_meshopt_compression'];
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const TYPED = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NORM_DIV = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

/**
 * Parses a GLB (binary) file.
 * @param {ArrayBuffer} buffer
 * @returns {{mesh: object, extras: object|null, kind: 'mesh'|'points'}}
 */
export function parseGLB(buffer) {
  if (buffer.byteLength < 20) throw new ImportError('E-IMP-02', 'GLB shorter than header');
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new ImportError('E-IMP-01');
  const length = dv.getUint32(8, true);
  if (length > buffer.byteLength) throw new ImportError('E-IMP-02', 'GLB truncated');
  let offset = 12, json = null, bin = null;
  while (offset + 8 <= length) {
    const chunkLen = dv.getUint32(offset, true), type = dv.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + chunkLen > length) throw new ImportError('E-IMP-02', 'chunk exceeds file');
    if (type === CHUNK_JSON) json = new TextDecoder().decode(new Uint8Array(buffer, start, chunkLen));
    else if (type === CHUNK_BIN && !bin) bin = new Uint8Array(buffer, start, chunkLen);
    offset = start + chunkLen;
  }
  if (!json) throw new ImportError('E-IMP-02', 'no JSON chunk');
  let gltf;
  try { gltf = JSON.parse(json); } catch { throw new ImportError('E-IMP-02', 'bad JSON'); }
  return readGltf(gltf, bin);
}

/**
 * Parses a self-contained .gltf JSON (buffers as data: URIs).
 * @param {string} text
 */
export function parseGLTFJson(text) {
  let gltf;
  try { gltf = JSON.parse(text); } catch { throw new ImportError('E-IMP-02', 'bad JSON'); }
  if (!gltf.asset) throw new ImportError('E-IMP-01');
  return readGltf(gltf, null);
}

function decodeDataUri(uri) {
  const m = /^data:[^;,]*(;base64)?,(.*)$/s.exec(uri || '');
  if (!m) throw new ImportError('E-IMP-02', 'external buffer URIs are not supported');
  if (!m[1]) return new TextEncoder().encode(decodeURIComponent(m[2]));
  const bin = atob(m[2]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function readGltf(gltf, glbBin) {
  const required = gltf.extensionsRequired || [];
  if (required.some((e) => UNSUPPORTED_EXT.includes(e))) throw new ImportError('E-IMP-04', required.join(','));
  const buffers = (gltf.buffers || []).map((b, i) => {
    if (b.uri === undefined) {
      if (i !== 0 || !glbBin) throw new ImportError('E-IMP-02', 'missing binary chunk');
      return glbBin;
    }
    return decodeDataUri(b.uri);
  });
  const ctx = { gltf, buffers };
  const parts = [], pointParts = [];
  let texture = null;
  const visit = (nodeIdx, parent) => {
    const node = gltf.nodes?.[nodeIdx];
    if (!node) throw new ImportError('E-IMP-02', 'bad node index');
    const local = node.matrix ? node.matrix.slice() : fromTRS(node.translation, node.rotation, node.scale);
    const world = multiply(parent, local);
    if (node.mesh !== undefined) {
      const mesh = gltf.meshes?.[node.mesh];
      if (!mesh) throw new ImportError('E-IMP-02', 'bad mesh index');
      for (const prim of mesh.primitives || []) {
        const part = readPrimitive(ctx, prim, world);
        if (!part) continue;
        if (part.indices) {
          if (!texture && part.uvs) texture = readBaseColorTexture(ctx, prim.material);
          parts.push(part);
        } else pointParts.push(part);
      }
    }
    for (const c of node.children || []) visit(c, world);
  };
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  const roots = scene ? scene.nodes || [] : (gltf.nodes || []).map((_, i) => i);
  for (const r of roots) visit(r, identity());
  const extras = gltf.asset?.extras || null;
  if (parts.length) {
    const mesh = mergeMeshes(parts);
    if (!texture) delete mesh.uvs;
    else mesh.texture = texture;
    return { mesh, extras, kind: 'mesh' };
  }
  if (pointParts.length) return { mesh: mergeMeshes(pointParts), extras, kind: 'points' };
  throw new ImportError('E-IMP-07');
}

function readAccessor(ctx, index, { normalizedToFloat = false } = {}) {
  const acc = ctx.gltf.accessors?.[index];
  if (!acc) throw new ImportError('E-IMP-02', 'bad accessor');
  const ncomp = COMPONENTS[acc.type];
  const Type = TYPED[acc.componentType];
  if (!ncomp || !Type) throw new ImportError('E-IMP-02', 'unsupported accessor type');
  const count = acc.count;
  const out = new (normalizedToFloat || acc.componentType === 5126 ? Float32Array : Type)(count * ncomp);
  if (acc.bufferView === undefined) return { data: out, ncomp }; // all zeros (sparse not supported)
  const bv = ctx.gltf.bufferViews?.[acc.bufferView];
  const buf = bv && ctx.buffers[bv.buffer];
  if (!buf) throw new ImportError('E-IMP-02', 'bad buffer view');
  const elemBytes = Type.BYTES_PER_ELEMENT;
  const stride = bv.byteStride || ncomp * elemBytes;
  const base = buf.byteOffset + (bv.byteOffset || 0) + (acc.byteOffset || 0);
  if ((bv.byteOffset || 0) + (acc.byteOffset || 0) + stride * (count - 1) + ncomp * elemBytes > buf.byteLength) {
    throw new ImportError('E-IMP-02', 'accessor out of range');
  }
  const dv = new DataView(buf.buffer);
  const get = {
    5120: (o) => dv.getInt8(o), 5121: (o) => dv.getUint8(o), 5122: (o) => dv.getInt16(o, true),
    5123: (o) => dv.getUint16(o, true), 5125: (o) => dv.getUint32(o, true), 5126: (o) => dv.getFloat32(o, true),
  }[acc.componentType];
  const div = acc.normalized || normalizedToFloat ? NORM_DIV[acc.componentType] || 1 : 1;
  for (let i = 0; i < count; i++) {
    const o = base + i * stride;
    for (let k = 0; k < ncomp; k++) out[i * ncomp + k] = get(o + k * elemBytes) / div;
  }
  return { data: out, ncomp };
}

function readPrimitive(ctx, prim, world) {
  const mode = prim.mode ?? 4;
  if (prim.attributes?.POSITION === undefined) return null;
  if (![0, 4, 5, 6].includes(mode)) return null; // lines are ignored
  const pos = readAccessor(ctx, prim.attributes.POSITION).data;
  const nv = pos.length / 3;
  const positions = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
    positions[3 * i] = world[0] * x + world[4] * y + world[8] * z + world[12];
    positions[3 * i + 1] = world[1] * x + world[5] * y + world[9] * z + world[13];
    positions[3 * i + 2] = world[2] * x + world[6] * y + world[10] * z + world[14];
  }
  let colors;
  if (prim.attributes.COLOR_0 !== undefined) {
    const { data, ncomp } = readAccessor(ctx, prim.attributes.COLOR_0, { normalizedToFloat: true });
    colors = new Uint8Array(nv * 3);
    for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) colors[3 * i + k] = Math.round(Math.min(1, Math.max(0, linearToSrgb(data[i * ncomp + k]))) * 255);
  }
  const uvs = prim.attributes.TEXCOORD_0 !== undefined
    ? Float32Array.from(readAccessor(ctx, prim.attributes.TEXCOORD_0, { normalizedToFloat: true }).data) : undefined;
  if (mode === 0) return { positions, indices: null, colors };
  let idx = prim.indices !== undefined ? readAccessor(ctx, prim.indices).data : Uint32Array.from({ length: nv }, (_, i) => i);
  for (let i = 0; i < idx.length; i++) if (idx[i] >= nv) throw new ImportError('E-IMP-02', 'index out of range');
  if (mode === 5) idx = stripToList(idx);
  else if (mode === 6) idx = fanToList(idx);
  const indices = Uint32Array.from(idx.slice(0, idx.length - (idx.length % 3)));
  // Negative determinant flips winding.
  if (det3(world) < 0) for (let i = 0; i < indices.length; i += 3) { const t = indices[i + 1]; indices[i + 1] = indices[i + 2]; indices[i + 2] = t; }
  return { positions, indices, colors, uvs };
}

function det3(m) {
  return m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
}

function stripToList(idx) {
  const out = [];
  for (let i = 0; i + 2 < idx.length; i++) {
    if (i % 2 === 0) out.push(idx[i], idx[i + 1], idx[i + 2]);
    else out.push(idx[i + 1], idx[i], idx[i + 2]);
  }
  return out;
}

function fanToList(idx) {
  const out = [];
  for (let i = 1; i + 1 < idx.length; i++) out.push(idx[0], idx[i], idx[i + 1]);
  return out;
}

/** glTF vertex colours are linear; convert to sRGB bytes for display. */
function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function readBaseColorTexture(ctx, materialIdx) {
  const mat = ctx.gltf.materials?.[materialIdx];
  const texIdx = mat?.pbrMetallicRoughness?.baseColorTexture?.index;
  const tex = texIdx !== undefined ? ctx.gltf.textures?.[texIdx] : null;
  const img = tex && ctx.gltf.images?.[tex.source];
  if (!img) return null;
  try {
    if (img.bufferView !== undefined) {
      const bv = ctx.gltf.bufferViews[img.bufferView];
      const buf = ctx.buffers[bv.buffer];
      return { bytes: buf.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength), mimeType: img.mimeType || 'image/jpeg' };
    }
    if (img.uri?.startsWith('data:')) {
      return { bytes: decodeDataUri(img.uri), mimeType: /^data:([^;,]+)/.exec(img.uri)?.[1] || 'image/jpeg' };
    }
  } catch { /* texture is optional: fall back to grey */ }
  return null;
}
