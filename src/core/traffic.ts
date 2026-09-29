/** Sim-side traffic reservations (docs/19, improvement 8; S4a owns this file).
 *
 *  The sim has no collisions today: a unit moves along its waypoints whether
 *  or not another holds the ground (only the visual layer, world/traffic.ts,
 *  avoids overlaps). S4a makes the sim reserve road and zone cells: a unit
 *  reserves the run ahead to the next bay, junction or gate, an opposing unit
 *  waits at the bay it is in, loaded before empty before rover, ties by id.
 *  Reservations are rebuilt every tick and never saved.
 *
 *  Contract stream W0d, a functional stub: every reservation is granted, so
 *  callers (S3's gates and bays, S4a's holding bays, S5's grade trips) code
 *  against the final signatures and behave as today until S4a lands. */
import type { GameState } from './state';

/** A unit that holds cells: a hub unit (`hauler`, its id) or a roster rover. */
export interface UnitRef {
  kind: 'hauler' | 'rover';
  id: number;
}

/** Ask for the road or zone cells (cell keys, core/roads.ts cellKey) `unit` will cross next.
 *  True: they are its own until it releases them. */
export function reserve(_s: GameState, _unit: UnitRef, _cells: readonly number[]): boolean {
  return true;
}

/** Give the cells back (all of the unit's when `cells` is left out). */
export function release(_s: GameState, _unit: UnitRef, _cells?: readonly number[]): void {
  // nothing is held yet (see reserve)
}
