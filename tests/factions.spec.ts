/** Factions (docs/20), the DATA half (stream W0d): the faction table, the three landing techs whose effects
 *  carry each faction's traits into the mods, faction-locked tech visibility, the lane and pick cost
 *  multipliers in techCost, the new mods fields' neutral defaults, `?faction=` parsing and the resolveTech
 *  faction override. The traits are read here through the debug API on a SOLO game (completeTech of the
 *  landing tech); the rivals half (S4) extends this file later. Every data test pauses the
 *  game and drives nothing forward.
 *
 *  The UI HALF (stream S1, the tests from "the UI half" down): the faction step of the site screen (Site →
 *  WHO ARE YOU? → Land), the briefing and the Era 1 explainer's race paragraph, the ⚑ RACE chip and panel and
 *  the standings, and the `race` notification family's feed handlers (a rival landing; the pre-roll is silent). */
import { test, expect as baseExpect, type Page } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 20_000 });

declare global {
  interface Window { __game?: any }
}

async function start(page: Page, query: string) {
  await page.goto(`/?debug&seed=42${query}`);
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => { window.__game.openRoads(true); window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
}
const g = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => window.__game[f as string](...(a as unknown[])), [fn, args] as const);

type ModsView = Record<string, any>;

/** the new fields' neutral values, and the ones the traits touch that a solo game leaves at their defaults */
const NEUTRAL = {
  machineFlareMult: 1, nightOutputMult: 1, bankDischargeMult: 1, moraleFallMult: 1, scrutiny: false, builderFounds: false,
  arrayHardMult: 1, nightDrawMult: 1, storageEff: 0.85, hazardRateMult: 1, moraleBase: 0, growthMult: 1, buildSpeedMult: 1,
  droneRange: 1,
};
const LANES = ['power', 'materials', 'robotics', 'compute', 'habitat', 'exploration', 'export'];
const lanesExcept = (over: Record<string, number>) => Object.fromEntries(LANES.map((l) => [l, over[l] ?? 1]));

// ───────────────────────────── the table ─────────────────────────────

test('data: the faction table, landing days, sites, liveries and the legacy mapping', async ({ page }) => {
  await start(page, '&site=mare&exp=robotic');
  const r = await page.evaluate(async () => {
    const F = await import('/src/data/factions.ts');
    const T = await import('/src/data/techs.ts');
    return {
      order: F.FACTION_ORDER,
      rows: F.FACTION_ORDER.map((id: string) => {
        const d = F.FACTIONS[id];
        const t = T.TECHS[d.landingTech];
        return {
          id: d.id, name: d.name, short: d.short, glyph: d.glyph, expedition: d.expedition, landsAtDay: d.landsAtDay,
          sites: d.sites, livery: d.livery, landingTech: d.landingTech,
          ethos: d.ethos.length > 0 && !d.ethos.includes('\n'),
          briefing: d.briefing.split(/[.!?]\s/).length, advantages: d.advantages.length, disadvantages: d.disadvantages.length,
          uniqueBuildings: d.uniqueBuildings, uniqueTechs: d.uniqueTechs, policy: d.policy,
          tech: {
            era: t.era, costData: t.costData, requires: t.requires, expeditions: t.expeditions, factions: t.factions,
            track: t.track, copy: [t.desc, t.visual, t.tradeoff].every((x: string) => x.length > 20),
          },
          mapped: F.LANDING_TECH_FOR[id], name2: F.FACTION_NAME[id],
        };
      }),
      legacy: [F.factionOf('robotic'), F.factionOf('human')],
      solo: T.LANDING_TECH,
      landingTechFor: T.landingTechFor('solarpunks'),
      factionOfState: [F.factionOfState({}), F.factionOfState({ faction: 'robots' }), F.factionOfState({ faction: null }), F.factionOfState(null)],
      counts: [T.destinyCounts(['landingFoundry']), T.destinyCounts(['landingVanguard']), T.destinyCounts(['landingCommons']),
        T.destinyCounts(['landingCrew']), T.destinyCounts(['landingRobotic'])].map((d: any) => [d.c, d.a]),
    };
  });
  expect(r.order).toEqual(['robots', 'accelerationists', 'solarpunks']);
  expect(r.rows.map((x: any) => [x.name, x.short, x.glyph, x.expedition, x.landsAtDay])).toEqual([
    ['The Foundry', 'Foundry', '⚙', 'robotic', 0],
    ['The Vanguard', 'Vanguard', '▲', 'human', 2],
    ['The Commons', 'Commons', '❀', 'human', 4],
  ]);
  expect(r.rows.map((x: any) => x.sites)).toEqual([
    ['mare', 'lavatube', 'southpole'], ['southpole', 'mare', 'lavatube'], ['lavatube', 'southpole', 'mare'],
  ]);
  expect(r.rows.map((x: any) => x.livery)).toEqual([
    { hull: '#5b6068', trim: '#e8632b', suit: '#d9d4c8' },
    { hull: '#f2f3f5', trim: '#2f5fd0', suit: '#f2f3f5' },
    { hull: '#d9c9a3', trim: '#5f9f3f', suit: '#e8dcb8' },
  ]);
  for (const x of r.rows) {
    expect(x.ethos, x.id).toBe(true);
    expect(x.briefing, x.id).toBeGreaterThanOrEqual(2);
    expect(x.briefing, x.id).toBeLessThanOrEqual(3);
    expect(x.advantages, x.id).toBeGreaterThan(1);
    expect(x.disadvantages, x.id).toBeGreaterThan(1);
    // S3 filled the unique content (two buildings and an eight-tech branch each: tests/research.spec.ts reads them) and S4 the policy: empty for now, typed and present
    expect(x.uniqueBuildings).toHaveLength(2);
    expect(x.uniqueTechs).toHaveLength(8);
    expect(x.policy).toEqual({ research: [], destiny: {}, doctrines: {}, claimKinds: [], ruleCaps: {}, orders: [] });
    // the landing tech is the Era 1 faction pick, free, locked to its faction and its expedition
    expect(x.mapped).toBe(x.landingTech);
    expect(x.name2).toBe(x.name);
    expect(x.tech).toMatchObject({ era: 1, costData: 0, requires: [], expeditions: [x.expedition], factions: [x.id], copy: true });
    expect(x.tech.track).toMatchObject({ era: 1, landing: true });
  }
  expect(r.rows.map((x: any) => x.landingTech)).toEqual(['landingFoundry', 'landingVanguard', 'landingCommons']);
  expect(r.rows.map((x: any) => x.tech.track.side)).toEqual(['automation', 'colony', 'colony']);
  expect(r.legacy).toEqual(['robots', 'accelerationists']);
  // the solo landings are untouched
  expect(r.solo).toEqual({ human: 'landingCrew', robotic: 'landingRobotic' });
  expect(r.landingTechFor).toBe('landingCommons');
  expect(r.factionOfState).toEqual([undefined, 'robots', undefined, undefined]);
  // a faction landing counts on its side of the Era 1 pick, as the solo landings do: [colony, automation]
  expect(r.counts).toEqual([[0, 1], [1, 0], [1, 0], [1, 0], [0, 1]]);
});

// ───────────────────────────── solo stays neutral ─────────────────────────────

test('solo: the new mods fields boot at neutral defaults and the faction landings stay hidden', async ({ page }) => {
  for (const exp of ['human', 'robotic'] as const) {
    await start(page, `&site=mare${exp === 'robotic' ? '&exp=robotic' : ''}`);
    const m: ModsView = await g(page, 'getMods');
    expect(m, exp).toMatchObject(NEUTRAL);
    expect(m.laneCostMult, exp).toEqual(lanesExcept({}));
    expect(m.pickCostMult, exp).toEqual({ colony: 1, automation: 1 });
    expect(m.guards).toEqual([]);
    const s = await g(page, 'getState');
    expect(s.techsDone).toEqual([exp === 'robotic' ? 'landingRobotic' : 'landingCrew']);
    expect(s.faction ?? null).toBeNull();
    const cards = (await g(page, 'getResearch')).cards;
    for (const t of ['landingFoundry', 'landingVanguard', 'landingCommons']) expect(cards[t].state, t).toBe('hidden');
    expect(cards.landingFoundry.reason).toBe('⚑ The Foundry only');
    expect(cards.landingVanguard.reason).toBe('⚑ The Vanguard only');
    expect(cards.landingCommons.reason).toBe('⚑ The Commons only');
  }
});

// ───────────────────────────── the landing techs carry the traits ─────────────────────────────

test('the Foundry landing tech yields the Foundry numbers in the mods', async ({ page }) => {
  await start(page, '&site=mare&exp=robotic');
  const before: ModsView = await g(page, 'getMods');
  await g(page, 'completeTech', 'landingFoundry');
  const m: ModsView = await g(page, 'getMods');
  expect(m.buildSpeedMult).toBeCloseTo(0.9, 6);
  expect(m.droneRange).toBeCloseTo(1.15, 6);
  expect(m.laneCostMult).toEqual(lanesExcept({ robotics: 0.85, compute: 0.85 }));
  expect(m.arrayHardMult).toBeCloseTo(1.6, 6);
  expect(m.machineFlareMult).toBeCloseTo(1.75, 6);
  expect(m.nightOutputMult).toBeCloseTo(0.25, 6);
  expect(m.nightDrawMult).toBeCloseTo(1.3, 6);
  expect(m.storageEff).toBeCloseTo(0.75, 6);
  expect(m.bankDischargeMult).toBeCloseTo(1.25, 6);
  // nothing of the other two factions' traits
  expect(m).toMatchObject({ scrutiny: false, moraleFallMult: 1, moraleBase: 0, hazardRateMult: 1, growthMult: 1 });
  expect(m.pickCostMult).toEqual({ colony: 1, automation: 1 });
  expect(m.guards).toEqual([]);
  // every other multiplier is as it was
  expect(m.outputMult).toEqual(before.outputMult);
  expect(m.powerMult).toEqual(before.powerMult);
});

test('the Vanguard landing tech yields the Vanguard numbers in the mods, and the 100 starting data', async ({ page }) => {
  await start(page, '&site=southpole');
  const before: ModsView = await g(page, 'getMods');
  const data0 = (await g(page, 'getState')).data;
  await g(page, 'completeTech', 'landingVanguard');
  const m: ModsView = await g(page, 'getMods');
  expect(m.outputMult.lab).toBeCloseTo(before.outputMult.lab * 1.35, 6);
  expect(m.outputMult.dataCenter).toBeCloseTo(before.outputMult.dataCenter * 1.2, 6);
  expect(m.outputMult.serverMonolith).toBeCloseTo(before.outputMult.serverMonolith * 1.2, 6); // a Monolith is a Data Center
  expect(m.laneCostMult).toEqual(lanesExcept({ compute: 0.8, materials: 0.8 }));
  expect(m.moraleBase).toBe(-8);
  expect(m.moraleFallMult).toBe(2);
  expect(m.scrutiny).toBe(true);
  expect(m.hazardRateMult).toBeCloseTo(1.25, 6);
  expect(m.pickCostMult).toEqual({ colony: 1.15, automation: 1 });
  expect(m).toMatchObject({ machineFlareMult: 1, nightOutputMult: 1, bankDischargeMult: 1, arrayHardMult: 1, buildSpeedMult: 1 });
  expect((await g(page, 'getState')).data - data0).toBe(100);
});

test('the Commons landing tech yields the Commons numbers in the mods', async ({ page }) => {
  await start(page, '&site=lavatube');
  await g(page, 'completeTech', 'landingCommons');
  const m: ModsView = await g(page, 'getMods');
  expect(m.moraleBase).toBe(10);
  expect(m.hazardRateMult).toBeCloseTo(0.6, 6);
  expect(m.guards).toContain('safety');
  expect(m.laneCostMult).toEqual(lanesExcept({ habitat: 0.6, materials: 1.3, robotics: 1.3, exploration: 1.3 }));
  // growthMult is a PERIOD: settlers arrive ×1.25 as often
  expect(m.growthMult).toBeCloseTo(1 / 1.25, 6);
  expect(m.buildSpeedMult).toBeCloseTo(1.3, 6); // build TIME ×1.3
  expect(m.pickCostMult).toEqual({ colony: 0.85, automation: 1 });
  expect(m).toMatchObject({ scrutiny: false, moraleFallMult: 1, machineFlareMult: 1, nightOutputMult: 1, bankDischargeMult: 1 });
});

// ───────────────────────────── visibility, resolve ─────────────────────────────

test('factions: a faction-locked tech is invisible to solo and to the other factions; the solo landings give way', async ({ page }) => {
  await start(page, '&site=mare');
  const r = await page.evaluate(async () => {
    const R = await import('/src/core/research.ts');
    const T = await import('/src/data/techs.ts');
    const F = await import('/src/data/factions.ts');
    const st = window.__game.getState();
    const vis = (tech: string, faction: string | undefined, exp: string) =>
      R.techVisible(T.TECHS[tech], { siteId: 'mare', expedition: exp, faction });
    const table: Record<string, Record<string, boolean>> = {};
    for (const f of F.FACTION_ORDER) {
      const exp = F.FACTIONS[f].expedition;
      table[f] = Object.fromEntries(['landingFoundry', 'landingVanguard', 'landingCommons', 'landingCrew', 'landingRobotic']
        .map((t) => [t, vis(t, f, exp)]));
    }
    const solo = Object.fromEntries(['landingFoundry', 'landingVanguard', 'landingCommons', 'landingCrew', 'landingRobotic']
      .map((t) => [t, vis(t, undefined, t === 'landingRobotic' || t === 'landingFoundry' ? 'robotic' : 'human')]));
    const asFaction = (faction: string | null) => ({ ...st, faction, expedition: faction ? F.FACTIONS[faction].expedition : st.expedition });
    const avail = (tech: string, faction: string | null) => R.techAvailability(tech, asFaction(faction));
    return {
      table, solo,
      foundryFromVanguard: avail('landingFoundry', 'accelerationists'),
      foundryFromSolo: avail('landingFoundry', null),
      crewInFactionGame: avail('landingCrew', 'solarpunks'),
      hidden: R.irrelevantVisibleTechs('mare', 'human', 'solarpunks'),
      soloHidden: R.irrelevantVisibleTechs('mare', 'human'),
    };
  });
  expect(r.table).toEqual({
    robots: { landingFoundry: true, landingVanguard: false, landingCommons: false, landingCrew: false, landingRobotic: false },
    accelerationists: { landingFoundry: false, landingVanguard: true, landingCommons: false, landingCrew: false, landingRobotic: false },
    solarpunks: { landingFoundry: false, landingVanguard: false, landingCommons: true, landingCrew: false, landingRobotic: false },
  });
  // solo: the faction landings are invisible, the solo landing of its own expedition shows
  expect(r.solo).toEqual({ landingFoundry: false, landingVanguard: false, landingCommons: false, landingCrew: true, landingRobotic: true });
  expect(r.foundryFromVanguard).toEqual({ state: 'hidden', reason: '⚑ The Foundry only' });
  expect(r.foundryFromSolo).toEqual({ state: 'hidden', reason: '⚑ The Foundry only' });
  expect(r.crewInFactionGame.state).toBe('hidden');
  expect(r.hidden).toEqual([]);
  expect(r.soloHidden).toEqual([]);
});

test('factions: resolveTech merges the robotic override and the faction override; a solo game resolves as before', async ({ page }) => {
  await start(page, '&site=mare');
  const r = await page.evaluate(async () => {
    const R = await import('/src/core/research.ts');
    const T = await import('/src/data/techs.ts');
    const base = T.TECHS.crewWellness; // robotic: { era: 7, costData: 1000 }
    const probe = {
      ...T.TECHS.teleoperation, id: 'zzProbe',
      factionOverride: { solarpunks: { era: 2, costData: 77, name: 'Probe Name', short: 'Probe', desc: 'Probe desc' }, robots: { costData: 55 } },
    };
    const o = (def: any, exp: string, f?: string) => { const d = R.resolveTech(def, exp, f); return [d.era, d.costData, d.name, d.short, d.desc]; };
    return {
      crewHuman: R.resolveTech(base, 'human') === base,
      crewRobotic: o(base, 'robotic'),
      crewRoboticAsRobots: o(base, 'robotic', 'robots'),
      crewBase: o(base, 'human'),
      plain: [R.resolveTech(T.TECHS.teleoperation, 'human', 'solarpunks') === T.TECHS.teleoperation, R.resolveTech(T.TECHS.teleoperation, 'robotic') === T.TECHS.teleoperation],
      probeSolo: o(probe, 'human'),
      probeSolar: o(probe, 'human', 'solarpunks'),
      probeVanguard: o(probe, 'human', 'accelerationists'),
      probeRobots: o(probe, 'robotic', 'robots'),
      teleop: [T.TECHS.teleoperation.era, T.TECHS.teleoperation.costData, T.TECHS.teleoperation.name, T.TECHS.teleoperation.short, T.TECHS.teleoperation.desc],
    };
  });
  expect(r.crewHuman).toBe(true);
  expect(r.crewBase.slice(0, 2)).toEqual([5, 460]);
  expect(r.crewRobotic.slice(0, 2)).toEqual([7, 1000]);
  expect(r.crewRoboticAsRobots).toEqual(r.crewRobotic); // robotic resolves through the Foundry
  expect(r.plain).toEqual([true, true]);
  expect(r.probeSolo).toEqual(r.teleop);
  expect(r.probeSolar).toEqual([2, 77, 'Probe Name', 'Probe', 'Probe desc']);
  expect(r.probeVanguard).toEqual(r.teleop);
  expect(r.probeRobots).toEqual([r.teleop[0], 55, r.teleop[2], r.teleop[3], r.teleop[4]]);
});

// ───────────────────────────── costs ─────────────────────────────

test('lane and pick cost multipliers change techCost; a solo state costs exactly what it did', async ({ page }) => {
  await start(page, '&site=southpole');
  const r = await page.evaluate(async () => {
    const R = await import('/src/core/research.ts');
    const T = await import('/src/data/techs.ts');
    const B = await import('/src/data/balance.ts');
    const st = window.__game.getState();
    const withTechs = (...extra: string[]) => ({ ...st, techsDone: [...st.techsDone, ...extra] });
    const probes: Record<string, string> = {
      compute: 'fieldSpectrometers', materials: 'grizzlyScreens', robotics: 'teleoperation', habitat: 'iceExtraction',
      exploration: 'sampleCaches', power: 'bifacialCells', colonyPick: 'pressureHalls', automationPick: 'dispatchMesh', landing: 'landingCrew',
    };
    const plain = (tid: string) => { const d = T.TECHS[tid]; return Math.round(d.costData * B.ERA_COST_SCALE[d.era]); };
    const rows = (s: any) => Object.fromEntries(Object.entries(probes).map(([k, tid]) => [k, R.techCost(tid, s).base]));
    return {
      plain: Object.fromEntries(Object.entries(probes).map(([k, tid]) => [k, plain(tid)])),
      solo: rows(st),
      foundry: rows(withTechs('landingFoundry')),
      vanguard: rows(withTechs('landingVanguard')),
      commons: rows(withTechs('landingCommons')),
      // a pick's DATA cost follows the same multiplier after an insight discount
      vanguardData: R.techCost('pressureHalls', { ...withTechs('landingVanguard'), insights: { pressureHalls: 0.5 } }).data,
      explicitMods: R.techCost('pressureHalls', st, { laneCostMult: Object.fromEntries(['power', 'materials', 'robotics', 'compute', 'habitat', 'exploration', 'export'].map((l) => [l, 1])) as any, pickCostMult: { colony: 2, automation: 1 } }).base,
    };
  });
  // solo: costs are the plain scaled costs, every lane (bit-identical)
  expect(r.solo).toEqual(r.plain);
  const x = (k: string, m: number) => Math.round(r.plain[k] * m);
  // rounding happens once, on the multiplied number: check within a point of the rounded product
  const near = (got: number, want: number) => Math.abs(got - want) <= 1;
  for (const [f, lanes] of [
    ['foundry', { robotics: 0.85, compute: 0.85 }],
    ['vanguard', { compute: 0.8, materials: 0.8, colonyPick: 1.15 }],
    ['commons', { habitat: 0.6, materials: 1.3, robotics: 1.3, exploration: 1.3, colonyPick: 0.85 }],
  ] as [string, Record<string, number>][]) {
    for (const k of Object.keys(r.plain)) {
      const want = x(k, lanes[k] ?? 1);
      expect(near((r as any)[f][k], want), `${f} ${k}: got ${(r as any)[f][k]}, want ≈ ${want}`).toBe(true);
    }
  }
  // the multipliers really moved the numbers that should move, and left the rest
  expect(r.vanguard.compute).toBeLessThan(r.plain.compute);
  expect(r.vanguard.colonyPick).toBeGreaterThan(r.plain.colonyPick);
  expect(r.vanguard.automationPick).toBe(r.plain.automationPick);
  expect(r.vanguard.power).toBe(r.plain.power);
  expect(r.commons.habitat).toBeLessThan(r.plain.habitat);
  expect(r.commons.materials).toBeGreaterThan(r.plain.materials);
  expect(r.foundry.habitat).toBe(r.plain.habitat);
  // the landing is free and never scaled
  expect(r.vanguard.landing).toBe(r.plain.landing);
  expect(near(r.vanguardData, Math.round(r.plain.colonyPick * 1.15 * 0.5))).toBe(true);
  expect(r.explicitMods).toBe(Math.round(r.plain.colonyPick * 2));

  // the same through the live game: complete the landing tech, the research view's costs follow
  await g(page, 'completeTech', 'landingCommons');
  const cards = (await g(page, 'getResearch')).cards;
  expect(near(cards.iceExtraction.cost.base, x('habitat', 0.6))).toBe(true);
  expect(near(cards.grizzlyScreens.cost.base, x('materials', 1.3))).toBe(true);
  expect(near(cards.pressureHalls.cost.base, x('colonyPick', 0.85))).toBe(true);
});

// ───────────────────────────── ?faction= ─────────────────────────────

test('?faction= boots the faction game on the faction\'s expedition (the integration, stream W0i, adds rivals and the Moon)', async ({ page }) => {
  const landing: Record<string, string> = { robots: 'landingFoundry', accelerationists: 'landingVanguard', solarpunks: 'landingCommons' };
  const cases: [string, 'human' | 'robotic', string | undefined][] = [
    ['&site=mare&faction=robots', 'robotic', 'robots'],
    ['&site=mare&faction=accelerationists', 'human', 'accelerationists'],
    ['&site=lavatube&faction=solarpunks', 'human', 'solarpunks'],
    // the faction's expedition wins over ?exp=
    ['&site=mare&faction=robots&exp=human', 'robotic', 'robots'],
    ['&site=mare&faction=solarpunks&exp=robotic', 'human', 'solarpunks'],
    // an unknown faction is ignored: the solo boot
    ['&site=mare&faction=bogus&exp=robotic', 'robotic', undefined],
  ];
  for (const [q, exp, faction] of cases) {
    await start(page, q);
    const s = await g(page, 'getState');
    expect(s.expedition, q).toBe(exp);
    expect(s.faction, q).toBe(faction);
    if (faction) {
      // the faction's landing tech stands in for the solo landing, so its traits are in the mods
      expect(s.techsDone, q).toEqual([landing[faction]]);
      expect(await g(page, 'getRivals'), q).toHaveLength(2);
    } else {
      expect(s.techsDone, q).toEqual([exp === 'robotic' ? 'landingRobotic' : 'landingCrew']);
      expect(await g(page, 'getMods'), q).toMatchObject(NEUTRAL);
      expect(await g(page, 'getRivals'), q).toHaveLength(0);
    }
  }
  // ?faction= with no ?site= waits at the site screen (no game yet)
  await page.goto('/?debug&seed=42&faction=accelerationists');
  await page.waitForFunction(() => window.__game !== undefined);
  expect(await g(page, 'getState')).toBeNull();
});

// ───────────────────────────── the UI half (docs/20 S1) ─────────────────────────────

const FIDS = ['robots', 'accelerationists', 'solarpunks'] as const;
type FId = (typeof FIDS)[number];
const GLYPH: Record<FId, string> = { robots: '⚙', accelerationists: '▲', solarpunks: '❀' };
const NAME: Record<FId, string> = { robots: 'The Foundry', accelerationists: 'The Vanguard', solarpunks: 'The Commons' };
const SITE_WORDS: Record<string, string> = { mare: 'Ilmenite Plains', southpole: 'Shackleton Rim', lavatube: 'Marius Hills Tube' };
const SITE_CARD: Record<string, string> = { mare: 'ILMENITE', southpole: 'SHACKLETON', lavatube: 'MARIUS' };

/** the site screen, through the site step to the faction step on `site` */
async function toFactionStep(page: Page, site: string, query = '') {
  await page.goto(`/?debug&seed=42${query}`);
  await page.waitForFunction(() => window.__game !== undefined);
  await expect(page.locator('#site-screen')).toBeVisible();
  await page.locator('.site-card', { hasText: SITE_CARD[site] }).click();
  await page.locator('#btn-land').click();
  await expect(page.locator('#site-screen h1')).toHaveText('WHO ARE YOU?');
}

/** a fresh page with no game started, tips on (the banners draw), the debug API up */
async function bare(page: Page, query = '') {
  await page.goto(`/?debug&seed=42${query}`);
  await page.waitForFunction(() => window.__game !== undefined);
}

test('the UI half, pick: Site → WHO ARE YOU? gives three faction cards (glyph, ethos, advantages, disadvantages, lands day) and where the rivals land', async ({ page }) => {
  await toFactionStep(page, 'southpole');
  const data = await page.evaluate(async () => {
    const F = await import('/src/data/factions.ts');
    return F.FACTION_ORDER.map((id: string) => {
      const d = F.FACTIONS[id];
      return { id, ethos: d.ethos, adv: d.advantages.length, dis: d.disadvantages.length, day: d.landsAtDay, trim: d.livery.trim, exp: d.expedition };
    });
  });
  await expect(page.locator('.faction-card')).toHaveCount(3);
  // the Foundry is the default: robots survive the Moon
  await expect(page.locator('.faction-card.sel')).toHaveAttribute('data-faction', 'robots');
  // where the rivals land, given the player's site (docs/20 §1: each takes the first site of its own preference still free)
  const rivalsAt = (site: string, f: FId): [FId, string, number][] => {
    const order: FId[] = ['robots', 'accelerationists', 'solarpunks'];
    const days: Record<FId, number> = { robots: 0, accelerationists: 2, solarpunks: 4 };
    const pref: Record<FId, string[]> = { robots: ['mare', 'lavatube', 'southpole'], accelerationists: ['southpole', 'mare', 'lavatube'], solarpunks: ['lavatube', 'southpole', 'mare'] };
    const taken = new Set([site]);
    const at: Partial<Record<FId, string>> = { [f]: site };
    for (const o of order) { if (o === f) continue; const s = pref[o].find((x) => !taken.has(x))!; taken.add(s); at[o] = s; }
    return order.filter((o) => o !== f).map((o) => [o, at[o]!, days[o]]);
  };
  for (const d of data) {
    const c = page.locator(`.faction-card[data-faction="${d.id}"]`);
    await expect(c.locator('h3')).toContainText(GLYPH[d.id as FId]);
    await expect(c.locator('h3')).toContainText(NAME[d.id as FId]);
    await expect(c).toContainText(d.ethos);
    await expect(c.locator('.pro')).toHaveCount(d.adv);
    await expect(c.locator('.con')).toHaveCount(d.dis);
    await expect(c.locator('.fc-lands')).toHaveText(`lands day ${d.day}`);
    await expect(c).toContainText(d.exp === 'robotic' ? 'Robotic mission' : 'Human crew');
    expect(await c.getAttribute('style')).toContain(d.trim);
    await expect(c.locator('.fc-rival')).toHaveCount(2);
    for (const [rf, site, day] of rivalsAt('southpole', d.id as FId)) {
      await expect(c.locator(`.fc-rival[data-rival="${rf}"]`)).toContainText(`${NAME[rf]} · ${SITE_WORDS[site]} · day ${day}`);
    }
  }
  // the three sites are all used: at southpole the Foundry's rivals hold the other two
  await expect(page.locator('.faction-card[data-faction="robots"] .fc-rival[data-rival="accelerationists"]')).toContainText('Ilmenite Plains');
  await expect(page.locator('.faction-card[data-faction="robots"] .fc-rival[data-rival="solarpunks"]')).toContainText('Marius Hills Tube');
  // a card is picked with a click; Back keeps the pick; another site moves the rivals
  await page.locator('.faction-card[data-faction="accelerationists"]').click();
  await expect(page.locator('.faction-card.sel')).toHaveAttribute('data-faction', 'accelerationists');
  await page.locator('#btn-back').click();
  await expect(page.locator('#btn-land')).toBeEnabled();
  await page.locator('.site-card', { hasText: 'ILMENITE' }).click();
  await page.locator('#btn-land').click();
  await expect(page.locator('.faction-card.sel')).toHaveAttribute('data-faction', 'accelerationists');
  const v = page.locator('.faction-card[data-faction="accelerationists"]');
  await expect(v.locator('.fc-rival[data-rival="robots"]')).toContainText('Marius Hills Tube');
  await expect(v.locator('.fc-rival[data-rival="solarpunks"]')).toContainText('Shackleton Rim');
});

test('the UI half, pick: ?faction= preselects its card; Land starts that faction\'s game, its expedition derived, the rivals on the other sites', async ({ page }) => {
  test.setTimeout(240_000);
  const cases: [FId, 'robotic' | 'human', string][] = [
    ['robots', 'robotic', 'landingFoundry'], ['accelerationists', 'human', 'landingVanguard'], ['solarpunks', 'human', 'landingCommons'],
  ];
  for (const [f, exp, landing] of cases) {
    await toFactionStep(page, 'mare', `&faction=${f}`);
    await expect(page.locator('.faction-card.sel')).toHaveAttribute('data-faction', f);
    await page.locator('#btn-launch-exp').click();
    await page.waitForFunction(() => window.__game.getState() !== null, null, { timeout: 90_000 });
    await expect(page.locator('#site-screen')).toBeHidden();
    const s = await g(page, 'getState');
    expect(s.faction, f).toBe(f);
    expect(s.expedition, f).toBe(exp);
    expect(s.siteId, f).toBe('mare');
    expect(s.techsDone, f).toEqual([landing]);
    const rivals = (await g(page, 'getRivals')) as { faction: string; siteId: string }[];
    expect(rivals.map((r) => r.faction).sort(), f).toEqual(FIDS.filter((x) => x !== f).sort());
    expect(new Set([...rivals.map((r) => r.siteId), 'mare']).size, `${f}: three distinct sites`).toBe(3);
  }
  // a bogus ?faction= opens the same screen on the default card
  await toFactionStep(page, 'mare', '&faction=bogus');
  await expect(page.locator('.faction-card.sel')).toHaveAttribute('data-faction', 'robots');
});

test('the UI half, briefing: a faction game opens on who you are, who landed when, what you race for, your weaknesses; then the Era 1 explainer with THE RACE', async ({ page }) => {
  await bare(page, '&tips');
  await page.evaluate(() => window.__game.selectFaction('solarpunks', 'mare'));
  const brief = page.locator('#briefing');
  await expect(brief).toBeVisible();
  await expect(brief).toHaveClass(/nf-era/);
  await expect(page.locator('#era-banner')).toBeHidden();
  expect((await g(page, 'getState')).paused).toBe(true);
  // who you are
  await expect(brief.locator('.br-who')).toContainText('THE COMMONS');
  await expect(brief.locator('.br-who')).toContainText('❀');
  const d = await page.evaluate(async () => {
    const F = await import('/src/data/factions.ts');
    const c = F.FACTIONS.solarpunks;
    return { ethos: c.ethos, briefing: c.briefing, dis: c.disadvantages.slice(0, 3) as string[] };
  });
  await expect(brief.locator('.br-ethos')).toHaveText(d.ethos);
  await expect(brief.locator('.br-blurb')).toHaveText(d.briefing);
  // the timeline, from the Moon: the Foundry and the Vanguard landed before you (they took the sites you did not), in landing order
  const lines = brief.locator('.br-timeline .br-line');
  await expect(lines).toHaveCount(3);
  await expect(lines.nth(0)).toContainText('The Foundry landed on day 0 at Marius Hills Tube.');
  await expect(lines.nth(1)).toContainText('The Vanguard landed on day 2 at Shackleton Rim.');
  await expect(lines.nth(2)).toContainText('You land on day 4 at Ilmenite Plains.');
  await expect(lines.nth(2)).toHaveAttribute('data-faction', 'solarpunks');
  // what you race for, and the weaknesses (three, one line each, the faction's own)
  await expect(brief.locator('.br-race')).toContainText('First light');
  await expect(brief.locator('.br-race')).toContainText('100 volleys (0.01 %)');
  await expect(brief.locator('.br-con')).toHaveCount(3);
  for (let i = 0; i < 3; i++) await expect(brief.locator('.br-con').nth(i)).toHaveText(d.dis[i]);
  await expect(brief.locator('.br-survey')).toHaveText('Survey early: a prospect a rival claims is gone.');
  // Continue hands over to the Era 1 explainer, still holding the pause: the race paragraph, the mission day, who is on the Moon
  await brief.locator('[data-dsc="ok"]').click();
  await expect(brief).toBeHidden();
  const era = page.locator('#era-banner');
  await expect(era).toBeVisible();
  await expect(era.locator('.eb-race')).toContainText('The race');
  await expect(era.locator('.eb-race')).toContainText('100 volleys');
  await expect(era.locator('.eb-moon')).toContainText('Mission day 1');
  await expect(era.locator('.eb-moon')).toContainText('Foundry');
  await expect(era.locator('.eb-moon')).toContainText('Vanguard');
  await expect(era.locator('.eb-moon')).toContainText('Commons (you)');
  await page.waitForTimeout(400);
  expect((await g(page, 'getState')).paused).toBe(true);
  await era.locator('[data-dsc="ok"]').click();
  await expect.poll(async () => (await g(page, 'getState')).paused).toBe(false);

  // a solo game: the era banner only, none of it
  await bare(page, '&tips&site=mare&exp=robotic');
  await expect(page.locator('#era-banner')).toBeVisible();
  await expect(page.locator('#briefing')).toBeHidden();
  await expect(page.locator('#era-banner .eb-race, #era-banner .eb-moon')).toHaveCount(0);
});

/** stage a race on the real Moon (per faction: launches, first-light Moon day, era) and publish it; the standings it reads are the game's */
const craft = async (page: Page, spec: Record<FId, [number, number | null, number]>, feed: { faction: FId; kind: string; text: string }[] = []) => {
  await page.evaluate(([sp, fd]) => {
    const g = window.__game;
    for (const [f, [launches, day, era]] of Object.entries(sp)) g.raceSet(f, { launches, era, firstLaunchAt: day === null ? null : day * 720 + 30 });
    for (const e of fd) g.feedPush(e);
  }, [spec, feed] as const);
};
const standings = (page: Page) => page.locator('#race-panel .rc-row').evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.faction));

test('the UI half, the RACE chip: in a faction game, never in solo; the panel lists each faction; standings rank by launches, first light, landing order', async ({ page }) => {
  // solo: no chip, no race
  await bare(page, '&site=mare&exp=robotic');
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
  await expect(page.locator('#race-chip')).toBeHidden();
  expect(await page.evaluate(() => window.__game.getState().faction)).toBeUndefined();
  expect((await g(page, 'getRace')).phase).toBe('solo');

  // a Vanguard game at the south pole: the Foundry landed on day 0 (mare), the Commons land on day 4 (lavatube)
  await bare(page);
  await page.evaluate(() => { window.__game.selectFaction('accelerationists', 'southpole'); window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
  const chip = page.locator('#race-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText('⚑ RACE · no first light yet');
  // it sits in the chip column, after the outposts chip
  const place = await page.evaluate(() => {
    const c = document.getElementById('race-chip')!;
    const prev = c.previousElementSibling?.id;
    return { prev, parent: c.parentElement?.id };
  });
  expect(place).toEqual({ prev: 'outposts-chip', parent: 'time-controls' });
  await expect(page.locator('#race-panel')).toBeHidden();
  await chip.click();
  const panel = page.locator('#race-panel');
  await expect(panel).toBeVisible();
  // nobody has launched: landing order, each row with its glyph, name, site and day
  const rows = panel.locator('.rc-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute('data-faction', 'robots');
  await expect(rows.nth(1)).toHaveAttribute('data-faction', 'accelerationists');
  await expect(rows.nth(2)).toHaveAttribute('data-faction', 'solarpunks');
  await expect(rows.nth(0)).toContainText('The Foundry');
  await expect(rows.nth(0)).toContainText('⚙');
  await expect(rows.nth(0)).toContainText('Ilmenite Plains · landed day 0');
  await expect(rows.nth(1)).toContainText('Shackleton Rim · landed day 2');
  await expect(rows.nth(1).locator('.rc-you')).toBeVisible();
  await expect(rows.nth(2)).toContainText('Marius Hills Tube · lands day 4');
  await expect(rows.nth(2)).toContainText('not landed yet');
  await expect(rows.nth(0).locator('.rc-launches')).toHaveText('0 volleys');
  await expect(rows.nth(0).locator('.rc-fl')).toHaveText('first light —');
  await expect(rows.nth(0).locator('.rc-era')).toHaveText('ERA 1');
  await chip.click();
  await expect(panel).toBeHidden();

  // the standings, in a game where all three have landed (the Commons, day 4, are last to land): launches first (the Foundry, 3),
  // then the earlier first light (the Vanguard, day 20, before the Commons, day 22), then the landing order
  await bare(page);
  await page.evaluate(() => { window.__game.selectFaction('solarpunks', 'southpole'); window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
  await craft(page, { robots: [3, 19, 4], accelerationists: [1, 20, 2], solarpunks: [1, 22, 2] },
    [{ faction: 'robots', kind: 'era', text: 'THE FOUNDRY REACHES ERA 4' }]);
  await expect(chip).toHaveText('⚑ RACE 3rd · Foundry 3 volleys · you 1');
  await chip.click();
  expect(await standings(page)).toEqual(['robots', 'accelerationists', 'solarpunks']);
  await expect(rows.nth(0).locator('.rc-rank')).toHaveText('1st');
  await expect(rows.nth(2).locator('.rc-rank')).toHaveText('3rd');
  await expect(rows.nth(2).locator('.rc-you')).toBeVisible();
  await expect(rows.nth(0).locator('.rc-launches')).toHaveText('3 volleys');
  await expect(rows.nth(0).locator('.rc-fl')).toHaveText('first light day 19');
  await expect(rows.nth(0).locator('.rc-era')).toHaveText('ERA 4');
  await expect(rows.nth(1).locator('.rc-launches')).toHaveText('1 volley');
  await expect(rows.nth(0).locator('.rc-last')).toContainText('THE FOUNDRY REACHES ERA 4');
  await expect(panel).toContainText('5 of 100 combined volleys');
  await chip.click();

  // the player's first light is the earlier: second place; a tie on both falls to the landing order; the leader is you
  await craft(page, { robots: [3, 19, 4], accelerationists: [1, 20, 2], solarpunks: [1, 18, 2] });
  await expect(chip).toHaveText('⚑ RACE 2nd · Foundry 3 volleys · you 1');
  await chip.click();
  expect(await standings(page)).toEqual(['robots', 'solarpunks', 'accelerationists']);
  await chip.click();
  await craft(page, { robots: [1, 20, 4], accelerationists: [1, 20, 2], solarpunks: [1, 20, 2] });
  await chip.click();
  expect(await standings(page)).toEqual(['robots', 'accelerationists', 'solarpunks']);
  await chip.click();
  await craft(page, { robots: [3, 19, 4], accelerationists: [1, 20, 2], solarpunks: [4, 22, 2] });
  await expect(chip).toHaveText('⚑ RACE 1st · you 4 volleys · Foundry 3');
});

test('the UI half, race news: a rival landing during play raises a race-family line; the landings before yours are silent (the feed cursor)', async ({ page }) => {
  test.setTimeout(240_000);
  // the Commons land last: the Foundry and the Vanguard are on the Moon before the game's first frame (the pre-roll), and say nothing
  await bare(page, '&tips');
  await page.evaluate(() => window.__game.selectFaction('solarpunks', 'mare'));
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(30); });
  const feed = (await g(page, 'getFeed')) as { kind: string; faction: string }[];
  expect(feed.filter((e) => e.kind === 'landed').map((e) => e.faction)).toEqual(['robots', 'accelerationists']);
  const s0 = await g(page, 'getState');
  expect(s0.log.filter((e: any) => e.family === 'race')).toEqual([]);
  expect(s0.alerts.filter((a: any) => /LANDS/.test(a.text))).toEqual([]);
  await expect(page.locator('#race-card')).toBeHidden();

  // the Foundry's game: the Vanguard lands on day 2 (second 1530), while the player plays
  await bare(page, '&tips');
  await page.evaluate(() => window.__game.selectFaction('robots', 'mare'));
  await page.locator('#briefing [data-dsc="ok"]').click();
  await page.locator('#era-banner [data-dsc="ok"]').click();
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(1450); });
  const s1 = await g(page, 'getState');
  const news = s1.log.filter((e: any) => e.family === 'race' && /LANDS/.test(e.text));
  expect(news).toHaveLength(1);
  expect(news[0]).toMatchObject({ text: 'THE VANGUARD LANDS — at SHACKLETON RIM', faction: 'accelerationists', kind: 'info', action: { panel: 'race' } });
  // a stack line, a card: the Vanguard's glyph and trim colour
  const line = page.locator('#alerts .alert', { hasText: 'THE VANGUARD LANDS' });
  await expect(line).toHaveClass(/nf-race/);
  await expect(line.locator('.alert-g')).toHaveText('▲');
  const card = page.locator('#race-card .rc-item[data-faction="accelerationists"]');
  await expect(card).toBeVisible();
  await expect(card.locator('.rc-ig')).toHaveText('▲');
  await expect(card).toContainText('THE VANGUARD LANDS — at SHACKLETON RIM');
  expect(await card.evaluate((e) => getComputedStyle(e).borderLeftColor)).toBe('rgb(47, 95, 208)'); // #2f5fd0, the Vanguard's trim
  expect(await card.evaluate((e) => getComputedStyle(e).borderLeftWidth)).toBe('3px');
  // its action opens the RACE panel, showing the Vanguard landed
  await card.locator('[data-rc="open"]').click();
  await expect(page.locator('#race-panel')).toBeVisible();
  await expect(page.locator('#race-panel .rc-row[data-faction="accelerationists"]')).toContainText('landed day 2');
  await expect(page.locator('#race-panel .rc-row[data-faction="accelerationists"] .rc-last')).toContainText('THE VANGUARD LANDS');

  // the feed's other two kinds S1 tells: a rival reaching an era, and a hearing (yours is a warning, a rival's is news); your own era is not news
  await page.evaluate(() => {
    const g = window.__game;
    g.feedPush({ faction: 'accelerationists', kind: 'era', text: 'TEST: THE VANGUARD REACHES ERA 9', era: 9 });
    g.feedPush({ faction: 'robots', kind: 'era', text: 'TEST: THE FOUNDRY REACHES ERA 9 (your own)', era: 9 });
    g.feedPush({ faction: 'accelerationists', kind: 'hearing', text: 'TEST: THE VANGUARD FACES A HEARING' });
    g.feedPush({ faction: 'robots', kind: 'hearing', text: 'TEST: HEARING — a quarter of the crew is recalled' });
    g.advanceGameSeconds(1);
  });
  const log = (await g(page, 'getState')).log.filter((e: any) => e.family === 'race' && /^TEST:|LANDS/.test(e.text));
  expect(log.map((e: any) => `${e.faction}|${e.kind}|${e.text}`)).toEqual([
    'accelerationists|info|THE VANGUARD LANDS — at SHACKLETON RIM',
    'accelerationists|info|TEST: THE VANGUARD REACHES ERA 9',
    'accelerationists|info|TEST: THE VANGUARD FACES A HEARING',
    'robots|warn|TEST: HEARING — a quarter of the crew is recalled',
  ]);
  // the Commons land on day 4
  await page.evaluate(() => window.__game.advanceGameSeconds(1440));
  const commons = (await g(page, 'getState')).log.filter((e: any) => e.family === 'race' && /LANDS/.test(e.text)).pop();
  expect(commons).toMatchObject({ text: 'THE COMMONS LANDS — at MARIUS HILLS TUBE', faction: 'solarpunks' });
});
