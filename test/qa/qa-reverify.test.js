/**
 * QA re-verification (round 2): adversarial tests against the coder's fixes for the BLOCKER and
 * MAJOR defects DEF-01…DEF-05. `todo` tests document residual limitations found in round 2.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import DxfParser from 'dxf-parser';
import '../helpers/filereader-shim.js';
import { openDb } from '../../src/store/idb.js';
import { saveProject, getProject } from '../../src/store/project.js';
import { projectFromBackup } from '../../src/store/backup.js';
import { exportGlb, backupExtras } from '../../src/export/glb.js';
import { importScan } from '../../src/core/import.js';
import { Session } from '../../src/app/session.js';
import { calibrationText } from '../../src/core/measure.js';
import { computeBBox, transformPositions } from '../../src/core/mesh.js';
import { chooseUpAxis, levelFloor, autoOrient } from '../../src/core/orient.js';
import { slicePolylines, planFrame } from '../../src/core/slice.js';
import { polylineLength } from '../../src/core/polyline.js';
import { buildPlanDrawing } from '../../src/core/drawing.js';
import { drawingToDxf } from '../../src/export/dxf.js';
import { heightMap, excavation } from '../../src/core/terrain.js';
import { box, Builder, transformMesh, rot, mulberry32, plane } from '../helpers/meshes.js';
import { room, yUpToZUp, toObj, enc, near } from './qa-helpers.js';

// ---------------------------------------------------------------- DEF-01

/** Full UI-equivalent cycle: session state → backup GLB (world mesh) → restore → saved project. */
async function backupAndRestore(db, session, rawMesh) {
  await session.save();
  const stored = await getProject(db, session.project.id);
  const world = { ...rawMesh, positions: transformPositions(rawMesh.positions, stored.transform) };
  const p = { ...session.project, annotations: session.annotations, settings: session.settings, calibration: session.edit.state.calibration, scale: session.scale };
  const glb = await exportGlb(world, { extras: backupExtras(p) });
  const imp = importScan(glb);
  const restored = projectFromBackup(imp.extras.scan2plan, new Blob([glb]), 'x.s2p.glb', imp.format);
  await saveProject(db, restored);
  const { sourceFile, ...meta } = restored;
  return { session: new Session({ db, client: { call: async () => true }, project: meta, load: { kind: 'mesh' } }), mesh: imp.mesh };
}

test('DEF-01 r2: calibrate → backup → restore → recalibrate → backup → restore → reopen keeps the true size', async () => {
  const db = await openDb(new IDBFactory());
  const raw = box(4, 3, 2.5);
  const p0 = { id: 'p0', name: 'Chain', createdAt: '2026-11-15T10:00:00Z', sourceName: 'c.glb', annotations: [], settings: {}, calibration: null, orientation: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
  await saveProject(db, { ...p0, sourceFile: new Blob([new Uint8Array(1)]) });
  let s = new Session({ db, client: { call: async () => true }, project: p0, load: { kind: 'mesh' } });
  s.edit.add({ id: 'm', type: 'measure', view: 'plan', a: [4, 0], b: [4, -3] });
  s.setCalibration({ factor: 1.02, refCm: 100 });
  near(assert, s.annotations[0].a[0], 4.08, 1e-9, 'markup follows the first calibration');
  let r = await backupAndRestore(db, s, raw);
  s = r.session;
  near(assert, s.transform[0], 1, 1e-12, 'restored transform carries no scale');
  // recalibrate the restored project (the user measures again: reference shows 1 % too short)
  s.setCalibration({ factor: s.scale * 1.01, refCm: 50 });
  assert.equal(s.edit.state.calibration.baked, 1.02);
  near(assert, s.annotations[0].a[0], 4.08 * 1.01, 1e-9, 'markup follows the recalibration');
  r = await backupAndRestore(db, s, r.mesh);
  s = r.session;
  await s.save();
  const reopened = await getProject(db, s.project.id);
  near(assert, reopened.transform[0], 1, 1e-12, 'second restore: nothing applied twice');
  const bb = computeBBox(transformPositions(r.mesh.positions, reopened.transform));
  near(assert, bb.max[0] - bb.min[0], 4 * 1.02 * 1.01, 1e-4, 'mesh size = original × both calibrations');
  near(assert, s.edit.state.calibration.baked, 1.02 * 1.01, 1e-12, 'baked accumulates');
  assert.equal(calibrationText(s.edit.state.calibration), 'Scale calibrated ×1.0302 on 50.0 cm reference');
  near(assert, s.annotations[0].a[0], 4.08 * 1.01, 1e-9, 'markup still on the wall after two restores');
});

test('DEF-01 r2: undo of a recalibration restores markup and scale together; Reset keeps baked info', async () => {
  const db = await openDb(new IDBFactory());
  const p = { id: 'u', name: 'U', annotations: [{ id: 'd', type: 'demolition', a: [2, 0], b: [2, -3], thickness: 0.24, side: 1, height: 2.5 }], settings: {}, calibration: { factor: 1, refCm: 100, baked: 1.03 }, orientation: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
  const s = new Session({ db, client: { call: async () => true }, project: p, load: { kind: 'mesh' } });
  s.setCalibration({ factor: 0.98, refCm: 200 });
  near(assert, s.annotations[0].height, 2.5 * 0.98, 1e-12, 'scanned height scales');
  assert.equal(s.annotations[0].thickness, 0.24, 'entered thickness does not');
  s.edit.undo();
  assert.deepEqual(s.annotations[0].a, [2, 0]);
  assert.deepEqual(s.edit.state.calibration, { factor: 1, refCm: 100, baked: 1.03 });
  s.setCalibration(null);
  assert.equal(s.edit.state.calibration.baked, 1.03);
  assert.equal(s.scale, 1);
});

// ---------------------------------------------------------------- DEF-03

const SIDES = []; for (let v = 1.0; v <= 6.0001; v += 0.1) SIDES.push(Math.round(v * 10) / 10);
function sweep(heights, make, expected) {
  let n = 0, wrong = 0;
  for (const H of heights) for (const w of SIDES) for (const d of SIDES) {
    if (d > w) continue;
    const m = make(w, d, H);
    n++;
    if (chooseUpAxis(m.positions, m.indices).join() !== expected.join()) wrong++;
  }
  return { n, wrong, pct: (100 * wrong) / n };
}

test('DEF-03 r2: Y-up OBJ rooms with German standard ceiling heights 2.40–2.80 m never tip over (6630 sizes)', () => {
  const r = sweep([2.4, 2.5, 2.6, 2.7, 2.8], (w, d, H) => room(w, d, H), [0, 1, 0]);
  console.log(`# typical 2.40–2.80 m: ${r.wrong}/${r.n} wrong`);
  assert.equal(r.wrong, 0);
});

test('DEF-03 r2: declared tall-room limitation, quantified (informative, Altbau 3.0/3.2/3.5 m)', () => {
  const out = [3.0, 3.2, 3.5].map((H) => [H, sweep([H], (w, d) => room(w, d, H), [0, 1, 0])]);
  for (const [H, r] of out) console.log(`# Altbau H=${H} m: ${r.wrong}/${r.n} room sizes (1–6 m sides) turned sideways = ${r.pct.toFixed(1)} %`);
  // guard the documented envelope so a later change cannot silently widen it
  assert.ok(out[0][1].pct < 12 && out[1][1].pct < 26 && out[2][1].pct < 45);
});

test('DEF-03 r2: Z-up OBJ with a horizontal side near 2.5 m is levelled', { todo: 'DEF-20: +Y kept (silently, no hint) when the Y side is a plausible storey height' }, () => {
  const r = sweep([2.4, 2.6, 2.8], (w, d, H) => yUpToZUp(room(w, d, H)), [0, 0, 1]);
  console.log(`# Z-up rooms: ${r.wrong}/${r.n} stay sideways (${r.pct.toFixed(1)} %)`);
  assert.equal(r.wrong, 0);
});

test('DEF-03 r2: Y-up facade OBJ (6 m tall, 3 m ground strip) stays upright', { todo: 'DEF-20: ground-strip depth 2.5–3 m is a "more typical storey height" than 6 m' }, () => {
  const b = new Builder(true);
  b.grid([0, 0, 0], [10, 0, 0], [10, 6, 0], [0, 6, 0], 10, 6);
  b.grid([0, 0, 0], [0, 0, 3], [10, 0, 3], [10, 0, 0], 10, 3);
  const m = b.mesh();
  assert.deepEqual(chooseUpAxis(m.positions, m.indices), [0, 1, 0]);
});

test('DEF-03 r2: floor visible on ≥ 40 % is not flipped; ≤ 30 % flips (documented 3× rule)', () => {
  assert.deepEqual(chooseUpAxis(room(4, 3, 2.5, { floorFraction: 0.4 }).positions, room(4, 3, 2.5, { floorFraction: 0.4 }).indices), [0, 1, 0]);
  const m = room(4, 3, 2.5, { floorFraction: 0.3 });
  assert.deepEqual(chooseUpAxis(m.positions, m.indices), [0, -1, 0], 'flips; the import hint is shown for −Y');
});

// ---------------------------------------------------------------- DEF-04

/** Room 5×4×2.5 (inward normals); `cover` = fraction of the floor (along X) covered by a flat top at `hf`. */
function furnished({ cover = 0, hf = 0.45, slopeDeg = 0, noise = 0 }) {
  const b = new Builder(false), W = 5, D = 4, H = 2.5, n = 25;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const y = (i + 0.5) / n < cover ? hf : 0;
    b.quad([i * W / n, y, j * D / n], [i * W / n, y, (j + 1) * D / n], [(i + 1) * W / n, y, (j + 1) * D / n], [(i + 1) * W / n, y, j * D / n]);
  }
  b.quad([0, H, 0], [W, H, 0], [W, H, D], [0, H, D]);
  b.grid([0, 0, 0], [W, 0, 0], [W, H, 0], [0, H, 0], 10, 5);
  b.grid([0, 0, D], [0, H, D], [W, H, D], [W, 0, D], 10, 5);
  let m = b.mesh();
  if (noise) { const r = mulberry32(7); m = { ...m, positions: m.positions.map((v) => v + (r() * 2 - 1) * noise) }; }
  if (slopeDeg) m = transformMesh(m, rot([0, 0, 1], slopeDeg));
  return m;
}

for (const c of [{ cover: 0.4 }, { cover: 0.4, noise: 0.008 }, { cover: 0.3, hf: 0.75 }, { slopeDeg: 3 }, { slopeDeg: 4.5, cover: 0.3 }, { slopeDeg: 2, noise: 0.008, cover: 0.4 }]) {
  test(`DEF-04 r2: floor levelled correctly with ${JSON.stringify(c)}`, () => {
    const m = furnished(c);
    const lv = levelFloor(m.positions, m.indices);
    near(assert, lv.tiltDeg, c.slopeDeg || 0, 0.05, 'tilt');
    near(assert, lv.floorY, 0, 0.01, 'floor level');
  });
}

test('DEF-04 r2: a flat low object (2 cm rug / 4 cm platform on 40 % of the floor) does not tilt the floor', { todo: 'DEF-21: low flat objects within the ±5 cm / 2 cm inlier bands are fitted as slope' }, () => {
  for (const hf of [0.02, 0.04]) {
    const lv = levelFloor(furnished({ cover: 0.4, hf }).positions, furnished({ cover: 0.4, hf }).indices);
    assert.ok(lv.tiltDeg < 0.05, `hf=${hf}: tilt ${lv.tiltDeg.toFixed(2)}°`);
  }
});

test('DEF-04 r2: furniture tops covering > 50 % of the floor at one height are not taken as the floor', { todo: 'DEF-21: the height mode picks the furniture top' }, () => {
  const lv = levelFloor(furnished({ cover: 0.55 }).positions, furnished({ cover: 0.55 }).indices);
  near(assert, lv.floorY, 0, 0.01, 'floor level');
});

// ---------------------------------------------------------------- DEF-05

const UTM = [32500123.45, 312.7, 5500456.78];

test('DEF-05 r2: georeferenced OBJ → plan → DXF in the shifted local frame, true lengths, small coordinates', () => {
  const r = importScan(enc(toObj(box(4.13, 3.07, 2.5), UTM)));
  assert.deepEqual(r.origin, [Math.round(UTM[0] + 2.065), 0, Math.round(UTM[2] + 1.535)]);
  const o = autoOrient(r.mesh.positions, r.mesh.indices, { format: 'obj' });
  const outline = slicePolylines({ positions: transformPositions(r.mesh.positions, o.matrix), indices: r.mesh.indices }, planFrame(1));
  near(assert, polylineLength(outline[0]), 14.4, 0.005, 'perimeter');
  const dxf = new DxfParser().parseSync(drawingToDxf(buildPlanDrawing({ h: 1, outline, walls: [], openings: [] }, [])));
  const poly = dxf.entities.find((e) => e.type === 'POLYLINE' && e.layer === 'S2P_EXISTING');
  const xs = poly.vertices.map((v) => v.x), ys = poly.vertices.map((v) => v.y);
  near(assert, Math.max(...xs) - Math.min(...xs), 4.13, 1e-3, 'DXF width');
  near(assert, Math.max(...ys) - Math.min(...ys), 3.07, 1e-3, 'DXF depth');
  assert.ok(Math.max(...xs.map(Math.abs), ...ys.map(Math.abs)) < 100, 'local coordinates (origin not in DXF)');
});

test('DEF-05 r2: binary PLY with float64 UTM coordinates, re-import gives the same origin (reopen determinism)', () => {
  const m = box(4.13, 3.07, 2.5);
  const nv = m.positions.length / 3, nf = m.indices.length / 3;
  const head = new TextEncoder().encode(`ply\nformat binary_little_endian 1.0\nelement vertex ${nv}\nproperty double x\nproperty double y\nproperty double z\nelement face ${nf}\nproperty list uchar int vertex_indices\nend_header\n`);
  const body = new DataView(new ArrayBuffer(nv * 24 + nf * 13));
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) body.setFloat64(i * 24 + k * 8, m.positions[3 * i + k] + UTM[k], true);
  for (let f = 0; f < nf; f++) { body.setUint8(nv * 24 + f * 13, 3); for (let k = 0; k < 3; k++) body.setInt32(nv * 24 + f * 13 + 1 + 4 * k, m.indices[3 * f + k], true); }
  const buf = new Uint8Array(head.length + body.byteLength); buf.set(head); buf.set(new Uint8Array(body.buffer), head.length);
  const a = importScan(buf.slice().buffer), b = importScan(buf.slice().buffer);
  assert.deepEqual(a.origin, b.origin);
  const bb = computeBBox(a.mesh.positions);
  near(assert, bb.max[0] - bb.min[0], 4.13, 1e-3, 'X');
  near(assert, bb.max[2] - bb.min[2], 3.07, 1e-3, 'Z');
});

test('DEF-05 r2: georeferenced terrain (UTM + NN height) gives the analytic excavation volume', () => {
  const t = plane(10, 100, (x) => 0.1 * x);
  const r = importScan(enc(toObj(t, [UTM[0], 0, UTM[2]], 5)));
  const o = autoOrient(r.mesh.positions, r.mesh.indices, { format: 'obj' });
  const w = transformPositions(r.mesh.positions, o.matrix);
  const hm = heightMap({ positions: w, indices: r.mesh.indices }, 0.05);
  const bb = computeBBox(w);
  // polygon = central 4×5 m rectangle of the shifted terrain
  const cx = (bb.min[0] + bb.max[0]) / 2, cy = -(bb.min[2] + bb.max[2]) / 2;
  const poly = [cx - 2, cy + 2.5, cx + 2, cy + 2.5, cx + 2, cy - 2.5, cx - 2, cy - 2.5];
  const ex = excavation(hm, poly, { mode: 'depth', depth: 0.3 });
  near(assert, ex.cut, 6, 0.05, 'cut');
  near(assert, ex.coverage, 1, 0.01, 'coverage');
});
