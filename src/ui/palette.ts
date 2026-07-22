/** Build palette (category tabs → building cards), the fixed-template tooltip,
 *  the placement hint, and the inspection panel. */
import {
  BUILDINGS, BUILD_ORDER, CATEGORY_LABEL, CATEGORY_ORDER,
  type BuildingId, type Category,
} from '../data/buildings';
import { RESOURCES, type ResourceId } from '../data/resources';
import { TECHS, TECH_ORDER } from '../data/techs';
import { SITES } from '../data/sites';
import { buildCost } from '../buildings/placement';
import { CONSTRUCTION_KW } from '../data/balance';
import type { Game } from '../core/game';
import { el, fmt } from './hud';
import { $placing, $selection, $siteId, $tech, spawnFloater } from './stores';

const ICONS: Record<BuildingId, string> = {
  lander: '⌂', solar: '▤', excavator: '⛏', habitat: '◠', smelter: '▣',
  iceHarvester: '❄', hydroponics: '❀', battery: '▮', refinery: '◫', lab: '◎', roboticsBay: '◉',
  partsFab: '⚙', reactor: '☢', recDome: '◔', foilFactory: '▰', massDriver: '⟶',
};

function techThatUnlocks(b: BuildingId): string | null {
  for (const tid of TECH_ORDER) {
    for (const fx of TECHS[tid].effects) {
      if (fx.kind === 'unlock' && fx.building === b) return TECHS[tid].name;
    }
  }
  return null;
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
  const power = def.powerKW >= 0 ? `+${def.powerKW} kW` : `${def.powerKW} kW`;
  const upkeep = def.upkeepParts ? `${def.upkeepParts} parts/day` : '—';
  const buildTime = def.buildTime > 0
    ? `${Math.round(def.buildTime * site.buildCostMult)}s · 1 robot · ${CONSTRUCTION_KW} kW`
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
    const sig = `${t.unlocked.slice().sort().join(',')}|${$siteId.get()}`;
    if (sig !== itemSig) { itemSig = sig; renderItems(); }
  });
  $siteId.subscribe(() => { itemSig = ''; renderItems(); });

  // ── placement hint ──
  const hint = el('div', 'panel');
  hint.id = 'place-hint';
  hint.style.display = 'none';
  root.appendChild(hint);
  $placing.subscribe((p) => {
    if (!p) { hint.style.display = 'none'; return; }
    hint.style.display = 'block';
    hint.innerHTML = p.valid || !p.reason
      ? `<span class="label">Click place · R rotate · right-click cancel</span>`
      : `<span class="blocked">${p.reason}</span>`;
  });

  // ── inspector ──
  const insp = el('div', 'panel interactive');
  insp.id = 'inspector';
  insp.style.display = 'none';
  root.appendChild(insp);
  let inspSig = '';
  $selection.subscribe((sel) => {
    if (!sel) { insp.style.display = 'none'; inspSig = ''; return; }
    const conRemaining = sel.construction ?? 0;
    const conPct = conRemaining > 0 && sel.buildTotal
      ? Math.round((1 - conRemaining / sel.buildTotal) * 100) : 100;
    const sig = `${sel.id}|${sel.enabled}|${sel.automated}|${sel.priority}|${sel.idleReason}|${sel.active}|${sel.wear > 0.3}|${Math.round(sel.dust * 20)}|${conPct}|${$tech.get().automation}`;
    if (sig === inspSig) return; // avoid detaching buttons mid-click every tick
    inspSig = sig;
    const def = BUILDINGS[sel.type];
    insp.style.display = 'block';
    const status = conRemaining > 0
      ? (sel.idleReason === 'queued' ? 'QUEUED — waiting for a free robot'
        : sel.idleReason === 'power' ? `CONSTRUCTION PAUSED — no power (${conPct}%)`
        : `UNDER CONSTRUCTION — ${conPct}%`)
      : !sel.enabled ? 'SHUT DOWN'
      : sel.idleReason === 'power' ? 'IDLE — no power'
      : sel.idleReason === 'crew' ? 'IDLE — no crew'
      : sel.idleReason === 'inputs' ? 'IDLE — missing inputs'
      : sel.active ? (sel.automated ? 'OPERATING · AUTONOMOUS' : 'OPERATING') : 'STANDBY';
    insp.innerHTML = `
      <section><div class="tt-name"><span>${ICONS[sel.type]} ${def.name}</span>
        <span class="label">#${sel.id}</span></div>
        <span class="label">${status}${sel.wear > 0.3 ? ' · WORN −50%' : ''}${sel.dust > 0.15 ? ` · DUST −${Math.round(sel.dust * 100)}%` : ''}</span></section>
      <section>${ioRows(sel.type)}</section>
      <section><div class="pro">${def.pro}</div><div class="con">${def.con}</div></section>
      <section>
        <span class="label">Idle priority (0 = last to brown out)</span>
        <div class="prio">${[0, 1, 2, 3].map((p) =>
          `<button class="btn prio-btn${sel.priority === p ? ' active' : ''}" data-p="${p}">${p}</button>`).join('')}</div>
      </section>
      ${$tech.get().automation && def.crew > 0 ? `<section>
        <span class="label">Operations — agents draw ×1.6 power, need no crew or morale</span>
        <div class="prio" style="margin-top:6px">
          <button class="btn${sel.automated ? '' : ' active'}" id="insp-crewed">◈ Crewed</button>
          <button class="btn${sel.automated ? ' active' : ''}" id="insp-auto">◉ Autonomous</button>
        </div>
      </section>` : ''}
      <section class="actions">
        ${sel.type !== 'lander' ? `<button class="btn" id="insp-toggle">${sel.enabled ? 'Shut down' : 'Power on'}</button>` : ''}
        ${sel.type !== 'lander' ? '<button class="btn" id="insp-demolish">Demolish ½↩</button>' : ''}
        <button class="btn" id="insp-close">✕</button>
      </section>`;
    insp.querySelectorAll<HTMLButtonElement>('.prio-btn').forEach((b) => {
      b.addEventListener('click', () => game.actions.push({
        kind: 'setPriority', id: sel.id, priority: Number(b.dataset.p) as 0 | 1 | 2 | 3,
      }));
    });
    insp.querySelector('#insp-toggle')?.addEventListener('click', () =>
      game.actions.push({ kind: 'setEnabled', id: sel.id, enabled: !sel.enabled }));
    insp.querySelector('#insp-crewed')?.addEventListener('click', () =>
      game.actions.push({ kind: 'setAutomated', id: sel.id, automated: false }));
    insp.querySelector('#insp-auto')?.addEventListener('click', () =>
      game.actions.push({ kind: 'setAutomated', id: sel.id, automated: true }));
    insp.querySelector('#insp-demolish')?.addEventListener('click', () =>
      game.actions.push({ kind: 'demolish', id: sel.id }));
    insp.querySelector('#insp-close')?.addEventListener('click', () => $selection.set(null));
  });
}
