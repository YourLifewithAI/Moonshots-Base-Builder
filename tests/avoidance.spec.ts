/** Ground traffic (world/traffic.ts, core/spots.ts, core/paths.ts): rovers
 *  and excavators never drive through each other or through a structure
 *  that is not their own pad; parking and work spots never share ground;
 *  paths find their way through a dense cluster; the excavator's visual
 *  keeps up with the sim that credits its loads. And the early smelter
 *  trap: the palette warns before a placement that would leave too few
 *  metals for the first Regolith Smelter, and METALS LOW names the research
 *  while the smelter is still locked. */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

const URL_DEBUG = '/?debug&seed=42&nolock&lowfx';
/** tolerance on "never closer than the radii sum", m */
const TOL = 0.05;

async function start(page: Page, opts: { site?: string; exp?: 'human' | 'robotic'; style?: string } = {}) {
  const { site = 'mare', exp = 'robotic', style = '' } = opts;
  await page.goto(`${URL_DEBUG}&site=${site}${exp === 'robotic' ? '&exp=robotic' : ''}${style ? `&style=${style}` : ''}`);
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
  await page.evaluate(HELPERS);
}

/** In-page helpers. drive(frames, watch) runs live frames at 10× (one game
 *  second each), topping up power and emptying the regolith store, and
 *  records every frame: the closest pair of units (distance − radii sum),
 *  any unit whose origin or body centre stands inside a structure other than
 *  its own pad, and how far the excavators trail the sim. `watch(i)` may
 *  return true to stop early. */
declare function drive(frames: number, watch?: (i: number) => boolean | void): {
  frames: number; worst: number; pair: string; inside: string[]; lagMaxS: number; units: any[];
};
declare function rects(): { id: number; x0: number; z0: number; x1: number; z1: number }[];
declare function roverAt(id: number): any;
const HELPERS = `(() => {
const FP = {};
window.rects = () => {
  const g = window.__game;
  return g.getState().buildings.map((b) => {
    const fp = g.footprintOf(b.id);
    return { id: b.id, ...fp };
  });
};
window.roverAt = (id) => {
  const r = window.__game.getRenderInfo().life.rovers;
  const i = r.ids.indexOf(id);
  return i < 0 ? null : { pos: r.positions[i], spot: r.spots[i], legs: r.legs[i], site: r.sites[i] };
};
window.drive = (frames, watch) => {
  const g = window.__game;
  g.setPaused(false);
  g.setSpeed(10);
  g.stepFrame(0);
  g.getRenderInfo(); // clears the closest-pair record
  let worst = Infinity, pair = '', lagMaxS = 0, i = 0, units = [];
  const inside = [];
  for (; i < frames; i++) {
    if (i % 10 === 0) {
      g.grantPower(50000);
      const reg = g.getState().resources.regolith;
      if (reg > 0) g.grantResources({ regolith: -reg });
    }
    g.stepFrame(0.1);
    const life = g.getRenderInfo().life;
    const c = life.traffic.closest;
    if (c && c.gap < worst) { worst = c.gap; pair = c.a + '/' + c.b + ' @' + i; }
    lagMaxS = Math.max(lagMaxS, life.haulers.lagMaxS);
    units = life.traffic.units;
    const rs = window.rects();
    for (const u of units) {
      for (const r of rs) {
        if (r.id === u.home) continue;
        for (const [x, z] of [[u.x, u.z], [u.cx, u.cz]]) {
          if (x > r.x0 + 0.01 && x < r.x1 - 0.01 && z > r.z0 + 0.01 && z < r.z1 - 0.01) {
            inside.push(u.kind + '#' + u.id + ' in ' + r.id + ' @' + i);
          }
        }
      }
    }
    if (watch && watch(i)) { i++; break; }
  }
  g.setPaused(true);
  g.stepFrame(0);
  return { frames: i, worst, pair, inside: inside.slice(0, 10), lagMaxS, units };
};
})()`;

// ───────────────────────────── one crowded dock ─────────────────────────────

for (const style of ['classic', 'detailed']) {
  test(`${style}: rovers and excavators at one dock never share ground`, async ({ page }) => {
    test.setTimeout(240_000);
    await start(page, { style: style === 'classic' ? '' : style });
    const setup = await page.evaluate(() => {
      const g = window.__game!;
      g.completeTech('constructionRobotics');
      g.completeTech('swarmRobotics');
      g.grantResources({ metals: 3000, parts: 3000 });
      // the Lander is cells 126–128: two Robotics Bays against it, two
      // excavators hauling to it (no smelter: the Lander takes the loads)
      const ok = [
        g.placeBuilding('roboticsBay', 126, 129), g.placeBuilding('roboticsBay', 129, 126),
        g.placeBuilding('excavator', 124, 126), g.placeBuilding('excavator', 124, 129),
        g.placeBuilding('solar', 131, 129), g.placeBuilding('solar', 133, 129),
      ];
      g.finishConstruction();
      return { ok, rovers: g.getState().rovers.length };
    });
    expect(setup.ok.every(Boolean)).toBe(true);
    expect(setup.rovers).toBe(8); // the Lander's 2, three per Bay

    // parked (the pads went down where the Lander's pair stood: they drive
    // clear first): every spot apart, none on a footprint
    await page.evaluate(() => drive(30));
    const parked = await page.evaluate(() => drive(30));
    const spots = await page.evaluate(() => window.__game.getRenderInfo().life.rovers.spots);
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        expect(Math.hypot(spots[i][0] - spots[j][0], spots[i][1] - spots[j][1])).toBeGreaterThanOrEqual(2 * 1.3);
      }
    }
    expect(parked.inside).toEqual([]);

    // a working day at the dock: four sites round it, a crew of three on one
    const sites = await page.evaluate(() => {
      const g = window.__game!;
      for (const [t, x, z] of [['lab', 122, 122], ['lab', 131, 122], ['storageYard', 121, 132], ['lab', 128, 133]] as const) {
        g.placeBuilding(t, x, z);
      }
      g.advanceGameSeconds(0);
      const ids = g.getState().buildings.filter((b: any) => b.construction > 0).map((b: any) => b.id);
      g.summonRover(ids[0]);
      g.summonRover(ids[0]);
      return ids;
    });
    expect(sites).toHaveLength(4);
    const r = await page.evaluate(() => drive(420));
    expect(r.worst, `closest pair ${r.pair}`).toBeGreaterThan(-TOL);
    expect(r.inside).toEqual([]);
    // the diggers hauled all the while, their visuals close behind the sim
    const s = await page.evaluate(() => window.__game.getState());
    expect(s.stats.produced.regolith).toBeGreaterThan(0);
    expect(r.lagMaxS).toBeLessThan(6);
    // everything built, everyone home: parked apart again
    expect(s.buildings.filter((b: any) => b.construction > 0)).toHaveLength(0);
    const end = await page.evaluate(() => window.__game.getRenderInfo().life.rovers);
    expect(end.legs.every((n: number) => n === 0)).toBe(true);
  });
}

// ───────────────────────────── crossing ─────────────────────────────

test('two rovers on opposing routes pass without touching, and both arrive', async ({ page }) => {
  test.setTimeout(180_000);
  await start(page);
  const ids = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('constructionRobotics');
    g.grantResources({ metals: 3000, parts: 3000 });
    // a Bay 40 m east of the Lander; a lab site out past each end
    g.placeBuilding('roboticsBay', 136, 126);
    g.finishConstruction();
    g.placeBuilding('lab', 116, 126);  // west of the Lander
    g.placeBuilding('lab', 141, 126);  // east of the Bay
    g.advanceGameSeconds(0);
    const st = g.getState();
    const bay = st.buildings.find((b: any) => b.type === 'roboticsBay').id;
    const lander = st.buildings.find((b: any) => b.type === 'lander').id;
    const [west, east] = st.buildings.filter((b: any) => b.construction > 0).map((b: any) => b.id);
    // a Lander rover sent east, a Bay rover sent west: head to head past the Lander
    const a = st.rovers.find((r: any) => r.home === lander).id;
    const b = st.rovers.find((r: any) => r.home === bay).id;
    g.sendRover(a, east);
    g.sendRover(b, west);
    // no weld parts: the sites wait with their crews, so both stay out
    g.grantResources({ parts: -g.getState().resources.parts });
    g.advanceGameSeconds(0);
    return { a, b, west, east };
  });
  let passed = false;
  const r = await page.evaluate(({ a, b }) => {
    let ax0: number | null = null;
    let swapped = false, closest = Infinity;
    const out = drive(160, () => {
      const pa = roverAt(a), pb = roverAt(b);
      if (ax0 === null) ax0 = Math.sign(pb.pos[0] - pa.pos[0]);
      if (Math.sign(pb.pos[0] - pa.pos[0]) !== ax0) swapped = true;
      closest = Math.min(closest, Math.hypot(pa.pos[0] - pb.pos[0], pa.pos[1] - pb.pos[1]));
      return swapped && pa.legs === 0 && pb.legs === 0;
    });
    const fleet = window.__game.getRenderInfo().life.rovers;
    return { ...out, swapped, closest, a: roverAt(a), b: roverAt(b), working: fleet.working };
  }, ids);
  passed = r.swapped;
  expect(passed, 'they crossed').toBe(true);
  expect(r.closest).toBeGreaterThanOrEqual(2 * 1.3 - TOL);
  expect(r.worst, `closest pair ${r.pair}`).toBeGreaterThan(-TOL);
  expect(r.inside).toEqual([]);
  // both at their sites' walls, printing
  expect(r.a.site).toBe(ids.east);
  expect(r.b.site).toBe(ids.west);
  expect(r.a.legs).toBe(0);
  expect(r.b.legs).toBe(0);
  expect(Math.hypot(r.a.pos[0] - r.a.spot[0], r.a.pos[1] - r.a.spot[1])).toBeLessThan(0.6);
  expect(Math.hypot(r.b.pos[0] - r.b.spot[0], r.b.pos[1] - r.b.spot[1])).toBeLessThan(0.6);
});

// ───────────────────────────── a dense cluster ─────────────────────────────

test('through a dense cluster: a rover and an excavator find the way, never entering a foreign footprint', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page);
  const setup = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('regolithProcessing');
    g.grantResources({ metals: 5000, parts: 5000 });
    // a comb of arrays and yards east of the Lander, gaps between them that
    // are too narrow for a digger and a dead-end pocket in the middle
    const cells: [string, number, number][] = [];
    for (const gz of [116, 119, 122, 125, 128, 131, 134]) cells.push(['solar', 130, gz]);
    for (const gz of [117, 121, 125, 129, 133]) cells.push(['storageYard', 133, gz]);
    for (const gz of [116, 119, 122, 128, 131, 134]) cells.push(['solar', 136, gz]);
    const ok = cells.map(([t, x, z]) => g.placeBuilding(t, x, z));
    // beyond it a smelter; the excavator digs on the Lander's side
    const sm = g.placeBuilding('smelter', 139, 125);
    const ex = g.placeBuilding('excavator', 126, 131);
    g.finishConstruction();
    const st = g.getState();
    return { ok: ok.filter(Boolean).length, sm, ex, exId: st.buildings.find((b: any) => b.type === 'excavator').id };
  });
  expect(setup.ok).toBe(18);
  expect(setup.sm && setup.ex).toBe(true);

  // the sim's haul route: round the comb, never through a structure
  const route = await page.evaluate((id) => {
    const g = window.__game!;
    for (let i = 0; i < 90; i++) { g.grantPower(1000); g.advanceGameSeconds(1); if (g.getState().buildings.find((b: any) => b.id === id).haul.phase === 'toDrop') break; }
    const b = g.getState().buildings.find((x: any) => x.id === id);
    return { route: b.haul.route, drop: b.haul.drop, rects: rects() };
  }, setup.exId);
  expect(route.route.length).toBeGreaterThan(2); // not a straight line: it goes round
  for (let i = 1; i < route.route.length; i++) {
    const [ax, az] = route.route[i - 1], [bx, bz] = route.route[i];
    for (const r of route.rects) {
      if (r.id === setup.exId || r.id === route.drop && i === route.route.length) continue;
      // sample the leg: every point keeps 2 m off every other footprint
      for (let k = 0; k <= 20; k++) {
        const x = ax + (bx - ax) * k / 20, z = az + (bz - az) * k / 20;
        const inside = x > r.x0 - 2 && x < r.x1 + 2 && z > r.z0 - 2 && z < r.z1 + 2;
        expect(inside, `leg ${i} point ${k} by #${r.id}`).toBe(false);
      }
    }
  }

  // live: a rover sent to a lab behind the comb reaches its wall (no weld
  // parts: the site waits for it), the digger hauls round to its smelter;
  // nobody stands in a structure that is not its own on the way
  const rover = await page.evaluate(() => {
    const g = window.__game!;
    g.placeBuilding('lab', 139, 121);
    g.advanceGameSeconds(1);
    g.grantResources({ parts: -g.getState().resources.parts });
    g.advanceGameSeconds(0);
    return g.getState().rovers.find((r: any) => r.site !== null)?.id;
  });
  expect(rover).toBeDefined();
  const produced0 = await page.evaluate(() => window.__game.getState().stats.produced.regolith);
  const r = await page.evaluate(({ rover, produced0 }) => drive(200, () => {
    const p = roverAt(rover);
    const g = window.__game;
    return p && p.legs === 0 && p.site !== null && Math.hypot(p.pos[0] - p.spot[0], p.pos[1] - p.spot[1]) < 0.6 &&
      g.getState().stats.produced.regolith > produced0;
  }), { rover, produced0 });
  expect(r.inside).toEqual([]);
  expect(r.worst, `closest pair ${r.pair}`).toBeGreaterThan(-TOL);
  expect(r.frames, 'arrived before the time ran out').toBeLessThan(200);
  expect(r.lagMaxS).toBeLessThan(6);
});

// ───────────────────────────── the early smelter trap ─────────────────────────────

test('the palette warns before a placement that would leave too few metals for the first smelter', async ({ page }) => {
  await start(page, { exp: 'human' });
  // 140 metals at landing: a Solar Array (12) is fine, a Habitat Module (80) is not
  const solar = await page.evaluate(() => window.__game.canPlace('solar', 132, 126));
  expect(solar.valid).toBe(true);
  expect(solar.warn ?? '').toBe('');
  const hab = await page.evaluate(() => window.__game.canPlace('habitat', 132, 126));
  expect(hab.valid).toBe(true);
  expect(hab.warn).toMatch(/keep \d+◆ for your first Regolith Smelter/);
  // the card says so before it is picked up
  await page.locator('#palette .cats button', { hasText: /life/i }).click();
  const card = page.locator('#palette .bld-btn[data-type="habitat"]');
  await expect(card).toHaveClass(/strands/);
  await card.hover();
  await expect(page.locator('#tooltip')).toContainText(/keep \d+◆ for your first Regolith Smelter/);
  // placing it asks once: the first click on the spot warns, the second places
  await page.evaluate(() => window.__game.beginPlacement('habitat'));
  await expect(page.locator('#place-hint .caution')).toContainText(/keep \d+◆ for your first Regolith Smelter/);
});

test('METALS LOW names the research while the smelter is still locked, and the smelter once it is not', async ({ page }) => {
  await start(page, { exp: 'human' });
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.placeBuilding('solar', 132, 126);
    g.placeBuilding('habitat', 132, 130);
    g.advanceGameSeconds(0);
    const locked = g.getState().alerts.map((a: any) => a.text);
    g.completeTech('regolithProcessing');
    g.placeBuilding('solar', 134, 126);
    g.advanceGameSeconds(0);
    const open = g.getState().alerts.map((a: any) => a.text);
    return { locked, open };
  });
  expect(r.locked.some((t: string) => /^METALS LOW — research Regolith Smelting, then build a smelter \(\d+◆\)/.test(t))).toBe(true);
  expect(r.open.some((t: string) => /^METALS LOW — a Regolith Smelter costs \d+◆/.test(t))).toBe(true);
});
