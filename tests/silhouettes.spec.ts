/** Silhouettes, family accents on models, and units (docs/19 S2a): every
 *  recipe has its own bounding box, carries its family's accent on a tall
 *  identifier, and the hubs' units and the survey drone are their own models.
 *  Geometry is read from the recipes and the live meshes; nothing here needs a
 *  long run of the game. */
import { test, expect as baseExpect, type Page } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 20_000 });

declare global {
  interface Window { __game?: any }
}

const URL_DEBUG = '/?debug&seed=42&nolock&lowfx';

async function start(page: Page, site: 'mare' | 'southpole' = 'mare') {
  await page.goto(`${URL_DEBUG}&site=${site}&exp=robotic`);
  await page.waitForFunction(() => window.__game !== undefined && window.__game.getState() !== null);
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
}

test('recipes: each has its own bounding box, wears its family accent and carries it up its tall identifier', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(async () => {
    const C = await import('/src/buildings/celBuilding.ts');
    const R = await import('/src/buildings/recipes.ts');
    const F = await import('/src/data/families.ts');
    const B = await import('/src/data/buildings.ts');
    const Color = C.CEL_COLD.constructor as any;
    const hex = (h: number) => { const c = new Color(h); return [c.r, c.g, c.b].map((v: number) => v.toFixed(4)).join(','); };
    const ids = Object.keys(B.BUILDINGS);
    const rows = ids.map((id) => {
      const geo = R.recipeGeometry(id as any);
      const b = geo.boundingBox!;
      const col = C.celColors(geo);
      const c = geo.getAttribute('color'), m = geo.getAttribute('mat');
      const area = geo.userData.partArea as Float32Array;
      const pos = geo.getAttribute('position');
      const accent = hex(F.FAMILY_ACCENT[F.FAMILY_OF[id as keyof typeof F.FAMILY_OF]]);
      /** the colours of the accent vertices (trim parts and bands: a deck is slate), and the highest of them */
      const seen = new Set<string>();
      let accentTop = 0, accentN = 0;
      for (let i = 0; i < c.count; i++) {
        if (C.finishKey(c.getX(i), m.getX(i), m.getY(i), m.getZ(i)) !== 'trim') continue;
        const rgb = [col.getX(i), col.getY(i), col.getZ(i)].map((v) => v.toFixed(4)).join(',');
        if (rgb === hex(C.CEL_PALETTE.deck)) continue; // a big trim part: a deck
        seen.add(rgb);
        accentN++;
        accentTop = Math.max(accentTop, pos.getY(i));
      }
      const size = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
      void area;
      return { id, size, top: b.max.y, accent, colours: [...seen], accentTop, accentN };
    });
    return { rows, count: ids.length };
  });
  // every recipe of the roster (28 buildings, the Prospecting Bay, and whatever joins them)
  expect(r.count).toBeGreaterThanOrEqual(29);
  // distinct boxes: no two recipes agree within half a metre on every axis
  const close: string[] = [];
  for (let i = 0; i < r.rows.length; i++) {
    for (let j = i + 1; j < r.rows.length; j++) {
      const d = Math.max(...[0, 1, 2].map((k) => Math.abs(r.rows[i].size[k] - r.rows[j].size[k])));
      if (d < 0.5) close.push(`${r.rows[i].id} ~ ${r.rows[j].id} (${d.toFixed(2)} m)`);
    }
  }
  expect(close, 'recipes whose bounding boxes nearly coincide').toEqual([]);
  // the accent is the family's, and only the family's
  const off = r.rows.filter((x) => x.colours.length !== 1 || x.colours[0] !== x.accent).map((x) => `${x.id}: ${x.colours.join(' | ')} (wants ${x.accent})`);
  expect(off, 'recipes whose trim is not their family accent').toEqual([]);
  // one tall identifier carries it: an accent vertex reaches into the top half, and the recipe stands over 4 m
  const low = r.rows.filter((x) => x.accentTop < 0.45 * x.top).map((x) => `${x.id} (accent to ${x.accentTop.toFixed(1)} of ${x.top.toFixed(1)} m)`);
  expect(low, 'recipes whose accent stays near the ground').toEqual([]);
  expect(r.rows.filter((x) => x.top < 4.4).map((x) => x.id), 'recipes with no tall identifier').toEqual([]);
});

test('the water plant is its own model, not the smelter\'s hall: a different triangle set, its own bounds', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(async () => {
    const R = await import('/src/buildings/recipes.ts');
    /** the triangles as centroids rounded to 5 cm, as a set */
    const tris = (id: string) => {
      const g = R.recipeGeometry(id as any);
      const p = g.getAttribute('position'), ix = g.index;
      const n = (ix ? ix.count : p.count) / 3;
      const out = new Set<string>();
      for (let t = 0; t < n; t++) {
        let x = 0, y = 0, z = 0;
        for (let k = 0; k < 3; k++) { const i = ix ? ix.getX(t * 3 + k) : t * 3 + k; x += p.getX(i); y += p.getY(i); z += p.getZ(i); }
        out.add([x, y, z].map((v) => (v / 3).toFixed(2)).join(','));
      }
      return { n, set: out, size: g.boundingBox!.getSize(new (g.boundingBox!.min.constructor as any)()).toArray().map((v: number) => +v.toFixed(2)) };
    };
    const w = tris('waterPlant'), s = tris('smelter');
    let shared = 0;
    for (const k of w.set) if (s.set.has(k)) shared++;
    return { water: w.n, smelter: s.n, shared: shared / w.set.size, wSize: w.size, sSize: s.size, tall: w.size[1] };
  });
  expect(r.water).not.toBe(r.smelter);
  expect(r.shared, 'share of the water plant\'s triangles that are also the smelter\'s').toBeLessThan(0.2);
  expect(r.wSize).not.toEqual(r.sSize);
  expect(r.tall, 'the condenser tower stands taller than the smelter hall').toBeGreaterThan(9);
});

test('the three hub units differ in triangles and bounds, wear their liveries, and an ice miner is not an excavator', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(async () => {
    const C = await import('/src/buildings/celBuilding.ts');
    const R = await import('/src/buildings/recipes.ts');
    const F = await import('/src/data/families.ts');
    const Color = C.CEL_COLD.constructor as any;
    const hex = (h: number) => { const c = new Color(h); return [c.r, c.g, c.b].map((v: number) => v.toFixed(4)).join(','); };
    const info = (mk: string) => {
      const g = R.unitRecipeGeometry(mk as any);
      const b = g.boundingBox!;
      const col = C.celColors(g);
      const c = g.getAttribute('color'), m = g.getAttribute('mat');
      const seen = new Set<string>();
      for (let i = 0; i < c.count; i++) {
        const k = C.finishKey(c.getX(i), m.getX(i), m.getY(i), m.getZ(i));
        if (k === 'trim' || k === 'hull') seen.add(`${k}:${[col.getX(i), col.getY(i), col.getZ(i)].map((v) => v.toFixed(4)).join(',')}`);
      }
      const tri = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      return { tri, size: [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map((v) => +v.toFixed(2)), tag: g.userData.recipe, seen: [...seen] };
    };
    const keys = ['excavator:smelter', 'excavator:refinery', 'iceMiner:waterPlant'];
    const units = Object.fromEntries(keys.map((k) => [k, info(k)]));
    const plain = { excavator: info('excavator:pad'), iceRecipe: R.recipeGeometry('iceMiner' as any), excRecipe: R.recipeGeometry('excavator' as any) };
    const tri = (g: any) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    const box = (g: any) => { const b = g.boundingBox; return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map((v: number) => +v.toFixed(2)); };
    const want = Object.fromEntries(keys.map((k) => {
      const l = F.liveryOf(k as any);
      return [k, { trim: `trim:${hex(l.band)}`, hull: `hull:${hex(l.body)}` }];
    }));
    return {
      units, want, plain: { tri: plain.excavator.tri },
      recipes: { ice: { tri: tri(plain.iceRecipe), size: box(plain.iceRecipe) }, exc: { tri: tri(plain.excRecipe), size: box(plain.excRecipe) } },
    };
  });
  const keys = Object.keys(r.units);
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = r.units[keys[i]], b = r.units[keys[j]];
      expect(a.tri, `${keys[i]} and ${keys[j]} draw different triangles`).not.toBe(b.tri);
      const d = Math.max(...[0, 1, 2].map((k) => Math.abs(a.size[k] - b.size[k])));
      expect(d, `${keys[i]} and ${keys[j]} differ in bounds`).toBeGreaterThan(0.05);
    }
  }
  // each is tagged with its unit key and wears its livery: the band on the trim, its own body colour
  for (const k of keys) {
    expect(r.units[k].tag).toBe(k);
    expect(r.units[k].seen, `${k} livery`).toEqual(expect.arrayContaining([r.want[k].trim, r.want[k].hull]));
    expect(r.units[k].tri, `${k} is a modest mesh`).toBeLessThan(1600);
  }
  // an ice miner is not an excavator (the recipe, and the mesh a water plant's unit is drawn with)
  expect(r.recipes.ice.tri).not.toBe(r.recipes.exc.tri);
  expect(r.recipes.ice.size).not.toEqual(r.recipes.exc.size);
  expect(r.units['iceMiner:waterPlant'].tri).not.toBe(r.plain.tri);
});

test('at the pole a water plant prints an ice miner, drawn in its own mesh beside the smelter\'s and the refinery\'s', async ({ page }) => {
  test.setTimeout(120_000);
  await start(page, 'southpole');
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const T = await import('/src/data/techs.ts');
    for (const id of T.TECH_ORDER) {
      const d = T.TECHS[id];
      if (d.effects.some((fx: any) => fx.kind === 'unlock' && ['smelter', 'refinery', 'waterPlant'].includes(fx.building))) g.completeTech(id);
    }
    g.grantResources({ metals: 20000, parts: 6000 });
    const placed: Record<string, boolean> = {};
    for (const [t, ox, oz] of [['smelter', -30, 0], ['refinery', 0, 30], ['waterPlant', 30, 0]] as const) {
      placed[t] = false;
      for (let r = 6; r < 40 && !placed[t]; r++) {
        for (let dx = -r; dx <= r && !placed[t]; dx++) {
          for (const [x, z] of [[127 + ox + dx, 127 + oz - r], [127 + ox + dx, 127 + oz + r], [127 + ox - r, 127 + oz + dx], [127 + ox + r, 127 + oz + dx]]) {
            if (g.placeBuilding(t, x, z, 0)) { placed[t] = true; break; }
          }
        }
      }
    }
    g.finishConstruction();
    g.grantPower(500000);
    g.advanceGameSeconds(5);
    for (let i = 0; i < 4; i++) g.stepFrame(0.05);
    const st = g.getState();
    const kinds = Object.fromEntries((st.haulers ?? []).map((u: any) => [u.id, `${u.type}:${st.buildings.find((b: any) => b.id === u.hub)?.type}`]));
    return { placed, kinds, meshes: g.getRenderInfo().life.haulers.meshes };
  });
  expect(r.placed).toEqual({ waterPlant: true, smelter: true, refinery: true });
  expect(Object.values(r.kinds).sort()).toEqual(['excavator:refinery', 'excavator:smelter', 'iceMiner:waterPlant']);
  const m = r.meshes;
  // the three meshes are the three models, and each holds its own unit
  expect(m['iceMiner:waterPlant'].count).toBe(1);
  expect(m['excavator:smelter'].count).toBe(1);
  expect(m['excavator:refinery'].count).toBe(1);
  const tris = [m['excavator:smelter'].triangles, m['excavator:refinery'].triangles, m['iceMiner:waterPlant'].triangles];
  expect(new Set(tris).size, 'three different triangle counts').toBe(3);
  const sizes = [m['excavator:smelter'].size, m['excavator:refinery'].size, m['iceMiner:waterPlant'].size].map((s: number[]) => s.join('x'));
  expect(new Set(sizes).size, 'three different sizes').toBe(3);
});

test('the survey drone is a flat delta wing with a teal trim, a few hundred triangles at most', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(async () => {
    const V = await import('/src/world/rovers.ts');
    const C = await import('/src/buildings/celBuilding.ts');
    const F = await import('/src/data/families.ts');
    const g = V.surveyDroneGeometry();
    const b = g.boundingBox!;
    C.celColors(g);
    return {
      tag: g.userData.recipe, trim: g.userData.celTrim, teal: F.UNIT_ACCENT.surveyDrone,
      w: b.max.x - b.min.x, h: b.max.y - b.min.y, l: b.max.z - b.min.z, floor: b.min.y,
      tri: (g.index ? g.index.count : g.getAttribute('position').count) / 3,
    };
  });
  expect(r.tag).toBe('surveyDrone');
  expect(r.trim).toBe(r.teal);
  expect(r.tri).toBeLessThan(300);
  // flat: a wing, not a quadcopter's boxy body; skids (here, the wing's underside) at ground level
  expect(r.h).toBeLessThan(0.45 * Math.min(r.w, r.l));
  expect(Math.abs(r.floor)).toBeLessThan(1e-3);
});

test('every palette card and the inspector title wear their family glyph in the family accent', async ({ page }) => {
  await page.goto(`${URL_DEBUG}&site=mare&exp=robotic`);
  await page.waitForFunction(() => window.__game !== undefined && window.__game.getState() !== null);
  const want = await page.evaluate(async () => {
    const F = await import('/src/data/families.ts');
    const B = await import('/src/data/buildings.ts');
    return { glyph: F.FAMILY_GLYPH, css: F.FAMILY_CSS, of: F.FAMILY_OF, order: B.CATEGORY_ORDER, label: B.CATEGORY_LABEL, def: B.BUILDINGS };
  });
  // colour is never the only signal: the glyphs are seven different shapes
  expect(new Set(Object.values(want.glyph)).size).toBe(Object.keys(want.glyph).length);
  for (const cat of want.order as string[]) {
    await page.locator('#palette .cats .btn', { hasText: want.label[cat] }).first().click();
    const cards = await page.locator('#palette .bld-btn[data-type]').evaluateAll((els) => els.map((el) => {
      const fam = el.querySelector('.fam') as HTMLElement | null;
      return { type: (el as HTMLElement).dataset.type, g: fam?.dataset.g, color: fam ? getComputedStyle(fam).color : '', content: fam ? getComputedStyle(fam, '::before').content : '', own: fam?.textContent ?? null };
    }));
    expect(cards.length, `${cat} has cards`).toBeGreaterThan(0);
    for (const c of cards) {
      const f = want.of[c.type!];
      expect(f, `${c.type} is filed under ${cat}`).toBe(cat);
      expect(c.g, `${c.type} glyph`).toBe(want.glyph[f]);
      expect(c.content).toContain(want.glyph[f]);
      const hex = want.css[f] as string;
      const rgb = `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
      expect(c.color, `${c.type} glyph colour`).toBe(rgb);
      // the glyph is generated content: the card's text still reads as before
      expect(c.own).toBe('');
    }
  }
  // the inspector's title
  await page.evaluate(() => { const g = window.__game; const l = g.getState().buildings.find((b: any) => b.type === 'lander'); g.select(l.id); });
  const head = page.locator('#inspector .insp-head .tt-name .fam');
  await expect(head).toHaveAttribute('data-g', want.glyph[want.of.lander]);
});
