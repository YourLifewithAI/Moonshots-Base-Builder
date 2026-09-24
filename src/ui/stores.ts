/** nanostores atoms — the one-way bridge sim → UI. The sim publishes at the
 *  1 Hz economy boundary (plus after actions); components subscribe to just
 *  the atoms they render. The UI never touches GameState directly. */
import { atom } from 'nanostores';
import type { ResourceId } from '../data/resources';
import type { BuildingId } from '../data/buildings';
import type { TechId } from '../data/techs';
import type { SiteId } from '../data/sites';
import type { AlertMsg, BuildingState } from '../core/state';
import type { ResearchView } from '../core/research';
import { emptyFeed, type DepositKind, type FeedGrade } from '../data/deposits';
import type { SurveyCost } from '../core/exploration';
import type { MapView, OutpostKind, ProspectClass, ProspectId, ProspectKind } from '../data/lunarMap';

export type Phase = 'title' | 'site' | 'playing';

export const $phase = atom<Phase>('title');
export const $hasSave = atom<boolean>(false);
/** the saved mission was lost (human crew gone): the title shows it instead of 'Continue' */
export const $lostMission = atom<{ siteId: SiteId; day: number } | null>(null);
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
 *  welding = those being built this tick; upkeep = parts per game-second */
export const $vitals = atom({
  crew: 0, housing: 0, beds: 0, morale: 0, data: 0, botsFree: 0, botsTotal: 0,
  expedition: 'human' as 'human' | 'robotic',
  boardingHold: '' as '' | 'oxygen' | 'food' | 'water',
  lifeSupport: { oxygen: 0, food: 0, water: 0 },
  sites: 0, welding: 0, upkeep: 0,
  /** robots lent to a survey (not in botsTotal) */
  surveying: 0,
});
/** Lander services status (shipment en route, the next order's transit in
 *  lunar days, agent-run stations the crew could take) */
export const $lander = atom<{ resupplyPending: boolean; etaS: number; orderDays: number; agentRun: number }>({
  resupplyPending: false, etaS: 0, orderDays: 1, agentRun: 0,
});
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
/** foils / launch / stored: what the next volley would spend, as held now */
export const $swarm = atom({
  pct: 0, launches: 0, armed: false, canLaunch: false, burst: 0, foils: 0, launch: 0, stored: 0,
});
export const $mode = atom<'build' | 'walk'>('build');
export const $selection = atom<BuildingState | null>(null);
/** note = the ghost's deposit line ('On high-Ti basalt — smelter feed ↑'), '' off deposits */
export const $placing = atom<{ type: BuildingId | 'grade'; valid: boolean; reason: string; warn: string; note?: string } | null>(null);
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

/** the in-game menu (Esc with nothing left to cancel) */
export const $menuOpen = atom<boolean>(false);
/** bumped by a click on a blocked spot: the placement hint flashes its reason */
export const $placeFlash = atom<number>(0);
