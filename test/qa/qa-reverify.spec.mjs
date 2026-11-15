/**
 * QA re-verification (round 2), browser: DEF-02 at every import/open stage (including what a
 * Backup then contains) and DEF-18 (texture kept in backups).
 *   S2P_BROWSER=chrome npx playwright test -c test/qa/playwright.qa.config.mjs qa-reverify
 */
import { test, expect } from '@playwright/test';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeGlb } from '../helpers/glb.js';
import { box, plane } from '../helpers/meshes.js';
import { importScan } from '../../src/core/import.js';
import { computeBBox } from '../../src/core/mesh.js';
import { texturedGlb, toObj } from './qa-helpers.js';

const ROOM = fileURLToPath(new URL('../fixtures/room.glb', import.meta.url)); // 4 × 3 × 2.5
const OTHER = { name: 'other.glb', mimeType: 'application/octet-stream', buffer: Buffer.from(makeGlb([box(6, 5, 2.5)])) };
const SPLAT = { name: 'scan.ply', mimeType: 'application/octet-stream', buffer: Buffer.from('ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nproperty float opacity\nend_header\n0 0 0 1\n') };
const DAMAGED_BACKUP = { name: 'broken.s2p.glb', mimeType: 'application/octet-stream', buffer: Buffer.from(makeGlb([box(6, 5, 2.5)], { extras: { scan2plan: { schema: 1, name: 'x' } } })) };
const JPEG = new Uint8Array(readFileSync(new URL('./fixtures/gradient.jpg', import.meta.url)));

let bigObjPath = null;
function bigObj(testInfo) {
  if (!bigObjPath) {
    bigObjPath = testInfo.outputPath('big.obj');
    writeFileSync(bigObjPath, toObj(plane(30, 700, (x, z) => 0.05 * Math.sin(x + z)), [0, 0, 0], 3)); // ≈ 1 M triangles
  }
  return bigObjPath;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    navigator.canShare = () => true;
    navigator.share = async ({ files }) => { window.__files = files; window.__shared = files.map((f) => f.name); };
  });
  await page.goto('./');
});

async function pick(page, file) {
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.tab[data-tab="projects"]').click();
  await page.locator('#view-projects').getByRole('button', { name: /New project/ }).click();
  await (await chooser).setFiles(file);
}

async function importNamed(page, file, name) {
  await pick(page, file);
  await page.getByRole('dialog', { name: 'New project' }).getByRole('textbox').fill(name);
  await page.getByRole('button', { name: 'OK' }).click();
  await page.getByRole('dialog', { name: 'Storage' }).getByRole('button', { name: 'OK' }).click({ timeout: 2500 }).catch(() => {});
  await expect(page.locator('#view-3d canvas')).toBeVisible();
}

/** Room A is still intact: fresh plan computation shows 4.00 m and no 6.00 m, and Backup contains a 4×3 m mesh. */
async function expectRoomAIntact(page) {
  for (const d of page.getByRole('dialog').all ? await page.getByRole('dialog').all() : []) await d.getByRole('button', { name: 'OK' }).click({ timeout: 1000 }).catch(() => {});
  await expect(page.locator('.modal-backdrop')).toHaveCount(0, { timeout: 15_000 });
  await page.locator('.tab[data-tab="plan"]').click();
  const num = page.locator('#view-plan input[type=number]');
  await num.fill(String((1.0 + Math.random() * 0.2).toFixed(2)));
  await num.press('Enter'); await num.blur();
  await page.waitForTimeout(700);
  await expect(page.locator('#view-plan svg text', { hasText: /^400$/ }).first()).toBeVisible();
  await expect(page.locator('#view-plan svg text', { hasText: /^600$/ })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Backup of the open project must contain project A's geometry
  await page.locator('.tab[data-tab="projects"]').click();
  await page.evaluate(() => { window.__files = null; });
  await page.locator('.project', { hasText: 'Room A' }).getByRole('button', { name: 'Backup' }).click();
  await page.getByRole('dialog', { name: 'Ready — tap Share' }).getByRole('button', { name: 'Share' }).click();
  const bytes = await page.evaluate(async () => { for (let i = 0; i < 100 && !window.__files; i++) await new Promise((r) => setTimeout(r, 100)); return [...new Uint8Array(await window.__files[0].arrayBuffer())]; });
  const r = importScan(new Uint8Array(bytes).buffer);
  const bb = computeBBox(r.mesh.positions);
  const ext = [0, 2].map((k) => +(bb.max[k] - bb.min[k]).toFixed(2)).sort();
  expect(ext).toEqual([3, 4]);
  expect(r.extras.scan2plan.name).toBe('Room A');
}

test('DEF-02 r2: Cancel at the name prompt', async ({ page }) => {
  await importNamed(page, ROOM, 'Room A');
  await pick(page, OTHER);
  await page.getByRole('dialog', { name: 'New project' }).getByRole('button', { name: 'Cancel' }).click();
  await expectRoomAIntact(page);
});

test('DEF-02 r2: Cancel button while the new scan is still parsing', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await importNamed(page, ROOM, 'Room A');
  await pick(page, bigObj(testInfo));
  const cancel = page.getByRole('dialog', { name: 'Importing scan' }).getByRole('button', { name: 'Cancel' });
  const name = page.getByRole('dialog', { name: 'New project' });
  await expect(cancel.or(name)).toBeVisible();
  if (await cancel.isVisible()) await cancel.click();
  else await name.getByRole('button', { name: 'Cancel' }).click(); // parse finished first: cancel at the next stage
  await expectRoomAIntact(page);
});

test('DEF-02 r2: parse error (splat PLY) while a project is open', async ({ page }) => {
  await importNamed(page, ROOM, 'Room A');
  await pick(page, SPLAT);
  await expect(page.getByRole('dialog', { name: 'Import failed' })).toContainText('E-IMP-03');
  await page.getByRole('button', { name: 'OK' }).click();
  await expectRoomAIntact(page);
});

test('DEF-02 r2: damaged backup (parses, then fails while restoring) while a project is open', async ({ page }) => {
  await importNamed(page, ROOM, 'Room A');
  await pick(page, DAMAGED_BACKUP);
  await expect(page.getByRole('dialog', { name: 'Import failed' })).toContainText('damaged');
  await page.getByRole('button', { name: 'OK' }).click();
  await expectRoomAIntact(page);
});

test('DEF-02 r2: Cancel while opening another (large) project', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await importNamed(page, bigObj(testInfo), 'Big');
  await importNamed(page, ROOM, 'Room A');
  await page.locator('.tab[data-tab="projects"]').click();
  // slow the renderer (and its worker) down so Cancel lands while the project is still loading
  const cdp = test.info().project.use.browserName === 'chromium' ? await page.context().newCDPSession(page) : null;
  if (cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 30 });
  await page.locator('.project', { hasText: 'Big' }).getByRole('button', { name: 'Open' }).click();
  const cancel = page.getByRole('dialog', { name: 'Opening project' }).getByRole('button', { name: 'Cancel' });
  const cancelled = await cancel.click({ timeout: 5000 }).then(() => true, () => false);
  if (cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  test.skip(!cancelled, 'open finished before Cancel could be pressed (timing)');
  await expect(page.locator('.modal-backdrop')).toHaveCount(0, { timeout: 30_000 });
  if ((await page.locator('#title').textContent()).startsWith('Big')) {
    // DEF-22: Cancel pressed while the source is still being read (IndexedDB / arrayBuffer) is
    // ignored and the project opens anyway. State is consistent; reopen Room A and check it.
    test.info().annotations.push({ type: 'DEF-22', description: 'Cancel during source read ignored; Big opened' });
    await page.locator('.tab[data-tab="projects"]').click();
    await page.locator('.project', { hasText: 'Room A' }).getByRole('button', { name: 'Open' }).click();
    await expect(page.locator('#title')).toHaveText('Room A');
  }
  await expectRoomAIntact(page);
});

test('DEF-18 r2: Backup of a textured scan keeps the texture; the backup restores', async ({ page }) => {
  const glb = { name: 'tex.glb', mimeType: 'application/octet-stream', buffer: Buffer.from(texturedGlb(box(4, 3, 2.5), JPEG)) };
  await importNamed(page, glb, 'Textured');
  await page.locator('.tab[data-tab="projects"]').click();
  await page.locator('.project', { hasText: 'Textured' }).getByRole('button', { name: 'Backup' }).click();
  await page.getByRole('dialog', { name: 'Ready — tap Share' }).getByRole('button', { name: 'Share' }).click();
  const bytes = await page.evaluate(async () => { for (let i = 0; i < 100 && !window.__files; i++) await new Promise((r) => setTimeout(r, 100)); return [...new Uint8Array(await window.__files[0].arrayBuffer())]; });
  const r = importScan(new Uint8Array(bytes).buffer);
  expect(r.mesh.texture, 'texture in backup').toBeTruthy();
  expect(r.mesh.uvs, 'UVs in backup').toBeTruthy();
  expect(['image/jpeg', 'image/png']).toContain(r.mesh.texture.mimeType);
  // restore it through the UI
  await pick(page, { name: 'Textured.s2p.glb', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
  await expect(page.locator('.toast')).toContainText('Backup restored');
  await page.locator('.tab[data-tab="projects"]').click();
  await expect(page.locator('.project', { hasText: 'Textured' })).toHaveCount(2);
});
