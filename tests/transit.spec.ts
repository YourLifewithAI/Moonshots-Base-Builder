/** Rovers travel (core/transit.ts, docs/15 §6): construction waits for its
 *  rover to get there. A trip's time is its road route's length at the
 *  rover's cruise (× the roadway tiers), rest to rest; a drone flies
 *  straight. A site builds, and a road cell sinters, only with the units that
 *  have arrived — the cell behind the frontier for a road. A reassignment
 *  replans from where the rover is; the visual rover is at its stand when
 *  the building rises; saves keep trips, and an old save settles every rover
 *  at its work. */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

const URL_DEBUG = '/?debug&seed=42&nolock&lowfx';
/** data/roads.ts ROVER, core/fleet.ts DRONE */
const V = 4.5, A = 3, DRONE_V = 6, DRONE_A = 3;
/** a rest-to-rest move (core/transit.ts travelTime) */
const travel = (len: number, v: number, a: number) => (len >= (v * v) / a ? len / v + v / a : 2 * Math.sqrt(len / a));

async function start(page: Page, opts: { site?: string; exp?: 'human' | 'robotic'; style?: string } = {}) {
  const { site = 'mare', exp = 'human', style = '' } = opts;
  await page.goto(`${URL_DEBUG}&site=${site}${exp === 'robotic' ? '&exp=robotic' : ''}${style ? `&style=${style}` : ''}`);
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
  await page.evaluate(HELPERS);
}

declare function near(type: string, x: number, z: number): [number, number, number] | null;
declare function byType(type: string): any;
declare function pathLen(pts: [number, number][]): number;
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
window.byType = (t) => window.__game.getState().buildings.find((b) => b.type === t);
window.pathLen = (pts) => { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; };
})()`;

// ───────────────────────────── the drive ─────────────────────────────

test('a site gets nothing until its rover arrives; the trip takes its road route ÷ cruise, rest to rest, within a tick', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ metals: 500, parts: 500 });
    near('habitat', 40, 30);
    g.finishRoads(); // its road open: the drive is the point, not the sintering
    const b = byType('habitat');
    g.advanceGameSeconds(1);
    const s0 = g.getState();
    const rv = s0.rovers.find((x: any) => x.site === b.id);
    const trip = rv.trip;
    const map = new Set(s0.roads.filter((c: any) => c.left <= 0).map((c: any) => c.gz * 256 + c.gx));
    const onRoad = trip.pts.slice(1, -1).every(([x, z]: [number, number]) => map.has(Math.floor((z + 512) / 4) * 256 + Math.floor((x + 512) / 4)));
    const out: { t: number; c: number; why: string; x: number; z: number; arrived: boolean }[] = [];
    for (let i = 0; i < 90; i++) {
      g.advanceGameSeconds(1);
      const s = g.getState();
      const u = s.rovers.find((x: any) => x.id === rv.id);
      const site = s.buildings.find((x: any) => x.id === b.id);
      out.push({ t: s.simTime, c: site.construction, why: site.idleReason, x: u.x, z: u.z, arrived: u.trip.t >= u.trip.dur });
      if (site.construction < site.buildTotal - 3) break;
    }
    return { t0: s0.simTime, total: b.buildTotal, trip, len: pathLen(trip.pts), onRoad, from: [rv.x, rv.z], out };
  });
  // the route: along the open road, its length the trip's
  expect(r.onRoad).toBe(true);
  expect(r.trip.len).toBeCloseTo(r.len, 6);
  expect(r.trip.len).toBeGreaterThan(30);
  expect(r.trip.v).toBeCloseTo(V, 6);
  expect(r.trip.dur).toBeCloseTo(travel(r.trip.len, V, A), 6);
  // nothing before it gets there: en route, the site untouched
  const at = r.out.findIndex((o) => o.arrived);
  expect(at).toBeGreaterThan(3);
  for (const o of r.out.slice(0, at)) {
    expect(o.c).toBe(r.total);
    expect(o.why).toBe('enroute');
  }
  // it moves along the way, never jumping ahead of its speed
  let last = r.from;
  for (const o of r.out.slice(0, at)) {
    expect(Math.hypot(o.x - last[0], o.z - last[1])).toBeLessThanOrEqual(V + 1e-6);
    last = [o.x, o.z];
  }
  // arrival: the route's time, within one tick; welding from that tick
  const arriveT = r.out[at].t - r.t0;
  expect(Math.abs(arriveT - r.trip.dur)).toBeLessThanOrEqual(1);
  expect(r.out[at].c).toBeLessThan(r.total);
  expect(r.out[at].why).toBe('building');
});

test('a road is sintered from the network outward, only with a rover behind its frontier; then the building is welded', async ({ page }) => {
  test.setTimeout(120_000);
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ metals: 500, parts: 500 });
    near('lab', 44, 34);
    const b = byType('lab');
    const spur: number[] = b.spur;
    const trace: { t: number; left: number[]; c: number; why: string; kind: string; arrived: boolean; cell: number; task: string }[] = [];
    const cellOf = (x: number, z: number) => Math.floor((z + 512) / 4) * 256 + Math.floor((x + 512) / 4);
    for (let i = 0; i < 300; i++) {
      g.advanceGameSeconds(1);
      const s = g.getState();
      const site = s.buildings.find((x: any) => x.id === b.id);
      const map = new Map(s.roads.map((c: any) => [c.gz * 256 + c.gx, c.left]));
      const u = s.rovers.find((x: any) => x.site === b.id);
      // where it stood while it worked this tick: a trip planned at the tick's end sets off from there
      const at = !u ? null : u.trip.t === 0 ? u.trip.pts[0] : [u.x, u.z];
      trace.push({
        t: s.simTime, left: spur.map((k) => (map.get(k) as number) ?? 0), c: site.construction, why: site.idleReason,
        kind: u?.trip?.kind ?? '', arrived: !!u && u.trip.t >= u.trip.dur, cell: at ? cellOf(at[0], at[1]) : -1, task: u?.task ?? '',
      });
      if (site.construction < site.buildTotal - 2) break;
    }
    return { spur, total: b.buildTotal, trace };
  });
  expect(r.spur.length).toBeGreaterThan(2);
  const n = r.spur.length;
  for (let i = 1; i < r.trace.length; i++) {
    const a = r.trace[i - 1], b = r.trace[i];
    const cut = b.left.map((l, k) => a.left[k] - l);
    const k = cut.findIndex((d) => d > 1e-9);
    if (k < 0) continue;
    // one cell at a time, from the network outward: every cell before it open
    expect(cut.filter((d) => d > 1e-9)).toHaveLength(1);
    expect(a.left.slice(0, k).every((l) => l <= 1e-9)).toBe(true);
    // with its rover there, sintering, behind that frontier cell: on the cell
    // before it (the network, for the first)
    expect(b.task).toBe('sinter');
    if (k > 0) expect(b.cell).toBe(r.spur[k - 1]);
    else expect(r.spur).not.toContain(b.cell);
  }
  // it drives out along the road it opens: a step on to each cell
  const fronts = new Set(r.trace.filter((o) => o.task === 'sinter').map((o) => o.cell));
  expect(fronts.size).toBeGreaterThanOrEqual(n - 1);
  // and a tick with nobody behind the frontier sinters nothing (on its way, or stepping on)
  for (let i = 1; i < r.trace.length; i++) {
    if (r.trace[i].task === 'sinter') continue;
    expect(r.trace[i].left).toEqual(r.trace[i - 1].left);
  }
  // the spur before the weld: not a weld-second while a cell is closed
  for (const o of r.trace) if (o.left.some((l) => l > 1e-9)) expect(o.c).toBe(r.total);
  expect(r.trace[r.trace.length - 1].c).toBeLessThan(r.total);
  expect(r.trace[r.trace.length - 1].kind).toBe('weld');
});

test('a rover sent elsewhere mid-trip replans from where it is, not from its dock', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ metals: 900, parts: 500 });
    near('habitat', 44, 30);
    near('lab', -40, -30);
    g.finishRoads();
    const hab = byType('habitat').id, lab = byType('lab').id;
    g.advanceGameSeconds(1);
    const s0 = g.getState();
    // the habitat's rover, under way
    const id = s0.rovers.find((x: any) => x.site === hab).id;
    const dock = s0.rovers.find((x: any) => x.id === id).trip.pts[0];
    g.advanceGameSeconds(4);
    g.sendRover(id, lab);
    g.advanceGameSeconds(1);
    const s1 = g.getState();
    const u = s1.rovers.find((x: any) => x.id === id);
    return { dock, u, lab };
  });
  expect(r.u.site).toBe(r.lab);
  expect(r.u.trip.site).toBe(r.lab);
  expect(r.u.trip.t).toBe(0);
  // it sets off from where it stood on its way to the habitat
  expect(r.u.trip.pts[0][0]).toBeCloseTo(r.u.x, 6);
  expect(r.u.trip.pts[0][1]).toBeCloseTo(r.u.z, 6);
  expect(Math.hypot(r.u.x - r.dock[0], r.u.z - r.dock[1])).toBeGreaterThan(8);
});

test('two rovers on one site: the build speeds up when the second gets there, not before', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ metals: 500, parts: 500 });
    near('habitat', 40, 30);
    g.finishRoads();
    const b = byType('habitat');
    g.advanceGameSeconds(1);
    // the second rover leaves six seconds after the first
    g.advanceGameSeconds(6);
    g.summonRover(b.id);
    const out: { d: number; n: number }[] = [];
    let c = byType('habitat').construction;
    for (let i = 0; i < 60; i++) {
      g.grantPower(1000);
      g.advanceGameSeconds(1);
      const s = g.getState();
      const site = s.buildings.find((x: any) => x.id === b.id);
      const n = s.rovers.filter((x: any) => x.site === b.id && x.trip.site === b.id && x.trip.t >= x.trip.dur).length;
      out.push({ d: c - site.construction, n });
      c = site.construction;
      if (site.construction <= 0) break;
    }
    return out;
  });
  // welded seconds a tick: 0 with nobody there, 1 with one, 2^0.85 with two
  const one = r.findIndex((o) => o.n === 1), two = r.findIndex((o) => o.n === 2);
  expect(two).toBeGreaterThan(one);
  for (const [i, o] of r.entries()) {
    if (o.d === 0 && o.n === 0) continue;
    const want = o.n === 2 ? 2 ** 0.85 : o.n === 1 ? 1 : 0;
    if (i === r.length - 1) continue; // the last tick finishes what is left
    expect(o.d, `tick ${i}: ${o.n} there`).toBeCloseTo(want, 6);
  }
  expect(r.slice(0, one).every((o) => o.d === 0)).toBe(true);
  expect(r.slice(one, two).every((o) => Math.abs(o.d - 1) < 1e-6)).toBe(true);
});

test('a higher road tier shortens the same trip', async ({ page }) => {
  const trip = async (tier: boolean) => {
    await start(page);
    return page.evaluate((tier) => {
      const g = window.__game!;
      if (tier) g.completeTech('basaltPaving');
      g.grantResources({ metals: 500, parts: 500 });
      near('habitat', 40, 30);
      g.finishRoads();
      g.advanceGameSeconds(1);
      const b = byType('habitat');
      return g.getState().rovers.find((x: any) => x.site === b.id).trip;
    }, tier);
  };
  const base = await trip(false);
  const paved = await trip(true);
  expect(paved.len).toBeCloseTo(base.len, 6);
  expect(paved.v).toBeCloseTo(V * 1.25, 6);
  expect(paved.dur).toBeCloseTo(travel(paved.len, V * 1.25, A), 6);
  expect(paved.dur).toBeLessThan(base.dur - 1);
});

test('a drone flies straight at its speed, no road, and must arrive before it welds', async ({ page }) => {
  await start(page, { exp: 'robotic' });
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('droneHives');
    g.grantResources({ metals: 3000, parts: 1000 });
    let ok = false;
    for (let rr = 5; rr < 30 && !ok; rr++) {
      for (let dx = -rr; dx <= rr && !ok; dx += 2) ok = g.placeBuilding('droneHive', 127 + dx, 127 - rr) || g.placeBuilding('droneHive', 127 + dx, 127 + rr);
    }
    g.finishConstruction();
    g.advanceGameSeconds(2);
    near('solar', 50, -40);
    g.finishRoads();
    const b = byType('solar');
    const s0 = g.getState();
    const hive = s0.buildings.find((x: any) => x.type === 'droneHive').id;
    const drone = s0.rovers.find((x: any) => x.home === hive);
    g.sendRover(drone.id, b.id);
    g.advanceGameSeconds(1);
    const s1 = g.getState();
    const u = s1.rovers.find((x: any) => x.id === drone.id);
    const trip = u.trip;
    const out: { c: number; arrived: boolean; why: string }[] = [];
    for (let i = 0; i < 40; i++) {
      g.grantPower(1000);
      g.advanceGameSeconds(1);
      const s = g.getState();
      const x = s.rovers.find((q: any) => q.id === drone.id);
      const site = s.buildings.find((q: any) => q.id === b.id);
      out.push({ c: site.construction, arrived: x.trip.t >= x.trip.dur, why: site.idleReason });
      if (x.trip.t >= x.trip.dur && site.construction < site.buildTotal) break;
    }
    // the Lander's rovers stayed home: only the drone works it
    const others = g.getState().rovers.filter((x: any) => x.site === b.id && x.id !== drone.id).length;
    return { trip, total: b.buildTotal, out, others };
  });
  expect(r.others).toBe(0);
  expect(r.trip.pts).toHaveLength(2); // straight
  const [[x0, z0], [x1, z1]] = r.trip.pts;
  expect(r.trip.len).toBeCloseTo(Math.hypot(x1 - x0, z1 - z0), 6);
  expect(r.trip.v).toBeCloseTo(DRONE_V, 6);
  expect(r.trip.dur).toBeCloseTo(travel(r.trip.len, DRONE_V, DRONE_A), 6);
  const at = r.out.findIndex((o) => o.arrived);
  expect(at).toBeGreaterThan(2);
  expect(r.out.slice(0, at).every((o) => o.c === r.total && o.why === 'enroute')).toBe(true);
  expect(r.out[at].c).toBeLessThan(r.total);
});

test('a drone lays its site\'s road from the air, over each frontier cell in turn, then welds', async ({ page }) => {
  test.setTimeout(120_000);
  await start(page, { exp: 'robotic' });
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('droneHives');
    g.grantResources({ metals: 3000, parts: 1000 });
    let ok = false;
    for (let rr = 5; rr < 30 && !ok; rr++) {
      for (let dx = -rr; dx <= rr && !ok; dx += 2) ok = g.placeBuilding('droneHive', 127 + dx, 127 - rr) || g.placeBuilding('droneHive', 127 + dx, 127 + rr);
    }
    g.finishConstruction();
    g.advanceGameSeconds(2);
    // a lab well out: a road of several cells to sinter first
    near('lab', 50, -44);
    const b = byType('lab');
    const s0 = g.getState();
    const hive = s0.buildings.find((x: any) => x.type === 'droneHive').id;
    const drone = s0.rovers.find((x: any) => x.home === hive);
    // the Lander's rovers held at home: only the drone works it
    for (const u of s0.rovers) if (u.home !== hive) g.patchRover(u.id, { heldUntil: 1e9 });
    g.sendRover(drone.id, b.id);
    const out: { left: number; c: number; task: string }[] = [];
    for (let i = 0; i < 400; i++) {
      g.grantPower(1000);
      g.advanceGameSeconds(1);
      const s = g.getState();
      const site = s.buildings.find((x: any) => x.id === b.id);
      const map = new Map(s.roads.map((c: any) => [c.gz * 256 + c.gx, c.left]));
      const u = s.rovers.find((x: any) => x.id === drone.id);
      out.push({ left: (b.spur as number[]).reduce((n, k) => n + ((map.get(k) as number) ?? 0), 0), c: site.construction, task: u.task ?? '' });
      if (site.construction < site.buildTotal - 2) break;
    }
    return { cells: b.spur.length, total: b.buildTotal, out };
  });
  expect(r.cells).toBeGreaterThan(2);
  const last = r.out[r.out.length - 1];
  expect(last.left).toBe(0);
  expect(last.c).toBeLessThan(r.total);
  // road first, by the drone: a cell's sintering only while it sinters
  for (let i = 1; i < r.out.length; i++) {
    if (r.out[i].left < r.out[i - 1].left) expect(r.out[i].task).toBe('sinter');
    if (r.out[i].left > 0) expect(r.out[i].c).toBe(r.total);
  }
});

// ───────────────────────────── the visuals ─────────────────────────────

for (const style of ['classic', 'detailed']) {
  test(`${style}: the rover is drawn at its stand when the building starts to rise, and never far behind the sim`, async ({ page }) => {
    test.setTimeout(120_000);
    await start(page, { style: style === 'classic' ? '' : style });
    const r = await page.evaluate(() => {
      const g = window.__game!;
      g.grantResources({ metals: 500, parts: 500 });
      near('habitat', 36, 24);
      g.finishRoads();
      const b = byType('habitat');
      g.setPaused(false);
      g.setSpeed(3);
      g.stepFrame(0);
      g.getRenderInfo();
      let lag = 0;
      for (let i = 0; i < 1200; i++) {
        g.stepFrame(0.05);
        const life = g.getRenderInfo().life;
        lag = Math.max(lag, life.rovers.lagMaxS);
        const s = g.getState();
        const site = s.buildings.find((x: any) => x.id === b.id);
        if (site.construction < site.buildTotal) {
          const u = s.rovers.find((x: any) => x.site === b.id);
          const k = life.rovers.ids.indexOf(u.id);
          g.setPaused(true);
          g.stepFrame(0);
          return {
            frame: i, pos: life.rovers.positions[k], spot: life.rovers.spots[k], legs: life.rovers.legs[k],
            mode: life.rovers.modes[k], follow: life.rovers.follow[k], lag, setDowns: life.rovers.setDowns, sim: [u.x, u.z],
          };
        }
      }
      return null;
    });
    expect(r, 'the building started').not.toBeNull();
    expect(r!.frame).toBeGreaterThan(20);
    // there, squared up at its stand, welding — where the sim has it
    expect(r!.legs).toBeLessThan(0.3);
    expect(Math.hypot(r!.pos[0] - r!.spot[0], r!.pos[1] - r!.spot[1])).toBeLessThan(0.5);
    expect(Math.hypot(r!.pos[0] - r!.sim[0], r!.pos[1] - r!.sim[1])).toBeLessThan(0.5);
    expect(r!.follow).toBe('sim');
    // it drove there in step with the sim: never more than a couple of seconds behind, never set down
    expect(r!.lag).toBeLessThan(2.5);
    expect(r!.setDowns).toBe(0);
    await expect.poll(async () => page.evaluate(() => {
      window.__game.stepFrame(0.05);
      const life = window.__game.getRenderInfo().life;
      return life.rovers.modes.includes('weld');
    }), { timeout: 10_000 }).toBe(true);
  });
}

// ───────────────────────────── the words ─────────────────────────────

test('en route: the site says when its rover arrives, the rover where it is going; Summon takes the nearest free rover by road', async ({ page }) => {
  test.setTimeout(120_000);
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('constructionRobotics');
    g.grantResources({ metals: 2000, parts: 2000 });
    near('roboticsBay', 60, 40);
    g.finishConstruction();
    g.advanceGameSeconds(2);
    const bay = byType('roboticsBay').id;
    // a site near the Bay: its rovers are the nearest by road
    near('habitat', 70, 56);
    g.finishRoads();
    g.advanceGameSeconds(1);
    const b = byType('habitat');
    const first = g.getState().rovers.find((x: any) => x.site === b.id);
    g.summonRover(b.id);
    g.advanceGameSeconds(1);
    const second = g.getState().rovers.find((x: any) => x.site === b.id && x.id !== first.id);
    return { bay, first, second, id: b.id, rovers: g.getState().rovers.map((x: any) => ({ id: x.id, home: x.home })) };
  });
  // not the lowest id (the Lander's): a Bay rover, both times
  expect(r.first.home).toBe(r.bay);
  expect(r.second.home).toBe(r.bay);
  expect(r.second.id).not.toBe(1);
  await page.evaluate((id) => window.__game.select(id), r.id);
  await expect(page.locator('#insp-status')).toContainText(/ROVER EN ROUTE — arrives in \d+:\d\d/);
  await page.evaluate((id) => window.__game.selectRover(id), r.first.id);
  await expect(page.locator('#rover-inspector')).toContainText(/EN ROUTE to Habitat Module #\d+ · \d+:\d\d/);
  // no rover assigned: the old words
  const q = await page.evaluate(() => {
    const g = window.__game!;
    g.selectRover(null);
    // every rover busy, one more site
    for (const [x, z] of [[-40, 30], [-40, -30], [30, -40], [-60, 0], [0, -60]]) near('solar', x, z);
    g.advanceGameSeconds(1);
    const s = g.getState();
    const queued = s.buildings.find((b: any) => b.construction > 0 && b.idleReason === 'queued');
    return queued?.id ?? null;
  });
  expect(q).not.toBeNull();
  await page.evaluate((id) => window.__game.select(id), q);
  await expect(page.locator('#insp-status')).toContainText('QUEUED — waiting for a free robot');
});

test('the placement ghost says how far off the nearest free rover is', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    window.__game.grantResources({ metals: 500, parts: 500 });
    window.__game.setView({ x: 60, y: 90, z: 80 }, { x: 10, y: 0, z: 10 });
  });
  await page.evaluate(() => window.__game.beginPlacement('habitat'));
  const at = await page.evaluate(() => {
    for (const [x, z] of [[20, 20], [24, 16], [16, 24], [28, 20], [20, 28]]) {
      const gx = Math.round((x + 512) / 4), gz = Math.round((z + 512) / 4);
      if (!window.__game.canPlace('habitat', gx - 1, gz - 1).valid) continue;
      const p = window.__game.screenOf(x, z);
      if (p.visible) return p;
    }
    return null;
  });
  expect(at).not.toBeNull();
  await page.mouse.move(at!.x, at!.y);
  await expect(page.locator('#place-eta')).toContainText(/ROVER \d+:\d\d away — the nearest free one, by road/);
});

// ───────────────────────────── saves ─────────────────────────────

test('a save made mid-trip loads with the rover where it was, and it arrives when it would have', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(async () => {
    const g = window.__game!;
    g.grantResources({ metals: 500, parts: 500 });
    near('habitat', 44, 30);
    g.finishRoads();
    g.advanceGameSeconds(1);
    const b = byType('habitat');
    g.advanceGameSeconds(4);
    const s0 = g.getState();
    const u0 = s0.rovers.find((x: any) => x.site === b.id);
    const left = u0.trip.dur - u0.trip.t;
    const blob = g.saveBlob();
    await g.loadBlob(blob);
    g.setPaused(true);
    const s1 = g.getState();
    const u1 = s1.rovers.find((x: any) => x.id === u0.id);
    let ticks = 0;
    for (; ticks < 60; ticks++) {
      const u = g.getState().rovers.find((x: any) => x.id === u0.id);
      if (u.trip.t >= u.trip.dur) break;
      g.advanceGameSeconds(1);
    }
    return { u0, u1, left, ticks, saved: blob.state.rovers.find((x: any) => x.id === u0.id), schema: blob.state.fleetSchema };
  });
  expect(r.schema).toBe(2); // fleetSchema 2: packs (docs/02, On-board power)
  expect(r.saved.trip).toBeTruthy();
  expect(r.u1.x).toBeCloseTo(r.u0.x, 6);
  expect(r.u1.z).toBeCloseTo(r.u0.z, 6);
  expect(r.u1.trip).toEqual(r.u0.trip);
  expect(r.ticks).toBe(Math.ceil(r.left - 1e-9));
});

test('an old save without trips settles each rover at its work: nothing waits on a drive after the load', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(async () => {
    const g = window.__game!;
    g.grantResources({ metals: 500, parts: 500 });
    near('habitat', 44, 30);
    g.finishRoads();
    g.advanceGameSeconds(1);
    const b = byType('habitat');
    const blob = g.saveBlob();
    // a save from before transit: no schema, no positions, no trips
    delete blob.state.fleetSchema;
    for (const u of blob.state.rovers) { delete u.x; delete u.z; delete u.trip; }
    await g.loadBlob(blob);
    g.setPaused(true);
    const s1 = g.getState();
    const c1 = s1.buildings.find((x: any) => x.id === b.id).construction;
    g.advanceGameSeconds(1);
    const s2 = g.getState();
    return {
      b: b.id, c1, c2: s2.buildings.find((x: any) => x.id === b.id).construction, why: s2.buildings.find((x: any) => x.id === b.id).idleReason,
      rovers: s1.rovers, schema: s1.fleetSchema,
    };
  });
  expect(r.schema).toBe(2); // fleetSchema 2: packs (docs/02, On-board power)
  const crew = r.rovers.find((x: any) => x.site === r.b);
  expect(crew.trip.site).toBe(r.b);
  expect(crew.trip.t).toBeGreaterThanOrEqual(crew.trip.dur);
  // the one free is parked at its dock
  expect(r.rovers.every((x: any) => x.x !== undefined && x.trip)).toBe(true);
  expect(r.c2).toBeLessThan(r.c1);
  expect(r.why).toBe('building');
});
