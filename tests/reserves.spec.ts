/** Grade, reserves, faces, surveys, strip-mine morale and Reclaim (docs/17
 *  Phase 4, §8.2, §9, §10, §12, §13, §21): pits run out, and you can see why.
 *
 *  - A deposit's cut starts at its centre grade and falls as the pit widens;
 *    a hub's output is the recipe × the grade its units bring (q); MRE is q 1
 *    anywhere; a crew high-grades plain ground ×1.25.
 *  - Faces are benches: a new pit has one, the second opens at R 9.6 m, never
 *    more than six, a blocked rim holds fewer; no pit holds more units than faces.
 *  - At the cutoff a deposit is EXHAUSTED: its units re-route, the pit stays
 *    open at plain grade. A pit hemmed in on every side is BOXED IN; bedrock
 *    benches reopen it at ×0.3.
 *  - The survey: a free rover cores the deposit for 30 stored energy and 2⚙,
 *    and reads ore, grade, depth and faces to ±30/15/5%, the truth inside.
 *  - A crewed base minds its scars; Reclaim pushes the heap back in. */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

const URL_DEBUG = '/?debug&seed=42&nolock&lowfx&style=classic';

async function start(page: Page, site = 'mare', exp: 'human' | 'robotic' = 'robotic') {
  await page.goto(`${URL_DEBUG}&site=${site}${exp === 'robotic' ? '&exp=robotic' : ''}`);
  await page.waitForFunction(() => window.__game !== undefined && window.__game.getState() !== null);
  await page.evaluate(() => {
    const g = window.__game!;
    g.setPaused(true);
    g.advanceGameSeconds(0);
    g.holdHazards(true);
    g.openRoads(true);
    g.grantResources({ metals: 4000, parts: 2000, silicon: 300 });
    g.grantPower(20000);
  });
  await page.evaluate(HELPERS);
}

declare const H: any;
const HELPERS = `(() => {
const g = () => window.__game;
window.H = {
  /** a hub off a deposit's ring by 'off' cells (door toward it), or near (x, z); its id */
  hub(type, depId, off = 3, x, z) {
    const d = depId ? g().getDeposits().find((q) => q.id === depId) : { x, z, r: 0 };
    const cgx = Math.floor((d.x + 512) / 4), cgz = Math.floor((d.z + 512) / 4);
    const R0 = Math.ceil(d.r / 4) + off;
    for (let rr = R0; rr <= R0 + 16; rr++) {
      const found = [];
      for (let i = -rr; i <= rr; i++) for (const [gx, gz] of [[cgx + i, cgz - rr], [cgx + i, cgz + rr], [cgx - rr, cgz + i], [cgx + rr, cgz + i]]) {
        for (const rot of [0, 1, 2, 3]) {
          if (!g().canPlace(type, gx, gz, rot).valid) continue;
          const w = (rot % 2 ? 2 : 3), dd = (rot % 2 ? 3 : 2);
          found.push({ gx, gz, rot, dist: Math.hypot((gx + w / 2) * 4 - 512 - d.x, (gz + dd / 2) * 4 - 512 - d.z) });
        }
      }
      found.sort((a, b) => a.dist - b.dist || a.gx - b.gx || a.gz - b.gz || a.rot - b.rot);
      for (const f of found) if (g().placeBuilding(type, f.gx, f.gz, f.rot)) return g().getState().buildings[g().getState().buildings.length - 1].id;
    }
    return null;
  },
  /** a structure near world (x, z); its id */
  place(type, x, z, maxR = 10) {
    const cx = Math.round((x + 512) / 4) - 1, cz = Math.round((z + 512) / 4) - 1;
    const ids = new Set(g().getState().buildings.map((b) => b.id));
    for (let r = 0; r <= maxR; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      for (const rot of [0, 1, 2, 3]) {
        if (!g().placeBuilding(type, cx + dx, cz + dz, rot)) continue;
        return g().getState().buildings.find((b) => !ids.has(b.id)).id;
      }
    }
    return null;
  },
  /** n solar arrays by the Lander, built */
  power(n) {
    let placed = 0;
    for (let r = 0; r < 30 && placed < n; r++) for (let dx = -r; dx <= r && placed < n; dx++) for (let dz = -r; dz <= r && placed < n; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const gx = 118 + dx * 2, gz = 118 + dz * 2;
      if (g().canPlace('solar', gx, gz, 0).valid && g().placeBuilding('solar', gx, gz, 0)) placed++;
    }
    return placed;
  },
  byId(id) { return g().getState().buildings.find((b) => b.id === id); },
  units(hub) { return g().getState().haulers.filter((u) => hub === undefined || u.hub === hub); },
  pit(key) { return g().getPits().pits.find((p) => p.key === key); },
  /** game-seconds in steps: power topped up, the stock kept empty (no unit waits at a full hopper) */
  run(seconds, step = 60) {
    for (let t = 0; t < seconds; t += step) {
      g().grantPower(20000);
      const reg = g().getState().resources.regolith;
      if (reg > 0) g().grantResources({ regolith: -reg });
      g().advanceGameSeconds(step);
    }
  },
  /** t of regolith dug at (x, z) in steps, the economy running between (step 4.2 carves) */
  dig(x, z, tonnes, steps = 20) {
    for (let i = 0; i < steps; i++) { g().pitDig(x, z, tonnes / steps); g().grantPower(20000); g().advanceGameSeconds(12); }
  },
  alerts() { return g().getState().alerts.map((a) => a.text); },
  /** the deposit farthest from every structure (a clear field to dig) */
  clearDeposit(kind) {
    const bs = g().getState().buildings.map((b) => g().footprintOf(b.id));
    const ds = g().getDeposits().filter((d) => d.kind === kind);
    ds.sort((p, q) => Math.min(...bs.map((f) => Math.hypot(q.x - (f.x0 + f.x1) / 2, q.z - (f.z0 + f.z1) / 2))) - Math.min(...bs.map((f) => Math.hypot(p.x - (f.x0 + f.x1) / 2, p.z - (f.z0 + f.z1) / 2))));
    return ds[0];
  },
};
})()`;

test('grade: a deposit\'s cut starts at its centre and falls as the pit widens; output is the recipe × q; plain ground 0.62, MRE 1', async ({ page }) => {
  test.setTimeout(300_000);
  await start(page);
  const a = await page.evaluate(() => {
    const g = window.__game!;
    const hub = H.hub('smelter', 'ilmenite-0');
    H.power(12);
    g.finishConstruction();
    g.advanceGameSeconds(1);
    const res0 = g.getReserves('ilmenite-0');
    const q0 = g.targetGrade(hub, 'dep:ilmenite-0');
    g.queueUnit(hub);
    const seen: any[] = [];
    let over = 0;
    for (let i = 0; i < 16; i++) {
      H.run(120, 30);
      const r = g.getReserves('ilmenite-0');
      const fc = g.faceCapacity('dep:ilmenite-0');
      const working = H.units(hub).filter((u: any) => u.target === 'dep:ilmenite-0' && u.face >= 0).length;
      if (working > Math.max(1, fc.now)) over++;
      seen.push({ cut: r.cutQ, R: r.pitR, q: H.byId(hub).hub.q, faces: fc.now });
    }
    const out = g.hubOutput(hub);
    const plain = g.targetGrade(hub, 'plain:999');
    g.completeTech('moltenElectrolysis');
    g.advanceGameSeconds(1);
    return { res0, q0, seen, over, out, plain, mre: g.targetGrade(hub, 'dep:ilmenite-0'), mreOut: g.hubOutput(hub) };
  });
  const t = a.res0.truth;
  // an untouched deposit opens at its centre: the centre's grade (q 1.4–2.0 for high-Ti basalt)
  expect(t.centre).toBeGreaterThanOrEqual(1.4);
  expect(t.centre).toBeLessThanOrEqual(2.0);
  expect(a.q0).toBeGreaterThan(t.centre * 0.97);
  expect(a.q0).toBeLessThanOrEqual(t.centre + 1e-9);
  // the cut gets leaner as the pit widens: the lean tail is the geometry
  const first = a.seen[0], last = a.seen[a.seen.length - 1];
  expect(last.R).toBeGreaterThan(first.R + 3);
  expect(last.cut).toBeLessThan(first.cut - 0.05);
  for (let i = 1; i < a.seen.length; i++) expect(a.seen[i].cut).toBeLessThanOrEqual(a.seen[i - 1].cut + 0.02);
  // the hub's q follows its loads, between plain ground and the centre
  expect(last.q).toBeGreaterThan(0.62);
  expect(last.q).toBeLessThanOrEqual(t.centre + 1e-6);
  // output = recipe × q
  expect(a.out.feedFactor).toBeCloseTo(a.out.q, 6);
  expect(a.out.outputs.metals).toBeCloseTo(a.out.ref.metals * a.out.q, 6);
  // no pit ever held more units than faces
  expect(a.over).toBe(0);
  // plain mare ground, robots: q 0.62; MRE melts any soil at q 1
  expect(a.plain).toBeCloseTo(0.62, 6);
  expect(a.mre).toBe(1);
  expect(a.mreOut.feedFactor).toBe(1);
});

test('a crew high-grades plain ground ×1.25; Beneficiation concentrates ilmenite ×1.25', async ({ page }) => {
  test.setTimeout(120_000);
  await start(page, 'mare', 'human');
  const a = await page.evaluate(() => {
    const g = window.__game!;
    const hub = H.hub('smelter', 'ilmenite-0');
    g.finishConstruction();
    g.advanceGameSeconds(1);
    const plain = g.targetGrade(hub, 'plain:999'), dep = g.targetGrade(hub, 'dep:ilmenite-0');
    g.completeTech('ilmeniteBeneficiation');
    g.advanceGameSeconds(1);
    return { crew: g.getState().crew, plain, dep, benPlain: g.targetGrade(hub, 'plain:999'), benDep: g.targetGrade(hub, 'dep:ilmenite-0') };
  });
  expect(a.crew).toBeGreaterThanOrEqual(2);
  expect(a.plain).toBeCloseTo(0.62 * 1.25, 6);
  // the whole bench is ore on a deposit: no high-grading there
  expect(a.benDep).toBeCloseTo(a.dep * 1.25, 6);
  expect(a.benPlain).toBeCloseTo(a.plain * 1.25, 6);
});

test('faces are benches: one at first, the second at R 9.6 m, never more than six; a blocked rim holds fewer', async ({ page }) => {
  test.setTimeout(300_000);
  await start(page);
  const a = await page.evaluate(() => {
    const g = window.__game!;
    g.revealAll();
    const d = H.clearDeposit('ilmenite');
    const key = `dep:${d.id}`;
    const f0 = g.faceCapacity(key);
    H.dig(d.x, d.z, 90, 3);
    const p1 = H.pit(key), f1 = g.faceCapacity(key);
    H.dig(d.x, d.z, 900, 6);
    const p2 = H.pit(key), f2 = g.faceCapacity(key);
    H.dig(d.x, d.z, 30000, 40);
    const p3 = H.pit(key), f3 = g.faceCapacity(key);
    // a plain pit beside a lab: its rim against the setback holds fewer faces
    const lab = H.place('lab', -40, 4, 4);
    g.finishConstruction();
    const fp = g.footprintOf(lab);
    H.dig(fp.x0 - 22, (fp.z0 + fp.z1) / 2, 6000, 20);
    const side = g.getPits().pits.find((p: any) => p.key.startsWith('dig:'));
    return { d, f0, f1, f2, f3, p1, p2, p3, side, fside: g.faceCapacity(side.key), full: g.getReserves(d.id).facesFull };
  });
  expect(a.f0.now).toBe(1);
  expect(a.p1.R).toBeLessThan(9.6);
  expect(a.f1.now).toBe(1);
  // the rule: floor(free rim / 30 m), 1–6
  const rule = (R: number, free: number) => Math.max(1, Math.min(6, Math.floor((2 * Math.PI * R * free) / 30)));
  expect(a.p2.R).toBeGreaterThan(9.6);
  expect(a.f2.now).toBe(rule(a.p2.R, a.p2.free ?? 1));
  expect(a.f2.now).toBeGreaterThanOrEqual(2);
  expect(a.f3.now).toBeLessThanOrEqual(6);
  expect(a.f3.now).toBe(rule(a.p3.R, a.p3.free ?? 1));
  expect(a.full).toBeGreaterThanOrEqual(1);
  expect(a.full).toBeLessThanOrEqual(6);
  // the lab's side of the rim is against its setback
  expect(a.side.free).toBeLessThan(0.95);
  expect(a.fside.now).toBe(rule(a.side.R, a.side.free));
  expect(a.fside.now).toBeLessThan(rule(a.side.R, 1) + 1e-9);
});

test('at the cutoff a deposit is EXHAUSTED: its units re-route, the pit digs on at plain grade; Reclaim pushes its heap back in', async ({ page }) => {
  test.setTimeout(300_000);
  await start(page);
  const a = await page.evaluate(() => {
    const g = window.__game!;
    const hub = H.hub('smelter', 'ilmenite-0');
    H.power(12);
    g.finishConstruction();
    g.queueUnit(hub);
    H.run(120);
    const truth = g.getReserves('ilmenite-0').truth;
    const d = g.getDeposits().find((q: any) => q.id === 'ilmenite-0');
    // dig it out quickly (the tests' adapter) while its units dig too
    for (let i = 0; i < 60 && !H.pit('dep:ilmenite-0')?.spent; i++) H.dig(d.x, d.z, 600, 2);
    const p = H.pit('dep:ilmenite-0');
    g.advanceGameSeconds(1);
    const alerts = H.alerts();
    const res = g.getReserves('ilmenite-0');
    const choice = g.hubChoices(hub).find((c: any) => c.key === 'dep:ilmenite-0');
    H.run(240);
    const targets = H.units(hub).map((u: any) => u.target);
    // Reclaim: the nearest hub's units push the heap back in
    const why = g.reclaimWhy(p.id);
    g.reclaimPit(p.id);
    g.advanceGameSeconds(1);
    const reclaiming = H.pit('dep:ilmenite-0').state;
    const heap0 = H.pit('dep:ilmenite-0').heapM3;
    for (let i = 0; i < 120 && H.pit('dep:ilmenite-0').state === 'reclaiming'; i++) H.run(60);
    const after = H.pit('dep:ilmenite-0');
    const zone = g.getZones().find((z: any) => z.id === `pit-${after.id}`);
    // the deepest sample left, and the heap's samples
    let deepest = 0, heaped = 0;
    for (let iz = after.box[1]; iz <= after.box[3]; iz++) for (let ix = after.box[0]; ix <= after.box[2]; ix++) {
      const t = g.terrainSample(ix, iz);
      if (t.delta < deepest) deepest = t.delta;
      if (t.delta > 0 && !t.pad) heaped++;
    }
    const cgx = Math.round((after.cx + 512) / 4) - 1, cgz = Math.round((after.cz + 512) / 4) - 1;
    const place = g.canPlace('solar', cgx, cgz, 0);
    return {
      truth, p, alerts, res, choice, targets, why, reclaiming, heap0, after, zone: zone ?? null, deepest, heaped, place,
      alerts2: H.alerts(), units: H.units(hub).map((u: any) => u.target),
    };
  });
  // dug out: its ore ran to the cutoff; it holds about what the model says (its pit off the
  // centre a little, and this test digs it in big batches that overrun the last carve)
  expect(a.p.spent).toBe(true);
  expect(['exhausted', 'boxed']).toContain(a.p.state);
  expect(a.res.left).toBe(0);
  expect(a.res.dug).toBeGreaterThan(a.truth.ore * 0.5);
  expect(a.res.dug).toBeLessThan(a.truth.ore * 1.6);
  expect(a.alerts.some((t: string) => /^DEPOSIT EXHAUSTED — high-Ti basalt #0/.test(t))).toBe(true);
  // the pit stays open at plain grade for a smelter
  if (a.choice) expect(a.choice.q).toBeCloseTo(0.62, 6);
  // Reclaim: allowed once worked out; the heap goes back in, the pit fills toward a metre below the ground
  expect(a.why).toBe('');
  expect(a.reclaiming).toBe('reclaiming');
  expect(a.heap0).toBeGreaterThan(100);
  expect(a.after.state).toBe('reclaimed');
  expect(a.after.heapM3).toBe(0);
  expect(a.heaped).toBe(0);
  expect(a.zone).toBeNull();
  expect(a.alerts2.some((t: string) => /^PIT RECLAIMED — high-Ti basalt #0/.test(t))).toBe(true);
  // reclaimed ground builds again: no pit words refuse it
  expect(String(a.place.reason)).not.toMatch(/^(ON A PIT|TOO CLOSE TO A PIT|ON SPOIL)/);
  // its units work elsewhere now
  expect(a.units.every((k: string | null) => k !== 'dep:ilmenite-0')).toBe(true);
});

test('a pit hemmed in on every side is BOXED IN: no faces, its words name what hems it in', async ({ page }) => {
  test.setTimeout(300_000);
  await start(page, 'mare', 'human');
  const a = await page.evaluate(() => {
    const g = window.__game!;
    const x = -60, z = -40;
    // two habitats carry the build network round the ground to hem in
    H.place('habitat', -45, -5, 3);
    g.finishConstruction();
    H.place('habitat', -95, -25, 3);
    g.finishConstruction();
    // a pit first, then a closed ring of labs whose 12 m setbacks reach its rim and overlap all round
    H.dig(x, z, 1500, 6);
    const p0 = g.getPits().pits.find((q: any) => q.key.startsWith('dig:'));
    let labs = 0;
    for (let k = 0; k < 12; k++) {
      const th = (k / 12) * Math.PI * 2;
      if (H.place('lab', p0.cx + Math.cos(th) * (p0.R + 17), p0.cz + Math.sin(th) * (p0.R + 17), 2) !== null) labs++;
    }
    g.finishConstruction();
    for (let i = 0; i < 40 && g.getPits().pits.find((q: any) => q.id === p0.id)?.state !== 'boxed'; i++) H.dig(x, z, 800, 4);
    g.advanceGameSeconds(1);
    const p = g.getPits().pits.find((q: any) => q.id === p0.id);
    return { labs, p0, p, alerts: H.alerts(), faces: g.faceCapacity(p.key) };
  });
  expect(a.labs).toBeGreaterThanOrEqual(11); // (a missing one's neighbours' setbacks still overlap)
  expect(a.p.state).toBe('boxed');
  expect(a.p.R).toBeLessThan(a.p0.R + 6);
  expect(a.faces.now).toBe(0);
  expect(a.alerts.some((t: string) => /^PIT BOXED IN — pit \d+ is hemmed in by .*Research Lab #\d+.* · Deep Coring digs 4 m below it$/.test(t))).toBe(true);
});

test('bedrock benches reopen a dug-out pit: it deepens 2 m under its held rim, its ore at ×0.3 dig and 0.8 of the grade', async ({ page }) => {
  test.setTimeout(300_000);
  await start(page);
  const a = await page.evaluate(() => {
    const g = window.__game!;
    g.revealAll();
    const d = H.clearDeposit('ilmenite');
    const key = `dep:${d.id}`;
    for (let i = 0; i < 60 && !H.pit(key)?.spent; i++) H.dig(d.x, d.z, 800, 2);
    H.dig(d.x, d.z, 300, 2);
    const p = H.pit(key);
    const hub = H.hub('smelter', null, 0, -30, 30); // (its type sets the grade's process)
    g.finishConstruction();
    const qSpent = g.targetGrade(hub, key);
    g.completeTech('deepSounding');
    g.advanceGameSeconds(2);
    const reopened = H.pit(key);
    const qRock = g.targetGrade(hub, key);
    const res = g.getReserves(d.id);
    for (let i = 0; i < 40 && H.pit(key).rockR !== undefined; i++) H.dig(d.x, d.z, 400, 2);
    g.advanceGameSeconds(1);
    return { p, qSpent, reopened, qRock, res, done: H.pit(key), alerts: H.alerts(), centre: res.truth.centre };
  });
  expect(a.p.spent).toBe(true);
  // dug out: a smelter would dig it on at plain grade
  expect(a.qSpent).toBeCloseTo(0.62, 6);
  // reopened: its rim held, its floor to go 2 m into bedrock; bedrock carries 80% of the grade above
  expect(a.reopened.state).toBe('open');
  expect(a.reopened.rockR).toBeCloseTo(a.p.R, 6);
  expect(a.reopened.rockTo).toBe(2);
  expect(a.res.bedrock).toBe(true);
  expect(a.qRock).toBeGreaterThan(0.62 * 0.8 - 1e-9);
  expect(a.qRock).toBeLessThan(a.centre * 0.8 + 1e-9);
  expect(a.alerts.some((t: string) => /^DEEPER BENCHES — high-Ti basalt #\d reopens: .* at ×0\.3 dig \(Deep Sounding Network\)$/.test(t))).toBe(true);
  // its benches cut: deeper by up to 2 m, no wider, and back to dug out
  expect(a.done.rockR).toBeUndefined();
  expect(a.done.rock).toBe(2);
  expect(a.done.deep).toBeGreaterThan(a.p.deep + 1);
  expect(a.done.deep).toBeLessThanOrEqual(a.p.L + 2 + 1e-6);
  // (what it was owed past its benches widens it on a little, at plain grade)
  expect(a.done.R).toBeLessThanOrEqual(a.p.R + 1.5);
  expect(a.done.state).toBe('exhausted');
});

test('the survey: a free rover cores the deposit, pays 30 energy and 2⚙, and reads it to ±30/15/5% with the truth inside', async ({ page }) => {
  test.setTimeout(300_000);
  await start(page);
  const a = await page.evaluate(() => {
    const g = window.__game!;
    const far = g.getDeposits().filter((d: any) => !d.revealed)[0];
    const unmapped = far ? g.surveyWhy(far.id) : 'UNMAPPED';
    g.advanceGameSeconds(1); // the bank settles to its capacity
    const s0 = g.getState();
    const e0 = s0.powerStored, p0 = s0.resources.parts, d0 = s0.data;
    const before = g.getReserves('ilmenite-0');
    g.surveyDeposit('ilmenite-0');
    g.advanceGameSeconds(0); // the action alone, no tick
    const s1 = g.getState();
    const paid = { energy: e0 - s1.powerStored, parts: p0 - s1.resources.parts };
    const job = s1.oreSurvey.jobs.find((j: any) => j.id === 'ilmenite-0');
    const queued = g.surveyWhy('ilmenite-0');
    let kinds = new Set<string>();
    let t = 0;
    for (; t < 900 && !g.getState().oreSurvey.done['ilmenite-0']; t += 5) {
      g.grantPower(20000);
      g.advanceGameSeconds(5);
      for (const r of g.getState().rovers) if (r.core === 'ilmenite-0' && r.trip) kinds.add(r.trip.kind);
    }
    const res = g.getReserves('ilmenite-0');
    const alerts = H.alerts();
    const again = g.surveyWhy('ilmenite-0');
    g.completeTech('sampleCaches');
    g.advanceGameSeconds(1);
    const res15 = g.getReserves('ilmenite-0');
    const alerts15 = H.alerts();
    g.completeTech('gravimetry');
    g.advanceGameSeconds(1);
    const res5 = g.getReserves('ilmenite-0');
    return {
      unmapped, paid, job, queued, t, kinds: [...kinds], before, res, alerts, again, res15, alerts15, res5,
      data: g.getState().data - d0, line: g.surveyLine('ilmenite-0'),
    };
  });
  expect(a.unmapped).toMatch(/^UNMAPPED — map it first/);
  expect(a.before.surveyed).toBe(false);
  expect(a.before.est).toBeNull();
  expect(a.paid.energy).toBeCloseTo(30, 6);
  expect(a.paid.parts).toBeCloseTo(2, 6);
  expect(a.job).toBeTruthy();
  expect(a.queued).toMatch(/^SURVEY (QUEUED|UNDER WAY)/);
  // a rover drove out and cored it
  expect(a.kinds).toContain('core');
  expect(a.t).toBeLessThan(900);
  expect(a.data).toBeGreaterThanOrEqual(5);
  const inside = (r: any) => r.est.lo <= r.truth.ore + 1e-6 && r.truth.ore <= r.est.hi + 1e-6
    && r.est.centreLo <= r.truth.centre + 1e-9 && r.truth.centre <= r.est.centreHi + 1e-9;
  expect(a.res.surveyed).toBe(true);
  expect(a.res.precision).toBeCloseTo(0.3, 6);
  expect(inside(a.res)).toBe(true);
  expect(a.alerts.some((t: string) => /^SURVEYED — high-Ti basalt #0: [\d.]+k?–[\d.]+k?▲ of ore \(±30%\) · centre [\d.]+% ilmenite \(q [\d.]+\) · loose to [\d.]+ m · \d faces? now, \d at full size \(R \d+ m\) · ~[\d.]+ lunar days at one smelter · \+5≡$/.test(t))).toBe(true);
  expect(a.again).toBe('ALREADY SURVEYED (±30%)');
  // research tightens it, re-read free
  expect(a.res15.precision).toBeCloseTo(0.15, 6);
  expect(inside(a.res15)).toBe(true);
  expect(a.alerts15).toContain('SURVEYS RE-READ — 1 deposit now ±15%');
  expect(a.res5.precision).toBeCloseTo(0.05, 6);
  expect(inside(a.res5)).toBe(true);
  expect(a.res5.est.hi - a.res5.est.lo).toBeLessThan(a.res.est.hi - a.res.est.lo);
});

test('strip mines and morale: a crewed base minds a plain pit near home (−1 per 1,000 m²), a deposit\'s less (−0.4); a robotic one shows none', async ({ page, browser }) => {
  test.setTimeout(300_000);
  const once = async (p: Page, exp: 'human' | 'robotic') => {
    await start(p, 'mare', exp);
    return p.evaluate(() => {
      const g = window.__game!;
      H.dig(-60, 34, 5000, 20);
      const plain = g.stripMorale();
      const d = g.getDeposits().find((q: any) => q.id === 'ilmenite-0');
      H.dig(d.x, d.z, 5000, 20);
      const both = g.stripMorale();
      const pits = g.getPits().pits.map((q: any) => ({ key: q.key, scar: q.scar, cx: q.cx, cz: q.cz, R: q.R }));
      const lander = g.getState().buildings.find((b: any) => b.type === 'lander');
      return { plain, both, pits, lander: lander ? g.footprintOf(lander.id) : null, crew: g.getState().crew };
    });
  };
  const h = await once(page, 'human');
  const other = await browser.newPage();
  const r = await once(other, 'robotic');
  await other.close();
  expect(h.crew).toBeGreaterThan(0);
  const L = h.lander!;
  const lx = (L.x0 + L.x1) / 2, lz = (L.z0 + L.z1) / 2;
  const fade = (p: any) => { const d = Math.max(0, Math.hypot(p.cx - lx, p.cz - lz) - p.R); return d <= 100 ? 1 : d >= 250 ? 0 : (250 - d) / 150; };
  const plainPit = h.pits.find((p: any) => p.key.startsWith('dig:'));
  const depPit = h.pits.find((p: any) => p.key === 'dep:ilmenite-0');
  expect(plainPit.scar).toBeGreaterThan(1000);
  expect(h.plain.term).toBeCloseTo(-(plainPit.scar / 1000) * fade(plainPit), 5);
  expect(h.both.term).toBeCloseTo(Math.max(-12, -(plainPit.scar / 1000) * fade(plainPit) - 0.4 * (depPit.scar / 1000) * fade(depPit)), 5);
  expect(h.plain.worst.home).toBe('the Lander');
  expect(r.plain.term).toBe(0);
  expect(r.both.term).toBe(0);
});
