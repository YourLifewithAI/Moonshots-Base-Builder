/** The Builder panel ([B]) and the BUILDER section of every resource panel
 *  (docs/13 §5). Everything shown comes from $automation (core/automation.ts);
 *  every control is an action. Structure is rebuilt only when its signature
 *  changes (which rules are unlocked or on, the orders, the reserves); status
 *  text, thresholds and caps update in place, so a click is never lost under
 *  a running sim (docs/07 §11). */
import { BUILDINGS, BUILD_ORDER, type BuildingId } from '../data/buildings';
import { RESOURCES, type ResourceId } from '../data/resources';
import { SITES } from '../data/sites';
import { AUTO, FAMILY_LABEL, RULES, type AutoFamily, type AutoRuleId } from '../data/automation';
import { effectiveDef } from '../core/mods';
import { familyTech, rulesForPanel, type AutomationView, type RuleView } from '../core/automation';
import { fmtClock } from '../core/daynight';
import type { Game } from '../core/game';
import { el } from './hud';
import { $automation, $resourcePanel, $siteId, $tech } from './stores';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function setText(root: ParentNode, sel: string, text: string) {
  const e = root.querySelector(sel);
  if (e && e.textContent !== text) e.textContent = text;
}

/** the header copy (docs/13 §1) */
const RULES_COPY = [
  'It builds what you would, near where it is needed, at the price you would pay.',
  'It keeps back what you need: never below the reserve, never the welders’ parts.',
  'It builds for capacity, not for trouble — nothing into a brownout.',
  'One site per family at a time, then it waits for the numbers to settle.',
  'It extends what you founded: never the first of a type.',
  'Cancel any auto site for a full refund, and it takes the hint.',
];

function ruleRow(r: RuleView): string {
  const tunable = r.unit !== 'none' && r.step > 0;
  return `<div class="bp-rule" data-rule="${r.id}">
    <div class="bp-rl">
      <button class="btn bp-on${r.on ? ' active' : ''}" data-act="toggle" aria-pressed="${r.on}" title="${r.on ? 'Switch this rule off' : 'Switch this rule on'}">${r.on ? '●' : '○'}</button>
      <span class="bp-obj"><span class="bp-objt">${esc(r.objective)}</span> <span class="bp-arrow">→ ${esc(r.building)}</span></span>
    </div>
    <div class="bp-ctls">
      ${tunable ? `<span class="bp-ctl" title="The trigger">T <button class="btn" data-act="t-">−</button><span class="mono bp-t"></span><button class="btn" data-act="t+">+</button></span>` : ''}
      <span class="bp-ctl" title="Most buildings of the type the rule builds up to (every one counts: yours, ordered, auto)">cap <button class="btn" data-act="c-">−</button><span class="mono bp-c"></span><button class="btn" data-act="c+">+</button> <span class="bp-n mono"></span></span>
    </div>
    <div class="bp-status mono"></div>
  </div>`;
}

function familyHead(f: AutoFamily, v: AutomationView): string {
  return `<div class="bp-fam"><span class="label">${FAMILY_LABEL[f].toUpperCase()}</span>
    ${v.governor ? `<span class="bp-prio"><button class="btn" data-act="up" data-fam="${f}" title="Acts earlier">▲</button><button class="btn" data-act="down" data-fam="${f}" title="Acts later">▼</button></span>` : ''}</div>`;
}

function signature(v: AutomationView): string {
  return [
    v.families.slice().sort().join(','), v.priority.join(','), v.governor, v.orderBook,
    v.rules.filter((r) => !r.locked).map((r) => `${r.id}:${r.on}:${r.unit}`).join(','),
    v.orders.map((o) => o.id).join(','), v.reserve.map((r) => r.res).join(','), v.frozenFor > 0,
  ].join('|');
}

/** the panel's body for a view */
function panelBody(v: AutomationView): string {
  const live = v.rules.filter((r) => !r.locked);
  const locked = [...new Set(v.rules.filter((r) => r.locked).map((r) => r.family))];
  const byFam = new Map<AutoFamily, RuleView[]>();
  for (const r of live) byFam.set(r.family, [...(byFam.get(r.family) ?? []), r]);
  const rules = [...byFam].map(([f, rs]) => familyHead(f, v) + rs.map(ruleRow).join('')).join('');
  return `
    <section class="bp-headsec"><div class="tt-name"><span>◉ BUILDER</span><span class="label">[B]</span></div>
      <div class="goal-hint" id="bp-copy">${RULES_COPY[0]}</div>
      <div class="label mono" id="bp-summary"></div></section>
    <section id="bp-orders"><span class="label">Orders</span>
      ${v.orders.length ? v.orders.map((o) => `<div class="bp-order" data-order="${o.id}">
        <span class="mono bp-otext"></span>
        <span><button class="btn" data-act="onext" title="Move this order's sites to the head of the rover queue">Build next</button><button class="btn" data-act="ocancel" title="Cancel what is not yet placed">✕</button></span>
      </div>`).join('') : ''}
      <div class="goal-hint">${v.orderBook > 0
        ? `Order from a resource panel (+1 · +3 · +5 · +10), Ctrl-click a building card, or press Enter while placing. What you cannot pay for yet waits here (${v.orders.length}/${AUTO.bookMax}).`
        : 'Order from a resource panel (+1 · +3), Ctrl-click a building card, or press Enter while placing: the rovers choose the site. What you cannot pay for is skipped — Build Orders (Era 2) holds it instead.'}</div>
    </section>
    <section id="bp-rules"><span class="label">Standing rules</span>
      ${rules || '<div class="goal-hint">No rules yet — Automated Excavation (Era 3) is the first: it builds excavators when regolith demand outruns supply.</div>'}
      ${locked.length ? `<div class="goal-hint bp-locked">Locked: ${locked.map((f) => `${FAMILY_LABEL[f]} (${esc(familyTech(f))})`).join(' · ')}</div>` : ''}
      ${live.length ? `<div class="bp-freeze"><button class="btn" data-act="freeze" id="bp-freeze"></button></div>` : ''}
    </section>
    ${v.governor ? `<section id="bp-reserve"><span class="label">Reserves — the builder never spends below</span>
      <div class="bp-res">${v.reserve.map((r) => `<span class="bp-ctl" data-res="${r.res}">${RESOURCES[r.res].glyph}
        <button class="btn" data-act="r-">−</button><span class="mono bp-r"></span><button class="btn" data-act="r+">+</button></span>`).join('')}</div>
      <div class="goal-hint">Queued research goods and the welders’ parts are always kept back.</div></section>` : ''}
    <section id="bp-log"><span class="label">Log</span><div class="bp-logs mono"></div></section>`;
}

function refreshPanel(root: HTMLElement, v: AutomationView) {
  const n = v.pending;
  setText(root, '#bp-summary', `${n} auto site${n === 1 ? '' : 's'} pending · ${v.siteSurvey ? 'Site Survey AI picks sites' : 'sites by distance only'}` +
    `${v.governor ? ' · Governor on' : ''}${v.predictive ? (v.predictiveLive ? ' · forecasting' : ' · forecasts need a running Data Center') : ''}` +
    `${v.margin !== null ? ` · day margin ${Math.round(v.margin * 100)}%` : ''}`);
  for (const r of v.rules) {
    const row = root.querySelector<HTMLElement>(`.bp-rule[data-rule="${r.id}"]`);
    if (!row) continue;
    setText(row, '.bp-t', r.thresholdText);
    setText(row, '.bp-c', String(r.cap));
    setText(row, '.bp-n', `(${r.count})`);
    setText(row, '.bp-status', r.status);
    setText(row, '.bp-objt', r.objective);
    setText(row, '.bp-arrow', `→ ${r.building}`);
    row.dataset.phase = r.phase;
  }
  for (const o of v.orders) {
    const row = root.querySelector<HTMLElement>(`.bp-order[data-order="${o.id}"]`);
    if (row) setText(row, '.bp-otext', `${o.name} ×${o.count} · ${o.placed} placed${o.waiting ? ` · waiting: ${o.waiting}` : ''}`);
  }
  for (const r of v.reserve) {
    const c = root.querySelector<HTMLElement>(`[data-res="${r.res}"]`);
    if (c) setText(c, '.bp-r', `${r.amount}${r.set ? '' : '*'}`);
  }
  setText(root, '#bp-freeze', v.frozenFor > 0 ? `Thaw rules (frozen ${fmtClock(v.frozenFor)})` : 'Freeze rules 2:00');
  const logs = root.querySelector('.bp-logs');
  const html = v.log.length
    ? v.log.map((l) => `<div${l.id !== undefined ? ` data-sel="${l.id}" class="bp-logline"` : ''}>${fmtClock(l.at)} ${esc(l.text)}</div>`).join('')
    : '<div class="goal-hint">Nothing built by the Builder yet.</div>';
  if (logs && logs.innerHTML !== html) logs.innerHTML = html;
}

/** One click in the panel or a section: the matching action. */
function click(game: Game, e: Event): boolean {
  const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  const logLine = (e.target as HTMLElement).closest<HTMLElement>('.bp-logline');
  if (!btn && logLine?.dataset.sel) { game.select(Number(logLine.dataset.sel)); return true; }
  if (!btn) return false;
  const v = $automation.get();
  const act = btn.dataset.act;
  const ruleEl = btn.closest<HTMLElement>('[data-rule]');
  if (ruleEl && v) {
    const id = ruleEl.dataset.rule as AutoRuleId;
    const r = v.rules.find((x) => x.id === id);
    if (!r) return true;
    const d = RULES[id];
    if (act === 'toggle') game.actions.push({ kind: 'setRule', rule: id, on: !r.on });
    if (act === 't-' || act === 't+') {
      game.actions.push({ kind: 'setRule', rule: id, threshold: r.threshold + (act === 't+' ? d.step : -d.step) });
    }
    if (act === 'c-' || act === 'c+') game.actions.push({ kind: 'setRule', rule: id, cap: r.cap + (act === 'c+' ? 1 : -1) });
    return true;
  }
  const orderEl = btn.closest<HTMLElement>('[data-order]');
  if (orderEl) {
    const id = Number(orderEl.dataset.order);
    if (act === 'onext') game.actions.push({ kind: 'orderNext', id });
    if (act === 'ocancel') game.actions.push({ kind: 'cancelOrder', id });
    return true;
  }
  const resEl = btn.closest<HTMLElement>('[data-res]');
  if (resEl && v && (act === 'r-' || act === 'r+')) {
    const res = resEl.dataset.res as ResourceId;
    const cur = v.reserve.find((x) => x.res === res)?.amount ?? 0;
    const step = res === 'chips' ? 5 : 10;
    game.actions.push({ kind: 'setReserve', res, amount: Math.max(0, cur + (act === 'r+' ? step : -step)) });
    return true;
  }
  if (act === 'up' || act === 'down') {
    game.actions.push({ kind: 'moveFamily', family: btn.dataset.fam as AutoFamily, delta: act === 'up' ? -1 : 1 });
    return true;
  }
  if (act === 'freeze') {
    game.actions.push({ kind: 'freezeRules', seconds: (v?.frozenFor ?? 0) > 0 ? 0 : 120 });
    return true;
  }
  const order = btn.dataset.order;
  if (order) {
    game.actions.push({
      kind: 'order', type: order as BuildingId, count: Number(btn.dataset.n ?? 1),
      intent: btn.dataset.res ? { res: btn.dataset.res as ResourceId } : undefined,
    });
    return true;
  }
  if (act === 'open') { $resourcePanel.set('builder'); return true; }
  return false;
}

export function mountBuilderPanel(root: HTMLElement, game: Game) {
  const panel = el('div', 'panel interactive');
  panel.id = 'builder-panel';
  panel.style.display = 'none';
  const body = el('div', 'bp-body');
  const foot = el('section', 'actions', '<button class="btn" id="bp-close">Close</button>');
  panel.append(body, foot);
  (root.querySelector('#hud-left') ?? root).appendChild(panel);
  foot.querySelector('#bp-close')!.addEventListener('click', () => $resourcePanel.set(null));
  panel.addEventListener('click', (e) => { click(game, e); });
  let sig = '';
  const render = () => {
    const open = $resourcePanel.get() === 'builder';
    const v = $automation.get();
    if (!open || !v) { panel.style.display = 'none'; sig = ''; return; }
    panel.style.display = '';
    const next = signature(v);
    if (next !== sig) { sig = next; body.innerHTML = panelBody(v); }
    refreshPanel(panel, v);
  };
  $resourcePanel.subscribe(render);
  $automation.subscribe(render);
  // the header copy cycles through the builder's rules, one line at a time
  let copy = 0;
  window.setInterval(() => {
    if (panel.style.display === 'none') return;
    copy = (copy + 1) % RULES_COPY.length;
    setText(panel, '#bp-copy', RULES_COPY[copy]);
  }, 9000);
}

// ─────────────────────────── the resource panels' BUILDER section ───────────────────────────

/** what a resource panel can order: its producers that are unlocked and can stand here */
function orderables(game: Game, key: string): { type: BuildingId; res?: ResourceId }[] {
  const t = $tech.get();
  const hasIce = SITES[$siteId.get() ?? 'mare'].hasIce;
  const ok = (b: BuildingId) => t.unlocked.includes(b) && !(BUILDINGS[b].requiresIce && !hasIce) && b !== 'lander' &&
    (b !== 'relayMast' || ($automation.get()?.families ?? []).includes('network'));
  if (key === 'power') return (['solar', 'battery', 'reactor'] as BuildingId[]).filter(ok).map((type) => ({ type }));
  if (key === 'crew') return (['habitat', 'hydroponics'] as BuildingId[]).filter(ok).map((type) => ({ type }));
  if (key === 'bots') return (['roboticsBay'] as BuildingId[]).filter(ok).map((type) => ({ type }));
  if (key === 'data') return (['lab', 'dataCenter', 'serverMonolith'] as BuildingId[]).filter(ok).map((type) => ({ type }));
  const rid = key as ResourceId;
  if (!RESOURCES[rid]) return [];
  return BUILD_ORDER.filter((b) => ok(b) && (effectiveDef(b, game.mods).outputs[rid] ?? 0) > 0).map((type) => ({ type, res: rid }));
}

/** The BUILDER section of a resource panel: order buttons for its producers,
 *  the rules that watch it, and the way into the Builder panel. */
export function mountBuilderSection(panel: HTMLElement, before: HTMLElement, game: Game) {
  const sec = el('section', 'res-builder');
  sec.id = 'res-builder';
  panel.insertBefore(sec, before);
  sec.addEventListener('click', (e) => { click(game, e); });
  let sig = '';
  const render = () => {
    const key = $resourcePanel.get();
    const v = $automation.get();
    if (!key || key === 'builder' || !v) { sec.style.display = 'none'; sig = ''; return; }
    const orders = orderables(game, key);
    const rules = rulesForPanel(key).map((id) => v.rules.find((r) => r.id === id)).filter((r): r is RuleView => !!r && !r.locked);
    if (!orders.length && !rules.length) { sec.style.display = 'none'; sig = ''; return; }
    sec.style.display = '';
    const counts = v.orderBook > 0 ? [1, 3, 5, 10] : [1, 3];
    const next = [key, orders.map((o) => o.type).join(','), counts.join(','), rules.map((r) => `${r.id}:${r.on}`).join(',')].join('|');
    if (next !== sig) {
      sig = next;
      sec.innerHTML = `<span class="label">Builder</span>
        ${RESOURCES[key as ResourceId] ? '<div class="goal-hint mono bp-flow"></div>' : ''}
        ${orders.map((o) => `<div class="row bp-orow"><span>${BUILDINGS[o.type].name}</span><span>${counts.map((n) =>
          `<button class="btn" data-order="${o.type}" data-n="${n}"${o.res ? ` data-res="${o.res}"` : ''} title="Order ${n}: the rovers choose the site">+${n}</button>`).join('')}</span></div>`).join('')}
        ${rules.map((r) => `<div class="bp-rule" data-rule="${r.id}">
          <div class="bp-rl"><button class="btn bp-on${r.on ? ' active' : ''}" data-act="toggle" aria-pressed="${r.on}">${r.on ? '●' : '○'}</button>
          <span class="bp-obj"><span class="bp-objt">${esc(r.objective)}</span> <span class="bp-arrow">→ ${esc(r.building)}</span></span></div>
          <div class="bp-status mono"></div></div>`).join('')}
        <div class="bp-open"><button class="btn" data-act="open">Builder ▸ [B]</button></div>`;
    }
    for (const r of rules) {
      const row = sec.querySelector<HTMLElement>(`.bp-rule[data-rule="${r.id}"]`);
      if (row) { setText(row, '.bp-status', r.status); setText(row, '.bp-objt', r.objective); }
    }
    const f = v.flow[key as ResourceId];
    if (f) {
      const g = RESOURCES[key as ResourceId].glyph;
      const m = (x: number) => { const a = Math.abs(x * 60); return a >= 10 ? String(Math.round(a)) : a.toFixed(1); };
      setText(sec, '.bp-flow', `supply ${m(f.made)}${g}/min · demand ${m(f.want)}${g}/min${f.spend > 0.0005 ? ` + builds ${m(f.spend)}${g}/min` : ''}`);
    }
  };
  $resourcePanel.subscribe(render);
  $automation.subscribe(render);
  $tech.subscribe(render);
}
