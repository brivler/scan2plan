/**
 * ASCII-safe export file names (REQ-050). Pure: no DOM.
 */

const TRANSLIT = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' };

/**
 * Transliterates German umlauts and replaces every other non-[A-Za-z0-9._-] char with '_'.
 * @param {string} s
 */
export function asciiSafe(s) {
  return [...String(s)].map((c) => TRANSLIT[c] ?? c).join('').replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * `<project>_<view>_<scale>_<YYYY-MM-DD>.<ext>`
 * @param {{project:string, view:string, scale?:number|null, date:string, ext:string}} o
 */
export function exportFileName({ project, view, scale, date, ext }) {
  const parts = [asciiSafe(project || 'Scan2Plan'), asciiSafe(view)];
  if (scale) parts.push(`1-${scale}`);
  parts.push(date);
  return `${parts.join('_')}.${ext}`;
}

/** Local date as YYYY-MM-DD. @param {Date} [d] */
export function isoDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
