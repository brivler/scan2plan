/**
 * Geometry worker (REQ-004, REQ-075): owns the full-resolution mesh and runs all heavy
 * computations off the main thread. Protocol: {id, op, args} → {id, ok, result} | {id, error}
 * plus {id, progress} messages. Results with large arrays are transferred, not copied.
 */
import { importScan } from '../core/import.js';
import { ImportError } from '../core/errors.js';
import { computeBBox, transformPositions } from '../core/mesh.js';
import { decimateForDisplay } from '../core/decimate.js';
import { suggestUnitScale, autoOrient, reorient, levelAtTap, alignToWall, rotate90, upAxisDelta } from '../core/orient.js';
import { multiply, translation, identity } from '../core/mat4.js';
import { slicePolylines, planFrame } from '../core/slice.js';
import { slicePoints, heightMap, contours, heightImage, excavation } from '../core/terrain.js';
import { detectWallPairs, detectOpenings } from '../core/walls.js';
import { elevation, section } from '../core/views.js';
import { nearestVertex } from '../core/measure.js';

/** Worker state. */
const S = { raw: null, kind: null, format: null, transform: identity(), world: null, hm: null };

const worldMesh = () => ({ positions: S.world, indices: S.raw.indices });

function requireMesh() {
  if (!S.raw) throw new Error('No scan loaded.');
}

const ops = {
  /** Parse a scan file and create the display copy. */
  load({ buffer, transform }, progress) {
    progress(0.05, 'Reading file');
    const r = importScan(buffer, (f) => progress(0.05 + 0.6 * f, 'Reading file'));
    S.raw = r.mesh; S.kind = r.kind; S.format = r.format; S.hm = null;
    S.transform = transform || identity();
    progress(0.7, 'Preparing 3D view');
    S.world = transformPositions(S.raw.positions, S.transform);
    const dec = S.kind === 'mesh' ? decimateForDisplay(S.raw) : { mesh: S.raw, cellSize: null };
    const d = dec.mesh;
    const display = {
      positions: d.positions.slice(), indices: d.indices ? d.indices.slice() : null,
      colors: d.colors ? d.colors.slice() : null, uvs: d.uvs ? d.uvs.slice() : null,
    };
    progress(1, 'Done');
    const bbox = computeBBox(S.raw.positions);
    const transfer = [display.positions.buffer, display.indices?.buffer, display.colors?.buffer, display.uvs?.buffer].filter(Boolean);
    return {
      result: {
        kind: S.kind, format: S.format, extras: r.extras, origin: r.origin, bbox, display, decimated: dec.cellSize !== null,
        texture: S.raw.texture ? { bytes: S.raw.texture.bytes.slice(), mimeType: S.raw.texture.mimeType } : null,
        triangles: S.raw.indices ? S.raw.indices.length / 3 : 0, vertices: S.raw.positions.length / 3,
        unit: suggestUnitScale(bbox, S.format),
      },
      transfer,
    };
  },

  setTransform({ matrix }) {
    requireMesh();
    S.transform = matrix;
    S.world = transformPositions(S.raw.positions, matrix);
    S.hm = null;
    return { result: true };
  },

  autoOrient({ unitScale }) {
    requireMesh();
    return { result: autoOrient(S.raw.positions, S.raw.indices, { format: S.format, unitScale }) };
  },

  /** Manual orientation tools; each returns the new full matrix (not yet applied). */
  orient({ op, args = {} }) {
    requireMesh();
    const T = S.transform;
    let delta;
    if (op === 'up') return { result: reorient(S.raw.positions, S.raw.indices, multiply(upAxisDelta(args.axis), T)).matrix };
    if (op === 'auto') return { result: reorient(S.raw.positions, S.raw.indices, T).matrix };
    if (op === 'tapFloor') {
      if (!S.raw.indices) throw new Error('Tap floor needs a mesh, not a point cloud.');
      delta = levelAtTap(S.world, S.raw.indices, args.point, args.normal);
      if (!delta) throw new Error('No floor surface found at the tapped point.');
    } else if (op === 'zero') delta = translation(0, -args.y, 0);
    else if (op === 'rot90') delta = rotate90();
    else if (op === 'alignWall') delta = alignToWall(args.normal);
    else throw new Error(`Unknown orientation tool ${op}`);
    return { result: multiply(delta, T) };
  },

  /** Floor plan at height h (+ openings at 0.30/1.00 m and optional floor edges). */
  plan({ h, simplify, snap, below }) {
    requireMesh();
    const bb = computeBBox(S.world);
    if (S.kind === 'points') {
      return { result: { h, outline: slicePoints(S.world, h, { simplify, snap }), below: [], walls: [], openings: [], maxY: bb.max[1] } };
    }
    const mesh = worldMesh();
    const opts = { simplify, snap };
    const outline = slicePolylines(mesh, planFrame(h), opts);
    const walls = detectWallPairs(outline);
    const openings = bb.max[1] > 1.05 ? detectOpenings(slicePolylines(mesh, planFrame(1.0), opts), slicePolylines(mesh, planFrame(0.3), opts)) : [];
    const result = { h, outline, walls, openings, below: below ? slicePolylines(mesh, planFrame(0.05), opts) : [], maxY: bb.max[1], minY: bb.min[1] };
    return { result };
  },

  elevation({ dir }) {
    requireMesh();
    if (S.kind === 'points') throw new Error('Elevations need a mesh. Export a mesh (GLB) from your scanner app.');
    const v = elevation(worldMesh(), dir);
    return { result: v, transfer: [v.rgba.buffer] };
  },

  section({ a, b, side, depth, simplify }) {
    requireMesh();
    if (S.kind === 'points') throw new Error('Sections need a mesh. Export a mesh (GLB) from your scanner app.');
    const s = section(worldMesh(), a, b, side, { depth, simplify });
    return { result: s, transfer: [s.beyond.rgba.buffer] };
  },

  terrain({ cell, interval }) {
    requireMesh();
    S.hm = heightMap(worldMesh(), cell);
    const lines = contours(S.hm, interval || 0.1, 0.5);
    const rgba = heightImage(S.hm);
    let missing = 0;
    for (const v of S.hm.h) if (Number.isNaN(v)) missing++;
    const hm = { ...S.hm, h: S.hm.h.slice() };
    return { result: { hm, lines, rgba, missing }, transfer: [rgba.buffer, hm.h.buffer] };
  },

  excavation(args) {
    if (!S.hm) throw new Error('Open the Terrain view first.');
    return { result: excavation(S.hm, args.polygon, args) };
  },

  /** Nearest full-resolution vertex within radius (REQ-030 snapping). */
  snap({ point, radius }) {
    requireMesh();
    return { result: nearestVertex(S.world, point, radius) };
  },

  /** Scanned floor-to-ceiling height near a plan point: max Y of vertices within 0.2 m. */
  heightAtPlan({ x, y }) {
    requireMesh();
    const p = S.world;
    let max = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      const dx = p[i] - x, dz = p[i + 2] + y;
      if (dx * dx + dz * dz < 0.04 && p[i + 1] > max) max = p[i + 1];
    }
    return { result: max === -Infinity ? null : max };
  },

  /** Copy of the oriented mesh for GLB export / backup. */
  worldMesh() {
    requireMesh();
    const m = {
      positions: S.world.slice(), indices: S.raw.indices ? S.raw.indices.slice() : null,
      colors: S.raw.colors ? S.raw.colors.slice() : null, uvs: S.raw.uvs ? S.raw.uvs.slice() : null,
    };
    return { result: m, transfer: [m.positions.buffer, m.indices?.buffer, m.colors?.buffer, m.uvs?.buffer].filter(Boolean) };
  },
};

self.onmessage = (e) => {
  const { id, op, args } = e.data;
  const progress = (value, label) => self.postMessage({ id, progress: value, label });
  try {
    if (!ops[op]) throw new Error(`Unknown operation ${op}`);
    const { result, transfer = [] } = ops[op](args || {}, progress);
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (err) {
    const code = err instanceof ImportError ? err.code : null;
    self.postMessage({ id, ok: false, error: { code, message: err.message || String(err) } });
  }
};
