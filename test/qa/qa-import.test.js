/**
 * QA adversarial import tests (REQ-001…REQ-005). Tests marked `todo` document a confirmed
 * defect (see docs/QA_REPORT.md); they assert the CORRECT behaviour and are expected to fail
 * until the defect is fixed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importScan, detectFormat } from '../../src/core/import.js';
import { computeBBox, transformPositions } from '../../src/core/mesh.js';
import { autoOrient, suggestUnitScale } from '../../src/core/orient.js';
import { slicePolylines, planFrame } from '../../src/core/slice.js';
import { polylineLength } from '../../src/core/polyline.js';
import { box } from '../helpers/meshes.js';
import { makeGlb } from '../helpers/glb.js';
import { enc, codeOf, toObj, near } from './qa-helpers.js';

const SPLAT_PROPS = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2',
  ...Array.from({ length: 45 }, (_, i) => `f_rest_${i}`), 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];

function binaryPly(props, nVertices, elementsBefore = '') {
  const head = `ply\nformat binary_little_endian 1.0\n${elementsBefore}element vertex ${nVertices}\n${props.map((p) => `property float ${p}`).join('\n')}\nend_header\n`;
  const h = new TextEncoder().encode(head);
  const out = new Uint8Array(h.length + nVertices * props.length * 4);
  out.set(h);
  return out.buffer;
}

test('QA empty and whitespace-only files → E-IMP-07', () => {
  assert.equal(codeOf(() => importScan(new ArrayBuffer(0))), 'E-IMP-07');
  assert.equal(codeOf(() => importScan(enc('   \n\n\t \n'))), 'E-IMP-07');
});

test('QA real Scaniverse/3DGS splat PLY layout (binary, 62 props) → E-IMP-03', () => {
  assert.equal(codeOf(() => importScan(binaryPly(SPLAT_PROPS, 10))), 'E-IMP-03');
});

test('QA compressed splat PLY (SuperSplat "packed_*" layout) → E-IMP-03', () => {
  const buf = binaryPly(['packed_position', 'packed_rotation', 'packed_scale', 'packed_color'], 4,
    'element chunk 1\nproperty float min_x\nproperty float min_y\nproperty float min_z\nproperty float max_x\nproperty float max_y\nproperty float max_z\n');
  assert.equal(codeOf(() => importScan(buf)), 'E-IMP-03');
});

test('QA other scanner formats are rejected cleanly (USDZ, binary STL, ASCII STL, SPZ/gzip)', () => {
  const usdz = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0]).buffer;
  const gz = new Uint8Array([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 3]).buffer;
  const stlBin = new Uint8Array(84 + 50); stlBin.set(new TextEncoder().encode('binary stl header'), 0); stlBin[80] = 1;
  const stlAscii = enc('solid scan\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 1 0 0\n   vertex 0 1 0\n  endloop\n endfacet\nendsolid scan\n');
  for (const [name, b] of [['usdz', usdz], ['gz', gz], ['stl-bin', stlBin.buffer], ['stl-ascii', stlAscii]]) {
    assert.equal(codeOf(() => importScan(b)), 'E-IMP-01', name);
  }
});

test('QA truncated / corrupt inputs never throw raw errors', () => {
  const ply = enc('ply\nformat binary_little_endian 1.0\nelement vertex 100\nproperty float x\nproperty float y\nproperty float z\nend_header\n\x00\x00');
  assert.equal(codeOf(() => importScan(ply)), 'E-IMP-02');
  assert.equal(codeOf(() => importScan(enc('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 9\n'))), 'E-IMP-02');
  assert.equal(codeOf(() => importScan(enc('v nan 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'))), 'E-IMP-02');
  const glb = new Uint8Array(makeGlb([box(1, 1, 1)]));
  glb[20] = 0x7b; glb[21] = 0x7b; // break JSON
  assert.equal(codeOf(() => importScan(glb.buffer)), 'E-IMP-02');
  // GLB with valid JSON but no meshes
  const noMesh = { asset: { version: '2.0' }, scenes: [{ nodes: [0] }], nodes: [{}] };
  const j = new TextEncoder().encode(JSON.stringify(noMesh).padEnd(Math.ceil(JSON.stringify(noMesh).length / 4) * 4, ' '));
  const out = new Uint8Array(12 + 8 + j.length); const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, j.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(j, 20);
  assert.equal(codeOf(() => importScan(out.buffer)), 'E-IMP-07');
});

test('QA degenerate triangles (zero area, repeated indices) import without error', () => {
  const r = importScan(enc('v 0 0 0\nv 1 0 0\nv 2 0 0\nv 0 1 0\nf 1 2 3\nf 1 1 1\nf 1 2 4\n'));
  assert.equal(r.mesh.indices.length / 3, 3);
});

test('QA PLY with CRLF header and comments', () => {
  const r = importScan(enc('ply\r\nformat ascii 1.0\r\ncomment made by Scanner\r\nelement vertex 3\r\nproperty float x\r\nproperty float y\r\nproperty float z\r\nelement face 1\r\nproperty list uchar int vertex_indices\r\nend_header\r\n0 0 0\r\n1 0 0\r\n0 1 0\r\n3 0 1 2\r\n'));
  assert.equal(r.kind, 'mesh');
  assert.equal(r.mesh.indices.length, 3);
});

test('QA REQ-005 diagonal vs longest side: recompute the spec example', () => {
  // Spec text says "diagonal > 500 → mm". box(400,300,250): diagonal = √(400²+300²+250²) = 559.0
  const diag = Math.hypot(400, 300, 250);
  near(assert, diag, 559.017, 0.001, 'diagonal');
  // → the literal diagonal rule would suggest ×0.001, but the spec acceptance expects ×0.01.
  // The coder's longest-side rule satisfies all three acceptance cases:
  assert.equal(suggestUnitScale(computeBBox(box(4000, 3000, 2500).positions), 'obj').scale, 0.001);
  assert.equal(suggestUnitScale(computeBBox(box(400, 300, 250).positions), 'obj').scale, 0.01);
  assert.equal(suggestUnitScale(computeBBox(box(4, 3, 2.5).positions), 'obj').scale, null);
  // boundary behaviour of the longest-side rule: a 60 m terrain scan in metres as OBJ asks for cm.
  assert.equal(suggestUnitScale(computeBBox(box(60, 40, 3).positions), 'obj').scale, 0.01, 'expected (user can decline)');
});

test('QA georeferenced OBJ (UTM coordinates) keeps centimetre accuracy', () => {
  const m = box(4.13, 3.07, 2.5);
  const r = importScan(enc(toObj(m, [32500123.45, 100, 5500456.78])));
  const bb = computeBBox(r.mesh.positions);
  near(assert, bb.max[0] - bb.min[0], 4.13, 0.01, 'X extent');
  near(assert, bb.max[2] - bb.min[2], 3.07, 0.01, 'Z extent');
  const o = autoOrient(r.mesh.positions, r.mesh.indices, { format: 'obj' });
  const plan = slicePolylines({ positions: transformPositions(r.mesh.positions, o.matrix), indices: r.mesh.indices }, planFrame(1));
  near(assert, polylineLength(plan[0]), 14.4, 0.02, 'perimeter');
});

test('QA GLB with large node translation (georeferenced) keeps centimetre accuracy', () => {
  const r = importScan(makeGlb([{ ...box(4.13, 3.07, 2.5), translation: [500123.45, 0, 5500456.78], scale: [1, 1, 1] }]));
  const bb = computeBBox(r.mesh.positions);
  near(assert, bb.max[0] - bb.min[0], 4.13, 0.01, 'X extent');
  near(assert, bb.max[2] - bb.min[2], 3.07, 0.01, 'Z extent');
});

test('QA content sniffing beats extension; OBJ with long comment header', () => {
  assert.equal(detectFormat(new Uint8Array(enc('# exported\nmtllib a.mtl\nv 1 2 3\n'))), 'obj');
  const longHeader = `${'# comment line padding the header\n'.repeat(3000)}v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n`;
  assert.ok(longHeader.indexOf('v 0') > 65536, 'fixture: first vertex beyond 64 KB');
  assert.equal(codeOf(() => importScan(enc(longHeader))), null, 'OBJ with > 64 KB of comments before the first vertex should import');
});
