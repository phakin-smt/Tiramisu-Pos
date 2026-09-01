import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const isWindows = process.platform === 'win32';
const virtualenvPython = isWindows ? '..\\.venv\\Scripts\\python.exe' : '../.venv/bin/python';
const python = existsSync(virtualenvPython) ? `"${virtualenvPython}"` : 'python';
const npm = isWindows ? 'npm.cmd' : 'npm';

export default defineConfig({
  testDir: './e2e/pwa',
  outputDir: './.playwright/pwa-test-results',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/pwa', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'allow',
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
      command: `${npm} run preview -- --host 127.0.0.1 --port 4174 --strictPort`,
      cwd: '.',
      url: 'http://127.0.0.1:4174/next/',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
  projects: [
    {
      name: 'pwa-chromium',
      use: { browserName: 'chromium', viewport: { width: 820, height: 1180 }, hasTouch: true },
    },
  ],
});
