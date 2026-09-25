/** Resource info panels — click any HUD chip to learn what produces it, what
 *  consumes it, how much you can store, and how to get more. The in-game
 *  answer to "I'm out of oxygen, what do I build?" */
import { BUILDINGS, BUILD_ORDER, type BuildingId } from '../data/buildings';
import { RESOURCES, type ResourceId } from '../data/resources';
import {
  CONSTRUCTION_KW, CONSTRUCTION_PARTS_PER_S, CREW, FLEET, DATA_RATE, LAUNCH_CAP_PER_VOLLEY, LAUNCH_COST_FOILS,
  LAUNCH_POWER_BURST, MORALE, RESEARCH_RATE_PER_DC, RESEARCH_RATE_PER_LAB, RESUPPLY,
} from '../data/balance';
import { SITES } from '../data/sites';
import { effectiveDef, effectiveRates, type EffectiveRates, type Mods } from '../core/mods';
import type { Game } from '../core/game';
import { fmtClock } from '../core/daynight';
import type { ReadableAtom } from 'nanostores';
import { el, fmt, perFrame, PERSON_SVG } from './hud';
import {
  $caps, $counts, $feed, $lander, $power, $rates, $research, $resourcePanel, $resources, $siteId, $tech,
  $time, $vitals,
} from './stores';
import { FEED_KINDS, FEED_LABEL } from '../data/deposits';
import { TECHS, TECH_ORDER } from '../data/techs';
import { mountBuilderSection } from './builderPanel';

function techThatUnlocks(b: BuildingId): string | null {
  for (const tid of TECH_ORDER) {
    for (const fx of TECHS[tid].effects) {
      if (fx.kind === 'unlock' && fx.building === b) return TECHS[tid].name;
    }
  }
  return null;
}

function buildingLine(type: BuildingId, rate: number, sign: '+' | '−'): string {
  const counts = $counts.get()[type];
  const unlocked = $tech.get().unlocked.includes(type);
  const status = counts?.total
    ? `×${counts.total} (${counts.active} running${counts.dark ? `, ${counts.dark} dark` : ''})`
    : unlocked ? 'none built — in palette'
    : `locked — ${techThatUnlocks(type) ?? 'research'}`;
  return `<div class="row"><span>${BUILDINGS[type].name}</span>
    <span class="mono">${sign}${fmt(rate * 60)}/min · ${status}</span></div>`;
}

/** one building's nameplate rates under the live mods; a new station on a
 *  robotic mission runs on agents (game.commitPlace) */
function ratesOf(type: BuildingId, mods: Mods): EffectiveRates {
  const robotic = $vitals.get().expedition === 'robotic';
  const agentRun = robotic && BUILDINGS[type].crew > 0;
  const rv = $research.get();
  return effectiveRates(type, mods, SITES[$siteId.get() ?? 'mare'], undefined, {
    agentRun, robotic, uplinkShare: type === 'lab' && agentRun ? rv?.uplinkShare ?? 1 : 1,
  });
}

const mult = (v: number) => `×${Math.round(v * 100) / 100}`;
const kw = (v: number) => String(Math.round(v * 10) / 10);

const row = (name: string, value: string) =>
  `<div class="row"><span>${name}</span><span class="mono">${value}</span></div>`;

/** The regolith panel's stacked bar of what the excavators dug last. */
function feedSection(): string {
  const g = $feed.get();
  const dug = FEED_KINDS.filter((k) => g[k] > 0.005);
  if (!dug.length) {
    return '<section><span class="label">Feed (recent loads)</span><div class="goal-hint">Nothing delivered yet. Excavators haul what they dig to the nearest smelter or refinery: the ground each one digs sets the feed.</div></section>';
  }
  const segs = dug.map((k, i) =>
    `<i class="feed-seg${i % 2 ? ' alt' : ''}" style="width:${(g[k] * 100).toFixed(1)}%" title="${FEED_LABEL[k]}"></i>`).join('');
  const legend = dug.map((k) => `${Math.round(g[k] * 100)}% ${FEED_LABEL[k]}`).join(' · ');
  return `<section><span class="label">Feed (recent loads)</span>
    <div class="feed-bar">${segs}</div><div class="goal-hint mono">${legend}</div>
    <div class="goal-hint">The mix of the last few loads the excavators delivered, by amount. High-Ti basalt lifts the H₂ smelter, highland anorthosite the refinery; select an excavator and Dig at… a deposit (the overlay [I] shows them) — far ground delivers less per minute.</div></section>`;
}

/** signed per-minute rate: '+4.2', '−0.8', '0' */
function perMin(ratePerS: number): string {
  const m = ratePerS * 60;
  return fmt(Math.abs(m)) === '0' ? '0' : (m >= 0 ? '+' : '−') + fmt(Math.abs(m));
}

const NOTES: Partial<Record<string, string>> = {
  oxygen: 'Smelters exhale oxygen while smelting regolith — industry keeps the crew breathing. Crew consume it constantly; Closed-Loop Life Support cuts that 40%.',
  food: 'Hydroponics grow food from water and power. Crew eat around the clock; low reserves make everyone anxious.',
  water: 'Ice Harvesters mine polar deposits (survey first); smelting regolith recovers a trickle everywhere. The crew drinks first: farms stand idle rather than take the last five minutes of the crew’s water.',
  regolith: 'Excavators dig it and haul it to the nearest smelter or refinery (the Lander when there is none); it counts once unloaded. Nearly every industry eats it. Stockpile capacity comes from the Lander and Storage Yards.',
  metals: 'Smelted from regolith. If you run dry with no smelter, Earth sends an emergency shipment — a full day away.',
  silicon: 'Refined from regolith. Feeds batteries, foils, and the entire endgame.',
  parts: `Made by Parts Fabricators. EVERY building burns parts as upkeep — run dry and machines wear, losing up to half their output (the Lander never wears). Paid upkeep repairs them again. No fabricator yet? Order an Earth shipment at the Lander (+${RESUPPLY.metals} metals, +${RESUPPLY.parts} parts; the first is a lunar day out, each later order a day longer) — Earth sends one on its own when the cache drops below ${RESUPPLY.partsFloor}.`,
  chips: 'Chip Fabs turn lunar silicon into wafers and accelerators. Data Centers are built from them; late research and swarm doctrine consume them.',
  foils: `Foil Factories turn silicon and metals into collectors. ${LAUNCH_COST_FOILS} foils go up with each swarm volley.`,
  launch: `Mass Drivers accrue launch capacity each window. ${LAUNCH_CAP_PER_VOLLEY}↑ capacity + ${LAUNCH_COST_FOILS} foils + ${LAUNCH_POWER_BURST} stored energy = one launch.`,
};

/** a crewless robotic base: life support is banked for the settlers to come */
const NOTES_UNCREWED: Partial<Record<string, string>> = {
  oxygen: `Smelters exhale oxygen while smelting regolith. Nobody breathes it yet — the tanks bank it for ${TECHS.humanCohabitation.name}, when settlers board only with a lunar day of oxygen, food and water for each, or production that covers them.`,
  food: `Hydroponics grow food from water and power. Nobody eats yet — a stocked larder is what lets settlers board after ${TECHS.humanCohabitation.name}.`,
  water: `Ice Harvesters mine polar deposits (survey first); smelting regolith recovers a trickle everywhere. Hydroponics drink it now; settlers will after ${TECHS.humanCohabitation.name}.`,
};

/** the panel's content for `key`, or null when there is none */
function panelHtml(key: string, mods: Mods): string | null {
  const v = $vitals.get();
  const t = $tech.get();
  const lsMult = mods.inputMult.habitat;
  const lander = $lander.get();
  // what the sim runs on (economy.ts): each site's draw, each Bay's robots
  const siteKW = kw(CONSTRUCTION_KW * mods.constructionKWMult);

  if (key === 'crew') {
    return `
      <section><div class="tt-name"><span>${PERSON_SVG} Crew</span><span class="mono">${v.crew} aboard · ${v.housing} beds</span></div>
        ${v.beds > v.housing ? `<span class="label">${v.beds - v.housing} of ${v.beds} beds dark — shut down or unpowered</span>` : ''}</section>
      <section>
        <span class="label">At stations</span>
        ${row('Crewed stations want', `${v.seats} crew`)}
        ${row('Aboard', `${v.crew} crew`)}
        ${v.covered ? row('Agents covering', `${v.covered} station${v.covered === 1 ? '' : 's'}`) : ''}
        ${v.crewIdle ? `<div class="goal-hint crew-short">${v.crewIdle} station${v.crewIdle === 1 ? '' : 's'} idle — no crew free</div>` : ''}
        <div class="goal-hint">Free beds only let more settlers arrive: everyone aboard already works a station. Workers go to priority 0 first, then 1, 2 and 3; a station whose storage is full stands by without taking any.</div>
        ${v.canCover
          ? `<label class="dsc-off crew-cover"><input type="checkbox" data-act="agent-cover"${v.agentCover ? ' checked' : ''}> Agents cover short-handed stations (${mult(1 + mods.agentTax)} power); settlers take them back as they free up</label>`
          : `<div class="goal-hint">${TECHS.constructionRobotics.name} (Era ${TECHS.constructionRobotics.era}) lets agents run the stations nobody can staff.</div>`}
      </section>
      <section>
        <span class="label">How settlers arrive</span>
        <div class="goal-hint">One new settler per lunar day while morale is above ${CREW.growthMorale}%, a powered bed is free, and nobody is starving. Nobody boards unless oxygen, food and water can each keep one more person alive for a lunar day at the current rates — a day's reserve, or production that covers them. Habitats add 4 beds each and extend the build perimeter.</div>
        ${v.boardingHold ? `<div class="goal-hint">Arrivals on hold — not enough ${RESOURCES[v.boardingHold].name.toLowerCase()} for another settler.</div>` : ''}
      </section>
      <section>
        <span class="label">Each settler consumes</span>
        ${row('Oxygen', `−${fmt(CREW.oxygenPerCrew * lsMult * 60)}/min`)}
        ${row('Food', `−${fmt(CREW.foodPerCrew * lsMult * 60)}/min`)}
        ${row('Water', `−${fmt(CREW.waterPerCrew * lsMult * 60)}/min`)}
        <div class="goal-hint">${TECHS.closedLoopLS.name} (Era ${TECHS.closedLoopLS.era}) cuts all three by 40%. ${TECHS.constructionRobotics.name} (Era ${TECHS.constructionRobotics.era}) lets buildings run without crew at ${mult(1 + mods.agentTax)} power.</div>
      </section>`;
  }
  if (key === 'power') {
    const p = $power.get();
    const time = $time.get();
    const drain = p.demand - p.supply;
    const dark = p.demand - p.served;
    const gen = (['solar', 'reactor', 'lander'] as BuildingId[])
      .map((b) => buildingLine(b, 0, '+').replace('+0/min', `+${kw(ratesOf(b, mods).powerKW)} kW`)).join('');
    const draws = BUILD_ORDER.filter((b) => effectiveDef(b, mods).powerKW < 0)
      .map((b) => buildingLine(b, 0, '−').replace('−0/min', `−${kw(-ratesOf(b, mods).powerKW)} kW`)).join('');
    return `
      <section><div class="tt-name"><span>⚡ Power</span><span class="mono">+${fmt(p.supply)} / ${fmt(p.demand)} kW</span></div>
        <span class="label">${dark >= 0.1 ? `${fmt(dark)} kW of loads dark` : drain > 0.01 ? 'the bank covers the shortfall' : 'generation covers demand'}
          · stored ${fmt(p.stored)} / ${fmt(p.capacity)}${drain > 0.01 ? ` · lasts ${fmtClock(p.stored / drain)}` : ''}
          · ${time.isNight ? `dawn in ${fmtClock(time.phaseLeft)}` : `dusk in ${fmtClock(time.phaseLeft)}`}</span></section>
      <section><span class="label">Generation</span>${gen}
        <div class="goal-hint">Solar dies at night; batteries store the day (${Math.round((1 - mods.storageEff) * 100)}% round-trip loss); reactors don't care.</div></section>
      <section><span class="label">Draws</span>${draws}
        <div class="goal-hint">Construction sites pull ${siteKW} kW per working rover while building. Under shortage, high-priority-number buildings idle first: idling only priority 2–3 loads is a LOAD SHED; a dark priority 0–1 load is a BROWNOUT.</div></section>`;
  }
  if (key === 'bots') {
    return `
      <section><div class="tt-name"><span>◉ Construction rovers</span><span class="mono">${v.botsFree}/${v.botsTotal} free</span></div></section>
      <section><span class="label">Fleet sources</span>
        ${buildingLine('lander', 0, '+').replace('+0/min', `+${BUILDINGS.lander.bots ?? 0} rovers`)}
        ${buildingLine('roboticsBay', 0, '+').replace('+0/min', `+${(BUILDINGS.roboticsBay.bots ?? 0) + mods.botPerBay} rovers`)}
        ${v.surveying ? `<div class="goal-hint">${v.surveying} more rover${v.surveying === 1 ? ' is' : 's are'} out on a survey — back when it ends.</div>` : ''}
        <div class="goal-hint">Rovers take the construction queue one site each; each working rover draws ${siteKW} kW. More rovers = more parallel construction.</div>
        <div class="goal-hint">To speed one build, select a rover and Send it there, or select the site and Summon one: rovers on one site build ×n^${FLEET.rateExp} (2 → ×${(2 ** FLEET.rateExp).toFixed(2)}), each drawing its own ${siteKW} kW, on the same weld parts.</div></section>`;
  }
  if (key === 'morale') {
    return `
      <section><div class="tt-name"><span>◐ Morale</span><span class="mono">${v.morale}%</span></div></section>
      <section><span class="label">Raises it</span>
        ${row('Fed & breathing', `+${MORALE.fed}`)}
        ${row('Hydroponics (fresh food)', '+5')}
        ${row('Recreation Dome', '+14')}</section>
      <section><span class="label">Sinks it</span>
        ${row('Low oxygen/food/water reserves', '−10 each')}
        ${row('Brownouts (priority 0–1 dark)', `−${-MORALE.blackout}`)}
        ${row('Load shedding (priority 2–3 idled)', `−${-MORALE.shed}`)}
        ${row('Overcrowding', `−${-MORALE.crowded}`)}
        ${row('Solar flare, while it lasts', `−${-MORALE.flare}`)}
        ${row('Earth shipment ordered', `−${RESUPPLY.moraleHit} once`)}
        ${row('Reactor next door', '−5')}
        <div class="goal-hint">Morale multiplies crewed output (×0.5 – ×1.2) and gates settler arrivals (>${CREW.growthMorale}%).</div></section>`;
  }
  if (key === 'data') {
    const counts = $counts.get();
    const rv = $research.get();
    const agentLab = v.expedition === 'robotic';
    const labs = rv?.labsActive ?? counts.lab?.active ?? 0;
    const dcs = rv?.dcsActive ?? counts.dataCenter?.active ?? 0;
    // the cap is what the labs could move; the sim's own average is what they do
    const cap = rv?.cap ?? RESEARCH_RATE_PER_LAB * labs + RESEARCH_RATE_PER_DC * dcs;
    const moved = rv?.rate ?? 0;
    const share = rv && rv.agentLabs > 0 ? rv.uplinkShare : 1;
    const operating = `${labs} lab${labs === 1 ? '' : 's'}, ${dcs} data center${dcs === 1 ? '' : 's'} operating`;
    return `
      <section><div class="tt-name"><span>≡ Research data</span><span class="mono">${fmt(v.data)}</span></div>
        <span class="label">${!t.queue.length
          ? `no research queued${cap > 0 ? ` · ${operating}` : ''}`
          : cap > 0
            ? `feeding research ${fmt(moved * 60)}/min of ${fmt(cap * 60)}/min · ${operating}`
            : 'research stalled — no operating lab or data center'}</span></section>
      <section><span class="label">Produced by</span>
        ${buildingLine('lab', ratesOf('lab', mods).data, '+')}
        ${buildingLine('dataCenter', ratesOf('dataCenter', mods).data, '+')}
        ${$tech.get().unlocked.includes('serverMonolith') || $counts.get().serverMonolith?.total
          ? buildingLine('serverMonolith', ratesOf('serverMonolith', mods).data, '+') : ''}
        ${agentLab ? `<div class="goal-hint">Agent-run labs hold ${Math.round(DATA_RATE.agentLabCap * 100)}% — inference is not insight; settlers staffing them lift the cap. Crewed labs scale with morale.</div>` : ''}
        ${share < 1 ? `<div class="goal-hint">${rv!.agentLabs} agent-run labs share one Deep Space Network uplink: each keeps ${Math.round(share * 100)}% of its data.</div>` : ''}
        <div class="goal-hint">Each OPERATING lab also feeds at most ${fmt(RESEARCH_RATE_PER_LAB * 60)}/min of banked data into the research queue — no lab, no research progress. A Data Center moves ${fmt(RESEARCH_RATE_PER_DC * 60)}/min, ${Math.floor(RESEARCH_RATE_PER_DC / RESEARCH_RATE_PER_LAB)} labs' worth, and produces data itself; big eras want compute.</div></section>`;
  }

  const rid = key as ResourceId;
  const def = RESOURCES[rid];
  if (!def) return null;
  const stock = $resources.get()[rid] ?? 0;
  const cap = $caps.get()[rid];
  const rate = $rates.get()[rid] ?? 0;
  const hasIce = SITES[$siteId.get() ?? 'mare'].hasIce;
  const makers = BUILD_ORDER.filter((b) => (effectiveDef(b, mods).outputs[rid] ?? 0) > 0);
  const producers = makers.filter((b) => hasIce || !BUILDINGS[b].requiresIce)
    .map((b) => buildingLine(b, ratesOf(b, mods).outputs[rid] ?? 0, '+')).join('');
  const iceless = makers.some((b) => BUILDINGS[b].requiresIce) && !hasIce
    ? '<div class="goal-hint">No ice at this site — Ice Harvesters need polar deposits.</div>' : '';
  const consumers = BUILD_ORDER.filter((b) => (effectiveDef(b, mods).inputs[rid] ?? 0) > 0)
    .map((b) => buildingLine(b, ratesOf(b, mods).inputs[rid] ?? 0, '−')).join('');
  const crewDraw = rid === 'oxygen' || rid === 'food' || rid === 'water' ? v.lifeSupport[rid] : 0;
  const shipped = rid === 'metals' ? RESUPPLY.metals : rid === 'parts' ? RESUPPLY.parts : 0;
  const extraIn = shipped ? row('Earth shipment', `+${shipped} · ${lander.resupplyPending
    ? `lands in ${fmtClock(lander.etaS)}`
    : `order at the Lander, ${lander.orderDays} day${lander.orderDays === 1 ? '' : 's'}`}`) : '';
  const extraOut = [
    crewDraw > 0 ? row(`Crew ×${v.crew}`, `−${fmt(crewDraw * 60)}/min`) : '',
    rid === 'parts' ? row('Upkeep · every structure', `−${fmt(v.upkeep * 60)}/min`) : '',
    rid === 'parts' && v.welding > 0
      ? row(`Welding · ${v.welding} site${v.welding === 1 ? '' : 's'}`, `−${fmt((v.weldParts || v.welding * CONSTRUCTION_PARTS_PER_S) * 60)}/min`) : '',
    rid === 'metals' || rid === 'parts'
      ? row('Construction', `paid at placement${v.sites ? ` · ${v.sites} site${v.sites === 1 ? '' : 's'} underway` : ''}`) : '',
  ].join('');
  const note = (v.expedition === 'robotic' && v.crew <= 0 && NOTES_UNCREWED[rid]) || NOTES[rid];
  // how long until the stock runs out, or the store fills, at the net rate
  const eta = rate < -1e-4 && stock > 0.01 ? ` · empties in ${fmtClock(stock / -rate)}`
    : rate > 1e-4 && cap !== undefined ? (stock >= cap - 1 ? ' · full' : ` · fills in ${fmtClock((cap - stock) / rate)}`)
    : '';
  return `
    <section><div class="tt-name"><span>${def.glyph} ${def.name}</span>
      <span class="mono">${fmt(stock)}${cap ? ` / ${fmt(cap)}` : ''}</span></div>
      <span class="label">net ${perMin(rate)}/min${eta} · ${def.desc}</span></section>
    <section><span class="label">Produced by</span>${producers}${extraIn}${iceless}
      ${!producers && !extraIn && !iceless ? '<div class="goal-hint">Nothing on the Moon makes this yet.</div>' : ''}</section>
    <section><span class="label">Consumed by</span>${consumers}${extraOut}
      ${!consumers && !extraOut ? '<div class="goal-hint">Nothing consumes this directly.</div>' : ''}</section>
    ${rid === 'regolith' ? feedSection() : ''}
    ${cap !== undefined ? `<section><span class="label">Storage</span>
      <div class="goal-hint">Capacity ${fmt(cap)} from the Lander and Storage Yards. Excess production is lost on the ground; a producer whose every output is full stands by instead of burning its inputs.</div></section>` : ''}
    ${note ? `<section><span class="label">Field notes</span><div class="goal-hint">${note}</div></section>` : ''}`;
}

export function mountInfoPanel(root: HTMLElement, game: Game) {
  const panel = el('div', 'panel interactive');
  panel.id = 'res-panel';
  panel.style.display = 'none';
  // the body re-renders when its html changes; Close is built once, so it
  // never detaches under the cursor
  const body = el('div', 'res-body');
  const actions = el('section', 'actions', '<button class="btn" id="res-panel-close">Close</button>');
  panel.append(body, actions);
  (root.querySelector('#hud-left') ?? root).appendChild(panel);
  actions.querySelector('#res-panel-close')!.addEventListener('click', () => $resourcePanel.set(null));
  // the Builder's orders and rules for this resource: stable DOM, outside the re-rendered body
  mountBuilderSection(panel, actions, game);
  body.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-act="agent-cover"]')) game.actions.push({ kind: 'setAgentCover', on: t.checked });
  });

  let lastHtml = '';
  const render = () => {
    const key = $resourcePanel.get();
    const html = key ? panelHtml(key, game.mods) : null;
    if (html === null) { panel.style.display = 'none'; lastHtml = ''; return; }
    panel.style.display = ''; // the stylesheet's flex column; walk mode hides it
    if (html !== lastHtml) { lastHtml = html; body.innerHTML = html; }
  };
  const schedule = perFrame(render);
  for (const store of [$resourcePanel, $counts, $vitals, $resources, $rates, $caps, $power, $tech, $lander, $time, $feed, $research] as ReadableAtom<unknown>[]) {
    store.subscribe(schedule);
  }
}
