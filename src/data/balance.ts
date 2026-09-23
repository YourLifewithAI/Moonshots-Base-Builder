/** Global tuning constants. All sim rates are per game-second (economy ticks at 1 Hz
 *  of game time; game speed multiplies how fast game time passes). */

export const CELL_M = 4;               // build grid cell, meters
export const MAP_CELLS = 256;          // 256 cells -> 1024 m square map
export const MAP_M = CELL_M * MAP_CELLS;
export const CHUNKS = 8;               // 8x8 terrain chunks
export const CHUNK_CELLS = MAP_CELLS / CHUNKS;

export const SIM_HZ = 30;              // fixed-timestep sim
export const ECON_PERIOD = 1;          // economy tick every 1 game-second

/** Compressed lunar day: 8 min day + 4 min night at 1x. */
export const DAY_S = 480;
export const NIGHT_S = 240;
export const CYCLE_S = DAY_S + NIGHT_S;

export const SPEEDS = [1, 3, 10] as const;

export const GRAVITY = 1.62;           // m/s^2 — the Moon
export const JUMP_V = 2.6;             // m/s  — apex ~2.1 m, hang ~3.2 s
export const WALK_SPEED = 3.0;         // m/s lope
export const EYE_HEIGHT = 1.7;
export const PLAYER_RADIUS = 0.5;

export const BUILD_RADIUS_M = 60;      // buildable distance from Lander / any Habitat
export const CONSTRUCTION_KW = 4;      // grid draw per active construction site
export const CONSTRUCTION_PARTS_PER_S = 0.04; // welding consumables per active site
export const GRADE_COST_ENERGY = 40;   // stored energy per 16x16 m grading pass
export const GRADE_REGOLITH_YIELD = 6; // spoil recovered per pass
export const GRADE_CELLS = 4;          // grading footprint, cells
export const MAX_SLOPE_DELTA = 2.5;    // max height delta (m) across a footprint

export const START = {
  crew: 4,
  morale: 70,
  data: 0,
  powerStored: 800,                    // energy units (kW·gs) in the lander bank
  resources: {
    regolith: 0, metals: 140, silicon: 0, water: 50, oxygen: 120,
    food: 120, parts: 70, chips: 0, foils: 0, launch: 0,
  } as const,
};

export const CREW = {
  oxygenPerCrew: 0.02,                 // per game-second
  foodPerCrew: 0.008,
  waterPerCrew: 0.005,
  growthMorale: 60,                    // min morale for crew growth
  growthPeriod: CYCLE_S,               // +1 crew per lunar day when conditions met
  starveGraceS: 60,                    // seconds at zero O2/food before losses begin
  lossPeriodS: 30,
};

export const MORALE = {
  lerp: 0.05,                          // approach rate toward target per econ tick
  fed: 8, starving: -30,
  housed: 0, crowded: -20,
  blackout: -15, flare: -10,
  workMultMin: 0.5, workMultSpan: 0.7, // work mult = 0.5 + morale/100 * 0.7
};

export const BATTERY_EFF = 0.85;       // round-trip
export const SOLAR_DUST_PER_DAY = 0.08; // output fraction lost per lunar day, uncleaned
export const SOLAR_DUST_MAX = 0.5;
export const SOLAR_DUST_RECOVER = 0.2; // per day, when parts upkeep is being paid

/** low-reserve anxiety: below this many seconds of remaining supply, morale sinks */
export const LOW_SUPPLY_S = 300;

/** research transfer cap: each OPERATING lab feeds this much banked data per
 *  game-second into the active tech — no lab, no progress; big techs want
 *  research campuses */
export const RESEARCH_RATE_PER_LAB = 0.4;

/** one-time ice survey from the Lander, paid in stored energy */
export const ICE_SURVEY_COST = 150;

/** emergency Earth resupply — the anti-softlock: no smelter and no metals for
 *  one means a shipment is ordered, and Earth is a full lunar day away */
export const RESUPPLY = {
  metals: 60,
  parts: 20,
  delayS: CYCLE_S,
  moraleHit: 5,
};

export const FLARE = {
  firstAtDay: 2.4,
  periodDays: 2.0, jitterDays: 0.8,
  telegraphS: 60, activeS: 45,
  moraleHit: 10,
};

export const LAUNCH_COST_FOILS = 10;   // one collector volley
export const LAUNCH_POWER_BURST = 400; // stored energy drained per launch
/** Swarm % contributed per collector volley launched. First volley moves the
 *  needle to 0.0001% — a Dyson swarm is big. Milestone bands live in milestones.ts. */
export const SWARM_PCT_PER_LAUNCH = 0.0001;
export const BEAM_KW_PER_LAUNCH = 4;   // power-beaming return per volley launched

export const AUTOSAVE_S = 60;          // real seconds

// ─── research tree & lunar map (docs/11-research-and-map-spec.md) ───

export const QUEUE_MAX = 5;
/** transfer cap per active Data Center (labs use RESEARCH_RATE_PER_LAB) */
export const RESEARCH_RATE_PER_DC = 2.5;
/** agent-run labs share one DSN allocation: E(n) = Σ weights[0..n−1], share = E(n)/n;
 *  counts past the end reuse the last weight */
export const LAB_UPLINK_WEIGHTS = [1, 1, 1, 1, 0.6, 0.6, 0.6, 0.6, 0.3];
export const INSIGHT_MAX = 0.5;
/** the single research-cost tuning dial, per resolved era */
export const ERA_COST_SCALE: Record<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8, number> = {
  1: 1.0, 2: 1.0, 3: 1.0, 4: 1.0, 5: 1.0, 6: 1.0, 7: 1.0, 8: 1.0,
};
/** era N opens with this many visible done techs of resolved era N−1 (or 1 + the deed) */
export const CHARTER_TECHS = 2;
/** time constant of the displayed research transfer average (s.researchRateAvg) */
export const RESEARCH_RATE_EMA_S = 30;

export const LAB_DATA = {
  base: 0.3,                           // data/s per lab before multipliers
  roboticAgent: 0.75,                  // agent-run lab on a robotic mission
  humanAgent: 1.0,                     // agent-run lab on a crewed mission
  crewedMoraleExp: 1.5,                // crewed labs scale with workMult^1.5
};
export const DC_DATA_PER_S = 1.0;

/** agent-run crewed stations draw ×(1 + agentTax); Rad-Hard multiplies the tax */
export const AGENT_TAX = 0.6;
export const WEAR_DERATE = { threshold: 0.3, mult: 0.5 };

export const OVERCLOCK = { mult: 1.5, wearPerDay: 0.35, tripWear: 0.3 };
export const DOWNLINK = {
  baseData: 150, stepData: 50,         // cost = base + step × downlinks so far
  delayS: 360,
  cargo: { metals: 60, parts: 20, chips: 5 } as const,
};
export const CREW_ROTATION = {
  delayS: 240, count: 2, retryS: 60,
  minO2: 60, minO2Rate: 0.04, minFood: 12, minWater: 8, minHousing: 2,
};
export const CROP_LOSS = { darkS: 30, regrowS: 150 };
export const HELIOPHYSICS_DATA = 25;   // flare turning active while a lab operates

export const LAUNCH_CAP_PER_VOLLEY = 3; // ↑ per volley — needs core-fixes sign-off
export const MAX_SLOPE_LARGE = 1.2;     // m of relief allowed under large pads

/** feed-grade coefficients (spec S7): factor = max(floor, 1 + Σ coef × share) */
export const FEED = {
  floor: 0.5,
  smelter: { ilmenite: 0.30, anorthosite: -0.30, kreep: -0.15 },
  smelterO2Glass: 0.6,
  refinery: { anorthosite: 0.40, ilmenite: -0.20 },
  kreepReactorShare: 0.15,
  kreepReactorUpkeep: 0.6,
  kreepOutputMult: 1.15,               // KREEP outpost: reactor output
  kreepChipMult: 1.1,                  // KREEP outpost: chipFab output (REE dopants)
};
/** location effects of the deposit under a building's footprint centre */
export const DEPOSIT_FX = {
  volatilesWater: 2.5, volatilesRegolith: 0.9,
  glassExcavatorUpkeep: 1.3,
  ridgeSolar: 1.2, ridgeSolarBuildTime: 1.3,
};

/** Exploration coverage tiers (index = tier) — reveal radius and outpost slots */
export const SURVEY_TIERS = [
  { label: 'LANDING SITE', revealM: 120, slots: 0 },
  { label: 'REGIONAL', revealM: 320, slots: 0 },
  { label: 'NEAR SIDE', revealM: MAP_M, slots: 1 },
  { label: 'FAR SIDE', revealM: MAP_M, slots: 2 },
  { label: 'SUBSURFACE', revealM: MAP_M, slots: 3 },
] as const;
export const ATLAS = { minTier: 4, surveys: 12, extraSlots: 1, streamMult: 1.25, insight: 0.25, lateData: 500 };
