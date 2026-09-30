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
import { CYCLE_S, RACE } from '../data/balance';
import { SPACE_WEATHER as W, type FlareClass } from '../data/spaceWeather';
import { activity, drawClass, migrateFlareSchema, rangeOf, telegraphOf, type ClassCtx } from './spaceWeather';
import { mulberry32 } from './rng';
import type { FlareState, GameState } from './state';

import { FACTIONS, FACTION_NAME, FACTION_ORDER, type FactionId } from '../data/factions';
export type { FactionId };

/** The words a refusal or a line uses for a faction: 'The Foundry'. */
export const factionName = (f: FactionId): string => FACTION_NAME[f];

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

const SCHED_SET: ReadonlySet<string> = new Set(SCHED_KEYS);

/** Copy the schedule fields of `from` onto `to` (deleting what `from` lacks; arrays and objects copied). A key `to` does not
 *  have yet is added in `from`'s own order, so the mirror's keys come in the order the machine wrote them (a solo base's
 *  `s.flare` is that object itself, and its saved JSON and digests read the same either way). */
export function copySched(to: SchedFields, from: SchedFields) {
  const t = to as unknown as Record<string, unknown>;
  const f = from as unknown as Record<string, unknown>;
  for (const k of SCHED_KEYS) if (f[k] === undefined) delete t[k];
  for (const k of Object.keys(f)) {
    if (!SCHED_SET.has(k) || f[k] === undefined) continue;
    t[k] = Array.isArray(f[k]) ? [...(f[k] as unknown[])] : f[k];
  }
  if (from.seen) to.seen = { ...from.seen };
  if (from.cme) to.cme = { ...from.cme }; else delete to.cme;
}

// ─────────────────────────── the Moon ───────────────────────────

/** A faction's place on the Moon: where it lands, when (the Moon clock at the landing day's start), and whether it has. */
export interface MoonFaction { siteId: SiteId; landedAt: number; expedition: 'human' | 'robotic'; landed: boolean }
export interface MoonRaceEntry { launches: number; swarmPct: number; firstLaunchAt: number | null; era: number }
export type RacePhase = 'solo' | 'pre' | 'lit' | 'closed';
/** how the race ended for the player (docs/20 §6, `verdictFor`) */
export type Verdict = 'yours' | 'shared' | 'theirs';
/** what the standings read at the close (the leaderboard stays live after it, the verdict's table does not) */
export type MoonRaceFinal = Record<FactionId, { launches: number; firstLaunchAt: number | null }>;
/** the race's own fields beside the three entries (S6): the phase, the close (`closeAt` combined volleys), and what the close decided */
export interface MoonRaceMeta {
  phase: RacePhase;
  /** combined volleys that close the race (RACE.closeAt; a debug hook may lower it) */
  closeAt: number;
  /** the faction with the largest share at the close (ties to the earlier first light) */
  winner?: FactionId;
  /** the Moon clock second the race closed */
  closedAt?: number;
  /** the player's verdict at the close */
  verdict?: Verdict;
  /** the standings at the close, for the verdict's table */
  final?: MoonRaceFinal;
  /** the last standings beat reported, as a multiple of RACE.beatEvery of combined volleys */
  beat?: number;
  /** who led at the last look (a change is news) */
  leader?: FactionId;
}

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
  race: Record<FactionId, MoonRaceEntry> & MoonRaceMeta;
  /** what happened on the Moon, newest last (capped at FEED_MAX): the one place rivals' doings are recorded for the UI. */
  feed?: FeedEvent[];
  /** the last feed id issued */
  feedSeq?: number;
}

// ─────────────────────────── the feed (docs/20 §4.5: the contract between the rival runner and the UI) ───────────────────────────

/** What kinds of thing the Moon records. The rival runner and the race write them; the notification, map and race UI read them. */
export type FeedKind = 'landed' | 'claim' | 'era' | 'launch' | 'firstLight' | 'lost' | 'hearing' | 'standing' | 'verdict';
export interface FeedEvent {
  id: number;
  /** the Moon clock second it happened */
  at: number;
  faction: FactionId;
  kind: FeedKind;
  /** one line, ready for a notification or the RACE panel: 'THE FOUNDRY CLAIMS MOLTKE — ilmenite outpost' */
  text: string;
  prospect?: ProspectId;
  era?: number;
  /** a count that goes with the kind: launches so far, the standing rank (1-3) */
  n?: number;
}

export const FEED_MAX = 60;

/** Record something on the Moon. Deterministic (ids count up, `at` is the Moon clock unless given). */
export function pushFeed(moon: MoonState, e: Omit<FeedEvent, 'id' | 'at'> & { at?: number }): FeedEvent {
  const feed = (moon.feed ??= []);
  const ev: FeedEvent = { ...e, id: (moon.feedSeq = (moon.feedSeq ?? 0) + 1), at: e.at ?? moon.clock };
  feed.push(ev);
  if (feed.length > FEED_MAX) feed.splice(0, feed.length - FEED_MAX);
  return ev;
}

/** The events after `afterId` (a consumer keeps its own cursor). */
export const feedSince = (moon: MoonState, afterId: number): FeedEvent[] => (moon.feed ?? []).filter((e) => e.id > afterId);

/** Who reacts to the feed: each UI stream registers a handler for the kinds it owns (S1: landed, era, hearing; S5: claim; S6: launch,
 *  firstLight, standing, verdict). `Game` dispatches every new event once, in order, as the Moon's second passes. A handler gets the
 *  event and the player's state (null in a solo game, which has no events). */
export type FeedHandler = (e: FeedEvent, ctx: { moon: MoonState; player: GameState }) => void;
const feedHandlers = new Map<FeedKind | '*', FeedHandler[]>();
export function onFeed(kind: FeedKind | '*', fn: FeedHandler): () => void {
  const list = feedHandlers.get(kind) ?? [];
  list.push(fn);
  feedHandlers.set(kind, list);
  return () => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
}
export function dispatchFeed(e: FeedEvent, ctx: { moon: MoonState; player: GameState }): void {
  for (const fn of feedHandlers.get(e.kind) ?? []) fn(e, ctx);
  for (const fn of feedHandlers.get('*') ?? []) fn(e, ctx);
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
      phase: o.phase ?? (o.player ? 'pre' : 'solo'), closeAt: o.closeAt ?? RACE.closeAt,
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
  while (moon.clock + 1 <= to + 1e-9) moonWeatherTick(moon, 1);
  // a clock created off the base's by a fraction of a second adopts it (the machine never steps by a part of a second)
  if (moon.clock < to - 1e-9) moon.clock = to;
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

// ─────────────────────────── the landing schedule (docs/20 §4.5) ───────────────────────────

/** A faction game's schedule: where each faction lands and on which Moon clock second its landing day begins
 *  (`landsAtDay × CYCLE_S`); nobody has landed yet (the caller marks `landed` as it creates each base). */
export function scheduleLandings(moon: MoonState, sites: Record<FactionId, SiteId>): void {
  for (const f of FACTION_ORDER) {
    const d = FACTIONS[f];
    moon.factions[f] = { siteId: sites[f], landedAt: d.landsAtDay * CYCLE_S, expedition: d.expedition, landed: false };
  }
}

/** The landed-at second plus the mid-morning offset: the second a base's own clock starts at (createInitialState's `+ 90`). */
export const landingSecond = (m: MoonFaction): number => m.landedAt + 90;

/** Rival factions that have not landed and whose landing second is at or before `now` (the Moon clock, whole seconds), in
 *  landing order. The player's faction is never a rival; a solo Moon (no player) has none. */
export function dueLandings(moon: MoonState, now: number): FactionId[] {
  if (moon.player === null) return [];
  return FACTION_ORDER.filter((f) => f !== moon.player && !moon.factions[f].landed && now >= landingSecond(moon.factions[f]));
}

// ─────────────────────────── the race (docs/20 §6, stream S6) ───────────────────────────
//
// `moon.race[f]` is each program's line (launches, swarm %, first light, era); `moon.race.phase` runs `pre` (nobody has lit) →
// `lit` (the first volley of ANY program) → `closed` (the combined volleys reached `closeAt`); a solo game stays `solo`. The
// player's own line is written by `economy.launchVolley` (through `raceLaunched`), a rival's by the rival runner's report each
// second; `raceStep` is the one place that turns those lines into the phase, the standings beats and the close. It runs inside the
// sim tick (Game.stepRivals once a Moon second, and on the player's own volley), reads nothing but the Moon, and draws nothing.

/** All programs' volleys. */
export const combinedLaunches = (moon: MoonState): number => FACTION_ORDER.reduce((n, f) => n + moon.race[f].launches, 0);

type RaceLines = Record<FactionId, { launches: number; firstLaunchAt: number | null }>;

/** The factions in standing order: more launches first, then the earlier first light, then landing order (the Foundry,
 *  the Vanguard, the Commons). The RACE panel's ranks, the lead and the close all read this one order. */
export function standingsOrder(lines: RaceLines): FactionId[] {
  return [...FACTION_ORDER].sort((a, b) =>
    lines[b].launches - lines[a].launches
    || (lines[a].firstLaunchAt ?? Infinity) - (lines[b].firstLaunchAt ?? Infinity)
    || FACTION_ORDER.indexOf(a) - FACTION_ORDER.indexOf(b));
}

/** How the race ended for the player. The winner is the largest share (ties to the earlier first light); the VERDICT is
 *  YOURS when that winner is the player and leads the second by more than `RACE.sharedMargin` of the combined volleys, THEIRS when
 *  a rival wins and the player is further than the margin behind it, and SHARED otherwise: an equal top share (a tie the first
 *  light decided), or a photo finish within the margin whoever it favours. */
export function verdictFor(lines: RaceLines, player: FactionId, margin = RACE.sharedMargin): Verdict {
  const order = standingsOrder(lines);
  const total = FACTION_ORDER.reduce((n, f) => n + lines[f].launches, 0);
  const mine = lines[player].launches;
  if (total <= 0) return 'shared';
  if (order[0] === player) {
    const second = lines[order[1]].launches;
    return (mine - second) / total <= margin + 1e-9 ? 'shared' : 'yours';
  }
  return (lines[order[0]].launches - mine) / total <= margin + 1e-9 ? 'shared' : 'theirs';
}

/** "Foundry 14 · Vanguard 10 · Commons 6" in standing order (a feed line's tail). */
const standingsLine = (lines: RaceLines, order: FactionId[]): string =>
  order.map((f) => `${FACTIONS[f].short} ${lines[f].launches}`).join(' · ');

function closeRace(moon: MoonState, order: FactionId[], total: number): void {
  const r = moon.race;
  const lines = Object.fromEntries(FACTION_ORDER.map((f) => [f, { launches: r[f].launches, firstLaunchAt: r[f].firstLaunchAt }])) as MoonRaceFinal;
  r.phase = 'closed';
  r.winner = order[0];
  r.closedAt = moon.clock;
  r.final = lines;
  if (moon.player !== null) r.verdict = verdictFor(lines, moon.player);
  const share = total > 0 ? Math.round((100 * lines[order[0]].launches) / total) : 0;
  pushFeed(moon, {
    faction: order[0], kind: 'verdict', n: total,
    text: `THE RACE CLOSES AT ${total} VOLLEYS — ${FACTION_NAME[order[0]].toUpperCase()} HOLDS THE LARGEST SHARE (${share} %) · ${standingsLine(lines, order)}`,
  });
}

/** One look at the race: the first volley of any program lights it (`pre` → `lit`); a standings beat goes on the feed at every
 *  `RACE.beatEvery` combined volleys and whenever the lead changes; at `closeAt` combined volleys the race closes (the largest
 *  share wins, `verdict` on the feed once). Idempotent (a second call with nothing new does nothing), deterministic, solo-proof. */
export function raceStep(moon: MoonState): void {
  const r = moon.race;
  if (moon.player === null || r.phase === 'solo' || r.phase === 'closed') return;
  const total = combinedLaunches(moon);
  if (r.phase === 'pre') {
    if (total <= 0) return;
    r.phase = 'lit';
  }
  const order = standingsOrder(moon.race);
  if (total >= r.closeAt) { closeRace(moon, order, total); return; }
  const leader = order[0];
  const changed = r.leader !== undefined && r.leader !== leader;
  r.leader = leader;
  const beat = Math.floor(total / RACE.beatEvery) * RACE.beatEvery;
  const due = beat > (r.beat ?? 0);
  if (due) r.beat = beat;
  if (!changed && !due) return;
  const top = moon.race[leader].launches;
  const next = moon.race[order[1]].launches;
  const name = FACTION_NAME[leader].toUpperCase();
  pushFeed(moon, {
    faction: leader, kind: 'standing', n: total,
    text: changed
      ? (top > next
        ? `${name} TAKES THE LEAD — ${top} volleys to ${FACTIONS[order[1]].short}'s ${next} · ${total} of ${r.closeAt} combined`
        : `${name} DRAWS LEVEL WITH ${FACTIONS[order[1]].short.toUpperCase()} AND LEADS ON THE EARLIER FIRST LIGHT — ${top} volleys each · ${total} of ${r.closeAt} combined`)
      : `THE RACE AT ${total} OF ${r.closeAt} VOLLEYS — ${name} ${top > next ? `LEADS BY ${top - next}` : 'LEADS ON THE EARLIER FIRST LIGHT'} · ${standingsLine(moon.race, order)}`,
  });
}

/** The player's own volley (economy.launchVolley, after `s.launches` moved): its line of the race, its first light on the feed, every
 *  fifth volley as the rival runner reports them, and a look at the race (the phase, a beat, the close). A rival's line is the
 *  runner's, written once a Moon second; a solo game and a Moon with no player do nothing. */
export function raceLaunched(moon: MoonState, s: Pick<GameState, 'faction' | 'launches' | 'swarmPct' | 'era' | 'simTime'>): void {
  const f = s.faction;
  if (!f || moon.player !== f) return;
  const e = moon.race[f];
  const first = e.firstLaunchAt === null;
  e.launches = s.launches;
  e.swarmPct = s.swarmPct;
  e.era = s.era;
  if (first) {
    e.firstLaunchAt = s.simTime;
    pushFeed(moon, { faction: f, kind: 'firstLight', era: s.era, n: s.launches, text: `${FACTION_NAME[f].toUpperCase()} — FIRST LIGHT: the first collector volley is away` });
  } else if (s.launches % 5 === 0) {
    pushFeed(moon, { faction: f, kind: 'launch', era: s.era, n: s.launches, text: `${FACTION_NAME[f].toUpperCase()} HAS LAUNCHED ${s.launches} VOLLEYS — swarm ${s.swarmPct.toFixed(4)}%` });
  }
  raceStep(moon);
}
