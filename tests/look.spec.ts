/** The cel look (docs/19 S1a): the light ramp, the family accents and the
 *  night, checked on the drawn frame — then the destiny's look (docs/14 §4,
 *  phase D4) and its sound (§4.6, D5): the base-wide layers — walkways and conveyor spines that never sit on a road
 *  cell, a door or a bay and cross roads only as skybridges; EVA walkers
 *  that equal the EVA crew and never stand on the carriageway; drones that
 *  fly for the Drone Hive, off the roads and out of the ground traffic —
 *  each structure's warm or cold light, the frame budget of a big Era 8
 *  base in each band, and the score and sounds that follow the lean. */
import { test, expect as baseExpect, type Page } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 20_000 });

declare global {
  interface Window { __game?: any }
}

const URL_DEBUG = '/?debug&seed=42&nolock&lowfx';

async function start(page: Page, exp: 'human' | 'robotic' = 'robotic', extra = '') {
  await page.goto(`${URL_DEBUG}&site=mare${exp === 'robotic' ? '&exp=robotic' : ''}${extra}`);
  await page.waitForFunction(() => window.__game !== undefined && window.__game.getState() !== null);
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
}

const g = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => window.__game[f as string](...(a as unknown[])), [fn, args] as const);

// ─── The cel look (docs/19 S1a): ramp, palette, night ──────────────────────────

/** Pixel tones (0.2126 R + 0.7152 G + 0.0722 B), as a 64-bin histogram (4 levels a bin) of the warm-white
 *  hull pixels inside a screen polygon: the paper hull's hue at any step of the ramp (R − B 8…24, R − G 2…9,
 *  G − B 4…16, bright), so slate roofs, blue glass, accent trim, their antialiased edges and the dark sky
 *  are out. */
async function hullTones(page: Page, poly: { x: number; y: number }[]) {
  const png = await page.screenshot();
  return page.evaluate(async ([b64, pts]) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const w = Math.min(bmp.width, Math.ceil(Math.max(...xs))) - x0, h = Math.min(bmp.height, Math.ceil(Math.max(...ys))) - y0;
    const { data } = ctx.getImageData(x0, y0, w, h);
    // inside a convex polygon: on one side of every edge
    const inside = (px: number, py: number) => {
      let sign = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const cr = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
        if (cr === 0) continue;
        if (sign === 0) sign = Math.sign(cr); else if (Math.sign(cr) !== sign) return false;
      }
      return true;
    };
    const hist = new Array<number>(64).fill(0);
    let n = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!inside(x0 + x + 0.5, y0 + y + 0.5)) continue;
        const i = (y * w + x) * 4;
        const R = data[i], G = data[i + 1], B = data[i + 2];
        const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        if (lum >= 120 && R - B >= 8 && R - B <= 24 && R - G >= 2 && R - G <= 9 && G - B >= 4 && G - B <= 16) { hist[Math.min(63, Math.floor(lum / 4))]++; n++; }
      }
    }
    return { n, hist };
  }, [png.toString('base64'), poly] as const);
}

/** Tone clusters in a histogram: the bins holding at least 4% of the pixels, joined when within three bins. */
function toneClusters(t: { n: number; hist: number[] }): number[] {
  const peaks = t.hist.map((c, i) => (c >= t.n * 0.04 ? i : -1)).filter((i) => i >= 0);
  const groups: number[][] = [];
  for (const i of peaks) {
    const last = groups[groups.length - 1];
    if (last && i - last[last.length - 1] <= 3) last.push(i); else groups.push([i]);
  }
  return groups.map((gr) => gr[0] * 4);
}

/** The smelter's walls in the frame: its footprint's box, projected. Convex hull of the eight corners. */
async function wallPolygon(page: Page, id: number, lift = 3.5) {
  return page.evaluate(([bid, top]) => {
    const g = window.__game!;
    const f = g.footprintOf(bid);
    const pts: { x: number; y: number }[] = [];
    for (const x of [f.x0, f.x1]) for (const z of [f.z0, f.z1]) for (const l of [0, top]) pts.push(g.screenOf(x, z, l));
    // convex hull (monotone chain)
    const P = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o: any, a: any, b: any) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const half = (arr: typeof P) => { const h: typeof P = []; for (const p of arr) { while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop(); h.push(p); } h.pop(); return h; };
    return [...half(P), ...half(P.slice().reverse())];
  }, [id, lift] as const);
}

/** A smelter at a fixed cell, close up from a compass azimuth (degrees), terrain hidden so only the base draws. */
async function smelterView(page: Page, azimDeg: number) {
  await page.evaluate(([az]) => {
    const g = window.__game!;
    const s = g.getState();
    const b = s.buildings.find((q: any) => q.type === 'smelter');
    const f = g.footprintOf(b.id);
    const x = (f.x0 + f.x1) / 2, z = (f.z0 + f.z1) / 2;
    const d = 100, p = 32 * Math.PI / 180, a = az * Math.PI / 180;
    g.setView({ x: x + Math.cos(a) * Math.cos(p) * d, y: Math.sin(p) * d, z: z + Math.sin(a) * Math.cos(p) * d }, { x, y: 0, z });
  }, [azimDeg] as const);
  await page.evaluate(() => new Promise<void>((done) => { let k = 6; const f = () => (--k <= 0 ? done() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
  await page.waitForTimeout(1200);
}

async function smelterBase(page: Page, extra = '') {
  await start(page, 'robotic', extra);
  await page.addStyleTag({ content: '#ui-root { visibility: hidden !important; }' });
  return page.evaluate(() => {
    const g = window.__game!;
    g.openRoads(true);
    for (const t of ['regolithProcessing']) g.completeTech(t);
    g.grantResources({ metals: 5000, parts: 2000 });
    const ok = g.placeBuilding('smelter', 135, 133);
    g.finishConstruction();
    g.advanceGameSeconds(120 - g.getState().simTime); // mid-morning
    return { ok, id: g.getState().buildings.find((q: any) => q.type === 'smelter')?.id as number };
  });
}

test('cel ramp: a building\'s lit faces read as at most three tones (two in variant A), and more than one on some side', async ({ page }) => {
  test.setTimeout(240_000);
  for (const [variant, most] of [['B', 3], ['A', 2], ['C', 3]] as const) {
    const r = await smelterBase(page, `&cel=${variant}`);
    expect(r.ok).toBe(true);
    expect((await g(page, 'getRenderInfo')).ramp, `variant ${variant}'s steps`).toBe(most);
    // only the base draws: no ground, no roads (their tone is the hull's shade to the eye)
    await page.evaluate(() => { window.__game.setTerrainVisible(false); window.__game.setRoadsVisible(false); });
    let widest = 0;
    for (const az of [45, 135, 225]) {
      await smelterView(page, az);
      const t = await hullTones(page, await wallPolygon(page, r.id));
      expect(t.n, `variant ${variant} at ${az}°: the smelter's walls are in view`).toBeGreaterThan(2000);
      const clusters = toneClusters(t);
      test.info().annotations.push({ type: 'tones', description: `${variant} ${az}°: ${clusters.join(', ')}` });
      expect(clusters.length, `variant ${variant} at ${az}°: tones ${clusters}`).toBeLessThanOrEqual(most);
      widest = Math.max(widest, clusters.length);
    }
    // it is a ramp, not one flat tone: some side of the building reads two steps
    expect(widest, `variant ${variant} shows its steps`).toBeGreaterThanOrEqual(2);
  }
});

test('cel palette: a structure\'s trim is its family accent — the smelter\'s is the extraction ochre; the ramp variant is one accessor', async ({ page }) => {
  await start(page, 'robotic', '&cel=A');
  const r = await page.evaluate(async () => {
    const C = await import('/src/buildings/celBuilding.ts');
    const R = await import('/src/buildings/recipes.ts');
    const F = await import('/src/data/families.ts');
    const S = await import('/src/world/celStyle.ts');
    const K = await import('/src/buildings/meshKit.ts');
    const Color = C.CEL_COLD.constructor as any;
    /** the colours the recipe's small trim vertices wear (decks — a trim part with a face over 5 m² — are slate) */
    const trims = (type: string) => {
      const geo = R.recipeGeometry(type as any);
      const col = C.celColors(geo);
      const c = geo.getAttribute('color'), m = geo.getAttribute('mat');
      const area = geo.userData.partArea as Float32Array;
      const seen = new Set<string>();
      for (let i = 0; i < c.count; i++) {
        if (C.finishKey(c.getX(i), m.getX(i), m.getY(i), m.getZ(i)) !== 'trim' || area[i] > 5) continue;
        seen.add([col.getX(i), col.getY(i), col.getZ(i)].map((v) => v.toFixed(4)).join(','));
      }
      return [...seen];
    };
    const hex = (h: number) => { const c = new Color(h); return [c.r, c.g, c.b].map((v: number) => v.toFixed(4)).join(','); };
    const families: Record<string, { trims: string[]; accent: string }> = {};
    for (const id of Object.keys(F.FAMILY_OF)) families[id] = { trims: trims(id), accent: hex(F.FAMILY_ACCENT[F.FAMILY_OF[id]]) };
    return {
      variant: S.celVariant(), ramp: S.ramp().steps, ink: S.ink().px, constant: S.CEL_VARIANT,
      smelter: trims('smelter'), extraction: hex(F.FAMILY_ACCENT.extraction),
      families, wing: (() => { const geo = R.partGeometry('wing'); C.celColors(geo); return geo.userData.celTrim; })(),
      kit: K.TRIM.v,
    };
  });
  // ?cel= reaches every reader through the one accessor (the ramp here, S1b's ink there)
  expect(r).toMatchObject({ variant: 'A', ramp: 2, ink: 2, constant: 'B' });
  expect(r.smelter, 'the smelter wears one trim colour').toEqual([r.extraction]);
  const off = Object.entries(r.families).filter(([, f]) => f.trims.length && (f.trims.length > 1 || f.trims[0] !== f.accent)).map(([id]) => id);
  expect(off, 'buildings whose trim is not their family accent').toEqual([]);
  expect(Object.values(r.families).filter((f) => f.trims.length).length, 'most recipes carry trim').toBeGreaterThanOrEqual(20);
  // the moving parts' frames are bare metal, not an accent
  expect(r.wing).not.toBe(0xd9772b);
});

test('cel night: earthshine holds the open ground well off black; the frame is one forward pass with no post chain', async ({ page }) => {
  test.setTimeout(180_000);
  await start(page, 'robotic');
  await page.addStyleTag({ content: '#ui-root { visibility: hidden !important; }' });
  await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ metals: 3000, parts: 1000 });
    for (const [t, x, z] of [['solar', 132, 126], ['habitat', 126, 132], ['lab', 135, 133], ['storageYard', 121, 132]] as const) g.placeBuilding(t, x, z);
    g.finishConstruction();
    g.grantPower(200000);
    g.advanceGameSeconds(610 - g.getState().simTime); // deep night
    g.grantPower(200000);
    g.advanceGameSeconds(1);
  });
  await page.waitForTimeout(1500);
  const png = await page.screenshot();
  const lums = await page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
    const out: number[] = [];
    for (let i = 0; i < data.length; i += 4 * 7) out.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
    return out.sort((a, b) => a - b);
  }, png.toString('base64'));
  const median = lums[Math.floor(lums.length / 2)];
  test.info().annotations.push({ type: 'night ground', description: `median luminance ${median.toFixed(1)}/255` });
  expect(median, 'median ground luminance at night (of 255)').toBeGreaterThanOrEqual(18);
  const info = await g(page, 'getRenderInfo');
  expect(info.probes.black, 'the black-frame check reads the night ground as lit').toBe(0);
  // one pass, straight to the canvas: no post chain, no render targets, no float buffers
  expect(info).toMatchObject({ style: 'cel', safe: false, ramp: 3 });
  for (const gone of ['postChain', 'targets', 'sceneRenders', 'fxLevel', 'patches', 'shadowTexel']) expect(info, gone).not.toHaveProperty(gone);
  expect(info.context).toMatchObject({ antialias: true, shadowMap: false, toneMapping: 0 });
});

test('cel budget: the seed-42 base draws in at most 80 calls and 300k triangles at home and at the far zoom', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page, 'robotic');
  await page.addStyleTag({ content: '#ui-root { visibility: hidden !important; }' });
  await page.evaluate(async () => {
    const T = await import('/src/data/techs.ts');
    const g = window.__game!;
    g.openRoads(true);
    const taken = new Set<string>();
    for (const t of T.TECH_ORDER) {
      const d = T.TECHS[t];
      if (d.track || d.band) continue;
      if (d.exclusive) { if (taken.has(d.exclusive)) continue; taken.add(d.exclusive); }
      if (d.expeditions && !d.expeditions.includes('robotic')) continue;
      g.completeTech(t);
    }
    g.grantResources({ metals: 60000, parts: 20000, silicon: 20000, chips: 10000, regolith: 20000, foils: 500, water: 5000, food: 5000, oxygen: 5000 });
    const list: [string, number][] = [['solar', 4], ['battery', 2], ['smelter', 1], ['refinery', 1], ['storageYard', 1], ['habitat', 2], ['lab', 1],
      ['relayMast', 1], ['dataCenter', 1], ['partsFab', 1], ['hydroponics', 1], ['massDriver', 1], ['reactor', 1], ['foilFactory', 1], ['roboticsBay', 1], ['recDome', 1]];
    const place = (type: string) => {
      for (let r = 4; r < 40; r++) for (let dx = -r; dx <= r; dx += 2) {
        for (const [x, z] of [[127 + dx, 127 - r], [127 + dx, 127 + r], [127 - r, 127 + dx], [127 + r, 127 + dx]]) if (g.placeBuilding(type, x, z)) return;
      }
    };
    for (const [t, n] of list) for (let i = 0; i < n; i++) place(t);
    g.finishConstruction();
    g.grantPower(500000);
    g.advanceGameSeconds(120 - g.getState().simTime);
    g.grantPower(500000);
    g.advanceGameSeconds(1);
  });
  const frame = async () => {
    await page.evaluate(() => new Promise<void>((done) => { let k = 4; const f = () => (--k <= 0 ? done() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
    await page.waitForTimeout(600);
    return (await g(page, 'getRenderInfo')).frame as { calls: number; triangles: number };
  };
  const home = await frame();
  await page.evaluate(() => {
    const g = window.__game!;
    const c = g.getCamera(), t = c.target, d = 830, p = 32 * Math.PI / 180, a = c.azimuth;
    g.setView({ x: t.x + Math.cos(a) * Math.cos(p) * d, y: Math.sin(p) * d, z: t.z + Math.sin(a) * Math.cos(p) * d }, t);
  });
  const far = await frame();
  test.info().annotations.push({ type: 'frame cost', description: JSON.stringify({ home, far }) });
  for (const [name, f] of Object.entries({ home, far })) {
    expect(f.calls, `${name}: draw calls`).toBeLessThanOrEqual(80);
    expect(f.triangles, `${name}: triangles`).toBeLessThanOrEqual(300_000);
  }
});

/** In the page: the lane tree (one doctrine member each), a band's picks and
 *  capstone, stock, and a base placed round the Lander, band district first. */
async function buildBase(page: Page, band: 'colony' | 'automation' | 'concord', district: [string, number][], core: [string, number][]) {
  return page.evaluate(async ([band, district, core]) => {
    const T = await import('/src/data/techs.ts');
    const g = window.__game!;
    g.openRoads(true);
    const taken = new Set<string>();
    for (const t of T.TECH_ORDER) {
      const d = T.TECHS[t];
      if (d.track || d.band) continue;
      if (d.exclusive) { if (taken.has(d.exclusive)) continue; taken.add(d.exclusive); }
      if (d.expeditions && !d.expeditions.includes('robotic')) continue;
      g.completeTech(t);
    }
    const side = (e: number) => (band === 'colony' ? 'colony' : band === 'automation' ? 'automation' : e % 2 === 0 ? 'colony' : 'automation');
    for (let e = 2; e <= 8; e++) g.pickDestiny(e, side(e));
    g.completeTech(T.CAPSTONES[band as 'colony']);
    g.grantResources({ metals: 60000, parts: 20000, silicon: 20000, chips: 10000, regolith: 20000, foils: 500, water: 5000, food: 5000, oxygen: 5000 });
    const placed: Record<string, number> = {};
    const place = (type: string) => {
      for (let r = 4; r < 40; r++) {
        for (let dx = -r; dx <= r; dx += 2) {
          for (const [x, z] of [[127 + dx, 127 - r], [127 + dx, 127 + r], [127 - r, 127 + dx], [127 + r, 127 + dx]]) {
            if (g.placeBuilding(type, x, z)) { placed[type] = (placed[type] ?? 0) + 1; return; }
          }
        }
      }
    };
    for (const [t, n] of [...district, ...core] as [string, number][]) for (let i = 0; i < n; i++) place(t);
    g.finishConstruction();
    if (band !== 'automation') g.grantCrew(36);
    g.grantPower(500000);
    g.advanceGameSeconds(150 - g.getState().simTime);
    g.grantPower(500000);
    g.advanceGameSeconds(1);
    return { placed, band: g.getDestiny().band };
  }, [band, district, core] as const);
}

const CORE: [string, number][] = [
  ['solar', 6], ['battery', 2], ['excavator', 2], ['smelter', 1], ['refinery', 1], ['storageYard', 1],
  ['partsFab', 1], ['chipFab', 1], ['lab', 1], ['roboticsBay', 1], ['relayMast', 1], ['dataCenter', 1], ['foilFactory', 1],
];
const COLONY: [string, number][] = [['gardenDome', 1], ['greenhouseRing', 2], ['habitat', 5], ['hydroponics', 2], ['recDome', 1], ['lab', 1]];
const AUTOMATION: [string, number][] = [['serverMonolith', 4], ['droneHive', 2], ['dataCenter', 1], ['chipFab', 2], ['partsFab', 2]];

/** The road network and every door, as the links and walkers must respect it. */
const ROADS_AND_DOORS = () => {
  const g = window.__game!;
  const s = g.getState();
  const road = new Map<number, { bay?: boolean; closed?: boolean }>();
  for (const c of s.roads ?? []) road.set(c.gz * 256 + c.gx, c);
  const doors = new Set<number>(g.roadAccess().filter((a: any) => a.door).map((a: any) => a.door[1] * 256 + a.door[0]));
  const lander = s.buildings.find((b: any) => b.type === 'lander');
  const fp = new Set<number>();
  for (const b of s.buildings) {
    const f = g.footprintOf(b.id);
    for (let x = Math.round((f.x0 + 512) / 4); x < Math.round((f.x1 + 512) / 4); x++) {
      for (let z = Math.round((f.z0 + 512) / 4); z < Math.round((f.z1 + 512) / 4); z++) fp.add(z * 256 + x);
    }
  }
  return { road: [...road.entries()], doors: [...doors], fp: [...fp], lander: lander?.id };
};

test('links: walkways join the Colony and spines the Automation; never on a road cell, door or bay; roads crossed only as straight skybridges', async ({ page }) => {
  test.setTimeout(240_000);
  for (const band of ['colony', 'automation'] as const) {
    await start(page);
    // before the pick: no layer at all
    const none = (await g(page, 'getRenderInfo')).life.links;
    expect(none.walkways + none.spines).toBe(0);
    const r = await buildBase(page, band, band === 'colony' ? COLONY : AUTOMATION, CORE);
    expect(r.band).toBe(band);
    await page.evaluate(() => window.__game.stepFrame(0.016));
    const links = (await g(page, 'getRenderInfo')).life.links;
    const net = await page.evaluate(ROADS_AND_DOORS);
    const road = new Map(net.road as [number, { bay?: boolean; closed?: boolean }][]);
    const doors = new Set(net.doors), fp = new Set(net.fp);
    if (band === 'colony') {
      expect(links.walkways, 'walkways join the habitats').toBeGreaterThanOrEqual(4);
      expect(links.spines, 'no Lights-Out Fabs: no spines').toBe(0);
    } else {
      expect(links.spines, 'spines join the industry').toBeGreaterThanOrEqual(3);
      expect(links.walkways, 'no Crew Rotation Charter: no walkways').toBe(0);
    }
    expect(links.triangles.walkway + links.triangles.spine, 'the links mesh stays small').toBeLessThanOrEqual(12_000);
    const seen = new Set<number>();
    for (const l of links.links) {
      l.cells.forEach(([x, z]: [number, number], i: number) => {
        const k = z * 256 + x;
        expect(fp.has(k), `${l.layer} ${l.a}–${l.b} cell ${x},${z} on a footprint`).toBe(false);
        expect(doors.has(k), `${l.layer} ${l.a}–${l.b} cell ${x},${z} on a door`).toBe(false);
        expect(seen.has(k), 'two links share a cell').toBe(false);
        seen.add(k);
        const c = road.get(k);
        // on the ground only off the roads; over a road only as a bridge, never over a bay or the apron
        expect(!!c, `${l.layer} ${l.a}–${l.b} cell ${x},${z}: bridged ⇔ a road cell`).toBe(l.over[i]);
        if (c) {
          expect(c.bay || c.closed, 'a bay or the apron bridged').toBeFalsy();
          // a bridge spans at most two road cells, straight across
          const run = l.over.slice(Math.max(0, i - 2), i + 1);
          expect(run.every(Boolean) && run.length === 3, 'a span of three road cells').toBe(false);
          if (i > 0 && i < l.cells.length - 1) {
            const [px, pz] = l.cells[i - 1], [nx, nz] = l.cells[i + 1];
            expect(px === nx || pz === nz, 'a bend over a road').toBe(true);
          }
        }
      });
    }
  }
});

test('walkers: one per EVA crew, by day only; always on open ground — never a road cell, never a footprint', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page);
  await buildBase(page, 'colony', COLONY, CORE);
  // live frames at 10×: the sim ticks, the walkers lope
  await page.evaluate(() => { window.__game.setSpeed(10); window.__game.setPaused(false); window.__game.stepFrame(0.1); });
  const samples: { eva: number; out: number; onRoad: number; onFootprint: number; cells: [number, number][] }[] = [];
  for (let i = 0; i < 30; i++) {
    samples.push(await page.evaluate(() => {
      const g = window.__game!;
      for (let k = 0; k < 4; k++) g.stepFrame(0.1);
      const w = g.getRenderInfo().life.settlers;
      return { eva: g.getState().evaCrew, out: w.out, onRoad: w.onRoad, onFootprint: w.onFootprint, cells: w.cells };
    }));
  }
  const net = await page.evaluate(ROADS_AND_DOORS);
  const road = new Set((net.road as [number, unknown][]).map(([k]) => k));
  expect(samples[0].eva, 'an EVA crew by day').toBeGreaterThan(0);
  for (const s of samples) {
    expect(s.out, 'walkers = EVA crew').toBe(Math.min(24, s.eva));
    expect(s.onRoad, 'a walker on the carriageway').toBe(0);
    expect(s.onFootprint, 'a walker inside a structure').toBe(0);
    for (const [x, z] of s.cells) expect(road.has(z * 256 + x)).toBe(false);
  }
  // they walk: positions change over the run
  const moved = await page.evaluate(() => {
    const g = window.__game!;
    const a = g.getRenderInfo().life.settlers.positions;
    for (let k = 0; k < 20; k++) g.stepFrame(0.1);
    const b = g.getRenderInfo().life.settlers.positions;
    return a.some((p: number[], i: number) => b[i] && Math.hypot(p[0] - b[i][0], p[1] - b[i][1]) > 0.5);
  });
  expect(moved).toBe(true);
  // nightfall: no EVA crew, and everyone walks home and goes in
  await page.evaluate(async () => {
    const g = window.__game!;
    const B = await import('/src/data/balance.ts');
    g.setPaused(true);
    g.setSpeed(3);
    g.stepFrame(0.1);
    // the next nightfall, a few seconds in
    const t = g.getState().simTime;
    let night = Math.floor(t / B.CYCLE_S) * B.CYCLE_S + B.DAY_S + 5;
    if (night < t) night += B.CYCLE_S;
    g.advanceGameSeconds(night - t);
    g.setPaused(false);
  });
  await expect.poll(async () => page.evaluate(() => {
    const g = window.__game!;
    for (let k = 0; k < 10; k++) g.stepFrame(0.1);
    const w = g.getRenderInfo().life.settlers;
    return { eva: g.getState().evaCrew, drawn: w.drawn, onRoad: w.onRoad };
  }), { timeout: 60_000 }).toEqual({ eva: 0, drawn: 0, onRoad: 0 });
});

test('drones: a Drone Hive\'s units fly — off the roads, out of the ground traffic — while ground rovers keep to the roads', async ({ page }) => {
  test.setTimeout(180_000);
  await start(page);
  const r = await page.evaluate(async () => {
    const g = window.__game!;
    const F = await import('/src/core/fleet.ts');
    g.openRoads(true);
    g.completeTech('droneHives');
    g.grantResources({ metals: 3000, parts: 1000 });
    let ok = false;
    for (let rr = 5; rr < 30 && !ok; rr++) {
      for (let dx = -rr; dx <= rr && !ok; dx += 2) ok = g.placeBuilding('droneHive', 127 + dx, 127 - rr) || g.placeBuilding('droneHive', 127 + dx, 127 + rr);
    }
    g.finishConstruction();
    g.advanceGameSeconds(2);
    const s = g.getState();
    const hive = s.buildings.find((b: any) => b.type === 'droneHive');
    const kinds = s.rovers.map((u: any) => F.unitKind(s, u));
    return { ok, hive: hive?.id, kinds, homes: s.rovers.map((u: any) => u.home) };
  });
  expect(r.ok).toBe(true);
  expect(r.kinds.filter((k: string) => k === 'drone')).toHaveLength(4);
  expect(r.kinds.filter((k: string) => k === 'rover')).toHaveLength(2); // the Lander's
  // perched on the deck; the ground layer has only the Lander's rovers
  await page.evaluate(() => { window.__game.stepFrame(0.1); window.__game.stepFrame(0.1); });
  let info = (await g(page, 'getRenderInfo')).life;
  expect(info.rovers.drones.count).toBe(4);
  expect(info.rovers.count, 'ground rovers').toBe(2);
  const inTraffic = info.traffic.units.filter((u: any) => u.kind === 'rover').map((u: any) => u.id);
  expect(inTraffic.filter((id: number) => info.rovers.drones.ids.includes(id)), 'a drone in the ground traffic').toEqual([]);
  // a far site: the hive's drones take off and fly there, cruising well above the ground
  await page.evaluate(() => {
    const g = window.__game!;
    g.openRoads(false);
    g.grantResources({ metals: 3000, parts: 1000 });
    let ok = false;
    for (let rr = 12; rr < 30 && !ok; rr++) ok = g.placeBuilding('lab', 127 + rr, 127) || g.placeBuilding('lab', 127 - rr, 127);
    g.setSpeed(3);
    g.setPaused(false);
  });
  let peak = 0;
  for (let i = 0; i < 40; i++) {
    const d = await page.evaluate(() => { const g = window.__game!; for (let k = 0; k < 3; k++) g.stepFrame(0.1); return g.getRenderInfo().life.rovers.drones; });
    peak = Math.max(peak, ...d.heights);
    if (peak > 5.5) break;
  }
  expect(peak, 'drones cruise 6–10 m up').toBeGreaterThan(5.5);
  info = (await g(page, 'getRenderInfo')).life;
  expect(info.rovers.drones.flying).toBeGreaterThan(0);
  // the ground rovers stay on road cells, the drones need none
  const onRoad = await page.evaluate(() => {
    const g = window.__game!;
    const s = g.getState();
    const road = new Set<number>((s.roads ?? []).map((c: any) => c.gz * 256 + c.gx));
    const pos = g.getRenderInfo().life.rovers.positions as [number, number][];
    const inside = g.getRenderInfo().life.rovers.inside as boolean[];
    return pos.filter((_, i) => !inside[i]).every(([x, z]) => road.has(Math.floor((z + 512) / 4) * 256 + Math.floor((x + 512) / 4)));
  });
  expect(onRoad).toBe(true);
});

test('light: homes burn warm and machines cold whatever the lean; the rest follow it; the alarm hook reaches the instance', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.openRoads(true);
    for (const t of ['habitation', 'lunarDataCenter', 'regolithProcessing', 'humanCohabitation']) g.completeTech(t);
    g.grantResources({ metals: 5000, parts: 2000, silicon: 1000, chips: 500 });
    const place = (type: string) => {
      for (let rr = 4; rr < 30; rr++) for (let dx = -rr; dx <= rr; dx += 2) {
        if (g.placeBuilding(type, 127 + dx, 127 - rr) || g.placeBuilding(type, 127 + dx, 127 + rr)) return;
      }
    };
    for (const t of ['habitat', 'dataCenter', 'smelter']) place(t);
    g.finishConstruction();
    g.advanceGameSeconds(1);
    const id = (t: string) => g.getState().buildings.find((b: any) => b.type === t).id;
    const look = () => ({ hab: g.buildingLook(id('habitat')), dc: g.buildingLook(id('dataCenter')), smelter: g.buildingLook(id('smelter')) });
    const robotic = look();
    for (let e = 2; e <= 8; e++) g.pickDestiny(e, 'automation');
    g.advanceGameSeconds(1);
    const auto = look();
    return { robotic, auto };
  });
  expect(r.robotic.hab.warm).toBe(1);
  expect(r.robotic.dc.warm).toBe(0);
  expect(r.robotic.smelter.lean).toBeCloseTo(-0.25, 5); // the robotic landing: A 1, C 0
  expect(r.robotic.smelter.warm).toBeCloseTo(0.5, 5);
  expect(r.auto.hab.warm).toBe(1);
  expect(r.auto.dc.warm).toBe(0);
  expect(r.auto.smelter.lean).toBe(-1);
  expect(r.auto.smelter.warm).toBe(0);
  expect(r.auto.smelter.alarm).toBe(0);
  // the hazards' hook: a structure's alarm into its instance
  const alarm = await page.evaluate(() => {
    const g = window.__game!;
    const id = g.getState().buildings.find((b: any) => b.type === 'smelter').id;
    g.setAlarmHook((b: any) => (b.id === id ? 1 : 0));
    g.advanceGameSeconds(1);
    const on = g.buildingLook(id).alarm;
    g.setAlarmHook(null);
    g.advanceGameSeconds(1);
    return { on, off: g.buildingLook(id).alarm };
  });
  expect(alarm).toEqual({ on: 1, off: 0 });
});

for (const style of ['cel']) {
  test(`${style}: an Era 8 base in each band stays within the frame budget`, async ({ page }) => {
    test.setTimeout(300_000);
    const out: Record<string, { calls: number; triangles: number }> = {};
    for (const band of ['colony', 'automation', 'concord'] as const) {
      await start(page, 'robotic', `&style=${style}`);
      const district = band === 'colony' ? COLONY : band === 'automation' ? AUTOMATION
        : [['habitat', 3], ['hydroponics', 1], ['droneHive', 1], ['serverMonolith', 2]] as [string, number][];
      await buildBase(page, band, district, CORE);
      await page.evaluate(() => {
        const g = window.__game!;
        const t = { x: 8, z: 8 }, d = 290, p = 32 * Math.PI / 180, a = Math.PI / 4;
        g.setView({ x: t.x + Math.cos(a) * Math.cos(p) * d, y: Math.sin(p) * d, z: t.z + Math.sin(a) * Math.cos(p) * d }, { x: t.x, y: 0, z: t.z });
      });
      await page.waitForTimeout(1500);
      out[band] = (await g(page, 'getRenderInfo')).frame;
    }
    test.info().annotations.push({ type: 'frame cost', description: JSON.stringify(out) });
    console.log(`[era 8 frame cost · ${style}]`, JSON.stringify(out));
    for (const [band, f] of Object.entries(out)) {
      expect(f.calls, `${band}: draw calls`).toBeLessThan(90);
      expect(f.triangles, `${band}: triangles`).toBeLessThan(600_000);
    }
  });
}

test('audio: the score follows the lean, and the destiny\'s sounds play (modem chirp, squelch; rotors near the hive)', async ({ page }) => {
  test.setTimeout(180_000);
  await start(page);
  await page.locator('#palette .cats .btn', { hasText: 'Power' }).click(); // the gesture that unlocks audio
  await expect.poll(async () => (await g(page, 'getAudio')).music?.playing ?? false).toBe(true);
  // the robotic landing alone: a lean of −¼, Concord's score (as it always was)
  await page.evaluate(() => window.__game.setPaused(false));
  await expect.poll(async () => (await g(page, 'getAudio')).life.lean).toBeCloseTo(-0.25, 5);
  expect((await g(page, 'getAudio')).music.destiny).toBe('concord');
  // three Colony picks: the lean tips to the colony
  await page.evaluate(() => { const g = window.__game!; g.pickDestiny(2, 'colony'); g.pickDestiny(3, 'colony'); g.pickDestiny(4, 'colony'); });
  await expect.poll(async () => (await g(page, 'getAudio')).music.destiny).toBe('colony');
  // the new cues play through the same buses
  const before = (await g(page, 'getAudio')).played;
  await page.evaluate(() => { window.__game.playCue('modem'); window.__game.playCue('squelch'); });
  const after = (await g(page, 'getAudio')).played;
  expect(after.modem).toBe(before.modem + 1);
  expect(after.squelch).toBe(before.squelch + 1);
  const out = (await g(page, 'getAudio')).output;
  expect(out.peakDb).toBeLessThan(0); // the limiter holds
  // an Automation base: the score turns to the machines, and a hive's rotors are heard at home
  await start(page);
  await page.locator('#palette .cats .btn', { hasText: 'Power' }).click();
  await page.evaluate(() => {
    const g = window.__game!;
    g.openRoads(true);
    for (let e = 2; e <= 4; e++) g.pickDestiny(e, 'automation');
    g.grantResources({ metals: 3000, parts: 1000 });
    let ok = false;
    for (let rr = 4; rr < 20 && !ok; rr++) for (let dx = -rr; dx <= rr && !ok; dx += 2) ok = g.placeBuilding('droneHive', 127 + dx, 127 - rr);
    g.finishConstruction();
    g.setPaused(false);
  });
  await expect.poll(async () => (await g(page, 'getAudio')).music.destiny, { timeout: 30_000 }).toBe('automation');
  await expect.poll(async () => (await g(page, 'getAudio')).life.rotor, { timeout: 30_000 }).toBe(true);
  // an Automation hazard starts with the modem chirp
  const modem = (await g(page, 'getAudio')).played.modem;
  expect(await g(page, 'forceHazard', 'malware')).toEqual(expect.any(Number));
  await expect.poll(async () => (await g(page, 'getAudio')).played.modem, { timeout: 30_000 }).toBeGreaterThan(modem);
});

test('hazard looks: infected flicker, a cascade goes dark, blight tints, a breach plumes; bricked rovers sit dark, held drones land', async ({ page }) => {
  test.setTimeout(180_000);
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.openRoads(true);
    for (const t of ['habitation', 'humanCohabitation', 'regolithProcessing', 'droneHives']) g.completeTech(t);
    g.grantResources({ metals: 5000, parts: 2000 });
    const place = (type: string) => {
      for (let rr = 4; rr < 30; rr++) for (let dx = -rr; dx <= rr; dx += 2) {
        if (g.placeBuilding(type, 127 + dx, 127 - rr) || g.placeBuilding(type, 127 + dx, 127 + rr)) return;
      }
    };
    for (const t of ['habitat', 'smelter', 'hydroponics', 'droneHive']) place(t);
    g.finishConstruction();
    g.grantPower(50000);
    g.advanceGameSeconds(2);
    const id = (t: string) => g.getState().buildings.find((b: any) => b.type === t).id;
    const hab = id('habitat'), smelter = id('smelter'), farm = id('hydroponics');
    const calm = { hab: g.buildingGlow(hab), smelter: g.buildingLook(smelter) };
    // the renderer's side of the hazards' fx hooks
    g.setHazardFx({ [hab]: ['dark', 'vent'], [smelter]: ['flicker'], [farm]: ['blight'] });
    g.advanceGameSeconds(1);
    for (let k = 0; k < 8; k++) g.stepFrame(0.1); // the plume sources refresh twice a second
    const info = g.getRenderInfo();
    const hot = {
      hab: g.buildingGlow(hab), smelter: g.buildingLook(smelter),
      plumes: info.life.plumes, pools: info.base.discs,
    };
    g.setHazardFx(null);
    g.advanceGameSeconds(1);
    for (let k = 0; k < 8; k++) g.stepFrame(0.1);
    const after = { hab: g.buildingGlow(hab), smelter: g.buildingLook(smelter), plumes: g.getRenderInfo().life.plumes };
    return { calm, hot, after, hab };
  });
  expect(r.calm.hab.powered).toBe(1);
  expect(r.calm.smelter.alarm).toBe(0);
  expect(r.hot.hab.powered, 'a cascade: the habitat goes dark').toBe(0);
  expect(r.hot.smelter.alarm, 'infected: its lights flicker').toBe(1);
  expect(r.hot.plumes, 'a breach vents').toEqual([{ id: r.hab, vent: true }]);
  expect(r.after.hab.powered).toBe(1);
  expect(r.after.smelter.alarm).toBe(0);
  expect(r.after.plumes).toEqual([]);
  // a bricked drone sits dark on the ground where it was; a held one lands and waits
  const d = await page.evaluate(() => {
    const g = window.__game!;
    g.stepFrame(0.1);
    const drones = g.getRenderInfo().life.rovers.drones;
    const now = g.getState().simTime;
    g.patchRover(drones.ids[0], { brickedUntil: now + 300 });
    g.patchRover(drones.ids[1], { heldUntil: now + 300 });
    for (let k = 0; k < 20; k++) g.stepFrame(0.1);
    const after = g.getRenderInfo().life.rovers.drones;
    const rover = g.getState().rovers.find((u: any) => !drones.ids.includes(u.id));
    g.patchRover(rover.id, { brickedUntil: now + 300 });
    for (let k = 0; k < 3; k++) g.stepFrame(0.1);
    return { ids: drones.ids, after, rover: rover.id, dark: g.getRenderInfo().life.rovers.dark };
  });
  expect(d.after.dark).toEqual([d.ids[0]]);
  expect(d.after.down).toEqual(expect.arrayContaining([d.ids[0], d.ids[1]]));
  expect(d.dark, 'a bricked ground rover sits dark').toContain(d.rover);
});
