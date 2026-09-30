/** How a base is simulated (docs/20 §4.3): the player's base runs as it always
 *  has; a rival's runs headless, with cheap stand-ins for what nobody sees.
 *
 *  - `headless`: no world, no renderer, no `b.shaded` (a flat site is lit alike everywhere).
 *  - `straightLegs`: a unit's leg is the straight line to its goal, never a road
 *    search (core/transit.ts `wayTo`, core/haul.ts `legPath`, core/hubs.ts
 *    `unitLeg`/`tripTo`/`wayIn`). It still drives it: the leg's length is charged
 *    at the unit's speed, so nothing teleports.
 *  - `traffic`: reservations on (the default); off, units never wait for one another.
 *  - `virtualPits`: the pits are counted, not carved (core/pits.ts, on a
 *    `FlatHeights` ground; `hf.virtual` is what pits.ts reads).
 *  - `openRoads`: roads are laid open at once (the debug "open roads" of the
 *    player's game); rivals keep them off, so a road still costs the rover-seconds.
 *
 *  The mode is bound per state (a WeakMap: a second base has its own), and
 *  `DEFAULT_MODE` is today's behaviour, so a base nobody binds plays as before.
 *  `TRANSIT`/`TRAFFIC` are the debug API's switches for the player's game
 *  (core/game.ts `debugInstantTravel`); they live here so both transit.ts and
 *  traffic.ts can read the per-state answer without importing each other. */
import type { GameState } from './state';

export interface SimMode {
  headless: boolean;
  straightLegs: boolean;
  traffic: boolean;
  virtualPits: boolean;
  openRoads: boolean;
}

/** Today's behaviour: the visible base. */
export const DEFAULT_MODE: Readonly<SimMode> = Object.freeze({
  headless: false, straightLegs: false, traffic: true, virtualPits: false, openRoads: false,
});

/** Tests where timing is not the point (debug): every trip ends as it starts, and a new goal is reached in the tick that sets it. */
export const TRANSIT = { instant: false };
/** Tests where timing is not the point (debug): no reservations. */
export const TRAFFIC = { bypass: false };

const modes = new WeakMap<GameState, SimMode>();

/** Bind a state's mode (`BaseSim` does, for a rival). */
export function bindMode(s: GameState, m: SimMode) { modes.set(s, m); }
/** A state's mode: today's behaviour when none was bound. */
export const modeOf = (s: GameState): Readonly<SimMode> => modes.get(s) ?? DEFAULT_MODE;

/** Debug instant travel for this base (every trip ends as it starts). A headless base is never teleported:
 *  its legs are straight and still driven (`modeOf(s).straightLegs`), so the debug switch is for the visible base. */
export const instantOf = (s: GameState): boolean => TRANSIT.instant && !modeOf(s).headless;

/** No traffic reservations for this base: the debug bypass, or a base that runs without traffic. */
export const trafficOff = (s: GameState): boolean => TRAFFIC.bypass || !modeOf(s).traffic;

/** This base's legs are the straight line to the goal (no road search). */
export const straightOf = (s: GameState): boolean => modeOf(s).straightLegs;

/** A straight leg's stand-in for the road grid (4-connected cells, joined by bends): its metres over open ground
 *  count this many times (the same 1.3 core/hubs.ts `tripTo` estimates a target no road reaches yet with). Inside an
 *  extraction zone the game's own off-road weight applies. */
export const STRAIGHT_DETOUR = 1.3;
