/** Extraction zones (core/zones.ts, docs/15 §5a): auto roads stop at a
 *  zone's rim, at a gate; inside, excavators and rovers drive off-road, at
 *  ROAD.offroad of road speed, for work in that zone only. A haul trip is
 *  timed by its road and its off-road legs; a building inside a zone is
 *  built by a rover that drove in from the gate; two diggers in one zone
 *  keep apart; an old save keeps its roads. */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

const URL_DEBUG = '/?debug&seed=42';
/** tolerance on "bodies never overlap", m */
const TOL = 0.05;
/** data/balance.ts HAUL.speed, data/roads.ts ROAD.offroad */
const HAUL_V = 5, OFFROAD = 0.5;

async function start(page: Page, style = '') {
  await page.goto(`${URL_DEBUG}&site=mare&exp=robotic${style ? `&style=${style}` : ''}`);
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
  await page.evaluate(HELPERS);
}

declare function zone(): { id: string; cx: number; cz: number; r: number; cells: [number, number][]; gates: [number, number][] };
declare function inZone(gx: number, gz: number): boolean;
declare function place(type: string, x: number, z: number, where: 'in' | 'out'): number | null;
declare function drive(frames: number, watch?: (i: number) => boolean | void): { frames: number; worst: number; pair: string; offroad: string[]; rescues: number };
const HELPERS = `(() => {
const g = () => window.__game;
// the guaranteed high-Ti basalt patch, 30–50 m from the Lander: mapped at landing
window.zone = () => g().getZones().find((z) => z.kind === 'ilmenite');
window.inZone = (gx, gz) => { const z = zone(); return Math.hypot((gx + 0.5) * 4 - 512 - z.cx, (gz + 0.5) * 4 - 512 - z.cz) <= z.r; };
// a structure placed near (x, z) m with its footprint and door wholly inside the zone, or wholly outside it
window.place = (type, x, z, where) => {
  const c = { gx: Math.round((x + 512) / 4), gz: Math.round((z + 512) / 4) };
  const ids = new Set(g().getState().buildings.map((b) => b.id));
  for (let r = 0; r < 18; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    for (const rot of [0, 1, 2, 3]) {
      const gx = c.gx + dx, gz = c.gz + dz;
      if (!g().canPlace(type, gx, gz, rot).valid) continue;
      const cells = [];
      for (let i = -1; i <= 3; i++) for (let k = -1; k <= 3; k++) cells.push([gx + i, gz + k]);
      const all = cells.every(([a, b]) => inZone(a, b) === (where === 'in'));
      if (!all || !g().placeBuilding(type, gx, gz, rot)) continue;
      return g().getState().buildings.find((b) => !ids.has(b.id)).id;
    }
  }
  return null;
};
// live frames at 10× (a game-second each), power topped up, the store emptied: the closest pair of
// bodies, and any unit whose origin is off the open road outside a zone (a digger on its pad excepted)
window.drive = (frames, watch) => {
  const G = g();
  G.setPaused(false); G.setSpeed(10); G.stepFrame(0); G.getRenderInfo();
  const zc = new Set(G.getZones().flatMap((z) => z.cells.map(([x, k]) => k * 256 + x)));
  let worst = Infinity, pair = '', i = 0, T = null;
  const offroad = [];
  for (; i < frames; i++) {
    if (i % 10 === 0) { G.grantPower(50000); const reg = G.getState().resources.regolith; if (reg > 0) G.grantResources({ regolith: -reg }); }
    G.stepFrame(0.1);
    T = G.getRenderInfo().life.traffic;
    if (T.closest && T.closest.gap < worst) { worst = T.closest.gap; pair = T.closest.a + '/' + T.closest.b + ' @' + i; }
    const st = G.getState();
    const open = new Set(st.roads.filter((x) => x.left <= 0).map((x) => x.gz * 256 + x.gx));
    for (const u of T.units) {
      const k = Math.floor((u.z + 512) / 4) * 256 + Math.floor((u.x + 512) / 4);
      if (open.has(k) || zc.has(k)) continue;
      if (u.kind === 'digger') {
        const fp = G.footprintOf(u.id);
        if (fp && u.x >= fp.x0 - 0.01 && u.x <= fp.x1 + 0.01 && u.z >= fp.z0 - 0.01 && u.z <= fp.z1 + 0.01) continue;
      }
      if (offroad.length < 10) offroad.push(u.kind + '#' + u.id + ' at ' + u.x + ',' + u.z + ' @' + i);
    }
    if (watch && watch(i)) { i++; break; }
  }
  G.setPaused(true); G.stepFrame(0);
  return { frames: i, worst, pair, offroad, rescues: T ? T.rescues : 0 };
};
})()`;

/** An excavator outside the zone digging at its middle, its haul road open: its id and legs. */
async function digInZone(page: Page) {
  return page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ metals: 3000, parts: 3000 });
    const z = zone();
    const a = Math.atan2(z.cz, z.cx + 2);
    const id = place('excavator', z.cx + Math.cos(a) * (z.r + 16), z.cz + Math.sin(a) * (z.r + 16), 'out');
    g.finishConstruction();
    g.digAt(id, z.cx, z.cz);
    g.advanceGameSeconds(0);
    const s = g.getState();
    const jobs = s.roadJobs.map((j: any) => j.cells);
    g.finishRoads();
    return { id, jobs, roads: s.roads.map((c: any) => [c.gx, c.gz]), zone: zone(), dig: s.buildings.find((b: any) => b.id === id).haul };
  });
}

test('an auto road never runs inside an extraction zone: a haul road stops at the rim, at a gate', async ({ page }) => {
  await start(page);
  const r = await digInZone(page);
  expect(r.id).not.toBeNull();
  const inside = (c: [number, number]) => r.zone.cells.some(([x, z]: [number, number]) => x === c[0] && z === c[1]);
  // no road cell inside the zone, drawn or planned
  expect(r.roads.filter(inside)).toEqual([]);
  // the dig is off the road, in the middle of the zone
  expect(Math.hypot(r.dig.digX - r.zone.cx, r.dig.digZ - r.zone.cz)).toBeLessThan(3);
  // the zone has a gate: a road cell on its rim; any haul road laid ends at one
  const z = await page.evaluate(() => zone());
  expect(z.gates.length).toBeGreaterThan(0);
  for (const cells of r.jobs) {
    const k = cells[cells.length - 1];
    const [gx, gz] = [k % 256, Math.floor(k / 256)];
    expect([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => inside([gx + dx, gz + dz]))).toBe(true);
  }
});

test('the excavator drives off-road only inside the zone, and its trip is timed by the road and the off-road legs', async ({ page }) => {
  test.setTimeout(180_000);
  await start(page);
  const setup = await digInZone(page);
  const legs = await page.evaluate(({ id }) => {
    const g = window.__game!;
    const zc = new Set(zone().cells.map(([x, z]: [number, number]) => z * 256 + x));
    const out: { dur: number; road: number; off: number; bad: string[]; dug: boolean }[] = [];
    let leg: any = null, dug = false;
    for (let t = 0; t < 1500 && out.length < 3; t++) {
      g.grantPower(1000);
      const reg = g.getState().resources.regolith;
      if (reg > 0) g.grantResources({ regolith: -reg });
      g.advanceGameSeconds(1);
      const st = g.getState();
      const h = st.buildings.find((b: any) => b.id === id).haul;
      if (h.phase === 'dig' && Math.hypot(h.x - h.digX, h.z - h.digZ) < 0.5) dug = true;
      if (h.phase === 'toDrop' && !leg && dug && h.route && st.simTime % 720 < 480 - 60) {
        // the leg's metres: on the road, and off it (segments weighed 1 / ROAD.offroad)
        let road = 0, off = 0;
        const bad: string[] = [];
        const open = new Set(st.roads.filter((c: any) => c.left <= 0).map((c: any) => c.gz * 256 + c.gx));
        for (let i = 1; i < h.route.length; i++) {
          const [ax, az] = h.route[i - 1], [bx, bz] = h.route[i];
          const l = Math.hypot(bx - ax, bz - az);
          const w = h.w?.[i - 1] ?? 1;
          if (w > 1) off += l; else road += l;
          // an off-road segment lies inside the zone: its ends and middle
          if (w > 1) for (const f of [0, 0.5, 1]) {
            const x = ax + (bx - ax) * f, z = az + (bz - az) * f;
            const k = Math.floor((z + 512) / 4) * 256 + Math.floor((x + 512) / 4);
            if (!zc.has(k) && !open.has(k)) bad.push(`${x.toFixed(1)},${z.toFixed(1)}`);
          }
        }
        leg = { t0: st.simTime, road, off, bad, dug };
      }
      if (leg && h.phase !== 'toDrop') { out.push({ dur: st.simTime - leg.t0, road: leg.road, off: leg.off, bad: leg.bad, dug: leg.dug }); leg = null; }
    }
    return out;
  }, setup);
  expect(legs.length).toBeGreaterThan(0);
  for (const l of legs) {
    expect(l.bad).toEqual([]);
    expect(l.off, 'an off-road leg in the zone').toBeGreaterThan(8);
    // the road at haul speed, off-road at half that: within a tick
    const want = l.road / HAUL_V + l.off / (HAUL_V * OFFROAD);
    expect(Math.abs(l.dur - want)).toBeLessThanOrEqual(1.5);
    expect(l.dur).toBeGreaterThan((l.road + l.off) / HAUL_V + l.off / HAUL_V - 1.5);
  }
  // and live: the digger's body keeps to the road outside the zone
  const r = await page.evaluate(() => drive(240));
  expect(r.offroad).toEqual([]);
  expect(r.worst, `closest pair ${r.pair}`).toBeGreaterThan(-TOL);
});

for (const style of ['cel']) {
  test(`${style}: a building inside a zone: its road stops at the rim, and its rover drives in off-road from the gate to build it`, async ({ page }) => {
    test.setTimeout(180_000);
    await start(page);
    const r = await page.evaluate(() => {
      const g = window.__game!;
      g.grantResources({ metals: 3000, parts: 3000 });
      const z = zone();
      const id = place('lab', z.cx, z.cz, 'in');
      const s = g.getState();
      const b = s.buildings.find((x: any) => x.id === id);
      return { id, spur: b?.spur ?? [], total: b?.buildTotal };
    });
    expect(r.id).not.toBeNull();
    // no cell of its road inside the zone; its last on the rim
    const cells = r.spur.map((k: number) => [k % 256, Math.floor(k / 256)]);
    const flags = await page.evaluate((cells) => cells.map(([x, z]: [number, number]) => inZone(x, z)), cells);
    expect(flags.every((f: boolean) => !f)).toBe(true);
    // live: its road sintered, then the rover drives off-road to its door and welds
    const out = await page.evaluate(({ id, total }) => {
      const g = window.__game!;
      let at: any = null;
      const res = drive(600, () => {
        const s = g.getState();
        const b = s.buildings.find((x: any) => x.id === id);
        if (b.construction >= total) return false;
        const u = s.rovers.find((x: any) => x.site === id);
        const life = g.getRenderInfo().life.rovers;
        const k = life.ids.indexOf(u.id);
        const open = new Set(s.roads.filter((c: any) => c.left <= 0).map((c: any) => c.gz * 256 + c.gx));
        const cell = [Math.floor((u.x + 512) / 4), Math.floor((u.z + 512) / 4)];
        at = {
          trip: u.trip, simIn: inZone(cell[0], cell[1]), onRoad: open.has(cell[1] * 256 + cell[0]),
          pos: life.positions[k], spot: life.spots[k], legs: life.legs[k], sim: [u.x, u.z],
        };
        return true;
      });
      return { ...res, at };
    }, r);
    expect(out.at, 'it was built').not.toBeNull();
    // it welds off the road, inside the zone, having driven off-road from the gate
    expect(out.at.trip.kind).toBe('weld');
    expect(out.at.simIn).toBe(true);
    expect(out.at.onRoad).toBe(false);
    expect((out.at.trip.w ?? []).some((w: number) => w > 1)).toBe(true);
    // and it is drawn there
    expect(out.at.legs).toBeLessThan(0.3);
    expect(Math.hypot(out.at.pos[0] - out.at.sim[0], out.at.pos[1] - out.at.sim[1])).toBeLessThan(0.5);
    expect(out.offroad).toEqual([]);
    expect(out.worst, `closest pair ${out.pair}`).toBeGreaterThan(-TOL);
  });
}

test('a dock is refused inside a zone: its rovers park on the road', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('constructionRobotics');
    g.grantResources({ metals: 3000, parts: 3000 });
    const z = zone();
    // every spot with the Bay's footprint and door wholly inside the zone says why
    const reasons = new Set<string>();
    const c = { gx: Math.round((z.cx + 512) / 4), gz: Math.round((z.cz + 512) / 4) };
    for (let dx = -3; dx <= 1; dx++) for (let dz = -3; dz <= 1; dz++) {
      const cells: [number, number][] = [];
      for (let i = -1; i <= 3; i++) for (let k = -1; k <= 3; k++) cells.push([c.gx + dx + i, c.gz + dz + k]);
      if (!cells.every(([a, b]) => inZone(a, b))) continue;
      reasons.add(g.canPlace('roboticsBay', c.gx + dx, c.gz + dz, 0).reason);
    }
    return [...reasons];
  });
  expect(r.length).toBeGreaterThan(0);
  for (const why of r) expect(why).toMatch(/^IN AN EXTRACTION ZONE — a dock parks its rovers on the road/);
});

test('two excavators digging one zone never overlap', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page);
  const ids = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ metals: 5000, parts: 5000 });
    const z = zone();
    const a = Math.atan2(z.cz, z.cx + 2);
    const one = place('excavator', z.cx + Math.cos(a) * (z.r + 16), z.cz + Math.sin(a) * (z.r + 16), 'out');
    const two = place('excavator', z.cx + Math.cos(a + 0.9) * (z.r + 16), z.cz + Math.sin(a + 0.9) * (z.r + 16), 'out');
    g.finishConstruction();
    // two spots 10 m apart in the zone
    g.digAt(one, z.cx - 5, z.cz);
    g.digAt(two, z.cx + 5, z.cz);
    g.advanceGameSeconds(0);
    g.finishRoads();
    return [one, two];
  });
  expect(ids.every(Boolean)).toBe(true);
  const p0 = await page.evaluate(() => window.__game.getState().stats.produced.regolith);
  const r = await page.evaluate(() => drive(700));
  const p1 = await page.evaluate(() => window.__game.getState().stats.produced.regolith);
  expect(r.worst, `closest pair ${r.pair}`).toBeGreaterThan(-TOL);
  expect(r.offroad).toEqual([]);
  expect(p1 - p0, 'both hauled').toBeGreaterThan(200);
});

test('an old save keeps its roads inside a zone (nothing stranded); the zones and their gates come back on load', async ({ page }) => {
  test.setTimeout(120_000);
  await start(page);
  const r = await page.evaluate(async () => {
    const g = window.__game!;
    g.grantResources({ metals: 3000, parts: 3000 });
    const z = zone();
    const id = place('excavator', z.cx, z.cz, 'in');
    g.finishConstruction();
    const blob = g.saveBlob();
    // a save from before roads (and zones): its roads are laid on load as they were, to every door
    delete blob.state.roads; delete blob.state.roadJobs; delete blob.state.roadRev; delete blob.state.roadSchema; delete blob.state.zones;
    for (const b of blob.state.buildings) delete b.spur;
    await g.loadBlob(blob);
    g.setPaused(true);
    const s = g.getState();
    const access = g.roadAccess().find((a: any) => a.id === id);
    const zc = new Set(zone().cells.map(([x, k]: [number, number]) => k * 256 + x));
    return {
      id, zones: s.zones.length, gates: zone().gates.length, access,
      inside: s.roads.filter((c: any) => zc.has(c.gz * 256 + c.gx)).length,
    };
  });
  expect(r.zones).toBeGreaterThan(0);
  // the old road into the zone, to the excavator's door, is kept: it stays linked
  expect(r.inside).toBeGreaterThan(0);
  expect(r.access.doorOpen).toBe(true);
  expect(r.access.linked).toBe(true);
  // and it still hauls
  const hauled = await page.evaluate(() => {
    const g = window.__game!;
    const p0 = g.getState().stats.produced.regolith;
    for (let t = 0; t < 200; t++) { g.grantPower(1000); const reg = g.getState().resources.regolith; if (reg > 0) g.grantResources({ regolith: -reg }); g.advanceGameSeconds(1); }
    return g.getState().stats.produced.regolith - p0;
  });
  expect(hauled).toBeGreaterThan(50);
});
