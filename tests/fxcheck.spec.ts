/** FX 0's safety net (docs/06 §4): the HDR sanitiser, the FX
 *  self-check and the render report.
 *
 *  The self-check compares the frame the post chain drew with the same
 *  scene drawn plain; a correct FX 0 passes it by day, at dusk and at
 *  night. A level broken the way a faulty GPU breaks it (debugBreakFx: the
 *  player's report — black ground, flat grey hulls — or a black landscape)
 *  fails it with the black-frame sentinel held off: one rung down, said in
 *  the console, and the next rung is checked too. NaN made in a scene
 *  shader stays on the pixels that made it with the sanitiser on; the stock
 *  chain let bloom smear it over the whole frame. With nothing wrong, the
 *  hardening draws exactly the frame the stock chain drew. The capability
 *  floor boots below FX 0 when half-float buffers cannot do their job, and
 *  the menu's Copy render report puts the whole story on the clipboard. */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

// SwiftShader draws on the CPU: a small canvas keeps a frame (and a check,
// which waits one out) to a second or so
test.use({ viewport: { width: 800, height: 450 } });

const SLOW = { timeout: 90_000 };
const VIEW = [{ x: 38, y: 26, z: 52 }, { x: 2, y: 0, z: 4 }] as const;

/** An early Mare base (lab, excavator, solar, a construction site), paused mid-morning. */
async function boot(page: Page, hideUi = true) {
  await page.goto('/?debug&style=detailed&seed=42&nolock&site=mare');
  await page.waitForFunction(() => window.__game !== undefined);
  // the world only: HUD panels would count in the pixel stats
  if (hideUi) await page.addStyleTag({ content: '#ui-root { visibility: hidden !important; }' });
  await page.evaluate(([p, q]) => {
    const g = window.__game;
    g.setPaused(true);
    g.grantResources({ metals: 3000, parts: 900 });
    for (const [t, x, z] of [['lab', 135, 133], ['excavator', 120, 126], ['solar', 132, 126]] as const) g.placeBuilding(t, x, z);
    g.finishConstruction();
    g.advanceGameSeconds(120);
    g.placeBuilding('habitat', 129, 121);
    g.setView(p, q);
  }, VIEW);
}

/** Night (mid-night, banks full), or any time of the 720 s cycle. */
async function timeOfDay(page: Page, t: number) {
  await page.evaluate((tt) => {
    const g = window.__game;
    g.grantPower(200000);
    g.advanceGameSeconds(((tt - (g.getState().simTime % 720)) + 720) % 720);
    g.grantPower(200000);
  }, t);
}

const lastCheck = (page: Page) => page.evaluate(() => window.__game.getFxChecks().at(-1) ?? null);
const seq = async (page: Page) => (await lastCheck(page))?.seq ?? 0;

/** Run the self-check on the next drawn frame and return its result. */
async function checkNow(page: Page) {
  const before = await seq(page);
  await page.evaluate(() => window.__game.fxCheckNext());
  await expect.poll(() => seq(page), SLOW).toBeGreaterThan(before);
  return lastCheck(page);
}

/** Mean display luminance per cell of a 32×18 grid of a screenshot, and its black share. */
async function grid(page: Page) {
  const png = await page.screenshot();
  return page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
    const GW = 32, GH = 18;
    const sum = new Array(GW * GH).fill(0), n = new Array(GW * GH).fill(0);
    let black = 0;
    for (let y = 0; y < bmp.height; y++) {
      for (let x = 0; x < bmp.width; x++) {
        const i = (y * bmp.width + x) * 4;
        const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        if (l < 1.5) black++;
        const k = Math.floor((y * GH) / bmp.height) * GW + Math.floor((x * GW) / bmp.width);
        sum[k] += l; n[k]++;
      }
    }
    return { cells: sum.map((s, k) => s / n[k]), black: black / (bmp.width * bmp.height) };
  }, png.toString('base64'));
}

const meanAbs = (a: number[], b: number[]) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;

test('the FX self-check passes FX 0 at boot, by day, at dusk and at night', async ({ page }) => {
  // SwiftShader draws on the CPU: a check waits out a whole frame (seconds)
  test.setTimeout(480_000);
  const lines: string[] = [];
  page.on('console', (m) => lines.push(m.text()));
  await boot(page);
  // the boot check runs by itself on the first frames of play
  await expect.poll(async () => (await lastCheck(page))?.verdict, SLOW).toBe('pass');
  for (const [name, t] of [['day', 120], ['dusk', 460], ['night', 610]] as const) {
    await timeOfDay(page, t);
    // the base, and a low look at the horizon (walk-mode height: AO grazes)
    for (const view of [VIEW, [{ x: 20, y: 3, z: 30 }, { x: -40, y: 12, z: -60 }]]) {
      await page.evaluate(([p, q]) => window.__game.setView(p, q), view);
      await page.waitForTimeout(800);
      const r = await checkNow(page);
      expect(r.level, `${name}: checked at FX 0`).toBe(0);
      expect(r.verdict, `${name}: ${r.reasons.join('; ')}`).not.toBe('fail');
      if (name !== 'dusk') expect(r.verdict, `${name}: conclusive`).toBe('pass');
      // FX 0 draws the plain path's frame, give or take AO and bloom
      expect(r.metrics.meanRatio).toBeGreaterThan(0.7);
      expect(r.metrics.meanRatio).toBeLessThan(1.3);
      expect(r.metrics.lost, `${name}: nothing lit went black`).toBeLessThan(0.1);
      expect(r.hdr.nan + r.hdr.inf, `${name}: the scene buffer is finite`).toBe(0);
    }
  }
  const info = await page.evaluate(() => window.__game.getRenderInfo());
  expect(info.fxLevel, 'the checks never stepped down').toBe(0);
  expect(lines.some((l) => l.startsWith('[MOONSHOTS] FX self-check: level 0 passed'))).toBe(true);
  expect(lines.some((l) => /FX self-check: level \d failed/.test(l))).toBe(false);
});

test('a level that draws wrong fails its self-check: a rung down, said in the console, the next rung checked', async ({ page }) => {
  test.setTimeout(300_000);
  const lines: string[] = [];
  page.on('console', (m) => lines.push(m.text()));
  await boot(page);
  await expect.poll(async () => (await lastCheck(page))?.verdict, SLOW).toBe('pass');
  await timeOfDay(page, 610);
  // only the self-check may see it (the black-frame sentinel would catch the
  // black ground on its own at night)
  await page.evaluate(() => { window.__game.holdBlackFrameCheck(true); window.__game.debugBreakFx(0, 'player'); });
  await page.waitForTimeout(800);
  const r = await checkNow(page);
  expect(r.level).toBe(0);
  expect(r.verdict).toBe('fail');
  expect(r.reasons.join(' ')).toMatch(/black where the plain path shows light/);
  expect(lines.some((l) => l.startsWith('[MOONSHOTS] FX self-check: level 0 failed ('))).toBe(true);
  let st = await page.evaluate(() => window.__game.getRenderStatus());
  expect(st.level, 'one rung down').toBe(1);
  expect(st.failed).toContain(0);
  expect(st.reason).toMatch(/^FX self-check: /);
  // …and FX 1 is checked the same way, by itself, and draws right
  await expect.poll(async () => (await lastCheck(page))?.seq, SLOW).toBeGreaterThan(r.seq);
  const next = await lastCheck(page);
  expect(next.level).toBe(1);
  expect(next.verdict).toBe('pass');
  expect((await page.evaluate(() => window.__game.getRenderInfo())).fxStored).toBe(1);

  // a black landscape at FX 1 steps on to FX 2, which is checked and kept
  await page.evaluate(() => window.__game.debugBreakFx(1, 'zero'));
  await page.waitForTimeout(800);
  const r1 = await checkNow(page);
  expect(r1.level).toBe(1);
  expect(r1.verdict).toBe('fail');
  expect(lines.some((l) => l.startsWith('[MOONSHOTS] FX self-check: level 1 failed ('))).toBe(true);
  await expect.poll(async () => (await lastCheck(page))?.seq, SLOW).toBeGreaterThan(r1.seq);
  expect((await lastCheck(page)).level).toBe(2);
  expect((await lastCheck(page)).verdict).toBe('pass');
  st = await page.evaluate(() => window.__game.getRenderStatus());
  expect(st.level).toBe(2);
  expect(st.failed).toEqual([0, 1]);
  await page.evaluate(() => { window.__game.debugBreakFx(null); window.__game.holdBlackFrameCheck(false); });
});

test('the HDR sanitiser keeps NaN on the pixels that made it; the stock chain smeared it over the frame', async ({ page }) => {
  test.setTimeout(300_000);
  await boot(page);
  await timeOfDay(page, 610);
  await page.evaluate(() => {
    const g = window.__game;
    g.setFxCheckAuto(false);
    g.holdBlackFrameCheck(true);
  });
  await page.waitForTimeout(1500);
  const clean = await grid(page);
  // NaN in the hulls' light, as a faulty driver might make it
  await page.evaluate(() => window.__game.debugBreakFx(0, 'nan'));
  await page.waitForTimeout(2500);
  const kept = await grid(page);
  expect(kept.black - clean.black, 'only the hulls go black').toBeLessThan(0.1);
  expect(meanAbs(kept.cells, clean.cells), 'the rest of the frame is untouched').toBeLessThan(8);
  // the stock chain: bloom's mip chain carries one NaN pixel over hundreds
  await page.evaluate(() => window.__game.setFxHardening(false));
  await page.waitForTimeout(2500);
  const smeared = await grid(page);
  expect(smeared.black, 'the stock chain spreads it').toBeGreaterThan(0.5);
  await page.evaluate(() => window.__game.setFxHardening(true));
  await page.waitForTimeout(1500);
  // the self-check reads the scene buffer itself: NaN there fails the level
  const r = await checkNow(page);
  expect(r.hdr.nan).toBeGreaterThan(0.003);
  expect(r.verdict).toBe('fail');
  expect(r.reasons.join(' ')).toMatch(/NaN\/Inf in/);
  expect(await page.evaluate(() => window.__game.getFxLevel())).toBe(1);
  await page.evaluate(() => window.__game.debugBreakFx(null));
});

test('with nothing wrong, the hardened chain draws the stock chain\'s frame at FX 0, day and night', async ({ page }) => {
  test.setTimeout(240_000);
  await boot(page);
  await page.evaluate(() => { window.__game.setFxCheckAuto(false); });
  for (const t of [120, 610]) {
    await timeOfDay(page, t);
    await page.waitForTimeout(1500);
    const on = await grid(page);
    await page.evaluate(() => window.__game.setFxHardening(false));
    await page.waitForTimeout(2000);
    const off = await grid(page);
    await page.evaluate(() => window.__game.setFxHardening(true));
    await page.waitForTimeout(2000);
    const again = await grid(page);
    // the film grain alone moves a cell by a fraction of a level
    expect(meanAbs(on.cells, off.cells), `t=${t}: hardened vs stock`).toBeLessThan(0.6);
    expect(Math.abs(on.black - off.black)).toBeLessThan(0.002);
    expect(meanAbs(again.cells, off.cells)).toBeLessThan(0.6);
  }
  const info = await page.evaluate(() => window.__game.getRenderReport());
  expect(info.fx.level).toBe(0);
  expect(info.fx.sanitizer).toBe('n8ao');
});

test('the capability floor boots below FX 0 when half-float buffers cannot do their job', async ({ page }) => {
  test.setTimeout(180_000);
  // SwiftShader's half-float buffers are fine; this browser reads its
  // one-texel linear sample back as a nearest one
  await page.addInitScript(() => {
    const read = WebGL2RenderingContext.prototype.readPixels;
    let broken = true;
    (window as any).__mendHalfFloat = () => { broken = false; };
    WebGL2RenderingContext.prototype.readPixels = function (this: WebGL2RenderingContext, ...a: any[]) {
      read.apply(this, a as any);
      const [, , w, h, , type, out] = a;
      if (broken && type === this.FLOAT && w === 1 && h === 1 && out instanceof Float32Array) out[0] = 1.5;
    } as any;
  });
  await page.goto('/?debug&style=detailed&seed=42&nolock&site=mare');
  await page.waitForFunction(() => window.__game !== undefined);
  let rep = await page.evaluate(() => window.__game.getRenderReport());
  expect(rep.fx.halfFloatProbe.ok).toBe(false);
  expect(rep.fx.halfFloatProbe.why).toMatch(/linear filtering/);
  expect(rep.fx.capFloor).toBe(1);
  expect(rep.fx.level, 'boots at FX 1').toBe(1);
  expect(rep.fx.stored, 'the stored level is untouched: it never failed').toBe(0);
  expect((await page.evaluate(() => window.__game.getRenderStatus())).reason).toMatch(/half-float buffers failed the capability check/);

  // without float targets at all, the AO levels go too
  await page.addInitScript(() => {
    const sup = WebGL2RenderingContext.prototype.getSupportedExtensions;
    WebGL2RenderingContext.prototype.getSupportedExtensions = function (this: WebGL2RenderingContext) {
      return (sup.call(this) ?? []).filter((e) => e !== 'EXT_color_buffer_float');
    };
  });
  await page.reload();
  await page.waitForFunction(() => window.__game !== undefined);
  rep = await page.evaluate(() => window.__game.getRenderReport());
  expect(rep.fx.capFloor).toBe(2);
  expect(rep.webgl.extensions.EXT_color_buffer_float).toBe(false);
  expect(rep.fx.level).toBe(2);
});

test('Copy render report puts the GPU, the browser, the ladder and the checks on the clipboard', async ({ page, context }) => {
  test.setTimeout(180_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const lines: string[] = [];
  page.on('console', (m) => lines.push(m.text()));
  await boot(page, false);
  await expect.poll(async () => (await lastCheck(page))?.verdict, SLOW).toBe('pass');
  // a shader complaint reaches the report's log (three prints them this way)
  await page.evaluate(() => console.warn('THREE.WebGLProgram: Program Info Log: test warning'));
  await page.keyboard.press('Escape');
  await page.locator('#menu-report').click();
  await expect(page.locator('#menu-report-note')).toContainText('copied');
  const rep = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(rep.gpu.renderer).toBeTruthy();
  expect(rep.gpu.vendor).toBeTruthy();
  expect(rep.userAgent).toMatch(/Chrome/);
  for (const e of ['EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'OES_texture_float_linear', 'EXT_float_blend']) {
    expect(typeof rep.webgl.extensions[e], e).toBe('boolean');
  }
  expect(rep.webgl.precision['fragment.medium']).toHaveLength(3);
  expect(rep.fx).toMatchObject({ level: 0, ladder: 0, stored: 0, sanitizer: 'n8ao', capFloor: 0 });
  expect(rep.fx.halfFloatProbe.ok).toBe(true);
  expect(rep.safe.on).toBe(false);
  expect(rep.patches.terrain).toBe('regolith-2');
  expect(rep.patches.building).toBe('bldg-2');
  expect(rep.selfCheck.length).toBeGreaterThan(0);
  expect(rep.selfCheck.at(-1)).toMatchObject({ level: 0, verdict: 'pass' });
  expect(rep.selfCheck.at(-1).metrics).toHaveProperty('lost');
  expect(rep.log.some((e: any) => e.kind === 'three-warn' && /test warning/.test(e.msg))).toBe(true);
  expect(rep.log.some((e: any) => e.kind === 'fx' && /self-check passed at FX 0/.test(e.msg))).toBe(true);
  expect(lines.some((l) => l.startsWith('[MOONSHOTS] Render report'))).toBe(true);
});
