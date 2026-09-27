/** Extraction hubs (docs/17 §3–§5): the processing buildings that print,
 *  dock, charge and dispatch their own robots — the units — and the unit
 *  types. The sim is core/hubs.ts. A future hub is one more row here. */
import type { BuildingId } from './buildings';
import type { DepositKind } from './deposits';
import type { SiteDef } from './sites';

/** The two unit types (both stay in BUILDINGS, flagged unit: their rates
 *  and every tech effect naming them go through effectiveDef and Mods). */
export type UnitType = 'excavator' | 'iceMiner';

export interface HubDef {
  /** the unit it prints (a water plant on the ice prints Ice Miners) */
  unit: (site: Pick<SiteDef, 'hasIce'>) => UnitType;
  /** the deposit kinds its units want (the auto choice weighs these) */
  wants: (site: Pick<SiteDef, 'hasIce'>) => DepositKind[];
  /** may its units dig plain ground (a staked plain pit, §8.6)? */
  plain: (site: Pick<SiteDef, 'hasIce'>) => boolean;
  /** hopper capacity, ▲ (three buckets) */
  hopper: number;
}

export const HUB_DEFS: Partial<Record<BuildingId, HubDef>> = {
  smelter: { unit: () => 'excavator', wants: () => ['ilmenite'], plain: () => true, hopper: 315 },
  refinery: { unit: () => 'excavator', wants: () => ['anorthosite'], plain: () => true, hopper: 315 },
  // the pole's water is in the cold traps; elsewhere it is baked out of mature soil
  waterPlant: {
    unit: (s) => (s.hasIce ? 'iceMiner' : 'excavator'),
    wants: (s) => (s.hasIce ? ['ice'] : ['volatiles']),
    plain: (s) => !s.hasIce,
    hopper: 315,
  },
};

/** Every hub type, in a stable order. */
export const HUB_TYPES: readonly BuildingId[] = ['smelter', 'refinery', 'waterPlant'];
export const isHubType = (t: BuildingId): boolean => HUB_DEFS[t] !== undefined;

export interface UnitDef {
  /** 'E' for an excavator, 'I' for an ice miner: the unit's tag, E3 */
  letter: string;
  /** printed at its hub: the price (× the site's buildCostMult) and the print time (× it too) */
  cost: { metals: number; parts: number };
  printS: number;
  /** a bucket at nameplate (it grows with the unit's output multipliers), s to fill it, s to tip it */
  bucket: number;
  digS: number;
  unloadS: number;
  /** m/s on roads, before the haul techs and the roadway tiers */
  speed: number;
}

export const UNIT_DEFS: Record<UnitType, UnitDef> = {
  excavator: { letter: 'E', cost: { metals: 20, parts: 5 }, printS: 60, bucket: 105, digS: 60, unloadS: 4, speed: 5 },
  // a tracked crawler with a heated auger: ice-cemented ground digs slower
  iceMiner: { letter: 'I', cost: { metals: 25, parts: 5 }, printS: 70, bucket: 105, digS: 75, unloadS: 6, speed: 4 },
};

/** Hub tuning (docs/17 §4). Distances in m, times in game-s. */
export const HUB = {
  /** reach: one way at the unit's current speed; Send… goes to `sendReach` × it */
  reachS: 90, sendReach: 2,
  /** jobs a hub's queue holds */
  queueMax: 3,
  /** bays by level (Level I from landing; II and III are bought per hub once research allows it) */
  bays: [2, 3, 4] as const,
  /** + Bay: a queue job at the hub */
  bay: { cost: { metals: 30, parts: 10 }, printS: 60 },
  /** a print job's draw, kW (a construction rover's) */
  printKW: 4,
  /** a plain pit (§8.6, a staked point its pit opens by): its zone's radius, its faces,
   *  and where the stake goes from the hub's door (it keeps the pits' setbacks clear:
   *  12 m from structures' walls, 8 m from roads, doors and bays, PIT.padRings/roadRings) */
  plainR: 12, plainFaces: 3, plainMinM: 20, plainMaxM: 60,
  /** a deposit's faces until faces grow with the pit (Phase 4): its full-size ring's,
   *  floor(2π × faceRing × r / faceM), 1–facesMax */
  faceM: 30, faceRing: 1.45, facesMax: 6,
  /** face points: this share of a deposit's radius out from its centre; m from a plain pit's stake */
  faceR: 0.45, plainFaceR: 6,
  /** a unit whose pack is below this share once it has tipped goes to its bay to charge */
  chargeAt: 0.3,
  /** the starved share is an EMA over this many game-s */
  starvedS: 120,
};

/** The visuals key a hub unit by this offset plus its id (building ids stay below it). */
export const UNIT_VID = 100000;
