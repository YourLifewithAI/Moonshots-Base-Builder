/** The destiny tracks (docs/14 §8, phases D2 and D6): one ⌂ Colony / ◉
 *  Automation pick per era, the landing as the first; picks gate their era's
 *  charter and count toward it; bands and capstones; Human Cohabitation
 *  brought forward or waived; the new effects (settlers, volleys, the
 *  autonomous cadence, EVA crews); the destiny column's commit flow, the
 *  meter and the pips; CREW HOME, the victory text per band, and the
 *  techSchema 3 → 4 migration. Every test pauses the game and drives time
 *  with advanceGameSeconds. */
import { test, expect as baseExpect, type Page } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 20_000 });

declare global {
  interface Window { __game?: any; climb?: (picks: string, upTo: number) => void }
}

const URL_DEBUG = '/?debug&seed=42&nolock&lowfx';

async function start(page: Page, site: string, exp: 'human' | 'robotic', extra = '') {
  await page.goto(`${URL_DEBUG}&site=${site}${exp === 'robotic' ? '&exp=robotic' : ''}${extra}`);
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
  await page.evaluate(CLIMB);
}

const g = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => window.__game[f as string](...(a as unknown[])), [fn, args] as const);
const hasAlert = (s: any, re: RegExp) => s.alerts.some((a: any) => re.test(a.text));

/** In-page: climb to `upTo` by charter — the era's three plain techs and its
 *  destiny pick, `picks[e − 1]` ('C' or 'A'; index 0 is the landing and is
 *  never picked). Debug completes skip prerequisites and goods. */
const CLIMB = `window.climb = (picks, upTo) => {
  const g = window.__game;
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
}`;

async function openTree(page: Page) {
  await page.keyboard.press('KeyT');
  await expect(page.locator('#tech-screen')).toBeVisible();
}

// ───────────────────────────── data ─────────────────────────────

test('data: a pick pair per era, 16 track techs and 3 capstones, each honest and relevant, none a doctrine', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  const r = await page.evaluate(async () => {
    const T = await import('/src/data/techs.ts');
    const R = await import('/src/core/research.ts');
    const S = await import('/src/data/sites.ts');
    const audit = window.__game.auditTechs() as { id: string; pros: number; cons: number; minConMagnitude: number }[];
    const track = T.TECH_ORDER.filter((t: string) => T.TECHS[t].track);
    const caps = T.TECH_ORDER.filter((t: string) => T.TECHS[t].band);
    const pairs = Object.entries(T.TRACKS).map(([e, p]: [string, any]) => [Number(e), T.TECHS[p.colony].track, T.TECHS[p.automation].track]);
    const doctrine = new Set(Object.values(T.DOCTRINES).flatMap((d: any) => d.members));
    const irrelevant: string[] = [];
    for (const site of S.SITE_ORDER) {
      for (const exp of ['robotic', 'human']) {
        for (const t of [...track, ...caps]) {
          const def = R.resolveTech(T.TECHS[t], exp);
          if (R.techVisible(def, { siteId: site, expedition: exp, discoveries: T.TECH_ORDER }) && !T.techRelevance(def, site, exp)) {
            irrelevant.push(`${t}@${site}:${exp}`);
          }
        }
      }
    }
    const judged = [...track, ...caps].filter((t: string) => !T.TECHS[t].track?.landing);
    return {
      n: T.TECH_ORDER.length, track: track.length, caps: caps.length, pairs,
      noVisual: [...track, ...caps].filter((t: string) => !(T.TECHS[t].visual ?? '').trim()),
      weak: judged.filter((t: string) => {
        const a = audit.find((x) => x.id === t)!;
        return !a || a.pros < 1 || a.cons < 1 || a.minConMagnitude <= 0;
      }),
      landingAudited: audit.some((a) => a.id === 'landingCrew' || a.id === 'landingRobotic'),
      doctrines: [...track, ...caps].filter((t: string) => doctrine.has(t) || T.TECHS[t].exclusive),
      irrelevant,
      swarmAny: T.TECHS.swarmProtocol.requiresAny,
      capReq: caps.map((t: string) => T.TECHS[t].requires),
      medians: Object.fromEntries([2, 3, 4, 5, 6, 7, 8].map((e) => [e, [T.TRACKS[e].colony, T.TRACKS[e].automation].map((t: string) => T.TECHS[t].costData)])),
      blurb8: Object.keys(T.ERA_BLURB_8),
    };
  });
  expect(r.n).toBe(125); // the merged tree's 106, plus the 19 destiny techs
  expect(r.track).toBe(16);
  expect(r.caps).toBe(3);
  for (const [e, c, a] of r.pairs) {
    expect(c.era, `era ${e}`).toBe(e);
    expect(c.side).toBe('colony');
    expect(a.era).toBe(e);
    expect(a.side).toBe('automation');
    expect(!!c.landing).toBe(e === 1);
  }
  expect(r.noVisual).toEqual([]);
  expect(r.weak).toEqual([]);
  expect(r.landingAudited).toBe(false); // the landing picks are exempt: their lines are the expedition's own
  expect(r.doctrines).toEqual([]);
  expect(r.irrelevant).toEqual([]);
  expect(r.swarmAny).toEqual(['missionControl', 'autoCadence']);
  expect(r.capReq).toEqual([['swarmProtocol'], ['swarmProtocol'], ['swarmProtocol']]);
  // each pick costs its era's median tech (docs/12 costs before ERA_COST_SCALE)
  expect(r.medians).toEqual({ 2: [120, 120], 3: [150, 150], 4: [240, 240], 5: [400, 400], 6: [1000, 1000], 7: [1125, 1125], 8: [1600, 1600] });
  expect(r.blurb8.sort()).toEqual(['automation', 'colony', 'concord']);
});

// ───────────────────────────── charters ─────────────────────────────

test('landing: the expedition is the Era 1 pick, done at landing, and it never counts toward Era 2', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  const robotic = await g(page, 'getState');
  expect(robotic.techsDone).toEqual(['landingRobotic']);
  expect(robotic.techSchema).toBe(4);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    for (const t of ['regolithProcessing', 'teleoperation', 'grizzlyScreens']) g.completeTech(t);
    g.advanceGameSeconds(1);
    const three = { era: g.getState().era, gate: g.getResearch().gates[0] };
    g.completeTech('fieldSpectrometers');
    g.advanceGameSeconds(1);
    return { three, four: { era: g.getState().era, gate: g.getResearch().gates[0] }, d: g.getDestiny() };
  });
  expect(r.three.era).toBe(1);
  expect(r.three.gate).toMatchObject({ techs: 3, open: false, destiny: null });
  expect(r.four.era).toBe(2);
  expect(r.four.gate).toMatchObject({ techs: 4, open: true, via: 'techs' });
  expect(r.d.picks[0]).toBe('automation');
  expect(r.d.a).toBe(1);
  await start(page, 'southpole', 'human');
  expect((await g(page, 'getState')).techsDone).toEqual(['landingCrew']);
  expect((await g(page, 'getDestiny')).picks[0]).toBe('colony');
});

test('the charter needs the pick: four Era-3 techs without it keep Era 4 shut; the pick counts as one', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  const r = await page.evaluate(() => {
    const g = window.__game!;
    window.climb!('AA', 3);
    const at3 = g.getState().era;
    for (const t of ['stackedCells', 'slagRecycling', 'refluxColumns', 'cryoSampleStore']) g.completeTech(t);
    g.advanceGameSeconds(1);
    const noPick = { era: g.getState().era, gate: g.getResearch().gates.find((x: any) => x.era === 4) };
    return { at3, noPick };
  });
  expect(r.at3).toBe(3);
  expect(r.noPick.era).toBe(3);
  expect(r.noPick.gate).toMatchObject({ techs: 4, via: 'techs', open: false });
  expect(r.noPick.gate.destiny).toMatchObject({ colony: 'crewCharter', automation: 'droneHives', tid: null, done: false });
  // the goals column says so
  await openTree(page);
  const goals = page.locator('.ph-goals');
  await expect(goals).toContainText('ERA GOALS → Era 4 CHIP FABRICATION');
  await expect(goals.locator('[data-g="ck-destiny"]')).toHaveText('◻');
  await expect(goals).toContainText('Destiny: choose ⌂ or ◉');
  await expect(goals).toContainText('(the destiny counts)');
  await page.keyboard.press('Escape');

  // the pick + 3: open
  await start(page, 'mare', 'robotic');
  const plus3 = await page.evaluate(() => {
    const g = window.__game!;
    window.climb!('AA', 3);
    for (const t of ['stackedCells', 'slagRecycling']) g.completeTech(t);
    g.pickDestiny(3, 'automation');
    g.advanceGameSeconds(1);
    const two = { era: g.getState().era, techs: g.getResearch().gates.find((x: any) => x.era === 4).techs };
    g.completeTech('refluxColumns');
    g.advanceGameSeconds(1);
    return { two, era: g.getState().era, gate: g.getResearch().gates.find((x: any) => x.era === 4) };
  });
  expect(plus3.two).toEqual({ era: 3, techs: 3 });
  expect(plus3.era).toBe(4);
  expect(plus3.gate).toMatchObject({ techs: 4, via: 'techs', open: true, destiny: { tid: 'droneHives', done: true } });

  // the pick + 1 + the deed (600◇ refined): open
  await start(page, 'mare', 'robotic');
  const deed = await page.evaluate(() => {
    const g = window.__game!;
    window.climb!('AA', 3);
    g.completeTech('stackedCells');
    g.pickDestiny(3, 'colony');
    const produced = g.getState().stats.produced;
    g.setStats({ produced: { ...produced, silicon: 600 } });
    g.advanceGameSeconds(1);
    return { era: g.getState().era, gate: g.getResearch().gates.find((x: any) => x.era === 4), s: g.getState() };
  });
  expect(deed.era).toBe(4);
  expect(deed.gate).toMatchObject({ techs: 2, via: 'deed', open: true });
  expect(hasAlert(deed.s, /^ERA 4 OPENS — CHIP FABRICATION · via 2 techs \+ 600◇ refined$/)).toBe(true);
});

test('foreclosure: queueing ⌂ forecloses ◉ until cancelled; done is permanent; a path never picks a destiny', async ({ page }) => {
  await start(page, 'mare', 'human');
  await page.evaluate(() => window.climb!('CC', 3));
  const read = () => page.evaluate(() => { window.__game.advanceGameSeconds(0); return window.__game.getResearch().cards; });
  await g(page, 'research', 'crewCharter');
  let c = await read();
  expect(c.crewCharter.state).toBe('queued');
  expect(c.droneHives.state).toBe('foreclosed');
  expect(c.droneHives.reason).toBe('foreclosed while Crew Rotation Charter is queued — cancel it to reopen');
  await g(page, 'research', 'droneHives');
  const refused = await g(page, 'getState');
  expect(refused.researchQueue).toEqual(['crewCharter']);
  expect(hasAlert(refused, /^FORECLOSED — Drone Hives while Crew Rotation Charter is queued — cancel it to reopen$/)).toBe(true);
  await g(page, 'cancelResearch', 'crewCharter');
  c = await read();
  expect(c.droneHives.state).toBe('available');
  expect(c.crewCharter.state).toBe('available');
  await g(page, 'completeTech', 'droneHives');
  c = await read();
  expect(c.crewCharter.state).toBe('foreclosed');
  expect(c.crewCharter.reason).toBe('foreclosed — your destiny chose Drone Hives');
  // a Shift-click path through Swarm Protocol stops at the Era 8 destiny instead of choosing it
  await page.evaluate(() => window.climb!('CCAAAAAA', 8));
  await g(page, 'researchPath', 'swarmProtocol');
  const path = await page.evaluate(() => { window.__game.advanceGameSeconds(0); return window.__game.getState(); });
  expect(path.researchQueue).toEqual([]);
  expect(hasAlert(path, /^PATH NEEDS A DESTINY — choose ⌂ Crewed Mission Control or ◉ Autonomous Cadence first$/)).toBe(true);
});

test('Human Cohabitation: the first Colony pick brings it forward (forwarded, never counted); ◉ Lights-Out waives it', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  const r = await page.evaluate(() => {
    const g = window.__game!;
    window.climb!('AA', 3);
    const t0 = g.getState().simTime;
    g.pickDestiny(3, 'colony'); // Crew Rotation Charter
    return { t0, s: g.getState(), unlocked: g.getResearch().cards.bunkRacks.state };
  });
  expect(r.s.techsDone).toContain('humanCohabitation');
  expect(r.s.forwarded).toEqual(['humanCohabitation']);
  expect(r.s.crewRotation).toEqual({ at: r.t0 + 240, count: 2 });
  expect(hasAlert(r.s, /^COLONY — the first crew is on its way: Human Cohabitation brought forward · rotation in 4:00$/)).toBe(true);
  expect(r.unlocked).not.toBe('crewLocked'); // crew techs open
  const u = await page.evaluate(async () => {
    const M = await import('/src/core/mods.ts');
    const s = window.__game.getState();
    const m = M.modsFor(s);
    return { habitat: m.unlocked.has('habitat'), hydro: m.unlocked.has('hydroponics') };
  });
  expect(u).toEqual({ habitat: true, hydro: true });
  // a later Colony pick does not reschedule the rotation
  const again = await page.evaluate(() => {
    const g = window.__game!;
    const at = g.getState().crewRotation.at;
    g.advanceGameSeconds(30);
    g.completeTech('hydroCommons');
    return { at, now: g.getState().crewRotation?.at, forwarded: g.getState().forwarded };
  });
  expect(again.now).toBe(again.at);
  expect(again.forwarded).toEqual(['humanCohabitation']);
  // the Era 7 gate: Cohabitation is satisfied, but the forwarded tech is not an Era-6 tech toward the charter
  const e7 = await page.evaluate(() => {
    const g = window.__game!;
    window.climb!('AAC' + 'AAA', 6);
    for (const t of ['solidStateCells', 'highBurnupFuel']) g.completeTech(t);
    g.pickDestiny(6, 'automation');
    g.advanceGameSeconds(1);
    return { era: g.getState().era, gate: g.getResearch().gates.find((x: any) => x.era === 7) };
  });
  expect(e7.gate.requires).toMatchObject({ tech: 'humanCohabitation', done: true });
  expect(e7.gate.techs).toBe(3); // two plain + the pick; the forwarded Cohabitation does not count
  expect(e7.era).toBe(6);

  // the waiver: pure Automation never needs a crew for Era 7
  await start(page, 'mare', 'robotic');
  const w = await page.evaluate(() => {
    const g = window.__game!;
    window.climb!('AAAAAA', 7);
    return { s: g.getState(), gate: g.getResearch().gates.find((x: any) => x.era === 7) };
  });
  expect(w.s.techsDone).not.toContain('humanCohabitation');
  expect(w.s.era).toBe(7);
  expect(w.gate.requires).toMatchObject({ done: false, waived: true });
  await openTree(page);
  await page.keyboard.press('BracketLeft');
  await expect(page.locator('#tech-page-head')).toHaveAttribute('data-era', '6');
  // a robotic Era 6 page before the pick says either destiny settles Cohabitation
  await start(page, 'mare', 'robotic');
  await page.evaluate(() => window.climb!('AAAAA', 6));
  await openTree(page);
  const goals = page.locator('.ph-goals');
  await expect(goals).toContainText('either destiny settles it: ⌂ brings the crew · ◉ waives it');
  await page.keyboard.press('Escape');
  await g(page, 'pickDestiny', 6, 'automation');
  await openTree(page);
  await expect(page.locator('.ph-goals [data-g="req"]')).toContainText('waived');
  await expect(page.locator('.ph-goals [data-g="ck-req"]')).toHaveText('✓');
});

// ───────────────────────────── bands ─────────────────────────────

for (const [picks, exp, band, cap] of [
  ['CCCCCCAA', 'human', 'colony', 'commonwealth'],
  ['AAAAAACC', 'robotic', 'automation', 'selenicMind'],
  ['CACACACA', 'human', 'concord', 'concord'],
] as const) {
  test(`bands: ${picks} is ${band}; only its capstone shows, after the Era 8 pick, behind Swarm Protocol`, async ({ page }) => {
    await start(page, 'mare', exp);
    const r = await page.evaluate(([p]) => {
      const g = window.__game!;
      window.climb!(p, 8);
      const before = { d: g.getDestiny(), c: g.getResearch().cards };
      g.pickDestiny(8, p[7] === 'C' ? 'colony' : 'automation');
      g.advanceGameSeconds(0);
      return { before, d: g.getDestiny(), c: g.getResearch().cards, era: g.getState().era };
    }, [picks]);
    expect(r.era).toBe(8);
    expect(r.before.d.band).toBeNull();
    for (const t of ['commonwealth', 'selenicMind', 'concord']) expect(r.before.c[t].state, t).toBe('hidden');
    expect(r.d.band).toBe(band);
    for (const t of ['commonwealth', 'selenicMind', 'concord']) {
      expect(r.c[t].state === 'hidden', t).toBe(t !== cap);
    }
    expect(r.c[cap].state).toBe('requires');
    expect(r.c[cap].reason).toBe('needs Swarm Protocol');
    // Swarm Protocol opens on the pick; Rail Capacitors is an optional follow-up now
    expect(['available', 'requires']).toContain(r.c.swarmProtocol.state);
    expect(r.c.swarmProtocol.reason).not.toMatch(/Rail Capacitor/);
  });
}

test('Era 8: Swarm Protocol takes either Era 8 pick; the page shows the capstone placeholder, then the band’s card', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  await page.evaluate(() => window.climb!('AAAAAAA', 8));
  const before = await g(page, 'getResearch');
  expect(before.cards.swarmProtocol.state).toBe('requiresAny');
  expect(before.cards.swarmProtocol.reason).toBe('needs Crewed Mission Control OR Autonomous Cadence');
  await openTree(page);
  await expect(page.locator('#tech-page-head')).toHaveAttribute('data-era', '8');
  const ph = page.locator('.tech-card.dph');
  await expect(ph).toHaveCount(1);
  await expect(ph).toContainText('Destiny capstone');
  await ph.click();
  await expect(page.locator('#tech-sheet-body')).toContainText('SETTLED BY THE ERA 8 PICK');
  await expect(page.locator('.ph-goals')).toContainText('FINAL GOAL · FIRST LIGHT');
  await expect(page.locator('.ph-goals [data-g="fl-destiny"]')).toHaveText('◻');
  await page.keyboard.press('Escape');
  await g(page, 'pickDestiny', 8, 'automation');
  const after = await g(page, 'getResearch');
  expect(after.cards.swarmProtocol.state).toBe('available');
  await openTree(page);
  await expect(page.locator('.tech-card.dph')).toHaveCount(0);
  await expect(page.locator('.tech-card[data-tech="selenicMind"]')).toBeVisible();
  await expect(page.locator('.ph-goals [data-g="fl-destiny"]')).toHaveText('✓');
  await expect(page.locator('.ph-goals')).toContainText('◉ Autonomous Cadence');
  await expect(page.locator('.ph-goals [data-g="fl-band"]')).toContainText('band: ◉ AUTOMATION 8/8 — pure · Selenic Mind unlocked');
  // the band's blurb
  await expect(page.locator('.ph-blurb')).toHaveText('The rail fires itself. Every volley is logged, not watched.');
});

// ───────────────────────────── the destiny column ─────────────────────────────

test('commit flow: a click only selects; the sheet shows both sides; Commit queues and forecloses the other', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  await page.evaluate(() => window.climb!('AA', 3));
  await g(page, 'grantData', 1000);
  await openTree(page);
  const head = page.locator('#tech-page-head');
  await expect(head.locator('.ph-destiny')).toContainText('DESTINY · choose one · permanent');
  await expect(head.locator('.ph-destiny')).toContainText('Who comes next: people, or more machines?');
  const col = head.locator('.dz-card[data-select="crewCharter"]');
  const aut = head.locator('.dz-card[data-select="droneHives"]');
  await expect(col).toHaveAttribute('data-side', 'colony');
  await expect(aut).toHaveAttribute('data-side', 'automation');
  // ⌂ left, ◉ right
  const [bc, ba] = [await col.boundingBox(), await aut.boundingBox()];
  expect(bc!.x).toBeLessThan(ba!.x);
  await expect(col.locator('.gl')).toHaveText('⌂');
  await expect(col.locator('.nm')).toHaveText('Crew Rotation Charter');
  await expect(col).toContainText('⊕ brings Human Cohabitation forward');
  await expect(col).toContainText('⊖');
  await expect(col).toContainText('Habitats wear a lit hab-ring collar');
  await expect(col).toContainText('[select]');
  await expect(aut).toContainText('⊕ UNLOCK Drone Hive');
  // no exposure or guard lines until the hazards ship
  await expect(head.locator('.ph-destiny')).not.toContainText('DOSE');
  // a click only selects
  await col.click();
  await page.waitForTimeout(400);
  expect((await g(page, 'getState')).researchQueue).toEqual([]);
  const sheet = page.locator('.dst-sheet');
  await expect(sheet).toContainText('DESTINY · CHOOSE ONE · PERMANENT');
  await expect(sheet.locator('.dst-side')).toHaveCount(2);
  await expect(sheet).toContainText('Your base');
  const commit = sheet.locator('button.commit[data-tech="crewCharter"]');
  await expect(commit).toHaveText('Commit to ⌂ Crew Rotation Charter — permanent');
  await commit.click();
  await expect.poll(async () => (await g(page, 'getState')).researchQueue).toEqual(['crewCharter']);
  await expect(col).toHaveClass(/st-queued/);
  await expect(aut).toHaveClass(/st-foreclosed/);
  await expect(sheet.locator('.dst-side[data-tech="droneHives"]')).toContainText('foreclosed while Crew Rotation Charter is queued — cancel it to reopen');
  await expect(sheet.locator('button[data-act="cancel"][data-tech="crewCharter"]')).toContainText('Cancel — reopens ◉ Drone Hives');
  // done is permanent: ✓ CHOSEN, the other struck through, the tab's pip
  await page.keyboard.press('Escape');
  await g(page, 'completeTech', 'crewCharter');
  await openTree(page);
  await expect(head.locator('.dz-card[data-select="crewCharter"]')).toHaveClass(/st-done/);
  await expect(head.locator('.dz-card[data-select="crewCharter"]')).toContainText('✓ CHOSEN');
  await expect(head.locator('.dz-card[data-select="droneHives"]')).toHaveClass(/st-foreclosed/);
  await expect(page.locator('.era-tab[data-era="3"] .et-pip')).toHaveText('⌂');
  await expect(page.locator('.era-tab[data-era="2"] .et-pip')).toHaveText('◉');
  await expect(page.locator('.era-tab[data-era="1"] .et-pip')).toHaveText('◉');
  await expect(page.locator('.era-tab[data-era="4"] .et-pip')).toHaveText('○');
});

test('the meter and the pips: the era column, its reach line, the era chip; Era 1 reads chosen at landing', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  await page.evaluate(() => window.climb!('AAC', 4));
  await openTree(page);
  const meter = page.locator('.ph-meter');
  await expect(meter.locator('.dm-pips')).toHaveText('◉◉⌂○○○○○');
  await expect(meter).toContainText('⌂1 · ◉2 · pure at 6 · 5 to choose');
  await expect(meter).toHaveAttribute('title', 'pure Colony: 5 of the 5 left · pure Automation: 4 of the 5 left · otherwise Concord');
  await expect(page.locator('#era-chip .chip-pips')).toHaveText('◉◉⌂○○○○○');
  // a future page's cards are read-only: dashed, and they wait for their era
  await page.locator('.era-tab[data-era="6"]').click();
  await expect(page.locator('.dz-card[data-select="settlerCharter"]')).toHaveClass(/st-future/);
  await expect(page.locator('.dz-card[data-select="settlerCharter"]')).toContainText('choose when Era 6 opens');
  await page.locator('.dz-card[data-select="settlerCharter"]').click();
  await expect(page.locator('.dst-sheet')).toContainText('opens with Era 6');
  await expect(page.locator('.dst-sheet button.commit')).toHaveCount(0);
  // Era 1: the landing, the other expedition greyed out
  await page.locator('.era-tab[data-era="1"]').click();
  await expect(page.locator('.ph-destiny')).toContainText('DESTINY · chosen at landing');
  await expect(page.locator('.dz-exp.chosen')).toContainText('◉ AUTOMATION · ✓ CHOSEN');
  await expect(page.locator('.dz-exp.other')).toContainText('HUMAN CREW');
  await expect(page.locator('.ph-goals')).not.toContainText('Destiny:');
});

// ───────────────────────────── effects ─────────────────────────────

test('effects: settlers ×1.5, the crewed volley on 2↑ with 4 on console, EVA crews by day', async ({ page }) => {
  // settlers: growth ×2/3 brings an arrival in 480 s
  await start(page, 'mare', 'human');
  const grow = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('crewCharter');
    g.grantResources({ oxygen: 400, food: 400, water: 300 });
    const c0 = g.getState().crew;
    let t = 0;
    while (g.getState().crew === c0 && t < 800) { g.advanceGameSeconds(10); t += 10; }
    return { c0, t, crew: g.getState().crew, growthT: g.getState().growthT };
  });
  expect(grow.crew).toBe(grow.c0 + 1);
  expect(grow.t).toBeGreaterThanOrEqual(480);
  expect(grow.t).toBeLessThan(500);

  // Crewed Mission Control: 2↑ with 4 crew, refused with 3; a lunar day's lift
  await start(page, 'mare', 'human');
  const vol = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('missionControl');
    g.completeTech('swarmProtocol');
    g.grantCrew(3 - g.getState().crew);
    g.grantResources({ foils: 10, launch: 2 });
    g.grantPower(1000);
    g.launch();
    g.advanceGameSeconds(0);
    const three = g.getState();
    g.grantCrew(1);
    g.launch();
    g.advanceGameSeconds(0);
    return { three, four: g.getState(), v: g.getDestiny().volley };
  });
  expect(vol.three.launches).toBe(0);
  expect(hasAlert(vol.three, /^A VOLLEY NEEDS 4 CREW ON CONSOLE — have 3; without them a volley needs 3↑$/)).toBe(true);
  expect(vol.four.launches).toBe(1);
  expect(vol.four.resources.launch).toBeCloseTo(0, 6);
  expect(vol.four.launchDayUntil).toBeCloseTo(vol.four.simTime + 720, 0);
  expect(vol.v).toMatchObject({ launch: 2, crewed: true, minCrew: 4 });

  // EVA crews: free hands × 10%, by day; dust recovers ×1.3
  await start(page, 'mare', 'human');
  const eva = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('crewCharter');
    g.advanceGameSeconds(1);
    const s = g.getState();
    return { crew: s.crew, eva: s.evaCrew };
  });
  expect(eva.eva).toBe(Math.ceil(eva.crew * 0.1)); // nobody is at a station yet: every hand is free
  expect(eva.eva).toBeGreaterThan(0);
  // dust clears ×1.3 while EVA crews are out: (0.2 × 1.3 − 0.08) / (0.2 − 0.08) = 1.5 × the net recovery
  const cleared = async (charter: boolean) => {
    await start(page, 'mare', 'human');
    return page.evaluate((c) => {
      const g = window.__game!;
      if (c) g.completeTech('crewCharter');
      g.placeBuilding('solar', 132, 126);
      g.finishConstruction();
      const id = g.getState().buildings.find((b: any) => b.type === 'solar').id;
      g.setDust(id, 0.4);
      g.advanceGameSeconds(120);
      const b = g.getState().buildings.find((x: any) => x.id === id);
      return { d: 0.4 - b.dust, eva: g.getState().evaCrew };
    }, charter);
  };
  const plain = await cleared(false);
  const withEva = await cleared(true);
  expect(plain.eva).toBe(0);
  expect(withEva.eva).toBeGreaterThan(0);
  expect(withEva.d / plain.d).toBeCloseTo(1.5, 2);
});

test('Autonomous Cadence: the volley fires itself once ready, keeps the night’s reserve, one a tick', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('autoCadence');
    g.completeTech('swarmProtocol');
    g.grantResources({ foils: 20, launch: 6 });
    // the Lander's bank alone: a 300 burst leaves nothing for a night that needs the rest
    const st0 = g.getState();
    g.grantPower(1000);
    g.advanceGameSeconds(1);
    const s1 = g.getState();
    g.advanceGameSeconds(1);
    return { st0, s1, s2: g.getState(), v: g.getDestiny().volley };
  });
  expect(r.v).toMatchObject({ auto: true, launch: 3, burst: 300 });
  expect(r.s1.launches).toBe(1); // one volley that tick, although the stock holds two
  expect(r.s1.resources.foils).toBeCloseTo(10, 6);
  expect(r.s2.launches).toBeLessThanOrEqual(2);
  expect(r.s1.milestonesDone).toContain('first-light');
  // the reserve: a bank that cannot keep the night's need after the burst holds the volley
  await start(page, 'mare', 'robotic');
  const held = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('autoCadence');
    g.completeTech('swarmProtocol');
    // loads the night cannot carry: labs with no panels
    for (const [x, z] of [[134, 126], [120, 126], [127, 134]]) g.placeBuilding('lab', x, z);
    g.finishConstruction();
    g.advanceGameSeconds(470 - g.getState().simTime); // near dusk, the bank full-ish
    g.grantResources({ foils: 10, launch: 3 });
    const s = g.getState();
    g.grantPower(Math.max(0, 420 - s.powerStored));
    g.advanceGameSeconds(1);
    return g.getState();
  });
  expect(held.launches).toBe(0);
  expect(hasAlert(held, /^AUTONOMOUS CADENCE HOLDING — the volley waits until the bank keeps \d+ for the night$/)).toBe(true);
});

// ───────────────────────────── the ending ─────────────────────────────

test('CREW HOME: a crewed landing gone pure Automation sends its last crew home at FIRST LIGHT — no defeat', async ({ page }) => {
  test.setTimeout(180_000);
  await start(page, 'mare', 'human');
  const r = await page.evaluate(() => {
    const g = window.__game!;
    window.climb!('CAAAAAAA', 6);
    const grow0 = g.getState().growthT;
    g.pickDestiny(6, 'automation'); // Lights-Out Charter: no new settlers are invited
    g.grantResources({ oxygen: 400, food: 400, water: 300 });
    const crew6 = g.getState().crew;
    g.advanceGameSeconds(1500);
    const crewLater = g.getState().crew;
    window.climb!('CAAAAAAA', 8);
    g.pickDestiny(8, 'automation');
    g.completeTech('swarmProtocol');
    // a crewed station that must go Autonomous
    g.placeBuilding('lab', 134, 126);
    g.finishConstruction();
    g.grantResources({ foils: 10, launch: 3 });
    g.grantPower(2000);
    const before = g.getState();
    g.launch();
    g.advanceGameSeconds(5);
    return { grow0, crew6, crewLater, before, after: g.getState(), d: g.getDestiny() };
  });
  expect(r.crewLater).toBeLessThanOrEqual(r.crew6); // growth stopped at the Era 6 pick
  expect(r.d.band).toBe('automation');
  expect(r.before.crew).toBeGreaterThan(0);
  expect(r.after.launches).toBe(1);
  expect(r.after.crew).toBe(0);
  expect(r.after.crewHome).toBe(true);
  expect(r.after.defeatShown).toBe(false);
  const crewed = r.after.buildings.filter((b: any) => ['lab', 'smelter', 'refinery', 'partsFab', 'chipFab'].includes(b.type));
  expect(crewed.length).toBeGreaterThan(0);
  expect(crewed.every((b: any) => b.automated)).toBe(true);
  expect(hasAlert(r.after, new RegExp(`^CREW HOME — the last ${r.before.crew} crew board the rotation home; the Moon runs itself$`))).toBe(true);
  await expect(page.locator('#victory-screen')).toBeVisible();
  await expect(page.locator('#victory-band')).toContainText('THE LIGHTS-OUT MOON');
  await expect(page.locator('#victory-body')).toContainText('The last crew rotated home on the volley’s day.');
  await expect(page.locator('#victory-pips')).toHaveText('⌂◉◉◉◉◉◉◉');
  // days later the base still runs, unmanned
  await page.locator('#btn-victory-continue').click();
  const later = await page.evaluate(() => { window.__game.advanceGameSeconds(800); return window.__game.getState(); });
  expect(later.crew).toBe(0);
  expect(later.defeatShown).toBe(false);

  // a Concord band keeps its crew
  await start(page, 'mare', 'human');
  const concord = await page.evaluate(() => {
    const g = window.__game!;
    window.climb!('CACACACA', 8);
    g.pickDestiny(8, 'automation');
    g.completeTech('swarmProtocol');
    g.grantResources({ foils: 10, launch: 3 });
    g.grantPower(2000);
    const crew = g.getState().crew;
    g.launch();
    g.advanceGameSeconds(2);
    return { crew, s: g.getState(), d: g.getDestiny() };
  });
  expect(concord.d.band).toBe('concord');
  expect(concord.s.launches).toBe(1);
  expect(concord.s.crewHome).toBe(false);
  expect(concord.s.crew).toBe(concord.crew);
});

for (const [picks, exp, title, body] of [
  ['CCCCCCCC', 'human', 'THE COMMONWEALTH', 'The Moon has citizens now.'],
  ['AAAAAAAA', 'robotic', 'THE LIGHTS-OUT MOON', 'No one has ever lived here.'],
  ['CACACACA', 'human', 'THE CONCORD', 'on console and'],
] as const) {
  test(`victory text: ${title}`, async ({ page }) => {
    await start(page, 'mare', exp);
    await page.evaluate(([p]) => {
      const g = window.__game!;
      window.climb!(p, 8);
      g.pickDestiny(8, p[7] === 'C' ? 'colony' : 'automation');
      g.completeTech('swarmProtocol');
      g.grantCrew(Math.max(0, (p[7] === 'C' ? 5 : 0) - g.getState().crew));
      g.grantResources({ foils: 10, launch: 3 });
      g.grantPower(2000);
      g.launch();
      g.advanceGameSeconds(2);
    }, [picks]);
    await expect(page.locator('#victory-screen')).toBeVisible();
    await expect(page.locator('#victory-band')).toContainText(title);
    await expect(page.locator('#victory-body')).toContainText(body);
    await expect(page.locator('#victory-pips')).toHaveText(picks.replace(/C/g, '⌂').replace(/A/g, '◉'));
    if (title === 'THE LIGHTS-OUT MOON') await expect(page.locator('#victory-lead')).toContainText(/^Volley one left at T\+\d+:\d\d:\d\d$/);
    else await expect(page.locator('#victory-lead')).toHaveText('Volley one is away');
  });
}

// ───────────────────────────── migration ─────────────────────────────

test('migration: a techSchema-3 save in Era 5 gains its landing pick, keeps its era, and opens its old picks as leftovers', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await start(page, 'mare', 'robotic');
  const old = ['regolithProcessing', 'teleoperation', 'grizzlyScreens', 'fieldSpectrometers',
    'siliconRefining', 'partsFabrication', 'constructionRobotics', 'batteryStorage',
    'thoriumPower', 'swarmRobotics', 'stackedCells', 'slagRecycling',
    'waferFab', 'acceleratorDesign', 'waferPolishing', 'oreSorting', 'foilManufacturing'];
  const legacy = await page.evaluate((done) => {
    const st = window.__game.getState();
    st.techSchema = 3;
    st.era = 5;
    st.techsDone = done;
    st.researchQueue = ['swarmProtocol'];
    st.researchSpent = { swarmProtocol: 90 };
    st.alerts = [];
    for (const k of ['forwarded', 'crewHome', 'launchDayUntil', 'evaCrew']) delete st[k];
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
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
  const r = await page.evaluate(() => ({ s: window.__game.getState(), v: window.__game.getResearch() }));
  expect(r.s.techSchema).toBe(4);
  expect(r.s.era).toBe(5);
  expect(r.s.techsDone).toEqual(['landingRobotic', ...old]);
  expect(r.s.forwarded).toEqual([]);
  expect(r.s.crewHome).toBe(false);
  // Swarm Protocol was queued without an Era 8 pick (it was era-locked too): dropped, its data kept banked
  expect(r.s.researchQueue).toEqual([]);
  expect(r.s.researchSpent.swarmProtocol).toBe(90);
  expect(hasAlert(r.s, /^DESTINIES — every era now has a track choice \(T\)\. Past eras’ choices are open at their old prices\.$/)).toBe(true);
  // past eras' picks: open as leftovers at their era's price
  for (const [c, a] of [['pressureHalls', 'dispatchMesh'], ['crewCharter', 'droneHives'], ['hydroCommons', 'lightsOutFabs']]) {
    expect(r.v.cards[c].state, c).toBe('available');
    expect(r.v.cards[a].state, a).toBe('available');
  }
  const scale = await page.evaluate(async () => (await import('/src/data/balance.ts')).ERA_COST_SCALE as Record<number, number>);
  expect(r.v.cards.crewCharter.cost.data).toBe(Math.round(150 * scale[3]));
  // Era 6 still needs this era's pick
  expect(r.v.gates.find((x: any) => x.era === 6).destiny).toMatchObject({ colony: 'greenhouseRings', done: false });
  expect(r.v.gates.find((x: any) => x.era === 6).open).toBe(false);
  expect(errors).toEqual([]);
});
