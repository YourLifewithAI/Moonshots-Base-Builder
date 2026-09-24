/** Build palette (category tabs → building cards), the fixed-template tooltip,
 *  the placement hint, and the inspection panel. */
import {
  BUILDINGS, BUILD_ORDER, CATEGORY_LABEL, CATEGORY_ORDER,
  type BuildingId, type Category,
} from '../data/buildings';
import { RESOURCES, type ResourceId } from '../data/resources';
import { TECHS, TECH_ORDER, effectApplies, type TechId } from '../data/techs';
import { SITES } from '../data/sites';
import { buildCost, demolishRefund, untouchedSite } from '../buildings/placement';
import { downlinkCost, wearDerate } from '../core/economy';
import {
  OVERCLOCKABLE, canToggleCrew, effectiveDef, effectiveRates, refineryFeed, smelterFeed, type Mods,
} from '../core/mods';
import { uplinkShare } from '../core/research';
import {
  AGENT_GEN_TAX, CONSTRUCTION_KW, CYCLE_S, DOWNLINK, GRADE_COST_ENERGY, ICE_SURVEY_COST, OVERCLOCK, RESUPPLY, WEAR,
} from '../data/balance';
import { DEPOSIT_INFO, FEED_KINDS, FEED_LABEL, type FeedGrade } from '../data/deposits';
import type { Game } from '../core/game';
import type { BuildingState } from '../core/state';
import { fmtClock } from '../core/daynight';
import { el, fmt, PERSON_SVG } from './hud';
import { openTechTreeAt } from './techTree';
import {
  $feed, $ice, $lander, $placeFlash, $placing, $power, $research, $resources, $selection, $siteId, $tech,
  $vitals, spawnFloater,
} from './stores';

const ICONS: Record<BuildingId, string> = {
  lander: '⌂', solar: '▤', excavator: '⛏', habitat: '◠', smelter: '▣',
  iceHarvester: '❄', hydroponics: '❀', battery: '▮', refinery: '◫', lab: '◎', roboticsBay: '◉', storageYard: '▦',
  partsFab: '⚙', reactor: '☢', recDome: '◔', chipFab: '⊞', dataCenter: '⌗',
  foilFactory: '▰', massDriver: '⟶', relayMast: '⊥', propellantPlant: '◍',
};

/** The tech that unlocks `b` on this site and expedition — a visible card
 *  first, else any (a breakthrough still to be found). */
export function unlockingTech(b: BuildingId): TechId | null {
  const site = $siteId.get() ?? 'mare';
  const exp = $vitals.get().expedition;
  const cards = $research.get()?.cards;
  let hidden: TechId | null = null;
  for (const tid of TECH_ORDER) {
    const def = TECHS[tid];
    if (!def.effects.some((fx) => fx.kind === 'unlock' && fx.building === b && effectApplies(fx, site, exp))) continue;
    if ((def.sites && !def.sites.includes(site)) || (def.expeditions && !def.expeditions.includes(exp))) continue;
    if (!cards || cards[tid]?.state !== 'hidden') return tid;
    hidden ??= tid;
  }
  return hidden;
}

/** Why a locked card can never be built on this site or mission ('' when
 *  research unlocks it here): an ice harvester needs polar ice. */
export function notBuildableHere(b: BuildingId): string {
  if (BUILDINGS[b].requiresIce && !SITES[$siteId.get() ?? 'mare'].hasIce) return 'Not buildable here — no polar ice';
  return unlockingTech(b) ? '' : 'Not buildable on this mission';
}

/** kW with one decimal where it matters: 10, 6.4 */
const kw = (v: number) => String(Math.round(v * 10) / 10);
/** a multiplier: ×1.6, ×1.48 */
const mult = (v: number) => `×${Math.round(v * 100) / 100}`;

/** the inputs a station shares with the crew's life support ("water", "food") */
function lifeSupportInputs(type: BuildingId): string {
  return (Object.keys(BUILDINGS[type].inputs) as ResourceId[])
    .filter((rid) => rid === 'oxygen' || rid === 'food' || rid === 'water')
    .map((rid) => RESOURCES[rid].name.toLowerCase())
    .join(' and ') || 'supplies';
}

/** The stat grid, from the live mods (tech multipliers, recipes, site ISRU,
 *  agent tax). `b`: a placed building — its crew mode, clock and deposit
 *  count; wear shows in its condition bar instead. */
function ioRows(type: BuildingId, mods: Mods, b?: BuildingState): string {
  const def = effectiveDef(type, mods);
  const site = SITES[$siteId.get() ?? 'mare'];
  const vit = $vitals.get();
  const robotic = vit.expedition === 'robotic';
  // new stations on a robotic mission start agent-run (game.commitPlace)
  const agentRun = def.crew > 0 && (b ? b.automated || (robotic && vit.crew <= 0) : robotic);
  const rv = $research.get();
  const share = type === 'lab' && agentRun ? (b ? rv?.uplinkShare ?? 1 : uplinkShare((rv?.agentLabs ?? 0) + 1)) : 1;
  const r = effectiveRates(type, mods, site, b ? { ...b, wear: 0 } : undefined, { agentRun, robotic, uplinkShare: share });
  const cost = Object.entries(buildCost(type, site))
    .map(([rid, amt]) => `${amt} ${RESOURCES[rid as ResourceId].name.toLowerCase()}`)
    .join(' · ') || '—';
  const flow = (rec: Partial<Record<ResourceId, number>>, data = 0) =>
    [...Object.entries(rec).map(([rid, rate]) =>
      `${fmt((rate as number) * 60)} ${RESOURCES[rid as ResourceId].name.toLowerCase()}/min`),
    ...(data > 0 ? [`${fmt(data * 60)} data/min${share < 1 ? ` (uplink share ${Math.round(share * 100)}%)` : ''}`] : []),
    ].join(' · ') || '—';
  // on a robotic mission, crewed stations run on agents: show the real draw
  const power = r.powerKW > 0
    ? `+${kw(r.powerKW)} kW${agentRun ? ` (−${Math.round(AGENT_GEN_TAX * 100)}% agent-run)` : ''}`
    : r.powerKW < 0 ? `−${kw(-r.powerKW)} kW${agentRun ? ` (${mult(1 + mods.agentTax)} agent-run)` : ''}`
    : '0 kW';
  const upkeep = r.upkeepPartsPerDay > 0 ? `${fmt(r.upkeepPartsPerDay)} parts/day` : '—';
  const buildTime = def.buildTime > 0
    ? `${Math.round(def.buildTime * site.buildCostMult * mods.buildSpeedMult * mods.buildTimeMult[type])}s · 1 robot · ${kw(CONSTRUCTION_KW * mods.constructionKWMult)} kW · parts to weld`
    : 'pre-placed';
  const extras: string[] = [];
  if (def.housing) extras.push(`houses ${def.housing}`);
  if (def.storageKWh) extras.push(`stores ${fmt(def.storageKWh * mods.batteryCapMult)}`);
  if (def.moraleDelta) extras.push(`morale ${def.moraleDelta > 0 ? '+' : ''}${def.moraleDelta}`);
  if (def.crew) extras.push(agentRun && vit.crew <= 0 ? 'agent-run, no crew' : agentRun ? 'agent-run' : `${r.crew} crew`);
  return `
    <div class="io">
      <span class="k">Build</span><span class="mono">${cost}</span>
      <span class="k">Time</span><span class="mono">${buildTime}</span>
      <span class="k">Power</span><span class="mono">${power}</span>
      <span class="k">Input</span><span class="mono">${flow(r.inputs)}</span>
      <span class="k">Output</span><span class="mono">${flow(r.outputs, r.data)}</span>
      <span class="k">Upkeep</span><span class="mono">${upkeep}</span>
      ${extras.length ? `<span class="k">Effect</span><span class="mono">${extras.join(' · ')}</span>` : ''}
    </div>`;
}

export function tooltipHtml(type: BuildingId, locked: boolean, mods: Mods): string {
  const def = BUILDINGS[type];
  const never = locked ? notBuildableHere(type) : '';
  const unlock = locked && !never ? unlockingTech(type) : null;
  return `
    <section><div class="tt-name"><span>${def.name}</span>
      <span class="label">${CATEGORY_LABEL[def.category]}</span></div>
      <span class="label">${def.footprint[0] * 4}×${def.footprint[1] * 4} m · Era ${def.era}</span></section>
    <section>${ioRows(type, mods)}</section>
    <section><div class="pro">${def.pro}</div><div class="con">${def.con}</div></section>
    ${unlock ? `<section><span class="label">⧗ Requires research — ${TECHS[unlock].name} · click to find it in the tree</span></section>` : ''}
    ${never ? `<section><span class="label">✕ ${never}</span></section>` : ''}`;
}

/** 'Feed (last dug): 64% high-Ti · 8% highland → yield +17%' for the smelter
 *  and refinery inspector ('' for other buildings). */
function feedLine(game: Game, type: BuildingId, g: FeedGrade): string {
  if (type !== 'smelter' && type !== 'refinery') return '';
  if (type === 'smelter' && effectiveDef('smelter', game.mods).feedInsensitive) {
    return 'Feed: molten electrolysis melts any soil — the feed grade has no effect';
  }
  const dug = FEED_KINDS.filter((k) => g[k] > 0.005);
  if (!dug.length) return 'Feed (last dug): nothing dug yet — excavators dig the ground they sit on';
  const shown = dug.filter((k) => k !== 'plain');
  const mix = (shown.length ? shown : dug).map((k) => `${Math.round(g[k] * 100)}% ${FEED_LABEL[k]}`).join(' · ');
  const pct = (f: number) => `${f >= 1 ? '+' : '−'}${Math.round(Math.abs(f - 1) * 100)}%`;
  if (type === 'refinery') return `Feed (last dug): ${mix} → yield ${pct(refineryFeed(game.mods, g))}`;
  const f = smelterFeed(game.mods, g);
  return `Feed (last dug): ${mix} → yield ${pct(f.all)}${f.o2 > 1.005 ? ` · O₂ ${pct(f.o2)}` : ''}`;
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
    tooltip.innerHTML = tooltipHtml(type, locked, game.mods);
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
      b.dataset.type = type;
      b.addEventListener('click', (e) => {
        // a locked card answers with the research that opens it — or, where
        // no research ever will, says so and leaves the tree shut
        if (locked) {
          const never = notBuildableHere(type);
          if (never) { spawnFloater(never.toUpperCase(), e.clientX, e.clientY - 20); return; }
          hideTooltip();
          openTechTreeAt(unlockingTech(type));
          return;
        }
        game.beginPlacement(type);
        spawnFloater(BUILDINGS[type].name.toUpperCase(), e.clientX, e.clientY - 20);
      });
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
  // 'SOLAR ARRAY · 12◆ (128→116) · +10 kW · R rotate · ⇧ keep placing',
  // then the reason a spot is blocked, or a warning about a valid one
  const costPart = (amt: number, glyph: string, have: number) =>
    have >= amt ? `${amt}${glyph} (${fmt(have)}→${fmt(have - amt)})` : `${amt}${glyph} (have ${fmt(have)})`;
  const hintLine = (type: BuildingId | 'grade'): string => {
    if (type === 'grade') {
      return ['GRADE SITE', costPart(GRADE_COST_ENERGY, '▮', $power.get().stored), 'each click grades deeper',
        'right-click done'].join(' · ');
    }
    const res = $resources.get();
    const site = SITES[$siteId.get() ?? 'mare'];
    const parts = [BUILDINGS[type].name.toUpperCase()];
    const cost = Object.entries(buildCost(type, site))
      .map(([rid, amt]) => costPart(amt ?? 0, RESOURCES[rid as ResourceId].glyph, res[rid as ResourceId] ?? 0));
    if (cost.length) parts.push(cost.join(' '));
    const def = effectiveDef(type, game.mods);
    const robotic = $vitals.get().expedition === 'robotic';
    const p = effectiveRates(type, game.mods, site, undefined, { agentRun: robotic && def.crew > 0, robotic }).powerKW;
    if (Math.abs(p) >= 0.05) parts.push(`${p > 0 ? '+' : '−'}${kw(Math.abs(p))} kW`);
    parts.push('R rotate', '⇧ keep placing');
    return parts.join(' · ');
  };
  let hintHtml = '';
  const renderHint = () => {
    const p = $placing.get();
    if (!p) { hint.style.display = 'none'; hintHtml = ''; return; }
    hint.style.display = '';
    const html = `<span class="label hint-line">${hintLine(p.type)}</span>${p.valid
      ? `${p.note ? `<div class="deposit-note">${p.note}</div>` : ''}${p.warn ? `<div class="caution">${p.warn}</div>` : ''}`
      : p.reason ? `<div class="blocked">${p.reason}</div>` : ''}`;
    if (html !== hintHtml) { hintHtml = html; hint.innerHTML = html; }
  };
  $placing.subscribe(renderHint);
  $resources.subscribe(() => { if ($placing.get()) renderHint(); });
  // a click on a blocked spot: the hint flashes (restarting the animation)
  $placeFlash.subscribe((n) => {
    if (!n) return;
    hint.classList.remove('flash');
    void hint.offsetWidth;
    hint.classList.add('flash');
    hint.dataset.flash = String(n);
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
            : def.powerKW > 0 ? ` · −${Math.round(AGENT_GEN_TAX * 100)}% kW` : ` · ${mult(1 + game.mods.agentTax)} kW`}`
          : 'OPERATING')
        : 'STANDBY';
    const shadowNote = sel.type === 'solar' && sel.shaded ? ' · IN TERRAIN SHADOW −85%' : '';
    return `${status}${shadowNote}${worn >= 1 ? ` · WORN −${worn}%` : ''}${sel.dust > 0.15 ? ` · DUST −${Math.round(sel.dust * 100)}%` : ''}`;
  };
  const setText = (id: string, text: string) => {
    const e = insp.querySelector(`#${id}`);
    if (e && e.textContent !== text) e.textContent = text;
  };
  /** Dynamic Clocking's line: the running countdown to WORN, or why it cannot
   *  be pushed. Overclocked, paid upkeep no longer heals; short of parts, the
   *  ordinary wear adds on top (economy step 6). */
  const overclockLine = (sel: BuildingState): string => {
    const ocRate = OVERCLOCK.wearPerDay / CYCLE_S;
    const shortRate = sel.type !== 'lander' && $resources.get().parts <= 0.01 ? WEAR.risePerDay / CYCLE_S : 0;
    const eta = (rate: number) => fmtClock(Math.max(0, OVERCLOCK.tripWear - sel.wear) / rate);
    if (sel.overclock) {
      return sel.active
        ? `OVERCLOCKED ×${OVERCLOCK.mult} · WORN in ${eta(ocRate + shortRate)}`
        : `OVERCLOCKED ×${OVERCLOCK.mult} · idle — wears only while it runs`;
    }
    if ((sel.construction ?? 0) > 0) return 'Nameplate · a site under construction has no clock to push yet';
    if (sel.wear >= OVERCLOCK.tripWear) return 'Nameplate · WORN — paid upkeep heals it before it can overclock';
    return `Nameplate · overclocked it would reach WORN in ${eta(ocRate + shortRate)}`;
  };
  /** '⇪ Downlink 150≡ → 60◆ 20⚙ 5▣ (½ day)', and why the Lander would refuse it */
  const downlinkText = (): { label: string; title: string } => {
    const cost = downlinkCost(game.state);
    const cargo = Object.entries(DOWNLINK.cargo)
      .map(([rid, amt]) => `${amt}${RESOURCES[rid as ResourceId].glyph}`).join(' ');
    const days = DOWNLINK.delayS / CYCLE_S;
    const when = days === 0.5 ? '½ day' : days === 1 ? '1 day' : fmtClock(DOWNLINK.delayS);
    const have = Math.floor($vitals.get().data);
    const why = $lander.get().resupplyPending ? ' — waits: one shipment at a time, and one is en route'
      : have < cost ? ` — needs ${cost}≡ banked, have ${have}` : '';
    return {
      label: `⇪ Downlink ${cost}≡ → ${cargo} (${when})`,
      title: `Sell ${cost}≡ of banked research data to Earth for ${cargo}, landing in ${fmtClock(DOWNLINK.delayS)}${why}`,
    };
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
    setText('insp-feed', feedLine(game, sel.type, $feed.get()));
    setText('insp-oc', overclockLine(sel));
    const dl = insp.querySelector<HTMLButtonElement>('#insp-downlink');
    if (dl) {
      const t = downlinkText();
      if (dl.textContent !== t.label) dl.textContent = t.label;
      if (dl.title !== t.title) dl.title = t.title;
    }
  };
  const NOTE = 'class="goal-hint" style="font-size:11px; margin-top:4px; color:rgba(245,247,249,0.52)"';
  /** Head (name, status) and foot (every button) stay in view; the stat body
   *  between them scrolls when the screen is short, so no button is ever
   *  below the fold. */
  const buildInspector = (sel: BuildingState) => {
    const def = BUILDINGS[sel.type];
    const conRemaining = sel.construction ?? 0;
    const untouched = untouchedSite(sel);
    const refund = Object.entries(demolishRefund(sel, SITES[$siteId.get() ?? 'mare']))
      .map(([rid, amt]) => `${amt} ${RESOURCES[rid as ResourceId].name.toLowerCase()}`).join(' · ');
    const vit = $vitals.get();
    const crewToggle = canToggleCrew(vit.expedition, vit.crew, $tech.get());
    const lander = $lander.get();
    const orderDays = lander.orderDays;
    const isLander = sel.type === 'lander';
    const crewAll = isLander && crewToggle && vit.crew > 0 && lander.agentRun > 0;
    const downlink = isLander && game.mods.actions.has('downlink');
    const overclock = OVERCLOCKABLE.includes(sel.type) && game.mods.actions.has('overclock');
    insp.innerHTML = `
      <div class="insp-head"><section><div class="tt-name"><span>${ICONS[sel.type]} ${def.name}</span>
        <span class="label">#${sel.id}</span></div>
        <span class="label" id="insp-status"></span></section>
      <section>${ioRows(sel.type, game.mods, sel)}</section>
      ${sel.deposit ? `<section><span class="label">◎ ${DEPOSIT_INFO[sel.deposit].ghost}</span></section>` : ''}
      ${feedLine(game, sel.type, $feed.get()) ? '<section><span class="label mono" id="insp-feed"></span></section>' : ''}
      <section>
        <span class="label">Condition <span class="mono" style="float:right" id="insp-cond"></span></span>
        <div class="prog" style="height:4px; margin-top:5px; background:rgba(245,247,249,0.06)">
          <i id="insp-cond-bar" style="display:block; height:100%"></i>
        </div>
        <div ${NOTE} id="insp-cond-hint"></div>
      </section>
      <section><div class="pro">${def.pro}</div><div class="con">${def.con}</div></section>
      ${isLander ? `<section>
        <span class="label">◎ Deposits are mapped inside the survey radius — overlay [I]</span>
        <div ${NOTE}>Shipment: +${RESUPPLY.metals} metals · +${RESUPPLY.parts} parts${vit.crew > 0 ? ` · morale −${RESUPPLY.moraleHit} (the crew resents the umbilical)` : ''}. Each order waits a lunar day longer than the last; Earth's rescue of a stranded base does not.</div>
        ${downlink ? `<div ${NOTE}>Downlink: banked research data sold to Earth for cargo, through the same one shipment slot; each costs ${DOWNLINK.stepData}≡ more than the last.</div>` : ''}
        ${crewAll ? `<div ${NOTE}>Crew all: settlers take agent-run stations in priority order while free hands last; the rest stay agent-run.</div>` : ''}
      </section>` : ''}
      </div>
      <div class="insp-foot">
      <section>
        <span class="label">Idle priority (0 = last to brown out)</span>
        <div class="prio">${[0, 1, 2, 3].map((p) =>
          `<button class="btn prio-btn${sel.priority === p ? ' active' : ''}" data-p="${p}">${p}</button>`).join('')}</div>
      </section>
      ${isLander ? `<section>
        <span class="label">Lander services — mission HQ</span>
        <div class="prio" style="flex-wrap:wrap">
          <button class="btn" id="insp-map">◎ Open Lunar Map [M]</button>
          ${lander.resupplyPending
            ? '<span class="label" id="insp-eta"></span>'
            : `<button class="btn" id="insp-order">▲ Order Earth shipment — arrives in ${orderDays} day${orderDays === 1 ? '' : 's'}</button>`}
          ${downlink ? '<button class="btn" id="insp-downlink"></button>' : ''}
          ${crewAll ? `<button class="btn" id="insp-crewall">${PERSON_SVG} Crew all eligible stations</button>` : ''}
        </div>
      </section>` : ''}
      ${def.crew > 0 && crewToggle ? `<section>
        <span class="label">Operations — ${def.powerKW > 0
          ? `agents keep ${Math.round((1 - AGENT_GEN_TAX) * 100)}% of the output`
          : `agents draw ${mult(1 + game.mods.agentTax)} power`}, need no crew or morale</span>
        <div class="prio">
          <button class="btn${sel.automated ? '' : ' active'}" id="insp-crewed">${PERSON_SVG} Crewed</button>
          <button class="btn${sel.automated ? ' active' : ''}" id="insp-auto">◉ Autonomous</button>
        </div>
      </section>` : ''}
      ${overclock ? `<section>
        <span class="label" title="Overclocked: ×${OVERCLOCK.mult} power draw, inputs, outputs and data; wear +${OVERCLOCK.wearPerDay}/day even with upkeep paid, and it trips itself back to nameplate at WORN">Clock — ×${OVERCLOCK.mult} everything, wear +${OVERCLOCK.wearPerDay}/day</span>
        <div class="prio">
          <button class="btn${sel.overclock ? '' : ' active'}" id="insp-oc-off" aria-pressed="${!sel.overclock}">Nameplate</button>
          <button class="btn${sel.overclock ? ' active' : ''}" id="insp-oc-on" aria-pressed="${!!sel.overclock}">⏫ Overclock ×${OVERCLOCK.mult}</button>
        </div>
        <div ${NOTE} id="insp-oc"></div>
      </section>` : ''}
      ${conRemaining > 0 && sel.enabled && sel.idleReason === 'queued' ? `<section>
        <span class="label">Robot queue — sites build in placement order</span>
        <div class="prio"><button class="btn" id="insp-buildnext">Build next</button></div>
      </section>` : ''}
      <section class="actions">
        ${!isLander ? `<button class="btn" id="insp-toggle">${conRemaining > 0
          ? (sel.enabled ? 'Pause' : 'Resume')
          : (sel.enabled ? 'Shut down' : 'Power on')}</button>` : ''}
        ${!isLander ? `<button class="btn" id="insp-demolish" title="Refund: ${refund || 'nothing'}">${untouched ? 'Cancel ↩' : 'Demolish ½↩'}</button>` : ''}
        <button class="btn" id="insp-close">✕</button>
      </section>
      </div>`;
  };
  $selection.subscribe((sel) => {
    if (!sel) { insp.style.display = 'none'; inspSig = ''; return; }
    const vit = $vitals.get();
    const lander = $lander.get();
    const site = (sel.construction ?? 0) > 0;
    const sig = [
      sel.id, sel.type, sel.enabled, sel.automated, sel.priority, site, sel.overclock, sel.deposit,
      sel.type === 'lab' ? $research.get()?.agentLabs : '', game.mods.agentTax,
      site && sel.idleReason === 'queued', untouchedSite(sel),
      canToggleCrew(vit.expedition, vit.crew, $tech.get()), vit.expedition, vit.crew > 0,
      sel.deposit ?? '', lander.resupplyPending, lander.orderDays, lander.agentRun > 0,
      [...game.mods.actions].sort().join(','),
    ].join('|');
    if (sig !== inspSig) {
      inspSig = sig;
      buildInspector(sel);
    }
    insp.style.display = ''; // the stylesheet decides: walk mode hides it
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
      case 'insp-order': game.actions.push({ kind: 'orderResupply' }); break;
      case 'insp-downlink': game.actions.push({ kind: 'downlink' }); break;
      case 'insp-map': window.dispatchEvent(new CustomEvent('moonshots:open-map')); break;
      case 'insp-crewall': game.actions.push({ kind: 'crewAll' }); break;
      case 'insp-crewed': game.actions.push({ kind: 'setAutomated', id: sel.id, automated: false }); break;
      case 'insp-auto': game.actions.push({ kind: 'setAutomated', id: sel.id, automated: true }); break;
      case 'insp-oc-on': game.actions.push({ kind: 'setOverclock', id: sel.id, on: true }); break;
      case 'insp-oc-off': game.actions.push({ kind: 'setOverclock', id: sel.id, on: false }); break;
      case 'insp-demolish': game.actions.push({ kind: 'demolish', id: sel.id }); break;
      case 'insp-close': $selection.set(null); break;
    }
  });
}
