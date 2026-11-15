/**
 * RGBA raster → canvas / data URL / JPEG bytes (elevations, sections, terrain) and the scan
 * texture for GLB export. Browser-only.
 */
import * as THREE from 'three';

/**
 * @param {Uint8ClampedArray} rgba
 * @param {number} w
 * @param {number} h
 * @param {boolean} [whiteBackground] composite on white (JPEG has no alpha)
 */
export function rgbaToCanvas(rgba, w, h, whiteBackground = false) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  if (whiteBackground) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(tmp, 0, 0);
  return c;
}

/** PNG data URL for on-screen display (keeps transparency). */
export function rgbaToHref(rgba, w, h) {
  return rgbaToCanvas(rgba, w, h).toDataURL('image/png');
}

/** JPEG bytes (quality 0.85, white background) for SVG/PDF export (REQ-051/052). */
export async function rgbaToJpeg(rgba, w, h) {
  const c = rgbaToCanvas(rgba, w, h, true);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  if (!blob) throw new Error('Could not encode the image.');
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Decodes the scan's original base-colour texture for GLB export / backup (DEF-18).
 * glTF images are not flipped (UV origin top-left), so flipY stays false.
 * @param {{bytes:Uint8Array, mimeType:string}|null} tex
 * @returns {Promise<THREE.Texture|null>}
 */
export async function exportTexture(tex) {
  if (!tex) return null;
  const bmp = await createImageBitmap(new Blob([tex.bytes], { type: tex.mimeType }), { imageOrientation: 'none' });
  const t = new THREE.Texture(bmp);
  t.flipY = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData.mimeType = tex.mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
  return t;
}
