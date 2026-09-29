/** World-dressing and build-camera tests: rocks cleared by pads and grading
 *  (and still cleared after a reload), the camera held above the ground, the
 *  build-mode keys, and the removal of walk mode (Tab does nothing; an old
 *  save made on foot loads in the command view). */
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

const cam = (page: Page) => page.evaluate(() => window.__game.getCamera());

/** World rect of a cell rect [gx0..gx1) × [gz0..gz1). */
const rect = (gx0: number, gz0: number, gx1: number, gz1: number) =>
  [gx0 * 4 - 512, gz0 * 4 - 512, gx1 * 4 - 512, gz1 * 4 - 512] as const;

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
  await boot(page, 'southpole');
  // the isometric view starts at its home zoom (170 m) from the Lander
  const c0 = await cam(page);
  expect(c0.dist).toBeGreaterThan(100);
  expect(c0.dist).toBeLessThan(300);
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

test('build camera: WASD pans, Q/E turn, F focuses the selection, H returns home', async ({ page }) => {
  await boot(page, 'mare');
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
});

// ───────────────────────────── walk mode is gone ─────────────────────────────

test('Tab does nothing: no walk mode, no walk HUD, no walk API', async ({ page }) => {
  await boot(page, 'mare');
  await expect(page.locator('#resource-strip')).toBeVisible();
  const c0 = await cam(page);
  const lens0 = await page.evaluate(() => window.__game.getRenderInfo().lens);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(600);
  await expect(page.locator('#walk-hud')).toHaveCount(0);
  await expect(page.locator('#reticle, #visor, #helmet')).toHaveCount(0);
  expect(await page.evaluate(() => document.getElementById('hud-layer')!.classList.contains('mode-walk'))).toBe(false);
  // Tab leaves focus where it was (no focus walk onto the HUD) and the view as it was
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await expect(page.locator('#resource-strip')).toBeVisible();
  const c1 = await cam(page);
  expect(c1.target).toEqual(c0.target);
  expect(c1.dist).toBeCloseTo(c0.dist, 6);
  expect(await page.evaluate(() => window.__game.getRenderInfo().lens)).toEqual(lens0);
  expect(await page.evaluate(() => [typeof window.__game.setMode, typeof window.__game.getPlayer])).toEqual(['undefined', 'undefined']);
});

test('an old save made on foot (player.mode walk) loads in the command view', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await boot(page, 'mare');
  await page.evaluate(() => window.__game.save());
  // rewrite the stored save as a build from before this change wrote it: the player block says walk
  await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('keyval-store');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('keyval', 'readwrite');
      const store = tx.objectStore('keyval');
      const get = store.get('mbb-save-v1');
      get.onsuccess = () => {
        const blob = get.result;
        blob.player = { mode: 'walk', x: 12, y: 3, z: -8, yaw: 1.2, pitch: 0.1 };
        store.put(blob, 'mbb-save-v1');
      };
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    };
  }));
  await page.goto(URL_DEBUG);
  await page.locator('#btn-continue').click();
  await page.waitForFunction(() => (window.__game?.getState()?.buildings?.length ?? 0) > 0);
  await expect(page.locator('#resource-strip')).toBeVisible();
  await expect(page.locator('#walk-hud')).toHaveCount(0);
  expect(await page.evaluate(() => document.getElementById('hud-layer')!.classList.contains('mode-walk'))).toBe(false);
  // the command camera has the view: the iso lens, and W pans it
  await expect.poll(async () => (await page.evaluate(() => window.__game.getRenderInfo().lens)).fov).toBe(20);
  const t0 = (await cam(page)).target;
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(800);
  await page.keyboard.up('KeyW');
  const t1 = (await cam(page)).target;
  expect(Math.hypot(t1.x - t0.x, t1.z - t0.z), 'W pans the command camera').toBeGreaterThan(1);
  expect(errors).toEqual([]);
});

// ───────────────────── the fixed isometric camera (player/isoCam.ts) ─────────────────────
// The default (classic) style: 4 rotations × 2 tilts, snap-rotated, free zoom.
// The High detail free camera's tests are above; the older isometric checks
// (F, H, WASD, right-drag) are in classic.spec.ts.

const DEG = Math.PI / 180;
const iso = async (page: Page) => (await cam(page)).iso;

/** the view has finished turning, tilting and zooming */
async function isoSettled(page: Page) {
  await expect.poll(async () => {
    const i = await iso(page);
    return !i.turning && !i.tilting && Math.abs(i.dist - i.zoomTo) < 0.05;
  }, { timeout: 30_000 }).toBe(true);
  return cam(page);
}

test('isometric camera: Q/E turn one exact step each way, V flips the tilt 32° ↔ 55° eased, neither moves the target', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page, 'mare');
  let c = await isoSettled(page);
  const home = c.target;
  const pitch = (q: any) => Math.asin((q.pos.y - q.target.y) / q.dist);
  expect(c.iso).toMatchObject({ rot: 0, tilt: 0, zoom: 170, pitchDeg: 32, yawStep: 0 });
  expect(pitch(c)).toBeCloseTo(32 * DEG, 3);

  // E turns one step, Q the other way; exactly 90° each
  await page.keyboard.press('KeyE');
  c = await isoSettled(page);
  expect(c.iso).toMatchObject({ rot: 1, yawStep: 1 });
  expect(c.azimuth).toBeCloseTo(135 * DEG, 6);
  await page.keyboard.press('KeyQ');
  await page.keyboard.press('KeyQ');
  c = await isoSettled(page);
  expect(c.iso).toMatchObject({ rot: 3, yawStep: -1 }); // rot wraps to 0–3; yawStep is the raw count
  expect(c.azimuth).toBeCloseTo(-45 * DEG, 6);
  await page.keyboard.press('KeyE');
  c = await isoSettled(page);
  expect(c.iso.rot).toBe(0);
  expect(c.azimuth).toBeCloseTo(45 * DEG, 6);

  // V tilts to the high view; it eases (0.35 s), it does not jump
  await page.keyboard.press('KeyV');
  await expect.poll(async () => (await iso(page)).tilting).toBe(true);
  expect((await iso(page)).tilt).toBe(1);
  c = await isoSettled(page);
  expect(c.iso).toMatchObject({ tilt: 1, pitchDeg: 55, rot: 0 });
  expect(pitch(c)).toBeCloseTo(55 * DEG, 3);
  expect(c.azimuth, 'the tilt keeps the yaw').toBeCloseTo(45 * DEG, 6);
  expect(c.dist, 'and the zoom').toBeCloseTo(170, 0);
  // a held key tilts once, whatever the OS repeat does
  for (let i = 0; i < 5; i++) await page.keyboard.down('KeyV');
  await page.keyboard.up('KeyV');
  c = await isoSettled(page);
  expect(c.iso).toMatchObject({ tilt: 0, pitchDeg: 32 });
  expect(pitch(c)).toBeCloseTo(32 * DEG, 3);

  // R rotates the ghost and T opens the tree: neither touches the camera
  await page.keyboard.press('KeyR');
  await page.keyboard.press('KeyT');
  await page.keyboard.press('Escape');
  c = await isoSettled(page);
  expect(c.iso).toMatchObject({ rot: 0, tilt: 0 });
  // turning and tilting never move the target
  expect(Math.hypot(c.target.x - home.x, c.target.z - home.z)).toBeLessThan(0.5);
  // the old names still read: yawStep, pitchDeg, levels, level
  expect(c.iso).toMatchObject({ level: 1, pitchDeg: 32, yawStep: 0 });
  expect(c.iso.levels).toEqual([100, 170, 290, 490, 830]);
});

test('isometric camera: the wheel zooms continuously, clamped at the near and far ends; a tilt keeps the zoom', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page, 'mare');
  let c = await isoSettled(page);
  expect(c.dist).toBeCloseTo(170, 0);
  await page.mouse.move(720, 450);

  // a small nudge lands between the old levels; it is not a step
  const levels = [100, 170, 290, 490, 830];
  await page.mouse.wheel(0, 40);
  c = await isoSettled(page);
  expect(c.dist).toBeGreaterThan(190);
  expect(c.dist).toBeLessThan(230);
  for (const l of levels) expect(Math.abs(c.dist - l), `not on level ${l}`).toBeGreaterThan(8);
  const d1 = c.dist;
  await page.mouse.wheel(0, 40);
  c = await isoSettled(page);
  expect(c.dist, 'a second nudge goes on from there').toBeGreaterThan(d1 * 1.15);
  await page.mouse.wheel(0, -40);
  c = await isoSettled(page);
  expect(c.dist).toBeCloseTo(d1, 0);
  // the alias reads the nearest level
  expect(c.iso.level).toBe(1);

  // clamped at both ends
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 120);
  c = await isoSettled(page);
  expect(c.dist).toBeCloseTo(830, 0);
  expect(c.iso.level).toBe(4);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -120);
  c = await isoSettled(page);
  expect(c.dist).toBeCloseTo(100, 0);
  expect(c.iso.level).toBe(0);

  // a trackpad's trickle is continuous too: many small events add up smoothly
  await page.evaluate(() => {
    const cv = document.getElementById('world')!;
    for (let i = 0; i < 4; i++) cv.dispatchEvent(new WheelEvent('wheel', { deltaY: 15, bubbles: true, cancelable: true }));
  });
  c = await isoSettled(page);
  expect(c.dist).toBeGreaterThan(100 * 1.1);
  expect(c.dist).toBeLessThan(170);

  // the tilt keeps whatever the zoom is, and at the high tilt the wheel still clamps
  const before = c.dist;
  await page.keyboard.press('KeyV');
  c = await isoSettled(page);
  expect(c.iso.tilt).toBe(1);
  expect(c.dist).toBeCloseTo(before, 0);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 120);
  c = await isoSettled(page);
  expect(c.dist).toBeCloseTo(830, 0);
  // the camera stays over the ground at the far end of both tilts
  expect(c.clearance).toBeGreaterThan(3.9);

  // F closes to the near level, H glides home to the home level (both at any tilt)
  await page.evaluate(() => { const g = window.__game; g.select(g.getState().buildings[0].id); });
  await page.keyboard.press('KeyF');
  await expect.poll(async () => (await iso(page)).zoomTo).toBe(100);
  c = await isoSettled(page);
  expect(c.dist).toBeCloseTo(100, 0);
  await page.keyboard.press('KeyH');
  await expect.poll(async () => (await iso(page)).zoomTo).toBe(170);
  c = await isoSettled(page);
  expect(c.dist).toBeCloseTo(170, 0);
  expect(c.iso.tilt, 'H keeps the tilt').toBe(1);
});

test('isometric camera: panning at the high tilt moves the ground under the pointer', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page, 'mare');
  await page.keyboard.press('KeyV');
  await isoSettled(page);
  // a ground point near the target, on screen before and after a right-drag
  const p0 = await page.evaluate(() => {
    const g = window.__game, t = g.getCamera().target;
    return { t, s: g.screenOf(t.x + 6, t.z + 6, g.getCamera().targetGround) };
  });
  await page.mouse.move(700, 400);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(760, 440, { steps: 6 });
  await page.mouse.up({ button: 'right' });
  const p1 = await page.evaluate((t0) => {
    const g = window.__game;
    return { s: g.screenOf(t0.x + 6, t0.z + 6, g.getCamera().targetGround) };
  }, p0.t);
  // the ground followed the pointer: +60 px right, +40 px down, both ways of the drag
  expect(p1.s.x - p0.s.x).toBeGreaterThan(50);
  expect(p1.s.x - p0.s.x).toBeLessThan(70);
  expect(p1.s.y - p0.s.y).toBeGreaterThan(30);
  expect(p1.s.y - p0.s.y).toBeLessThan(50);
});

test('isometric camera: the preset (turn, tilt, zoom) is saved and survives a reload; an old save loads the default view', async ({ page }) => {
  test.setTimeout(180_000);
  await boot(page, 'mare');
  await isoSettled(page);
  await page.mouse.move(720, 450);
  await page.keyboard.press('KeyE');
  await page.keyboard.press('KeyE');
  await page.keyboard.press('KeyV');
  await page.mouse.wheel(0, 60);
  let c = await isoSettled(page);
  const want = { rot: 2, tilt: 1, dist: c.dist };
  expect(want.dist).toBeGreaterThan(190);
  const blob = await page.evaluate(() => window.__game.saveBlob());
  expect(blob.camera).toMatchObject({ step: 2, tilt: 1 });
  expect(blob.camera.dist).toBeCloseTo(want.dist, 0);

  // a real save and reload: the view comes back as the player left it
  await page.evaluate(() => window.__game.save());
  await page.waitForTimeout(300);
  await page.goto(URL_DEBUG);
  await page.locator('#btn-continue').click();
  await page.waitForFunction(() => window.__game !== undefined && window.__game.getState() !== null);
  c = await isoSettled(page);
  expect(c.iso).toMatchObject({ rot: 2, tilt: 1, pitchDeg: 55 });
  expect(c.iso.dist).toBeCloseTo(want.dist, 0);
  expect(c.azimuth).toBeCloseTo(-135 * DEG, 6); // 225°, as atan2 reports it
  expect(Math.asin((c.pos.y - c.target.y) / c.dist)).toBeCloseTo(55 * DEG, 3);
  // the lander is still what the view is centred on
  const lander = await page.evaluate(() => window.__game.getState().buildings.find((b: any) => b.type === 'lander'));
  expect(Math.hypot(c.target.x - ((lander.gx + 1.5) * 4 - 512), c.target.z - ((lander.gz + 1.5) * 4 - 512))).toBeLessThan(8);

  // an old save has no camera: the default view (no turn, low tilt, home zoom)
  const old = JSON.parse(JSON.stringify(blob));
  delete old.camera;
  await page.evaluate((b) => window.__game.loadBlob(b), old);
  c = await isoSettled(page);
  expect(c.iso).toMatchObject({ rot: 0, tilt: 0, pitchDeg: 32, yawStep: 0 });
  expect(c.iso.dist).toBeCloseTo(170, 0);
  // and a damaged one keeps what it can read
  await page.evaluate((b) => window.__game.loadBlob({ ...b, camera: { step: 1, tilt: 'high', dist: 'far' } }), blob);
  c = await isoSettled(page);
  expect(c.iso).toMatchObject({ rot: 1, tilt: 0, pitchDeg: 32 });
  expect(c.iso.dist).toBeCloseTo(170, 0);
});
