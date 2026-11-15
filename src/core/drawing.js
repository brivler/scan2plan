/**
 * Builds paper-independent drawings (model metres, 2D) for plan, section, elevation and terrain
 * views. Items:
 *  {k:'line', pts, closed, style}         polyline
 *  {k:'fill', pts, style}                 closed polygon with fill style
 *  {k:'text', at, text, sizeMm, anchor, style, angle?}
 *  {k:'dim', a, b, n, offsetMm, text}     dimension (DIN 406 look, drawn by the sheet renderer)
 *  {k:'image', key, x0, y0, x1, y1}       raster (bytes in drawing.images[key])
 * Pure: no DOM, no three.js.
 */
import { planDimensions, formatCm } from './dims.js';
import { markupPolygon, markupQuantities } from './markup.js';
import { formatLevel, cm1 } from './measure.js';
import { polylinesBBox, pointInPolygon } from './polyline.js';
import { heightAt } from './terrain.js';
import { TEXT_MM } from './styles.js';

/**
 * @param {{h:number, outline:Array, below?:Array, walls?:Array, openings?:Array}} plan
 * @param {object[]} annotations
 * @param {{dims?:boolean, showBelow?:boolean}} [opts]
 */
export function buildPlanDrawing(plan, annotations = [], opts = {}) {
  const items = [];
  for (const w of plan.walls || []) items.push({ k: 'fill', pts: w.polygon, style: 'poche' });
  if (opts.showBelow && plan.below) for (const p of plan.below) items.push({ k: 'line', pts: p.pts, closed: p.closed, style: 'beyond' });
  for (const p of plan.outline) items.push({ k: 'line', pts: p.pts, closed: p.closed, style: 'cut' });
  for (const w of plan.walls || []) {
    const c = centroid(w.polygon);
    items.push({ k: 'text', at: c, text: `d=${formatCm(w.thickness)}`, sizeMm: 1.8, anchor: 'middle', style: 'text' });
  }
  for (const o of plan.openings || []) {
    const mid = [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
    if (o.type === 'window') {
      const dx = o.b[0] - o.a[0], dy = o.b[1] - o.a[1], l = Math.hypot(dx, dy), nx = (-dy / l) * 0.03, ny = (dx / l) * 0.03;
      items.push({ k: 'line', pts: [o.a[0] + nx, o.a[1] + ny, o.b[0] + nx, o.b[1] + ny], closed: false, style: 'beyond' });
      items.push({ k: 'line', pts: [o.a[0] - nx, o.a[1] - ny, o.b[0] - nx, o.b[1] - ny], closed: false, style: 'beyond' });
    }
    items.push({ k: 'text', at: mid, text: `${o.type === 'door' ? 'D' : 'W'} w=${formatCm(o.width)}cm`, sizeMm: 2, anchor: 'middle', style: 'text', dy: -4 });
  }
  if (opts.dims !== false) for (const d of planDimensions(plan.outline, plan.openings)) items.push({ k: 'dim', ...d });
  let hasMarkup = false;
  for (const a of annotations) {
    if (a.type === 'demolition' || a.type === 'new') {
      hasMarkup = true;
      const poly = markupPolygon(a);
      items.push({ k: 'fill', pts: poly, style: a.type, ref: a.id });
      const q = markupQuantities(a);
      let label = `${a.type === 'demolition' ? 'Abbruch' : 'Neu'} ${formatCm(q.length)}`;
      if (q.area !== null) label += ` · ${q.area.toFixed(2)} m²`;
      if (q.volume !== null) label += ` · ${q.volume.toFixed(2)} m³`;
      if (a.note) label += ` · ${a.note}`;
      items.push({ k: 'text', at: centroid(poly), text: label, sizeMm: 1.8, anchor: 'middle', style: 'text', dy: -3 });
    } else if (a.type === 'section') {
      items.push(...sectionMarker(a));
    } else if (a.type === 'measure' && a.view === 'plan') {
      items.push({ k: 'line', pts: [...a.a, ...a.b], closed: false, style: 'measure' });
      items.push({ k: 'text', at: [(a.a[0] + a.b[0]) / 2, (a.a[1] + a.b[1]) / 2], text: cm1(Math.hypot(a.b[0] - a.a[0], a.b[1] - a.a[1])), sizeMm: 2, anchor: 'middle', style: 'text', dy: -2 });
    }
  }
  return { title: `Floor plan ${formatLevel(plan.h)}`, kind: 'plan', items, images: {}, legend: hasMarkup };
}

/** Cut line "A–A" with labels and view-direction arrows. */
function sectionMarker(s) {
  const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], l = Math.hypot(dx, dy);
  const vx = (s.side * -dy) / l, vy = (s.side * dx) / l; // viewing direction (plan)
  const items = [{ k: 'line', pts: [...s.a, ...s.b], closed: false, style: 'sectionLine', ref: s.id }];
  for (const p of [s.a, s.b]) {
    const tip = [p[0] + vx * 0.5, p[1] + vy * 0.5];
    items.push({ k: 'line', pts: [...p, ...tip], closed: false, style: 'sectionLine' });
    items.push({ k: 'text', at: [p[0] - vx * 0.25, p[1] - vy * 0.25], text: s.label, sizeMm: 3.5, anchor: 'middle', style: 'text' });
  }
  return items;
}

function centroid(pts) {
  let x = 0, y = 0;
  const n = pts.length / 2;
  for (let i = 0; i < pts.length; i += 2) { x += pts[i]; y += pts[i + 1]; }
  return [x / n, y / n];
}

/** ±0.00 line + top/bottom height labels shared by elevations and sections. */
function levelItems(bb) {
  const items = [];
  const x0 = bb.minX - 0.5, x1 = bb.maxX + 0.5;
  items.push({ k: 'line', pts: [x0, 0, x1, 0], closed: false, style: 'level' });
  items.push({ k: 'text', at: [x1 + 0.1, 0], text: '±0.00', sizeMm: TEXT_MM, anchor: 'start', style: 'text' });
  for (const y of [bb.maxY, bb.minY]) {
    if (Math.abs(y) < 0.005) continue;
    items.push({ k: 'line', pts: [bb.maxX + 0.05, y, x1, y], closed: false, style: 'beyond' });
    items.push({ k: 'text', at: [x1 + 0.1, y], text: formatLevel(y), sizeMm: TEXT_MM, anchor: 'start', style: 'text' });
  }
  return items;
}

/** Level markers placed by the user (REQ-027). */
function levelMarkers(annotations, viewId) {
  const items = [];
  for (const a of annotations) {
    if (a.type !== 'level' || a.view !== viewId) continue;
    const [x, y] = a.at;
    items.push({ k: 'line', pts: [x - 0.08, y + 0.12, x, y, x + 0.08, y + 0.12, x - 0.08, y + 0.12], closed: false, style: 'cut' });
    items.push({ k: 'text', at: [x + 0.12, y + 0.14], text: formatLevel(y), sizeMm: TEXT_MM, anchor: 'start', style: 'text' });
  }
  return items;
}

/**
 * Elevation drawing from `views.elevation()` output.
 * @param {object} v elevation result (grid, outline, edges, title)
 * @param {object[]} annotations
 * @param {string} viewId e.g. 'elev-front'
 */
export function buildElevationDrawing(v, annotations, viewId) {
  const { grid } = v;
  const items = [{ k: 'image', key: 'view', x0: grid.x0, y0: grid.y0, x1: grid.x0 + grid.w * grid.res, y1: grid.y0 + grid.h * grid.res }];
  for (const p of v.edges) items.push({ k: 'line', pts: p.pts, closed: p.closed, style: 'edge' });
  for (const p of v.outline) items.push({ k: 'line', pts: p.pts, closed: p.closed, style: 'edge' });
  const bb = polylinesBBox(v.outline);
  if (bb) items.push(...levelItems(bb));
  items.push(...levelMarkers(annotations, viewId));
  return { title: v.title, kind: 'elevation', items, images: {}, legend: false };
}

/**
 * Section drawing (REQ-026) with optional excavation profile (REQ-047).
 * @param {object} s `views.section()` output
 * @param {{label:string, a:number[], b:number[], side:number}} cut annotation
 * @param {object[]} annotations
 * @param {object|null} hm terrain height map (for excavation profiles)
 */
export function buildSectionDrawing(s, cut, annotations, hm = null) {
  const { grid } = s.beyond;
  const items = [];
  if (!s.beyond.empty) items.push({ k: 'image', key: 'view', x0: grid.x0, y0: grid.y0, x1: grid.x0 + grid.w * grid.res, y1: grid.y0 + grid.h * grid.res });
  for (const p of s.beyond.outline) items.push({ k: 'line', pts: p.pts, closed: p.closed, style: 'beyond' });
  for (const p of s.beyond.edges) items.push({ k: 'line', pts: p.pts, closed: p.closed, style: 'beyond' });
  for (const p of s.cut) items.push({ k: 'line', pts: p.pts, closed: p.closed, style: 'cut' });
  const bb = polylinesBBox(s.cut.length ? s.cut : s.beyond.outline);
  if (bb) items.push(...levelItems(bb));
  if (hm) for (const ex of annotations.filter((a) => a.type === 'excavation')) items.push(...excavationProfile(s.frame, cut, ex, hm));
  items.push(...levelMarkers(annotations, `section-${cut.label}`));
  return { title: `Section ${cut.label}–${cut.label}`, kind: 'section', items, images: {}, legend: false };
}

/**
 * Existing terrain line, target line and hatched cut area along a section line through an
 * excavation polygon (REQ-047). Section x coordinate = world·frame.u.
 */
export function excavationProfile(frame, cut, ex, hm) {
  const dx = cut.b[0] - cut.a[0], dy = cut.b[1] - cut.a[1], l = Math.hypot(dx, dy);
  const ux = dx / l, uy = dy / l;
  let t0 = Infinity, t1 = -Infinity;
  for (let k = 0; k < ex.polygon.length; k += 2) {
    const t = (ex.polygon[k] - cut.a[0]) * ux + (ex.polygon[k + 1] - cut.a[1]) * uy;
    t0 = Math.min(t0, t); t1 = Math.max(t1, t);
  }
  const step = hm.cell / 2;
  const runs = [];
  let run = null;
  for (let t = t0; t <= t1 + 1e-9; t += step) {
    const x = cut.a[0] + ux * t, y = cut.a[1] + uy * t;
    const h = heightAt(hm, x, y);
    const inside = pointInPolygon(x, y, ex.polygon) && !Number.isNaN(h);
    if (!inside) { run = null; continue; }
    const target = ex.mode === 'depth' ? h - ex.depth : ex.level;
    const s = frame.u[0] * x + frame.u[2] * -y; // section horizontal coordinate
    if (!run) { run = []; runs.push(run); }
    run.push([s, h, Math.min(h, target), target]);
  }
  const items = [];
  for (const r of runs) {
    if (r.length < 2) continue;
    items.push({ k: 'line', pts: r.flatMap((p) => [p[0], p[1]]), closed: false, style: 'excavation' });
    items.push({ k: 'line', pts: r.flatMap((p) => [p[0], p[3]]), closed: false, style: 'target' });
    const ring = [...r.flatMap((p) => [p[0], p[1]]), ...r.slice().reverse().flatMap((p) => [p[0], p[2]])];
    items.push({ k: 'fill', pts: ring, style: 'cutHatch' });
  }
  return items;
}

/**
 * Terrain drawing (REQ-045/046): height image, contours with labels, excavation polygons.
 * @param {object} hm height map
 * @param {Array<{level:number, major:boolean, polys:Array}>} lines contours
 * @param {object[]} annotations
 * @param {Object<string, object>} results excavation results by annotation id
 */
export function buildTerrainDrawing(hm, lines, annotations, results = {}) {
  const items = [{ k: 'image', key: 'view', x0: hm.x0, y0: hm.y0, x1: hm.x0 + hm.nx * hm.cell, y1: hm.y0 + hm.ny * hm.cell }];
  for (const c of lines) for (const p of c.polys) {
    items.push({ k: 'line', pts: p.pts, closed: p.closed, style: c.major ? 'contourMajor' : 'contour' });
    if (c.major && p.pts.length >= 4) items.push({ k: 'text', at: [p.pts[0], p.pts[1]], text: formatLevel(c.level), sizeMm: 1.8, anchor: 'middle', style: 'text' });
  }
  let n = 0;
  for (const a of annotations.filter((x) => x.type === 'excavation')) {
    n++;
    items.push({ k: 'line', pts: a.polygon, closed: true, style: 'excavation', ref: a.id });
    const r = results[a.id];
    const label = r ? `Excavation ${n}: ${r.area.toFixed(2)} m², cut ${r.cut.toFixed(2)} m³` : `Excavation ${n}`;
    items.push({ k: 'text', at: centroid(a.polygon), text: label, sizeMm: 2, anchor: 'middle', style: 'text' });
  }
  return { title: 'Terrain', kind: 'terrain', items, images: {}, legend: false };
}

/**
 * Model-space bounds of a drawing (dimensions excluded).
 * @returns {{minX:number, minY:number, maxX:number, maxY:number}|null}
 */
export function drawingBounds(drawing) {
  const polys = [];
  for (const it of drawing.items) {
    if (it.k === 'line' || it.k === 'fill') polys.push({ pts: it.pts });
    else if (it.k === 'image') polys.push({ pts: [it.x0, it.y0, it.x1, it.y1] });
    else if (it.k === 'dim') polys.push({ pts: [...it.a, ...it.b] });
  }
  return polylinesBBox(polys);
}
