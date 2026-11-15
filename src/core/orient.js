/**
 * Unit plausibility (REQ-005), automatic levelling (REQ-020) and wall alignment (REQ-021).
 * All functions return *delta* matrices (column-major) meant to be pre-multiplied onto the
 * current project transform: T_new = delta · T_old. Pure: no DOM, no three.js.
 */
import { identity, multiply, translation, rotationAxis, rotationBetween, scaling } from './mat4.js';
import { computeBBox, faceData, transformPositions } from './mesh.js';

const UP_DOT = 0.97;
const LOW_FRACTION = 0.2;
const MIN_FLOOR_AREA = 0.5;
const MAX_TILT_DEG = 5;
const WALL_DOT = 0.2;
const DEG = Math.PI / 180;

/**
 * Suggests a unit conversion from the bounding box (REQ-005).
 * Uses the longest bbox side (see IMPLEMENTATION_NOTES, REQ-005).
 * @param {{min:number[],max:number[]}} bbox
 * @param {string} format 'glb'|'gltf'|'obj'|'ply'|'xyz'
 * @returns {{scale:number|null, warning:string|null, message:string|null}}
 */
export function suggestUnitScale(bbox, format) {
  const size = Math.max(bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]);
  const isGltf = format === 'glb' || format === 'gltf';
  if (size > 500) return { scale: 0.001, warning: null, message: 'Model looks like it is in millimeters. Scale ×0.001?' };
  if (size > 50 && !isGltf) return { scale: 0.01, warning: null, message: 'Model looks like it is in centimeters. Scale ×0.01?' };
  if (size < 0.05) return { scale: null, warning: 'tiny', message: 'Model is very small — check units.' };
  return { scale: null, warning: null, message: null };
}

/**
 * Chooses the up axis for OBJ/PLY (REQ-020). Area of upward-facing faces in the lowest 20 %
 * along each candidate; if no candidate has any, faces facing either way count (closed meshes
 * with outward normals). Near-ties (within 5 %) resolve in the order +Y,+Z,+X,−Y,−Z,−X.
 * @param {Float32Array} positions
 * @param {Uint32Array} indices
 * @returns {number[]} unit axis
 */
export function chooseUpAxis(positions, indices) {
  const axes = [[0, 1, 0], [0, 0, 1], [1, 0, 0], [0, -1, 0], [0, 0, -1], [-1, 0, 0]];
  const bb = computeBBox(positions);
  const { normals, areas, centroids } = faceData(positions, indices);
  const up = new Float64Array(6), abs = new Float64Array(6);
  axes.forEach((a, k) => {
    const comp = a.findIndex((v) => v !== 0), sgn = a[comp];
    const lo = sgn > 0 ? bb.min[comp] : -bb.max[comp];
    const hi = sgn > 0 ? bb.max[comp] : -bb.min[comp];
    const thr = lo + LOW_FRACTION * (hi - lo);
    for (let t = 0; t < areas.length; t++) {
      if (sgn * centroids[3 * t + comp] > thr) continue;
      const d = sgn * normals[3 * t + comp];
      if (d > UP_DOT) up[k] += areas[t];
      if (Math.abs(d) > UP_DOT) abs[k] += areas[t];
    }
  });
  const score = Math.max(...up) > 0 ? up : abs;
  const best = Math.max(...score);
  if (best <= 0) return [0, 1, 0];
  const k = [...score].findIndex((s) => s >= best * 0.95);
  return axes[k];
}

/**
 * Levels (tilt ≤ 5°) and sets floor to Y = 0 on positions that are already roughly +Y up.
 * @param {Float32Array} positions world positions
 * @param {Uint32Array|null} indices
 * @returns {{delta:number[], hasFloor:boolean, tiltDeg:number, floorY:number}}
 */
export function levelFloor(positions, indices) {
  const bb = computeBBox(positions);
  if (!indices) return { delta: translation(0, -bb.min[1], 0), hasFloor: false, tiltDeg: 0, floorY: bb.min[1] };
  const { normals, areas, centroids } = faceData(positions, indices);
  const thr = bb.min[1] + LOW_FRACTION * (bb.max[1] - bb.min[1]);
  const floor = [];
  let area = 0;
  for (let t = 0; t < areas.length; t++) {
    if (Math.abs(normals[3 * t + 1]) > UP_DOT && centroids[3 * t + 1] <= thr && areas[t] > 0) { floor.push(t); area += areas[t]; }
  }
  if (area < MIN_FLOOR_AREA) return { delta: translation(0, -bb.min[1], 0), hasFloor: false, tiltDeg: 0, floorY: bb.min[1] };
  const n = fitPlaneNormal(positions, indices, floor, areas);
  const tiltDeg = Math.acos(Math.min(1, n[1])) / DEG;
  const rot = tiltDeg <= MAX_TILT_DEG ? rotationBetween(n, [0, 1, 0]) : identity();
  // Weighted median of rotated floor-face centroids.
  const ys = floor.map((t) => {
    const x = centroids[3 * t], y = centroids[3 * t + 1], z = centroids[3 * t + 2];
    return { y: rot[1] * x + rot[5] * y + rot[9] * z + rot[13], w: areas[t] };
  }).sort((a, b) => a.y - b.y);
  let acc = 0, median = ys[ys.length - 1].y;
  for (const s of ys) { acc += s.w; if (acc >= area / 2) { median = s.y; break; } }
  return { delta: multiply(translation(0, -median, 0), rot), hasFloor: true, tiltDeg: tiltDeg <= MAX_TILT_DEG ? tiltDeg : 0, floorY: median };
}

/** Area-weighted LSQ fit of y = a·x + b·z + c over the vertices of the given faces; returns unit normal with +Y component. */
function fitPlaneNormal(positions, indices, faces, areas) {
  let sw = 0, mx = 0, my = 0, mz = 0;
  for (const t of faces) for (let k = 0; k < 3; k++) {
    const v = indices[3 * t + k] * 3, w = areas[t] / 3;
    sw += w; mx += w * positions[v]; my += w * positions[v + 1]; mz += w * positions[v + 2];
  }
  mx /= sw; my /= sw; mz /= sw;
  let sxx = 0, sxz = 0, szz = 0, sxy = 0, szy = 0;
  for (const t of faces) for (let k = 0; k < 3; k++) {
    const v = indices[3 * t + k] * 3, w = areas[t] / 3;
    const x = positions[v] - mx, y = positions[v + 1] - my, z = positions[v + 2] - mz;
    sxx += w * x * x; sxz += w * x * z; szz += w * z * z; sxy += w * x * y; szy += w * z * y;
  }
  const det = sxx * szz - sxz * sxz;
  if (Math.abs(det) < 1e-18) return [0, 1, 0];
  const a = (sxy * szz - szy * sxz) / det, b = (szy * sxx - sxy * sxz) / det;
  const l = Math.hypot(a, 1, b);
  return [-a / l, 1 / l, -b / l];
}

/**
 * Dominant wall yaw in degrees [0, 90) (REQ-021). θ of a horizontal normal is atan2(−nz, nx),
 * so a model rotated by +α about Y yields α.
 * @param {Float32Array} positions
 * @param {Uint32Array|null} indices
 * @returns {number|null} null if no wall-like faces
 */
export function detectYaw(positions, indices) {
  if (!indices) return null;
  const { normals, areas } = faceData(positions, indices);
  const BINS = 180, W = 0.5;
  const hist = new Float64Array(BINS);
  const ang = new Float64Array(areas.length).fill(NaN);
  let total = 0;
  for (let t = 0; t < areas.length; t++) {
    const nx = normals[3 * t], ny = normals[3 * t + 1], nz = normals[3 * t + 2];
    if (Math.abs(ny) >= WALL_DOT || areas[t] === 0) continue;
    let a = Math.atan2(-nz, nx) / DEG;
    a = ((a % 90) + 90) % 90;
    ang[t] = a;
    hist[Math.min(BINS - 1, Math.floor(a / W))] += areas[t];
    total += areas[t];
  }
  if (total === 0) return null;
  let best = 0, bestV = -1;
  for (let i = 0; i < BINS; i++) {
    const v = hist[(i - 1 + BINS) % BINS] + hist[i] + hist[(i + 1) % BINS];
    if (v > bestV) { bestV = v; best = i; }
  }
  const center = (best + 0.5) * W;
  // Circular mean in the 90°-periodic domain (angle × 4).
  let sx = 0, sy = 0;
  for (let t = 0; t < areas.length; t++) {
    const a = ang[t];
    if (Number.isNaN(a)) continue;
    let d = Math.abs(a - center) % 90;
    if (d > 45) d = 90 - d;
    if (d > 1) continue;
    sx += areas[t] * Math.cos(a * 4 * DEG); sy += areas[t] * Math.sin(a * 4 * DEG);
  }
  const mean = Math.atan2(sy, sx) / DEG / 4;
  return ((mean % 90) + 90) % 90;
}

/**
 * Rotation about Y that brings walls at yaw φ onto the axes (smallest rotation).
 * @param {number} yawDeg
 */
export function yawCorrection(yawDeg) {
  const a = yawDeg > 45 ? 90 - yawDeg : -yawDeg;
  return rotationAxis([0, 1, 0], a * DEG);
}

/**
 * Full automatic orientation of raw positions (REQ-020 + REQ-021).
 * @param {Float32Array} positions raw positions
 * @param {Uint32Array|null} indices
 * @param {{format:string, unitScale?:number}} opts
 * @returns {{matrix:number[], up:number[], yawDeg:number|null, tiltDeg:number, hasFloor:boolean}}
 */
export function autoOrient(positions, indices, { format, unitScale = 1 }) {
  let m = scaling(unitScale);
  const isGltf = format === 'glb' || format === 'gltf';
  const scaled = transformPositions(positions, m);
  const up = isGltf || !indices ? [0, 1, 0] : chooseUpAxis(scaled, indices);
  m = multiply(rotationBetween(up, [0, 1, 0]), m);
  const res = reorient(positions, indices, m);
  return { matrix: res.matrix, up, yawDeg: res.yawDeg, tiltDeg: res.tiltDeg, hasFloor: res.hasFloor };
}

/**
 * Levelling + yaw alignment applied on top of a transform whose up axis is already +Y.
 * @param {Float32Array} positions raw positions
 * @param {Uint32Array|null} indices
 * @param {number[]} m current transform
 */
export function reorient(positions, indices, m) {
  const lvl = levelFloor(transformPositions(positions, m), indices);
  m = multiply(lvl.delta, m);
  const yawDeg = detectYaw(transformPositions(positions, m), indices);
  if (yawDeg !== null) m = multiply(yawCorrection(yawDeg), m);
  return { matrix: m, yawDeg, tiltDeg: lvl.tiltDeg, hasFloor: lvl.hasFloor };
}

/**
 * "Tap floor to level": faces within 0.3 m of the tap with normal within 15° of the tap normal
 * define the floor plane; returns a delta that makes it horizontal at Y = 0.
 * @param {Float32Array} positions world positions
 * @param {Uint32Array} indices
 * @param {number[]} point tapped point (world)
 * @param {number[]} normal tapped face normal (world)
 * @returns {number[]|null} delta or null if no faces found
 */
export function levelAtTap(positions, indices, point, normal) {
  const { normals, areas, centroids } = faceData(positions, indices);
  const cosMax = Math.cos(15 * DEG);
  let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0, w = 0;
  for (let t = 0; t < areas.length; t++) {
    const dx = centroids[3 * t] - point[0], dy = centroids[3 * t + 1] - point[1], dz = centroids[3 * t + 2] - point[2];
    if (dx * dx + dy * dy + dz * dz > 0.09) continue;
    let d = normals[3 * t] * normal[0] + normals[3 * t + 1] * normal[1] + normals[3 * t + 2] * normal[2];
    const s = d < 0 ? -1 : 1;
    d = Math.abs(d);
    if (d < cosMax) continue;
    const a = areas[t];
    nx += s * a * normals[3 * t]; ny += s * a * normals[3 * t + 1]; nz += s * a * normals[3 * t + 2];
    cx += a * centroids[3 * t]; cy += a * centroids[3 * t + 1]; cz += a * centroids[3 * t + 2];
    w += a;
  }
  if (w === 0) return null;
  let n = [nx / w, ny / w, nz / w];
  const l = Math.hypot(...n);
  n = n.map((v) => v / l);
  if (n[1] < 0) n = n.map((v) => -v);
  const c = [cx / w, cy / w, cz / w];
  const rot = rotationBetween(n, [0, 1, 0]);
  const rc = [rot[0] * c[0] + rot[4] * c[1] + rot[8] * c[2], rot[1] * c[0] + rot[5] * c[1] + rot[9] * c[2], rot[2] * c[0] + rot[6] * c[1] + rot[10] * c[2]];
  // rotate about the tapped centroid, then put it at Y = 0
  return multiply(translation(c[0] - rc[0], -rc[1], c[2] - rc[2]), rot);
}

/**
 * Delta that turns a tapped wall normal axis-parallel (smallest rotation about Y).
 * @param {number[]} normal world normal of the tapped wall
 */
export function alignToWall(normal) {
  let a = Math.atan2(-normal[2], normal[0]) / DEG;
  a = ((a % 90) + 90) % 90;
  return yawCorrection(a);
}

/** Delta rotating the model 90° about Y. */
export function rotate90() {
  return rotationAxis([0, 1, 0], Math.PI / 2);
}

/**
 * Delta for the manual "Up = axis" buttons: maps the given axis to +Y.
 * @param {'+X'|'-X'|'+Y'|'-Y'|'+Z'|'-Z'} name
 */
export function upAxisDelta(name) {
  const v = { '+X': [1, 0, 0], '-X': [-1, 0, 0], '+Y': [0, 1, 0], '-Y': [0, -1, 0], '+Z': [0, 0, 1], '-Z': [0, 0, -1] }[name];
  if (!v) throw new Error(`Unknown axis ${name}`);
  return rotationBetween(v, [0, 1, 0]);
}
