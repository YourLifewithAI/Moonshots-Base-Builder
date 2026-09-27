import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

const SHOTS = process.env.HUBVIEW_SHOTS ?? '';

async function start(page: Page, site = 'mare', style = 'classic', extra = '') {
  await page.goto(`/?debug&seed=42&nolock&lowfx&style=${style}&site=${site}&exp=robotic${extra}`);
  await page.waitForFunction(() => window.__game !== undefined && window.__game.getState() !== null);
  await page.evaluate(() => {
    const g = window.__game!;
    g.setPaused(true);
    g.advanceGameSeconds(0);
    g.holdHazards(true);
    g.openRoads(true);
    g.grantResources({ metals: 2000, parts: 1000, silicon: 300 });
    g.grantPower(20000);
  });
}

test('probe', async ({ page }) => {
  await start(page);
  const a = await page.evaluate(() => {
    const g = window.__game!;
    const d = g.getDeposits().find((q: any) => q.id === 'ilmenite-0');
    let spot = null;
    for (let m = d.r + 6; m < d.r + 80 && !spot; m += 4) {
      for (let k = 0; k < 16 && !spot; k++) {
        const gx = Math.floor((d.x + Math.cos(k / 16 * 6.283) * m + 512) / 4) - 1, gz = Math.floor((d.z + Math.sin(k / 16 * 6.283) * m + 512) / 4) - 1;
        for (const rot of [0, 1, 2, 3]) if (g.canPlace('smelter', gx, gz, rot).valid) { spot = { gx, gz, rot, m, warn: g.canPlace('smelter', gx, gz, rot).warn }; break; }
      }
    }
    const block = g.hubBlock('smelter', spot!.gx, spot!.gz, spot!.rot);
    return { d, spot, block, deps: g.getDeposits().filter((q: any) => q.revealed).map((q: any) => `${q.id} ${Math.round(q.x)},${Math.round(q.z)} r${Math.round(q.r)}`) };
  });
  console.log(JSON.stringify(a, null, 1));
});

test('probe shot', async ({ page }) => {
  await start(page);
  const spot = await page.evaluate(() => {
    const g = window.__game!;
    const d = g.getDeposits().find((q: any) => q.id === 'ilmenite-0');
    g.focusGround(d.x + 20, d.z - 10);
    return d;
  });
  await page.waitForTimeout(1500);
  const at = await page.evaluate((d) => {
    const g = window.__game!;
    g.beginPlacement('smelter');
    return g.screenOf(d.x + d.r + 24, d.z - 20);
  }, spot);
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(800);
  const info = await page.evaluate(() => window.__game!.getHighlight());
  console.log(JSON.stringify({ drawn: info.drawn, view: info.view, n: info.light?.entries.length }, null, 1));
  console.log(await page.locator('#place-hint').innerText());
  console.log(await page.locator('.deposit-mark').allInnerTexts());
  await page.screenshot({ path: `${process.env.SHOTDIR ?? '/tmp'}/probe-ghost.png` });
});
