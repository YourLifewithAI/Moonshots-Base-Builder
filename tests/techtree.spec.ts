/** The research tree screen (docs/11 §6, §9 tests 1, 2, 5–9 UI parts):
 *  layout budget at 1280×720, hover closure, doctrine commit, Shift-click
 *  paths, the full queue, keys and in-place updates. */
import { test, expect as baseExpect, type Page } from '@playwright/test';

// UI actions reach the sim on the next rendered frame; under software GL on a
// loaded machine a frame can take seconds, so assertions get a wider window
const expect = baseExpect.configure({ timeout: 20_000 });

declare global {
  interface Window { __game?: any }
}

const BASE = '/?debug&seed=42&nolock&lowfx';

async function boot(page: Page, site: string, exp: 'human' | 'robotic', viewport = { width: 1280, height: 720 }) {
  await page.setViewportSize(viewport);
  await page.goto(`${BASE}&site=${site}${exp === 'robotic' ? '&exp=robotic' : ''}`);
  await page.waitForFunction(() => window.__game !== undefined);
}

async function openTree(page: Page) {
  await page.keyboard.press('KeyT');
  await expect(page.locator('#tech-screen')).toBeVisible();
  await expect(page.locator('.tech-card').first()).toBeVisible();
}

const card = (page: Page, tid: string) => page.locator(`.tech-card[data-tech="${tid}"]`);
const g = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => window.__game[f as string](...(a as unknown[])), [fn, args] as const);

/** every card inside the viewport and above the sheet, pairwise disjoint */
async function layoutReport(page: Page) {
  return page.evaluate(() => {
    const boxes = [...document.querySelectorAll<HTMLElement>('.tech-card')]
      .map((e) => ({ t: e.dataset.tech!, r: e.getBoundingClientRect() }));
    const sheetTop = document.querySelector('#tech-sheet')!.getBoundingClientRect().top;
    const overlaps: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].r, b = boxes[j].r;
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) overlaps.push(`${boxes[i].t}/${boxes[j].t}`);
      }
    }
    const outside = boxes.filter(({ r }) => r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > sheetTop).map((b) => b.t);
    const cap = document.querySelector('.tech-card[data-tech="swarmProtocol"]')!.getBoundingClientRect();
    const main = document.querySelector('#tech-main')!;
    const scr = document.querySelector('#tech-screen')!;
    return {
      count: boxes.length, overlaps, outside,
      capVisible: cap.left >= 0 && cap.right <= innerWidth && cap.top >= 0 && cap.bottom <= sheetTop,
      scroll: [main.scrollWidth - main.clientWidth, scr.scrollWidth - scr.clientWidth, document.documentElement.scrollWidth - innerWidth],
      slotH: parseFloat(getComputedStyle(document.querySelector('#tech-board')!).getPropertyValue('--slot-h')),
    };
  });
}

type Run = [string, 'human' | 'robotic', { width: number; height: number }];

/** boot each run, open the tree, assert the layout budget, take the r2 screenshot */
async function checkRuns(page: Page, runs: Run[]) {
  for (const [site, exp, vp] of runs) {
    await boot(page, site, exp, vp);
    if (site === 'mare') {
      // a lived-in tree for the screenshots: two techs done, two queued, one hovered
      await g(page, 'placeBuilding', 'lab', 135, 133);
      await g(page, 'advanceGameSeconds', 80);
      await g(page, 'completeTech', 'regolithProcessing');
      await g(page, 'completeTech', 'prospectingRovers');
      await g(page, 'grantData', 300);
      await g(page, 'research', 'teleoperation');
      await g(page, 'research', 'siliconRefining');
      await g(page, 'advanceGameSeconds', 20);
    }
    await openTree(page);
    await expect(page.locator('.lane')).toHaveCount(7);
    await expect(page.locator('.era-head')).toHaveCount(8);
    const r = await layoutReport(page);
    expect(r.overlaps, `${site} ${exp} ${vp.width}`).toEqual([]);
    expect(r.outside, `${site} ${exp} ${vp.width}`).toEqual([]);
    expect(r.capVisible).toBe(true);
    expect(r.scroll.every((d) => d <= 0), `scroll overflow ${r.scroll}`).toBe(true);
    expect(r.slotH).toBeGreaterThanOrEqual(28);
    if (site === 'mare') await page.hover('[data-tech="waferFab"]');
    await page.waitForTimeout(600);
    await page.screenshot({ path: `test-results/r2-${vp.width}x${vp.height}-${exp}-${site}.png` });
  }
}

test('tree fits 1280×720 with the sheet open: 7 lanes × 8 eras, Era 8 on screen, no card overlap', async ({ page }) => {
  test.setTimeout(180_000);
  await checkRuns(page, [
    ['mare', 'robotic', { width: 1280, height: 720 }],
    ['lavatube', 'robotic', { width: 1280, height: 720 }],
    ['southpole', 'human', { width: 1280, height: 720 }],
  ]);
  // the robotic HABITAT lane at full occupancy (Cohab + Closed-Loop in E6, Wellness in E7)
  await boot(page, 'mare', 'robotic');
  await openTree(page);
  for (const t of ['humanCohabitation', 'closedLoopLS', 'crewWellness']) await expect(card(page, t)).toBeVisible();
  const hab = await page.evaluate(() => ['humanCohabitation', 'closedLoopLS', 'crewWellness'].map((t) =>
    document.querySelector(`.tech-card[data-tech="${t}"]`)!.getBoundingClientRect().toJSON()));
  expect(hab[1].top).toBeGreaterThanOrEqual(hab[0].bottom);
  expect(hab[2].left).toBeGreaterThanOrEqual(hab[0].right);
  // collapsed sheet: the grid grows and still fits
  await page.locator('#tech-sheet-toggle').click();
  await expect(page.locator('#tech-sheet')).toHaveClass(/collapsed/);
  const c = await layoutReport(page);
  expect(c.overlaps).toEqual([]);
  expect(c.outside).toEqual([]);
  expect(c.slotH).toBeGreaterThan(40);
});

test('tree at 1600×900: wider columns, capped slots, the spare height goes to the sheet', async ({ page }) => {
  test.setTimeout(180_000);
  await checkRuns(page, [
    ['mare', 'robotic', { width: 1600, height: 900 }],
    ['mare', 'human', { width: 1600, height: 900 }],
  ]);
  const sheet = await page.locator('#tech-sheet').boundingBox();
  expect(sheet!.height).toBeGreaterThan(148);
  expect(sheet!.y + sheet!.height).toBeLessThanOrEqual(900);
});

test('site filters: the footer names other-site techs; the pole MRE has no doctrine bracket', async ({ page }) => {
  await boot(page, 'mare', 'robotic');
  await openTree(page);
  await expect(page.locator('#tech-other-sites')).toHaveText('◬ 4 techs belong to other landing sites');
  for (const t of ['siteGrading', 'iceExtraction', 'peakLightMasts', 'skylightHeliostats']) await expect(card(page, t)).toHaveCount(0);
  await expect(page.locator('.doc-bracket[data-group="smeltDoctrine"]')).toHaveCount(1);
  // an undiscovered breakthrough keeps its reserved slot as a placeholder
  await expect(card(page, 'btLavaTubeCaverns')).toHaveClass(/ph/);
  await expect(card(page, 'btLavaTubeCaverns')).toContainText('? Breakthrough');

  await boot(page, 'southpole', 'robotic');
  await openTree(page);
  await expect(card(page, 'moltenElectrolysis')).toBeVisible();
  await expect(card(page, 'moltenElectrolysis')).not.toHaveClass(/doctrine/);
  await expect(page.locator('.doc-bracket[data-group="smeltDoctrine"]')).toHaveCount(0);
  await expect(card(page, 'ilmeniteBeneficiation')).toHaveCount(0);
});

test('hover highlights the prerequisite closure and dependents and dims the rest', async ({ page }) => {
  await boot(page, 'mare', 'robotic');
  await g(page, 'completeTech', 'regolithProcessing');
  await openTree(page);
  await page.hover('[data-tech="waferFab"]');
  await expect(page.locator('#tech-grid')).toHaveClass(/hovering/);
  for (const t of ['regolithProcessing', 'siliconRefining', 'partsFabrication', 'acceleratorDesign', 'lunarDataCenter', 'foilManufacturing']) {
    await expect(card(page, t)).toHaveClass(/\bhl\b/);
  }
  await expect(card(page, 'batteryStorage')).not.toHaveClass(/\bhl\b/);
  await page.waitForTimeout(400); // opacity transition
  const op = await page.evaluate(() => Number(getComputedStyle(document.querySelector('.tech-card[data-tech="batteryStorage"]')!).opacity));
  expect(op).toBeLessThanOrEqual(0.4);
  // highlighted links: solid from a done source, the silicon goods link dotted
  await expect(page.locator('#tech-links path.hi[data-edge="siliconRefining>waferFab"]')).toHaveCount(1);
  await expect(page.locator('#tech-links path.hi.done[data-edge="regolithProcessing>siliconRefining"]')).toHaveCount(1);
  await expect(page.locator('#tech-links path.goods[data-goods="silicon"]')).toHaveCount(1);
  // the sheet: generated lines, lock reason, leads-to, the insight hint
  const sheet = page.locator('#tech-sheet-body');
  await expect(sheet).toContainText('Wafer Fabrication');
  await expect(sheet).toContainText('⊕ UNLOCK Chip Fab');
  await expect(sheet).toContainText('⊖');
  await expect(sheet).toContainText('ERA LOCKED — opens with Era 4');
  await expect(sheet).toContainText('Leads to');
  await expect(sheet).toContainText('⚡ Insight: 150◇ in stock');
  // an OR group: Dust Mitigation converges on a diamond at its left edge
  await page.hover('[data-tech="dustMitigation"]');
  await expect(page.locator('#tech-links .or-dia.hi[data-or="dustMitigation"]')).toHaveCount(1);
  await page.mouse.move(640, 700);
  await expect(page.locator('#tech-grid')).not.toHaveClass(/hovering/);
});

test('doctrine: a card click only selects; Commit queues; the sibling is foreclosed', async ({ page }) => {
  await boot(page, 'mare', 'robotic');
  await g(page, 'completeTech', 'regolithProcessing');
  await g(page, 'completeTech', 'prospectingRovers'); // era 2 by charter
  await openTree(page);
  const bracket = page.locator('.doc-bracket[data-group="smeltDoctrine"]');
  await expect(bracket).toHaveAttribute('title', /DOCTRINE · CHOOSE ONE · PERMANENT — How hard do you push the furnace\?/);
  await expect(card(page, 'moltenElectrolysis')).toHaveClass(/available/);

  await card(page, 'moltenElectrolysis').click();
  await page.mouse.move(640, 700);
  const sides = page.locator('.doc-sheet .doc-side');
  await expect(sides).toHaveCount(2);
  await expect(page.locator('.doc-sheet')).toContainText('DOCTRINE · CHOOSE ONE · PERMANENT');
  await expect(page.locator('.doc-sheet')).toContainText('At Ilmenite Plains: Plenty of ilmenite');
  await expect(sides.first()).toContainText(/your base/i);
  await page.waitForTimeout(600);
  expect((await g(page, 'getState')).researchQueue).toEqual([]); // selecting is not queueing

  await page.locator('button.commit[data-tech="moltenElectrolysis"]').click();
  await expect.poll(async () => (await g(page, 'getState')).researchQueue).toEqual(['moltenElectrolysis']);
  await expect(card(page, 'ilmeniteBeneficiation')).toHaveClass(/foreclosed/);
  await expect(card(page, 'ilmeniteBeneficiation')).toContainText('foreclosed (pending)');
  await expect(page.locator('.doc-side[data-tech="ilmeniteBeneficiation"]'))
    .toContainText('foreclosed while Molten Regolith Electrolysis is queued — cancel it to reopen');

  // cancelling from the commit sheet reopens the sibling
  await page.locator('.doc-side button[data-act="cancel"][data-tech="moltenElectrolysis"]').click();
  await expect.poll(async () => (await g(page, 'getState')).researchQueue).toEqual([]);
  await expect(card(page, 'ilmeniteBeneficiation')).toHaveClass(/available/);

  // done → permanently foreclosed, and clicking the foreclosed card queues nothing
  await g(page, 'completeTech', 'moltenElectrolysis');
  await expect(card(page, 'ilmeniteBeneficiation')).toContainText('you chose MRE Smelting');
  await card(page, 'ilmeniteBeneficiation').click();
  await page.mouse.move(640, 700);
  await expect(page.locator('.doc-side[data-tech="ilmeniteBeneficiation"]')).toContainText('foreclosed — you chose Molten Regolith Electrolysis');
  await expect(page.locator('.doc-side[data-tech="moltenElectrolysis"]')).toContainText('✓ CHOSEN');
  await page.waitForTimeout(600);
  expect((await g(page, 'getState')).researchQueue).toEqual([]);
});

test('Shift-click queues the whole path; the queue strip reorders and cancels', async ({ page }) => {
  await boot(page, 'mare', 'robotic');
  await g(page, 'completeTech', 'teleoperation');
  await g(page, 'completeTech', 'prospectingRovers'); // era 2
  await openTree(page);
  // a plain click on a card that needs a prerequisite explains itself
  await card(page, 'partsFabrication').click();
  await expect(page.locator('#tech-alerts')).toContainText('NEEDS PREREQUISITE — Parts Fabrication needs Regolith Smelting · Shift-click queues the whole path');
  expect((await g(page, 'getState')).researchQueue).toEqual([]);

  await card(page, 'partsFabrication').click({ modifiers: ['Shift'] });
  await expect.poll(async () => (await g(page, 'getState')).researchQueue).toEqual(['regolithProcessing', 'partsFabrication']);
  // an OR group takes its cheapest visible member (Site Grading is hidden on the mare)
  await card(page, 'regolithShielding').click({ modifiers: ['Shift'] });
  await expect.poll(async () => (await g(page, 'getState')).researchQueue)
    .toEqual(['regolithProcessing', 'partsFabrication', 'constructionRobotics', 'regolithShielding']);
  await expect(card(page, 'regolithShielding')).toHaveClass(/queued/);
  await expect(card(page, 'regolithShielding')).toContainText('#4');

  const strip = page.locator('#tech-queue');
  await expect(strip).toContainText('Queue 4/5');
  await expect(strip.locator('.q-item')).toHaveCount(4);
  await expect(strip.locator('.q-item').first()).toContainText('ETA');
  // ↑ moves Construction Robotics ahead of Parts Fabrication
  await strip.locator('button[data-act="up"][data-tech="constructionRobotics"]').click();
  await expect.poll(async () => (await g(page, 'getState')).researchQueue)
    .toEqual(['regolithProcessing', 'constructionRobotics', 'partsFabrication', 'regolithShielding']);
  // × is transitive: Regolith Shielding drops with its prerequisite
  await strip.locator('button[data-act="cancel"][data-tech="constructionRobotics"]').click();
  await expect.poll(async () => (await g(page, 'getState')).researchQueue).toEqual(['regolithProcessing', 'partsFabrication']);
  await expect(page.locator('#tech-alerts')).toContainText('RESEARCH DROPPED — Regolith Shielding');
  // right-click cancels a queued card
  await card(page, 'partsFabrication').click({ button: 'right' });
  await expect.poll(async () => (await g(page, 'getState')).researchQueue).toEqual(['regolithProcessing']);
});

test('queue full: cards show ⊘ and a click explains QUEUE FULL', async ({ page }) => {
  await boot(page, 'mare', 'robotic');
  await g(page, 'completeTech', 'teleoperation');
  await g(page, 'completeTech', 'prospectingRovers');
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
  expect((await g(page, 'getState')).researchQueue).toHaveLength(5);
  await page.screenshot({ path: 'test-results/r2-queue-full.png' });
});

test('keys and live updates: T toggles, arrows move, Enter queues, Esc closes; progress updates in place', async ({ page }) => {
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
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await g(page, 'getState')).researchQueue).toEqual([first]);
  // Enter never cancels
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  expect((await g(page, 'getState')).researchQueue).toEqual([first]);

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
