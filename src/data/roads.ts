/** Road tuning, doors and the field types (docs/15-roads.md). The network
 *  itself is core/roads.ts. */
import type { BuildingId } from './buildings';

export const ROAD = {
  /** rover-seconds to sinter one 4 m cell (n rovers: n^0.85 as fast) */
  cellS: 2,
  /** the steepest step between neighbouring cell centres a road may take, m */
  maxStep: 1.6,
  /** A* cost per metre of height step (a new cell costs 1) */
  slopeCost: 0.6,
  /** A field structure is served by a road cell this many cells from its footprint */
  fieldReach: 1,
  /** m right of the centre line a rover drives */
  lane: 1,
  /** parking slots a bay cell holds */
  bayCap: 2,
  /** inside an extraction zone units drive off-road (core/zones.ts): this share of road speed */
  offroad: 0.5,
};

/** A construction rover on the road (docs/15 §6): the sim times every trip
 *  with these (core/transit.ts) and the visuals drive with them
 *  (world/rovers.ts). `speed` is the cruise on a sintered road, before the
 *  roadway tiers (Basalt Paving ×1.25, Guidance Beacons ×1.1 and ×1.25 at
 *  night, Maglev ×1.3); `accel` sets the start and the stop: a trip of L m
 *  takes L / v + v / a s (2·√(L/a) when it is too short to reach v). The
 *  Apollo LRV did about 3.6 m/s. */
export const ROVER = { speed: 4.5, accel: 3 };

/** where the Drone Hive's parked drones perch on its deck (building frame,
 *  the deck top at y 1.62): the sim's parking points (core/transit.ts) and
 *  the recipe's marked pads (buildings/recipes.ts) */
export const HIVE_PADS: readonly (readonly [number, number])[] = [[-2.1, 1.3], [2.1, 1.3], [-2.1, 3.9], [2.1, 3.9]];
export const HIVE_DECK_Y = 1.64;

/** Structures served from the edge of their field: no road between them. */
export const FIELD_TYPES: ReadonlySet<BuildingId> = new Set<BuildingId>(['solar', 'battery']);

/** Structures reached off-road (docs/15 §5b): no door, no road, no spur. A
 *  rover drives out from the nearest road cell across open ground, at
 *  ROAD.offroad of road speed, and works from beside it. */
export const OFFROAD_TYPES: ReadonlySet<BuildingId> = new Set<BuildingId>(['relayMast', 'solarObservatory']);

/** Docks: rovers park in bays laid beside the door. A Drone Hive (docs/14
 *  §2.8) is one: its four rovers launch from it and park there. The other
 *  destiny buildings (Greenhouse Ring, Garden Dome, Server Monolith) take a
 *  plain door at their front middle. */
export const DOCK_TYPES: ReadonlySet<BuildingId> = new Set<BuildingId>(['lander', 'roboticsBay', 'droneHive']);

/** The Lander's apron, in cells relative to its door cell (the door itself
 *  included; dx along the front, dz outward): a two-cell run out from the
 *  door with a parking bay either side of its second cell, then a stub. The
 *  bays sit off the door, so an excavator unloading there (nose to the
 *  wall, 6 m long) passes them by; new roads join only at the stub's `end`,
 *  so nothing drives through the apron (or turns beside its bays). */
export const APRON: { dx: number; dz: number; bay?: boolean; end?: boolean }[] = [
  { dx: 0, dz: 0 }, { dx: 0, dz: 1 }, { dx: -1, dz: 1, bay: true }, { dx: 1, dz: 1, bay: true },
  { dx: 0, dz: 2 }, { dx: 0, dz: 3, end: true },
];
