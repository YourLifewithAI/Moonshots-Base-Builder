/** World-dressing and build-camera tests: the sky's exposure and Earth phase,
 *  rocks cleared by pads and grading (and still cleared after a reload),
 *  the camera held above the ground, and the build-mode keys (the High
 *  detail free camera; the classic isometric one is in classic.spec.ts). */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

const URL_DEBUG = '/?debug&seed=42&nolock&lowfx';

async function boot(page: Page, site: string, extra = '') {
  await page.goto(`${URL_DEBUG}&site=${site}${extra}`);
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => window.__game.setPaused(true));
}

const sky = (page: Page) => page.evaluate(() => window.__game.getRenderInfo().sky);
const cam = (page: Page) => page.evaluate(() => window.__game.getCamera());

/** World rect of a cell rect [gx0..gx1) × [gz0..gz1). */
const rect = (gx0: number, gz0: number, gx1: number, gz1: number) =>
  [gx0 * 4 - 512, gz0 * 4 - 512, gx1 * 4 - 512, gz1 * 4 - 512] as const;

test('sky: no stars in sunlight, full stars at night, Earth phase follows the sun', async ({ page }) => {
  await boot(page, 'mare');
  // mid-morning: the sun is up, the film exposure leaves the sky black
  await expect.poll(async () => (await sky(page)).sunVisible).toBe(true);
  const day = await sky(page);
  expect(day.starLevel).toBeLessThan(0.01);
  expect(day.earthElevDeg).toBeGreaterThan(55);
  // noon: sun and Earth share the sky, so Earth is a crescent
  await page.evaluate(() => window.__game.advanceGameSeconds(150));
  await page.waitForTimeout(800);
  const noon = await sky(page);
  expect(noon.earthPhase).toBeLessThan(0.3);
  // night: sun gone, stars at full exposure, Earth's lit side turned to us
  await page.evaluate(() => window.__game.advanceGameSeconds(390));
  await expect.poll(async () => (await sky(page)).starLevel).toBeGreaterThan(0.99);
  const night = await sky(page);
  expect(night.sunVisible).toBe(false);
  expect(night.earthPhase).toBeGreaterThan(noon.earthPhase + 0.2);

  // the south pole keeps Earth on the horizon
  await boot(page, 'southpole');
  await expect.poll(async () => {
    const e = (await sky(page)).earthElevDeg;
    return e > 0 && e < 5;
  }).toBe(true);
});

test('rocks: pads and grading clear the ground, and a reload replays it', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page, 'southpole');
  await page.evaluate(() => {
    window.__game.completeTech('siteGrading');
    window.__game.grantResources({ metals: 400, parts: 100 });
    window.__game.grantPower(400);
  });
  // rocky ground in reach of the Lander (the descent swept its own pad clean)
  const spots = await page.evaluate(() => {
    const g = window.__game;
    const lander = g.getState().buildings[0];
    const cx = lander.gx + 1.5, cz = lander.gz + 1.5;
    const world = (c: number) => c * 4 - 512;
    const rocky = (gx: number, gz: number, n: number) =>
      g.rocksIn(world(gx), world(gz), world(gx + n), world(gz + n)) > 0;
    const apart = (ax: number, az: number, an: number, bx: number, bz: number, bn: number) =>
      ax >= bx + bn || bx >= ax + an || az >= bz + bn || bz >= az + an;
    const ring = function* () {
      for (let r = 6; r <= 14; r++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) === r) yield [Math.round(cx + dx), Math.round(cz + dz)];
          }
        }
      }
    };
    let solar: number[] | undefined, grade: number[] | undefined;
    for (const [gx, gz] of ring()) {
      if (g.canPlace('solar', gx, gz).valid && rocky(gx, gz, 2)) { solar = [gx, gz]; break; }
    }
    for (const [gx, gz] of ring()) {
      if (Math.hypot(gx + 2 - cx, gz + 2 - cz) * 4 > 55 || !rocky(gx, gz, 4)) continue;
      if (!apart(gx, gz, 4, lander.gx, lander.gz, 3)) continue;
      if (solar && !apart(gx, gz, 4, solar[0], solar[1], 2)) continue;
      grade = [gx, gz];
      break;
    }
    return { solar, grade };
  });
  expect(spots.solar, 'a valid solar pad with rocks on it').toBeTruthy();
  expect(spots.grade, 'a gradeable patch with rocks on it').toBeTruthy();
  const [sx, sz] = spots.solar!, [ggx, ggz] = spots.grade!;
  const solarRect = rect(sx, sz, sx + 2, sz + 2), gradeRect = rect(ggx, ggz, ggx + 4, ggz + 4);
  const rocksIn = (r: readonly number[]) => page.evaluate((q) => window.__game.rocksIn(...q), r);

  expect(await page.evaluate(([x, z]) => window.__game.placeBuilding('solar', x, z), spots.solar!)).toBe(true);
  expect(await rocksIn(solarRect)).toBe(0);
  const before = (await page.evaluate(() => window.__game.getState())).flattens.length;
  await page.evaluate(([x, z]) => window.__game.gradeAt(x, z), spots.grade!);
  await page.evaluate(() => window.__game.advanceGameSeconds(1));
  expect((await page.evaluate(() => window.__game.getState())).flattens.length).toBe(before + 1);
  expect(await rocksIn(gradeRect)).toBe(0);
  const standing = await rocksIn([-512, -512, 512, 512]);

  // the terrain regenerates on load and the flatten history replays onto it
  await page.evaluate(() => window.__game.save());
  await page.waitForTimeout(300);
  await page.goto(URL_DEBUG);
  await page.locator('#btn-continue').click();
  await page.waitForFunction(() => window.__game !== undefined && window.__game.getState() !== null);
  expect(await rocksIn(solarRect)).toBe(0);
  expect(await rocksIn(gradeRect)).toBe(0);
  expect(await rocksIn([-512, -512, 512, 512])).toBe(standing);
});

test('build camera: stays above the ground and its target rides the terrain', async ({ page }) => {
  await boot(page, 'southpole', '&style=detailed'); // the free camera: High detail's (classic: classic.spec.ts)
  // starts ~90 m from the Lander
  const c0 = await cam(page);
  expect(c0.dist).toBeGreaterThan(80);
  expect(c0.dist).toBeLessThan(100);
  // a view pushed below the ground is lifted back over it
  await page.evaluate(() => window.__game.setView({ x: 17, y: -30, z: 4 }, { x: 0, y: 0, z: 0 }));
  await expect.poll(async () => (await cam(page)).clearance).toBeGreaterThan(3.9);
  // a target left hanging in the air settles onto the ground under it
  await page.evaluate(() => window.__game.setView({ x: 90, y: 120, z: 90 }, { x: 40, y: 60, z: 40 }));
  await expect.poll(async () => {
    const c = await cam(page);
    return Math.abs(c.target.y - c.targetGround);
  }, { timeout: 15_000 }).toBeLessThan(0.5);
});

test('build camera: WASD pans, Q/E orbit, F focuses the selection, H returns home', async ({ page }) => {
  await boot(page, 'mare', '&style=detailed'); // the free camera: High detail's (classic: classic.spec.ts)
  await page.evaluate(() => window.__game.grantResources({ metals: 200 }));
  expect(await page.evaluate(() => window.__game.placeBuilding('lab', 135, 133))).toBe(true);
  const c0 = await cam(page);

  // W pans toward where the camera looks, at a rate scaled by distance
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  const c1 = await cam(page);
  const moved = { x: c1.target.x - c0.target.x, z: c1.target.z - c0.target.z };
  const look = { x: c0.target.x - c0.pos.x, z: c0.target.z - c0.pos.z };
  expect(Math.hypot(moved.x, moved.z)).toBeGreaterThan(3);
  expect(moved.x * look.x + moved.z * look.z, 'panned forward').toBeGreaterThan(0);
  expect(c1.dist).toBeCloseTo(c0.dist, 0);

  // Q orbits about the target without moving it
  await page.keyboard.down('KeyQ');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyQ');
  const c2 = await cam(page);
  expect(Math.abs(c2.azimuth - c1.azimuth)).toBeGreaterThan(0.05);
  expect(Math.hypot(c2.target.x - c1.target.x, c2.target.z - c1.target.z)).toBeLessThan(0.5);
  // E turns the other way
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyE');
  const c3 = await cam(page);
  expect(Math.sign(c3.azimuth - c2.azimuth)).toBe(-Math.sign(c2.azimuth - c1.azimuth));

  // F glides to the selected building; H glides back to the Lander
  const lab = await page.evaluate(() => window.__game.getState().buildings.find((b: any) => b.type === 'lab'));
  await page.evaluate((id) => window.__game.select(id), lab.id);
  await page.keyboard.press('KeyF');
  const labX = (lab.gx + 1) * 4 - 512, labZ = (lab.gz + 1) * 4 - 512; // 2×2 cells
  await expect.poll(async () => {
    const c = await cam(page);
    return Math.hypot(c.target.x - labX, c.target.z - labZ);
  }, { timeout: 15_000 }).toBeLessThan(1);
  await page.keyboard.press('KeyH');
  await expect.poll(async () => {
    const c = await cam(page);
    return Math.hypot(c.target.x - c0.target.x, c.target.z - c0.target.z);
  }, { timeout: 15_000 }).toBeLessThan(1);

  // walk mode keeps WASD for the astronaut: the build target stays put
  await page.evaluate(() => window.__game.setMode('walk'));
  const t0 = (await cam(page)).target;
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(800);
  await page.keyboard.up('KeyW');
  const t1 = (await cam(page)).target;
  expect(Math.hypot(t1.x - t0.x, t1.z - t0.z)).toBeLessThan(0.01);
});
