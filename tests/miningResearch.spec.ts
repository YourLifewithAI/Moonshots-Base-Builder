/** The extraction ladder must change real research, paid hub jobs and water
 *  flows. These tests use fresh simulation states, without a rendered campaign
 *  or debug-completing the research under test. */
import { test, expect, type Page } from '@playwright/test';

async function modules(page: Page) {
  await page.goto('/?debug&site=mare&exp=robotic&seed=42');
  await page.waitForFunction(() => !!window.__game);
  await page.evaluate(async () => {
    window.__game.setPaused(true);
    const [state, mods, research, hubs, techs, sites, buildings, economy, pits, terrain, roads] = await Promise.all([
      import('/src/core/state.ts'), import('/src/core/mods.ts'), import('/src/core/research.ts'),
      import('/src/core/hubs.ts'), import('/src/data/techs.ts'), import('/src/data/sites.ts'),
      import('/src/data/buildings.ts'), import('/src/core/economy.ts'),
      import('/src/core/pits.ts'), import('/src/terrain/heightfield.ts'),
      import('/src/core/roads.ts'),
    ]);
    (window as any).M = { ...state, ...mods, ...research, ...hubs, ...techs, ...sites, ...buildings, ...economy, ...pits, ...terrain, ...roads };
    (window as any).makeBuilding = (type: string, id: number, gx = 100 + id * 8) => ({
      id, type, gx, gz: 100, rot: 0, enabled: true, automated: true, priority: buildings.BUILDINGS[type].priority,
      wear: 0, dust: 0, construction: 0, buildTotal: 0, active: true, idleReason: '',
    });
  });
}

test('research unlocks paid local bay upgrades, and faster digging preserves bucket capacity', async ({ page }) => {
  await modules(page);
  const result = await page.evaluate(() => {
    const m = (window as any).M, make = (window as any).makeBuilding;
    const s = m.createInitialState('mare', 42, 'human');
    s.era = 5; s.roads = []; s.data = 5000;
    s.resources.metals = 1000; s.resources.parts = 1000;
    const hub = make('smelter', 1); hub.hub = m.newHubState();
    s.buildings = [hub, make('lab', 2)];
    const base = m.computeMods(s.techsDone, s.expedition, s.siteId);
    const locked = m.queueRefusal(s, base, hub, 'bay');
    const prerequisite = m.techAvailability('depotHalls', s).reason;
    const enqueued = m.enqueue(s, 'bayExtensions');
    // Banked science moves through an operating lab, then completes next tick.
    m.researchTick(s, base, 1000); m.researchTick(s, base, 1);
    let mods = m.computeMods(s.techsDone, s.expedition, s.siteId);
    const noFreeUpgrade = hub.hub.level;
    const queue = m.queueJob(s, mods, m.SITES.mare, hub, 'bay');
    const before = { ...s.resources };
    m.printTick(s, mods, m.SITES.mare, 1, new Set([hub.id]));
    m.printTick(s, mods, m.SITES.mare, 100, new Set([hub.id]));
    const paid = { metals: before.metals - s.resources.metals, parts: before.parts - s.resources.parts };
    const capacity = m.bayCap(hub, mods);
    m.enqueue(s, 'hardfacedTeeth'); m.researchTick(s, mods, 1000); m.researchTick(s, mods, 1);
    mods = m.computeMods(s.techsDone, s.expedition, s.siteId);
    const spec = (m0: any, type: string) => m.unitSpec(m0, type, m.unitRates(s, m0, m.SITES.mare, { type, wear: 0 }, undefined));
    const cycles = ['excavator', 'iceMiner'].map((type) => ({ base: spec(base, type), improved: spec(mods, type) }));
    const full = m.computeMods(['bayExtensions', 'depotHalls', 'fleetOS', 'replicatorStacks'], 'robotic', 'mare');
    return { locked, prerequisite, enqueued, noFreeUpgrade, queue, paid, capacity, cycles,
      full: { level: full.hubLevel, bays: m.bayCap({ ...hub, hub: { ...hub.hub, level: 3 } }, full),
        unitTime: m.jobTime(hub, 'unit', m.SITES.mare, full), bayTime: m.jobTime(hub, 'bay', m.SITES.mare, full) } };
  });
  expect(result.locked).toContain('BAY EXTENSIONS');
  expect(result.prerequisite).toContain('Bay Extensions');
  expect(result.enqueued.ok).toBe(true);
  expect(result.noFreeUpgrade).toBe(1);
  expect(result.queue).toBe('');
  // The mare's ×0.8 construction modifier applies to locally paid jobs.
  expect(result.paid).toEqual({ metals: 24, parts: 8 });
  expect(result.capacity).toBe(3);
  for (const c of result.cycles) {
    expect(c.improved.bucket).toBeCloseTo(c.base.bucket, 8);
    expect(c.improved.digS).toBeCloseTo(c.base.digS / 1.25, 8);
    expect(c.improved.gain).toBeCloseTo(c.base.gain * 1.25, 8);
  }
  expect(result.full).toEqual({ level: 3, bays: 5, unitTime: 18, bayTime: 48 });
});

test('deep research has fair prerequisites; schema 5 preserves paid Pit Mapping work', async ({ page }) => {
  await modules(page);
  const result = await page.evaluate(() => {
    const m = (window as any).M;
    const s = m.createInitialState('mare', 42, 'human'); s.era = 4;
    const missing = m.techAvailability('deepCoring', s).reason;
    s.techsDone.push('prospectingRovers');
    const ready = m.techAvailability('deepCoring', s).state;
    const mods = m.computeMods(['deepCoring', 'deepSounding'], 'human', 'mare');
    s.pits = [{ key: 'dep:ilmenite-0', rockR: 10, state: 'open' }];
    const unit = { type: 'excavator', wear: 0, target: 'dep:ilmenite-0', haul: { phase: 'dig', full: false } };
    const rockPower = m.unitRates(s, mods, m.SITES.mare, unit, 'ilmenite').powerKW;
    const loosePower = m.unitRates(s, mods, m.SITES.mare, { ...unit, target: null }, 'ilmenite').powerKW;
    const old = m.createInitialState('mare', 7, 'human');
    old.techSchema = 4; old.era = 3; old.researchQueue = ['regolithProcessing'];
    old.researchSpent.regolithProcessing = 17; old.insights.regolithProcessing = 0.2; old.data = 61;
    const migrated = m.migrateTechSchema(old);
    const oldDone = m.createInitialState('mare', 8, 'human'); oldDone.techSchema = 4;
    oldDone.techsDone.push('regolithProcessing'); m.migrateTechSchema(oldDone);
    const newIds = ['bayExtensions', 'hardfacedTeeth', 'waterReclamation', 'waterElectrolysis', 'deepCoring', 'depotHalls'];
    const audit = m.auditTechs().filter((a: any) => newIds.includes(a.id));
    return { missing, ready, depth: mods.pitBedrockBenches, rockPower, loosePower,
      migration: { schema: old.techSchema, queue: old.researchQueue, spent: old.researchSpent.regolithProcessing,
        insight: old.insights.regolithProcessing, data: old.data, era: old.era, ...migrated },
      retainedDone: oldDone.techsDone.includes('regolithProcessing'), audit,
      early: ['siliconRefining', 'partsFabrication', 'moltenElectrolysis', 'heatRecoveryJackets', 'basaltPaving']
        .map((id) => m.TECHS[id].requires),
      waterAt: ['mare', 'southpole', 'lavatube'].map((site) => {
        const w = m.createInitialState(site, 1, 'human'); w.era = 4;
        w.techsDone.push(site === 'southpole' ? 'iceExtraction' : 'regolithVolatiles');
        return m.techAvailability('waterElectrolysis', w).state;
      }) };
  });
  expect(result.missing).toContain('Prospecting Drones');
  expect(result.ready).toBe('available');
  expect(result.depth).toBe(3);
  expect(result.rockPower).toBeCloseTo(result.loosePower * 1.25, 8);
  expect(result.migration).toEqual({ schema: 5, queue: ['regolithProcessing'], spent: 17, insight: 0.2, data: 61, era: 3, refund: 0, retired: [] });
  expect(result.retainedDone).toBe(true);
  expect(result.early.every((requires) => !requires.includes('regolithProcessing'))).toBe(true);
  expect(result.waterAt).toEqual(['available', 'available', 'available']);
  expect(result.audit).toHaveLength(6);
  for (const t of result.audit) { expect(t.pros).toBeGreaterThan(0); expect(t.cons).toBeGreaterThan(0); }
});

test('electrolysis is opt-in and conserves its split; reclamation stops when the plant is off', async ({ page }) => {
  await modules(page);
  const result = await page.evaluate(() => {
    const m = (window as any).M, make = (window as any).makeBuilding;
    const s = m.createInitialState('southpole', 42, 'human');
    const plant = make('waterPlant', 2); plant.hub = m.newHubState(); plant.hub.q = 1;
    const techs = ['iceExtraction', 'waterReclamation', 'waterElectrolysis'];
    const mods = m.computeMods(techs, 'human', 'southpole');
    const off = m.effectiveRates('waterPlant', mods, m.SITES.southpole, plant);
    plant.electrolysis = true;
    const on = m.effectiveRates('waterPlant', mods, m.SITES.southpole, plant);
    const locked = m.effectiveRates('waterPlant', m.computeMods([], 'human', 'southpole'), m.SITES.southpole, plant);
    const lockedOff = m.effectiveRates('waterPlant', m.computeMods([], 'human', 'southpole'), m.SITES.southpole, { ...plant, electrolysis: false });
    s.buildings = [plant];
    const live = m.waterReclaimFactor(s, mods);
    plant.active = false;
    const stopped = m.waterReclaimFactor(s, mods);
    // Exercise the economy: same settled base and stock, with the water
    // plant enabled or off. Produced water minus stock change is consumption.
    const run = (enabled: boolean, feed = 200) => {
      const q = m.createInitialState('southpole', 3, 'human'); q.techsDone.push(...techs); q.crew = 2;
      q.resources.water = 100; q.resources.regolith = feed; q.resources.food = 20;
      q.pile = 0; q.roads = [];
      const water = make('waterPlant', 2); water.hub = m.newHubState(); water.hub.seeded = true; water.hub.q = 1; water.enabled = enabled;
      // Water plants process their own delivered ice, never the plain pile.
      water.hub.hopper = feed;
      // Use the opposite previous active state: discounts must follow this
      // tick's actual plant operation, including a freshly starved plant.
      water.active = !enabled || feed === 0;
      q.buildings = [make('lander', 1), water, make('hydroponics', 3), make('reactor', 4), make('reactor', 5)];
      const before = q.resources.water;
      m.economyTick(q, m.SITES.southpole, m.computeMods(q.techsDone, 'human', 'southpole'), 1);
      return { consumed: before + q.stats.produced.water - q.resources.water,
        plant: water.active, farm: q.buildings[2].active };
    };
    const previewState = m.createInitialState('mare', 3, 'human');
    const previewPlant = make('waterPlant', 1);
    previewState.buildings = [previewPlant, make('hydroponics', 2)];
    const preview = m.previewTech('waterReclamation', previewState);
    const noReclaim = m.effectiveRates('waterPlant', m.computeMods([], 'human', 'mare'), m.SITES.mare, previewPlant);
    const withReclaim = m.effectiveRates('waterPlant', m.computeMods(['waterReclamation'], 'human', 'mare'), m.SITES.mare, previewPlant);
    return { off, on, locked, lockedOff, live, stopped, running: run(true), idle: run(false), starved: run(true, 0),
      preview, soilStillKW: withReclaim.powerKW - noReclaim.powerKW };
  });
  expect(result.on.outputs.water).toBeCloseTo(result.off.outputs.water * 0.6, 8);
  expect(result.on.outputs.oxygen).toBeCloseTo(result.off.outputs.water * 0.4 * 0.89, 8);
  // Test machine is agent-run: the stack shares the 1.6 operator tax.
  expect(result.on.powerKW - result.off.powerKW).toBeCloseTo(-16, 8);
  expect(result.locked.outputs).toEqual(result.lockedOff.outputs);
  expect(result.locked.powerKW).toBe(result.lockedOff.powerKW);
  expect(result.live).toBe(0.6); expect(result.stopped).toBe(1);
  expect(result.running.plant).toBe(true); expect(result.running.farm).toBe(true);
  expect(result.idle.farm).toBe(true);
  expect(result.running.consumed).toBeCloseTo(result.idle.consumed * 0.6, 8);
  expect(result.starved.plant).toBe(false); expect(result.starved.farm).toBe(true);
  expect(result.starved.consumed).toBeCloseTo(result.idle.consumed, 8);
  expect(result.preview.find((p) => p.type === 'hydroponics')?.dIn.water).toBeLessThan(0);
  expect(result.soilStillKW).toBeCloseTo(-4 * 1.6, 8);
});

test('Deep Coring reopens cut exhausted and boxed pits and carves below their old floor', async ({ page }) => {
  await modules(page);
  const results = await page.evaluate(() => {
    const m = (window as any).M;
    return ['exhausted', 'boxed'].map((state) => {
      const s = m.createInitialState('mare', 42, 'robotic'); s.buildings = []; s.roads = [];
      const hf = new m.Heightfield(m.SITES.mare, s.seed); m.bindTerrain(s, hf);
      const p = m.pitFor(s, m.digSiteKey(100, 100));
      m.digInto(s, p, 4000, 1); m.pitsStep(s, 10, m.computeMods([], 'robotic', 'mare'));
      const original = { anchor: p.anchor, floor: Math.min(...hf.delta), rim: p.R, cut: p.cutM3 };
      p.state = state; p.spent = state === 'exhausted'; p.at = s.terrain.clock;
      const base = m.computeMods([], 'robotic', 'mare');
      m.pitsStep(s, 0, base);
      const withoutResearch = p.state;
      const deep = m.computeMods(['deepCoring'], 'robotic', 'mare');
      m.pitsStep(s, 0, deep);
      const reopened = { state: p.state, target: p.rockTo, heldRim: p.rockR, news: [...p.news] };
      m.digInto(s, p, 4000, 1); m.pitsStep(s, 10, deep);
      return { state, original, withoutResearch, reopened, floor: Math.min(...hf.delta), cut: p.cutM3 };
    });
  });
  for (const r of results) {
    expect(r.original.anchor).toBeGreaterThanOrEqual(0);
    expect(r.withoutResearch).toBe(r.state);
    expect(r.reopened.state).toBe('open');
    expect(r.reopened.target).toBe(4);
    expect(r.reopened.heldRim).toBe(r.original.rim);
    expect(r.reopened.news).toContain('rock');
    expect(r.floor).toBeLessThan(r.original.floor);
    expect(r.cut).toBeGreaterThan(r.original.cut);
  }
});

test('Fleet OS adds a distinct physical bay without paying levels or occupying blocked ground', async ({ page }) => {
  await modules(page);
  const result = await page.evaluate(() => {
    const m = (window as any).M, make = (window as any).makeBuilding;
    const mods = m.computeMods(['fleetOS', 'bayExtensions', 'depotHalls'], 'robotic', 'mare');
    const setup = () => {
      const s = m.createInitialState('mare', 42, 'robotic');
      const b = make('smelter', 1); b.hub = m.newHubState(); b.hub.seeded = true;
      s.buildings = [b]; s.resources.metals = 1000; s.resources.parts = 1000;
      const [x, z] = m.doorCell(b), [fx, fz] = m.frontDir(b);
      const slot = (i: number) => {
        const side = i % 2 === 0 ? -1 : 1, d = Math.floor(i / 2) + 1;
        return [x + side * d * -fz, z + side * d * fx];
      };
      s.roads = [0, 1].map((i) => ({ gx: slot(i)[0], gz: slot(i)[1], left: 0, bay: true }));
      m.addUnit(s, b, m.SITES.mare); m.addUnit(s, b, m.SITES.mare);
      return { s, b, slot };
    };
    const { s, b } = setup();
    m.ensureHubs(s, mods, m.SITES.mare);
    const granted = { level: b.hub.level, cells: m.bayCells(s, b).length };
    const q = m.queueJob(s, mods, m.SITES.mare, b, 'unit');
    m.printTick(s, mods, m.SITES.mare, 1, new Set([b.id]));
    m.printTick(s, mods, m.SITES.mare, 100, new Set([b.id]));
    const parking = s.haulers.map((u: any) => m.bayPoint(s, b, u.bay).join(','));
    const levels = [];
    for (let i = 0; i < 2; i++) {
      const refusal = m.queueJob(s, mods, m.SITES.mare, b, 'bay');
      m.printTick(s, mods, m.SITES.mare, 1, new Set([b.id]));
      m.printTick(s, mods, m.SITES.mare, 100, new Set([b.id]));
      for (let j = 0; j < 3; j++) m.ensureHubs(s, mods, m.SITES.mare);
      levels.push({ refusal, level: b.hub.level, cells: m.bayCells(s, b).length });
    }
    const blocked = ['road', 'building', 'pit'].map((kind) => {
      const { s: a, b: h, slot } = setup(); const [gx, gz] = slot(2);
      if (kind === 'road') a.roads.push({ gx, gz, left: 0 });
      if (kind === 'building') { const obstacle = make('lab', 2, gx); obstacle.gz = gz; a.buildings.push(obstacle); }
      if (kind === 'pit') {
        const hf = new m.Heightfield(m.SITES.mare, a.seed); hf.delta[gz * 257 + gx] = -20; m.bindTerrain(a, hf);
      }
      const oldRoads = JSON.stringify(a.roads);
      m.ensureHubs(a, mods, m.SITES.mare);
      return { kind, refusal: m.queueRefusal(a, mods, h, 'unit'), sameRoads: JSON.stringify(a.roads) === oldRoads,
        ground: m.terrainOf(a) ? m.pitRefusal(a, m.terrainOf(a), gx, gz, gx + 1, gz + 1) : '',
        cells: m.bayCells(a, h).length, level: h.hub.level };
    });
    // A neighbor can be built after a paid upgrade entered the queue. The
    // finished job must retain its materials and wait, not grant a ghost bay.
    const waiting = setup(); m.ensureHubs(waiting.s, mods, m.SITES.mare);
    m.queueJob(waiting.s, mods, m.SITES.mare, waiting.b, 'bay');
    m.printTick(waiting.s, mods, m.SITES.mare, 1, new Set([waiting.b.id]));
    const [gx, gz] = waiting.slot(3); waiting.s.roads.push({ gx, gz, left: 0 }); m.bumpRoads(waiting.s);
    m.printTick(waiting.s, mods, m.SITES.mare, 100, new Set([waiting.b.id]));
    const held = { level: waiting.b.hub.level, cells: m.bayCells(waiting.s, waiting.b).length,
      queue: waiting.b.hub.queue.length, reason: waiting.b.hub.waiting };
    m.cancelJob(waiting.s, waiting.b, 0);
    return { granted, q, parking, levels, blocked, held,
      refunded: [waiting.s.resources.metals, waiting.s.resources.parts] };
  });
  expect(result.granted).toEqual({ level: 1, cells: 3 });
  expect(result.q).toBe(''); expect(result.parking).toHaveLength(3);
  expect(new Set(result.parking).size).toBe(3);
  expect(result.levels).toEqual([{ refusal: '', level: 2, cells: 4 }, { refusal: '', level: 3, cells: 5 }]);
  for (const b of result.blocked) {
    expect(b.refusal, JSON.stringify(b)).toContain('FLEET OS BAY BLOCKED');
    expect(b.sameRoads).toBe(true); expect(b.cells).toBe(2); expect(b.level).toBe(1);
  }
  expect(result.held).toMatchObject({ level: 1, cells: 3, queue: 1 });
  expect(result.held.reason).toContain('BAY BLOCKED');
  expect(result.refunded).toEqual([1000, 1000]);
});
