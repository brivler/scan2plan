/**
 * Headless smoke tests (REQ-090): `offline`, `orbit`, `layout 390` (§7 names).
 * Run: npx playwright test   (fixture: node tools/make-fixtures.mjs)
 */
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../fixtures/room.glb', import.meta.url));

test.beforeEach(async ({ context, page }) => {
  // Diagnostics for CI (WebKit runs only there): browser console and page errors in the log.
  page.on('console', (m) => console.log(`[browser ${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  // Capture Web Share calls instead of opening the share sheet.
  await context.addInitScript(() => {
    navigator.canShare = () => true;
    navigator.share = async ({ files }) => { window.__shared = files.map((f) => f.name); };
  });
});

/** Imports the fixture as a new project and waits for the 3D view. */
async function importRoom(page, name = 'Smoke room') {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /New project/ }).click();
  await (await chooser).setFiles(FIXTURE);
  await page.getByRole('dialog', { name: 'New project' }).getByRole('textbox').fill(name);
  await page.getByRole('button', { name: 'OK' }).click();
  // first import asks for persistent storage; headless browsers deny it → one-time notice
  await page.getByRole('dialog', { name: 'Storage' }).getByRole('button', { name: 'OK' }).click({ timeout: 3000 }).catch(() => {});
  const dialog = page.locator('.modal');
  if (await dialog.count()) console.log(`[dialog after import] ${await dialog.first().innerText()}`);
  await expect(page.locator('#view-3d canvas')).toBeVisible();
  await page.waitForTimeout(800);
}

test('offline', async ({ page, context }) => {
  const failed = [];
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.url()} ${r.status()}`); });
  page.on('pageerror', (e) => failed.push(`pageerror ${e.message}`));
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: /New project/ })).toBeVisible();
  // requests aborted by the reloads above are navigation noise; count failures from here on
  failed.length = 0;
  await importRoom(page);
  await page.locator('.tab[data-tab="plan"]').click();
  await expect(page.locator('#view-plan svg path.s-cut').first()).toBeAttached();
  await expect(page.locator('#view-plan svg text', { hasText: /^400$/ }).first()).toBeVisible();
  await page.locator('#view-plan').getByRole('button', { name: 'Export' }).click();
  await page.getByRole('dialog', { name: 'Export' }).getByRole('button', { name: 'SVG', exact: true }).click();
  await page.getByRole('button', { name: 'Create file' }).click();
  await page.getByRole('dialog', { name: 'Ready — tap Share' }).getByRole('button', { name: 'Share' }).click();
  await expect.poll(() => page.evaluate(() => window.__shared)).toEqual([expect.stringMatching(/^Smoke_room_plan_1-\d+_\d{4}-\d{2}-\d{2}\.svg$/)]);
  expect(failed).toEqual([]);
});

test('orbit', async ({ page }) => {
  await page.goto('./');
  await importRoom(page);
  const canvas = page.locator('#view-3d canvas');
  const before = await canvas.screenshot();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 30, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(Buffer.compare(before, await canvas.screenshot())).not.toBe(0);
});

test('layout 390', async ({ page }) => {
  await page.goto('./');
  const check = async (where) => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth), where).toBeLessThanOrEqual(390);
    const bad = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => {
      const r = b.getBoundingClientRect();
      const name = (b.getAttribute('aria-label') || b.textContent || '').trim();
      return !name || r.width < 44 || r.height < 44 ? `${name || '?'} ${r.width}x${r.height}` : null;
    }).filter(Boolean));
    expect(bad, where).toEqual([]);
  };
  await check('projects (empty)');
  await importRoom(page);
  for (const tab of ['3d', 'plan', 'views', 'terrain', 'projects']) {
    await page.locator(`.tab[data-tab="${tab}"]`).click();
    await page.waitForTimeout(600);
    await check(tab);
  }
});
