/** Space weather, phase F3 (docs/16 §6, §10.2, §10.5, §15 Forecasts):
 *  Heliophysics Forecasting and the Solar Observatory, the honest windows and
 *  class ranges, the observatory blind at night, the telegraph bonuses (the
 *  protons keep the schedule's time), the L1 Sentinel's launch and cruise,
 *  Solar-Cycle Forecasting's curve and next three flares, `Arrays: choose
 *  now…`, the NEXT block and the timeline. Every test pauses the game and
 *  drives time with advanceGameSeconds. */
import { test, expect as baseExpect, type Page } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 20_000 });

declare global {
  interface Window { __game?: any; fx?: any }
}

const URL_DEBUG = '/?debug';

async function pauseAtAttach(page: Page) {
  await page.addInitScript(() => {
    let v: any;
    Object.defineProperty(window, '__game', { configurable: true, get: () => v, set: (x) => { v = x; x.setPaused(true); } });
  });
}

async function start(page: Page, o: { site?: string; seed?: number } = {}) {
  await pauseAtAttach(page);
  const { site = 'mare', seed = 42 } = o;
  await page.goto(`${URL_DEBUG}&seed=${seed}&site=${site}&exp=robotic`);
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => {
    const g = window.__game;
    g.openRoads(true); g.instantTravel(true); g.holdHazards(true); g.setPaused(true); g.advanceGameSeconds(0);
  });
  await page.evaluate(HELPERS);
}

/** In-page helpers: placing, the tiers' research and hardware, the forecast view. */
const HELPERS = `(() => {
  const g = window.__game;
  const ring = function* (r) {
    const c = 127;
    for (let i = -r; i <= r; i++) { yield [c + i, c - r]; yield [c + i, c + r]; }
    for (let i = -r + 1; i <= r - 1; i++) { yield [c - r, c + i]; yield [c + r, c + i]; }
  };
  window.fx = {
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
    /** T1: the tech and a Solar Observatory, built and running */
    t1() { g.completeTech('heliophysicsForecasting'); const id = this.place('solarObservatory'); g.advanceGameSeconds(1); return id; },
    /** the sentinel's tech and its launch (on station a lunar day later) */
    launch() {
      g.completeTech('heliophysicsForecasting'); g.completeTech('l1Sentinel');
      g.grantResources({ chips: 15, parts: 30, oxygen: 80, water: 20 });
      g.launchSentinel(); g.advanceGameSeconds(0);
    },
    fc: () => g.getSpaceWeather().forecast,
    wx: () => g.getSpaceWeather(),
    s: () => g.getState(),
    alert: (re) => g.getState().alerts.find((a) => new RegExp(re).test(a.text)),
    /** advance to the next telegraph (at most n s) */
    toTelegraph(n = 4000) { for (let i = 0; i < n && g.getState().flare.phase !== 'telegraph'; i++) g.advanceGameSeconds(1); },
    finish() { for (let i = 0; i < 900 && g.getState().flare.phase !== 'idle'; i++) g.advanceGameSeconds(1); g.advanceGameSeconds(1); },
  };
})()`;

test('data: three forecasting techs and the Solar Observatory; the tier rises with the tech and the hardware', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const T = await import('/src/data/techs.ts');
    const B = await import('/src/data/buildings.ts');
    const audit = g.auditTechs() as { id: string; pros: number; cons: number; lines: { text: string }[] }[];
    const ids = ['heliophysicsForecasting', 'l1Sentinel', 'solarCycleForecasting'];
    const techs = ids.map((id) => {
      const d = T.TECHS[id];
      const a = audit.find((x) => x.id === id)!;
      return { id, era: d.era, lane: d.lane, requires: d.requires, pros: a.pros, cons: a.cons, lines: a.lines.map((l) => l.text).join(' | ') };
    });
    const obs = B.BUILDINGS.solarObservatory;
    const t0 = window.fx.fc().tier;
    g.completeTech('heliophysicsForecasting');
    const noObs = window.fx.fc();
    window.fx.place('solarObservatory');
    g.advanceGameSeconds(1);
    const t1 = window.fx.fc();
    return { techs, obs: { fp: obs.footprint, cost: obs.buildCost, kw: obs.powerKW }, t0, noObs: { tier: noObs.tier, hint: noObs.hint }, t1: { tier: t1.tier, lead: t1.lead, source: t1.source } };
  });
  expect(r.techs.map((t) => `${t.id}:${t.era}:${t.lane}`)).toEqual(['heliophysicsForecasting:2:exploration', 'l1Sentinel:5:exploration', 'solarCycleForecasting:6:compute']);
  expect(r.techs[0].requires).toEqual(['prospectingRovers']);
  expect(r.techs[1].requires).toEqual(['heliophysicsForecasting', 'orbitalProspector']);
  expect(r.techs[2].requires).toEqual(['l1Sentinel', 'lunarDataCenter']);
  for (const t of r.techs) { expect(t.pros, t.id).toBeGreaterThan(0); expect(t.cons, t.id).toBeGreaterThan(0); }
  expect(r.techs[0].lines).toContain('FORECAST T1');
  expect(r.techs[1].lines).toContain('Launch sentinel');
  expect(r.obs).toEqual({ fp: [2, 2], cost: { metals: 25, parts: 8 }, kw: -2 });
  expect(r.t0).toBe(0);
  expect(r.noObs.tier).toBe(0);
  expect(r.noObs.hint).toContain('Place a Solar Observatory');
  expect(r.t1.tier).toBe(1);
  expect(r.t1.lead).toBe(30);
  expect(r.t1.source).toMatch(/^Solar Observatory #\d+$/);
});

test('telegraph bonuses: T1 starts the telegraph 30 s early, T2 60 s and firm at once; the protons keep the schedule\'s time', async ({ page }) => {
  await start(page);
  const run = async (setup: string) => page.evaluate((setup) => {
    const g = window.__game;
    if (setup === 't1') window.fx.t1();
    if (setup === 't2') window.fx.launch();
    window.fx.toTelegraph();
    const f = g.getState().flare;
    const wx = window.fx.wx();
    return { startedAt: f.startedAt, flashAt: f.flashAt, activeAt: f.activeAt, timer: f.timer, firmAt: f.firmAt, classText: wx.classText, tier: wx.forecast?.tier };
  }, setup);
  const t0 = await run('none');
  expect(t0.startedAt).toBe(1728);
  expect(t0.timer).toBe(120); // a C drill: 60 s and the drill's 60
  expect(t0.activeAt).toBe(1848);
  await page.reload();
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => { const g = window.__game; g.openRoads(true); g.instantTravel(true); g.holdHazards(true); g.setPaused(true); g.advanceGameSeconds(0); });
  await page.evaluate(HELPERS);
  const t1 = await run('t1');
  expect(t1.tier).toBe(1);
  expect(t1.startedAt).toBe(1698);
  expect(t1.flashAt).toBe(1728);
  expect(t1.activeAt).toBe(1848); // the Sun does not wait for research
  expect(t1.timer).toBe(150);
  expect(t1.firmAt).toBe(1748); // the X-ray peak, 20 s after the flash
  expect(t1.classText).toBe('C–M');
  await page.reload();
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => { const g = window.__game; g.openRoads(true); g.instantTravel(true); g.holdHazards(true); g.setPaused(true); g.advanceGameSeconds(0); });
  await page.evaluate(HELPERS);
  const t2 = await run('t2');
  expect(t2.tier).toBe(2);
  expect(t2.startedAt).toBe(1668);
  expect(t2.activeAt).toBe(1848);
  expect(t2.timer).toBe(180);
  expect(t2.firmAt).toBe(t2.startedAt); // the sentinel reads the class at once
  expect(t2.classText).toBe('C');
  // a forced flare gets the lead too: an M's 60 s + 60, an X's 120 + 60
  const forced = await page.evaluate(() => {
    const g = window.__game;
    window.fx.finish();
    g.forceFlare('M', { drill: false });
    const m = g.getState().flare.timer;
    window.fx.finish();
    g.forceFlare('X', { drill: false });
    return { m, x: g.getState().flare.timer };
  });
  expect(forced).toEqual({ m: 120, x: 180 });
});

test('honest windows: for 200+ looks at T1 the window holds the flash and the range the class; it narrows; each telegraph comes as forecast', async ({ page }) => {
  test.setTimeout(300_000);
  await start(page);
  const r = await page.evaluate(({ eras }) => {
    const g = window.__game;
    window.fx.t1();
    const looks: { ok: boolean; clsOk: boolean; w: number; n: number; shownOk: boolean }[] = [];
    const lastRange: Record<number, string[]> = {};
    const firstW: Record<number, number> = {};
    const lastW: Record<number, number> = {};
    const seenTele = new Set<number>();
    const tele: { n: number; cls: string; inRange: boolean }[] = [];
    while (g.getState().simTime < 140 * 60) {
      const s = g.getState();
      const f = s.flare;
      const w = s.weather.window;
      if (f.phase === 'idle' && w && w.n === f.n) {
        const truth = g.trueClass();
        const fc = window.fx.fc();
        const lead = fc.lead;
        // the shown window (widened while blind) is the warning's: flash − lead
        const shownOk = !fc.next || fc.next.inLo <= 0 || (s.simTime + fc.next.inLo <= f.nextAt - lead + 1e-6 && f.nextAt - lead <= s.simTime + fc.next.inHi + 1e-6);
        looks.push({ ok: w.lo <= f.nextAt && f.nextAt <= w.hi, clsOk: w.range.includes(truth), w: w.hi - w.lo, n: w.n, shownOk });
        lastRange[w.n] = w.range;
        firstW[w.n] ??= w.hi - w.lo;
        lastW[w.n] = w.hi - w.lo;
      }
      if (f.phase === 'telegraph' && !seenTele.has(f.n)) {
        seenTele.add(f.n);
        if (lastRange[f.n]) tele.push({ n: f.n, cls: f.cls, inRange: lastRange[f.n].includes(f.cls) });
      }
      // the eras open on docs/14 §6's mare times, after the look (a look reads the era it was made in)
      const min = s.simTime / 60;
      let era = 1;
      for (let i = 0; i < 8; i++) if (min >= eras[i]) era = i + 1;
      if (era > s.era) g.forceEra(era);
      // a look a second as the warning nears, so the last range is the one the telegraph meets
      const near = f.phase === 'idle' && f.nextAt - s.simTime < 90;
      g.advanceGameSeconds(near ? 1 : 20);
    }
    const narrowed = Object.keys(firstW).filter((n) => lastW[+n] < firstW[+n]).length;
    return { looks: looks.length, bad: looks.filter((l) => !l.ok).length, badCls: looks.filter((l) => !l.clsOk).length,
      badShown: looks.filter((l) => !l.shownOk).length, tele, flares: Object.keys(firstW).length, narrowed,
      classes: g.getState().flare.log.map((l: any) => l.cls).join('') };
  }, { eras: [0, 23.8, 50.4, 84.2, 108.3, 137.2, 160.2, 188.0] });
  expect(r.looks).toBeGreaterThanOrEqual(200);
  expect(r.bad).toBe(0);
  expect(r.badCls).toBe(0);
  expect(r.badShown).toBe(0);
  expect(r.tele.length).toBeGreaterThanOrEqual(5);
  expect(r.tele.filter((t) => !t.inRange)).toEqual([]);
  expect(r.narrowed).toBeGreaterThanOrEqual(r.flares - 2);
  expect(r.classes).toMatch(/M/); // the run met more than C drills
});

test('blind: the observatory freezes at the mare\'s dusk and widens 20% a game-minute, still honest; no power blinds it; the pole\'s ridge keeps it lit', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const obs = window.fx.t1();
    const to = (t: number) => g.advanceGameSeconds(Math.max(0, t - g.getState().simTime));
    to(433);
    const day = window.fx.fc();
    to(603); // night
    const n1 = window.fx.fc();
    const w1 = n1.next.inHi - n1.next.inLo;
    const chip = window.fx.wx().chip;
    to(663);
    const n2 = window.fx.fc();
    const w2 = n2.next.inHi - n2.next.inLo;
    const s = g.getState();
    const lead = n2.lead;
    const holds = s.simTime + n2.next.inLo <= s.flare.nextAt - lead && s.flare.nextAt - lead <= s.simTime + n2.next.inHi;
    const at = s.weather.window.at;
    to(793); // dawn
    const dawn = window.fx.fc();
    g.setEnabled(obs, false);
    g.advanceGameSeconds(2);
    const off = window.fx.fc();
    return { day: day.live, night: n1.live, why: n1.blindWhy, chip, w1, w2, holds, at, dawn: dawn.live, dawnAt: g.getState().weather.window.at, off: off.live, offWhy: off.blindWhy };
  });
  expect(r.day).toBe(true);
  expect(r.night).toBe(false);
  expect(r.why).toBe('night');
  expect(r.chip).toContain('☾');
  expect(r.at).toBeLessThanOrEqual(480);
  expect(r.w2).toBeGreaterThan(r.w1 * 1.1);
  expect(r.holds).toBe(true);
  expect(r.dawn).toBe(true);
  expect(r.off).toBe(false);
  expect(r.offWhy).toBe('no power');
  // the pole: the ridge's night keeps 85% of the sun, and the observatory sees it
  await start(page, { site: 'southpole' });
  const pole = await page.evaluate(() => {
    const g = window.__game;
    window.fx.t1();
    g.advanceGameSeconds(600 - g.getState().simTime);
    return window.fx.fc().live;
  });
  expect(pole).toBe(true);
});

test('L1 Sentinel: the Lander\'s launch costs 15▣ 30⚙ 80○ 20≈, one only, a lunar day\'s cruise on the chip, then T2: the class for sure and a tight window, day and night', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.completeTech('heliophysicsForecasting'); g.completeTech('l1Sentinel');
    const before = window.fx.fc().sentinel;
    const res0 = g.getState().resources;
    // short of chips: refused, with the reason
    g.grantResources({ chips: -res0.chips });
    g.launchSentinel(); g.advanceGameSeconds(0);
    const short = !!window.fx.alert('LAUNCH NEEDS');
    g.grantResources({ chips: 15, parts: 30, oxygen: 80, water: 20 });
    const res1 = g.getState().resources;
    g.launchSentinel(); g.advanceGameSeconds(0);
    const res2 = g.getState().resources;
    g.launchSentinel(); g.advanceGameSeconds(0);
    const again = !!window.fx.alert('ONE SENTINEL');
    const wx = window.fx.wx();
    const cruise = { chip: wx.chip, shape: wx.chipShape, state: wx.forecast.sentinel.state, tier: wx.forecast.tier };
    g.advanceGameSeconds(720);
    const on = window.fx.fc();
    const online = !!window.fx.alert('L1 SENTINEL ON STATION');
    // day and night: live, firm, tight
    const looks: { live: boolean; firm: boolean; truth: boolean; tight: boolean }[] = [];
    for (let i = 0; i < 16; i++) {
      const s = g.getState();
      const w = s.weather.window;
      if (s.flare.phase === 'idle' && w && w.n === s.flare.n) {
        const fc = window.fx.fc();
        looks.push({ live: fc.live, firm: w.range[0] === w.range[1], truth: w.range[0] === g.trueClass(),
          tight: w.hi - w.lo <= Math.max(30, 0.2 * (s.flare.nextAt - w.at)) + 1e-6 && w.lo <= s.flare.nextAt && s.flare.nextAt <= w.hi });
      }
      g.advanceGameSeconds(45);
    }
    return {
      before: before.state, short, paid: { chips: res1.chips - res2.chips, parts: res1.parts - res2.parts, oxygen: res1.oxygen - res2.oxygen, water: res1.water - res2.water },
      again, cruise, online, tier: on.tier, source: on.source, text: on.next?.text ?? '', looks,
    };
  });
  expect(r.before).toBe('none');
  expect(r.short).toBe(true);
  expect(r.paid).toEqual({ chips: 15, parts: 30, oxygen: 80, water: 20 });
  expect(r.again).toBe(true);
  expect(r.cruise.state).toBe('cruise');
  expect(r.cruise.chip).toMatch(/L1 in \d+:\d\d/);
  expect(r.cruise.shape).toBe('cruise');
  expect(r.online).toBe(true);
  expect(r.tier).toBe(2);
  expect(r.source).toBe('L1 sentinel');
  expect(r.text).toMatch(/^in \d+:\d\d ±\d+:\d\d$/);
  expect(r.looks.length).toBeGreaterThanOrEqual(10);
  expect(r.looks.every((l) => l.live && l.firm && l.truth && l.tight)).toBe(true); // the mare's night included (t 1200–1440)
});

test('Solar-Cycle Forecasting: the curve and its maximum, and the next three flares, each coming as forecast', async ({ page }) => {
  test.setTimeout(300_000);
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.fx.launch();
    g.completeTech('solarCycleForecasting');
    g.forceEra(4);
    g.advanceGameSeconds(740);
    const fc = window.fx.fc();
    const chip = window.fx.wx().chip;
    const pred = g.predictFlares(3);
    const lead = fc.lead;
    const far = fc.timeline.marks.filter((m: any) => m.kind === 'far');
    const farOk = far.every((m: any) => { const p = pred.find((x: any) => x.n === m.n); return p && m.a <= p.flash - lead && p.flash - lead <= m.b; });
    const got: { n: number; cls: string; flash: number }[] = [];
    for (let i = 0; i < 12000 && got.length < 3; i++) {
      const f = g.getState().flare;
      if (f.phase === 'telegraph' && !got.some((x) => x.n === f.n)) got.push({ n: f.n, cls: f.cls, flash: f.flashAt });
      g.advanceGameSeconds(1);
    }
    return { tier: fc.tier, cycle: fc.cycle, three: fc.three, chip, curve: fc.timeline.curve?.length ?? 0, far: far.length, farOk, pred, got };
  });
  expect(r.tier).toBe(3);
  expect(r.cycle.strip.length).toBe(20);
  expect(r.cycle.text).toMatch(/maximum in \d+\.\d lunar days/);
  expect(r.chip).toMatch(/max in \d+\.\d d/);
  expect(r.curve).toBe(49);
  expect(r.three.length).toBe(3);
  expect(r.far).toBe(2);
  expect(r.farOk).toBe(true);
  expect(r.got.map((x) => x.cls)).toEqual(r.pred.map((x: any) => x.cls));
  r.got.forEach((x, i) => { expect(x.n).toBe(r.pred[i].n); expect(Math.abs(x.flash - r.pred[i].flash)).toBeLessThanOrEqual(3); });
});

test('Arrays: choose now… — from a forecast the choice waits for the telegraph and answers it as a click (compact, no pause); Clear; refused at T0', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.flareAhead({ mode: 'stow' }); g.advanceGameSeconds(0);
    const t0 = { refused: !!window.fx.alert('CHOOSING AHEAD NEEDS A FORECAST'), ahead: g.getState().weather.ahead ?? null };
    const ids = window.fx.field(4);
    window.fx.t1();
    g.flareAhead({ mode: 'run' }); g.advanceGameSeconds(0);
    g.flareAhead(null); g.advanceGameSeconds(0);
    const cleared = g.getState().weather.ahead ?? null;
    g.flareAhead({ mode: 'stow' }, { repair: false }); g.advanceGameSeconds(0);
    const set = g.getState().weather.ahead;
    const fcSet = window.fx.fc().aheadSet;
    window.fx.toTelegraph();
    const f = g.getState().flare;
    const pop = window.fx.wx().popup;
    const tele = { by: f.decidedBy, mode: f.choice?.mode, autoRepair: g.getState().weather.autoRepair, full: pop.full, pauses: pop.pauses, ahead: g.getState().weather.ahead ?? null };
    g.advanceGameSeconds(Math.ceil(f.timer) + 1);
    const stowed = ids.filter((id: number) => g.getState().buildings.find((b: any) => b.id === id)?.stow).length;
    return { t0, cleared, set, fcSet, tele, stowed, n: ids.length };
  });
  expect(r.t0.refused).toBe(true);
  expect(r.t0.ahead).toBeNull();
  expect(r.cleared).toBeNull();
  expect(r.set).toMatchObject({ n: 0, choice: { mode: 'stow' }, repair: false });
  expect(r.fcSet).toBe('stow all');
  expect(r.tele).toEqual({ by: 'click', mode: 'stow', autoRepair: false, full: false, pauses: false, ahead: null });
  expect(r.n).toBe(4);
  expect(r.stowed).toBe(4);
});

test('UI: the NEXT block and the timeline by tier; Arrays: choose now… opens the flare pop-up ahead, and Confirm sets it', async ({ page }) => {
  await start(page);
  await page.evaluate(() => { window.__game.advanceGameSeconds(1); });
  await page.locator('#weather-chip').click();
  const panel = page.locator('#weather-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.fc-flare')).toContainText(/NEXT FLARE\s+unknown/);
  await expect(panel.locator('.fc-svg')).toHaveCount(1);
  await expect(panel.locator('[data-fc="ahead"]')).toBeHidden();
  // T1, and the night that follows: the window holds from dusk, and the flare is inside the timeline's two days
  await page.evaluate(() => { window.fx.field(3); window.fx.t1(); window.__game.advanceGameSeconds(600 - window.__game.getState().simTime); });
  await expect(panel.locator('.fc-flare')).toContainText(/NEXT FLARE\s+C–M in \d+:\d\d–\d+:\d\d · Solar Observatory #\d+ \(night: last seen/);
  await expect(page.locator('#weather-chip')).toHaveText(/☉ C–M \d+:\d\d–\d+:\d\d/);
  await expect(panel.locator('.fc-svg rect.fc-box')).toHaveCount(1);
  await expect(panel.locator('.fc-svg rect.fc-night').first()).toBeAttached();
  // the ahead card is the pop-up
  await panel.locator('[data-fc="ahead"]').click();
  const pop = page.locator('#flare-popup');
  await expect(pop).toBeVisible();
  await expect(pop.locator('.fp-t')).toContainText('NEXT FLARE — class C–M');
  await expect(pop.locator('.fp-cancel')).toBeVisible();
  await pop.locator('.fp-row[data-k="stow"]').click();
  await pop.locator('.fp-confirm').click();
  await page.evaluate(() => window.__game.advanceGameSeconds(0));
  await expect(pop).toBeHidden();
  expect(await page.evaluate(() => window.__game.getState().weather.ahead?.choice.mode)).toBe('stow');
  await expect(panel.locator('.fc-ahead')).toContainText('set ahead: stow all');
  // T3: the cycle row and the next three
  await page.evaluate(() => {
    const g = window.__game;
    window.fx.launch(); g.completeTech('solarCycleForecasting'); g.advanceGameSeconds(725);
  });
  await expect(panel.locator('.fc-cycle')).toContainText('CYCLE');
  await expect(panel.locator('.fc-three')).toContainText('NEXT 3');
  await expect(panel.locator('.fc-svg polyline.fc-curve')).toHaveCount(1);
  const fit = await panel.boundingBox();
  expect(fit!.width).toBeLessThanOrEqual(362);
});

test('heliophysics: an observatory that sees the Sun reads 0.05≡/s and doubles a flare\'s data', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const obs = window.fx.t1();
    const d0 = g.getState().data;
    g.advanceGameSeconds(100);
    const on = g.getState().data - d0;
    g.setEnabled(obs, false); g.advanceGameSeconds(1);
    const d1 = g.getState().data;
    g.advanceGameSeconds(100);
    const off = g.getState().data - d1;
    g.setEnabled(obs, true); g.advanceGameSeconds(1);
    window.fx.toTelegraph();
    g.advanceGameSeconds(Math.ceil(g.getState().flare.timer) + 1);
    return { on, off, alert: window.fx.alert('HELIOPHYSICS')?.text ?? '' };
  });
  expect(r.on - r.off).toBeCloseTo(5, 0);
  expect(r.alert).toContain('+30≡'); // the C drill's 15≡, doubled
});
