/** The race (docs/20 §6, stream S6): the player's own line of `moon.race` written by `launchVolley`, the phase that lights at the first
 *  volley of any program, the three share bars on the swarm meter, a rival's first light as a banner and the standings beats on the
 *  feed, the close at `closeAt` combined volleys with its verdict screen (yours, shared, theirs; a tie goes to the earlier first light),
 *  Continue, the closed state through a save, and a solo game that never races. Standings are staged (`rivalLaunches` sets a rival base's
 *  volleys and the next Moon second reports them as a real volley would; `setCloseAt` lowers the close); the player's volleys are real
 *  (`launch` through `launchVolley`), so the path under test is the game's own. */
import { test, expect as baseExpect, type Page } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 20_000 });

declare global {
  interface Window { __game?: any }
}

/** each faction's trim colour (data/factions.ts livery), as the browser computes it */
const TRIM = { robots: 'rgb(232, 99, 43)', accelerationists: 'rgb(63, 115, 238)', solarpunks: 'rgb(95, 159, 63)' } as const;

async function bare(page: Page, query = '') {
  await page.goto(`/?debug&seed=42${query}`);
  await page.waitForFunction(() => window.__game !== undefined);
}
const g = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => window.__game[f as string](...(a as unknown[])), [fn, args] as const);

/** a faction game on the pole, paused, the swarm armed; `tips` also shows the briefing and the era banner (two clicks) */
async function faction(page: Page, f: string, tips = false) {
  await page.evaluate((f) => window.__game.selectFaction(f, 'southpole'), f);
  if (tips) {
    await page.locator('#briefing [data-dsc="ok"]').click();
    await page.locator('#era-banner [data-dsc="ok"]').click();
  }
  await page.evaluate(() => {
    const game = window.__game;
    game.setPaused(true);
    game.advanceGameSeconds(0);
    game.completeTech('swarmProtocol');
  });
}
/** n real volleys by the player's own base (each one granted what it costs, then the game's own `launch` action) */
const volleys = (page: Page, n: number) => page.evaluate((n) => {
  const game = window.__game;
  for (let i = 0; i < n; i++) { game.grantResources({ foils: 10, launch: 3 }); game.grantPower(1000); game.launch(); game.advanceGameSeconds(0); }
}, n);
const tick = (page: Page, s = 1) => page.evaluate((s) => window.__game.advanceGameSeconds(s), s);
const rival = (page: Page, f: string, n: number) => page.evaluate(([f, n]) => window.__game.rivalLaunches(f, n), [f, n] as const);
const feedOf = async (page: Page, kind: string) => (await g(page, 'getFeed') as { kind: string; text: string; faction: string; n?: number }[]).filter((e) => e.kind === kind);

// ───────────────────────────── solo ─────────────────────────────

test('solo: no bars, no chip, no beats, no verdict; the launch row reads the volley terms; the race never closes', async ({ page }) => {
  await bare(page, '&site=mare&exp=robotic');
  await page.evaluate(() => { const game = window.__game; game.setPaused(true); game.advanceGameSeconds(0); game.completeTech('swarmProtocol'); });
  await expect(page.locator('#swarm-meter')).toContainText('Dyson Swarm');
  await expect(page.locator('#swarm-race')).toBeHidden();
  await expect(page.locator('#race-chip')).toBeHidden();
  // the launch row: what a volley takes (volleyTerms, which is the constant for a base with no branch tech)
  await expect(page.locator('#launch-cost')).toContainText('foils 0/10 ✗');
  await expect(page.locator('#launch-cost')).toContainText('launch 0/3↑ ✗');
  await g(page, 'setCloseAt', 2); // (a solo game has no race to close)
  await volleys(page, 12);
  await tick(page, 3);
  const r = await g(page, 'getRace');
  expect(r.phase).toBe('solo');
  expect(r.robots.launches + r.accelerationists.launches + r.solarpunks.launches).toBe(0);
  expect((await g(page, 'getState')).launches).toBe(12);
  expect(await g(page, 'getFeed')).toEqual([]);
  await expect(page.locator('#verdict-screen')).toBeHidden();
  await expect(page.locator('#swarm-race')).toBeHidden();
  await expect(page.locator('#race-chip')).toBeHidden();
});

// ───────────────────────────── the bars, first light, the beats ─────────────────────────────

test('a faction game: the player\'s volleys write the Moon\'s line, the first volley of anyone lights the race, shares and bars follow, a rival\'s first light is a banner, the standings beat', async ({ page }) => {
  test.setTimeout(240_000);
  await bare(page, '&tips');
  await faction(page, 'accelerationists', true);
  const bars = page.locator('#swarm-race .sr-row');
  // before any volley: three bars in landing order, empty, yours marked
  expect((await g(page, 'getRace')).phase).toBe('pre');
  await expect(page.locator('#swarm-race')).toBeVisible();
  await expect(bars).toHaveCount(3);
  expect(await bars.evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.faction))).toEqual(['robots', 'accelerationists', 'solarpunks']);
  await expect(page.locator('#swarm-race .sr-row.you')).toHaveAttribute('data-faction', 'accelerationists');
  await expect(page.locator('#swarm-race .sr-row[data-faction="robots"] .sr-p')).toHaveText('—');
  await expect(page.locator('#race-chip')).toHaveText('⚑ RACE · no first light yet');
  await expect(page.locator('#launch-cost')).toContainText('foils 0/10');

  // our own volley, with no tick after it: the line is written by launchVolley itself, the phase lit at once
  await volleys(page, 1);
  let race = await g(page, 'getRace');
  expect(race.accelerationists.launches).toBe(1);
  expect(race.accelerationists.swarmPct).toBeCloseTo(0.0001, 10);
  expect(race.accelerationists.firstLaunchAt).not.toBeNull();
  expect(race.phase).toBe('lit');
  expect((await feedOf(page, 'firstLight')).map((e) => e.faction)).toEqual(['accelerationists']);
  // FIRST LIGHT, first of three (nobody has lit): the standing line; no banner for our own
  await tick(page);
  await expect(page.locator('#victory-screen')).toBeVisible();
  await expect(page.locator('#victory-standing')).toContainText('FIRST OF THREE TO LIGHT');
  await expect(page.locator('#victory-standing')).toContainText('no other program has lit before you');
  await expect(page.locator('#victory-body')).toContainText('The race closes at 70 combined volleys');
  await expect(page.locator('#race-banner')).toBeHidden();
  await page.locator('#btn-victory-continue').click();

  // the Foundry lights second: a banner in its colours, above the palette; the stack line; the small card is the banner's
  await rival(page, 'robots', 2);
  await tick(page);
  const banner = page.locator('#race-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute('data-faction', 'robots');
  await expect(banner.locator('.rb-title')).toHaveText('FIRST LIGHT · THE FOUNDRY');
  await expect(banner.locator('.rb-text')).toContainText('Second of 3 to light');
  await expect(banner.locator('.rb-text')).toContainText('You lit first');
  await expect(banner.locator('.rb-g')).toHaveText('⚙︎');
  expect(await banner.evaluate((e) => getComputedStyle(e).borderLeftColor)).toBe(TRIM.robots);
  const box = await banner.boundingBox();
  const pal = await page.locator('#palette').boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(pal!.y);
  await expect(page.locator('#alerts .alert', { hasText: 'THE FOUNDRY — FIRST LIGHT' })).toHaveClass(/nf-race/);
  await expect(page.locator('#race-card .rc-item', { hasText: 'FIRST LIGHT' })).toHaveCount(0);
  // the banner goes when dismissed (it would also go by itself after 20 real seconds)
  await banner.locator('[data-rb="x"]').click();
  await expect(banner).toBeHidden();
  // the chip: a volley has flown (`.lit`), a rival leads it (`.behind`)
  const chip = page.locator('#race-chip');
  await expect(chip).toHaveClass(/\blit\b/);
  await expect(chip).toHaveClass(/\bbehind\b/);
  await expect(chip).toHaveText('⚑ RACE 2nd · Foundry 2 volleys · you 1');
  // shares: 2 of 3 and 1 of 3, in the factions' colours, the marked bar is ours
  await expect(page.locator('#swarm-race .sr-row[data-faction="robots"] .sr-p')).toHaveText('67%');
  await expect(page.locator('#swarm-race .sr-row[data-faction="accelerationists"] .sr-p')).toHaveText('33%');
  await expect(page.locator('#swarm-race .sr-row[data-faction="solarpunks"] .sr-p')).toHaveText('0%');
  expect(await page.locator('#swarm-race .sr-row[data-faction="robots"] .sr-bar i').evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(TRIM.robots);
  expect(await page.locator('#swarm-race .sr-row[data-faction="accelerationists"] .sr-bar i').evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(TRIM.accelerationists);
  expect(await page.locator('#swarm-race .sr-row[data-faction="robots"] .sr-bar i').evaluate((e) => parseFloat(e.style.width))).toBeCloseTo(66.67, 1);

  // seven more volleys of ours (the Foundry's two had taken the lead from our one): our second volley draws level and leads on the
  // earlier first light, and combined 10 brings the beat; nothing else is a beat
  await volleys(page, 7);
  await tick(page);
  race = await g(page, 'getRace');
  expect(race.accelerationists.launches).toBe(8);
  const standing = await feedOf(page, 'standing');
  expect(standing.filter((e) => /THE FOUNDRY TAKES THE LEAD/.test(e.text))).toHaveLength(1);
  expect(standing.filter((e) => /THE VANGUARD DRAWS LEVEL WITH FOUNDRY AND LEADS ON THE EARLIER FIRST LIGHT/.test(e.text))).toHaveLength(1);
  expect(standing.filter((e) => /THE RACE AT 10 OF 70 VOLLEYS/.test(e.text))).toHaveLength(1);
  expect(standing.map((e) => [e.faction, e.n])).toEqual([['robots', 3], ['accelerationists', 4], ['accelerationists', 10]]);
  expect(standing[2].text).toContain('LEADS BY 6');
  // the beat is a race notification: the leader's glyph and colour, and where we stand
  const beat = page.locator('#alerts .alert', { hasText: 'THE RACE AT 10 OF 70 VOLLEYS' });
  await expect(beat).toHaveClass(/nf-race/);
  await expect(beat.locator('.alert-g')).toHaveText('▲');
  expect(await beat.evaluate((e) => getComputedStyle(e).borderLeftColor)).toBe(TRIM.accelerationists);
  await expect(page.locator('#alerts .alert', { hasText: 'DRAWS LEVEL' })).toHaveClass(/nf-race/);
  // every fifth volley of ours is on the feed as a rival's are (the fifth)
  expect((await feedOf(page, 'launch')).filter((e) => e.faction === 'accelerationists').map((e) => e.n)).toEqual([5]);
  await expect(chip).toHaveText('⚑ RACE 1st · you 8 volleys · Foundry 2');
  await expect(chip).not.toHaveClass(/\bbehind\b/);
  expect((await g(page, 'getRace')).phase).toBe('lit');
  // the closing line is in the panel
  await chip.click();
  await expect(page.locator('#race-panel .rc-close')).toContainText('10 of 70 combined volleys');
  await expect(page.locator('#race-panel .rc-row').first()).toHaveAttribute('data-faction', 'accelerationists');
});

// ───────────────────────────── the close and the verdict ─────────────────────────────

/** a Commons game (both rivals landed), close lowered to 40 volleys, the rivals staged, then `mine` real volleys of ours; the FIRST LIGHT
 *  screen (our first volley) is dismissed so the verdict behind it shows */
async function closeWith(page: Page, rivals: [number, number], mine: number) {
  await faction(page, 'solarpunks');
  await g(page, 'setCloseAt', 40);
  await rival(page, 'robots', rivals[0]);
  await tick(page, 2);
  await rival(page, 'accelerationists', rivals[1]);
  await tick(page);
  await volleys(page, mine);
  await tick(page);
  await expect(page.locator('#victory-screen')).toBeVisible();
  await expect(page.locator('#verdict-screen')).toBeHidden(); // it waits for the FIRST LIGHT screen
  await page.locator('#btn-victory-continue').click();
}
const rowsOf = (page: Page) => page.locator('#verdict-table .vt-row').evaluateAll((rs) => rs.map((r) => ({
  faction: (r as HTMLElement).dataset.faction, rank: (r as HTMLElement).dataset.rank, you: r.classList.contains('you'),
  volleys: r.querySelector('.vt-volleys')!.textContent, share: r.querySelector('.vt-share')!.textContent, fl: r.querySelector('.vt-fl')!.textContent!.trim(),
})));

test('the close: at closeAt combined volleys the largest share wins (ties to the earlier first light); THE SWARM IS YOURS, A SHARED SWARM, THE SWARM IS THEIRS; Continue; saved closed', async ({ page }) => {
  test.setTimeout(300_000);
  await bare(page);

  // Cooperative Swarm's foils on the launch row (volleyTerms, not the constant)
  await faction(page, 'solarpunks');
  await g(page, 'completeTech', 'cooperativeSwarm');
  await expect(page.locator('#launch-cost')).toContainText('foils 0/9 ✗');

  // ── yours: 26 of 40 against 8 and 6 ──
  await closeWith(page, [8, 6], 26);
  let race = await g(page, 'getRace');
  expect(race).toMatchObject({ phase: 'closed', winner: 'solarpunks', verdict: 'yours', closeAt: 40 });
  expect(race.final.solarpunks.launches).toBe(26);
  const verdict = page.locator('#verdict-screen');
  await expect(verdict).toBeVisible();
  await expect(verdict.locator('#verdict-title')).toHaveText('THE SWARM IS YOURS');
  await expect(verdict.locator('#verdict-title')).toHaveAttribute('data-verdict', 'yours');
  await expect(verdict.locator('#verdict-lead')).toContainText('40 COMBINED VOLLEYS');
  await expect(verdict.locator('#verdict-body')).toContainText('26 of 40 volleys (65 %)');
  const rows = await rowsOf(page);
  expect(rows.map((r) => [r.faction, r.volleys, r.share])).toEqual([['solarpunks', '26', '65 %'], ['robots', '8', '20 %'], ['accelerationists', '6', '15 %']]);
  expect(rows[0].you).toBe(true);
  expect(rows[0].fl).toMatch(/^day \d+$/);
  expect(await page.locator('#verdict-table .vt-row[data-faction="robots"]').evaluate((e) => getComputedStyle(e).borderLeftColor)).toBe(TRIM.robots);
  // one verdict on the feed, one race line for the record; the game is held under it
  expect(await feedOf(page, 'verdict')).toHaveLength(1);
  await expect(page.locator('#alerts .alert', { hasText: 'THE SWARM IS YOURS' })).toHaveClass(/nf-race/);
  await expect(page.locator('#race-chip')).toHaveText('⚑ RACE CLOSED · yours');
  // Continue: play goes on and the leaderboard stays live; the verdict is not shown twice
  await verdict.locator('#btn-verdict-continue').click();
  await expect(verdict).toBeHidden();
  await rival(page, 'robots', 30);
  await tick(page, 2);
  race = await g(page, 'getRace');
  expect(race.robots.launches).toBe(30);
  expect(race).toMatchObject({ phase: 'closed', winner: 'solarpunks', verdict: 'yours' }); // what closed stays closed
  await expect(page.locator('#swarm-race .sr-row[data-faction="robots"] .sr-n')).toHaveText('30');
  await expect(verdict).toBeHidden();
  expect(await feedOf(page, 'verdict')).toHaveLength(1);
  await page.locator('#race-chip').click();
  await expect(page.locator('#race-panel .rc-close')).toContainText('The race closed at 40 combined volleys — THE SWARM IS YOURS');
  await expect(page.locator('#race-panel .rc-row').first()).toHaveAttribute('data-faction', 'robots'); // live: the Foundry leads now

  // ── shared: 16 of 40 against 15 and 9, the game running: it holds the game under the verdict and Continue lets it go ──
  await faction(page, 'solarpunks');
  await g(page, 'setCloseAt', 40);
  await rival(page, 'robots', 15);
  await tick(page, 2);
  await rival(page, 'accelerationists', 9);
  await tick(page);
  await volleys(page, 16);
  await g(page, 'setPaused', false);
  await tick(page);
  await expect(page.locator('#victory-screen')).toBeVisible();
  await page.locator('#btn-victory-continue').click();
  await expect(verdict).toBeVisible();
  await expect(verdict.locator('#verdict-title')).toHaveText('A SHARED SWARM');
  expect((await g(page, 'getRace')).verdict).toBe('shared');
  await expect.poll(async () => (await g(page, 'getState')).paused).toBe(true);
  await expect(page.locator('#race-chip')).toHaveText('⚑ RACE CLOSED · shared');
  await verdict.locator('#btn-verdict-continue').click();
  await expect(verdict).toBeHidden();
  await expect.poll(async () => (await g(page, 'getState')).paused).toBe(false);

  // ── theirs, with a tie: the Foundry and the Vanguard at 15 each, the Foundry lit first, ours 10 ──
  await faction(page, 'solarpunks');
  await g(page, 'setCloseAt', 40);
  await rival(page, 'robots', 15);
  await tick(page, 2);
  await rival(page, 'accelerationists', 15);
  await tick(page);
  const fl = (await g(page, 'getRace')) as any;
  expect(fl.robots.firstLaunchAt).toBeLessThan(fl.accelerationists.firstLaunchAt);
  await volleys(page, 10);
  await tick(page);
  await page.locator('#btn-victory-continue').click();
  await expect(verdict).toBeVisible();
  await expect(verdict.locator('#verdict-title')).toHaveText('THE SWARM IS THEIRS');
  expect((await rowsOf(page)).map((r) => r.faction)).toEqual(['robots', 'accelerationists', 'solarpunks']);
  race = await g(page, 'getRace');
  expect(race).toMatchObject({ phase: 'closed', winner: 'robots', verdict: 'theirs' }); // equal shares: the earlier first light
  await expect(verdict.locator('#verdict-body')).toContainText('The Foundry holds 38 % of the volleys; you hold 25 %');
  await expect(page.locator('#race-chip')).toHaveText('⚑ RACE CLOSED · Foundry wins');
  await verdict.locator('#btn-verdict-continue').click();

  // the closed race saves and loads closed: no second verdict, the chip and the panel still say so
  const blob = await g(page, 'saveBlob');
  expect(blob.moon.race).toMatchObject({ phase: 'closed', winner: 'robots', verdict: 'theirs', closeAt: 40 });
  await page.evaluate((b) => window.__game.loadBlob(JSON.parse(JSON.stringify(b))), blob);
  await tick(page, 3);
  race = await g(page, 'getRace');
  expect(race).toMatchObject({ phase: 'closed', winner: 'robots', verdict: 'theirs', closeAt: 40 });
  expect(race.final.robots.launches).toBe(15);
  expect(await feedOf(page, 'verdict')).toHaveLength(1);
  await expect(verdict).toBeHidden();
  await expect(page.locator('#race-chip')).toHaveText('⚑ RACE CLOSED · Foundry wins');
  await page.locator('#race-chip').click();
  await expect(page.locator('#race-panel .rc-close')).toContainText('THE SWARM IS THEIRS');
});

// ───────────────────────────── the rules, on the Moon alone ─────────────────────────────

test('the rules: the order of the standings, ties to the earlier first light, the verdict margin, beats while lit, a solo Moon never closes', async ({ page }) => {
  await bare(page, '&site=mare&exp=robotic');
  const r = await page.evaluate(async () => {
    const M = await import('/src/core/moon.ts');
    const { RACE } = await import('/src/data/balance.ts');
    type Line = [number, number | null];
    const moon = (player: string | null, lines: Record<string, Line>, closeAt = 40) => {
      const m = M.createMoon(7, { player: player as any, closeAt });
      for (const [f, [launches, at]] of Object.entries(lines)) { (m.race as any)[f].launches = launches; (m.race as any)[f].firstLaunchAt = at; }
      return m;
    };
    const close = (m: any) => {
      M.raceStep(m);
      const once = JSON.stringify(m.feed);
      M.raceStep(m); // (a second look changes nothing)
      return { phase: m.race.phase, winner: m.race.winner, verdict: m.race.verdict, feed: (m.feed ?? []).map((e: any) => e.kind), same: JSON.stringify(m.feed) === once };
    };
    const L = (robots: Line, accelerationists: Line, solarpunks: Line) => ({ robots, accelerationists, solarpunks });
    const beats = (() => {
      const m = moon('robots', L([0, null], [0, null], [0, null]), 100);
      const out: string[] = [];
      M.raceStep(m); out.push(m.race.phase);
      m.race.robots.launches = 1; m.race.robots.firstLaunchAt = 5; M.raceStep(m); out.push(m.race.phase);
      m.race.accelerationists.launches = 9; m.race.accelerationists.firstLaunchAt = 9; M.raceStep(m); // combined 10: a beat, and the lead changed: one line
      m.race.accelerationists.launches = 10; M.raceStep(m); M.raceStep(m);                              // 11: nothing
      m.race.solarpunks.launches = 35; m.race.solarpunks.firstLaunchAt = 30; M.raceStep(m);             // 46: the lead changed again, and a beat
      const feed = m.feed.map((e: any) => `${e.kind}:${e.faction}:${e.n}`);
      m.race.solarpunks.launches = 80; M.raceStep(m);                                                   // 91: a beat, no change of lead
      const at91 = m.feed.length;
      m.race.solarpunks.launches = 89; M.raceStep(m);                                                   // 100: closes
      return { out, feed, at91, phase: m.race.phase, winner: m.race.winner, last: m.feed[m.feed.length - 1].kind, n: m.feed.length };
    })();
    const solo = (() => {
      const m = M.createMoon(7, { player: null });
      m.race.robots.launches = 500; m.race.robots.firstLaunchAt = 1;
      M.raceStep(m);
      return { phase: m.race.phase, winner: m.race.winner ?? null, feed: m.feed ?? [] };
    })();
    return {
      margin: RACE.sharedMargin,
      // equal launches: the earlier first light wins; an equal top share for the player is a SHARED swarm whichever way it falls
      tieRival: close(moon('accelerationists', L([15, 100], [15, 200], [10, 300]))),
      tieYou: close(moon('accelerationists', L([15, 200], [15, 100], [10, 300]))),
      tieBehind: close(moon('solarpunks', L([15, 100], [15, 200], [10, 300]))),
      tieBehindLater: close(moon('solarpunks', L([15, 200], [15, 100], [10, 300]))),
      tieSameSecond: close(moon('solarpunks', L([15, 100], [15, 100], [10, 300]))),
      // the margin: 5 points of the combined volleys (2 of 40) is a photo finish, 3 of 40 is a clear lead
      narrowWin: close(moon('robots', L([18, 100], [16, 200], [6, 300]))),
      clearWin: close(moon('robots', L([19, 100], [16, 200], [5, 300]))),
      narrowLoss: close(moon('robots', L([16, 100], [18, 200], [6, 300]))),
      farLoss: close(moon('solarpunks', L([20, 100], [18, 200], [2, 300]))),
      beats, solo,
    };
  });
  expect(r.margin).toBe(0.05);
  expect(r.tieRival).toMatchObject({ phase: 'closed', winner: 'robots', verdict: 'shared', feed: ['verdict'], same: true });
  expect(r.tieYou).toMatchObject({ winner: 'accelerationists', verdict: 'shared' });
  expect(r.tieBehind).toMatchObject({ winner: 'robots', verdict: 'theirs' });
  expect(r.tieBehindLater).toMatchObject({ winner: 'accelerationists', verdict: 'theirs' });
  expect(r.tieSameSecond.winner).toBe('robots'); // the same second: the landing order
  expect(r.narrowWin).toMatchObject({ winner: 'robots', verdict: 'shared' });
  expect(r.clearWin).toMatchObject({ winner: 'robots', verdict: 'yours' });
  expect(r.narrowLoss).toMatchObject({ winner: 'accelerationists', verdict: 'shared' });
  expect(r.farLoss).toMatchObject({ winner: 'robots', verdict: 'theirs' });
  // pre until the first volley, lit after it; one line for each beat or change of lead, none for a second look; the close ends them
  expect(r.beats.out).toEqual(['pre', 'lit']);
  expect(r.beats.feed).toEqual(['standing:accelerationists:10', 'standing:solarpunks:46']);
  expect(r.beats.at91).toBe(3);
  expect(r.beats).toMatchObject({ phase: 'closed', winner: 'solarpunks', last: 'verdict', n: 4 });
  expect(r.solo).toEqual({ phase: 'solo', winner: null, feed: [] });
});
