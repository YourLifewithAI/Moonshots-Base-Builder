/** Construction automation, the Builder (docs/13): one-shot orders from the
 *  landing (the rovers choose the site), the Build Orders book, standing rules
 *  that watch the flow book and place what the base runs short of — dwell,
 *  cooldown, settle, one pending site a family, caps, founding, holding when
 *  more would not help, prerequisites, the budget and the Governor — the
 *  deterministic site chooser, vetoes, maintenance, saves, the [B] panel, and
 *  the twelve techs that open it. */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

const URL_DEBUG = '/?debug&seed=42';

async function start(page: Page, site = 'mare', exp: 'human' | 'robotic' = 'robotic', extra = '') {
  await page.goto(`${URL_DEBUG}&site=${site}${exp === 'robotic' ? '&exp=robotic' : ''}${extra}`);
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
  await page.evaluate(HELPERS);
}

const hasAlert = (s: any, re: RegExp) => s.alerts.some((a: any) => re.test(a.text));

/** In-page helpers. base(): a small working base near the Lander (8 Solar
 *  Arrays and 2 Smelters, each with the one unit it commissions with, built,
 *  bank topped up); hubBase(): the same power with ONE smelter by the high-Ti
 *  basalt, the deposit cored, so its unit digs a real pit and the hub rule has
 *  something to read; place(type, n) fills the first valid cells of a fixed
 *  scan; powered(secs) advances with the bank topped up; rule(id) reads a
 *  rule's view; autos() lists auto sites. */
declare function base(opts?: { solar?: number; smelters?: number }): void;
declare function hubBase(opts?: { solar?: number }): number;
declare function place(type: string, n: number): number;
declare function powered(secs: number): void;
declare function rule(id: string): any;
declare function autos(): any[];
declare function hubBy(type: string, depId: string): number | null;
declare function until(test: () => boolean, secs: number, step?: number): number;
const HELPERS = `(() => {
const G = window.__game;
window.place = (t, n) => {
  let k = 0;
  for (let gz = 112; gz <= 143 && k < n; gz++) for (let gx = 112; gx <= 143 && k < n; gx++) if (G.placeBuilding(t, gx, gz)) k++;
  return k;
};
window.base = (o = {}) => {
  G.grantPower(5000);
  G.grantResources({ metals: 400, parts: 200 });
  place('solar', o.solar ?? 8);
  place('smelter', o.smelters ?? 2);
  G.finishConstruction();
};
/** a hub just outside a deposit's ring, its door toward it; the hub's id */
window.hubBy = (type, depId) => {
  const d = G.getDeposits().find((q) => q.id === depId);
  const cgx = Math.floor((d.x + 512) / 4), cgz = Math.floor((d.z + 512) / 4);
  const R0 = Math.ceil(d.r / 4) + 3;
  for (let rr = R0; rr <= R0 + 16; rr++) {
    const found = [];
    for (let i = -rr; i <= rr; i++) for (const [gx, gz] of [[cgx + i, cgz - rr], [cgx + i, cgz + rr], [cgx - rr, cgz + i], [cgx + rr, cgz + i]]) {
      for (const rot of [0, 1, 2, 3]) {
        if (!G.canPlace(type, gx, gz, rot).valid) continue;
        const w = (rot % 2 ? 2 : 3), dd = (rot % 2 ? 3 : 2);
        found.push({ gx, gz, rot, dist: Math.hypot((gx + w / 2) * 4 - 512 - d.x, (gz + dd / 2) * 4 - 512 - d.z) });
      }
    }
    found.sort((a, b) => a.dist - b.dist || a.gx - b.gx || a.gz - b.gz || a.rot - b.rot);
    for (const f of found) if (G.placeBuilding(type, f.gx, f.gz, f.rot)) return G.getState().buildings[G.getState().buildings.length - 1].id;
  }
  return null;
};
window.hubBase = (o = {}) => {
  G.holdHazards(true);
  G.grantPower(5000);
  G.grantResources({ metals: 400, parts: 200 });
  place('solar', o.solar ?? 8);
  const hub = hubBy('smelter', 'ilmenite-0');
  G.finishConstruction();
  // the Builder prints only against ore a rover has cored (surveyed reserves)
  G.surveyDeposit('ilmenite-0');
  for (let t = 0; t < 900 && !G.getState().oreSurvey.done['ilmenite-0']; t += 5) { G.grantPower(5000); G.advanceGameSeconds(5); }
  return hub;
};
window.powered = (secs) => {
  for (let t = 0; t < secs; t += 10) { G.grantPower(5000); G.advanceGameSeconds(Math.min(10, secs - t)); }
};
window.rule = (id) => G.getAutomation().rules.find((r) => r.id === id);
window.autos = () => G.getState().buildings.filter((b) => b.auto);
window.until = (test, secs, step = 5) => {
  let t = 0;
  while (t < secs && !test()) { G.grantPower(5000); G.advanceGameSeconds(step); t += step; }
  return t;
};
})()`;

/** the Excavation rule (hubUnit), live on a hub by the deposit */
async function excavationBase(page: Page) {
  await page.evaluate(() => {
    const G = window.__game;
    hubBase();
    G.completeTech('teleoperation');
    G.completeTech('buildOrders');
    G.completeTech('autoExcavation');
    G.advanceGameSeconds(1);
  });
}

/** the Power rule, live on a thin grid: it places Solar Array sites (the
 *  Excavation rule prints units at hubs and places nothing) */
async function powerBase(page: Page, solar = 3) {
  await page.evaluate((n) => {
    const G = window.__game;
    base({ solar: n });
    G.completeTech('teleoperation'); G.completeTech('buildOrders'); G.completeTech('autoPower');
    G.setRule('solar', { threshold: 0.5 });
    G.advanceGameSeconds(1);
  }, solar);
}

// ───────────────────────────── orders ─────────────────────────────

test('a one-shot order from the landing: Ctrl-click a card, the rovers choose the site and say why', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await start(page);
  const card = page.locator('#palette .bld-btn[data-type="solar"]');
  const thunks = (await page.evaluate(() => window.__game.getAudio())).played.place ?? 0;
  await card.click({ modifiers: ['Control'] });
  await page.evaluate(() => window.__game.advanceGameSeconds(0));
  // the player's own place action placed it: the same thunk as a click
  expect((await page.evaluate(() => window.__game.getAudio())).played.place ?? 0).toBe(thunks + 1);
  let s = await page.evaluate(() => window.__game.getState());
  const one = s.buildings.filter((b: any) => b.auto);
  expect(one).toHaveLength(1);
  expect(one[0]).toMatchObject({ type: 'solar', auto: { by: 'order' } });
  expect(one[0].construction).toBeGreaterThan(0); // a site, queued for the rovers like any other
  expect(one[0].auto.why).toMatch(/nearest free pad to .* · \d+ m/);
  expect(hasAlert(s, new RegExp(`ORDER — 1 Solar Array placed \\(#${one[0].id} nearest free pad`))).toBe(true);
  // ⇧: three more — the landing's orders cap at three
  await card.click({ modifiers: ['Control', 'Shift'] });
  await page.evaluate(() => window.__game.advanceGameSeconds(0));
  s = await page.evaluate(() => window.__game.getState());
  expect(s.buildings.filter((b: any) => b.auto && b.type === 'solar')).toHaveLength(4);
  expect(hasAlert(s, /ORDER — 3 Solar Arrays placed/)).toBe(true);
  // every site is its own: no two overlap and none sits on a door apron
  const cells = new Set<string>();
  for (const b of s.buildings.filter((x: any) => x.auto)) {
    for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) {
      const k = `${b.gx + dx},${b.gz + dz}`;
      expect(cells.has(k)).toBe(false);
      cells.add(k);
    }
  }
  // the inspector and the world say AUTO
  await page.evaluate((id) => window.__game.select(id), one[0].id);
  await expect(page.locator('#inspector')).toContainText('AUTO');
  await expect(page.locator('#inspector .insp-auto')).toContainText('nearest free pad');
  await expect(page.locator('.auto-mark')).not.toHaveCount(0);
  expect(errors).toEqual([]);
});

test('orders: the Lander refuses, a short stock skips with the reason, Build Orders holds the rest in a book of four', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const G = window.__game;
    const s0 = G.getState();
    G.grantResources({ metals: 24 - s0.resources.metals }); // two Solar Arrays' worth on the mare (12◆ each)
    G.order('lander', 1);
    G.advanceGameSeconds(0);
    const lander = G.getState().alerts.map((a: any) => a.text).find((t: string) => /ORDER REFUSED/.test(t));
    G.order('solar', 3);
    G.advanceGameSeconds(0);
    const s1 = G.getState();
    const skipped = s1.alerts.map((a: any) => a.text).find((t: string) => /skipped/.test(t));
    const n1 = s1.buildings.filter((b: any) => b.auto).length;
    // Build Orders: ×10, and what the stock cannot pay waits in the book
    G.completeTech('teleoperation');
    G.completeTech('buildOrders');
    G.order('solar', 10);
    G.advanceGameSeconds(0);
    const a2 = G.getAutomation();
    const held = G.getState().alerts.map((a: any) => a.text).find((t: string) => /held in the order book/.test(t));
    // the book fills as the metals arrive: one site an order a tick
    G.grantResources({ metals: 60 });
    const mine = () => G.getState().buildings.filter((b: any) => b.auto && b.auto.order === a2.orders[0]?.id).length;
    G.advanceGameSeconds(1);
    const placed1 = mine();
    G.advanceGameSeconds(9);
    const a3 = G.getAutomation();
    const placed3 = mine();
    // four open orders at most
    for (let i = 0; i < 4; i++) G.order('solar', 2);
    G.advanceGameSeconds(0);
    const a4 = G.getAutomation();
    const full = G.getState().alerts.map((a: any) => a.text).find((t: string) => /ORDER BOOK FULL/.test(t));
    // ✕ cancels what is not yet placed
    const first = a4.orders[0].id;
    G.cancelOrder(first);
    G.advanceGameSeconds(0);
    return { lander, skipped, n1, a2, held, a3, placed1, placed3, a4, full, after: G.getAutomation().orders.map((o: any) => o.id), first };
  });
  expect(r.lander).toMatch(/ORDER REFUSED — the Lander is one of a kind/);
  expect(r.n1).toBe(2);
  expect(r.skipped).toMatch(/ORDER — 2 Solar Arrays placed .* · 1 skipped: needs 12◆ \(have 0\)/);
  expect(r.a2.orderBook).toBe(4);
  expect(r.a2.orderMax).toBe(10);
  expect(r.a2.orders).toHaveLength(1);
  expect(r.a2.orders[0]).toMatchObject({ type: 'solar', count: 10 });
  expect(r.held).toMatch(/0 Solar Arrays placed · 10 held in the order book: needs 12◆ \(have 0\)/);
  expect(r.placed1).toBe(1);
  expect(r.placed3).toBe(5); // 60◆ buys five; the rest waits, and says why
  expect(r.a3.orders[0]).toMatchObject({ placed: 5, waiting: 'needs 12◆ (have 0)' });
  expect(r.a4.orders.length).toBe(4);
  expect(r.full).toMatch(/ORDER BOOK FULL — 4\/4 open; cancel one first/);
  expect(r.after).not.toContain(r.first);
});

// ───────────────────────────── standing rules ─────────────────────────────

test('the Excavation rule: on at completion, watches a hub’s starvation, prints one unit, settles, stops at its cap', async ({ page }) => {
  test.setTimeout(200_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await start(page);
  await excavationBase(page);
  const r = await page.evaluate(() => {
    const G = window.__game;
    const s0 = G.getState();
    const on = s0.alerts.map((a: any) => a.text).find((t: string) => /BUILDER — the Excavation rule/.test(t));
    const r0 = rule('hubUnit');
    const n0 = s0.haulers.length;
    // the cap first: one unit is all it may print (the hub's own commissioned unit counts)
    G.setRule('hubUnit', { cap: n0 });
    G.advanceGameSeconds(30);
    const r30 = rule('hubUnit');
    const flow = G.getState().flowBook.regolith;
    const t1 = until(() => rule('hubUnit').phase === 'capped', 300, 5);
    const capped = rule('hubUnit');
    const cap1 = G.getState().alerts.map((a: any) => a.text).filter((x: string) => /AUTO CAP/.test(x));
    G.setRule('hubUnit', { cap: 12 });
    const t2 = until(() => rule('hubUnit').built > 0, 900, 5);
    const r1 = rule('hubUnit');
    const s1 = G.getState();
    const hub = s1.buildings.find((b: any) => b.hub);
    const queued = hub.hub.queue.filter((j: any) => j.kind === 'unit').length;
    const log = G.getAutomation().log.map((l: any) => l.text).find((x: string) => /a unit queued at/.test(x));
    // one print at a time: nothing more is queued while it runs, and the rule settles
    powered(20);
    const queued2 = G.getState().buildings.find((b: any) => b.hub).hub.queue.filter((j: any) => j.kind === 'unit').length;
    const r2 = rule('hubUnit');
    powered(120);
    const units = G.getState().haulers.length;
    return { on, r0, n0, r30, flow, t1, capped, cap1, t2, r1, queued, log, queued2, r2, units,
      sites: G.getState().buildings.filter((b: any) => b.auto).length, legacy: G.getState().buildings.filter((b: any) => b.type === 'excavator').length };
  });
  expect(r.on).toMatch(/BUILDER — the Excavation rule is on: \+1 unit at a hub starved ≥25% for 60 s, with a free face.* · cap 12 · \[B\] to tune/);
  expect(r.r0).toMatchObject({ on: true, cap: 12, threshold: 0.25, building: 'Hub units' });
  expect(r.n0).toBe(1); // the smelter commissioned with one unit
  expect(r.r30.phase).toMatch(/^(watching|holding)$/);
  expect(r.r30.status).toMatch(/(watching · Regolith Smelter #\d+ starved \d+% for \d+ s of 60|holding · Regolith Smelter #\d+ — )/);
  // one smelter wants more regolith than its one unit brings
  expect(r.flow.want).toBeGreaterThan(r.flow.made);
  // at its cap it prints nothing and says so, once
  expect(r.t1).toBeLessThan(300);
  expect(r.capped.status).toBe(`cap ${r.n0}/${r.n0} units — raise the cap to let it print more`);
  expect(r.cap1.length).toBeGreaterThanOrEqual(1);
  // raised: it prints one unit at the starved hub, from the hub, not a pad
  expect(r.t2).toBeLessThan(900);
  expect(r.log).toMatch(/a unit queued at Regolith Smelter #\d+ · Regolith Smelter #\d+ starved \d+%; \+[\d.]+▲\/s at high-Ti basalt #0/);
  expect(r.r1.built).toBe(1);
  expect(r.queued).toBeLessThanOrEqual(1);
  expect(r.queued2).toBeLessThanOrEqual(1);
  expect(r.r2.phase).toMatch(/^(settling|ok)$/);
  expect(r.units).toBe(r.n0 + 1);
  expect(r.sites).toBe(0);
  expect(r.legacy).toBe(0);
  expect(errors).toEqual([]);
});

test('the Excavation rule holds when more would not help, and starts over once the hub is fed', async ({ page }) => {
  test.setTimeout(200_000);
  await start(page);
  const r = await page.evaluate(() => {
    const G = window.__game;
    const hub = hubBase();
    G.completeTech('teleoperation'); G.completeTech('buildOrders'); G.completeTech('autoExcavation');
    G.grantResources({ regolith: -G.getState().resources.regolith });
    // a thin grid, shed to nothing: a unit that cannot charge is not a shortage of units
    const solars = G.getState().buildings.filter((b: any) => b.type === 'solar');
    for (const b of solars.slice(2)) G.setEnabled(b.id, false);
    G.grantPower(-G.getState().powerStored);
    for (let i = 0; i < 240; i++) { G.grantPower(-G.getState().powerStored); G.advanceGameSeconds(1); }
    const holding = rule('hubUnit');
    const printed = G.getState().buildings.find((b: any) => b.id === hub).hub.queue.length;
    // lights back on; the smelter off: a hub that is not starving has nothing to watch
    for (const b of solars) G.setEnabled(b.id, true);
    G.setEnabled(hub, false);
    powered(200);
    const calm = rule('hubUnit');
    return { holding, printed, calm, autos: autos().length };
  });
  expect(r.holding.phase).toMatch(/^(holding|watching)$/);
  if (r.holding.phase === 'holding') {
    expect(r.holding.status).toMatch(/^holding · Regolith Smelter #\d+ — (power first|hub is waiting on power|an existing unit is idle)/);
  }
  expect(r.printed).toBe(0);
  expect(r.calm.phase).toBe('ok');
  expect(r.calm.status).toMatch(/^ok · every hub below 25% starvation/);
  expect(r.autos).toBe(0);
});

test('the budget: a rule keeps one more in stock, the weld debt and parts floor come first', async ({ page }) => {
  test.setTimeout(200_000);
  await start(page);
  await excavationBase(page);
  const r = await page.evaluate(() => {
    const G = window.__game;
    // a unit on the mare costs 16◆ 4⚙: hold 20◆ (one, not two) while the smelter pours more in
    for (let i = 0; i < 600; i++) {
      G.grantPower(100);
      G.grantResources({ metals: 20 - G.getState().resources.metals });
      G.advanceGameSeconds(1);
      if (/needs \d+◆/.test(rule('hubUnit').status)) break;
    }
    G.grantResources({ metals: 20 - G.getState().resources.metals });
    G.advanceGameSeconds(0);
    const short = rule('hubUnit');
    const before = G.getState().haulers.length;
    G.grantResources({ metals: 200 });
    until(() => rule('hubUnit').built > 0, 400, 5);
    return { short, before, built: rule('hubUnit').built, queued: G.getState().buildings.find((b: any) => b.hub).hub.queue.length, units: G.getState().haulers.length };
  });
  expect(r.short.phase).toBe('holding');
  expect(r.short.status).toMatch(/^holding · Regolith Smelter #\d+ — needs 16◆ above the 16◆ reserve \(have 2\d\)/);
  expect(r.short.status).not.toMatch(/⚙/); // 200⚙ covers the parts floor and the weld debt
  expect(r.short.built).toBe(0);
  expect(r.built).toBe(1);
  expect(r.queued + r.units).toBeGreaterThan(r.before);
});

test('the Budget Governor: reserve floors, family order, and the setters it gates', async ({ page }) => {
  test.setTimeout(200_000);
  await start(page);
  await excavationBase(page);
  const r = await page.evaluate(() => {
    const G = window.__game;
    // without the Governor the floors and order are not the player's to set
    G.setReserve('metals', 350);
    G.moveFamily('excavation', -1);
    G.advanceGameSeconds(0);
    const a0 = G.getAutomation();
    G.completeTech('autoPower'); G.completeTech('budgetGovernor');
    G.setReserve('metals', 350);
    G.moveFamily('excavation', -1);
    for (let i = 0; i < 400; i++) {
      G.grantPower(100);
      G.grantResources({ metals: 300 - G.getState().resources.metals });
      G.advanceGameSeconds(1);
      if (/needs \d+◆/.test(rule('hubUnit').status)) break;
    }
    const a1 = G.getAutomation();
    return { a0, a1, ex: a1.rules.find((x: any) => x.id === 'hubUnit'), autos: autos().length, metals: G.getState().resources.metals,
      queued: G.getState().buildings.find((b: any) => b.hub).hub.queue.length };
  });
  expect(r.a0.governor).toBe(false);
  expect(r.a0.reserve.find((x: any) => x.res === 'metals').set).toBe(false);
  expect(r.a1.governor).toBe(true);
  expect(r.a1.priority.indexOf('excavation')).toBeLessThan(r.a1.priority.indexOf('power'));
  expect(r.a1.reserve.find((x: any) => x.res === 'metals')).toMatchObject({ amount: 350, set: true });
  expect(r.ex.phase).toBe('holding');
  expect(r.ex.status).toMatch(/^holding · Regolith Smelter #\d+ — needs 16◆ above the 350◆ reserve/);
  expect(r.queued).toBe(0);
  expect(r.autos).toBe(0);
});

test('prerequisites: a hub with no headroom says power first; a thin grid gets its Solar Array from the Power rule', async ({ page }) => {
  test.setTimeout(200_000);
  await start(page);
  const r = await page.evaluate(() => {
    const G = window.__game;
    hubBase({ solar: 1 });
    G.completeTech('teleoperation'); G.completeTech('buildOrders'); G.completeTech('autoExcavation');
    for (let i = 0; i < 300 && !/power first/.test(rule('hubUnit').status); i++) { G.grantPower(20); G.advanceGameSeconds(1); }
    const hold = rule('hubUnit');
    const none = autos().length;
    const queued = G.getState().buildings.find((b: any) => b.hub).hub.queue.length;
    // Automated Power: the Power rule builds the array the base is short of
    G.completeTech('autoPower');
    G.setRule('solar', { threshold: 0.5 });
    G.advanceGameSeconds(1);
    const t = until(() => autos().some((b: any) => b.type === 'solar'), 240, 1);
    return { hold, none, queued, t, solar: autos().find((b: any) => b.type === 'solar'), log: G.getAutomation().log };
  });
  expect(r.none).toBe(0);
  expect(r.queued).toBe(0);
  expect(r.hold.phase).toBe('holding');
  expect(r.hold.status).toMatch(/^holding · Regolith Smelter #\d+ — power first: (another unit|high-Ti basalt #0) needs \d+ kW spare \(have -?\d+\)/);
  expect(r.t).toBeLessThan(240);
  expect(r.solar.auto).toMatchObject({ by: 'rule', rule: 'solar' });
  expect(r.solar.auto.why).toBeTruthy();
});

test('cancel is a veto: an untouched auto site removed keeps the rule off that ground for a lunar day', async ({ page }) => {
  await start(page);
  await powerBase(page);
  const r = await page.evaluate(() => {
    const G = window.__game;
    until(() => autos().length > 0, 240, 1);
    const site = autos()[0];
    const plan0 = G.planSite('solar');
    G.demolish(site.id);
    G.advanceGameSeconds(1);
    const s = G.getState();
    const plan1 = G.planSite('solar');
    return { site, plan0, plan1, rule: rule('solar'), vetoes: s.auto.vetoes, alert: s.alerts.map((a: any) => a.text).find((t: string) => /AUTO SITE CANCELLED/.test(t)), gone: !s.buildings.some((b: any) => b.id === site.id) };
  });
  expect(r.site.type).toBe('solar');
  expect(r.gone).toBe(true);
  expect(r.alert).toMatch(/AUTO SITE CANCELLED — the Power rule leaves that ground alone for a lunar day/);
  expect(r.rule.phase).toBe('vetoed');
  expect(r.rule.status).toMatch(new RegExp(`you cancelled Solar Array #${r.site.id} — resumes in 1[12]:\\d\\d`));
  expect(r.vetoes).toHaveLength(1);
  const v = r.vetoes[0];
  expect(v.gx0).toBe(r.site.gx - 1);
  expect(v.gz0).toBe(r.site.gz - 1);
  // the next plan steers clear of the vetoed rectangle
  expect(r.plan1.gx >= v.gx1 || r.plan1.gx + 2 <= v.gx0 || r.plan1.gz >= v.gz1 || r.plan1.gz + 2 <= v.gz0).toBe(true);
});

test('the chooser is deterministic: the same base twice gives the same sites, rotations and reasons', async ({ page }) => {
  test.setTimeout(150_000);
  const run = async () => {
    await start(page);
    await powerBase(page);
    return page.evaluate(() => {
      const G = window.__game;
      G.order('solar', 3);
      G.advanceGameSeconds(0);
      until(() => autos().some((b: any) => b.auto.by === 'rule'), 240, 5);
      return {
        sites: autos().map((b: any) => [b.id, b.type, b.gx, b.gz, b.rot, b.auto.why]),
        plan: G.planSite('smelter'),
      };
    });
  };
  const a = await run();
  const b = await run();
  expect(a.sites.length).toBeGreaterThanOrEqual(4);
  expect(b).toEqual(a);
});

// ───────────────────────────── life, maintenance, siting ─────────────────────────────

test('Automated Life Support on a crewed base: short O₂ runway builds a producer, or says there are no free hands', async ({ page }) => {
  await start(page, 'mare', 'human');
  const r = await page.evaluate(() => {
    const G = window.__game;
    G.instantTravel(true); // the rule's timing is the point, not the rovers' drive (transit.spec)
    base({ smelters: 1 });
    G.completeTech('teleoperation'); G.completeTech('buildOrders'); G.completeTech('autoExcavation'); G.completeTech('autoLifeSupport');
    G.grantResources({ oxygen: -G.getState().resources.oxygen + 40 });
    G.advanceGameSeconds(1);
    const a = G.getAutomation();
    // a smelter is the oxygen maker. One that runs on regolith it lacks is not "more would help": the
    // rule waits for regolith and asks the Excavation rule first. So the pile feeds the hubs, and the
    // one smelter is shut down (its O₂ is what is short): the crew logic is what is read.
    const fed = () => G.grantResources({ regolith: 2000 - G.getState().resources.regolith });
    fed();
    for (const b of G.getState().buildings) if (b.type === 'smelter') G.setEnabled(b.id, false);
    G.advanceGameSeconds(1);
    const t = until(() => { fed(); return autos().some((b: any) => b.auto.rule === 'oxygen') || /no free hands/.test(rule('oxygen').status); }, 200, 2);
    return { on: a.rules.filter((x: any) => x.family === 'life' && x.on).map((x: any) => x.id), t, ox: rule('oxygen'), autos: autos() };
  });
  expect(r.on).toContain('oxygen');
  expect(r.t).toBeLessThan(200);
  const placed = r.autos.find((b: any) => b.auto.rule === 'oxygen');
  if (placed) {
    expect(placed.type).toBe('smelter');
    expect(placed.automated).toBe(false); // crewed while hands are free
  } else {
    expect(r.ox.status).toMatch(/no free hands for a Regolith Smelter \(2 crew\) — Construction Robotics lets agents run it/);
  }
});

test('Maintenance Automation: a machine worn for a lunar day is replaced, the old one demolished at half refund', async ({ page }) => {
  test.setTimeout(150_000);
  await start(page);
  const r = await page.evaluate(() => {
    const G = window.__game;
    base();
    G.completeTech('teleoperation'); G.completeTech('buildOrders'); G.completeTech('autoExcavation');
    G.completeTech('autoSmelting'); G.completeTech('partsFabrication'); G.completeTech('autoFabrication');
    G.completeTech('maintenanceAutomation');
    G.grantResources({ metals: 300, parts: 200 });
    for (const x of ['hubUnit', 'smelter', 'refinery', 'partsFab', 'chipFab', 'roboticsBay', 'storageYard']) G.setRule(x, { on: false });
    G.advanceGameSeconds(1);
    const on = G.getState().alerts.map((a: any) => a.text).find((t: string) => /Maintenance rule is on/.test(t));
    const old = G.getState().buildings.find((b: any) => b.type === 'smelter');
    G.setWear(old.id, 0.95);
    const t = until(() => autos().some((b: any) => b.auto.rule === 'replace'), 900, 10);
    const site = autos().find((b: any) => b.auto.rule === 'replace');
    const rep = rule('replace');
    G.finishConstruction();
    G.advanceGameSeconds(1);
    const s = G.getState();
    return { on, old: old.id, t, site, rep, gone: !s.buildings.some((b: any) => b.id === old.id),
      replaced: s.alerts.map((a: any) => a.text).find((x: string) => /REPLACED/.test(x)) };
  });
  expect(r.on).toMatch(/BUILDER — the Maintenance rule is on: a new machine for one worn ≥40% for a lunar day/);
  expect(r.t).toBeGreaterThanOrEqual(700);
  expect(r.site).toMatchObject({ type: 'smelter', auto: { rule: 'replace', replaces: r.old } });
  expect(r.rep.phase).toBe('building');
  expect(r.gone).toBe(true);
  expect(r.replaced).toMatch(new RegExp(`REPLACED — Regolith Smelter #${r.old} \\(WORN \\d+%\\) replaced by Regolith Smelter #${r.site.id}; #${r.old} demolished, ½ refunded`));
});

test('siting: masts go to the network edge, and a hub stands by the nearest mapped deposit it wants, Site Survey AI or not', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const G = window.__game;
    base({ smelters: 0 });
    G.revealAll();
    G.completeTech('prospectingRovers'); // Prospecting Drones: Relay Masts
    const cx = (p: any, w = 2) => (p.gx + w / 2) * 4 - 512, cz = (p: any, d = 2) => (p.gz + d / 2) * 4 - 512;
    const L = G.getState().buildings.find((b: any) => b.type === 'lander');
    const lx = cx(L, 3), lz = cz(L, 3);
    const dist = (p: any) => Math.hypot(cx(p) - lx, cz(p) - lz);
    const near = G.planSite('relayMast');
    const edge = G.planSite('relayMast', { edge: true });
    const dep = G.getDeposits().find((d: any) => d.kind === 'ilmenite' && d.inNetwork);
    // a smelter is a hub: its anchor is the deposit, and its walls keep the pits' 12 m setback off the ring
    const plain = G.planSite('smelter');
    G.completeTech('teleoperation'); G.completeTech('buildOrders'); G.completeTech('siteSurveyAI');
    const survey = G.planSite('smelter');
    const off = (p: any) => Math.hypot(cx(p, 3) - dep.x, cz(p, 2) - dep.z) - dep.r;
    const ground = (p: any) => G.depositAt(cx(p, 3), cz(p, 2))?.kind ?? null;
    return { near, edge, nearD: dist(near), edgeD: dist(edge), dep, plain, survey, plainOff: off(plain), surveyOff: off(survey),
      plainGround: ground(plain), surveyGround: ground(survey) };
  });
  expect(r.near.why).toMatch(/nearest free pad/);
  expect(r.edge.why).toMatch(/at the network edge, \d+ m from the nearest node/);
  expect(r.edgeD).toBeGreaterThan(r.nearD + 10);
  expect(r.edgeD).toBeGreaterThan(45);
  expect(r.edgeD).toBeLessThanOrEqual(62);
  expect(r.dep).toBeTruthy();
  expect(r.plain.why).toMatch(/nearest free pad to high-Ti basalt #\d+ · \d+ m/);
  expect(r.plainGround).toBeNull();
  expect(r.plainOff).toBeGreaterThan(12);
  // with the survey: still a pad by the deposit, off its ring and its pit's setback
  expect(r.survey.refusal).toBeUndefined();
  expect(r.survey.why).toMatch(/nearest free pad to high-Ti basalt #\d+ · \d+ m/);
  expect(r.surveyGround).toBeNull();
  expect(r.surveyOff).toBeGreaterThan(12);
});

// ───────────────────────────── siting on roads (docs/15) ─────────────────────────────

/** In-page: comb(r) lays open road over the ground within r cells of the
 *  Lander — rows every other cell, joined by a spine through the apron's
 *  stub end — as a crafted save, loaded and paused. No pad there is free of
 *  road: a sprawl of roads, as a long game lays them. Returns cells added.
 *  fullSun() reads the day as the solar rule does. */
declare function comb(r: number): number;
declare function fullSun(): Promise<boolean>;
const SITING = `(() => {
const G = window.__game;
window.comb = (r) => {
  const blob = G.saveBlob();
  const st = blob.state;
  const L = st.buildings.find((b) => b.type === 'lander');
  const foot = new Set();
  for (const b of st.buildings) {
    const f = G.footprintOf(b.id);
    for (let x = Math.round((f.x0 + 512) / 4); x < Math.round((f.x1 + 512) / 4); x++)
      for (let z = Math.round((f.z0 + 512) / 4); z < Math.round((f.z1 + 512) / 4); z++) foot.add(z * 256 + x);
  }
  const have = new Set(st.roads.map((c) => c.gz * 256 + c.gx));
  const end = st.roads.find((c) => !c.bay && !c.closed && c !== st.roads[0]);
  let n = 0;
  const add = (gx, gz) => { const k = gz * 256 + gx; if (foot.has(k) || have.has(k)) return; have.add(k); st.roads.push({ gx, gz, left: 0 }); n++; };
  for (let gz = L.gz - r; gz <= L.gz + r; gz += 2) for (let gx = L.gx - r; gx <= L.gx + r; gx++) add(gx, gz);
  for (let gz = L.gz - r; gz <= L.gz + r; gz++) add(end.gx, gz);
  st.roadRev = (st.roadRev ?? 0) + 1;
  G.loadBlob(blob);
  G.setPaused(true);
  G.advanceGameSeconds(0);
  return n;
};
window.fullSun = async () => {
  const { dayInfo } = await import('/src/core/daynight.ts');
  const { SITES } = await import('/src/data/sites.ts');
  const s = G.getState();
  const site = SITES[s.siteId];
  const d = dayInfo(s.simTime, site, s.flare.phase === 'active');
  return !d.isNight && d.sunFactor >= site.solarDayMult * 0.95 && s.flare.phase !== 'active';
};
})()`;

/** the crewed pole on a rough seed, paused, with the helpers */
async function roughPole(page: Page) {
  await page.goto('/?debug&seed=1234&site=southpole');
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
  await page.evaluate(HELPERS);
  await page.evaluate(SITING);
}

test('siting on rough pole ground: an order walks out to flat ground and lays its road; past a sprawl of roads the solar rule still finds a pad', async ({ page }) => {
  test.setTimeout(150_000);
  await roughPole(page);
  const r = await page.evaluate(() => {
    const G = window.__game;
    G.grantResources({ metals: 3000, parts: 500 });
    // the landing: the ground by the Lander is too rough, so the pick is out on flat ground, a road away
    const L = G.getState().buildings.find((b: any) => b.type === 'lander');
    const rough = [];
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const c = G.canPlace('solar', L.gx + dx, L.gz + dz, 0);
      if (/^Terrain too rough/.test(c.reason)) rough.push(c.reason);
    }
    G.order('solar', 1);
    G.advanceGameSeconds(0);
    const first = autos()[0];
    // a load for the margin to read
    place('smelter', 1);
    G.finishConstruction();
    const firstAccess = G.roadAccess().find((a: any) => a.id === first.id);
    // the rule, founded on that array, with every pad within 14 cells of the Lander on a road
    G.completeTech('teleoperation'); G.completeTech('buildOrders'); G.completeTech('autoPower');
    G.setRule('solar', { threshold: 0.5 });
    G.advanceGameSeconds(1);
    const added = comb(14);
    const plan = G.planSite('solar');
    const t = until(() => autos().some((b: any) => b.auto.rule === 'solar'), 900, 5);
    const site = autos().find((b: any) => b.auto.rule === 'solar');
    const chk = site ? null : G.canPlace('solar', plan.gx, plan.gz, plan.rot);
    G.finishConstruction();
    const access = site ? G.roadAccess().find((a: any) => a.id === site.id) : null;
    return { L, rough: rough.length, first, firstAccess, added, plan, t, site, access, chk, rule: rule('solar') };
  });
  // the Lander's own ground is rough; the order says how far it went and the road it lays
  expect(r.rough).toBeGreaterThan(10);
  expect(r.first.auto.why).toMatch(/nearest free pad to the base centre · \d+ m · a \d+-cell road to it/);
  expect(r.first.spur.length).toBeGreaterThan(0);
  expect(r.firstAccess).toMatchObject({ served: true, linked: true });
  // past the sprawl: before, the chooser looked at the first 200 pads only, all on roads, and gave up
  expect(r.added).toBeGreaterThan(400);
  expect(r.plan.refusal).toBeUndefined();
  expect(Math.max(Math.abs(r.plan.gx - r.L.gx), Math.abs(r.plan.gz - r.L.gz))).toBeGreaterThan(13);
  expect(r.site, `${r.rule.phase}: ${r.rule.status}`).toBeTruthy();
  expect(r.site.auto.why).toMatch(/nearest free pad to the base centre · \d+ m/);
  expect(r.access).toMatchObject({ served: true, linked: true });
});

test('no ground a road can serve: the solar rule says why in [B] and in a warning, and keeps saying it while the margin cannot be read', async ({ page }) => {
  test.setTimeout(150_000);
  await roughPole(page);
  const r = await page.evaluate(async () => {
    const G = window.__game;
    G.grantResources({ metals: 3000, parts: 500 });
    G.order('solar', 1);
    G.advanceGameSeconds(0);
    place('smelter', 1);
    G.finishConstruction();
    G.completeTech('teleoperation'); G.completeTech('buildOrders'); G.completeTech('autoPower');
    G.setRule('solar', { threshold: 0.5 });
    G.advanceGameSeconds(1);
    // road over every pad in the network (the Lander's 60 m)
    comb(18);
    const plan = G.planSite('solar');
    until(() => rule('solar').phase === 'nosite', 900, 5);
    const first = rule('solar');
    // a lunar stretch: while the margin cannot be read, the rule still says it has no ground
    const seen: string[] = [];
    let dark = 0;
    for (let i = 0; i < 480 && dark < 12; i++) {
      G.grantPower(5000); G.advanceGameSeconds(5);
      if (!(await fullSun())) { dark++; seen.push(rule('solar').phase); }
    }
    const s = G.getState();
    const alert = s.alerts.find((a: any) => /^AUTO NO SITE — Power:/.test(a.text));
    return { plan, first, seen, dark, alert, autos: autos().filter((b: any) => b.auto.rule === 'solar').length, end: rule('solar') };
  });
  expect(r.plan.refusal).toMatch(/^no valid ground for a Solar Array inside the build network \(of \d+ open pads: .*\d+ on roads.*\) — a Relay Mast or Habitat extends it$/);
  expect(r.first.phase).toBe('nosite');
  expect(r.first.status).toBe(r.plan.refusal);
  expect(r.autos).toBe(0);
  expect(r.dark).toBeGreaterThan(0);
  expect(r.seen.every((p: string) => p === 'nosite'), r.seen.join(' ')).toBe(true);
  expect(r.alert?.kind).toBe('warn');
  expect(r.alert?.text).toContain('on roads');
  // the panel's row says the same
  await page.keyboard.press('b');
  const row = page.locator('#builder-panel .bp-rule[data-rule="solar"]');
  await expect(row).toHaveAttribute('data-phase', 'nosite');
  await expect(row.locator('.bp-status')).toContainText('no valid ground for a Solar Array');
  await expect(row.locator('.bp-status')).toContainText('on roads');
});

// ───────────────────────────── saves ─────────────────────────────

async function putSave(page: Page, st: any) {
  await page.goto(URL_DEBUG);
  await page.evaluate((state) => new Promise((resolve, reject) => {
    const req = indexedDB.open('keyval-store');
    req.onsuccess = () => {
      const tx = req.result.transaction('keyval', 'readwrite');
      tx.objectStore('keyval').put({
        state, player: { mode: 'build', x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, savedAt: Date.now(),
      }, 'mbb-save-v1');
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  }), st);
  await page.reload();
  await page.locator('#btn-continue').click();
  await page.waitForFunction(() => (window.__game?.getState()?.buildings?.length ?? 0) > 1);
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
  await page.evaluate(HELPERS);
}

test('saves keep the rules, the book and the AUTO tags; an old save loads with every rule off', async ({ page }) => {
  test.setTimeout(200_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await start(page);
  await powerBase(page);
  const before = await page.evaluate(() => {
    const G = window.__game;
    G.completeTech('autoExcavation');
    until(() => autos().length > 0, 240, 5);
    G.setRule('hubUnit', { cap: 4, threshold: 0.4 });
    G.setRule('smelter', { on: false });
    G.grantResources({ metals: -G.getState().resources.metals });
    G.order('solar', 3);
    G.advanceGameSeconds(1);
    return G.getState();
  });
  expect(before.auto.orders).toHaveLength(1);
  await putSave(page, before);
  const after = await page.evaluate(() => window.__game.getState());
  expect(after.auto.rules.hubUnit).toMatchObject({ on: true, cap: 4, threshold: 0.4 });
  expect(after.auto.orders).toEqual(before.auto.orders);
  expect(after.auto.families).toEqual(before.auto.families);
  const tags = (st: any) => st.buildings.filter((b: any) => b.auto).map((b: any) => [b.id, b.type, b.gx, b.gz, b.rot, b.auto]);
  expect(tags(after)).toEqual(tags(before));
  expect(tags(before).length).toBeGreaterThanOrEqual(1);
  // the Builder panel reads the loaded state
  await page.keyboard.press('b');
  await expect(page.locator('#builder-panel .bp-rule[data-rule="hubUnit"]')).toBeVisible();

  // a save from before the Builder: no auto, no flow book, no tags
  const legacy = JSON.parse(JSON.stringify(before));
  delete legacy.auto;
  delete legacy.flowBook;
  legacy.techsDone = legacy.techsDone.filter((t: string) => !['buildOrders', 'autoExcavation', 'autoPower'].includes(t));
  for (const b of legacy.buildings) delete b.auto;
  await putSave(page, legacy);
  const migrated = await page.evaluate(() => { window.__game.advanceGameSeconds(5); return window.__game.getAutomation(); });
  expect(migrated.rules.every((x: any) => !x.on)).toBe(true);
  expect(migrated.orders).toEqual([]);
  expect(migrated.families).toEqual([]);
  expect(errors).toEqual([]);
});

// ───────────────────────────── the panel ─────────────────────────────

test('the Builder panel: B opens it, the switch and cap edit the rule, rows stay put while the game runs', async ({ page }) => {
  await start(page);
  await excavationBase(page);
  await page.keyboard.press('b');
  const panel = page.locator('#builder-panel');
  await expect(panel).toBeVisible();
  const row = panel.locator('.bp-rule[data-rule="hubUnit"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText('Hub units');
  await row.evaluate((el) => { (el as any).__mark = 1; });
  for (let i = 0; i < 10; i++) await page.evaluate(() => window.__game.advanceGameSeconds(1));
  expect(await row.evaluate((el) => (el as any).__mark)).toBe(1); // refreshed in place, not rebuilt
  await expect(row).toHaveAttribute('data-phase', /watching|holding|settling|ok|building/);
  // cap +
  await row.locator('[data-act="c+"]').click();
  await page.evaluate(() => window.__game.advanceGameSeconds(0));
  expect((await page.evaluate(() => rule('hubUnit'))).cap).toBe(13);
  await expect(row.locator('.bp-c')).toHaveText('13');
  // off
  await row.locator('[data-act="toggle"]').click();
  await page.evaluate(() => window.__game.advanceGameSeconds(1));
  expect((await page.evaluate(() => rule('hubUnit'))).on).toBe(false);
  await expect(panel.locator('.bp-rule[data-rule="hubUnit"]')).toHaveAttribute('data-phase', 'off');
  // the resource panel carries the same rule and the order buttons
  await page.keyboard.press('b');
  await expect(panel).toBeHidden();
});

// ───────────────────────────── the techs ─────────────────────────────

const BUILDER_TECHS = ['buildOrders', 'autoExcavation', 'siteSurveyAI', 'autoPower', 'budgetGovernor', 'autoLifeSupport',
  'autoSmelting', 'feedPlanner', 'autoFabrication', 'predictiveScheduling', 'selfExpandingBase', 'maintenanceAutomation'];

test('the twelve Builder techs: in the tree, a numeric con each, a visual part each, and a Next line when they land', async ({ page }) => {
  await start(page, 'mare', 'robotic', '&tips');
  const r = await page.evaluate(async (ids) => {
    const T = await import('/src/data/techs.ts');
    const U = await import('/src/buildings/upgrades.ts');
    const audit = window.__game.auditTechs() as { id: string; pros: number; cons: number }[];
    const upgraded = new Set(Object.values(U.UPGRADES).flat().map((u: any) => u.tech));
    const cards = window.__game.getResearch().cards;
    return ids.map((id: string) => {
      const d = T.TECHS[id];
      // the con is a number: kW, upkeep or power share on a named building
      const numericCon = d.effects.some((fx: any) => ['powerDelta', 'powerMult', 'upkeepMult'].includes(fx.kind));
      return {
        id, era: d.era, lane: d.lane, visual: !!(d.visual ?? '').trim(), part: upgraded.has(id), numericCon,
        first: d.effects[0].kind, audit: audit.find((a) => a.id === id), shown: !!cards[id],
      };
    });
  }, BUILDER_TECHS);
  for (const t of r) {
    expect(t.era, t.id).toBeGreaterThanOrEqual(2);
    expect(t.era, t.id).toBeLessThanOrEqual(7);
    expect(t.visual, t.id).toBe(true);
    expect(t.part, t.id).toBe(true);
    expect(t.numericCon, t.id).toBe(true);
    expect(t.audit.pros, t.id).toBeGreaterThanOrEqual(1);
    expect(t.audit.cons, t.id).toBeGreaterThanOrEqual(1);
    expect(['orders', 'autoRule', 'siting', 'governor', 'predictive', 'feedPlanner', 'maintenance', 'builder'], t.id).toContain(t.first);
  }
  expect(r.find((t: any) => t.id === 'autoPower').lane).toBe('power');
  expect(r.find((t: any) => t.id === 'autoLifeSupport').shown).toBe(true); // crewed and robotic alike
  // the discovery card names the next step
  const banner = page.locator('#era-banner');
  await expect(banner).toBeVisible();
  await banner.locator('[data-dsc="ok"]').click();
  await page.evaluate(() => window.__game.completeTech('teleoperation'));
  const card = page.locator('#discovery-card');
  await expect(card).toBeVisible();
  await card.locator('[data-dsc="ok"]').click();
  await page.evaluate(() => window.__game.completeTech('buildOrders'));
  await expect(card).toContainText('Build Orders');
  await expect(card).toContainText('Open the order book with [B]');
  await card.locator('[data-dsc="ok"]').click();
  await page.evaluate(() => window.__game.completeTech('autoExcavation'));
  await expect(card).toContainText('The Builder now keeps regolith supplied: tune it with [B].');
});
