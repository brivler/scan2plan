import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/filereader-shim.js';
import { exportGlb, backupExtras, BACKUP_SCHEMA } from '../src/export/glb.js';
import { importScan } from '../src/core/import.js';
import { computeBBox, transformPositions } from '../src/core/mesh.js';
import { multiply, translation, scaling } from '../src/core/mat4.js';
import { projectFromBackup } from '../src/store/backup.js';
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
  assert.deepEqual(restored.calibration, project.calibration);
  const a = computeBBox(world.positions), b = computeBBox(r.mesh.positions);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(a.min[k] - b.min[k]) <= 1e-5 && Math.abs(a.max[k] - b.max[k]) <= 1e-5);
});
