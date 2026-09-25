/** The road network (docs/15-roads.md): 4 m grid cells the rovers sinter and
 *  every unit drives on. Pure: the state and a height sampler in, cells and
 *  routes out; no Three.js, no randomness, stable orders, so the sim stays
 *  deterministic.
 *
 *  - Doors: every structure but the field types has one (front middle,
 *    rotated with it); its spur ends there.
 *  - Spurs: A* from the open network to the door on placement; the site's
 *    rovers sinter it before they weld.
 *  - Field types (arrays, batteries, masts) are served from the field's edge.
 *  - Jobs: roads the player draws and haul roads to a dig, sintered by free rovers.
 *  - Routes: shortest open paths, cached on the network's revision. */
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { CELL_M, MAP_CELLS, MAP_M } from '../data/balance';
import { APRON, DOCK_TYPES, FIELD_TYPES, ROAD } from '../data/roads';
import type { BuildingState, GameState, RoadCell, RoadJob } from './state';
import { footprintRect } from '../buildings/instances';

export interface Heights { sample(x: number, z: number): number }
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

/** The cell a structure's road ends at (null: a field type, served from its edge). */
export function doorCell(b: Placed): Cell | null {
  if (FIELD_TYPES.has(b.type)) return null;
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

/** Field structures a road serves: one within reach of any road cell, or one
 *  sharing an edge with a served structure of its own type. */
export function servedFields(s: GameState): Set<number> {
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

/** A binary min-heap keyed on f (ties: the lower cell key: stable). */
class Heap {
  private f: number[] = [];
  private k: number[] = [];
  get size() { return this.k.length; }
  private less(i: number, j: number) { return this.f[i] < this.f[j] || (this.f[i] === this.f[j] && this.k[i] < this.k[j]); }
  private swap(i: number, j: number) { [this.f[i], this.f[j]] = [this.f[j], this.f[i]]; [this.k[i], this.k[j]] = [this.k[j], this.k[i]]; }
  push(f: number, k: number) {
    this.f.push(f); this.k.push(k);
    for (let i = this.k.length - 1; i > 0;) { const p = (i - 1) >> 1; if (!this.less(i, p)) break; this.swap(i, p); i = p; }
  }
  pop(): number {
    const top = this.k[0];
    const lf = this.f.pop()!, lk = this.k.pop()!;
    if (this.k.length) {
      this.f[0] = lf; this.k[0] = lk;
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

const MAX_EXPAND = 40000;

/** A* on cells: from `sources` (cost 0) to any of `targets`. New cells cost 1
 *  plus the height step; closed road cells (being sintered) 0.5; open road
 *  free (it is a source anyway). Footprints, bays and steps steeper than
 *  ROAD.maxStep are walls. Returns the cells after the source, in order. */
function search(
  s: GameState, hf: Heights, sources: number[], targets: Set<number>, blocked: Set<number>,
  seed?: Map<number, number>,
): number[] | null {
  if (!sources.length || !targets.size) return null;
  const map = roadMap(s);
  const tcells = [...targets].map(keyCell);
  const h = (k: number) => {
    const [x, z] = keyCell(k);
    let best = Infinity;
    for (const [tx, tz] of tcells) best = Math.min(best, Math.abs(tx - x) + Math.abs(tz - z));
    return best;
  };
  const height = new Map<number, number>();
  const hAt = (k: number) => {
    let v = height.get(k);
    if (v === undefined) { const [x, z] = keyCell(k); v = hf.sample(...cellCentre(x, z)); height.set(k, v); }
    return v;
  };
  const cost = new Map<number, number>();
  const from = new Map<number, number>();
  const done = new Set<number>();
  const open = new Heap();
  // (a start the partner cannot reach by road weighs as much as the farthest that it can)
  const far = seed ? seedFar(seed) : 0;
  for (const k of [...sources].sort((a, b) => a - b)) {
    if (targets.has(k)) return [];
    const g0 = seed ? seed.get(k) ?? far : 0;
    cost.set(k, g0);
    from.set(k, -1);
    open.push(g0 + h(k), k);
  }
  let found = -1, n = 0;
  while (open.size && n++ < MAX_EXPAND) {
    const k = open.pop();
    if (done.has(k)) continue;
    done.add(k);
    if (targets.has(k)) { found = k; break; }
    const [x, z] = keyCell(k);
    for (const [dx, dz] of N4) {
      const nx = x + dx, nz = z + dz;
      if (!inMap(nx, nz)) continue;
      const nk = cellKey(nx, nz);
      if (done.has(nk) || blocked.has(nk)) continue;
      const road = map.get(nk);
      if (road?.bay || road?.closed) continue;
      const step = Math.abs(hAt(nk) - hAt(k));
      if (step > ROAD.maxStep) continue;
      const c = cost.get(k)! + (isOpen(road) ? 0.05 : road ? 0.5 : 1) + ROAD.slopeCost * step;
      if (c < (cost.get(nk) ?? Infinity)) {
        cost.set(nk, c);
        from.set(nk, k);
        open.push(c + h(nk), nk);
      }
    }
  }
  if (found < 0) return null;
  const out: number[] = [];
  for (let k = found; from.get(k) !== -1; k = from.get(k)!) out.push(k);
  return out.reverse();
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

/** An excavator's spur, or a regolith consumer's, joins the network where
 *  the haul between them is shortest: each start cell costs its distance by
 *  road to the partner's door (the nearest consumer — a smelter or refinery,
 *  else the Lander — for an excavator; the nearest excavator for a consumer),
 *  a cell of haul road weighed as a new cell. Null: no partner. */
const HAUL_PAIRS: Partial<Record<BuildingId, readonly BuildingId[]>> = {
  excavator: ['smelter', 'refinery'],
  smelter: ['excavator'],
  refinery: ['excavator'],
};
const seedMemo = new Map<string, Map<number, number>>();
const seedFar = (m: Map<number, number>) => { let v = 0; for (const d of m.values()) v = Math.max(v, d); return v + 1; };
function haulSeed(s: GameState, b: Placed): Map<number, number> | undefined {
  const kinds = HAUL_PAIRS[b.type];
  if (!kinds) return undefined;
  const r = footprintRect(b);
  const [cx, cz] = [(r.gx0 + r.gx1) / 2, (r.gz0 + r.gz1) / 2];
  let pool = s.buildings.filter((o) => kinds.includes(o.type));
  if (!pool.length && b.type === 'excavator') pool = s.buildings.filter((o) => o.type === 'lander');
  let best: Placed | null = null, bd = Infinity;
  for (const o of pool) {
    const q = footprintRect(o);
    const d = Math.hypot((q.gx0 + q.gx1) / 2 - cx, (q.gz0 + q.gz1) / 2 - cz);
    if (d < bd) { bd = d; best = o; }
  }
  const door = best ? doorCell(best) : null;
  if (!door) return undefined;
  const key = `${s.roadRev ?? 0},${s.roads?.length ?? 0}|${door[0]},${door[1]}`;
  const hit = seedMemo.get(key);
  if (hit) return hit;
  // distances by open road from the partner's door, in cells
  const map = roadMap(s);
  const dist = new Map<number, number>([[cellKey(door[0], door[1]), 0]]);
  const q = [cellKey(door[0], door[1])];
  for (let i = 0; i < q.length; i++) {
    const [x, z] = keyCell(q[i]);
    for (const [dx, dz] of N4) {
      const nk = cellKey(x + dx, z + dz);
      if (dist.has(nk)) continue;
      const c = map.get(nk);
      if (!c || !isOpen(c) || c.bay) continue;
      dist.set(nk, dist.get(q[i])! + 1);
      q.push(nk);
    }
  }
  if (seedMemo.size > 64) seedMemo.clear();
  seedMemo.set(key, dist);
  return dist;
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
}

const planMemo = new Map<string, SpurPlan>();

/** The road a structure placed here would need (memoised on the network). */
export function planSpur(s: GameState, hf: Heights, b: Placed): SpurPlan {
  const none: SpurPlan = { cells: [], fresh: [], bays: [], reason: '' };
  if (!hasRoads(s)) return none;
  const key = `${b.type},${b.gx},${b.gz},${b.rot}|${s.roadRev ?? 0},${s.roads!.length}|${s.nextBuildingId},${s.buildings.length}`;
  const hit = planMemo.get(key);
  if (hit) return hit;
  const out = planFresh(s, hf, b);
  if (planMemo.size > 400) planMemo.clear();
  planMemo.set(key, out);
  return out;
}

function planFresh(s: GameState, hf: Heights, b: Placed): SpurPlan {
  const map = roadMap(s);
  const blocked = occupied(s, b);
  const doors = doorKeys(s, b);
  // a new road runs through no one's door
  for (const k of doors) blocked.add(k);
  const sources = openSources(s, doors);
  let targets: number[];
  if (FIELD_TYPES.has(b.type)) {
    if (fieldReached(s, b)) return { cells: [], fresh: [], bays: [], reason: '' };
    targets = ringCells(b).filter(([x, z]) => inMap(x, z) && !blocked.has(cellKey(x, z)) && !map.get(cellKey(x, z))?.closed).map(([x, z]) => cellKey(x, z));
    if (!targets.length) return { cells: [], fresh: [], bays: [], reason: 'NO ROAD ROUTE — boxed in: no ground beside it for a road' };
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
  const path = search(s, hf, sources, new Set(targets), blocked, haulSeed(s, b));
  if (!path) {
    return { cells: [], fresh: [], bays: [], reason: sources.length
      ? 'NO ROAD ROUTE — the rovers cannot reach it by road (walled in, or too steep)'
      : 'NO ROAD ROUTE — no open road to start from' };
  }
  const cells = path.filter((k) => !isOpen(map.get(k)));
  const fresh = cells.filter((k) => !map.has(k));
  const bays: number[] = [];
  if (DOCK_TYPES.has(b.type) && b.type !== 'lander') {
    // parking beside the door, along the front: left, then right
    const d = doorCell(b)!;
    const [fx, fz] = frontDir(b);
    const taken = new Set([...blocked, ...path]);
    for (const side of [-1, 1]) {
      const bx = d[0] + side * -fz, bz = d[1] + side * fx;
      const k = cellKey(bx, bz);
      if (!inMap(bx, bz) || taken.has(k) || map.has(k)) continue;
      bays.push(k);
    }
  }
  return { cells, fresh, bays, reason: '' };
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

/** Where sintering goes on along a list of cells: the first closed one, and
 *  the open cell a rover works it from. */
export function frontierOf(s: GameState, cells: readonly number[]): { cell: RoadCell; from: Cell | null } | null {
  const map = roadMap(s);
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
    return { cell: c, from };
  }
  return null;
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

export interface LinkPlan { cells: number[]; fresh: number[]; reason: string }

/** A road from road cell `a` to cell `b` (the road tool, a haul road). */
export function planLink(s: GameState, hf: Heights, a: Cell | null, b: Cell): LinkPlan {
  if (!hasRoads(s)) return { cells: [], fresh: [], reason: 'NO ROADS ON THIS BASE' };
  const map = roadMap(s);
  const blocked = occupied(s);
  const doors = doorKeys(s);
  const bk = cellKey(b[0], b[1]);
  if (!inMap(b[0], b[1])) return { cells: [], fresh: [], reason: 'OUTSIDE THE SURVEY AREA' };
  if (doors.has(bk) || map.get(bk)?.closed) return { cells: [], fresh: [], reason: 'AT A DOOR — a door is the end of its own road; end beside it' };
  if (blocked.has(bk)) return { cells: [], fresh: [], reason: 'UNDER A STRUCTURE — end the road on open ground' };
  let sources: number[];
  if (a) {
    const ak = cellKey(a[0], a[1]);
    const c = map.get(ak);
    if (!c || c.bay) return { cells: [], fresh: [], reason: 'START ON A ROAD — drag out from an open road cell' };
    if (c.closed || doors.has(ak)) return { cells: [], fresh: [], reason: 'START ELSEWHERE — no road branches off a door or the Lander’s apron' };
    sources = [ak];
  } else {
    sources = openSources(s, doors);
  }
  for (const k of doors) if (k !== bk) blocked.add(k);
  const path = search(s, hf, sources, new Set([bk]), blocked);
  if (!path) return { cells: [], fresh: [], reason: 'NO ROAD ROUTE — walled in, or too steep for a road' };
  const cells = path.filter((k) => !isOpen(map.get(k)));
  return { cells, fresh: cells.filter((k) => !map.has(k)), reason: '' };
}

/** Lay a job's road; returns its id (0: nothing to lay). */
export function layJob(s: GameState, plan: LinkPlan, kind: RoadJob['kind'], by?: number): number {
  if (!hasRoads(s) || plan.reason || !plan.cells.length) return 0;
  for (const k of plan.fresh) {
    const [gx, gz] = keyCell(k);
    s.roads!.push({ gx, gz, left: ROAD.cellS });
  }
  s.roadJobs ??= [];
  s.nextRoadJob ??= 1;
  const id = s.nextRoadJob++;
  s.roadJobs.push({ id, kind, cells: [...plan.cells], ...(by !== undefined ? { by } : {}) });
  bumpRoads(s);
  return id;
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

const routeMemo = new Map<string, Cell[] | null>();

/** The shortest open road from cell a to cell b (both ends may be bays or
 *  closed frontier-adjacent cells; the way between is open carriageway).
 *  Null: no way. Cached on the network's revision. */
export function roadRoute(s: GameState, a: Cell, b: Cell): Cell[] | null {
  const key = `${s.roadRev ?? 0}|${a[0]},${a[1]}>${b[0]},${b[1]}`;
  if (routeMemo.has(key)) return routeMemo.get(key)!;
  const out = bfs(s, a, b);
  if (routeMemo.size > 2000) routeMemo.clear();
  routeMemo.set(key, out);
  return out;
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
  for (const b of s.buildings) {
    if (b.type === 'lander') continue;
    laySpur(s, hf, b, true);
  }
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
export const hasDoor = (t: BuildingId) => !FIELD_TYPES.has(t);
