/** Render-ladder test: every FX level, then safe mode, must draw a lit frame
 *  with no shader compile errors — including the first building of a type
 *  placed after each switch, which compiles a fresh program (or, in safe mode,
 *  must come up unlit like everything else). The rocks thin down the ladder,
 *  and the horizon ring and rocks go unlit with the rest in safe mode. */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

/** Luminance stats of the lower two thirds of a screenshot (ground + base). */
async function frameStats(page: Page) {
  const png = await page.screenshot();
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const y0 = Math.floor(bmp.height / 3);
    const { data } = ctx.getImageData(0, y0, bmp.width, bmp.height - y0);
    let lit = 0, sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      sum += l;
      if (l > 24) lit++;
    }
    const n = data.length / 4;
    return { mean: sum / n, litFrac: lit / n };
  }, png.toString('base64'));
}

test('render ladder: FX 0-3 and safe mode draw lit frames without shader errors', async ({ page }) => {
  test.setTimeout(180_000);
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
    }
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
