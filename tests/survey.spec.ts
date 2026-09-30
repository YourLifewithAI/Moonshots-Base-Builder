/** The survey-drone fleet (docs/19 S6): map surveys are drones' flights, never a borrowed rover.
 *  The Lander carries one drone, a Prospecting Bay prints more, and every docked, charged drone is
 *  one survey under way (parallel flights in state.survey.flights). Field reports list each reward
 *  with a button; the tree's compass names the real hosts; AUTO SURVEY (Site Survey AI) flies idle
 *  drones to the nearest prospect while the bank keeps its reserve; T1 has an outpost slot; an old
 *  save loads with one Lander drone. Drives the sim through window.__game (?debug). */
import { test, expect as baseExpect, type Page } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 20_000 });

declare global {
  interface Window { __game?: any }
}

const BASE = '/?debug&seed=42&nolock&lowfx';

async function start(page: Page, extra = '') {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`${BASE}&site=mare&exp=robotic${extra}`);
  await page.waitForFunction(() => window.__game !== undefined);
  // game time moves only through the fast-forwards: every reading lands on a known tick
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
  await page.evaluate(HELPERS);
}

const g = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => window.__game[f as string](...(a as unknown[])), [fn, args] as const);
const complete = (page: Page, techs: string[]) =>
  page.evaluate((ts) => { for (const t of ts) window.__game.completeTech(t); }, techs);
const hasAlert = (s: any, re: RegExp) => s.alerts.some((a: any) => re.test(a.text));

/** the mission opens on the era 1 explainer (it pauses); Begin */
async function begin(page: Page) {
  const banner = page.locator('#era-banner');
  await expect(banner).toBeVisible();
  await banner.locator('[data-dsc="ok"]').click();
  await expect(banner).toBeHidden();
  // Begin resumes the clock: hold it, so every reading lands on a known tick
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
}

/** In-page helpers: powered(secs) advances with the bank topped up every 10 s; validCell(type) is a
 *  valid footprint origin on the Lander's ground, east of it. */
declare function powered(secs: number): void;
declare function validCell(type: string, skip?: number): { gx: number; gz: number };
declare function fly(id: string): void;
const HELPERS = `(() => {
window.powered = (secs) => {
  const g = window.__game;
  for (let t = 0; t < secs; t += 10) { g.grantPower(5000); g.advanceGameSeconds(Math.min(10, secs - t)); }
};
window.validCell = (type, skip = 0) => {
  const g = window.__game;
  let n = 0;
  for (let dx = 6; dx < 34; dx += 2) for (let dz = -14; dz < 14; dz += 2) {
    const gx = 126 + dx, gz = 126 + dz;
    if (g.canPlace(type, gx, gz).valid && n++ >= skip) return { gx, gz };
  }
  return null;
};
/* one survey, start to finish: the drone is charged, the flight runs its length (the sheet's, range included) */
window.fly = (id) => {
  const g = window.__game;
  g.grantPower(5000);
  g.advanceGameSeconds(21);
  const t = g.getLunar().prospects.find((p) => p.id === id).survey.timeS;
  g.surveyProspect(id);
  window.powered(t + 2);
};
})()`;

/** what a survey needs beyond the drone: stored energy, oxygen, water, parts */
const supply = (page: Page) => page.evaluate(() => {
  const g = window.__game;
  g.grantPower(5000);
  g.grantResources({ oxygen: 300, water: 150, parts: 100, chips: 20 });
});

/** Level I: the Lander's drone plus a Prospecting Bay's two bays (a Bay prints one every 45 s) */
async function threeDrones(page: Page) {
  await complete(page, ['prospectingRovers']);
  await supply(page);
  await page.evaluate(() => {
    const g = window.__game;
    g.advanceGameSeconds(1);
    const c = window.validCell('prospectingBay');
    if (!c || !g.placeBuilding('prospectingBay', c.gx, c.gz)) throw new Error('no ground for the Bay');
    g.finishConstruction();
    g.advanceGameSeconds(1);
    powered(95);
  });
}

test('the Lander carries one drone; a Prospecting Bay prints two more; a fourth survey waits', async ({ page }) => {
  await start(page, '&tips');
  await begin(page);
  const at0 = await page.evaluate(() => window.__game.getState());
  const lander = at0.buildings.find((b: any) => b.type === 'lander').id;
  expect(at0.survey.surveyDrones).toEqual([{ id: 1, home: lander }]);
  expect(at0.survey.surveySchema).toBe(1);
  expect(at0.survey.active).toBeNull();
  expect((await g(page, 'getFleet')).survey.line).toBe('1/1 docked');
  // the Bay is Prospecting Drones' (Era 1): science family, off-road like a mast
  await threeDrones(page);
  const s1 = await page.evaluate(() => ({ s: window.__game.getState(), fleet: window.__game.getFleet().survey }));
  const bay = s1.s.buildings.find((b: any) => b.type === 'prospectingBay');
  expect(bay.construction).toBe(0);
  expect(s1.s.survey.surveyDrones.map((d: any) => d.home).sort()).toEqual([lander, bay.id, bay.id].sort());
  expect(s1.fleet).toMatchObject({ total: 3, ready: 3, out: 0, cap: 3, bays: 1, level: 1, baysEach: 2, line: '3/3 docked' });
  expect(s1.s.survey.prints).toEqual([]); // the bays are full: nothing more is printed

  // three surveys at once: one per docked drone, each its own flight
  const r = await page.evaluate(() => {
    const g = window.__game;
    for (const id of ['tranquilityBase', 'moltke', 'maskelyne']) g.surveyProspect(id);
    g.advanceGameSeconds(0);
    const three = g.getState();
    g.surveyProspect('descartes');
    g.advanceGameSeconds(0);
    return { three, four: g.getState(), lunar: g.getLunar(), fleet: g.getFleet().survey };
  });
  expect(r.three.survey.flights.map((f: any) => f.id)).toEqual(['tranquilityBase', 'moltke', 'maskelyne']);
  expect(new Set(r.three.survey.flights.map((f: any) => f.drone)).size).toBe(3);
  expect(r.four.survey.flights.length).toBe(3);
  expect(hasAlert(r.four, /^ALL 3 DRONES ARE OUT — the next is home in \d:\d\d$/)).toBe(true);
  expect(r.lunar.drones).toMatchObject({ total: 3, ready: 0, out: 3 });
  expect(r.lunar.flights.length).toBe(3);
  expect(r.fleet.line).toMatch(/^0\/3 docked · 3 out → /);

  // the fleet panel: SURVEY DRONES, in one line
  await page.locator('.chip[data-key="bots"]').click();
  const panel = page.locator('#res-panel');
  await expect(panel).toContainText('SURVEY DRONES');
  await expect(panel.locator('#sd-line')).toContainText('0/3 docked · 3 out →');
  await expect(panel.locator('[id^="sd-d"]')).toHaveCount(3);

  // the two 60 s flights land: two surveys in, two drones charging, one still out
  const after = await page.evaluate(() => {
    const g = window.__game;
    g.advanceGameSeconds(61);
    const landed = g.getState();
    g.surveyProspect('descartes');
    g.advanceGameSeconds(0);
    const charging = g.getState();
    g.advanceGameSeconds(30);
    return { landed, charging, later: g.getState() };
  });
  expect(Object.keys(after.landed.survey.prospects).sort()).toEqual(['moltke', 'tranquilityBase']);
  expect(after.landed.survey.flights.length).toBe(1);
  expect(hasAlert(after.charging, /^DRONES CHARGING — the next flies in \d:\d\d$/)).toBe(true);
  expect(after.later.survey.flights.length).toBe(0); // the 82 s flight is home too
  expect(Object.keys(after.later.survey.prospects).sort()).toEqual(['maskelyne', 'moltke', 'tranquilityBase']);
});

test('no rover is borrowed: the fleet stays whole and every rover keeps its site', async ({ page }) => {
  await start(page);
  await complete(page, ['prospectingRovers']);
  await supply(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    // two rovers on the Lander; a solar site takes both
    const c = window.validCell('solar');
    g.placeBuilding('solar', c.gx, c.gz);
    g.advanceGameSeconds(2);
    const rovers = (s: any) => s.rovers.map((x: any) => ({ id: x.id, home: x.home, site: x.site, pinned: x.pinned }));
    const before = g.getState();
    g.surveyProspect('moltke');
    g.advanceGameSeconds(1);
    const during = g.getState();
    g.advanceGameSeconds(30);
    const later = g.getState();
    return { before: { rovers: rovers(before), bots: before.bots }, during: { rovers: rovers(during), bots: during.bots, flights: during.survey.flights, active: during.survey.active }, later: { rovers: rovers(later), bots: later.bots } };
  });
  expect(r.before.bots.total).toBe(2);
  expect(r.before.rovers.some((x: any) => x.site !== null)).toBe(true);
  expect(r.during.flights.length).toBe(1);
  expect(r.during.active).toBeNull();
  expect(r.during.bots.total).toBe(2);
  expect(r.during.rovers).toEqual(r.before.rovers);
  expect(r.later.rovers.length).toBe(2);
});

test('a field report lists each reward with a button; the buttons open the tree and the map', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page, '&tips');
  await begin(page);
  await complete(page, ['prospectingRovers']);
  await supply(page);
  // Taurus–Littrow: orange glass (SAMPLES), the Volcanic Glass breakthrough, an outpost site
  const t = await page.evaluate(() => {
    const g = window.__game;
    const trip = g.getLunar().prospects.find((p: any) => p.id === 'taurusLittrow').survey.timeS;
    g.surveyProspect('taurusLittrow');
    powered(trip + 2);
    return { trip, s: g.getState() };
  });
  const entry = t.s.log.find((e: any) => e.text.startsWith('SURVEY COMPLETE — Taurus'));
  expect(entry.family).toBe('field');
  expect(entry.report.title).toBe('Taurus–Littrow orange glass (Apollo 17)');
  expect(entry.report.geology).toBe('Shorty crater’s pyroclastic beads');
  expect(entry.report.rewards.map((w: any) => w.tag)).toEqual(['DATA', 'SAMPLES', 'BREAKTHROUGH', 'OUTPOST SITE']);
  const [data, samples, bt, outpost] = entry.report.rewards;
  expect(data.text).toMatch(/^\+\d+≡ banked$/);
  expect(samples.text).toBe('+40○ glass');
  expect(bt.text).toBe('Volcanic Glass Reduction — researchable in Era 4');
  expect(bt.button).toEqual({ label: 'In the tree', action: { tech: 'btVolcanicGlass' } });
  expect(outpost.text).toBe('glass +0.20○ +0.02≈/s · claim 60◆ 20⚙ 5▣');
  expect(outpost.button).toEqual({ label: 'Claim', action: { map: 'taurusLittrow' } });
  // the sample cache came home once; a second glass prospect gets none
  const card = page.locator('#field-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.fc-title')).toHaveText('Taurus–Littrow orange glass (Apollo 17)');
  await expect(card.locator('.fc-rw')).toHaveCount(4);
  await expect(card.locator('.fc-btn')).toHaveCount(2);
  // [In the tree] opens the tree at the breakthrough, its compass reading "Found at …"; the card is done
  await card.locator('.fc-btn').first().click();
  await expect(page.locator('#tech-screen')).toBeVisible();
  await expect(page.locator('#tech-sheet-body')).toContainText('Volcanic Glass Reduction');
  await expect(page.locator('#tech-sheet-body')).toContainText('Found at Taurus–Littrow');
  await page.keyboard.press('Escape');
  await expect(page.locator('#tech-screen')).toBeHidden();
  await expect(card).toBeHidden();

  // Moltke: ilmenite, no breakthrough; its card's [Claim] opens the map at the prospect
  await page.evaluate(() => { window.fly('moltke'); });
  await expect(card).toBeVisible();
  await expect(card.locator('.fc-rw .fc-tag')).toHaveText(['DATA', 'SAMPLES', 'OUTPOST SITE']);
  await expect(card.locator('.fc-rw', { hasText: 'SAMPLES' })).toContainText('+30◆ ilmenite');
  await card.locator('.fc-btn').click();
  await expect(page.locator('#map-screen')).toBeVisible();
  await expect(page.locator('#map-panel')).toContainText('Moltke');
  await page.keyboard.press('Escape');
  await expect(page.locator('#map-screen')).toBeHidden();
});

test('reports carry an ATLAS line from T3; a second site of a kind brings no sample cache', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page);
  await complete(page, ['prospectingRovers', 'orbitalProspector', 'farSideRelay']);
  await supply(page);
  const s = await page.evaluate(() => {
    const g = window.__game;
    window.fly('tranqPit');       // a regional anomaly that hosts a breakthrough
    window.fly('aristarchus');    // a glass site on the near side: the first of its kind
    window.fly('schrodinger');    // a second glass site, far side: no cache
    return g.getState();
  });
  const rep = (name: string) => s.log.find((e: any) => e.text.startsWith(`SURVEY COMPLETE — ${name}`))?.report;
  const tags = (name: string) => rep(name).rewards.map((w: any) => w.tag);
  expect(tags('Mare Tranquillitatis pit')).toEqual(['DATA', 'BREAKTHROUGH', 'ATLAS']);
  expect(rep('Mare Tranquillitatis pit').rewards[2].text).toBe('1/12 · needs T4 Deep Sounding Network (Era 7)');
  expect(tags('Aristarchus Plateau dark mantle')).toContain('SAMPLES');
  expect(rep('Aristarchus Plateau dark mantle').rewards.find((w: any) => w.tag === 'SAMPLES').text).toBe('+40○ glass');
  expect(tags('Schrödinger basin vent')).not.toContain('SAMPLES');
  expect(rep('Schrödinger basin vent').rewards.find((w: any) => w.tag === 'ATLAS').text).toBe('3/12 · needs T4 Deep Sounding Network (Era 7)');
});

test('AUTO SURVEY (Site Survey AI) flies an idle drone to the nearest prospect and keeps the bank’s reserve', async ({ page }) => {
  await start(page);
  await complete(page, ['prospectingRovers', 'siteSurveyAI']);
  await supply(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const rule = () => g.getAutomation().rules.find((x: any) => x.id === 'autoSurvey');
    // the bank below its reserve (60% of the bank, plus what the survey costs) as the family unlocks: the
    // rule switches itself on, and the drone stays docked
    const cap = g.getState().power.capacity;
    g.grantPower(0.5 * cap - g.getState().powerStored);
    g.advanceGameSeconds(3);
    const on = rule();
    const held = { flights: g.getState().survey.flights, rule: rule(), stored: g.getState().powerStored, cap };
    // the bank full: the nearest unsurveyed prospect in coverage
    const nearest = g.getLunar().prospects.filter((p: any) => p.visible && !p.surveyed).sort((a: any, b: any) => a.dist - b.dist)[0];
    g.grantPower(cap);
    g.advanceGameSeconds(2);
    const flown = { flights: g.getState().survey.flights, log: g.getState().log.map((e: any) => e.text), rule: rule() };
    return { on, held, nearest: nearest.id, flown };
  });
  expect(r.on.on).toBe(true);
  expect(r.held.flights).toEqual([]);
  expect(r.held.rule.status).toMatch(/^holding · the bank keeps 60%/);
  expect(r.held.stored).toBeLessThan(0.6 * r.held.cap + 60);
  expect(r.flown.flights.length).toBe(1);
  expect(r.flown.flights[0].id).toBe(r.nearest);
  expect(r.flown.log.some((t: string) => t.startsWith('SURVEY LAUNCHED') && t.endsWith('AUTO SURVEY'))).toBe(true);
  expect(r.flown.rule.status).toMatch(/^(→ flew 1|ok) · 1\/1 drones out$/);
  // it does not fly a second drone it has not got, and off means off
  const off = await page.evaluate(() => {
    const g = window.__game;
    g.setRule('autoSurvey', { on: false });
    g.advanceGameSeconds(200);
    return { flights: g.getState().survey.flights, surveyed: Object.keys(g.getState().survey.prospects).length };
  });
  expect(off.flights).toEqual([]);
  expect(off.surveyed).toBe(1);
});

test('the tree’s compass names the real host prospects and their classes', async ({ page }) => {
  await start(page, '&tips');
  await begin(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const cards = g.getResearch().cards;
    return { lava: cards.btLavaTubeCaverns, glass: cards.btVolcanicGlass, cold: cards.btColdTrapChemistry };
  });
  // nearest host first, each with its real name and its class from the landing site
  expect(r.lava.compass.text).toBe('Survey Tranquillitatis pit (regional), Marius tube (near side) or Ingenii pit (far side)');
  expect(r.lava.compass.hosts.map((h: any) => h.id)).toEqual(['tranqPit', 'mariusTube', 'ingeniiPit']);
  expect(r.lava.reason).toBe('◎ undiscovered — Survey Tranquillitatis pit (regional), Marius tube (near side) or Ingenii pit (far side)');
  expect(r.glass.compass.text).toBe('Survey Taurus–Littrow (regional), Aristarchus (near side) or Schrödinger (far side)');
  expect(r.cold.compass.text).toBe('Survey Cabeus (near side) or Hermite (near side)');
  expect(r.lava.state).toBe('hidden');
  // the tree: the placeholder wears the ◎ badge and the nearest host, the sheet lists them all
  await page.keyboard.press('KeyT');
  await expect(page.locator('#tech-screen')).toBeVisible();
  await page.locator('.era-tab[data-era="4"]').click();
  const ph = page.locator('.tech-card[data-tech="btVolcanicGlass"]');
  await expect(ph).toHaveClass(/\bph\b/);
  await ph.hover();
  await expect(ph).toContainText('◎');
  await expect(ph).toContainText('? Breakthrough');
  await expect(ph).toContainText('Taurus–Littrow (regional) +2');
  await expect(page.locator('#tech-sheet-body')).toContainText('UNDISCOVERED — Survey Taurus–Littrow (regional), Aristarchus (near side) or Schrödinger (far side)');
  await page.keyboard.press('Escape');
  // found: it reads where
  await complete(page, ['prospectingRovers']);
  await supply(page);
  const found = await page.evaluate(() => {
    const g = window.__game;
    const trip = g.getLunar().prospects.find((p: any) => p.id === 'taurusLittrow').survey.timeS;
    g.surveyProspect('taurusLittrow');
    powered(trip + 2);
    return g.getResearch().cards.btVolcanicGlass;
  });
  expect(found.compass.found).toBe('Taurus–Littrow');
  expect(found.compass.text).toBe('Found at Taurus–Littrow');
  expect(found.state).not.toBe('hidden');
});

test('T1 has one outpost slot: the first outpost is an Era 1 goal, and T2 does not add one', async ({ page }) => {
  await start(page);
  expect((await g(page, 'getLunar')).slots).toBe(0);
  await complete(page, ['prospectingRovers']);
  await supply(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.advanceGameSeconds(1);
    const lunar = g.getLunar();
    g.surveyProspect('moltke');
    powered(62);
    g.claimOutpost('moltke');
    g.advanceGameSeconds(0);
    const claimed = g.getState();
    g.advanceGameSeconds(21);
    g.surveyProspect('maskelyne');
    powered(200);
    g.claimOutpost('maskelyne');
    g.advanceGameSeconds(0);
    return { lunar, claimed, full: g.getState() };
  });
  expect(r.lunar.slots).toBe(1);
  expect(r.claimed.survey.outposts.map((o: any) => o.id)).toEqual(['moltke']);
  expect(r.full.survey.outposts.length).toBe(1);
  expect(hasAlert(r.full, /^NO OUTPOST SLOT — 1\/1 in use · Far-Side Relay \(Era 6\) adds one$/)).toBe(true);
  // the sample cache and the claim line named it: a slot is there to use
  const rep = r.full.log.find((e: any) => e.text.startsWith('SURVEY COMPLETE — Moltke')).report;
  expect(rep.rewards.find((w: any) => w.tag === 'OUTPOST SITE').button.label).toBe('Claim');
  // orbit adds range, not a slot
  await complete(page, ['orbitalProspector']);
  expect((await g(page, 'getLunar')).slots).toBe(1);
});

test('Orbital Prospector: a Bay grows to four bays, and every flight is a third shorter', async ({ page }) => {
  await start(page);
  await complete(page, ['prospectingRovers']);
  const t1 = await page.evaluate(() => window.__game.getLunar().prospects.find((p: any) => p.id === 'maskelyne').survey.timeS);
  await complete(page, ['orbitalProspector']);
  await supply(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.advanceGameSeconds(1);
    const c = window.validCell('prospectingBay');
    g.placeBuilding('prospectingBay', c.gx, c.gz);
    g.finishConstruction();
    const t2 = g.getLunar().prospects.find((p: any) => p.id === 'maskelyne').survey.timeS;
    powered(4 * 46 + 2);
    return { t2, fleet: g.getFleet().survey, s: g.getState() };
  });
  expect(r.t2).toBe(Math.round(t1 / 1.5));
  expect(r.fleet).toMatchObject({ total: 5, cap: 5, baysEach: 4, level: 2 }); // the Lander's, and four bays
  expect(r.s.survey.prints).toEqual([]);
});

test('the flight is drawn: a drone lifts from its dock, leaves the map, and settles home', async ({ page }) => {
  await start(page);
  await supply(page);
  await page.evaluate(() => { window.__game.surveyProspect('moltke'); window.__game.advanceGameSeconds(3); });
  const info = () => page.evaluate(() => window.__game.getRenderInfo().life.survey);
  await expect.poll(async () => (await info()).flying).toBe(1);
  expect((await info()).drawn).toBe(1); // outbound: in sight
  await page.evaluate(() => window.__game.advanceGameSeconds(25));
  await expect.poll(async () => (await info()).offMap).toBe(1); // off the map, on its way
  expect((await info()).drawn).toBe(0);
  await page.evaluate(() => window.__game.advanceGameSeconds(40));
  await expect.poll(async () => (await info()).docked).toBe(1);
  expect((await info()).drawn).toBe(1);
});

test('an old save (a rover survey under way, no drones) loads with one Lander drone and the survey flies on', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await start(page);
  await complete(page, ['prospectingRovers']);
  await supply(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.advanceGameSeconds(1);
    const blob = g.saveBlob();
    const st = blob.state;
    // the schema-0 shape: no fleet, one rover-borne survey with the rover it lent
    for (const k of ['surveyDrones', 'flights', 'prints', 'nextSurveyDrone', 'surveySchema']) delete st.survey[k];
    st.survey.active = { id: 'moltke', startedAt: st.simTime - 10, endsAt: st.simTime + 50, rover: st.rovers[0].id };
    const lander = st.buildings.find((b: any) => b.type === 'lander').id;
    const t0 = st.simTime;
    g.loadBlob(blob);
    const loaded = g.getState();
    g.advanceGameSeconds(49);
    const before = g.getState();
    g.advanceGameSeconds(2);
    return { lander, loaded, before, after: g.getState(), simTime: t0 };
  });
  expect(r.loaded.survey.surveySchema).toBe(1);
  expect(r.loaded.survey.surveyDrones).toEqual([{ id: 1, home: r.lander }]);
  expect(r.loaded.survey.active).toBeNull();
  expect(r.loaded.survey.flights).toEqual([{ drone: 1, id: 'moltke', startedAt: r.simTime - 10, endsAt: r.simTime + 50 }]);
  expect(r.loaded.bots.total).toBe(2); // the rover it lent is back in the fleet
  // completes as if a drone flew it: on the same clock
  expect(r.before.survey.prospects.moltke).toBeUndefined();
  expect(r.after.survey.prospects.moltke).toMatchObject({ cls: 'local' });
  expect(r.after.survey.flights).toEqual([]);
  expect(hasAlert(r.after, /^SURVEY COMPLETE — Moltke crater ejecta/)).toBe(true);
  expect(errors).toEqual([]);
});
