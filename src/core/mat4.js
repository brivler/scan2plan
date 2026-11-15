/**
 * Minimal 4×4 matrix helpers. Matrices are column-major arrays of 16 numbers
 * (same layout as glTF and three.js `Matrix4.elements`).
 */

/** @returns {number[]} identity matrix */
export function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/**
 * a·b (apply b first, then a).
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number[]}
 */
export function multiply(a, b) {
  const r = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[c * 4 + k];
      r[c * 4 + row] = s;
    }
  }
  return r;
}

/** @param {number} x @param {number} y @param {number} z */
export function translation(x, y, z) {
  const m = identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

/** @param {number} s uniform scale */
export function scaling(s) {
  const m = identity();
  m[0] = s; m[5] = s; m[10] = s;
  return m;
}

/**
 * Rotation about a unit axis by angle (radians), right-handed.
 * @param {number[]} axis [x,y,z] unit vector
 * @param {number} angle
 */
export function rotationAxis(axis, angle) {
  const [x, y, z] = axis;
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [
    t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
    0, 0, 0, 1,
  ];
}

/**
 * Rotation that maps unit vector `from` onto unit vector `to`.
 * @param {number[]} from
 * @param {number[]} to
 */
export function rotationBetween(from, to) {
  const d = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
  if (d > 1 - 1e-12) return identity();
  if (d < -1 + 1e-12) {
    // 180°: any perpendicular axis
    const ax = Math.abs(from[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    return rotationAxis(normalize(cross(from, ax)), Math.PI);
  }
  return rotationAxis(normalize(cross(from, to)), Math.acos(Math.max(-1, Math.min(1, d))));
}

/** Composes glTF TRS into a matrix. */
export function fromTRS(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

/** Transforms a point. */
export function applyToPoint(m, p) {
  const [x, y, z] = p;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/** @param {number[]} a @param {number[]} b */
export function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** @param {number[]} a */
export function normalize(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
