/** nanostores atoms — the one-way bridge sim → UI. The sim publishes at the
 *  1 Hz economy boundary (plus after actions); components subscribe to just
 *  the atoms they render. The UI never touches GameState directly. */
import { atom } from 'nanostores';
import type { ResourceId } from '../data/resources';
import type { BuildingId } from '../data/buildings';
import type { TechId } from '../data/techs';
import type { SiteId } from '../data/sites';
import type { AlertMsg, BuildingState } from '../core/state';
import type { DestinyView, ResearchView } from '../core/research';
import type { AutomationView } from '../core/automation';
import type { HazardView } from '../core/hazards';
import type { HazardId, HazardSide } from '../data/hazards';
import { emptyFeed, type DepositKind, type FeedGrade } from '../data/deposits';
import type { SurveyCost } from '../core/exploration';
import type { MapView, OutpostKind, ProspectClass, ProspectId, ProspectKind } from '../data/lunarMap';

export type Phase = 'title' | 'site' | 'playing';

export const $phase = atom<Phase>('title');
export const $hasSave = atom<boolean>(false);
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
  sites: 0, welding: 0, weldParts: 0, upkeep: 0,
  /** robots lent to a survey (not in botsTotal) */
  surveying: 0,
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
export const $autoMarkers = atom<{ id: number; x: number; y: number }[]>([]);
/** the Hazards panel [G], the HUD hazard chip, the objectives line (core/hazards.ts hazardView) */
export const $hazards = atom<HazardView | null>(null);
/** DOM markers over hazard targets (screen px): a hiss glyph with who is aboard, a blight glyph, ⚠ NET, a strip bar */
export const $hazardMarkers = atom<{ id: number; x: number; y: number; glyph: string; text: string; frac?: number }[]>([]);
/** on-screen condition bars over damaged buildings */
export const $wearMarkers = atom<{ id: number; x: number; y: number; frac: number }[]>([]);
/** phaseLeft = game-seconds to the next dusk (by day) or dawn (by night) */
export const $time = atom({
  dayIndex: 0, tCycle: 0, isNight: false, sunFactor: 1, phaseLeft: 0,
  speed: 1, paused: false,
  flare: 'idle' as 'idle' | 'telegraph' | 'active', flareTimer: 0,
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
  /** claim terms; null for heritage and anomaly prospects (survey only) */
  claim: {
    cost: Partial<Record<ResourceId, number>>; deployS: number; upkeepPerDay: number;
    linkKW: number; fuel: string; stream: string;
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
  active: { id: ProspectId; remaining: number } | null;
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
}
export const $deposits = atom<DepositView[]>([]);
/** the deposit whose card is open (a label in the overlay, or the map's SITE view) */
export const $depositSel = atom<string | null>(null);
/** the deposit overlay's DOM labels, projected through the live camera (build mode) */
export const $depositMarkers = atom<{ id: string; x: number; y: number; glyph: string; label: string; lead: boolean }[]>([]);
/** last tick's excavator feed shares (smelter/refinery inspector, regolith panel) */
export const $feed = atom<FeedGrade>(emptyFeed());

export const $alerts = atom<AlertMsg[]>([]);
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
export const $mode = atom<'build' | 'walk'>('build');
export const $selection = atom<BuildingState | null>(null);
/** note = the ghost's deposit line ('On high-Ti basalt — smelter feed ↑'), '' off deposits */
export const $placing = atom<{
  type: BuildingId | 'grade'; valid: boolean; reason: string; warn: string; note?: string;
  /** the warning was clicked through once: the next click builds */
  confirm?: boolean;
  /** the road it would lay (cells), and the rover-seconds to sinter it */
  road?: number;
  roadS?: number;
} | null>(null);
/** the road tool's hint (player/roadTool.ts): what a release would do; null = the tool is off */
export const $roadTool = atom<{ mode: '' | 'lay' | 'remove'; cells: number; seconds: number; reason: string; started: boolean } | null>(null);
export const $victory = atom<boolean>(false);
export const $defeat = atom<boolean>(false);
/** a victory or defeat overlay is up: the world's screens and keys wait under it */
export const overlayUp = () => $victory.get() || $defeat.get();

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
export const $lookAt = atom<{ name: string; x: number; y: number } | null>(null);

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
  /** lent to a survey: not in the fleet until it returns */
  survey: boolean;
  /** 'BUILDING Solar Array #7 · pinned', 'PARKED at the Lander', … */
  state: string;
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
  phase: 'toDig' | 'dig' | 'toDrop' | 'unload';
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
}
export interface FleetView {
  rovers: RoverView[];
  sites: Record<number, SiteCrewView>;
  hauls: Record<number, HaulView>;
}
export const $fleet = atom<FleetView>({ rovers: [], sites: {}, hauls: {} });
/** the construction rover in the inspector (roster id); a building selection clears it */
export const $roverSel = atom<number | null>(null);
/** Send to… / Dig at…: the targeting mode, and what the cursor is over */
export const $fleetTarget = atom<{
  mode: 'send' | 'dig'; id: number; title: string; line: string; valid: boolean; reason: string;
} | null>(null);
/** bumped by an invalid targeting click: the hint flashes its reason */
export const $fleetFlash = atom<number>(0);
