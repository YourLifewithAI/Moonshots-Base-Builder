/** The Moon (docs/20 §4.4): what every base on it shares.
 *
 *  - One absolute clock (`clock`, game seconds since day 0, the first landing): every base's
 *    `s.simTime` IS this clock, so day and night, rotations and deadlines need no change.
 *  - One flare schedule (`weather`): the idle → telegraph → active → tail machine that
 *    `weatherTick` ran per base, lifted here. The schedule fields of `s.flare` are a mirror of
 *    it (spaceWeather.ts `syncFlare`); everything a base does about a flare (the arrays, the
 *    machines, the tally) stays per base. A solo game runs the same machine on its own
 *    `s.flare`, so one code path decides both.
 *  - Exclusive prospect claims (`claims`): the first faction to claim a prospect holds it.
 *  - The race (`race`): per faction launches and shares, and the verdict (S6 writes it).
 *
 *  A base joins a Moon with `bindMoon(state, moon)` (a WeakMap, as `bindTerrain`). A state with
 *  no Moon bound is the solo game of today; nothing here touches it.
 *
 *  Pure and deterministic: every draw is mulberry32((seed ^ K) + index) with the MOON's seed. */
import type { ProspectId } from '../data/lunarMap';
import type { SiteId } from '../data/sites';
import { CYCLE_S } from '../data/balance';
import { SPACE_WEATHER as W, type FlareClass } from '../data/spaceWeather';
import { activity, drawClass, migrateFlareSchema, rangeOf, telegraphOf, type ClassCtx } from './spaceWeather';
import { mulberry32 } from './rng';
import type { FlareState, GameState } from './state';

// TODO: re-export from data/factions.ts (fw0d) and delete this alias when that file is on main.
export type FactionId = 'robots' | 'accelerationists' | 'solarpunks';
export const FACTION_IDS: readonly FactionId[] = ['robots', 'accelerationists', 'solarpunks'];

/** The words a refusal or a line uses for a faction. TODO: `FACTION_NAME[f]` from data/factions.ts. */
export const factionName = (f: FactionId): string => f;

// ─────────────────────────── the schedule ───────────────────────────

/** The fields of a flare that belong to the SCHEDULE, not to a base: `s.flare` has them (a solo game
 *  runs the machine on it), and so does the Moon's weather. */
export type SchedFields = Pick<FlareState,
  'phase' | 'timer' | 'nextAt' | 'n' | 'cls' | 'drill' | 'range' | 'startedAt' | 'flashAt' | 'firmAt' | 'activeAt' | 'a'
  | 'seen' | 'xCount' | 'lastX' | 'noXUntil' | 'watchN' | 'watch' | 'nextCls' | 'cme'>;

/** The schedule keys copied by value (`seen`, `range` and `cme` are copied deep by `copySched`). */
export const SCHED_KEYS = [
  'phase', 'timer', 'nextAt', 'n', 'cls', 'drill', 'range', 'startedAt', 'flashAt', 'firmAt', 'activeAt', 'a',
  'xCount', 'lastX', 'noXUntil', 'watchN', 'watch', 'nextCls',
] as const;

/** The Moon's weather: the schedule, plus what the Moon needs to run it without a base. */
export interface MoonWeather extends SchedFields {
  /** the PLAYER's era, forecast lead and tier as of the player's last weather tick: the class odds follow
   *  the player's era (docs/20 §4.4), the telegraph starts `lead` before the flash and is firm at once
   *  from tier 2 (the sentinel). A rival's forecast never moves the shared schedule. */
  era?: number;
  lead?: number;
  tier?: number;
  /** the flare in flight is the first of its class on this Moon (the FIRST FLARE card) */
  first?: boolean;
  /** the lunar days the last flare's end drew to the next (its alert's words) */
  lastDays?: number;
}

/** What the machine reads: the Moon's (or a solo game's) seed, the era the class odds use, the clock,
 *  and the forecast's lead and tier. */
export interface SchedCtx { seed: number; era: number; now: number; lead: number; tier: number }

export function defaultMoonWeather(): MoonWeather {
  return {
    phase: 'idle', timer: 0, nextAt: W.firstAtDay * CYCLE_S, n: 0, seen: { C: false, M: false, X: false, xReal: false },
    xCount: 0, lastX: -1e9, noXUntil: 0, era: 1, lead: 0, tier: 0,
  };
}

const classCtx = (sc: SchedFields): ClassCtx => ({
  seenM: !!sc.seen?.M, xCount: sc.xCount ?? 0, lastX: sc.lastX ?? -1e9, noXUntil: sc.noXUntil ?? 0,
});

/** The spot-group watch (idle): half a day ahead the next flare's class is looked at; an X is locked in.
 *  True when an X was just locked (the alert is the base's). */
export function schedWatch(sc: SchedFields, c: SchedCtx): boolean {
  const n = sc.n ?? 0;
  if (sc.watchN === n || c.now < sc.nextAt - W.watchDays * CYCLE_S) return false;
  sc.watchN = n;
  sc.nextCls = drawClass({ seed: c.seed }, n, sc.nextAt, c.era, classCtx(sc));
  sc.watch = sc.nextCls === 'X';
  return sc.watch;
}

/** The telegraph is due (idle): a forecast's lead starts it early; the flash keeps the schedule's time.
 *  Its class (never an X without its watch; a watched X comes) and flash, or null. */
export function schedDue(sc: SchedFields, c: SchedCtx): { cls: FlareClass; flashAt: number } | null {
  if (c.now < sc.nextAt - c.lead) return null;
  const n = sc.n ?? 0;
  const flashAt = Math.max(c.now, sc.nextAt);
  let cls = drawClass({ seed: c.seed }, n, flashAt, c.era, classCtx(sc));
  if (cls === 'X' && sc.nextCls !== 'X') cls = 'M';
  if (sc.nextCls === 'X') cls = 'X';
  return { cls, flashAt };
}

/** Start a flare's telegraph now (the schedule half of `startFlare`): the class, its timing, range and
 *  the counters. `flashAt`: the flash the schedule set (the telegraph starts that much early); unset, the
 *  flash comes after the lead, from now. Returns whether it is the first of its class on this schedule. */
export function schedStart(sc: SchedFields, c: SchedCtx, cls: FlareClass, o: { drill?: boolean; flashAt?: number } = {}): boolean {
  const n = sc.n ?? 0;
  const lead = o.flashAt !== undefined ? Math.max(0, o.flashAt - c.now) : c.lead;
  const flashAt = c.now + lead;
  sc.phase = 'telegraph';
  sc.cls = cls;
  sc.drill = o.drill ?? (n === 0 || (cls === 'X' && (sc.xCount ?? 0) === 0));
  sc.timer = lead + telegraphOf(cls, sc.drill);
  sc.startedAt = c.now;
  sc.flashAt = flashAt;
  sc.firmAt = c.tier >= 2 ? c.now : flashAt + W.firmAtS;
  sc.activeAt = c.now + sc.timer;
  sc.range = rangeOf(c.seed, n, cls);
  sc.a = activity(c.seed, flashAt / CYCLE_S);
  sc.watch = false;
  delete sc.nextCls;
  sc.seen ??= { C: false, M: false, X: false, xReal: false };
  const first = !sc.seen[cls];
  sc.seen[cls] = true;
  if (cls === 'X') {
    sc.xCount = (sc.xCount ?? 0) + 1;
    sc.lastX = flashAt;
  }
  return first;
}

/** The protons arrive (telegraph → active): the phase, its timer. */
export function schedActive(sc: SchedFields, c: SchedCtx) {
  sc.phase = 'active';
  sc.timer = W.classes[sc.cls ?? 'C'].activeS;
  sc.activeAt = c.now;
}

/** The CME after an X and one M in three: 0.4 lunar day after the flash. */
export function schedCme(sc: SchedFields, c: SchedCtx) {
  const cls = sc.cls ?? 'C';
  const n = sc.n ?? 0;
  if (cls === 'X' || (cls === 'M' && mulberry32((c.seed ^ W.keys.cme) + n)() < W.cme.mShare)) {
    const at = (sc.flashAt ?? sc.startedAt ?? c.now) + W.cme.delayDays * CYCLE_S;
    sc.cme = { at, until: at + W.cme.sailS };
  }
}

/** An X's flash is over: its proton-storm tail. */
export function schedTail(sc: SchedFields) {
  sc.phase = 'tail';
  sc.timer = W.classes.X.tailS;
}

/** Quiet again: the next flare scheduled (its interval, in lunar days, is returned). */
export function schedEnd(sc: SchedFields, c: SchedCtx): number {
  const a = sc.a ?? activity(c.seed, c.now / CYCLE_S);
  const u = mulberry32((c.seed ^ W.keys.interval) + (sc.n ?? 0))();
  const days = (W.interval.base - W.interval.slope * a) * (1 + (u - 0.5) * 2 * W.interval.jitter);
  sc.nextAt = c.now + days * CYCLE_S;
  sc.n = (sc.n ?? 0) + 1;
  sc.phase = 'idle';
  sc.timer = 0;
  delete sc.watch;
  delete sc.nextCls;
  return days;
}

/** Copy the schedule fields of `from` onto `to` (deleting what `from` lacks; arrays and objects copied). */
export function copySched(to: SchedFields, from: SchedFields) {
  const t = to as unknown as Record<string, unknown>;
  const f = from as unknown as Record<string, unknown>;
  for (const k of SCHED_KEYS) {
    if (f[k] === undefined) delete t[k];
    else t[k] = Array.isArray(f[k]) ? [...(f[k] as unknown[])] : f[k];
  }
  if (from.seen) to.seen = { ...from.seen };
  if (from.cme) to.cme = { ...from.cme }; else delete to.cme;
}

// ─────────────────────────── the Moon ───────────────────────────

/** A faction's place on the Moon: where it lands, when (the Moon clock at the landing day's start), and whether it has. */
export interface MoonFaction { siteId: SiteId; landedAt: number; expedition: 'human' | 'robotic'; landed: boolean }
export interface MoonRaceEntry { launches: number; swarmPct: number; firstLaunchAt: number | null; era: number }
export type RacePhase = 'solo' | 'pre' | 'lit' | 'closed';

export interface MoonState {
  version: 2;
  /** the Moon's seed: the flare cycle and every weather draw. A solo game's is its own `s.seed`. */
  seed: number;
  /** the absolute clock, game seconds since day 0 */
  clock: number;
  /** the player's faction; null in a solo game (no faction, no rivals) */
  player: FactionId | null;
  factions: Record<FactionId, MoonFaction>;
  weather: MoonWeather;
  /** who holds each claimed prospect. A solo game writes none (nobody to claim against). */
  claims: Partial<Record<ProspectId, FactionId>>;
  race: Record<FactionId, MoonRaceEntry> & { phase: RacePhase; closeAt: number; winner?: FactionId };
}

/** A fresh Moon. `siteId` fills the factions' placeholder entries (a solo game: its own site, nobody landed). */
export function createMoon(seed: number, o: {
  clock?: number; player?: FactionId | null; siteId?: SiteId; closeAt?: number; phase?: RacePhase;
} = {}): MoonState {
  const siteId = o.siteId ?? 'mare';
  const faction = (): MoonFaction => ({ siteId, landedAt: 0, expedition: 'robotic', landed: false });
  const entry = (): MoonRaceEntry => ({ launches: 0, swarmPct: 0, firstLaunchAt: null, era: 1 });
  return {
    version: 2, seed, clock: o.clock ?? 0, player: o.player ?? null,
    factions: { robots: faction(), accelerationists: faction(), solarpunks: faction() },
    weather: defaultMoonWeather(),
    claims: {},
    race: {
      robots: entry(), accelerationists: entry(), solarpunks: entry(),
      // TODO: RACE.closeAt from data/balance.ts (S6); 100 combined volleys = 0.01 %
      phase: o.phase ?? (o.player ? 'pre' : 'solo'), closeAt: o.closeAt ?? 100,
    },
  };
}

const moons = new WeakMap<object, MoonState>();
/** A base joins the Moon (a WeakMap by state, as `bindTerrain`). */
export function bindMoon(s: GameState, moon: MoonState): void { moons.set(s, moon); }
/** The Moon a base is on; undefined for a solo game with none bound. */
export function moonOf(s: object): MoonState | undefined { return moons.get(s); }
/** A base leaves its Moon (tests). */
export function unbindMoon(s: GameState): void { moons.delete(s); }

/** The seed the flare SCHEDULE draws from: the Moon's, else the base's own. */
export const weatherSeed = (s: { seed: number }): number => moons.get(s)?.seed ?? s.seed;

/** The schedule's inputs at the Moon's clock. */
export function moonCtx(moon: MoonState, now = moon.clock): SchedCtx {
  const w = moon.weather;
  return { seed: moon.seed, era: w.era ?? 1, now, lead: w.lead ?? 0, tier: w.tier ?? 0 };
}

/** One game second of the Moon: the clock, and the flare schedule's idle / telegraph / active / tail machine.
 *  dt is 1 (several systems assume integer 1 s steps). The per-base halves of each edge (the arrays, the
 *  machines, the tally) are the bases': spaceWeather.ts `weatherTick` runs them as it sees the phase change. */
export function moonWeatherTick(moon: MoonState, dt: number): void {
  moon.clock += dt;
  const sc = moon.weather;
  const c = moonCtx(moon);
  switch (sc.phase) {
    case 'idle': {
      schedWatch(sc, c);
      const due = schedDue(sc, c);
      if (due) sc.first = schedStart(sc, c, due.cls, { flashAt: due.flashAt });
      break;
    }
    case 'telegraph':
      sc.timer -= dt;
      if (sc.timer <= 0) { schedActive(sc, c); schedCme(sc, c); }
      break;
    case 'active':
      sc.timer -= dt;
      if (sc.timer <= 0) {
        if ((sc.cls ?? 'C') === 'X') schedTail(sc);
        else sc.lastDays = schedEnd(sc, c);
      }
      break;
    case 'tail':
      sc.timer -= dt;
      if (sc.timer <= 0) sc.lastDays = schedEnd(sc, c);
      break;
  }
}

/** Run the Moon forward to `to` (a base that has reached that second calls it; a no-op when the Moon is
 *  already there or ahead). Whoever reaches a second first drives it, so the Game loop may call
 *  `moonWeatherTick` before or after the player's tick, or not at all while a base ticks. */
export function moonCatchUp(moon: MoonState, to: number): void {
  while (moon.clock < to - 1e-9) moonWeatherTick(moon, Math.min(1, to - moon.clock));
}

/** Is this base the one whose era, forecast lead and tier the shared schedule follows: the player's (a solo game's only base)? */
export const isDriver = (s: { faction?: FactionId }, moon: MoonState): boolean => (s.faction ?? null) === moon.player;

/** The Moon of a saved v1 game: SOLO. The clock is the state's, the weather is lifted from its `s.flare`
 *  (migrating an old flare schema first), the seed is its own, nobody else has landed and nothing is claimed. */
export function moonFromState(s: GameState): MoonState {
  if ((s.flareSchema ?? 0) < 1 || !s.weather) migrateFlareSchema(s);
  const m = createMoon(s.seed, { clock: s.simTime, player: null, siteId: s.siteId, phase: 'solo' });
  const w = m.weather;
  const f = s.flare;
  copySched(w, f);
  w.n ??= 0;
  w.xCount ??= 0;
  w.lastX ??= -1e9;
  w.noXUntil ??= 0;
  w.seen ??= { C: false, M: false, X: false, xReal: false };
  if (!w.nextAt) w.nextAt = W.firstAtDay * CYCLE_S;
  w.era = s.era;
  w.lead = s.weather?.lead ?? 0;
  w.tier = s.weather?.tier ?? 0;
  return m;
}

/** The claimant a base's claims are filed under: its faction (a solo game files none). */
export const claimantOf = (s: { faction?: FactionId }): FactionId | null => s.faction ?? null;
