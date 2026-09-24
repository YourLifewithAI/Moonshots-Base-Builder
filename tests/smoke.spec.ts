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
  // expedition step: human crew is the default selection
  await expect(page.locator('.site-card', { hasText: 'HUMAN CREW' })).toBeVisible();
  await page.locator('#btn-launch-exp').click();
  await game(page);
  await expect(page.locator('#resource-strip')).toBeVisible();
  await expect(page.locator('#swarm-meter')).toContainText('Dyson Swarm');
  await expect(page.locator('#milestones')).toContainText('Power Up');
  // objectives expand on click to show the whole roadmap, then collapse
  await page.locator('#milestones').click();
  await expect(page.locator('#milestones')).toContainText('Close the Parts Loop');
  await expect(page.locator('#milestones')).toContainText('FIRST LIGHT');
  await page.locator('#milestones').click();
  await expect(page.locator('#milestones')).not.toContainText('FIRST LIGHT');
  const state = await page.evaluate(() => window.__game.getState());
  expect(state.siteId).toBe('mare');
  expect(state.resources.metals).toBe(112); // 140-metal cache scaled by the mare's 0.8 build costs
  expect(state.buildings.length).toBe(1);
  expect(state.buildings[0].type).toBe('lander');
  await page.screenshot({ path: 'test-results/02-landed.png' });
});

test('economy: place buildings, resources tick, night sheds industry load', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  // paused: game time moves only by the fast-forwards below, so the night
  // check lands on the same tick however slowly the page renders
  await page.evaluate(() => window.__game.setPaused(true));

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
  await page.evaluate(() => window.__game.advanceGameMinutes(3)); // build 96s, then smelt
  const m1 = await page.evaluate(() => window.__game.getState());
  expect(m1.resources.metals).toBeGreaterThan(m0.resources.metals);

  // night on Mare with no batteries: industry idles by priority — the lander's
  // trickle keeps the small excavator alive; the hungry smelter goes dark.
  // Only priority-2 industry is idled, so this is load shedding, not a brownout
  // t≈575s: the bank is spent, and the regolith yard not yet full (a full
  // yard stands the excavator by, and the smelter then runs on its share)
  await page.evaluate(() => window.__game.advanceGameMinutes(3));
  const night = await page.evaluate(() => window.__game.getState());
  expect(night.wasNight).toBe(true);
  const smelter = night.buildings.find((b: any) => b.type === 'smelter');
  expect(smelter.idleReason).toBe('power');
  expect(night.power.shed).toBe(true);
  expect(night.power.brownout).toBe(false);
  expect(night.power.demand).toBeGreaterThan(night.power.supply); // the dark smelter still asks
  await page.screenshot({ path: 'test-results/03-night.png' });
});

test('power: dark loads count as demand; load shed vs brownout; power returns in priority order', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  // no solar: the lander's 6 kW and its bank are the whole grid
  expect(await page.evaluate(() => window.__game.placeBuilding('habitat', 132, 126))).toBe(true);   // 4 kW, prio 0
  expect(await page.evaluate(() => window.__game.placeBuilding('excavator', 120, 126))).toBe(true); // 6 kW, prio 2
  expect(await page.evaluate(() => window.__game.placeBuilding('lab', 135, 133))).toBe(true);       // 5 kW, prio 3
  await page.evaluate(() => window.__game.advanceGameSeconds(130)); // all three built
  // empty the bank and tick in one evaluate, so the live frame loop can't
  // slip in extra ticks of trickle charge
  const drainAndRun = (secs: number) => page.evaluate((n) => {
    const g = window.__game!;
    g.grantPower(-g.getState().powerStored);
    g.advanceGameSeconds(n);
    return g.getState();
  }, secs);
  const shed = await drainAndRun(3);
  const by = (s: any, t: string) => s.buildings.find((b: any) => b.type === t);
  expect(by(shed, 'habitat').idleReason).toBe('');
  expect(by(shed, 'excavator').idleReason).toBe('power');
  expect(by(shed, 'lab').idleReason).toBe('power');
  // requested demand keeps counting the loads held dark
  expect(shed.power.demand).toBeGreaterThanOrEqual(15);
  expect(shed.power.supply).toBeLessThan(shed.power.demand);
  // only priority 2–3 idled: an informational load shed, no blackout penalty
  expect(shed.power.shed).toBe(true);
  expect(shed.power.brownout).toBe(false);
  expect(shed.alerts.some((a: any) => a.text.startsWith('LOAD SHED') && a.kind === 'info')).toBe(true);
  await page.evaluate(() => window.__game.advanceGameSeconds(60));
  const afterShed = await page.evaluate(() => window.__game.getState());
  expect(afterShed.morale).toBeGreaterThan(60);

  // promote the lab to priority 1: now a critical load is dark — a brownout
  await page.evaluate((id) => window.__game.setPriority(id, 1), by(afterShed, 'lab').id);
  const brown = await drainAndRun(2);
  expect(by(brown, 'lab').idleReason).toBe('power');
  expect(brown.power.brownout).toBe(true);
  expect(brown.alerts.some((a: any) => a.text.startsWith('BROWNOUT') && a.kind === 'crit')).toBe(true);
  await page.evaluate(() => window.__game.advanceGameSeconds(60));
  const afterBrown = await page.evaluate(() => window.__game.getState());
  expect(afterBrown.morale).toBeLessThan(afterShed.morale - 4);

  // power returns: held loads come back on the next tick, not after the hold
  await page.evaluate(() => window.__game.grantPower(1000));
  await page.evaluate(() => window.__game.advanceGameSeconds(1));
  const back = await page.evaluate(() => window.__game.getState());
  expect(back.buildings.every((b: any) => b.idleReason !== 'power')).toBe(true);
  expect(back.power.brownout).toBe(false);
  expect(back.power.shed).toBe(false);
});

test('thorium reactor needs its operator; agent-run reactors pay the agent tax', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  await page.evaluate(() => window.__game.completeTech('thoriumPower'));
  await page.evaluate(() => window.__game.grantResources({ metals: 300, parts: 100 }));
  expect(await page.evaluate(() => window.__game.placeBuilding('reactor', 132, 126))).toBe(true);
  expect(await page.evaluate(() => window.__game.placeBuilding('reactor', 120, 126))).toBe(true);
  await page.evaluate(() => window.__game.advanceGameSeconds(500)); // build 240s each, two robots
  const s = await page.evaluate(() => window.__game.getState());
  const reactors = (st: any) => st.buildings.filter((b: any) => b.type === 'reactor');
  // staffed reactors run — and count as active, so their morale con applies
  expect(reactors(s).every((b: any) => b.active)).toBe(true);
  expect(s.power.supply).toBeCloseTo(6 + 40 + 40, 0);
  // one operator left for two reactors: the second one goes cold
  await page.evaluate(() => window.__game.grantCrew(-3));
  await page.evaluate(() => window.__game.advanceGameSeconds(2));
  const s2 = await page.evaluate(() => window.__game.getState());
  expect(reactors(s2).map((b: any) => b.idleReason).sort()).toEqual(['', 'crew']);
  expect(s2.power.supply).toBeCloseTo(6 + 40, 0);

  // robotic: agents staff the reactor, and skim its output for their own load
  await page.goto(`${URL_DEBUG}&site=mare&exp=robotic`);
  await game(page);
  await page.evaluate(() => window.__game.completeTech('thoriumPower'));
  await page.evaluate(() => window.__game.grantResources({ metals: 200, parts: 60 }));
  expect(await page.evaluate(() => window.__game.placeBuilding('reactor', 132, 126))).toBe(true);
  await page.evaluate(() => window.__game.advanceGameSeconds(260));
  const r = await page.evaluate(() => window.__game.getState());
  expect(reactors(r)[0].active).toBe(true);
  expect(r.power.supply).toBeCloseTo(6 + 40 * 0.85, 0);
});

test('slow frames keep game time at full speed; a hitch is capped', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  expect(await page.evaluate(() => window.__game.placeBuilding('solar', 132, 126))).toBe(true);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    const site = () => g.getState().buildings.find((b: any) => b.type === 'solar').construction;
    g.setSpeed(10);
    g.stepFrame(0); // applies the speed change
    const t0 = g.getState().simTime;
    const c0 = site();
    g.stepFrame(0.4); // one frame at 2.5 fps
    const t1 = g.getState().simTime;
    const c1 = site();
    g.stepFrame(3); // a three-second stall
    const t2 = g.getState().simTime;
    g.setSpeed(1);
    g.stepFrame(0);
    return { slow: t1 - t0, welded: c0 - c1, hitch: t2 - t1 };
  });
  expect(r.slow).toBeCloseTo(4, 6);    // 0.4 s × 10, not the 0.1 s frame clamp × 10
  expect(r.welded).toBeGreaterThanOrEqual(3); // the economy ticked along with it
  expect(r.hitch).toBeCloseTo(5, 6);   // at most half a second of game time per frame
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
  // research needs an OPERATING lab: banked data transfers at 0.4/s per lab
  expect(await page.evaluate(() => window.__game.placeBuilding('lab', 135, 133))).toBe(true);
  await page.evaluate(() => window.__game.advanceGameSeconds(80)); // built at 72s
  await page.keyboard.press('KeyT');
  await expect(page.locator('#tech-screen')).toBeVisible();
  await expect(page.locator('.era-head')).toHaveCount(8);
  await page.screenshot({ path: 'test-results/05-techtree.png' });

  // era 1 tech is clickable; era 2 techs locked until 2 era-1 techs done
  const smelting = page.locator('.tech-card[data-tech="regolithProcessing"]');
  await expect(smelting).toHaveClass(/available/);
  await expect(page.locator('.tech-card[data-tech="batteryStorage"]')).toHaveClass(/locked/);
  await smelting.click();
  await page.evaluate(() => window.__game.grantData(50));
  await page.evaluate(() => window.__game.advanceGameSeconds(5));
  const mid = await page.evaluate(() => window.__game.getState());
  expect(mid.techsDone).not.toContain('regolithProcessing'); // no longer instant
  await page.evaluate(() => window.__game.advanceGameSeconds(90)); // 30 data at 0.4/s
  const s1 = await page.evaluate(() => window.__game.getState());
  expect(s1.techsDone).toContain('regolithProcessing');

  // (Ice Extraction is pole-only now; a hidden tech never counts for a charter)
  await page.evaluate(() => window.__game.completeTech('teleoperation'));
  const s2 = await page.evaluate(() => window.__game.getState());
  expect(s2.era).toBe(2);
  await expect(page.locator('.tech-card[data-tech="batteryStorage"]')).toHaveClass(/available/);
});

test('research progress is banked across queue changes', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  expect(await page.evaluate(() => window.__game.placeBuilding('lab', 135, 133))).toBe(true);
  await page.evaluate(() => window.__game.advanceGameSeconds(80)); // lab built at 72s
  await page.evaluate(() => window.__game.grantData(100));
  await page.evaluate(() => window.__game.research('regolithProcessing'));
  await page.evaluate(() => window.__game.advanceGameSeconds(30)); // ~12 of 30 data in
  const mid = await page.evaluate(() => window.__game.getState());
  expect(mid.researchSpent.regolithProcessing).toBeGreaterThan(5);
  expect(mid.techsDone).not.toContain('regolithProcessing');
  // cancel — the banked data survives the reshuffle
  await page.evaluate(() => window.__game.cancelResearch('regolithProcessing'));
  await page.evaluate(() => window.__game.advanceGameSeconds(2));
  const cancelled = await page.evaluate(() => window.__game.getState());
  expect(cancelled.researchQueue).toEqual([]);
  expect(cancelled.researchSpent.regolithProcessing).toBeGreaterThan(5);
  // re-queue: it resumes from the bank and finishes early
  await page.evaluate(() => window.__game.research('regolithProcessing'));
  await page.evaluate(() => window.__game.advanceGameSeconds(60)); // 18 left at 0.4/s = 45s
  const done = await page.evaluate(() => window.__game.getState());
  expect(done.techsDone).toContain('regolithProcessing');
});

test('buildings take time to construct and are inert until complete', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  expect(await page.evaluate(() => window.__game.placeBuilding('solar', 132, 126))).toBe(true);
  const s0 = await page.evaluate(() => window.__game.getState());
  const placed = s0.buildings.find((b: any) => b.type === 'solar');
  expect(placed.construction).toBeGreaterThan(0); // 40s × mare 0.8 = 32s
  // 5s in: still a construction site — contributes no power
  await page.evaluate(() => window.__game.advanceGameSeconds(5));
  const mid = await page.evaluate(() => window.__game.getState());
  expect(mid.buildings.find((b: any) => b.type === 'solar').idleReason).toBe('building');
  expect(mid.power.supply).toBeLessThan(10); // lander trickle only
  // after its build time: operational and generating
  await page.evaluate(() => window.__game.advanceGameSeconds(35));
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
  await page.evaluate(() => window.__game.advanceGameSeconds(40)); // solars done at 32s
  const s2 = await page.evaluate(() => window.__game.getState());
  const excavator = s2.buildings.find((b: any) => b.type === 'excavator');
  expect(excavator.idleReason).toBe('building');
});

test('construction stalls without welding parts and resumes on delivery', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  // no parts in stock; solar costs metals only, so the site opens but can't weld
  await page.evaluate(() => window.__game.grantResources({ parts: -70 }));
  expect(await page.evaluate(() => window.__game.placeBuilding('solar', 132, 126))).toBe(true);
  await page.evaluate(() => window.__game.advanceGameSeconds(5));
  const s = await page.evaluate(() => window.__game.getState());
  const site = s.buildings.find((b: any) => b.type === 'solar');
  expect(site.idleReason).toBe('inputs');
  expect(site.construction).toBeGreaterThan(30); // no progress while stalled
  expect(s.alerts.some((a: any) => a.text.includes('CONSTRUCTION STALLED'))).toBe(true);
  // a parts delivery restarts the weld and the panel completes
  await page.evaluate(() => window.__game.grantResources({ parts: 20 }));
  await page.evaluate(() => window.__game.advanceGameSeconds(40)); // build 32s on mare
  const s2 = await page.evaluate(() => window.__game.getState());
  expect(s2.buildings.find((b: any) => b.type === 'solar').construction).toBe(0);
  expect(s2.resources.parts).toBeLessThan(20); // welding consumed some
});

test('construction sites draw power at their own priority; a dark site is never a brownout', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  // no solar: the lander's 6 kW carries one 6 kW excavator OR one 4 kW site
  expect(await page.evaluate(() => window.__game.placeBuilding('excavator', 120, 126))).toBe(true);
  await page.evaluate(() => window.__game.advanceGameSeconds(50)); // built at 48s
  expect(await page.evaluate(() => window.__game.placeBuilding('habitat', 132, 126))).toBe(true);
  const run = (secs: number, prios: [string, number][] = []) => page.evaluate(([n, ps]) => {
    const g = window.__game!;
    const find = (t: string) => g.getState().buildings.find((b: any) => b.type === t);
    for (const [t, p] of ps) g.setPriority(find(t).id, p);
    // settle every hold with a full bank, then empty it and read the triage
    g.grantPower(1000);
    g.advanceGameSeconds(10);
    g.grantPower(-g.getState().powerStored);
    g.advanceGameSeconds(n);
    return g.getState();
  }, [secs, prios] as const);
  const by = (s: any, t: string) => s.buildings.find((b: any) => b.type === t);
  // the habitat site welds at the habitat's priority 0, ahead of priority-2 industry
  const first = await run(2);
  expect(by(first, 'habitat').construction).toBeGreaterThan(0);
  expect(by(first, 'habitat').idleReason).toBe('building');
  expect(by(first, 'excavator').idleReason).toBe('power');
  expect(first.power.shed).toBe(true);
  expect(first.power.brownout).toBe(false);
  // the player's priority governs the site: at 3 it idles before the excavator
  const demoted = await run(2, [['habitat', 3]]);
  expect(by(demoted, 'habitat').idleReason).toBe('power');
  expect(by(demoted, 'excavator').idleReason).toBe('');
  // a critical-priority site held dark is shed load, not a life-support brownout
  const critical = await run(2, [['habitat', 1], ['excavator', 0]]);
  expect(by(critical, 'habitat').idleReason).toBe('power');
  expect(critical.power.brownout).toBe(false);
  expect(critical.power.shed).toBe(true);
});

test('robot queue: Build next jumps the line, a paused site frees its robot, demolish refunds what was paid', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  // three sites, two robots: the excavator waits its turn
  expect(await page.evaluate(() => window.__game.placeBuilding('solar', 132, 126))).toBe(true);
  expect(await page.evaluate(() => window.__game.placeBuilding('solar', 132, 130))).toBe(true);
  expect(await page.evaluate(() => window.__game.placeBuilding('excavator', 120, 126))).toBe(true);
  const q = await page.evaluate(() => {
    const g = window.__game!;
    const ids = g.getState().buildings.filter((b: any) => b.type !== 'lander').map((b: any) => b.id);
    const reasons = () => {
      const s = g.getState();
      return ids.map((id: number) => s.buildings.find((b: any) => b.id === id).idleReason);
    };
    g.advanceGameSeconds(1);
    const placed = reasons();
    // Build next: the excavator takes the robot of the last site in line
    g.buildNext(ids[2]);
    g.advanceGameSeconds(1);
    const jumped = reasons();
    // pausing the first solar hands its robot down the queue; its progress holds
    g.setEnabled(ids[0], false);
    g.advanceGameSeconds(1);
    const held = g.getState().buildings.find((b: any) => b.id === ids[0]).construction;
    g.advanceGameSeconds(5);
    const paused = reasons();
    const s = g.getState();
    const heldAfter = s.buildings.find((b: any) => b.id === ids[0]).construction;
    g.setEnabled(ids[0], true);
    g.advanceGameSeconds(1);
    return { ids, placed, jumped, paused, held, heldAfter, busy: s.bots.busy, resumed: reasons() };
  });
  expect(q.placed).toEqual(['building', 'building', 'queued']);
  expect(q.jumped).toEqual(['building', 'queued', 'building']);
  expect(q.paused).toEqual(['off', 'building', 'building']);
  expect(q.heldAfter).toBe(q.held);
  expect(q.busy).toBe(2);
  expect(q.resumed).toEqual(['building', 'queued', 'building']); // it keeps its place in line

  // the inspector offers Build next on a queued site and pauses a site in place
  await page.evaluate((id) => window.__game.select(id), q.ids[1]);
  await expect(page.locator('#insp-buildnext')).toBeVisible();
  await expect(page.locator('#insp-demolish')).toContainText('Demolish'); // it has been welded on
  await page.locator('#insp-toggle').click();
  await expect(page.locator('#inspector')).toContainText('CONSTRUCTION PAUSED — shut down');
  await expect(page.locator('#insp-toggle')).toHaveText('Resume');

  // demolish returns what the site actually cost on the mare (×0.8): all of it
  // for a site no robot has touched, half of it once welding has begun
  expect(await page.evaluate(() => window.__game.placeBuilding('lab', 135, 133))).toBe(true);
  const refunds = await page.evaluate((excavatorId) => {
    const g = window.__game!;
    const lab = g.getState().buildings.find((b: any) => b.type === 'lab');
    const r0 = g.getState().resources;
    g.demolish(lab.id);
    g.advanceGameSeconds(0);
    const r1 = g.getState().resources;
    g.demolish(excavatorId);
    g.advanceGameSeconds(0);
    const r2 = g.getState().resources;
    return {
      untouched: { metals: r1.metals - r0.metals, parts: r1.parts - r0.parts },
      started: { metals: r2.metals - r1.metals, parts: r2.parts - r1.parts },
    };
  }, q.ids[2]);
  // (parts carry fractional welding draw, so compare those to a tolerance)
  expect(refunds.untouched.metals).toBe(24); // lab: 30◆ 10⚙ × 0.8
  expect(refunds.untouched.parts).toBeCloseTo(8, 6);
  expect(refunds.started.metals).toBe(8);    // excavator: ½ of 16◆ 4⚙
  expect(refunds.started.parts).toBeCloseTo(2, 6);
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

test('placement warns before metals for the first smelter run out', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=southpole`);
  await game(page);
  // 77 metals on the pole (×1.25): a 38◆ lab leaves 39, short of the 50◆ smelter
  await page.evaluate(() => {
    const g = window.__game!;
    g.setPaused(true);
    g.advanceGameSeconds(0);
    g.grantResources({ metals: 77 - g.getState().resources.metals });
  });
  const lab = await page.evaluate(() => window.__game.canPlace('lab', 132, 126));
  expect(lab.valid).toBe(true); // a warning, never a block
  expect(lab.warn).toBe('Leaves 39◆ — a Smelter needs 50◆');
  const solar = await page.evaluate(() => window.__game.canPlace('solar', 132, 126));
  expect(solar.warn).toBe(''); // 19◆ leaves 58: room for the smelter
  // the ghost's hint carries it
  await page.locator('#palette .cats .btn', { hasText: 'Science' }).click();
  await page.locator('.bld-btn', { hasText: 'Research Lab' }).click();
  // aim at the pad canPlace just approved: a 2×2 lab at cell (132, 126) is
  // centred on world (20, −4), whatever the start camera is
  const pad = await page.evaluate(() => window.__game.screenOf(20, -4));
  expect(pad.visible).toBe(true);
  await page.mouse.move(pad.x, pad.y);
  await expect(page.locator('#place-hint')).toContainText('Leaves 39◆ — a Smelter needs 50◆');
  await page.keyboard.press('Escape');
  // once a smelter stands (even as a site), spending metals is no longer a trap
  await page.evaluate(() => {
    window.__game.completeTech('regolithProcessing');
    window.__game.grantResources({ metals: 50 });
  });
  const smelterPlaced = await page.evaluate(() => {
    const g = window.__game!;
    for (let gx = 116; gx <= 138; gx += 2) {
      for (let gz = 116; gz <= 138; gz += 2) {
        if (g.canPlace('smelter', gx, gz).valid) return g.placeBuilding('smelter', gx, gz);
      }
    }
    return false;
  });
  expect(smelterPlaced).toBe(true);
  const after = await page.evaluate(() => window.__game.canPlace('lab', 132, 126));
  expect(after.valid).toBe(true);
  expect(after.warn).toBe('');
});

test('metal deadlock triggers an Earth resupply a full day out', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  // burn the metals with no smelter anywhere → stranded (leave 10 of the
  // site-scaled cache: 140 × 0.8 on the mare)
  await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ metals: 10 - g.getState().resources.metals });
  });
  await page.evaluate(() => window.__game.advanceGameSeconds(2));
  const s = await page.evaluate(() => window.__game.getState());
  expect(s.resupply.pending).toBe(true);
  expect(s.alerts.some((a: any) => a.text.includes('STRANDED'))).toBe(true);
  // a lunar day later the shipment lands
  await page.evaluate(() => window.__game.advanceGameMinutes(12.2));
  const s2 = await page.evaluate(() => window.__game.getState());
  expect(s2.resupply.pending).toBe(false);
  expect(s2.resupply.shipments).toBe(1);
  expect(s2.resources.metals).toBeGreaterThanOrEqual(60);
  // the rescue is free: it does not lengthen the next hand-placed order
  await page.evaluate((id) => window.__game.select(id), s2.buildings[0].id);
  await expect(page.locator('#insp-order')).toContainText('arrives in 1 day');
});

test('Earth shipments ordered by hand wait longer each time and cost morale whenever anyone is aboard', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  const order = () => page.evaluate(() => {
    const g = window.__game!;
    const before = g.getState();
    g.orderResupply();
    g.advanceGameSeconds(0);
    const after = g.getState();
    return {
      transit: after.resupply.arriveAt - after.simTime,
      moraleLost: before.morale - after.morale,
      alert: after.alerts[after.alerts.length - 1].text,
    };
  });
  const lander = await page.evaluate(() => window.__game.getState().buildings[0].id);
  await page.evaluate((id) => window.__game.select(id), lander);
  await expect(page.locator('#insp-order')).toContainText('arrives in 1 day');
  await expect(page.locator('#inspector')).toContainText('morale −5');
  const first = await order();
  expect(first.transit).toBeCloseTo(720, 3);
  expect(first.moraleLost).toBeCloseTo(5, 6);
  expect(first.alert).toContain('arrival in 1 lunar day');
  await page.evaluate(() => window.__game.advanceGameSeconds(721));
  await expect(page.locator('#insp-order')).toContainText('arrives in 2 days');
  const second = await order();
  expect(second.transit).toBeCloseTo(1440, 3);
  expect(second.alert).toContain('arrival in 2 lunar days');

  // robots mind nothing — but settlers on a robotic base resent it like anyone
  await page.goto(`${URL_DEBUG}&site=mare&exp=robotic`);
  await game(page);
  const lander2 = await page.evaluate(() => window.__game.getState().buildings[0].id);
  await page.evaluate((id) => window.__game.select(id), lander2);
  await expect(page.locator('#insp-order')).toBeVisible();
  await expect(page.locator('#inspector')).not.toContainText('morale −5');
  const unmanned = await order();
  expect(unmanned.moraleLost).toBe(0);
  await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('humanCohabitation');
    g.grantCrew(2);
    g.advanceGameSeconds(721);
  });
  await expect(page.locator('#inspector')).toContainText('morale −5');
  const crewed = await order();
  expect(crewed.moraleLost).toBeCloseTo(5, 6);
  expect(crewed.transit).toBeCloseTo(1440, 3);
});

test('parts loop: an honest robotic run never softlocks on parts, no shipment button needed', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare&exp=robotic`);
  await game(page);
  // a greedy opening that burns the spares cache before the fab is researched;
  // only placements and research — no grants, no completeTech, no orderResupply
  const run = await page.evaluate(() => {
    const g = window.__game!;
    const plan: [string, number, number][] = [
      ['solar', 132, 126], ['solar', 132, 130], ['lab', 135, 133], ['excavator', 120, 126],
      ['smelter', 120, 132], ['solar', 136, 126], ['lab', 126, 138], ['solar', 136, 130],
      ['excavator', 116, 126], ['lab', 116, 132], ['solar', 140, 126], ['partsFab', 138, 128],
    ];
    const research = ['regolithProcessing', 'teleoperation', 'siliconRefining', 'partsFabrication'];
    let dryWithoutRemedy = 0;
    let wentDry = false;
    let partsStranded = false;
    let fabOnlineMin = -1;
    for (let step = 0; step < 120; step++) { // 30 s steps: one game-hour
      const s = g.getState();
      for (const r of research) if (!s.techsDone.includes(r)) g.research(r);
      const next = plan[0];
      if (next && g.canPlace(next[0], next[1], next[2]).valid) {
        g.placeBuilding(next[0], next[1], next[2]);
        plan.shift();
      }
      g.advanceGameSeconds(30);
      const s2 = g.getState();
      const fab = s2.buildings.some((b: any) => b.type === 'partsFab' && b.construction <= 0);
      if (fab && fabOnlineMin < 0) fabOnlineMin = s2.simTime / 60;
      if (s2.alerts.some((a: any) => a.text.startsWith('STRANDED — spare parts'))) partsStranded = true;
      if (s2.resources.parts < 1) {
        wentDry = true;
        if (!fab && !s2.resupply.pending) dryWithoutRemedy++;
      }
    }
    return { dryWithoutRemedy, wentDry, partsStranded, fabOnlineMin, planLeft: plan.length, end: g.getState() };
  });
  expect(run.wentDry).toBe(true); // the greedy opening really does run the cache dry...
  expect(run.dryWithoutRemedy).toBe(0); // ...but Earth is always already on the way
  expect(run.end.resupply.shipments).toBeGreaterThanOrEqual(1);
  expect(run.partsStranded).toBe(true); // launched by the parts trigger, not the metals one
  // the loop closes: the fabricator stands, everything planned got built
  expect(run.planLeft).toBe(0);
  expect(run.fabOnlineMin).toBeGreaterThan(0);
  expect(run.fabOnlineMin).toBeLessThan(50);
  expect(run.end.buildings.every((b: any) => b.construction <= 0)).toBe(true);
  expect(run.end.resources.parts).toBeGreaterThan(20);
  expect(Math.max(...run.end.buildings.map((b: any) => b.wear))).toBeLessThan(0.1);
});

test('low reserves breed anxiety; losing the crew ends the game', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  // drain life support: anxiety first, then starvation, then silence
  await page.evaluate(() => window.__game.grantResources({ oxygen: -1000, food: -1000 }));
  await page.evaluate(() => window.__game.advanceGameSeconds(3));
  const s = await page.evaluate(() => window.__game.getState());
  expect(s.alerts.some((a: any) => a.text.includes('RESERVES LOW') || a.text.includes('DEPLETED'))).toBe(true);
  await page.evaluate(() => window.__game.advanceGameMinutes(6));
  const s2 = await page.evaluate(() => window.__game.getState());
  expect(s2.crew).toBe(0);
  expect(s2.defeatShown).toBe(true);
  await expect(page.locator('#defeat-screen')).toBeVisible();
  await expect(page.locator('#defeat-screen')).toContainText('THE BASE FALLS SILENT');

  // the loss is final: no unpausing, no settlers wandering into a dead base
  await page.evaluate(() => window.__game.grantResources({ oxygen: 500, food: 500, water: 300 }));
  await page.evaluate(() => window.__game.setPaused(false));
  await page.evaluate(() => window.__game.advanceGameMinutes(15)); // > one settler period
  const s3 = await page.evaluate(() => window.__game.getState());
  expect(s3.paused).toBe(true);
  expect(s3.simTime).toBe(s2.simTime); // even a debug fast-forward leaves the clock stopped
  expect(s3.crew).toBe(0);
  expect(s3.alerts.some((a: any) => a.text.startsWith('ARRIVAL'))).toBe(false);
  // ...and no second life from the save: the title shows the lost mission
  await page.evaluate(() => window.__game.save()); // refused for a lost base
  await page.waitForTimeout(300);
  await page.goto(URL_DEBUG);
  await expect(page.locator('#lost-mission')).toBeVisible();
  await expect(page.locator('#lost-mission')).toContainText('Mission lost');
  await expect(page.locator('#btn-continue')).toHaveCount(0);
});

test('life support first: a farm never drinks the crew dry', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  await page.evaluate(() => window.__game.completeTech('hydroponicFarming'));
  expect(await page.evaluate(() => window.__game.placeBuilding('solar', 132, 126))).toBe(true);
  expect(await page.evaluate(() => window.__game.placeBuilding('hydroponics', 120, 126))).toBe(true);
  await page.evaluate(() => window.__game.advanceGameSeconds(80)); // farm built at 72s
  // leave the crew just their five-minute reserve (4 × 0.005/s × 300 s = 6)
  const held = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ water: 6.05 - g.getState().resources.water });
    g.advanceGameSeconds(2);
    return g.getState();
  });
  expect(held.buildings.find((b: any) => b.type === 'hydroponics').idleReason).toBe('reserve');
  expect(held.resources.water).toBeGreaterThan(5.9); // only the crew drank

  // the standard opening that used to die of thirst inside ten minutes
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  await page.evaluate(() => window.__game.completeTech('hydroponicFarming'));
  await page.evaluate(() => window.__game.completeTech('regolithProcessing'));
  for (const spot of [['solar', 132, 126], ['solar', 132, 130], ['solar', 136, 126],
    ['excavator', 120, 126], ['smelter', 120, 132], ['hydroponics', 116, 126]]) {
    expect(await page.evaluate(([t, x, z]) => window.__game.placeBuilding(t, x, z), spot)).toBe(true);
  }
  for (let m = 0; m < 25; m++) {
    await page.evaluate(() => window.__game.advanceGameMinutes(1));
    const s = await page.evaluate(() => window.__game.getState());
    expect(s.crew).toBeGreaterThanOrEqual(4);
    expect(s.alerts.some((a: any) => a.text.includes('WATER DEPLETED'))).toBe(false);
  }
  const end = await page.evaluate(() => window.__game.getState());
  expect(end.nightsSurvived).toBeGreaterThanOrEqual(1);
  expect(end.resources.food).toBeGreaterThan(120); // and the farm still fed them
});

test('net rates are the economy\'s smoothed flow; housing counts only powered beds', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  expect(await page.evaluate(() => window.__game.placeBuilding('solar', 132, 126))).toBe(true);
  expect(await page.evaluate(() => window.__game.placeBuilding('excavator', 120, 126))).toBe(true);
  const flow = await page.evaluate(() => {
    const g = window.__game!;
    g.advanceGameSeconds(110); // excavator digging since 48s; the average has settled
    const s1 = g.getState();
    g.advanceGameSeconds(30);
    const s2 = g.getState();
    g.advanceGameSeconds(20); // however far a probe skips, the rate stays per game-second
    const s3 = g.getState();
    return {
      r2: s2.rates.regolith, r3: s3.rates.regolith, regolith: s3.resources.regolith,
      measured: (s2.resources.regolith - s1.resources.regolith) / 30,
    };
  });
  expect(flow.regolith).toBeLessThan(290); // below the yard cap: nothing spilled
  expect(flow.r2).toBeGreaterThan(0.5);
  expect(Math.abs(flow.r2 - flow.measured)).toBeLessThan(0.05 * flow.measured);
  expect(Math.abs(flow.r3 - flow.r2)).toBeLessThan(0.05 * flow.r2);

  // paying for a building is not a flow: paused, a habitat's price leaves the
  // metals panel at net 0/min (no smelter, nothing makes or burns metals)
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
  expect(await page.evaluate(() => window.__game.placeBuilding('habitat', 132, 130))).toBe(true);
  await page.locator('#resource-strip .chip[data-key="metals"]').click();
  await expect(page.locator('#res-panel')).toContainText('net 0/min');
  await page.locator('#res-panel-close').click();

  // housing: the HUD counts the beds the economy counts
  const crewChip = page.locator('#resource-strip .chip[data-key="crew"]');
  await expect(crewChip.locator('.cap')).toHaveText('/8'); // habitat still a site
  await page.evaluate(() => { window.__game.setPaused(false); window.__game.advanceGameSeconds(80); });
  await expect(crewChip.locator('.cap')).toHaveText('/12');
  await expect(crewChip).toHaveAttribute('title', /12 beds built · 12 powered/);
  const off = await page.evaluate(() => {
    const g = window.__game!;
    g.setEnabled(g.getState().buildings.find((b: any) => b.type === 'habitat').id, false);
    g.advanceGameSeconds(1);
    return g.getState();
  });
  expect(off.housingActive).toBe(8);
  await expect(crewChip.locator('.cap')).toHaveText('/8');
  await expect(crewChip).toHaveAttribute('title', /12 beds built · 8 powered/);
});

test('HUD: chip and inspector clicks register at 10× while the economy ticks', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  expect(await page.evaluate(() => window.__game.placeBuilding('solar', 132, 126))).toBe(true);
  expect(await page.evaluate(() => window.__game.placeBuilding('excavator', 120, 126))).toBe(true);
  // count every time the strip or the inspector is rebuilt
  await page.evaluate(() => {
    const w = window as any;
    w.__rebuilds = { strip: 0, insp: 0 };
    new MutationObserver(() => { w.__rebuilds.strip++; })
      .observe(document.querySelector('#resource-strip')!, { childList: true });
    new MutationObserver(() => { w.__rebuilds.insp++; })
      .observe(document.querySelector('#inspector')!, { childList: true });
    window.__game.setSpeed(10);
  });
  const t0 = await page.evaluate(() => window.__game.getState().simTime);
  const chip = page.locator('#resource-strip .chip[data-key="metals"]');
  const panel = page.locator('#res-panel');
  for (let i = 0; i < 6; i++) {
    await chip.click({ delay: 250 }); // each press spans economy ticks at 10×
    if (i % 2 === 0) await expect(panel).toBeVisible();
    else await expect(panel).toBeHidden();
  }
  const ticked = await page.evaluate(() => window.__game.getState());
  expect(ticked.simTime - t0).toBeGreaterThan(10); // the game really ran under the clicks
  expect(await page.evaluate(() => (window as any).__rebuilds.strip)).toBe(0);

  // a long construction site's inspector updates its progress in place
  const site = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('thoriumPower');
    g.grantResources({ metals: 300, parts: 100 });
    g.placeBuilding('reactor', 132, 130);
    return g.getState().buildings.find((b: any) => b.type === 'reactor');
  });
  expect(site.construction).toBeGreaterThan(100);
  await page.evaluate((id) => window.__game.select(id), site.id);
  await expect(page.locator('#insp-status')).toContainText(/UNDER CONSTRUCTION — \d+%/);
  const built = await page.evaluate(() => (window as any).__rebuilds.insp);
  const status0 = await page.locator('#insp-status').textContent();
  await expect(page.locator('#insp-status')).not.toHaveText(status0!); // progress moved...
  expect(await page.evaluate(() => (window as any).__rebuilds.insp)).toBe(built); // ...in place
  await page.locator('#insp-toggle').click({ delay: 250 });
  await expect(page.locator('#insp-toggle')).toHaveText('Resume');
  await expect.poll(async () => (await page.evaluate(() => window.__game.getState()))
    .buildings.find((b: any) => b.id === site.id).enabled).toBe(false);
  await page.evaluate(() => window.__game.setSpeed(1));
});

test('alerts: conditions clear and snooze, events merge and fade, a click opens what it is about', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  // no parts to weld with: construction stalls — a live condition
  const s1 = await page.evaluate(() => {
    const g = window.__game!;
    g.setPaused(true);
    g.grantResources({ parts: -70 });
    g.placeBuilding('solar', 132, 126);
    g.advanceGameSeconds(3);
    return g.getState();
  });
  const stalled = s1.alerts.filter((a: any) => a.key === 'stalled');
  expect(stalled).toHaveLength(1);
  expect(stalled[0].cond).toBe(true);
  expect(stalled[0].text).toBe('CONSTRUCTION STALLED — no parts for welding');
  // clicking it opens the parts panel
  const row = page.locator('#alerts .alert', { hasText: 'CONSTRUCTION STALLED' });
  await row.locator('.alert-text').click();
  await expect(page.locator('#res-panel')).toContainText('Parts');
  // dismissing snoozes it: it does not return the next tick...
  await row.locator('.alert-x').click();
  await expect(row).toHaveCount(0);
  const snoozed = await page.evaluate(() => { const g = window.__game!; g.advanceGameSeconds(10); return g.getState(); });
  expect(snoozed.alerts.some((a: any) => a.key === 'stalled')).toBe(false);
  expect(snoozed.alertSnooze.stalled).toBeGreaterThan(snoozed.simTime);
  // ...but after the snooze, a condition that still holds is back
  const back = await page.evaluate(() => { const g = window.__game!; g.advanceGameSeconds(120); return g.getState(); });
  expect(back.alerts.some((a: any) => a.key === 'stalled')).toBe(true);
  // resolved: gone within a few ticks, no dismissal needed
  const resolved = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ parts: 60 });
    g.advanceGameSeconds(4);
    return g.getState();
  });
  expect(resolved.alerts.some((a: any) => a.key === 'stalled' || a.key === 'parts')).toBe(false);

  // a repeated event merges into one line with a count
  const merged = await page.evaluate(() => {
    const g = window.__game!;
    g.orderResupply(); // Earth's rescue is already under way
    g.orderResupply();
    g.advanceGameSeconds(0);
    return g.getState();
  });
  const repeats = merged.alerts.filter((a: any) => a.text.startsWith('SHIPMENT ALREADY EN ROUTE'));
  expect(repeats).toHaveLength(1);
  expect(repeats[0].count).toBe(2);
  await expect(page.locator('#alerts .alert', { hasText: 'SHIPMENT ALREADY EN ROUTE' }).locator('.alert-n'))
    .toHaveText('×2');
  // info events fade in real time, whatever the game clock does
  await expect.poll(async () => (await page.evaluate(() => window.__game.getState()))
    .alerts.some((a: any) => a.text.startsWith('TOUCHDOWN')), { timeout: 40_000 }).toBe(false);

  // a save from before keyed alerts loads: old lines become fading events
  // (rewritten on the title screen, after the old page's unload save)
  await page.evaluate(() => window.__game.save());
  await page.goto(URL_DEBUG);
  await expect(page.locator('#btn-continue')).toBeVisible();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('keyval-store');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = db.transaction('keyval', 'readwrite');
    const store = tx.objectStore('keyval');
    const blob = await new Promise<any>((res) => {
      const r = store.get('mbb-save-v1');
      r.onsuccess = () => res(r.result);
    });
    blob.state.alerts = [{ id: 900, text: 'BROWNOUT — night demand exceeds stored power', kind: 'crit', at: 100 }];
    delete blob.state.alertSnooze;
    store.put(blob, 'mbb-save-v1');
    await new Promise((res) => { tx.oncomplete = res; });
  });
  await page.locator('#btn-continue').click();
  await game(page);
  const loaded = await page.evaluate(() => window.__game.getState());
  const old = loaded.alerts.find((a: any) => a.id === 900);
  expect(old).toMatchObject({ key: 'BROWNOUT — night demand exceeds stored power', kind: 'warn', count: 1 });
  expect(old.cond).toBeUndefined();
  expect(loaded.alertSnooze).toEqual({});
});

for (const vp of [{ width: 1366, height: 768 }, { width: 1600, height: 900 }]) {
  test(`layout ${vp.width}×${vp.height}: inspector, resource panel and placement hint overlap nothing`, async ({ page }) => {
    await page.setViewportSize(vp);
    // the human pole shows the most chips; late stockpiles and a full alert stack on top
    await page.goto(`${URL_DEBUG}&site=southpole`);
    await game(page);
    await page.evaluate(() => {
      const g = window.__game!;
      g.setPaused(true);
      g.grantResources({ chips: 1, foils: 1, launch: 1, oxygen: -110, water: -45, parts: -70 });
      g.placeBuilding('solar', 132, 126);
      g.advanceGameSeconds(3);
      g.select(g.getState().buildings[0].id); // the Lander: the tallest inspector
    });
    await page.locator('#resource-strip .chip[data-key="parts"]').click();
    await expect(page.locator('#res-panel')).toBeVisible();
    await expect(page.locator('#inspector')).toBeVisible();
    await expect(page.locator('#alerts .alert')).toHaveCount(4);
    type Box = { x: number; y: number; width: number; height: number };
    const box = async (sel: string) => (await page.locator(sel).boundingBox()) as Box;
    const overlap = (a: Box, b: Box) =>
      Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
      Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    const insp = await box('#inspector');
    expect(overlap(insp, await box('#time-controls'))).toBe(0);
    expect(insp.y + insp.height).toBeLessThanOrEqual(vp.height);
    const res = await box('#res-panel');
    expect(overlap(res, await box('#resource-strip'))).toBe(0);
    expect(overlap(res, await box('#milestones'))).toBe(0);
    // the placement hint sits in the palette column, above the cards
    await page.keyboard.press('Escape');
    await page.locator('.bld-btn', { hasText: 'Solar Array' }).click();
    await page.mouse.move(vp.width / 2 + 120, vp.height / 2);
    await expect(page.locator('#place-hint')).toBeVisible();
    expect(overlap(await box('#place-hint'), await box('#palette .items'))).toBe(0);
    await page.screenshot({ path: `test-results/08-layout-${vp.width}.png` });
  });
}

test('night: the clock counts to dusk, a warning names the runway, the bank chip counts it down', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare&exp=robotic`);
  await game(page);
  await page.evaluate(() => window.__game.completeTech('regolithProcessing'));
  for (const [t, x, z] of [['solar', 132, 126], ['solar', 132, 130], ['lab', 135, 133],
    ['excavator', 120, 126], ['smelter', 120, 132]] as const) {
    expect(await page.evaluate(([tt, xx, zz]) => window.__game.placeBuilding(tt, xx, zz), [t, x, z] as const)).toBe(true);
  }
  const clock = page.locator('#time-controls .clock');
  const dusk = await page.evaluate(() => {
    const g = window.__game!;
    g.setPaused(true);
    g.advanceGameSeconds(480 - 50 - g.getState().simTime); // 50 s before nightfall
    return g.getState();
  });
  await expect(clock).toContainText(/☀ 0:\d\d TO DUSK/);
  const warning = dusk.alerts.find((a: any) => a.key === 'dusk');
  expect(warning.cond).toBe(true);
  expect(warning.kind).toBe('warn'); // this bank does not last the night
  expect(warning.text).toMatch(/^NIGHTFALL IN \d+ s — \d+ stored lasts ~\d+:\d\d of the 4:00 night at \d+ kW short/);
  // the power chip: generation over what the loads request
  await expect(page.locator('.chip[data-slot="power"] .val')).toHaveText(/^\+\d+(\.\d)?$/);
  await expect(page.locator('.chip[data-slot="power"] .cap')).toHaveText(/^\/\d+(\.\d)? kW$/);
  const night = await page.evaluate(() => { const g = window.__game!; g.advanceGameSeconds(60); return g.getState(); });
  expect(night.alerts.some((a: any) => a.key === 'dusk')).toBe(false); // over once night falls
  await expect(clock).toContainText(/☾ \d:\d\d TO DAWN/);
  // at night the bank chip shows how long it lasts, and warns: not till dawn
  const stored = page.locator('.chip[data-slot="stored"]');
  await expect(stored.locator('.cap')).toHaveText(/^· \d+:\d\d$/);
  await expect(stored).toHaveClass(/warn/);
});

test('info panels: live values, life support in seconds, shipments and construction, time to empty', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  // water warns on seconds of supply: four crew drink 6 in five minutes
  const water = page.locator('#resource-strip .chip[data-key="water"]');
  await expect(water).not.toHaveClass(/warn/);
  await page.evaluate(() => {
    const g = window.__game!;
    g.setPaused(true);
    g.grantResources({ water: 5 - g.getState().resources.water });
    g.advanceGameSeconds(30);
  });
  await expect(water).toHaveClass(/warn/);
  await water.click();
  const panel = page.locator('#res-panel');
  await expect(panel).toContainText('Crew ×4');
  await expect(panel).toContainText(/empties in \d+:\d\d/);
  await expect(panel.locator('.row', { hasText: 'Ice Harvester' })).toHaveCount(0); // no ice on the mare
  await expect(panel).toContainText('No ice at this site');
  // metals: construction and the Earth shipment are part of the picture
  await page.locator('#resource-strip .chip[data-key="metals"]').click();
  await expect(panel).toContainText('Earth shipment');
  await expect(panel).toContainText('order at the Lander, 1 day');
  await expect(panel).toContainText('Construction');
  // data: labs and data centers both, following the live value
  await page.locator('#resource-strip .chip[data-key="data"]').click();
  await expect(panel).toContainText('Research Lab');
  await expect(panel).toContainText('Data Center');
  await page.evaluate(() => window.__game.grantData(100));
  await expect(panel.locator('.tt-name')).toContainText('100');
  await page.evaluate(() => window.__game.grantData(400));
  await expect(panel.locator('.tt-name')).toContainText('500');
  // the crew panel lists water among what each settler consumes
  await page.locator('#resource-strip .chip[data-key="crew"]').click();
  await expect(panel).toContainText('Water');
  await panel.locator('#res-panel-close').click();
  await expect(panel).toBeHidden();
});

test('robotic mission copy: landing, objectives, perimeter, launch reasons, T under walk mode', async ({ page }) => {
  await page.goto(URL_DEBUG);
  await page.locator('.site-card', { hasText: 'ILMENITE' }).click();
  await page.locator('#btn-land').click();
  await page.locator('.site-card', { hasText: 'ROBOTIC MISSION' }).click();
  // the Land button shows the descent at once and takes no second click
  const land = page.locator('#btn-launch-exp');
  await land.dblclick();
  await expect(land).toBeDisabled();
  await expect(land).toHaveText('DESCENDING…');
  await game(page);
  await expect(page.locator('#resource-strip')).toBeVisible();
  const s0 = await page.evaluate(() => window.__game.getState());
  expect(s0.expedition).toBe('robotic');
  expect(s0.buildings).toHaveLength(1);
  // objectives speak to a crewless base, and acknowledge progress
  await page.locator('#milestones').click();
  await expect(page.locator('#milestones')).toContainText('Field a fleet of 6 construction robots');
  await expect(page.locator('#milestones')).not.toContainText('crew breathing');
  await page.locator('#milestones').click();
  expect(await page.evaluate(() => window.__game.placeBuilding('solar', 132, 126))).toBe(true);
  await expect(page.locator('#milestones .goal-progress')).toContainText(/◻ Solar Array \d+%/);
  // the perimeter is measured from the Lander — robots have no habitats
  const far = await page.evaluate(() => {
    for (let gx = 150; gx < 250; gx += 4) {
      const r = window.__game.canPlace('solar', gx, 126).reason;
      if (r.startsWith('Beyond')) return r;
    }
    return 'no spot';
  });
  expect(far).toBe('Beyond 60 m of the Lander');
  // the launch row says what a volley still lacks
  await page.evaluate(() => window.__game.completeTech('swarmProtocol'));
  await expect(page.locator('#launch-cost')).toContainText('foils 0/10 ✗');
  await expect(page.locator('#launch-cost')).toContainText('launch 0/1 ✗');
  await expect(page.locator('#launch-cost')).toContainText('stored 400/400 ✓');
  await expect(page.locator('#btn-launch')).toHaveAttribute('title', 'Needs 10 more foils, 1 more launch capacity');
  // T is a command-view key: under walk mode's pointer lock the tree stays shut
  await page.evaluate(() => window.__game.setMode('walk'));
  await page.keyboard.press('KeyT');
  await expect(page.locator('#tech-screen')).toBeHidden();
  await page.evaluate(() => window.__game.setMode('build'));
  await page.keyboard.press('KeyT');
  await expect(page.locator('#tech-screen')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#tech-screen')).toBeHidden();
});

test('storage caps clamp stockpiles; Storage Yard raises them', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  await page.evaluate(() => window.__game.grantResources({ regolith: 1000 }));
  await page.evaluate(() => window.__game.advanceGameSeconds(2));
  const s = await page.evaluate(() => window.__game.getState());
  expect(s.resources.regolith).toBeLessThanOrEqual(300); // lander base cap
  expect(s.alerts.some((a: any) => a.text.includes('STORAGE FULL'))).toBe(true);
  expect(await page.evaluate(() => window.__game.placeBuilding('storageYard', 132, 126))).toBe(true);
  await page.evaluate(() => window.__game.advanceGameSeconds(30)); // build 24s
  await page.evaluate(() => window.__game.grantResources({ regolith: 1000 }));
  await page.evaluate(() => window.__game.advanceGameSeconds(2));
  const s2 = await page.evaluate(() => window.__game.getState());
  expect(s2.resources.regolith).toBeGreaterThan(500);
  expect(s2.resources.regolith).toBeLessThanOrEqual(700); // lander + yard
});

test('full stockpiles: producers stand by, tanks cap, shipment overflow is reported', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  await page.evaluate(() => window.__game.completeTech('partsFabrication'));
  expect(await page.evaluate(() => window.__game.placeBuilding('solar', 132, 126))).toBe(true);
  expect(await page.evaluate(() => window.__game.placeBuilding('solar', 132, 130))).toBe(true);
  expect(await page.evaluate(() => window.__game.placeBuilding('partsFab', 138, 128))).toBe(true);
  await page.evaluate(() => window.__game.advanceGameSeconds(140)); // solars 32s, fab 96s after
  const running = await page.evaluate(() => window.__game.getState());
  const fab = (s: any) => s.buildings.find((b: any) => b.type === 'partsFab');
  expect(fab(running).active).toBe(true);
  expect(running.storageCaps.parts).toBe(200);
  // top the parts yard off: the fab stops eating metals instead of wasting them
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ parts: 200 - g.getState().resources.parts });
    g.advanceGameSeconds(1);
    const m0 = g.getState().resources.metals;
    g.advanceGameSeconds(20);
    return { s: g.getState(), metalsUsed: m0 - g.getState().resources.metals };
  });
  expect(fab(r.s).idleReason).toBe('full');
  expect(fab(r.s).active).toBe(false);
  expect(r.metalsUsed).toBeLessThan(0.7); // ≤ a couple of top-up ticks, not 20 s × 0.3
  expect(r.s.resources.parts).toBeLessThanOrEqual(200);
  // oxygen and water have tanks too — generous, and venting is routine
  expect(r.s.storageCaps.oxygen).toBe(600);
  expect(r.s.storageCaps.water).toBe(400);
  await page.evaluate(() => window.__game.grantResources({ oxygen: 1000 }));
  await page.evaluate(() => window.__game.advanceGameSeconds(1));
  const tank = await page.evaluate(() => window.__game.getState());
  expect(tank.resources.oxygen).toBeLessThanOrEqual(600);
  expect(tank.alerts.some((a: any) => a.text.startsWith('TANKS FULL'))).toBe(true);
  // an Earth shipment into a full yard says what it lost
  await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ metals: 300 - g.getState().resources.metals });
    g.orderResupply();
  });
  await page.evaluate(() => window.__game.advanceGameMinutes(12.2));
  const landed = await page.evaluate(() => window.__game.getState());
  expect(landed.resupply.shipments).toBe(1);
  expect(landed.resources.metals).toBeLessThanOrEqual(300);
  expect(landed.alerts.some((a: any) =>
    /^RESUPPLY LANDED .* \d+ metals.* lost to full storage$/.test(a.text) && a.kind === 'warn')).toBe(true);
});

test('ice survey gates harvesters and maps deposits', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=southpole`);
  await game(page);
  await page.evaluate(() => window.__game.completeTech('iceExtraction'));
  const s0 = await page.evaluate(() => window.__game.getState());
  expect(s0.resources.metals).toBe(175); // 140 × the pole's 1.25 build costs
  // deposit 0 is the guaranteed starter patch, inside the Lander's build radius
  const dep = await page.evaluate(() => window.__game.getIceDeposits()[0]);
  const fromLander = Math.hypot(dep.cx + 2, dep.cz + 2); // Lander centre sits at (−2, −2)
  expect(fromLander).toBeGreaterThanOrEqual(40);
  expect(fromLander).toBeLessThanOrEqual(55);
  const cell = { gx: Math.round((dep.cx + 512) / 4 - 1), gz: Math.round((dep.cz + 512) / 4 - 1) };
  // before the survey: placement blocked with the survey hint
  const pre = await page.evaluate((c) => window.__game.canPlace('iceHarvester', c.gx, c.gz), cell);
  expect(pre.reason).toContain('survey');
  // survey from the Lander costs stored energy
  const before = await page.evaluate(() => window.__game.getState());
  await page.evaluate(() => window.__game.surveyIce());
  await page.evaluate(() => window.__game.advanceGameSeconds(2));
  const after = await page.evaluate(() => window.__game.getState());
  expect(after.iceSurveyed).toBe(true);
  expect(after.powerStored).toBeLessThan(before.powerStored - 100);
  // on a deposit the ice rule passes (any remaining reason is range/terrain)
  const onIce = await page.evaluate((c) => window.__game.canPlace('iceHarvester', c.gx, c.gz), cell);
  expect(onIce.reason.toLowerCase()).not.toContain('ice');
  expect(onIce.reason.toLowerCase()).not.toContain('survey');
  expect(onIce.valid).toBe(true); // the starter patch takes a harvester with no habitat chain
  // off-deposit near the lander: blocked for the right reason
  const offIce = await page.evaluate(() => window.__game.canPlace('iceHarvester', 140, 126));
  expect(offIce.reason).toContain('No ice beneath');
});

test('fast-forwarding follows the sun: terrain shade comes and goes inside one advance', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=southpole`);
  await game(page);
  // at the pole's dawn the low sun drops this panel into a ridge's shadow
  expect(await page.evaluate(() => window.__game.placeBuilding('solar', 120, 126))).toBe(true);
  const trace = await page.evaluate(() => {
    const g = window.__game!;
    const panel = () => g.getState().buildings.find((b: any) => b.type === 'solar');
    const seen: boolean[] = [];
    while (g.getState().simTime < 800) {
      g.advanceGameSeconds(5);
      if (panel().construction <= 0) seen.push(!!panel().shaded);
    }
    return seen;
  });
  expect(trace.length).toBeGreaterThan(50);
  expect(trace.some((s) => s)).toBe(true);    // shaded at dawn...
  expect(trace[trace.length - 1]).toBe(false); // ...and back in the sun as it climbs
});

test('site grading: era-1 tech flattens rough terrain for construction', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=southpole`);
  await game(page);
  await page.evaluate(() => window.__game.completeTech('siteGrading'));
  // hunt the rugged south pole for a spot too rough to build on, close enough
  // to the lander that the grade tool can reach it (radius 60 m)
  const target = await page.evaluate(() => {
    const g = window.__game!;
    const buildings = g.getState().buildings;
    const lander = buildings[0];
    const lx = lander.gx + 1.5, lz = lander.gz + 1.5; // lander center, cells
    // the 4×4 grade rect must clear every structure (lander is 3×3)
    const rectClear = (gx: number, gz: number) => buildings.every(
      (b: any) => !(gx < b.gx + 3 && gx + 4 > b.gx && gz < b.gz + 3 && gz + 4 > b.gz),
    );
    let fallback: { gx: number; gz: number; rough: boolean } | null = null;
    for (let r = 4; r <= 12; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const gx = lander.gx + dx, gz = lander.gz + dz;
          const distM = Math.hypot(gx + 2 - lx, gz + 2 - lz) * 4;
          if (distM > 55 || !rectClear(gx, gz)) continue;
          const p = g.canPlace('solar', gx, gz);
          if (!p.valid && p.reason === 'Terrain too rough') return { gx, gz, rough: true };
          if (!fallback && p.valid) fallback = { gx, gz, rough: false };
        }
      }
    }
    return fallback;
  });
  expect(target).not.toBeNull();
  // advanceGameSeconds(0) applies the queued grade without an economy tick,
  // and one evaluate keeps the live frame loop from ticking in between — so
  // no recharge muddies the reading
  const { before, after } = await page.evaluate((t) => {
    const g = window.__game!;
    const before = g.getState();
    g.gradeAt(t.gx, t.gz);
    g.advanceGameSeconds(0);
    return { before, after: g.getState() };
  }, target!);
  // grading spends stored energy, banks the dozed spoil, and records the cut
  expect(after.flattens.length).toBe(before.flattens.length + 1);
  expect(after.powerStored).toBeCloseTo(before.powerStored - 40, 5);
  expect(after.resources.regolith).toBeGreaterThanOrEqual(before.resources.regolith + 5);
  // the once-blocked pad now takes a solar array
  const post = await page.evaluate(
    (t) => window.__game.canPlace('solar', t.gx + 1, t.gz + 1), target!,
  );
  expect(post.valid).toBe(true);
});

test('robotic expedition: unmanned stations, no life support, no defeat', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare&exp=robotic`);
  await game(page);
  const s0 = await page.evaluate(() => window.__game.getState());
  expect(s0.expedition).toBe('robotic');
  expect(s0.crew).toBe(0);
  // crewed stations run unmanned (lab needs 2 crew; there are none)
  expect(await page.evaluate(() => window.__game.placeBuilding('lab', 135, 133))).toBe(true);
  expect(await page.evaluate(() => window.__game.placeBuilding('solar', 132, 126))).toBe(true);
  await page.evaluate(() => window.__game.advanceGameSeconds(200)); // build 72s, then research staff-free
  const s1 = await page.evaluate(() => window.__game.getState());
  expect(s1.data).toBeGreaterThan(0);
  const lab = s1.buildings.find((b: any) => b.type === 'lab');
  expect(lab.active).toBe(true);
  // machines do not breathe: drain everything, nothing bad happens
  await page.evaluate(() => window.__game.grantResources({ oxygen: -1000, food: -1000, water: -1000 }));
  await page.evaluate(() => window.__game.advanceGameMinutes(5));
  const s2 = await page.evaluate(() => window.__game.getState());
  expect(s2.defeatShown).toBe(false);
  expect(s2.crew).toBe(0);
  expect(s2.morale).toBe(70); // machines hold steady
  expect(s2.alerts.some((a: any) => a.text.includes('RESERVES LOW'))).toBe(false);
  await expect(page.locator('#defeat-screen')).toBeHidden();
});

test('wear derates output linearly, heals on paid upkeep, and never touches the Lander', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare&exp=robotic`);
  await game(page);
  expect(await page.evaluate(() => window.__game.placeBuilding('lab', 135, 133))).toBe(true);
  await page.evaluate(() => window.__game.advanceGameSeconds(75)); // built at 72s
  // measure inside one evaluate so the live frame loop can't slip a tick in
  const r = await page.evaluate(() => {
    const g = window.__game!;
    const rate = () => { const a = g.getState().data; g.advanceGameSeconds(10); return (g.getState().data - a) / 10; };
    const fresh = rate();
    g.grantResources({ parts: -g.getState().resources.parts });
    g.advanceGameSeconds(360); // half a lunar day unpaid: +0.25 wear
    const worn = g.getState();
    const wornRate = rate();
    g.grantResources({ parts: 100 });
    g.advanceGameSeconds(360); // half a day paid: −0.2 wear
    return { fresh, worn, wornRate, healed: g.getState() };
  });
  const lab = (s: any) => s.buildings.find((b: any) => b.type === 'lab');
  const lander = (s: any) => s.buildings.find((b: any) => b.type === 'lander');
  expect(r.fresh).toBeCloseTo(0.3 * 0.75, 3); // agent-run lab, no wear
  expect(lab(r.worn).wear).toBeCloseTo(0.25, 2);
  // worn labs research slower in proportion — no cliff, no free pass
  expect(r.wornRate).toBeCloseTo(0.3 * 0.75 * (1 - 0.5 * 0.252), 3);
  expect(lander(r.worn).wear).toBe(0);
  expect(r.worn.power.supply).toBe(6); // the lifeboat keeps its full 6 kW at night
  expect(lab(r.healed).wear).toBeCloseTo(0.054, 2);
  // the dry cache names the remedy — and with no fabricator, Earth is already on it
  expect(r.worn.resupply.pending).toBe(true);
  expect(r.worn.alerts.some((a: any) => a.text.startsWith('PARTS DEPLETED') && a.text.includes('Lander'))).toBe(true);
});

test('chip fab and data center: silicon becomes chips becomes research', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  await page.evaluate(() => window.__game.completeTech('waferFab'));
  await page.evaluate(() => window.__game.completeTech('lunarDataCenter'));
  await page.evaluate(() => window.__game.grantResources({
    silicon: 100, parts: 100, chips: 15, metals: 300,
  }));
  // enough panels to feed an 18 kW fab and a 30 kW data center through the day
  for (const [gx, gz] of [[132, 126], [132, 130], [136, 126], [136, 130], [140, 126]]) {
    expect(await page.evaluate((c) => window.__game.placeBuilding('solar', c[0], c[1]), [gx, gz])).toBe(true);
  }
  expect(await page.evaluate(() => window.__game.placeBuilding('chipFab', 120, 126))).toBe(true);
  expect(await page.evaluate(() => window.__game.placeBuilding('dataCenter', 126, 138))).toBe(true);
  const d0 = await page.evaluate(() => window.__game.getState());
  await page.evaluate(() => window.__game.advanceGameMinutes(6)); // builds ~210s, then operation
  const d1 = await page.evaluate(() => window.__game.getState());
  expect(d1.resources.chips).toBeGreaterThan(d0.resources.chips); // fab converting silicon
  // there are no labs here: every point of data is the data center thinking
  expect(d1.data).toBeGreaterThan(25);
});

test('human cohabitation: robotic bases earn settlers late in the tree', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare&exp=robotic`);
  await game(page);
  // human-comfort research is locked to machines...
  await page.evaluate(() => window.__game.research('closedLoopLS'));
  await page.evaluate(() => window.__game.advanceGameSeconds(2));
  const s0 = await page.evaluate(() => window.__game.getState());
  expect(s0.researchQueue).toEqual([]);
  expect(s0.alerts.some((a: any) => a.text.startsWith('CREW TECH — Closed-Loop Life Support'))).toBe(true);
  // ...and so are housing and the farm
  expect(await page.evaluate(() => window.__game.placeBuilding('habitat', 132, 130))).toBe(false);
  expect(await page.evaluate(() => window.__game.placeBuilding('hydroponics', 120, 132))).toBe(false);
  // Human Cohabitation readies the base for partners
  await page.evaluate(() => window.__game.completeTech('humanCohabitation'));
  const r1 = await page.evaluate(() => window.__game.getResearch());
  expect(r1.cards.closedLoopLS.state).not.toBe('crewLocked');
  expect(await page.evaluate(() => window.__game.placeBuilding('habitat', 132, 130))).toBe(true);
  expect(await page.evaluate(() => window.__game.placeBuilding('hydroponics', 120, 132))).toBe(true);
  // with reserves stocked, the crew rotation boards 2 settlers after 240 s
  await page.evaluate(() => window.__game.grantResources({ oxygen: 100, food: 100, water: 50 }));
  await page.evaluate(() => window.__game.advanceGameSeconds(241));
  const s2 = await page.evaluate(() => window.__game.getState());
  expect(s2.crew).toBe(2);
  expect(s2.alerts.some((a: any) => a.text.startsWith('CREW ROTATION — 2 settlers aboard'))).toBe(true);
  expect(s2.defeatShown).toBe(false); // a robotic mission still cannot be defeated
});

test('settlers board only a base that can keep one more alive', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare&exp=robotic`);
  await game(page);
  await page.evaluate(() => window.__game.completeTech('humanCohabitation'));
  // three settlers aboard, nothing making oxygen, and 80 in the tanks: enough
  // for the old 20-unit floor all day, short of a lunar day for a fourth
  // (4 × 0.02/s × 720 s = 57.6 once the three have breathed their share)
  const held = await page.evaluate(() => {
    const g = window.__game!;
    g.grantCrew(3);
    g.grantResources({ oxygen: 80 - g.getState().resources.oxygen });
    g.advanceGameSeconds(750); // longer than a settler period
    g.setPaused(true); // a still HUD for the chip click; fast-forwards still tick
    g.advanceGameSeconds(0);
    return g.getState();
  });
  expect(held.crew).toBe(3);
  expect(held.alerts.some((a: any) => a.text.startsWith('ARRIVAL'))).toBe(false);
  await page.locator('#resource-strip .chip[data-key="crew"]').click();
  await expect(page.locator('#res-panel')).toContainText('Arrivals on hold — not enough oxygen');

  // production that covers the newcomer lifts the hold with only a few
  // minutes of oxygen in the tanks
  await page.evaluate(() => window.__game.completeTech('regolithProcessing'));
  for (const [t, x, z] of [['solar', 132, 126], ['solar', 132, 130], ['solar', 136, 126],
    ['excavator', 120, 126], ['smelter', 120, 132]] as const) {
    expect(await page.evaluate(([tt, xx, zz]) => window.__game.placeBuilding(tt, xx, zz), [t, x, z] as const)).toBe(true);
  }
  await page.evaluate(() => {
    const g = window.__game!;
    g.advanceGameSeconds(200); // smelter online at ~130s, its flow settled
    g.grantResources({ oxygen: 30 - g.getState().resources.oxygen });
    g.advanceGameSeconds(1);
  });
  await expect(page.locator('#res-panel')).not.toContainText('Arrivals on hold');

  // and a stocked base takes its fourth settler
  const grown = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ oxygen: 300 });
    g.advanceGameSeconds(750);
    return g.getState();
  });
  expect(grown.crew).toBe(4);
});

test('robotic handover: settlers take stations from the Lander; one crew-toggle rule', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare&exp=robotic`);
  await game(page);
  for (const [t, x, z] of [['solar', 132, 126], ['excavator', 120, 126], ['lab', 135, 133]] as const) {
    expect(await page.evaluate(([tt, xx, zz]) => window.__game.placeBuilding(tt, xx, zz), [t, x, z] as const)).toBe(true);
  }
  await page.evaluate(() => window.__game.advanceGameSeconds(120)); // all built
  const by = (s: any, t: string) => s.buildings.find((b: any) => b.type === t);
  const s0 = await page.evaluate(() => window.__game.getState());
  // no one aboard: crewing is refused out loud, and the inspector offers no toggle
  const refused = await page.evaluate((id) => {
    const g = window.__game!;
    g.setAutomated(id, false);
    g.advanceGameSeconds(1);
    return g.getState();
  }, by(s0, 'lab').id);
  expect(by(refused, 'lab').automated).toBe(true);
  expect(refused.alerts.some((a: any) => a.text.startsWith('NO CREW ABOARD'))).toBe(true);
  await page.evaluate((id) => window.__game.select(id), by(s0, 'lab').id);
  await expect(page.locator('#insp-crewed')).toHaveCount(0);

  // the crew rotation's two settlers arrive to an agent-run base, and the log says so
  await page.evaluate(() => window.__game.completeTech('humanCohabitation'));
  const arrived = await page.evaluate(() => {
    const g = window.__game!;
    for (let i = 0; i < 90 && g.getState().crew < 1; i++) g.advanceGameSeconds(10);
    return g.getState();
  });
  expect(arrived.crew).toBe(2);
  expect(arrived.alerts.some((a: any) =>
    a.text.startsWith('CREW ROTATION — 2 settlers aboard') && a.text.includes('agent-run'))).toBe(true);

  // two settlers, two stations: the excavator (priority 2, one seat) is crewed,
  // the two-seat lab stays agent-run rather than idle
  await page.evaluate((id) => window.__game.select(id), by(s0, 'lander').id);
  await page.locator('#insp-crewall').click();
  await expect.poll(async () => by(await page.evaluate(() => window.__game.getState()), 'excavator').automated)
    .toBe(false);
  const crewed = await page.evaluate(() => window.__game.getState());
  expect(by(crewed, 'lab').automated).toBe(true);
  expect(crewed.alerts.some((a: any) =>
    a.text === 'CREWED — 1 station handed to the settlers; 1 stays agent-run for want of hands')).toBe(true);

  // the lab's own toggle works the moment anyone is aboard — no automation tech needed
  await page.evaluate(() => window.__game.grantCrew(2));
  await page.evaluate((id) => window.__game.select(id), by(s0, 'lab').id);
  await page.locator('#insp-crewed').click();
  await expect.poll(async () => by(await page.evaluate(() => window.__game.getState()), 'lab').automated)
    .toBe(false);

  // a human base without Construction Robotics cannot hand stations to agents
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);
  expect(await page.evaluate(() => window.__game.placeBuilding('lab', 135, 133))).toBe(true);
  const human = await page.evaluate(() => {
    const g = window.__game!;
    g.advanceGameSeconds(80);
    g.setAutomated(g.getState().buildings.find((b: any) => b.type === 'lab').id, true);
    g.advanceGameSeconds(1);
    return g.getState();
  });
  expect(by(human, 'lab').automated).toBe(false);
  expect(human.alerts.some((a: any) => a.text.startsWith('NEEDS CONSTRUCTION ROBOTICS'))).toBe(true);
});

test('endgame: mass driver, foils, LAUNCH, victory overlay, save/reload', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare`);
  await game(page);

  // fast-forward the eight-era tree to swarm protocol
  for (const t of ['regolithProcessing', 'teleoperation', 'prospectingRovers',
    'siliconRefining', 'partsFabrication', 'batteryStorage', 'constructionRobotics', 'regolithShielding',
    'thoriumPower', 'swarmRobotics',
    'waferFab', 'orbitalProspector', 'acceleratorDesign',
    'lunarDataCenter', 'dynamicClocking',
    'closedLoopLS', 'scienceCrews',
    'foilManufacturing', 'massDriver', 'swarmProtocol']) {
    await page.evaluate((tech) => window.__game.completeTech(tech), t);
  }
  const st = await page.evaluate(() => window.__game.getState());
  expect(st.era).toBe(8);

  // victory needs a launch and nothing else: no milestone chain to satisfy.
  // A volley needs 3↑ of launch capacity, more than the driver banks in this window
  await page.evaluate(() => window.__game.grantResources({ metals: 200, parts: 60, foils: 15, launch: 3 }));
  expect(await page.evaluate(() => window.__game.placeBuilding('solar', 132, 126))).toBe(true);
  expect(await page.evaluate(() => window.__game.placeBuilding('massDriver', 132, 134))).toBe(true);
  await page.evaluate(() => window.__game.advanceGameMinutes(6)); // driver builds ~245s, then accrues
  await page.evaluate(() => window.__game.grantPower(1000)); // launch burst budget

  const pre = await page.evaluate(() => window.__game.getState());
  expect(pre.resources.launch).toBeGreaterThanOrEqual(3);
  expect(pre.milestonesDone).toContain('foils-ready'); // latched out of order
  expect(pre.milestonesDone).not.toContain('grow-the-crew');
  expect(pre.milestonesDone).not.toContain('survive-the-night');

  // the real button, on the swarm meter
  const btn = page.locator('#btn-launch');
  await expect(btn).toBeEnabled();
  await btn.click();
  await page.evaluate(() => window.__game.advanceGameSeconds(2));

  const post = await page.evaluate(() => window.__game.getState());
  expect(post.launches).toBe(1);
  expect(post.swarmPct).toBeGreaterThan(0);
  expect(post.milestonesDone).toContain('first-light');
  expect(post.victoryShown).toBe(true);
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
