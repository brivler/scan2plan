/**
 * Projects tab: list, new project + import, open, rename, duplicate, delete, backup,
 * settings (storage usage, REQ-011) and the first-run install hint (REQ-060). Browser-only.
 */
import { el, toolButton, modal, promptDialog, confirmDialog, alertDialog, toast, progressOverlay, showError, withBusy } from './ui.js';
import { icon } from './icons.js';
import { showHelp } from './help.js';
import { checkFileSize, MESSAGES } from '../core/errors.js';
import { listProjects, saveProject, getProject, deleteProject, duplicateProject, updateProject, newProject } from '../store/project.js';
import { projectFromBackup } from '../store/backup.js';
import { Session } from './session.js';
import { exportGlb, backupExtras } from '../export/glb.js';
import { deliverFile } from '../export/share.js';
import { asciiSafe } from '../export/filename.js';
import { calibrationText } from '../core/measure.js';

const PERSIST_KEY = 's2p-persist-result';
const WARNED_KEY = 's2p-persist-warned';
const NOT_PERSISTENT_TEXT = 'iOS may delete app data if the phone runs low on space. Use Backup to keep a copy in Files.';

/** Safe localStorage access (only small flags, never scan data — REQ-076). */
const flag = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

function isStandalone() {
  return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
}

/**
 * @param {object} app
 * @param {HTMLElement} root
 */
export function createProjectsView(app, root) {
  const list = el('div');
  const scroll = el('div', { class: 'scroll' });
  root.append(scroll);
  const fileInput = el('input', { type: 'file', class: 'sr-only', 'aria-label': 'Choose scan file' }); // no accept attribute (REQ-004)
  document.body.append(fileInput);

  function pickFile() {
    return new Promise((resolve) => {
      fileInput.value = '';
      fileInput.onchange = () => resolve(fileInput.files[0] || null);
      fileInput.click();
    });
  }

  async function render() {
    const projects = await listProjects(app.db);
    const items = projects.map((p) => {
      const thumb = p.thumbnail ? el('img', { src: URL.createObjectURL(p.thumbnail), alt: '' }) : el('div', { class: 'thumb' });
      return el('div', { class: 'card project' }, [
        thumb,
        el('div', {}, [
          el('div', { class: 'name' }, p.name),
          el('div', { class: 'muted' }, `${p.updatedAt.slice(0, 10)} · ${(p.storageBytes / 1048576).toFixed(1)} MB · ${p.annotations.length} ${p.annotations.length === 1 ? 'item' : 'items'}`),
        ]),
        el('div', { class: 'actions' }, [
          el('button', { type: 'button', class: 'btn primary', onclick: () => open(p.id) }, 'Open'),
          el('button', { type: 'button', class: 'btn', onclick: () => rename(p) }, 'Rename'),
          el('button', { type: 'button', class: 'btn', onclick: () => duplicate(p) }, 'Duplicate'),
          el('button', { type: 'button', class: 'btn', onclick: () => backup(p.id) }, 'Backup'),
          el('button', { type: 'button', class: 'btn danger', onclick: () => remove(p) }, 'Delete'),
        ]),
      ]);
    });
    list.replaceChildren(...(items.length ? items : [el('div', { class: 'empty' }, 'No projects yet. Tap “New project” and pick a GLB, OBJ or PLY scan from Files.')]));
  }

  const intro = [];
  if (!isStandalone()) {
    intro.push(el('div', { class: 'warn', style: 'margin-bottom:12px' }, [
      el('strong', {}, 'Install on your iPhone: '),
      'in Safari tap Share → “Add to Home Screen”. The app then works offline like a normal app.',
    ]));
  }
  const newBtn = el('button', { type: 'button', class: 'btn primary block', onclick: () => createProject() });
  newBtn.innerHTML = `${icon('plus')}<span>New project / import scan</span>`;
  scroll.append(...intro, newBtn, el('p', { class: 'muted' }, 'Also restores backups (.s2p.glb).'), list);

  async function createProject() {
    const file = await pickFile();
    if (!file) return;
    try {
      if (checkFileSize(file.size) && !(await confirmDialog('Large file', MESSAGES['W-IMP-01'], 'Continue'))) return;
    } catch (e) { await showError(e, 'Cannot open file'); return; }
    let cancelled = false;
    const ov = progressOverlay('Importing scan', () => { cancelled = true; app.client.cancel(); });
    let load;
    try {
      const buffer = await file.arrayBuffer();
      load = await app.client.call('load', { buffer, transform: null }, { transfer: [buffer], onProgress: (v, l) => ov.update(v, l) });
    } catch (e) {
      ov.close();
      if (!cancelled) await showError(e, 'Import failed');
      return;
    }
    ov.close();
    try {
      let project;
      if (load.extras && load.extras.scan2plan) {
        project = projectFromBackup(load.extras.scan2plan, file, file.name, load.format);
        toast('Backup restored');
      } else {
        const name = await promptDialog({ title: 'New project', label: 'Project name', value: file.name.replace(/\.[^.]+$/, '').slice(0, 80), maxLength: 80, validate: (v) => (v.trim() ? null : 'Please enter a project name.') });
        if (name === null) return;
        let unitScale = 1;
        if (load.unit.scale && (await confirmDialog('Units', load.unit.message, `Scale ×${load.unit.scale}`))) unitScale = load.unit.scale;
        else if (load.unit.warning) await alertDialog('Units', load.unit.message);
        const orient = await withBusy('Orienting model', () => app.client.call('autoOrient', { unitScale }));
        project = newProject({ name, sourceFile: file, sourceName: file.name, sourceFormat: load.format, kind: load.kind });
        project.orientation = orient.matrix;
        project.transform = orient.matrix;
      }
      await app.client.call('setTransform', { matrix: project.transform });
      await saveProject(app.db, project);
      await requestPersistence();
      startSession(project, load);
      await render();
    } catch (e) { await showError(e, 'Import failed'); }
  }

  /** navigator.storage.persist() only after a user-initiated import (REQ-011). */
  async function requestPersistence() {
    if (flag.get(PERSIST_KEY) !== null || !navigator.storage?.persist) return;
    const granted = await navigator.storage.persist().catch(() => false);
    flag.set(PERSIST_KEY, String(granted));
    if (!granted && !flag.get(WARNED_KEY)) {
      flag.set(WARNED_KEY, '1');
      await alertDialog('Storage', NOT_PERSISTENT_TEXT);
    }
  }

  function startSession(project, load) {
    const { sourceFile, ...meta } = project;
    const session = new Session({ db: app.db, client: app.client, project: meta, load });
    app.setSession(session);
    app.go('3d');
    setTimeout(() => app.views['3d'].captureThumbnail?.().then((blob) => {
      if (blob) updateProject(app.db, project.id, { thumbnail: blob }).then(render);
    }), 600);
  }

  async function open(id) {
    let cancelled = false;
    const ov = progressOverlay('Opening project', () => { cancelled = true; app.client.cancel(); });
    try {
      const p = await getProject(app.db, id, { withSource: true });
      if (!p || !p.sourceFile) throw new Error('The scan file of this project is missing. Restore it from a backup.');
      const buffer = await p.sourceFile.arrayBuffer();
      const load = await app.client.call('load', { buffer, transform: p.transform }, { transfer: [buffer], onProgress: (v, l) => ov.update(v, l) });
      ov.close();
      startSession(p, load);
    } catch (e) {
      ov.close();
      if (!cancelled) await showError(e, 'Cannot open project');
    }
  }

  async function rename(p) {
    const name = await promptDialog({ title: 'Rename project', label: 'Project name', value: p.name, maxLength: 80, validate: (v) => (v.trim() ? null : 'Please enter a project name.') });
    if (name === null) return;
    await updateProject(app.db, p.id, { name: name.trim() });
    if (app.session?.project.id === p.id) app.session.project.name = name.trim();
    render();
  }

  async function duplicate(p) {
    await withBusy('Duplicating', () => duplicateProject(app.db, p.id));
    render();
  }

  async function remove(p) {
    if (!(await confirmDialog('Delete project', `Delete “${p.name}” and its scan from this iPhone? This cannot be undone.`, 'Delete', true))) return;
    if (app.session?.project.id === p.id) app.setSession(null);
    await deleteProject(app.db, p.id);
    render();
  }

  /** Backup (REQ-012): oriented mesh + project JSON as <name>.s2p.glb. Opens the project if needed. */
  async function backup(id) {
    try {
      if (app.session?.project.id !== id) await open(id);
      const s = app.session;
      if (!s || s.project.id !== id) return;
      await s.save();
      const file = await withBusy('Preparing backup', async () => {
        const mesh = await app.client.call('worldMesh');
        const p = { ...s.project, annotations: s.annotations, settings: s.settings, calibration: s.edit.state.calibration, scale: s.scale };
        const buf = await exportGlb(mesh, { extras: backupExtras(p) });
        return new File([buf], `${asciiSafe(s.project.name)}.s2p.glb`, { type: 'model/gltf-binary' });
      });
      await readyToShare(file);
    } catch (e) { showError(e, 'Backup failed'); }
  }

  async function settings() {
    const body = el('div');
    const est = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => null) : null;
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => false) : false;
    body.append(
      el('dl', { class: 'result-grid' }, [
        el('dt', {}, 'Storage used'), el('dd', {}, est ? `${(est.usage / 1048576).toFixed(1)} MB` : 'unknown'),
        el('dt', {}, 'Storage available'), el('dd', {}, est ? `${(est.quota / 1048576).toFixed(0)} MB` : 'unknown'),
        el('dt', {}, 'Persistent storage'), el('dd', {}, persisted ? 'yes' : 'no'),
      ]),
    );
    if (!persisted) body.append(el('p', { class: 'warn' }, NOT_PERSISTENT_TEXT));
    if (app.session) body.append(el('p', { class: 'muted' }, `Open project: ${app.session.project.name} — ${calibrationText(app.session.edit.state.calibration)}`));
    body.append(el('p', { class: 'muted' }, 'Scan2Plan works offline. No data leaves this iPhone unless you share an export.'));
    await modal({ title: 'Settings', body, actions: [{ label: 'Close', value: true, primary: true }] });
  }

  return {
    show() {
      app.setTitle('Projects');
      app.setActions([toolButton('settings', 'Settings', settings, { class: 'compact' }), toolButton('help', 'Help', showHelp, { class: 'compact' })]);
      render();
    },
  };
}

/**
 * Two-step share (REQ-050): generation happens first, then "Ready — tap Share" so that
 * navigator.share runs directly inside a tap (user activation).
 * @param {File} file
 */
export async function readyToShare(file) {
  const go = await modal({
    title: 'Ready — tap Share',
    body: `${file.name} (${(file.size / 1024).toFixed(0)} KB)`,
    actions: [{ label: 'Cancel', value: false }, { label: 'Share', value: true, primary: true }],
  });
  if (go) {
    const r = await deliverFile(file, file.name);
    if (r === 'downloaded') toast('Downloaded');
  }
}
