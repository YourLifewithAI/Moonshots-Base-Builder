/** Fleet control (core/fleet.ts, core/haul.ts): construction rovers as sim
 *  units — auto one per site, Summon / Release / Send to… pins, the n^0.85
 *  crew rate, surveys that never borrow a pinned rover — and the Regolith
 *  Excavator as a hauling digger: credited on unload, the feed grade from
 *  deliveries, distance as the trade-off, Dig at… and Return home, saves
 *  and old-save migration. The two robotics capability techs. */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

const URL_DEBUG = '/?debug&seed=42&nolock&lowfx';
const RATE_EXP = 0.85;

async function start(page: Page, site = 'mare', exp: 'human' | 'robotic' = 'human', style = '') {
  await page.goto(`${URL_DEBUG}&site=${site}${exp === 'robotic' ? '&exp=robotic' : ''}${style ? `&style=${style}` : ''}`);
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
  await page.evaluate(HELPERS);
}

const hasAlert = (s: any, re: RegExp) => s.alerts.some((a: any) => re.test(a.text));

/** The first world point whose screen position is on the canvas itself (in
 *  view, not under a HUD panel) — clicks land there in either render style
 *  (Classic's isometric camera, High detail's orbit). */
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
const HELPERS = `(() => {
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

// picking and targeting under both cameras: Classic's isometric one (the
// default) and High detail's orbit
for (const style of ['classic', 'detailed']) test(`${style}: select a rover in the world, Send to…, click a site: it is pinned there`, async ({ page }) => {
  await start(page, 'mare', 'human', style);
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

test('a survey never borrows a pinned rover', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('prospectingRovers');
    g.grantResources({ oxygen: 300, water: 100, parts: 50 });
    g.placeBuilding('habitat', 132, 126);
    g.finishRoads(); // its road open: welding, not sintering (docs/15)
    g.advanceGameSeconds(1);
    const hab = byType('habitat').id;
    g.summonRover(hab); // both rovers pinned to the habitat
    g.advanceGameSeconds(1);
    g.grantPower(1000);
    g.surveyProspect('tranqPit');
    g.advanceGameSeconds(0);
    const refused = g.getState();
    g.releaseRover(hab);
    g.advanceGameSeconds(1);
    const released = g.getState();
    g.surveyProspect('tranqPit');
    g.advanceGameSeconds(1);
    return { hab, refused, released, s: g.getState() };
  });
  expect(r.refused.survey.active).toBeNull();
  expect(hasAlert(r.refused, /^SURVEY NEEDS A FREE ROVER — every rover is pinned to a site; release one$/)).toBe(true);
  const pinned = r.released.rovers.find((x: any) => x.pinned);
  expect(pinned.site).toBe(r.hab);
  expect(r.s.survey.active.rover).toBeDefined();
  expect(r.s.survey.active.rover).not.toBe(pinned.id);
  // the pinned one keeps welding; the fleet shows one lent
  expect(r.s.rovers.find((x: any) => x.id === pinned.id)).toMatchObject({ site: r.hab, pinned: true });
  expect(r.s.bots.total).toBe(1);
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

// ───────────────────────────── the hauling excavator ─────────────────────────────

/** An excavator on the mare near the Lander, built; returns its id. */
async function excavator(page: Page, at: [number, number] = [-26, -2]) {
  return page.evaluate(([x, z]) => {
    const g = window.__game!;
    g.placeBuilding('solar', 132, 126);
    const c = near('excavator', x, z, (cx, cz) => g.depositAt(cx, cz) === null)!;
    g.placeBuilding('excavator', c.gx, c.gz);
    g.finishConstruction();
    return byType('excavator').id;
  }, at);
}

test('a load is credited only on unload: dig, haul, unload, back', async ({ page }) => {
  await start(page);
  const id = await excavator(page);
  const r = await page.evaluate((id) => {
    const g = window.__game!;
    const trace: { t: number; reg: number; made: number; phase: string; cargo: number }[] = [];
    for (let i = 0; i < 170; i++) {
      g.grantPower(100);
      g.advanceGameSeconds(1);
      const s = g.getState();
      const b = s.buildings.find((x: any) => x.id === id);
      trace.push({ t: s.simTime, reg: s.resources.regolith, made: s.stats.produced.regolith, phase: b.haul.phase, cargo: b.haul.cargo.regolith ?? 0 });
    }
    return { trace, fleet: g.getFleet().hauls[id] };
  }, id);
  const jumps = r.trace.filter((x, i) => i > 0 && x.reg > r.trace[i - 1].reg + 1e-9);
  expect(jumps.length).toBeGreaterThanOrEqual(2);
  // every rise of the stock is a whole bucket, on the tick the unload ends
  for (const j of jumps) {
    const i = r.trace.indexOf(j);
    expect(j.reg - r.trace[i - 1].reg).toBeCloseTo(105 * 1.25, 6); // the mare's ISRU ×1.25
    expect(j.made - r.trace[i - 1].made).toBeCloseTo(105 * 1.25, 6);
    expect(r.trace[i - 1].phase).toBe('unload');
    expect(j.phase).toBe('toDig');
  }
  // the phases in order, and nothing credited while digging or driving
  const phases = r.trace.map((x) => x.phase).filter((p, i, a) => i === 0 || p !== a[i - 1]);
  expect(phases.slice(0, 5)).toEqual(['dig', 'toDrop', 'unload', 'toDig', 'dig']);
  const between = r.trace.slice(jumps.length ? r.trace.indexOf(jumps[0]) : 0, r.trace.indexOf(jumps[1]));
  expect(new Set(between.map((x) => x.reg)).size).toBe(1);
  expect(r.fleet.dropName).toMatch(/^Lander #1$/); // no smelter yet: it tips at the Lander
});

test('the feed grade follows what is delivered, weighted by amount', async ({ page }) => {
  await start(page);
  const id = await excavator(page);
  const r = await page.evaluate((id) => {
    const g = window.__game!;
    drained(150);
    const plain = g.getState().feed;
    const dep = g.getDeposits().find((d: any) => d.kind === 'ilmenite' && d.revealed);
    g.digAt(id, dep.x, dep.z);
    g.advanceGameSeconds(0);
    const set = g.getState();
    const shares: number[] = [];
    let last = -1;
    for (let i = 0; i < 700; i++) {
      drained(1);
      const f = g.getState().feed.ilmenite;
      if (f !== last) { shares.push(f); last = f; }
    }
    g.select(g.getState().buildings.find((b: any) => b.type === 'excavator').id);
    return { plain, set, shares, dep, feed: g.getState().feed };
  }, id);
  expect(r.plain.plain).toBeCloseTo(1, 9);
  expect(r.set.buildings.find((b: any) => b.id === id).deposit).toBe('ilmenite');
  expect(hasAlert(r.set, /^DIG SITE SET — Regolith Excavator #\d+ digs high-Ti basalt \d+ m from its pad$/)).toBe(true);
  // the first ilmenite load moves it a third of the way (131 / (131 + 210)); each
  // next load closes the gap; plain ground fades
  const first = (105 * 1.25) / (105 * 1.25 + 210);
  expect(r.shares[1]).toBeCloseTo(first, 6);
  for (let i = 2; i < r.shares.length; i++) expect(r.shares[i]).toBeGreaterThan(r.shares[i - 1]);
  expect(r.feed.ilmenite).toBeGreaterThan(0.6);
  expect(r.feed.ilmenite + r.feed.plain).toBeCloseTo(1, 9);
  await expect(page.locator('#inspector')).toContainText('Digs high-Ti basalt');
  await expect(page.locator('#insp-haul-line')).toBeVisible();
});

test('distance is the trade-off: a haul delivers by its road route (15 m: today\'s rate), far ground less', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('regolithProcessing');
    g.completeTech('prospectingRovers'); // the 320 m survey: far ground in range
    g.grantResources({ metals: 200, parts: 60 });
    for (const [x, z] of [[132, 126], [132, 130], [136, 126]]) g.placeBuilding('solar', x, z);
    const sm = near('smelter', -2, 22, undefined, 3, 2)!;
    g.placeBuilding('smelter', sm.gx, sm.gz);
    const ex = near('excavator', -30, 20, (cx, cz) => g.depositAt(cx, cz) === null)!;
    g.placeBuilding('excavator', ex.gx, ex.gz);
    g.finishConstruction();
    const id = byType('excavator').id;
    const smelter = byType('smelter');
    // the smelter's west wall, 30 m of haul road from it (open ground, north of the pad)
    const measure = (x: number, z: number) => {
      g.digAt(id, x, z);
      g.advanceGameSeconds(0);
      g.finishRoads(); // its haul road open at once (docs/15)
      drained(200); // settle into the new route
      // whole cycles: from one unload to the sixth after it
      const made = () => g.getState().stats.produced.regolith;
      const next = () => { const m = made(); for (let i = 0; i < 600 && made() === m; i++) drained(1); };
      next();
      const m0 = made(), t0 = g.getState().simTime;
      for (let k = 0; k < 6; k++) next();
      const s = g.getState();
      return { rate: (s.stats.produced.regolith - m0) / (s.simTime - t0), route: g.getFleet().hauls[id].routeM,
        drop: g.getFleet().hauls[id].dropName };
    };
    const sx = smelter.gx * 4 - 512; // the smelter's west wall
    const sz = (smelter.gz + 1) * 4 - 512;
    const at30 = measure(sx - 4.5 - 30, sz);
    const far = measure(sx - 4.5 - 150, sz);
    return { at30, far, smelter: smelter.id };
  });
  const old = 1.5 * 1.25; // the static excavator's nameplate × the mare's ISRU
  // on roads the route is at least the straight way, and the rate follows the
  // route: a 60 s dig, 4 s unload, 5 m/s each way (15 m of road: today's rate)
  const byRoute = (m: number) => old * (60 + 4 + 2 * 15 / 5) / (60 + 4 + 2 * m / 5);
  expect(r.at30.drop).toBe(`Regolith Smelter #${r.smelter}`);
  expect(r.at30.route).toBeGreaterThan(27);
  expect(r.at30.rate / byRoute(r.at30.route)).toBeGreaterThan(0.9);
  expect(r.at30.rate / byRoute(r.at30.route)).toBeLessThan(1.1);
  expect(r.far.route).toBeGreaterThan(140);
  expect(r.far.rate / old).toBeLessThan(0.7);
});

for (const style of ['classic', 'detailed']) test(`${style}: Dig at… refuses unmapped ground with its reason, and Return home digs the pad again`, async ({ page }) => {
  await start(page, 'mare', 'human', style);
  const id = await excavator(page);
  // a wide view west of the base: 190 m out and the mapped ground both in it
  await page.evaluate(() => window.__game.setView({ x: 220, y: 260, z: 250 }, { x: -60, y: 0, z: 20 }));
  await page.evaluate((id) => window.__game.select(id), id);
  await page.locator('#insp-digat').click();
  await expect(page.locator('#fleet-hint')).toContainText('DIG AT…');
  // 190 m west: past the 120 m landing-site survey (and clear of the inspector on the right)
  const far = await onCanvas(page, [[-190, -2], [-190, 30], [-185, 50], [-200, 20], [-180, -30]]);
  await page.mouse.move(far.x, far.y);
  await expect(page.locator('#fleet-hint')).toContainText('UNMAPPED GROUND');
  await page.mouse.click(far.x, far.y);
  await expect(page.locator('#fleet-hint')).toHaveAttribute('data-flash', /\d+/);
  // mapped ground 60 m out: the estimate, then the click takes it
  const ok = await onCanvas(page, [[-2, 60], [-20, 60], [-40, 50], [-30, 70]]);
  await page.mouse.move(ok.x, ok.y);
  await expect(page.locator('#fleet-hint')).toContainText(/plain regolith · \d+ m · ≈\d+▲\/min \(now \d+▲\/min\) · plain feed/);
  await page.mouse.click(ok.x, ok.y);
  await expect(page.locator('#fleet-hint')).toBeHidden();
  const set = await page.evaluate((id) => { window.__game.advanceGameSeconds(1); return window.__game.getState().buildings.find((b: any) => b.id === id); }, id);
  expect(Math.hypot(set.haul.digX - ok.wx, set.haul.digZ - ok.wz)).toBeLessThan(6);
  // the action refuses the same way, and names the reason
  const refused = await page.evaluate((id) => {
    const g = window.__game!;
    g.digAt(id, 260, 260);
    g.advanceGameSeconds(0);
    return g.getState();
  }, id);
  expect(hasAlert(refused, /^CANNOT DIG THERE — UNMAPPED GROUND — the survey maps 120 m around the Lander/)).toBe(true);
  expect(refused.buildings.find((b: any) => b.id === id).haul.digX).toBe(set.haul.digX);
  // Return home: the pad again, and the digger drives back to it
  await expect(page.locator('#insp-dighome')).toBeVisible();
  await page.locator('#insp-dighome').click();
  const home = await page.evaluate((id) => {
    const g = window.__game!;
    g.advanceGameSeconds(0);
    const b0 = g.getState().buildings.find((b: any) => b.id === id);
    for (let i = 0; i < 300; i++) { g.grantPower(100); g.advanceGameSeconds(1); }
    return { b0, b: g.getState().buildings.find((b: any) => b.id === id) };
  }, id);
  const padX = (home.b0.gx + 1) * 4 - 512, padZ = (home.b0.gz + 1) * 4 - 512;
  expect(home.b0.haul.digX).toBeCloseTo(padX, 6);
  expect(home.b0.haul.digZ).toBeCloseTo(padZ, 6);
  expect(home.b0.deposit).toBeUndefined();
  await expect(page.locator('#insp-dighome')).toHaveCount(0);
  // after a trip it digs its own pad
  const digging = home.b.haul.phase === 'dig' ? home.b : null;
  if (digging) expect(Math.hypot(digging.haul.x - padX, digging.haul.z - padZ)).toBeLessThan(0.01);
});

test('saves keep the dig site and the cycle mid-haul; an old excavator digs its own pad', async ({ page }) => {
  test.setTimeout(240_000); // four page loads
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await start(page);
  const id = await excavator(page);
  const before = await page.evaluate((id) => {
    const g = window.__game!;
    g.digAt(id, -2, 60);
    g.advanceGameSeconds(0);
    g.finishRoads(); // its haul road open at once (docs/15)
    const h = () => g.getState().buildings.find((b: any) => b.id === id).haul;
    const tick = () => { g.grantPower(100); g.advanceGameSeconds(1); };
    // the bucket it had started goes home first; then a whole one at the new dig
    for (let i = 0; i < 200 && !(h().phase === 'dig' && Math.hypot(h().x + 2, h().z - 60) < 0.5); i++) tick();
    // into the haul: bucket full, on the road
    for (let i = 0; i < 200 && h().phase !== 'toDrop'; i++) tick();
    g.grantPower(100);
    g.advanceGameSeconds(2);
    return g.getState();
  }, id);
  const h0 = before.buildings.find((b: any) => b.id === id).haul;
  expect(h0.phase).toBe('toDrop');
  expect(h0.cargo.regolith).toBeGreaterThan(100);
  await putSave(page, before);
  const after = await page.evaluate((id) => window.__game.getState().buildings.find((b: any) => b.id === id), id);
  expect(after.haul).toEqual(h0);
  expect(after.deposit).toBe(before.buildings.find((b: any) => b.id === id).deposit);
  // and it carries on: the load lands
  const landed = await page.evaluate(() => {
    const g = window.__game!;
    g.setPaused(true);
    const r0 = g.getState().stats.produced.regolith;
    for (let i = 0; i < 90 && g.getState().stats.produced.regolith === r0; i++) {
      g.grantPower(100);
      const reg = g.getState().resources.regolith; // room for it: the longer road trips fill the store first
      if (reg > 0) g.grantResources({ regolith: -reg });
      g.advanceGameSeconds(1);
    }
    return g.getState().stats.produced.regolith - r0;
  });
  expect(landed).toBeCloseTo(h0.cargo.regolith, 6);

  // a save from before the haul: the excavator digs its own pad, as it did
  const legacy = JSON.parse(JSON.stringify(before));
  const ex = legacy.buildings.find((b: any) => b.id === id);
  delete ex.haul;
  delete ex.deposit;
  await putSave(page, legacy);
  const migrated = await page.evaluate((id) => window.__game.getState().buildings.find((b: any) => b.id === id), id);
  const padX = (migrated.gx + 1) * 4 - 512, padZ = (migrated.gz + 1) * 4 - 512;
  expect(migrated.haul).toMatchObject({ digX: padX, digZ: padZ, phase: 'dig', x: padX, z: padZ, t: 0, drop: null });
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
      g.completeTech('dynamicClocking'); // the excavator's clock toggle too: its tallest foot
      g.completeTech('prospectingRovers');
      g.grantResources({ metals: 300, parts: 100, chips: 1, foils: 1, launch: 1, oxygen: -110, water: -45 });
      const ex = near('excavator', -24, -2)!;
      g.placeBuilding('excavator', ex.gx, ex.gz);
      g.finishConstruction();
      // three sites for two rovers: one queued, and a crew of two on the first
      const s1 = near('solar', 20, -2)!; g.placeBuilding('solar', s1.gx, s1.gz);
      const s2 = near('solar', 20, 14)!; g.placeBuilding('solar', s2.gx, s2.gz);
      const s3 = near('solar', 20, 30)!; g.placeBuilding('solar', s3.gx, s3.gz);
      g.advanceGameSeconds(1);
      const sites = g.getState().buildings.filter((b: any) => b.construction > 0).map((b: any) => b.id);
      g.summonRover(sites[0]);
      const exId = byType('excavator').id;
      g.digAt(exId, -2, 50); // away from its pad: Return home shows
      g.advanceGameSeconds(3);
      return { sites, ex: exId, rover: g.getState().rovers.find((r: any) => r.pinned).id };
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
    // the excavator away from its pad: priority, clock, Dig at…, Return home, Shut down, Demolish
    await page.evaluate((id) => window.__game.select(id), ids.ex);
    await expect(page.locator('#insp-dighome')).toBeVisible();
    await expect(page.locator('#insp-oc-on')).toBeVisible();
    // what it is doing reads in the head, which never scrolls
    await expect(page.locator('#insp-status')).toContainText(/^(DIGGING|HAULING|UNLOADING|RETURNING)/);
    await inView('#inspector', 11);
    await page.screenshot({ path: `test-results/fleet-inspector-${vp.width}x${vp.height}.png` });
    // the rover inspector: Send to…, Release to auto, Dock, close
    await page.evaluate((id) => window.__game.selectRover(id), ids.rover);
    await expect(page.locator('#rover-inspector #rv-unpin')).toBeVisible();
    await inView('#rover-inspector', 4);
  });
}

// ───────────────────────────── with the render styles ─────────────────────────────

test('classic: the digger out on its haul wears the pad\'s upgrades and lights; its pad loses decal and pool', async ({ page }) => {
  await start(page); // Classic is the default style
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ metals: 400, parts: 200 });
    g.completeTech('grizzlyScreens');
    g.completeTech('autonomousHaulage');
    for (const [x, z] of [[132, 126], [132, 130]]) g.placeBuilding('solar', x, z);
    const c = near('excavator', -26, -2, (cx, cz) => g.depositAt(cx, cz) === null)!;
    g.placeBuilding('excavator', c.gx, c.gz);
    g.finishConstruction();
    const id = byType('excavator').id;
    // at night, so the base's pools are lit: first home, digging its own pad
    // (between loads it hauls to the Lander, the only consumer here; the
    // store is emptied so it never waits there for room)…
    drained(640 - g.getState().simTime);
    const h = () => byType('excavator').haul;
    const padX = (byType('excavator').gx + 1) * 4 - 512, padZ = (byType('excavator').gz + 1) * 4 - 512;
    for (let i = 0; i < 200 && !(h().phase === 'dig' && Math.hypot(h().x - padX, h().z - padZ) < 0.01 && h().t > 2); i++) {
      drained(1);
    }
    g.setPaused(false); // a second of live frames: it squares up on its pad
    for (let i = 0; i < 20; i++) g.stepFrame(0.05);
    g.setPaused(true);
    g.stepFrame(0.05);
    const home = { up: g.getUpgrades(), life: g.getRenderInfo().life.haulers };
    // …then under way to a dig 50 m north: its lamps follow the excavator's own darkness
    g.digAt(id, -2, 50);
    g.grantPower(20000);
    g.advanceGameSeconds(2);
    for (let i = 0; i < 6; i++) g.stepFrame(0.05);
    return { id, home, away: { up: g.getUpgrades(), life: g.getRenderInfo().life.haulers } };
  });
  const pad = r.away.up.meshes.excavator;
  // the same upgraded recipe on the pad and on the road
  expect(pad.key).toBe('grizzlyScreens,autonomousHaulage');
  expect(r.away.life.key).toBe(pad.key);
  expect(r.away.life.triangles).toBe(pad.triangles);
  // away: drawn by the haulers, its pad leaves no decal and no pool behind
  expect(r.home.life.away).toEqual([]);
  expect(r.away.life.away).toEqual([r.id]);
  expect(r.away.up.decals).toBe(r.home.up.decals - 1);
  expect(r.home.up.pools).toBeGreaterThan(0);
  expect(r.away.up.pools).toBeLessThan(r.home.up.pools);
  // the lit channel 2 + k at the excavator's own darkness
  expect(r.away.life.dark[0]).toBeGreaterThan(0.5); // night
  expect(r.away.life.lit[0]).toBeCloseTo(2 + r.away.life.dark[0], 3);
});
