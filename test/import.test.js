import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importScan } from '../src/core/import.js';
import { computeBBox } from '../src/core/mesh.js';
import { MAX_FILE_BYTES, WARN_FILE_BYTES, MAX_TRIANGLES, checkFileSize } from '../src/core/errors.js';
import { box } from './helpers/meshes.js';
import { makeGlb } from './helpers/glb.js';
import { readFileSync, readdirSync } from 'node:fs';

const enc = (s) => new TextEncoder().encode(s).buffer;
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };

test('glb box roundtrip', () => {
  const glb = makeGlb([{ ...box(4, 3, 2.5), translation: [1, 0, 2], scale: [1, 1, 1] }]);
  const r = importScan(glb);
  assert.equal(r.format, 'glb');
  assert.equal(r.mesh.indices.length / 3, 12);
  const bb = computeBBox(r.mesh.positions);
  [1, 0, 2].forEach((v, k) => near(bb.min[k], v, 1e-6, 'min'));
  [5, 2.5, 5].forEach((v, k) => near(bb.max[k], v, 1e-6, 'max'));
});

test('glb two nodes', () => {
  const r = importScan(makeGlb([box(1, 1, 1), { ...box(2, 2, 2), translation: [5, 0, 0] }]));
  assert.equal(r.mesh.indices.length / 3, 24);
  assert.equal(computeBBox(r.mesh.positions).max[0], 7);
});

test('draco required', () => {
  assert.equal(code(() => importScan(makeGlb([box(1, 1, 1)], { extensionsRequired: ['KHR_draco_mesh_compression'] }))), 'E-IMP-04');
  assert.equal(code(() => importScan(makeGlb([box(1, 1, 1)], { extensionsRequired: ['EXT_meshopt_compression'] }))), 'E-IMP-04');
});

test('obj quad and negative indices', () => {
  const r = importScan(enc('# quad\nv 0 0 0\nv 1 0 0\nv 1 0 1\nv 0 0 1\nf -4 -3 -2 -1\n'));
  assert.equal(r.format, 'obj');
  assert.equal(r.mesh.indices.length / 3, 2);
  assert.deepEqual([...r.mesh.indices], [0, 1, 2, 0, 2, 3]);
  assert.deepEqual([...r.mesh.positions.slice(6, 9)], [1, 0, 1]);
});

test('obj groups merged', () => {
  const txt = ['mtllib a.mtl', 'o a', 'v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'usemtl x', 'f 1/1/1 2/2/2 3/3/3',
    'o b', 'v 0 0 1', 'v 1 0 1', 'v 0 1 1', 'f 4 5 6', 'g c', 'v 0 0 2', 'v 1 0 2', 'v 0 1 2', 'f -3 -2 -1'].join('\r\n');
  const r = importScan(enc(txt));
  assert.equal(r.mesh.indices.length / 3, 3);
  assert.equal(computeBBox(r.mesh.positions).max[2], 2);
});

const plyHeader = (nv, nf, extra = '', fmt = 'ascii') => `ply\nformat ${fmt} 1.0\nelement vertex ${nv}\nproperty float x\nproperty float y\nproperty float z\n${extra}${nf ? `element face ${nf}\nproperty list uchar int vertex_indices\n` : ''}end_header\n`;

test('ply mesh', () => {
  const ascii = importScan(enc(`${plyHeader(4, 1)}0 0 0\n1 0 0\n1 1 0\n0 1 0\n4 0 1 2 3\n`));
  assert.equal(ascii.kind, 'mesh');
  assert.equal(ascii.mesh.indices.length / 3, 2);
  // binary little endian, 3 vertices, 1 triangle
  const head = new TextEncoder().encode(plyHeader(3, 1, '', 'binary_little_endian'));
  const body = new ArrayBuffer(3 * 12 + 1 + 12);
  const dv = new DataView(body);
  [[0, 0, 0], [2, 0, 0], [0, 3, 0]].forEach((v, i) => v.forEach((c, k) => dv.setFloat32(i * 12 + k * 4, c, true)));
  dv.setUint8(36, 3); [0, 1, 2].forEach((v, k) => dv.setInt32(37 + k * 4, v, true));
  const buf = new Uint8Array(head.length + body.byteLength);
  buf.set(head); buf.set(new Uint8Array(body), head.length);
  const bin = importScan(buf.buffer);
  assert.equal(bin.mesh.indices.length, 3);
  assert.equal(computeBBox(bin.mesh.positions).max[1], 3);
});

test('ply points', () => {
  const r = importScan(enc(`${plyHeader(3, 0, 'property uchar red\nproperty uchar green\nproperty uchar blue\n')}0 0 0 255 0 0\n1 0 0 0 255 0\n0 1 0 0 0 255\n`));
  assert.equal(r.kind, 'points');
  assert.equal(r.mesh.indices, null);
  assert.equal(r.mesh.positions.length, 9);
  assert.deepEqual([...r.mesh.colors.slice(0, 3)], [255, 0, 0]);
});

test('ply splat rejected', () => {
  const splat = `${plyHeader(1, 0, 'property float f_dc_0\nproperty float opacity\nproperty float scale_0\nproperty float rot_0\n')}0 0 0 0.1 0.5 0.01 1\n`;
  assert.equal(code(() => importScan(enc(splat))), 'E-IMP-03');
});

test('error codes', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).buffer;
  assert.equal(code(() => importScan(png)), 'E-IMP-01');
  assert.equal(code(() => importScan(new ArrayBuffer(0))), 'E-IMP-07');
  const glb = makeGlb([box(1, 1, 1)]);
  assert.equal(code(() => importScan(glb.slice(0, glb.byteLength - 40))), 'E-IMP-02');
  assert.equal(code(() => importScan(makeGlb([box(1, 1, 1)], { extensionsRequired: ['KHR_draco_mesh_compression'] }))), 'E-IMP-04');
  assert.equal(code(() => checkFileSize(MAX_FILE_BYTES + 1)), 'E-IMP-06');
  assert.equal(checkFileSize(WARN_FILE_BYTES + 1), true);
  assert.equal(checkFileSize(1000), false);
  // constants as specified
  assert.equal(MAX_FILE_BYTES, 300 * 1024 * 1024);
  assert.equal(WARN_FILE_BYTES, 100 * 1024 * 1024);
  assert.equal(MAX_TRIANGLES, 5_000_000);
  // file input must not restrict types (iOS greys out unknown extensions)
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const appSrc = readdirSync(new URL('../src/app/', import.meta.url)).map((f) => readFileSync(new URL(`../src/app/${f}`, import.meta.url), 'utf8')).join('\n');
  assert.ok(!/accept=["']?\.glb/.test(html + appSrc));
});

test('xyz points', () => {
  const r = importScan(enc('0 0 0\n1.5 2 3 255 0 0\n# comment\n4,5,6\n'));
  assert.equal(r.format, 'xyz');
  assert.equal(r.kind, 'points');
  assert.equal(r.mesh.positions.length, 9);
});

test('gltf json with embedded buffer', () => {
  const glb = new Uint8Array(makeGlb([box(1, 2, 3)]));
  const dv = new DataView(glb.buffer);
  const jlen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jlen)));
  const bin = glb.subarray(20 + jlen + 8);
  json.buffers[0].uri = `data:application/octet-stream;base64,${Buffer.from(bin).toString('base64')}`;
  const r = importScan(enc(JSON.stringify(json)));
  assert.equal(r.format, 'gltf');
  assert.equal(r.mesh.indices.length / 3, 12);
});

test('parsers agree with three.js loaders', async () => {
  const { OBJLoader } = await import('../vendor/three/addons/loaders/OBJLoader.js');
  const { PLYLoader } = await import('../vendor/three/addons/loaders/PLYLoader.js');
  const objText = 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n';
  const group = new OBJLoader().parse(objText);
  const ref = group.children[0].geometry.attributes.position.array;
  const ours = importScan(enc(objText)).mesh;
  const expanded = [...ours.indices].flatMap((i) => [...ours.positions.slice(3 * i, 3 * i + 3)]);
  assert.deepEqual(expanded, [...ref]);
  const plyText = `${plyHeader(3, 1)}0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n`;
  const geo = new PLYLoader().parse(enc(plyText));
  assert.deepEqual([...geo.attributes.position.array], [...importScan(enc(plyText)).mesh.positions]);
});
