/** A rival program (docs/20 §4.5): another faction's base on the same Moon, a real `BaseSim` nobody draws. It runs the
 *  economy on a flat stand-in ground (`FlatHeights`), with straight legs, no traffic and virtual pits
 *  (`HEADLESS_MODE`), ticks once per Moon second in lockstep with the player's base (dt is always 1) and writes its
 *  standing to `moon.race`.
 *
 *  THIS IS THE STUB of the integration (stream W0i): a rival lands, ticks and stays passive (its Lander only). The
 *  policy (research, the Builder's rules and orders, claims, launches) is stream S4's: it fills `step()` (and
 *  `FACTIONS[f].policy`, data/factions.ts); everything that places a rival on the Moon, steps it, saves and loads it
 *  is already here. */
import { BaseSim } from './baseSim';
import { HEADLESS_MODE } from './simMode';
import type { MoonState } from './moon';
import { hashString } from './rng';
import type { GameState } from './state';
import type { RivalInfo } from './exploration';
import { fleetLists } from './surveyDrones';
import type { SiteId } from '../data/sites';
import { FACTIONS, FACTION_NAME, FACTION_ORDER, type FactionId } from '../data/factions';

/** A rival base's seed: the Moon's seed mixed with its faction (its ground's deposits, every base-local draw). The
 *  PLAYER's base keeps the game's own seed, so a faction game on a site has the terrain of the solo game on it. */
export const rivalSeed = (moonSeed: number, faction: FactionId): number => (moonSeed ^ hashString(faction)) >>> 0;

export class RivalProgram {
  readonly faction: FactionId;
  readonly base: BaseSim;
  readonly moon: MoonState;
  /** whole steps this program has run (the debug counters read it) */
  steps = 0;

  private constructor(faction: FactionId, base: BaseSim, moon: MoonState) {
    this.faction = faction;
    this.base = base;
    this.moon = moon;
  }

  /** A faction lands: its base on `siteId`, its clock starting at `landedAt + 90` (mid-morning of its landing day). */
  static land(faction: FactionId, moon: MoonState, siteId: SiteId, landedAt: number): RivalProgram {
    const base = BaseSim.create({
      siteId, seed: rivalSeed(moon.seed, faction), expedition: FACTIONS[faction].expedition, faction, landedAt,
      mode: HEADLESS_MODE, flat: true, moon,
    });
    const r = new RivalProgram(faction, base, moon);
    r.report();
    return r;
  }

  /** A saved rival (the stripped state `save.ts` keeps): back on its ground and its Moon. */
  static fromState(faction: FactionId, state: GameState, moon: MoonState): RivalProgram {
    const r = new RivalProgram(faction, BaseSim.fromState(state, HEADLESS_MODE, moon, true), moon);
    r.base.clearOut();
    return r;
  }

  get state(): GameState { return this.base.state; }

  /** One Moon second: the economy step (the clock moves by 1 and the base ticks), the mailbox nobody reads emptied, the
   *  standing written to the Moon. S4 adds the policy here (research, the Builder's orders, claims). */
  step() {
    const ev = this.base.tick();
    // a crewed base whose last crew died falls silent (economy.ts): it is lost, as the player's would be, and its ticks end there
    if (ev.defeat) this.base.state.defeatShown = true;
    this.base.clearOut();
    this.steps++;
    this.report();
  }

  /** `moon.race[faction]`: what the race reads of this program (launches, its share of the swarm, its first light, its era). */
  private report() {
    const s = this.base.state;
    const prev = this.moon.race[this.faction];
    this.moon.race[this.faction] = {
      launches: s.launches, swarmPct: s.swarmPct, era: s.era,
      firstLaunchAt: prev.firstLaunchAt ?? (s.launches > 0 ? s.simTime : null),
    };
  }
}

/** The other programs as the Lunar Map and the race panels read them (`lunarView`'s `rivals`): in landing order, the
 *  landed ones with their outposts, the rest as "lands day N". Empty in a solo game. */
export function rivalInfos(moon: MoonState, rivals: readonly RivalProgram[]): RivalInfo[] {
  if (moon.player === null) return [];
  return FACTION_ORDER.filter((f) => f !== moon.player).map((f) => {
    const m = moon.factions[f];
    const r = rivals.find((x) => x.faction === f);
    return {
      faction: f, name: FACTION_NAME[f], siteId: m.siteId, landed: m.landed, landedAt: m.landedAt,
      outposts: r ? r.state.survey.outposts.map((o) => o.id) : [], launches: moon.race[f].launches, era: moon.race[f].era,
      surveying: r ? fleetLists(r.state).flights.map((fl) => fl.id) : [],
    };
  });
}
