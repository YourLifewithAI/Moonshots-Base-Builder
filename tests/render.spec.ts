/** The one renderer: the cel style. Forward rendering straight to an MSAA
 *  canvas (no post chain, no render targets, no shadow map), faceted stepped-light
 *  terrain whose vertex colours carry the site and its deposits, the cel
 *  building palette and lights, the fixed isometric camera, the menu's one
 *  Graphics row, no "RENDER —" alerts and a frame-cost sanity check. The
 *  motion layer (rovers, dust, launch and resupply) and each structure's own
 *  light (its darkness, not the clock) are checked here too. The
 *  render-safety contract: safe mode draws plain with the black-frame check
 *  still on, holds across a reload, the check reads night frames, the tech
 *  tree and map rest the GPU, and a browser without WebGL2 gets a page that
 *  says so. (This file folds the old classic.spec and the High detail
 *  render.spec: docs/19 W0b1.) */
import { chromium, test, expect as baseExpect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

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
    return !c.iso.turning && !c.iso.tilting && Math.abs(c.iso.dist - c.iso.zoomTo) < 0.05;
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

test('one renderer: forward rendering to an MSAA canvas, no post chain, no shadow map, the cel materials', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.text().includes('THREE.WebGLProgram')) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await boot(page);
  await g(page, 'placeBuilding', 'solar', 132, 126);
  await frames(page, 10);
  const info = await g(page, 'getRenderInfo');
  expect(info.style).toBe('cel');
  expect(info.camera, 'the camera as the isometric view reports it').toMatchObject({ rot: 0, tilt: 0 });
  expect(info.camera.zoom).toBeGreaterThan(100);
  expect(info.context.antialias, 'MSAA on the canvas').toBe(true);
  expect(info.context.shadowMap, 'no shadow map').toBe(false);
  expect(info.context.toneMapping, 'the palette is the colour you see').toBe(0);
  expect(info.safe).toBe(false);
  expect(info.safeMode).toBe(false);
  // the cel ground program (world/celSurface.ts): one small ShaderMaterial for terrain, ring and boulders
  expect(info.terrain).toMatchObject({ material: 'ShaderMaterial', vertexColors: true, faceted: true });
  expect(info.horizonMaterial).toBe('ShaderMaterial');
  expect(info.rocks.material).toBe('ShaderMaterial');
  expect(info.buildingMaterials).toEqual({ lander: 'ShaderMaterial', solar: 'ShaderMaterial' });
  expect(info.base.trackers.material).toBe('ShaderMaterial');
  expect(info.base.reveal, 'the print reveal, not the squash-rise').toBe(true);
  expect(info.base.decals, 'a contact decal under each footprint').toBe(2);
  expect(info.frame.calls).toBeGreaterThan(0);
  expect(info.drawCalls).toBe(info.frame.calls);
  expect(info.triangles).toBe(info.frame.triangles);
  // the retired FX ladder left no trace in the render status
  expect(Object.keys(await g(page, 'getRenderStatus')).sort()).toEqual(['checking', 'safe', 'safeAuto']);
  expect(errors).toEqual([]);

  // ?style, ?fx and ?lowfx are ignored: one renderer whatever the address says
  await boot(page, 'mare', '&style=detailed&fx=0&lowfx');
  const d = await g(page, 'getRenderInfo');
  expect(d.style).toBe('cel');
  expect(d.context.antialias).toBe(true);
  expect(d.context.shadowMap).toBe(false);
  expect(d.terrainMaterial).toBe('ShaderMaterial');
  expect((await cam(page)).iso).not.toBeNull();
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

test('isometric camera: Q/E turn exactly 90°, the wheel zooms continuously, WASD and right-drag pan, F and H', async ({ page }) => {
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

  // the wheel zooms continuously (a notch is about one old level step, eased), clamped at both ends
  await page.mouse.move(720, 450);
  const dists: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, 120);
    c = await settled(page);
    dists.push(c.dist);
  }
  expect(dists[0]).toBeGreaterThan(250);
  expect(dists[1]).toBeGreaterThan(dists[0] * 1.5);
  expect(dists.slice(2).map((d) => Math.round(d))).toEqual([830, 830, 830]);
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

test('menu: Graphics is the one safe-mode row, and Controls list the fixed camera', async ({ page }) => {
  await boot(page, 'mare');
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeVisible();
  // no render style, FX ladder or render report any more
  await expect(page.locator('#menu [data-style]')).toHaveCount(0);
  await expect(page.locator('#menu-fx')).toHaveCount(0);
  await expect(page.locator('#menu-report')).toHaveCount(0);
  await expect(page.locator('#menu-safe-row')).toBeVisible();
  await expect(page.locator('#menu-safe')).toHaveText('Off');
  await expect(page.locator('#menu-keys')).toContainText('turn the view 90°');
  await expect(page.locator('#menu-keys')).toContainText('tilt the view');
  await expect(page.locator('#menu-keys')).not.toContainText('orbit');
});

test('no "RENDER —" alerts:  ten seconds by day, and the night after', async ({ page }) => {
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

test('frame cost: draw calls, triangles and frame time stay small', async ({ page }) => {
  test.setTimeout(150_000);
  await boot(page, 'mare');
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
  const cost = { median: dts[Math.floor(dts.length / 2)], frame: info.frame, style: info.style };
  test.info().annotations.push({ type: 'frame cost', description: JSON.stringify(cost) });
  console.log('[frame cost]', JSON.stringify(cost));
  expect(cost.style).toBe('cel');
  expect(cost.frame.calls, 'draw calls in a small base at home').toBeLessThan(60);
  expect(cost.frame.triangles).toBeLessThan(400_000);
  expect(cost.median, 'median frame (ms)').toBeLessThan(250);
});

test('palette: LEAF maps to its own key; the destiny buildings take their overrides and their family accent, and render on the cel program', async ({ page }) => {
  test.setTimeout(150_000);
  await boot(page, 'mare', '&exp=robotic');
  const r = await page.evaluate(async () => {
    const C = await import('/src/buildings/celBuilding.ts');
    const K = await import('/src/buildings/meshKit.ts');
    const R = await import('/src/buildings/recipes.ts');
    const Color = C.CEL_COLD.constructor as any;
    const has = (type: string, hex: number) => {
      const col = C.celColors(R.recipeGeometry(type as any)).array as Float32Array;
      const c = new Color(hex);
      for (let i = 0; i < col.length; i += 3) {
        if (Math.abs(col[i] - c.r) < 1e-4 && Math.abs(col[i + 1] - c.g) < 1e-4 && Math.abs(col[i + 2] - c.b) < 1e-4) return true;
      }
      return false;
    };
    const g = window.__game!;
    g.setPaused(true);
    g.openRoads(true);
    for (const t of ['droneHives', 'greenhouseRings', 'gardenDomes', 'fleetOS', 'lunarDataCenter']) g.completeTech(t);
    g.grantResources({ metals: 900, silicon: 200, parts: 300, chips: 100 });
    for (const type of ['droneHive', 'greenhouseRing', 'gardenDome', 'serverMonolith']) {
      let ok = false;
      for (let rr = 5; rr < 30 && !ok; rr++) for (let dx = -rr; dx <= rr && !ok; dx += 2) ok = g.placeBuilding(type, 127 + dx, 127 - rr) || g.placeBuilding(type, 127 + dx, 127 + rr);
    }
    g.finishConstruction();
    g.advanceGameSeconds(1);
    return {
      leaf: C.finishKey(K.LEAF.v, K.LEAF.rough, K.LEAF.metal, K.LEAF.emit ?? 0),
      leafHex: C.CEL_PALETTE.leaf,
      // the old fallback would have read LEAF's value as dark blue cells
      others: [K.GLASS, K.TRIM, K.PLATE].map((f) => C.finishKey(f.v, f.rough, f.metal, f.emit ?? 0)),
      ringLeaf: has('greenhouseRing', 0x3f6f34), domeLeaf: has('gardenDome', 0x3f6f34),
      monolithHull: has('serverMonolith', 0x23262b), monolithGlass: has('serverMonolith', 0x0f3a44),
      hiveHull: has('droneHive', 0x3a3f46),
      // one accent per family: the dome's ribs wear the life green, not silver (docs/19 S1a)
      domeRibs: has('gardenDome', 0x7cc242),
      habitatNoLeaf: !has('habitat', 0x3f6f34),
      materials: g.getRenderInfo().buildingMaterials,
    };
  });
  expect(r.leaf).toBe('leaf');
  expect(r.leafHex).toBe(0x3f6f34);
  expect(r.others).toEqual(['cell', 'trim', 'panel']);
  expect(r).toMatchObject({ ringLeaf: true, domeLeaf: true, monolithHull: true, monolithGlass: true, hiveHull: true, domeRibs: true, habitatNoLeaf: true });
  for (const t of ['droneHive', 'greenhouseRing', 'gardenDome', 'serverMonolith']) expect(r.materials[t], t).toBe('ShaderMaterial');
});

// ───────────────────── the base's own light, the motion layer, safety ─────────────────────

/** A free spot for `type` near the base (deterministic for a seed). */
function freeSpot(page: Page, type: string) {
  return page.evaluate((t) => {
    for (let r = 0; r < 10; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const gx = 125 + dx * 3, gz = 125 + dz * 3;
          if (window.__game.canPlace(t, gx, gz).valid) return [gx, gz] as [number, number];
        }
      }
    }
    return null;
  }, type);
}

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test('solar wings stand near-vertical under the grazing polar night sun', async ({ page }) => {
  await boot(page, 'southpole');
  await page.evaluate(() => window.__game.setPaused(true));
  const spot = await freeSpot(page, 'solar');
  expect(spot).not.toBeNull();
  await page.evaluate(([gx, gz]) => {
    const g = window.__game;
    g.placeBuilding('solar', gx, gz);
    g.finishConstruction();
    g.advanceGameSeconds(600 - g.getState().simTime);
  }, spot!);
  await page.waitForTimeout(800);
  const info = await g(page, 'getRenderInfo');
  expect(info.base.trackers.wings).toBe(1);
  expect(dot(info.base.trackers.wingNormal, info.base.sunDir)).toBeGreaterThan(0.97);
  expect(Math.abs(info.base.trackers.wingNormal[1]), 'panel face near-vertical').toBeLessThan(0.12);
});

/** A small base (Lander, habitat, lab, solar array) built, powered and held
 *  paused at game-second `t` of a fresh `site` world; returns its ids. */
async function litBase(page: Page, site: string, seed: number, t: number): Promise<number[]> {
  await page.setViewportSize({ width: 800, height: 450 });
  await page.goto(`/?debug&seed=${seed}&nolock&site=${site}`);
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => {
    window.__game.setPaused(true);
    window.__game.grantResources({ metals: 4000, parts: 1500 });
  });
  for (const type of ['habitat', 'lab', 'solar']) {
    const spot = await freeSpot(page, type);
    expect(spot, `a free spot for ${type}`).not.toBeNull();
    expect(await page.evaluate(([ty, [gx, gz]]) => window.__game.placeBuilding(ty, gx, gz), [type, spot!] as const))
      .toBe(true);
  }
  return page.evaluate((at) => {
    const g = window.__game;
    g.finishConstruction();
    g.grantPower(200000);
    g.advanceGameSeconds(at - g.getState().simTime);
    g.grantPower(200000);
    return g.getState().buildings.map((b: any) => b.id);
  }, t);
}

const buildingLight = (page: Page, id: number) => page.evaluate((i) => window.__game.getBuildingLight(i), id);
/** every listed structure has had a shading pass since the world was built */
const sampled = (page: Page, ids: number[]) =>
  expect.poll(() => page.evaluate((list) => list.every((i: number) => window.__game.getBuildingLight(i).sampled), ids),
    { timeout: 20_000 }).toBe(true);
const renderInfo = (page: Page) => g(page, 'getRenderInfo') as Promise<any>;
const status = (page: Page) => g(page, 'getRenderStatus') as Promise<any>;
const SLOW = { timeout: 60_000 };

test('own light: at the pole by day, a structure in the rim\'s shadow lights its windows and its pool', async ({ page }) => {
  test.setTimeout(120_000);
  // day 2, 20 s after sunrise: the sun ~5° up, the base under the rim's shadow
  const ids = await litBase(page, 'southpole', 1234, 740);
  const st = await g(page, 'getState');
  expect(st.simTime % 720, 'the clock says day').toBeLessThan(480);
  await sampled(page, ids);
  const lights = await Promise.all(ids.map((id) => buildingLight(page, id)));
  const i = lights.findIndex((l) => l.shaded && l.lit);
  expect(i, 'the raycast finds a powered structure in terrain shadow').toBeGreaterThanOrEqual(0);
  const id = ids[i];
  expect(lights[i].night, 'no night factor at all').toBe(0);
  // k climbs to the shadow's 1 (a fade of about a second), windows and lamps with it
  await expect.poll(async () => (await buildingLight(page, id)).k, { timeout: 20_000 }).toBeGreaterThan(0.9);
  const l = await buildingLight(page, id);
  expect(l.instanceK, 'the instance carries its darkness').toBeGreaterThan(0.9);
  expect(l.window, 'window glow').toBeGreaterThan(1.4);
  expect(l.lamp, 'work lamps').toBeGreaterThan(2);
  expect(l.beacon, 'beacons read in daylight shadow').toBeGreaterThan(3.5);
  // the window level the cel program reads, and the draped pool at the same level
  await expect.poll(async () => (await g(page, 'buildingGlow', id)).glow, { timeout: 20_000 }).toBeGreaterThan(0.9);
  const info = await renderInfo(page);
  expect(info.base.nightLights).toBe('cel');
  expect(info.base.discs, 'a flood pool lit by day').toBeGreaterThan(0);
});

test('own light: an unpowered structure stays dark at any darkness', async ({ page }) => {
  test.setTimeout(120_000);
  const ids = await litBase(page, 'southpole', 1234, 740);
  await sampled(page, ids);
  const lights = await Promise.all(ids.map((id) => buildingLight(page, id)));
  const i = lights.findIndex((l, j) => l.shaded && l.lit && j > 0); // not the Lander
  expect(i).toBeGreaterThan(0);
  const id = ids[i];
  await expect.poll(async () => (await buildingLight(page, id)).k, { timeout: 20_000 }).toBeGreaterThan(0.9);
  // switched off (the same lit gate a brownout closes): windows, lamps and
  // beacons go dark though the structure still stands in the dark
  await page.evaluate((b) => { window.__game.setEnabled(b, false); window.__game.advanceGameSeconds(1); }, id);
  await expect.poll(async () => (await buildingLight(page, id)).lit, { timeout: 10_000 }).toBe(false);
  const off = await buildingLight(page, id);
  expect(off.k, 'still dark where it stands').toBeGreaterThan(0.9);
  expect(off.instanceK).toBeNull();
  expect([off.window, off.lamp, off.beacon]).toEqual([0, 0, 0]);
  expect((await g(page, 'buildingGlow', id)).powered).toBe(0);
  // back on: its lights return
  await page.evaluate((b) => { window.__game.setEnabled(b, true); window.__game.advanceGameSeconds(1); }, id);
  await expect.poll(async () => (await buildingLight(page, id)).window, { timeout: 10_000 }).toBeGreaterThan(1.4);
});

test('own light: a sunlit base at mare noon is dark-free and lays no pool; night fades its lights in', async ({ page }) => {
  test.setTimeout(120_000);
  const ids = await litBase(page, 'mare', 42, 240); // noon, the sun ~32° up
  await sampled(page, ids);
  await expect.poll(() => page.evaluate((list) =>
    Math.max(...list.map((i: number) => window.__game.getBuildingLight(i).k)), ids), { timeout: 20_000 })
    .toBeLessThan(0.03);
  for (const id of ids) {
    const l = await buildingLight(page, id);
    expect(l.shaded, `building ${id} in the sun`).toBe(false);
    expect(l.sky).toBe(0);
    expect(l.lit).toBe(true);
    expect(l.window, 'only the faint day floor').toBeLessThan(0.2);
    expect(l.lamp).toBeLessThan(0.05);
  }
  let info = await renderInfo(page);
  expect(info.base.discs, 'no pool while nothing stands dark').toBe(0);

  // nightfall at once: the lights fade in over a second or two of frames
  // (stepped here: 0.1 s each), they do not pop
  const fade = await page.evaluate((id) => {
    const g = window.__game;
    g.advanceGameSeconds(610 - g.getState().simTime);
    g.grantPower(200000);
    g.stepFrame(0.1);
    const first = g.getBuildingLight(id);
    for (let i = 0; i < 20; i++) g.stepFrame(0.1);
    return { first, later: g.getBuildingLight(id) };
  }, ids[0]);
  expect(fade.first.night).toBe(1);
  expect(fade.first.k, 'a tenth of a second in').toBeLessThan(0.4);
  expect(fade.first.k).toBeGreaterThan(0.05);
  expect(fade.first.window).toBeLessThan(0.7);
  expect(fade.later.k, 'two seconds in').toBeGreaterThan(0.95);
  expect(fade.later.window).toBeGreaterThan(1.5);
  info = await renderInfo(page);
  expect(info.base.discs, 'the pools are up').toBeGreaterThan(0);

  // an unpowered structure stays dark at night as in the rim's shadow
  await page.evaluate((b) => { window.__game.setEnabled(b, false); window.__game.advanceGameSeconds(1); }, ids[1]);
  await expect.poll(async () => (await buildingLight(page, ids[1])).lit, { timeout: 10_000 }).toBe(false);
  const off = await buildingLight(page, ids[1]);
  expect(off.k).toBeGreaterThan(0.95);
  expect([off.window, off.lamp, off.beacon]).toEqual([0, 0, 0]);
});

test('safe mode from boot: buildings placed later come up unlit', async ({ page }) => {
  await page.goto('/?debug&seed=42&nolock&site=mare&safe');
  await page.waitForFunction(() => window.__game !== undefined);
  expect(await page.evaluate(() => window.__game.placeBuilding('solar', 132, 126))).toBe(true);
  const info = await renderInfo(page);
  expect(info.safeMode).toBe(true);
  expect(info.buildingMaterials).toEqual({ lander: 'MeshBasicMaterial', solar: 'MeshBasicMaterial' });
  expect(info.terrainMaterial).toBe('MeshBasicMaterial');
  // the ring and the rocks are created with the world, after safe mode
  expect(info.horizonMaterial).toBe('MeshBasicMaterial');
  expect(info.rocks.material).toBe('MeshBasicMaterial');
  expect(info.rocks.smallDensity).toBe(0.25);
  expect(info.base.trackers.material, 'dishes and wings go unlit too').toBe('MeshBasicMaterial');
});

test('base life: rovers, dust, launch and resupply on the cel materials; none of it lit in safe mode', async ({ page }) => {
  test.setTimeout(300_000);
  const shaderErrors: string[] = [];
  page.on('console', (m) => { if (m.text().includes('THREE.WebGLProgram')) shaderErrors.push(m.text()); });
  page.on('pageerror', (e) => shaderErrors.push(String(e)));
  // a small canvas keeps software GL near a few frames a second
  await page.setViewportSize({ width: 800, height: 450 });
  await page.goto('/?debug&seed=42&nolock&site=mare');
  await page.waitForFunction(() => window.__game !== undefined);
  const life = async () => (await renderInfo(page)).life;
  await page.evaluate(() => {
    const g = window.__game;
    g.grantResources({ metals: 5000, parts: 2000, foils: 100, launch: 5 });
    for (const t of ['massDriver', 'foilManufacturing', 'swarmProtocol', 'regolithShielding']) g.completeTech(t);
    g.setSpeed(10);
    g.placeBuilding('habitat', 120, 132);
  });

  // the Lander's two bots drive out and print; their wheels and the print throw dust
  let info = await life();
  expect(info.rovers.count, 'one rover per bot').toBe((await g(page, 'getState')).bots.total);
  expect(info.rovers.material).toBe('ShaderMaterial');
  const start = info.rovers.positions;
  await expect.poll(async () => (await life()).rovers.assigned, { timeout: 30_000 }).toBeGreaterThan(0);
  // emitters and visibility read from one frame: a rover can stop between two reads
  await expect.poll(async () => {
    const d = (await life()).dust;
    return d.emitters > 0 ? d.visible : 'no emitters';
  }, { timeout: 60_000 }).toBe(true);
  info = await life();
  expect(info.dust.mode, 'grains parked in static puffs').toBe('static');
  expect(info.dust.grains).toBeGreaterThan(0);
  expect(info.rovers.positions, 'the rovers left their parking spots').not.toEqual(start);

  // a volley flies off the rail and the swarm shows in the sky; the habitat is bermed
  await page.evaluate(() => {
    const g = window.__game;
    g.setSpeed(1);
    // a mass driver needs ≤0.8 m of relief under its pad (the large-pad rule)
    if (!g.placeBuilding('massDriver', 134, 136)) throw new Error('mass driver pad refused');
    g.finishConstruction();
    g.grantPower(20000);
    g.launch();
  });
  await expect.poll(async () => (await life()).launch.inFlight, { timeout: 20_000 }).toBe(1);
  const c0 = (await life()).launch.capsule;
  await expect.poll(async () => (await life()).launch.capsule, { timeout: 20_000 }).not.toEqual(c0);
  info = await life();
  expect(info.swarmGlints, 'the first volley already glints').toBeGreaterThan(0);
  expect(info.berms, 'Regolith Shielding berms the finished habitat').toBeGreaterThan(0);

  // Earth resupply: on its braking burn 6 s out, then standing on the ground
  await page.evaluate(() => {
    const g = window.__game;
    g.setPaused(true);
    g.orderResupply();
  });
  await expect.poll(async () => (await g(page, 'getState')).resupply.pending).toBe(true);
  await page.evaluate(() => {
    const g = window.__game;
    g.advanceGameSeconds(g.getState().resupply.arriveAt - g.getState().simTime - 6);
  });
  await expect.poll(async () => (await life()).resupply.phase, { timeout: 20_000 }).toBe('descent');
  info = await life();
  expect(info.resupply.alt).toBeGreaterThan(0);
  expect(info.resupply.alt).toBeLessThan(220);
  await page.evaluate(() => window.__game.advanceGameSeconds(10));
  await expect.poll(async () => (await life()).resupply.phase, { timeout: 20_000 }).toBe('landed');

  // safe mode: unlit rovers and lander, no dust at all
  await page.evaluate(() => { window.__game.setPaused(false); window.__game.enableSafeMode(); });
  await page.waitForTimeout(1000);
  info = await life();
  expect(info.rovers.material).toBe('MeshBasicMaterial');
  expect(info.resupply.material).toBe('MeshBasicMaterial');
  expect(info.dust.mode).toBe('none');
  expect(info.dust.visible).toBe(false);
  expect(info.rovers.count).toBeGreaterThan(0);
  expect(info.failed, 'no visual part fell over').toEqual([]);
  expect(shaderErrors).toEqual([]);
});

test('the building shader keeps a clock: beacons blink', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 450 });
  await boot(page, 'mare');
  expect((await renderInfo(page)).lens.fov, 'the isometric lens').toBe(20);
  const t0 = (await renderInfo(page)).base.clock;
  await expect.poll(async () => (await renderInfo(page)).base.clock, { timeout: 10_000 }).not.toBe(t0);
});

/** Frames drawn over `ms`. */
async function framesIn(page: Page, ms = 2500) {
  const a = (await renderInfo(page)).framesDrawn;
  await page.waitForTimeout(ms);
  return (await renderInfo(page)).framesDrawn - a;
}

/** Run the black-frame check on the next drawn frame and wait for its verdict. */
async function probeNow(page: Page) {
  const before = (await renderInfo(page)).probes;
  const n = (p: typeof before) => p.ok + p.black + p.unknown;
  await page.evaluate(() => window.__game.probeNext());
  await expect.poll(async () => n((await renderInfo(page)).probes), SLOW).toBeGreaterThan(n(before));
  const after = (await renderInfo(page)).probes;
  return after.black > before.black ? 'black' : after.ok > before.ok ? 'ok' : 'unknown';
}

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('mbb-settings') ?? '{}'));

test('safe mode draws the plain path from boot and at runtime, and the black-frame check stays on', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 800, height: 450 });
  // from boot
  await page.goto('/?debug&seed=42&nolock&site=mare&safe');
  await page.waitForFunction(() => window.__game !== undefined);
  await expect.poll(async () => (await renderInfo(page)).framesDrawn).toBeGreaterThan(3);
  let info = await renderInfo(page);
  expect(info.safeMode).toBe(true);
  expect(info.safe).toBe(true);
  expect(info.firstFrame).toEqual({ safe: true });
  expect(await framesIn(page)).toBeGreaterThan(0);

  // at runtime: switching on unlights everything at once, at any hour
  await page.goto('/?debug&seed=42&nolock&site=mare');
  await page.waitForFunction(() => window.__game !== undefined);
  await expect.poll(async () => (await renderInfo(page)).framesDrawn).toBeGreaterThan(2);
  expect((await renderInfo(page)).safeMode).toBe(false);
  await page.evaluate(() => {
    const g = window.__game;
    g.setPaused(true);
    g.grantPower(200000);
    g.advanceGameSeconds(610 - g.getState().simTime); // mid-night: safe mode is read at any hour
    g.grantPower(200000);
    g.enableSafeMode();
  });
  info = await renderInfo(page);
  expect(info.safeMode).toBe(true);
  expect(info.terrainMaterial).toBe('MeshBasicMaterial');
  expect(await saved(page), 'the render check\'s safe mode is kept for the next launch').toMatchObject({ safe: true });

  // the check still reads safe-mode frames: a silent terrain failure there can do no more
  await page.evaluate(() => window.__game.setTerrainVisible(false));
  expect(await probeNow(page)).toBe('black');
  expect((await status(page)).safe).toBe(true);
  await page.evaluate(() => window.__game.setTerrainVisible(true));

  // leaving safe mode is a checked step: black goes straight back to safe mode…
  await page.evaluate(() => {
    window.__game.setTerrainVisible(false);
    window.__game.disableSafeMode();
  });
  let st = await status(page);
  expect(st.safe).toBe(false);
  expect(st.checking).toBe(true);
  expect(await probeNow(page)).toBe('black');
  st = await status(page);
  expect(st.safe).toBe(true);
  expect(st.safeAuto).toBe(true);
  expect(await saved(page)).toMatchObject({ safe: true });

  // …and a frame that draws keeps it off (at night, on the earthshine floor)
  await page.evaluate(() => { window.__game.setTerrainVisible(true); window.__game.disableSafeMode(); });
  await expect.poll(async () => (await status(page)).checking, SLOW).toBe(false);
  st = await status(page);
  expect(st.safe).toBe(false);
  expect(await saved(page)).toMatchObject({ safe: false });
  expect(errors).toEqual([]);
});

test('safe mode holds across a reload; turning it off in the menu clears it', async ({ page }) => {
  await page.goto('/?debug&seed=42&nolock&site=mare');
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => window.__game.enableSafeMode()); // as the render check does
  await page.reload();
  await page.waitForFunction(() => window.__game !== undefined);
  let info = await renderInfo(page);
  expect(info.firstFrame).toEqual({ safe: true });
  expect((await status(page)).safe).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu-safe')).toHaveText('On');
  await page.locator('#menu-safe').click();
  await expect(page.locator('#menu-safe')).toHaveText('Off');
  await expect.poll(async () => (await status(page)).checking, SLOW).toBe(false);
  await page.reload();
  await page.waitForFunction(() => window.__game !== undefined);
  info = await renderInfo(page);
  expect(info.firstFrame.safe).toBe(false);
});

test('the black-frame check reads night frames, and a black one switches safe mode on and says so', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 800, height: 450 });
  await boot(page, 'mare');
  await page.evaluate(() => {
    const g = window.__game;
    g.setPaused(true);
    g.grantPower(200000);
    g.advanceGameSeconds(460 - g.getState().simTime); // dusk: the sun has set, the floor is not up yet
  });
  await page.waitForTimeout(1000);
  // dusk is inconclusive, never a false alarm
  expect(await probeNow(page)).toBe('unknown');
  expect((await status(page)).safe, 'a set sun at dusk is no black frame').toBe(false);

  await page.evaluate(() => {
    const g = window.__game;
    g.advanceGameSeconds(610 - g.getState().simTime); // mid-night
    g.grantPower(200000);
  });
  await page.waitForTimeout(1000);
  // a working night frame reads as one: open ground sits on the earthshine floor
  expect(await probeNow(page)).toBe('ok');
  // a silent terrain failure at night is caught (the check does not sleep until day)
  await page.evaluate(() => window.__game.setTerrainVisible(false));
  expect(await probeNow(page)).toBe('black');
  const st = await status(page);
  expect(st.safe).toBe(true);
  expect(st.safeAuto).toBe(true);
  expect((await g(page, 'getState')).alerts.some((a: any) => /SAFE RENDER MODE/.test(a.text))).toBe(true);
  expect((await renderInfo(page)).terrainMaterial).toBe('MeshBasicMaterial');
});

test('the scene draws each frame; the tech tree and map rest the GPU', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 800, height: 450 });
  await boot(page, 'mare');
  // the placement ghost is transparent: it must not add a second scene render
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.beginPlacement('habitat'); });
  await page.mouse.move(400, 300);
  await page.waitForTimeout(1500);
  const a = await renderInfo(page);
  await page.waitForTimeout(3000);
  const b = await renderInfo(page);
  expect(b.framesDrawn - a.framesDrawn, 'frames drawn').toBeGreaterThan(0);
  expect(b.frame.calls, 'draw calls a frame with a ghost up').toBeLessThan(80);
  await page.evaluate(() => window.__game.cancelPlacement());
  // an opaque full-screen screen: the sim runs on, the scene is not drawn
  await page.keyboard.press('KeyT');
  await expect(page.locator('#tech-screen')).toBeVisible();
  await page.waitForTimeout(500);
  expect(await framesIn(page, 1500), 'nothing drawn under the tech tree').toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#tech-screen')).toBeHidden();
  await expect.poll(async () => framesIn(page, 1000)).toBeGreaterThan(0);
  await page.evaluate(() => window.__game.setMapOpen(true));
  await page.waitForTimeout(500);
  expect(await framesIn(page, 1500), 'nothing drawn under the Lunar Map').toBe(0);
  await page.evaluate(() => window.__game.setMapOpen(false));
  await expect.poll(async () => framesIn(page, 1000)).toBeGreaterThan(0);
});

test('without WebGL2 the page says what the game needs instead of staying blank', async ({}, info) => {
  const preinstalled = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const browser = await chromium.launch({
    ...(existsSync(preinstalled) ? { executablePath: preinstalled } : {}),
    args: ['--disable-webgl2'],
  });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${info.project.use.baseURL}/?debug&seed=42&site=mare`);
    const fatal = page.locator('#fatal');
    await expect(fatal).toBeVisible({ timeout: 30_000 });
    await expect(fatal).toContainText('NEEDS WEBGL2');
    await expect(fatal).toContainText('hardware acceleration');
    await expect(fatal).toContainText('Chrome or Edge');
    expect(await page.evaluate(() => window.__game === undefined)).toBe(true);
    expect(errors, 'no uncaught error').toEqual([]);
  } finally {
    await browser.close();
  }
});
