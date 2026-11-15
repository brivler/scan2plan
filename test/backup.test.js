import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/filereader-shim.js';
import { exportGlb, backupExtras, BACKUP_SCHEMA } from '../src/export/glb.js';
import { importScan } from '../src/core/import.js';
import { computeBBox, transformPositions } from '../src/core/mesh.js';
import { multiply, translation, scaling } from '../src/core/mat4.js';
import { projectFromBackup } from '../src/store/backup.js';
import { calibrationText } from '../src/core/measure.js';
import { IDBFactory } from 'fake-indexeddb';
import { openDb } from '../src/store/idb.js';
import { saveProject, getProject } from '../src/store/project.js';
import { Session } from '../src/app/session.js';
import { box } from './helpers/meshes.js';

test('roundtrip', async () => {
  const raw = box(4, 3, 2.5);
  const transform = multiply(scaling(1.01), translation(0, -0.1, 0));
  const world = { ...raw, positions: transformPositions(raw.positions, transform) };
  const project = {
    name: 'Bad OG', createdAt: '2026-11-15T10:00:00.000Z', sourceName: 'bad.glb', scale: 1.01,
    calibration: { factor: 1.01, refCm: 100 }, settings: { planHeight: 1.1 },
    annotations: [
      { id: 'a', type: 'demolition', a: [0, 0], b: [3, 0], thickness: 0.24, side: 1, height: 2.5, note: 'Tür' },
      { id: 'b', type: 'new', a: [1, -1], b: [1, -2], thickness: 0.115, align: 'center' },
      { id: 'c', type: 'section', label: 'A', a: [2, -1], b: [2, 4], side: 1 },
    ],
  };
  const glb = await exportGlb(world, { extras: backupExtras(project) });
  const r = importScan(glb);
  assert.equal(r.extras.scan2plan.schema, BACKUP_SCHEMA);
  const restored = projectFromBackup(r.extras.scan2plan, new Blob([glb]), 'Bad_OG.s2p.glb', r.format);
  assert.deepEqual(restored.annotations, project.annotations);
  assert.deepEqual(restored.transform, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  assert.equal(restored.name, 'Bad OG');
  // calibration is already baked into the mesh: kept for display only, never re-applied (DEF-01)
  assert.deepEqual(restored.calibration, { factor: 1, refCm: 100, baked: 1.01 });
  assert.equal(calibrationText(restored.calibration), 'Scale calibrated ×1.0100 on 100.0 cm reference');
  const a = computeBBox(world.positions), b = computeBBox(r.mesh.positions);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(a.min[k] - b.min[k]) <= 1e-5 && Math.abs(a.max[k] - b.max[k]) <= 1e-5);
});

test('restored calibration is not applied twice', async () => {
  const raw = box(4, 3, 2.5);
  const project = { name: 'K', createdAt: '2026-11-15T10:00:00Z', sourceName: 'k.glb', annotations: [], settings: {}, calibration: { factor: 1.02, refCm: 100 }, scale: 1.02 };
  const glb = await exportGlb({ ...raw, positions: raw.positions.map((v) => v * 1.02) }, { extras: backupExtras(project) });
  const r = importScan(glb);
  const restored = projectFromBackup(r.extras.scan2plan, new Blob([glb]), 'K.s2p.glb', r.format);
  const db = await openDb(new IDBFactory());
  await saveProject(db, restored);
  const { sourceFile, ...meta } = restored;
  const session = new Session({ db, client: { call: async () => true }, project: meta, load: { kind: 'mesh' } });
  assert.equal(session.scale, 1);
  session.setCalibration({ factor: 1.01, refCm: 50 }); // a further calibration keeps the baked factor
  assert.equal(session.edit.state.calibration.baked, 1.02);
  session.setCalibration(null); // Reset scale returns to the baked mesh, keeps the info
  assert.deepEqual(session.edit.state.calibration, { factor: 1, refCm: 50, baked: 1.02 });
  await session.save();
  assert.equal((await getProject(db, restored.id)).transform[0], 1);
});
