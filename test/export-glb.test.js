import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/filereader-shim.js';
import { exportGlb } from '../src/export/glb.js';
import { importScan } from '../src/core/import.js';
import { computeBBox } from '../src/core/mesh.js';
import { box, transformMesh, rot } from './helpers/meshes.js';

test('roundtrip bbox', async () => {
  const m = transformMesh(box(4, 3, 2.5, [1, 0.2, -3]), rot([0, 1, 0], 10));
  const glb = await exportGlb(m);
  const r = importScan(glb);
  const a = computeBBox(m.positions), b = computeBBox(r.mesh.positions);
  for (let k = 0; k < 3; k++) {
    assert.ok(Math.abs(a.min[k] - b.min[k]) <= 1e-5);
    assert.ok(Math.abs(a.max[k] - b.max[k]) <= 1e-5);
  }
  assert.equal(r.mesh.indices.length, m.indices.length);
});

test('three.js GLTFLoader reads the export', async () => {
  const { GLTFLoader } = await import('../vendor/three/addons/loaders/GLTFLoader.js');
  const glb = await exportGlb(box(2, 2, 2));
  const gltf = await new GLTFLoader().parseAsync(glb, '');
  let count = 0;
  gltf.scene.traverse((o) => { if (o.isMesh) count += o.geometry.index.count / 3; });
  assert.equal(count, 12);
});
