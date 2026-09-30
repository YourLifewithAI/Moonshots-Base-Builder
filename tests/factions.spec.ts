/** Factions (docs/20), the DATA half (stream W0d): the faction table, the three landing techs whose effects
 *  carry each faction's traits into the mods, faction-locked tech visibility, the lane and pick cost
 *  multipliers in techCost, the new mods fields' neutral defaults, `?faction=` parsing and the resolveTech
 *  faction override. The traits are read here through the debug API on a SOLO game (completeTech of the
 *  landing tech); the UI half (S1) and the rivals half (S4) extend this file later. Every test pauses the
 *  game and drives nothing forward. */
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
    // S3 fills the unique content and S4 the policy: empty for now, typed and present
    expect(x.uniqueBuildings).toEqual([]);
    expect(x.uniqueTechs).toEqual([]);
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
