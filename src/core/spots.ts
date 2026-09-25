/** Where every construction rover stands (world/rovers.ts drives them
 *  there): a parking spot beside its dock, or a work spot at its site's
 *  walls. Pure: the state in, spots out — no Three.js, no randomness, a
 *  stable order (sites and docks in building order, rovers in roster order).
 *
 *  No two spots share ground, and none sits
 *   - within ROVER_CLEAR of any footprint (a pad included);
 *   - on an excavator's ground: its dig away from the pad, the stand where it
 *     unloads, or the lane between them (the route it drives, both ways);
 *   - beyond the map's path margin.
 *  Parking keeps off the lanes as the sim would plan them (not the leg
 *  driven this minute), so rows do not reshuffle as a digger turns round; a
 *  working rover keeps its spot while it stays clear (`prev`), so a crew
 *  that grows spreads round the ones already there. */
import { BUILDINGS } from '../data/buildings';
import { CELL_M, HAUL } from '../data/balance';
import type { BuildingState, GameState } from './state';
import { centerOf } from '../buildings/instances';
import { PATH_HALF, ROVER_CLEAR, UNIT, inside, plan, ring, wallSpot, worldRect, type Rect } from './paths';
import { digsHome, keepOut, standFor } from './haul';

/** m out from a site's footprint to a working rover's centre */
export const WORK_OUT = 1.8;
/** m out from the dock's footprint to a parked rover's centre */
export const PARK_OUT = 3.2;
/** m between parked rovers (two bodies and a hand's width) */
export const PARK_PITCH = 3;
/** m between working rovers: two bodies and the print shuffle (±0.35 m) */
export const WORK_PITCH = 2 * UNIT.rover.r + 0.8;

export interface RoverSpot {
  x: number; z: number;
  /** yaw to settle to (rovers' convention: forward = (sin, cos)) */
  face: number;
  /** along-wall direction of the print shuffle */
  side: [number, number];
  /** the site it works, or null (parked at `dock`) */
  site: number | null;
  dock: number;
}

/** A keep-away zone: a disc, or a lane (a polyline and its half-width). */
export interface Zone { pts: [number, number][]; r: number }

const isSite = (b: { construction?: number }) => (b.construction ?? 0) > 0;
const PI = Math.PI;

/** Building-local (x, z) → world, for a structure's centre and rotation. */
function toWorld(b: BuildingState, lx: number, lz: number): [number, number] {
  const [cx, cz] = centerOf(b);
  const a = -b.rot * PI / 2, c = Math.cos(a), s = Math.sin(a);
  return [cx + lx * c + lz * s, cz - lx * s + lz * c];
}

/** Distance from (x, z) to a polyline (a single point is a disc). */
export function polyDist(x: number, z: number, pts: readonly [number, number][]): number {
  if (pts.length === 1) return Math.hypot(x - pts[0][0], z - pts[0][1]);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

/** Where a load dug at (x, z) would go, as the visuals can tell without the
 *  mods: the nearest complete, enabled structure whose recipe eats regolith,
 *  else the Lander (core/haul.ts dropFor decides for the sim). */
function likelyDrop(s: GameState, x: number, z: number): BuildingState | null {
  const eats = s.buildings.filter((b) => b.enabled && !isSite(b) && (BUILDINGS[b.type].inputs.regolith ?? 0) > 0);
  const pool = eats.length ? eats : s.buildings.filter((b) => b.type === 'lander');
  let best: BuildingState | null = null, bd = Infinity;
  for (const b of pool) {
    const p = wallSpot(worldRect(b), x, z, HAUL.unloadOut);
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

/** The ground the excavators need: each one's dig away from its pad, its
 *  stand and lane to the consumer it feeds (planned as the sim plans it) —
 *  `firm` — and, in `all`, the leg it drives now and the stand it holds. */
export function diggerZones(s: GameState, rects: readonly Rect[]): { firm: Zone[]; all: Zone[] } {
  const firm: Zone[] = [], all: Zone[] = [];
  const wide = UNIT.digger.r + UNIT.digger.off + UNIT.rover.r + 0.2;
  for (const b of s.buildings) {
    if (b.type !== 'excavator' || isSite(b)) continue;
    const h = b.haul;
    const [px, pz] = centerOf(b);
    const dx = h?.digX ?? px, dz = h?.digZ ?? pz;
    if (h && !digsHome(b)) firm.push({ pts: [[dx, dz]], r: wide });
    const drop = likelyDrop(s, dx, dz);
    if (drop) {
      // the stand the sim would choose (off the others' pads and digs)
      const st = standFor(s, b, drop, dx, dz);
      firm.push({ pts: [[st.x, st.z]], r: wide });
      const walls = rects.filter((r) => r.id !== b.id);
      for (const o of s.buildings) {
        if (o.id !== b.id && o.type === 'excavator' && o.haul && !isSite(o) && !digsHome(o)) walls.push(keepOut(o.id, o.haul.digX, o.haul.digZ));
      }
      const lane = plan(dx, dz, st.x, st.z, walls, HAUL.clear);
      firm.push({ pts: [[dx, dz], ...lane], r: wide });
    }
    if (h?.route && h.route.length) all.push({ pts: h.route, r: wide });
    if (h && (h.phase === 'unload' || h.phase === 'toDrop')) {
      const end = h.phase === 'unload' ? [h.x, h.z] as [number, number] : h.path[h.path.length - 1];
      if (end) all.push({ pts: [[end[0], end[1]]], r: wide });
    }
  }
  return { firm, all: [...firm, ...all] };
}

/** Every rover's spot, by roster id (the one lent to a survey has none). */
export function roverSpots(
  s: GameState, rects: readonly Rect[], prev?: ReadonlyMap<number, RoverSpot>,
): Map<number, RoverSpot> {
  const away = s.survey?.active?.rover;
  const roster = (s.rovers ?? []).filter((u) => u.id !== away);
  const at = new Map(s.buildings.map((b) => [b.id, b]));
  const lander = s.buildings.find((b) => b.type === 'lander');
  const zones = diggerZones(s, rects);
  const out = new Map<number, RoverSpot>();
  const taken: { x: number; z: number; gap: number }[] = [];

  const clearOf = (x: number, z: number, gap: number, zs: readonly Zone[]) =>
    Math.abs(x) < PATH_HALF && Math.abs(z) < PATH_HALF &&
    !rects.some((r) => inside(x, z, r, ROVER_CLEAR)) &&
    !taken.some((t) => Math.hypot(t.x - x, t.z - z) < Math.max(gap, t.gap)) &&
    !zs.some((q) => polyDist(x, z, q.pts) < q.r);
  const take = (id: number, spot: RoverSpot, gap: number) => {
    out.set(id, spot);
    taken.push({ x: spot.x, z: spot.z, gap });
  };

  // who works where, who parks where
  const crew = new Map<number, number[]>();
  const parked = new Map<number, number[]>();
  const dockOf = new Map<number, BuildingState>();
  for (const u of roster) {
    const dock = at.get(u.home) ?? lander;
    if (!dock) continue;
    dockOf.set(u.id, dock);
    const site = u.site !== null ? at.get(u.site) : undefined;
    if (site && isSite(site)) (crew.get(site.id) ?? crew.set(site.id, []).get(site.id)!).push(u.id);
    else (parked.get(dock.id) ?? parked.set(dock.id, []).get(dock.id)!).push(u.id);
  }

  // a working rover keeps the spot it has while it still works that site and
  // the ground stays clear (a crew that grows spreads round the ones there)
  for (const u of roster) {
    const p = prev?.get(u.id), dock = dockOf.get(u.id);
    if (!p || !dock || p.site === null || u.site !== p.site) continue;
    const site = at.get(p.site);
    if (!site || !isSite(site)) continue;
    if (clearOf(p.x, p.z, WORK_PITCH, zones.firm)) take(u.id, { ...p, dock: dock.id }, WORK_PITCH);
  }

  // work spots: the first off the wall nearest the crew's dock, the rest
  // spread evenly round the walls; each the nearest clear ring point
  for (const b of s.buildings) {
    const team = crew.get(b.id);
    if (!team) continue;
    const first = dockOf.get(team[0]);
    const rect = worldRect(b);
    const rg = ring(rect, WORK_OUT, 0.4);
    const [fx, fz] = first ? centerOf(first) : centerOf(b);
    const u0 = rg.uOf(fx, fz);
    const [cx, cz] = centerOf(b);
    team.forEach((id, k) => {
      if (out.has(id)) return;
      const want = u0 + (k * rg.len) / team.length;
      const pick = (zs: readonly Zone[]) => {
        for (let step = 0; step <= rg.len; step += 0.5) {
          for (const u of step ? [want + step, want - step] : [want]) {
            const p = rg.at(u);
            if (clearOf(p.x, p.z, WORK_PITCH, zs)) return p;
          }
        }
        return null;
      };
      // off the excavators' ground if the walls allow, else off the footprints at least
      const p = pick(zones.all) ?? pick([]) ?? rg.at(want);
      take(id, {
        x: p.x, z: p.z, site: b.id, dock: dockOf.get(id)!.id,
        face: p.edge < 2 ? Math.atan2(cx - p.x, 0) : Math.atan2(0, cz - p.z),
        side: p.edge < 2 ? [0, 1] : [1, 0],
      }, WORK_PITCH);
    });
  }

  // parking: a row beside the dock, on the first side (local −x, +x, −z, +z)
  // with room for the whole row off everything above; else spot by spot
  for (const dock of s.buildings) {
    const list = parked.get(dock.id)?.filter((id) => !out.has(id));
    if (!list?.length) continue;
    const [w, d] = BUILDINGS[dock.type].footprint;
    const hw = (w * CELL_M) / 2, hd = (d * CELL_M) / 2;
    const n = list.length;
    const face = -dock.rot * PI / 2;
    const offs: number[] = [];
    for (let k = 0; k < n; k++) offs.push((k - (n - 1) / 2) * PARK_PITCH);
    for (let j = 1; j <= 6; j++) offs.push(((n - 1) / 2 + j) * PARK_PITCH, -((n - 1) / 2 + j) * PARK_PITCH);
    const sides = (off: number): [number, number][] =>
      [[-(hw + PARK_OUT), off], [hw + PARK_OUT, off], [off, -(hd + PARK_OUT)], [off, hd + PARK_OUT]];
    const spot = (sd: number, off: number) => toWorld(dock, ...sides(off)[sd]);
    const park = (id: number, x: number, z: number) =>
      take(id, { x, z, face, side: [1, 0], site: null, dock: dock.id }, PARK_PITCH);
    let placed = false;
    // first a side whose centred row is all clear, then one with room further along it
    for (let pass = 0; pass < 2 * 4 && !placed; pass++) {
      const sd = pass % 4, wide = pass >= 4;
      const free: [number, number][] = [];
      const hold = taken.length;
      for (const off of wide ? offs : offs.slice(0, n)) {
        const [x, z] = spot(sd, off);
        if (free.length < n && clearOf(x, z, PARK_PITCH, zones.firm)) {
          free.push([x, z]);
          taken.push({ x, z, gap: PARK_PITCH });
        }
      }
      taken.length = hold;
      if (free.length < n) continue;
      // assign along the row, so rovers keep their order (the local axis the row runs on)
      const [ox, oz] = centerOf(dock);
      const a = -dock.rot * PI / 2, c = Math.cos(a), sn = Math.sin(a);
      const along = (p: [number, number]) => {
        const dx = p[0] - ox, dz = p[1] - oz;
        return sd < 2 ? dx * sn + dz * c : dx * c - dz * sn;
      };
      free.sort((p, q) => along(p) - along(q));
      list.forEach((id, k) => park(id, free[k][0], free[k][1]));
      placed = true;
    }
    if (placed) continue;
    // no side holds the whole row: spot by spot, any side, off the lanes if possible
    for (const id of list) {
      let got: [number, number] | null = null;
      for (const zs of [zones.firm, [] as Zone[]]) {
        for (const off of offs) {
          for (let sd = 0; sd < 4 && !got; sd++) {
            const [x, z] = spot(sd, off);
            if (clearOf(x, z, PARK_PITCH, zs)) got = [x, z];
          }
          if (got) break;
        }
        if (got) break;
      }
      // a dock boxed in on every side: further out, on rings
      for (let out2 = PARK_OUT + PARK_PITCH; !got && out2 < PARK_OUT + 8 * PARK_PITCH; out2 += PARK_PITCH) {
        const rg = ring(worldRect(dock), out2, 0);
        for (let u = 0; u < rg.len && !got; u += 1) {
          const p = rg.at(u);
          if (clearOf(p.x, p.z, PARK_PITCH, [])) got = [p.x, p.z];
        }
      }
      const [x, z] = got ?? spot(0, 0);
      park(id, x, z);
    }
  }
  return out;
}
