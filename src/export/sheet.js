/**
 * Sheet layout: places a model drawing on paper at an exact scale with frame, title block
 * (REQ-053), scale bar (REQ-032) and legend (REQ-040). Output primitives are in paper
 * millimetres with y pointing down, consumed by svg.js and pdf.js.
 * Primitives:
 *  {t:'path', pts, closed, stroke, width, dash, fill, cls}
 *  {t:'text', x, y, text, size, anchor, angle, fill, bold}
 *  {t:'image', x, y, w, h, key}
 * Pure: no DOM, no three.js.
 */
import { resolveStyle, DIM_TICK_MM, LINE_DIM_MM, LINE_BEYOND_MM, STYLES } from '../core/styles.js';
import { drawingBounds } from '../core/drawing.js';
import { calibrationText } from '../core/measure.js';

export const PAPERS = Object.freeze({ A4: [210, 297], A3: [297, 420] });
export const SCALES = Object.freeze([20, 25, 50, 100, 200, 500]);
export const MARGIN_LEFT_MM = 20, MARGIN_MM = 10;
export const TITLE_W_MM = 180, TITLE_H_MM = 30;
const STRIP_MM = 14; // scale bar + legend strip above the title block
const DIM_MARGIN_MM = 22, PLAIN_MARGIN_MM = 14;
export const ACCURACY_NOTE = 'Dimensions from LiDAR scan, typical tolerance ±2 cm (facades/terrain ±5 cm). Verify on site before construction.';

/** Scale-bar tick values (m) per scale; bar length 40–100 mm on paper. */
const SCALE_BARS = { 20: [0, 0.2, 0.5, 1], 25: [0, 0.25, 0.5, 1], 50: [0, 0.5, 1, 2], 100: [0, 1, 2, 5], 200: [0, 2, 5, 10], 500: [0, 5, 10, 20], 1000: [0, 10, 20, 50] };

/**
 * Paper size in mm for a paper name and orientation.
 * @param {'A4'|'A3'} paper
 * @param {'landscape'|'portrait'} orientation
 */
export function paperSize(paper, orientation) {
  const p = PAPERS[paper];
  if (!p) throw new Error(`Unknown paper ${paper}`);
  return orientation === 'portrait' ? { w: p[0], h: p[1] } : { w: p[1], h: p[0] };
}

/** Frame, title block and model area rectangles (mm). */
export function sheetGeometry(paper, orientation) {
  const { w, h } = paperSize(paper, orientation);
  const frame = { x: MARGIN_LEFT_MM, y: MARGIN_MM, w: w - MARGIN_LEFT_MM - MARGIN_MM, h: h - 2 * MARGIN_MM };
  const tbW = Math.min(TITLE_W_MM, frame.w);
  const title = { x: frame.x + frame.w - tbW, y: frame.y + frame.h - TITLE_H_MM, w: tbW, h: TITLE_H_MM };
  const area = { x: frame.x + 2, y: frame.y + 2, w: frame.w - 4, h: title.y - STRIP_MM - frame.y - 4 };
  return { w, h, frame, title, area };
}

function contentSize(drawing, scale) {
  const b = drawingBounds(drawing);
  if (!b) return null;
  const k = 1000 / scale;
  const m = drawing.items.some((i) => i.k === 'dim') ? DIM_MARGIN_MM : PLAIN_MARGIN_MM;
  return { w: (b.maxX - b.minX) * k + 2 * m, h: (b.maxY - b.minY) * k + 2 * m, b };
}

/**
 * Largest standard scale (smallest denominator) at which the drawing fits.
 * @returns {{scale:number}|{error:string, suggest:number}}
 */
export function fitScale(drawing, paper, orientation) {
  const { area } = sheetGeometry(paper, orientation);
  for (const s of SCALES) {
    const c = contentSize(drawing, s);
    if (c && c.w <= area.w && c.h <= area.h) return { scale: s };
  }
  return { error: `Drawing does not fit ${paper} at 1:500`, suggest: 1000 };
}

/**
 * Lays out a drawing on a sheet.
 * @param {object} drawing from core/drawing.js
 * @param {{paper:'A4'|'A3', orientation:'landscape'|'portrait', scale:number, bw?:boolean,
 *          project:string, date:string, calibration?:object|null, author?:string}} o
 * @returns {{w:number, h:number, prims:object[], scale:number}}
 */
export function layoutSheet(drawing, o) {
  if (!SCALES.includes(o.scale) && o.scale !== 1000) throw new Error(`Unsupported scale 1:${o.scale}`);
  const g = sheetGeometry(o.paper, o.orientation);
  const k = 1000 / o.scale;
  const c = contentSize(drawing, o.scale) || { b: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
  const mx = (c.b.minX + c.b.maxX) / 2, my = (c.b.minY + c.b.maxY) / 2;
  const cx = g.area.x + g.area.w / 2, cy = g.area.y + g.area.h / 2;
  const prims = drawingPrims(drawing, (x) => cx + (x - mx) * k, (y) => cy - (y - my) * k, k, !!o.bw);
  prims.push({ t: 'path', pts: [g.frame.x, g.frame.y, g.frame.x + g.frame.w, g.frame.y, g.frame.x + g.frame.w, g.frame.y + g.frame.h, g.frame.x, g.frame.y + g.frame.h], closed: true, stroke: '#000000', width: 0.35, dash: null, fill: null, cls: 'frame' });
  prims.push(...scaleBarPrims(g.frame.x + 4, g.title.y - 6, o.scale));
  if (drawing.legend) prims.push(...legendPrims(g.title.x + g.title.w - 120, g.title.y - 9, !!o.bw));
  prims.push(...titleBlockPrims(g.title, drawing.title, o));
  return { w: g.w, h: g.h, prims, scale: o.scale };
}

/**
 * Primitives of the drawing items only (no frame), given model→paper mappings.
 * Used by layoutSheet and by the in-app drawing viewer.
 * @param {object} drawing
 * @param {(x:number)=>number} X model x → paper mm
 * @param {(y:number)=>number} Y model y → paper mm (y down)
 * @param {number} k paper mm per model metre
 * @param {boolean} bw black-and-white mode
 */
export function drawingPrims(drawing, X, Y, k, bw) {
  const mapPts = (pts) => pts.map((v, i) => (i % 2 === 0 ? X(v) : Y(v)));
  const prims = [];
  for (const it of drawing.items) {
    if (it.k === 'image') prims.push({ t: 'image', key: it.key, x: X(it.x0), y: Y(it.y1), w: (it.x1 - it.x0) * k, h: (it.y1 - it.y0) * k });
  }
  for (const it of drawing.items) {
    if (it.k === 'fill') prims.push(...fillPrims(mapPts(it.pts), it.style, bw).map((p) => ({ ...p, ref: it.ref })));
    else if (it.k === 'line') {
      const s = resolveStyle(it.style, bw);
      prims.push({ t: 'path', pts: mapPts(it.pts), closed: !!it.closed, stroke: s.stroke, width: s.width, dash: s.dash || null, fill: null, cls: `s-${it.style}`, ref: it.ref });
    }
  }
  for (const it of drawing.items) {
    if (it.k === 'dim') prims.push(...dimPrims([X(it.a[0]), Y(it.a[1])], [X(it.b[0]), Y(it.b[1])], [it.n[0], -it.n[1]], it.offsetMm, it.text));
    else if (it.k === 'text') prims.push({ t: 'text', x: X(it.at[0]), y: Y(it.at[1]) + (it.dy || 0), text: it.text, size: it.sizeMm, anchor: it.anchor || 'start', angle: it.angle || 0, fill: '#000000' });
  }
  return prims;
}

/** Fill polygon with style (colour, B/W cross or hatch). */
function fillPrims(pts, styleName, bw) {
  const s = resolveStyle(styleName, bw);
  const out = [{ t: 'path', pts, closed: true, stroke: s.width ? s.stroke : null, width: s.width || 0, dash: s.dash || null, fill: s.fill || null, cls: `s-${styleName}` }];
  if (s.cross) {
    const n = pts.length / 2, h = Math.floor(n / 2);
    out.push({ t: 'path', pts: [pts[0], pts[1], pts[2 * h], pts[2 * h + 1]], closed: false, stroke: s.stroke, width: s.width, dash: null, fill: null, cls: 'cross' });
    if (n >= 4) out.push({ t: 'path', pts: [pts[2], pts[3], pts[2 * ((h + 1) % n)], pts[2 * ((h + 1) % n) + 1]], closed: false, stroke: s.stroke, width: s.width, dash: null, fill: null, cls: 'cross' });
  }
  if (s.hatch) {
    for (const seg of hatchSegments(pts, s.hatch)) out.push({ t: 'path', pts: seg, closed: false, stroke: s.hatchColor || s.stroke, width: LINE_BEYOND_MM, dash: null, fill: null, cls: 'hatch' });
  }
  return out;
}

/**
 * 45° hatch lines clipped to a polygon (paper mm).
 * @param {number[]} pts ring
 * @param {number} spacing mm (perpendicular)
 * @returns {number[][]} segments [x0,y0,x1,y1]
 */
export function hatchSegments(pts, spacing) {
  const n = pts.length / 2;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { const c = pts[2 * i] + pts[2 * i + 1]; lo = Math.min(lo, c); hi = Math.max(hi, c); }
  const step = spacing * Math.SQRT2;
  const out = [];
  for (let c = Math.ceil(lo / step) * step; c <= hi; c += step) {
    // line x + y = c; intersect with all edges
    const xs = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = pts[2 * i], ay = pts[2 * i + 1], bx = pts[2 * j], by = pts[2 * j + 1];
      const fa = ax + ay - c, fb = bx + by - c;
      if ((fa > 0) === (fb > 0) || fa === fb) continue;
      const t = fa / (fa - fb);
      xs.push(ax + t * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) out.push([xs[k], c - xs[k], xs[k + 1], c - xs[k + 1]]);
  }
  return out;
}

/**
 * DIN 406 style dimension: extension lines, dimension line, 45° oblique ticks, text above.
 * @param {number[]} A paper point
 * @param {number[]} B paper point
 * @param {number[]} N unit offset direction (paper)
 */
function dimPrims(A, B, N, offsetMm, text) {
  let dx = B[0] - A[0], dy = B[1] - A[1];
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return [];
  dx /= len; dy /= len;
  const D1 = [A[0] + N[0] * offsetMm, A[1] + N[1] * offsetMm], D2 = [B[0] + N[0] * offsetMm, B[1] + N[1] * offsetMm];
  const line = (p, q, cls) => ({ t: 'path', pts: [...p, ...q], closed: false, stroke: '#000000', width: LINE_DIM_MM, dash: null, fill: null, cls });
  const out = [
    line([A[0] + N[0], A[1] + N[1]], [D1[0] + N[0] * 1.5, D1[1] + N[1] * 1.5], 'dim-ext'),
    line([B[0] + N[0], B[1] + N[1]], [D2[0] + N[0] * 1.5, D2[1] + N[1] * 1.5], 'dim-ext'),
    line([D1[0] - dx * 1.5, D1[1] - dy * 1.5], [D2[0] + dx * 1.5, D2[1] + dy * 1.5], 'dim-line'),
  ];
  // oblique tick: dimension direction rotated by 45° (towards the offset side)
  const tx = (dx + N[0]) / Math.SQRT2 * (DIM_TICK_MM / 2), ty = (dy + N[1]) / Math.SQRT2 * (DIM_TICK_MM / 2);
  for (const D of [D1, D2]) out.push({ ...line([D[0] - tx, D[1] - ty], [D[0] + tx, D[1] + ty], 'dim-tick'), width: 0.35 });
  // readable orientation: text runs left→right or bottom→top
  let rx = dx, ry = dy;
  if (rx < -1e-9 || (Math.abs(rx) <= 1e-9 && ry > 0)) { rx = -rx; ry = -ry; }
  const up = [ry, -rx];
  const angle = (Math.atan2(ry, rx) * 180) / Math.PI;
  out.push({ t: 'text', x: (D1[0] + D2[0]) / 2 + up[0] * 0.8, y: (D1[1] + D2[1]) / 2 + up[1] * 0.8, text, size: 2.5, anchor: 'middle', angle, fill: '#000000', cls: 'dim-text' });
  return out;
}

/**
 * Graphical scale bar with numeric scale; returns primitives starting at (x, y) baseline.
 * @param {number} x
 * @param {number} y
 * @param {number} scale denominator
 */
export function scaleBarPrims(x, y, scale) {
  const ticks = SCALE_BARS[scale];
  const k = 1000 / scale;
  const out = [];
  for (let i = 0; i + 1 < ticks.length; i++) {
    const x0 = x + ticks[i] * k, x1 = x + ticks[i + 1] * k;
    out.push({ t: 'path', pts: [x0, y - 1.5, x1, y - 1.5, x1, y, x0, y], closed: true, stroke: '#000000', width: 0.18, dash: null, fill: i % 2 === 0 ? '#000000' : '#FFFFFF', cls: 'scalebar' });
  }
  ticks.forEach((t, i) => out.push({ t: 'text', x: x + t * k, y: y + 3, text: i === ticks.length - 1 ? `${t} m` : String(t), size: 2, anchor: 'middle', angle: 0, fill: '#000000', cls: 'scalebar-label' }));
  out.push({ t: 'text', x: x + ticks[ticks.length - 1] * k + 8, y: y, text: `1:${scale}`, size: 3, anchor: 'start', angle: 0, fill: '#000000', bold: true, cls: 'scale-text' });
  return out;
}

function legendPrims(x, y, bw) {
  const out = [];
  const entries = [['poche', 'Existing (Bestand)'], ['demolition', 'Demolition (Abbruch)'], ['new', 'New (Neubau)']];
  entries.forEach(([style, label], i) => {
    const bx = x + i * 40;
    out.push(...fillPrims([bx, y, bx + 8, y, bx + 8, y + 4, bx, y + 4], style, bw));
    if (style === 'poche') out.push({ t: 'path', pts: [bx, y, bx + 8, y, bx + 8, y + 4, bx, y + 4], closed: true, stroke: '#000000', width: STYLES.cut.width, dash: null, fill: null, cls: 'legend' });
    out.push({ t: 'text', x: bx + 10, y: y + 3.2, text: label, size: 2.2, anchor: 'start', angle: 0, fill: '#000000', cls: 'legend' });
  });
  return out;
}

function titleBlockPrims(r, viewName, o) {
  const out = [{ t: 'path', pts: [r.x, r.y, r.x + r.w, r.y, r.x + r.w, r.y + r.h, r.x, r.y + r.h], closed: true, stroke: '#000000', width: 0.35, dash: null, fill: '#FFFFFF', cls: 'title-block' }];
  const line = (x0, y0, x1, y1) => out.push({ t: 'path', pts: [x0, y0, x1, y1], closed: false, stroke: '#000000', width: 0.18, dash: null, fill: null, cls: 'title-block' });
  const text = (x, y, s, size, bold = false) => out.push({ t: 'text', x, y, text: s, size, anchor: 'start', angle: 0, fill: '#000000', bold, cls: 'title-text' });
  line(r.x, r.y + 10, r.x + r.w, r.y + 10);
  line(r.x, r.y + 20, r.x + r.w, r.y + 20);
  text(r.x + 2, r.y + 6.5, o.project || 'Untitled project', 4, true);
  text(r.x + r.w - 28, r.y + 6.5, 'Scan2Plan', 3.5, true);
  text(r.x + 2, r.y + 14, viewName, 3, true);
  text(r.x + 2, r.y + 18.5, `Scale 1:${o.scale} · ${o.paper} ${o.orientation} · ${o.date}${o.author ? ` · ${o.author}` : ''}`, 2.2);
  text(r.x + 2, r.y + 24, calibrationText(o.calibration || null), 2);
  text(r.x + 2, r.y + 28, ACCURACY_NOTE, Math.min(1.8, (r.w - 4) / (ACCURACY_NOTE.length * 0.5)));
  return out;
}
