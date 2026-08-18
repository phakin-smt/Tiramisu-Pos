import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const isWindows = process.platform === 'win32';
const virtualenvPython = isWindows ? '..\\.venv\\Scripts\\python.exe' : '../.venv/bin/python';
const python = existsSync(virtualenvPython) ? `"${virtualenvPython}"` : 'python';
const npm = isWindows ? 'npm.cmd' : 'npm';

export default defineConfig({
  testDir: './e2e/specs',
  outputDir: './.playwright/test-results',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: `${python} e2e/support/run_backend.py`,
      cwd: '.',
      url: 'http://127.0.0.1:8011/api/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `${npm} run dev -- --host 127.0.0.1 --port 4173 --strictPort --mode e2e`,
      cwd: '.',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
  projects: [
    {
      name: 'legacy-stock-plans-chromium',
      testMatch: /legacy-stock-plans\.spec\.ts/,
      use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'desktop-chromium',
      testMatch: /desktop\.spec\.ts/,
      use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile-chromium',
      testMatch: /mobile\.spec\.ts/,
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
    },
    {
      name: 'tablet-portrait-chromium',
      testMatch: /tablet\.spec\.ts/,
      use: { browserName: 'chromium', viewport: { width: 820, height: 1180 }, hasTouch: true },
    },
    {
      name: 'tablet-landscape-chromium',
      testMatch: /tablet\.spec\.ts/,
      use: { browserName: 'chromium', viewport: { width: 1180, height: 820 }, hasTouch: true },
    },
    {
      name: 'tablet-landscape-webkit',
      testMatch: /tablet\.spec\.ts/,
      use: { browserName: 'webkit', viewport: { width: 1180, height: 820 }, hasTouch: true },
    },
  ],
});
