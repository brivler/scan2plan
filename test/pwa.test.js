import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { appFiles, buildHash } from '../tools/gen-precache.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('manifest.webmanifest'));
const html = read('index.html');

/** PNG width/height from the IHDR chunk. */
function pngSize(path) {
  const b = readFileSync(new URL(`../${path}`, import.meta.url));
  assert.equal(b.toString('ascii', 12, 16), 'IHDR');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test('manifest', () => {
  assert.equal(manifest.name, 'Scan2Plan');
  assert.equal(manifest.short_name, 'Scan2Plan');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.ok(manifest.background_color && manifest.theme_color);
  assert.ok(html.includes('<link rel="apple-touch-icon" href="icons/apple-touch-icon-180.png">'));
  assert.ok(html.includes('<meta name="apple-mobile-web-app-capable" content="yes">'));
  assert.ok(html.includes('<meta name="mobile-web-app-capable" content="yes">'));
  assert.ok(html.includes('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">'));
  assert.ok(html.includes('viewport-fit=cover'));
  assert.ok(html.includes('rel="manifest" href="manifest.webmanifest"'));
});

test('icons', () => {
  const want = { '192x192:any': 192, '512x512:any': 512, '512x512:maskable': 512 };
  for (const [key, size] of Object.entries(want)) {
    const [sizes, purpose] = key.split(':');
    const icon = manifest.icons.find((i) => i.sizes === sizes && (i.purpose || 'any').includes(purpose));
    assert.ok(icon, `icon ${key}`);
    assert.deepEqual(pngSize(icon.src), [size, size]);
  }
  assert.deepEqual(pngSize('icons/apple-touch-icon-180.png'), [180, 180]);
});

test('relative paths', () => {
  const sw = read('sw.js');
  for (const [name, text] of [['manifest', JSON.stringify(manifest)], ['index', html], ['sw', sw]]) {
    assert.ok(!/(src|href|start_url|scope)["']?\s*[:=]\s*["']\//.test(text), `absolute path in ${name}`);
    assert.ok(!/["']\/(src|vendor|icons|index|sw|manifest)/.test(text), `absolute path in ${name}`);
  }
});

test('help content', () => {
  const help = read('src/app/help.js');
  for (const s of ['structural engineer', '±2 cm', 'GLB', 'Tragwerksplaner', 'LiDAR range is about', 'Save to Files']) assert.ok(help.includes(s), s);
});

test('precache complete', () => {
  const list = read('src/precache-list.js');
  const m = /self\.S2P_PRECACHE = (\[[\s\S]*?\]);/.exec(list);
  const entries = new Set(JSON.parse(m[1]));
  for (const f of appFiles()) assert.ok(entries.has(f), `missing from precache: ${f}`);
  for (const e of entries) if (e !== './') assert.ok(existsSync(new URL(`../${e.slice(2)}`, import.meta.url)), `stale entry ${e}`);
  const version = JSON.parse(read('package.json')).version;
  assert.ok(list.includes(`self.S2P_APP_VERSION = "${version}"`));
  assert.ok(read('sw.js').includes('scan2plan-v${self.S2P_APP_VERSION}-${self.S2P_BUILD}'));
  // content hash must match the files, otherwise installed apps would never see the update (DEF-08)
  assert.ok(list.includes(`self.S2P_BUILD = "${buildHash()}"`), 'src/precache-list.js is stale: run npm run precache');
  assert.ok(read('src/app/main.js').includes("updateViaCache: 'none'"));
});

test('vendor version', () => {
  assert.equal(read('vendor/three/VERSION').trim(), '0.187.0');
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.dependencies, undefined);
  for (const f of ['three.module.js', 'three.core.js', 'LICENSE', 'addons/loaders/GLTFLoader.js', 'addons/loaders/OBJLoader.js', 'addons/loaders/PLYLoader.js', 'addons/exporters/GLTFExporter.js', 'addons/controls/OrbitControls.js', 'addons/utils/BufferGeometryUtils.js']) {
    assert.ok(existsSync(new URL(`../vendor/three/${f}`, import.meta.url)), f);
  }
  assert.match(html, /"three": "\.\/vendor\/three\/three\.module\.js"/);
  assert.match(html, /"three\/addons\/": "\.\/vendor\/three\/addons\/"/);
});
