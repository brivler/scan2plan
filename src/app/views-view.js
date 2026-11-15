/**
 * Views tab: elevations (REQ-025), user sections (REQ-026/047), level markers (REQ-027),
 * measure (REQ-030) and export. Browser-only.
 */
import { el, toolButton, toast, showError, withBusy, promptDialog, parseNum } from './ui.js';
import { createDrawingView, K } from './drawing-view.js';
import { buildElevationDrawing, buildSectionDrawing } from '../core/drawing.js';
import { ELEVATIONS } from '../core/views.js';
import { snap2D, SNAP_2D_PX, cm1, formatLevel } from '../core/measure.js';
import { rgbaToHref } from './images.js';
import { openExport } from './export-dialog.js';

/**
 * @param {object} app
 * @param {HTMLElement} root
 */
export function createViewsView(app, root) {
  const select = el('select', { class: 'input', 'aria-label': 'View' });
  const top = el('div', { class: 'slider-row' }, [select]);
  const wrap = el('div', { class: 'canvas-wrap' });
  const hud = el('div', { class: 'hud' });
  const toolbar = el('div', { class: 'toolbar bottom' });
  root.append(top, wrap, toolbar);
  const view = createDrawingView(wrap, { onTap });
  wrap.append(hud);
  const s = () => app.session;
  let current = null; // {id, result, drawing, raster, href}
  let tool = null, picks = [];
  const cache = new Map();

  function options() {
    const opts = Object.entries(ELEVATIONS).map(([k, v]) => [`elev-${k}`, `Elevation ${v.name}`]);
    for (const a of s().annotations.filter((x) => x.type === 'section').sort((x, y) => x.label.localeCompare(y.label))) opts.push([`section-${a.label}`, `Section ${a.label}–${a.label}`]);
    const prev = select.value;
    select.replaceChildren(...opts.map(([v, l]) => el('option', { value: v }, l)));
    select.value = opts.some(([v]) => v === prev) ? prev : opts[0][0];
  }

  async function compute() {
    const id = select.value;
    try {
      let entry = cache.get(id);
      if (!entry) {
        if (id.startsWith('elev-')) {
          const r = await withBusy('Rendering elevation', () => app.client.call('elevation', { dir: id.slice(5) }));
          entry = { id, result: r, raster: { rgba: r.rgba, width: r.width, height: r.height } };
        } else {
          const cut = s().annotations.find((a) => a.type === 'section' && `section-${a.label}` === id);
          if (!cut) return;
          const r = await withBusy('Computing section', () => app.client.call('section', { a: cut.a, b: cut.b, side: cut.side, depth: s().settings.sectionDepth, simplify: s().settings.simplify }));
          entry = { id, cut, result: r, raster: r.beyond.empty ? null : { rgba: r.beyond.rgba, width: r.beyond.width, height: r.beyond.height } };
        }
        entry.href = entry.raster ? rgbaToHref(entry.raster.rgba, entry.raster.width, entry.raster.height) : null;
        cache.set(id, entry);
      }
      current = entry;
      draw(false);
    } catch (e) { showError(e); }
  }

  async function sectionTerrain() {
    if (!s().annotations.some((a) => a.type === 'excavation')) return null;
    const t = await app.client.call('terrain', { cell: s().settings.terrainCell }).catch(() => null);
    return t ? t.hm : null;
  }

  async function buildDrawing() {
    if (current.id.startsWith('elev-')) return buildElevationDrawing(current.result, s().annotations, current.id);
    if (current.hm === undefined) current.hm = await sectionTerrain();
    return buildSectionDrawing(current.result, current.cut, s().annotations, current.hm);
  }

  async function draw(keepView = true) {
    if (!current) return;
    current.drawing = await buildDrawing();
    view.setDrawing(current.drawing, current.href ? { view: { href: current.href } } : {}, { bw: s().settings.bw, keepView });
    drawOverlay();
  }

  function outlines() {
    if (!current) return [];
    const r = current.result;
    return current.id.startsWith('elev-') ? [...r.outline, ...r.edges] : [...r.cut, ...r.beyond.outline];
  }

  function drawOverlay() {
    const r = view.pxToModel(10) * K;
    view.setOverlay(picks.map((p) => `<circle cx="${p[0] * K}" cy="${-p[1] * K}" r="${r}" fill="#E30613"/>`).join(''));
  }

  function setTool(t, hint) {
    tool = t; picks = [];
    hud.replaceChildren(...(hint ? [el('div', { class: 'pill', role: 'status' }, hint)] : []));
    for (const b of toolbar.querySelectorAll('[data-tool]')) b.classList.toggle('active', b.dataset.tool === t);
    drawOverlay();
  }

  function onTap(p) {
    if (!current || !tool) return;
    const q = snap2D(p, outlines(), view.pxToModel(SNAP_2D_PX)).point;
    if (tool === 'level') {
      s().edit.add({ type: 'level', view: current.id, at: q });
      toast(`Level ${formatLevel(q[1])} placed`);
      return;
    }
    picks.push(q);
    if (picks.length === 2) {
      const [a, b] = picks;
      picks = [];
      hud.replaceChildren(el('div', { class: 'pill', role: 'status' }, `${cm1(Math.hypot(b[0] - a[0], b[1] - a[1]))} · Δh ${cm1(Math.abs(b[0] - a[0]))} · Δv ${cm1(Math.abs(b[1] - a[1]))}`));
    }
    drawOverlay();
  }

  async function depthSetting() {
    const v = await promptDialog({ title: 'Section depth', label: 'Show geometry beyond the cut up to (m, 0–20):', value: String(s().settings.sectionDepth), decimal: true, validate: (t) => { const n = parseNum(t); return n >= 0 && n <= 20 ? null : 'Enter a depth between 0 and 20 m.'; } });
    if (v === null) return;
    s().setSettings({ sectionDepth: parseNum(v) });
    for (const k of [...cache.keys()]) if (k.startsWith('section-')) cache.delete(k);
    compute();
  }

  select.onchange = () => { setTool(null); compute(); };
  const toolBtn = (ic, label, t, hint) => toolButton(ic, label, () => setTool(tool === t ? null : t, hint), { 'data-tool': t });
  toolbar.append(
    toolButton('fit', 'Fit', () => view.fit()),
    toolBtn('ruler', 'Measure', 'measure', 'Tap point A, then point B'),
    toolBtn('marker', 'Level', 'level', 'Tap a point to place a level marker'),
    toolButton('undo', 'Undo', () => s()?.edit.undo()),
    toolButton('section', 'Depth', depthSetting),
    toolButton('share', 'Export', () => current && openExport(app, { view: current.id, drawing: () => current.drawing, raster: current.raster })),
  );

  return {
    show() {
      app.setTitle(`${s().project.name} · Views`);
      app.setActions([]);
      if (!s().isMesh) { view.clear(); hud.replaceChildren(el('div', { class: 'pill' }, 'Sections and elevations need a mesh scan (GLB/OBJ/PLY with faces).')); return; }
      options();
      compute();
    },
    hide() { setTool(null); },
    onSession(session) {
      cache.clear(); current = null; view.clear();
      if (!session) return;
      session.addEventListener('geometry', () => { cache.clear(); current = null; });
      session.addEventListener('annotations', () => {
        // sections may have moved or been deleted
        for (const [k, v] of [...cache]) if (v.cut && !session.annotations.some((a) => a.type === 'section' && JSON.stringify(a) === JSON.stringify(v.cut))) cache.delete(k);
        if (current) current.hm = undefined;
        if (app.current === 'views') { options(); if (!cache.has(select.value)) compute(); else draw(); }
      });
    },
  };
}
