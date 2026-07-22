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
export const MAX_SLOPE_DELTA = 2.5;    // max height delta (m) across a footprint

export const START = {
  crew: 4,
  morale: 70,
  data: 0,
  powerStored: 800,                    // energy units (kW·gs) in the lander bank
  resources: {
    regolith: 0, metals: 140, silicon: 0, water: 50, oxygen: 120,
    food: 120, parts: 70, foils: 0, launch: 0,
  } as const,
};

export const CREW = {
  oxygenPerCrew: 0.02,                 // per game-second
  foodPerCrew: 0.008,
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
