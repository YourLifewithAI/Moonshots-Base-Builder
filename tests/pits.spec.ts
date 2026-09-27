/** Strip-mine pits (docs/17 Phase 3, §8, §11, §21): the height-delta grid,
 *  carving, heaps, ramps, the no-dig and no-build masks, step 4.2, saving,
 *  the chunk rebuild queue, and every terrain reader on the new ground.
 *  Pits follow today's hauling: an excavator's dig carves a pit at its dig
 *  site (core/pits.ts onDig), and the debug `pitDig` calls the same adapter.
 *  The player's rule: pits grow away from buildings, never toward them. */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

const URL_DEBUG = '/?debug&seed=42&nolock&lowfx&site=mare&exp=robotic';
/** data/balance.ts PIT: t per m³ in place, the heap's share, rings no pit digs near */
const T_PER_M3 = 1.5, HEAP = (0.7 * 1.5) / 1.3, PAD_RINGS = 3, ROAD_RINGS = 2;

async function start(page: Page, style = '') {
  await page.goto(`${URL_DEBUG}${style ? `&style=${style}` : ''}`);
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => {
    const g = window.__game;
    g.setPaused(true);
    g.advanceGameSeconds(0);
    g.holdHazards(true);
    g.grantResources({ metals: 20000, parts: 20000 });
  });
  await page.evaluate(HELPERS);
}

declare const P: any;
const HELPERS = `(() => {
const g = () => window.__game;
const N = 257;
window.P = {
  /** a structure near world (x, z): the first valid cell and rotation outward; its id */
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
  /** game-minutes of play: power topped up, the stock emptied (an excavator never waits full) */
  run(minutes) {
    for (let i = 0; i < minutes; i++) {
      g().grantPower(5000);
      const reg = g().getState().resources.regolith;
      if (reg > 0) g().grantResources({ regolith: -reg });
      g().advanceGameSeconds(60);
    }
  },
  /** t of regolith dug at (x, z), in steps, the economy running between (step 4.2 carves) */
  dig(x, z, tonnes, steps = 20) {
    for (let i = 0; i < steps; i++) { g().pitDig(x, z, tonnes / steps); g().advanceGameSeconds(12); }
  },
  /** an excavator on the guaranteed high-Ti basalt (it digs its own pad) */
  excavator() {
    const z = g().getZones().find((z) => z.kind === 'ilmenite');
    const id = P.place('excavator', z.cx, z.cz, 6);
    g().finishConstruction();
    return id;
  },
  /** the delta grid (dm) and heights over a sample box */
  grid(x0, z0, x1, z1) {
    const d = [], h = [];
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      const t = g().terrainSample(ix, iz);
      d.push(t.delta); h.push(t.h);
    }
    return { x0, z0, w: x1 - x0 + 1, h: z1 - z0 + 1, d, hs: h };
  },
  /** every sample a pit or heap changed */
  carved() {
    const out = [];
    for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
      const t = g().terrainSample(ix, iz);
      if (t.delta !== 0) out.push([ix, iz, t.delta]);
    }
    return out;
  },
  /** sample-index footprints of every structure */
  pads() {
    return g().getState().buildings.map((b) => {
      const f = g().footprintOf(b.id);
      return { id: b.id, type: b.type, gx0: Math.round((f.x0 + 512) / 4), gz0: Math.round((f.z0 + 512) / 4), gx1: Math.round((f.x1 + 512) / 4), gz1: Math.round((f.z1 + 512) / 4) };
    });
  },
  /** heights under every pad and its two-sample skirt */
  footings() {
    const out = {};
    for (const p of P.pads()) {
      const hs = [];
      for (let iz = p.gz0 - 2; iz <= p.gz1 + 2; iz++) for (let ix = p.gx0 - 2; ix <= p.gx1 + 2; ix++) hs.push(g().terrainSample(ix, iz).h);
      out[p.id] = hs;
    }
    return out;
  },
  /** what the pits changed within 'rings' samples of each structure and road cell */
  intrusions(carved, padRings, roadRings) {
    const bad = [];
    const set = new Map(carved.map(([x, z, d]) => [z * N + x, d]));
    const near = (x0, z0, x1, z1, what) => {
      for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) if (set.has(iz * N + ix)) bad.push(what + ' @' + ix + ',' + iz);
    };
    for (const p of P.pads()) near(p.gx0 - padRings, p.gz0 - padRings, p.gx1 + padRings, p.gz1 + padRings, p.type + '#' + p.id);
    for (const c of g().getState().roads) near(c.gx - roadRings, c.gz - roadRings, c.gx + 1 + roadRings, c.gz + 1 + roadRings, 'road ' + c.gx + ',' + c.gz);
    return bad;
  },
};
})()`;

test('a dig carves a pit of the volume dug: 1:2 walls in 2 m benches, a ramp, and a heap of 0.81× beside it', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const id = P.excavator();
    P.run(60);
    const s = g.getState();
    const b = s.buildings.find((x: any) => x.id === id);
    const all = g.getPits();
    const p = all.pits[0];
    const grid = P.grid(p.box[0] - 1, p.box[1] - 1, p.box[2] + 1, p.box[3] + 1);
    return { p, n: all.pits.length, cutGrid: all.cutM3, heapGrid: all.heapM3, produced: s.stats.produced.regolith, bucket: b.haul.cargo.regolith ?? 0, grid };
  });
  expect(r.n).toBe(1);
  const p = r.p;
  // the adapter: every tonne the excavator dug went into its pit (credited, or in its bucket now)
  expect(p.tonnes).toBeGreaterThan(3000);
  expect(Math.abs(p.tonnes - (r.produced + r.bucket)) / p.tonnes).toBeLessThan(0.002);
  // the volume: ▲ ÷ 1.5 t/m³, cut in batches (never more than was dug; the rest carries over)
  expect(p.dugM3).toBeCloseTo(p.tonnes / T_PER_M3, 3);
  expect(p.cutM3).toBeLessThanOrEqual(p.dugM3 + 1e-6);
  expect(p.cutM3).toBeGreaterThan(p.dugM3 * 0.93);
  // the grid holds exactly what the pit says it cut, and its heap
  expect(r.cutGrid).toBeCloseTo(p.cutM3, 3);
  expect(r.heapGrid).toBeCloseTo(p.heapM3, 3);
  expect(p.heapM3 / p.cutM3).toBeGreaterThan(HEAP * 0.97);
  expect(p.heapM3 / p.cutM3).toBeLessThan(HEAP * 1.001);
  // it opened beside the pad it digs (not under it), and dug down to its floor
  expect(p.state).toBe('open');
  expect(p.rimFromKey).toBeGreaterThan(8);
  expect(p.deep).toBeCloseTo(p.L, 5);
  const { d, w } = r.grid;
  const at = (x: number, z: number) => d[z * w + x];
  let steps = 0, worstWall = 0, worstHeap = 0, benchCut = 0, ramped = 0, cut = 0, heapTop = 0;
  for (let z = 0; z < r.grid.h; z++) for (let x = 0; x < w; x++) {
    const v = at(x, z);
    if (v < 0) {
      cut++;
      const depth = -v;
      if (depth % 20 === 0 || depth === Math.round(p.L * 10)) benchCut++; else ramped++;
    }
    if (v > 0) heapTop = Math.max(heapTop, v);
    for (const [dx, dz] of [[1, 0], [0, 1]]) {
      if (x + dx >= w || z + dz >= r.grid.h) continue;
      const u = at(x + dx, z + dz);
      if (v <= 0 && u <= 0 && (v < 0 || u < 0)) { steps++; worstWall = Math.max(worstWall, Math.abs(u - v)); }
      if (v >= 0 && u >= 0 && (v > 0 || u > 0)) worstHeap = Math.max(worstHeap, Math.abs(u - v));
    }
  }
  expect(steps).toBeGreaterThan(40);
  // 1:2 walls: never more than one 2 m bench between samples 4 m apart
  expect(worstWall).toBeLessThanOrEqual(20);
  // the walls are benches (2 m steps, the floor at the loose layer); the ramp's 1:4 between them
  expect(benchCut / cut).toBeGreaterThan(0.7);
  expect(ramped).toBeGreaterThan(0);
  expect(p.A).toBeGreaterThan(0);
  // the heap: flat-topped at most 6 m, sides at the angle of repose (2.8 m in 4)
  expect(heapTop).toBeLessThanOrEqual(60);
  expect(worstHeap).toBeLessThanOrEqual(29);
});

test('a pit never digs within its setback: 12 m of a structure, 8 m of a road, door, bay or the apron; no footing moves', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page);
  const r = await page.evaluate(([pr, rr]) => {
    const g = window.__game;
    const z = g.getZones().find((z: any) => z.kind === 'ilmenite');
    // structures round the deposit before the digging starts
    for (const [dx, dz] of [[34, 0], [-34, 0], [0, 36], [0, -36]]) P.place('solar', z.cx + dx, z.cz + dz, 4);
    P.excavator();
    const before = P.footings();
    P.run(90);
    const carved = P.carved();
    const after = P.footings();
    const moved = Object.keys(before).filter((id) => before[id].some((h: number, i: number) => h !== after[id][i]));
    return { carved: carved.length, bad: P.intrusions(carved, pr, rr), moved, pads: P.pads().length, pits: g.getPits().pits };
  }, [PAD_RINGS, ROAD_RINGS]);
  expect(r.pads).toBeGreaterThanOrEqual(4);
  expect(r.carved).toBeGreaterThan(80);
  expect(r.bad).toEqual([]);
  // the pit never undermines a structure: every pad and its skirt stand exactly as they were
  expect(r.moved).toEqual([]);
});

test('a pit grows away from a building: its free side widens and its centre drifts away', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    // a structure 40 m west of the Lander; the pit's dig 22 m past it, further out
    const id = P.place('lab', -40, 4, 4, [1]);
    g.finishConstruction();
    const f = g.footprintOf(id);
    const gx = -62, gz = 4;
    P.dig(gx, gz, 9000, 30);
    const pit = g.getPits().pits[0];
    const carved = P.carved().filter(([, , d]: number[]) => d < 0);
    const xs = carved.map(([x]: number[]) => x * 4 - 512);
    return { f, pit, minX: Math.min(...xs), maxX: Math.max(...xs), bad: P.intrusions(P.carved(), 3, 2) };
  });
  const p = r.pit;
  expect(p.cutM3).toBeGreaterThan(5000);
  // it opened on the free side of the building, past its setback
  expect(p.ox).toBeLessThan(r.f.x0 - 12);
  // the centre drifted away from the building (west), and it widened that way
  expect(p.cx).toBeLessThan(p.ox - 3);
  expect(p.ox - r.minX).toBeGreaterThan(r.maxX - p.ox);
  // and never toward it: nothing dug within 12 m of its walls
  expect(r.maxX).toBeLessThan(r.f.x0 - 12 + 0.01);
  expect(r.bad).toEqual([]);
});

test('a building placed later near a pit stops its growth toward it from then on', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const gx = -52, gz = -20;
    P.dig(gx, gz, 3000, 12);
    const pit = g.getPits().pits[0];
    // the first spot east of the pit where a lab may stand (4 m back from the rim)
    const carved0 = P.carved().filter(([, , d]: number[]) => d < 0);
    const east = Math.max(...carved0.map(([x]: number[]) => x));
    let id = null;
    for (let x = east; x < east + 12 && id === null; x++) {
      for (let dz = -3; dz <= 3 && id === null; dz++) {
        const cz = Math.round((pit.cz + 512) / 4) + dz;
        for (const rot of [0, 1, 2, 3]) if (g.placeBuilding('lab', x, cz, rot)) { id = g.getState().buildings.at(-1).id; break; }
      }
    }
    const pad = P.pads().find((p: any) => p.id === id);
    const near = (list: number[][]) => list.filter(([x, z]) => x >= pad.gx0 - 3 && x <= pad.gx1 + 3 && z >= pad.gz0 - 3 && z <= pad.gz1 + 3)
      .map(([x, z, d]) => `${x},${z}:${d}`).sort();
    const before = near(P.carved());
    const footing = P.footings()[id];
    P.dig(gx, gz, 9000, 30);
    const after = near(P.carved());
    return { id, before, after, footing, footingAfter: P.footings()[id], pit: g.getPits().pits[0], east, eastAfter: Math.max(...P.carved().filter(([, , d]: number[]) => d < 0).map(([x]: number[]) => x)) };
  });
  expect(r.id).not.toBeNull();
  expect(r.pit.cutM3).toBeGreaterThan(7000);
  // within its setback nothing was dug after it stood (what was there stays, never deeper)
  expect(r.after).toEqual(r.before);
  expect(r.footingAfter).toEqual(r.footing);
  // the pit went on growing — elsewhere
  expect(r.pit.cx).toBeLessThan(-52);
});

test('placement near and on a pit is refused with the words; grading refuses a pit and levels a heap', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.completeTech('siteGrading');
    P.dig(-50, 10, 6000, 20);
    const pit = g.getPits().pits[0];
    const [x0, z0, x1, z1] = pit.box;
    const words = new Set<string>();
    const wrong: string[] = [];
    const grid = P.grid(x0 - 4, z0 - 4, x1 + 4, z1 + 4);
    const d = (ix: number, iz: number) => grid.d[(iz - grid.z0) * grid.w + ix - grid.x0] ?? 0;
    for (let gz = z0 - 3; gz <= z1 + 1; gz++) for (let gx = x0 - 3; gx <= x1 + 1; gx++) {
      const c = g.canPlace('solar', gx, gz, 0);
      const reason = String(c.reason);
      const head = reason.split(' — ')[0];
      if (['ON A PIT', 'ON SPOIL', 'TOO CLOSE TO A PIT'].includes(head)) words.add(reason);
      let cut = false, spoil = false, near = false;
      for (let iz = gz - 1; iz <= gz + 3; iz++) for (let ix = gx - 1; ix <= gx + 3; ix++) {
        const inside = ix >= gx && ix <= gx + 2 && iz >= gz && iz <= gz + 2;
        const v = d(ix, iz);
        if (inside && v < 0) cut = true;
        if (inside && v > 0) spoil = true;
        if (!inside && v < 0) near = true;
      }
      if (cut && head !== 'ON A PIT') wrong.push(`${gx},${gz} cut: ${reason}`);
      if (!cut && spoil && head !== 'ON SPOIL' && reason) wrong.push(`${gx},${gz} spoil: ${reason}`);
      if (!cut && !spoil && near && head !== 'TOO CLOSE TO A PIT') wrong.push(`${gx},${gz} near: ${reason}`);
      if (c.valid && (cut || spoil || near)) wrong.push(`${gx},${gz} valid`);
    }
    // grading: over the pit, refused; over the heap, it levels the spoil (and costs more)
    const cx = Math.round((pit.cx + 512) / 4) - 2, cz = Math.round((pit.cz + 512) / 4) - 2;
    const gradePit = g.canGrade(cx, cz);
    const hx = Math.round((pit.heap.x + 512) / 4) - 2, hz = Math.round((pit.heap.z + 512) / 4) - 2;
    const gradeHeap = g.canGrade(hx, hz);
    g.grantPower(5000);
    const e0 = g.getState().powerStored;
    const relief0 = g.terrainRelief(hx, hz, hx + 4, hz + 4);
    g.gradeAt(hx, hz);
    g.advanceGameSeconds(0);
    const spent = e0 - g.getState().powerStored;
    const relief1 = g.terrainRelief(hx, hz, hx + 4, hz + 4);
    g.gradeAt(cx, cz);
    g.advanceGameSeconds(0);
    const alerts = g.getState().alerts.map((a: any) => a.text);
    return { words: [...words], wrong, gradePit, gradeHeap, spent, relief0, relief1, alerts, deep: pit.deep };
  });
  expect(r.wrong).toEqual([]);
  const heads = r.words.map((w: string) => w.split(' — ')[0]);
  expect(heads).toContain('ON A PIT');
  expect(heads).toContain('ON SPOIL');
  expect(heads).toContain('TOO CLOSE TO A PIT');
  expect(r.words).toContain(`ON A PIT — its benches go ${r.deep.toFixed(1)} m down; build 4 m back from the rim`);
  expect(r.words).toContain('TOO CLOSE TO A PIT — nothing within 4 m of a rim; build 4 m back');
  expect(r.words).toContain('ON SPOIL — a tailings heap; level it with Site Grading, or build elsewhere');
  expect(r.gradePit.valid).toBe(false);
  expect(r.gradePit.reason).toMatch(/^a pit \([\d.]+ m deep\): grading cannot fill it; Reclaim it once it is worked out$/);
  expect(r.alerts.some((t: string) => t.startsWith('CANNOT GRADE — a pit'))).toBe(true);
  expect(r.gradeHeap.valid).toBe(true);
  expect(r.relief0).toBeGreaterThan(1);
  expect(r.relief1).toBeLessThan(0.01);
  expect(r.spent).toBeGreaterThan(40);
});

test('road A* routes round a pit and never crosses it; the road tool stops at its rim', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const gx = -46, gz = 30;
    P.dig(gx, gz, 7000, 20);
    const pit = g.getPits().pits[0];
    const s0 = g.getState();
    const open = s0.roads.filter((c: any) => c.left <= 0 && !c.bay && !c.closed);
    // from the open road cell nearest the pit to a cell on its far side, and to one inside it
    const pcx = Math.floor((pit.cx + 512) / 4), pcz = Math.floor((pit.cz + 512) / 4);
    open.sort((a: any, b: any) => Math.hypot(a.gx - pcx, a.gz - pcz) - Math.hypot(b.gx - pcx, b.gz - pcz));
    const from = [open[0].gx, open[0].gz];
    const far = [pcx - (from[0] - pcx), pcz - (from[1] - pcz)];
    const n0 = s0.roads.length;
    g.layRoad(from, far);
    g.advanceGameSeconds(0);
    const s1 = g.getState();
    const fresh = s1.roads.slice(n0);
    const onPit = fresh.filter((c: any) => [[0, 0], [1, 0], [0, 1], [1, 1]].some(([dx, dz]) => g.terrainSample(c.gx + dx, c.gz + dz).delta !== 0));
    g.layRoad(from, [pcx, pcz]);
    g.advanceGameSeconds(0);
    const alerts = g.getState().alerts.map((a: any) => a.text);
    const zone = g.getZones().find((z: any) => z.id === `pit-${pit.id}`);
    return { fresh: fresh.length, onPit: onPit.length, last: fresh.at(-1), far, alerts, zone, cutCells: P.carved().length };
  });
  // a road was laid to the far side, all of it off the pit and its heap
  expect(r.fresh).toBeGreaterThan(8);
  expect([r.last.gx, r.last.gz]).toEqual(r.far);
  expect(r.onPit).toBe(0);
  // into the pit: no route
  expect(r.alerts.some((t: string) => t.startsWith('CANNOT LAY ROAD — NO ROAD ROUTE'))).toBe(true);
  // the pit is an extraction zone of its own: its cut and a cell round it
  expect(r.zone).toBeTruthy();
  expect(r.zone.kind).toBe('pit');
  expect(r.zone.cells.length).toBeGreaterThan(20);
});

test('determinism: the same seed and the same actions give the same delta grid', async ({ page, browser }) => {
  test.setTimeout(300_000);
  const once = async (p: Page) => {
    await start(p);
    return p.evaluate(() => {
      P.excavator();
      P.run(40);
      P.dig(-60, -30, 4000, 10);
      const all = window.__game.getPits();
      return { delta: all.delta, pits: all.pits, rev: all.rev, zones: window.__game.getZones() };
    });
  };
  const a = await once(page);
  const other = await browser.newPage();
  const b = await once(other);
  await other.close();
  expect(a.pits.length).toBe(2);
  expect(a.delta.length).toBeGreaterThan(100);
  expect(b.delta).toBe(a.delta);
  expect(b.pits).toEqual(a.pits);
  expect(b.zones).toEqual(a.zones);
});

test('save and reload restore the ground exactly (base → deltas → flattens); an old save starts clean', async ({ page, browser }) => {
  test.setTimeout(300_000);
  await start(page);
  const a = await page.evaluate(() => {
    const g = window.__game;
    P.excavator();
    P.run(30);
    P.dig(-60, -30, 3000, 10);
    // a pad placed beside a pit after it was cut: its skirt keeps clear of the cut
    const pit = g.getPits().pits[1];
    P.place('solar', pit.cx + pit.R + 10, pit.cz, 4);
    g.finishConstruction();
    const blob = g.saveBlob();
    const hash = g.terrainHash();
    const view = g.getPits();
    // go on digging: the reloaded game must carve the same
    P.dig(-60, -30, 3000, 10);
    P.run(10);
    return { blob, hash, pits: view.pits, delta: view.delta, zones: g.getZones(), bytes: JSON.stringify(blob).length, later: g.getPits().delta, laterHash: g.terrainHash() };
  });
  expect(a.blob.state.terrain.delta).toBe(a.delta);
  expect(a.blob.state.terrainSchema).toBe(1);
  // the save leaves the pits' zones out: they come back from the grid
  expect(a.blob.state.zones.some((z: any) => z.kind === 'pit')).toBe(false);
  const other = await browser.newPage();
  await start(other);
  const b = await other.evaluate((blob) => {
    const g = window.__game;
    g.loadBlob(blob);
    g.holdHazards(true);
    const hash = g.terrainHash();
    const view = g.getPits();
    const zones = g.getZones();
    P.dig(-60, -30, 3000, 10);
    P.run(10);
    return { hash, pits: view.pits, delta: view.delta, zones, later: g.getPits().delta, laterHash: g.terrainHash() };
  }, a.blob);
  expect(b.hash).toBe(a.hash);
  expect(b.delta).toBe(a.delta);
  expect(b.pits).toEqual(a.pits);
  expect(b.zones).toEqual(a.zones);
  expect(b.later).toBe(a.later);
  expect(b.laterHash).toBe(a.laterHash);
  // an old save (no pits, no grid): nothing is carved on load
  const old = JSON.parse(JSON.stringify(a.blob));
  delete old.state.pits; delete old.state.nextPitId; delete old.state.terrain; delete old.state.terrainSchema;
  const c = await other.evaluate((blob) => {
    const g = window.__game;
    g.loadBlob(blob);
    const v = g.getPits();
    return { pits: v.pits.length, nonzero: v.nonzero, schema: g.getState().terrainSchema };
  }, old);
  await other.close();
  expect(c).toEqual({ pits: 0, nonzero: 0, schema: 1 });
});

test('chunk rebuilds are throttled: one a frame, two a second, shadows at most every 2 s', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    // three pits far apart: several chunks to rebuild
    for (const [x, z] of [[-200, -150], [200, -160], [-180, 190]]) g.pitDig(x, z, 3000);
    g.advanceGameSeconds(40);
    const q0 = g.getPits().queue;
    g.stepFrame(0.1);
    const q1 = g.getPits().queue;
    const per: number[] = [];
    let last = q1.rebuilds;
    for (let i = 0; i < 120; i++) {
      g.stepFrame(0.1);
      const q = g.getPits().queue;
      per.push(q.rebuilds - last);
      last = q.rebuilds;
    }
    const q2 = g.getPits().queue;
    return { q0, q1, q2, per, pits: g.getPits().pits.map((p: any) => p.cutM3) };
  });
  expect(r.pits.every((v: number) => v > 1500)).toBe(true);
  // the carves are queued, not rebuilt in the sim tick
  expect(r.q0.rebuilds).toBe(0);
  expect(r.q1.queued).toBeGreaterThanOrEqual(3);
  // never more than one a frame
  expect(Math.max(...r.per)).toBeLessThanOrEqual(1);
  // two a second at most: rebuilds at least 0.5 s of frame time apart
  const log = r.q2.log;
  for (let i = 1; i < log.length; i++) expect(log[i] - log[i - 1]).toBeGreaterThan(0.5 - 1e-6);
  // all of it drawn in the end, each chunk once
  expect(r.q2.queued).toBe(0);
  expect(r.q2.rebuilds).toBe(r.q1.queued + r.q1.rebuilds);
  // the shadow map asked at most every 2 s of frame time
  expect(r.q2.shadowAsks).toBeLessThanOrEqual(Math.ceil(r.q2.clock / 2) + 1);
  expect(r.q2.shadowAsks).toBeGreaterThan(0);
});

for (const style of ['classic', 'detailed']) {
  test(`both render styles draw the pit (${style}): the mesh follows the cut, and the cut is brighter`, async ({ page }) => {
    test.setTimeout(240_000);
    await start(page, style === 'detailed' ? 'detailed' : '');
    const r = await page.evaluate(() => {
      const g = window.__game;
      const x = -60, z = 20;
      const box = [Math.round((x - 60 + 512) / 4), Math.round((z - 60 + 512) / 4), Math.round((x + 60 + 512) / 4), Math.round((z + 60 + 512) / 4)];
      const lum = (ix: number, iz: number) => { const c = g.terrainColorAt(ix * 4 - 512, iz * 4 - 512); return c ? c[0] + c[1] + c[2] : NaN; };
      const before = new Map<number, number>();
      for (let iz = box[1]; iz <= box[3]; iz++) for (let ix = box[0]; ix <= box[2]; ix++) before.set(iz * 257 + ix, lum(ix, iz));
      P.dig(x, z, 5000, 12);
      for (let i = 0; i < 80 && g.getPits().queue.queued > 0; i++) g.stepFrame(0.5);
      const ratios: number[] = [];
      for (let iz = box[1]; iz <= box[3]; iz++) for (let ix = box[0]; ix <= box[2]; ix++) {
        const t = g.terrainSample(ix, iz);
        if (t.delta <= -20) ratios.push(lum(ix, iz) / before.get(iz * 257 + ix)!);
      }
      ratios.sort((a, b) => a - b);
      return { style: g.getRenderInfo().style, err: g.terrainError(), n: ratios.length, median: ratios[Math.floor(ratios.length / 2)], queue: g.getPits().queue };
    });
    expect(r.style).toBe(style === 'detailed' ? 'detailed' : 'classic');
    expect(r.queue.queued).toBe(0);
    expect(r.n).toBeGreaterThan(20);
    // the drawn ground is the carved ground
    expect(r.err.vertex).toBeLessThan(0.01);
    // fresh regolith: brighter than the weathered ground it was cut from
    expect(r.median).toBeGreaterThan(1.1);
    await page.screenshot({ path: `test-results/pits-${style}.png` });
  });
}
