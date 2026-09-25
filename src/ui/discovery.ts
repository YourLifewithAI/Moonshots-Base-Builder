/** The running tutorial: a card for every finished tech (what it is, what
 *  you gain, what visibly changes and what to do next), and an explainer
 *  when an era opens (what the era means, what it brings, how the next one
 *  opens). An era explainer pauses the game until Continue; tech cards never
 *  do. One setting turns both off (Esc menu, or the card's own switch) for
 *  players who know the road. The queue is filled by game.publish(). */
import { BUILDINGS, CATEGORY_LABEL, type BuildingId } from '../data/buildings';
import {
  ERA_BLURB, ERA_GATES, ERA_NAMES, LANES, TECHS, TECH_ORDER, describeTech, type Era, type TechEffect, type TechId,
} from '../data/techs';
import { resolveTech, techVisible } from '../core/research';
import type { AutoFamily } from '../data/automation';
import { CHARTER_DEED_TECHS, CHARTER_TECHS } from '../data/balance';
import { loadSettings, saveSettings } from '../core/settings';
import type { Game } from '../core/game';
import { sfx } from '../audio/sfx';
import { el } from './hud';
import { openTechTreeAt } from './techTree';
import { $announce, $menuOpen, $phase, $time, type Announcement } from './stores';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** A Builder family's Next line. */
const BUILDER_NEXT: Record<AutoFamily, string> = {
  excavation: 'The Builder now keeps regolith supplied: tune it with [B].',
  power: 'The Builder now keeps the day’s grid margin and the night covered: tune it with [B].',
  smelting: 'The Builder now keeps metals and silicon supplied, and adds yards when stock tops out: tune it with [B].',
  fabrication: 'The Builder now keeps parts and chips coming, and adds Robotics Bays when sites wait: tune it with [B].',
  life: 'The Builder now keeps oxygen, food and water ahead of the crew, and a bed free: tune it with [B].',
  maintenance: 'Worn machines are replaced by the Builder: tune it with [B].',
  network: 'The Builder now plants Relay Masts toward ground its rules need: tune it with [B].',
  research: 'The Builder now adds labs when research waits on the transfer cap: tune it with [B].',
  export: 'The Builder now adds Foil Factories when foils hold a volley back: tune it with [B].',
};

/** What to do with a finished tech: the first effect that asks something of the player. */
function nextStep(fx: TechEffect[]): string {
  for (const f of fx) {
    switch (f.kind) {
      case 'unlock': {
        const b = BUILDINGS[f.building as BuildingId];
        return `Build it: ${CATEGORY_LABEL[b.category]} tab → ${b.name}.`;
      }
      case 'action':
        return f.id === 'overclock'
          ? 'Select a production building and switch on Overclock ×1.5 in its panel.'
          : 'Select the Lander and press Downlink to trade banked data for a cargo drop.';
      case 'survey':
        if (f.tier) return 'The Lunar Map [M] reaches further: new prospects are waiting to be surveyed.';
        break;
      case 'launchAction': return 'Launch collectors from the swarm meter at the top of the screen.';
      case 'automation': return 'Stations can run on agents now: toggle Crewed / Autonomous in their panels.';
      case 'grading': return 'Grade Site is in the Extraction tab: flatten rough ground for large buildings.';
      // fleet control (core/fleet.ts, core/haul.ts): the verbs that make these pay
      case 'construction':
        if ((f.rateMult ?? 1) > 1) return 'Every rover builds faster now. To rush one build, select the site and Summon more rovers onto it.';
        break;
      case 'botPerBay':
        if (f.delta > 0) return 'Each Robotics Bay docks another rover: select a site and Summon the spare ones onto the builds that matter.';
        break;
      case 'haul':
        return 'Excavators drive faster and carry more: select one and Dig at… a rich deposit farther out — the long hauls gain most.';
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

export function mountDiscovery(root: HTMLElement, game: Game) {
  // ── tech cards: top centre, under the swarm meter, one at a time ──
  const card = el('div', 'panel interactive');
  card.id = 'discovery-card';
  card.style.display = 'none';
  root.appendChild(card);
  // ── era explainer: a centred banner over everything but the menu ──
  const banner = el('div', 'interactive');
  banner.id = 'era-banner';
  banner.style.display = 'none';
  root.appendChild(banner);

  let shownId = -1;
  /** the banner paused the game, and resumes it on Continue */
  let pausedByBanner = false;

  const pop = () => {
    const [first, ...rest] = $announce.get();
    if (first?.kind === 'era' && pausedByBanner) {
      game.actions.push({ kind: 'setPaused', paused: false });
      pausedByBanner = false;
    }
    $announce.set(rest);
  };

  const techHtml = (tid: TechId, more: number) => {
    const s = game.state;
    const def = resolveTech(TECHS[tid], s.expedition);
    const lane = LANES.find((l) => l.id === def.lane);
    const lines = describeTech(def, { siteId: s.siteId, expedition: s.expedition, agentTax: game.mods.agentTax });
    const pros = lines.filter((l) => l.sign === 'pro').slice(0, 3);
    const cons = lines.filter((l) => l.sign === 'con').slice(0, 2);
    return `<div class="dsc-head"><span class="label">Discovered</span>` +
      `<span class="dsc-meta mono">E${def.era}${lane ? ` · ${esc(lane.label)}` : ''}${more ? ` · +${more} more` : ''}</span></div>` +
      `<div class="dsc-name">${esc(def.name)}</div>` +
      `<div class="dsc-desc">${esc(def.desc)}</div>` +
      `<div class="dsc-fx">${pros.map((l) => `<div class="dsc-pro">⊕ ${esc(l.text)}</div>`).join('')}` +
      `${cons.map((l) => `<div class="dsc-con">⊖ ${esc(l.text)}</div>`).join('')}</div>` +
      (def.visual ? `<div class="dsc-look"><span class="label">Look for it</span> ${esc(def.visual)}</div>` : '') +
      `<div class="dsc-next"><span class="label">Next</span> ${esc(nextStep(def.effects))}</div>` +
      `<div class="dsc-foot"><button class="btn primary" data-dsc="ok">Got it</button>` +
      `<button class="btn" data-dsc="tree" data-tech="${tid}">In the tree</button>` +
      `<label class="dsc-off"><input type="checkbox" data-dsc="off"> Hide these pop-ups</label></div>`;
  };

  const eraHtml = (era: number, intro: boolean) => {
    const s = game.state;
    const ctx = { siteId: s.siteId, expedition: s.expedition, discoveries: s.discoveries };
    const opens = TECH_ORDER.filter((t) => {
      const d = resolveTech(TECHS[t], s.expedition);
      return d.era === era && !d.breakthrough && techVisible(d, ctx);
    });
    const next = ERA_GATES[(era + 1) as Era];
    const names = opens.slice(0, 4).map((t) => TECHS[t].short).join(', ');
    return `<div class="eb-panel">` +
      `<div class="label eb-k">${intro ? 'Mission start' : 'A new era opens'}</div>` +
      `<div class="eb-era mono">ERA ${era}</div>` +
      `<h1 class="eb-name">${esc(ERA_NAMES[era] ?? '')}</h1>` +
      `<p class="eb-blurb">${esc(ERA_BLURB[era] ?? '')}</p>` +
      (opens.length ? `<p class="eb-line"><span class="label">Research opens</span> ${opens.length} techs — ${esc(names)}${opens.length > 4 ? '…' : ''}</p>` : '') +
      (next ? `<p class="eb-line"><span class="label">Era ${era + 1}</span> opens with ${CHARTER_TECHS} techs from this era, or ${CHARTER_DEED_TECHS} plus: ${esc(next.deed)}</p>` : '') +
      (intro ? '<p class="eb-line">Your objectives are in the bottom-left panel. <b>T</b> research · <b>M</b> Lunar Map · <b>I</b> deposits · <b>Esc</b> menu.</p>' : '') +
      `<div class="eb-foot"><button class="btn primary" data-dsc="ok">${intro ? 'Begin' : 'Continue'} ▸</button>` +
      `<label class="dsc-off"><input type="checkbox" data-dsc="off"> Hide these explainers and pop-ups</label></div></div>`;
  };

  const render = () => {
    const q = $announce.get();
    const first: Announcement | undefined = q[0];
    if (!first || $phase.get() !== 'playing' || !loadSettings().tips) {
      card.style.display = 'none';
      banner.style.display = 'none';
      shownId = -1;
      if (q.length && !loadSettings().tips) $announce.set([]);
      return;
    }
    if (first.id === shownId) return;
    shownId = first.id;
    if (first.kind === 'tech') {
      banner.style.display = 'none';
      card.innerHTML = techHtml(first.tid, q.filter((a) => a.kind === 'tech').length - 1);
      card.style.display = '';
    } else {
      card.style.display = 'none';
      banner.innerHTML = eraHtml(first.era, first.intro);
      banner.style.display = 'flex';
      sfx.play('era');
      if (!$time.get().paused) {
        game.actions.push({ kind: 'setPaused', paused: true });
        pausedByBanner = true;
      }
      banner.querySelector<HTMLButtonElement>('[data-dsc="ok"]')?.focus({ preventScroll: true });
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
          if (first?.kind === 'era' && pausedByBanner) {
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
  // Enter or Esc takes the banner down (the menu's own keys win while it is open)
  window.addEventListener('keydown', (e) => {
    if (banner.style.display === 'none' || $menuOpen.get()) return;
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
