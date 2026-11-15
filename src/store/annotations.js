/**
 * Undoable project state (REQ-040 undo/redo, REQ-063): annotations, orientation and
 * calibration live in one snapshot so a single undo stack covers all of them.
 * Pure: no DOM.
 */

/** Minimum undo depth required by the spec; we keep 100. */
export const UNDO_LIMIT = 100;

let counter = 0;
/** Short unique id for annotations. */
export function newId() {
  counter = (counter + 1) % 1e6;
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * @typedef {object} EditState
 * @property {object[]} annotations
 * @property {number[]} orientation 4×4 orientation + unit matrix
 * @property {{factor:number, refCm:number}|null} calibration
 */

export class UndoableState {
  /** @param {EditState} initial */
  constructor(initial) {
    this.state = clone(initial);
    this.undoStack = [];
    this.redoStack = [];
    /** @type {Array<(s:EditState)=>void>} */
    this.listeners = [];
  }

  /** @param {(s:EditState)=>void} fn */
  onChange(fn) {
    this.listeners.push(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.state);
  }

  /**
   * Applies a mutation to a copy of the state and records the previous state.
   * @param {(draft:EditState)=>void} mutate
   */
  apply(mutate) {
    const draft = clone(this.state);
    mutate(draft);
    this.undoStack.push(this.state);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.state = draft;
    this.emit();
  }

  /** @param {object} a annotation (id assigned if missing) @returns {string} id */
  add(a) {
    const id = a.id || newId();
    this.apply((s) => { s.annotations.push({ ...a, id }); });
    return id;
  }

  /** @param {string} id @param {object} patch */
  update(id, patch) {
    if (!this.get(id)) throw new Error(`No annotation ${id}`);
    this.apply((s) => { const i = s.annotations.findIndex((x) => x.id === id); s.annotations[i] = { ...s.annotations[i], ...patch }; });
  }

  /** @param {string} id */
  remove(id) {
    this.apply((s) => { s.annotations = s.annotations.filter((x) => x.id !== id); });
  }

  /** @param {string} id */
  get(id) {
    return this.state.annotations.find((x) => x.id === id);
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  undo() {
    if (!this.canUndo) return false;
    this.redoStack.push(this.state);
    this.state = this.undoStack.pop();
    this.emit();
    return true;
  }

  redo() {
    if (!this.canRedo) return false;
    this.undoStack.push(this.state);
    this.state = this.redoStack.pop();
    this.emit();
    return true;
  }
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}
