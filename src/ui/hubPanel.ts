/** Extraction hubs in the HUD (docs/17 §4.7): the hub inspector's hopper,
 *  UNITS, QUEUE, ROBOTS and PITS IN REACH (inside the building inspector,
 *  palette.ts), and a hub unit's own inspector. Everything shown comes from
 *  $fleet.hubs / $fleet.units (core/hubView.ts); every button is an action. */
import { RESOURCES } from '../data/resources';
import type { Game } from '../core/game';
import type { BuildingState } from '../core/state';
import { fmtClock } from '../core/daynight';
import { HUB_POLICIES } from '../core/hubPlanner';
import type { HubPolicy } from '../core/state';
import type { TechId } from '../data/techs';
import { openTechTreeAt } from './techTree';
import { el } from './hud';
import { $fleet, $roverSel, $selection, $unitSel, type HubView, type UnitView } from './stores';

const G = RESOURCES.regolith.glyph;
const NOTE = 'class="goal-hint" style="font-size:12px; margin-top:4px; color:rgba(245,247,249,0.68)"';
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const pct = (f: number) => `${Math.round(f * 100)}%`;

const hubOf = (sel: BuildingState): HubView | undefined => $fleet.get().hubs[sel.id];
const unitsOf = (h: HubView): UnitView[] => $fleet.get().units.filter((u) => u.hub === h.id);

/** What makes the inspector rebuild (rows and buttons appear or change). */
export function hubSig(sel: BuildingState): string {
  const h = hubOf(sel);
  if (!h) return '';
  return [h.level, h.bays, h.units.join(','), h.queue.map((j) => `${j.kind}${j.paid}`).join(','), h.canUnit, h.canBay,
    h.pits.map((p) => `${p.key}${p.assigned}${p.inReach}${p.unsurveyed}`).join(','), h.prefer ?? '', h.policy, h.planner,
    h.electrolysis, h.canElectrolysis, unitsOf(h).map((u) => `${u.pinned}${u.parked}${u.feedPlanOff}`).join(',')].join('|');
}

function hopperBar(h: HubView): string {
  const n = 8;
  const k = Math.round((h.hopper / Math.max(1, h.hopperCap)) * n);
  return '▮'.repeat(k) + '▯'.repeat(n - k);
}

/** Body sections: hopper and feed, the queue, the robots, the pits in reach. */
export function hubBodyHtml(sel: BuildingState): string {
  const h = hubOf(sel);
  if (!h) return '';
  const units = unitsOf(h);
  const queue = h.queue.map((j, i) => `<div class="row"><span class="mono" id="hub-job-${i}"></span>
      <button class="btn hub-cancel" data-i="${i}" title="Cancel: everything paid comes back">✕</button></div>`).join('');
  const robots = units.map((u) => `<div class="row hub-unit" data-unit="${u.id}"><span class="mono" id="hub-unit-${u.id}"></span>
      <span><button class="btn unit-send" data-unit="${u.id}" title="Pick a mapped deposit or plain pit; Esc cancels">Send…</button>
      ${u.parked === 'recalled' ? `<button class="btn unit-dispatch" data-unit="${u.id}" title="Back to work">Dispatch</button>`
        : `<button class="btn unit-recall" data-unit="${u.id}" title="Home to its bay, and hold there">Recall</button>`}
      ${u.pinned ? `<button class="btn unit-auto" data-unit="${u.id}" title="Its hub chooses for it again">Auto</button>` : ''}
      ${h.planner ? `<button class="btn unit-feed-plan${u.feedPlanOff ? '' : ' active'}" data-unit="${u.id}" aria-pressed="${!u.feedPlanOff}" title="Advanced routing for this unit; manual Send and Recall still take priority">Planner ${u.feedPlanOff ? 'off' : 'on'}</button>` : ''}</span></div>`).join('');
  const pits = h.pits.map((p, i) => `<div class="row"><span class="mono" id="hub-pit-${i}"></span>
      <span>${p.unsurveyed ? `<button class="btn hub-survey" data-key="${esc(p.key)}" title="A free rover cores it: its ore, grade and faces (30 stored energy, 2⚙)">Survey</button>` : ''}
      <button class="btn hub-assign${p.assigned ? ' active' : ''}" data-key="${esc(p.key)}" aria-pressed="${p.assigned}"
        title="${p.assigned ? 'Assigned: its auto units go here as faces allow — click to let them choose' : 'Its auto units go here as faces allow'}">${p.assigned ? 'Assigned' : 'Assign'}</button></span></div>`).join('');
  return `<section>
      <span class="label" id="hub-hopper"></span>
      <div class="mono" style="margin-top:3px" id="hub-feed"></div>
    </section>
    <section><span class="label" id="hub-units-head"></span>
      <div ${NOTE} id="hub-hint"></div>
      ${queue ? `<div style="margin-top:4px"><span class="label">Queue</span>${queue}</div>` : ''}
    </section>
    <section><span class="label">Feed Planner</span>
      ${h.planner ? `<div class="prio" style="flex-wrap:wrap">${(Object.keys(HUB_POLICIES) as HubPolicy[]).map((policy) =>
        `<button class="btn hub-policy${h.policy === policy ? ' active' : ''}" data-policy="${policy}" aria-pressed="${h.policy === policy}" title="${esc(HUB_POLICIES[policy].help)}">${HUB_POLICIES[policy].label}</button>`).join('')}</div>` : ''}
      <div ${NOTE} id="hub-planner-why"></div>
      ${h.planner ? '' : '<button class="btn hub-tech" data-tech="feedPlanner">View Feed Planner research</button>'}
    </section>
    ${sel.type === 'waterPlant' ? `<section><span class="label">Water electrolysis</span>
      <button class="btn${h.electrolysis ? ' active' : ''}" id="hub-electrolysis" aria-pressed="${h.electrolysis}"${h.canElectrolysis ? '' : ' disabled title="Research Water Electrolysis in Era 4"'}>${h.electrolysis ? 'On' : 'Off'} · split 40% into oxygen</button>
      <div ${NOTE}>Consumes an extra 10 kW while enabled. Diverts 40% of water output and makes 0.89 oxygen per unit split.${h.canElectrolysis ? '' : ' Requires Water Electrolysis research.'}</div>
      ${h.canElectrolysis ? '' : '<button class="btn hub-tech" data-tech="waterElectrolysis">View Water Electrolysis research</button>'}
    </section>` : ''}
    <section><span class="label">Robots</span>${robots || `<div ${NOTE}>No units yet.</div>`}</section>
    <section><span class="label">Pits in reach (one way, now)</span>
      ${pits || `<div ${NOTE}>Nothing mapped to dig — Open pit… stakes a plain pit on mapped open ground.</div>`}
      <div ${NOTE}>Units dig where they feed the hub most: min(units × rate, hunger) × grade. A far pit's trip eats into it; ≈ is before its haul road stands.</div>
    </section>`;
}

/** Foot: print a unit, buy a bay, stake a plain pit (always in view). */
export function hubFootHtml(sel: BuildingState): string {
  const h = hubOf(sel);
  if (!h) return '';
  return `<section>
      <div class="prio" style="margin-top:0; flex-wrap:wrap">
        <button class="btn" id="hub-print"${h.canUnit ? ` disabled title="${esc(h.canUnit)}"` : ` title="Queue a ${esc(h.unitName)}: paid when it reaches the head of the queue, printed here at 4 kW"`}>+ ${esc(h.unitName)} <span class="mono">${esc(h.unitCost)} · ${fmtClock(h.unitTime)}</span></button>
        <button class="btn" id="hub-bay"${h.canBay ? ` disabled title="${esc(h.canBay)}"` : ` title="A bay: one more unit (${esc(h.bayCost)})"`}>+ Bay</button>
        <button class="btn" id="hub-openpit" title="Stake a plain pit on mapped open ground for this hub; Esc cancels">Open pit…</button>
      </div>
      ${h.canBay ? `<div ${NOTE}>${esc(h.canBay)}</div>${/^NEEDS /.test(h.canBay) ? `<button class="btn hub-tech" data-tech="${h.level === 1 ? 'bayExtensions' : 'depotHalls'}">View ${h.level === 1 ? 'Bay Extensions' : 'Depot Halls'} research</button>` : ''}` : ''}
    </section>`;
}

function setText(root: HTMLElement, id: string, text: string) {
  const e = root.querySelector(`#${id}`);
  if (e && e.textContent !== text) e.textContent = text;
}

/** Live numbers (every publish). */
export function refreshHub(root: HTMLElement, sel: BuildingState) {
  const h = hubOf(sel);
  if (!h) return;
  setText(root, 'hub-hopper', `Hopper ${hopperBar(h)} ${Math.floor(h.hopper)}/${h.hopperCap}${G} · feed q ${h.q.toFixed(2)} · starved ${pct(h.starved)}`);
  setText(root, 'hub-feed', h.status || `Feed (its own loads): ${h.feed}`);
  setText(root, 'hub-units-head', `Units ${h.units.length}/${h.bays} · Level ${['I', 'II', 'III'][h.level - 1]}`);
  setText(root, 'hub-hint', h.hint || (h.canUnit ? h.canUnit : `+ ${h.unitName}: ${h.unitCost}, printed in ${fmtClock(h.unitTime)}`));
  setText(root, 'hub-planner-why', h.plannerWhy);
  h.queue.forEach((j, i) => setText(root, `hub-job-${i}`,
    `${j.name} · ${j.paid ? `${pct(j.pct)} · ${fmtClock(Math.ceil(j.left))} left` : j.waiting ? `waiting: ${j.waiting}` : 'queued'}`));
  for (const u of unitsOf(h)) setText(root, `hub-unit-${u.id}`, `${u.tag} ${u.pinned ? '(sent) ' : ''}· ${u.line}`);
  h.pits.forEach((p, i) => setText(root, `hub-pit-${i}`,
    `${p.glyph} ${p.name} · ${p.connected ? '' : '≈'}${fmtClock(p.tripS)}${p.inReach ? '' : ' (out of reach)'} · faces ${p.used}/${p.faces} · q ${p.q.toFixed(2)} · ${(p.rate).toFixed(2)}${G}/s a unit${p.ore ? ` · ${p.ore}` : ''}`));
}

/** The hub inspector's buttons; true when handled. */
export function hubClick(game: Game, btn: HTMLButtonElement, sel: BuildingState): boolean {
  const unit = Number(btn.dataset.unit);
  if (btn.classList.contains('hub-tech')) { openTechTreeAt(btn.dataset.tech as TechId); return true; }
  if (btn.classList.contains('hub-policy')) { game.actions.push({ kind: 'setHubPolicy', hub: sel.id, policy: btn.dataset.policy as HubPolicy }); return true; }
  if (btn.classList.contains('unit-feed-plan')) { game.actions.push({ kind: 'setUnitFeedPlan', unit, on: btn.getAttribute('aria-pressed') !== 'true' }); return true; }
  if (btn.classList.contains('hub-cancel')) { game.actions.push({ kind: 'cancelJob', hub: sel.id, index: Number(btn.dataset.i) }); return true; }
  if (btn.classList.contains('hub-assign')) {
    game.actions.push({ kind: 'assignPit', hub: sel.id, key: btn.getAttribute('aria-pressed') === 'true' ? null : btn.dataset.key ?? null });
    return true;
  }
  if (btn.classList.contains('unit-send')) { game.beginFleetTarget({ kind: 'sendUnit', unit }); return true; }
  if (btn.classList.contains('hub-survey')) { game.actions.push({ kind: 'surveyDeposit', id: (btn.dataset.key ?? '').replace(/^dep:/, '') }); return true; }
  if (btn.classList.contains('unit-recall')) { game.actions.push({ kind: 'recallUnit', unit }); return true; }
  if (btn.classList.contains('unit-dispatch')) { game.actions.push({ kind: 'dispatchUnit', unit }); return true; }
  if (btn.classList.contains('unit-auto')) { game.actions.push({ kind: 'autoUnit', unit }); return true; }
  switch (btn.id) {
    case 'hub-print': game.actions.push({ kind: 'queueUnit', hub: sel.id }); return true;
    case 'hub-bay': game.actions.push({ kind: 'queueBay', hub: sel.id }); return true;
    case 'hub-openpit': game.beginFleetTarget({ kind: 'openPit', hub: sel.id }); return true;
    case 'hub-electrolysis': game.actions.push({ kind: 'setElectrolysis', id: sel.id, on: btn.getAttribute('aria-pressed') !== 'true' }); return true;
  }
  return false;
}

/** A hub unit's own inspector: beside the building inspector, one at a time. */
export function mountUnitPanel(root: HTMLElement, game: Game) {
  const insp = el('div', 'panel interactive');
  insp.id = 'unit-inspector';
  insp.style.display = 'none';
  (root.querySelector('#hud-right') ?? root).appendChild(insp);
  let sig = '';
  const render = () => {
    const id = $unitSel.get();
    const u = id === null ? undefined : $fleet.get().units.find((x) => x.id === id);
    if (!u) { insp.style.display = 'none'; sig = ''; return; }
    const next = `${u.id}|${u.pinned}|${u.parked}|${u.hub}|${u.reprint}|${u.planner}|${u.feedPlanOff}`;
    if (next !== sig) {
      sig = next;
      insp.innerHTML = `
        <div class="insp-head"><section><div class="tt-name"><span>⛏ ${esc(u.name)}</span>
          <span class="label">${u.tag}</span></div>
          <span class="label" id="un-status"></span></section></div>
        <div class="insp-body">
          <section><div class="io">
            <span class="k">Hub</span><span class="mono" id="un-hub"></span>
            <span class="k">Pit</span><span class="mono" id="un-pit"></span>
            <span class="k">Orders</span><span class="mono" id="un-mode"></span>
            ${u.planner ? '<span class="k">Feed Planner</span><span class="mono" id="un-planner"></span>' : ''}
            <span class="k">Load</span><span class="mono" id="un-load"></span>
            <span class="k">Wear</span><span class="mono" id="un-wear"></span>
            <span class="k">Pack</span><span class="mono" id="un-pack"></span>
            <span class="k">Flare</span><span class="mono" id="un-flare"></span>
          </div></section>
          <section><div ${NOTE}>Its hub printed it, docks and charges it, and sends it where it feeds the hub most. Send… pins it to a pit (up to twice its reach) until you press Auto.</div></section>
        </div>
        <div class="insp-foot"><section class="actions">
          <button class="btn" id="un-send" title="Then click a mapped deposit or a plain pit; Esc cancels">Send…</button>
          ${u.parked === 'recalled' ? '<button class="btn" id="un-dispatch" title="Back to work">Dispatch</button>'
            : '<button class="btn" id="un-recall" title="Home to its bay, and hold there">Recall</button>'}
          ${u.pinned ? '<button class="btn" id="un-auto" title="Its hub chooses for it again">Auto</button>' : ''}
          ${u.planner ? `<button class="btn${u.feedPlanOff ? '' : ' active'}" id="un-feed-plan" aria-pressed="${!u.feedPlanOff}">Planner ${u.feedPlanOff ? 'off' : 'on'}</button>` : ''}
          ${u.reprint ? '<button class="btn" id="un-reprint" title="Rad scars: its hub re-prints it new (capability 100%) for half its price; it works on until then">Re-print</button>' : ''}
          <button class="btn" id="un-hubbtn" title="Inspect its hub">⌂ Hub</button>
          <button class="btn" id="un-close">✕</button>
        </section></div>`;
    }
    insp.style.display = '';
    setText(insp, 'un-status', u.line);
    setText(insp, 'un-hub', `${u.hubName} · bay ${u.bay + 1}`);
    setText(insp, 'un-pit', u.targetName ? `${u.targetName}${u.tripS ? ` · ${fmtClock(u.tripS)} one way · ${u.rate.toFixed(2)}${G}/s` : ''}` : '—');
    setText(insp, 'un-mode', u.pinned ? 'sent — stays until you press Auto' : 'auto — its hub chooses');
    setText(insp, 'un-planner', u.planWhy || (u.feedPlanOff ? 'Off — basic hub dispatch remains active' : 'Enabled — reviews empty departures at its hub'));
    setText(insp, 'un-load', `${Math.floor(u.cargo)}/${Math.floor(u.bucket)}${G}`);
    setText(insp, 'un-wear', `${Math.round((1 - u.wear) * 100)}%`);
    setText(insp, 'un-pack', u.pack);
    setText(insp, 'un-flare', u.flare);
  };
  $unitSel.subscribe(render);
  $fleet.subscribe(render);
  $selection.subscribe((b) => { if (b && $unitSel.get() !== null) $unitSel.set(null); });
  $roverSel.subscribe((r) => { if (r !== null && $unitSel.get() !== null) $unitSel.set(null); });
  insp.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    const id = $unitSel.get();
    if (!btn || id === null) return;
    const u = $fleet.get().units.find((x) => x.id === id);
    switch (btn.id) {
      case 'un-send': game.beginFleetTarget({ kind: 'sendUnit', unit: id }); break;
      case 'un-recall': game.actions.push({ kind: 'recallUnit', unit: id }); break;
      case 'un-dispatch': game.actions.push({ kind: 'dispatchUnit', unit: id }); break;
      case 'un-auto': game.actions.push({ kind: 'autoUnit', unit: id }); break;
      case 'un-feed-plan': game.actions.push({ kind: 'setUnitFeedPlan', unit: id, on: !!u?.feedPlanOff }); break;
      case 'un-reprint': game.actions.push({ kind: 'counter', counter: 'flareReprintUnit', id }); break;
      case 'un-hubbtn': if (u) game.select(u.hub); break;
      case 'un-close': game.cancelFleetTarget(); $unitSel.set(null); break;
    }
  });
}
