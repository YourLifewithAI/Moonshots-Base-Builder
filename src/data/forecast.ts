/** Flare forecasting (docs/16 §6, phase F3): the tiers, the windows, the
 *  telegraph bonuses, the Solar Observatory's trickle, the L1 Sentinel's
 *  launch, and the timeline. core/forecast.ts runs it.
 *
 *  A forecast never lies (§6.2): the true flash is always inside the window,
 *  and the true class inside the range. If a number here disagrees with
 *  docs/16, this file wins. */

/** T0 the flash and Earth's bulletin · T1 Heliophysics Forecasting and a
 *  Solar Observatory · T2 the L1 Sentinel on station · T3 Solar-Cycle Forecasting */
export type ForecastTier = 0 | 1 | 2 | 3;

export const TIER_NAME: Record<ForecastTier, string> = {
  0: 'T0 · the flash and Earth’s bulletin',
  1: 'T1 · Heliophysics Forecasting',
  2: 'T2 · the L1 Sentinel',
  3: 'T3 · Solar-Cycle Forecasting',
};

export const FORECAST = {
  /** the extra warning a tier adds to every telegraph, s (§6.1: C and M 60 → 90 → 120, X 120 → 150 → 180).
   *  The telegraph starts this much earlier; the protons come when they would have. */
  leadS: [0, 30, 60, 60] as readonly number[],
  /** the window: W = max(minS, f·(t − now)), placed by v = vLo + vSpan·u (§6.2) */
  window: {
    t1: { f: 0.6, minS: 60 },
    t2: { f: 0.2, minS: 30 },
    /** the flares after the next (T3): the cycle model's window */
    t3: { f: 0.4, minS: 90 },
    vLo: 0.2, vSpan: 0.6,
  },
  /** a fresh look every this many game-seconds (and at once when the tier, the flare or the era changes) */
  updateS: 60,
  /** blind (night off the pole, a ridge's shade, no power): the last window
   *  holds and widens by this share of itself a game-minute */
  blindWiden: 0.2,
  /** the observatory sees the Sun above this sun factor */
  seesSun: 0.05,
  /** a Solar Observatory's heliophysics while it sees the Sun (≡/s, one for the base), and a flare's data × this */
  obsDataPerS: 0.05,
  obsFlareMult: 2,
  /** the L1 Sentinel (§6.4): its launch at the Lander, the Mass Driver's throw, its cruise */
  sentinel: {
    cost: { chips: 15, parts: 30 },
    /** the hopper's kick stage: propellant */
    propellant: { oxygen: 80, water: 20 },
    /** with a Mass Driver: stored energy instead of propellant */
    driverEnergy: 400,
    cruiseDays: 1,
  },
  /** T3: this many flares on the timeline */
  aheadN: 3,
  /** the timeline (§10.5): lunar days wide by tier, and how much of the past it keeps */
  timeline: { days: [1, 2, 2, 3] as readonly number[], pastDays: 0.25, fadeDays: 0.5 },
  /** the T3 cycle strip: this many lunar days, one block each */
  cycleDays: 20,
};
