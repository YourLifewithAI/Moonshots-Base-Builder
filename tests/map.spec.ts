/** Local deposits and the Lunar Map sim (docs/11-research-and-map-spec.md
 *  §5, §9 tests 15–19): reveal by tier, feed grade, deposit gating, the
 *  Relay Mast network, the large-pad rule, surveys, breakthroughs, outposts
 *  and save migration rule 7. Drives the sim through window.__game (?debug). */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

const URL_DEBUG = '/?debug&seed=42&nolock&lowfx';

async function start(page: Page, site: string, exp: 'human' | 'robotic' = 'human') {
  await page.goto(`${URL_DEBUG}&site=${site}${exp === 'robotic' ? '&exp=robotic' : ''}`);
  await page.waitForFunction(() => window.__game !== undefined);
  // game time moves only through the fast-forwards: every reading lands on a known tick
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
  await page.evaluate(HELPERS);
}

const complete = (page: Page, techs: string[]) =>
  page.evaluate((ts) => { for (const t of ts) window.__game.completeTech(t); }, techs);

const hasAlert = (s: any, re: RegExp) => s.alerts.some((a: any) => re.test(a.text));

/** In-page helpers:
 *  powered(secs) — advance with the bank topped up every 10 s;
 *  cellAt(x, z, w, d) — the footprint origin centred on a world point;
 *  centreOf(gx, gz, w, d) — the world centre of a footprint;
 *  near(type, x, z, test?) — the valid cell nearest a world point (optionally
 *  also passing test(cx, cz)), or null;
 *  fromLander(x, z) — metres from the Lander's centre (−2, −2). */
declare function powered(secs: number): void;
const HELPERS = `(() => {
window.powered = (secs) => {
  const g = window.__game;
  for (let t = 0; t < secs; t += 10) { g.grantPower(5000); g.advanceGameSeconds(Math.min(10, secs - t)); }
};
window.cellAt = (x, z, w = 2, d = 2) => ({ gx: Math.round((x + 512) / 4 - w / 2), gz: Math.round((z + 512) / 4 - d / 2) });
window.centreOf = (gx, gz, w = 2, d = 2) => [(gx + w / 2) * 4 - 512, (gz + d / 2) * 4 - 512];
window.fromLander = (x, z) => Math.hypot(x + 2, z + 2);
window.near = (type, x, z, test, w = 2, d = 2) => {
  const g = window.__game;
  const c = window.cellAt(x, z, w, d);
  const cells = [];
  for (let dx = -12; dx <= 12; dx++) for (let dz = -12; dz <= 12; dz++) cells.push([c.gx + dx, c.gz + dz]);
  cells.sort((a, b) => Math.hypot(a[0] - c.gx, a[1] - c.gz) - Math.hypot(b[0] - c.gx, b[1] - c.gz));
  for (const [gx, gz] of cells) {
    const [cx, cz] = window.centreOf(gx, gz, w, d);
    if (test && !test(cx, cz)) continue;
    if (g.canPlace(type, gx, gz).valid) return { gx, gz, cx, cz };
  }
  return null;
};
})()`;
declare function cellAt(x: number, z: number, w?: number, d?: number): { gx: number; gz: number };
declare function centreOf(gx: number, gz: number, w?: number, d?: number): [number, number];
declare function fromLander(x: number, z: number): number;
declare function near(type: string, x: number, z: number, test?: (cx: number, cz: number) => boolean,
  w?: number, d?: number): { gx: number; gz: number; cx: number; cz: number } | null;

test('deposits reveal by tier: 120 m at landing, 320 m with rovers, the whole map from orbit', async ({ page }) => {
  await start(page, 'mare');
  const d0 = await page.evaluate(() => window.__game.getDeposits());
  const dist = (d: any) => Math.hypot(d.x + 2, d.z + 2);
  // the guaranteed high-Ti patch is mapped at landing, close by
  const home = d0.find((d: any) => d.kind === 'ilmenite' && d.revealed && dist(d) <= 55);
  expect(home).toBeTruthy();
  expect(home.inNetwork).toBe(true);
  expect(home.label).toBe('high-Ti basalt');
  // everything mapped touches the 120 m ring; beyond it, '?' leads
  for (const d of d0) expect(d.revealed).toBe(dist(d) - d.r <= 120);
  const leads = d0.filter((d: any) => d.lead);
  expect(leads.some((d: any) => Math.hypot(d.lead.x + 2, d.lead.z + 2) > 120)).toBe(true);
  for (const d of leads) {
    expect(d.glyph).toBe('?');
    expect(Math.hypot(d.lead.x - d.x, d.lead.z - d.z)).toBeLessThanOrEqual(10); // jittered, not exact
    // orbital data hints ilmenite, anorthosite and KREEP; the rest are unknown
    expect(d.label).toBe(d.kind === 'ilmenite' ? '? possible high-Ti basalt' : '? unknown');
  }
  // Prospecting Rovers: 320 m, announced
  await complete(page, ['prospectingRovers']);
  const s1 = await page.evaluate(() => window.__game.getState());
  const d1 = await page.evaluate(() => window.__game.getDeposits());
  for (const d of d1) expect(d.revealed).toBe(dist(d) - d.r <= 320);
  expect(d1.filter((d: any) => d.revealed).length).toBeGreaterThan(d0.filter((d: any) => d.revealed).length);
  expect(hasAlert(s1, /^DEPOSITS MAPPED — .+ · overlay \[I\]$/)).toBe(true);
  // Orbital Prospector: the whole 1 km map, no leads left
  await complete(page, ['orbitalProspector']);
  const d2 = await page.evaluate(() => window.__game.getDeposits());
  expect(d2.every((d: any) => d.revealed && d.lead === null)).toBe(true);
  // the overlay chip and [I] toggle need no survey any more
  const chip = page.locator('#resource-strip .chip[data-key="deposits"]');
  await expect(chip).toHaveText('◎DEPOSITS [I]');
  await expect(chip).not.toHaveClass(/warn/);
  await page.keyboard.press('i');
  await expect(chip).toHaveClass(/warn/);
  await expect(page.locator('.deposit-mark').first()).toBeAttached();
  await page.keyboard.press('i');
  await expect(chip).not.toHaveClass(/warn/);
  await expect(page.locator('.deposit-mark')).toHaveCount(0);
});

/** metals/s of one smelter fed by one excavator, on the deposit or off it */
async function smelterRun(page: Page, onDeposit: boolean) {
  await start(page, 'mare');
  return page.evaluate((on) => {
    const g = window.__game!;
    g.completeTech('regolithProcessing');
    g.grantResources({ regolith: 200, metals: 150, parts: 50 });
    const dep = g.getDeposits().find((d: any) => d.kind === 'ilmenite' && d.revealed && d.inNetwork);
    for (const [x, z] of [[14, -2], [14, 8]]) {
      const c = near('solar', x, z);
      g.placeBuilding('solar', c!.gx, c!.gz);
    }
    const sm = near('smelter', -2, 16, undefined, 3, 2);
    g.placeBuilding('smelter', sm!.gx, sm!.gz);
    const ex = on
      ? near('excavator', dep.x, dep.z, (x, z) => g.depositAt(x, z)?.id === dep.id)
      : near('excavator', -20, -2, (x, z) => g.depositAt(x, z) === null);
    g.placeBuilding('excavator', ex!.gx, ex!.gz);
    powered(240 - g.getState().simTime); // everything is built by now
    powered(60);
    const smelter = g.getState().buildings.find((b: any) => b.type === 'smelter');
    const excavator = g.getState().buildings.find((b: any) => b.type === 'excavator');
    const m0 = g.getState().stats.produced.metals;
    powered(60);
    const s = g.getState();
    return { feed: s.feed, rate: (s.stats.produced.metals - m0) / 60, smelter, excavator };
  }, onDeposit);
}

test('feed grade: an excavator on high-Ti basalt lifts the smelter 30%', async ({ page }) => {
  const off = await smelterRun(page, false);
  expect(off.excavator.deposit).toBeUndefined();
  expect(off.smelter.active).toBe(true);
  expect(off.feed.plain).toBeCloseTo(1, 9);
  const on = await smelterRun(page, true);
  expect(on.excavator.deposit).toBe('ilmenite');
  expect(on.smelter.active).toBe(true);
  // the delivered loads' share: every load came off the deposit
  expect(on.feed.ilmenite).toBeCloseTo(1, 9);
  expect(on.feed.plain).toBe(0);
  expect(on.rate / off.rate).toBeGreaterThan(1.27);
  expect(on.rate / off.rate).toBeLessThan(1.33);
  // the inspector names the feed and the yield
  await page.evaluate((id) => window.__game.select(id), on.smelter.id);
  await expect(page.locator('#insp-feed')).toHaveText('Feed (recent loads): 100% high-Ti → yield +30%');
  // stats.ilmeniteDigS counts the excavator's seconds on the deposit
  const st = await page.evaluate(() => window.__game.getState());
  expect(st.stats.ilmeniteDigS).toBeGreaterThan(100);
  // nothing delivered keeps the last feed: shut the excavator down and tick on
  const kept = await page.evaluate((id) => {
    const g = window.__game!;
    g.setEnabled(id, false);
    powered(20);
    return g.getState().feed;
  }, on.excavator.id);
  expect(kept.ilmenite).toBeCloseTo(1, 9);
});

test('deposit gating: ice must be confirmed, KREEP takes no habitat, a strike maps the ground', async ({ page }) => {
  // the pole: a harvester on ice beyond the survey is refused, and the reason names the fix
  await start(page, 'southpole');
  await complete(page, ['iceExtraction']);
  const far = await page.evaluate(() => {
    const g = window.__game!;
    const d = g.getDeposits().find((x: any) => x.kind === 'ice' && !x.revealed);
    const c = cellAt(d.x, d.z);
    return { id: d.id, dist: fromLander(d.x, d.z) - d.r, check: g.canPlace('iceHarvester', c.gx, c.gz) };
  });
  expect(far.dist).toBeGreaterThan(120);
  expect(far.check.valid).toBe(false);
  expect(far.check.reason).toBe('ICE UNCONFIRMED — extend your survey (Prospecting Rovers) or place a Relay Mast nearby');
  // unmapped ground reads the same with or without ice under it: no free hints
  const bare = await page.evaluate(() => {
    const g = window.__game!;
    for (let r = 200; r < 420; r += 8) {
      for (let a = 0; a < Math.PI * 2; a += 0.3) {
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (g.depositAt(x, z) !== null) continue;
        const c = cellAt(x, z);
        const [cx, cz] = centreOf(c.gx, c.gz);
        if (g.depositAt(cx, cz) === null) return g.canPlace('iceHarvester', c.gx, c.gz).reason;
      }
    }
    return 'no bare ground';
  });
  expect(bare).toBe(far.check.reason);
  // with Prospecting Rovers the survey reaches it: the ice rule passes (the network does not yet)
  await complete(page, ['prospectingRovers']);
  const later = await page.evaluate((id) => {
    const g = window.__game!;
    const d = g.getDeposits().find((x: any) => x.id === id);
    const c = cellAt(d.x, d.z);
    return { revealed: d.revealed, reason: g.canPlace('iceHarvester', c.gx, c.gz).reason };
  }, far.id);
  expect(later.revealed).toBe(true);
  expect(later.reason).not.toMatch(/ICE UNCONFIRMED|No ice beneath/); // what remains is range or terrain

  // the lava tube: KREEP soil is radioactive ground for a habitat
  await start(page, 'lavatube');
  const kreep = await page.evaluate(() => {
    const g = window.__game!;
    const d = g.getDeposits().find((x: any) => x.kind === 'kreep');
    const c = cellAt(d.x, d.z);
    return { habitat: g.canPlace('habitat', c.gx, c.gz).reason, solar: g.canPlace('solar', c.gx, c.gz).reason };
  });
  expect(kreep.habitat).toBe('RADIATION — KREEP soil: no habitats here');
  expect(kreep.solar).not.toContain('RADIATION');

  // the mare: habitats carry the network past the survey; building on the
  // unmapped deposit there strikes it
  await start(page, 'mare');
  const struck = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ metals: 300, parts: 100 });
    const target = g.getDeposits()
      .filter((d: any) => !d.revealed && fromLander(d.x, d.z) - d.r < 160)
      .sort((a: any, b: any) => fromLander(a.x, a.z) - fromLander(b.x, b.z))[0];
    const u = [(target.x + 2) / fromLander(target.x, target.z), (target.z + 2) / fromLander(target.x, target.z)];
    for (const reach of [52, 104]) {
      const h = near('habitat', -2 + u[0] * reach, -2 + u[1] * reach, (x, z) => g.depositAt(x, z) === null);
      g.placeBuilding('habitat', h!.gx, h!.gz);
      powered(120);
    }
    const ex = near('excavator', target.x, target.z, (x, z) => g.depositAt(x, z)?.id === target.id);
    g.placeBuilding('excavator', ex!.gx, ex!.gz);
    g.advanceGameSeconds(0);
    const s = g.getState();
    return {
      target, s, excavator: s.buildings.find((b: any) => b.type === 'excavator'),
      after: g.getDeposits().find((d: any) => d.id === target.id),
    };
  });
  expect(struck.s.survey.struck).toContain(struck.target.id);
  expect(struck.after.revealed).toBe(true);
  expect(struck.excavator.deposit).toBe(struck.target.kind);
  expect(hasAlert(struck.s, new RegExp(`^PROSPECT STRUCK — Regolith Excavator #${struck.excavator.id} is on .+ \\(.+\\)$`))).toBe(true);
});

test('relay mast: the network extends 45 m from a completed mast, masts chain, and a mast maps its ground', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  await complete(page, ['prospectingRovers']);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ metals: 200, parts: 60 });
    const dep = g.getDeposits().find((d: any) => d.kind === 'ilmenite' && fromLander(d.x, d.z) < 55);
    const k = fromLander(dep.x, dep.z);
    const u = [(dep.x + 2) / k, (dep.z + 2) / k];
    const at = (m: number) => [-2 + u[0] * m, -2 + u[1] * m];
    const reason = (m: number) => { const c = cellAt(at(m)[0], at(m)[1]); return g.canPlace('solar', c.gx, c.gz).reason; };
    const before = reason(95);
    const m1 = near('relayMast', at(55)[0], at(55)[1], (x, z) => fromLander(x, z) <= 58, 1, 1);
    g.placeBuilding('relayMast', m1!.gx, m1!.gz);
    g.advanceGameSeconds(1);
    const building = reason(95);          // a mast under construction extends nothing
    powered(60);
    const s1 = g.getState();
    const mast = s1.buildings.find((b: any) => b.type === 'relayMast');
    const solar95 = near('solar', at(95)[0], at(95)[1], (x, z) => Math.abs(fromLander(x, z) - 95) <= 3);
    // chain: a second mast at the new edge carries the network on
    const reason140 = reason(140);
    const m2 = near('relayMast', at(98)[0], at(98)[1], undefined, 1, 1);
    g.placeBuilding('relayMast', m2!.gx, m2!.gz);
    powered(60);
    const solar135 = near('solar', at(135)[0], at(135)[1], (x, z) => Math.abs(fromLander(x, z) - 135) <= 3);
    const mastXZ = centreOf(mast.gx, mast.gz, 1, 1);
    const within = g.getDeposits().filter((d: any) =>
      Math.hypot(d.x - mastXZ[0], d.z - mastXZ[1]) - d.r <= 45).map((d: any) => d.id);
    return { before, building, mast, solar95, reason140, solar135, within, s: g.getState(), lunar: g.getLunar() };
  });
  expect(r.before).toBe('Beyond 60 m of the Lander');
  expect(r.building).toBe('Beyond 60 m of the Lander');
  expect(r.mast.construction).toBe(0);
  expect(r.solar95).not.toBeNull(); // 95 m out is buildable once the mast stands
  expect(r.reason140).toBe('Beyond 60 m of the Lander or 45 m of a Relay Mast');
  expect(r.solar135).not.toBeNull(); // masts chain
  expect(r.within.length).toBeGreaterThan(0);
  for (const id of r.within) expect(r.s.survey.struck).toContain(id);
  expect(r.lunar.site.network.length).toBe(3); // the Lander and two masts
});

test('large pads: 9+ cells need ≤0.8 m of relief, and Site Grading makes one', async ({ page }) => {
  await start(page, 'southpole');
  await complete(page, ['thoriumPower', 'siteGrading']);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ metals: 300, parts: 100 });
    // a rough 3×3 spot near the Lander that a 2×2 array would still take
    let spot: any = null;
    for (let gx = 114; gx <= 138 && !spot; gx++) {
      for (let gz = 114; gz <= 138 && !spot; gz++) {
        const [x, z] = centreOf(gx, gz, 3, 3);
        if (fromLander(x, z) > 50 || fromLander(x, z) < 22) continue; // the 16 m grade clears the Lander
        const reactor = g.canPlace('reactor', gx, gz).reason;
        if (/^Too rough for a large pad/.test(reactor) && g.canPlace('solar', gx, gz).valid) spot = { gx, gz, reactor };
      }
    }
    if (!spot) return null;
    g.gradeAt(spot.gx, spot.gz);
    g.advanceGameSeconds(1);
    return { ...spot, graded: g.canPlace('reactor', spot.gx, spot.gz) };
  });
  expect(r).not.toBeNull();
  expect(r!.reactor).toMatch(/^Too rough for a large pad \(\d\.\d m relief > 0\.8 m\) — grade it \(Site Grading\)$/);
  expect(r!.graded.valid).toBe(true);
  // on the mare there is no grading: the reason says what to do instead
  await start(page, 'mare');
  await complete(page, ['massDriver']);
  const mare = await page.evaluate(() => {
    const g = window.__game!;
    for (let gx = 110; gx <= 140; gx++) {
      for (let gz = 110; gz <= 140; gz++) {
        const reason = g.canPlace('massDriver', gx, gz).reason;
        if (reason.startsWith('Too rough for a large pad')) return reason;
      }
    }
    return '';
  });
  expect(mare).toMatch(/^Too rough for a large pad \(\d\.\d m relief > 0\.8 m\) — find flatter ground$/);
});

test('survey: pays data, borrows a robot, reveals a breakthrough, and novelty decays', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  // out of range at the landing site
  const r0 = await page.evaluate(() => {
    const g = window.__game!;
    g.surveyProspect('tranqPit');
    g.advanceGameSeconds(0);
    return g.getState();
  });
  expect(r0.survey.active).toBeNull();
  expect(hasAlert(r0, /^OUT OF RANGE — Tranquillitatis pit is regional: needs T1 Prospecting Rovers \(Era 1\)$/)).toBe(true);
  await complete(page, ['prospectingRovers']);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.advanceGameSeconds(1);
    const before = g.getState();
    g.surveyProspect('tranqPit');
    g.advanceGameSeconds(0);
    const paid = g.getState();
    g.advanceGameSeconds(1);
    const running = g.getState();
    const lunar = g.getLunar();
    g.surveyProspect('moltke');
    g.advanceGameSeconds(0);
    const busy = g.getState();
    g.advanceGameSeconds(96); // 97 s gone: the tick that closes the 98th brings it home
    const almost = g.getState();
    g.advanceGameSeconds(1);
    const done = g.getState();
    g.advanceGameSeconds(1);
    return { before, paid, running, lunar, busy, almost, done, home: g.getState(), research: g.getResearch() };
  });
  expect(r.before.powerStored - r.paid.powerStored).toBe(60);
  expect(r.before.resources.oxygen - r.paid.resources.oxygen).toBe(33);
  expect(r.before.resources.water - r.paid.resources.water).toBe(7);
  expect(r.before.resources.parts - r.paid.resources.parts).toBe(5);
  expect(r.paid.survey.active.endsAt - r.paid.survey.active.startedAt).toBeCloseTo(98, 6);
  expect(r.before.bots.total).toBe(2);
  expect(r.running.bots.total).toBe(1); // one robot lent to the hopper
  expect(r.lunar.active).toEqual({ id: 'tranqPit', remaining: 97 });
  expect(hasAlert(r.busy, /^SURVEY IN PROGRESS — Tranquillitatis pit 1:37$/)).toBe(true);
  expect(r.almost.survey.active).not.toBeNull();
  // 98 s later: the data, the breakthrough, and the robot home
  expect(r.done.survey.active).toBeNull();
  expect(r.done.data - r.before.data).toBe(30);
  expect(r.done.survey.prospects.tranqPit).toMatchObject({ cls: 'regional', data: 30 });
  expect(r.done.discoveries).toContain('btLavaTubeCaverns');
  expect(r.home.bots.total).toBe(2);
  expect(hasAlert(r.done, /^SURVEY COMPLETE — Mare Tranquillitatis pit · \+30≡/)).toBe(true);
  expect(hasAlert(r.done, /^BREAKTHROUGH — Lava-Tube Caverns found at Mare Tranquillitatis pit \(researchable in Era 3\)$/)).toBe(true);
  // the placeholder is a card now, waiting for its era
  expect(r.done.era).toBe(1);
  expect(r.research.cards.btLavaTubeCaverns.state).toBe('eraLocked');
  // novelty: Moltke is the first ilmenite (20), Maskelyne the second (30 × 0.5)
  const n = await page.evaluate(() => {
    const g = window.__game!;
    g.surveyProspect('moltke');
    g.advanceGameSeconds(61);
    const moltke = g.getState().survey.prospects.moltke;
    const cost = g.getLunar().prospects.find((p: any) => p.id === 'maskelyne');
    g.surveyProspect('maskelyne');
    g.advanceGameSeconds(cost.survey.timeS + 1);
    return { moltke, maskelyne: g.getState().survey.prospects.maskelyne, cost };
  });
  expect(n.moltke.data).toBe(20);
  expect(n.cost.data).toBe(15); // the sheet shows the novelty-decayed payout before the trip
  expect(n.cost.survey.timeS).toBe(Math.round(60 + 3 * n.cost.dist)); // min(420, 60 + 3d)
  expect(n.maskelyne.data).toBe(15);
  // a shortfall names the goods
  const short = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ oxygen: -g.getState().resources.oxygen });
    g.surveyProspect('descartes');
    g.advanceGameSeconds(0);
    return g.getState();
  });
  expect(short.survey.active).toBeNull();
  expect(hasAlert(short, /^SURVEY NEEDS \d+○ — have 0$/)).toBe(true);
});

test('breakthrough: a discovered host tech is researchable in its era', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  await complete(page, ['prospectingRovers']);
  await page.evaluate(() => { window.__game.surveyProspect('tranqPit'); window.__game.advanceGameSeconds(99); });
  // charters: four era-1 techs open Era 2, four era-2 techs open Era 3
  await complete(page, ['regolithProcessing', 'grizzlyScreens', 'fieldSpectrometers',
    'batteryStorage', 'thermalWadis', 'partsFabrication', 'siliconRefining']);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.research('btLavaTubeCaverns');
    g.advanceGameSeconds(0);
    return { s: g.getState(), card: g.getResearch().cards.btLavaTubeCaverns };
  });
  expect(r.s.era).toBe(3);
  expect(r.s.researchQueue).toContain('btLavaTubeCaverns');
  expect(r.card.state).toBe('queued');
});

test('outposts: a slot from orbit, a claim in chips, a stream, a grounded hopper, abandon', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  // before T2 there is no slot, and heritage and anomalies are survey-only anyway
  const pre = await page.evaluate(() => {
    const g = window.__game!;
    g.surveyProspect('moltke');
    g.advanceGameSeconds(61);
    g.claimOutpost('moltke');
    g.claimOutpost('tranquilityBase');
    g.claimOutpost('tranqPit');
    g.advanceGameSeconds(0);
    return g.getState();
  });
  expect(pre.survey.prospects.moltke.data).toBe(20);
  expect(pre.survey.outposts).toEqual([]);
  expect(hasAlert(pre, /^NO OUTPOST SLOT — Orbital Prospector \(Era 4\)$/)).toBe(true);
  expect(hasAlert(pre, /^PROTECTED HERITAGE SITE — survey only$/)).toBe(true);
  expect(hasAlert(pre, /^NOTHING TO EXTRACT — anomaly$/)).toBe(true);
  await complete(page, ['prospectingRovers', 'orbitalProspector']);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ oxygen: 200, water: 100, metals: 150, parts: 60, chips: 20 });
    g.claimOutpost('cabeus');           // not yet surveyed
    g.advanceGameSeconds(0);
    const unsurveyed = g.getState();
    g.surveyProspect('cabeus');
    powered(328);
    const surveyed = g.getState();
    g.claimOutpost('cabeus');
    g.advanceGameSeconds(0);
    const claimed = g.getState();
    g.claimOutpost('moltke');           // the one slot is taken
    g.advanceGameSeconds(0);
    const full = g.getState();
    powered(361);
    const live = g.getState();
    const lunar = g.getLunar();
    powered(10);
    const later = g.getState();
    return { unsurveyed, surveyed, claimed, full, live, lunar, later };
  });
  expect(hasAlert(r.unsurveyed, /^NOT SURVEYED — survey Cabeus first$/)).toBe(true);
  expect(r.surveyed.survey.prospects.cabeus).toMatchObject({ cls: 'near', data: 50 });
  expect(hasAlert(r.surveyed, /^BREAKTHROUGH — Cold-Trap Chemistry found at Cabeus \(LCROSS impact\)/)).toBe(true);
  // the claim costs 100◆ 30⚙ 10▣ at once
  expect(r.surveyed.resources.metals - r.claimed.resources.metals).toBe(100);
  expect(r.surveyed.resources.parts - r.claimed.resources.parts).toBeCloseTo(30, 6);
  expect(r.surveyed.resources.chips - r.claimed.resources.chips).toBe(10);
  expect(r.claimed.survey.outposts[0]).toMatchObject({ id: 'cabeus', kind: 'ice', cls: 'near', live: false });
  expect(hasAlert(r.full, /^NO OUTPOST SLOT — 1\/1 in use · Far-Side Relay \(Era 6\) adds one$/)).toBe(true);
  // 360 s of deploy, then it streams: +0.20≈/s less the hopper's 0.004, and O₂ for the hopper
  expect(r.live.survey.outposts[0].live).toBe(true);
  expect(hasAlert(r.live, /^OUTPOST ONLINE — Cabeus ice: \+0\.20≈\/s$/)).toBe(true);
  expect((r.later.resources.water - r.live.resources.water) / 10).toBeCloseTo(0.196, 3);
  expect((r.later.resources.oxygen - r.live.resources.oxygen) / 10).toBeCloseTo(-0.02, 3);
  expect(r.lunar.outposts[0]).toMatchObject({
    id: 'cabeus', live: true, fuelOk: true, upkeepOk: true, stream: '+0.20≈/s', fuel: '0.02○ + 0.004≈ /s',
  });
  expect(r.lunar.used).toBe(1);
  expect(r.lunar.slots).toBe(1);
  expect(r.later.stats.outpostOpS).toBeGreaterThanOrEqual(10);
  // the link rides on the Lander: 6 − 1 (rovers) − 2 (orbiter) − 1.5 (outpost)
  expect(r.later.power.supply).toBeCloseTo(1.5, 6);
  // no oxygen: the hopper is grounded and the stream stops; oxygen back, it flies
  const g2 = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ oxygen: -g.getState().resources.oxygen });
    g.advanceGameSeconds(1);
    const w0 = g.getState();
    g.advanceGameSeconds(10);
    const grounded = g.getState();
    g.grantResources({ oxygen: 50 });
    g.advanceGameSeconds(10);
    return { w0, grounded, back: g.getState(), lunar: g.getLunar() };
  });
  expect(g2.grounded.resources.water).toBeCloseTo(g2.w0.resources.water, 6);
  expect(g2.grounded.survey.outposts[0].fuelOk).toBe(false);
  expect(hasAlert(g2.grounded, /^HOPPER GROUNDED — Cabeus needs 0\.02○\/s \+ 0\.004≈\/s \(have 0○\)$/)).toBe(true);
  expect(g2.back.resources.water).toBeGreaterThan(g2.grounded.resources.water + 1.5);
  expect(g2.back.survey.outposts[0].fuelOk).toBe(true);
  // no parts for upkeep: the stream halves
  const worn = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ parts: -g.getState().resources.parts });
    g.advanceGameSeconds(1);
    const w0 = g.getState();
    g.advanceGameSeconds(10);
    return { w0, w1: g.getState() };
  });
  expect(worn.w1.survey.outposts[0].upkeepOk).toBe(false);
  expect((worn.w1.resources.water - worn.w0.resources.water) / 10).toBeCloseTo(0.096, 3);
  expect(hasAlert(worn.w1, /^OUTPOST WORN — Cabeus stream ×0\.5/)).toBe(true);
  // abandon: the slot frees, nothing comes back, the link load goes
  const ab = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ parts: 50 });
    const before = g.getState();
    g.abandonOutpost('cabeus');
    g.advanceGameSeconds(0);
    const after = g.getState();
    g.advanceGameSeconds(1);
    return { before, after, ticked: g.getState(), lunar: g.getLunar() };
  });
  expect(ab.after.survey.outposts).toEqual([]);
  expect(ab.after.resources.metals).toBe(ab.before.resources.metals);
  expect(ab.after.resources.chips).toBe(ab.before.resources.chips);
  expect(hasAlert(ab.after, /^OUTPOST ABANDONED — Cabeus; the slot is free \(no refund\)$/)).toBe(true);
  expect(ab.lunar.used).toBe(0);
  expect(ab.lunar.prospects.find((p: any) => p.id === 'moltke').claimable).toBe(true);
  expect(ab.ticked.power.supply).toBeCloseTo(3, 6);
});

test('grounded hopper: a KREEP outpost without fuel is offline — its modifier and the Era 7 deed stop, its link stays', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  await complete(page, ['prospectingRovers', 'orbitalProspector', 'thoriumPower']);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ oxygen: 300, water: 200, metals: 400, parts: 150, chips: 20 });
    const trip = g.getLunar().prospects.find((p: any) => p.id === 'fraMauro').survey.timeS;
    g.surveyProspect('fraMauro'); // near side from the mare: a hopper outpost
    powered(trip + 1);
    g.claimOutpost('fraMauro');
    powered(361);
    const c = near('reactor', 16, -2, undefined, 3, 3);
    g.placeBuilding('reactor', c!.gx, c!.gz);
    g.finishConstruction();
    powered(10);
    const live = g.getState();
    g.grantResources({ oxygen: -g.getState().resources.oxygen });
    g.advanceGameSeconds(1); // grounded on this tick; the mods follow it
    const g0 = g.getState();
    g.grantPower(5000);
    g.advanceGameSeconds(10);
    const grounded = g.getState();
    const lunar = g.getLunar();
    g.grantResources({ oxygen: 100 });
    g.grantPower(5000);
    g.advanceGameSeconds(2);
    return { live, g0, grounded, lunar, back: g.getState() };
  });
  expect(r.live.survey.outposts[0]).toMatchObject({ id: 'fraMauro', kind: 'kreep', cls: 'near', live: true, fuelOk: true });
  // the agent-run reactor: 40 kW less the agents' 15% = 34, ×1.15 on KREEP;
  // the Lander nets 6 − 1 (rovers) − 2 (orbiter) − 1.5 (the outpost's link)
  expect(r.live.power.supply).toBeCloseTo(1.5 + 34 * 1.15, 6);
  expect(r.grounded.survey.outposts[0]).toMatchObject({ live: true, fuelOk: false });
  expect(hasAlert(r.grounded, /^HOPPER GROUNDED — Fra Mauro needs 0\.02○\/s \+ 0\.004≈\/s \(have 0○\)$/)).toBe(true);
  // grounded: no KREEP bonus, but the link still draws
  expect(r.grounded.power.supply).toBeCloseTo(1.5 + 34, 6);
  // and no outpost is operating: the Era 7 deed holds still
  expect(r.grounded.stats.outpostOpS).toBe(r.g0.stats.outpostOpS);
  expect(r.lunar.outposts[0]).toMatchObject({
    id: 'fraMauro', live: true, fuelOk: false, stream: 'grounded — no hopper fuel', linkKW: -1.5,
  });
  // fuel back: the hopper flies, the bonus and the deed return
  expect(r.back.survey.outposts[0].fuelOk).toBe(true);
  expect(r.back.power.supply).toBeCloseTo(1.5 + 34 * 1.15, 6);
  expect(r.back.stats.outpostOpS).toBeGreaterThan(r.grounded.stats.outpostOpS);
});

test('fast-forward ticks as play does: the clock moves first, then the tick reads it', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.surveyProspect('moltke'); // a 60 s micro-rover trip
    g.advanceGameSeconds(0);
    const trip = g.getState().survey.active;
    let n = 0;
    while (g.getState().survey.active && n < 70) { g.advanceGameSeconds(1); n++; }
    const s = g.getState();
    return { trip, n, s, home: s.alerts.find((a: any) => a.text.startsWith('SURVEY COMPLETE')) };
  });
  expect(r.trip.endsAt - r.trip.startedAt).toBeCloseTo(60, 6);
  // the tick that brings the rover home is stamped with the second it closes —
  // the clock the fast-forward stops on, as in the live loop
  expect(r.home.at).toBe(r.s.simTime);
  expect(r.home.at).toBeGreaterThanOrEqual(r.trip.endsAt - 1e-6);
  expect(r.n).toBeLessThanOrEqual(61);
});

test('launch doctrine: Rail to Orbit follows the choice, and a Propellant Plant completes it', async ({ page }) => {
  await start(page, 'southpole', 'robotic');
  const goal = () => page.evaluate(() => window.__game.getObjectives().find((o: any) => o.id === 'driver-online'));
  const open = await goal();
  expect(open.hint).toBe('Choose a launch doctrine and build its launcher: research the Electromagnetic Mass Driver ' +
    'and build one, or research Propellant Depot and build a Propellant Plant.');
  expect(open.progress).toBe('◻ Electromagnetic Mass Driver or ◻ Propellant Depot');
  await complete(page, ['propellantDepot']);
  const chosen = await goal();
  expect(chosen.hint).toBe('Research Propellant Depot and build a Propellant Plant: rockets steer where rails can’t.');
  expect(chosen.progress).toBe('✓ Propellant Depot · ◻ Propellant Plant');
  // the Objectives panel reads the same hint
  await page.locator('#milestones').click();
  await expect(page.locator('#milestones')).toContainText('Research Propellant Depot and build a Propellant Plant');
  await page.locator('#milestones').click();
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ metals: 200, parts: 60, silicon: 40, water: 300, oxygen: 200 });
    const c = near('propellantPlant', 14, -2, undefined, 3, 2);
    g.placeBuilding('propellantPlant', c!.gx, c!.gz);
    powered(20);
    const rising = g.getObjectives().find((o: any) => o.id === 'driver-online');
    powered(320);
    return { rising, s: g.getState(), after: g.getObjectives().find((o: any) => o.id === 'driver-online') };
  });
  expect(r.rising.progress).toMatch(/^✓ Propellant Depot · ◻ Propellant Plant \d+%$/);
  expect(r.s.milestonesDone).toContain('driver-online');
  expect(hasAlert(r.s, /^MILESTONE — Rail to Orbit$/)).toBe(true);
  expect(r.after.done).toBe(true);

  // a driver run reads as it always did
  await start(page, 'mare', 'robotic');
  await complete(page, ['massDriver']);
  const driver = await goal();
  expect(driver.hint).toBe('Research and build the Electromagnetic Mass Driver.');
  expect(driver.progress).toBe('✓ Electromagnetic Mass Driver · ◻ Mass Driver');
});

test('atlas: T4 and 12 surveyed prospects add a slot and discount Swarm Protocol', async ({ page }) => {
  await start(page, 'mare', 'robotic');
  await complete(page, ['prospectingRovers', 'orbitalProspector', 'farSideRelay', 'deepSounding']);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.forceOutposts(12); // surveys the 12 nearest claimable prospects, for free
    g.forceOutposts(0);
    g.advanceGameSeconds(1);
    return { s: g.getState(), lunar: g.getLunar() };
  });
  expect(r.s.survey.atlas).toBe(true);
  expect(r.lunar.slots).toBe(4);
  expect(r.s.insights.swarmProtocol).toBe(0.25);
  expect(r.s.milestonesDone).toContain('selenographer');
  expect(hasAlert(r.s, /^ATLAS COMPLETE — SELENOGRAPHER · \+1 outpost slot · streams ×1\.25/)).toBe(true);
});

test('propellant plant: rockets launch from the pole at full rate', async ({ page }) => {
  await start(page, 'southpole', 'robotic');
  await complete(page, ['propellantDepot']);
  const r = await page.evaluate(() => {
    const g = window.__game!;
    g.grantResources({ metals: 200, parts: 60, silicon: 40, water: 300, oxygen: 200 });
    const c = near('propellantPlant', 14, -2, undefined, 3, 2);
    g.placeBuilding('propellantPlant', c!.gx, c!.gz);
    g.finishRoads(); // its road open: built within the 320 s (docs/15)
    powered(320);
    const plant = g.getState().buildings.find((b: any) => b.type === 'propellantPlant');
    const l0 = g.getState().resources.launch;
    powered(100);
    const s = g.getState();
    return { plant, s, rate: (s.resources.launch - l0) / 100 };
  });
  expect(r.plant.construction).toBe(0);
  expect(r.plant.active).toBe(true);
  // 0.01↑/s whatever the latitude (a pole mass driver would make 0.006)
  expect(r.rate).toBeCloseTo(0.01, 4);
});

test('save migration rule 7: a legacy ice survey maps every ice deposit; deposits re-stamp on load', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await start(page, 'southpole');
  const legacy = await page.evaluate(() => {
    const g = window.__game!;
    const dep = g.getDeposits().find((d: any) => d.kind === 'anorthosite' && d.inNetwork);
    const ex = near('excavator', dep.x, dep.z, (x, z) => g.depositAt(x, z)?.id === dep.id);
    g.placeBuilding('excavator', ex!.gx, ex!.gz);
    const st = g.getState();
    for (const k of ['techSchema', 'insights', 'discoveries', 'researchStalled', 'researchPaused',
      'researchRateAvg', 'stats', 'feed', 'downlinks', 'crewRotation', 'survey']) delete st[k];
    for (const b of st.buildings) delete b.deposit;
    st.iceSurveyed = true;
    return st;
  });
  await page.goto(URL_DEBUG); // the title screen
  await page.evaluate((st) => new Promise((resolve, reject) => {
    const req = indexedDB.open('keyval-store');
    req.onsuccess = () => {
      const tx = req.result.transaction('keyval', 'readwrite');
      tx.objectStore('keyval').put({
        state: st, player: { mode: 'build', x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, savedAt: Date.now(),
      }, 'mbb-save-v1');
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  }), legacy);
  await page.reload();
  await page.locator('#btn-continue').click();
  await page.waitForFunction(() => (window.__game?.getState()?.buildings?.length ?? 0) > 1);
  const r = await page.evaluate(() => ({ s: window.__game.getState(), deps: window.__game.getDeposits() }));
  const ice = r.deps.filter((d: any) => d.kind === 'ice');
  expect(ice.length).toBe(7);
  for (const d of ice) {
    expect(d.revealed).toBe(true);
    expect(r.s.survey.struck).toContain(d.id);
  }
  // other deposits past the landing-site survey stay unmapped
  expect(r.deps.some((d: any) => d.kind !== 'ice' && !d.revealed)).toBe(true);
  expect(r.s.buildings.find((b: any) => b.type === 'excavator').deposit).toBe('anorthosite');
  expect(r.s.feed).toEqual({ ilmenite: 0, anorthosite: 0, glass: 0, kreep: 0, volatiles: 0, plain: 0 });
  expect(errors).toEqual([]);
});
