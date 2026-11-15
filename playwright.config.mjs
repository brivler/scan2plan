/**
 * Smoke test configuration (REQ-090). Spec target: WebKit at iPhone 14 size.
 * Set S2P_BROWSER=chrome to run with an installed Google Chrome when WebKit is unavailable.
 */
import { defineConfig } from '@playwright/test';

const useChrome = process.env.S2P_BROWSER === 'chrome';

export default defineConfig({
  testDir: 'test/smoke',
  testMatch: /.*\.spec\.mjs/,
  timeout: 90_000,
  use: {
    baseURL: 'http://127.0.0.1:8123/',
    browserName: useChrome ? 'chromium' : 'webkit',
    ...(useChrome ? { channel: 'chrome' } : {}),
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  },
  webServer: {
    command: 'python3 -m http.server 8123 --bind 127.0.0.1',
    url: 'http://127.0.0.1:8123/index.html',
    reuseExistingServer: true,
  },
});
