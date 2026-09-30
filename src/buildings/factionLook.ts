/** The player's faction, as the look sees it (docs/20 S7). Only the PLAYER's base is ever
 *  drawn (a rival lives headless), so the look has one faction at a time: `Game.bootWorld`
 *  sets it from the state before it builds a single mesh (a new game, a load), and every
 *  geometry and palette that depends on it keys its cache on it. A solo game has none: no
 *  hull layer, no emblem, no suit, and every mesh exactly as it always was. */
import { FACTIONS, isFactionId, type FactionId } from '../data/factions';

/** a faction's colours as 0xRRGGBB (data/factions.ts holds them as CSS hex) */
export interface LookLivery { hull: number; trim: number; suit: number }

let active: FactionId | undefined;

/** The faction the meshes are made for (undefined: a solo game). */
export function setLookFaction(f: FactionId | null | undefined): void {
  active = isFactionId(f) ? f : undefined;
}

export const lookFaction = (): FactionId | undefined => active;

/** `'#d9d4c8'` → 0xd9d4c8 */
export const hexOf = (css: string): number => parseInt(css.replace('#', ''), 16);

const cache = new Map<FactionId, LookLivery>();

/** A faction's livery as numbers (the active faction's by default; null in a solo game). */
export function lookLivery(f: FactionId | undefined = active): LookLivery | null {
  if (!f) return null;
  let l = cache.get(f);
  if (!l) {
    const c = FACTIONS[f].livery;
    l = { hull: hexOf(c.hull), trim: hexOf(c.trim), suit: hexOf(c.suit) };
    cache.set(f, l);
  }
  return l;
}

/** a cache key part for geometry and palettes: '' in a solo game */
export const lookKey = (): string => active ?? '';
