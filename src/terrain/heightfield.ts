/** Procedural lunar heightfield: fBm base + explicit craters using real simple-
 *  crater geometry — parabolic bowl (depth ≈ D/5 scaled down for playability),
 *  gaussian raised rim (~4% D), and a d^-3 ejecta falloff. Sampled analytically
 *  by placement, walking, and the chunk meshes; flatten() writes building pads
 *  back into the field. */
import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { CELL_M, MAP_CELLS, MAP_M, MAX_SLOPE_DELTA } from '../data/balance';
import type { SiteDef } from '../data/sites';
import {
  DEPOSIT_KINDS, DEPOSIT_PLAN, LEAD_JITTER_M, type DepositKind, type DepositPlanEntry,
} from '../data/deposits';
import { mulberry32 } from '../core/rng';

const N = MAP_CELLS + 1; // samples per side (cell corners)

export interface Crater {
  cx: number; cz: number; r: number; depth: number; rimH: number;
}

/** A local deposit (spec §5a). id is `${kind}-${n}`, n counting within its
 *  kind in generation order; (leadX, leadZ) is where its '?' lead sits. */
export interface Deposit {
  id: string; kind: DepositKind;
  cx: number; cz: number; r: number;
  leadX: number; leadZ: number;
}

/** deposits keep their centres this far from the Lander pad's edge */
const PAD_CLEAR_M = 20;
/** the Lander pad's half-width (3×3 cells about the map heart) */
const PAD_HALF_M = 6;
/** placement tries per wanted candidate before a deposit is dropped */
const DEPOSIT_TRIES = 80;
/** a ridge takes the highest of this many candidates in its ring */
const RIDGE_CANDIDATES = 40;
/** guaranteed patches prefer a centre flat enough for an excavator */
const GUARANTEED_CANDIDATES = 24;

export class Heightfield {
  readonly h: Float32Array;
  readonly craters: Crater[] = [];
  /** every local deposit, ice first (index 0 = the guaranteed starter patch) */
  readonly deposits: Deposit[] = [];
  private noise: NoiseFunction2D;

  constructor(public site: SiteDef, public seed: number) {
    const rng = mulberry32(seed ^ 0x9e3779b9);
    this.noise = createNoise2D(rng);
    this.h = new Float32Array(N * N);
    this.generate(rng);
  }

  /** `footprint` (m, the caller's sample spacing) fades out octaves whose
   *  wavelength is under twice that spacing, so coarse samplers don't alias. */
  private fbm(x: number, z: number, octaves: number, freq: number, amp: number, footprint = 0): number {
    let v = 0;
    for (let o = 0; o < octaves; o++) {
      const w = footprint > 0 ? Math.min(1, Math.max(0, 1 / (freq * footprint) - 1)) : 1;
      if (w > 0) v += this.noise(x * freq, z * freq) * amp * w;
      freq *= 2;
      amp *= 0.5;
    }
    return v;
  }

  private generate(rng: () => number) {
    const t = this.site.terrain;
    // scatter craters: power-law sizes (many small, few large), avoiding map center
    for (let i = 0; i < t.craterCount; i++) {
      const r = (8 + Math.pow(rng(), 2.2) * t.craterMaxD * 0.5);
      let cx = 0, cz = 0, tries = 0;
      do {
        cx = (rng() - 0.5) * MAP_M * 0.9;
        cz = (rng() - 0.5) * MAP_M * 0.9;
        tries++;
      } while (Math.hypot(cx, cz) < 90 + r && tries < 20); // keep landing zone clear
      if (Math.hypot(cx, cz) < 90 + r) continue;
      const depth = r * 2 * 0.2 * 0.35;   // D/5, scaled 0.35 for walkable slopes
      const rimH = r * 2 * 0.04 * 0.6;
      this.craters.push({ cx, cz, r, depth, rimH });
    }
    if (t.skylight) {
      // the lava-tube skylight: one deep, steep pit offset from the base site
      this.craters.push({ cx: 150, cz: 110, r: 34, depth: 26, rimH: 2.5 });
    }
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const x = ix * CELL_M - MAP_M / 2;
        const z = iz * CELL_M - MAP_M / 2;
        this.h[iz * N + ix] = this.baseHeight(x, z);
      }
    }
    this.generateDeposits();
  }

  /** permanently shadowed ice patches (ice sites only) */
  get iceDeposits(): Deposit[] {
    return this.deposits.filter((d) => d.kind === 'ice');
  }

  /** The deposit under a world point (the first match: legacy ice patches may
   *  overlap each other; no other kind overlaps anything). */
  depositAt(x: number, z: number): Deposit | null {
    for (const d of this.deposits) if (Math.hypot(x - d.cx, z - d.cz) <= d.r) return d;
    return null;
  }

  private generateDeposits() {
    const plan = DEPOSIT_PLAN[this.site.id];
    // ice: the legacy stream, bit-for-bit — one small starter deposit inside
    // the Lander's build radius (the first harvester must not wait on a chain
    // of habitats), then six cold-trap patches past the landing zone
    const ice = plan.find((e) => e.kind === 'ice');
    if (ice && this.site.hasIce) {
      const put = (d: { cx: number; cz: number; r: number }) => this.deposits.push({
        id: `ice-${this.deposits.length}`, kind: 'ice', ...d, leadX: d.cx, leadZ: d.cz,
      });
      put(this.starterDeposit(mulberry32(this.seed ^ 0x1ce5), ice));
      const irng = mulberry32(this.seed ^ 0x1ce);
      for (let i = 1; i < ice.count; i++) {
        const ang = irng() * Math.PI * 2;
        const dist = ice.dMin + irng() * (ice.dMax - ice.dMin);
        put({ cx: Math.cos(ang) * dist, cz: Math.sin(ang) * dist, r: ice.rMin + irng() * (ice.rMax - ice.rMin) });
      }
    }
    for (const e of plan) {
      if (e.kind === 'ice') continue;
      const rng = mulberry32(this.seed ^ (0xde90 + DEPOSIT_KINDS.indexOf(e.kind)));
      let n = 0;
      for (let i = 0; i < e.count; i++) {
        const g = e.guaranteed && i < e.guaranteed.count ? e.guaranteed : null;
        const d = this.placeDeposit(rng, e, g ? g.minM : e.dMin, g ? g.maxM : e.dMax, !!g);
        if (d) this.deposits.push({ id: `${e.kind}-${n++}`, kind: e.kind, ...d, leadX: d.cx, leadZ: d.cz });
      }
    }
    // leads sit off the true centre, stably per seed
    const lrng = mulberry32(this.seed ^ 0x1ead);
    for (const d of this.deposits) {
      const a = lrng() * Math.PI * 2;
      const j = Math.sqrt(lrng()) * LEAD_JITTER_M;
      d.leadX = d.cx + Math.cos(a) * j;
      d.leadZ = d.cz + Math.sin(a) * j;
    }
  }

  /** A candidate is rejected if it leaves the map, overlaps another deposit,
   *  sits within 20 m of the Lander pad, or (lava tube) lies outside the
   *  buildable footprint. A ridge takes the highest of 40 candidates; a
   *  guaranteed patch the first whose centre an excavator can stand on. */
  private placeDeposit(
    rng: () => number, e: DepositPlanEntry, dMin: number, dMax: number, guaranteed: boolean,
  ): { cx: number; cz: number; r: number } | null {
    const edge = MAP_M / 2 - 8;
    const R = this.site.buildableRadiusM;
    const want = e.kind === 'ridge' ? RIDGE_CANDIDATES : guaranteed ? GUARANTEED_CANDIDATES : 1;
    let best: { cx: number; cz: number; r: number } | null = null;
    let bestScore = -Infinity;
    let valid = 0;
    for (let t = 0; t < DEPOSIT_TRIES * want && valid < want; t++) {
      const ang = rng() * Math.PI * 2;
      const dist = dMin + rng() * (dMax - dMin);
      const r = e.rMin + rng() * (e.rMax - e.rMin);
      const cx = Math.cos(ang) * dist, cz = Math.sin(ang) * dist;
      if (Math.abs(cx) + r > edge || Math.abs(cz) + r > edge) continue;
      if (Math.max(Math.abs(cx), Math.abs(cz)) - PAD_HALF_M < PAD_CLEAR_M) continue;
      if (R > 0 && Math.hypot(cx, cz) + r / 2 > R) continue;
      if (this.deposits.some((o) => Math.hypot(cx - o.cx, cz - o.cz) < r + o.r + 4)) continue;
      valid++;
      let score = 0;
      if (e.kind === 'ridge') score = this.sample(cx, cz);
      else if (guaranteed) {
        const delta = this.maxDelta(...padCells(cx, cz));
        score = delta <= MAX_SLOPE_DELTA * 0.5 ? Infinity : -delta;
      }
      if (score > bestScore) { best = { cx, cz, r }; bestScore = score; }
      if (score === Infinity) break;
    }
    return best;
  }

  /** A small deposit 43–52 m from the map heart (the Lander sits ~3 m off it),
   *  on the flattest of a few seeded spots, so a harvester centred on it
   *  passes the placement slope check. */
  private starterDeposit(rng: () => number, ice: DepositPlanEntry): { cx: number; cz: number; r: number } {
    const g = ice.guaranteed ?? { minM: 43, maxM: 52 };
    let best = { cx: 0, cz: 0, r: 0 };
    let bestDelta = Infinity;
    for (let i = 0; i < 16 && bestDelta > MAX_SLOPE_DELTA * 0.5; i++) {
      const ang = rng() * Math.PI * 2;
      const dist = g.minM + rng() * (g.maxM - g.minM);
      const d = { cx: Math.cos(ang) * dist, cz: Math.sin(ang) * dist, r: 10 + rng() * 3 };
      const delta = this.maxDelta(...padCells(d.cx, d.cz));
      if (delta < bestDelta) { best = d; bestDelta = delta; }
    }
    return best;
  }

  /** is this world point inside an ice deposit (revealed or not)? */
  onIce(x: number, z: number): boolean {
    return this.depositAt(x, z)?.kind === 'ice';
  }

  /** The analytic surface before any pad: defined everywhere, so the far
   *  horizon ring continues it past the map edge. The grid samples it with
   *  footprint 0 (every octave). */
  baseHeight(x: number, z: number, footprint = 0): number {
    const t = this.site.terrain;
    // gentle rolling regolith: 4-octave fBm, amplitude by site roughness
    let h = this.fbm(x, z, 4, 1 / 700, 9 * t.roughness, footprint);
    h += this.fbm(x + 999, z - 999, 2, 1 / 90, 0.7 * t.roughness, footprint);
    for (const c of this.craters) {
      const d = Math.hypot(x - c.cx, z - c.cz) / c.r;
      if (d < 1) {
        h += c.depth * (d * d - 1);                                   // parabolic bowl
        h += c.rimH * Math.exp(-((d - 1) ** 2) / (2 * 0.12 ** 2));    // gaussian rim
      } else if (d < 3) {
        h += c.rimH * Math.pow(d, -3);                                // ejecta blanket
      }
    }
    return h;
  }

  /** bilinear height sample at world (x, z); clamped to map. */
  sample(x: number, z: number): number {
    const fx = Math.min(Math.max((x + MAP_M / 2) / CELL_M, 0), MAP_CELLS - 1e-4);
    const fz = Math.min(Math.max((z + MAP_M / 2) / CELL_M, 0), MAP_CELLS - 1e-4);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const h00 = this.h[iz * N + ix], h10 = this.h[iz * N + ix + 1];
    const h01 = this.h[(iz + 1) * N + ix], h11 = this.h[(iz + 1) * N + ix + 1];
    return h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz;
  }

  sampleGrid(ix: number, iz: number): number {
    return this.h[Math.min(Math.max(iz, 0), N - 1) * N + Math.min(Math.max(ix, 0), N - 1)];
  }

  /** Grid height, continued past the map edge by the analytic surface. */
  private gridOrBase(ix: number, iz: number): number {
    if (ix >= 0 && iz >= 0 && ix < N && iz < N) return this.h[iz * N + ix];
    return this.baseHeight(ix * CELL_M - MAP_M / 2, iz * CELL_M - MAP_M / 2);
  }

  /** Unit normal at grid sample (ix, iz) by central differences. Every mesh
   *  touching the grid uses this one definition, so vertices shared across
   *  chunk borders and the horizon ring's inner edge shade identically. */
  gridNormal(ix: number, iz: number, out: Float32Array, o: number) {
    const nx = this.gridOrBase(ix - 1, iz) - this.gridOrBase(ix + 1, iz);
    const nz = this.gridOrBase(ix, iz - 1) - this.gridOrBase(ix, iz + 1);
    const ny = 2 * CELL_M;
    const inv = 1 / Math.hypot(nx, ny, nz);
    out[o] = nx * inv; out[o + 1] = ny * inv; out[o + 2] = nz * inv;
  }

  /** samples locked by a flatten pad — skirts of later pads must not move them,
   *  or neighbouring building pads get carved into visible seams */
  private padMask = new Uint8Array(N * N);

  /** Flatten a cell rect [gx0..gx1) x [gz0..gz1) to its mean corner height,
   *  with a mask-aware two-ring smoothed skirt. Returns pad height. */
  flatten(gx0: number, gz0: number, gx1: number, gz1: number, forcedH?: number): number {
    let sum = 0, n = 0;
    for (let iz = gz0; iz <= gz1; iz++) {
      for (let ix = gx0; ix <= gx1; ix++) { sum += this.h[iz * N + ix]; n++; }
    }
    const pad = forcedH ?? sum / n;
    for (let iz = gz0; iz <= gz1; iz++) {
      for (let ix = gx0; ix <= gx1; ix++) {
        this.h[iz * N + ix] = pad;
        this.padMask[iz * N + ix] = 1;
      }
    }
    // skirt: feather two rings outward, never touching another pad's samples
    for (let ring = 1; ring <= 2; ring++) {
      const w = ring === 1 ? 0.6 : 0.25; // blend weight toward the pad
      for (let iz = gz0 - ring; iz <= gz1 + ring; iz++) {
        for (let ix = gx0 - ring; ix <= gx1 + ring; ix++) {
          const d = Math.max(
            Math.max(gx0 - ix, ix - gx1),
            Math.max(gz0 - iz, iz - gz1),
          );
          if (d !== ring) continue; // only this ring's cells
          if (ix < 0 || iz < 0 || ix >= N || iz >= N) continue;
          if (this.padMask[iz * N + ix]) continue;
          this.h[iz * N + ix] = this.h[iz * N + ix] * (1 - w) + pad * w;
        }
      }
    }
    return pad;
  }

  /** max |height − mean| over a cell rect's corners (slope/roughness check). */
  maxDelta(gx0: number, gz0: number, gx1: number, gz1: number): number {
    let mn = Infinity, mx = -Infinity;
    for (let iz = gz0; iz <= gz1; iz++) {
      for (let ix = gx0; ix <= gx1; ix++) {
        const v = this.h[iz * N + ix];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    return mx - mn;
  }

  /** Ray-march the heightfield: returns world hit point or null.
   *  Coarse 4 m steps then 8-iteration bisection refine. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist = 3000): [number, number, number] | null {
    let t = 0;
    let prevT = 0;
    let prevAbove = oy - this.sample(ox, oz) > 0;
    const step = 4;
    while (t < maxDist) {
      t += step;
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      if (Math.abs(x) > MAP_M / 2 || Math.abs(z) > MAP_M / 2) {
        if (y < -60) return null;
        prevT = t;
        continue;
      }
      const above = y - this.sample(x, z) > 0;
      if (prevAbove && !above) {
        // bisect between prevT and t
        let lo = prevT, hi = t;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          const mx = ox + dx * mid, my = oy + dy * mid, mz = oz + dz * mid;
          if (my - this.sample(mx, mz) > 0) lo = mid;
          else hi = mid;
        }
        const ft = (lo + hi) / 2;
        return [ox + dx * ft, oy + dy * ft, oz + dz * ft];
      }
      prevAbove = above;
      prevT = t;
    }
    return null;
  }
}

/** the 2×2-cell footprint centred on a world point: [gx0, gz0, gx1, gz1] */
function padCells(cx: number, cz: number): [number, number, number, number] {
  const gx = Math.round((cx + MAP_M / 2) / CELL_M - 1);
  const gz = Math.round((cz + MAP_M / 2) / CELL_M - 1);
  return [gx, gz, gx + 2, gz + 2];
}

export { N as HF_SAMPLES };
