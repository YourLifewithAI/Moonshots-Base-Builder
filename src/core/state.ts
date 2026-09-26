/** One plain-JSON world state object. The sim owns it; the UI never mutates it
 *  (typed actions only); the renderer reads it. Everything here serializes. */
import type { ResourceId } from '../data/resources';
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { LANDING_TECH, type TechId } from '../data/techs';
import { SITES, type SiteId } from '../data/sites';
import { emptyFeed, type DepositKind, type FeedGrade, type FeedKind } from '../data/deposits';
import type { OutpostKind, ProspectClass, ProspectId } from '../data/lunarMap';
import { CYCLE_S, START } from '../data/balance';
import { RULES, RULE_ORDER, FAMILY_PRIORITY, type AutoFamily, type AutoRuleId } from '../data/automation';
import type { CounterId, HazardId, HazardSide, Tier } from '../data/hazards';

export interface BuildingState {
  id: number;
  type: BuildingId;
  gx: number;                // footprint origin cell
  gz: number;
  rot: 0 | 1 | 2 | 3;
  enabled: boolean;
  /** run on autonomous agents: no crew or morale dependence, power ×1.6 */
  automated: boolean;
  /** agents took this station over for want of crew (economy step 3.5);
   *  the crew take it back once enough settlers are free */
  agentCover?: boolean;
  /** the player crewed it by hand: agents never cover it */
  crewPinned?: boolean;
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
  idleReason: '' | 'power' | 'crew' | 'inputs' | 'reserve' | 'full' | 'off' | 'building' | 'queued' | 'road'
    /** a hazard holds it offline (core/hazards.ts hazardOff says why); 'strike': a cabin-fever crisis */
    | 'hazard' | 'strike';
  /** Dynamic Clocking: ×1.5 draw, inputs, outputs and data; extra wear */
  overclock?: boolean;
  /** deposit under the footprint centre (stamped on placement, recomputed on
   *  load); for an excavator, the deposit under its dig site */
  deposit?: DepositKind;
  /** hydroponics: seconds of output lost to a dead crop (0 = growing) */
  cropRegrowT?: number;
  /** seconds held dark (idleReason 'power') at night; runs back down while powered */
  darkT?: number;
  /** solar: seconds continuously in terrain shade */
  shadedT?: number;
  /** generators: staffed at last tick's worker allocation */
  staffedPrev?: boolean;
  /** Regolith Excavator: the mobile digger's haul cycle (core/haul.ts) */
  haul?: HaulState;
  /** placed by the Builder (an order or a standing rule; docs/13) */
  auto?: AutoTag;
  /** seconds held at wear ≥ the Maintenance threshold (Maintenance Automation) */
  wornT?: number;
  /** its overclock tripped at WORN (Maintenance Automation re-arms it once healed) */
  ocTripped?: boolean;
  /** Feed Planner leaves this excavator's dig site alone (the player opted out) */
  feedPlanOff?: boolean;
  /** its road from the network to its door, in order (cell keys, core/roads.ts);
   *  the site's rovers sinter what is still closed before they weld */
  spur?: number[];
  // ── hazards (docs/14 §3, core/hazards.ts) ──
  /** pressurized: airlock filter dust 0..1 (clogged at 1) */
  airlockDust?: number;
  /** malware: an infected network node (since infectedAt) */
  infected?: boolean;
  infectedAt?: number;
  /** air-gapped: no links (an agent-run station idles unless crewed) */
  airGapped?: boolean;
  /** evacuated until then (game time; its beds and seats are off) */
  evacT?: number;
  /** rogue drones: stripping since then (0 = not); wear climbs until it is wrecked */
  stripT?: number;
  /** a breach venting through it (the live hazard's id), or a decompressed section awaiting repair */
  breached?: number;
  decompressed?: boolean;
  /** a farm blighted until then */
  blightUntil?: number;
  /** offline while reimaging (malware), until then */
  reimageUntil?: number;
  /** intrusion detection: a new infection isolates itself until then */
  isolatedUntil?: number;
  /** a kill switch holds this dock offline until then */
  killUntil?: number;
  /** cabin fever: on strike until then */
  strikeUntil?: number;
  /** a runaway rule's junk site (the hazard's id): never commissions */
  junk?: number;
  junkAt?: number;
  /** a dock's slots emptied by lost rovers, and the reprint under way */
  slotsLost?: number;
  reprintAt?: number;
}

/** One 4 m road cell (core/roads.ts, docs/15-roads.md). */
export interface RoadCell {
  gx: number;
  gz: number;
  /** rover-seconds of sintering left (0 = open to traffic) */
  left: number;
  /** a parking bay beside a dock or on the Lander's apron */
  bay?: boolean;
  /** no new road joins or crosses it (the Lander's apron short of its stub's end) */
  closed?: boolean;
}

/** A road the player drew, or a haul road to an excavator's dig: open for
 *  free rovers to sinter, oldest first. */
export interface RoadJob {
  id: number;
  kind: 'draw' | 'haul';
  /** the cells in order from the network (cell keys) */
  cells: number[];
  /** a haul road: the excavator it serves */
  by?: number;
}

/** Why and by whom the Builder placed a building (the inspector's AUTO tag). */
export interface AutoTag {
  by: 'order' | 'rule';
  rule?: AutoRuleId;
  order?: number;
  /** game time placed */
  at: number;
  /** why here: 'nearest free pad to Smelter #3 · 18 m' */
  why: string;
  /** the chooser: distance only, or Site Survey AI */
  survey?: boolean;
  /** a planned dig site, applied when the excavator stands (Site Survey AI) */
  dig?: { x: number; z: number };
  /** Maintenance: the worn building this one replaces (demolished when it stands) */
  replaces?: number;
}

/** A standing rule's live state (core/automation.ts). */
export type RulePhase =
  | 'off' | 'locked' | 'ok' | 'watching' | 'building' | 'settling' | 'waiting' | 'holding'
  | 'capped' | 'nosite' | 'vetoed' | 'founded' | 'frozen';
export interface RuleState {
  on: boolean;
  /** in the rule's own unit (data/automation.ts) */
  threshold: number;
  cap: number;
  phase: RulePhase;
  /** seconds past the trigger (decays in the hysteresis band) */
  dwell: number;
  /** the pending site it placed (building id) */
  site: number | null;
  /** cooldown, settle or veto end (game time) */
  nextAt: number;
  /** lifetime placements */
  built: number;
  /** the status tail the panel prints */
  why: string;
  /** seconds the current refusal has held (alerts wait AUTO.refusalAlertS) */
  holdT: number;
  /** battery: dawns-after-a-dry-bank already answered */
  seen?: number;
  /** a freeze (a hazard, or Freeze rules) holds this rule until then */
  frozenUntil?: number;
}
export interface AutoOrder {
  id: number;
  type: BuildingId;
  count: number;
  /** the sites placed so far (building ids) */
  placed: number[];
  intent: { res?: ResourceId; like?: number };
  at: number;
  /** what it waits for ('' = placing) */
  waiting: string;
}
export interface AutoVeto { rule: AutoRuleId | 'order'; gx0: number; gz0: number; gx1: number; gz1: number; until: number }
export interface AutoState {
  schema: 1;
  rules: Partial<Record<AutoRuleId, RuleState>>;
  orders: AutoOrder[];
  nextOrderId: number;
  /** the Budget Governor's floors per resource (unset = the default) */
  reserve: Partial<Record<ResourceId, number>>;
  /** the order families act in (the Governor makes it the player's) */
  priority: AutoFamily[];
  vetoes: AutoVeto[];
  log: { at: number; text: string; id?: number }[];
  /** the day's grid margin, a 20 s EMA of full-sun samples (null = not read yet) */
  margin: number | null;
  /** every rule is frozen until then (Freeze rules, or a hazard) */
  frozenUntil: number;
  /** families whose rules were switched on when they unlocked (never again) */
  families: AutoFamily[];
}

/** made / wanted / spent per game-second, each an EMA (economy step 8.9) —
 *  the supply-against-demand signal the standing rules read. `acc` gathers
 *  lump spending between ticks. */
export interface FlowEntry { made: number; want: number; spend: number; acc: number }

/** One construction rover (core/fleet.ts). Auto rovers go one per active
 *  site in queue order; a pinned rover stays at its site until it completes. */
export interface RoverUnit {
  id: number;
  /** the dock it parks at: the Lander or a Robotics Bay (building id) */
  home: number;
  /** free of sites: the road job it sinters (core/roads.ts) */
  road?: number;
  /** the construction site it is working (or waiting at), null = free */
  site: number | null;
  pinned: boolean;
  /** hazards: bricked until re-flashed, lost at this deadline (0 = fine) */
  brickedUntil?: number;
  brickedBy?: number;
  /** held at its dock until then (Dock fleet, Land drones, a kill switch) */
  heldUntil?: number;
}

/** An excavator's haul cycle: drive to the dig site → dig a bucket → drive to
 *  the nearest regolith consumer → unload (credited then) → back again. The
 *  home pad is where it was placed and stays occupied; the digger moving
 *  about blocks nothing. World metres throughout. */
export interface HaulState {
  /** where it digs (default: the centre of its own pad) */
  digX: number;
  digZ: number;
  phase: 'toDig' | 'dig' | 'toDrop' | 'unload';
  /** where the digger is now, and the waypoints left on this leg */
  x: number;
  z: number;
  path: [number, number][];
  /** seconds dug into this bucket (dig) or spent unloading (unload) */
  t: number;
  /** what the bucket holds, and the ground it came from */
  cargo: Partial<Record<ResourceId, number>>;
  kind: FeedKind;
  /** the consumer it is hauling to (building id), chosen when the bucket fills */
  drop: number | null;
  /** the deposit under its own pad (b.deposit is the ground it digs) */
  pad?: DepositKind;
  /** the whole leg being driven, from where it began (the visuals follow it; absent in old saves) */
  route?: [number, number][];
  /** Dig at…: the haul road job it waits on (it digs its pad until the road opens) */
  roadJob?: number;
  /** no road to where this leg goes (cut, or not open yet): it waits, asking each tick */
  noRoad?: boolean;
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
  /** seconds with two or more outposts operating at once (the Era 7 deed) */
  outpostPairOpS: number;
  minReserveS: number;
  minMorale: number;
  /** the night in progress shed or browned out with the bank empty (reset at dusk) */
  nightBankEmpty: boolean;
  /** dawns after a night whose bank ran dry (the Builder's battery rule answers each) */
  bankDryDawns: number;
  /** the most rovers that ever worked one site at once */
  crowdedSiteMax: number;
  /** the longest haul an excavator has driven, dig site to consumer (m) */
  haulMaxM: number;
}

export interface ProspectRecord { surveyedAt: number; cls: ProspectClass; data: number }
/** rover: the construction rover lent for the trip (never a pinned one) */
export interface ActiveSurvey { id: ProspectId; startedAt: number; endsAt: number; rover?: number }
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
  /** HACKED OUTPOST: the stream is diverted (docs/14 §3.5) */
  hacked?: boolean;
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
  /** hazard counters shown as buttons on the alert (docs/14 §3.8) */
  counters?: AlertCounter[];
}

/** a counter button on an alert: the counter action it pushes */
export interface AlertCounter { counter: CounterId | 'airGap'; id?: number; label: string }

// ─────────────────────────── hazards (docs/14 §3) ───────────────────────────

/** One live hazard: telegraphed until `at`, then active until it resolves. */
export interface LiveHazard {
  id: number;
  kind: HazardId;
  side: HazardSide;
  tier: Tier;
  /** the first of its kind: minor, a longer telegraph, and it cannot kill or destroy */
  drill: boolean;
  phase: 'telegraph' | 'active';
  /** the warning went up then */
  warnedAt: number;
  /** the telegraph's deadline: the hazard opens then */
  at: number;
  /** the building (or dock) it names; null: base-wide */
  target: number | null;
  targetName: string;
  /** hacked outpost: the prospect it names */
  outpost?: ProspectId;
  /** buildings it has reached (a blight's farms, the infected nodes, a cascade's habitats, strip targets) */
  hit: number[];
  /** the second clock: a death or a loss at this game time (0 = none) */
  clockAt: number;
  clockText: string;
  /** counters used, and when */
  used: Partial<Record<CounterId, number>>;
  /** a counter under way finishes then (a seal, a patch) */
  doneAt?: number;
  /** firmware from the flare's bit flips, not a window */
  flare?: boolean;
  /** kind-specific numbers (occupants warned of, the next spread, sites placed …) */
  n: Record<string, number>;
}
export interface HazardLogEntry {
  at: number; id: number; kind: HazardId; tier: Tier; drill: boolean; target: string;
  /** 'near miss', 'answered: Seal', 'ignored: 1 crew lost', … */
  outcome: string;
}
/** a death: its cause, the hazard, and when its warning went up (null: none) */
export interface DeathRecord { at: number; cause: string; hazard: HazardId | null; warnedAt: number | null }
/** a machine loss (docs/14 §3.10): Automation's counterpart to a death */
export interface LossRecord {
  at: number; what: 'rover' | 'drone' | 'building' | 'data' | 'stock' | 'outpost';
  name: string; cause: string; hazard: HazardId; warnedAt: number; amount?: number;
}
export interface GriefRecord { until: number; amount: number }
/** crew with no bed breathing suit air, from `from` */
export interface SuitAir { hazard: number; from: number; n: number; until: number; nextDeath: number }
export interface HazardState {
  schema: 1;
  /** Era 3 opened then (the scheduler starts a lunar day later) */
  era3At: number | null;
  /** a loaded save's grace: nothing before then */
  graceUntil: number;
  /** the next window (0 = not yet scheduled) and how many have come */
  nextAt: number;
  windows: number;
  /** the side round-robin's credit */
  credit: Record<HazardSide, number>;
  /** each side's last window kind (variety) */
  lastKind: Record<HazardSide, HazardId | null>;
  /** the last hazard's warning (the 240 s spacing) */
  lastStartAt: number;
  flarePrev: 'idle' | 'telegraph' | 'active';
  flareEndAt: number;
  live: LiveHazard[];
  nextId: number;
  /** kinds whose drill has run: the next one is real */
  drilled: HazardId[];
  log: HazardLogEntry[];
  /** CABIN FEVER 0–100, crisis times, crew who leave at the next Earth contact */
  isolation: number;
  crises: number[];
  leaving: number;
  crisisUntil: number;
  callHomeAt: number;
  /** CONTAMINATION: lunar days since the last flush */
  loopAge: number;
  /** DOSE: crew-doses in the window (falls 1 a lunar day) */
  doseLoad: number;
  /** crew off work until then (a dose, sick bay) */
  sick: { n: number; until: number }[];
  suit: SuitAir[];
  /** Shed loads: priority 2–3 loads off until then */
  shedUntil: number;
  /** Patch: every node immune until then */
  immuneUntil: number;
  /** Land drones: hive rovers held until then */
  dronesHeldUntil: number;
  /** seconds each crewed habitat has been dark for power (building id → s) */
  darkS: Record<string, number>;
  /** compute (Data Centers, Monoliths) dark for, and running for since a drop */
  computeDarkS: number;
  computeUpS: number;
  /** Earth contact watch: shipments landed, the rotation, the last downlink cargo */
  shipments: number;
  rotation: boolean;
  downlinkAt: number;
  /** sides whose HAZARDS ARE LIVE banner has shown */
  liveSides: HazardSide[];
  /** debug: no hazard starts while set (tests that are not about hazards) */
  hold?: boolean;
}

export interface GameState {
  version: 1;
  siteId: SiteId;
  seed: number;
  /** who runs this base: fragile clever humans, or power-hungry tireless robots */
  expedition: 'human' | 'robotic';
  /** agents run short-handed stations until settlers free up (unset = on) */
  agentCover?: boolean;
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
    /** the same panels under a full sun; supply the night would leave; construction draw (kW) */
    supplyFull?: number; supplyNight?: number; construction?: number;
  };

  crew: number;
  /** beds in enabled, completed, powered housing — what the economy counts */
  housingActive: number;
  morale: number;
  data: number;
  /** smoothed net flow per resource, per game-second (production − consumption
   *  − upkeep − spillage; deliveries and research goods are not flow) */
  rates: Partial<Record<ResourceId, number>>;
  /** construction-rover fleet, derived from `rovers` each tick: total = the
   *  roster less one lent to a survey, busy = rovers at construction sites */
  bots: { total: number; busy: number };
  /** the construction rovers, one per dock slot (core/fleet.ts) */
  rovers: RoverUnit[];
  nextRoverId: number;
  /** the road network (core/roads.ts): cells in laying order, the jobs free
   *  rovers sinter, and a revision bumped whenever a cell opens, is laid or
   *  goes (routes are cached on it). roadSchema 1: roads exist (older saves
   *  get them on load) */
  roads?: RoadCell[];
  roadJobs?: RoadJob[];
  roadRev?: number;
  roadSchema?: number;
  nextRoadJob?: number;

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
   *  orders (the automatic anti-softlock rescue is not counted); downlink =
   *  the one slot carries a data downlink's cargo, not a resupply */
  resupply: { pending: boolean; arriveAt: number; shipments: number; ordered?: number; downlink?: boolean;
    /** the slot flies a lethally dosed crew member home (docs/14 §3.4): no cargo */
    medevac?: boolean };
  /** ice deposits mapped (Lander survey, ice sites only) */
  iceSurveyed: boolean;
  /** current stockpile capacities, recomputed each tick (for the HUD) */
  storageCaps: Partial<Record<import('../data/resources').ResourceId, number>>;
  alerts: AlertMsg[];
  nextAlertId: number;
  /** dismissed conditions: key → game time the snooze ends */
  alertSnooze: Record<string, number>;
  milestonesDone: string[];
  /** the Builder: orders, standing rules, reserves (docs/13) */
  auto: AutoState;
  /** supply against demand, per resource (docs/13 §3.1) */
  flowBook: Partial<Record<ResourceId, FlowEntry>>;
  // ── destiny tracks (docs/14) ──
  /** techs a destiny pick brought forward (robotic Human Cohabitation):
   *  done, but never counted toward a charter */
  forwarded: TechId[];
  /** a pure-Automation FIRST LIGHT sent the last crew home: crew 0 is no defeat */
  crewHome: boolean;
  /** Crewed Mission Control: the launch-day morale lasts until then (game time) */
  launchDayUntil: number;
  /** EVA crews out this tick (economy step 3; the walkers read it later) */
  evaCrew: number;
  // ── hazards (docs/14 §3, core/hazards.ts) ──
  hazards: HazardState;
  /** every death, with its cause and missed warning */
  deaths: DeathRecord[];
  /** every machine loss, the same way */
  losses: LossRecord[];
  /** each death's grief: −10 on the morale target until then */
  grief: GriefRecord[];

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
      parts: Math.round(START.resources.parts * SITES[siteId].buildCostMult),
    },
    powerStored: START.powerStored,
    power: { supply: 0, demand: 0, served: 0, capacity: START.powerStored, brownout: false, shed: false },
    crew: expedition === 'robotic' ? 0 : START.crew,
    housingActive: BUILDINGS.lander.housing ?? 0, // every base lands with its Lander
    morale: START.morale,
    data: START.data,
    rates: {},
    bots: { total: 2, busy: 0 },
    rovers: [],
    nextRoverId: 1,
    era: 1,
    // the landing is the Era 1 destiny pick (docs/14 §2.5)
    techsDone: [LANDING_TECH[expedition]],
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
    auto: defaultAuto(),
    flowBook: {},
    ...destinyDefaults(),
    ...hazardDefaults(0),
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
    ilmeniteDigS: 0, dcOpS: 0, outpostOpS: 0, outpostPairOpS: 0,
    minReserveS: 1e9,   // "never measured": no crew aboard yet
    minMorale: 100,
    crowdedSiteMax: 0, haulMaxM: 0,
    nightBankEmpty: false, bankDryDawns: 0,
  };
}

function destinyDefaults() {
  return { forwarded: [] as TechId[], crewHome: false, launchDayUntil: 0, evaCrew: 0 };
}

/** A new run's (or a migrated save's) hazards: nothing fires before
 *  `graceUntil`, nor before Era 3 opens plus a lunar day (docs/14 §3.2, §7). */
export function defaultHazards(graceUntil: number): HazardState {
  return {
    schema: 1, era3At: null, graceUntil, nextAt: 0, windows: 0,
    credit: { colony: 0, automation: 0 }, lastKind: { colony: null, automation: null },
    lastStartAt: -1e9, flarePrev: 'idle', flareEndAt: -1e9,
    live: [], nextId: 1, drilled: [], log: [],
    isolation: 0, crises: [], leaving: 0, crisisUntil: 0, callHomeAt: -1e9,
    loopAge: 0, doseLoad: 0, sick: [], suit: [],
    shedUntil: 0, immuneUntil: 0, dronesHeldUntil: 0, darkS: {}, computeDarkS: 0, computeUpS: 0,
    shipments: 0, rotation: false, downlinkAt: -1e9, liveSides: [],
  };
}

function hazardDefaults(graceUntil: number) {
  return {
    hazards: defaultHazards(graceUntil),
    deaths: [] as DeathRecord[], losses: [] as LossRecord[], grief: [] as GriefRecord[],
  };
}

function researchDefaults() {
  return {
    techSchema: 4,
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
  // saves from before fleet control: the roster is rebuilt from the docks
  // (core/fleet.ts syncRoster) and each excavator digs its own pad (core/haul.ts)
  legacy.rovers ??= [];
  legacy.nextRoverId ??= 1 + legacy.rovers.reduce((m, r) => Math.max(m, r.id), 0);
  // saves from before the Builder: every rule off (a loaded save never switches
  // one on), rules added later join with their defaults
  legacy.auto = fillAuto(legacy.auto);
  legacy.flowBook ??= {};
  // saves from before the destiny tracks (docs/14 §7): nothing forwarded, nobody sent home
  const dd = destinyDefaults();
  legacy.forwarded ??= dd.forwarded;
  legacy.crewHome ??= dd.crewHome;
  legacy.launchDayUntil ??= dd.launchDayUntil;
  legacy.evaCrew ??= dd.evaCrew;
  // saves from before the hazards (docs/14 §7): a lunar day's grace, every
  // kind still owed its drill; old fields filled, never overwritten
  const hz = defaultHazards(legacy.simTime + CYCLE_S);
  legacy.hazards = legacy.hazards ? { ...hz, ...legacy.hazards } : hz;
  legacy.deaths ??= [];
  legacy.losses ??= [];
  legacy.grief ??= [];
  for (const b of legacy.buildings ?? []) {
    b.airlockDust ??= 0;
    b.infected ??= false;
    b.airGapped ??= false;
    b.evacT ??= 0;
    b.stripT ??= 0;
  }
  // rovers: an absent brickedUntil reads as 0 everywhere, and a save's roster stays as it was written
  return s;
}

/** A rule's state before it has ever run. */
export function defaultRule(id: AutoRuleId): RuleState {
  const d = RULES[id];
  return {
    on: false, threshold: d.threshold, cap: d.cap, phase: 'off', dwell: 0, site: null, nextAt: 0, built: 0,
    why: '', holdT: 0,
  };
}

export function defaultAuto(): AutoState {
  return {
    schema: 1,
    rules: Object.fromEntries(RULE_ORDER.map((r) => [r, defaultRule(r)])),
    orders: [], nextOrderId: 1, reserve: {}, priority: [...FAMILY_PRIORITY], vetoes: [], log: [],
    margin: null, frozenUntil: 0, families: [],
  };
}

/** Fill an old or partial AutoState (never switches a rule on). */
export function fillAuto(a: Partial<AutoState> | undefined): AutoState {
  const d = defaultAuto();
  if (!a) return d;
  const rules = { ...d.rules };
  for (const id of RULE_ORDER) {
    const r = a.rules?.[id];
    if (r) rules[id] = { ...defaultRule(id), ...r };
  }
  const priority = (a.priority ?? []).filter((f) => FAMILY_PRIORITY.includes(f));
  for (const f of FAMILY_PRIORITY) if (!priority.includes(f)) priority.push(f);
  return {
    schema: 1, rules, orders: a.orders ?? [], nextOrderId: a.nextOrderId ?? 1, reserve: a.reserve ?? {},
    priority, vetoes: a.vetoes ?? [], log: a.log ?? [], margin: a.margin ?? null, frozenUntil: a.frozenUntil ?? 0,
    families: a.families ?? [],
  };
}
