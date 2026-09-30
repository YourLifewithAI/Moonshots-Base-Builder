/** The Lunar Map screen (docs/11 §5b; §9 tests 17 and 19, the UI parts): [M]
 *  and Esc, the views each tier opens, the chip that pulses on an unlock and
 *  the zoom out to the new edge, a survey from the sheet with its countdown,
 *  an outpost card, the 1280×720 budget, and the tree's Map button; and docs/19 S8, outposts made
 *  legible: the OUTPOSTS chip, the producer lines in the resource panels, the outpost alerts, the
 *  field report's words on the sheet, "Outposts cover", the drone copy.
 *  Screenshots: test-results/m3-*.png. */
import { test, expect as baseExpect, type Page } from '@playwright/test';

// UI actions reach the sim on the next rendered frame; under software GL on a
// loaded machine a frame can take seconds, so assertions get a wider window
const expect = baseExpect.configure({ timeout: 20_000 });

declare global {
  interface Window { __game?: any }
}

const BASE = '/?debug&seed=42';

async function boot(page: Page, site = 'mare', exp: 'human' | 'robotic' = 'robotic', viewport = { width: 1280, height: 720 }) {
  await page.setViewportSize(viewport);
  await page.goto(`${BASE}&site=${site}${exp === 'robotic' ? '&exp=robotic' : ''}`);
  await page.waitForFunction(() => window.__game !== undefined);
  // game time moves only through the fast-forwards: every countdown lands on a known second
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
}

const g = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => window.__game[f as string](...(a as unknown[])), [fn, args] as const);
const complete = (page: Page, techs: string[]) =>
  page.evaluate((ts) => { for (const t of ts) window.__game.completeTech(t); }, techs);
const mapScreen = (page: Page) => page.locator('#map-screen');
/** markers of the current layer inside the view */
const shown = (page: Page) => page.locator('#map-layers .map-layer.cur .pm[data-in="1"]');
const marker = (page: Page, id: string) => page.locator(`#map-layers .map-layer.cur .pm[data-id="${id}"]`);
/** a marker's static hit disc (the survey ring spins, so the group never holds still) */
const pick = (page: Page, id: string) => marker(page, id).locator('.hit').click();
const viewBtn = (page: Page, v: string) => page.locator(`#map-views button[data-view="${v}"]`);

async function openMap(page: Page) {
  await page.keyboard.press('KeyM');
  await expect(mapScreen(page)).toBeVisible();
}
/** wait out any tween or cross-fade */
async function settled(page: Page) {
  await expect(mapScreen(page)).not.toHaveAttribute('data-tween', /./);
  await expect(page.locator('#map-layers .map-layer')).toHaveCount(1);
}

test('[M] opens and closes the map, Esc closes it, and the chip, Lander and close button work', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#map-chip')).toHaveText('◎ MAP [M] · T0 LANDING SITE');
  await openMap(page);
  await expect(mapScreen(page)).toHaveAttribute('data-view', 'site');
  await expect(page.locator('#map-thumb')).toBeVisible();
  await expect(page.locator('#map-thumb .cap')).toHaveText('orbital imagery only — no ground truth');
  await expect(page.locator('#mh-tier')).toHaveText('T0 LANDING SITE');
  await expect(page.locator('#mh-count')).toHaveText('0/34 surveyed');
  await expect(page.locator('.mh-rule')).toHaveText('Look, visit, settle. · ATLAS needs T4 + 12');
  // the SITE view: the Lander, its survey and network rings, a revealed deposit, '?' leads
  const layer = page.locator('#map-layers .map-layer.cur');
  await expect(layer.locator('.mb .bld.lander')).toHaveCount(1);
  await expect(layer.locator('.mb .reveal')).toHaveCount(1);
  await expect(layer.locator('.mb .net')).toHaveCount(1);
  await expect(layer.locator('.mk .ring-l', { hasText: 'survey 120 m' })).toHaveCount(1);
  expect(await layer.locator('.mk .dep-t').count()).toBeGreaterThanOrEqual(1);
  expect(await layer.locator('.mk .leadq').count()).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#map-inset')).toBeHidden();
  await page.screenshot({ path: 'test-results/m3-site-minute0.png' });
  expect((await g(page, 'getLunar')).view).toBe('site');

  await page.keyboard.press('KeyM');
  await expect(mapScreen(page)).toBeHidden();
  // Esc closes the map and goes no further: the menu stays shut
  const menu = page.locator('#menu');
  await openMap(page);
  await page.keyboard.press('Escape');
  await expect(mapScreen(page)).toBeHidden();
  await expect(menu).toBeHidden();
  // with the map shut Esc falls through to the menu, and [M] waits while the menu is up
  await page.keyboard.press('Escape');
  await expect(menu).toBeVisible();
  await page.keyboard.press('KeyM');
  await expect(mapScreen(page)).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(page.locator('#menu-keys')).toContainText('Lunar Map');

  // the Lander inspector's button; Esc closes the map and leaves the inspector open
  await page.evaluate(() => window.__game.select(window.__game.getState().buildings[0].id));
  await expect(page.locator('#inspector')).toBeVisible();
  await page.locator('#insp-map').click();
  await expect(mapScreen(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(mapScreen(page)).toBeHidden();
  await expect(page.locator('#inspector')).toBeVisible();

  await page.locator('#map-chip').click();
  await expect(mapScreen(page)).toBeVisible();
  // the sim keeps running under the map
  const t0 = (await g(page, 'getState')).simTime;
  await g(page, 'setPaused', false);
  await expect.poll(async () => (await g(page, 'getState')).simTime).toBeGreaterThan(t0);
  await page.locator('#map-close').click();
  await expect(mapScreen(page)).toBeHidden();
});

test('at landing only SITE and VICINITY open; VICINITY shows the 2 local prospects', async ({ page }) => {
  await boot(page);
  await openMap(page);
  await expect(viewBtn(page, 'site')).toBeEnabled();
  await expect(viewBtn(page, 'vicinity')).toBeEnabled();
  const locks: Record<string, string> = {
    region: '🔒 T1 Prospecting Drones', near: '🔒 T2 Orbital Prospector',
    far: '🔒 T3 Far-Side Relay', moon: '🔒 T4 Deep Sounding',
  };
  for (const [v, text] of Object.entries(locks)) {
    await expect(viewBtn(page, v)).toBeDisabled();
    await expect(viewBtn(page, v)).toContainText(text);
  }
  await viewBtn(page, 'vicinity').click();
  await expect(mapScreen(page)).toHaveAttribute('data-view', 'vicinity');
  await settled(page);
  await expect(shown(page)).toHaveCount(2);
  await expect(marker(page, 'tranquilityBase')).toHaveAttribute('data-in', '1');
  await expect(marker(page, 'moltke')).toHaveAttribute('data-in', '1');
  expect((await g(page, 'getLunar')).view).toBe('vicinity');
  // outside the local 2° cap the ground is hatched
  await expect(page.locator('#map-layers .map-layer.cur .mb rect[mask]')).toHaveCount(1);
  // the SITE inset stays in every Moon view, and takes you back
  await expect(page.locator('#map-inset')).toBeVisible();
  // "Next surveyable": the site-weakness line, then the two local prospects
  await expect(page.locator('.ns-weak .label')).toHaveText('Outposts cover');
  await expect(page.locator('.ns-weak')).toContainText('water — Ilmenite Plains lacks it: Cabeus or Haworth ice outpost');
  await expect(page.locator('.ns-weak')).not.toContainText('What this site lacks');
  await expect(page.locator('.ns-row:not(.done)')).toHaveCount(2);
  await expect(page.locator('.ns-foot')).toContainText('T1 Prospecting Drones (Era 1) brings 6 more into range');
  // the ladder: T0 is the current tier, the rest are locked
  await expect(page.locator('.tl[data-tier="0"]')).toHaveClass(/cur/);
  await expect(page.locator('.tl[data-tier="2"]')).toHaveClass(/locked/);
  await expect(page.locator('.op-none')).toContainText('T1 Prospecting Drones (Era 1) opens the first slot');
  await page.locator('#map-inset').click();
  await expect(mapScreen(page)).toHaveAttribute('data-view', 'site');
  await expect(page.locator('#mh-atlas')).toHaveText(/ATLAS needs T4 \+ 12/);
  // a locked tier opens the research tree on the tech that reaches it
  await page.locator('.tl[data-tier="1"]').click();
  await expect(mapScreen(page)).toBeHidden();
  await expect(page.locator('#tech-screen')).toBeVisible();
  await expect(page.locator('.tech-card[data-tech="prospectingRovers"]')).toHaveClass(/pulse/);
});

test('each tier widens the map: the chip pulses while it is shut, and the view moves out to the new edge', async ({ page }) => {
  await boot(page);
  await complete(page, ['prospectingRovers']);
  await expect(page.locator('#map-chip')).toHaveClass(/pulse/);
  await expect(page.locator('#map-chip')).toHaveText('◎ MAP EXPANDED — T1 REGIONAL [M]');
  expect((await g(page, 'getLunar')).justExpanded).toBe(true);
  // opening jumps the view to the new edge, tweened outward from where the map was
  await openMap(page);
  await expect(mapScreen(page)).toHaveAttribute('data-view', 'region');
  await expect(mapScreen(page)).toHaveAttribute('data-anim', 'unlock+fade');
  await settled(page);
  await expect(viewBtn(page, 'region')).toBeEnabled();
  await expect(viewBtn(page, 'near')).toBeDisabled();
  await expect(shown(page)).toHaveCount(8);
  const lunar = await g(page, 'getLunar');
  expect(lunar.justExpanded).toBe(false);
  expect(lunar.prospects.filter((p: any) => p.visible)).toHaveLength(8);
  await expect(page.locator('#map-chip')).not.toHaveClass(/pulse/);
  await expect(page.locator('#map-thumb')).toBeVisible();
  await page.screenshot({ path: 'test-results/m3-region-rovers.png' });

  // with the map open, the next tier takes the view out at once (a new projection: cross-fade)
  await complete(page, ['orbitalProspector']);
  await expect(mapScreen(page)).toHaveAttribute('data-view', 'near');
  await expect(mapScreen(page)).toHaveAttribute('data-anim', 'unlock+fade');
  await settled(page);
  await expect(shown(page)).toHaveCount(23);
  await expect(page.locator('#map-thumb')).toBeHidden();
  await expect(page.locator('.tl[data-tier="2"]')).toHaveClass(/cur/);

  // reduced motion: an unlock lands instantly
  await page.keyboard.press('KeyM');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await complete(page, ['farSideRelay']);
  await expect(page.locator('#map-chip')).toHaveText('◎ MAP EXPANDED — T3 FAR SIDE [M]');
  await openMap(page);
  await expect(mapScreen(page)).toHaveAttribute('data-view', 'far');
  await expect(mapScreen(page)).toHaveAttribute('data-anim', 'instant');
  await expect(mapScreen(page)).not.toHaveAttribute('data-tween', /./);
  await expect(page.locator('#map-layers .map-layer')).toHaveCount(1);
  expect((await g(page, 'getLunar')).prospects.filter((p: any) => p.visible)).toHaveLength(30);

  await complete(page, ['deepSounding']);
  await expect(mapScreen(page)).toHaveAttribute('data-view', 'moon');
  await expect(shown(page)).toHaveCount(34);
  await expect(viewBtn(page, 'moon')).toBeEnabled();
});

test('a survey started from the sheet counts down in place and ends surveyed', async ({ page }) => {
  await boot(page);
  await openMap(page);
  await viewBtn(page, 'vicinity').click();
  await settled(page);
  await pick(page, 'moltke');
  await expect(page.locator('.ps-name')).toHaveText('Moltke crater ejecta');
  await expect(page.locator('.ps')).toContainText('a fresh 7 km crater exposing high-Ti basalt');
  await expect(page.locator('.ps')).toContainText('60▮ · flies 1 drone');
  // the local method reads as the drone fleet does (it was 'lander micro-rover' before the drones)
  await expect(page.locator('.ps')).toContainText('Survey — short-range drone');
  await expect(page.locator('.ps')).not.toContainText('micro-rover');
  await expect(page.locator('#ps-survey')).toHaveAttribute('title', 'Send the short-range drone');
  await expect(page.locator('#ps-pay')).toHaveText('+20≡');
  await expect(page.locator('.ps')).toContainText('+0.20◆ +0.08○/s');
  await expect(page.locator('#ps-reason')).toHaveText('✓ Ready to survey');
  await expect(marker(page, 'moltke')).toHaveClass(/sel/);

  await page.locator('#ps-survey').click();
  await expect(page.locator('#ps-clock')).toHaveText('back in 1:00');
  expect((await g(page, 'getLunar')).active).toEqual({ id: 'moltke', remaining: 60 });
  await expect(page.locator('#mh-survey')).toHaveText(' · drones: Moltke 1:00');
  await expect(marker(page, 'moltke')).toHaveClass(/surveying/);
  await expect(marker(page, 'moltke').locator('.spin')).toHaveCount(1);
  // countdowns update in place: the same elements, new text
  const clock = await page.locator('#ps-clock').elementHandle();
  const pm = await marker(page, 'moltke').elementHandle();
  await g(page, 'advanceGameSeconds', 10);
  await expect(page.locator('#ps-clock')).toHaveText('back in 0:50');
  await expect(page.locator('#mh-survey')).toHaveText(' · drones: Moltke 0:50');
  await expect(page.locator('#ps-reason')).toHaveText('◌ Surveying — drone 1 back in 0:50');
  expect(await clock!.evaluate((e) => e.isConnected)).toBe(true);
  expect(await pm!.evaluate((e) => e.isConnected)).toBe(true);

  // the list shows the running survey once; the fleet is one line (the Lander's one drone is out), and a second
  // survey is refused by the sim, which says why
  await page.locator('.ps-back').click();
  await expect(page.locator('.ns-row[data-id="moltke"] .ns-clock')).toHaveText('◌ 0:50');
  await expect(page.locator('.ns-busy')).toHaveText('△ 0/1 drones ready · 1 out: Moltke 0:50');
  await expect(page.locator('.ns-row[data-id="tranquilityBase"] .ns-go')).toHaveClass(/blocked/);
  await page.locator('.ns-row[data-id="tranquilityBase"] .ns-go').click();
  await expect(page.locator('#map-alert')).toContainText('ALL 1 DRONE IS OUT — the next is home in 1:10'); // 0:50 of flight and the drone's 20 s recharge

  // closed, the chip carries the countdown; the survey lands while it is shut
  await page.keyboard.press('KeyM');
  await expect(page.locator('#map-chip')).toHaveText('◎ MAP [M] · T0 LANDING SITE · survey 0:50');
  await g(page, 'advanceGameSeconds', 51);
  await openMap(page);
  await expect(page.locator('#mh-count')).toHaveText('1/34 surveyed');
  await expect(page.locator('#mh-survey')).toHaveText('');
  await expect(marker(page, 'moltke')).toHaveClass(/surveyed/);
  await pick(page, 'moltke');
  await expect(page.locator('.ps')).toContainText('surveyed · +20≡ paid');
  // no slot before T1 (Prospecting Drones, S6): the claim is refused in so many words
  await expect(page.locator('#ps-reason')).toHaveText(/^✗ NO OUTPOST SLOT — .*Prospecting Drones \(Era 1\)/);
});

test('claiming an outpost at T2 shows its card; abandoning takes a second click', async ({ page }) => {
  await boot(page);
  await complete(page, ['prospectingRovers', 'orbitalProspector']);
  await page.evaluate(() => {
    const g = window.__game;
    g.grantResources({ metals: 300, parts: 100, chips: 30, oxygen: 300, water: 100 });
    g.grantPower(500);
    g.surveyProspect('moltke');
    g.advanceGameSeconds(61);
  });
  await openMap(page);
  await expect(mapScreen(page)).toHaveAttribute('data-view', 'near');
  await settled(page);
  await expect(page.locator('#mh-out')).toHaveText('outposts 0/1');
  await expect(page.locator('.op.empty')).toHaveCount(1);
  // surveyed and claimable: a dashed square says an outpost could stand here
  await expect(marker(page, 'moltke')).toHaveClass(/claimable/);
  await expect(marker(page, 'moltke').locator('.frame-q')).toBeVisible();
  await page.locator('.ns-row.done[data-id="moltke"]').click();
  await expect(page.locator('#ps-reason')).toHaveText('✓ Ready to claim');
  await expect(page.locator('.ps-site')).toContainText('ilmenite +0.20◆ +0.08○/s · claim 60◆ 20⚙ 5▣');
  await expect(page.locator('.ps')).toContainText(/Deploys\s*4:00/);

  await page.locator('#ps-claim').click();
  const card = page.locator('.op[data-id="moltke"]');
  await expect(card.locator('.op-1')).toHaveText('Moltke · ilmenite');
  await expect(card.locator('.op-2')).toHaveText('deploying 4:00');
  await expect(page.locator('#mh-out')).toHaveText('outposts 1/1');
  await expect(marker(page, 'moltke')).toHaveClass(/outpost/);
  await expect(marker(page, 'moltke').locator('.frame')).toHaveCount(1);
  // live from the first tick past its 240 s deploy
  await g(page, 'advanceGameSeconds', 241);
  await expect(card.locator('.op-2')).toHaveText('+0.20◆ +0.08○/s');
  await expect(card.locator('.op-3')).toHaveText('fuel — · upkeep ✓');
  await expect(card).toHaveClass(/live/);

  // abandon: the first click arms it, the second frees the slot
  await page.locator('#ps-abandon').click();
  await expect(page.locator('#ps-abandon')).toHaveText('Confirm — no refund');
  expect((await g(page, 'getLunar')).used).toBe(1);
  await page.locator('#ps-abandon').click();
  await expect(page.locator('#mh-out')).toHaveText('outposts 0/1');
  await expect(page.locator('.op.empty')).toHaveCount(1);

  // a hopper outpost on the near side, for the screenshot: stream, fuel and upkeep all ✓
  await page.evaluate(() => {
    const g = window.__game;
    g.forceOutposts(1);
    g.grantResources({ oxygen: 200, water: 50, parts: 20 });
    g.grantPower(500);
    g.surveyProspect('cabeus');
    g.advanceGameSeconds(1);
  });
  await expect(page.locator('.op[data-id]')).toHaveCount(1);
  await expect(marker(page, 'cabeus')).toHaveClass(/surveying/);
  await pick(page, 'cabeus');
  await expect(page.locator('.ps-name')).toHaveText('Cabeus (LCROSS impact)');
  await page.screenshot({ path: 'test-results/m3-near-outposts.png' });
});

for (const vp of [{ width: 1280, height: 720 }, { width: 1600, height: 900 }]) {
  test(`layout ${vp.width}×${vp.height}: header, map, panel and strip fit without overlapping`, async ({ page }) => {
    await boot(page, 'mare', 'robotic', vp);
    // the longest header: every lock showing and a survey running
    await g(page, 'surveyProspect', 'tranquilityBase');
    await g(page, 'advanceGameSeconds', 1);
    await openMap(page);
    await expect(page.locator('#mh-survey')).toContainText('Tranquility Base');
    const boxes = await page.evaluate(() => {
      const r = (s: string) => {
        const b = document.querySelector(s)!.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom };
      };
      const head = document.querySelector('#map-head')!;
      return {
        head: r('#map-head'), main: r('#map-main'), side: r('#map-side'), strip: r('#map-strip'),
        views: r('#map-views'), close: r('#map-close'), title: r('.mh-title'),
        ladder: r('#map-ladder'), outposts: r('#map-outposts'), thumb: r('#map-thumb'),
        headScroll: head.scrollWidth - head.clientWidth,
        docScroll: [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight],
        buttons: [...document.querySelectorAll('#map-views button')].map((b) => b.scrollWidth - b.clientWidth),
      };
    });
    type B = { x: number; y: number; w: number; h: number; r: number; b: number };
    const overlap = (a: B, b: B) => a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5;
    const inside = (a: B, o: B) => a.x >= o.x - 0.5 && a.y >= o.y - 0.5 && a.r <= o.r + 0.5 && a.b <= o.b + 0.5;
    const regions = ['head', 'main', 'side', 'strip'] as const;
    for (const k of regions) {
      expect(inside(boxes[k], { x: 0, y: 0, w: vp.width, h: vp.height, r: vp.width, b: vp.height }), k).toBe(true);
    }
    for (let i = 0; i < regions.length; i++) {
      for (let j = i + 1; j < regions.length; j++) {
        expect(overlap(boxes[regions[i]], boxes[regions[j]]), `${regions[i]}/${regions[j]}`).toBe(false);
      }
    }
    if (vp.width === 1280) {
      // spec §5b: the map is 836×600 at (12, 52), the panel 408 px at x 860
      expect(boxes.main).toMatchObject({ x: 12, y: 52, w: 836, h: 600 });
      expect(boxes.side).toMatchObject({ x: 860, w: 408 });
      expect(boxes.head.h).toBe(40);
      expect(boxes.strip.h).toBe(56);
    }
    expect(overlap(boxes.title, boxes.views)).toBe(false);
    expect(overlap(boxes.views, boxes.close)).toBe(false);
    expect(overlap(boxes.ladder, boxes.outposts)).toBe(false);
    expect(inside(boxes.thumb, boxes.main)).toBe(true);
    expect(boxes.headScroll).toBeLessThanOrEqual(0);
    expect(boxes.docScroll).toEqual([0, 0]);
    expect(boxes.buttons.every((d) => d <= 0)).toBe(true);
    // the Moon views: the inset stays inside the map
    await complete(page, ['prospectingRovers', 'orbitalProspector', 'farSideRelay', 'deepSounding']);
    await expect(mapScreen(page)).toHaveAttribute('data-view', 'moon');
    await settled(page);
    const inset = await page.locator('#map-inset').boundingBox();
    const main = await page.locator('#map-main').boundingBox();
    expect(inset!.x).toBeGreaterThanOrEqual(main!.x);
    expect(inset!.y + inset!.height).toBeLessThanOrEqual(main!.y + main!.height);
    expect(await page.locator('#map-views button:disabled').count()).toBe(0);
  });
}

test("the tree's Map button opens the map; M and T swap the two screens", async ({ page }) => {
  await boot(page);
  await page.keyboard.press('KeyT');
  await expect(page.locator('#tech-screen')).toBeVisible();
  await page.locator('#tech-map').click();
  await expect(mapScreen(page)).toBeVisible();
  await expect(page.locator('#tech-screen')).toBeHidden();
  // T from the map: the tree takes its place
  await page.keyboard.press('KeyT');
  await expect(page.locator('#tech-screen')).toBeVisible();
  await expect(mapScreen(page)).toBeHidden();
  // M from the tree: the map takes its place
  await page.keyboard.press('KeyM');
  await expect(mapScreen(page)).toBeVisible();
  await expect(page.locator('#tech-screen')).toBeHidden();
});

test('the whole Moon at T4: both hemispheres, every prospect, outposts and the atlas cell', async ({ page }) => {
  await boot(page);
  await complete(page, ['prospectingRovers', 'orbitalProspector', 'farSideRelay', 'deepSounding']);
  await page.evaluate(() => {
    const g = window.__game;
    g.forceOutposts(3);
    g.revealAll();
    g.grantResources({ oxygen: 400, water: 100, parts: 50 });
    g.grantPower(500);
    g.surveyProspect('daedalus');
    g.advanceGameSeconds(1);
  });
  await openMap(page);
  await expect(mapScreen(page)).toHaveAttribute('data-view', 'moon');
  await settled(page);
  await expect(shown(page)).toHaveCount(34);
  await expect(page.locator('#map-layers .map-layer.cur .mb .disc')).toHaveCount(2);
  // at T3+ nothing is hatched
  await expect(page.locator('#map-layers .map-layer.cur .mb rect[mask]')).toHaveCount(0);
  await expect(page.locator('.op[data-id]')).toHaveCount(3);
  await expect(page.locator('.tl.atlas .tl-3')).toHaveText('3/12');
  await expect(marker(page, 'daedalus')).toHaveClass(/surveying/);
  await expect(page.locator('#mh-out')).toHaveText('outposts 3/3');
  await page.screenshot({ path: 'test-results/m3-moon-t4.png' });
});


// ── docs/19 S8: outposts made legible ──

const chipsOf = (page: Page, key: string) => page.locator(`#resource-strip .chip[data-key="${key}"]`).first();
/** two real claims, the way a player gets them: Tranquillitatis soil (volatiles, a rover haul) and Fra Mauro (KREEP, a
 *  hopper that burns 0.02○/s). Nothing else streams oxygen, so with none left the hopper is grounded. */
async function claimHopperPair(page: Page) {
  await complete(page, ['prospectingRovers', 'orbitalProspector', 'farSideRelay']); // T3: two slots
  await page.evaluate(() => {
    const g = window.__game;
    g.grantResources({ metals: 400, parts: 100, chips: 40, oxygen: 300, water: 100 });
    g.grantPower(800);
    g.surveyProspect('tranqRegolith');
    g.advanceGameSeconds(105); // 80 s of flight and the drone's 20 s recharge
    g.surveyProspect('fraMauro');
    g.advanceGameSeconds(190);
    g.claimOutpost('tranqRegolith');
    g.claimOutpost('fraMauro');
    g.advanceGameSeconds(365);
  });
}
const alertOf = (page: Page, re: RegExp) =>
  page.evaluate((src) => window.__game.getState().alerts.find((a: any) => new RegExp(src).test(a.text)) ?? null, re.source);

test('the OUTPOSTS chip: hidden with no slot, a free slot, then how many live, worn or grounded, and it opens the strip', async ({ page }) => {
  await boot(page);
  const chip = page.locator('#outposts-chip');
  await expect(chip).toBeHidden(); // T0: no slot and no outpost, nothing to count
  await complete(page, ['prospectingRovers']); // T1 opens the first slot
  await expect(chip).toHaveText('▢ OUTPOSTS 1 slot free');
  await expect(chip).not.toHaveClass(/fault/);
  // six standing outposts: five rover hauls and Fra Mauro's KREEP hopper, all live
  await g(page, 'forceOutposts', 6);
  await expect(chip).toHaveText('▢ OUTPOSTS 6 live');
  await expect(chip).toHaveAttribute('title', /^Outposts 6\/1 · 6 live/);
  // no parts for their upkeep: each one is worn (its stream halves), and the chip says so
  await g(page, 'grantResources', { parts: -(await g(page, 'getState')).resources.parts });
  await g(page, 'advanceGameSeconds', 2);
  await expect(chip).toHaveText('▢ OUTPOSTS 6 worn');
  await expect(chip).toHaveClass(/fault/);
  expect((await g(page, 'getLunar')).outposts.every((o: any) => o.state === 'worn')).toBe(true);
  // parts back: all live again
  await g(page, 'grantResources', { parts: 60 });
  await g(page, 'advanceGameSeconds', 2);
  await expect(chip).toHaveText('▢ OUTPOSTS 6 live');
  await expect(chip).not.toHaveClass(/fault/);

  // it opens the map with the outposts strip outlined for a moment
  await chip.click();
  await expect(mapScreen(page)).toBeVisible();
  await expect(mapScreen(page)).toHaveAttribute('data-focus', 'outposts');
  await expect(page.locator('#map-outposts')).toHaveClass(/hl/);
  await expect(page.locator('.op[data-id]')).toHaveCount(6);
  // closing the map ends the outline
  await page.keyboard.press('Escape');
  await expect(mapScreen(page)).toBeHidden();
  await expect(page.locator('#map-outposts')).not.toHaveClass(/hl/);
  await expect(mapScreen(page)).not.toHaveAttribute('data-focus', /./);
});

test('resource panels list outposts under Produced by and Consumed by, and a row opens the map at it', async ({ page }) => {
  await boot(page);
  await g(page, 'forceOutposts', 6);
  await g(page, 'advanceGameSeconds', 2);
  const panel = page.locator('#res-panel');
  const row = (text: string) => panel.locator('.row', { hasText: text });
  // metals: Moltke and Maskelyne ilmenite, 0.20◆/s = 12/min each
  await chipsOf(page, 'metals').click();
  await expect(panel).toBeVisible();
  await expect(row('Moltke · ilmenite outpost')).toContainText('+12/min · live');
  await expect(row('Maskelyne · ilmenite outpost')).toContainText('+12/min · live');
  await expect(panel).not.toContainText('Nothing on the Moon makes this yet');
  // oxygen: their 0.08○/s = 4.8/min each; Fra Mauro's hopper burns 0.02○/s = 1.2/min
  await chipsOf(page, 'oxygen').click();
  await expect(row('Moltke · ilmenite outpost')).toContainText('+4.8/min · live');
  await expect(row('Outposts ×1 · hopper fuel')).toContainText('−1.2/min');
  // water: Tranquillitatis soil (volatiles) 0.08≈/s, and the dry site's note (mare has no polar ice)
  await chipsOf(page, 'water').click();
  await expect(row('Tranquillitatis soil · volatiles outpost')).toContainText('+4.8/min · live');
  await expect(panel).toContainText('No polar ice at this site: a Water Management Plant digs mature soil instead — 20% of the ice recipe’s water at ×1.5 the power');
  // parts: every live outpost pays upkeep (5 × 2⚙/day + 1 × 3⚙/day), and a live KREEP outpost cuts reactor upkeep
  await chipsOf(page, 'parts').click();
  await expect(row('Outposts ×6 · upkeep')).toContainText('−13/day');
  await expect(row('KREEP outpost · every reactor’s upkeep')).toContainText('×0.6');
  // a state shows in the row: no parts, so the stream is halved
  await g(page, 'grantResources', { parts: -(await g(page, 'getState')).resources.parts });
  await g(page, 'advanceGameSeconds', 2);
  await chipsOf(page, 'metals').click();
  await expect(row('Moltke · ilmenite outpost')).toContainText('+6/min · worn — parts short, stream ×0.5');
  // a row opens the Lunar Map at that outpost's sheet
  await row('Moltke · ilmenite outpost').click();
  await expect(mapScreen(page)).toBeVisible();
  await expect(page.locator('.ps-name')).toHaveText('Moltke crater ejecta');
});

test('the power and chips panels list a KREEP outpost, and the ≡ panel its sources: surveys, observatory, flares, radio outposts', async ({ page }) => {
  await boot(page);
  await g(page, 'forceOutposts', 6);
  await g(page, 'advanceGameSeconds', 2);
  const panel = page.locator('#res-panel');
  await chipsOf(page, 'power').click();
  await expect(panel.locator('.row', { hasText: 'Fra Mauro · KREEP outpost' })).toContainText('reactors ×1.15 · live');
  await expect(panel.locator('.row', { hasText: 'Outposts ×6 · Lander links' })).toContainText('−6.5 kW'); // 5 × 1 + 1.5
  await chipsOf(page, 'data').click();
  await expect(panel.locator('.row', { hasText: 'Solar Observatory' })).toBeVisible();
  await expect(panel.locator('.row', { hasText: 'Solar flares' })).toContainText('+15 · +30 · +60 (C · M · X) each, with a lab running');
  await expect(panel.locator('.row', { hasText: 'Map surveys' })).toContainText('+20–100 each · 6/34 surveyed');
  await expect(panel.locator('.row', { hasText: 'Deposit surveys' })).toContainText('+5 each');
  // no radio outpost yet: the panel says which kind makes data, and where
  await expect(panel).toContainText('Outposts: survey a radio site on the Lunar Map [M], then claim it');
});

test('the prospect sheet states the outpost site in the field report’s own words', async ({ page }) => {
  await boot(page);
  await complete(page, ['prospectingRovers']);
  await page.evaluate(() => {
    const g = window.__game;
    g.grantResources({ metals: 300, parts: 100, chips: 30, oxygen: 300, water: 100 });
    g.grantPower(500);
    g.surveyProspect('moltke');
    g.advanceGameSeconds(61);
  });
  // the report: one OUTPOST SITE line, with a Claim button that opens the map
  const report = await page.evaluate(() => {
    const e = window.__game.getState().log.filter((l: any) => l.report).pop();
    return e.report.rewards.find((r: any) => r.tag === 'OUTPOST SITE');
  });
  expect(report.text).toBe('ilmenite +0.20◆ +0.08○/s · claim 60◆ 20⚙ 5▣');
  expect(report.button).toEqual({ label: 'Claim', action: { map: 'moltke' } });
  await openMap(page);
  await settled(page);
  await page.locator('.ns-row.done[data-id="moltke"]').click();
  await expect(page.locator('.ps-site .ps-tag')).toHaveText('OUTPOST SITE');
  await expect(page.locator('.ps-site')).toContainText(report.text); // the same words, from one function
  await expect(page.locator('.ps')).toContainText(/Deploys\s*4:00/);
  await expect(page.locator('.ps')).toContainText(/Upkeep\s*2⚙\/day/);
});

test('"Outposts cover" names what the site lacks and what the standing outposts stream now', async ({ page }) => {
  await boot(page);
  await openMap(page);
  await viewBtn(page, 'vicinity').click();
  await settled(page);
  await expect(page.locator('.ns-weak .label')).toHaveText('Outposts cover');
  await expect(page.locator('.ns-live')).toBeHidden(); // nothing stands yet
  await g(page, 'forceOutposts', 3); // Moltke and Maskelyne (ilmenite), Tranquillitatis soil (volatiles)
  await expect(page.locator('.ns-live')).toHaveText('live now: metals +0.40◆/s · oxygen +0.16○/s · water +0.08≈/s');
});

test('"Outposts cover" at the lava tube names power and the KREEP outposts', async ({ page }) => {
  await boot(page, 'lavatube');
  await openMap(page);
  await viewBtn(page, 'vicinity').click();
  await settled(page);
  await expect(page.locator('.ns-weak')).toContainText('power — Marius Hills lacks it: Marius Hills domes or Mons Rümker KREEP outpost');
});

test('outpost alerts are field alerts that open the map at the outpost, and a hopper with no fuel is grounded on the chip', async ({ page }) => {
  await boot(page);
  await claimHopperPair(page);
  const chip = page.locator('#outposts-chip');
  await expect(chip).toHaveText('▢ OUTPOSTS 2 live');
  // no oxygen: the hopper cannot fly, the rover-haul outpost still streams
  await g(page, 'grantResources', { oxygen: -(await g(page, 'getState')).resources.oxygen });
  await g(page, 'advanceGameSeconds', 2);
  await expect(chip).toHaveText('▢ OUTPOSTS 1 live · 1 grounded');
  await expect(chip).toHaveClass(/fault/);
  const grounded = await alertOf(page, /^HOPPER GROUNDED — Fra Mauro/);
  expect(grounded).toMatchObject({ family: 'field', action: { map: 'fraMauro' }, kind: 'warn' });
  // no parts: worn (a grounded outpost stays grounded)
  await g(page, 'grantResources', { parts: -(await g(page, 'getState')).resources.parts });
  await g(page, 'advanceGameSeconds', 2);
  await expect(chip).toHaveText('▢ OUTPOSTS 1 worn · 1 grounded');
  const worn = await alertOf(page, /^OUTPOST WORN — Tranquillitatis soil/);
  expect(worn).toMatchObject({ family: 'field', action: { map: 'tranqRegolith' }, kind: 'warn' });
  // the stack line carries the field glyph and opens the map at that outpost
  const line = page.locator('#alerts .alert', { hasText: 'OUTPOST WORN — Tranquillitatis soil' });
  await expect(line).toHaveClass(/nf-field/);
  await expect(line.locator('.alert-g')).toHaveText('◎');
  await line.locator('.alert-text').click();
  await expect(mapScreen(page)).toBeVisible();
  await expect(page.locator('.ps-name')).toHaveText('Central Tranquillitatis mature soil');
  // the strip's grounded card says what is wrong
  await expect(page.locator('.op[data-id="fraMauro"] .op-3')).toHaveText('fuel ✗ · upkeep ✗');
  await expect(page.locator('.op[data-id="fraMauro"]')).toHaveClass(/fault/);
});

// ───────────────────────────── docs/20 S5: the crowded Moon ─────────────────────────────
// A faction game has two rival programs on the same Moon: their homes, reach and outposts are on the map, a prospect one
// holds is refused with CLAIMED BY, the field reports say who is nearby, a claim near home is news, and the faction
// flavour (the Commons' cheaper outposts, the Vanguard's survey data, the Foundry's drones) rides on the landing techs.
// Played here as the Commons on the lava tube: the Foundry is on Ilmenite Plains, the Vanguard on the pole. Marius domes
// (KREEP, 1.7° from home) is the contested prospect. The rival's side goes through the W0i test hooks; the claim's
// feed event is pushed by the spec only when the rival runner has not written one.

type Faction = 'robots' | 'accelerationists' | 'solarpunks';
/** the text-presentation selector the map appends to a faction's glyph (⚙ and ❀ must never turn into colour emoji) */
const TX = '\uFE0E';

/** a faction game on the debug API, paused; the page errors are collected */
async function bootFaction(page: Page, faction: Faction, site: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?debug&seed=42');
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(([f, s]) => {
    const G = window.__game;
    G.selectFaction(f, s);
    G.setPaused(true);
    G.advanceGameSeconds(0);
  }, [faction, site] as const);
  return errors;
}

/** The Foundry reaches the near side (Orbital Prospector), is given what a survey costs, and sends its drone to `pid`. */
const foundrySurveys = (page: Page, pid: string) => page.evaluate((id) => {
  const G = window.__game;
  for (const t of ['prospectingRovers', 'orbitalProspector']) G.rivalCompleteTech('robots', t);
  G.rivalGrant('robots', { metals: 500, parts: 200, chips: 50, oxygen: 400, water: 200 });
  G.rivalApply('robots', { kind: 'surveyProspect', id });
  G.advanceGameSeconds(1);
}, pid);

/** The Foundry claims what it has surveyed, and the Moon's feed says so (the spec writes the event if the rival runner did not). */
const foundryClaims = (page: Page, pid: string) => page.evaluate((id) => {
  const G = window.__game;
  G.rivalApply('robots', { kind: 'claimOutpost', id });
  if (!G.getMoon().feed?.some((e: any) => e.kind === 'claim' && e.prospect === id)) {
    G.feedPush({ faction: 'robots', kind: 'claim', text: `THE FOUNDRY CLAIMS ${id.toUpperCase()}`, prospect: id });
  }
  G.advanceGameSeconds(2);
}, pid);

/** the Commons' own map tiers: T1 (a slot), T2 (the near side), T3 (the far side), T4 */
const tiers = (page: Page, n: number) => complete(page, ['prospectingRovers', 'orbitalProspector', 'farSideRelay', 'deepSounding'].slice(0, n));
const fieldAlerts = (page: Page, re: RegExp) =>
  page.evaluate((src) => window.__game.getState().alerts.filter((a: any) => a.family === 'field' && new RegExp(src).test(a.text)), re.source);
/** the rival marks of the current layer (a mark outside the view window is built but hidden: not counted) */
const rivalMarks = (page: Page) => page.locator('#map-layers .map-layer.cur').evaluate((l) => ({
  homes: [...l.querySelectorAll<SVGElement>('.home.rhome')].filter((e) => e.style.display !== 'none').length,
  reach: l.querySelectorAll('.rcov').length,
  frames: l.querySelectorAll('.pm.rival .rframe').length, spins: l.querySelectorAll('.pm .rspin').length,
}));

test('solo: the map carries no rival marks in any view, and no rival line', async ({ page }) => {
  await boot(page, 'lavatube', 'human');
  await tiers(page, 4);
  expect((await g(page, 'getLunar')).rivals).toEqual([]);
  expect(await g(page, 'getRivals')).toEqual([]);
  await openMap(page);
  for (const view of ['site', 'vicinity', 'region', 'near', 'far', 'moon']) {
    await g(page, 'setMapView', view);
    await expect(mapScreen(page)).toHaveAttribute('data-view', view);
    await settled(page);
    expect(await rivalMarks(page), view).toEqual({ homes: 0, reach: 0, frames: 0, spins: 0 });
  }
  await expect(page.locator('#mh-rivals')).toHaveText('');
  await expect(page.locator('#map-legend')).not.toContainText('rival');
  const lv = await g(page, 'getLunar');
  expect(lv.prospects.every((p: any) => p.rival === null)).toBe(true);
});

test('a faction game: each landed rival has a home marker and its reach on the near views, none on the SITE map', async ({ page }) => {
  const errors = await bootFaction(page, 'solarpunks', 'lavatube');
  await tiers(page, 4);
  const lv = await g(page, 'getLunar');
  expect(lv.rivals.map((r: any) => [r.faction, r.siteId, r.landed])).toEqual([['robots', 'mare', true], ['accelerationists', 'southpole', true]]);
  await openMap(page);
  // SITE: a rival lives on another ground altogether
  await g(page, 'setMapView', 'site');
  await expect(mapScreen(page)).toHaveAttribute('data-view', 'site');
  await settled(page);
  expect(await rivalMarks(page)).toEqual({ homes: 0, reach: 0, frames: 0, spins: 0 });
  // the globe views: the landed rivals' homes and reach, each with its own class and its livery's colour. Near and MOON see both
  // (the pole rides the limb); the far side sees the pole's reach and home only, the Foundry's 27° stays on the near side.
  for (const [view, homes, reach] of [['near', 2, 2], ['far', 1, 1], ['moon', 2, 2]] as const) {
    await g(page, 'setMapView', view);
    await expect(mapScreen(page)).toHaveAttribute('data-view', view);
    await settled(page);
    const layer = page.locator('#map-layers .map-layer.cur');
    expect(await rivalMarks(page), view).toMatchObject({ homes, reach });
    await expect(layer.locator('.rcov.k-rival-accelerationists .rcov-fill')).toHaveCount(1);
    await expect(layer.locator('.rcov.k-rival-accelerationists .rcov-edge')).toHaveCount(1);
    if (view !== 'far') {
      await expect(layer.locator('.rcov.k-rival-robots .rcov-edge')).toHaveCount(1);
      expect(await layer.locator('.rhome.k-rival-robots').evaluate((e) => e.getAttribute('style'))).toContain('#e8632b');
    }
  }
  await g(page, 'setMapView', 'near');
  await settled(page);
  const foundry = page.locator('#map-layers .map-layer.cur .home.rhome.k-rival-robots');
  await expect(foundry).toHaveCount(1);
  await expect(foundry.locator('.rg')).toHaveText(`⚙${TX}`);
  await expect(foundry.locator('.lbl')).toHaveText('FOUNDRY · ILMENITE PLAINS');
  await expect(page.locator('#map-layers .map-layer.cur .home.rhome.k-rival-accelerationists .rg')).toHaveText(`▲${TX}`);
  // the home pin is still the player's own, once
  await expect(page.locator('#map-layers .map-layer.cur .home:not(.rhome)')).toHaveCount(1);
  await expect(page.locator('#map-legend')).toContainText('rival outpost');
  // the regional views: a rival's reach is drawn where it could fall, with no home in sight
  for (const view of ['vicinity', 'region']) {
    await g(page, 'setMapView', view);
    await settled(page);
    expect((await rivalMarks(page)).homes, view).toBe(0);
  }
  expect(errors).toEqual([]);
});

test('a prospect a rival is surveying spins in its colour; once claimed it is a filled frame with its glyph, and the header counts it', async ({ page }) => {
  const errors = await bootFaction(page, 'solarpunks', 'lavatube');
  await tiers(page, 2);
  await foundrySurveys(page, 'mariusDomes');
  expect((await g(page, 'getLunar')).rivals[0].surveying).toEqual(['mariusDomes']);
  await openMap(page);
  await g(page, 'setMapView', 'near');
  await settled(page);
  const dome = marker(page, 'mariusDomes');
  await expect(dome).toHaveClass(/rsurvey/);
  await expect(dome).toHaveClass(/k-rsurvey-robots/);
  await expect(dome.locator('.rspin')).toHaveCount(1);
  expect(await dome.locator('.rspin').evaluate((e) => e.getAttribute('style'))).toContain('#e8632b');
  await expect(dome.locator('.rframe')).toHaveCount(0); // not claimed yet
  await expect(page.locator('#mh-rivals')).toHaveText(` · rivals ⚙${TX} Foundry 0 · ▲${TX} Vanguard 0`);

  // the drone comes home, the Foundry claims: a filled frame in its colour with its glyph on a badge
  await g(page, 'advanceGameSeconds', 200);
  await foundryClaims(page, 'mariusDomes');
  await expect(dome).toHaveClass(/k-rival-robots/);
  await expect(dome.locator('.rframe')).toHaveCount(1);
  await expect(dome.locator('.rbadge text')).toHaveText(`⚙${TX}`);
  await expect(dome.locator('.rspin')).toHaveCount(0);
  await expect(dome.locator('.frame')).toHaveCount(0); // the hollow frame is ours
  expect(await dome.evaluate((e) => getComputedStyle(e.querySelector('.rframe')!).fill)).toBe('rgb(232, 99, 43)');
  await expect(dome.locator('title')).toContainText('rival outpost — The Foundry');
  await expect(page.locator('#mh-rivals')).toHaveText(` · rivals ⚙${TX} Foundry 1 · ▲${TX} Vanguard 0`);
  await expect(page.locator('#mh-out')).toHaveText('outposts 0/1'); // our own slots, as ever
  // the list row wears the holder's badge too
  await expect(page.locator('.ns-row[data-id="mariusDomes"] .ns-rv')).toHaveText(`⚙${TX}`);
  expect(await rivalMarks(page)).toMatchObject({ frames: 1, spins: 0 });
  expect(errors).toEqual([]);
});

test('the sheet of a rival outpost says whose it is, offers no Claim, and our claim is refused with CLAIMED BY', async ({ page }) => {
  await bootFaction(page, 'solarpunks', 'lavatube');
  await tiers(page, 2);
  await foundrySurveys(page, 'mariusDomes');
  await g(page, 'advanceGameSeconds', 200);
  await foundryClaims(page, 'mariusDomes');
  // the view names the holder; an unsurveyed prospect of theirs is still ours to survey
  const dome = (await g(page, 'getLunar')).prospects.find((p: any) => p.id === 'mariusDomes');
  expect(dome.rival).toEqual({ faction: 'robots', name: 'The Foundry' });
  expect(dome.claimable).toBe(false);
  await openMap(page);
  await g(page, 'setMapView', 'near');
  await settled(page);
  await pick(page, 'mariusDomes');
  await expect(page.locator('.ps-name')).toHaveText('Marius Hills domes');
  await expect(page.locator('.ps-rival')).toContainText('▢ rival outpost — The Foundry');
  await expect(page.locator('.ps-rival')).toHaveClass(/k-rival-robots/);
  await expect(page.locator('#ps-claim')).toHaveCount(0);
  await expect(page.locator('#ps-survey')).toHaveCount(1); // their outpost does not close the survey
  await expect(page.locator('#ps-survey')).not.toHaveClass(/blocked/);
  await expect(page.locator('.ps')).not.toContainText('OUTPOST SITE');
  // we survey it (local: 1.7°), and the sheet gives the refusal
  await g(page, 'grantPower', 300);
  await page.locator('#ps-survey').click();
  await g(page, 'advanceGameSeconds', 70);
  await expect(page.locator('#ps-claim')).toHaveCount(0);
  await expect(page.locator('#ps-reason')).toHaveText('✗ CLAIMED BY THE FOUNDRY — its outpost stands there');
  await expect(page.locator('.ps-rival')).toContainText('▢ rival outpost — The Foundry');
  await page.screenshot({ path: 'test-results/m3-rival-sheet.png' });
  // our own claim goes through the sim and is refused in its words (the slot and the resources are there)
  await g(page, 'grantResources', { metals: 300, parts: 100, chips: 30 });
  await g(page, 'claimOutpost', 'mariusDomes');
  await g(page, 'advanceGameSeconds', 1);
  const refusal = await alertOf(page, /^CLAIMED BY/);
  expect(refusal?.text).toBe('CLAIMED BY THE FOUNDRY — its outpost stands there');
  expect((await g(page, 'getState')).survey.outposts).toEqual([]);
  expect((await g(page, 'getMoon')).claims.mariusDomes).toBe('robots');
  // the list says so too
  await page.locator('.ps-back').click();
  await expect(page.locator('.ns-row.done[data-id="mariusDomes"] .ns-st')).toHaveText('▢ rival outpost — The Foundry');
});

test('a field report names a rival outpost within 27° of what was surveyed, and a rival-held prospect says so instead of offering the claim', async ({ page }) => {
  await bootFaction(page, 'solarpunks', 'lavatube');
  await tiers(page, 2);
  await foundrySurveys(page, 'mariusDomes');
  await g(page, 'advanceGameSeconds', 200);
  await foundryClaims(page, 'mariusDomes');
  await page.evaluate(() => {
    const G = window.__game;
    G.grantResources({ oxygen: 300, water: 100, parts: 50 });
    G.grantPower(600);
    G.surveyProspect('reinerGamma'); // 6.9° from home, 6.5° from the Foundry's outpost
  });
  await g(page, 'advanceGameSeconds', 80);
  const report = async (title: string) => (await page.evaluate((t) =>
    window.__game.getState().alerts.filter((a: any) => a.report && a.report.title === t).pop()?.report ?? null, title));
  const near = await report('Reiner Gamma swirl');
  const rival = near.rewards.find((r: any) => r.tag === 'RIVAL');
  expect(rival.text).toMatch(/^The Foundry holds Marius domes, \d\.\d° away$/);
  expect(rival.text).toBe('The Foundry holds Marius domes, 6.5° away');
  expect(rival.button).toEqual({ label: 'On the map', action: { map: 'mariusDomes' } });
  // now the contested prospect itself: no claim line, only the holder's
  await g(page, 'surveyProspect', 'mariusDomes');
  await g(page, 'advanceGameSeconds', 70);
  const held = await report('Marius Hills domes');
  expect(held.rewards.map((r: any) => r.tag)).not.toContain('OUTPOST SITE');
  expect(held.rewards.find((r: any) => r.tag === 'RIVAL')).toEqual({
    tag: 'RIVAL', text: 'The Foundry holds Marius domes — its outpost stands here; there is nothing to claim',
    button: { label: 'Open the map', action: { map: 'mariusDomes' } },
  });
  // a survey far from every rival outpost carries no RIVAL line (the pole's Shackleton floor is 120° from the dome)
});

test('a rival claim within 27° of home is a field notification that opens the map; one farther off is not', async ({ page }) => {
  await bootFaction(page, 'solarpunks', 'lavatube');
  // the Foundry claims Moltke, beside its own home: 80° from the lava tube
  await page.evaluate(() => {
    const G = window.__game;
    G.feedPush({ faction: 'robots', kind: 'claim', text: 'THE FOUNDRY CLAIMS MOLTKE — ilmenite outpost', prospect: 'moltke' });
    G.advanceGameSeconds(2);
  });
  expect(await fieldAlerts(page, /CLAIMS/)).toEqual([]);
  // then Marius domes, 1.7° from home
  await page.evaluate(() => {
    const G = window.__game;
    G.feedPush({ faction: 'robots', kind: 'claim', text: 'THE FOUNDRY CLAIMS MARIUS DOMES — KREEP outpost', prospect: 'mariusDomes' });
    G.advanceGameSeconds(2);
  });
  const n = await fieldAlerts(page, /CLAIMS/);
  expect(n).toHaveLength(1);
  expect(n[0]).toMatchObject({
    text: 'THE FOUNDRY CLAIMS MARIUS DOMES — KREEP outpost, 1.7° from your landing site', family: 'field', action: { map: 'mariusDomes' },
  });
  // Mons Rümker (26.7°) is inside the regional radius, the Vanguard's claim is news too; Copernicus (36°) is not
  await page.evaluate(() => {
    const G = window.__game;
    G.feedPush({ faction: 'accelerationists', kind: 'claim', text: 'THE VANGUARD CLAIMS MONS RÜMKER', prospect: 'monsRumker' });
    G.feedPush({ faction: 'accelerationists', kind: 'claim', text: 'THE VANGUARD CLAIMS COPERNICUS', prospect: 'copernicus' });
    G.advanceGameSeconds(2);
  });
  const all = (await fieldAlerts(page, /CLAIMS/)).map((a: any) => a.text);
  expect(all).toEqual([
    'THE FOUNDRY CLAIMS MARIUS DOMES — KREEP outpost, 1.7° from your landing site',
    'THE VANGUARD CLAIMS MONS RÜMKER — KREEP outpost, 26.7° from your landing site',
  ]);
  // it is in the stack with the field glyph, and opens the map at the prospect
  const line = page.locator('#alerts .alert', { hasText: 'THE FOUNDRY CLAIMS MARIUS DOMES' });
  await expect(line).toHaveClass(/nf-field/);
  await expect(line.locator('.alert-g')).toHaveText('◎');
  await line.locator('.alert-text').click();
  await expect(mapScreen(page)).toBeVisible();
  await expect(page.locator('.ps-name')).toHaveText('Marius Hills domes');
});

test('exploration flavour: the Commons claim for metals ×0.85, the Vanguard\'s surveys pay ×1.2 data, the Foundry\'s drones fly ×1.15; solo is unchanged', async ({ page }) => {
  // the Commons: a regional-or-local claim costs 51 metals, not 60 (parts and chips as ever)
  await bootFaction(page, 'solarpunks', 'lavatube');
  expect((await g(page, 'getMods')).outpostCostMult).toBeCloseTo(0.85, 6);
  await complete(page, ['prospectingRovers']);
  await page.evaluate(() => {
    const G = window.__game;
    G.grantResources({ parts: 100, chips: 30 });
    G.grantPower(300);
    G.surveyProspect('mariusDomes');
    G.advanceGameSeconds(70);
  });
  const dome = (await g(page, 'getLunar')).prospects.find((p: any) => p.id === 'mariusDomes');
  expect(dome.surveyed).toBe(true);
  expect(dome.claim.cost).toEqual({ metals: 51, parts: 20, chips: 5 });
  expect(dome.claim.line).toContain('claim 51◆ 20⚙ 5▣');
  const setMetals = (n: number) => page.evaluate((target) => {
    const G = window.__game;
    G.grantResources({ metals: target - G.getState().resources.metals });
  }, n);
  await setMetals(50);
  await g(page, 'claimOutpost', 'mariusDomes');
  await g(page, 'advanceGameSeconds', 1);
  expect((await alertOf(page, /^CLAIM NEEDS/))?.text).toMatch(/^CLAIM NEEDS 51◆ — have 50/);
  await setMetals(51);
  await g(page, 'claimOutpost', 'mariusDomes');
  await g(page, 'advanceGameSeconds', 1);
  expect((await g(page, 'getState')).survey.outposts.map((o: any) => o.id)).toEqual(['mariusDomes']);
  expect((await g(page, 'getState')).resources.metals).toBeLessThan(1);
  expect((await g(page, 'getMoon')).claims.mariusDomes).toBe('solarpunks');

  // solo, same ground: 60
  await boot(page, 'lavatube', 'human');
  expect((await g(page, 'getMods')).outpostCostMult).toBe(1);
  await complete(page, ['prospectingRovers']);
  await page.evaluate(() => {
    const G = window.__game;
    G.grantResources({ parts: 100, chips: 30 });
    G.grantPower(300);
    G.surveyProspect('mariusDomes');
    G.advanceGameSeconds(70);
  });
  const solo = (await g(page, 'getLunar')).prospects.find((p: any) => p.id === 'mariusDomes');
  expect(solo.claim.cost).toEqual({ metals: 60, parts: 20, chips: 5 });
  expect(solo.claim.line).toContain('claim 60◆ 20⚙ 5▣');

  // the Vanguard: the first local survey pays 20 × 1.2; the Foundry's drones: a 60 s flight takes 52
  await bootFaction(page, 'accelerationists', 'southpole');
  expect((await g(page, 'getMods')).surveyDataMult).toBeCloseTo(1.2, 6);
  const floor = (await g(page, 'getLunar')).prospects.find((p: any) => p.id === 'shackletonFloor');
  expect(floor.data).toBe(24);
  expect(floor.survey.timeS).toBe(60);
  await bootFaction(page, 'robots', 'mare');
  expect((await g(page, 'getMods')).droneRange).toBeCloseTo(1.15, 6);
  const base = (await g(page, 'getLunar')).prospects.find((p: any) => p.id === 'tranquilityBase');
  expect(base.survey.timeS).toBe(52);
  await boot(page, 'mare', 'robotic');
  expect((await g(page, 'getMods')).surveyDataMult).toBe(1);
  expect(((await g(page, 'getLunar')).prospects.find((p: any) => p.id === 'tranquilityBase')).survey.timeS).toBe(60);
  expect(((await g(page, 'getLunar')).prospects.find((p: any) => p.id === 'moltke')).data).toBe(20);
});
