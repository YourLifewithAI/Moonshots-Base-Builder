/** Strip-mine pits (docs/17 Phase 3, §8, §11, §21): the height-delta grid,
 *  carving, heaps, ramps, the no-dig and no-build masks, step 4.2, saving,
 *  the chunk rebuild queue, and every terrain reader on the new ground.
 *  Hub units dig them (docs/17 Phases 1–2): a unit's dig grows its target's
 *  pit (core/hubs.ts dug → core/pits.ts digInto), a deposit's shared by every
 *  unit on it; the debug `pitDig` digs at a point (core/pits.ts onDig).
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
  /** game-minutes of play: power topped up, the stock emptied (a unit never waits at a full hopper) */
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
  /** a Regolith Smelter by the guaranteed high-Ti basalt, built: its excavator
   *  digs the deposit's pit (the hub's id). It stands its walls 12 m off the
   *  ring toward the Lander, as the Builder does: the pits' setback. */
  excavator() {
    const z = g().getZones().find((z) => z.kind === 'ilmenite');
    const l = Math.hypot(z.cx, z.cz) || 1;
    const out = z.r + 22;
    const id = P.place('smelter', z.cx - (z.cx / l) * out, z.cz - (z.cz / l) * out, 8);
    g().finishConstruction();
    return id;
  },
  /** the hub's units */
  units(hub) { return g().getState().haulers.filter((u) => u.hub === hub); },
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
  /** 8-connected pieces of the cut (sign -1) or of the spoil (sign 1) */
  pieces(carved, sign) {
    const set = new Set(carved.filter(([, , d]) => Math.sign(d) === sign).map(([x, z]) => z * N + x));
    let n = 0;
    const seen = new Set();
    for (const k of set) {
      if (seen.has(k)) continue;
      n++;
      const st = [k]; seen.add(k);
      while (st.length) {
        const c = st.pop(), x = c % N, z = Math.floor(c / N);
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const q = (z + dz) * N + x + dx;
          if (set.has(q) && !seen.has(q)) { seen.add(q); st.push(q); }
        }
      }
    }
    return n;
  },
  /** what the pits changed within 'rings' samples of each structure and road cell */
  intrusions(carved, padRings, roadRings) {
    const bad = [];
    const set = new Map(carved.map(([x, z, d]) => [z * N + x, d]));
    const near = (x0, z0, x1, z1, what) => {
      for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) if (set.has(iz * N + ix)) bad.push(what + ' @' + ix + ',' + iz);
    };
    for (const p of P.pads()) near(p.gx0 - padRings, p.gz0 - padRings, p.gx1 + padRings, p.gz1 + padRings, p.type + '#' + p.id);
    // a haul road's sacrificial tail (docs/19 S3) is the pit's to eat: no setback there
    for (const c of g().getState().roads) if (!c.sacrificial) near(c.gx - roadRings, c.gz - roadRings, c.gx + 1 + roadRings, c.gz + 1 + roadRings, 'road ' + c.gx + ',' + c.gz);
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
    const bucket = P.units(id).reduce((n: number, u: any) => n + (u.haul.cargo.regolith ?? 0), 0);
    const all = g.getPits();
    const p = all.pits[0];
    const z = g.getZones().find((z: any) => z.kind === 'ilmenite');
    const grid = P.grid(p.box[0] - 1, p.box[1] - 1, p.box[2] + 1, p.box[3] + 1);
    return {
      p, n: all.pits.length, cutGrid: all.cutM3, heapGrid: all.heapM3, produced: s.stats.produced.regolith, bucket, grid,
      depR: z.r, units: P.units(id).map((u: any) => u.target),
    };
  });
  expect(r.n).toBe(1);
  const p = r.p;
  // hub units: every tonne its excavator dug went into the deposit's pit (tipped, or in its bucket now)
  expect(r.units).toEqual([p.key]);
  expect(p.key).toMatch(/^dep:ilmenite-/);
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
  // it opened on its deposit, by its heart (no pad stands there now), and dug down to its floor
  expect(p.state).toBe('open');
  expect(p.rimFromKey).toBeLessThan(r.depR * 0.5);
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
  expect(worstWall).toBeLessThanOrEqual(21);
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
    // two excavators on the one deposit: its smelter's first and a second it prints
    const hub = P.excavator();
    g.queueUnit(hub);
    for (let i = 0; i < 8; i++) { g.grantPower(5000); g.advanceGameSeconds(10); }
    // both sent to it: a new pit has one face (docs/17 §8.2), so the second waits at
    // the gate until the pit's second bench opens, then digs beside the first
    for (const u of P.units(hub)) g.sendUnit(u.id, `dep:${z.id}`);
    const before = P.footings();
    // (its sacrificial road tail no longer boxes the pit in, docs/19 S3: it may dig the deposit out
    // in about 90 minutes and the units move on; stop at 50 and count who works it while it is)
    P.run(30);
    const diggers = g.getState().haulers.filter((u: any) => u.type === 'excavator' && u.target === `dep:${z.id}`).length;
    P.run(20);
    const carved = P.carved();
    const after = P.footings();
    const moved = Object.keys(before).filter((id) => before[id].some((h: number, i: number) => h !== after[id][i]));
    return {
      carved: carved.length, bad: P.intrusions(carved, pr, rr), moved, pads: P.pads().length, pits: g.getPits().pits,
      cutPieces: P.pieces(carved, -1), heapPieces: P.pieces(carved, 1),
      diggers,
    };
  }, [PAD_RINGS, ROAD_RINGS]);
  expect(r.pads).toBeGreaterThanOrEqual(4);
  expect(r.carved).toBeGreaterThan(80);
  expect(r.bad).toEqual([]);
  // the deposit's diggers share its pit; the pit is one hole, its heap one heap
  expect(r.diggers).toBe(2);
  expect(r.pits.length).toBe(1);
  expect(r.pits[0].key).toMatch(/^dep:ilmenite-/);
  expect(r.cutPieces).toBe(1);
  expect(r.heapPieces).toBe(1);
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
    const pit0 = g.getPits().pits[0];
    const west0 = Math.min(...carved0.map(([x]: number[]) => x));
    P.dig(gx, gz, 9000, 30);
    const after = near(P.carved());
    const cut1 = P.carved().filter(([, , d]: number[]) => d < 0);
    // toward it: the reach east in the rows the building stands in (and its setback's)
    const rows = (list: number[][]) => Math.max(-1, ...list.filter(([, z]) => z >= pad.gz0 - 3 && z <= pad.gz1 + 3).map(([x]) => x));
    return {
      id, before, after, footing, footingAfter: P.footings()[id], pit0, pit: g.getPits().pits[0], pad,
      toward0: rows(carved0), toward1: rows(cut1), west0, westAfter: Math.min(...cut1.map(([x]: number[]) => x)),
    };
  });
  expect(r.id).not.toBeNull();
  expect(r.pit.cutM3).toBeGreaterThan(7000);
  // within its setback nothing was dug after it stood (what was there stays, never deeper)
  expect(r.after).toEqual(r.before);
  expect(r.footingAfter).toEqual(r.footing);
  // the pit went on growing — away from it: no further toward it, its centre drifting off
  expect(r.toward1).toBeLessThanOrEqual(r.toward0);
  const bx = ((r.pad.gx0 + r.pad.gx1) / 2) * 4 - 512, bz = ((r.pad.gz0 + r.pad.gz1) / 2) * 4 - 512;
  const away = (p: any) => Math.hypot(p.cx - bx, p.cz - bz);
  expect(away(r.pit)).toBeGreaterThan(away(r.pit0) + 1);
  expect(r.westAfter).toBeLessThan(r.west0);
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
    // the build network reaches the heap: a relay mast between it and the Lander
    if (g.canGrade(hx, hz).reason.startsWith('Beyond')) {
      g.completeTech('prospectingRovers'); // unlocks the Relay Mast
      const a = Math.atan2(pit.heap.z, pit.heap.x);
      P.place('relayMast', Math.cos(a) * 52, Math.sin(a) * 52, 5);
      g.finishConstruction();
    }
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
  expect(r.gradeHeap).toEqual({ valid: true, reason: '' });
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
    const zones = g.getZones();
    // go on digging: the reloaded game must carve the same
    P.dig(-60, -30, 3000, 10);
    P.run(10);
    return { blob, hash, pits: view.pits, delta: view.delta, zones, bytes: JSON.stringify(blob).length, later: g.getPits().delta, laterHash: g.terrainHash() };
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

test('chunk rebuilds are throttled: one a frame, two a second; a debug advance rebuilds each once', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    // live play at 10× (a game-second a 0.1 s frame): three pits far apart, several chunks to rebuild
    g.setPaused(false);
    g.setSpeed(10);
    g.stepFrame(0);
    const sites = [[-200, -150], [200, -160], [-180, 190]];
    const q0 = g.getPits().queue;
    const per: number[] = [], queued: number[] = [];
    let last = q0.rebuilds;
    for (let i = 0; i < 400; i++) {
      if (i < 120 && i % 4 === 0) for (const [x, z] of sites) g.pitDig(x, z, 120);
      g.grantPower(1000);
      g.stepFrame(0.1);
      const q = g.getPits().queue;
      per.push(q.rebuilds - last);
      queued.push(q.queued);
      last = q.rebuilds;
    }
    g.setPaused(true);
    g.stepFrame(0);
    const q1 = g.getPits().queue;
    // then sim time no frame showed: the changed chunks rebuilt at once, each once
    for (const [x, z] of sites) g.pitDig(x, z, 1500);
    g.advanceGameSeconds(40);
    const q2 = g.getPits().queue;
    return { q0, q1, q2, per, maxQueued: Math.max(...queued), err: g.terrainError(), pits: g.getPits().pits.map((p: any) => p.cutM3) };
  });
  expect(r.pits.every((v: number) => v > 1500)).toBe(true);
  // carves wait in the queue: several chunks at once
  expect(r.maxQueued).toBeGreaterThanOrEqual(2);
  // never more than one a frame
  expect(Math.max(...r.per)).toBeLessThanOrEqual(1);
  // two a second at most: rebuilds at least 0.5 s of frame time apart
  const log = r.q1.log;
  expect(log.length).toBeGreaterThan(3);
  for (let i = 1; i < log.length; i++) expect(log[i] - log[i - 1]).toBeGreaterThan(0.5 - 1e-6);
  // all of it drawn in the end
  expect(r.q1.queued).toBe(0);
  // a debug advance: nothing left queued, the drawn ground is the carved ground
  expect(r.q2.queued).toBe(0);
  expect(r.q2.rebuilds).toBeGreaterThan(r.q1.rebuilds);
  expect(r.err.vertex).toBeLessThan(0.01);
});

{
  test('the pit is drawn: the mesh follows the cut, and the cut differs from the ground by 40/255 in a channel', async ({ page }) => {
    test.setTimeout(240_000);
    await start(page);
    const r = await page.evaluate(() => {
      const g = window.__game;
      const x = -60, z = 20;
      const box = [Math.round((x - 60 + 512) / 4), Math.round((z - 60 + 512) / 4), Math.round((x + 60 + 512) / 4), Math.round((z + 60 + 512) / 4)];
      // the ground's own colour (linear) → the 8-bit value on screen
      const srgb = (c: number) => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
      const rgb = (ix: number, iz: number): number[] | null => {
        const c = g.terrainColorAt(ix * 4 - 512, iz * 4 - 512);
        return c ? [srgb(c[0]), srgb(c[1]), srgb(c[2])] : null;
      };
      const before = new Map<number, number[] | null>();
      for (let iz = box[1]; iz <= box[3]; iz++) for (let ix = box[0]; ix <= box[2]; ix++) before.set(iz * 257 + ix, rgb(ix, iz));
      P.dig(x, z, 5000, 12);
      g.stepFrame(0.5);
      // the largest channel change of every sample the cut took (past its first bench)
      const diffs: number[] = [];
      for (let iz = box[1]; iz <= box[3]; iz++) for (let ix = box[0]; ix <= box[2]; ix++) {
        const t = g.terrainSample(ix, iz);
        if (t.delta > -20) continue;
        const a = before.get(iz * 257 + ix), b = rgb(ix, iz);
        if (a && b) diffs.push(Math.max(...a.map((v, i) => Math.abs(v - b[i]))));
      }
      diffs.sort((a, b) => a - b);
      // rocks: none left on a cell the pit or its heap took
      let rocks = 0, cells = 0;
      for (let iz = box[1]; iz < box[3]; iz++) for (let ix = box[0]; ix < box[2]; ix++) {
        const all = [[0, 0], [1, 0], [0, 1], [1, 1]].every(([dx, dz]) => g.terrainSample(ix + dx, iz + dz).delta !== 0);
        if (!all) continue;
        cells++;
        rocks += g.rocksIn(ix * 4 - 512, iz * 4 - 512, ix * 4 - 508, iz * 4 - 508);
      }
      return {
        style: g.getRenderInfo().style, err: g.terrainError(), n: diffs.length, low: diffs[Math.floor(diffs.length * 0.1)],
        median: diffs[Math.floor(diffs.length / 2)], queue: g.getPits().queue, rocks, cells,
      };
    });
    expect(r.style).toBe('cel');
    expect(r.queue.queued).toBe(0);
    expect(r.n).toBeGreaterThan(20);
    // the drawn ground is the carved ground (the pit's ink and cuts sit off the grid: the probe skips them)
    expect(r.err.vertex).toBeLessThan(0.01);
    // the cut's palette (ochre benches, the floor): 40/255 in a channel from the ground it was cut from,
    // for nine samples in ten (the flat floor, a tone closer to the ground, is the tenth) and the median
    expect(r.median).toBeGreaterThanOrEqual(40);
    expect(r.low).toBeGreaterThanOrEqual(40);
    expect(r.cells).toBeGreaterThan(20);
    expect(r.rocks).toBe(0);
    await page.screenshot({ path: 'test-results/pits-cel.png' });
  });

  test('the pit look is baked into the chunks: a contour ring a bench, a tread and arrow on the ramp, a hatched heap, no draw call more', async ({ page }) => {
    test.setTimeout(240_000);
    await start(page);
    const before = await page.evaluate(() => window.__game.getRenderInfo().terrain);
    const stages: any[] = [];
    let dug = 0;
    for (const total of [400, 1600, 5000]) {
      const st = await page.evaluate(([from, to]) => {
        const g = window.__game;
        P.dig(-60, 20, to - from, 12);
        g.stepFrame(0.5);
        const pit = g.getPits().pits[0];
        return { deep: pit.deep, look: g.getPitLook(), queued: g.getPits().queue.queued, terrain: g.getRenderInfo().terrain };
      }, [dug, total]);
      dug = total;
      stages.push(st);
    }
    // a save and a load: the chunks are rebuilt from the grid and the pits' ramps, the look with them
    const r: any = await page.evaluate(() => {
      const g = window.__game;
      const blob = g.saveBlob();
      g.loadBlob(blob);
      g.stepFrame(0.5);
      return { err: g.terrainError(), reloaded: g.getPitLook() };
    });
    Object.assign(r, { before, stages });
    const lum = (c: number[]) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    for (const st of r.stages) {
      // one ink ring a bench: the levels are the odd metres 1, 3, 5 … and number the bench index of the deepest cut
      const benches = Math.floor(st.deep / 2 + 0.5);
      expect(st.look.levels).toEqual(Array.from({ length: benches }, (_, i) => 2 * i + 1));
      expect(st.look.contour).toBeGreaterThanOrEqual(benches);
      expect(st.queued).toBe(0);
      // baked into the chunk's own buffers: still one mesh (one draw call) a chunk, more triangles in them
      expect(st.terrain.chunks).toBe(r.before.chunks);
      expect(st.terrain.triangles).toBeGreaterThan(r.before.triangles);
    }
    // the pit grows benches as it deepens
    expect(r.stages[0].look.levels.length).toBeGreaterThanOrEqual(1);
    expect(r.stages[2].look.levels.length).toBeGreaterThan(r.stages[0].look.levels.length);
    const last = r.stages[2].look;
    // the ramp: a tread, an arrow on it, pointing down (its tip lower than its tail); the heap outlined and hatched
    expect(last.tread).toBeGreaterThan(0);
    expect(last.edge).toBeGreaterThan(0);
    expect(last.arrow).toBeGreaterThan(0);
    expect(last.arrows.length).toBe(1);
    expect(last.arrows[0].tipY).toBeLessThan(last.arrows[0].tailY);
    expect(last.heap).toBeGreaterThan(0);
    expect(last.foot).toBeGreaterThan(0);
    expect(last.hatch).toBeGreaterThan(0);
    // the palette: a lighter tread than the benches, and the two benches apart by 20/255 of luminance
    const pal = last.palette;
    expect(lum(pal.tread)).toBeGreaterThan(lum(pal.ochre));
    expect(lum(pal.ochre) - lum(pal.dark)).toBeGreaterThanOrEqual(20);
    expect(lum(pal.heap)).toBeLessThan(lum(pal.dark));
    expect(r.err.vertex).toBeLessThan(0.01);
    expect(r.reloaded.levels).toEqual(last.levels);
    expect(r.reloaded.tread).toBe(last.tread);
    expect(r.reloaded.arrows.length).toBe(1);
  });

  test('a pit in an end state carries a flag and a dashed ring, and its label chip takes the state colour', async ({ page }) => {
    test.setTimeout(240_000);
    await start(page);
    const setup = await page.evaluate(() => {
      const g = window.__game;
      const z = g.getZones().find((q: any) => q.kind === 'ilmenite');
      P.dig(z.cx, z.cz, 3000, 12);
      g.stepFrame(0.5);
      const pit = g.getPits().pits[0];
      return { key: pit.key, cx: pit.cx, cz: pit.cz, R: pit.R };
    });
    const seen: Record<string, any> = {};
    for (const state of ['open', 'exhausted', 'boxed', 'reclaimed']) {
      const marks = await page.evaluate(([k, st]) => {
        const g = window.__game;
        g.setPitState(k, st);
        for (let i = 0; i < 4; i++) g.stepFrame(0.3);
        return g.getPitMarks();
      }, [setup.key, state]);
      seen[state] = { marks };
    }
    // an open pit has no flag; each end state has one, on the rim, and a ring of dashes (its own pattern)
    expect(seen.open.marks.flags).toEqual([]);
    expect(seen.open.marks.rings).toBe(0);
    expect(seen.open.marks.meshes).toBe(0);
    for (const state of ['exhausted', 'boxed', 'reclaimed']) {
      const m = seen[state].marks;
      expect(m.flags.map((f: any) => f.state)).toEqual([state]);
      expect(m.rings).toBe(1);
      expect(m.dashes).toBeGreaterThan(8);
      const d = Math.hypot(m.flags[0].x - setup.cx, m.flags[0].z - setup.cz);
      expect(d).toBeGreaterThan(setup.R - 3);
      expect(d).toBeLessThan(setup.R + 10);
      // the flags are one mesh and the rings one: two draw calls
      expect(m.meshes).toBe(2);
    }
    expect(seen.boxed.marks.dashes).toBeGreaterThan(seen.exhausted.marks.dashes);
    // the highlight (a hub's palette card up): the rim is the real cut contour, the chip wears the state
    await page.evaluate(() => window.__game.setHubCard('smelter'));
    const chips: Record<string, { border: string; text: string }> = {};
    for (const state of ['exhausted', 'boxed', 'reclaimed']) {
      await page.evaluate(([k, st]) => { window.__game.setPitState(k, st); for (let i = 0; i < 6; i++) window.__game.stepFrame(0.3); }, [setup.key, state]);
      const chip = page.locator(`#deposit-marks .deposit-mark.hl-${state}`).first();
      await expect(chip).toBeVisible();
      chips[state] = await chip.evaluate((el) => ({ border: getComputedStyle(el).borderTopColor, text: (el.querySelector('.t') as HTMLElement).textContent ?? '' }));
      const hl = await page.evaluate(() => window.__game.getHighlight());
      expect(hl.drawn.rims).toBeGreaterThanOrEqual(1);
    }
    expect(chips.exhausted.text).toBe('EXHAUSTED');
    expect(chips.boxed.text).toBe('BOXED IN');
    expect(chips.reclaimed.text).toBe('RECLAIMED');
    expect(new Set(Object.values(chips).map((c) => c.border)).size).toBe(3);
  });
}
