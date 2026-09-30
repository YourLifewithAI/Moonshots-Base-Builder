/** The running tutorial: a card for every finished tech (what it is, what
 *  you gain, what visibly changes and what to do next), and an explainer
 *  when an era opens (what the era means, what it brings, how the next one
 *  opens). An era explainer pauses the game until Continue; tech cards never
 *  do. One setting turns both off (Esc menu, or the card's own switch) for
 *  players who know the road. The queue is filled by game.publish().
 *
 *  Three of the notification families live here (docs/19 S7, notify.ts):
 *  research (`#discovery-card`, RESEARCH COMPLETE, top centre), era
 *  (`#era-banner`, full screen, until Continue) and hazard (`#hazard-card`,
 *  the first-of-a-kind drill's card and HAZARDS ARE LIVE: it holds the game
 *  paused unless the menu's "Pause on hazard drills" is off). */
import { touchOn } from '../core/touch';
import { BUILDINGS, CATEGORY_LABEL, type BuildingId } from '../data/buildings';
import {
  ERA_BLURB, ERA_BLURB_8, ERA_GATES, ERA_NAMES, LANES, SIDE_GLYPH, SIDE_LABEL, TECHS, TECH_ORDER, TRACKS,
  describeTech, effectApplies, type Era, type TechEffect, type TechId,
} from '../data/techs';
import { destinyOf, resolveTech, techVisible } from '../core/research';
import { CREW, CREW_ROTATION, LAUNCH_COST_FOILS, PURE_AT } from '../data/balance';
import { RESOURCES } from '../data/resources';
import type { GameState } from '../core/state';
import { destinyPips, reachLine } from './techDestiny';
import type { AutoFamily } from '../data/automation';
import { CHARTER_DEED_TECHS, CHARTER_TECHS } from '../data/balance';
import { loadSettings, saveSettings } from '../core/settings';
import type { Game } from '../core/game';
import { sfx } from '../audio/sfx';
import { el } from './hud';
import { openTechTreeAt } from './techTree';
import { $announce, $menuOpen, $phase, $time, announceHolds, type Announcement } from './stores';
import { FAMILY } from './notify';
import {
  COUNTERS, HAZARDS, HAZARD_NAME, HAZARDS_LIVE, RISK_TEXT, TIER_LABEL, type HazardId, type HazardSide,
} from '../data/hazards';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** A Builder family's Next line. */
const BUILDER_NEXT: Record<AutoFamily, string> = {
  excavation: 'The Builder now keeps regolith supplied: tune it with [B].',
  power: 'The Builder now keeps the day’s grid margin and the night covered: tune it with [B].',
  smelting: 'The Builder now keeps metals and silicon supplied, and adds a yard when research outgrows a store: tune it with [B].',
  fabrication: 'The Builder now keeps parts and chips coming, and adds Robotics Bays when sites wait: tune it with [B].',
  life: 'The Builder now keeps oxygen, food and water ahead of the crew, and a bed free: tune it with [B].',
  maintenance: 'Worn machines are replaced by the Builder: tune it with [B].',
  network: 'The Builder now plants Relay Masts toward ground its rules need: tune it with [B].',
  research: 'The Builder now adds labs when research waits on the transfer cap: tune it with [B].',
  export: 'The Builder now adds Foil Factories when foils hold a volley back: tune it with [B].',
};

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

/** What to do with a finished tech: the first effect that asks something of the player. */
function nextStep(fx: TechEffect[], s: GameState): string {
  for (const f of fx) {
    switch (f.kind) {
      // ── destiny (docs/14 §2.7) ──
      case 'bringsCrew':
        // only when this pick is the one that brought the crew
        if (s.crewRotation) {
          const R = CREW_ROTATION;
          return `Build a Hydroponics Farm and keep ${R.minFood}${RESOURCES.food.glyph}, ${R.minWater}${RESOURCES.water.glyph} and ` +
            `${R.minO2}${RESOURCES.oxygen.glyph}: the rotation boards in ${mmss(Math.max(0, s.crewRotation.at - s.simTime))}.`;
        }
        break;
      case 'growth':
        if (f.mult > 0) return `Keep morale up and a bed free: settlers now arrive every ${mmss(CREW.growthPeriod * f.mult)}.`;
        break;
      case 'waive': return 'Era 7 opens without Human Cohabitation: the base can stay unmanned for good.';
      case 'eva': return 'By day, free hands go out on EVA: leave a few crew unassigned to clear dust and mend machines.';
      case 'radius': return `${BUILDINGS[f.building].name}s reach further now: plant the next one farther out.`;
      case 'volley':
        if (f.minCrew) return `Launch day: keep ${f.minCrew} crew aboard, and a volley needs only ${f.launchCap ?? 3}${RESOURCES.launch.glyph}, with morale for a lunar day.`;
        break;
      case 'autoLaunch':
        return `Nothing to press: the rail fires when ${LAUNCH_COST_FOILS}${RESOURCES.foils.glyph}, the launch capacity and the charge are ready.`;
      case 'unlock': {
        if (f.building === 'waterPlant') return s.siteId === 'southpole'
          ? 'Pick the Water Management Plant: cold-trap ice lights up. Leave room for the full pit when placing its hub.'
          : 'Place a Water Management Plant by mature soil: its excavator brings soil to the retort.';
        if (f.building === 'solarObservatory') return 'Place a Solar Observatory in the sun: the ☉ chip shows the next flare’s window and likely class.';
        const b = BUILDINGS[f.building as BuildingId];
        return `Build it: ${CATEGORY_LABEL[b.category]} tab → ${b.name}.`;
      }
      case 'action':
        if (f.id === 'electrolysis') return 'Select a Water Management Plant and switch Electrolysis on: oxygen from water, with an extra power draw.';
        if (f.id === 'sentinel') return 'Select the Lander and Launch sentinel: a lunar day later the ☉ chip reads the class for sure, day and night.';
        return f.id === 'overclock'
          ? 'Select a production building and switch on Overclock ×1.5 in its panel.'
          : 'Select the Lander and press Downlink to trade banked data for a cargo drop.';
      case 'survey':
        if (f.precision !== undefined) return 'Surveyed deposits are re-read: ore and grade estimates now have tighter ranges.';
        if (f.tier) return 'The Lunar Map [M] reaches further: new prospects are waiting to be surveyed.';
        break;
      // flare forecasting (docs/16 §13.3)
      case 'forecast':
        return f.tier >= 3 ? 'Open ☉ [O]: the cycle and the next three flares.'
          : f.tier === 2 ? 'The ☉ chip now reads the class for sure, day and night, once the sentinel is on station.'
          : 'Place a Solar Observatory in the sun: the ☉ chip shows the next flare.';
      case 'launchAction': return 'Launch collectors from the swarm meter at the top of the screen.';
      case 'automation': return 'Stations can run on agents now: toggle Crewed / Autonomous in their panels.';
      case 'grading': return 'Rovers grade a dragged box twice as fast now, and can level tailings heaps: Grade Site is in the Extraction tab.';
      // fleet control (core/fleet.ts, core/haul.ts): the verbs that make these pay
      case 'construction':
        if ((f.rateMult ?? 1) > 1) return 'Every rover builds faster now. To rush one build, select the site and Summon more rovers onto it.';
        break;
      case 'botPerBay':
        if (f.delta > 0) return 'Each Robotics Bay docks another rover: select a site and Summon the spare ones onto the builds that matter.';
        break;
      case 'haul':
        return f.digMult ? 'Buckets fill faster, and pits grow faster: check whether the hub needs another unit or a better haul road.'
          : f.offroadMult ? 'Your units cross pits and ramps faster: the hub inspector shows their shorter trips.'
          : 'Hub units drive faster and carry more: compare the intake and free faces of the pits their hub can reach.';
      case 'hubLevel': return `Select a hub and press + Bay: a Level ${f.level === 2 ? 'II' : 'III'} hub holds ${f.level + 1} units before free-bay bonuses.`;
      case 'hubBays': return 'Every hub has one more bay: print another unit where its pit has a free face and the grid has headroom.';
      case 'hubPrint': return 'New unit print jobs finish faster. Each hub keeps its own queue.';
      case 'pitDepth': return 'Worked-out and hemmed-in pits can cut bedrock now. Their deposit cards show the slower ore below.';
      case 'grade': return 'The ore grade your units deliver is better now: check the hub’s product output.';
      case 'reclaim': return 'Keep a Water Management Plant operating: crew and farms draw less fresh water while its recovery loop runs.';
      // on-board power (core/unitPower.ts): what a unit does off the grid now
      case 'unitPower':
        if (f.rpu) return 'Every unit makes its own trickle now: through any brownout, rovers, drones and excavators keep working slowly.';
        if ((f.packMult ?? 1) > 1) {
          return 'Every unit carries a bigger pack: it works longer through a brownout before it stops. A unit\'s inspector shows its charge; they refill at their docks and pads.';
        }
        break;
      case 'road':
        if ((f.speedMult ?? 1) > 1 || (f.haulMult ?? 1) > 1 || (f.nightMult ?? 1) > 1) {
          return 'Every road carries its traffic faster now: link far structures with the road tool [N] — shortcuts pay more.';
        }
        break;
      // beds and morale act at once; a cut (a con) asks nothing of the player
      case 'housing':
        if (f.delta > 0) return `Every ${BUILDINGS[f.building].name} sleeps ${f.delta} more at once — room for the next arrivals.`;
        break;
      case 'morale':
        if (f.delta > 0) return `Every running ${BUILDINGS[f.building].name} lifts morale by ${f.delta}: keep them powered.`;
        break;
      // the Builder (docs/13 §5.4): what the new rule or tool does for you, and [B]
      case 'autoRule': return BUILDER_NEXT[f.family];
      case 'orders': return 'Order more than you can afford: the Builder places the rest as stock arrives. Open the order book with [B].';
      case 'siting': return 'Orders and rules now weigh deposits, peaks of light and haul lanes when they pick a site.';
      case 'governor': return 'Set reserve floors and the order rules act in: [B].';
      case 'predictive': return 'While a Data Center runs, rules act on forecasts: batteries before dusk.';
      case 'feedPlanner': return 'Excavators now re-aim at the feed the furnaces want; opt one out in its panel.';
      case 'maintenance': return 'Short of parts, upkeep now goes to priority 0 first, and worn machines are replaced: see the log in [B].';
      case 'builder': return 'The Builder reaches further: see what its rules can do now in [B].';
    }
  }
  return 'It takes effect at once — no action needed.';
}

/** A pick's `⚠ risk` line (docs/14 §3.10 rule 3): what its first exposure can do. */
function riskLine(fx: TechEffect[]): string {
  if (!HAZARDS_LIVE) return '';
  const x = fx.find((f) => f.kind === 'exposure');
  if (!x || x.kind !== 'exposure') return '';
  return `<div class="dsc-risk"><span class="label">⚠ risk</span> ${esc(RISK_TEXT[x.hazard])}</div>`;
}

/** HAZARDS ARE LIVE (docs/14 §3.10): the banner when a side first reaches 2 picks. */
function hazardsLiveHtml(side: HazardSide): string {
  const what = side === 'colony' ? 'colony can fail and people can die' : 'network can fail and machines can be lost';
  return `<div class="eb-panel">` +
    `<div class="label eb-k"><span class="nf-g" aria-hidden="true">${FAMILY.hazard.glyph}</span> ${side === 'colony' ? '⌂ COLONY' : '◉ AUTOMATION'}</div>` +
    `<h1 class="eb-name">HAZARDS ARE LIVE</h1>` +
    `<p class="eb-blurb">From Era 3 your ${what}. Every hazard is announced first, names its target and has a counter.</p>` +
    `<p class="eb-line">Open <b>[G]</b> to see the risks now. The first of each kind is a drill that cannot hurt anyone.</p>` +
    `<div class="eb-foot"><button class="btn primary" data-dsc="ok">Continue ▸</button></div></div>`;
}

/** NEW HAZARD (docs/14 §3.10): the drill's card — its counters, and what the next one does. */
function hazardHtml(kind: HazardId): string {
  const d = HAZARDS[kind];
  const counters = [...d.counters.map((c) => `<b>${esc(COUNTERS[c].name)}</b> (${esc(COUNTERS[c].cost)}) — ${esc(COUNTERS[c].desc)}`),
    ...(d.free === 'airGap' ? ['<b>Air-gap</b> (free, in the node’s inspector) — no links: the worm cannot pass'] : [])];
  return `<div class="eb-panel">` +
    `<div class="label eb-k"><span class="nf-g" aria-hidden="true">${FAMILY.hazard.glyph}</span> ${d.side === 'colony' ? '⌂ COLONY' : '◉ AUTOMATION'} · NEW HAZARD · ${TIER_LABEL[d.minTier]}</div>` +
    `<h1 class="eb-name">${esc(HAZARD_NAME[kind])}</h1>` +
    `<p class="eb-blurb">${esc(d.ignored[2] === '—' ? d.ignored[1] : d.ignored[2]).replace(/^./, (c) => c.toUpperCase())} when ignored. Its alert names the target, counts down and carries the counter.</p>` +
    counters.map((c) => `<p class="eb-line">${c}</p>`).join('') +
    `<p class="eb-line"><span class="label">This one</span> ${esc(d.drillNext)}</p>` +
    `<div class="eb-foot"><button class="btn primary" data-dsc="ok">Continue ▸</button></div></div>`;
}

export function mountDiscovery(root: HTMLElement, game: Game) {
  // ── research family: tech cards, top centre, under the swarm meter, one at a time ──
  const card = el('div', 'panel interactive nf nf-research');
  card.id = 'discovery-card';
  card.style.display = 'none';
  root.appendChild(card);
  // ── era family: the explainer, a centred banner over everything but the menu ──
  const banner = el('div', 'interactive nf nf-era');
  banner.id = 'era-banner';
  banner.style.display = 'none';
  root.appendChild(banner);
  // ── hazard family: the drill's card (and HAZARDS ARE LIVE), centred; a scrim only while it holds the pause ──
  const hazardCard = el('div', 'nf nf-hazard');
  hazardCard.id = 'hazard-card';
  hazardCard.style.display = 'none';
  root.appendChild(hazardCard);

  let shownId = -1;
  /** the banner paused the game, and resumes it on Continue */
  let pausedByBanner = false;

  const pop = () => {
    const [first, ...rest] = $announce.get();
    if (first && first.kind !== 'tech' && pausedByBanner) {
      game.actions.push({ kind: 'setPaused', paused: false });
      pausedByBanner = false;
    }
    $announce.set(rest);
  };

  const techHtml = (tid: TechId, more: number) => {
    const s = game.state;
    const def = resolveTech(TECHS[tid], s.expedition);
    const lane = LANES.find((l) => l.id === def.lane);
    const lines = describeTech(def, { siteId: s.siteId, expedition: s.expedition, agentTax: game.mods.agentTax, done: s.techsDone });
    const track = def.track ? `${SIDE_GLYPH[def.track.side]} ${SIDE_LABEL[def.track.side]} · the Era ${def.track.era} destiny` : '';
    const pros = lines.filter((l) => l.sign === 'pro').slice(0, 3);
    const cons = lines.filter((l) => l.sign === 'con').slice(0, 2);
    return `<div class="dsc-head"><span class="label"><span class="nf-g" aria-hidden="true">${FAMILY.research.glyph}</span> Research complete</span>` +
      `<span class="dsc-meta mono">E${def.era}${lane ? ` · ${esc(lane.label)}` : ''}${track ? ` · ${esc(track)}` : ''}${more ? ` · +${more} more` : ''}</span></div>` +
      `<div class="dsc-name">${esc(def.name)}</div>` +
      `<div class="dsc-desc">${esc(def.desc)}</div>` +
      `<div class="dsc-fx">${pros.map((l) => `<div class="dsc-pro">⊕ ${esc(l.text)}</div>`).join('')}` +
      `${cons.map((l) => `<div class="dsc-con">⊖ ${esc(l.text)}</div>`).join('')}</div>` +
      (def.visual ? `<div class="dsc-look"><span class="label">Look for it</span> ${esc(def.visual)}</div>` : '') +
      riskLine(def.effects) +
      `<div class="dsc-next"><span class="label">Next</span> ${esc(nextStep(def.effects.filter((fx) => effectApplies(fx, s.siteId, s.expedition, s.techsDone)), s))}</div>` +
      `<div class="dsc-foot"><button class="btn primary" data-dsc="ok">Got it</button>` +
      `<button class="btn" data-dsc="tree" data-tech="${tid}">In the tree</button>` +
      `<label class="dsc-off"><input type="checkbox" data-dsc="off"> Hide these pop-ups</label></div>`;
  };

  const eraHtml = (era: number, intro: boolean) => {
    const s = game.state;
    const ctx = { siteId: s.siteId, expedition: s.expedition, discoveries: s.discoveries, techsDone: s.techsDone };
    const opens = TECH_ORDER.filter((t) => {
      const d = resolveTech(TECHS[t], s.expedition);
      return d.era === era && !d.breakthrough && !d.track && techVisible(d, ctx);
    });
    const next = ERA_GATES[(era + 1) as Era];
    const names = opens.slice(0, 4).map((t) => TECHS[t].short).join(', ');
    // the era's destiny (docs/14 §2): the pick that opens the next era, and the meter
    const dv = destinyOf(s);
    const pair = era >= 2 ? TRACKS[era as Era] : null;
    const destiny = pair
      ? `<p class="eb-line eb-destiny"><span class="label">Destiny</span> ${esc(pair.question)} ${SIDE_GLYPH.colony} ${esc(TECHS[pair.colony].name)} ` +
        `or ${SIDE_GLYPH.automation} ${esc(TECHS[pair.automation].name)} — one pick, permanent${next ? `, and Era ${era + 1} needs it` : ''} · ` +
        `<span class="mono">${destinyPips(dv)}</span> ${esc(reachLine(dv))}</p>`
      : `<p class="eb-line eb-destiny"><span class="label">Destiny</span> Your landing was the first of eight choices, one per era: ` +
        `${PURE_AT} on one side make it your destiny · <span class="mono">${destinyPips(dv)}</span></p>`;
    const blurb = era === 8 && dv.certain ? ERA_BLURB_8[dv.certain] : ERA_BLURB[era] ?? '';
    return `<div class="eb-panel">` +
      `<div class="label eb-k"><span class="nf-g" aria-hidden="true">${FAMILY.era.glyph}</span> ${intro ? 'Mission start' : 'A new era opens'}</div>` +
      `<div class="eb-era mono">ERA ${era}</div>` +
      `<h1 class="eb-name">${esc(ERA_NAMES[era] ?? '')}</h1>` +
      `<p class="eb-blurb">${esc(blurb)}</p>` +
      (opens.length ? `<p class="eb-line"><span class="label">Research opens</span> ${opens.length} techs — ${esc(names)}${opens.length > 4 ? '…' : ''}</p>` : '') +
      destiny +
      (next ? `<p class="eb-line"><span class="label">Era ${era + 1}</span> ${era >= 2
        ? `opens with this era’s destiny and ${CHARTER_TECHS - 1} more of its techs, or the destiny, ${CHARTER_DEED_TECHS - 1} more and: ${esc(next.deed)}`
        : `opens with ${CHARTER_TECHS} techs from this era, or ${CHARTER_DEED_TECHS} plus: ${esc(next.deed)}`}</p>` : '') +
      (intro ? (touchOn()
        ? '<p class="eb-line">Your objectives are in the top-left card. <b>Build</b> opens the palette · <b>Tree</b> research · <b>Map</b> the Lunar Map · drag to pan, pinch to zoom · <b>☰</b> menu.</p>'
        : '<p class="eb-line">Your objectives are in the bottom-left panel. <b>T</b> research · <b>M</b> Lunar Map · <b>I</b> deposits · <b>Esc</b> menu.</p>') : '') +
      `<div class="eb-foot"><button class="btn primary" data-dsc="ok">${intro ? 'Begin' : 'Continue'} ▸</button>` +
      `<label class="dsc-off"><input type="checkbox" data-dsc="off"> Hide these explainers and pop-ups</label></div></div>`;
  };

  const render = () => {
    const q = $announce.get();
    const first: Announcement | undefined = q[0];
    if (!first || $phase.get() !== 'playing' || !loadSettings().tips) {
      card.style.display = 'none';
      banner.style.display = 'none';
      hazardCard.style.display = 'none';
      shownId = -1;
      if (q.length && !loadSettings().tips) $announce.set([]);
      return;
    }
    if (first.id === shownId) return;
    shownId = first.id;
    if (first.kind === 'tech') {
      banner.style.display = 'none';
      hazardCard.style.display = 'none';
      card.innerHTML = techHtml(first.tid, q.filter((a) => a.kind === 'tech').length - 1);
      card.style.display = '';
    } else {
      card.style.display = 'none';
      // an era opens on the banner; a hazard's drill (or its side going live) on its own card
      const host = first.kind === 'era' ? banner : hazardCard;
      (host === banner ? hazardCard : banner).style.display = 'none';
      host.innerHTML = first.kind === 'era' ? eraHtml(first.era, first.intro)
        : first.kind === 'hazardsLive' ? hazardsLiveHtml(first.side) : hazardHtml(first.hazard);
      const holds = announceHolds(first);
      hazardCard.classList.toggle('holds', holds);
      host.style.display = 'flex';
      sfx.play(host === banner ? 'era' : 'warn');
      if (holds && !$time.get().paused) {
        game.actions.push({ kind: 'setPaused', paused: true });
        pausedByBanner = true;
      }
      host.querySelector<HTMLButtonElement>('[data-dsc="ok"]')?.focus({ preventScroll: true });
    }
  };

  const onClick = (e: Event) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('[data-dsc]');
    if (!b) return;
    switch (b.dataset.dsc) {
      case 'ok': pop(); break;
      case 'tree': {
        const tid = b.dataset.tech as TechId;
        pop();
        openTechTreeAt(tid);
        break;
      }
      case 'off':
        if ((b as HTMLInputElement).checked) {
          saveSettings({ tips: false });
          const [first] = $announce.get();
          if (first && first.kind !== 'tech' && pausedByBanner) {
            game.actions.push({ kind: 'setPaused', paused: false });
            pausedByBanner = false;
          }
          $announce.set([]);
        }
        break;
    }
  };
  card.addEventListener('click', onClick);
  banner.addEventListener('click', onClick);
  hazardCard.addEventListener('click', onClick);
  // Enter or Esc takes the banner (or the hazard card) down (the menu's own keys win while it is open)
  window.addEventListener('keydown', (e) => {
    if ((banner.style.display === 'none' && hazardCard.style.display === 'none') || $menuOpen.get()) return;
    if (e.code === 'Enter' || e.code === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) pop();
    }
  }, true);

  $announce.subscribe(render);
  $phase.subscribe(render);
}

/** Esc closes the tech card before the menu opens (game.ts's chain). */
export function dismissDiscoveryCard(): boolean {
  const [first, ...rest] = $announce.get();
  if (first?.kind !== 'tech') return false;
  $announce.set(rest);
  return true;
}
