/** Build palette (category tabs → building cards), the fixed-template tooltip,
 *  the placement hint, and the inspection panel. */
import {
  BUILDINGS, BUILD_ORDER, CATEGORY_LABEL, CATEGORY_ORDER,
  type BuildingId, type Category,
} from '../data/buildings';
import { RESOURCES, type ResourceId } from '../data/resources';
import { TECHS, TECH_ORDER } from '../data/techs';
import { SITES } from '../data/sites';
import { buildCost, demolishRefund, untouchedSite } from '../buildings/placement';
import { wearDerate } from '../core/economy';
import { canToggleCrew } from '../core/mods';
import { AGENT_GEN_TAX, CONSTRUCTION_KW, GRADE_COST_ENERGY, ICE_SURVEY_COST, RESUPPLY } from '../data/balance';
import type { Game } from '../core/game';
import type { BuildingState } from '../core/state';
import { fmtClock } from '../core/daynight';
import { el, fmt, PERSON_SVG } from './hud';
import { $ice, $lander, $placing, $selection, $siteId, $tech, $vitals, spawnFloater } from './stores';

const ICONS: Record<BuildingId, string> = {
  lander: '⌂', solar: '▤', excavator: '⛏', habitat: '◠', smelter: '▣',
  iceHarvester: '❄', hydroponics: '❀', battery: '▮', refinery: '◫', lab: '◎', roboticsBay: '◉', storageYard: '▦',
  partsFab: '⚙', reactor: '☢', recDome: '◔', chipFab: '⊞', dataCenter: '⌗',
  foilFactory: '▰', massDriver: '⟶',
};

function techThatUnlocks(b: BuildingId): string | null {
  for (const tid of TECH_ORDER) {
    for (const fx of TECHS[tid].effects) {
      if (fx.kind === 'unlock' && fx.building === b) return TECHS[tid].name;
    }
  }
  return null;
}

/** the inputs a station shares with the crew's life support ("water", "food") */
function lifeSupportInputs(type: BuildingId): string {
  return (Object.keys(BUILDINGS[type].inputs) as ResourceId[])
    .filter((rid) => rid === 'oxygen' || rid === 'food' || rid === 'water')
    .map((rid) => RESOURCES[rid].name.toLowerCase())
    .join(' and ') || 'supplies';
}

function ioRows(type: BuildingId): string {
  const def = BUILDINGS[type];
  const site = SITES[$siteId.get() ?? 'mare'];
  const cost = Object.entries(buildCost(type, site))
    .map(([rid, amt]) => `${amt} ${RESOURCES[rid as ResourceId].name.toLowerCase()}`)
    .join(' · ') || '—';
  const flow = (rec: Partial<Record<ResourceId, number>>) =>
    Object.entries(rec).map(([rid, rate]) =>
      `${fmt((rate as number) * 60)} ${RESOURCES[rid as ResourceId].name.toLowerCase()}/min`).join(' · ') || '—';
  // on a robotic mission, crewed stations run on agents: show the real draw
  const agentRun = $vitals.get().expedition === 'robotic' && def.crew > 0;
  const power = def.powerKW > 0 && agentRun
    ? `+${fmt(def.powerKW * (1 - AGENT_GEN_TAX))} kW (−${Math.round(AGENT_GEN_TAX * 100)}% agent-run)`
    : def.powerKW >= 0 ? `+${def.powerKW} kW`
    : agentRun ? `${(def.powerKW * 1.6).toFixed(1)} kW (×1.6 agent-run)`
    : `${def.powerKW} kW`;
  const upkeep = def.upkeepParts ? `${def.upkeepParts} parts/day` : '—';
  const buildTime = def.buildTime > 0
    ? `${Math.round(def.buildTime * site.buildCostMult)}s · 1 robot · ${CONSTRUCTION_KW} kW · parts to weld`
    : 'pre-placed';
  const extras: string[] = [];
  if (def.housing) extras.push(`houses ${def.housing}`);
  if (def.storageKWh) extras.push(`stores ${def.storageKWh}`);
  if (def.moraleDelta) extras.push(`morale ${def.moraleDelta > 0 ? '+' : ''}${def.moraleDelta}`);
  if (def.crew) extras.push(`${def.crew} crew`);
  return `
    <div class="io">
      <span class="k">Build</span><span class="mono">${cost}</span>
      <span class="k">Time</span><span class="mono">${buildTime}</span>
      <span class="k">Power</span><span class="mono">${power}</span>
      <span class="k">Input</span><span class="mono">${flow(def.inputs)}</span>
      <span class="k">Output</span><span class="mono">${flow(def.outputs)}</span>
      <span class="k">Upkeep</span><span class="mono">${upkeep}</span>
      ${extras.length ? `<span class="k">Effect</span><span class="mono">${extras.join(' · ')}</span>` : ''}
    </div>`;
}

export function tooltipHtml(type: BuildingId, locked: boolean): string {
  const def = BUILDINGS[type];
  const unlock = locked ? techThatUnlocks(type) : null;
  return `
    <section><div class="tt-name"><span>${def.name}</span>
      <span class="label">${CATEGORY_LABEL[def.category]}</span></div>
      <span class="label">${def.footprint[0] * 4}×${def.footprint[1] * 4} m · Era ${def.era}</span></section>
    <section>${ioRows(type)}</section>
    <section><div class="pro">${def.pro}</div><div class="con">${def.con}</div></section>
    ${unlock ? `<section><span class="label">⧗ Requires research — ${unlock}</span></section>` : ''}`;
}

export function mountPalette(root: HTMLElement, game: Game) {
  const tooltip = el('div', 'panel');
  tooltip.id = 'tooltip';
  tooltip.style.display = 'none';
  root.appendChild(tooltip);

  const palette = el('div', '');
  palette.id = 'palette';
  root.appendChild(palette);
  const items = el('div', 'items panel interactive');
  const cats = el('div', 'cats interactive');
  palette.append(items, cats);

  let activeCat: Category = 'power';

  const showTooltip = (type: BuildingId, locked: boolean, anchor: HTMLElement) => {
    tooltip.innerHTML = tooltipHtml(type, locked);
    tooltip.style.display = 'block';
    const r = anchor.getBoundingClientRect();
    const w = 280;
    tooltip.style.left = `${Math.min(window.innerWidth - w - 12, Math.max(12, r.left + r.width / 2 - w / 2))}px`;
    tooltip.style.bottom = `${window.innerHeight - r.top + 10}px`;
    tooltip.style.top = 'auto';
  };
  const hideTooltip = () => { tooltip.style.display = 'none'; };

  const renderItems = () => {
    const unlocked = new Set($tech.get().unlocked);
    items.innerHTML = '';
    for (const type of BUILD_ORDER) {
      const def = BUILDINGS[type];
      if (def.category !== activeCat) continue;
      const locked = !unlocked.has(type);
      const b = el('button', `bld-btn${locked ? ' locked' : ''}`) as HTMLButtonElement;
      const site = SITES[$siteId.get() ?? 'mare'];
      const cost = Object.entries(buildCost(type, site))
        .map(([rid, amt]) => `${amt}${RESOURCES[rid as ResourceId].glyph}`).join(' ');
      b.innerHTML = `<div class="icon">${ICONS[type]}</div><div class="nm">${def.name}</div><div class="cost mono">${cost}</div>`;
      b.addEventListener('mouseenter', () => showTooltip(type, locked, b));
      b.addEventListener('mouseleave', hideTooltip);
      if (!locked) {
        b.addEventListener('click', (e) => {
          game.beginPlacement(type);
          spawnFloater(BUILDINGS[type].name.toUpperCase(), e.clientX, e.clientY - 20);
        });
      }
      items.appendChild(b);
    }
    // terrain tools live beside the extraction buildings
    if (activeCat === 'extraction' && $tech.get().grading) {
      const g = el('button', 'bld-btn') as HTMLButtonElement;
      g.innerHTML = `<div class="icon">▭</div><div class="nm">Grade Site</div><div class="cost mono">${GRADE_COST_ENERGY}▮</div>`;
      g.title = 'Flatten a 16×16 m patch of terrain for construction. Costs stored energy; recovers a little regolith.';
      g.addEventListener('click', () => game.beginPlacement('grade'));
      items.appendChild(g);
    }
  };

  const renderCats = () => {
    cats.innerHTML = '';
    for (const c of CATEGORY_ORDER) {
      const b = el('button', `btn${c === activeCat ? ' active' : ''}`, CATEGORY_LABEL[c]) as HTMLButtonElement;
      b.addEventListener('click', () => { activeCat = c; renderCats(); renderItems(); });
      cats.appendChild(b);
    }
  };
  renderCats();
  renderItems();
  // rebuild buttons only when the unlock set or site changes, not every tick
  let itemSig = '';
  $tech.subscribe((t) => {
    const sig = `${t.unlocked.slice().sort().join(',')}|${t.grading}|${$siteId.get()}`;
    if (sig !== itemSig) { itemSig = sig; renderItems(); }
  });
  $siteId.subscribe(() => { itemSig = ''; renderItems(); });

  // ── placement hint: in the palette column, above the cards ──
  const hint = el('div', 'panel');
  hint.id = 'place-hint';
  hint.style.display = 'none';
  palette.insertBefore(hint, items);
  $placing.subscribe((p) => {
    if (!p) { hint.style.display = 'none'; return; }
    hint.style.display = 'block';
    hint.innerHTML = p.valid || !p.reason
      ? `<span class="label">Click place · R rotate · right-click cancel</span>${p.valid && p.warn ? `<div class="caution">${p.warn}</div>` : ''}`
      : `<span class="blocked">${p.reason}</span>`;
  });

  // ── inspector: beneath the time controls and alerts. Rebuilt only when its
  // structure changes (which buttons exist, what they say); status, condition
  // and the shipment countdown update in place, so a click is never lost ──
  const insp = el('div', 'panel interactive');
  insp.id = 'inspector';
  insp.style.display = 'none';
  (root.querySelector('#hud-right') ?? root).appendChild(insp);
  let inspSig = '';
  const statusLine = (sel: BuildingState): string => {
    const def = BUILDINGS[sel.type];
    const conRemaining = sel.construction ?? 0;
    const conPct = conRemaining > 0 && sel.buildTotal
      ? Math.round((1 - conRemaining / sel.buildTotal) * 100) : 100;
    const worn = Math.round((1 - wearDerate(sel)) * 100); // % output lost to wear
    const status = conRemaining > 0
      ? (!sel.enabled ? `CONSTRUCTION PAUSED — shut down (${conPct}%)`
        : sel.idleReason === 'queued' ? 'QUEUED — waiting for a free robot'
        : sel.idleReason === 'power' ? `CONSTRUCTION PAUSED — no power (${conPct}%)`
        : sel.idleReason === 'inputs' ? `CONSTRUCTION STALLED — no parts (${conPct}%)`
        : `UNDER CONSTRUCTION — ${conPct}%`)
      : !sel.enabled ? 'SHUT DOWN'
      : sel.idleReason === 'power' ? 'IDLE — no power'
      : sel.idleReason === 'crew' ? 'IDLE — no crew'
      : sel.idleReason === 'inputs' ? 'IDLE — missing inputs'
      : sel.idleReason === 'reserve' ? `IDLE — holding ${lifeSupportInputs(sel.type)} for the crew`
      : sel.idleReason === 'full' ? 'STANDBY — output full'
      : sel.active
        ? ((sel.automated || ($vitals.get().expedition === 'robotic' && $vitals.get().crew <= 0))
          ? `OPERATING · AUTONOMOUS${def.crew <= 0 ? ''
            : def.powerKW > 0 ? ` · −${Math.round(AGENT_GEN_TAX * 100)}% kW` : ' · ×1.6 kW'}`
          : 'OPERATING')
        : 'STANDBY';
    const shadowNote = sel.type === 'solar' && sel.shaded ? ' · IN TERRAIN SHADOW −85%' : '';
    return `${status}${shadowNote}${worn >= 1 ? ` · WORN −${worn}%` : ''}${sel.dust > 0.15 ? ` · DUST −${Math.round(sel.dust * 100)}%` : ''}`;
  };
  const setText = (id: string, text: string) => {
    const e = insp.querySelector(`#${id}`);
    if (e && e.textContent !== text) e.textContent = text;
  };
  const refreshInspector = (sel: BuildingState) => {
    setText('insp-status', statusLine(sel));
    const cond = Math.round((1 - sel.wear) * 100);
    const worn = Math.round((1 - wearDerate(sel)) * 100);
    setText('insp-cond', `${cond}%`);
    const bar = insp.querySelector('#insp-cond-bar') as HTMLElement | null;
    if (bar) {
      bar.style.width = `${cond}%`;
      bar.style.background = sel.wear > 0.3 ? '#f5f7f9' : 'rgba(245,247,249,0.55)';
    }
    setText('insp-cond-hint', worn >= 5
      ? `WORN — output −${worn}%. Repairs need parts in stock.`
      : 'Repairs draw automatically from the parts stockpile.');
    setText('insp-eta', `▲ Shipment en route — lands in ${fmtClock($lander.get().etaS)}`);
  };
  const buildInspector = (sel: BuildingState) => {
    const def = BUILDINGS[sel.type];
    const conRemaining = sel.construction ?? 0;
    const untouched = untouchedSite(sel);
    const refund = Object.entries(demolishRefund(sel, SITES[$siteId.get() ?? 'mare']))
      .map(([rid, amt]) => `${amt} ${RESOURCES[rid as ResourceId].name.toLowerCase()}`).join(' · ');
    const vit = $vitals.get();
    const crewToggle = canToggleCrew(vit.expedition, vit.crew, $tech.get());
    const orderDays = $lander.get().orderDays;
    insp.innerHTML = `
      <section><div class="tt-name"><span>${ICONS[sel.type]} ${def.name}</span>
        <span class="label">#${sel.id}</span></div>
        <span class="label" id="insp-status"></span></section>
      <section>${ioRows(sel.type)}</section>
      <section>
        <span class="label">Condition <span class="mono" style="float:right" id="insp-cond"></span></span>
        <div class="prog" style="height:4px; margin-top:5px; background:rgba(245,247,249,0.06)">
          <i id="insp-cond-bar" style="display:block; height:100%"></i>
        </div>
        <div class="goal-hint" id="insp-cond-hint" style="font-size:11px; margin-top:4px; color:rgba(245,247,249,0.52)"></div>
      </section>
      <section><div class="pro">${def.pro}</div><div class="con">${def.con}</div></section>
      <section>
        <span class="label">Idle priority (0 = last to brown out)</span>
        <div class="prio">${[0, 1, 2, 3].map((p) =>
          `<button class="btn prio-btn${sel.priority === p ? ' active' : ''}" data-p="${p}">${p}</button>`).join('')}</div>
      </section>
      ${sel.type === 'lander' ? `<section>
        <span class="label">Lander services — mission HQ</span>
        <div class="prio" style="margin-top:6px; flex-wrap:wrap">
          ${$ice.get().hasIce
            ? ($ice.get().surveyed
              ? '<span class="label">✓ Ice deposits mapped — overlay [I]</span>'
              : `<button class="btn" id="insp-survey">❄ Survey for ice — ${ICE_SURVEY_COST} stored</button>`)
            : '<span class="label">❄ Survey: no ice at this site — polar deposits only</span>'}
        </div>
        <div class="prio" style="margin-top:6px">
          ${$lander.get().resupplyPending
            ? '<span class="label" id="insp-eta"></span>'
            : `<button class="btn" id="insp-order">▲ Order Earth shipment — arrives in ${orderDays} day${orderDays === 1 ? '' : 's'}</button>`}
        </div>
        <div class="goal-hint" style="font-size:11px; margin-top:4px; color:rgba(245,247,249,0.52)">Shipment: +${RESUPPLY.metals} metals · +${RESUPPLY.parts} parts${vit.crew > 0 ? ` · morale −${RESUPPLY.moraleHit} (the crew resents the umbilical)` : ''}. Each order waits a lunar day longer than the last; Earth's rescue of a stranded base does not.</div>
        ${crewToggle && vit.crew > 0 && $lander.get().agentRun > 0 ? `<div class="prio" style="margin-top:6px">
          <button class="btn" id="insp-crewall">${PERSON_SVG} Crew all eligible stations</button>
        </div>
        <div class="goal-hint" style="font-size:11px; margin-top:4px; color:rgba(245,247,249,0.52)">Settlers take agent-run stations in priority order while free hands last; the rest stay agent-run.</div>` : ''}
      </section>` : ''}
      ${def.crew > 0 && crewToggle ? `<section>
        <span class="label">Operations — ${def.powerKW > 0
          ? `agents keep ${Math.round((1 - AGENT_GEN_TAX) * 100)}% of the output`
          : 'agents draw ×1.6 power'}, need no crew or morale</span>
        <div class="prio" style="margin-top:6px">
          <button class="btn${sel.automated ? '' : ' active'}" id="insp-crewed">${PERSON_SVG} Crewed</button>
          <button class="btn${sel.automated ? ' active' : ''}" id="insp-auto">◉ Autonomous</button>
        </div>
      </section>` : ''}
      ${conRemaining > 0 && sel.enabled && sel.idleReason === 'queued' ? `<section>
        <span class="label">Robot queue — sites build in placement order</span>
        <div class="prio"><button class="btn" id="insp-buildnext">Build next</button></div>
      </section>` : ''}
      <section class="actions">
        ${sel.type !== 'lander' ? `<button class="btn" id="insp-toggle">${conRemaining > 0
          ? (sel.enabled ? 'Pause' : 'Resume')
          : (sel.enabled ? 'Shut down' : 'Power on')}</button>` : ''}
        ${sel.type !== 'lander' ? `<button class="btn" id="insp-demolish" title="Refund: ${refund || 'nothing'}">${untouched ? 'Cancel ↩' : 'Demolish ½↩'}</button>` : ''}
        <button class="btn" id="insp-close">✕</button>
      </section>`;
  };
  $selection.subscribe((sel) => {
    if (!sel) { insp.style.display = 'none'; inspSig = ''; return; }
    const vit = $vitals.get();
    const lander = $lander.get();
    const site = (sel.construction ?? 0) > 0;
    const sig = [
      sel.id, sel.type, sel.enabled, sel.automated, sel.priority, site,
      site && sel.idleReason === 'queued', untouchedSite(sel),
      canToggleCrew(vit.expedition, vit.crew, $tech.get()), vit.expedition, vit.crew > 0,
      $ice.get().surveyed, lander.resupplyPending, lander.orderDays, lander.agentRun > 0,
    ].join('|');
    if (sig !== inspSig) {
      inspSig = sig;
      buildInspector(sel);
    }
    insp.style.display = 'block';
    refreshInspector(sel);
  });
  // one listener for every inspector button, acting on the live selection
  insp.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    const sel = $selection.get();
    if (!btn || !sel) return;
    if (btn.classList.contains('prio-btn')) {
      game.actions.push({ kind: 'setPriority', id: sel.id, priority: Number(btn.dataset.p) as 0 | 1 | 2 | 3 });
      return;
    }
    switch (btn.id) {
      case 'insp-buildnext': game.actions.push({ kind: 'buildNext', id: sel.id }); break;
      case 'insp-toggle': game.actions.push({ kind: 'setEnabled', id: sel.id, enabled: !sel.enabled }); break;
      case 'insp-survey': game.actions.push({ kind: 'surveyIce' }); break;
      case 'insp-order': game.actions.push({ kind: 'orderResupply' }); break;
      case 'insp-crewall': game.actions.push({ kind: 'crewAll' }); break;
      case 'insp-crewed': game.actions.push({ kind: 'setAutomated', id: sel.id, automated: false }); break;
      case 'insp-auto': game.actions.push({ kind: 'setAutomated', id: sel.id, automated: true }); break;
      case 'insp-demolish': game.actions.push({ kind: 'demolish', id: sel.id }); break;
      case 'insp-close': $selection.set(null); break;
    }
  });
}
