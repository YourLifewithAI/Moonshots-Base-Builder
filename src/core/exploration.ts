/** Exploration runtime (spec §5, S11): what the base has mapped around it,
 *  the build network, surveys of the 34 prospects, outposts and the atlas.
 *  explorationTick runs as economy step 8.7; the actions call startSurvey,
 *  claimOutpost and abandonOutpost and alert any refusal. */
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { SITES, type SiteDef, type SiteId } from '../data/sites';
import { TECHS, TECH_ORDER, type TechId } from '../data/techs';
import { RESOURCES, type ResourceId } from '../data/resources';
import { ATLAS, CELL_M, CYCLE_S, INSIGHT_MAX, MAP_M, SURVEY_TIERS } from '../data/balance';
import { DEPOSIT_INFO, LEAD_RANGE_M } from '../data/deposits';
import {
  ANOMALY_BONUS_DATA, HOPPER, NOVELTY, OUTPOST_CLASS, OUTPOST_KINDS, OUTPOST_LINK_KW, PROSPECTS, PROSPECT_IDS,
  SAMPLE_CACHE, SURVEY_CLASS, TIER_TECH, TIER_VIEW, MAP_VIEWS,
  type MapView, type OutpostKind, type ProspectClass, type ProspectId,
} from '../data/lunarMap';
import type { Deposit } from '../terrain/heightfield';
import type { DepositView, LunarOutpostView, LunarProspectView, LunarRivalView, LunarView } from '../ui/stores';
import { centerOf, footprintRect } from '../buildings/instances';
import type { FieldReward, GameState, OutpostState } from './state';
import type { Mods, SurveyTier } from './mods';
import { alert, condition, crewReserve } from './economy';
import { insightTick, resolveTech } from './research';
import { fleetCount, fleetLists, fleetTick, flightTo, landFlight, launchFlight, nextReadyIn, readyDrone } from './surveyDrones';
import { ruleState } from './automation';
import { fmtClock } from './daynight';
import { recordSpend } from './flowBook';
import { commsDark, holdStream } from './flareEffects';
import { notify } from '../ui/notify';
import { claimantOf, factionName, moonOf, type FactionId } from './moon';

export interface ActionResult { ok: boolean; reason: string }
const OK: ActionResult = { ok: true, reason: '' };
const no = (reason: string): ActionResult => ({ ok: false, reason });
const glyph = (r: ResourceId) => RESOURCES[r].glyph;
/** whole seconds left until `at` (game time drifts by float fractions) */
const secsLeft = (s: GameState, at: number) => Math.max(0, Math.ceil(at - s.simTime - 1e-6));

// ─────────────────────────── the ground around the base ───────────────────────────

/** Where the Lander stands (the map heart before it lands). */
export function landerXZ(s: GameState): [number, number] {
  const l = s.buildings.find((b) => b.type === 'lander');
  return l ? centerOf(l) : [0, 0];
}

export function revealRadiusM(tier: SurveyTier): number {
  return SURVEY_TIERS[tier].revealM;
}

const complete = (b: { construction?: number }) => (b.construction ?? 0) <= 0;

/** the techs that widen a type's network radius (Dispatch Mesh): [tech, type, +m] */
const RADIUS_FX: [TechId, BuildingId, number][] = TECH_ORDER.flatMap((t) => TECHS[t].effects
  .flatMap((fx) => (fx.kind === 'radius' ? [[t, fx.building, fx.deltaM] as [TechId, BuildingId, number]] : [])));

/** A type's build-network radius here: its own, plus the radius techs done. */
export function networkRadius(type: BuildingId, techsDone?: readonly string[]): number {
  const base = BUILDINGS[type].buildRadiusM ?? 0;
  if (!base || !techsDone) return base;
  let d = 0;
  for (const [t, b, m] of RADIUS_FX) if (b === type && techsDone.includes(t)) d += m;
  return base + d;
}

/** Completed Relay Masts: each maps the ground within its build radius. */
function masts(s: GameState): [number, number, number][] {
  const r = networkRadius('relayMast', s.techsDone);
  return s.buildings.filter((b) => b.type === 'relayMast' && complete(b))
    .map((b) => [...centerOf(b), r]);
}

/** Is a deposit mapped: any part inside the survey radius, or struck
 *  (placement strike, a Relay Mast, the legacy ice survey)? */
export function depositRevealed(s: GameState, d: Deposit, tier: SurveyTier): boolean {
  if (s.survey.struck.includes(d.id)) return true;
  const [lx, lz] = landerXZ(s);
  return Math.hypot(d.cx - lx, d.cz - lz) - d.r <= revealRadiusM(tier);
}

/** Is this ground mapped — inside the survey radius or a completed mast's? */
export function groundMapped(s: GameState, x: number, z: number, tier: SurveyTier): boolean {
  const [lx, lz] = landerXZ(s);
  if (Math.hypot(x - lx, z - lz) <= revealRadiusM(tier)) return true;
  return masts(s).some(([mx, mz, r]) => Math.hypot(x - mx, z - mz) <= r);
}

/** Relay Masts reveal every deposit within their radius once complete (and
 *  again on load). Returns the ids newly struck. */
export function revealDeposits(s: GameState, deposits: readonly Deposit[]): string[] {
  const out: string[] = [];
  for (const [mx, mz, r] of masts(s)) {
    for (const d of deposits) {
      if (s.survey.struck.includes(d.id) || Math.hypot(d.cx - mx, d.cz - mz) - d.r > r) continue;
      s.survey.struck.push(d.id);
      out.push(d.id);
    }
  }
  return out;
}

/** The build network: the Lander, completed habitats and completed Relay
 *  Masts, each extending it by its buildRadiusM (masts chain). */
export function networkNodes(s: Pick<GameState, 'buildings'> & { techsDone?: readonly string[] }): { x: number; z: number; r: number; type: BuildingId }[] {
  const out: { x: number; z: number; r: number; type: BuildingId }[] = [];
  for (const b of s.buildings) {
    const r = networkRadius(b.type, s.techsDone);
    if (!r || !complete(b)) continue;
    const [x, z] = centerOf(b);
    out.push({ x, z, r, type: b.type });
  }
  return out;
}

export function inNetwork(s: Pick<GameState, 'buildings'> & { techsDone?: readonly string[] }, x: number, z: number): boolean {
  return networkNodes(s).some((n) => Math.hypot(x - n.x, z - n.z) <= n.r);
}

/** the refusal for ground outside the network, naming what it is measured from */
export function beyondNetwork(s: Pick<GameState, 'buildings'> & { techsDone?: readonly string[] }): string {
  const nodes = networkNodes(s);
  const hab = nodes.some((n) => n.type === 'habitat');
  const mast = nodes.some((n) => n.type === 'relayMast');
  const land = BUILDINGS.lander.buildRadiusM;
  return `Beyond ${land} m of the Lander${hab ? ' and habitats' : ''}` +
    (mast ? ` or ${networkRadius('relayMast', s.techsDone)} m of a Relay Mast` : '');
}

/** what striking a deposit means, for the PROSPECT STRUCK alert */
export function strikeEffect(kind: Deposit['kind'], mods: Mods): string {
  switch (kind) {
    case 'ilmenite': return `smelter feed +${Math.round(30 * mods.feedBonus.ilmenite)}%`;
    case 'anorthosite': return `refinery feed +${Math.round(40 * mods.feedBonus.anorthosite)}%`;
    case 'glass': return `smelter O₂ +${Math.round(60 * mods.feedBonus.glass)}%`;
    case 'kreep': return 'reactor fuel make-up · no habitats';
    case 'volatiles': return 'water ×2.5 with Solar-Wind Volatiles';
    case 'ice': return 'a Water Management Plant’s Ice Miners can work it';
    case 'ridge': return 'solar ×1.2, never shaded';
  }
}

/** The $deposits payload: every deposit, what is known of it, and whether
 *  the network reaches it. `kind` is ground truth — show `label` while unrevealed. */
export function depositsView(s: GameState, deposits: readonly Deposit[], tier: SurveyTier): DepositView[] {
  const [lx, lz] = landerXZ(s);
  const nodes = networkNodes(s);
  return deposits.map((d) => {
    const revealed = depositRevealed(s, d, tier);
    const lead = !revealed && Math.hypot(d.leadX - lx, d.leadZ - lz) <= LEAD_RANGE_M
      ? { x: d.leadX, z: d.leadZ } : null;
    return {
      id: d.id, kind: d.kind, x: d.cx, z: d.cz, r: d.r, revealed, lead,
      inNetwork: nodes.some((n) => Math.hypot(d.cx - n.x, d.cz - n.z) < n.r + d.r),
      label: revealed ? DEPOSIT_INFO[d.kind].name : DEPOSIT_INFO[d.kind].lead,
      glyph: revealed ? DEPOSIT_INFO[d.kind].glyph : '?',
    };
  });
}

// ─────────────────────────── the Moon ───────────────────────────

const RAD = Math.PI / 180;
/** The regional radius, degrees: a prospect this near a base's home is regional (docs/11 §5b), and it is how far a rival's
 *  coverage reaches and how near a rival outpost must stand for a field report to name it (docs/20 §5). */
export const REGIONAL_DEG = 27;
/** Great-circle distance in degrees (haversine). */
export function greatCircleDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) / RAD;
}

/** The initial bearing from the home site to a prospect, degrees clockwise from north (0..360): the
 *  way its drone flies out of the map (world/surveyFlight.ts). */
export function prospectBearing(siteId: SiteId, pid: ProspectId): number {
  const a = SITES[siteId].home, b = PROSPECTS[pid];
  const dLon = (b.lon - a.lon) * RAD;
  const y = Math.sin(dLon) * Math.cos(b.lat * RAD);
  const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos(dLon);
  return ((Math.atan2(y, x) / RAD) + 360) % 360;
}

export function prospectDist(siteId: SiteId, pid: ProspectId): number {
  return greatCircleDeg(SITES[siteId].home, PROSPECTS[pid]);
}

/** local ≤ 2°, regional ≤ 27°, near side |lon| ≤ 90° or |lat| ≥ 80°, else far;
 *  buried prospects are subsurface wherever home is. */
export function prospectClass(siteId: SiteId, pid: ProspectId): ProspectClass {
  const p = PROSPECTS[pid];
  if (p.subsurface) return 'subsurface';
  const d = prospectDist(siteId, pid);
  if (d <= 2) return 'local';
  if (d <= REGIONAL_DEG) return 'regional';
  return Math.abs(p.lon) <= 90 || Math.abs(p.lat) >= 80 ? 'near' : 'far';
}

export const CLASS_LABEL: Record<ProspectClass, string> = {
  local: 'local', regional: 'regional', near: 'near side', far: 'far side', subsurface: 'subsurface',
};

function tierTech(tier: number, s: GameState): string {
  const tid = TIER_TECH[tier];
  if (!tid) return '';
  return `${TECHS[tid].name} (Era ${resolveTech(TECHS[tid], s.expedition).era})`;
}

export interface SurveyCost {
  cls: ProspectClass;
  tier: SurveyTier;
  method: string;
  energy: number;
  oxygen: number;
  water: number;
  parts: number;
  timeS: number;
}

export function surveyCost(siteId: SiteId, pid: ProspectId): SurveyCost {
  const cls = prospectClass(siteId, pid);
  const c = SURVEY_CLASS[cls];
  const d = prospectDist(siteId, pid);
  return {
    cls, tier: c.tier, method: c.method, energy: c.energy, parts: c.parts,
    oxygen: c.hopper ? Math.round(Math.min(HOPPER.o2Max, HOPPER.o2Base + HOPPER.o2PerDeg * d)) : 0,
    water: c.hopper ? Math.round(Math.min(HOPPER.waterMax, HOPPER.waterBase + HOPPER.waterPerDeg * d)) : 0,
    timeS: c.hopper ? Math.round(Math.min(HOPPER.timeMax, HOPPER.timeBase + HOPPER.timePerDeg * d)) : c.timeS,
  };
}

/** A flight's length under the drones' range (Orbital Prospector: ×1.5 = a third shorter); ×1 leaves the table's seconds. */
export const flightS = (timeS: number, mods: Pick<Mods, 'droneRange'>) =>
  mods.droneRange === 1 ? timeS : Math.max(1, Math.round(timeS / mods.droneRange));

/** Data a survey of pid pays if it completes now: base × novelty (1st, 2nd,
 *  3rd+ of its kind), anomalies without a breakthrough +20 first, × Science
 *  Crews while enough crew are aboard. */
export function surveyPayout(s: GameState, mods: Mods, pid: ProspectId): number {
  const p = PROSPECTS[pid];
  const cls = prospectClass(s.siteId, pid);
  let base = SURVEY_CLASS[cls].data;
  if (p.kind === 'anomaly' && !p.bt) base += ANOMALY_BONUS_DATA;
  const seen = PROSPECT_IDS.filter((id) => id !== pid && s.survey.prospects[id] && PROSPECTS[id].kind === p.kind).length;
  const novelty = NOVELTY[Math.min(seen, NOVELTY.length - 1)];
  const crewMult = mods.surveyDataMult * (s.crew >= mods.surveyMinCrew ? mods.surveyCrewDataMult : 1);
  return Math.round(base * novelty * crewMult);
}

/** What is left of a resource above the crew's reserve (surveys and hoppers leave it). */
const spare = (s: GameState, mods: Mods, rid: ResourceId) => Math.max(0, s.resources[rid] - crewReserve(s, mods, rid));

/** Why a survey of pid cannot start now ('' = it can). A map survey is a drone's flight (docs/19 S6):
 *  it takes a docked, charged drone and never borrows a rover. (The deposit survey's own refusal is
 *  core/pits.ts surveyRefusal.) */
export function prospectRefusal(s: GameState, mods: Mods, pid: ProspectId): string {
  const p = PROSPECTS[pid];
  if (!p) return 'UNKNOWN PROSPECT';
  if (s.survey.prospects[pid]) return `ALREADY SURVEYED — ${p.name}`;
  const under = flightTo(s, pid);
  if (under) return `SURVEY IN PROGRESS — ${p.short} ${fmtClock(secsLeft(s, under.endsAt))}`;
  if (commsDark(s)) return 'SURVEY WAITS — the flare’s comms blackout: the drone flies once the link returns';
  const c = surveyCost(s.siteId, pid);
  if (mods.surveyTier < c.tier) {
    return `OUT OF RANGE — ${p.short} is ${CLASS_LABEL[c.cls]}: needs T${c.tier} ${tierTech(c.tier, s)}`;
  }
  if (!readyDrone(s)) {
    const n = fleetCount(s, mods);
    if (n.total < 1) return 'SURVEY NEEDS A DRONE — none is aboard: the Lander carries one, a Prospecting Bay prints more';
    return n.out >= n.total
      ? `ALL ${n.total} DRONE${n.total === 1 ? ' IS' : 'S ARE'} OUT — the next is home in ${fmtClock(Math.ceil(nextReadyIn(s)))}`
      : `DRONES CHARGING — the next flies in ${fmtClock(Math.ceil(nextReadyIn(s)))}`;
  }
  if (s.powerStored < c.energy) return `SURVEY NEEDS ${c.energy} STORED ENERGY — have ${Math.floor(s.powerStored)}`;
  for (const [rid, need] of [['oxygen', c.oxygen], ['water', c.water], ['parts', c.parts]] as [ResourceId, number][]) {
    const have = rid === 'parts' ? s.resources.parts : spare(s, mods, rid);
    if (have < need) {
      const held = rid !== 'parts' && crewReserve(s, mods, rid) > 0 ? ' spare — the crew’s reserve stays' : '';
      return `SURVEY NEEDS ${need}${glyph(rid)} — have ${Math.floor(have)}${held}`;
    }
  }
  return '';
}

/** Pay for a survey and launch a drone: its flight runs on its own clock, in parallel with the others. */
export function startSurvey(s: GameState, mods: Mods, pid: ProspectId, by: 'player' | 'auto' = 'player'): ActionResult {
  const why = prospectRefusal(s, mods, pid);
  if (why) return no(why);
  const c = surveyCost(s.siteId, pid);
  s.powerStored -= c.energy;
  s.resources.oxygen -= c.oxygen;
  s.resources.water -= c.water;
  s.resources.parts -= c.parts;
  recordSpend(s, { oxygen: c.oxygen, water: c.water, parts: c.parts });
  const drone = readyDrone(s)!;
  const timeS = flightS(c.timeS, mods);
  launchFlight(s, drone, pid, timeS);
  const n = fleetCount(s, mods);
  notify(s, 'field', {
    text: `SURVEY LAUNCHED — ${PROSPECTS[pid].short}: drone ${drone.id} out, back in ${fmtClock(timeS)} · ${n.out}/${n.total} flying${by === 'auto' ? ' · AUTO SURVEY' : ''}`,
    action: { map: pid },
  });
  return OK;
}

// ─────────────────────────── outposts ───────────────────────────

export function outpostSlots(mods: Mods, s: GameState): number {
  return mods.outpostSlots + (s.survey.atlas ? ATLAS.extraSlots : 0);
}

export const KIND_LABEL: Record<OutpostKind, string> = {
  ice: 'ice', volatiles: 'volatiles', ilmenite: 'ilmenite', glass: 'glass', silica: 'silica', kreep: 'KREEP', radio: 'radio',
};

/** A prospect's stream per second at full strength (before ATLAS and wear). */
export function baseStream(pid: ProspectId): { res: Partial<Record<ResourceId, number>>; data: number } {
  const p = PROSPECTS[pid];
  const k = OUTPOST_KINDS[p.kind as OutpostKind];
  return { res: p.stream ?? k?.stream ?? {}, data: k?.data ?? 0 };
}

const num = (v: number) => (v >= 0.1 ? v.toFixed(2) : String(+v.toFixed(3)));
function streamText(pid: ProspectId, mult = 1): string {
  const p = PROSPECTS[pid];
  const { res, data } = baseStream(pid);
  const parts = Object.entries(res).map(([r, v]) => `+${num((v ?? 0) * mult)}${glyph(r as ResourceId)}`);
  if (data) parts.push(`+${num(data * mult)}≡`);
  return parts.length ? `${parts.join(' ')}/s` : OUTPOST_KINDS[p.kind as OutpostKind]?.modifier ?? '';
}
/** '0.02○ + 0.004≈ /s' (the card line), or per resource '0.02○/s + 0.004≈/s' */
function fuelText(cls: ProspectClass, each = false): string {
  const f = OUTPOST_CLASS[cls].fuel;
  if (!f) return '';
  const items = Object.entries(f).map(([r, v]) => `${num(v ?? 0)}${glyph(r as ResourceId)}${each ? '/s' : ''}`);
  return each ? items.join(' + ') : `${items.join(' + ')} /s`;
}

/** The refusal a rival's outpost gives: `CLAIMED BY THE FOUNDRY — its outpost stands there` (the map's sheet reads the same words). */
export const claimedByText = (name: string) => `CLAIMED BY ${name.toUpperCase()} — its outpost stands there`;

/** What an outpost claim of this class costs this base: the class's table, its metals × `mods.outpostCostMult` (the Commons'
 *  ×0.85, rounded once; parts and chips are not scaled). Without `mods` the table as it stands. */
export function claimCost(cls: ProspectClass, mods?: Pick<Mods, 'outpostCostMult'>): Partial<Record<ResourceId, number>> {
  const cost = { ...OUTPOST_CLASS[cls].cost };
  const m = mods?.outpostCostMult ?? 1;
  if (m !== 1 && cost.metals) cost.metals = Math.round(cost.metals * m);
  return cost;
}

/** Why pid cannot be claimed now ('' = it can). */
export function claimRefusal(s: GameState, mods: Mods, pid: ProspectId): string {
  const p = PROSPECTS[pid];
  if (!p) return 'UNKNOWN PROSPECT';
  if (p.kind === 'heritage') return 'PROTECTED HERITAGE SITE — survey only';
  if (p.kind === 'anomaly') return 'NOTHING TO EXTRACT — anomaly';
  if (s.survey.outposts.some((o) => o.id === pid)) return `OUTPOST ALREADY CLAIMED — ${p.short}`;
  // another program's outpost on the shared Moon (docs/20 §4.4): a prospect is held by whoever claimed it first
  const holder = moonOf(s)?.claims[pid];
  if (holder && holder !== claimantOf(s)) return claimedByText(factionName(holder));
  const slots = outpostSlots(mods, s);
  const used = s.survey.outposts.length;
  if (slots === 0) return `NO OUTPOST SLOT — ${tierTech(1, s)}`;
  if (used >= slots) {
    // the next tier that adds a slot (T1 has the first: docs/19 S6)
    const grow = [2, 3, 4].find((t) => t > mods.surveyTier && SURVEY_TIERS[t].slots > SURVEY_TIERS[mods.surveyTier].slots);
    const next = grow !== undefined ? `${tierTech(grow, s)} adds one`
      : !s.survey.atlas ? `ATLAS COMPLETE adds one (T4 + ${ATLAS.surveys} surveyed)`
      : 'abandon one to free it';
    return `NO OUTPOST SLOT — ${used}/${slots} in use · ${next}`;
  }
  if (!s.survey.prospects[pid]) return `NOT SURVEYED — survey ${p.short} first`;
  for (const [rid, need] of Object.entries(claimCost(prospectClass(s.siteId, pid), mods)) as [ResourceId, number][]) {
    if (s.resources[rid] < need) return `CLAIM NEEDS ${need}${glyph(rid)} — have ${Math.floor(s.resources[rid])}`;
  }
  return '';
}

export function claimOutpost(s: GameState, mods: Mods, pid: ProspectId): ActionResult {
  const why = claimRefusal(s, mods, pid);
  if (why) return no(why);
  const cls = prospectClass(s.siteId, pid);
  const oc = OUTPOST_CLASS[cls];
  const cost = claimCost(cls, mods);
  for (const [rid, need] of Object.entries(cost) as [ResourceId, number][]) s.resources[rid] -= need;
  recordSpend(s, cost);
  const kind = PROSPECTS[pid].kind as OutpostKind;
  s.survey.outposts.push({
    id: pid, kind, cls, claimedAt: s.simTime, readyAt: s.simTime + oc.deployS,
    live: false, fuelOk: true, upkeepOk: true,
  });
  holdClaim(s, pid);
  notify(s, 'field', { text: `OUTPOST CLAIMED — ${PROSPECTS[pid].short} ${KIND_LABEL[kind]} · ${oc.haul} deploys in ${fmtClock(oc.deployS)}`, action: { map: pid } });
  return OK;
}

/** Frees the slot, no refund. `wasLive`: the mods change (link kW, KREEP). */
export function abandonOutpost(s: GameState, pid: ProspectId): ActionResult & { wasLive: boolean } {
  const i = s.survey.outposts.findIndex((o) => o.id === pid);
  if (i < 0) return { ok: false, reason: `NO OUTPOST AT ${PROSPECTS[pid]?.short ?? pid}`, wasLive: false };
  const [o] = s.survey.outposts.splice(i, 1);
  releaseClaim(s, pid);
  notify(s, 'field', { text: `OUTPOST ABANDONED — ${PROSPECTS[pid].short}; the slot is free (no refund)`, action: { map: pid } });
  return { ok: true, reason: '', wasLive: o.live };
}

/** This base's faction now holds pid on the Moon (a solo game files no claims). */
function holdClaim(s: GameState, pid: ProspectId) {
  const moon = moonOf(s);
  const me = claimantOf(s);
  if (moon && me) moon.claims[pid] = me;
}

/** The claim on pid is let go, if this base's faction held it. */
function releaseClaim(s: GameState, pid: ProspectId) {
  const moon = moonOf(s);
  if (moon && moon.claims[pid] === claimantOf(s)) delete moon.claims[pid];
}

/** Test and probe shortcut: exactly n live outposts, at the nearest
 *  prospects worth claiming (surveyed for free, nothing paid). On a Moon it lets go of this faction's claims,
 *  skips what another faction holds, and claims the rest. */
export function forceOutposts(s: GameState, n: number) {
  for (const o of s.survey.outposts) releaseClaim(s, o.id);
  const moon = moonOf(s);
  const me = claimantOf(s);
  const ids = PROSPECT_IDS.filter((id) => !['heritage', 'anomaly'].includes(PROSPECTS[id].kind))
    .filter((id) => !moon?.claims[id] || moon.claims[id] === me)
    .sort((a, b) => prospectDist(s.siteId, a) - prospectDist(s.siteId, b))
    .slice(0, Math.max(0, n));
  for (const id of ids) holdClaim(s, id);
  s.survey.outposts = ids.map((id): OutpostState => ({
    id, kind: PROSPECTS[id].kind as OutpostKind, cls: prospectClass(s.siteId, id),
    claimedAt: s.simTime, readyAt: s.simTime, live: true, fuelOk: true, upkeepOk: true,
  }));
  for (const id of ids) {
    s.survey.prospects[id] ??= { surveyedAt: s.simTime, cls: prospectClass(s.siteId, id), data: 0 };
  }
}

// ─────────────────────────── economy step 8.7 ───────────────────────────

// ─────────────────────────── the field report ───────────────────────────

const costText = (cost: Partial<Record<ResourceId, number>>) =>
  Object.entries(cost).map(([r, v]) => `${v}${glyph(r as ResourceId)}`).join(' ');

/** What an outpost at pid would stream and cost, in the words the field report and the prospect sheet share
 *  (docs/19 S8): `ice +0.20≈/s · claim 60◆ 20⚙ 5▣`. */
export function outpostSiteLine(siteId: SiteId, pid: ProspectId, mods?: Pick<Mods, 'outpostCostMult'>): string {
  const p = PROSPECTS[pid];
  return `${KIND_LABEL[p.kind as OutpostKind]} ${streamText(pid)} · claim ${costText(claimCost(prospectClass(siteId, pid), mods))}`;
}

/** The faction (other than this base's) whose outpost holds pid, or null. */
export function rivalHolder(s: GameState, pid: ProspectId): FactionId | null {
  const holder = moonOf(s)?.claims[pid];
  return holder && holder !== claimantOf(s) ? holder : null;
}

/** The rival outposts within the regional radius of pid (docs/20 §5), one row per rival faction: the nearest outpost it holds
 *  there, how far, and how many more stand within reach. Ordered by distance. A solo game has none. */
export function rivalsNear(s: GameState, pid: ProspectId): { faction: FactionId; held: ProspectId; deg: number; more: number }[] {
  const moon = moonOf(s);
  if (!moon || !PROSPECTS[pid]) return [];
  const by = new Map<FactionId, { held: ProspectId; deg: number; n: number }>();
  for (const held of PROSPECT_IDS) {
    const f = moon.claims[held];
    if (!f || held === pid || f === claimantOf(s)) continue;
    const deg = greatCircleDeg(PROSPECTS[pid], PROSPECTS[held]);
    if (deg > REGIONAL_DEG) continue;
    const cur = by.get(f);
    if (!cur) by.set(f, { held, deg, n: 1 });
    else { cur.n++; if (deg < cur.deg) { cur.held = held; cur.deg = deg; } }
  }
  return [...by.entries()].map(([faction, r]) => ({ faction, held: r.held, deg: r.deg, more: r.n - 1 }))
    .sort((a, b) => a.deg - b.deg);
}

/** A drone is home: the survey's data, sample cache, breakthrough, outpost site, insight and atlas
 *  progress, in one field report (a card with a line and a button for each: docs/19 S6, S7). */
function resolveSurvey(s: GameState, mods: Mods, pid: ProspectId) {
  const p = PROSPECTS[pid];
  const data = surveyPayout(s, mods, pid);
  const firstOfKind = !PROSPECT_IDS.some((id) => id !== pid && s.survey.prospects[id] && PROSPECTS[id].kind === p.kind);
  s.survey.prospects[pid] = { surveyedAt: s.simTime, cls: prospectClass(s.siteId, pid), data };
  s.data += data;
  const extractable = p.kind !== 'heritage' && p.kind !== 'anomaly';
  const tail = p.kind === 'heritage' ? 'protected heritage site'
    : p.kind === 'anomaly' ? (p.bt ? 'an anomaly worth a breakthrough' : 'nothing to extract')
    : `${KIND_LABEL[p.kind as OutpostKind]} outpost possible`;
  const rewards: FieldReward[] = [{ tag: 'DATA', text: `+${data}≡ banked` }];

  // SAMPLES: the first survey of each kind of ground brings home a one-time cache
  const cache = extractable && firstOfKind ? SAMPLE_CACHE[p.kind as OutpostKind] : undefined;
  if (cache) {
    let got = cache.amount;
    if (cache.res === 'data') s.data += got;
    else {
      const room = s.storageCaps?.[cache.res] !== undefined ? Math.max(0, s.storageCaps[cache.res]! - s.resources[cache.res]) : Infinity;
      got = Math.min(got, Math.floor(room));
      s.resources[cache.res] += got;
    }
    if (got > 0) rewards.push({ tag: 'SAMPLES', text: `+${got}${cache.res === 'data' ? '≡' : glyph(cache.res)} ${KIND_LABEL[p.kind as OutpostKind]}` });
  }

  // BREAKTHROUGH: a host reveals its tech, researchable now or in its era
  const firstFind = !!p.bt && !s.discoveries.includes(p.bt);
  if (p.bt && firstFind) {
    s.discoveries.push(p.bt);
    const era = resolveTech(TECHS[p.bt], s.expedition).era;
    const when = s.era >= era ? 'researchable now' : `researchable in Era ${era}`;
    rewards.push({ tag: 'BREAKTHROUGH', text: `${TECHS[p.bt].name} — ${when}`, button: { label: 'In the tree', action: { tech: p.bt } } });
  }

  // OUTPOST SITE: what it would stream and what claiming costs, or what a claim waits for; a prospect another program
  // already holds says so instead (docs/20 §5)
  const heldBy = rivalHolder(s, pid);
  if (extractable && heldBy) {
    rewards.push({
      tag: 'RIVAL', text: `${factionName(heldBy)} holds ${p.short} — its outpost stands here; there is nothing to claim`,
      button: { label: 'Open the map', action: { map: pid } },
    });
  } else if (extractable) {
    const why = claimRefusal(s, mods, pid);
    const line = outpostSiteLine(s.siteId, pid, mods);
    if (!why) rewards.push({ tag: 'OUTPOST SITE', text: line, button: { label: 'Claim', action: { map: pid } } });
    else {
      const slotWait = why.startsWith('NO OUTPOST SLOT');
      rewards.push({
        tag: 'OUTPOST SITE',
        text: slotWait ? `${line} · needs ${why.replace(/^NO OUTPOST SLOT — /, '').replace(/^\d+\/\d+ in use · /, '')}` : `${line} · ${why.toLowerCase()}`,
        button: { label: 'Open the map', action: { map: pid } },
      });
    }
  }
  // RIVAL: another program's outpost within the regional radius of what was just surveyed ("The Foundry holds Moltke, 1.8° away")
  if (!heldBy) {
    for (const r of rivalsNear(s, pid)) {
      rewards.push({
        tag: 'RIVAL',
        text: `${factionName(r.faction)} holds ${PROSPECTS[r.held].short}, ${r.deg.toFixed(1)}° away` +
          (r.more ? ` (+${r.more} more within ${REGIONAL_DEG}°)` : ''),
        button: { label: 'On the map', action: { map: r.held } },
      });
    }
  }

  notify(s, 'field', {
    text: `SURVEY COMPLETE — ${p.name} · +${data}≡ · ${tail}`, action: { map: pid },
    // the report is filled in below: the insight and atlas lines need the tick's other results
    report: { title: p.name, geology: p.geology, rewards },
  });
  if (p.bt && firstFind) {
    const era = resolveTech(TECHS[p.bt], s.expedition).era;
    notify(s, 'field', {
      text: `BREAKTHROUGH — ${TECHS[p.bt].name} found at ${p.name} ` +
        `(${s.era >= era ? 'researchable now' : `researchable in Era ${era}`})`, action: { tech: p.bt },
    });
  }

  // INSIGHT: a survey deed that just paid its discount (the exploration lane's insights)
  for (const t of insightTick(s)) {
    if (TECHS[t].lane !== 'exploration') continue;
    rewards.push({
      tag: 'INSIGHT', text: `${TECHS[t].name} −${Math.round((s.insights[t] ?? 0) * 100)}%`,
      button: { label: 'In the tree', action: { tech: t } },
    });
  }
  // ATLAS: progress toward the survey net's completion, once the far tiers are near (T3 and up)
  const surveyed = Object.keys(s.survey.prospects).length;
  if (!s.survey.atlas && mods.surveyTier >= ATLAS.minTier - 1) {
    rewards.push({
      tag: 'ATLAS', text: `${Math.min(surveyed, ATLAS.surveys)}/${ATLAS.surveys}` +
        (mods.surveyTier < ATLAS.minTier ? ` · needs T${ATLAS.minTier} ${tierTech(ATLAS.minTier, s)}` : ''),
    });
  }
}

/** AUTO SURVEY (Site Survey AI's Builder rule): every idle drone flies the nearest unsurveyed prospect
 *  in coverage that it can pay for, while the bank keeps the rule's reserve (T of its capacity). */
export function autoSurvey(s: GameState, mods: Mods) {
  if (!s.auto?.rules) return;
  const r = ruleState(s, 'autoSurvey');
  if (!mods.autoFamilies.has('survey')) { r.phase = 'locked'; r.why = 'locked — Site Survey AI'; return; }
  if (!r.on) { r.phase = 'off'; r.why = 'off'; return; }
  const now = s.simTime;
  const frozen = Math.max(s.auto.frozenUntil, r.frozenUntil ?? 0);
  if (frozen > now) { r.phase = 'frozen'; r.why = `frozen · resumes in ${fmtClock(frozen - now)}`; return; }
  const reserve = r.threshold * (s.power?.capacity ?? 0);
  const near = PROSPECT_IDS.filter((id) => !s.survey.prospects[id] && !flightTo(s, id) && mods.surveyTier >= surveyCost(s.siteId, id).tier)
    .sort((a, b) => prospectDist(s.siteId, a) - prospectDist(s.siteId, b) || PROSPECT_IDS.indexOf(a) - PROSPECT_IDS.indexOf(b));
  if (!near.length) { r.phase = 'ok'; r.why = 'ok · every prospect in coverage is surveyed or flying'; return; }
  let flown = 0, held = '';
  while (readyDrone(s)) {
    const pid = near.find((id) => !prospectRefusal(s, mods, id));
    if (!pid) { held = prospectRefusal(s, mods, near[0]); break; }
    const c = surveyCost(s.siteId, pid);
    if (s.powerStored - c.energy < reserve) {
      held = `the bank keeps ${Math.round(r.threshold * 100)}%: ${Math.floor(s.powerStored)} stored, ${Math.ceil(reserve + c.energy)} needed for ${PROSPECTS[pid].short}`;
      break;
    }
    startSurvey(s, mods, pid, 'auto');
    near.splice(near.indexOf(pid), 1);
    flown++;
    if (!near.length) break;
  }
  const c = fleetCount(s, mods);
  if (held) { r.phase = 'holding'; r.why = `holding · ${held.toLowerCase()}`; }
  else { r.phase = 'ok'; r.why = flown ? `→ flew ${flown} · ${c.out}/${c.total} drones out` : `ok · ${c.out}/${c.total} drones out`; }
  if (flown) r.built += flown;
}

export interface ExplorationTick {
  modsChanged: boolean;
  /** net resource flow this tick (per second): streams in, fuel and upkeep out */
  flow: Partial<Record<ResourceId, number>>;
}

/** Survey timers, outpost streams, hopper fuel, outpost upkeep and the
 *  atlas. (stats.outpostOpS is the economy's.) */
export function explorationTick(s: GameState, mods: Mods, _site: SiteDef, dt: number): ExplorationTick {
  const out: ExplorationTick = { modsChanged: false, flow: {} };
  const flow = out.flow;
  const move = (rid: ResourceId, amt: number) => {
    s.resources[rid] += amt;
    flow[rid] = (flow[rid] ?? 0) + amt / dt;
  };

  // the drone fleet: prints, recharging, then the flights that end now (docs/19 S6)
  fleetTick(s, mods, dt);
  const flights = fleetLists(s).flights;
  // a comms blackout holds every drone's hop: the clocks pause (docs/16 §4.8)
  if (commsDark(s)) for (const f of flights) f.endsAt += dt;
  for (const f of [...flights]) {
    if (s.simTime < f.endsAt) continue;
    landFlight(s, f);
    resolveSurvey(s, mods, f.id);
  }
  autoSurvey(s, mods);

  // outposts: deploy, upkeep, hopper fuel, streams
  const caps = s.storageCaps ?? {};
  for (const o of s.survey.outposts) {
    const p = PROSPECTS[o.id];
    const mult = s.survey.atlas ? ATLAS.streamMult : 1;
    if (!o.live) {
      if (s.simTime < o.readyAt) continue;
      o.live = true;
      out.modsChanged = true;
      notify(s, 'field', {
        text: `OUTPOST ONLINE — ${p.short} ${KIND_LABEL[o.kind]}: ${streamText(o.id, mult)}`, action: { map: o.id },
        report: {
          title: `${p.short} · ${KIND_LABEL[o.kind]} outpost online`, geology: p.geology,
          rewards: [{ tag: 'STREAM', text: streamText(o.id, mult), button: { label: 'Open the map', action: { map: o.id } } }],
        },
      });
    }
    const oc = OUTPOST_CLASS[o.cls];
    const upkeep = (oc.upkeepPerDay / CYCLE_S) * dt;
    o.upkeepOk = s.resources.parts >= upkeep;
    if (o.upkeepOk) move('parts', -upkeep);
    else condition(s, `outpostWorn:${o.id}`, `OUTPOST WORN — ${p.short} stream ×0.5 (no parts for its upkeep)`, 'warn', { map: o.id }, 'field');
    if (o.hacked) continue; // HACKED OUTPOST (docs/14 §3.5): the stream is diverted
    // outposts link to the Lander: an air-gapped Lander cuts their streams (docs/14 §3.5)
    if (s.buildings.some((b) => b.type === 'lander' && b.airGapped)) {
      condition(s, `gapped:${o.id}`, `OUTPOST OFF THE NETWORK — ${p.short} streams again when the Lander is reconnected`, 'info', { map: o.id }, 'field');
      continue;
    }
    const { res, data } = baseStream(o.id);
    const k = mult * (o.upkeepOk ? 1 : 0.5);
    // a hopper that cannot fuel grounds its stream; its own delivery counts
    // toward the fuel (an ice hopper carries its water home)
    const fuel = Object.entries(oc.fuel ?? {}) as [ResourceId, number][];
    const short = fuel.find(([rid, rate]) => spare(s, mods, rid) + (res[rid] ?? 0) * k * dt < rate * dt);
    // grounded is offline: a KREEP outpost's modifier goes, and comes back with the fuel
    if (o.fuelOk !== !short) out.modsChanged = true;
    o.fuelOk = !short;
    if (short) {
      condition(s, `grounded:${o.id}`, `HOPPER GROUNDED — ${p.short} needs ${fuelText(o.cls, true)} ` +
        `(have ${Math.floor(spare(s, mods, short[0]))}${glyph(short[0])})`, 'warn', { map: o.id }, 'field');
      continue;
    }
    // a comms blackout buffers the stream: it lands when the link returns (docs/16 §4.8)
    if (commsDark(s)) {
      for (const [rid, rate] of Object.entries(res) as [ResourceId, number][]) holdStream(s, rid, rate * k * dt);
      holdStream(s, 'data', data * k * dt);
      for (const [rid, rate] of fuel) move(rid, -rate * dt);
      continue;
    }
    for (const [rid, rate] of Object.entries(res) as [ResourceId, number][]) {
      const room = caps[rid] !== undefined ? Math.max(0, caps[rid]! - s.resources[rid]) : Infinity;
      move(rid, Math.min(rate * k * dt, room));
    }
    for (const [rid, rate] of fuel) move(rid, -rate * dt);
    s.data += data * k * dt;
  }

  // ATLAS COMPLETE: T4 and 12 prospects surveyed
  const surveyed = Object.keys(s.survey.prospects).length;
  if (!s.survey.atlas && mods.surveyTier >= ATLAS.minTier && surveyed >= ATLAS.surveys) {
    s.survey.atlas = true;
    let bonus: string;
    if (s.techsDone.includes('swarmProtocol')) {
      s.data += ATLAS.lateData;
      bonus = `+${ATLAS.lateData}≡`;
    } else {
      s.insights.swarmProtocol = Math.min(INSIGHT_MAX, Math.max(s.insights.swarmProtocol ?? 0, ATLAS.insight));
      bonus = `${TECHS.swarmProtocol.name} −${Math.round(ATLAS.insight * 100)}%: the survey net becomes the swarm’s tracking-and-timing network`;
    }
    notify(s, 'field', {
      text: `ATLAS COMPLETE — SELENOGRAPHER · +${ATLAS.extraSlots} outpost slot · streams ×${ATLAS.streamMult} · ${bonus}`,
      report: {
        title: 'ATLAS COMPLETE · SELENOGRAPHER', geology: `${surveyed} prospects surveyed`,
        rewards: [
          { tag: 'SLOT', text: `+${ATLAS.extraSlots} outpost slot` }, { tag: 'STREAMS', text: `every outpost ×${ATLAS.streamMult}` },
          { tag: 'BONUS', text: bonus },
        ],
      },
    });
  }
  return out;
}

// ─────────────────────────── the $lunar view ───────────────────────────

/** Map UI bookkeeping the game keeps (not saved): the view on screen, and the
 *  tier the player has seen (a higher one pulses the chip and animates). */
export interface LunarUi { open: boolean; view: MapView; seenTier: number }

/** What the caller knows of a rival program (the Moon and its base): `lunarView` adds the home and the claims' holders. */
export interface RivalInfo {
  faction: FactionId; name: string; siteId: SiteId; landed: boolean; landedAt: number;
  outposts: ProspectId[]; launches: number; era: number;
  /** the prospects its drones are surveying now (the map spins them in its colour) */
  surveying?: ProspectId[];
}

/** The $lunar view. `rivals`: the other programs on this Moon (absent in a solo game: the view is as it always was);
 *  a prospect another faction holds names it in `rival`, whether or not `rivals` lists it. */
export function lunarView(s: GameState, mods: Mods, ui: LunarUi, rivals?: readonly RivalInfo[]): LunarView {
  const tier = mods.surveyTier;
  const moon = moonOf(s);
  const me = claimantOf(s);
  const slots = outpostSlots(mods, s);
  const prospects: LunarProspectView[] = PROSPECT_IDS.map((id) => {
    const p = PROSPECTS[id];
    const cost0 = surveyCost(s.siteId, id);
    const cost = { ...cost0, timeS: flightS(cost0.timeS, mods) };
    const rec = s.survey.prospects[id];
    const visible = tier >= cost.tier;
    const outpost = s.survey.outposts.some((o) => o.id === id);
    const claimWhy = claimRefusal(s, mods, id);
    const surveyWhy = rec ? '' : prospectRefusal(s, mods, id);
    const reason = !visible ? `beyond coverage — T${cost.tier} ${tierTech(cost.tier, s)}`
      : !rec ? surveyWhy
      : outpost ? 'outpost claimed'
      : claimWhy;
    const extractable = p.kind !== 'heritage' && p.kind !== 'anomaly';
    const oc = OUTPOST_CLASS[cost.cls];
    const holder = moon?.claims[id];
    const rival = holder && holder !== me
      ? { faction: holder, name: rivals?.find((r) => r.faction === holder)?.name ?? factionName(holder) } : null;
    return {
      id, cls: cost.cls, dist: Math.round(prospectDist(s.siteId, id) * 10) / 10, visible,
      surveyed: !!rec, kind: p.kind, bt: p.bt ?? null,
      claimable: visible && !!rec && !claimWhy, reason,
      name: p.name, short: p.short, lat: p.lat, lon: p.lon, geology: p.geology,
      surveyable: visible && !rec && !surveyWhy,
      data: rec ? rec.data : surveyPayout(s, mods, id),
      survey: cost,
      outpost,
      rival,
      claim: extractable
        ? { cost: claimCost(cost.cls, mods), deployS: oc.deployS, upkeepPerDay: oc.upkeepPerDay,
          linkKW: OUTPOST_LINK_KW[cost.cls], fuel: fuelText(cost.cls), stream: streamText(id), line: outpostSiteLine(s.siteId, id, mods) }
        : null,
    };
  });
  const cutOff = s.buildings.some((b) => b.type === 'lander' && b.airGapped);
  const outposts: LunarOutpostView[] = s.survey.outposts.map((o) => {
    const oc = OUTPOST_CLASS[o.cls];
    const mult = (s.survey.atlas ? ATLAS.streamMult : 1) * (o.upkeepOk ? 1 : 0.5);
    // what it is doing (the chip's words and the producer lines'): the sim's own flags, nothing recomputed
    const state = !o.live ? 'deploying' : o.hacked || cutOff ? 'off' : !o.fuelOk ? 'grounded' : !o.upkeepOk ? 'worn' : 'live';
    const base = baseStream(o.id);
    const res: Partial<Record<ResourceId, number>> = {};
    for (const [rid, v] of Object.entries(base.res) as [ResourceId, number][]) res[rid] = v * mult;
    const burn: Partial<Record<ResourceId, number>> = {};
    if (o.live) {
      burn.parts = oc.upkeepPerDay / CYCLE_S;
      if (o.fuelOk && !o.hacked && !cutOff) for (const [rid, v] of Object.entries(oc.fuel ?? {}) as [ResourceId, number][]) burn[rid] = v;
    }
    return {
      id: o.id, kind: o.kind, readyAt: o.readyAt, fuelOk: o.fuelOk, upkeepOk: o.upkeepOk,
      // grounded, it streams nothing and its modifier is off
      stream: o.live && !o.fuelOk ? 'grounded — no hopper fuel' : streamText(o.id, mult),
      name: PROSPECTS[o.id].short, cls: o.cls, live: o.live,
      deployLeft: o.live ? 0 : secsLeft(s, o.readyAt),
      fuel: fuelText(o.cls), upkeep: `${oc.upkeepPerDay}⚙/day`, linkKW: OUTPOST_LINK_KW[o.cls],
      state, res, data: base.data * mult, burn,
      modifier: o.kind === 'kreep' ? OUTPOST_KINDS.kreep.modifier ?? '' : '',
    };
  });
  const flights = [...fleetLists(s).flights].sort((x, y) => x.endsAt - y.endsAt)
    .map((f) => ({ id: f.id, drone: f.drone, remaining: secsLeft(s, f.endsAt), total: Math.round(f.endsAt - f.startedAt), short: PROSPECTS[f.id].short }));
  const maxView = TIER_VIEW[tier];
  const [lx, lz] = landerXZ(s);
  return {
    tier,
    view: MAP_VIEWS.indexOf(ui.view) <= MAP_VIEWS.indexOf(maxView) ? ui.view : maxView,
    maxView,
    justExpanded: tier > ui.seenTier,
    slots,
    used: s.survey.outposts.length,
    surveyedCount: Object.keys(s.survey.prospects).length,
    atlas: s.survey.atlas,
    prospects,
    rivals: (rivals ?? []).map((r): LunarRivalView => ({
      faction: r.faction, name: r.name, siteId: r.siteId, home: { ...SITES[r.siteId].home },
      landed: r.landed, landedAt: r.landedAt, outposts: [...r.outposts], launches: r.launches, era: r.era,
      surveying: [...(r.surveying ?? [])],
    })),
    // the soonest flight (the map's header and busy line); `flights` is every drone out
    active: flights[0] ? { id: flights[0].id, remaining: flights[0].remaining } : null,
    flights,
    drones: fleetCount(s, mods),
    outposts,
    tierLabel: SURVEY_TIERS[tier].label,
    site: {
      revealM: Math.min(revealRadiusM(tier), MAP_M),
      lander: { x: lx, z: lz },
      network: networkNodes(s).map(({ x, z, r }) => ({ x, z, r })),
      buildings: s.buildings.map((b) => {
        const [x, z] = centerOf(b);
        const fr = footprintRect(b);
        return { id: b.id, type: b.type, x, z, w: fr.w * CELL_M, d: fr.d * CELL_M, complete: complete(b) };
      }),
    },
  };
}
