/**
 * Export dialog (REQ-050…REQ-055, REQ-041, REQ-042): format, paper, scale, B/W, author;
 * generates the file first, then offers "Ready — tap Share". Browser-only.
 */
import { el, modal, segmented, showError, withBusy, alertDialog, confirmDialog } from './ui.js';
import { layoutSheet, fitScale, SCALES } from '../export/sheet.js';
import { sheetToSvg } from '../export/svg.js';
import { sheetToPdf } from '../export/pdf.js';
import { drawingToDxf } from '../export/dxf.js';
import { exportGlb } from '../export/glb.js';
import { exportFileName, isoDate } from '../export/filename.js';
import { markupCsv } from '../core/markup.js';
import { rgbaToJpeg, exportTexture } from './images.js';
import { transformPositions } from '../core/mesh.js';
import { readyToShare } from './projects-view.js';

const GLB_FULL_LIMIT = 2_000_000;

/**
 * @param {object} app
 * @param {{view:string, drawing:()=>object, raster?:{rgba:Uint8ClampedArray, width:number, height:number}|null, csv?:boolean}} o
 */
export async function openExport(app, o) {
  const s = app.session;
  const st = s.settings;
  const opts = { format: 'pdf', paper: st.paper, orientation: st.orientation, scale: st.scale, bw: st.bw, author: st.author };
  const body = el('div');
  const formats = [{ value: 'pdf', label: 'PDF' }, { value: 'svg', label: 'SVG' }, { value: 'dxf', label: 'DXF' }, { value: 'glb', label: 'GLB' }];
  if (o.csv) formats.push({ value: 'csv', label: 'CSV' });
  const paperBox = el('div');
  const scaleSel = el('select', { class: 'input', 'aria-label': 'Scale' }, [el('option', { value: 'fit' }, 'Fit'), ...SCALES.map((x) => el('option', { value: String(x) }, `1:${x}`)), el('option', { value: '1000' }, '1:1000')]);
  scaleSel.value = String(opts.scale);
  scaleSel.onchange = () => { opts.scale = scaleSel.value === 'fit' ? 'fit' : Number(scaleSel.value); };
  const bw = el('input', { type: 'checkbox', checked: opts.bw, onchange: () => { opts.bw = bw.checked; } });
  const author = el('input', { class: 'input', value: opts.author || '', maxlength: 60, oninput: () => { opts.author = author.value; } });
  paperBox.append(
    el('div', { class: 'field', role: 'group', 'aria-label': 'Paper' }, ['Paper', segmented([{ value: 'A4', label: 'A4' }, { value: 'A3', label: 'A3' }], opts.paper, (v) => { opts.paper = v; })]),
    el('div', { class: 'field', role: 'group', 'aria-label': 'Orientation' }, ['Orientation', segmented([{ value: 'landscape', label: 'Landscape' }, { value: 'portrait', label: 'Portrait' }], opts.orientation, (v) => { opts.orientation = v; })]),
    el('label', { class: 'field' }, ['Scale', scaleSel]),
    el('label', { class: 'check' }, [bw, 'Black and white']),
    el('label', { class: 'field' }, ['Author (optional)', author]),
  );
  const note = el('p', { class: 'muted' });
  const updateFormat = (f) => {
    opts.format = f;
    paperBox.hidden = !(f === 'pdf' || f === 'svg');
    note.textContent = { pdf: 'Print at 100 % (actual size) for exact scale.', svg: 'Vector drawing in paper millimetres.', dxf: 'CAD file in metres at 1:1 with layers.', glb: 'Oriented, calibrated 3D model (+Y up, metres).', csv: 'Markup list for Excel / Numbers (German format).' }[f];
  };
  body.append(el('div', { class: 'field', role: 'group', 'aria-label': 'Format' }, ['Format', segmented(formats, opts.format, updateFormat)]), paperBox, note);
  updateFormat(opts.format);
  const go = await modal({ title: 'Export', body, actions: [{ label: 'Cancel', value: false }, { label: 'Create file', value: true, primary: true }] });
  if (!go) return;
  s.setSettings({ paper: opts.paper, orientation: opts.orientation, scale: opts.scale, bw: opts.bw, author: opts.author });
  try {
    const file = await withBusy('Creating file', () => build(app, o, opts));
    if (file) await readyToShare(file);
  } catch (e) { showError(e, 'Export failed'); }
}

async function build(app, o, opts) {
  const s = app.session;
  const date = isoDate();
  const project = s.project.name;
  if (opts.format === 'glb') {
    let mesh;
    if (s.load.triangles > GLB_FULL_LIMIT) {
      const d = s.load.display;
      await alertDialog('Large model', 'The scan has more than 2 million triangles; the simplified display model is exported instead.');
      mesh = { positions: transformPositions(d.positions, s.transform), indices: d.indices, colors: d.colors, uvs: d.uvs };
    } else mesh = await app.client.call('worldMesh');
    const texture = mesh.uvs ? await exportTexture(s.load.texture).catch(() => null) : null;
    const buf = await exportGlb(mesh, { texture });
    return new File([buf], exportFileName({ project, view: 'model', date, ext: 'glb' }), { type: 'model/gltf-binary' });
  }
  if (opts.format === 'csv') {
    return new File([markupCsv(s.annotations)], exportFileName({ project, view: 'markup', date, ext: 'csv' }), { type: 'text/csv' });
  }
  const drawing = o.drawing();
  if (opts.format === 'dxf') {
    return new File([drawingToDxf(drawing)], exportFileName({ project, view: o.view, date, ext: 'dxf' }), { type: 'application/dxf' });
  }
  let scale = opts.scale;
  if (scale === 'fit') {
    const f = fitScale(drawing, opts.paper, opts.orientation);
    if (f.error) {
      if (!(await confirmDialog('Scale', `${f.error}. Use 1:${f.suggest}?`, `Use 1:${f.suggest}`))) return null;
      scale = f.suggest;
    } else scale = f.scale;
  }
  const sheet = layoutSheet(drawing, {
    paper: opts.paper, orientation: opts.orientation, scale, bw: opts.bw, project, date,
    calibration: s.edit.state.calibration, author: opts.author,
  });
  const images = {};
  if (o.raster) images.view = { jpeg: await rgbaToJpeg(o.raster.rgba, o.raster.width, o.raster.height) };
  const name = exportFileName({ project, view: o.view, scale, date, ext: opts.format });
  if (opts.format === 'svg') return new File([sheetToSvg(sheet, images)], name, { type: 'image/svg+xml' });
  return new File([sheetToPdf(sheet, images)], name, { type: 'application/pdf' });
}
