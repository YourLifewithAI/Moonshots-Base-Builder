/** One notification system (docs/19 S7): five families (research, field, era,
 *  weather, hazard), each in its own container with its own class, glyph, place,
 *  colour rule, sound and pause behaviour; the Pause on… rows in the menu; the
 *  Log (every notification, newest first, saved); and the alert actions that
 *  open the map at a prospect, the tree at a tech, or a building. Test runs
 *  (?debug) draw no cards unless they ask, so every test here passes `&tips`. */
import { test, expect as baseExpect, type Page } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 20_000 });

declare global {
  interface Window { __game?: any; climb?: (upTo: number) => void }
}

const BASE = '/?debug&seed=42&nolock&lowfx';

async function boot(page: Page, extra = '', settings?: Record<string, unknown>, exp: 'human' | 'robotic' = 'robotic') {
  if (settings) await page.addInitScript((s) => localStorage.setItem('mbb-settings', JSON.stringify(s)), settings);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`${BASE}&site=mare${exp === 'robotic' ? '&exp=robotic' : ''}&tips${extra}`);
  await page.waitForFunction(() => window.__game !== undefined);
}

const g = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => window.__game[f as string](...(a as unknown[])), [fn, args] as const);
const paused = async (page: Page) => (await g(page, 'getState')).paused as boolean;
const played = async (page: Page) => (await g(page, 'getAudio')).played as Record<string, number>;

/** the mission opens on the era 1 explainer (it pauses); Begin */
async function begin(page: Page) {
  const banner = page.locator('#era-banner');
  await expect(banner).toBeVisible();
  await banner.locator('[data-dsc="ok"]').click();
  await expect(banner).toBeHidden();
}

/** a card's family rule: its width and colour on the side it is drawn */
const rule = (page: Page, sel: string, side: 'Left' | 'Top') => page.evaluate(([s, sd]) => {
  const e = document.querySelector(s as string) as HTMLElement;
  const c = getComputedStyle(e);
  return { w: c.getPropertyValue(`border-${(sd as string).toLowerCase()}-width`), color: c.getPropertyValue(`border-${(sd as string).toLowerCase()}-color`) };
}, [sel, side]);

/** something covers the element's centre: a modal card or banner is over it, so a click cannot reach it */
const underBanner = (page: Page, sel: string) => page.evaluate((s) => {
  const e = document.querySelector(s) as HTMLElement;
  const r = e.getBoundingClientRect();
  const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return !!top && top !== e && !e.contains(top);
}, sel);

const FIELD_CARD = {
  text: 'SURVEY COMPLETE — Marius Hills · +12≡ · ilmenite outpost possible',
  action: { map: 'moltke' },
  report: {
    title: 'Marius Hills pit', geology: 'a skylight into a lava tube, about 100 m across',
    rewards: [
      { tag: 'DATA', text: '+12≡ banked' },
      { tag: 'BREAKTHROUGH', text: 'Lava Tube Caverns — researchable in Era 4', button: { label: 'In the tree', action: { tech: 'regolithProcessing' } } },
      { tag: 'OUTPOST SITE', text: 'ilmenite 0.20/s · claim 60◆', button: { label: 'Open the map', action: { map: 'moltke' } } },
    ],
  },
};

/** In-page: climb to era `upTo` on the ⌂ picks (debug completes skip prerequisites and goods) */
const CLIMB = `(() => {
  const g = window.__game;
  const PLAIN = { 1: ['regolithProcessing', 'teleoperation', 'grizzlyScreens', 'fieldSpectrometers'],
    2: ['siliconRefining', 'partsFabrication', 'constructionRobotics'] };
  window.climb = (upTo) => {
    for (let e = 1; e < upTo; e++) {
      for (const t of PLAIN[e]) g.completeTech(t);
      if (e >= 2) g.pickDestiny(e, 'colony');
      g.advanceGameSeconds(1);
    }
  };
})()`;

/** In-page: a habitat, then its first breach (a drill) run to its end: the hazard's drill card is queued */
const DRILL = `(() => {
  const g = window.__game;
  window.climb(3);
  g.grantResources({ metals: 400, parts: 200, silicon: 200, chips: 60 });
  let hab = null;
  for (let r = 3; r < 40 && hab === null; r++) {
    for (let gx = 127 - r; gx <= 127 + r && hab === null; gx++) for (const gz of [127 - r, 127 + r]) {
      if (g.canPlace('habitat', gx, gz, 0).valid && g.placeBuilding('habitat', gx, gz, 0)) {
        const s = g.getState(); hab = s.buildings[s.buildings.length - 1].id; break;
      }
    }
  }
  g.finishConstruction();
  g.advanceGameSeconds(1);
  g.forceHazard('breach', hab);
  const h = g.getHazards().state.live.find((x) => x.kind === 'breach');
  g.advanceGameSeconds(h.at - g.getState().simTime + 200);
  return hab;
})()`;

/** click through the cards queued before the hazard's (the landing, the era explainers), one a beat */
async function toDrillCard(page: Page) {
  const card = page.locator('#hazard-card');
  for (let i = 0; i < 80; i++) {
    if (await card.isVisible() && /NEW HAZARD/.test((await card.textContent()) ?? '')) return;
    await page.evaluate(() => {
      const banner = document.getElementById('era-banner')!;
      const b = banner.style.display !== 'none' ? banner.querySelector<HTMLElement>('[data-dsc="ok"]')
        : document.querySelector<HTMLElement>('#discovery-card [data-dsc="ok"]');
      b?.click();
    });
    await page.waitForTimeout(150);
  }
  await expect(card).toContainText('NEW HAZARD');
}

test('the five families: each renders in its own container, with its own class, glyph and 3 px rule', async ({ page }) => {
  test.setTimeout(180_000);
  await boot(page, '&flarepause');
  const rules: Record<string, string> = {};

  // era: the full-screen banner, paper rule, until Continue
  const banner = page.locator('#era-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveClass(/nf-era/);
  await expect(banner.locator('.eb-k')).toContainText('⚑');
  const er = await rule(page, '#era-banner .eb-panel', 'Top');
  expect(er.w).toBe('3px');
  rules.era = er.color;
  expect(await paused(page)).toBe(true);
  await banner.locator('[data-dsc="ok"]').click();
  await expect(banner).toBeHidden();
  expect(await paused(page)).toBe(false);

  // research: a top-centre card, blue rule, the lane's glyph, never pauses
  await g(page, 'completeTech', 'regolithProcessing');
  const research = page.locator('#discovery-card');
  await expect(research).toBeVisible();
  await expect(research).toHaveClass(/nf-research/);
  await expect(research.locator('.dsc-head')).toContainText('Research complete');
  await expect(research.locator('.nf-g')).toHaveText('✦');
  const rr = await rule(page, '#discovery-card', 'Left');
  expect(rr.w).toBe('3px');
  rules.research = rr.color;
  expect(await paused(page)).toBe(false);
  const rb = await research.boundingBox();
  expect(Math.abs(rb!.x + rb!.width / 2 - 683)).toBeLessThan(2);
  expect(rb!.y).toBeLessThan(120);
  await research.locator('[data-dsc="ok"]').click();

  // field: a dispatch card lower left with a title, a geology line, a line per reward and a button each; a chirp; never pauses
  const chirps = (await played(page)).chirp;
  await g(page, 'notify', 'field', FIELD_CARD);
  const field = page.locator('#field-card');
  await expect(field).toBeVisible();
  await expect(field).toHaveClass(/nf-field/);
  await expect(field.locator('.nf-g')).toHaveText('◎');
  await expect(field.locator('.fc-title')).toHaveText('Marius Hills pit');
  await expect(field.locator('.fc-geo')).toContainText('a skylight into a lava tube');
  await expect(field.locator('.fc-rw')).toHaveCount(3);
  await expect(field.locator('.fc-btn')).toHaveCount(2);
  const fr = await rule(page, '#field-card', 'Left');
  expect(fr.w).toBe('3px');
  rules.field = fr.color;
  const fb = await field.boundingBox();
  expect(fb!.x).toBeLessThan(60);
  // on the left, above the objectives (inside the first-mine guide's stack while that stands), never over them
  const below = await page.evaluate(() => {
    const e = [document.getElementById('first-mine-stack'), document.getElementById('milestones')].find((x) => x && x.offsetParent !== null);
    return e ? e.getBoundingClientRect().top : 768;
  });
  expect(fb!.y).toBeGreaterThan(0);
  expect(fb!.y + fb!.height).toBeLessThanOrEqual(below + 1);
  expect(fb!.y + fb!.height).toBeGreaterThan(below - 40);
  expect((await played(page)).chirp).toBeGreaterThan(chirps);
  expect(await paused(page)).toBe(false);

  // weather: the flare pop-up, amber rule, ☉, its own cue; an M flare pauses (menu setting, default M and X)
  const flares = (await played(page)).flare;
  await g(page, 'forceFlare', 'M', { drill: false });
  await g(page, 'advanceGameSeconds', 2);
  const wx = page.locator('#flare-popup');
  await expect(wx).toBeVisible();
  await expect(wx).toHaveClass(/nf-weather/);
  await expect(wx).toContainText('☉');
  const wr = await rule(page, '#flare-popup', 'Left');
  expect(wr.w).toBe('3px');
  rules.weather = wr.color;
  expect((await played(page)).flare).toBeGreaterThan(flares);
  await expect.poll(() => paused(page)).toBe(true);
  // ...and the research card makes room under it: never the same slot
  await g(page, 'completeTech', 'teleoperation');
  await expect(research).toBeVisible();
  const wb = await wx.boundingBox();
  const rb2 = await research.boundingBox();
  expect(rb2!.y).toBeGreaterThanOrEqual(wb!.y + wb!.height - 1);

  // hazard: a raised alert lands on the stack under the hazard class (its card is the drill's, next test)
  const hr = await page.evaluate(() => {
    const c = document.createElement('div');
    c.className = 'nf nf-hazard';
    document.body.appendChild(c);
    const col = getComputedStyle(c).getPropertyValue('--nf').trim();
    c.remove();
    return col;
  });
  rules.hazard = hr;
  // five families, five distinct rules, five distinct containers
  expect(new Set(Object.values(rules)).size).toBe(5);
  const ids = await page.evaluate(() => ['era-banner', 'discovery-card', 'field-card', 'flare-popup', 'hazard-card'].map((i) => !!document.getElementById(i)));
  expect(ids).toEqual([true, true, true, true, true]);
});

test('the alert stack: a glyph and a class per family, crit alerts are hazards, a plain event has neither', async ({ page }) => {
  await boot(page);
  await begin(page);
  const GLYPH: Record<string, string> = { research: '✦', field: '◎', era: '⚑', weather: '☉', hazard: '⚠' };
  // an ordinary event (the landing) belongs to no family: a quiet dot and no rule
  const touchdown = page.locator('#alerts .alert', { hasText: 'TOUCHDOWN' });
  await expect(touchdown).toHaveClass(/nf-plain/);
  await expect(touchdown.locator('.alert-g')).toHaveText('·');
  for (const fam of Object.keys(GLYPH)) {
    await g(page, 'notify', fam, { text: `TEST ${fam.toUpperCase()} LINE` });
    const line = page.locator('#alerts .alert', { hasText: `TEST ${fam.toUpperCase()} LINE` });
    await expect(line).toHaveClass(new RegExp(`nf-${fam}`));
    await expect(line.locator('.alert-g')).toHaveText(GLYPH[fam]);
    expect(await line.evaluate((e) => getComputedStyle(e).borderLeftWidth)).toBe('3px');
  }
  // a critical alert keeps its family; one with none is a hazard (core/economy.ts alert())
  await g(page, 'notify', 'weather', { text: 'TEST CRIT LINE', kind: 'crit' });
  await expect(page.locator('#alerts .alert.crit', { hasText: 'TEST CRIT LINE' })).toHaveClass(/nf-weather/);
  const log = (await g(page, 'getState')).log as any[];
  expect(log.find((e) => e.text === 'TOUCHDOWN — begin with a Solar Array')?.family).toBeUndefined();
  expect(log.find((e) => e.text === 'TEST FIELD LINE')?.family).toBe('field');
});

test('pause policy: era holds until Continue; research and field never pause; weather by the menu setting (M and X)', async ({ page }) => {
  test.setTimeout(180_000);
  await boot(page, '&flarepause');
  // era: paused under the banner; it covers the HUD, and neither a speed key nor the button lifts the pause
  const banner = page.locator('#era-banner');
  await expect(banner).toBeVisible();
  expect(await paused(page)).toBe(true);
  expect(await underBanner(page, '#time-controls button:nth-child(3)')).toBe(true);
  await page.keyboard.press('Digit2');
  await page.locator('#time-controls button', { hasText: '3×' }).dispatchEvent('click');
  await page.waitForTimeout(300);
  expect(await paused(page)).toBe(true);
  await banner.locator('[data-dsc="ok"]').click();
  expect(await paused(page)).toBe(false);
  // research and field: never
  await g(page, 'completeTech', 'regolithProcessing');
  await g(page, 'notify', 'field', FIELD_CARD);
  await expect(page.locator('#discovery-card')).toBeVisible();
  await expect(page.locator('#field-card')).toBeVisible();
  await page.waitForTimeout(500);
  expect(await paused(page)).toBe(false);
  // weather, default M and X: a C flare does not pause
  await g(page, 'forceFlare', 'C', { drill: false });
  await g(page, 'advanceGameSeconds', 2);
  await expect(page.locator('#flare-popup')).toBeVisible();
  await page.waitForTimeout(500);
  expect(await paused(page)).toBe(false);
});

test('pause policy: an M flare pauses by default, not with the setting off; All pauses a C', async ({ page, browser }) => {
  test.setTimeout(240_000);
  await boot(page, '&flarepause');
  await begin(page);
  await g(page, 'forceFlare', 'M', { drill: false });
  await g(page, 'advanceGameSeconds', 2);
  await expect.poll(() => paused(page)).toBe(true);

  for (const [set, cls, want] of [['off', 'M', false], ['all', 'C', true]] as const) {
    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await boot(p2, '&flarepause', { pauseFlares: set });
    await begin(p2);
    await g(p2, 'forceFlare', cls, { drill: false });
    await g(p2, 'advanceGameSeconds', 2);
    await expect(p2.locator('#flare-popup')).toBeVisible();
    await p2.waitForTimeout(600);
    expect(await paused(p2), `pauseFlares ${set}, a ${cls} flare`).toBe(want);
    await ctx.close();
  }
});

test('pause policy: the hazard drill card holds the pause; the menu setting turns that off', async ({ page, browser }) => {
  test.setTimeout(300_000);
  await boot(page, '', undefined, 'human');
  await page.evaluate(CLIMB);
  await g(page, 'setPaused', true);
  await page.evaluate(DRILL);
  await toDrillCard(page);
  const card = page.locator('#hazard-card');
  await expect(card).toHaveClass(/nf-hazard/);
  await expect(card.locator('.eb-k .nf-g')).toHaveText('⚠');
  expect((await rule(page, '#hazard-card .eb-panel', 'Top')).w).toBe('3px');
  await expect(card).toContainText('Next time, the people inside die');
  await expect(card).toHaveClass(/holds/);
  await expect.poll(() => paused(page)).toBe(true);
  // it covers the HUD and holds the pause (a modal); a speed key stays paused; Continue lifts it
  expect(await underBanner(page, '#time-controls button:nth-child(3)')).toBe(true);
  await page.keyboard.press('Digit2');
  await page.waitForTimeout(300);
  expect(await paused(page)).toBe(true);
  await card.locator('[data-dsc="ok"]').click();
  await expect(card).toBeHidden();
  await expect.poll(() => paused(page)).toBe(false);

  // with "Hazard drills" off the card still shows, but nothing holds the game
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await boot(p2, '', { pauseDrills: false }, 'human');
  await p2.evaluate(CLIMB);
  await g(p2, 'setPaused', true);
  await p2.evaluate(DRILL);
  await toDrillCard(p2);
  const card2 = p2.locator('#hazard-card');
  await expect(card2).toBeVisible();
  await expect(card2).not.toHaveClass(/holds/);
  await g(p2, 'setPaused', false);
  await p2.waitForTimeout(500);
  expect(await paused(p2)).toBe(false);
  await p2.locator('#time-controls button', { hasText: '3×' }).click();
  expect((await g(p2, 'getState')).speed).toBe(3);
  await card2.locator('[data-dsc="ok"]').click();
  await expect(card2).toBeHidden();
  await ctx.close();
});

test('the menu\'s Pause on… rows: flares, drills, new hazards, lethal warnings; era is fixed; research and field never', async ({ page }) => {
  await boot(page);
  await begin(page);
  await page.keyboard.press('Escape');
  const block = page.locator('#menu-pause');
  await expect(block).toBeVisible();
  await expect(block.locator('.label')).toHaveText('Pause on…');
  await expect(block.locator('.menu-row')).toHaveCount(5);
  await expect(block.locator('#menu-pause-era')).toHaveText('Until Continue');
  await expect(block).toContainText('Research ✦ and field ◎ notifications never pause the game');
  await expect(page.locator('#menu-pause-flares')).toHaveText('M and X');
  await expect(page.locator('#menu-pause-drills')).toHaveText('On');
  await expect(page.locator('#menu-pause-hz')).toHaveText('On');
  await expect(page.locator('#menu-pause-lethal')).toHaveText('Off');
  await page.locator('#menu-pause-drills').click();
  await expect(page.locator('#menu-pause-drills')).toHaveText('Off');
  await page.locator('#menu-pause-flares').click();
  await expect(page.locator('#menu-pause-flares')).toHaveText('All');
  await page.locator('#menu-pause-flares').click();
  await expect(page.locator('#menu-pause-flares')).toHaveText('Off');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mbb-settings') ?? '{}'));
  expect(saved).toMatchObject({ pauseDrills: false, pauseFlares: 'off', pauseHazards: true, pauseLethal: false });
  await page.locator('#menu [data-act="resume"]').click();
});

test('the log lists every family, newest first, with glyphs; the weather panel is a filtered view; it survives a reload', async ({ page }) => {
  test.setTimeout(180_000);
  await boot(page);
  await begin(page);
  const texts: Record<string, string> = {
    research: 'LOG TEST research', field: 'LOG TEST field', era: 'LOG TEST era', weather: 'LOG TEST weather', hazard: 'LOG TEST hazard',
  };
  for (const [fam, text] of Object.entries(texts)) await g(page, 'notify', fam, { text });
  await g(page, 'notify', 'weather', { text: 'LOG TEST weather two', action: { panel: 'weather' } });
  await page.locator('#log-btn').click();
  const log = page.locator('#notify-log');
  await expect(log).toBeVisible();
  const rows = log.locator('.nl-row');
  // newest first: the last raised leads, the landing's own line is last
  await expect(rows.first()).toContainText('LOG TEST weather two');
  await expect(rows.last()).toContainText('TOUCHDOWN');
  for (const [fam, text] of Object.entries(texts)) {
    const row = log.locator('.nl-row', { hasText: new RegExp(`${text}(?! two)`) }).first();
    await expect(row).toHaveClass(new RegExp(`nf-${fam}`));
    await expect(row.locator('.nl-g')).toHaveText({ research: '✦', field: '◎', era: '⚑', weather: '☉', hazard: '⚠' }[fam]!);
  }
  // a row with an action is a button
  await expect(log.locator('.nl-row', { hasText: 'weather two' })).toHaveClass(/actionable/);
  // filters: one family only
  await log.locator('.nl-f[data-f="weather"]').click();
  await expect(log.locator('.nl-row')).toHaveCount(2);
  await expect(log.locator('.nl-row:not(.nf-weather)')).toHaveCount(0);
  await log.locator('.nl-f[data-f="all"]').click();
  expect(await log.locator('.nl-row').count()).toBeGreaterThanOrEqual(6);
  await page.keyboard.press('Escape');
  await expect(log).toBeHidden();

  // the weather panel's LOG is that log, filtered to the weather family
  await page.keyboard.press('KeyO');
  const wxLog = page.locator('#weather-panel .wx-log');
  await expect(wxLog).toBeVisible();
  await expect(wxLog.locator('.nl-row')).toHaveCount(2);
  await expect(wxLog.locator('.nl-row:not(.nf-weather)')).toHaveCount(0);
  await page.keyboard.press('KeyO');

  // saved: a reload brings every line back
  const before = ((await g(page, 'getState')).log as any[]).map((e) => `${e.family ?? '-'}|${e.text}`);
  expect(before.length).toBeGreaterThanOrEqual(7);
  await g(page, 'save');
  await page.waitForTimeout(300);
  await page.goto(`${BASE}&tips`);
  await page.locator('#btn-continue').click();
  await page.waitForFunction(() => window.__game !== undefined && window.__game.getState() !== null);
  const after = ((await g(page, 'getState')).log as any[]).map((e) => `${e.family ?? '-'}|${e.text}`);
  expect(after).toEqual(before);
  await page.locator('#log-btn').click();
  await expect(page.locator('#notify-log .nl-row')).toHaveCount(after.length);
  await expect(page.locator('#notify-log .nl-row').first()).toContainText('LOG TEST weather two');
});

test('alert actions: {map} opens the map at the prospect, {tech} the tree at the tech, {building} selects the building', async ({ page }) => {
  test.setTimeout(180_000);
  await boot(page);
  await begin(page);
  // {building}: by id, and by kind (the first one standing)
  const lander = (await g(page, 'getState')).buildings.find((b: any) => b.type === 'lander').id;
  await g(page, 'notify', 'hazard', { text: 'ACTION TEST building', action: { building: lander } });
  await g(page, 'notify', 'hazard', { text: 'ACTION TEST kind', action: { building: 'lander' } });
  await g(page, 'notify', 'research', { text: 'ACTION TEST tech', action: { tech: 'regolithProcessing' } });
  await g(page, 'notify', 'field', { text: 'ACTION TEST map', action: { map: 'moltke' } });
  await page.locator('#log-btn').click();
  const log = page.locator('#notify-log');
  const hud = page.locator('#hud-right');

  await log.locator('.nl-row', { hasText: 'ACTION TEST building' }).click();
  await expect(log).toBeHidden();
  await expect(hud).toHaveClass(/inspecting/);
  await g(page, 'select', null);
  await expect(hud).not.toHaveClass(/inspecting/);
  await page.locator('#log-btn').click();
  await log.locator('.nl-row', { hasText: 'ACTION TEST kind' }).click();
  await expect(hud).toHaveClass(/inspecting/);
  await g(page, 'select', null);

  // {tech}: the tree, on that tech's page with its detail sheet up
  await page.locator('#log-btn').click();
  await log.locator('.nl-row', { hasText: 'ACTION TEST tech' }).click();
  const tree = page.locator('#tech-screen');
  await expect(tree).toBeVisible();
  await expect(page.locator('#tech-sheet-body')).toContainText('Pit Mapping');
  await page.keyboard.press('Escape');
  await expect(tree).toBeHidden();

  // {map}: from the alert stack this time; the Lunar Map opens with that prospect's sheet up
  await g(page, 'completeTech', 'prospectingRovers');
  await g(page, 'advanceGameSeconds', 1);
  await g(page, 'notify', 'field', { text: 'ACTION TEST map again', action: { map: 'moltke' } });
  await page.locator('#alerts .alert', { hasText: 'ACTION TEST map again' }).locator('.alert-text').click();
  const map = page.locator('#map-screen');
  await expect(map).toBeVisible();
  await expect(page.locator('#map-panel')).toContainText('Moltke');
  await expect(page.locator('#map-panel')).not.toContainText('Next surveyable');
  await page.keyboard.press('Escape');
  await expect(map).toBeHidden();
});

test('today\'s callers reach the right family: research, era, field (a real survey and its card), weather and hazard', async ({ page }) => {
  test.setTimeout(300_000);
  await boot(page, '', undefined, 'human');
  await begin(page);
  await page.evaluate(CLIMB);
  await g(page, 'setPaused', true);

  // research: a real lab, a real tech
  await page.evaluate(() => {
    const g = window.__game;
    g.grantResources({ metals: 400, parts: 200, silicon: 200 });
    let solar = 0, lab = 0;
    for (let r = 3; r < 30 && (solar < 2 || !lab); r++) {
      for (let gx = 127 - r; gx <= 127 + r; gx++) for (const gz of [127 - r, 127 + r]) {
        if (solar < 2 && g.placeBuilding('solar', gx, gz, 0)) solar++;
        else if (!lab && g.placeBuilding('lab', gx, gz, 0)) lab++;
      }
    }
    g.finishConstruction();
  });
  await page.evaluate(() => {
    const g = window.__game;
    g.grantData(600);
    g.research('prospectingRovers');
    for (let t = 0; t < 900 && !g.getState().techsDone.includes('prospectingRovers'); t += 10) { g.grantPower(5000); g.advanceGameSeconds(10); }
  });
  const fams = async () => Object.fromEntries((await g(page, 'getState')).log.map((e: any) => [e.text.split(' — ')[0].split(' · ')[0], e.family ?? null]));
  let f = await fams();
  expect(f['RESEARCH COMPLETE']).toBe('research');
  expect(f['INSIGHT']).toBe('research');
  expect(f['MILESTONE']).toBe('era');
  expect(f['TOUCHDOWN']).toBeNull(); // a plain event: in the log, in no family

  // field: a survey, its report and its card
  await page.evaluate(() => {
    const g = window.__game;
    g.grantPower(5000);
    g.grantResources({ oxygen: 200, water: 100, parts: 100 });
    g.surveyProspect('tranqPit');
    g.advanceGameSeconds(100);
  });
  f = await fams();
  expect(((await g(page, 'getState')).log as any[]).map((e) => e.text).filter((x) => /SURVEY|OUT OF RANGE|CANNOT/.test(x))[0]).toMatch(/^SURVEY LAUNCHED/);
  expect(f['SURVEY LAUNCHED']).toBe('field');
  expect(f['SURVEY COMPLETE']).toBe('field');
  expect(f['BREAKTHROUGH']).toBe('field');
  const rep = ((await g(page, 'getState')).log as any[]).find((e) => e.text.startsWith('SURVEY COMPLETE')).report;
  expect(rep.title).toBe('Mare Tranquillitatis pit');
  expect(rep.geology).toMatch(/skylight/);
  expect(rep.rewards.map((r: any) => r.tag)).toEqual(['DATA', 'BREAKTHROUGH']);
  expect(rep.rewards[1].button.action).toEqual({ tech: 'btLavaTubeCaverns' });
  const card = page.locator('#field-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.fc-title')).toHaveText('Mare Tranquillitatis pit');
  await expect(card.locator('.fc-rw')).toHaveCount(2);
  // its button opens the tree at the breakthrough, and the card is done
  await card.locator('.fc-btn').first().click();
  await expect(page.locator('#tech-screen')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();

  // hazard and weather
  await page.evaluate(DRILL);
  await page.evaluate(() => { window.__game.forceFlare('M', { drill: false }); window.__game.advanceGameSeconds(2); });
  const log = (await g(page, 'getState')).log as any[];
  expect(log.some((e) => e.family === 'hazard' && /BREACH/.test(e.text))).toBe(true);
  expect(log.some((e) => e.family === 'weather' && /FLARE/.test(e.text))).toBe(true);
  expect(log.filter((e) => e.kind === 'crit' && e.family !== 'hazard' && e.family !== 'weather')).toEqual([]);
});
