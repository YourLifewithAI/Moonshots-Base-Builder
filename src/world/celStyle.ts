/** The cel style's tunables, in one place (docs/19, S1a and S1b): the light
 *  ramp and the ink outline. Both streams read the active variant through
 *  `celVariant()`, so the look bake-off (A, B, C) is one constant, and the
 *  player's pick is one edit.
 *
 *   A  2-step ramp, 2 px ink
 *   B  3-step ramp, 1.5 px ink (the default)
 *   C  3-step ramp, ink tinted by the surface's accent (darkened 60%)
 *
 *  `?cel=A|B|C` in the address overrides the constant for that page load, so
 *  all three variants can be photographed without a code edit. It is read
 *  once (the ramp is baked into uniforms at boot); anything else falls back
 *  to `CEL_VARIANT`. */

export type CelVariant = 'A' | 'B' | 'C';

/** The bake-off's pick. */
export const CEL_VARIANT: CelVariant = 'B';

export interface RampPreset {
  /** light steps (a lit face, a face turned away) */
  steps: 2 | 3;
  /** each step's share of the surface's colour, brightest first */
  levels: readonly number[];
  /** where each step below the first begins, in n·l against the key light:
   *  a face lit above `edges[0]` wears `levels[0]`, above `edges[1]` (3 steps)
   *  `levels[1]`, and below that the last level. The roof of a building
   *  (n·l = sin of the key's 22–48° elevation, night 35°+) sits above the first
   *  edge, a wall square to the key's azimuth (n·l = 0) in the middle step, a
   *  wall turned away in the last. */
  edges: readonly number[];
  /** the smoothstep width between steps, in n·l (a soft edge, not a jag) */
  soft: number;
}

export const RAMP: Record<CelVariant, RampPreset> = {
  A: { steps: 2, levels: [1.0, 0.62], edges: [0.05], soft: 0.02 },
  B: { steps: 3, levels: [1.0, 0.72, 0.5], edges: [0.3, -0.15], soft: 0.02 },
  C: { steps: 3, levels: [1.0, 0.72, 0.5], edges: [0.3, -0.15], soft: 0.02 },
};

/** The ground's own ramp (terrain, rocks, berms, roads, the horizon ring): two
 *  steps in every variant. A face wears `shade` once it turns from the light
 *  by more than `drop` (in n·l, against level ground's own), so plains stay
 *  one tone while slopes, crater walls and boulders' far sides read as bands. */
export const GROUND_RAMP = { shade: 0.8, drop: 0.14 } as const;

export interface InkPreset {
  /** the outline's width on screen, px */
  px: number;
  /** the ink by day and by night (0xRRGGBB) */
  day: number;
  night: number;
  /** tinted: the surface's accent darkened by `tintDark` instead of the flat ink */
  tinted: boolean;
  tintDark: number;
}

export const INK: Record<CelVariant, InkPreset> = {
  A: { px: 2, day: 0x141618, night: 0x06080b, tinted: false, tintDark: 0 },
  B: { px: 1.5, day: 0x141618, night: 0x06080b, tinted: false, tintDark: 0 },
  C: { px: 1.5, day: 0x141618, night: 0x06080b, tinted: true, tintDark: 0.6 },
};

let active: CelVariant | null = null;

/** The variant in force: `?cel=A|B|C`, else `CEL_VARIANT`. Read once. */
export function celVariant(): CelVariant {
  if (active) return active;
  active = CEL_VARIANT;
  try {
    const v = new URLSearchParams(globalThis.location?.search ?? '').get('cel')?.toUpperCase();
    if (v === 'A' || v === 'B' || v === 'C') active = v;
  } catch { /* no address to read: the constant stands */ }
  return active;
}

/** The active presets. */
export const ramp = (): RampPreset => RAMP[celVariant()];
export const ink = (): InkPreset => INK[celVariant()];
