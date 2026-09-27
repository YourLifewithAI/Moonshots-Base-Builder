/** Extraction zones (docs/15 §5a): the deposit areas the player sees — the
 *  rings of the deposit overlay (high-Ti basalt, highland anorthosite,
 *  cold-trap ice, …), revealed ones only, peaks of light aside (a peak is a
 *  solar site, not ground to dig). The game keeps them in `s.zones` from the
 *  heightfield's deposits (Game.syncDeposits).
 *
 *  - Auto roads (door spurs, haul roads, the Builder's) never run inside a
 *    zone: they stop at a *gate*, a road cell on its rim (core/roads.ts).
 *  - Inside, units drive off-road, at ROAD.offroad of road speed, for work
 *    in that zone only: from a gate to a dig, a site, and back.
 *  - A cell is inside a zone when its centre is (the same test for roads,
 *    units and the sim).
 *  - A pit is a zone too (kind 'pit', core/pits.ts, docs/17 §11.4): its cut
 *    and a cell round it, listed cell by cell. Pit zones come after the
 *    deposits', so a cell in both stays the deposit's (and so do its gates).
 *
 *  Pure: the state in, cells out; memoised on the zone list. No roads import
 *  (core/roads.ts reads this). */
import { CELL_M, MAP_CELLS, MAP_M } from '../data/balance';
import type { DepositKind } from '../data/deposits';
import type { GameState, ZoneState } from './state';

type Cell = [number, number];
const key = (gx: number, gz: number) => gz * MAP_CELLS + gx;
const centre = (gx: number, gz: number): [number, number] => [(gx + 0.5) * CELL_M - MAP_M / 2, (gz + 0.5) * CELL_M - MAP_M / 2];
const cellOf = (x: number, z: number): Cell => [Math.floor((x + MAP_M / 2) / CELL_M), Math.floor((z + MAP_M / 2) / CELL_M)];

/** The deposit kinds that make an extraction zone (a peak of light does not). */
export const ZONE_KINDS: ReadonlySet<DepositKind> = new Set<DepositKind>(['ilmenite', 'anorthosite', 'glass', 'kreep', 'volatiles', 'ice']);

const memo = new WeakMap<ZoneState[], { n: number; cells: Map<number, number>; rims: Map<number, number>[] }>();

/** cell key → the index of the zone it lies in; and each zone's rim (the
 *  cells outside it sharing an edge with one inside, key → 1) */
function index(s: Pick<GameState, 'zones'>) {
  const list = s.zones ?? [];
  let m = memo.get(list);
  if (m && m.n === list.length) return m;
  const cells = new Map<number, number>();
  list.forEach((z, i) => {
    if (z.cells) {
      for (const k of z.cells) if (!cells.has(k)) cells.set(k, i);
      return;
    }
    const [g0x, g0z] = cellOf(z.cx - z.r, z.cz - z.r);
    const [g1x, g1z] = cellOf(z.cx + z.r, z.cz + z.r);
    for (let gz = g0z; gz <= g1z; gz++) {
      for (let gx = g0x; gx <= g1x; gx++) {
        const [x, zz] = centre(gx, gz);
        if (Math.hypot(x - z.cx, zz - z.cz) <= z.r && !cells.has(key(gx, gz))) cells.set(key(gx, gz), i);
      }
    }
  });
  const rims = list.map(() => new Map<number, number>());
  for (const [k, i] of cells) {
    const gx = k % MAP_CELLS, gz = Math.floor(k / MAP_CELLS);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nk = key(gx + dx, gz + dz);
      if (!cells.has(nk)) rims[i].set(nk, 1);
    }
  }
  m = { n: list.length, cells, rims };
  memo.set(list, m);
  return m;
}

/** Every cell inside a zone (cell key → zone index). */
export const zoneCells = (s: Pick<GameState, 'zones'>): ReadonlyMap<number, number> => index(s).cells;

/** The zone a cell lies in, or null. */
export function zoneOfCell(s: Pick<GameState, 'zones'>, gx: number, gz: number): ZoneState | null {
  const i = index(s).cells.get(key(gx, gz));
  return i === undefined ? null : s.zones![i];
}

/** The zone a world point's cell lies in, or null. */
export function zoneAt(s: Pick<GameState, 'zones'>, x: number, z: number): ZoneState | null {
  const [gx, gz] = cellOf(x, z);
  return zoneOfCell(s, gx, gz);
}

/** A zone's rim: the cells just outside it (cell keys). A road that stops
 *  at one of them is the zone's gate. */
export function rimOf(s: Pick<GameState, 'zones'>, zone: ZoneState): ReadonlyMap<number, number> {
  const i = (s.zones ?? []).indexOf(zone);
  return i < 0 ? new Map() : index(s).rims[i];
}

/** The zone list from the revealed deposits (Game.syncDeposits), in a
 *  stable order, the pits' zones kept after them (core/pits.ts owns those);
 *  the same array while nothing changed (the memo keys on it). */
export function zonesFrom(prev: ZoneState[] | undefined, revealed: readonly { id: string; kind: DepositKind; cx: number; cz: number; r: number }[]): ZoneState[] {
  const next: ZoneState[] = revealed.filter((d) => ZONE_KINDS.has(d.kind))
    .map(({ id, kind, cx, cz, r }) => ({ id, kind, cx, cz, r }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const pits = (prev ?? []).filter((z) => z.kind === 'pit');
  const deps = (prev ?? []).filter((z) => z.kind !== 'pit');
  if (prev && deps.length === next.length && deps.every((z, i) => z.id === next[i].id)) return prev;
  return [...next, ...pits];
}
