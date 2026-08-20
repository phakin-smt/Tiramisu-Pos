import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const isWindows = process.platform === 'win32';
const virtualenvPython = isWindows ? '..\\.venv\\Scripts\\python.exe' : '../.venv/bin/python';
const python = existsSync(virtualenvPython) ? `"${virtualenvPython}"` : 'python';

export default defineConfig({
  testDir: './e2e/staging',
  outputDir: './.playwright/staging-results',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8011',
    browserName: 'chromium',
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `${python} e2e/support/run_backend.py`,
    cwd: '.',
    url: 'http://127.0.0.1:8011/api/health',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
