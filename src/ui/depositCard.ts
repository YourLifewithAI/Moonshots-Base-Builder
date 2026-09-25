/** What a deposit is and what to do with it. The overlay's labels ([I]) and
 *  the Lunar Map's SITE view both open this card: the ground's science in a
 *  line, what it does to the buildings that use it (the live numbers, after
 *  research), how much of your digging is on it now, and the one action
 *  that uses it — or the research that stands in the way.
 *
 *  Opened from the world, it takes the inspector's place (one or the other);
 *  opened from the map, it fills the map's side panel. */
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { DEPOSIT_INFO, type DepositKind } from '../data/deposits';
import { DEPOSIT_FX, FEED, SURVEY_TIERS } from '../data/balance';
import { TIER_TECH } from '../data/lunarMap';
import { TECHS, type TechId } from '../data/techs';
import type { Mods } from '../core/mods';
import type { Game } from '../core/game';
import { el } from './hud';
import { openTechTreeAt } from './techTree';
import { $depositOverlay, $deposits, $depositSel, $feed, $lunar, $mode, $phase, $selection, type DepositView } from './stores';

interface Line { sign: 'pro' | 'con'; text: string }
interface Guide {
  about: string;
  lines: (m: Mods) => Line[];
  /** the building that uses this ground */
  use: BuildingId;
  /** the research that makes the ground pay, when the building alone does not */
  needs?: TechId;
  todo: string;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
/** a signed share: `+30%`, `−20%` */
const spct = (x: number) => `${x < 0 ? '−' : '+'}${Math.abs(Math.round(x * 100))}%`;

const GUIDE: Record<DepositKind, Guide> = {
  ilmenite: {
    about: 'Dark mare basalt rich in ilmenite (FeTiO₃), the ore hydrogen reduction wants.',
    lines: (m) => [
      { sign: 'pro', text: `Smelters: up to ${spct(FEED.smelter.ilmenite * m.feedBonus.ilmenite)} output, with all your digging here` },
      { sign: 'con', text: `Silicon Refineries: up to ${spct(FEED.refinery.ilmenite)} from the same feed` },
    ],
    use: 'excavator',
    todo: 'Put a Regolith Excavator on it to feed your smelters.',
  },
  anorthosite: {
    about: 'Bright highland crust: calcium-aluminium silicate, rich in silicon and poor in iron.',
    lines: (m) => [
      { sign: 'pro', text: `Silicon Refineries: up to ${spct(FEED.refinery.anorthosite * m.feedBonus.anorthosite)} output, with all your digging here` },
      { sign: 'con', text: `Smelters: up to ${spct(FEED.smelter.anorthosite)} from the same feed` },
    ],
    use: 'excavator',
    todo: 'Dig here to feed silicon refining; keep your smelters’ excavators on basalt or plain ground.',
  },
  glass: {
    about: 'Pyroclastic beads from ancient fire fountains: iron- and oxygen-rich volcanic glass.',
    lines: (m) => [
      { sign: 'pro', text: `Smelters: up to ${spct(FEED.smelterO2Glass * m.feedBonus.glass)} oxygen, with all your digging here` },
      { sign: 'con', text: `An excavator here wears faster: upkeep ×${DEPOSIT_FX.glassExcavatorUpkeep}` },
    ],
    use: 'excavator',
    todo: 'Dig here when oxygen is the bottleneck.',
  },
  kreep: {
    about: 'KREEP: potassium, rare-earth elements and phosphorus, with the thorium that fuels reactors.',
    lines: () => [
      { sign: 'pro', text: `Thorium Reactors: upkeep ×${FEED.kreepReactorUpkeep} once ${pct(FEED.kreepReactorShare)} of your digging is here` },
      { sign: 'con', text: `Smelters: up to ${spct(FEED.smelter.kreep)} from the same feed` },
      { sign: 'con', text: 'No habitats on KREEP soil: radiation' },
    ],
    use: 'excavator',
    todo: 'Give it one excavator once a Thorium Reactor runs; build habitats elsewhere.',
  },
  volatiles: {
    about: 'Old, sun-weathered soil that has soaked up solar-wind hydrogen for billions of years.',
    lines: () => [
      { sign: 'pro', text: `With Solar-Wind Volatiles, an excavator here makes ×${DEPOSIT_FX.volatilesWater} water` },
      { sign: 'con', text: `That excavator digs ×${DEPOSIT_FX.volatilesRegolith} regolith` },
    ],
    use: 'excavator',
    needs: 'regolithVolatiles',
    todo: 'Put an excavator here for water.',
  },
  ice: {
    about: 'Water ice in a permanently shadowed cold trap, some 40 K above absolute zero.',
    lines: () => [
      { sign: 'pro', text: `The only ground an Ice Harvester can work: ${BUILDINGS.iceHarvester.outputs.water ?? 0}≈ water/s each` },
      { sign: 'con', text: `Harvesters draw ${-BUILDINGS.iceHarvester.powerKW} kW, night and day` },
    ],
    use: 'iceHarvester',
    todo: 'Place Ice Harvesters on it.',
  },
  ridge: {
    about: 'A crest above the rim’s shadow, in near-continuous sunlight.',
    lines: () => [
      { sign: 'pro', text: `Solar Arrays here: ×${DEPOSIT_FX.ridgeSolar} power, never shaded` },
      { sign: 'con', text: `Building on the crest takes ×${DEPOSIT_FX.ridgeSolarBuildTime} as long` },
    ],
    use: 'solar',
    todo: 'Place Solar Arrays on it.',
  },
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** the tech that unlocks a building, if any */
function unlockTech(b: BuildingId): TechId | null {
  for (const t of Object.values(TECHS)) {
    if (t.effects.some((fx) => fx.kind === 'unlock' && fx.building === b)) return t.id;
  }
  return null;
}

/** the next survey tier whose reveal radius takes in the ground at `dist` */
function tierFor(dist: number): number | null {
  for (let t = 1; t < SURVEY_TIERS.length; t++) if (SURVEY_TIERS[t].revealM >= dist) return t;
  return null;
}

export interface CardAction { act: 'place' | 'tree' | 'world' | 'close'; building?: BuildingId; tech?: TechId }

/** The card's body; `where` picks the buttons (the map adds "Show in the world"). */
export function depositCardHtml(d: DepositView, game: Game, where: 'world' | 'map'): string {
  const s = game.state;
  const m = game.mods;
  const home = $lunar.get()?.site.lander ?? { x: 0, z: 0 };
  const at = d.revealed ? { x: d.x, z: d.z } : d.lead ?? { x: d.x, z: d.z };
  const dist = Math.round(Math.hypot(at.x - home.x, at.z - home.z));
  const buttons: string[] = [];
  let body = '';

  if (!d.revealed) {
    const t = tierFor(dist - d.r);
    const tid = t !== null ? (TIER_TECH[t] as TechId | undefined) : undefined;
    const how = tid
      ? `T${t} ${TECHS[tid].name} maps ${SURVEY_TIERS[t!].revealM >= 1000 ? 'the whole site' : `${SURVEY_TIERS[t!].revealM} m around the Lander`} and would confirm it.`
      : 'A wider survey would confirm it.';
    const hint = d.label.replace(/^\? /, '');
    const what = hint === 'unknown' ? 'something unusual in the ground' : hint;
    body = `<div class="dc-status">Unconfirmed lead · ${dist} m from the Lander</div>
      <div class="dc-about">Orbital data shows ${esc(what)} here. Until it is surveyed you cannot tell what the ground holds.</div>
      <div class="dc-todo">${esc(how)}</div>`;
    if (tid) buttons.push(`<button class="btn" data-dact="tree" data-tech="${tid}">Research ${esc(TECHS[tid].short)}</button>`);
    return shell(d, body, buttons, where);
  }

  const g = GUIDE[d.kind];
  const info = DEPOSIT_INFO[d.kind];
  const net = d.inNetwork ? 'inside your build network' : 'outside the build network: a Relay Mast or habitat nearer extends it';
  body += `<div class="dc-status">Confirmed · ${dist} m from the Lander · ${net}</div>`;
  body += `<div class="dc-about">${esc(g.about)}</div>`;
  body += `<div class="dc-fx">${g.lines(m).map((l) =>
    `<div class="${l.sign === 'pro' ? 'pro' : 'con'}">${esc(l.text)}</div>`).join('')}</div>`;
  // the live feed share, for the grounds that are dug
  if (g.use === 'excavator') {
    const share = ($feed.get() as unknown as Record<string, number>)[d.kind] ?? 0;
    body += `<div class="dc-now mono">Your digging now: ${pct(share)} on ${esc(info.name)}</div>`;
  }
  // what stands between the player and using it
  const need = !m.unlocked.has(g.use) ? unlockTech(g.use)
    : g.needs && !s.techsDone.includes(g.needs) ? g.needs : null;
  if (need) {
    body += `<div class="dc-todo">${esc(g.todo)} First: research ${esc(TECHS[need].name)}.</div>`;
    buttons.push(`<button class="btn" data-dact="tree" data-tech="${need}">Research ${esc(TECHS[need].short)}</button>`);
  } else {
    body += `<div class="dc-todo">${esc(g.todo)}</div>`;
    if (m.unlocked.has(g.use)) {
      buttons.push(`<button class="btn primary" data-dact="place" data-building="${g.use}">Place ${esc(BUILDINGS[g.use].name)} here</button>`);
    }
  }
  return shell(d, body, buttons, where);
}

function shell(d: DepositView, body: string, buttons: string[], where: 'world' | 'map'): string {
  if (where === 'map') buttons.push('<button class="btn" data-dact="world">Show in the world</button>');
  const hint = d.label.replace(/^\? /, '');
  const title = d.revealed ? DEPOSIT_INFO[d.kind].name : hint === 'unknown' ? 'unconfirmed lead' : hint;
  return `<div class="dc-head"><span class="dc-g">${esc(d.revealed ? d.glyph : '?')}</span>` +
    `<span class="dc-name">${esc(title.charAt(0).toUpperCase() + title.slice(1))}</span></div>` +
    `<div class="dc-body">${body}</div>` +
    `<div class="dc-foot">${buttons.join('')}${where === 'world' ? '<button class="btn" data-dact="close">Close</button>' : ''}</div>`;
}

/** Run a card button: place (focus the ground, start placing), open the
 *  tree, or show the deposit in the world. `leave` closes the calling screen. */
export function runCardAction(btn: HTMLElement, id: string, game: Game, leave: () => void) {
  const d = $deposits.get().find((x) => x.id === id);
  switch (btn.dataset.dact) {
    case 'close': $depositSel.set(null); return;
    case 'tree': leave(); openTechTreeAt(btn.dataset.tech as TechId); return;
    case 'world':
    case 'place': {
      if (!d) return;
      leave();
      const at = d.revealed ? { x: d.x, z: d.z } : d.lead ?? { x: d.x, z: d.z };
      game.focusGround(at.x, at.z);
      if (btn.dataset.dact === 'place') {
        $depositSel.set(null);
        game.beginPlacement(btn.dataset.building as BuildingId);
      } else {
        $depositOverlay.set(true);
        $depositSel.set(id);
      }
    }
  }
}

/** The world card: in the inspector's column, one or the other. */
export function mountDepositCard(root: HTMLElement, game: Game) {
  const card = el('div', 'panel interactive');
  card.id = 'deposit-card';
  card.style.display = 'none';
  (root.querySelector('#hud-right') ?? root).appendChild(card);
  let sig = '';
  const render = () => {
    const id = $depositSel.get();
    const d = id ? $deposits.get().find((x) => x.id === id) : undefined;
    if (!d || $phase.get() !== 'playing' || $mode.get() !== 'build') {
      if (card.style.display !== 'none') card.style.display = 'none';
      sig = '';
      return;
    }
    const html = depositCardHtml(d, game, 'world');
    if (html !== sig) { sig = html; card.innerHTML = html; }
    card.style.display = '';
  };
  card.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-dact]');
    const id = $depositSel.get();
    if (b && id) runCardAction(b, id, game, () => {});
  });
  // a building selected closes the card; the card opened drops the selection
  $selection.subscribe((sel) => { if (sel && $depositSel.get()) $depositSel.set(null); });
  $depositSel.subscribe((id) => { if (id && $selection.get()) $selection.set(null); render(); });
  for (const a of [$deposits, $feed, $mode, $phase]) a.subscribe(render);
}
