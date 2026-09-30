/** Installable and offline (docs/07 §13.7): a production build, served by
 *  `vite preview` — the manifest and the build-time icons load, the service
 *  worker registers and precaches every built file under a cache named for
 *  the build, the game reloads (and starts a mission) with the network
 *  gone, and a new version offers "Update ready — tap to reload". The dev
 *  server, where every other spec runs, never registers a worker. */
import { test, expect as baseExpect, type Page } from '@playwright/test';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const expect = baseExpect.configure({ timeout: 30_000 });

const ROOT = process.cwd(); // Playwright runs from the repo root
const OUT = join(ROOT, 'test-results', 'pwa-dist');
const PORT = Number(process.env.PORT ?? 5173) + 1;
const ORIGIN = `http://127.0.0.1:${PORT}`;

let preview: ChildProcess | null = null;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(240_000);
  execFileSync('npx', ['vite', 'build', '--outDir', OUT, '--emptyOutDir', '--logLevel', 'warn'], { cwd: ROOT, stdio: 'pipe' });
  preview = spawn('npx', ['vite', 'preview', '--outDir', OUT, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    // its own process group: npx starts vite as a child, and both must go at the end
    cwd: ROOT, stdio: 'ignore', detached: true,
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(ORIGIN)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('vite preview did not start');
});

test.afterAll(() => {
  if (!preview?.pid) return;
  try { process.kill(-preview.pid); } catch { preview.kill(); }
});

/** width × height from a PNG's IHDR */
function pngSize(buf: Buffer) {
  expect([...buf.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

async function controlled(page: Page) {
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return !!reg?.active && !!navigator.serviceWorker.controller;
  }, null, { timeout: 30_000 });
}

test('the manifest and the icons load: relative URLs, landscape, full screen, drawn at build time', async ({ request }) => {
  const html = await (await request.get(`${ORIGIN}/`)).text();
  expect(html).toContain('<link rel="manifest" href="./manifest.webmanifest">');
  expect(html).toMatch(/<link rel="apple-touch-icon" sizes="180x180" href="\.\/icons\/apple-touch-icon\.png">/);
  expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
  expect(html).toContain('name="mobile-web-app-capable" content="yes"');
  expect(html).toContain('name="apple-mobile-web-app-status-bar-style"');
  expect(html).toContain('viewport-fit=cover');
  // every asset URL in the page is relative (the site lives under a subpath)
  expect(html).not.toMatch(/(src|href)="\/(?!\/)/);
  const res = await request.get(`${ORIGIN}/manifest.webmanifest`);
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.name).toContain('MOONSHOTS');
  expect(m.short_name).toBe('Moonshots');
  expect(['fullscreen', 'standalone']).toContain(m.display);
  expect(m.orientation).toBe('landscape');
  expect(m.start_url).toBe('./');
  expect(m.scope).toBe('./');
  expect(m.theme_color).toMatch(/^#/);
  expect(m.background_color).toMatch(/^#/);
  const sizes: Record<string, number> = {};
  for (const ic of m.icons) {
    expect(ic.src.startsWith('/')).toBe(false);
    const r = await request.get(`${ORIGIN}/${ic.src}`);
    expect(r.ok(), ic.src).toBe(true);
    expect(r.headers()['content-type']).toContain('image/png');
    const [w, h] = pngSize(await r.body());
    expect(`${w}x${h}`).toBe(ic.sizes);
    sizes[ic.purpose] = Math.max(sizes[ic.purpose] ?? 0, w);
  }
  expect(sizes.any).toBe(512);
  expect(sizes.maskable).toBe(512);
  expect(m.icons.some((ic: { sizes: string }) => ic.sizes === '192x192')).toBe(true);
  const apple = await request.get(`${ORIGIN}/icons/apple-touch-icon.png`);
  expect(pngSize(await apple.body())).toEqual([180, 180]);
});

test('the service worker registers, precaches the build under its hash, and the game reloads offline', async ({ page, context }) => {
  test.setTimeout(180_000);
  await page.goto(`${ORIGIN}/`);
  await expect(page.locator('#site-screen')).toBeVisible();
  await controlled(page);
  const sw = readFileSync(join(OUT, 'sw.js'), 'utf8');
  const cacheName = /const CACHE = "(mbb-[0-9a-f]{12})"/.exec(sw)?.[1];
  expect(cacheName).toBeTruthy();
  const listed = JSON.parse(/const PRECACHE = (\[[\s\S]*?\]);/.exec(sw)![1]) as string[];
  expect(listed).toContain('./index.html');
  expect(listed).toContain('./manifest.webmanifest');
  expect(listed.some((f) => /^\.\/assets\/.+\.js$/.test(f))).toBe(true);
  expect(listed.some((f) => f.startsWith('./icons/'))).toBe(true);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const c = await caches.open(keys[0]);
    return { keys, urls: (await c.keys()).map((r) => new URL(r.url).pathname) };
  });
  expect(cached.keys).toEqual([cacheName]);
  for (const f of listed) expect(cached.urls, f).toContain(f === './' ? '/' : f.slice(1));

  // no network: the page comes back from the cache, and a mission starts
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#site-screen')).toBeVisible();
  await expect(page.locator('#site-screen h1')).toHaveText('MOONSHOTS');
  await page.goto(`${ORIGIN}/?site=mare&exp=robotic&seed=42`);
  await expect(page.locator('#resource-strip .chip').first()).toBeVisible();
  await expect(page.locator('#era-banner')).toContainText('FIRST LANDING');
  await context.setOffline(false);
});

test('a new version: it installs behind the running one, and the chip reloads into it', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`${ORIGIN}/?site=mare&exp=robotic&seed=42`);
  await controlled(page);
  await expect(page.locator('#update-chip')).toHaveCount(0);
  // a deploy: sw.js changes on the server; the page looks again
  appendFileSync(join(OUT, 'sw.js'), `\n// deploy ${Date.now()}\n`);
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
  await expect(page.locator('#update-chip')).toBeVisible();
  await expect(page.locator('#update-chip')).toHaveText('Update ready — tap to reload');
  await Promise.all([page.waitForEvent('framenavigated'), page.locator('#update-chip').click()]);
  await controlled(page);
  // back in the base it was playing (saved, then resumed), not at a new landing
  await expect(page.locator('#resource-strip .chip').first()).toBeVisible();
  expect(new URL(page.url()).searchParams.has('site')).toBe(false);
  await expect(page.locator('#update-chip')).toHaveCount(0);
  const script = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.active!.scriptURL);
  expect(script).toMatch(/\/sw\.js$/);
});

test('the dev server never registers a worker (every other spec runs there)', async ({ page }) => {
  await page.goto('/?debug&seed=42&site=mare&exp=robotic');
  await page.waitForFunction(() => (window as unknown as { __game?: unknown }).__game !== undefined);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
});
