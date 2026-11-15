import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const walk = (dir) => readdirSync(join(root, dir)).flatMap((n) => (statSync(join(root, dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const src = walk('src').filter((f) => f.endsWith('.js'));
// Strip comments so doc links / JSDoc do not count.
const code = (f) => readFileSync(join(root, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('core is pure', () => {
  for (const f of src.filter((x) => x.startsWith('src/core/'))) {
    const c = code(f);
    assert.ok(!/from ['"](\.\.\/app|three)/.test(c), `${f} imports UI or three.js`);
    assert.ok(!/\b(document|window|navigator|localStorage|self)\s*\.|\bHTMLElement\b/.test(c), `${f} uses DOM globals`);
  }
});

test('file size limit', () => {
  for (const f of [...src, 'sw.js', 'index.html']) {
    const n = readFileSync(join(root, f), 'utf8').split('\n').length;
    assert.ok(n <= 600, `${f} has ${n} lines`);
  }
});

test('no remote URLs', () => {
  // REQ-013 / REQ-070: no network requests to absolute http(s) URLs in app code.
  // The only allowed occurrence is the SVG XML namespace identifier (not a request).
  for (const f of [...src, 'sw.js', 'index.html']) {
    const c = code(f).replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '');
    assert.ok(!/https?:\/\//.test(c), `${f} contains an absolute URL`);
  }
});

test('privacy: no scan data in localStorage', () => {
  for (const f of src) {
    const c = code(f);
    for (const m of c.matchAll(/localStorage\.setItem\(([^)]*)\)/g)) assert.ok(!/buffer|mesh|positions|annotations/i.test(m[1]), f);
  }
});
