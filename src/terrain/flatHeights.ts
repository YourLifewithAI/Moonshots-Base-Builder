/** The stand-in ground of a rival base (docs/20 §4.2): a headless base nobody
 *  watches needs the core's terrain readers, not terrain. Flat as a table — every
 *  height 0, every slope nil, nothing for a ray to hit — with the deposits the
 *  real site has (Heightfield's flat constructor runs only `generateDeposits`).
 *
 *  - Reads: `sample`, `sampleGrid`, `baseHeight` → 0; `gridNormal` → up;
 *    `maxDelta` → 0 (every spot passes the slope check); `raycast` → null;
 *    `noRoad` → false (nothing is ever carved).
 *  - Writes: `flatten` marks `padMask` (the hash and the pits' locks read it)
 *    and returns the pad height (`forcedH`, else 0); `setDelta` does nothing —
 *    a virtual pit is counted, not carved (core/pits.ts, `hf.virtual`).
 *  - `delta`, `padMask`, `skirt` stay real-sized, so every reader that indexes
 *    them still works. `h` and `base` are one zeroed grid (grading refuses a
 *    virtual site, core/grading.ts).
 *  - `terrainHash` hashes what a flat site has that can differ: the pad mask
 *    and the signature of its virtual pits (`virtualSig`, written by pits.ts). */
import { HF_SAMPLES, Heightfield } from './heightfield';
import type { SiteDef } from '../data/sites';

const N = HF_SAMPLES;

export class FlatHeights extends Heightfield {
  override readonly virtual: boolean = true;

  constructor(site: SiteDef, seed: number) {
    super(site, seed, { flat: true });
  }

  override baseHeight(): number { return 0; }
  override sample(): number { return 0; }
  override sampleGrid(): number { return 0; }
  override maxDelta(): number { return 0; }
  override noRoad(): boolean { return false; }
  override raycast(): null { return null; }

  override gridNormal(_ix: number, _iz: number, out: Float32Array, o: number) {
    out[o] = 0; out[o + 1] = 1; out[o + 2] = 0;
  }

  /** Lock the rect's samples as a pad; nothing else moves. Returns the pad height. */
  override flatten(gx0: number, gz0: number, gx1: number, gz1: number, forcedH?: number): number {
    for (let iz = Math.max(0, gz0); iz <= Math.min(N - 1, gz1); iz++) {
      for (let ix = Math.max(0, gx0); ix <= Math.min(N - 1, gx1); ix++) this.padMask[iz * N + ix] = 1;
    }
    return forcedH ?? 0;
  }

  override setDelta(): void { /* a virtual pit is counted, not carved */ }

  override terrainHash(): string {
    let a = 0x811c9dc5, b = 0x01000193;
    for (let i = 0; i < this.padMask.length; i++) {
      a = Math.imul(a ^ this.padMask[i], 0x01000193) >>> 0;
      b = Math.imul(b ^ (this.delta[i] & 0xffff), 0x85ebca6b) >>> 0;
    }
    a = Math.imul(a ^ this.virtualSig, 0x01000193) >>> 0;
    return `${a.toString(16)}:${b.toString(16)}`;
  }
}
