/** The destiny's look (docs/14 §4): how far the base leans toward ⌂ Colony
 *  or ◉ Automation, and the colour of each structure's own light. Pure: no
 *  Three.js, so the renderer, the links layer and the audio read the same
 *  numbers.
 *
 *  The lean runs from −1 (Automation) to +1 (Colony). Once the Era 8 pick
 *  settles the band it is the band's (+1, −1, Concord 0); before that it
 *  follows the meter, (C − A) / 4, clamped.
 *
 *  Warmth (the per-instance `iWarm`, 0 cold … 1 warm): Colony types burn
 *  warm, machine types cold, and everything else follows the lean — warm
 *  (as the base has always looked) at the human landing's lean of +¼ and
 *  above, cold by −¾. */
import type { BuildingId } from '../data/buildings';
import { destinyCounts, type Band } from '../data/techs';

/** homes and gardens: always warm */
export const WARM_TYPES: ReadonlySet<BuildingId> = new Set<BuildingId>([
  'habitat', 'hydroponics', 'recDome', 'greenhouseRing', 'gardenDome',
]);
/** machines: always cold */
export const COLD_TYPES: ReadonlySet<BuildingId> = new Set<BuildingId>([
  'dataCenter', 'serverMonolith', 'droneHive', 'chipFab', 'partsFab', 'roboticsBay', 'relayMast',
]);

/** The lean from the meter's counts and the settled band (null: not yet). */
export function leanFrom(c: number, a: number, band: Band | null): number {
  if (band === 'colony') return 1;
  if (band === 'automation') return -1;
  if (band === 'concord') return 0;
  return Math.max(-1, Math.min(1, (c - a) / 4));
}

/** The base's lean, −1 (Automation) … +1 (Colony). */
export function leanOf(techsDone: readonly string[]): number {
  const { c, a, band } = destinyCounts(techsDone);
  return leanFrom(c, a, band);
}

/** How warm a structure's own light burns, 0 cold … 1 warm. The Lander is
 *  warm while anyone lives aboard. */
export function warmthOf(type: BuildingId, lean: number, crewed: boolean): number {
  if (WARM_TYPES.has(type) || (type === 'lander' && crewed)) return 1;
  if (COLD_TYPES.has(type)) return 0;
  return Math.max(0, Math.min(1, 0.75 + lean));
}
