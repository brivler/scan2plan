/**
 * Headless smoke test (REQ-090): offline reload, layout at 390 px, import, orbit, plan, SVG export.
 * Run: npx playwright test   (fixture: node tools/make-fixtures.mjs)
 */
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../fixtures/room.glb', import.meta.url));

test('offline import, plan and export', async ({ page, context }) => {
  const failed = [];
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.url()} ${r.status()}`); });
  page.on('pageerror', (e) => failed.push(`pageerror ${e.message}`));
  // Capture Web Share calls instead of opening the share sheet.
  await context.addInitScript(() => {
    navigator.canShare = () => true;
    navigator.share = async ({ files }) => { window.__shared = files.map((f) => f.name); };
  });

  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  // offline from here on
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: /New project/ })).toBeVisible();
  // requests aborted by the reloads above are navigation noise; count failures from here on
  failed.length = 0;

  // layout 390: no horizontal scroll, buttons named and ≥ 44×44
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const bad = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => {
    const r = b.getBoundingClientRect();
    const name = (b.getAttribute('aria-label') || b.textContent || '').trim();
    return !name || r.width < 44 || r.height < 44 ? `${name || '?'} ${r.width}x${r.height}` : null;
  }).filter(Boolean));
  expect(bad).toEqual([]);

  // import
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /New project/ }).click();
  await (await chooser).setFiles(FIXTURE);
  await page.getByRole('dialog', { name: 'New project' }).getByRole('textbox').fill('Smoke room');
  await page.getByRole('button', { name: 'OK' }).click();
  // first import asks for persistent storage; headless browsers deny it → one-time notice
  const notice = page.getByRole('dialog', { name: 'Storage' });
  await notice.getByRole('button', { name: 'OK' }).click({ timeout: 3000 }).catch(() => {});
  const canvas = page.locator('#view-3d canvas');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(800);

  // orbit: drag changes the rendered image
  const before = await canvas.screenshot();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 30, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(Buffer.compare(before, await canvas.screenshot())).not.toBe(0);

  // plan with dimension "400"
  await page.locator('.tab[data-tab="plan"]').click();
  await expect(page.locator('#view-plan svg path.s-cut').first()).toBeAttached();
  await expect(page.locator('#view-plan svg text', { hasText: /^400$/ }).first()).toBeVisible();

  // export SVG through the share path
  await page.locator('#view-plan').getByRole('button', { name: 'Export' }).click();
  await page.getByRole('dialog', { name: 'Export' }).getByRole('button', { name: 'SVG' }).click();
  await page.getByRole('button', { name: 'Create file' }).click();
  await page.getByRole('dialog', { name: 'Ready — tap Share' }).getByRole('button', { name: 'Share' }).click();
  await expect.poll(() => page.evaluate(() => window.__shared)).toEqual([expect.stringMatching(/^Smoke_room_plan_1-\d+_\d{4}-\d{2}-\d{2}\.svg$/)]);

  expect(failed).toEqual([]);
});
