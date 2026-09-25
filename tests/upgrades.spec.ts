/** The expanded tree (docs/12): every tech carries a visual and an honest
 *  trade-off and matters where it shows; completing a tech grows its part on
 *  the buildings it touches (the instanced geometry swaps, only when the
 *  upgrade key changes), the ghost and the dishes follow, and a save
 *  round-trip restores the upgraded form. */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

const URL_DEBUG = '/?debug&seed=42&nolock&lowfx';

async function start(page: Page, site: string, exp: 'human' | 'robotic' = 'human', extra = '') {
  await page.goto(`${URL_DEBUG}&site=${site}${exp === 'robotic' ? '&exp=robotic' : ''}${extra}`);
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
}

test('data: 129 techs, each with a visual line, a generated pro and con, relevant wherever it shows', async ({ page }) => {
  await start(page, 'mare');
  const r = await page.evaluate(async () => {
    const T = await import('/src/data/techs.ts');
    const R = await import('/src/core/research.ts');
    const S = await import('/src/data/sites.ts');
    const U = await import('/src/buildings/upgrades.ts');
    const noVisual = T.TECH_ORDER.filter((t: string) => !(T.TECHS[t].visual ?? '').trim());
    const audit = window.__game.auditTechs() as { id: string; pros: number; cons: number }[];
    const irrelevant: Record<string, string[]> = {};
    for (const site of S.SITE_ORDER) {
      for (const exp of ['robotic', 'human']) {
        const bad = R.irrelevantVisibleTechs(site, exp);
        if (bad.length) irrelevant[`${site}:${exp}`] = bad;
      }
    }
    // every tech with a non-unlock effect on a building has a part there (unless its
    // visual is drawn elsewhere: Shielding's berms, Grading's pads). The destiny
    // picks and capstones get their parts with the look (docs/14 §4, phase D4).
    const upgraded = new Set(Object.values(U.UPGRADES).flat().map((u: any) => u.tech));
    const partless = T.TECH_ORDER.filter((t: string) => {
      const d = T.TECHS[t];
      if (d.track || d.band) return false;
      const touches = d.effects.some((fx: any) => fx.kind !== 'unlock' && (fx.building || fx.buildings));
      return touches && !upgraded.has(t);
    });
    return {
      n: T.TECH_ORDER.length, noVisual, partless,
      noPro: audit.filter((a) => a.pros < 1).map((a) => a.id),
      noCon: audit.filter((a) => a.cons < 1).map((a) => a.id),
      irrelevant,
    };
  });
  expect(r.n).toBe(129); // docs/12's 92, the Builder's 12, docs/14's 19 destiny techs, docs/15's 4 road tiers … and the rest
  expect(r.noVisual).toEqual([]);
  expect(r.noPro).toEqual([]);
  expect(r.noCon).toEqual([]);
  expect(r.irrelevant).toEqual({});
  expect(r.partless).toEqual(['regolithShielding']);
});

test('budget: every upgrade part stays under 600 triangles, every fully upgraded type under 7,500', async ({ page }) => {
  await start(page, 'mare');
  const b = await page.evaluate(() => window.__game.upgradeTriangles()) as
    Record<string, { base: number; full: number; parts: Record<string, number>; movers: Record<string, number> }>;
  const big: string[] = [];
  const empty: string[] = [];
  for (const [type, v] of Object.entries(b)) {
    expect(v.full, type).toBeLessThanOrEqual(7500);
    for (const [tech, n] of Object.entries(v.parts)) {
      if (n > 600) big.push(`${type}:${tech}=${n}`);
      if (n + v.movers[tech] <= 0) empty.push(`${type}:${tech}`);
    }
  }
  expect(big).toEqual([]);
  expect(empty).toEqual([]); // every upgrade adds something you can see
});

for (const style of ['classic', 'detailed']) test(`${style}: a tech with a visual grows its part on every building of the type, once, and a save restores it`, async ({ page }) => {
  await start(page, 'mare', 'human', `&style=${style}`);
  expect((await page.evaluate(() => window.__game.getRenderInfo())).style).toBe(style);
  const spots = (type: string, n: number) => page.evaluate(([type, n]) => {
    const g = window.__game!;
    let placed = 0;
    for (let r = 4; r < 20 && placed < n; r++) {
      for (let dx = -r; dx <= r && placed < (n as number); dx += 3) {
        if (g.placeBuilding(type, 127 + dx, 127 - r)) placed++;
      }
    }
    return placed;
  }, [type, n] as const);
  expect(await spots('lab', 2)).toBe(2);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.finishConstruction();
    g.advanceGameSeconds(1);
    const stock = g.getUpgrades();
    g.beginPlacement('lab');
    g.advanceGameSeconds(0);
    const ghostStock = g.getUpgrades().ghost;
    g.cancelPlacement();
    // economy ticks and an unrelated tech never rebuild the lab's mesh
    g.advanceGameSeconds(20);
    g.completeTech('heatRecoveryJackets');
    g.advanceGameSeconds(1);
    const unrelated = g.getUpgrades();
    g.completeTech('fieldSpectrometers');
    g.advanceGameSeconds(1);
    const turret = g.getUpgrades();
    g.completeTech('uplinkDishes');
    g.completeTech('scienceCrews');
    g.advanceGameSeconds(1);
    const dish = g.getUpgrades();
    // the ghost takes the upgraded form, and re-forms if a tech lands mid-placement
    g.beginPlacement('lab');
    g.advanceGameSeconds(0);
    const ghostUp = g.getUpgrades().ghost;
    g.completeTech('cryoSampleStore');
    g.advanceGameSeconds(1);
    g.stepFrame(0.016);
    const ghostMid = g.getUpgrades().ghost;
    g.cancelPlacement();
    g.advanceGameSeconds(1);
    return { stock, ghostStock, unrelated, turret, dish, ghostUp, ghostMid, after: g.getUpgrades() };
  });
  const lab = (x: any) => x.meshes.lab;
  expect(lab(r.stock).key).toBe('');
  expect(lab(r.unrelated).geometry).toBe(lab(r.stock).geometry);
  expect(r.unrelated.meshes.smelter).toBeUndefined(); // no smelter placed: nothing to build
  expect(r.unrelated.want.smelter).toBe('heatRecoveryJackets');
  expect(lab(r.turret).key).toBe('fieldSpectrometers');
  expect(lab(r.turret).triangles).toBeGreaterThan(lab(r.stock).triangles);
  expect(lab(r.turret).geometry).not.toBe(lab(r.stock).geometry);
  expect(lab(r.dish).key).toBe('fieldSpectrometers,scienceCrews,uplinkDishes');
  // Uplink Dishes: a second dish on each of the two labs
  expect(r.dish.trackers.dishes).toBe(r.stock.trackers.dishes + 2);
  expect(r.ghostUp).toBeGreaterThan(r.ghostStock);
  expect(r.ghostMid).toBeGreaterThan(r.ghostUp);

  // save, reload, continue: the same key, the same geometry size, the same dishes
  await page.evaluate(() => window.__game.save());
  await page.goto(`${URL_DEBUG}&style=${style}`);
  await expect(page.locator('#btn-continue')).toBeVisible();
  await page.locator('#btn-continue').click();
  await page.waitForFunction(() => (window.__game?.getState()?.buildings?.length ?? 0) > 2);
  const loaded = await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(1); return window.__game.getUpgrades(); });
  expect(lab(loaded).key).toBe(lab(r.after).key);
  expect(lab(loaded).key).toContain('cryoSampleStore');
  expect(lab(loaded).triangles).toBe(lab(r.after).triangles);
  expect(loaded.trackers.dishes).toBe(r.after.trackers.dishes);
});

test('site upgrades: pole arrays climb masts and widen; the key follows techs done, not the site', async ({ page }) => {
  await start(page, 'southpole', 'robotic');
  const r = await page.evaluate(() => {
    const g = window.__game!;
    let ok = false;
    for (let dx = 4; dx < 14 && !ok; dx++) ok = g.placeBuilding('solar', 127 + dx, 127 + 5);
    g.finishConstruction();
    g.advanceGameSeconds(1);
    const stock = g.getUpgrades();
    g.completeTech('peakLightMasts');
    g.completeTech('wingExtensions');
    g.advanceGameSeconds(1);
    return { ok, stock, up: g.getUpgrades() };
  });
  expect(r.ok).toBe(true);
  expect(r.up.meshes.solar.key).toBe('peakLightMasts,wingExtensions');
  // a 10 m mast: the scaffold and the print reveal read this height
  expect(r.up.meshes.solar.top).toBeGreaterThan(r.stock.meshes.solar.top + 7);
  expect(r.up.trackers.wideWings).toBe(1);
  expect(r.up.trackers.wings).toBe(r.stock.trackers.wings);
});

test('doctrine follow-ups are foreclosed with the doctrine they build on', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.completeTech('regenFuelCells');
    g.completeTech('propellantDepot');
    g.advanceGameSeconds(0);
    return g.getResearch().cards;
  });
  expect(r.braytonConverters.state).toBe('foreclosed');
  expect(r.braytonConverters.reason).toBe('foreclosed — needs Thorium Reactor; you chose Regenerative Fuel Cells');
  // transitively: High-Burnup Fuel builds on Brayton, which builds on Thorium
  expect(r.highBurnupFuel.state).toBe('foreclosed');
  expect(r.railCapacitors.state).toBe('foreclosed');
  expect(r.pressureTanks.state).toBe('eraLocked');
  expect(r.cryocoolerHeads.state).toBe('eraLocked');
});

test('classic: a swap keeps each instance\'s light and state, repaints the palette; decals and pools follow', async ({ page }) => {
  await start(page, 'mare'); // Classic is the default style
  const r = await page.evaluate(() => {
    const g = window.__game!;
    const style = g.getRenderInfo().style;
    g.grantResources({ metals: 2000, parts: 500 });
    const ok = [g.placeBuilding('solar', 132, 126), g.placeBuilding('solar', 132, 130), g.placeBuilding('lab', 135, 133)];
    g.finishConstruction();
    // night: the lab's windows burn at the darkness it stands in
    g.advanceGameSeconds(640 - g.getState().simTime);
    g.grantPower(200000);
    g.advanceGameSeconds(1);
    g.stepFrame(0.016);
    const lab = g.getState().buildings.find((b: any) => b.type === 'lab');
    const before = { up: g.getUpgrades(), glow: g.buildingGlow(lab.id) };
    g.completeTech('fieldSpectrometers');
    g.advanceGameSeconds(1);
    g.stepFrame(0.016);
    return { style, ok, before, after: { up: g.getUpgrades(), glow: g.buildingGlow(lab.id) } };
  });
  expect(r.style).toBe('classic');
  expect(r.ok).toEqual([true, true, true]);
  const [a, b] = [r.before.up.meshes.lab, r.after.up.meshes.lab];
  expect(b.key).toBe('fieldSpectrometers');
  expect(b.geometry).not.toBe(a.geometry);
  expect(b.vertices).toBeGreaterThan(a.vertices);
  // the per-instance attributes are the same objects: lit channel, dust, wear, cut, classic glow
  expect(a.glow).not.toBeNull();
  expect(b.state).toBe(a.state);
  expect(b.glow).toBe(a.glow);
  // the classic palette is made for the upgraded recipe, every vertex coloured
  expect(a.colors).toBe(a.vertices);
  expect(b.colors).toBe(b.vertices);
  // the lab still burns at night, as bright as before; its decal and pool stay
  expect(r.before.glow.powered).toBe(1);
  expect(r.before.glow.glow).toBeGreaterThan(0);
  expect(r.after.glow).toEqual(r.before.glow);
  expect(r.after.up.decals).toBe(r.before.up.decals);
  expect(r.after.up.pools).toBe(r.before.up.pools);
});
