/** Box-drag grading as a rover job (docs/19 S5, core/grading.ts): the player drags a rectangle, rovers
 *  drive there and level it cell by cell over time. Drives the sim through window.__game (?debug). */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

const URL_DEBUG = '/?debug&seed=42&nolock&lowfx';

async function start(page: Page, site = 'mare') {
  await page.goto(`${URL_DEBUG}&site=${site}&exp=robotic`);
  await page.waitForFunction(() => window.__game !== undefined);
  // game time moves only through the fast-forwards: every reading lands on a known tick
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(0); window.__game.holdHazards(true); });
  await page.evaluate(HELPERS);
}

declare const G: any;
/** In-page helpers: G.run(secs) advances with the bank topped up; G.job() the first job (or null);
 *  G.mean / G.secs the numbers a box has from the heightfield samples (the contract: the mean of its
 *  samples, and Σ 4 s × (1 + a cell's relief ÷ 2 m)). */
const HELPERS = `(() => {
const g = () => window.__game;
window.G = {
  run(secs) { for (let t = 0; t < secs; t += 5) { g().grantPower(5000); g().advanceGameSeconds(Math.min(5, secs - t)); } },
  job() { return (g().getState().gradeJobs ?? [])[0] ?? null; },
  /** advance until the first job is gone (or the cap): the game-seconds it took */
  finish(cap = 900) { let t = 0; while (G.job() && t < cap) { G.run(5); t += 5; } return t; },
  samples(x0, z0, x1, z1) { const out = []; for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) out.push(g().terrainSample(ix, iz).h); return out; },
  mean(x0, z0, x1, z1) { const s = G.samples(x0, z0, x1, z1); return s.reduce((a, b) => a + b, 0) / s.length; },
  secs(x0, z0, x1, z1) {
    const h = G.mean(x0, z0, x1, z1);
    let sum = 0;
    for (let gz = z0; gz < z1; gz++) for (let gx = x0; gx < x1; gx++) {
      let dev = 0;
      for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) dev = Math.max(dev, Math.abs(g().terrainSample(gx + dx, gz + dz).h - h));
      sum += Math.round(4 * (1 + dev / 2) * 100) / 100;
    }
    return sum;
  },
  relief(x0, z0, x1, z1) { const s = G.samples(x0, z0, x1, z1); return Math.max(...s) - Math.min(...s); },
};
})()`;

/** the box used at the mare, east of the Lander: 6 × 4 cells */
const BOX = [134, 126, 140, 130] as const;

test('a box makes a job with the right cells and cost; refusals say why', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page);
  const r = await page.evaluate((box) => {
    const g = window.__game;
    const [x0, z0, x1, z1] = box;
    const refused = {
      structure: g.planGrade(122, 122, 132, 132),
      big: g.planGrade(140, 100, 170, 130),
      outside: g.planGrade(0, 0, 10, 10),
      empty: g.planGrade(140, 126, 140, 130),
      // 20 × 20 cells cost 1000 stored energy: more than the bank holds
      poor: g.planGrade(131, 118, 151, 138),
    };
    const stored0 = g.getState().powerStored;
    const flat0 = g.getState().flattens.length;
    const rates = { plain: g.planGrade(...box).eta };
    const want = { h: G.mean(x0, z0, x1, z1), secs: G.secs(x0, z0, x1, z1) };
    g.gradeBox(...box);
    g.advanceGameSeconds(0);
    const s = g.getState();
    const job = s.gradeJobs[0];
    // the same box with Site Grading (the doubled rate) is the same job in half the time
    g.completeTech('siteGrading');
    const fast = g.planGrade(134, 126, 140, 130);
    g.advanceGameSeconds(1);
    return {
      crew: (G.job().rovers ?? []).length,
      refused, stored0, stored1: s.powerStored, want, rates,
      job: { id: job.id, cells: job.cells, h: job.h, total: job.total, left: job.left, done: job.done, energy: job.energy, rect: job.rect },
      alerts: s.alerts.map((a: any) => a.text), fastEta: fast.eta, fastSecs: fast.secs, flattens: s.flattens.length - flat0,
    };
  }, BOX);
  expect(r.refused.structure.reason).toBe('A structure is in the way');
  expect(r.refused.big.reason).toMatch(/^TOO BIG — 30×30 cells; at most 400/);
  expect(r.refused.outside.reason).toBe('Outside survey area');
  expect(r.refused.empty.reason).toBe('Drag a box');
  expect(r.refused.poor.reason).toMatch(/^Need 1000 stored energy — have \d+/);
  // 6 × 4 cells: 24, in the order the rovers level them (a serpentine: each next cell touches the last)
  expect(r.job.rect).toEqual([...BOX]);
  expect(r.job.cells).toHaveLength(24);
  expect(new Set(r.job.cells).size).toBe(24);
  for (const k of r.job.cells) {
    const gx = k % 256, gz = Math.floor(k / 256);
    expect(gx >= 134 && gx < 140 && gz >= 126 && gz < 130).toBe(true);
  }
  for (let i = 1; i < r.job.cells.length; i++) {
    const a = r.job.cells[i - 1], b = r.job.cells[i];
    expect(Math.abs((a % 256) - (b % 256)) + Math.abs(Math.floor(a / 256) - Math.floor(b / 256))).toBe(1);
  }
  // the target is the mean of the box's samples; the work Σ 4 s × (1 + relief ÷ 2 m) a cell; 2.5 energy a cell
  expect(r.job.h).toBeCloseTo(r.want.h, 4);
  expect(r.job.total).toBeCloseTo(r.want.secs, 1);
  expect(r.job.left).toBeCloseTo(r.job.total, 6);
  expect(r.job.done).toBe(0);
  expect(r.job.energy).toBe(60);
  expect(r.stored0 - r.stored1).toBeCloseTo(60, 6);
  expect(r.alerts.some((t: string) => t.startsWith('GRADING QUEUED — 6×4 cells'))).toBe(true);
  expect(r.crew).toBe(1); // one rover on a job of 32 cells or fewer
  // Site Grading doubles every rover's rate: the same seconds of work, half the time
  expect(r.fastSecs).toBeCloseTo(r.job.total, 1);
  expect(r.fastEta).toBeCloseTo(r.rates.plain / 2, 3);
  // no flatten yet
  expect(r.flattens).toBe(0);
});

test('nothing flattens until a rover arrives; cells then level one by one and the pad ends level', async ({ page }) => {
  test.setTimeout(300_000);
  await start(page);
  const r = await page.evaluate((box) => {
    const g = window.__game;
    const [x0, z0, x1, z1] = box;
    g.grantPower(500);
    const h0 = g.terrainHash();
    const flat0 = g.getState().flattens.length;
    const relief0 = G.relief(x0, z0, x1, z1);
    const target = G.mean(x0, z0, x1, z1);
    g.gradeBox(...box);
    g.advanceGameSeconds(1);
    // the rover sets off: on its way, and the ground is as it was
    const first = g.getState().rovers.find((r: any) => r.grade !== undefined);
    const drive = { kind: first.trip.kind, arrived: first.trip.t >= first.trip.dur - 1e-9, stuck: !!first.trip.stuck };
    let hashWhileDriving = g.terrainHash();
    let flatWhileDriving = g.getState().flattens.length - flat0;
    // run until it has arrived: nothing has moved before that
    let arrivedAt = -1;
    for (let t = 0; t < 120 && arrivedAt < 0; t++) {
      const rv = g.getState().rovers.find((q: any) => q.grade !== undefined);
      if (rv.trip.t >= rv.trip.dur - 1e-9 && rv.trip.kind === 'grade') { arrivedAt = t; break; }
      hashWhileDriving = g.terrainHash();
      flatWhileDriving = g.getState().flattens.length - flat0;
      G.run(1);
    }
    const before = { hash: g.terrainHash(), flat: g.getState().flattens.length };
    // then the cells level in turn: each step a few cells; the entries and the levelled ground add up
    const steps: { done: number; flat: number; left: number }[] = [];
    let last = -1, jump = 0, levelled = 0;
    for (let t = 0; t < 900 && G.job(); t++) {
      G.run(1);
      const j = G.job();
      if (!j) break;
      if (j.done !== last) {
        jump = Math.max(jump, j.done - Math.max(last, 0));
        last = j.done;
        steps.push({ done: j.done, flat: g.getState().flattens.length, left: j.left });
      }
    }
    // the levelled cells stood at the target height as they levelled (checked on the last entry that is a single cell)
    const s = g.getState();
    const cellEntries = s.flattens.filter((f: any) => f.noSkirt);
    for (const f of cellEntries) if (Math.abs(f.h - target) > 1e-6 || f.x1 - f.x0 !== 1 || f.z1 - f.z0 !== 1) levelled++;
    return {
      h0, flat0, relief0, target, drive, hashWhileDriving, flatWhileDriving, arrivedAt, before, steps, jump,
      relief1: G.relief(x0, z0, x1, z1), flat: s.flattens, job: G.job(), alerts: s.alerts.map((a: any) => a.text),
      hash1: g.terrainHash(), levelled, rovers: s.rovers.map((q: any) => ({ id: q.id, grade: q.grade })),
      corners: G.samples(x0, z0, x1, z1),
    };
  }, BOX);
  expect(r.drive.kind).toBe('grade');
  expect(r.drive.arrived).toBe(false);
  // the ground is untouched while the rover drives out (and until the tick it arrives in)
  expect(r.hashWhileDriving).toBe(r.h0);
  expect(r.flatWhileDriving).toBe(0);
  expect(r.arrivedAt).toBeGreaterThan(3);
  expect(r.relief0).toBeGreaterThan(0.5);
  // one entry a cell, growing as the job goes; never a whole rectangle's worth at once
  expect(r.steps.length).toBeGreaterThan(8);
  expect(r.jump).toBeLessThanOrEqual(3);
  for (let i = 1; i < r.steps.length; i++) expect(r.steps[i].flat - r.steps[i - 1].flat).toBe(r.steps[i].done - r.steps[i - 1].done);
  // the pad ends level, at the mean, the job gone with its rover free; 24 cell entries and one whole rectangle
  expect(r.relief1).toBeLessThan(0.05);
  for (const v of r.corners) expect(v).toBeCloseTo(r.target, 3);
  expect(r.job).toBeNull();
  expect(r.flat).toHaveLength(r.flat0 + 25);
  expect(r.flat.filter((f: any) => f.noSkirt)).toHaveLength(24);
  expect(r.flat[r.flat0 + 24]).toEqual({ x0: 134, z0: 126, x1: 140, z1: 130, h: r.flat[r.flat0 + 24].h });
  expect(r.levelled).toBe(0);
  expect(r.alerts.some((t: string) => t.startsWith('GRADING DONE — 6×4 cells'))).toBe(true);
  for (const q of r.rovers) expect(q.grade).toBeUndefined();
  expect(r.hash1).not.toBe(r.h0);
});

test('cancel refunds the cells not yet levelled and frees the rovers; the levelled ones stay', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page);
  const r = await page.evaluate((box) => {
    const g = window.__game;
    const [x0, z0, x1, z1] = box;
    g.grantPower(500);
    const p0 = g.getState().powerStored;
    g.gradeBox(...box);
    g.advanceGameSeconds(0);
    const paid = p0 - g.getState().powerStored;
    g.advanceGameSeconds(1);
    // work until a few cells have levelled
    let t = 0;
    while ((G.job()?.done ?? 0) < 6 && t < 300) { G.run(1); t++; }
    const j = G.job();
    const done = j.done, cells = j.cells.slice();
    const flat0 = g.getState().flattens.length;
    const stored = g.getState().powerStored;
    const hashBefore = g.terrainHash();
    g.cancelGrade(j.id);
    g.advanceGameSeconds(0);
    const s = g.getState();
    const after = {
      job: G.job(), refunded: s.powerStored - stored, flat: s.flattens.length, hash: g.terrainHash(),
      alerts: s.alerts.map((a: any) => a.text), rovers: s.rovers.map((q: any) => ({ id: q.id, grade: q.grade })),
    };
    // the levelled cells hold their height, the rest is as it was; the rovers go home
    const h = j.h;
    const level = (k: number) => [[0, 0], [1, 0], [0, 1], [1, 1]].every(([dx, dz]) => Math.abs(g.terrainSample(k % 256 + dx, Math.floor(k / 256) + dz).h - h) < 1e-4);
    const doneLevel = cells.slice(0, done).every(level);
    const undoneOff = cells.slice(done + 2).some((k: number) => !level(k));
    G.run(30);
    const homeward = g.getState().rovers.map((q: any) => q.trip?.kind);
    return { paid, done, total: cells.length, after, flat0, doneLevel, undoneOff, homeward, hashBefore };
  }, BOX);
  expect(r.paid).toBe(60);
  expect(r.done).toBeGreaterThanOrEqual(6);
  expect(r.after.job).toBeNull();
  // 24 cells cost 60; the undone ones come back: (24 − done) × 2.5
  expect(r.after.refunded).toBeCloseTo(((r.total - r.done) * 60) / r.total, 1);
  expect(r.after.alerts.some((t: string) => t.startsWith(`GRADING CANCELLED — ${r.total - r.done} of ${r.total} cells undone`))).toBe(true);
  // nothing more levels: the entries and the ground stand as they were at the cancel
  expect(r.after.flat).toBe(r.flat0);
  expect(r.after.hash).toBe(r.hashBefore);
  expect(r.doneLevel).toBe(true);
  expect(r.undoneOff).toBe(true);
  for (const q of r.after.rovers) expect(q.grade).toBeUndefined();
  for (const k of r.homeward) expect(k).toBe('dock');
});

test('a big box takes two rovers, Site Grading doubles their rate, and the drag tool queues, cancels and leaves', async ({ page }) => {
  test.setTimeout(300_000);
  await start(page);
  // a 10 × 5 box (50 cells: two rovers), at the base rate then with Site Grading: the work done in a window
  const rate = () => page.evaluate(() => {
    const g = window.__game;
    // until every rover on it is at work
    let t = 0;
    while (t < 200 && !(G.job() && g.getState().rovers.filter((q: any) => q.task === 'grade').length === G.job().rovers.length)) { G.run(1); t++; }
    const j = G.job();
    const l0 = j.left;
    G.run(20);
    const j1 = G.job();
    return { rovers: j.rovers.length, worked: l0 - j1.left, crew: g.getState().rovers.filter((q: any) => q.grade === j.id).length };
  });
  await page.evaluate(() => { window.__game.grantPower(500); window.__game.gradeBox(134, 126, 144, 131); window.__game.advanceGameSeconds(1); });
  const plain = await rate();
  await page.evaluate(() => { window.__game.cancelGrade(G.job().id); window.__game.advanceGameSeconds(0); });
  await page.evaluate(() => { window.__game.completeTech('siteGrading'); window.__game.grantPower(500); window.__game.gradeBox(134, 126, 144, 131); window.__game.advanceGameSeconds(1); });
  const fast = await rate();
  expect(plain.rovers).toBe(2);
  expect(plain.crew).toBe(2);
  expect(fast.rovers).toBe(2);
  // about two rover-seconds a second with two rovers, nearly twice that with Site Grading (the drive from cell to cell caps it)
  expect(plain.worked).toBeGreaterThan(20);
  expect(plain.worked).toBeLessThanOrEqual(41);
  expect(fast.worked / plain.worked).toBeGreaterThan(1.6);
  expect(fast.worked / plain.worked).toBeLessThan(2.3);
  await page.evaluate(() => { window.__game.cancelGrade(G.job().id); window.__game.advanceGameSeconds(0); });

  // the tool: the palette's button, a drag over the ground is a box (previewed with its cost), release queues it
  await page.evaluate(() => { window.__game.grantPower(800); window.__game.setPaused(false); window.__game.setPaused(true); });
  await page.locator('#palette .btn', { hasText: 'Extraction' }).click();
  const btn = page.locator('#grade-btn');
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.locator('#grade-hint')).toBeVisible();
  await page.mouse.move(900, 500);
  await page.mouse.down();
  await page.mouse.move(1100, 610, { steps: 8 });
  await page.waitForTimeout(150);
  const mid = await page.evaluate(() => ({ tool: window.__game.getGrading().tool, hint: document.querySelector('#grade-hint')?.textContent ?? '' }));
  expect(mid.tool.active).toBe(true);
  expect(mid.tool.dragging).toBe(true);
  expect(mid.tool.plan.ok).toBe(true);
  expect(mid.tool.preview).toBe(mid.tool.plan.cells);
  expect(mid.hint).toMatch(/GRADE \d+×\d+ CELLS/i);
  expect(mid.hint).toMatch(/rover/i);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const queued = await page.evaluate(() => { window.__game.advanceGameSeconds(0); return window.__game.getGrading(); });
  expect(queued.jobs).toHaveLength(1);
  expect(queued.jobs[0].cells).toBe(mid.tool.plan.cells);
  // the tool stays on for the next box; a click without a drag grades the 16 m square (4 × 4), off the first box
  expect(queued.tool.active).toBe(true);
  await page.mouse.move(700, 700);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
  const two = await page.evaluate(() => { window.__game.advanceGameSeconds(0); return window.__game.getGrading(); });
  expect(two.jobs.length).toBeGreaterThanOrEqual(1);
  // the fleet panel lists the jobs; Cancel takes one back and refunds
  await page.keyboard.press('Escape');
  await expect(page.locator('#grade-hint')).toBeHidden();
  await page.evaluate(() => window.__game.advanceGameSeconds(1));
  await expect(page.locator('#grade-jobs .grade-job')).toHaveCount(two.jobs.length);
  const before = await page.evaluate(() => window.__game.getState().powerStored);
  await page.locator('#grade-jobs .grade-cancel').first().click();
  await page.evaluate(() => window.__game.advanceGameSeconds(0));
  const after = await page.evaluate(() => ({ jobs: window.__game.getGrading().jobs.length, stored: window.__game.getState().powerStored }));
  expect(after.jobs).toBe(two.jobs.length - 1);
  expect(after.stored).toBeGreaterThan(before);
});

test('save and load mid-job: the job carries on and the ground comes back exactly', async ({ page, browser }) => {
  test.setTimeout(300_000);
  await start(page);
  const a = await page.evaluate((box) => {
    const g = window.__game;
    g.grantPower(500);
    g.gradeBox(...box);
    G.run(60);
    const j = G.job();
    const blob = g.saveBlob();
    const state = { done: j.done, hash: g.terrainHash(), flat: g.getState().flattens.length };
    G.run(40);
    return { blob, state, later: { job: G.job() ? { done: G.job().done, left: G.job().left } : null, hash: g.terrainHash(), flat: g.getState().flattens.length } };
  }, BOX);
  expect(a.state.done).toBeGreaterThan(2);
  expect(a.state.done).toBeLessThan(24);
  // the flatten history has the cell entries so far, none of them with a skirt
  expect(a.blob.state.flattens.filter((f: any) => f.noSkirt)).toHaveLength(a.state.done);
  const other = await browser.newPage();
  await start(other);
  const b = await other.evaluate((blob) => {
    const g = window.__game;
    g.loadBlob(blob);
    g.holdHazards(true);
    const j0 = G.job();
    const state = { done: j0.done, hash: g.terrainHash(), flat: g.getState().flattens.length, rovers: j0.rovers };
    G.run(40);
    return { state, later: { job: G.job() ? { done: G.job().done, left: G.job().left } : null, hash: g.terrainHash(), flat: g.getState().flattens.length } };
  }, a.blob);
  await other.close();
  // the same ground on load (base → deltas → flattens, the cells in order), and the same job after
  expect(b.state.hash).toBe(a.state.hash);
  expect(b.state.done).toBe(a.state.done);
  expect(b.state.flat).toBe(a.state.flat);
  expect(b.later).toEqual(a.later);
});

test('a spoil heap levels at the pole (with Site Grading), and a pad stands on it', async ({ page }) => {
  test.setTimeout(300_000);
  await start(page, 'southpole');
  const r = await page.evaluate(() => {
    const g = window.__game;
    const dig = (x: number, z: number, t: number, steps = 20) => { for (let i = 0; i < steps; i++) { g.pitDig(x, z, t / steps); g.advanceGameSeconds(12); } };
    dig(-14, 24, 3000);
    const pit = g.getPits().pits[0];
    // the network reaches the heap: a relay mast between it and the Lander
    g.grantPower(5000);
    g.grantResources({ metals: 5000, parts: 5000 });
    g.completeTech('prospectingRovers');
    const a = Math.atan2(pit.heap.z, pit.heap.x);
    const cx = Math.round((Math.cos(a) * 52 + 512) / 4) - 1, cz = Math.round((Math.sin(a) * 52 + 512) / 4) - 1;
    let ok = false;
    for (let r = 0; r < 6 && !ok; r++) for (let dx = -r; dx <= r && !ok; dx++) for (let dz = -r; dz <= r && !ok; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      ok = g.placeBuilding('relayMast', cx + dx, cz + dz, 0);
    }
    g.finishConstruction();
    const hx = Math.round((pit.heap.x + 512) / 4) - 2, hz = Math.round((pit.heap.z + 512) / 4) - 2;
    const relief0 = G.relief(hx, hz, hx + 4, hz + 4);
    const spoilSamples = [] as number[];
    for (let iz = hz; iz <= hz + 4; iz++) for (let ix = hx; ix <= hx + 4; ix++) spoilSamples.push(g.terrainSample(ix, iz).delta);
    const refused = g.planGrade(hx, hz, hx + 4, hz + 4);
    const canBuild0 = g.canPlace('solar', hx + 1, hz + 1, 0).reason;
    g.completeTech('siteGrading');
    const plan = g.planGrade(hx, hz, hx + 4, hz + 4);
    const stored0 = g.getState().powerStored;
    const reg0 = g.getState().resources.regolith;
    g.gradeBox(hx, hz, hx + 4, hz + 4);
    g.advanceGameSeconds(0);
    const queued = G.job() !== null;
    const took = G.finish(900);
    const s = g.getState();
    const padded = [] as number[];
    for (let iz = hz; iz <= hz + 4; iz++) for (let ix = hx; ix <= hx + 4; ix++) padded.push(g.terrainSample(ix, iz).pad);
    return {
      relief0, spoil: spoilSamples.filter((d) => d > 0).length, refused: { ok: refused.ok, reason: refused.reason }, canBuild0,
      plan: { ok: plan.ok, spoil: plan.spoil, energy: plan.energy, cells: plan.cells }, queued, took,
      relief1: G.relief(hx, hz, hx + 4, hz + 4), padded, spent: stored0 - s.powerStored, regolith: s.resources.regolith - reg0,
      canBuild: g.canPlace('solar', hx + 1, hz + 1, 0), job: G.job(),
    };
  });
  // a heap is refused without Site Grading, and costs more per cell with it (× (1 + relief ÷ 2 m) a heap cell)
  expect(r.spoil).toBeGreaterThan(8);
  expect(r.refused.ok).toBe(false);
  expect(r.refused.reason).toBe('ON SPOIL — a tailings heap; Site Grading lets rovers level it');
  expect(r.canBuild0).toMatch(/^ON SPOIL/);
  expect(r.plan.ok).toBe(true);
  expect(r.plan.spoil).toBeGreaterThan(8);
  expect(r.plan.energy).toBeGreaterThan(40);
  expect(r.queued).toBe(true);
  expect(r.job).toBeNull();
  expect(r.relief0).toBeGreaterThan(1);
  expect(r.relief1).toBeLessThan(0.05);
  // the heap's samples are pad now: pits and roads see graded ground, and a structure stands on it
  for (const p of r.padded) expect(p).toBe(1);
  expect(r.canBuild.valid).toBe(true);
  // its spoil goes to a hopper or the pile
  expect(r.regolith).toBeGreaterThan(20);
});

test('a building placed on the finished pad is valid', async ({ page }) => {
  test.setTimeout(300_000);
  await start(page, 'southpole');
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.completeTech('thoriumPower');
    g.completeTech('siteGrading');
    g.grantResources({ metals: 300, parts: 100 });
    const centreOf = (gx: number, gz: number, w = 3, d = 3) => [(gx + w / 2) * 4 - 512, (gz + d / 2) * 4 - 512];
    const fromLander = (x: number, z: number) => Math.hypot(x + 2, z + 2);
    // a rough 3 × 3 spot the large-pad rule refuses (over 0.8 m of relief), that a 2 × 2 array still takes
    let spot: any = null;
    for (let gx = 114; gx <= 138 && !spot; gx++) {
      for (let gz = 114; gz <= 138 && !spot; gz++) {
        const [x, z] = centreOf(gx, gz);
        if (fromLander(x, z) > 50 || fromLander(x, z) < 26) continue;
        const reactor = g.canPlace('reactor', gx, gz).reason;
        if (/^Too rough for a large pad/.test(reactor) && g.canPlace('solar', gx, gz).valid) spot = { gx, gz, reactor };
      }
    }
    if (!spot) return null;
    // a box round it, graded by the rovers (not the instant pass)
    g.grantPower(5000);
    g.gradeBox(spot.gx - 1, spot.gz - 1, spot.gx + 4, spot.gz + 4);
    g.advanceGameSeconds(0);
    // while they work nothing may be built on it
    const during = g.canPlace('reactor', spot.gx, spot.gz).reason;
    const took = G.finish(900);
    const relief = G.relief(spot.gx - 1, spot.gz - 1, spot.gx + 4, spot.gz + 4);
    const done = g.canPlace('reactor', spot.gx, spot.gz);
    const placed = g.placeBuilding('reactor', spot.gx, spot.gz, 0);
    return { ...spot, during, took, done, placed, relief, left: G.job() };
  });
  expect(r).not.toBeNull();
  expect(r!.reactor).toMatch(/^Too rough for a large pad \(\d\.\d m relief > 0\.8 m\) — grade it \(Grade Site\)$/);
  expect(r!.during).toMatch(/^BEING GRADED/);
  expect(r!.left).toBeNull();
  expect(r!.relief).toBeLessThan(0.05);
  expect(r!.done.valid).toBe(true);
  expect(r!.placed).toBe(true);
});
