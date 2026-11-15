/**
 * DOM helpers: element factory, toolbar buttons, modal dialogs, toast, progress overlay.
 * Browser-only UI module.
 */
import { icon } from './icons.js';

/**
 * Creates an element. `attrs` keys starting with "on" become listeners; `html` sets innerHTML.
 * @param {string} tag
 * @param {object} [attrs]
 * @param {Array<Node|string>|Node|string} [children]
 */
export function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'class') e.className = v;
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c !== null && c !== undefined) e.append(c);
  return e;
}

/**
 * Toolbar button with icon + text label (REQ-062).
 * @param {string} iconName
 * @param {string} label
 * @param {()=>void} onClick
 * @param {object} [extra] extra attributes
 */
export function toolButton(iconName, label, onClick, extra = {}) {
  const b = el('button', { type: 'button', class: `btn ${extra.class || ''}`, 'aria-label': label, onclick: onClick, ...extra }, []);
  b.innerHTML = `${icon(iconName)}<span>${escapeHtml(label)}</span>`;
  return b;
}

/** @param {string} s */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const root = () => document.getElementById('overlay-root');

/**
 * Bottom-sheet modal. Resolves with the clicked action's value (or null on backdrop tap).
 * @param {{title:string, body?:Node|string, actions?:Array<{label:string, value:any, primary?:boolean, danger?:boolean}>, validate?:(value:any)=>string|null}} o
 * @returns {Promise<any>}
 */
export function modal(o) {
  return new Promise((resolve) => {
    const err = el('p', { class: 'error', role: 'alert' });
    const box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title }, [el('h2', {}, o.title)]);
    if (o.body) box.append(typeof o.body === 'string' ? el('p', {}, o.body) : o.body);
    box.append(err);
    const back = el('div', { class: 'modal-backdrop' }, box);
    const close = (v) => { back.remove(); resolve(v); };
    back.addEventListener('click', (e) => { if (e.target === back && o.dismissable !== false) close(null); });
    const actions = el('div', { class: 'modal-actions' });
    for (const a of o.actions || [{ label: 'OK', value: true, primary: true }]) {
      actions.append(el('button', {
        type: 'button', class: `btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}`,
        onclick: () => {
          const msg = a.value !== null && o.validate ? o.validate(a.value) : null;
          if (msg) { err.textContent = msg; return; }
          close(a.value);
        },
      }, a.label));
    }
    box.append(actions);
    root().append(back);
    const first = box.querySelector('input, select, textarea');
    if (first) setTimeout(() => first.focus(), 50);
  });
}

/** @returns {Promise<boolean>} */
export async function confirmDialog(title, text, okLabel = 'OK', danger = false) {
  return (await modal({ title, body: text, actions: [{ label: 'Cancel', value: false }, { label: okLabel, value: true, primary: !danger, danger }] })) === true;
}

/** @returns {Promise<void>} */
export async function alertDialog(title, text) {
  await modal({ title, body: text, actions: [{ label: 'OK', value: true, primary: true }] });
}

/**
 * Single text / number input dialog.
 * @param {{title:string, label:string, value?:string, decimal?:boolean, maxLength?:number, validate?:(v:string)=>string|null}} o
 * @returns {Promise<string|null>}
 */
export async function promptDialog(o) {
  const input = el('input', { class: 'input', value: o.value ?? '', maxlength: o.maxLength, inputmode: o.decimal ? 'decimal' : undefined, enterkeyhint: 'done' });
  const body = el('label', { class: 'field' }, [o.label, input]);
  const v = await modal({ title: o.title, body, actions: [{ label: 'Cancel', value: null }, { label: o.okLabel || 'OK', value: 'ok', primary: true }], validate: () => (o.validate ? o.validate(input.value) : null) });
  return v === 'ok' ? input.value : null;
}

/** Parses a decimal number accepting "," or "."; returns NaN if invalid. */
export function parseNum(s) {
  const t = String(s ?? '').trim().replace(',', '.');
  return t === '' || !/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(t) ? NaN : Number(t);
}

let toastTimer = null;
/** Short non-blocking message. */
export function toast(text, ms = 2600) {
  document.querySelector('.toast')?.remove();
  const t = el('div', { class: 'toast', role: 'status' }, text);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), ms);
}

/**
 * Progress overlay for long operations (> 300 ms). Updates its display at least every 250 ms.
 * @param {string} title
 * @param {(()=>void)|null} onCancel
 */
export function progressOverlay(title, onCancel) {
  const bar = el('div');
  const track = el('div', { class: 'progress indeterminate' }, bar);
  const label = el('p', { class: 'muted' }, 'Starting…');
  const box = el('div', { class: 'modal', role: 'dialog', 'aria-label': title }, [el('h2', {}, title), track, label]);
  if (onCancel) box.append(el('div', { class: 'modal-actions' }, el('button', { type: 'button', class: 'btn', onclick: () => onCancel() }, 'Cancel')));
  const back = el('div', { class: 'modal-backdrop' }, box);
  root().append(back);
  const t0 = performance.now();
  let text = 'Working…';
  const tick = setInterval(() => { label.textContent = `${text} · ${((performance.now() - t0) / 1000).toFixed(0)} s`; }, 250);
  return {
    update(value, l) {
      if (l) text = l;
      if (value > 0 && value < 1) { track.classList.remove('indeterminate'); bar.style.width = `${Math.round(value * 100)}%`; }
    },
    close() { clearInterval(tick); back.remove(); },
  };
}

/**
 * Runs `fn` with a spinner overlay if it takes longer than 300 ms.
 * @template T
 * @param {string} title
 * @param {()=>Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withBusy(title, fn) {
  let ov = null;
  const timer = setTimeout(() => { ov = progressOverlay(title, null); }, 300);
  try { return await fn(); } finally { clearTimeout(timer); if (ov) ov.close(); }
}

/** Shows an error to the user in a dialog (message only; codes appended). */
export function showError(e, title = 'Something went wrong') {
  console.error(e);
  const msg = e && e.message ? e.message : String(e);
  return alertDialog(title, e && e.code && e.code !== 'CANCELLED' ? `${msg} (${e.code})` : msg);
}

/**
 * Segmented choice control (row of buttons).
 * @param {Array<{value:any, label:string}>} options
 * @param {any} value
 * @param {(v:any)=>void} onChange
 */
export function segmented(options, value, onChange) {
  const wrap = el('div', { class: 'row', role: 'group' });
  const render = (v) => {
    wrap.replaceChildren(...options.map((o) => el('button', {
      type: 'button', class: `btn ${o.value === v ? 'active' : ''}`, 'aria-pressed': String(o.value === v),
      onclick: () => { render(o.value); onChange(o.value); },
    }, o.label)));
  };
  render(value);
  return wrap;
}
