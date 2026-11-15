/**
 * Open-project session: undoable edit state (annotations, orientation, calibration),
 * settings, debounced auto-save (REQ-010, ≤ 1 s) and synchronisation of the transform
 * with the geometry worker. Browser-only.
 */
import { UndoableState } from '../store/annotations.js';
import { updateProject, composeTransform } from '../store/project.js';
import { scaleAnnotations } from '../core/markup.js';

export const AUTOSAVE_MS = 800;

export class Session extends EventTarget {
  /**
   * @param {{db:IDBDatabase, client:import('./geometry-client.js').GeometryClient, project:object, load:object}} o
   */
  constructor({ db, client, project, load }) {
    super();
    this.db = db;
    this.client = client;
    this.project = project;
    this.load = load; // worker load result (kind, format, display, texture, …)
    this.settings = { ...project.settings };
    this.edit = new UndoableState({ annotations: project.annotations || [], orientation: project.orientation, calibration: project.calibration || null });
    this.lastTransform = JSON.stringify(this.transform);
    this.saveTimer = null;
    this.edit.onChange(() => this.onEdit());
  }

  get annotations() { return this.edit.state.annotations; }
  get scale() { return this.edit.state.calibration ? this.edit.state.calibration.factor : 1; }
  get transform() { return composeTransform(this.edit.state.orientation, this.scale); }
  get isMesh() { return this.load.kind === 'mesh'; }

  async onEdit() {
    const t = JSON.stringify(this.transform);
    if (t !== this.lastTransform) {
      this.lastTransform = t;
      await this.client.call('setTransform', { matrix: this.transform });
      this.emit('geometry');
    }
    this.emit('annotations');
    this.scheduleSave();
  }

  /** Updates per-project settings and saves. @param {object} patch */
  setSettings(patch) {
    Object.assign(this.settings, patch);
    this.emit('settings');
    this.scheduleSave();
  }

  emit(type) {
    this.dispatchEvent(new Event(type));
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), AUTOSAVE_MS);
  }

  /** Persists edit state + settings now. */
  async save() {
    clearTimeout(this.saveTimer);
    const s = this.edit.state;
    await updateProject(this.db, this.project.id, {
      annotations: s.annotations, orientation: s.orientation, calibration: s.calibration,
      scale: this.scale, transform: this.transform, settings: this.settings,
    });
  }

  /**
   * Sets the calibration (null = reset) in one undo step and moves the annotations with the
   * rescaled mesh (DEF-06). A restored backup's `baked` factor is kept.
   * @param {{factor:number, refCm:number}|null} cal
   */
  setCalibration(cal) {
    const baked = this.edit.state.calibration?.baked;
    const next = cal ? { ...cal, ...(baked ? { baked } : {}) } : baked ? { factor: 1, refCm: this.edit.state.calibration.refCm, baked } : null;
    const ratio = (next ? next.factor : 1) / this.scale;
    this.edit.apply((d) => { d.calibration = next; d.annotations = scaleAnnotations(d.annotations, ratio); });
  }

  /** Next free section label A…Z or null if all 26 are used (REQ-026). */
  nextSectionLabel() {
    const used = new Set(this.annotations.filter((a) => a.type === 'section').map((a) => a.label));
    for (let i = 0; i < 26; i++) { const l = String.fromCharCode(65 + i); if (!used.has(l)) return l; }
    return null;
  }
}
