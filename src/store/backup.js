/**
 * Restoring a project from a `.s2p.glb` backup (REQ-012). The backup GLB already contains the
 * oriented, calibrated mesh, so the restored project uses it as source with identity transform.
 */
import { identity } from '../core/mat4.js';
import { newProject, DEFAULT_SETTINGS } from './project.js';

/**
 * @param {object} data `asset.extras.scan2plan`
 * @param {Blob} file the backup file (becomes the project source)
 * @param {string} fileName
 * @param {string} format detected format
 */
export function projectFromBackup(data, file, fileName, format) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.annotations)) throw new Error('This backup file is damaged (project data missing).');
  if (data.schema > 1) throw new Error('This backup was made by a newer Scan2Plan version. Update the app and try again.');
  const p = newProject({ name: data.name || fileName.replace(/\.s2p\.glb$/i, ''), sourceFile: file, sourceName: data.sourceName || fileName, sourceFormat: format });
  p.createdAt = data.createdAt || p.createdAt;
  p.annotations = data.annotations;
  p.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  // The backup mesh already contains the calibration scale: keep it only as display metadata
  // (`baked`) so it is never applied again (DEF-01).
  const c = data.calibration;
  p.calibration = c ? { factor: 1, refCm: c.refCm, baked: (c.factor || 1) * (c.baked || 1) } : null;
  p.orientation = identity();
  p.scale = 1;
  p.transform = identity();
  return p;
}
