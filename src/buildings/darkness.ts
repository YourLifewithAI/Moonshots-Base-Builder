/** How dark each structure stands, 0 (sunlit) … 1 (dark): what the base's
 *  own lights answer to — windows, lamps, beacons and floods — so a building
 *  carries its light wherever its surroundings are dark, not only at night.
 *
 *  Per structure, the target is the largest of
 *   - the night factor (the clock's own, `core/daynight.ts`);
 *   - the sky: 1 once the sun has set (1 − the sun's light), and a grazing
 *     sun counting partly dark — LOW_SUN_K at LOW_SUN_FULL and below, easing
 *     to 0 by LOW_SUN_TOP (walls catch it, the ground barely does);
 *   - terrain shadow: a march through the heightfield toward the sun from
 *     mid-height of the structure, at the game's 0.5 s shading cadence.
 *  k then follows its target over ~1–2 s of real time (TAU_S), so lights fade
 *  rather than pop, and keeps fading while the game is paused.
 *
 *  Visual only and renderer-independent: it reads the heightfield and the
 *  state, never writes either (`b.shaded` stays the economy's solar test),
 *  and knows nothing of shaders. Completed structures only; one not sampled
 *  yet reads as the sky's own darkness. Whether a structure is powered is
 *  the renderer's gate on top: an unlit building shows no light at any k. */
import { BUILDINGS } from '../data/buildings';
import type { GameState } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import { centerOf } from './instances';

const DEG = Math.PI / 180;
/** grazing sun: this dark at LOW_SUN_FULL and below … */
export const LOW_SUN_K = 0.5;
const LOW_SUN_FULL = 2 * DEG;
/** … none left by this elevation */
const LOW_SUN_TOP = 8 * DEG;
/** real seconds: the fade's time constant (90% in ~1.2 s) */
const TAU_S = 0.5;
/** the terrain the shadow map holds reaches about this far sunward */
const REACH_M = 900;
/** a k this small counts as sunlit (lights, floods and PointLights skip it) */
export const DARK_LIVE = 0.03;

interface Entry {
  id: number;
  /** 1 = terrain between the structure and the sun (last pass) */
  shade: number;
  k: number;
  pass: number;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** The sky's share of the darkness: a set sun (`sunLight` = its light as a
 *  fraction of full) or a grazing one (`elev` in radians). */
export function skyDarkness(elev: number, sunLight: number): number {
  const low = LOW_SUN_K * (1 - smoothstep(LOW_SUN_FULL, LOW_SUN_TOP, elev));
  return Math.max(1 - sunLight, low);
}

export class BuildingDarkness {
  private byId = new Map<number, Entry>();
  private list: Entry[] = [];
  private pass = 0;
  private night = 0;
  private sky = 0;
  /** bumped whenever any k (or the set of structures) changed: a consumer
   *  re-uploads only when it differs from the one it last saw */
  revision = 0;

  constructor(private hf: Heightfield) {}

  /** Terrain shadow toward the sun from every completed structure (the
   *  game's 0.5 s shading pass). New structures start at their target. */
  sample(state: GameState, sunElev: number, sunAzim: number) {
    const pass = ++this.pass;
    // a sun on or under the horizon leaves everything in its shadow
    const down = sunElev <= 0;
    const dx = Math.cos(sunAzim) * Math.cos(sunElev);
    const dy = Math.sin(sunElev);
    const dz = Math.sin(sunAzim) * Math.cos(sunElev);
    let added = false;
    for (const b of state.buildings) {
      if ((b.construction ?? 0) > 0) continue;
      let shade = 1;
      if (!down) {
        const [x, z] = centerOf(b);
        const y = this.hf.sample(x, z) + BUILDINGS[b.type].height * 0.5;
        shade = this.hf.raycast(x, y, z, dx, dy, dz, REACH_M) !== null ? 1 : 0;
      }
      let e = this.byId.get(b.id);
      if (!e) {
        e = { id: b.id, shade, k: 0, pass };
        e.k = this.target(e);
        this.byId.set(b.id, e);
        this.list.push(e);
        added = true;
      }
      e.shade = shade;
      e.pass = pass;
    }
    // demolished (or no longer complete): forget them
    if (this.list.some((e) => e.pass !== pass)) {
      this.list = this.list.filter((e) => {
        if (e.pass === pass) return true;
        this.byId.delete(e.id);
        return false;
      });
      added = true;
    }
    if (added) this.revision++;
  }

  private target(e: Entry): number {
    return Math.max(this.night, this.sky, e.shade);
  }

  /** Per frame: the sky from the sun (`sunElev` rad, `sunLight` 0..1) and
   *  the clock's night factor, then every k a step toward its target over
   *  `dt` real seconds. Allocation-free. */
  update(dt: number, night: number, sunElev: number, sunLight: number) {
    this.night = night;
    this.sky = skyDarkness(sunElev, sunLight);
    const a = 1 - Math.exp(-Math.max(0, dt) / TAU_S);
    let moved = false;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      const t = this.target(e);
      if (e.k === t) continue;
      e.k = Math.abs(t - e.k) < 1e-3 ? t : e.k + (t - e.k) * a;
      moved = true;
    }
    if (moved) this.revision++;
  }

  /** The darkness a structure stands in, 0..1 (the sky's own for one not
   *  sampled yet). */
  of(id: number): number {
    return this.byId.get(id)?.k ?? Math.max(this.night, this.sky);
  }

  /** k with its inputs (tests, probes). */
  info(id: number) {
    const e = this.byId.get(id);
    return {
      k: this.of(id), sampled: e !== undefined, shaded: e ? e.shade > 0 : null,
      target: e ? this.target(e) : Math.max(this.night, this.sky),
      night: this.night, sky: this.sky,
    };
  }
}
