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
};

/** Structures served from the edge of their field: no road between them. */
export const FIELD_TYPES: ReadonlySet<BuildingId> = new Set<BuildingId>(['solar', 'battery', 'relayMast']);

/** Docks: rovers park in bays laid beside the door. */
export const DOCK_TYPES: ReadonlySet<BuildingId> = new Set<BuildingId>(['lander', 'roboticsBay']);

/** The Lander's apron, in cells relative to its door cell (the door itself
 *  included; dx along the front, dz outward): a two-cell run out from the
 *  door with a parking bay either side of its second cell, then a stub. The
 *  bays sit off the door, so an excavator unloading there (nose to the
 *  wall, 6 m long) passes them by. */
export const APRON: { dx: number; dz: number; bay?: boolean }[] = [
  { dx: 0, dz: 0 }, { dx: 0, dz: 1 }, { dx: -1, dz: 1, bay: true }, { dx: 1, dz: 1, bay: true },
  { dx: 0, dz: 2 }, { dx: 0, dz: 3 },
];
