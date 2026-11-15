/**
 * QA browser tests (REQ-004, REQ-010, REQ-012, REQ-062). Run:
 *   npx playwright test -c test/qa/playwright.qa.config.mjs
 *   S2P_BROWSER=chrome npx playwright test -c test/qa/playwright.qa.config.mjs
 * Tests named "DEF-xx" assert the correct behaviour and are marked test.fail() while the
 * defect is open.
 */
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { makeGlb } from '../helpers/glb.js';
import { box } from '../helpers/meshes.js';

const ROOM = fileURLToPath(new URL('../fixtures/room.glb', import.meta.url)); // 4 × 3 × 2.5
const BIG_ROOM = { name: 'other.glb', mimeType: 'application/octet-stream', buffer: Buffer.from(makeGlb([box(6, 5, 2.5)])) };
const SPLAT = { name: 'scan.ply', mimeType: 'application/octet-stream', buffer: Buffer.from('ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nproperty float f_dc_0\nproperty float opacity\nend_header\n0 0 0 0.1 1\n') };

async function importFile(page, file, name) {
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#view-projects').getByRole('button', { name: /New project/ }).click();
  await (await chooser).setFiles(file);
  if (name !== null) {
    await page.getByRole('dialog', { name: 'New project' }).getByRole('textbox').fill(name);
    await page.getByRole('button', { name: 'OK' }).click();
    await page.getByRole('dialog', { name: 'Storage' }).getByRole('button', { name: 'OK' }).click({ timeout: 2500 }).catch(() => {});
  }
}

async function layoutProblems(page, width) {
  return page.evaluate((w) => {
    const out = [];
    if (document.documentElement.scrollWidth > w) out.push(`page scrollWidth ${document.documentElement.scrollWidth}`);
    for (const b of document.querySelectorAll('button')) {
      if (!b.offsetParent) continue;
      const r = b.getBoundingClientRect();
      const name = (b.getAttribute('aria-label') || b.textContent || '').trim();
      if (!name || r.width < 44 || r.height < 44) out.push(`button "${name || '?'}" ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    for (const i of document.querySelectorAll('input:not([type=checkbox]):not([type=range]):not([type=file]), select, textarea')) {
      if (!i.offsetParent) continue;
      if (parseFloat(getComputedStyle(i).fontSize) < 16) out.push(`input font ${getComputedStyle(i).fontSize}`);
    }
    return out;
  }, width);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { navigator.canShare = () => true; navigator.share = async ({ files }) => { window.__shared = files.map((f) => f.name); }; });
  await page.goto('./');
});

for (const [w, h] of [[390, 844], [375, 667], [440, 956], [844, 390]]) {
  test(`REQ-062 layout ${w}×${h}: every tab, no horizontal scroll, buttons ≥ 44×44 and named, inputs ≥ 16 px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await importFile(page, ROOM, 'Layout');
    const problems = {};
    for (const tab of ['projects', '3d', 'plan', 'views', 'terrain']) {
      await page.locator(`.tab[data-tab="${tab}"]`).click();
      await page.waitForTimeout(400);
      const p = await layoutProblems(page, w);
      if (p.length) problems[tab] = p;
    }
    // a dialog (export) too
    await page.locator('.tab[data-tab="plan"]').click();
    await page.locator('#view-plan').getByRole('button', { name: 'Export' }).click();
    const p = await layoutProblems(page, w);
    if (p.length) problems.exportDialog = p;
    expect(problems).toEqual({});
  });
}

test('XSS: a hostile project name is rendered as text, never as HTML', async ({ page }) => {
  await importFile(page, ROOM, '<img src=x onerror="window.__xss=1">');
  await page.locator('.tab[data-tab="plan"]').click();
  await expect(page.locator('#view-plan svg path.s-cut').first()).toBeAttached();
  await page.locator('.tab[data-tab="projects"]').click();
  await expect(page.locator('.project .name').first()).toHaveText('<img src=x onerror="window.__xss=1">');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('REQ-004: a splat PLY shows E-IMP-03 and nothing is stored', async ({ page }) => {
  await importFile(page, SPLAT, null);
  await expect(page.getByRole('dialog', { name: 'Import failed' })).toContainText('Gaussian splat');
  await expect(page.getByRole('dialog', { name: 'Import failed' })).toContainText('E-IMP-03');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.project')).toHaveCount(0);
});

test('REQ-013/050: every export format and Backup work offline through the share path', async ({ page, context }) => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  const failed = [];
  page.on('requestfailed', (r) => failed.push(r.url()));
  page.on('pageerror', (e) => failed.push(`pageerror ${e.message}`));
  await importFile(page, ROOM, 'Küche Süd');
  const share = async (where, fmt, ext) => {
    await page.evaluate(() => { window.__shared = null; });
    await page.locator(where).getByRole('button', { name: 'Export' }).click();
    await page.getByRole('dialog', { name: 'Export' }).getByRole('button', { name: fmt, exact: true }).click();
    await page.getByRole('button', { name: 'Create file' }).click();
    await page.getByRole('dialog', { name: 'Ready — tap Share' }).getByRole('button', { name: 'Share' }).click();
    await expect.poll(() => page.evaluate(() => window.__shared?.[0] || '')).toMatch(new RegExp(`^Kueche_Sued_.*\\.${ext}$`));
  };
  await page.locator('.tab[data-tab="plan"]').click();
  await expect(page.locator('#view-plan svg path.s-cut').first()).toBeAttached();
  for (const [f, e] of [['PDF', 'pdf'], ['SVG', 'svg'], ['DXF', 'dxf'], ['GLB', 'glb'], ['CSV', 'csv']]) await share('#view-plan', f, e);
  await page.locator('.tab[data-tab="views"]').click();
  await expect(page.locator('#view-views svg image')).toBeAttached();
  await share('#view-views', 'PDF', 'pdf');
  await page.locator('.tab[data-tab="terrain"]').click();
  await expect(page.locator('#view-terrain svg image')).toBeAttached();
  await share('#view-terrain', 'PDF', 'pdf');
  await page.locator('.tab[data-tab="projects"]').click();
  await page.evaluate(() => { window.__shared = null; });
  await page.getByRole('button', { name: 'Backup' }).click();
  await page.getByRole('dialog', { name: 'Ready — tap Share' }).getByRole('button', { name: 'Share' }).click();
  await expect.poll(() => page.evaluate(() => window.__shared?.[0] || '')).toBe('Kueche_Sued.s2p.glb');
  expect(failed).toEqual([]);
});

test('DEF-02: cancelling a second import keeps the open project\'s geometry', async ({ page }) => {
  test.fail(!process.env.QA_SHOW, 'DEF-02 open: worker already holds the new scan while the old session stays open');
  await importFile(page, ROOM, 'Room A');
  await page.locator('.tab[data-tab="plan"]').click();
  await expect(page.locator('#view-plan svg text', { hasText: /^400$/ }).first()).toBeVisible();
  // start importing another scan, then cancel at the name prompt
  await page.locator('.tab[data-tab="projects"]').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#view-projects').getByRole('button', { name: /New project/ }).click();
  await (await chooser).setFiles(BIG_ROOM);
  await page.getByRole('dialog', { name: 'New project' }).getByRole('button', { name: 'Cancel' }).click();
  // Room A is still the open project; force a plan recompute (cut height change)
  await page.locator('.tab[data-tab="plan"]').click();
  const num = page.locator('#view-plan input[type=number]');
  await num.fill('1.10');
  await num.press('Enter');
  await num.blur();
  await page.waitForTimeout(800);
  await expect(page.locator('#view-plan svg text', { hasText: /^600$/ })).toHaveCount(0, { timeout: 2000 });
  await expect(page.locator('#view-plan svg text', { hasText: /^400$/ }).first()).toBeVisible();
});
