/**
 * QA tests through the REAL worker module (src/worker/geometry.worker.js, loaded in Node with a
 * `self` shim) and the real Session/store code: Node performance proxies for REQ-022/REQ-075 and
 * data-integrity scenarios for REQ-012/REQ-031.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import '../helpers/filereader-shim.js';
import { openDb } from '../../src/store/idb.js';
import { saveProject, getProject, newProject } from '../../src/store/project.js';
import { projectFromBackup } from '../../src/store/backup.js';
import { exportGlb, backupExtras } from '../../src/export/glb.js';
import { importScan } from '../../src/core/import.js';
import { Session } from '../../src/app/session.js';
import { identity } from '../../src/core/mat4.js';
import { polylineLength } from '../../src/core/polyline.js';
import { subdividedBox, box } from '../helpers/meshes.js';
import { makeGlb } from '../helpers/glb.js';
import { loadWorker, near } from './qa-helpers.js';

const call = await loadWorker();
const time = (fn) => { const t = performance.now(); const r = fn(); return [performance.now() - t, r]; };

test('QA perf: 300k-triangle GLB load + auto-orient through the worker (device budget 4 s)', () => {
  const glb = makeGlb([subdividedBox(10, 8, 2.5, 0.04)]);
  const [tLoad, load] = time(() => call('load', { buffer: glb, transform: null }));
  assert.ok(load.triangles >= 300_000, `${load.triangles} triangles`);
  const [tOrient, o] = time(() => call('autoOrient', { unitScale: 1 }));
  call('setTransform', { matrix: o.matrix });
  const total = tLoad + tOrient;
  console.log(`# 300k: load ${tLoad.toFixed(0)} ms + orient ${tOrient.toFixed(0)} ms = ${total.toFixed(0)} ms (Node)`);
  assert.ok(total < 4000, `${total.toFixed(0)} ms`);
});

test('QA perf: 1.2M-triangle import incl. display decimation through the worker (device budget 10 s)', () => {
  const glb = makeGlb([subdividedBox(10, 8, 2.5, 0.02)]);
  const [tLoad, load] = time(() => call('load', { buffer: glb, transform: null }));
  assert.ok(load.triangles > 1_000_000 && load.decimated);
  assert.ok(load.display.indices.length / 3 <= 500_000);
  const [tOrient] = time(() => call('autoOrient', { unitScale: 1 }));
  console.log(`# 1.2M: load+decimate ${tLoad.toFixed(0)} ms + orient ${tOrient.toFixed(0)} ms (Node)`);
  assert.ok(tLoad + tOrient < 10_000);
});

test('QA perf: plan update for ~1M triangles via the worker "plan" op (REQ-022: < 1.5 s)', () => {
  // The op slices 3–4 times (h, 1.00, 0.30, 0.05) plus wall/opening detection, so the coder's
  // single-slice perf test is not the real path; this measures the real path.
  call('load', { buffer: makeGlb([subdividedBox(10, 8, 2.5, 0.022)]), transform: identity() });
  call('plan', { h: 1.0, simplify: 0.01, snap: true, below: false }); // warm-up
  const runs = [];
  for (let i = 0; i < 3; i++) runs.push(time(() => call('plan', { h: 1.2, simplify: 0.01, snap: true, below: true }))[0]);
  const best = Math.min(...runs);
  console.log(`# worker plan op (1M tris, showBelow on): best of 3 = ${best.toFixed(0)} ms, runs ${runs.map((r) => r.toFixed(0)).join('/')}`);
  assert.ok(best < 1500, `${best.toFixed(0)} ms`);
});

test('QA worker: plan op on the loaded mesh returns the expected outline and dims input', () => {
  call('load', { buffer: makeGlb([box(4, 3, 2.5)]), transform: identity() });
  const p = call('plan', { h: 1.0, simplify: 0.01, snap: true, below: true });
  assert.equal(p.outline.length, 1);
  near(assert, polylineLength(p.outline[0]), 14, 0.005, 'perimeter');
  assert.ok(Array.isArray(p.below));
});

test('QA worker: excavation without terrain gives a user-facing error; unknown op is rejected', () => {
  assert.throws(() => call('excavation', { polygon: [0, 0, 1, 0, 1, 1], mode: 'level', level: 0 }), /Terrain view/);
  assert.throws(() => call('nope'), /Unknown operation/);
});

test('QA REQ-012/031: a restored calibrated backup keeps its size after save + reopen', async () => {
  // 1) a calibrated project (factor 1.02) is backed up: the GLB contains the scaled mesh
  const raw = box(4, 3, 2.5);
  const scaled = { ...raw, positions: raw.positions.map((v) => v * 1.02) };
  const project = { name: 'Kalibriert', createdAt: '2026-11-15T10:00:00Z', sourceName: 'k.glb', annotations: [], settings: {}, calibration: { factor: 1.02, refCm: 100 }, scale: 1.02 };
  const glb = await exportGlb(scaled, { extras: backupExtras(project) });
  // 2) restore exactly like projects-view.createProject does
  const imp = importScan(glb);
  const restored = projectFromBackup(imp.extras.scan2plan, new Blob([glb]), 'Kalibriert.s2p.glb', imp.format);
  const db = await openDb(new IDBFactory());
  await saveProject(db, restored);
  // 3) open a session (as startSession does) and let auto-save run once (any edit triggers it)
  const client = { call: async () => true };
  const { sourceFile, ...meta } = restored;
  const session = new Session({ db, client, project: meta, load: { kind: 'mesh' } });
  session.edit.add({ type: 'measure', view: 'plan', a: [0, 0], b: [1, 0] });
  await session.save();
  // 4) reopening loads the baked GLB with the stored transform: its scale must stay 1
  const reopened = await getProject(db, restored.id);
  near(assert, reopened.transform[0], 1, 1e-9, 'stored transform scale (mesh already calibrated)');
});

test('QA REQ-031: calibrating twice multiplies; Reset scale restores ×1 through Session', async () => {
  const db = await openDb(new IDBFactory());
  const p = newProject({ name: 'C', sourceFile: new Blob([new Uint8Array(1)]), sourceName: 'c.glb', sourceFormat: 'glb' });
  await saveProject(db, p);
  const calls = [];
  const session = new Session({ db, client: { call: async (op, a) => { calls.push([op, a]); return true; } }, project: p, load: { kind: 'mesh' } });
  session.edit.apply((d) => { d.calibration = { factor: 1.01, refCm: 100 }; });
  session.edit.apply((d) => { d.calibration = { factor: d.calibration.factor * 1.02, refCm: 50 }; });
  await new Promise((r) => setTimeout(r, 20));
  near(assert, session.transform[0], 1.0302, 1e-9, 'cumulative');
  assert.equal(calls.at(-1)[0], 'setTransform');
  session.edit.apply((d) => { d.calibration = null; });
  await new Promise((r) => setTimeout(r, 20));
  near(assert, session.transform[0], 1, 1e-12, 'reset');
  await session.save();
  near(assert, (await getProject(db, p.id)).transform[0], 1, 1e-12, 'saved');
});

test('QA REQ-012/055: vertex colours survive a GLB export → import round trip', async () => {
  const m = box(1, 1, 1);
  const colors = new Uint8Array((m.positions.length / 3) * 3).fill(128);
  const glb = await exportGlb({ ...m, colors });
  const r = importScan(glb);
  assert.ok(Math.abs(r.mesh.colors[0] - 128) <= 2, `colour 128 came back as ${r.mesh.colors[0]}`);
});
