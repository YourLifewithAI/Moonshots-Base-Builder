/** Integration contracts for the hub-fleet migration, earned engineering
 * pilots and research notebook. Import the real modules in Vite's browser
 * context; no simulated production time or network sources are required. */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

async function start(page: Page) {
  await page.goto('/?debug&seed=42&site=mare&exp=robotic&nolock&lowfx&style=classic');
  await page.waitForFunction(() => window.__game?.getState() != null);
  await page.evaluate(() => {
    window.__game.setPaused(true);
    window.__game.holdHazards(true);
    window.__game.advanceGameSeconds(0);
  });
}

test('legacy extraction rules merge opt-in, budgets and cooldowns without enabling disabled automation', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(async () => {
    const { defaultAuto, defaultRule, fillAuto } = await import('/src/core/state.ts');
    const old = defaultAuto();
    delete old.rules.hubUnit;
    old.rules.excavator = { ...defaultRule('excavator'), on: false, cap: 6, built: 4, nextAt: 140, frozenUntil: 300 };
    old.rules.iceHarvester = { ...defaultRule('iceHarvester'), on: false, cap: 3, built: 2, nextAt: 220, frozenUntil: 280 };
    old.frozenUntil = 350;
    old.reserve = { metals: 40, parts: 8 };
    const disabled = fillAuto(old);
    old.rules.iceHarvester.on = true;
    const iceEnabled = fillAuto(old);
    old.rules.iceHarvester.on = false;
    old.rules.excavator.on = true;
    const digEnabled = fillAuto(old);
    old.rules.excavator.cap = 50;
    old.rules.iceHarvester.cap = 30;
    const clamped = fillAuto(old);
    // A modern rule remains authoritative even if retired records survive.
    old.rules.hubUnit = { ...defaultRule('hubUnit'), on: false, cap: 5, built: 3, threshold: 0.4, nextAt: 900, frozenUntil: 1000 };
    const modern = fillAuto(old);
    return { disabled, iceEnabled: iceEnabled.rules.hubUnit, digEnabled: digEnabled.rules.hubUnit,
      clamped: clamped.rules.hubUnit, modern: modern.rules.hubUnit,
      expectedModern: old.rules.hubUnit, again: fillAuto(disabled), defaults: fillAuto(undefined) };
  });
  expect(r.disabled.rules.hubUnit).toMatchObject({ on: false, cap: 9, built: 6, nextAt: 220, frozenUntil: 300, threshold: 0.25 });
  expect(r.disabled.rules).not.toHaveProperty('excavator');
  expect(r.disabled.rules).not.toHaveProperty('iceHarvester');
  expect(r.disabled).toMatchObject({ frozenUntil: 350, reserve: { metals: 40, parts: 8 } });
  expect(r.iceEnabled).toMatchObject({ on: true, cap: 9, built: 6, nextAt: 220, frozenUntil: 300 });
  expect(r.digEnabled.on).toBe(true);
  expect(r.clamped.cap).toBe(60);
  expect(r.modern).toEqual(r.expectedModern);
  expect(r.again).toEqual(r.disabled);
  expect(Object.values(r.defaults.rules).every((rule: any) => !rule.on)).toBe(true);
});

test('a loaded runaway keeps its intended rule when the two legacy extractor indices merge, exactly once', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(async () => {
    const { createInitialState, defaultRule, fillStateDefaults } = await import('/src/core/state.ts');
    const { RULE_ORDER } = await import('/src/data/automation.ts');
    const s = createInitialState('mare', 42, 'robotic');
    delete s.auto.rules.hubUnit;
    s.auto.rules.excavator = defaultRule('excavator');
    s.auto.rules.iceHarvester = defaultRule('iceHarvester');
    const oldOrder = ['excavator', 'iceHarvester', ...RULE_ORDER.slice(1)];
    const ids = ['excavator', 'iceHarvester', 'solar', 'replace', 'foilFactory'];
    s.hazards.live = ids.map((id, i) => ({ id: i + 1, kind: 'runaway', n: { rule: oldOrder.indexOf(id), unrelated: 7 } }));
    s.hazards.live.push({ id: 99, kind: 'dust', n: { rule: 5 } });
    fillStateDefaults(s);
    const first = JSON.stringify(s);
    const mapped = s.hazards.live.slice(0, ids.length).map((h) => RULE_ORDER[h.n.rule]);
    fillStateDefaults(s);
    const second = JSON.stringify(s);
    const loaded = fillStateDefaults(JSON.parse(first));
    return { mapped, first, second, loaded: JSON.stringify(loaded), unrelated: s.hazards.live.at(-1).n.rule,
      payloads: s.hazards.live.slice(0, ids.length).map((h) => h.n.unrelated) };
  });
  expect(r.mapped).toEqual(['hubUnit', 'hubUnit', 'solar', 'replace', 'foilFactory']);
  expect(r.unrelated).toBe(5);
  expect(r.payloads).toEqual([7, 7, 7, 7, 7]);
  expect(r.second).toBe(r.first);
  expect(r.loaded).toBe(r.first);
});

test('engineering pilots require real operations, then survive serialization and reduce only the data cost', async ({ page }) => {
  await start(page);
  const results = await page.evaluate(async () => {
    const { createInitialState, fillStateDefaults } = await import('/src/core/state.ts');
    const { insightTick, techCost } = await import('/src/core/research.ts');
    const { TECHS } = await import('/src/data/techs.ts');
    const { ERA_COST_SCALE } = await import('/src/data/balance.ts');
    const fresh = () => {
      const s = createInitialState('mare', 42, 'human');
      s.resources.water = 0;
      return s;
    };
    const unit = (id: number, hub = 1) => ({ id, hub, type: 'excavator', target: 'dep:ilmenite-0', haul: { pw: 1 } });
    const hub = (level = 1, hopper = 1, active = true, id = 1) => ({ id, type: 'smelter', active, hub: { level, hopper } });
    const pit = (tonnes: number, state = 'open') => ({ key: 'dep:ilmenite-0', tonnes, state });
    const cases = [
      { id: 'bayExtensions', discount: 0.25, fail: [
        (s) => { s.buildings = [hub()]; s.haulers = [unit(1)]; },
        (s) => { s.buildings = [hub(), hub(1, 1, true, 2)]; s.haulers = [unit(1), unit(2, 2)]; },
        (s) => { s.buildings = [hub(1, 0)]; s.haulers = [unit(1), unit(2)]; },
        (s) => { s.buildings = [hub(1, 1, false)]; s.haulers = [unit(1), unit(2)]; },
      ], pass: (s) => { s.buildings = [hub()]; s.haulers = [unit(1), unit(2)]; } },
      { id: 'hardfacedTeeth', discount: 0.25, fail: [
        (s) => { s.resources.regolith = 1000; s.pits = [pit(149.99), pit(150)]; },
      ], pass: (s) => { s.pits = [pit(150), pit(150)]; } },
      { id: 'waterReclamation', discount: 0.3, fail: [
        (s) => { s.resources.water = 1000; s.stats.produced.water = 149.99; },
      ], pass: (s) => { s.stats.produced.water = 150; } },
      { id: 'waterElectrolysis', discount: 0.25, fail: [
        (s) => { s.stats.produced.water = 299.99; s.resources.water = 100; },
        (s) => { s.stats.produced.water = 300; s.resources.water = 99.99; },
      ], pass: (s) => { s.stats.produced.water = 300; s.resources.water = 100; } },
      { id: 'deepCoring', discount: 0.3, fail: [
        (s) => { s.pits = [pit(0, 'exhausted')]; },
        (s) => { s.pits = [pit(10, 'open')]; },
      ], pass: (s) => { s.pits = [pit(10, 'boxed')]; } },
      { id: 'depotHalls', discount: 0.25, fail: [
        (s) => { s.buildings = [hub(1)]; s.haulers = [unit(1), unit(2), unit(3)]; },
        (s) => { s.buildings = [hub(2)]; s.haulers = [unit(1), unit(2)]; },
        (s) => { s.buildings = [hub(2, 0)]; s.haulers = [unit(1), unit(2), unit(3)]; },
        (s) => { s.buildings = [hub(2, 1, false)]; s.haulers = [unit(1), unit(2), unit(3)]; },
      ], pass: (s) => { s.buildings = [hub(2)]; s.haulers = [unit(1), unit(2), unit(3)]; } },
    ];
    return cases.map((c) => {
      const rejected = c.fail.map((setup) => {
        const s = fresh(); setup(s); insightTick(s);
        return s.insights[c.id] ?? 0;
      });
      const s = fresh();
      s.researchQueue = [c.id];
      insightTick(s);
      const queuedOnly = s.insights[c.id] ?? 0;
      const before = techCost(c.id, s);
      const done = fresh();
      c.pass(done);
      done.techsDone.push(c.id);
      const doneFired = insightTick(done);
      c.pass(s);
      const fired = insightTick(s);
      const earned = s.insights[c.id];
      const after = techCost(c.id, s);
      const alerts = s.alerts.length;
      const second = insightTick(s);
      const loaded = fillStateDefaults(JSON.parse(JSON.stringify(s)));
      // An earned pilot is permanent even after its original conditions lapse.
      loaded.buildings = []; loaded.haulers = []; loaded.pits = [];
      loaded.stats.produced.water = 0; loaded.resources.water = 0;
      insightTick(loaded);
      return { id: c.id, discount: c.discount, rejected, queuedOnly, before, fired, earned, after,
        expectedData: Math.round(TECHS[c.id].costData * ERA_COST_SCALE[TECHS[c.id].era] * (1 - c.discount)),
        doneFired, doneEarned: done.insights[c.id] ?? 0,
        second, alerts, alertsAfter: s.alerts.length, saved: loaded.insights[c.id], savedCost: techCost(c.id, loaded) };
    });
  });
  expect(results).toHaveLength(6);
  for (const r of results) {
    expect(r.rejected.every((v) => v === 0), `${r.id}: unmet pilot must not earn`).toBe(true);
    expect(r.queuedOnly, `${r.id}: queueing is not a pilot`).toBe(0);
    expect(r.doneFired).not.toContain(r.id);
    expect(r.doneEarned, `${r.id}: completed research must not award a redundant discount`).toBe(0);
    expect(r.fired).toContain(r.id);
    expect(r.earned).toBe(r.discount);
    expect(r.after.discount).toBe(r.discount);
    expect(r.after.data).toBe(r.expectedData);
    expect(r.after.goods).toEqual(r.before.goods);
    expect(r.after.insightLabel.length).toBeGreaterThan(0);
    expect(r.second).not.toContain(r.id);
    expect(r.alertsAfter).toBe(r.alerts);
    expect(r.saved).toBe(r.discount);
    expect(r.savedCost).toEqual(r.after);
  }
});

test('deep coring accepts a worked-out pit, and ore sorting counts working hub units but not recalled or powerless units', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(async () => {
    const { createInitialState } = await import('/src/core/state.ts');
    const { insightTick } = await import('/src/core/research.ts');
    const s = createInitialState('mare', 42, 'robotic');
    s.pits = [{ key: 'dep:ilmenite-0', tonnes: 1, state: 'exhausted' }];
    insightTick(s);
    const deep = s.insights.deepCoring;
    const unit = (id: number) => ({ id, type: 'excavator', hub: 1, target: 'dep:ilmenite-0', haul: { pw: 1 } });
    const cases = [
      { label: 'only three', units: [unit(1), unit(2), unit(3)], legacy: [], earn: false },
      { label: 'recalled fourth', units: [unit(1), unit(2), unit(3), { ...unit(4), parked: 'recalled' }], legacy: [], earn: false },
      { label: 'powerless fourth', units: [unit(1), unit(2), unit(3), { ...unit(4), haul: { pw: 0 } }], legacy: [], earn: false },
      { label: 'no target', units: [unit(1), unit(2), unit(3), { ...unit(4), target: null }], legacy: [], earn: false },
      { label: 'latched fourth', units: [unit(1), unit(2), unit(3), { ...unit(4), latch: true }], legacy: [], earn: false },
      { label: 'rebooting fourth', units: [unit(1), unit(2), unit(3), { ...unit(4), rebootUntil: s.simTime + 1 }], legacy: [], earn: false },
      { label: 'ice miners are not excavators', units: [unit(1), unit(2), unit(3), { ...unit(4), type: 'iceMiner' }], legacy: [], earn: false },
      { label: 'four hub excavators', units: [unit(1), unit(2), unit(3), unit(4)], legacy: [], earn: true },
      { label: 'legacy and hub fleet together', units: [unit(1), unit(2)], legacy: [{ type: 'excavator', active: true }, { type: 'excavator', active: true }], earn: true },
    ];
    return { deep, cases: cases.map((c) => {
      const fresh = createInitialState('mare', 42, 'robotic');
      fresh.haulers = c.units; fresh.buildings = c.legacy;
      insightTick(fresh);
      return { label: c.label, expect: c.earn, earned: fresh.insights.oreSorting ?? 0 };
    }) };
  });
  expect(r.deep).toBe(0.3);
  for (const c of r.cases) expect(c.earned, c.label).toBe(c.expect ? 0.3 : 0);
});

test('research sources open as a keyboard-accessible notebook without queueing research or closing the tree', async ({ page, context }) => {
  await start(page);
  await page.locator('#era-chip').click();
  const tree = page.locator('#tech-screen');
  const opener = page.locator('#tech-sheet-body .evidence-open[data-tech="regolithProcessing"]');
  await expect(tree).toBeVisible();
  await page.locator('.tech-card[data-tech="regolithProcessing"]').hover();
  const before = await page.evaluate(() => window.__game.getState().researchQueue);
  await expect(opener).toBeVisible();
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Pit Mapping' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('What exists today');
  await expect(dialog).toContainText('The lunar engineering gap');
  await expect(dialog).toContainText('What the game simplifies');
  const link = dialog.locator('a[href]').first();
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /\bnoopener\b/);
  await expect(link).toHaveAttribute('rel', /\bnoreferrer\b/);
  const href = await link.getAttribute('href');
  expect(href).toMatch(/^https:\/\//);
  // Verify actual native Enter activation, but keep the third-party request offline.
  await context.route(href!, (route) => route.fulfill({ contentType: 'text/html', body: '<title>Offline source fixture</title>' }));
  await link.focus();
  const popupPromise = page.waitForEvent('popup');
  await page.keyboard.press('Enter');
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  await expect(popup).toHaveURL(href!);
  await popup.close();
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => window.__game.getState().researchQueue)).toEqual(before);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(tree).toBeVisible();
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => window.__game.getState().researchQueue)).toEqual(before);
  await page.keyboard.press('Escape');
  await expect(tree).not.toBeVisible();
});

test('live hub policy, per-unit planner and electrolysis actions honor research locks and persist through a game reload', async ({ page }) => {
  await start(page);
  const ids = await page.evaluate(() => {
    const g = window.__game;
    g.openRoads(true);
    g.grantResources({ metals: 2000, parts: 1000, silicon: 300 });
    g.grantPower(20000);
    g.completeTech('regolithVolatiles');
    const place = (type: string) => {
      for (let r = 2; r < 30; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        for (const rot of [0, 1, 2, 3]) {
          if (g.canPlace(type, 127 + dx, 127 + dz, rot).valid && g.placeBuilding(type, 127 + dx, 127 + dz, rot)) {
            return g.getState().buildings.at(-1).id;
          }
        }
      }
      throw new Error(`No fixture site for ${type}`);
    };
    const hub = place('smelter');
    const water = place('waterPlant');
    g.finishConstruction();
    g.advanceGameSeconds(1);
    const unit = g.getState().haulers.find((u) => u.hub === hub)?.id;
    if (unit == null) throw new Error('Completed smelter did not commission its first unit');
    g.setHubPolicy(hub, 'conserve');
    g.setUnitFeedPlan(unit, false);
    g.setElectrolysis(water, true);
    g.advanceGameSeconds(0);
    return { hub, water, unit };
  });
  const locked = await page.evaluate((ids) => {
    const g = window.__game;
    return { state: g.getState(), view: g.getHubs() };
  }, ids);
  expect(locked.view.hubs[ids.hub]).toMatchObject({ planner: false, policy: 'balanced' });
  expect(locked.view.units.find((u) => u.id === ids.unit)).toMatchObject({ feedPlanOff: false });
  expect(locked.view.hubs[ids.water]).toMatchObject({ electrolysis: false, canElectrolysis: false });
  expect(locked.state.alerts.some((a) => /Feed Planner research/.test(a.text))).toBe(true);
  expect(locked.state.alerts.some((a) => /Research Water Electrolysis/.test(a.text))).toBe(true);

  await page.evaluate((ids) => {
    const g = window.__game;
    g.completeTech('feedPlanner');
    g.completeTech('waterElectrolysis');
    g.advanceGameSeconds(0);
    g.select(ids.hub);
  }, ids);
  const policy = page.locator('.hub-policy[data-policy="conserve"]');
  await policy.click();
  await expect(policy).toHaveAttribute('aria-pressed', 'true');
  const unitPlan = page.locator(`.unit-feed-plan[data-unit="${ids.unit}"]`);
  await unitPlan.click();
  await expect(unitPlan).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate((id) => window.__game.select(id), ids.water);
  const electrolysis = page.locator('#hub-electrolysis');
  await expect(electrolysis).toBeEnabled();
  await electrolysis.click();
  await expect(electrolysis).toHaveAttribute('aria-pressed', 'true');

  const saved = await page.evaluate(() => window.__game.saveBlob());
  expect(saved.state.buildings.find((b) => b.id === ids.hub).hub.policy).toBe('conserve');
  expect(saved.state.haulers.find((u) => u.id === ids.unit).feedPlanOff).toBe(true);
  expect(saved.state.buildings.find((b) => b.id === ids.water).electrolysis).toBe(true);
  const loaded = await page.evaluate((blob) => {
    const g = window.__game;
    g.loadBlob(JSON.parse(JSON.stringify(blob)));
    g.setPaused(true);
    g.advanceGameSeconds(0);
    return g.getHubs();
  }, saved);
  expect(loaded.hubs[ids.hub]).toMatchObject({ planner: true, policy: 'conserve' });
  expect(loaded.units.find((u) => u.id === ids.unit)).toMatchObject({ planner: true, feedPlanOff: true });
  expect(loaded.hubs[ids.water]).toMatchObject({ electrolysis: true, canElectrolysis: true });
});
