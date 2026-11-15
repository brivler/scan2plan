/**
 * Minimal single-page vector PDF 1.4 writer (REQ-052): paths, fills, dash patterns,
 * Helvetica / Helvetica-Bold with WinAnsiEncoding, JPEG images via DCTDecode.
 * Exact scale: 1 paper mm = 72/25.4 pt. Pure: no DOM, no PDF library.
 */

const PT = 72 / 25.4;
// Helvetica advance widths (1/1000 em) for ASCII 32…126 (Adobe AFM).
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const WIN_ANSI_EXTRA = { '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '−': 0x2d };

/**
 * Encodes a JS string to WinAnsi bytes (unsupported characters become '?').
 * @param {string} s
 * @returns {number[]}
 */
export function winAnsi(s) {
  const out = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (WIN_ANSI_EXTRA[ch] !== undefined) out.push(WIN_ANSI_EXTRA[ch]);
    else if ((c >= 32 && c <= 126) || (c >= 0xa0 && c <= 0xff)) out.push(c);
    else out.push(63);
  }
  return out;
}

/** Approximate text width in mm. */
export function textWidthMm(s, sizeMm, bold = false) {
  let w = 0;
  for (const b of winAnsi(s)) w += b >= 32 && b <= 126 ? HELV[b - 32] : 556;
  return (w / 1000) * sizeMm * (bold ? 1.06 : 1);
}

/** Reads width/height/components from a JPEG SOF marker. */
export function jpegInfo(bytes) {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8], components: bytes[i + 9] };
    }
    i += 2 + len;
  }
  throw new Error('Invalid JPEG image');
}

const n = (v) => (Math.round(v * 1000) / 1000).toString();
function color(hex) {
  const v = parseInt(hex.slice(1), 16);
  return `${n(((v >> 16) & 255) / 255)} ${n(((v >> 8) & 255) / 255)} ${n((v & 255) / 255)}`;
}
function pdfString(s) {
  return winAnsi(s).map((b) => (b === 40 || b === 41 || b === 92 ? `\\${String.fromCharCode(b)}` : b > 126 ? `\\${b.toString(8).padStart(3, '0')}` : String.fromCharCode(b))).join('');
}

/**
 * @param {{w:number, h:number, prims:object[]}} sheet from layoutSheet
 * @param {Object<string, {jpeg:Uint8Array}>} [images]
 * @returns {Uint8Array}
 */
export function sheetToPdf(sheet, images = {}) {
  const W = sheet.w * PT, H = sheet.h * PT;
  const X = (x) => n(x * PT), Y = (y) => n(H - y * PT);
  const ops = ['1 J 1 j'];
  const usedImages = [];
  for (const p of sheet.prims) {
    if (p.t === 'path') {
      const stroke = p.stroke && p.width > 0, fill = !!p.fill;
      if (!stroke && !fill) continue;
      const tag = (p.cls || 'path').replace(/[^A-Za-z0-9_-]/g, '_');
      ops.push(`/${tag} BMC`);
      if (stroke) ops.push(`${n(p.width * PT)} w ${color(p.stroke)} RG [${(p.dash || []).map((d) => n(d * PT)).join(' ')}] 0 d`);
      if (fill) ops.push(`${color(p.fill)} rg`);
      let d = '';
      for (let i = 0; i < p.pts.length; i += 2) d += `${X(p.pts[i])} ${Y(p.pts[i + 1])} ${i === 0 ? 'm' : 'l'} `;
      if (p.closed) d += 'h ';
      ops.push(d + (fill && stroke ? 'B' : fill ? 'f' : 'S'));
      ops.push('EMC');
    } else if (p.t === 'text') {
      const size = p.size * PT;
      const wmm = textWidthMm(p.text, p.size, p.bold);
      const shift = p.anchor === 'middle' ? wmm / 2 : p.anchor === 'end' ? wmm : 0;
      const a = (-(p.angle || 0) * Math.PI) / 180; // SVG clockwise (y down) → PDF counter-clockwise
      const c = Math.cos(a), s = Math.sin(a);
      const x = p.x * PT - shift * PT * c, y = H - p.y * PT - shift * PT * s;
      ops.push(`BT /${p.bold ? 'F2' : 'F1'} ${n(size)} Tf ${color(p.fill || '#000000')} rg ${n(c)} ${n(s)} ${n(-s)} ${n(c)} ${n(x)} ${n(y)} Tm (${pdfString(p.text)}) Tj ET`);
    } else if (p.t === 'image') {
      const img = images[p.key];
      if (!img || !img.jpeg) continue;
      let idx = usedImages.indexOf(img);
      if (idx < 0) { idx = usedImages.length; usedImages.push(img); }
      ops.push(`q ${n(p.w * PT)} 0 0 ${n(p.h * PT)} ${X(p.x)} ${n(H - (p.y + p.h) * PT)} cm /Im${idx} Do Q`);
    }
  }
  const content = ops.join('\n');
  const enc = new TextEncoder();
  const chunks = [];
  let len = 0;
  const offsets = [];
  const push = (data) => { const b = typeof data === 'string' ? latin1(data) : data; chunks.push(b); len += b.length; };
  const obj = (id, body) => { offsets[id] = len; push(`${id} 0 obj\n`); for (const part of [].concat(body)) push(part); push('\nendobj\n'); };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const imgIds = usedImages.map((_, i) => 7 + i);
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  const xo = imgIds.length ? ` /XObject << ${imgIds.map((id, i) => `/Im${i} ${id} 0 R`).join(' ')} >>` : '';
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W.toFixed(2)} ${H.toFixed(2)}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >>${xo} >> /Contents 6 0 R >>`);
  obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  obj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const cbytes = enc.encode(content);
  obj(6, [`<< /Length ${cbytes.length} >>\nstream\n`, cbytes, '\nendstream']);
  usedImages.forEach((img, i) => {
    const info = jpegInfo(img.jpeg);
    const cs = info.components === 1 ? '/DeviceGray' : info.components === 4 ? '/DeviceCMYK' : '/DeviceRGB';
    obj(imgIds[i], [`<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`, img.jpeg, '\nendstream']);
  });
  const count = 7 + usedImages.length;
  const xref = len;
  let x = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id++) x += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  push(x);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info << /Producer (Scan2Plan) >> >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

function latin1(s) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255;
  return b;
}
