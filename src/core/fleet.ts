/** The construction-rover fleet as units the sim knows (economy step 0).
 *
 *  The roster follows the docks: every enabled, complete Lander and Robotics
 *  Bay supplies its rovers (a Bay ± botPerBay), and a rover keeps its id for
 *  life, so its visual and its voice follow it. Each tick:
 *
 *   - a rover whose site completed or was demolished returns to auto, pin and all;
 *   - auto rovers go one per enabled site in queue order (placement order
 *     unless Build next), as they always have — sites holding a pinned rover
 *     already have their crew and are skipped;
 *   - pinned rovers stay at their site until it completes.
 *
 *  Pinning (Summon at a site, or Send a selected rover) adds a rover to a
 *  site: the crew already there is pinned with it, so the auto layer never
 *  hands it back down the queue. n rovers build crewRate(n) = n^0.85 times as
 *  fast as one; each draws its own construction kW, and the build's weld
 *  parts stay the same (drawn faster). A survey borrows one unpinned rover.
 *  s.bots stays derived, for the HUD, surveys and milestones. */
import { BUILDINGS } from '../data/buildings';
import { CONSTRUCTION_KW, CONSTRUCTION_PARTS_PER_S, FLEET } from '../data/balance';
import type { BuildingState, GameState, RoverUnit } from './state';
import type { Mods } from './mods';
import { centerOf } from '../buildings/instances';

export interface ActionResult { ok: boolean; reason: string }
const OK: ActionResult = { ok: true, reason: '' };
const no = (reason: string): ActionResult => ({ ok: false, reason });

const isSite = (b: { construction?: number }) => (b.construction ?? 0) > 0;
/** a site's place in the rover queue (economy.queuePos) */
const queue = (b: BuildingState) => b.buildSeq ?? b.id;
const label = (b: BuildingState) => `${BUILDINGS[b.type].name} #${b.id}`;

/** How much faster n rovers build one site than one rover does. */
export function crewRate(n: number): number {
  return n > 0 ? n ** FLEET.rateExp : 0;
}

/** Grid draw of n rovers working one site, kW. */
export function crewKW(mods: Pick<Mods, 'constructionKWMult'>, n: number): number {
  return CONSTRUCTION_KW * mods.constructionKWMult * n;
}

/** Weld parts per second at a site with n rovers (a build's total is the same for any n). */
export function crewParts(mods: Pick<Mods, 'weldPartsMult'>, n: number): number {
  return CONSTRUCTION_PARTS_PER_S * mods.weldPartsMult * crewRate(n);
}

/** Game-seconds a site has left with n rovers on it (Infinity with none). */
export function siteEta(mods: Pick<Mods, 'weldRateMult'> & Partial<Pick<Mods, 'roadCellMult'>>, b: BuildingState, n: number, roadS = 0): number {
  const rate = mods.weldRateMult * crewRate(n);
  return rate > 0 ? ((b.construction ?? 0) + roadS * (mods.roadCellMult ?? 1)) / rate : Infinity;
}

/** The rover lent to a survey (it is not in the fleet until it returns). */
export function surveyRover(s: GameState): number | undefined {
  return s.survey?.active?.rover;
}

/** One entry per rover the docks supply, in building order: the dock's id. */
export function dockSlots(s: GameState, mods: Pick<Mods, 'botPerBay'>): number[] {
  const out: number[] = [];
  for (const b of s.buildings) {
    if (!b.enabled || isSite(b)) continue;
    let n = BUILDINGS[b.type].bots ?? 0;
    if (b.type === 'roboticsBay') n += mods.botPerBay;
    for (let i = 0; i < n; i++) out.push(b.id);
  }
  return out;
}

/** Where the sim takes a rover to be: its site, else its dock. */
function whereIs(s: GameState, r: RoverUnit): [number, number] {
  const at = s.buildings.find((b) => b.id === (r.site ?? r.home));
  return at ? centerOf(at) : [0, 0];
}

function nearest(s: GameState, list: RoverUnit[], x: number, z: number): RoverUnit | null {
  let best: RoverUnit | null = null, bd = Infinity;
  for (const r of list) {
    const [rx, rz] = whereIs(s, r);
    const d = Math.hypot(rx - x, rz - z);
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}

/** Keep the roster the size the docks supply. Rovers keep their ids and
 *  their docks where the dock still has room; a shrinking fleet lets idle
 *  rovers go first and never the one out on a survey. */
export function syncRoster(s: GameState, mods: Pick<Mods, 'botPerBay'>) {
  s.rovers ??= [];
  s.nextRoverId ??= 1;
  const need = new Map<number, number>();
  for (const h of dockSlots(s, mods)) need.set(h, (need.get(h) ?? 0) + 1);
  const away = surveyRover(s);
  // who stays when a dock has fewer slots than rovers: the surveyor, the
  // pinned, the working, then the idle (roster order breaks ties)
  const rank = (r: RoverUnit) => (r.id === away ? 0 : r.pinned ? 1 : r.site !== null ? 2 : 3);
  const kept = new Set<RoverUnit>();
  const used = new Map<number, number>();
  const byRank = [...s.rovers].sort((a, b) => rank(a) - rank(b));
  const homeless: RoverUnit[] = [];
  for (const r of byRank) {
    const n = used.get(r.home) ?? 0;
    if (n < (need.get(r.home) ?? 0)) { used.set(r.home, n + 1); kept.add(r); } else homeless.push(r);
  }
  // a dock gone: its rovers move to any dock with a free slot
  for (const r of homeless) {
    const home = [...need].find(([h, n]) => (used.get(h) ?? 0) < n)?.[0];
    if (home === undefined) continue;
    r.home = home;
    used.set(home, (used.get(home) ?? 0) + 1);
    kept.add(r);
  }
  const roster = s.rovers.filter((r) => kept.has(r));
  for (const [h, n] of need) {
    for (let i = used.get(h) ?? 0; i < n; i++) roster.push({ id: s.nextRoverId++, home: h, site: null, pinned: false });
  }
  s.rovers = roster;
  const a = s.survey?.active;
  if (a) {
    // a survey from before the roster (or whose rover's dock went): lend one now
    if (a.rover === undefined || !roster.some((r) => r.id === a.rover)) a.rover = borrowable(s)?.id;
  }
}

/** The rover a survey would borrow: an idle unpinned one, else the auto
 *  rover furthest back in the queue (the site that would lose it anyway);
 *  never a pinned one. */
export function borrowable(s: GameState): RoverUnit | null {
  const away = surveyRover(s);
  const free = s.rovers.filter((r) => !r.pinned && r.id !== away);
  const idle = free.find((r) => r.site === null);
  if (idle) return idle;
  const posOf = (r: RoverUnit) => {
    const b = s.buildings.find((x) => x.id === r.site);
    return b ? queue(b) : -Infinity;
  };
  let pick: RoverUnit | null = null;
  for (const r of free) if (!pick || posOf(r) >= posOf(pick)) pick = r;
  return pick;
}

/** Economy step 0: settle every rover and return the crew size at each
 *  enabled construction site (sites absent from the map wait for a rover).
 *  Also derives s.bots. */
export function assignRovers(s: GameState): Map<number, number> {
  const sites = s.buildings.filter(isSite).sort((a, b) => queue(a) - queue(b) || a.id - b.id);
  const siteIds = new Set(sites.map((b) => b.id));
  const away = surveyRover(s);
  for (const r of s.rovers) {
    // the site is done (or gone): back to auto, pin and all
    if (r.site !== null && !siteIds.has(r.site)) { r.site = null; r.pinned = false; }
    if (r.id === away) { r.site = null; r.pinned = false; }
  }
  const pinnedAt = new Set(s.rovers.filter((r) => r.pinned && r.site !== null).map((r) => r.site!));
  const auto = s.rovers.filter((r) => !r.pinned && r.id !== away);
  const targets = sites.filter((b) => b.enabled && !pinnedAt.has(b.id)).slice(0, auto.length);
  const wanted = new Set(targets.map((b) => b.id));
  const served = new Set<number>();
  // an auto rover already at a site that still gets one stays put
  for (const r of auto) {
    if (r.site !== null && wanted.has(r.site) && !served.has(r.site)) served.add(r.site);
    else r.site = null;
  }
  const free = auto.filter((r) => r.site === null);
  for (const b of targets) {
    if (served.has(b.id)) continue;
    const [cx, cz] = centerOf(b);
    const r = nearest(s, free, cx, cz);
    if (!r) break;
    free.splice(free.indexOf(r), 1);
    r.site = b.id;
    served.add(b.id);
  }
  // free rovers sinter the roads drawn and the haul roads: one a job, oldest
  // first, in roster order (core/roads.ts)
  const jobs = (s.roadJobs ?? []).map((j) => j.id);
  const live = new Set(jobs);
  for (const r of s.rovers) {
    if (r.road !== undefined && (r.site !== null || r.pinned || r.id === away || !live.has(r.road))) delete r.road;
  }
  const onJob = new Set(s.rovers.filter((r) => r.road !== undefined).map((r) => r.road!));
  const idle = s.rovers.filter((r) => r.site === null && !r.pinned && r.id !== away && r.road === undefined);
  for (const id of jobs) {
    if (onJob.has(id)) continue;
    const r = idle.shift();
    if (!r) break;
    r.road = id;
    onJob.add(id);
  }
  const enabled = new Set(sites.filter((b) => b.enabled).map((b) => b.id));
  const crews = new Map<number, number>();
  for (const r of s.rovers) {
    if (r.site !== null && enabled.has(r.site)) crews.set(r.site, (crews.get(r.site) ?? 0) + 1);
  }
  const lent = away !== undefined && s.rovers.some((r) => r.id === away) ? 1 : 0;
  s.bots = { total: s.rovers.length - lent, busy: s.rovers.filter((r) => r.site !== null || r.road !== undefined).length };
  return crews;
}

/** Roster and assignments now (a load, a new landing, a tech that adds rovers). */
export function fleetRefresh(s: GameState, mods: Pick<Mods, 'botPerBay'>): Map<number, number> {
  syncRoster(s, mods);
  return assignRovers(s);
}

/** Rovers at a site (working or, if it is paused, waiting there). */
export function roversAt(s: GameState, siteId: number): RoverUnit[] {
  return s.rovers.filter((r) => r.site === siteId);
}

function siteFor(s: GameState, siteId: number): BuildingState | string {
  const b = s.buildings.find((x) => x.id === siteId);
  if (!b) return 'NO SUCH SITE';
  if (!isSite(b)) return `NOT A CONSTRUCTION SITE — ${label(b)} is built`;
  if (!b.enabled) return `SITE PAUSED — resume ${label(b)} first`;
  return b;
}

/** Pin `r` to the site, and the crew already there with it. */
function pinTo(s: GameState, r: RoverUnit, site: BuildingState) {
  for (const x of s.rovers) if (x.site === site.id) x.pinned = true;
  r.site = site.id;
  r.pinned = true;
  const n = roversAt(s, site.id).length;
  if (s.stats) s.stats.crowdedSiteMax = Math.max(s.stats.crowdedSiteMax ?? 0, n);
}

/** What Summon at this site would do, or why it cannot ('' reason = it can). */
export function summonPick(s: GameState, siteId: number): { rover: RoverUnit | null; from: number | null; reason: string } {
  const site = siteFor(s, siteId);
  if (typeof site === 'string') return { rover: null, from: null, reason: site };
  const away = surveyRover(s);
  const cand = s.rovers.filter((r) => r.id !== away && r.site !== siteId);
  if (!cand.length) {
    return {
      rover: null, from: null,
      reason: !s.rovers.length ? 'NO ROVERS — the fleet is empty'
        : s.rovers.every((r) => r.id === away) ? 'NO ROVER TO SUMMON — the only one is out on a survey'
        : 'NO ROVER TO SUMMON — the whole fleet is already here',
    };
  }
  const [cx, cz] = centerOf(site);
  const idle = cand.filter((r) => r.site === null);
  if (idle.length) return { rover: nearest(s, idle, cx, cz), from: null, reason: '' };
  // none free: take one from the site with the most rovers (ties: furthest back in the queue)
  const count = new Map<number, RoverUnit[]>();
  for (const r of cand) (count.get(r.site!) ?? count.set(r.site!, []).get(r.site!)!).push(r);
  const pos = (id: number) => { const b = s.buildings.find((x) => x.id === id); return b ? queue(b) : 0; };
  let donor = -1;
  for (const [id, list] of count) {
    const best = count.get(donor);
    if (!best || list.length > best.length || (list.length === best.length && pos(id) > pos(donor))) donor = id;
  }
  const list = count.get(donor)!;
  const unpinned = list.filter((r) => !r.pinned);
  return { rover: nearest(s, unpinned.length ? unpinned : list, cx, cz), from: donor, reason: '' };
}

/** Summon: pin the nearest free rover here, or else one from the site with the most. */
export function summonRover(s: GameState, siteId: number): ActionResult & { rover?: number; from?: number | null } {
  const p = summonPick(s, siteId);
  if (!p.rover) return no(p.reason);
  pinTo(s, p.rover, s.buildings.find((b) => b.id === siteId)!);
  return { ok: true, reason: '', rover: p.rover.id, from: p.from };
}

/** Release: unpin one rover here (the last one pinned in roster order); it goes back to auto. */
export function releaseRover(s: GameState, siteId: number): ActionResult & { rover?: number } {
  const pinned = roversAt(s, siteId).filter((r) => r.pinned);
  if (!pinned.length) return no('NOTHING TO RELEASE — no rover is pinned to this site');
  const r = pinned[pinned.length - 1];
  r.pinned = false;
  r.site = null;
  return { ok: true, reason: '', rover: r.id };
}

/** Why rover `roverId` cannot be sent to `siteId` ('' = it can). */
export function sendRefusal(s: GameState, roverId: number, siteId: number): string {
  const r = s.rovers.find((x) => x.id === roverId);
  if (!r) return 'NO SUCH ROVER';
  if (r.id === surveyRover(s)) return 'OUT ON A SURVEY — it comes back when the survey ends';
  const site = siteFor(s, siteId);
  if (typeof site === 'string') return site;
  if (r.site === siteId && r.pinned) return `ALREADY THERE — rover #${r.id} is pinned to ${label(site)}`;
  return '';
}

/** Send a selected rover to a construction site and pin it there. */
export function sendRover(s: GameState, roverId: number, siteId: number): ActionResult {
  const why = sendRefusal(s, roverId, siteId);
  if (why) return no(why);
  pinTo(s, s.rovers.find((x) => x.id === roverId)!, s.buildings.find((b) => b.id === siteId)!);
  return OK;
}

/** A rover's pin let go from its own inspector: back to auto. */
export function unpinRover(s: GameState, roverId: number): ActionResult {
  const r = s.rovers.find((x) => x.id === roverId);
  if (!r) return no('NO SUCH ROVER');
  if (!r.pinned) return no(`NOT PINNED — rover #${r.id} already goes where it is needed`);
  r.pinned = false;
  r.site = null;
  return OK;
}

// ─────────────── drones (docs/14 §4.3): the Drone Hive's units fly ───────────────
// Additive: the roster, the assignments and every rule above are the same for
// both kinds. A unit docked at a Drone Hive is a drone: it flies straight to
// its work and back (world/rovers.ts), off the roads, and never enters the
// ground traffic; every other unit is a ground rover and keeps to the roads
// (docs/15). The sim has no travel time for either kind, so this is a
// classification only — deterministic, and pacing-neutral.

export type UnitKind = 'rover' | 'drone';

/** how a drone flies (the visuals): straight at `speed` m/s, cruising 6–10 m up */
export const DRONE = { speed: 6, accel: 3, climb: 2.5, cruiseMin: 6, cruiseMax: 10 };

/** The kind of a roster unit: a drone if its dock is a Drone Hive. */
export function unitKind(s: Pick<GameState, 'buildings'>, r: Pick<RoverUnit, 'home'>): UnitKind {
  const dock = s.buildings.find((b) => b.id === r.home);
  return dock?.type === 'droneHive' ? 'drone' : 'rover';
}
