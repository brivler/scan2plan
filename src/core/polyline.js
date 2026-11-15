/**
 * 2D polyline utilities: welding/chaining of segments, Douglas–Peucker, orthogonal snapping,
 * metrics. A polyline is `{pts: number[] (flat x,y,…), closed: boolean}`; closed rings do not
 * repeat the first point. Pure: no DOM, no three.js.
 */

const KEY_OFFSET = 2 ** 25;

/**
 * Welds segment endpoints within `tol` and chains them into polylines.
 * @param {Float64Array|number[]} segs flat [x0,y0,x1,y1, …]
 * @param {number} count number of segments
 * @param {number} tol weld tolerance (m)
 * @returns {Array<{pts:number[], closed:boolean}>}
 */
export function chainSegments(segs, count, tol = 0.001) {
  const grid = new Map();
  const nodes = [];
  const nodeOf = (x, y) => {
    const ix = Math.floor(x / tol), iy = Math.floor(y / tol);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const list = grid.get((ix + dx + KEY_OFFSET) * 2 ** 26 + (iy + dy + KEY_OFFSET));
      if (!list) continue;
      for (const n of list) if (Math.abs(nodes[2 * n] - x) <= tol && Math.abs(nodes[2 * n + 1] - y) <= tol) return n;
    }
    const id = nodes.length / 2;
    nodes.push(x, y);
    const key = (ix + KEY_OFFSET) * 2 ** 26 + (iy + KEY_OFFSET);
    const l = grid.get(key);
    if (l) l.push(id); else grid.set(key, [id]);
    return id;
  };
  const ea = [], eb = [];
  const adj = [];
  const seen = new Set();
  for (let s = 0; s < count; s++) {
    const a = nodeOf(segs[4 * s], segs[4 * s + 1]), b = nodeOf(segs[4 * s + 2], segs[4 * s + 3]);
    if (a === b) continue;
    const k = a < b ? a * 1e8 + b : b * 1e8 + a;
    if (seen.has(k)) continue;
    seen.add(k);
    const e = ea.length;
    ea.push(a); eb.push(b);
    (adj[a] ||= []).push(e);
    (adj[b] ||= []).push(e);
  }
  const used = new Uint8Array(ea.length);
  const out = [];
  const walk = (start) => {
    const idx = [start];
    let cur = start;
    for (;;) {
      const e = (adj[cur] || []).find((x) => !used[x]);
      if (e === undefined) break;
      used[e] = 1;
      cur = ea[e] === cur ? eb[e] : ea[e];
      if (cur === start) return { idx, closed: true };
      idx.push(cur);
    }
    return { idx, closed: false };
  };
  const emit = ({ idx, closed }) => {
    if (idx.length < 2) return;
    const pts = [];
    for (const n of idx) pts.push(nodes[2 * n], nodes[2 * n + 1]);
    out.push({ pts, closed: closed && idx.length >= 3 });
  };
  for (let n = 0; n < adj.length; n++) {
    if (adj[n] && adj[n].length !== 2) while (adj[n].some((e) => !used[e])) emit(walk(n));
  }
  for (let n = 0; n < adj.length; n++) {
    if (adj[n]) while (adj[n].some((e) => !used[e])) emit(walk(n));
  }
  return joinOpenChains(out, 3 * tol);
}

/**
 * Joins open chains whose end points meet (within `tol`) and closes chains whose ends meet.
 * Junction nodes (degree ≠ 2, caused by welding near-coincident points) otherwise split rings.
 * @param {Array<{pts:number[], closed:boolean}>} chains
 * @param {number} tol
 */
export function joinOpenChains(chains, tol) {
  const closed = chains.filter((c) => c.closed);
  let open = chains.filter((c) => !c.closed);
  const near = (p, i, q, j) => Math.abs(p[i] - q[j]) <= tol && Math.abs(p[i + 1] - q[j + 1]) <= tol;
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let a = 0; a < open.length; a++) {
      for (let b = a + 1; b < open.length; b++) {
        const A = open[a].pts, B = open[b].pts;
        const ae = A.length - 2, be = B.length - 2;
        let pts = null;
        if (near(A, ae, B, 0)) pts = A.concat(B.slice(2));
        else if (near(B, be, A, 0)) pts = B.concat(A.slice(2));
        else if (near(A, ae, B, be)) pts = A.concat(reversePts(B).slice(2));
        else if (near(A, 0, B, 0)) pts = reversePts(A).concat(B.slice(2));
        if (pts) {
          open[a] = { pts, closed: false };
          open.splice(b, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  open = open.map((c) => {
    const e = c.pts.length - 2;
    if (c.pts.length >= 8 && near(c.pts, 0, c.pts, e)) return { pts: c.pts.slice(0, e), closed: true };
    return c;
  });
  return closed.concat(open);
}

function reversePts(p) {
  const out = [];
  for (let i = p.length - 2; i >= 0; i -= 2) out.push(p[i], p[i + 1]);
  return out;
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Douglas–Peucker on an open point list (flat array). */
function dpOpen(pts, eps) {
  const n = pts.length / 2;
  if (n <= 2) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distToSeg(pts[2 * i], pts[2 * i + 1], pts[2 * a], pts[2 * a + 1], pts[2 * b], pts[2 * b + 1]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[2 * i], pts[2 * i + 1]);
  return out;
}

/**
 * Douglas–Peucker simplification (closed rings split at two extreme vertices).
 * @param {{pts:number[], closed:boolean}} poly
 * @param {number} eps tolerance (m)
 */
export function simplify(poly, eps) {
  if (eps <= 0) return { pts: poly.pts.slice(), closed: poly.closed };
  if (!poly.closed) return { pts: dpOpen(poly.pts, eps), closed: false };
  const p = poly.pts, n = p.length / 2;
  if (n < 4) return { pts: p.slice(), closed: true };
  const far = (k) => {
    let best = 0, bd = -1;
    for (let i = 0; i < n; i++) {
      const d = (p[2 * i] - p[2 * k]) ** 2 + (p[2 * i + 1] - p[2 * k + 1]) ** 2;
      if (d > bd) { bd = d; best = i; }
    }
    return best;
  };
  let a = far(0), b = far(a);
  if (a > b) [a, b] = [b, a];
  const first = [], second = [];
  for (let i = a; i <= b; i++) first.push(p[2 * i], p[2 * i + 1]);
  for (let i = b; i <= a + n; i++) second.push(p[2 * (i % n)], p[2 * (i % n) + 1]);
  const s1 = dpOpen(first, eps), s2 = dpOpen(second, eps);
  const pts = s1.concat(s2.slice(2, s2.length - 2));
  return { pts, closed: pts.length >= 6 };
}

/**
 * Snaps segments within `tolDeg` of the X or Y axis to be exactly axis-parallel and
 * recomputes vertices as line intersections.
 * @param {{pts:number[], closed:boolean}} poly
 * @param {number} [tolDeg]
 */
export function orthoSnap(poly, tolDeg = 3) {
  const p = poly.pts, n = p.length / 2;
  const ns = poly.closed ? n : n - 1;
  if (ns < 1) return { pts: p.slice(), closed: poly.closed };
  const tan = Math.tan((tolDeg * Math.PI) / 180);
  const lines = [];
  for (let i = 0; i < ns; i++) {
    const j = (i + 1) % n;
    const ax = p[2 * i], ay = p[2 * i + 1], bx = p[2 * j], by = p[2 * j + 1];
    const dx = bx - ax, dy = by - ay;
    if (Math.abs(dy) <= tan * Math.abs(dx)) lines.push({ px: (ax + bx) / 2, py: (ay + by) / 2, dx: 1, dy: 0 });
    else if (Math.abs(dx) <= tan * Math.abs(dy)) lines.push({ px: (ax + bx) / 2, py: (ay + by) / 2, dx: 0, dy: 1 });
    else { const l = Math.hypot(dx, dy); lines.push({ px: ax, py: ay, dx: dx / l, dy: dy / l }); }
  }
  const project = (L, x, y) => {
    const t = (x - L.px) * L.dx + (y - L.py) * L.dy;
    return [L.px + t * L.dx, L.py + t * L.dy];
  };
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = p[2 * i], y = p[2 * i + 1];
    const prev = poly.closed ? lines[(i - 1 + ns) % ns] : lines[i - 1];
    const next = poly.closed ? lines[i % ns] : lines[i];
    if (!prev || !next) { const q = project(prev || next, x, y); out.push(q[0], q[1]); continue; }
    const det = prev.dx * next.dy - prev.dy * next.dx;
    if (Math.abs(det) < 0.02) { // nearly parallel: average projections
      const a = project(prev, x, y), b = project(next, x, y);
      out.push((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      continue;
    }
    const t = ((next.px - prev.px) * next.dy - (next.py - prev.py) * next.dx) / det;
    out.push(prev.px + t * prev.dx, prev.py + t * prev.dy);
  }
  return { pts: out, closed: poly.closed };
}

/** @param {{pts:number[], closed:boolean}} poly */
export function polylineLength(poly) {
  const p = poly.pts, n = p.length / 2;
  let s = 0;
  for (let i = 0; i + 1 < n; i++) s += Math.hypot(p[2 * i + 2] - p[2 * i], p[2 * i + 3] - p[2 * i + 1]);
  if (poly.closed && n > 2) s += Math.hypot(p[0] - p[2 * n - 2], p[1] - p[2 * n - 1]);
  return s;
}

/** Signed area (counter-clockwise positive) of a ring. @param {number[]} pts */
export function signedArea(pts) {
  let s = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += pts[2 * i] * pts[2 * j + 1] - pts[2 * j] * pts[2 * i + 1];
  }
  return s / 2;
}

/** Even–odd point-in-polygon test. @param {number[]} pts ring */
export function pointInPolygon(x, y, pts) {
  let inside = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[2 * i], yi = pts[2 * i + 1], xj = pts[2 * j], yj = pts[2 * j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Bounding box of many polylines. @returns {{minX,minY,maxX,maxY}|null} */
export function polylinesBBox(polys) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pl of polys) for (let i = 0; i < pl.pts.length; i += 2) {
    const x = pl.pts[i], y = pl.pts[i + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

/**
 * Straight segments of polylines as {ax,ay,bx,by,poly,index}.
 * @param {Array<{pts:number[], closed:boolean}>} polys
 */
export function segmentsOf(polys) {
  const out = [];
  polys.forEach((pl, pi) => {
    const n = pl.pts.length / 2, ns = pl.closed ? n : n - 1;
    for (let i = 0; i < ns; i++) {
      const j = (i + 1) % n;
      out.push({ ax: pl.pts[2 * i], ay: pl.pts[2 * i + 1], bx: pl.pts[2 * j], by: pl.pts[2 * j + 1], poly: pi, index: i });
    }
  });
  return out;
}

/** Distance from point to segment (exported helper). */
export { distToSeg };
