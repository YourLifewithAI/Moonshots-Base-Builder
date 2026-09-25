/** Render-ladder test: every FX level, then safe mode, must draw a lit frame
 *  with no shader compile errors — including the first building of a type
 *  placed after each switch, which compiles a fresh program (or, in safe mode,
 *  must come up unlit like everything else). The rocks thin down the ladder,
 *  and the horizon ring and rocks go unlit with the rest in safe mode. The
 *  same ladder runs again at night, where the base lights itself (shader
 *  floods and window glow at FX 0–2, discs and point lights below that).
 *  The base's own light follows each structure's darkness, not the clock: a
 *  pole structure in the rim's shadow lights by day, a sunlit mare base at
 *  noon lays no flood, nightfall fades the lights in, and an unpowered
 *  structure stays dark at any darkness.
 *  The motion layer (rovers, dust, launch and resupply, research visuals)
 *  is checked at FX 0, FX 3 and in safe mode, and walk mode for its lens,
 *  headlamp, bootprints and visor. The render-safety contract: safe mode
 *  draws plain with the black-frame check still on, a return to a patched
 *  level recompiles with live uniforms, the check reads night frames and
 *  keeps a raise only once it draws, each frame draws the scene once, and a
 *  browser without WebGL2 gets a page that says so. */
import { chromium, test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

declare global {
  interface Window { __game?: any }
}

/** Luminance stats of the lower two thirds of a screenshot (ground + base):
 *  mean, share of pixels above `lit`, and share at pure black (< 2). */
async function frameStats(page: Page, lit = 24) {
  const png = await page.screenshot();
  return page.evaluate(async ([b64, litAt]) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const y0 = Math.floor(bmp.height / 3);
    const { data } = ctx.getImageData(0, y0, bmp.width, bmp.height - y0);
    let lit = 0, black = 0, sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      sum += l;
      if (l > (litAt as number)) lit++;
      if (l < 2) black++;
    }
    const n = data.length / 4;
    return { mean: sum / n, litFrac: lit / n, blackFrac: black / n };
  }, [png.toString('base64'), lit] as const);
}

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

test('render ladder: FX 0-3 and safe mode draw lit frames without shader errors', async ({ page }) => {
  // SwiftShader recompiles the post chain and every patched program per rung
  test.setTimeout(300_000);
  const shaderErrors: string[] = [];
  page.on('console', (m) => { if (m.text().includes('THREE.WebGLProgram')) shaderErrors.push(m.text()); });
  page.on('pageerror', (e) => shaderErrors.push(String(e)));
  await page.goto('/?debug&seed=42&nolock&site=mare');
  await page.waitForFunction(() => window.__game !== undefined);
  // the world only: HUD panels would count as lit pixels
  await page.addStyleTag({ content: '#ui-root { visibility: hidden !important; }' });
  await page.evaluate(() => {
    window.__game.setPaused(true); // hold the mid-morning sun
    window.__game.grantResources({ metals: 800, parts: 300 });
  });

  const stages: { fx: number | 'safe'; type: string; gx: number; gz: number }[] = [
    { fx: 0, type: 'solar', gx: 132, gz: 126 },
    { fx: 1, type: 'excavator', gx: 120, gz: 126 },
    { fx: 2, type: 'lab', gx: 135, gz: 133 },
    { fx: 3, type: 'storageYard', gx: 121, gz: 132 },
    { fx: 'safe', type: 'habitat', gx: 126, gz: 132 },
  ];
  for (const s of stages) {
    if (s.fx === 'safe') await page.evaluate(() => window.__game.enableSafeMode());
    else await page.evaluate((n) => window.__game.setFxLevel(n), s.fx);
    expect(await page.evaluate((b) => window.__game.placeBuilding(b.type, b.gx, b.gz), s)).toBe(true);
    await page.evaluate(() => window.__game.setView({ x: 60, y: 45, z: 70 }, { x: 5, y: 0, z: 2 }));
    // a placement ghost over open ground: its program compiles at this level too
    await page.evaluate(() => window.__game.beginPlacement('habitat'));
    await page.mouse.move(700, 640);
    await page.waitForTimeout(2500);

    const stats = await frameStats(page);
    expect(stats.litFrac, `FX ${s.fx}: lit share of the lower frame`).toBeGreaterThan(0.6);
    expect(stats.mean, `FX ${s.fx}: mean luminance`).toBeGreaterThan(40);
    const info = await page.evaluate(() => window.__game.getRenderInfo());
    expect(info.patchFault).toBe(false);
    if (s.fx !== 'safe') {
      expect(info.fxLevel, 'the black-frame sentinel never stepped down').toBe(s.fx);
      expect(info.patches.terrain).toBe(s.fx <= 1 ? 'regolith-2' : s.fx === 2 ? 'regolith-1' : null);
      expect(info.rocks.smallDensity, `FX ${s.fx}: small-rock density`).toBe([1, 1, 0.5, 0.25][s.fx]);
      expect(info.horizonMaterial).toBe('MeshStandardMaterial');
      expect(info.patches.building).toBe(s.fx <= 1 ? 'bldg-2' : s.fx === 2 ? 'bldg-1' : null);
      expect(info.patches.ghost).toBe(s.fx <= 2 ? 'ghost-lit' : null);
      // FX 0–2 print the new site bottom-up; FX 3 falls back to the squash-rise
      expect(info.base.reveal).toBe(s.fx <= 2);
      expect(info.base.nightLights).toBe(s.fx <= 2 ? 'shader' : 'stock');
    } else {
      expect(info.base.reveal).toBe(false);
      expect(info.base.nightLights).toBe('stock');
    }
    expect(info.base.scaffold, `FX ${s.fx}: the new site is scaffolded`).toBeGreaterThan(0);
    await page.evaluate(() => window.__game.cancelPlacement());
    // the ring shares the map's edge samples exactly; boulders stay at every level
    expect(info.horizonSeam).toBe(0);
    expect(info.rocks.largeDrawn).toBe(info.rocks.large);
    expect(info.sky.starLevel, 'no stars in a sunlit frame').toBeLessThan(0.01);
  }
  expect(shaderErrors).toEqual([]);

  // safe mode reaches every building mesh, including the type created after it
  const info = await page.evaluate(() => window.__game.getRenderInfo());
  expect(info.safeMode).toBe(true);
  expect(info.terrainMaterial).toBe('MeshBasicMaterial');
  expect(Object.keys(info.buildingMaterials).sort()).toEqual(
    ['excavator', 'habitat', 'lab', 'lander', 'solar', 'storageYard']);
  for (const [type, mat] of Object.entries(info.buildingMaterials)) {
    expect(mat, `${type} mesh in safe mode`).toBe('MeshBasicMaterial');
  }
  expect(info.horizonMaterial).toBe('MeshBasicMaterial');
  expect(info.rocks.material).toBe('MeshBasicMaterial');
  expect(info.rocks.smallDensity).toBe(0.25);
  expect(info.base.trackers.material, 'dishes and wings go unlit too').toBe('MeshBasicMaterial');
});

test('night ladder: FX 0-3 and safe mode light the base at night without shader errors', async ({ page }) => {
  test.setTimeout(300_000);
  const shaderErrors: string[] = [];
  page.on('console', (m) => { if (m.text().includes('THREE.WebGLProgram')) shaderErrors.push(m.text()); });
  page.on('pageerror', (e) => shaderErrors.push(String(e)));
  await page.goto('/?debug&seed=42&nolock&site=mare');
  await page.waitForFunction(() => window.__game !== undefined);
  await page.addStyleTag({ content: '#ui-root { visibility: hidden !important; }' });
  await page.evaluate(() => {
    const g = window.__game;
    g.setPaused(true);
    g.grantResources({ metals: 2000, parts: 800 });
    for (const [t, x, z] of [['habitat', 126, 132], ['lab', 135, 133], ['solar', 132, 126]] as const) {
      g.placeBuilding(t, x, z);
    }
    g.finishConstruction();
    g.advanceGameSeconds(120); // mid-morning
  });
  await page.waitForTimeout(500);
  let info = await page.evaluate(() => window.__game.getRenderInfo());
  expect(info.base.trackers.wings).toBe(1);
  expect(dot(info.base.trackers.wingNormal, info.base.sunDir), 'the wing faces the sun').toBeGreaterThan(0.97);
  expect(info.base.trackers.dishes, 'lander + lab dishes').toBe(2);

  // mid-night, with the banks full so nothing browns out
  await page.evaluate(() => {
    const g = window.__game;
    g.grantPower(200000);
    g.advanceGameSeconds(610 - g.getState().simTime);
    g.grantPower(200000);
    g.setView({ x: 50, y: 34, z: 62 }, { x: 4, y: 0, z: 8 });
  });
  const stages: (number | 'safe')[] = [0, 1, 2, 3, 'safe'];
  const types = ['habitat', 'lab', 'excavator', 'hydroponics', 'storageYard'];
  for (const [k, fx] of stages.entries()) {
    if (fx === 'safe') await page.evaluate(() => window.__game.enableSafeMode());
    else await page.evaluate((n) => window.__game.setFxLevel(n), fx);
    const spot = await freeSpot(page, types[k]);
    expect(spot, `a free spot for ${types[k]}`).not.toBeNull();
    await page.evaluate(([t, [gx, gz]]) => {
      window.__game.placeBuilding(t, gx, gz);
      window.__game.finishConstruction();
    }, [types[k], spot!] as const);
    await page.waitForTimeout(2500);

    const stats = await frameStats(page, 40);
    info = await page.evaluate(() => window.__game.getRenderInfo());
    const st = await page.evaluate(() => window.__game.getState());
    expect(st.simTime % 720, 'still night').toBeGreaterThan(480);
    expect(info.patchFault).toBe(false);
    // the pools and the lit structures carry the frame…
    expect(stats.litFrac, `FX ${fx}: lit share of the night frame`).toBeGreaterThan(0.08);
    expect(stats.mean, `FX ${fx}: night mean luminance`).toBeGreaterThan(12);
    const powered = st.buildings.filter((b: any) =>
      b.construction <= 0 && b.enabled && b.idleReason !== 'power').length;
    if (fx !== 'safe' && fx <= 2) {
      expect(info.fxLevel).toBe(fx);
      expect(info.base.nightLights).toBe('shader');
      // …every powered structure has its flood, and the landscape never goes pitch black
      expect(info.base.floods.sources).toBe(powered);
      expect(info.base.floods.live).toBeGreaterThan(0);
      expect(info.base.discs).toBe(0);
      expect(stats.blackFrac, `FX ${fx}: pure-black share (earthshine floor)`).toBeLessThan(0.05);
    } else {
      expect(info.base.nightLights).toBe('stock');
      expect(info.base.discs).toBe(powered);
    }
  }
  expect(shaderErrors).toEqual([]);
});

test('solar wings stand near-vertical under the grazing polar night sun', async ({ page }) => {
  await page.goto('/?debug&seed=42&nolock&site=southpole');
  await page.waitForFunction(() => window.__game !== undefined);
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
  const info = await page.evaluate(() => window.__game.getRenderInfo());
  expect(info.base.trackers.wings).toBe(1);
  expect(dot(info.base.trackers.wingNormal, info.base.sunDir)).toBeGreaterThan(0.97);
  expect(Math.abs(info.base.trackers.wingNormal[1]), 'panel face near-vertical').toBeLessThan(0.12);
});

/** A small base (Lander, habitat, lab, solar array) built, powered and held
 *  paused at game-second `t` of a fresh `site` world; returns its ids. */
async function litBase(page: Page, site: string, seed: number, t: number): Promise<number[]> {
  await page.setViewportSize({ width: 800, height: 450 });
  await page.goto(`/?debug&seed=${seed}&nolock&site=${site}&lowfx`);
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

test('own light: at the pole by day, a structure in the rim\'s shadow lights its windows and its flood', async ({ page }) => {
  test.setTimeout(120_000);
  // day 2, 20 s after sunrise: the sun ~5° up, the base under the rim's shadow
  const ids = await litBase(page, 'southpole', 1234, 740);
  const st = await page.evaluate(() => window.__game.getState());
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
  // its flood is live by day, at the structure's darkness
  expect(l.flood.live).toBe(true);
  expect(l.flood.k).toBeGreaterThan(0.9);
  const info = await page.evaluate(() => window.__game.getRenderInfo());
  expect(info.base.nightLights).toBe('shader');
  expect(info.base.floods.live, 'flood slots live by day').toBeGreaterThan(0);
  expect(info.base.floods.sources).toBe(ids.length);

  // the stock path answers the same darkness: discs under the lit structures
  await page.evaluate(() => window.__game.setFxLevel(3));
  await expect.poll(async () => (await page.evaluate(() => window.__game.getRenderInfo())).base.discs,
    SLOW).toBe(ids.length);
  expect((await buildingLight(page, id)).path).toBe('stock');
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
  // switched off (the same lit gate a brownout closes): windows, lamps,
  // beacons and flood go dark though the structure still stands in the dark
  await page.evaluate((b) => { window.__game.setEnabled(b, false); window.__game.advanceGameSeconds(1); }, id);
  await expect.poll(async () => (await buildingLight(page, id)).lit, { timeout: 10_000 }).toBe(false);
  const off = await buildingLight(page, id);
  expect(off.k, 'still dark where it stands').toBeGreaterThan(0.9);
  expect(off.instanceK).toBeNull();
  expect([off.window, off.lamp, off.beacon]).toEqual([0, 0, 0]);
  expect(off.flood, 'no flood source').toBeNull();
  expect((await page.evaluate(() => window.__game.getRenderInfo())).base.floods.sources).toBe(ids.length - 1);
  // back on: its lights return
  await page.evaluate((b) => { window.__game.setEnabled(b, true); window.__game.advanceGameSeconds(1); }, id);
  await expect.poll(async () => (await buildingLight(page, id)).window, { timeout: 10_000 }).toBeGreaterThan(1.4);
  expect((await buildingLight(page, id)).flood.live).toBe(true);
});

test('own light: a sunlit base at mare noon is dark-free and lays no flood; night fades its lights in', async ({ page }) => {
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
    expect(l.flood.live).toBe(false);
  }
  let info = await page.evaluate(() => window.__game.getRenderInfo());
  expect(info.base.floods.sources).toBe(ids.length);
  expect(info.base.floods.live, 'no flood live while nothing stands dark').toBe(0);

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
  info = await page.evaluate(() => window.__game.getRenderInfo());
  expect(info.base.floods.live).toBeGreaterThan(0);

  // an unpowered structure stays dark at night as in the rim's shadow
  await page.evaluate((b) => { window.__game.setEnabled(b, false); window.__game.advanceGameSeconds(1); }, ids[1]);
  await expect.poll(async () => (await buildingLight(page, ids[1])).lit, { timeout: 10_000 }).toBe(false);
  const off = await buildingLight(page, ids[1]);
  expect(off.k).toBeGreaterThan(0.95);
  expect([off.window, off.lamp, off.beacon]).toEqual([0, 0, 0]);
  expect(off.flood).toBeNull();
});

test('safe mode from boot: buildings placed later come up unlit', async ({ page }) => {
  await page.goto('/?debug&seed=42&nolock&site=mare&safe');
  await page.waitForFunction(() => window.__game !== undefined);
  expect(await page.evaluate(() => window.__game.placeBuilding('solar', 132, 126))).toBe(true);
  const info = await page.evaluate(() => window.__game.getRenderInfo());
  expect(info.safeMode).toBe(true);
  expect(info.buildingMaterials).toEqual({ lander: 'MeshBasicMaterial', solar: 'MeshBasicMaterial' });
  expect(info.terrainMaterial).toBe('MeshBasicMaterial');
  // the ring and the rocks are created with the world, after safe mode
  expect(info.horizonMaterial).toBe('MeshBasicMaterial');
  expect(info.rocks.material).toBe('MeshBasicMaterial');
  expect(info.rocks.smallDensity).toBe(0.25);
});

test('shadow map re-renders only on change', async ({ page }) => {
  await page.goto('/?debug&seed=42&nolock&site=mare&lowfx');
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => window.__game.setPaused(true));
  await page.waitForTimeout(1500);
  const idle0 = (await page.evaluate(() => window.__game.getRenderInfo())).shadowRenders;
  await page.waitForTimeout(2000);
  // a paused sun and a still camera: no shadow renders at all
  expect((await page.evaluate(() => window.__game.getRenderInfo())).shadowRenders).toBe(idle0);
  // a new caster triggers exactly the re-render it needs
  expect(await page.evaluate(() => window.__game.placeBuilding('solar', 132, 126))).toBe(true);
  await page.waitForTimeout(1000);
  const placed = (await page.evaluate(() => window.__game.getRenderInfo())).shadowRenders;
  expect(placed).toBeGreaterThan(idle0);
  // the fitted window is far finer than the old fixed ±460 m (0.45 m texels)
  const texel = (await page.evaluate(() => window.__game.getRenderInfo())).shadowTexel;
  expect(Math.max(...texel)).toBeLessThan(0.3);
});

test('base life: rovers, dust, launch and resupply at FX 0; static dust at FX 3; none in safe mode', async ({ page }) => {
  test.setTimeout(300_000);
  const shaderErrors: string[] = [];
  page.on('console', (m) => { if (m.text().includes('THREE.WebGLProgram')) shaderErrors.push(m.text()); });
  page.on('pageerror', (e) => shaderErrors.push(String(e)));
  // a small canvas keeps software GL near a few frames a second
  await page.setViewportSize({ width: 800, height: 450 });
  await page.goto('/?debug&seed=42&nolock&site=mare&fx=0');
  await page.waitForFunction(() => window.__game !== undefined);
  const life = async () => (await page.evaluate(() => window.__game.getRenderInfo())).life;
  await page.evaluate(() => {
    const g = window.__game;
    g.grantResources({ metals: 5000, parts: 2000, foils: 100, launch: 5 });
    for (const t of ['massDriver', 'foilManufacturing', 'swarmProtocol', 'regolithShielding']) g.completeTech(t);
    g.setSpeed(10);
    g.placeBuilding('habitat', 120, 132);
  });

  // the Lander's two bots drive out and print; their wheels and the print throw dust
  let info = await life();
  expect(info.rovers.count, 'one rover per bot').toBe((await page.evaluate(() => window.__game.getState())).bots.total);
  expect(info.rovers.material).toBe('MeshStandardMaterial');
  const start = info.rovers.positions;
  await expect.poll(async () => (await life()).rovers.assigned, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await life()).dust.emitters, { timeout: 60_000 }).toBeGreaterThan(0);
  info = await life();
  expect(info.dust.mode).toBe('gpu');
  expect(info.dust.visible).toBe(true);
  expect((await page.evaluate(() => window.__game.getRenderInfo())).patches.dust).toBe('dust-gpu');
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
  await expect.poll(() => page.evaluate(() => window.__game.getState().resupply.pending)).toBe(true);
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
  expect((await life()).resupply.shadow, 'a lander standing still casts a shadow').toBe(true);

  // FX 3: the stock points material, grains parked in static puffs
  await page.evaluate(() => {
    const g = window.__game;
    g.setPaused(false);
    g.setFxLevel(3);
    g.setSpeed(10);
    g.placeBuilding('lab', 135, 133);
  });
  await expect.poll(async () => {
    const d = (await life()).dust;
    return d.mode === 'static' && d.grains > 0;
  }, { timeout: 60_000 }).toBe(true);
  expect((await page.evaluate(() => window.__game.getRenderInfo())).patches.dust).toBeNull();

  // safe mode: unlit rovers and lander, no dust at all
  await page.evaluate(() => window.__game.enableSafeMode());
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

test('walk mode: wider lens, a headlamp at night, bootprints, a visor', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 800, height: 450 });
  await page.goto('/?debug&seed=42&nolock&site=mare');
  await page.waitForFunction(() => window.__game !== undefined);
  const info = () => page.evaluate(() => window.__game.getRenderInfo());
  await page.evaluate(() => {
    const g = window.__game;
    g.setPaused(true);
    g.grantPower(200000);
    g.advanceGameSeconds(610 - g.getState().simTime); // mid-night
    g.grantPower(200000);
  });
  let i = await info();
  expect(i.lens).toEqual({ fov: 55, near: 0.5 });
  expect(i.headlamp, 'no headlamp in command view').toBe(0);

  await page.evaluate(() => window.__game.setMode('walk'));
  await expect(page.locator('#visor')).toBeVisible();
  i = await info();
  expect(i.lens).toEqual({ fov: 70, near: 0.15 });
  await expect.poll(async () => (await info()).headlamp, { timeout: 20_000 }).toBeGreaterThan(0);

  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await info()).life.footprints, { timeout: 60_000 }).toBeGreaterThan(1);
  await page.keyboard.up('KeyW');

  await page.evaluate(() => window.__game.setMode('build'));
  await expect(page.locator('#visor')).toBeHidden();
  await expect.poll(async () => (await info()).headlamp, { timeout: 20_000 }).toBe(0);
  i = await info();
  expect(i.lens).toEqual({ fov: 55, near: 0.5 });
  expect(i.life.footprints, 'prints stay where they were pressed').toBeGreaterThan(1);
  // beacons blink on the building shader's clock
  const t0 = i.base.clock;
  await expect.poll(async () => (await info()).base.clock, { timeout: 10_000 }).not.toBe(t0);
});

/** Scene renders per drawn frame over `ms` (the render pass counts one). */
async function rendersPerFrame(page: Page, ms = 2500) {
  const a = await page.evaluate(() => window.__game.getRenderInfo());
  await page.waitForTimeout(ms);
  const b = await page.evaluate(() => window.__game.getRenderInfo());
  const frames = b.framesDrawn - a.framesDrawn;
  return { frames, perFrame: (b.sceneRenders - a.sceneRenders) / Math.max(1, frames) };
}

const status = (page: Page) => page.evaluate(() => window.__game.getRenderStatus());
const renderInfo = (page: Page) => page.evaluate(() => window.__game.getRenderInfo());
/** software GL recompiles a whole chain on the first frame after a switch */
const SLOW = { timeout: 60_000 };

/** Run the black-frame check on the next drawn frame and wait for its verdict. */
async function probeNow(page: Page) {
  const before = (await renderInfo(page)).probes;
  const n = (p: typeof before) => p.ok + p.black + p.unknown;
  await page.evaluate(() => window.__game.probeNext());
  await expect.poll(async () => n((await renderInfo(page)).probes), SLOW).toBeGreaterThan(n(before));
  const after = (await renderInfo(page)).probes;
  return after.black > before.black ? 'black' : after.ok > before.ok ? 'ok' : 'unknown';
}

test('safe mode draws the plain path from boot and at runtime, and the black-frame check stays on', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 800, height: 450 });
  // from boot: no composer is ever built, one scene render a frame
  await page.goto('/?debug&seed=42&nolock&site=mare&safe');
  await page.waitForFunction(() => window.__game !== undefined);
  await expect.poll(async () => (await renderInfo(page)).framesDrawn).toBeGreaterThan(3);
  let info = await renderInfo(page);
  expect(info.safeMode).toBe(true);
  expect(info.firstFrame).toEqual({ fx: 3, safe: true });
  expect(info.fxLevel, 'safe mode draws plain').toBe(3);
  expect(info.postChain, 'no composer in safe mode').toBe(false);
  let r = await rendersPerFrame(page);
  expect(r.frames).toBeGreaterThan(0);
  expect(r.perFrame).toBe(1);

  // at runtime: switching on drops the FX 0 chain at once
  await page.goto('/?debug&seed=42&nolock&site=mare');
  await page.waitForFunction(() => window.__game !== undefined);
  await expect.poll(async () => (await renderInfo(page)).framesDrawn).toBeGreaterThan(2);
  expect((await renderInfo(page)).postChain).toBe(true);
  await page.evaluate(() => {
    const g = window.__game;
    g.setPaused(true);
    g.grantPower(200000);
    g.advanceGameSeconds(610 - g.getState().simTime); // mid-night: safe mode is read at any hour
    g.grantPower(200000);
    g.enableSafeMode();
  });
  info = await renderInfo(page);
  expect(info.fxLevel).toBe(3);
  expect(info.postChain).toBe(false);
  r = await rendersPerFrame(page);
  expect(r.perFrame).toBe(1);
  // an FX pick in safe mode is the level leaving it returns to: still no composer
  await page.evaluate(() => window.__game.setFxLevel(1));
  expect((await status(page)).ladder).toBe(1);
  expect((await renderInfo(page)).postChain).toBe(false);

  // the check still reads safe-mode frames: a silent terrain failure there
  // can at most keep the effects off for good
  await page.evaluate(() => window.__game.setTerrainVisible(false));
  expect(await probeNow(page)).toBe('black');
  expect((await status(page)).ladder).toBe(3);
  expect((await renderInfo(page)).fxStored).toBe(3);
  expect((await status(page)).safe).toBe(true);
  await page.evaluate(() => window.__game.setTerrainVisible(true));

  // leaving safe mode is a checked raise: black goes straight back to safe mode…
  await page.evaluate(() => {
    window.__game.setFxLevel(0);
    window.__game.setTerrainVisible(false);
    window.__game.disableSafeMode();
  });
  let st = await status(page);
  expect(st.safe).toBe(false);
  expect(st.checking).toBe(true);
  expect((await renderInfo(page)).postChain, 'the chain is built for the ladder level').toBe(true);
  expect(await probeNow(page)).toBe('black');
  st = await status(page);
  expect(st.safe).toBe(true);
  expect(st.safeAuto).toBe(true);
  expect(st.failed).toContain(0);
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('mbb-settings') ?? '{}'));
  expect((await saved()).safeAuto, 'the render check\'s safe mode holds across launches').toBe(true);

  // …and a frame that draws keeps it off (at night, on the earthshine floor)
  await page.evaluate(() => { window.__game.setTerrainVisible(true); window.__game.disableSafeMode(); });
  await expect.poll(async () => (await status(page)).checking, SLOW).toBe(false);
  st = await status(page);
  expect(st.safe).toBe(false);
  expect(st.level).toBe(0);
  expect((await renderInfo(page)).fxStored).toBe(0);
  expect(await saved()).toMatchObject({ safe: false, safeAuto: false });
  expect(errors).toEqual([]);
});

test('auto safe mode holds across a reload; the player turning it on or off clears the flag', async ({ page }) => {
  await page.goto('/?debug&seed=42&nolock&site=mare&lowfx');
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => window.__game.enableSafeMode()); // as the render check does
  await page.reload();
  await page.waitForFunction(() => window.__game !== undefined);
  let info = await renderInfo(page);
  expect(info.firstFrame).toEqual({ fx: 3, safe: true });
  expect(info.postChain).toBe(false);
  expect((await status(page)).safeAuto, 'still the render check\'s').toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu-safe-note')).toContainText('Switched on by the render check');
  await page.locator('#menu-safe').click();
  await expect(page.locator('#menu-safe')).toHaveText('Off');
  await expect.poll(async () => (await status(page)).checking, SLOW).toBe(false);
  await page.reload();
  await page.waitForFunction(() => window.__game !== undefined);
  info = await renderInfo(page);
  expect(info.firstFrame.safe).toBe(false);
  expect(info.postChain).toBe(true);
});

test('a patched level recompiles with live uniforms after the stock one: FX 0 → 3 → 0 lights the night', async ({ page }) => {
  test.setTimeout(240_000);
  const shaderErrors: string[] = [];
  page.on('console', (m) => { if (m.text().includes('THREE.WebGLProgram')) shaderErrors.push(m.text()); });
  page.on('pageerror', (e) => shaderErrors.push(String(e)));
  await page.goto('/?debug&seed=42&nolock&site=mare');
  await page.waitForFunction(() => window.__game !== undefined);
  await page.addStyleTag({ content: '#ui-root { visibility: hidden !important; }' });
  await page.evaluate(() => {
    const g = window.__game;
    g.setPaused(true);
    g.grantResources({ metals: 2000, parts: 800 });
    for (const [t, x, z] of [['habitat', 126, 132], ['lab', 135, 133], ['solar', 132, 126]] as const) {
      g.placeBuilding(t, x, z);
    }
    g.finishConstruction();
    g.advanceGameSeconds(120);
  });
  // every patched program compiles at FX 0, then the stock ones at FX 3
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.__game.setFxLevel(3));
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const g = window.__game;
    g.setFxLevel(0);
    g.grantPower(200000);
    g.advanceGameSeconds(610 - g.getState().simTime);
    g.grantPower(200000);
    g.setView({ x: 50, y: 34, z: 62 }, { x: 4, y: 0, z: 8 });
  });
  await page.waitForTimeout(2500);
  const stats = await frameStats(page, 40);
  const info = await renderInfo(page);
  expect(info.fxLevel).toBe(0);
  expect(info.patches.terrain).toBe('regolith-2');
  expect(info.base.nightLights).toBe('shader');
  expect(info.base.floods.live).toBeGreaterThan(0);
  expect(stats.blackFrac, 'pure-black share: the earthshine floor is live again').toBeLessThan(0.05);
  expect(stats.litFrac, 'the floods are live again').toBeGreaterThan(0.08);
  expect(shaderErrors).toEqual([]);
});

test('the black-frame check reads night frames; a raise is stored only once it draws', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 800, height: 450 });
  await page.goto('/?debug&seed=42&nolock&site=mare');
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => {
    const g = window.__game;
    g.setPaused(true);
    g.grantPower(200000);
    g.advanceGameSeconds(460 - g.getState().simTime); // dusk: the sun has set, the floor is not up yet
  });
  await page.waitForTimeout(1000);
  // dusk is inconclusive, never a false alarm
  expect(await probeNow(page)).toBe('unknown');
  expect((await renderInfo(page)).fxLevel, 'a set sun at dusk is no black frame').toBe(0);

  await page.evaluate(() => {
    const g = window.__game;
    g.advanceGameSeconds(610 - g.getState().simTime); // mid-night
    g.grantPower(200000);
  });
  await page.waitForTimeout(1000);
  // a working night frame reads as one: open ground sits on the earthshine floor
  expect(await probeNow(page)).toBe('ok');
  // a silent terrain failure at night is caught (the check used to sleep until day)
  await page.evaluate(() => window.__game.setTerrainVisible(false));
  expect(await probeNow(page)).toBe('black');
  expect((await renderInfo(page)).fxLevel).toBe(1);
  expect((await status(page)).failed).toEqual([0]);
  expect((await renderInfo(page)).fxStored).toBe(1);

  // a raise runs at once but is not stored until it draws…
  await page.evaluate(() => window.__game.setFxLevel(0));
  let info = await renderInfo(page);
  expect(info.fxLevel).toBe(0);
  expect(info.fxStored, 'the raise waits for its check').toBe(1);
  expect((await status(page)).checking).toBe(true);
  // …and one that comes out black goes straight back, and says so
  expect(await probeNow(page)).toBe('black');
  expect((await renderInfo(page)).fxLevel).toBe(1);
  expect((await status(page)).checking).toBe(false);
  expect((await renderInfo(page)).fxStored).toBe(1);
  const alerts = (await page.evaluate(() => window.__game.getState())).alerts.map((a: any) => a.text);
  expect(alerts.some((t: string) => /FX 0 did not draw/.test(t))).toBe(true);
  await page.evaluate(() => window.__game.setTerrainVisible(true));

  // the failed level is remembered across launches: the menu asks twice
  await page.reload();
  await page.waitForFunction(() => window.__game !== undefined);
  expect((await status(page)).failed).toEqual([0]);
  expect((await renderInfo(page)).fxLevel, 'boots at the stored level').toBe(1);
  await page.evaluate(() => {
    const g = window.__game;
    g.setPaused(true);
    g.grantPower(200000);
    g.advanceGameSeconds(610 - g.getState().simTime);
    g.grantPower(200000);
  });
  await page.keyboard.press('Escape');
  await page.locator('#menu [data-fx="0"]').click();
  await expect(page.locator('#menu-fx-note')).toContainText('drew a black frame or failed to build on this GPU before');
  expect((await renderInfo(page)).fxLevel).toBe(1);
  await page.locator('#menu-fx-try').click();
  // at night, on the earthshine floor, the raise passes and is stored
  await expect.poll(async () => (await status(page)).checking, SLOW).toBe(false);
  info = await renderInfo(page);
  expect(info.fxLevel).toBe(0);
  expect(info.fxStored).toBe(0);
  expect((await status(page)).failed, 'a level that draws is cleared').toEqual([]);
});

test('every FX level draws the scene once a frame; the tech tree and map rest the GPU', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 800, height: 450 });
  await page.goto('/?debug&seed=42&nolock&site=mare');
  await page.waitForFunction(() => window.__game !== undefined);
  // the placement ghost is transparent: N8AO's auto-detect would have turned
  // its transparency pass (two more scene renders a frame) on for it
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.beginPlacement('habitat'); });
  await page.mouse.move(400, 300);
  for (const fx of [0, 1, 2, 3]) {
    await page.evaluate((n) => window.__game.setFxLevel(n), fx);
    await page.waitForTimeout(1500);
    const r = await rendersPerFrame(page, 3000);
    expect(r.frames, `FX ${fx}: frames drawn`).toBeGreaterThan(0);
    expect(r.perFrame, `FX ${fx}: scene renders per frame`).toBe(1);
  }
  await page.evaluate(() => window.__game.cancelPlacement());
  // an opaque full-screen screen: the sim runs on, the scene is not drawn
  await page.keyboard.press('KeyT');
  await expect(page.locator('#tech-screen')).toBeVisible();
  await page.waitForTimeout(500);
  expect((await rendersPerFrame(page, 1500)).frames, 'nothing drawn under the tech tree').toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#tech-screen')).toBeHidden();
  await expect.poll(async () => (await rendersPerFrame(page, 1000)).frames).toBeGreaterThan(0);
  await page.evaluate(() => window.__game.setMapOpen(true));
  await page.waitForTimeout(500);
  expect((await rendersPerFrame(page, 1500)).frames, 'nothing drawn under the Lunar Map').toBe(0);
  await page.evaluate(() => window.__game.setMapOpen(false));
  await expect.poll(async () => (await rendersPerFrame(page, 1000)).frames).toBeGreaterThan(0);
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
