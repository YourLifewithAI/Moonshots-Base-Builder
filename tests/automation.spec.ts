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

const URL_DEBUG = '/?debug&seed=42&nolock&lowfx';

async function start(page: Page, site = 'mare', exp: 'human' | 'robotic' = 'robotic', extra = '') {
  await page.goto(`${URL_DEBUG}&site=${site}${exp === 'robotic' ? '&exp=robotic' : ''}${extra}`);
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => { window.__game.setPaused(true); window.__game.advanceGameSeconds(0); });
  await page.evaluate(HELPERS);
}

const hasAlert = (s: any, re: RegExp) => s.alerts.some((a: any) => re.test(a.text));

/** In-page helpers. base(): a small working base near the Lander (8 Solar
 *  Arrays, 2 Smelters, 1 Excavator, built, bank topped up); place(type, n)
 *  fills the first valid cells of a fixed scan; powered(secs) advances with the
 *  bank topped up; rule(id) reads a rule's view; autos() lists auto sites. */
declare function base(opts?: { solar?: number; smelters?: number; excavators?: number }): void;
declare function place(type: string, n: number): number;
declare function powered(secs: number): void;
declare function rule(id: string): any;
declare function autos(): any[];
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
  G.completeTech('regolithProcessing');
  G.grantResources({ metals: 400, parts: 200 });
  place('solar', o.solar ?? 8);
  place('smelter', o.smelters ?? 2);
  place('excavator', o.excavators ?? 1);
  G.finishConstruction();
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

/** the Excavation rule, live on a working base */
async function excavationBase(page: Page) {
  await page.evaluate(() => {
    const G = window.__game;
    base();
    G.completeTech('teleoperation');
    G.completeTech('buildOrders');
    G.completeTech('autoExcavation');
    G.advanceGameSeconds(1);
  });
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
    for (let i = 0; i < 4; i++) G.order('excavator', 2);
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

test('the Excavation rule: on at completion, watches the deficit, places one excavator, settles, stops at its cap', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await start(page);
  await excavationBase(page);
  const r = await page.evaluate(() => {
    const G = window.__game;
    const s0 = G.getState();
    const on = s0.alerts.map((a: any) => a.text).find((t: string) => /BUILDER — the Excavation rule/.test(t));
    const r0 = rule('excavator');
    G.advanceGameSeconds(30);
    const r30 = rule('excavator');
    const flow = G.getState().flowBook.regolith;
    const t = until(() => autos().length > 0, 240, 5);
    const s1 = G.getState();
    const r1 = rule('excavator');
    const site1 = autos()[0];
    // one pending site a family: nothing else while it builds
    powered(60);
    const pending = autos().length;
    G.finishConstruction();
    const r2 = rule('excavator');
    // the cap: every excavator counts
    const n = G.getState().buildings.filter((b: any) => b.type === 'excavator').length;
    G.setRule('excavator', { cap: n });
    powered(400);
    const r3 = rule('excavator');
    const s3 = G.getState();
    return { on, r0, r30, flow, t, site1, r1, pending, r2, n, r3, cap: s3.alerts.map((a: any) => a.text).filter((x: string) => /AUTO CAP/.test(x)),
      alerts: s1.alerts.map((a: any) => a.text), count: s3.buildings.filter((b: any) => b.type === 'excavator').length };
  });
  expect(r.on).toMatch(/BUILDER — the Excavation rule is on: \+1 Regolith Excavator when regolith demand outruns supply .* · cap 6 · \[B\] to tune/);
  expect(r.r0).toMatchObject({ on: true, cap: 6, threshold: -0.1 });
  expect(r.r30.phase).toBe('watching');
  expect(r.r30.status).toMatch(/watching · regolith [\d.]+▲\/min short for \d+ s of 60/);
  // two smelters want 4▲/s; one excavator makes at most 1.5
  expect(r.flow.want).toBeGreaterThan(3);
  expect(r.flow.made - r.flow.want - r.flow.spend).toBeLessThan(-0.1);
  expect(r.t).toBeLessThanOrEqual(90);
  expect(r.site1).toMatchObject({ type: 'excavator', auto: { by: 'rule', rule: 'excavator' } });
  expect(r.alerts.some((x: string) => new RegExp(`AUTO — Regolith Excavator #${r.site1.id} placed, nearest free pad`).test(x))).toBe(true);
  expect(r.r1.phase).toBe('building');
  expect(r.pending).toBe(1);
  expect(r.r2.phase).toBe('settling');
  expect(r.r2.status).toMatch(/settling \d+:\d\d — letting the rates catch up/);
  expect(r.r3.phase).toBe('capped');
  expect(r.r3.status).toMatch(new RegExp(`cap ${r.n}/${r.n} Regolith Excavators`));
  expect(r.count).toBe(r.n);
  expect(r.cap.length).toBeGreaterThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('a rule founds nothing, holds when more would not help, and the dwell resets at re-arm', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const G = window.__game;
    base({ excavators: 0 });
    G.completeTech('teleoperation'); G.completeTech('buildOrders'); G.completeTech('autoExcavation');
    G.grantResources({ regolith: -G.getState().resources.regolith });
    powered(90);
    const founded = rule('excavator');
    const none = autos().length;
    // found one yourself on a thin grid, shed first: dark diggers are not a shortage of diggers
    place('excavator', 1);
    const dig = G.getState().buildings.find((b: any) => b.type === 'excavator');
    G.setPriority(dig.id, 3);
    const solars = G.getState().buildings.filter((b: any) => b.type === 'solar');
    for (const b of solars.slice(2)) G.setEnabled(b.id, false);
    G.grantPower(-G.getState().powerStored);
    G.finishConstruction();
    for (let i = 0; i < 90; i++) { G.grantPower(-G.getState().powerStored); G.advanceGameSeconds(1); }
    const holding = rule('excavator');
    const darkNow = G.getState().buildings.find((b: any) => b.id === dig.id).idleReason;
    // lights back on; the smelters off: supply over demand re-arms the rule
    for (const b of solars) G.setEnabled(b.id, true);
    for (const b of G.getState().buildings) if (b.type === 'smelter') G.setEnabled(b.id, false);
    powered(200);
    const calm = rule('excavator');
    return { founded, none, holding, darkNow, calm, autos: autos().length };
  });
  expect(r.founded.phase).toBe('founded');
  expect(r.founded.status).toMatch(/found the first Regolith Excavator yourself/);
  expect(r.none).toBe(0);
  expect(r.darkNow).toBe('power');
  expect(r.holding.phase).toBe('holding');
  expect(r.holding.status).toMatch(/holding · 1 of 1 Regolith Excavator dark \(power\) — more would not help/);
  expect(r.calm.phase).toBe('ok');
  expect(r.calm.status).toMatch(/ok · regolith supply .* over demand/);
  expect(r.autos).toBe(0);
});

test('the budget: a rule keeps one more in stock, the weld debt and parts floor come first', async ({ page }) => {
  await start(page);
  await excavationBase(page);
  const r = await page.evaluate(() => {
    const G = window.__game;
    // an excavator on the mare costs 16◆ 4⚙: hold 20◆ (one, not two) while the smelters pour more in
    for (let i = 0; i < 120; i++) {
      G.grantPower(100);
      G.grantResources({ metals: 20 - G.getState().resources.metals });
      G.advanceGameSeconds(1);
    }
    G.grantResources({ metals: 20 - G.getState().resources.metals });
    G.advanceGameSeconds(0);
    const short = rule('excavator');
    const none = autos().length;
    G.grantResources({ metals: 200 });
    powered(10);
    return { short, none, after: autos().length };
  });
  expect(r.short.phase).toBe('waiting');
  expect(r.short.status).toMatch(/waiting · needs 16◆ above the 16◆ reserve \(have 2\d\)/);
  expect(r.short.status).not.toMatch(/⚙/); // 200⚙ covers the parts floor and the weld debt
  expect(r.none).toBe(0);
  expect(r.after).toBe(1);
});

test('the Budget Governor: reserve floors, family order, and the setters it gates', async ({ page }) => {
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
    for (let i = 0; i < 90; i++) {
      G.grantPower(100);
      G.grantResources({ metals: 300 - G.getState().resources.metals });
      G.advanceGameSeconds(1);
    }
    const a1 = G.getAutomation();
    return { a0, a1, ex: a1.rules.find((x: any) => x.id === 'excavator'), autos: autos().length, metals: G.getState().resources.metals };
  });
  expect(r.a0.governor).toBe(false);
  expect(r.a0.reserve.find((x: any) => x.res === 'metals').set).toBe(false);
  expect(r.a1.governor).toBe(true);
  expect(r.a1.priority.indexOf('excavation')).toBeLessThan(r.a1.priority.indexOf('power'));
  expect(r.a1.reserve.find((x: any) => x.res === 'metals')).toMatchObject({ amount: 350, set: true });
  expect(r.ex.phase).toBe('waiting');
  expect(r.ex.status).toMatch(/needs 16◆ above the 350◆ reserve/);
  expect(r.autos).toBe(0);
});

test('prerequisites: a consumer with no headroom waits for a Solar Array; without Automated Power it holds', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const G = window.__game;
    base({ solar: 3 });
    G.completeTech('teleoperation'); G.completeTech('buildOrders'); G.completeTech('autoExcavation');
    powered(120);
    const hold = rule('excavator');
    const none = autos().length;
    G.completeTech('autoPower');
    G.advanceGameSeconds(1);
    const t = until(() => autos().some((b: any) => b.type === 'solar'), 120, 1);
    return { hold, none, t, solar: autos().find((b: any) => b.type === 'solar'), ex: rule('excavator'), log: G.getAutomation().log };
  });
  expect(r.none).toBe(0);
  expect(r.hold.phase).toBe('holding');
  expect(r.hold.status).toMatch(/holding · a Regolith Excavator's 6 kW would brown the grid out — build power first/);
  expect(r.t).toBeLessThan(120);
  expect(r.solar.auto).toMatchObject({ by: 'rule', rule: 'solar' });
  expect(r.solar.auto.why).toBeTruthy();
});

test('cancel is a veto: an untouched auto site removed keeps the rule off that ground for a lunar day', async ({ page }) => {
  await start(page);
  await excavationBase(page);
  const r = await page.evaluate(() => {
    const G = window.__game;
    until(() => autos().length > 0, 240, 1);
    const site = autos()[0];
    const plan0 = G.planSite('excavator', { res: 'regolith' });
    G.demolish(site.id);
    G.advanceGameSeconds(1);
    const s = G.getState();
    const plan1 = G.planSite('excavator', { res: 'regolith' });
    return { site, plan0, plan1, rule: rule('excavator'), vetoes: s.auto.vetoes, alert: s.alerts.map((a: any) => a.text).find((t: string) => /AUTO SITE CANCELLED/.test(t)), gone: !s.buildings.some((b: any) => b.id === site.id) };
  });
  expect(r.gone).toBe(true);
  expect(r.alert).toMatch(/AUTO SITE CANCELLED — the Excavation rule leaves that ground alone for a lunar day/);
  expect(r.rule.phase).toBe('vetoed');
  expect(r.rule.status).toMatch(new RegExp(`you cancelled Regolith Excavator #${r.site.id} — resumes in 1[12]:\\d\\d`));
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
    await excavationBase(page);
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
    base({ smelters: 1 });
    G.completeTech('teleoperation'); G.completeTech('buildOrders'); G.completeTech('autoExcavation'); G.completeTech('autoLifeSupport');
    G.grantResources({ oxygen: -G.getState().resources.oxygen + 40 });
    G.advanceGameSeconds(1);
    const a = G.getAutomation();
    const t = until(() => autos().some((b: any) => b.auto.rule === 'oxygen') || /no free hands/.test(rule('oxygen').status), 200, 2);
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
    for (const x of ['excavator', 'smelter', 'refinery', 'partsFab', 'chipFab', 'roboticsBay', 'storageYard']) G.setRule(x, { on: false });
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

test('siting: masts go to the network edge, and Site Survey AI puts an excavator on the wanted ground', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const G = window.__game;
    base({ smelters: 0, excavators: 0 });
    G.revealAll();
    G.completeTech('prospectingRovers'); // Relay Masts
    const cx = (p: any, w = 2) => (p.gx + w / 2) * 4 - 512, cz = (p: any, d = 2) => (p.gz + d / 2) * 4 - 512;
    const L = G.getState().buildings.find((b: any) => b.type === 'lander');
    const lx = cx(L, 3), lz = cz(L, 3);
    const dist = (p: any) => Math.hypot(cx(p) - lx, cz(p) - lz);
    const near = G.planSite('relayMast');
    const edge = G.planSite('relayMast', { edge: true });
    // a smelter on the near rim of the high-Ti basalt north of the Lander
    const dep = G.getDeposits().find((d: any) => d.kind === 'ilmenite' && d.inNetwork);
    let sm = null;
    for (let k = 0; k < 40 && !sm; k++) {
      const t = (dep.r + 4 + k) / Math.hypot(dep.x - lx, dep.z - lz);
      const x = dep.x + (lx - dep.x) * t, z = dep.z + (lz - dep.z) * t;
      const gx = Math.round((x + 512) / 4 - 1.5), gz = Math.round((z + 512) / 4 - 1);
      if (G.placeBuilding('smelter', gx, gz)) sm = { gx, gz };
    }
    G.finishConstruction();
    const plain = G.planSite('excavator', { res: 'regolith' });
    G.completeTech('teleoperation'); G.completeTech('buildOrders'); G.completeTech('siteSurveyAI');
    const survey = G.planSite('excavator', { res: 'regolith' });
    const ground = (p: any) => G.depositAt(cx(p), cz(p))?.kind ?? null;
    return { near, edge, nearD: dist(near), edgeD: dist(edge), sm, plain, survey, plainGround: ground(plain), surveyGround: ground(survey) };
  });
  expect(r.near.why).toMatch(/nearest free pad/);
  expect(r.edge.why).toMatch(/at the network edge, \d+ m from the nearest node/);
  expect(r.edgeD).toBeGreaterThan(r.nearD + 10);
  expect(r.edgeD).toBeGreaterThan(45);
  expect(r.edgeD).toBeLessThanOrEqual(62);
  expect(r.sm).not.toBeNull();
  expect(r.plain.why).toMatch(/nearest free pad to Regolith Smelter #\d+/);
  expect(r.plainGround).toBeNull();
  // with the survey: the wanted deposit, or a pad by the smelter digging it
  expect(r.surveyGround === 'ilmenite' || !!r.survey.dig).toBe(true);
  expect(r.survey.why).toMatch(/high-Ti basalt/);
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
  await excavationBase(page);
  const before = await page.evaluate(() => {
    const G = window.__game;
    until(() => autos().length > 0, 240, 5);
    G.setRule('excavator', { cap: 4, threshold: -0.2 });
    G.setRule('smelter', { on: false });
    G.grantResources({ metals: -G.getState().resources.metals });
    G.order('solar', 3);
    G.advanceGameSeconds(1);
    return G.getState();
  });
  expect(before.auto.orders).toHaveLength(1);
  await putSave(page, before);
  const after = await page.evaluate(() => window.__game.getState());
  expect(after.auto.rules.excavator).toMatchObject({ on: true, cap: 4, threshold: -0.2 });
  expect(after.auto.orders).toEqual(before.auto.orders);
  expect(after.auto.families).toEqual(before.auto.families);
  const tags = (st: any) => st.buildings.filter((b: any) => b.auto).map((b: any) => [b.id, b.type, b.gx, b.gz, b.rot, b.auto]);
  expect(tags(after)).toEqual(tags(before));
  expect(tags(before).length).toBeGreaterThanOrEqual(1);
  // the Builder panel reads the loaded state
  await page.keyboard.press('b');
  await expect(page.locator('#builder-panel .bp-rule[data-rule="excavator"]')).toBeVisible();

  // a save from before the Builder: no auto, no flow book, no tags
  const legacy = JSON.parse(JSON.stringify(before));
  delete legacy.auto;
  delete legacy.flowBook;
  legacy.techsDone = legacy.techsDone.filter((t: string) => !['buildOrders', 'autoExcavation'].includes(t));
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
  const row = panel.locator('.bp-rule[data-rule="excavator"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText('Regolith Excavator');
  await row.evaluate((el) => { (el as any).__mark = 1; });
  for (let i = 0; i < 10; i++) await page.evaluate(() => window.__game.advanceGameSeconds(1));
  expect(await row.evaluate((el) => (el as any).__mark)).toBe(1); // refreshed in place, not rebuilt
  await expect(row).toHaveAttribute('data-phase', /watching|ok|building/);
  // cap +
  await row.locator('[data-act="c+"]').click();
  await page.evaluate(() => window.__game.advanceGameSeconds(0));
  expect((await page.evaluate(() => rule('excavator'))).cap).toBe(7);
  await expect(row.locator('.bp-c')).toHaveText('7');
  // off
  await row.locator('[data-act="toggle"]').click();
  await page.evaluate(() => window.__game.advanceGameSeconds(1));
  expect((await page.evaluate(() => rule('excavator'))).on).toBe(false);
  await expect(panel.locator('.bp-rule[data-rule="excavator"]')).toHaveAttribute('data-phase', 'off');
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
