/** One plain-JSON world state object. The sim owns it; the UI never mutates it
 *  (typed actions only); the renderer reads it. Everything here serializes. */
import type { ResourceId } from '../data/resources';
import { BUILDINGS, type BuildingId } from '../data/buildings';
import type { TechId } from '../data/techs';
import { SITES, type SiteId } from '../data/sites';
import { emptyFeed, type DepositKind, type FeedGrade } from '../data/deposits';
import type { OutpostKind, ProspectClass, ProspectId } from '../data/lunarMap';
import { START } from '../data/balance';

export interface BuildingState {
  id: number;
  type: BuildingId;
  gx: number;                // footprint origin cell
  gz: number;
  rot: 0 | 1 | 2 | 3;
  enabled: boolean;
  /** run on autonomous agents: no crew or morale dependence, power ×1.6 */
  automated: boolean;
  /** solar only: terrain currently blocks the sun (computed by the renderer side) */
  shaded?: boolean;
  /** brownout hysteresis: ticks to stay dark before retrying the grid */
  brownoutHold?: number;
  /** construction sites: robot-queue position when moved up with Build next
   *  (unset = placement order, i.e. the id) */
  buildSeq?: number;
  priority: 0 | 1 | 2 | 3;   // player-overridable idle order
  wear: number;              // 0..1, rises when parts run dry
  dust: number;              // solar arrays: 0..1 output loss
  /** game-seconds of construction remaining (0 = operational) */
  construction: number;
  /** total construction time this building was placed with (for progress UI) */
  buildTotal: number;
  /** filled in by the economy each tick (for inspector/status UI);
   *  'reserve' = the inputs on hand are the crew's life-support reserve,
   *  'full' = no stockpile room for a tick of any of its outputs */
  active: boolean;
  idleReason: '' | 'power' | 'crew' | 'inputs' | 'reserve' | 'full' | 'off' | 'building' | 'queued';
  /** Dynamic Clocking: ×1.5 draw, inputs, outputs and data; extra wear */
  overclock?: boolean;
  /** deposit under the footprint centre (stamped on placement, recomputed on load) */
  deposit?: DepositKind;
  /** hydroponics: seconds of output lost to a dead crop (0 = growing) */
  cropRegrowT?: number;
  /** seconds held dark (idleReason 'power') at night, reset when powered */
  darkT?: number;
  /** solar: seconds continuously in terrain shade */
  shadedT?: number;
  /** generators: staffed at last tick's worker allocation */
  staffedPrev?: boolean;
}

/** Charter deeds and insight triggers (spec S2). Zeroed on a new run. */
export interface GameStats {
  /** buildings only — outposts and shipments excluded */
  produced: Record<ResourceId, number>;
  built: number;
  waitingSitesPeak: number;
  nightBrownouts: number;
  dayBrownouts: number;
  /** a priority ≤1 load went dark this night (reset at dusk) */
  nightCritDark: boolean;
  /** per-night accumulators, reset at dusk */
  nightLoadShed: boolean;
  nightDcAllActive: boolean;
  cleanNightStreak: number;
  dcCleanNight: boolean;
  darkNightMaxS: number;
  shadedMaxS: number;
  maxDust: number;
  lowPartsSeen: boolean;
  wornSeen: boolean;
  flaresWithSix: number;
  ilmeniteDigS: number;
  dcOpS: number;
  outpostOpS: number;
  minReserveS: number;
  minMorale: number;
}

export interface ProspectRecord { surveyedAt: number; cls: ProspectClass; data: number }
export interface ActiveSurvey { id: ProspectId; startedAt: number; endsAt: number }
export interface OutpostState {
  id: ProspectId;
  kind: OutpostKind;
  cls: ProspectClass;
  claimedAt: number;
  readyAt: number;
  /** streaming (set once readyAt passes); only live outposts feed computeMods */
  live: boolean;
  fuelOk: boolean;
  upkeepOk: boolean;
}
export interface SurveyState {
  /** deposit ids revealed outside the tier radius (placement strike, relay mast, legacy ice survey) */
  struck: string[];
  prospects: Partial<Record<ProspectId, ProspectRecord>>;
  active: ActiveSurvey | null;
  outposts: OutpostState[];
  atlas: boolean;
}

export interface FlareState {
  phase: 'idle' | 'telegraph' | 'active';
  timer: number;             // game-seconds remaining in phase
  nextAt: number;            // game-time (s) of next telegraph start
}

/** what clicking an alert does: open a resource info panel, or select a building */
export type AlertAction = { panel: string } | { select: number };

/** One line of the alert stack. A condition (cond) is re-raised by every
 *  economy tick while it holds and leaves soon after it stops; an event is
 *  raised once, and a repeat while it is still listed merges into it. */
export interface AlertMsg {
  id: number;
  text: string;
  kind: 'info' | 'warn' | 'crit';
  at: number;                // game time last raised
  /** repeats merge on this: a condition's name, an event's text */
  key: string;
  cond?: boolean;
  /** events: times raised while listed; conditions: instances this tick */
  count: number;
  /** conditions: economy ticks left before an unraised condition is cleared */
  ttl?: number;
  /** an info alert that has had its moment on screen: listed, not shown */
  quiet?: boolean;
  action?: AlertAction;
}

export interface GameState {
  version: 1;
  siteId: SiteId;
  seed: number;
  /** who runs this base: fragile clever humans, or power-hungry tireless robots */
  expedition: 'human' | 'robotic';
  simTime: number;           // game-seconds since landing
  speed: number;             // 1 | 3 | 10
  paused: boolean;

  resources: Record<ResourceId, number>;
  powerStored: number;       // kWh across all batteries + lander
  /** last economy tick's power book-keeping, for the HUD: demand is what every
   *  running load requested (dark ones included), served what the grid delivered;
   *  brownout = a priority 0–1 load is dark, shed = only priority 2–3 loads idled */
  power: {
    supply: number; demand: number; served: number; capacity: number;
    brownout: boolean; shed: boolean;
  };

  crew: number;
  /** beds in enabled, completed, powered housing — what the economy counts */
  housingActive: number;
  morale: number;
  data: number;
  /** smoothed net flow per resource, per game-second (production − consumption
   *  − upkeep − spillage; deliveries and research goods are not flow) */
  rates: Partial<Record<ResourceId, number>>;
  /** construction-robot fleet, recomputed each tick (busy = sites being built) */
  bots: { total: number; busy: number };

  era: number;
  techsDone: TechId[];
  researchQueue: TechId[];   // head is in progress
  /** data banked per tech — survives queue reshuffles and cancels */
  researchSpent: Partial<Record<TechId, number>>;
  /** tech-table schema; 1 = the 34-id tree (migrated by migrateTechSchema) */
  techSchema: number;
  /** earned research discounts per tech (0..INSIGHT_MAX) */
  insights: Partial<Record<TechId, number>>;
  /** breakthrough techs revealed by surveying a host prospect */
  discoveries: TechId[];
  /** queued techs whose data is paid but whose goods are short */
  researchStalled: TechId[];
  /** why the queue is not moving: no operating lab/DC, or every lab browned out */
  researchPaused: '' | 'noLab' | 'brownout';
  /** 30 s moving average of the actual data transfer, /s (ETAs) */
  researchRateAvg: number;
  stats: GameStats;
  /** last tick's excavator feed shares — kept while nothing is dug */
  feed: FeedGrade;
  downlinks: number;
  /** robotic Human Cohabitation: settlers board at `at` if the base can keep them */
  crewRotation: { at: number; count: number } | null;
  survey: SurveyState;

  buildings: BuildingState[];
  nextBuildingId: number;
  /** flatten history, replayed onto regenerated terrain on load */
  flattens: { x0: number; z0: number; x1: number; z1: number; h: number }[];

  swarmPct: number;
  launches: number;

  nightsSurvived: number;
  wasNight: boolean;
  starveT: number;           // seconds spent at zero O2/food
  growthT: number;           // crew growth accumulator

  flare: FlareState;
  /** Earth shipments; arriveAt is game time, ordered counts the hand-placed
   *  orders (the automatic anti-softlock rescue is not counted) */
  resupply: { pending: boolean; arriveAt: number; shipments: number; ordered?: number };
  /** ice deposits mapped (Lander survey, ice sites only) */
  iceSurveyed: boolean;
  /** current stockpile capacities, recomputed each tick (for the HUD) */
  storageCaps: Partial<Record<import('../data/resources').ResourceId, number>>;
  alerts: AlertMsg[];
  nextAlertId: number;
  /** dismissed conditions: key → game time the snooze ends */
  alertSnooze: Record<string, number>;
  milestonesDone: string[];

  victoryShown: boolean;
  defeatShown: boolean;
}

export function createInitialState(
  siteId: SiteId,
  seed: number,
  expedition: 'human' | 'robotic' = 'human',
): GameState {
  return {
    version: 1,
    siteId,
    seed,
    expedition,
    simTime: 90, // land mid-morning: the first thing you see is sunlit regolith
    speed: 1,
    paused: false,
    // the cache buys the same opening everywhere: rough sites cost more to build on
    resources: {
      ...START.resources,
      metals: Math.round(START.resources.metals * SITES[siteId].buildCostMult),
    },
    powerStored: START.powerStored,
    power: { supply: 0, demand: 0, served: 0, capacity: START.powerStored, brownout: false, shed: false },
    crew: expedition === 'robotic' ? 0 : START.crew,
    housingActive: BUILDINGS.lander.housing ?? 0, // every base lands with its Lander
    morale: START.morale,
    data: START.data,
    rates: {},
    bots: { total: 2, busy: 0 },
    era: 1,
    techsDone: [],
    researchQueue: [],
    researchSpent: {},
    ...researchDefaults(),
    buildings: [],
    nextBuildingId: 1,
    flattens: [],
    swarmPct: 0,
    launches: 0,
    nightsSurvived: 0,
    wasNight: false,
    starveT: 0,
    growthT: 0,
    flare: { phase: 'idle', timer: 0, nextAt: 0 },
    resupply: { pending: false, arriveAt: 0, shipments: 0, ordered: 0 },
    iceSurveyed: false,
    storageCaps: {},
    alerts: [],
    nextAlertId: 1,
    alertSnooze: {},
    milestonesDone: [],
    victoryShown: false,
    defeatShown: false,
  };
}

export function emptyStats(): GameStats {
  return {
    produced: {
      regolith: 0, metals: 0, silicon: 0, water: 0, oxygen: 0,
      food: 0, parts: 0, chips: 0, foils: 0, launch: 0,
    },
    built: 0, waitingSitesPeak: 0, nightBrownouts: 0, dayBrownouts: 0,
    nightCritDark: false, nightLoadShed: false, nightDcAllActive: false,
    cleanNightStreak: 0, dcCleanNight: false, darkNightMaxS: 0, shadedMaxS: 0,
    maxDust: 0, lowPartsSeen: false, wornSeen: false, flaresWithSix: 0,
    ilmeniteDigS: 0, dcOpS: 0, outpostOpS: 0,
    minReserveS: 1e9,   // "never measured": no crew aboard yet
    minMorale: 100,
  };
}

function researchDefaults() {
  return {
    techSchema: 2,
    insights: {},
    discoveries: [] as TechId[],
    researchStalled: [] as TechId[],
    researchPaused: '' as const,
    researchRateAvg: 0,
    stats: emptyStats(),
    feed: emptyFeed(),
    downlinks: 0,
    crewRotation: null,
    survey: { struck: [], prospects: {}, active: null, outposts: [], atlas: false } as SurveyState,
  };
}

/** Fill every field added with the research/map redesign on a loaded state
 *  (never overwrites). techSchema is left alone: migrateTechSchema owns it. */
export function fillStateDefaults(s: GameState): GameState {
  const legacy = s as Partial<GameState> & GameState;
  const d = researchDefaults();
  legacy.insights ??= d.insights;
  legacy.discoveries ??= d.discoveries;
  legacy.researchStalled ??= d.researchStalled;
  legacy.researchPaused ??= d.researchPaused;
  legacy.researchRateAvg ??= d.researchRateAvg;
  legacy.stats = { ...d.stats, ...(legacy.stats ?? {}) };
  legacy.stats.produced = { ...d.stats.produced, ...(legacy.stats.produced ?? {}) };
  legacy.feed = { ...d.feed, ...(legacy.feed ?? {}) };
  legacy.downlinks ??= d.downlinks;
  legacy.crewRotation ??= d.crewRotation;
  legacy.survey = { ...d.survey, ...(legacy.survey ?? {}) };
  for (const b of legacy.buildings ?? []) {
    b.overclock ??= false;
    b.cropRegrowT ??= 0;
  }
  return s;
}
