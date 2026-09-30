/** Faction traits in the sim (docs/20, stream S2): what the W0d mods fields DO. The Foundry's night (stations and hub
 *  units at ×0.25, the bank's ×1.25 discharge) and its flares (arrays ×1.6, machines ×1.75), the Vanguard's morale fall
 *  and scrutiny meter (+40 a death, +15 a hazard, 50 and 80, HEARINGS recalling a quarter of the crew through the
 *  rotation), the Commons' rates, and the small effects of the faction buildings (Faraday Shed, Night Vault, Mission
 *  Ops, Skunkworks: S3 defines the buildings, so those are read here through stand-in states by id string). Two bases
 *  are compared with the same seed and the same script, one solo and one carrying the landing tech whose effects are
 *  the trait (as tests/factions.spec.ts does), or a real faction game where the Moon matters. Every test pauses the
 *  game and drives time with advanceGameSeconds. */
import { test, expect as baseExpect, type Page } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 20_000 });

declare global {
  interface Window { __game?: any; fx?: any }
}

/** a fresh page on the debug API; every test starts its own game */
async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?debug&seed=42');
  await page.waitForFunction(() => window.__game !== undefined);
  return errors;
}

/** in-page helpers: a cell search outward from the Lander, arrays side by side, the flare run to its end, the machine draw */
const HELPERS = `(() => {
  const g = window.__game;
  const ring = function* (r) {
    const c = 127;
    for (let i = -r; i <= r; i++) { yield [c + i, c - r]; yield [c + i, c + r]; }
    for (let i = -r + 1; i <= r - 1; i++) { yield [c - r, c + i]; yield [c + r, c + i]; }
  };
  window.fx = {
    /** one of a type near the Lander from ring r0, finished or not; its id (-1: no room) */
    place(type, r0 = 3, finish = true) {
      g.grantResources({ metals: 400, parts: 200, silicon: 200, chips: 60 });
      for (let r = r0; r < 60; r++) for (const [gx, gz] of ring(r)) {
        if (g.canPlace(type, gx, gz, 0).valid && g.placeBuilding(type, gx, gz, 0)) {
          if (finish) g.finishConstruction();
          const s = g.getState(); return s.buildings[s.buildings.length - 1].id;
        }
      }
      return -1;
    },
    /** n Solar Arrays touching in a row (one field), finished; their ids */
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
    b: (id) => g.getState().buildings.find((x) => x.id === id),
    rover: (id) => g.getState().rovers.find((r) => r.id === id),
    flare: () => g.getState().flare,
    /** run the flare in flight to its end (and 1 s beyond) */
    finish() { for (let i = 0; i < 900 && g.getState().flare.phase !== 'idle'; i++) g.advanceGameSeconds(1); g.advanceGameSeconds(1); },
    /** advance to t s before the protons */
    toProtons(t = 0) { const f = g.getState().flare; g.advanceGameSeconds(Math.max(0, Math.round(f.timer - t))); },
    mulberry32(seed) {
      let a = seed >>> 0;
      return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    },
    /** a machine's seeded draw at flare index n (docs/16 §4.5) */
    draw(n, key) { return window.fx.mulberry32((g.getState().seed ^ 0x5f1e) + n * 4096 + key)(); },
  };
})()`;

// ───────────────────────────────── M1 · The Foundry ─────────────────────────────────

test('night: a Foundry base runs its lab and its hub units at ×0.25 at night and not by day, its generators and bank not scaled, its draw ×1.3; a solo base is untouched', async ({ page }) => {
  test.setTimeout(240_000);
  await boot(page);
  const run = (tech: string) => page.evaluate(async ([tech, helpers]) => {
    const g = window.__game;
    g.selectSite('mare', 'robotic');
    g.setPaused(true); g.holdHazards(true); g.openRoads(true); g.instantTravel(true);
    if (tech) g.completeTech(tech);
    g.advanceGameSeconds(0);
    (0, eval)(helpers);
    g.grantResources({ metals: 3000, parts: 2000, silicon: 500, chips: 200 });
    g.grantPower(400000);
    window.fx.place('lab');
    // a Regolith Smelter by the guaranteed ilmenite: its first excavator digs the pit
    const z = g.getZones().find((q: any) => q.kind === 'ilmenite');
    const l = Math.hypot(z.cx, z.cz) || 1, out = z.r + 22;
    const cx = Math.round((z.cx - (z.cx / l) * out + 512) / 4) - 1, cz = Math.round((z.cz - (z.cz / l) * out + 512) / 4) - 1;
    let hub = -1;
    for (let r = 0; r <= 10 && hub < 0; r++) for (let dx = -r; dx <= r && hub < 0; dx++) for (let dz = -r; dz <= r && hub < 0; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      for (const rot of [0, 1, 2, 3]) if (hub < 0 && g.placeBuilding('smelter', cx + dx, cz + dz, rot)) hub = g.getState().buildings.find((b: any) => b.type === 'smelter').id;
    }
    g.finishConstruction();
    const read = () => {
      const s = g.getState();
      const dug = s.stats.produced.regolith + s.haulers.reduce((n: number, u: any) => n + (u.haul.cargo.regolith ?? 0), 0);
      return { data: s.data, stored: s.powerStored, dug, t: s.simTime, power: s.power };
    };
    // the same 120 s of DAY, then of NIGHT (every unit is where it was at dusk for both bases: same script, same seed)
    const nightAt = () => { const s = g.getState(); return (s.simTime % 720) >= 480; };
    const day0 = read(); g.advanceGameSeconds(120); const day1 = read();
    while (!nightAt()) g.advanceGameSeconds(5);
    g.advanceGameSeconds(10);
    const n0 = read();
    // the bank, tick by tick: stored' = stored − (served − supply) × discharge while the load outruns the supply
    const ledger: { net: number; dStored: number }[] = [];
    let prev = read();
    for (let i = 0; i < 30; i++) {
      g.advanceGameSeconds(1);
      const cur = read();
      ledger.push({ net: prev.power.supply - cur.power.served, dStored: cur.stored - prev.stored });
      prev = cur;
    }
    g.advanceGameSeconds(60);
    const n1 = read();
    const mods = g.getMods();
    const mod = await (async () => {
      const M = await import('/src/core/mods.ts');
      const S = await import('/src/data/sites.ts');
      const m = M.computeMods(g.getState().techsDone, 'robotic', 'mare', [], g.getState().faction);
      const site = S.SITES.mare;
      const rt = (t: string, night: boolean) => M.effectiveRates(t, m, site, undefined, { agentRun: true, robotic: true, isNight: night });
      return {
        solarDay: rt('solar', false).powerKW, solarNight: rt('solar', true).powerKW,
        reactorDay: rt('reactor', false).powerKW, reactorNight: rt('reactor', true).powerKW,
        landerDay: rt('lander', false).powerKW, landerNight: rt('lander', true).powerKW,
        smelterDayOut: rt('smelter', false).outputs.metals, smelterNightOut: rt('smelter', true).outputs.metals,
        smelterDayIn: rt('smelter', false).inputs.regolith, smelterNightIn: rt('smelter', true).inputs.regolith,
        smelterDayKW: rt('smelter', false).powerKW, smelterNightKW: rt('smelter', true).powerKW,
        labDayData: rt('lab', false).data, labNightData: rt('lab', true).data,
        noClock: rt('lab', false).data,
      };
    })();
    return {
      mods: { o: mods.nightOutputMult, d: mods.nightDrawMult, e: mods.storageEff, b: mods.bankDischargeMult },
      dayData: day1.data - day0.data, dayDug: day1.dug - day0.dug,
      nightData: n1.data - n0.data, nightDug: n1.dug - n0.dug,
      ledger, mod, hub,
    };
  }, [tech, HELPERS] as const);
  const solo = await run('');
  const foundry = await run('landingFoundry');
  // the mods: the trait's numbers; a solo base's are neutral
  expect(solo.mods).toEqual({ o: 1, d: 1, e: 0.85, b: 1 });
  expect(foundry.mods).toEqual({ o: 0.25, d: 1.3, e: 0.75, b: 1.25 });
  // by day the two bases are the same base
  expect(foundry.dayData).toBeCloseTo(solo.dayData, 6);
  expect(foundry.dayDug).toBeCloseTo(solo.dayDug, 6);
  expect(solo.dayData).toBeGreaterThan(5);
  // at night a lab and a hub's units make a quarter of what a solo base's do (same seconds, same ground, same trips)
  expect(solo.nightData).toBeGreaterThan(5);
  expect(foundry.nightData / solo.nightData).toBeCloseTo(0.25, 6);
  expect(solo.nightDug).toBeGreaterThan(20);
  expect(foundry.nightDug / solo.nightDug).toBeGreaterThan(0.2);
  expect(foundry.nightDug / solo.nightDug).toBeLessThan(0.3);
  // the function under it: outputs, inputs and data × 0.25 at night for a station that is not a generator; draw ×1.3 (nightDrawMult)
  expect(foundry.mod.smelterNightOut / foundry.mod.smelterDayOut).toBeCloseTo(0.25, 9);
  expect(foundry.mod.smelterNightIn / foundry.mod.smelterDayIn).toBeCloseTo(0.25, 9);
  expect(foundry.mod.labNightData / foundry.mod.labDayData).toBeCloseTo(0.25, 9);
  expect(foundry.mod.smelterNightKW / foundry.mod.smelterDayKW).toBeCloseTo(1.3, 9);
  expect(solo.mod.smelterNightOut).toBe(solo.mod.smelterDayOut);
  expect(solo.mod.labNightData).toBe(solo.mod.labDayData);
  // generation and storage are not scaled (and a caller that does not say it is night sees nameplate)
  for (const b of [solo, foundry]) {
    expect(b.mod.solarNight).toBe(b.mod.solarDay);
    expect(b.mod.reactorNight).toBe(b.mod.reactorDay);
    expect(b.mod.landerNight).toBe(b.mod.landerDay);
    expect(b.mod.noClock).toBe(b.mod.labDayData);
  }
  // the bank: a load that outruns the supply drains the bank net × discharge (×1.25 for the Foundry, ×1 otherwise)
  for (const [b, k] of [[solo, 1], [foundry, 1.25]] as const) {
    const drawing = b.ledger.filter((l: any) => l.net < -1e-6);
    expect(drawing.length, 'the load outruns the supply at night').toBeGreaterThan(20);
    for (const l of drawing) expect(l.dStored).toBeCloseTo(l.net * k, 6);
  }
});

test('flares: a Foundry array takes ×1.6 (stowed damage, scars, losses) and its machines are more often hit; a solo base keeps the old odds', async ({ page }) => {
  test.setTimeout(240_000);
  await boot(page);
  const run = (tech: string) => page.evaluate(async ([tech, helpers]) => {
    const g = window.__game;
    // each scenario on a fresh base (the same seed, so the same flare index and the same ids)
    const again = () => {
      g.selectSite('mare', 'robotic');
      g.setPaused(true); g.holdHazards(true); g.openRoads(true); g.instantTravel(true);
      if (tech) g.completeTech(tech);
      g.advanceGameSeconds(0);
      (0, eval)(helpers);
      g.grantPower(20000);
      return window.fx;
    };
    let fx = again();
    // 1 · an X on a field of three STOWED arrays: −20 % of a solo array, ×1.6 of it on a Foundry's
    const a = fx.field(3);
    g.forceFlare('X', { drill: false });
    g.advanceGameSeconds(2);
    g.flareChoice({ mode: 'stow' }, { repair: false });
    const pvStow = g.flarePreview({ mode: 'stow' });
    fx.finish();
    const stowed = a.map((id: number) => fx.b(id).flareDmg ?? 0);
    // 2 · an M on three RUNNING: the expected loss is round(3 × 0.15 × hard); the survivors scar
    fx = again();
    const b = fx.field(3);
    g.forceFlare('M', { drill: false });
    g.advanceGameSeconds(2);
    g.flareChoice({ mode: 'run' }, { repair: false });
    const pvRun = g.flarePreview({ mode: 'run' });
    fx.finish();
    const wrecks = b.filter((id: number) => fx.b(id).wreck).length;
    const caps = b.filter((id: number) => !fx.b(id).wreck).map((id: number) => fx.b(id).cap ?? 1);
    fx = again();
    // 3 · machines at an X: a rover in the open whose seeded draw lies between the two burn odds (15 % and 26 %), and a docked
    // one between the two reboot odds (20 % and 35 %): a solo base latches the first and spares the second
    const rovers = g.getState().rovers.map((r: any) => r.id).sort((x: number, y: number) => x - y);
    const [open, docked] = rovers; // the first site takes the first rover
    let k = -1;
    for (let i = 3; i < 6000 && k < 0; i++) {
      const u = fx.draw(i, open), w = fx.draw(i, docked);
      if (u >= 0.16 && u <= 0.25 && w >= 0.22 && w <= 0.33) k = i;
    }
    g.setFlareIndex(k);
    g.forceFlare('X', { drill: false });
    fx.toProtons(3);
    fx.place('lab', 7, false); // (a site once the warning is up: the rovers stay out for it)
    g.advanceGameSeconds(1);
    const out = g.getState().rovers.filter((r: any) => r.site !== null).map((r: any) => r.id);
    g.advanceGameSeconds(3);
    const now = g.getState().simTime;
    const o = fx.rover(open), d = fx.rover(docked);
    const machines = {
      k, out, open: o ? { latched: !!o.latch, rebootUntil: o.rebootUntil ?? 0 } : 'lost',
      docked: d ? { latched: !!d.latch, reboot: (d.rebootUntil ?? 0) > now } : 'lost',
      lost: g.getState().losses.filter((l: any) => l.hazard === 'flare' && l.what === 'rover').length,
    };
    fx.finish();
    const mods = g.getMods();
    return {
      mods: { arrayHard: mods.arrayHardMult, machine: mods.machineFlareMult },
      stowed, pvStow: pvStow.dmgPct, pvRun: { destroyed: pvRun.destroyed, scar: pvRun.scarPct }, wrecks, caps, machines,
    };
  }, [tech, HELPERS] as const);
  const solo = await run('');
  const foundry = await run('landingFoundry');
  expect(solo.mods).toEqual({ arrayHard: 1, machine: 1 });
  expect(foundry.mods).toEqual({ arrayHard: 1.6, machine: 1.75 });
  // stowed damage: X 15 % + its tail 5 % = 20 %, ×1.6 = 32 %
  for (const d of solo.stowed) expect(d).toBeCloseTo(0.2, 5);
  for (const d of foundry.stowed) expect(d).toBeCloseTo(0.32, 5);
  expect(solo.pvStow).toBe(20);
  expect(foundry.pvStow).toBe(32);
  // running through an M: destroy 15 % (round(3 × 0.15) = 0 of three; ×1.6: round(0.72) = 1), scar 2 % (×1.6 = 3.2 %) on the survivors
  expect(solo.pvRun.destroyed).toBe(0);
  expect(foundry.pvRun.destroyed).toBe(1);
  expect(solo.wrecks).toBe(0);
  expect(foundry.wrecks).toBe(1);
  expect(solo.pvRun.scar).toBeCloseTo(2, 5);
  expect(foundry.pvRun.scar).toBeCloseTo(3.2, 5);
  for (const c of solo.caps) expect(c).toBeCloseTo(1 - 0.02, 5);
  for (const c of foundry.caps) expect(c).toBeCloseTo(1 - 0.032, 5);
  // the machines: the same two draws; the open rover latches on a solo base and burns out on a Foundry's (×1.75),
  // the docked one is spared and then rebooted
  expect(solo.machines.k).toBe(foundry.machines.k);
  expect(solo.machines.out).toEqual([1]);
  expect(foundry.machines.out).toEqual([1]);
  expect(solo.machines.open).toMatchObject({ latched: true });
  expect(solo.machines.docked).toEqual({ latched: false, reboot: false });
  expect(solo.machines.lost).toBe(0);
  expect(foundry.machines.open).toBe('lost');
  expect(foundry.machines.lost).toBe(1);
  expect(foundry.machines.docked).toEqual({ latched: false, reboot: true });
});

// ───────────────────────────────── M2 · The Vanguard ─────────────────────────────────

test('morale: the Vanguard’s morale falls ×2 as fast toward the same target and rises at the old speed; the base is −8', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);
  const run = (tech: string) => page.evaluate(async ([tech, helpers]) => {
    const g = window.__game;
    g.selectSite('southpole', 'human');
    g.setPaused(true); g.holdHazards(true);
    if (tech) g.completeTech(tech);
    g.advanceGameSeconds(0);
    (0, eval)(helpers);
    const m = () => g.getState().morale;
    const m0 = m();
    g.grantCrew(3); // ten aboard, eight beds: overcrowding (−20) pulls the target under morale
    g.advanceGameSeconds(1);
    const m1 = m();
    g.grantCrew(-3);
    g.advanceGameSeconds(1);
    const m2 = m();
    return { m0, m1, m2, mods: g.getMods() };
  }, [tech, HELPERS] as const);
  const solo = await run('');
  const van = await run('landingVanguard');
  expect(solo.mods.moraleFallMult).toBe(1);
  expect(van.mods.moraleFallMult).toBe(2);
  expect(van.mods.moraleBase).toBe(-8);
  expect(van.m0).toBe(solo.m0);
  // a solo base: the lerp (0.05) toward the target; overcrowding pulls the target under morale
  const lerp = 0.05;
  const Tdark = solo.m0 + (solo.m1 - solo.m0) / lerp;
  expect(solo.m1).toBeLessThan(solo.m0);
  const Tok = solo.m1 + (solo.m2 - solo.m1) / lerp;
  // the Vanguard: target −8, and a fall is ×2 (the clamp aside)
  const fall = (from: number, target: number) => (target < from ? Math.max(target, from + (target - from) * lerp * 2) : from + (target - from) * lerp);
  expect(van.m1).toBeCloseTo(fall(van.m0, Tdark - 8), 6);
  expect(van.m1).toBeLessThan(van.m0);
  expect(van.m0 - van.m1).toBeGreaterThan((solo.m0 - solo.m1) * 1.8); // twice the step toward a lower target, and it is lower
  expect(van.m2).toBeCloseTo(fall(van.m1, Tok - 8), 6);
});

test('scrutiny: a death +40, a hazard +15 (non-drill), ≥ 50 cuts crewed output ×0.7 and research ×0.8, a second death reaches 80 and HEARINGS recalls a quarter of the crew for two days (feed, alert), the meter drops to 40 then decays, and one hearing in three days at most', async ({ page }) => {
  test.setTimeout(300_000);
  await boot(page);
  const r = await page.evaluate(async (helpers) => {
    const g = window.__game;
    g.selectFaction('accelerationists', 'southpole');
    g.setPaused(true); g.holdHazards(true); g.openRoads(true); g.instantTravel(true);
    g.advanceGameSeconds(1);
    (0, eval)(helpers);
    const fx = window.fx;
    const sc = () => g.getScrutiny();
    const out: any = {};
    out.start = { crew: g.getState().crew, sc: sc(), faction: g.getState().faction, mods: g.getMods().scrutiny };
    // a crewed farm and a lab, fed and powered
    g.grantResources({ metals: 400, parts: 200, water: 800, food: 400, oxygen: 600 });
    g.grantPower(20000);
    fx.place('hydroponics', 3); fx.place('lab', 5);
    g.advanceGameSeconds(10);
    const probe = () => {
      const a = g.getState();
      g.advanceGameSeconds(1);
      const b = g.getState();
      return { food: b.stats.produced.food - a.stats.produced.food, data: b.data - a.data, morale: b.morale };
    };
    out.base = probe();
    // a death: +40, and under the penalty's 50
    g.killCrew(1);
    out.death = { value: sc().state.value, crew: g.getState().crew, log: sc().state.log.map((e: any) => e.text) };
    g.advanceGameSeconds(1);
    out.below = probe();
    out.belowValue = sc().state.value;
    // a hazard striking (an event kind): +15 → 55, over 50
    const h = g.forceHazard('cascade', undefined, { drill: false });
    out.hazard = { id: typeof h, value: sc().state.value };
    out.over = probe();
    out.warn = g.getState().alerts.some((a: any) => /^SCRUTINY 5\d — /.test(a.text) && a.family === 'hazard');
    // a drill is no accident
    const before = sc().state.value;
    g.forceHazard('breach', undefined, { drill: true });
    out.drill = sc().state.value - before;
    // a second death: 55 + 40 → HEARINGS on the next tick
    g.killCrew(1);
    out.preHearing = { value: sc().state.value, crew: g.getState().crew };
    g.advanceGameSeconds(1);
    const s1 = g.getState();
    out.hearing = {
      crew: s1.crew, rotation: s1.crewRotation, value: sc().state.value, tier: sc().state.tier, last: sc().state.lastHearingAt, until: sc().state.hearingsUntil,
      now: s1.simTime, view: sc().view,
      alert: s1.alerts.find((a: any) => /^HEARINGS — /.test(a.text)),
      warn80: s1.alerts.some((a: any) => /^SCRUTINY \d+ — THE VANGUARD IS CALLED/.test(a.text)),
      feed: g.getMoon().feed.filter((e: any) => e.kind === 'hearing'),
    };
    // two days away: the crew is back on the second, through the rotation; the meter falls 5 a day
    g.advanceGameSeconds(1438);
    out.away = { crew: g.getState().crew, rotation: g.getState().crewRotation };
    g.advanceGameSeconds(2);
    const s2 = g.getState();
    out.back = { crew: s2.crew, rotation: s2.crewRotation, value: sc().state.value, alert: s2.alerts.some((a: any) => /^THE RECALLED CREW RETURN/.test(a.text)) };
    // at most one hearing in three days: over 80 again at once, nothing happens until the third day is out
    g.addScrutiny(100);
    g.advanceGameSeconds(60);
    out.second = { crew: g.getState().crew, hearings: g.getMoon().feed.filter((e: any) => e.kind === 'hearing').length, value: sc().state.value,
      held: g.getState().alerts.some((a: any) => /but the last hearing was under 3 days ago/.test(a.text)) };
    const left = sc().state.lastHearingAt + 3 * 720 - g.getState().simTime;
    g.advanceGameSeconds(Math.floor(left) - 5);
    out.third = { hearings: g.getMoon().feed.filter((e: any) => e.kind === 'hearing').length, crew: g.getState().crew };
    g.advanceGameSeconds(10);
    out.fourth = { hearings: g.getMoon().feed.filter((e: any) => e.kind === 'hearing').length, crew: g.getState().crew, rotation: g.getState().crewRotation };
    return out;
  }, HELPERS);
  expect(r.start.faction).toBe('accelerationists');
  expect(r.start.mods).toBe(true);
  expect(r.start.crew).toBe(7);
  expect(r.start.sc.state.value).toBeCloseTo(0, 3);
  // +40 for a death, in killCrew
  expect(r.death.value).toBeCloseTo(40, 3);
  expect(r.death.crew).toBe(6);
  expect(r.death.log).toContain('a crew death');
  // under 50 nothing is cut: one second of the crewed farm and of the lab before and after the death (morale aside: ±1 %)
  expect(r.below.food / r.base.food).toBeGreaterThan(0.7);
  expect(r.below.data / r.base.data).toBeGreaterThan(0.75);
  expect(r.base.food).toBeGreaterThan(0.05);
  expect(r.base.data).toBeGreaterThan(0.1);
  // a hazard: +15 (a drill +0) → 55: crewed outputs ×0.7, research ×0.8 (one second later; morale moves ≤ 1 %)
  expect(r.hazard.id).toBe('number');
  expect(r.hazard.value).toBeGreaterThan(54.8);
  expect(r.hazard.value).toBeLessThanOrEqual(55);
  expect(r.over.food / r.below.food).toBeGreaterThan(0.68);
  expect(r.over.food / r.below.food).toBeLessThan(0.72);
  expect(r.over.data / r.below.data).toBeGreaterThan(0.78);
  expect(r.over.data / r.below.data).toBeLessThan(0.82);
  expect(r.warn).toBe(true);
  expect(r.drill).toBe(0);
  // the second death takes it to ~95: HEARINGS on the next tick
  expect(r.preHearing.value).toBeGreaterThan(94.5);
  expect(r.preHearing.crew).toBe(5);
  expect(r.hearing.value).toBeGreaterThan(39.9);
  expect(r.hearing.value).toBeLessThanOrEqual(40);
  expect(r.hearing.crew).toBe(3);                         // a quarter of 5, rounded up: 2 recalled
  expect(r.hearing.rotation).toEqual({ at: r.hearing.now + 1440, count: 2, recall: true });
  expect(r.hearing.until).toBe(r.hearing.rotation.at);
  expect(r.hearing.last).toBe(r.hearing.now);
  expect(r.hearing.tier).toBe(0);
  expect(r.hearing.view.recalled).toBe(2);
  expect(r.hearing.alert.text).toMatch(/^HEARINGS — THE VANGUARD BEFORE CONGRESS: 2 crew members recalled to Earth for 2 lunar days · scrutiny back to 40$/);
  expect(r.hearing.alert.family).toBe('hazard');
  expect(r.hearing.warn80).toBe(true);
  expect(r.hearing.feed).toHaveLength(1);
  expect(r.hearing.feed[0]).toMatchObject({ faction: 'accelerationists', kind: 'hearing', text: 'THE VANGUARD BEFORE CONGRESS — a quarter of the crew recalled', n: 2 });
  // away for two days, then back through the rotation machinery; the meter has fallen 5 a day (40 → 30)
  expect(r.away.crew).toBe(3);
  expect(r.away.rotation).toMatchObject({ count: 2, recall: true });
  expect(r.back.crew).toBe(5);
  expect(r.back.rotation).toBeNull();
  expect(r.back.alert).toBe(true);
  expect(r.back.value).toBeGreaterThan(29.8);
  expect(r.back.value).toBeLessThan(30.2);
  // a second hearing waits three days after the first
  expect(r.second.hearings).toBe(1);
  expect(r.second.crew).toBe(5);
  expect(r.second.held).toBe(true);
  expect(r.third.hearings).toBe(1);
  expect(r.third.crew).toBe(5);
  expect(r.fourth.hearings).toBe(2);
  expect(r.fourth.crew).toBe(3);
  expect(r.fourth.rotation).toMatchObject({ count: 2, recall: true });
});

// ───────────────────────────────── M3 · Commons, buildings, panel, solo ─────────────────────────────────

test('Commons and Vanguard rates: hazard interval ×1/0.6 and ×1/1.25, the safety guard, growth ×1.25, morale base +10 and −8', async ({ page }) => {
  test.setTimeout(240_000);
  await boot(page);
  const run = (kind: 'solo' | 'solarpunks' | 'accelerationists') => page.evaluate(async ([kind, helpers]) => {
    const g = window.__game;
    if (kind === 'solo') g.selectSite('lavatube', 'human'); else g.selectFaction(kind, 'lavatube');
    g.setPaused(true); g.holdHazards(true);
    g.advanceGameSeconds(0);
    (0, eval)(helpers);
    const H = await import('/src/core/hazards.ts');
    const D = await import('/src/data/hazards.ts');
    const B = await import('/src/data/balance.ts');
    const mods = g.getMods();
    const s = g.getState();
    // the hazard scheduler's interval at window 3, at this base's rate multiplier and at a neutral one
    const interval = (mult: number) => H.windowInterval(s, { hazardRateMult: mult }, 3) / 720;
    const era = Math.min(8, Math.max(3, s.era));
    const jitter = (window.fx.mulberry32((s.seed ^ 0x4a2d) + 3)() - 0.5) * 2 * D.HZ.jitterDays;
    const tele = (guards: string[]) => H.telegraphS({ guards: new Set(guards) }, 'breach', 1, false);
    // morale after 150 s, and the first settler's arrival, of the same base
    const m0 = s.morale, crew0 = s.crew;
    g.grantResources({ oxygen: 600, food: 600, water: 600 }); // (once: a grant over a tank's cap is vented and muddies the flow the boarding check reads)
    g.advanceGameSeconds(150);
    const m1 = g.getState().morale;
    // the first settler's arrival (a bed is free; the larder's smoothed rates settle first): seconds from now
    let arrival = -1;
    for (let i = 1; i <= 120 && arrival < 0; i++) {
      g.advanceGameSeconds(10);
      if (g.getState().crew > crew0) arrival = i * 10;
    }
    return {
      mods: { rate: mods.hazardRateMult, guards: mods.guards, growth: mods.growthMult, moraleBase: mods.moraleBase },
      own: interval(mods.hazardRateMult), neutral: interval(1), jitter, era,
      tele: { own: tele(mods.guards), none: tele([]) }, safetyMult: D.HZ.safetyMult,
      m0, m1, crew0, arrival, period: B.CREW.growthPeriod, housing: g.getState().housingActive,
    };
  }, [kind, HELPERS] as const);
  const solo = await run('solo');
  const commons = await run('solarpunks');
  const vanguard = await run('accelerationists');
  expect(solo.mods).toMatchObject({ rate: 1, growth: 1, moraleBase: 0 });
  expect(solo.mods.guards).not.toContain('safety');
  // Commons: rate ×0.6, the safety guard from landing, growth ×1.25 (a period × 0.8), morale base +10
  expect(commons.mods.rate).toBeCloseTo(0.6, 9);
  expect(commons.mods.guards).toContain('safety');
  expect(commons.mods.growth).toBeCloseTo(0.8, 9);
  expect(commons.mods.moraleBase).toBe(10);
  expect(vanguard.mods.rate).toBeCloseTo(1.25, 9);
  expect(vanguard.mods.moraleBase).toBe(-8);
  expect(vanguard.mods.guards).not.toContain('safety');
  // the scheduler: the interval's base part (the jitter is added after the rate) is ×1/0.6 and ×1/1.25 of a neutral one
  for (const [b, k] of [[commons, 1 / 0.6], [vanguard, 1 / 1.25]] as const) {
    expect((b.own - b.jitter) / (b.neutral - b.jitter)).toBeCloseTo(k, 6);
  }
  expect(solo.own).toBe(solo.neutral);
  // warnings: the safety guard lengthens a colony hazard's telegraph
  expect(commons.tele.own).toBe(Math.round(commons.tele.none * commons.safetyMult));
  expect(commons.tele.own).toBeGreaterThan(commons.tele.none);
  expect(solo.tele.own).toBe(solo.tele.none);
  // morale: +10 and −8 on the target, the same lerp: after 150 s the gap is the base × (1 − 0.95^150)
  const close = 1 - Math.pow(0.95, 150);
  expect(commons.m0).toBe(solo.m0);
  expect(commons.m1 - solo.m1).toBeCloseTo(10 * close, 1);
  expect(vanguard.m1 - solo.m1).toBeCloseTo(-8 * close, 1);
  // growth: one settler a lunar day (720 s), a Commons base one every 576 (×1.25): its next bed is filled before a solo base's
  expect(solo.arrival).toBeGreaterThan(0);
  expect(commons.arrival).toBeGreaterThan(0);
  expect(solo.arrival - commons.arrival).toBeGreaterThanOrEqual(130); // 720 − 576 = 144 s (10 s steps)
  expect(solo.arrival - commons.arrival).toBeLessThanOrEqual(160);
  expect(vanguard.arrival).toBeGreaterThan(0);
});

test('the faction buildings’ effects, read by id string: Mission Ops (decay ×2, a lab more at full uplink), Skunkworks (+0.25 a building, capped at +0.5), Faraday Shed (×0.4 within 40 m), Night Vault (docked units hibernate)', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);
  const r = await page.evaluate(async (helpers) => {
    const g = window.__game;
    g.selectFaction('accelerationists', 'southpole');
    g.setPaused(true); g.holdHazards(true);
    g.advanceGameSeconds(1);
    (0, eval)(helpers);
    const Sc = await import('/src/core/scrutiny.ts');
    const R = await import('/src/core/research.ts');
    const H = await import('/src/core/hazards.ts');
    const Fe = await import('/src/core/flareEffects.ts');
    const U = await import('/src/core/unitPower.ts');
    const M = await import('/src/core/mods.ts');
    const Bd = await import('/src/data/buildings.ts');
    const S = await import('/src/data/sites.ts');
    // S3's buildings may not exist on this branch: a stand-in def (a storage yard's footprint) lets centerOf place them
    const added: string[] = [];
    for (const t of ['faradayShed', 'nightVault', 'missionOps', 'skunkworks']) if (!(t in Bd.BUILDINGS)) { (Bd.BUILDINGS as any)[t] = Bd.BUILDINGS.storageYard; added.push(t); }
    const base = g.getState();
    const withB = (types: { type: string; gx: number; gz: number }[], over: any = {}) => {
      const s = JSON.parse(JSON.stringify(base));
      Object.assign(s, over);
      let id = 9000;
      for (const t of types) s.buildings.push({ id: id++, type: t.type, gx: t.gx, gz: t.gz, rot: 0, enabled: true, automated: false, priority: 2, wear: 0, dust: 0, construction: 0, buildTotal: 0, active: true, idleReason: '' });
      return s;
    };
    const mods = M.modsFor(base);
    const out: any = { added };
    // Mission Ops: the decay ×2 and a lab at full weight
    out.decay = { none: Sc.decayPerSecond(withB([])) * 720, ops: Sc.decayPerSecond(withB([{ type: 'missionOps', gx: 200, gz: 200 }])) * 720 };
    const tick = (s: any, secs: number) => { s.scrutiny = { value: 60, tier: 1, hearingsUntil: 0, lastHearingAt: -1e9, log: [] }; for (let i = 0; i < secs; i++) { s.simTime += 1; Sc.scrutinyTick(s, mods, 1); } return s.scrutiny.value; };
    out.afterDay = { none: tick(withB([]), 720), ops: tick(withB([{ type: 'missionOps', gx: 200, gz: 200 }]), 720) };
    out.uplink = { solo: R.uplinkShare(5), ops: R.uplinkShare(5, Sc.uplinkBonus(withB([{ type: 'missionOps', gx: 200, gz: 200 }]))), one: R.uplinkShare(1, 1), six: [R.uplinkShare(6), R.uplinkShare(6, 1)],
      bonus: [Sc.uplinkBonus(withB([])), Sc.uplinkBonus(withB([{ type: 'missionOps', gx: 200, gz: 200 }]))] };
    // an unfinished Mission Ops does not stand
    const site = withB([{ type: 'missionOps', gx: 200, gz: 200 }]);
    site.buildings[site.buildings.length - 1].construction = 30;
    out.unfinished = Sc.countOf(site, 'missionOps');
    // Skunkworks: +0.25 a standing building on the hazard-event rate (capped +0.5); the scheduler's interval follows it
    const sk = (n: number) => H.skunkworksRate(withB(Array.from({ length: n }, (_, i) => ({ type: 'skunkworks', gx: 210 + 4 * i, gz: 200 }))));
    out.skunk = [0, 1, 2, 3].map(sk);
    const D = await import('/src/data/hazards.ts');
    const jitter = (window.fx.mulberry32((base.seed ^ 0x4a2d) + 3)() - 0.5) * 2 * D.HZ.jitterDays;
    // (the same number of buildings both ways: the interval's size term counts them)
    const basePart = (s: any) => H.windowInterval(s, { hazardRateMult: 1 }, 3) / 720 - jitter;
    out.windowBase = [basePart(withB([{ type: 'storageYard', gx: 200, gz: 200 }])), basePart(withB([{ type: 'skunkworks', gx: 200, gz: 200 }]))];
    // Faraday Shed: ×0.4 within 40 m of the shed's centre, 1 beyond; none standing: no cover at all
    const shed = withB([{ type: 'faradayShed', gx: 100, gz: 100 }]);
    const cover = Sc.shedCover(shed);
    const [cx, cz] = (await import('/src/buildings/instances.ts')).centerOf(shed.buildings[shed.buildings.length - 1]);
    out.shed = { none: Sc.shedCover(withB([])), near: cover!(cx + 39, cz), far: cover!(cx + 41, cz), at: cover!(cx, cz) };
    // machines at an M (an open rover reboots at 40 %): under a shed the odds are ×0.4, on a Foundry ×1.75 more. A draw between
    // 0.3 and 0.38 reboots it on a plain solo base and on a plain Foundry, and spares it under a shed on either (0.16 and 0.28)
    const found = M.computeMods(['landingFoundry'], 'robotic', 'mare', [], 'robots');
    const rid = base.rovers[0].id;
    let n = -1;
    for (let i = 3; i < 6000 && n < 0; i++) { const u = window.fx.draw(i, rid); if (u > 0.3 && u < 0.38) n = i; }
    const flareState = (extra: any[], cls = 'M') => {
      const s = withB(extra);
      s.flare = { ...s.flare, phase: 'active', cls, n, activeAt: s.simTime, drawn: true, drill: false, tally: { rebooted: 0, latched: 0, lost: 0 } };
      s.rovers = s.rovers.slice(0, 1);
      s.haulers = [];
      s.rovers[0].x = cx; s.rovers[0].z = cz; s.rovers[0].site = 1; // in the open, under the shed
      delete s.rovers[0].rebootUntil;
      return s;
    };
    const sp = S.SITES.southpole;
    const rebooted = (extra: any[], m: any) => { const s = flareState(extra); Fe.drawMachines(s, sp, m, 'flash'); return (s.rovers[0].rebootUntil ?? 0) > s.simTime; };
    const SHED = [{ type: 'faradayShed', gx: 100, gz: 100 }];
    out.machines = { n, plain: rebooted([], mods), foundry: rebooted([], found), soloShed: rebooted(SHED, mods), foundryShed: rebooted(SHED, found) };
    // a huge multiplier clamps each odds at 1: an open rover at an X burns out
    const big = { ...found, machineFlareMult: 100 };
    out.clamp = (() => { const s = flareState([], 'X'); Fe.drawMachines(s, sp, big, 'flash'); return s.rovers.length === 0; })();
    // Night Vault
    out.vault = { none: Sc.nightVaultStanding(withB([])), stands: Sc.nightVaultStanding(withB([{ type: 'nightVault', gx: 200, gz: 200 }])) };
    const pu = (kind: string, phase?: string) => ({ kind, pack: { phase } } as any);
    out.hib = { rover: U.hibernating(pu('rover')), drone: U.hibernating(pu('drone')), parked: U.hibernating(pu('hauler', 'park')), digging: U.hibernating(pu('hauler', 'dig')), pad: U.hibernating(pu('digger', 'dig')) };
    const pk = (slow: boolean) => {
      const t = new U.PackTick({ packMult: 1, unitDriveMult: 1, chargeEff: 1, rpu: false }, 1);
      const pack: any = { charge: 0.1 };
      const u: any = { kind: 'rover', unit: pack, pack };
      if (slow) t.hibernate(u, 0.5);
      t.finish([u], new Set([U.unitKey(u)]));
      return pack.charge;
    };
    out.charge = { awake: pk(false) - 0.1, asleep: pk(true) - 0.1 };
    for (const t of added) delete (Bd.BUILDINGS as any)[t];
    return out;
  }, HELPERS);
  expect(r.decay.ops).toBeCloseTo(r.decay.none * 2, 9);
  expect(r.decay.none).toBeCloseTo(5, 9); // 5 points a lunar day
  expect(r.afterDay.none).toBeCloseTo(55, 6);
  expect(r.afterDay.ops).toBeCloseTo(50, 6);
  // one more lab at full weight: the first five of the weights [1,1,1,1,0.6,…] read as if a lab were missing
  expect(r.uplink.solo).toBeCloseTo((1 + 1 + 1 + 1 + 0.6) / 5, 9);
  expect(r.uplink.ops).toBeCloseTo(1, 9);
  expect(r.uplink.one).toBe(1);
  expect(r.uplink.six[1]).toBeGreaterThan(r.uplink.six[0]);
  expect(r.uplink.bonus).toEqual([0, 1]);
  expect(r.unfinished).toBe(0);
  // Skunkworks: +0.25 each, capped at +0.5
  expect(r.skunk).toEqual([0, 0.25, 0.5, 0.5]);
  expect(r.windowBase[0] / r.windowBase[1]).toBeCloseTo(1.25, 6);
  // Faraday Shed
  expect(r.shed.none).toBeNull();
  expect(r.shed.near).toBe(0.4);
  expect(r.shed.at).toBe(0.4);
  expect(r.shed.far).toBe(1);
  // a rover under a shed is hit ×0.4 as often; at 100× each odds are clamped at 1 (an open rover burns)
  expect(r.machines.n).toBeGreaterThan(0);
  expect(r.machines.plain).toBe(true);
  expect(r.machines.foundry).toBe(true);
  expect(r.machines.soloShed).toBe(false);
  expect(r.machines.foundryShed).toBe(false);
  expect(r.clamp).toBe(true);
  // Night Vault: docked things sleep; a working one does not; a sleeping charger delivers half
  expect(r.vault).toEqual({ none: false, stands: true });
  expect(r.hib).toEqual({ rover: true, drone: true, parked: true, digging: false, pad: false });
  expect(r.charge.asleep).toBeCloseTo(r.charge.awake * 0.5, 9);
});

test('the crew and morale panels show the scrutiny line (value, both thresholds, time to the next tier) and the fall multiplier only for the Vanguard', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);
  await page.evaluate(() => { const g = window.__game; g.selectFaction('accelerationists', 'southpole'); g.setPaused(true); g.holdHazards(true); g.advanceGameSeconds(2); g.killCrew(1); g.addScrutiny(20); g.advanceGameSeconds(1); });
  await page.locator('.chip[data-slot="morale"]').click();
  const panel = page.locator('#res-panel');
  await expect(panel).toContainText(/SCRUTINY\s*6\d \/ 100 · penalty/);
  await expect(panel).toContainText(/From 50\s*crewed stations ×0\.7 · research ×0\.8/);
  await expect(panel).toContainText(/At 80\s*HEARINGS/);
  await expect(panel).toContainText(/under 50 in \d+\.\d days/);
  await expect(panel).toContainText(/Morale falls\s*×2 as fast/);
  await expect(panel).toContainText(/Your program’s morale base\s*−8/);
  await page.locator('#res-panel-close').click();
  await page.locator('.chip[data-slot="crew"]').click();
  await expect(panel).toContainText(/SCRUTINY\s*6\d \/ 100/);
  // a solo game has no line at all, and no fall multiplier
  await page.evaluate(() => { const g = window.__game; g.selectSite('southpole', 'human'); g.setPaused(true); g.advanceGameSeconds(2); });
  await page.locator('#res-panel-close').click();
  await page.locator('.chip[data-slot="morale"]').click();
  await expect(panel).toContainText('Morale');
  await expect(panel).not.toContainText('SCRUTINY');
  await expect(panel).not.toContainText('Morale falls');
});

test('solo is untouched: neutral mods, no scrutiny state, and a rotation with no recall flag', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const one = (exp: 'human' | 'robotic') => {
      g.selectSite('mare', exp);
      g.setPaused(true); g.holdHazards(true);
      g.advanceGameSeconds(400);
      const s = g.getState();
      const m = g.getMods();
      return {
        scrutiny: 'scrutiny' in s, rotation: s.crewRotation, mods: [m.nightOutputMult, m.bankDischargeMult, m.moraleFallMult, m.machineFlareMult, m.scrutiny, m.arrayHardMult, m.nightDrawMult],
        sc: g.getScrutiny(),
      };
    };
    return { human: one('human'), robotic: one('robotic') };
  });
  for (const b of [r.human, r.robotic]) {
    expect(b.scrutiny).toBe(false);
    expect(b.mods).toEqual([1, 1, 1, 1, false, 1, 1]);
    expect(b.sc).toEqual({ state: null, view: null });
  }
  expect(r.human.rotation).toBeNull();
});
