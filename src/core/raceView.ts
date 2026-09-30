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
import type { FeedEvent, FeedKind, MoonState, RacePhase } from './moon';
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
  const order = (a: RaceRow, b: RaceRow) =>
    b.launches - a.launches
    || (a.firstLightAt ?? Infinity) - (b.firstLightAt ?? Infinity)
    || FACTION_ORDER.indexOf(a.faction) - FACTION_ORDER.indexOf(b.faction);
  rows.sort(order);
  rows.forEach((r, k) => { r.rank = k + 1; });
  return {
    phase: moon.race.phase, closeAt: moon.race.closeAt, combined, player: me, moonDay: Math.floor(moon.clock / CYCLE_S),
    rows, leader: rows[0].faction, rank: rows.find((r) => r.player)!.rank,
    ...(moon.race.winner ? { winner: moon.race.winner } : {}),
  };
}
