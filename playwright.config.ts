import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Use the preinstalled Chromium when present (remote/CI environment);
// otherwise fall back to Playwright's own resolution.
const PREINSTALLED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// PORT lets several checkouts (e.g. git worktrees) run the suite side by side
// without one reusing another's dev server.
const PORT = Number(process.env.PORT ?? 5173);

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    launchOptions: existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {},
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
