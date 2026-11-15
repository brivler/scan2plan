/**
 * GLB export through three.js GLTFExporter (REQ-055) and project backup (REQ-012):
 * the mesh is written in world coordinates (+Y up, metres, transform baked); the backup
 * stores the project JSON in `asset.extras.scan2plan`.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

/** Backup schema version. */
export const BACKUP_SCHEMA = 1;

/**
 * @param {{positions:Float32Array, indices:Uint32Array|null, colors?:Uint8Array, uvs?:Float32Array}} mesh world mesh
 * @param {{extras?:object, texture?:THREE.Texture|null}} [opts]
 * @returns {Promise<ArrayBuffer>}
 */
export async function exportGlb(mesh, opts = {}) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  if (mesh.colors) geo.setAttribute('color', new THREE.BufferAttribute(srgbToLinear(mesh.colors), 3)); // glTF COLOR_0 is linear (DEF-12)
  if (mesh.uvs && opts.texture) geo.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2));
  let obj;
  if (mesh.indices) {
    geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    const mat = new THREE.MeshStandardMaterial({ color: mesh.colors || opts.texture ? 0xffffff : 0xb0b0b0, vertexColors: !!mesh.colors && !opts.texture, map: opts.texture || null, roughness: 1, metalness: 0 });
    obj = new THREE.Mesh(geo, mat);
  } else {
    obj = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.01, vertexColors: !!mesh.colors }));
  }
  obj.name = 'scan';
  const scene = new THREE.Scene();
  scene.add(obj);
  const exporter = new GLTFExporter();
  if (opts.extras) {
    exporter.register((writer) => ({ afterParse() { writer.json.asset.extras = opts.extras; } }));
  }
  return exporter.parseAsync(scene, { binary: true, onlyVisible: false });
}

/**
 * sRGB bytes (as stored by the importer) → linear float colours for glTF COLOR_0.
 * @param {Uint8Array} c
 */
export function srgbToLinear(c) {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const v = i / 255; lut[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  const out = new Float32Array(c.length);
  for (let i = 0; i < c.length; i++) out[i] = lut[c[i]];
  return out;
}

/**
 * Project → backup extras. Excludes the source blob (the GLB itself becomes the source).
 * @param {object} project
 */
export function backupExtras(project) {
  return {
    scan2plan: {
      schema: BACKUP_SCHEMA,
      name: project.name,
      createdAt: project.createdAt,
      annotations: project.annotations,
      settings: project.settings,
      calibration: project.calibration || null,
      scale: project.scale ?? 1,
      sourceName: project.sourceName,
    },
  };
}
