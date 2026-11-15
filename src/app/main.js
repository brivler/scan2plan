/**
 * App bootstrap: capability checks, storage, tabs, service worker and update banner
 * (REQ-060, REQ-064, REQ-071, REQ-077). Browser-only.
 */
import { openDb } from '../store/idb.js';
import { GeometryClient } from './geometry-client.js';
import { icon } from './icons.js';
import { el, alertDialog } from './ui.js';
import { createProjectsView } from './projects-view.js';
import { create3DView } from './viewer3d.js';
import { createPlanView } from './plan-view.js';
import { createViewsView } from './views-view.js';
import { createTerrainView } from './terrain-view.js';

const TABS = [
  ['projects', 'projects', 'Projects'], ['3d', 'cube', '3D'], ['plan', 'plan', 'Plan'],
  ['views', 'views', 'Views'], ['terrain', 'terrain', 'Terrain'],
];

/** True when the device can render WebGL2 (REQ-077). */
function hasWebGL2() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

async function boot() {
  for (const [id, ic, label] of TABS) {
    const b = document.querySelector(`.tab[data-tab="${id}"]`);
    b.innerHTML = `${icon(ic)}<span>${label}</span>`;
  }
  if (!hasWebGL2()) {
    document.getElementById('view-projects').append(el('p', { class: 'warn', style: 'margin:16px' }, 'This device does not support WebGL2.'));
    return;
  }
  let db;
  try { db = await openDb(); } catch (e) { await alertDialog('Storage unavailable', e.message); return; }

  const app = {
    db,
    client: new GeometryClient(),
    session: null,
    views: {},
    current: 'projects',
    setTitle(text) { document.getElementById('title').textContent = text; },
    setActions(nodes) { document.getElementById('topbar-actions').replaceChildren(...nodes); },
    /** Switches tab; project tabs are disabled until a project is open. */
    go(tab) {
      if (tab !== 'projects' && !app.session) return;
      if (app.views[app.current]) app.views[app.current].hide?.();
      app.current = tab;
      for (const s of document.querySelectorAll('.view')) s.hidden = s.dataset.view !== tab;
      for (const b of document.querySelectorAll('.tab')) b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false');
      app.views[tab].show();
    },
    /** Called when a session opens/closes. */
    setSession(session) {
      if (app.session) app.session.save().catch(() => {});
      app.session = session;
      for (const b of document.querySelectorAll('.tab')) b.disabled = b.dataset.tab !== 'projects' && !session;
      for (const v of Object.values(app.views)) v.onSession?.(session);
    },
  };
  app.views.projects = createProjectsView(app, document.getElementById('view-projects'));
  app.views['3d'] = create3DView(app, document.getElementById('view-3d'));
  app.views.plan = createPlanView(app, document.getElementById('view-plan'));
  app.views.views = createViewsView(app, document.getElementById('view-views'));
  app.views.terrain = createTerrainView(app, document.getElementById('view-terrain'));
  for (const b of document.querySelectorAll('.tab')) b.addEventListener('click', () => app.go(b.dataset.tab));
  app.setSession(null);
  app.go('projects');
  addEventListener('pagehide', () => app.session?.save());
  document.addEventListener('visibilitychange', () => { if (document.hidden) app.session?.save(); });
  registerServiceWorker(app);
}

/** Registers sw.js, checks for updates at launch and shows the update banner (never auto-reloads). */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const banner = document.getElementById('update-banner');
  navigator.serviceWorker.register('./sw.js', { scope: './' }).then((reg) => {
    reg.update().catch(() => {});
    const offer = (worker) => {
      banner.hidden = false;
      document.getElementById('update-reload').onclick = () => worker.postMessage('SKIP_WAITING');
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
  }).catch((e) => console.warn('Service worker registration failed', e));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || banner.hidden) return; // only after the user tapped Reload
    reloading = true;
    location.reload();
  });
}

boot();
