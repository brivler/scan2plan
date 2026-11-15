import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { openDb } from '../src/store/idb.js';
import { newProject, saveProject, getProject, listProjects, updateProject, deleteProject, duplicateProject } from '../src/store/project.js';

const sample = () => newProject({ name: 'Küche', sourceFile: new Blob([new Uint8Array([1, 2, 3])]), sourceName: 'k.glb', sourceFormat: 'glb' });

test('crud', async () => {
  const db = await openDb(new IDBFactory());
  const p = sample();
  await saveProject(db, p);
  const list = await listProjects(db);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Küche');
  assert.equal(list[0].sourceFile, undefined, 'list does not load sources');
  await updateProject(db, p.id, { name: 'Bad' });
  const got = await getProject(db, p.id, { withSource: true });
  assert.equal(got.name, 'Bad');
  assert.deepEqual(new Uint8Array(await got.sourceFile.arrayBuffer()), new Uint8Array([1, 2, 3]));
  const copy = await duplicateProject(db, p.id);
  assert.equal((await listProjects(db)).length, 2);
  assert.equal(copy.name, 'Bad (copy)');
  await deleteProject(db, p.id);
  assert.equal(await getProject(db, p.id), null);
  assert.equal((await listProjects(db)).length, 1);
  assert.throws(() => newProject({ name: '  ' }), /project name/);
});

test('reopen deep-equal', async () => {
  const factory = new IDBFactory();
  let db = await openDb(factory);
  const p = sample();
  p.transform = [1.01, 0, 0, 0, 0, 1.01, 0, 0, 0, 0, 1.01, 0, 0.1, -0.2, 0.3, 1];
  p.annotations = [{ id: 'x', type: 'demolition', a: [0, 0], b: [3, 0], thickness: 0.24, side: 1, height: 2.5, note: 'ä' }];
  await saveProject(db, p);
  db.close();
  db = await openDb(factory);
  const got = await getProject(db, p.id);
  assert.deepEqual(got.transform, p.transform);
  assert.deepEqual(got.annotations, p.annotations);
});

test('falls back to bytes when Blobs cannot be stored (WebKit ephemeral sessions)', async () => {
  const db = await openDb(new IDBFactory());
  // simulate WebKit: the first Blob put throws DataError
  const realTx = db.transaction.bind(db);
  let failed = false;
  db.transaction = (stores, mode) => {
    const t = realTx(stores, mode);
    const real = t.objectStore.bind(t);
    t.objectStore = (name) => {
      const os = real(name);
      const put = os.put.bind(os);
      os.put = (v) => {
        if (v && v.blob instanceof Blob && !failed) { failed = true; throw new DOMException('Error preparing Blob/File data to be stored in object store', 'DataError'); }
        return put(v);
      };
      return os;
    };
    return t;
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const p = sample();
    await saveProject(db, p);
    assert.ok(failed);
    const got = await getProject(db, p.id, { withSource: true });
    assert.deepEqual(new Uint8Array(await got.sourceFile.arrayBuffer()), new Uint8Array([1, 2, 3]));
  } finally { console.warn = warn; }
});
