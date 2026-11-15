/**
 * ASCII DXF R12 writer (REQ-054). Coordinates in metres at 1:1 in the drawing's 2D frame.
 * Entities: LINE, POLYLINE/VERTEX/SEQEND, TEXT; dimensions as plain LINE + TEXT.
 * Line endings: LF throughout. Pure: no DOM.
 */
import { DXF_LAYERS, STYLES } from '../core/styles.js';

/** Paper scale assumed for text heights and dimension offsets in model space. */
const NOMINAL_SCALE = 50;

/**
 * @param {object} drawing from core/drawing.js
 * @returns {string}
 */
export function drawingToDxf(drawing) {
  const out = [];
  const g = (code, value) => out.push(String(code), String(value));
  const num = (v) => (Math.round(v * 1e6) / 1e6).toString();
  // HEADER
  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  g(9, '$INSUNITS'); g(70, 6);
  g(0, 'ENDSEC');
  // TABLES
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 2);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, '0.0');
  g(0, 'LTYPE'); g(2, 'DASHED'); g(70, 0); g(3, '__ __ __'); g(72, 65); g(73, 2); g(40, '0.225'); g(49, '0.15'); g(49, '-0.075');
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, DXF_LAYERS.length);
  for (const [name, aci] of DXF_LAYERS) {
    g(0, 'LAYER'); g(2, name); g(70, 0); g(62, aci); g(6, name === 'S2P_DEMOLITION' ? 'DASHED' : 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'BLOCKS'); g(0, 'ENDSEC');
  // ENTITIES
  g(0, 'SECTION'); g(2, 'ENTITIES');
  const line = (layer, x0, y0, x1, y1) => {
    g(0, 'LINE'); g(8, layer); g(10, num(x0)); g(20, num(y0)); g(30, 0); g(11, num(x1)); g(21, num(y1)); g(31, 0);
  };
  const poly = (layer, pts, closed) => {
    if (pts.length === 4 && !closed) { line(layer, pts[0], pts[1], pts[2], pts[3]); return; }
    g(0, 'POLYLINE'); g(8, layer); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, closed ? 1 : 0);
    for (let i = 0; i < pts.length; i += 2) { g(0, 'VERTEX'); g(8, layer); g(10, num(pts[i])); g(20, num(pts[i + 1])); g(30, 0); }
    g(0, 'SEQEND'); g(8, layer);
  };
  const text = (layer, x, y, h, s, angle = 0, center = false) => {
    g(0, 'TEXT'); g(8, layer); g(10, num(x)); g(20, num(y)); g(30, 0); g(40, num(h)); g(1, dxfText(s));
    if (angle) g(50, num(angle));
    if (center) { g(72, 1); g(11, num(x)); g(21, num(y)); g(31, 0); }
  };
  const k = NOMINAL_SCALE / 1000; // paper mm → model m
  for (const it of drawing.items) {
    if (it.k === 'line' || it.k === 'fill') poly(STYLES[it.style].layer, it.pts, it.k === 'fill' || !!it.closed);
    else if (it.k === 'text') text('S2P_TEXT', it.at[0], it.at[1], it.sizeMm * k, it.text, 0, it.anchor === 'middle');
    else if (it.k === 'dim') {
      const o = it.offsetMm * k;
      const d1 = [it.a[0] + it.n[0] * o, it.a[1] + it.n[1] * o], d2 = [it.b[0] + it.n[0] * o, it.b[1] + it.n[1] * o];
      line('S2P_DIMENSIONS', it.a[0], it.a[1], d1[0], d1[1]);
      line('S2P_DIMENSIONS', it.b[0], it.b[1], d2[0], d2[1]);
      line('S2P_DIMENSIONS', d1[0], d1[1], d2[0], d2[1]);
      let ang = (Math.atan2(d2[1] - d1[1], d2[0] - d1[0]) * 180) / Math.PI;
      if (ang > 90.001) ang -= 180; else if (ang <= -90) ang += 180;
      const mid = [(d1[0] + d2[0]) / 2, (d1[1] + d2[1]) / 2];
      const up = [-Math.sin((ang * Math.PI) / 180), Math.cos((ang * Math.PI) / 180)];
      text('S2P_DIMENSIONS', mid[0] + up[0] * 0.8 * k, mid[1] + up[1] * 0.8 * k, 2.5 * k, it.text, ang, true);
    }
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return out.join('\n') + '\n';
}

/** DXF R12 text: ASCII only; common German characters transliterated, control characters → space (DEF-07), others '?'. */
function dxfText(s) {
  const map = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss', '±': '%%p', '–': '-', '−': '-', '²': '2', '³': '3', '·': '-', '×': 'x' };
  return [...String(s)].map((c) => { const k = c.charCodeAt(0); return map[c] ?? (k < 32 || k === 127 ? ' ' : k < 128 ? c : '?'); }).join('');
}
