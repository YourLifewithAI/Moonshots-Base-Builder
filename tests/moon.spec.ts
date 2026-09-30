/** The shared Moon (docs/20 §4.4, stream W0c): one absolute clock, one flare schedule, exclusive prospect claims and
 *  save v2. The pure half drives core modules with dynamic imports (two `createInitialState` bases bound to one
 *  `MoonState`, ticked with `weatherTick` over the same clock); the save half takes `saveBlob()` from a solo game
 *  and loads it through `asV2`. A solo game never has a Moon: its flare path is unchanged, and a solo game ON a Moon
 *  (what a loaded v1 save becomes) runs the same flares to the tick. */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

/** A page with the modules the pure tests drive; `H` holds them and the helpers. */
async function pure(page: Page) {
  await page.goto('/?debug');
  await page.evaluate(async () => {
    const [S, M, W, Mods, D, Sites, B, X, V] = await Promise.all([
      import('/src/core/state.ts'), import('/src/core/moon.ts'), import('/src/core/spaceWeather.ts'), import('/src/core/mods.ts'),
      import('/src/core/daynight.ts'), import('/src/data/sites.ts'), import('/src/data/balance.ts'), import('/src/core/exploration.ts'),
      import('/src/core/save.ts'),
    ]);
    const mk = (site: string, seed: number, exp: 'human' | 'robotic', landedAt = 0, arrays = 0) => {
      const s = S.createInitialState(site, seed, exp, landedAt);
      for (let i = 0; i < arrays; i++) {
        s.buildings.push({ id: s.nextBuildingId++, type: 'solar', gx: 100 + 2 * i, gz: 100, rot: 0, enabled: true, automated: false,
          priority: 1, wear: 0, dust: 0, construction: 0 } as any);
      }
      return s;
    };
    const tick = (s: any) => {
      const site = Sites.SITES[s.siteId];
      s.simTime += 1;
      W.weatherTick(s, site, Mods.computeMods(s.techsDone, s.expedition, s.siteId), D.dayInfo(s.simTime, site), 1);
    };
    const canon = (o: unknown) => JSON.stringify(o, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));
    (window as any).H = { S, M, W, Mods, D, Sites, B, X, V, mk, tick, canon };
  });
}

test('two bases on one Moon see the same flare and keep their own effects', async ({ page }) => {
  await pure(page);
  const r = await page.evaluate(() => {
    const { M, mk, tick, B } = (window as any).H;
    // the Foundry lands at day 0 on Mare with three arrays; the Vanguard at day 1 on the pole with none
    const a = mk('mare', 42, 'robotic', 0, 3);
    const b = mk('southpole', 7, 'human', B.CYCLE_S, 0);
    a.faction = 'robots'; b.faction = 'accelerationists';
    const moon = M.createMoon(42, { clock: a.simTime, player: 'robots', siteId: 'mare' });
    M.bindMoon(a, moon); M.bindMoon(b, moon);
    // b has not landed: only a ticks until b's clock
    while (a.simTime < b.simTime) tick(a);
    const seen: any[] = [];
    let split = '', raisedEra = false, t = 0;
    const keys = ['phase', 'timer', 'n', 'cls', 'drill', 'flashAt', 'firmAt', 'activeAt', 'nextAt', 'a', 'xCount', 'watch', 'nextCls', 'range', 'startedAt'];
    while (t++ < 8000 && !split) {
      tick(a); tick(b);
      for (const k of keys) if (JSON.stringify(a.flare[k]) !== JSON.stringify(b.flare[k])) split = `t=${a.simTime} ${k}: ${JSON.stringify(a.flare[k])} vs ${JSON.stringify(b.flare[k])}`;
      const pa = a.flare;
      if (pa.phase === 'telegraph' && (seen.length === 0 || seen[seen.length - 1].n !== pa.n)) seen.push({ n: pa.n, cls: pa.cls, at: a.simTime, drill: pa.drill });
      // the player's era rules the odds: once the drill is through, raise it (the rival stays era 1)
      if (!raisedEra && seen.length >= 1 && pa.phase === 'active') { a.era = 2; raisedEra = true; }
    }
    const brief = (s: any) => s.flare.log.map((e: any) => ({ n: e.n, cls: e.cls, stowed: e.stowed, running: e.running }));
    return { split, seen, moonEra: moon.weather.era, aLog: brief(a), bLog: brief(b), aSeed: a.seed, bSeed: b.seed, moonSeed: moon.seed, bEra: b.era };
  });
  expect(r.split).toBe('');
  // several flares in 8000 s; the first is the C drill, and after the player reached era 2 the next is an M
  expect(r.seen.length).toBeGreaterThanOrEqual(3);
  expect(r.seen[0].cls).toBe('C');
  expect(r.seen[0].drill).toBe(true);
  expect(r.seen[1].cls).toBe('M');
  // the player's era is the Moon's; the rival never moved it
  expect(r.moonEra).toBe(2);
  expect(r.bEra).toBe(1);
  // both bases lived through the same flares (same index and class), each with its own tally
  expect(r.aLog.length).toBeGreaterThanOrEqual(2);
  expect(r.bLog.length).toBeGreaterThanOrEqual(1);
  const last = r.bLog[r.bLog.length - 1];
  const twin = r.aLog.find((e: any) => e.n === last.n);
  expect(twin?.cls).toBe(last.cls);
  // a's arrays were stowed or run through it (one may be a wreck by now); b has none: the effects are the base's own
  expect(twin.stowed + twin.running).toBeGreaterThan(0);
  expect(last.stowed + last.running).toBe(0);
  // the schedule draws from the Moon's seed; a base's own seed only moves its own effects
  expect(r.moonSeed).toBe(42);
  expect(r.bSeed).toBe(7);
});

test('a base that lands mid-flare sits that flare out', async ({ page }) => {
  await pure(page);
  const r = await page.evaluate(() => {
    const { M, mk, tick, W, B } = (window as any).H;
    const a = mk('mare', 42, 'robotic', 0, 2);
    a.faction = 'robots';
    const moon = M.createMoon(42, { clock: a.simTime, player: 'robots' });
    M.bindMoon(a, moon);
    // run the Moon until its first flare is in its active phase
    let t = 0;
    while (a.flare.phase !== 'active' && t++ < 6000) tick(a);
    const n = a.flare.n;
    // a rival lands now, at the Moon's clock
    const b = mk('southpole', 7, 'human', 0, 2);
    b.faction = 'accelerationists'; b.landedAt = a.simTime - 90; b.simTime = a.simTime;
    M.bindMoon(b, moon);
    const phases: string[] = [];
    let sat = true;
    for (let i = 0; i < 400 && a.flare.phase !== 'idle'; i++) { tick(a); tick(b); phases.push(b.flare.phase); if (b.flare.phase !== 'idle') sat = false; }
    // the next flare is b's too
    let next = false;
    for (let i = 0; i < 6000 && !next; i++) { tick(a); tick(b); if (b.flare.phase === 'telegraph') next = b.flare.n === a.flare.n && b.flare.n > n; }
    return { sat, n, nextSeen: next, bLog: b.flare.log.length, aLog: a.flare.log.length, bN: b.flare.n, aN: a.flare.n };
  });
  expect(r.sat).toBe(true);
  expect(r.nextSeen).toBe(true);
  expect(r.aLog).toBeGreaterThan(r.bLog);
});

test('a solo game on a Moon flies the same flares as a solo game with none', async ({ page }) => {
  await pure(page);
  const r = await page.evaluate(() => {
    const { M, mk, tick, W, Sites, canon } = (window as any).H;
    // three ways a Game may drive the Moon: nothing (the base drives it), once before each tick, once after each tick
    const mkOn = () => { const s = mk('mare', 42, 'robotic', 0, 3); const moon = M.moonFromState(s); M.bindMoon(s, moon); return { s, moon }; };
    const run = (forceAt: number) => {
      const plain = mk('mare', 42, 'robotic', 0, 3);
      const self = mkOn(), before = mkOn(), after = mkOn();
      const all = forceAt ? [plain, self.s] : [plain, self.s, before.s, after.s];
      let diff = '', t = 0, classes = '', prevPhase = 'idle', next = 0, forced = false;
      const bumps = [[3000, 2], [5000, 4]];
      while (t < 10000 && !diff) {
        t++;
        // era changes land in an active phase (a Game-driven Moon reads the era of the second before at a class draw)
        if (next < bumps.length && t >= bumps[next][0] && plain.flare.phase === 'active') { for (const s of all) s.era = bumps[next][1]; next++; }
        if (forceAt && !forced && t >= forceAt && plain.flare.phase === 'idle') { forced = true; for (const s of all) W.startFlare(s, Sites.SITES.mare, 'X'); }
        if (!forceAt) M.moonWeatherTick(before.moon, 1);
        for (const s of all) tick(s);
        if (!forceAt) M.moonWeatherTick(after.moon, 1);
        const want = canon(plain.flare);
        all.slice(1).forEach((s, i) => { if (!diff && canon(s.flare) !== want) diff = `t=${t} #${i}: ${canon(s.flare)} VS ${want}`; });
        const wl = canon(plain.log.map((e: any) => [e.at, e.text, e.count]));
        all.slice(1).forEach((s, i) => { if (!diff && canon(s.log.map((e: any) => [e.at, e.text, e.count])) !== wl) diff = `t=${t} log #${i}`; });
        if (plain.flare.phase === 'telegraph' && prevPhase === 'idle') classes += plain.flare.cls;
        prevPhase = plain.flare.phase;
      }
      return { diff, classes, logs: plain.flare.log.length, morale: all.map((s) => s.morale), data: all.map((s) => s.data) };
    };
    return { natural: run(0), forced: run(6200) };
  });
  expect(r.natural.diff).toBe('');
  expect(r.forced.diff).toBe('');
  expect(r.natural.logs).toBeGreaterThanOrEqual(4);
  // the drill C, then M once the player is in era 2, and an X once era 4 is open
  expect(r.natural.classes[0]).toBe('C');
  expect(r.natural.classes.length).toBeGreaterThanOrEqual(4);
  expect(r.forced.classes).toContain('X');
  expect(new Set(r.natural.morale).size).toBe(1);
  expect(new Set(r.natural.data).size).toBe(1);
});

test('a claim by one base refuses the other with CLAIMED BY, and abandoning frees it', async ({ page }) => {
  await pure(page);
  const r = await page.evaluate(() => {
    const { M, mk, Mods, X } = (window as any).H;
    const a = mk('mare', 42, 'robotic'); const b = mk('southpole', 7, 'human');
    a.faction = 'robots'; b.faction = 'accelerationists';
    const moon = M.createMoon(42, { player: 'accelerationists' });
    M.bindMoon(a, moon); M.bindMoon(b, moon);
    const modsA = Mods.computeMods(a.techsDone, a.expedition, a.siteId);
    const modsB = Mods.computeMods(b.techsDone, b.expedition, b.siteId);
    X.forceOutposts(a, 2);
    const held = a.survey.outposts.map((o: any) => o.id);
    const pid = held[0];
    const refused = X.claimRefusal(b, modsB, pid);
    const ownRefusal = X.claimRefusal(a, modsA, pid);
    const claims = { ...moon.claims };
    // b's own forced outposts skip what a holds, and never double a claim
    X.forceOutposts(b, 4);
    const bHeld = b.survey.outposts.map((o: any) => o.id);
    const overlap = bHeld.filter((id: string) => held.includes(id));
    const ui = { open: false, view: 'near' as const, seenTier: 0 };
    const rivals = [{ faction: 'robots', name: 'The Foundry', siteId: 'mare', landed: true, landedAt: 0, outposts: held, launches: 3, era: 2 }];
    const view = X.lunarView(b, modsB, ui, rivals);
    const vp = view.prospects.find((p: any) => p.id === pid);
    const abandon = X.abandonOutpost(a, pid);
    const after = X.claimRefusal(b, modsB, pid);
    // a solo state (no Moon): unchanged view, no rivals, no claims written
    const solo = mk('mare', 42, 'robotic');
    const soloMoon = M.createMoon(5);
    M.bindMoon(solo, soloMoon);
    const sv = X.lunarView(solo, Mods.computeMods(solo.techsDone, solo.expedition, solo.siteId), ui);
    X.forceOutposts(solo, 1);
    return {
      held, refused, ownRefusal, claims, bHeld, overlap, rivalOn: vp.rival, reason: vp.reason, claimable: vp.claimable,
      rivals: view.rivals.map((x: any) => ({ f: x.faction, name: x.name, home: x.home, outposts: x.outposts.length, launches: x.launches })),
      abandoned: abandon.ok, after, claimsAfter: { ...moon.claims }, soloRivals: sv.rivals.length,
      soloRival: sv.prospects.every((p: any) => p.rival === null), soloClaims: Object.keys(soloMoon.claims).length, soloOutposts: solo.survey.outposts.length,
    };
  });
  expect(r.held.length).toBe(2);
  expect(r.refused).toBe('CLAIMED BY THE FOUNDRY — its outpost stands there');
  expect(r.ownRefusal).not.toMatch(/CLAIMED BY/);
  expect(r.claims[r.held[0]]).toBe('robots');
  expect(r.overlap).toEqual([]);
  expect(r.bHeld.length).toBe(4);
  expect(r.rivalOn).toEqual({ faction: 'robots', name: 'The Foundry' });
  expect(r.claimable).toBe(false);
  expect(r.rivals).toEqual([{ f: 'robots', name: 'The Foundry', home: expect.objectContaining({ lat: expect.any(Number), lon: expect.any(Number) }), outposts: 2, launches: 3 }]);
  expect(r.abandoned).toBe(true);
  expect(r.after).not.toMatch(/CLAIMED BY/);
  expect(r.claimsAfter[r.held[0]]).toBeUndefined();
  expect(r.claimsAfter[r.held[1]]).toBe('robots');
  expect(r.soloRivals).toBe(0);
  expect(r.soloRival).toBe(true);
  // a solo game files no claims, even on a Moon: nobody to claim against
  expect(r.soloOutposts).toBe(1);
  expect(r.soloClaims).toBe(0);
});

test('a v1 blob loads as solo: race phase solo, no rivals; a v2 round-trips; rivals save stripped', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?debug&seed=42&site=mare&exp=robotic');
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(0); window.__game.advanceGameSeconds(400); });
  const r = await page.evaluate(async () => {
    const { asV2, isV2, saveGame, loadSave, loadGame, stripForRivalSave } = await import('/src/core/save.ts');
    const M = await import('/src/core/moon.ts');
    const blob = window.__game.saveBlob();
    const v2 = asV2(JSON.parse(JSON.stringify(blob)));
    const st = blob.state;
    // the solo Moon: the state's clock and seed, its flare lifted, no claims, nobody landed
    const solo = {
      version: v2.moon.version, phase: v2.moon.race.phase, player: v2.moon.player, rivals: v2.rivals.length, clock: v2.moon.clock === st.simTime,
      seed: v2.moon.seed === st.seed, nextAt: v2.moon.weather.nextAt === st.flare.nextAt, n: v2.moon.weather.n === st.flare.n,
      claims: Object.keys(v2.moon.claims).length, landed: Object.values(v2.moon.factions).some((f: any) => f.landed),
      playerIsState: v2.player.simTime === st.simTime, isV2: isV2(v2), v1IsV2: isV2(blob), landedAt: st.landedAt ?? 0, noKey: !('landedAt' in st),
    };
    // the store: a v1 comes back as v1 (and through loadGame too), a v2 as v2 (and loadGame collapses it)
    await saveGame(blob);
    const back1 = await loadSave();
    const back1g = await loadGame();
    const moon = M.createMoon(9, { player: 'solarpunks', siteId: 'mare' });
    const rivalState = JSON.parse(JSON.stringify(st));
    rivalState.log = [{ id: 1, at: 1, kind: 'info', text: 'x', count: 1 }];
    rivalState.alerts = [{ id: 1, text: 'y', kind: 'info', at: 1, key: 'y', count: 1 }];
    rivalState.flattens = [{ x0: 0, z0: 0, x1: 1, z1: 1, h: 0 }];
    rivalState.terrain = { rev: 1, clock: 1, delta: 'AAAA' };
    rivalState.zones = [{}];
    rivalState.flare.log = [{ n: 0 }];
    rivalState.hazards.log = [{ x: 1 }];
    rivalState.auto.log = [{ x: 1 }];
    const stripped = stripForRivalSave(rivalState);
    const strip = {
      log: stripped.log.length, alerts: stripped.alerts.length, flattens: stripped.flattens.length, delta: stripped.terrain.delta,
      zones: stripped.zones === undefined, fl: stripped.flare.log.length, hl: stripped.hazards.log.length, al: stripped.auto.log.length,
      keeps: stripped.buildings.length === rivalState.buildings.length && stripped.simTime === rivalState.simTime,
      untouched: rivalState.log.length === 1 && rivalState.terrain.delta === 'AAAA' && rivalState.flare.log.length === 1,
    };
    const fat: any = { version: 2, moon, player: st, rivals: [{ faction: 'robots', state: stripped }], savedAt: Date.now() + 1000 };
    await saveGame(fat);
    const back2 = await loadSave();
    const back2g = await loadGame();
    const t0 = performance.now();
    const text = JSON.stringify(fat);
    const ms = performance.now() - t0;
    return {
      solo, strip,
      v1: { isV2: isV2(back1!), same: back1!.savedAt === blob.savedAt, g: !!back1g && (back1g as any).state.simTime === st.simTime },
      v2: {
        isV2: isV2(back2!), rivals: isV2(back2!) ? back2!.rivals.length : -1, faction: isV2(back2!) ? back2!.rivals[0].faction : '',
        seed: isV2(back2!) ? back2!.moon.seed : -1, g: !!back2g && (back2g as any).state.simTime === st.simTime,
      },
      kb: Math.round(text.length / 1024), ms: Math.round(ms * 10) / 10,
    };
  });
  expect(r.solo).toMatchObject({
    version: 2, phase: 'solo', player: null, rivals: 0, clock: true, seed: true, nextAt: true, n: true, claims: 0, landed: false,
    playerIsState: true, isV2: true, v1IsV2: false, landedAt: 0, noKey: true,
  });
  expect(r.strip).toEqual({ log: 0, alerts: 0, flattens: 0, delta: '', zones: true, fl: 0, hl: 0, al: 0, keeps: true, untouched: true });
  expect(r.v1).toEqual({ isV2: false, same: true, g: true });
  expect(r.v2).toEqual({ isV2: true, rivals: 1, faction: 'robots', seed: 9, g: true });
  console.log(`v2 blob (player + one rival copy) ${r.kb} KB, stringify ${r.ms} ms`);
  expect(errors).toEqual([]);
});

test('the mission day counts from the base’s own landing; a solo game shows day 1', async ({ page }) => {
  await page.goto('/?debug&seed=42&site=mare&exp=robotic');
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
  // solo: the clock chip starts on DAY 1, and a day later on DAY 2 (landed at 0: the two counts agree)
  await expect(page.locator('.clock').first()).toContainText('DAY 1 ·');
  const r = await page.evaluate(async () => {
    const S = await import('/src/core/state.ts');
    const N = await import('/src/ui/notify.ts');
    const B = await import('/src/data/balance.ts');
    const day = B.CYCLE_S;
    const solo = S.createInitialState('mare', 42, 'robotic');
    const late = S.createInitialState('mare', 42, 'human', 2 * day);
    const at = (s: any, t: number) => { s.simTime = t; return S.missionDay(s); };
    return {
      soloStart: [S.sinceLanding(solo), solo.landedAt ?? 0, solo.simTime, S.missionDay(solo), 'landedAt' in solo],
      lateStart: [S.sinceLanding(late), late.landedAt, late.simTime, S.missionDay(late)],
      lateDay2: at(late, 3 * day + 90), lateDay1Edge: at(late, 3 * day - 1),
      tags: [N.dayTag(2 * day + 90, 2 * day), N.dayTag(3 * day + 90, 2 * day), N.dayTag(3 * day + 90)],
      filled: (() => { const old: any = { ...solo }; return S.fillStateDefaults(old).landedAt ?? 0; })(),
    };
  });
  // (a solo game carries no `landedAt` key: its saves and digests are as they were; absent reads as 0)
  expect(r.soloStart).toEqual([90, 0, 90, 1, false]);
  // a base landing on day 2 starts at mid-morning of its own day 1, on the absolute clock's day 3
  expect(r.lateStart).toEqual([90, 2 * 720, 2 * 720 + 90, 1]);
  expect(r.lateDay2).toBe(2);
  expect(r.lateDay1Edge).toBe(1);
  expect(r.tags).toEqual(['D1', 'D2', 'D4']);
  expect(r.filled).toBe(0);
});

test('the feed: ids count up, the list is capped, a cursor reads what is new, handlers hear each kind once', async ({ page }) => {
  await pure(page);
  const r = await page.evaluate(() => {
    const { M } = (window as any).H;
    const moon = M.createMoon(42, { player: 'solarpunks' });
    moon.clock = 1000;
    const heard: string[] = [], all: number[] = [];
    const off = M.onFeed('claim', (e: any) => heard.push(`${e.faction}:${e.prospect}`));
    const offAll = M.onFeed('*', (e: any) => all.push(e.id));
    const push = (kind: string, extra: object = {}) => M.pushFeed(moon, { faction: 'robots', kind, text: kind, ...extra });
    const a = push('landed'), b = push('claim', { prospect: 'moltke' });
    M.dispatchFeed(a, { moon, player: null }); M.dispatchFeed(b, { moon, player: null });
    const since = M.feedSince(moon, a.id).map((e: any) => e.id);
    off();
    M.dispatchFeed(push('claim', { prospect: 'cabeus' }), { moon, player: null });
    offAll();
    for (let i = 0; i < 100; i++) push('launch', { n: i });
    return {
      ids: [a.id, b.id], at: [a.at, b.at], since, heard, all,
      len: moon.feed.length, firstId: moon.feed[0].id, lastId: moon.feed.at(-1).id, seq: moon.feedSeq, max: M.FEED_MAX,
      saved: JSON.parse(JSON.stringify(moon)).feedSeq,
      late: M.pushFeed(moon, { faction: 'robots', kind: 'era', text: 'era', at: 5 }).at,
    };
  });
  expect(r.ids).toEqual([1, 2]);
  expect(r.at).toEqual([1000, 1000]);
  expect(r.since).toEqual([2]);
  expect(r.heard).toEqual(['robots:moltke']);   // the claim handler heard the first claim, then was switched off
  expect(r.all).toEqual([1, 2, 3]);              // the wildcard handler heard all three (the claim handler was off for the third)
  expect(r.len).toBe(r.max);
  expect(r.lastId).toBe(r.seq);                  // the newest event is the last id issued, none reused
  expect(r.firstId).toBe(r.seq - r.max + 1);
  expect(r.late).toBe(5);                        // an explicit `at` is kept
  expect(r.saved).toBe(r.seq);                   // the Moon serialises with its feed (save v2)
});
