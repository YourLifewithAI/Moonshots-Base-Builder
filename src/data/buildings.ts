/** The 14 slice buildings + the pre-placed Lander. Every building pulls on base
 *  resources, contributes something economic or social, and carries an explicit
 *  pro AND con — nothing is strictly good. Rates are per game-second.
 *  (Full 28-building roster: docs/04-buildings.md.) */
import type { ResourceId } from './resources';

export type BuildingId =
  | 'lander'
  | 'solar' | 'excavator' | 'habitat' | 'smelter' | 'iceHarvester' | 'hydroponics'
  | 'battery' | 'refinery' | 'lab' | 'roboticsBay'
  | 'partsFab' | 'reactor' | 'recDome'
  | 'foilFactory' | 'massDriver';

export type Category = 'power' | 'extraction' | 'industry' | 'life' | 'science' | 'export';

export interface BuildingDef {
  id: BuildingId;
  name: string;
  category: Category;
  era: 1 | 2 | 3 | 4 | 5 | 6;
  footprint: [number, number];         // grid cells (4 m each)
  height: number;                      // collision AABB height, m
  /** construction duration in game-seconds, scaled by site buildCostMult.
   *  Bigger, costlier, more important structures take longer to raise. */
  buildTime: number;
  buildCost: Partial<Record<ResourceId, number>>;
  crew: number;                        // workers required to operate
  /** +kW generated / −kW drawn. Solar scales with sunFactor; reactor is constant. */
  powerKW: number;
  inputs: Partial<Record<ResourceId, number>>;
  outputs: Partial<Record<ResourceId, number>>;
  storageKWh?: number;                 // battery
  housing?: number;
  upkeepParts: number;                 // parts per lunar day
  /** idle order under shortage: 0 = critical life support … 3 = first to idle */
  priority: 0 | 1 | 2 | 3;
  moraleDelta?: number;                // contribution to morale target while active
  /** construction robots this structure contributes to the fleet */
  bots?: number;
  pro: string;
  con: string;
  requiresIce?: boolean;
  unlockedFromStart?: boolean;         // rest come from techs
}

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  lander: {
    id: 'lander', name: 'Lander', category: 'life', era: 1,
    footprint: [3, 3], height: 14, buildTime: 0,
    buildCost: {}, crew: 0, powerKW: 6, storageKWh: 800,
    inputs: {}, outputs: {}, housing: 8, upkeepParts: 0.5, priority: 0, bots: 2,
    pro: 'Home. Power, housing, two construction robots, and the supply cache you arrived with.',
    con: 'There is only one, and it is not enough.',
  },
  solar: {
    id: 'solar', name: 'Solar Array', category: 'power', era: 1,
    footprint: [2, 2], height: 3, buildTime: 20,
    buildCost: { metals: 15 }, crew: 0, powerKW: 10,
    inputs: {}, outputs: {}, upkeepParts: 1, priority: 0,
    unlockedFromStart: true,
    pro: 'Cheap, silent power that scales with your ambition.',
    con: 'Dead all lunar night; regolith dust slowly chokes its output.',
  },
  excavator: {
    id: 'excavator', name: 'Regolith Excavator', category: 'extraction', era: 1,
    footprint: [2, 2], height: 5, buildTime: 30,
    buildCost: { metals: 20, parts: 5 }, crew: 1, powerKW: -6,
    inputs: {}, outputs: { regolith: 1.5 }, upkeepParts: 2, priority: 2,
    unlockedFromStart: true,
    pro: 'Feeds every industry on the Moon.',
    con: 'Thrown dust abrades everything — the highest parts wear on the base.',
  },
  habitat: {
    id: 'habitat', name: 'Habitat Module', category: 'life', era: 1,
    footprint: [2, 2], height: 6, buildTime: 45,
    buildCost: { metals: 30, parts: 10 }, crew: 0, powerKW: -4,
    inputs: {}, outputs: {}, housing: 4, upkeepParts: 1, priority: 0,
    unlockedFromStart: true,
    pro: 'Room for four more; extends the buildable perimeter.',
    con: 'Draws life support every second of the night, forever.',
  },
  smelter: {
    id: 'smelter', name: 'Regolith Smelter', category: 'industry', era: 1,
    footprint: [3, 2], height: 7, buildTime: 60,
    buildCost: { metals: 40, parts: 10 }, crew: 2, powerKW: -12,
    inputs: { regolith: 2 }, outputs: { metals: 0.5, oxygen: 0.25, water: 0.05 }, upkeepParts: 2, priority: 2,
    pro: 'Ilmenite gives threefold: metals, oxygen, and a trickle of water.',
    con: 'A furnace on the grid: the night hits it first.',
  },
  iceHarvester: {
    id: 'iceHarvester', name: 'Ice Harvester', category: 'extraction', era: 1,
    footprint: [2, 2], height: 5, buildTime: 35,
    buildCost: { metals: 25, parts: 5 }, crew: 1, powerKW: -8,
    inputs: {}, outputs: { water: 0.4 }, upkeepParts: 2, priority: 1,
    requiresIce: true,
    pro: 'Water from permanently shadowed ice — the pole’s great gift.',
    con: 'Useless anywhere without polar ice deposits.',
  },
  hydroponics: {
    id: 'hydroponics', name: 'Hydroponics Farm', category: 'life', era: 1,
    footprint: [2, 3], height: 4, buildTime: 45,
    buildCost: { metals: 25, parts: 5 }, crew: 1, powerKW: -6,
    inputs: { water: 0.2 }, outputs: { food: 0.35 }, upkeepParts: 1, priority: 1,
    moraleDelta: 5,
    pro: 'Fresh food, green light — the crew’s favorite corridor.',
    con: 'Crops die if power drops through the night. It holds your grid hostage.',
  },
  battery: {
    id: 'battery', name: 'Battery Bank', category: 'power', era: 2,
    footprint: [2, 1], height: 3, buildTime: 30,
    buildCost: { metals: 50, silicon: 10 }, crew: 0, powerKW: 0,
    inputs: {}, outputs: {}, storageKWh: 3000, upkeepParts: 1, priority: 0,
    pro: 'Sunlight in a box: 3,000 stored units against the fourteen-day dark.',
    con: '15% of everything you store is lost to the round trip.',
  },
  refinery: {
    id: 'refinery', name: 'Silicon Refinery', category: 'industry', era: 2,
    footprint: [3, 2], height: 6, buildTime: 60,
    buildCost: { metals: 50, parts: 15 }, crew: 2, powerKW: -14,
    inputs: { regolith: 2 }, outputs: { silicon: 0.4 }, upkeepParts: 2, priority: 2,
    pro: 'Silicon for panels and foils — the whole endgame flows through here.',
    con: 'The hungriest machine of the mid-game grid.',
  },
  lab: {
    id: 'lab', name: 'Research Lab', category: 'science', era: 1,
    footprint: [2, 2], height: 5, buildTime: 45,
    buildCost: { metals: 30, parts: 10 }, crew: 2, powerKW: -5,
    inputs: {}, outputs: {}, upkeepParts: 1, priority: 3,
    unlockedFromStart: true,
    pro: 'The only way forward: data toward every unlock.',
    con: 'Produces nothing you can eat, breathe, or burn — and idles first in a crunch.',
  },
  roboticsBay: {
    id: 'roboticsBay', name: 'Robotics Bay', category: 'industry', era: 2,
    footprint: [2, 2], height: 4, buildTime: 40,
    buildCost: { metals: 40, parts: 10 }, crew: 0, powerKW: -3,
    inputs: {}, outputs: {}, upkeepParts: 1, priority: 1, bots: 2,
    pro: 'Two more tireless builders — raise twice as much, twice as fast.',
    con: 'Robots wear parts and sip power even while they wait for work.',
  },
  partsFab: {
    id: 'partsFab', name: 'Parts Fabricator', category: 'industry', era: 3,
    footprint: [2, 2], height: 6, buildTime: 60,
    buildCost: { metals: 60, silicon: 10 }, crew: 3, powerKW: -10,
    inputs: { metals: 0.4 }, outputs: { parts: 0.3 }, upkeepParts: 1, priority: 2,
    pro: 'Ends your dependence on the lander’s spare-parts cache.',
    con: 'Three crew on the line — your scarcest resource, standing at a bench.',
  },
  reactor: {
    id: 'reactor', name: 'Thorium Reactor', category: 'power', era: 3,
    footprint: [3, 3], height: 9, buildTime: 150,
    buildCost: { metals: 120, parts: 40 }, crew: 1, powerKW: 40,
    inputs: {}, outputs: {}, upkeepParts: 4, priority: 0,
    moraleDelta: -5,
    pro: 'Forty kilowatts that do not care whether the sun is up.',
    con: 'Nobody sleeps well beside a reactor — and it eats parts like a fleet of rovers.',
  },
  recDome: {
    id: 'recDome', name: 'Recreation Dome', category: 'life', era: 3,
    footprint: [3, 3], height: 7, buildTime: 70,
    buildCost: { metals: 50, silicon: 5 }, crew: 1, powerKW: -4,
    inputs: { food: 0.05 }, outputs: {}, upkeepParts: 1, priority: 3,
    moraleDelta: 14,
    pro: 'The biggest single lever on morale — and morale multiplies everything.',
    con: 'A pure cost center. It consumes and produces nothing but goodwill.',
  },
  foilFactory: {
    id: 'foilFactory', name: 'Foil Factory', category: 'export', era: 4,
    footprint: [3, 3], height: 8, buildTime: 120,
    buildCost: { metals: 80, parts: 30 }, crew: 3, powerKW: -20,
    inputs: { silicon: 0.6, metals: 0.2 }, outputs: { foils: 0.05 }, upkeepParts: 2, priority: 2,
    pro: 'Thin-film collector foils: the actual substance of the Dyson swarm.',
    con: 'The largest power draw on the Moon. Your grid will remember this purchase.',
  },
  massDriver: {
    id: 'massDriver', name: 'Mass Driver', category: 'export', era: 4,
    footprint: [6, 2], height: 6, buildTime: 180,
    buildCost: { metals: 150, parts: 50 }, crew: 2, powerKW: -15,
    inputs: { parts: 0.02 }, outputs: { launch: 0.01 }, upkeepParts: 3, priority: 2,
    pro: 'Two point four kilometers a second, no rocket required.',
    con: 'A power-hungry rail with a long shadow — and it needs truly flat ground.',
  },
};

export const BUILD_ORDER: BuildingId[] = [
  'solar', 'battery', 'reactor',
  'excavator', 'iceHarvester',
  'smelter', 'refinery', 'roboticsBay', 'partsFab',
  'habitat', 'hydroponics', 'recDome',
  'lab',
  'foilFactory', 'massDriver',
];

export const CATEGORY_ORDER: Category[] = ['power', 'extraction', 'industry', 'life', 'science', 'export'];
export const CATEGORY_LABEL: Record<Category, string> = {
  power: 'Power', extraction: 'Extraction', industry: 'Industry',
  life: 'Life', science: 'Science', export: 'Export',
};
