/** One plain-JSON world state object. The sim owns it; the UI never mutates it
 *  (typed actions only); the renderer reads it. Everything here serializes. */
import { DEP_SURVEY } from '../data/ore';
import type { ResourceId } from '../data/resources';
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { LANDING_TECH, type TechId } from '../data/techs';
import { SITES, type SiteId } from '../data/sites';
import { emptyFeed, type DepositKind, type FeedGrade, type FeedKind } from '../data/deposits';
import type { OutpostKind, ProspectClass, ProspectId } from '../data/lunarMap';
import { CYCLE_S, START } from '../data/balance';
import { RULES, RULE_ORDER, FAMILY_PRIORITY, type AutoFamily, type AutoRuleId } from '../data/automation';
import type { CounterId, HazardId, HazardSide, Tier } from '../data/hazards';
import type { ArrayChoice, FlareClass, FlareCounterId, FlareDecider } from '../data/spaceWeather';

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
    /** construction: its rover is on its way (core/transit.ts), or no road reaches it */
    | 'enroute' | 'noroad'
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
  /** its grid draw is held dark, but it works on its units' packs (a
   *  construction site's rovers, an excavator; core/unitPower.ts) */
  onPack?: boolean;
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
  // ── space weather (docs/16 §4.3, §5; core/spaceWeather.ts) — Solar Arrays ──
  /** how far its wing has turned from sun-tracking to edge-on (0 running … 1 stowed; 10 s each way) */
  stowT?: number;
  /** this flare's plan wants it stowed */
  stow?: boolean;
  /** capability 0.1..1 (1 absent): rad scars from flares, for good (an array: those it ran through;
   *  any structure with an output, rate or capacity: those it met unprepared, docs/16 §4.13) */
  cap?: number;
  /** repairable damage 0..0.9 from flares it was stowed through: output × (1 − it) until a rover repairs it */
  flareDmg?: number;
  /** destroyed while running: no output, no upkeep, its pad held until Rebuild or Clear
   *  (a job under way rides the rover queue as a construction site) */
  wreck?: { at: number; n: number; cls: FlareClass; job?: 'rebuild' | 'clear'; cleared?: boolean };
  /** its field's override of the flare choice (docs/16 §5.4; absent: follow the choice) */
  fieldOverride?: 'stow' | 'run';
  /** a repair under way (a construction site of pct·0.2 + 6 s behind every build): its damage and parts */
  fix?: { pct: number; parts: number; paid?: boolean };
  // ── space weather: scars and machines (docs/16 §4.5, §4.13, §4.14; core/flareEffects.ts) ──
  /** flares that have scarred it (its capability is `cap`) */
  scars?: number;
  /** the capability alert has fired (once, crossing 85%) */
  capWarned?: boolean;
  /** a Replace under way: a construction site of 60% its build time (an excavator's Re-print) */
  replace?: { at: number };
  /** shut down for a flare (Shut down exposed; an excavator parked by Recall machines): on again at `warm` (0: the flare is on) */
  flareShut?: { warm: number };
  /** an excavator's digger: rebooting until then; latched up until re-flashed (lost at `until`); burned out */
  rebootUntil?: number;
  latch?: { until: number; real: boolean; n: number };
  burned?: { at: number; n: number; cls: FlareClass };
  /** what the last flare did to it, for the inspector ('rebooted 0:40', 'latched up', …) */
  lastFlare?: string;
  // ── extraction hubs (docs/17, core/hubs.ts) ──
  /** a hub's own state: its hopper, feed, queue and choices (smelters, refineries, water plants) */
  hub?: HubState;
  /** an old save's excavator or ice harvester with no hub to join yet (docs/17 §19):
   *  it works as it did, and joins the first hub that completes */
  legacy?: boolean;
}

/** A hub's job (docs/17 §4.2): a unit or a bay, paid when it reaches the
 *  head of the queue, printed at the hub (no rover), refunded if cancelled. */
export interface HubJob {
  /** a new unit, a bay, or a scarred unit's Re-print (docs/16 §4.14: half its price, 60% of its time) */
  kind: 'unit' | 'bay' | 'reprint';
  /** a Re-print's unit (it keeps its bay; new when the job finishes) */
  unit?: number;
  /** what it cost once paid (null: not yet at the head, or waiting on stock) */
  paid: Partial<Record<ResourceId, number>> | null;
  /** game-s printed, of the print's length */
  t: number;
  total: number;
  /** who asked for it (the Builder's rule, an order, or the player) */
  by?: 'player' | 'rule' | 'order';
}

/** A hub's state (docs/17 §4.6), on its building. */
export interface HubState {
  /** Level I: 2 bays; II and III are bought per hub once research allows them */
  level: 1 | 2 | 3;
  /** regolith (▲) waiting at the furnace: its own units fill it */
  hopper: number;
  /** its feed factor, an EMA of the loads delivered (the grade q of Phase 4 stands in) */
  q: number;
  /** the kind shares of its loads, an EMA by amount (its own feed grade) */
  feed: FeedGrade;
  queue: HubJob[];
  /** Assign: the dig target its auto units prefer ('dep:<id>' or 'plain:<id>') */
  prefer?: string;
  /** its staked plain pit (s.plainPits id) */
  plainPit?: number;
  /** share of recent ticks it stood idle for want of regolith, an EMA over HUB.starvedS */
  starved: number;
  /** its first unit has rolled out (a hub commissions with one) */
  seeded?: boolean;
  /** why the head of its queue waits ('' none): 'needs 16◆ (have 9)' */
  waiting?: string;
  /** regolith drawn last tick (the base's feed mean weighs hubs by it) */
  drew?: number;
  /** haul roads asked for, by target key: the road job (0: none needed), when, and a refusal */
  roads?: Record<string, { job: number; at: number; why?: string }>;
}

/** A plain pit (docs/17 §8.6): a staked point on open ground a hub's units
 *  dig at plain grade (no carving until pits deform the ground). Its zone
 *  (kind 'plain') lets units drive off-road there. */
export interface PlainPit {
  id: number;
  x: number;
  z: number;
  /** the hub it was staked for (null: none now) */
  hub: number | null;
}

/** A hub's robot (docs/17 §4.6): printed, docked, charged and dispatched by
 *  its hub. It digs where its hub's choice (or the player) sends it and tips
 *  into its own hub's hopper. Its pack rides on its haul (core/unitPower.ts). */
export interface Hauler {
  id: number;
  type: 'excavator' | 'iceMiner';
  /** its hub's building id (unitPower's homeOf) */
  hub: number;
  /** its bay at the hub (unitPower's chargeSpotOf) */
  bay: number;
  /** where it digs: 'dep:<depositId>' or 'plain:<plainPitId>' (null: none — parked) */
  target: string | null;
  /** the face it holds there (-1: none) */
  face: number;
  /** Send…: pinned to its target until you press Auto */
  pinned?: boolean;
  /** why it stands in its bay: new, recalled, no pit in reach, charging, its hub shut down */
  parked?: 'new' | 'recalled' | 'noPit' | 'charge' | 'off';
  /** today's cycle with new ends: drop is its hub */
  haul: HaulState;
  wear: number;
  /** printed by the Builder */
  auto?: { by: 'rule' | 'order'; at: number };
  // ── space weather (docs/16 §4.5, §4.13, §4.14; core/flareEffects.ts) ──
  /** capability 0.1..1 (absent: 1): rad scars from flares met out of its bay; its bucket × it */
  cap?: number;
  scars?: number;
  capWarned?: boolean;
  /** a flare reboot: it stops where it stands until then */
  rebootUntil?: number;
  /** a flare latch-up: home in safe mode, re-flashed in its bay; lost at `until` (a drill's re-flashed from Earth) */
  latch?: { until: number; real: boolean; n: number };
  /** what the last flare did to it, for the inspector */
  lastFlare?: string;
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

/** A unit's on-board pack (core/unitPower.ts, docs/02 · On-board power): on a rover,
 *  a drone, or an excavator's haul. The grid pays first; in a brownout the
 *  pack does, and an empty one stops the unit until the grid serves it. */
export interface PackState {
  /** kWh aboard (absent: full — a new unit, or a save from before packs) */
  charge?: number;
  /** the share of the next tick it can act: 1 on the grid or a pack with
   *  charge, 0 flat, between on Radioisotope Power Units alone (absent: 1) */
  pw?: number;
  /** how it ran last tick: on the grid, on its pack, on its RPU trickle,
   *  or flat (out of charge, waiting for the grid); absent: idle, drawing nothing */
  src?: 'grid' | 'pack' | 'rpu' | 'flat';
  /** charging last tick (plugged in at its dock, pad or a site's feed) */
  chg?: boolean;
  /** game-seconds it has waited flat (the stall alert) */
  flatT?: number;
}

/** One construction rover (core/fleet.ts). Auto rovers go one per active
 *  site in queue order; a pinned rover stays at its site until it completes. */
export interface RoverUnit extends PackState {
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
  /** where the sim has it (core/transit.ts, docs/15 §6), world metres:
   *  absent until it first settles (a new rover, a migrated save) */
  x?: number;
  z?: number;
  /** the trip it is on, or last made (arrived: t ≥ dur) */
  trip?: RoverTrip | null;
  /** what it did this tick, at the spot it stands on (the visuals animate it) */
  task?: 'weld' | 'sinter';
  /** a save from before transit: it settles where its work is, arrived */
  place?: boolean;
  /** a deposit survey it cores (docs/17 §13.2): the deposit's id */
  core?: string;
  // ── space weather (docs/16 §4.5, §4.13, §4.14; core/flareEffects.ts) ──
  /** capability 0.1..1 (absent: 1): rad scars from flares met in the open; weld and sinter × it */
  cap?: number;
  /** flares that have scarred it, and whether the capability alert has fired */
  scars?: number;
  capWarned?: boolean;
  /** a flare reboot: it stops where it stands until then (no work, no driving) */
  rebootUntil?: number;
  /** its brick is a flare latch-up (brickedUntil is its deadline): real ones are lost there, a drill's re-flashed from Earth */
  latch?: { real: boolean; n: number };
  /** a Re-print at its dock under way: new (capability 100%) then */
  reprintUntil?: number;
  /** what the last flare did to it, for the inspector */
  lastFlare?: string;
}

/** A rover's trip (core/transit.ts): planned once when its goal changes,
 *  then advanced by the clock. Ground rovers keep to the road route; drones
 *  fly straight. */
export interface RoverTrip {
  /** the goal: its kind, target and cell; a new goal is a new trip */
  goal: string;
  /** weld: a site's stand · front: the cell behind a road's frontier (it
   *  sinters) · behind: queued behind a frontier · dock: parking ·
   *  survey: into the Lander, lent · down: set down by a hazard (a drone) ·
   *  core: at a deposit's centre, coring it (docs/17 §13.2) */
  kind: 'weld' | 'front' | 'behind' | 'dock' | 'survey' | 'down' | 'core';
  site?: number;
  job?: number;
  /** the goal's road cell (cellKey), or -1 (a drone's, straight) */
  cell: number;
  /** the way, world metres: where it set off, then road cell centres, then its slot */
  pts: [number, number][];
  /** off-road inside a zone (core/zones.ts): each segment's time per metre
   *  against road (1 on road, 1 / ROAD.offroad off it); absent: all road */
  w?: number[];
  /** m of way (time-equivalent: an off-road metre counts 1 / ROAD.offroad), cruise m/s, acceleration m/s² */
  len: number;
  v: number;
  a: number;
  /** s since it set off, and s it takes rest to rest */
  t: number;
  dur: number;
  /** a step from one stand to the next at the same work (the frontier's next cell) */
  local?: boolean;
  /** no road there: it waits where it is and asks again each tick */
  stuck?: boolean;
  /** the share of the clock it drives on now (core/unitPower.ts): 0 flat,
   *  between on an RPU's trickle; absent: 1 (the visuals read it too) */
  rate?: number;
}

/** An extraction zone (core/zones.ts): a revealed deposit's circle, world
 *  metres; or a pit's (kind 'pit', core/pits.ts): its cut and a cell round
 *  it, as explicit cells (cell keys; the circle only bounds them). */
export interface ZoneState {
  id: string;
  /** a deposit's kind; 'plain': a staked plain pit (docs/17 §8.6); 'pit': a carved pit's (core/pits.ts) */
  kind: DepositKind | 'plain' | 'pit';
  cx: number; cz: number; r: number;
  cells?: number[];
}

/** A strip-mine pit (core/pits.ts, docs/17 §4.6, §8): its growth parameters.
 *  The shape it has been carved to lives in the height-delta grid (the
 *  heightfield's `delta`, saved as `terrain.delta`); its loose layer is
 *  derived from (seed, id) and its ground, never stored. */
export interface PitState {
  id: number;
  /** today's adapter (Phase 3): what it serves — a deposit (`dep:<id>`, every digger on it) or a
   *  plain-ground dig cell (`dig:gx,gz`) (core/pits.ts onDig) */
  key: string;
  /** the deposit under its dig (null: plain ground) */
  deposit: string | null;
  /** 'new': dug but not yet staked (no free ground found yet) · 'boxed': it cannot widen now */
  state: 'new' | 'open' | 'boxed' | 'exhausted' | 'reclaiming' | 'reclaimed';
  /** its centre now (drifts away from what blocks it), and where it opened, world m */
  cx: number; cz: number; ox: number; oz: number;
  /** the ramp's direction (unit, toward its diggers) and its top, m along from (ox, oz) */
  ux: number; uz: number; A: number;
  /** rim radius of the last carve, m (grows only) */
  R: number;
  /** ▲ dug into it; m³ dug (▲ ÷ PIT.tPerM3); m³ actually cut into the grid; m³ of spoil on its heap */
  tonnes: number; dugM3: number; cutM3: number; heapM3: number;
  /** the grade of what it cut, an amount-weighted EMA (today's feed factor stands in for q) */
  q: number;
  /** its deepest sample, m */
  deep: number;
  /** a sample of its cut and of its heap (grid index; −1 none yet) */
  anchor: number;
  heap: { x: number; z: number; Rh: number; anchor: number } | null;
  /** sample bounds of its cut and heap so far [ix0, iz0, ix1, iz1] */
  box: [number, number, number, number];
  /** the terrain clock of its last carve attempt */
  at: number;
  // ── Phase 4 (docs/17 §8.2, §10, §12; core/pits.ts, core/ore.ts) ──
  /** ▲ of its deposit's ore dug (while its cut was above the cutoff, and on bedrock benches) */
  ore?: number;
  /** the share of its rim free to widen at the last carve (absent: all of it); faces read it */
  free?: number;
  /** m below the loose layer its floor has been cut to (bedrock benches: Deep Coring) */
  rock?: number;
  /** bedrock mode: the floor it deepens to now (m below the loose layer), its rim held at rockR */
  rockTo?: number; rockR?: number;
  /** the state it returns to when its bedrock benches are cut, and its ore tally when they opened */
  rockFrom?: 'exhausted' | 'boxed'; oreRock?: number;
  /** ▲/s dug into it, an EMA (life, the running-out warning), and the tonnes it last saw */
  rate?: number; seenT?: number;
  /** DEPOSIT RUNNING OUT was said */
  warned?: boolean;
  /** sim time it was exhausted or boxed in (the card) */
  endedAt?: number;
  /** m² of cut and spoil, at its last carve (strip-mine morale) */
  scar?: number;
  /** Reclaim (§12.2): the hub whose units push, m³ pushed back, m³ written into the ground */
  reclaimHub?: number; fill?: number; filled?: number;
  /** its deposit's ore is dug out (EXHAUSTED), whatever it does now */
  spent?: boolean;
  /** what happened to it since the hubs last looked (core/hubs.ts pitNews: units re-route, the alerts) */
  news?: ('exhausted' | 'boxed' | 'rock' | 'rockDone' | 'running' | 'reclaimed')[];
}

/** A deposit survey (docs/17 §13): a rover's job, then what it read. */
export interface OreSurveyState {
  /** surveyed deposits: when, and the precision they read to (±share) */
  done: Record<string, { at: number; precision: number }>;
  /** queued and running: the deposit, the rover on it, the rover-seconds cored */
  jobs: { id: string; rover?: number; t: number }[];
}

/** An excavator's haul cycle: drive to the dig site → dig a bucket → drive to
 *  the nearest regolith consumer → unload (credited then) → back again. The
 *  home pad is where it was placed and stays occupied; the digger moving
 *  about blocks nothing. World metres throughout. Its pack (PackState)
 *  rides on the haul, not the pad: the digger carries it (core/unitPower.ts). */
export interface HaulState extends PackState {
  /** where it digs (default: the centre of its own pad) */
  digX: number;
  digZ: number;
  /** a hub unit also drives home to its bay (toBay) and stands there (park) */
  phase: 'toDig' | 'dig' | 'toDrop' | 'unload' | 'toBay' | 'park';
  /** where the digger is now, and the waypoints left on this leg */
  x: number;
  z: number;
  path: [number, number][];
  /** seconds dug into this bucket (dig) or spent unloading (unload) */
  t: number;
  /** what the bucket holds, and the ground it came from */
  cargo: Partial<Record<ResourceId, number>>;
  kind: FeedKind;
  /** the grade its bucket carries (docs/17 §9.1: q, amount-weighted as it filled) */
  q?: number;
  /** the consumer it is hauling to (building id), chosen when the bucket fills */
  drop: number | null;
  /** the deposit under its own pad (b.deposit is the ground it digs) */
  pad?: DepositKind;
  /** the whole leg being driven, from where it began (the visuals follow it; absent in old saves) */
  route?: [number, number][];
  /** off-road inside a zone: each waypoint's segment's time per metre against road (1 road, 2 off-road
   *  at ROAD.offroad 0.5), matching path; absent: all road */
  w?: number[];
  /** Dig at…: the haul road job it waits on (it digs its pad until the road opens) */
  roadJob?: number;
  /** no road to where this leg goes (cut, or not open yet): it waits, asking each tick */
  noRoad?: boolean;
  /** a full bucket and no room in the store: it waits at its dig spot (its pad, or its haul
   *  road's end), off the carriageway, until there is (docs/15 §5) */
  full?: boolean;
  /** a hub unit sent to a pit with every face working: it waits at the gate */
  wait?: 'gate';
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

/** A flare's phases (docs/16 §3.3): the flash (the telegraph), the protons
 *  (active), after an X a proton-storm tail, then quiet. */
export type FlarePhase = 'idle' | 'telegraph' | 'active' | 'tail';

/** One flare, as the log and the panel read it (docs/16 §10.2). */
export interface FlareLogEntry {
  n: number; cls: FlareClass; drill: boolean;
  /** its telegraph started then (game time), in this era */
  at: number; era: number;
  /** who decided its arrays, and what */
  decidedBy: FlareDecider; choice: string;
  stowed: number; running: number; destroyed: number;
  /** the running arrays scarred, and by how much (the mean, a share) */
  scarred: number; scar: number;
  /** stowed arrays damaged (repairable), their repair parts and rover-seconds */
  damaged: number; repairParts: number; repairS: number;
  /** solar the stow cost (kW·s), heliophysics data gained */
  solarLost: number; data: number;
  /** it came with the sun down: the arrays self-stowed for the night */
  night?: boolean;
  // ── F2b (docs/16 §4): machines, scars, crew, research, fabs, comms ──
  /** machines rebooted, latched up (bricked) and lost (burned out, or a missed re-flash) */
  rebooted?: number; latched?: number; lost?: number;
  /** structures and machines scarred, and the mean scar (a share) */
  scarredB?: number; scarB?: number; scarredM?: number; scarM?: number;
  /** crew sick indoors, research lost (≡, and the tech), chips scrapped, blackout seconds */
  sick?: number; researchLost?: number; researchTech?: string; chipsLost?: number; blackoutS?: number;
  /** the counters pressed: Recall machines, Checkpoint research, Shut down exposed (how many) */
  recalled?: boolean; checkpoint?: boolean; shut?: number;
}

export interface FlareState {
  phase: FlarePhase;
  timer: number;             // game-seconds remaining in phase
  nextAt: number;            // game-time (s) of next telegraph start
  // ── docs/16 (flareSchema 1) ──
  /** this flare's index (telegraph to tail), or the next one's (idle) */
  n?: number;
  /** drawn when its telegraph starts (a spot-group watch locks an X half a day ahead) */
  cls?: FlareClass;
  drill?: boolean;
  /** the class range shown until the X-ray peak (the true class and a neighbour) */
  range?: [FlareClass, FlareClass];
  /** when the telegraph started, the class firms, and the protons arrive (game time) */
  startedAt?: number;
  /** the flash itself (game time): the schedule's time, whatever a forecast's lead started the telegraph at (docs/16 §6.1) */
  flashAt?: number;
  firmAt?: number;
  activeAt?: number;
  /** the activity at its telegraph (the interval to the next reads it) */
  a?: number;
  /** the first of each class has been met (its card); xReal: the drill X has passed */
  seen?: { C: boolean; M: boolean; X: boolean; xReal: boolean };
  /** X flares so far, and the game time of the last one */
  xCount?: number;
  lastX?: number;
  /** no X before then (a loaded save's grace, migration step 4) */
  noXUntil?: number;
  /** the spot-group watch: flare watchN was looked at half a day ahead (its class then); an X is locked and watched */
  watchN?: number;
  watch?: boolean;
  nextCls?: FlareClass;
  /** the CME's front arrives then; the sail window closes then */
  cme?: { at: number; until: number };
  blackoutUntil?: number;
  /** this flare's arrays: the choice and who made it (a click, the remembered one, the Builder, the safe default) */
  choice?: ArrayChoice;
  decidedBy?: FlareDecider;
  /** the plan in force (locked 10 s before the protons): the arrays stowed, run, and kept for the critical feed */
  plan?: { stow: number[]; run: number[]; keep: number[]; criticalKW: number; locked: boolean };
  /** the pop-up paused the game then (the menu's Pause on flare warnings) */
  pausedAt?: number;
  /** each array's exposure this phase (id → seconds running, seconds stowed) */
  exposure?: Record<string, [number, number]>;
  /** what this flare has done so far (the log line it will write) */
  tally?: FlareLogEntry;
  log?: FlareLogEntry[];
  // ── F2b (core/flareEffects.ts) ──
  /** this flare's counters: machines recalled, research checkpointed, the buildings it shut down */
  recalled?: boolean;
  checkpoint?: boolean;
  shut?: number[];
  /** the machines have drawn this phase (the flash's a second after the protons, after the bit flips; the tail's at its start) */
  drawn?: boolean;
  /** hub units sent home for this flare (the hubs' own recall on M and X, or Recall machines): back to work after it */
  unitsHome?: number[];
  hubsRecalled?: boolean;
  /** each structure's and machine's seconds this phase: exposed, prepared ('b12', 'r3') */
  scarEx?: Record<string, [number, number]>;
}

/** Space weather beyond the flare in flight (docs/16 §14.2): the player's
 *  standing choices and the repairs queued. */
export interface WeatherState {
  /** 'Use this choice for future M flares': the arrays' choice per class */
  remember: Partial<Record<FlareClass, ArrayChoice>>;
  /** the pop-up's 'Repair stowed arrays after the flare' (on) */
  autoRepair: boolean;
  /** the player has answered a flare of this class in the pop-up (a C opens small once one has been) */
  answered: Partial<Record<FlareClass, boolean>>;
  /** the probe's baseline: today's flare (docs/16 §12.3) */
  legacy?: boolean;
  /** repair jobs, one per field: the damaged arrays in turn (the head is worked) */
  repairs: number[][];
  /** the observatory's last look at the Sun (F3) */
  seenSunAt: number;
  /** outpost streams held by a comms blackout, delivered when the link returns (docs/16 §4.8) */
  held?: Partial<Record<ResourceId | 'data', number>>;
  /** structures replaced and machines re-printed for their scars (the probe's count) */
  replaced?: number;
  // ── forecasting (docs/16 §6, core/forecast.ts; F3) ──
  /** the base's forecast tier and the telegraph lead it gives, as of the last tick */
  tier?: 0 | 1 | 2 | 3;
  lead?: number;
  /** the next flare's forecast: its flash's window (game time), the class range, the update index;
   *  `blind`: the observatory lost the Sun, the window holds from seenSunAt */
  window?: { n: number; lo: number; hi: number; range: [FlareClass, FlareClass]; k: number; at: number; era: number; tier: number };
  /** the L1 Sentinel: launched then, on station then (by the hopper or the Mass Driver) */
  sentinel?: { launchedAt: number; onlineAt: number; by: 'hopper' | 'driver'; online?: boolean };
  /** 'Arrays: choose now…': the arrays' choice for flare n, made ahead from a forecast; it waits for the telegraph */
  ahead?: { n: number; choice: ArrayChoice; repair: boolean };
}

/** what clicking an alert does: open a resource info panel, or select a building */
/** what clicking an alert opens: a resource panel, a building, or a deposit's card */
export type AlertAction = { panel: string } | { select: number } | { deposit: string };

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
export interface AlertCounter { counter: CounterId | 'airGap' | FlareCounterId; id?: number; label: string }

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
  name: string; cause: string; hazard: HazardId | 'flare'; warnedAt: number; amount?: number;
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
  flarePrev: FlarePhase;
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
    /** the fleet's own draw asked of the grid (kW): driving, road work and
     *  charging packs; of it, charging; units flat, waiting for the grid
     *  (core/unitPower.ts) */
    fleet?: number; charging?: number; flat?: number;
    /** priority 0–1 structures' demand, and this tick's solar (kW): the flare's critical feed (docs/16 §5.3) */
    crit?: number; solar?: number;
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
  /** 1: rovers travel in the sim (core/transit.ts); older saves settle each
   *  rover at its work on load. 2: units carry packs (core/unitPower.ts);
   *  older saves start every unit fully charged */
  fleetSchema?: number;
  /** the extraction zones the player sees (core/zones.ts): the revealed
   *  deposits but the peaks of light, kept by the game from the heightfield.
   *  Auto roads stop at their rim; units drive off-road inside */
  zones?: ZoneState[];
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
  /** extraction hubs (docs/17, core/hubs.ts): every hub's units, in id order */
  haulers: Hauler[];
  nextHaulerId: number;
  /** staked plain pits (docs/17 §8.6) */
  plainPits: PlainPit[];
  nextPlainPitId: number;
  /** loose regolith outside the hoppers (an old save's stock, grants, legacy pads'
   *  loads): smelters and refineries draw it first. resources.regolith = pile + Σ hoppers */
  pile: number;
  /** 1: hubs own their units (an older save migrates on load, docs/17 §19) */
  hubSchema?: number;
  /** ▲ dug at each target ('dep:<id>', 'plain:<id>'): the reserves of Phase 4 read it */
  dug?: Record<string, number>;
  /** strip-mine pits (core/pits.ts, docs/17 §8), in id order */
  pits: PitState[];
  nextPitId: number;
  /** the deformed ground (docs/17 §11): `rev` counts carves (terrain caches key on it),
   *  `clock` the pits' own tick clock, `delta` the height-delta grid as saved
   *  (terrain/pitCarve.ts encodeDelta; written when the game saves). terrainSchema 1:
   *  pits exist (an older save gets none: nothing is carved on load) */
  terrain: { rev: number; clock: number; delta: string };
  terrainSchema: number;
  /** deposit surveys (docs/17 §13, core/pits.ts): read deposits and the rover jobs */
  oreSurvey: OreSurveyState;

  swarmPct: number;
  launches: number;

  nightsSurvived: number;
  wasNight: boolean;
  starveT: number;           // seconds spent at zero O2/food
  growthT: number;           // crew growth accumulator

  flare: FlareState;
  /** space weather (docs/16): remembered choices, repairs; flareSchema 1: classed flares on a cycle */
  weather?: WeatherState;
  flareSchema?: number;
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
    fleetSchema: 2,
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
    haulers: [],
    nextHaulerId: 1,
    plainPits: [],
    nextPlainPitId: 1,
    pile: 0,
    hubSchema: 1,
    pits: [],
    nextPitId: 1,
    terrain: { rev: 0, clock: 0, delta: '' },
    terrainSchema: 1,
    oreSurvey: { done: {}, jobs: [] },
    swarmPct: 0,
    launches: 0,
    nightsSurvived: 0,
    wasNight: false,
    starveT: 0,
    growthT: 0,
    flare: defaultFlare(),
    weather: defaultWeather(),
    flareSchema: 1,
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

/** A new run's flare state (docs/16): the first flare, index 0, is the C drill. */
export function defaultFlare(): FlareState {
  return {
    phase: 'idle', timer: 0, nextAt: 0, n: 0, seen: { C: false, M: false, X: false, xReal: false },
    xCount: 0, lastX: -1e9, noXUntil: 0, blackoutUntil: 0, log: [],
  };
}

export function defaultWeather(): WeatherState {
  return { remember: {}, autoRepair: true, answered: {}, repairs: [], seenSunAt: 0 };
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
  // saves from before rovers travelled (docs/15 §6): each settles at its
  // work, arrived, on the first tick — nothing stalls on load
  if ((legacy.fleetSchema ?? 0) < 1) {
    for (const r of legacy.rovers) { delete r.x; delete r.z; delete r.trip; r.place = true; }
    legacy.fleetSchema = 1;
  }
  // saves from before on-board packs (docs/02 · On-board power): every rover, drone and
  // excavator starts fully charged (an absent charge reads as a full pack)
  if ((legacy.fleetSchema ?? 0) < 2) {
    const fresh = (p: PackState) => { delete p.charge; delete p.pw; delete p.src; delete p.chg; delete p.flatT; };
    for (const r of legacy.rovers) { fresh(r); if (r.trip) delete r.trip.rate; }
    for (const b of legacy.buildings ?? []) { if (b.haul) fresh(b.haul); delete b.onPack; }
    legacy.fleetSchema = 2;
  }
  // saves from before the Builder: every rule off (a loaded save never switches
  // one on), rules added later join with their defaults
  legacy.auto = fillAuto(legacy.auto);
  legacy.flowBook ??= {};
  // saves from before extraction hubs (docs/17 §19): no units yet — Game.loadFrom
  // migrates the excavators (hubSchema stays unset until it has)
  legacy.haulers ??= [];
  legacy.nextHaulerId ??= 1 + legacy.haulers.reduce((m, u) => Math.max(m, u.id), 0);
  legacy.plainPits ??= [];
  legacy.nextPlainPitId ??= 1 + legacy.plainPits.reduce((m, p) => Math.max(m, p.id), 0);
  legacy.pile ??= 0;
  // saves from before strip mines (docs/17 §19 step 2): no pits and an empty
  // delta grid — nothing is carved on load; digging opens pits from now on
  legacy.pits ??= [];
  legacy.nextPitId ??= 1 + legacy.pits.reduce((m, p) => Math.max(m, p.id), 0);
  const t = (legacy as Partial<GameState>).terrain;
  legacy.terrain = { rev: t?.rev ?? 0, clock: t?.clock ?? 0, delta: t?.delta ?? '' };
  legacy.terrainSchema ??= 1;
  // saves from before deposit surveys (docs/17 §19 step 8): every deposit being dug
  // on load counts as surveyed, at the save's precision (Game.loadFrom marks them)
  if (!legacy.oreSurvey) {
    legacy.oreSurvey = { done: {}, jobs: [] };
    const dug = new Set<string>();
    for (const p of legacy.pits) if (p.key.startsWith('dep:')) dug.add(p.key.slice(4));
    for (const u of legacy.haulers) if (u.target?.startsWith('dep:')) dug.add(u.target.slice(4));
    // (the re-read tightens these free once the save's precision techs are counted)
    for (const id of dug) legacy.oreSurvey.done[id] = { at: legacy.simTime, precision: DEP_SURVEY.precision };
  }
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
