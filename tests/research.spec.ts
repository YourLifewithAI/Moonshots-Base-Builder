/** Research-tree sim (docs/11-research-and-map-spec.md §9): charters, insights,
 *  doctrines, the queue, the new verbs, the crew rotation and the mods the
 *  economy now runs on. Drives the sim through window.__game (?debug). */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

const URL_DEBUG = '/?debug&seed=42&nolock&lowfx';

async function start(page: Page, site: string, exp: 'human' | 'robotic' = 'human') {
  await page.goto(`${URL_DEBUG}&site=${site}${exp === 'robotic' ? '&exp=robotic' : ''}`);
  await page.waitForFunction(() => window.__game !== undefined);
  // game time moves only through the fast-forwards: every reading lands on a known tick;
  // hazards (docs/14 §3) are held — tests/hazards.spec.ts owns them
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.holdHazards(true); window.__game.advanceGameSeconds(0); });
  await page.evaluate(POWERED);
}

const complete = (page: Page, techs: string[]) =>
  page.evaluate((ts) => { for (const t of ts) window.__game.completeTech(t); }, techs);

/** Place buildings on the nearest free valid spots around the Lander. */
async function placeNear(page: Page, items: [string, number][]) {
  const missing = await page.evaluate((list) => {
    const g = window.__game!;
    const spots: [number, number][] = [];
    for (let gz = 112; gz <= 143; gz++) for (let gx = 112; gx <= 143; gx++) spots.push([gx, gz]);
    spots.sort((a, b) => Math.hypot(a[0] - 127, a[1] - 127) - Math.hypot(b[0] - 127, b[1] - 127));
    const short: string[] = [];
    for (const [type, n] of list) {
      let placed = 0;
      for (const [gx, gz] of spots) {
        if (placed >= n) break;
        if (g.placeBuilding(type, gx, gz)) placed++;
      }
      if (placed < n) short.push(`${type} ${placed}/${n}`);
    }
    return short;
  }, items);
  expect(missing).toEqual([]);
}

const hasAlert = (s: any, re: RegExp) => s.alerts.some((a: any) => re.test(a.text));

/** In-page: advance `secs` with the bank topped up every 10 s (a grant above
 *  capacity is clamped whenever the grid runs a surplus, so one big grant
 *  would not carry a night). */
declare function powered(secs: number): void;
const POWERED = `window.powered = (secs) => {
  const g = window.__game;
  for (let t = 0; t < secs; t += 10) { g.grantPower(5000); g.advanceGameSeconds(Math.min(10, secs - t)); }
}`;

// an era opens with 4 techs of the one before (docs/12 §2.1), and from Era 3
// on the era before's destiny pick must be one of them (docs/14 §2.6); debug
// completes skip prerequisites and goods. Four Era-1 techs visible at every site:
const E1_4 = ['regolithProcessing', 'teleoperation', 'grizzlyScreens', 'fieldSpectrometers'];
// through Era 5 on either expedition, on the ◉ picks (none of them brings a crew)
const TO_ERA_5 = [
  ...E1_4,
  'siliconRefining', 'partsFabrication', 'constructionRobotics', 'batteryStorage', 'dispatchMesh',
  'regenFuelCells', 'swarmRobotics', 'stackedCells', 'slagRecycling', 'droneHives',
  'waferFab', 'acceleratorDesign', 'waferPolishing', 'oreSorting', 'lightsOutFabs',
];
/** ERA_COST_SCALE as the page runs it (costs below are base × scale) */
const costScale = (page: Page) =>
  page.evaluate(async () => (await import('/src/data/balance.ts')).ERA_COST_SCALE as Record<number, number>);

test('charter by deed: two era-1 techs plus 450◆ smelted open Era 2', async ({ page }) => {
  await start(page, 'mare');
  await complete(page, ['regolithProcessing']);
  await page.evaluate(() => window.__game.grantResources({ metals: 200 }));
  await placeNear(page, [['solar', 2], ['excavator', 3], ['smelter', 2], ['lab', 1]]);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.finishConstruction();
    g.grantResources({ regolith: 200 });
    let s = g.getState();
    let eraWhileShort = 0;
    for (let i = 0; i < 200 && s.stats.produced.metals < 450; i++) {
      eraWhileShort = Math.max(eraWhileShort, s.era);
      powered(10);
      s = g.getState();
      // keep the yard from filling, so the smelters never stand by
      if (s.resources.metals > 150) g.grantResources({ metals: 100 - s.resources.metals });
    }
    const oneTech = { era: g.getState().era, gate: g.getResearch().gates[0] };
    // the second tech researched for real, so the economy's era tick opens the era
    g.research('grizzlyScreens');
    g.grantData(200);
    for (let i = 0; i < 60 && !g.getState().techsDone.includes('grizzlyScreens'); i++) powered(10);
    g.advanceGameSeconds(1);
    return { oneTech, eraWhileShort, s: g.getState(), gate: g.getResearch().gates[0] };
  });
  expect(r.oneTech.gate.deedValue).toBeGreaterThanOrEqual(450);
  expect(r.oneTech.gate.deedMet).toBe(true);
  // one tech and the deed are not a charter; nor are the smelts alone
  expect(r.eraWhileShort).toBe(1);
  expect(r.oneTech.era).toBe(1);
  expect(r.oneTech.gate.techs).toBe(1);
  expect(r.oneTech.gate.deedTechsNeed).toBe(2);
  expect(r.s.era).toBe(2);
  expect(r.gate.via).toBe('deed');
  expect(hasAlert(r.s, /^ERA 2 OPENS — EARLY CONSTRUCTION · via 2 techs \+ 450◆ smelted$/)).toBe(true);
});

test('charter by techs: four era-1 techs open Era 2, three do not', async ({ page }) => {
  await start(page, 'mare');
  await complete(page, E1_4.slice(0, 3));
  const three = await page.evaluate(() => { window.__game.advanceGameSeconds(1); return window.__game.getResearch(); });
  expect(three.era).toBe(1);
  expect(three.gates[0]).toMatchObject({ techs: 3, techsNeed: 4, open: false });
  await complete(page, E1_4.slice(3));
  const four = await page.evaluate(() => { window.__game.advanceGameSeconds(1); return window.__game.getResearch(); });
  expect(four.era).toBe(2);
  expect(four.gates[0]).toMatchObject({ techs: 4, open: true, via: 'techs' });
});

test('insight: a night with load shed makes Battery Banks 40% cheaper, even while locked', async ({ page }) => {
  await start(page, 'mare');
  // two crewed labs (10 kW) outlast the Lander's bank before dawn; no batteries
  await placeNear(page, [['solar', 1], ['lab', 2]]);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.advanceGameSeconds(470 - g.getState().simTime); // just before the first dusk
    const dusk = g.getState();
    g.advanceGameSeconds(725 - dusk.simTime); // through the night, just past dawn
    return { dusk, dawn: g.getState(), card: g.getResearch().cards.batteryStorage };
  });
  expect(r.dusk.insights.batteryStorage).toBeUndefined();
  expect(r.dawn.stats.nightBrownouts).toBe(1);
  expect(r.dawn.insights.batteryStorage).toBe(0.4);
  expect(r.card.state).toBe('eraLocked');
  expect(r.card.cost.base).toBe(Math.round(110 * (await costScale(page))[2]));
  expect(r.card.cost.data).toBe(Math.round(r.card.cost.base * 0.6));
  expect(r.card.insight.earned).toBe(true);
  expect(hasAlert(r.dawn, /^INSIGHT — Battery Banks 40% cheaper: a night brownout/)).toBe(true);
});

test('doctrine: a queued pick forecloses its rival until cancelled, a done one for good', async ({ page }) => {
  await start(page, 'mare');
  await complete(page, [...E1_4, 'constructionRobotics', 'partsFabrication', 'siliconRefining', 'batteryStorage', 'dispatchMesh']);
  const read = () => page.evaluate(() => {
    const g = window.__game!;
    g.advanceGameSeconds(0);
    return { s: g.getState(), r: g.getResearch() };
  });
  expect((await read()).s.era).toBe(3);
  await page.evaluate(() => window.__game.research('swarmRobotics'));
  const queued = await read();
  expect(queued.r.cards.heavyConstructors.state).toBe('foreclosed');
  expect(queued.r.cards.heavyConstructors.doctrine).toBe('constructionDoctrine');
  // the refusal says what is wrong and how to reopen it
  await page.evaluate(() => window.__game.research('heavyConstructors'));
  const refused = await read();
  expect(refused.s.researchQueue).toEqual(['swarmRobotics']);
  expect(hasAlert(refused.s,
    /^FORECLOSED — Heavy Constructors while Swarm Robotics is queued — cancel it to reopen$/)).toBe(true);
  // cancel reopens it
  await page.evaluate(() => window.__game.cancelResearch('swarmRobotics'));
  expect((await read()).r.cards.heavyConstructors.state).toBe('available');
  // a completed pick stays chosen
  await complete(page, ['swarmRobotics']);
  await page.evaluate(() => window.__game.research('heavyConstructors'));
  const chosen = await read();
  expect(chosen.r.cards.heavyConstructors.state).toBe('foreclosed');
  expect(chosen.r.cards.heavyConstructors.reason).toBe('foreclosed — you chose Swarm Robotics');
  expect(chosen.s.researchQueue).toEqual([]);
  expect(hasAlert(chosen.s, /^FORECLOSED — Heavy Constructors — you chose Swarm Robotics$/)).toBe(true);
});

test('requiresAny: either branch opens the tech; hidden members are never listed', async ({ page }) => {
  // mare: Site Grading is hidden, so only Construction Robotics is named
  await start(page, 'mare');
  await complete(page, ['regolithProcessing', 'prospectingRovers', 'grizzlyScreens', 'fieldSpectrometers']);
  const mare = await page.evaluate(() => window.__game.getResearch());
  expect(mare.era).toBe(2);
  expect(mare.cards.regolithShielding.state).toBe('requiresAny');
  expect(mare.cards.regolithShielding.reason).toBe('needs Construction Robotics');
  // Construction Robotics itself takes either uplink: Rovers is done, Teleoperation is not
  expect(mare.cards.constructionRobotics.state).toBe('available');
  // the path queues the one missing branch in front of it
  await page.evaluate(() => window.__game.researchPath('regolithShielding'));
  const path = await page.evaluate(() => { window.__game.advanceGameSeconds(0); return window.__game.getState(); });
  expect(path.researchQueue).toEqual(['constructionRobotics', 'regolithShielding']);

  // pole: the grading branch alone is enough
  await start(page, 'southpole');
  await complete(page, ['regolithProcessing', 'siteGrading', 'grizzlyScreens', 'fieldSpectrometers']);
  const pole = await page.evaluate(() => window.__game.getResearch());
  expect(pole.cards.regolithShielding.state).toBe('available');
  await page.evaluate(() => window.__game.research('regolithShielding'));
  const q = await page.evaluate(() => { window.__game.advanceGameSeconds(0); return window.__game.getState(); });
  expect(q.researchQueue).toEqual(['regolithShielding']);
});

test('goods stall: a tech short of chips waits while the queue flows past it', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  await complete(page, TO_ERA_5);
  await page.evaluate(() => window.__game.grantResources({ metals: 200, parts: 60 }));
  await placeNear(page, [['solar', 2], ['lab', 4]]);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.research('lunarDataCenter');
    g.research('dustMitigation');
    g.grantData(4000);
    powered(900); // four agent labs outdraw the arrays
    const stalled = g.getState();
    g.grantResources({ chips: 10 });
    g.advanceGameSeconds(2);
    return { stalled, after: g.getState() };
  });
  expect(r.stalled.era).toBe(5);
  expect(r.stalled.techsDone).toContain('dustMitigation');
  expect(r.stalled.techsDone).not.toContain('lunarDataCenter');
  expect(r.stalled.researchStalled).toEqual(['lunarDataCenter']);
  expect(hasAlert(r.stalled, /^RESEARCH WAITING — Lunar Data Center needs 10▣.*Chip Fab/)).toBe(true);
  expect(r.after.techsDone).toContain('lunarDataCenter');
  expect(r.after.resources.chips).toBeCloseTo(0, 6);
});

test('cancel is transitive: dependents drop with alerts and never finish', async ({ page }) => {
  await start(page, 'mare');
  await complete(page, ['teleoperation', 'prospectingRovers', 'grizzlyScreens', 'fieldSpectrometers']); // Era 2 without smelting
  await placeNear(page, [['solar', 1], ['lab', 1]]);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    for (const t of ['regolithProcessing', 'siliconRefining', 'partsFabrication']) g.research(t);
    g.advanceGameSeconds(0);
    const queued = g.getState().researchQueue;
    g.cancelResearch('regolithProcessing');
    g.advanceGameSeconds(0);
    const cancelled = g.getState();
    g.grantData(500);
    g.advanceGameSeconds(600);
    return { queued, cancelled, later: g.getState() };
  });
  expect(r.queued).toEqual(['regolithProcessing', 'siliconRefining', 'partsFabrication']);
  expect(r.cancelled.researchQueue).toEqual([]);
  const drops = r.cancelled.alerts.filter((a: any) => a.text.startsWith('RESEARCH DROPPED'));
  expect(drops.map((a: any) => a.text).sort()).toEqual([
    'RESEARCH DROPPED — Parts Fabrication needs Regolith Smelting',
    'RESEARCH DROPPED — Silicon Refining needs Regolith Smelting',
  ]);
  expect(r.later.techsDone).not.toContain('siliconRefining');
  expect(r.later.techsDone).not.toContain('partsFabrication');
  expect(r.later.techsDone).not.toContain('regolithProcessing');
});

test('overclock: ×1.5 draw and output, then it trips itself at WORN', async ({ page }) => {
  await start(page, 'mare');
  await complete(page, ['waferFab']);
  await page.evaluate(() => window.__game.grantResources({ metals: 100, silicon: 200, parts: 100 }));
  await placeNear(page, [['solar', 4], ['chipFab', 1]]);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    const fab = () => g.getState().buildings.find((b: any) => b.type === 'chipFab');
    powered(260); // the fab is built after the arrays, and runs through the night
    const id = fab().id;
    g.setOverclock(id, true); // before the tech: refused
    g.advanceGameSeconds(1);
    const refused = { s: g.getState(), on: !!fab().overclock };
    g.completeTech('dynamicClocking');
    const window20 = () => {
      g.grantPower(5000);
      const a = g.getState();
      g.advanceGameSeconds(20);
      const b = g.getState();
      return { chips: (b.resources.chips - a.resources.chips) / 20, demand: b.power.demand };
    };
    g.advanceGameSeconds(1);
    const base = window20();
    g.setOverclock(id, true);
    g.advanceGameSeconds(1);
    const onAt = g.getState().simTime;
    const oc = window20();
    // +0.35 wear per lunar day, unhealed: WORN (0.3) after ~617 s of running
    powered(580);
    let wearAtTrip = 0;
    while (fab().overclock && g.getState().simTime < onAt + 700) {
      wearAtTrip = fab().wear;
      g.grantPower(1000);
      g.advanceGameSeconds(1);
      if (!fab().overclock) wearAtTrip = fab().wear;
    }
    const tripped = g.getState();
    g.setOverclock(id, true); // worn: refused
    g.advanceGameSeconds(1);
    return { refused, base, oc, wearAtTrip, ranS: tripped.simTime - onAt, tripped, again: g.getState(), id };
  });
  expect(r.refused.on).toBe(false);
  expect(hasAlert(r.refused.s, /^NEEDS Dynamic Clocking/)).toBe(true);
  expect(r.base.chips).toBeGreaterThan(0.04);
  expect(r.oc.chips / r.base.chips).toBeCloseTo(1.5, 1);
  expect(r.oc.demand - r.base.demand).toBeCloseTo(9, 0); // 18 kW → 27 kW
  const fab = r.tripped.buildings.find((b: any) => b.id === r.id);
  expect(fab.overclock).toBe(false);
  expect(r.wearAtTrip).toBeGreaterThanOrEqual(0.3);
  expect(r.ranS).toBeGreaterThan(600);
  expect(r.ranS).toBeLessThan(640);
  expect(hasAlert(r.tripped, new RegExp(`^OVERCLOCK TRIPPED — Chip Fab #${r.id} reached WORN$`))).toBe(true);
  expect(r.again.buildings.find((b: any) => b.id === r.id).overclock).toBe(false);
  expect(hasAlert(r.again, /^CANNOT OVERCLOCK — Chip Fab #\d+ is WORN/)).toBe(true);
});

test('downlink: banked data buys cargo through the one shipment slot, each dearer', async ({ page }) => {
  await start(page, 'mare');
  const r = await page.evaluate(() => {
    const g = window.__game!;
    const step = () => { g.advanceGameSeconds(1); return g.getState(); };
    g.downlink();
    const noTech = step();
    g.completeTech('teleoperation');
    g.grantData(100);
    g.downlink();
    const poor = step();
    g.grantData(300);
    g.downlink();
    const sent = step();
    g.downlink();
    const busy = step();
    g.advanceGameSeconds(360);
    const landed = g.getState();
    g.downlink();
    const dearer = step();
    return { noTech, poor, sent, busy, landed, dearer };
  });
  expect(hasAlert(r.noTech, /^NEEDS Earth Teleoperation/)).toBe(true);
  expect(r.poor.resupply.pending).toBe(false);
  expect(hasAlert(r.poor, /^DOWNLINK NEEDS 150≡ BANKED — have 100$/)).toBe(true);
  expect(r.sent.data).toBeCloseTo(250, 6);
  expect(r.sent.downlinks).toBe(1);
  expect(r.sent.resupply.pending).toBe(true);
  expect(r.sent.resupply.downlink).toBe(true);
  expect(hasAlert(r.busy, /^SHIPMENT ALREADY EN ROUTE/)).toBe(true);
  expect(r.busy.data).toBeCloseTo(250, 6);
  // the cargo lands: 60◆ 20⚙ 5▣
  expect(r.landed.resupply.pending).toBe(false);
  expect(r.landed.resources.chips).toBe(5);
  expect(r.landed.resources.metals - r.sent.resources.metals).toBeCloseTo(60, 0);
  expect(hasAlert(r.landed, /^DOWNLINK CARGO LANDED — \+60 metals, \+20 parts, \+5 chips from Earth$/)).toBe(true);
  // the second one costs 200
  expect(hasAlert(r.dearer, /^DOWNLINK NEEDS 200≡ BANKED — have 250$/)).toBe(false);
  expect(r.dearer.data).toBeCloseTo(50, 6);
  expect(r.dearer.downlinks).toBe(2);
});

test('crew rotation: robotic Cohabitation boards 2 settlers only when the base can keep them', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ food: -g.getState().resources.food });
    g.completeTech('humanCohabitation');
    const t0 = g.getState().simTime;
    const pending = g.getState().crewRotation;
    g.advanceGameSeconds(239);
    const early = g.getState();
    g.advanceGameSeconds(2);
    const held = g.getState();
    g.grantResources({ food: 50 });
    g.advanceGameSeconds(30);
    const retrying = g.getState();
    g.advanceGameSeconds(30);
    return { t0, pending, early, held, retrying, boarded: g.getState() };
  });
  expect(r.pending).toEqual({ at: r.t0 + 240, count: 2 });
  expect(r.early.crew).toBe(0);
  // no food: held, naming what is missing and what makes it
  expect(r.held.crew).toBe(0);
  expect(hasAlert(r.held, /^CREW ROTATION HELD — needs 12 food \(have 0\) · build Hydroponics Farm$/)).toBe(true);
  // re-checked a minute later, not every tick
  expect(r.retrying.crew).toBe(0);
  expect(r.boarded.crew).toBe(2);
  expect(r.boarded.crewRotation).toBeNull();
  expect(hasAlert(r.boarded, /^CREW ROTATION — 2 settlers aboard/)).toBe(true);
  // the rotation, not the growth rule, brought them
  expect(hasAlert(r.boarded, /^ARRIVAL/)).toBe(false);
});

test('robotic charter: Era 7 waits for Human Cohabitation on either route — and for the Era 6 destiny, which settles it', async ({ page }) => {
  const TO_ERA_6 = [...TO_ERA_5, 'lunarDataCenter', 'dynamicClocking', 'cryoRadiators', 'wingExtensions', 'fleetOS'];
  await start(page, 'mare', 'robotic');
  await complete(page, TO_ERA_6);
  expect((await page.evaluate(() => window.__game.getState())).era).toBe(6);
  // Crew Wellness resolves to Era 7 on robotic runs: Cohab alone is one Era-6 tech
  await complete(page, ['humanCohabitation', 'crewWellness']);
  const cohabOnly = await page.evaluate(() => window.__game.getResearch());
  expect(cohabOnly.era).toBe(6);
  expect(cohabOnly.cards.crewWellness.era).toBe(7);
  expect(cohabOnly.gates.find((gt: any) => gt.era === 7).techs).toBe(1);

  await start(page, 'mare', 'robotic');
  await complete(page, TO_ERA_6);
  // both routes met — four Era-6 techs, and two outposts a day together — but no Cohab
  await complete(page, ['farSideRelay', 'closedLoopLS', 'refractoryLinings', 'uplinkDishes']);
  await page.evaluate(() => { window.__game.setStats({ outpostPairOpS: 720 }); window.__game.advanceGameSeconds(1); });
  const noCohab = await page.evaluate(() => window.__game.getResearch());
  const gate = noCohab.gates.find((gt: any) => gt.era === 7);
  expect(noCohab.era).toBe(6);
  expect(gate.techs).toBe(4);
  expect(gate.deedMet).toBe(true);
  expect(gate.requires).toEqual({ tech: 'humanCohabitation', done: false, waived: false });
  expect(gate.open).toBe(false);
  // Cohabitation researched: still shut, for the Era 6 destiny is missing
  await complete(page, ['humanCohabitation']);
  const noPick = await page.evaluate(() => { window.__game.advanceGameSeconds(1); return window.__game.getResearch(); });
  expect(noPick.era).toBe(6);
  expect(noPick.gates.find((gt: any) => gt.era === 7).destiny).toMatchObject({ done: false });
  await complete(page, ['settlerCharter']);
  expect((await page.evaluate(() => window.__game.getState())).era).toBe(7);
});

test('uplink share: six agent labs research at 5.2 × 0.225, exactly what researchRates reports', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  await page.evaluate(() => window.__game.grantResources({ metals: 200, parts: 80 }));
  await placeNear(page, [['lab', 6]]);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.finishRoads(); // their roads open: the robots weld from the start (docs/15)
    powered(240); // six labs, two robots, no arrays
    g.grantPower(5000);
    const a = g.getState();
    g.advanceGameSeconds(10);
    const b = g.getState();
    return { labs: b.buildings.filter((x: any) => x.type === 'lab' && x.active).length,
      rate: (b.data - a.data) / 10, view: g.getResearch() };
  });
  expect(r.labs).toBe(6);
  expect(r.view.uplinkShare).toBeCloseTo(5.2 / 6, 6);
  expect(Math.abs(r.rate / (5.2 * 0.225) - 1)).toBeLessThan(0.03);
  expect(r.rate).toBeCloseTo(r.view.production, 6);
});

test('tech mods reach the grid: Lander comms loads, agent tax, night draw, construction', async ({ page }) => {
  // exploration techs load the Lander: below 0 kW it is a priority-0 draw
  await start(page, 'mare');
  const lander = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('prospectingRovers');
    g.advanceGameSeconds(1);
    const rovers = g.getState().power.supply;
    for (const t of ['orbitalProspector', 'farSideRelay', 'deepSounding']) g.completeTech(t);
    g.advanceGameSeconds(1);
    const loaded = g.getState();
    g.grantPower(-g.getState().powerStored);
    g.advanceGameSeconds(1);
    return { rovers, loaded, dark: g.getState() };
  });
  expect(lander.rovers).toBeCloseTo(5, 6); // 6 kW − 1 kW rover charging
  expect(lander.loaded.power.supply).toBeCloseTo(0, 6);
  expect(lander.loaded.power.demand).toBeCloseTo(2, 6); // 6 − 1 − 2 − 2 − 3
  expect(lander.dark.buildings[0].idleReason).toBe('power');
  expect(lander.dark.power.brownout).toBe(true);

  // agent-run draw is ×(1 + agentTax): 1.6, or 1.36 with Rad-Hard; Wadis tax the day ×1.05
  await start(page, 'mare', 'robotic');
  await placeNear(page, [['lab', 1]]);
  const tax = await page.evaluate(() => {
    const g = window.__game!;
    g.finishRoads(); // its road open: built by 80 s (docs/15)
    g.advanceGameSeconds(80);
    const draw = () => { g.advanceGameSeconds(1); return g.getState().power.demand; };
    const base = draw();
    g.completeTech('radHardProcess');
    const radHard = draw();
    g.completeTech('thermalWadis');
    const day = draw();
    g.advanceGameSeconds(490 - g.getState().simTime); // night
    g.grantPower(5000);
    const night = draw();
    return { base, radHard, day, night };
  });
  expect(tax.base).toBeCloseTo(5 * 1.6, 6);
  expect(tax.radHard).toBeCloseTo(5 * 1.36, 6);
  expect(tax.day).toBeCloseTo(5 * 1.36 * 1.05, 6);
  expect(tax.night).toBeCloseTo(5 * 1.36 * 0.85, 6);

  // Heavy Constructors: 2.2× weld rate on 60% of the parts, at twice the site draw
  await start(page, 'mare');
  const heavy = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('heavyConstructors');
    g.placeBuilding('solar', 132, 126);
    g.finishRoads(); // its road open: welding from the first second (docs/15)
    const c0 = g.getState().buildings.find((b: any) => b.type === 'solar').construction;
    const p0 = g.getState().resources.parts;
    g.advanceGameSeconds(5);
    const s = g.getState();
    return { c0, welded: c0 - s.buildings.find((b: any) => b.type === 'solar').construction,
      parts: p0 - s.resources.parts, demand: s.power.demand, built: s.stats.built };
  });
  expect(heavy.welded).toBeCloseTo(5 * 2.2, 6);
  expect(heavy.demand).toBeCloseTo(8, 6);
  expect(heavy.parts).toBeGreaterThan(5 * 0.04 * 0.6 - 1e-6); // welding, plus a little Lander upkeep
  expect(heavy.parts).toBeLessThan(5 * 0.04 * 0.6 + 0.01);
});

test('save migration: a 34-tech save loads with retired ids refunded and the queue sanitized', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await start(page, 'southpole');
  await complete(page, ['regolithProcessing']);
  const legacy = await page.evaluate(() => {
    const st = window.__game.getState();
    for (const k of ['techSchema', 'insights', 'discoveries', 'researchStalled', 'researchPaused',
      'researchRateAvg', 'stats', 'feed', 'downlinks', 'crewRotation', 'survey']) delete st[k];
    st.techsDone = ['regolithProcessing', 'hydroponicFarming', 'inferenceOptimization', 'autonomousOps'];
    st.researchQueue = ['autoFabrication', 'hiEffLaunch'];
    st.researchSpent = { autoFabrication: 50 };
    st.iceSurveyed = true;
    return st;
  });
  await page.goto(URL_DEBUG); // the title screen
  await page.evaluate((st) => new Promise((resolve, reject) => {
    const req = indexedDB.open('keyval-store');
    req.onsuccess = () => {
      const tx = req.result.transaction('keyval', 'readwrite');
      tx.objectStore('keyval').put({
        state: st, player: { mode: 'build', x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, savedAt: Date.now(),
      }, 'mbb-save-v1');
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  }), legacy);
  await page.reload();
  await page.locator('#btn-continue').click();
  await page.waitForFunction(() => (window.__game?.getState()?.buildings?.length ?? 0) > 0);
  const s = await page.evaluate(() => window.__game.getState());
  expect(s.techsDone).toEqual(['landingCrew', 'regolithProcessing']); // the landing is the Era 1 destiny (docs/14 §7)
  expect(s.researchQueue).toEqual([]);
  expect(s.techSchema).toBe(4);
  // 40 + 640 + 260 for the three done, plus the 50 banked on a queued one
  expect(s.data - legacy.data).toBeCloseTo(990, 6);
  expect(s.stats.produced.metals).toBe(0);
  expect(s.survey.outposts).toEqual([]);
  expect(hasAlert(s, /^RESEARCH TREE UPDATED — 5 retired techs refunded 990≡$/)).toBe(true);
  expect(hasAlert(s, /^RESEARCH TREE EXPANDED — 82 new techs; nothing you researched is lost$/)).toBe(true);
  expect(errors).toEqual([]);
});

test('save migration: a 47-tech save keeps its era, research and queue; the new techs simply appear', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await start(page, 'mare', 'robotic');
  // a techSchema-2 base in Era 5 by the old 2-tech charters: under the new
  // rule its techs open only Era 2, but the era it reached is never taken back
  const old = ['regolithProcessing', 'prospectingRovers', 'partsFabrication', 'constructionRobotics',
    'thoriumPower', 'swarmRobotics', 'waferFab', 'acceleratorDesign'];
  await complete(page, old);
  const legacy = await page.evaluate((done) => {
    const st = window.__game.getState();
    st.techSchema = 2;
    st.era = 5;
    st.techsDone = done;
    st.researchQueue = ['lunarDataCenter'];
    st.researchSpent = { lunarDataCenter: 120 };
    st.alerts = [];
    return st;
  }, old);
  await page.goto(URL_DEBUG);
  await page.evaluate((st) => new Promise((resolve, reject) => {
    const req = indexedDB.open('keyval-store');
    req.onsuccess = () => {
      const tx = req.result.transaction('keyval', 'readwrite');
      tx.objectStore('keyval').put({
        state: st, player: { mode: 'build', x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, savedAt: Date.now(),
      }, 'mbb-save-v1');
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  }), legacy);
  await page.reload();
  await page.locator('#btn-continue').click();
  await page.waitForFunction(() => (window.__game?.getState()?.buildings?.length ?? 0) > 0);
  const r = await page.evaluate(() => ({ s: window.__game.getState(), v: window.__game.getResearch() }));
  expect(r.s.techSchema).toBe(4);
  expect(r.s.era).toBe(5);
  expect(r.s.techsDone).toEqual(['landingRobotic', ...old]);
  expect(r.s.researchQueue).toEqual(['lunarDataCenter']);
  expect(r.s.researchSpent.lunarDataCenter).toBe(120);
  expect(r.s.data).toBe(legacy.data); // nothing refunded, nothing lost
  expect(hasAlert(r.s, /^RESEARCH TREE EXPANDED — 82 new techs; nothing you researched is lost$/)).toBe(true);
  // new techs appear in their eras: the open ones researchable, the rest era-locked
  expect(r.v.cards.bifacialCells.state).toBe('available');
  expect(r.v.cards.deployableRadiators.state).toBe('available');
  expect(r.v.cards.wingExtensions.state).toBe('requires'); // it builds on MPPT Inverters
  expect(r.v.cards.uplinkDishes.state).toBe('eraLocked');
  // the old Accelerator pick still forecloses its rival, and Brayton builds on the Thorium pick
  expect(r.v.cards.radHardProcess.state).toBe('foreclosed');
  expect(r.v.cards.braytonConverters.state).toBe('available');
  expect(r.v.cards.pressureTanks.state).toBe('foreclosed');
  expect(r.v.cards.pressureTanks.reason).toBe('foreclosed — needs Regenerative Fuel Cells; you chose Thorium Reactor');
  expect(errors).toEqual([]);
});

test('crop loss: a farm dark 30 s at night loses its crop and regrows for 150 s', async ({ page }) => {
  await start(page, 'mare');
  await placeNear(page, [['hydroponics', 1], ['lab', 1]]);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    const farm = () => g.getState().buildings.find((b: any) => b.type === 'hydroponics');
    const lab = g.getState().buildings.find((b: any) => b.type === 'lab');
    g.setPriority(lab.id, 0); // the lab now outranks the farm for the Lander's 6 kW
    g.advanceGameSeconds(490 - g.getState().simTime); // night
    g.grantPower(-g.getState().powerStored);
    // the brownout hold lets the farm back on for a tick now and then: still dark
    let t = 0;
    while (!(farm().cropRegrowT > 0) && t++ < 60) g.advanceGameSeconds(1);
    const lost = { s: g.getState(), sinceDusk: g.getState().simTime - 480 };
    g.setEnabled(lab.id, false);
    g.grantPower(3000);
    g.advanceGameSeconds(20);
    const regrowing = g.getState();
    g.advanceGameSeconds(farm().cropRegrowT + 1);
    const grown = g.getState();
    g.advanceGameSeconds(10);
    return { lost, regrowing, grown, fed: g.getState(), id: farm().id };
  });
  const farmOf = (s: any) => s.buildings.find((b: any) => b.id === r.id);
  expect(r.lost.sinceDusk).toBeGreaterThan(30); // dark more than 30 s of the night
  expect(r.lost.sinceDusk).toBeLessThan(50);
  expect(farmOf(r.lost.s).cropRegrowT).toBe(150);
  expect(hasAlert(r.lost.s, new RegExp(`^CROP LOST — Hydroponics #${r.id} went dark 30 s; regrowing 2:30$`))).toBe(true);
  // powered again, it runs but grows no food until the crop is back
  expect(farmOf(r.regrowing).active).toBe(true);
  expect(farmOf(r.regrowing).cropRegrowT).toBeGreaterThanOrEqual(129);
  expect(farmOf(r.regrowing).cropRegrowT).toBeLessThanOrEqual(131);
  expect(r.regrowing.stats.produced.food).toBe(r.lost.s.stats.produced.food);
  expect(farmOf(r.grown).cropRegrowT).toBe(0);
  expect(r.fed.stats.produced.food).toBeGreaterThan(r.grown.stats.produced.food + 0.3);
});

test('launch capacity: a volley needs 3↑, and each shortfall says so', async ({ page }) => {
  await start(page, 'mare');
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('swarmProtocol');
    g.grantResources({ foils: 10, launch: 2 });
    g.launch();
    g.advanceGameSeconds(0);
    const short = g.getState();
    g.grantResources({ launch: 1 });
    g.launch();
    g.advanceGameSeconds(0);
    return { short, fired: g.getState() };
  });
  expect(r.short.launches).toBe(0);
  expect(hasAlert(r.short, /^LAUNCH NEEDS 3↑ CAPACITY — have 2\.0↑$/)).toBe(true);
  expect(r.fired.launches).toBe(1);
  expect(r.fired.resources.launch).toBeCloseTo(0, 6);
  expect(r.fired.resources.foils).toBeCloseTo(0, 6);
});

test('goods leave the crew’s reserve: Fuel Cells wait until 80≈ is spare, and name what makes it', async ({ page }) => {
  await start(page, 'mare');
  // Molten Regolith Electrolysis: the smelter makes no water here
  await complete(page, [...E1_4, 'constructionRobotics', 'partsFabrication',
    'batteryStorage', 'moltenElectrolysis', 'dispatchMesh']);
  await placeNear(page, [['solar', 2], ['lab', 2]]);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.finishConstruction();
    g.research('regenFuelCells');
    g.grantData(1000);
    g.grantResources({ water: 40 - g.getState().resources.water });
    // its data at 2 × 0.4/s, within the day: paid, but the water is short
    powered(Math.ceil(g.getResearch().cards.regenFuelCells.cost.data / 0.8) + 20);
    const dry = g.getState();
    const dryCard = g.getResearch().cards.regenFuelCells;
    g.completeTech('regolithVolatiles'); // excavators sweat water now
    g.grantResources({ water: 83 - g.getState().resources.water });
    g.advanceGameSeconds(1);
    const held = g.getState();
    const heldCard = g.getResearch().cards.regenFuelCells;
    g.grantResources({ water: 91 - held.resources.water });
    g.advanceGameSeconds(1);
    return { dry, dryCard, held, heldCard, done: g.getState() };
  });
  // seven crew drink 0.035≈/s: five minutes of it, 10.5≈, is the reserve
  expect(r.dry.crew).toBe(7);
  expect(r.dry.researchStalled).toEqual(['regenFuelCells']);
  expect(r.dryCard.stalledNeed).toMatch(/^80≈ water \(have \d+, 11 held for the crew\) · nothing here makes water yet$/);
  expect(hasAlert(r.dry, /^RESEARCH WAITING — Regenerative Fuel Cells needs 80≈ water \(have \d+, 11 held for the crew\) · nothing here makes water yet$/)).toBe(true);
  // 82 in the tanks covers 80, but not 80 above the crew's 10.5: it waits, and says so
  expect(r.held.resources.water).toBeCloseTo(82.965, 6);
  expect(r.held.researchStalled).toEqual(['regenFuelCells']);
  expect(r.held.techsDone).not.toContain('regenFuelCells');
  expect(r.heldCard.stalledNeed).toBe('80≈ water (have 82, 11 held for the crew) · made by Regolith Excavator');
  // 90.965 after the crew drinks: 80 above the reserve, and the reserve stays
  expect(r.done.techsDone).toContain('regenFuelCells');
  expect(r.done.resources.water).toBeCloseTo(10.965, 6);
});

test('producers follow the recipes: the held rotation names what really makes water here', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('moltenElectrolysis'); // the MRE smelter makes metals, oxygen and silicon — no water
    g.grantResources({ water: -g.getState().resources.water, food: 50 });
    g.completeTech('humanCohabitation');
    powered(241);
    const none = g.getState();
    g.completeTech('prospectingRovers');
    g.completeTech('orbitalProspector'); // an outpost slot, and the ice at Cabeus in coverage
    powered(65);
    const outpost = g.getState();
    g.completeTech('regolithVolatiles');
    powered(65);
    return { none, outpost, volatiles: g.getState() };
  });
  const held = (s: any) => s.alerts.filter((a: any) => a.text.startsWith('CREW ROTATION HELD')).map((a: any) => a.text);
  expect(held(r.none)).toEqual(['CREW ROTATION HELD — needs 8 water (have 0) · nothing here makes water yet']);
  expect(held(r.outpost)).toContain('CREW ROTATION HELD — needs 8 water (have 0) · claim an ice outpost');
  expect(held(r.volatiles)).toContain('CREW ROTATION HELD — needs 8 water (have 0) · build Regolith Excavator');
});

test('insight: none for a tech a done doctrine rival has foreclosed for good', async ({ page }) => {
  // while the launch doctrine is open, 300≈ banked earns the Depot its insight
  await start(page, 'mare');
  const open = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ water: 300 });
    g.advanceGameSeconds(1);
    return g.getState();
  });
  expect(open.insights.propellantDepot).toBe(0.4);
  // once the Mass Driver is done, the Depot never opens: no insight, no alert
  await start(page, 'mare');
  await complete(page, ['massDriver']);
  const shut = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ water: 300 });
    g.advanceGameSeconds(1);
    return { s: g.getState(), card: g.getResearch().cards.propellantDepot };
  });
  expect(shut.card.state).toBe('foreclosed');
  expect(shut.card.reason).toBe('foreclosed — you chose Electromagnetic Mass Driver');
  expect(shut.s.insights.propellantDepot).toBeUndefined();
  expect(hasAlert(shut.s, /^INSIGHT — Propellant Depot/)).toBe(false);
  // other insights still fire on the same tick
  expect(shut.s.insights.regenFuelCells).toBe(0.4);
});

test('insight: Regolith Shielding has a deed the flare-proof lava tube can meet', async ({ page }) => {
  await start(page, 'mare');
  const mare = await page.evaluate(() => {
    const g = window.__game!;
    g.setStats({ wornSeen: true });
    g.advanceGameSeconds(1);
    return { s: g.getState(), card: g.getResearch().cards.regolithShielding };
  });
  // on the surface it takes a radiation storm; a worn machine is not one
  expect(mare.card.insight.hint).toBe('a flare goes active with ≥6 structures running');
  expect(mare.s.insights.regolithShielding).toBeUndefined();
  expect(mare.s.insights.safetyProtocols).toBe(0.5);

  await start(page, 'lavatube');
  await placeNear(page, [['solar', 1]]);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    const before = g.getResearch().cards.regolithShielding;
    g.finishConstruction();
    g.grantResources({ parts: -g.getState().resources.parts });
    powered(450); // unpaid upkeep wears the array 0.5 a day: past 0.3 in 432 s
    return { before, s: g.getState(), card: g.getResearch().cards.regolithShielding };
  });
  expect(r.before.insight).toEqual({ discount: 0.4, hint: 'a building worn past 0.3', earned: false });
  expect(r.s.stats.flaresWithSix).toBe(0);
  expect(r.s.stats.wornSeen).toBe(true);
  expect(r.s.insights.regolithShielding).toBe(0.4);
  const base = Math.round(140 * (await costScale(page))[2]);
  expect(r.card.cost).toMatchObject({ base, data: Math.round(base * 0.6), insightLabel: 'a building worn past 0.3' });
  expect(hasAlert(r.s,
    /^INSIGHT — Regolith Shielding 40% cheaper: a machine wore out under the skylight — bury what the tube’s roof leaves open$/)).toBe(true);
});
