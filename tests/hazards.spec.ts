/** Destiny hazards (docs/14 §3, §8 phase D3): ⌂ Colony's environment can
 *  kill crew, ◉ Automation's network destroys machines, data and stock for
 *  good. Every hazard is telegraphed, names its target and offers a
 *  counter; kinds and targets are deterministic; a death or a loss comes
 *  only from a warning ignored, or a counter that failed or came late, and
 *  never without a visible clock; every lethal hazard has a free counter
 *  that saves the people; the first of each kind is a drill that cannot
 *  kill. Every test pauses the game and drives time with advanceGameSeconds. */
import { test, expect as baseExpect, type Page } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 20_000 });

declare global {
  interface Window { __game?: any; climb?: (picks: string, upTo: number) => void; hz?: any }
}

const URL_DEBUG = '/?debug&seed=42&nolock&lowfx';

/** pause the moment the debug API attaches, so every run starts on the same game-second (determinism) */
async function pauseAtAttach(page: Page) {
  await page.addInitScript(() => {
    let v: any;
    Object.defineProperty(window, '__game', { configurable: true, get: () => v, set: (x) => { v = x; x.setPaused(true); } });
  });
}

async function start(page: Page, site: string, exp: 'human' | 'robotic', extra = '') {
  await pauseAtAttach(page);
  await page.goto(`${URL_DEBUG}&site=${site}${exp === 'robotic' ? '&exp=robotic' : ''}${extra}`);
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => { window.__game.openRoads(true); window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
  await page.evaluate(HELPERS);
}

const g = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => window.__game[f as string](...(a as unknown[])), [fn, args] as const);

/** In-page helpers: climb eras by charter (debug completes), place and finish
 *  buildings near the Lander, read the live hazards and the alerts. */
const HELPERS = `(() => {
  const g = window.__game;
  window.climb = (picks, upTo) => {
    const PLAIN = {
      1: ['regolithProcessing', 'teleoperation', 'grizzlyScreens', 'fieldSpectrometers'],
      2: ['siliconRefining', 'partsFabrication', 'constructionRobotics'],
      3: ['stackedCells', 'slagRecycling', 'refluxColumns'],
      4: ['waferFab', 'waferPolishing', 'oreSorting'],
      5: ['lunarDataCenter', 'cryoRadiators', 'wingExtensions'],
      6: ['solidStateCells', 'highBurnupFuel', 'refractoryLinings'],
      7: ['foilManufacturing', 'rollToRoll', 'foilAnnealing'],
    };
    for (let e = 1; e < upTo; e++) {
      for (const t of PLAIN[e]) g.completeTech(t);
      if (e >= 2) g.pickDestiny(e, picks[e - 1] === 'C' ? 'colony' : 'automation');
      g.advanceGameSeconds(1);
    }
  };
  const ring = function* (r) {
    const c = 127;
    if (r === 0) { yield [c, c]; return; }
    for (let i = -r; i <= r; i++) { yield [c + i, c - r]; yield [c + i, c + r]; }
    for (let i = -r + 1; i <= r - 1; i++) { yield [c - r, c + i]; yield [c + r, c + i]; }
  };
  window.hz = {
    /** place one of type near the Lander (the first valid ring spot), grants its cost; returns its id */
    place(type, from = 3) {
      g.grantResources({ metals: 400, parts: 200, silicon: 200, chips: 60 });
      for (let r = from; r < 40; r++) for (const [gx, gz] of ring(r)) {
        if (g.canPlace(type, gx, gz, 0).valid && g.placeBuilding(type, gx, gz, 0)) {
          const s = g.getState();
          return s.buildings[s.buildings.length - 1].id;
        }
      }
      return null;
    },
    live: () => g.getHazards().state.live,
    one: (kind) => g.getHazards().state.live.find((h) => h.kind === kind),
    alerts: () => g.getState().alerts.map((a) => a.text),
    alert: (re) => g.getState().alerts.find((a) => new RegExp(re).test(a.text)),
    b: (id) => g.getState().buildings.find((x) => x.id === id),
    log: () => g.getHazards().state.log,
  };
})()`;

// ───────────────────────────── data ─────────────────────────────

test('data: 13 kinds on two sides, each with counters; every lethal or destructive kind a free counter; lines on the cards', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  const r = await page.evaluate(async () => {
    const H = await import('/src/data/hazards.ts');
    const T = await import('/src/data/techs.ts');
    const kinds = Object.values(H.HAZARDS) as any[];
    const lines = (t: string) => T.describeTech(T.TECHS[t], { siteId: 'mare', expedition: 'robotic' }).map((l: any) => `${l.sign}:${l.text}`);
    return {
      live: H.HAZARDS_LIVE,
      n: kinds.length,
      sides: kinds.reduce((m: any, k: any) => ({ ...m, [k.side]: (m[k.side] ?? 0) + 1 }), {}),
      noCounter: kinds.filter((k) => !k.counters.length).map((k) => k.id),
      // Colony: a lethal kind's free counter saves the people; Automation: a destructive one's saves the machines
      freeMissing: kinds.filter((k) => (k.lethal || k.destroys) && k.id !== 'hackedOutpost' &&
        !(k.free === 'airGap' || (k.free && H.COUNTERS[k.free].free))).map((k) => k.id),
      countersKnown: kinds.flatMap((k) => k.counters).every((c: string) => !!H.COUNTERS[c]),
      pressureHalls: lines('pressureHalls'),
      dispatchMesh: lines('dispatchMesh'),
      shielding: lines('regolithShielding'),
      concord: lines('concord'),
    };
  });
  expect(r.live).toBe(true);
  expect(r.n).toBe(13);
  expect(r.sides).toEqual({ colony: 7, automation: 6 });
  expect(r.noCounter).toEqual([]);
  expect(r.freeMissing).toEqual([]);
  expect(r.countersKnown).toBe(true);
  // exposure (⊖) and guard (⊕) lines now show on the pick cards
  expect(r.pressureHalls.join('\n')).toMatch(/con:BREACH: .*hold air — a breach can kill/);
  expect(r.pressureHalls.join('\n')).toMatch(/pro:Suitports: DUST ×0\.5/);
  expect(r.dispatchMesh.join('\n')).toMatch(/con:MALWARE: .*are network nodes — an infected node can burn out/);
  expect(r.shielding.join('\n')).toMatch(/pro:BREACH: micrometeorite pitting ×0\.5/);
  expect(r.concord.join('\n')).toMatch(/pro:hazard windows ×0\.7 as often/);
});

// ───────────────────────────── the scheduler ─────────────────────────────

test('quiet start: nothing before Era 3 + a lunar day, and a side with one pick never fires', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  const r = await page.evaluate(() => {
    const g = window.__game;
    // the landing alone (◉ 1): no side is live, whatever the era and the clock
    window.climb('AC', 3); // E2 ⌂ pick: ⌂ 1 · ◉ 1
    for (let i = 0; i < 4; i++) window.hz.place('roboticsBay');
    g.finishConstruction();
    g.advanceGameSeconds(3000);
    const one = { h: g.getHazards(), log: window.hz.log().length };
    return { one };
  });
  expect(r.one.h.live).toBe(false);
  expect(r.one.log).toBe(0);
  expect(r.one.h.chip).toBe('');

  await start(page, 'mare', 'robotic');
  const q = await page.evaluate(() => {
    const g = window.__game;
    window.climb('AA', 3); // ◉ 2: live, minor
    const at3 = g.getState().simTime;
    for (let i = 0; i < 3; i++) window.hz.place('roboticsBay');
    g.finishConstruction();
    const h0 = g.getHazards();
    g.advanceGameSeconds(700);
    const before = { log: window.hz.log().length, live: window.hz.live().length };
    g.advanceGameSeconds(60);
    return { at3, h0, before, after: window.hz.log().length + window.hz.live().length, startsIn: h0.startsIn };
  });
  expect(q.h0.live).toBe(true);
  expect(q.h0.sides.find((x: any) => x.side === 'automation').tier).toBe(0);
  expect(q.h0.chip).toBe('◉ NET ▮▯▯');
  expect(q.startsIn).toBeGreaterThan(700);
  expect(q.before).toEqual({ log: 0, live: 0 });
  expect(q.after).toBeGreaterThan(0);
});

test('scheduler: tiers by picks, the side round-robin, the 240 s spacing and the flare gap, Concord ×1/0.7', async ({ page }) => {
  await start(page, 'mare', 'human');
  const r = await page.evaluate(async () => {
    const H = await import('/src/core/hazards.ts');
    const run = (c: number, a: number, n: number) => {
      const sides = [c >= 2 ? 'colony' : null, a >= 2 ? 'automation' : null].filter(Boolean) as any[];
      let credit = { colony: 0, automation: 0 };
      const out: string[] = [];
      for (let i = 0; i < n; i++) { const x = H.nextSide(credit, { colony: c, automation: a }, sides); credit = x.credit; out.push(x.side[0]); }
      return out.join('');
    };
    const g = window.__game;
    window.climb('CCCCCC', 7); // ⌂ 6 of 6: major
    const s = g.getState();
    const mods = (await import('/src/core/mods.ts')).modsFor(s);
    const base = H.windowInterval(s, mods, 3);
    const concord = H.windowInterval(s, { ...mods, hazardRateMult: 0.7 }, 3);
    return {
      r71: run(7, 1, 8), r62: run(6, 2, 8), r44: run(4, 4, 8),
      tiers: [H.sideTier({ ...s, techsDone: s.techsDone.slice(0, 3) }, 'colony'), H.sideTier(s, 'colony'), H.sideTier(s, 'automation')],
      base, concord,
    };
  });
  expect(r.r71).toBe('cccccccc');
  expect(r.r62).toBe('ccacccac');
  expect(r.r44).toBe('cacacaca');
  expect(r.tiers[1]).toBe(2); // ⌂ 6 picks: major
  expect(r.tiers[2]).toBeNull(); // ◉ none
  // Concord's hazardRate ×0.7: the base interval ×1/0.7 (the jitter is the same window's)
  expect(r.concord).toBeGreaterThan(r.base);

  // spacing: a window within 240 s of another hazard waits, and fires once clear
  const sp = await page.evaluate(() => {
    const g = window.__game;
    const hab = window.hz.place('habitat');
    g.finishConstruction();
    g.setHazardClock(99999);
    const id = g.forceHazard('breach', hab, { drill: false, tier: 0 });
    g.counter('evacuate', id);
    g.advanceGameSeconds(1);
    g.setHazardClock(1); // a window due now, 1 s after the breach's warning
    const log0 = window.hz.log().length;
    g.advanceGameSeconds(60);
    const held = window.hz.log().length - log0 + window.hz.live().filter((h: any) => h.id !== id).length;
    // the flare: a window cannot open inside its telegraph
    return { held };
  });
  expect(sp.held).toBe(0);
});

test('determinism: the same seed and actions give the same hazards; seed 7 differs', async ({ page }) => {
  await pauseAtAttach(page);
  const runOnce = async (seed: number) => {
    await page.goto(`/?debug&seed=${seed}&nolock&lowfx&site=mare&exp=robotic`);
    await page.waitForFunction(() => window.__game !== undefined);
    await page.evaluate(() => { window.__game.openRoads(true); window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
    await page.evaluate(HELPERS);
    return page.evaluate(() => {
      const g = window.__game;
      window.climb('AAAA', 5); // ◉ 4: moderate
      for (const t of ['roboticsBay', 'roboticsBay', 'lab', 'lab', 'relayMast', 'smelter']) window.hz.place(t);
      g.finishConstruction();
      for (const b of g.getState().buildings) if (b.type === 'lab') g.setAutomated(b.id, true);
      g.advanceGameSeconds(6000);
      const h = g.getHazards().state;
      return [...h.log.map((e: any) => `${Math.round(e.at)}:${e.kind}:${e.target}`), ...h.live.map((x: any) => `${Math.round(x.warnedAt)}:${x.kind}:${x.targetName}`)];
    });
  };
  const a = await runOnce(42);
  const b = await runOnce(42);
  const c = await runOnce(7);
  expect(a.length).toBeGreaterThan(1);
  expect(b).toEqual(a);
  expect(c).not.toEqual(a);
  // kinds and targets are deterministic: only the timing is seeded
  expect(c.map((x) => x.split(':').slice(1).join(':'))[0]).toBe(a.map((x) => x.split(':').slice(1).join(':'))[0]);
});

test('near miss: with every risk under 0.2 the window brings good news and nothing is lost', async ({ page }) => {
  await start(page, 'mare', 'human');
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.climb('CC', 3);
    window.hz.place('habitat');
    g.finishConstruction();
    const before = g.getState();
    g.setHazardClock(1);
    g.advanceGameSeconds(5);
    const s = g.getState();
    return { log: window.hz.log(), live: window.hz.live().length, crew: [before.crew, s.crew], alert: window.hz.alerts().find((t: string) => /SEALS HELD/.test(t)) };
  });
  expect(r.live).toBe(0);
  expect(r.log[0].outcome).toMatch(/^near miss: SEALS HELD — Habitat Module #\d+’s seals were renewed in time; nothing vented/);
  expect(r.alert).toBeTruthy();
  expect(r.crew[1]).toBe(r.crew[0]);
});

// ───────────────────────────── ⌂ lethal cases ─────────────────────────────

test('breach: telegraphed with its target, who is aboard, the cost and both counters; Evacuate saves the people', async ({ page }) => {
  await start(page, 'mare', 'human');
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.climb('CC', 3);
    const hab = window.hz.place('habitat');
    g.finishConstruction();
    g.advanceGameSeconds(1);
    const id = g.forceHazard('breach', hab, { drill: false, tier: 1 });
    g.advanceGameSeconds(1);
    const h = window.hz.one('breach');
    const a = window.hz.alert('SEAL FATIGUE');
    g.counter('evacuate', id);
    g.advanceGameSeconds(1);
    const crew0 = g.getState().crew;
    g.advanceGameSeconds(125); // the telegraph runs out: it opens on an empty hall
    const opened = window.hz.one('breach');
    return { h, a, crew0, crew1: g.getState().crew, opened, deaths: g.getHazards().deaths, hab: window.hz.b(hab) };
  });
  expect(r.h.tier).toBe(1);
  expect(r.h.drill).toBe(false);
  expect(r.h.at - r.h.warnedAt).toBeGreaterThanOrEqual(120);
  expect(r.a.text).toMatch(/SEAL FATIGUE — Habitat Module #\d+ \(4 aboard\) hissing: breach in \d:\d\d · people inside will die · ⚠ can kill/);
  expect(r.a.kind).toBe('crit');
  expect(r.a.counters.map((c: any) => c.label)).toEqual(['Seal 12⚙', 'Evacuate']);
  expect(r.opened.phase).toBe('active');
  expect(r.crew1).toBe(r.crew0);
  expect(r.deaths.length).toBe(0);
  expect(r.hab.breached).toBeTruthy();
});

test('breach ignored: the tier’s deaths through CREW LOST with the cause and the missed warning; a late Seal is late; grief', async ({ page }) => {
  await start(page, 'mare', 'human');
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.climb('CC', 3);
    const hab = window.hz.place('habitat');
    g.finishConstruction();
    g.advanceGameSeconds(1);
    const crew0 = g.getState().crew;
    const morale0 = g.getState().morale;
    g.forceHazard('breach', hab, { drill: false, tier: 2 });
    g.advanceGameSeconds(89); // no counter: 1 s left
    const alive = g.getState().crew;
    g.advanceGameSeconds(2);
    const s = g.getState();
    const lost = s.alerts.filter((a: any) => /^CREW LOST/.test(a.text)).map((a: any) => a.text);
    const H = g.getHazards();
    // a second breach, sealed 10 s before it opens: too late — the seal takes 20 s
    const hab2 = window.hz.place('habitat');
    g.finishConstruction();
    g.advanceGameSeconds(1);
    const id2 = g.forceHazard('breach', hab2, { drill: false, tier: 1 });
    const h2 = window.hz.one('breach') ?? H.state.live.find((x: any) => x.id === id2);
    g.setHazardClock(10, id2);
    g.counter('seal', id2);
    g.advanceGameSeconds(1);
    const sealing = window.hz.alert('^SEALING');
    const before2 = g.getState().crew;
    g.advanceGameSeconds(12);
    return {
      crew0, alive, after: s.crew, morale: [morale0, s.morale], lost, deaths: H.state ? H.deaths : null, grief: H.grief,
      hmorale: H.meters, sealing: sealing?.text, before2, after2: g.getState().crew, d2: g.getHazards().deaths.slice(-1)[0], h2: !!h2,
    };
  });
  expect(r.alive).toBe(r.crew0);                // nothing before the telegraph ran out
  expect(r.after).toBe(r.crew0 - 2);            // major: 2 of the 4 aboard
  expect(r.lost[0]).toMatch(/^CREW LOST — Habitat Module #\d+ decompressed · warned 1:30 before; no seal, no evacuation/);
  expect(r.deaths.length).toBe(2);
  expect(r.deaths[0]).toMatchObject({ hazard: 'breach', cause: expect.stringMatching(/decompressed/) });
  expect(r.grief.length).toBe(2);
  expect(r.morale[1]).toBeLessThan(r.morale[0] - 20); // −15 a death at once
  expect(r.sealing).toMatch(/AFTER the breach opens/);
  expect(r.after2).toBe(r.before2 - 1);
  expect(r.d2.cause).toMatch(/decompressed/);
});

test('drill: the first of a kind is minor, warns 60 s longer and cannot kill even ignored; the second can', async ({ page }) => {
  await start(page, 'mare', 'human', '&tips');
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.climb('CC', 3);
    const hab = window.hz.place('habitat');
    g.finishConstruction();
    g.advanceGameSeconds(1);
    const crew0 = g.getState().crew;
    g.forceHazard('breach', hab); // the first: a drill
    const h = window.hz.one('breach');
    g.advanceGameSeconds(h.at - g.getState().simTime + 200); // ignored, open, and past its drill
    const crew1 = g.getState().crew;
    const log = window.hz.log().slice(-1)[0];
    g.forceHazard('breach', hab, { tier: 1 }); // the second: real
    const h2 = window.hz.one('breach');
    g.advanceGameSeconds(h2.at - g.getState().simTime + 1);
    return { h, crew0, crew1, crew2: g.getState().crew, log, h2, drilled: g.getHazards().state.drilled, announce: true };
  });
  expect(r.h.drill).toBe(true);
  expect(r.h.tier).toBe(0);
  expect(r.h.at - r.h.warnedAt).toBe(150 + 60);
  expect(r.crew1).toBe(r.crew0);
  expect(r.log.outcome).toBe('drill');
  expect(r.h2.drill).toBe(false);
  expect(r.crew2).toBe(r.crew0 - 1);
  expect(r.drilled).toContain('breach');
  // the NEW HAZARD card (it pauses): what the counters do, and what the next one will do
  // click through the cards queued before it (the landing, the era explainers), one a beat
  for (let i = 0; i < 80; i++) {
    const t = (await page.locator('#era-banner').textContent()) ?? '';
    if (/NEW HAZARD/.test(t) && await page.locator('#era-banner').isVisible()) break;
    await page.evaluate(() => {
      const q = document.querySelector<HTMLElement>('#era-banner [data-dsc="ok"]:not([hidden])');
      const c = document.querySelector<HTMLElement>('#discovery-card [data-dsc="ok"]');
      const banner = document.getElementById('era-banner')!;
      (banner.style.display !== 'none' ? q : c)?.click();
    });
    await page.waitForTimeout(150);
  }
  await expect(page.locator('#era-banner')).toContainText('NEW HAZARD');
  await expect(page.locator('#era-banner')).toContainText('Next time, the people inside die');
});

/** In-page: advance to `before` s ahead of the next dusk (or dawn with 'dawn'). */
const TO_DUSK = `window.toDusk = (before) => {
  const g = window.__game;
  const t = g.getState().simTime % 720;
  const want = 480 - before;
  g.advanceGameSeconds(Math.round((want - t + 720) % 720));
}`;

test('cascade: the dusk forecast warns with Shed loads, and shedding keeps the habitats lit through the night', async ({ page }) => {
  await start(page, 'mare', 'human');
  await page.evaluate(TO_DUSK);
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.climb('CC', 3);
    const habs = [window.hz.place('habitat'), window.hz.place('habitat')];
    for (let i = 0; i < 3; i++) window.hz.place('solar');
    window.hz.place('smelter');
    window.hz.place('lab');
    g.finishConstruction();
    g.grantCrew(9); // every bed taken: the Lander's 8 and the habitats' 8
    g.setHazardClock(99999);
    const keep = () => g.grantResources({ oxygen: 300, food: 200, water: 150 });
    keep();
    (window as any).toDusk(50);
    g.grantPower(700 - g.getState().powerStored);
    g.advanceGameSeconds(2);
    const dusk = window.hz.alert('^NIGHTFALL');
    // answered: shed at the warning, and again each time it lapses, until dawn
    for (let i = 0; i < 3; i++) {
      g.counter('shedLoads');
      keep();
      g.advanceGameSeconds(1);
      g.advanceGameSeconds(Math.ceil(g.getHazards().state.shedUntil - g.getState().simTime));
    }
    return { dusk, habs, cascade: window.hz.log().concat(window.hz.live()).filter((x: any) => x.kind === 'cascade'), deaths: g.getHazards().deaths.length };
  });
  expect(r.dusk.text).toMatch(/habitats go dark at \d:\d\d — LIFE-SUPPORT CASCADE · people will need beds or suit air/);
  expect(r.dusk.kind).toBe('warn');
  expect(r.dusk.counters.map((c: any) => c.counter)).toContain('shedLoads');
  expect(r.cascade).toEqual([]);
  expect(r.deaths).toBe(0);
});

test('cascade ignored: SCRUBBERS DOWN at 20 s, the habitat evacuates, crew with no bed go on suit air, then die every 30 s', async ({ page }) => {
  await start(page, 'mare', 'human');
  await page.evaluate(TO_DUSK);
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.climb('CC', 3);
    const habs = [window.hz.place('habitat'), window.hz.place('habitat')];
    for (let i = 0; i < 3; i++) window.hz.place('solar');
    window.hz.place('smelter');
    window.hz.place('lab');
    g.finishConstruction();
    g.grantCrew(9);
    g.setHazardClock(99999);
    const keep = () => g.grantResources({ oxygen: 300, food: 200, water: 150 });
    keep();
    g.forceHazard('cascade', habs[0]); // the drill, answered at once: the habitat is lit
    g.advanceGameSeconds(2);
    (window as any).toDusk(10);
    g.grantPower(200 - g.getState().powerStored);
    const out: any = { habs };
    for (let i = 0; i < 400; i++) {
      if (i % 20 === 0) keep();
      g.advanceGameSeconds(1);
      const c = window.hz.one('cascade');
      if (c && !out.tele) out.tele = { h: c, a: window.hz.alert('SCRUBBERS DOWN'), t: g.getState().simTime };
      if (c?.phase === 'active' && !out.alarm) out.alarm = { h: c, crew: g.getState().crew, suit: g.getHazards().state.suit, t: g.getState().simTime };
      const suit = window.hz.alert('^SUIT AIR');
      if (suit && !out.suit) out.suit = suit;
      if (g.getHazards().deaths.length && !out.death) { out.death = { d: g.getHazards().deaths[0], a: window.hz.alert('^CREW LOST'), t: g.getState().simTime }; break; }
    }
    return out;
  });
  expect(r.tele.h.drill).toBe(false);
  expect(r.tele.a.text).toMatch(/SCRUBBERS DOWN — Habitat Module #\d+ \(\d aboard\) dark \d:\d\d: CO₂ alarm in \d:\d\d · people will need beds or suit air/);
  expect(r.tele.a.counters.map((c: any) => c.counter)).toEqual(['shedLoads']);
  expect(r.alarm.suit[0].n).toBeGreaterThan(0);
  expect(r.suit.text).toMatch(/SUIT AIR — \d crew members? from Habitat Module #\d+: \d:\d\d/);
  expect(r.suit.kind).toBe('crit');
  // minor: 180 s of suit air before the first death
  expect(r.death.t - r.alarm.t).toBeGreaterThanOrEqual(180);
  expect(r.death.a.text).toMatch(/^CREW LOST — suit air ran out: Habitat Module #\d+ dark · warned \d:\d\d before; no power, no bed/);
  expect(r.death.d.hazard).toBe('cascade');
});

test('contamination: Flush answers it; ignored, the water is unsafe, the sick bay fills, then poisoning kills behind its clock', async ({ page }) => {
  await start(page, 'mare', 'human');
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.climb('CC', 3);
    window.hz.place('smelter'); // a water source
    window.hz.place('hydroponics');
    g.finishConstruction();
    const keep = () => g.grantResources({ oxygen: 200, food: 200, water: 150 });
    keep();
    const id1 = g.forceHazard('contamination', undefined, { drill: false, tier: 1 });
    g.advanceGameSeconds(1);
    const tele = window.hz.alert('WATER ASSAY');
    const w0 = g.getState().resources.water;
    g.counter('flush', id1);
    g.advanceGameSeconds(1);
    const flushed = { live: window.hz.one('contamination'), water: [w0, g.getState().resources.water], loop: g.getHazards().state.loopAge };
    // ignored
    g.forceHazard('contamination', undefined, { drill: false, tier: 1 });
    const crew0 = g.getState().crew;
    const out: any = { tele, flushed, crew0 };
    for (let t = 0; t < 1440 + 200; t += 20) {
      keep();
      g.advanceGameSeconds(20);
      const h = window.hz.one('contamination');
      if (h?.phase === 'active' && !out.unsafe) out.unsafe = { a: window.hz.alert('WATER UNSAFE'), m: g.getHazards().meters };
      if (!out.sick && g.getHazards().state.sick.length) out.sick = { n: g.getHazards().state.sick[0].n, t };
      const p = window.hz.alert('^POISONING');
      if (p && !out.poison) out.poison = { text: p.text, t };
      if (g.getHazards().deaths.length) { out.death = { d: g.getHazards().deaths[0], t, a: window.hz.alert('^CREW LOST') }; break; }
    }
    return out;
  });
  expect(r.tele.text).toMatch(/WATER ASSAY — heavy metals rising: unsafe in \d:\d\d · poisoned water can kill/);
  expect(r.tele.counters.map((c: any) => c.counter)).toEqual(['flush']);
  expect(r.flushed.live).toBeUndefined();
  expect(r.flushed.water[1]).toBeLessThan(r.flushed.water[0] * 0.75);
  expect(r.flushed.loop).toBeLessThan(0.01);
  expect(r.unsafe.a.text).toMatch(/WATER UNSAFE — farms −50%, a boil-water notice/);
  expect(r.sick.n).toBeGreaterThan(0);
  expect(r.poison.text).toMatch(/POISONING — 1 crew critical: dies in \d:\d\d/);
  expect(r.death.t).toBeGreaterThanOrEqual(1440);
  expect(r.death.a.text).toMatch(/^CREW LOST — poisoned by the fouled water loop · warned \d+:\d\d before; the loop was never flushed/);
});

test('dose: Recall EVA before the flare saves them; ignored at major, a lethal dose kills behind its clock; Medevac needs the slot', async ({ page }) => {
  await start(page, 'mare', 'human');
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.climb('CCC', 4); // Crew Rotation Charter: EVA crews
    g.grantCrew(16);
    for (let i = 0; i < 4; i++) window.hz.place('habitat');
    g.finishConstruction();
    const keep = () => g.grantResources({ oxygen: 300, food: 200, water: 150 });
    const wait = (n: number) => { for (let t = 0; t < n; t += 20) { keep(); g.advanceGameSeconds(Math.min(20, n - t)); } };
    keep();
    g.advanceGameSeconds(2);
    const eva = g.getDestiny().evaCrew;
    // answered
    const id1 = g.forceHazard('dose', undefined, { drill: false, tier: 2 });
    g.advanceGameSeconds(1);
    const tele = window.hz.alert('CREW ON EVA');
    g.counter('recallEva', id1);
    wait(70);
    const recalled = { log: window.hz.log().slice(-1)[0], deaths: g.getHazards().deaths.length, sick: g.getHazards().state.sick.length };
    wait(400); // the gap after the flare
    wait(Math.round(720 - (g.getState().simTime % 720) + 60)); // EVA crews go out by day
    // ignored: the slot is busy, so Medevac fails and names when it frees
    g.orderResupply();
    g.forceHazard('dose', undefined, { drill: false, tier: 2 });
    wait(62);
    const acute = window.hz.alert('^ACUTE DOSE');
    const h = window.hz.one('dose');
    g.counter('medevac', h?.id);
    g.advanceGameSeconds(1);
    const refused = window.hz.alert('^MEDEVAC NEEDS');
    wait(185);
    return { eva, tele, recalled, acute, lethal: h?.n?.lethal, refused, deaths: g.getHazards().deaths.filter((d: any) => d.hazard === 'dose'), lost: window.hz.alert('^CREW LOST') };
  });
  expect(r.eva).toBeGreaterThanOrEqual(3);
  expect(r.tele.text).toMatch(/\d+ CREW ON EVA — recall by 0:\d\d · a dose can kill/);
  expect(r.tele.counters.map((c: any) => c.counter)).toEqual(['recallEva']);
  expect(r.recalled.log.outcome).toBe('answered: Recall EVA');
  expect(r.recalled.deaths).toBe(0);
  expect(r.acute.text).toMatch(/ACUTE DOSE — \d crew members? will die in \d:\d\d/);
  expect(r.lethal).toBeGreaterThanOrEqual(1);
  expect(r.refused.text).toMatch(/^MEDEVAC NEEDS THE SHIPMENT SLOT — busy until \d+:\d\d from now/);
  expect(r.deaths.length).toBe(r.lethal);
  expect(r.lost.text).toMatch(/^CREW LOST — an acute radiation dose on EVA · warned \d:\d\d before; the recall never came/);
});

test('blight: Quarantine burns the crop and stops it; ignored, it infects its farm and spreads to its neighbours', async ({ page }) => {
  await start(page, 'mare', 'human');
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.climb('CC', 3);
    const farms = [window.hz.place('hydroponics'), window.hz.place('hydroponics'), window.hz.place('hydroponics')];
    g.finishConstruction();
    g.grantResources({ water: 150 });
    const id1 = g.forceHazard('blight', farms[0], { drill: false, tier: 1 });
    g.advanceGameSeconds(1);
    const tele = window.hz.alert('BLIGHT SPOTTED');
    g.counter('quarantine', id1);
    g.advanceGameSeconds(1);
    const q = { live: window.hz.one('blight'), regrow: window.hz.b(farms[0]).cropRegrowT };
    g.advanceGameSeconds(200);
    g.forceHazard('blight', farms[1], { drill: false, tier: 1 });
    g.advanceGameSeconds(125);
    const infected = window.hz.one('blight')?.hit ?? [];
    g.advanceGameSeconds(185);
    return { tele, q, infected, spread: window.hz.one('blight')?.hit ?? [], farms };
  });
  expect(r.tele.text).toMatch(/BLIGHT SPOTTED — Hydroponics Farm #\d+: spreads to \d neighbours? in \d:\d\d/);
  expect(r.q.live).toBeUndefined();
  expect(r.q.regrow).toBeGreaterThan(100);
  expect(r.infected).toEqual([r.farms[1]]);
  expect(r.spread.length).toBeGreaterThan(1);
});

test('failed counters say why and name the free fallback: an unaffordable Seal, a counter with nothing to act on', async ({ page }) => {
  await start(page, 'mare', 'human');
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.climb('CC', 3);
    const hab = window.hz.place('habitat');
    g.finishConstruction();
    const id = g.forceHazard('breach', hab, { drill: false, tier: 1 });
    g.advanceGameSeconds(1);
    g.grantResources({ parts: 8 - g.getState().resources.parts });
    g.counter('seal', id);
    g.counter('quarantine');
    g.counter('holdRollout');
    g.airGap(hab, true);
    g.advanceGameSeconds(1);
    return window.hz.alerts();
  });
  expect(r).toContain('SEAL NEEDS 12⚙ — have 8 · [Evacuate] saves the 4 aboard');
  expect(r).toContain('NOTHING TO QUARANTINE — no blight is warned');
  expect(r).toContain('NO ROLLOUT TO HOLD');
  expect(r.some((t: string) => /^NOT A NETWORK NODE/.test(t))).toBe(true);
});

// ───────────────────────────── ◉ destructive cases ─────────────────────────────

test('malware: Air-gap starves the worm; ignored, a node halves with a phantom load and spreads; air-gap stops the spread; Patch clears and immunizes', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.climb('AA', 3);
    const ids = ['relayMast', 'roboticsBay', 'lab', 'lab', 'lab', 'roboticsBay'].map((t) => window.hz.place(t, 2));
    g.finishConstruction();
    g.grantPower(20000);
    g.advanceGameSeconds(2);
    // answered: the entry air-gapped before it unpacks
    const id1 = g.forceHazard('malware', undefined, { drill: false, tier: 1 });
    g.advanceGameSeconds(1);
    const tele = window.hz.alert('INTRUSION');
    const entry = window.hz.one('malware').target;
    g.airGap(entry, true);
    g.advanceGameSeconds(1);
    const starved = { live: window.hz.one('malware'), log: window.hz.log().slice(-1)[0] };
    g.airGap(entry, false);
    g.advanceGameSeconds(300);
    // ignored
    const lab = ids[2];
    const d0 = g.getState().power.demand;
    const id2 = g.forceHazard('malware', undefined, { drill: false, tier: 1 });
    const h2 = window.hz.one('malware');
    g.advanceGameSeconds(h2.at - g.getState().simTime + 1);
    const first = g.getState().buildings.filter((b: any) => b.infected).map((b: any) => b.id);
    g.advanceGameSeconds(130);
    const spread = g.getState().buildings.filter((b: any) => b.infected).map((b: any) => b.id);
    const infectedLab = spread.includes(lab);
    const d1 = g.getState().power.demand;
    // air-gap every clean node: nothing more is reached
    const clean = g.getHazards().graph.nodes.filter((n: any) => !n.infected).map((n: any) => n.id);
    for (const id of clean) g.airGap(id, true);
    g.advanceGameSeconds(120);
    const held = g.getState().buildings.filter((b: any) => b.infected).length;
    for (const id of clean) g.airGap(id, false);
    // a Data Center to patch from
    g.completeTech('lunarDataCenter');
    const dc = window.hz.place('dataCenter', 6);
    g.finishConstruction();
    g.grantData(500);
    g.advanceGameSeconds(3);
    g.counter('patch');
    g.advanceGameSeconds(125);
    return {
      tele, entry, starved, first, spread, infectedLab, d0, d1, held, heldBefore: spread.length, dc,
      after: g.getState().buildings.filter((b: any) => b.infected).length, immune: g.getHazards().state.immuneUntil - g.getState().simTime,
      patched: window.hz.log().slice(-1)[0], id1, id2,
    };
  });
  expect(r.tele.text).toMatch(/INTRUSION — worm on .+ #\d+; unpacks in \d:\d\d/);
  expect(r.tele.counters.map((c: any) => c.counter)).toEqual(['airGap', 'reimage']);
  expect(r.starved.live).toBeUndefined();
  expect(r.starved.log.outcome).toBe('answered: Air-gap');
  expect(r.first.length).toBe(1);
  expect(r.spread.length).toBeGreaterThan(1);
  expect(r.held).toBe(r.heldBefore); // gapped: the spread stops
  expect(r.after).toBe(0);
  expect(r.immune).toBeGreaterThan(600);
  expect(r.patched.outcome).toBe('answered: Patch');
});

test('malware ignored: at moderate an infected Data Center wipes 15% of banked data a day behind a RANSOM clock; at major a node burns out', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.climb('AA', 3);
    g.completeTech('lunarDataCenter');
    const dc = window.hz.place('dataCenter', 2);
    g.finishConstruction();
    g.grantPower(50000);
    g.advanceGameSeconds(2);
    g.forceHazard('malware', dc, { drill: false, tier: 1 });
    const h = window.hz.one('malware');
    g.advanceGameSeconds(h.at - g.getState().simTime + 1);
    const infected = window.hz.b(dc).infected;
    g.grantData(1000);
    g.advanceGameSeconds(720 - 170);
    const clock = window.hz.alert('^RANSOM');
    const data0 = g.getState().data;
    g.advanceGameSeconds(200);
    const loss = g.getHazards().losses.find((l: any) => l.what === 'data');
    const data1 = g.getState().data;
    // major: the node burns out after a lunar day infected — wrecked, no refund
    for (const b of g.getState().buildings) if (b.infected) g.counter('reimage', b.id);
    g.grantData(500);
    g.advanceGameSeconds(90);
    const dc2 = window.hz.place('dataCenter', 8);
    g.finishConstruction();
    g.forceHazard('malware', dc2, { drill: false, tier: 2 });
    const h2 = window.hz.one('malware') ?? g.getHazards().state.live.slice(-1)[0];
    g.advanceGameSeconds(h2.at - g.getState().simTime + 1);
    const res0 = { ...g.getState().resources };
    g.advanceGameSeconds(720 - 150);
    const burn = window.hz.alert('^BURN-OUT');
    g.advanceGameSeconds(200);
    return { infected, clock, data0, data1, loss, burn, gone: !window.hz.b(dc2), wrecked: g.getHazards().losses.find((l: any) => l.what === 'building'),
      metals: [res0.metals, g.getState().resources.metals], frozen: g.getState().auto.frozenUntil - g.getState().simTime };
  });
  expect(r.infected).toBe(true);
  expect(r.clock.text).toMatch(/^RANSOM — 15% of banked data wiped in \d:\d\d/);
  expect(r.clock.kind).toBe('crit');
  expect(r.loss).toMatchObject({ what: 'data', hazard: 'malware' });
  expect(r.loss.amount).toBeGreaterThanOrEqual(Math.floor(r.data0 * 0.14));
  expect(r.burn.text).toMatch(/^BURN-OUT — Data Center #\d+ wrecked in \d:\d\d/);
  expect(r.gone).toBe(true);
  expect(r.wrecked.cause).toMatch(/burned out, infected for a lunar day/);
  expect(r.metals[1]).toBeLessThanOrEqual(r.metals[0]); // no refund
});

test('firmware: Hold rollout answers it; ignored, rovers brick; a dock that cannot re-flash loses its rover at the deadline and prints a replacement', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  await page.evaluate(TO_DUSK);
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.climb('AA', 3);
    const bay = window.hz.place('roboticsBay', 2);
    g.finishConstruction();
    g.setPriority(bay, 3);
    g.advanceGameSeconds(2);
    const n0 = g.getState().rovers.length;
    const id1 = g.forceHazard('firmware', undefined, { drill: false, tier: 2 });
    g.advanceGameSeconds(1);
    const tele = window.hz.alert('FIRMWARE v7.2');
    g.counter('holdRollout', id1);
    g.advanceGameSeconds(1);
    const held = { live: window.hz.one('firmware'), log: window.hz.log().slice(-1)[0], bricked: g.getState().rovers.filter((x: any) => x.brickedUntil > 0).length };
    // ignored, with the bay (priority 3) switched off by shed loads: it cannot re-flash its rovers
    g.forceHazard('firmware', undefined, { drill: false, tier: 2 });
    const h = window.hz.one('firmware');
    g.advanceGameSeconds(h.at - g.getState().simTime - 5);
    g.counter('shedLoads');
    g.advanceGameSeconds(6);
    const bricked = g.getState().rovers.filter((x: any) => x.brickedUntil > 0).map((x: any) => ({ id: x.id, home: x.home }));
    const bayDark = window.hz.b(bay).idleReason;
    g.advanceGameSeconds(115);
    g.counter('shedLoads');
    g.advanceGameSeconds(135);
    const s = g.getState();
    const lost = g.getHazards().losses.filter((l: any) => l.what === 'rover');
    const alert = window.hz.alert('^ROVER LOST');
    const slots = window.hz.b(bay).slotsLost;
    g.grantResources({ metals: 50, parts: 50 });
    g.advanceGameSeconds(130);
    return { n0, tele, held, bricked, bayDark, lost, alert, slots, rovers: s.rovers.length, after: g.getState().rovers.length, bay };
  });
  expect(r.n0).toBe(4);
  expect(r.tele.text).toMatch(/FIRMWARE v7\.2 FAILED ON THE CANARY — the fleet takes it in \d:\d\d · 70% brick/);
  expect(r.tele.counters.map((c: any) => c.counter)).toEqual(['holdRollout']);
  expect(r.held.live).toBeUndefined();
  expect(r.held.bricked).toBe(0);
  expect(r.bricked.length).toBe(3);
  expect(r.bayDark).toBe('hazard');
  // the Lander re-flashed its own; the dark bay's rover was lost at its deadline
  expect(r.lost.length).toBe(r.bricked.filter((x: any) => x.home === r.bay).length);
  expect(r.lost.length).toBeGreaterThan(0);
  expect(r.alert.text).toMatch(/^ROVER LOST — #\d+ never came back from v7\.2 · warned \d:\d\d before; the rollout was not held · Robotics Bay #\d+ prints a replacement/);
  expect(r.slots).toBe(r.lost.length);
  expect(r.rovers).toBe(4 - r.lost.length);
  expect(r.after).toBe(4 - r.lost.length + 1); // one reprinted in 120 s
});

test('rogue drones: the kill switch saves the building; ignored, it is stripped and wrecked with no refund, and the audit pauses the Builder', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.climb('AAAA', 5);
    const bay = window.hz.place('roboticsBay', 2);
    const smelter = window.hz.place('smelter', 3);
    g.finishConstruction();
    g.completeTech('autoSmelting');
    g.setRule('smelter', { on: true });
    g.advanceGameSeconds(2);
    const id1 = g.forceHazard('rogueDrones', undefined, { drill: false, tier: 2 });
    g.advanceGameSeconds(1);
    const tele = window.hz.alert('retasked');
    const target = window.hz.one('rogueDrones').target;
    g.counter('killSwitch', id1);
    g.advanceGameSeconds(2);
    const saved = { live: window.hz.one('rogueDrones'), b: window.hz.b(target) };
    g.advanceGameSeconds(300);
    g.forceHazard('rogueDrones', undefined, { drill: false, tier: 2 });
    const h = window.hz.one('rogueDrones');
    g.advanceGameSeconds(h.at - g.getState().simTime + 20);
    const strip = window.hz.alert('^◉ STRIPPING');
    const res0 = { ...g.getState().resources };
    g.advanceGameSeconds(90);
    const s = g.getState();
    return {
      tele, target, saved, strip, smelter, bay, gone: !window.hz.b(h.target), loss: g.getHazards().losses[0],
      wrecked: window.hz.alert('^WRECKED'), metals: [res0.metals, s.resources.metals],
      frozen: s.auto.frozenUntil - s.simTime, rule: s.auto.rules.smelter, vetoFor: s.auto.rules.smelter.nextAt - s.simTime,
    };
  });
  expect(r.tele.text).toMatch(/ROGUE DRONES — Robotics Bay #\d+’s drones are retasked to strip .+ in \d:\d\d/);
  expect(r.tele.counters.map((c: any) => c.counter)).toEqual(['killSwitch']);
  expect(r.saved.live).toBeUndefined();
  expect(r.saved.b.stripT).toBeFalsy();
  expect(r.strip.text).toMatch(/STRIPPING — .+ ▮+▯* \d+% · wrecked at 100%/);
  expect(r.gone).toBe(true);
  expect(r.loss).toMatchObject({ what: 'building', hazard: 'rogueDrones' });
  expect(r.wrecked.text).toMatch(/^WRECKED — .+, stripped by Robotics Bay #\d+’s drones · warned \d:\d\d before; no kill switch/);
  expect(r.metals[1]).toBeLessThanOrEqual(r.metals[0]); // nothing salvaged
  // the post-incident audit: rules paused 2:00, the lost building's rule vetoed a lunar day
  expect(r.frozen).toBeGreaterThan(60);
  if (r.loss.name.startsWith('Regolith Smelter')) {
    expect(r.vetoFor).toBeGreaterThan(600);
  }
});

test('runaway rule: Freeze rules answers it; ignored, junk sites weld and half their stock is wasted; a junk site cancelled in 20 s is refunded in full', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.climb('AAAA', 5);
    g.completeTech('autoExcavation');
    window.hz.place('excavator', 3);
    g.finishConstruction();
    g.setRule('excavator', { on: true });
    g.advanceGameSeconds(2);
    const id1 = g.forceHazard('runaway', undefined, { drill: false, tier: 1 });
    g.advanceGameSeconds(1);
    const tele = window.hz.alert('RULE DRIFT');
    g.counter('freezeRules', id1);
    g.advanceGameSeconds(2);
    const frozen = { live: window.hz.one('runaway'), log: window.hz.log().slice(-1)[0] };
    g.advanceGameSeconds(300);
    g.grantResources({ metals: 600, parts: 300 });
    g.forceHazard('runaway', undefined, { drill: false, tier: 1 });
    const h = window.hz.one('runaway');
    g.advanceGameSeconds(h.at - g.getState().simTime + 2);
    const firstJunk = g.getState().buildings.filter((b: any) => b.junk);
    // the first junk site, cancelled at once: every metal back
    const m0 = g.getState().resources.metals;
    if (firstJunk[0]) g.demolish(firstJunk[0].id);
    g.advanceGameSeconds(1);
    const refund = g.getState().resources.metals - m0;
    g.advanceGameSeconds(120);
    const s = g.getState();
    return {
      tele, frozen, first: firstJunk.length, refund, junk: s.buildings.filter((b: any) => b.junk).map((b: any) => ({ c: b.construction, type: b.type })),
      wasted: g.getHazards().losses.filter((l: any) => l.what === 'stock'), cost: 30,
    };
  });
  expect(r.tele.text).toMatch(/RULE DRIFT — the Excavation rule’s cap reads \d+, not \d+: it orders in \d:\d\d/);
  expect(r.tele.counters.map((c: any) => c.counter)).toEqual(['freezeRules']);
  expect(r.frozen.live).toBeUndefined();
  expect(r.frozen.log.outcome).toBe('answered: Freeze rules');
  expect(r.first).toBe(1);
  expect(r.refund).toBeGreaterThan(0);
  expect(r.junk.length).toBeGreaterThanOrEqual(2);
  expect(r.junk.every((j: any) => j.c === 0)).toBe(true); // welded by the hijacked drones
  expect(r.wasted.length).toBe(r.junk.length);
  expect(r.wasted[0].cause).toMatch(/welded as junk by the drifting rule: half its stock wasted/);
  // every loss keeps the warning it followed: the telegraph and more
  expect(r.wasted.every((l: any) => l.at - l.warnedAt >= 120)).toBe(true);
});

test('hacked outpost: Rotate keys answers it; ignored at major, the stream stops and the outpost is lost after a lunar day', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.climb('AAAA', 5);
    g.forceOutposts(1);
    g.advanceGameSeconds(2);
    g.grantResources({ chips: 20 });
    const id1 = g.forceHazard('hackedOutpost', undefined, { drill: false, tier: 2 });
    g.advanceGameSeconds(1);
    const tele = window.hz.alert('OUTPOST INTRUSION');
    g.counter('rotateKeys', id1);
    g.advanceGameSeconds(2);
    const rotated = { live: window.hz.one('hackedOutpost'), log: window.hz.log().slice(-1)[0] };
    g.advanceGameSeconds(300);
    g.forceHazard('hackedOutpost', undefined, { drill: false, tier: 2 });
    const h = window.hz.one('hackedOutpost');
    g.advanceGameSeconds(h.at - g.getState().simTime + 2);
    const hacked = g.getState().survey.outposts[0]?.hacked;
    g.advanceGameSeconds(720 - 100);
    const clock = window.hz.alert('^OUTPOST LOST in');
    g.advanceGameSeconds(120);
    return { tele, rotated, hacked, clock, outposts: g.getState().survey.outposts.length, loss: g.getHazards().losses.find((l: any) => l.what === 'outpost') };
  });
  expect(r.tele.text).toMatch(/OUTPOST INTRUSION — .+ uplink spoofed; stream diverted in \d:\d\d/);
  expect(r.tele.counters[0].label).toBe('Rotate keys 5▣');
  expect(r.rotated.log.outcome).toBe('answered: Rotate keys');
  expect(r.hacked).toBe(true);
  expect(r.clock.text).toMatch(/^OUTPOST LOST in \d:\d\d/);
  expect(r.outposts).toBe(0);
  expect(r.loss.cause).toMatch(/hopper was flown into the ground/);
});

test('control plane: with Fleet OS and every Data Center dark 15 s it drops; drones in flight fall at major; Land drones saves them', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.climb('AAAAAA', 7); // Fleet OS: the control plane; ◉ 6: major
    const dc = window.hz.place('dataCenter', 2);
    const hive = window.hz.place('droneHive', 5);
    g.finishConstruction();
    g.grantPower(80000);
    g.setHazardClock(99999);
    g.forceHazard('controlPlane'); // the drill
    g.advanceGameSeconds(3);
    const drill = window.hz.log().slice(-1)[0];
    // long builds for the drones to fly to
    for (let i = 0; i < 4; i++) window.hz.place('chipFab', 9);
    g.advanceGameSeconds(3);
    const flying = g.getState().rovers.filter((x: any) => x.home === hive && x.site !== null).length;
    // answered: the drones set down before the Data Center goes
    g.counter('landDrones');
    g.setEnabled(dc, false);
    g.advanceGameSeconds(3);
    const tele = window.hz.alert('CONTROL PLANE DROPS');
    const grace = window.hz.one('controlPlane');
    g.advanceGameSeconds(140); // Failover (Lights-Out Charter): the Lander carries it 120 s
    const down = { live: window.hz.one('controlPlane'), lost: g.getHazards().losses.length };
    g.setEnabled(dc, true);
    g.advanceGameSeconds(45);
    const restored = window.hz.one('controlPlane');
    g.advanceGameSeconds(130);
    // ignored at major: the drones in flight fall
    g.advanceGameSeconds(3);
    g.setEnabled(dc, false);
    g.advanceGameSeconds(100);
    for (let i = 0; i < 4; i++) window.hz.place('chipFab', 14);
    g.advanceGameSeconds(30);
    const flying2 = g.getState().rovers.filter((x: any) => x.home === hive && x.site !== null).length;
    const dbg = JSON.stringify({ t: g.getState().simTime, rovers: g.getState().rovers, sites: g.getState().buildings.filter((b: any) => b.construction > 0).map((b: any) => [b.id, b.type, b.construction, b.idleReason]), live: g.getHazards().state.live.map((h: any) => [h.kind, h.phase]), held: g.getHazards().state.dronesHeldUntil });
    g.advanceGameSeconds(10);
    return { dbg, drill, flying, tele, grace: grace.at - grace.warnedAt, down, restored, flying2, fell: g.getHazards().losses.filter((l: any) => l.what === 'drone'), fellAlert: window.hz.alert('^DRONE LOST'), frozen: g.getState().auto.frozenUntil > g.getState().simTime };
  });
  expect(r.drill.drill).toBe(true);
  expect(r.flying).toBeGreaterThan(0);
  expect(r.tele.text).toMatch(/CONTROL PLANE DROPS in \d:\d\d — no Data Center running · drones in flight will fall · ⚠ destroys/);
  expect(r.grace).toBeGreaterThanOrEqual(120 + 15 - 3);
  expect(r.down.live.phase).toBe('active');
  expect(r.down.lost).toBe(0);
  expect(r.restored).toBeUndefined();
  expect(r.flying2, r.dbg).toBeGreaterThan(0);
  expect(r.fell.length, r.dbg).toBe(r.flying2);
  expect(r.fellAlert.text).toMatch(/^DRONE LOST — drone #\d+ fell when the control plane dropped · warned \d:\d\d before; the drones were not landed/);
  expect(r.frozen).toBe(true);
});

// ───────────────────────────── the meters ─────────────────────────────

test('cabin fever: at 70 the warning carries Commons night and Call home; at 100 a crisis — morale, a strike — and two send crew home', async ({ page }) => {
  await start(page, 'mare', 'human');
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.climb('CCC', 4); // Crew Rotation Charter: CABIN FEVER begins
    const lab = window.hz.place('lab');
    g.finishConstruction();
    g.setHazardClock(99999);
    const keep = () => g.grantResources({ oxygen: 300, food: 200, water: 150 });
    keep();
    g.forceHazard('cabinFever'); // the drill: its crisis is only morale
    g.advanceGameSeconds(1);
    const warn = window.hz.alert('^⌂ CABIN FEVER');
    g.counter('commonsNight');
    g.advanceGameSeconds(2);
    const eased = { live: window.hz.one('cabinFever'), iso: g.getHazards().meters.isolation };
    // ignored, twice: from 70 to 100 at the minor +10/day, and +10 more crowded
    g.grantCrew(12);
    g.forceHazard('cabinFever');
    for (let t = 0; t < 2400 && window.hz.one('cabinFever'); t += 60) { keep(); g.advanceGameSeconds(60); }
    const cf = () => window.hz.log().filter((e: any) => e.kind === 'cabinFever');
    const first = { log: cf()[0], iso: g.getHazards().meters.isolation };
    g.forceHazard('cabinFever');
    for (let t = 0; t < 2400 && window.hz.one('cabinFever'); t += 60) { keep(); g.advanceGameSeconds(60); }
    const s = g.getState();
    return { warn, eased, first, second: cf()[1], third: cf()[2], strike: s.buildings.find((b: any) => b.id === lab).strikeUntil > s.simTime,
      leaving: g.getHazards().state.leaving, home: window.hz.alert('took the ride home'), crisis: window.hz.alert('^CABIN FEVER CRISIS'), deaths: g.getHazards().deaths.length };
  });
  expect(r.warn.text).toMatch(/CABIN FEVER 70\/100 — a crisis in ~\d+:\d\d at \+\d+\/day/);
  expect(r.warn.counters.map((c: any) => c.label)).toEqual(['Commons night 30✳', 'Call home 60≡']);
  expect(r.eased.live).toBeUndefined();
  expect(r.eased.iso).toBeLessThan(60);
  expect(r.first.log).toMatchObject({ drill: true, outcome: 'answered: the crew settled' });
  expect(r.second.outcome).toBe('ignored: a crisis');
  expect(r.third.outcome).toBe('ignored: a crisis');
  // two crises in 3 lunar days: 2 crew take the next ride home (Earth contact), alive
  expect(r.leaving === 2 || /CREW HOME — 2 crew members took the ride home after two crises/.test(r.home?.text ?? '')).toBe(true);
  expect(r.strike).toBe(true);
  expect(r.crisis.text).toMatch(/Research Lab #\d+ on strike/);
  expect(r.deaths).toBe(0); // people quit, they do not die
});

test('dust: airlock filters fill near the digging; the warning carries Clean; clogged, upkeep doubles and the hull wears', async ({ page }) => {
  await start(page, 'mare', 'human');
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.climb('CC', 3);
    const hab = window.hz.place('habitat', 3);
    for (let i = 0; i < 3; i++) window.hz.place('excavator', 4);
    g.finishConstruction();
    g.setHazardClock(99999);
    const keep = () => g.grantResources({ oxygen: 300, food: 200, water: 150, parts: 100 });
    let warn: any = null;
    for (let t = 0; t < 3000 && !warn; t += 60) { keep(); g.advanceGameSeconds(60); warn = window.hz.alert('DUST IN THE AIRLOCKS'); }
    const dust = window.hz.b(hab).airlockDust;
    g.counter('clean', hab);
    g.advanceGameSeconds(1);
    const cleaned = window.hz.b(hab).airlockDust;
    for (let t = 0; t < 4000 && (window.hz.b(hab).airlockDust ?? 0) < 1; t += 60) { keep(); g.advanceGameSeconds(60); }
    const w0 = window.hz.b(hab).wear;
    for (let t = 0; t < 1440; t += 60) { g.advanceGameSeconds(60); keep(); }
    return { warn, dust, cleaned, clogged: window.hz.b(hab).airlockDust, w: [w0, window.hz.b(hab).wear], alert: window.hz.alert('FILTERS CLOGGED') };
  });
  expect(r.warn.text).toMatch(/DUST IN THE AIRLOCKS — Habitat Module #\d+ filters \d+%: Regolith Excavator #\d+ digs \d+ m away/);
  expect(r.warn.counters.map((c: any) => c.label)).toEqual(['Clean 5⚙']);
  expect(r.dust).toBeGreaterThanOrEqual(0.7);
  expect(r.cleaned).toBeLessThan(0.01);
  expect(r.clogged).toBe(1);
  expect(r.alert.text).toMatch(/FILTERS CLOGGED — Habitat Module #\d+: upkeep ×2 and the hull wears toward a breach/);
});

// ───────────────────────────── losses of the mission ─────────────────────────────

test('lost mission: the last settler dies in an ignored breach; the screen and the title line name the cause and the missed warning', async ({ page }) => {
  await start(page, 'mare', 'human');
  await page.evaluate(() => {
    const g = window.__game;
    window.climb('CC', 3);
    const hab = window.hz.place('habitat');
    g.finishConstruction();
    g.grantCrew(1 - g.getState().crew);
    g.advanceGameSeconds(1);
    g.forceHazard('breach', hab, { drill: false, tier: 2 });
    g.advanceGameSeconds(95);
  });
  await expect(page.locator('#defeat-screen')).toBeVisible();
  await expect(page.locator('#defeat-cause')).toContainText('The last settler died: Habitat Module #2 decompressed.');
  await expect(page.locator('#defeat-warning')).toContainText('The warning came 1:30 before');
  await expect(page.locator('#defeat-screen .sub')).toContainText('MISSION LOST');
  const s = await g(page, 'getState');
  expect(s.defeatShown).toBe(true);
  expect(s.deaths[0]).toMatchObject({ hazard: 'breach' });
  // the title screen, from the lost save
  await page.waitForTimeout(500);
  await page.goto('/?debug&nolock&lowfx');
  await expect(page.locator('#lost-mission')).toContainText('Mission lost — ');
  await expect(page.locator('#lost-mission')).toContainText(': Habitat Module #2 decompressed.');
});

test('robotic: the whole crew can die and the base runs on unmanned; settlers come again once the grief has passed', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.climb('AC', 3);
    g.completeTech('humanCohabitation');
    const hab = window.hz.place('habitat');
    window.hz.place('hydroponics');
    g.finishConstruction();
    g.grantCrew(2);
    g.advanceGameSeconds(1);
    g.forceHazard('breach', hab, { drill: false, tier: 2 });
    g.advanceGameSeconds(95);
    const after = g.getState();
    const out: any = { crew: after.crew, defeat: after.defeatShown, deaths: g.getHazards().deaths.length, growthHeld: g.getHazards().grief.length };
    g.counter('seal', window.hz.one('breach')?.id);
    g.counter('repair', hab);
    for (let t = 0; t < 2400 && g.getState().crew === 0; t += 60) { g.grantResources({ oxygen: 300, food: 200, water: 150, parts: 60 }); g.advanceGameSeconds(60); }
    out.back = g.getState().crew;
    out.backAt = g.getState().simTime - after.simTime;
    return out;
  });
  expect(r.deaths).toBe(2);
  expect(r.crew).toBe(0);
  expect(r.defeat).toBe(false);
  expect(r.back).toBeGreaterThan(0);
  expect(r.backAt).toBeGreaterThanOrEqual(720); // growth paused a lunar day by the grief
});

// ───────────────────────────── both sides ─────────────────────────────

test('Concord faces both sides, milder: each side minor while a pure side is major, and the windows alternate', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const H = await import('/src/core/hazards.ts');
    window.climb('ACACAC', 7); // ⌂ 3 · ◉ 3
    const h = g.getHazards();
    let credit = { colony: 0, automation: 0 };
    const seq: string[] = [];
    for (let i = 0; i < 6; i++) { const x = H.nextSide(credit, { colony: 3, automation: 3 }, ['colony', 'automation']); credit = x.credit; seq.push(x.side[0]); }
    return { sides: h.sides.map((x: any) => [x.side, x.tier]), chip: h.chip, seq: seq.join('') };
  });
  expect(r.sides).toEqual([['colony', 0], ['automation', 0]]);
  expect(r.chip).toBe('⌂ HAB ▮▯▯ · ◉ NET ▮▯▯');
  expect(r.seq).toBe('cacaca');
  await start(page, 'mare', 'robotic');
  const pure = await page.evaluate(() => { window.climb('AAAAAA', 7); return window.__game.getHazards().sides.map((x: any) => [x.side, x.tier]); });
  expect(pure).toEqual([['colony', null], ['automation', 2]]);
});

// ───────────────────────────── settings, saves, the UI ─────────────────────────────

test('guards ⌂: Regolith Shielding halves the pitting, Safety Protocols stretch the telegraph ×1.5, Pressure bulkheads save everyone and seal in 30 s', async ({ page }) => {
  await start(page, 'mare', 'human');
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.climb('CC', 3);
    const hab = window.hz.place('habitat');
    g.finishConstruction();
    g.advanceGameSeconds(1);
    const risk = () => g.getHazards().kinds.find((k: any) => k.id === 'breach').risk;
    const r0 = risk();
    g.completeTech('regolithShielding');
    g.advanceGameSeconds(1);
    const r1 = risk();
    g.completeTech('safetyProtocols');
    g.advanceGameSeconds(1);
    const id1 = g.forceHazard('breach', hab, { drill: false, tier: 1 });
    const h1 = window.hz.one('breach');
    g.grantResources({ parts: 50 });
    g.counter('seal', id1);
    g.advanceGameSeconds(25);
    const sealed = window.hz.log().slice(-1)[0];
    g.advanceGameSeconds(300);
    g.completeTech('gardenDomes');
    g.advanceGameSeconds(1);
    const crew0 = g.getState().crew;
    g.forceHazard('breach', hab, { drill: false, tier: 2 });
    const h2 = window.hz.one('breach');
    g.advanceGameSeconds(h2.at - g.getState().simTime + 1);
    const open = { crew: g.getState().crew, breached: !!window.hz.b(hab).breached, alert: window.hz.alert('^BREACH')?.text };
    g.advanceGameSeconds(31);
    return { r0, r1, h1, sealed, crew0, open, after: g.getState().crew, deaths: g.getHazards().deaths.length, hab: window.hz.b(hab), log: window.hz.log().slice(-1)[0] };
  });
  expect(r.r1).toBeCloseTo(r.r0 - 0.075, 3);        // the micrometeorite term 0.15 → 0.075
  expect(r.h1.at - r.h1.warnedAt).toBe(120 * 1.5);  // Safety Protocols
  expect(r.sealed.outcome).toBe('answered: Seal');
  expect(r.open.breached).toBe(true);
  expect(r.open.crew).toBe(r.crew0);                // major, ignored, 4 aboard: nobody dies
  expect(r.open.alert).toMatch(/the bulkheads seal it in 0:30/);
  expect(r.after).toBe(r.crew0);
  expect(r.deaths).toBe(0);
  expect(r.hab.breached).toBeFalsy();
  expect(r.hab.decompressed).toBeFalsy();
  expect(r.log.outcome).toBe('sealed after it opened');
});

test('guards ◉: Signed firmware holds the rollout, Intrusion detection doubles the telegraph and isolates a new infection, Rule attestation stops a drift after one site', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.climb('AA', 3);
    window.hz.place('roboticsBay', 2);
    ['relayMast', 'lab', 'lab'].forEach((t) => window.hz.place(t, 2));
    g.finishConstruction();
    g.grantPower(20000);
    g.advanceGameSeconds(2);
    const kind = (id: string) => g.getHazards().kinds.find((k: any) => k.id === id);
    const fw0 = kind('firmware').risk;
    const mw0 = kind('malware').risk;
    g.completeTech('lightsOutFabs');
    g.completeTech('fleetOS');
    g.advanceGameSeconds(1);
    const fw1 = kind('firmware').risk;
    const mw1 = kind('malware').risk;
    g.forceHazard('malware', undefined, { drill: false, tier: 1 });
    const h = window.hz.one('malware');
    g.advanceGameSeconds(h.at - g.getState().simTime + 1);
    const entry = window.hz.b(h.target);
    const iso = entry.isolatedUntil - g.getState().simTime;
    for (const b of g.getState().buildings) if (b.infected) g.counter('reimage', b.id);
    g.grantData(500);
    g.advanceGameSeconds(90);
    // the drift: attested, it orders one site and stops
    g.completeTech('replicatorStacks');
    g.completeTech('autoExcavation');
    window.hz.place('excavator', 3);
    g.finishConstruction();
    g.setRule('excavator', { on: true });
    g.advanceGameSeconds(2);
    g.grantResources({ metals: 600, parts: 300 });
    g.forceHazard('runaway', undefined, { drill: false, tier: 2 });
    const run = window.hz.one('runaway');
    g.advanceGameSeconds(run.at - g.getState().simTime + 200);
    return { fw0, fw1, mw0, mw1, tele: h.at - h.warnedAt, iso, junk: g.getState().buildings.filter((b: any) => b.junk).length, runLive: window.hz.one('runaway') };
  });
  expect(r.fw0).toBeGreaterThan(0.2);
  expect(r.fw1).toBe(0);                  // Signed firmware: the window is a near miss
  expect(r.mw1).toBeLessThan(r.mw0);      // exposure ×0.7
  expect(r.tele).toBe(120 * 2);           // Intrusion detection
  expect(r.iso).toBeGreaterThan(25);      // a new infection isolates itself for 30 s
  expect(r.junk).toBe(1);                 // Rule attestation: 1 site, not 8
  expect(r.runLive).toBeUndefined();
});

test('pause on: a new hazard pauses the game (on by default); the menu turns it off; every lethal warning pauses when asked', async ({ page }) => {
  await start(page, 'mare', 'human', '&hzpause');
  await page.evaluate(() => {
    const g = window.__game;
    window.climb('CC', 3);
    (window as any).habId = window.hz.place('habitat');
    window.hz.place('smelter'); // a water source
    g.finishConstruction();
  });
  // a first publish takes the baseline; then a new hazard pauses
  await page.evaluate(() => { window.__game.setPaused(false); window.__game.advanceGameSeconds(1); });
  await page.waitForFunction(() => !window.__game.getState().paused);
  await page.evaluate(() => window.__game.forceHazard('breach', (window as any).habId));
  await page.waitForFunction(() => window.__game.getState().paused, null, { timeout: 5000 });
  // off in the menu
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#menu-pause-hz')).toHaveText('On');
  await expect(page.locator('#menu-pause-lethal')).toHaveText('Off');
  await page.locator('#menu-pause-hz').click();
  await expect(page.locator('#menu-pause-hz')).toHaveText('Off');
  await page.locator('#menu-pause-lethal').click();
  await expect(page.locator('#menu-pause-lethal')).toHaveText('On');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.__game.setPaused(false); window.__game.advanceGameSeconds(1); });
  await page.waitForFunction(() => !window.__game.getState().paused);
  // a new warning that cannot kill (cabin fever): no pause with pauseHazards off
  await page.evaluate(() => { window.__game.forceHazard('cabinFever'); });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__game.getState().paused)).toBe(false);
  // a lethal one pauses
  await page.evaluate(() => { window.__game.forceHazard('contamination', undefined, { drill: false, tier: 1 }); });
  await page.waitForFunction(() => window.__game.getState().paused, null, { timeout: 5000 });
});

test('migration: a save from before the hazards gets a lunar day of grace, a drill owed for every kind, and its fields filled', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.climb('AAAA', 5);
    for (let i = 0; i < 3; i++) window.hz.place('roboticsBay');
    g.finishConstruction();
    const blob = g.saveBlob();
    delete blob.state.hazards; delete blob.state.deaths; delete blob.state.losses; delete blob.state.grief;
    for (const b of blob.state.buildings) { delete b.airlockDust; delete b.infected; delete b.airGapped; delete b.evacT; delete b.stripT; }
    for (const x of blob.state.rovers) delete x.brickedUntil;
    const t0 = blob.state.simTime;
    g.loadBlob(blob);
    const s = g.getState();
    const filled = { hz: !!s.hazards, grace: s.hazards.graceUntil - t0, drilled: s.hazards.drilled, deaths: s.deaths, losses: s.losses,
      b: s.buildings.every((b: any) => b.airlockDust === 0 && b.infected === false && b.airGapped === false), rv: s.rovers.every((x: any) => x.brickedUntil === 0) };
    g.setPaused(true);
    g.advanceGameSeconds(700);
    const quiet = window.hz.log().length + window.hz.live().length;
    g.advanceGameSeconds(120);
    return { filled, quiet, later: window.hz.log().length + window.hz.live().length };
  });
  expect(r.filled.hz).toBe(true);
  expect(r.filled.grace).toBeGreaterThanOrEqual(719);
  expect(r.filled.drilled).toEqual([]);
  expect(r.filled.deaths).toEqual([]);
  expect(r.filled.losses).toEqual([]);
  expect(r.filled.b).toBe(true);
  expect(r.filled.rv).toBe(true);
  expect(r.quiet).toBe(0);
  expect(r.later).toBeGreaterThan(0);
});

test('UI: the chip opens the [G] panel; an alert’s counter button runs the counter; the inspector shows who is aboard, the counters and the air gap; it fits at 1280×720', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await start(page, 'mare', 'human');
  const hab = await page.evaluate(() => {
    const g = window.__game;
    window.climb('CC', 3);
    const id = window.hz.place('habitat');
    g.finishConstruction();
    g.setHazardClock(99999);
    g.forceHazard('breach', id, { drill: false, tier: 1 });
    g.advanceGameSeconds(1);
    return id;
  });
  const chip = page.locator('#hazard-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText('⚠ ⌂ HAB ▮▯▯');
  await expect(chip).toHaveClass(/flash/);
  await chip.click();
  const panel = page.locator('#hazards-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('⚠ HAZARDS');
  await expect(panel.locator('.hz-live')).toContainText('SEAL FATIGUE');
  await expect(panel.locator('.hz-kind[data-kind="breach"] .hz-risk')).toHaveText(/▮/);
  const box = await panel.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(720);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1280);
  await page.keyboard.press('KeyG');
  await expect(panel).toBeHidden();
  await page.keyboard.press('KeyG');
  await expect(panel).toBeVisible();
  await page.keyboard.press('KeyG');
  // the objectives' live line, while the people inside are at risk
  await expect(page.locator('#milestones .goal-hazard')).toContainText('breach in');
  await expect(page.locator('#milestones .goal-hazard')).toContainText('seal or evacuate');
  // the alert's own Evacuate button
  const btn = page.locator('.alert .hz-ctr', { hasText: 'Evacuate' }).first();
  await expect(btn).toBeVisible();
  await btn.click();
  await page.evaluate(() => window.__game.advanceGameSeconds(1));
  expect((await page.evaluate((id) => window.__game.getState().buildings.find((b: any) => b.id === id).evacT, hab))).toBeGreaterThan(1e9);
  // the inspector: aboard, and its counters
  await page.evaluate((id) => window.__game.select(id), hab);
  const insp = page.locator('#inspector');
  await expect(insp.locator('.insp-hzs')).toContainText('⚠ Hazards');
  await expect(insp.locator('.insp-hzs')).toContainText('SEAL FATIGUE');
  await expect(insp.locator('.insp-hzs .hz-ctr', { hasText: 'Seal 12⚙' })).toBeVisible();
  // a network node's air-gap row (a robotic base with ◉ 2)
  await start(page, 'mare', 'robotic');
  const mast = await page.evaluate(() => {
    const g = window.__game;
    window.climb('AA', 3);
    const id = window.hz.place('roboticsBay');
    g.finishConstruction();
    g.select(id);
    return id;
  });
  const gap = page.locator('#inspector .hz-ctr[data-ctr="airGap"]');
  await expect(gap).toHaveText('Air-gap');
  await gap.click();
  await page.evaluate(() => window.__game.advanceGameSeconds(1));
  expect(await page.evaluate((id) => window.__game.getState().buildings.find((b: any) => b.id === id).airGapped, mast)).toBe(true);
  await expect(page.locator('#inspector .hz-ctr[data-ctr="airGap"]')).toHaveText('Reconnect');
});
