/** Ground traffic on the roads (docs/15-roads.md §6): every construction
 *  rover (world/rovers.ts) and excavator (world/haulers.ts) drives a way
 *  along road cells, and the cells are shared by rule, so no two bodies ever
 *  meet:
 *
 *   - a unit holds every road cell its body covers, plus its braking distance;
 *   - two rovers share a cell only in opposite halves on a straight (the two
 *     lanes, or two parked side by side); anything else — a turn, a junction
 *     crossed, a lane change, an excavator (it is as wide as the road) —
 *     holds the cell whole;
 *   - a unit that cannot take the next cell stops short of it and waits
 *     (queues form by themselves);
 *   - moves are taken in right-of-way order: a loaded excavator, an empty
 *     one, then rovers; among equals the lower id first;
 *   - a wait cycle held 1 s: its lowest unit backs off to a free cell off the
 *     others' ways (its driver finds one); a unit stood in another's way 3 s
 *     steps aside the same way; nothing for 8 s: the lowest is set down on a
 *     free cell (the last resort, never an overlap).
 *
 *  Cells are keyed on the grid (no O(n²)); ways are cut into cell spans once,
 *  when they change. Visual only: the sim never waits. */
import { CELL_M, MAP_M } from '../data/balance';

/** How a unit holds a cell: whole (0), or one half across a lateral axis —
 *  standing there, or driving through it one way or the other. */
export type Mode = number;
export const WHOLE: Mode = 0;
/** a lane: the half at `side` (0 −, 1 +) across the lateral axis (0: x, 1: z),
 *  and the way it drives along the road (0 standing, 1 +, 2 −, 3 turning on the spot) */
export const laneMode = (axis: 0 | 1, side: 0 | 1, dir: 0 | 1 | 2 | 3 = 0): Mode => 1 + axis * 2 + side + 4 * dir;
export const laneAxis = (m: Mode): 0 | 1 => ((((m - 1) % 4) >> 1) as 0 | 1);
export const laneSide = (m: Mode): 0 | 1 => ((((m - 1) % 4) & 1) as 0 | 1);
const laneDir = (m: Mode) => Math.floor((m - 1) / 4);
/** Two holds share a cell: halves across the same axis, and not two driving
 *  side by side the same way (nobody overtakes; a unit passes one standing
 *  or one coming the other way), nor two turning on the spot side by side. */
const compatible = (a: Mode, b: Mode) => a !== WHOLE && b !== WHOLE && laneAxis(a) === laneAxis(b) && laneSide(a) !== laneSide(b)
  && !(laneDir(a) !== 0 && laneDir(a) === laneDir(b));

export interface Span {
  key: number;
  /** arc interval along the way inside the cell */
  a0: number; a1: number;
  mode: Mode;
  /** a road cell (the traffic shares it out); off-road (an excavator's pad) is its own */
  road: boolean;
}

export interface Agent {
  kind: 'rover' | 'digger';
  id: number;
  /** stable order: diggers by id, then rovers */
  key: number;
  /** the origin, and its forward unit vector */
  x: number; z: number; fx: number; fz: number;
  /** the body: half-width, and how far it reaches ahead of and behind its origin */
  hw: number; front: number; back: number;
  wide: boolean;
  /** right of way: higher goes first */
  cls: number;
  /** the way it drives (from a back-length behind where it started), arcs, cells */
  pts: [number, number][];
  arcs: number[];
  spans: Span[];
  /** where it is along the way, its speed, the speed it wants, and how far it may go */
  s: number; v: number; vmax: number; stop: number;
  accel: number; decel: number;
  /** how it holds the cell its way ends in once there (its slot's half), or WHOLE */
  standMode: Mode;
  /** the cells held now */
  held: Map<number, Mode>;
  /** who it is waiting on, and for how long */
  blocker: Agent | null;
  waited: number;
  /** turning on the spot (an excavator's tracks): it needs every road cell
   *  its body sweeps, and `pivotOk` says it has them */
  pivot?: boolean;
  pivotOk?: boolean;
  /** backing up: its front trails */
  reverse?: boolean;
  /** a wide unit's gates: where its way enters a junction (or the road), and
   *  the cells from there to the next junction (or its way's end) it takes
   *  all at once before its body enters — it waits short of the gate until
   *  they are free — and the cells it has so taken, held until passed */
  gates?: { at: number; keys: number[]; taken: boolean }[];
  reserved?: Set<number>;
  /** the last arc each cell of its way is under (reserved cells go when passed) */
  lastArc?: Map<number, number>;
  drv: Driver;
}

export interface Driver {
  /** set vmax and stop (and change its way through Traffic.setWay if it must) */
  prefer(a: Agent, dt: number): void;
  /** the traffic moved it to arc s: take up the pose */
  moved(a: Agent, dt: number): void;
  /** get out of these units' way (a refuge off their ways); false if it cannot */
  yieldTo(a: Agent, others: Agent[]): boolean;
  /** the last resort: set it down somewhere free */
  rescue(a: Agent): void;
}

export const gridKey = (gx: number, gz: number) => gz * 4096 + gx;
const cellOf = (x: number, z: number) =>
  [Math.floor((x + MAP_M / 2) / CELL_M), Math.floor((z + MAP_M / 2) / CELL_M)] as [number, number];

/** The polyline's arcs. */
function arcsOf(pts: [number, number][], start: number): number[] {
  const out = [start];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return out;
}

/** The point and heading at arc u. */
export function pointAt(pts: [number, number][], arcs: number[], u: number): { x: number; z: number; dx: number; dz: number } {
  if (pts.length === 1) return { x: pts[0][0], z: pts[0][1], dx: 0, dz: 1 };
  let i = 1;
  while (i < pts.length - 1 && arcs[i] < u) i++;
  // a zero-length piece has no heading: look on along the way
  let j = i;
  while (j < pts.length - 1 && arcs[j] - arcs[j - 1] < 1e-9) j++;
  const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
  const l = arcs[i] - arcs[i - 1];
  const k = l > 1e-9 ? Math.max(0, Math.min(1, (u - arcs[i - 1]) / l)) : 1;
  const hx = pts[j][0] - pts[j - 1][0], hz = pts[j][1] - pts[j - 1][1], hl = Math.hypot(hx, hz) || 1;
  return { x: ax + (bx - ax) * k, z: az + (bz - az) * k, dx: hx / hl, dz: hz / hl };
}

/** Cut a way into the cells it crosses, in order, with how each is held. */
export function cutSpans(pts: [number, number][], arcs: number[], wide: boolean, isRoad: (key: number) => boolean): Span[] {
  const out: (Span & { e: [number, number]; x: [number, number]; bent: boolean })[] = [];
  const add = (gx: number, gz: number, a0: number, a1: number, p: [number, number], q: [number, number]) => {
    if (a1 - a0 < 1e-6) return;
    const key = gridKey(gx, gz);
    const last = out[out.length - 1];
    if (last && last.key === key) {
      // a second piece in the same cell: bent unless it carries straight on
      const ux = last.x[0] - last.e[0], uz = last.x[1] - last.e[1];
      const vx = q[0] - p[0], vz = q[1] - p[1];
      last.bent ||= Math.abs(ux * vz - uz * vx) > 1e-3 * (Math.hypot(ux, uz) * Math.hypot(vx, vz) + 1e-9);
      last.a1 = a1;
      last.x = q;
      return;
    }
    out.push({ key, a0, a1, mode: WHOLE, road: isRoad(key), e: p, x: q, bent: false });
  };
  const half = MAP_M / 2;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const len = arcs[i] - arcs[i - 1];
    if (len < 1e-9) continue;
    // where the segment crosses grid lines
    const ts = [0, 1];
    for (const [p, q] of [[ax, bx], [az, bz]]) {
      if (Math.abs(q - p) < 1e-12) continue;
      const lo = Math.min(p, q), hi = Math.max(p, q);
      for (let g = Math.ceil((lo + half) / CELL_M) * CELL_M - half; g < hi; g += CELL_M) {
        if (g > lo) ts.push((g - p) / (q - p));
      }
    }
    ts.sort((a, b) => a - b);
    for (let k = 1; k < ts.length; k++) {
      const t0 = ts[k - 1], t1 = ts[k];
      if (t1 - t0 < 1e-9) continue;
      const tm = (t0 + t1) / 2;
      const [gx, gz] = cellOf(ax + (bx - ax) * tm, az + (bz - az) * tm);
      add(gx, gz, arcs[i - 1] + len * t0, arcs[i - 1] + len * t1,
        [ax + (bx - ax) * t0, az + (bz - az) * t0], [ax + (bx - ax) * t1, az + (bz - az) * t1]);
    }
  }
  for (const sp of out) {
    if (wide || sp.bent) continue;
    // a lane: one straight piece along an axis, held off the centre line
    const dx = sp.x[0] - sp.e[0], dz = sp.x[1] - sp.e[1];
    const gx = sp.key % 4096, gz = Math.floor(sp.key / 4096);
    const cx = (gx + 0.5) * CELL_M - half, cz = (gz + 0.5) * CELL_M - half;
    if (Math.abs(dz) < 1e-3 && Math.abs(dx) > 1e-3) {
      const o0 = sp.e[1] - cz, o1 = sp.x[1] - cz;
      if (Math.sign(o0) === Math.sign(o1) && Math.min(Math.abs(o0), Math.abs(o1)) > 0.4) sp.mode = laneMode(1, o0 > 0 ? 1 : 0, dx > 0 ? 1 : 2);
    } else if (Math.abs(dx) < 1e-3 && Math.abs(dz) > 1e-3) {
      const o0 = sp.e[0] - cx, o1 = sp.x[0] - cx;
      if (Math.sign(o0) === Math.sign(o1) && Math.min(Math.abs(o0), Math.abs(o1)) > 0.4) sp.mode = laneMode(0, o0 > 0 ? 1 : 0, dz > 0 ? 1 : 2);
    }
  }
  return out.map(({ key, a0, a1, mode, road }) => ({ key, a0, a1, mode, road }));
}

/** m a unit stops short of a cell it may not enter: room for a rover's
 *  corners as it turns (its diagonal is 0.21 m longer than its nose) */
const GAP = 0.25;
const BREAK_S = 1;       // a wait cycle this old is broken
const STEP_ASIDE_S = 3;  // a unit stood in another's way this long steps aside
const RESCUE_S = 8;      // nothing worked this long: set down

export class Traffic {
  /** every unit on the ground this frame, in key order */
  agents: Agent[] = [];
  /** road cells (open or bays), by the grid key the spans use */
  private roads = new Set<number>();
  private roadSig = '';
  private occ = new Map<number, { a: Agent; mode: Mode }[]>();
  /** after an error: units drive their ways unchecked (fail soft) */
  private solo = false;
  private worst = { gap: Infinity, a: '', b: '' };
  private rescues = 0;
  private breaks = 0;
  private lastBreak = '';

  /** The road cells (grid cells) units may drive; a signature skips unchanged frames. */
  setRoads(sig: string, cells: readonly [number, number][]) {
    if (sig === this.roadSig) return;
    this.roadSig = sig;
    this.roads = new Set(cells.map(([gx, gz]) => gridKey(gx, gz)));
    this.junctions = new Set([...this.roads].filter((k) => this.degree(k) >= 3));
    for (const a of this.agents) { a.spans = cutSpans(a.pts, a.arcs, a.wide, (k) => this.roads.has(k)); this.markGates(a); }
  }
  /** road cells where three or more roads meet (units wait short of them) */
  private junctions = new Set<number>();
  get roadSignature() { return this.roadSig; }
  isRoad(gx: number, gz: number) { return this.roads.has(gridKey(gx, gz)); }

  /** Replace one kind's units (the list keeps key order); the leavers let go of their cells. */
  enlist(kind: Agent['kind'], units: Agent[]) {
    const keep = new Set(units);
    for (const a of this.agents) if (a.kind === kind && !keep.has(a)) this.releaseAll(a);
    this.agents = [...this.agents.filter((a) => a.kind !== kind), ...units].sort((p, q) => p.key - q.key);
  }

  /** A new way for a unit from where it stands (`pts[0]` is its position). */
  setWay(a: Agent, pts: [number, number][]) {
    // a body-length behind it, straight back from the way's first piece (its body lies there)
    const L = Math.max(a.front, a.back);
    let [ux, uz] = [a.fx, a.fz];
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[0][0], dz = pts[i][1] - pts[0][1], l = Math.hypot(dx, dz);
      if (l > 0.05) { ux = dx / l; uz = dz / l; break; }
    }
    const back: [number, number] = [pts[0][0] - ux * L, pts[0][1] - uz * L];
    a.pts = [back, ...pts];
    a.arcs = arcsOf(a.pts, -L);
    a.spans = cutSpans(a.pts, a.arcs, a.wide, (k) => this.roads.has(k));
    a.s = 0;
    a.stop = Traffic.end(a);
    this.markGates(a);
  }

  /** road neighbours of a cell */
  private degree(key: number): number {
    const gx = key % 4096, gz = Math.floor(key / 4096);
    let n = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (this.roads.has(gridKey(gx + dx, gz + dz))) n++;
    return n;
  }

  /** A wide unit's gates (see Agent.gates): nothing passes an excavator on
   *  a road, so it takes the run of cells to the next junction whole before
   *  it enters — and waits short of the junction, leaving it clear, if
   *  anyone is in that run. (A run up a dead end is taken to the way's end.) */
  private markGates(a: Agent) {
    a.gates = [];
    a.reserved = new Set();
    a.lastArc = new Map();
    for (const sp of a.spans) if (sp.road) a.lastArc.set(sp.key, Math.max(a.lastArc.get(sp.key) ?? -Infinity, sp.a1));
    if (!a.wide) return;
    const sp = a.spans;
    const lead = Traffic.ahead(a);
    for (let k = 0; k < sp.length; k++) {
      if (!sp[k].road || sp[k].a0 < lead - 1e-6) continue;
      // at a junction, where the way comes onto the road, and the first cell ahead
      if (!(this.junctions.has(sp[k].key) || k === 0 || !sp[k - 1].road || !a.gates.length)) continue;
      const keys = [sp[k].key];
      for (let m = k + 1; m < sp.length && sp[m].road && !this.junctions.has(sp[m].key); m++) keys.push(sp[m].key);
      a.gates.push({ at: sp[k].a0, keys, taken: false });
    }
  }

  /** The arc a way ends at. */
  static end(a: Agent) { return a.arcs.length ? a.arcs[a.arcs.length - 1] : 0; }

  /** The cells a unit holds now (grid coords), and who else holds them. */
  heldBy(a: Agent): [number, number][] { return [...a.held.keys()].map((k) => [k % 4096, Math.floor(k / 4096)]); }
  /** Is this cell held (whole, or in any half) by anyone but `a`? */
  taken(a: Agent | null, gx: number, gz: number): boolean {
    return (this.occ.get(gridKey(gx, gz)) ?? []).some((o) => o.a !== a);
  }
  /** The cells a way's body would cover at arc u (road cells only). */
  cellsAt(a: Agent, u: number): number[] {
    const out: number[] = [];
    for (const sp of a.spans) if (sp.road && sp.a1 > u - a.back && sp.a0 < u + a.front) out.push(sp.key);
    return out;
  }
  /** The road cells in a unit's way ahead (from s, `ahead` metres) and those it holds. */
  claimOf(a: Agent, ahead: number): Set<number> {
    const out = new Set<number>(a.held.keys());
    for (const sp of a.spans) if (sp.road && sp.a1 > a.s && sp.a0 < a.s + ahead) out.add(sp.key);
    return out;
  }
  /** Is this grid key held by anyone but `a`? */
  heldByOther(a: Agent, key: number): boolean {
    return (this.occ.get(key) ?? []).some((o) => o.a !== a);
  }
  /** Is this cell's half free for `a` (lane mode m)? */
  fits(a: Agent | null, gx: number, gz: number, m: Mode): boolean {
    return !(this.occ.get(gridKey(gx, gz)) ?? []).some((o) => o.a !== a && !compatible(o.mode, m));
  }

  private releaseAll(a: Agent) {
    for (const k of a.held.keys()) this.release(a, k);
    a.held.clear();
  }
  private release(a: Agent, k: number) {
    const l = this.occ.get(k);
    if (!l) return;
    const i = l.findIndex((o) => o.a === a);
    if (i >= 0) l.splice(i, 1);
    if (!l.length) this.occ.delete(k);
  }
  private hold(a: Agent, k: number, mode: Mode) {
    if (a.held.get(k) === mode) return;
    const l = this.occ.get(k) ?? this.occ.set(k, []).get(k)!;
    const o = l.find((x) => x.a === a);
    if (o) o.mode = mode; else l.push({ a, mode });
    a.held.set(k, mode);
  }
  /** who in cell k would clash with `mode` (none: null) */
  private clash(a: Agent, k: number, mode: Mode): Agent | null {
    const l = this.occ.get(k);
    if (!l) return null;
    for (const o of l) if (o.a !== a && !compatible(o.mode, mode)) return o.a;
    return null;
  }

  /** how a unit holds span `sp`: as its way crosses it, and once it stands at
   *  the end of its way, the last cell in its slot's half */
  private modeOf(a: Agent, sp: Span, end: number): Mode {
    if (sp.a1 < end - 1e-6 || a.standMode === WHOLE) return sp.mode;
    return a.s >= end - 1e-6 ? a.standMode : sp.mode;
  }

  /** Road cells a disc round (x, z) touches (a pivot's sweep). */
  private disc(x: number, z: number, r: number, out: Map<number, Mode>) {
    const half = MAP_M / 2;
    const i0 = Math.floor((x - r + half) / CELL_M), i1 = Math.floor((x + r + half) / CELL_M);
    const k0 = Math.floor((z - r + half) / CELL_M), k1 = Math.floor((z + r + half) / CELL_M);
    for (let k = k0; k <= k1; k++) {
      for (let i = i0; i <= i1; i++) {
        const key = gridKey(i, k);
        if (!this.roads.has(key)) continue;
        const cx = Math.max(i * CELL_M - half, Math.min(x, (i + 1) * CELL_M - half));
        const cz = Math.max(k * CELL_M - half, Math.min(z, (k + 1) * CELL_M - half));
        if (Math.hypot(cx - x, cz - z) < r) out.set(key, WHOLE);
      }
    }
  }

  /** The road cells a turn on the spot sweeps (a disc round its origin), and
   *  how: an excavator's whole; a rover's own cell only in the half it stands
   *  in (a rover turning in its lane stays clear of one in the other half),
   *  a neighbour it just reaches in the half by that edge. */
  private sweep(a: Agent, out: Map<number, Mode>) {
    const r = Math.hypot(Math.max(a.front, a.back), a.hw);
    this.disc(a.x, a.z, r, out);
    if (a.wide) return;
    const half = MAP_M / 2;
    const [gx, gz] = cellOf(a.x, a.z);
    for (const k of out.keys()) {
      const i = k % 4096, j = Math.floor(k / 4096);
      const cx = (i + 0.5) * CELL_M - half, cz = (j + 0.5) * CELL_M - half;
      if (i === gx && j === gz) {
        const ox = a.x - cx, oz = a.z - cz;
        if (Math.abs(ox) > 0.6 && Math.abs(oz) < 0.2) out.set(k, laneMode(0, ox > 0 ? 1 : 0, 3));
        else if (Math.abs(oz) > 0.6 && Math.abs(ox) < 0.2) out.set(k, laneMode(1, oz > 0 ? 1 : 0, 3));
        continue;
      }
      // a neighbour: the half facing this unit
      if (i !== gx && j === gz) out.set(k, laneMode(0, i < gx ? 1 : 0));
      else if (j !== gz && i === gx) out.set(k, laneMode(1, j < gz ? 1 : 0));
    }
  }

  /** Road cells a unit's box touches at a pose (a wide unit's overhang on corners). */
  private box(a: Agent, x: number, z: number, fx: number, fz: number, out: Map<number, Mode>, lead = 0) {
    const half = MAP_M / 2;
    const rx = fz, rz = -fx;
    // a hair inside the body, so a nose exactly on a cell's edge does not claim it
    // (`lead`: that much further at the end it drives toward — a check's margin)
    const f = a.front + (a.reverse ? 0 : lead), b = a.back + (a.reverse ? lead : 0);
    const n = Math.max(4, Math.ceil(f + b));
    const e = 0.001;
    for (let i = 0; i <= n; i++) {
      const l = -b + e + (f + b - 2 * e) * i / n;
      for (const w of [-a.hw + e, 0, a.hw - e]) {
        const px = x + fx * l + rx * w, pz = z + fz * l + rz * w;
        const key = gridKey(Math.floor((px + half) / CELL_M), Math.floor((pz + half) / CELL_M));
        if (this.roads.has(key)) out.set(key, WHOLE);
      }
    }
  }

  private boxScratch = new Map<number, Mode>();
  /** Would a unit's box at this pose touch only road cells free for it? */
  boxFree(a: Agent, x: number, z: number, fx: number, fz: number): boolean {
    const cov = this.boxScratch;
    cov.clear();
    this.box(a, x, z, fx, fz, cov);
    for (const k of cov.keys()) if (!a.held.has(k) && this.clash(a, k, WHOLE)) return false;
    return true;
  }

  /** The cells a unit's body covers from arc s0 to s1 (and a pivot's sweep). */
  private covered(a: Agent, s0: number, s1: number, out: Map<number, Mode>) {
    out.clear();
    const turning = !!(a.pivot && a.pivotOk);
    if (turning) this.sweep(a, out);
    const end = Traffic.end(a);
    for (const sp of a.spans) {
      if (sp.a1 <= s0 || sp.a0 >= s1 || !sp.road || (turning && out.has(sp.key))) continue;
      const mode = this.modeOf(a, sp, end);
      const was = out.get(sp.key);
      out.set(sp.key, was === undefined || was === mode ? mode : WHOLE);
    }
  }

  /** how far the body reaches ahead of and behind its origin along the way */
  private static ahead(a: Agent) { return a.reverse ? a.back : a.front; }
  private static behind(a: Agent) { return a.reverse ? a.front : a.back; }

  private scratch = new Map<number, Mode>();

  /** Advance every unit by dt game-seconds in substeps of ≤ 0.05 s. */
  step(dt: number) {
    if (!this.agents.length) return;
    if (dt <= 0) {
      // paused: nobody moves, but new units take up their cells
      for (const a of this.agents) this.settle(a);
      return;
    }
    const steps = Math.min(40, Math.ceil(dt / 0.05));
    const h = dt / steps;
    const order = [...this.agents].sort((p, q) => q.cls - p.cls || p.key - q.key);
    for (let k = 0; k < steps; k++) {
      for (const a of this.agents) a.drv.prefer(a, h);
      try {
        for (const a of order) this.advance(a, h);
        if (!this.solo) this.breakDeadlocks();
      } catch (e) {
        this.solo = true;
        console.warn('[MOONSHOTS] road traffic disabled after an error.', e);
      }
    }
    this.measure();
  }

  /** a gate's cells stay held until the body has passed them */
  private keepReserved(a: Agent, cov: Map<number, Mode>) {
    if (!a.reserved?.size) return;
    const tail = a.s - Traffic.behind(a);
    for (const k of [...a.reserved]) {
      if (tail >= (a.lastArc?.get(k) ?? -Infinity) - 1e-6) a.reserved.delete(k);
      else cov.set(k, WHOLE);
    }
  }

  /** Hold what the body covers where it stands (no move). */
  private settle(a: Agent) {
    const cov = this.scratch;
    this.covered(a, a.s - Traffic.behind(a), a.s + Traffic.ahead(a), cov);
    if (a.wide) this.box(a, a.x, a.z, a.fx, a.fz, cov);
    this.keepReserved(a, cov);
    this.take(a, cov);
  }

  /** Hold exactly `cov`: let go of the rest; a cell it holds already keeps
   *  its old hold where the new one would clash with another's (it was never
   *  cleared for that — it waits in what it had). */
  private take(a: Agent, cov: Map<number, Mode>) {
    for (const k of [...a.held.keys()]) if (!cov.has(k)) { this.release(a, k); a.held.delete(k); }
    for (const [k, m] of cov) {
      const had = a.held.get(k);
      if (had !== undefined && had !== m && this.clash(a, k, m)) continue;
      this.hold(a, k, m);
    }
  }

  private advance(a: Agent, h: number) {
    const end = Traffic.end(a);
    const front = Traffic.ahead(a), back = Traffic.behind(a);
    // a pivot first takes every road cell its body sweeps, or waits for them
    if (a.pivot) {
      const cov = this.scratch;
      cov.clear();
      this.sweep(a, cov);
      let c: Agent | null = null;
      for (const [k, m] of cov) { if (a.held.get(k) !== m) c = this.clash(a, k, m); if (c) break; }
      a.pivotOk = !c;
      if (c) { a.blocker = c; a.waited += h; a.v = 0; a.drv.moved(a, h); return; }
    }
    const want = Math.max(0, Math.min(a.vmax, a.v + a.accel * h));
    let ds = Math.min(want * h, Math.max(0, Math.min(a.stop, end) - a.s));
    let limit = Infinity;
    let blocker: Agent | null = null;
    // a wide unit's box overhangs a corner: every road cell it would touch must be free
    if (!this.solo && a.wide && ds > 0) {
      const p = pointAt(a.pts, a.arcs, a.s + ds);
      const cov = this.scratch;
      cov.clear();
      this.box(a, p.x, p.z, a.fx, a.fz, cov, GAP);
      for (const k of cov.keys()) {
        if (a.held.has(k)) continue;
        const c = this.clash(a, k, WHOLE);
        if (c) { ds = 0; limit = a.s; blocker = c; break; }
      }
    }
    const look = (want * want) / (2 * a.decel) + 0.3;
    // a wide unit's next gate: the run to the next junction, taken whole, or it waits short of it
    if (!this.solo && a.gates?.length && limit === Infinity) {
      for (const g of a.gates) {
        if (g.taken) continue;
        if (g.at < a.s + front - 1e-3) { g.taken = true; continue; } // in it already (set down there)
        if (g.at > a.s + ds + front + look) break;
        let c: Agent | null = null;
        for (const k of g.keys) { if (a.held.get(k) !== WHOLE) c = this.clash(a, k, WHOLE); if (c) break; }
        if (c) {
          limit = Math.max(a.s, g.at - front - GAP);
          blocker = c;
          const gap = Math.max(0, limit - a.s);
          ds = Math.min(ds, gap, Math.sqrt(2 * a.decel * gap) * h);
          break;
        }
        g.taken = true;
        for (const k of g.keys) { a.reserved!.add(k); this.hold(a, k, WHOLE); }
      }
    }
    if (!this.solo && limit === Infinity) {
      const reach = a.s + ds + front + look;
      const sp = a.spans;
      for (let i = 0; i < sp.length; i++) {
        if (sp[i].a0 >= reach) break;
        // behind its origin its body is there already: only what it drives into is checked
        if (!sp[i].road || sp[i].a1 <= a.s + 1e-6) continue;
        const mode = this.modeOf(a, sp[i], end);
        const had = a.held.get(sp[i].key);
        if (had === mode) continue;
        // in that half already: it keeps to it (a new heading there crowds nobody)
        if (had !== undefined && had !== WHOLE && mode !== WHOLE && laneAxis(had) === laneAxis(mode) && laneSide(had) === laneSide(mode)) continue;
        const c = this.clash(a, sp[i].key, mode);
        if (!c) continue;
        limit = Math.max(a.s, sp[i].a0 - front - GAP);
        // not stopped in a junction: short of it, if it is not in it yet
        const j = sp[i - 1];
        if (j && j.road && this.junctions.has(j.key) && !a.held.has(j.key) && j.a0 - front - GAP > a.s) limit = j.a0 - front - GAP;
        blocker = c;
        break;
      }
      if (limit < Infinity) {
        const gap = Math.max(0, limit - a.s);
        ds = Math.min(ds, gap, Math.sqrt(2 * a.decel * gap) * h);
      }
    }
    a.s += ds;
    a.v = ds / h;
    if (blocker && ds < want * h - 1e-6) { a.blocker = blocker; a.waited += h; } else { a.blocker = null; a.waited = 0; }
    // hold the body's cells and the braking distance ahead, up to the limit
    const cov = this.scratch;
    const brake = (a.v * a.v) / (2 * a.decel) + 0.3;
    this.covered(a, a.s - back, Math.min(a.s + front + brake, limit + front), cov);
    const p = pointAt(a.pts, a.arcs, a.s);
    if (a.wide) this.box(a, p.x, p.z, a.fx, a.fz, cov);
    this.keepReserved(a, cov);
    this.take(a, cov);
    a.drv.moved(a, h);
  }

  /** Wait cycles and units stood in the way (see the file comment). */
  private breakDeadlocks() {
    for (const a of this.agents) {
      if (!a.blocker || a.waited < BREAK_S) continue;
      const chain: Agent[] = [a];
      let b: Agent | null = a.blocker;
      while (b && !chain.includes(b) && chain.length < 32) { chain.push(b); b = b.blocker; }
      if (b === a) {
        // a cycle: the lowest gives way (then the next, if it cannot)
        const ranked = [...chain].sort((p, q) => p.cls - q.cls || q.key - p.key);
        let done = false;
        for (const y of ranked) {
          if (y.drv.yieldTo(y, chain.filter((c) => c !== y))) { done = true; break; }
        }
        if (done) { this.breaks++; this.lastBreak = ranked.map((c) => `${c.kind}#${c.id}`).join('>'); for (const c of chain) c.waited = 0; }
        else if (a.waited > RESCUE_S) { this.rescue(ranked[0]); for (const c of chain) c.waited = 0; }
        continue;
      }
      // stood in the way: a unit at the end of its way (parked, working) steps aside
      const w = a.blocker;
      const standing = !w.blocker && w.s >= Traffic.end(w) - 1e-6;
      if (standing && a.waited > STEP_ASIDE_S && (w.cls < a.cls || (w.cls === a.cls && w.key > a.key))) {
        if (w.drv.yieldTo(w, [a])) { this.breaks++; a.waited = 0; }
        else if (a.waited > RESCUE_S) { this.rescue(w); a.waited = 0; }
      }
    }
  }

  /** Let go of everything a unit holds (it was set down elsewhere, or went inside). */
  drop(a: Agent) { this.releaseAll(a); }
  /** Take up the cells a unit stands on now (after a jump). */
  place(a: Agent) { this.settle(a); }

  private rescue(a: Agent) {
    this.rescues++;
    this.releaseAll(a);
    a.drv.rescue(a);
    this.settle(a);
  }

  // ── the overlap metric: oriented boxes ──

  private measure() {
    const grid = new Map<number, Agent[]>();
    const G = 8;
    const at = (a: Agent) => [Math.floor(a.x / G) + 2048, Math.floor(a.z / G) + 2048];
    for (const a of this.agents) {
      const [i, k] = at(a);
      const key = gridKey(i, k);
      (grid.get(key) ?? grid.set(key, []).get(key)!).push(a);
    }
    for (const a of this.agents) {
      const [i, k] = at(a);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        for (const b of grid.get(gridKey(i + dx, k + dz)) ?? []) {
          if (b.key <= a.key) continue;
          const gap = boxGap(a, b);
          if (gap < this.worst.gap) this.worst = { gap, a: `${a.kind}#${a.id}`, b: `${b.kind}#${b.id}` };
        }
      }
    }
  }

  info() {
    const w = this.worst;
    this.worst = { gap: Infinity, a: '', b: '' };
    return {
      solo: this.solo,
      /** the least separation of any two bodies since the last read, m (negative: overlapping) */
      closest: Number.isFinite(w.gap) ? { gap: Math.round(w.gap * 1000) / 1000, a: w.a, b: w.b } : null,
      /** wait cycles broken, and units set down as the last resort */
      breaks: this.breaks,
      rescues: this.rescues,
      units: this.agents.map((a) => ({
        kind: a.kind, id: a.id, x: Math.round(a.x * 100) / 100, z: Math.round(a.z * 100) / 100,
        yaw: Math.round(Math.atan2(a.fx, a.fz) * 1000) / 1000, hw: a.hw, front: a.front, back: a.back,
        cls: a.cls, waiting: a.blocker ? `${a.blocker.kind}#${a.blocker.id}` : '', waited: Math.round(a.waited * 10) / 10,
        cells: this.heldBy(a),
        /** debug: where it is along its way, the way, and the modes it holds */
        s: Math.round(a.s * 100) / 100, pivot: !!a.pivot, pivotOk: !!a.pivotOk,
        way: a.pts.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]),
        modes: [...a.held.values()],
      })),
      /** the last wait cycle broken (who, lowest first) */
      lastBreak: this.lastBreak,
    };
  }
}

/** Separation of two units' bodies (oriented boxes), m: the largest gap along
 *  any separating axis (a lower bound on the true distance), negative when
 *  they overlap (the least penetration). */
export function boxGap(a: Pick<Agent, 'x' | 'z' | 'fx' | 'fz' | 'hw' | 'front' | 'back'>, b: Pick<Agent, 'x' | 'z' | 'fx' | 'fz' | 'hw' | 'front' | 'back'>): number {
  const corners = (u: typeof a) => {
    const rx = u.fz, rz = -u.fx; // the right-hand side
    const out: [number, number][] = [];
    for (const [l, w] of [[u.front, u.hw], [u.front, -u.hw], [-u.back, -u.hw], [-u.back, u.hw]]) {
      out.push([u.x + u.fx * l + rx * w, u.z + u.fz * l + rz * w]);
    }
    return out;
  };
  const A = corners(a), B = corners(b);
  let best = -Infinity;
  for (const [ax, az] of [[a.fx, a.fz], [a.fz, -a.fx], [b.fx, b.fz], [b.fz, -b.fx]]) {
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (const [x, z] of A) { const p = x * ax + z * az; amin = Math.min(amin, p); amax = Math.max(amax, p); }
    for (const [x, z] of B) { const p = x * ax + z * az; bmin = Math.min(bmin, p); bmax = Math.max(bmax, p); }
    best = Math.max(best, Math.max(bmin - amax, amin - bmax));
  }
  return best;
}
