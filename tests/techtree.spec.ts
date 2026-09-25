/** The research tree screen: one page per era (docs/14 §1; docs/11 §6 for
 *  the cards, the sheet and the doctrine commit). Tabs and paging, the
 *  page header's goals with live charter progress, future and past pages,
 *  stubs to other eras, the global queue strip and sticky sheet, hover
 *  links, Shift-click paths, keys, and the layout budget at 1280×720 and
 *  1440×900. */
import { test, expect as baseExpect, type Page } from '@playwright/test';

// UI actions reach the sim on the next rendered frame; under software GL on a
// loaded machine a frame can take seconds, so assertions get a wider window
const expect = baseExpect.configure({ timeout: 20_000 });

declare global {
  interface Window { __game?: any }
}

const BASE = '/?debug&seed=42&nolock&lowfx';

async function boot(page: Page, site: string, exp: 'human' | 'robotic', viewport = { width: 1280, height: 720 }, extra = '') {
  await page.setViewportSize(viewport);
  await page.goto(`${BASE}&site=${site}${exp === 'robotic' ? '&exp=robotic' : ''}${extra}`);
  await page.waitForFunction(() => window.__game !== undefined);
}

async function openTree(page: Page) {
  await page.keyboard.press('KeyT');
  await expect(page.locator('#tech-screen')).toBeVisible();
  await expect(page.locator('.tech-card').first()).toBeVisible();
}

const card = (page: Page, tid: string) => page.locator(`.tech-card[data-tech="${tid}"]`);
const tab = (page: Page, era: number) => page.locator(`.era-tab[data-era="${era}"]`);
/** the page on show: its tab, its header and its board all agree */
async function onPage(page: Page, era: number) {
  await expect(page.locator('.era-tab.view')).toHaveAttribute('data-era', String(era));
  await expect(page.locator('#tech-page-head')).toHaveAttribute('data-era', String(era));
  await expect(page.locator('#tech-board')).toHaveAttribute('data-era', String(era));
}
/** an era opens with 4 techs of the one before (docs/12 §2.1), and from Era 3
 *  on the era before's destiny pick among them (docs/14 §2.6) */
const E1_FOUR = ['regolithProcessing', 'prospectingRovers', 'grizzlyScreens', 'fieldSpectrometers'];
const E1_EXTRA = ['grizzlyScreens', 'fieldSpectrometers'];
const E2_FOUR = ['batteryStorage', 'partsFabrication', 'constructionRobotics', 'siliconRefining', 'dispatchMesh'];
const g = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => window.__game[f as string](...(a as unknown[])), [fn, args] as const);
const queue = async (page: Page) => (await g(page, 'getState')).researchQueue as string[];

/** the page on show fits: every card, stub, tab, header column and the sheet
 *  inside the viewport, cards pairwise disjoint and between the header and
 *  the sheet, nothing clipped in the header, no scrollbars */
async function fitReport(page: Page) {
  return page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const inView = (r: DOMRect) => r.left >= -0.5 && r.top >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5;
    const disjoint = (a: DOMRect, b: DOMRect) => !(a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5);
    const cards = [...document.querySelectorAll<HTMLElement>('.tech-card')]
      .map((e) => ({ t: e.dataset.tech!, r: e.getBoundingClientRect(), compact: e.classList.contains('compact'), row: e.style.getPropertyValue('--r') }));
    const overlaps: string[] = [];
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) if (!disjoint(cards[i].r, cards[j].r)) overlaps.push(`${cards[i].t}/${cards[j].t}`);
    }
    const head = document.querySelector('#tech-page-head')!.getBoundingClientRect();
    const sheet = document.querySelector('#tech-sheet')!.getBoundingClientRect();
    const outside = cards.filter(({ r }) => !inView(r) || r.top < head.bottom || r.bottom > sheet.top).map((c) => c.t);
    const blocks = [
      ...document.querySelectorAll<HTMLElement>('.era-tab, #tech-head > .th-name, #tech-rate, #tech-close, #tech-page-head > div, .stub, .doc-bracket, .lane-label, #tech-sheet, .q-item'),
    ].filter((e) => e.offsetParent !== null);
    const offscreen = blocks.filter((e) => !inView(e.getBoundingClientRect())).map((e) => e.id || e.className);
    // the top bar: its parts never overlap one another
    const bar = [...document.querySelectorAll<HTMLElement>('#tech-head > .th-name, #tech-tabs, #tech-rate, #tech-map, #tech-close')]
      .filter((e) => e.offsetParent !== null).map((e) => ({ id: e.id || e.className, r: e.getBoundingClientRect() }));
    const barOverlaps: string[] = [];
    for (let i = 0; i < bar.length; i++) for (let j = i + 1; j < bar.length; j++) if (!disjoint(bar[i].r, bar[j].r)) barOverlaps.push(`${bar[i].id}/${bar[j].id}`);
    const clipped = [...document.querySelectorAll<HTMLElement>('#tech-page-head > div')]
      .filter((e) => e.scrollHeight > e.clientHeight + 1).map((e) => `${e.className} ${e.scrollHeight}>${e.clientHeight}`);
    const rows = new Map<string, { n: number; compact: boolean }>();
    for (const c of cards) {
      const x = rows.get(c.row) ?? { n: 0, compact: true };
      rows.set(c.row, { n: x.n + 1, compact: x.compact && c.compact });
    }
    const scr = document.querySelector('#tech-screen')!, main = document.querySelector('#tech-main')!;
    return {
      count: cards.length, overlaps, outside, offscreen, barOverlaps, clipped,
      lanes: document.querySelectorAll('.lane').length,
      crowded: [...rows.values()].filter((r) => r.n > 5 && !r.compact).length,
      scroll: [
        scr.scrollWidth - scr.clientWidth, scr.scrollHeight - scr.clientHeight,
        main.scrollWidth - main.clientWidth, main.scrollHeight - main.clientHeight,
        document.documentElement.scrollWidth - vw, document.documentElement.scrollHeight - vh,
      ],
    };
  });
}

type Run = [string, 'human' | 'robotic', { width: number; height: number }, string];

/** boot each run and walk its 8 pages with ], asserting the budget on each */
async function checkRuns(page: Page, runs: Run[]) {
  for (const [site, exp, vp, extra] of runs) {
    await boot(page, site, exp, vp, extra);
    const tagName = `${site} ${exp} ${vp.width}×${vp.height}${extra}`;
    if (site === 'mare') {
      // a lived-in tree for the screenshots: Era 2, techs done and queued, a deed under way
      await g(page, 'placeBuilding', 'lab', 135, 133);
      await g(page, 'advanceGameSeconds', 80);
      for (const t of [...E1_FOUR, 'teleoperation']) await g(page, 'completeTech', t);
      await g(page, 'grantData', 300);
      for (const t of ['partsFabrication', 'siliconRefining', 'bifacialCells']) await g(page, 'research', t);
      await g(page, 'advanceGameSeconds', 20);
    }
    await openTree(page);
    await expect(page.locator('.era-tab')).toHaveCount(8);
    const start = (await g(page, 'getState')).era as number;
    await onPage(page, start);
    await page.keyboard.press('Home');
    for (let p = start; p > 1; p--) await page.keyboard.press('BracketLeft');
    for (let p = 1; p <= 8; p++) {
      await onPage(page, p);
      const r = await fitReport(page);
      const at = `${tagName} E${p}`;
      expect(r.count, at).toBeGreaterThan(0);
      expect(r.overlaps, at).toEqual([]);
      expect(r.outside, at).toEqual([]);
      expect(r.offscreen, at).toEqual([]);
      expect(r.barOverlaps, at).toEqual([]);
      expect(r.clipped, at).toEqual([]);
      expect(r.lanes, at).toBeLessThanOrEqual(7);
      expect(r.crowded, at).toBe(0);
      expect(r.scroll.every((d) => d <= 0), `${at} scroll overflow ${r.scroll}`).toBe(true);
      if (p === 8) await expect(card(page, 'swarmProtocol')).toBeVisible();
      if (site === 'mare' && (p === start || p === 3 || p === 8)) {
        if (p === start) await page.hover('[data-tech="constructionRobotics"]');
        await page.waitForTimeout(400);
        await page.screenshot({ path: `test-results/pages-${vp.width}x${vp.height}-${exp}-${site}${extra ? '-detailed' : ''}-E${p}.png` });
        await page.mouse.move(4, vp.height - 4);
      }
      if (p < 8) await page.keyboard.press('BracketRight');
    }
  }
}

test('every era page fits 1280×720 with the sheet open: no overlap, nothing off screen, no scroll', async ({ page }) => {
  test.setTimeout(300_000);
  await checkRuns(page, [
    ['mare', 'robotic', { width: 1280, height: 720 }, ''],
    ['lavatube', 'robotic', { width: 1280, height: 720 }, ''],
    ['southpole', 'human', { width: 1280, height: 720 }, ''],
  ]);
  // collapsed sheet: the rows keep 56 px and the board still fits
  await page.locator('#tech-sheet-toggle').click();
  await expect(page.locator('#tech-sheet')).toHaveClass(/collapsed/);
  const c = await fitReport(page);
  expect(c.overlaps).toEqual([]);
  expect(c.outside).toEqual([]);
  expect(c.scroll.every((d) => d <= 0)).toBe(true);
  expect(await page.locator('#tech-board').evaluate((e) => getComputedStyle(e).getPropertyValue('--row-h').trim())).toBe('56px');
});

test('pages fit the 1440×900 default viewport and the High-detail style; a short screen shrinks the rows', async ({ page }) => {
  test.setTimeout(300_000);
  await checkRuns(page, [
    ['mare', 'human', { width: 1440, height: 900 }, ''],
    ['mare', 'robotic', { width: 1280, height: 720 }, '&style=detailed'],
  ]);
  // taller than 720: the sheet takes up to 220 px, the rows stay 56
  await boot(page, 'mare', 'robotic', { width: 1440, height: 900 });
  await openTree(page);
  const sheet = await page.locator('#tech-sheet').boundingBox();
  expect(sheet!.height).toBeGreaterThanOrEqual(148);
  expect(sheet!.y + sheet!.height).toBeLessThanOrEqual(900);
  // 1280×640: the 7-row E6 page fits on rows under 56 px, over the least sheet
  await boot(page, 'mare', 'robotic', { width: 1280, height: 640 });
  await openTree(page);
  await tab(page, 6).click();
  await onPage(page, 6);
  await expect(page.locator('.lane')).toHaveCount(7);
  const r = await fitReport(page);
  expect(r.overlaps).toEqual([]);
  expect(r.outside).toEqual([]);
  expect(r.clipped).toEqual([]);
  expect(r.scroll.every((d) => d <= 0)).toBe(true);
  const rowH = parseFloat(await page.locator('#tech-board').evaluate((e) => getComputedStyle(e).getPropertyValue('--row-h')));
  expect(rowH).toBeLessThan(56);
  expect(rowH).toBeGreaterThanOrEqual(36);
});

test('T opens on the current era; tabs carry their states; the E1 destiny is the landing', async ({ page }) => {
  await boot(page, 'mare', 'robotic');
  await openTree(page);
  await onPage(page, 1);
  await expect(tab(page, 1)).toHaveClass(/\bcur\b/);
  await expect(tab(page, 1).locator('.et-g')).toHaveText('●');
  for (let e = 2; e <= 8; e++) {
    await expect(tab(page, e)).toHaveClass(/\bfuture\b/);
    await expect(tab(page, e).locator('.et-g')).toHaveText('⊘');
  }
  // the destiny pip in every tab: the landing's ◉, then ○ until each era is chosen
  await expect(page.locator('.era-tab .et-pip')).toHaveCount(8);
  await expect(tab(page, 1).locator('.et-pip')).toHaveText('◉');
  for (let e = 2; e <= 8; e++) await expect(tab(page, e).locator('.et-pip')).toHaveText('○');
  // only this era's cards: none of Era 2's
  await expect(card(page, 'regolithProcessing')).toBeVisible();
  await expect(card(page, 'batteryStorage')).toHaveCount(0);
  // the header: era column, the landing as the destiny, the goals toward Era 2
  const head = page.locator('#tech-page-head');
  await expect(head.locator('.ph-era')).toContainText('ERA 1 · CURRENT ERA');
  await expect(head.locator('.ph-era')).toContainText('FIRST LANDING');
  await expect(head.locator('.ph-era')).toContainText('The lander’s cache is all you have.');
  await expect(head.locator('.ph-destiny')).toContainText('DESTINY · chosen at landing');
  await expect(head.locator('.dz-exp.chosen')).toContainText('ROBOTIC MISSION');
  await expect(head.locator('.dz-exp.chosen')).toContainText('✓ CHOSEN');
  await expect(head.locator('.dz-exp.chosen')).toContainText('Cannot starve, cannot mutiny');
  await expect(head.locator('.dz-exp.other')).toContainText('HUMAN CREW');
  await expect(head.locator('.ph-goals')).toContainText('ERA GOALS → Era 2 EARLY CONSTRUCTION');

  // Era 2 by charter: T now opens on E2; E1 is past, with its leftovers and a queued item
  for (const t of E1_FOUR) await g(page, 'completeTech', t);
  await g(page, 'research', 'bifacialCells');
  await page.keyboard.press('Escape');
  await expect(page.locator('#tech-screen')).toBeHidden();
  await openTree(page);
  await onPage(page, 2);
  await expect(tab(page, 2)).toHaveClass(/\bcur\b/);
  await expect(tab(page, 1)).toHaveClass(/\bpast\b/);
  await expect(tab(page, 1).locator('.et-g')).toHaveText('✓');
  const left = (await g(page, 'getResearch')).cards;
  const n = ['teleoperation', 'regolithVolatiles', 'sampleCaches'].filter((t) => ['available', 'full', 'requires', 'requiresAny'].includes(left[t].state)).length;
  await expect(tab(page, 1).locator('.et-left')).toHaveText(`·${n}`);
  await expect(tab(page, 1).locator('.et-q')).toHaveText('#1');
  // Era 2's destiny column: its ⌂ / ◉ pick (doctrine pairs stay on the board)
  await expect(head.locator('.ph-destiny')).toContainText('DESTINY · choose one · permanent');
  await expect(head.locator('.dz-card[data-select="pressureHalls"]')).toBeVisible();
  await expect(head.locator('.dz-card[data-select="dispatchMesh"]')).toBeVisible();
  await expect(page.locator('.doc-bracket[data-group="smeltDoctrine"]')).toHaveCount(1);
  // a crewed landing shows the crew
  await boot(page, 'southpole', 'human');
  await openTree(page);
  await expect(page.locator('.dz-exp.chosen')).toContainText('HUMAN CREW');
  await expect(page.locator('.dz-exp.other')).toContainText('ROBOTIC MISSION');
  // every era has its destiny: three header columns, era 360 · destiny 560 · goals 336
  await tab(page, 5).click();
  await onPage(page, 5);
  await expect(page.locator('#tech-page-head')).not.toHaveClass(/no-destiny/);
  await expect(page.locator('.ph-destiny .dz-card')).toHaveCount(2);
  const cols = await page.locator('#tech-page-head > div').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  expect(cols).toHaveLength(3);
  expect(cols[1]).toBeGreaterThan(cols[0]);
});

test('paging: ] [ PgDn PgUp Home and tab clicks; digits keep the speed; a new era pulses its tab', async ({ page }) => {
  await boot(page, 'mare', 'robotic');
  await openTree(page);
  await onPage(page, 1);
  await page.keyboard.press('BracketRight');
  await onPage(page, 2);
  await page.keyboard.press('PageDown');
  await onPage(page, 3);
  await page.keyboard.press('PageUp');
  await onPage(page, 2);
  await page.keyboard.press('BracketLeft');
  await onPage(page, 1);
  await page.keyboard.press('BracketLeft'); // no page before E1
  await onPage(page, 1);
  await tab(page, 8).click();
  await onPage(page, 8);
  await page.keyboard.press('BracketRight'); // none after E8
  await onPage(page, 8);
  await expect(card(page, 'swarmProtocol')).toBeVisible();
  await page.keyboard.press('Home');
  await onPage(page, 1);
  // the digits still change the game speed, and the tree stays open
  await page.keyboard.press('Digit3');
  await expect.poll(async () => (await g(page, 'getState')).speed).toBe(10);
  await page.keyboard.press('Digit1');
  await expect.poll(async () => (await g(page, 'getState')).speed).toBe(1);
  await expect(page.locator('#tech-screen')).toBeVisible();
  // Era 2 opens while the tree is open: the page stays on E1, the E2 tab pulses once
  await page.keyboard.press('BracketRight');
  await page.keyboard.press('BracketLeft');
  await onPage(page, 1);
  for (const t of E1_FOUR) await g(page, 'completeTech', t);
  await expect(tab(page, 2)).toHaveClass(/\bcur\b/);
  await expect(tab(page, 2)).toHaveClass(/\bpulse\b/);
  await onPage(page, 1);
  await expect(page.locator('#tech-page-head .ph-goals')).toContainText('✓opened Era 2');
  await page.keyboard.press('Home');
  await onPage(page, 2);
});

test('a future page is read-only: dashed cards, a click explains ERA LOCKED, the goals say what opens it', async ({ page }) => {
  await boot(page, 'mare', 'robotic');
  await openTree(page);
  await page.keyboard.press('BracketRight');
  await onPage(page, 2);
  await expect(page.locator('#tech-board')).toHaveClass(/k-future/);
  const styles = await page.locator('.tech-card:not(.ph)').evaluateAll((els) =>
    els.map((e) => ({ t: (e as HTMLElement).dataset.state, b: getComputedStyle(e).borderTopStyle, o: Number(getComputedStyle(e).opacity) })));
  expect(styles.length).toBeGreaterThan(5);
  for (const s of styles) {
    expect(s.b).toBe('dashed');
    expect(s.o).toBeLessThanOrEqual(0.4);
  }
  expect(styles.every((s) => s.t === 'eraLocked' || s.t === 'crewLocked')).toBe(true);
  await card(page, 'batteryStorage').click();
  await expect(page.locator('#tech-alerts')).toContainText('ERA LOCKED — Battery Banks opens with Era 2 · Era 2 opens with 4 Era-1 techs, or 2 + 450◆ smelted');
  await expect(page.locator('#tech-sheet-body')).toContainText('ERA LOCKED — opens with Era 2');
  // Shift-click (the path) is refused the same way
  await card(page, 'partsFabrication').click({ modifiers: ['Shift'] });
  await expect(page.locator('#tech-alerts')).toContainText('ERA LOCKED — Parts Fabrication opens with Era 2');
  await page.waitForTimeout(500);
  expect(await queue(page)).toEqual([]);
  // the destiny pick in the header: shown, a click only selects, and it waits for its era
  await page.locator('.dz-card[data-select="pressureHalls"]').click();
  await expect(page.locator('.dst-sheet')).toContainText('DESTINY · CHOOSE ONE · PERMANENT');
  await expect(page.locator('.dz-card[data-select="pressureHalls"]')).toContainText('choose when Era 2 opens');
  expect(await queue(page)).toEqual([]);
  // the goals: what opens Era 2, live
  const goals = page.locator('.ph-goals');
  await expect(goals).toContainText('LOCKED · ERA 2 OPENS WITH');
  await expect(goals).toContainText('of 4 Era-1 techs');
  await expect(goals).toContainText('or 2 + 450◆ smelted');
  // two eras ahead: the note that the era before must open first
  await tab(page, 4).click();
  await expect(page.locator('.ph-goals')).toContainText('LOCKED · ERA 4 OPENS WITH');
  await expect(page.locator('.ph-goals')).toContainText('once Era 3 opens');
});

test('the goals column follows the sim: charter techs and the deed update in place', async ({ page }) => {
  await boot(page, 'mare', 'robotic');
  expect(await g(page, 'placeBuilding', 'lab', 135, 133)).toBe(true);
  await g(page, 'advanceGameSeconds', 80); // built at 72 s
  await openTree(page);
  const goals = page.locator('.ph-goals');
  const techs = goals.locator('[data-g="techs"]');
  const deed = goals.locator('[data-g="deed"]');
  const gate = async () => (await g(page, 'getResearch')).gates.find((x: any) => x.era === 2);
  await expect(goals).toContainText('ERA GOALS → Era 2 EARLY CONSTRUCTION');
  await expect(techs).toHaveText('0');
  await expect(deed).toHaveText(`0/${(await gate()).deedNeed}`);
  await expect(goals.locator('[data-g="pips"]')).toHaveText('◻◻◻◻');

  // a tech researched by the sim itself: the lab transfers its data, it completes
  await g(page, 'grantData', 80);
  await g(page, 'research', 'regolithProcessing');
  await g(page, 'advanceGameSeconds', 140); // 48≡ at 0.4/s
  expect((await g(page, 'getState')).techsDone).toContain('regolithProcessing');
  await expect(techs).toHaveText(String((await gate()).techs));
  await expect(techs).toHaveText('1');
  await expect(goals.locator('[data-g="pips"]')).toHaveText('◼◻◻◻');

  // the deed moves with the sim's stats, in place: same nodes, new text and bar
  const node = await deed.elementHandle();
  const bar = goals.locator('[data-g="bar"]');
  const barNode = await bar.elementHandle();
  const produced = (await g(page, 'getState')).stats.produced;
  await g(page, 'setStats', { produced: { ...produced, metals: 225 } });
  await g(page, 'advanceGameSeconds', 5);
  const g2 = await gate();
  expect(g2.deedValue).toBeGreaterThanOrEqual(225);
  await expect(deed).toHaveText(`${Math.floor(g2.deedValue)}/450`);
  await expect.poll(async () => parseFloat(await bar.evaluate((e) => (e as HTMLElement).style.width))).toBeCloseTo((g2.deedValue / 450) * 100, 0);
  expect(await node!.evaluate((e) => e.isConnected)).toBe(true);
  expect(await barNode!.evaluate((e) => e.isConnected)).toBe(true);
  // the deed route opens with 2 techs and the deed
  await g(page, 'completeTech', 'teleoperation');
  await expect(goals.locator('[data-g="ck-deed"]')).toHaveText('◻');
  await g(page, 'setStats', { produced: { ...produced, metals: 450 } });
  await expect.poll(async () => (await g(page, 'getState')).era).toBe(2);
  // the page stays on E1, now past: what it opened
  await onPage(page, 1);
  await expect(goals).toContainText('✓opened Era 2');
  await expect(goals).toContainText('2 of 8 Era-1 techs researched · 6 left');
  // E2 is the current page: its goals are Era 3's charter
  await page.keyboard.press('Home');
  await expect(page.locator('.ph-goals')).toContainText('ERA GOALS → Era 3 ROBOTIC FABRICATION');
  await expect(page.locator('.ph-goals')).toContainText('Destiny: choose ⌂ or ◉');
  await expect(page.locator('.ph-goals')).toContainText('or the destiny, 1 more + 200⚙ fabricated');
  await expect(page.locator('.ph-goals [data-g="techs"]')).toHaveText('0');
});

test('Era 8 goals: the FIRST LIGHT checklist reads the launch as the sim does', async ({ page }) => {
  await boot(page, 'mare', 'robotic');
  await openTree(page);
  await tab(page, 8).click();
  await expect(page.locator('.ph-goals')).toContainText('LOCKED · ERA 8 OPENS WITH');
  await expect(page.locator('.ph-goals')).toContainText('then FIRST LIGHT: the Era 8 destiny, Swarm Protocol and a launch');
  await page.keyboard.press('Escape');
  // debug: every non-doctrine tech of Eras 1–7 done (and each era's ◉ pick) opens Era 8 by charter
  await page.evaluate(() => {
    const g = window.__game!;
    const cards = g.getResearch().cards;
    for (const t of Object.keys(cards)) {
      const c = cards[t];
      if (c.era <= 7 && c.state !== 'hidden' && !c.doctrine && c.track?.side !== 'colony') g.completeTech(t);
    }
  });
  await expect.poll(async () => (await g(page, 'getState')).era).toBe(8);
  await openTree(page);
  await onPage(page, 8);
  const goals = page.locator('.ph-goals');
  await expect(goals).toContainText('FINAL GOAL · FIRST LIGHT');
  await expect(goals.locator('[data-g="fl-armed"]')).toHaveText('◻');
  await g(page, 'completeTech', 'swarmProtocol');
  await expect(goals.locator('[data-g="fl-armed"]')).toHaveText('✓');
  await expect(goals.locator('[data-g="fl-foils"]')).toHaveText('◻');
  await expect(goals.locator('[data-g="fl-foils-v"]')).toHaveText(/^\d+\/10$/);
  await g(page, 'grantResources', { foils: 10 });
  await expect(goals.locator('[data-g="fl-foils"]')).toHaveText('✓');
  await expect(goals.locator('[data-g="fl-launch-v"]')).toHaveText(/\/3$/);
  await expect(goals.locator('[data-g="fl-stored-v"]')).toHaveText(/\/400$/);
});

test('stubs jump between eras and select: ◂E1 to the prerequisite, E2▸ to the dependent', async ({ page }) => {
  await boot(page, 'mare', 'robotic');
  // Era 2 without Regolith Smelting: Parts Fabrication's E1 prerequisite is undone
  for (const t of ['teleoperation', 'prospectingRovers', ...E1_EXTRA]) await g(page, 'completeTech', t);
  await openTree(page);
  await onPage(page, 2);
  const stub = card(page, 'partsFabrication').locator('.stub-in');
  await expect(stub).toHaveText('◂E1');
  await expect(stub).toHaveClass(/\bpend\b/);
  await expect(stub).toHaveAttribute('title', /Needs from other eras: ◻ E1 Regolith Smelting/);
  const borderStyle = await stub.evaluate((e) => getComputedStyle(e).borderRightStyle);
  expect(borderStyle).toBe('dashed');
  await stub.locator('.st-e').click();
  await onPage(page, 1);
  await expect(card(page, 'regolithProcessing')).toHaveClass(/\bsel\b/);
  await expect(card(page, 'regolithProcessing')).toHaveClass(/pulse/);
  await page.mouse.move(4, 716);
  await expect(page.locator('#tech-sheet-body')).toContainText('Regolith Smelting');
  // and forward: its E2▸ stub lands on the first undone Era-2 dependent
  const out = card(page, 'regolithProcessing').locator('.stub-out');
  await expect(out).toContainText('E2▸');
  await out.locator('.st-e').first().click();
  await onPage(page, 2);
  const sel = await page.locator('.tech-card.sel').getAttribute('data-tech');
  const deps = ['siliconRefining', 'partsFabrication', 'moltenElectrolysis', 'ilmeniteBeneficiation', 'heatRecoveryJackets'];
  expect(deps).toContain(sel);
  // done, the stub turns solid
  await g(page, 'completeTech', 'regolithProcessing');
  await expect(card(page, 'partsFabrication').locator('.stub-in')).toHaveClass(/\bdone\b/);
  expect(await card(page, 'partsFabrication').locator('.stub-in').evaluate((e) => getComputedStyle(e).borderRightStyle)).toBe('solid');
});

test('the queue strip is global: era tags, and a click jumps to the item’s page', async ({ page }) => {
  await boot(page, 'mare', 'robotic');
  for (const t of [...E1_FOUR, ...E2_FOUR]) await g(page, 'completeTech', t); // Era 3
  for (const t of ['bifacialCells', 'thermalWadis', 'stackedCells']) await g(page, 'research', t);
  await g(page, 'advanceGameSeconds', 1);
  await openTree(page);
  await onPage(page, 3);
  const items = page.locator('#tech-queue .q-item');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0).locator('.q-era')).toHaveText('E1');
  await expect(items.nth(1).locator('.q-era')).toHaveText('E2');
  await expect(items.nth(2).locator('.q-era')).toHaveText('E3');
  await expect(items.nth(2)).toHaveClass(/\bhere\b/);
  await items.nth(0).locator('.q-nm').click();
  await onPage(page, 1);
  await expect(card(page, 'bifacialCells')).toHaveClass(/\bsel\b/);
  await items.nth(1).locator('.q-nm').click();
  await onPage(page, 2);
  await expect(card(page, 'thermalWadis')).toHaveClass(/\bsel\b/);
  // the strip's ↑ and × still work, and never jump
  await items.nth(2).locator('button[data-act="up"]').click();
  await expect.poll(() => queue(page)).toEqual(['bifacialCells', 'stackedCells', 'thermalWadis']);
  await onPage(page, 2);
  await items.nth(0).locator('button[data-act="cancel"]').click();
  await expect.poll(() => queue(page)).toEqual(['stackedCells', 'thermalWadis']);
  await onPage(page, 2);
});

test('the sheet is sticky across pages: “on the E3 page ↩”, era-tagged path links', async ({ page }) => {
  await boot(page, 'mare', 'robotic');
  for (const t of [...E1_FOUR, ...E2_FOUR]) await g(page, 'completeTech', t); // Era 3
  await openTree(page);
  await onPage(page, 3);
  await card(page, 'stackedCells').click({ button: 'right' }); // selects nothing, queues nothing
  await card(page, 'refluxColumns').click();
  await expect.poll(() => queue(page)).toEqual(['refluxColumns']);
  await card(page, 'cryoSampleStore').click();
  await expect.poll(() => queue(page)).toEqual(['refluxColumns', 'cryoSampleStore']);
  await page.keyboard.press('BracketRight');
  await onPage(page, 4);
  await page.mouse.move(4, 716);
  const sheet = page.locator('#tech-sheet-body');
  await expect(sheet).toContainText('Cryo Sample Store');
  await expect(sheet.locator('.sh-jump')).toHaveText('on the E3 page ↩');
  // the path column: every prerequisite and dependent with its era and a link
  await expect(sheet.locator('.lnk[data-jump="fieldSpectrometers"]')).toContainText('✓ E1');
  await sheet.locator('.sh-jump').click();
  await onPage(page, 3);
  await expect(card(page, 'cryoSampleStore')).toHaveClass(/\bsel\b/);
  await expect(sheet.locator('.sh-jump')).toHaveCount(0);
  await sheet.locator('.lnk[data-jump="fieldSpectrometers"]').click();
  await onPage(page, 1);
  await expect(card(page, 'fieldSpectrometers')).toHaveClass(/\bsel\b/);
  // hovering a card on the page overrides the sticky selection until the pointer leaves
  await card(page, 'teleoperation').hover();
  await expect(sheet).toContainText('Teleoperation');
  await page.mouse.move(4, 716);
  await expect(sheet).toContainText('Field Spectrometers');
});

test('openTechTreeAt: a locked palette card opens the page of its tech’s era, selected', async ({ page }) => {
  await boot(page, 'mare', 'robotic');
  await page.locator('#palette .cats .btn', { hasText: 'Industry' }).click();
  await page.locator('.bld-btn.locked', { hasText: 'Chip Fab' }).click();
  await expect(page.locator('#tech-screen')).toBeVisible();
  await onPage(page, 4);
  await expect(card(page, 'waferFab')).toHaveClass(/\bsel\b/);
  await expect(card(page, 'waferFab')).toHaveClass(/pulse/);
  await expect(tab(page, 1)).toHaveClass(/\bcur\b/);
  await page.keyboard.press('Escape');
  // T opens on the current era again
  await openTree(page);
  await onPage(page, 1);
});

test('hover links: none by default; the hovered card draws its page’s links and dims the rest', async ({ page }) => {
  await boot(page, 'mare', 'robotic');
  await g(page, 'completeTech', 'regolithProcessing');
  await openTree(page);
  await tab(page, 4).click();
  await onPage(page, 4);
  await page.mouse.move(4, 716);
  await expect(page.locator('#tech-links path')).toHaveCount(0);
  await page.hover('[data-tech="waferFab"]');
  await expect(page.locator('#tech-board')).toHaveClass(/hovering/);
  for (const t of ['acceleratorDesign', 'radHardProcess', 'cleanroomRobotics', 'orbitalProspector', 'waferPolishing']) {
    await expect(card(page, t)).toHaveClass(/\bhl\b/);
    await expect(page.locator(`#tech-links path.hi[data-edge="waferFab>${t}"]`)).toHaveCount(1);
  }
  await expect(card(page, 'braytonConverters')).not.toHaveClass(/\bhl\b/);
  await page.waitForTimeout(400); // opacity transition
  const op = await page.evaluate(() => Number(getComputedStyle(document.querySelector('.tech-card[data-tech="braytonConverters"]')!).opacity));
  expect(op).toBeLessThanOrEqual(0.4);
  // its Era-2 prerequisites are a stub, not a line
  await expect(card(page, 'waferFab').locator('.stub-in')).toHaveText('◂E2');
  // the sheet: generated lines, lock reason, era-tagged path, the insight hint
  const sheet = page.locator('#tech-sheet-body');
  await expect(sheet).toContainText('Wafer Fabrication');
  await expect(sheet).toContainText('⊕ UNLOCK Chip Fab');
  await expect(sheet).toContainText('⊖');
  await expect(sheet).toContainText('ERA LOCKED — opens with Era 4');
  await expect(sheet).toContainText('Leads to');
  await expect(sheet.locator('.lnk[data-jump="siliconRefining"]')).toContainText('E2');
  await expect(sheet).toContainText('⚡ Insight: 150◇ in stock');
  // a goods link: Orbital Prospector's chips come from the Chip Fab Wafer Fabrication unlocks
  await page.hover('[data-tech="orbitalProspector"]');
  await expect(page.locator('#tech-links path.goods[data-goods="chips"]')).toHaveCount(1);
  // an OR group on one page meets at a diamond (E2: Regolith Shielding's any-of)
  await tab(page, 2).click();
  await page.hover('[data-tech="regolithShielding"]');
  await expect(page.locator('#tech-links .or-dia.hi[data-or="regolithShielding"]')).toHaveCount(1);
  await page.mouse.move(640, 716);
  await expect(page.locator('#tech-board')).not.toHaveClass(/hovering/);
  await expect(page.locator('#tech-links path')).toHaveCount(0);
});

test('site filters: the footer names other-site techs; the pole MRE has no doctrine bracket', async ({ page }) => {
  await boot(page, 'mare', 'robotic');
  await openTree(page);
  await expect(page.locator('#tech-other-sites')).toHaveText('◬ 6 techs belong to other landing sites');
  const absent: Record<number, string[]> = {
    1: ['siteGrading', 'iceExtraction'], 2: ['peakLightMasts', 'skylightHeliostats', 'sublimationTents'], 4: ['heatedAugers'],
  };
  for (const [era, list] of Object.entries(absent)) {
    await tab(page, Number(era)).click();
    await onPage(page, Number(era));
    for (const t of list) await expect(card(page, t)).toHaveCount(0);
  }
  await tab(page, 2).click();
  await expect(page.locator('.doc-bracket[data-group="smeltDoctrine"]')).toHaveCount(1);
  await expect(page.locator('.doc-bracket[data-group="smeltDoctrine"]')).toContainText('◇ CHOOSE ONE');
  // an undiscovered breakthrough keeps its place as a placeholder
  await tab(page, 3).click();
  await expect(card(page, 'btLavaTubeCaverns')).toHaveClass(/\bph\b/);
  await expect(card(page, 'btLavaTubeCaverns')).toContainText('? Breakthrough');
  // two doctrines on E3: both bracketed on the board; the header holds the destiny
  await expect(page.locator('.doc-bracket')).toHaveCount(2);
  await expect(page.locator('.ph-destiny .dz-card')).toHaveCount(2);

  await boot(page, 'southpole', 'robotic');
  await openTree(page);
  await tab(page, 2).click();
  await onPage(page, 2);
  await expect(card(page, 'moltenElectrolysis')).toBeVisible();
  await expect(card(page, 'moltenElectrolysis')).not.toHaveClass(/doctrine/);
  await expect(page.locator('.doc-bracket[data-group="smeltDoctrine"]')).toHaveCount(0);
  await expect(card(page, 'ilmeniteBeneficiation')).toHaveCount(0);
  await expect(page.locator('.ph-destiny .dz-card')).toHaveCount(2); // the destiny is everywhere
});

test('doctrine: a card click only selects; Commit queues; the sibling is foreclosed', async ({ page }) => {
  await boot(page, 'mare', 'robotic');
  for (const t of [...E1_FOUR]) await g(page, 'completeTech', t); // era 2 by charter
  await openTree(page);
  await onPage(page, 2);
  const bracket = page.locator('.doc-bracket[data-group="smeltDoctrine"]');
  await expect(bracket).toHaveAttribute('title', /DOCTRINE · CHOOSE ONE · PERMANENT — How hard do you push the furnace\?/);
  await expect(card(page, 'moltenElectrolysis')).toHaveClass(/available/);
  // the pair sits side by side, under one bracket
  const [a, b] = await Promise.all(['moltenElectrolysis', 'ilmeniteBeneficiation'].map((t) => card(page, t).boundingBox()));
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(1);
  expect(b!.x - (a!.x + a!.width)).toBeLessThanOrEqual(8.5);

  await card(page, 'moltenElectrolysis').click();
  await page.mouse.move(640, 716);
  const sides = page.locator('.doc-sheet .doc-side');
  await expect(sides).toHaveCount(2);
  await expect(page.locator('.doc-sheet')).toContainText('DOCTRINE · CHOOSE ONE · PERMANENT');
  await expect(page.locator('.doc-sheet')).toContainText('At Ilmenite Plains: Plenty of ilmenite');
  await expect(sides.first()).toContainText(/your base/i);
  await page.waitForTimeout(600);
  expect(await queue(page)).toEqual([]); // selecting is not queueing
  // Enter on a doctrine focuses Commit and never commits by itself
  await page.keyboard.press('Enter');
  await expect(page.locator('button.commit[data-tech="moltenElectrolysis"]')).toBeFocused();
  await page.waitForTimeout(400);
  expect(await queue(page)).toEqual([]);

  await page.locator('button.commit[data-tech="moltenElectrolysis"]').click();
  await expect.poll(() => queue(page)).toEqual(['moltenElectrolysis']);
  await expect(card(page, 'ilmeniteBeneficiation')).toHaveClass(/foreclosed/);
  await expect(card(page, 'ilmeniteBeneficiation')).toContainText('foreclosed (pending)');
  await expect(page.locator('.doc-side[data-tech="ilmeniteBeneficiation"]'))
    .toContainText('foreclosed while Molten Regolith Electrolysis is queued — cancel it to reopen');
  await expect(card(page, 'moltenElectrolysis')).toHaveClass(/queued/);

  // cancelling from the commit sheet reopens the sibling
  await page.locator('.doc-side button[data-act="cancel"][data-tech="moltenElectrolysis"]').click();
  await expect.poll(() => queue(page)).toEqual([]);
  await expect(card(page, 'ilmeniteBeneficiation')).toHaveClass(/available/);

  // done → permanently foreclosed, and clicking the foreclosed card queues nothing
  await g(page, 'completeTech', 'moltenElectrolysis');
  await expect(card(page, 'ilmeniteBeneficiation')).toContainText('you chose MRE Smelting');
  await expect(card(page, 'moltenElectrolysis')).toHaveClass(/\bdone\b/);
  await card(page, 'ilmeniteBeneficiation').click();
  await page.mouse.move(640, 716);
  await expect(page.locator('.doc-side[data-tech="ilmeniteBeneficiation"]')).toContainText('foreclosed — you chose Molten Regolith Electrolysis');
  await expect(page.locator('.doc-side[data-tech="moltenElectrolysis"]')).toContainText('✓ CHOSEN');
  await page.waitForTimeout(600);
  expect(await queue(page)).toEqual([]);
});

test('Shift-click queues the whole path across eras; the queue strip reorders and cancels', async ({ page }) => {
  await boot(page, 'mare', 'robotic');
  for (const t of ['teleoperation', 'prospectingRovers', ...E1_EXTRA]) await g(page, 'completeTech', t); // era 2
  await openTree(page);
  await onPage(page, 2);
  // a plain click on a card that needs a prerequisite explains itself
  await card(page, 'partsFabrication').click();
  await expect(page.locator('#tech-alerts')).toContainText('NEEDS PREREQUISITE — Parts Fabrication needs Regolith Smelting · Shift-click queues the whole path');
  expect(await queue(page)).toEqual([]);

  // the path reaches back to the E1 page's Regolith Smelting
  await card(page, 'partsFabrication').click({ modifiers: ['Shift'] });
  await expect.poll(() => queue(page)).toEqual(['regolithProcessing', 'partsFabrication']);
  // an OR group takes its cheapest visible member (Site Grading is hidden on the mare)
  await card(page, 'regolithShielding').click({ modifiers: ['Shift'] });
  await expect.poll(() => queue(page))
    .toEqual(['regolithProcessing', 'partsFabrication', 'constructionRobotics', 'regolithShielding']);
  await expect(card(page, 'regolithShielding')).toHaveClass(/queued/);
  await expect(card(page, 'regolithShielding')).toContainText('#4');

  const strip = page.locator('#tech-queue');
  await expect(strip).toContainText('Queue 4/5');
  await expect(strip.locator('.q-item')).toHaveCount(4);
  await expect(strip.locator('.q-item').first()).toContainText('E1');
  await expect(strip.locator('.q-item').first()).toContainText('ETA');
  await expect(tab(page, 1).locator('.et-q')).toHaveText('#1');
  await expect(tab(page, 2).locator('.et-q')).toHaveText('#3');
  // ↑ moves Construction Robotics ahead of Parts Fabrication
  await strip.locator('button[data-act="up"][data-tech="constructionRobotics"]').click();
  await expect.poll(() => queue(page))
    .toEqual(['regolithProcessing', 'constructionRobotics', 'partsFabrication', 'regolithShielding']);
  // × is transitive: Regolith Shielding drops with its prerequisite
  await strip.locator('button[data-act="cancel"][data-tech="constructionRobotics"]').click();
  await expect.poll(() => queue(page)).toEqual(['regolithProcessing', 'partsFabrication']);
  await expect(page.locator('#tech-alerts')).toContainText('RESEARCH DROPPED — Regolith Shielding');
  // right-click cancels a queued card
  await card(page, 'partsFabrication').click({ button: 'right' });
  await expect.poll(() => queue(page)).toEqual(['regolithProcessing']);
  // a past page's leftover queues at its own era's price
  await page.keyboard.press('BracketLeft');
  await onPage(page, 1);
  await card(page, 'bifacialCells').click();
  await expect.poll(() => queue(page)).toEqual(['regolithProcessing', 'bifacialCells']);
});

test('queue full: cards show ⊘ and a click explains QUEUE FULL', async ({ page }) => {
  await boot(page, 'mare', 'robotic');
  for (const t of ['teleoperation', 'prospectingRovers', ...E1_EXTRA]) await g(page, 'completeTech', t);
  for (const t of ['regolithProcessing', 'regolithVolatiles', 'batteryStorage', 'thermalWadis', 'constructionRobotics']) {
    await g(page, 'research', t);
  }
  await g(page, 'advanceGameSeconds', 1);
  await openTree(page);
  await expect(page.locator('#tech-queue')).toContainText('Queue 5/5');
  const silicon = card(page, 'siliconRefining');
  await expect(silicon).toHaveClass(/\bfull\b/);
  await expect(silicon.locator('.gl')).toHaveText('⊘');
  await silicon.click();
  await expect(page.locator('#tech-alerts')).toContainText('QUEUE FULL (5/5) — cancel one first');
  await card(page, 'partsFabrication').click({ modifiers: ['Shift'] });
  await expect(page.locator('#tech-alerts')).toContainText('QUEUE FULL — 0 of 1 fit');
  expect(await queue(page)).toHaveLength(5);
  await page.screenshot({ path: 'test-results/pages-queue-full.png' });
});

test('keys and live updates: T toggles, arrows move within the page, Enter queues, Esc closes; progress updates in place', async ({ page }) => {
  await boot(page, 'mare', 'robotic');
  expect(await g(page, 'placeBuilding', 'lab', 135, 133)).toBe(true);
  await g(page, 'advanceGameSeconds', 80);
  await openTree(page);
  await page.keyboard.press('ArrowDown'); // first press selects the first available card
  const first = await page.locator('.tech-card.sel').getAttribute('data-tech');
  expect(first).toBeTruthy();
  await page.keyboard.press('ArrowDown');
  const second = await page.locator('.tech-card.sel').getAttribute('data-tech');
  expect(second).not.toBe(first);
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.tech-card.sel')).toHaveAttribute('data-tech', first!);
  // ← and → stay on the lane row; nothing moves off the page
  const rowOf = async () => page.locator('.tech-card.sel').evaluate((e) => (e as HTMLElement).style.getPropertyValue('--r'));
  const r0 = await rowOf();
  await page.keyboard.press('ArrowRight');
  expect(await rowOf()).toBe(r0);
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.tech-card.sel')).toHaveAttribute('data-tech', first!);
  await page.keyboard.press('Enter');
  await expect.poll(() => queue(page)).toEqual([first]);
  // Enter never cancels
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  expect(await queue(page)).toEqual([first]);
  // Shift+Enter queues a path: Sample Caches needs Prospecting Rovers
  const sc = await g(page, 'getResearch');
  expect(sc.cards.sampleCaches.state).toBe('requires');
  await card(page, 'sampleCaches').click();
  await page.mouse.move(4, 716);
  await page.keyboard.press('Shift+Enter');
  await expect.poll(async () => (await queue(page)).slice(-2)).toEqual(['prospectingRovers', 'sampleCaches']);

  // the queued card is updated in place: same element, a growing bar
  await g(page, 'grantData', 200);
  const el = await card(page, first!).elementHandle();
  const w0 = await card(page, first!).locator('.prog i').evaluate((e) => (e as HTMLElement).style.width);
  await g(page, 'advanceGameSeconds', 20);
  await expect.poll(async () => card(page, first!).locator('.prog i').evaluate((e) => (e as HTMLElement).style.width)).not.toBe(w0);
  expect(await el!.evaluate((e) => e.isConnected)).toBe(true);

  await page.keyboard.press('Escape');
  await expect(page.locator('#tech-screen')).toBeHidden();
  await page.keyboard.press('KeyT');
  await expect(page.locator('#tech-screen')).toBeVisible();
  await page.keyboard.press('KeyT');
  await expect(page.locator('#tech-screen')).toBeHidden();
  // the HUD chip carries the research gauge while the tree is closed
  await expect(page.locator('#era-chip')).toContainText(/ERA 1/);
  await expect(page.locator('#chip-res-pct')).toHaveText(/%/);
});

test('goods chips follow the sim: water the crew is holding is short, on the card and in the sheet', async ({ page }) => {
  test.setTimeout(240_000);
  await boot(page, 'mare', 'human');
  const setup = await page.evaluate(() => {
    const g = window.__game!;
    g.setPaused(true);
    g.advanceGameSeconds(0);
    // Molten Regolith Electrolysis: the smelter makes no water, so the tanks hold still
    for (const t of ['regolithProcessing', 'teleoperation', 'grizzlyScreens', 'fieldSpectrometers',
      'constructionRobotics', 'partsFabrication', 'batteryStorage', 'moltenElectrolysis', 'dispatchMesh']) g.completeTech(t);
    const spots: [number, number][] = [];
    for (let gz = 112; gz <= 143; gz++) for (let gx = 112; gx <= 143; gx++) spots.push([gx, gz]);
    spots.sort((a, b) => Math.hypot(a[0] - 127, a[1] - 127) - Math.hypot(b[0] - 127, b[1] - 127));
    const placed: Record<string, number> = {};
    for (const [type, n] of [['solar', 2], ['lab', 2]] as const) {
      placed[type] = 0;
      for (const [gx, gz] of spots) {
        if (placed[type] >= n) break;
        if (g.placeBuilding(type, gx, gz)) placed[type]++;
      }
    }
    g.finishConstruction();
    // 80.5≈ covers the 80 in raw stock, but not 80 above the crew's reserve
    g.grantResources({ water: 80.5 - g.getState().resources.water });
    const s = g.getState();
    return { placed, crew: s.crew, water: s.resources.water, card: g.getResearch().cards.regenFuelCells };
  });
  expect(setup.placed).toEqual({ solar: 2, lab: 2 });
  expect(setup.crew).toBeGreaterThan(0);
  expect(setup.water).toBeGreaterThanOrEqual(80);
  expect(setup.card.state).toBe('available');
  expect(setup.card.goodsShort).toEqual(['water']);

  await openTree(page);
  await onPage(page, 3);
  // an unqueued card: its line-2 chip
  await expect(card(page, 'regenFuelCells').locator('.g[data-res="water"]')).toHaveClass(/\bshort\b/);

  // queue it and pay its data with the tanks low, so it cannot finish meanwhile
  const paid = await page.evaluate(() => {
    const g = window.__game!;
    g.research('regenFuelCells');
    g.grantData(1000);
    g.grantResources({ water: 40 - g.getState().resources.water });
    // its data at 2 × 0.4/s, within the day
    const need = g.getResearch().cards.regenFuelCells.cost.data / 0.8 + 20;
    for (let t = 0; t < need; t += 10) { g.grantPower(5000); g.advanceGameSeconds(10); }
    g.grantResources({ water: 80.5 - g.getState().resources.water });
    const s = g.getState();
    return { stalled: s.researchStalled, done: s.techsDone, water: s.resources.water, card: g.getResearch().cards.regenFuelCells };
  });
  expect(paid.stalled).toEqual(['regenFuelCells']);
  expect(paid.done).not.toContain('regenFuelCells');
  expect(paid.water).toBeGreaterThanOrEqual(80);
  expect(paid.card.state).toBe('stalled');
  expect(paid.card.pct).toBe(1);
  expect(paid.card.goodsShort).toEqual(['water']);
  expect(paid.card.stalledNeed).toMatch(/^80≈ water \(have 80, \d+ held for the crew\)/);

  // the queued, paid card: a doctrine, so the sheet shows both members side by
  // side; Fuel Cells' water chip is short although 80.5 ≥ 80
  await card(page, 'regenFuelCells').hover();
  const chip = page.locator('#tech-sheet-body .doc-side[data-tech="regenFuelCells"] .g[data-res="water"]');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveClass(/\bshort\b/);
  // each side answers for its own tech: the rival's chips follow its own shortfall
  const rival = await page.evaluate(() => {
    const c = window.__game!.getResearch().cards.thoriumPower;
    return { goods: Object.keys(c.cost.goods), short: c.goodsShort };
  });
  expect(rival.goods.length).toBeGreaterThan(0);
  for (const r of rival.goods) {
    const rc = page.locator(`#tech-sheet-body .doc-side[data-tech="thoriumPower"] .g[data-res="${r}"]`);
    if (rival.short.includes(r)) await expect(rc).toHaveClass(/\bshort\b/);
    else await expect(rc).not.toHaveClass(/\bshort\b/);
  }
});
