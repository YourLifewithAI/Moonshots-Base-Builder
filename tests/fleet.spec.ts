/** Fleet control (core/fleet.ts, core/haul.ts): construction rovers as sim
 *  units — auto one per site, Summon / Release / Send to… pins, the n^0.85
 *  crew rate, surveys flown by drones that never borrow a rover — and a hub's
 *  Regolith Excavator as a hauling digger: credited on unload, the hub's
 *  grade from deliveries, distance as the trade-off, Send… and Auto, saves
 *  mid-haul, the drawn unit's upgrades and lights. The two robotics
 *  capability techs. Old saves' pad excavators join hubs in hubs.spec. */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

const URL_DEBUG = '/?debug&seed=42';
const RATE_EXP = 0.85;

async function start(page: Page, site = 'mare', exp: 'human' | 'robotic' = 'human') {
  await page.goto(`${URL_DEBUG}&site=${site}${exp === 'robotic' ? '&exp=robotic' : ''}`);
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
  await page.evaluate(HELPERS);
}

const hasAlert = (s: any, re: RegExp) => s.alerts.some((a: any) => re.test(a.text));

/** The first world point whose screen position is on the canvas itself (in
 *  view, not under a HUD panel): a click lands there. */
async function onCanvas(page: Page, pts: [number, number][]) {
  const at = await page.evaluate((list) => {
    for (const [x, z] of list) {
      const p = window.__game.screenOf(x, z);
      if (!p.visible) continue;
      if (document.elementFromPoint(p.x, p.y)?.tagName === 'CANVAS') return { x: p.x, y: p.y, wx: x, wz: z };
    }
    return null;
  }, pts);
  expect(at, `one of ${JSON.stringify(pts)} on the canvas`).not.toBeNull();
  return at!;
}

/** In-page helpers: powered(secs) advances with the bank topped up; near()
 *  finds the valid cell nearest a world point; drained(secs) advances second
 *  by second with the regolith store emptied (so a full yard never stalls a
 *  measurement); site(type) / byType(type) read the state. */
declare function powered(secs: number): void;
declare function drained(secs: number): void;
declare function near(type: string, x: number, z: number, test?: (cx: number, cz: number) => boolean,
  w?: number, d?: number): { gx: number; gz: number; cx: number; cz: number } | null;
declare function byType(type: string): any;
declare function hubBy(type: string, depId: string | null, x?: number, z?: number, off?: number): number | null;
declare function power(n: number): number;
declare function units(hub?: number): any[];
const HELPERS = `(() => {
/** a hub just outside a deposit's ring (its door toward it), or near (x, z) with no deposit; its id */
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
/** n Solar Arrays, built where the base has room */
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
window.units = (hub) => window.__game.getState().haulers.filter((u) => hub === undefined || u.hub === hub);
window.powered = (secs) => {
  const g = window.__game;
  for (let t = 0; t < secs; t += 10) { g.grantPower(5000); g.advanceGameSeconds(Math.min(10, secs - t)); }
};
window.drained = (secs) => {
  const g = window.__game;
  for (let t = 0; t < secs; t++) {
    if (t % 10 === 0) g.grantPower(5000);
    const r = g.getState().resources.regolith;
    if (r > 0) g.grantResources({ regolith: -r });
    g.advanceGameSeconds(1);
  }
};
window.byType = (t) => window.__game.getState().buildings.find((b) => b.type === t);
window.near = (type, x, z, test, w = 2, d = 2) => {
  const g = window.__game;
  const c = { gx: Math.round((x + 512) / 4 - w / 2), gz: Math.round((z + 512) / 4 - d / 2) };
  const cells = [];
  for (let dx = -14; dx <= 14; dx++) for (let dz = -14; dz <= 14; dz++) cells.push([c.gx + dx, c.gz + dz]);
  cells.sort((a, b) => Math.hypot(a[0] - c.gx, a[1] - c.gz) - Math.hypot(b[0] - c.gx, b[1] - c.gz));
  for (const [gx, gz] of cells) {
    const cx = (gx + w / 2) * 4 - 512, cz = (gz + d / 2) * 4 - 512;
    if (test && !test(cx, cz)) continue;
    if (g.canPlace(type, gx, gz).valid) return { gx, gz, cx, cz };
  }
  return null;
};
})()`;

// ───────────────────────────── construction rovers ─────────────────────────────

test('summon adds a rover to a site and builds it n^0.85 faster on the same weld parts', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.instantTravel(true); // the rate is the point, not the drive (transit.spec times that)
    g.placeBuilding('habitat', 132, 126);
    g.finishRoads(); // its road open: the rovers weld from the first second (docs/15)
    g.advanceGameSeconds(1);
    const id = byType('habitat').id;
    const one = g.getState();
    const f1 = g.getFleet().sites[id];
    const c0 = byType('habitat').construction, p0 = g.getState().resources.parts;
    g.advanceGameSeconds(5);
    const c1 = byType('habitat').construction, p1 = g.getState().resources.parts;
    g.summonRover(id);
    g.advanceGameSeconds(1);
    const two = g.getState();
    const f2 = g.getFleet().sites[id];
    const c2 = byType('habitat').construction, p2 = g.getState().resources.parts;
    g.advanceGameSeconds(5);
    const c3 = byType('habitat').construction, p3 = g.getState().resources.parts;
    return { id, one, two, f1, f2, w1: c0 - c1, w2: c2 - c3, parts1: p0 - p1, parts2: p2 - p3,
      demand: g.getState().power.demand };
  });
  // one rover on the site (auto), the other free; then both, pinned
  expect(r.one.rovers.filter((x: any) => x.site === r.id)).toHaveLength(1);
  expect(r.one.bots).toEqual({ total: 2, busy: 1 });
  expect(r.f1).toMatchObject({ n: 1, pinned: 0 });
  expect(r.two.rovers.filter((x: any) => x.site === r.id && x.pinned)).toHaveLength(2);
  expect(r.two.bots).toEqual({ total: 2, busy: 2 });
  expect(r.f2).toMatchObject({ n: 2, pinned: 2 });
  // welded seconds: 5 with one rover, 5 × 2^0.85 with two; the ETA follows
  expect(r.w1).toBeCloseTo(5, 6);
  expect(r.w2 / r.w1).toBeCloseTo(2 ** RATE_EXP, 3);
  expect(r.f2.eta / r.f1.eta).toBeLessThan(1 / 2 ** RATE_EXP + 0.02);
  expect(r.f2.speed).toBeCloseTo(2 ** RATE_EXP, 6);
  // each rover draws its own 4 kW; parts drawn 2^0.85 faster — the same per build
  expect(r.f2.kw).toBeCloseTo(8, 6);
  expect(r.demand).toBeCloseTo(8, 6); // nothing else on the grid draws
  // (the Lander's own upkeep rides along: a tolerance, not an exact ratio)
  expect(r.parts2 / r.parts1).toBeGreaterThan(2 ** RATE_EXP - 0.1);
  expect(r.parts2 / r.parts1).toBeLessThan(2 ** RATE_EXP + 0.1);

  // the inspector: Rovers n · Summon · Release
  await page.evaluate((id) => window.__game.select(id), r.id);
  await expect(page.locator('#insp-crew')).toContainText('Rovers 2 (2 pinned)');
  await expect(page.locator('#insp-summon')).toBeVisible();
  await expect(page.locator('#insp-release')).toBeEnabled();
});

test('release and completion return rovers to auto', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.placeBuilding('habitat', 132, 126);
    g.placeBuilding('lab', 135, 133);
    g.advanceGameSeconds(1);
    const hab = byType('habitat').id, lab = byType('lab').id;
    // both sites have their auto rover; summoning takes the lab's (the busiest other site)
    g.summonRover(hab);
    g.advanceGameSeconds(1);
    const summoned = g.getState();
    g.releaseRover(hab);
    g.advanceGameSeconds(1);
    const released = g.getState();
    g.summonRover(hab);
    g.advanceGameSeconds(1);
    return { hab, lab, summoned, released };
  });
  const at = (s: any, id: number) => s.rovers.filter((x: any) => x.site === id);
  expect(at(r.summoned, r.hab)).toHaveLength(2);
  expect(at(r.summoned, r.lab)).toHaveLength(0);
  expect(r.summoned.buildings.find((b: any) => b.id === r.lab).idleReason).toBe('queued');
  // Release: one unpinned — it takes the queued lab; the habitat keeps one
  expect(at(r.released, r.hab)).toHaveLength(1);
  expect(at(r.released, r.lab)).toHaveLength(1);
  expect(at(r.released, r.lab)[0].pinned).toBe(false);

  // completion: the site's pinned rovers return to auto and take the next site
  const done = await page.evaluate(({ hab }) => {
    const g = window.__game!;
    const s0 = g.getState();
    const pinnedHere = s0.rovers.filter((x: any) => x.site === hab && x.pinned).map((x: any) => x.id);
    // weld the habitat to completion (the lab is 72 s; the habitat is shorter)
    for (let i = 0; i < 200 && byType('habitat').construction > 0; i++) { g.grantPower(5000); g.advanceGameSeconds(1); }
    g.advanceGameSeconds(1);
    return { pinnedHere, s: g.getState() };
  }, { hab: r.hab });
  expect(done.pinnedHere.length).toBe(2);
  expect(done.s.rovers.every((x: any) => !x.pinned)).toBe(true);
  expect(done.s.rovers.filter((x: any) => x.site === r.hab)).toHaveLength(0);
  expect(done.s.rovers.filter((x: any) => x.site === r.lab)).toHaveLength(1);
});

// picking and targeting under the fixed isometric camera
test('select a rover in the world, Send to…, click a site: it is pinned there', async ({ page }) => {
  await start(page, 'mare', 'human');
  await page.evaluate(() => {
    const g = window.__game!;
    g.placeBuilding('habitat', 132, 126);
    g.advanceGameSeconds(1);
    // look down on the base so the parked rovers and the site are in view
    g.setView({ x: 90, y: 100, z: 100 }, { x: 6, y: 0, z: 2 });
  });
  // the free rover, parked at the Lander
  const free = await page.evaluate(() => window.__game.getState().rovers.find((x: any) => x.site === null).id);
  let at: any = null;
  await expect.poll(async () => {
    at = await page.evaluate((id) => window.__game.poseOnScreen('rover', id), free);
    return at?.visible;
  }, { timeout: 20_000 }).toBe(true);
  // wait for it to settle, then click it
  await page.waitForTimeout(500);
  at = await page.evaluate((id) => window.__game.poseOnScreen('rover', id), free);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('#rover-inspector')).toBeVisible();
  await expect(page.locator('#rover-inspector')).toContainText(`#${free}`);
  await expect(page.locator('#rover-inspector')).toContainText('PARKED');
  expect((await page.evaluate(() => window.__game.getRenderInfo())).life.rovers.selected).toBe(free);
  await page.locator('#rv-send').click();
  await expect(page.locator('#fleet-hint')).toContainText(`SEND ROVER #${free}`);
  // a click on open ground says why not, and changes nothing
  const ground = await onCanvas(page, [[-20, 24], [-24, -26], [30, 30], [-30, 10], [10, -30], [40, 40]]);
  await page.mouse.move(ground.x, ground.y);
  await expect(page.locator('#fleet-hint')).toContainText('Not a construction site');
  await page.mouse.click(ground.x, ground.y);
  await expect(page.locator('#fleet-hint')).toHaveAttribute('data-flash', /\d+/);
  // then the site
  const hab = await page.evaluate(() => byType('habitat'));
  const hx = (hab.gx + 1) * 4 - 512, hz = (hab.gz + 1) * 4 - 512;
  const siteAt = await onCanvas(page, [[hx, hz], [hx - 1.5, hz + 1.5], [hx + 1.5, hz - 1.5], [hx - 1.5, hz - 1.5]]);
  await page.mouse.move(siteAt.x, siteAt.y);
  await expect(page.locator('#fleet-hint')).toContainText(`Habitat Module #${hab.id} · 1 → 2 rovers`);
  await page.mouse.click(siteAt.x, siteAt.y);
  await expect(page.locator('#fleet-hint')).toBeHidden();
  await page.evaluate(() => window.__game.advanceGameSeconds(1));
  const s = await page.evaluate(() => window.__game.getState());
  const rover = s.rovers.find((x: any) => x.id === free);
  expect(rover).toMatchObject({ site: hab.id, pinned: true });
  expect(s.rovers.filter((x: any) => x.site === hab.id)).toHaveLength(2);
  await expect(page.locator('#rover-inspector')).toContainText('pinned');
  // Esc closes the rover inspector
  await page.keyboard.press('Escape');
  await expect(page.locator('#rover-inspector')).toBeHidden();
});

test('a survey flies a drone: it never asks for a rover, pinned or not', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.instantTravel(true); // who is lent is the point, not the drive
    g.completeTech('prospectingRovers'); // Prospecting Drones
    g.grantResources({ oxygen: 300, water: 100, parts: 50 });
    g.placeBuilding('habitat', 132, 126);
    g.finishRoads(); // its road open: welding, not sintering (docs/15)
    g.advanceGameSeconds(1);
    const hab = byType('habitat').id;
    g.summonRover(hab); // both rovers pinned to the habitat
    g.advanceGameSeconds(1);
    const before = g.getState();
    g.grantPower(1000);
    g.surveyProspect('tranqPit');
    g.advanceGameSeconds(1);
    return { hab, before, s: g.getState() };
  });
  expect(r.before.rovers.filter((x: any) => x.pinned)).toHaveLength(2);
  // the Lander's drone is out: one flight, and no rover lent (the old `active` slot stays null)
  expect(r.s.survey.flights).toHaveLength(1);
  expect(r.s.survey.active).toBeNull();
  expect(hasAlert(r.s, /^SURVEY LAUNCHED — /)).toBe(true);
  expect(hasAlert(r.s, /SURVEY NEEDS A FREE ROVER/)).toBe(false);
  // both pinned rovers keep welding, and the fleet reads two busy, none lent
  expect(r.s.rovers.map((x: any) => ({ site: x.site, pinned: x.pinned }))).toEqual([{ site: r.hab, pinned: true }, { site: r.hab, pinned: true }]);
  expect(r.s.bots).toEqual({ total: 2, busy: 2 });
  expect(r.s.buildings.find((b: any) => b.id === r.hab).idleReason).toBe('building');
});

async function putSave(page: Page, st: any) {
  await page.goto(URL_DEBUG);
  await page.evaluate((state) => new Promise((resolve, reject) => {
    const req = indexedDB.open('keyval-store');
    req.onsuccess = () => {
      const tx = req.result.transaction('keyval', 'readwrite');
      tx.objectStore('keyval').put({
        state, player: { mode: 'build', x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, savedAt: Date.now(),
      }, 'mbb-save-v1');
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  }), st);
  await page.reload();
  await page.locator('#btn-continue').click();
  await page.waitForFunction(() => (window.__game?.getState()?.buildings?.length ?? 0) > 1);
}

test('saves keep the roster and its pins; an old save builds its roster on load', async ({ page }) => {
  test.setTimeout(240_000); // four page loads
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await start(page);
  const before = await page.evaluate(() => {
    const g = window.__game!;
    g.placeBuilding('habitat', 132, 126);
    g.placeBuilding('lab', 135, 133);
    g.advanceGameSeconds(1);
    g.summonRover(byType('habitat').id);
    g.advanceGameSeconds(1);
    return g.getState();
  });
  await putSave(page, before);
  const after = await page.evaluate(() => window.__game.getState());
  expect(after.rovers).toEqual(before.rovers);
  expect(after.nextRoverId).toBe(before.nextRoverId);

  // a save from before fleet control: bots {total, busy} only
  const legacy = JSON.parse(JSON.stringify(before));
  delete legacy.rovers;
  delete legacy.nextRoverId;
  legacy.bots = { total: 2, busy: 2 };
  await putSave(page, legacy);
  const migrated = await page.evaluate(() => {
    const g = window.__game!;
    g.setPaused(true);
    g.advanceGameSeconds(1);
    return g.getState();
  });
  expect(migrated.rovers).toHaveLength(2);
  expect(migrated.rovers.every((x: any) => !x.pinned)).toBe(true);
  // auto again: one per site, in queue order
  const hab = migrated.buildings.find((b: any) => b.type === 'habitat').id;
  const lab = migrated.buildings.find((b: any) => b.type === 'lab').id;
  expect(migrated.rovers.map((x: any) => x.site).sort()).toEqual([hab, lab].sort());
  expect(migrated.bots).toEqual({ total: 2, busy: 2 });
  expect(errors).toEqual([]);
});

// ───────────────────────────── a hub's hauling excavator ─────────────────────────────

/** A Regolith Smelter by the high-Ti basalt, built, with the one unit it commissions with; the hub and the unit. */
async function hubUnit(page: Page, off = 3) {
  return page.evaluate((off) => {
    const g = window.__game!;
    g.holdHazards(true);
    g.grantResources({ metals: 400, parts: 200 });
    power(12);
    const hub = hubBy('smelter', 'ilmenite-0', undefined, undefined, off)!;
    g.finishConstruction();
    g.advanceGameSeconds(1);
    return { hub, unit: units(hub)[0].id };
  }, off);
}

test('a load is credited only on unload: dig, haul, tip, back', async ({ page }) => {
  await start(page, 'mare', 'robotic'); // (a crew would run out of air in a long run)
  const { hub, unit } = await hubUnit(page);
  const r = await page.evaluate((id) => {
    const g = window.__game!;
    const trace: { t: number; made: number; phase: string; cargo: number }[] = [];
    for (let i = 0; i < 300; i++) {
      g.grantPower(100);
      g.advanceGameSeconds(1);
      const s = g.getState();
      const h = s.haulers.find((x: any) => x.id === id).haul;
      trace.push({ t: s.simTime, made: s.stats.produced.regolith, phase: h.phase, cargo: h.cargo.regolith ?? 0 });
    }
    return { trace, view: g.getHubs().units.find((x: any) => x.id === id) };
  }, unit);
  const jumps = r.trace.filter((x, i) => i > 0 && x.made > r.trace[i - 1].made + 1e-9);
  expect(jumps.length).toBeGreaterThanOrEqual(2);
  // every rise of the tonnage is a whole bucket, on the tick the tip ends
  for (const j of jumps) {
    const i = r.trace.indexOf(j);
    expect(j.made - r.trace[i - 1].made).toBeCloseTo(105 * 1.25, 6); // the mare's ISRU ×1.25
    expect(r.trace[i - 1].phase).toBe('unload');
    expect(j.phase).toBe('toDig');
  }
  // the phases in order, and nothing credited while digging or driving
  const phases = r.trace.map((x) => x.phase).filter((p, i, a) => i === 0 || p !== a[i - 1]);
  const firstDig = phases.indexOf('dig');
  expect(phases.slice(firstDig, firstDig + 5)).toEqual(['dig', 'toDrop', 'unload', 'toDig', 'dig']);
  const between = r.trace.slice(r.trace.indexOf(jumps[0]), r.trace.indexOf(jumps[1]));
  expect(new Set(between.map((x) => x.made)).size).toBe(1);
  expect(r.view.hubName).toBe(`Regolith Smelter #${hub}`); // it tips into its own hub's hopper
});

test('the hub\'s grade follows what is delivered, weighted by amount', async ({ page }) => {
  test.setTimeout(180_000);
  await start(page, 'mare', 'robotic'); // (a crew would run out of air in a long run)
  const { hub, unit } = await hubUnit(page);
  const r = await page.evaluate(({ hub, unit }) => {
    const g = window.__game!;
    const drain = (secs: number) => {
      for (let t = 0; t < secs; t++) {
        g.grantPower(5000);
        const reg = g.getState().resources.regolith;
        if (reg > 0) g.grantResources({ regolith: -reg });
        g.advanceGameSeconds(1);
      }
    };
    const feedOf = () => g.getState().buildings.find((b: any) => b.id === hub).hub.feed;
    drain(150);
    const before = { ...feedOf() };
    // a plain pit of its own, and the unit sent there: the loads it tips move the mix
    let pit: any = null;
    for (let r = 0; r <= 60 && !pit; r += 4) for (let k = 0; k < (r ? 16 : 1) && !pit; k++) {
      const a = (k / 16) * Math.PI * 2, px = -60 + Math.cos(a) * r, pz = 10 + Math.sin(a) * r;
      if (g.plainPitWhy(px, pz)) continue;
      const n = g.getState().plainPits.length;
      g.openPit(hub, px, pz);
      g.advanceGameSeconds(1);
      const all = g.getState().plainPits;
      if (all.length > n) pit = all[all.length - 1];
    }
    g.finishRoads(); // its haul road open at once (docs/15)
    g.sendUnit(unit, `plain:${pit.id}`);
    g.select(hub);
    const shares: number[] = [];
    const tips: number[] = [];
    let last = -1, made = g.getState().stats.produced.regolith;
    for (let i = 0; i < 900; i++) {
      drain(1);
      const f = feedOf().plain;
      const m = g.getState().stats.produced.regolith;
      if (m > made + 1e-9 && f > 1e-9) tips.push(m - made);
      made = m;
      if (f !== last && f > 1e-9) { shares.push(f); last = f; }
    }
    return { before, pit: pit?.id, shares, tips, feed: feedOf() };
  }, { hub, unit });
  expect(r.before.ilmenite).toBeCloseTo(1, 9);
  expect(r.pit).toBeTruthy();
  // the first plain load moves the mix a share of the way — its tonnes over (its tonnes + the 210▲ memory) —
  // and each next load closes the gap; the ilmenite fades
  expect(r.shares.length).toBeGreaterThanOrEqual(3);
  expect(r.shares[0]).toBeCloseTo(r.tips[0] / (r.tips[0] + 210), 3);
  for (let i = 1; i < r.shares.length; i++) expect(r.shares[i]).toBeGreaterThan(r.shares[i - 1]);
  expect(r.feed.plain + r.feed.ilmenite).toBeCloseTo(1, 9);
  await expect(page.locator('#inspector')).toContainText(/feed q \d\.\d\d/);
  await page.evaluate((u) => window.__game.selectUnit(u), unit);
  await expect(page.locator('#unit-inspector')).toContainText('plain pit');
});

test('distance is the trade-off: a haul delivers by its road route, a farther pit less', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page, 'mare', 'robotic'); // (a crew would run out of air in a long run)
  const { hub, unit } = await hubUnit(page, 6);
  const r = await page.evaluate(({ hub, unit }) => {
    const g = window.__game!;
    const drain = (secs: number) => {
      for (let t = 0; t < secs; t++) {
        g.grantPower(5000);
        const reg = g.getState().resources.regolith;
        if (reg > 0) g.grantResources({ regolith: -reg });
        g.advanceGameSeconds(1);
      }
    };
    const view = () => g.getHubs().units.find((x: any) => x.id === unit);
    // a plain pit well out from the hub, and the deposit beside it
    let far: any = null;
    for (let r = 0; r <= 120 && !far; r += 4) for (let k = 0; k < (r ? 16 : 1) && !far; k++) {
      const a = (k / 16) * Math.PI * 2, px = -100 + Math.cos(a) * r, pz = 40 + Math.sin(a) * r;
      if (g.plainPitWhy(px, pz)) continue;
      const n = g.getState().plainPits.length;
      g.openPit(hub, px, pz);
      g.advanceGameSeconds(1);
      const all = g.getState().plainPits;
      if (all.length > n) far = all[all.length - 1];
    }
    g.finishRoads(); // its haul road open at once (docs/15)
    // whole cycles: from one tip to the sixth after it
    const measure = (key: string) => {
      g.sendUnit(unit, key);
      drain(300); // settle into the new route
      const made = () => g.getState().stats.produced.regolith;
      const next = () => { const m = made(); for (let i = 0; i < 600 && made() === m; i++) drain(1); };
      next();
      const m0 = made(), t0 = g.getState().simTime;
      for (let k = 0; k < 6; k++) next();
      const s = g.getState();
      const v = view();
      return { rate: (s.stats.produced.regolith - m0) / (s.simTime - t0), viewRate: v.rate, tripS: v.tripS, target: v.target };
    };
    const near = measure('dep:ilmenite-0');
    const away = measure(`plain:${far.id}`);
    return { near, away, far: far.id };
  }, { hub, unit });
  expect(r.near.target).toBe('dep:ilmenite-0');
  expect(r.away.target).toBe(`plain:${r.far}`);
  // the trip is the road route: its rate is a bucket over dig + tip + the two ways (the view's own reading)
  expect(r.near.rate / r.near.viewRate).toBeGreaterThan(0.9);
  expect(r.near.rate / r.near.viewRate).toBeLessThan(1.1);
  expect(r.away.rate / r.away.viewRate).toBeGreaterThan(0.9);
  expect(r.away.rate / r.away.viewRate).toBeLessThan(1.1);
  // and the farther pit delivers less
  expect(r.away.tripS).toBeGreaterThan(r.near.tripS * 1.5);
  expect(r.away.rate).toBeLessThan(r.near.rate * 0.85);
});

test('Send… refuses open ground with its reason, sends a unit to a pit it names, and Auto gives it back to its hub', async ({ page }) => {
  test.setTimeout(120_000);
  await start(page, 'mare', 'robotic');
  const { hub, unit } = await hubUnit(page);
  // a plain pit for it to be sent to, its haul road open
  const pit = await page.evaluate((hub) => {
    const g = window.__game!;
    for (let r = 0; r <= 100; r += 4) for (let k = 0; k < (r ? 24 : 1); k++) {
      const a = (k / 24) * Math.PI * 2, px = -30 + Math.cos(a) * r, pz = 10 + Math.sin(a) * r;
      if (g.plainPitWhy(px, pz)) continue;
      // one the player can click: in view, not under a HUD panel
      const sp = g.screenOf(px, pz);
      if (!sp.visible || document.elementFromPoint(sp.x, sp.y)?.tagName !== 'CANVAS') continue;
      const n = g.getState().plainPits.length;
      g.openPit(hub, px, pz);
      g.advanceGameSeconds(1);
      const all = g.getState().plainPits;
      if (all.length > n) { g.finishRoads(); return all[all.length - 1]; }
    }
    return null;
  }, hub);
  expect(pit, 'a plain pit').not.toBeNull();
  await page.evaluate((id) => window.__game.selectUnit(id), unit);
  await page.locator('#un-send').click();
  await expect(page.locator('#fleet-hint')).toContainText('SEND E');
  // open ground says why not, and changes nothing
  const ground = await onCanvas(page, [[-20, -24], [-24, -26], [30, -30], [-30, -10], [10, -30], [40, -40]]);
  await page.mouse.move(ground.x, ground.y);
  await expect(page.locator('#fleet-hint')).toContainText('Not a pit — click a mapped deposit');
  await page.mouse.click(ground.x, ground.y);
  await expect(page.locator('#fleet-hint')).toHaveAttribute('data-flash', /\d+/);
  // the plain pit: the estimate, then the click takes it
  const spot = await onCanvas(page, [[pit.x, pit.z], [pit.x + 3, pit.z], [pit.x, pit.z + 3], [pit.x - 3, pit.z - 3]]);
  await page.mouse.move(spot.x, spot.y);
  await expect(page.locator('#fleet-hint')).toContainText(/plain pit P\d+ · [≈]?\d+:\d\d one way · faces \d\/\d/);
  await page.mouse.click(spot.x, spot.y);
  await expect(page.locator('#fleet-hint')).toBeHidden();
  const sent = await page.evaluate((id) => { window.__game.advanceGameSeconds(1); return window.__game.getState().haulers.find((x: any) => x.id === id); }, unit);
  expect(sent.target).toBe(`plain:${pit.id}`);
  expect(sent.pinned).toBe(true);
  // the action refuses the same way, and names the reason: a pit the hub cannot reach
  const refused = await page.evaluate((id) => {
    const g = window.__game!;
    g.sendUnit(id, 'dep:no-such-deposit');
    g.advanceGameSeconds(0);
    return g.getState();
  }, unit);
  expect(hasAlert(refused, /^CANNOT SEND — NOT A PIT — click a mapped deposit or a plain pit/)).toBe(true);
  expect(refused.haulers.find((x: any) => x.id === unit).target).toBe(`plain:${pit.id}`);
  // Auto: its hub chooses for it again
  await page.evaluate((id) => window.__game.selectUnit(id), unit);
  await expect(page.locator('#un-mode')).toContainText('sent — stays until you press Auto');
  await page.locator('#un-auto').click();
  const auto = await page.evaluate((id) => { window.__game.advanceGameSeconds(2); return window.__game.getState().haulers.find((x: any) => x.id === id); }, unit);
  expect(auto.pinned).toBe(false);
  await expect(page.locator('#un-auto')).toHaveCount(0);
  await expect(page.locator('#un-mode')).toContainText('auto — its hub chooses');
});

test('saves keep the unit mid-haul: its cargo, its target and its route; and it carries on', async ({ page }) => {
  test.setTimeout(240_000); // page loads
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await start(page, 'mare', 'robotic');
  const { unit } = await hubUnit(page);
  const before = await page.evaluate((id) => {
    const g = window.__game!;
    g.finishRoads(); // its haul road open at once (docs/15)
    const h = () => g.getState().haulers.find((b: any) => b.id === id).haul;
    // room in the store: a full hopper keeps a full bucket waiting at the face (docs/15 §5)
    const tick = () => {
      g.grantPower(100);
      const reg = g.getState().resources.regolith;
      if (reg > 0) g.grantResources({ regolith: -reg });
      g.advanceGameSeconds(1);
    };
    // into the haul: bucket full, on the road
    for (let i = 0; i < 400 && h().phase !== 'toDrop'; i++) tick();
    g.grantPower(100);
    g.advanceGameSeconds(2);
    return g.getState();
  }, unit);
  const u0 = before.haulers.find((x: any) => x.id === unit);
  expect(u0.haul.phase).toBe('toDrop');
  expect(u0.haul.cargo.regolith).toBeGreaterThan(100);
  await putSave(page, before);
  const after = await page.evaluate((id) => window.__game.getState().haulers.find((x: any) => x.id === id), unit);
  expect(after.haul).toEqual(u0.haul);
  expect(after.target).toBe(u0.target);
  expect(after.face).toBe(u0.face);
  // and it carries on: the load lands
  const landed = await page.evaluate(() => {
    const g = window.__game!;
    g.setPaused(true);
    const r0 = g.getState().stats.produced.regolith;
    for (let i = 0; i < 90 && g.getState().stats.produced.regolith === r0; i++) {
      g.grantPower(100);
      const reg = g.getState().resources.regolith; // room for it
      if (reg > 0) g.grantResources({ regolith: -reg });
      g.advanceGameSeconds(1);
    }
    return g.getState().stats.produced.regolith - r0;
  });
  expect(landed).toBeCloseTo(u0.haul.cargo.regolith, 6);
  expect(errors).toEqual([]);
});

// ───────────────────────────── research ─────────────────────────────

test('the capability techs: pros and cons on every card, and they reach the sim', async ({ page }) => {
  await start(page);
  const audit = await page.evaluate(() => window.__game.auditTechs());
  for (const t of audit) {
    expect(t.pros, `${t.id} has a pro`).toBeGreaterThan(0);
    expect(t.cons, `${t.id} has a con`).toBeGreaterThan(0);
    expect(t.minConMagnitude, `${t.id}'s con is real`).toBeGreaterThan(0);
  }
  const line = (id: string) => audit.find((t: any) => t.id === id).lines.map((l: any) => `${l.sign}:${l.text}`);
  expect(line('roverAutonomy')).toEqual([
    'pro:+25% build rate per rover',
    'con:construction draw ×1.3 (5.2 kW per working rover)',
  ]);
  expect(line('autonomousHaulage')).toEqual([
    'pro:+30% excavator haul speed',
    'pro:+25% excavator bucket (131.25▲ a load)',
    'con:+25% draw: Regolith Excavator',
    'con:+20% upkeep: Regolith Excavator',
  ]);
  // the fleet's existing bonuses read as rovers
  expect(line('swarmRobotics')).toContain('pro:+1 construction rover per Robotics Bay');
  expect(line('constructionRobotics')).toContain('pro:+2 construction rovers');
  const rv = await page.evaluate(() => window.__game.getResearch());
  expect(rv.cards.roverAutonomy).toMatchObject({ era: 4 });
  expect(rv.cards.autonomousHaulage).toMatchObject({ era: 5 });

  // in the sim: ×1.25 per rover at ×1.3 the draw; haul speed and bucket
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.instantTravel(true); // the rate is the point, not the drive
    g.completeTech('roverAutonomy');
    g.placeBuilding('habitat', 132, 126);
    g.finishRoads();
    g.advanceGameSeconds(1);
    const c0 = byType('habitat').construction;
    g.advanceGameSeconds(4);
    const welded = c0 - byType('habitat').construction;
    const kw = g.getFleet().sites[byType('habitat').id].kw;
    g.completeTech('autonomousHaulage');
    return { welded, kw };
  });
  expect(r.welded).toBeCloseTo(4 * 1.25, 6);
  expect(r.kw).toBeCloseTo(4 * 1.3, 6);
});

// ───────────────────────────── layout ─────────────────────────────

for (const vp of [{ width: 1280, height: 720 }, { width: 1280, height: 633 }]) {
  test(`fleet inspectors ${vp.width}×${vp.height}: every button above the fold with a full alert stack`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(vp);
    await start(page, 'southpole');
    const ids = await page.evaluate(() => {
      const g = window.__game!;
      g.completeTech('prospectingRovers');
      g.grantResources({ metals: 300, parts: 100, chips: 1, foils: 1, launch: 1, oxygen: -110, water: -45 });
      // a smelter and its unit, sent away from where its hub would choose: Auto shows
      const hub = hubBy('smelter', null, -24, -2)!;
      g.finishConstruction();
      // three sites for two rovers: one queued, and a crew of two on the first
      const s1 = near('solar', 20, -2)!; g.placeBuilding('solar', s1.gx, s1.gz);
      const s2 = near('solar', 20, 14)!; g.placeBuilding('solar', s2.gx, s2.gz);
      const s3 = near('solar', 20, 30)!; g.placeBuilding('solar', s3.gx, s3.gz);
      g.advanceGameSeconds(1);
      const sites = g.getState().buildings.filter((b: any) => b.construction > 0).map((b: any) => b.id);
      g.summonRover(sites[0]);
      const unit = units(hub)[0];
      g.sendUnit(unit.id, unit.target); // pinned where it is: Send…, Recall, Auto
      g.advanceGameSeconds(3);
      return { sites, hub, unit: unit.id, rover: g.getState().rovers.find((r: any) => r.pinned).id };
    });
    type Box = { x: number; y: number; width: number; height: number };
    const inView = async (sel: string, min: number) => {
      const box = (await page.locator(sel).boundingBox()) as Box;
      expect(box.y + box.height, `${sel} fits the viewport`).toBeLessThanOrEqual(vp.height);
      const btns = await page.locator(`${sel} .insp-foot button`).evaluateAll((els) =>
        els.map((e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.textContent, top: r.top, bottom: r.bottom }; }));
      expect(btns.length).toBeGreaterThanOrEqual(min);
      for (const b of btns) {
        expect(b.bottom, `${sel} ${b.id}`).toBeLessThanOrEqual(box.y + box.height);
        expect(b.top, `${sel} ${b.id}`).toBeGreaterThanOrEqual(box.y);
      }
    };
    // the site with a crew: priority, Summon, Release, Pause, Cancel, close
    await page.evaluate((id) => window.__game.select(id), ids.sites[0]);
    await expect(page.locator('#insp-summon')).toBeVisible();
    await inView('#inspector', 9);
    // the queued site: Build next as well
    await page.evaluate((id) => window.__game.select(id), ids.sites[2]);
    await expect(page.locator('#insp-buildnext')).toBeVisible();
    await inView('#inspector', 10);
    // the hub, the tallest foot: priority, print, bay, Open pit…, Shut down, Demolish, close
    await page.evaluate((id) => window.__game.select(id), ids.hub);
    await expect(page.locator('#hub-print')).toBeVisible();
    await inView('#inspector', 6);
    await page.screenshot({ path: `test-results/fleet-inspector-${vp.width}x${vp.height}.png` });
    // the unit sent to a pit: Send…, Recall, Auto, Hub, close; what it is doing reads in the head, which never scrolls
    await page.evaluate((id) => window.__game.selectUnit(id), ids.unit);
    await expect(page.locator('#un-auto')).toBeVisible();
    await expect(page.locator('#un-status')).toContainText(/^(DIGGING|HAULING|TIPPING|OUT TO|RETURNING|WAITING|PARKED|CHARGING)/);
    await inView('#unit-inspector', 5);
    // the rover inspector: Send to…, Release to auto, Dock, close
    await page.evaluate((id) => window.__game.selectRover(id), ids.rover);
    await expect(page.locator('#rover-inspector #rv-unpin')).toBeVisible();
    await inView('#rover-inspector', 4);
  });
}

// ───────────────────────────── the drawn unit ─────────────────────────────

test('the drawn hub unit wears the upgraded recipe and its lamps follow its own darkness', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.holdHazards(true);
    g.grantResources({ metals: 400, parts: 200 });
    g.completeTech('grizzlyScreens');
    g.completeTech('autonomousHaulage');
    power(12);
    const hub = hubBy('smelter', 'ilmenite-0', undefined, undefined, 3)!;
    g.finishConstruction();
    // at night, so the lamps are lit; the unit at work (the store is emptied so it never waits for room)…
    drained(700 - g.getState().simTime);
    const unit = units(hub)[0].id;
    g.setPaused(false); // a second of live frames: it is drawn where the sim has it
    for (let i = 0; i < 20; i++) g.stepFrame(0.05);
    g.setPaused(true);
    g.stepFrame(0.05);
    return { unit, up: g.getUpgrades(), life: g.getRenderInfo().life.haulers, night: g.getState().simTime };
  });
  // the same upgraded recipe the palette's excavator wears, drawn on the unit
  expect(r.up.want.excavator).toBe('grizzlyScreens,autonomousHaulage');
  const drawn = Object.entries(r.life.meshes as Record<string, { count: number; key: string; triangles: number }>).filter(([, m]) => m.count > 0);
  expect(drawn.length).toBe(1);
  expect(drawn[0][1].key).toBe('grizzlyScreens,autonomousHaulage');
  expect(drawn[0][1].triangles).toBeGreaterThan(50);
  // it is the one drawn (a hub unit's id in the picture is UNIT_VID + its own), and no pad excavator stands
  expect(r.life.away).toHaveLength(1);
  expect(r.life.away[0]).toBeGreaterThan(r.unit);
  expect(r.up.meshes.excavator?.count ?? 0).toBe(0);
  // the lit channel 2 + k at the unit's own darkness
  expect(r.life.dark[0]).toBeGreaterThan(0.5); // night
  expect(r.life.lit[0]).toBeCloseTo(2 + r.life.dark[0], 3);
});


// docs/19 S11: a dock with one parking cell and more rovers than the cell holds
test('a Robotics Bay with one parking cell and three rovers: the third stays inside, and no rover waits long on another', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page, 'mare', 'robotic');
  const setup = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('constructionRobotics');
    g.completeTech('swarmRobotics'); // three rovers to a Bay
    g.grantResources({ metals: 5000, parts: 5000 });
    const put = (type: string, x: number, z: number) => {
      const c = { gx: Math.round((x + 512) / 4), gz: Math.round((z + 512) / 4) };
      for (let r = 0; r < 16; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        for (const rot of [0, 1, 2, 3]) if (g.canPlace(type, c.gx + dx, c.gz + dz, rot).valid && g.placeBuilding(type, c.gx + dx, c.gz + dz, rot)) return true;
      }
      return false;
    };
    // the Bay at world (16, 20), its door toward ilmenite-0's ring: the road along its front leaves one cell to park in
    const bayAt = g.placeBuilding('roboticsBay', 132, 133, 1);
    const dep = g.getDeposits().find((q: any) => q.id === 'ilmenite-0');
    const rest = [put('smelter', dep.x + 30, dep.z), put('solar', 30, 10), put('solar', 30, 18), put('solar', 34, 10)];
    g.finishConstruction();
    // four sites for the rovers, two more summoned to the first
    rest.push(put('lab', -10, -26), put('lab', 10, -26), put('storageYard', -34, 14), put('lab', 30, 34));
    g.advanceGameSeconds(1);
    const bay = g.getState().buildings.find((b: any) => b.type === 'roboticsBay');
    const ids = g.getState().buildings.filter((b: any) => b.construction > 0).map((b: any) => b.id);
    g.summonRover(ids[0]);
    g.summonRover(ids[0]);
    const homed = g.getState().rovers.filter((r: any) => r.home === bay.id).map((r: any) => r.id);
    return { bayAt, rest, bay: bay.id, homed, bays: g.getState().roads.filter((c: any) => c.bay && Math.abs(c.gx - 132) <= 3 && Math.abs(c.gz - 133) <= 3).length };
  });
  expect(setup.bayAt).toBe(true);
  expect(setup.rest.every(Boolean)).toBe(true);
  expect(setup.homed).toHaveLength(3);
  expect(setup.bays, 'one parking cell beside its door').toBe(1);
  // four game-minutes of the crowd going out to the sites and coming home, live at 10×
  const r = await page.evaluate(({ homed }) => {
    const g = window.__game!;
    g.setPaused(false);
    g.setSpeed(10);
    g.stepFrame(0);
    g.getRenderInfo();
    const spotOf = (id: number) => { const R = g.getRenderInfo().life.rovers; return R.spots[R.ids.indexOf(id)]; };
    const third = homed[homed.length - 1];
    const first = JSON.stringify(spotOf(third));
    let maxWaited = 0, moved = 0, parked = 0;
    for (let i = 0; i < 240; i++) {
      if (i % 10 === 0) g.grantPower(50000);
      g.stepFrame(0.1);
      const life = g.getRenderInfo().life;
      for (const u of life.traffic.units) maxWaited = Math.max(maxWaited, u.waited);
      // (parked: no site, no road job, no survey, no grading; at work its spot is the job's)
      const u = g.getState().rovers.find((x: any) => x.id === third);
      if (u.site === null && u.road === undefined && u.core === undefined && u.grade === undefined) {
        parked++;
        if (JSON.stringify(spotOf(third)) !== first) moved++;
      }
    }
    g.setPaused(true);
    g.stepFrame(0);
    return { maxWaited, moved, parked, rescues: g.getRenderInfo().life.traffic.rescues, first };
  }, { homed: setup.homed });
  // the third rover has no bay slot of its own and holds its place inside the dock whoever is away: it never takes the slot
  // of one that is out, which that one found held when it came home, and the three deadlocked at the door for minutes
  expect(r.parked, 'polls at which the third rover was parked').toBeGreaterThan(20);
  expect(r.moved, 'polls at which the third rover\'s spot left the dock').toBe(0);
  expect(r.maxWaited, 'longest a unit waited on another, s').toBeLessThan(60);
});
