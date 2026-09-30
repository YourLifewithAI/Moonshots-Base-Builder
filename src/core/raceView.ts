/** The race as the RACE chip and panel read it (docs/20 §2, §6): one row per faction, standings order, built once per
 *  publish from the Moon (`moon.factions`, `moon.race`, the feed) and the rival bases. A solo game has none (`null`). Pure
 *  (no DOM, no stores): `Game.publish` fills `$race` with it (ui/stores.ts), ui/racePanel.ts draws it.
 *
 *  Standings: more launches first, then the earlier first light, then landing order (the Foundry, the Vanguard, the
 *  Commons). Days are the MOON's days (day 0 is the first landing), the clock every faction shares: the timeline in the
 *  briefing counts the same way. */
import { CYCLE_S } from '../data/balance';
import { FACTIONS, FACTION_ORDER, type FactionId } from '../data/factions';
import { SITES, type SiteId } from '../data/sites';
import { standingsOrder, type FeedEvent, type FeedKind, type MoonState, type RacePhase, type Verdict } from './moon';
import type { RivalProgram } from './rival';
import { rivalInfos } from './rival';
import type { GameState } from './state';

export interface RaceRow {
  faction: FactionId;
  name: string;
  short: string;
  glyph: string;
  /** the faction's trim colour (CSS hex): the rule and the glyph */
  trim: string;
  /** the standing, 1..3 */
  rank: number;
  player: boolean;
  siteId: SiteId;
  /** the site's name in words */
  site: string;
  landed: boolean;
  /** the Moon day it lands (or landed) on */
  landDay: number;
  era: number;
  launches: number;
  /** this faction's launches over all launches (0 before the first volley) */
  share: number;
  swarmPct: number;
  /** the Moon day of its first volley, or null */
  firstLightDay: number | null;
  firstLightAt: number | null;
  outposts: number;
  /** finished buildings on its base */
  buildings: number;
  /** the last thing the feed says this faction did */
  last: { id: number; kind: FeedKind; text: string; at: number } | null;
}

/** One faction's line of the verdict's table: the standings as they stood when the race closed. */
export interface RaceVerdictRow {
  faction: FactionId;
  name: string;
  short: string;
  glyph: string;
  trim: string;
  player: boolean;
  rank: number;
  launches: number;
  share: number;
  /** the Moon day of its first volley, or null */
  firstLightDay: number | null;
}

/** How the race ended (S6): present once the phase is `closed`. */
export interface RaceVerdict {
  kind: Verdict;
  winner: FactionId;
  /** the combined volleys at the close */
  total: number;
  /** the Moon clock second of the close */
  closedAt: number;
  /** in standing order as of the close (the live rows keep moving after it) */
  rows: RaceVerdictRow[];
}

export interface RaceView {
  phase: RacePhase;
  closeAt: number;
  /** all factions' launches */
  combined: number;
  player: FactionId;
  /** the Moon day it is */
  moonDay: number;
  /** in standings order: the leader first */
  rows: RaceRow[];
  leader: FactionId;
  /** the player's standing, 1..3 */
  rank: number;
  winner?: FactionId;
  /** the verdict, once the race has closed (S6) */
  verdict?: RaceVerdict;
}

const ORDINAL = ['', '1st', '2nd', '3rd'];
export const ordinal = (n: number) => ORDINAL[n] ?? `${n}th`;

/** a site's name in words: SHACKLETON RIM → Shackleton Rim */
export const siteWords = (id: SiteId): string => SITES[id].name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

const builtCount = (s: GameState) => s.buildings.filter((b) => (b.construction ?? 0) <= 0).length;

/** The race, or null in a solo game (no faction, no rivals). */
export function raceView(moon: MoonState, player: GameState | null, rivals: readonly RivalProgram[]): RaceView | null {
  const me = moon.player;
  if (me === null) return null;
  const info = new Map(rivalInfos(moon, rivals).map((i) => [i.faction, i]));
  const lastOf = (f: FactionId): RaceRow['last'] => {
    const feed = moon.feed ?? [];
    for (let i = feed.length - 1; i >= 0; i--) {
      const e: FeedEvent = feed[i];
      if (e.faction === f) return { id: e.id, kind: e.kind, text: e.text, at: e.at };
    }
    return null;
  };
  const combined = FACTION_ORDER.reduce((n, f) => n + moon.race[f].launches, 0);
  const rows: RaceRow[] = FACTION_ORDER.map((f) => {
    const d = FACTIONS[f];
    const m = moon.factions[f];
    const r = moon.race[f];
    const i = info.get(f);
    const base = f === me ? player : rivals.find((x) => x.faction === f)?.state ?? null;
    return {
      faction: f, name: d.name, short: d.short, glyph: d.glyph, trim: d.livery.trim, rank: 0, player: f === me,
      siteId: m.siteId, site: siteWords(m.siteId), landed: m.landed, landDay: Math.round(m.landedAt / CYCLE_S),
      era: i?.era ?? r.era, launches: r.launches, share: combined > 0 ? r.launches / combined : 0, swarmPct: r.swarmPct,
      firstLightAt: r.firstLaunchAt, firstLightDay: r.firstLaunchAt === null ? null : Math.floor(r.firstLaunchAt / CYCLE_S),
      outposts: f === me ? player?.survey.outposts.length ?? 0 : i?.outposts.length ?? 0,
      buildings: base ? builtCount(base) : 0,
      last: lastOf(f),
    };
  });
  // the standing order is the Moon's own (core/moon.ts standingsOrder: launches, then the earlier first light, then landing order)
  const ranked = standingsOrder(moon.race);
  rows.sort((a, b) => ranked.indexOf(a.faction) - ranked.indexOf(b.faction));
  rows.forEach((r, k) => { r.rank = k + 1; });
  return {
    phase: moon.race.phase, closeAt: moon.race.closeAt, combined, player: me, moonDay: Math.floor(moon.clock / CYCLE_S),
    rows, leader: rows[0].faction, rank: rows.find((r) => r.player)!.rank,
    ...(moon.race.winner ? { winner: moon.race.winner } : {}),
    ...(moon.race.final && moon.race.verdict && moon.race.winner ? { verdict: verdictView(moon, moon.race.final, moon.race.verdict, moon.race.winner, me) } : {}),
  };
}

export function verdictView(moon: MoonState, final: NonNullable<MoonState['race']['final']>, kind: Verdict, winner: FactionId, me: FactionId): RaceVerdict {
  const total = FACTION_ORDER.reduce((n, f) => n + final[f].launches, 0);
  const order = standingsOrder(final);
  return {
    kind, winner, total, closedAt: moon.race.closedAt ?? moon.clock,
    rows: order.map((f, k) => {
      const d = FACTIONS[f];
      const at = final[f].firstLaunchAt;
      return {
        faction: f, name: d.name, short: d.short, glyph: d.glyph, trim: d.livery.trim, player: f === me, rank: k + 1,
        launches: final[f].launches, share: total > 0 ? final[f].launches / total : 0,
        firstLightDay: at === null ? null : Math.floor(at / CYCLE_S),
      };
    }),
  };
}

// ─────────────────────────── first light and the verdict's words (S6) ───────────────────────────

/** The verdict screen's headline and the log's line for each way the race can end. */
export const VERDICT_TITLE: Record<Verdict, string> = { yours: 'THE SWARM IS YOURS', shared: 'A SHARED SWARM', theirs: 'THE SWARM IS THEIRS' };

const NUMBER_WORD = ['none', 'one', 'two', 'three'];
const ORDINAL_WORD = ['', 'first', 'second', 'third'];
export const ordinalWord = (n: number): string => ORDINAL_WORD[n] ?? `${n}th`;
export const numberWord = (n: number): string => NUMBER_WORD[n] ?? String(n);

/** Where the player's own first volley stands among the programs' first lights (the FIRST LIGHT screen's "second of three"):
 *  its rank among those that have lit (earlier first light first, a tie to the earlier landing) and the rows that lit before
 *  it, in the order they did. Null when the player has not lit (or in a solo game). */
export function firstLightStanding(v: RaceView | null): { rank: number; of: number; before: RaceRow[] } | null {
  if (!v) return null;
  const lit = v.rows.filter((r) => r.firstLightAt !== null)
    .sort((a, b) => a.firstLightAt! - b.firstLightAt! || FACTION_ORDER.indexOf(a.faction) - FACTION_ORDER.indexOf(b.faction));
  const at = lit.findIndex((r) => r.player);
  if (at < 0) return null;
  return { rank: at + 1, of: v.rows.length, before: lit.slice(0, at) };
}

/** One plain sentence of how the race ended, for the log and the verdict screen: who held what. */
export function verdictLine(v: RaceVerdict): string {
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  const me = v.rows.find((r) => r.player)!;
  const top = v.rows[0];
  const second = v.rows[1];
  switch (v.kind) {
    case 'yours': return `${me.launches} of ${v.total} volleys (${pct(me.share)}): the largest share, ${me.launches - second.launches} ahead of the ${second.short}.`;
    case 'shared': return top.player
      ? `you hold ${pct(me.share)} and the ${second.short} ${pct(second.share)}: too close to give it to one program.`
      : `the ${top.short} holds ${pct(top.share)} to your ${pct(me.share)}: too close to give it to one program.`;
    default: return `${top.name} holds ${pct(top.share)} of the volleys; you hold ${pct(me.share)}.`;
  }
}
