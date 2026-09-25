/** Ground paths shared by the sim (excavator hauls) and the visuals (rovers,
 *  haulers): straight legs round every footprint in the way. Pure: world
 *  metres in, waypoints out — no Three.js.
 *
 *  A clear straight line is one leg. Anything else is an A* search over a
 *  2 m grid (cells whose centre is within `clear` of a footprint are
 *  blocked, and a diagonal never cuts a blocked corner), string-pulled back
 *  to straight legs that each keep 0.9 × `clear` off every wall. An end
 *  inside a footprint's margin leaves or enters it by the nearest free
 *  ground — its edge — instead of driving through it. Results are memoised
 *  on their inputs, so the sim and the visuals may plan freely on events. */
import { CELL_M, MAP_M } from '../data/balance';
import type { BuildingState } from './state';
import { footprintRect } from '../buildings/instances';

export interface Rect { id: number; x0: number; z0: number; x1: number; z1: number }

/** map half-extent a path may use (a margin inside the edge) */
export const PATH_HALF = MAP_M / 2 - 8;
/** m kept off walls when planning a rover's legs */
export const ROVER_CLEAR = 1.2;

/** Ground units as circles (world/traffic.ts, and the spots allocated for
 *  them): `r` the radius round the body's centre, `off` how far that centre
 *  sits ahead of the unit's origin (the excavator's bucket wheel leads),
 *  `body` the least distance its origin keeps off a foreign wall. */
export const UNIT = {
  /** 1.35 × 1.95 m chassis, wheels at ±0.85 × ±0.98 m */
  rover: { r: 1.3, off: 0, body: 0.9 },
  /** 6.2 × 3.8 m: tracks at ±1.9 m, from 1.9 m behind the origin to the wheel 4.3 m ahead */
  digger: { r: 3.5, off: 1.2, body: 2.0 },
  /** the astronaut on foot */
  walker: { r: 0.5, off: 0, body: 0 },
} as const;

const GRID = 2;          // m per planning cell
const WINDOW = 40;       // m searched round the box holding both ends
const WIDE = 260;        // the retry's margin, when the first window has no way through
const MEMO = 600;        // plans remembered

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

/** Does segment p→q keep m off every rect? */
export function lineClear(px: number, pz: number, qx: number, qz: number, rects: readonly Rect[], m: number): boolean {
  for (const r of rects) if (segmentHits(px, pz, qx, qz, r, m) !== null) return false;
  return true;
}

// ───────────────────────────── the memo ─────────────────────────────

const memo = new Map<string, [number, number][]>();
const rectKey = (rects: readonly Rect[]) => {
  let k = '';
  for (const r of rects) k += `${r.x0},${r.z0},${r.x1},${r.z1};`;
  return k;
};

/** Straight legs from a to b round every footprint in the way (the last
 *  waypoint is b). `clear`: metres kept off walls. */
export function plan(
  ax: number, az: number, bx: number, bz: number, rects: readonly Rect[], clear = ROVER_CLEAR,
): [number, number][] {
  const key = `${ax},${az},${bx},${bz},${clear}|${rectKey(rects)}`;
  let out = memo.get(key);
  if (!out) {
    out = planFresh(ax, az, bx, bz, rects, clear);
    if (memo.size >= MEMO) memo.delete(memo.keys().next().value!);
    memo.set(key, out);
  }
  return out.map(([x, z]) => [x, z]);
}

function planFresh(ax: number, az: number, bx: number, bz: number, rects: readonly Rect[], clear: number): [number, number][] {
  const m = clear * 0.9;
  const held = rects.some((r) => inside(ax, az, r, m) || inside(bx, bz, r, m));
  if (!held && lineClear(ax, az, bx, bz, rects, m)) return [[bx, bz]];
  const p = gridPlan(ax, az, bx, bz, rects, clear, WINDOW, false) ?? gridPlan(ax, az, bx, bz, rects, clear, WIDE, true);
  if (p) return p;
  planStats.fallback++;
  return hopPlan(ax, az, bx, bz, rects, clear);
}
/** plans that found no free ground to start from (the greedy hops took them) */
export const planStats = { fallback: 0 };

// ───────────────────────────── reachability ─────────────────────────────

const reachMemo = new Map<string, (x: number, z: number) => boolean>();

/** Can a unit keeping `clear` off every wall drive from a to a point? The
 *  free ground round the footprints is flood-filled once (2 m cells, as the
 *  planner's) and remembered; the open ground outside them is one region. */
export function reachableFrom(ax: number, az: number, rects: readonly Rect[], clear: number): (x: number, z: number) => boolean {
  if (!rects.length) return () => true;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const r of rects) { x0 = Math.min(x0, r.x0); z0 = Math.min(z0, r.z0); x1 = Math.max(x1, r.x1); z1 = Math.max(z1, r.z1); }
  const pad = clear + 2 * GRID;
  x0 -= pad; z0 -= pad; x1 += pad; z1 += pad;
  x0 = Math.floor(x0 / GRID) * GRID; z0 = Math.floor(z0 / GRID) * GRID;
  const nx = Math.ceil((x1 - x0) / GRID), nz = Math.ceil((z1 - z0) / GRID);
  const cellOf = (x: number, z: number) => Math.floor((z - z0) / GRID) * nx + Math.floor((x - x0) / GRID);
  const within = (x: number, z: number) => x >= x0 && z >= z0 && x < x0 + nx * GRID && z < z0 + nz * GRID;
  const key = `${clear}|${within(ax, az) ? cellOf(ax, az) : 'out'}|${rectKey(rects)}`;
  const hit = reachMemo.get(key);
  if (hit) return hit;
  const blocked = new Uint8Array(nx * nz);
  for (const r of rects) {
    const i0 = Math.max(0, Math.floor((r.x0 - clear - x0) / GRID - 0.5) + 1);
    const i1 = Math.min(nx - 1, Math.ceil((r.x1 + clear - x0) / GRID - 0.5) - 1);
    const k0 = Math.max(0, Math.floor((r.z0 - clear - z0) / GRID - 0.5) + 1);
    const k1 = Math.min(nz - 1, Math.ceil((r.z1 + clear - z0) / GRID - 0.5) - 1);
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) blocked[k * nx + i] = 1;
  }
  /** the free cell nearest a cell (a point in a margin counts from the ground beside it) */
  const free = (c: number): number => {
    if (!blocked[c]) return c;
    const ci = c % nx, ck = (c / nx) | 0;
    for (let rad = 1; rad < 6; rad++) {
      for (let k = Math.max(0, ck - rad); k <= Math.min(nz - 1, ck + rad); k++) {
        for (let i = Math.max(0, ci - rad); i <= Math.min(nx - 1, ci + rad); i++) {
          if (Math.max(Math.abs(i - ci), Math.abs(k - ck)) === rad && !blocked[k * nx + i]) return k * nx + i;
        }
      }
    }
    return -1;
  };
  const seen = new Uint8Array(nx * nz);
  const start = within(ax, az) ? free(cellOf(ax, az)) : 0; // outside: the corner cell is open ground
  if (start >= 0) {
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const ci = c % nx, ck = (c / nx) | 0;
      for (let dk = -1; dk <= 1; dk++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dk) continue;
          const i = ci + di, k = ck + dk;
          if (i < 0 || k < 0 || i >= nx || k >= nz) continue;
          const nb = k * nx + i;
          if (blocked[nb] || seen[nb]) continue;
          if (di && dk && (blocked[ck * nx + i] || blocked[k * nx + ci])) continue;
          seen[nb] = 1;
          stack.push(nb);
        }
      }
    }
  }
  const outside = seen[0] === 1;
  const fn = (x: number, z: number) => {
    if (!within(x, z)) return outside;
    const c = free(cellOf(x, z));
    return c >= 0 && seen[c] === 1;
  };
  if (reachMemo.size >= 32) reachMemo.delete(reachMemo.keys().next().value!);
  reachMemo.set(key, fn);
  return fn;
}

// ───────────────────────────── grid A* ─────────────────────────────

/** A binary min-heap of cells on f (ties: the lower cell index, so a plan never
 *  depends on insertion order). */
class Heap {
  private f: number[] = [];
  private c: number[] = [];
  get size() { return this.c.length; }
  private less(i: number, j: number) { return this.f[i] < this.f[j] || (this.f[i] === this.f[j] && this.c[i] < this.c[j]); }
  private swap(i: number, j: number) {
    [this.f[i], this.f[j]] = [this.f[j], this.f[i]];
    [this.c[i], this.c[j]] = [this.c[j], this.c[i]];
  }
  push(f: number, c: number) {
    this.f.push(f); this.c.push(c);
    for (let i = this.c.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.c[0];
    const lf = this.f.pop()!, lc = this.c.pop()!;
    if (this.c.length) {
      this.f[0] = lf; this.c[0] = lc;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let k = i;
        if (l < this.c.length && this.less(l, k)) k = l;
        if (r < this.c.length && this.less(r, k)) k = r;
        if (k === i) break;
        this.swap(i, k);
        i = k;
      }
    }
    return top;
  }
}

/** A* on the grid round (a, b) with margin w. No way through: null, or with
 *  `closest`, the way to the reachable cell nearest b and a last straight
 *  leg from there (a goal walled in: it squeezes through the narrowest gap). */
function gridPlan(
  ax: number, az: number, bx: number, bz: number, rects: readonly Rect[], clear: number, w: number, closest: boolean,
): [number, number][] | null {
  const m = clear * 0.9;
  const lim = PATH_HALF + GRID;
  const x0 = Math.min(clamp(Math.min(ax, bx) - w, -lim, lim), ax, bx) - GRID;
  const z0 = Math.min(clamp(Math.min(az, bz) - w, -lim, lim), az, bz) - GRID;
  const x1 = Math.max(clamp(Math.max(ax, bx) + w, -lim, lim), ax, bx) + GRID;
  const z1 = Math.max(clamp(Math.max(az, bz) + w, -lim, lim), az, bz) + GRID;
  const nx = Math.ceil((x1 - x0) / GRID), nz = Math.ceil((z1 - z0) / GRID);
  const blocked = new Uint8Array(nx * nz);
  const local: Rect[] = [];
  for (const r of rects) {
    if (r.x1 + clear <= x0 || r.x0 - clear >= x1 || r.z1 + clear <= z0 || r.z0 - clear >= z1) continue;
    local.push(r);
    // cells whose centre x0 + (i + ½)·GRID lies strictly inside the grown rect
    const i0 = Math.max(0, Math.floor((r.x0 - clear - x0) / GRID - 0.5) + 1);
    const i1 = Math.min(nx - 1, Math.ceil((r.x1 + clear - x0) / GRID - 0.5) - 1);
    const k0 = Math.max(0, Math.floor((r.z0 - clear - z0) / GRID - 0.5) + 1);
    const k1 = Math.min(nz - 1, Math.ceil((r.z1 + clear - z0) / GRID - 0.5) - 1);
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) blocked[k * nx + i] = 1;
  }
  const cx = (i: number) => x0 + (i + 0.5) * GRID;
  const cz = (k: number) => z0 + (k + 0.5) * GRID;
  const cellOf = (x: number, z: number) =>
    clamp(Math.floor((z - z0) / GRID), 0, nz - 1) * nx + clamp(Math.floor((x - x0) / GRID), 0, nx - 1);
  /** the free cell nearest (x, z) in a clear line from it (lines may cross
   *  only the footprints whose margin holds the point: it leaves or enters
   *  them at the edge), else the nearest free cell at all */
  const nearestFree = (x: number, z: number): number => {
    const walls = local.filter((r) => !inside(x, z, r, m));
    const sees = (c: number) => lineClear(x, z, cx(c % nx), cz((c / nx) | 0), walls, m);
    const c0 = cellOf(x, z);
    if (!blocked[c0] && sees(c0)) return c0;
    const ci = c0 % nx, ck = (c0 / nx) | 0;
    let any = -1;
    for (let rad = 1; rad < Math.max(nx, nz); rad++) {
      let best = -1, bd = Infinity;
      for (let k = Math.max(0, ck - rad); k <= Math.min(nz - 1, ck + rad); k++) {
        for (let i = Math.max(0, ci - rad); i <= Math.min(nx - 1, ci + rad); i++) {
          if (Math.max(Math.abs(i - ci), Math.abs(k - ck)) !== rad || blocked[k * nx + i]) continue;
          const d = Math.hypot(cx(i) - x, cz(k) - z);
          if (d < bd && sees(k * nx + i)) { bd = d; best = k * nx + i; }
          if (any < 0) any = k * nx + i;
        }
      }
      if (best >= 0) return best;
      if (any >= 0 && rad > 8) return any;
    }
    return any;
  };
  const s = nearestFree(ax, az), g = nearestFree(bx, bz);
  if (s < 0 || g < 0) return null;

  // A*: 8-connected, octile distance, no corner cutting
  const n = nx * nz;
  const cost = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const gi = g % nx, gk = (g / nx) | 0;
  const h = (c: number) => {
    const di = Math.abs((c % nx) - gi), dk = Math.abs(((c / nx) | 0) - gk);
    return (Math.max(di, dk) + (Math.SQRT2 - 1) * Math.min(di, dk)) * GRID;
  };
  const open = new Heap();
  cost[s] = 0;
  open.push(h(s), s);
  let found = false;
  while (open.size) {
    const c = open.pop();
    if (done[c]) continue;
    done[c] = 1;
    if (c === g) { found = true; break; }
    const ci = c % nx, ck = (c / nx) | 0;
    for (let dk = -1; dk <= 1; dk++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dk) continue;
        const i = ci + di, k = ck + dk;
        if (i < 0 || k < 0 || i >= nx || k >= nz) continue;
        const nb = k * nx + i;
        if (blocked[nb] || done[nb]) continue;
        if (di && dk && (blocked[ck * nx + i] || blocked[k * nx + ci])) continue;
        const c2 = cost[c] + (di && dk ? Math.SQRT2 : 1) * GRID;
        if (c2 < cost[nb]) {
          cost[nb] = c2;
          from[nb] = c;
          open.push(c2 + h(nb), nb);
        }
      }
    }
  }
  let end = g;
  if (!found) {
    if (!closest) return null;
    let bd = Infinity;
    for (let c = 0; c < n; c++) {
      if (!done[c]) continue;
      const d = Math.hypot(cx(c % nx) - bx, cz((c / nx) | 0) - bz);
      if (d < bd) { bd = d; end = c; }
    }
  }
  const cells: number[] = [];
  for (let c = end; c !== -1; c = from[c]) cells.push(c);
  cells.reverse();

  // the points to pull straight: the start, the cell centres, the goal. A
  // start (or goal) inside a footprint's margin sees nothing past it, so its
  // exit (entry) cell — the edge — stays a waypoint.
  const pts: [number, number][] = [[ax, az], ...cells.map((c): [number, number] => [cx(c % nx), cz((c / nx) | 0)]), [bx, bz]];
  const out = pull(pts, local, m).slice(1);
  // drop zero-length legs
  const clean: [number, number][] = [];
  let px = ax, pz = az;
  for (const p of out) {
    if (Math.hypot(p[0] - px, p[1] - pz) < 1e-6) continue;
    clean.push(p);
    [px, pz] = p;
  }
  if (!clean.length || clean[clean.length - 1][0] !== bx || clean[clean.length - 1][1] !== bz) clean.push([bx, bz]);
  return clean;
}

/** String-pulling: from each anchor, the farthest point in order still in a
 *  clear straight line (a forward scan that stops a few points past the
 *  first blocked one), then once more over the few points left. */
function pull(pts: [number, number][], rects: readonly Rect[], m: number): [number, number][] {
  const pass = (list: [number, number][], look: number): [number, number][] => {
    const out: [number, number][] = [list[0]];
    let i = 0;
    while (i < list.length - 1) {
      let best = i + 1, miss = 0;
      for (let k = i + 2; k < list.length && miss <= look; k++) {
        if (lineClear(list[i][0], list[i][1], list[k][0], list[k][1], rects, m)) { best = k; miss = 0; } else miss++;
      }
      out.push(list[best]);
      i = best;
    }
    return out;
  };
  const first = pass(pts, 6);
  return pass(first, first.length);
}

/** The old planner, kept as the last resort: greedy hops round the corner of
 *  each footprint in the way (a few at most), ends' footprints driven through. */
function hopPlan(
  ax: number, az: number, bx: number, bz: number, rects: readonly Rect[], clear: number,
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

/** The ring `out` metres off rect r, walked clockwise from its (x0, z0)
 *  corner (+x, +z, −x, −z), each wall kept `corner` off its ends: its length,
 *  the parameter of the ring point nearest (x, z), and the point at u (with
 *  the wall it faces, as wallSpot's). Spots round a wall: work, unload, park. */
export function ring(r: Rect, out: number, corner = 0.8) {
  const w = Math.max(0, r.x1 - r.x0 - 2 * corner), d = Math.max(0, r.z1 - r.z0 - 2 * corner);
  const len = 2 * (w + d);
  const xa = r.x0 + corner, za = r.z0 + corner;
  const at = (u: number): { x: number; z: number; edge: 0 | 1 | 2 | 3 } => {
    u = ((u % len) + len) % len;
    if (u < w) return { x: xa + u, z: r.z0 - out, edge: 2 };
    if (u < w + d) return { x: r.x1 + out, z: za + (u - w), edge: 1 };
    if (u < 2 * w + d) return { x: xa + w - (u - w - d), z: r.z1 + out, edge: 3 };
    return { x: r.x0 - out, z: za + d - (u - 2 * w - d), edge: 0 };
  };
  const uOf = (x: number, z: number): number => {
    const p = wallSpot(r, x, z, out, corner);
    if (p.edge === 2) return p.x - xa;
    if (p.edge === 1) return w + (p.z - za);
    if (p.edge === 3) return w + d + (xa + w - p.x);
    return 2 * w + d + (za + d - p.z);
  };
  return { len, at, uOf };
}
