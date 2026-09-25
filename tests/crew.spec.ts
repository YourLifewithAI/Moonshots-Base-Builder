/** Crew at stations: every settler aboard works a station, so a big crewed
 *  base runs short of hands long before it runs short of beds. Once agents
 *  can run stations, they cover the short-handed ones (economy step 3.5) and
 *  hand them back as settlers free up; a station crewed by hand stays crewed.
 *  The Crew panel and the inspector say what the stations want. */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

async function start(page: Page) {
  await page.goto('/?debug&seed=42&nolock&lowfx&site=mare');
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => {
    const G = window.__game;
    G.setPaused(true);
    G.advanceGameSeconds(0);
    G.completeTech('regolithProcessing');
    G.grantResources({ metals: 2000, parts: 800, silicon: 200, water: 2000, oxygen: 2000, food: 2000 });
    const w = window as any;
    w.place = (t: string, n: number) => {
      let k = 0;
      for (let gz = 112; gz <= 143 && k < n; gz++) for (let gx = 112; gx <= 143 && k < n; gx++) if (G.placeBuilding(t, gx, gz)) k++;
      return k;
    };
    w.powered = (secs: number) => {
      for (let t = 0; t < secs; t += 5) { G.grantPower(5000); G.advanceGameSeconds(Math.min(5, secs - t)); }
    };
    w.place('solar', 12);
    w.place('lab', 6); // 6 × 2 seats: more than the landing crew
    G.finishConstruction();
  });
}

const labs = (s: any) => s.buildings.filter((b: any) => b.type === 'lab');

test('agents cover short-handed stations once they may, and settlers take them back', async ({ page }) => {
  test.setTimeout(120_000);
  await start(page);
  // before Construction Robotics: short-handed labs just idle, and say why
  let s = await page.evaluate(() => { (window as any).powered(3); return window.__game.getState(); });
  const crew = s.crew;
  expect(crew).toBeLessThan(12);
  const idle = labs(s).filter((b: any) => b.idleReason === 'crew');
  expect(idle.length).toBeGreaterThan(0);
  expect(labs(s).every((b: any) => !b.automated)).toBe(true);

  await page.evaluate((id) => window.__game.select(id), idle[0].id);
  await expect(page.locator('#inspector')).toContainText(/IDLE — no crew free \(\d+ aboard, stations want \d+\)/);
  await expect(page.locator('#inspector')).toContainText('Every settler aboard already works a station');

  // with it, agents take the idle labs from the next tick
  s = await page.evaluate(() => {
    window.__game.select(null);
    window.__game.completeTech('constructionRobotics');
    (window as any).powered(3);
    return window.__game.getState();
  });
  expect(labs(s).filter((b: any) => b.idleReason === 'crew')).toHaveLength(0);
  const covered = labs(s).filter((b: any) => b.agentCover && b.automated);
  expect(covered.length).toBe(idle.length);
  expect(s.alerts.some((a: any) => /AGENTS COVER RESEARCH LAB/i.test(a.text))).toBe(true);
  expect(labs(s).filter((b: any) => b.active).length).toBe(6);

  // shut two crewed labs down: the freed hands take covered labs back within 30 s
  const crewed = labs(s).filter((b: any) => !b.automated).slice(0, 2);
  s = await page.evaluate((ids) => {
    for (const id of ids) window.__game.setEnabled(id, false);
    (window as any).powered(35);
    return window.__game.getState();
  }, crewed.map((b: any) => b.id));
  const back = labs(s).filter((b: any) => covered.some((c: any) => c.id === b.id) && !b.automated);
  expect(back.length).toBeGreaterThan(0);
  expect(labs(s).filter((b: any) => b.enabled && b.idleReason === 'crew')).toHaveLength(0);
});

test('a station crewed by hand stays crewed, and the cover can be switched off', async ({ page }) => {
  test.setTimeout(120_000);
  await start(page);
  let s = await page.evaluate(() => {
    window.__game.completeTech('constructionRobotics');
    (window as any).powered(3);
    return window.__game.getState();
  });
  const cov = labs(s).find((b: any) => b.agentCover);
  expect(cov).toBeTruthy();
  // the player insists: crewed, even with no hands free
  s = await page.evaluate((id) => {
    window.__game.setAutomated(id, false);
    (window as any).powered(10);
    return window.__game.getState();
  }, cov.id);
  const pinned = s.buildings.find((b: any) => b.id === cov.id);
  expect(pinned.automated).toBe(false);
  expect(pinned.crewPinned).toBe(true);
  expect(pinned.idleReason).toBe('crew');

  // cover off: a new short-handed station idles instead of going agent-run
  s = await page.evaluate(() => {
    const G = window.__game;
    G.setAgentCover(false);
    (window as any).place('lab', 1);
    G.finishConstruction();
    (window as any).powered(5);
    return G.getState();
  });
  expect(s.agentCover).toBe(false);
  const newest = labs(s).sort((a: any, b: any) => b.id - a.id)[0];
  expect(newest.automated).toBe(false);
  expect(newest.idleReason).toBe('crew');
});

test('the Crew panel counts what the stations want against who is aboard', async ({ page }) => {
  test.setTimeout(120_000);
  await start(page);
  await page.evaluate(() => {
    window.__game.completeTech('constructionRobotics');
    (window as any).powered(3);
  });
  await page.locator('.chip[data-slot="crew"]').click();
  const panel = page.locator('#res-panel');
  await expect(panel).toContainText(/\d+ aboard · \d+ beds/);
  await expect(panel).toContainText(/Crewed stations want\s*\d+ crew/);
  await expect(panel).toContainText(/Agents covering\s*\d+ station/);
  const box = panel.locator('input[data-act="agent-cover"]');
  await expect(box).toBeChecked();
  await box.uncheck();
  await page.evaluate(() => window.__game.advanceGameSeconds(1));
  expect(await page.evaluate(() => window.__game.getState().agentCover)).toBe(false);
});
