/** The cel style's tunables, in one place (docs/19, S1a and S1b): the light
 *  ramp and the ink outline. Both streams read `CEL_VARIANT`, so the look
 *  bake-off (A, B, C) is one constant, and the player's pick is one edit.
 *
 *   A  2-step ramp, 2 px ink
 *   B  3-step ramp, 1.5 px ink (the default)
 *   C  3-step ramp, ink tinted by the surface's accent (darkened 60%)
 *
 *  Contract stream W0d: values only, nothing reads them yet. */

export type CelVariant = 'A' | 'B' | 'C';

/** The bake-off's pick. */
export const CEL_VARIANT: CelVariant = 'B';

export interface RampPreset {
  /** light steps (a lit face, a face turned away) */
  steps: 2 | 3;
  /** each step's share of the surface's colour, brightest first */
  levels: readonly number[];
  /** the smoothstep width between steps, in n·l (a soft edge, not a jag) */
  soft: number;
}

export const RAMP: Record<CelVariant, RampPreset> = {
  A: { steps: 2, levels: [1.0, 0.62], soft: 0.02 },
  B: { steps: 3, levels: [1.0, 0.72, 0.5], soft: 0.02 },
  C: { steps: 3, levels: [1.0, 0.72, 0.5], soft: 0.02 },
};

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

/** The active presets. */
export const ramp = (): RampPreset => RAMP[CEL_VARIANT];
export const ink = (): InkPreset => INK[CEL_VARIANT];
