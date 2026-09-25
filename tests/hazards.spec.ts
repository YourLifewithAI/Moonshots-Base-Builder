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
  for (let i = 0; i < 60; i++) {
    const t = (await page.locator('#era-banner').textContent()) ?? '';
    if (/NEW HAZARD/.test(t) && await page.locator('#era-banner').isVisible()) break;
    await page.evaluate(() => {
      const q = document.querySelector<HTMLElement>('#era-banner [data-dsc="ok"]:not([hidden])');
      const c = document.querySelector<HTMLElement>('#discovery-card [data-dsc="ok"]');
      const banner = document.getElementById('era-banner')!;
      (banner.style.display !== 'none' ? q : c)?.click();
    });
  }
  await expect(page.locator('#era-banner')).toContainText('NEW HAZARD');
  await expect(page.locator('#era-banner')).toContainText('Next time, the people inside die');
});
