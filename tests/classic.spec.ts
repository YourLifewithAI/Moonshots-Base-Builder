/** The classic render style — the default look: forward rendering straight
 *  to an MSAA canvas (no composer, no render targets, no shadow map),
 *  faceted Lambert terrain whose vertex colours carry the site and its
 *  deposits, the classic building palette and lights, the fixed isometric
 *  camera, walk mode on the classic materials, the menu's Style switch,
 *  no "RENDER —" alerts, and a frame-cost sanity check. */
import { test, expect as baseExpect, type Page } from '@playwright/test';

// UI actions reach the sim on the next rendered frame; under software GL on
// a loaded machine a frame can take seconds
const expect = baseExpect.configure({ timeout: 20_000 });

declare global {
  interface Window { __game?: any }
}

const BASE = '/?debug&seed=42&nolock';
const DEG = Math.PI / 180;

async function boot(page: Page, site = 'mare', extra = '') {
  await page.goto(`${BASE}&site=${site}${extra}`);
  await page.waitForFunction(() => window.__game !== undefined && window.__game.getState() !== null);
}

const g = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => window.__game[f as string](...(a as unknown[])), [fn, args] as const);

/** let `n` frames render */
const frames = (page: Page, n = 3) => page.evaluate((k) => new Promise<void>((done) => {
  let left = k;
  const step = () => (--left <= 0 ? done() : requestAnimationFrame(step));
  requestAnimationFrame(step);
}), n);

const cam = (page: Page) => g(page, 'getCamera') as Promise<any>;

/** the isometric view has finished turning and zooming */
async function settled(page: Page) {
  await expect.poll(async () => {
    const c = await cam(page);
    return !c.iso.turning && Math.abs(c.iso.dist - c.iso.levels[c.iso.level]) < 0.05;
  }, { timeout: 30_000 }).toBe(true);
  return cam(page);
}

/** Warm, bright pixels (lit windows and lamps) inside a screen rect. */
async function warmPixels(page: Page, rect: { x0: number; y0: number; x1: number; y1: number }) {
  const png = await page.screenshot();
  return page.evaluate(async ([b64, r]) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const x0 = Math.max(0, Math.floor(r.x0)), y0 = Math.max(0, Math.floor(r.y0));
    const w = Math.min(bmp.width, Math.ceil(r.x1)) - x0, h = Math.min(bmp.height, Math.ceil(r.y1)) - y0;
    const { data } = ctx.getImageData(x0, y0, w, h);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [R, G, B] = [data[i], data[i + 1], data[i + 2]];
      // lamp-lit glass is a bright yellow warm white; sunlit orange trim is
      // redder, and its antialiased edges on white hulls dimmer
      if (R >= 240 && G >= 200 && B < 185 && B < G - 30) n++;
    }
    return n;
  }, [png.toString('base64'), rect] as const);
}

test('classic is the default: forward rendering to an MSAA canvas, no composer, no render targets', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.text().includes('THREE.WebGLProgram')) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await boot(page);
  await g(page, 'placeBuilding', 'solar', 132, 126);
  await frames(page, 10);
  const info = await g(page, 'getRenderInfo');
  expect(info.style).toBe('classic');
  expect(info.postChain, 'no effect composer').toBe(false);
  expect(info.targets.types, 'nothing but the canvas was drawn to').toEqual([]);
  expect(info.targets.float).toBe(false);
  expect(info.context.antialias, 'MSAA on the canvas').toBe(true);
  expect(info.context.shadowMap, 'no shadow map').toBe(false);
  expect(info.context.toneMapping, 'the palette is the colour you see').toBe(0);
  expect(info.shadowRenders).toBe(0);
  expect(Object.values(info.patches).every((v) => v === null), 'no shader patches').toBe(true);
  expect(info.patchFault).toBe(false);
  expect(info.safeMode).toBe(false);
  expect(info.terrain).toMatchObject({ material: 'MeshLambertMaterial', vertexColors: true, faceted: true });
  expect(info.horizonMaterial).toBe('MeshLambertMaterial');
  expect(info.rocks.material).toBe('MeshLambertMaterial');
  expect(info.buildingMaterials).toEqual({ lander: 'ShaderMaterial', solar: 'ShaderMaterial' });
  expect(info.base.trackers.material).toBe('ShaderMaterial');
  expect(info.base.reveal, 'the print reveal, not the squash-rise').toBe(true);
  expect(info.base.decals, 'a contact decal under each footprint').toBe(2);
  expect(info.frame.calls).toBeGreaterThan(0);
  // the High detail ladder is left alone: nothing stored, nothing failed
  expect(await page.evaluate(() => localStorage.getItem('mbb-fx-level'))).toBeNull();
  expect((await g(page, 'getRenderStatus')).failed).toEqual([]);
  expect(errors).toEqual([]);

  // ?style= overrides the setting for one launch
  await boot(page, 'mare', '&style=detailed');
  const d = await g(page, 'getRenderInfo');
  expect(d.style).toBe('detailed');
  expect(d.context.antialias).toBe(false);
  expect(d.context.shadowMap).toBe(true);
  expect(d.terrainMaterial).toBe('MeshStandardMaterial');
  expect((await cam(page)).iso).toBeNull();
});

test('terrain: vertex colours carry the site tint, and each deposit kind tints the ground its own way', async ({ page }) => {
  test.setTimeout(150_000);
  const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  /** mean terrain colour over each deposit's heart, by kind, and over plain ground */
  const colours = () => page.evaluate(() => {
    const g = window.__game;
    const deps = g.getDeposits() as { kind: string; x: number; z: number; r: number }[];
    const mean = (cs: number[][]) => [0, 1, 2].map((k) => cs.reduce((s, c) => s + c[k], 0) / cs.length);
    const plain: number[][] = [];
    for (let x = -440; x <= 440; x += 40) {
      for (let z = -440; z <= 440; z += 40) {
        if (deps.some((d) => Math.hypot(x - d.x, z - d.z) < d.r * 1.5)) continue;
        plain.push(g.terrainColorAt(x, z));
      }
    }
    const kinds: Record<string, number[]> = {};
    for (const kind of new Set(deps.map((d) => d.kind))) {
      const cs: number[][] = [];
      for (const d of deps.filter((q) => q.kind === kind)) {
        for (let i = -2; i <= 2; i++) {
          for (let j = -2; j <= 2; j++) cs.push(g.terrainColorAt(d.x + i * d.r * 0.15, d.z + j * d.r * 0.15));
        }
      }
      kinds[kind] = mean(cs);
    }
    return { plain: mean(plain), kinds };
  });

  await boot(page, 'mare');
  const mare = await colours();
  // the mesh stands on the heightfield's own samples
  const err = await g(page, 'terrainError');
  expect(err.vertex, 'every vertex is its grid sample').toBeLessThan(1e-4);
  expect(err.max, 'triangles vs bilinear hf.sample (m)').toBeLessThan(0.35);
  expect(err.mean).toBeLessThan(0.03);
  // high-Ti basalt: darker, and bluer than the warm mare
  expect(lum(mare.kinds.ilmenite)).toBeLessThan(lum(mare.plain) * 0.93);
  expect(mare.kinds.ilmenite[2] / mare.kinds.ilmenite[0]).toBeGreaterThan(mare.plain[2] / mare.plain[0] + 0.05);
  // mature soil: faintly darker and yellower
  expect(lum(mare.kinds.volatiles)).toBeLessThan(lum(mare.plain));
  expect(mare.kinds.volatiles[2] / mare.kinds.volatiles[1]).toBeLessThan(mare.plain[2] / mare.plain[1]);

  await boot(page, 'southpole');
  const pole = await colours();
  // the highland pole is lighter and cooler than the mare
  expect(lum(pole.plain)).toBeGreaterThan(lum(mare.plain) * 1.4);
  expect(pole.plain[0] / pole.plain[2]).toBeLessThan(mare.plain[0] / mare.plain[2]);
  // anorthosite brighter; ice a bluish white
  expect(lum(pole.kinds.anorthosite)).toBeGreaterThan(lum(pole.plain) * 1.08);
  expect(lum(pole.kinds.ice)).toBeGreaterThan(lum(pole.plain) * 1.05);
  expect(pole.kinds.ice[2] / pole.kinds.ice[0]).toBeGreaterThan(pole.plain[2] / pole.plain[0] + 0.1);

  await boot(page, 'lavatube');
  const tube = await colours();
  // pyroclastic glass a dark amber; KREEP a faint rose
  expect(lum(tube.kinds.glass)).toBeLessThan(lum(tube.plain));
  expect(tube.kinds.glass[0] / tube.kinds.glass[2]).toBeGreaterThan(tube.plain[0] / tube.plain[2] + 0.1);
  expect(tube.kinds.kreep[0] / tube.kinds.kreep[1]).toBeGreaterThan(tube.plain[0] / tube.plain[1] + 0.02);
  // every kind differs from every other
  const all = [mare.kinds.ilmenite, mare.kinds.volatiles, pole.kinds.anorthosite, pole.kinds.ice,
    tube.kinds.glass, tube.kinds.kreep].map((c) => c.map((v) => v / lum(c)));
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const d = Math.hypot(...all[i].map((v, k) => v - all[j][k]));
      expect(d, `tints ${i} and ${j} differ in hue`).toBeGreaterThan(0.01);
    }
  }
});

test('windows: dark by day in the sun, warm at night, dark when the structure is unpowered', async ({ page }) => {
  test.setTimeout(150_000);
  await boot(page, 'mare');
  await page.addStyleTag({ content: '#ui-root { visibility: hidden !important; }' });
  await page.evaluate(() => {
    const g = window.__game;
    g.setPaused(true);
    g.grantResources({ metals: 2000, parts: 800 });
    g.placeBuilding('lab', 135, 133);
    g.finishConstruction();
    g.advanceGameSeconds(120 - g.getState().simTime); // mid-morning
  });
  const lab = (await g(page, 'getState')).buildings.find((b: any) => b.type === 'lab');
  // the lab close up (the nearest zoom level), from the home side
  const cx = (lab.gx + 1) * 4 - 512, cz = (lab.gz + 1) * 4 - 512;
  await page.evaluate(([x, z]) => {
    const d = 100, p = 32 * Math.PI / 180, a = Math.PI / 4;
    window.__game.setView({ x: x + Math.cos(a) * Math.cos(p) * d, y: Math.sin(p) * d, z: z + Math.sin(a) * Math.cos(p) * d },
      { x, y: 0, z });
  }, [cx, cz]);
  await settled(page);
  const rect = await page.evaluate(([x, z]) => {
    const g = window.__game;
    const pts = [];
    for (const [dx, dz] of [[-4, -4], [4, -4], [4, 4], [-4, 4]]) {
      for (const lift of [0, 5]) pts.push(g.screenOf(x + dx, z + dz, lift));
    }
    return {
      x0: Math.min(...pts.map((p) => p.x)) - 4, x1: Math.max(...pts.map((p) => p.x)) + 4,
      y0: Math.min(...pts.map((p) => p.y)) - 4, y1: Math.max(...pts.map((p) => p.y)) + 4,
    };
  }, [cx, cz]);

  // day: powered, its light level 0 — dark blue glass in a sunlit hull
  await frames(page, 4);
  expect(await g(page, 'buildingGlow', lab.id)).toEqual({ glow: 0, powered: 1 });
  expect(await warmPixels(page, rect), 'no lit windows by day').toBeLessThan(5);

  // night, the banks full: the windows burn warm
  await page.evaluate(() => {
    const g = window.__game;
    g.grantPower(200000);
    g.advanceGameSeconds(610 - g.getState().simTime);
    g.grantPower(200000);
    g.advanceGameSeconds(1);
  });
  await expect.poll(async () => (await g(page, 'buildingGlow', lab.id)).glow).toBeGreaterThan(0.95);
  await frames(page, 4);
  expect(await warmPixels(page, rect), 'lit windows at night').toBeGreaterThan(40);

  // shut down: unpowered, dark again — though it is night
  await page.evaluate((id) => {
    window.__game.setEnabled(id, false);
    window.__game.advanceGameSeconds(1);
  }, lab.id);
  await expect.poll(async () => g(page, 'buildingGlow', lab.id)).toEqual({ glow: 0, powered: 0 });
  await frames(page, 4);
  expect(await warmPixels(page, rect), 'an unpowered structure stays dark').toBeLessThan(5);
});

test('isometric camera: Q/E turn exactly 90°, the wheel steps the zoom, WASD and right-drag pan, F and H', async ({ page }) => {
  test.setTimeout(150_000);
  await boot(page, 'mare');
  await g(page, 'setPaused', true);
  await g(page, 'grantResources', { metals: 200 });
  expect(await g(page, 'placeBuilding', 'lab', 135, 133)).toBe(true);
  let c = await settled(page);
  const home = c.target;
  expect(c.fov).toBe(20);
  expect(c.iso).toMatchObject({ yawStep: 0, level: 1, pitchDeg: 32 });
  expect(c.iso.yawDeg).toBeCloseTo(45, 6);
  expect(c.iso.levels).toHaveLength(5);
  expect(c.azimuth).toBeCloseTo(45 * DEG, 6);
  const pitch = (q: any) => Math.asin((q.pos.y - q.target.y) / q.dist);
  expect(pitch(c)).toBeCloseTo(32 * DEG, 3);

  // E turns one step, Q the other way; exactly 90° each, the pitch kept
  await page.keyboard.press('KeyE');
  c = await settled(page);
  expect(c.iso.yawStep).toBe(1);
  expect(c.azimuth).toBeCloseTo(135 * DEG, 6);
  expect(pitch(c)).toBeCloseTo(32 * DEG, 3);
  await page.keyboard.press('KeyQ');
  await page.keyboard.press('KeyQ');
  c = await settled(page);
  expect(c.iso.yawStep).toBe(-1);
  expect(c.azimuth).toBeCloseTo(-45 * DEG, 6);
  // a held key turns once, whatever the OS repeat does
  for (let i = 0; i < 5; i++) await page.keyboard.down('KeyE');
  await page.keyboard.up('KeyE');
  c = await settled(page);
  expect(c.iso.yawStep).toBe(0);
  expect(c.azimuth).toBeCloseTo(45 * DEG, 6);
  // turning never moves the target
  expect(Math.hypot(c.target.x - home.x, c.target.z - home.z)).toBeLessThan(0.5);

  // the wheel: one notch, one level (eased), clamped at both ends
  await page.mouse.move(720, 450);
  const dists: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, 120);
    c = await settled(page);
    dists.push(c.dist);
  }
  expect(dists.map((d) => Math.round(d))).toEqual([290, 490, 830, 830, 830]);
  for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -120); await frames(page, 2); }
  c = await settled(page);
  expect(c.iso.level).toBe(0);
  expect(c.dist).toBeCloseTo(100, 0);
  // a trackpad's trickle adds up to a step
  await page.evaluate(() => {
    const cv = document.getElementById('world')!;
    for (let i = 0; i < 4; i++) cv.dispatchEvent(new WheelEvent('wheel', { deltaY: 15, bubbles: true, cancelable: true }));
  });
  c = await settled(page);
  expect(c.iso.level).toBe(1);

  // W pans toward where the camera looks
  const t0 = c.target, look = { x: c.target.x - c.pos.x, z: c.target.z - c.pos.z };
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyW');
  c = await cam(page);
  const moved = { x: c.target.x - t0.x, z: c.target.z - t0.z };
  expect(Math.hypot(moved.x, moved.z)).toBeGreaterThan(3);
  expect(moved.x * look.x + moved.z * look.z, 'panned forward').toBeGreaterThan(0);

  // right-drag pans (the ground follows the pointer); a left-drag does not
  const t1 = (await cam(page)).target;
  await page.mouse.move(700, 500);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(800, 500, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  const t2 = (await cam(page)).target;
  expect(Math.hypot(t2.x - t1.x, t2.z - t1.z)).toBeGreaterThan(3);
  await page.mouse.move(700, 500);
  await page.mouse.down();
  await page.mouse.move(800, 560, { steps: 5 });
  await page.mouse.up();
  const t3 = (await cam(page)).target;
  expect(Math.hypot(t3.x - t2.x, t3.z - t2.z)).toBeLessThan(0.5);

  // F glides to the selection and closes in; H goes home at the home level
  const lab = (await g(page, 'getState')).buildings.find((b: any) => b.type === 'lab');
  await g(page, 'select', lab.id);
  await page.keyboard.press('KeyF');
  const labX = (lab.gx + 1) * 4 - 512, labZ = (lab.gz + 1) * 4 - 512;
  await expect.poll(async () => {
    const q = await cam(page);
    return Math.hypot(q.target.x - labX, q.target.z - labZ);
  }, { timeout: 15_000 }).toBeLessThan(1);
  expect((await settled(page)).iso.level).toBe(0);
  await page.keyboard.press('KeyH');
  await expect.poll(async () => {
    const q = await cam(page);
    return Math.hypot(q.target.x - home.x, q.target.z - home.z);
  }, { timeout: 15_000 }).toBeLessThan(1);
  expect((await settled(page)).iso.level).toBe(1);

  // clamped to the map, and always over the ground
  await page.keyboard.down('KeyA');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(6000);
  await page.keyboard.up('KeyA');
  await page.keyboard.up('KeyW');
  c = await cam(page);
  expect(Math.max(Math.abs(c.target.x), Math.abs(c.target.z))).toBeLessThanOrEqual(512 - 40 + 1e-6);
  expect(c.clearance).toBeGreaterThan(4);
  await g(page, 'setView', { x: 17, y: -30, z: 4 }, { x: 0, y: 0, z: 0 });
  c = await cam(page);
  expect(c.clearance, 'a view pushed under the ground is lifted back').toBeGreaterThan(40);
});

test('walk mode on the classic materials: the suit lens on foot, the isometric lens back', async ({ page }) => {
  await boot(page, 'mare');
  await g(page, 'setPaused', true);
  await g(page, 'setMode', 'walk');
  await frames(page, 5);
  let c = await cam(page);
  expect(c.fov).toBe(70);
  const info = await g(page, 'getRenderInfo');
  expect(info.style).toBe('classic');
  expect(info.terrain.material).toBe('MeshLambertMaterial');
  expect(info.lens.near).toBeCloseTo(0.15, 6);
  const p0 = await g(page, 'getPlayer');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  const p1 = await g(page, 'getPlayer');
  expect(Math.hypot(p1.x - p0.x, p1.z - p0.z), 'the astronaut walked').toBeGreaterThan(0.5);
  // Tab back: the dolly up ends on the isometric lens and its steps
  await page.keyboard.press('Tab');
  await expect.poll(async () => (await cam(page)).fov, { timeout: 20_000 }).toBe(20);
  c = await settled(page);
  expect(c.iso.pitchDeg).toBe(32);
  expect((await g(page, 'getRenderInfo')).lens.near).toBeGreaterThan(10);
});

test('menu: the Style switch saves, reloads straight back into the game, and persists', async ({ page }) => {
  // one High detail boot under software GL is slow; the classic ones are not
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.text().includes('THREE.WebGLProgram')) errors.push(m.text()); });
  /** the reloaded page has continued the saved game in `style` */
  const resumed = (style: string) => page.waitForFunction((st) => {
    const g = window.__game;
    if (!g || g.getState() === null) return false;
    try { return g.getRenderInfo().style === st; } catch { return false; }
  }, style, { timeout: 90_000 });
  await boot(page, 'mare', '&exp=robotic');
  await g(page, 'setPaused', true);
  expect(await g(page, 'placeBuilding', 'solar', 132, 126)).toBe(true);
  const id = (await g(page, 'getState')).buildings.length;
  await page.keyboard.press('Escape');
  const menu = page.locator('#menu');
  await expect(menu).toBeVisible();
  await expect(page.locator('#menu [data-style="classic"]')).toHaveClass(/active/);
  // the FX ladder and safe mode are High detail's
  await expect(page.locator('#menu-fx')).toBeHidden();
  await expect(page.locator('#menu-safe-row')).toBeHidden();
  await expect(page.locator('#menu-keys')).toContainText('turn the view 90°');
  await expect(page.locator('#menu-style-note')).toContainText('Switching saves the game and reloads');

  await page.locator('#menu [data-style="detailed"]').click();
  await page.waitForURL((u) => !u.searchParams.has('site'));
  await resumed('detailed');
  expect(errors).toEqual([]);
  // the same game, continued
  expect((await g(page, 'getState')).buildings.length).toBe(id);
  await page.waitForLoadState('load');
  await page.locator('#btn-menu').click();
  await expect(menu).toBeVisible();
  await expect(page.locator('#menu [data-style="detailed"]')).toHaveClass(/active/);
  await expect(page.locator('#menu-fx')).toBeVisible();
  await expect(page.locator('#menu-safe-row')).toBeVisible();
  await expect(page.locator('#menu-keys')).toContainText('orbit');

  // and back
  await page.locator('#menu [data-style="classic"]').click();
  await resumed('classic');
  expect((await g(page, 'getState')).buildings.length).toBe(id);

  // a plain reload keeps the choice (the title screen, then Continue)
  await page.reload();
  await page.waitForFunction(() => window.__game !== undefined);
  await page.locator('#btn-continue').click();
  await resumed('classic');
  expect((await g(page, 'getState')).buildings.length).toBe(id);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mbb-settings')!).style)).toBe('classic');
  expect(errors).toEqual([]);
});

test('no "RENDER —" alerts in classic: ten seconds by day, and the night after', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.text().includes('THREE.WebGLProgram')) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await boot(page, 'mare');
  await g(page, 'advanceGameSeconds', 120); // mid-morning: the check reads every frame it probes
  await page.waitForTimeout(10_000);
  let st = await g(page, 'getState');
  expect(st.alerts.filter((a: any) => /^RENDER|SAFE RENDER/.test(a.text)).map((a: any) => a.text)).toEqual([]);
  let info = await g(page, 'getRenderInfo');
  expect(info.probes.black).toBe(0);
  expect(info.probes.ok, 'the black-frame check read a lit frame').toBeGreaterThan(0);
  expect(info.safeMode).toBe(false);
  // the blue-black night is well off black: the check reads it, and passes
  await page.evaluate(() => {
    const g = window.__game;
    g.grantPower(200000);
    g.advanceGameSeconds(610 - g.getState().simTime);
    g.setPaused(true);
    g.probeNext();
  });
  await expect.poll(async () => (await g(page, 'getRenderInfo')).probes.ok, { timeout: 30_000 })
    .toBeGreaterThan(info.probes.ok);
  st = await g(page, 'getState');
  info = await g(page, 'getRenderInfo');
  expect(info.probes.black).toBe(0);
  expect(st.alerts.filter((a: any) => /^RENDER|SAFE RENDER/.test(a.text)).map((a: any) => a.text)).toEqual([]);
  expect(errors).toEqual([]);
});

test('frame cost: draw calls, triangles and frame time stay small in classic', async ({ page }) => {
  test.setTimeout(150_000);
  const base = async (extra: string) => {
    await boot(page, 'mare', extra);
    await page.evaluate(() => {
      const g = window.__game;
      g.setPaused(true);
      g.grantResources({ metals: 3000, parts: 1000 });
      for (const [t, x, z] of [['solar', 132, 126], ['solar', 132, 130], ['habitat', 126, 132], ['lab', 135, 133],
        ['excavator', 120, 126], ['storageYard', 121, 132]] as const) g.placeBuilding(t, x, z);
      g.finishConstruction();
    });
    await page.waitForTimeout(2000);
    // frame intervals over ~3 s (software GL here: only a sanity bound)
    const dts = await page.evaluate(() => new Promise<number[]>((done) => {
      const out: number[] = [];
      let last = performance.now();
      const t0 = last;
      const step = (t: number) => {
        out.push(t - last);
        last = t;
        if (t - t0 < 3000) requestAnimationFrame(step); else done(out);
      };
      requestAnimationFrame(step);
    }));
    dts.sort((a, b) => a - b);
    const info = await g(page, 'getRenderInfo');
    return { median: dts[Math.floor(dts.length / 2)], frame: info.frame, style: info.style };
  };
  const classic = await base('');
  const detailed = await base('&style=detailed&fx=0');
  test.info().annotations.push({
    type: 'frame cost',
    description: `classic ${JSON.stringify(classic)} · detailed FX 0 ${JSON.stringify(detailed)}`,
  });
  console.log('[frame cost]', JSON.stringify({ classic, detailed }));
  expect(classic.style).toBe('classic');
  expect(classic.frame.calls, 'draw calls in a small base at home').toBeLessThan(60);
  expect(classic.frame.triangles).toBeLessThan(400_000);
  expect(classic.frame.calls).toBeLessThan(detailed.frame.calls);
  expect(classic.median, 'median frame (ms)').toBeLessThan(Math.max(250, detailed.median * 1.1));
});
