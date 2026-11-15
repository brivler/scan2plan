/**
 * Project CRUD on IndexedDB (REQ-010).
 * A project: {id, name, createdAt, updatedAt, sourceFile (Blob), sourceName, sourceFormat,
 *   orientation (4×4), scale, calibration, transform (4×4 = scale·orientation), annotations,
 *   settings, thumbnail (Blob|null), kind}.
 */
import { tx, req } from './idb.js';
import { identity, multiply, scaling } from '../core/mat4.js';

/** Default per-project settings. */
export const DEFAULT_SETTINGS = Object.freeze({
  planHeight: 1.0, simplify: 0.01, snap: true, showDims: true, showBelow: false,
  sectionDepth: 5, paper: 'A4', orientation: 'landscape', scale: 'fit', bw: false,
  terrainCell: 0.05, author: '', orientCheck: null,
});

/**
 * Creates a project record (without saving).
 * @param {{name:string, sourceFile:Blob, sourceName:string, sourceFormat:string, kind?:string}} o
 */
export function newProject(o) {
  const name = (o.name || '').trim();
  if (!name) throw new Error('Please enter a project name.');
  if (name.length > 80) throw new Error('Project name is limited to 80 characters.');
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), name, createdAt: now, updatedAt: now,
    sourceFile: o.sourceFile, sourceName: o.sourceName, sourceFormat: o.sourceFormat, kind: o.kind || 'mesh',
    orientation: identity(), scale: 1, calibration: null, transform: identity(),
    annotations: [], settings: { ...DEFAULT_SETTINGS }, thumbnail: null,
  };
}

/** transform = uniform calibration scale · orientation. */
export function composeTransform(orientation, scale) {
  return multiply(scaling(scale), orientation);
}

/**
 * Stores the source scan. Blobs are preferred (file-backed, no memory copy). WebKit refuses
 * Blob values in IndexedDB in ephemeral sessions (Private Browsing, automated WebKit), so on
 * failure the bytes are stored as an ArrayBuffer instead.
 * @param {IDBDatabase} db
 * @param {string} id
 * @param {Blob} blob
 */
async function putSource(db, id, blob) {
  try {
    await tx(db, ['sources'], 'readwrite', (t) => { t.objectStore('sources').put({ id, blob }); });
  } catch (e) {
    console.warn(`Storing the scan as Blob failed (${e && e.name}: ${e && e.message}); storing bytes instead.`);
    const bytes = await blob.arrayBuffer();
    await tx(db, ['sources'], 'readwrite', (t) => { t.objectStore('sources').put({ id, bytes, type: blob.type }); });
  }
}

/**
 * Saves (insert or replace) a project; the source goes to the `sources` store first, so a
 * project record never exists without its scan.
 * @param {IDBDatabase} db
 * @param {object} project
 */
export async function saveProject(db, project) {
  const { sourceFile, ...meta } = project;
  meta.updatedAt = new Date().toISOString();
  meta.sourceSize = sourceFile ? sourceFile.size : meta.sourceSize || 0;
  if (sourceFile) await putSource(db, meta.id, sourceFile);
  await tx(db, ['projects'], 'readwrite', (t) => { t.objectStore('projects').put(meta); });
  return meta;
}

/**
 * Thumbnails are stored as plain bytes (they are small), which every IndexedDB accepts.
 * @param {Blob} blob JPEG
 * @returns {Promise<{bytes:ArrayBuffer, type:string}>}
 */
export async function thumbnailRecord(blob) {
  return { bytes: await blob.arrayBuffer(), type: blob.type || 'image/jpeg' };
}

/** Thumbnail record (or a legacy Blob) → Blob for display. */
export function thumbnailBlob(t) {
  if (!t) return null;
  return t instanceof Blob ? t : new Blob([t.bytes], { type: t.type });
}

/**
 * Updates fields of a stored project (never the source file).
 * @param {IDBDatabase} db
 * @param {string} id
 * @param {object} patch
 */
export async function updateProject(db, id, patch) {
  return tx(db, ['projects'], 'readwrite', (t) => {
    const store = t.objectStore('projects');
    const r = store.get(id);
    r.onsuccess = () => {
      if (!r.result) return;
      store.put({ ...r.result, ...patch, id, updatedAt: new Date().toISOString() });
    };
  });
}

/**
 * Loads a project; with `withSource` the original file Blob is attached as `sourceFile`.
 * @param {IDBDatabase} db
 * @param {string} id
 * @param {{withSource?:boolean}} [opts]
 */
export async function getProject(db, id, opts = {}) {
  const p = await tx(db, ['projects'], 'readonly', (t) => req(t.objectStore('projects').get(id)));
  if (!p) return null;
  if (opts.withSource) {
    const src = await tx(db, ['sources'], 'readonly', (t) => req(t.objectStore('sources').get(id)));
    p.sourceFile = src?.blob || (src?.bytes ? new Blob([src.bytes], { type: src.type || '' }) : null);
  }
  return p;
}

/** All projects (metadata only), newest first, with storage size estimate in bytes. */
export async function listProjects(db) {
  const all = await tx(db, ['projects'], 'readonly', (t) => req(t.objectStore('projects').getAll()));
  return all
    .map((p) => ({ ...p, storageBytes: (p.sourceSize || 0) + JSON.stringify(p.annotations || []).length + (p.thumbnail ? p.thumbnail.size ?? p.thumbnail.bytes.byteLength : 0) }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Deletes a project and its source. */
export async function deleteProject(db, id) {
  await tx(db, ['projects', 'sources'], 'readwrite', (t) => {
    t.objectStore('projects').delete(id);
    t.objectStore('sources').delete(id);
  });
}

/** Duplicates a project (new id, name + " (copy)"). @returns {Promise<object>} the copy's metadata */
export async function duplicateProject(db, id) {
  const p = await getProject(db, id, { withSource: true });
  if (!p) throw new Error('Project not found.');
  const copy = { ...p, id: crypto.randomUUID(), name: `${p.name} (copy)`.slice(0, 80), createdAt: new Date().toISOString() };
  return saveProject(db, copy);
}
