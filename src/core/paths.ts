/** Ground paths shared by the sim (excavator hauls) and the visuals (rovers,
 *  haulers): straight legs that hop round the corner of any footprint in the
 *  way. Pure: world metres in, waypoints out — no Three.js. */
import { CELL_M, MAP_M } from '../data/balance';
import type { BuildingState } from './state';
import { footprintRect } from '../buildings/instances';

export interface Rect { id: number; x0: number; z0: number; x1: number; z1: number }

/** map half-extent a path may use (a margin inside the edge) */
export const PATH_HALF = MAP_M / 2 - 8;
/** m kept off walls when planning a rover's legs */
export const ROVER_CLEAR = 1.2;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** A structure's footprint in world metres. */
export function worldRect(b: Pick<BuildingState, 'id' | 'type' | 'gx' | 'gz' | 'rot'>): Rect {
  const r = footprintRect(b);
  return {
    id: b.id,
    x0: r.gx0 * CELL_M - MAP_M / 2, x1: r.gx1 * CELL_M - MAP_M / 2,
    z0: r.gz0 * CELL_M - MAP_M / 2, z1: r.gz1 * CELL_M - MAP_M / 2,
  };
}

/** Entry parameter of segment p→q into rect r (grown by m), or null. */
export function segmentHits(px: number, pz: number, qx: number, qz: number, r: Rect, m: number): number | null {
  let t0 = 0, t1 = 1;
  const dx = qx - px, dz = qz - pz;
  for (const [p, d, lo, hi] of [[px, dx, r.x0 - m, r.x1 + m], [pz, dz, r.z0 - m, r.z1 + m]]) {
    if (Math.abs(d) < 1e-9) {
      if (p <= lo || p >= hi) return null;
      continue;
    }
    let a = (lo - p) / d, b = (hi - p) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 >= t1) return null;
  }
  return t0;
}

export const inside = (x: number, z: number, r: Rect, m: number) =>
  x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;

/** Straight legs from a to b, hopping round the corner of each footprint in
 *  the way (greedy, a few hops at most). Footprints holding either end are
 *  driven through (a rover leaving its dock, a digger on its own pad). */
export function plan(
  ax: number, az: number, bx: number, bz: number, rects: readonly Rect[], clear = ROVER_CLEAR,
): [number, number][] {
  const out: [number, number][] = [];
  let cx = ax, cz = az;
  const skip = new Set(rects.filter((r) => inside(ax, az, r, clear) || inside(bx, bz, r, clear)).map((r) => r.id));
  for (let hop = 0; hop < 6; hop++) {
    let hit: Rect | null = null, best = Infinity;
    for (const r of rects) {
      if (skip.has(r.id)) continue;
      const t = segmentHits(cx, cz, bx, bz, r, clear * 0.9);
      if (t !== null && t < best) { best = t; hit = r; }
    }
    if (!hit) break;
    const m = clear + 0.3;
    let pick: [number, number] | null = null, cost = Infinity;
    for (const [x, z] of [[hit.x0 - m, hit.z0 - m], [hit.x1 + m, hit.z0 - m], [hit.x1 + m, hit.z1 + m], [hit.x0 - m, hit.z1 + m]]) {
      if (segmentHits(cx, cz, x, z, hit, clear * 0.9) !== null) continue;
      const c = Math.hypot(x - cx, z - cz) + Math.hypot(bx - x, bz - z);
      if (c < cost) { cost = c; pick = [clamp(x, -PATH_HALF, PATH_HALF), clamp(z, -PATH_HALF, PATH_HALF)]; }
    }
    if (!pick) break;
    out.push(pick);
    [cx, cz] = pick;
  }
  out.push([bx, bz]);
  return out;
}

/** Length of a path driven from (x, z). */
export function pathLength(x: number, z: number, path: readonly [number, number][]): number {
  let d = 0;
  for (const [px, pz] of path) { d += Math.hypot(px - x, pz - z); x = px; z = pz; }
  return d;
}

/** The point `out` metres off rect r nearest (x, z), kept off its corners: a
 *  work or unload spot beside a wall, and the wall it faces (0 −x, 1 +x, 2 −z, 3 +z). */
export function wallSpot(r: Rect, x: number, z: number, out: number, corner = 0.8): { x: number; z: number; edge: 0 | 1 | 2 | 3 } {
  const x0 = r.x0 - out, x1 = r.x1 + out, z0 = r.z0 - out, z1 = r.z1 + out;
  let px = clamp(x, x0, x1), pz = clamp(z, z0, z1);
  const edges = [px - x0, x1 - px, pz - z0, z1 - pz];
  const e = edges.indexOf(Math.min(...edges)) as 0 | 1 | 2 | 3;
  if (e === 0) px = x0; else if (e === 1) px = x1; else if (e === 2) pz = z0; else pz = z1;
  if (e < 2) pz = clamp(pz, r.z0 + corner, r.z1 - corner); else px = clamp(px, r.x0 + corner, r.x1 - corner);
  return { x: px, z: pz, edge: e };
}
