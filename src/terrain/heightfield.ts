/** Procedural lunar heightfield: fBm base + explicit craters using real simple-
 *  crater geometry — parabolic bowl (depth ≈ D/5 scaled down for playability),
 *  gaussian raised rim (~4% D), and a d^-3 ejecta falloff. Sampled analytically
 *  by placement, walking, and the chunk meshes; flatten() writes building pads
 *  back into the field. */
import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { CELL_M, MAP_CELLS, MAP_M } from '../data/balance';
import type { SiteDef } from '../data/sites';
import { mulberry32 } from '../core/rng';

const N = MAP_CELLS + 1; // samples per side (cell corners)

export interface Crater {
  cx: number; cz: number; r: number; depth: number; rimH: number;
}

export class Heightfield {
  readonly h: Float32Array;
  readonly craters: Crater[] = [];
  private noise: NoiseFunction2D;

  constructor(public site: SiteDef, public seed: number) {
    const rng = mulberry32(seed ^ 0x9e3779b9);
    this.noise = createNoise2D(rng);
    this.h = new Float32Array(N * N);
    this.generate(rng);
  }

  private fbm(x: number, z: number, octaves: number, freq: number, amp: number): number {
    let v = 0;
    for (let o = 0; o < octaves; o++) {
      v += this.noise(x * freq, z * freq) * amp;
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
  }

  private baseHeight(x: number, z: number): number {
    const t = this.site.terrain;
    // gentle rolling regolith: 4-octave fBm, amplitude by site roughness
    let h = this.fbm(x, z, 4, 1 / 700, 9 * t.roughness);
    h += this.fbm(x + 999, z - 999, 2, 1 / 90, 0.7 * t.roughness);
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

  /** Flatten a cell rect [gx0..gx1) x [gz0..gz1) to its mean corner height,
   *  with a 1-sample smoothed skirt. Returns pad height. */
  flatten(gx0: number, gz0: number, gx1: number, gz1: number, forcedH?: number): number {
    let sum = 0, n = 0;
    for (let iz = gz0; iz <= gz1; iz++) {
      for (let ix = gx0; ix <= gx1; ix++) { sum += this.h[iz * N + ix]; n++; }
    }
    const pad = forcedH ?? sum / n;
    for (let iz = gz0; iz <= gz1; iz++) {
      for (let ix = gx0; ix <= gx1; ix++) this.h[iz * N + ix] = pad;
    }
    // skirt: blend the ring just outside toward the pad
    for (let iz = gz0 - 1; iz <= gz1 + 1; iz++) {
      for (let ix = gx0 - 1; ix <= gx1 + 1; ix++) {
        if (ix >= gx0 && ix <= gx1 && iz >= gz0 && iz <= gz1) continue;
        if (ix < 0 || iz < 0 || ix >= N || iz >= N) continue;
        this.h[iz * N + ix] = this.h[iz * N + ix] * 0.4 + pad * 0.6;
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

export { N as HF_SAMPLES };
