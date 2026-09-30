/** Sim traffic (docs/19 S4a, core/traffic.ts): the sim half. The sim reserves
 *  road cells (and a pit's ramp): a unit holds the cell it stands in, the one it
 *  just left and the run ahead to the next passing or holding bay; a loaded digger
 *  before an empty one before a rover; a unit refused waits where it stands (or in
 *  a bay), and steps aside when it stands in a higher-priority unit's way.
 *
 *  The second `describe` is the integration half (docs/19 S4b, world/haulers.ts,
 *  world/traffic.ts): the hub units as drawn follow the sim's own path, a tick
 *  late and exactly, so a head-on pass at a bay needs no rescue and no set-down,
 *  the picture never trails far behind, never jumps more than a metre a frame at
 *  1x, never turns faster than 90 deg/s, and units at one pit keep 2.5 m apart. */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

const URL_DEBUG = '/?debug&seed=42';

async function start(page: Page, site = 'mare', exp: 'human' | 'robotic' = 'robotic') {
  await page.goto(`${URL_DEBUG}&site=${site}${exp === 'robotic' ? '&exp=robotic' : ''}`);
  await page.waitForFunction(() => window.__game !== undefined && window.__game.getState() !== null);
  await page.evaluate(() => {
    const g = window.__game!;
    g.setPaused(true);
    g.advanceGameSeconds(0);
    g.holdHazards(true);
    g.openRoads(true);
    g.grantResources({ metals: 2000, parts: 1000, silicon: 300 });
    g.grantPower(20000);
  });
  await page.evaluate(HELPERS);
}

declare function hubBy(type: string, depId: string | null, x?: number, z?: number, off?: number): number | null;
declare function byId(id: number): any;
declare function units(hub?: number): any[];
declare function power(n: number): number;
declare function cellXZ(gx: number, gz: number): [number, number];
declare function corridor(gx0: number, gz: number, n: number, pockets: number[]): [number, number][];
declare function setupPair(): { hub: number; a: number; b: number };
declare function sample(): any;
const HELPERS = `(() => {
/** place a hub just outside a deposit's ring (door toward it); its id */
window.hubBy = (type, depId, x, z, off = 0) => {
  const g = window.__game;
  const d = depId ? g.getDeposits().find((q) => q.id === depId) : { x, z, r: 0 };
  const cgx = Math.floor((d.x + 512) / 4), cgz = Math.floor((d.z + 512) / 4);
  const R0 = Math.ceil(d.r / 4) + off;
  for (let rr = R0; rr <= R0 + 16; rr++) {
    const found = [];
    for (let i = -rr; i <= rr; i++) for (const [gx, gz] of [[cgx + i, cgz - rr], [cgx + i, cgz + rr], [cgx - rr, cgz + i], [cgx + rr, cgz + i]]) {
      for (const rot of [0, 1, 2, 3]) {
        if (!g.canPlace(type, gx, gz, rot).valid) continue;
        const w = (rot % 2 ? 2 : 3), dd = (rot % 2 ? 3 : 2);
        found.push({ gx, gz, rot, dist: Math.hypot((gx + w / 2) * 4 - 512 - d.x, (gz + dd / 2) * 4 - 512 - d.z) });
      }
    }
    found.sort((a, b) => a.dist - b.dist || a.gx - b.gx || a.gz - b.gz || a.rot - b.rot);
    for (const f of found) if (g.placeBuilding(type, f.gx, f.gz, f.rot)) return g.getState().buildings[g.getState().buildings.length - 1].id;
  }
  return null;
};
window.byId = (id) => window.__game.getState().buildings.find((b) => b.id === id);
window.units = (hub) => window.__game.getState().haulers.filter((u) => hub === undefined || u.hub === hub);
window.power = (n) => {
  const g = window.__game;
  let placed = 0;
  for (let r = 0; r < 30 && placed < n; r++) for (let dx = -r; dx <= r && placed < n; dx++) for (let dz = -r; dz <= r && placed < n; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    const gx = 118 + dx * 2, gz = 118 + dz * 2;
    if (g.canPlace('solar', gx, gz, 0).valid && g.placeBuilding('solar', gx, gz, 0)) placed++;
  }
  return placed;
};
window.cellXZ = (gx, gz) => [(gx + 0.5) * 4 - 512, (gz + 0.5) * 4 - 512];
/** a straight one-lane road of n open cells along +x from (gx0, gz), far from the base; a passing bay
 *  beside each cell index in pockets. Returns the cells' centres. */
window.corridor = (gx0, gz, n, pockets) => {
  const g = window.__game;
  const cells = [];
  for (let i = 0; i < n; i++) cells.push({ gx: gx0 + i, gz });
  for (const i of pockets) cells.push({ gx: gx0 + i, gz: gz + 1, pass: true });
  g.setRoadFlags(cells);
  return Array.from({ length: n }, (_, i) => window.cellXZ(gx0 + i, gz));
};
/** a smelter with two units (the second printed), both waiting in their bays */
window.setupPair = () => {
  const g = window.__game;
  const hub = window.hubBy('smelter', 'ilmenite-0', undefined, undefined, 6);
  window.power(12);
  g.finishConstruction();
  g.queueUnit(hub);
  g.advanceGameSeconds(70);
  const us = window.units(hub);
  return { hub, a: us[0].id, b: us[1].id };
};
window.sample = () => {
  const g = window.__game;
  const tr = g.getTraffic();
  return { overlaps: tr.overlaps, forced: tr.forced, stepAsides: tr.stepAsides, pullIns: tr.pullIns, heldS: tr.heldS, cells: tr.cells };
};
})()`;

test('no two units share a reserved cell: four diggers of two hubs on one deposit\'s roads, half an hour, every one of them working', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.revealAll();
    const h1 = hubBy('smelter', 'ilmenite-0', undefined, undefined, 6)!;
    const h2 = hubBy('smelter', 'ilmenite-0', undefined, undefined, 9)!;
    power(20);
    g.finishConstruction();
    g.queueUnit(h1); g.queueUnit(h1); g.queueUnit(h2); g.queueUnit(h2);
    g.advanceGameSeconds(150);
    let worst = 0, overlaps = 0, held = 0;
    const phases = new Map<number, Set<string>>();
    for (let i = 0; i < 900; i++) {
      g.advanceGameSeconds(2);
      g.grantPower(800);
      const q = sample();
      worst = Math.max(worst, worstCell(q.cells));
      overlaps = Math.max(overlaps, q.overlaps);
      for (const u of units()) {
        held = Math.max(held, u.haul.held ?? 0);
        (phases.get(u.id) ?? phases.set(u.id, new Set()).get(u.id)!).add(u.haul.phase);
      }
    }
    const q = sample();
    return { n: units().length, worst, overlaps, held, forced: q.forced, heldS: q.heldS, phases: [...phases].map(([id, s]) => [id, [...s]]), produced: g.getState().stats.produced.regolith };
    function worstCell(cells: Record<string, number[]>) { return Math.max(0, ...Object.entries(cells).filter(([k]) => !k.startsWith('ramp')).map(([, l]) => l.length)); }
  });
  expect(r.n).toBe(4);
  // never two on one road cell, and no unit had to drive through another
  expect(r.worst).toBeLessThanOrEqual(1);
  expect(r.overlaps).toBe(0);
  expect(r.forced).toBe(0);
  // held up now and then, never for long; every unit went out, dug and came back
  expect(r.held).toBeLessThan(40);
  for (const [, ph] of r.phases) for (const p of ['toDig', 'dig', 'toDrop', 'unload']) expect(ph).toContain(p);
  expect(r.produced).toBeGreaterThan(1500);
});

test('a loaded unit has priority: head on at a passing bay, the empty one pulls in and waits there while the loaded one goes by', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    const { a, b } = setupPair();
    // a one-lane road of nine cells with a passing bay beside its ends and its middle
    const c = corridor(60, 60, 9, [0, 4, 8]);
    const pocket0 = cellXZ(60, 61);
    // a: loaded, at the east end heading west · b: empty, at the west end heading east
    g.patchHauler(a, { x: c[8][0], z: c[8][1], phase: 'toDrop', regolith: 100, path: c.slice(0, 8).reverse(), target: null });
    g.patchHauler(b, { x: c[0][0], z: c[0][1], phase: 'toDig', regolith: 0, path: c.slice(1), target: null });
    let inBay = false, worst = 0, aHeld = 0, aMin = Infinity, bMax = -Infinity, aPassedWhileBInBay = false;
    for (let i = 0; i < 60; i++) {
      g.advanceGameSeconds(1);
      const ua = units().find((u: any) => u.id === a), ub = units().find((u: any) => u.id === b);
      const q = sample();
      worst = Math.max(worst, worstCell(q.cells));
      aHeld = Math.max(aHeld, ua.haul.held ?? 0);
      aMin = Math.min(aMin, ua.haul.x);
      bMax = Math.max(bMax, ub.haul.x);
      // in the bay: its cell, beside the road's, and not on the lane
      const inPocket = Math.abs(ub.haul.x - pocket0[0]) < 2 && ub.haul.z > c[0][1] + 2;
      if (inPocket) inBay = true;
      // a drives by the cell b's bay is beside while b sits in it
      if (inPocket && Math.abs(ua.haul.x - c[0][0]) < 2 && Math.abs(ua.haul.z - c[0][1]) < 1) aPassedWhileBInBay = true;
    }
    const q = sample();
    return { c, inBay, aPassedWhileBInBay, worst, aHeld, aMin, bMax, q };
    function worstCell(cells: Record<string, number[]>) { return Math.max(0, ...Object.entries(cells).filter(([k]) => !k.startsWith('ramp')).map(([, l]) => l.length)); }
  });
  // the loaded unit hardly waited; the empty one pulled into the bay beside its end (counted) and let it by
  expect(r.aHeld).toBeLessThan(3);
  expect(r.inBay).toBe(true);
  expect(r.aPassedWhileBInBay).toBe(true);
  expect(r.q.pullIns).toBeGreaterThanOrEqual(1);
  // never two on a cell, and nobody drove through anybody
  expect(r.worst).toBeLessThanOrEqual(1);
  expect(r.q.overlaps).toBe(0);
  expect(r.q.forced).toBe(0);
  // the loaded one went the whole way west; the empty one came out of the bay and on east
  expect(r.aMin).toBeLessThan(r.c[1][0]);
  expect(r.bMax).toBeGreaterThan(r.c[6][0]);
});

test('with no passing bay on the road the unit that is in the way steps aside onto the ground beside it, after a moment, and both get on', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    const { a, b } = setupPair();
    const c = corridor(60, 60, 9, []);
    g.patchHauler(a, { x: c[8][0], z: c[8][1], phase: 'toDrop', regolith: 100, path: c.slice(0, 8).reverse(), target: null });
    g.patchHauler(b, { x: c[0][0], z: c[0][1], phase: 'toDig', regolith: 0, path: c.slice(1), target: null });
    let aHeld = 0, bAside = 0, worst = 0, aMin = Infinity, bMax = -Infinity;
    for (let i = 0; i < 90; i++) {
      g.advanceGameSeconds(1);
      const ua = units().find((u: any) => u.id === a), ub = units().find((u: any) => u.id === b);
      aHeld = Math.max(aHeld, ua.haul.held ?? 0);
      // b off the lane: the ground beside the road
      bAside = Math.max(bAside, Math.abs(ub.haul.z - c[0][1]));
      aMin = Math.min(aMin, ua.haul.x);
      bMax = Math.max(bMax, ub.haul.x);
      worst = Math.max(worst, worstCell(sample().cells));
    }
    return { c, aHeld, bAside, worst, aMin, bMax, q: sample() };
    function worstCell(cells: Record<string, number[]>) { return Math.max(0, ...Object.entries(cells).filter(([k]) => !k.startsWith('ramp')).map(([, l]) => l.length)); }
  });
  expect(r.q.stepAsides).toBeGreaterThanOrEqual(1);
  expect(r.bAside).toBeGreaterThan(2);
  // the wait is bounded: a moment, not the 20 s a deadlock would take
  expect(r.aHeld).toBeLessThan(10);
  expect(r.q.forced).toBe(0);
  expect(r.worst).toBeLessThanOrEqual(1);
  expect(r.aMin).toBeLessThan(r.c[1][0]);
  expect(r.bMax).toBeGreaterThan(r.c[6][0]);
});

test('a second unit sent to a pit with every face working waits in the holding bay beside the gate, never on the gate', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    const { b } = setupPair();
    const z = g.getZones().find((q: any) => q.id === 'ilmenite-0');
    const zc = new Set(z.cells.map((c: number[]) => c.join(',')));
    const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const holds = () => g.getState().roads.filter((c: any) => c.hold === 'ilmenite-0');
    // the haul road the hub laid has a holding bay beside its gate (docs/19 S3); a base without one (an old save) gets a flag by hand
    const laid = holds().length;
    if (!laid) {
      const roads = new Map(g.getState().roads.map((c: any) => [c.gx + ',' + c.gz, c]));
      const gate = z.gates[0];
      let approach: number[] | null = null;
      for (const [dx, dz] of N4) { const k = (gate[0] + dx) + ',' + (gate[1] + dz); if (roads.has(k) && !zc.has(k)) { approach = [gate[0] + dx, gate[1] + dz]; break; } }
      let hold: number[] | null = null;
      for (let d = 1; d <= 3 && !hold; d++) for (const [dx, dz] of N4) {
        const c = [approach![0] + dx * d, approach![1] + dz * d];
        if (roads.has(c.join(',')) || zc.has(c.join(','))) continue;
        if (N4.some(([p, q]) => zc.has((c[0] + p) + ',' + (c[1] + q)))) continue;
        hold = c; break;
      }
      g.setRoadFlags([{ gx: hold![0], gz: hold![1], hold: 'ilmenite-0' }]);
    }
    const spots = holds().map((c: any) => cellXZ(c.gx, c.gz));
    const gates = z.gates.map((c: number[]) => cellXZ(c[0], c[1]));
    g.sendUnit(b, 'dep:ilmenite-0');
    // the new pit has one face: the first unit works it, the sent one waits
    let waited = 0, onGate = 0, arrived = false, strayed = 0, gateHeld = 0;
    for (let i = 0; i < 300; i++) {
      g.advanceGameSeconds(2);
      const ub = units().find((u: any) => u.id === b);
      if (ub.face >= 1) break;
      if (ub.haul.wait === 'gate') {
        waited++;
        const there = spots.some(([x, zz]: number[]) => Math.hypot(ub.haul.x - x, ub.haul.z - zz) < 1);
        // once it has got to the holding bay it stays there while it waits
        if (there) arrived = true; else if (arrived) strayed++;
        // (the bay is beside the gate: on its way there it may cross the gate's cell, but it waits in the bay)
        if (arrived && gates.some(([x, zz]: number[]) => Math.hypot(ub.haul.x - x, ub.haul.z - zz) < 2.5)) onGate++;
      }
      // once it is in the bay, the gate cell is never the waiting unit's
      const cells = sample().cells;
      if (arrived) for (const gt of z.gates) if ((cells[gt.join(',')] ?? []).includes(b)) gateHeld++;
    }
    const ub = units().find((u: any) => u.id === b);
    return { laid, waited, arrived, strayed, onGate, gateHeld, face: ub.face, phase: ub.haul.phase };
  });
  // (the base the hub laid its own haul road on has the bay flagged: nothing was placed by hand)
  expect(r.laid).toBeGreaterThan(0);
  expect(r.waited).toBeGreaterThan(20);
  // in the holding bay the whole time it waits, and never on (or holding) the gate
  expect(r.arrived).toBe(true);
  expect(r.strayed).toBe(0);
  expect(r.onGate).toBe(0);
  expect(r.gateHeld).toBe(0);
  // and when a face opened as the pit widened, it went in
  expect(r.face).toBeGreaterThanOrEqual(1);
});

test('a rover waits for a digger\'s reservation and its trip\'s ETA stretches; a digger is never held up by a rover', async ({ page }) => {
  await start(page, 'mare', 'human');
  const r = await page.evaluate(() => {
    const g = window.__game!;
    const { a, b } = setupPair();
    // the hub's other unit stays in its bay: the digger's road is the rover's alone
    g.recallUnit(b);
    g.advanceGameSeconds(5);
    g.grantResources({ metals: 500, parts: 500 });
    // a habitat's rover sets off along the road
    const near = (type: string, x: number, z: number) => {
      const c = { gx: Math.round((x + 512) / 4), gz: Math.round((z + 512) / 4) };
      for (let rr = 0; rr < 16; rr++) for (let dx = -rr; dx <= rr; dx++) for (let dz = -rr; dz <= rr; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== rr) continue;
        for (const rot of [0, 1, 2, 3]) if (g.canPlace(type, c.gx + dx, c.gz + dz, rot).valid && g.placeBuilding(type, c.gx + dx, c.gz + dz, rot)) return true;
      }
      return false;
    };
    near('habitat', 40, 30);
    g.finishRoads();
    g.advanceGameSeconds(1);
    const s0 = g.getState();
    const site = s0.buildings[s0.buildings.length - 1];
    const rv = s0.rovers.find((x: any) => x.site === site.id);
    const trip = rv.trip;
    // a loaded digger appears on the rover's way, heading back along it: head on
    const cells = trip.pts.slice(1, -1);
    const k = Math.min(cells.length - 1, 6);
    g.patchHauler(a, { x: cells[k][0], z: cells[k][1], phase: 'toDrop', regolith: 100, path: cells.slice(0, k).reverse(), target: null });
    let held = 0, arrivedAt = -1, aHeld = 0;
    const t0 = g.getState().simTime;
    for (let i = 0; i < 120; i++) {
      g.advanceGameSeconds(1);
      const s = g.getState();
      const u = s.rovers.find((x: any) => x.id === rv.id);
      held = Math.max(held, u.trip.held ?? 0);
      aHeld = Math.max(aHeld, units().find((x: any) => x.id === a).haul.held ?? 0);
      if (u.trip.t >= u.trip.dur - 1e-9 && arrivedAt < 0) arrivedAt = s.simTime - t0;
    }
    return { held, arrivedAt, dur: trip.dur, aHeld, forced: sample().forced };
  });
  // the rover was held (its clock waited); the trip took longer than its undisturbed time, and it still got there
  expect(r.held).toBeGreaterThan(0);
  expect(r.arrivedAt).toBeGreaterThan(r.dur + 1);
  expect(r.arrivedAt).toBeGreaterThan(0);
  // the digger did not wait for the rover
  expect(r.aHeld).toBe(0);
  expect(r.forced).toBe(0);
});

test('determinism: an hour of two hubs\' units from seed 42, twice from the same save, ends with every unit in the same place and the same reservations', async ({ page }) => {
  test.setTimeout(300_000);
  await start(page);
  const both = await page.evaluate(() => {
    const g = window.__game!;
    g.revealAll();
    const h1 = hubBy('smelter', 'ilmenite-0', undefined, undefined, 6)!;
    const h2 = hubBy('smelter', 'ilmenite-0', undefined, undefined, 9)!;
    power(20);
    g.finishConstruction();
    g.queueUnit(h1); g.queueUnit(h1); g.queueUnit(h2); g.queueUnit(h2);
    g.advanceGameSeconds(150);
    const blob = JSON.parse(JSON.stringify(g.saveBlob()));
    const hour = () => {
      g.advanceGameMinutes(60);
      const tr = g.getTraffic();
      return {
        units: units().map((u: any) => ({ id: u.id, x: u.haul.x, z: u.haul.z, phase: u.haul.phase, held: u.haul.held ?? 0, claim: u.haul.claim ?? [], cargo: u.haul.cargo, face: u.face, target: u.target })),
        traffic: { heldS: tr.heldS, stepAsides: tr.stepAsides, pullIns: tr.pullIns, forced: tr.forced, cells: tr.cells },
        terrain: g.terrainHash(),
        hoppers: [h1, h2].map((id) => byId(id).hub.hopper),
        t: g.getState().simTime,
      };
    };
    const one = hour();
    g.loadBlob(JSON.parse(JSON.stringify(blob)));
    g.setPaused(true);
    g.advanceGameSeconds(0);
    const two = hour();
    return { one, two, t0: blob.state.simTime };
  });
  expect(both.one.units.length).toBe(4);
  // an hour on: the runs began at one simTime, and end at the same
  expect(both.one.t).toBeCloseTo(both.t0 + 3600, 6);
  expect(both.two).toEqual(both.one);
});

test('a save made with units held up on the road loads with their claims, and the traffic goes on without a collision', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page);
  const r = await page.evaluate(async () => {
    const g = window.__game!;
    g.revealAll();
    const h1 = hubBy('smelter', 'ilmenite-0', undefined, undefined, 6)!;
    const h2 = hubBy('smelter', 'ilmenite-0', undefined, undefined, 9)!;
    power(20);
    g.finishConstruction();
    g.queueUnit(h1); g.queueUnit(h1); g.queueUnit(h2); g.queueUnit(h2);
    g.advanceGameSeconds(700);
    const blob = g.saveBlob();
    const claims = blob.state.haulers.map((u: any) => u.haul.claim ?? []).filter((c: number[]) => c.length);
    await g.loadBlob(JSON.parse(JSON.stringify(blob)));
    g.setPaused(true);
    g.advanceGameSeconds(1);
    let worst = 0;
    for (let i = 0; i < 300; i++) { g.advanceGameSeconds(2); g.grantPower(800); worst = Math.max(worst, worstCell(sample().cells)); }
    const q = sample();
    return { claims: claims.length, worst, overlaps: q.overlaps, forced: q.forced, n: units().length };
    function worstCell(cells: Record<string, number[]>) { return Math.max(0, ...Object.entries(cells).filter(([k]) => !k.startsWith('ramp')).map(([, l]) => l.length)); }
  });
  expect(r.n).toBe(4);
  // units on the road at the save carried their claims in it
  expect(r.claims).toBeGreaterThan(0);
  expect(r.worst).toBeLessThanOrEqual(1);
  expect(r.overlaps).toBe(0);
  expect(r.forced).toBe(0);
});


// ───────────────────────────── the picture: hub units follow the sim (docs/19 S4b) ─────────────────────────────

declare function live(frames: number, watch?: (i: number, life: any) => boolean | void): any;
const LIVE = `(() => {
/** live frames at 1x (a frame is 0.05 s), power topped up; per frame the hub units' drawn poses are compared with
 *  the last frame's (the largest step, the fastest turn) and with each other (the least distance between two
 *  origins); the counters the picture keeps are read at the end. watch(i, life) may return true to stop. */
window.live = (frames, watch) => {
  const g = window.__game;
  g.setPaused(false);
  g.setSpeed(1);
  g.stepFrame(0);
  // (the sim time the picture never showed, before the first frame, is a jump: what it counts from here is the run's)
  const l0 = g.getRenderInfo().life;
  const base = { rescues: l0.traffic.rescues, setDowns: l0.haulers.setDowns + l0.rovers.setDowns, snaps: l0.haulers.snaps };
  const DT = 0.05;
  const prev = new Map();
  const out = { frames: 0, jump: 0, jumpAt: '', turn: 0, minD: Infinity, minAt: '', lagMaxS: 0, replayLagMaxS: 0 };
  let life = null;
  for (let i = 0; i < frames; i++) {
    if (i % 20 === 0) g.grantPower(20000);
    g.stepFrame(DT);
    life = g.getRenderInfo().life;
    out.frames = i + 1;
    out.lagMaxS = Math.max(out.lagMaxS, life.haulers.lagMaxS);
    out.replayLagMaxS = Math.max(out.replayLagMaxS, life.haulers.replayLagMaxS);
    const ps = life.haulers.poses;
    for (const p of ps) {
      const q = prev.get(p.id);
      if (q) {
        const d = Math.hypot(p.x - q.x, p.z - q.z);
        if (d > out.jump) { out.jump = d; out.jumpAt = p.id + '@' + i; }
        out.turn = Math.max(out.turn, Math.abs(Math.atan2(Math.sin(p.yaw - q.yaw), Math.cos(p.yaw - q.yaw))) / DT);
      }
      prev.set(p.id, p);
    }
    for (let a = 0; a < ps.length; a++) for (let b = a + 1; b < ps.length; b++) {
      const d = Math.hypot(ps[a].x - ps[b].x, ps[a].z - ps[b].z);
      if (d < out.minD) { out.minD = d; out.minAt = ps[a].id + '/' + ps[b].id + '@' + i; }
    }
    if (watch && watch(i, life)) break;
  }
  g.setPaused(true);
  g.stepFrame(0);
  const h = life.haulers;
  out.rescues = life.traffic.rescues - base.rescues;
  out.courtesies = life.traffic.courtesies;
  out.setDowns = h.setDowns + life.rovers.setDowns - base.setDowns;
  out.snaps = h.snaps - base.snaps;
  return out;
};
})()`;

test.describe('the picture follows the sim (docs/19 S4b)', () => {
  /** a hub unit's turn, rad/s: 90 deg/s at most (the poses are rounded to a milli-radian a frame of 0.05 s) */
  const TURN_MAX = Math.PI / 2 + 0.03;

  test('two excavators head on along one haul road pass at a bay: no rescue, no set-down, never 3 s behind the sim, no jump, no fast turn', async ({ page }) => {
    await start(page);
    await page.evaluate(LIVE);
    const r = await page.evaluate(() => {
      const g = window.__game!;
      const { a, b } = setupPair();
      const c = corridor(60, 60, 9, [0, 4, 8]);
      g.patchHauler(a, { x: c[8][0], z: c[8][1], phase: 'toDrop', regolith: 100, path: c.slice(0, 8).reverse(), target: null });
      g.patchHauler(b, { x: c[0][0], z: c[0][1], phase: 'toDig', regolith: 0, path: c.slice(1), target: null });
      let aMin = Infinity, bMax = -Infinity;
      const out = live(900, () => {
        const ua = units().find((u: any) => u.id === a), ub = units().find((u: any) => u.id === b);
        aMin = Math.min(aMin, ua.haul.x);
        bMax = Math.max(bMax, ub.haul.x);
        return aMin < c[1][0] && bMax > c[6][0];
      });
      return { ...out, aMin, bMax, c, pullIns: sample().pullIns };
    });
    // the loaded one went the whole way west, the empty one pulled into a bay, let it by and went on east
    expect(r.pullIns).toBeGreaterThanOrEqual(1);
    expect(r.aMin).toBeLessThan(r.c[1][0]);
    expect(r.bMax).toBeGreaterThan(r.c[6][0]);
    // nobody was rescued or set down, and the picture kept up with the sim (a tick late, and the turns in a bay)
    expect(r.rescues).toBe(0);
    expect(r.setDowns).toBe(0);
    expect(r.snaps).toBe(0);
    expect(r.lagMaxS).toBeLessThan(3);
    // no pose moved more than a metre between frames, and no unit turned faster than 90 deg/s
    expect(r.jump).toBeLessThanOrEqual(1);
    expect(r.turn).toBeLessThanOrEqual(TURN_MAX);
  });

  test('three units digging one pit keep 2.5 m apart, however they come and go, for seven minutes', async ({ page }) => {
    test.setTimeout(240_000);
    await start(page);
    await page.evaluate(LIVE);
    const r = await page.evaluate(() => {
      const g = window.__game!;
      g.revealAll();
      const h1 = hubBy('smelter', 'ilmenite-0', undefined, undefined, 6)!;
      hubBy('smelter', 'ilmenite-0', undefined, undefined, 9);
      power(20);
      g.finishConstruction();
      // (each hub has its first unit: the second of the first hub makes three on the one deposit)
      g.queueUnit(h1);
      g.advanceGameSeconds(150);
      const n = units().length;
      const phases = new Map<number, Set<string>>();
      const out = live(8400, () => {
        for (const u of units()) (phases.get(u.id) ?? phases.set(u.id, new Set()).get(u.id)!).add(u.haul.phase);
      });
      return { ...out, n, phases: [...phases].map(([id, ph]) => [id, [...ph]]), produced: g.getState().stats.produced.regolith };
    });
    expect(r.n).toBe(3);
    // every unit went out, dug and came back: the pit was busy
    for (const [, ph] of r.phases as [number, string[]][]) for (const p of ['toDig', 'dig', 'toDrop', 'unload']) expect(ph).toContain(p);
    expect(r.produced).toBeGreaterThan(500);
    // the origins of two drawn units were never closer than 2.5 m: at the ramp's foot, at the faces, on the road
    expect(r.minD, `closest pair ${r.minAt}`).toBeGreaterThanOrEqual(2.5);
    expect(r.rescues).toBe(0);
    expect(r.setDowns).toBe(0);
  });

  test('four units of two hubs for six minutes: the largest pose jump in a frame at 1x is under a metre, none is placed on the sim, and the picture never trails far', async ({ page }) => {
    test.setTimeout(240_000);
    await start(page);
    await page.evaluate(LIVE);
    const r = await page.evaluate(() => {
      const g = window.__game!;
      g.revealAll();
      const h1 = hubBy('smelter', 'ilmenite-0', undefined, undefined, 6)!;
      const h2 = hubBy('smelter', 'ilmenite-0', undefined, undefined, 9)!;
      power(20);
      g.finishConstruction();
      g.queueUnit(h1); g.queueUnit(h1); g.queueUnit(h2); g.queueUnit(h2);
      g.advanceGameSeconds(150);
      const n = units().length;
      const out = live(7200);
      return { ...out, n };
    });
    expect(r.n).toBe(4);
    expect(r.jump, `largest step ${r.jumpAt}`).toBeLessThanOrEqual(1);
    expect(r.turn).toBeLessThanOrEqual(TURN_MAX);
    expect(r.snaps).toBe(0);
    expect(r.setDowns).toBe(0);
    expect(r.rescues).toBe(0);
    // (what the driving costs alone is under 4 s; the picture shows the sim a tick, one second, late on top)
    expect(r.replayLagMaxS).toBeLessThan(4);
    expect(r.lagMaxS).toBeLessThan(5);
  });
});
