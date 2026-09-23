/** Dev harness for headless balance probes and screenshot passes.
 *
 *   import { withGame } from './scripts/harness.mjs';
 *   await withGame({ port: 5190, site: 'mare', exp: 'robotic' }, async ({ page, g }) => {
 *     await g('placeBuilding', 'solar', 132, 126);
 *     await g('advanceGameMinutes', 3);
 *     console.log((await g('getState')).resources);
 *     await page.screenshot({ path: 'test-results/probe.png' });
 *   });
 *
 * Starts its own vite dev server on `port` (pick a unique one per concurrent
 * run), launches the preinstalled Chromium, opens the game with
 * ?debug&nolock, and exposes `g(method, ...args)` → window.__game[method].
 * Run from the repo root: `node scripts/my-probe.mjs`. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

const PREINSTALLED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

async function waitForServer(url, timeoutMs = 40_000) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`dev server did not start: ${url}`);
}

export async function startServer(port) {
  const proc = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    stdio: 'ignore', detached: true,
  });
  await waitForServer(`http://127.0.0.1:${port}`);
  return () => { try { process.kill(-proc.pid); } catch { /* already gone */ } };
}

export async function withGame(opts, fn) {
  const {
    port = 5190, site = 'mare', exp = 'human', seed = 42, extra = '',
    viewport = { width: 1600, height: 900 }, lowfx = false, reuseServer = false,
  } = opts;
  const stop = reuseServer ? () => {} : await startServer(port);
  const browser = await chromium.launch(
    existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {},
  );
  try {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const q = `?debug&nolock&seed=${seed}&site=${site}${exp === 'robotic' ? '&exp=robotic' : ''}${lowfx ? '&lowfx' : ''}${extra}`;
    await page.goto(`http://127.0.0.1:${port}/${q}`);
    await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 30_000 });
    const g = (method, ...args) =>
      page.evaluate(([m, a]) => window.__game[m](...a), [method, args]);
    return await fn({ page, g, errors, browser });
  } finally {
    await browser.close();
    stop();
  }
}
