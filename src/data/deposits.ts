/** Local site deposits (spec §5a): the kinds, the feed-grade vocabulary, and
 *  the per-site generation plan. Generation itself lives in the heightfield. */
import type { SiteId } from './sites';

export type DepositKind = 'ilmenite' | 'anorthosite' | 'glass' | 'kreep' | 'volatiles' | 'ice' | 'ridge';

/** What an excavator can put into the smelter/refinery feed ('plain' = no deposit). */
export type FeedKind = 'ilmenite' | 'anorthosite' | 'glass' | 'kreep' | 'volatiles' | 'plain';
export const FEED_KINDS: FeedKind[] = ['ilmenite', 'anorthosite', 'glass', 'kreep', 'volatiles', 'plain'];
/** share of last tick's dug regolith per kind; sums to 1 once anything was dug */
export type FeedGrade = Record<FeedKind, number>;

export function emptyFeed(): FeedGrade {
  return { ilmenite: 0, anorthosite: 0, glass: 0, kreep: 0, volatiles: 0, plain: 0 };
}

export interface DepositPlanEntry {
  kind: DepositKind;
  count: number;
  /** placed first, inside its own distance band */
  guaranteed?: { count: number; minM: number; maxM: number };
  rMin: number; rMax: number;       // deposit radius, m
  dMin: number; dMax: number;       // distance from the lander, m
}

export const DEPOSIT_PLAN: Record<SiteId, DepositPlanEntry[]> = {
  mare: [
    { kind: 'ilmenite', count: 4, guaranteed: { count: 1, minM: 30, maxM: 50 }, rMin: 16, rMax: 26, dMin: 30, dMax: 320 },
    { kind: 'anorthosite', count: 1, rMin: 22, rMax: 34, dMin: 250, dMax: 420 },
    { kind: 'volatiles', count: 3, rMin: 24, rMax: 36, dMin: 60, dMax: 350 },
  ],
  southpole: [
    { kind: 'ice', count: 7, guaranteed: { count: 1, minM: 35, maxM: 55 }, rMin: 18, rMax: 34, dMin: 35, dMax: 340 },
    { kind: 'anorthosite', count: 3, guaranteed: { count: 1, minM: 40, maxM: 60 }, rMin: 22, rMax: 34, dMin: 40, dMax: 340 },
    { kind: 'ridge', count: 2, rMin: 14, rMax: 20, dMin: 80, dMax: 250 },
  ],
  lavatube: [
    { kind: 'ilmenite', count: 2, guaranteed: { count: 1, minM: 30, maxM: 50 }, rMin: 16, rMax: 26, dMin: 30, dMax: 320 },
    { kind: 'glass', count: 2, guaranteed: { count: 1, minM: 25, maxM: 60 }, rMin: 16, rMax: 24, dMin: 25, dMax: 200 },
    { kind: 'kreep', count: 1, rMin: 18, rMax: 18, dMin: 60, dMax: 150 },
    { kind: 'volatiles', count: 1, rMin: 24, rMax: 36, dMin: 60, dMax: 350 },
  ],
};

export function siteHasDeposit(site: SiteId, kind: DepositKind): boolean {
  return DEPOSIT_PLAN[site].some((d) => d.kind === kind);
}
