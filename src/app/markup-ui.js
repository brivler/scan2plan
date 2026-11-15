/**
 * Markup dialogs (REQ-040, REQ-042): new wall parameters, element editing, markup list.
 * Browser-only.
 */
import { el, modal, segmented, parseNum, escapeHtml } from './ui.js';
import { NEW_WALL_PRESETS, NOTE_MAX, markupQuantities, validateMarkup } from '../core/markup.js';

const fmt = (v, d = 2) => (v === null || v === undefined ? '–' : v.toFixed(d));

/**
 * Thickness + alignment for a new wall (presets 11.5 / 17.5 / 24 / 30 / 36.5 cm or custom 1–100 cm).
 * @param {{thickness?:number, align?:string}} [init]
 * @returns {Promise<{thickness:number, align:string, note:string}|null>}
 */
export async function newWallDialog(init = {}) {
  let thickness = init.thickness ?? 0.115, align = init.align ?? 'center';
  const custom = el('input', { class: 'input', inputmode: 'decimal', value: (thickness * 100).toFixed(1), 'aria-label': 'Thickness in cm' });
  const note = el('input', { class: 'input', maxlength: NOTE_MAX, 'aria-label': 'Note' });
  const body = el('div', {}, [
    el('label', { class: 'field' }, ['Thickness (German masonry sizes)', segmented(NEW_WALL_PRESETS.map((t) => ({ value: t, label: `${+(t * 100).toFixed(1)}` })), thickness, (v) => { thickness = v; custom.value = (v * 100).toFixed(1); })]),
    el('label', { class: 'field' }, ['Thickness in cm (1–100)', custom]),
    el('label', { class: 'field' }, ['Alignment to the drawn line', segmented([{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }], align, (v) => { align = v; })]),
    el('label', { class: 'field' }, ['Note (optional)', note]),
  ]);
  const ok = await modal({
    title: 'New wall (Neubau)', body,
    actions: [{ label: 'Cancel', value: null }, { label: 'Add wall', value: true, primary: true }],
    validate: () => { const v = parseNum(custom.value); return v >= 1 && v <= 100 ? null : 'Thickness must be between 1 and 100 cm.'; },
  });
  if (!ok) return null;
  return { thickness: Math.round(parseNum(custom.value) * 10) / 1000, align, note: note.value.trim() };
}

/**
 * Edits a markup element. Resolves with {patch} / {remove:true} / null.
 * @param {object} a annotation
 */
export async function editMarkupDialog(a) {
  const body = el('div');
  const note = el('input', { class: 'input', maxlength: NOTE_MAX, value: a.note || '' });
  const fields = { note };
  if (a.type === 'demolition') {
    fields.height = el('input', { class: 'input', inputmode: 'decimal', value: a.height !== undefined ? (a.height * 100).toFixed(1) : '' });
    body.append(el('label', { class: 'field' }, ['Height in cm (floor to ceiling)', fields.height]));
  }
  if (!a.polygon) {
    fields.thickness = el('input', { class: 'input', inputmode: 'decimal', value: (a.thickness * 100).toFixed(1) });
    body.append(el('label', { class: 'field' }, ['Thickness in cm', fields.thickness]));
  }
  body.append(el('label', { class: 'field' }, ['Note (max. 200 characters)', note]));
  const q = markupQuantities(a);
  body.append(el('p', { class: 'muted' }, `Length ${fmt(q.length * 100, 0)} cm${q.area !== null ? ` · Area ${fmt(q.area)} m²` : ''}${q.volume !== null ? ` · Volume ${fmt(q.volume, 3)} m³` : ''}`));
  const actions = [{ label: 'Delete', value: 'delete', danger: true }];
  if (!a.polygon) actions.push({ label: 'Flip side', value: 'flip' });
  actions.push({ label: 'Save', value: 'save', primary: true });
  let patch = null;
  const v = await modal({
    title: a.type === 'demolition' ? 'Demolition (Abbruch)' : 'New wall (Neubau)', body, actions,
    validate: (val) => {
      if (val !== 'save') return null;
      patch = { note: note.value.trim() };
      if (fields.height) {
        const h = parseNum(fields.height.value);
        if (fields.height.value.trim() !== '') { if (!(h > 0)) return 'Enter the height in cm.'; patch.height = h / 100; }
      }
      if (fields.thickness) patch.thickness = parseNum(fields.thickness.value) / 100;
      try { validateMarkup({ ...a, ...patch }); } catch (e) { return e.message; }
      return null;
    },
  });
  if (v === 'delete') return { remove: true };
  if (v === 'flip') return a.type === 'new' ? { patch: { align: a.align === 'left' ? 'right' : a.align === 'right' ? 'left' : 'center', a: a.b, b: a.a } } : { patch: { side: a.side === -1 ? 1 : -1 } };
  if (v === 'save') return { patch };
  return null;
}

/**
 * Markup list with totals per type (REQ-042).
 * @param {object[]} annotations
 * @returns {Promise<'csv'|null>}
 */
export async function markupListDialog(annotations) {
  const items = annotations.filter((a) => a.type === 'demolition' || a.type === 'new');
  const rows = [];
  const totals = {};
  for (const a of items) {
    const q = markupQuantities(a);
    rows.push(`<tr><td>${a.type === 'demolition' ? 'Abbruch' : 'Neu'}</td><td class="num">${fmt(q.length)}</td><td class="num">${fmt(q.area)}</td><td class="num">${fmt(q.volume, 3)}</td><td>${escapeHtml(a.note || '')}</td></tr>`);
    const t = (totals[a.type] ||= { l: 0, a: 0, v: 0 });
    t.l += q.length; t.a += q.area || 0; t.v += q.volume || 0;
  }
  for (const [k, t] of Object.entries(totals)) rows.push(`<tr><th>Total ${k === 'demolition' ? 'Abbruch' : 'Neu'}</th><th class="num">${fmt(t.l)}</th><th class="num">${fmt(t.a)}</th><th class="num">${fmt(t.v, 3)}</th><th></th></tr>`);
  const body = el('div', { html: items.length ? `<table class="list"><thead><tr><th>Type</th><th class="num">Length m</th><th class="num">Area m²</th><th class="num">Vol. m³</th><th>Note</th></tr></thead><tbody>${rows.join('')}</tbody></table>` : '<p class="muted">No markup yet. Use Demolish or New wall in the plan.</p>' });
  return modal({ title: 'Markup list', body, actions: [{ label: 'Close', value: null }, ...(items.length ? [{ label: 'Export CSV', value: 'csv', primary: true }] : [])] });
}
