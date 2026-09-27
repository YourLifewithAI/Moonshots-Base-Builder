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

/** A class, or an X's proton-storm tail: the columns of docs/16 §4.2. */
export type FlareKey = FlareClass | 'tail';

/** The flare's own counters (docs/16 §4.5–4.7, §4.14), as alert and pop-up
 *  buttons beside the hazards' (game.ts routes them to core/flareEffects.ts). */
export type FlareCounterId = 'flareRecall' | 'flareCheckpoint' | 'flareShutDown' | 'flareReplace' | 'flareReprint' | 'flareReprintUnit'
  | 'flareReplaceWorst';

/** What a flare costs beyond the arrays (docs/16 §4): rad scars and capability,
 *  machines in the open, crew indoors, labs, fabs and compute, the comms
 *  blackout, wear, and the Replace and Re-print that clear scars.
 *  core/flareEffects.ts runs it. Every effect scales by (1 − σ), the scars by
 *  (1 − σ)² and a tenth when prepared. */
export const FLARE_EFFECTS = {
  /** rad scars (§4.13): capability × (1 − rate × (1 − σ)² × prep × hard), cumulative, never below capFloor */
  scar: { C: 0.0025, M: 0.015, X: 0.05, tail: 0.01 } as Record<FlareKey, number>,
  /** prepared (shut down or off, docked, parked): the scar × this */
  prep: 0.1,
  capFloor: 0.1,
  /** the capability alert fires once, crossing this; the panel's SCARRED line counts what is under it */
  alertAt: 0.85,
  /** machines (§4.5): each draws once as the protons arrive (the tail: as a C). Odds × (1 − σ);
   *  a latch-up or a burn-out needs the open — a docked machine only reboots */
  machines: {
    reboot: { C: 0.15, M: 0.4, X: 0.4, tail: 0.15 } as Record<FlareKey, number>,
    latch: { C: 0, M: 0, X: 0.45, tail: 0 } as Record<FlareKey, number>,
    burn: { C: 0, M: 0, X: 0.15, tail: 0 } as Record<FlareKey, number>,
    rebootS: { C: 20, M: 40, X: 60, tail: 20 } as Record<FlareKey, number>,
    /** Watchdogs and failover (the Lights-Out Charter): a reboot takes this long */
    watchdogS: 10,
    /** a latched machine is lost if not re-flashed by then */
    deadlineS: 480,
    /** excavators re-flash over the Lander's link, one per this */
    reflashS: 30,
    /** a dock's shield for the machine parked in it (a bermed dock is F4's) */
    dockSigma: 0.5,
  },
  /** Rad-Hard Process: latch-ups, burn-outs, chip yield loss, compute errors and the scars of labs, compute and fabs × this */
  radHard: 0.5,
  /** crew indoors (§4.4): at an X, this share of each home × (1 − σ) is sick, off work this long; never lethal */
  sick: { share: 0.25, days: 0.5 },
  /** labs (§4.6): data × (1 − L × (1 − σ)) while the protons are in */
  labs: { C: 0.3, M: 0.5, X: 0.8, tail: 0.28 } as Record<FlareKey, number>,
  /** the head tech loses this share of its data cost as the protons arrive (never more than it has) */
  headLoss: { C: 0, M: 0.03, X: 0.1 } as Record<FlareClass, number>,
  /** Chip Fabs (§4.7): chips × (1 − loss × (1 − σ)); an X scraps the batch, this many seconds of its output */
  chips: { C: 0.2, M: 0.5, X: 1, tail: 0.35 } as Record<FlareKey, number>,
  batchS: 60,
  /** Data Centers and Server Monoliths: data × this (its loss × (1 − σ)) */
  compute: { C: 0.8, M: 0.6, X: 0.3, tail: 0.75 } as Record<FlareKey, number>,
  /** the comms blackout (§4.8), from the protons: an M's active phase; an X's flash, tail and 60 s more */
  blackout: { C: 0, M: 45, X: 240 } as Record<FlareClass, number>,
  /** wear (§4.9) as the protons arrive: running structures, and machines in the open */
  wear: { C: 0, M: 0.03, X: 0.08 } as Record<FlareClass, number>,
  machineWear: { C: 0, M: 0.05, X: 0.15 } as Record<FlareClass, number>,
  /** a shut-down structure (or a parked excavator) restarts this long after the flare: its warm-up */
  warmS: 20,
  /** Replace (§4.14): this share of the build cost and of the build time */
  replace: { cost: 0.5, time: 0.6 },
  /** Re-print a scarred rover or drone at its dock: half the dock's reprint, 72 s */
  reprint: { metals: 5, parts: 8, s: 72 },
  /** Earth Teleoperation's build speed (its buildSpeed effect) is lost in the blackout */
  teleop: 0.85,
};

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
