/**
 * QA browser tests (test/qa/*.spec.mjs). Same setup as the coder's smoke config.
 * WebKit by default; S2P_BROWSER=chrome uses an installed Google Chrome.
 */
import { defineConfig } from '@playwright/test';

const useChrome = process.env.S2P_BROWSER === 'chrome';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.mjs/,
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:8124/',
    browserName: useChrome ? 'chromium' : 'webkit',
    ...(useChrome ? { channel: 'chrome' } : {}),
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  },
  webServer: {
    command: 'python3 -m http.server 8124 --bind 127.0.0.1 --directory ../..',
    url: 'http://127.0.0.1:8124/index.html',
    reuseExistingServer: true,
  },
});
