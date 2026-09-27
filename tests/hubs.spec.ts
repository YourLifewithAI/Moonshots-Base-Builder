/** Extraction hubs (docs/17 Phases 1–2, core/hubs.ts): the Regolith Smelter,
 *  the Silicon Refinery and the Water Management Plant print, dock, charge
 *  and dispatch their own units; each unit digs a deposit or its hub's plain
 *  pit and tips into its own hub's hopper. ▲ is the hoppers' sum; each hub
 *  has its own grade; the auto choice is hub intake within reach; Assign,
 *  Send… and Recall steer it; old saves' excavators join their hub. */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

const URL_DEBUG = '/?debug&seed=42&nolock&lowfx&style=classic';

async function start(page: Page, site = 'mare', exp: 'human' | 'robotic' = 'robotic', grant = true) {
  await page.goto(`${URL_DEBUG}&site=${site}${exp === 'robotic' ? '&exp=robotic' : ''}`);
  await page.waitForFunction(() => window.__game !== undefined && window.__game.getState() !== null);
  await page.evaluate((grant) => {
    const g = window.__game!;
    g.setPaused(true);
    g.advanceGameSeconds(0);
    g.holdHazards(true);
    g.openRoads(true);
    if (grant) g.grantResources({ metals: 2000, parts: 1000, silicon: 300 });
    g.grantPower(20000);
  }, grant);
  await page.evaluate(HELPERS);
}

declare function hubBy(type: string, depId: string | null, x?: number, z?: number): number | null;
declare function byId(id: number): any;
declare function openNear(hub: number, x: number, z: number): any;
declare function units(hub?: number): any[];
declare function hubOf(id: number): any;
declare function power(n: number): void;
const HELPERS = `(() => {
/** place a hub just outside a deposit's ring (door toward it), or near (x, z); its id */
window.hubBy = (type, depId, x, z) => {
  const g = window.__game;
  const d = depId ? g.getDeposits().find((q) => q.id === depId) : { x, z, r: 0 };
  const cgx = Math.floor((d.x + 512) / 4), cgz = Math.floor((d.z + 512) / 4);
  const R0 = Math.ceil(d.r / 4);
  for (let rr = R0; rr <= R0 + 16; rr++) {
    const found = [];
    for (let i = -rr; i <= rr; i++) for (const [gx, gz] of [[cgx + i, cgz - rr], [cgx + i, cgz + rr], [cgx - rr, cgz + i], [cgx + rr, cgz + i]]) {
      for (const rot of [0, 1, 2, 3]) {
        const chk = g.canPlace(type, gx, gz, rot);
        if (!chk.valid) continue;
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
/** Open pit… at the nearest point to (x, z) that keeps the pits' setbacks; the plain pit */
window.openNear = (hub, x, z) => {
  const g = window.__game;
  for (let r = 0; r <= 60; r += 4) for (let k = 0; k < (r ? 16 : 1); k++) {
    const a = (k / 16) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    if (g.plainPitWhy(px, pz)) continue;
    const n = g.getState().plainPits.length;
    g.openPit(hub, px, pz);
    g.advanceGameSeconds(1);
    const all = g.getState().plainPits;
    if (all.length > n) return all[all.length - 1];
  }
  return null;
};
window.units = (hub) => window.__game.getState().haulers.filter((u) => hub === undefined || u.hub === hub);
window.hubOf = (id) => window.__game.getHubs().hubs[id];
/** n solar arrays, built: the grid carries the hubs by day */
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
})()`;

test('the smelter is known from landing and comes with its first unit; the palette has no excavator or ice harvester', async ({ page }) => {
  await start(page, 'mare', 'robotic', false);
  const a = await page.evaluate(() => {
    const g = window.__game!;
    const s0 = g.getState();
    const metals0 = s0.resources.metals, parts0 = s0.resources.parts;
    const ex = g.canPlace('excavator', 130, 130, 0);
    const ih = g.canPlace('iceHarvester', 130, 130, 0);
    const hub = hubBy('smelter', 'ilmenite-0')!;
    const s1 = g.getState();
    const paid = { metals: metals0 - s1.resources.metals, parts: parts0 - s1.resources.parts };
    const site = byId(hub);
    const unitsAtSite = units().length;
    g.finishConstruction();
    g.advanceGameSeconds(1);
    return { ex, ih, hub, paid, buildTotal: site.buildTotal, unitsAtSite, units: units(hub), view: hubOf(hub), alerts: g.getState().alerts.map((x: any) => x.text) };
  });
  expect(a.ex.valid).toBe(false);
  expect(a.ex.reason).toMatch(/^HUBS PRINT THEM/);
  expect(a.ih.valid).toBe(false);
  expect(a.hub).not.toBeNull();
  // 60◆ 15⚙ at the mare's ×0.8: the old smelter plus its excavator; 150 s × 0.8
  expect(a.paid).toEqual({ metals: 48, parts: 12 });
  expect(a.buildTotal).toBe(120);
  expect(a.unitsAtSite).toBe(0);
  expect(a.units.length).toBe(1);
  expect(a.units[0].type).toBe('excavator');
  expect(a.units[0].target).toBe('dep:ilmenite-0');
  expect(a.view.units.length).toBe(1);
  expect(a.view.bays).toBe(2);
  expect(a.alerts.some((t: string) => /^REGOLITH EXCAVATOR E\d+ READY/.test(t))).toBe(true);
  // the palette: the Extraction tab holds the hubs, not the excavator or the harvester
  await page.locator('#palette .cats .btn', { hasText: 'Extraction' }).click();
  await expect(page.locator('#palette .bld-btn[data-type="smelter"]')).toBeVisible();
  await expect(page.locator('#palette .bld-btn[data-type="excavator"]')).toHaveCount(0);
  await expect(page.locator('#palette .bld-btn[data-type="iceHarvester"]')).toHaveCount(0);
  await expect(page.locator('#palette .bld-btn[data-type="smelter"]')).not.toHaveClass(/locked/);
});

test('printing: + Excavator queues, pays at the head, prints in 48 s at 4 kW, pauses in a brownout; bays cap it; cancel refunds', async ({ page }) => {
  await start(page);
  const a = await page.evaluate(() => {
    const g = window.__game!;
    const hub = hubBy('smelter', 'ilmenite-0')!;
    power(6);
    g.finishConstruction();
    g.advanceGameSeconds(2);
    const r0 = { ...g.getState().resources };
    g.queueUnit(hub);
    g.advanceGameSeconds(1);
    const r1 = { ...g.getState().resources };
    const q1 = byId(hub).hub.queue.map((j: any) => ({ ...j }));
    // a third unit: two bays, one unit and one printing
    g.queueUnit(hub);
    g.advanceGameSeconds(1);
    const refused = g.getState().alerts.map((x: any) => x.text).filter((t: string) => /CANNOT PRINT/.test(t));
    // a brownout pauses the print
    const t0 = byId(hub).hub.queue[0].t;
    g.forceGridDark(true);
    g.advanceGameSeconds(10);
    const tDark = byId(hub).hub.queue[0].t;
    g.forceGridDark(false);
    g.grantPower(20000);
    g.advanceGameSeconds(60);
    return { hub, r0, r1, q1, refused, t0, tDark, after: units(hub).length, q: byId(hub).hub.queue.length, view: hubOf(hub) };
  });
  expect(a.r0.metals - a.r1.metals).toBe(16);
  expect(a.r0.parts - a.r1.parts).toBeCloseTo(4, 1); // (and a second's upkeep)
  expect(a.q1.length).toBe(1);
  expect(a.q1[0].paid).toEqual({ metals: 16, parts: 4 });
  expect(a.q1[0].total).toBe(48);
  expect(a.refused[0]).toMatch(/BAYS FULL 1\/2 \(1 printing\)/);
  expect(a.tDark).toBe(a.t0);
  expect(a.after).toBe(2);
  expect(a.q).toBe(0);
  expect(a.view.canUnit).toMatch(/^BAYS FULL 2\/2/);
});

test('printing waits for stock at the head of the queue; cancel refunds what was paid', async ({ page }) => {
  await start(page, 'mare', 'robotic', false);
  const a = await page.evaluate(() => {
    const g = window.__game!;
    const hub = hubBy('smelter', 'ilmenite-0')!;
    g.finishConstruction();
    g.advanceGameSeconds(1);
    const s = g.getState();
    g.grantResources({ metals: 10 - s.resources.metals });
    g.queueUnit(hub);
    g.advanceGameSeconds(2);
    const waiting = { job: byId(hub).hub.queue[0], view: hubOf(hub).queue[0], metals: g.getState().resources.metals };
    g.grantResources({ metals: 100 });
    g.advanceGameSeconds(1);
    const paid = { job: byId(hub).hub.queue[0], metals: g.getState().resources.metals, parts: g.getState().resources.parts };
    g.cancelJob(hub, 0);
    g.advanceGameSeconds(1);
    return { waiting, paid, back: { metals: g.getState().resources.metals, parts: g.getState().resources.parts }, q: byId(hub).hub.queue.length };
  });
  expect(a.waiting.job.paid).toBeNull();
  expect(a.waiting.view.waiting).toBe('needs 16◆ (have 10)');
  expect(a.paid.job.paid).toEqual({ metals: 16, parts: 4 });
  expect(a.back.metals).toBe(a.paid.metals + 16);
  expect(a.back.parts).toBeCloseTo(a.paid.parts + 4, 0);
  expect(a.q).toBe(0);
});

test('units park and charge in their hub\'s bays: Recall holds one there, Dispatch sends it back', async ({ page }) => {
  await start(page);
  const a = await page.evaluate(() => {
    const g = window.__game!;
    const hub = hubBy('smelter', 'ilmenite-0')!;
    power(6);
    g.finishConstruction();
    g.advanceGameSeconds(3);
    const u = units(hub)[0];
    const s = g.getState();
    const bays = s.roads.filter((c: any) => c.bay).map((c: any) => [c.gx, c.gz]);
    g.recallUnit(u.id);
    let t = 0;
    for (; t < 200 && units(hub)[0].haul.phase !== 'park'; t++) g.advanceGameSeconds(1);
    const parked = units(hub)[0];
    g.setCharge('unit', u.id, 100);
    g.advanceGameSeconds(5);
    const charging = units(hub)[0];
    g.advanceGameSeconds(20);
    const still = units(hub)[0];
    g.dispatchUnit(u.id);
    g.advanceGameSeconds(3);
    return { hub, bays, parked, charging, still, out: units(hub)[0], t };
  });
  expect(a.t).toBeLessThan(200);
  expect(a.parked.parked).toBe('recalled');
  expect(a.parked.target).toBeNull();
  // parked on a bay cell beside its hub's door
  const cell = [Math.floor((a.parked.haul.x + 512) / 4), Math.floor((a.parked.haul.z + 512) / 4)];
  expect(a.bays.some((b: number[]) => b[0] === cell[0] && b[1] === cell[1])).toBe(true);
  // it charges in its bay, and holds there
  expect(a.charging.haul.chg).toBe(true);
  expect(a.charging.haul.charge).toBeGreaterThan(100);
  expect(a.still.haul.phase).toBe('park');
  // Dispatch: back to work
  expect(a.out.parked).toBeUndefined();
  expect(a.out.haul.phase).toBe('toDig');
});

test('the auto choice: the best hub intake within reach (90 s one way) — the nearest wanted deposit by haul time; far ones out of reach', async ({ page }) => {
  await start(page);
  const a = await page.evaluate(() => {
    const g = window.__game!;
    g.revealAll();
    const hub = hubBy('smelter', 'ilmenite-0')!;
    g.finishConstruction();
    g.advanceGameSeconds(2);
    return { hub, choices: g.hubChoices(hub), u: units(hub)[0] };
  });
  const inReach = a.choices.filter((c: any) => c.inReach);
  expect(inReach.length).toBeGreaterThan(1);
  // reach is 90 s one way (every mapped ilmenite on this seed is inside it)
  for (const c of a.choices) expect(c.inReach).toBe(c.t <= 90);
  // only the ground a smelter wants: high-Ti basalt (and its plain pit, if staked)
  for (const c of a.choices) expect(c.key).toMatch(/^(dep:ilmenite-|plain:)/);
  // ranked by intake; the unit takes the best with a road to it
  const best = inReach.filter((c: any) => c.connected)[0];
  expect(a.u.target).toBe(best.key);
  const byT = [...inReach].sort((p: any, q: any) => p.t - q.t)[0];
  expect(best.key).toBe(byT.key);
});

test('trips go hub → gate → face → hub; one way matches the road plus the off-road leg', async ({ page }) => {
  await start(page);
  const a = await page.evaluate(() => {
    const g = window.__game!;
    const hub = hubBy('smelter', 'ilmenite-0')!;
    power(8);
    g.finishConstruction();
    const c = g.hubChoices(hub).find((x: any) => x.key === 'dep:ilmenite-0');
    const s = g.getState();
    const door = s.buildings.find((b: any) => b.id === hub);
    // follow the unit: left its bay → at its face → back at the door
    const phases: [number, string][] = [];
    let last = '';
    let firstRoute: any = null;
    for (let t = 0; t < 400; t++) {
      g.advanceGameSeconds(1);
      const u = units(hub)[0];
      if (u.haul.phase !== last) { phases.push([g.getState().simTime, u.haul.phase]); last = u.haul.phase; if (u.haul.phase === 'toDig' && !firstRoute) firstRoute = { route: u.haul.route, w: u.haul.w }; }
    }
    return { c, phases, firstRoute, door: { gx: door.gx, gz: door.gz }, zone: g.getZones().find((z: any) => z.id === 'ilmenite-0') };
  });
  // the cycle, in order
  const seq = a.phases.map((p: any) => p[1]);
  const i = seq.indexOf('dig');
  expect(seq.slice(i, i + 4)).toEqual(['dig', 'toDrop', 'unload', 'toDig']);
  // the leg out ends off-road inside the deposit (a weighted last segment), from a road gate
  expect(a.firstRoute.w?.length).toBeGreaterThan(0);
  expect(a.firstRoute.w[a.firstRoute.w.length - 1]).toBeGreaterThan(1);
  // one way: the road at 5 m/s plus the off-road metres at half speed
  expect(a.c.t).toBeCloseTo(a.c.roadM / 5 + (a.c.offM * 2) / 5, 5);
  // a round trip in the sim matches: toDrop (face → door) takes the one way (within the stop-short and a tick each end)
  const k = seq.indexOf('toDrop');
  const drive = a.phases[k + 1][0] - a.phases[k][0];
  expect(Math.abs(drive - a.c.t)).toBeLessThan(4);
});

test('a unit digs its target\'s pit (core/pits.ts); once it is cut, it drives in by the ramp to a face on the floor', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page);
  const a = await page.evaluate(() => {
    const g = window.__game!;
    const hub = hubBy('smelter', 'ilmenite-0')!;
    power(6);
    g.finishConstruction();
    // half an hour of digging, the hopper kept from filling
    for (let i = 0; i < 30; i++) {
      g.grantPower(5000);
      const reg = g.getState().resources.regolith;
      if (reg > 0) g.grantResources({ regolith: -reg });
      g.advanceGameSeconds(60);
    }
    // the next time it sets out: its way in, and the face it goes to
    let route: number[][] | null = null, face: number[] | null = null;
    for (let i = 0; i < 400 && !route; i++) {
      g.advanceGameSeconds(1);
      const h = units(hub)[0].haul;
      if (h.phase === 'toDig' && !h.wait && h.route.length > 2) { route = h.route; face = [h.digX, h.digZ]; }
    }
    const p = g.getPits().pits.find((x: any) => x.key === 'dep:ilmenite-0');
    const at = (x: number, z: number) => g.terrainSample(Math.round((x + 512) / 4), Math.round((z + 512) / 4)).delta;
    const zone = g.getZones().find((z: any) => z.id === `pit-${p?.id}`);
    return { p, route, face, faceDelta: face ? at(face[0], face[1]) : null, dug: g.getState().dug, pits: g.getPits().pits.length, zone: !!zone };
  });
  // every tonne it dug went into the deposit's pit: the one pit, a zone of its own
  expect(a.pits).toBe(1);
  expect(a.p.state).toBe('open');
  expect(a.p.tonnes).toBeGreaterThan(1000);
  expect(a.p.tonnes).toBeCloseTo(a.dug['dep:ilmenite-0'], 3);
  expect(a.zone).toBe(true);
  // its face is on the pit floor, and the way in passes the ramp's top and its foot
  expect(a.faceDelta).toBeLessThan(0);
  const top = [a.p.ox + a.p.ux * a.p.A, a.p.oz + a.p.uz * a.p.A];
  const near = (q: number[]) => a.route!.some((pt) => Math.hypot(pt[0] - q[0], pt[1] - q[1]) < 0.5);
  expect(near(top)).toBe(true);
  expect(Math.hypot(a.route![a.route!.length - 1][0] - a.face![0], a.route![a.route!.length - 1][1] - a.face![1])).toBeLessThan(0.5);
});

test('each hub has its own hopper; ▲ is their sum and the pile; each hub has its own grade', async ({ page }) => {
  await start(page);
  const a = await page.evaluate(() => {
    const g = window.__game!;
    const h1 = hubBy('smelter', 'ilmenite-0')!;
    // a second smelter by the Lander, sent to its own plain pit
    const h2 = hubBy('smelter', null, -40, -40)!;
    power(14);
    g.finishConstruction();
    g.advanceGameSeconds(1);
    const s = g.getState();
    const pits = s.plainPits;
    let plain = pits.find((p: any) => p.hub === h2);
    if (!plain) plain = openNear(h2, -70, -70);
    g.assignPit(h1, 'dep:ilmenite-0');
    g.assignPit(h2, `plain:${plain.id}`);
    for (const u of units(h2)) g.sendUnit(u.id, `plain:${plain.id}`);
    g.advanceGameSeconds(600);
    const st = g.getState();
    const b1 = st.buildings.find((b: any) => b.id === h1), b2 = st.buildings.find((b: any) => b.id === h2);
    const sum = st.pile + b1.hub.hopper + b2.hub.hopper;
    g.grantResources({ regolith: 40 });
    g.advanceGameSeconds(1);
    const st2 = g.getState();
    return {
      reg: st.resources.regolith, sum, h1: b1.hub, h2: b2.hub, feed: st.feed, pile2: st2.pile,
      reg2: st2.resources.regolith, sum2: st2.pile + st2.buildings.find((b: any) => b.id === h1).hub.hopper + st2.buildings.find((b: any) => b.id === h2).hub.hopper,
      caps: st.storageCaps.regolith,
    };
  });
  expect(a.reg).toBeCloseTo(a.sum, 6);
  expect(a.reg2).toBeCloseTo(a.sum2, 6);
  // a grant lands on the pile, and smelters draw the pile first
  expect(a.pile2).toBeGreaterThan(0);
  // the hub on high-Ti basalt feeds at 1.3, the one on plain ground at 1.0
  expect(a.h1.feed.ilmenite).toBeGreaterThan(0.95);
  expect(a.h1.q).toBeCloseTo(1.3, 2);
  expect(a.h2.feed.plain).toBeGreaterThan(0.95);
  expect(a.h2.q).toBeCloseTo(1.0, 2);
  // the base's feed is their mean, weighted by what each drew
  expect(a.feed.ilmenite).toBeGreaterThan(0.2);
  expect(a.feed.plain).toBeGreaterThan(0.2);
  // the ▲ cap: the Lander's room for the pile plus each hopper's 315
  expect(a.caps).toBe(300 + 2 * 315);
});

test('a water plant on the ice prints Ice Miners, which dig the cold trap for its water; off the ice it prints excavators', async ({ page }) => {
  await start(page, 'southpole', 'human');
  const a = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('iceExtraction');
    const ice = g.getDeposits().filter((d: any) => d.kind === 'ice' && d.revealed).sort((p: any, q: any) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z))[0];
    const hub = hubBy('waterPlant', ice.id)!;
    power(8);
    g.finishConstruction();
    const w0 = g.getState().stats.produced.water;
    g.advanceGameSeconds(900);
    const st = g.getState();
    return { ice: ice.id, hub, units: units(hub), hubState: st.buildings.find((b: any) => b.id === hub).hub, water: st.stats.produced.water - w0 };
  });
  expect(a.units.length).toBe(1);
  expect(a.units[0].type).toBe('iceMiner');
  expect(a.units[0].target).toBe(`dep:${a.ice}`);
  expect(a.hubState.feed.ice).toBeGreaterThan(0.95);
  expect(a.hubState.q).toBeCloseTo(1, 2);
  expect(a.water).toBeGreaterThan(20);
  // off the ice (the mare): the plant prints excavators for mature soil
  await start(page, 'mare');
  const b = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('regolithVolatiles');
    const hub = hubBy('waterPlant', null, -50, 30)!;
    g.finishConstruction();
    g.advanceGameSeconds(2);
    return { units: units(hub) };
  });
  expect(b.units.length).toBe(1);
  expect(b.units[0].type).toBe('excavator');
});

test('Assign, Send… and Recall: the hub prefers a pit; a sent unit is pinned there until Auto; a unit sent to a full pit waits at its gate', async ({ page }) => {
  await start(page);
  const a = await page.evaluate(() => {
    const g = window.__game!;
    g.revealAll();
    const hub = hubBy('smelter', 'ilmenite-0')!;
    power(10);
    g.finishConstruction();
    g.queueUnit(hub);
    g.advanceGameSeconds(70);
    const us = units(hub);
    // Open pit… a plain pit, and Assign it: the auto units go there
    const pit = openNear(hub, -60, 10);
    g.assignPit(hub, `plain:${pit.id}`);
    g.advanceGameSeconds(400);
    const assigned = units(hub).map((u: any) => u.target);
    // Send… one unit back to the deposit: pinned
    g.sendUnit(us[0].id, 'dep:ilmenite-0');
    g.advanceGameSeconds(300);
    const sent = units(hub).find((u: any) => u.id === us[0].id);
    const other = units(hub).find((u: any) => u.id === us[1].id);
    // Auto: it follows its hub's choice again
    g.autoUnit(us[0].id);
    g.advanceGameSeconds(400);
    const auto = units(hub).find((u: any) => u.id === us[0].id);
    return { pit: pit.id, n: us.length, assigned, sent, other, auto, view: hubOf(hub) };
  });
  expect(a.n).toBe(2);
  expect(a.assigned.every((k: string) => k === `plain:${a.pit}`)).toBe(true);
  expect(a.sent.pinned).toBe(true);
  expect(a.sent.target).toBe('dep:ilmenite-0');
  expect(a.other.target).toBe(`plain:${a.pit}`);
  expect(a.auto.pinned).toBe(false);
  expect(a.auto.target).toBe(`plain:${a.pit}`);
  expect(a.view.prefer).toBe(`plain:${a.pit}`);
});

test('a unit sent to a pit with every face working waits at its gate', async ({ page }) => {
  await start(page);
  const a = await page.evaluate(() => {
    const g = window.__game!;
    const hub = hubBy('smelter', 'ilmenite-0')!;
    power(6);
    g.finishConstruction();
    g.advanceGameSeconds(2);
    // stake a plain pit (3 faces), fill its faces with the hub's second unit and two sent from a second smelter
    const pit = openNear(hub, -60, 10);
    const key = `plain:${pit.id}`;
    const s = g.getState();
    // three faces: hold them by hand (a test's shortcut: three units pinned there)
    const hub2 = hubBy('smelter', null, -40, 60)!;
    g.finishConstruction();
    g.queueUnit(hub); g.queueUnit(hub2);
    g.advanceGameSeconds(80);
    const all = units();
    for (const u of all.slice(0, 3)) g.sendUnit(u.id, key);
    g.advanceGameSeconds(200);
    const last = all[3];
    g.sendUnit(last.id, key);
    g.advanceGameSeconds(120);
    void s;
    return { key, faces: g.getHubs().units.filter((u: any) => u.target === key).length, last: g.getHubs().units.find((u: any) => u.id === last.id), raw: units().find((u: any) => u.id === last.id) };
  });
  expect(a.faces).toBe(4);
  expect(a.raw.face).toBe(-1);
  expect(a.raw.haul.wait).toBe('gate');
  expect(a.last.line).toMatch(/^WAITING AT THE GATE — plain pit P\d+ has 3\/3 faces working/);
});

test('with no wanted deposit in reach, the hub stakes a plain pit (a zone of its own) and its unit digs it', async ({ page }) => {
  await start(page, 'southpole', 'human');
  const a = await page.evaluate(() => {
    const g = window.__game!;
    const hub = hubBy('smelter', null, -30, -30)!;
    const staked = g.getState().plainPits.map((p: any) => ({ ...p }));
    // the stake keeps the pits' setback: its zone 12 m off every structure's walls
    const walls = g.getState().buildings.map((b: any) => {
      const f = g.footprintOf(b.id);
      return staked.length ? Math.hypot(Math.max(f.x0 - staked[0].x, 0, staked[0].x - f.x1), Math.max(f.z0 - staked[0].z, 0, staked[0].z - f.z1)) : 0;
    });
    power(8);
    g.finishConstruction();
    g.advanceGameSeconds(240);
    const st = g.getState();
    return {
      hub, staked, walls, zones: g.getZones().filter((z: any) => z.kind === 'plain'), units: units(hub), hopper: st.buildings.find((b: any) => b.id === hub).hub, view: hubOf(hub),
      pit: g.getPits().pits.find((p: any) => p.key === `plain:${staked[0]?.id}`),
    };
  });
  expect(a.staked.length).toBe(1);
  expect(a.staked[0].hub).toBe(a.hub);
  expect(a.zones.map((z: any) => z.id)).toContain(`plain:${a.staked[0].id}`);
  expect(a.zones[0].gates.length).toBeGreaterThan(0);
  expect(a.units[0].target).toBe(`plain:${a.staked[0].id}`);
  expect(a.hopper.feed.plain).toBeGreaterThan(0.95);
  expect(a.view.plainPit).toBe(a.staked[0].id);
  // 12 m (its zone) + the 12 m setback from every wall; its dig opened the plain pit's own pit
  expect(Math.min(...a.walls)).toBeGreaterThanOrEqual(24);
  expect(a.pit).toBeTruthy();
  expect(a.pit.tonnes).toBeGreaterThan(50);
  expect(a.pit.deposit).toBeNull();
});

test('unit power at the hub: a digging unit is a load at its hub\'s priority; in a brownout it runs its pack down and stalls', async ({ page }) => {
  await start(page);
  const a = await page.evaluate(() => {
    const g = window.__game!;
    const hub = hubBy('smelter', 'ilmenite-0')!;
    power(8);
    g.finishConstruction();
    let t = 0;
    for (; t < 200 && units(hub)[0].haul.phase !== 'dig'; t++) g.advanceGameSeconds(1);
    g.advanceGameSeconds(2);
    const onGrid = units(hub)[0];
    const fleet = g.getState().power.fleet;
    // the grid gone: it digs on its pack, then stops flat
    g.setCharge('unit', onGrid.id, 30);
    g.forceGridDark(true);
    g.advanceGameSeconds(2);
    const onPack = units(hub)[0];
    g.advanceGameSeconds(10);
    const flat = units(hub)[0];
    const cargo0 = flat.haul.cargo.regolith ?? 0;
    g.advanceGameSeconds(5);
    const cargo1 = units(hub)[0].haul.cargo.regolith ?? 0;
    g.forceGridDark(false);
    g.grantPower(20000);
    g.advanceGameSeconds(3);
    return { onGrid, fleet, onPack, flat, cargo0, cargo1, back: units(hub)[0], alerts: g.getState().alerts.map((x: any) => x.text) };
  });
  expect(a.onGrid.haul.src).toBe('grid');
  expect(a.fleet).toBeGreaterThanOrEqual(6);
  expect(a.onPack.haul.src).toBe('pack');
  expect(a.flat.haul.src).toBe('flat');
  expect(a.cargo1).toBe(a.cargo0);
  expect(a.back.haul.src).toBe('grid');
});

test('an old save: excavators join the nearest hub (their deposit kept), old ▲ fills the hoppers then the pile; with no hub they stay legacy pads and join the first one', async ({ page }) => {
  await start(page);
  const a = await page.evaluate(() => {
    const g = window.__game!;
    const hub = hubBy('smelter', 'ilmenite-0')!;
    g.finishConstruction();
    g.advanceGameSeconds(1);
    // a lab where the old excavator stood (its pad and its road), made one in the save
    const pad = hubBy('lab', null, -30, 20)!;
    g.finishConstruction();
    const blob = g.saveBlob();
    const st = blob.state;
    // back to before hubs: no units, no hub state, an excavator digging the deposit and 400▲ in stock
    delete st.hubSchema;
    st.haulers = [];
    for (const b of st.buildings) delete b.hub;
    const ex = st.buildings.find((b: any) => b.id === pad);
    ex.type = 'excavator';
    ex.wear = 0.2;
    ex.haul = { digX: 9, digZ: 44, phase: 'dig', x: 9, z: 44, path: [], t: 10, cargo: {}, kind: 'ilmenite', drop: null };
    const id = pad;
    st.resources.regolith = 400;
    g.loadBlob(blob);
    const s = g.getState();
    return { hub, id, s: { schema: s.hubSchema, haulers: s.haulers, pile: s.pile, reg: s.resources.regolith, hopper: s.buildings.find((b: any) => b.id === hub).hub.hopper, pad: s.buildings.find((b: any) => b.id === id) },
      alerts: s.alerts.map((x: any) => x.text) };
  });
  expect(a.s.schema).toBe(1);
  expect(a.s.pad).toBeUndefined();
  expect(a.s.haulers.length).toBe(1);
  expect(a.s.haulers[0].hub).toBe(a.hub);
  expect(a.s.haulers[0].target).toBe('dep:ilmenite-0');
  expect(a.s.haulers[0].wear).toBeCloseTo(0.2, 5);
  expect(a.s.hopper).toBe(315);
  expect(a.s.pile).toBe(85);
  expect(a.s.reg).toBe(400);
  expect(a.alerts.some((t: string) => /^EXTRACTION HUBS — your 1 excavator now belong/.test(t))).toBe(true);
  // no hub: the excavator stays a legacy pad and digs on; the first smelter it joins
  await start(page);
  const b = await page.evaluate(() => {
    const g = window.__game!;
    const id = hubBy('lab', null, -30, 20)!;
    g.finishConstruction();
    const blob = g.saveBlob();
    const st = blob.state;
    delete st.hubSchema;
    st.buildings.find((b: any) => b.id === id).type = 'excavator';
    g.loadBlob(blob);
    g.setPaused(true);
    g.holdHazards(true);
    g.openRoads(true);
    g.grantResources({ metals: 500, parts: 200 });
    g.grantPower(20000);
    const pad = byId(id);
    g.advanceGameSeconds(120);
    const dug = g.getState().resources.regolith;
    const hub = hubBy('smelter', 'ilmenite-0')!;
    g.finishConstruction();
    g.advanceGameSeconds(2);
    return { legacy: pad.legacy, dug, gone: !byId(id), units: units(hub) };
  });
  expect(b.legacy).toBe(true);
  expect(b.dug).toBeGreaterThan(0);
  expect(b.gone).toBe(true);
  // its hub's own unit (priced in), and the pad's
  expect(b.units.length).toBe(2);
});

test('the hub inspector shows its hopper, units, queue, robots and pits in reach; a unit has its own inspector', async ({ page }) => {
  await start(page);
  const hub = await page.evaluate(() => {
    const g = window.__game!;
    const hub = hubBy('smelter', 'ilmenite-0')!;
    power(6);
    g.finishConstruction();
    g.advanceGameSeconds(30);
    g.select(hub);
    return hub;
  });
  const insp = page.locator('#inspector');
  await expect(insp).toContainText('Hopper');
  await expect(insp).toContainText('Units 1/2 · Level I');
  await expect(insp).toContainText('Pits in reach');
  await expect(insp).toContainText('high-Ti basalt #0');
  await expect(insp.locator('#hub-print')).toContainText('+ Regolith Excavator');
  await expect(insp.locator('#hub-print')).toContainText('16◆ 4⚙');
  await insp.locator('#hub-print').click();
  await page.evaluate(() => window.__game!.advanceGameSeconds(2));
  await expect(insp).toContainText('Queue');
  const u = await page.evaluate((hub) => units(hub)[0].id, hub);
  await page.evaluate((u) => window.__game!.selectUnit(u), u);
  const ui = page.locator('#unit-inspector');
  await expect(ui).toBeVisible();
  await expect(ui).toContainText(`E${u}`);
  await expect(ui).toContainText('Regolith Smelter');
  await ui.locator('#un-recall').click();
  await page.evaluate(() => window.__game!.advanceGameSeconds(1));
  const parked = await page.evaluate((u) => window.__game!.getState().haulers.find((x: any) => x.id === u).parked, u);
  expect(parked).toBe('recalled');
});
