import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Use the preinstalled Chromium when present (remote/CI environment);
// otherwise fall back to Playwright's own resolution.
const PREINSTALLED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    launchOptions: existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {},
  },
  webServer: {
    command: 'npx vite --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
