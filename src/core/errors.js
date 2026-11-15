/**
 * Import limits, error codes and user-facing messages (REQ-004).
 * Pure module: no DOM, no three.js.
 */

/** Hard file-size limit (E-IMP-06). */
export const MAX_FILE_BYTES = 300 * 1024 * 1024;
/** Above this size the user is warned before parsing (W-IMP-01). */
export const WARN_FILE_BYTES = 100 * 1024 * 1024;
/** Maximum triangles after parsing (E-IMP-05). */
export const MAX_TRIANGLES = 5_000_000;
/** Maximum points for point clouds (E-IMP-05). */
export const MAX_POINTS = 10_000_000;

/** Exact user-facing texts, keyed by code. */
export const MESSAGES = Object.freeze({
  'E-IMP-01': 'Unsupported file type. Please export GLB (recommended), OBJ or PLY from your scanner app.',
  'E-IMP-02': 'The file could not be read. It may be damaged or incomplete — export it again.',
  'E-IMP-03': 'This PLY file is a Gaussian splat, not a mesh. In Scaniverse choose Export → Mesh → GLB.',
  'E-IMP-04': 'This file uses compression that is not supported. Export without Draco/mesh compression.',
  'E-IMP-05': 'The scan is too large (more than 5 million triangles). Export a smaller area or lower detail.',
  'E-IMP-06': 'File larger than 300 MB cannot be opened on iPhone.',
  'E-IMP-07': 'The file contains no geometry.',
  'W-IMP-01': 'Large file — loading may take up to 1 minute and can fail on older iPhones.',
});

/** Error carrying one of the codes above. */
export class ImportError extends Error {
  /**
   * @param {keyof typeof MESSAGES} code
   * @param {string} [detail] technical detail for logs (not shown to the user)
   */
  constructor(code, detail) {
    super(MESSAGES[code] || code);
    this.name = 'ImportError';
    this.code = code;
    this.detail = detail || '';
  }
}

/**
 * Throws E-IMP-06 if the file is too large; returns true if W-IMP-01 applies.
 * @param {number} bytes
 * @returns {boolean} whether the large-file warning should be shown
 */
export function checkFileSize(bytes) {
  if (bytes > MAX_FILE_BYTES) throw new ImportError('E-IMP-06');
  return bytes > WARN_FILE_BYTES;
}
