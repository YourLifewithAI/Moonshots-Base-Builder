/** The classic style's ground colour: a subtly tinted regolith, authored as
 *  the colour you see (the classic renderer does no tone mapping). One
 *  function for everything that stands on the ground — terrain chunks, the
 *  horizon ring, berms and boulders — so they agree wherever they meet.
 *
 *  - Site tint: mare basalt darker and warmer, the Marius Hills a shade
 *    redder, the south-pole highlands lighter and cooler.
 *  - Mottle at 55 m and 11 m, and a slow warm/cool drift at 140 m (faded
 *    out where the caller's sample spacing cannot hold them).
 *  - Height: low ground a little darker, high ground a little lighter;
 *    slope: steep, fresher walls a little brighter.
 *  - Craters: darker floors, bright rims, a faint ejecta apron; a pit (the
 *    lava tube's skylight, deeper than it is wide) goes dark toward the
 *    bottom — the sun is a rumour down there.
 *  - Deposits, subtly, as orbital colour-ratio maps show them: high-Ti
 *    basalt darker and bluer, anorthosite brighter, ice bluish-white,
 *    pyroclastic glass a dark amber, KREEP a faint rose, mature (volatile-
 *    rich) soil a faint olive-brown. Edges are soft and a little ragged.
 *    Every deposit is tinted, mapped or not — the ground looks like what it
 *    is; the overlay [I] and the survey say what that means. */
import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from '../core/rng';
import type { DepositKind } from '../data/deposits';
import type { SiteId } from '../data/sites';
import type { Crater, Deposit, Heightfield } from './heightfield';

const lin = (hex: number) => new THREE.Color(hex); // ColorManagement: sRGB hex → linear

/** base regolith per site (sRGB as authored) */
export const SITE_GROUND: Record<SiteId, THREE.Color> = {
  mare: lin(0x857d73),
  lavatube: lin(0x847a6e),
  southpole: lin(0xaeaca6),
};

type Tint = { mul: [number, number, number] } | { toward: [number, number, number]; k: number };

/** how each deposit kind colours the ground (linear multipliers, or a mix
 *  toward an absolute colour); strength at the deposit's heart */
export const DEPOSIT_TINT: Record<DepositKind, Tint | null> = {
  ilmenite: { mul: [0.82, 0.84, 0.93] },
  anorthosite: { mul: [1.22, 1.21, 1.18] },
  ice: { toward: [0.7, 0.79, 0.93], k: 0.45 },
  glass: { mul: [0.97, 0.88, 0.74] },
  kreep: { mul: [1.06, 0.95, 0.96] },
  volatiles: { mul: [0.94, 0.94, 0.88] },
  ridge: null,
};

const noise = createNoise2D(mulberry32(0xc1a551c));

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class ClassicGround {
  private base: THREE.Color;
  private relief: number;
  private deposits: readonly Deposit[];

  constructor(private hf: Heightfield) {
    this.base = SITE_GROUND[hf.site.id];
    this.relief = 4 + 6 * hf.site.terrain.roughness;
    this.deposits = hf.deposits;
  }

  /** Linear RGB at (x, z) into out[o..o+2]. `h` = ground height there, `ny`
   *  = the up component of its normal, `footprint` = the caller's sample
   *  spacing (m; 0 = the grid's own), `craters` = those to draw (the map's
   *  by default; the horizon ring adds its far ones). */
  color(x: number, z: number, h: number, ny: number, out: Float32Array | number[], o: number,
    footprint = 0, craters: readonly Crater[] = this.hf.craters) {
    const fade = (period: number) => (footprint > 0 ? Math.min(1, Math.max(0, period / footprint - 1)) : 1);
    let v = 1;
    v += noise(x / 55, z / 55) * 0.09 * fade(55);
    v += noise(x / 11 + 31, z / 11 - 17) * 0.05 * fade(11);
    v *= 1 + 0.06 * Math.min(1, Math.max(-1, h / this.relief));
    v *= 1 + 0.35 * Math.min(0.3, Math.max(0, 1 - ny));
    let cool = noise(x / 140 - 5, z / 140 + 9) * 0.03 * fade(140);
    for (const c of craters) {
      const dx = x - c.cx, dz = z - c.cz;
      if (Math.abs(dx) > 2.4 * c.r || Math.abs(dz) > 2.4 * c.r) continue;
      const d = Math.hypot(dx, dz) / c.r;
      if (c.depth > 0.4 * c.r) {
        // a pit: its walls fall into the dark long before the floor
        if (d < 1) v *= 1 - 0.78 * (1 - d ** 4);
      } else if (d < 0.95) { v *= 1 - 0.13 * (1 - d); cool += 0.02 * (1 - d); }
      v *= 1 + 0.15 * Math.exp(-(((d - 1.02) / 0.14) ** 2));
      if (d > 1.2 && d < 2.4) v *= 1 + 0.045 * (2.4 - d) / 1.2 * (0.6 + 0.4 * noise(x / 7, z / 7));
    }
    let r = this.base.r * v * (1 - cool), g = this.base.g * v, b = this.base.b * v * (1 + cool);
    for (const d of this.deposits) {
      const tint = DEPOSIT_TINT[d.kind];
      if (!tint) continue;
      const dx = x - d.cx, dz = z - d.cz;
      if (Math.abs(dx) > 1.3 * d.r || Math.abs(dz) > 1.3 * d.r) continue;
      const w = 1 - smooth(0.6, 1.12, Math.hypot(dx, dz) / d.r + 0.12 * noise(x / 9 + 3, z / 9 - 7));
      if (w <= 0) continue;
      if ('mul' in tint) {
        r *= 1 + (tint.mul[0] - 1) * w; g *= 1 + (tint.mul[1] - 1) * w; b *= 1 + (tint.mul[2] - 1) * w;
      } else {
        const k = tint.k * w;
        r += (tint.toward[0] - r) * k; g += (tint.toward[1] - g) * k; b += (tint.toward[2] - b) * k;
      }
    }
    out[o] = r; out[o + 1] = g; out[o + 2] = b;
  }
}

const cache = new WeakMap<Heightfield, ClassicGround>();

/** The classic ground colour for a heightfield (one per world). */
export function classicGround(hf: Heightfield): ClassicGround {
  let g = cache.get(hf);
  if (!g) { g = new ClassicGround(hf); cache.set(hf, g); }
  return g;
}

/** A flat-faceted copy of an indexed surface: every triangle its own three
 *  vertices, normals per face — faceting from the geometry itself, with no
 *  derivative (dFdx) shading in the fragment shader. */
export function facet(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  flat.deleteAttribute('normal');
  flat.computeVertexNormals();
  flat.computeBoundingSphere();
  return flat;
}
