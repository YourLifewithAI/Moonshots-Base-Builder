import { test, expect, type Page } from '@playwright/test';

/** Deterministic simulation fixtures run through the same Vite modules as the
 * game. A small road lattice isolates planning from terrain/render timing. */
async function prepare(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const S = await import('/src/core/state.ts');
    const M = await import('/src/core/mods.ts');
    const H = await import('/src/core/hubs.ts');
    const P = await import('/src/core/hubPlanner.ts');
    const R = await import('/src/core/pits.ts');
    const A = await import('/src/core/automation.ts');
    const D = await import('/src/core/daynight.ts');
    const sites = await import('/src/data/sites.ts');
    (window as any).plannerFixture = () => {
      const s = S.createInitialState('mare', 95031, 'robotic');
      const site = sites.SITES.mare;
      const mods = M.modsFor(s);
      mods.feedPlanner = true;
      mods.autoFamilies.add('excavation');
      s.simTime = 200;
      s.auto.families = ['excavation'];
      s.resources.metals = 2000; s.resources.parts = 2000;
      s.power = { supply: 1000, supplyFull: 1000, supplyNight: 1000, demand: 20, capacity: 20000, served: 20, brownout: false, shed: false };
      s.powerStored = 20000;
      const b = { id: 91001, type: 'smelter', gx: 119, gz: 120, rot: 0, enabled: true, automated: true,
        active: true, idleReason: '', priority: 2, wear: 0, dust: 0, construction: 0, hub: H.newHubState() };
      s.buildings = [b];
      const deps = [
        { id: 'ilmenite-900', kind: 'ilmenite', cx: 20, cz: -10, r: 16 },
        { id: 'ilmenite-901', kind: 'ilmenite', cx: 168, cz: -10, r: 16 },
      ];
      s.zones = deps.map((d) => ({ ...d }));
      R.bindTerrain(s, { deposits: deps });
      s.roads = [];
      for (let gz = 115; gz <= 135; gz++) for (let gx = 115; gx <= 176; gx++) s.roads.push({ gx, gz, left: 0 });
      s.roadRev = 7901;
      for (const d of deps) s.oreSurvey.done[d.id] = { at: 0, precision: 0.15 };
      const u = H.addUnit(s, b, site);
      delete u.parked;
      const pos = H.standPoint(b);
      Object.assign(u.haul, { phase: 'park', x: pos[0], z: pos[1] });
      return { s, site, mods, b, u, S, M, H, P, R, A, D };
    };
  });
}

test('Feed Planner reroutes hub-owned units at empty departures and keeps pins, recall, cargo and cooldown', async ({ page }) => {
  await prepare(page);
  const r = await page.evaluate(() => {
    const { s, site, mods, b, u, H, P } = (window as any).plannerFixture();
    u.target = 'dep:ilmenite-901'; u.face = 0;
    const list = P.plannerChoices(s, mods, site, b, u);
    const first = P.planHubFeeds(s, mods, site);
    const target = u.target;
    const pinnedAfter = u.pinned;
    const cooldown = P.planHubFeeds(s, mods, site);
    const holds: string[] = [];
    for (const mode of ['pin', 'recall', 'off', 'charging', 'cargo', 'assign']) {
      delete u.planAt; delete u.parked; u.pinned = false; u.feedPlanOff = false; delete b.hub.prefer;
      u.target = 'dep:ilmenite-901'; u.face = 0; u.haul.phase = 'park'; u.haul.cargo = {};
      if (mode === 'pin') u.pinned = true;
      if (mode === 'recall') u.parked = 'recalled';
      if (mode === 'off') u.feedPlanOff = true;
      if (mode === 'charging') u.parked = 'charge';
      if (mode === 'cargo') u.haul.cargo = { regolith: 60 };
      if (mode === 'assign') b.hub.prefer = u.target;
      P.planHubFeeds(s, mods, site);
      if (u.target === 'dep:ilmenite-901') holds.push(mode);
    }
    return { list: list.map((c: any) => c.choice.target.key), first, target, pinnedAfter, cooldown, holds,
      legacyPads: s.buildings.filter((x: any) => x.type === 'excavator').length };
  });
  expect(r.legacyPads).toBe(0);
  expect(r.list[0]).toBe('dep:ilmenite-900');
  expect(r.first).not.toBeNull();
  expect(r.target).toBe('dep:ilmenite-900');
  expect(r.pinnedAfter).toBe(false);
  expect(r.cooldown).toBeNull();
  expect(r.holds).toEqual(['pin', 'recall', 'off', 'charging', 'cargo', 'assign']);
});

test('routing shares faces across hubs and rejects blocked, disconnected and out-of-reach pits', async ({ page }) => {
  await prepare(page);
  const r = await page.evaluate(() => {
    const { s, site, mods, b, u, H, P, R } = (window as any).plannerFixture();
    const other = H.addUnit(s, { ...b, id: 91002 }, site);
    other.target = 'dep:ilmenite-900'; other.face = 0;
    const occupied = P.plannerChoices(s, mods, site, b, u).map((c: any) => c.choice.target.key);
    other.face = -1;
    const pit = R.pitFor(s, 'dep:ilmenite-900');
    Object.assign(pit, { state: 'boxed', anchor: 1, cx: 20, cz: -10, R: 12 });
    const boxed = P.plannerChoices(s, mods, site, b, u).map((c: any) => c.choice.target.key);
    mods.haulSpeedMult = 0.01;
    const tooFar = P.plannerChoices(s, mods, site, b, u).length;
    mods.haulSpeedMult = 1;
    s.roads = []; s.roadRev++;
    const disconnected = P.plannerChoices(s, mods, site, b, u).length;
    return { occupied, boxed, tooFar, disconnected };
  });
  expect(r.occupied).toEqual(['dep:ilmenite-901']);
  expect(r.boxed).toEqual(['dep:ilmenite-901']);
  expect(r.tooFar).toBe(0);
  expect(r.disconnected).toBe(0);
});

test('the hub fleet rule guards power, faces, surveyed reserves, queued capacity and the protected budget', async ({ page }) => {
  await prepare(page);
  const r = await page.evaluate(() => {
    const { s, site, mods, b, u, H, P, R, A, D } = (window as any).plannerFixture();
    b.hub.starved = 0.8;
    u.target = 'dep:ilmenite-901'; u.face = 0; u.haul.phase = 'dig';
    const ready = P.usefulUnit(s, mods, site, b, 1000);
    const noPower = P.usefulUnit(s, mods, site, b, 0).why;
    u.parked = 'recalled'; const recalled = P.usefulUnit(s, mods, site, b, 1000).why; delete u.parked;
    delete s.oreSurvey.done['ilmenite-900']; const unknown = P.usefulUnit(s, mods, site, b, 1000).why;
    s.oreSurvey.done['ilmenite-900'] = { at: 0, precision: 0.15 };
    const ore = R.reservesOf(s, mods, 'ilmenite-900');
    const pit = R.pitFor(s, 'dep:ilmenite-900');
    Object.assign(pit, { state: 'open', anchor: 1, cx: 20, cz: -10, ox: 20, oz: -10, R: 12, ore: ore.leftLo - 1 });
    const almostSpent = P.usefulUnit(s, mods, site, b, 1000).why;
    s.pits = [];
    const rule = s.auto.rules.hubUnit;
    Object.assign(rule, { on: true, dwell: 60, nextAt: 0 });
    s.resources.parts = 0;
    const poor: any[] = [];
    for (let i = 0; i < 60; i++) { s.simTime++; poor.push(...A.automationTick(s, site, mods, D.dayInfo(s.simTime, site), 1).filter((x: any) => x.kind === 'unit')); }
    const poorWhy = rule.why;
    s.resources.parts = 2000; rule.dwell = 60;
    const rich = A.automationTick(s, site, mods, D.dayInfo(s.simTime, site), 1).filter((x: any) => x.kind === 'unit');
    b.hub.queue.push({ kind: 'unit', paid: null, t: 0, total: 60 });
    const queued = P.usefulUnit(s, mods, site, b, 1000).why;
    return { ready: ready.why, gain: ready.gain, noPower, recalled, unknown, almostSpent, poor, poorWhy, rich, queued };
  });
  expect(r.ready).toBe('');
  expect(r.gain).toBeGreaterThan(0);
  expect(r.noPower).toMatch(/power first/);
  expect(r.recalled).toMatch(/existing unit/);
  expect(r.unknown).toMatch(/survey/);
  expect(r.almostSpent).toMatch(/0.0 lunar days/);
  expect(r.poor).toEqual([]);
  expect(r.poorWhy).toMatch(/reserve|needs/);
  expect(r.rich).toHaveLength(1);
  expect(r.rich[0].rule).toBe('hubUnit');
  expect(r.queued).toMatch(/BAYS FULL/);
});

test('starvation dwell stays with each hub, restarts after load, and a blocked hub cannot hold another back', async ({ page }) => {
  await prepare(page);
  const r = await page.evaluate(() => {
    const f = (window as any).plannerFixture();
    const { s, site, mods, b, u, H, A, D } = f;
    u.target = 'dep:ilmenite-901'; u.face = 0; u.haul.phase = 'dig';
    const second = { ...b, id: 91002, hub: H.newHubState() };
    s.buildings.push(second);
    Object.assign(s.auto.rules.hubUnit, { on: true, dwell: 999 });
    const run = (seconds: number) => {
      const jobs: any[] = [];
      for (let i = 0; i < seconds; i++) { s.simTime++; jobs.push(...A.automationTick(s, site, mods, D.dayInfo(s.simTime, site), 1).filter((x: any) => x.kind === 'unit')); }
      return jobs;
    };
    b.hub.starved = 0.8;
    const loaded = run(1);
    const a40 = run(39);
    b.hub.starved = 0; second.hub.starved = 0.8;
    const b40 = run(40);
    const b60 = run(20);
    // Restart a separate rule identity as a reloaded save would, with the
    // earlier hub continuously starved but its existing machine recalled.
    s.auto.rules.hubUnit = { ...s.auto.rules.hubUnit, dwell: 0, nextAt: 0 };
    b.hub.starved = 0.9; u.parked = 'recalled';
    const unblocked = run(60);
    return { loaded, a40, b40, b60, unblocked };
  });
  expect(r.loaded).toEqual([]);
  expect(r.a40).toEqual([]);
  expect(r.b40).toEqual([]);
  expect(r.b60).toHaveLength(1);
  expect(r.b60[0].hub).toBe(91002);
  expect(r.unblocked).toHaveLength(1);
  expect(r.unblocked[0].hub).toBe(91002);
});

test('printing accounts for the candidate bedrock cut’s additional power draw', async ({ page }) => {
  await prepare(page);
  const r = await page.evaluate(() => {
    const { s, site, mods, b, u, H, P, R } = (window as any).plannerFixture();
    u.target = 'dep:ilmenite-901'; u.face = 0; u.haul.phase = 'dig';
    const surface = P.usefulUnit(s, mods, site, b, 1000);
    const pit = R.pitFor(s, 'dep:ilmenite-900');
    Object.assign(pit, { state: 'open', anchor: 1, cx: 20, cz: -10, ox: 20, oz: -10, R: 12, rockR: 12, rockTo: 4, rock: 0 });
    const guarded = P.usefulUnit(s, mods, site, b, surface.draw * 1.11);
    return { surfaceDraw: surface.draw, rockDraw: guarded.draw, why: guarded.why };
  });
  expect(r.rockDraw).toBeGreaterThan(r.surfaceDraw);
  expect(r.why).toMatch(/power first.*bedrock/);
});

test('night feed chooses frequent deliveries until its hopper reserve is filled', async ({ page }) => {
  await prepare(page);
  const r = await page.evaluate(() => {
    const { s, site, mods, b, u, H, P } = (window as any).plannerFixture();
    s.zones[0] = { id: 'plain:900', kind: 'plain', cx: 20, cz: -10, r: 12 };
    s.plainPits = [{ id: 900, x: 20, z: -10, hub: b.id }];
    b.hub.plainPit = 900;
    s.roadRev++;
    const best = () => P.plannerChoices(s, mods, site, b, u)[0].choice.target.key;
    b.hub.policy = 'balanced'; const product = best();
    b.hub.policy = 'night'; b.hub.hopper = 0; const empty = best();
    b.hub.hopper = H.hopperCap(b); const full = best();
    b.hub.policy = 'conserve'; const conserve = P.plannerChoices(s, mods, site, b, u);
    return { product, empty, full, conserve: conserve.map((c: any) => ({ score: c.score, energy: c.energy })) };
  });
  expect(r.product).toBe('dep:ilmenite-901');
  expect(r.empty).toBe('plain:900');
  expect(r.full).toBe(r.product);
  expect(r.conserve.every((c: any) => c.energy > 0)).toBe(true);
  expect(r.conserve[0].score).toBeGreaterThan(r.conserve[1].score);
});

test('policies and per-unit opt-outs persist; old extractor rules merge without enabling an off save', async ({ page }) => {
  await prepare(page);
  const r = await page.evaluate(() => {
    const { s, mods, b, u, S, P } = (window as any).plannerFixture();
    const old = { ...S.defaultAuto(), rules: {
      excavator: { ...S.defaultRule('excavator'), on: false, cap: 4, built: 2, nextAt: 400 },
      iceHarvester: { ...S.defaultRule('iceHarvester'), on: false, cap: 3, built: 1, frozenUntil: 700 },
    } };
    const off = S.fillAuto(old).rules.hubUnit;
    old.rules.iceHarvester.on = true;
    const on = S.fillAuto(old).rules.hubUnit;
    P.setHubPolicy(s, mods, b.id, 'conserve');
    P.setUnitFeedPlan(s, mods, u.id, false);
    const restored = S.fillStateDefaults(JSON.parse(JSON.stringify(s)));
    const legacyPolicy = P.hubPolicy({ ...b, hub: HLESS(b.hub) });
    function HLESS(h: any) { const copy = { ...h }; delete copy.policy; return copy; }
    return { off, on, policy: restored.buildings[0].hub.policy, optOut: restored.haulers[0].feedPlanOff, legacyPolicy };
  });
  expect(r.off.on).toBe(false);
  expect(r.off.cap).toBe(7);
  expect(r.off.built).toBe(3);
  expect(r.off.nextAt).toBe(400);
  expect(r.off.frozenUntil).toBe(700);
  expect(r.off.threshold).toBe(0.25);
  expect(r.on.on).toBe(true);
  expect(r.policy).toBe('conserve');
  expect(r.optOut).toBe(true);
  expect(r.legacyPolicy).toBe('balanced');
});
