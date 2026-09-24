/** Ordered goals — the entire tutorial (progressive disclosure, no forced steps).
 *  Each latches the moment it is met, in any order; the panel shows the
 *  earliest one still open, with a status line of what is already done. */
import type { GameState } from '../core/state';
import { BUILDINGS, type BuildingId } from './buildings';
import { TECHS, type TechId } from './techs';
import { ATLAS } from './balance';

export interface MilestoneDef {
  id: string;
  title: string;
  hint: string;
  /** the hint on a robotic mission, when it differs */
  hintRobotic?: string;
  check: (s: GameState) => boolean;
  /** one status line: the steps done and the one in progress */
  progress?: (s: GameState) => string;
}

const count = (s: GameState, type: string) =>
  s.buildings.filter((b) => b.type === type && (b.construction ?? 0) <= 0).length;

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
    hint: 'The lunar night lasts 14 days and kills solar power. Stockpile stored kWh — batteries help.',
    hintRobotic: 'The lunar night lasts 14 days and kills solar power. Stockpile stored kWh — batteries help — or let industry idle until dawn.',
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
    hint: 'Reach Era 3 — Robotic Fabrication. An era opens with 2 of the previous era’s techs — or 1 plus a deed.',
    check: (s) => s.era >= 3,
    progress: (s) => `Era ${s.era} · ${s.techsDone.filter((t) => TECHS[t].era === s.era).length}/2 techs done`,
  },
  {
    id: 'silicon-brains', title: 'Silicon Brains',
    hint: 'Fab chips from lunar silicon (Era 4), then build a Data Center (Era 5). Compute researches like three labs and never sleeps.',
    check: (s) => count(s, 'dataCenter') >= 1,
    progress: (s) => `${built(s, 'chipFab')} · ${built(s, 'dataCenter')}`,
  },
  {
    id: 'welcome-home', title: 'First Boots on Regolith',
    hint: 'Bring humans to the base the machines built.',
    hintRobotic: 'Bring humans to the base the machines built: research Human Cohabitation (Era 6), then keep a lunar day of oxygen, food and water for each newcomer — or produce it.',
    check: (s) => s.crew >= 1,
    progress: (s) => `${researched(s, 'humanCohabitation')} · ${built(s, 'habitat')}`,
  },
  {
    id: 'driver-online', title: 'Rail to Orbit',
    hint: 'Research and build the Electromagnetic Mass Driver.',
    check: (s) => count(s, 'massDriver') >= 1,
    progress: (s) => `${researched(s, 'massDriver')} · ${built(s, 'massDriver')}`,
  },
  {
    id: 'foils-ready', title: 'Harvest of Light',
    hint: 'Manufacture 10 collector foils at the Foil Factory.',
    check: (s) => s.resources.foils >= 10,
    progress: (s) => `${built(s, 'foilFactory')} · ${stock(s, 'foils', 10)}`,
  },
  {
    id: 'first-light', title: 'FIRST LIGHT',
    hint: 'Research Swarm Protocol and LAUNCH your first collector volley to solar orbit.',
    check: (s) => s.launches >= 1,
    progress: (s) => researched(s, 'swarmProtocol'),
  },
  // non-blocking: after victory in the list, though it may latch before it
  {
    id: 'selenographer', title: 'SELENOGRAPHER',
    hint: `Complete the atlas: reach ${TECHS.deepSounding.name} (T4) and survey ${ATLAS.surveys} prospects on the Lunar Map [M].`,
    check: (s) => s.survey?.atlas ?? false,
    progress: (s) => `${researched(s, 'deepSounding')} · ${Object.keys(s.survey?.prospects ?? {}).length}/${ATLAS.surveys} surveyed`,
  },
];

/** Swarm % milestone bands (post-victory long game; see docs/09-roadmap.md). */
export const SWARM_BANDS = [0.0001, 0.001, 0.01, 0.1, 1];
