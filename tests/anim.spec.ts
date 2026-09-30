/** Work animations (world/workAnim.ts, docs/06 §7): a welding rover's print
 *  arm unfolds, sweeps over its site with a spark at the nozzle and folds
 *  as it leaves; a sintering rover points its arm down, crawls at the
 *  frontier (the hook) and the cells glow and cool; a printing drone sparks; a
 *  hub's excavator (a unit, docs/17: reported as UNIT_VID + its id) turns its wheel and dips
 *  its boom while it digs, and holds while it drives. Pause freezes all of it, 3× and 10× run it at
 *  game speed, and it costs three draw calls at most (the kit, its ink
 *  outline, the glow). */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

const URL_DEBUG = '/?debug&seed=42';
async function start(page: Page, extra = '') {
  await page.goto(`${URL_DEBUG}&site=mare${extra}`);
  await page.waitForFunction(() => window.__game !== undefined && window.__game.getState() !== null);
  await page.evaluate(() => {
    const g = window.__game!;
    g.setPaused(true);
    g.advanceGameSeconds(0);
    g.holdHazards(true);
    g.grantResources({ metals: 4000, parts: 2000 });
    g.grantPower(50000);
  });
}

const work = (page: Page) => page.evaluate(() => window.__game!.getWorkAnim());

/** `n` live frames of `dt` wall-seconds each, paused again after: the real
 *  frames between steps draw but move nothing (under software GL a slow real
 *  frame would run the sim ahead of the visuals) */
const live = (page: Page, n: number, dt = 0.05) => page.evaluate(([n, dt]) => {
  const g = window.__game!;
  g.setPaused(false);
  for (let i = 0; i < n; i++) g.stepFrame(dt);
  g.setPaused(true);
  g.stepFrame(0);
}, [n, dt] as const);

/** The work readout before and after `n` live frames, in one go (no real
 *  frames slip in between). */
const span = (page: Page, n: number, dt = 0.05) => page.evaluate(([n, dt]) => {
  const g = window.__game!;
  g.setPaused(false);
  const a = g.getWorkAnim();
  for (let i = 0; i < n; i++) g.stepFrame(dt);
  const b = g.getWorkAnim();
  g.setPaused(true);
  g.stepFrame(0);
  return [a, b];
}, [n, dt] as const);

/** seconds into its current dig (the sim's haul clock), for a hub unit */
const digT = (page: Page, unit: number) => page.evaluate((unit) => {
  const h = window.__game!.getState().haulers.find((u: any) => u.id === unit)?.haul;
  return h?.phase === 'dig' ? h.t : Infinity;
}, unit);

/** live frames until `pred` holds on the work readout (or the budget runs out) */
async function until(page: Page, pred: (w: any) => boolean, frames = 1200, batch = 20) {
  for (let i = 0; i < frames; i += batch) {
    await live(page, batch);
    const w = await work(page);
    if (pred(w)) return w;
  }
  return null;
}

/** A Regolith Smelter by the guaranteed high-Ti basalt (12 m off its ring toward the Lander, the pits' setback),
 *  built: its first unit, an excavator, digs the deposit's pit. `vid` is its digger id in getWorkAnim(). */
const HUB = () => {
  const g = window.__game!;
  const z = g.getZones().find((q: any) => q.kind === 'ilmenite');
  const l = Math.hypot(z.cx, z.cz) || 1, out = z.r + 22;
  const cx = Math.round((z.cx - (z.cx / l) * out + 512) / 4) - 1, cz = Math.round((z.cz - (z.cz / l) * out + 512) / 4) - 1;
  let hub = -1;
  for (let r = 0; r <= 10 && hub < 0; r++) for (let dx = -r; dx <= r && hub < 0; dx++) for (let dz = -r; dz <= r && hub < 0; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    for (const rot of [0, 1, 2, 3]) if (hub < 0 && g.placeBuilding('smelter', cx + dx, cz + dz, rot)) hub = g.getState().buildings.find((b: any) => b.type === 'smelter').id;
  }
  g.finishConstruction();
  const unit = g.getState().haulers.find((u: any) => u.hub === hub).id as number;
  return { hub: hub as number, unit, vid: 100000 + unit }; // (data/hubs.ts UNIT_VID)
};

test('a welding rover unfolds its arm and sweeps it over the site, spark on; it folds as it leaves', async ({ page }) => {
  test.setTimeout(300_000);
  await start(page);
  await page.evaluate(() => { const g = window.__game!; g.placeBuilding('habitat', 132, 124); g.finishRoads(); g.advanceGameSeconds(1); });
  const w0 = await until(page, (w) => w.rovers.some((r: any) => r.spark && r.arm.unfold > 0.99));
  expect(w0, 'a rover reaches its site and welds').not.toBeNull();
  const id = w0!.rovers.find((r: any) => r.spark).id;
  // folded, the other (parked) rover: no spark
  for (const r of w0!.rovers.filter((x: any) => x.id !== id)) {
    expect(r.arm.unfold).toBe(0);
    expect(r.spark).toBe(false);
  }
  // the sweep: its yaw ranges well over half a radian in 3 s, reaching out over the site
  const { yaws, sparks, reach } = await page.evaluate((id) => {
    const g = window.__game!;
    const out = { yaws: [] as number[], sparks: [] as boolean[], reach: [] as number[] };
    g.setPaused(false);
    for (let i = 0; i < 30; i++) {
      g.stepFrame(0.05); g.stepFrame(0.05);
      const r = g.getWorkAnim().rovers.find((x: any) => x.id === id);
      out.yaws.push(r.arm.yaw); out.sparks.push(r.spark); out.reach.push(r.arm.reach);
    }
    g.setPaused(true);
    g.stepFrame(0);
    return out;
  }, id);
  expect(Math.max(...yaws) - Math.min(...yaws), 'the arm sweeps').toBeGreaterThan(0.5);
  expect(sparks.every(Boolean), 'the spark is on while it welds').toBe(true);
  expect(Math.min(...reach), 'unfolded, the arm reaches out over the site').toBeGreaterThan(1.3);
  // the site done: it drives home and the arm folds back over the nose
  await page.evaluate(() => window.__game!.finishConstruction());
  const w1 = await until(page, (w) => { const r = w.rovers.find((x: any) => x.id === id); return r && r.arm.unfold === 0; }, 200, 5);
  expect(w1, 'the arm folds').not.toBeNull();
  const r1 = w1!.rovers.find((x: any) => x.id === id);
  expect(r1.spark).toBe(false);
  expect(r1.arm.reach, 'folded over the nose').toBeLessThan(1);
  const info = await page.evaluate(() => window.__game!.getRenderInfo());
  expect(info.style).toBe('cel');
  expect(info.life.failed).toEqual([]);
});

test('a hub excavator\'s wheel turns and its boom dips while it digs; still while it drives; the boom lifts to dump', async ({ page }) => {
  test.setTimeout(300_000);
  await start(page, '&exp=robotic');
  const { vid, unit } = await page.evaluate(HUB);
  const dig = (w: any) => w.diggers.find((d: any) => d.id === vid);
  const home = await until(page, (w) => dig(w)?.digging, 2400, 20);
  expect(home, 'its unit drives out and digs the deposit').not.toBeNull();
  // one game second of digging: the wheel turns 1.3 rad, the boom dips below its rest
  const [wa, wb] = await span(page, 20); // 20 × 0.05 s at 1×
  const a = dig(wa), b = dig(wb);
  expect(a.digging && b.digging).toBe(true);
  expect(b.wheel - a.wheel, 'the wheel turns').toBeCloseTo(1.3, 1);
  expect(b.boom, 'the boom dips into the cut').toBeLessThan(-0.03);
  expect(b.boom).toBeGreaterThan(-0.2);
  // spoil flies off the wheel
  expect(wb.clods, 'spoil flies off the wheel').toBeGreaterThan(0);
  expect(wb.particles).toBe(true);
  // the bucket full, it drives to its hub: the wheel holds and the boom rides high
  const drive = await until(page, (w) => dig(w)?.driving, 3000, 10);
  expect(drive, 'it drives off with its load').not.toBeNull();
  const [da, db] = await span(page, 10);
  const d0 = dig(da), d1 = dig(db);
  expect(d0.driving && d1.driving).toBe(true);
  expect(d1.wheel, 'the wheel is still while it drives').toBe(d0.wheel);
  expect(d1.boom).toBeGreaterThan(0);
  // and dumps at the hub: the boom lifts
  await page.evaluate(() => window.__game!.grantPower(20000));
  const dump = await until(page, (w) => dig(w)?.dumping && dig(w).boom > 0.1, 3000, 10);
  expect(dump, 'it dumps its load').not.toBeNull();
  expect(unit).toBeGreaterThan(0);
});

test('a sintering rover points its arm down, the cells glow as they sinter and cool behind it; then it welds', async ({ page }) => {
  test.setTimeout(180_000);
  await start(page);
  // a site out past the Lander: its crew sinters the spur first
  const placed = await page.evaluate(() => {
    const g = window.__game!;
    for (const [x, z] of [[116, 136], [114, 130], [136, 136]]) if (g.placeBuilding('habitat', x, z)) return [x, z];
    return null;
  });
  expect(placed).not.toBeNull();
  const w0 = await until(page, (w) => w.rovers.some((r: any) => r.mode === 'sinter' && r.arm.down > 0.99), 1200, 4);
  expect(w0, 'a rover sinters with its arm down').not.toBeNull();
  const r0 = w0!.rovers.find((r: any) => r.mode === 'sinter');
  expect(r0.arm.unfold, 'no weld arm while it sinters').toBe(0);
  expect(r0.spark).toBe(false);
  expect(w0!.fx, 'the sinter glow').toBeGreaterThan(0);
  // the cells it sintered cool behind it
  const w1 = await until(page, (w) => w.cooling > 0, 600, 4);
  expect(w1, 'sintered cells cool behind it').not.toBeNull();
  // the spur done (a cell at a time, the rover stepping on to each), it welds: arm up and out, spark on
  const w2 = await until(page, (w) => w.rovers.some((r: any) => r.mode === 'weld' && r.spark), 4000, 40);
  expect(w2).not.toBeNull();
  expect(w2!.rovers.find((r: any) => r.spark).arm.down).toBeLessThan(0.01);
});

test('the sim\'s word (Rover.mode): stopped behind the frontier it sinters and crawls toward it, arm down through each hop; it eases back as it drives on', async ({ page }) => {
  test.setTimeout(180_000);
  await start(page);
  const placed = await page.evaluate(() => {
    const g = window.__game!;
    for (const [x, z] of [[116, 136], [114, 130], [136, 136]]) if (g.placeBuilding('habitat', x, z)) return [x, z];
    return null;
  });
  expect(placed).not.toBeNull();
  // frame by frame: the rover's mode as the visuals hold it (getRenderInfo life.rovers.modes)
  // against the work animation's, its crawl and its arm
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.setPaused(false);
    const out = { agree: 0, disagree: 0, crawlMax: 0, eased: false, heldDown: 0, frames: 0 };
    let peak = 0;
    for (let i = 0; i < 4000; i++) {
      g.stepFrame(0.05);
      const life = g.getRenderInfo().life;
      const w = life.work;
      for (let k = 0; k < life.rovers.ids.length; k++) {
        const id = life.rovers.ids[k], said = life.rovers.modes[k];
        const a = w.rovers.find((x: any) => x.id === id);
        if (!a) continue;
        if (said === 'sinter') {
          if (a.mode === 'sinter') out.agree++; else out.disagree++;
          out.crawlMax = Math.max(out.crawlMax, a.crawl);
          peak = Math.max(peak, a.crawl);
        } else if (a.mode === 'sinter' && a.arm.down > 0.9) {
          // between cells: the sim has it driving on, the arm stays down
          out.heldDown++;
          if (peak > 0.3 && a.crawl < peak - 0.2) out.eased = true;
        }
      }
      out.frames = i;
      if (out.eased && out.heldDown > 5 && out.agree > 20) break;
    }
    g.setPaused(true);
    return out;
  });
  expect(r.agree, 'the animation sinters when the sim says so').toBeGreaterThan(20);
  expect(r.disagree).toBe(0);
  expect(r.crawlMax, 'it crawls toward the frontier while it stands').toBeGreaterThan(0.3);
  expect(r.heldDown, 'the arm stays down through the hop').toBeGreaterThan(5);
  expect(r.eased, 'the crawl eases back as it drives on').toBe(true);
});

test('a hub excavator waiting with a full bucket (its hopper full) stands still: no dig, no spoil, no dump', async ({ page }) => {
  test.setTimeout(300_000);
  await start(page, '&exp=robotic');
  const { vid, unit } = await page.evaluate(HUB);
  // the hopper kept full: the smelter draws the pile first, so a topped-up pile lets the hopper fill, and
  // the unit's next bucket has nowhere to go; it waits at its face
  const full = await page.evaluate((unit) => {
    const g = window.__game!;
    for (let i = 0; i < 900; i++) {
      g.grantPower(1000);
      g.grantResources({ regolith: 300 });
      g.advanceGameSeconds(5);
      const h = g.getState().haulers.find((x: any) => x.id === unit).haul;
      if (h.full) return h.phase;
    }
    return null;
  }, unit);
  expect(full, 'a full bucket, no room').toBe('dig');
  const [a, b] = await page.evaluate(() => {
    const g = window.__game!;
    g.setPaused(false);
    for (let i = 0; i < 40; i++) { if (i % 10 === 0) g.grantResources({ regolith: 300 }); g.stepFrame(0.05); }
    const a = g.getWorkAnim();
    for (let i = 0; i < 40; i++) { if (i % 10 === 0) g.grantResources({ regolith: 300 }); g.stepFrame(0.05); }
    return [a, g.getWorkAnim()];
  });
  const d0 = a.diggers.find((d: any) => d.id === vid), d1 = b.diggers.find((d: any) => d.id === vid);
  expect(d1.full).toBe(true);
  expect(d1.digging).toBe(false);
  expect(d1.dumping).toBe(false);
  expect(d1.wheel, 'the wheel holds while it waits').toBe(d0.wheel);
  expect(b.clods).toBe(0);
});

test('drones print with a nozzle spark and a beam down to the site', async ({ page }) => {
  test.setTimeout(180_000);
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('droneHives');
    g.openRoads(true);
    let ok = false;
    for (let rr = 5; rr < 30 && !ok; rr++) for (let dx = -rr; dx <= rr && !ok; dx += 2) ok = g.placeBuilding('droneHive', 127 + dx, 127 - rr);
    g.finishConstruction();
    g.openRoads(false);
    const s = g.getState();
    const hive = s.buildings.find((b: any) => b.type === 'droneHive');
    let lab = false;
    for (let rr = 4; rr < 14 && !lab; rr++) {
      for (const [dx, dz] of [[rr, 0], [-rr, 0], [0, rr], [0, -rr]]) if (!lab) lab = g.placeBuilding('lab', hive.gx + dx, hive.gz + dz);
    }
    g.finishRoads();
    g.advanceGameSeconds(1);
    const st = g.getState();
    const site = st.buildings.find((b: any) => b.type === 'lab').id;
    const drones = st.rovers.filter((u: any) => u.home === hive.id).map((u: any) => u.id);
    g.sendRover(drones[0], site);
    g.advanceGameSeconds(1);
    return { ok, lab, drone: drones[0] };
  });
  expect(r.ok && r.lab).toBe(true);
  const w = await until(page, (w) => w.drones.some((d: any) => d.id === r.drone && d.spark), 1200);
  expect(w, 'the drone prints').not.toBeNull();
  expect(w!.drones.find((d: any) => d.id === r.drone).mode).toBe('weld');
  expect(w!.fx, 'its spark and beam').toBeGreaterThanOrEqual(4);
  // parked drones on the hive: no spark
  expect(w!.drones.filter((d: any) => d.spark).length).toBeLessThan(w!.drones.length);
});

test('pause freezes every work animation; 3× and 10× run them at game speed', async ({ page }) => {
  test.setTimeout(180_000);
  await start(page); // (a crewed landing: the habitat is open to build)
  const { vid: id, unit } = await page.evaluate(HUB);
  // the unit digs (a bucket takes it 60 s); a site for the rovers goes up while it does
  expect(await until(page, (w) => w.diggers.some((d: any) => d.id === id && d.digging), 2400, 20), 'its unit digs').not.toBeNull();
  await page.evaluate(() => { const g = window.__game!; g.placeBuilding('habitat', 132, 124); g.finishRoads(); g.advanceGameSeconds(1); });
  const ready = await until(page, (w) => w.diggers.some((d: any) => d.id === id && d.digging) && w.rovers.some((r: any) => r.spark && r.arm.unfold > 0.99), 1200, 10);
  expect(ready, 'a rover welds and the excavator digs').not.toBeNull();

  // paused: frames still draw, nothing moves
  const frozen = await page.evaluate(() => {
    const g = window.__game!;
    g.setPaused(true);
    g.stepFrame(0.05);
    const a = g.getWorkAnim();
    for (let i = 0; i < 20; i++) g.stepFrame(0.05);
    return { a, b: g.getWorkAnim() };
  });
  expect(frozen.b.clock).toBe(frozen.a.clock);
  expect(frozen.b.diggers).toEqual(frozen.a.diggers);
  expect(frozen.b.rovers).toEqual(frozen.a.rovers);
  // (a fresh dig, so it digs all through the measures below)
  await page.evaluate((unit) => {
    const g = window.__game!;
    const h = () => g.getState().haulers.find((u: any) => u.id === unit).haul;
    if (h().phase === 'dig' && h().t <= 40) return;
    for (let i = 0; i < 300 && !(h().phase === 'dig' && h().t < 3); i++) { g.grantPower(5000); g.advanceGameSeconds(1); }
  }, unit);
  expect(await until(page, (w) => w.diggers.some((d: any) => d.id === id && d.digging), 600)).not.toBeNull();
  expect(await digT(page, unit)).toBeLessThan(45);
  // the wheel's turn over the same wall time at 1×, 3× and 10×
  const rate = async (speed: number) => page.evaluate(([speed, id]) => {
    const g = window.__game!;
    g.setSpeed(speed);
    g.setPaused(false);
    g.stepFrame(0.02);
    const a = g.getWorkAnim();
    for (let i = 0; i < 6; i++) g.stepFrame(0.02);
    const b = g.getWorkAnim();
    const w = (x: any) => x.diggers.find((d: any) => d.id === id);
    return { clock: b.clock - a.clock, wheel: w(b).wheel - w(a).wheel, digging: w(a).digging && w(b).digging };
  }, [speed, id] as const);
  const r1 = await rate(1), r3 = await rate(3), r10 = await rate(10);
  for (const r of [r1, r3, r10]) expect(r.digging).toBe(true);
  expect(r3.clock / r1.clock).toBeCloseTo(3, 1);
  expect(r10.clock / r1.clock).toBeCloseTo(10, 0);
  expect(r3.wheel / r1.wheel).toBeCloseTo(3, 1);
  expect(r10.wheel / r1.wheel).toBeCloseTo(10, 0);
});

test('safe mode keeps the motion and the glow but drops the particles', async ({ page }) => {
  test.setTimeout(180_000);
  await start(page, '&exp=robotic');
  const { vid: id } = await page.evaluate(HUB);
  let w = await until(page, (w) => w.diggers.some((d: any) => d.id === id && d.digging) && w.clods > 0, 2400, 20);
  expect(w, 'clods fly before safe mode').not.toBeNull();
  await page.evaluate(() => window.__game!.enableSafeMode());
  const a = w!.diggers.find((d: any) => d.id === id).wheel;
  await live(page, 10);
  w = await work(page);
  expect(w!.particles).toBe(false);
  expect(w!.clods).toBe(0);
  expect(w!.diggers.find((d: any) => d.id === id).wheel).toBeGreaterThan(a);
});

/** A busy base: the Automation's Era 8 set round the Lander (drone hives,
 *  two smelters, each with its excavator), finished, then three sites the units weld. The sim hands each
 *  site to whichever free unit reaches it soonest (a drone flies straight, a rover drives the road), so a
 *  hive near a site takes it and the layout decides whether any ground rover welds at all: a ground rover
 *  the haul roads have not taken is sent to one site (the player's Send), so a welding rover is certain. */
async function busyBase(page: Page) {
  return page.evaluate(async () => {
    const T = await import('/src/data/techs.ts');
    const g = window.__game!;
    g.openRoads(true);
    const taken = new Set<string>();
    for (const t of T.TECH_ORDER) {
      const d = T.TECHS[t];
      if (d.track || d.band) continue;
      if (d.exclusive) { if (taken.has(d.exclusive)) continue; taken.add(d.exclusive); }
      if (d.expeditions && !d.expeditions.includes('robotic')) continue;
      g.completeTech(t);
    }
    for (let e = 2; e <= 8; e++) g.pickDestiny(e, 'automation');
    g.grantResources({ metals: 60000, parts: 20000, silicon: 20000, chips: 10000, regolith: 20000, foils: 500, water: 5000, food: 5000, oxygen: 5000 });
    const place = (type: string) => {
      for (let r = 4; r < 40; r++) {
        for (let dx = -r; dx <= r; dx += 2) {
          for (const [x, z] of [[127 + dx, 127 - r], [127 + dx, 127 + r], [127 - r, 127 + dx], [127 + r, 127 + dx]]) {
            if (g.placeBuilding(type, x, z)) return true;
          }
        }
      }
      return false;
    };
    for (const [t, n] of [['solar', 6], ['battery', 2], ['smelter', 2], ['roboticsBay', 1], ['droneHive', 2], ['partsFab', 1]] as [string, number][]) {
      for (let i = 0; i < n; i++) place(t);
    }
    g.finishConstruction();
    g.grantPower(500000);
    g.advanceGameSeconds(2);
    for (const t of ['habitat', 'lab', 'hydroponics']) place(t);
    g.advanceGameSeconds(1);
    const F = await import('/src/core/fleet.ts');
    const st = g.getState();
    const rover = st.rovers.find((u: any) => F.unitKind(st, u) === 'rover' && u.site === null && u.road === undefined && !u.pinned);
    const site = st.buildings.find((b: any) => (b.construction ?? 0) > 0);
    if (rover && site) g.sendRover(rover.id, site.id);
    g.advanceGameSeconds(1);
  });
}

test('on a busy base the work animations cost three draw calls at most', async ({ page }) => {
  test.setTimeout(300_000);
  await start(page, '&exp=robotic');
  await busyBase(page);
  const w = await until(page, (w) => w.rovers.some((r: any) => r.spark) && w.diggers.some((d: any) => d.digging), 2400, 20);
  expect(w, 'rovers weld and excavators dig').not.toBeNull();
  await page.evaluate(() => {
    const g = window.__game!;
    g.setPaused(true);
    const t = { x: 8, z: 8 }, d = 290, p = 32 * Math.PI / 180, a = Math.PI / 4;
    g.setView({ x: t.x + Math.cos(a) * Math.cos(p) * d, y: Math.sin(p) * d, z: t.z + Math.sin(a) * Math.cos(p) * d }, { x: t.x, y: 0, z: t.z });
  });
  const frame = async (on: boolean) => {
    await page.evaluate((on) => { const g = window.__game!; g.setWorkAnimVisible(on); g.stepFrame(0.016); }, on);
    await page.waitForTimeout(600);
    return (await page.evaluate(() => window.__game!.getRenderInfo())).frame as { calls: number; triangles: number };
  };
  const off = await frame(false), on = await frame(true);
  const info = await work(page);
  test.info().annotations.push({ type: 'work anim cost', description: JSON.stringify({ off, on, kit: info.kit, fx: info.fx }) });
  console.log('[work anim cost · cel]', JSON.stringify({ off, on, kit: info.kit, fx: info.fx }));
  // the kit, its ink outline (world/ink.ts, docs/19 S1b) and the glow quads
  expect(on.calls - off.calls, 'draw calls').toBeLessThanOrEqual(3);
  expect(on.calls - off.calls).toBeGreaterThanOrEqual(1);
  expect(on.triangles - off.triangles, 'triangles').toBeLessThan(30_000);
  expect(info.kit, 'kit boxes in use').toBeGreaterThan(40);
});
