/**
 * Terrain tab (REQ-045 height map + contours, REQ-046 excavation volumes). Browser-only.
 */
import { el, toolButton, modal, toast, showError, withBusy, segmented, parseNum, confirmDialog } from './ui.js';
import { createDrawingView, K } from './drawing-view.js';
import { buildTerrainDrawing } from '../core/drawing.js';
import { DEFAULT_BULKING, DEFAULT_TRUCK_M3 } from '../core/terrain.js';
import { rgbaToHref } from './images.js';
import { openExport } from './export-dialog.js';

/**
 * @param {object} app
 * @param {HTMLElement} root
 */
export function createTerrainView(app, root) {
  const cellSel = el('select', { class: 'input', 'aria-label': 'Cell size' }, [2, 5, 10, 20].map((c) => el('option', { value: String(c / 100) }, `Cell ${c} cm`)));
  const top = el('div', { class: 'slider-row' }, [cellSel]);
  const wrap = el('div', { class: 'canvas-wrap' });
  const hud = el('div', { class: 'hud' });
  const toolbar = el('div', { class: 'toolbar bottom' });
  root.append(top, wrap, toolbar);
  const view = createDrawingView(wrap, { onTap, onHandleDrag });
  wrap.append(hud);
  const s = () => app.session;
  let terrain = null, href = null, results = {}, drawingPts = null, selected = null;

  async function compute() {
    try {
      terrain = await withBusy('Computing terrain', () => app.client.call('terrain', { cell: s().settings.terrainCell }));
      href = rgbaToHref(terrain.rgba, terrain.hm.nx, terrain.hm.ny);
      await updateResults();
      draw(false);
    } catch (e) { showError(e); }
  }

  async function updateResults() {
    results = {};
    for (const a of s().annotations.filter((x) => x.type === 'excavation')) {
      try { results[a.id] = await app.client.call('excavation', a); } catch (e) { results[a.id] = { error: e.message }; }
    }
    showResults();
  }

  function drawing() {
    const ok = Object.fromEntries(Object.entries(results).filter(([, r]) => !r.error));
    return buildTerrainDrawing(terrain.hm, terrain.lines, s().annotations, ok);
  }

  function draw(keepView = true) {
    if (!terrain) return;
    view.setDrawing(drawing(), { view: { href } }, { bw: s().settings.bw, keepView });
    drawOverlay();
  }

  function drawOverlay() {
    const parts = [];
    const r = view.pxToModel(9) * K;
    if (drawingPts) {
      parts.push(`<polyline points="${drawingPts.map((p) => view.M(p[0], p[1])).join(' ')}" fill="none" stroke="#8B5A2B" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
      for (const p of drawingPts) parts.push(`<circle cx="${p[0] * K}" cy="${-p[1] * K}" r="${r}" fill="#8B5A2B"/>`);
    }
    const a = selected && s().edit.get(selected);
    if (a) for (let i = 0; i < a.polygon.length; i += 2) parts.push(`<circle data-handle="${i / 2}" cx="${a.polygon[i] * K}" cy="${-a.polygon[i + 1] * K}" r="${view.pxToModel(22) * K}" fill="rgba(139,90,43,0.25)" stroke="#8B5A2B" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
    view.setOverlay(parts.join(''));
  }

  function showResults() {
    const items = s().annotations.filter((x) => x.type === 'excavation');
    const cards = items.map((a, i) => {
      const r = results[a.id];
      if (!r) return null;
      if (r.error) return el('div', { class: 'pill' }, `Excavation ${i + 1}: ${r.error}`);
      const lines = [`Excavation ${i + 1}: ${r.area.toFixed(2)} m² · cut ${r.cut.toFixed(2)} m³ · fill ${r.fill.toFixed(2)} m³`,
        `Loose ${r.loose.toFixed(2)} m³ (×${(a.bulking ?? DEFAULT_BULKING).toFixed(2)}) · ${r.trucks} truck loads à ${a.truck ?? DEFAULT_TRUCK_M3} m³`];
      if (r.warning) lines.push(`Only ${(r.coverage * 100).toFixed(0)} % of the area has scan data; missing cells were interpolated.`);
      if (r.excludedCells) lines.push(`${r.excludedCells} cells without nearby data were excluded.`);
      return el('div', { class: 'pill' }, lines.map((l) => el('div', {}, l)));
    }).filter(Boolean);
    hud.replaceChildren(...cards);
  }

  function onTap(p, e) {
    if (!terrain) return;
    if (drawingPts) {
      drawingPts.push(p);
      hud.replaceChildren(el('div', { class: 'pill', role: 'status' }, [`${drawingPts.length} corners — tap more or `, el('button', { type: 'button', class: 'btn', onclick: finishPolygon }, 'Done')]));
      drawOverlay();
      return;
    }
    if (e.target?.closest?.('[data-handle]')) return;
    const ref = e.target?.closest?.('[data-ref]')?.dataset.ref;
    const a = ref && s().edit.get(ref);
    if (!a) { selected = null; drawOverlay(); return; }
    if (selected !== a.id) { selected = a.id; drawOverlay(); toast('Drag corners to move · tap again to edit'); return; }
    editExcavation(a);
  }

  function onHandleDrag(id, p, done) {
    const a = selected && s().edit.get(selected);
    if (!a) return;
    const poly = a.polygon.slice();
    poly[2 * Number(id)] = Math.round(p[0] * 100) / 100;
    poly[2 * Number(id) + 1] = Math.round(p[1] * 100) / 100;
    if (done) s().edit.update(a.id, { polygon: poly });
    else {
      const d = buildTerrainDrawing(terrain.hm, terrain.lines, s().annotations.map((x) => (x.id === a.id ? { ...a, polygon: poly } : x)), {});
      view.setDrawing(d, { view: { href } }, { keepView: true });
    }
  }

  function startPolygon() {
    selected = null;
    drawingPts = [];
    hud.replaceChildren(el('div', { class: 'pill', role: 'status' }, 'Tap the corners of the excavation'));
  }

  async function finishPolygon() {
    if (drawingPts.length < 3) { toast('The excavation polygon needs at least 3 points.'); return; }
    const polygon = drawingPts.flat().map((v) => Math.round(v * 100) / 100);
    drawingPts = null;
    const params = await excavationDialog({ polygon, mode: 'level', level: -0.5, depth: 0.3, bulking: DEFAULT_BULKING, truck: DEFAULT_TRUCK_M3 });
    if (params) selected = s().edit.add({ type: 'excavation', ...params });
    else draw();
  }

  async function editExcavation(a) {
    const r = await excavationDialog(a, true);
    if (r === 'delete') { if (await confirmDialog('Delete excavation', 'Delete this excavation polygon?', 'Delete', true)) { s().edit.remove(a.id); selected = null; } return; }
    if (r) s().edit.update(a.id, r);
  }

  /** Target mode, values and numeric vertex editing (one "x; y" per line, metres). */
  async function excavationDialog(a, canDelete = false) {
    let mode = a.mode;
    const num = (v) => el('input', { class: 'input', inputmode: 'decimal', value: String(v) });
    const level = num(a.level ?? -0.5), depth = num(a.depth ?? 0.3), bulking = num(a.bulking ?? DEFAULT_BULKING), truck = num(a.truck ?? DEFAULT_TRUCK_M3);
    const verts = el('textarea', { class: 'input', rows: 5, 'aria-label': 'Corner coordinates' });
    const pts = [];
    for (let i = 0; i < a.polygon.length; i += 2) pts.push(`${a.polygon[i].toFixed(2)}; ${a.polygon[i + 1].toFixed(2)}`);
    verts.value = pts.join('\n');
    const levelBox = el('label', { class: 'field' }, ['Target level relative to ±0.00 (m, e.g. -0.80)', level]);
    const depthBox = el('label', { class: 'field' }, ['Depth below existing surface (m)', depth]);
    const sync = () => { levelBox.hidden = mode !== 'level'; depthBox.hidden = mode !== 'depth'; };
    const body = el('div', {}, [
      segmented([{ value: 'level', label: 'Target level' }, { value: 'depth', label: 'Constant depth' }], mode, (v) => { mode = v; sync(); }),
      levelBox, depthBox,
      el('div', { class: 'grid2' }, [el('label', { class: 'field' }, ['Bulking factor (1.00–1.60)', bulking]), el('label', { class: 'field' }, ['Truck capacity m³', truck])]),
      el('label', { class: 'field' }, ['Corners (x; y in m, one per line)', verts]),
      el('p', { class: 'muted' }, 'Volumes are estimates, not a site safety plan. Trenches deeper than 1.25 m need slopes or shoring (DIN 4124).'),
    ]);
    sync();
    let out = null;
    const actions = [{ label: 'Cancel', value: null }];
    if (canDelete) actions.push({ label: 'Delete', value: 'delete', danger: true });
    actions.push({ label: 'Calculate', value: 'ok', primary: true });
    const v = await modal({
      title: 'Excavation', body, actions,
      validate: (val) => {
        if (val !== 'ok') return null;
        const polygon = [];
        for (const line of verts.value.split('\n').map((l) => l.trim()).filter(Boolean)) {
          const [x, y] = line.split(/[;\s]+/).map(parseNum);
          if (!Number.isFinite(x) || !Number.isFinite(y)) return `Invalid corner “${line}”. Use “x; y”.`;
          polygon.push(x, y);
        }
        if (polygon.length < 6) return 'The excavation polygon needs at least 3 points.';
        const o = { polygon, mode, level: parseNum(level.value), depth: parseNum(depth.value), bulking: parseNum(bulking.value), truck: parseNum(truck.value) };
        if (mode === 'level' && !Number.isFinite(o.level)) return 'Enter the target level in m.';
        if (mode === 'depth' && !(o.depth > 0)) return 'Depth must be greater than 0.';
        if (!(o.bulking >= 1 && o.bulking <= 1.6)) return 'Bulking factor must be between 1.00 and 1.60.';
        if (!(o.truck > 0)) return 'Truck capacity must be greater than 0.';
        out = o;
        return null;
      },
    });
    return v === 'delete' ? 'delete' : v === 'ok' ? out : null;
  }

  cellSel.onchange = () => { s().setSettings({ terrainCell: Number(cellSel.value) }); compute(); };
  toolbar.append(
    toolButton('fit', 'Fit', () => view.fit()),
    toolButton('polygon', 'Excavate', startPolygon),
    toolButton('undo', 'Undo', () => s()?.edit.undo()),
    toolButton('redo', 'Redo', () => s()?.edit.redo()),
    toolButton('share', 'Export', () => terrain && openExport(app, { view: 'terrain', drawing, raster: { rgba: terrain.rgba, width: terrain.hm.nx, height: terrain.hm.ny } })),
  );

  return {
    show() {
      app.setTitle(`${s().project.name} · Terrain`);
      app.setActions([]);
      cellSel.value = String(s().settings.terrainCell);
      if (!terrain) compute(); else draw();
    },
    hide() { drawingPts = null; },
    onSession(session) {
      terrain = null; results = {}; selected = null; view.clear(); hud.replaceChildren();
      if (!session) return;
      session.addEventListener('geometry', () => { terrain = null; });
      session.addEventListener('annotations', async () => {
        if (app.current !== 'terrain' || !terrain) return;
        await updateResults();
        draw();
      });
    },
  };
}
