/** Roads and the ground traffic on them (docs/15-roads.md; core/roads.ts,
 *  core/spots.ts, world/traffic.ts): a placement lays its road first and the
 *  rovers sinter it before they weld; a field of arrays needs no road
 *  between its arrays; the road tool lays and removes roads; a hub unit
 *  hauls on roads (off-road only inside an extraction zone, zones.spec), its
 *  trip timed by the road and its tier; an old save gets roads; and the
 *  rovers and hub units on the roads never share ground, never leave it, and
 *  never lock up (a hub unit is a free driver, docs/19 S4b: a rover in its way
 *  makes way, the sim keeps units apart). And the early smelter trap: the
 *  palette warns before a placement that would leave too few metals for the
 *  first Regolith Smelter (available from landing), and METALS LOW names it. */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

const URL_DEBUG = '/?debug&seed=42';
/** tolerance on "bodies never overlap", m */
const TOL = 0.05;

async function start(page: Page, opts: { site?: string; exp?: 'human' | 'robotic' } = {}) {
  const { site = 'mare', exp = 'robotic' } = opts;
  await page.goto(`${URL_DEBUG}&site=${site}${exp === 'robotic' ? '&exp=robotic' : ''}`);
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
  await page.evaluate(HELPERS);
}

/** In-page helpers.
 *  - near(type, x, z): place one where it is valid, scanning out from (x, z) m
 *    (every rotation), and return [gx, gz, rot] or null;
 *  - drive(frames, watch): live frames at 10× (a game-second each), power
 *    topped up and the regolith store emptied, recording the closest pair of
 *    bodies not counting a hub unit (`worst`: rover to rover, and any legacy
 *    pad digger — the sim keeps hub units apart itself, S4a, so the picture
 *    owes them origins at least `unitOrigin` apart, not boxes clear: two
 *    pictures lag by different amounts, docs/19 S4b), any unit whose origin is
 *    off the open road (a hub unit's own way excepted), how far the hub units
 *    trail the sim, and the traffic's wait-cycle breaks, courtesies and
 *    last-resort rescues. `watch(i)` may return true to stop early. */
declare function near(type: string, x: number, z: number): [number, number, number] | null;
declare function drive(frames: number, watch?: (i: number) => boolean | void, full?: boolean): {
  frames: number; worst: number; pair: string; unitOrigin: number; unitPair: string; offroad: string[]; lagMaxS: number; breaks: number;
  rescues: number; detours: number; courtesies: number;
};
declare function roverAt(id: number): any;
/** a hub just off a deposit's ring, its door toward it: its id; power(n): n Solar Arrays, built */
declare function hubBy(type: string, depId: string, off?: number): number | null;
declare function power(n: number): number;
/** a hub unit's next n loaded legs by day, out from a face away from its hub: game-seconds, and the route's length, m */
declare function hauls(id: number, n: number, each?: (h: any, st: any) => void): { dur: number; len: number }[];
const HELPERS = `(() => {
window.near = (type, x, z) => {
  const g = window.__game;
  const c = { gx: Math.round((x + 512) / 4), gz: Math.round((z + 512) / 4) };
  for (let r = 0; r < 16; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    for (const rot of [0, 1, 2, 3]) {
      if (g.canPlace(type, c.gx + dx, c.gz + dz, rot).valid && g.placeBuilding(type, c.gx + dx, c.gz + dz, rot)) return [c.gx + dx, c.gz + dz, rot];
    }
  }
  return null;
};
window.hauls = (id, n, each) => {
  const g = window.__game;
  const out = [];
  let leg = null;
  for (let t = 0; t < 1500 && out.length < n; t++) {
    g.grantPower(1000);
    const reg = g.getState().resources.regolith;
    if (reg > 0) g.grantResources({ regolith: -reg });
    g.advanceGameSeconds(1);
    const st = g.getState();
    const u = st.haulers.find((x) => x.id === id);
    const h = u.haul;
    const fp = g.footprintOf(u.hub);
    if (h.phase === 'toDrop' && !leg && h.route) {
      const [x0, z0] = h.route[0];
      const away = Math.hypot(x0 - (fp.x0 + fp.x1) / 2, z0 - (fp.z0 + fp.z1) / 2) > 6;
      let len = 0;
      for (let i = 1; i < h.route.length; i++) len += Math.hypot(h.route[i][0] - h.route[i - 1][0], h.route[i][1] - h.route[i - 1][1]);
      // by day only (Guidance Beacons speed night legs further): the 8 min day of a 12 min cycle
      leg = { t0: st.simTime, len, away: away && st.simTime % 720 < 480 - 60 };
      if (each) each(h, st);
    }
    if (leg && h.phase !== 'toDrop') {
      if (leg.away) out.push({ dur: st.simTime - leg.t0, len: leg.len });
      leg = null;
    }
  }
  return out;
};
window.hubBy = (type, depId, off = 0) => {
  const g = window.__game;
  const d = g.getDeposits().find((q) => q.id === depId);
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
window.roverAt = (id) => {
  const r = window.__game.getRenderInfo().life.rovers;
  const i = r.ids.indexOf(id);
  return i < 0 ? null : { pos: r.positions[i], spot: r.spots[i], legs: r.legs[i], site: r.sites[i], inside: r.inside[i] };
};
window.drive = (frames, watch, full) => {
  const g = window.__game;
  g.setPaused(false);
  g.setSpeed(10);
  g.stepFrame(0);
  g.getRenderInfo(); // clears the closest-pair record
  let worst = Infinity, pair = '', unitOrigin = Infinity, unitPair = '', lagMaxS = 0, i = 0, T = null;
  const offroad = [];
  const isUnit = (u) => u.kind === 'digger' && u.id >= 100000; // UNIT_VID + a hub unit's id
  /** the gap between two oriented bodies (negative: overlapping), as core/traffic.ts boxGap */
  const gap = (a, b) => {
    const F = (u) => ({ ...u, fx: Math.sin(u.yaw), fz: Math.cos(u.yaw) });
    const A = F(a), B = F(b);
    const corners = (u) => {
      const rx = u.fz, rz = -u.fx;
      return [[u.front, u.hw], [u.front, -u.hw], [-u.back, -u.hw], [-u.back, u.hw]].map(([l, w]) => [u.x + u.fx * l + rx * w, u.z + u.fz * l + rz * w]);
    };
    const CA = corners(A), CB = corners(B);
    let best = -Infinity;
    for (const [ax, az] of [[A.fx, A.fz], [A.fz, -A.fx], [B.fx, B.fz], [B.fz, -B.fx]]) {
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (const [x, z] of CA) { const p = x * ax + z * az; amin = Math.min(amin, p); amax = Math.max(amax, p); }
      for (const [x, z] of CB) { const p = x * ax + z * az; bmin = Math.min(bmin, p); bmax = Math.max(bmax, p); }
      best = Math.max(best, Math.max(bmin - amax, amin - bmax));
    }
    return best;
  };
  // an extraction zone's cells are ground too: units drive off-road inside one (core/zones.ts)
  const zc = new Set(g.getZones().flatMap((z) => z.cells.map(([x, k]) => k * 256 + x)));
  for (; i < frames; i++) {
    if (i % 10 === 0) {
      g.grantPower(50000);
      // (full: the store kept full instead)
      const reg = g.getState().resources.regolith;
      if (full) g.grantResources({ regolith: 5000 });
      else if (reg > 0) g.grantResources({ regolith: -reg });
    }
    g.stepFrame(0.1);
    const life = g.getRenderInfo().life;
    T = life.traffic;
    // (a rover still inside its dock is not on the ground yet, and two that roll out of one door on the
    // same frame stand a body apart within the first half second: the measure starts at frame 5)
    const docked = new Set(life.rovers.ids.filter((_, k) => life.rovers.inside[k]));
    for (let a = 0; a < T.units.length; a++) {
      for (let b = a + 1; b < T.units.length; b++) {
        const A = T.units[a], B = T.units[b];
        if (i < 5 || (A.kind === 'rover' && docked.has(A.id)) || (B.kind === 'rover' && docked.has(B.id))) continue;
        if (isUnit(A) || isUnit(B)) {
          const d = Math.hypot(A.x - B.x, A.z - B.z);
          if (d < unitOrigin) { unitOrigin = d; unitPair = A.kind + '#' + A.id + '/' + B.kind + '#' + B.id + ' @' + i; }
        } else {
          const d = gap(A, B);
          if (d < worst) { worst = d; pair = A.kind + '#' + A.id + '/' + B.kind + '#' + B.id + ' @' + i; }
        }
      }
    }
    lagMaxS = Math.max(lagMaxS, life.haulers.lagMaxS);
    const st = g.getState();
    const open = new Set(st.roads.filter((x) => x.left <= 0).map((x) => x.gz * 256 + x.gx));
    for (const u of T.units) {
      const gx = Math.floor((u.x + 512) / 4), gz = Math.floor((u.z + 512) / 4);
      if (open.has(gz * 256 + gx) || zc.has(gz * 256 + gx)) continue;
      if (u.kind === 'digger') {
        const fp = g.footprintOf(u.id);
        if (fp && u.x >= fp.x0 - 0.01 && u.x <= fp.x1 + 0.01 && u.z >= fp.z0 - 0.01 && u.z <= fp.z1 + 0.01) continue;
      }
      if (offroad.length < 10) offroad.push(u.kind + '#' + u.id + ' at ' + u.x + ',' + u.z + ' @' + i);
    }
    if (watch && watch(i)) { i++; break; }
  }
  g.setPaused(true);
  g.stepFrame(0);
  return { frames: i, worst, pair, unitOrigin, unitPair, offroad, lagMaxS, breaks: T ? T.breaks : 0, rescues: T ? T.rescues : 0, detours: T ? T.detours : 0, courtesies: T ? T.courtesies : 0 };
};
})()`;

// ───────────────────────────── a crowded base ─────────────────────────────

test('rovers and hub units on the roads never share ground, never leave it, never lock up', async ({ page }) => {
  test.setTimeout(300_000);
  await start(page, {});
  const setup = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('constructionRobotics');
    g.completeTech('swarmRobotics');
    g.grantResources({ metals: 5000, parts: 5000 });
    // two Robotics Bays and two Regolith Smelters round the Lander (each commissions with a unit
    // that digs and tips into its own hopper), arrays beyond
    const placed = [
      near('roboticsBay', -20, 20), near('roboticsBay', 20, -24),
      near('smelter', -30, -6), near('smelter', 24, -6),
      near('solar', 30, 10), near('solar', 30, 18),
    ];
    g.finishConstruction();
    // then four sites for the rovers
    placed.push(near('lab', -10, -26), near('lab', 10, -26), near('storageYard', -34, 14), near('lab', 30, 34));
    g.advanceGameSeconds(1);
    const ids = g.getState().buildings.filter((b: any) => b.construction > 0).map((b: any) => b.id);
    g.summonRover(ids[0]);
    g.summonRover(ids[0]);
    return { placed, rovers: g.getState().rovers.length, sites: ids.length, units: g.getState().haulers.length };
  });
  expect(setup.placed.every(Boolean)).toBe(true);
  expect(setup.rovers).toBe(8); // the Lander's 2, three per Bay
  expect(setup.sites).toBe(4);
  expect(setup.units).toBe(2); // each smelter's own

  const sd0 = await page.evaluate(() => window.__game.getRenderInfo().life.rovers.setDowns);
  const r = await page.evaluate(() => drive(600));
  const setDowns = (await page.evaluate(() => window.__game.getRenderInfo().life.rovers.setDowns)) - sd0;
  const life = await page.evaluate(() => window.__game.getRenderInfo().life);
  test.info().annotations.push({ type: 'crowd', description: `closest rovers ${r.worst.toFixed(3)} m · nearest unit origin ${r.unitOrigin.toFixed(2)} m · breaks ${r.breaks} · detours ${r.detours} · courtesies ${r.courtesies} · rescues ${r.rescues} · rovers set down ${setDowns} · lag ${r.lagMaxS.toFixed(1)} s` });
  expect(r.worst, `closest pair ${r.pair}`).toBeGreaterThan(-TOL);
  // a hub unit is a free driver (docs/19 S4b): a rover in its way is asked to make way, so the bodies of a
  // unit and a rover can touch for a moment, but no origin ever runs under another
  expect(r.unitOrigin, `closest to a hub unit ${r.unitPair}`).toBeGreaterThan(1);
  expect(r.offroad).toEqual([]);
  // the rovers follow the sim (core/transit.ts) and are never set down where the sim has them
  expect(setDowns).toBe(0);
  // the hub units dug and tipped all the while, their pictures a few seconds behind the sim, never set down or snapped
  const s = await page.evaluate(() => window.__game.getState());
  expect(s.stats.produced.regolith).toBeGreaterThan(500);
  expect(r.lagMaxS).toBeLessThan(6);
  expect(life.haulers.setDowns).toBe(0);
  expect(life.haulers.snaps).toBe(0);
  // the traffic untangled itself: hub units add nothing to the rescues, and a rover is only set down back into its dock
  expect(r.rescues).toBeLessThanOrEqual(1);
  expect(r.courtesies, 'the rovers gave way to the units').toBeGreaterThan(0);
  // everything built, every road open, every rover home and parked
  expect(s.buildings.filter((b: any) => b.construction > 0)).toHaveLength(0);
  expect(s.roads.filter((c: any) => c.left > 0)).toHaveLength(0);
  const home = await page.evaluate(() => drive(120, () => window.__game.getRenderInfo().life.rovers.legs.every((n: number) => n === 0)));
  expect(home.frames, 'every rover reached its bay').toBeLessThan(120);
  expect(home.worst).toBeGreaterThan(-TOL);
  const end = await page.evaluate(() => window.__game.getRenderInfo().life.rovers);
  for (let i = 0; i < end.spots.length; i++) {
    for (let j = i + 1; j < end.spots.length; j++) {
      if (end.inside[i] || end.inside[j]) continue;
      expect(Math.hypot(end.spots[i][0] - end.spots[j][0], end.spots[i][1] - end.spots[j][1])).toBeGreaterThanOrEqual(1.9);
    }
  }
});

// ───────────────────────────── passing ─────────────────────────────

test('two rovers on one road the opposite ways pass in their lanes, and both arrive', async ({ page }) => {
  test.setTimeout(180_000);
  await start(page);
  const ids = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('constructionRobotics');
    g.grantResources({ metals: 3000, parts: 3000 });
    // a Bay 40 m east of the Lander; a lab out past each end
    near('roboticsBay', 40, -2);
    g.finishConstruction();
    near('lab', -40, -2);
    near('lab', 70, -2);
    g.advanceGameSeconds(0);
    const st = g.getState();
    const bay = st.buildings.find((b: any) => b.type === 'roboticsBay');
    const lander = st.buildings.find((b: any) => b.type === 'lander').id;
    const labs = st.buildings.filter((b: any) => b.construction > 0).sort((p: any, q: any) => p.gx - q.gx).map((b: any) => b.id);
    // a Lander rover sent east, a Bay rover sent west: head to head
    const a = st.rovers.find((r: any) => r.home === lander).id;
    const b = st.rovers.find((r: any) => r.home === bay.id).id;
    g.sendRover(a, labs[1]);
    g.sendRover(b, labs[0]);
    // no weld parts: the sites wait with their crews, so both stay out
    g.grantResources({ parts: -g.getState().resources.parts });
    g.advanceGameSeconds(0);
    return { a, b, west: labs[0], east: labs[1] };
  });
  const r = await page.evaluate(({ a, b }) => {
    let ax0: number | null = null;
    let swapped = false;
    const out = drive(200, () => {
      const pa = roverAt(a), pb = roverAt(b);
      if (!pa || !pb || pa.inside || pb.inside) return false;
      if (ax0 === null) ax0 = Math.sign(pb.pos[0] - pa.pos[0]);
      if (Math.sign(pb.pos[0] - pa.pos[0]) !== ax0) swapped = true;
      return swapped && pa.legs === 0 && pb.legs === 0;
    });
    return { ...out, swapped, a: roverAt(a), b: roverAt(b) };
  }, ids);
  expect(r.swapped, 'they passed').toBe(true);
  expect(r.worst, `closest pair ${r.pair}`).toBeGreaterThan(-TOL);
  expect(r.offroad).toEqual([]);
  expect(r.rescues).toBe(0);
  expect(r.a.site).toBe(ids.east);
  expect(r.b.site).toBe(ids.west);
  expect(r.a.legs).toBe(0);
  expect(r.b.legs).toBe(0);
});

// ───────────────────────────── getting out of each other's way ─────────────────────────────

test('the hub\'s hopper full: its unit waits at its face, off the road, and a rover leaves its bay, builds and comes home', async ({ page }) => {
  test.setTimeout(180_000);
  await start(page);
  const setup = await page.evaluate(() => {
    const g = window.__game!;
    g.holdHazards(true);
    g.grantResources({ metals: 2000, parts: 1000 });
    power(12);
    const hub = hubBy('smelter', 'ilmenite-0', 3)!;
    g.finishConstruction();
    return { hub };
  });
  // the pile kept full, so the smelter draws that and never its hopper: after a few loads the hopper is
  // full and the bucket it is holding has nowhere to go
  const wait = await page.evaluate(({ hub }) => {
    const g = window.__game!;
    for (let i = 0; i < 1500; i++) {
      g.grantPower(1000);
      g.grantResources({ regolith: 5000 });
      g.advanceGameSeconds(1);
      const u = g.getState().haulers.find((x: any) => x.hub === hub);
      if (!u.haul.full) continue;
      g.advanceGameSeconds(1);
      const v = g.getState().haulers.find((x: any) => x.hub === hub);
      return { id: v.id, h: v.haul, line: g.getHubs().units.find((x: any) => x.id === v.id).line, hopper: g.getState().buildings.find((b: any) => b.id === hub).hub.hopper, t: i };
    }
    return null;
  }, setup);
  expect(wait, 'a full bucket, no room').not.toBeNull();
  expect(wait!.h.phase).toBe('dig');
  expect(wait!.line).toMatch(/^WAITING AT THE FACE — Regolith Smelter #\d+'s hopper is full/);
  // it waits where it digs — on the pit's ground, never on the carriageway
  const roadHere = await page.evaluate(({ x, z }) => {
    const gx = Math.floor((x + 512) / 4), gz = Math.floor((z + 512) / 4);
    return window.__game.getState().roads.some((c: any) => c.gx === gx && c.gz === gz);
  }, { x: wait!.h.x, z: wait!.h.z });
  expect(roadHere, 'it waits at its face, off the road').toBe(false);
  // a site: a Lander rover rolls out of its bay, builds it, and comes home
  const site = await page.evaluate(() => {
    const g = window.__game!;
    const ids = new Set(g.getState().buildings.map((b: any) => b.id));
    near('solar', -30, -30);
    return g.getState().buildings.find((b: any) => !ids.has(b.id)).id;
  });
  const r = await page.evaluate(({ site, id }) => {
    const g = window.__game!;
    const sd0 = g.getRenderInfo().life.rovers.setDowns;
    let built = -1, moved = 0;
    const at0 = g.getState().haulers.find((x: any) => x.id === id).haul;
    const out = drive(900, (i) => {
      const s = g.getState();
      const b = s.buildings.find((x: any) => x.id === site);
      const h = s.haulers.find((x: any) => x.id === id).haul;
      if (h.full) moved = Math.max(moved, Math.hypot(h.x - at0.x, h.z - at0.z));
      if (b.construction <= 0 && built < 0) built = i;
      return built >= 0 && i > built + 5 && g.getRenderInfo().life.rovers.legs.every((n: number) => n === 0);
    }, true);
    return { ...out, built, moved, full: g.getState().haulers.find((x: any) => x.id === id).haul.full, setDowns: g.getRenderInfo().life.rovers.setDowns - sd0 };
  }, { site, id: wait!.id });
  expect(r.built, 'the site was built').toBeGreaterThan(0);
  expect(r.frames, 'every rover home again').toBeLessThan(900);
  expect(r.full, 'the unit was still waiting for room').toBe(true);
  expect(r.moved, 'the unit never left its face').toBeLessThan(0.5);
  expect(r.worst, `closest pair ${r.pair}`).toBeGreaterThan(-TOL);
  expect(r.offroad).toEqual([]);
  expect(r.setDowns, 'nobody set down').toBe(0);
  expect(r.rescues).toBe(0);
});

/** A hub by the high-Ti basalt with its haul road open and its unit at work; the hub, its unit, and the
 *  haul road's cells from the hub's door to the pit's gate. */
async function hubAtWork(page: Page) {
  return page.evaluate(() => {
    const g = window.__game!;
    g.holdHazards(true);
    g.openRoads(true);
    g.grantResources({ metals: 3000, parts: 3000 });
    power(12);
    const hub = hubBy('smelter', 'ilmenite-0', 8)!;
    g.finishConstruction();
    // a first full trip: the road is worn in, the unit is out at its face
    for (let i = 0; i < 90; i++) { g.grantPower(1000); g.advanceGameSeconds(1); }
    const plan = g.planHaul(hub, 'dep:ilmenite-0');
    const u = g.getState().haulers.find((x: any) => x.hub === hub);
    return { hub, unit: u.id, route: plan.route as [number, number][], gate: plan.gate };
  });
}

test('a rover working on the hub\'s haul road gets out of the loaded unit\'s way, and both get on', async ({ page }) => {
  test.setTimeout(180_000);
  await start(page);
  const hub = await hubAtWork(page);
  expect(hub.route.length).toBeGreaterThan(6);
  // a solar array beside the road, halfway out: its rover welds from a road cell, in the unit's way
  const site = await page.evaluate(({ route }) => {
    const g = window.__game!;
    const ids = new Set(g.getState().buildings.map((b: any) => b.id));
    const [gx, gz] = route[Math.floor(route.length / 2)];
    near('solar', (gx + 0.5) * 4 - 512, (gz + 0.5) * 4 - 512);
    return g.getState().buildings.find((b: any) => !ids.has(b.id))?.id ?? null;
  }, hub);
  expect(site).not.toBeNull();
  const r = await page.evaluate(({ site, unit }) => {
    const g = window.__game!;
    const sd0 = g.getRenderInfo().life.rovers.setDowns;
    const p0 = g.getState().stats.produced.regolith;
    let built = -1;
    const out = drive(500, (i) => {
      const b = g.getState().buildings.find((x: any) => x.id === site);
      if (b.construction <= 0 && built < 0) built = i;
      return built >= 0 && i > built + 60 && g.getState().stats.produced.regolith > p0
        && g.getRenderInfo().life.rovers.legs.every((n: number) => n === 0);
    });
    const tr = g.getTraffic();
    return { ...out, built, loads: g.getState().stats.produced.regolith - p0, setDowns: g.getRenderInfo().life.rovers.setDowns - sd0, unit,
      sim: { pullIns: tr.pullIns, stepAsides: tr.stepAsides, forced: tr.forced } };
  }, { site, unit: hub.unit });
  test.info().annotations.push({ type: 'meeting', description: `courtesies ${r.courtesies} · breaks ${r.breaks} · unit origin ${r.unitOrigin.toFixed(2)} m · sim ${JSON.stringify(r.sim)}` });
  expect(r.built, 'the array was built').toBeGreaterThan(0);
  expect(r.loads, 'the unit got its load out').toBeGreaterThan(0);
  // the unit is a free driver (S4b): the rover in its way is asked to make way
  expect(r.courtesies, 'someone gave way').toBeGreaterThan(0);
  expect(r.frames, 'and everyone got home').toBeLessThan(500);
  expect(r.worst, `closest pair ${r.pair}`).toBeGreaterThan(-TOL);
  expect(r.unitOrigin, `closest to the unit ${r.unitPair}`).toBeGreaterThan(1);
  expect(r.offroad).toEqual([]);
  expect(r.rescues).toBe(0);
  expect(r.setDowns).toBe(0);
  expect(r.sim.forced, 'no unit drove through another in the sim').toBe(0);
});

// ───────────────────────────── spurs ─────────────────────────────

test('a placement lays a road from the network to its door, and the rovers sinter it before they weld', async ({ page }) => {
  test.setTimeout(120_000);
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ metals: 3000, parts: 3000 });
    // well off the apron: the road the ghost shows is the road it lays
    const at = near('lab', 40, 30)!;
    const probe = g.canPlace('lab', at[0], at[1], at[2]);
    g.advanceGameSeconds(0);
    const st = g.getState();
    const b = st.buildings.find((x: any) => x.type === 'lab');
    const map = new Map(st.roads.map((c: any) => [c.gz * 256 + c.gx, c]));
    return {
      id: b.id, total: b.buildTotal, spur: b.spur, left: b.spur.map((k: number) => (map.get(k) as any)?.left ?? -1),
      ghost: probe.road, ghostS: probe.roadS,
    };
  });
  // the ghost's preview is the placement's (now laid) road
  expect(r.spur.length).toBeGreaterThan(3);
  expect(r.left.every((n: number) => n > 0)).toBe(true);
  // (the probe was taken before the placement: a placed site's own cells are no longer "new")
  const trace = await page.evaluate((id) => {
    const g = window.__game!;
    const out: { t: number; left: number; c: number; why: string }[] = [];
    for (let t = 0; t < 400; t++) {
      g.advanceGameSeconds(1);
      const st = g.getState();
      const b = st.buildings.find((x: any) => x.id === id);
      const map = new Map(st.roads.map((c: any) => [c.gz * 256 + c.gx, c]));
      const left = (b.spur ?? []).reduce((n: number, k: number) => n + Math.max(0, (map.get(k) as any)?.left ?? 0), 0);
      out.push({ t, left, c: b.construction, why: b.idleReason });
      if (b.construction <= 0) break;
    }
    const st = g.getState();
    const b = st.buildings.find((x: any) => x.id === id);
    return { out, done: b.construction <= 0, access: g.roadAccess().find((a: any) => a.id === id) };
  }, r.id);
  expect(trace.done).toBe(true);
  // while any of its road is still to sinter, the site waits on it, unwelded:
  // its rover on its way first (core/transit.ts), then laying the road
  const sintering = trace.out.filter((o) => o.left > 0);
  expect(sintering.length).toBeGreaterThan(0);
  expect(sintering.every((o) => o.c === r.total && (o.why === 'road' || o.why === 'enroute'))).toBe(true);
  const firstRoad = sintering.findIndex((o) => o.why === 'road');
  expect(firstRoad).toBeGreaterThan(0);
  expect(sintering.slice(firstRoad).every((o) => o.why === 'road')).toBe(true);
  // then it welds, and stands at the end of an open road
  const welded = trace.out.findIndex((o) => o.c < r.total);
  expect(welded).toBeGreaterThan(sintering[sintering.length - 1].t - 1);
  expect(trace.access.doorOpen).toBe(true);
  expect(trace.access.linked).toBe(true);
});

test('a field of arrays needs no road between its arrays; one on its own gets a road to its edge', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ metals: 3000, parts: 3000 });
    const a = near('solar', 18, 0)!;
    g.finishConstruction();
    // one touching it on the side away from the road, then one against that
    const st0 = g.getState();
    const first = st0.buildings.find((b: any) => b.type === 'solar');
    const fp = g.footprintOf(first.id);
    const w = (fp.x1 - fp.x0) / 4;
    const touching = [first.gx + w, first.gz];
    const ok1 = g.canPlace('solar', touching[0], touching[1], 0);
    g.placeBuilding('solar', touching[0], touching[1], 0);
    const ok2 = g.canPlace('solar', touching[0] + w, touching[1], 0);
    g.placeBuilding('solar', touching[0] + w, touching[1], 0);
    // and one well away from everything
    const lone = near('solar', 60, 60)!;
    g.advanceGameSeconds(0);
    return { a, ok1, ok2, lone, access: g.roadAccess() };
  });
  expect(r.ok1.valid, r.ok1.reason).toBe(true);
  expect(r.ok2.valid, r.ok2.reason).toBe(true);
  const solars = r.access.filter((x: any) => x.type === 'solar');
  expect(solars).toHaveLength(4);
  // arrays have no door; the two chained on are served through the field, no road laid
  expect(solars.every((x: any) => x.door === null)).toBe(true);
  expect(solars[1].spur).toEqual([]);
  expect(solars[2].spur).toEqual([]);
  expect(solars[1].served && solars[2].served).toBe(true);
  // the lone one gets a road to within reach of its edge
  expect(solars[3].spur.length).toBeGreaterThan(0);
});

test('solar at the pole: a refused spot says why and how to succeed — rough ground, a road, a pocket no road reaches', async ({ page }) => {
  test.setTimeout(120_000);
  await start(page, { site: 'southpole', exp: 'human' });
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ metals: 3000, parts: 500 });
    const L = g.getState().buildings.find((b: any) => b.type === 'lander');
    const ok = (gx: number, gz: number) => g.canPlace('solar', gx, gz, 0).valid;
    // rough ground by the Lander, on screen
    let rough: any = null;
    for (let dz = -6; dz <= 6 && !rough; dz++) for (let dx = -6; dx <= 6 && !rough; dx++) {
      const c = g.canPlace('solar', L.gx + dx, L.gz + dz, 0);
      if (!/^Terrain too rough/.test(c.reason)) continue;
      const x = (L.gx + dx + 1) * 4 - 512, z = (L.gz + dz + 1) * 4 - 512;
      const p = g.screenOf(x, z);
      if (p.visible && document.elementFromPoint(p.x, p.y)?.tagName === 'CANVAS') rough = { reason: c.reason, px: p.x, py: p.y };
    }
    const apron = g.getState().roads.find((c: any) => c.closed);
    const onRoad = g.canPlace('solar', apron.gx, apron.gz, 0).reason;
    // a pocket: twelve arrays walling a 4×4 patch (one field, served from outside), then one inside it
    let pocket: any = null;
    for (let d = 8; d < 30 && !pocket; d++) {
      for (const [x0, z0] of [[L.gx + d, L.gz], [L.gx - d, L.gz], [L.gx, L.gz + d], [L.gx, L.gz - d], [L.gx + d, L.gz + d], [L.gx - d, L.gz - d]]) {
        // round the ring, each touching the last
        const wall: [number, number][] = [
          [x0 - 2, z0 - 2], [x0, z0 - 2], [x0 + 2, z0 - 2], [x0 + 4, z0 - 2], [x0 + 4, z0], [x0 + 4, z0 + 2],
          [x0 + 4, z0 + 4], [x0 + 2, z0 + 4], [x0, z0 + 4], [x0 - 2, z0 + 4], [x0 - 2, z0 + 2], [x0 - 2, z0],
        ];
        if (![...wall, [x0 + 1, z0 + 1], [x0, z0]].every(([x, z]) => ok(x, z))) continue;
        pocket = { x0, z0, wall };
        break;
      }
    }
    if (!pocket) return { rough, onRoad, pocket };
    // the wall, from the side the road comes from (each new one touches the field)
    const placed = pocket.wall.map(([x, z]: [number, number]) => g.placeBuilding('solar', x, z, 0));
    const roadIn = g.getState().roads.filter((c: any) => c.gx >= pocket.x0 && c.gx < pocket.x0 + 4 && c.gz >= pocket.z0 && c.gz < pocket.z0 + 4).length;
    const inside = g.canPlace('solar', pocket.x0 + 1, pocket.z0 + 1, 0);
    const edge = g.canPlace('solar', pocket.x0, pocket.z0, 0);
    return { rough, onRoad, pocket, placed, roadIn, inside, edge };
  });
  expect(r.rough, 'a rough pad on screen').toBeTruthy();
  expect(r.rough.reason).toMatch(/^Terrain too rough \(\d+\.\d m relief > 2\.5 m\) — find flatter ground, or grade it \(Grade Site\)$/);
  expect(r.onRoad).toBe('On a road — pick open ground beside it');
  expect(r.pocket, 'a flat 8×8 patch near the Lander').toBeTruthy();
  expect(r.placed.every(Boolean)).toBe(true);
  expect(r.roadIn).toBe(0);
  // no road can get into the pocket: the refusal says so, and names the way that needs none
  expect(r.inside.valid).toBe(false);
  expect(r.inside.reason).toMatch(/^NO ROAD ROUTE — no road can reach its edge \(walled in, or steps over 1\.6 m\); set it edge to edge with a served Solar Array \(no road needed\)$/);
  // ...and that way works: against the wall, it is served through the field
  expect(r.edge.valid, r.edge.reason).toBe(true);
  expect(r.edge.road).toEqual([]);
  // the ghost says the same as the check
  await page.evaluate(() => window.__game.beginPlacement('solar'));
  await page.mouse.move(r.rough.px, r.rough.py);
  await expect(page.locator('#place-hint .blocked')).toContainText('Terrain too rough (');
  await expect(page.locator('#place-hint .blocked')).toContainText('grade it (Grade Site)');
});

// ───────────────────────────── the road tool ─────────────────────────────

test('the road tool: N starts it, a road laid is sintered by free rovers, a removal warns when it strands a door', async ({ page }) => {
  test.setTimeout(120_000);
  await start(page);
  // N toggles it (build mode); its hint says what a drag does; Esc stops it
  await page.keyboard.press('KeyN');
  await expect(page.locator('#road-hint')).toBeVisible();
  expect((await page.evaluate(() => window.__game.getRoadTool())).active).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#road-hint')).toBeHidden();
  expect((await page.evaluate(() => window.__game.getRoadTool())).active).toBe(false);

  const r = await page.evaluate(() => {
    const g = window.__game!;
    const st = g.getState();
    // from the apron's stub end, a road 6 cells east
    const end = st.roads.filter((c: any) => !c.bay && !c.closed).sort((a: any, b: any) => b.gz - a.gz)[0];
    g.layRoad([end.gx, end.gz], [end.gx + 6, end.gz]);
    g.advanceGameSeconds(0);
    const jobs = g.getState().roadJobs;
    const alerts = g.getState().alerts.map((a: any) => a.text);
    return { from: [end.gx, end.gz], jobs, alerts };
  });
  expect(r.alerts.some((t: string) => /^ROAD LAID — \d+ cells/.test(t))).toBe(true);
  expect(r.jobs).toHaveLength(1);
  expect(r.jobs[0].kind).toBe('draw');
  const laid = await page.evaluate((cells) => {
    const g = window.__game!;
    let t = 0;
    for (; t < 120 && g.getState().roadJobs.length; t++) g.advanceGameSeconds(1);
    const st = g.getState();
    const map = new Map(st.roads.map((c: any) => [c.gz * 256 + c.gx, c]));
    return { t, open: cells.every((k: number) => ((map.get(k) as any)?.left ?? 1) <= 0) };
  }, r.jobs[0].cells);
  expect(laid.t, 'the rovers sintered it').toBeLessThan(120);
  expect(laid.open).toBe(true);

  // a lab at the end of it, its door on that road; cutting the road strands it
  const cut = await page.evaluate((cells) => {
    const g = window.__game!;
    g.grantResources({ metals: 3000, parts: 3000 });
    const last = cells[cells.length - 1];
    // (south of it: the high-Ti patch to the north is an extraction zone, where a door gets no road)
    near('lab', (last % 256) * 4 - 512 + 2, Math.floor(last / 256) * 4 - 512 - 10);
    g.finishConstruction();
    const lab = g.roadAccess().find((a: any) => a.type === 'lab');
    g.removeRoad([lab.door]);
    g.advanceGameSeconds(0);
    return { lab, after: g.roadAccess().find((a: any) => a.type === 'lab'), alerts: g.getState().alerts.map((a: any) => a.text) };
  }, r.jobs[0].cells);
  expect(cut.lab.linked).toBe(true);
  expect(cut.alerts.some((t: string) => /^ROAD REMOVED — 1 cells? · .*no longer has a road to its door/.test(t))).toBe(true);
  expect(cut.after.doorOpen).toBe(false);
});

// ───────────────────────────── hub units ─────────────────────────────

test('a hub unit hauls on roads only: the haul road is laid with the hub, and the trip is timed by the road and its tier', async ({ page }) => {
  test.setTimeout(180_000);
  await start(page);
  const setup = await page.evaluate(() => {
    const g = window.__game!;
    g.holdHazards(true);
    g.grantResources({ metals: 3000, parts: 3000 });
    power(12);
    // 30 m or so of haul road: the hub stands a few cells off the ring, its door toward the deposit
    const hub = hubBy('smelter', 'ilmenite-0', 8)!;
    g.finishConstruction();
    const st = g.getState();
    const u = st.haulers.find((x: any) => x.hub === hub);
    return { hub, unit: u.id, pending: st.roads.filter((c: any) => c.left > 0).length, jobs: st.roadJobs.length,
      route: g.planHaul(hub, 'dep:ilmenite-0').route.length };
  });
  // the road is there before the unit drives it: no cell of it is still to sinter, and it has some length
  expect(setup.pending).toBe(0);
  expect(setup.jobs).toBe(0);
  expect(setup.route).toBeGreaterThanOrEqual(6);

  // it drives out along it, and every leg keeps to open road (or, at the pit, the extraction zone's ground)
  const legs = await page.evaluate((id) => {
    const g = window.__game!;
    const onRoad: string[] = [];
    const zc = new Set(g.getZones().flatMap((z: any) => z.cells.map(([x, k]: number[]) => k * 256 + x)));
    const out = hauls(id, 3, (h: any, st: any) => {
      const open = new Set(st.roads.filter((c: any) => c.left <= 0).map((c: any) => c.gz * 256 + c.gx));
      for (const [x, z] of h.route) {
        const k = Math.floor((z + 512) / 4) * 256 + Math.floor((x + 512) / 4);
        if (!open.has(k) && !zc.has(k) && onRoad.length < 5) onRoad.push(`${h.phase} ${x.toFixed(1)},${z.toFixed(1)}`);
      }
    });
    return { onRoad, legs: out, unit: g.getHubs().units.find((x: any) => x.id === id) };
  }, setup.unit);
  expect(legs.onRoad).toEqual([]);
  expect(legs.legs.length).toBe(3);

  // Basalt Paving (×1.25), Guidance Beacons (×1.1) and Guideway Rails (×1.3 for
  // haulers): the same road, a quicker trip — in the sim's own legs too
  const tiers = await page.evaluate((id) => {
    const g = window.__game!;
    const view = () => g.getHubs().units.find((x: any) => x.id === id);
    const f0 = view();
    g.completeTech('basaltPaving');
    g.advanceGameSeconds(0);
    const f1 = view();
    g.completeTech('guidanceBeacons');
    g.completeTech('guidewayRails');
    g.advanceGameSeconds(0);
    const f2 = view();
    return { f0, f1, f2, legs: hauls(id, 3) };
  }, setup.unit);
  expect(tiers.f1.tripS).toBeLessThan(tiers.f0.tripS);
  expect(tiers.f1.rate).toBeGreaterThan(tiers.f0.rate * 1.02);
  expect(tiers.f2.rate).toBeGreaterThan(tiers.f1.rate * 1.02);
  // a leg's time is its road's length over the tier's speed (daylight: no night bonus)
  const pace = (l: { dur: number; len: number }[]) => l.reduce((n, x) => n + x.dur, 0) / l.reduce((n, x) => n + x.len, 0);
  const ratio = pace(tiers.legs) / pace(legs.legs);
  expect(tiers.legs).toHaveLength(3);
  expect(ratio).toBeGreaterThan(1 / (1.25 * 1.1 * 1.3) * 0.8);
  expect(ratio).toBeLessThan(1 / (1.25 * 1.1 * 1.3) * 1.2);
});

// ───────────────────────────── saves ─────────────────────────────

test('a save from before roads loads with a road to every door', async ({ page }) => {
  test.setTimeout(120_000);
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ metals: 3000, parts: 3000 });
    const placed = [near('lab', 30, 0), near('smelter', -30, 10), near('storageYard', 0, 40), near('solar', 20, -30), near('lab', -20, -30)];
    g.finishConstruction();
    const blob = g.saveBlob();
    // as an old save: no roads at all
    delete blob.state.roads; delete blob.state.roadJobs; delete blob.state.roadRev; delete blob.state.roadSchema; delete blob.state.nextRoadJob;
    for (const b of blob.state.buildings) delete b.spur;
    g.loadBlob(blob);
    g.setPaused(true);
    g.advanceGameSeconds(1);
    return { placed, schema: g.getState().roadSchema, access: g.roadAccess(), pending: g.getState().roads.filter((c: any) => c.left > 0).length };
  });
  expect(r.placed.every(Boolean)).toBe(true);
  expect(r.schema).toBe(1);
  expect(r.pending).toBe(0);
  expect(r.access).toHaveLength(5);
  for (const a of r.access) {
    expect(a.linked, `${a.type} #${a.id}`).toBe(true);
    if (a.door) expect(a.doorOpen, `${a.type} #${a.id}`).toBe(true);
  }
});

// ───────────────────────────── the early smelter trap ─────────────────────────────

test('the palette warns before a placement that would leave too few metals for the first smelter', async ({ page }) => {
  await start(page, { site: 'southpole', exp: 'human' });
  // 100 metals on the pole (×1.25): a 38◆ lab leaves 62, short of the 75◆ smelter (60◆ at the mare's ×1, a hub
  // from landing); a 19◆ array leaves 81, which is not
  const spot = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ metals: 100 - g.getState().resources.metals });
    // a pad clear of every deposit's pit ring, so only the smelter warning is in play
    for (let gz = 120; gz < 140; gz++) for (let gx = 120; gx < 140; gx++) {
      const s = g.canPlace('solar', gx, gz), l = g.canPlace('lab', gx, gz);
      if (s.valid && l.valid && !/PIT/.test(s.warn ?? '') && !/PIT/.test(l.warn ?? '')) return { gx, gz };
    }
    return null;
  });
  expect(spot, 'a pad off the pit rings').not.toBeNull();
  const solar = await page.evaluate(({ gx, gz }) => window.__game.canPlace('solar', gx, gz), spot!);
  expect(solar.valid, solar.reason).toBe(true);
  expect(solar.warn ?? '').toBe('');
  const lab = await page.evaluate(({ gx, gz }) => window.__game.canPlace('lab', gx, gz), spot!);
  expect(lab.valid, lab.reason).toBe(true);
  // (the smelter is available from landing: no "research …" tail)
  expect(lab.warn).toBe('Leaves 62◆ — keep 75◆ for your first Regolith Smelter');
  // the card says so before it is picked up
  await page.locator('#palette .cats button', { hasText: /science/i }).click();
  const card = page.locator('#palette .bld-btn[data-type="lab"]');
  await expect(card).toHaveClass(/strands/);
  await card.hover();
  await expect(page.locator('#tooltip')).toContainText('keep 75◆ for your first Regolith Smelter');
  // placing it asks once: the hint carries the warning and what a click does
  await page.evaluate(() => window.__game.beginPlacement('lab'));
  await expect(page.locator('#place-hint .caution')).toContainText('keep 75◆ for your first Regolith Smelter');
});

test('METALS LOW names the smelter, which is available from landing (Pit Mapping is no longer its research)', async ({ page }) => {
  await start(page, { site: 'southpole', exp: 'human' });
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ metals: 100 - g.getState().resources.metals });
    near('lab', 20, 0);
    g.advanceGameSeconds(0);
    const alerts = g.getState().alerts.map((a: any) => a.text);
    return { alerts };
  });
  // the tech that used to unlock it is Pit Mapping now: no alert sends the player to research it
  expect(r.alerts.some((t: string) => /^METALS LOW — a Regolith Smelter costs 75◆; without one you cannot make more/.test(t))).toBe(true);
  expect(r.alerts.some((t: string) => /research/.test(t) && /METALS LOW/.test(t))).toBe(false);
});
