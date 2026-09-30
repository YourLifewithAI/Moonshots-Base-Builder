/** nanostores atoms — the one-way bridge sim → UI. The sim publishes at the
 *  1 Hz economy boundary (plus after actions); components subscribe to just
 *  the atoms they render. The UI never touches GameState directly. */
import type { GradeView } from '../core/grading';
import { atom } from 'nanostores';
import type { ResourceId } from '../data/resources';
import type { BuildingId } from '../data/buildings';
import type { TechId } from '../data/techs';
import type { SiteId } from '../data/sites';
import type { AlertMsg, BuildingState, FieldReport, HubPolicy, LogEntry } from '../core/state';
import { loadSettings } from '../core/settings';
import type { DestinyView, ResearchView } from '../core/research';
import type { AutomationView } from '../core/automation';
import type { HazardView } from '../core/hazards';
import type { WeatherView } from '../core/spaceWeather';
import type { HazardId, HazardSide } from '../data/hazards';
import { emptyFeed, type DepositKind, type FeedGrade } from '../data/deposits';
import type { SurveyCost } from '../core/exploration';
import type { FactionId } from '../core/moon';
import type { MapView, OutpostKind, ProspectClass, ProspectId, ProspectKind } from '../data/lunarMap';

export type Phase = 'title' | 'site' | 'playing';

export const $phase = atom<Phase>('title');
export const $hasSave = atom<boolean>(false);
/** the descent screen's line while a late landing plays the days before it (core/game.ts startNewChunked): 'THE MOON IS 3 DAYS IN', '' otherwise */
export const $descent = atom<string>('');
/** the saved mission was lost (human crew gone): the title shows it instead of 'Continue';
 *  cause = how the last settler died, if a hazard's warning went unanswered (docs/14 §3.10) */
export const $lostMission = atom<{ siteId: SiteId; day: number; cause?: string } | null>(null);
/** the lost-mission screen's story (docs/14 §3.10): the last death, its missed warning, the ones before */
export const $lossStory = atom<{ lead: string; warning: string; earlier: string } | null>(null);
export const $siteId = atom<SiteId | null>(null);

export const $resources = atom<Record<ResourceId, number>>({
  regolith: 0, metals: 0, silicon: 0, water: 0, oxygen: 0, food: 0, parts: 0, chips: 0, foils: 0, launch: 0,
});
/** kW: supply = generation, demand = what every running load requested,
 *  served = what the grid delivered (the bank makes up supply's shortfall) */
export const $power = atom({
  supply: 0, demand: 0, served: 0, stored: 0, capacity: 0, brownout: false, shed: false,
  /** the fleet's own draw (driving, road work, charging), of it charging, kW; units flat, waiting for the grid */
  fleet: 0, charging: 0, flat: 0,
});
/** housing = beds the economy counts (enabled, complete, powered); beds = all completed;
 *  boardingHold = the life-support supply keeping the next settler away ('' = none);
 *  lifeSupport = the crew's draw per game-second; sites = construction sites,
 *  welding = those being built this tick, weldParts = their parts per
 *  game-second (every rover on a site welds); upkeep = parts per game-second */
export const $vitals = atom({
  crew: 0, housing: 0, beds: 0, morale: 0, data: 0, botsFree: 0, botsTotal: 0,
  expedition: 'human' as 'human' | 'robotic',
  boardingHold: '' as '' | 'oxygen' | 'food' | 'water',
  lifeSupport: { oxygen: 0, food: 0, water: 0 },
  waterReclaim: 1,
  sites: 0, welding: 0, weldParts: 0, upkeep: 0,
  /** the last crew went home at FIRST LIGHT (docs/14 §5): the base runs unmanned */
  crewHome: false,
  /** workers the crewed stations want · stations idle for crew · stations
   *  agents are covering for want of crew · agents may cover · cover is on */
  seats: 0, crewIdle: 0, covered: 0, canCover: false, agentCover: true,
});
/** Lander services status (shipment en route, the next order's transit in
 *  lunar days, agent-run stations the crew could take) */
export const $lander = atom<{ resupplyPending: boolean; etaS: number; orderDays: number; agentRun: number }>({
  resupplyPending: false, etaS: 0, orderDays: 1, agentRun: 0,
});
/** the Builder: orders, standing rules, reserves (docs/13; the [B] panel) */
export const $automation = atom<AutomationView | null>(null);
/** AUTO tags over the Builder's pending sites (screen px) */
/** tags over construction sites: AUTO over the Builder's, and 'EN ROUTE 0:24' while a rover drives there */
export const $autoMarkers = atom<{ id: number; x: number; y: number; auto?: boolean; text?: string }[]>([]);
/** the Hazards panel [G], the HUD hazard chip, the objectives line (core/hazards.ts hazardView) */
export const $hazards = atom<HazardView | null>(null);
/** space weather (docs/16): the ☉ chip, the flare pop-up, the panel [O] (core/spaceWeather.ts weatherView) */
export const $weather = atom<WeatherView | null>(null);
/** DOM markers over hazard targets (screen px): a hiss glyph with who is aboard, a blight glyph, ⚠ NET, a strip bar */
export const $hazardMarkers = atom<{ id: number; x: number; y: number; glyph: string; text: string; frac?: number }[]>([]);
/** on-screen condition bars over damaged buildings */
export const $wearMarkers = atom<{ id: number; x: number; y: number; frac: number }[]>([]);
/** phaseLeft = game-seconds to the next dusk (by day) or dawn (by night) */
export const $time = atom({
  dayIndex: 0, tCycle: 0, isNight: false, sunFactor: 1, phaseLeft: 0,
  /** the MISSION day (1-based, counted from this base's own landing: docs/20 §4.4); `dayIndex` is the absolute
   *  Moon day, which is what day and night and every deadline read. A solo game lands on day 0: they agree. */
  missionDay: 1,
  /** the Moon clock this base landed at (0 in a solo game): turns an alert's absolute time into a mission day */
  landedAt: 0,
  speed: 1, paused: false,
  flare: 'idle' as 'idle' | 'telegraph' | 'active' | 'tail', flareTimer: 0,
});
export const $tech = atom<{
  era: number;
  done: TechId[];
  queue: TechId[];
  progress: number;
  unlocked: BuildingId[];
  automation: boolean;
  grading: boolean;
}>({ era: 1, done: [], queue: [], progress: 0, unlocked: [], automation: false, grading: false });
/** The research tree, computed in game.publish() by research.researchView();
 *  the UI never recomputes availability, cost or ETA. null before the first publish. */
export const $research = atom<ResearchView | null>(null);

export interface LunarProspectView {
  id: ProspectId; cls: ProspectClass;
  /** great-circle degrees from home, to 0.1° */
  dist: number;
  /** inside the current coverage tier */
  visible: boolean;
  surveyed: boolean;
  kind: ProspectKind;
  /** the breakthrough this prospect hosts (✦? before its survey, ✦ after) */
  bt: TechId | null;
  claimable: boolean;
  /** the next step's refusal: beyond coverage, the survey's, or the claim's ('' = go) */
  reason: string;
  name: string; short: string; lat: number; lon: number; geology: string;
  surveyable: boolean;
  /** data paid: the recorded payout once surveyed, else what a survey pays now (novelty applied) */
  data: number;
  survey: SurveyCost;
  /** an outpost stands (or is deploying) here */
  outpost: boolean;
  /** another faction's outpost holds it (docs/20 §5): the claim is refused, the sheet names the holder; null otherwise */
  rival: { faction: FactionId; name: string } | null;
  /** claim terms; null for heritage and anomaly prospects (survey only) */
  claim: {
    cost: Partial<Record<ResourceId, number>>; deployS: number; upkeepPerDay: number;
    linkKW: number; fuel: string; stream: string;
    /** the field report's own words: `ice +0.20≈/s · claim 60◆ 20⚙ 5▣` (docs/19 S8) */
    line: string;
  } | null;
}
export interface LunarOutpostView {
  id: ProspectId; kind: OutpostKind; readyAt: number; fuelOk: boolean; upkeepOk: boolean;
  /** display text, e.g. `+0.20≈/s` (ATLAS and wear applied), or a KREEP modifier line */
  stream: string;
  name: string; cls: ProspectClass;
  /** streaming (deploy finished) */
  live: boolean;
  /** seconds of deploy left (0 once live) */
  deployLeft: number;
  /** hopper fuel line, e.g. `0.02○ + 0.004≈ /s` ('' for rover-haul classes) */
  fuel: string;
  upkeep: string;
  linkKW: number;
  /** what it is doing (docs/19 S8): online, wearing (parts short: the stream is halved), grounded (hopper
   *  fuel short), cut off (an air-gapped Lander, or hacked), or still deploying */
  state: 'deploying' | 'live' | 'worn' | 'grounded' | 'off';
  /** the stream it makes once online, per second (ATLAS and wear applied); it lands only in `live` and `worn` */
  res: Partial<Record<ResourceId, number>>;
  /** research data it makes once online, ≡ per second (same rule) */
  data: number;
  /** what it burns while online, per second: hopper fuel and parts upkeep */
  burn: Partial<Record<ResourceId, number>>;
  /** a KREEP outpost's modifier line, else '' */
  modifier: string;
}
/** A rival program on the shared Moon (docs/20 §4.4), as the map and the race panel read it. */
export interface LunarRivalView {
  faction: FactionId;
  /** display name, e.g. 'The Foundry' */
  name: string;
  siteId: SiteId;
  /** the landing site's home on the globe */
  home: { lat: number; lon: number };
  /** it has landed (a faction that lands later is listed, not yet landed) and the Moon clock it lands at */
  landed: boolean;
  landedAt: number;
  /** the prospects its outposts hold */
  outposts: ProspectId[];
  launches: number;
  era: number;
  /** the prospects its survey drones are flying to now */
  surveying: ProspectId[];
}
export interface LunarView {
  tier: 0 | 1 | 2 | 3 | 4;
  view: MapView;
  maxView: MapView;
  /** a tier unlocked while the map was closed: pulse the chip, animate on next open */
  justExpanded: boolean;
  slots: number;
  used: number;
  surveyedCount: number;
  atlas: boolean;
  prospects: LunarProspectView[];
  /** the other programs on this Moon (empty in a solo game) */
  rivals: LunarRivalView[];
  /** the soonest flight home (null: no drone out); `flights` lists every drone away, soonest first */
  active: { id: ProspectId; remaining: number } | null;
  flights: { id: ProspectId; drone: number; remaining: number; total: number; short: string }[];
  /** the survey-drone fleet: total, ready (docked and charged), out, charging, bays, prints under way */
  drones: { total: number; ready: number; out: number; charging: number; cap: number; printing: number };
  outposts: LunarOutpostView[];
  /** SURVEY_TIERS label, e.g. 'NEAR SIDE' */
  tierLabel: string;
  /** the 1 km SITE view: world metres, x/z as on the build grid (map heart = 0, 0) */
  site: {
    revealM: number;
    lander: { x: number; z: number };
    /** build-network discs (Lander, completed habitats and Relay Masts) */
    network: { x: number; z: number; r: number }[];
    buildings: { id: number; type: BuildingId; x: number; z: number; w: number; d: number; complete: boolean }[];
  };
}
export const $lunar = atom<LunarView | null>(null);

export interface DepositView {
  id: string;
  /** ground truth — while unrevealed show `label`/`glyph`, never the kind */
  kind: DepositKind; x: number; z: number; r: number;
  revealed: boolean;
  /** the '?' lead (unrevealed, within 400 m of the Lander) */
  lead: { x: number; z: number } | null;
  /** the build network reaches some of it */
  inNetwork: boolean;
  /** 'high-Ti basalt' when revealed; the lead's hint ('? possible high-Ti basalt', '? unknown') when not */
  label: string;
  /** the kind's glyph when revealed, '?' when not */
  glyph: string;
  /** lit for the hub being placed or selected (docs/17 §6.1; core/hubPreview.ts); absent: not lit */
  lit?: DepositLit;
}
/** How a deposit lights for a hub (docs/17 §6.1): its state, one way from the
 *  hub's door, its faces, the pit already cut and the full-size pit ring.
 *  Phase 4's ore (left, ± precision) and grade come only when present. */
export interface DepositLit {
  /** 'lit': the hub wants it · 'dim': shown dimmer (a smelter's glass, KREEP) */
  tier: 'lit' | 'dim';
  state: 'open' | 'pit' | 'far' | 'full' | 'exhausted' | 'boxed' | 'reclaimed' | 'plain' | 'stake';
  /** one way, game-s (null: no hub position — its palette card); approx: no road yet (≈) */
  eta: number | null;
  approx: boolean;
  faces: number;
  used: number;
  /** the pit's rim now and its centre (null: not dug), and the full-size ring, m */
  pitR: number | null;
  pitX?: number;
  pitZ?: number;
  fullR: number;
  /** where its units would go */
  best: boolean;
  /** the label's words (the glyph apart): '0:15 · 1/3 · pit 18 m' */
  label: string;
  /** Phase 4: ore left (▲) and the estimate's ± share, the cut's grade */
  ore?: { left: number; precision?: number };
  grade?: number;
}
export const $deposits = atom<DepositView[]>([]);
/** The resource highlight (docs/17 §6; core/hubPreview.ts's HubLight, less
 *  its geometry): the hub type and its source, and the lit plain pits and
 *  the ghost's stake, which are no deposits (the map and the labels). */
export interface HubLightView {
  type: BuildingId;
  source: 'ghost' | 'selected' | 'card';
  hubId: number | null;
  reachS: number;
  mre: boolean;
  /** plain pits and the stake: id, centre, ring, full-size ring, state, label */
  extra: { id: string; x: number; z: number; r: number; fullR: number; state: 'plain' | 'stake'; label: string; pitR: number | null }[];
}
export const $hubLight = atom<HubLightView | null>(null);
/** a hub's palette card under the pointer (desktop hover): its deposits light up */
export const $hubCard = atom<BuildingId | null>(null);
/** the deposit whose card is open (a label in the overlay, or the map's SITE view) */
export const $depositSel = atom<string | null>(null);
/** the deposit overlay's DOM labels, projected through the live camera (build mode) */
export const $depositMarkers = atom<{
  id: string; x: number; y: number; glyph: string; label: string; lead: boolean;
  /** lit for a hub (docs/17 §6.1): 'lit' | 'dim' and its state ('lit far', 'lit full', …); '' not lit */
  lit?: string;
  /** not a deposit: a plain pit or the ghost's stake (no card) */
  pit?: boolean;
}[]>([]);
/** last tick's excavator feed shares (smelter/refinery inspector, regolith panel) */
export const $feed = atom<FeedGrade>(emptyFeed());

export const $alerts = atom<AlertMsg[]>([]);
/** the saved notification log, oldest first (docs/19 S7; ui/notifyUi.ts's Log panel and the weather panel's view) */
export const $log = atom<LogEntry[]>([]);
/** field reports waiting on the dispatch card, oldest first; the newest shows (ui/notifyUi.ts) */
export interface FieldCard { id: number; text: string; report: FieldReport; action?: LogEntry['action'] }
export const $fieldCards = atom<FieldCard[]>([]);
/** the Log panel is open (the alert stack's Log button toggles it) */
export const $logOpen = atom<boolean>(false);
/** progress = the earliest open objective's status line ('' = none); hints =
 *  each objective's hint for this run (expedition and doctrine applied) */
export const $milestones = atom<{ done: string[]; total: number; progress: string; hints: Record<string, string> }>({
  done: [], total: 0, progress: '', hints: {},
});
/** foils / launch / stored: held now; needFoils / needLaunch / burst: what the
 *  next volley spends (docs/14: Crewed Mission Control's 2↑ with `minCrew`
 *  on console, Autonomous Cadence's burst and `auto` fire) */
export const $swarm = atom({
  pct: 0, launches: 0, armed: false, canLaunch: false, burst: 0, foils: 0, launch: 0, stored: 0,
  needFoils: 10, needLaunch: 3, auto: false, crewed: false, minCrew: 0,
});
/** the destiny meter: picks per era, counts, the band, what is still reachable (docs/14 §2.4) */
export const $destiny = atom<DestinyView>({
  picks: [null, null, null, null, null, null, null, null], c: 0, a: 0, left: 8, band: null, certain: null, lean: 0,
  reach: { colony: { need: 6, ok: true }, automation: { need: 6, ok: true }, concord: true }, crewHome: false,
});
export const $selection = atom<BuildingState | null>(null);
/** note = the ghost's deposit line ('On high-Ti basalt — smelter feed ↑'), '' off deposits */
export const $placing = atom<{
  type: BuildingId | 'grade'; valid: boolean; reason: string; warn: string; note?: string;
  /** the warning was clicked through once: the next click builds */
  confirm?: boolean;
  /** the road it would lay (cells), and the rover-seconds to sinter it */
  road?: number;
  roadS?: number;
  /** inside an extraction zone: m of off-road drive from its road's end */
  offM?: number;
  /** game-seconds the nearest free rover would take to get there (core/transit.ts);
   *  Infinity: every rover is busy; undefined: not asked */
  travelS?: number;
  /** a hub's ghost: where its units would dig, and how far one way (core/hubPreview.ts hubGhostLine) */
  hub?: string;
  /** the rest of its HUB block (docs/17 §5.2): the route, the units that fill it, the
   *  full-size pit against its walls, the next choice, the plain-pit stake */
  hubBlock?: string[];
} | null>(null);
/** the road tool's hint (player/roadTool.ts): what a release would do; null = the tool is off */
export const $roadTool = atom<{ mode: '' | 'lay' | 'remove'; cells: number; seconds: number; reason: string; started: boolean; waypoints?: number } | null>(null);
/** the grading tool's hint (player/gradeTool.ts, docs/19 S5): the box under the cursor, what it takes, why not; null = off */
export interface GradeToolHint {
  started: boolean; cells: number; w: number; d: number;
  /** rover-seconds at the base rate, the wall-clock estimate with the rovers it would take, stored energy, relief now (m) */
  secs: number; eta: number; rovers: number; energy: number; relief: number;
  /** cells on a tailings heap */
  spoil: number;
  ok: boolean; reason: string;
}
export const $gradeTool = atom<GradeToolHint | null>(null);
export const $victory = atom<boolean>(false);
export const $defeat = atom<boolean>(false);
/** a victory or defeat overlay is up: the world's screens and keys wait under it */
export const overlayUp = () => $victory.get() || $defeat.get();
/** something that holds the game paused for the player's answer is up: a victory or defeat
 *  overlay, an era or hazard banner (ui/discovery.ts; a tech card is not one), or the menu.
 *  A speed click or key resumes a paused game only when none of these is up. */
export const modalUp = () => overlayUp() || $menuOpen.get() || announceHolds($announce.get()[0]);

/** ice survey state (legacy saves) */
export const $ice = atom<{ hasIce: boolean; surveyed: boolean }>({ hasIce: false, surveyed: false });
/** the deposit overlay toggle [I] */
export const $depositOverlay = atom<boolean>(false);
/** the overlay's old name, from when it showed only ice */
export const $iceOverlay = $depositOverlay;
/** stockpile caps for capped resources */
export const $caps = atom<Partial<Record<ResourceId, number>>>({});
/** building counts (total / active / dark for lack of power) for the resource info panels */
export const $counts = atom<Partial<Record<BuildingId, { total: number; active: number; dark: number }>>>({});
/** smoothed net flow per resource, per game-second (from the economy tick) */
export const $rates = atom<Partial<Record<ResourceId, number>>>({});
/** which resource info panel is open (chip click) */
export const $resourcePanel = atom<string | null>(null);

/** Floating deltas at the cursor on placement (Islanders-style diegetic feedback). */
export interface Floater { id: number; text: string; x: number; y: number }
export const $floaters = atom<Floater[]>([]);
let floaterId = 1;
export function spawnFloater(text: string, x: number, y: number) {
  $floaters.set([...$floaters.get(), { id: floaterId++, text, x, y }]);
  const id = floaterId - 1;
  setTimeout(() => $floaters.set($floaters.get().filter((f) => f.id !== id)), 1400);
}

/** Discoveries waiting to be shown: a finished tech, or an era that opened
 *  (ui/discovery.ts). game.publish() queues them; the card or banner pops them. */
export type Announcement =
  | { id: number; kind: 'tech'; tid: TechId }
  | { id: number; kind: 'era'; era: number; intro: boolean }
  /** docs/14 §3.10: a side's hazards go live, and the first of a kind (its drill) */
  | { id: number; kind: 'hazardsLive'; side: HazardSide }
  | { id: number; kind: 'hazard'; hazard: HazardId };
export const $announce = atom<Announcement[]>([]);
/** an announcement that holds the game paused until Continue: an era explainer, a hazards-live
 *  banner, and a hazard's drill card unless the menu's "Pause on hazard drills" is off (docs/19 S7) */
export const announceHolds = (a: Announcement | undefined) =>
  !!a && a.kind !== 'tech' && !(a.kind === 'hazard' && !loadSettings().pauseDrills);

/** touch mode's info card (ui/touchUi.ts): a building type's tooltip, for
 *  a long-press or a tap on a palette card; null = closed */
export const $touchInfo = atom<{ type: BuildingId; locked: boolean } | null>(null);

/** the in-game menu (Esc with nothing left to cancel) */
export const $menuOpen = atom<boolean>(false);
/** bumped by a click on a blocked spot: the placement hint flashes its reason */
export const $placeFlash = atom<number>(0);

// ── fleet control (core/fleet.ts, core/haul.ts; views from core/fleetView.ts) ──

/** a construction rover as the inspector shows it */
export interface RoverView {
  id: number;
  home: number;
  homeName: string;
  /** its construction site (working, or waiting at a paused one) */
  site: number | null;
  siteName: string;
  pinned: boolean;
  /** 'BUILDING Solar Array #7 · pinned', 'PARKED at the Lander', 'EN ROUTE to Habitat #5 · 0:24', … */
  state: string;
  /** on its way: game-seconds of its trip left (0: there, or parked) */
  tripS: number;
  /** its pack (core/unitPower.ts): 'BATTERY 64% · charging', 'NO POWER — waiting for the grid (brownout)' */
  pack: string;
  /** out of charge, waiting for the grid */
  flat: boolean;
}
/** a construction site's crew: rovers on it, pinned among them, and what they make of it */
export interface SiteCrewView {
  n: number;
  pinned: number;
  /** game-seconds left at this crew (Infinity with none) */
  eta: number;
  /** eta with one more rover (what Summon would buy) */
  etaPlus: number;
  kw: number;
  /** build speed against one rover (n^0.85) */
  speed: number;
  /** why Summon would do nothing here ('' = it can) */
  summon: string;
  /** nobody there yet: 'enroute' (arrives in `arrive` s), 'noroad' (no road reaches it); '' someone is */
  wait: '' | 'enroute' | 'noroad';
  arrive: number;
  /** rovers here out of charge, waiting for the grid (core/unitPower.ts) */
  flat: number;
}
/** a revealed deposit an excavator could dig, with the trip it would make */
export interface DigOption {
  id: string; kind: DepositKind; name: string; glyph: string;
  x: number; z: number;
  /** from the excavator's home pad, m */
  distM: number;
  /** regolith per game-second delivered from there */
  rate: number;
  /** what it does to the feed: 'smelter feed ↑' */
  feed: string;
}
/** an excavator's haul cycle as the inspector shows it */
export interface HaulView {
  phase: 'toDig' | 'dig' | 'toDrop' | 'unload' | 'toBay' | 'park';
  /** 'DIGGING high-Ti basalt · 63/105▲', 'HAULING 105▲ to Regolith Smelter #4', … */
  line: string;
  cargo: number;
  bucket: number;
  home: boolean;
  digName: string;
  dropName: string;
  /** dig site → consumer, m */
  routeM: number;
  /** delivered regolith per game-second on this route, and digging its own pad */
  rate: number;
  homeRate: number;
  waiting: boolean;
  nearby: DigOption[];
  /** its pack (core/unitPower.ts): 'BATTERY 64% · charging', 'NO POWER — waiting for the grid (brownout)' */
  pack: string;
}
/** a hub's queue job as the inspector shows it (docs/17 §4.7) */
export interface HubJobView {
  kind: 'unit' | 'bay' | 'reprint';
  name: string;
  /** 0..1 printed; s left; paid yet; what it waits on ('' none) */
  pct: number;
  left: number;
  paid: boolean;
  waiting: string;
}
/** a place a hub's units might dig, as its PITS IN REACH list shows it */
export interface PitView {
  key: string;
  name: string;
  glyph: string;
  /** Phase 4 (docs/17 §4.7): the pit now and at full size, the ore the survey read and its
   *  life ('pit 18 m of 28 · ore 8.4k▲ left (±30%) · ~5.8 lunar days'), '' for a plain pit */
  ore?: string;
  /** a deposit no survey has read yet (its row offers Survey) */
  unsurveyed?: boolean;
  /** one way from the hub's door, s; a road reaches its gate */
  tripS: number;
  connected: boolean;
  faces: number;
  used: number;
  /** the feed factor there, and the hub intake one more unit would bring */
  q: number;
  rate: number;
  score: number;
  inReach: boolean;
  assigned: boolean;
  plain: boolean;
}
/** a hub unit (docs/17 §4.6) as the ROBOTS list and its own inspector show it */
export interface UnitView {
  planner: boolean;
  feedPlanOff: boolean;
  planWhy: string;
  id: number;
  /** 'E3' */
  tag: string;
  type: 'excavator' | 'iceMiner';
  name: string;
  hub: number;
  hubName: string;
  bay: number;
  /** 'DIGGING high-Ti basalt #0 · 78/131▲', 'HAULING 131▲ to the hub', 'PARKED — recalled' */
  line: string;
  target: string | null;
  targetName: string;
  pinned: boolean;
  parked: string;
  phase: string;
  cargo: number;
  bucket: number;
  /** one way to its target, s (0: none), and ▲/s it delivers there */
  tripS: number;
  rate: number;
  pack: string;
  wear: number;
  /** its capability (rad scars, docs/16 §4.13) and its flare line: σ, capability, the last flare, Re-print */
  cap: number;
  flare: string;
  reprint: boolean;
  flat: boolean;
}
/** a hub (docs/17 §4.7): its hopper, feed, units, queue and pits */
export interface HubView {
  electrolysis: boolean;
  canElectrolysis: boolean;
  policy: HubPolicy;
  planner: boolean;
  plannerWhy: string;
  id: number;
  name: string;
  level: number;
  bays: number;
  units: number[];
  hopper: number;
  hopperCap: number;
  /** its feed factor (q), the kind mix, its starved share */
  q: number;
  feed: string;
  starved: number;
  queue: HubJobView[];
  unitName: string;
  unitCost: string;
  unitTime: number;
  /** why + Unit / + Bay would be refused ('' = it can) */
  canUnit: string;
  canBay: string;
  bayCost: string;
  pits: PitView[];
  prefer: string | null;
  plainPit: number | null;
  /** 'A 2nd excavator would fill the hopper: +0.6▲/s' ('' none) */
  hint: string;
  /** the status line's tail: 'STARVED — …' ('' when fed) */
  status: string;
}
/** One survey drone (docs/19 S6, core/surveyDrones.ts): docked and charged (ready), charging, or out on a flight */
export interface SurveyDroneView {
  id: number;
  home: number;
  homeName: string;
  state: 'ready' | 'charging' | 'out';
  /** its pack, 0..1 */
  charge: number;
  /** out: the prospect it flies to (its real short name) and game-seconds left */
  prospect: string | null;
  name: string;
  remaining: number;
}
/** The survey-drone fleet as the fleet panel and a Prospecting Bay's inspector show it */
export interface SurveyFleetView {
  total: number;
  ready: number;
  out: number;
  charging: number;
  /** drone bays the docks hold now (the Lander's one, and each Prospecting Bay's 2, 4 or 6) */
  cap: number;
  /** Prospecting Bays standing, and the level they have reached (bays a Bay: 2 · 4 · 6) */
  bays: number;
  level: 1 | 2 | 3;
  baysEach: number;
  drones: SurveyDroneView[];
  /** drones being printed: the Bay and game-seconds left */
  prints: { bay: number; name: string; left: number }[];
  /** '2/3 docked · 1 out → Marius Hills 2:10' */
  line: string;
}
export const EMPTY_SURVEY_FLEET: SurveyFleetView = {
  total: 0, ready: 0, out: 0, charging: 0, cap: 0, bays: 0, level: 1, baysEach: 2, drones: [], prints: [], line: 'no drones',
};

export interface FleetView {
  rovers: RoverView[];
  sites: Record<number, SiteCrewView>;
  hauls: Record<number, HaulView>;
  /** extraction hubs and their units (docs/17) */
  hubs: Record<number, HubView>;
  units: UnitView[];
  /** box-drag grading jobs under way (docs/19 S5, core/grading.ts) */
  grading?: GradeView[];
  /** the survey-drone fleet (docs/19 S6) */
  survey: SurveyFleetView;
}
export const $fleet = atom<FleetView>({ rovers: [], sites: {}, hauls: {}, hubs: {}, units: [], grading: [], survey: EMPTY_SURVEY_FLEET });
/** the hub unit in its inspector (unit id); a building or rover selection clears it */
export const $unitSel = atom<number | null>(null);
/** the construction rover in the inspector (roster id); a building selection clears it */
export const $roverSel = atom<number | null>(null);
/** Send to… / Dig at…: the targeting mode, and what the cursor is over */
export const $fleetTarget = atom<{
  mode: 'send' | 'dig' | 'sendUnit' | 'openPit'; id: number; title: string; line: string; valid: boolean; reason: string;
} | null>(null);
/** bumped by an invalid targeting click: the hint flashes its reason */
export const $fleetFlash = atom<number>(0);
