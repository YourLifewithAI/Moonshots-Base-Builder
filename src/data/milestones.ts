/** Ordered goals — the entire tutorial (progressive disclosure, no forced steps).
 *  Each latches the moment it is met, in any order; the panel shows the
 *  earliest one still open, with a status line of what is already done. */
import type { GameState } from '../core/state';
import { BUILDINGS, isCompute, type BuildingId } from './buildings';
import { SIDE_GLYPH, TECHS, TRACKS, type Era, type TechId } from './techs';
import { ATLAS, CHARTER_DEED_TECHS, CHARTER_TECHS, RESEARCH_RATE_PER_DC, RESEARCH_RATE_PER_LAB } from './balance';

export interface MilestoneDef {
  id: string;
  title: string;
  hint: string;
  /** the hint on a robotic mission, when it differs */
  hintRobotic?: string;
  /** the hint when it follows the run's choices (a doctrine); wins over both */
  hintFor?: (s: GameState) => string;
  check: (s: GameState) => boolean;
  /** one status line: the steps done and the one in progress */
  progress?: (s: GameState) => string;
}

const count = (s: GameState, type: string) =>
  s.buildings.filter((b) => b.type === type && (b.construction ?? 0) <= 0).length;
/** complete Data Centers and Server Monoliths (a monolith counts as a Data Center) */
const compute = (s: GameState) => s.buildings.filter((b) => isCompute(b.type) && (b.construction ?? 0) <= 0).length;

/** the destiny pick done for an era, or null (docs/14) */
const pickOf = (s: GameState, era: Era): TechId | null => {
  const t = TRACKS[era];
  return s.techsDone.includes(t.colony) ? t.colony : s.techsDone.includes(t.automation) ? t.automation : null;
};
const E8 = TRACKS[8];
const FIRST_LIGHT_OPEN = `Choose the Era 8 destiny — ${SIDE_GLYPH.colony} ${TECHS[E8.colony].name} or ` +
  `${SIDE_GLYPH.automation} ${TECHS[E8.automation].name} — then research Swarm Protocol and LAUNCH your first collector volley to solar orbit.`;

/** ✓ built · ◻ Name 62% while a site rises · ◻ Name */
function built(s: GameState, type: BuildingId): string {
  const name = BUILDINGS[type].name;
  if (count(s, type) > 0) return `✓ ${name}`;
  const site = s.buildings.find((b) => b.type === type);
  if (!site) return `◻ ${name}`;
  const pct = Math.floor((1 - (site.construction ?? 0) / Math.max(1, site.buildTotal)) * 100);
  return site.idleReason === 'queued' ? `◻ ${name} (queued)` : `◻ ${name} ${pct}%`;
}

/** ✓ researched · ◻ Name 40% while queued · ◻ Name */
function researched(s: GameState, id: TechId): string {
  const def = TECHS[id];
  if (s.techsDone.includes(id)) return `✓ ${def.name}`;
  if (!s.researchQueue.includes(id)) return `◻ ${def.name}`;
  return `◻ ${def.name} ${Math.floor(((s.researchSpent[id] ?? 0) / def.costData) * 100)}%`;
}

const stock = (s: GameState, rid: 'regolith' | 'metals' | 'foils', goal: number) =>
  `${rid[0].toUpperCase()}${rid.slice(1)} ${Math.floor(s.resources[rid])}/${goal}`;

/** The launch doctrine this run chose — done first, then queued — or null
 *  while it is open: each tech names the launcher it unlocks. */
const LAUNCHERS = [['propellantDepot', 'propellantPlant'], ['massDriver', 'massDriver']] as const;
function launcher(s: GameState): (typeof LAUNCHERS)[number] | null {
  return LAUNCHERS.find(([t]) => s.techsDone.includes(t))
    ?? LAUNCHERS.find(([t]) => s.researchQueue.includes(t)) ?? null;
}
const LAUNCH_OPEN_HINT = `Choose a launch doctrine and build its launcher: research the ${TECHS.massDriver.name} ` +
  `and build one, or research ${TECHS.propellantDepot.name} and build a ${BUILDINGS.propellantPlant.name}.`;

export const MILESTONES: MilestoneDef[] = [
  {
    id: 'power-up', title: 'Power Up',
    hint: 'Place a Solar Array from the build palette.',
    check: (s) => count(s, 'solar') >= 1,
    progress: (s) => (s.buildings.some((b) => b.type === 'solar') ? built(s, 'solar') : ''),
  },
  {
    id: 'dig-in', title: 'Dig In',
    hint: 'Build a Regolith Excavator and bank 50 regolith.',
    check: (s) => s.resources.regolith >= 50,
    progress: (s) => `${built(s, 'excavator')} · ${stock(s, 'regolith', 50)}`,
  },
  {
    id: 'first-metal', title: 'First Metal',
    hint: 'Build a Research Lab, research Regolith Smelting, then smelt 100 metals. The smelter’s oxygen byproduct keeps your crew breathing.',
    hintRobotic: 'Build a Research Lab, research Regolith Smelting, then smelt 100 metals — the stock every later structure is built from.',
    check: (s) => count(s, 'smelter') >= 1 && s.resources.metals >= 100,
    progress: (s) => [built(s, 'lab'), researched(s, 'regolithProcessing'), built(s, 'smelter'),
      stock(s, 'metals', 100)].join(' · '),
  },
  {
    id: 'grow-the-crew', title: 'Grow the Expedition',
    hint: 'House 8 crew: habitats add beds and extend the perimeter; morale above 60 attracts arrivals.',
    hintRobotic: 'Field a fleet of 6 construction robots: research Construction Robotics, then build Robotics Bays (two robots each).',
    check: (s) => s.expedition === 'robotic' ? (s.bots?.total ?? 0) >= 6 : s.crew >= 8,
    progress: (s) => s.expedition === 'robotic'
      ? `${researched(s, 'constructionRobotics')} · Robots ${s.bots?.total ?? 0}/6`
      : `Crew ${s.crew}/8 · ${s.housingActive ?? 0} beds powered`,
  },
  {
    id: 'survive-the-night', title: 'Survive the Night',
    hint: 'The lunar night (4 min at 1×) kills solar power. Stockpile stored kWh — batteries help.',
    hintRobotic: 'The lunar night (4 min at 1×) kills solar power. Stockpile stored kWh — batteries help — or let industry idle until dawn.',
    check: (s) => s.nightsSurvived >= 1,
  },
  {
    id: 'fab-online', title: 'Close the Parts Loop',
    hint: 'Research Parts Fabrication (Era 2) and build a Parts Fabricator. Welding and upkeep both burn parts — without a local source, the base slowly seizes up.',
    check: (s) => count(s, 'partsFab') >= 1,
    progress: (s) => `${researched(s, 'partsFabrication')} · ${built(s, 'partsFab')}`,
  },
  {
    id: 'era-3', title: 'Robots Build Robots',
    hint: `Reach Era 3 — Robotic Fabrication. From Era 3 on, an era opens with the era before's destiny (T) and ` +
      `${CHARTER_TECHS - 1} more of its techs — or the destiny, ${CHARTER_DEED_TECHS - 1} more and a deed.`,
    check: (s) => s.era >= 3,
    progress: (s) => {
      const n = s.techsDone.filter((t) => TECHS[t]?.era === s.era && !TECHS[t].track?.landing && !(s.forwarded ?? []).includes(t)).length;
      const pick = s.era >= 2 ? pickOf(s, s.era as Era) : null;
      return `Era ${s.era} · ${n}/${CHARTER_TECHS} techs done${s.era >= 2 ? ` · ${pick ? `✓ ${TECHS[pick].name}` : '◻ destiny'}` : ''}`;
    },
  },
  {
    id: 'silicon-brains', title: 'Silicon Brains',
    hint: `Fab chips from lunar silicon (Era 4), then build a Data Center (Era 5). Compute feeds research as fast as ${Math.floor(RESEARCH_RATE_PER_DC / RESEARCH_RATE_PER_LAB)} labs and never sleeps.`,
    check: (s) => compute(s) >= 1,
    progress: (s) => `${built(s, 'chipFab')} · ${count(s, 'serverMonolith') > 0 ? built(s, 'serverMonolith') : built(s, 'dataCenter')}`,
  },
  {
    id: 'welcome-home', title: 'First Boots on Regolith',
    hint: 'Bring humans to the base the machines built.',
    hintRobotic: 'Bring humans to the base the machines built: a ⌂ Colony destiny from Era 3 on brings Human Cohabitation forward (or research it in Era 6), then keep a lunar day of oxygen, food and water for each newcomer — or produce it.',
    check: (s) => s.crew >= 1,
    progress: (s) => `${researched(s, 'humanCohabitation')} · ${built(s, 'habitat')}`,
  },
  {
    // either launch doctrine: the rail or the depot's rockets
    id: 'driver-online', title: 'Rail to Orbit',
    hint: LAUNCH_OPEN_HINT,
    hintFor: (s) => {
      const l = launcher(s);
      if (!l) return LAUNCH_OPEN_HINT;
      return l[0] === 'massDriver' ? `Research and build the ${TECHS.massDriver.name}.`
        : `Research ${TECHS.propellantDepot.name} and build a ${BUILDINGS.propellantPlant.name}: rockets steer where rails can’t.`;
    },
    check: (s) => count(s, 'massDriver') + count(s, 'propellantPlant') >= 1,
    progress: (s) => {
      const l = launcher(s);
      return l ? `${researched(s, l[0])} · ${built(s, l[1])}`
        : `${researched(s, 'massDriver')} or ${researched(s, 'propellantDepot')}`;
    },
  },
  {
    id: 'foils-ready', title: 'Harvest of Light',
    hint: 'Manufacture 10 collector foils at the Foil Factory.',
    check: (s) => s.resources.foils >= 10,
    progress: (s) => `${built(s, 'foilFactory')} · ${stock(s, 'foils', 10)}`,
  },
  {
    id: 'first-light', title: 'FIRST LIGHT',
    hint: FIRST_LIGHT_OPEN,
    // the Era 8 pick is the path to the swarm (docs/14 §2.2): it names how you launch
    hintFor: (s) => {
      const p = pickOf(s, 8);
      if (!p) return FIRST_LIGHT_OPEN;
      return p === E8.colony
        ? `${TECHS[p].name}: research Swarm Protocol and LAUNCH your first volley — with 4 crew on console it needs 2↑, and the base turns out to watch.`
        : `${TECHS[p].name}: research Swarm Protocol — the rail then fires itself once 10▰, 3↑ and the charge are ready.`;
    },
    check: (s) => s.launches >= 1,
    progress: (s) => {
      const p = pickOf(s, 8);
      return p ? `✓ ${TECHS[p].name} · ${researched(s, 'swarmProtocol')}` : `◻ Era 8 destiny · ${researched(s, 'swarmProtocol')}`;
    },
  },
  // non-blocking: after victory in the list, though it may latch before it
  {
    id: 'selenographer', title: 'SELENOGRAPHER',
    hint: `Complete the atlas: reach ${TECHS.deepSounding.name} (T4) and survey ${ATLAS.surveys} prospects on the Lunar Map [M].`,
    check: (s) => s.survey?.atlas ?? false,
    progress: (s) => `${researched(s, 'deepSounding')} · ${Object.keys(s.survey?.prospects ?? {}).length}/${ATLAS.surveys} surveyed`,
  },
];

/** The hint this run shows for a milestone (its doctrine, then its expedition). */
export function milestoneHint(m: MilestoneDef, s: GameState): string {
  return m.hintFor?.(s) ?? ((s.expedition === 'robotic' && m.hintRobotic) || m.hint);
}

/** Swarm % milestone bands (post-victory long game; see docs/09-roadmap.md). */
export const SWARM_BANDS = [0.0001, 0.001, 0.01, 0.1, 1];
