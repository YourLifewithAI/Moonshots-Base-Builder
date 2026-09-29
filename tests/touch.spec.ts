/** Touch mode (docs/07 §13): an iPhone held sideways, in Chromium's mobile
 *  emulation (hasTouch, isMobile, dpr 3) at 667×375 (SE), 844×390 (14/15)
 *  and 932×430 (Pro Max). Detection (Auto and ?touch; the desktop stays
 *  off), the portrait overlay, gestures on the world (real touch points
 *  through CDP: pan, pinch, twist, tap, hold), the placement flow and the
 *  road tool by touch, the research tree by tap, the fit of every screen at
 *  the three sizes (in view, no overlap, 44 px targets, 11 px text, no page
 *  scroll), the first tap unlocking audio, and saves as the page hides. */
import { test, expect as baseExpect, type Browser, type BrowserContext, type Page } from '@playwright/test';

// UI actions reach the sim on the next rendered frame; under software GL on a
// loaded machine a frame can take seconds, so assertions get a wider window
const expect = baseExpect.configure({ timeout: 20_000 });

declare global {
  interface Window { __game?: any; __audioLog?: string[] }
}

const BASE = '/?debug&seed=42&nolock&lowfx';
const PHONES = {
  'iPhone SE': { width: 667, height: 375 },
  'iPhone 14': { width: 844, height: 390 },
  'Pro Max': { width: 932, height: 430 },
} as const;
const MOBILE = { hasTouch: true, isMobile: true, deviceScaleFactor: 3 } as const;

test.use({ ...MOBILE, viewport: PHONES['iPhone 14'] });

const g = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => window.__game[f as string](...(a as unknown[])), [fn, args] as const);

/** let `n` frames render */
const frames = (page: Page, n = 3) => page.evaluate((k) => new Promise<void>((done) => {
  let left = k;
  const step = () => (--left <= 0 ? done() : requestAnimationFrame(step));
  requestAnimationFrame(step);
}), n);

async function boot(page: Page, extra = '') {
  await page.goto(`${BASE}&site=mare&exp=robotic${extra}`);
  await page.waitForFunction(() => window.__game !== undefined);
  await expect(page.locator('#touch-top')).toBeVisible();
  await frames(page, 2);
}

/** real touch points (CDP), so the recognizer sees what a finger sends */
async function fingers(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', pts: [number, number][]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
  return {
    async tap(x: number, y: number) { await send('touchStart', [[x, y]]); await send('touchEnd', []); },
    async hold(x: number, y: number, ms = 700) {
      await send('touchStart', [[x, y]]);
      await page.waitForTimeout(ms);
      await send('touchEnd', []);
    },
    /** `restMs`: the finger rests where it went down before it moves */
    async drag(from: [number, number], to: [number, number], steps = 10, restMs = 0) {
      await send('touchStart', [from]);
      if (restMs) await page.waitForTimeout(restMs);
      for (let i = 1; i <= steps; i++) {
        await send('touchMove', [[from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps]]);
      }
      await send('touchEnd', []);
    },
    /** two fingers about `c`, `r0` → `r1` apart (half-spread), turning `a0` → `a1` rad */
    async pair(c: [number, number], r0: number, r1: number, a0 = 0, a1 = 0, steps = 10) {
      const at = (r: number, a: number): [number, number][] => [
        [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)], [c[0] - r * Math.cos(a), c[1] - r * Math.sin(a)]];
      await send('touchStart', at(r0, a0));
      for (let i = 1; i <= steps; i++) await send('touchMove', at(r0 + ((r1 - r0) * i) / steps, a0 + ((a1 - a0) * i) / steps));
      await send('touchEnd', []);
    },
  };
}

/** Everything the phone shows fits: the regions named are on screen and
 *  pairwise apart; every control in them is 44 px or more; no text under
 *  11 px; the page itself never scrolls. */
async function fitReport(page: Page, regionSel: string) {
  return page.evaluate((sel) => {
    const vw = innerWidth, vh = innerHeight;
    const shown = (e: Element) => {
      const r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      for (let a: Element | null = e; a; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      }
      return true;
    };
    const inView = (r: DOMRect) => r.left >= -0.5 && r.top >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5;
    const name = (e: Element) => `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}${typeof e.className === 'string' && e.className.trim() ? `.${e.className.trim().split(/\s+/).join('.')}` : ''}`;
    const regions = [...document.querySelectorAll(sel)].filter(shown);
    const offscreen = regions.filter((e) => !inView(e.getBoundingClientRect())).map(name);
    const overlaps: string[] = [];
    for (let i = 0; i < regions.length; i++) {
      for (let j = i + 1; j < regions.length; j++) {
        const a = regions[i].getBoundingClientRect(), b = regions[j].getBoundingClientRect();
        if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) {
          overlaps.push(`${name(regions[i])} × ${name(regions[j])}`);
        }
      }
    }
    const CONTROL = 'button, .btn, .tbtn, .chip, .bld-btn, .tech-card, .era-tab, .q-item, .alert, [role=button], .site-card, .ns-row, .tl, .op, .dz-card, .dz-opt';
    const controls = new Set<Element>();
    for (const r of regions) for (const e of [r, ...r.querySelectorAll(CONTROL)]) if (e.matches(CONTROL) && shown(e)) controls.add(e);
    const small = [...controls].filter((e) => { const r = e.getBoundingClientRect(); return r.width < 43.5 || r.height < 43.5; })
      .map((e) => { const r = e.getBoundingClientRect(); return `${name(e)} ${Math.round(r.width)}×${Math.round(r.height)}`; });
    const tiny = new Set<string>();
    for (const r of regions) {
      const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const e = n.parentElement;
        if (!n.textContent?.trim() || !e || !shown(e)) continue;
        const fs = parseFloat(getComputedStyle(e).fontSize);
        if (fs < 10.95) tiny.add(`${name(e)} ${fs}px "${n.textContent.trim().slice(0, 20)}"`);
      }
    }
    const de = document.documentElement;
    return {
      regions: regions.map(name), offscreen, overlaps, small, tiny: [...tiny],
      scroll: [de.scrollWidth - vw, de.scrollHeight - vh, document.body.scrollWidth - vw, document.body.scrollHeight - vh],
    };
  }, regionSel);
}

function expectFit(r: Awaited<ReturnType<typeof fitReport>>, at: string, min = 1) {
  expect(r.regions.length, `${at}: regions ${r.regions}`).toBeGreaterThanOrEqual(min);
  expect(r.offscreen, `${at}: off screen`).toEqual([]);
  expect(r.overlaps, `${at}: overlap`).toEqual([]);
  expect(r.small, `${at}: targets under 44 px`).toEqual([]);
  expect(r.tiny, `${at}: text under 11 px`).toEqual([]);
  expect(r.scroll.every((d) => d <= 0), `${at}: the page scrolls ${r.scroll}`).toBe(true);
}

const HUD = '#touch-top, #touch-rail-l, #touch-rail-r, #milestones, #hud-right, #palette, #touch-bar, #touch-sheet, #touch-sheet-tab';

// ───────────────────────────── detection ─────────────────────────────

async function desktop(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: false, isMobile: false, deviceScaleFactor: 1 });
}

test('touch mode: Auto turns it on for a phone; ?touch forces it; the desktop stays off; the menu setting reloads', async ({ page, browser }) => {
  await boot(page);
  expect(await page.evaluate(() => document.documentElement.classList.contains('touch'))).toBe(true);
  expect((await g(page, 'getTouch')).on).toBe(true);
  // the page is made for a phone: no zoom, the notch inset, installable
  const meta = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(meta).toContain('viewport-fit=cover');
  expect(meta).toContain('user-scalable=no');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', './manifest.webmanifest');
  expect(await page.locator('#world').evaluate((e) => getComputedStyle(e).touchAction)).toBe('none');

  const ctx = await desktop(browser);
  const d = await ctx.newPage();
  await d.goto(`${BASE}&site=mare&exp=robotic`);
  await d.waitForFunction(() => window.__game !== undefined);
  expect(await d.evaluate(() => document.documentElement.classList.contains('touch'))).toBe(false);
  expect(await d.evaluate(() => window.__game.getTouch().on)).toBe(false);
  // no touch DOM exists at all on the desktop
  for (const id of ['#touch-top', '#touch-rail-l', '#touch-bar', '#touch-sheet', '#touch-rotate']) expect(await d.locator(id).count()).toBe(0);
  // ?touch forces it on a desktop
  await d.goto(`${BASE}&site=mare&exp=robotic&touch`);
  await d.waitForFunction(() => window.__game !== undefined);
  expect(await d.evaluate(() => document.documentElement.classList.contains('touch'))).toBe(true);
  await ctx.close();

  // the menu: Off saves and reloads straight back into the base, without touch
  await g(page, 'placeBuilding', 'solar', 132, 126);
  await page.locator('#t-menu').tap();
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#menu-touch [data-touch="auto"]')).toHaveClass(/active/);
  await expect(page.locator('#menu-keys')).toContainText('Pinch');
  await Promise.all([page.waitForNavigation(), page.locator('#menu-touch [data-touch="off"]').tap()]);
  await page.waitForFunction(() => window.__game?.getState?.() !== null && window.__game !== undefined);
  await expect.poll(() => page.evaluate(() => window.__game.getState()?.buildings?.length ?? 0)).toBe(2);
  expect(await page.evaluate(() => document.documentElement.classList.contains('touch'))).toBe(false);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mbb-settings') ?? '{}').touch)).toBe('off');
});

test('portrait: "rotate your phone" covers the game and pauses it until it turns back', async ({ page }) => {
  await boot(page);
  expect((await g(page, 'getState')).paused).toBe(false);
  await expect(page.locator('#touch-rotate')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#touch-rotate')).toBeVisible();
  await expect(page.locator('#touch-rotate')).toContainText('Rotate your phone to landscape');
  await expect.poll(async () => (await g(page, 'getState')).paused).toBe(true);
  // a save while turned records the game as it was, not the turn's pause
  expect((await g(page, 'saveBlob')).state.paused).toBe(false);
  await page.setViewportSize(PHONES['iPhone 14']);
  await expect(page.locator('#touch-rotate')).toBeHidden();
  await expect.poll(async () => (await g(page, 'getState')).paused).toBe(false);
});

// ───────────────────────────── gestures ─────────────────────────────

test('gestures: one finger pans, a pinch zooms freely, a twist turns 90°, ▱ tilts, a tap selects, a hold shows info', async ({ page }) => {
  await boot(page);
  const f = await fingers(page);
  const cam = () => g(page, 'getCamera');
  const c0 = await cam();
  await f.drag([420, 210], [540, 250]);
  await frames(page, 3);
  const c1 = await cam();
  expect(Math.hypot(c1.target.x - c0.target.x, c1.target.z - c0.target.z), 'a drag pans').toBeGreaterThan(10);
  // a drag never selects
  await expect(page.locator('#inspector')).toBeHidden();
  let log = (await g(page, 'getTouch')).log as string[];
  expect(log).toContain('drag:pan');
  expect(log).not.toContain('tap');

  // pinch out: closer (eased back inside the near clamp); pinch in: farther, and it
  // stays where the fingers left it — no snapping to a level
  expect(c1.iso.level).toBe(1);
  await f.pair([360, 200], 40, 140);
  await expect.poll(async () => (await cam()).iso.level).toBe(0);
  await expect.poll(async () => Math.abs((await cam()).iso.dist - 100)).toBeLessThan(0.5);
  await f.pair([360, 200], 140, 30);
  await expect.poll(async () => (await cam()).iso.level).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => { const c = (await cam()).iso; return Math.abs(c.dist - c.zoomTo) < 0.05; }).toBe(true);
  const pinched = (await cam()).iso;
  expect(pinched.dist).toBeGreaterThanOrEqual(100);
  expect(pinched.dist).toBeLessThanOrEqual(830);
  for (const l of pinched.levels) expect(Math.abs(pinched.dist - l), `not snapped to ${l}`).toBeGreaterThan(3);

  // twist: past 40° the view turns a step with the fingers
  const yaw = (await cam()).iso.yawStep;
  await f.pair([360, 200], 70, 70, 0, 1.1);
  await expect.poll(async () => (await cam()).iso.yawStep).toBe(yaw - 1);
  // ⟲ turns it back
  await page.locator('#t-turn-l').tap();
  await expect.poll(async () => (await cam()).iso.yawStep).toBe(yaw);
  // ▱ tilts the view, low ↔ high, and back
  expect((await cam()).iso).toMatchObject({ tilt: 0, pitchDeg: 32 });
  await page.locator('#t-tilt').tap();
  await expect.poll(async () => (await cam()).iso).toMatchObject({ tilt: 1, pitchDeg: 55, tilting: false });
  await page.locator('#t-tilt').tap();
  await expect.poll(async () => (await cam()).iso).toMatchObject({ tilt: 0, pitchDeg: 32, tilting: false });

  // home, then a tap on the Lander selects it; a tap on empty ground clears
  await page.locator('#t-home').tap();
  await expect.poll(async () => (await cam()).iso.level).toBe(1);
  await page.waitForTimeout(800);
  const at = await g(page, 'screenOf', -2, -2, 6);
  await f.tap(at.x, at.y);
  await expect(page.locator('#inspector')).toBeVisible();
  await expect(page.locator('#inspector .tt-name')).toContainText('Lander');
  await expect(page.locator('#touch-sheet')).toBeVisible();
  // the sheet folds away to a tab and back
  await page.locator('#touch-sheet-fold').tap();
  await expect(page.locator('#touch-sheet')).toBeHidden();
  await page.locator('#touch-sheet-tab').tap();
  await expect(page.locator('#touch-sheet')).toBeVisible();
  await f.tap(250, 200); // open ground (left of the sheet, above the palette, below the alerts)
  await expect(page.locator('#inspector')).toBeHidden();
  // a hold on the Lander: its info card
  await f.hold(at.x, at.y);
  await expect(page.locator('#touch-info')).toBeVisible();
  await expect(page.locator('#touch-info .tt-name')).toContainText('Lander');
  log = (await g(page, 'getTouch')).log;
  expect(log).toContain('long');
  await page.locator('#touch-info [data-ti="close"]').tap();
  await expect(page.locator('#touch-info')).toBeHidden();
});

// ───────────────────────────── placement ─────────────────────────────

test('placement by taps: a card puts its ghost mid-view, a drag moves the ghost (not the camera), ⟳ rotates, ✓ places; a refusal is shown', async ({ page }) => {
  await boot(page);
  const f = await fingers(page);
  await page.locator('.bld-btn', { hasText: 'Solar Array' }).tap();
  await expect(page.locator('#touch-bar')).toBeVisible();
  await expect(page.locator('#palette')).toBeHidden();
  const t0 = await g(page, 'getTouch');
  expect(t0.placing.type).toBe('solar');
  expect(Math.abs(t0.pointer.x - 844 / 2)).toBeLessThan(2);
  // mid-view is the Lander: the ghost says why not, and ✓ refuses
  await expect(page.locator('#place-hint .blocked')).toBeVisible();
  const before = (await g(page, 'getState')).buildings.length;
  await page.locator('#tp-ok').tap();
  await frames(page, 3);
  expect((await g(page, 'getState')).buildings.length).toBe(before);
  await expect(page.locator('#place-hint')).toHaveAttribute('data-flash', /\d/);

  // drag the ghost off the Lander: the pointer follows the finger, the camera
  // stays; a finger that rests first still drags (a hold means nothing while placing)
  const cam0 = await g(page, 'getCamera');
  await f.drag([300, 200], [150, 240], 10, 800);
  await frames(page, 3);
  const t1 = await g(page, 'getTouch');
  expect(t1.log).toContain('drag:ghost');
  expect(t1.log).not.toContain('long');
  expect(t1.pointer.x).toBeCloseTo(844 / 2 - 150, 0);
  const cam1 = await g(page, 'getCamera');
  expect(Math.hypot(cam1.target.x - cam0.target.x, cam1.target.z - cam0.target.z)).toBeLessThan(0.5);
  expect(t1.placing.gx).not.toBe(t0.placing.gx);
  // a valid spot: the hint shows its road
  await expect.poll(async () => (await g(page, 'getTouch')).placing.valid).toBe(true);
  await expect(page.locator('#place-road')).toBeVisible();
  // a hint taller than the bar scrolls from its first line (none of it above the box)
  const hint = await page.evaluate(() => {
    const box = document.querySelector('#touch-bar .tb-hint')!, h = document.getElementById('place-hint')!;
    return { boxTop: box.getBoundingClientRect().top, top: h.getBoundingClientRect().top, over: box.scrollHeight > box.clientHeight };
  });
  expect(hint.top, `the hint's first line is in the box (${JSON.stringify(hint)})`).toBeGreaterThanOrEqual(hint.boxTop - 0.5);
  // ⟳ rotates
  const rot = (await g(page, 'getTouch')).placing.rot;
  await page.locator('#tp-rotate').tap();
  await expect.poll(async () => (await g(page, 'getTouch')).placing.rot).toBe((rot + 1) % 4);
  // ✓ places it there, and the placement ends
  await page.locator('#tp-ok').tap();
  await expect.poll(async () => (await g(page, 'getState')).buildings.length).toBe(before + 1);
  await expect(page.locator('#touch-bar')).toBeHidden();
  await expect(page.locator('#palette')).toBeVisible();

  // Order in the bar: the rovers choose the site; a hold on a card does the same
  await page.locator('.bld-btn', { hasText: 'Solar Array' }).tap();
  await page.locator('#tp-order').tap();
  await expect(page.locator('#touch-bar')).toBeHidden();
  // the Builder's sites, placed for the orders
  const ordered = async () => ((await g(page, 'getState')).buildings as { auto?: unknown }[]).filter((b) => b.auto).length;
  await expect.poll(ordered).toBe(1);
  const card = await page.locator('.bld-btn', { hasText: 'Solar Array' }).boundingBox();
  await f.hold(card!.x + card!.width / 2, card!.y + card!.height / 2);
  await expect.poll(ordered).toBe(2);
  await expect(page.locator('#touch-bar')).toBeHidden(); // a hold orders; it never starts a placement

  // a locked card: the first tap shows why, the second opens the tree there
  await page.locator('.bld-btn.locked', { hasText: 'Battery Bank' }).tap();
  await expect(page.locator('#touch-info')).toBeVisible();
  await expect(page.locator('#touch-info')).toContainText('Requires research');
  await page.locator('.bld-btn.locked', { hasText: 'Battery Bank' }).tap();
  await expect(page.locator('#tech-screen')).toBeVisible();
});

test('the road tool by drag: from a road cell out, laid as a job; Remove replaces Alt-drag', async ({ page }) => {
  await boot(page);
  const f = await fingers(page);
  await page.locator('#t-road').tap();
  await expect(page.locator('#touch-bar')).toBeVisible();
  await expect(page.locator('#road-hint')).toContainText('drag out from a road cell');
  expect((await g(page, 'getRoadTool')).active).toBe(true);
  // the apron's stub end, and 5 cells east of it, on screen
  const pts = await page.evaluate(() => {
    const gm = window.__game;
    const end = gm.getState().roads.filter((c: any) => !c.bay && !c.closed).sort((a: any, b: any) => b.gz - a.gz)[0];
    const w = (gx: number) => gx * 4 - 512 + 2;
    return { a: gm.screenOf(w(end.gx), w(end.gz)), b: gm.screenOf(w(end.gx + 5), w(end.gz)), end };
  });
  // the finger rests on the road cell first, as a thumb does: still a drag, not a hold
  await f.drag([pts.a.x, pts.a.y], [pts.b.x, pts.b.y], 12, 800);
  await frames(page, 3);
  const log = (await g(page, 'getTouch')).log as string[];
  expect(log).toContain('drag:road');
  expect(log).not.toContain('long');
  await expect.poll(async () => (await g(page, 'getState')).roadJobs.length).toBe(1);
  expect((await g(page, 'getState')).roadJobs[0].kind).toBe('draw');
  // the camera held still while it drew
  // Remove: the same drag marks cells to remove
  await page.locator('#tr-remove').tap();
  await expect(page.locator('#tr-remove')).toHaveAttribute('aria-pressed', 'true');
  expect((await g(page, 'getTouch')).roadRemove).toBe(true);
  await page.locator('#tb-cancel').tap();
  await expect(page.locator('#touch-bar')).toBeHidden();
  expect((await g(page, 'getTouch')).roadRemove).toBe(false);
});

// ───────────────────────────── the research tree ─────────────────────────────

test('research tree by touch: the rail opens it, tabs change page, a tap shows, a second queues, a hold queues the path', async ({ page }) => {
  await boot(page);
  await page.locator('#t-tree').tap();
  await expect(page.locator('#tech-screen')).toBeVisible();
  await expect(page.locator('.era-tab.view')).toHaveAttribute('data-era', '1');
  const cardEl = page.locator('.tech-card[data-tech="regolithProcessing"]');
  await cardEl.tap();
  await expect(cardEl).toHaveClass(/\bsel\b/);
  await expect(page.locator('#tech-sheet-body .sh-name')).toContainText('Regolith');
  expect((await g(page, 'getState')).researchQueue).toEqual([]);
  await cardEl.tap();
  await expect.poll(async () => (await g(page, 'getState')).researchQueue).toEqual(['regolithProcessing']);
  // the sheet's Cancel, and Queue, act by tap too
  await page.locator('#tech-sheet-body [data-act="cancel"]').tap();
  await expect.poll(async () => (await g(page, 'getState')).researchQueue).toEqual([]);
  await page.locator('#tech-sheet-body [data-act="queue"]').tap();
  await expect.poll(async () => (await g(page, 'getState')).researchQueue).toEqual(['regolithProcessing']);
  // the queue under a long detail keeps its item whole (the detail scrolls instead)
  await expect(page.locator('#tech-queue .q-item')).toHaveCount(1);
  const q = await page.evaluate(() => {
    const strip = document.getElementById('tech-strip')!.getBoundingClientRect();
    const item = document.querySelector('#tech-queue .q-item')!.getBoundingClientRect();
    return { strip: [strip.top, strip.bottom], item: [item.top, item.bottom] };
  });
  expect(q.item[0], JSON.stringify(q)).toBeGreaterThanOrEqual(q.strip[0] - 0.5);
  expect(q.item[1], JSON.stringify(q)).toBeLessThanOrEqual(q.strip[1] + 0.5);
  // tabs by tap
  await page.locator('.era-tab[data-era="2"]').tap();
  await expect(page.locator('.era-tab.view')).toHaveAttribute('data-era', '2');
  await expect(page.locator('#tech-board')).toHaveAttribute('data-era', '2');
  // a hold on a later card queues its whole path (Shift-click)
  await g(page, 'grantData', 5000);
  for (const t of ['regolithProcessing', 'prospectingRovers', 'grizzlyScreens', 'fieldSpectrometers']) await g(page, 'completeTech', t);
  await frames(page, 3);
  const target = page.locator('.tech-card[data-tech="partsFabrication"]');
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  const f = await fingers(page);
  await f.hold(box!.x + 30, box!.y + box!.height / 2);
  await expect.poll(async () => ((await g(page, 'getState')).researchQueue as string[]).includes('partsFabrication')).toBe(true);
  // close by tap
  await page.locator('#tech-close').tap();
  await expect(page.locator('#tech-screen')).toBeHidden();
});

// ───────────────────────────── keyboard hints ─────────────────────────────

test('keyboard hints read as the rail: "tune it with [B]" says Builder, a trailing [M] goes, no key shows', async ({ page }) => {
  await boot(page);
  // what the shared modules write: a discovery line, a label, a button, an alert
  const out = await page.evaluate(async () => {
    const d = document.createElement('div');
    d.innerHTML = 'The Builder keeps it supplied: tune it with [B]. <span class="label">[G]</span> Open <b>[G]</b> to see the risks' +
      ' · [B] to tune · <button>◎ Open Lunar Map [M]</button> ○ research [T]';
    document.getElementById('ui-root')!.appendChild(d);
    await new Promise((r) => setTimeout(r, 0));
    const t = d.textContent;
    d.remove();
    return t;
  });
  expect(out).toBe('The Builder keeps it supplied: tune it with Builder.  Open Hazards to see the risks · Builder to tune · ◎ Open Lunar Map ○ research');
  // the panels and screens as they render
  await page.locator('#t-builder').tap();
  await expect(page.locator('#builder-panel')).toBeVisible();
  expect(await page.locator('#builder-panel').innerText()).not.toMatch(/\[[TMBGNI]\]/);
  await page.locator('#t-hazards').tap();
  await expect(page.locator('#hazards-panel')).toBeVisible();
  expect(await page.locator('#hazards-panel').innerText()).not.toMatch(/\[[TMBGNI]\]/);
  await page.locator('#t-map').tap();
  await expect(page.locator('#map-screen')).toBeVisible();
  await expect(page.locator('#map-strip')).toContainText('research');
  expect(await page.locator('#map-screen').innerText()).not.toMatch(/\[[TMBGNI]\]/);
});

// ───────────────────────────── the fit, at every size ─────────────────────────────

for (const [phone, vp] of Object.entries(PHONES)) {
  test.describe(`fit at ${phone} ${vp.width}×${vp.height}`, () => {
    test.use({ ...MOBILE, viewport: vp });
    test('HUD, palette, placement, sheet, tree, map, menu and the landing: in view, apart, 44 px targets, 11 px text, no page scroll', async ({ page }) => {
      test.setTimeout(240_000);
      // the landing first
      await page.goto(`${BASE}`);
      await page.waitForFunction(() => window.__game !== undefined);
      await expect(page.locator('#site-screen')).toBeVisible();
      expectFit(await fitReport(page, '#site-screen'), `${phone} landing`);
      await page.locator('.site-card').first().tap();
      await page.locator('#btn-land').tap();
      expectFit(await fitReport(page, '#site-screen'), `${phone} expedition`);

      await boot(page);
      // a lived-in base: a few alerts, a building under way
      await g(page, 'placeBuilding', 'solar', 132, 126);
      await frames(page, 3);
      expectFit(await fitReport(page, HUD), `${phone} HUD`, 5);
      await page.screenshot({ path: `test-results/touch-${vp.width}x${vp.height}-hud.png` });
      // the objectives open (the whole roadmap, scrolling)
      await page.locator('#milestones').tap();
      expectFit(await fitReport(page, HUD), `${phone} objectives open`, 5);
      await page.locator('#milestones').tap();
      // placing
      await page.locator('.bld-btn', { hasText: 'Solar Array' }).tap();
      await expect(page.locator('#touch-bar')).toBeVisible();
      expectFit(await fitReport(page, HUD), `${phone} placing`, 5);
      await page.locator('#tp-info').tap();
      await expect(page.locator('#touch-info')).toBeVisible();
      expectFit(await fitReport(page, HUD), `${phone} placing + info`, 5);
      await page.locator('#tb-cancel').tap();
      // the inspector sheet, over the palette's strip
      await g(page, 'select', 1);
      await expect(page.locator('#touch-sheet')).toBeVisible();
      expectFit(await fitReport(page, HUD), `${phone} inspector`, 5);
      // each resource panel the rail opens
      for (const b of ['#t-builder', '#t-hazards']) {
        await page.locator(b).tap();
        await expect(page.locator('#touch-sheet')).toBeVisible();
        expectFit(await fitReport(page, HUD), `${phone} ${b}`, 5);
      }
      await page.locator('#resource-strip .chip[data-slot="power"]').tap();
      await expect(page.locator('#res-panel')).toBeVisible();
      expectFit(await fitReport(page, HUD), `${phone} power panel`, 5);
      // the road tool's bar
      await page.locator('#t-road').tap();
      expectFit(await fitReport(page, HUD), `${phone} road`, 5);
      await page.locator('#tb-cancel').tap();

      // the tree: every page, a card in the sheet
      await page.locator('#t-tree').tap();
      await expect(page.locator('#tech-screen')).toBeVisible();
      const TREE = '#tech-head, #tech-page-head, #tech-main, #tech-sheet';
      await page.locator('.tech-card[data-tech="regolithProcessing"]').tap();
      for (let e = 1; e <= 8; e++) {
        await page.locator(`.era-tab[data-era="${e}"]`).tap();
        await expect(page.locator('#tech-board')).toHaveAttribute('data-era', String(e));
        expectFit(await fitReport(page, TREE), `${phone} tree E${e}`, 4);
        // every card is inside the board's own scroll, apart from the others
        const cards = await page.evaluate(() => {
          const rs = [...document.querySelectorAll('.tech-card')].map((c) => c.getBoundingClientRect());
          let overlaps = 0;
          for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
            const a = rs[i], b = rs[j];
            if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overlaps++;
          }
          return { n: rs.length, overlaps, minH: Math.min(...rs.map((r) => r.height)) };
        });
        expect(cards.n, `${phone} tree E${e} cards`).toBeGreaterThan(0);
        expect(cards.overlaps).toBe(0);
        expect(cards.minH).toBeGreaterThanOrEqual(44);
        if (e === 1) await page.screenshot({ path: `test-results/touch-${vp.width}x${vp.height}-tree.png` });
      }
      await page.locator('#tech-close').tap();

      // the map
      await page.locator('#t-map').tap();
      await expect(page.locator('#map-screen')).toBeVisible();
      expectFit(await fitReport(page, '#map-head, #map-main, #map-side, #map-strip'), `${phone} map`, 4);
      await page.screenshot({ path: `test-results/touch-${vp.width}x${vp.height}-map.png` });
      await page.locator('#map-close').tap();

      // the menu
      await page.locator('#t-menu').tap();
      await expect(page.locator('#menu')).toBeVisible();
      expectFit(await fitReport(page, '#menu .menu-panel'), `${phone} menu`);
      await page.screenshot({ path: `test-results/touch-${vp.width}x${vp.height}-menu.png` });
      await page.locator('#menu [data-act="resume"]').tap();
      await expect(page.locator('#menu')).toBeHidden();

      // the victory screen
      await page.evaluate(() => {
        const gm = window.__game;
        gm.completeTech('swarmProtocol');
        gm.grantResources({ foils: 10, launch: 3 });
        gm.grantPower(5000);
        gm.launch();
        gm.advanceGameSeconds(3);
      });
      await expect(page.locator('#victory-screen')).toBeVisible();
      expectFit(await fitReport(page, '#victory-screen'), `${phone} victory`);
      await page.locator('#btn-victory-continue').tap();
      await expect(page.locator('#victory-screen')).toBeHidden();

      // with the guidance on: the era explainer, then a discovery card
      await boot(page, '&tips');
      await expect(page.locator('#era-banner')).toBeVisible();
      await page.waitForTimeout(900); // it fades in
      expectFit(await fitReport(page, '#era-banner .eb-panel'), `${phone} era banner`);
      await page.locator('#era-banner [data-dsc="ok"]').tap();
      await expect(page.locator('#era-banner')).toBeHidden();
      await g(page, 'completeTech', 'regolithProcessing');
      await expect(page.locator('#discovery-card')).toBeVisible();
      await page.waitForTimeout(700); // it fades in
      expectFit(await fitReport(page, `${HUD}, #discovery-card`), `${phone} discovery card`, 4);
      await page.locator('#discovery-card [data-dsc="ok"]').tap();
      await expect(page.locator('#discovery-card')).toBeHidden();

      // the defeat screen (a crewed base, its life support drained)
      await page.goto(`${BASE}&site=mare`);
      await page.waitForFunction(() => window.__game !== undefined);
      await page.evaluate(() => {
        const gm = window.__game;
        gm.grantResources({ oxygen: -1000, food: -1000 });
        gm.advanceGameMinutes(7);
      });
      await expect(page.locator('#defeat-screen')).toBeVisible();
      expectFit(await fitReport(page, '#defeat-screen'), `${phone} defeat`);
    });
  });
}

// ───────────────────────────── audio ─────────────────────────────

/** the WebAudio stub pattern (playability.spec): here a real context,
 *  instrumented — when it was made, when it was asked to resume */
const AUDIO_SPY = `
  window.__audioLog = [];
  const Real = window.AudioContext;
  window.AudioContext = class extends Real {
    constructor(...a) { super(...a); window.__audioLog.push('create'); }
    resume() { window.__audioLog.push('resume'); return super.resume(); }
    suspend() { window.__audioLog.push('suspend'); return super.suspend(); }
  };`;

test('audio: the first tap on the landing screen unlocks it; hiding the page suspends it, showing resumes', async ({ page }) => {
  await page.addInitScript(AUDIO_SPY);
  await page.goto(BASE);
  await page.waitForFunction(() => window.__game !== undefined);
  await expect(page.locator('#site-screen')).toBeVisible();
  expect((await g(page, 'getAudio')).state).toBe('locked');
  expect(await page.evaluate(() => window.__audioLog)).toEqual([]);
  await page.locator('.site-card').first().tap();
  await expect.poll(async () => (await g(page, 'getAudio')).state).toBe('running');
  expect(await page.evaluate(() => window.__audioLog?.[0])).toBe('create');
  // iOS pauses a background page's audio: the game suspends it itself, and resumes on return
  const vis = (hidden: boolean) => page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { value: h, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: h ? 'hidden' : 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  await vis(true);
  await expect.poll(async () => (await g(page, 'getAudio')).state).toBe('suspended');
  await vis(false);
  await expect.poll(async () => (await g(page, 'getAudio')).state).toBe('running');
  expect(await page.evaluate(() => window.__audioLog)).toContain('resume');
});

// ───────────────────────────── saves on the go ─────────────────────────────

test('saves: the page hiding (or going away) saves at once, a synchronous copy too; the relaunch continues the base', async ({ page }) => {
  await boot(page);
  await g(page, 'placeBuilding', 'solar', 132, 126);
  await g(page, 'advanceGameSeconds', 30);
  const simTime = (await g(page, 'getState')).simTime as number;
  expect(await page.evaluate(() => localStorage.getItem('mbb-save-v1-sync'))).toBeNull();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const copy = await page.evaluate(() => JSON.parse(localStorage.getItem('mbb-save-v1-sync') ?? 'null'));
  expect(copy?.state?.buildings?.length).toBe(2);
  expect(copy.state.simTime).toBeCloseTo(simTime, 0);
  // hidden: the page neither draws nor steps (a phone's battery)
  const drawn = (await g(page, 'getRenderInfo')).framesDrawn;
  await page.waitForTimeout(600);
  expect((await g(page, 'getRenderInfo')).framesDrawn).toBe(drawn);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => (await g(page, 'getRenderInfo')).framesDrawn).toBeGreaterThan(drawn);
  // pagehide (iOS closing the tab) saves too
  await g(page, 'advanceGameSeconds', 20);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  const copy2 = await page.evaluate(() => JSON.parse(localStorage.getItem('mbb-save-v1-sync') ?? 'null'));
  expect(copy2.state.simTime).toBeGreaterThan(copy.state.simTime + 15);

  // the relaunch: the title screen offers the base, and a tap continues it
  await page.goto(BASE);
  await page.waitForFunction(() => window.__game !== undefined);
  await expect(page.locator('#btn-continue')).toBeVisible();
  await page.locator('#btn-continue').tap();
  await expect(page.locator('#touch-top')).toBeVisible();
  await expect.poll(async () => (await g(page, 'getState'))?.buildings?.length ?? 0).toBe(2);
  expect((await g(page, 'getState')).simTime).toBeGreaterThanOrEqual(copy2.state.simTime - 1);
});
