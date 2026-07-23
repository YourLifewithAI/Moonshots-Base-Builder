/** Ordered goals — the entire tutorial (progressive disclosure, no forced steps).
 *  Each completes contextually; the panel reveals the next. */
import type { GameState } from '../core/state';

export interface MilestoneDef {
  id: string;
  title: string;
  hint: string;
  check: (s: GameState) => boolean;
}

const count = (s: GameState, type: string) =>
  s.buildings.filter((b) => b.type === type && (b.construction ?? 0) <= 0).length;

export const MILESTONES: MilestoneDef[] = [
  {
    id: 'power-up', title: 'Power Up',
    hint: 'Place a Solar Array from the build palette.',
    check: (s) => count(s, 'solar') >= 1,
  },
  {
    id: 'dig-in', title: 'Dig In',
    hint: 'Build a Regolith Excavator and bank 50 regolith.',
    check: (s) => s.resources.regolith >= 50,
  },
  {
    id: 'first-metal', title: 'First Metal',
    hint: 'Research Regolith Smelting, then smelt 100 metals. The smelter’s oxygen byproduct keeps your crew breathing.',
    check: (s) => count(s, 'smelter') >= 1 && s.resources.metals >= 100,
  },
  {
    id: 'grow-the-crew', title: 'Grow the Expedition',
    hint: 'House 8 crew (habitats extend the perimeter; morale above 60 attracts arrivals) — or, on a robotic mission, field a fleet of 6 robots.',
    check: (s) => s.expedition === 'robotic' ? (s.bots?.total ?? 0) >= 6 : s.crew >= 8,
  },
  {
    id: 'survive-the-night', title: 'Survive the Night',
    hint: 'The lunar night lasts 14 days and kills solar power. Stockpile stored kWh — batteries help.',
    check: (s) => s.nightsSurvived >= 1,
  },
  {
    id: 'fab-online', title: 'Close the Parts Loop',
    hint: 'Research Parts Fabrication (Era 2) and build a Parts Fabricator. Welding and upkeep both burn parts — without a local source, the base slowly seizes up.',
    check: (s) => count(s, 'partsFab') >= 1,
  },
  {
    id: 'era-3', title: 'Industrialize',
    hint: 'Reach Era 3. Advancing an era needs two completed techs of the era before it.',
    check: (s) => s.era >= 3,
  },
  {
    id: 'driver-online', title: 'Rail to Orbit',
    hint: 'Research and build the Electromagnetic Mass Driver.',
    check: (s) => count(s, 'massDriver') >= 1,
  },
  {
    id: 'foils-ready', title: 'Harvest of Light',
    hint: 'Manufacture 10 collector foils at the Foil Factory.',
    check: (s) => s.resources.foils >= 10,
  },
  {
    id: 'first-light', title: 'FIRST LIGHT',
    hint: 'Research Swarm Protocol and LAUNCH your first collector volley to solar orbit.',
    check: (s) => s.launches >= 1,
  },
];

/** Swarm % milestone bands (post-victory long game; see docs/09-roadmap.md). */
export const SWARM_BANDS = [0.0001, 0.001, 0.01, 0.1, 1];
