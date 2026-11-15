/**
 * SVG writer for laid-out sheets (REQ-051). Units: real paper millimetres
 * (`width="297mm" height="210mm" viewBox="0 0 297 210"`). Pure: no DOM.
 */

/** Escapes XML text and drops characters XML 1.0 forbids (C0 controls except tab/LF/CR, U+FFFE/F; DEF-17). */
export function xmlEscape(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
}

const f = (v) => (Math.round(v * 1000) / 1000).toString();

/** Base64 of bytes (no DOM dependency). */
export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * @param {{w:number, h:number, prims:object[]}} sheet from layoutSheet
 * @param {Object<string, {jpeg:Uint8Array}>} [images] raster images by key (JPEG bytes)
 * @returns {string}
 */
export function sheetToSvg(sheet, images = {}) {
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(sheet.w)}mm" height="${f(sheet.h)}mm" viewBox="0 0 ${f(sheet.w)} ${f(sheet.h)}">`,
    `<rect x="0" y="0" width="${f(sheet.w)}" height="${f(sheet.h)}" fill="#FFFFFF"/>`,
  ];
  out.push(primsToSvg(sheet.prims, images));
  out.push('</svg>');
  return out.join('\n');
}

/** Screen line width in CSS px for a paper width in mm (cut lines ≥ 2 px, REQ-028). */
export const screenWidthPx = (mm) => Math.max(1, mm * 4);

/**
 * SVG elements for primitives. In `screen` mode strokes do not scale with zoom
 * (in-app viewer) and images may use a ready `href` (data URL).
 * @param {object[]} prims
 * @param {Object<string, {jpeg?:Uint8Array, href?:string}>} images
 * @param {{screen?:boolean}} [opts]
 */
export function primsToSvg(prims, images = {}, opts = {}) {
  const out = [];
  for (const p of prims) {
    if (p.t === 'path') out.push(pathEl(p, opts.screen));
    else if (p.t === 'text') out.push(textEl(p));
    else if (p.t === 'image') {
      const img = images[p.key];
      const href = img && (img.href || (img.jpeg && `data:image/jpeg;base64,${toBase64(img.jpeg)}`));
      if (!href) continue;
      out.push(`<image x="${f(p.x)}" y="${f(p.y)}" width="${f(p.w)}" height="${f(p.h)}" preserveAspectRatio="none" href="${href}"/>`);
    }
  }
  return out.join('\n');
}

function pathEl(p, screen = false) {
  let d = '';
  for (let i = 0; i < p.pts.length; i += 2) d += `${i === 0 ? 'M' : 'L'}${f(p.pts[i])} ${f(p.pts[i + 1])}`;
  if (p.closed) d += 'Z';
  const attrs = [`d="${d}"`, `fill="${p.fill || 'none'}"`];
  if (p.stroke && p.width > 0) {
    attrs.push(`stroke="${p.stroke}"`, `stroke-width="${f(screen ? screenWidthPx(p.width) : p.width)}"`, 'stroke-linejoin="round"', 'stroke-linecap="round"');
    if (p.dash) attrs.push(`stroke-dasharray="${p.dash.map((d) => f(screen ? d * 4 : d)).join(' ')}"`);
    if (screen) attrs.push('vector-effect="non-scaling-stroke"');
  } else attrs.push('stroke="none"');
  if (p.cls) attrs.push(`class="${p.cls}"`);
  if (p.ref) attrs.push(`data-ref="${xmlEscape(p.ref)}"`);
  return `<path ${attrs.join(' ')}/>`;
}

function textEl(p) {
  const rot = p.angle ? ` transform="rotate(${f(p.angle)} ${f(p.x)} ${f(p.y)})"` : '';
  const weight = p.bold ? ' font-weight="bold"' : '';
  const cls = p.cls ? ` class="${p.cls}"` : '';
  return `<text x="${f(p.x)}" y="${f(p.y)}" font-family="Helvetica, Arial, sans-serif" font-size="${f(p.size)}" text-anchor="${p.anchor}" fill="${p.fill}"${weight}${rot}${cls}>${xmlEscape(p.text)}</text>`;
}
