/** Factions on one Moon, the INTEGRATION (docs/20, stream W0i): a faction game has the Moon, two rival bases and a real
 *  landing schedule; a solo game (`?site=…&exp=…`, `selectSite`) has none of it. Covers `selectFaction`, the site
 *  assignment, the pre-roll, landings during play, the one flare schedule, save v2 and v1, the determinism of a
 *  reload and the rivals' cost. The rivals are PASSIVE here (their Lander, plus what a test gives them): the policy
 *  is stream S4's. A passive crewed rival runs out of air about a thousand seconds after it lands; the tests keep
 *  their own crew alive with `grantResources` and never read a rival's crew. */
import { test, expect as baseExpect, type Page } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 20_000 });

declare global {
  interface Window { __game?: any }
}

type Faction = 'robots' | 'accelerationists' | 'solarpunks';
type Site = 'mare' | 'southpole' | 'lavatube';

/** A fresh page on the debug API with no game started (every test starts its own). */
async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?debug&seed=42');
  await page.waitForFunction(() => window.__game !== undefined);
  return errors;
}

/** Start a game (a faction's, or a solo one) and pause it on the spot, as the other specs do. */
const start = (page: Page, faction: Faction | null, site: Site) => page.evaluate(([f, s]) => {
  const g = window.__game;
  if (f) g.selectFaction(f, s); else g.selectSite(s, 'robotic');
  g.setPaused(true);
  g.advanceGameSeconds(0);
}, [faction, site] as const);

/** What `assignSites(player, site)` must give (docs/20 §1), written out by hand from the preference table: robots
 *  mare · lavatube · southpole; accelerationists southpole · mare · lavatube; solarpunks lavatube · southpole · mare;
 *  landing order robots, accelerationists, solarpunks; the player's site counts as taken. */
const EXPECT: Record<Faction, Record<Site, Record<Faction, Site>>> = {
  robots: {
    mare: { robots: 'mare', accelerationists: 'southpole', solarpunks: 'lavatube' },
    lavatube: { robots: 'lavatube', accelerationists: 'southpole', solarpunks: 'mare' },
    southpole: { robots: 'southpole', accelerationists: 'mare', solarpunks: 'lavatube' },
  },
  accelerationists: {
    mare: { robots: 'lavatube', accelerationists: 'mare', solarpunks: 'southpole' },
    lavatube: { robots: 'mare', accelerationists: 'lavatube', solarpunks: 'southpole' },
    southpole: { robots: 'mare', accelerationists: 'southpole', solarpunks: 'lavatube' },
  },
  solarpunks: {
    mare: { robots: 'lavatube', accelerationists: 'southpole', solarpunks: 'mare' },
    lavatube: { robots: 'mare', accelerationists: 'southpole', solarpunks: 'lavatube' },
    southpole: { robots: 'mare', accelerationists: 'lavatube', solarpunks: 'southpole' },
  },
};
const FACTIONS: Faction[] = ['robots', 'accelerationists', 'solarpunks'];
const SITES: Site[] = ['mare', 'southpole', 'lavatube'];
const LAND = { robots: 0, accelerationists: 1440, solarpunks: 2880 } as const; // landsAtDay × CYCLE_S (720)

test('assignSites: every faction at every site gives three distinct sites by the preference rule', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = await import('/src/data/factions.ts');
    const out: Record<string, Record<string, Record<string, string>>> = {};
    for (const f of F.FACTION_ORDER) for (const s of ['mare', 'southpole', 'lavatube']) (out[f] ??= {})[s] = F.assignSites(f, s as any);
    return out;
  });
  for (const f of FACTIONS) {
    for (const s of SITES) {
      expect(got[f][s], `${f} at ${s}`).toEqual(EXPECT[f][s]);
      expect(new Set(Object.values(got[f][s])).size, `${f} at ${s}: three distinct sites`).toBe(3);
      expect(got[f][s][f], 'the player keeps the site they chose').toBe(s);
    }
  }
});

test('each faction boots through selectFaction with its landing, its traits, three distinct sites and the solo terrain', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page);
  for (const f of FACTIONS) {
    for (const site of [f === 'robots' ? 'mare' : f === 'accelerationists' ? 'southpole' : 'lavatube', 'mare'] as Site[]) {
      const r = await page.evaluate(([f, site]) => {
        const g = window.__game;
        g.selectSite(site, 'robotic'); // the solo game on this site and seed: the terrain to match
        const solo = { hash: g.terrainHash(), seed: g.getState().seed, rivals: g.getRivals().length };
        g.selectFaction(f, site);
        g.setPaused(true);
        g.advanceGameSeconds(0);
        const s = g.getState();
        return {
          solo, hash: g.terrainHash(), faction: s.faction, exp: s.expedition, seed: s.seed, site: s.siteId, techs: s.techsDone, data: s.data,
          simTime: s.simTime, landedAt: s.landedAt, mods: g.getMods(), moon: g.getMoon(), rivals: g.getRivals(), crew: s.crew, race: g.getRace(),
          rivalSeeds: g.getRivals().map((x: any) => g.getRivalState(x.faction)?.seed ?? null),
        };
      }, [f, site] as const);
      const tag = `${f} at ${site}`;
      const landing = { robots: 'landingFoundry', accelerationists: 'landingVanguard', solarpunks: 'landingCommons' }[f];
      expect(r.faction, tag).toBe(f);
      expect(r.exp, tag).toBe(f === 'robots' ? 'robotic' : 'human');
      expect(r.techs, `${tag}: the faction's landing stands in for the solo one`).toEqual([landing]);
      expect(r.data, `${tag}: only the Vanguard's landing pays +100 data`).toBe(f === 'accelerationists' ? 100 : 0);
      expect(r.landedAt, tag).toBe(LAND[f] || undefined);
      expect(r.simTime, `${tag}: lands mid-morning of its day`).toBe(LAND[f] + 90);
      expect(r.crew, tag).toBe(f === 'robots' ? 0 : 7);
      // the traits flow through the mods (W0d): one number per faction
      if (f === 'robots') expect(r.mods.buildSpeedMult).toBeCloseTo(0.9, 6);
      if (f === 'accelerationists') expect(r.mods.moraleBase).toBe(-8);
      if (f === 'solarpunks') expect(r.mods.hazardRateMult).toBeCloseTo(0.6, 6);
      // the same seed gives the same ground as the solo game on that site
      expect(r.seed, tag).toBe(42);
      expect(r.hash, `${tag}: the solo terrain`).toBe(r.solo.hash);
      expect(r.solo.rivals, 'selectSite stays solo').toBe(0);
      // the Moon: the player's faction, the schedule, three distinct sites following the preference rule
      expect(r.moon.player, tag).toBe(f);
      expect(r.moon.seed).toBe(42);
      expect(r.moon.race.phase).toBe('pre');
      const sites = Object.fromEntries(FACTIONS.map((x) => [x, r.moon.factions[x].siteId]));
      expect(sites, tag).toEqual(EXPECT[f][site]);
      expect(new Set(Object.values(sites)).size, tag).toBe(3);
      for (const x of FACTIONS) expect(r.moon.factions[x].landedAt, tag).toBe(LAND[x]);
      expect(r.moon.factions[f].landed).toBe(true);
      // the two rivals, in landing order; the ones that land earlier are on the Moon already, at the player's second
      expect(r.rivals.map((x: any) => x.faction), tag).toEqual(FACTIONS.filter((x) => x !== f));
      for (const x of r.rivals) {
        expect(x.siteId, `${tag}: ${x.faction}`).toBe(EXPECT[f][site][x.faction as Faction]);
        expect(x.landed, `${tag}: ${x.faction} landed`).toBe(LAND[x.faction as Faction] < LAND[f]);
        if (x.landed) {
          expect(x.simTime, `${tag}: ${x.faction} stepped to the player's second`).toBe(r.simTime);
          expect(x.terrainHash, `${tag}: ${x.faction} has its ground`).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
        } else {
          expect(x.simTime).toBeNull();
        }
      }
      // a rival's base draws from the Moon's seed mixed with its faction; the player's keeps the game's own
      r.rivals.forEach((x: any, i: number) => { if (x.landed) expect(r.rivalSeeds[i], `${tag}: ${x.faction} seed`).not.toBe(42); });
    }
  }
  expect(errors).toEqual([]);
});

test('the solarpunks land on day 4 to a Moon with two bases already there (pre-roll), sharing the flares they saw', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await boot(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const t0 = performance.now();
    g.selectFaction('solarpunks', 'lavatube');
    const wall = performance.now() - t0;
    g.setPaused(true);
    g.advanceGameSeconds(0);
    const s = g.getState();
    return {
      wall, pre: g.getPreRollMs(), simTime: s.simTime, clock: g.getMoon().clock, rivals: g.getRivals(), player: s.flare,
      states: ['robots', 'accelerationists'].map((f) => { const x = g.getRivalState(f); return { f, simTime: x.simTime, landedAt: x.landedAt ?? 0, faction: x.faction, n: x.flare.n, log: x.flare.log.length, cls: x.flare.log[0]?.cls, techs: x.techsDone, expedition: x.expedition, site: x.siteId }; }),
      alerts: s.alerts.map((a: any) => a.text).filter((t: string) => /LANDS/.test(t)), weather: g.getRenderInfo().moon,
    };
  });
  expect(r.simTime).toBe(2970);
  expect(r.clock, 'the Moon is at the player\'s second').toBe(2970);
  expect(r.rivals.map((x: any) => [x.faction, x.landed, x.simTime, x.siteId])).toEqual([
    ['robots', true, 2970, 'mare'], ['accelerationists', true, 2970, 'southpole'],
  ]);
  expect(r.states.map((x: any) => [x.f, x.faction, x.landedAt, x.techs, x.expedition, x.site])).toEqual([
    ['robots', 'robots', 0, ['landingFoundry'], 'robotic', 'mare'],
    ['accelerationists', 'accelerationists', 1440, ['landingVanguard'], 'human', 'southpole'],
  ]);
  // the first flare (day 2.4, second 1728) is behind everyone: both rivals lived it (the Vanguard landed at 1530), the player did not;
  // the player's base already shows the shared schedule (its next flare), from the first frame
  for (const x of r.states) { expect(x.n, `${x.f} flare n`).toBe(1); expect(x.log, `${x.f} flare log`).toBe(1); expect(x.cls).toBe('C'); }
  expect(r.player.n, 'the shared schedule has moved on').toBe(1);
  expect(r.player.log ?? []).toEqual([]);
  expect(r.weather.weather).toMatchObject({ phase: 'idle', n: 1, cls: 'C' });
  expect(r.alerts, 'the landed-before rivals are not announced').toEqual([]);
  // the pre-roll of the slowest start (two rivals, 2880 and 1440 ticks) runs behind the descent in a few seconds at most
  expect(r.pre, 'pre-roll ms').toBeLessThan(3000);
  expect(r.wall).toBeLessThan(6000);
  console.log(`[W0i] solarpunks start: new game ${Math.round(r.wall)} ms, pre-roll ${Math.round(r.pre)} ms (4320 rival ticks)`);
  expect(errors).toEqual([]);
});

test('a solo game has no rivals and a Moon of its own; a rival that lands later appears when the clock gets there', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await boot(page);
  const solo = await page.evaluate(() => {
    const g = window.__game;
    g.selectSite('mare', 'robotic');
    g.setPaused(true);
    g.advanceGameSeconds(0);
    g.advanceGameSeconds(100);
    return { rivals: g.getRivals(), moon: g.getMoon(), state: g.getRivalState('robots'), info: g.getRenderInfo().rivals, seed: g.getState().seed, faction: g.getState().faction };
  });
  expect(solo.rivals).toEqual([]);
  expect(solo.state).toBeNull();
  expect(solo.moon).toMatchObject({ player: null, seed: 42, clock: 190 });
  expect(solo.moon.race.phase).toBe('solo');
  expect(solo.faction).toBeUndefined();
  expect(solo.info).toMatchObject({ n: 0, ticks: 0, behind: 0 });

  // the Foundry's game: the Vanguard lands on day 2 (second 1530), the Commons on day 4 (2970)
  const at = async (dt: number) => page.evaluate((dt) => {
    const g = window.__game;
    g.advanceGameSeconds(dt);
    const s = g.getState();
    return { t: s.simTime, clock: g.getMoon().clock, rivals: g.getRivals().map((r: any) => [r.faction, r.landed, r.simTime]), alerts: s.alerts.map((a: any) => a.text).filter((x: string) => /LANDS/.test(x)) };
  }, dt);
  await start(page, 'robots', 'mare');
  let r = await at(1439);
  expect(r.t).toBe(1529);
  expect(r.rivals).toEqual([['accelerationists', false, null], ['solarpunks', false, null]]);
  r = await at(1);
  expect(r.t).toBe(1530);
  expect(r.rivals[0]).toEqual(['accelerationists', true, 1530]);
  expect(r.rivals[1][1]).toBe(false);
  expect(r.alerts).toEqual(['THE VANGUARD LANDS — at SHACKLETON RIM']);
  r = await at(700);
  expect(r.rivals[0]).toEqual(['accelerationists', true, 2230]);
  r = await at(740);
  expect(r.t).toBe(2970);
  expect(r.clock).toBe(2970);
  expect(r.rivals).toEqual([['accelerationists', true, 2970], ['solarpunks', true, 2970]]);
  expect(r.alerts).toHaveLength(2);

  // paused: nothing ticks; frozen rivals stay where they are (and stay behind when they come back)
  const p = await page.evaluate(() => {
    const g = window.__game;
    const t = () => g.getRivals().map((r: any) => r.simTime);
    const a = t();
    g.advanceGameSeconds(0);
    g.setRivalsEnabled(false);
    g.advanceGameSeconds(10);
    const frozen = t();
    g.setRivalsEnabled(true);
    g.advanceGameSeconds(10);
    return { a, frozen, back: t(), player: g.getState().simTime, ticks: g.getRenderInfo().rivals.ticks };
  });
  expect(p.frozen).toEqual(p.a);
  expect(p.back).toEqual([p.a[0] + 10, p.a[1] + 10]);
  expect(p.player).toBe(2990);
  expect(errors).toEqual([]);
});

test('one Moon, one flare schedule: every base sees the same phase, class and index at every second', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page);
  await start(page, 'robots', 'mare');
  // the first flare: a C-class drill at day 2.4 (second 1728): telegraph, protons, quiet again; the Vanguard landed at 1530.
  // the second (second ~3526) meets the Commons, who landed at 2970
  const r = await page.evaluate(() => {
    const g = window.__game;
    const rows: any[] = [];
    const view = (f: any) => (f ? { phase: f.phase, cls: f.cls, n: f.n, flashAt: f.flashAt, activeAt: f.activeAt, range: f.range, a: f.a, timer: f.timer } : null);
    g.advanceGameSeconds(1590 - 90);
    for (let i = 0; i < 40; i++) {
      g.advanceGameSeconds(20);
      rows.push({ t: g.getState().simTime, p: view(g.getState().flare), v: view(g.getRivalState('accelerationists')?.flare), c: null });
    }
    g.advanceGameSeconds(3000 - g.getState().simTime);
    for (let i = 0; i < 35; i++) {
      g.advanceGameSeconds(20);
      rows.push({ t: g.getState().simTime, p: view(g.getState().flare), v: null, c: view(g.getRivalState('solarpunks')?.flare) });
    }
    return { rows, moon: g.getMoon().weather };
  });
  const phases = new Set<string>();
  for (const x of r.rows) {
    const other = x.v ?? x.c;
    expect(other, `t=${x.t}`).toEqual(x.p);
    phases.add(`${x.t < 2500 ? 'first' : 'second'}:${x.p.phase}`);
  }
  // both windows really covered a telegraph and the protons
  for (const w of ['first', 'second']) for (const p of ['idle', 'telegraph', 'active']) expect(phases.has(`${w}:${p}`), `${w} flare ${p}`).toBe(true);
  expect(r.moon.n).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});

test('save v2 keeps the Moon, the player and each rival; a reload ticks alike; a solo game still saves v1 and loads solo', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await boot(page);
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const T = await import('/src/data/techs.ts');
    const fnv = (str: string) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
    const dig = (v: unknown) => fnv(JSON.stringify(v));
    // the player's fields but `buildings` (a load adds the defaults of fields a base created this session lacks, as on a solo base)
    const player = () => { const s = g.getState(); return Object.fromEntries(Object.keys(s).sort().filter((k) => k !== 'buildings').map((k) => [k, dig(s[k])])); };
    const rivals = () => g.getRivals().map((x: any) => ({ ...x, res: dig(x.resources) }));
    g.selectFaction('solarpunks', 'mare');
    g.setPaused(true);
    g.advanceGameSeconds(0);
    g.grantResources({ oxygen: 6000, food: 6000, water: 6000 });
    // the Foundry rival plays a little: the early techs, arrays, a smelter and an excavator that digs a virtual pit
    g.rivalGrant('robots', { metals: 4000, parts: 2000, silicon: 1000, chips: 200, regolith: 2000, water: 600 });
    for (const t of T.TECH_ORDER) { const d = T.TECHS[t]; if (d.track || d.band || d.era > 2) continue; if (d.expeditions && !d.expeditions.includes('robotic')) continue; g.rivalCompleteTech('robots', t); }
    const placed: Record<string, boolean> = {};
    const place = (type: string) => {
      for (let q = 4; q < 30; q += 2) for (const [x, z] of [[127 + q, 127], [127 - q, 127], [127, 127 + q], [127, 127 - q], [127 + q, 127 + q], [127 - q, 127 - q]]) {
        const before = g.getRivalState('robots').buildings.length;
        g.rivalApply('robots', { kind: 'place', type, gx: x, gz: z, rot: 0 });
        if (g.getRivalState('robots').buildings.length > before) return true;
      }
      return false;
    };
    for (const t of ['solar', 'solar', 'solar', 'battery', 'smelter', 'refinery', 'partsFab']) placed[t] = place(t);
    g.advanceGameSeconds(1500);
    const before = { rivals: rivals(), moon: dig(g.getMoon()), player: player(), clock: g.getMoon().clock };
    const blob = g.saveBlob();
    const size = JSON.stringify(blob).length;
    g.loadBlob(JSON.parse(JSON.stringify(blob)));
    const after = { rivals: rivals(), moon: dig(g.getMoon()), player: player(), clock: g.getMoon().clock };
    // two loads of one save, advanced the same
    const run = () => {
      g.loadBlob(JSON.parse(JSON.stringify(blob)));
      g.setPaused(true);
      g.advanceGameSeconds(0);
      g.advanceGameSeconds(3000);
      return { rivals: rivals(), full: g.getRivals().map((x: any) => dig(g.getRivalState(x.faction))), player: player(), moon: dig(g.getMoon()) };
    };
    const a = run();
    const b = run();
    return { placed, before, after, size, v: blob.version, keys: Object.keys(blob).sort(), a, b, rivalKeys: Object.keys(blob.rivals[0].state), flattens: blob.rivals[0].state.flattens.length };
  });
  expect(Object.values(r.placed).every(Boolean), `the rival's buildings: ${JSON.stringify(r.placed)}`).toBe(true);
  expect(r.v).toBe(2);
  expect(r.keys).toEqual(['camera', 'moon', 'player', 'rivals', 'savedAt', 'version']);
  expect(r.before.rivals[0]).toMatchObject({ faction: 'robots', landed: true });
  expect(r.before.rivals[0].pits.length, 'the excavator opened a virtual pit').toBeGreaterThan(0);
  expect(r.before.rivals[0].buildings).toBeGreaterThan(6);
  expect(r.flattens, 'the rival save keeps the pads').toBeGreaterThan(6);
  // everything the rivals hold is the same after a load: ground hash (pads and pit signature), clock, launches, techs, resources, pits
  expect(r.after.rivals).toEqual(r.before.rivals);
  expect(r.after.moon).toBe(r.before.moon);
  expect(r.after.clock).toBe(r.before.clock);
  expect(r.after.player).toEqual(r.before.player);
  expect(r.a.rivals[0].pits.length).toBeGreaterThan(0);
  expect(r.a, 'two loads advanced 3000 s are identical').toEqual(r.b);
  console.log(`[W0i] faction save: ${Math.round(r.size / 1024)} KB`);
  expect(errors).toEqual([]);
});

test('a v1 blob (what a solo game saves) loads solo with no rivals, even straight after a faction game', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await boot(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.selectSite('mare', 'robotic');
    g.setPaused(true);
    g.advanceGameSeconds(0);
    g.advanceGameSeconds(400);
    const v1 = JSON.parse(JSON.stringify(g.saveBlob()));
    const soloT = g.getState().simTime;
    // a faction game in between: rivals, a Moon with a player
    g.selectFaction('solarpunks', 'lavatube');
    const during = { rivals: g.getRivals().length, player: g.getMoon().player };
    g.loadBlob(v1);
    g.setPaused(true);
    g.advanceGameSeconds(0);
    const s = g.getState();
    const loaded = { rivals: g.getRivals().length, moon: g.getMoon(), faction: s.faction, t: s.simTime, exp: s.expedition, info: g.getRenderInfo().rivals.n, techs: s.techsDone };
    const v2Version = (g.selectFaction('robots', 'mare'), g.saveBlob().version);
    return { v1Shape: [Object.keys(v1).sort(), v1.version ?? null], soloT, during, loaded, v2Version };
  });
  expect(r.v1Shape).toEqual([['camera', 'savedAt', 'state'], null]);
  expect(r.during).toEqual({ rivals: 2, player: 'solarpunks' });
  expect(r.loaded.rivals).toBe(0);
  expect(r.loaded.info).toBe(0);
  expect(r.loaded.moon).toMatchObject({ player: null, seed: 42 });
  expect(r.loaded.moon.race.phase).toBe('solo');
  expect(Object.values(r.loaded.moon.factions).some((x: any) => x.landed)).toBe(false);
  expect(r.loaded.t).toBe(r.soloT);
  expect(r.loaded.techs).toEqual(['landingRobotic']);
  expect(r.v2Version, 'a faction game saves v2').toBe(2);
  expect(errors).toEqual([]);
});

test('the rivals are cheap: two bases step well under 2 ms a second after 720 s, and the counters read true', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await boot(page);
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const T = await import('/src/data/techs.ts');
    g.selectFaction('solarpunks', 'mare');
    g.setPaused(true);
    g.advanceGameSeconds(0);
    g.grantResources({ oxygen: 6000, food: 6000, water: 6000 });
    // the Foundry rival has a working base, so the tick is not a bare Lander's
    g.rivalGrant('robots', { metals: 4000, parts: 2000, silicon: 1000, chips: 200, regolith: 2000, water: 600 });
    for (const t of T.TECH_ORDER) { const d = T.TECHS[t]; if (d.track || d.band || d.era > 2) continue; if (d.expeditions && !d.expeditions.includes('robotic')) continue; g.rivalCompleteTech('robots', t); }
    for (const type of ['solar', 'solar', 'solar', 'battery', 'smelter', 'refinery', 'partsFab']) {
      for (let q = 4; q < 30; q += 2) {
        let ok = false;
        for (const [x, z] of [[127 + q, 127], [127 - q, 127], [127, 127 + q], [127, 127 - q]]) {
          const before = g.getRivalState('robots').buildings.length;
          g.rivalApply('robots', { kind: 'place', type, gx: x, gz: z, rot: 0 });
          if (g.getRivalState('robots').buildings.length > before) { ok = true; break; }
        }
        if (ok) break;
      }
    }
    g.advanceGameSeconds(720);
    const info = g.getRenderInfo();
    return { rivals: info.rivals, moon: info.moon, t: g.getState().simTime, n: g.getRivals().map((x: any) => x.buildings), headless: g.debugHeadless('southpole', 600) };
  });
  // a standalone flat base (the CP0 gate): ten game-minutes of a headless Lander
  expect(r.headless).toMatchObject({ simTime: 690, buildings: 1 });
  expect(r.headless.terrainHash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
  expect(r.headless.msPerTick).toBeLessThan(2);
  expect(r.rivals.n).toBe(2);
  expect(r.rivals.ticks, 'one rival step per player tick').toBe(720);
  expect(r.rivals.behind).toBe(0);
  expect(r.rivals.msPerTick, 'ms per Moon second, both rivals').toBeGreaterThan(0);
  expect(r.rivals.msPerTick, 'ms per Moon second, both rivals').toBeLessThan(2);
  expect(r.moon.clock, 'the Moon is at the players\' second').toBe(r.t);
  expect(r.n[0]).toBeGreaterThan(6);
  console.log(`[W0i] rivals after 720 s: msPerTick ${r.rivals.msPerTick.toFixed(3)}, msLast ${r.rivals.msLast.toFixed(3)} (Foundry ${r.n[0]} buildings, Vanguard ${r.n[1]})`);
  expect(errors).toEqual([]);
});

test('?faction= starts the faction game on ?site=, its expedition winning over ?exp=; an unknown faction is a solo boot', async ({ page }) => {
  test.setTimeout(120_000);
  const cases: [string, string | undefined, 'human' | 'robotic', number][] = [
    ['&site=mare&faction=robots', 'robots', 'robotic', 2],
    ['&site=southpole&faction=accelerationists&exp=robotic', 'accelerationists', 'human', 2],
    ['&site=lavatube&faction=solarpunks', 'solarpunks', 'human', 2],
    ['&site=mare&faction=bogus&exp=robotic', undefined, 'robotic', 0],
    ['&site=mare&exp=robotic', undefined, 'robotic', 0],
  ];
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const [q, faction, exp, rivals] of cases) {
    await page.goto(`/?debug&seed=42${q}`);
    await page.waitForFunction(() => window.__game !== undefined && window.__game.getState() !== null);
    const r = await page.evaluate(() => { const g = window.__game; const s = g.getState(); return { faction: s.faction, exp: s.expedition, rivals: g.getRivals().length, pending: (window as any).__pendingFaction }; });
    expect(r, q).toMatchObject({ faction, exp, rivals });
    expect(r.pending, 'the stopgap is gone').toBeUndefined();
  }
  expect(errors).toEqual([]);
});
