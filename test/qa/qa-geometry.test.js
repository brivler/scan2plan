/**
 * QA adversarial geometry tests: non-axis-aligned rooms, holey / non-manifold meshes,
 * degenerate triangles, terrain volumes against analytic solutions (REQ-022…REQ-029, REQ-045/046).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slicePolylines, planFrame } from '../../src/core/slice.js';
import { polylineLength, signedArea } from '../../src/core/polyline.js';
import { planDimensions } from '../../src/core/dims.js';
import { detectWallPairs, detectOpenings } from '../../src/core/walls.js';
import { buildPlanDrawing, buildElevationDrawing, buildTerrainDrawing } from '../../src/core/drawing.js';
import { elevation } from '../../src/core/views.js';
import { heightMap, excavation, contours } from '../../src/core/terrain.js';
import { box, transformMesh, rot, plane, concat } from '../helpers/meshes.js';
import { room, pyramidTerrain, near } from './qa-helpers.js';

test('QA rotated room (30°, not aligned) slices to the true perimeter and is not ortho-snapped', () => {
  const m = transformMesh(box(4, 3, 2.5), rot([0, 1, 0], 30));
  const polys = slicePolylines(m, planFrame(1));
  assert.equal(polys.length, 1);
  near(assert, polylineLength(polys[0]), 14, 0.005, 'perimeter');
  near(assert, Math.abs(signedArea(polys[0].pts)), 12, 0.005, 'area');
  const dims = planDimensions(polys).filter((d) => d.kind === 'segment').map((d) => d.text).sort();
  assert.deepEqual(dims, ['300', '300', '400', '400']);
});

test('QA room rotated 2° (inside the 3° snap band) – snapping error stays below 1 cm', () => {
  const m = transformMesh(box(4, 3, 2.5), rot([0, 1, 0], 2));
  const polys = slicePolylines(m, planFrame(1));
  near(assert, polylineLength(polys[0]), 14, 0.01, 'perimeter after snapping');
});

test('QA holey wall (missing patch at cut height) gives an open polyline, dims and drawing still work', () => {
  const full = room(4, 3, 2.5, { n: 10 });
  // drop triangles of the z=0 wall whose centroid is 1.5–2.5 m along X and 0.8–1.2 m high
  const keep = [];
  for (let i = 0; i < full.indices.length; i += 3) {
    const c = [0, 1, 2].map((k) => (full.positions[3 * full.indices[i] + k] + full.positions[3 * full.indices[i + 1] + k] + full.positions[3 * full.indices[i + 2] + k]) / 3);
    if (Math.abs(c[2]) < 1e-6 && c[0] > 1.5 && c[0] < 2.5 && c[1] > 0.7 && c[1] < 1.3) continue;
    keep.push(full.indices[i], full.indices[i + 1], full.indices[i + 2]);
  }
  const m = { positions: full.positions, indices: new Uint32Array(keep) };
  const polys = slicePolylines(m, planFrame(1));
  assert.ok(polys.length >= 1);
  assert.ok(polys.every((p) => !p.closed), 'outline is open at the hole');
  const total = polys.reduce((s, p) => s + polylineLength(p), 0);
  assert.ok(total > 12.5 && total < 13.5, `open length ${total}`);
  const d = buildPlanDrawing({ h: 1, outline: polys, walls: detectWallPairs(polys), openings: [] }, []);
  assert.ok(d.items.some((i) => i.k === 'dim' && i.kind === 'overall'));
});

test('QA non-manifold mesh (two rooms sharing a wall face + duplicate faces) slices without crash', () => {
  const a = box(4, 3, 2.5), b = box(3, 3, 2.5, [4, 0, 0]);
  const m = concat(a, b, a); // duplicates of every face of `a`
  const polys = slicePolylines(m, planFrame(1));
  assert.ok(polys.length >= 1);
  for (const p of polys) assert.ok(p.pts.every(Number.isFinite));
});

test('QA degenerate triangles and vertices exactly on the cut plane', () => {
  const m = box(4, 3, 2);
  // cut exactly through no vertex but at y = 2 (top face on the plane) and y = 0 (bottom face)
  for (const h of [0, 2]) assert.doesNotThrow(() => slicePolylines(m, planFrame(h)));
  const withDeg = { positions: m.positions, indices: new Uint32Array([...m.indices, 0, 0, 1, 2, 2, 2]) };
  const polys = slicePolylines(withDeg, planFrame(1));
  near(assert, polylineLength(polys[0]), 14, 0.005, 'perimeter');
});

test('QA openings: wall slightly rotated (1°) still finds the door', () => {
  // two collinear wall segments with a 0.9 m gap at both heights (door)
  const seg = (x0, x1) => ({ pts: [x0, 0, x1, 0], closed: false });
  const r = (polys, deg) => polys.map((p) => {
    const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180);
    const q = []; for (let i = 0; i < p.pts.length; i += 2) q.push(p.pts[i] * c - p.pts[i + 1] * s, p.pts[i] * s + p.pts[i + 1] * c);
    return { pts: q, closed: false };
  });
  const high = r([seg(0, 1), seg(1.9, 5)], 1), low = r([seg(0, 1), seg(1.9, 5)], 1);
  const ops = detectOpenings(high, low);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].type, 'door');
  near(assert, ops[0].width, 0.9, 0.01, 'door width');
});

test('QA elevation and terrain drawings build (no test covered these builders)', () => {
  const e = elevation(box(4, 3, 2.5), 'front');
  const d = buildElevationDrawing(e, [{ id: 'l', type: 'level', view: 'elev-front', at: [1, 2.5] }], 'elev-front');
  assert.ok(d.items.some((i) => i.k === 'text' && i.text === '+2.50'));
  assert.ok(d.items.some((i) => i.k === 'text' && i.text === '±0.00'));
  const hm = heightMap(plane(10, 50, (x) => 0.1 * x), 0.1);
  const t = buildTerrainDrawing(hm, contours(hm), [{ id: 'e', type: 'excavation', polygon: [2, -1, 6, -1, 6, -6, 2, -6] }], { e: { area: 20, cut: 18 } });
  assert.ok(t.items.some((i) => i.k === 'text' && /Excavation 1: 20.00 m², cut 18.00 m³/.test(i.text)));
});

// ---- terrain against analytic solutions ----

test('QA excavation on a flat plane with a rotated (diamond) polygon', () => {
  const hm = heightMap(plane(10, 40, () => 0.2), 0.05);
  const poly = [5, -1, 9, -5, 5, -9, 1, -5]; // diamond, area 32 m²
  const r = excavation(hm, poly, { mode: 'level', level: -0.3 });
  near(assert, r.area, 32, 1e-9, 'area');
  near(assert, r.cut, 32 * 0.5, 0.1, 'cut');
  assert.equal(r.fill, 0);
  near(assert, r.coverage, 1, 0.01, 'coverage');
});

test('QA excavation of a pyramid heap (V = a²h/3) and fill of a pit', () => {
  const size = 8, top = 1.5;
  const hm = heightMap(pyramidTerrain(size, 160, top), 0.05);
  const poly = [0, 0, size, 0, size, -size, 0, -size];
  const r = excavation(hm, poly, { mode: 'level', level: 0 });
  near(assert, r.cut, (size * size * top) / 3, 0.15, 'heap volume');
  // pit: target level = top, fill = box − heap
  const pit = excavation(hm, poly, { mode: 'level', level: top });
  near(assert, pit.fill, size * size * top - (size * size * top) / 3, 0.2, 'fill volume');
});

test('QA excavation polygon half outside the scanned area reports coverage and warns', () => {
  const hm = heightMap(plane(10, 40, () => 0), 0.05);
  const r = excavation(hm, [8, -2, 12, -2, 12, -6, 8, -6], { mode: 'depth', depth: 0.3 });
  near(assert, r.coverage, 0.5, 0.05, 'coverage');
  assert.equal(r.warning, true);
  assert.ok(r.excludedCells > 0);
});

test('QA terrain cell-size limits are enforced (2–20 cm)', () => {
  assert.throws(() => heightMap(plane(10, 10), 0.01));
  assert.throws(() => heightMap(plane(10, 10), 0.25));
});
