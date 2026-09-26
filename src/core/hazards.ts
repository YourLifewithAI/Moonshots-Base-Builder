/** The hazards engine (docs/14 §3), pure over GameState: risk scores, the
 *  scheduler, the network graph, economy step 8.3 (`hazardTick`), counters,
 *  and the view the Hazards panel, the HUD chip, the markers and the probe
 *  read (`hazardView`).
 *
 *  ⌂ Colony faces the environment and can lose people; ◉ Automation faces
 *  the network and loses machines, data and stock for good. The fairness
 *  rules hold throughout: every hazard is telegraphed, names its target and
 *  carries its counters on its alert; kinds and targets are deterministic
 *  (only a window's timing is jittered, seeded like the flares); a death or
 *  a loss comes only when the telegraph ran out unanswered, or a counter
 *  failed or finished late, and always behind a visible clock; every lethal
 *  hazard has a free counter that saves the people, every destructive one a
 *  free counter that saves the machines; the first of each kind is a drill
 *  that cannot kill or destroy.
 *
 *  The economy calls the hooks below (hazardOff, hazardOutputMult,
 *  hazardDrawMult, sickCrew, evaHeld, growthHeld, hazardMorale,
 *  hazardUpkeepMult, killCrew, hazardDuskLine) and hazardTick as step 8.3. */
import { BUILDINGS, isCompute, type BuildingId } from '../data/buildings';
import { CREW, CROP_LOSS, CYCLE_S, DAY_S, DUSK_WARN_S, FLARE } from '../data/balance';
import { RESOURCES, type ResourceId } from '../data/resources';
import type { SiteDef } from '../data/sites';
import { TECHS, destinyCounts } from '../data/techs';
import { PROSPECTS, type ProspectId } from '../data/lunarMap';
import { FAMILY_LABEL, RULES, RULE_ORDER, type AutoRuleId } from '../data/automation';
import {
  COUNTERS, GUARD_FOR, GUARD_TEXT, HAZARDS, HAZARD_NAME, HAZARD_ORDER, HAZARDS_LIVE, HAZARD_SIDE, HZ, NETWORK_NODES,
  PRESSURIZED, TIER_LABEL, type CounterId, type GuardId, type HazardId, type HazardSide, type Tier,
} from '../data/hazards';
import type { AlertCounter, BuildingState, DeathRecord, GameState, LiveHazard, LossRecord, RoverUnit } from './state';
import { effectiveDef, unmanned, type Mods } from './mods';
import { alert, condition, landerAction } from './economy';
import { fmtClock, type DayInfo } from './daynight';
import { mulberry32 } from './rng';
import { dropSpur } from './roads';
import { isDrone as fleetIsDrone } from './fleet';
import { buildCostAt, freezeRules, logAuto, postIncidentAudit, ruleBuilding, runawaySite, type AutoRequest } from './automation';
import { centerOf } from '../buildings/instances';

// ─────────────────────────── helpers ───────────────────────────

const isSite = (b: { construction?: number }) => (b.construction ?? 0) > 0;
const complete = (b: { construction?: number }) => !isSite(b);
const label = (b: BuildingState) => `${BUILDINGS[b.type].name} #${b.id}`;
const byId = (s: GameState, id: number | null | undefined) => (id == null ? undefined : s.buildings.find((b) => b.id === id));
const dist = (a: BuildingState, b: BuildingState) => {
  const [ax, az] = centerOf(a), [bx, bz] = centerOf(b);
  return Math.hypot(ax - bx, az - bz);
};
const glyph = (r: ResourceId) => RESOURCES[r].glyph;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const SIDE_GLYPH: Record<HazardSide, string> = { colony: '⌂', automation: '◉' };
/** a building's evacuation that lasts until it is sealed (JSON has no Infinity) */
const UNTIL_SEALED = 1e12;

const guard = (mods: Mods, g: GuardId) => mods.guards.has(g);
const done = (s: GameState, t: string) => s.techsDone.includes(t as never);

/** Nothing hazardous yet: the hooks do nothing (and old saves before a fill) */
const off = (s: GameState) => !HAZARDS_LIVE || !s.hazards;

// ─────────────────────────── sides and tiers (§3.2) ───────────────────────────

/** Picks per side, the landing included. */
export function sidePicks(s: Pick<GameState, 'techsDone'>): Record<HazardSide, number> {
  const d = destinyCounts(s.techsDone);
  return { colony: d.c, automation: d.a };
}

/** A side's tier by its picks (2–3 minor · 4–5 moderate · 6–8 major), or
 *  null with 0–1 picks: no hazards at all. The capstones pin their side at major. */
export function sideTier(s: GameState, side: HazardSide): Tier | null {
  const p = sidePicks(s)[side];
  if (p < 2) return null;
  if (side === 'colony' && done(s, 'commonwealth')) return 2;
  if (side === 'automation' && done(s, 'selenicMind')) return 2;
  return p >= 6 ? 2 : p >= 4 ? 1 : 0;
}

/** The scheduler has started: Era 3 open for a lunar day, past a loaded save's grace. */
export function hazardsStarted(s: GameState): boolean {
  const hz = s.hazards;
  if (off(s) || hz.hold || hz.era3At === null) return false;
  return s.simTime >= Math.max(hz.era3At + HZ.startDelayS, hz.graceUntil);
}

/** When the scheduler starts (game time), or null before Era 3. */
export function hazardsStartAt(s: GameState): number | null {
  const hz = s.hazards;
  if (off(s) || hz.era3At === null) return null;
  return Math.max(hz.era3At + HZ.startDelayS, hz.graceUntil);
}

const liveOn = (s: GameState, side: HazardSide, cls?: 'window') =>
  s.hazards.live.some((h) => h.side === side && (!cls || HAZARDS[h.kind].cls === 'window'));

// ─────────────────────────── people (§3.4) ───────────────────────────

/** Pressurized types: the stock ones plus what `exposure: breach` adds (Pressure-Rated Halls). */
export function pressurizedTypes(mods: Mods): Set<BuildingId> {
  const out = new Set<BuildingId>(PRESSURIZED);
  for (const b of mods.exposure.get('breach') ?? []) out.add(b);
  return out;
}

const evacuated = (s: GameState, b: BuildingState) => (b.evacT ?? 0) > s.simTime;
/** housing that counts beds now: complete, enabled, not evacuated, breached or decompressed */
function bedsNow(s: GameState, mods: Mods, b: BuildingState): number {
  const h = effectiveDef(b.type, mods).housing ?? 0;
  if (!h || !b.enabled || isSite(b) || evacuated(s, b) || b.breached || b.decompressed) return 0;
  return h;
}

/** Crew breathing suit air (they have no bed): not in any building. */
export const suitCrew = (s: GameState) => (s.hazards?.suit ?? []).reduce((n, x) => n + x.n, 0);

/** Where the crew is: the homes' share by beds (largest remainder, ties by
 *  id) — the Lander, the lifeboat, takes whoever the homes cannot hold —
 *  and each crewed pressurized station's seats while they work. */
export function occupancy(s: GameState, mods: Mods): Map<number, number> {
  const out = new Map<number, number>();
  let aboard = Math.max(0, s.crew - suitCrew(s));
  const homes = s.buildings.filter((b) => b.type !== 'lander').map((b) => ({ b, beds: bedsNow(s, mods, b) })).filter((x) => x.beds > 0);
  const total = homes.reduce((n, x) => n + x.beds, 0);
  const lander = s.buildings.find((b) => b.type === 'lander');
  if (lander && aboard > total) { out.set(lander.id, aboard - total); aboard = total; }
  if (total > 0 && aboard > 0) {
    const raw = homes.map((x) => ({ id: x.b.id, q: (aboard * x.beds) / total }));
    let left = aboard;
    for (const r of raw) { const n = Math.floor(r.q); out.set(r.id, n); left -= n; }
    for (const r of [...raw].sort((a, b) => (b.q % 1) - (a.q % 1) || a.id - b.id)) {
      if (left <= 0) break;
      out.set(r.id, (out.get(r.id) ?? 0) + 1);
      left--;
    }
  }
  // a crewed station holds its crew while they work (labs, fabs, bays under Pressure-Rated Halls)
  for (const b of s.buildings) {
    if (out.has(b.id) || isSite(b) || !b.enabled || b.automated || unmanned(s)) continue;
    const seats = Math.max(0, BUILDINGS[b.type].crew + (mods.crewDelta[b.type] ?? 0));
    if (seats > 0 && b.idleReason !== 'crew' && b.idleReason !== 'hazard' && b.idleReason !== 'strike') out.set(b.id, seats);
  }
  return out;
}

/** Free beds anywhere now (beds less the crew with a bed). */
function freeBeds(s: GameState, mods: Mods): number {
  let beds = 0;
  for (const b of s.buildings) {
    const n = bedsNow(s, mods, b);
    if (n && (effectiveDef(b.type, mods).powerKW >= 0 || b.idleReason !== 'power')) beds += n;
  }
  return beds - Math.max(0, s.crew - suitCrew(s));
}

// ─────────────────────────── the network (§3.5) ───────────────────────────

export interface NetNode { id: number; type: BuildingId; name: string; x: number; z: number; links: number[]; infected: boolean; gapped: boolean }
export interface NetGraph { nodes: NetNode[]; byId: Map<number, NetNode> }

const agentStation = (s: GameState, b: BuildingState) => BUILDINGS[b.type].crew > 0 && (b.automated || unmanned(s));

/** Nodes: the Lander, masts, compute, bays and hives, the types the
 *  exposures add, and every agent-run station while ◉ picks ≥ 2. Two link
 *  within 45 m, or 60 m if either is a Monolith or a Relay Mast; an
 *  air-gapped node has none. */
export function networkGraph(s: GameState, mods: Mods): NetGraph {
  const types = new Set<BuildingId>(NETWORK_NODES);
  for (const b of mods.exposure.get('malware') ?? []) types.add(b);
  const agents = sidePicks(s).automation >= 2;
  const nodes: NetNode[] = [];
  for (const b of s.buildings) {
    if (isSite(b) || b.junk) continue;
    if (!types.has(b.type) && !(agents && agentStation(s, b))) continue;
    const [x, z] = centerOf(b);
    nodes.push({ id: b.id, type: b.type, name: label(b), x, z, links: [], infected: !!b.infected, gapped: !!b.airGapped });
  }
  const hub = (t: BuildingId) => t === 'serverMonolith' || t === 'relayMast';
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    if (a.gapped) continue;
    for (let j = i + 1; j < nodes.length; j++) {
      const c = nodes[j];
      if (c.gapped) continue;
      const r = hub(a.type) || hub(c.type) ? HZ.malware.hubM : HZ.malware.linkM;
      if (Math.hypot(a.x - c.x, a.z - c.z) <= r) { a.links.push(c.id); c.links.push(a.id); }
    }
  }
  return { nodes, byId: new Map(nodes.map((n) => [n.id, n])) };
}

/** a clean compute building that ran this tick */
const computeRunning = (s: GameState) => s.buildings.filter((b) => isCompute(b.type) && b.active && !b.infected && !((b.reimageUntil ?? 0) > s.simTime));

// ─────────────────────────── risk scores (§3.4, §3.5) ───────────────────────────

interface KindPick { risk: number; target: number | null; name: string; outpost?: ProspectId; rule?: AutoRuleId }
const NONE: KindPick = { risk: -1, target: null, name: '' };

function breachPick(s: GameState, mods: Mods): KindPick {
  const types = pressurizedTypes(mods);
  const halls = mods.exposure.get('breach') ?? new Set<BuildingId>();
  const pitting = HZ.breach.pitting * (guard(mods, 'micrometeoriteShield') ? 0.5 : 1);
  let best: KindPick = NONE;
  for (const b of s.buildings) {
    if (!types.has(b.type) || isSite(b) || !b.enabled || b.breached || b.decompressed) continue;
    // people aboard, except halls that hold air anyway
    if (s.crew <= 0 && !halls.has(b.type)) continue;
    const risk = Math.min(1, HZ.breach.wearK * b.wear + pitting);
    if (risk > best.risk) best = { risk, target: b.id, name: label(b) };
  }
  return best;
}

const FARM_W: Partial<Record<BuildingId, number>> = { hydroponics: 1, greenhouseRing: 3 };
const farmsNow = (s: GameState) => s.buildings.filter((b) => FARM_W[b.type] && complete(b) && b.enabled);

function blightPick(s: GameState, mods: Mods): KindPick {
  if (s.crew <= 0) return NONE;
  const farms = farmsNow(s).filter((b) => !((b.blightUntil ?? 0) > s.simTime));
  if (farms.reduce((n, b) => n + FARM_W[b.type]!, 0) < 2) return NONE;
  // clusters within 24 m
  const parent = new Map(farms.map((b) => [b.id, b.id]));
  const find = (x: number): number => (parent.get(x) === x ? x : find(parent.get(x)!));
  for (let i = 0; i < farms.length; i++) {
    for (let j = i + 1; j < farms.length; j++) {
      if (dist(farms[i], farms[j]) <= HZ.blight.clusterM) parent.set(find(farms[i].id), find(farms[j].id));
    }
  }
  const weight = new Map<number, number>();
  for (const b of farms) weight.set(find(b.id), (weight.get(find(b.id)) ?? 0) + FARM_W[b.type]!);
  let root = -1, w = 0;
  for (const [r, n] of weight) if (n > w || (n === w && r < root)) { root = r; w = n; }
  const members = farms.filter((b) => find(b.id) === root);
  const neighbours = (b: BuildingState) => farms.filter((o) => o.id !== b.id && dist(o, b) <= HZ.blight.clusterM).length;
  const target = members.sort((a, b) => neighbours(b) - neighbours(a) || FARM_W[b.type]! - FARM_W[a.type]! || a.id - b.id)[0];
  const commons = (mods.exposure.has('blight') && done(s, 'hydroCommons')) ? HZ.blight.commons : 1;
  return { risk: Math.min(1, ((w - 1) / 4) * commons), target: target.id, name: label(target) };
}

/** the water loop's sources: ice ×1, volatiles ×0.8, smelter ×0.5 (a second source dilutes) */
function waterSource(s: GameState, mods: Mods): number {
  const kinds = new Set<'ice' | 'volatiles' | 'smelter'>();
  for (const b of s.buildings) {
    if (isSite(b) || !b.enabled) continue;
    const w = effectiveDef(b.type, mods).outputs.water ?? 0;
    if (w <= 0) continue;
    if (b.type === 'iceHarvester') kinds.add('ice');
    else if (b.type === 'excavator') kinds.add('volatiles');
    else if (b.type === 'smelter') kinds.add('smelter');
  }
  if (!kinds.size) return 0;
  const f = Math.max(...[...kinds].map((k) => HZ.contamination.source[k]));
  return f / kinds.size;
}

function contaminationPick(s: GameState, mods: Mods): KindPick {
  if (s.crew <= 0) return NONE;
  const src = waterSource(s, mods);
  if (src <= 0) return NONE;
  const trap = done(s, 'btColdTrapChemistry') ? HZ.contamination.coldTrap : 1;
  return { risk: Math.min(1, (s.hazards.loopAge / 3) * src * trap), target: null, name: 'the water loop' };
}

function malwarePick(s: GameState, mods: Mods, g = networkGraph(s, mods)): KindPick {
  if (s.hazards.immuneUntil > s.simTime) return { risk: 0, target: null, name: 'the network' };
  const gates = g.nodes.filter((n) => !n.gapped && !n.infected && (n.type === 'lander' || n.type === 'relayMast'));
  if (!gates.length) return { risk: 0, target: null, name: 'the network' };
  const entry = [...gates].sort((a, b) => b.links.length - a.links.length ||
    Number(b.type === 'lander') - Number(a.type === 'lander') || a.id - b.id)[0];
  const exposed = g.nodes.filter((n) => !n.gapped).length;
  const cut = (guard(mods, 'intrusionDetection') ? 0.3 : 0) + (guard(mods, 'watchdogs') ? 0.2 : 0);
  const since = s.simTime - s.hazards.downlinkAt;
  const chain = since >= 0 && since < CYCLE_S ? HZ.malware.supplyChain : 0;
  return { risk: Math.min(1, (exposed / HZ.malware.nodesPerRisk) * (1 - cut) + chain), target: entry.id, name: entry.name };
}

const roversUp = (s: GameState) => s.rovers.filter((r) => !((r.brickedUntil ?? 0) > 0));

function firmwarePick(s: GameState, mods: Mods): KindPick {
  const n = roversUp(s).length;
  if (n < HZ.firmware.minRovers) return NONE;
  if (guard(mods, 'signedFirmware')) return { risk: 0, target: null, name: 'the fleet' };
  return { risk: Math.min(1, n / 12), target: null, name: 'the fleet' };
}

const DOCK_TYPES: readonly BuildingId[] = ['roboticsBay', 'droneHive'];
/** what rogue drones may strip: priority 2–3, never life support, power or the Lander */
const strippable = (b: BuildingState) => complete(b) && !b.junk && b.priority >= 2 && b.type !== 'lander' &&
  BUILDINGS[b.type].category !== 'life' && BUILDINGS[b.type].category !== 'power' && !DOCK_TYPES.includes(b.type);

function rogueDock(s: GameState, tier: Tier): BuildingState | null {
  const docks = s.buildings.filter((b) => DOCK_TYPES.includes(b.type) && complete(b));
  const infected = docks.filter((b) => b.infected).sort((a, b) => a.id - b.id)[0];
  if (infected) return infected;
  if (tier < 2) return null;
  const rovers = (b: BuildingState) => s.rovers.filter((r) => r.home === b.id).length;
  return docks.sort((a, b) => Number(b.type === 'droneHive') - Number(a.type === 'droneHive') || rovers(b) - rovers(a) || a.id - b.id)[0] ?? null;
}

function rogueTarget(s: GameState, dock: BuildingState, skip: number[] = []): BuildingState | null {
  let best: BuildingState | null = null, bd = Infinity;
  for (const b of s.buildings) {
    if (!strippable(b) || skip.includes(b.id) || b.stripT) continue;
    const d = dist(b, dock);
    if (d <= HZ.rogueDrones.rangeM && (d < bd || (d === bd && best && b.id < best.id))) { best = b; bd = d; }
  }
  return best;
}

function roguePick(s: GameState, tier: Tier): KindPick {
  const dock = rogueDock(s, tier);
  if (!dock) return NONE;
  const t = rogueTarget(s, dock);
  if (!t) return NONE;
  return { risk: dock.infected ? 0.9 : 0.4, target: t.id, name: `${label(dock)} → ${label(t)}`, rule: undefined };
}

function runawayPick(s: GameState, mods: Mods): KindPick {
  if (sidePicks(s).automation < 4) return NONE;
  const on = RULE_ORDER.filter((id) => id !== 'replace' && s.auto.rules[id]?.on && mods.autoFamilies.has(RULES[id].family) &&
    ruleBuilding(s, mods, id) && mods.unlocked.has(ruleBuilding(s, mods, id)!));
  if (!on.length) return NONE;
  const rule = [...on].sort((a, b) => (s.auto.rules[b]!.built - s.auto.rules[a]!.built) || RULE_ORDER.indexOf(a) - RULE_ORDER.indexOf(b))[0];
  const mult = done(s, 'replicatorStacks') ? HZ.runaway.replicator : 1;
  return { risk: Math.min(1, 0.12 * on.length * mult), target: null, name: `the ${FAMILY_LABEL[RULES[rule].family]} rule`, rule };
}

function outpostPick(s: GameState): KindPick {
  const live = s.survey.outposts.filter((o) => o.live && !o.hacked);
  if (!live.length) return NONE;
  const o = live[0];
  return { risk: Math.min(1, live.length / 3), target: null, name: PROSPECTS[o.id]?.short ?? o.id, outpost: o.id };
}

/** One window kind's risk and target now (−1 = not eligible). */
export function kindPick(s: GameState, mods: Mods, kind: HazardId, tier: Tier): KindPick {
  if (tier < HAZARDS[kind].minTier) return NONE;
  switch (kind) {
    case 'breach': return breachPick(s, mods);
    case 'blight': return blightPick(s, mods);
    case 'contamination': return contaminationPick(s, mods);
    case 'malware': return malwarePick(s, mods);
    case 'firmware': return firmwarePick(s, mods);
    case 'rogueDrones': return roguePick(s, tier);
    case 'runaway': return runawayPick(s, mods);
    case 'hackedOutpost': return outpostPick(s);
    default: return NONE;
  }
}

const WINDOW_KINDS: Record<HazardSide, HazardId[]> = {
  colony: HAZARD_ORDER.filter((k) => HAZARD_SIDE[k] === 'colony' && HAZARDS[k].cls === 'window'),
  automation: HAZARD_ORDER.filter((k) => HAZARD_SIDE[k] === 'automation' && HAZARDS[k].cls === 'window'),
};

/** The window kind a side would face now: the highest risk (a kind that
 *  fired the side's last window counts half), ties in table order. */
export function chooseKind(s: GameState, mods: Mods, side: HazardSide, tier: Tier): { kind: HazardId; pick: KindPick } | null {
  let out: { kind: HazardId; pick: KindPick; score: number } | null = null;
  for (const kind of WINDOW_KINDS[side]) {
    const p = kindPick(s, mods, kind, tier);
    if (p.risk < 0) continue;
    const score = p.risk * (s.hazards.lastKind[side] === kind ? HZ.repeatMult : 1);
    if (!out || score > out.score) out = { kind, pick: { ...p, risk: score }, score };
  }
  return out ? { kind: out.kind, pick: out.pick } : null;
}

// ─────────────────────────── the scheduler (§3.2) ───────────────────────────

const structures = (s: GameState) => s.buildings.filter(complete).length;

/** The next window's interval, game-seconds (n: the window's index, for its jitter). */
export function windowInterval(s: GameState, mods: Mods, n: number): number {
  const era = Math.min(8, Math.max(3, s.era));
  const size = Math.min(HZ.sizeClamp[1], Math.max(HZ.sizeClamp[0], HZ.sizeBase / Math.max(1, structures(s))));
  const jitter = (mulberry32((s.seed ^ 0x4a2d) + n)() - 0.5) * 2 * HZ.jitterDays;
  return Math.max(0.25, HZ.intervalDays[era] * size / Math.max(0.05, mods.hazardRateMult) + jitter) * CYCLE_S;
}

/** a flare's active phase within 240 s of a hazard opening in `tg` s, or 90 s after one, holds a window */
function flareBlocks(s: GameState, tg: number): boolean {
  if (s.flare.phase !== 'idle') return true;
  if (s.simTime - s.hazards.flareEndAt < HZ.flareGapS) return true;
  if (!s.flare.nextAt) return false;
  const nextActive = s.flare.nextAt + FLARE.telegraphS;
  return nextActive > s.simTime && Math.abs(nextActive - (s.simTime + tg)) < HZ.gapS;
}

/** The side round-robin (§3.2): each window, every side with ≥ 2 picks gains
 *  its share of the picks in credit; the most credit fires (ties to Colony)
 *  and pays 1. 7–1 is all Colony, 6–2 three in four, 4–4 alternates. */
export function nextSide(credit: Record<HazardSide, number>, picks: Record<HazardSide, number>, sides: HazardSide[]):
  { side: HazardSide; credit: Record<HazardSide, number> } {
  const total = sides.reduce((n, x) => n + picks[x], 0);
  const c = { ...credit };
  for (const x of sides) c[x] += picks[x] / total;
  const side = sides.reduce((m, x) => (c[x] > c[m] ? x : m), sides.includes('colony') ? 'colony' : sides[0]);
  c[side] -= 1;
  return { side, credit: c };
}

function schedulerTick(s: GameState, mods: Mods, site: SiteDef) {
  const hz = s.hazards;
  const now = s.simTime;
  const sides = (['colony', 'automation'] as HazardSide[]).filter((x) => sideTier(s, x) !== null);
  if (!hz.nextAt) hz.nextAt = now; // the first window comes as soon as the scheduler starts
  if (now < hz.nextAt) return;
  if (!sides.length) { hz.nextAt = now + windowInterval(s, mods, hz.windows); return; }
  const { side, credit } = nextSide(hz.credit, sidePicks(s), sides);
  const tier = sideTier(s, side)!;
  // one live hazard a side, 240 s between hazards, and clear of the flare: the window waits
  if (liveOn(s, side) || now - hz.lastStartAt < HZ.gapS || flareBlocks(s, HZ.telegraphS[tier])) return;
  hz.credit = credit;
  hz.windows += 1;
  hz.nextAt = now + windowInterval(s, mods, hz.windows);
  const ch = chooseKind(s, mods, side, tier);
  if (!ch || ch.pick.risk < HZ.nearMiss) {
    const kind = ch?.kind ?? WINDOW_KINDS[side][0];
    hz.lastKind[side] = kind;
    const t = ch?.pick.name || 'the base';
    const text = HAZARDS[kind].nearMiss.replace('{t}', t);
    logHazard(s, { at: now, id: 0, kind, tier, drill: false, target: t, outcome: `near miss: ${text}` });
    alert(s, `${SIDE_GLYPH[side]} ${text}`, 'info');
    return;
  }
  hz.lastKind[side] = ch.kind;
  startHazard(s, mods, site, ch.kind, { pick: ch.pick, tier });
}

// ─────────────────────────── starting a hazard ───────────────────────────

export interface StartOpts {
  target?: number;
  tier?: Tier;
  drill?: boolean;
  flare?: boolean;
  /** the pick already made by the scheduler */
  pick?: KindPick;
  /** the deadline, when the kind sets its own (events, flares) */
  at?: number;
}

/** The telegraph of a kind at a tier (Safety Protocols, Intrusion detection, the drill). */
export function telegraphS(mods: Mods, kind: HazardId, tier: Tier, drill: boolean): number {
  let t = HZ.telegraphS[tier];
  if (HAZARD_SIDE[kind] === 'colony' && guard(mods, 'safety')) t *= HZ.safetyMult;
  if (kind === 'malware' && guard(mods, 'intrusionDetection')) t *= HZ.malware.detectMult;
  return Math.round(t + (drill ? HZ.drillExtraS : 0));
}

/** Start a hazard now (the scheduler, an event, a flare, or debug.forceHazard).
 *  Returns it, or why it cannot start. */
export function startHazard(s: GameState, mods: Mods, site: SiteDef, kind: HazardId, o: StartOpts = {}): LiveHazard | string {
  const hz = s.hazards;
  const def = HAZARDS[kind];
  const side = def.side;
  const drill = o.drill ?? !hz.drilled.includes(kind);
  const sideT = o.tier ?? sideTier(s, side) ?? 0;
  // a drill runs at the kind's lowest tier
  const tier = (drill ? def.minTier : Math.max(def.minTier, sideT)) as Tier;
  let pick = o.pick ?? (def.cls === 'window' ? kindPick(s, mods, kind, tier) : { risk: 1, target: null, name: '' });
  if (o.target !== undefined) {
    const b = byId(s, o.target);
    if (b) pick = { ...pick, target: b.id, name: kind === 'rogueDrones' ? pick.name : label(b) };
  }
  if (def.cls === 'window' && pick.risk < 0 && o.target === undefined) return `${HAZARD_NAME[kind]} has nothing to strike here`;
  const now = s.simTime;
  const h: LiveHazard = {
    id: hz.nextId++, kind, side, tier, drill, phase: 'telegraph', warnedAt: now,
    at: o.at ?? now + telegraphS(mods, kind, tier, drill),
    target: pick.target, targetName: pick.name || HAZARD_NAME[kind], hit: [], clockAt: 0, clockText: '', used: {}, n: {},
  };
  if (o.flare) h.flare = true;
  if (pick.outpost) h.outpost = pick.outpost;
  if (kind === 'runaway' && pick.rule) h.n.rule = RULE_ORDER.indexOf(pick.rule);
  if (kind === 'rogueDrones') {
    const dock = o.target !== undefined ? rogueDock(s, 2) : rogueDock(s, tier);
    const t = o.target !== undefined ? byId(s, o.target) : dock ? rogueTarget(s, dock) : null;
    if (!dock || !t) return 'ROGUE DRONES need a Robotics Bay or Drone Hive with something to strip within 60 m';
    h.n.dock = dock.id;
    h.target = t.id;
    h.targetName = label(t);
  }
  if (kind === 'breach') {
    const b = byId(s, h.target);
    if (!b) return 'BREACH needs a pressurized building';
    h.n.occupants = occupancy(s, mods).get(b.id) ?? 0;
  }
  if (kind === 'blight' && h.target !== null) h.hit = [h.target];
  hz.live.push(h);
  hz.lastStartAt = now;
  if (drill && !hz.drilled.includes(kind)) hz.drilled.push(kind);
  alert(s, `${SIDE_GLYPH[side]} ${drill ? 'DRILL — ' : ''}${HAZARD_NAME[kind]} WARNING — ${h.targetName}` +
    ` · ${TIER_LABEL[tier]} · ${fmtClock(Math.max(0, h.at - now))} to act`, def.lethal || def.destroys ? 'warn' : 'info',
  h.target !== null ? { select: h.target } : undefined);
  return h;
}

function logHazard(s: GameState, e: GameState['hazards']['log'][number]) {
  s.hazards.log.push(e);
  if (s.hazards.log.length > HZ.logMax) s.hazards.log.splice(0, s.hazards.log.length - HZ.logMax);
}

function endHazard(s: GameState, h: LiveHazard, outcome: string) {
  s.hazards.live = s.hazards.live.filter((x) => x.id !== h.id);
  logHazard(s, { at: s.simTime, id: h.id, kind: h.kind, tier: h.tier, drill: h.drill, target: h.targetName, outcome });
  if (h.drill) alert(s, `DRILL OVER — ${HAZARD_NAME[h.kind]}: ${HAZARDS[h.kind].drillNext}`, 'info');
}

// ─────────────────────────── deaths, losses, wrecks (§3.10) ───────────────────────────

const ago = (s: GameState, t: number | null) => (t === null ? '' : ` · warned ${fmtClock(Math.round(Math.max(0, s.simTime - t)))} before`);

/** A death through CREW LOST, with its cause: −15 morale at once, grief −10
 *  on the target for a lunar day (to −30), growth paused (the grief). */
export function killCrew(s: GameState, n: number, cause: string, hazard: HazardId | null, warnedAt: number | null, why = '',
  action?: GameState['alerts'][number]['action']) {
  for (let i = 0; i < n && s.crew > 0; i++) {
    s.crew -= 1;
    s.morale = Math.max(0, s.morale - HZ.grief.now);
    const rec: DeathRecord = { at: s.simTime, cause, hazard, warnedAt };
    (s.deaths ??= []).push(rec);
    (s.grief ??= []).push({ until: s.simTime + HZ.grief.s, amount: HZ.grief.morale });
    alert(s, `CREW LOST — ${cause}${ago(s, warnedAt)}${why ? `; ${why}` : ''}`, 'crit', action ?? { panel: 'crew' });
  }
}

/** A machine loss, logged like a death, then the post-incident audit. */
export function recordLoss(s: GameState, mods: Mods, rec: Omit<LossRecord, 'at'>, head: string, why: string, type?: BuildingId,
  action?: GameState['alerts'][number]['action']) {
  (s.losses ??= []).push({ ...rec, at: s.simTime });
  alert(s, `${head} — ${rec.cause}${ago(s, rec.warnedAt)}${why ? `; ${why}` : ''}`, 'crit', action);
  postIncidentAudit(s, mods, type);
}

/** Remove a building for good: no refund, nothing salvaged. Game refreshes the world. */
export function wreckBuilding(s: GameState, id: number, wrecked: number[]) {
  const i = s.buildings.findIndex((b) => b.id === id);
  if (i < 0 || s.buildings[i].type === 'lander') return;
  const b = s.buildings[i];
  dropSpur(s, b);
  s.buildings.splice(i, 1);
  for (const r of s.rovers) if (r.site === id) { r.site = null; r.pinned = false; }
  wrecked.push(id);
}

/** a drone: fleet.ts's unit kind (tagged one, or docked at a Drone Hive) — one source of truth */
export const isDrone = (s: GameState, r: RoverUnit) => fleetIsDrone(s, r);
const away = (r: RoverUnit) => r.site !== null || r.road !== undefined;

/** A rover lost for good: its dock slot stays empty until the dock prints another. */
function loseRover(s: GameState, mods: Mods, r: RoverUnit, cause: string, h: LiveHazard, why: string) {
  const dock = byId(s, r.home);
  if (dock) dock.slotsLost = (dock.slotsLost ?? 0) + 1;
  s.rovers = s.rovers.filter((x) => x.id !== r.id);
  const drone = dock?.type === 'droneHive';
  recordLoss(s, mods, {
    what: drone ? 'drone' : 'rover', name: `${drone ? 'drone' : 'rover'} #${r.id}`, cause, hazard: h.kind, warnedAt: h.warnedAt,
  }, drone ? 'DRONE LOST' : 'ROVER LOST', why + (dock ? ` · ${label(dock)} prints a replacement` : ''), undefined, dock ? { select: dock.id } : undefined);
}

// ─────────────────────────── economy hooks ───────────────────────────

/** Why a hazard holds a building offline ('' = it runs). Economy steps 2–5. */
export function hazardOff(s: GameState, b: BuildingState): string {
  if (off(s)) return '';
  const now = s.simTime;
  if (b.junk) return 'JUNK — a drifting rule’s site: wrong firmware, it never commissions';
  if (b.breached) return 'BREACHED — venting until sealed';
  if (b.decompressed) return 'DECOMPRESSED — offline until repaired (30⚙)';
  if ((b.evacT ?? 0) > now && BUILDINGS[b.type].crew > 0) return 'EVACUATED';
  if (b.stripT) return 'STRIPPED — rogue drones at work';
  if ((b.reimageUntil ?? 0) > now) return `REIMAGING — back in ${fmtClock(b.reimageUntil! - now)}`;
  if ((b.killUntil ?? 0) > now) return `KILL SWITCH — offline ${fmtClock(b.killUntil! - now)}`;
  if ((b.strikeUntil ?? 0) > now) return `ON STRIKE — cabin fever, ${fmtClock(b.strikeUntil! - now)}`;
  if (b.airGapped && agentStation(s, b)) return 'AIR-GAPPED — an agent-run station idles unless crewed';
  if (s.hazards.shedUntil > now && b.priority >= 2 && effectiveDefPower(b) < 0) return `LOADS SHED — ${fmtClock(s.hazards.shedUntil - now)}`;
  return '';
}
const effectiveDefPower = (b: BuildingState) => BUILDINGS[b.type].powerKW;

/** A home's beds are off: evacuated, breached or decompressed (economy step 5). */
export function hazardBedsOff(s: GameState, b: BuildingState): boolean {
  return !off(s) && ((b.evacT ?? 0) > s.simTime || !!b.breached || !!b.decompressed);
}

/** Output (and data) multiplier from infections, blight, a fouled loop and a dropped control plane. */
export function hazardOutputMult(s: GameState, b: BuildingState): number {
  if (off(s)) return 1;
  let m = 1;
  if (b.infected) m *= HZ.malware.output;
  if ((b.blightUntil ?? 0) > s.simTime) {
    const h = s.hazards.live.find((x) => x.kind === 'blight' && x.hit.includes(b.id));
    m *= HZ.blight.output[h?.tier ?? 0];
  }
  const cont = s.hazards.live.find((x) => x.kind === 'contamination' && x.phase === 'active');
  if (cont && (FARM_W[b.type] || b.type === 'gardenDome')) m *= HZ.contamination.output[cont.tier];
  const cp = s.hazards.live.find((x) => x.kind === 'controlPlane' && x.phase === 'active');
  if (cp && agentStation(s, b)) m *= HZ.controlPlane.output[cp.tier];
  return m;
}

/** An infected node's phantom load: ×1.3 draw. */
export const hazardDrawMult = (s: GameState, b: BuildingState) => (!off(s) && b.infected ? HZ.malware.draw : 1);

/** Crew off work: dosed or in the sick bay. */
export function sickCrew(s: GameState): number {
  if (off(s)) return 0;
  return Math.min(s.crew, s.hazards.sick.filter((x) => x.until > s.simTime).reduce((n, x) => n + x.n, 0));
}

/** EVA held indoors: a recall for the flare, or storm shelters on its telegraph. */
export function evaHeld(s: GameState, mods: Mods): boolean {
  if (off(s)) return false;
  if (s.hazards.live.some((h) => h.kind === 'dose' && h.used.recallEva !== undefined)) return true;
  return guard(mods, 'stormShelters') && s.flare.phase !== 'idle';
}

/** Grief: no one wants to come for a lunar day after a death. */
export const growthHeld = (s: GameState) => !off(s) && (s.grief ?? []).some((g) => g.until > s.simTime);

/** Morale target: grief (−10 a death, to −30), a cabin-fever crisis, a boil-water notice. */
export function hazardMorale(s: GameState): number {
  if (off(s)) return 0;
  const grief = Math.min(HZ.grief.max, (s.grief ?? []).filter((g) => g.until > s.simTime).reduce((n, g) => n + g.amount, 0));
  let m = -grief;
  if (s.hazards.crisisUntil > s.simTime) m -= HZ.cabinFever.morale;
  const cont = s.hazards.live.find((x) => x.kind === 'contamination' && x.phase === 'active');
  if (cont) m -= HZ.contamination.morale[cont.tier];
  return m;
}

/** Clogged airlock filters: upkeep ×2. */
export const hazardUpkeepMult = (s: GameState, b: BuildingState) => (!off(s) && (b.airlockDust ?? 0) >= 1 ? HZ.dust.clogUpkeep : 1);

/** Why a starving crew member died: the vented breach, the famine after a blight, or plain life support. */
export function starveCause(s: GameState, gone: 'oxygen' | 'water' | 'food'): { cause: string; hazard: HazardId | null; warnedAt: number | null } {
  if (!off(s)) {
    const vent = s.hazards.live.find((h) => h.kind === 'breach' && h.phase === 'active');
    if (gone === 'oxygen' && vent) return { cause: `suffocated: the O₂ vented through ${vent.targetName}`, hazard: 'breach', warnedAt: vent.warnedAt };
    const blight = [...s.hazards.log].reverse().find((e) => e.kind === 'blight' && s.simTime - e.at < 2 * CYCLE_S);
    const live = s.hazards.live.find((h) => h.kind === 'blight');
    if (gone === 'food' && (live || blight)) return { cause: 'famine after the blight', hazard: 'blight', warnedAt: live?.warnedAt ?? blight?.at ?? null };
  }
  return { cause: gone === 'oxygen' ? 'life support failure: no oxygen' : gone === 'water' ? 'life support failure: no water' : 'life support failure: no food', hazard: null, warnedAt: null };
}

/** The dusk forecast's hazard lines (economy step 2): the habitats or the
 *  Data Centers the bank will not carry through the night. */
export function hazardDuskLine(s: GameState, mods: Mods, nightSupply: number, runway: number, demandUpTo: (prio: number) => number):
  { text: string; counters: AlertCounter[] } | null {
  if (off(s) || !hazardsStarted(s) || runway === Infinity) return null;
  const parts: string[] = [];
  const counters: AlertCounter[] = [];
  if (sideTier(s, 'colony') !== null && s.crew > 0) {
    const homes = s.buildings.filter((b) => (b.type === 'habitat' || b.type === 'gardenDome') && complete(b) && b.enabled);
    const p = homes.length ? Math.min(...homes.map((b) => b.priority)) : -1;
    if (p >= 0 && nightSupply < demandUpTo(p)) {
      parts.push(`habitats go dark at ${fmtClock(runway)} — LIFE-SUPPORT CASCADE · people will need beds or suit air`);
      counters.push({ counter: 'shedLoads', label: 'Shed loads' });
    }
  }
  if (sideTier(s, 'automation') !== null && mods.exposure.has('controlPlane')) {
    const dcs = s.buildings.filter((b) => isCompute(b.type) && complete(b) && b.enabled);
    const p = dcs.length ? Math.min(...dcs.map((b) => b.priority)) : -1;
    if (p >= 0 && nightSupply < demandUpTo(p)) {
      parts.push(`the Data Centers go dark at ${fmtClock(runway)} — CONTROL PLANE · drones in flight will fall`);
      counters.push({ counter: 'landDrones', label: 'Land drones' });
    }
  }
  return parts.length ? { text: ` · ${parts.join(' · ')}`, counters } : null;
}

/** An alert's counter buttons (after condition()/alert() raised it). */
function withCounters(s: GameState, key: string, counters: AlertCounter[]) {
  const a = s.alerts.find((x) => x.key === key);
  if (a) a.counters = counters;
}
export function attachCounters(s: GameState, key: string, counters: AlertCounter[]) { withCounters(s, key, counters); }

// ─────────────────────────── step 8.3 ───────────────────────────

export interface HazardTickResult {
  /** buildings wrecked or removed this tick (Game refreshes the world) */
  wrecked: number[];
  /** a runaway rule's junk sites for Game to place */
  build: AutoRequest[];
  modsChanged: boolean;
}

/** Economy step 8.3: bookkeeping, the flare kinds, the event kinds, the
 *  meters, the scheduler, each live hazard, suit air, the fleet's re-flash
 *  and reprints, and every hazard's alert. */
export function hazardTick(s: GameState, site: SiteDef, mods: Mods, day: DayInfo, dt: number): HazardTickResult {
  const out: HazardTickResult = { wrecked: [], build: [], modsChanged: false };
  if (off(s)) return out;
  const hz = s.hazards;
  const now = s.simTime;
  if (s.era >= 3 && hz.era3At === null) hz.era3At = now;
  // the flare's own clock (the 90 s gap after an active phase; the flare kinds)
  const flarePrev = hz.flarePrev;
  hz.flarePrev = s.flare.phase;
  if (flarePrev === 'active' && s.flare.phase === 'idle') hz.flareEndAt = now;
  // meters that run whatever the start: dose falls a crew-dose a lunar day, the loop ages
  hz.doseLoad = Math.max(0, hz.doseLoad - dt / CYCLE_S);
  if (s.crew > 0 && waterSource(s, mods) > 0) hz.loopAge += dt / CYCLE_S;
  hz.sick = hz.sick.filter((x) => x.until > now);
  s.grief = (s.grief ?? []).filter((g) => g.until > now);
  earthContact(s, mods);
  const started = hazardsStarted(s);
  if (started) {
    if (flarePrev === 'idle' && s.flare.phase === 'telegraph') onFlareTelegraph(s, mods, site);
    cascadeWatch(s, mods, site, dt);
    controlPlaneWatch(s, mods, site, dt);
    dustTick(s, mods, dt);
    cabinFeverTick(s, mods, site, dt);
    schedulerTick(s, mods, site);
  }
  for (const h of [...hz.live]) tickLive(s, mods, site, day, dt, h, out, flarePrev);
  suitAirTick(s, mods, dt);
  fleetTick(s, mods, dt, out);
  junkTick(s, mods, site);
  for (const h of hz.live) raiseLive(s, mods, h);
  if (hz.shedUntil > now) {
    condition(s, 'hz:shed', `LOADS SHED — priority 2–3 loads off for ${fmtClock(hz.shedUntil - now)}: the bank feeds priority 0`, 'info', { panel: 'power' });
  }
  return out;
}

/** Earth contact (resupply or downlink landed, a rotation boarded): cabin fever
 *  eases with Earth contact, and crew who asked to leave go home. */
function earthContact(s: GameState, mods: Mods) {
  const hz = s.hazards;
  const shipments = s.resupply?.shipments ?? 0;
  const rotation = !!s.crewRotation;
  let contact = false;
  if (s.resupply?.pending && s.resupply.downlink) hz.downlinkAt = s.resupply.arriveAt;
  if (shipments > hz.shipments) contact = true;
  if (hz.rotation && !rotation && s.crew > 0) contact = true;
  hz.shipments = shipments;
  hz.rotation = rotation;
  if (!contact) return;
  if (guard(mods, 'earthContact')) hz.isolation = Math.max(0, hz.isolation - HZ.cabinFever.earthContact);
  if (hz.leaving > 0 && s.crew > HZ.cabinFever.minCrew) {
    const n = Math.min(hz.leaving, s.crew - HZ.cabinFever.minCrew);
    s.crew -= n;
    hz.leaving = 0;
    alert(s, `CREW HOME — ${plural(n, 'crew member')} took the ride home after two crises (cabin fever): they left alive`, 'warn', { panel: 'crew' });
  }
}

// ── the flare kinds (DOSE, bit flips) ──

function onFlareTelegraph(s: GameState, mods: Mods, site: SiteDef) {
  if (site.flareImmune) return;
  const active = s.simTime + s.flare.timer;
  if (sideTier(s, 'colony') !== null && s.evaCrew > 0 && !liveOn(s, 'colony', 'window') &&
      !s.hazards.live.some((h) => h.kind === 'dose')) {
    const h = startHazard(s, mods, site, 'dose', { at: active - HZ.dose.walkInS });
    if (typeof h !== 'string') {
      h.n.eva = s.evaCrew;
      h.n.active = active;
      h.targetName = `${plural(s.evaCrew, 'crew member')} on EVA`;
      if (guard(mods, 'stormShelters')) h.used.recallEva = s.simTime; // the shelters call them in
    }
  }
  const out = s.rovers.filter(away).length;
  if (sideTier(s, 'automation') !== null && out > 0 && !liveOn(s, 'automation', 'window') &&
      !s.hazards.live.some((h) => h.kind === 'firmware')) {
    const h = startHazard(s, mods, site, 'firmware', { at: active, flare: true });
    if (typeof h !== 'string') {
      h.targetName = `${plural(out, 'rover')} on site`;
      h.n.active = active;
    }
  }
}

// ── the event kinds (CASCADE, CONTROL PLANE) ──

const homeType = (b: BuildingState) => b.type === 'habitat' || b.type === 'gardenDome';

function cascadeWatch(s: GameState, mods: Mods, site: SiteDef, dt: number) {
  const hz = s.hazards;
  const occ = occupancy(s, mods);
  const live = hz.live.find((h) => h.kind === 'cascade');
  // leaky, as the crop-loss clock is: a home the brownout hysteresis flickers
  // on for a second in nine still counts as dark
  for (const b of s.buildings) {
    if (!homeType(b) || isSite(b) || !b.enabled) continue;
    const dark = b.idleReason === 'power';
    hz.darkS[b.id] = dark ? (hz.darkS[b.id] ?? 0) + dt : Math.max(0, (hz.darkS[b.id] ?? 0) - dt);
  }
  for (const k of Object.keys(hz.darkS)) if (!byId(s, Number(k))) delete hz.darkS[k];
  if (live || sideTier(s, 'colony') === null || s.crew <= 0 || liveOn(s, 'colony', 'window')) return;
  const dark = s.buildings.filter((b) => homeType(b) && (hz.darkS[b.id] ?? 0) > 0 && (occ.get(b.id) ?? 0) > 0);
  if (!dark.length) return;
  const first = dark.sort((a, b) => (hz.darkS[b.id] ?? 0) - (hz.darkS[a.id] ?? 0) || a.id - b.id)[0];
  const grace = HZ.cascade.alarmS + (guard(mods, 'closedLoop') ? HZ.cascade.closedLoopS : 0);
  const drill = !hz.drilled.includes('cascade');
  const h = startHazard(s, mods, site, 'cascade', {
    at: s.simTime - (hz.darkS[first.id] ?? 0) + grace + (drill ? HZ.drillExtraS : 0), target: first.id,
  });
  if (typeof h !== 'string') { h.n.occupants = occ.get(first.id) ?? 0; h.n.grace = grace + (drill ? HZ.drillExtraS : 0); }
}

function controlPlaneWatch(s: GameState, mods: Mods, site: SiteDef, dt: number) {
  const hz = s.hazards;
  const tier = sideTier(s, 'automation');
  const compute = s.buildings.filter((b) => isCompute(b.type) && complete(b));
  const running = computeRunning(s);
  const g = mods.exposure.has('controlPlane') && s.buildings.some((b) => b.infected) ? networkGraph(s, mods) : null;
  const half = !!g && g.nodes.length > 0 && g.nodes.filter((n) => n.infected).length >= g.nodes.length / 2;
  const infectedDC = mods.exposure.has('controlPlane') && compute.some((b) => b.infected);
  const up = running.length > 0 && !half && !infectedDC;
  // leaky, as a habitat's darkness is: Data Centers the brownout flickers on
  // for a tick still count as dark, and one hazard covers the whole flicker
  hz.computeDarkS = up ? Math.max(0, hz.computeDarkS - dt) : hz.computeDarkS + dt;
  hz.computeUpS = up ? hz.computeUpS + dt : 0;
  if (tier === null || !mods.exposure.has('controlPlane') || !compute.length) return;
  const live = hz.live.find((h) => h.kind === 'controlPlane');
  if (!live && running.length === 1 && compute.length >= 1 && (s.power.shed || s.power.brownout)) {
    condition(s, 'hz:lastdc', `CONTROL PLANE — ${label(running[0])} is the last one running · drones in flight will fall if it goes`,
      'warn', { select: running[0].id });
    withCounters(s, 'hz:lastdc', [{ counter: 'landDrones', label: 'Land drones' }]);
  }
  if (live || up || liveOn(s, 'automation', 'window')) return;
  const drill = !hz.drilled.includes('controlPlane');
  const grace = HZ.controlPlane.darkS + (guard(mods, 'watchdogs') ? HZ.controlPlane.failoverS : 0) + (drill ? HZ.drillExtraS : 0);
  // darkness carried over (a window hazard held this one back) never skips the warning
  hz.computeDarkS = Math.min(hz.computeDarkS, grace - HZ.controlPlane.darkS);
  const h = startHazard(s, mods, site, 'controlPlane', { at: s.simTime - hz.computeDarkS + grace });
  if (typeof h !== 'string') { h.targetName = 'the control plane'; h.n.grace = grace; }
}

// ── the ambient and meter kinds (DUST, CABIN FEVER) ──

function dustTick(s: GameState, mods: Mods, dt: number) {
  if (sideTier(s, 'colony') === null) return;
  const types = pressurizedTypes(mods);
  const sources = s.buildings.filter((b) => (b.type === 'excavator' && complete(b) && b.enabled) || (isSite(b) && b.idleReason === 'building'));
  const mult = (guard(mods, 'dustScreens') ? HZ.dust.screens : 1) * (guard(mods, 'suitports') ? HZ.dust.suitports : 1);
  for (const b of s.buildings) {
    if (!types.has(b.type) || isSite(b) || !b.enabled) continue;
    const [bx, bz] = centerOf(b);
    let near: BuildingState | null = null, nd = Infinity, n = 0;
    for (const x of sources) {
      const [sx, sz] = x.type === 'excavator' && x.haul ? [x.haul.digX, x.haul.digZ] : centerOf(x);
      const d = Math.hypot(sx - bx, sz - bz);
      if (d > HZ.dust.radiusM) continue;
      n++;
      if (d < nd) { nd = d; near = x; }
    }
    const perDay = (HZ.dust.perSource * n + HZ.dust.perEva * s.evaCrew) * mult;
    b.airlockDust = Math.min(1, (b.airlockDust ?? 0) + (perDay / CYCLE_S) * dt);
    if (b.airlockDust >= 1) b.wear = Math.min(1, b.wear + (HZ.dust.clogWear / CYCLE_S) * dt);
    if (b.airlockDust >= HZ.dust.warnAt) {
      if (!s.hazards.drilled.includes('dust')) s.hazards.drilled.push('dust');
      const why = near ? `${label(near)} ${isSite(near) ? 'builds' : 'digs'} ${Math.round(nd)} m away` : 'EVA crews track it in';
      const key = `hz:dust:${b.id}`;
      condition(s, key, b.airlockDust >= 1
        ? `FILTERS CLOGGED — ${label(b)}: upkeep ×2 and the hull wears toward a breach · ${why}`
        : `DUST IN THE AIRLOCKS — ${label(b)} filters ${Math.round(b.airlockDust * 100)}%: ${why}`, 'warn', { select: b.id });
      withCounters(s, key, [{ counter: 'clean', id: b.id, label: `Clean ${HZ.dust.clean}⚙` }]);
    }
  }
}

function cabinFeverTick(s: GameState, mods: Mods, site: SiteDef, dt: number) {
  const hz = s.hazards;
  const tier = sideTier(s, 'colony');
  if (tier === null || s.crew <= 0 || !mods.exposure.has('cabinFever')) return;
  const C = HZ.cabinFever;
  const domes = s.buildings.filter((b) => (b.type === 'recDome' || b.type === 'gardenDome') && b.active).length;
  const farm = s.buildings.some((b) => FARM_W[b.type] && b.active);
  const crowded = s.crew > (s.housingActive ?? 0);
  const perDay = C.rise[tier] + Math.max(0, s.crew - 8) / 2 + (crowded ? C.crowd : 0) -
    Math.min(C.domeMax, C.domeEase * domes) - (guard(mods, 'commonsMeals') && farm ? C.commons : 0);
  hz.isolation = Math.min(100, Math.max(0, hz.isolation + (perDay / CYCLE_S) * dt));
  let live = hz.live.find((h) => h.kind === 'cabinFever');
  if (!live && hz.isolation >= C.warnAt && !liveOn(s, 'colony', 'window')) {
    const h = startHazard(s, mods, site, 'cabinFever', { at: s.simTime + CYCLE_S });
    if (typeof h !== 'string') { live = h; h.targetName = 'the crew'; }
  }
  if (!live) return;
  live.n.perDay = perDay;
  live.at = perDay > 0 ? s.simTime + ((100 - hz.isolation) / perDay) * CYCLE_S : s.simTime + 99 * CYCLE_S;
  if (hz.isolation < C.warnAt - 10) { endHazard(s, live, 'answered: the crew settled'); return; }
  if (hz.isolation < 100) return;
  // a crisis
  hz.isolation = C.reset;
  hz.crisisUntil = s.simTime + C.crisisS;
  if (!live.drill) {
    const station = s.buildings.filter((b) => BUILDINGS[b.type].crew > 0 && !b.automated && complete(b) && b.enabled && b.active)
      .sort((a, b) => b.priority - a.priority || b.id - a.id)[0];
    if (station) station.strikeUntil = s.simTime + C.crisisS;
    hz.crises = hz.crises.filter((t) => s.simTime - t < C.windowDays * CYCLE_S);
    hz.crises.push(s.simTime);
    if (hz.crises.length >= 2) hz.leaving = C.leave;
    alert(s, `CABIN FEVER CRISIS — morale −${C.morale} for ${fmtClock(C.crisisS)}${station ? ` · ${label(station)} on strike` : ''}` +
      (hz.leaving ? ` · ${hz.leaving} crew will take the next ride home` : ''), 'warn', station ? { select: station.id } : { panel: 'crew' });
  } else {
    alert(s, `CABIN FEVER CRISIS (drill) — morale −${C.morale} for ${fmtClock(C.crisisS)}`, 'warn', { panel: 'crew' });
  }
  endHazard(s, live, live.drill ? 'drill crisis' : 'ignored: a crisis');
}

// ─────────────────────────── each live hazard ───────────────────────────

function tickLive(s: GameState, mods: Mods, site: SiteDef, day: DayInfo, dt: number, h: LiveHazard, out: HazardTickResult,
  flarePrev: GameState['flare']['phase']) {
  switch (h.kind) {
    case 'breach': return tickBreach(s, mods, dt, h);
    case 'cascade': return tickCascade(s, mods, h);
    case 'blight': return tickBlight(s, mods, h);
    case 'contamination': return tickContamination(s, mods, dt, h);
    case 'dose': return tickDose(s, mods, h, flarePrev);
    case 'cabinFever': return; // the meter (cabinFeverTick)
    case 'dust': return;
    case 'controlPlane': return tickControlPlane(s, mods, h);
    case 'malware': return tickMalware(s, mods, h, out);
    case 'firmware': return tickFirmware(s, mods, h, flarePrev);
    case 'rogueDrones': return tickRogue(s, mods, dt, h, out);
    case 'runaway': return tickRunaway(s, mods, site, h, out);
    case 'hackedOutpost': return tickOutpost(s, mods, h, out);
  }
}

const drillOver = (s: GameState, h: LiveHazard) => h.drill && h.phase === 'active' && s.simTime >= h.at + HZ.drillS;

// ── BREACH ──
function tickBreach(s: GameState, mods: Mods, dt: number, h: LiveHazard) {
  const b = byId(s, h.target);
  const now = s.simTime;
  if (!b) { endHazard(s, h, 'the hall is gone'); return; }
  const sealed = h.doneAt !== undefined && now >= h.doneAt;
  if (h.phase === 'telegraph') {
    h.n.occupants = (b.evacT ?? 0) > now ? 0 : occupancy(s, mods).get(b.id) ?? 0;
    if (sealed) {
      b.evacT = 0;
      alert(s, `SEALED — ${label(b)}’s seals renewed in time; nothing vented`, 'info', { select: b.id });
      endHazard(s, h, 'answered: Seal');
      return;
    }
    if (now < h.at) return;
    // it opens: the tier's deaths if people are inside, unsealed and not evacuated
    const inside = (b.evacT ?? 0) > now ? 0 : occupancy(s, mods).get(b.id) ?? 0;
    h.phase = 'active';
    b.breached = h.id;
    const bulk = guard(mods, 'bulkheads');
    const deaths = h.drill || bulk ? 0 : Math.min(inside, HZ.breach.deaths[h.tier]);
    if (deaths > 0) {
      const why = h.used.seal !== undefined ? 'the seal came too late' : 'no seal, no evacuation';
      killCrew(s, deaths, `${label(b)} decompressed`, 'breach', h.warnedAt, why, { select: b.id });
    }
    // survivors crowd into free beds, or breathe suit air
    const survivors = Math.max(0, inside - deaths);
    if (survivors > 0 && homeType(b)) suitAirFor(s, mods, h, b, survivors);
    if (bulk) h.doneAt = Math.min(h.doneAt ?? Infinity, now + HZ.breach.bulkheadSealS);
    alert(s, `BREACH — ${label(b)} is venting${deaths ? ` · ${plural(deaths, 'crew member')} lost` : ''}` +
      `${bulk ? ' · the bulkheads seal it in 0:30' : ''}`, 'crit', { select: b.id });
    return;
  }
  // venting until sealed; decompressed after 120 s unsealed
  if (sealed) {
    b.breached = undefined;
    b.evacT = 0;
    alert(s, `SEALED — ${label(b)} holds air again`, 'info', { select: b.id });
    endHazard(s, h, h.used.seal !== undefined && h.used.seal + HZ.breach.sealS > h.at ? 'late seal' : 'sealed after it opened');
    return;
  }
  const vent = HZ.breach.vent[h.tier] * (guard(mods, 'bulkheads') ? HZ.breach.bulkheadVent : 1) * dt;
  const floor = h.drill ? s.crew * CREW.oxygenPerCrew * mods.inputMult.habitat * 300 : 0;
  s.resources.oxygen = Math.max(Math.min(s.resources.oxygen, floor), s.resources.oxygen - vent);
  if (now >= h.at + HZ.breach.decompressS || drillOver(s, h)) {
    b.breached = undefined;
    b.evacT = 0;
    if (h.drill) {
      alert(s, `DRILL BREACH SEALED — ${label(b)} closed itself; next time it decompresses`, 'info', { select: b.id });
      endHazard(s, h, 'drill');
      return;
    }
    b.decompressed = true;
    alert(s, `SECTION DECOMPRESSED — ${label(b)} offline until repaired (${HZ.breach.repair}⚙); the vent stopped`, 'crit', { select: b.id });
    endHazard(s, h, 'ignored: decompressed');
  }
}

// ── suit air (a breach's survivors, a cascade's displaced) ──
function suitAirFor(s: GameState, mods: Mods, h: LiveHazard, from: BuildingState, n: number) {
  const beds = Math.max(0, freeBeds(s, mods));
  const suit = Math.max(0, n - beds);
  if (suit <= 0) return;
  const air = HZ.cascade.suitAir[h.tier] + (guard(mods, 'closedLoop') ? HZ.cascade.closedLoopS : 0) + (h.drill ? HZ.drillExtraS : 0);
  s.hazards.suit.push({ hazard: h.id, from: from.id, n: suit, until: s.simTime + air, nextDeath: s.simTime + air });
}

function suitAirTick(s: GameState, mods: Mods, dt: number) {
  const hz = s.hazards;
  if (!hz.suit.length) return;
  void dt;
  for (const x of [...hz.suit]) {
    const h = hz.live.find((y) => y.id === x.hazard);
    const from = byId(s, x.from);
    // power back to their habitat (steadily: its darkness drained), or beds free: they go in
    const powered = !!from && (s.hazards.darkS[from.id] ?? 0) <= 0 && from.idleReason !== 'power' && from.idleReason !== 'hazard' &&
      !from.breached && !from.decompressed;
    const beds = Math.max(0, freeBeds(s, mods));
    const moved = powered ? x.n : Math.min(x.n, beds);
    if (moved > 0) x.n -= moved;
    if (x.n <= 0 || !h) { hz.suit = hz.suit.filter((y) => y !== x); continue; }
    const key = `hzc:suit:${h.id}:${x.from}`;
    if (s.simTime < x.until) {
      condition(s, key, `SUIT AIR — ${plural(x.n, 'crew member')} from ${from ? label(from) : 'a habitat'}: ${fmtClock(x.until - s.simTime)}` +
        `${h.drill ? ' · drill' : ' · power or a free bed saves them'}`, 'crit', from ? { select: from.id } : undefined);
      withCounters(s, key, [{ counter: 'shedLoads', label: 'Shed loads' }]);
      continue;
    }
    if (h.drill) {
      alert(s, `SUIT AIR OUT (drill) — the ${plural(x.n, 'crew member')} made it to the Lander airlock; next time they die`, 'warn');
      hz.suit = hz.suit.filter((y) => y !== x);
      continue;
    }
    condition(s, key, `SUIT AIR OUT — ${plural(x.n, 'crew member')}: 1 dies every 0:30 until power returns or a bed frees`, 'crit',
      from ? { select: from.id } : undefined);
    withCounters(s, key, [{ counter: 'shedLoads', label: 'Shed loads' }]);
    if (s.simTime >= x.nextDeath) {
      x.nextDeath = s.simTime + HZ.cascade.deathEveryS;
      x.n -= 1;
      killCrew(s, 1, `suit air ran out: ${from ? label(from) : 'a habitat'} ${h.kind === 'breach' ? 'breached' : 'dark'}`,
        h.kind, h.warnedAt, 'no power, no bed', from ? { select: from.id } : undefined);
      if (x.n <= 0) hz.suit = hz.suit.filter((y) => y !== x);
    }
  }
}

// ── LIFE-SUPPORT CASCADE ──
function tickCascade(s: GameState, mods: Mods, h: LiveHazard) {
  const hz = s.hazards;
  const now = s.simTime;
  const homes = s.buildings.filter(homeType);
  const darkNow = (b: BuildingState) => b.idleReason === 'power';
  const lit = (b: BuildingState) => (hz.darkS[b.id] ?? 0) <= 0;
  if (h.phase === 'telegraph') {
    const target = byId(s, h.target);
    if (!target || lit(target)) {
      alert(s, `SCRUBBERS BACK — ${target ? label(target) : 'the habitat'} has power again`, 'info');
      endHazard(s, h, h.used.shedLoads !== undefined ? 'answered: Shed loads' : 'power returned');
      return;
    }
    // the alarm comes when its darkness adds up to the grace (a flicker of power holds the clock)
    h.at = now + Math.max(0, (h.n.grace ?? HZ.cascade.alarmS) - (hz.darkS[target.id] ?? 0));
    if (now < h.at) return;
    // the CO₂ alarm: dark crewed habitats evacuate, up to the tier's cap
    h.phase = 'active';
    const occ = occupancy(s, mods);
    const dark = homes.filter((b) => darkNow(b) && (occ.get(b.id) ?? 0) > 0)
      .sort((a, b) => (hz.darkS[b.id] ?? 0) - (hz.darkS[a.id] ?? 0) || a.id - b.id).slice(0, HZ.cascade.cap[h.tier]);
    let moved = 0;
    for (const b of dark) {
      const n = occ.get(b.id) ?? 0;
      b.evacT = UNTIL_SEALED;
      h.hit.push(b.id);
      moved += n;
      suitAirFor(s, mods, h, b, n);
    }
    h.n.displaced = moved;
    alert(s, `LIFE-SUPPORT CASCADE — ${dark.map(label).join(', ')} evacuated (${plural(moved, 'crew member')} moved)` +
      ' · beds back 1:30 after power returns', 'crit', dark[0] ? { select: dark[0].id } : undefined);
    return;
  }
  // displaced crew breathe ×1.3
  s.resources.oxygen = Math.max(0, s.resources.oxygen - (h.n.displaced ?? 0) * CREW.oxygenPerCrew * (HZ.cascade.o2Mult - 1));
  let open = 0;
  for (const id of h.hit) {
    const b = byId(s, id);
    if (!b) continue;
    if (b.evacT === UNTIL_SEALED && lit(b)) b.evacT = now + HZ.cascade.evacHoldS;
    else if (!lit(b) && (b.evacT ?? 0) > 0) b.evacT = UNTIL_SEALED;
    if ((b.evacT ?? 0) > now) open++;
  }
  const suit = hz.suit.some((x) => x.hazard === h.id);
  if (!open && !suit) {
    alert(s, 'SCRUBBERS RESTARTED — the habitats are back on line', 'info');
    endHazard(s, h, s.deaths.some((d) => d.at >= h.warnedAt && d.hazard === 'cascade') ? 'ignored: crew lost' : 'weathered');
  }
}

// ── BLIGHT ──
function tickBlight(s: GameState, mods: Mods, h: LiveHazard) {
  const now = s.simTime;
  const target = byId(s, h.target);
  if (h.phase === 'telegraph') {
    if (!target) { endHazard(s, h, 'the farm is gone'); return; }
    if (now < h.at) return;
    h.phase = 'active';
    target.blightUntil = now + (h.drill ? HZ.drillS : HZ.blight.clearS);
    h.hit = [target.id];
    h.n.nextSpread = now + (HZ.blight.spreadS[h.tier] || Infinity);
    alert(s, `BLIGHT — ${label(target)} yields −${Math.round((1 - HZ.blight.output[h.tier]) * 100)}%` +
      (HZ.blight.spreadS[h.tier] && !h.drill ? ` · it spreads every ${fmtClock(HZ.blight.spreadS[h.tier])}` : ''), 'warn', { select: target.id });
    return;
  }
  // spread (moderate+): every farm within 24 m of an infected one
  if (!h.drill && HZ.blight.spreadS[h.tier] && now >= (h.n.nextSpread ?? Infinity)) {
    h.n.nextSpread = now + HZ.blight.spreadS[h.tier];
    const sick = farmsNow(s).filter((b) => (b.blightUntil ?? 0) > now);
    for (const f of farmsNow(s)) {
      if ((f.blightUntil ?? 0) > now || (f.cropRegrowT ?? 0) > 0) continue;
      if (sick.some((x) => dist(x, f) <= HZ.blight.clusterM)) {
        f.blightUntil = now + HZ.blight.clearS;
        if (!h.hit.includes(f.id)) h.hit.push(f.id);
        alert(s, `BLIGHT SPREADS — ${label(f)} infected`, 'warn', { select: f.id });
      }
    }
  }
  const still = h.hit.filter((id) => (byId(s, id)?.blightUntil ?? 0) > now);
  if (!still.length) endHazard(s, h, h.used.quarantine !== undefined ? 'answered: Quarantine' : h.drill ? 'drill' : 'cleared itself');
}

// ── CONTAMINATION ──
function tickContamination(s: GameState, mods: Mods, dt: number, h: LiveHazard) {
  const now = s.simTime;
  const C = HZ.contamination;
  if (h.phase === 'telegraph') {
    if (now < h.at) return;
    h.phase = 'active';
    h.n.since = now;
    if (!h.drill) h.clockAt = now + C.poisonDays[h.tier] * CYCLE_S;
    alert(s, `WATER UNSAFE — farms −${Math.round((1 - C.output[h.tier]) * 100)}%, a boil-water notice (morale −${C.morale[h.tier]})` +
      (h.drill ? '' : ` · poisoning in ${fmtClock(C.poisonDays[h.tier] * CYCLE_S)} unless flushed`), 'warn', { panel: 'water' });
    return;
  }
  // treatment loses 1% of the stock a minute
  s.resources.water = Math.max(0, s.resources.water * (1 - (C.lossPerMin / 60) * dt));
  if (guard(mods, 'closedLoop') && now >= (h.n.since ?? now) + C.closedLoopS) {
    s.hazards.loopAge = 0;
    alert(s, 'WATER CLEAN — Closed-Loop Life Support scrubbed the loop', 'info', { panel: 'water' });
    endHazard(s, h, 'answered: Closed-Loop LS');
    return;
  }
  if (drillOver(s, h)) { s.hazards.loopAge = 0; endHazard(s, h, 'drill'); return; }
  if (h.drill) return;
  // the sick bay after a lunar day
  if (!h.n.sickDone && now >= (h.n.since ?? now) + C.sickDays * CYCLE_S && s.crew > 0) {
    h.n.sickDone = 1;
    const n = Math.max(1, Math.floor(s.crew * C.sickShare));
    s.hazards.sick.push({ n, until: now + CYCLE_S });
    alert(s, `SICK BAY — ${plural(n, 'crew member')} off work for a lunar day (fouled water) · flush the loop`, 'warn', { panel: 'crew' });
  }
  if (h.clockAt && now >= h.clockAt) {
    h.clockAt = now + CYCLE_S;
    killCrew(s, 1, 'poisoned by the fouled water loop', 'contamination', h.warnedAt, 'the loop was never flushed', { panel: 'water' });
  }
}

// ── DOSE ──
function tickDose(s: GameState, mods: Mods, h: LiveHazard, flarePrev: GameState['flare']['phase']) {
  const now = s.simTime;
  const D = HZ.dose;
  if (h.phase === 'telegraph') {
    if (!(flarePrev === 'telegraph' && s.flare.phase === 'active')) {
      if (s.flare.phase === 'idle') endHazard(s, h, 'the flare passed');
      return;
    }
    h.phase = 'active';
    // who was still outside at the deadline: a recall after it came too late
    const recalled = h.used.recallEva !== undefined && h.used.recallEva <= h.at;
    const caught = recalled ? 0 : h.n.eva ?? 0;
    h.n.caught = caught;
    if (!caught) {
      alert(s, 'EVA CLEAR — everyone was indoors when the flare hit', 'info');
      endHazard(s, h, recalled ? 'answered: Recall EVA' : 'nobody outside');
      return;
    }
    const doses = caught * (guard(mods, 'stormShelters') ? D.shelter : 1);
    const before = s.hazards.doseLoad;
    s.hazards.doseLoad += doses;
    s.hazards.sick.push({ n: caught, until: now + D.offDays[h.tier] * CYCLE_S });
    s.morale = Math.max(0, s.morale - D.morale);
    let lethal = Math.floor(caught * D.lethalShare[h.tier]);
    if (before + doses > D.limit) lethal = Math.max(lethal, Math.min(caught, Math.ceil(before + doses - D.limit)));
    if (h.drill) lethal = 0;
    h.n.lethal = lethal;
    alert(s, `DOSE — ${plural(caught, 'crew member')} caught outside by the flare: off work ${D.offDays[h.tier]} lunar day` +
      `${lethal ? ` · ${lethal} lethal` : ''}`, lethal ? 'crit' : 'warn', { panel: 'crew' });
    if (!lethal) { endHazard(s, h, h.drill ? 'drill: dosed' : 'ignored: dosed'); return; }
    h.clockAt = now + D.criticalS;
    return;
  }
  if (!h.clockAt || now < h.clockAt) return;
  const n = h.n.lethal ?? 0;
  if (n > 0) killCrew(s, n, 'an acute radiation dose on EVA', 'dose', h.warnedAt, 'the recall never came', { panel: 'crew' });
  endHazard(s, h, n > 0 ? `ignored: ${plural(n, 'crew member')} lost` : 'answered: Medevac');
}

// ── CONTROL PLANE ──
function tickControlPlane(s: GameState, mods: Mods, h: LiveHazard) {
  const hz = s.hazards;
  const now = s.simTime;
  // recovered: a Data Center runs now and the darkness has drained
  const up = hz.computeDarkS === 0 && hz.computeUpS > 0;
  // landed drones wait out the whole hazard
  if (hz.dronesHeldUntil > now) hz.dronesHeldUntil = Math.max(hz.dronesHeldUntil, now + 2);
  if (h.phase === 'telegraph') {
    if (up) {
      alert(s, 'CONTROL PLANE HELD — a Data Center is running again', 'info');
      endHazard(s, h, h.used.landDrones !== undefined ? 'answered: Land drones' : 'a Data Center came back');
      return;
    }
    // it drops when the darkness adds up to the grace (a flicker of power holds the clock)
    if (h.n.grace !== undefined) h.at = now + Math.max(0, h.n.grace - hz.computeDarkS);
    if (now < h.at) return;
    h.phase = 'active';
    // drones in flight: at major they fall, below it they land
    const flying = s.rovers.filter((r) => isDrone(s, r) && away(r) && !((r.heldUntil ?? 0) > now) && !((r.brickedUntil ?? 0) > 0));
    let lost = 0;
    for (const r of flying) {
      if (h.tier >= 2 && !h.drill) {
        loseRover(s, mods, r, `drone #${r.id} fell when the control plane dropped`, h, 'the drones were not landed');
        lost++;
      } else {
        r.heldUntil = now + HZ.controlPlane.holdS;
        r.site = null;
      }
    }
    alert(s, `CONTROL PLANE DOWN — agent-run output ×${HZ.controlPlane.output[h.tier]} · the Builder waits for a Data Center` +
      `${lost ? ` · ${plural(lost, 'drone')} fell` : flying.length ? ` · ${plural(flying.length, 'drone')} landed` : ''}`, 'crit');
    return;
  }
  // down: the Builder's rules hold until a Data Center has run 30 s
  s.auto.frozenUntil = Math.max(s.auto.frozenUntil, now + 2);
  for (const r of s.rovers) if (isDrone(s, r)) r.heldUntil = Math.max(r.heldUntil ?? 0, now + 2);
  if (hz.computeUpS >= HZ.controlPlane.resumeS || drillOver(s, h)) {
    if (hz.computeUpS >= HZ.controlPlane.resumeS) hz.computeDarkS = 0; // a Data Center ran 30 s straight: a clean slate
    alert(s, 'CONTROL PLANE RESTORED — the agents and the Builder are back on the network', 'info');
    endHazard(s, h, h.drill ? 'drill' : 'restored');
  }
}

// ── MALWARE ──
function tickMalware(s: GameState, mods: Mods, h: LiveHazard, out: HazardTickResult) {
  const now = s.simTime;
  const M = HZ.malware;
  const entry = byId(s, h.target);
  if (h.phase === 'telegraph') {
    if (!entry) { endHazard(s, h, 'the node is gone'); return; }
    if (entry.airGapped || s.hazards.immuneUntil > now || (entry.reimageUntil ?? 0) > now) {
      alert(s, `WORM STARVED — ${label(entry)} ${entry.airGapped ? 'was air-gapped' : 'was cleaned'} before it unpacked`, 'info', { select: entry.id });
      endHazard(s, h, entry.airGapped ? 'answered: Air-gap' : 'answered: Reimage');
      return;
    }
    if (now < h.at) return;
    h.phase = 'active';
    infect(s, mods, entry, h);
    h.n.nextSpread = now + M.spreadS[h.tier];
    alert(s, `MALWARE — ${label(entry)} infected: ×${M.output} output, ×${M.draw} draw; it spreads every ${fmtClock(M.spreadS[h.tier])}`,
      'crit', { select: entry.id });
    return;
  }
  // a patch under way
  if (h.doneAt !== undefined && now >= h.doneAt) {
    for (const b of s.buildings) { b.infected = false; b.infectedAt = undefined; }
    s.hazards.immuneUntil = now + M.patch.immuneS;
    alert(s, 'PATCHED — every node is clean, and immune for a lunar day', 'info');
    endHazard(s, h, 'answered: Patch');
    return;
  }
  const infected = s.buildings.filter((b) => b.infected);
  h.hit = infected.map((b) => b.id);
  if (!infected.length) { endHazard(s, h, h.used.reimage !== undefined ? 'answered: Reimage' : 'cleaned'); return; }
  if (drillOver(s, h)) {
    for (const b of infected) { b.infected = false; b.infectedAt = undefined; }
    endHazard(s, h, 'drill');
    return;
  }
  // its rules freeze: the Builder does not build more of an infected node's kind
  for (const id of RULE_ORDER) {
    const t = ruleBuilding(s, mods, id);
    if (t && infected.some((b) => b.type === t)) {
      const r = s.auto.rules[id];
      if (r) r.frozenUntil = Math.max(r.frozenUntil ?? 0, now + 2);
    }
  }
  // spread: one clean neighbour an interval, the most-linked, up to the cap
  if (now >= (h.n.nextSpread ?? Infinity)) {
    h.n.nextSpread = now + M.spreadS[h.tier];
    const cap = M.cap[h.drill ? 0 : h.tier];
    if (infected.length < cap && s.hazards.immuneUntil <= now) {
      const g = networkGraph(s, mods);
      let best: { id: number; links: number } | null = null;
      for (const b of infected) {
        if (b.airGapped || (b.isolatedUntil ?? 0) > now) continue;
        for (const nid of g.byId.get(b.id)?.links ?? []) {
          const n = g.byId.get(nid)!;
          if (n.infected || n.gapped) continue;
          if (!best || n.links.length > best.links || (n.links.length === best.links && nid < best.id)) best = { id: nid, links: n.links.length };
        }
      }
      const nb = best ? byId(s, best.id) : undefined;
      if (nb) {
        infect(s, mods, nb, h);
        alert(s, `MALWARE SPREADS — ${label(nb)} infected (${infected.length + 1} nodes)`, 'warn', { select: nb.id });
      }
    }
  }
  if (h.drill) return;
  // ransom (moderate) and burn-out (major), each behind its own clock
  let clock = 0;
  for (const b of infected) {
    const since = b.infectedAt ?? now;
    if (h.tier === 1 && isCompute(b.type)) {
      const paid = h.n[`r${b.id}`] ?? 0;
      const day = since + CYCLE_S * (paid + 1);
      if (now >= day) {
        h.n[`r${b.id}`] = paid + 1;
        const lost = Math.floor(s.data * M.ransom);
        s.data -= lost;
        recordLoss(s, mods, { what: 'data', name: `${lost}≡`, cause: `ransomware on ${label(b)} wiped 15% of banked data`, hazard: 'malware', warnedAt: h.warnedAt, amount: lost },
          'RANSOM', 'no patch, no reimage', undefined, { select: b.id });
      }
      clock = clock ? Math.min(clock, now >= day ? day + CYCLE_S : day) : now >= day ? day + CYCLE_S : day;
    }
    // the Lander, the lifeboat, is degraded but never burns out
    if (h.tier === 2 && b.type !== 'lander') {
      const burn = since + CYCLE_S;
      if (now >= burn) {
        recordLoss(s, mods, { what: 'building', name: label(b), cause: `${label(b)} burned out, infected for a lunar day`, hazard: 'malware', warnedAt: h.warnedAt },
          'BURN-OUT', 'it was never reimaged', b.type);
        wreckBuilding(s, b.id, out.wrecked);
        continue;
      }
      if (!clock || burn < clock) { clock = burn; h.n.clockNode = b.id; }
    }
  }
  h.clockAt = clock;
}

function infect(s: GameState, mods: Mods, b: BuildingState, h: LiveHazard) {
  b.infected = true;
  b.infectedAt = s.simTime;
  if (guard(mods, 'intrusionDetection')) b.isolatedUntil = s.simTime + HZ.malware.isolateS;
  if (!h.hit.includes(b.id)) h.hit.push(b.id);
}

// ── FIRMWARE (window and bit flips) ──
function tickFirmware(s: GameState, mods: Mods, h: LiveHazard, flarePrev: GameState['flare']['phase']) {
  const now = s.simTime;
  const F = HZ.firmware;
  if (h.phase === 'telegraph') {
    if (h.flare) {
      if (!(flarePrev === 'telegraph' && s.flare.phase === 'active')) {
        if (s.flare.phase === 'idle') endHazard(s, h, 'the flare passed');
        return;
      }
    } else if (now < h.at) return;
    else if (h.used.holdRollout !== undefined) { endHazard(s, h, 'answered: Hold rollout'); return; }
    h.phase = 'active';
    // who takes it: a window's share of the fleet, or a flare's share of the rovers out on site
    const pool = h.flare
      ? s.rovers.filter((r) => away(r) && !((r.heldUntil ?? 0) > now) && !((r.brickedUntil ?? 0) > 0))
      : s.rovers.filter((r) => !((r.brickedUntil ?? 0) > 0));
    const share = F.share[h.tier] * (h.flare && guard(mods, 'radHard') ? F.radHard : 1);
    const n = pool.length ? Math.min(pool.length, Math.max(1, Math.round(pool.length * share))) : 0;
    const hit = [...pool].sort((a, b) => a.id - b.id).slice(0, n);
    let fell = 0;
    for (const r of hit) {
      // from moderate, a drone bricked in flight falls
      if (isDrone(s, r) && away(r) && h.tier >= 1 && !h.drill) {
        loseRover(s, mods, r, `drone #${r.id} fell, bricked in flight by ${h.flare ? 'the flare' : 'v7.2'}`, h,
          h.flare ? 'the fleet was not docked' : 'the rollout was not held');
        fell++;
        continue;
      }
      r.brickedUntil = now + F.deadline[h.tier];
      r.brickedBy = h.id;
      r.site = null;
      r.pinned = false;
      delete r.road;
      h.hit.push(r.id);
    }
    if (!hit.length) { endHazard(s, h, h.used.dockFleet !== undefined ? 'answered: Dock fleet' : 'nobody out'); return; }
    alert(s, `ROVERS BRICKED — ${plural(h.hit.length, 'rover')} by ${h.flare ? 'the flare’s bit flips' : 'firmware v7.2'}` +
      `${fell ? ` · ${plural(fell, 'drone')} fell` : ''} · the docks re-flash them: each lost at its deadline (${fmtClock(F.deadline[h.tier])})`, 'crit');
    return;
  }
  const mine = s.rovers.filter((r) => r.brickedBy === h.id && (r.brickedUntil ?? 0) > 0);
  h.clockAt = mine.length ? Math.min(...mine.map((r) => r.brickedUntil!)) : 0;
  if (!mine.length) endHazard(s, h, s.losses.some((l) => l.at >= h.warnedAt && l.hazard === 'firmware') ? 'ignored: rovers lost' : 're-flashed');
}

// ── ROGUE DRONES ──
function tickRogue(s: GameState, mods: Mods, dt: number, h: LiveHazard, out: HazardTickResult) {
  const now = s.simTime;
  const dock = byId(s, h.n.dock);
  const t = byId(s, h.target);
  const stop = () => { if (t) t.stripT = 0; };
  if (!dock) { stop(); endHazard(s, h, 'the dock is gone'); return; }
  if ((dock.killUntil ?? 0) > now || (dock.reimageUntil ?? 0) > now) {
    stop();
    alert(s, `DRONES RECALLED — ${label(dock)}’s drones came home`, 'info', { select: dock.id });
    endHazard(s, h, h.used.killSwitch !== undefined ? 'answered: Kill switch' : 'answered: Reimage');
    return;
  }
  if (h.phase === 'telegraph') {
    if (!t) { endHazard(s, h, 'the target is gone'); return; }
    if (now < h.at) return;
    h.phase = 'active';
    t.stripT = now;
    h.hit = [t.id];
    alert(s, `STRIPPING — ${label(dock)}’s drones are taking ${label(t)} apart · wrecked at 100%`, 'crit', { select: t.id });
    return;
  }
  // the dock's drones are busy stripping
  for (const r of s.rovers) if (r.home === dock.id) { r.heldUntil = Math.max(r.heldUntil ?? 0, now + 2); r.site = null; }
  if (!t) { endHazard(s, h, 'stripped'); return; }
  t.wear = Math.min(1, t.wear + HZ.rogueDrones.stripPerS * dt);
  h.clockAt = now + (1 - t.wear) / HZ.rogueDrones.stripPerS;
  if (h.drill && t.wear >= 0.6) {
    stop();
    alert(s, `DRILL — ${label(dock)}’s drones stood down at 60%; next time they strip ${label(t)} to scrap`, 'info', { select: t.id });
    endHazard(s, h, 'drill');
    return;
  }
  if (t.wear < 1) return;
  recordLoss(s, mods, { what: 'building', name: label(t), cause: `${label(t)}, stripped by ${label(dock)}’s drones`, hazard: 'rogueDrones', warnedAt: h.warnedAt },
    'WRECKED', 'no kill switch', t.type, { select: dock.id });
  wreckBuilding(s, t.id, out.wrecked);
  h.n.wrecked = (h.n.wrecked ?? 0) + 1;
  const next = h.n.wrecked < HZ.rogueDrones.targets[h.tier] ? rogueTarget(s, dock, h.hit) : null;
  if (!next) { endHazard(s, h, 'ignored: wrecked'); return; }
  h.target = next.id;
  h.targetName = label(next);
  next.stripT = now;
  h.hit.push(next.id);
  alert(s, `ROGUE DRONES MOVE ON — ${label(dock)}’s drones start on ${label(next)}`, 'crit', { select: next.id });
}

// ── RUNAWAY RULE ──
function tickRunaway(s: GameState, mods: Mods, site: SiteDef, h: LiveHazard, out: HazardTickResult) {
  const now = s.simTime;
  const R = HZ.runaway;
  const rule = RULE_ORDER[h.n.rule ?? 0];
  const frozen = s.auto.frozenUntil > now;
  if (h.phase === 'telegraph') {
    if (frozen && h.used.freezeRules !== undefined) {
      alert(s, `RULE ATTESTED — ${h.targetName} was frozen before it ordered anything`, 'info', { panel: 'builder' });
      endHazard(s, h, 'answered: Freeze rules');
      return;
    }
    if (now < h.at) return;
    h.phase = 'active';
    h.n.nextSite = now;
    alert(s, `RUNAWAY RULE — ${h.targetName} orders junk: a site every ${fmtClock(R.everyS)} · cancel one within 20 s for a full refund`, 'crit', { panel: 'builder' });
  }
  const want = h.drill ? 2 : guard(mods, 'attestation') ? 1 : R.sites[h.tier];
  const mine = s.buildings.filter((b) => b.junk === h.id);
  h.hit = mine.map((b) => b.id);
  const endNow = frozen || (h.n.asked ?? 0) >= want || drillOver(s, h);
  if (!endNow && now >= (h.n.nextSite ?? 0)) {
    h.n.nextSite = now + R.everyS;
    h.n.asked = (h.n.asked ?? 0) + 1;
    const req = runawaySite(s, mods, site, rule, h.id);
    if (req) out.build.push(req);
  }
  if (!endNow) return;
  // the last welds land first (junkTick, after this, welds them): the loss keeps this warning.
  // A drill's junk never welds; it goes back once its 20 s are up.
  if (h.drill ? mine.some((b) => isSite(b) && now < (b.junkAt ?? 0) + R.weldS) : mine.some(isSite)) return;
  if (h.drill) {
    // the drill's junk goes back, every metal refunded
    for (const b of mine) removeJunk(s, site, b, out);
    alert(s, 'DRILL — the drifting rule was reset and its junk sites refunded; next time half their stock is gone', 'info', { panel: 'builder' });
  }
  endHazard(s, h, h.drill ? 'drill' : frozen ? 'answered: Freeze rules' : `ignored: ${plural(mine.length, 'junk site')}`);
}

/** A drill's junk site: removed with everything refunded. */
function removeJunk(s: GameState, site: SiteDef, b: BuildingState, out: HazardTickResult) {
  for (const [rid, amt] of Object.entries(buildCostAt(b.type, site))) s.resources[rid as ResourceId] += amt ?? 0;
  wreckBuilding(s, b.id, out.wrecked);
}

/** junk sites: the hijacked drones weld each one 20 s after placing it; half its stock is gone */
function junkTick(s: GameState, mods: Mods, site: SiteDef) {
  for (const b of s.buildings) {
    if (!b.junk || !isSite(b) || s.simTime < (b.junkAt ?? 0) + HZ.runaway.weldS) continue;
    const h = s.hazards.live.find((x) => x.id === b.junk);
    if (h?.drill) continue;
    b.construction = 0;
    b.spur = [];
    const cost = buildCostAt(b.type, site);
    const half = Object.entries(cost).map(([r, a]) => `${Math.ceil((a ?? 0) / 2)}${glyph(r as ResourceId)}`).join(' ');
    recordLoss(s, mods, {
      what: 'stock', name: `${label(b)} (${half})`, cause: `${label(b)} welded as junk by the drifting rule: half its stock wasted`,
      hazard: 'runaway', warnedAt: h?.warnedAt ?? s.simTime,
    }, 'STOCK WASTED', 'the rules were not frozen', b.type, { select: b.id });
    logAuto(s, `junk ${label(b)} welded by the drifting rule`, b.id);
  }
}

// ── HACKED OUTPOST ──
function tickOutpost(s: GameState, mods: Mods, h: LiveHazard, out: HazardTickResult) {
  const now = s.simTime;
  const o = s.survey.outposts.find((x) => x.id === h.outpost);
  if (!o) { endHazard(s, h, 'the outpost is gone'); return; }
  if (h.used.rotateKeys !== undefined) {
    o.hacked = false;
    out.modsChanged = true;
    alert(s, `KEYS ROTATED — ${h.targetName} streams again`, 'info');
    endHazard(s, h, 'answered: Rotate keys');
    return;
  }
  if (h.phase === 'telegraph') {
    if (now < h.at) return;
    h.phase = 'active';
    o.hacked = true;
    out.modsChanged = true;
    if (h.tier >= 2 && !h.drill) h.clockAt = now + HZ.hackedOutpost.lossS;
    alert(s, `OUTPOST HACKED — ${h.targetName}’s stream is diverted${h.clockAt ? ` · lost in ${fmtClock(h.clockAt - now)}` : ''}`, 'crit');
    return;
  }
  if (drillOver(s, h)) { o.hacked = false; out.modsChanged = true; endHazard(s, h, 'drill'); return; }
  if (!h.clockAt || now < h.clockAt) return;
  s.survey.outposts = s.survey.outposts.filter((x) => x.id !== o.id);
  out.modsChanged = true;
  recordLoss(s, mods, { what: 'outpost', name: h.targetName, cause: `${h.targetName}’s hopper was flown into the ground`, hazard: 'hackedOutpost', warnedAt: h.warnedAt },
    'OUTPOST LOST', 'the keys were never rotated · claim it again');
  endHazard(s, h, 'ignored: outpost lost');
}

// ─────────────────────────── the fleet: re-flash, deadlines, holds, reprints ───────────────────────────

function dockUp(s: GameState, b: BuildingState | undefined): boolean {
  return !!b && complete(b) && b.enabled && b.idleReason !== 'power' && !hazardOff(s, b) && !b.infected;
}

function fleetTick(s: GameState, mods: Mods, dt: number, out: HazardTickResult) {
  void dt; void out;
  const now = s.simTime;
  const hz = s.hazards;
  for (const r of s.rovers) if ((r.heldUntil ?? 0) > 0 && r.heldUntil! <= now) r.heldUntil = 0;
  if (hz.dronesHeldUntil > now) for (const r of s.rovers) if (isDrone(s, r)) r.heldUntil = Math.max(r.heldUntil ?? 0, hz.dronesHeldUntil);
  const bricked = s.rovers.filter((r) => (r.brickedUntil ?? 0) > 0).sort((a, b) => a.brickedUntil! - b.brickedUntil! || a.id - b.id);
  // each dock re-flashes its own rovers in their cradles, 1 per 30 s (a Hive 2
  // with Hive re-flash) while it is up: complete, on, powered, clean
  if (bricked.length && Math.floor(now / HZ.firmware.reflashS) !== Math.floor((now - 1) / HZ.firmware.reflashS)) {
    const docks = s.buildings.filter((b) => (BUILDINGS[b.type].bots ?? 0) > 0 && dockUp(s, b));
    const room = new Map(docks.map((b) => [b.id, b.type === 'droneHive' && guard(mods, 'hiveReflash') ? 2 : 1]));
    const fixed: RoverUnit[] = [];
    for (const r of bricked) {
      const at = r.home;
      if ((room.get(at) ?? 0) <= 0) continue;
      room.set(at, (room.get(at) ?? 0) - 1);
      r.brickedUntil = 0;
      r.brickedBy = undefined;
      fixed.push(r);
    }
    if (fixed.length) alert(s, `RE-FLASHED — ${fixed.map((r) => `#${r.id}`).join(', ')} back in the fleet`, 'info');
  }
  // deadlines
  for (const r of s.rovers.filter((x) => (x.brickedUntil ?? 0) > 0 && x.brickedUntil! <= now)) {
    const h = hz.live.find((x) => x.id === r.brickedBy);
    if (!h || h.drill) {
      r.brickedUntil = 0;
      r.brickedBy = undefined;
      alert(s, `RE-FLASHED FROM EARTH — rover #${r.id} (drill); next time a rover bricked at its deadline is lost`, 'info');
      continue;
    }
    loseRover(s, mods, r, `#${r.id} never came back from ${h.flare ? 'the flare’s bit flips' : 'v7.2'}`, h,
      h.flare ? 'the fleet was not docked' : 'the rollout was not held');
  }
  // reprints: a dock prints its lost rovers one at a time (10◆ 15⚙, 120 s)
  for (const b of s.buildings) {
    if (!(b.slotsLost ?? 0)) continue;
    if (b.reprintAt && now >= b.reprintAt) {
      b.slotsLost = Math.max(0, (b.slotsLost ?? 0) - 1);
      b.reprintAt = 0;
      alert(s, `REPRINTED — ${label(b)} printed a replacement ${b.type === 'droneHive' ? 'drone' : 'rover'}`, 'info', { select: b.id });
      continue;
    }
    if (!b.reprintAt && complete(b) && b.enabled && s.resources.metals >= HZ.reprint.metals && s.resources.parts >= HZ.reprint.parts) {
      s.resources.metals -= HZ.reprint.metals;
      s.resources.parts -= HZ.reprint.parts;
      b.reprintAt = now + HZ.reprint.s;
    }
  }
}

// ─────────────────────────── alerts for the live hazards ───────────────────────────

/** A hazard's counter buttons: the paid ones first, the free one last. */
export function hazardCounters(s: GameState, h: LiveHazard): AlertCounter[] {
  const b = byId(s, h.target);
  const c = (counter: CounterId, lbl: string, id: number | undefined = h.id): AlertCounter => ({ counter, id, label: lbl });
  switch (h.kind) {
    case 'breach': return [c('seal', `Seal ${HZ.breach.seal[h.tier]}⚙`), c('evacuate', 'Evacuate')];
    case 'cascade': return [c('shedLoads', 'Shed loads', undefined)];
    case 'blight': return [c('quarantine', 'Quarantine')];
    case 'contamination': return [c('flush', `Flush ${Math.round(HZ.contamination.flush * 100)}%≈`, undefined)];
    case 'dose': return h.phase === 'active' ? [c('medevac', 'Medevac')] : [c('recallEva', 'Recall EVA', undefined)];
    case 'cabinFever': return [c('commonsNight', `Commons night ${HZ.cabinFever.commonsNight.food}✳`, undefined), c('callHome', `Call home ${HZ.cabinFever.callHome.data}≡`, undefined)];
    case 'controlPlane': return [c('landDrones', 'Land drones', undefined)];
    case 'malware': return h.phase === 'telegraph' && b
      ? [{ counter: 'airGap', id: b.id, label: `Air-gap #${b.id}` }, c('reimage', `Reimage ${HZ.malware.reimage.data}≡`, b.id)]
      : [c('patch', `Patch ${HZ.malware.patch.data}≡`, undefined), ...h.hit.slice(0, 1).map((id) => c('reimage', `Reimage #${id} ${HZ.malware.reimage.data}≡`, id))];
    case 'firmware': return h.phase === 'telegraph' ? [h.flare ? c('dockFleet', 'Dock fleet') : c('holdRollout', 'Hold rollout')] : [];
    case 'rogueDrones': return [c('killSwitch', 'Kill switch')];
    case 'runaway': return [c('freezeRules', 'Freeze rules', undefined)];
    case 'hackedOutpost': return [c('rotateKeys', `Rotate keys ${HZ.hackedOutpost.chips}▣`)];
    default: return [];
  }
}

const bar = (f: number) => '▮'.repeat(Math.round(Math.max(0, Math.min(1, f)) * 5)).padEnd(5, '▯');

/** The line a live hazard's alert shows now. */
export function hazardText(s: GameState, h: LiveHazard): string {
  const now = s.simTime;
  const left = fmtClock(Math.max(0, h.at - now));
  const drill = h.drill ? ` · DRILL: it cannot ${HAZARDS[h.kind].destroys ? 'destroy' : 'kill'}` : '';
  const b = byId(s, h.target);
  const warn = (lethal: string) => (h.drill ? '' : lethal);
  switch (h.kind) {
    case 'breach': {
      if (h.phase === 'telegraph') {
        const occ = h.n.occupants ?? 0;
        const sealing = h.doneAt !== undefined ? ` · sealing, done in ${fmtClock(Math.max(0, h.doneAt - now))}${h.doneAt > h.at ? ' — too late' : ''}` : '';
        const evac = b && (b.evacT ?? 0) > now ? ' · evacuated' : '';
        return `SEAL FATIGUE — ${h.targetName} (${occ} aboard) hissing: breach in ${left}` +
          `${occ > 0 && !evac ? warn(' · people inside will die') : ''}${sealing}${evac}${drill}`;
      }
      return `BREACH — ${h.targetName} venting ${HZ.breach.vent[h.tier]}○/s · decompresses in ${fmtClock(Math.max(0, h.at + HZ.breach.decompressS - now))}${drill}`;
    }
    case 'cascade':
      if (h.phase === 'telegraph') {
        return `SCRUBBERS DOWN — ${h.targetName} (${h.n.occupants ?? 0} aboard) dark ${fmtClock(s.hazards.darkS[h.target ?? -1] ?? 0)}: CO₂ alarm in ${left}` +
          `${warn(' · people will need beds or suit air')}${drill}`;
      }
      return `LIFE-SUPPORT CASCADE — ${h.hit.map((id) => byId(s, id)).filter(Boolean).map((x) => label(x!)).join(', ')} evacuated · beds back 1:30 after power${drill}`;
    case 'blight':
      if (h.phase === 'telegraph') {
        const n = farmsNow(s).filter((f) => f.id !== h.target && b && dist(f, b) <= HZ.blight.clusterM).length;
        return `BLIGHT SPOTTED — ${h.targetName}: ${h.drill || !HZ.blight.spreadS[h.tier] ? 'yields drop' : `spreads to ${plural(n, 'neighbour')}`} in ${left}${drill}`;
      }
      return `BLIGHT — ${plural(h.hit.filter((id) => (byId(s, id)?.blightUntil ?? 0) > now).length, 'farm')} infected (−${Math.round((1 - HZ.blight.output[h.tier]) * 100)}%)` +
        `${!h.drill && HZ.blight.spreadS[h.tier] ? ` · next spread ${fmtClock(Math.max(0, (h.n.nextSpread ?? now) - now))}` : ''}${drill}`;
    case 'contamination':
      if (h.phase === 'telegraph') return `WATER ASSAY — heavy metals rising: unsafe in ${left}${warn(' · poisoned water can kill')}${drill}`;
      return `WATER UNSAFE — farms −${Math.round((1 - HZ.contamination.output[h.tier]) * 100)}%, a boil-water notice` +
        `${h.clockAt ? ` · poisoning in ${fmtClock(Math.max(0, h.clockAt - now))}` : ''}${drill}`;
    case 'dose':
      if (h.phase === 'telegraph') {
        const recalled = h.used.recallEva !== undefined ? ' · recalled' : ` — recall by ${left}${warn(' · a dose can kill')}`;
        return `${(h.n.eva ?? 0)} CREW ON EVA${recalled}${drill}`;
      }
      return `ACUTE DOSE — ${plural(h.n.lethal ?? 0, 'crew member')} will die in ${fmtClock(Math.max(0, h.clockAt - now))}`;
    case 'cabinFever':
      return `CABIN FEVER ${Math.floor(s.hazards.isolation)}/100 — a crisis in ~${fmtClock(Math.max(0, h.at - now))} at ` +
        `${(h.n.perDay ?? 0) >= 0 ? '+' : ''}${Math.round(h.n.perDay ?? 0)}/day${drill}`;
    case 'controlPlane':
      if (h.phase === 'telegraph') return `CONTROL PLANE DROPS in ${left} — no Data Center running${h.tier >= 2 && !h.drill ? ' · drones in flight will fall' : ''}${drill}`;
      return `CONTROL PLANE DOWN — agent-run output ×${HZ.controlPlane.output[h.tier]} · the Builder waits for a Data Center to run ${fmtClock(HZ.controlPlane.resumeS)}${drill}`;
    case 'malware':
      if (h.phase === 'telegraph') return `INTRUSION — worm on ${h.targetName}; unpacks in ${left}${drill}`;
      return `MALWARE — ${plural(h.hit.length, 'node')} infected, spreading every ${fmtClock(HZ.malware.spreadS[h.tier])}` +
        `${h.doneAt !== undefined ? ` · patching, ${fmtClock(Math.max(0, h.doneAt - now))}` : ''}${drill}`;
    case 'firmware':
      if (h.phase === 'telegraph') {
        return h.flare
          ? `${h.targetName.toUpperCase()} — bit flips when the flare hits in ${fmtClock(Math.max(0, (h.n.active ?? h.at) - now))}${drill}`
          : `FIRMWARE v7.2 FAILED ON THE CANARY — the fleet takes it in ${left} · ${Math.round(HZ.firmware.share[h.tier] * 100)}% brick${drill}`;
      }
      return `ROVERS BRICKED — ${plural(s.rovers.filter((r) => r.brickedBy === h.id).length, 'rover')} re-flashing` +
        `${h.clockAt ? ` · the next lost in ${fmtClock(Math.max(0, h.clockAt - now))} unless re-flashed` : ''}${drill}`;
    case 'rogueDrones': {
      const dock = byId(s, h.n.dock);
      if (h.phase === 'telegraph') return `ROGUE DRONES — ${dock ? label(dock) : 'a dock'}’s drones are retasked to strip ${h.targetName} in ${left}${drill}`;
      return `STRIPPING — ${h.targetName} ${bar(b?.wear ?? 0)} ${Math.round((b?.wear ?? 0) * 100)}% · wrecked at 100%${drill}`;
    }
    case 'runaway': {
      const r = RULES[RULE_ORDER[h.n.rule ?? 0]];
      const cap = s.auto.rules[r.id]?.cap ?? r.cap;
      if (h.phase === 'telegraph') return `RULE DRIFT — ${h.targetName}’s cap reads ${cap * 10}, not ${cap}: it orders in ${left}${drill}`;
      return `RUNAWAY RULE — ${plural(h.hit.length, 'junk site')} · cancel one within 20 s for a full refund${drill}`;
    }
    case 'hackedOutpost':
      if (h.phase === 'telegraph') return `OUTPOST INTRUSION — ${h.targetName} uplink spoofed; stream diverted in ${left}${drill}`;
      return `OUTPOST HACKED — ${h.targetName}’s stream diverted${h.clockAt ? ` · lost in ${fmtClock(Math.max(0, h.clockAt - now))}` : ''}${drill}`;
    default: return HAZARD_NAME[h.kind];
  }
}

/** can this hazard, as it stands, kill or destroy (the alert is crit and says so) */
export function hazardDeadly(s: GameState, h: LiveHazard): boolean {
  if (h.drill) return false;
  const def = HAZARDS[h.kind];
  if (!def.lethal && !def.destroys) return false;
  switch (h.kind) {
    case 'breach': return h.phase === 'active' || (h.n.occupants ?? 0) > 0 && HZ.breach.deaths[h.tier] > 0;
    case 'controlPlane': return h.tier >= 2;
    case 'malware': return h.tier >= 1;
    case 'hackedOutpost': return h.tier >= 2;
    case 'blight': return h.tier >= 1;
    case 'dose': return h.tier >= 2 || s.hazards.doseLoad + (h.n.eva ?? 0) > HZ.dose.limit;
    default: return true;
  }
}

function raiseLive(s: GameState, mods: Mods, h: LiveHazard) {
  void mods;
  const key = `hz:${h.id}`;
  const deadly = hazardDeadly(s, h);
  const tag = deadly ? (HAZARDS[h.kind].lethal ? ' · ⚠ can kill' : ' · ⚠ destroys') : '';
  const kind = deadly || h.tier >= 2 || h.phase === 'active' ? 'crit' : 'warn';
  condition(s, key, `${SIDE_GLYPH[h.side]} ${hazardText(s, h)}${tag}`, kind, h.target !== null ? { select: h.target } : undefined);
  withCounters(s, key, hazardCounters(s, h));
  // death clocks: their own crit condition with a countdown
  if (h.clockAt && !h.drill) {
    const ck = `hzc:${h.id}`;
    const t = fmtClock(Math.max(0, h.clockAt - s.simTime));
    const b = byId(s, h.target);
    const text = h.kind === 'contamination' ? `POISONING — 1 crew critical: dies in ${t}`
      : h.kind === 'dose' ? `ACUTE DOSE — ${plural(h.n.lethal ?? 0, 'crew member')} will die in ${t}`
      : h.kind === 'malware' ? (h.tier === 1 ? `RANSOM — 15% of banked data wiped in ${t}` : `BURN-OUT — ${byId(s, h.n.clockNode) ? label(byId(s, h.n.clockNode)!) : 'a node'} wrecked in ${t}`)
      : h.kind === 'firmware' ? `RE-FLASH DEADLINE — a bricked rover is lost in ${t}`
      : h.kind === 'rogueDrones' ? `STRIP BAR — ${b ? label(b) : h.targetName} wrecked in ${t}`
      : h.kind === 'hackedOutpost' ? `OUTPOST LOST in ${t} — ${h.targetName}`
      : '';
    if (!text) return;
    // within the last 3:00 of a slow clock, or any fast one
    if (h.clockAt - s.simTime <= Math.max(HZ.malware.criticalS, 0) || h.kind === 'firmware' || h.kind === 'rogueDrones' || h.kind === 'dose') {
      condition(s, ck, text, 'crit', b ? { select: b.id } : undefined);
      withCounters(s, ck, hazardCounters(s, h));
    }
  }
}

// ─────────────────────────── counters (§3.7) ───────────────────────────

export interface CounterResult { ok: boolean; reason: string }
const yes: CounterResult = { ok: true, reason: '' };
const no = (reason: string): CounterResult => ({ ok: false, reason });

function liveFor(s: GameState, kind: HazardId, id?: number): LiveHazard | undefined {
  return s.hazards.live.find((h) => h.kind === kind && (id === undefined || h.id === id)) ??
    (id !== undefined ? s.hazards.live.find((h) => h.kind === kind && h.target === id) : undefined);
}

const roverFree = (s: GameState) => s.rovers.some((r) => !((r.brickedUntil ?? 0) > 0) && !((r.heldUntil ?? 0) > s.simTime));

/** Run a counter (the `counter` action; it works while paused). A refusal says why, and names the free fallback. */
export function applyCounter(s: GameState, mods: Mods, counter: CounterId, id?: number): CounterResult {
  if (off(s)) return no('HAZARDS ARE NOT LIVE');
  const now = s.simTime;
  const hz = s.hazards;
  const used = (h: LiveHazard) => { h.used[counter] = now; };
  switch (counter) {
    case 'seal': {
      const h = liveFor(s, 'breach', id);
      if (!h) return no('NOTHING TO SEAL — no breach is warned');
      if (h.doneAt !== undefined) return no(`ALREADY SEALING — ${h.targetName} is sealed in ${fmtClock(Math.max(0, h.doneAt - now))}`);
      const cost = HZ.breach.seal[h.tier];
      const occ = h.n.occupants ?? 0;
      const fallback = occ > 0 ? ` · [Evacuate] saves the ${occ} aboard` : '';
      if (s.resources.parts < cost) return no(`SEAL NEEDS ${cost}⚙ — have ${Math.floor(s.resources.parts)}${fallback}`);
      if (!roverFree(s)) return no(`SEAL NEEDS A ROVER — the fleet is bricked or held${fallback}`);
      s.resources.parts -= cost;
      h.doneAt = now + HZ.breach.sealS;
      used(h);
      const late = h.phase === 'telegraph' && h.doneAt > h.at;
      alert(s, `SEALING — ${h.targetName}: a rover seals it in ${fmtClock(HZ.breach.sealS)}${late ? ' — AFTER the breach opens' : ''}`,
        late ? 'warn' : 'info', h.target !== null ? { select: h.target } : undefined);
      return yes;
    }
    case 'evacuate': {
      const h = liveFor(s, 'breach', id);
      if (!h) return no('NOTHING TO EVACUATE — no breach is warned');
      const b = byId(s, h.target);
      if (!b) return no('NO SUCH BUILDING');
      if ((b.evacT ?? 0) > now) return no(`ALREADY EVACUATED — ${label(b)}`);
      const n = occupancy(s, mods).get(b.id) ?? 0;
      b.evacT = UNTIL_SEALED;
      used(h);
      h.n.occupants = 0;
      alert(s, `EVACUATED — ${label(b)}: ${plural(n, 'crew member')} moved out; its beds are off until it is sealed`, 'info', { select: b.id });
      return yes;
    }
    case 'repair': {
      const b = byId(s, id);
      if (!b || !b.decompressed) return no('NOTHING TO REPAIR — no decompressed section');
      if (s.resources.parts < HZ.breach.repair) return no(`REPAIR NEEDS ${HZ.breach.repair}⚙ — have ${Math.floor(s.resources.parts)}`);
      s.resources.parts -= HZ.breach.repair;
      b.decompressed = false;
      alert(s, `REPAIRED — ${label(b)} holds air again`, 'info', { select: b.id });
      return yes;
    }
    case 'shedLoads': {
      hz.shedUntil = now + HZ.cascade.shedS;
      for (const h of hz.live) if (h.kind === 'cascade') used(h);
      alert(s, `LOADS SHED — every priority 2–3 load off for ${fmtClock(HZ.cascade.shedS)}: the bank feeds priority 0`, 'info', { panel: 'power' });
      return yes;
    }
    case 'quarantine': {
      const h = liveFor(s, 'blight', id);
      if (!h) return no('NOTHING TO QUARANTINE — no blight is warned');
      const regrow = guard(mods, 'seedBank') ? 60 : CROP_LOSS.regrowS;
      const ids = new Set([...(h.target !== null ? [h.target] : []), ...h.hit]);
      for (const fid of ids) {
        const f = byId(s, fid);
        if (!f) continue;
        f.cropRegrowT = regrow;
        f.blightUntil = 0;
      }
      used(h);
      alert(s, `QUARANTINED — ${plural(ids.size, 'crop')} burned; regrowing ${fmtClock(regrow)}, and the blight stops there`, 'info');
      endHazard(s, h, 'answered: Quarantine');
      return yes;
    }
    case 'flush': {
      const dumped = Math.floor(s.resources.water * HZ.contamination.flush);
      s.resources.water -= dumped;
      hz.loopAge = 0;
      const h = liveFor(s, 'contamination');
      if (h) { used(h); endHazard(s, h, 'answered: Flush'); }
      alert(s, `FLUSHED — ${dumped}${glyph('water')} dumped; the loop is clean`, 'info', { panel: 'water' });
      return yes;
    }
    case 'recallEva': {
      const h = liveFor(s, 'dose');
      if (!h || h.phase !== 'telegraph') return no('NOBODY TO RECALL — no crew is out before a flare');
      if (h.used.recallEva !== undefined) return no('ALREADY RECALLED — the EVA crews are coming in');
      used(h);
      const late = now > h.at;
      alert(s, late ? `RECALL TOO LATE — the EVA crews cannot reach an airlock before the flare`
        : `EVA RECALLED — everyone comes in; the EVA bonus stops for the flare`, late ? 'warn' : 'info', { panel: 'crew' });
      return yes;
    }
    case 'medevac': {
      const h = liveFor(s, 'dose', id);
      if (!h || !(h.n.lethal ?? 0)) return no('NOBODY TO MEDEVAC — no one has a lethal dose');
      if (s.resupply?.pending) {
        return no(`MEDEVAC NEEDS THE SHIPMENT SLOT — busy until ${fmtClock(Math.max(0, (s.resupply.arriveAt ?? now) - now))} from now`);
      }
      h.n.lethal = (h.n.lethal ?? 1) - 1;
      s.crew = Math.max(0, s.crew - 1);
      s.resupply = { ...(s.resupply ?? { shipments: 0 }), pending: true, downlink: false, medevac: true, arriveAt: now + CYCLE_S / 2 };
      alert(s, 'MEDEVAC — the shipment slot flies one dosed crew member home alive', 'info', landerAction(s));
      if (!h.n.lethal) h.clockAt = now;
      return yes;
    }
    case 'commonsNight': {
      const C = HZ.cabinFever.commonsNight;
      if (s.resources.food < C.food) return no(`COMMONS NIGHT NEEDS ${C.food}✳ — have ${Math.floor(s.resources.food)}`);
      s.resources.food -= C.food;
      hz.isolation = Math.max(0, hz.isolation - C.ease);
      alert(s, `COMMONS NIGHT — a feast: cabin fever ${Math.floor(hz.isolation)}/100`, 'info', { panel: 'crew' });
      return yes;
    }
    case 'callHome': {
      const C = HZ.cabinFever.callHome;
      if (now - hz.callHomeAt < CYCLE_S) return no(`CALL HOME ONCE A LUNAR DAY — next in ${fmtClock(CYCLE_S - (now - hz.callHomeAt))}`);
      if (s.data < C.data) return no(`CALL HOME NEEDS ${C.data}≡ — have ${Math.floor(s.data)}`);
      s.data -= C.data;
      hz.callHomeAt = now;
      hz.isolation = Math.max(0, hz.isolation - C.ease);
      alert(s, `CALLED HOME — cabin fever ${Math.floor(hz.isolation)}/100`, 'info', landerAction(s));
      return yes;
    }
    case 'clean': {
      const b = byId(s, id);
      if (!b || (b.airlockDust ?? 0) <= 0) return no('NOTHING TO CLEAN — that airlock is clear');
      if (s.resources.parts < HZ.dust.clean) return no(`CLEAN NEEDS ${HZ.dust.clean}⚙ — have ${Math.floor(s.resources.parts)}`);
      s.resources.parts -= HZ.dust.clean;
      b.airlockDust = 0;
      alert(s, `CLEANED — ${label(b)}’s airlock filters are new`, 'info', { select: b.id });
      return yes;
    }
    case 'landDrones': {
      const drones = s.rovers.filter((r) => isDrone(s, r));
      if (!drones.length) return no('NO DRONES — only Drone Hives fly them');
      // 120 s by day; from the dusk warning on, until dawn (the forecast's Data Centers go dark at night)
      const t = now % CYCLE_S;
      hz.dronesHeldUntil = t >= DAY_S - DUSK_WARN_S ? now - t + CYCLE_S : now + HZ.controlPlane.holdS;
      for (const r of drones) { r.heldUntil = hz.dronesHeldUntil; r.site = null; r.pinned = false; delete r.road; }
      for (const h of hz.live) if (h.kind === 'controlPlane') used(h);
      alert(s, `DRONES LANDED — ${plural(drones.length, 'drone')} set down for ${fmtClock(hz.dronesHeldUntil - now)}, and while the control plane is down`, 'info');
      return yes;
    }
    case 'reimage': {
      const b = byId(s, id);
      if (!b) return no('NO SUCH NODE');
      const warned = hz.live.some((h) => h.kind === 'malware' && h.target === b.id) || hz.live.some((h) => h.kind === 'rogueDrones' && h.n.dock === b.id);
      if (!b.infected && !warned) return no(`NOTHING TO REIMAGE — ${label(b)} is clean`);
      if ((b.reimageUntil ?? 0) > now) return no(`ALREADY REIMAGING — ${label(b)}`);
      const M = HZ.malware.reimage;
      if (s.data < M.data) return no(`REIMAGE NEEDS ${M.data}≡ — have ${Math.floor(s.data)} · [Air-gap] stops the spread`);
      s.data -= M.data;
      b.reimageUntil = now + (guard(mods, 'watchdogs') ? M.watchdogS : M.s);
      b.infected = false;
      b.infectedAt = undefined;
      for (const h of hz.live) if (h.kind === 'malware' || h.kind === 'rogueDrones') used(h);
      alert(s, `REIMAGING — ${label(b)} offline ${fmtClock(b.reimageUntil - now)}, then clean`, 'info', { select: b.id });
      return yes;
    }
    case 'patch': {
      const h = liveFor(s, 'malware');
      if (!h) return no('NOTHING TO PATCH — no malware is warned');
      if (h.doneAt !== undefined) return no(`ALREADY PATCHING — done in ${fmtClock(Math.max(0, h.doneAt - now))}`);
      if (!computeRunning(s).length) return no('PATCH NEEDS A RUNNING DATA CENTER OR MONOLITH · [Air-gap] stops the spread');
      if (s.data < HZ.malware.patch.data) return no(`PATCH NEEDS ${HZ.malware.patch.data}≡ — have ${Math.floor(s.data)} · [Air-gap] stops the spread`);
      s.data -= HZ.malware.patch.data;
      h.doneAt = now + HZ.malware.patch.s;
      if (h.phase === 'telegraph') { hz.immuneUntil = now + HZ.malware.patch.s + HZ.malware.patch.immuneS; }
      used(h);
      alert(s, `PATCHING — every node clean in ${fmtClock(HZ.malware.patch.s)}, then immune for a lunar day`, 'info');
      return yes;
    }
    case 'holdRollout': {
      const h = liveFor(s, 'firmware', id);
      if (!h || h.flare || h.phase !== 'telegraph') return no('NO ROLLOUT TO HOLD');
      used(h);
      alert(s, 'ROLLOUT HELD — v7.2 stays on the canary', 'info');
      endHazard(s, h, 'answered: Hold rollout');
      return yes;
    }
    case 'dockFleet': {
      const h = liveFor(s, 'firmware', id) ?? hz.live.find((x) => x.kind === 'firmware' && x.flare);
      if (!h || !h.flare || h.phase !== 'telegraph') return no('NO FLARE TO DOCK FOR');
      const until = (h.n.active ?? now) + FLARE.activeS;
      for (const r of s.rovers) { r.heldUntil = Math.max(r.heldUntil ?? 0, until); r.site = null; r.pinned = false; delete r.road; }
      used(h);
      alert(s, `FLEET DOCKED — every rover home until the flare passes (${fmtClock(until - now)}); construction pauses`, 'info');
      return yes;
    }
    case 'killSwitch': {
      const h = liveFor(s, 'rogueDrones', id);
      if (!h) return no('NOTHING TO KILL — no rogue drones are warned');
      const dock = byId(s, h.n.dock);
      if (!dock) return no('NO SUCH DOCK');
      dock.killUntil = now + HZ.rogueDrones.killS;
      for (const r of s.rovers) if (r.home === dock.id) { r.heldUntil = dock.killUntil; r.site = null; r.pinned = false; delete r.road; }
      used(h);
      alert(s, `KILL SWITCH — ${label(dock)} offline ${fmtClock(HZ.rogueDrones.killS)}; its drones come home`, 'info', { select: dock.id });
      return yes;
    }
    case 'freezeRules': {
      freezeRules(s, HZ.audit.freezeS);
      for (const h of hz.live) if (h.kind === 'runaway') used(h);
      alert(s, `RULES FROZEN — the Builder holds every rule for ${fmtClock(HZ.audit.freezeS)}`, 'info', { panel: 'builder' });
      return yes;
    }
    case 'rotateKeys': {
      const h = liveFor(s, 'hackedOutpost', id);
      if (!h) return no('NO KEYS TO ROTATE — no outpost is warned');
      if (s.resources.chips < HZ.hackedOutpost.chips) return no(`ROTATE KEYS NEEDS ${HZ.hackedOutpost.chips}▣ — have ${Math.floor(s.resources.chips)}`);
      s.resources.chips -= HZ.hackedOutpost.chips;
      used(h);
      return yes;
    }
  }
}

/** Air-gap a node (or reconnect it): stops spread both ways; an agent-run station idles unless crewed. */
export function setAirGap(s: GameState, mods: Mods, id: number, on: boolean): CounterResult {
  const b = byId(s, id);
  if (!b) return no('NO SUCH BUILDING');
  const g = networkGraph({ ...s, buildings: s.buildings.map((x) => (x.id === id ? { ...x, airGapped: false } : x)) }, mods);
  if (!g.byId.has(id)) return no(`NOT A NETWORK NODE — ${label(b)} has no link to gap`);
  b.airGapped = on;
  alert(s, on ? `AIR-GAPPED — ${label(b)} has no links${agentStation(s, b) ? '; agent-run, it idles unless crewed' : ''}` +
    (b.type === 'lander' ? '; the Earth link is cut: no downlink, no outpost streams' : '')
    : `RECONNECTED — ${label(b)} is back on the network`, 'info', { select: b.id });
  return yes;
}

// ─────────────────────────── debug ───────────────────────────

/** debug.forceHazard: start one now, bypassing the scheduler (the first of a kind is still its drill unless opts say). */
export function forceHazard(s: GameState, mods: Mods, site: SiteDef, kind: HazardId, target?: number, o: { drill?: boolean; tier?: Tier } = {}): LiveHazard | string {
  if (off(s)) return 'HAZARDS ARE NOT LIVE';
  if (kind === 'cabinFever') {
    s.hazards.isolation = Math.max(s.hazards.isolation, HZ.cabinFever.warnAt);
    const h = startHazard(s, mods, site, kind, { at: s.simTime + CYCLE_S, drill: o.drill, tier: o.tier });
    if (typeof h !== 'string') h.targetName = 'the crew';
    return h;
  }
  if (kind === 'dose') {
    const drill = o.drill ?? !s.hazards.drilled.includes('dose');
    if (s.flare.phase === 'idle') { s.flare.phase = 'telegraph'; s.flare.timer = FLARE.telegraphS; s.hazards.flarePrev = 'telegraph'; }
    const h = startHazard(s, mods, site, 'dose', { at: s.simTime + FLARE.telegraphS - HZ.dose.walkInS, drill, tier: o.tier });
    if (typeof h !== 'string') { h.n.eva = Math.max(1, s.evaCrew); h.n.active = s.simTime + FLARE.telegraphS; h.targetName = `${h.n.eva} crew on EVA`; }
    return h;
  }
  if (kind === 'controlPlane') {
    const drill = o.drill ?? !s.hazards.drilled.includes(kind);
    return startHazard(s, mods, site, kind, { at: s.simTime + HZ.controlPlane.darkS + (drill ? HZ.drillExtraS : 0), drill, tier: o.tier });
  }
  if (kind === 'cascade') {
    const drill = o.drill ?? !s.hazards.drilled.includes(kind);
    const home = target ?? s.buildings.find((b) => homeType(b) && complete(b))?.id;
    const h = startHazard(s, mods, site, kind, { at: s.simTime + HZ.cascade.alarmS + (drill ? HZ.drillExtraS : 0), drill, tier: o.tier, target: home });
    if (typeof h !== 'string' && home !== undefined) h.n.occupants = occupancy(s, mods).get(home) ?? 0;
    return h;
  }
  return startHazard(s, mods, site, kind, { target, drill: o.drill, tier: o.tier });
}

// ─────────────────────────── the view ───────────────────────────

export interface HazardLiveView {
  id: number; kind: HazardId; name: string; side: HazardSide; tier: Tier; tierLabel: string; drill: boolean;
  phase: LiveHazard['phase']; target: number | null; targetName: string; text: string;
  /** seconds on the telegraph (or the second clock once active) */
  left: number; clockLeft: number | null;
  deadly: boolean; lethal: boolean; destroys: boolean;
  counters: AlertCounter[];
}
export interface HazardKindView {
  id: HazardId; name: string; side: HazardSide; glyph: string; risk: number; level: 'low' | 'med' | 'high' | '—';
  target: string; guards: { name: string; on: boolean }[]; counter: string;
}
export interface HazardSideView { side: HazardSide; glyph: string; label: string; tier: Tier | null; tierLabel: string; picks: number; nextIn: number | null }
export interface HazardMarker { id: number; glyph: string; text: string; frac?: number }
export interface HazardView {
  live: boolean; started: boolean; startsIn: number | null;
  sides: HazardSideView[];
  kinds: HazardKindView[];
  graph: { nodes: { id: number; name: string; x: number; z: number; infected: boolean; gapped: boolean }[]; links: [number, number][] };
  active: HazardLiveView[];
  log: { at: number; text: string }[];
  deaths: number; losses: number;
  /** the objectives panel's live line ('' = none) */
  objective: string;
  markers: HazardMarker[];
  /** for the renderer (the look): per building, what a hazard does to it */
  fx: Record<number, ('flicker' | 'smoke' | 'vent' | 'strip' | 'blight' | 'dust' | 'dark')[]>;
  meters: { isolation: number; doseLoad: number; loopAge: number };
  /** the HUD chip: ⌂ HAB ▮▮▯ · ◉ NET ▮▯▯ */
  chip: string;
  flash: boolean;
  solid: boolean;
}

const GUARDS_OF = (kind: HazardId) => (Object.keys(GUARD_FOR) as GuardId[]).filter((g) => GUARD_FOR[g] === kind);

export function hazardView(s: GameState, mods: Mods): HazardView {
  const hz = s.hazards;
  const now = s.simTime;
  const started = hazardsStarted(s);
  const startAt = hazardsStartAt(s);
  const picks = sidePicks(s);
  const sides: HazardSideView[] = (['colony', 'automation'] as HazardSide[]).map((side) => {
    const tier = sideTier(s, side);
    return {
      side, glyph: SIDE_GLYPH[side], label: side === 'colony' ? 'HAB' : 'NET', tier, tierLabel: tier === null ? 'none' : TIER_LABEL[tier],
      picks: picks[side], nextIn: tier === null || !started ? null : Math.max(0, hz.nextAt - now),
    };
  });
  const g = networkGraph(s, mods);
  const kinds: HazardKindView[] = HAZARD_ORDER.map((k) => {
    const side = HAZARD_SIDE[k];
    const tier = sideTier(s, side);
    let risk = -1;
    let target = '—';
    if (tier !== null && HAZARDS[k].cls === 'window') {
      const p = k === 'malware' ? malwarePick(s, mods, g) : kindPick(s, mods, k, tier);
      risk = p.risk;
      target = p.name || '—';
    } else if (tier !== null) {
      if (k === 'cabinFever' && mods.exposure.has('cabinFever')) { risk = hz.isolation / 100; target = 'the crew'; }
      if (k === 'dust') {
        const worst = s.buildings.reduce<BuildingState | null>((m, b) => ((b.airlockDust ?? 0) > (m?.airlockDust ?? 0) ? b : m), null);
        risk = worst?.airlockDust ?? 0;
        target = worst ? label(worst) : '—';
      }
      if (k === 'dose' && mods.evaShare > 0) { risk = Math.min(1, hz.doseLoad / HZ.dose.limit + 0.1); target = 'EVA crews'; }
      if (k === 'cascade') { risk = s.buildings.some((b) => homeType(b) && (hz.darkS[b.id] ?? 0) > 0) ? 1 : 0; target = 'dark habitats'; }
      if (k === 'controlPlane' && mods.exposure.has('controlPlane')) { risk = computeRunning(s).length <= 1 ? 0.6 : 0.1; target = 'the Data Centers'; }
    }
    return {
      id: k, name: HAZARD_NAME[k], side, glyph: HAZARDS[k].glyph, risk,
      level: risk < 0 ? '—' : risk < HZ.nearMiss ? 'low' : risk < 0.5 ? 'med' : 'high',
      target, guards: GUARDS_OF(k).map((gid) => ({ name: GUARD_TEXT[gid].split(':')[0], on: guard(mods, gid) })),
      counter: HAZARDS[k].counters.map((c) => COUNTERS[c].name).join(' · ') + (HAZARDS[k].free === 'airGap' ? ' · Air-gap' : ''),
    };
  });
  const active: HazardLiveView[] = hz.live.map((h) => ({
    id: h.id, kind: h.kind, name: HAZARD_NAME[h.kind], side: h.side, tier: h.tier, tierLabel: TIER_LABEL[h.tier], drill: h.drill,
    phase: h.phase, target: h.target, targetName: h.targetName, text: hazardText(s, h),
    left: Math.max(0, h.at - now), clockLeft: h.clockAt ? Math.max(0, h.clockAt - now) : null,
    deadly: hazardDeadly(s, h), lethal: !!HAZARDS[h.kind].lethal, destroys: !!HAZARDS[h.kind].destroys,
    counters: hazardCounters(s, h),
  }));
  // the objectives line: the most urgent lethal telegraph or death clock
  let objective = '';
  const urgent = active.filter((a) => a.deadly || a.clockLeft !== null || hz.suit.some((x) => x.hazard === a.id))
    .sort((a, b) => (a.clockLeft ?? a.left) - (b.clockLeft ?? b.left))[0];
  if (urgent) {
    const t = fmtClock(urgent.clockLeft ?? urgent.left);
    const verb: Partial<Record<HazardId, string>> = {
      breach: `breach in ${t} — seal or evacuate`, cascade: `CO₂ alarm in ${t} — shed loads`, blight: `blight in ${t} — quarantine`,
      contamination: `water unsafe in ${t} — flush`, dose: `recall EVA by ${t}`, controlPlane: `control plane in ${t} — land the drones`,
      malware: `worm in ${t} — air-gap or reimage`, firmware: `rovers brick in ${t} — hold or dock`, rogueDrones: `wrecked in ${t} — kill switch`,
      runaway: `junk in ${t} — freeze the rules`, hackedOutpost: `outpost in ${t} — rotate keys`,
    };
    objective = `⚠ ${urgent.targetName}: ${verb[urgent.kind] ?? t}`;
  }
  const suit = hz.suit[0];
  if (suit) objective = `⚠ ${plural(suit.n, 'crew member')} on suit air: ${fmtClock(Math.max(0, suit.until - now))} — power or a bed`;
  // markers and the look's hooks
  const markers: HazardMarker[] = [];
  const fx: HazardView['fx'] = {};
  const addFx = (id: number, f: HazardView['fx'][number][number]) => { (fx[id] ??= []).includes(f) || fx[id].push(f); };
  const occ = occupancy(s, mods);
  for (const h of hz.live) {
    const b = byId(s, h.target);
    if (h.kind === 'breach' && b) { markers.push({ id: b.id, glyph: '≋', text: `${occ.get(b.id) ?? 0}${h.phase === 'active' ? ' VENT' : ''}` }); addFx(b.id, h.phase === 'active' ? 'vent' : 'smoke'); }
    if (h.kind === 'cascade') for (const id of h.target !== null ? [h.target, ...h.hit] : h.hit) { const x = byId(s, id); if (x) { markers.push({ id, glyph: '☍', text: `${occ.get(id) ?? 0}` }); addFx(id, 'dark'); } }
    if (h.kind === 'blight') for (const id of h.phase === 'telegraph' && h.target !== null ? [h.target] : h.hit) { markers.push({ id, glyph: '✲', text: 'BLIGHT' }); addFx(id, 'blight'); }
    if (h.kind === 'malware' && h.phase === 'telegraph' && b) markers.push({ id: b.id, glyph: '⚠', text: 'NET' });
    if (h.kind === 'rogueDrones' && b) { markers.push({ id: b.id, glyph: '✈', text: `${Math.round(b.wear * 100)}%`, frac: h.phase === 'active' ? b.wear : undefined }); if (h.phase === 'active') addFx(b.id, 'strip'); }
  }
  for (const b of s.buildings) {
    if (b.infected) { markers.push({ id: b.id, glyph: '⚠', text: 'NET' }); addFx(b.id, 'flicker'); }
    if ((b.airlockDust ?? 0) >= HZ.dust.warnAt) addFx(b.id, 'dust');
  }
  const seen = new Set<number>();
  const uniq = markers.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
  const gauge = (t: Tier | null) => (t === null ? '' : '▮'.repeat(t + 1).padEnd(3, '▯'));
  const chip = sides.filter((x) => x.tier !== null).map((x) => `${x.glyph} ${x.label} ${gauge(x.tier)}`).join(' · ');
  return {
    live: HAZARDS_LIVE && sides.some((x) => x.tier !== null), started,
    startsIn: startAt === null || started ? null : Math.max(0, startAt - now),
    sides, kinds,
    graph: { nodes: g.nodes.map((n) => ({ id: n.id, name: n.name, x: n.x, z: n.z, infected: n.infected, gapped: n.gapped })),
      links: g.nodes.flatMap((n) => n.links.filter((l) => l > n.id).map((l) => [n.id, l] as [number, number])) },
    active,
    log: hz.log.slice(-8).reverse().map((e) => ({
      at: e.at, text: `${SIDE_GLYPH[HAZARD_SIDE[e.kind]]} ${HAZARD_NAME[e.kind]}${e.drill ? ' (drill)' : ''} · ${e.target} — ${e.outcome}`,
    })),
    deaths: (s.deaths ?? []).length, losses: (s.losses ?? []).length,
    objective, markers: uniq, fx,
    meters: { isolation: hz.isolation, doseLoad: hz.doseLoad, loopAge: hz.loopAge },
    chip, flash: active.some((a) => a.phase === 'telegraph'),
    solid: active.some((a) => a.clockLeft !== null) || hz.suit.length > 0,
  };
}

/** What a hazard does to one building now, for the inspector ('' = nothing). */
export function hazardStatus(s: GameState, b: BuildingState): string {
  const off = hazardOff(s, b);
  if (off) return off;
  if (b.infected) return 'INFECTED — ×0.5 output, ×1.3 draw';
  if ((b.blightUntil ?? 0) > s.simTime) return 'BLIGHTED';
  return '';
}

/** Is this building a network node (the inspector's air-gap row)? */
export function isNetworkNode(s: GameState, mods: Mods, b: BuildingState): boolean {
  if (sideTier(s, 'automation') === null || isSite(b)) return false;
  const types = new Set<BuildingId>(NETWORK_NODES);
  for (const t of mods.exposure.get('malware') ?? []) types.add(t);
  return types.has(b.type) || (sidePicks(s).automation >= 2 && agentStation(s, b));
}

export { SIDE_GLYPH as HAZARD_SIDE_GLYPH };
