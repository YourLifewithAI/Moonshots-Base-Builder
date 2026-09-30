/** The optional guide teaches the current hub loop, never places for the
 * player, and remains usable on fresh, existing and touch missions. */
import { test, expect, type Page } from '@playwright/test';

declare global { interface Window { __game?: any } }

async function boot(page: Page, site = 'mare', extra = '') {
  await page.goto(`/?debug&seed=42&site=${site}&exp=robotic${extra}`);
  await page.waitForFunction(() => window.__game?.getState());
  await page.evaluate(() => {
    window.__game.setPaused(true);
    window.__game.advanceGameSeconds(0);
  });
  await expect(page.locator('#first-mine-toggle')).toBeVisible();
}

test('first mine: shows mapped ore, teaches pit clearance, and starts a preview without spending', async ({ page }) => {
  await boot(page);
  await page.locator('#first-mine-toggle').click();
  const guide = page.locator('#first-mine');
  await expect(guide).toHaveAttribute('data-step', '1');
  await expect(guide).toContainText('yield multiplier');
  await page.screenshot({ path: test.info().outputPath('first-mine-desktop.png') });
  const before = await page.evaluate(() => window.__game.getState());
  await guide.locator('[data-fm="ground"]').click();
  await expect(guide).toHaveAttribute('data-step', '2');
  await expect(page.locator('#deposit-card')).toContainText('high-Ti basalt');
  await expect(guide).toContainText('full-size pit ring');
  await guide.locator('[data-fm="place"]').click();
  await expect.poll(() => page.evaluate(() => window.__game.getTouch().placing?.type)).toBe('smelter');
  const after = await page.evaluate(() => window.__game.getState());
  expect(after.buildings.length).toBe(before.buildings.length);
  expect(after.resources.metals).toBe(before.resources.metals);
  expect(after.resources.parts).toBe(before.resources.parts);
  await expect(guide).toBeHidden();
  await page.locator('#first-mine-toggle').click();
  await guide.locator('[data-fm="hide"]').click();
  await expect(guide).toBeHidden();
  await expect(page.locator('#milestones')).toBeVisible();
  await page.locator('#first-mine-toggle').click();
  await expect(guide).toHaveAttribute('data-step', '2');
});

test('first mine: polar crew mission teaches plain regolith, not nonexistent basalt', async ({ page }) => {
  await page.goto('/?debug&seed=42&site=southpole&exp=human');
  await page.waitForFunction(() => window.__game?.getState());
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
  await page.locator('#first-mine-toggle').click();
  const guide = page.locator('#first-mine');
  await expect(guide).toContainText('pole has no high-Ti basalt');
  await guide.locator('[data-fm="ground"]').click();
  await expect(guide).toContainText('mapped plain ground');
  await guide.locator('[data-fm="hide"]').click();
  // Guidance is enabled on this launch: the saved Hide choice must still win.
  await page.goto('/?debug&seed=42&site=southpole&exp=human&tips');
  await page.waitForFunction(() => window.__game?.getState());
  await expect(page.locator('#era-banner')).toBeVisible();
  await page.locator('#era-banner [data-dsc="ok"]').click();
  await expect(page.locator('#first-mine')).toBeHidden();
  await expect(page.locator('#first-mine-toggle')).toBeVisible();
});

test('first mine: touch controls are reachable and lava-tube ground is suitable', async ({ page }) => {
  await page.setViewportSize({ width: 812, height: 375 });
  await boot(page, 'lavatube', '&touch');
  await page.locator('#first-mine-toggle').click();
  const guide = page.locator('#first-mine');
  await expect(guide).toContainText('mapped high-Ti basalt');
  const show = guide.locator('[data-fm="ground"]');
  await show.scrollIntoViewIfNeeded();
  const box = await show.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(812);
  expect(box!.y + box!.height).toBeLessThanOrEqual(375);
  await page.screenshot({ path: test.info().outputPath('first-mine-touch.png') });
  await show.click();
  await expect(page.locator('#deposit-card')).toBeVisible();
  await page.locator('#deposit-card [data-dact="close"]').click();
  await expect(guide).toHaveAttribute('data-step', '2');
});

test('first mine: existing hub uses live constraints; resource teaching describes hub-owned loads', async ({ page }) => {
  await boot(page);
  const id = await page.evaluate(() => {
    const g = window.__game;
    g.grantResources({ metals: 2000, parts: 1000 });
    g.openRoads(true);
    for (let r = 4; r < 23; r++) for (let dx = -r; dx <= r; dx++) for (const dz of [-r, r]) {
      const gx = 128 + dx, gz = 128 + dz;
      if (!g.canPlace('smelter', gx, gz, 0).valid) continue;
      if (g.placeBuilding('smelter', gx, gz, 0)) {
        g.finishConstruction();
        const id = g.getState().buildings.find((b: any) => b.type === 'smelter').id;
        return id;
      }
    }
    return null;
  });
  expect(id).not.toBeNull();
  await page.locator('#first-mine-toggle').click();
  await expect(page.locator('#first-mine')).toHaveAttribute('data-step', '3');
  await expect(page.locator('#first-mine')).toContainText('its own hub’s hopper');
  await page.locator('#first-mine [data-fm="inspect"]').click();
  await expect(page.locator('#inspector')).toContainText('Regolith Smelter');
  await page.locator('#first-mine [data-fm="done"]').click();
  await expect(page.locator('#first-mine-toggle')).toContainText('replay');
  await page.locator('#first-mine-toggle').click();
  await expect(page.locator('#first-mine')).toHaveAttribute('data-step', '1');
  await page.locator('#first-mine [data-fm="ground"]').click();
  await expect(page.locator('#first-mine [data-fm="place"]')).toHaveText('Review existing hub');
  await page.locator('#first-mine [data-fm="place"]').click();
  await expect(page.locator('#first-mine')).toHaveAttribute('data-step', '3');
  expect(await page.evaluate(() => window.__game.getState().buildings.filter((b: any) => b.type === 'smelter').length)).toBe(1);
  await page.locator('#first-mine [data-fm="done"]').click();
  await page.locator('#resource-strip [data-key="regolith"]').click();
  await expect(page.locator('#res-panel')).toContainText('Hub mining units');
  await expect(page.locator('#res-panel')).toContainText('shared pile plus every hub');
  await expect(page.locator('#res-panel')).not.toContainText('nearest smelter');
  await expect(page.locator('#res-panel')).not.toContainText('Nothing on the Moon makes this yet');
});

test('first mine: unconfirmed leads stay hidden and face congestion gets an actionable explanation', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const path = '/src/ui/firstMine.ts';
    const { firstMineDeposit, firstMineDiagnosis } = await import(path);
    const candidates = [
      { id: 'hidden', kind: 'ilmenite', revealed: false, inNetwork: true },
      { id: 'far', kind: 'ilmenite', revealed: true, inNetwork: false },
      { id: 'mapped', kind: 'anorthosite', revealed: true, inNetwork: true },
    ];
    return {
      chosen: firstMineDeposit(candidates)?.id,
      why: firstMineDiagnosis({ id: 7, enabled: true, idleReason: '' }, {
        hubs: { 7: { hopper: 0, starved: 0 } },
        units: [{ hub: 7, line: 'WAITING AT THE GATE — 1/1 faces working' }],
      }),
    };
  });
  expect(result.chosen).toBe('mapped');
  expect(result.why).toContain('one face serves one unit');
  expect(result.why).toContain('assign a different pit');
});
