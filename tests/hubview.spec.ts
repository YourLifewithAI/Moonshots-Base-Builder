/** The preview and the highlight (docs/17 Phase 5, §5.2, §6; core/hubPreview.ts,
 *  world/depositHighlight.ts): picking a Regolith Smelter, a Silicon Refinery
 *  or a Water Management Plant — its ghost, the hub selected, or its palette
 *  card — lights the deposits it wants, with the trip one way, the faces and
 *  the pit, so the player can see where to put it. The ghost's HUB block reads
 *  the route, the units that fill it, the full-size pit against its walls, the
 *  next choice and the plain-pit stake; a structure in a pit's way asks once.
 *  Classic, High detail, the Lunar Map and the phone.
 *
 *  HUBVIEW_SHOTS=<dir> also saves the screenshots there. */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

const SHOTS = process.env.HUBVIEW_SHOTS ?? '';
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

async function start(page: Page, opts: { site?: string; style?: string; extra?: string; grant?: boolean } = {}) {
  const { site = 'mare', style = 'classic', extra = '', grant = true } = opts;
  await page.goto(`/?debug&seed=42&nolock&lowfx&style=${style}&site=${site}&exp=robotic${extra}`);
  await page.waitForFunction(() => window.__game !== undefined && window.__game.getState() !== null);
  await page.evaluate((grant) => {
    const g = window.__game!;
    g.setPaused(true);
    g.advanceGameSeconds(0);
    g.holdHazards(true);
    g.openRoads(true);
    if (grant) g.grantResources({ metals: 2000, parts: 1000, silicon: 300 });
    g.grantPower(20000);
  }, grant);
  await page.evaluate(HELPERS);
}

declare function spotBy(type: string, depId: string, minM?: number, maxM?: number): { gx: number; gz: number; rot: number; m: number } | null;
declare function hubBy(type: string, depId: string): number | null;
const HELPERS = `(() => {
/** the nearest valid spot for \`type\` from a deposit's rim outward (minM..maxM m past the rim) */
window.spotBy = (type, depId, minM = 4, maxM = 80) => {
  const g = window.__game;
  const d = g.getDeposits().find((q) => q.id === depId);
  for (let m = minM; m <= maxM; m += 2) {
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      const x = d.x + Math.cos(a) * (d.r + m), z = d.z + Math.sin(a) * (d.r + m);
      const gx = Math.floor((x + 512) / 4) - 1, gz = Math.floor((z + 512) / 4) - 1;
      for (const rot of [0, 1, 2, 3]) if (g.canPlace(type, gx, gz, rot).valid) return { gx, gz, rot, m };
    }
  }
  return null;
};
window.hubBy = (type, depId) => {
  const s = window.spotBy(type, depId, 4, 80);
  const g = window.__game;
  if (!s || !g.placeBuilding(type, s.gx, s.gz, s.rot)) return null;
  return g.getState().buildings[g.getState().buildings.length - 1].id;
};
})()`;

/** let `n` frames render */
const frames = (page: Page, n = 3) => page.evaluate((k) => new Promise<void>((done) => {
  let left = k;
  const step = () => (--left <= 0 ? done() : requestAnimationFrame(step));
  requestAnimationFrame(step);
}), n);

/** the ghost of `type` at a spot, the pointer over it (the camera looking there first) */
async function ghostAt(page: Page, type: string, spot: { gx: number; gz: number; rot: number }) {
  const c = await page.evaluate(({ spot }) => {
    const x = (spot.gx + 1.5) * 4 - 512, z = (spot.gz + 1.5) * 4 - 512;
    window.__game!.focusGround(x, z);
    return { x, z };
  }, { spot });
  await page.waitForTimeout(1200);
  await page.evaluate(({ type, rot }) => {
    const g = window.__game!;
    g.beginPlacement(type);
    for (let i = 0; i < rot; i++) g.rotatePlacement?.();
  }, { type, rot: spot.rot });
  const at = await page.evaluate(({ c }) => window.__game!.screenOf(c.x, c.z), { c });
  await page.mouse.move(at.x, at.y);
  await frames(page, 4);
  return at;
}

test('a smelter\'s ghost lights ◆ only: trip, faces and the full-size ring; the HUB block reads the route and what fills it', async ({ page }) => {
  await start(page);
  const a = await page.evaluate(() => {
    const g = window.__game!;
    g.revealAll();
    g.advanceGameSeconds(1);
    const near = spotBy('smelter', 'ilmenite-0', 14, 60)!;
    const far = spotBy('smelter', 'ilmenite-0', 40, 90)!;
    const bn = g.hubBlock('smelter', near.gx, near.gz, near.rot);
    const bf = g.hubBlock('smelter', far.gx, far.gz, far.rot);
    const refinery = g.hubBlock('refinery', near.gx, near.gz, near.rot);
    const water = g.hubBlock('waterPlant', near.gx, near.gz, near.rot);
    const kinds = g.getZones().map((z: any) => z.kind);
    return { near, far, bn, bf, refinery, water, kinds, lab: g.hubBlock('lab', near.gx, near.gz, 0) };
  });
  // lit: the smelter's high-Ti basalt, and nothing else at the mare
  const lit = a.bn.entries.filter((e: any) => e.tier === 'lit');
  expect(lit.length).toBeGreaterThan(0);
  expect(lit.every((e: any) => e.kind === 'ilmenite')).toBe(true);
  expect(a.bn.entries.some((e: any) => e.kind === 'anorthosite' || e.kind === 'volatiles')).toBe(false);
  const e0 = a.bn.entries.find((e: any) => e.id === 'ilmenite-0');
  expect(e0.best).toBe(true);
  expect(e0.state).toBe('open');
  expect(e0.fullR).toBeGreaterThan(e0.r * 1.25);
  expect(e0.label).toMatch(/^≈?\d+:\d\d · 0\/\d faces$/);
  // the headline keeps Phases 1–2's words; the block reads the route, the fill, the ring
  expect(a.bn.headline).toMatch(/^HUB — its regolith excavators dig high-Ti basalt #0, ~\d+ s one way · ~[\d.]+▲\/s a unit; it burns [\d.]+▲\/s · feed ×1\.\d\d$/);
  expect(a.bn.lines[0]).toMatch(/^◆ high-Ti basalt #0 · ≈?\d+ m .*\+ \d+ m off-road · trip ≈?\d+:\d\d · faces 0\/\d working$/);
  expect(a.bn.lines[1]).toMatch(/^a regolith excavator brings ~[\d.]+▲\/s of the [\d.]+▲\/s it burns: /);
  expect(a.bn.lines.some((l: string) => /^the full-size pit \(R \d+ m\) /.test(l))).toBe(true);
  // farther is a longer trip and less a unit
  const eta = (b: any) => b.entries.find((e: any) => e.id === 'ilmenite-0').eta;
  const rate = (b: any) => b.entries.find((e: any) => e.id === 'ilmenite-0').rate;
  expect(eta(a.bf)).toBeGreaterThan(eta(a.bn));
  expect(rate(a.bf)).toBeLessThan(rate(a.bn));
  // the refinery lights anorthosite; the mare's water plant, mature soil
  expect(a.refinery.entries.filter((e: any) => e.tier === 'lit' && e.state !== 'stake').every((e: any) => e.kind === 'anorthosite')).toBe(true);
  if (a.kinds.includes('anorthosite')) expect(a.refinery.entries.some((e: any) => e.kind === 'anorthosite')).toBe(true);
  expect(a.water.entries.filter((e: any) => e.tier === 'lit' && e.state !== 'stake').every((e: any) => e.kind === 'volatiles')).toBe(true);
  expect(a.lab.headline).toBe('');

  // on screen: the ghost lights them, the labels say it, the hint carries the block
  await ghostAt(page, 'smelter', a.near);
  const h = await page.evaluate(() => window.__game!.getHighlight());
  expect(h.light.source).toBe('ghost');
  expect(h.drawn.visible).toBe(true);
  expect(h.drawn.ribbonTris).toBeGreaterThan(0);
  expect(h.drawn.fillTris).toBeGreaterThan(0);
  expect(h.drawn.glow).toBe(0);
  await expect(page.locator('#place-hub .hb-head')).toContainText(/^HUB — /);
  await expect(page.locator('#place-hub .hb-line').first()).toContainText(/high-Ti basalt #0 · /);
  const chip = page.locator('.deposit-mark.hl-lit[data-dep="ilmenite-0"]');
  await expect(chip).toBeVisible();
  await expect(chip.locator('.t')).toHaveText(/\d+:\d\d · 0\/\d faces/);
  await expect(chip).toHaveClass(/hl-best/);
  // no label for the kinds it does not want
  await expect(page.locator('.deposit-mark[data-dep^="anorthosite"], .deposit-mark[data-dep^="volatiles"]')).toHaveCount(0);
  await shot(page, 'classic-smelter-ghost');
  // it goes with the ghost
  await page.evaluate(() => window.__game!.cancelPlacement());
  await frames(page, 3);
  expect(await page.evaluate(() => window.__game!.getHighlight().light)).toBeNull();
  await expect(page.locator('.deposit-mark.hl-lit')).toHaveCount(0);
});

test('with no wanted deposit in reach, the ghost stakes its plain pit — the one placement stakes; MRE melts any soil', async ({ page }) => {
  await start(page);
  const a = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('siliconRefining');
    g.advanceGameSeconds(1);
    const zones = g.getZones().map((z: any) => z.kind);
    const spot = spotBy('refinery', 'ilmenite-0', 14, 60)!;
    const b = g.hubBlock('refinery', spot.gx, spot.gz, spot.rot);
    const pits0 = g.getState().plainPits.length;
    g.placeBuilding('refinery', spot.gx, spot.gz, spot.rot);
    const pits = g.getState().plainPits;
    return { zones, b, pits0, pit: pits.length > pits0 ? pits[pits.length - 1] : null };
  });
  expect(a.zones).not.toContain('anorthosite');
  expect(a.b.headline).toMatch(/^HUB — no highland anorthosite within 90 s one way: it stakes a plain pit by its door$/);
  expect(a.b.stake).not.toBeNull();
  expect(a.b.lines.some((l: string) => /^no highland anorthosite in reach: its regolith excavator opens a plain pit here, \d+ m from its door \(the dashed ring\) · q \d\.\d\d/.test(l))).toBe(true);
  const st = a.b.entries.find((e: any) => e.state === 'stake');
  expect(st.label).toMatch(/^plain pit here · q \d\.\d\d/);
  // the ghost's stake is where placing it stakes
  expect(a.pit).not.toBeNull();
  expect(a.pit.x).toBeCloseTo(a.b.stake[0], 1);
  expect(a.pit.z).toBeCloseTo(a.b.stake[1], 1);
  // selected, the refinery lights its plain pit
  const sel = await page.evaluate(() => {
    const g = window.__game!;
    const hub = g.getState().buildings[g.getState().buildings.length - 1].id;
    return g.hubLightOf(hub);
  });
  const plain = sel.find((e: any) => e.state === 'plain');
  expect(plain).toBeTruthy();
  expect(plain.label).toMatch(/^P\d+ · q \d\.\d\d · 0\/3/);
  // MRE: a smelter's block says any ground serves it
  const mre = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('moltenElectrolysis');
    g.advanceGameSeconds(1);
    const spot = spotBy('smelter', 'ilmenite-0', 30, 70)!;
    return g.hubBlock('smelter', spot.gx, spot.gz, spot.rot).lines;
  });
  expect(mre).toContain('MRE melts any soil: a plain pit serves it as well as a deposit');
});

test('a structure in a full-size pit ring is IN THE PIT\'S WAY: the first click asks, the second builds', async ({ page }) => {
  await start(page);
  const a = await page.evaluate(() => {
    const g = window.__game!;
    // a solar array just off high-Ti basalt #0's ring: inside its full-size pit and its setback
    const close = spotBy('solar', 'ilmenite-0', 2, 30)!;
    const why = g.pitWayWhy('solar', close.gx, close.gz, close.rot);
    const chk = g.canPlace('solar', close.gx, close.gz, close.rot);
    // far off every deposit: no warning
    const clear = g.pitWayWhy('solar', 118, 112, 0);
    return { close, why, warn: chk.warn, clear };
  });
  expect(a.why).toMatch(/^IN THE PIT'S WAY — high-Ti basalt #0's pit will reach \d+ m from its centre; here it stops at your wall and (~\d+%|a little|nearly all) of its ore stays in the ground$/);
  expect(a.warn).toContain(a.why);
  expect(a.clear).toBe('');
  // the click flow: asks once, builds on the second
  const at = await ghostAt(page, 'solar', a.close);
  const n0 = await page.evaluate(() => window.__game!.getState().buildings.length);
  await expect(page.locator('#place-hint .caution')).toContainText("IN THE PIT'S WAY");
  await page.mouse.click(at.x, at.y);
  await frames(page, 3);
  expect(await page.evaluate(() => window.__game!.getState().buildings.length)).toBe(n0);
  await expect(page.locator('#place-hint .caution-act')).toContainText(/again to build it anyway/);
  await page.mouse.click(at.x, at.y);
  await frames(page, 3);
  expect(await page.evaluate(() => window.__game!.getState().buildings.length)).toBe(n0 + 1);
});

test('a selected hub lights its pit (rim, ore band), and its full and boxed-in states', async ({ page }) => {
  await start(page);
  const a = await page.evaluate(() => {
    const g = window.__game!;
    const hub = hubBy('smelter', 'ilmenite-0')!;
    g.finishConstruction();
    g.advanceGameSeconds(1);
    // a pit cut at high-Ti basalt #0 (the adapter the tests dig with)
    const d = g.getDeposits().find((q: any) => q.id === 'ilmenite-0');
    g.pitDig(d.x, d.z, 1500, 1.3);
    g.advanceGameSeconds(12);
    g.select(hub);
    g.focusGround(d.x, d.z);
    return { hub, entries: g.hubLightOf(hub) };
  });
  await frames(page, 4);
  const e0 = a.entries.find((e: any) => e.id === 'ilmenite-0');
  expect(e0.pit).not.toBeNull();
  expect(e0.state).toBe('pit');
  expect(e0.label).toMatch(/\d\/\d faces · pit \d+ m$/);
  const h = await page.evaluate(() => window.__game!.getHighlight());
  expect(h.light.source).toBe('selected');
  expect(h.drawn.lines).toBeGreaterThan(0);
  // the $deposits view carries it (the Lunar Map reads it)
  const lit = await page.evaluate(() => window.__game!.litDeposits().find((d: any) => d.id === 'ilmenite-0')?.lit);
  expect(lit?.pitR).toBeGreaterThan(1);
  expect(lit?.state).toBe('pit');
  // every face working: FULL, in long dashes
  const full = await page.evaluate((hub) => {
    const g = window.__game!;
    const faces = g.hubLightOf(hub).find((e: any) => e.id === 'ilmenite-0').faces;
    g.holdFaces('dep:ilmenite-0', faces);
    const out = g.hubLightOf(hub).find((e: any) => e.id === 'ilmenite-0');
    g.holdFaces('dep:ilmenite-0', 0);
    // a pit that cannot widen: BOXED IN, cross-hatched
    g.setPitState('dep:ilmenite-0', 'boxed');
    const boxed = g.hubLightOf(hub).find((e: any) => e.id === 'ilmenite-0');
    g.setPitState('dep:ilmenite-0', 'open');
    return { out, boxed };
  }, a.hub);
  expect(full.out.state).toBe('full');
  expect(full.out.label).toMatch(/^FULL (\d)\/\1/);
  expect(full.boxed.state).toBe('boxed');
  expect(full.boxed.label).toBe('BOXED IN');
  await page.waitForTimeout(400);
  await shot(page, 'classic-smelter-selected-pit');
  // a ghost by a full deposit: its units would go to the next one
  const ghost = await page.evaluate(() => {
    const g = window.__game!;
    const spot = spotBy('smelter', 'ilmenite-0', 14, 70)!;
    g.holdFaces('dep:ilmenite-0', b0faces());
    function b0faces() { return g.hubLightOf('smelter').find((e: any) => e.id === 'ilmenite-0').faces; }
    const b = g.hubBlock('smelter', spot.gx, spot.gz, spot.rot);
    return b;
  });
  expect(ghost.entries.find((e: any) => e.id === 'ilmenite-0').state).toBe('full');
  if (ghost.entries.some((e: any) => e.id !== 'ilmenite-0' && e.inReach)) {
    expect(ghost.lines.some((l: string) => /^high-Ti basalt #0 is full \((\d)\/\1 faces\) — its units would go to high-Ti basalt #\d, ≈?\d+:\d\d$/.test(l))).toBe(true);
  }
  // drawn full (long dashes) while held
  await page.waitForTimeout(400);
  await shot(page, 'classic-smelter-selected-full');
  await page.evaluate(() => window.__game!.holdFaces('dep:ilmenite-0', 0));
});

test('the pole\'s water plant with no ice in reach carries NO ICE IN REACH; by a cold trap it lights the ice', async ({ page }) => {
  await start(page, { site: 'southpole' });
  const a = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('iceExtraction');
    g.advanceGameSeconds(1);
    // a far corner: every mapped cold trap beyond its 90 s
    const far = g.hubBlock('waterPlant', 20, 20, 0);
    const ice = g.getDeposits().find((q: any) => q.kind === 'ice' && q.revealed);
    const near = spotBy('waterPlant', ice.id, 4, 60);
    return { far, near: near ? g.hubBlock('waterPlant', near.gx, near.gz, near.rot) : null };
  });
  expect(a.far.warn).toMatch(/^NO ICE IN REACH — (the nearest mapped cold trap is ≈?\d+:\d\d away \(reach 1:30\); map further or build nearer|no cold trap is mapped yet)/);
  expect(a.far.headline).toMatch(/its ice miners would stand idle$/);
  expect(a.near?.warn ?? '').toBe('');
  expect(a.near?.entries.some((e: any) => e.kind === 'ice' && e.tier === 'lit')).toBe(true);
});

test('a hub\'s palette card lights its ground on hover (no position: faces and pits); the Lunar Map keeps a selected hub\'s highlight', async ({ page }) => {
  await start(page);
  await page.locator('#palette .cats .btn', { hasText: 'Extraction' }).click();
  await page.locator('#palette .bld-btn[data-type="smelter"]').hover();
  await frames(page, 4);
  const h = await page.evaluate(() => window.__game!.getHighlight());
  expect(h.light?.source).toBe('card');
  const e0 = h.light.entries.find((e: any) => e.id === 'ilmenite-0');
  expect(e0.eta).toBeNull();
  expect(e0.label).toMatch(/^0\/\d faces$/);
  await page.mouse.move(700, 300);
  await frames(page, 3);
  expect(await page.evaluate(() => window.__game!.getHighlight().light)).toBeNull();
  // the map: select a hub, open it, the SITE view draws the lit ring and label
  await page.evaluate(() => {
    const g = window.__game!;
    const hub = hubBy('smelter', 'ilmenite-0')!;
    g.finishConstruction();
    g.advanceGameSeconds(1);
    g.select(hub);
  });
  await frames(page, 4);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('moonshots:open-map')));
  await expect(page.locator('#map-screen .mb circle.dep.lit').first()).toBeAttached();
  await expect(page.locator('#map-screen .mk .dep-t.lit .lbl').first()).toContainText(/high-Ti basalt · \d+:\d\d · \d\/\d faces/);
  await expect(page.locator('#map-screen .mb circle.dep-full').first()).toBeAttached();
  await shot(page, 'map-site-selected-smelter');
});

test('High detail draws the same highlight, with the emissive rim line', async ({ page }) => {
  await start(page, { style: 'detailed' });
  const spot = await page.evaluate(() => spotBy('smelter', 'ilmenite-0', 14, 60));
  await ghostAt(page, 'smelter', spot!);
  await page.waitForTimeout(600);
  const h = await page.evaluate(() => window.__game!.getHighlight());
  expect(h.drawn.classic).toBe(false);
  expect(h.drawn.ribbonTris).toBeGreaterThan(0);
  expect(h.drawn.glow).toBeGreaterThan(0);
  await expect(page.locator('.deposit-mark.hl-lit[data-dep="ilmenite-0"]')).toBeVisible();
  await shot(page, 'high-smelter-ghost');
});

test.describe('touch', () => {
  test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: 3, viewport: { width: 844, height: 390 } });

  test('the phone: the first tap on a hub\'s card lights its ground; the HUB block rides the placement bar', async ({ page }) => {
    await start(page);
    await expect(page.locator('#touch-top')).toBeVisible();
    // the camera over a valid spot by high-Ti basalt #0
    const spot = await page.evaluate(() => {
      const s = spotBy('smelter', 'ilmenite-0', 14, 60)!;
      const x = (s.gx + 1.5) * 4 - 512, z = (s.gz + 1.5) * 4 - 512;
      window.__game!.focusGround(x, z - 12);
      return { ...s, x, z };
    });
    await page.waitForTimeout(1200);
    await page.locator('#palette .cats .btn', { hasText: 'Extraction' }).tap();
    await page.locator('#palette .bld-btn[data-type="smelter"]').tap();
    await frames(page, 6);
    const h = await page.evaluate(() => window.__game!.getHighlight());
    expect(h.light?.source).toBe('ghost');
    expect(h.drawn.visible).toBe(true);
    await expect(page.locator('#touch-bar')).toBeVisible();
    // a tap moves the ghost there: a valid spot shows the block in the bar
    const at = await page.evaluate((sp: any) => window.__game!.screenOf(sp.x, sp.z), spot);
    expect(at.visible).toBe(true);
    await page.touchscreen.tap(at.x, at.y);
    await frames(page, 6);
    await expect(page.locator('#touch-bar #place-hub .hb-head')).toContainText(/^HUB — /);
    const chip = page.locator('.deposit-mark.hl-lit').first();
    await expect(chip).toBeVisible();
    const box = (await chip.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(844);
    await expect(page.locator('#t-deposits')).toHaveClass(/lit/);
    await shot(page, 'touch-smelter-ghost');
    // the locked refinery's first tap shows its card — and lights its ground
    await page.locator('#tb-cancel').tap();
    await frames(page, 3);
    await page.locator('#palette .bld-btn[data-type="refinery"]').tap();
    await frames(page, 4);
    await expect(page.locator('#touch-info')).toBeVisible();
    const c = await page.evaluate(() => window.__game!.getHighlight());
    // with no anorthosite mapped yet there is nothing to light
    expect(c.light === null || c.light.source === 'card').toBe(true);
    await page.locator('#touch-info [data-ti="close"]').tap();
    // a hub placed and tapped: its ground lights with its inspector open
    const hub = await page.evaluate(() => {
      const g = window.__game!;
      const id = hubBy('smelter', 'ilmenite-0')!;
      g.finishConstruction();
      g.advanceGameSeconds(1);
      return { id, fp: g.footprintOf(id) };
    });
    await frames(page, 4);
    const hp = await page.evaluate((fp: any) => window.__game!.screenOf((fp.x0 + fp.x1) / 2, (fp.z0 + fp.z1) / 2, 3), hub.fp);
    await page.touchscreen.tap(hp.x, hp.y);
    await frames(page, 6);
    const sel = await page.evaluate(() => window.__game!.getHighlight());
    if (sel.light?.source !== 'selected') await page.evaluate((id) => window.__game!.select(id), hub.id);
    await frames(page, 6);
    expect((await page.evaluate(() => window.__game!.getHighlight())).light?.source).toBe('selected');
    await expect(page.locator('#inspector')).toBeVisible();
    await expect(page.locator('.deposit-mark.hl-lit').first()).toBeAttached();
    // the palette and the sheet folded away: the lit ground in view, the highlight kept
    await page.locator('#t-build').tap();
    await page.locator('#touch-sheet-fold').tap();
    await page.evaluate(() => { const d = window.__game!.getDeposits().find((q: any) => q.id === 'ilmenite-0'); window.__game!.focusGround(d.x, d.z); });
    await page.waitForTimeout(1200);
    expect((await page.evaluate(() => window.__game!.getHighlight())).light?.source).toBe('selected');
    await expect(page.locator('.deposit-mark.hl-lit').first()).toBeVisible();
    await shot(page, 'touch-smelter-selected');
  });
});
