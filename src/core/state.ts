/** One plain-JSON world state object. The sim owns it; the UI never mutates it
 *  (typed actions only); the renderer reads it. Everything here serializes. */
import type { ResourceId } from '../data/resources';
import type { BuildingId } from '../data/buildings';
import type { TechId } from '../data/techs';
import type { SiteId } from '../data/sites';
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
  priority: 0 | 1 | 2 | 3;   // player-overridable idle order
  wear: number;              // 0..1, rises when parts run dry
  dust: number;              // solar arrays: 0..1 output loss
  /** game-seconds of construction remaining (0 = operational) */
  construction: number;
  /** total construction time this building was placed with (for progress UI) */
  buildTotal: number;
  /** filled in by the economy each tick (for inspector/status UI) */
  active: boolean;
  idleReason: '' | 'power' | 'crew' | 'inputs' | 'off' | 'building' | 'queued';
}

export interface FlareState {
  phase: 'idle' | 'telegraph' | 'active';
  timer: number;             // game-seconds remaining in phase
  nextAt: number;            // game-time (s) of next telegraph start
}

export interface AlertMsg {
  id: number;
  text: string;
  kind: 'info' | 'warn' | 'crit';
  at: number;                // game time
}

export interface GameState {
  version: 1;
  siteId: SiteId;
  seed: number;
  simTime: number;           // game-seconds since landing
  speed: number;             // 1 | 3 | 10
  paused: boolean;

  resources: Record<ResourceId, number>;
  powerStored: number;       // kWh across all batteries + lander
  /** last economy tick's power book-keeping, for the HUD */
  power: { supply: number; demand: number; capacity: number; brownout: boolean };

  crew: number;
  morale: number;
  data: number;
  /** construction-robot fleet, recomputed each tick (busy = sites being built) */
  bots: { total: number; busy: number };

  era: number;
  techsDone: TechId[];
  researchQueue: TechId[];   // head is in progress
  researchProgress: number;  // data accumulated toward head

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
  /** emergency Earth shipment (anti-softlock); arriveAt is game time */
  resupply: { pending: boolean; arriveAt: number; shipments: number };
  /** ice deposits mapped (Lander survey, ice sites only) */
  iceSurveyed: boolean;
  /** current stockpile capacities, recomputed each tick (for the HUD) */
  storageCaps: Partial<Record<import('../data/resources').ResourceId, number>>;
  alerts: AlertMsg[];
  nextAlertId: number;
  milestonesDone: string[];

  victoryShown: boolean;
  defeatShown: boolean;
}

export function createInitialState(siteId: SiteId, seed: number): GameState {
  return {
    version: 1,
    siteId,
    seed,
    simTime: 90, // land mid-morning: the first thing you see is sunlit regolith
    speed: 1,
    paused: false,
    resources: { ...START.resources },
    powerStored: START.powerStored,
    power: { supply: 0, demand: 0, capacity: START.powerStored, brownout: false },
    crew: START.crew,
    morale: START.morale,
    data: START.data,
    bots: { total: 2, busy: 0 },
    era: 1,
    techsDone: [],
    researchQueue: [],
    researchProgress: 0,
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
    resupply: { pending: false, arriveAt: 0, shipments: 0 },
    iceSurveyed: false,
    storageCaps: {},
    alerts: [],
    nextAlertId: 1,
    milestonesDone: [],
    victoryShown: false,
    defeatShown: false,
  };
}
