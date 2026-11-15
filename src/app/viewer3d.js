/**
 * 3D tab (REQ-015, REQ-017, REQ-020/021 manual tools, REQ-030 measure, REQ-031 calibrate,
 * REQ-056 PNG snapshot). three.js WebGL2 renderer with touch orbit/pan/pinch. Browser-only.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { el, toolButton, modal, confirmDialog, promptDialog, parseNum, toast, showError, withBusy, segmented } from './ui.js';
import { measure3D, SNAP_3D_M, calibrationFactor, calibrationText } from '../core/measure.js';
import { multiply, identity } from '../core/mat4.js';
import { readyToShare } from './projects-view.js';
import { exportFileName, isoDate } from '../export/filename.js';

const GREY = 0xb0b0b0;
const MODES = ['color', 'grey', 'wire', 'xray'];
const MODE_LABEL = { color: 'Colour', grey: 'Grey', wire: 'Wire', xray: 'X-ray' };

/**
 * @param {object} app
 * @param {HTMLElement} root
 */
export function create3DView(app, root) {
  const wrap = el('div', { class: 'canvas-wrap' });
  const hud = el('div', { class: 'hud' });
  const hintBox = el('div');
  const noticeBox = el('div');
  hud.append(noticeBox, hintBox);
  const toolbar = el('div', { class: 'toolbar bottom' });
  root.append(wrap, toolbar);
  wrap.append(hud);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.localClippingEnabled = true;
  renderer.setClearColor(0xdfe3e8);
  wrap.prepend(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', '3D model view');

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(3, 10, 6);
  scene.add(sun);
  const persp = new THREE.PerspectiveCamera(50, 1, 0.02, 2000);
  const ortho = new THREE.OrthographicCamera(-5, 5, 5, -5, -1000, 1000);
  let camera = persp;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.enableDamping = false;
  controls.addEventListener('change', requestRender);

  const gridMajor = new THREE.GridHelper(40, 40, 0x7a8590, 0xa4adb6);
  const gridMinor = new THREE.GridHelper(10, 100, 0xbfc6cd, 0xc9cfd5);
  gridMinor.position.y = -0.001;
  scene.add(gridMajor, gridMinor);
  const gizmoScene = new THREE.Scene();
  gizmoScene.add(new THREE.AxesHelper(1));
  const gizmoCam = new THREE.OrthographicCamera(-1.4, 1.4, 1.4, -1.4, -10, 10);

  const clipPlanes = [0, 1, 2, 3, 4, 5].map((i) => new THREE.Plane(new THREE.Vector3(...[[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][i]), 1e6));
  let clipOn = false;
  let model = null, wire = null, texture = null, mode = 'color';
  const overlay = new THREE.Group();
  scene.add(overlay);
  const sectionLine = new THREE.Group();
  scene.add(sectionLine);
  let tool = null; // 'measure' | 'calibrate' | 'tapFloor' | 'zero' | 'alignWall'
  let picks = [];
  let lastMeasure = null;
  let pending = false;
  let needsFraming = false;

  function requestRender() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(render);
  }

  function render() {
    pending = false;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    const c = renderer.domElement;
    if (c.width !== Math.floor(w * renderer.getPixelRatio()) || c.height !== Math.floor(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      persp.aspect = w / h;
      persp.updateProjectionMatrix();
    }
    if (camera === ortho) {
      const d = controls.target.distanceTo(persp.position) || 5;
      const hh = d * Math.tan((persp.fov * Math.PI) / 360);
      ortho.left = -hh * (w / h); ortho.right = hh * (w / h); ortho.top = hh; ortho.bottom = -hh;
      ortho.updateProjectionMatrix();
    }
    gridMinor.visible = camera.position.distanceTo(controls.target) < 5;
    renderer.setViewport(0, 0, w, h);
    renderer.setScissorTest(false);
    renderer.render(scene, camera);
    // axis gizmo, bottom-left corner
    const s = 72;
    gizmoCam.position.copy(camera.position).sub(controls.target).setLength(5);
    gizmoCam.lookAt(0, 0, 0);
    renderer.autoClear = false;
    renderer.setScissorTest(true);
    renderer.setScissor(4, 4, s, s);
    renderer.setViewport(4, 4, s, s);
    renderer.clearDepth();
    renderer.render(gizmoScene, gizmoCam);
    renderer.setScissorTest(false);
    renderer.autoClear = true;
    for (const lbl of wrap.querySelectorAll('.measure-label')) positionLabel(lbl);
  }

  new ResizeObserver(requestRender).observe(wrap);
  // iOS may drop the WebGL context in the background; redraw once it is restored (DEF-14)
  renderer.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault());
  renderer.domElement.addEventListener('webglcontextrestored', () => requestRender());

  function buildModel(session) {
    if (model) { scene.remove(model); model.geometry.dispose(); model.material.dispose(); model = null; }
    removeWire();
    if (texture) { texture.dispose(); texture = null; }
    disposeChildren(overlay);
    if (!session) return;
    const d = session.load.display;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
    if (d.colors) geo.setAttribute('color', new THREE.BufferAttribute(d.colors, 3, true));
    if (d.uvs && session.load.texture) {
      geo.setAttribute('uv', new THREE.BufferAttribute(d.uvs, 2));
      const blob = new Blob([session.load.texture.bytes], { type: session.load.texture.mimeType });
      createImageBitmap(blob, { imageOrientation: 'flipY' }).then((bmp) => {
        texture = new THREE.Texture(bmp);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = false;
        texture.needsUpdate = true;
        applyMode();
      }).catch(() => {});
    }
    if (d.indices) {
      geo.setIndex(new THREE.BufferAttribute(d.indices, 1));
      geo.computeVertexNormals();
      model = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 1, metalness: 0 }));
    } else {
      model = new THREE.Points(geo, new THREE.PointsMaterial({ size: 3, sizeAttenuation: false }));
    }
    model.matrixAutoUpdate = false;
    scene.add(model);
    applyTransform(session);
    applyMode();
    needsFraming = true; // frame once the canvas has its real size (tab may be hidden now)
  }

  /** Removes children and frees their GPU geometry/materials (DEF-13). */
  function disposeChildren(group) {
    for (const c of [...group.children]) { c.geometry?.dispose(); c.material?.dispose(); }
    group.clear();
  }

  function removeWire() {
    if (!wire) return;
    scene.remove(wire);
    wire.material.dispose(); // geometry is shared with the model
    wire = null;
  }

  function applyTransform(session) {
    if (!model) return;
    model.matrix.fromArray(session.transform);
    model.matrixWorldNeedsUpdate = true;
    if (wire) { wire.matrix.copy(model.matrix); wire.matrixWorldNeedsUpdate = true; }
    requestRender();
  }

  function applyMode() {
    if (!model) return;
    const m = model.material;
    const isPoints = model.isPoints;
    m.clippingPlanes = clipOn ? clipPlanes : [];
    m.vertexColors = mode === 'color' && !!model.geometry.attributes.color && !(texture && !isPoints);
    if (!isPoints) m.map = mode === 'color' && texture ? texture : null;
    m.color.set(mode === 'color' && (m.vertexColors || m.map) ? 0xffffff : GREY);
    m.transparent = mode === 'xray';
    m.opacity = mode === 'xray' ? 0.5 : 1;
    m.depthWrite = mode !== 'xray';
    m.needsUpdate = true;
    removeWire();
    if (mode === 'wire' && !isPoints) {
      wire = new THREE.Mesh(model.geometry, new THREE.MeshBasicMaterial({ color: 0x1f2a36, wireframe: true, transparent: true, opacity: 0.35, clippingPlanes: m.clippingPlanes }));
      wire.matrixAutoUpdate = false;
      wire.matrix.copy(model.matrix);
      scene.add(wire);
    }
    requestRender();
  }

  function modelBox() {
    const b = new THREE.Box3();
    if (model) { model.updateMatrixWorld(true); b.setFromObject(model); }
    if (b.isEmpty()) b.set(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 2.5, 2));
    return b;
  }

  /** Camera presets: reset / top / front / right / back / left. */
  function viewFrom(dir) {
    render(); // make sure the aspect ratio is current
    const b = modelBox();
    const c = b.getCenter(new THREE.Vector3());
    const r = Math.max(0.5, b.getSize(new THREE.Vector3()).length() / 2); // bounding-sphere radius
    const vfov = (persp.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (persp.aspect || 1));
    const dist = (r / Math.sin(Math.min(vfov, hfov) / 2)) * 1.05;
    const offsets = { reset: [1, 0.9, -1.2], top: [0, 1, 0.0001], front: [0, 0, -1], right: [1, 0, 0], back: [0, 0, 1], left: [-1, 0, 0] };
    const o = new THREE.Vector3(...offsets[dir]).normalize().multiplyScalar(dist);
    persp.position.copy(c).add(o);
    controls.target.copy(c);
    ortho.position.copy(persp.position);
    controls.update();
    requestRender();
  }
  const resetView = () => viewFrom('reset');

  function toggleCamera() {
    const next = camera === persp ? ortho : persp;
    next.position.copy(camera.position);
    camera = next;
    controls.object = camera;
    controls.update();
    projBtn.querySelector('span').textContent = camera === persp ? 'Persp.' : 'Ortho';
    requestRender();
  }

  // ---- picking ----
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.02;
  function pick(clientX, clientY) {
    if (!model) return null;
    const r = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(model, false)[0];
    if (!hit) return null;
    const n = hit.face ? hit.face.normal.clone().transformDirection(model.matrixWorld) : new THREE.Vector3(0, 1, 0);
    return { point: hit.point.toArray(), normal: n.toArray() };
  }

  let down = null, lastTap = 0;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10 || performance.now() - down.t > 400) { down = null; return; }
    down = null;
    const now = performance.now();
    if (!tool && now - lastTap < 350) { focusAt(e.clientX, e.clientY); lastTap = 0; return; }
    lastTap = now;
    if (tool) onToolTap(e.clientX, e.clientY);
  });

  function focusAt(x, y) {
    const h = pick(x, y);
    if (!h) return;
    const delta = new THREE.Vector3(...h.point).sub(controls.target);
    controls.target.add(delta);
    camera.position.add(delta.multiplyScalar(0.5));
    controls.update();
    requestRender();
  }

  async function onToolTap(x, y) {
    const s = app.session;
    const h = pick(x, y);
    if (!h) { toast('Tap on the model'); return; }
    try {
      if (tool === 'measure' || tool === 'calibrate') {
        const snapped = await app.client.call('snap', { point: h.point, radius: SNAP_3D_M });
        picks.push(snapped || h.point);
        drawPicks();
        if (picks.length === 2) {
          const [a, b] = picks;
          lastMeasure = { a, b, ...measure3D(a, b) };
          if (tool === 'calibrate') await finishCalibration(lastMeasure.distance);
          else setHint(`${lastMeasure.text} · ${lastMeasure.components}`, [el('button', { type: 'button', class: 'btn', onclick: saveMeasure }, 'Save')]);
          picks = [];
        } else setHint(tool === 'calibrate' ? 'Tap the other end of the reference' : 'Tap point B');
      } else if (tool === 'tapFloor') {
        await applyOrientation('tapFloor', { point: h.point, normal: h.normal });
      } else if (tool === 'zero') {
        await applyOrientation('zero', { y: h.point[1] });
        toast('±0.00 set');
      } else if (tool === 'alignWall') {
        await applyOrientation('alignWall', { normal: h.normal });
      }
    } catch (e) { showError(e); }
  }

  function drawPicks() {
    disposeChildren(overlay);
    for (const l of wrap.querySelectorAll('.measure-label')) l.remove();
    const pts = picks.length ? picks : [];
    const r = Math.max(0.01, modelBox().getSize(new THREE.Vector3()).length() / 300);
    for (const p of pts) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), new THREE.MeshBasicMaterial({ color: 0xe30613, depthTest: false }));
      s.position.set(...p);
      s.renderOrder = 10;
      overlay.add(s);
    }
    const saved = app.session ? app.session.annotations.filter((a) => a.type === 'measure' && a.view === '3d') : [];
    const lines = [...saved.map((a) => [a.a, a.b]), ...(lastMeasure && !picks.length ? [[lastMeasure.a, lastMeasure.b]] : [])];
    for (const [a, b] of lines) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x0055a4, depthTest: false }));
      line.renderOrder = 10;
      overlay.add(line);
      const lbl = el('div', { class: 'measure-label' }, measure3D(a, b).text);
      lbl.dataset.pos = JSON.stringify([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
      wrap.append(lbl);
    }
    requestRender();
  }

  function positionLabel(lbl) {
    const v = new THREE.Vector3(...JSON.parse(lbl.dataset.pos)).project(camera);
    lbl.style.left = `${((v.x + 1) / 2) * wrap.clientWidth}px`;
    lbl.style.top = `${((1 - v.y) / 2) * wrap.clientHeight}px`;
    lbl.hidden = v.z > 1;
  }

  function saveMeasure() {
    if (!lastMeasure) return;
    app.session.edit.add({ type: 'measure', view: '3d', a: lastMeasure.a, b: lastMeasure.b });
    lastMeasure = null;
    toast('Measurement saved');
    drawPicks();
  }

  async function finishCalibration(measuredM) {
    const v = await promptDialog({
      title: 'Calibrate scale', label: `Measured ${(measuredM * 100).toFixed(1)} cm. Real length of the reference in cm:`, decimal: true,
      validate: (t) => (parseNum(t) > 0 ? null : 'Enter the real length in cm, e.g. 100.0'),
    });
    setTool(null);
    if (v === null) return;
    const real = Math.round(parseNum(v) * 10) / 10;
    const { factor, unusual, percent } = calibrationFactor(measuredM, real);
    if (unusual && !(await confirmDialog('Calibrate scale', `Scale change of ${percent.toFixed(1)} % is unusual. Apply anyway?`, 'Apply'))) return;
    const s = app.session;
    const prev = s.edit.state.calibration ? s.edit.state.calibration.factor : 1;
    s.setCalibration({ factor: prev * factor, refCm: real });
    toast(calibrationText(s.edit.state.calibration));
  }

  async function applyOrientation(op, args = {}) {
    const s = app.session;
    const scale = s.scale;
    const m = await withBusy('Orienting', () => app.client.call('orient', { op, args }));
    // the worker returns the full transform; keep calibration separate: orientation = S⁻¹ · T
    const inv = [1 / scale, 0, 0, 0, 0, 1 / scale, 0, 0, 0, 0, 1 / scale, 0, 0, 0, 0, 1];
    s.edit.apply((d) => { d.orientation = multiply(inv, m); });
    setTool(null);
  }

  function setHint(text, extra = []) {
    hintBox.replaceChildren(...(text ? [el('div', { class: 'pill', role: 'status' }, [text, ...extra.map((x) => el('span', {}, [' ', x]))])] : []));
  }

  function setTool(t, hint) {
    tool = t;
    picks = [];
    setHint(hint || '');
    for (const b of toolbar.querySelectorAll('[data-tool]')) b.classList.toggle('active', b.dataset.tool === t);
    drawPicks();
  }

  const toolBtn = (iconName, label, t, hint) => toolButton(iconName, label, () => setTool(tool === t ? null : t, hint), { 'data-tool': t });

  /**
   * Persistent "check orientation" card after an OBJ/PLY import (DEF-20). It stays (also after
   * reopening) until the user confirms or opens Orient.
   */
  function renderOrientNotice() {
    const axis = app.session?.settings.orientCheck;
    if (!axis) { noticeBox.replaceChildren(); return; }
    const done = () => { app.session.setSettings({ orientCheck: null }); renderOrientNotice(); };
    noticeBox.replaceChildren(el('div', { class: 'pill', role: 'region', 'aria-label': 'Check orientation' }, [
      el('div', {}, `Check orientation: OBJ/PLY files have no fixed up direction. Detected up axis: ${axis}. The floor should be at the bottom.`),
      el('div', { class: 'row', style: 'margin-top:6px' }, [
        el('button', { type: 'button', class: 'btn', onclick: () => { done(); orientSheet(); } }, 'Fix: Up = …'),
        el('button', { type: 'button', class: 'btn', onclick: done }, 'Looks right'),
      ]),
    ]));
  }

  async function orientSheet() {
    const body = el('div');
    const close = () => body.closest('.modal-backdrop')?.remove();
    const act = (label, fn) => el('button', { type: 'button', class: 'btn', onclick: () => { close(); fn(); } }, label);
    body.append(
      el('p', { class: 'muted' }, 'Choose which axis of the scan points up:'),
      el('div', { class: 'grid3' }, ['+X', '-X', '+Y', '-Y', '+Z', '-Z'].map((a) => act(`Up = ${a.replace('-', '−')}`, () => applyOrientation('up', { axis: a }).catch(showError)))),
      el('h3', {}, 'Level and align'),
      el('div', { class: 'grid2' }, [
        act('Auto level', () => applyOrientation('auto').catch(showError)),
        act('Tap floor to level', () => setTool('tapFloor', 'Tap the floor')),
        act('Set ±0.00 here', () => setTool('zero', 'Tap the reference height (e.g. finished floor)')),
        act('Rotate 90°', () => applyOrientation('rot90').catch(showError)),
        act('Align to tapped wall', () => setTool('alignWall', 'Tap a wall')),
        act('Reset scale', () => { app.session.setCalibration(null); toast('Scale reset to ×1.0000'); }),
        act('Reset orientation', () => app.session.edit.apply((d) => { d.orientation = identity(); })),
      ]),
      el('p', { class: 'muted' }, calibrationText(app.session.edit.state.calibration)),
    );
    await modal({ title: 'Orientation & scale', body, actions: [{ label: 'Close', value: true }] });
  }

  async function displaySheet() {
    const body = el('div');
    body.append(segmented(MODES.map((m) => ({ value: m, label: MODE_LABEL[m] })), mode, (v) => { mode = v; applyMode(); }));
    const b = modelBox();
    const clipChk = el('input', { type: 'checkbox', checked: clipOn, onchange: () => { clipOn = clipChk.checked; applyMode(); } });
    body.append(el('label', { class: 'check' }, [clipChk, 'Clipping box']));
    const axes = [['X min', 0, 0, false], ['X max', 1, 0, true], ['Y min', 2, 1, false], ['Y max', 3, 1, true], ['Z min', 4, 2, false], ['Z max', 5, 2, true]];
    for (const [label, idx, comp, isMax] of axes) {
      const lo = b.min.getComponent(comp), hi = b.max.getComponent(comp);
      const cur = clipPlanes[idx].constant >= 1e5 ? (isMax ? hi : lo) : (isMax ? clipPlanes[idx].constant : -clipPlanes[idx].constant);
      const r = el('input', { type: 'range', min: lo, max: hi, step: 0.01, value: cur, 'aria-label': label });
      // keep p·n + constant ≥ 0: min planes have normal +axis, max planes −axis
      r.oninput = () => { const v = Number(r.value); clipPlanes[idx].constant = isMax ? v : -v; requestRender(); };
      body.append(el('label', { class: 'field' }, [label, r]));
    }
    const secChk = el('input', { type: 'checkbox', checked: sectionLine.visible, onchange: () => { sectionLine.visible = secChk.checked; requestRender(); } });
    body.append(el('label', { class: 'check' }, [secChk, 'Show plan section line (red)']));
    await modal({ title: 'Display', body, actions: [{ label: 'Close', value: true }] });
  }

  /** Red section line at the plan height (REQ-017), from the last plan computed. */
  function updateSectionLine() {
    disposeChildren(sectionLine);
    const plan = app.session?.lastPlan;
    if (!plan) return;
    for (const p of plan.outline) {
      const pts = [];
      for (let i = 0; i < p.pts.length; i += 2) pts.push(new THREE.Vector3(p.pts[i], plan.h, -p.pts[i + 1]));
      if (p.closed) pts.push(pts[0].clone());
      sectionLine.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xe30613 })));
    }
    requestRender();
  }

  async function snapshot() {
    try {
      const w = wrap.clientWidth * 2, h = wrap.clientHeight * 2;
      const prevRatio = renderer.getPixelRatio();
      renderer.setPixelRatio(2);
      renderer.setSize(wrap.clientWidth, wrap.clientHeight, false);
      renderer.render(scene, camera);
      const blob = await new Promise((r) => renderer.domElement.toBlob(r, 'image/png'));
      renderer.setPixelRatio(prevRatio);
      requestRender();
      if (!blob) throw new Error('Could not capture the view.');
      await readyToShare(new File([blob], exportFileName({ project: app.session.project.name, view: `3d_${w}x${h}`, date: isoDate(), ext: 'png' }), { type: 'image/png' }));
    } catch (e) { showError(e); }
  }

  const undoBtn = toolButton('undo', 'Undo', () => app.session?.edit.undo());
  const redoBtn = toolButton('redo', 'Redo', () => app.session?.edit.redo());
  const projBtn = toolButton('eye', 'Persp.', toggleCamera);
  toolbar.append(
    toolButton('reset', 'Reset', resetView),
    toolButton('top', 'Top', () => viewFrom('top')),
    toolButton('views', 'Front', () => viewFrom('front')),
    toolButton('views', 'Right', () => viewFrom('right')),
    toolButton('views', 'Back', () => viewFrom('back')),
    toolButton('views', 'Left', () => viewFrom('left')),
    projBtn,
    toolButton('layers', 'Display', displaySheet),
    toolBtn('ruler', 'Measure', 'measure', 'Tap point A'),
    toolBtn('scale', 'Calibrate', 'calibrate', 'Tap one end of the reference'),
    toolButton('level', 'Orient', () => orientSheet()),
    undoBtn, redoBtn,
    toolButton('share', 'PNG', snapshot),
  );

  const updateUndo = () => { undoBtn.disabled = !app.session?.edit.canUndo; redoBtn.disabled = !app.session?.edit.canRedo; };

  return {
    show() {
      const s = app.session;
      app.setTitle(s ? s.project.name : '3D');
      app.setActions([]);
      updateSectionLine();
      renderOrientNotice();
      drawPicks();
      updateUndo();
      if (needsFraming) requestAnimationFrame(() => { needsFraming = false; resetView(); });
      requestRender();
    },
    hide() { setTool(null); },
    onSession(session) {
      buildModel(session);
      if (!session) return;
      session.addEventListener('geometry', () => { applyTransform(session); session.lastPlan = null; updateSectionLine(); });
      session.addEventListener('annotations', () => { drawPicks(); updateUndo(); });
    },
    /** 256×256 JPEG thumbnail ≤ 30 KB (REQ-010). */
    async captureThumbnail() {
      render();
      const c = el('canvas', { width: 256, height: 256 });
      const src = renderer.domElement, side = Math.min(src.width, src.height);
      if (!side) return null;
      c.getContext('2d').drawImage(src, (src.width - side) / 2, (src.height - side) / 2, side, side, 0, 0, 256, 256);
      for (const q of [0.7, 0.5, 0.35, 0.2]) {
        const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
        if (blob && blob.size <= 30 * 1024) return blob;
      }
      return null;
    },
    /** Exposed for the smoke test (REQ-015). */
    cameraPosition: () => camera.position.toArray(),
  };
}
