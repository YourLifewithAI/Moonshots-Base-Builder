/** Sim-side traffic reservations (docs/19, improvement 8; stream S4a).
 *
 *  The sim used to have no collisions: a unit moved along its waypoints
 *  whether or not another held the ground, and only the visual layer
 *  (world/traffic.ts) avoided overlaps, drifting from the sim. Now the sim
 *  reserves ground, and a unit that cannot have the next stretch waits.
 *
 *  - **What is reserved.** Road cells (a 3.8 m body on a 4 m cell: one unit a
 *    cell, and one behind it: a unit holds the cell it stands in, the one it
 *    just left and the run ahead), plus each cut pit's ramp as one key (one
 *    unit at a time). Ground off the roads inside an extraction zone is not
 *    reserved (units share it: the visual lanes keep them apart), and a
 *    dock's bay cells are soft: parking never blocks.
 *  - **Runs.** A unit holds the run ahead: the cells of its path from where
 *    it stands to the next *boundary* — a road cell beside a passing or
 *    holding bay (`RoadCell.pass`, `hold`) or a dock bay, or a pit ramp — or
 *    to the end of its path; on a road with no bay in reach, 48 m ahead. The
 *    whole run is granted or none of it (a unit standing in a bay holds none
 *    of it until it can have all); a unit behind another going the same way
 *    (a convoy) is granted the cells behind it. So two units never meet head
 *    on in the middle of a stretch, and an opposing unit waits at the
 *    boundary it is at, in the bay if it has one.
 *  - **Priority.** A loaded digger before an empty one before a rover, ties
 *    by id. The tick is two-phase: every digger's claim is planned in that
 *    order (`trafficPlan`, economy step 0), then they move (`go`, called by
 *    the hub units' cycle), so a unit early in the roster cannot take a run a
 *    loaded unit should have had. A leg begun mid-tick asks on the spot, after
 *    everyone's plan. A rover holds no ground of its own: `roverStep`
 *    (core/transit.ts) makes it wait for a digger's claim, its clock standing
 *    still (the trip's ETA stretches) and a digger is never held up by one.
 *  - **Waiting.** A unit refused a cell stops at the centre of the cell before
 *    it (`h.held` counts the seconds). A lower-priority unit that stands where a
 *    higher one needs to pass, and does not move, pulls into the bay beside it
 *    (a `pass` or `hold` cell, or a dock bay), else after 3 s onto the free
 *    ground beside the road (or a free road cell off the other's way). Held
 *    20 s a unit lets go of the ground ahead and steps aside; held 60 s (a rover
 *    held 20 s; a unit asked to give way with nowhere to go, 12 s) it drives through, counted. The counters are in
 *    `getRenderInfo().life.traffic.sim`; `getTraffic()` (debug) says who holds what.
 *
 *  Claims are kept on the unit (`HaulState.claim`, a few cell numbers) so a
 *  saved game resumes them; the table of who holds what is rebuilt every tick.
 *  Deterministic: units in priority order, cells in path order, fixed
 *  tie-breaks. Bypassed under `TRAFFIC.bypass` (debug instant travel). */
import { CELL_M } from '../data/balance';
import { ROAD } from '../data/roads';
import type { GameState, Hauler, HaulState } from './state';
import { cellAt, cellCentre, cellKey, keyCell, roadMap } from './roads';
import { drive } from './haul';
import { footprintRect } from '../buildings/instances';
import { trafficOff } from './simMode';

type Pt = [number, number];

/** A unit that holds cells: a hub unit (`hauler`, its id) or a roster rover. */
export interface UnitRef {
  kind: 'hauler' | 'rover';
  id: number;
}

/** Tests where timing is not the point (core/game.ts debugInstantTravel): no reservations.
 *  The switch lives in core/simMode.ts (`trafficOff(s)` is the per-base answer: a headless base runs without traffic too). */
export { TRAFFIC } from './simMode';

/** s a unit stays still on a cell a higher-priority unit needs before it steps onto free ground */
const STILL_ASIDE_S = 3;
/** s held before a unit lets go of the ground ahead and steps aside */
const HELD_ASIDE_S = 20;
/** s held before a unit drives through whoever holds its way */
const FORCE_S = 60;
/** s a unit that has been asked to give way, and has nowhere to step aside to, is held before it drives through */
const ASKED_FORCE_S = 12;
const HALF = CELL_M / 2;
/** m the scan of a path looks ahead */
const SCAN_M = 320;
/** m a run may reach ahead where no bay is near enough to end it: a road with no passing bays is held
 *  this far, and units that meet head on there sort it out on the ground beside the road */
const HORIZON_M = 48;
/** half the ramp's width, m */
const RAMP_HALF = 2.6;
/** the keys of pit ramps are below this */
const RAMP_BASE = -1000;

const uidOf = (u: UnitRef) => (u.kind === 'hauler' ? u.id : -u.id - 1);
const isRamp = (k: number) => k <= RAMP_BASE;

/** A pit's ramp as the units drive it: from its top on the rim to its foot on the floor. */
export interface Ramp { pit: number; a: Pt; b: Pt }
const rampKey = (pit: number) => RAMP_BASE - pit;

/** What the sim counts (getRenderInfo().life.traffic.sim). */
export interface TrafficStats {
  /** unit-seconds held up by another unit's reservation */
  heldS: number;
  /** the longest one unit was held, s */
  maxHeldS: number;
  /** pulled into a passing or holding bay for a higher-priority unit */
  pullIns: number;
  /** stepped onto free ground (a wait that would not end, or a unit in the way that would not move) */
  stepAsides: number;
  /** drove through the ground another held, after waiting FORCE_S (a rover in the way: 20 s) */
  forced: number;
  /** road cells held by two units at the end of a tick's plan (a forced pass, or a unit set down on another) */
  overlaps: number;
}

type Kind = 'road' | 'pocket' | 'soft' | 'ramp';
interface Item { key: number; enter: number; kind: Kind }

/** One unit in the tick's table. */
interface Mv {
  uid: number;
  kind: 'hauler' | 'rover';
  id: number;
  /** 0 a loaded digger, 1 an empty one, 2 a rover, then its id */
  prio: number;
  h?: HaulState;
  /** a rover's position */
  r?: { x?: number; z?: number };
  /** the keys it holds, in the order it drives them (a hauler's is `h.claim`) */
  claim: number[];
  /** what its last plan said (the debug API reads it) */
  last?: { limit: number; holder: number; key?: number };
}

interface Tab {
  map: ReturnType<typeof roadMap>;
  ramps: Ramp[];
  owners: Map<number, number[]>;
  units: Map<number, Mv>;
  /** the units in priority order */
  order: Mv[];
  /** blocker uid → the highest-priority unit it holds up by standing on its way */
  req: Map<number, number>;
  boundary: Map<number, boolean>;
  forced: Set<number>;
}

interface Store {
  tab: Tab | null;
  stats: TrafficStats;
  /** ticks a unit has been asked to move aside */
  ages: Map<number, number>;
  /** the `held` a unit last stepped aside at (a second step waits another HELD_ASIDE_S) */
  asided: Map<number, number>;
  /** reservations asked for through `reserve` (rebuilt each tick: a caller asks again) */
  extra: Map<number, Set<number>>;
}

const stores = new WeakMap<GameState, Store>();
function storeOf(s: GameState): Store {
  let st = stores.get(s);
  if (!st) {
    st = { tab: null, stats: { heldS: 0, maxHeldS: 0, pullIns: 0, stepAsides: 0, forced: 0, overlaps: 0 }, ages: new Map(), asided: new Map(), extra: new Map() };
    stores.set(s, st);
  }
  return st;
}

// ───────────────────────────── the table ─────────────────────────────

const holds = (tab: Tab, key: number, except: number): number[] => (tab.owners.get(key) ?? []).filter((x) => x !== except);

function own(tab: Tab, uid: number, key: number) {
  const l = tab.owners.get(key);
  if (!l) tab.owners.set(key, [uid]);
  else if (!l.includes(uid)) l.push(uid);
}
function disown(tab: Tab, uid: number, key: number) {
  const l = tab.owners.get(key);
  if (!l) return;
  const i = l.indexOf(uid);
  if (i >= 0) l.splice(i, 1);
  if (!l.length) tab.owners.delete(key);
}

/** Replace a unit's claim, keeping the owners in step. */
function setClaim(tab: Tab, mv: Mv, next: number[]) {
  for (const k of mv.claim) if (!next.includes(k)) disown(tab, mv.uid, k);
  for (const k of next) own(tab, mv.uid, k);
  mv.claim = next;
  if (mv.h) { if (next.length) mv.h.claim = next; else delete mv.h.claim; }
}

const driving = (h: HaulState) => h.phase === 'toDig' || h.phase === 'toBay' || h.phase === 'toDrop';
const loadedOf = (h: HaulState) => (h.cargo.regolith ?? 0) > 1e-6 || h.phase === 'toDrop' || h.phase === 'unload';

function posOf(mv: Mv): Pt | null {
  if (mv.h) return [mv.h.x, mv.h.z];
  const r = mv.r;
  return r && r.x !== undefined && r.z !== undefined ? [r.x, r.z] : null;
}

function onRamp(r: Ramp, x: number, z: number): boolean {
  const dx = r.b[0] - r.a[0], dz = r.b[1] - r.a[1], l2 = dx * dx + dz * dz;
  if (l2 < 1e-6) return false;
  const k = ((x - r.a[0]) * dx + (z - r.a[1]) * dz) / l2;
  if (k < -0.02 || k > 1.02) return false;
  const px = r.a[0] + dx * Math.max(0, Math.min(1, k)), pz = r.a[1] + dz * Math.max(0, Math.min(1, k));
  return Math.hypot(x - px, z - pz) <= RAMP_HALF;
}

/** The reservable key at a point: a ramp, or a road cell (or one of the unit's own aside cells). */
function keyAt(tab: Tab, x: number, z: number, mine: ReadonlySet<number>, noRamp = false): number | null {
  if (!noRamp) for (const r of tab.ramps) if (onRamp(r, x, z)) return rampKey(r.pit);
  const [gx, gz] = cellAt(x, z);
  const k = cellKey(gx, gz);
  return tab.map.has(k) || mine.has(k) ? k : null;
}

function kindOf(tab: Tab, key: number): Kind {
  if (isRamp(key)) return 'ramp';
  const c = tab.map.get(key);
  if (!c) return 'pocket';
  if (c.bay) return 'soft';
  return c.pass || c.hold ? 'pocket' : 'road';
}

/** A road cell beside a bay a waiting unit can pull into, or a ramp: where a run ends. */
function isBoundary(tab: Tab, key: number): boolean {
  if (isRamp(key)) return true;
  const hit = tab.boundary.get(key);
  if (hit !== undefined) return hit;
  let b = false;
  const c = tab.map.get(key);
  if (c && !c.bay && !c.pass && !c.hold) {
    const [gx, gz] = keyCell(key);
    for (const [dx, dz] of N4) {
      const n = tab.map.get(cellKey(gx + dx, gz + dz));
      if (n && (n.bay || n.pass || n.hold)) { b = true; break; }
    }
  }
  tab.boundary.set(key, b);
  return b;
}
const N4: Pt[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** The reservable stretches along a path from (x, z), in the order it drives
 *  them: each with the metres to where it is entered. */
function itemsAlong(tab: Tab, x: number, z: number, path: readonly Pt[], mine: ReadonlySet<number>, rest = false): Item[] {
  const out: Item[] = [];
  const push = (px: number, pz: number, d: number) => {
    // (a unit digging at a face by the ramp's foot is not on the ramp)
    const key = keyAt(tab, px, pz, mine, rest && d === 0);
    if (key === null) return;
    if (out.length && out[out.length - 1].key === key) return;
    out.push({ key, enter: d === 0 ? 0 : Math.max(0.01, d - 0.5), kind: kindOf(tab, key) });
  };
  let px = x, pz = z, dist = 0;
  push(px, pz, 0);
  for (const [qx, qz] of path) {
    const l = Math.hypot(qx - px, qz - pz);
    const n = Math.max(1, Math.ceil(l));
    for (let i = 1; i <= n; i++) push(px + ((qx - px) * i) / n, pz + ((qz - pz) * i) / n, dist + (l * i) / n);
    dist += l;
    px = qx; pz = qz;
    if (dist > SCAN_M) break;
  }
  return out;
}

/** Build the tick's table: every unit, its claim, who stands where. */
function build(s: GameState, ramps: Ramp[]): Tab {
  const tab: Tab = {
    map: roadMap(s), ramps, owners: new Map(), units: new Map(), order: [], req: new Map(), boundary: new Map(), forced: new Set(),
  };
  const hubs = new Set(s.buildings.filter((b) => !!b.hub).map((b) => b.id));
  for (const u of s.haulers) {
    if (!hubs.has(u.hub)) continue;
    const uid = uidOf({ kind: 'hauler', id: u.id });
    const mv: Mv = { uid, kind: 'hauler', id: u.id, prio: (loadedOf(u.haul) ? 0 : 1) * 1e6 + u.id, h: u.haul, claim: [] };
    tab.units.set(uid, mv);
    tab.order.push(mv);
    setClaim(tab, mv, u.haul.claim ? [...u.haul.claim] : []);
  }
  for (const r of s.rovers ?? []) {
    // (a rover holds no ground of its own: it waits for a digger's, core/traffic.ts roverStep)
    const uid = uidOf({ kind: 'rover', id: r.id });
    const mv: Mv = { uid, kind: 'rover', id: r.id, prio: 2e6 + r.id, r, claim: [] };
    tab.units.set(uid, mv);
    tab.order.push(mv);
  }
  tab.order.sort((a, b) => a.prio - b.prio);
  return tab;
}

/** The cell a unit has just left, still held behind it (a body is longer than a cell): only along a
 *  road, and never a cell its path goes back to (a unit that stepped aside gives its road back). */
function tailOf(tab: Tab, mv: Mv, items: Item[]): number | null {
  if (!items.length || items[0].enter !== 0 || items[0].kind !== 'road') return null;
  const cur = items[0].key;
  const at = mv.claim.indexOf(cur);
  if (at <= 0) return null;
  const tail = mv.claim[at - 1];
  if (tail === cur || kindOf(tab, tail) !== 'road') return null;
  return items.some((it, i) => i > 0 && it.key === tail) ? null : tail;
}

/** After a move: the claim shrinks to the cell it stands in, the one it left and the run still ahead
 *  (what follows the cell it stands in, in the order it drives them). */
function trim(tab: Tab, mv: Mv, items: Item[]) {
  // (a dock bay stood in counts for where the claim goes on from, though it is never held)
  const here = items.length && items[0].enter === 0 ? items[0].key : null;
  const cur = here !== null && items[0].kind !== 'soft' ? here : null;
  const at = here !== null ? mv.claim.indexOf(here) : -1;
  // a unit standing in a bay holds nothing ahead: it asks again for its whole run when it can go
  const inBay = here !== null && items[0].kind !== 'road' && items[0].kind !== 'ramp';
  const ahead = new Set(inBay ? [] : at >= 0 ? mv.claim.slice(at + 1) : mv.claim);
  const tail = tailOf(tab, mv, items);
  const out: number[] = [];
  if (tail !== null) out.push(tail);
  for (const it of items) {
    if (it.kind === 'soft') continue;
    if (it.key === cur && out.length <= 1 && !out.includes(cur)) { out.push(cur); continue; }
    if (!ahead.has(it.key)) break;
    if (!out.includes(it.key)) out.push(it.key);
  }
  setClaim(tab, mv, out);
}

/** Does the holder go the way the unit does through this stretch (it is ahead: the unit follows)? */
function sameWay(tab: Tab, holderUid: number, items: Item[], i: number): boolean {
  const H = tab.units.get(holderUid);
  if (!H || H.kind !== 'hauler' || items[i].kind === 'ramp') return false;
  const p = H.claim.indexOf(items[i].key);
  if (p < 0) return false;
  const prevH = p > 0 ? H.claim[p - 1] : undefined, nextH = p + 1 < H.claim.length ? H.claim[p + 1] : undefined;
  const prevU = i > 0 ? items[i - 1].key : undefined, nextU = i + 1 < items.length ? items[i + 1].key : undefined;
  return (prevH !== undefined && prevH === prevU) || (nextH !== undefined && nextH === nextU);
}

interface Grant { limit: number; blocked: number; holder: number; key?: number }

/** Plan one unit's claim: keep what it holds ahead, ask for the rest of its run,
 *  and say how far along its path it may go (metres; Infinity: to the end). */
function plan(s: GameState, tab: Tab, st: Store, mv: Mv, depth = 0): Grant {
  const g = planOnce(s, tab, st, mv, depth);
  mv.last = { limit: g.limit, holder: g.holder, ...(g.key !== undefined ? { key: g.key } : {}) };
  return g;
}

function planOnce(s: GameState, tab: Tab, st: Store, mv: Mv, depth: number): Grant {
  const h = mv.h!;
  const mine0 = new Set(mv.claim);
  const items = itemsAlong(tab, h.x, h.z, h.path, mine0, !driving(h));
  trim(tab, mv, items);
  if (!items.length) return { limit: Infinity, blocked: -1, holder: -1 };
  const mine = new Set(mv.claim);
  const a = items.findIndex((it) => it.kind === 'road' || it.kind === 'ramp');
  let runEnd = items.length - 1;
  if (a >= 0) {
    if (items[a].kind === 'ramp') runEnd = a;
    else {
      for (let j = a + 1; j < items.length; j++) if (isBoundary(tab, items[j].key)) { runEnd = j; break; }
    }
    // no bay in reach: the run is what lies within the horizon
    let hz = a;
    while (hz + 1 < items.length && items[hz + 1].enter <= HORIZON_M) hz++;
    if (runEnd > hz) runEnd = hz;
  }
  const need: number[] = [];
  let blocked = -1, holder = -1;
  for (let i = 0; i <= runEnd; i++) {
    const it = items[i];
    if (it.kind === 'soft' || mine.has(it.key)) continue;
    const others = holds(tab, it.key, mv.uid);
    if (!others.length) { need.push(it.key); continue; }
    blocked = i; holder = others[0];
    break;
  }
  // a stretch held by a unit going the same way ahead of this one: the cells behind it are granted
  const convoy = blocked >= 0 && sameWay(tab, holder, items, blocked);
  const got = new Set<number>(blocked < 0 || convoy ? need : []);
  if (got.size) {
    const out: number[] = [];
    const tail = tailOf(tab, mv, items);
    if (tail !== null) out.push(tail);
    for (const it of items) {
      if (it.kind === 'soft') continue;
      if (!mine.has(it.key) && !got.has(it.key)) break;
      if (!out.includes(it.key)) out.push(it.key);
    }
    setClaim(tab, mv, out);
  }
  if (blocked < 0) {
    if (h.held) delete h.held;
    return { limit: runEnd === items.length - 1 ? Infinity : items[runEnd].enter + HALF, blocked: -1, holder: -1 };
  }
  // held: who is in the way, and whether the way can be asked clear
  const H = tab.units.get(holder);
  const key = items[blocked].key;
  if (H && H.prio > mv.prio && posKey(tab, H) === key) {
    const cur = tab.req.get(holder);
    if (cur === undefined || (tab.units.get(cur)?.prio ?? Infinity) > mv.prio) tab.req.set(holder, mv.uid);
  }
  const heldS = h.held ?? 0;
  // (a unit that stands in a higher-priority one's way and has no bay or ground to step onto: a gridlock in a tangle of roads)
  if (heldS >= FORCE_S || (heldS >= ASKED_FORCE_S && (st.ages.get(mv.uid) ?? 0) >= ASKED_FORCE_S)) {
    if (!tab.forced.has(mv.uid)) { tab.forced.add(mv.uid); st.stats.forced++; }
    return { limit: Infinity, blocked, holder };
  }
  if (heldS >= HELD_ASIDE_S && depth === 0 && (st.asided.get(mv.uid) ?? -HELD_ASIDE_S) + HELD_ASIDE_S <= heldS) {
    // a wait that will not end: let go of the ground ahead, and a lower-priority unit steps aside
    const cur = items[0].enter === 0 ? items[0].key : null;
    setClaim(tab, mv, mv.claim.filter((k, i) => k === cur || (cur !== null && i < mv.claim.indexOf(cur))));
    st.asided.set(mv.uid, heldS);
    // (standing on the carriageway, not in a bay: that is the one that blocks)
    if (H && H.prio < mv.prio && items[0].enter === 0 && items[0].kind === 'road' && stepAside(s, tab, st, mv, true, H)) return plan(s, tab, st, mv, depth + 1);
  }
  // it may go as far as the ground it holds reaches
  const held = new Set(mv.claim);
  let stop = blocked;
  for (let i = 0; i < blocked; i++) if (items[i].kind !== 'soft' && !held.has(items[i].key)) { stop = i; break; }
  return { limit: Math.max(0, items[stop].enter - HALF), blocked, holder, key };
}

const posKey = (tab: Tab, mv: Mv): number | null => {
  const p = posOf(mv);
  return p ? keyAt(tab, p[0], p[1], new Set(mv.claim)) : null;
};

// ───────────────────────────── stepping aside ─────────────────────────────

const buildingAt = (s: GameState, gx: number, gz: number): boolean => {
  for (const b of s.buildings) {
    const r = footprintRect(b);
    if (gx >= r.gx0 - 0 && gx < r.gx1 && gz >= r.gz0 && gz < r.gz1) return true;
  }
  return false;
};

/** Move a unit onto the ground beside the road it stands on: into a passing or
 *  holding bay (or a free dock bay) first, else (`ground`) the free ground
 *  beside it. The way there and back is put in front of its path; its claim
 *  takes the cell. False: nowhere to go. */
function stepAside(s: GameState, tab: Tab, st: Store, mv: Mv, ground: boolean, forWhom?: Mv): boolean {
  const h = mv.h!;
  // the cells the unit it gives way to will drive (a free road cell beside it is no place to wait there)
  const avoid = new Set<number>();
  if (forWhom?.h) for (const it of itemsAlong(tab, forWhom.h.x, forWhom.h.z, forWhom.h.path, new Set(forWhom.claim), !driving(forWhom.h))) avoid.add(it.key);
  const [cgx, cgz] = cellAt(h.x, h.z);
  const dir: Pt = h.path.length ? [h.path[0][0] - h.x, h.path[0][1] - h.z] : [0, 0];
  const dl = Math.hypot(dir[0], dir[1]) || 1;
  const at: number[] = [];
  for (const m of tab.units.values()) { const p = posOf(m); if (p) at.push(cellKey(...cellAt(p[0], p[1]))); }
  const cells = new Set(at);
  const cands: { k: number; c: Pt; rank: number; perp: number; n: number }[] = [];
  N4.forEach(([dx, dz], n) => {
    const gx = cgx + dx, gz = cgz + dz;
    const k = cellKey(gx, gz);
    if (holds(tab, k, mv.uid).length) return;
    const road = tab.map.get(k);
    let rank: number;
    if (road) {
      if (road.pass || road.hold) rank = 0;
      else if (road.bay) { if (at.filter((x) => x === k).length >= ROAD.bayCap) return; rank = 0; }
      // (a free road cell that is not on the way of the unit that needs to pass: a last resort, in a tangle)
      else if (ground && !avoid.has(k) && !cells.has(k) && road.left <= 1e-9) rank = 2;
      else return;
    } else {
      if (!ground || cells.has(k) || buildingAt(s, gx, gz)) return;
      rank = 1;
    }
    cands.push({ k, c: [gx, gz], rank, perp: Math.abs((dx * dir[0] + dz * dir[1]) / dl), n });
  });
  cands.sort((p, q) => p.rank - q.rank || p.perp - q.perp || p.n - q.n);
  const pick = cands[0];
  if (!pick) return false;
  const side = cellCentre(pick.c[0], pick.c[1]);
  const home = cellCentre(cgx, cgz);
  const pts: Pt[] = h.path.length ? [side, home] : [side];
  const old = h.path.length;
  h.path.unshift(...pts);
  // (off-road weights: the way out onto open ground is driven at the off-road pace)
  if (h.w) h.w.unshift(...pts.map((_, i) => (i === 0 && pick.rank === 1 ? 1 / ROAD.offroad : 1)));
  else if (pick.rank === 1) h.w = [1 / ROAD.offroad, ...new Array(pts.length - 1 + old).fill(1)];
  // (it lets go of the road it stood on and the run it held: the cell beside it is all it holds until it can go on)
  setClaim(tab, mv, [pick.k]);
  if (pick.rank === 0) st.stats.pullIns++;
  else st.stats.stepAsides++;
  return true;
}

// ───────────────────────────── the tick ─────────────────────────────

/** Economy step 0, before any unit moves: every unit's claim, planned in
 *  priority order (a loaded digger, an empty one, a rover; ties by id).
 *  `ramps`: the pits' ramps (core/hubs.ts rampsOf). */
export function trafficPlan(s: GameState, ramps: Ramp[] = []) {
  const st = storeOf(s);
  st.extra.clear();
  if (trafficOff(s)) { st.tab = null; return; }
  const tab = build(s, ramps);
  st.tab = tab;
  // trim every hauler's claim to its path first (a leg changed since the last tick), then ask in order
  for (const mv of tab.order) {
    if (mv.kind !== 'hauler') continue;
    trim(tab, mv, itemsAlong(tab, mv.h!.x, mv.h!.z, mv.h!.path, new Set(mv.claim), !driving(mv.h!)));
  }
  for (const mv of tab.order) if (mv.kind === 'hauler') plan(s, tab, st, mv);
  // who has been asked to move aside for how many ticks
  for (const k of [...st.ages.keys()]) if (!tab.req.has(k)) st.ages.delete(k);
  for (const k of tab.req.keys()) st.ages.set(k, (st.ages.get(k) ?? 0) + 1);
  let overlaps = 0;
  // (roads only: at a pit's foot, where the floor is a few metres across, two units can be in the ramp's mouth at once)
  for (const [k, l] of tab.owners) if (l.length > 1 && !isRamp(k) && kindOf(tab, k) !== 'soft') overlaps++;
  st.stats.overlaps = overlaps;
}

const tabOf = (s: GameState): Tab | null => (trafficOff(s) ? null : storeOf(s).tab);

/** A unit that stands where a higher-priority one needs to pass, and is not
 *  moving, gives way: into a bay beside it, or after a moment onto the free ground.
 *  Called at the start of the unit's tick. */
export function yieldAside(s: GameState, u: Hauler): boolean {
  const tab = tabOf(s);
  if (!tab) return false;
  const uid = uidOf({ kind: 'hauler', id: u.id });
  if (!tab.req.has(uid)) return false;
  const mv = tab.units.get(uid);
  const h = u.haul;
  if (!mv || (h.phase !== 'toDig' && h.phase !== 'toBay' && h.phase !== 'toDrop')) return false;
  const waiting = (h.held ?? 0) > 0 || (h.phase === 'toDig' && h.wait === 'gate' && !h.path.length);
  if (!waiting) return false;
  const st = storeOf(s);
  const asker = tab.units.get(tab.req.get(uid)!);
  if (stepAside(s, tab, st, mv, false, asker)) return true;
  if ((st.ages.get(uid) ?? 0) >= STILL_ASIDE_S) return stepAside(s, tab, st, mv, true, asker);
  return false;
}

/** Drive a hub unit along its path for up to `t` seconds, as far as its
 *  reservations reach. Returns the time it did not spend driving (on arrival);
 *  a unit held up spends its tick waiting (`h.held` counts it). */
export function go(s: GameState, u: Hauler, speed: number, t: number): number {
  const h = u.haul;
  const tab = tabOf(s);
  const mv = tab?.units.get(uidOf({ kind: 'hauler', id: u.id }));
  if (!tab || !mv) return drive(h, speed, t);
  const st = storeOf(s);
  for (let i = 0; i < 4 && h.path.length && t > 1e-9; i++) {
    const g = plan(s, tab, st, mv);
    const t2 = drive(h, speed, t, g.limit);
    const progressed = t2 < t - 1e-9;
    t = t2;
    if (!h.path.length || t <= 1e-9) break;
    if (!progressed) break;
  }
  // (the claim follows the unit to where it stopped)
  if (h.path.length && t > 1e-9) {
    h.held = (h.held ?? 0) + t;
    st.stats.heldS += t;
    st.stats.maxHeldS = Math.max(st.stats.maxHeldS, h.held);
    t = 0;
  }
  const p = itemsAlong(tab, h.x, h.z, h.path, new Set(mv.claim), !driving(h));
  trim(tab, mv, p);
  return t;
}

/** A rover's step (core/transit.ts): may the one-second stretch of its trip
 *  from `from` through `pts` be driven? Rovers come last: a digger's claim
 *  holds one back (it waits where it stands, its trip's ETA stretches) and a
 *  digger is never held up by a rover (the rovers' lanes pass in the visuals).
 *  Held 20 s in a row (`held`) it drives through, counted. */
export function roverStep(s: GameState, id: number, from: Pt, pts: readonly Pt[], held: number): 'go' | 'held' | 'forced' {
  const tab = tabOf(s);
  const mv = tab?.units.get(uidOf({ kind: 'rover', id }));
  if (!tab || !mv) return 'go';
  const own = keyAt(tab, from[0], from[1], new Set());
  let blocked = false;
  for (const it of itemsAlong(tab, from[0], from[1], pts, new Set())) {
    if (it.kind === 'soft' || it.key === own) continue;
    if (holds(tab, it.key, mv.uid).length) { blocked = true; break; }
  }
  if (!blocked) return 'go';
  if (held < HELD_ASIDE_S) return 'held';
  const st = storeOf(s);
  if (!tab.forced.has(mv.uid)) { tab.forced.add(mv.uid); st.stats.forced++; }
  return 'forced';
}

// ───────────────────────────── holding bays ─────────────────────────────

/** Where a unit sent to a pit with every face working waits: a holding bay
 *  (`hold`) beside one of the zones' gates, else a passing bay near a gate, no
 *  other unit's (null: none — it waits at the gate). World metres. */
export function holdSpot(s: GameState, u: Hauler, zones: readonly string[], gates: readonly (readonly [number, number])[]): Pt | null {
  const map = roadMap(s);
  const taken = new Set<number>();
  for (const o of s.haulers) {
    if (o === u) continue;
    if (o.haul.wait === 'gate') taken.add(cellKey(...cellAt(o.haul.digX, o.haul.digZ)));
    for (const k of o.haul.claim ?? []) taken.add(k);
    taken.add(cellKey(...cellAt(o.haul.x, o.haul.z)));
  }
  const open = (c: { left: number }) => c.left <= 1e-9;
  const hold = [...map.values()].filter((c) => c.hold !== undefined && zones.includes(c.hold) && open(c));
  const pass = [...map.values()].filter((c) => c.pass && open(c) &&
    gates.some(([gx, gz]) => Math.abs(gx - c.gx) + Math.abs(gz - c.gz) <= 6));
  const dist = (c: { gx: number; gz: number }) => Math.min(...gates.map(([gx, gz]) => Math.abs(gx - c.gx) + Math.abs(gz - c.gz)), 99);
  for (const list of [hold, pass]) {
    list.sort((a, b) => dist(a) - dist(b) || cellKey(a.gx, a.gz) - cellKey(b.gx, b.gz));
    const c = list.find((x) => !taken.has(cellKey(x.gx, x.gz)));
    if (c) return cellCentre(c.gx, c.gz);
  }
  return null;
}

// ───────────────────────────── the contract ─────────────────────────────

/** Ask for the road or zone cells (cell keys, core/roads.ts cellKey) `unit` will cross next.
 *  True: they are its own for this tick (a caller asks again each tick) — all or none. */
export function reserve(s: GameState, unit: UnitRef, cells: readonly number[]): boolean {
  const tab = tabOf(s);
  if (!tab) return true;
  const uid = uidOf(unit);
  for (const k of cells) if (holds(tab, k, uid).length) return false;
  const st = storeOf(s);
  const set = st.extra.get(uid) ?? st.extra.set(uid, new Set()).get(uid)!;
  for (const k of cells) { set.add(k); own(tab, uid, k); }
  return true;
}

/** Give the cells back (all of the unit's when `cells` is left out). */
export function release(s: GameState, unit: UnitRef, cells?: readonly number[]): void {
  const tab = tabOf(s);
  if (!tab) return;
  const uid = uidOf(unit);
  const st = storeOf(s);
  const set = st.extra.get(uid);
  const drop = cells ?? [...(set ?? [])];
  for (const k of drop) { set?.delete(k); const mv = tab.units.get(uid); if (!mv || !mv.claim.includes(k)) disown(tab, uid, k); }
}

/** The counters (getRenderInfo().life.traffic.sim). */
export const trafficStats = (s: GameState) => ({ bypass: trafficOff(s), ...storeOf(s).stats });

/** Who holds what, for the debug API: each unit's cell and claim, and every reserved cell's holders. */
export function trafficInfo(s: GameState) {
  const st = storeOf(s);
  const tab = st.tab;
  const cells: Record<string, number[]> = {};
  const units: { kind: string; id: number; cell: Pt | null; claim: Pt[]; held: number; prio: number; limit: number; by: number | null; key: Pt | null }[] = [];
  if (tab) {
    for (const [k, l] of tab.owners) cells[isRamp(k) ? `ramp:${RAMP_BASE - k}` : keyCell(k).join(',')] = l.map((x) => (x >= 0 ? x : -x - 1));
    for (const mv of tab.order) {
      const p = posOf(mv);
      units.push({
        kind: mv.kind, id: mv.id, cell: p ? cellAt(p[0], p[1]) : null, held: mv.h?.held ?? 0, prio: mv.prio,
        limit: mv.last ? (Number.isFinite(mv.last.limit) ? mv.last.limit : -1) : -2,
        key: mv.last?.key !== undefined ? keyCell(mv.last.key) : null,
        by: mv.last && mv.last.holder !== -1 ? (mv.last.holder >= 0 ? mv.last.holder : -mv.last.holder - 1) : null,
        claim: mv.claim.filter((k) => !isRamp(k)).map((k) => keyCell(k)),
      });
    }
  }
  return { bypass: trafficOff(s), ...st.stats, cells, units };
}
