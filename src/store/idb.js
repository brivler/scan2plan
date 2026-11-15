/**
 * IndexedDB access (REQ-010): database `scan2plan`, versioned schema with an upgrade function.
 * Stores: `projects` (metadata, transform, annotations, settings, thumbnail) and `sources`
 * (original scan file bytes as Blob, kept separately so listing projects stays cheap).
 */

export const DB_NAME = 'scan2plan';
export const DB_VERSION = 1;

/**
 * Schema upgrades by version step.
 * @param {IDBDatabase} db
 * @param {number} oldVersion
 */
function upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    db.createObjectStore('projects', { keyPath: 'id' });
    db.createObjectStore('sources', { keyPath: 'id' });
  }
}

/**
 * Opens the database.
 * @param {IDBFactory} [factory] defaults to globalThis.indexedDB (injectable for tests)
 * @returns {Promise<IDBDatabase>}
 */
export function openDb(factory = globalThis.indexedDB) {
  if (!factory) return Promise.reject(new Error('This browser does not support offline storage (IndexedDB).'));
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => upgrade(req.result, e.oldVersion);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Storage is blocked by another open tab of Scan2Plan. Close it and retry.'));
  });
}

/**
 * Runs `fn` inside a transaction and resolves when it completes.
 * @template T
 * @param {IDBDatabase} db
 * @param {string[]} stores
 * @param {'readonly'|'readwrite'} mode
 * @param {(tx:IDBTransaction)=>T} fn
 * @returns {Promise<T>}
 */
export function tx(db, stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage transaction aborted (device storage may be full).'));
    result = fn(t);
  });
}

/** Promise for a single IDBRequest. */
export function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
