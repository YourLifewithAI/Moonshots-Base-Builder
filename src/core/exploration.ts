/** Exploration runtime (spec §5, S11): what the base has mapped around it,
 *  the build network, surveys of the 34 prospects, outposts and the atlas.
 *  explorationTick runs as economy step 8.7; the actions call startSurvey,
 *  claimOutpost and abandonOutpost and alert any refusal. */
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { SITES, type SiteDef, type SiteId } from '../data/sites';
import { TECHS, type TechId } from '../data/techs';
import { RESOURCES, type ResourceId } from '../data/resources';
import { ATLAS, CELL_M, CREW, CYCLE_S, INSIGHT_MAX, LOW_SUPPLY_S, MAP_M, SURVEY_TIERS } from '../data/balance';
import { DEPOSIT_INFO, LEAD_RANGE_M } from '../data/deposits';
import {
  ANOMALY_BONUS_DATA, HOPPER, NOVELTY, OUTPOST_CLASS, OUTPOST_KINDS, OUTPOST_LINK_KW, PROSPECTS, PROSPECT_IDS,
  SURVEY_CLASS, TIER_TECH, TIER_VIEW, MAP_VIEWS,
  type MapView, type OutpostKind, type ProspectClass, type ProspectId,
} from '../data/lunarMap';
import type { Deposit } from '../terrain/heightfield';
import type { DepositView, LunarOutpostView, LunarProspectView, LunarView } from '../ui/stores';
import { centerOf, footprintRect } from '../buildings/instances';
import type { GameState, OutpostState } from './state';
import type { Mods, SurveyTier } from './mods';
import { alert, condition } from './economy';
import { resolveTech } from './research';
import { fmtClock } from './daynight';

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

/** Completed Relay Masts: each maps the ground within its build radius. */
function masts(s: GameState): [number, number, number][] {
  return s.buildings.filter((b) => b.type === 'relayMast' && complete(b))
    .map((b) => [...centerOf(b), BUILDINGS.relayMast.buildRadiusM ?? 0]);
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
export function networkNodes(s: Pick<GameState, 'buildings'>): { x: number; z: number; r: number; type: BuildingId }[] {
  const out: { x: number; z: number; r: number; type: BuildingId }[] = [];
  for (const b of s.buildings) {
    const r = BUILDINGS[b.type].buildRadiusM;
    if (!r || !complete(b)) continue;
    const [x, z] = centerOf(b);
    out.push({ x, z, r, type: b.type });
  }
  return out;
}

export function inNetwork(s: Pick<GameState, 'buildings'>, x: number, z: number): boolean {
  return networkNodes(s).some((n) => Math.hypot(x - n.x, z - n.z) <= n.r);
}

/** the refusal for ground outside the network, naming what it is measured from */
export function beyondNetwork(s: Pick<GameState, 'buildings'>): string {
  const nodes = networkNodes(s);
  const hab = nodes.some((n) => n.type === 'habitat');
  const mast = nodes.some((n) => n.type === 'relayMast');
  const land = BUILDINGS.lander.buildRadiusM;
  return `Beyond ${land} m of the Lander${hab ? ' and habitats' : ''}` +
    (mast ? ` or ${BUILDINGS.relayMast.buildRadiusM} m of a Relay Mast` : '');
}

/** what striking a deposit means, for the PROSPECT STRUCK alert */
export function strikeEffect(kind: Deposit['kind'], mods: Mods): string {
  switch (kind) {
    case 'ilmenite': return `smelter feed +${Math.round(30 * mods.feedBonus.ilmenite)}%`;
    case 'anorthosite': return `refinery feed +${Math.round(40 * mods.feedBonus.anorthosite)}%`;
    case 'glass': return `smelter O₂ +${Math.round(60 * mods.feedBonus.glass)}%`;
    case 'kreep': return 'reactor fuel make-up · no habitats';
    case 'volatiles': return 'water ×2.5 with Volatile Extraction';
    case 'ice': return 'Ice Harvesters can work it';
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
/** Great-circle distance in degrees (haversine). */
export function greatCircleDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) / RAD;
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
  if (d <= 27) return 'regional';
  return Math.abs(p.lon) <= 90 || Math.abs(p.lat) >= 80 ? 'near' : 'far';
}

const CLASS_LABEL: Record<ProspectClass, string> = {
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
  const crewMult = s.crew >= mods.surveyMinCrew ? mods.surveyDataMult : 1;
  return Math.round(base * novelty * crewMult);
}

/** The crew's life-support reserve of a resource (surveys and hoppers leave it). */
function reserve(s: GameState, mods: Mods, rid: ResourceId): number {
  const per = rid === 'oxygen' ? CREW.oxygenPerCrew : rid === 'water' ? CREW.waterPerCrew : rid === 'food' ? CREW.foodPerCrew : 0;
  return s.crew * per * mods.inputMult.habitat * LOW_SUPPLY_S;
}
const spare = (s: GameState, mods: Mods, rid: ResourceId) => Math.max(0, s.resources[rid] - reserve(s, mods, rid));

/** Why a survey of pid cannot start now ('' = it can). */
export function surveyRefusal(s: GameState, mods: Mods, pid: ProspectId): string {
  const p = PROSPECTS[pid];
  if (!p) return 'UNKNOWN PROSPECT';
  if (s.survey.prospects[pid]) return `ALREADY SURVEYED — ${p.name}`;
  const a = s.survey.active;
  if (a) return `SURVEY IN PROGRESS — ${PROSPECTS[a.id].short} ${fmtClock(secsLeft(s, a.endsAt))}`;
  const c = surveyCost(s.siteId, pid);
  if (mods.surveyTier < c.tier) {
    return `OUT OF RANGE — ${p.short} is ${CLASS_LABEL[c.cls]}: needs T${c.tier} ${tierTech(c.tier, s)}`;
  }
  if ((s.bots?.total ?? 0) < 1) return 'SURVEY NEEDS A ROBOT — the construction fleet is empty';
  if (s.powerStored < c.energy) return `SURVEY NEEDS ${c.energy} STORED ENERGY — have ${Math.floor(s.powerStored)}`;
  for (const [rid, need] of [['oxygen', c.oxygen], ['water', c.water], ['parts', c.parts]] as [ResourceId, number][]) {
    const have = rid === 'parts' ? s.resources.parts : spare(s, mods, rid);
    if (have < need) {
      const held = rid !== 'parts' && reserve(s, mods, rid) > 0 ? ' spare — the crew’s reserve stays' : '';
      return `SURVEY NEEDS ${need}${glyph(rid)} — have ${Math.floor(have)}${held}`;
    }
  }
  return '';
}

/** Pay for a survey and send the borrowed robot out. */
export function startSurvey(s: GameState, mods: Mods, pid: ProspectId): ActionResult {
  const why = surveyRefusal(s, mods, pid);
  if (why) return no(why);
  const c = surveyCost(s.siteId, pid);
  s.powerStored -= c.energy;
  s.resources.oxygen -= c.oxygen;
  s.resources.water -= c.water;
  s.resources.parts -= c.parts;
  s.survey.active = { id: pid, startedAt: s.simTime, endsAt: s.simTime + c.timeS };
  alert(s, `SURVEY LAUNCHED — ${PROSPECTS[pid].short} by ${c.method}, back in ${fmtClock(c.timeS)} · 1 robot lent`, 'info');
  return OK;
}

// ─────────────────────────── outposts ───────────────────────────

export function outpostSlots(mods: Mods, s: GameState): number {
  return mods.outpostSlots + (s.survey.atlas ? ATLAS.extraSlots : 0);
}

const KIND_LABEL: Record<OutpostKind, string> = {
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

/** Why pid cannot be claimed now ('' = it can). */
export function claimRefusal(s: GameState, mods: Mods, pid: ProspectId): string {
  const p = PROSPECTS[pid];
  if (!p) return 'UNKNOWN PROSPECT';
  if (p.kind === 'heritage') return 'PROTECTED HERITAGE SITE — survey only';
  if (p.kind === 'anomaly') return 'NOTHING TO EXTRACT — anomaly';
  if (s.survey.outposts.some((o) => o.id === pid)) return `OUTPOST ALREADY CLAIMED — ${p.short}`;
  const slots = outpostSlots(mods, s);
  const used = s.survey.outposts.length;
  if (slots === 0) return `NO OUTPOST SLOT — ${tierTech(2, s)}`;
  if (used >= slots) {
    const next = mods.surveyTier < 4 ? `${tierTech(mods.surveyTier + 1, s)} adds one`
      : !s.survey.atlas ? `ATLAS COMPLETE adds one (T4 + ${ATLAS.surveys} surveyed)`
      : 'abandon one to free it';
    return `NO OUTPOST SLOT — ${used}/${slots} in use · ${next}`;
  }
  if (!s.survey.prospects[pid]) return `NOT SURVEYED — survey ${p.short} first`;
  for (const [rid, need] of Object.entries(OUTPOST_CLASS[prospectClass(s.siteId, pid)].cost) as [ResourceId, number][]) {
    if (s.resources[rid] < need) return `CLAIM NEEDS ${need}${glyph(rid)} — have ${Math.floor(s.resources[rid])}`;
  }
  return '';
}

export function claimOutpost(s: GameState, mods: Mods, pid: ProspectId): ActionResult {
  const why = claimRefusal(s, mods, pid);
  if (why) return no(why);
  const cls = prospectClass(s.siteId, pid);
  const oc = OUTPOST_CLASS[cls];
  for (const [rid, need] of Object.entries(oc.cost) as [ResourceId, number][]) s.resources[rid] -= need;
  const kind = PROSPECTS[pid].kind as OutpostKind;
  s.survey.outposts.push({
    id: pid, kind, cls, claimedAt: s.simTime, readyAt: s.simTime + oc.deployS,
    live: false, fuelOk: true, upkeepOk: true,
  });
  alert(s, `OUTPOST CLAIMED — ${PROSPECTS[pid].short} ${KIND_LABEL[kind]} · ${oc.haul} deploys in ${fmtClock(oc.deployS)}`, 'info');
  return OK;
}

/** Frees the slot, no refund. `wasLive`: the mods change (link kW, KREEP). */
export function abandonOutpost(s: GameState, pid: ProspectId): ActionResult & { wasLive: boolean } {
  const i = s.survey.outposts.findIndex((o) => o.id === pid);
  if (i < 0) return { ok: false, reason: `NO OUTPOST AT ${PROSPECTS[pid]?.short ?? pid}`, wasLive: false };
  const [o] = s.survey.outposts.splice(i, 1);
  alert(s, `OUTPOST ABANDONED — ${PROSPECTS[pid].short}; the slot is free (no refund)`, 'info');
  return { ok: true, reason: '', wasLive: o.live };
}

/** Test and probe shortcut: exactly n live outposts, at the nearest
 *  prospects worth claiming (surveyed for free, nothing paid). */
export function forceOutposts(s: GameState, n: number) {
  const ids = PROSPECT_IDS.filter((id) => !['heritage', 'anomaly'].includes(PROSPECTS[id].kind))
    .sort((a, b) => prospectDist(s.siteId, a) - prospectDist(s.siteId, b))
    .slice(0, Math.max(0, n));
  s.survey.outposts = ids.map((id): OutpostState => ({
    id, kind: PROSPECTS[id].kind as OutpostKind, cls: prospectClass(s.siteId, id),
    claimedAt: s.simTime, readyAt: s.simTime, live: true, fuelOk: true, upkeepOk: true,
  }));
  for (const id of ids) {
    s.survey.prospects[id] ??= { surveyedAt: s.simTime, cls: prospectClass(s.siteId, id), data: 0 };
  }
}

// ─────────────────────────── economy step 8.7 ───────────────────────────

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

  // surveys: the robot comes home with the data
  const a = s.survey.active;
  if (a && s.simTime >= a.endsAt) {
    const p = PROSPECTS[a.id];
    const data = surveyPayout(s, mods, a.id);
    s.survey.prospects[a.id] = { surveyedAt: s.simTime, cls: prospectClass(s.siteId, a.id), data };
    s.survey.active = null;
    s.data += data;
    const tail = p.kind === 'heritage' ? 'protected heritage site'
      : p.kind === 'anomaly' ? (p.bt ? 'an anomaly worth a breakthrough' : 'nothing to extract')
      : `${KIND_LABEL[p.kind as OutpostKind]} outpost possible`;
    alert(s, `SURVEY COMPLETE — ${p.name} · +${data}≡ · ${tail}`, 'info');
    if (p.bt && !s.discoveries.includes(p.bt)) {
      s.discoveries.push(p.bt);
      const era = resolveTech(TECHS[p.bt], s.expedition).era;
      alert(s, `BREAKTHROUGH — ${TECHS[p.bt].name} found at ${p.name} ` +
        `(${s.era >= era ? 'researchable now' : `researchable in Era ${era}`})`, 'info');
    }
  }

  // outposts: deploy, upkeep, hopper fuel, streams
  const caps = s.storageCaps ?? {};
  for (const o of s.survey.outposts) {
    const p = PROSPECTS[o.id];
    const mult = s.survey.atlas ? ATLAS.streamMult : 1;
    if (!o.live) {
      if (s.simTime < o.readyAt) continue;
      o.live = true;
      out.modsChanged = true;
      alert(s, `OUTPOST ONLINE — ${p.short} ${KIND_LABEL[o.kind]}: ${streamText(o.id, mult)}`, 'info');
    }
    const oc = OUTPOST_CLASS[o.cls];
    const upkeep = (oc.upkeepPerDay / CYCLE_S) * dt;
    o.upkeepOk = s.resources.parts >= upkeep;
    if (o.upkeepOk) move('parts', -upkeep);
    else condition(s, `outpostWorn:${o.id}`, `OUTPOST WORN — ${p.short} stream ×0.5 (no parts for its upkeep)`, 'warn', { panel: 'parts' });
    const { res, data } = baseStream(o.id);
    const k = mult * (o.upkeepOk ? 1 : 0.5);
    // a hopper that cannot fuel grounds its stream; its own delivery counts
    // toward the fuel (an ice hopper carries its water home)
    const fuel = Object.entries(oc.fuel ?? {}) as [ResourceId, number][];
    const short = fuel.find(([rid, rate]) => spare(s, mods, rid) + (res[rid] ?? 0) * k * dt < rate * dt);
    o.fuelOk = !short;
    if (short) {
      condition(s, `grounded:${o.id}`, `HOPPER GROUNDED — ${p.short} needs ${fuelText(o.cls, true)} ` +
        `(have ${Math.floor(spare(s, mods, short[0]))}${glyph(short[0])})`, 'warn', { panel: short[0] });
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
    alert(s, `ATLAS COMPLETE — SELENOGRAPHER · +${ATLAS.extraSlots} outpost slot · streams ×${ATLAS.streamMult} · ${bonus}`, 'info');
  }
  return out;
}

// ─────────────────────────── the $lunar view ───────────────────────────

/** Map UI bookkeeping the game keeps (not saved): the view on screen, and the
 *  tier the player has seen (a higher one pulses the chip and animates). */
export interface LunarUi { open: boolean; view: MapView; seenTier: number }

export function lunarView(s: GameState, mods: Mods, ui: LunarUi): LunarView {
  const tier = mods.surveyTier;
  const slots = outpostSlots(mods, s);
  const prospects: LunarProspectView[] = PROSPECT_IDS.map((id) => {
    const p = PROSPECTS[id];
    const cost = surveyCost(s.siteId, id);
    const rec = s.survey.prospects[id];
    const visible = tier >= cost.tier;
    const outpost = s.survey.outposts.some((o) => o.id === id);
    const claimWhy = claimRefusal(s, mods, id);
    const surveyWhy = rec ? '' : surveyRefusal(s, mods, id);
    const reason = !visible ? `beyond coverage — T${cost.tier} ${tierTech(cost.tier, s)}`
      : !rec ? surveyWhy
      : outpost ? 'outpost claimed'
      : claimWhy;
    const extractable = p.kind !== 'heritage' && p.kind !== 'anomaly';
    const oc = OUTPOST_CLASS[cost.cls];
    return {
      id, cls: cost.cls, dist: Math.round(prospectDist(s.siteId, id) * 10) / 10, visible,
      surveyed: !!rec, kind: p.kind, bt: p.bt ?? null,
      claimable: visible && !!rec && !claimWhy, reason,
      name: p.name, short: p.short, lat: p.lat, lon: p.lon, geology: p.geology,
      surveyable: visible && !rec && !surveyWhy,
      data: rec ? rec.data : surveyPayout(s, mods, id),
      survey: cost,
      outpost,
      claim: extractable
        ? { cost: { ...oc.cost }, deployS: oc.deployS, upkeepPerDay: oc.upkeepPerDay,
          linkKW: OUTPOST_LINK_KW[cost.cls], fuel: fuelText(cost.cls), stream: streamText(id) }
        : null,
    };
  });
  const outposts: LunarOutpostView[] = s.survey.outposts.map((o) => {
    const oc = OUTPOST_CLASS[o.cls];
    const mult = (s.survey.atlas ? ATLAS.streamMult : 1) * (o.upkeepOk ? 1 : 0.5);
    return {
      id: o.id, kind: o.kind, readyAt: o.readyAt, fuelOk: o.fuelOk, upkeepOk: o.upkeepOk,
      stream: streamText(o.id, mult),
      name: PROSPECTS[o.id].short, cls: o.cls, live: o.live,
      deployLeft: o.live ? 0 : secsLeft(s, o.readyAt),
      fuel: fuelText(o.cls), upkeep: `${oc.upkeepPerDay}⚙/day`, linkKW: OUTPOST_LINK_KW[o.cls],
    };
  });
  const a = s.survey.active;
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
    active: a ? { id: a.id, remaining: secsLeft(s, a.endsAt) } : null,
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
