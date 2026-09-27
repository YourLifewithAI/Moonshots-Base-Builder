/** Space weather (docs/16-space-weather.md): the flare classes, the solar
 *  cycle, the schedule's rules, what a flare does to the arrays, and the
 *  seeds every draw uses. core/spaceWeather.ts runs it (weatherTick).
 *
 *  Game time is compressed (a game-second is about an hour), so the order
 *  of a real flare is kept (the flash, the protons, the CME), not the ratios.
 *  If a number here disagrees with docs/16, this file wins. */

export type FlareClass = 'C' | 'M' | 'X';
export const FLARE_CLASSES: readonly FlareClass[] = ['C', 'M', 'X'];

/** the arrays' choice for one flare (docs/16 §5): keep all running, stow all,
 *  stow a share p (0..1), or stow all but the critical feed */
export type ArrayChoiceMode = 'run' | 'stow' | 'portion' | 'feed';
export interface ArrayChoice { mode: ArrayChoiceMode; p?: number }

/** who decided this flare's arrays (docs/16 §5.4, in order) */
export type FlareDecider = 'click' | 'remembered' | 'builder' | 'default';

export interface ClassDef {
  /** the telegraph (the flash) before research, s */
  telegraphS: number;
  /** the active phase (the protons), s */
  activeS: number;
  /** the proton-storm tail after the active phase (X only), s */
  tailS: number;
  /** HUD glyph: open, half and solid squares (docs/16 §10.6) */
  glyph: string;
}

export const SPACE_WEATHER = {
  /** the first telegraph (day 2.4 = 28.8 min, as the legacy flare) is a C drill */
  firstAtDay: 2.4,
  classes: {
    C: { telegraphS: 60, activeS: 30, tailS: 0, glyph: '□' },
    M: { telegraphS: 60, activeS: 45, tailS: 0, glyph: '◧' },
    X: { telegraphS: 120, activeS: 60, tailS: 120, glyph: '■' },
  } as Record<FlareClass, ClassDef>,
  /** a drill's telegraph is this much longer, as hazard drills are */
  drillExtraS: 60,
  /** the X-ray peak: the class shows as a range until this far into the telegraph */
  firmAtS: 20,
  /** the tail's strength against the flash (the §4 table's own tail column is used where it has one) */
  tailStrength: 0.35,
  /** the solar cycle (docs/16 §3.4), in lunar days since landing */
  cycle: {
    tMax: 11, tMaxShift: 1, aMin: 0.1, aMaxLo: 0.85, aMaxHi: 1.0, fallDays: 16,
    /** after its fall the cycle repeats with a new draw */
    periodDays: 27,
  },
  /** the next telegraph, after a flare ends: (base − slope·a)·(1 ± jitter) lunar days */
  interval: { base: 2.3, slope: 1.0, jitter: 0.3 },
  /** class odds for flare n (after the drill), from the activity a and the era */
  odds: { xPerA2: 0.25, xEra: 4, xGapDays: 2, mBase: 0.2, mPerA: 0.45, mEra: 2 },
  /** rule 5: a second X once Era 5 is open, a ≥ this, 2 days after the first */
  secondX: { era: 5, minA: 0.6 },
  /** CMEs: every X and one M in three, this long after the flash; the sail window after it */
  cme: { mShare: 1 / 3, delayDays: 0.4, sailS: 180 },
  /** Earth's bulletin: the activity band */
  bands: { active: 0.35, stormy: 0.7 },
  /** the spot-group watch: this long before an X */
  watchDays: 0.5,
  /** a loaded save's grace (migration step 4): no X this long after the load */
  loadGraceDays: 1,
  /** morale (docs/16 §4.10): at once, and the target while active; the tail's target */
  morale: { C: { hit: 3, target: 5 }, M: { hit: 8, target: 10 }, X: { hit: 12, target: 15 }, tail: 10, drillHit: 3 },
  /** heliophysics data a flare pays at its active start while a lab operates (a pro) */
  heliophysics: { C: 15, M: 30, X: 60 } as Record<FlareClass, number>,
  /** the power beam through the active phase (and the tail) */
  beam: { C: 0.5, M: 0, X: 0, tail: 0 },
  /** arrays (docs/16 §4.3): running, the share destroyed and the scar on the rest;
   *  stowed, the repairable damage. The X's tail has its own column. */
  arrays: {
    destroy: { C: 0, M: 0.15, X: 0.5, tail: 0 },
    scar: { C: 0.005, M: 0.02, X: 0.05, tail: 0.015 },
    stowed: { C: 0, M: 0.05, X: 0.15, tail: 0.05 },
    /** capability never falls below this */
    capFloor: 0.1,
    /** repairable damage never passes this */
    dmgMax: 0.9,
  },
  /** stowing and unstowing take this long (the wing turns on its hinge) */
  stowS: 10,
  /** field berms (Regolith Shielding): a stowed array's shield */
  fieldBermSigma: 0.5,
  /** the critical feed's margin (the Builder's threshold defaults to it) */
  feedMargin: 1.1,
  /** a stowed array's repair (docs/16 §4.3): 1⚙ per 10% of damage (halves up; none under 5%),
   *  6 s + 0.2 s per %, 4 kW while it works, behind every construction site */
  repair: { pctPerPart: 10, baseS: 6, perPctS: 0.2, kw: 4, queueAt: 1e6 },
  /** wrecks: Rebuild is a build at full cost plus this long to clear the wreck;
   *  Clear takes a rover this long and refunds the salvage share */
  wreck: { clearWreckS: 10, clearS: 15, salvage: 0.25 },
  /** the flare log keeps this many */
  logMax: 20,
  /** the fixed seed per draw (docs/16 §14.1): mulberry32((seed ^ K) + index) */
  keys: { cycle: 0x5c1e, interval: 0x5f1a, cls: 0x5f1c, forecast: 0x5f1d, machine: 0x5f1e, cme: 0x5f1f, arrays: 0x5f20 },
} as const;

/** The legacy flare (docs/16 §12.3, `--flares=legacy`): today's machine for
 *  the probe's baseline — every flare 60 s warned and 45 s active, solar 0,
 *  −10 morale at once and a −10 target, +25≡ with a lab. */
export const LEGACY_FLARE = {
  firstAtDay: 2.4,
  periodDays: 2.0, jitterDays: 0.8,
  telegraphS: 60, activeS: 45,
  moraleHit: 10, moraleTarget: 10,
  data: 25,
};

/** The Pause on flare warnings setting (the menu, docs/16 §10.4). */
export type FlarePause = 'mx' | 'all' | 'off';
export const FLARE_PAUSE_LABEL: Record<FlarePause, string> = { mx: 'M and X', all: 'All', off: 'Off' };

/** the portion buttons of the pop-up (docs/16 §5.2) */
export const PORTIONS: readonly number[] = [0.25, 0.5, 0.75];

/** the neighbour a range pairs with (docs/16 §6.2): C → C–M, X → M–X, M → either */
export const CLASS_RANK: Record<FlareClass, number> = { C: 0, M: 1, X: 2 };
export const worse = (a: FlareClass, b: FlareClass): FlareClass => (CLASS_RANK[a] >= CLASS_RANK[b] ? a : b);
