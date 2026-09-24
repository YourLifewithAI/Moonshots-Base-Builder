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
import type { DepositKind } from '../data/deposits';
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
  id: ProspectId; cls: ProspectClass; dist: number; visible: boolean; surveyed: boolean;
  kind: ProspectKind; bt: TechId | null; claimable: boolean; reason: string;
}
export interface LunarOutpostView {
  id: ProspectId; kind: OutpostKind; readyAt: number; fuelOk: boolean; upkeepOk: boolean;
  /** display text, e.g. `+0.20≈/s` */
  stream: string;
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
}
export const $lunar = atom<LunarView | null>(null);

export interface DepositView {
  id: string; kind: DepositKind; x: number; z: number; r: number;
  revealed: boolean;
  lead: { x: number; z: number } | null;
  inNetwork: boolean;
}
export const $deposits = atom<DepositView[]>([]);

export const $alerts = atom<AlertMsg[]>([]);
/** progress = the earliest open objective's status line ('' = none) */
export const $milestones = atom<{ done: string[]; total: number; progress: string }>({ done: [], total: 0, progress: '' });
/** foils / launch / stored: what the next volley would spend, as held now */
export const $swarm = atom({
  pct: 0, launches: 0, armed: false, canLaunch: false, burst: 0, foils: 0, launch: 0, stored: 0,
});
export const $mode = atom<'build' | 'walk'>('build');
export const $selection = atom<BuildingState | null>(null);
export const $placing = atom<{ type: BuildingId | 'grade'; valid: boolean; reason: string; warn: string } | null>(null);
export const $victory = atom<boolean>(false);
export const $defeat = atom<boolean>(false);

/** ice survey state + overlay toggle */
export const $ice = atom<{ hasIce: boolean; surveyed: boolean }>({ hasIce: false, surveyed: false });
export const $iceOverlay = atom<boolean>(false);
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
