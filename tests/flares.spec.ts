/** Space weather, phases F1 and F2a (docs/16 §15): classed flares on a
 *  seeded solar cycle, drills and era floors, the telegraphs, the tail and
 *  the CME, the spot-group watch, the legacy mode; the flare pop-up and its
 *  previews, the portion rule and the critical feed, remembered choices,
 *  field overrides and the safe default; arrays destroyed or scarred while
 *  running, repairable damage when stowed, wrecks, repairs, field berms,
 *  flareStance, the migration, and the pop-up's fit. Every test pauses the
 *  game and drives time with advanceGameSeconds. */
import { test, expect as baseExpect, type Page } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 20_000 });

declare global {
  interface Window { __game?: any; fx?: any }
}

const URL_DEBUG = '/?debug&nolock&lowfx';

async function pauseAtAttach(page: Page) {
  await page.addInitScript(() => {
    let v: any;
    Object.defineProperty(window, '__game', { configurable: true, get: () => v, set: (x) => { v = x; x.setPaused(true); } });
  });
}

async function start(page: Page, o: { site?: string; exp?: 'human' | 'robotic'; seed?: number; extra?: string } = {}) {
  await pauseAtAttach(page);
  const { site = 'mare', exp = 'robotic', seed = 42, extra = '' } = o;
  await page.goto(`${URL_DEBUG}&seed=${seed}&site=${site}${exp === 'robotic' ? '&exp=robotic' : ''}${extra}`);
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => {
    const g = window.__game;
    g.openRoads(true); g.instantTravel(true); g.holdHazards(true); g.setPaused(true); g.advanceGameSeconds(0);
  });
  await page.evaluate(HELPERS);
}

/** In-page helpers: fields of arrays placed side by side, finished; the flare log; one flare run through. */
const HELPERS = `(() => {
  const g = window.__game;
  const ring = function* (r) {
    const c = 127;
    for (let i = -r; i <= r; i++) { yield [c + i, c - r]; yield [c + i, c + r]; }
    for (let i = -r + 1; i <= r - 1; i++) { yield [c - r, c + i]; yield [c + r, c + i]; }
  };
  window.fx = {
    /** n Solar Arrays touching in a row (one field), near the Lander from ring r0; their ids */
    field(n, r0 = 6) {
      g.grantResources({ metals: 30 * n + 50 });
      for (let r = r0; r < 60; r++) for (const [gx, gz] of ring(r)) {
        let ok = true;
        for (let i = 0; i < n && ok; i++) ok = g.canPlace('solar', gx + 2 * i, gz, 0).valid;
        if (!ok) continue;
        const ids = [];
        for (let i = 0; i < n; i++) {
          if (!g.placeBuilding('solar', gx + 2 * i, gz, 0)) break;
          const s = g.getState(); ids.push(s.buildings[s.buildings.length - 1].id);
        }
        if (ids.length === n) { g.finishConstruction(); return ids; }
      }
      return [];
    },
    /** one of a type near the Lander, finished; its id */
    place(type, r0 = 3) {
      g.grantResources({ metals: 400, parts: 200, silicon: 200, chips: 60 });
      for (let r = r0; r < 60; r++) for (const [gx, gz] of ring(r)) {
        if (g.canPlace(type, gx, gz, 0).valid && g.placeBuilding(type, gx, gz, 0)) {
          g.finishConstruction();
          const s = g.getState(); return s.buildings[s.buildings.length - 1].id;
        }
      }
      return null;
    },
    b: (id) => g.getState().buildings.find((x) => x.id === id),
    arrays: () => g.getState().buildings.filter((b) => b.type === 'solar'),
    flare: () => g.getState().flare,
    log: () => g.getState().flare.log ?? [],
    alert: (re) => g.getState().alerts.find((a) => new RegExp(re).test(a.text)),
    /** run the flare in flight to its end (and 1 s beyond) */
    finish() { for (let i = 0; i < 900 && g.getState().flare.phase !== 'idle'; i++) g.advanceGameSeconds(1); g.advanceGameSeconds(1); },
    /** advance to t s before the protons */
    toProtons(t = 0) { const f = g.getState().flare; g.advanceGameSeconds(Math.max(0, Math.round(f.timer - t))); },
    mulberry32(seed) {
      let a = seed >>> 0;
      return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    },
  };
})()`;

// ─────────────────────────── F1: classes and the cycle ───────────────────────────

/** docs/16 §3.5: the three probe seeds on docs/14 §6's mare era times (class, game-minute) */
const SEQ: Record<number, string> = {
  42: 'C29 M58 C79 M97 C121 X143 M161 X179 C197',
  7: 'C29 M61 C88 M111 X129 M148 X164 M191',
  1234: 'C29 M59 C82 M100 X123 C144 X166 C186 M208',
};
const MARE_ERAS = [0, 23.8, 50.4, 84.2, 108.3, 137.2, 160.2, 188.0];

for (const seed of [42, 7, 1234]) {
  test(`schedule, seed ${seed}: §3.5's classes on forced era times; a C drill first, M from Era 2, X from Era 4 two days apart; the watch half a day before each X`, async ({ page }) => {
    await start(page, { seed });
    const r = await page.evaluate(({ eras, until }) => {
      const g = window.__game;
      const watches: number[] = [];
      let watched = false;
      for (let t = 0; t < until * 60; t += 10) {
        const s = g.getState();
        const min = s.simTime / 60;
        let era = 1;
        for (let i = 0; i < 8; i++) if (min >= eras[i]) era = i + 1;
        if (era > s.era) g.forceEra(era);
        const w = s.alerts.some((a: any) => a.key === 'flare-watch');
        if (w && !watched) watches.push(s.simTime);
        watched = w;
        g.advanceGameSeconds(10);
      }
      const s = g.getState();
      return { log: s.flare.log.map((f: any) => ({ cls: f.cls, at: f.at, era: f.era, drill: f.drill })), watches };
    }, { eras: MARE_ERAS, until: 213 });
    const want = SEQ[seed].split(' ').map((x) => ({ cls: x[0], min: Number(x.slice(1)) }));
    const got = r.log.filter((f) => f.at / 60 < want[want.length - 1].min + 4);
    expect(got.map((f) => f.cls).join('')).toBe(want.map((f) => f.cls).join(''));
    // each drill's extra minute (the C drill's, the first X's) moves every later flare a minute on
    const firstX = got.findIndex((f) => f.cls === 'X');
    got.forEach((f, i) => expect(Math.abs(f.at / 60 - want[i].min - (i > 0 ? 1 : 0) - (firstX >= 0 && i > firstX ? 1 : 0))).toBeLessThanOrEqual(0.8));
    expect(got[0].drill).toBe(true);
    expect(got[0].at).toBe(1728);
    expect(got.find((f) => f.era >= 2 && !f.drill)?.cls).toBe('M');
    for (const f of got) if (f.era < 2) expect(f.cls).toBe('C');
    const xs = got.filter((f) => f.cls === 'X');
    for (const f of xs) expect(f.era).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < xs.length; i++) expect(xs[i].at - xs[i - 1].at).toBeGreaterThanOrEqual(2 * 720);
    expect(xs[0].drill).toBe(true);
    if (xs[1]) expect(xs[1].drill).toBe(false);
    // the spot-group watch: up half a day (360 s) before every X, and never for a flare that is not
    expect(r.watches.length).toBe(xs.length);
    xs.forEach((x, i) => expect(x.at - r.watches[i]).toBeGreaterThanOrEqual(350));
  });
}

test('the cycle: quiet at landing, a maximum at day 10–12, deterministic per seed; the class odds follow docs/16 §3.4', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const a = (T: number) => g.weatherCycle(T).a;
    return {
      c: g.weatherCycle(0), a0: a(0), a8: a(8), aMax: Math.max(...Array.from({ length: 81 }, (_, i) => a(i * 0.25))),
      peakAt: Array.from({ length: 81 }, (_, i) => i * 0.25).reduce((m, T) => (a(T) > a(m) ? T : m), 0),
      again: g.weatherCycle(6).a === a(6), o1: g.classOdds(0.1, 1), o2: g.classOdds(0.17, 2), o8: g.classOdds(0.78, 4), o3: g.classOdds(0.9, 3),
    };
  });
  expect(r.a0).toBeCloseTo(0.1, 5);
  expect(r.c.tMax).toBeGreaterThanOrEqual(10);
  expect(r.c.tMax).toBeLessThanOrEqual(12);
  expect(r.peakAt).toBeGreaterThanOrEqual(10);
  expect(r.peakAt).toBeLessThanOrEqual(12);
  expect(r.aMax).toBeGreaterThanOrEqual(0.85);
  expect(r.again).toBe(true);
  expect(r.o1).toEqual({ C: 1, M: 0, X: 0 });           // Era 1: C only
  expect(Math.round(r.o2.M * 100)).toBe(28);            // 0.20 + 0.45 a
  expect(r.o3.X).toBe(0);                               // no X before Era 4
  expect(r.o8.X).toBeCloseTo(0.25 * 0.78 * 0.78, 5);
});

test('phases: telegraphs 60 · 60 · 120 s (+60 on a drill), active 30 · 45 · 60 s, an X’s 120 s tail; a CME 288 s after an X’s flash; the hazard gap counts the tail', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const f = () => g.getState().flare;
    const run = (cls: string, drill: boolean) => {
      g.forceFlare(cls, { drill });
      const tg = f().timer;
      window.fx.toProtons(0);
      g.advanceGameSeconds(1);
      const phase1 = f().phase, act = f().timer + 1;
      const startedAt = f().startedAt;
      window.fx.toProtons(0);
      g.advanceGameSeconds(1);
      const phase2 = f().phase, tail = phase2 === 'tail' ? f().timer + 1 : 0;
      const cme = f().cme;
      window.fx.finish();
      const end = g.getState().simTime;
      return { tg, phase1, act, phase2, tail, cme: cme ? cme.at - startedAt : null, endGap: end - g.getHazards().state.flareEndAt };
    };
    return { c: run('C', false), cd: run('C', true), m: run('M', false), x: run('X', false), xd: run('X', true) };
  });
  expect(r.c.tg).toBe(60); expect(r.c.act).toBe(30); expect(r.c.phase2).toBe('idle');
  expect(r.cd.tg).toBe(120);
  expect(r.m.tg).toBe(60); expect(r.m.act).toBe(45);
  expect(r.x.tg).toBe(120); expect(r.x.act).toBe(60); expect(r.x.phase2).toBe('tail'); expect(r.x.tail).toBe(120);
  expect(r.xd.tg).toBe(180);
  expect(r.x.cme).toBe(288);
  // the hazard scheduler's 90 s gap runs from the end of the tail
  expect(r.x.endGap).toBeLessThanOrEqual(2);
});

test('legacy mode reproduces today’s flare: 60 s warned, 45 s of solar 0, −10 morale, the day-indexed interval', async ({ page }) => {
  await start(page, { exp: 'human' });
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.setFlareMode('legacy');
    window.fx.field(3);
    // the crew kept alive to the first flare
    while (g.getState().simTime < 1600) { g.grantResources({ oxygen: 100, food: 60, water: 60 }); g.advanceGameSeconds(100); }
    g.grantResources({ oxygen: 100, food: 60, water: 60 });
    g.advanceGameSeconds(1728 - Math.round(g.getState().simTime) - 1);
    g.advanceGameSeconds(2);
    const tele = { phase: window.fx.flare().phase, timer: window.fx.flare().timer };
    g.advanceGameSeconds(58);
    const m0 = g.getState().morale;
    g.advanceGameSeconds(2);
    const act = { phase: window.fx.flare().phase, solar: g.getState().power.solar, morale: m0 - g.getState().morale };
    g.advanceGameSeconds(44);
    const end = { phase: window.fx.flare().phase, nextAt: window.fx.flare().nextAt, t: g.getState().simTime };
    const pop = g.getSpaceWeather().popup;
    return { tele, act, end, pop, day: Math.floor(end.t / 720) };
  });
  expect(r.tele).toEqual({ phase: 'telegraph', timer: 59 });
  expect(r.act.phase).toBe('active');
  expect(r.act.solar).toBe(0);
  expect(r.act.morale).toBeGreaterThanOrEqual(9.5);
  expect(r.end.phase).toBe('idle');
  const want = await page.evaluate(({ t, day }) => {
    const j = window.fx.mulberry32((42 ^ 0x5f1a) + day)();
    return t + (2.0 + (j - 0.5) * 2 * 0.8) * 720;
  }, { t: r.end.t, day: r.day });
  expect(r.end.nextAt).toBeCloseTo(want, 3);
  expect(r.pop).toBeNull(); // no pop-up in the legacy flare
});

test('morale and heliophysics data by class; the lava tube shelters its crew but its arrays still stow', async ({ page }) => {
  await start(page, { exp: 'human' });
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.fx.place('lab');
    g.grantCrew(4);
    const out: any = {};
    for (const cls of ['C', 'M', 'X']) {
      g.advanceGameSeconds(5);
      g.forceFlare(cls, { drill: false });
      window.fx.toProtons(1);
      const m0 = g.getState().morale;
      const d0 = g.getState().data;
      g.advanceGameSeconds(2);
      out[cls] = { hit: Math.round(m0 - g.getState().morale), data: Math.round(g.getState().data - d0) };
      window.fx.finish();
    }
    return out;
  });
  expect(r.C.hit).toBeGreaterThanOrEqual(3); expect(r.C.hit).toBeLessThanOrEqual(4);
  expect(r.M.hit).toBeGreaterThanOrEqual(8); expect(r.M.hit).toBeLessThanOrEqual(9);
  expect(r.X.hit).toBeGreaterThanOrEqual(12); expect(r.X.hit).toBeLessThanOrEqual(13);
  expect(r.C.data).toBeGreaterThanOrEqual(15); expect(r.M.data).toBeGreaterThanOrEqual(30); expect(r.X.data).toBeGreaterThanOrEqual(60);
  expect(r.C.data).toBeLessThan(20); expect(r.M.data).toBeLessThan(35); expect(r.X.data).toBeLessThan(65);

  await start(page, { site: 'lavatube', exp: 'human' });
  const t = await page.evaluate(() => {
    const g = window.__game;
    const ids = window.fx.field(3);
    g.forceFlare('M', { drill: false });
    window.fx.toProtons(1);
    const m0 = g.getState().morale;
    g.advanceGameSeconds(3);
    return { hit: m0 - g.getState().morale, stowed: ids.filter((id: number) => (window.fx.b(id).stowT ?? 0) > 0.5).length, site: g.getState().siteId };
  });
  expect(t.hit).toBeLessThan(1);
  expect(t.stowed).toBe(3);
});

// ─────────────────────────── F2a: the pop-up and the arrays ───────────────────────────

test('the pop-up opens at the telegraph and pauses an M; the range firms 20 s in; Confirm sets every array; the choice locks 10 s before the protons', async ({ page }) => {
  await start(page, { extra: '&flarepause' });
  await page.evaluate(() => { window.fx.field(4); window.fx.field(3, 14); });
  await page.evaluate(() => { const g = window.__game; g.setPaused(false); g.advanceGameSeconds(0); g.forceFlare('M', { drill: false }); g.advanceGameSeconds(1); });
  const pop = page.locator('#flare-popup');
  await expect(pop).toBeVisible();
  await expect(pop).not.toHaveClass(/compact/);
  await expect(pop.locator('.fp-t')).toContainText(/class (C–M|M–X) \(a range: firm in/);
  expect(await page.evaluate(() => window.__game.getState().paused)).toBe(true);
  // 20 s in: firm
  await page.evaluate(() => window.__game.advanceGameSeconds(20));
  await expect(pop.locator('.fp-t')).toContainText('class M');
  await expect(pop.locator('.fp-t')).not.toContainText('range');
  // choose Keep all running, Confirm: the pop-up folds into its line, the game runs on
  await pop.locator('.fp-row[data-k="run"]').click();
  await pop.locator('.fp-confirm').click();
  await page.evaluate(() => window.__game.advanceGameSeconds(0));
  await expect(pop).toHaveClass(/compact/);
  const s1 = await page.evaluate(() => {
    const s = window.__game.getState();
    return { by: s.flare.decidedBy, choice: s.flare.choice, paused: s.paused };
  });
  expect(s1).toEqual({ by: 'click', choice: { mode: 'run' }, paused: false });
  // 10 s before the protons the plan locks: every array follows it, and a change is refused
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.fx.toProtons(10);
    g.advanceGameSeconds(1);
    g.flareChoice({ mode: 'stow' });
    g.advanceGameSeconds(1);
    const s = g.getState();
    return {
      locked: s.flare.plan?.locked, choice: s.flare.choice, stow: window.fx.arrays().filter((b: any) => b.stow).length,
      refused: !!window.fx.alert('^TOO LATE TO CHANGE'),
    };
  });
  expect(r.locked).toBe(true);
  expect(r.choice).toEqual({ mode: 'run' });
  expect(r.stow).toBe(0);
  expect(r.refused).toBe(true);
});

test('previews are exact: an X on running unshielded arrays destroys half (a seeded draw); stowed arrays take −20%, repaired by a rover field by field', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const a = window.fx.field(6);
    const b = window.fx.field(4, 14);
    g.grantResources({ parts: 200, metals: 500 });
    g.forceFlare('X', { drill: false });
    g.advanceGameSeconds(25);
    // stow the field of four, run the six: a field override each
    g.fieldOverride(b[0], 'stow');
    g.flareChoice({ mode: 'run' }, { repair: true });
    g.advanceGameSeconds(1);
    const pv = g.getSpaceWeather().popup;
    const preview = g.flarePreview({ mode: 'run' });
    window.fx.finish();
    const s = g.getState();
    const log = s.flare.log[s.flare.log.length - 1];
    const wrecks = a.filter((id: number) => window.fx.b(id).wreck).length;
    const scarred = a.filter((id: number) => !window.fx.b(id).wreck && window.fx.b(id).cap < 1).map((id: number) => window.fx.b(id).cap);
    const dmg = b.map((id: number) => window.fx.b(id).flareDmg);
    const queued = s.weather.repairs;
    const parts0 = s.resources.parts;
    // the repair: one rover a field, each array in turn, 2⚙ and 10 s each
    for (let i = 0; i < 120; i++) g.advanceGameSeconds(1);
    return {
      preview: { destroyed: preview.destroyed, runN: preview.runN, stowN: preview.stowN, parts: preview.repairParts, dmg: preview.dmgPct },
      wrecks, scarred, dmg, log, queued, spent: parts0 - g.getState().resources.parts,
      after: b.map((id: number) => window.fx.b(id).flareDmg ?? 0), fixes: b.filter((id: number) => window.fx.b(id).fix).length, pv: !!pv,
    };
  });
  expect(r.preview.runN).toBe(6);
  expect(r.preview.stowN).toBe(4);
  expect(r.preview.destroyed).toBe(3);        // 50% of 6
  expect(r.wrecks).toBe(r.preview.destroyed);  // the sim uses the preview's count
  expect(r.log.destroyed).toBe(3);
  expect(r.scarred.length).toBe(3);
  for (const c of r.scarred) expect(c).toBeCloseTo((1 - 0.05) * (1 - 0.015), 5);
  for (const d of r.dmg) expect(d).toBeCloseTo(0.2, 5);
  expect(r.preview.dmg).toBe(20);
  expect(r.preview.parts).toBe(8);             // 2⚙ each
  expect(r.log.repairParts).toBe(r.preview.parts);
  expect(r.queued.length).toBe(1);             // one job for the field
  expect(r.spent).toBeGreaterThanOrEqual(6); // the first array's 2⚙ may be paid the second the flare ends
  expect(r.after).toEqual([0, 0, 0, 0]);
  expect(r.fixes).toBe(0);
});

test('the portion rule: 25 · 50 · 75% stow ⌈p × choosers⌉, weakest fields first and whole; the keep set carries the critical feed; overrides are left out; Stow all warns', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const f1 = window.fx.field(4);
    const f2 = window.fx.field(4, 10);
    const f3 = window.fx.field(2, 14);
    // a C run through scars field 3: the weakest producer per array
    g.fieldOverride(f1[0], 'stow'); g.fieldOverride(f2[0], 'stow'); g.fieldOverride(f3[0], 'run');
    g.forceFlare('C', { drill: false });
    window.fx.finish();
    for (const f of [f1, f2, f3]) g.fieldOverride(f[0], 'follow');
    g.advanceGameSeconds(12);
    g.forceFlare('M', { drill: false });
    g.advanceGameSeconds(2);
    const pv = (p: number) => g.flarePreview({ mode: 'portion', p });
    const out: any = { p25: pv(0.25), p50: pv(0.5), p75: pv(0.75), feed: g.flarePreview({ mode: 'feed' }), all: g.flarePreview({ mode: 'stow' }) };
    // an override: field 3 always runs; the share counts the rest
    g.fieldOverride(f3[0], 'run');
    g.advanceGameSeconds(1);
    out.ov50 = pv(0.5);
    out.fields = g.arrayFields().map((f: any) => ({ n: f.n, ids: f.ids, override: f.override ?? null }));
    // the critical feed: priority 0–1 loads the other supply and the bank cannot carry
    g.fieldOverride(f3[0], 'follow');
    for (let i = 0; i < 3; i++) { const id = window.fx.place('lab', 8); g.setPriority(id, 1); }
    g.grantPower(-g.getState().powerStored);
    g.advanceGameSeconds(2);
    out.crit = g.getSpaceWeather().popup;
    out.critFeed = g.flarePreview({ mode: 'feed' });
    out.crit100 = pv(1);
    out.critAll = g.flarePreview({ mode: 'stow' });
    return { ...out, f1, f2, f3 };
  });
  const choosers = 10;
  expect(r.p25.stowN).toBe(Math.ceil(0.25 * choosers));
  expect(r.p50.stowN).toBe(5);
  expect(r.p75.stowN).toBe(Math.ceil(0.75 * choosers));
  expect(r.feed.stowN).toBe(10);
  expect(r.all.stowN).toBe(10);
  // the weakest field first, whole; then by field, the last one split
  expect(r.fields.map((f: any) => f.ids.length)).toEqual([4, 4, 2]);
  expect(r.p25.stowsText).toBe('1 of F1 and F3');
  expect(r.p50.stowsText).toBe('3 of F1 and F3');
  expect(r.p75.stowsText).toBe('F1, 2 of F2 and F3');
  // an overridden field is left out of the share, and runs
  expect(r.fields.find((f: any) => f.ids.includes(r.f3[0])).override).toBe('run');
  expect(r.ov50.stowN).toBe(4);
  expect(r.ov50.runN).toBe(6);
  // the keep set: the feed runs a few strong arrays; a share never stows them; Stow all warns
  expect(r.crit.criticalKW).toBeGreaterThan(0);
  expect(r.critFeed.runN).toBeGreaterThanOrEqual(1);
  expect(r.critFeed.runKW + 1e-6).toBeGreaterThanOrEqual(r.crit.criticalKW);
  expect(r.crit100.keptForFeed).toBe(r.critFeed.runN);   // '100% asked: n kept running for life support'
  expect(r.crit100.stowN).toBe(10 - r.critFeed.runN);
  expect(r.crit100.line).toMatch(/kept running for life support/);
  expect(r.critAll.darkAt).not.toBeNull();
  expect(r.critAll.line).toMatch(/⚠ .* dark at \d:\d\d/);
});

test('unanswered: the safe default stows all but the critical feed; a remembered choice decides the next of its class, compact and unpaused; a C opens compact once one was answered', async ({ page }) => {
  // (a range reads as its worse class until the peak: a remembered M does not answer an M–X)
  await start(page, { extra: '&flarepause' });
  await page.evaluate(() => { window.fx.field(4); });
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.setPaused(false);
    g.advanceGameSeconds(0);
    g.forceFlare('M', { drill: false });
    g.advanceGameSeconds(1);
    const before = g.getSpaceWeather().popup.defaultLine;
    window.fx.finish();
    const l1 = window.fx.log()[window.fx.log().length - 1];
    g.setPaused(false);
    // answered and remembered (an X: its range, M–X, reads as an X from the flash)
    g.advanceGameSeconds(0);
    g.forceFlare('X', { drill: false });
    g.advanceGameSeconds(25);
    g.flareChoice({ mode: 'portion', p: 0.5 }, { remember: true });
    window.fx.finish();
    g.setPaused(false);
    g.advanceGameSeconds(0);
    g.forceFlare('X', { drill: false });
    g.advanceGameSeconds(25);
    g.advanceGameSeconds(0);
    const p3 = g.getSpaceWeather().popup;
    const paused3 = g.getState().paused;
    window.fx.finish();
    const l3 = window.fx.log()[window.fx.log().length - 1];
    // a C after one was answered opens compact
    g.forceFlare('C', { drill: false });
    g.advanceGameSeconds(2);
    g.flareChoice({ mode: 'run' });
    window.fx.finish();
    g.forceFlare('C', { drill: false });
    g.advanceGameSeconds(2);
    const pC = g.getSpaceWeather().popup;
    window.fx.finish();
    return { before, l1, p3: { full: p3.full, by: p3.decidedBy, remembered: p3.remembered }, paused3, l3, pC: { full: pC.full } };
  });
  expect(r.before).toBe('the safe default (stow all but the critical feed)');
  expect(r.l1.decidedBy).toBe('default');
  expect(r.l1.choice).toBe('stow all but the critical feed');
  expect(r.l1.stowed).toBe(4);
  expect(r.p3).toEqual({ full: false, by: 'remembered', remembered: true });
  expect(r.paused3).toBe(false);
  expect(r.l3.decidedBy).toBe('remembered');
  expect(r.l3.choice).toBe('stow 50%');
  expect(r.l3.stowed).toBe(2);
  expect(r.pC.full).toBe(false);
});

test('wrecks: no output and no upkeep; Rebuild costs the full price and restores the same array at 100%; Clear refunds 25%', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const ids = window.fx.field(4);
    g.forceFlare('X', { drill: false });
    g.advanceGameSeconds(2);
    g.flareChoice({ mode: 'run' }, { repair: false });
    window.fx.finish();
    const wrecks = ids.filter((id: number) => window.fx.b(id).wreck);
    const w0 = window.fx.b(wrecks[0]);
    g.advanceGameSeconds(5);
    const idle = { active: window.fx.b(wrecks[0]).active, supply: g.getState().power.solar };
    g.grantResources({ metals: 60 });
    g.advanceGameSeconds(1); // (the store's cap settles)
    const m0 = g.getState().resources.metals;
    g.wreckAction('rebuild', wrecks[0]);
    g.advanceGameSeconds(1);
    const paid = m0 - g.getState().resources.metals;
    const site = { construction: window.fx.b(wrecks[0]).construction, job: window.fx.b(wrecks[0]).wreck?.job };
    for (let i = 0; i < 90; i++) g.advanceGameSeconds(1);
    const rebuilt = window.fx.b(wrecks[0]);
    const m1 = g.getState().resources.metals;
    g.wreckAction('clear', wrecks[1]);
    for (let i = 0; i < 30; i++) g.advanceGameSeconds(1);
    return {
      n: wrecks.length, w0: { dmg: w0.flareDmg ?? 0 }, idle, paid, site,
      rebuilt: { id: rebuilt?.id, wreck: rebuilt?.wreck ?? null, cap: rebuilt?.cap ?? 1, construction: rebuilt?.construction },
      cleared: !window.fx.b(wrecks[1]), salvage: g.getState().resources.metals - m1,
    };
  });
  expect(r.n).toBe(2);
  expect(r.idle.active).toBe(false);
  expect(r.paid).toBe(12);                 // 15◆ × the mare's 0.8
  expect(r.site.job).toBe('rebuild');
  expect(r.site.construction).toBeGreaterThan(40);
  expect(r.rebuilt).toEqual({ id: expect.any(Number), wreck: null, cap: 1, construction: 0 });
  expect(r.cleared).toBe(true);
  expect(r.salvage).toBeGreaterThanOrEqual(3); // a quarter of 12◆ (upkeep aside)
});

test('field berms (Regolith Shielding) halve stowed damage; with Rad-Hard Cells (stubbed until F4) an X costs a stowed array 4% and an M 1%, repaired with no parts', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const ids = window.fx.field(3);
    const run = (cls: string) => {
      for (const id of ids) { const b = g.getState().buildings.find((x: any) => x.id === id); void b; }
      g.forceFlare(cls, { drill: false });
      g.advanceGameSeconds(2);
      g.flareChoice({ mode: 'stow' }, { repair: false });
      const pv = g.flarePreview({ mode: 'stow' });
      window.fx.finish();
      const d = window.fx.b(ids[0]).flareDmg ?? 0;
      return { d, pv: pv.dmgPct, parts: pv.repairParts };
    };
    const bare = run('X');
    g.repairArrays(); for (let i = 0; i < 80; i++) g.advanceGameSeconds(1);
    g.completeTech('regolithShielding');
    const berms = run('X');
    g.repairArrays(); for (let i = 0; i < 80; i++) g.advanceGameSeconds(1);
    g.setWeatherStub({ arrayHard: 0.4 });
    const proper = run('X');
    const parts0 = g.getState().resources.parts;
    g.repairArrays(); for (let i = 0; i < 80; i++) g.advanceGameSeconds(1);
    const spent = parts0 - g.getState().resources.parts;
    const m = run('M');
    g.setWeatherStub({ arrayHard: 1 });
    return { bare, berms, proper, m, spent, fixed: ids.every((id: number) => !window.fx.b(id).fix) };
  });
  expect(r.bare.d).toBeCloseTo(0.2, 5);
  expect(r.berms.d).toBeCloseTo(0.1, 5);
  expect(r.proper.d).toBeCloseTo(0.04, 5);
  expect(r.proper.pv).toBe(4);
  expect(r.proper.parts).toBe(0);
  expect(r.spent).toBeLessThan(1);          // no repair parts (upkeep aside)
  expect(r.m.d).toBeCloseTo(0.01, 5);
  expect(r.bare.pv).toBe(20);
  expect(r.berms.pv).toBe(10);
});

test('flareStance (Automated Power): runs through a C, stows an M but the critical feed, queues the repairs', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const ids = window.fx.field(4);
    g.completeTech('autoPower');
    g.advanceGameSeconds(2);
    const rule = g.getAutomation().rules.find((x: any) => x.id === 'flareStance');
    g.forceFlare('C', { drill: false });
    g.advanceGameSeconds(2);
    const pc = g.getSpaceWeather().popup;
    window.fx.finish();
    const lc = window.fx.log()[window.fx.log().length - 1];
    g.forceFlare('M', { drill: false });
    g.advanceGameSeconds(2);
    const pm = g.getSpaceWeather().popup;
    window.fx.finish();
    const lm = window.fx.log()[window.fx.log().length - 1];
    return { rule: rule && { on: rule.on, family: rule.family }, pc: { by: pc.decidedBy, full: pc.full }, lc, pm: { by: pm.decidedBy }, lm, repairs: g.getState().weather.repairs.flat().length, ids };
  });
  expect(r.rule?.on).toBe(true);
  expect(r.pc.by).toBe('builder');
  expect(r.pc.full).toBe(false);
  expect(r.lc.choice).toBe('keep all running');
  expect(r.lc.running).toBe(4);
  expect(r.pm.by).toBe('builder');
  expect(r.lm.choice).toBe('stow all but the critical feed');
  expect(r.lm.stowed).toBe(4);
  expect(r.repairs).toBe(4);
});

test('migration: a save mid-flare finishes as an M at 45 s; the index, seen flags and a day’s X grace; arrays whole; no remembered choices', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const ids = window.fx.field(3);
    g.advanceGameSeconds(3000);
    const blob = g.saveBlob();
    const st = blob.state;
    delete st.weather; delete st.flareSchema;
    st.flare = { phase: 'active', timer: 20, nextAt: st.simTime - 25 - 60 };
    for (const b of st.buildings) if (b.type === 'solar') { b.cap = 0.5; b.flareDmg = 0.3; b.fieldOverride = 'run'; }
    const t0 = st.simTime;
    g.loadBlob(blob);
    g.setPaused(true);
    const s = g.getState();
    const f = s.flare;
    const out = {
      t0, schema: s.flareSchema, cls: f.cls, phase: f.phase, n: f.n, seen: f.seen, grace: f.noXUntil - t0,
      arrays: s.buildings.filter((b: any) => b.type === 'solar').map((b: any) => ({ cap: b.cap ?? 1, dmg: b.flareDmg ?? 0, ov: b.fieldOverride ?? null })),
      remember: s.weather.remember, autoRepair: s.weather.autoRepair,
      alert: !!s.alerts.find((a: any) => /^SPACE WEATHER — flares now come as C, M and X/.test(a.text)),
    };
    g.advanceGameSeconds(20);
    const after = window.fx.flare();
    return { ...out, ended: after.phase, logged: after.log.length ? after.log[after.log.length - 1].cls : null, ids };
  });
  expect(r.schema).toBe(1);
  expect(r.cls).toBe('M');
  expect(r.phase).toBe('active');
  expect(r.n).toBe(1 + Math.floor((r.t0 - 1728) / 1500));
  expect(r.seen).toEqual({ C: true, M: false, X: false, xReal: false });
  expect(r.grace).toBe(720);
  for (const a of r.arrays) expect(a).toEqual({ cap: 1, dmg: 0, ov: null });
  expect(r.remember).toEqual({});
  expect(r.autoRepair).toBe(true);
  expect(r.alert).toBe(true);
  expect(r.ended).toBe('idle');
  expect(r.logged).toBe('M');
});

test('determinism: two runs of seed 42 with a forced X give the same flare state', async ({ page }) => {
  const once = async () => {
    await start(page);
    return page.evaluate(() => {
      const g = window.__game;
      window.fx.field(6); window.fx.field(4, 14);
      g.forceFlare('X', { drill: false });
      g.advanceGameSeconds(2);
      g.flareChoice({ mode: 'portion', p: 0.5 });
      window.fx.finish();
      g.advanceGameSeconds(600);
      const s = g.getState();
      return JSON.stringify({ log: s.flare.log, arrays: s.buildings.filter((b: any) => b.type === 'solar').map((b: any) => [b.id, b.cap, b.flareDmg, !!b.wreck]), next: s.flare.nextAt });
    });
  };
  const a = await once();
  const b = await once();
  expect(a).toBe(b);
});

// ─────────────────────────── the fit ───────────────────────────

test('fit: the pop-up is a 640 × 300 card at 1280×720 with every row in view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await start(page);
  await page.evaluate(() => { window.fx.field(4); window.fx.field(3, 10); const g = window.__game; g.forceFlare('X', { drill: false }); g.advanceGameSeconds(2); });
  const pop = page.locator('#flare-popup');
  await expect(pop).toBeVisible();
  await expect(pop).not.toHaveClass(/compact/);
  const d = await pop.boundingBox();
  expect(d!.width).toBeLessThanOrEqual(640);
  expect(d!.height).toBeLessThanOrEqual(300);
  expect(d!.x).toBeGreaterThanOrEqual(0);
  expect(d!.x + d!.width).toBeLessThanOrEqual(1280);
  expect(d!.y + d!.height).toBeLessThanOrEqual(720);
  // nothing clipped inside it; the three options, the boxes and Confirm in view
  expect(await pop.evaluate((e) => e.scrollHeight > e.clientHeight + 1)).toBe(false);
  await expect(pop.locator('.fp-row')).toHaveCount(3);
  await expect(pop.locator('.fp-confirm')).toBeVisible();
  await expect(pop.locator('.fp-remember-t')).toHaveText('Use this choice for future X flares');
  // the compact form after Confirm: one line
  await pop.locator('.fp-confirm').click();
  await page.evaluate(() => window.__game.advanceGameSeconds(0));
  await expect(pop).toHaveClass(/compact/);
  expect((await pop.boundingBox())!.height).toBeLessThanOrEqual(50); // a line and its [Change]
});

test.describe('on touch', () => {
  test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: 2, viewport: { width: 667, height: 375 } });
  test('fit: 563 × 262 at the top on a 667×375 phone (and 844×390, 932×430): one row of six 44 px options, 44 px controls, no text under 11 px; the chip rides the top bar', async ({ page }) => {
    await start(page, { extra: '&touch' });
    await expect(page.locator('#touch-top')).toBeVisible();
    await page.evaluate(() => { window.fx.field(4); window.fx.field(3, 10); const g = window.__game; g.forceFlare('X', { drill: false }); g.advanceGameSeconds(2); });
    const pop = page.locator('#flare-popup');
    await expect(pop).toHaveClass(/touch/);
    await expect(page.locator('#touch-top #weather-chip')).toBeVisible();
    for (const [w, h] of [[667, 375], [844, 390], [932, 430]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.evaluate(() => window.__game.advanceGameSeconds(1));
      const t = await pop.boundingBox();
      expect(t!.width).toBeLessThanOrEqual(563);
      expect(t!.height).toBeLessThanOrEqual(262);
      expect(t!.x).toBeGreaterThanOrEqual(0);
      expect(t!.x + t!.width).toBeLessThanOrEqual(w);
      expect(t!.y + t!.height).toBeLessThanOrEqual(h);
      const seg = await pop.locator('.fp-seg .btn').evaluateAll((bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return { h: r.height, w: r.width, top: Math.round(r.top) }; }));
      expect(seg.length).toBe(6);
      expect(new Set(seg.map((b) => b.top)).size).toBe(1); // one row
      for (const b of seg) { expect(b.h).toBeGreaterThanOrEqual(44); expect(b.w).toBeGreaterThanOrEqual(44); }
      const small = await pop.evaluate((e) => [...e.querySelectorAll('*')].filter((x) => [...x.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())
        && parseFloat(getComputedStyle(x).fontSize) < 11 && (x as HTMLElement).offsetParent !== null).length);
      expect(small).toBe(0);
      const controls = await pop.locator('button:visible').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().height));
      for (const hh of controls) expect(hh).toBeGreaterThanOrEqual(44);
      expect(await pop.evaluate((e) => e.scrollHeight > e.clientHeight + 1)).toBe(false);
      // the chip in the bar: a thumb tall
      expect((await page.locator('#weather-chip').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    // Fine… opens the slider under the options
    await pop.locator('.fp-fine').click();
    await expect(pop.locator('.fp-slider')).toBeVisible();
    expect((await pop.boundingBox())!.height).toBeLessThanOrEqual(262);
  });
});
