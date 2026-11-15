import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exportFileName, asciiSafe } from '../src/export/filename.js';

test('filename', () => {
  assert.equal(exportFileName({ project: 'Küche Süd', view: 'plan', scale: 50, date: '2026-11-15', ext: 'pdf' }), 'Kueche_Sued_plan_1-50_2026-11-15.pdf');
  assert.equal(asciiSafe('Straße/Ö'), 'Strasse_Oe');
  assert.equal(exportFileName({ project: 'A', view: 'model', scale: null, date: '2026-11-15', ext: 'glb' }), 'A_model_2026-11-15.glb');
});

test('share fallback order', () => {
  const src = readFileSync(new URL('../src/export/share.js', import.meta.url), 'utf8');
  const i1 = src.indexOf('navigator.share('), i2 = src.indexOf('a.download'), i3 = src.indexOf('window.open');
  assert.ok(i1 > 0 && i1 < i2 && i2 < i3);
});
