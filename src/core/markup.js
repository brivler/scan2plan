/**
 * Renovation markup geometry and quantities (REQ-040, REQ-042).
 * Annotation shapes (plan coordinates, metres):
 *  - demolition: {type:'demolition', a, b, thickness, side, height, note} or {type:'demolition', polygon, height, thickness, note}
 *  - new:        {type:'new', a, b, thickness, align:'left'|'center'|'right', note} or {type:'new', polygon, note}
 * Pure: no DOM, no three.js.
 */
import { signedArea } from './polyline.js';

/** German masonry wall thicknesses (m). */
export const NEW_WALL_PRESETS = [0.115, 0.175, 0.24, 0.30, 0.365];
export const NOTE_MAX = 200;

/**
 * Validates and normalises a markup annotation; throws an Error with a user-facing message.
 * @param {object} m
 */
export function validateMarkup(m) {
  if (m.type !== 'demolition' && m.type !== 'new') throw new Error('Unknown markup type.');
  if (m.note && m.note.length > NOTE_MAX) throw new Error(`Note is limited to ${NOTE_MAX} characters.`);
  if (m.polygon) {
    if (m.polygon.length < 6) throw new Error('A polygon needs at least 3 points.');
  } else {
    if (!m.a || !m.b || Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]) < 0.01) throw new Error('Line is too short.');
    if (!(m.thickness >= 0.01 && m.thickness <= 1)) throw new Error('Thickness must be between 1 and 100 cm.');
  }
  if (m.type === 'demolition' && m.height !== undefined && !(m.height > 0 && m.height < 20)) throw new Error('Height must be between 0 and 20 m.');
  return m;
}

/**
 * Footprint polygon (flat x,y ring) of a line-based markup element.
 * Demolition: rectangle from the line towards `side` (+1 = left of a→b).
 * New: rectangle aligned left / center / right of the drawn line.
 * @param {object} m
 * @returns {number[]}
 */
export function markupPolygon(m) {
  if (m.polygon) return m.polygon.slice();
  const dx = m.b[0] - m.a[0], dy = m.b[1] - m.a[1], l = Math.hypot(dx, dy);
  const nx = -dy / l, ny = dx / l, t = m.thickness;
  let o0, o1;
  if (m.type === 'new') {
    if (m.align === 'left') { o0 = 0; o1 = t; } else if (m.align === 'right') { o0 = -t; o1 = 0; } else { o0 = -t / 2; o1 = t / 2; }
  } else { const s = m.side === -1 ? -1 : 1; o0 = 0; o1 = s * t; }
  return [
    m.a[0] + nx * o0, m.a[1] + ny * o0, m.b[0] + nx * o0, m.b[1] + ny * o0,
    m.b[0] + nx * o1, m.b[1] + ny * o1, m.a[0] + nx * o1, m.a[1] + ny * o1,
  ];
}

/**
 * Quantities: length (m), and for demolition area = length × height (m²) and
 * volume = area × thickness (m³). Polygons use their longest edge as length and
 * area·height as volume.
 * @param {object} m
 * @returns {{length:number, height:number|null, area:number|null, thickness:number|null, volume:number|null}}
 */
export function markupQuantities(m) {
  let length, footprint = null;
  if (m.polygon) {
    const p = m.polygon, n = p.length / 2;
    length = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; length = Math.max(length, Math.hypot(p[2 * j] - p[2 * i], p[2 * j + 1] - p[2 * i + 1])); }
    footprint = Math.abs(signedArea(p));
  } else length = Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]);
  if (m.type !== 'demolition') return { length, height: null, area: null, thickness: m.thickness ?? null, volume: null };
  const height = m.height ?? null;
  if (footprint !== null) return { length, height, area: footprint, thickness: null, volume: height !== null ? footprint * height : null };
  const area = height !== null ? length * height : null;
  return { length, height, area, thickness: m.thickness ?? null, volume: area !== null && m.thickness ? area * m.thickness : null };
}

const LABEL = { demolition: 'Demolition (Abbruch)', new: 'New (Neubau)' };

/**
 * Scales all annotation coordinates about the origin (DEF-06): used when the calibration
 * changes, because the mesh is scaled about the origin too. Scanned heights scale as well;
 * user-entered real values (thickness, excavation level/depth) do not.
 * @param {object[]} annotations
 * @param {number} ratio new scale / old scale
 * @returns {object[]} new array
 */
export function scaleAnnotations(annotations, ratio) {
  if (ratio === 1) return annotations;
  const sc = (v) => (Array.isArray(v) ? v.map((x) => x * ratio) : v);
  return annotations.map((a) => {
    const out = { ...a };
    for (const k of ['a', 'b', 'seg', 'polygon', 'at']) if (out[k]) out[k] = sc(out[k]);
    if (typeof out.height === 'number') out.height *= ratio;
    return out;
  });
}

/** German number format with decimal comma. */
function de(v, digits) {
  return v === null || v === undefined ? '' : v.toFixed(digits).replace('.', ',');
}

/**
 * Markup list as CSV for German spreadsheets: UTF-8 with BOM, ';' separator, decimal comma.
 * @param {object[]} items markup annotations
 */
export function markupCsv(items) {
  const rows = [['Type', 'Length (m)', 'Height (m)', 'Area (m²)', 'Thickness (m)', 'Volume (m³)', 'Note']];
  const totals = {};
  for (const m of items.filter((x) => x.type === 'demolition' || x.type === 'new')) {
    const q = markupQuantities(m);
    rows.push([LABEL[m.type], de(q.length, 2), de(q.height, 2), de(q.area, 2), de(q.thickness, 3), de(q.volume, 3), csvText(m.note || '')]);
    const t = (totals[m.type] ||= { length: 0, area: 0, volume: 0 });
    t.length += q.length; t.area += q.area || 0; t.volume += q.volume || 0;
  }
  for (const [type, t] of Object.entries(totals)) rows.push([`Total ${LABEL[type]}`, de(t.length, 2), '', de(t.area, 2), '', de(t.volume, 3), '']);
  return '﻿' + rows.map((r) => r.join(';')).join('\r\n') + '\r\n';
}

function csvText(s) {
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
