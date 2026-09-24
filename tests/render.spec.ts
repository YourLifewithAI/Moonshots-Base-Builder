/** Render-ladder test: every FX level, then safe mode, must draw a lit frame
 *  with no shader compile errors — including the first building of a type
 *  placed after each switch, which compiles a fresh program (or, in safe mode,
 *  must come up unlit like everything else). The rocks thin down the ladder,
 *  and the horizon ring and rocks go unlit with the rest in safe mode. The
 *  same ladder runs again at night, where the base lights itself (shader
 *  floods and window glow at FX 0–2, discs and point lights below that). */
import { test, expect, type Page } from '@playwright/test';

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
