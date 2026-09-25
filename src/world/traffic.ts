/** Ground traffic: every unit that drives about the base — the construction
 *  rovers (world/rovers.ts) and the excavators away from their pads
 *  (world/haulers.ts) — as circles that never pass through each other.
 *
 *  Each substep a unit's driver names the velocity it wants (follow the
 *  path; a digger keeps up with the sim). Nothing near: it gets that. With
 *  neighbours close, it picks the best of a fixed fan of velocities round
 *  the wanted one (sampled velocity obstacles): cost = how far it strays +
 *  how soon it would touch someone + a little for changing its mind, so it
 *  does not dither. Right of way is a fixed order — a loaded excavator,
 *  then an empty one, then rovers; among equals the one standing still
 *  (parked, working, digging) is an obstacle and the lower id goes first. A
 *  unit that must yield looks 3 s ahead; one with right of way only 0.4 s,
 *  so the other side moves first. Everyone veers to the same hand.
 *
 *  Then the moves are taken in right-of-way order, each checked against the
 *  others' new places: a move that would bring two bodies closer than their
 *  radii (or a body into a foreign footprint) is not taken — the unit waits.
 *  Neighbours come from a spatial hash, footprints from another: no O(n²).
 *  Visual only: the sim never reads any of it. */
import { PATH_HALF, inside, type Rect } from '../core/paths';

export interface Pose { x: number; z: number; fx: number; fz: number }

export interface Agent {
  kind: 'rover' | 'digger';
  id: number;
  /** stable order: diggers, then rovers, by id */
  key: number;
  /** the unit's origin, its forward unit vector, its velocity (last substep) */
  x: number; z: number; fx: number; fz: number; vx: number; vz: number;
  /** body circle: radius, and how far its centre leads the origin */
  r: number; off: number;
  /** least distance the body's centre keeps off a foreign wall */
  wallM: number;
  /** right of way: higher goes first */
  cls: number;
  /** parked, working, digging: an obstacle to its equals, not a traveller */
  still: boolean;
  /** never moves aside (an excavator square on its own pad) */
  anchored: boolean;
  /** the footprint it may stand in (its own pad) */
  home: number | null;
  /** cruise speed, m/s (the dodge and the costs scale by it) */
  cruise: number;
  /** the velocity its driver wants this substep, and how far it has left to
   *  go (m; Infinity: no end in sight). A unit stops where it is going, so a
   *  touch predicted past that is no reason to hold back. */
  pvx: number; pvz: number; reach: number;
  /** waited this substep: a move was refused */
  held: boolean;
  drv: Driver;
}

export interface Driver {
  /** set a.pvx / a.pvz: the velocity a wants now */
  prefer(a: Agent, dt: number): void;
  /** where a would be after driving at (vx, vz) for dt (its own dynamics);
   *  `turn`: only turn toward (vx, vz), standing where it is */
  propose(a: Agent, vx: number, vz: number, dt: number, out: Pose, turn?: boolean): void;
  /** the move is taken (p), or refused (null) */
  commit(a: Agent, p: Pose | null, dt: number): void;
}

const TAU_YIELD = 3;      // s looked ahead by a unit that gives way
const TAU_MUTUAL = 1.2;   // s by one with right of way over a moving equal
const TAU_HARD = 0.4;     // s by one with right of way
const BUFFER = 0.25;      // m kept beyond touching when planning a pass
const HASH = 8;           // m per neighbour-hash cell
const RECT_HASH = 16;     // m per footprint-hash cell
const MAX_R = 3.6;        // the largest body radius
const W_COLLIDE = 4, W_CHANGE = 0.25, W_HAND = 0.04;
/** the fan: angles off the wanted heading (negative first: everyone veers to the same hand) */
const FAN = [0, -0.3, 0.3, -0.6, 0.6, -0.9, 0.9, -1.3, 1.3, -1.8, 1.8, -2.4, 2.4, Math.PI];
const SPEEDS = [1, 0.6, 0.3];

const hashKey = (i: number, k: number) => (i + 4096) * 8192 + (k + 4096);

export class Traffic {
  /** every unit on the ground this frame, in key order */
  agents: Agent[] = [];
  rects: Rect[] = [];
  /** the ground planners keep off besides the footprints (excavators' digs away from their pads) */
  keepOuts: Rect[] = [];
  private rectSig = '';
  /** the signature of the footprints and keep-outs held */
  get groundSig() { return this.rectSig; }
  private rectHash = new Map<number, Rect[]>();
  private hash = new Map<number, Agent[]>();
  private order: Agent[] = [];
  private pose: Pose = { x: 0, z: 0, fx: 0, fz: 1 };
  /** avoidance failed once: units drive their paths unchecked (fail soft) */
  private solo = false;
  /** closest pair seen since the last read (tests, probes), m below the radii sum */
  private worst = { gap: Infinity, a: '', b: '' };

  /** Replace one kind's units (the list keeps key order). */
  enlist(kind: Agent['kind'], units: Agent[]) {
    this.agents = [...this.agents.filter((a) => a.kind !== kind), ...units].sort((p, q) => p.key - q.key);
  }

  /** What a unit plans round: every footprint but its own pad, and the keep-outs but its own. */
  planRects(own: number | null = null): Rect[] {
    return [...this.rects.filter((r) => r.id !== own), ...this.keepOuts.filter((r) => r.id !== -1000 - (own ?? -1))];
  }

  /** Footprints in world metres (a signature skips unchanged frames). */
  setRects(sig: string, rects: Rect[], keepOuts: Rect[] = []) {
    if (sig === this.rectSig) return;
    this.rectSig = sig;
    this.rects = rects;
    this.keepOuts = keepOuts;
    this.rectHash.clear();
    // each footprint in every cell within the widest margin asked of it
    const m = 2.5;
    for (const r of rects) {
      for (let i = Math.floor((r.x0 - m) / RECT_HASH); i <= Math.floor((r.x1 + m) / RECT_HASH); i++) {
        for (let k = Math.floor((r.z0 - m) / RECT_HASH); k <= Math.floor((r.z1 + m) / RECT_HASH); k++) {
          const key = hashKey(i, k);
          (this.rectHash.get(key) ?? this.rectHash.set(key, []).get(key)!).push(r);
        }
      }
    }
  }

  /** Would moving a's body centre from (ox, oz) to (x, z) enter a foreign
   *  footprint (grown by m) it is not already in, or leave the map's path
   *  margin? A unit caught inside one (a pad put down on it) may move as it
   *  likes to get out; its path leads it out at the nearest edge. */
  entersWall(a: Agent, ox: number, oz: number, x: number, z: number, m: number): boolean {
    if ((Math.abs(x) > PATH_HALF || Math.abs(z) > PATH_HALF) && Math.max(Math.abs(x), Math.abs(z)) > Math.max(Math.abs(ox), Math.abs(oz))) return true;
    const list = this.rectHash.get(hashKey(Math.floor(x / RECT_HASH), Math.floor(z / RECT_HASH)));
    if (!list) return false;
    for (const r of list) {
      if (r.id !== a.home && inside(x, z, r, m) && !inside(ox, oz, r, m)) return true;
    }
    return false;
  }

  /** Body centre of a at its pose (or a given one). */
  static cx(a: Agent, p: Pose = a) { return p.x + a.off * p.fx; }
  static cz(a: Agent, p: Pose = a) { return p.z + a.off * p.fz; }

  private rebuildHash() {
    this.hash.clear();
    for (const a of this.agents) this.place(a);
  }
  private place(a: Agent) {
    const key = hashKey(Math.floor(Traffic.cx(a) / HASH), Math.floor(Traffic.cz(a) / HASH));
    (this.hash.get(key) ?? this.hash.set(key, []).get(key)!).push(a);
  }
  private unplace(a: Agent) {
    const key = hashKey(Math.floor(Traffic.cx(a) / HASH), Math.floor(Traffic.cz(a) / HASH));
    const l = this.hash.get(key);
    if (!l) return;
    const i = l.indexOf(a);
    if (i >= 0) l.splice(i, 1);
  }

  /** Units whose body centres lie within `rad` of (x, z), a excluded. */
  near(a: Agent, x: number, z: number, rad: number, out: Agent[]): Agent[] {
    out.length = 0;
    const i0 = Math.floor((x - rad) / HASH), i1 = Math.floor((x + rad) / HASH);
    const k0 = Math.floor((z - rad) / HASH), k1 = Math.floor((z + rad) / HASH);
    for (let i = i0; i <= i1; i++) {
      for (let k = k0; k <= k1; k++) {
        const l = this.hash.get(hashKey(i, k));
        if (!l) continue;
        for (const b of l) {
          if (b === a) continue;
          if (Math.hypot(Traffic.cx(b) - x, Traffic.cz(b) - z) <= rad) out.push(b);
        }
      }
    }
    // hash buckets hold units in arrival order: sort for a stable result
    out.sort((p, q) => p.key - q.key);
    return out;
  }

  /** How far ahead a looks for b (0: only the hard check). */
  private horizon(a: Agent, b: Agent): number {
    if (a.anchored) return 0;
    if (b.cls > a.cls) return TAU_YIELD;
    if (b.cls < a.cls) return TAU_HARD;
    if (a.still) return 0;
    if (b.still) return TAU_YIELD;
    return b.key < a.key ? TAU_YIELD : TAU_MUTUAL;
  }

  /** Advance every unit by dt game-seconds in substeps of ≤ 0.05 s. */
  step(dt: number) {
    if (dt <= 0 || !this.agents.length) return;
    const steps = Math.min(40, Math.ceil(dt / 0.05));
    const h = dt / steps;
    this.order = [...this.agents].sort((a, b) => b.cls - a.cls || a.key - b.key);
    for (let k = 0; k < steps; k++) {
      for (const a of this.agents) { a.held = false; a.drv.prefer(a, h); }
      if (this.solo) {
        for (const a of this.order) this.move(a, a.pvx, a.pvz, h, false);
        continue;
      }
      try {
        this.rebuildHash();
        const want = new Map<Agent, [number, number]>();
        for (const a of this.agents) want.set(a, this.choose(a));
        for (const a of this.order) {
          const [vx, vz] = want.get(a)!;
          this.move(a, vx, vz, h, true);
        }
      } catch (e) {
        this.solo = true;
        console.warn('[MOONSHOTS] ground traffic avoidance disabled after an error.', e);
      }
    }
    this.measure();
  }

  private scratch: Agent[] = [];

  /** The velocity a takes: the wanted one, or the best of the fan. */
  private choose(a: Agent): [number, number] {
    const pvx = a.pvx, pvz = a.pvz;
    if (a.anchored) return [0, 0];
    const pv = Math.hypot(pvx, pvz);
    const ax = Traffic.cx(a), az = Traffic.cz(a);
    const sense = a.r + MAX_R + BUFFER + (Math.max(pv, 0.5) + 10) * TAU_YIELD;
    const nb = this.near(a, ax, az, Math.min(sense, 45), this.scratch);
    // who matters: a neighbour inside its horizon's reach. One with the right
    // of way is taken to go where it wants to (its wanted velocity, not the
    // one it has): a unit held up behind a parked rover is still seen coming,
    // so the rover clears its way.
    const rel: { b: Agent; tau: number; R: number; vx: number; vz: number }[] = [];
    for (const b of nb) {
      const tau = this.horizon(a, b);
      const R = a.r + b.r + BUFFER;
      const intent = tau >= TAU_YIELD;
      const bvx = intent ? b.pvx : b.vx, bvz = intent ? b.pvz : b.vz;
      const reach = R + (pv + Math.hypot(bvx, bvz)) * tau + 0.5;
      const d = Math.hypot(Traffic.cx(b) - ax, Traffic.cz(b) - az);
      if (d < a.r + b.r) rel.push({ b, tau: Math.max(tau, TAU_HARD), R, vx: bvx, vz: bvz }); // touching: always
      else if (tau > 0 && d < reach) rel.push({ b, tau, R, vx: bvx, vz: bvz });
    }
    if (!rel.length) return [pvx, pvz];
    const cruise = Math.max(a.cruise, 0.5);
    const base = pv > 0.05 ? Math.atan2(pvx, pvz) : Math.atan2(a.fx, a.fz);
    const cands: [number, number][] = [];
    if (pv > 0.05) {
      for (const s of SPEEDS) for (const o of FAN) cands.push([Math.sin(base + o) * pv * s, Math.cos(base + o) * pv * s]);
    } else {
      const dodge = Math.min(1.5, cruise * 0.4);
      for (let i = 0; i < 16; i++) {
        const o = (i / 16) * Math.PI * 2;
        cands.push([Math.sin(base + o) * dodge, Math.cos(base + o) * dodge]);
      }
    }
    cands.push([0, 0]);
    let best: [number, number] = [0, 0], bc = Infinity;
    for (let ci = 0; ci < cands.length; ci++) {
      const [vx, vz] = cands[ci];
      // not into a wall (or not deeper, for one already too close)
      const sp = Math.hypot(vx, vz);
      const look = sp > 1e-6 ? Math.min(0.6, 1 / sp) : 0;
      if (sp > 1e-6 && this.entersWall(a, ax, az, ax + vx * look, az + vz * look, a.wallM)) continue;
      let cost = Math.hypot(vx - pvx, vz - pvz) / cruise;
      cost += W_CHANGE * Math.hypot(vx - a.vx, vz - a.vz) / cruise;
      if (pv > 0.05 && ci % FAN.length !== 0) cost += W_HAND * (FAN[ci % FAN.length] > 0 ? 1 : 0.5);
      // it stops where it is going: nothing after that counts
      const stop = sp > 1e-6 ? a.reach / sp : Infinity;
      for (const { b, tau, R, vx: bvx, vz: bvz } of rel) {
        const px = ax - Traffic.cx(b), pz = az - Traffic.cz(b);
        const wx = vx - bvx, wz = vz - bvz;
        const pp = px * px + pz * pz;
        const touch = a.r + b.r;
        if (pp < touch * touch) {
          // touching already: moving apart is what counts
          const d = Math.sqrt(pp) || 1;
          const apart = (px * wx + pz * wz) / d / cruise;
          cost += 2 * W_COLLIDE * (1 - 0.5 * Math.max(-1, Math.min(1, apart)));
          continue;
        }
        // within the buffer, only touching counts
        const Rt = pp < R * R ? touch : R;
        const ww = wx * wx + wz * wz;
        if (ww < 1e-9) continue;
        const pw = px * wx + pz * wz;
        if (pw >= 0) continue; // parting
        const disc = pw * pw - ww * (pp - Rt * Rt);
        if (disc <= 0) continue;
        const t = (-pw - Math.sqrt(disc)) / ww;
        const h = Math.min(tau, stop + 0.2);
        if (t < h) cost += W_COLLIDE * (h - t) / tau;
      }
      if (cost < bc - 1e-9) { bc = cost; best = [vx, vz]; }
    }
    // slowed well below what it wants: it counts as held up
    if (pv > 0.3 && Math.hypot(best[0], best[1]) < 0.3 * pv) a.held = true;
    return best;
  }

  /** Take a's move if it keeps every body clear (checked against the others'
   *  places this substep), else try just turning, else wait. */
  private move(a: Agent, vx: number, vz: number, dt: number, check: boolean) {
    const p = this.pose;
    a.drv.propose(a, vx, vz, dt, p);
    if (!check || this.fits(a, p)) { this.take(a, p, dt); return; }
    a.drv.propose(a, vx, vz, dt, p, true);
    if (Math.hypot(p.x - a.x, p.z - a.z) < 1e-6 && this.fits(a, p)) { this.take(a, p, dt); a.held = true; return; }
    a.held = true;
    a.vx = 0;
    a.vz = 0;
    a.drv.commit(a, null, dt);
  }

  private take(a: Agent, p: Pose, dt: number) {
    const moved = p.x !== a.x || p.z !== a.z || p.fx !== a.fx || p.fz !== a.fz;
    if (moved) this.unplace(a);
    a.vx = (Traffic.cx(a, p) - Traffic.cx(a)) / dt;
    a.vz = (Traffic.cz(a, p) - Traffic.cz(a)) / dt;
    a.drv.commit(a, p, dt);
    if (moved) this.place(a);
  }

  private fitScratch: Agent[] = [];
  /** No body closer to a's new place than touching (unless already so and
   *  getting no closer), and its centre into no foreign footprint. */
  private fits(a: Agent, p: Pose): boolean {
    const nx = Traffic.cx(a, p), nz = Traffic.cz(a, p);
    const ox = Traffic.cx(a), oz = Traffic.cz(a);
    for (const b of this.near(a, nx, nz, a.r + MAX_R + 0.5, this.fitScratch)) {
      const R = a.r + b.r;
      const bx = Traffic.cx(b), bz = Traffic.cz(b);
      const d1 = Math.hypot(nx - bx, nz - bz);
      if (d1 >= R) continue;
      const d0 = Math.hypot(ox - bx, oz - bz);
      if (d1 < d0 - 1e-6) return false;
    }
    if (!a.anchored && this.entersWall(a, ox, oz, nx, nz, 0)) return false;
    return true;
  }

  /** the closest approach since the last read: how far inside the radii sum */
  private measure() {
    for (const a of this.agents) {
      for (const b of this.near(a, Traffic.cx(a), Traffic.cz(a), a.r + MAX_R, this.scratch)) {
        if (b.key < a.key) continue;
        const gap = Math.hypot(Traffic.cx(a) - Traffic.cx(b), Traffic.cz(a) - Traffic.cz(b)) - a.r - b.r;
        if (gap < this.worst.gap) this.worst = { gap, a: `${a.kind}#${a.id}`, b: `${b.kind}#${b.id}` };
      }
    }
  }

  info() {
    const w = this.worst;
    this.worst = { gap: Infinity, a: '', b: '' };
    return {
      solo: this.solo,
      /** m: the least (distance − radii sum) of any pair since the last read (negative = overlap) */
      closest: Number.isFinite(w.gap) ? { gap: Math.round(w.gap * 1000) / 1000, a: w.a, b: w.b } : null,
      units: this.agents.map((a) => ({
        kind: a.kind, id: a.id, x: Math.round(a.x * 100) / 100, z: Math.round(a.z * 100) / 100,
        cx: Math.round(Traffic.cx(a) * 100) / 100, cz: Math.round(Traffic.cz(a) * 100) / 100,
        r: a.r, home: a.home, still: a.still, cls: a.cls, held: a.held,
      })),
    };
  }
}
