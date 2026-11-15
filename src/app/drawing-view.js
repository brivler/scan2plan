/**
 * Interactive 2D drawing viewer on white paper (REQ-028): renders a core drawing with the
 * same primitives as the exports at a nominal 1:50, pinch-zoom / pan / Fit, tap and handle
 * dragging callbacks in model coordinates. Browser-only.
 */
import { drawingPrims } from '../export/sheet.js';
import { primsToSvg } from '../export/svg.js';
import { drawingBounds } from '../core/drawing.js';

const NS = 'http://www.w3.org/2000/svg';
/** Nominal paper scale of the on-screen drawing: mm per model metre (1:50). */
export const K = 20;

/**
 * @param {HTMLElement} container
 * @param {{onTap?:(p:number[], e:PointerEvent)=>void, onHandleDrag?:(id:string, p:number[], done:boolean)=>void}} cb
 */
export function createDrawingView(container, cb = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Drawing');
  const content = document.createElementNS(NS, 'g');
  const overlay = document.createElementNS(NS, 'g');
  svg.append(content, overlay);
  container.classList.add('paper');
  container.append(svg);
  let vb = { x: -100, y: -100, w: 200, h: 200 };
  let bounds = null;
  const apply = () => svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  apply();

  /** Client px → model metres. */
  function toModel(clientX, clientY) {
    const r = svg.getBoundingClientRect();
    const s = Math.max(vb.w / r.width, vb.h / r.height);
    const ox = vb.x + (vb.w - r.width * s) / 2, oy = vb.y + (vb.h - r.height * s) / 2;
    const px = ox + (clientX - r.left) * s, py = oy + (clientY - r.top) * s;
    return [px / K, -py / K];
  }

  /** CSS px → model metres at the current zoom. */
  function pxToModel(px) {
    const r = svg.getBoundingClientRect();
    return (px * Math.max(vb.w / (r.width || 1), vb.h / (r.height || 1))) / K;
  }

  function fit() {
    if (!bounds) return;
    const m = 30;
    vb = { x: bounds.minX * K - m, y: -bounds.maxY * K - m, w: (bounds.maxX - bounds.minX) * K + 2 * m, h: (bounds.maxY - bounds.minY) * K + 2 * m };
    apply();
  }

  function zoomAt(clientX, clientY, factor) {
    const r = svg.getBoundingClientRect();
    const s = Math.max(vb.w / r.width, vb.h / r.height);
    const ox = vb.x + (vb.w - r.width * s) / 2, oy = vb.y + (vb.h - r.height * s) / 2;
    const px = ox + (clientX - r.left) * s, py = oy + (clientY - r.top) * s;
    const nw = Math.min(1e6, Math.max(5, vb.w / factor)), f = vb.w / nw;
    vb = { x: px - (px - vb.x) / f, y: py - (py - vb.y) / f, w: nw, h: vb.h / f };
    apply();
  }

  // ---- gestures ----
  const pointers = new Map();
  let gesture = null;
  svg.addEventListener('pointerdown', (e) => {
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const handle = e.target.closest?.('[data-handle]');
    if (pointers.size === 1) gesture = { type: handle ? 'handle' : 'tap', id: handle?.dataset.handle, x0: e.clientX, y0: e.clientY, t0: performance.now(), vb0: { ...vb }, moved: false };
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, vb0: { ...vb } };
    }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = svg.getBoundingClientRect();
    if (gesture.type === 'pinch' && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      vb = { ...gesture.vb0 };
      const s = Math.max(vb.w / r.width, vb.h / r.height);
      vb.x -= (cx - gesture.cx) * s; vb.y -= (cy - gesture.cy) * s;
      apply();
      zoomAt(cx, cy, d / gesture.d0);
      return;
    }
    if (Math.hypot(e.clientX - gesture.x0, e.clientY - gesture.y0) > 8) gesture.moved = true;
    if (gesture.type === 'handle' && gesture.moved) { cb.onHandleDrag?.(gesture.id, toModel(e.clientX, e.clientY), false); return; }
    if (gesture.moved && (gesture.type === 'tap' || gesture.type === 'pan')) {
      gesture.type = 'pan';
      const s = Math.max(gesture.vb0.w / r.width, gesture.vb0.h / r.height);
      vb = { ...gesture.vb0, x: gesture.vb0.x - (e.clientX - gesture.x0) * s, y: gesture.vb0.y - (e.clientY - gesture.y0) * s };
      apply();
    }
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (!gesture) return;
    if (gesture.type === 'handle' && gesture.moved) cb.onHandleDrag?.(gesture.id, toModel(e.clientX, e.clientY), true);
    else if ((gesture.type === 'tap' || gesture.type === 'handle') && !gesture.moved && performance.now() - gesture.t0 < 500 && e.type === 'pointerup') {
      cb.onTap?.(toModel(e.clientX, e.clientY), e);
    }
    if (pointers.size === 0) gesture = null;
    else if (gesture.type === 'pinch') gesture = null;
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.002)); }, { passive: false });

  return {
    svg,
    toModel,
    pxToModel,
    fit,
    /**
     * @param {object} drawing
     * @param {Object<string, {href:string}>} images
     * @param {{bw?:boolean, keepView?:boolean}} [opts]
     */
    setDrawing(drawing, images = {}, opts = {}) {
      const prims = drawingPrims(drawing, (x) => x * K, (y) => -y * K, K, !!opts.bw);
      content.innerHTML = primsToSvg(prims, images, { screen: true });
      const had = bounds;
      bounds = drawingBounds(drawing);
      if (!had || !opts.keepView) fit();
    },
    /** Overlay markup in model coordinates; `fn` receives a mapper M(x,y)→"px,py". */
    setOverlay(markup) { overlay.innerHTML = markup; },
    /** Map a model point to SVG user units. */
    M: (x, y) => `${x * K},${-y * K}`,
    clear() { content.innerHTML = ''; overlay.innerHTML = ''; bounds = null; },
  };
}
