/** The road network (docs/15-roads.md): 4 m grid cells the rovers sinter and
 *  every unit drives on. Pure: the state and a height sampler in, cells and
 *  routes out; no Three.js, no randomness, stable orders, so the sim stays
 *  deterministic.
 *
 *  - Doors: every structure but the field types has one (front middle,
 *    rotated with it); its spur ends there.
 *  - Spurs: A* from the open network to the door on placement; the site's
 *    rovers sinter it before they weld.
 *  - Field types (arrays, batteries) are served from the field's edge.
 *  - Off-road types (Relay Masts) get no road at all: a rover drives out
 *    from the nearest road cell across open ground (mastStand).
 *  - Jobs: roads the player draws and haul roads to a dig, sintered by free rovers.
 *  - Routes: shortest open paths, cached on the network's revision. */
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { CELL_M, MAP_CELLS, MAP_M, PIT } from '../data/balance';
import { APRON, DOCK_TYPES, FIELD_TYPES, OFFROAD_TYPES, ROAD } from '../data/roads';
import type { BuildingState, GameState, RoadCell, RoadJob, ZoneState } from './state';
import { footprintRect } from '../buildings/instances';
import { rimOf, zoneCells, zoneOfCell } from './zones';
import { perState } from './stateMemo';

/** The ground a road is planned over: heights, and (the heightfield) the
 *  cells no road may take — a pit's cut or a heap (terrain/pitCarve.ts). */
export interface Heights { sample(x: number, z: number): number; noRoad?(gx: number, gz: number): boolean }
type Cell = [number, number];
type Placed = Pick<BuildingState, 'type' | 'gx' | 'gz' | 'rot'>;

export const cellKey = (gx: number, gz: number) => gz * MAP_CELLS + gx;
export const keyCell = (k: number): Cell => [k % MAP_CELLS, Math.floor(k / MAP_CELLS)];
/** A cell's centre, world metres. */
export const cellCentre = (gx: number, gz: number): Cell =>
  [(gx + 0.5) * CELL_M - MAP_M / 2, (gz + 0.5) * CELL_M - MAP_M / 2];
/** The cell holding a world point. */
export const cellAt = (x: number, z: number): Cell =>
  [Math.floor((x + MAP_M / 2) / CELL_M), Math.floor((z + MAP_M / 2) / CELL_M)];
const inMap = (gx: number, gz: number) => gx >= 1 && gz >= 1 && gx < MAP_CELLS - 1 && gz < MAP_CELLS - 1;
const N4: Cell[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Does this base use roads? (Every new landing and migrated save does.) */
export const hasRoads = (s: GameState) => !!s.roads;

// ───────────────────────────── the index ─────────────────────────────

const nets = new WeakMap<RoadCell[], { rev: number; len: number; map: Map<number, RoadCell> }>();

/** cell key → road cell (open or being sintered). */
export function roadMap(s: GameState): Map<number, RoadCell> {
  const list = s.roads ?? [];
  const rev = s.roadRev ?? 0;
  let n = nets.get(list);
  if (!n || n.rev !== rev || n.len !== list.length) {
    const map = new Map<number, RoadCell>();
    for (const c of list) map.set(cellKey(c.gx, c.gz), c);
    n = { rev, len: list.length, map };
    nets.set(list, n);
  }
  return n.map;
}

/** Something about the network changed: routes and plans are stale. */
export function bumpRoads(s: GameState) { s.roadRev = (s.roadRev ?? 0) + 1; }

export const isOpen = (c: RoadCell | undefined): boolean => !!c && c.left <= 1e-9;

/** Every footprint cell (optionally one more structure's). */
export function footprintCells(b: Placed): number[] {
  const r = footprintRect(b);
  const out: number[] = [];
  for (let z = r.gz0; z < r.gz1; z++) for (let x = r.gx0; x < r.gx1; x++) out.push(cellKey(x, z));
  return out;
}

function occupied(s: GameState, extra?: Placed): Set<number> {
  const out = new Set<number>();
  for (const b of s.buildings) for (const k of footprintCells(b)) out.add(k);
  if (extra) for (const k of footprintCells(extra)) out.add(k);
  return out;
}

// ───────────────────────────── doors ─────────────────────────────

/** Local → rotated cell offset, as a building's mesh rotates (−rot·π/2 about +y). */
function rotate(b: Placed, lx: number, lz: number): Cell {
  const a = -b.rot * Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
  return [lx * c + lz * s, -lx * s + lz * c];
}

/** The outward direction of its front (cell steps). */
export function frontDir(b: Placed): Cell {
  const [x, z] = rotate(b, 0, 1);
  return [Math.round(x), Math.round(z)];
}

/** No door: a field type (served from its edge) or an off-road type (a Relay Mast). */
export const doorless = (t: BuildingId): boolean => FIELD_TYPES.has(t) || OFFROAD_TYPES.has(t);

/** The cell a structure's road ends at (null: a field type, served from its edge, or an off-road type). */
export function doorCell(b: Placed): Cell | null {
  if (doorless(b.type)) return null;
  const [w, d] = BUILDINGS[b.type].footprint;
  const r = footprintRect(b);
  const cx = (r.gx0 + r.gx1) / 2, cz = (r.gz0 + r.gz1) / 2;
  const [dx, dz] = rotate(b, Math.floor((w - 1) / 2) + 0.5 - w / 2, d / 2 + 0.5);
  return [Math.round(cx + dx - 0.5), Math.round(cz + dz - 0.5)];
}

/** The door cell's centre, and the point on the footprint's wall it faces. */
export function doorPoint(b: Placed): { x: number; z: number; wx: number; wz: number } | null {
  const d = doorCell(b);
  if (!d) return null;
  const [x, z] = cellCentre(d[0], d[1]);
  const [fx, fz] = frontDir(b);
  return { x, z, wx: x - fx * CELL_M / 2, wz: z - fz * CELL_M / 2 };
}

/** Cells within `reach` of the footprint (its ring), in a stable order. */
export function ringCells(b: Placed, reach = ROAD.fieldReach): Cell[] {
  const r = footprintRect(b);
  const out: Cell[] = [];
  for (let z = r.gz0 - reach; z < r.gz1 + reach; z++) {
    for (let x = r.gx0 - reach; x < r.gx1 + reach; x++) {
      if (x >= r.gx0 && x < r.gx1 && z >= r.gz0 && z < r.gz1) continue;
      out.push([x, z]);
    }
  }
  return out;
}

/** Cells sharing an edge with the footprint. */
export function edgeCells(b: Placed): Cell[] {
  const r = footprintRect(b);
  const out: Cell[] = [];
  for (let x = r.gx0; x < r.gx1; x++) out.push([x, r.gz0 - 1], [x, r.gz1]);
  for (let z = r.gz0; z < r.gz1; z++) out.push([r.gx0 - 1, z], [r.gx1, z]);
  return out;
}

const touches = (a: Placed, b: Placed) => {
  const p = footprintRect(a), q = footprintRect(b);
  const xs = Math.min(p.gx1, q.gx1) - Math.max(p.gx0, q.gx0);
  const zs = Math.min(p.gz1, q.gz1) - Math.max(p.gz0, q.gz0);
  return (xs === 0 && zs > 0) || (zs === 0 && xs > 0);
};

// ───────────────────────────── served ─────────────────────────────

/** Memo for the siting scans (the chooser asks once a candidate): per road
 *  list, on the network's revision and the buildings. */
const fieldMemo = new WeakMap<RoadCell[], { key: string; served: Set<number> }>();
const layoutKey = (s: GameState) => `${s.roadRev ?? 0},${s.roads?.length ?? 0}|${s.nextBuildingId},${s.buildings.length}|z${s.zones?.length ?? 0}|t${s.terrain?.rev ?? 0}`;

/** Field structures a road serves: one within reach of any road cell, or one
 *  sharing an edge with a served structure of its own type. */
export function servedFields(s: GameState): Set<number> {
  const list = s.roads;
  const key = layoutKey(s);
  const hit = list ? fieldMemo.get(list) : undefined;
  if (hit && hit.key === key) return hit.served;
  const out = findServed(s);
  if (list) fieldMemo.set(list, { key, served: out });
  return out;
}

function findServed(s: GameState): Set<number> {
  const map = roadMap(s);
  const out = new Set<number>();
  const fields = s.buildings.filter((b) => FIELD_TYPES.has(b.type));
  const queue: BuildingState[] = [];
  for (const b of fields) {
    if (ringCells(b).some(([x, z]) => { const c = map.get(cellKey(x, z)); return !!c && !c.bay; })) {
      out.add(b.id);
      queue.push(b);
    }
  }
  while (queue.length) {
    const b = queue.shift()!;
    for (const o of fields) {
      if (out.has(o.id) || o.type !== b.type || !touches(b, o)) continue;
      out.add(o.id);
      queue.push(o);
    }
  }
  return out;
}

/** Can a field structure at this spot be served without a road of its own? */
function fieldReached(s: GameState, b: Placed): boolean {
  const map = roadMap(s);
  if (ringCells(b).some(([x, z]) => { const c = map.get(cellKey(x, z)); return !!c && !c.bay; })) return true;
  const served = servedFields(s);
  return s.buildings.some((o) => o.type === b.type && served.has(o.id) && touches(o, b));
}

// ───────────────────────────── planning ─────────────────────────────

/** A binary min-heap keyed on f, then on `t` (the nearer to its target first:
 *  equal-cost routes are walked straight on before they fan out), then the
 *  lower state id (stable). */
class Heap {
  private f: number[] = [];
  private t: number[] = [];
  private k: number[] = [];
  get size() { return this.k.length; }
  private less(i: number, j: number) {
    return this.f[i] < this.f[j] || (this.f[i] === this.f[j] && (this.t[i] < this.t[j] || (this.t[i] === this.t[j] && this.k[i] < this.k[j])));
  }
  private swap(i: number, j: number) {
    [this.f[i], this.f[j]] = [this.f[j], this.f[i]];
    [this.t[i], this.t[j]] = [this.t[j], this.t[i]];
    [this.k[i], this.k[j]] = [this.k[j], this.k[i]];
  }
  push(f: number, t: number, k: number) {
    this.f.push(f); this.t.push(t); this.k.push(k);
    for (let i = this.k.length - 1; i > 0;) { const p = (i - 1) >> 1; if (!this.less(i, p)) break; this.swap(i, p); i = p; }
  }
  pop(): number {
    const top = this.k[0];
    const lf = this.f.pop()!, lt = this.t.pop()!, lk = this.k.pop()!;
    if (this.k.length) {
      this.f[0] = lf; this.t[0] = lt; this.k[0] = lk;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.k.length && this.less(l, m)) m = l;
        if (r < this.k.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top;
  }
}

const MAX_EXPAND = 60000;
/** a walk's state is a cell and the way it faces (0–3: N4's steps; 4: none yet) */
const NODE = 5;
const NONE = 4;

export interface SearchOpts {
  /** a cost on reaching each target (a zone's rim: the drive on from it); the walk then ends past the targets */
  sink?: Map<number, number>;
  /** the way the walk starts facing (a door's front): going straight on is free, a turn out of the door costs a bend */
  facing?: Cell;
  /** an extra cost for each new cell entered (the soft cost inside a pit's full-size ring) */
  soft?: (k: number) => number;
}

/** A* on cells: from `sources` (cost 0) to any of `targets`. New cells cost 1
 *  plus the height step; closed road cells (being sintered) 0.5; open road
 *  0.05 (a road that merges into the network rides it nearly free). Every
 *  change of direction on a cell that is not already road costs ROAD.turn, so
 *  Manhattan-equal staircases no longer tie: a route is a trunk with a couple
 *  of bends, and among equal routes the walk that is nearer its target goes
 *  first. Footprints, bays and steps steeper than ROAD.maxStep are walls.
 *  `opts.sink`: a cost to add on reaching each target. Returns the cells after
 *  the source, in order, and the target it ended at (the source itself when
 *  no step was needed). */
function search(
  s: GameState, hf: Heights, sources: number[], targets: Set<number>, blocked: Set<number>, opts: SearchOpts = {},
): { path: number[]; end: number } | null {
  if (!sources.length || !targets.size) return null;
  const { sink, soft } = opts;
  const map = roadMap(s);
  const tcells = [...targets].map(keyCell);
  const hMemo = new Map<number, number>();
  const h = (k: number) => {
    let v = hMemo.get(k);
    if (v === undefined) {
      const [x, z] = keyCell(k);
      v = Infinity;
      for (const [tx, tz] of tcells) v = Math.min(v, Math.abs(tx - x) + Math.abs(tz - z));
      hMemo.set(k, v);
    }
    return v;
  };
  const height = new Map<number, number>();
  const hAt = (k: number) => {
    let v = height.get(k);
    if (v === undefined) { const [x, z] = keyCell(k); v = hf.sample(...cellCentre(x, z)); height.set(k, v); }
    return v;
  };
  const start = opts.facing ? Math.max(0, N4.findIndex(([dx, dz]) => dx === opts.facing![0] && dz === opts.facing![1])) : NONE;
  const SINK = -2;
  const cost = new Map<number, number>();
  const from = new Map<number, number>();
  const done = new Set<number>();
  const open = new Heap();
  const reach = (id: number, k: number, g: number) => {
    const t = sink!.get(k);
    if (t === undefined) return;
    if (g + t < (cost.get(SINK) ?? Infinity)) { cost.set(SINK, g + t); from.set(SINK, id); open.push(g + t, 0, SINK); }
  };
  for (const k of [...sources].sort((a, b) => a - b)) {
    if (!sink && targets.has(k)) return { path: [], end: k };
    const id = k * NODE + start;
    cost.set(id, 0);
    from.set(id, -1);
    open.push(h(k), h(k), id);
    if (sink && targets.has(k)) reach(id, k, 0);
  }
  let found = -1, n = 0;
  while (open.size && n++ < MAX_EXPAND) {
    const id = open.pop();
    if (done.has(id)) continue;
    done.add(id);
    if (id === SINK) break;
    const k = Math.floor(id / NODE), d = id % NODE;
    const g = cost.get(id)!;
    if (targets.has(k)) {
      if (!sink) { found = id; break; }
      reach(id, k, g);
    }
    const [x, z] = keyCell(k);
    // a bend is charged where the way turns off a cell that is not road already
    const bend = !isOpen(map.get(k));
    for (let nd = 0; nd < 4; nd++) {
      if (d !== NONE && nd === (d ^ 1)) continue; // never straight back
      const nx = x + N4[nd][0], nz = z + N4[nd][1];
      if (!inMap(nx, nz)) continue;
      const nk = cellKey(nx, nz);
      if (blocked.has(nk)) continue;
      const nid = nk * NODE + nd;
      if (done.has(nid)) continue;
      const road = map.get(nk);
      if (road?.bay || road?.closed) continue;
      // roads never cross a pit or a heap (docs/17 §11.4): the road tool stops at the rim
      if (!road && hf.noRoad?.(nx, nz)) continue;
      const step = Math.abs(hAt(nk) - hAt(k));
      if (step > ROAD.maxStep) continue;
      const c = g + (isOpen(road) ? 0.05 : road ? 0.5 : 1) + ROAD.slopeCost * step
        + (bend && d !== NONE && d !== nd ? ROAD.turn : 0) + (!road && soft ? soft(nk) : 0);
      if (c < (cost.get(nid) ?? Infinity)) {
        cost.set(nid, c);
        from.set(nid, id);
        open.push(c + h(nk), h(nk), nid);
      }
    }
  }
  const end = sink ? (done.has(SINK) ? from.get(SINK)! : -1) : found;
  if (end < 0) return null;
  const out: number[] = [];
  let id = end;
  for (; from.get(id) !== -1; id = from.get(id)!) out.push(Math.floor(id / NODE));
  out.reverse();
  return { path: out, end: out.length ? out[out.length - 1] : Math.floor(id / NODE) };
}

// ───────────────────────────── zones (core/zones.ts) ─────────────────────────────

/** A rim cell's cost as a road's end, for a drive on to (x, z): its
 *  off-road distance, 0.9 a cell. A new road cell costs 1, so the road stops
 *  at the rim cell nearest the network by road cost, and runs no further
 *  round the rim than the drive it saves. */
const offCost = (k: number, x: number, z: number) => {
  const [cx, cz] = cellCentre(...keyCell(k));
  return 0.9 * Math.hypot(cx - x, cz - z) / CELL_M;
};

/** A road cell that is neither a bay nor part of the closed apron, nor a
 *  passing or holding bay (docs/19 S3: those are plain open cells beside a
 *  road, never a gate). */
const throughCell = (c: RoadCell | undefined) => !c || !(c.bay || c.closed || c.pass || c.hold);

/** Where an auto road into zone `zone` may stop, for a drive on to (x, z):
 *  its rim's free cells and its gates already laid, each with that drive's
 *  cost — and, with a hub to serve (`hub`, world m), ROAD.hubSide per 90°
 *  between the cell and the hub seen from the zone's centre, so the gate lies
 *  on the hub's side (docs/19 S3). */
function rimTargets(
  s: GameState, zone: ZoneState, blocked: Set<number>, x: number, z: number, hub?: readonly [number, number],
): Map<number, number> {
  const map = roadMap(s);
  const out = new Map<number, number>();
  const keys = new Set<number>(rimOf(s, zone).keys());
  for (const c of s.roads ?? []) if (c.gate === zone.id) keys.add(cellKey(c.gx, c.gz));
  const ha = hub ? Math.atan2(hub[1] - zone.cz, hub[0] - zone.cx) : 0;
  for (const k of [...keys].sort((a, b) => a - b)) {
    const [gx, gz] = keyCell(k);
    if (!inMap(gx, gz) || blocked.has(k) || !throughCell(map.get(k))) continue;
    let cost = offCost(k, x, z);
    if (hub) {
      const [px, pz] = cellCentre(gx, gz);
      let d = Math.abs(Math.atan2(pz - zone.cz, px - zone.cx) - ha);
      if (d > Math.PI) d = 2 * Math.PI - d;
      cost += ROAD.hubSide * d / (Math.PI / 2);
    }
    out.set(k, cost);
  }
  return out;
}

const gateMemo = new WeakMap<RoadCell[], { key: string; gates: Map<string, Cell[]> }>();

/** A zone's gates: where a road stops and units go on off-road. A road
 *  laid to the zone marks its last cell (`RoadCell.gate` = the zone's id,
 *  docs/19 S3), and those open cells are its gates; with none marked (a save
 *  from before, a road the player drew) every open road cell on the rim is
 *  one, passing and holding bays and the apron aside. In cell-key order;
 *  memoised on the network and the zones. */
export function gatesOf(s: GameState, zone: ZoneState): Cell[] {
  const list = s.roads ?? [];
  const key = `${s.roadRev ?? 0},${list.length}|${s.zones?.length ?? 0}`;
  let m = gateMemo.get(list);
  if (!m || m.key !== key) { m = { key, gates: new Map() }; gateMemo.set(list, m); }
  let g = m.gates.get(zone.id);
  if (!g) {
    const marked = list.filter((c) => c.gate === zone.id && isOpen(c) && !c.bay)
      .map((c) => cellKey(c.gx, c.gz)).sort((a, b) => a - b);
    if (marked.length) g = marked.map(keyCell);
    else {
      const map = roadMap(s);
      g = [...rimOf(s, zone).keys()].sort((a, b) => a - b)
        .filter((k) => { const c = map.get(k); return isOpen(c) && throughCell(c); }).map(keyCell);
    }
    m.gates.set(zone.id, g);
  }
  return g;
}

/** The holding bay of a gate (docs/19 S3): the open `hold` cell of that zone beside it (or, with no room
 *  beside the gate, beside the road cell before it), else null. Units queue here, never on the gate. */
export function holdOf(s: GameState, zone: ZoneState, gate: Cell): Cell | null {
  const map = roadMap(s);
  const near = (k: Cell): Cell | null => {
    for (const [dx, dz] of N4) {
      const c = map.get(cellKey(k[0] + dx, k[1] + dz));
      if (c?.hold === zone.id && isOpen(c)) return [c.gx, c.gz];
    }
    return null;
  };
  const beside = near(gate);
  if (beside) return beside;
  for (const [dx, dz] of N4) {
    const c = map.get(cellKey(gate[0] + dx, gate[1] + dz));
    if (c && isOpen(c) && throughCell(c) && !zoneCells(s).has(cellKey(c.gx, c.gz))) { const h = near([c.gx, c.gz]); if (h) return h; }
  }
  return null;
}

/** Is this cell a gate (an open road cell where a zone's road stops)? */
export function isGate(s: GameState, gx: number, gz: number): boolean {
  const k = cellKey(gx, gz);
  const cells = zoneCells(s);
  if (cells.has(k)) return false;
  const marked = roadMap(s).get(k)?.gate;
  if (marked !== undefined) {
    const z = s.zones?.find((q) => q.id === marked);
    if (z && gatesOf(s, z).some(([x, y]) => x === gx && y === gz)) return true;
  }
  for (const [dx, dz] of N4) {
    const i = cells.get(cellKey(gx + dx, gz + dz));
    if (i !== undefined && gatesOf(s, s.zones![i]).some(([x, z]) => x === gx && z === gz)) return true;
  }
  return false;
}

/** Off the road inside a zone? (a point whose cell is in a zone and is no open road) */
export function offRoadAt(s: GameState, x: number, z: number): ZoneState | null {
  const [gx, gz] = cellAt(x, z);
  const zone = zoneOfCell(s, gx, gz);
  if (!zone) return null;
  const c = roadMap(s).get(cellKey(gx, gz));
  return c && isOpen(c) ? null : zone;
}

/** Ground a unit crosses off-road, and the road cells it joins the road by:
 *  an extraction zone (its gates), or the way out to a Relay Mast (its one gate). */
export interface OffArea { id: string; gates: Cell[] }
const isArea = (e: ZoneState | OffArea): e is OffArea => 'gates' in e;
const areaGates = (s: GameState, e: ZoneState | OffArea): Cell[] => (isArea(e) ? e.gates : gatesOf(s, e));

/** Off the road here? Inside a zone with a gate (its gates), else on the way
 *  out to a Relay Mast (within a few metres of the straight leg from its gate
 *  to its stand), else inside a zone with no gate yet (no way out: gates []);
 *  null on an open road cell, or on open ground no way crosses. */
export function offAreaAt(s: GameState, x: number, z: number): OffArea | null {
  const [gx, gz] = cellAt(x, z);
  const c = roadMap(s).get(cellKey(gx, gz));
  if (c && isOpen(c)) return null;
  const zone = zoneOfCell(s, gx, gz);
  const zoneArea = zone ? { id: zone.id, gates: gatesOf(s, zone) } : null;
  if (zoneArea?.gates.length) return zoneArea;
  for (const m of mastWays(s)) if (segDist(x, z, m.ax, m.az, m.bx, m.bz) <= MAST_LANE) return m.area;
  return zoneArea;
}

/** Every Relay Mast's way out, gate to stand (memoised per network, on its revision and the buildings). */
type MastWay = { ax: number; az: number; bx: number; bz: number; area: OffArea };
const mastWayMemo = new WeakMap<RoadCell[], { key: string; ways: MastWay[] }>();
function mastWays(s: GameState): MastWay[] {
  if (!s.roads) return [];
  const key = layoutKey(s);
  const hit = mastWayMemo.get(s.roads);
  if (hit && hit.key === key) return hit.ways;
  const ways: MastWay[] = [];
  for (const b of s.buildings) {
    const ms = OFFROAD_TYPES.has(b.type) ? mastStand(s, b) : null;
    if (!ms) continue;
    const [ax, az] = cellCentre(ms.gate[0], ms.gate[1]);
    ways.push({ ax, az, bx: ms.x, bz: ms.z, area: ms.area });
  }
  mastWayMemo.set(s.roads, { key, ways });
  return ways;
}

/** Open ground off every road and zone: the way on from the nearest open road
 *  cell (a unit stopped out there, and set off again: core/transit.ts). */
export function offGround(s: GameState, x: number, z: number): OffArea | null {
  const [gx, gz] = cellAt(x, z);
  const c = roadMap(s).get(cellKey(gx, gz));
  if (c && isOpen(c)) return null;
  const n = nearestRoad(s, x, z);
  return n ? { id: `off:${cellKey(n[0], n[1])}`, gates: [n] } : null;
}

/** m from (x, z) to the segment a–b */
function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const k = l2 > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
  return Math.hypot(x - ax - dx * k, z - az - dz * k);
}

export interface GroundWay {
  /** the way, world metres: from a, by gates and road cell centres, to b */
  pts: [number, number][];
  /** each segment's time per metre against road (1 on road, 1 / ROAD.offroad off it); absent: all road */
  w?: number[];
}

/** A ground unit's way from a to b (docs/15 §5a, §5b): off-road straight
 *  between a point inside a zone and a gate of it (or straight across the
 *  zone, both ends in it), or between a Relay Mast's stand and its gate; the
 *  shortest open road between. An end on an open road cell is on the road;
 *  one off it (in a zone, on a mast's way out, or given its area) is reached
 *  off-road from a gate. `aVia`, `bVia`: the road cell an end joins the road
 *  by, through its centre (a pad's door). Null: no way. */
export function groundWay(
  s: GameState, a: [number, number], b: [number, number], aVia?: Cell | null, bVia?: Cell | null,
  aZone?: ZoneState | OffArea | null, bZone?: ZoneState | OffArea | null, variant: 0 | 1 = 0,
): GroundWay | null {
  const za = aVia ? null : aZone ?? offAreaAt(s, a[0], a[1]);
  const zb = bVia ? null : bZone ?? offAreaAt(s, b[0], b[1]);
  const OFF = 1 / ROAD.offroad;
  if (za && zb && za.id === zb.id) return { pts: [a, b], w: [OFF] };
  // the road ends: each end's cell, or a gate of its area (the pair the quickest way)
  const ends = (p: [number, number], zone: ZoneState | OffArea | null, via: Cell | null | undefined): Cell[] =>
    zone ? areaGates(s, zone) : [via ?? cellAt(p[0], p[1])];
  const as = ends(a, za, aVia), bs = ends(b, zb, bVia);
  if (!as.length || !bs.length) return null;
  let best: { ga: Cell; gb: Cell; t: number } | null = null;
  // one end cell each (neither in a zone, or a zone with one gate): no search for the pair
  if (as.length === 1 && bs.length === 1) best = { ga: as[0], gb: bs[0], t: 0 };
  else for (const gb of bs) {
    const dist = roadDistances(s, gb);
    const tb = zb ? Math.hypot(...sub(cellCentre(...gb), b)) * OFF : 0;
    for (const ga of as) {
      const n = ga[0] === gb[0] && ga[1] === gb[1] ? 0 : dist.get(cellKey(ga[0], ga[1]));
      if (n === undefined) continue;
      const t = (za ? Math.hypot(...sub(cellCentre(...ga), a)) * OFF : 0) + n * CELL_M + tb;
      if (!best || t < best.t - 1e-9) best = { ga, gb, t };
    }
  }
  if (!best) return null;
  const cells = best.ga[0] === best.gb[0] && best.ga[1] === best.gb[1] ? [best.ga] : roadRoute(s, best.ga, best.gb, variant);
  if (!cells) return null;
  const pts: [number, number][] = [a];
  const w: number[] = [];
  const push = (p: [number, number], wt: number) => {
    const l = pts[pts.length - 1];
    if (Math.hypot(p[0] - l[0], p[1] - l[1]) <= 1e-6) return;
    pts.push(p); w.push(wt);
  };
  // off-road to the gate it leaves by; out by its via cell; or on along the road from the cell it stands in
  if (za) push(cellCentre(...best.ga), OFF);
  else if (aVia) push(cellCentre(...aVia), 1);
  for (let i = 1; i < cells.length - 1; i++) push(cellCentre(...cells[i]), 1);
  if (zb) { if (cells.length > 1) push(cellCentre(...best.gb), 1); push(b, OFF); }
  else { if (bVia && cells.length > 1) push(cellCentre(...bVia), 1); push(b, 1); }
  return za || zb ? { pts, w } : { pts };
}
const sub = (p: [number, number], q: [number, number]): [number, number] => [p[0] - q[0], p[1] - q[1]];

/** Where a structure inside a zone is worked from (null: it is not in one):
 *  its zone, the gate nearest it (null: no gate yet), and the off-road point
 *  it is worked at — its door cell's centre, or off a field structure's wall
 *  nearest that gate. */
export function zoneStand(s: GameState, b: Placed): { zone: ZoneState; gate: Cell | null; x: number; z: number } | null {
  const d = doorCell(b);
  const r = footprintRect(b);
  const [cgx, cgz] = d ?? [Math.floor((r.gx0 + r.gx1) / 2), Math.floor((r.gz0 + r.gz1) / 2)];
  const zone = zoneOfCell(s, cgx, cgz);
  if (!zone) return null;
  const gates = gatesOf(s, zone);
  let [px, pz] = cellCentre(cgx, cgz);
  let gate: Cell | null = null, bd = Infinity;
  for (const g of gates) {
    const [gx, gz] = cellCentre(...g);
    const dd = Math.hypot(gx - px, gz - pz);
    if (dd < bd - 1e-9) { bd = dd; gate = g; }
  }
  if (!d && gate) {
    // a field structure: the point off its wall nearest the gate
    const [gx, gz] = cellCentre(...gate);
    const x0 = r.gx0 * CELL_M - MAP_M / 2, x1 = r.gx1 * CELL_M - MAP_M / 2;
    const z0 = r.gz0 * CELL_M - MAP_M / 2, z1 = r.gz1 * CELL_M - MAP_M / 2;
    const cx = Math.max(x0, Math.min(x1, gx)), cz = Math.max(z0, Math.min(z1, gz));
    const ux = gx - cx, uz = gz - cz, l = Math.hypot(ux, uz) || 1;
    [px, pz] = [cx + (ux / l) * 2, cz + (uz / l) * 2];
  }
  return { zone, gate, x: px, z: pz };
}

/** m either side of a mast's way out that still counts as on it (a slot's
 *  lane beside the stand, a unit stopped short on the way) */
const MAST_LANE = 4;

/** Where an off-road type (a Relay Mast) is worked from (docs/15 §5b): the
 *  open road cell nearest it (its gate — never a bay, the closed apron or
 *  another structure's door; with no road yet, the Lander apron's stub end),
 *  and the clear cell beside it that gate reaches straightest (its stand: a
 *  rover drives there off-road, and works from it). The pair is the shortest
 *  leg whose straight line crosses no footprint (else the shortest). Null:
 *  not an off-road type, one inside a zone with a gate (the zone's way on,
 *  zoneStand), or no road at all. Memoised on the network and the buildings. */
export interface MastStand { gate: Cell; x: number; z: number; area: OffArea; offM: number }
const mastMemo = new WeakMap<RoadCell[], { key: string; at: Map<string, MastStand | null> }>();

export function mastStand(s: GameState, b: Placed): MastStand | null {
  if (!OFFROAD_TYPES.has(b.type) || !s.roads) return null;
  const key = layoutKey(s);
  let m = mastMemo.get(s.roads);
  if (!m || m.key !== key) { m = { key, at: new Map() }; mastMemo.set(s.roads, m); }
  const at = `${b.gx},${b.gz},${b.rot}`;
  if (m.at.has(at)) return m.at.get(at)!;
  const out = findMastStand(s, b);
  m.at.set(at, out);
  return out;
}

function findMastStand(s: GameState, b: Placed): MastStand | null {
  if (zoneStand(s, b)?.gate) return null;
  const map = roadMap(s);
  const blocked = occupied(s, b);
  const sources = openSources(s, doorKeys(s, b));
  if (!sources.length) return null;
  const stands = ringCells(b, 1).filter(([x, z]) => {
    const k = cellKey(x, z);
    const c = map.get(k);
    return inMap(x, z) && !blocked.has(k) && !c?.bay && !c?.closed;
  });
  if (!stands.length) return null;
  const pairs: { g: number; st: Cell; d: number }[] = [];
  for (const st of stands) {
    const [sx, sz] = cellCentre(st[0], st[1]);
    for (const g of sources) {
      const [gx, gz] = cellCentre(...keyCell(g));
      pairs.push({ g, st, d: Math.hypot(gx - sx, gz - sz) });
    }
  }
  pairs.sort((p, q) => p.d - q.d || p.g - q.g || cellKey(...p.st) - cellKey(...q.st));
  // the straight leg crosses no footprint (every 1 m checked, the mast's own left out)
  const rects = s.buildings.filter((o) => !(o.type === b.type && o.gx === b.gx && o.gz === b.gz)).map(footprintRect);
  const clear = (p: { g: number; st: Cell; d: number }) => {
    const [ax, az] = cellCentre(...keyCell(p.g)), [bx, bz] = cellCentre(p.st[0], p.st[1]);
    const n = Math.ceil(p.d);
    for (let i = 1; i < n; i++) {
      const [cx, cz] = cellAt(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n);
      if (rects.some((r) => cx >= r.gx0 && cx < r.gx1 && cz >= r.gz0 && cz < r.gz1)) return false;
    }
    return true;
  };
  const best = pairs.slice(0, 64).find(clear) ?? pairs[0];
  const gate = keyCell(best.g);
  const [x, z] = cellCentre(best.st[0], best.st[1]);
  return { gate, x, z, area: { id: `mast:${b.gx},${b.gz}`, gates: [gate] }, offM: best.d };
}

/** The open network a new road may start from: not a bay, not the closed
 *  apron, not a structure's door (doors stay the ends of their spurs, so no
 *  one drives through a door another unit works or unloads at). */
function openSources(s: GameState, doors: Set<number>): number[] {
  const out: number[] = [];
  for (const c of s.roads ?? []) {
    const k = cellKey(c.gx, c.gz);
    if (isOpen(c) && !c.bay && !c.closed && !doors.has(k)) out.push(k);
  }
  return out;
}

/** Every structure's door cell (`skip`: the one being planned for). */
function doorKeys(s: GameState, skip?: Placed): Set<number> {
  const out = new Set<number>();
  for (const b of s.buildings) {
    if (skip && (b === skip || (b.type === skip.type && b.gx === skip.gx && b.gz === skip.gz && b.rot === skip.rot))) continue;
    const d = doorCell(b);
    if (d) out.add(cellKey(d[0], d[1]));
  }
  return out;
}

export interface SpurPlan {
  /** the road from the open network to the door, in order (cells already open left out) */
  cells: number[];
  /** of those, the cells not yet laid (the rest are another site's, still closed) */
  fresh: number[];
  /** parking bays beside a dock's door */
  bays: number[];
  /** why the spot has no road ('' = it has one, or needs none) */
  reason: string;
  /** a spur into an extraction zone ends at its gate (docs/19 S3): the cell and the zone's id */
  gate?: { key: number; zone: string };
}

/** per base: a second base has the same network revisions and building ids (core/stateMemo.ts) */
const planMemos = perState(() => new Map<string, SpurPlan>());

/** The road a structure placed here would need (memoised on the network). */
export function planSpur(s: GameState, hf: Heights, b: Placed): SpurPlan {
  const none: SpurPlan = { cells: [], fresh: [], bays: [], reason: '' };
  if (!hasRoads(s)) return none;
  const key = `${b.type},${b.gx},${b.gz},${b.rot}|${s.roadRev ?? 0},${s.roads!.length}|${s.nextBuildingId},${s.buildings.length}|z${s.zones?.length ?? 0}|t${s.terrain?.rev ?? 0}`;
  const memo = planMemos(s);
  const hit = memo.get(key);
  if (hit) return hit;
  const out = planFresh(s, hf, b);
  if (memo.size > 400) memo.clear();
  memo.set(key, out);
  return out;
}

/** A field type's way round a missing road: its field's edge, else a road's side. */
function fieldFix(s: GameState, t: BuildingId): string {
  const name = BUILDINGS[t].name;
  const served = servedFields(s);
  return s.buildings.some((o) => o.type === t && served.has(o.id))
    ? `set it edge to edge with a served ${name} (no road needed)`
    : `set it within a cell of a road`;
}

function planFresh(s: GameState, hf: Heights, b: Placed): SpurPlan {
  const map = roadMap(s);
  // a Relay Mast needs no road: its rover drives out to it off-road and works
  // it from a free cell beside it (mastStand)
  if (OFFROAD_TYPES.has(b.type)) {
    const blocked = occupied(s, b);
    const room = ringCells(b, 1).some(([x, z]) => {
      const c = map.get(cellKey(x, z));
      return inMap(x, z) && !blocked.has(cellKey(x, z)) && !c?.bay && !c?.closed;
    });
    return { cells: [], fresh: [], bays: [], reason: room ? '' : 'NO ROOM BESIDE IT — its rover works it from a free cell beside it' };
  }
  const blocked = occupied(s, b);
  const doors = doorKeys(s, b);
  // a new road runs through no one's door, and never inside an extraction zone (core/zones.ts)
  for (const k of doors) blocked.add(k);
  for (const k of zoneCells(s).keys()) if (!map.has(k)) blocked.add(k);
  const sources = openSources(s, doors);
  let targets: number[];
  // inside a zone: its road stops at the zone's rim, the drive on off-road
  const inZone = zoneStand(s, b);
  if (inZone) {
    // a dock parks its rovers on the road: not inside a zone
    if (DOCK_TYPES.has(b.type)) {
      const who = BUILDINGS[b.type].bots ? 'a dock parks its rovers' : 'a hub parks its units';
      return { cells: [], fresh: [], bays: [], reason: `IN AN EXTRACTION ZONE — ${who} on the road; set its front outside the deposit's ring` };
    }
    // its door needs no road, but a rover must stand there
    const d = doorCell(b);
    if (d && (!inMap(d[0], d[1]) || occupied(s).has(cellKey(d[0], d[1])))) {
      return { cells: [], fresh: [], bays: [], reason: 'NO ROOM AT ITS DOOR — its front is against a structure; R rotates' };
    }
    if (FIELD_TYPES.has(b.type) && inZone.gate) return { cells: [], fresh: [], bays: [], reason: '' };
    const sink = rimTargets(s, inZone.zone, blocked, inZone.x, inZone.z);
    if (!sink.size) return { cells: [], fresh: [], bays: [], reason: 'NO ROAD ROUTE — no ground on the rim of its zone for a road to stop at' };
    const found = search(s, hf, sources, new Set(sink.keys()), blocked, { sink });
    if (!found) return { cells: [], fresh: [], bays: [], reason: 'NO ROAD ROUTE — no road can reach the rim of its zone (walled in, or too steep)' };
    const cells = found.path.filter((k) => !isOpen(map.get(k)));
    return { cells, fresh: cells.filter((k) => !map.has(k)), bays: [], reason: '', gate: { key: found.end, zone: inZone.zone.id } };
  }
  if (FIELD_TYPES.has(b.type)) {
    if (fieldReached(s, b)) return { cells: [], fresh: [], bays: [], reason: '' };
    targets = ringCells(b).filter(([x, z]) => inMap(x, z) && !blocked.has(cellKey(x, z)) && !map.get(cellKey(x, z))?.closed).map(([x, z]) => cellKey(x, z));
    if (!targets.length) return { cells: [], fresh: [], bays: [], reason: `NO ROAD ROUTE — boxed in: no ground beside it for a road; ${fieldFix(s, b.type)}` };
  } else {
    const d = doorCell(b)!;
    const dk = cellKey(d[0], d[1]);
    if (!inMap(d[0], d[1])) return { cells: [], fresh: [], bays: [], reason: 'NO ROAD ROUTE — its door (the front) is off the map; R rotates' };
    if (blocked.has(dk)) return { cells: [], fresh: [], bays: [], reason: 'NO ROAD ROUTE — its door (the front) is against a structure; R rotates' };
    if (map.get(dk)?.bay || map.get(dk)?.closed) return { cells: [], fresh: [], bays: [], reason: 'NO ROAD ROUTE — its door would open onto the Lander’s apron; R rotates' };
    if (doors.has(dk)) return { cells: [], fresh: [], bays: [], reason: 'NO ROAD ROUTE — its door would share another structure’s door; R rotates' };
    blocked.delete(dk);
    targets = [dk];
  }
  const found = search(s, hf, sources, new Set(targets), blocked);
  let path = found?.path;
  if (!path) {
    const field = FIELD_TYPES.has(b.type);
    return { cells: [], fresh: [], bays: [], reason: !sources.length
      ? 'NO ROAD ROUTE — no open road to start from'
      : field ? `NO ROAD ROUTE — no road can reach its edge (walled in, or steps over ${ROAD.maxStep} m); ${fieldFix(s, b.type)}`
      : 'NO ROAD ROUTE — the rovers cannot reach it by road (walled in, or too steep)' };
  }
  let cells = path.filter((k) => !isOpen(map.get(k)));
  let fresh = cells.filter((k) => !map.has(k));
  const bays: number[] = [];
  if (DOCK_TYPES.has(b.type) && b.type !== 'lander') {
    // parking beside the door, along the front: left, then right
    const d = doorCell(b)!;
    const [fx, fz] = frontDir(b);
    const side = (taken: Set<number>) => [-1, 1].map((sd) => cellKey(d[0] + sd * -fz, d[1] + sd * fx))
      .filter((k) => { const [bx, bz] = keyCell(k); return inMap(bx, bz) && !taken.has(k) && !map.has(k); });
    bays.push(...side(new Set([...blocked, ...path])));
    if (!bays.length) {
      // the road came in beside the door and took the only ground for a bay (the pad's flattening
      // can tip an equal choice the other way after the check): route round the parking cells
      const spare = side(blocked);
      const again = spare.length ? search(s, hf, sources, new Set(targets), new Set([...blocked, ...spare])) : null;
      if (again) {
        path = again.path;
        cells = path.filter((k) => !isOpen(map.get(k)));
        fresh = cells.filter((k) => !map.has(k));
        bays.push(...side(new Set([...blocked, ...path])));
      }
    }
    // a dock parks its rovers beside its door: with no room for a bay (its road along its
    // front, a structure or an extraction zone beside it) it has nowhere to put them
    if (!bays.length) return { cells: [], fresh: [], bays: [], reason: 'NO ROOM FOR ITS PARKING BAYS — beside its door is road, a structure or a deposit\'s ring; R rotates' };
  }
  return { cells, fresh, bays, reason: '' };
}

// ───────────────────────────── reach (for siting) ─────────────────────────────

const reachMemo = new WeakMap<RoadCell[], { key: string; cells: Uint8Array }>();

/** Every cell a new road could reach from the open network, walked as the A*
 *  walks: footprints, doors, bays and the closed apron are walls, and so is a
 *  step steeper than ROAD.maxStep. 1 = reachable, by cell key. A new
 *  structure's own footprint is not a wall here, so this is a superset: a spot
 *  whose road would end outside it has no route, and the A* still has the last
 *  word on the rest. Memoised on the network and the buildings. */
export function roadReach(s: GameState, hf: Heights): Uint8Array {
  const list = s.roads;
  const key = layoutKey(s);
  const hit = list ? reachMemo.get(list) : undefined;
  if (hit && hit.key === key) return hit.cells;
  const out = new Uint8Array(MAP_CELLS * MAP_CELLS);
  if (list) {
    const map = roadMap(s);
    const doors = doorKeys(s);
    const blocked = occupied(s);
    for (const k of doors) blocked.add(k);
    const height = new Float32Array(MAP_CELLS * MAP_CELLS).fill(NaN);
    const hAt = (k: number) => {
      if (Number.isNaN(height[k])) { const [x, z] = keyCell(k); height[k] = hf.sample(...cellCentre(x, z)); }
      return height[k];
    };
    const q = openSources(s, doors);
    for (const k of q) out[k] = 1;
    for (let i = 0; i < q.length; i++) {
      const k = q[i];
      const [x, z] = keyCell(k);
      for (const [dx, dz] of N4) {
        const nx = x + dx, nz = z + dz;
        if (!inMap(nx, nz)) continue;
        const nk = cellKey(nx, nz);
        if (out[nk] || blocked.has(nk)) continue;
        const road = map.get(nk);
        if (road?.bay || road?.closed) continue;
        if (!road && hf.noRoad?.(nx, nz)) continue;
        if (Math.abs(hAt(nk) - hAt(k)) > ROAD.maxStep) continue;
        out[nk] = 1;
        q.push(nk);
      }
    }
    reachMemo.set(list, { key, cells: out });
  }
  return out;
}

/** A cheap "no road can get there" for a spot (true: certainly none), before
 *  the A*: a field type not served already whose ring holds no reachable
 *  cell, or a door outside the reach. False: the spot needs no road, or one
 *  may reach it (planSpur decides). */
export function spurHopeless(s: GameState, hf: Heights, b: Placed): boolean {
  if (!hasRoads(s) || OFFROAD_TYPES.has(b.type)) return false;
  const reach = roadReach(s, hf);
  if (FIELD_TYPES.has(b.type)) {
    if (fieldReached(s, b)) return false;
    return !ringCells(b).some(([x, z]) => inMap(x, z) && reach[cellKey(x, z)] === 1);
  }
  const d = doorCell(b)!;
  return inMap(d[0], d[1]) && reach[cellKey(d[0], d[1])] !== 1;
}

/** Lay a structure's spur (and a dock's bays); `open`: already sintered (the
 *  Lander's apron, a migrated save). Returns the cells still to sinter. */
export function laySpur(s: GameState, hf: Heights, b: BuildingState, open = false): number {
  if (!hasRoads(s)) return 0;
  const p = planSpur(s, hf, b);
  if (p.reason) return 0;
  const map = roadMap(s);
  for (const k of p.fresh) {
    const [gx, gz] = keyCell(k);
    s.roads!.push({ gx, gz, left: open ? 0 : ROAD.cellS });
  }
  for (const k of p.bays) {
    const [gx, gz] = keyCell(k);
    s.roads!.push({ gx, gz, left: open ? 0 : ROAD.cellS, bay: true });
  }
  if (open) for (const k of p.cells) { const c = map.get(k); if (c) c.left = 0; }
  // a spur into a zone ends at its gate, marked (docs/19 S3)
  if (p.gate) { const c = roadMap(s).get(p.gate.key); if (c && throughCell(c)) c.gate = p.gate.zone; }
  b.spur = open ? [] : [...p.cells, ...p.bays];
  bumpRoads(s);
  return b.spur.length;
}

/** The Lander's apron and stub, open (a new landing). */
export function layApron(s: GameState, lander: BuildingState) {
  s.roads ??= [];
  s.roadJobs ??= [];
  s.roadSchema = 1;
  const d = doorCell(lander)!;
  const [fx, fz] = frontDir(lander);
  const px = -fz, pz = fx; // along the front
  const blocked = occupied(s);
  const map = roadMap(s);
  for (const a of APRON) {
    const gx = d[0] + a.dx * px + a.dz * fx, gz = d[1] + a.dx * pz + a.dz * fz;
    const k = cellKey(gx, gz);
    if (!inMap(gx, gz) || blocked.has(k) || map.has(k)) continue;
    s.roads.push({ gx, gz, left: 0, ...(a.bay ? { bay: true } : a.end ? {} : { closed: true }) });
  }
  lander.spur = [];
  bumpRoads(s);
}

/** A demolished structure: the road it was still waiting for goes, unless
 *  another site's or job's road runs through it. Open road stays. */
export function dropSpur(s: GameState, b: BuildingState) {
  if (!hasRoads(s) || !b.spur?.length) return;
  const keep = new Set<number>();
  for (const o of s.buildings) if (o.id !== b.id) for (const k of o.spur ?? []) keep.add(k);
  for (const j of s.roadJobs ?? []) for (const k of j.cells) keep.add(k);
  const map = roadMap(s);
  const gone = new Set(b.spur.filter((k) => !keep.has(k) && !isOpen(map.get(k))));
  if (!gone.size) return;
  s.roads = s.roads!.filter((c) => !gone.has(cellKey(c.gx, c.gz)));
  bumpRoads(s);
}

// ───────────────────────────── sintering ─────────────────────────────

/** The cells a site still needs before it can weld. */
export function spurLeft(s: GameState, b: BuildingState): number {
  if (!b.spur?.length) return 0;
  const map = roadMap(s);
  let n = 0;
  for (const k of b.spur) if (!isOpen(map.get(k))) n++;
  return n;
}

/** Rover-seconds of road a site still needs. */
export function spurSeconds(s: GameState, b: BuildingState): number {
  if (!b.spur?.length) return 0;
  const map = roadMap(s);
  let t = 0;
  for (const k of b.spur) { const c = map.get(k); if (c && !isOpen(c)) t += c.left; }
  return t;
}

/** Where sintering goes on along a list of cells: the first closed one a rover
 *  can work (one with open road beside it, its predecessor's first), and the
 *  open cell it is worked from. A haul road planned from a hub's door lists
 *  its cells door first, so a cell that waits on the ones after it is skipped;
 *  with none workable, the first closed cell and no cell to work it from. */
export function frontierOf(s: GameState, cells: readonly number[]): { cell: RoadCell; from: Cell | null } | null {
  const map = roadMap(s);
  let first: { cell: RoadCell; from: Cell | null } | null = null;
  for (let i = 0; i < cells.length; i++) {
    const c = map.get(cells[i]);
    if (!c || isOpen(c)) continue;
    // worked from the previous cell of its road, else any open neighbour
    let from: Cell | null = null;
    const prev = i > 0 ? map.get(cells[i - 1]) : undefined;
    if (prev && isOpen(prev) && !prev.bay) from = [prev.gx, prev.gz];
    else {
      for (const [dx, dz] of N4) {
        const n = map.get(cellKey(c.gx + dx, c.gz + dz));
        if (n && isOpen(n) && !n.bay) { from = [n.gx, n.gz]; break; }
      }
    }
    if (from) return { cell: c, from };
    first ??= { cell: c, from: null };
  }
  return first;
}

/** Sinter along `cells` for `amount` rover-seconds; true if a cell opened. */
export function sinter(s: GameState, cells: readonly number[], amount: number): boolean {
  let opened = false;
  while (amount > 1e-9) {
    const f = frontierOf(s, cells);
    if (!f || !f.from) break;
    const d = Math.min(f.cell.left, amount);
    f.cell.left -= d;
    amount -= d;
    if (f.cell.left <= 1e-9) { f.cell.left = 0; opened = true; bumpRoads(s); }
  }
  return opened;
}

// ───────────────────────────── jobs: drawn roads, haul roads ─────────────────────────────

export interface Ring { x: number; z: number; r: number }

export interface LinkPlan {
  /** the cells still to lay or sinter, in order from the network (the bays of a haul road last) */
  cells: number[];
  /** of those, the cells not yet laid (the rest are another site's, still closed) */
  fresh: number[];
  reason: string;
  // ── a road into an extraction zone (docs/19 S3) ──
  /** the whole route, its source (a hub's door) first: open cells included */
  route?: number[];
  /** where it stops: the cell that becomes the zone's gate */
  gate?: { key: number; zone: string };
  /** a new holding bay beside the gate; new passing bays beside the route (both also in `cells`) */
  hold?: number;
  pass?: number[];
  /** no room beside the gate for a holding bay: this passing bay beside it (laid already) serves as one */
  holdFlag?: number;
  /** the new cells inside the pit's full-size ring: the pit consumes them */
  sacrificial?: number[];
}

/** What a road is planned with. */
export interface LinkOpts {
  /** a haul road: planned from this structure's door (its front is the way out), merging into the
   *  network at 0.05 a cell, not from wherever on the open network building is cheapest */
  hub?: Placed;
  /** the full-size pit rings of the other targets: a new cell inside one costs ROAD.ringSoft (docs/17 §5.3) */
  rings?: readonly Ring[];
  /** the target's own full-size ring: the tail cells of the road inside it are sacrificial (docs/17 §11.4) */
  ring?: Ring | null;
}

/** A road from road cell `a` to cell `b`: the road tool's (`a` given: the
 *  player may draw it anywhere, into a zone too), or an auto road (`a` null:
 *  a haul road) — from the network, or from a hub's door (`opts.hub`) — which
 *  never runs inside an extraction zone and, for a `b` inside one, stops at the
 *  zone's rim on the hub's side (the dig is reached off-road from there;
 *  core/zones.ts): the plan carries its gate, holding bay and passing bays. */
export function planLink(s: GameState, hf: Heights, a: Cell | null, b: Cell, opts: LinkOpts = {}): LinkPlan {
  const fail = (reason: string): LinkPlan => ({ cells: [], fresh: [], reason });
  if (!hasRoads(s)) return fail('NO ROADS ON THIS BASE');
  const map = roadMap(s);
  const blocked = occupied(s);
  const doors = doorKeys(s);
  const bk = cellKey(b[0], b[1]);
  if (!inMap(b[0], b[1])) return fail('OUTSIDE THE SURVEY AREA');
  if (doors.has(bk) || map.get(bk)?.closed) return fail('AT A DOOR — a door is the end of its own road; end beside it');
  if (blocked.has(bk)) return fail('UNDER A STRUCTURE — end the road on open ground');
  const zone = a ? null : zoneOfCell(s, b[0], b[1]);
  if (!a) for (const k of zoneCells(s).keys()) if (!map.has(k)) blocked.add(k);
  // a haul road leaves its hub's door (a door that is on the road)
  const door = !a && opts.hub ? doorCell(opts.hub) : null;
  const from = door && map.has(cellKey(door[0], door[1])) ? cellKey(door[0], door[1]) : -1;
  const facing = from >= 0 ? frontDir(opts.hub!) : undefined;
  const hubPt = door ? cellCentre(door[0], door[1]) : undefined;
  const rings = opts.rings ?? [];
  const soft = rings.length ? (k: number) => {
    const [x, z] = cellCentre(...keyCell(k));
    let c = 0;
    for (const r of rings) if (Math.hypot(x - r.x, z - r.z) < r.r) c += ROAD.ringSoft;
    return c;
  } : undefined;
  if (zone) {
    for (const k of doors) blocked.add(k);
    const [bx, bz] = cellCentre(b[0], b[1]);
    const sink = rimTargets(s, zone, blocked, bx, bz, hubPt);
    const found = sink.size ? search(s, hf, from >= 0 ? [from] : openSources(s, doors), new Set(sink.keys()), blocked, { sink, facing, soft }) : null;
    if (!found) return fail('NO ROAD ROUTE — no road can reach the rim of its zone (walled in, or too steep)');
    const path = found.path;
    const cells = path.filter((k) => !isOpen(map.get(k)));
    const fresh = cells.filter((k) => !map.has(k));
    const route = from >= 0 ? [from, ...path] : path.length ? path : [found.end];
    const ex = haulExtras(s, hf, route, zone, blocked, opts.ring ?? null, new Set(fresh), opts.hub);
    return {
      cells: [...cells, ...(ex.hold >= 0 ? [ex.hold] : []), ...ex.pass],
      fresh: [...fresh, ...(ex.hold >= 0 ? [ex.hold] : []), ...ex.pass],
      reason: '', route, gate: { key: found.end, zone: zone.id },
      ...(ex.hold >= 0 ? { hold: ex.hold } : {}), ...(ex.holdFlag >= 0 ? { holdFlag: ex.holdFlag } : {}), pass: ex.pass, sacrificial: ex.sacrificial,
    };
  }
  let sources: number[];
  if (a) {
    const ak = cellKey(a[0], a[1]);
    const c = map.get(ak);
    if (!c || c.bay) return fail('START ON A ROAD — drag out from an open road cell');
    if (c.closed || doors.has(ak)) return fail('START ELSEWHERE — no road branches off a door or the Lander’s apron');
    sources = [ak];
  } else {
    sources = from >= 0 ? [from] : openSources(s, doors);
  }
  for (const k of doors) if (k !== bk) blocked.add(k);
  const found = search(s, hf, sources, new Set([bk]), blocked, { facing, soft });
  if (!found) return fail('NO ROAD ROUTE — walled in, or too steep for a road');
  const cells = found.path.filter((k) => !isOpen(map.get(k)));
  return { cells, fresh: cells.filter((k) => !map.has(k)), reason: '' };
}

/** A route from open road cell `a` through `via` (waypoints) to the last: one
 *  road, each leg planned from the end of the one before (the road tool's
 *  waypoints, docs/19 S3). A leg may run over the legs before it. */
export function planPath(s: GameState, hf: Heights, a: Cell, via: readonly Cell[]): LinkPlan {
  let cur = s;
  let at = a;
  const cells: number[] = [], fresh: number[] = [];
  for (const b of via) {
    const leg = planLink(cur, hf, at, b);
    if (leg.reason) return leg;
    for (const k of leg.cells) if (!cells.includes(k)) cells.push(k);
    for (const k of leg.fresh) if (!fresh.includes(k)) fresh.push(k);
    if (leg.cells.length) {
      // the next leg starts on this one: its new cells stand in as open road
      cur = { ...cur, roads: [...(cur.roads ?? []), ...leg.fresh.map((k) => { const [gx, gz] = keyCell(k); return { gx, gz, left: 0 }; })] };
    }
    at = b;
  }
  return { cells, fresh, reason: '' };
}

/** The extras of a haul road (docs/19 S3): a holding bay beside its gate; a
 *  passing bay beside about every 10th cell of its route and beside the gate's
 *  approach; the tail of new cells inside the pit's full-size ring, which the
 *  pit consumes. Bays are plain open cells beside the road, never `bay`. */
function haulExtras(
  s: GameState, hf: Heights, route: number[], zone: ZoneState, blocked: Set<number>, ring: Ring | null, fresh: Set<number>, self?: Placed,
): { hold: number; pass: number[]; sacrificial: number[]; holdFlag: number } {
  const map = roadMap(s);
  const onRoute = new Set(route);
  const taken = new Set<number>();
  const at = (gx: number, gz: number) => hf.sample(...cellCentre(gx, gz));
  /** a free cell beside `near`: on the map, open ground, level enough for a road */
  const free = (gx: number, gz: number, near: number) => {
    if (!inMap(gx, gz)) return false;
    const k = cellKey(gx, gz);
    if (blocked.has(k) || map.has(k) || onRoute.has(k) || taken.has(k)) return false;
    if (hf.noRoad?.(gx, gz)) return false;
    const [nx, nz] = keyCell(near);
    return Math.abs(at(gx, gz) - at(nx, nz)) <= ROAD.maxStep;
  };
  const step = (a: number, b: number): Cell => { const [ax, az] = keyCell(a), [bx, bz] = keyCell(b); return [Math.sign(bx - ax), Math.sign(bz - az)]; };
  /** the cells either side of `k` across the way `d` runs */
  const beside = (k: number, d: Cell): number[] => {
    const [x, z] = keyCell(k);
    return [cellKey(x - d[1], z + d[0]), cellKey(x + d[1], z - d[0])];
  };
  const n = route.length;
  const G = route[n - 1];
  let hold = -1;
  let holdSide = 0;
  // the gate's approach: the way the last step ran (or, reaching a gate laid already, from the road it stands on)
  let prev = n > 1 ? route[n - 2] : -1;
  if (prev < 0) {
    const [gx, gz] = keyCell(G);
    for (const [dx, dz] of N4) {
      const k = cellKey(gx + dx, gz + dz);
      const c = map.get(k);
      if (c && isOpen(c) && throughCell(c) && !zoneCells(s).has(k)) { prev = k; break; }
    }
  }
  if (prev >= 0) {
    const d = step(prev, G);
    const heldAlready = N4.some(([dx, dz]) => { const [gx, gz] = keyCell(G); return map.get(cellKey(gx + dx, gz + dz))?.hold === zone.id; });
    if (!heldAlready) {
      for (const base of [G, prev]) {
        const opts = beside(base, d);
        const side = opts.findIndex((k) => { const [x, z] = keyCell(k); return free(x, z, base); });
        if (side >= 0) { hold = opts[side]; holdSide = side ? -1 : 1; taken.add(hold); break; }
      }
    }
  }
  // no free ground beside the gate: a passing bay laid already beside it serves as the holding bay
  let holdFlag = -1;
  if (hold < 0 && prev >= 0 && !N4.some(([dx, dz]) => { const [gx, gz] = keyCell(G); return map.get(cellKey(gx + dx, gz + dz))?.hold === zone.id; })) {
    const [gx, gz] = keyCell(G);
    for (const [dx, dz] of N4) {
      const k = cellKey(gx + dx, gz + dz);
      if (map.get(k)?.pass) { holdFlag = k; break; }
    }
  }
  const pass: number[] = [];
  const isPass = (k: number) => map.get(k)?.pass === true || pass.includes(k);
  const covered = route.map((k) => beside(k, [1, 0]).concat(beside(k, [0, 1])).some((q) => isPass(q)));
  const place = (i: number): boolean => {
    if (i < 1 || i > n - 2) return false;
    const d = step(route[i - 1], route[i]), e = step(route[i], route[i + 1]);
    if (d[0] !== e[0] || d[1] !== e[1]) return false;
    for (const q of beside(route[i], d)) {
      const [x, z] = keyCell(q);
      if (!free(x, z, route[i])) continue;
      pass.push(q); taken.add(q); covered[i] = true;
      return true;
    }
    return false;
  };
  // beside the gate's approach: the far side from the holding bay
  if (n >= 3 && !covered[n - 2] && !covered[n - 3]) {
    const d = step(route[n - 3], route[n - 2]);
    const opts = beside(route[n - 2], d);
    const order = holdSide > 0 ? [opts[1], opts[0]] : [opts[0], opts[1]];
    for (const q of order) {
      const [x, z] = keyCell(q);
      if (!free(x, z, route[n - 2])) continue;
      pass.push(q); taken.add(q); covered[n - 2] = true;
      break;
    }
  }
  // along the way: one about every ROAD.passEvery cells, slid to a straight cell with room beside it
  let gap = 0;
  for (let i = 2; i < n - 3; i++) {
    if (covered[i]) { gap = 0; continue; }
    if (++gap < ROAD.passEvery) continue;
    for (const o of [0, -1, 1, -2, 2]) {
      if (Math.abs(o) > ROAD.passSlide || i + o < 2 || i + o >= n - 3) continue;
      if (place(i + o)) { gap = Math.max(0, -o); break; }
    }
  }
  // the tail of the route inside the pit's full-size ring (and the pit's road setback past it): the pit
  // eats it and the gate steps back. New cells, and cells laid before that are a dead end leading only here
  // (the hub's own spur along the ring): never a door, a branch, or another site's road still to sinter.
  const sacrificial: number[] = [];
  if (ring) {
    const reach = ring.r + (PIT.roadRings + 1) * CELL_M;
    const inside = (k: number) => { const [x, z] = cellCentre(...keyCell(k)); return Math.hypot(x - ring.x, z - ring.z) < reach; };
    const doors = doorKeys(s);
    const others = new Set<number>();
    for (const b of s.buildings) {
      if (self && b.type === self.type && b.gx === self.gx && b.gz === self.gz && b.rot === self.rot) continue;
      for (const k of b.spur ?? []) others.add(k);
    }
    const extras = new Set<number>([...(hold >= 0 ? [hold] : []), ...pass]);
    const deadEnd = (i: number) => {
      const [x, z] = keyCell(route[i]);
      return N4.every(([dx, dz]) => {
        const q = cellKey(x + dx, z + dz);
        if (q === route[i - 1] || q === route[i + 1] || extras.has(q)) return true;
        const c = map.get(q);
        return !c || !!c.pass || !!c.hold;
      });
    };
    for (let i = n - 1; i >= 0 && inside(route[i]); i--) {
      const k = route[i], c = map.get(k);
      if (!fresh.has(k) && (!c || c.closed || c.bay || doors.has(k) || others.has(k) || !deadEnd(i))) break;
      sacrificial.push(k);
    }
    for (const k of extras) if (inside(k)) sacrificial.push(k);
  }
  return { hold, pass, sacrificial, holdFlag };
}

/** Lay a plan's cells, and its marks: the gate (an open cell laid before may
 *  become one), the holding bay, the passing bays and the sacrificial tail.
 *  `open`: sintered already (tests and the debug switch). */
export function layPlan(s: GameState, plan: LinkPlan, open = false) {
  if (!hasRoads(s) || plan.reason) return;
  const sac = new Set(plan.sacrificial ?? []);
  const pass = new Set(plan.pass ?? []);
  for (const k of plan.fresh) {
    const [gx, gz] = keyCell(k);
    const c: RoadCell = { gx, gz, left: open ? 0 : ROAD.cellS };
    if (k === plan.hold && plan.gate) c.hold = plan.gate.zone;
    if (pass.has(k)) c.pass = true;
    if (sac.has(k)) c.sacrificial = true;
    s.roads!.push(c);
  }
  const map = roadMap(s);
  for (const k of sac) { const c = map.get(k); if (c && !c.bay && !c.closed) c.sacrificial = true; }
  if (plan.holdFlag !== undefined && plan.gate) { const c = map.get(plan.holdFlag); if (c) c.hold = plan.gate.zone; }
  if (plan.gate) {
    const c = map.get(plan.gate.key);
    if (c && throughCell(c)) c.gate = plan.gate.zone;
  }
  bumpRoads(s);
}

/** Lay a job's road; returns its id (0: nothing to lay). */
export function layJob(s: GameState, plan: LinkPlan, kind: RoadJob['kind'], by?: number): number {
  if (!hasRoads(s) || plan.reason) return 0;
  layPlan(s, plan);
  if (kind === 'draw' && plan.cells.length) markDrawnGate(s, plan.cells[plan.cells.length - 1]);
  if (!plan.cells.length) return 0;
  s.roadJobs ??= [];
  s.nextRoadJob ??= 1;
  const id = s.nextRoadJob++;
  s.roadJobs.push({ id, kind, cells: [...plan.cells], ...(by !== undefined ? { by } : {}) });
  bumpRoads(s);
  return id;
}

/** A pit has eaten into a haul road (docs/19 S3, docs/17 §11.4): the
 *  sacrificial cells whose ground it cut go, each gate among them steps back to the
 *  cell before it (away from the zone), that gate gets a holding bay again, and a
 *  passing or holding bay left with no road beside it goes too. Returns the cells removed. */
export function regate(s: GameState, hf: Heights): number {
  if (!s.roads?.some((c) => c.sacrificial)) return 0;
  const map = roadMap(s);
  const gone = s.roads.filter((c) => c.sacrificial && hf.noRoad?.(c.gx, c.gz));
  if (!gone.length) return 0;
  const goneKeys = new Set(gone.map((c) => cellKey(c.gx, c.gz)));
  const stepped: { zone: string; at: Cell; sac: boolean }[] = [];
  for (const c of gone) if (c.gate) stepped.push({ zone: c.gate, at: [c.gx, c.gz], sac: true });
  let removed = removeCells(s, [...goneKeys]);
  for (const b of s.buildings) if (b.spur?.length) b.spur = b.spur.filter((k) => !goneKeys.has(k));
  // bays with no road beside them any more
  const strand = () => {
    const m = roadMap(s);
    const orphans: number[] = [];
    for (const c of s.roads ?? []) {
      if (!c.pass && !c.hold) continue;
      const has = N4.some(([dx, dz]) => { const o = m.get(cellKey(c.gx + dx, c.gz + dz)); return !!o && !o.pass && !o.hold && !o.bay; });
      if (!has) orphans.push(cellKey(c.gx, c.gz));
    }
    return orphans;
  };
  const orphans = strand();
  if (orphans.length) removed += removeCells(s, orphans);
  const zones = s.zones ?? [];
  let blocked: Set<number> | null = null;
  for (const st of stepped) {
    const zone = zones.find((z) => z.id === st.zone);
    if (!zone) continue;
    const m = roadMap(s);
    const [zx, zz] = [zone.cx, zone.cz];
    // the way back: the road cell beside it that lies farthest from the zone's centre
    let back: RoadCell | null = null, bd = -1;
    for (const [dx, dz] of N4) {
      const c = m.get(cellKey(st.at[0] + dx, st.at[1] + dz));
      if (!c || !isOpen(c) || !throughCell(c) || c.gate === zone.id) continue;
      const [cx, cz] = cellCentre(c.gx, c.gz);
      const d = Math.hypot(cx - zx, cz - zz);
      if (d > bd + 1e-9) { bd = d; back = c; }
    }
    if (!back) continue;
    back.gate = zone.id;
    // a holding bay beside the new gate, if none stands there
    const [gx, gz] = [back.gx, back.gz];
    if (N4.some(([dx, dz]) => m.get(cellKey(gx + dx, gz + dz))?.hold === zone.id)) continue;
    const away: Cell = [st.at[0] - gx, st.at[1] - gz]; // toward the zone: the way the road ran
    blocked ??= occupied(s);
    for (const k of doorKeys(s)) blocked.add(k);
    const zc = zoneCells(s);
    const [x0, z0] = cellCentre(gx, gz);
    const h0 = hf.sample(x0, z0);
    let placed = false;
    for (const sgn of [1, -1]) {
      const hx = gx - away[1] * sgn, hz = gz + away[0] * sgn;
      const k = cellKey(hx, hz);
      if (!inMap(hx, hz) || blocked.has(k) || m.has(k) || zc.has(k) || hf.noRoad?.(hx, hz)) continue;
      if (Math.abs(hf.sample(...cellCentre(hx, hz)) - h0) > ROAD.maxStep) continue;
      s.roads.push({ gx: hx, gz: hz, left: 0, hold: zone.id, ...(back.sacrificial ? { sacrificial: true } : {}) });
      placed = true;
      break;
    }
    // no room beside it (the cut, a structure): a passing bay beside the gate serves as its holding bay
    if (!placed) {
      for (const [dx, dz] of N4) {
        const c = m.get(cellKey(gx + dx, gz + dz));
        if (c?.pass && isOpen(c)) { c.hold = zone.id; break; }
      }
    }
  }
  bumpRoads(s);
  return removed;
}

/** A road the player drew that stops on a zone's rim ends at its gate. */
function markDrawnGate(s: GameState, last: number) {
  const [gx, gz] = keyCell(last);
  const c = roadMap(s).get(last);
  const cells = zoneCells(s);
  if (!c || cells.has(last) || !throughCell(c) || c.gate) return;
  for (const [dx, dz] of N4) {
    const i = cells.get(cellKey(gx + dx, gz + dz));
    if (i !== undefined) { c.gate = s.zones![i].id; return; }
  }
}

/** Jobs whose road is all open are done: dropped from the list. */
export function settleJobs(s: GameState) {
  if (!s.roadJobs?.length) return;
  const map = roadMap(s);
  s.roadJobs = s.roadJobs.filter((j) => j.cells.some((k) => { const c = map.get(k); return !!c && !isOpen(c); }));
}

export const jobOpen = (s: GameState, id: number | undefined) => id === undefined || !(s.roadJobs ?? []).some((j) => j.id === id);

/** What removing these cells would strand: structures whose door (or
 *  field edge) loses its road, and the words for the warning. */
export function strands(s: GameState, keys: readonly number[]): string[] {
  const gone = new Set(keys);
  const map = roadMap(s);
  const out: string[] = [];
  for (const b of s.buildings) {
    if (b.type === 'lander') continue;
    const d = doorCell(b);
    if (d && gone.has(cellKey(d[0], d[1])) && map.has(cellKey(d[0], d[1]))) out.push(`${BUILDINGS[b.type].name} #${b.id}`);
  }
  return out;
}

/** Remove road cells (not the apron's door cell: the Lander keeps its way out). */
export function removeCells(s: GameState, keys: readonly number[]): number {
  if (!hasRoads(s)) return 0;
  const lander = s.buildings.find((b) => b.type === 'lander');
  const d = lander ? doorCell(lander) : null;
  const keep = d ? cellKey(d[0], d[1]) : -1;
  const gone = new Set(keys.filter((k) => k !== keep));
  const before = s.roads!.length;
  s.roads = s.roads!.filter((c) => !gone.has(cellKey(c.gx, c.gz)));
  const n = before - s.roads.length;
  if (n) {
    for (const j of s.roadJobs ?? []) j.cells = j.cells.filter((k) => !gone.has(k));
    s.roadJobs = (s.roadJobs ?? []).filter((j) => j.cells.length);
    bumpRoads(s);
  }
  return n;
}

// ───────────────────────────── routes ─────────────────────────────

const routeMemos = perState(() => new Map<string, Cell[] | null>());

/** The shortest open road from cell a to cell b (both ends may be bays or
 *  closed frontier-adjacent cells; the way between is open carriageway).
 *  Null: no way. Cached on the network's revision.
 *  `variant` 1 (docs/19 S4b: a unit's id parity): among roads no more than 5%
 *  longer, the one that shares the least with the shortest, so two units use
 *  both trunks when a base has two; the shortest when there is no other. */
export function roadRoute(s: GameState, a: Cell, b: Cell, variant: 0 | 1 = 0): Cell[] | null {
  const key = `${s.roadRev ?? 0}|${a[0]},${a[1]}>${b[0]},${b[1]}${variant ? '#1' : ''}`;
  const memo = routeMemos(s);
  if (memo.has(key)) return memo.get(key)!;
  let out = bfs(s, a, b);
  if (variant && out && out.length > 3) out = alternative(s, a, b, out) ?? out;
  if (memo.size > 2000) memo.clear();
  memo.set(key, out);
  return out;
}

/** The road from a to b that leans away from `base` (its cells cost 10% more), if it is within 5% (+1 cell) of
 *  base's length; null: there is none. */
function alternative(s: GameState, a: Cell, b: Cell, base: Cell[]): Cell[] | null {
  const map = roadMap(s);
  const ak = cellKey(a[0], a[1]), bk = cellKey(b[0], b[1]);
  const used = new Set(base.map((c) => cellKey(c[0], c[1])));
  const cost = new Map<number, number>([[ak, 0]]);
  const from = new Map<number, number>([[ak, -1]]);
  // (a small binary heap on [cost, key])
  const heap: [number, number][] = [[0, ak]];
  const push = (e: [number, number]) => {
    heap.push(e);
    for (let i = heap.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [c, k] = pop();
    if (c > (cost.get(k) ?? Infinity) + 1e-9) continue;
    if (k === bk) break;
    const [x, z] = keyCell(k);
    for (const [dx, dz] of N4) {
      const nk = cellKey(x + dx, z + dz);
      const cell = map.get(nk);
      if (!cell || !isOpen(cell)) continue;
      if (nk !== bk && cell.bay) continue;
      const nc = c + (used.has(nk) ? 1.1 : 1);
      if (nc < (cost.get(nk) ?? Infinity) - 1e-9) { cost.set(nk, nc); from.set(nk, k); push([nc, nk]); }
    }
  }
  if (!from.has(bk)) return null;
  const out: Cell[] = [];
  for (let p = bk; p !== -1; p = from.get(p)!) out.push(keyCell(p));
  out.reverse();
  return out.length <= base.length * 1.05 + 1 ? out : null;
}

function bfs(s: GameState, a: Cell, b: Cell): Cell[] | null {
  const map = roadMap(s);
  const ak = cellKey(a[0], a[1]), bk = cellKey(b[0], b[1]);
  if (ak === bk) return [a];
  const from = new Map<number, number>([[ak, -1]]);
  const q = [ak];
  for (let i = 0; i < q.length; i++) {
    const k = q[i];
    const [x, z] = keyCell(k);
    for (const [dx, dz] of N4) {
      const nk = cellKey(x + dx, z + dz);
      if (from.has(nk)) continue;
      const c = map.get(nk);
      if (!c || !isOpen(c)) continue;
      if (nk !== bk && c.bay) continue;
      from.set(nk, k);
      if (nk === bk) {
        const out: Cell[] = [];
        for (let p = bk; p !== -1; p = from.get(p)!) out.push(keyCell(p));
        return out.reverse();
      }
      q.push(nk);
    }
  }
  return null;
}

const distMemos = perState(() => new Map<string, Map<number, number>>());

/** Cells by open road from cell `to` (a BFS, memoised on the network):
 *  cell key → steps, as roadRoute walks — bays only as ends, and the start
 *  may be any cell. Who is nearest a site by road (core/fleet.ts). */
export function roadDistances(s: GameState, to: Cell): Map<number, number> {
  const tk = cellKey(to[0], to[1]);
  const key = `${s.roadRev ?? 0},${s.roads?.length ?? 0}|${tk}`;
  const memo = distMemos(s);
  const hit = memo.get(key);
  if (hit) return hit;
  const map = roadMap(s);
  const dist = new Map<number, number>([[tk, 0]]);
  const q = [tk];
  for (let i = 0; i < q.length; i++) {
    const k = q[i];
    // a bay is an end: nobody drives through one
    if (i > 0 && map.get(k)?.bay) continue;
    const [x, z] = keyCell(k);
    for (const [dx, dz] of N4) {
      const nk = cellKey(x + dx, z + dz);
      if (dist.has(nk)) continue;
      if (!isOpen(map.get(nk))) continue;
      dist.set(nk, dist.get(k)! + 1);
      q.push(nk);
    }
  }
  if (memo.size > 96) memo.clear();
  memo.set(key, dist);
  return dist;
}

/** The open road cell a planned road leaves the network by: a non-bay open
 *  neighbour of its first cell (null: none). */
export function joinCell(s: GameState, first: number): Cell | null {
  const map = roadMap(s);
  const [x, z] = keyCell(first);
  for (const [dx, dz] of N4) {
    const c = map.get(cellKey(x + dx, z + dz));
    if (c && isOpen(c) && !c.bay) return [c.gx, c.gz];
  }
  return null;
}

/** Open road cells reachable from `a` (a BFS), nearest first. */
export function reachable(s: GameState, a: Cell, limit = 4000): Cell[] {
  const map = roadMap(s);
  const ak = cellKey(a[0], a[1]);
  const seen = new Set([ak]);
  const q = [ak];
  for (let i = 0; i < q.length && q.length < limit; i++) {
    const [x, z] = keyCell(q[i]);
    for (const [dx, dz] of N4) {
      const nk = cellKey(x + dx, z + dz);
      if (seen.has(nk)) continue;
      const c = map.get(nk);
      if (!isOpen(c)) continue;
      seen.add(nk);
      q.push(nk);
    }
  }
  return q.map(keyCell);
}

/** The open road cell nearest a world point (bays too if `bays`). */
export function nearestRoad(s: GameState, x: number, z: number, bays = false): Cell | null {
  let best: Cell | null = null, bd = Infinity;
  for (const c of s.roads ?? []) {
    if (!isOpen(c) || (c.bay && !bays)) continue;
    const [cx, cz] = cellCentre(c.gx, c.gz);
    const d = Math.hypot(cx - x, cz - z);
    if (d < bd) { bd = d; best = [c.gx, c.gz]; }
  }
  return best;
}

/** A route's cell centres as a world polyline. */
export const routePoints = (cells: readonly Cell[]): [number, number][] => cells.map(([x, z]) => cellCentre(x, z));

/** Open road cells beside a structure (sharing an edge), its door first. */
export function besideCells(s: GameState, b: Placed): Cell[] {
  const map = roadMap(s);
  const d = doorCell(b);
  const out: Cell[] = [];
  const add = (c: Cell) => {
    const r = map.get(cellKey(c[0], c[1]));
    if (r && isOpen(r) && !r.bay && !out.some((o) => o[0] === c[0] && o[1] === c[1])) out.push(c);
  };
  if (d) add(d);
  for (const c of edgeCells(b)) add(c);
  return out;
}

/** The open road cell a field structure is worked from: the nearest in reach,
 *  else (a chained field) the nearest reaching any structure of its field. */
export function serviceCell(s: GameState, b: Placed): Cell | null {
  const map = roadMap(s);
  const [cx, cz] = [footprintRect(b).gx0, footprintRect(b).gz0];
  let best: Cell | null = null, bd = Infinity;
  const consider = (o: Placed) => {
    for (const [x, z] of ringCells(o)) {
      const c = map.get(cellKey(x, z));
      if (!c || !isOpen(c) || c.bay) continue;
      const d = Math.abs(x - cx) + Math.abs(z - cz);
      if (d < bd) { bd = d; best = [x, z]; }
    }
  };
  consider(b);
  if (!best) {
    // a field chained to the road: the nearest cell reaching any of its kind
    const served = servedFields(s);
    for (const o of s.buildings) if (o.type === b.type && served.has(o.id)) consider(o);
  }
  return best;
}

/** Where a unit works or unloads for a structure: its door cell if open,
 *  a cell beside it, or (a field) its service cell. */
export function accessCell(s: GameState, b: Placed): Cell | null {
  if (FIELD_TYPES.has(b.type)) return serviceCell(s, b);
  if (OFFROAD_TYPES.has(b.type)) {
    const r = footprintRect(b);
    const [x, z] = cellCentre((r.gx0 + r.gx1) / 2 - 0.5, (r.gz0 + r.gz1) / 2 - 0.5);
    return mastStand(s, b)?.gate ?? nearestRoad(s, x, z);
  }
  const beside = besideCells(s, b)[0];
  if (beside) return beside;
  const r = footprintRect(b);
  const [x, z] = cellCentre((r.gx0 + r.gx1) / 2 - 0.5, (r.gz0 + r.gz1) / 2 - 0.5);
  return nearestRoad(s, x, z);
}

// ───────────────────────────── saves ─────────────────────────────

/** A save from before roads: the apron, then a spur for every structure in
 *  building order, all open. */
export function migrateRoads(s: GameState, hf: Heights) {
  if (s.roadSchema === 1 && s.roads) return;
  s.roads = [];
  s.roadJobs = [];
  s.roadRev = 0;
  const lander = s.buildings.find((b) => b.type === 'lander');
  if (lander) layApron(s, lander);
  if (!s.roads.length) {
    // the Lander boxed in by an old layout: start from the nearest free cell
    const [x, z] = lander ? cellCentre(lander.gx, lander.gz) : [0, 0];
    const [gx, gz] = cellAt(x, z);
    const blocked = occupied(s);
    for (let r = 1; r < 12 && !s.roads.length; r++) {
      for (let dz = -r; dz <= r && !s.roads.length; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || blocked.has(cellKey(gx + dx, gz + dz))) continue;
          s.roads.push({ gx: gx + dx, gz: gz + dz, left: 0 });
          break;
        }
      }
    }
  }
  // every door gets its road as it would have before extraction zones (the
  // safe choice: nothing stranded; core/zones.ts): the zones set aside meanwhile
  const zones = s.zones;
  s.zones = undefined;
  for (const b of s.buildings) {
    if (b.type === 'lander') continue;
    laySpur(s, hf, b, true);
  }
  s.zones = zones;
  for (const r of s.rovers ?? []) delete r.road;
  for (const b of s.buildings) if (b.haul) delete b.haul.roadJob;
  s.roadSchema = 1;
  bumpRoads(s);
}

/** Every cell open now (the debug API's "finish construction"). */
export function openAll(s: GameState) {
  if (!s.roads) return;
  for (const c of s.roads) c.left = 0;
  s.roadJobs = [];
  bumpRoads(s);
}

/** For the placement hint and tests: the type a door belongs to. */
export const hasDoor = (t: BuildingId) => !doorless(t);
