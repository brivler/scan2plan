/** TEMPORARY diagnostic (fix/webkit branch only): import immediately after a fresh first load. */
import { test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../fixtures/room.glb', import.meta.url));

for (let i = 1; i <= 6; i++) {
  test(`diag import right after first load #${i}`, async ({ page, context }) => {
    await context.addInitScript(() => {
      const t0 = performance.now();
      window.__log = [];
      navigator.serviceWorker?.addEventListener('controllerchange', () => window.__log.push(`controllerchange ${(performance.now() - t0).toFixed(0)}`));
    });
    page.on('console', (m) => console.log(`#${i} [browser ${m.type()}] ${m.text()}`));
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log(`#${i} [nav] ${f.url()}`); });
    page.on('pageerror', (e) => console.log(`#${i} [pageerror] ${e.message}`));
    const t0 = Date.now();
    await page.goto('./');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /New project/ }).click();
    await (await chooser).setFiles(FIXTURE);
    const box = page.getByRole('dialog', { name: 'New project' }).getByRole('textbox');
    const ok = await box.waitFor({ timeout: 20_000 }).then(() => true, () => false);
    const info = await page.evaluate(() => ({
      log: window.__log,
      controller: !!navigator.serviceWorker.controller,
      modals: [...document.querySelectorAll('.modal')].map((m) => m.innerText.replace(/\s+/g, ' ').slice(0, 200)),
      workerRes: performance.getEntriesByType('resource').filter((r) => /worker|core\//.test(r.name)).map((r) => `${r.name.split('/').pop()}:${r.responseEnd.toFixed(0)}`).join(' '),
    }));
    console.log(`#${i} ${ok ? 'OK' : 'STALL'} after ${Date.now() - t0} ms ${JSON.stringify(info)}`);
  });
}
