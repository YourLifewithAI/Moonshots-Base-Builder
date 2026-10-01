/** The rivals' minds (docs/20 §4.5, stream S4): the other two programs of a faction game are real bases played by the Builder
 *  and a policy per faction (core/rival.ts, data/factions.ts). They research along a priority list, found what the Builder's rules
 *  extend, survey and claim prospects, keep their crew alive, write what they do to the Moon's feed and stay deterministic across a
 *  save and a load. The solo game has none of it.
 *
 *  Seed 42. The player's base is kept alive with `grantResources` (a passive crewed base runs out of air a thousand seconds after it
 *  lands and its defeat stops the clock); every reading of a rival is through the debug API. */
import { test, expect as baseExpect, type Page } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 20_000 });

declare global {
  interface Window { __game?: any }
}

type Faction = 'robots' | 'accelerationists' | 'solarpunks';
type Site = 'mare' | 'southpole' | 'lavatube';

const CYCLE = 720;
const DAY = (n: number) => n * CYCLE;

async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?debug&seed=42');
  await page.waitForFunction(() => window.__game !== undefined);
  return errors;
}

/** Start a faction game and pause it (the debug clock is the test's). */
const start = (page: Page, faction: Faction, site: Site) => page.evaluate(([f, s]) => {
  const g = window.__game;
  g.selectFaction(f, s);
  g.setPaused(true);
  g.advanceGameSeconds(0);
  return { clock: g.getMoon().clock, pre: g.getPreRollMs() };
}, [faction, site] as const);

/** Advance the Moon to `clock`, topping up the player's life support as it goes (300 s at a time). */
const advanceTo = (page: Page, clock: number) => page.evaluate((until) => {
  const g = window.__game;
  while (g.getMoon().clock < until) {
    g.grantResources({ oxygen: 600, food: 600, water: 400, parts: 50 });
    g.advanceGameSeconds(Math.min(300, until - g.getMoon().clock));
  }
  return g.getMoon().clock;
}, clock);

test('landing order and head start: the Commons land on a Moon the other two have been carving up for four days', async ({ page }) => {
  test.setTimeout(240_000);
  await boot(page);
  const r = await start(page, 'solarpunks', 'lavatube');
  const rivals = await page.evaluate(() => {
    const g = window.__game;
    return {
      list: g.getRivals().map((x: any) => ({ f: x.faction, site: x.siteId, landed: x.landed, buildings: x.buildings, techs: x.techs, era: x.era, simTime: x.simTime, lost: x.lost })),
      player: g.getState().simTime,
      feed: g.getMoon().feed.map((e: any) => e.kind),
      rulesOn: Object.values(g.getRivalState('robots').auto.rules).filter((x: any) => x.on).length,
      foundry: (() => { const s = g.getRivalState('robots'); return { types: [...new Set(s.buildings.map((b: any) => b.type))], labs: s.buildings.filter((b: any) => b.type === 'lab').length, queue: s.researchQueue }; })(),
    };
  });
  expect(r.clock, 'the Moon stands at the Commons landing second (day 4, mid-morning)').toBe(DAY(4) + 90);
  expect(rivals.list.map((x: any) => x.f)).toEqual(['robots', 'accelerationists']);
  for (const x of rivals.list) {
    expect(x.landed, `${x.f} landed`).toBe(true);
    expect(x.simTime, `${x.f} is as old as the player's clock`).toBe(rivals.player);
    // a base larger than a Lander: it built, researched and was thinking for days
    expect(x.buildings, `${x.f} has built`).toBeGreaterThan(4);
    expect(x.techs, `${x.f} has researched`).toBeGreaterThan(0);
  }
  // the Foundry had four days, the Vanguard two: the earlier landing is the bigger base
  const [foundry, vanguard] = rivals.list;
  expect(foundry.buildings).toBeGreaterThan(vanguard.buildings);
  expect(foundry.era, 'the Foundry is past Era 1').toBeGreaterThanOrEqual(2);
  for (const t of ['lab', 'smelter', 'solar']) expect(rivals.foundry.types, `the Foundry built a ${t}`).toContain(t);
  expect(rivals.foundry.labs, 'more than one lab').toBeGreaterThan(1);
  expect(rivals.foundry.queue.length, 'its research queue is full').toBeGreaterThan(0);
  // every Builder rule is on from the landing, at the faction's caps
  expect(rivals.rulesOn).toBeGreaterThan(15);
  expect(rivals.feed.filter((k: string) => k === 'landed')).toHaveLength(2);
  // the pre-roll of the slowest start is measured (it runs behind the descent screen in chunks; this direct path runs it whole)
  expect(r.pre, 'pre-roll time recorded').toBeGreaterThan(0);
  expect(r.pre, `pre-roll ${Math.round(r.pre)} ms`).toBeLessThan(15_000);
});

test('the day targets on seed 42: Era 2 by day 6, an outpost by day 8, every crew alive on day 12, the feed says so, at under 2 ms a second', async ({ page }) => {
  test.setTimeout(420_000);
  const errors = await boot(page);
  await start(page, 'accelerationists', 'southpole'); // the Foundry at Ilmenite Plains, the Commons at Marius Hills
  // the rivals' cost after 3000 s of game time (two rivals, real bases)
  await advanceTo(page, DAY(2) + 90 + 3000);
  const perf = await page.evaluate(() => window.__game.getRenderInfo().rivals);
  expect(perf.n, 'two rivals').toBe(2);
  expect(perf.ticks, 'ticked').toBeGreaterThanOrEqual(2900);
  expect(perf.msMean, `rivals cost ${perf.msMean.toFixed(2)} ms a second over ${perf.ticks} ticks`).toBeLessThan(2);
  expect(perf.msPerTick, 'the moving average reads the same at 3000 s').toBeLessThan(2);
  await advanceTo(page, DAY(12));
  const r = await page.evaluate(() => {
    const g = window.__game;
    const moon = g.getMoon();
    const st = (f: string) => { const s = g.getRivalState(f); return s ? { crew: s.crew, expedition: s.expedition, defeat: s.defeatShown, era: s.era, outposts: s.survey.outposts.map((o: any) => o.id), faction: s.faction, techs: s.techsDone, types: [...new Set(s.buildings.map((b: any) => b.type))] } : null; };
    return {
      feed: moon.feed.map((e: any) => ({ at: e.at, faction: e.faction, kind: e.kind, era: e.era, prospect: e.prospect, text: e.text })),
      claims: moon.claims, rivals: g.getRivals().map((x: any) => ({ f: x.faction, lost: x.lost, era: x.era, outposts: x.outposts })),
      robots: st('robots'), solarpunks: st('solarpunks'), race: moon.race,
    };
  });
  expect(errors, 'no page errors').toEqual([]);
  // Era 2 by day 6: the first era event of each rival
  const era2 = (f: string) => r.feed.find((e: any) => e.faction === f && e.kind === 'era' && e.era === 2)?.at;
  expect(era2('robots'), 'the Foundry enters Era 2').toBeLessThanOrEqual(DAY(6));
  // the Commons land on day 4 with their hands full of life support: a day of margin over the Foundry's target
  expect(era2('solarpunks'), 'the Commons enter Era 2 by day 7 of the Moon').toBeLessThanOrEqual(DAY(7));
  // an outpost by day 8: a claim event, held on the Moon, in the rival's own state
  const claim = r.feed.find((e: any) => e.faction === 'robots' && e.kind === 'claim');
  expect(claim, 'the Foundry claimed a prospect').toBeTruthy();
  expect(claim.at, 'by day 8').toBeLessThanOrEqual(DAY(8));
  expect(claim.text).toMatch(/THE FOUNDRY CLAIMS /);
  expect(r.claims[claim.prospect], 'the Moon holds the claim for the Foundry').toBe('robots');
  expect(r.robots!.outposts).toContain(claim.prospect);
  // nobody's crew died: the Commons (crewed) live, and neither is lost
  expect(r.solarpunks!.expedition).toBe('human');
  expect(r.solarpunks!.crew, 'the Commons crew is alive on day 12').toBeGreaterThan(0);
  expect(r.rivals.every((x: any) => !x.lost), 'no rival is lost').toBe(true);
  expect(r.feed.some((e: any) => e.kind === 'lost'), 'no `lost` event').toBe(false);
  // the feed carries the story: landings, eras, claims
  const kinds = new Set(r.feed.map((e: any) => e.kind));
  for (const k of ['landed', 'era', 'claim']) expect(kinds.has(k), `feed has ${k}`).toBe(true);
  expect(r.feed.map((e: any) => e.at), 'the feed is in clock order').toEqual([...r.feed.map((e: any) => e.at)].sort((a, b) => a - b));
  // the race board reads the rivals' eras
  expect(r.race.robots.era).toBe(r.robots!.era);
  // the faction branches (S3) are in the policies: the Commons took their Charter (and built the Hall), and never the Consensus Council that
  // would ask a second crew member at every lab; the Foundry has researched some of its own
  expect(r.solarpunks!.techs, 'the Commons research their Charter').toContain('commonsCharter');
  expect(r.solarpunks!.techs).not.toContain('consensusCouncil');
  expect(r.robots!.techs.some((t: string) => ['nightVaultDocks', 'faradaySheds', 'hardenedFirmware', 'isotopeWarmers'].includes(t)), 'the Foundry took some of its branch').toBe(true);
});

test('the descent screen path plays the same pre-roll over frames without freezing the page', async ({ page }) => {
  test.setTimeout(240_000);
  await boot(page);
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const fnv = (str: string) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
    const digest = () => g.getRivals().map((x: any) => [x.faction, x.buildings, x.techs, x.terrainHash, fnv(JSON.stringify(g.getRivalState(x.faction)))]);
    g.selectFaction('solarpunks', 'lavatube');
    g.setPaused(true);
    const whole = { rivals: digest(), clock: g.getMoon().clock, pre: g.getPreRollMs() };
    const gaps: number[] = [];
    let last = performance.now();
    let run = true;
    const frame = () => { const n = performance.now(); gaps.push(n - last); last = n; if (run) requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    await g.selectFactionChunked('solarpunks', 'lavatube');
    run = false;
    g.setPaused(true);
    return { whole, chunked: { rivals: digest(), clock: g.getMoon().clock, pre: g.getPreRollMs() }, maxGap: Math.max(...gaps), frames: gaps.length };
  });
  expect(r.chunked.rivals, 'the same rivals whichever way the days are played').toEqual(r.whole.rivals);
  expect(r.chunked.clock).toBe(r.whole.clock);
  // spread over frames: the page paints meanwhile (a whole pre-roll is 3-4 s in one task; a chunk is ~40 ms of work)
  expect(r.frames, 'frames painted during the descent').toBeGreaterThan(8);
  expect(r.maxGap, `longest frame ${Math.round(r.maxGap)} ms (a whole pre-roll blocks ${Math.round(r.whole.pre)} ms)`).toBeLessThan(Math.max(1500, r.whole.pre * 0.7));
});

test('a crewed rival that ends its crew is lost: `lost` in the feed, its ticks end; a robotic one cannot fall', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);
  await start(page, 'robots', 'mare');
  const r = await page.evaluate(() => {
    const g = window.__game;
    // the Vanguard (crewed) lands day 2: run to its landing, then take its air and food away and let it starve
    g.advanceGameSeconds(1440);
    const before = g.getRivalState('accelerationists');
    g.rivalGrant('accelerationists', { oxygen: -10_000, food: -10_000, water: -10_000 });
    g.advanceGameSeconds(1200);
    const after = g.getRivalState('accelerationists');
    const events = g.getMoon().feed.filter((e: any) => e.kind === 'lost');
    const still = g.getRivals();
    return { crewBefore: before.crew, crewAfter: after.crew, defeat: after.defeatShown, events: events.map((e: any) => e.faction), lost: still.map((x: any) => [x.faction, x.lost]) };
  });
  expect(r.crewBefore).toBeGreaterThan(0);
  expect(r.crewAfter).toBe(0);
  expect(r.defeat).toBe(true);
  expect(r.events).toEqual(['accelerationists']);
  expect(Object.fromEntries(r.lost)).toEqual({ accelerationists: true, solarpunks: false });
});

test('determinism: two loads of one save advanced 3000 s give identical rival states (terrain, techs, queue, launches, resources, pits, claims)', async ({ page }) => {
  test.setTimeout(420_000);
  await boot(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const fnv = (str: string) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
    const dig = (v: unknown) => fnv(JSON.stringify(v));
    g.selectFaction('robots', 'mare');
    g.setPaused(true);
    g.advanceGameSeconds(0);
    g.grantResources({ oxygen: 6000, food: 6000, water: 6000 });
    // the Vanguard lands at 1440; give both rivals a run to think in first
    g.advanceGameSeconds(2400);
    const view = () => g.getRivals().map((x: any) => ({
      f: x.faction, hash: x.terrainHash, techs: x.techsDone, era: x.era, launches: x.launches, res: dig(x.resources), pits: x.pits, outposts: x.outposts,
      full: dig(g.getRivalState(x.faction)), queue: g.getRivalState(x.faction)?.researchQueue, n: x.buildings,
    }));
    const blob = g.saveBlob();
    const size = JSON.stringify(blob).length;
    const run = () => {
      g.loadBlob(JSON.parse(JSON.stringify(blob)));
      g.setPaused(true);
      g.advanceGameSeconds(0);
      g.grantResources({ oxygen: 6000, food: 6000, water: 6000 });
      g.advanceGameSeconds(3000);
      return { rivals: view(), claims: dig(g.getMoon().claims), feed: g.getMoon().feed.map((e: any) => `${e.at}|${e.faction}|${e.kind}|${e.text}`), race: dig(g.getMoon().race) };
    };
    const a = run();
    const b = run();
    return { a, b, size, keys: Object.keys(blob.rivals[0].state).length, n: a.rivals.map((x: any) => x.n) };
  });
  expect(r.b.rivals, 'rival states after two loads advanced 3000 s').toEqual(r.a.rivals);
  expect(r.b.claims).toBe(r.a.claims);
  expect(r.b.feed, 'the feed').toEqual(r.a.feed);
  expect(r.b.race).toBe(r.a.race);
  // the rivals did something in those 3000 s, or the comparison says nothing
  expect(r.a.rivals.every((x: any) => x.techs.length > 1 && x.n > 4), 'rivals grew').toBe(true);
  expect(r.size, `save ${r.size} bytes`).toBeLessThan(2_000_000);
});

test('the policy data: every listed tech exists, each faction has its lists, a doctrine per group, a destiny side, claim kinds and orders', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    const F = await import('/src/data/factions.ts');
    const T = await import('/src/data/techs.ts');
    const B = await import('/src/data/buildings.ts');
    const out: Record<string, any> = {};
    for (const f of F.FACTION_ORDER) {
      const p = F.FACTIONS[f].policy;
      out[f] = {
        unknown: p.research.filter((t: string) => !T.TECHS[t]),
        n: p.research.length,
        groups: Object.keys(p.doctrines).sort(),
        badDoctrine: Object.entries(p.doctrines).filter(([g, t]: any) => !T.DOCTRINES[g].members.includes(t)),
        destiny: p.destiny, claimKinds: p.claimKinds, orders: p.orders.length,
        firstOrders: p.orders.slice(0, 3).map((o: any) => o.type),
        badOrders: p.orders.filter((o: any) => !B.BUILDINGS[o.type]).map((o: any) => o.type),
        badSkip: (p.skip ?? []).filter((t: string) => !T.TECHS[t]),
        late: p.lateCaps, launchDay: Object.values(p.launchDay),
        unique: F.FACTIONS[f].uniqueTechs.filter((t: string) => !p.research.includes(t) && !(p.skip ?? []).includes(t)),
      };
    }
    // S8: a program's launch window (`launchDay − LAUNCH_LEAD_DAYS`, Moon days) is closed a second before it and open at it; a state with no faction is never held
    const CYC = 720;
    const win = (f: string, site: string) => (F.FACTIONS[f].policy.launchDay[site] - F.LAUNCH_LEAD_DAYS) * CYC;
    const gate = Object.fromEntries(F.FACTION_ORDER.map((f: string) => [f, [
      F.launchOpen({ faction: f, siteId: 'mare', simTime: win(f, 'mare') - 1 }), F.launchOpen({ faction: f, siteId: 'mare', simTime: win(f, 'mare') }),
    ]]));
    return { out, groups: Object.keys(T.DOCTRINES).sort(), gate, solo: F.launchOpen({ siteId: 'mare', simTime: 0 }) };
  });
  for (const f of Object.keys(r.gate)) expect(r.gate[f], `${f}: the launch window is shut a second before its day and open on it`).toEqual([false, true]);
  expect(r.solo, 'a solo state is never held').toBe(true);
  for (const f of Object.keys(r.out)) {
    const o = r.out[f];
    expect(o.unknown, `${f}: unknown tech ids in its research list`).toEqual([]);
    expect(o.n, `${f}: a research list`).toBeGreaterThan(20);
    expect(o.groups, `${f}: a pick for every doctrine group`).toEqual(r.groups);
    expect(o.badDoctrine, `${f}: doctrine picks are members of their groups`).toEqual([]);
    expect(o.claimKinds.length, `${f}: claim kinds`).toBeGreaterThan(0);
    expect(o.orders, `${f}: orders`).toBeGreaterThan(5);
    expect(o.badOrders, `${f}: orders name real buildings`).toEqual([]);
    expect(o.badSkip, `${f}: skipped techs exist`).toEqual([]);
    expect(o.late, `${f}: late caps`).toEqual({ solar: 100, battery: 30, reactor: 4 });
    for (const d of o.launchDay) { expect(d, `${f}: a planned first light`).toBeGreaterThan(14); expect(d, `${f}: a planned first light`).toBeLessThan(30); }
  }
  // the Foundry's and the Vanguard's own techs are all in their lists (placed where they help) or deliberately skipped; the Commons leave
  // two cheap late ones (Guardianship, Long Night Gardens) to the tail, where the runner takes what is left (Slow Build is skipped: a program
  // racing the Sun does not slow its building)
  expect(r.out.robots.unique).toEqual([]);
  expect(r.out.accelerationists.unique).toEqual([]);
  expect(r.out.solarpunks.unique.sort()).toEqual(['guardianship', 'longNightGardens']);
  expect(r.out.robots.claimKinds[0]).toBe('ilmenite');
  expect(r.out.accelerationists.claimKinds[0]).toBe('ice');
  expect(r.out.solarpunks.claimKinds[0]).toBe('ice');
  expect(r.out.robots.destiny).toBe('automation');
  expect(r.out.solarpunks.destiny).toBe('colony');
  expect(r.out.accelerationists.destiny[2]).toBe('colony');
  expect(r.out.accelerationists.destiny[8]).toBe('automation');
});

test('Guardianship reads the rivals\' disasters: another program\'s loss or hearing brings the Commons +120≡, their own does not; a rival without a mind is the passive base', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.setRivalMind(false);
    g.selectFaction('solarpunks', 'lavatube');
    g.setPaused(true);
    g.advanceGameSeconds(0);
    g.grantResources({ oxygen: 600, food: 600, water: 400 });
    const passive = g.getRivals().map((x: any) => ({ f: x.faction, techs: x.techs, rules: Object.values(g.getRivalState(x.faction).auto.rules).filter((y: any) => y.on).length }));
    g.completeTech('guardianship');
    const data = () => g.getState().data;
    const feed = (faction: string, kind: string) => { g.feedPush({ faction, kind, text: `${faction} ${kind}` }); g.advanceGameSeconds(1); };
    const d0 = data();
    feed('solarpunks', 'lost'); // the Commons' own: no aid
    const d1 = data();
    feed('robots', 'lost');
    const d2 = data();
    feed('accelerationists', 'hearing');
    const d3 = data();
    feed('robots', 'claim'); // not a disaster
    const d4 = data();
    return { passive, d0, d1, d2, d3, d4, mods: g.getMods().rivalAidData };
  });
  expect(r.mods).toBe(120);
  for (const x of r.passive) expect(x.rules, `${x.f}: no rule is on in a passive base`).toBe(0);
  expect(r.d1 - r.d0, 'their own loss brings nothing').toBeLessThan(60);
  expect(r.d2 - r.d1, 'the Foundry is lost: +120').toBeGreaterThan(100);
  expect(r.d3 - r.d2, 'the Vanguard is called to a hearing: +120').toBeGreaterThan(100);
  expect(r.d4 - r.d3, 'a claim is not a disaster').toBeLessThan(60);
});

test('solo unchanged: a solo game has no rivals, no claims on the Moon, and the Builder keeps its founded rule', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.selectSite('mare', 'robotic');
    g.setPaused(true);
    g.advanceGameSeconds(120);
    const mods = g.getMods();
    const s = g.getState();
    return {
      rivals: g.getRivals(), moon: { player: g.getMoon().player, claims: g.getMoon().claims, feed: g.getMoon().feed ?? [] }, info: g.getRenderInfo().rivals,
      relaxed: { founds: mods.builderFounds, all: mods.builderAll, launch: mods.autoLaunch, families: mods.autoFamilies.length },
      rulesOn: Object.values(s.auto.rules).filter((x: any) => x.on).length,
    };
  });
  expect(r.rivals).toEqual([]);
  expect(r.moon.player).toBeNull();
  expect(r.moon.claims).toEqual({});
  expect(r.moon.feed).toEqual([]);
  expect(r.info.n).toBe(0);
  expect(r.relaxed.founds, 'the solo Builder still waits for you to found').toBe(false);
  expect(r.relaxed.all).toBe(false);
  expect(r.relaxed.launch).toBe(false);
  expect(r.relaxed.families, 'no Builder family before its tech').toBe(0);
  expect(r.rulesOn, 'no rule switched on for a solo player').toBe(0);
});
