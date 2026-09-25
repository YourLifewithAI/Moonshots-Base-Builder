/** Playability layer: the in-game menu (pause, save, new mission, graphics,
 *  safe mode, audio, controls), settings applied before the first frame,
 *  procedural audio that can never break the game, the placement flow
 *  (Shift keeps placing, the hint's cost line, blocked clicks, floaters),
 *  locked cards that open the tree, and live-mod numbers in the HUD. */
import { test, expect as baseExpect, type Page } from '@playwright/test';

// UI actions reach the sim on the next rendered frame; under software GL on a
// loaded machine a frame can take seconds, so assertions get a wider window
const expect = baseExpect.configure({ timeout: 20_000 });

declare global {
  interface Window { __game?: any }
}

const BASE = '/?debug&seed=42&nolock&lowfx';

async function boot(page: Page, exp: 'human' | 'robotic' = 'robotic', extra = '') {
  await page.goto(`${BASE}&site=mare${exp === 'robotic' ? '&exp=robotic' : ''}${extra}`);
  await page.waitForFunction(() => window.__game !== undefined);
}

const g = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => window.__game[f as string](...(a as unknown[])), [fn, args] as const);

/** let `n` frames render (the ghost and the action queue step per frame) */
const frames = (page: Page, n = 3) => page.evaluate((k) => new Promise<void>((done) => {
  let left = k;
  const step = () => (--left <= 0 ? done() : requestAnimationFrame(step));
  requestAnimationFrame(step);
}), n);

const paused = async (page: Page) => (await g(page, 'getState')).paused as boolean;

test('menu: Esc with nothing to cancel opens it paused; Resume closes it as it was', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await boot(page);
  const menu = page.locator('#menu');
  expect(await paused(page)).toBe(false);

  // Esc cancels a placement first; only a second Esc reaches the menu
  await page.locator('.bld-btn', { hasText: 'Solar Array' }).click();
  await expect(page.locator('#place-hint')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#place-hint')).toBeHidden();
  await expect(menu).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(menu).toBeVisible();
  await expect.poll(() => paused(page)).toBe(true);
  await expect(page.locator('#menu-keys')).toContainText('keep placing');
  await expect(page.locator('#menu-keys')).toContainText('research tree');

  // the menu owns the keyboard: no tree, no speed change underneath
  await page.keyboard.press('KeyT');
  await page.keyboard.press('Digit3');
  await frames(page);
  await expect(page.locator('#tech-screen')).toBeHidden();
  expect((await g(page, 'getState')).speed).toBe(1);

  // save now answers in place
  await page.locator('#menu [data-act="save"]').click();
  await expect(page.locator('#menu-note')).toContainText(/^Saved · /);

  await page.locator('#menu [data-act="resume"]').click();
  await expect(menu).toBeHidden();
  await expect.poll(() => paused(page)).toBe(false);

  // opened while paused, it leaves the game paused; the ☰ button opens it too
  await g(page, 'setPaused', true);
  await expect.poll(() => paused(page)).toBe(true);
  await page.locator('#btn-menu').click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await frames(page);
  expect(await paused(page)).toBe(true);

  // new mission asks first, then erases the save and returns to site select
  await page.keyboard.press('Escape');
  await page.locator('#menu [data-act="new"]').click();
  await expect(page.locator('#menu-confirm')).toBeVisible();
  await page.locator('#menu [data-act="new-no"]').click();
  await expect(page.locator('#menu-confirm')).toBeHidden();
  await page.locator('#menu [data-act="new"]').click();
  await page.locator('#menu-new-yes').click();
  await page.waitForURL((u) => !u.searchParams.has('site'));
  await expect(page.locator('#site-screen')).toBeVisible();
  await expect(page.locator('.site-card')).toHaveCount(3);
  await expect(page.locator('#btn-continue')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('menu graphics: the FX level persists across reload and draws the first frame', async ({ page }) => {
  // the FX ladder is High detail's; software GL rebuilds its chain on every
  // rung and reload (~2 min here — it overran the 90 s default at cb2add9 too)
  test.setTimeout(240_000);
  await boot(page, 'human', '&style=detailed');
  await page.keyboard.press('Escape');
  // ?lowfx holds the ladder at 2 — the menu says why, not "auto"
  await expect(page.locator('#menu [data-fx="2"]')).toHaveClass(/active/);
  await expect(page.locator('#menu-fx-note')).toContainText('?lowfx');
  await page.locator('#menu [data-fx="3"]').click();
  expect((await g(page, 'getRenderInfo')).fxLevel).toBe(3);
  await expect(page.locator('#menu [data-fx="3"]')).toHaveClass(/active/);
  await expect(page.locator('#menu [data-fx="3"]')).toHaveClass(/mine/);

  const levels: number[] = [];
  page.on('console', (m) => {
    const hit = /FX level (\d)/.exec(m.text());
    if (hit) levels.push(Number(hit[1]));
  });
  await page.reload();
  await page.waitForFunction(() => window.__game !== undefined);
  const info = await g(page, 'getRenderInfo');
  expect(levels[0]).toBe(3);       // the composer was never built for a higher rung
  expect(info.firstFrame.fx).toBe(3);
  expect(info.fxLevel).toBe(3);
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu [data-fx="3"]')).toHaveClass(/active/);
  await expect(page.locator('#menu [data-fx="3"]')).toHaveClass(/mine/);

  // choose 2; the ladder steps down on its own: shown as AUTO with the cause
  await page.locator('#menu [data-fx="2"]').click();
  await g(page, 'degradeFx');
  await expect(page.locator('#menu-fx-note')).toContainText('AUTO');
  await expect(page.locator('#menu-fx-note')).toContainText('Lowered to FX 3 — debug');
  await expect(page.locator('#menu [data-fx="2"]')).toHaveClass(/failed/);
  expect((await g(page, 'getRenderStatus')).failed).toEqual([2]);
  // restoring a rung that failed this session takes an explicit second yes
  await page.locator('#menu-fx-restore').click();
  await expect(page.locator('#menu-fx-note')).toContainText('drew a black frame');
  expect((await g(page, 'getRenderInfo')).fxLevel).toBe(3);
  await page.locator('#menu-fx-try').click();
  await expect.poll(async () => (await g(page, 'getRenderInfo')).fxLevel).toBe(2);
  await expect(page.locator('#menu-fx-note')).not.toContainText('AUTO');
  // lowering never asks
  await page.locator('#menu [data-fx="3"]').click();
  expect((await g(page, 'getRenderInfo')).fxLevel).toBe(3);
});

test('menu: safe render mode toggles both ways, persists, and holds from the first frame', async ({ page }) => {
  await boot(page, 'robotic', '&style=detailed');
  await page.keyboard.press('Escape');
  const safe = page.locator('#menu-safe');
  await expect(safe).toHaveText('Off');
  await safe.click();
  await expect(safe).toHaveText('On');
  let info = await g(page, 'getRenderInfo');
  expect(info.safeMode).toBe(true);
  expect(info.terrainMaterial).toBe('MeshBasicMaterial');
  expect(info.buildingMaterials.lander).toBe('MeshBasicMaterial');

  await page.reload();
  await page.waitForFunction(() => window.__game !== undefined);
  info = await g(page, 'getRenderInfo');
  expect(info.firstFrame.safe).toBe(true);
  expect(info.safeMode).toBe(true);
  // a player's choice raises no "GPU issue" alert
  expect((await g(page, 'getState')).alerts.some((a: any) => /SAFE RENDER/.test(a.text))).toBe(false);

  await page.keyboard.press('Escape');
  await expect(safe).toHaveText('On');
  await safe.click();
  await expect(safe).toHaveText('Off');
  info = await g(page, 'getRenderInfo');
  expect(info.safeMode).toBe(false);
  expect(info.terrainMaterial).toBe('MeshStandardMaterial');
  expect(info.horizonMaterial).toBe('MeshStandardMaterial');
  expect(info.buildingMaterials.lander).toBe('MeshStandardMaterial');
  // leaving safe mode is kept once the black-frame check has seen a lit frame
  await expect.poll(async () => (await g(page, 'getRenderStatus')).checking).toBe(false);
  await page.reload();
  await page.waitForFunction(() => window.__game !== undefined);
  expect((await g(page, 'getRenderInfo')).firstFrame.safe).toBe(false);
});

const STUBS: Record<string, string> = {
  missing: 'delete window.AudioContext; delete window.webkitAudioContext;',
  'throws on create': "window.AudioContext = class { constructor() { throw new Error('no audio device'); } };",
  'throws on use': `window.AudioContext = function () {
    return new Proxy({}, { get: (_, k) => k === 'state' ? 'running' : k === 'currentTime' ? 0
      : () => { throw new Error('audio graph broken'); } });
  };`,
};

for (const [name, stub] of Object.entries(STUBS)) {
  test(`audio: WebAudio ${name} — every sound call is a silent no-op`, async ({ page }) => {
    // 80 rendered frames plus a night fast-forward: minutes of software GL on a busy machine
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(stub);
    await boot(page);
    // gestures, UI ticks, the menu's audio controls
    await page.locator('#palette .cats .btn', { hasText: 'Science' }).click();
    await page.keyboard.press('Escape');
    await page.locator('#menu-vol').fill('30');
    await page.locator('#menu-music').fill('20');
    await page.locator('#menu-effects').fill('50');
    await page.locator('#menu [data-act="mute"]').click();
    await page.locator('#menu [data-act="mute"]').click();
    await page.locator('#menu [data-act="resume"]').click();
    // every cue, walk-mode breathing, nightfall, placement
    await page.evaluate(() => {
      for (const c of ['tick', 'place', 'invalid', 'built', 'research', 'warn', 'crit', 'nightfall', 'launch']) {
        window.__game.playCue(c);
      }
    });
    await g(page, 'setMode', 'walk');
    await frames(page, 40);
    await g(page, 'setMode', 'build');
    expect(await g(page, 'placeBuilding', 'solar', 132, 126)).toBe(true);
    await g(page, 'finishConstruction');
    await g(page, 'advanceGameSeconds', 490 - (await g(page, 'getState')).simTime);
    await frames(page, 40);
    const audio = await g(page, 'getAudio');
    expect(audio.state).toBe('unavailable');
    expect(audio.played.crit).toBeGreaterThan(0);
    expect(audio.volume).toBeCloseTo(0.3, 5);
    expect(errors).toEqual([]);
  });
}

test('audio: cues follow the state; the hum sags as the bank runs dry', async ({ page }) => {
  await boot(page);
  await page.locator('#palette .cats .btn', { hasText: 'Power' }).click(); // the gesture that unlocks audio
  await expect.poll(async () => (await g(page, 'getAudio')).state).toBe('running');
  await expect.poll(async () => (await g(page, 'getAudio')).hum?.margin ?? -9).toBeGreaterThan(0);
  const before = (await g(page, 'getAudio')).played;
  await g(page, 'completeTech', 'regolithProcessing');
  for (const [t, x, z] of [['solar', 132, 126], ['lab', 135, 133], ['excavator', 120, 126], ['smelter', 120, 132]] as const) {
    expect(await g(page, 'placeBuilding', t, x, z)).toBe(true);
  }
  // the lab outranks the Lander's 6 kW: dark at night, it is a BROWNOUT
  const lab = (await g(page, 'getState')).buildings.find((b: any) => b.type === 'lab');
  await g(page, 'setPriority', lab.id, 0);
  await g(page, 'finishConstruction');
  await g(page, 'advanceGameSeconds', 490 - (await g(page, 'getState')).simTime);
  await g(page, 'grantPower', -(await g(page, 'getState')).powerStored);
  await g(page, 'advanceGameSeconds', 2);
  expect((await g(page, 'getState')).power.brownout).toBe(true);
  const after = (await g(page, 'getAudio')).played;
  expect(after.built).toBeGreaterThan(before.built);
  expect(after.research).toBeGreaterThan(before.research);
  expect(after.nightfall).toBeGreaterThan(before.nightfall);
  expect(after.crit).toBeGreaterThan(before.crit); // over the radio, between Quindar tones
  await expect.poll(async () => (await g(page, 'getAudio')).hum.margin).toBeLessThan(0);
  // walking the surface, the suit breathes
  await g(page, 'setMode', 'walk');
  await expect.poll(async () => (await g(page, 'getAudio')).breathing).toBe(true);
});

test('audio: the score plays after the first gesture, answers its own slider, and darkens at night', async ({ page }) => {
  await boot(page);
  await page.locator('#palette .cats .btn', { hasText: 'Power' }).click(); // the gesture that unlocks audio
  await expect.poll(async () => (await g(page, 'getAudio')).music?.playing ?? false).toBe(true);
  // a chord swells in: real signal at the output, clear of clipping, and most
  // of it in the band small speakers can play
  await expect.poll(async () => (await g(page, 'getAudio')).output?.rmsDb ?? -Infinity, { timeout: 30_000 })
    .toBeGreaterThan(-55);
  const out = (await g(page, 'getAudio')).output;
  expect(out.peakDb).toBeLessThan(-1);
  expect((await g(page, 'getAudio')).music.chords).toBeGreaterThanOrEqual(1);

  // the Music slider is its own volume, and it is kept
  await page.keyboard.press('Escape');
  await page.locator('#menu-music').fill('0');
  await page.locator('#menu-effects').fill('40');
  let a = await g(page, 'getAudio');
  expect(a.musicVolume).toBe(0);
  expect(a.effectsVolume).toBeCloseTo(0.4, 5);
  expect(a.volume).toBeCloseTo(0.7, 5);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mbb-settings') ?? '{}'));
  expect(saved.music).toBe(0);
  expect(saved.effects).toBeCloseTo(0.4, 5);
  await page.locator('#menu-music').fill('70');
  await page.locator('#menu [data-act="resume"]').click();

  // nightfall turns the score toward its night chords
  expect((await g(page, 'getAudio')).music.mood).toBe('day');
  await g(page, 'advanceGameSeconds', 500 - (await g(page, 'getState')).simTime);
  await expect.poll(async () => (await g(page, 'getAudio')).music.mood).toBe('night');
  a = await g(page, 'getAudio');
  expect(a.music.playing).toBe(true);
});

test('audio: rovers are heard as they drive out, and fall quiet when the game pauses', async ({ page }) => {
  await boot(page);
  await page.locator('#palette .cats .btn', { hasText: 'Power' }).click();
  await expect.poll(async () => (await g(page, 'getAudio')).state).toBe('running');
  // a site beside the Lander: a rover sets off (a servo chirp) and its motor runs
  expect(await g(page, 'placeBuilding', 'solar', 132, 126)).toBe(true);
  await expect.poll(async () => {
    const r = (await g(page, 'getAudio')).rovers;
    return (r?.voices ?? []).some((v: any) => v.speed > 0.1 && v.gain > 0);
  }).toBe(true);
  await expect.poll(async () => (await g(page, 'getAudio')).rovers.chirps).toBeGreaterThan(0);
  const voices = (await g(page, 'getAudio')).rovers.voices;
  expect(voices.length).toBeLessThanOrEqual(3);
  for (const v of voices) {
    expect(v.gain).toBeGreaterThan(0);
    expect(v.gain).toBeLessThanOrEqual(1);
  }
  // paused: the fleet stands still, and every motor stops
  await g(page, 'setPaused', true);
  await expect.poll(async () => (await g(page, 'getAudio')).rovers.voices.every((v: any) => v.speed === 0)).toBe(true);
});

/** screen point of a 2×2 pad whose low corner is cell (gx, gz) */
async function padAt(page: Page, gx: number, gz: number) {
  const p = await g(page, 'screenOf', (gx + 1) * 4 - 512, (gz + 1) * 4 - 512);
  expect(p.visible).toBe(true);
  return p as { x: number; y: number };
}

test('placement: Shift-click keeps placing; a plain click places once; the price floats up', async ({ page }) => {
  await boot(page);
  await g(page, 'setPaused', true); // no construction ticks between clicks
  const solars = async () => (await g(page, 'getState')).buildings.filter((b: any) => b.type === 'solar').length;
  const hint = page.locator('#place-hint');
  await page.locator('.bld-btn', { hasText: 'Solar Array' }).click();
  const pads = [await padAt(page, 132, 126), await padAt(page, 132, 130), await padAt(page, 120, 126)];
  const metals = Math.floor((await g(page, 'getState')).resources.metals);

  await page.mouse.move(pads[0].x, pads[0].y);
  await frames(page);
  // name · cost (have→left) · kW from the live mods · keys
  await expect(hint).toContainText(`SOLAR ARRAY · 12◆ (${metals}→${metals - 12}) · +10 kW · R rotate · ⇧ keep placing`);
  await page.keyboard.down('Shift');
  await page.mouse.click(pads[0].x, pads[0].y);
  await expect.poll(solars).toBe(1);
  await expect(page.locator('.floater', { hasText: '−12◆' })).toBeVisible();
  await expect(hint).toBeVisible();
  await expect(hint).toContainText(`12◆ (${metals - 12}→${metals - 24})`);
  await page.mouse.move(pads[1].x, pads[1].y);
  await frames(page);
  await page.mouse.click(pads[1].x, pads[1].y);
  await page.keyboard.up('Shift');
  await expect.poll(solars).toBe(2);
  await expect(hint).toBeVisible();

  await page.mouse.move(pads[2].x, pads[2].y);
  await frames(page);
  await page.mouse.click(pads[2].x, pads[2].y);
  await expect.poll(solars).toBe(3);
  await expect(hint).toBeHidden();
  expect((await g(page, 'getAudio')).played.place).toBeGreaterThanOrEqual(1);
});

test('placement: a click on a blocked spot flashes the hint and blips', async ({ page }) => {
  await boot(page);
  await g(page, 'setPaused', true);
  await page.locator('.bld-btn', { hasText: 'Solar Array' }).click();
  const lander = await g(page, 'screenOf', 0, 0);
  await page.mouse.move(lander.x, lander.y);
  const hint = page.locator('#place-hint');
  await expect(hint.locator('.blocked')).toBeVisible();
  const invalid = (await g(page, 'getAudio')).played.invalid;
  await page.mouse.click(lander.x, lander.y);
  await expect(hint).toHaveAttribute('data-flash', '1');
  await expect(hint).toHaveClass(/flash/);
  await expect(hint).toBeVisible(); // still placing
  expect((await g(page, 'getAudio')).played.invalid).toBe(invalid + 1);
  await frames(page);
  expect((await g(page, 'getState')).buildings.length).toBe(1);
});

test('locked palette card opens the tree on the tech that unlocks it', async ({ page }) => {
  await boot(page);
  await page.locator('#palette .cats .btn', { hasText: 'Industry' }).click();
  const smelter = page.locator('.bld-btn.locked', { hasText: 'Regolith Smelter' });
  await smelter.hover();
  await expect(page.locator('#tooltip')).toContainText('Requires research — Regolith Smelting');
  await smelter.click();
  await expect(page.locator('#tech-screen')).toBeVisible();
  const card = page.locator('.tech-card[data-tech="regolithProcessing"]');
  await expect(card).toHaveClass(/\bsel\b/);
  await expect(card).toHaveClass(/pulse/);
  await expect(page.locator('#tech-sheet-body')).toContainText('Regolith Smelting');
  await page.keyboard.press('Escape');
  await expect(page.locator('#tech-screen')).toBeHidden();
  await expect(page.locator('#menu')).toBeHidden();
  // robots' habitats wait for Human Cohabitation, not for any habitat tech
  await page.locator('#palette .cats .btn', { hasText: 'Life' }).click();
  await page.locator('.bld-btn.locked', { hasText: 'Habitat' }).click();
  await expect(page.locator('.tech-card[data-tech="humanCohabitation"]')).toHaveClass(/\bsel\b/);
});

test('live numbers: the launch row reads 3↑, agent tax and research transfer follow the mods', async ({ page }) => {
  await boot(page);
  // launch capacity per volley, with its unit
  await g(page, 'completeTech', 'swarmProtocol');
  await expect(page.locator('#launch-cost')).toContainText('launch 0/3↑ ✗');
  await g(page, 'grantResources', { launch: 3 });
  await expect(page.locator('#launch-cost')).toContainText('launch 3/3↑ ✓');
  await page.locator('#resource-strip .chip[data-key="launch"]').click();
  await expect(page.locator('#res-panel')).toContainText('3↑ capacity + 10 foils');
  await page.locator('#res-panel-close').click();

  // an agent-run lab's draw: ×(1 + agentTax), which Rad-Hard Process cuts
  await page.locator('#palette .cats .btn', { hasText: 'Science' }).click();
  const lab = page.locator('.bld-btn', { hasText: 'Research Lab' });
  await lab.hover();
  await expect(page.locator('#tooltip')).toContainText('−8 kW (×1.6 agent-run)');
  await page.mouse.move(10, 400);
  await g(page, 'completeTech', 'radHardProcess');
  await lab.hover();
  await expect(page.locator('#tooltip')).toContainText('−6.8 kW (×1.36 agent-run)');
  await page.mouse.move(10, 400);

  // the HUD research chip's S6 states; transfer is 0.4/s per lab
  const name = page.locator('#chip-res-name');
  await expect(name).toHaveText('QUEUE EMPTY — pick research [T]');
  await g(page, 'research', 'regolithProcessing');
  await g(page, 'advanceGameSeconds', 2);
  await expect(name).toHaveText('PAUSED — no lab');
  expect(await g(page, 'placeBuilding', 'solar', 132, 130)).toBe(true);
  expect(await g(page, 'placeBuilding', 'lab', 135, 133)).toBe(true);
  await g(page, 'finishConstruction');
  await g(page, 'grantData', 20);
  await g(page, 'advanceGameSeconds', 5);
  await expect(name).toHaveText('Researching Regolith Smelting');
  await expect(page.locator('#chip-res-pct')).toHaveText(/^\d+% · ETA \d+:\d\d$/);
  await page.locator('#resource-strip .chip[data-key="data"]').click();
  // the sim's own transfer (its 30 s average), held against the lab's 24/min cap
  await g(page, 'setPaused', true);
  await expect.poll(() => paused(page)).toBe(true);
  const moved = (await g(page, 'getResearch')).rate * 60;
  const shown = moved >= 10 ? String(Math.floor(moved)) : (Math.floor(moved * 10) / 10).toString();
  await expect(page.locator('#res-panel')).toContainText(`feeding research ${shown}/min of 24/min · 1 lab`);
  await expect(page.locator('#res-panel')).toContainText('A Data Center moves 150/min, 6 labs');
});
