/** nanostores atoms — the one-way bridge sim → UI. The sim publishes at the
 *  1 Hz economy boundary (plus after actions); components subscribe to just
 *  the atoms they render. The UI never touches GameState directly. */
import { atom } from 'nanostores';
import type { ResourceId } from '../data/resources';
import type { BuildingId } from '../data/buildings';
import type { TechId } from '../data/techs';
import type { SiteId } from '../data/sites';
import type { AlertMsg, BuildingState } from '../core/state';

export type Phase = 'title' | 'site' | 'playing';

export const $phase = atom<Phase>('title');
export const $hasSave = atom<boolean>(false);
export const $siteId = atom<SiteId | null>(null);

export const $resources = atom<Record<ResourceId, number>>({
  regolith: 0, metals: 0, silicon: 0, water: 0, oxygen: 0, food: 0, parts: 0, foils: 0, launch: 0,
});
export const $power = atom({ supply: 0, demand: 0, stored: 0, capacity: 0, brownout: false });
export const $vitals = atom({ crew: 0, housing: 0, morale: 0, data: 0, botsFree: 0, botsTotal: 0 });
export const $time = atom({
  dayIndex: 0, tCycle: 0, isNight: false, sunFactor: 1,
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
}>({ era: 1, done: [], queue: [], progress: 0, unlocked: [], automation: false });
export const $alerts = atom<AlertMsg[]>([]);
export const $milestones = atom<{ done: string[]; total: number }>({ done: [], total: 0 });
export const $swarm = atom({ pct: 0, launches: 0, armed: false, canLaunch: false, burst: 0 });
export const $mode = atom<'build' | 'walk'>('build');
export const $selection = atom<BuildingState | null>(null);
export const $placing = atom<{ type: BuildingId; valid: boolean; reason: string } | null>(null);
export const $victory = atom<boolean>(false);
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
