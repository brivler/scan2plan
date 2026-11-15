/**
 * Promise wrapper around the geometry worker with progress and cancellation (REQ-004).
 */

export class GeometryClient {
  constructor() {
    this.seq = 0;
    this.pending = new Map();
    this.start();
  }

  start() {
    this.worker = new Worker(new URL('../worker/geometry.worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => {
      const m = e.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.progress !== undefined) { p.onProgress && p.onProgress(m.progress, m.label); return; }
      this.pending.delete(m.id);
      if (m.ok) p.resolve(m.result);
      else {
        const err = new Error(m.error.message);
        err.code = m.error.code;
        p.reject(err);
      }
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'Geometry worker crashed (out of memory?).'));
      this.pending.clear();
    };
  }

  /**
   * @param {string} op
   * @param {object} [args]
   * @param {{transfer?:Transferable[], onProgress?:(v:number, label?:string)=>void}} [opts]
   */
  call(op, args = {}, opts = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress: opts.onProgress });
      this.worker.postMessage({ id, op, args }, opts.transfer || []);
    });
  }

  /** Terminates running work immediately (state is lost; caller must reload). */
  cancel() {
    this.worker.terminate();
    const err = new Error('Cancelled');
    err.code = 'CANCELLED';
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    this.start();
  }
}
