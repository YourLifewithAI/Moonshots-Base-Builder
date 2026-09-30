/** Guidance: deposit cards (the overlay's labels and the Lunar Map's SITE
 *  view say what the ground is and what to do with it), discovery pop-ups
 *  for finished techs, era explainers, and the switch that turns the last
 *  two off. Test runs are quiet by default; `&tips` opts in. */
import { test, expect as baseExpect, type Page } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 20_000 });

declare global {
  interface Window { __game?: any }
}

const BASE = '/?debug&seed=42';

async function boot(page: Page, extra = '', site = 'mare') {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`${BASE}&site=${site}&exp=robotic${extra}`);
  await page.waitForFunction(() => window.__game !== undefined);
}

const g = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => window.__game[f as string](...(a as unknown[])), [fn, args] as const);

test('deposit labels open a card: what the ground is, its numbers, and an action', async ({ page }) => {
  test.setTimeout(180_000);
  await boot(page);
  await page.keyboard.press('KeyI');
  const mark = page.locator('.deposit-mark:not(.lead)').first();
  await expect(mark).toBeVisible();
  await mark.click();
  const card = page.locator('#deposit-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('High-Ti basalt');
  // the card's lines quote the deposit's ore grade for each hub that would work it (docs/17 §9)
  await expect(card).toContainText(/Smelters \(hydrogen reduction\): q [\d.]+–[\d.]+ at its centre/);
  await expect(card).toContainText(/Silicon Refineries: q [\d.]+–[\d.]+ from it/);
  await expect(card).toContainText(/inside your build network/);
  // a second click on the same label closes it; Esc closes it too
  await mark.click();
  await expect(card).toBeHidden(); // a second click on the same label toggles it off
  await mark.click();
  await expect(card).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();

  // an unconfirmed lead names the survey tier that would confirm it; the
  // isometric view frames the base tightly, so zoom out until one is in view
  const lead = page.locator('.deposit-mark.lead').first();
  for (let i = 0; i < 4 && !(await lead.isVisible()); i++) {
    await page.mouse.move(683, 300);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(1200);
  }
  await lead.click();
  await expect(card).toContainText(/Unconfirmed lead/);
  await expect(card).toContainText(/T1 Prospecting Drones maps 320 m/);
  await expect(card.locator('[data-dact="tree"]')).toBeVisible();

  // the action: focus the ground and start placing what uses it
  await mark.click();
  await card.locator('[data-dact="place"]').click();
  await expect(card).toBeHidden();
  await expect.poll(async () => (await page.evaluate(() => {
    const el = document.querySelector('#place-hint');
    return el && getComputedStyle(el).display !== 'none' ? el.textContent ?? '' : '';
  }))).toMatch(/REGOLITH SMELTER/);
});

test('the Lunar Map SITE view: a deposit click fills the side panel; Show in the world', async ({ page }) => {
  test.setTimeout(180_000);
  await boot(page);
  await page.keyboard.press('KeyM');
  await expect(page.locator('#map-screen')).toBeVisible();
  await page.locator('.map-layer.cur .dep-t').first().click({ force: true });
  const sheet = page.locator('#map-screen .map-dep');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('High-Ti basalt');
  await expect(sheet.locator('[data-dact="place"]')).toBeVisible();
  await sheet.locator('[data-dact="world"]').click();
  await expect(page.locator('#map-screen')).toBeHidden();
  await expect(page.locator('#deposit-card')).toBeVisible();
  await expect(page.locator('.deposit-mark.sel')).toHaveCount(1);
});

test('discoveries: a finished tech pops a card with its gains and next step', async ({ page }) => {
  test.setTimeout(180_000);
  await boot(page, '&tips');
  // a new mission opens with the Era 1 explainer, paused until Begin
  const banner = page.locator('#era-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('FIRST LANDING');
  await expect.poll(async () => (await g(page, 'getState')).paused).toBe(true);
  await banner.locator('[data-dsc="ok"]').click();
  await expect(banner).toBeHidden();
  await expect.poll(async () => (await g(page, 'getState')).paused).toBe(false);

  await g(page, 'completeTech', 'regolithProcessing');
  const card = page.locator('#discovery-card');
  await expect(card).toBeVisible();
  // the first tech is Pit Mapping now (the smelter itself is known from landing): its gain and its next step
  await expect(card).toContainText('Pit Mapping');
  await expect(card).toContainText('+30% speed off-road, in pits and deposits');
  await expect(card).toContainText('Your units cross pits and ramps faster');
  expect((await g(page, 'getState')).paused).toBe(false); // cards never pause
  await card.locator('[data-dsc="ok"]').click();
  await expect(card).toBeHidden();

  // four era-1 techs open Era 2 (the charter): its explainer, with the next era's routes
  for (const [tid, name] of [['teleoperation', 'Earth Teleoperation'], ['grizzlyScreens', 'Grizzly Screens'],
    ['fieldSpectrometers', 'Field Spectrometers']]) {
    await g(page, 'completeTech', tid);
    await expect(card).toContainText(name);
    await card.locator('[data-dsc="ok"]').click();
  }
  await g(page, 'advanceGameSeconds', 1);
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('EARLY CONSTRUCTION');
  await expect(banner).toContainText(/era 3.*opens with this era’s destiny and 3 more of its techs, or the destiny, 1 more and: 200⚙ fabricated/i);
  await expect(banner).toContainText('Who are these halls built for?');
  await page.keyboard.press('Enter');
  await expect(banner).toBeHidden();
  expect((await g(page, 'getAudio')).played.era).toBeGreaterThanOrEqual(1);
});

test('the switch: "Hide these pop-ups" and the menu toggle keep them off, across reloads', async ({ page }) => {
  test.setTimeout(180_000);
  await boot(page, '&tips');
  const banner = page.locator('#era-banner');
  await expect(banner).toBeVisible();
  await banner.locator('[data-dsc="off"]').check();
  await expect(banner).toBeHidden();
  expect((await g(page, 'getState')).paused).toBe(false);
  await g(page, 'completeTech', 'regolithProcessing');
  await page.waitForTimeout(1000);
  await expect(page.locator('#discovery-card')).toBeHidden();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mbb-settings') ?? '{}'));
  expect(saved.tips).toBe(false);
  // the menu shows it, and turns it back on
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu-tips')).toHaveText('Off');
  await page.locator('#menu-tips').click();
  await expect(page.locator('#menu-tips')).toHaveText('On');
  await page.locator('#menu [data-act="resume"]').click();
  await g(page, 'completeTech', 'teleoperation');
  await expect(page.locator('#discovery-card')).toContainText('Earth Teleoperation');
});
