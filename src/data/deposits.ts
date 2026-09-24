/** Local site deposits (spec §5a): the kinds, the feed-grade vocabulary, and
 *  the per-site generation plan. Generation itself lives in the heightfield. */
import type { SiteId } from './sites';

export type DepositKind = 'ilmenite' | 'anorthosite' | 'glass' | 'kreep' | 'volatiles' | 'ice' | 'ridge';
/** generation order; a kind's index seeds its stream (seed ^ (0xde90 + index)) */
export const DEPOSIT_KINDS: DepositKind[] = ['ilmenite', 'anorthosite', 'glass', 'kreep', 'volatiles', 'ice', 'ridge'];

/** What an excavator can put into the smelter/refinery feed ('plain' = no deposit). */
export type FeedKind = 'ilmenite' | 'anorthosite' | 'glass' | 'kreep' | 'volatiles' | 'plain';
export const FEED_KINDS: FeedKind[] = ['ilmenite', 'anorthosite', 'glass', 'kreep', 'volatiles', 'plain'];
/** share of last tick's dug regolith per kind; sums to 1 once anything was dug */
export type FeedGrade = Record<FeedKind, number>;

export function emptyFeed(): FeedGrade {
  return { ilmenite: 0, anorthosite: 0, glass: 0, kreep: 0, volatiles: 0, plain: 0 };
}

/** what an excavator standing on this deposit digs (ice and ridges are location-only) */
export function feedKindOf(kind: DepositKind | undefined): FeedKind {
  return kind === undefined || kind === 'ice' || kind === 'ridge' ? 'plain' : kind;
}

/** short feed labels for the inspector line ('64% high-Ti · 8% highland') */
export const FEED_LABEL: Record<FeedKind, string> = {
  ilmenite: 'high-Ti', anorthosite: 'highland', glass: 'glass', kreep: 'KREEP', volatiles: 'mature soil', plain: 'plain',
};

export interface DepositPlanEntry {
  kind: DepositKind;
  count: number;
  /** placed first, inside its own distance band */
  guaranteed?: { count: number; minM: number; maxM: number };
  rMin: number; rMax: number;       // deposit radius, m
  dMin: number; dMax: number;       // distance from the map heart (the Lander pad), m
}

/** Distances are measured from the map heart, where the Lander stands. The
 *  pole's ice entry describes the legacy ice stream (seed ^ 0x1ce), which the
 *  heightfield keeps bit-for-bit: a starter patch of 10–13 m, then six more. */
export const DEPOSIT_PLAN: Record<SiteId, DepositPlanEntry[]> = {
  mare: [
    { kind: 'ilmenite', count: 4, guaranteed: { count: 1, minM: 30, maxM: 50 }, rMin: 16, rMax: 26, dMin: 30, dMax: 320 },
    { kind: 'anorthosite', count: 1, rMin: 22, rMax: 34, dMin: 250, dMax: 420 },
    { kind: 'volatiles', count: 3, rMin: 24, rMax: 36, dMin: 60, dMax: 350 },
  ],
  southpole: [
    { kind: 'ice', count: 7, guaranteed: { count: 1, minM: 43, maxM: 52 }, rMin: 18, rMax: 34, dMin: 120, dMax: 340 },
    { kind: 'anorthosite', count: 3, guaranteed: { count: 1, minM: 42, maxM: 57 }, rMin: 22, rMax: 34, dMin: 90, dMax: 340 },
    { kind: 'ridge', count: 2, rMin: 14, rMax: 20, dMin: 80, dMax: 250 },
  ],
  lavatube: [
    { kind: 'ilmenite', count: 2, guaranteed: { count: 1, minM: 30, maxM: 50 }, rMin: 16, rMax: 26, dMin: 30, dMax: 320 },
    { kind: 'glass', count: 2, guaranteed: { count: 1, minM: 30, maxM: 56 }, rMin: 16, rMax: 24, dMin: 30, dMax: 200 },
    { kind: 'kreep', count: 1, rMin: 18, rMax: 18, dMin: 60, dMax: 150 },
    { kind: 'volatiles', count: 1, rMin: 24, rMax: 36, dMin: 60, dMax: 350 },
  ],
};

export function siteHasDeposit(site: SiteId, kind: DepositKind): boolean {
  return DEPOSIT_PLAN[site].some((d) => d.kind === kind);
}

/** '?' leads show for unrevealed deposits this close to the Lander */
export const LEAD_RANGE_M = 400;
/** a lead sits this far (at most) off the deposit's true centre */
export const LEAD_JITTER_M = 10;

export interface DepositInfo {
  glyph: string;
  /** what the ground is, for the inspector, alerts and labels */
  name: string;
  /** overlay ring pattern — kinds are told apart by pattern, never by colour */
  pattern: 'dashed' | 'dotted' | 'double' | 'thin' | 'thinDotted' | 'solid';
  /** the placement ghost line on a revealed deposit */
  ghost: string;
  /** the '?' lead label: orbital data hints only ilmenite, anorthosite, KREEP and cold traps */
  lead: string;
}

export const DEPOSIT_INFO: Record<DepositKind, DepositInfo> = {
  ilmenite: {
    glyph: '◆', name: 'high-Ti basalt', pattern: 'dashed',
    ghost: 'On high-Ti basalt — smelter feed ↑', lead: '? possible high-Ti basalt',
  },
  anorthosite: {
    glyph: '◇', name: 'highland anorthosite', pattern: 'dotted',
    ghost: 'On highland anorthosite — refinery feed ↑ · smelter feed ↓', lead: '? possible highland anorthosite',
  },
  glass: {
    glyph: '○', name: 'pyroclastic glass', pattern: 'double',
    ghost: 'On pyroclastic glass — smelter O₂ ↑ · excavator wear ×1.3', lead: '? unknown',
  },
  kreep: {
    glyph: '☢', name: 'KREEP soil', pattern: 'thin',
    ghost: 'On KREEP — reactor fuel make-up at ≥15% feed · no habitats here', lead: '? possible KREEP',
  },
  volatiles: {
    glyph: '≈', name: 'mature soil', pattern: 'thinDotted',
    ghost: 'On mature soil — water ×2.5 with Solar-Wind Volatiles · regolith ×0.9', lead: '? unknown',
  },
  ice: {
    glyph: '❄', name: 'cold-trap ice', pattern: 'solid',
    ghost: 'On confirmed ice', lead: '? cold trap',
  },
  ridge: {
    glyph: '▲', name: 'peak of light', pattern: 'thin',
    ghost: 'On a peak of light — solar ×1.2, never shaded · build ×1.3', lead: '? unknown',
  },
};
