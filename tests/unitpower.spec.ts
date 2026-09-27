/** On-board power (core/unitPower.ts, docs/02 · On-board power): construction rovers,
 *  drones and excavators work from the grid while it serves them and from
 *  their packs when it cannot; an empty pack stops the unit where it stands
 *  (no weld, no spark, the wheel still) until the grid serves it again, and
 *  it charges at its dock, pad or a site's feed at its priority. The pack
 *  techs carry it further (a whole night, then a 10-minute brownout) and
 *  Radioisotope Power Units keep it working slowly with the grid at 0. Old
 *  saves start every unit full; the inspector, the panels and the alerts
 *  say so. And (docs/15 §5b) a Relay Mast gets no road: its rover drives
 *  out to it off-road. */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

const URL_DEBUG = '/?debug&seed=42&nolock&lowfx&style=classic';

async function start(page: Page, exp: 'human' | 'robotic' = 'robotic', site = 'mare') {
  await page.goto(`${URL_DEBUG}&site=${site}${exp === 'robotic' ? '&exp=robotic' : ''}`);
  await page.waitForFunction(() => window.__game !== undefined && window.__game.getState() !== null);
  await page.evaluate(() => {
    const g = window.__game!;
    g.setPaused(true);
    g.advanceGameSeconds(0);
    g.holdHazards(true);
    g.grantResources({ metals: 3000, parts: 2000, silicon: 500, chips: 200 });
  });
  await page.evaluate(HELPERS);
}

declare function near(type: string, x: number, z: number): number | null;
declare function byId(id: number): any;
declare function unit(id: number): any;
declare function crewOf(site: number): any[];
declare function weldOn(site: number): number | null;
/** place near (x, z) world metres (cell search outward), the new building's id */
const HELPERS = `(() => {
window.near = (type, x, z) => {
  const g = window.__game;
  const c = { gx: Math.round((x + 512) / 4), gz: Math.round((z + 512) / 4) };
  for (let r = 0; r < 20; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    if (g.canPlace(type, c.gx + dx, c.gz + dz, 0).valid && g.placeBuilding(type, c.gx + dx, c.gz + dz, 0)) {
      return g.getState().buildings[g.getState().buildings.length - 1].id;
    }
  }
  return null;
};
window.byId = (id) => window.__game.getState().buildings.find((b) => b.id === id);
window.unit = (id) => window.__game.getState().rovers.find((u) => u.id === id);
window.crewOf = (site) => window.__game.getState().rovers.filter((u) => u.site === site);
/** tick until a rover welds at the site: its id (null: none within a minute) */
window.weldOn = (site) => {
  for (let t = 0; t < 60; t++) {
    window.__game.advanceGameSeconds(1);
    const u = window.crewOf(site).find((x) => x.task === 'weld');
    if (u) return u.id;
  }
  return null;
};
})()`;

/** the work readout after `n` live frames of `dt` wall-seconds (paused again after) */
const live = (page: Page, n = 20, dt = 0.05) => page.evaluate(([n, dt]) => {
  const g = window.__game!;
  g.setPaused(false);
  for (let i = 0; i < n; i++) g.stepFrame(dt);
  g.setPaused(true);
  g.stepFrame(0);
  return g.getWorkAnim();
}, [n, dt] as const);

/** live frames until `pred` holds on the work readout (null if the budget runs out) */
async function until(page: Page, pred: (w: any) => boolean, frames = 400, batch = 20) {
  for (let i = 0; i < frames; i += batch) {
    const w = await live(page, batch);
    if (pred(w)) return w;
  }
  return null;
}

// ───────────────────────────── a welding rover ─────────────────────────────

for (const exp of ['robotic', 'human'] as const) {
  test(`${exp}: in a brownout a welding rover runs its pack down, then stops — the site stops and the spark goes off; power back, it welds again`, async ({ page }) => {
    test.setTimeout(180_000);
    await start(page, exp);
    const a = await page.evaluate(() => {
      const g = window.__game!;
      g.instantTravel(true);
      const lab = near('lab', 20, 24)!;
      g.finishRoads();
      const rover = weldOn(lab)!;
      // ten seconds of welding left in it, and the grid gone
      g.setCharge('rover', rover, 40);
      g.forceGridDark(true);
      g.advanceGameSeconds(3);
      const onPack = { u: unit(rover), b: byId(lab) };
      let t = 0;
      for (; t < 30 && unit(rover).src !== 'flat'; t++) g.advanceGameSeconds(1);
      const c0 = byId(lab).construction;
      g.advanceGameSeconds(5);
      return { lab, rover, onPack, flatAfter: t, flat: { u: unit(rover), b: byId(lab) }, c0, c1: byId(lab).construction };
    });
    // on its pack: still welding (the site's grid draw is dark), the pack running down
    expect(a.onPack.b.idleReason).toBe('building');
    expect(a.onPack.b.onPack).toBe(true);
    expect(a.onPack.u.src).toBe('pack');
    expect(a.onPack.u.charge).toBeLessThan(40);
    // then flat within the ten seconds its pack held: the site stops, the rover does nothing
    expect(a.flatAfter).toBeLessThan(12);
    expect(a.flat.u.src).toBe('flat');
    expect(a.flat.u.charge ?? 0).toBe(0);
    expect(a.flat.u.task).toBeUndefined();
    expect(a.flat.b.idleReason).toBe('power');
    expect(a.c1).toBe(a.c0);
    // drawn stopped: no spark, no arm at work
    const w = await live(page);
    const drawn = w.rovers.find((r: any) => r.id === a.rover);
    expect(drawn.spark).toBe(false);
    expect(drawn.mode).toBeNull();
    // the grid returns: it welds from the grid at once, and charges at the site's feed
    const b = await page.evaluate(({ lab, rover }) => {
      const g = window.__game!;
      g.forceGridDark(false);
      g.grantPower(5000);
      const c0 = byId(lab).construction;
      g.advanceGameSeconds(3);
      return { u: unit(rover), b: byId(lab), c0, c1: byId(lab).construction };
    }, a);
    expect(b.b.idleReason).toBe('building');
    expect(b.c1).toBeLessThan(b.c0);
    expect(b.u.src).toBe('grid');
    expect(b.u.chg).toBe(true);
    expect(b.u.charge).toBeGreaterThan(0);
    const w2 = await until(page, (w) => w.rovers.find((r: any) => r.id === a.rover)?.spark);
    expect(w2, 'the spark is back').not.toBeNull();
  });
}

// ───────────────────────────── an excavator ─────────────────────────────

test('an excavator on its pack stops digging when it is empty — the wheel stands still — and digs again once the grid charges it', async ({ page }) => {
  test.setTimeout(180_000);
  await start(page);
  const a = await page.evaluate(() => {
    const g = window.__game!;
    // plain ground near the Lander: it digs its own pad
    let id: number | null = null;
    for (let r = 0; r < 14 && id === null; r++) {
      for (let dx = -r; dx <= r && id === null; dx++) {
        for (const [x, z] of [[118 + dx, 124 - r], [118 + dx, 124 + r]]) {
          const cx = (x + 1) * 4 - 512, cz = (z + 1) * 4 - 512;
          if (g.depositAt(cx, cz) === null && g.canPlace('excavator', x, z).valid && g.placeBuilding('excavator', x, z)) {
            id = g.getState().buildings[g.getState().buildings.length - 1].id;
            break;
          }
        }
      }
    }
    g.finishConstruction();
    g.grantPower(5000);
    for (let t = 0; t < 30 && !(byId(id!).haul.phase === 'dig' && byId(id!).active); t++) g.advanceGameSeconds(1);
    // five seconds of digging left, and the grid gone
    g.setCharge('digger', id!, 30);
    g.forceGridDark(true);
    g.advanceGameSeconds(2);
    const onPack = byId(id!);
    let t = 0;
    for (; t < 20 && byId(id!).haul.src !== 'flat'; t++) g.advanceGameSeconds(1);
    const dug = byId(id!).haul.t;
    g.advanceGameSeconds(4);
    return { id: id!, onPack, flatAfter: t, flat: byId(id!), dug, dugLater: byId(id!).haul.t };
  });
  expect(a.onPack.active).toBe(true);
  expect(a.onPack.onPack).toBe(true);
  expect(a.onPack.haul.src).toBe('pack');
  expect(a.flatAfter).toBeLessThan(8);
  expect(a.flat.active).toBe(false);
  expect(a.flat.idleReason).toBe('power');
  expect(a.flat.haul.src).toBe('flat');
  expect(a.dugLater).toBe(a.dug); // the bucket fills no more
  // drawn stopped: the wheel stands still, no digging
  const w1 = await live(page, 10);
  const w2 = await live(page, 30);
  const d1 = w1.diggers.find((d: any) => d.id === a.id), d2 = w2.diggers.find((d: any) => d.id === a.id);
  expect(d2.digging).toBe(false);
  expect(d2.wheel).toBe(d1.wheel);
  // the grid back: it charges on its pad and digs again
  const b = await page.evaluate((id) => {
    const g = window.__game!;
    g.forceGridDark(false);
    g.grantPower(5000);
    g.advanceGameSeconds(3);
    return byId(id);
  }, a.id);
  expect(b.active).toBe(true);
  expect(b.haul.src).toBe('grid');
  expect(b.haul.chg).toBe(true);
  expect(b.haul.charge).toBeGreaterThan(0);
  const w3 = await until(page, (w) => w.diggers.find((d: any) => d.id === a.id)?.digging);
  expect(w3, 'it digs again').not.toBeNull();
  const w4 = await live(page, 20);
  expect(w4.diggers.find((d: any) => d.id === a.id).wheel).not.toBe(w3!.diggers.find((d: any) => d.id === a.id).wheel);
});

// ───────────────────────────── priority triage ─────────────────────────────

test('priority triage: a priority-0 site\'s rover keeps charging while priority-3 loads shed', async ({ page }) => {
  test.setTimeout(120_000);
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.instantTravel(true);
    // a lab (priority 3, 8 kW agent-run) standing, and a Solar Array site (priority 0)
    const lab = near('lab', 24, -20)!;
    g.finishConstruction();
    const sol = near('solar', 20, 24)!;
    g.finishRoads();
    g.grantPower(5000);
    const rover = weldOn(sol)!;
    g.setCharge('rover', rover, 100);
    // the Lander's 6 kW and 5 stored a tick: 11 kW for the weld (4) and the charger (3) at
    // priority 0, nothing left for the lab's 8 at priority 3
    const c0 = unit(rover).charge;
    for (let t = 0; t < 6; t++) {
      g.grantPower(5 - g.getState().powerStored);
      g.advanceGameSeconds(1);
    }
    return { u: unit(rover), c0, site: byId(sol), lab: byId(lab), power: g.getState().power };
  });
  expect(r.site.idleReason).toBe('building');
  expect(r.site.onPack).toBeUndefined(); // on the grid
  expect(r.u.chg).toBe(true);
  expect(r.u.charge).toBeGreaterThan(r.c0 + 10);
  expect(r.lab.idleReason).toBe('power');
  expect(r.power.shed).toBe(true);
  expect(r.power.brownout).toBe(false);
  expect(r.power.charging).toBeGreaterThan(0);
});

// ───────────────────────────── the pack tiers ─────────────────────────────

/** Three Data Center sites, both Lander rovers on them, then `secs` of the grid
 *  at 0: how long each rover worked before it went flat (Infinity: never). */
const brownoutRun = (page: Page, techs: string[], secs: number) => page.evaluate(([techs, secs]) => {
  const g = window.__game!;
  for (const t of techs) g.completeTech(t);
  g.completeTech('lunarDataCenter');
  g.instantTravel(true);
  const sites = [near('dataCenter', 30, 30), near('dataCenter', -30, 30), near('dataCenter', 30, -30)].filter((x) => x !== null) as number[];
  g.finishRoads();
  g.grantPower(5000);
  for (let t = 0; t < 30 && g.getState().rovers.some((u: any) => u.task !== 'weld'); t++) g.advanceGameSeconds(1);
  g.forceGridDark(true);
  const flatAt: Record<number, number> = {};
  const c0 = sites.map((id) => byId(id).construction);
  for (let t = 1; t <= secs; t++) {
    g.advanceGameSeconds(1);
    for (const u of g.getState().rovers) if (u.src === 'flat' && flatAt[u.id] === undefined) flatAt[u.id] = t;
  }
  const s = g.getState();
  return {
    sites: sites.length, flatAt, rovers: s.rovers.map((u: any) => u.id),
    progress: sites.map((id, i) => c0[i] - byId(id).construction), done: sites.filter((id) => byId(id).construction === 0).length,
  };
}, [techs, secs] as const);

test('the starting pack stops the fleet two minutes into a brownout', async ({ page }) => {
  test.setTimeout(180_000);
  await start(page);
  const r = await brownoutRun(page, [], 200);
  expect(r.sites).toBe(3);
  // 480 kWh at 4 kW: two minutes of welding (a mare night is four)
  for (const id of r.rovers) {
    expect(r.flatAt[id], `rover ${id}`).toBeGreaterThan(110);
    expect(r.flatAt[id], `rover ${id}`).toBeLessThan(130);
  }
});

test('Rover Power Packs carry the fleet through a lunar night; Fuel-Cell Packs through a 10-minute brownout', async ({ page }) => {
  test.setTimeout(300_000);
  await start(page);
  const packs = await brownoutRun(page, ['roverPowerPacks'], 300);
  // ×3: six minutes of welding, past a whole 4-minute night
  for (const id of packs.rovers) expect(packs.flatAt[id] ?? Infinity, `rover ${id}`).toBeGreaterThan(240);
  await start(page);
  const cells = await brownoutRun(page, ['roverPowerPacks', 'fuelCellPacks'], 600);
  // ×9: eighteen minutes of welding; ten minutes off the grid and nobody stops
  expect(cells.flatAt).toEqual({});
  expect(cells.done).toBeGreaterThanOrEqual(2);
});

test('Radioisotope Power Units: with the grid at 0 and the pack empty, a rover welds slowly and an excavator digs slowly', async ({ page }) => {
  test.setTimeout(180_000);
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    for (const t of ['roverPowerPacks', 'fuelCellPacks', 'radioisotopeUnits']) g.completeTech(t);
    g.instantTravel(true);
    // an excavator digging its own pad, and a rover welding a lab
    const dig = near('excavator', -24, 0)!;
    g.finishConstruction();
    g.grantPower(5000);
    for (let t = 0; t < 30 && !(byId(dig).haul.phase === 'dig' && byId(dig).active); t++) g.advanceGameSeconds(1);
    const lab = near('lab', 20, 24)!;
    g.finishRoads();
    const rover = weldOn(lab)!;
    g.setCharge('rover', rover, 0);
    g.setCharge('digger', dig, 0);
    g.forceGridDark(true);
    g.advanceGameSeconds(2);
    const c0 = byId(lab).construction, d0 = byId(dig).haul.t;
    g.advanceGameSeconds(20);
    return { u: unit(rover), c0, c1: byId(lab).construction, b: byId(lab), d0, d1: byId(dig).haul.t, h: byId(dig).haul };
  });
  // 1 kW of 4: a quarter of the weld rate, on its RPU alone
  expect(r.u.src).toBe('rpu');
  expect(r.u.pw).toBeCloseTo(0.25, 5);
  expect(r.u.task).toBe('weld');
  expect(r.b.idleReason).toBe('building');
  expect(r.c0 - r.c1).toBeGreaterThan(20 * 0.25 * 0.8);
  expect(r.c0 - r.c1).toBeLessThan(20 * 0.25 * 1.2);
  // 1.5 kW of the excavator's 6: its bucket fills at a quarter of the pace
  expect(r.h.src).toBe('rpu');
  expect(r.h.pw).toBeCloseTo(0.25, 5);
  expect(r.d1 - r.d0).toBeCloseTo(20 * 0.25, 5);
  const w = await until(page, (w) => w.rovers.find((x: any) => x.id === r.u.id)?.spark);
  expect(w, 'it welds on its RPU: the spark is on').not.toBeNull();
});

// ───────────────────────────── saves ─────────────────────────────

test('an old save (fleet schema 1) starts every rover and excavator fully charged', async ({ page }) => {
  test.setTimeout(120_000);
  await start(page);
  const r = await page.evaluate(async () => {
    const g = window.__game!;
    near('excavator', -24, 0);
    g.finishConstruction();
    g.advanceGameSeconds(5);
    const blob = g.saveBlob();
    // a save from before packs: schema 1, and stale pack fields that mean nothing to it
    blob.state.fleetSchema = 1;
    for (const u of blob.state.rovers) { u.charge = 3; u.src = 'flat'; u.pw = 0; }
    for (const b of blob.state.buildings) if (b.haul) { b.haul.charge = 2; b.haul.src = 'flat'; }
    await g.loadBlob(blob);
    g.setPaused(true);
    const s1 = g.getState();
    g.advanceGameSeconds(1);
    return { schema: s1.fleetSchema, rovers: s1.rovers, hauls: s1.buildings.filter((b: any) => b.haul).map((b: any) => b.haul), fleet: g.getFleet() };
  });
  expect(r.schema).toBe(2);
  for (const u of r.rovers) {
    expect(u.charge).toBeUndefined(); // a full pack
    expect(u.src).toBeUndefined();
    expect(u.pw).toBeUndefined();
  }
  expect(r.hauls.length).toBe(1);
  expect(r.hauls[0].charge).toBeUndefined();
  for (const v of r.fleet.rovers) expect(v.pack).toMatch(/^BATTERY 100%/);
});

// ───────────────────────────── what the UI says ─────────────────────────────

test('the inspector, the site, the power and robots panels and one alert say when units are out of charge', async ({ page }) => {
  test.setTimeout(180_000);
  await start(page);
  await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('prospectingRovers');
    g.instantTravel(true);
    // a Relay Mast standing (priority 1): dark, it makes the brownout a brownout
    near('relayMast', -20, 16);
    g.finishConstruction();
    const lab = near('lab', 20, 24)!;
    g.finishRoads();
    g.grantPower(5000);
    (window as any).lab = lab;
    (window as any).rover = weldOn(lab);
    g.setCharge('rover', (window as any).rover, 240);
    g.advanceGameSeconds(1);
    g.selectRover((window as any).rover);
  });
  // charging at the site's feed
  await expect(page.locator('#rv-pack')).toHaveText(/^BATTERY 5\d% · charging$/);
  await page.evaluate(() => {
    const g = window.__game!;
    g.setCharge('rover', (window as any).rover, 20);
    g.forceGridDark(true);
    g.advanceGameSeconds(12);
    g.selectRover((window as any).rover);
  });
  await expect(page.locator('#rv-pack')).toHaveText('NO POWER — waiting for the grid (brownout)');
  // the site: its rover out of charge
  await page.evaluate(() => window.__game!.select((window as any).lab));
  await expect(page.locator('#insp-status')).toHaveText(/^ROVER OUT OF CHARGE — waiting for the grid \(\d+%\)$/);
  // one condition alert while units are stalled
  const s = await page.evaluate(() => window.__game!.getState());
  const flats = s.alerts.filter((a: any) => a.cond && /^OUT OF CHARGE — /.test(a.text));
  expect(flats.length).toBe(1);
  expect(flats[0].text).toMatch(/^OUT OF CHARGE — \d+ units? waiting for the grid/);
  expect(s.power.flat).toBeGreaterThan(0);
  // the Power panel lists the fleet's draw; the robots panel counts the units waiting
  await page.evaluate(() => window.__game!.select(null));
  await page.locator('#resource-strip .chip[data-key="power"]').first().click();
  await expect(page.locator('#res-panel')).toContainText('Fleet: driving, road work, charging');
  await expect(page.locator('#res-panel')).toContainText(/out of charge now, waiting for the grid/);
  await page.locator('#resource-strip .chip[data-key="bots"]').click();
  await expect(page.locator('#res-panel')).toContainText(/\d+ units? waiting for charge/);
});

// ───────────────────────────── relay masts (docs/15 §5b) ─────────────────────────────

test('a Relay Mast far from any road gets no road cells, and is built by a rover that drove out to it off-road', async ({ page }) => {
  test.setTimeout(120_000);
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('prospectingRovers');
    const s0 = g.getState();
    const roads0 = s0.roads.length;
    // open ground ~50 m out, where the only road is the Lander's apron
    const mast = near('relayMast', 50, -12)!;
    const s1 = g.getState();
    const acc = g.roadAccess().find((a: any) => a.id === mast);
    let trip: any = null;
    let t = 0;
    for (; t < 200 && byId(mast).construction > 0; t++) {
      g.advanceGameSeconds(1);
      const u = crewOf(mast)[0];
      if (u?.trip?.site === mast && u.trip.kind === 'weld' && !trip) trip = u.trip;
    }
    const s2 = g.getState();
    return { roads0, roads1: s1.roads.length, roads2: s2.roads.length, jobs: s2.roadJobs.length, spur: byId(mast).spur, acc, trip, built: byId(mast).construction === 0, t };
  });
  // no road, before or after: no spur, no job, not one cell laid
  expect(r.roads1).toBe(r.roads0);
  expect(r.roads2).toBe(r.roads0);
  expect(r.jobs).toBe(0);
  expect(r.spur).toEqual([]);
  expect(r.acc.door).toBeNull();
  expect(r.acc.stand.offM).toBeGreaterThan(30);
  // the rover drove there: the road to its gate (the apron), then off-road at half speed
  expect(r.trip).not.toBeNull();
  expect(r.trip.w?.length).toBeGreaterThan(0);
  expect(r.trip.w[r.trip.w.length - 1]).toBe(2);
  const legs = r.trip.pts.slice(1).map((p: number[], i: number) => Math.hypot(p[0] - r.trip.pts[i][0], p[1] - r.trip.pts[i][1]));
  const off = legs.filter((_: number, i: number) => r.trip.w[i] === 2).reduce((a: number, l: number) => a + l, 0);
  expect(off).toBeGreaterThan(30);
  // its time counts the off-road metres double (ROAD.offroad 0.5)
  expect(r.trip.len).toBeCloseTo(legs.reduce((a: number, l: number, i: number) => a + l * r.trip.w[i], 0), 5);
  expect(r.trip.dur).toBeGreaterThan(r.trip.len / 4.5);
  expect(r.built).toBe(true);
});
