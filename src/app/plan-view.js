/**
 * Plan tab (REQ-022…REQ-024, REQ-026 cut lines, REQ-028/029 display, REQ-030 measure,
 * REQ-040 markup). Browser-only.
 */
import { el, toolButton, modal, toast, showError, withBusy, segmented, parseNum, confirmDialog } from './ui.js';
import { createDrawingView, K } from './drawing-view.js';
import { buildPlanDrawing } from '../core/drawing.js';
import { snap2D, SNAP_2D_PX, cm1 } from '../core/measure.js';
import { segmentsOf, distToSeg, signedArea } from '../core/polyline.js';
import { validateMarkup } from '../core/markup.js';
import { newWallDialog, editMarkupDialog, markupListDialog } from './markup-ui.js';
import { openExport } from './export-dialog.js';

/**
 * @param {object} app
 * @param {HTMLElement} root
 */
export function createPlanView(app, root) {
  const range = el('input', { type: 'range', min: 0.05, max: 3, step: 0.01, value: 1, 'aria-label': 'Cut height' });
  const num = el('input', { type: 'number', inputmode: 'decimal', min: 0.05, step: 0.01, value: '1.00', 'aria-label': 'Cut height in metres' });
  const sliderRow = el('div', { class: 'slider-row' }, [el('span', { class: 'unit' }, 'Cut'), range, num, el('span', { class: 'unit' }, 'm')]);
  const wrap = el('div', { class: 'canvas-wrap' });
  const hud = el('div', { class: 'hud' });
  const toolbar = el('div', { class: 'toolbar bottom' });
  root.append(sliderRow, wrap, toolbar);
  const view = createDrawingView(wrap, { onTap, onHandleDrag });
  wrap.append(hud);

  let plan = null, tool = null, picks = [], selected = null, measure = null, busy = false, queued = false;

  const s = () => app.session;

  async function recompute() {
    if (!s()) return;
    if (busy) { queued = true; return; }
    busy = true;
    try {
      const st = s().settings;
      plan = await withBusy('Computing plan', () => app.client.call('plan', { h: st.planHeight, simplify: st.simplify, snap: st.snap, below: st.showBelow }));
      s().lastPlan = plan;
      const maxH = Math.max(0.1, plan.maxY - 0.05);
      range.max = maxH.toFixed(2);
      num.max = maxH.toFixed(2);
      if (!plan.outline.length) toast('Nothing cut at this height — try another cut height.');
      draw(false);
    } catch (e) { showError(e); } finally {
      busy = false;
      if (queued) { queued = false; recompute(); }
    }
  }

  function drawing() {
    return buildPlanDrawing(plan, s().annotations, { dims: s().settings.showDims, showBelow: s().settings.showBelow });
  }

  function draw(keepView = true) {
    if (!plan) return;
    view.setDrawing(drawing(), {}, { bw: s().settings.bw, keepView });
    drawOverlay();
  }

  /** Tool feedback: picked points, measurement line, selection handles. */
  function drawOverlay() {
    const r = view.pxToModel(10) * K;
    const parts = picks.map((p) => `<circle cx="${p[0] * K}" cy="${-p[1] * K}" r="${r}" fill="#E30613"/>`);
    if (picks.length > 1) parts.push(`<polyline points="${picks.map((p) => view.M(p[0], p[1])).join(' ')}" fill="none" stroke="#0055A4" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
    if (measure) parts.push(`<line x1="${measure.a[0] * K}" y1="${-measure.a[1] * K}" x2="${measure.b[0] * K}" y2="${-measure.b[1] * K}" stroke="#0055A4" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
    const a = selected && s().edit.get(selected);
    if (a && a.a && (a.type === 'demolition' || a.type === 'new')) {
      for (const [id, p] of [['a', a.a], ['b', a.b]]) parts.push(`<circle data-handle="${id}" cx="${p[0] * K}" cy="${-p[1] * K}" r="${view.pxToModel(22) * K}" fill="rgba(11,92,173,0.25)" stroke="#0B5CAD" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
    }
    view.setOverlay(parts.join(''));
  }

  function setHint(text, extra = []) {
    hud.replaceChildren(...(text ? [el('div', { class: 'pill', role: 'status' }, [text, ...extra.map((x) => el('span', {}, [' ', x]))])] : []));
  }

  function setTool(t, hint) {
    tool = t; picks = []; measure = null;
    if (t) selected = null;
    setHint(hint || '', t && t.startsWith('poly') ? [el('button', { type: 'button', class: 'btn', onclick: finishPolygon }, 'Done')] : []);
    for (const b of toolbar.querySelectorAll('[data-tool]')) b.classList.toggle('active', b.dataset.tool === t);
    drawOverlay();
  }

  const snapPt = (p) => (plan ? snap2D(p, plan.outline, view.pxToModel(SNAP_2D_PX)).point : p);

  async function onTap(p, e) {
    if (!plan) return;
    try {
      if (!tool) return selectAt(p, e);
      if (tool === 'measure') {
        picks.push(snapPt(p));
        if (picks.length === 2) {
          measure = { a: picks[0], b: picks[1] };
          picks = [];
          setHint(cm1(Math.hypot(measure.b[0] - measure.a[0], measure.b[1] - measure.a[1])), [el('button', { type: 'button', class: 'btn', onclick: () => { s().edit.add({ type: 'measure', view: 'plan', a: measure.a, b: measure.b }); measure = null; setHint('Saved — tap point A'); } }, 'Save')]);
        } else setHint('Tap point B');
      } else if (tool === 'demolish') await demolishAt(p);
      else if (tool === 'newWall' || tool === 'section') {
        picks.push(snapPt(p));
        if (picks.length === 2) {
          const [a, b] = picks;
          picks = [];
          if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.05) { toast('Points are too close.'); return; }
          if (tool === 'newWall') {
            const w = await newWallDialog();
            if (w) addMarkup({ type: 'new', a, b, thickness: w.thickness, align: w.align, note: w.note });
          } else await addSection(a, b);
          setHint(tool === 'section' ? 'Tap the start of the next cut line' : 'Tap the start of the next wall');
        } else setHint('Tap the end point');
      } else if (tool.startsWith('poly')) {
        picks.push(snapPt(p));
        setHint(`${picks.length} points — tap more or Done`, [el('button', { type: 'button', class: 'btn', onclick: finishPolygon }, 'Done')]);
      }
      drawOverlay();
    } catch (err) { showError(err); }
  }

  function addMarkup(m) {
    validateMarkup(m);
    selected = s().edit.add(m);
  }

  async function finishPolygon() {
    if (picks.length < 3) { toast('A polygon needs at least 3 points.'); return; }
    const type = tool === 'polyDemolition' ? 'demolition' : 'new';
    const polygon = picks.flat();
    let height;
    if (type === 'demolition') {
      const c = [polygon.filter((_, i) => i % 2 === 0), polygon.filter((_, i) => i % 2 === 1)].map((v) => v.reduce((x, y) => x + y) / v.length);
      height = await app.client.call('heightAtPlan', { x: c[0], y: c[1] }).catch(() => null);
    }
    addMarkup({ type, polygon, ...(height ? { height } : {}) });
    setTool(null);
  }

  /** Demolition on the tapped outline segment (thickness from wall pair or asked). */
  async function demolishAt(p) {
    const tol = view.pxToModel(SNAP_2D_PX);
    const segs = segmentsOf(plan.outline);
    let best = null, bd = tol;
    segs.forEach((sg) => { const d = distToSeg(p[0], p[1], sg.ax, sg.ay, sg.bx, sg.by); if (d < bd) { bd = d; best = sg; } });
    if (!best) { toast('Tap closer to a wall line.'); return; }
    const pair = plan.walls.find((w) => (w.a.poly === best.poly && w.a.index === best.index) || (w.b.poly === best.poly && w.b.index === best.index));
    let thickness = pair ? pair.thickness : null, side = 1;
    if (pair) {
      const c = [(pair.polygon[0] + pair.polygon[4]) / 2, (pair.polygon[1] + pair.polygon[5]) / 2];
      side = ((best.bx - best.ax) * (c[1] - best.ay) - (best.by - best.ay) * (c[0] - best.ax)) > 0 ? 1 : -1;
    } else {
      const v = await askThickness();
      if (v === null) return;
      thickness = v;
      const poly = plan.outline[best.poly];
      if (poly.closed) side = signedArea(poly.pts) > 0 ? -1 : 1; // outward for a room ring
    }
    const mid = [(best.ax + best.bx) / 2, (best.ay + best.by) / 2];
    const h = await app.client.call('heightAtPlan', { x: mid[0], y: mid[1] }).catch(() => null);
    addMarkup({ type: 'demolition', a: [best.ax, best.ay], b: [best.bx, best.by], seg: [best.ax, best.ay, best.bx, best.by], thickness, side, height: h || plan.maxY });
    setTool(null);
    setHint('Drag the round handles to trim; tap the element to edit');
  }

  async function askThickness() {
    const input = el('input', { class: 'input', inputmode: 'decimal', value: '24.0' });
    const ok = await modal({
      title: 'Wall thickness', body: el('label', { class: 'field' }, ['Only one wall face was scanned. Thickness in cm:', input]),
      actions: [{ label: 'Cancel', value: null }, { label: 'OK', value: true, primary: true }],
      validate: () => { const v = parseNum(input.value); return v >= 1 && v <= 100 ? null : 'Thickness must be between 1 and 100 cm.'; },
    });
    return ok ? parseNum(input.value) / 100 : null;
  }

  async function addSection(a, b) {
    const label = s().nextSectionLabel();
    if (!label) { toast('All 26 section labels are used.'); return; }
    let side = 1;
    const v = await modal({ title: `Section ${label}–${label}`, body: 'Which side of the line (from first to second point) should be viewed?', actions: [{ label: 'Cancel', value: null }, { label: 'Left side', value: 1 }, { label: 'Right side', value: -1, primary: true }] });
    if (v === null) return;
    side = v;
    s().edit.add({ type: 'section', label, a, b, side });
    toast(`Section ${label}–${label} added — see Views`);
  }

  async function selectAt(p, e) {
    if (e.target?.closest?.('[data-handle]')) return;
    const ref = e.target?.closest?.('[data-ref]')?.dataset.ref;
    const a = ref ? s().edit.get(ref) : null;
    if (!a) { selected = null; setHint(''); drawOverlay(); return; }
    if (a.type === 'section') {
      const v = await modal({ title: `Section ${a.label}–${a.label}`, body: 'Open it in Views, flip the viewing side or delete it.', actions: [{ label: 'Delete', value: 'delete', danger: true }, { label: 'Flip side', value: 'flip' }, { label: 'Close', value: null, primary: true }] });
      if (v === 'delete' && (await confirmDialog('Delete section', `Delete section ${a.label}–${a.label}?`, 'Delete', true))) s().edit.remove(a.id);
      if (v === 'flip') s().edit.update(a.id, { side: -a.side });
      return;
    }
    if (selected !== a.id) { selected = a.id; drawOverlay(); setHint('Tap again to edit · drag handles to trim'); return; }
    const r = await editMarkupDialog(a);
    if (!r) return;
    if (r.remove) { s().edit.remove(a.id); selected = null; } else s().edit.update(a.id, r.patch);
  }

  /** Trim handles: move along the original segment, snapping to 1 cm (REQ-040). */
  function onHandleDrag(id, p, done) {
    const a = selected && s().edit.get(selected);
    if (!a || !a.a) return;
    let q = p;
    if (a.seg) {
      const [ax, ay, bx, by] = a.seg, len = Math.hypot(bx - ax, by - ay);
      let t = ((p[0] - ax) * (bx - ax) + (p[1] - ay) * (by - ay)) / len;
      t = Math.max(0, Math.min(len, Math.round(t * 100) / 100));
      q = [ax + ((bx - ax) * t) / len, ay + ((by - ay) * t) / len];
    } else q = snapPt(p);
    const other = id === 'a' ? a.b : a.a;
    if (Math.hypot(q[0] - other[0], q[1] - other[1]) < 0.05) return;
    if (done) s().edit.update(a.id, { [id]: q });
    else {
      const preview = { ...a, [id]: q };
      const d = buildPlanDrawing(plan, s().annotations.map((x) => (x.id === a.id ? preview : x)), { dims: s().settings.showDims, showBelow: s().settings.showBelow });
      view.setDrawing(d, {}, { bw: s().settings.bw, keepView: true });
      setHint(`Length ${cm1(Math.hypot(preview.b[0] - preview.a[0], preview.b[1] - preview.a[1]))}`);
    }
  }

  async function settingsSheet() {
    const st = s().settings;
    const eps = el('input', { type: 'range', min: 0, max: 50, step: 1, value: Math.round(st.simplify * 1000), 'aria-label': 'Simplification in mm' });
    const epsLbl = el('span', {}, `${Math.round(st.simplify * 1000)} mm`);
    eps.oninput = () => { epsLbl.textContent = `${eps.value} mm`; };
    const chk = (label, key) => { const c = el('input', { type: 'checkbox', checked: st[key] }); c.dataset.key = key; return el('label', { class: 'check' }, [c, label]); };
    const body = el('div', {}, [
      el('label', { class: 'field' }, [el('span', {}, ['Line simplification ', epsLbl]), eps]),
      chk('Snap near-orthogonal lines (3°)', 'snap'), chk('Dimensions', 'showDims'), chk('Floor edges below (0.05 m)', 'showBelow'), chk('Black and white', 'bw'),
    ]);
    if ((await modal({ title: 'Plan settings', body, actions: [{ label: 'Cancel', value: false }, { label: 'Apply', value: true, primary: true }] })) !== true) return;
    const patch = { simplify: Number(eps.value) / 1000 };
    for (const c of body.querySelectorAll('input[type=checkbox]')) patch[c.dataset.key] = c.checked;
    const geometryChanged = patch.simplify !== st.simplify || patch.snap !== st.snap || patch.showBelow !== st.showBelow;
    s().setSettings(patch);
    if (geometryChanged) recompute(); else draw();
  }

  function setHeight(h, commit) {
    const max = Number(range.max);
    if (!(h >= 0.05 && h <= max)) { toast(`Cut height must be between 0.05 and ${max.toFixed(2)} m.`); num.value = s().settings.planHeight.toFixed(2); return; }
    range.value = h; num.value = h.toFixed(2);
    if (commit) { s().setSettings({ planHeight: Math.round(h * 100) / 100 }); recompute(); }
  }
  range.oninput = () => setHeight(Number(range.value), false);
  range.onchange = () => setHeight(Number(range.value), true);
  num.onchange = () => setHeight(parseNum(num.value), true);

  const toolBtn = (ic, label, t, hint) => toolButton(ic, label, () => setTool(tool === t ? null : t, hint), { 'data-tool': t });
  const undoBtn = toolButton('undo', 'Undo', () => s()?.edit.undo());
  const redoBtn = toolButton('redo', 'Redo', () => s()?.edit.redo());
  toolbar.append(
    toolButton('fit', 'Fit', () => { view.fit(); drawOverlay(); }),
    toolBtn('ruler', 'Measure', 'measure', 'Tap point A'),
    toolBtn('demolish', 'Demolish', 'demolish', 'Tap a wall line to demolish'),
    toolBtn('wall', 'New wall', 'newWall', 'Tap the start of the new wall'),
    toolBtn('polygon', 'Demo area', 'polyDemolition', 'Tap the corners of the demolition area'),
    toolBtn('polygon', 'New area', 'polyNew', 'Tap the corners of the new element'),
    toolBtn('section', 'Section', 'section', 'Tap the start of the cut line'),
    toolButton('list', 'List', async () => { if ((await markupListDialog(s().annotations)) === 'csv') openExport(app, { view: 'markup', drawing, csv: true }); }),
    toolButton('settings', 'Options', settingsSheet),
    undoBtn, redoBtn,
    toolButton('share', 'Export', () => plan && openExport(app, { view: 'plan', drawing, csv: true })),
  );
  const updateUndo = () => { undoBtn.disabled = !s()?.edit.canUndo; redoBtn.disabled = !s()?.edit.canRedo; };

  let shownFor = null;
  return {
    show() {
      app.setTitle(`${s().project.name} · Plan`);
      app.setActions([]);
      num.value = s().settings.planHeight.toFixed(2);
      range.value = s().settings.planHeight;
      updateUndo();
      if (!plan || shownFor !== s()) { shownFor = s(); recompute(); } else draw();
    },
    hide() { setTool(null); },
    onSession(session) {
      plan = null; selected = null; view.clear();
      if (!session) return;
      session.addEventListener('geometry', () => { plan = null; if (app.current === 'plan') recompute(); });
      session.addEventListener('annotations', () => { updateUndo(); if (app.current === 'plan') draw(); });
    },
  };
}
