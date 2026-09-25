/** HUD rules under stress: on foot the command HUD stays down and no command
 *  screen opens; the Overclock and Downlink verbs have their controls; the
 *  victory and defeat overlays sit over every screen with the keys dead
 *  beneath; the objectives and a resource panel never cover each other; the
 *  inspector's buttons stay above the fold on a laptop; Enter queues in a
 *  tree opened from its chip; held keys toggle once; nothing throws before
 *  a world exists; the menu keeps focus, the pre-menu pause and its quiet;
 *  and the numbers shown follow the live mods. */
import { test, expect as baseExpect, type Page } from '@playwright/test';

// UI actions reach the sim on the next rendered frame; under software GL on a
// loaded machine a frame can take seconds, so assertions get a wider window
const expect = baseExpect.configure({ timeout: 20_000 });

declare global {
  interface Window { __game?: any }
}

const BASE = '/?debug&seed=42&nolock&lowfx';

async function boot(page: Page, exp: 'human' | 'robotic' = 'robotic', site = 'mare') {
  await page.goto(`${BASE}&site=${site}${exp === 'robotic' ? '&exp=robotic' : ''}`);
  await page.waitForFunction(() => window.__game !== undefined);
}

const g = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => window.__game[f as string](...(a as unknown[])), [fn, args] as const);

/** let `n` frames render (the action queue drains per frame) */
const frames = (page: Page, n = 3) => page.evaluate((k) => new Promise<void>((done) => {
  let left = k;
  const step = () => (--left <= 0 ? done() : requestAnimationFrame(step));
  requestAnimationFrame(step);
}), n);

const state = (page: Page) => g(page, 'getState');

/** the HUD's clock format (core/daynight fmtClock) */
const clock = (sec: number) => {
  const t = Math.max(0, Math.ceil(sec));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

/** the HUD's number format (hud.ts fmt): always floored */
const fmt = (n: number) => (n >= 10000 ? `${(Math.floor(n / 100) / 10).toFixed(1)}k`
  : n >= 10 ? String(Math.floor(n)) : (Math.floor(n * 10) / 10).toString());

/** a victory: the first volley away (swarm protocol, a volley's goods, the burst) */
async function win(page: Page) {
  await g(page, 'completeTech', 'swarmProtocol');
  await g(page, 'grantResources', { foils: 10, launch: 3 });
  await g(page, 'grantPower', 1000);
  await g(page, 'launch');
  await g(page, 'advanceGameSeconds', 2);
  await expect(page.locator('#victory-screen')).toBeVisible();
}

/** which overlay-level element paints at the centre of `sel` */
const topAt = (page: Page, sel: string) => page.evaluate((s) => {
  const r = document.querySelector(s)!.getBoundingClientRect();
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return hit?.closest('#victory-screen, #defeat-screen, #tech-screen, #map-screen')?.id ?? hit?.tagName ?? null;
}, sel);

test('walk mode: the command HUD stays down, and no command screen opens on foot', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await boot(page);
  // everything that used to force itself visible with an inline display
  await g(page, 'select', (await state(page)).buildings[0].id);
  await page.locator('#resource-strip .chip[data-key="metals"]').click();
  await expect(page.locator('#inspector')).toBeVisible();
  await expect(page.locator('#res-panel')).toBeVisible();
  await expect(page.locator('#era-chip')).toBeVisible();
  // the chip that opened the panel keeps focus into walk mode — not after it
  await page.locator('#era-chip').focus();
  await g(page, 'setMode', 'walk');
  await expect(page.locator('#walk-hud')).toBeVisible();
  for (const sel of ['#inspector', '#res-panel', '#era-chip', '#map-chip', '#resource-strip', '#palette', '#milestones', '#swarm-meter']) {
    await expect(page.locator(sel), sel).toBeHidden();
  }
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);

  // no way into the tree or the map on foot: chip, event, keys, a stray Space
  await page.evaluate(() => (document.getElementById('era-chip') as HTMLButtonElement).click());
  await page.evaluate(() => (document.getElementById('map-chip') as HTMLButtonElement).click());
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('moonshots:open-map')));
  await page.keyboard.press('KeyT');
  await page.keyboard.press('KeyM');
  await page.keyboard.press('Space');
  await frames(page, 4);
  await expect(page.locator('#tech-screen')).toBeHidden();
  await expect(page.locator('#map-screen')).toBeHidden();

  // back in command view T opens the tree; stepping onto the surface shuts it
  await g(page, 'setMode', 'build');
  await expect(page.locator('#inspector')).toBeVisible();
  await page.keyboard.press('KeyT');
  await expect(page.locator('#tech-screen')).toBeVisible();
  await g(page, 'setMode', 'walk');
  await expect(page.locator('#tech-screen')).toBeHidden();
  await g(page, 'setMode', 'build');
  await page.keyboard.press('KeyM');
  await expect(page.locator('#map-screen')).toBeVisible();
  await g(page, 'setMode', 'walk');
  await expect(page.locator('#map-screen')).toBeHidden();
  expect(errors).toEqual([]);
});

test('before a world exists: T, M, Tab, Space and Esc on the title and site screens throw nothing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE);
  await expect(page.locator('#site-screen')).toBeVisible();
  for (const k of ['KeyT', 'KeyM', 'Tab', 'Space', 'KeyI', 'Digit3', 'Escape']) await page.keyboard.press(k);
  await page.locator('.site-card', { hasText: 'ILMENITE' }).click();
  await page.locator('#btn-land').click();
  for (const k of ['KeyT', 'KeyM', 'Tab', 'Escape']) await page.keyboard.press(k);
  await page.waitForTimeout(300);
  await expect(page.locator('#tech-screen')).toBeHidden();
  expect(errors).toEqual([]);
});

test('inspector: Dynamic Clocking gets an overclock toggle with its WORN countdown', async ({ page }) => {
  await boot(page);
  await g(page, 'setPaused', true);
  await g(page, 'completeTech', 'regolithProcessing');
  expect(await g(page, 'placeBuilding', 'solar', 132, 126)).toBe(true);
  expect(await g(page, 'placeBuilding', 'excavator', 120, 126)).toBe(true);
  await g(page, 'finishConstruction');
  const ex = (await state(page)).buildings.find((b: any) => b.type === 'excavator');
  await g(page, 'select', ex.id);
  await expect(page.locator('#insp-toggle')).toBeVisible();
  // no tech, no control
  await expect(page.locator('#insp-oc-on')).toHaveCount(0);
  await g(page, 'completeTech', 'dynamicClocking');
  const on = page.locator('#insp-oc-on');
  await expect(on).toBeVisible();
  await expect(page.locator('#insp-oc-off')).toHaveClass(/active/);
  // from new: 0.3 wear at 0.35 per 720 s lunar day
  await expect(page.locator('#insp-oc')).toHaveText(`Nameplate · overclocked it would reach WORN in ${clock(0.3 / (0.35 / 720))}`);

  await on.click();
  await expect.poll(async () => (await state(page)).buildings.find((b: any) => b.id === ex.id).overclock).toBe(true);
  await expect(on).toHaveClass(/active/);
  await g(page, 'advanceGameSeconds', 60);
  const worn = (await state(page)).buildings.find((b: any) => b.id === ex.id);
  expect(worn.active).toBe(true);
  expect(worn.wear).toBeGreaterThan(0.02);
  // the countdown is the sim's own wear rate from where the wear stands
  await expect(page.locator('#insp-oc')).toHaveText(`OVERCLOCKED ×1.5 · WORN in ${clock((0.3 - worn.wear) / (0.35 / 720))}`);

  await page.locator('#insp-oc-off').click();
  await expect.poll(async () => (await state(page)).buildings.find((b: any) => b.id === ex.id).overclock).toBe(false);
  // a solar array has no clock to push: no control
  const solar = (await state(page)).buildings.find((b: any) => b.type === 'solar');
  await g(page, 'select', solar.id);
  await expect(page.locator('#insp-toggle')).toBeVisible();
  await expect(page.locator('#insp-oc-on')).toHaveCount(0);
});

test('inspector: the Lander downlinks banked data to Earth, and says why it cannot', async ({ page }) => {
  await boot(page);
  await g(page, 'setPaused', true);
  await g(page, 'select', (await state(page)).buildings[0].id);
  await expect(page.locator('#insp-order')).toBeVisible();
  await expect(page.locator('#insp-downlink')).toHaveCount(0);
  await g(page, 'completeTech', 'teleoperation');
  const dl = page.locator('#insp-downlink');
  await expect(dl).toHaveText('⇪ Downlink 150≡ → 60◆ 20⚙ 5▣ (½ day)');
  await expect(dl).toHaveAttribute('title', /needs 150≡ banked, have 0/);
  // refused: the handler's alert names the shortfall
  await dl.click();
  await expect.poll(async () => (await state(page)).alerts.some((a: any) => a.text === 'DOWNLINK NEEDS 150≡ BANKED — have 0')).toBe(true);
  await g(page, 'grantData', 200);
  await dl.click();
  await expect.poll(async () => (await state(page)).downlinks).toBe(1);
  const s = await state(page);
  expect(Math.round(s.data)).toBe(50);
  expect(s.resupply.pending && s.resupply.downlink).toBe(true);
  // each costs 50≡ more; one shipment at a time
  await expect(dl).toHaveText('⇪ Downlink 200≡ → 60◆ 20⚙ 5▣ (½ day)');
  await expect(dl).toHaveAttribute('title', /one shipment at a time/);
  await g(page, 'grantData', 300);
  await dl.click();
  await expect.poll(async () => (await state(page)).alerts.some((a: any) => a.text.startsWith('SHIPMENT ALREADY EN ROUTE'))).toBe(true);
  expect((await state(page)).downlinks).toBe(1);
});

test('victory: over the map and the tree, keys dead beneath it', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('KeyM');
  await expect(page.locator('#map-screen')).toBeVisible();
  await win(page);
  await expect(page.locator('#map-screen')).toBeHidden();
  const paused = (await state(page)).paused;
  const speed = (await state(page)).speed;
  // (Tab last: it lands on the overlay's button, which Space would press)
  for (const k of ['KeyT', 'KeyM', 'Space', 'Digit3', 'KeyI', 'Escape', 'Tab']) await page.keyboard.press(k);
  await frames(page, 4);
  await expect(page.locator('#tech-screen')).toBeHidden();
  await expect(page.locator('#map-screen')).toBeHidden();
  await expect(page.locator('#walk-hud')).toBeHidden();
  await expect(page.locator('#menu')).toBeHidden();
  const s = await state(page);
  expect([s.paused, s.speed]).toEqual([paused, speed]);
  // Tab stays on the overlay's own button
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('btn-victory-continue');
  // a screen forced open underneath still paints below it
  await page.evaluate(() => { document.getElementById('map-screen')!.style.display = 'grid'; });
  expect(await topAt(page, '#map-screen')).toBe('victory-screen');
  await page.evaluate(() => { document.getElementById('map-screen')!.style.display = 'none'; });
  await page.locator('#btn-victory-continue').click();
  await expect(page.locator('#victory-screen')).toBeHidden();
  await page.keyboard.press('KeyT');
  await expect(page.locator('#tech-screen')).toBeVisible();
});

test('defeat: the tree closes under it, and its cards never paint over it', async ({ page }) => {
  await boot(page, 'human');
  await page.keyboard.press('KeyT');
  await expect(page.locator('.tech-card').first()).toBeVisible();
  await page.keyboard.press('Space'); // pausing leaves the loss to the debug clock
  await g(page, 'grantResources', { oxygen: -1000, food: -1000 });
  await g(page, 'advanceGameMinutes', 6);
  await expect(page.locator('#defeat-screen')).toBeVisible();
  await expect(page.locator('#tech-screen')).toBeHidden();
  await page.keyboard.press('KeyT');
  await page.keyboard.press('KeyM');
  await frames(page, 4);
  await expect(page.locator('#tech-screen')).toBeHidden();
  await expect(page.locator('#map-screen')).toBeHidden();
  // the tree's cards carry a z-index; the tree is its own stacking context
  await page.evaluate(() => { document.getElementById('tech-screen')!.style.display = 'flex'; });
  expect(await topAt(page, '.tech-card')).toBe('defeat-screen');
});

test('objectives and a resource panel: one open at a time, neither covers the other', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 633 });
  await boot(page, 'human');
  const goals = page.locator('#milestones');
  const panel = page.locator('#res-panel');
  await page.locator('#resource-strip .chip[data-key="oxygen"]').click();
  await expect(panel).toBeVisible();
  await goals.click();
  await expect(goals.locator('.goal-item').first()).toBeVisible();
  await expect(panel).toBeHidden();
  await page.locator('#resource-strip .chip[data-key="parts"]').click();
  await expect(panel).toBeVisible();
  await expect(goals.locator('.goal-item')).toHaveCount(0);
  // collapsed, the objectives sit clear of the panel and its Close
  type Box = { x: number; y: number; width: number; height: number };
  const a = (await panel.boundingBox()) as Box;
  const b = (await goals.boundingBox()) as Box;
  expect(a.y + a.height).toBeLessThanOrEqual(b.y);
  await page.locator('#res-panel-close').click();
  await expect(panel).toBeHidden();
});

for (const vp of [{ width: 1280, height: 720 }, { width: 1280, height: 633 }]) {
  test(`inspector ${vp.width}×${vp.height}: every button above the fold, and alerts never move them`, async ({ page }) => {
    await page.setViewportSize(vp);
    await boot(page, 'human', 'southpole');
    await g(page, 'setPaused', true);
    await g(page, 'completeTech', 'teleoperation');
    await g(page, 'completeTech', 'dynamicClocking');
    // a full alert stack standing as the Lander (the tallest inspector) opens
    await g(page, 'grantResources', { chips: 1, foils: 1, launch: 1, oxygen: -110, water: -45 });
    await g(page, 'placeBuilding', 'solar', 132, 126);
    await g(page, 'advanceGameSeconds', 3);
    await g(page, 'select', (await state(page)).buildings[0].id);
    await expect(page.locator('#insp-order')).toBeVisible();
    type Box = { x: number; y: number; width: number; height: number };
    const inView = async () => {
      const insp = (await page.locator('#inspector').boundingBox()) as Box;
      expect(insp.y + insp.height).toBeLessThanOrEqual(vp.height);
      const btns = await page.locator('#inspector .insp-foot button').evaluateAll((els) =>
        els.map((e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.textContent, top: r.top, bottom: r.bottom }; }));
      expect(btns.length).toBeGreaterThan(5);
      for (const b of btns) {
        expect(b.bottom, String(b.id)).toBeLessThanOrEqual(insp.y + insp.height);
        expect(b.top, String(b.id)).toBeGreaterThanOrEqual(insp.y);
      }
    };
    await inView();
    const order0 = (await page.locator('#insp-order').boundingBox()) as Box;
    // alerts come and go while it is open: the buttons hold still. (Wait for
    // the new alert itself: a count can hold still while an info event fades
    // out in real time as it arrives.)
    await g(page, 'grantResources', { food: -1000 });
    await g(page, 'advanceGameSeconds', 3);
    await expect.poll(async () => (await state(page)).alerts.some((a: any) => a.text.startsWith('FOOD DEPLETED'))).toBe(true);
    await frames(page, 4);
    expect(await page.locator('#insp-order').boundingBox()).toEqual(order0);

    // an overclockable station: its verbs are all in view too
    await g(page, 'grantResources', { metals: 100, parts: 50 });
    const pad = await page.evaluate(() => {
      for (let gx = 116; gx < 140; gx += 2) {
        for (let gz = 116; gz < 140; gz += 2) {
          if (window.__game.canPlace('excavator', gx, gz).valid) return [gx, gz];
        }
      }
      return null;
    });
    expect(pad).not.toBeNull();
    expect(await g(page, 'placeBuilding', 'excavator', pad![0], pad![1])).toBe(true);
    await g(page, 'finishConstruction');
    await g(page, 'select', (await state(page)).buildings.find((b: any) => b.type === 'excavator').id);
    await expect(page.locator('#insp-oc-on')).toBeVisible();
    await inView();
    await page.screenshot({ path: `test-results/ui-inspector-${vp.width}x${vp.height}.png` });
  });
}

test('tree opened from its chip: Enter queues the selected card and the tree stays open', async ({ page }) => {
  await boot(page);
  await page.locator('#era-chip').click();
  const tree = page.locator('#tech-screen');
  await expect(tree).toBeVisible();
  // the chip let go of the keyboard
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('tech-screen');
  await page.keyboard.press('ArrowDown');
  const first = await page.locator('.tech-card.sel').getAttribute('data-tech');
  expect(first).toBeTruthy();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).researchQueue).toEqual([first]);
  await expect(tree).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tree).toBeHidden();
});

test('held keys: T, M, Esc, Space, I and Tab toggle once; camera keys keep repeating', async ({ page }) => {
  await boot(page);
  const held = async (key: string, n = 4) => {
    for (let i = 0; i < n; i++) await page.keyboard.down(key); // presses 2..n arrive with repeat set
    await page.keyboard.up(key);
    await frames(page, 3);
  };
  await held('KeyT');
  await expect(page.locator('#tech-screen')).toBeVisible();
  // a held Esc closes the tree and stops there: no menu from the repeats
  await held('Escape');
  await expect(page.locator('#tech-screen')).toBeHidden();
  await expect(page.locator('#menu')).toBeHidden();
  await held('KeyM');
  await expect(page.locator('#map-screen')).toBeVisible();
  await held('Escape');
  await expect(page.locator('#map-screen')).toBeHidden();
  await expect(page.locator('#menu')).toBeHidden();
  // a held Esc opens the menu once and leaves it open
  await held('Escape');
  await expect(page.locator('#menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeHidden();
  await expect.poll(async () => (await state(page)).paused).toBe(false);
  await held('Space');
  await expect.poll(async () => (await state(page)).paused).toBe(true);
  await held('Space', 5);
  await expect.poll(async () => (await state(page)).paused).toBe(false);
  await held('KeyI');
  await expect(page.locator('.chip[data-key="deposits"]')).toHaveClass(/warn/);
  await held('Tab');
  await expect(page.locator('#walk-hud')).toBeVisible({ timeout: 20_000 });
  await held('Tab');
  await expect(page.locator('#walk-hud')).toBeHidden({ timeout: 20_000 });
  // W held: the camera pans on every repeat
  const t0 = (await g(page, 'getCamera')).target;
  for (let i = 0; i < 6; i++) { await page.keyboard.down('KeyW'); await frames(page, 2); }
  await page.keyboard.up('KeyW');
  const t1 = (await g(page, 'getCamera')).target;
  expect(Math.hypot(t1.x - t0.x, t1.z - t0.z)).toBeGreaterThan(1);
});

test('menu: Tab stays inside it, and the hum ducks while it is up', async ({ page }) => {
  await boot(page, 'human');
  await page.locator('#palette .cats .btn', { hasText: 'Power' }).click(); // the gesture that unlocks audio
  await expect.poll(async () => (await g(page, 'getAudio')).state).toBe('running');
  expect((await g(page, 'getAudio')).ducked).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeVisible();
  await expect.poll(async () => (await state(page)).paused).toBe(true);
  expect((await g(page, 'getAudio')).ducked).toBe(true);
  // more Tabs (and Shift-Tabs) than the menu has controls never leave it
  await page.evaluate(() => {
    const w = window as any;
    w.__focusTrail = [];
    document.addEventListener('focusin', (e) => {
      w.__focusTrail.push((e.target as HTMLElement).closest('#menu') ? 'menu' : (e.target as HTMLElement).id || (e.target as HTMLElement).tagName);
    });
  });
  for (let i = 0; i < 16; i++) await page.keyboard.press(i % 4 === 3 ? 'Shift+Tab' : 'Tab');
  const trail: string[] = await page.evaluate(() => (window as any).__focusTrail);
  expect(trail.length).toBeGreaterThanOrEqual(16);
  expect(trail.filter((t) => t !== 'menu')).toEqual([]);
  expect(await page.evaluate(() => !!document.activeElement?.closest('#menu'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeHidden();
  await expect.poll(async () => (await g(page, 'getAudio')).ducked).toBe(false);
  // Space pauses: the hum ducks again
  await page.keyboard.press('Space');
  await expect.poll(async () => (await g(page, 'getAudio')).ducked).toBe(true);
});

test('menu: a save made while it holds the pause records the game as it was before it', async ({ page }) => {
  await boot(page, 'human');
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeVisible();
  await expect.poll(async () => (await state(page)).paused).toBe(true);
  // saved while the menu holds the pause: it comes back running
  await page.locator('#menu [data-act="save"]').click();
  await expect(page.locator('#menu-note')).toContainText(/^Saved · /);
  await page.goto(BASE);
  await page.locator('#btn-continue').click();
  await page.waitForFunction(() => window.__game !== undefined);
  await expect(page.locator('#resource-strip')).toBeVisible();
  expect((await state(page)).paused).toBe(false);
  await expect(page.locator('#pause-veil')).toBeHidden();
  // a game paused before the menu saves paused
  await g(page, 'setPaused', true);
  await expect.poll(async () => (await state(page)).paused).toBe(true);
  await page.keyboard.press('Escape');
  await page.locator('#menu [data-act="save"]').click();
  await expect(page.locator('#menu-note')).toContainText(/^Saved · /);
  await page.goto(BASE);
  await page.locator('#btn-continue').click();
  await page.waitForFunction(() => window.__game !== undefined);
  await expect(page.locator('#resource-strip')).toBeVisible();
  expect((await state(page)).paused).toBe(true);
});

test('live numbers: robots per Bay, construction kW and round-trip loss follow the mods', async ({ page }) => {
  await boot(page);
  await g(page, 'setPaused', true);
  const panel = page.locator('#res-panel');
  await page.locator('#resource-strip .chip[data-key="bots"]').click();
  await expect(panel).toContainText('+2 rovers');
  await expect(panel).toContainText('draws 4 kW');
  // Swarm Robotics: a third rover per Bay, and 1.5× the construction draw
  await g(page, 'completeTech', 'swarmRobotics');
  await expect(panel.locator('.row', { hasText: 'Robotics Bay' })).toContainText('+3 rovers');
  await expect(panel).toContainText('draws 6 kW');
  await page.locator('#resource-strip .chip[data-slot="power"]').click();
  await expect(panel).toContainText('Construction sites pull 6 kW per working rover');
  await expect(panel).toContainText('15% round-trip loss');
  await g(page, 'completeTech', 'regenFuelCells');
  await expect(panel).toContainText('40% round-trip loss');
  await page.locator('#palette .cats .btn', { hasText: 'Power' }).click();
  await page.locator('.bld-btn', { hasText: 'Solar Array' }).hover();
  await expect(page.locator('#tooltip')).toContainText('1 robot · 6 kW · parts to weld');
});

test('live numbers: the data panel shows the sim\'s research transfer, and the night hint the game\'s night', async ({ page }) => {
  await boot(page);
  await g(page, 'setPaused', true);
  const panel = page.locator('#res-panel');
  // research: an empty queue says so; a running one shows the sim's own transfer
  await page.locator('#resource-strip .chip[data-key="data"]').click();
  await expect(panel).toContainText('no research queued');
  expect(await g(page, 'placeBuilding', 'solar', 132, 126)).toBe(true);
  expect(await g(page, 'placeBuilding', 'lab', 135, 133)).toBe(true);
  await g(page, 'finishConstruction');
  await g(page, 'research', 'regolithProcessing');
  await g(page, 'grantData', 50);
  await g(page, 'advanceGameSeconds', 20);
  const rv = await g(page, 'getResearch');
  expect(rv.rate).toBeGreaterThan(0);
  expect(rv.rate).toBeLessThan(rv.cap); // a 30 s average, not the cap
  await expect(panel).toContainText(`feeding research ${fmt(rv.rate * 60)}/min of ${fmt(rv.cap * 60)}/min · 1 lab`);

  // the night hint tells the game's own night
  await page.locator('#milestones').click();
  await expect(page.locator('#milestones')).toContainText('The lunar night (4 min at 1×) kills solar power');
});

test('robotic mission: no crew or morale on the helmet or the victory screen, which lands on the command view', async ({ page }) => {
  await boot(page);
  await g(page, 'setMode', 'walk');
  await expect(page.locator('#helmet .chip')).toHaveCount(2);
  await expect(page.locator('#helmet')).not.toContainText('%');
  // victory on foot: back in the command view beneath the overlay
  await win(page);
  await expect(page.locator('#walk-hud')).toBeHidden();
  expect(await page.evaluate(() => document.getElementById('hud-layer')!.classList.contains('mode-walk'))).toBe(false);
  await expect(page.locator('#victory-screen')).toContainText('2 robots, no one aboard');
  await expect(page.locator('#victory-screen')).not.toContainText('morale');
});

test('the strip never reflows: a survey starting, or dusk turning the bank chip into a runway', async ({ page }) => {
  await boot(page);
  await g(page, 'setPaused', true);
  const widths = () => page.locator('#resource-strip .chip').evaluateAll((els) =>
    els.map((e) => Math.round(e.getBoundingClientRect().width * 10) / 10));
  const w0 = await widths();
  const prospect = (await g(page, 'getLunar')).prospects.find((p: any) => p.surveyable);
  expect(prospect).toBeTruthy();
  await g(page, 'surveyProspect', prospect.id);
  await g(page, 'advanceGameSeconds', 1);
  await expect.poll(async () => (await state(page)).survey.active).toBeTruthy();
  await expect(page.locator('.chip[data-key="bots"]')).toHaveAttribute('title', /lent to a survey/);
  expect(await widths()).toEqual(w0);
  // at night the bank chip counts its runway down in the same slot
  // (a lab: its data has no store to fill, so it draws all night)
  expect(await g(page, 'placeBuilding', 'solar', 132, 126)).toBe(true);
  expect(await g(page, 'placeBuilding', 'lab', 135, 133)).toBe(true);
  await g(page, 'finishConstruction');
  await g(page, 'advanceGameSeconds', 490 - (await state(page)).simTime);
  await expect(page.locator('.chip[data-slot="stored"] .cap')).toHaveText(/^· (\d+:\d\d|1h\+)$/);
  expect(await widths()).toEqual(w0);
});

test('the mare\'s locked Ice Harvester says why, and opens no tree', async ({ page }) => {
  await boot(page);
  await page.locator('#palette .cats .btn', { hasText: 'Extraction' }).click();
  const card = page.locator('.bld-btn.locked', { hasText: 'Ice Harvester' });
  await card.hover();
  await expect(page.locator('#tooltip')).toContainText('Not buildable here — no polar ice');
  await expect(page.locator('#tooltip')).not.toContainText('Requires research');
  // the floater lives 1.4 s: record every one rather than race it
  await page.evaluate(() => {
    const w = window as any;
    w.__floaters = [];
    new MutationObserver((ms) => {
      for (const m of ms) {
        for (const n of m.addedNodes) {
          if ((n as HTMLElement).classList?.contains('floater')) w.__floaters.push((n as HTMLElement).textContent);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  await card.click();
  await expect.poll(() => page.evaluate(() => (window as any).__floaters.join('|'))).toContain('NOT BUILDABLE HERE — NO POLAR ICE');
  await frames(page, 4);
  await expect(page.locator('#tech-screen')).toBeHidden();
});
