/** Rovers in transit (docs/15 §6): every unit of the fleet has a place in
 *  the sim — its slot at its dock, at a site or behind a road's frontier
 *  (core/spots.ts groundSpots), or a point on the way between them — and it
 *  works only where it has got to. A Drone Hive's units fly straight.
 *
 *  - A new goal (a site, the frontier's next cell, the dock, a survey) is a
 *    new trip from where the unit is now: the road route (roadRoute, one BFS
 *    cached on the network) or, for a drone, the straight line.
 *  - A trip of L m takes L / v + v / a s rest to rest (2·√(L/a) when too
 *    short to reach v): a rover at ROVER.speed × the roadway tiers (× the
 *    beacons at night), a drone at DRONE.speed. A speed change on the way
 *    waits for the next trip.
 *  - Each tick advances the clock and counts who has arrived (economy step
 *    0); the tick's end plans the trips its work and assignments asked for
 *    (transitPlan), so a trip starts at the second it is planned and the
 *    visuals see it from its first metre. No search per tick.
 *
 *  Pure and deterministic: the state in, the state out, roster order. */
import { BUILDINGS } from '../data/buildings';
import { CELL_M } from '../data/balance';
import { HIVE_PADS, ROVER } from '../data/roads';
import type { BuildingState, GameState, RoverTrip, RoverUnit } from './state';
import type { Mods } from './mods';
import { DRONE, isDrone, roverDown, whereIs } from './fleet';
import { groundSpots, type RoverSpot } from './spots';
import {
  cellAt, cellCentre, cellKey, doorCell, frontierOf, groundWay, hasRoads, keyCell, offAreaAt, offGround, roadDistances, spurLeft,
} from './roads';
import { centerOf } from '../buildings/instances';
import { roverStep } from './traffic';
import { GRADE_HOP_ACCEL, GRADE_REACH_M, gradeArea, onGradeGround, standOf } from './grading';
import { STRAIGHT_DETOUR, instantOf, straightOf } from './simMode';

type Pt = [number, number];
type Kind = RoverTrip['kind'];

/** Tests where timing is not the point: every trip ends as it starts, and
 *  a new goal is reached in the tick that sets it (economy step 0). The switch
 *  lives in core/simMode.ts (`instantOf(s)` is the per-base answer). */
export { TRANSIT } from './simMode';

// ───────────────────────────── the move ─────────────────────────────

/** Seconds a rest-to-rest move of `len` m takes at cruise `v`, accel `a`. */
export function travelTime(len: number, v: number, a: number): number {
  if (len <= 1e-9) return 0;
  if (a <= 0) return len / v;
  return len >= (v * v) / a ? len / v + v / a : 2 * Math.sqrt(len / a);
}

/** Metres covered `t` s into that move. */
export function travelled(t: number, len: number, v: number, a: number): number {
  const dur = travelTime(len, v, a);
  if (t >= dur) return len;
  if (t <= 0) return 0;
  if (a <= 0) return v * t;
  const peak = len >= (v * v) / a ? v : Math.sqrt(a * len);
  const ta = peak / a;
  if (t < ta) return 0.5 * a * t * t;
  if (t <= dur - ta) return 0.5 * a * ta * ta + peak * (t - ta);
  const r = dur - t;
  return len - 0.5 * a * r * r;
}

export function pathLen(pts: readonly Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

/** The point `u` time-equivalent metres along a polyline whose segments
 *  weigh `w` each (an off-road metre counts 1 / ROAD.offroad; no `w`: all 1). */
export function pointOnW(pts: readonly Pt[], w: readonly number[] | undefined, u: number): Pt {
  if (!w) return pointOn(pts, u);
  return pointOn(pts, actualAt(pts, w, u));
}

/** Real metres along the polyline at `u` time-equivalent metres. */
export function actualAt(pts: readonly Pt[], w: readonly number[] | undefined, u: number): number {
  if (!w) return u;
  let left = Math.max(0, u), m = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const e = l * (w[i - 1] ?? 1);
    if (left <= e) return m + (e > 1e-9 ? (left / e) * l : l);
    left -= e;
    m += l;
  }
  return m;
}

/** Time-equivalent length: each segment's metres × its weight. */
export function weighedLen(pts: readonly Pt[], w: readonly number[] | undefined): number {
  if (!w) return pathLen(pts);
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) * (w[i - 1] ?? 1);
  return l;
}

/** The point `u` m along a polyline (clamped to its ends). */
export function pointOn(pts: readonly Pt[], u: number): Pt {
  if (!pts.length) return [0, 0];
  let left = Math.max(0, u);
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const l = Math.hypot(bx - ax, bz - az);
    if (left <= l) {
      const k = l > 1e-9 ? left / l : 1;
      return [ax + (bx - ax) * k, az + (bz - az) * k];
    }
    left -= l;
  }
  const e = pts[pts.length - 1];
  return [e[0], e[1]];
}

/** A ground rover's cruise on the roads: the roadway tiers, and the beacons' night bonus. */
export function roverSpeed(mods: Pick<Mods, 'roadSpeedMult' | 'roadNightMult'>, night: boolean): number {
  return ROVER.speed * mods.roadSpeedMult * (night ? mods.roadNightMult : 1);
}

/** Has it got there? */
export const arrived = (t: RoverTrip | null | undefined): boolean => !!t && !t.stuck && t.t >= t.dur - 1e-9;
/** Seconds of the trip left (0: there; Infinity: no road there, or none). */
export const tripLeft = (t: RoverTrip | null | undefined): number =>
  !t || t.stuck ? Infinity : Math.max(0, t.dur - t.t);
/** The trip's clock `ahead` s from now: a unit on its pack's last charge, or
 *  on its RPU alone, drives on a share of it (core/unitPower.ts). */
const clockAt = (t: RoverTrip, ahead: number) => Math.min(t.dur, t.t + ahead * (t.rate ?? 1));

/** Where the trip has it `ahead` s from now (the visuals' tick fraction). */
export function tripPoint(t: RoverTrip, ahead = 0): Pt {
  return pointOnW(t.pts, t.w, travelled(clockAt(t, ahead), t.len, t.v, t.a));
}

/** The trip's real speed now (m/s): its cruise, slowed on an off-road segment. */
export function tripSpeed(t: RoverTrip, ahead = 0): number {
  const k = t.rate ?? 1;
  if (!t.w) return t.v * k;
  const u = actualAt(t.pts, t.w, travelled(clockAt(t, ahead), t.len, t.v, t.a));
  let m = 0;
  for (let i = 1; i < t.pts.length; i++) {
    m += Math.hypot(t.pts[i][0] - t.pts[i - 1][0], t.pts[i][1] - t.pts[i - 1][1]);
    if (u <= m + 1e-9) return (t.v * k) / (t.w[i - 1] ?? 1);
  }
  return (t.v * k) / (t.w[t.w.length - 1] ?? 1);
}

/** How far along its way (real metres, a share of the whole) the trip has it `ahead` s from now. */
export function tripShare(t: RoverTrip, ahead = 0): number {
  if (t.len <= 1e-6) return 1;
  const u = travelled(clockAt(t, ahead), t.len, t.v, t.a);
  if (!t.w) return u / t.len;
  const all = pathLen(t.pts);
  return all > 1e-6 ? actualAt(t.pts, t.w, u) / all : 1;
}

// ───────────────────────────── goals ─────────────────────────────

/** What a unit is headed for now: the trip it wants. */
export interface Goal {
  /** kind, target and cell: a different key is a different trip */
  key: string;
  kind: Kind;
  site?: number;
  job?: number;
  /** its road cell, or null: straight there (a drone) */
  cell: Pt | null;
  /** the slot, world metres */
  x: number;
  z: number;
  /** off the road, inside an extraction zone: reached from a gate (core/zones.ts) */
  off?: boolean;
  /** a drone's: the frontier cell it hovers over (cellKey), when it sinters */
  mark?: number;
}

const isSiteB = (b: { construction?: number }) => (b.construction ?? 0) > 0;
const spurOpen = (s: GameState, b: BuildingState) => !(b.spur?.length && spurLeft(s, b) > 0);

/** A ground rover's goal from its slot (the visuals read the same). */
export function spotGoal(s: GameState, spot: RoverSpot): Goal {
  const cell: Pt = [spot.gx, spot.gz];
  const ck = cellKey(spot.gx, spot.gz);
  let kind: Kind = spot.core !== undefined ? 'core' : spot.grade !== undefined ? 'grade' : 'dock';
  let [x, z] = [spot.x, spot.z];
  // inside a dock: in at its door
  if (spot.inside) [x, z] = cellCentre(spot.gx, spot.gz);
  else if (spot.site !== null) {
    const b = s.buildings.find((o) => o.id === spot.site);
    if (b && !spurOpen(s, b)) {
      const f = frontierOf(s, b.spur!);
      kind = f?.from && cellKey(f.from[0], f.from[1]) === ck ? 'front' : 'behind';
    } else kind = 'weld';
  } else if (spot.road !== undefined) {
    const j = s.roadJobs?.find((q) => q.id === spot.road);
    const f = j ? frontierOf(s, j.cells) : null;
    kind = f?.from && cellKey(f.from[0], f.from[1]) === ck ? 'front' : 'behind';
  }
  const tgt = spot.site ?? spot.road ?? spot.core ?? spot.grade ?? spot.dock;
  return {
    key: `${kind}:${tgt}@${ck}${spot.inside ? 'i' : ''}${spot.offroad ? 'o' : ''}`, kind, cell, x, z, ...(spot.offroad ? { off: true } : {}),
    ...(spot.site !== null ? { site: spot.site } : {}),
    ...(spot.road !== undefined ? { job: spot.road } : spot.grade !== undefined ? { job: spot.grade } : {}),
  };
}

/** A hive pad's point (world metres, x z). */
export function padPoint(hive: BuildingState, pad: number): Pt {
  const [cx, cz] = centerOf(hive);
  const [lx, lz] = HIVE_PADS[pad % HIVE_PADS.length];
  const a = -hive.rot * Math.PI / 2, c = Math.cos(a), sn = Math.sin(a);
  return [cx + lx * c + lz * sn, cz - lx * sn + lz * c];
}

/** Where a drone hovers to weld a site: a ring round it, by id. */
export function droneRing(b: BuildingState, id: number): Pt {
  const [cx, cz] = centerOf(b);
  const def = BUILDINGS[b.type];
  const r = Math.max(2, Math.min(def.footprint[0], def.footprint[1]) * 2 - 1.5);
  const a = (id % 4) * Math.PI / 2 + 0.6;
  return [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
}

/** Each drone's pad on its hive: by its place in the roster. */
export function dronePads(s: GameState): Map<number, number> {
  const per = new Map<number, number>();
  const out = new Map<number, number>();
  for (const u of s.rovers ?? []) {
    if (!isDrone(s, u)) continue;
    const n = per.get(u.home) ?? 0;
    per.set(u.home, n + 1);
    out.set(u.id, n);
  }
  return out;
}

/** A drone's goal (docs/14 §4.3): straight over its site (the frontier of
 *  its road while that is unfinished), over a road job's frontier, down where
 *  it is when a hazard holds it, else its pad. */
export function droneGoal(s: GameState, u: RoverUnit, pad: number): Goal {
  const at = (kind: Kind, tgt: number | string, x: number, z: number, cell: number, extra: Partial<Goal> = {}): Goal =>
    ({ key: `${kind}:${tgt}@${cell >= 0 ? cell : `${x.toFixed(1)},${z.toFixed(1)}`}`, kind, cell: null, x, z, ...(cell >= 0 ? { mark: cell } : {}), ...extra });
  const hive = s.buildings.find((b) => b.id === u.home);
  const [px, pz] = hive ? padPoint(hive, pad) : [u.x ?? 0, u.z ?? 0];
  if (roverDown(s, u)) return { key: 'down', kind: 'down', cell: null, x: u.x ?? px, z: u.z ?? pz };
  // a deposit survey (docs/17 §13.2): a drone flies straight to its centre
  const core = u.core !== undefined ? s.zones?.find((z) => z.id === u.core) : undefined;
  if (core) return at('core', core.id, core.cx, core.cz, -1);
  const site = u.site !== null ? s.buildings.find((b) => b.id === u.site && isSiteB(b)) : undefined;
  const front = (cells: readonly number[], kind: 'site' | 'job', id: number) => {
    const f = frontierOf(s, cells);
    if (!f) return null;
    const [x, z] = cellCentre(f.cell.gx, f.cell.gz);
    const ox = kind === 'job' ? ((u.id % 3) - 1) * 1.2 : 0;
    return at(f.from ? 'front' : 'behind', `${kind[0]}${id}`, x + ox, z, cellKey(f.cell.gx, f.cell.gz),
      kind === 'site' ? { site: id } : { job: id });
  };
  if (site) {
    if (!spurOpen(s, site)) { const g = front(site.spur!, 'site', site.id); if (g) return g; }
    const [x, z] = droneRing(site, u.id);
    return at('weld', `s${site.id}`, x, z, -1, { site: site.id });
  }
  const job = u.road !== undefined ? s.roadJobs?.find((j) => j.id === u.road) : undefined;
  if (job) { const g = front(job.cells, 'job', job.id); if (g) return g; }
  return at('dock', `d${u.home}p${pad}`, px, pz, -1);
}

// ───────────────────────────── trips ─────────────────────────────

/** The way from (x, z) to a goal: the road route's cell centres, then the
 *  slot (straight for a drone, or a base with no roads); off-road inside a
 *  zone to and from its gate (core/roads.ts groundWay). Null: no road there. */
function wayTo(s: GameState, x: number, z: number, g: Goal): { pts: Pt[]; w?: number[] } | null {
  if (!g.cell || !hasRoads(s)) return { pts: [[x, z], [g.x, g.z]] };
  // a headless base's rovers drive the straight line, no road search; the road grid's extra metres are charged (core/simMode.ts)
  if (straightOf(s)) return { pts: [[x, z], [g.x, g.z]], w: [STRAIGHT_DETOUR] };
  // a slot on a road cell is reached by it; an off-road one (inside a zone,
  // or a Relay Mast's stand) by a gate; a unit stopped out on open ground
  // (its pack flat on a mast's way out) sets off again from the nearest road,
  // and an off-road slot on open ground (a field structure's wall just outside
  // its zone's rim) is reached from the nearest road
  let from = offAreaAt(s, x, z) ?? offGround(s, x, z);
  let to = g.off ? offAreaAt(s, g.x, g.z) ?? offGround(s, g.x, g.z) : null;
  // a grading job's stand (docs/19 S5) on open ground: the box is its own area with one gate (the road cell nearest it),
  // so a rover hopping from cell to cell stays on it and one arriving drives in from that road cell
  // (inside an extraction zone with a gate the zone's own way is used; a zone with none yet has no way, so the box's own)
  const open = (a: { gates: unknown[] } | null) => !a || a.gates.length === 0;
  if (g.kind === 'grade' && g.job !== undefined && g.off && open(offAreaAt(s, g.x, g.z))) {
    const j = s.gradeJobs?.find((q) => q.id === g.job);
    const area = j ? gradeArea(s, j) : null;
    if (j && area) {
      to = area;
      if (onGradeGround(j, x, z) && open(offAreaAt(s, x, z))) from = area;
      // a hop on from cell to cell across ground the blade has just levelled: at road speed
      if (from && from.id === area.id) return { pts: [[x, z], [g.x, g.z]] };
    }
  }
  const way = groundWay(s, [x, z], [g.x, g.z], null, null, from, to);
  if (!way) return null;
  // drop points it already stands on
  const pts: Pt[] = [way.pts[0]];
  const w: number[] = [];
  for (let i = 1; i < way.pts.length; i++) {
    const l = pts[pts.length - 1];
    if (Math.hypot(way.pts[i][0] - l[0], way.pts[i][1] - l[1]) > 1e-6) { pts.push(way.pts[i]); w.push(way.w?.[i - 1] ?? 1); }
  }
  return way.w ? { pts, w } : { pts };
}

/** A new trip for `r` from where it stands (a rover, a drone). */
export function planTrip(s: GameState, r: RoverUnit, g: Goal, v: number, a: number, local = false): RoverTrip {
  const x = r.x ?? g.x, z = r.z ?? g.z;
  const way = wayTo(s, x, z, g);
  const base = {
    goal: g.key, kind: g.kind, ...(g.site !== undefined ? { site: g.site } : {}), ...(g.job !== undefined ? { job: g.job } : {}),
    cell: g.cell ? cellKey(g.cell[0], g.cell[1]) : g.mark ?? -1, v, a, t: 0, ...(local ? { local: true } : {}),
  };
  if (!way) return { ...base, pts: [[x, z]], len: 0, dur: 0, stuck: true };
  // off-road metres count 1 / ROAD.offroad: the trip is timed as that much road
  const len = weighedLen(way.pts, way.w);
  const instant = instantOf(s);
  const dur = instant ? 0 : travelTime(len, v, a);
  if (instant) { r.x = g.x; r.z = g.z; }
  return { ...base, pts: way.pts, ...(way.w ? { w: way.w } : {}), len, dur };
}

/** A trip already over: it stands at its goal. */
function settled(r: RoverUnit, g: Goal, v: number, a: number): RoverTrip {
  r.x = g.x;
  r.z = g.z;
  return {
    goal: g.key, kind: g.kind, ...(g.site !== undefined ? { site: g.site } : {}), ...(g.job !== undefined ? { job: g.job } : {}),
    cell: g.cell ? cellKey(g.cell[0], g.cell[1]) : g.mark ?? -1, pts: [[g.x, g.z]], len: 0, v, a, t: 0, dur: 0,
  };
}

/** The work a trip is for: a site, a road job, or neither. */
const workOf = (t: { site?: number; job?: number }) => (t.site !== undefined ? `s${t.site}` : t.job !== undefined ? `j${t.job}` : '');

export interface Arrivals {
  /** units at their stands, welding a site, by site */
  weld: Map<number, RoverUnit[]>;
  /** units behind a site's road frontier (they sinter it), by site */
  front: Map<number, RoverUnit[]>;
  /** units behind a road job's frontier, by job */
  jobs: Map<number, RoverUnit[]>;
  /** units at their stands on a grading job's cells (docs/19 S5), by job */
  grade: Map<number, RoverUnit[]>;
}

/** Economy step 0, after the assignments: advance every trip by dt, then
 *  count who stands where its work is — a site's welders, the units behind
 *  a road's frontier. A unit reassigned since its trip was planned counts
 *  for nothing until its new trip gets it there. */
export function transitArrive(s: GameState, dt: number): Arrivals {
  const out: Arrivals = { weld: new Map(), front: new Map(), jobs: new Map(), grade: new Map() };
  const push = (m: Map<number, RoverUnit[]>, k: number, r: RoverUnit) => (m.get(k) ?? m.set(k, []).get(k)!).push(r);
  for (const r of s.rovers ?? []) {
    delete r.task;
    const t = r.trip;
    if (!t || t.stuck) continue;
    // a flare reboot holds it where it stands: no driving, no work (docs/16 §4.5)
    if ((r.rebootUntil ?? 0) > s.simTime) continue;
    // out of charge, it waits where it stands; on its RPU alone it creeps (core/unitPower.ts)
    const pw = r.pw ?? 1;
    if (t.t < t.dur && pw > 0) {
      // the stretch of road this second covers is a digger's or a rover's: a unit whose reservation
      // holds it waits where it stands, and its trip's ETA stretches (docs/19 S4a, core/traffic.ts)
      const to = Math.min(t.dur, t.t + dt * pw);
      const at = (c: number): Pt => pointOnW(t.pts, t.w, travelled(c, t.len, t.v, t.a));
      const way = [0.25, 0.5, 0.75, 1].map((k) => at(t.t + (to - t.t) * k));
      const go = roverStep(s, r.id, [r.x ?? way[0][0], r.z ?? way[0][1]], way, t.held ?? 0);
      if (go === 'held') t.held = (t.held ?? 0) + dt;
      else {
        if (t.held !== undefined && go === 'go') delete t.held;
        t.t = to;
        [r.x, r.z] = tripPoint(t);
      }
    }
    if (t.kind === 'grade') {
      // at its stand on its cell of the job, or on the short hop on to the next cell within a few metres of it: the
      // blade works as it creeps on (a cell levelled sends it on: it counts again once it is near the next; a
      // long drive out to the box counts nothing until it has arrived)
      const j = t.job !== undefined && t.job === r.grade ? s.gradeJobs?.find((q) => q.id === t.job) : undefined;
      if (j && !roverDown(s, r) && t.cell === standOf(s, j, r)) {
        const [sx, sz] = cellCentre(...keyCell(t.cell));
        if (arrived(t) || (t.local && Math.hypot((r.x ?? sx) - sx, (r.z ?? sz) - sz) < GRADE_REACH_M)) push(out.grade, j.id, r);
      }
      continue;
    }
    if (!arrived(t) || roverDown(s, r)) continue;
    if (t.kind === 'weld' && t.site !== undefined && t.site === r.site) push(out.weld, t.site, r);
    else if (t.kind === 'front') {
      // still the frontier: the cell behind it (a drone: over it)
      const drone = isDrone(s, r);
      const cells = t.site !== undefined && t.site === r.site ? s.buildings.find((b) => b.id === t.site)?.spur
        : t.job !== undefined && t.job === r.road ? s.roadJobs?.find((j) => j.id === t.job)?.cells : undefined;
      const f = cells ? frontierOf(s, cells) : null;
      const k = !f ? -2 : drone ? cellKey(f.cell.gx, f.cell.gz) : f.from ? cellKey(f.from[0], f.from[1]) : -2;
      if (k !== t.cell) continue;
      if (t.site !== undefined) push(out.front, t.site, r);
      else push(out.jobs, t.job!, r);
    }
  }
  return out;
}

/** The end of the tick: every unit whose goal changed (its assignment, a
 *  frontier moved on, a slot changed) sets off from where it stands. A unit
 *  with no position yet settles: a migrated save's where its work is, a new
 *  one at its dock (it rolls out of the door for a site). `night`: the
 *  beacons' bonus. */
export function transitPlan(s: GameState, mods: Pick<Mods, 'roadSpeedMult' | 'roadNightMult'>, night: boolean) {
  if (!s.rovers?.length) return;
  const spots = groundSpots(s);
  const pads = dronePads(s);
  const v = roverSpeed(mods, night);
  for (const r of s.rovers) {
    const drone = isDrone(s, r);
    const spot = drone ? undefined : spots.get(r.id);
    if (!drone && !spot) continue;
    const g = drone ? droneGoal(s, r, pads.get(r.id) ?? 0) : spotGoal(s, spot!);
    const [sv, sa] = drone ? [DRONE.speed, DRONE.accel] : [v, ROVER.accel];
    if (r.x === undefined || r.z === undefined) {
      // no place yet: a migrated save's unit is where its work is; a new one at its dock
      const work = g.kind === 'weld' || g.kind === 'front' || g.kind === 'behind';
      if (r.place || !work) { r.trip = settled(r, g, sv, sa); delete r.place; continue; }
      const dock = s.buildings.find((b) => b.id === r.home);
      const d = dock && !drone ? doorCell(dock) : null;
      [r.x, r.z] = drone && dock ? padPoint(dock, pads.get(r.id) ?? 0) : d ? cellCentre(d[0], d[1]) : dock ? centerOf(dock) : [g.x, g.z];
    }
    delete r.place;
    const t = r.trip;
    if (t && t.goal === g.key && !t.stuck) continue;
    // a step to the next stand at the same work (the frontier's next cell) is no new journey
    const local = !!t && !t.stuck && workOf(t) !== '' && workOf(t) === workOf(g)
      && (arrived(t) || (t.kind === 'grade' && g.kind === 'grade')); // a grading rover goes on from cell to cell as it works
    // (the blade's creep from cell to cell across the ground it has levelled: a brisker start and stop than a drive)
    r.trip = planTrip(s, r, g, sv, local && g.kind === 'grade' ? sa * GRADE_HOP_ACCEL : sa, local);
    if (r.pw !== undefined) r.trip.rate = r.pw; // a new trip on a flat pack waits as the last did
  }
}

// ───────────────────────────── what the UI reads ─────────────────────────────

/** Seconds the nearest free unit (parked or heading home, not pinned, not
 *  lent, not held) would take from where it is to a road cell `to` (a drone
 *  straight to the point `at`): the placement ghost's ETA. Infinity: none is
 *  free, or no road reaches there. */
export function freeReach(
  s: GameState, mods: Pick<Mods, 'roadSpeedMult' | 'roadNightMult'>, night: boolean, to: Pt | null, at: Pt,
): number {
  const v = roverSpeed(mods, night);
  let best = Infinity;
  for (const r of s.rovers ?? []) {
    if (r.pinned || r.site !== null || r.road !== undefined || r.core !== undefined || r.grade !== undefined || roverDown(s, r)) continue;
    const [x, z] = whereIs(s, r);
    if (isDrone(s, r)) { best = Math.min(best, travelTime(Math.hypot(at[0] - x, at[1] - z), DRONE.speed, DRONE.accel)); continue; }
    if (!to || !hasRoads(s)) { best = Math.min(best, travelTime(Math.hypot(at[0] - x, at[1] - z), v, ROVER.accel)); continue; }
    const n = roadDistances(s, to).get(cellKey(...cellAt(x, z)));
    if (n !== undefined) best = Math.min(best, travelTime(n * CELL_M, v, ROVER.accel));
  }
  return best;
}

export interface SiteTransit {
  /** 'enroute': a unit is on its way · 'road'/'building': one is stepping to
   *  its next stand · 'noroad': no road reaches it · '': someone is there */
  wait: '' | 'enroute' | 'noroad' | 'step';
  /** s until the first unit on its way gets there (Infinity: unknown) */
  eta: number;
}

/** How a site's crew stands: on its way (and when it gets there), stepping
 *  along the road it sinters, or with no road to it. */
export function siteTransit(s: GameState, siteId: number): SiteTransit {
  let pending = false, stuck = false, step = false, there = false, eta = Infinity;
  for (const r of s.rovers ?? []) {
    if (r.site !== siteId || roverDown(s, r)) continue;
    const t = r.trip;
    if (!t || t.site !== siteId) { pending = true; continue; }
    if (t.stuck) { stuck = true; continue; }
    if (arrived(t)) { there = true; continue; }
    if (t.local) step = true;
    else eta = Math.min(eta, t.dur - t.t);
  }
  const wait = there ? '' : step ? 'step' : eta < Infinity || pending ? 'enroute' : stuck ? 'noroad' : 'enroute';
  return { wait, eta };
}
