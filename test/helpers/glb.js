/**
 * Minimal GLB writer for test fixtures (independent of the app's exporter).
 */

/**
 * @param {Array<{positions:Float32Array, indices:Uint32Array, translation?:number[], scale?:number[]}>} parts
 * @param {{extensionsRequired?:string[], extras?:object}} [opts]
 * @returns {ArrayBuffer}
 */
export function makeGlb(parts, opts = {}) {
  const bins = [];
  let offset = 0;
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [] };
  if (opts.extensionsRequired) { json.extensionsRequired = opts.extensionsRequired; json.extensionsUsed = opts.extensionsRequired; }
  if (opts.extras) json.asset.extras = opts.extras;
  const addView = (arr, target) => {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (bytes.length % 4)) % 4;
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    bins.push(bytes, new Uint8Array(pad));
    offset += bytes.length + pad;
    return json.bufferViews.length - 1;
  };
  parts.forEach((m, k) => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.positions.length; i++) { min[i % 3] = Math.min(min[i % 3], m.positions[i]); max[i % 3] = Math.max(max[i % 3], m.positions[i]); }
    const pv = addView(m.positions, 34962), iv = addView(m.indices, 34963);
    json.accessors.push({ bufferView: pv, componentType: 5126, count: m.positions.length / 3, type: 'VEC3', min, max });
    json.accessors.push({ bufferView: iv, componentType: 5125, count: m.indices.length, type: 'SCALAR' });
    json.meshes.push({ primitives: [{ attributes: { POSITION: 2 * k }, indices: 2 * k + 1 }] });
    const node = { mesh: k };
    if (m.translation) node.translation = m.translation;
    if (m.scale) node.scale = m.scale;
    json.nodes.push(node);
    json.scenes[0].nodes.push(k);
  });
  json.buffers.push({ byteLength: offset });
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (jsonBytes.length % 4)) % 4;
  const jb = new Uint8Array(jsonBytes.length + jpad).fill(0x20);
  jb.set(jsonBytes);
  jsonBytes = jb;
  const total = 12 + 8 + jsonBytes.length + 8 + offset;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  let o = 20 + jsonBytes.length;
  dv.setUint32(o, offset, true); dv.setUint32(o + 4, 0x004e4942, true);
  o += 8;
  for (const b of bins) { out.set(b, o); o += b.length; }
  return out.buffer;
}
