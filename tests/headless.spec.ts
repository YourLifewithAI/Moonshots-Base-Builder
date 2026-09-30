/** Headless stand-ins (docs/20 §4.2–4.3, stream W0b): what a rival base needs to run
 *  with nobody watching — a flat ground with the real site's deposits (FlatHeights),
 *  pits that are counted, not carved, straight-line legs and no traffic — and the
 *  proof that none of it reaches a base that does not ask for it.
 *
 *  The bases run in the page on the core alone (dynamic imports, as tests/hubPlanner.spec.ts):
 *  a Smelter by the guaranteed ilmenite is placed through the debug API (the pits spec's
 *  helper), its state is cloned, and the clones are ticked with `economyTick`, one on a real
 *  Heightfield in the default mode (what the game does), one on a FlatHeights bound to
 *  the headless mode. `BaseSim` (docs/20 §4.1) does this wiring in the game. */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

const URL_DEBUG = '/?debug&seed=42&site=mare&exp=robotic';

/** the pits spec's helpers: a structure near a world point, and a Smelter by the guaranteed high-Ti basalt, built */
const HELPERS = `(() => {
const g = () => window.__game;
window.PL = {
  place(type, x, z, maxR = 10, rots = [0, 1, 2, 3]) {
    const cx = Math.round((x + 512) / 4) - 1, cz = Math.round((z + 512) / 4) - 1;
    const ids = new Set(g().getState().buildings.map((b) => b.id));
    for (let r = 0; r <= maxR; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      for (const rot of rots) {
        if (!g().placeBuilding(type, cx + dx, cz + dz, rot)) continue;
        return g().getState().buildings.find((b) => !ids.has(b.id)).id;
      }
    }
    return null;
  },
  excavator() {
    const z = g().getZones().find((z) => z.kind === 'ilmenite');
    const l = Math.hypot(z.cx, z.cz) || 1;
    const out = z.r + 22;
    const id = PL.place('smelter', z.cx - (z.cx / l) * out, z.cz - (z.cz / l) * out, 8);
    g().finishConstruction();
    return id;
  },
};
})()`;

/** a booted debug game with a Smelter working the guaranteed ilmenite: the clock pinned, nothing ticked yet */
async function startBase(page: Page) {
  await page.goto(URL_DEBUG);
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => {
    const g = window.__game;
    g.setPaused(true);
    g.settleClock(90);
    g.advanceGameSeconds(0);
    g.holdHazards(true);
    g.grantResources({ metals: 20000, parts: 20000 });
  });
  await page.evaluate(HELPERS);
  await page.evaluate(() => { window.__game.grantPower(20000); (window as any).PL.excavator(); });
}

test('a flat site keeps the real deposits, reads flat, locks its pads and hashes the same twice', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const HF = await import('/src/terrain/heightfield.ts');
    const FH = await import('/src/terrain/flatHeights.ts');
    const S = await import('/src/data/sites.ts');
    const ST = await import('/src/core/state.ts');
    const E = await import('/src/core/economy.ts');
    const G = await import('/src/core/grading.ts');
    const PT = await import('/src/core/pits.ts');
    const N = 257;
    const sites: Record<string, any> = {};
    for (const id of ['mare', 'southpole', 'lavatube'] as const) {
      const site = S.SITES[id];
      const real = new HF.Heightfield(site, 42);
      const flat = new FH.FlatHeights(site, 42);
      const key = (hf: any) => hf.deposits.map((d: any) => `${d.id}:${d.kind}`);
      sites[id] = {
        same: JSON.stringify(key(real)) === JSON.stringify(key(flat)),
        n: real.deposits.length, nFlat: flat.deposits.length,
        // the ground itself: no craters, no bowl — and the real one is not flat
        realRough: real.maxDelta(0, 0, 256, 256) > 1,
        inside: flat.deposits.every((d: any) => Math.abs(d.cx) < 512 && Math.abs(d.cz) < 512 && d.r > 0),
      };
    }
    const site = S.SITES.mare;
    const flat = new FH.FlatHeights(site, 42);
    const flat2 = new FH.FlatHeights(site, 42);
    const real = new HF.Heightfield(site, 42);
    const real2 = new HF.Heightfield(site, 42);
    const out = new Float32Array(3);
    flat.gridNormal(40, 50, out, 0);
    const h0 = flat.terrainHash();
    const reads = {
      virtual: [flat.virtual, real.virtual],
      sample: [flat.sample(12.5, -80), flat.sampleGrid(3, 250), flat.baseHeight(400, -300), flat.baseHeight(9999, 9999)],
      normal: Array.from(out), maxDelta: flat.maxDelta(10, 10, 14, 14), ray: flat.raycast(0, 50, 0, 0.3, -1, 0.2),
      noRoad: flat.noRoad(100, 100), sizes: [flat.h.length, flat.delta.length, flat.padMask.length, flat.skirt.length, N * N],
    };
    // a pad marks the mask and reports the height it was given; a pit's delta is not written
    const pad = flat.flatten(120, 120, 123, 123);
    const padForced = flat.flatten(130, 130, 131, 131, 3.5);
    flat.setDelta(1000, -40);
    let masked = 0;
    for (let i = 0; i < flat.padMask.length; i++) masked += flat.padMask[i];
    const writes = { pad, padForced, masked, delta: flat.delta[1000], h: flat.h[1000], hash: flat.terrainHash() };
    flat2.flatten(120, 120, 123, 123); flat2.flatten(130, 130, 131, 131, 3.5);
    // the same hash for the same site, seed and pads; another seed's deposits do not change a flat ground's hash, pads do
    const hashes = {
      fresh: [h0, flat2.terrainHash() === writes.hash, new FH.FlatHeights(site, 42).terrainHash() === h0, h0 !== writes.hash],
      realStable: real.terrainHash() === real2.terrainHash(), realVsFlat: real.terrainHash() !== flat.terrainHash(),
    };
    // a virtual site refuses grading in words; saving it writes no grid
    const s = ST.createInitialState('mare', 42, 'robotic');
    const mods = E.refreshDerived(s);
    mods.grading = true;
    const gp = G.gradePlan(s, flat, mods, [120, 120, 124, 124]);
    PT.bindTerrain(s, flat);
    PT.saveTerrain(s, flat);
    const flatSaved = s.terrain.delta;
    const s2 = ST.createInitialState('mare', 42, 'robotic');
    real.setDelta(2000, -30);
    PT.bindTerrain(s2, real);
    PT.saveTerrain(s2, real);
    return { sites, reads, writes, hashes, grading: { ok: gp.ok, reason: gp.reason }, flatSaved, realSaved: s2.terrain.delta.length };
  });
  for (const id of ['mare', 'southpole', 'lavatube']) {
    expect(r.sites[id].same, `${id}: the flat site has the real site's deposits`).toBe(true);
    expect(r.sites[id].nFlat).toBe(r.sites[id].n);
    expect(r.sites[id].n).toBeGreaterThan(5);
    expect(r.sites[id].inside).toBe(true);
    expect(r.sites[id].realRough).toBe(true);
  }
  expect(r.reads.virtual).toEqual([true, false]);
  expect(r.reads.sample).toEqual([0, 0, 0, 0]);
  expect(r.reads.normal).toEqual([0, 1, 0]);
  expect(r.reads.maxDelta).toBe(0);
  expect(r.reads.ray).toBeNull();
  expect(r.reads.noRoad).toBe(false);
  expect(r.reads.sizes).toEqual(new Array(5).fill(257 * 257));
  // two pads: 4 × 4 and 2 × 2 samples locked (corners inclusive); the pit write is a no-op
  expect(r.writes.pad).toBe(0);
  expect(r.writes.padForced).toBe(3.5);
  expect(r.writes.masked).toBe(16 + 4);
  expect(r.writes.delta).toBe(0);
  expect(r.writes.h).toBe(0);
  expect(r.hashes.fresh.slice(1)).toEqual([true, true, true]);
  expect(r.hashes.realStable).toBe(true);
  expect(r.hashes.realVsFlat).toBe(true);
  expect(r.grading.ok).toBe(false);
  expect(r.grading.reason).toMatch(/VIRTUAL SITE/);
  expect(r.flatSaved).toBe('');
  expect(r.realSaved).toBeGreaterThan(0);
});

test('the per-state mode defaults to today, binds per base, and the debug switches stay the player\'s', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const SM = await import('/src/core/simMode.ts');
    const BS = await import('/src/core/baseSim.ts');
    const T = await import('/src/core/transit.ts');
    const TR = await import('/src/core/traffic.ts');
    const ST = await import('/src/core/state.ts');
    const a = ST.createInitialState('mare', 42, 'robotic');
    const b = ST.createInitialState('mare', 42, 'robotic');
    const headless = { headless: true, straightLegs: true, traffic: false, virtualPits: true, openRoads: false };
    const agree = [{ ...BS.PLAYER_MODE }, { ...SM.DEFAULT_MODE }, { ...SM.HEADLESS_MODE }];
    const fresh = { mode: { ...SM.modeOf(a) }, instant: SM.instantOf(a), off: SM.trafficOff(a), straight: SM.straightOf(a) };
    SM.bindMode(b, headless);
    const bound = { mode: { ...SM.modeOf(b) }, instant: SM.instantOf(b), off: SM.trafficOff(b), straight: SM.straightOf(b), aStill: { ...SM.modeOf(a) } };
    // the globals: one object each, read through the helpers, never by a headless base
    const same = [T.TRANSIT === SM.TRANSIT, TR.TRAFFIC === SM.TRAFFIC];
    TR.TRAFFIC.bypass = true; T.TRANSIT.instant = true;
    const debug = { aOff: SM.trafficOff(a), aInstant: SM.instantOf(a), bInstant: SM.instantOf(b), stats: TR.trafficStats(a).bypass };
    TR.TRAFFIC.bypass = false; T.TRANSIT.instant = false;
    const after = { aOff: SM.trafficOff(a), aInstant: SM.instantOf(a), stats: TR.trafficStats(a).bypass };
    return { fresh, bound, same, debug, after, headless, agree };
  });
  expect(r.fresh).toEqual({
    mode: { headless: false, straightLegs: false, traffic: true, virtualPits: false, openRoads: false },
    instant: false, off: false, straight: false,
  });
  // the defaults agree with the player's mode (core/baseSim.ts), and the headless constant is the five values below
  expect(r.agree[1]).toEqual(r.agree[0]);
  expect(r.agree[0]).toEqual(r.fresh.mode);
  expect(r.agree[2]).toEqual(r.headless);
  expect(r.bound.mode).toEqual(r.headless);
  expect([r.bound.instant, r.bound.off, r.bound.straight]).toEqual([false, true, true]);
  expect(r.bound.aStill).toEqual(r.fresh.mode);
  expect(r.same).toEqual([true, true]);
  // the player's debug instant travel and traffic bypass reach the default base; a headless base is never teleported
  expect(r.debug).toEqual({ aOff: true, aInstant: true, bInstant: false, stats: true });
  expect(r.after).toEqual({ aOff: false, aInstant: false, stats: false });
});

test('a headless base on a flat site digs a virtual pit that tracks a real pit, on straight legs, without traffic', async ({ page }) => {
  test.setTimeout(240_000);
  await startBase(page);
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const snap = JSON.stringify(g.getState());
    const gameHash = g.terrainHash();
    const S = await import('/src/data/sites.ts');
    const HF = await import('/src/terrain/heightfield.ts');
    const FH = await import('/src/terrain/flatHeights.ts');
    const H = await import('/src/core/hubs.ts');
    const PT = await import('/src/core/pits.ts');
    const SM = await import('/src/core/simMode.ts');
    const E = await import('/src/core/economy.ts');
    const T = await import('/src/core/transit.ts');
    const TR = await import('/src/core/traffic.ts');
    const HEADLESS = { ...SM.HEADLESS_MODE };
    /** the base cloned onto `kind` of ground, ticked `minutes` game-minutes (as Game.econStep: clock first, then the tick);
     *  the power topped up and the hopper emptied every half minute, so a unit never waits for either */
    const run = (kind: 'real' | 'flat', mode: any, minutes: number) => {
      const s = JSON.parse(snap);
      const site = S.SITES[s.siteId];
      const hf = kind === 'flat' ? new FH.FlatHeights(site, s.seed) : new HF.Heightfield(site, s.seed);
      for (const f of s.flattens) hf.flatten(f.x0, f.z0, f.x1, f.z1, f.h, !f.noSkirt);
      H.bindHeights(s, hf);
      PT.bindTerrain(s, hf);
      if (mode) SM.bindMode(s, mode);
      let mods = E.refreshDerived(s);
      const hash0 = hf.terrainHash();
      const hub = s.buildings.find((b: any) => b.hub);
      let cycles = 0;
      const phase = new Map<number, string>(), route = new Map<number, unknown>();
      const legs: number[] = [];
      const marks: Record<number, any> = {};
      for (let i = 1; i <= minutes * 60; i++) {
        if (i % 30 === 1) { s.powerStored += 5000; for (const b of s.buildings) if (b.hub) b.hub.hopper = 0; }
        s.simTime += 1;
        const ev = E.economyTick(s, site, mods, 1);
        if (ev.modsChanged) mods = E.modsFor(s);
        for (const u of s.haulers) {
          if (u.haul.phase === 'unload' && phase.get(u.id) !== 'unload') cycles++;
          phase.set(u.id, u.haul.phase);
          if (route.get(u.id) !== u.haul.route) { route.set(u.id, u.haul.route); if (i > 1) legs.push(u.haul.route?.length ?? 0); }
        }
        if (i % 600 === 0) {
          const p = s.pits.find((q: any) => q.key === 'dep:ilmenite-0');
          const t = H.targetOf(s, 'dep:ilmenite-0');
          marks[i / 60] = p ? {
            R: p.R, cutM3: p.cutM3, dugM3: p.dugM3, heapM3: p.heapM3, Rh: p.heap?.Rh ?? 0, faces: t?.faces, state: p.state,
            grade: PT.targetGrade(s, mods, site, 'smelter', 'dep:ilmenite-0'), cycles, free: p.free,
          } : null;
        }
      }
      return { s, hf, site, mods, hub, hash0, cycles, legs, marks };
    };
    const strip = (x: any) => ({
      hash0: x.hash0, hash: x.hf.terrainHash(), cycles: x.cycles, legs: x.legs, marks: x.marks, units: x.s.haulers.length,
      deltaTouched: x.hf.delta.some((d: number) => d !== 0), carved: x.hf.carved.length,
      pitZones: (x.s.zones ?? []).filter((z: any) => z.kind === 'pit').length, sig: x.hf.virtualSig,
      traffic: { units: TR.trafficInfo(x.s).units.length, held: TR.trafficStats(x.s).heldS, off: TR.trafficStats(x.s).bypass },
      roadRev: x.s.roadRev, roads: x.s.roads?.length ?? 0,
    });
    const realA = run('real', null, 20);
    const flatA = run('flat', HEADLESS, 20);
    const flatB = run('flat', HEADLESS, 20);
    const realB = run('real', null, 20);
    // the default base ran twice, the headless one between them: the same base (no module-level state leaked across)
    const realSame = JSON.stringify(realA.s) === JSON.stringify(realB.s), flatSame = JSON.stringify(flatA.s) === JSON.stringify(flatB.s);
    const roadRev0 = JSON.parse(snap).roadRev;
    // the trips: what the hub reckons one way from its door to face 0, as a real base and as a headless one
    const one = (x: any) => {
      const t = H.targetOf(x.s, 'dep:ilmenite-0')!;
      const from = H.standPoint(x.hub), face = H.facePoint(x.s, t, 0);
      return { trip: H.tripTo(x.s, x.mods, x.hub, t), v: H.unitSpeed(x.mods, 'excavator'), d: Math.hypot(face[0] - from[0], face[1] - from[1]) };
    };
    // a rover's trip: straight, charged, and it does not jump
    const rover = (x: any) => {
      const r0 = x.s.rovers[0];
      const [px, pz] = [r0.x, r0.z];
      const gx = 160, gz = 130, cx = -512 + (gx + 0.5) * 4, cz = -512 + (gz + 0.5) * 4;
      const goal = { key: 'probe', kind: 'weld', cell: [gx, gz], x: cx, z: cz };
      const trip = T.planTrip(x.s, r0, goal, 4, 1);
      return { pts: trip.pts.length, w: trip.w ?? null, dur: trip.dur, len: trip.len, moved: r0.x !== px || r0.z !== pz, dist: Math.hypot(cx - px, cz - pz), want: T.travelTime(Math.hypot(cx - px, cz - pz) * 1.3, 4, 1) };
    };
    // the pit's ground: where the pits step's own answers stand, for the placement check
    const fa = flatA;
    const p = fa.s.pits.find((q: any) => q.key === 'dep:ilmenite-0');
    const cellOf = (v: number) => Math.floor((v + 512) / 4);
    const gxRim = Math.ceil((p.cx + p.R + 512) / 4), gz0 = cellOf(p.cz);
    const refusals = {
      centre: PT.pitRefusal(fa.s, fa.hf, cellOf(p.cx), cellOf(p.cz), cellOf(p.cx) + 1, cellOf(p.cz) + 1),
      rim: PT.pitRefusal(fa.s, fa.hf, gxRim, gz0, gxRim + 1, gz0 + 1), rimGap: gxRim * 4 - 512 - p.cx - p.R,
      far: PT.pitRefusal(fa.s, fa.hf, 60, 60, 61, 61),
      heap: PT.pitRefusal(fa.s, fa.hf, cellOf(p.heap.x), cellOf(p.heap.z), cellOf(p.heap.x) + 1, cellOf(p.heap.z) + 1),
    };
    PT.saveTerrain(fa.s, fa.hf);
    const pv = PT.pitsView(fa.s, fa.hf).find((q: any) => q.key === 'dep:ilmenite-0');
    const ra = realA;
    PT.saveTerrain(ra.s, ra.hf);
    return {
      gameHash, replica: realA.hash0,
      real: strip(realA), flat: strip(flatA), flat2: strip(flatB), real2: strip(realB),
      realSame, flatSame, roadRev0,
      trips: { real: one(realA), flat: one(flatA) },
      rovers: { real: rover(realA), flat: rover(flatA) },
      refusals, pit: { anchor: pv.anchor, box: pv.box, scar: pv.scar, heap: pv.heap, deep: pv.deep, L: pv.L, free: pv.free, state: pv.state, key: pv.key, cutM3: pv.cutM3, samples: pv.samples },
      saved: { flat: fa.s.terrain.delta, real: ra.s.terrain.delta.length },
      pitCount: [ra.s.pits.length, fa.s.pits.length],
    };
  });
  // the bed the headless clone stands on is the game's: the real replica hashes as the running game does
  expect(r.replica).toBe(r.gameHash);
  // a default-mode base is the same base however often it runs and whatever ran between (the headless base leaks nothing into it)
  expect(r.realSame).toBe(true);
  expect(r.real.traffic.off).toBe(false);
  expect(r.real.traffic.units).toBeGreaterThan(0);
  expect(r.real.deltaTouched).toBe(true);
  // the headless base is deterministic, and its hash moved with its pit (radii in the signature), its grid did not
  expect(r.flatSame).toBe(true);
  expect(r.flat.hash).toBe(r.flat2.hash);
  expect(r.flat.hash).not.toBe(r.flat.hash0);
  expect(r.flat.hash0).toBe(r.flat2.hash0);
  expect(r.flat.sig).toBeGreaterThan(0);
  expect(r.flat.deltaTouched).toBe(false);
  expect(r.flat.carved).toBe(0);
  expect(r.flat.pitZones).toBe(0);
  expect(r.pitCount).toEqual([1, 1]);
  // no traffic: nothing reserved, nobody held
  expect(r.flat.traffic).toEqual({ units: 0, held: 0, off: true });
  // straight legs: every leg it planned is at most the line cut at a zone's rim (three pieces); the network never changed
  expect(r.flat.legs.length).toBeGreaterThan(10);
  expect(Math.max(...r.flat.legs)).toBeLessThanOrEqual(4);
  expect(r.flat.roadRev).toBe(r.roadRev0);
  // the virtual pit: a pit's fields, derived from its volume
  const pit = r.pit;
  expect(pit.key).toBe('dep:ilmenite-0');
  expect(pit.state).toBe('open');
  expect(pit.anchor).toBeGreaterThan(0);
  expect(pit.box[2]).toBeGreaterThan(pit.box[0]);
  expect(pit.box[3]).toBeGreaterThan(pit.box[1]);
  expect(pit.scar).toBeGreaterThan(400);
  expect(pit.free).toBe(1);
  expect(pit.deep).toBeGreaterThan(3);
  expect(pit.deep).toBeLessThanOrEqual(pit.L);
  expect(pit.heap.Rh).toBeGreaterThan(5);
  expect(pit.samples).toBe(0);
  expect(r.saved.flat).toBe('');
  expect(r.saved.real).toBeGreaterThan(100);
  // the placement check reads the pit as discs: on it, at its rim, clear of it, on its spoil
  expect(r.refusals.centre).toMatch(/^ON A PIT/);
  expect(r.refusals.rimGap).toBeGreaterThanOrEqual(0);
  expect(r.refusals.rimGap).toBeLessThan(4);
  expect(r.refusals.rim).toMatch(/^TOO CLOSE TO A PIT/);
  expect(r.refusals.far).toBe('');
  expect(r.refusals.heap).toMatch(/^ON SPOIL/);
  // within 10 % of the real pit on real ground, at 10 and 20 game-minutes: rim, faces, cut, spoil, grade
  const near = (a: number, b: number, tol = 0.1) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b));
  for (const m of [10, 20]) {
    const a = r.real.marks[m], b = r.flat.marks[m];
    expect(a && b, `a pit at ${m} min`).toBeTruthy();
    expect(near(a.R, b.R), `rim at ${m} min: ${a.R} vs ${b.R}`).toBe(true);
    expect(Math.abs(b.faces - a.faces), `faces at ${m} min: ${a.faces} vs ${b.faces}`).toBeLessThanOrEqual(1);
    expect(near(a.cutM3, b.cutM3), `cut at ${m} min: ${a.cutM3} vs ${b.cutM3}`).toBe(true);
    expect(near(a.heapM3, b.heapM3), `heap at ${m} min: ${a.heapM3} vs ${b.heapM3}`).toBe(true);
    expect(near(a.grade, b.grade), `grade at ${m} min: ${a.grade} vs ${b.grade}`).toBe(true);
    // the same number of dig-and-tip cycles, ±10 % (a whole cycle where they are few)
    expect(Math.abs(a.cycles - b.cycles), `cycles at ${m} min: ${a.cycles} vs ${b.cycles}`).toBeLessThanOrEqual(Math.max(1, 0.1 * a.cycles));
  }
  expect(r.real.cycles).toBeGreaterThan(8);
  expect(Math.abs(r.real.cycles - r.flat.cycles)).toBeLessThanOrEqual(Math.max(1, 0.1 * r.real.cycles));
  // the trip the hub reckons: connected, and never faster than the straight line (the road grid and the zone's off-road are charged)
  expect(r.trips.flat.trip.connected).toBe(true);
  expect(r.trips.flat.trip.t).toBeGreaterThan(r.trips.flat.d / r.trips.flat.v);
  expect(near(r.trips.real.trip.t, r.trips.flat.trip.t, 0.3)).toBe(true);
  // a headless rover's trip is the straight line, charged at the road grid's stand-in, and it does not jump
  expect(r.rovers.flat.pts).toBe(2);
  expect(r.rovers.flat.w).toEqual([1.3]);
  expect(r.rovers.flat.moved).toBe(false);
  expect(r.rovers.flat.dur).toBeCloseTo(r.rovers.flat.want, 6);
  expect(r.rovers.flat.dur).toBeGreaterThan(r.rovers.flat.dist / 4);
  expect(r.rovers.real.moved).toBe(false);
});
