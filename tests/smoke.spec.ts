/** Full-loop smoke test: site select → build → economy ticks → walk mode →
 *  tech tree → night survival → launch → victory → save/reload restore.
 *  Drives the sim through window.__game (?debug&nolock) plus real UI clicks. */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

const URL_DEBUG = '/?debug&seed=42&nolock&lowfx';

async function game(page: Page) {
  await page.waitForFunction(() => window.__game !== undefined);
}

test.describe.configure({ mode: 'serial' });

test('title & site selection renders all three sites with pros/cons', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL_DEBUG);
  await expect(page.locator('h1')).toHaveText('MOONSHOTS');
  await expect(page.locator('.site-card')).toHaveCount(3);
  await expect(page.locator('.site-card').first()).toContainText('SHACKLETON');
  await expect(page.locator('.site-card .pro').first()).toBeVisible();
  await expect(page.locator('.site-card .con').first()).toBeVisible();
  const land = page.locator('#btn-land');
  await expect(land).toBeDisabled();
  await page.locator('.site-card', { hasText: 'ILMENITE' }).click();
  await expect(land).toBeEnabled();
  await page.screenshot({ path: 'test-results/01-site-select.png' });
  expect(errors).toEqual([]);
});

test('landing starts the game with HUD and lander', async ({ page }) => {
  await page.goto(URL_DEBUG);
  await page.locator('.site-card', { hasText: 'ILMENITE' }).click();
  await page.locator('#btn-land').click();
  await game(page);
  await expect(page.locator('#resource-strip')).toBeVisible();
  await expect(page.locator('#swarm-meter')).toContainText('Dyson Swarm');
  await expect(page.locator('#milestones')).toContainText('Power Up');
  const state = await page.evaluate(() => window.__game.getState());
  expect(state.siteId).toBe('mare');
  expect(state.buildings.length).toBe(1);
  expect(state.buildings[0].type).toBe('lander');
  await page.screenshot({ path: 'test-results/02-landed.png' });
});

test('economy: place buildings, resources tick, night browns out industry', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);

  // place via debug API on the flat mare next to the lander
  expect(await page.evaluate(() => window.__game.placeBuilding('solar', 132, 126))).toBe(true);
  expect(await page.evaluate(() => window.__game.placeBuilding('solar', 132, 130))).toBe(true);
  expect(await page.evaluate(() => window.__game.placeBuilding('excavator', 120, 126))).toBe(true);

  const before = await page.evaluate(() => window.__game.getState());
  await page.evaluate(() => window.__game.advanceGameMinutes(2));
  const after = await page.evaluate(() => window.__game.getState());
  expect(after.resources.regolith).toBeGreaterThan(before.resources.regolith);
  expect(after.power.supply).toBeGreaterThan(0);

  // smelter needs research → complete tech, place, verify metals + oxygen byproduct
  await page.evaluate(() => window.__game.completeTech('regolithProcessing'));
  expect(await page.evaluate(() => window.__game.placeBuilding('smelter', 120, 132))).toBe(true);
  const m0 = await page.evaluate(() => window.__game.getState());
  await page.evaluate(() => window.__game.advanceGameMinutes(2));
  const m1 = await page.evaluate(() => window.__game.getState());
  expect(m1.resources.metals).toBeGreaterThan(m0.resources.metals);

  // night on Mare with no batteries: industry idles by priority — the lander's
  // trickle keeps the small excavator alive; the hungry smelter browns out
  await page.evaluate(() => window.__game.advanceGameMinutes(6)); // t≈600s, mid-night
  const night = await page.evaluate(() => window.__game.getState());
  expect(night.wasNight).toBe(true);
  const smelter = night.buildings.find((b: any) => b.type === 'smelter');
  expect(smelter.idleReason).toBe('power');
  expect(night.power.brownout).toBe(true);
  await page.screenshot({ path: 'test-results/03-night.png' });
});

test('walk mode: WASD moves the astronaut across the terrain', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  await page.evaluate(() => window.__game.setMode('walk'));
  await expect(page.locator('#reticle')).toBeVisible();
  await expect(page.locator('#walk-hud')).toBeVisible();
  const p0 = await page.evaluate(() => window.__game.getPlayer());
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(3000);
  await page.keyboard.up('KeyW');
  const p1 = await page.evaluate(() => window.__game.getPlayer());
  // headless software GL runs rAF slowly; any real displacement proves the controller
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  expect(moved).toBeGreaterThan(2);
  await page.screenshot({ path: 'test-results/04-walk.png' });
  await page.evaluate(() => window.__game.setMode('build'));
  await expect(page.locator('#reticle')).toBeHidden();
});

test('tech tree: research queues, completes, unlocks buildings, gates eras', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  await page.keyboard.press('KeyT');
  await expect(page.locator('#tech-screen')).toBeVisible();
  await expect(page.locator('.era-col')).toHaveCount(6);
  await page.screenshot({ path: 'test-results/05-techtree.png' });

  // era 1 tech is clickable; era 2 techs locked until 2 era-1 techs done
  const smelting = page.locator('.tech-card', { hasText: 'Regolith Smelting' });
  await expect(smelting).toHaveClass(/available/);
  await smelting.click();
  await page.evaluate(() => window.__game.grantData(50));
  await page.evaluate(() => window.__game.advanceGameSeconds(5));
  const s1 = await page.evaluate(() => window.__game.getState());
  expect(s1.techsDone).toContain('regolithProcessing');

  await page.evaluate(() => window.__game.completeTech('iceExtraction'));
  const s2 = await page.evaluate(() => window.__game.getState());
  expect(s2.era).toBe(2);
});

test('buildings take time to construct and are inert until complete', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  expect(await page.evaluate(() => window.__game.placeBuilding('solar', 132, 126))).toBe(true);
  const s0 = await page.evaluate(() => window.__game.getState());
  const placed = s0.buildings.find((b: any) => b.type === 'solar');
  expect(placed.construction).toBeGreaterThan(0); // 15s × mare 0.8 = 12s
  // 5s in: still a construction site — contributes no power
  await page.evaluate(() => window.__game.advanceGameSeconds(5));
  const mid = await page.evaluate(() => window.__game.getState());
  expect(mid.buildings.find((b: any) => b.type === 'solar').idleReason).toBe('building');
  expect(mid.power.supply).toBeLessThan(10); // lander trickle only
  // after its build time: operational and generating
  await page.evaluate(() => window.__game.advanceGameSeconds(20));
  const done = await page.evaluate(() => window.__game.getState());
  expect(done.buildings.find((b: any) => b.type === 'solar').construction).toBe(0);
  expect(done.power.supply).toBeGreaterThan(10);
});

test('construction robots gate concurrent builds', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  // three sites, two robots: only two build, the third queues
  expect(await page.evaluate(() => window.__game.placeBuilding('solar', 132, 126))).toBe(true);
  expect(await page.evaluate(() => window.__game.placeBuilding('solar', 132, 130))).toBe(true);
  expect(await page.evaluate(() => window.__game.placeBuilding('excavator', 120, 126))).toBe(true);
  await page.evaluate(() => window.__game.advanceGameSeconds(2));
  const s = await page.evaluate(() => window.__game.getState());
  const reasons = s.buildings.filter((b: any) => b.construction > 0).map((b: any) => b.idleReason).sort();
  expect(reasons).toEqual(['building', 'building', 'queued']);
  expect(s.bots.total).toBe(2);
  expect(s.bots.busy).toBe(2);
  // active sites pull construction power from the grid
  expect(s.power.demand).toBeGreaterThanOrEqual(8);
  // when a robot frees up, the queued site starts
  await page.evaluate(() => window.__game.advanceGameSeconds(20)); // solars done at 16s
  const s2 = await page.evaluate(() => window.__game.getState());
  const excavator = s2.buildings.find((b: any) => b.type === 'excavator');
  expect(excavator.idleReason).toBe('building');
});

test('honest research path: lab is buildable from start and carries the tech tree', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  // no completeTech / grantData: the lab must be placeable day one and
  // its data output must complete a queued tech on its own
  expect(await page.evaluate(() => window.__game.placeBuilding('lab', 135, 133))).toBe(true);
  expect(await page.evaluate(() => window.__game.placeBuilding('solar', 132, 126))).toBe(true);
  await page.evaluate(() => window.__game.research('regolithProcessing'));
  await page.evaluate(() => window.__game.advanceGameMinutes(4));
  const s = await page.evaluate(() => window.__game.getState());
  expect(s.techsDone).toContain('regolithProcessing');
  expect(await page.evaluate(() => window.__game.placeBuilding('smelter', 119, 131))).toBe(true);
});

test('endgame: mass driver, foils, LAUNCH, victory overlay, save/reload', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);

  // fast-forward the tech tree to swarm protocol
  for (const t of ['regolithProcessing', 'iceExtraction', 'hydroponicFarming',
    'batteryStorage', 'siliconRefining', 'closedLoopLS',
    'partsFabrication', 'thoriumPower', 'crewWellness',
    'foilManufacturing', 'massDriver', 'dustMitigation',
    'autoFabrication', 'hiEffLaunch', 'selfReplication', 'swarmProtocol']) {
    await page.evaluate((tech) => window.__game.completeTech(tech), t);
  }
  const st = await page.evaluate(() => window.__game.getState());
  expect(st.era).toBe(6);

  // satisfy the ordered milestone chain up to first-light
  await page.evaluate(() => window.__game.grantResources({
    metals: 500, parts: 200, foils: 12, regolith: 80, oxygen: 200, food: 200,
  }));
  expect(await page.evaluate(() => window.__game.placeBuilding('solar', 132, 126))).toBe(true);
  expect(await page.evaluate(() => window.__game.placeBuilding('smelter', 120, 126))).toBe(true);
  expect(await page.evaluate(() => window.__game.placeBuilding('massDriver', 132, 134))).toBe(true);
  await page.evaluate(() => window.__game.grantCrew(6)); // 10 total: staff + "grow the crew"
  await page.evaluate(() => window.__game.advanceGameMinutes(13)); // a full lunar cycle → night survived
  await page.evaluate(() => window.__game.grantPower(1000)); // launch burst budget

  const pre = await page.evaluate(() => window.__game.getState());
  expect(pre.nightsSurvived).toBeGreaterThanOrEqual(1);
  expect(pre.resources.launch).toBeGreaterThanOrEqual(1);
  expect(pre.milestonesDone).toContain('foils-ready');

  // the real button, on the swarm meter
  const btn = page.locator('#btn-launch');
  await expect(btn).toBeEnabled();
  await btn.click();
  await page.evaluate(() => window.__game.advanceGameSeconds(2));

  const post = await page.evaluate(() => window.__game.getState());
  expect(post.launches).toBe(1);
  expect(post.swarmPct).toBeGreaterThan(0);
  await expect(page.locator('#victory-screen')).toBeVisible();
  await expect(page.locator('#victory-screen')).toContainText('FIRST LIGHT');
  await page.screenshot({ path: 'test-results/06-victory.png' });
  await page.locator('#btn-victory-continue').click();
  await expect(page.locator('#victory-screen')).toBeHidden();

  // save → reload → continue restores the base
  await page.evaluate(() => window.__game.save());
  await page.waitForTimeout(300);
  await page.goto(URL_DEBUG); // no ?site → title screen
  await page.locator('#btn-continue').click();
  await game(page);
  const restored = await page.evaluate(() => window.__game.getState());
  expect(restored.launches).toBe(1);
  expect(restored.buildings.some((b: any) => b.type === 'massDriver')).toBe(true);
  await page.screenshot({ path: 'test-results/07-restored.png' });
});
