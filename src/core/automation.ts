/** The Builder (docs/13-automation-spec.md): standing rules, held orders and
 *  maintenance, run as economy step 12. The sim decides WHAT to build and
 *  WHEN, purely from the state; Game.econStep decides WHERE (core/siting.ts,
 *  over the heightfield) and commits through the same path a click takes,
 *  then reports back here (recordPlaced / recordRefused).
 *
 *  Every rule: dwell past its trigger (decaying in the hysteresis band, reset
 *  once re-armed), then cap → founded → capacity → prerequisites → budget →
 *  a request. One pending auto site per family, at most AUTO.maxPerTick
 *  placements per tick, a cooldown after each placement and a settle after
 *  each completion. It builds for capacity, not for trouble: producers that
 *  are dark, short-handed or starved make it hold and say why.
 *
 *  Extension points (docs/14): mods.builderDwellMult / builderCapMult, the
 *  `research` and `export` families, freezes (s.auto.frozenUntil and each
 *  rule's frozenUntil), and request `bypass` flags that never bypass the
 *  weld debt. */
import { BUILDINGS, DESTINY_BUILDINGS, isCompute, type BuildingId } from '../data/buildings';
import { RESOURCES, type ResourceId } from '../data/resources';
import type { SiteDef } from '../data/sites';
import { TECHS, TECH_ORDER } from '../data/techs';
import {
  CONSTRUCTION_PARTS_PER_S, CREW, DAY_S, HAUL, NIGHT_S,
} from '../data/balance';
import {
  AUTO, FAMILY_LABEL, FAMILY_PRIORITY, NOT_ORDERABLE, RULES, RULE_ORDER, RULE_TEXT, rulesOf,
  type AutoFamily, type AutoRuleId, type RuleDef,
} from '../data/automation';
import type { AutoOrder, AutoTag, BuildingState, GameState, RulePhase, RuleState } from './state';
import { defaultRule } from './state';
import { effectiveDef, effectiveRates, type Mods } from './mods';
import { producerOf, researchRates, techCost } from './research';
import { alert, boardingShortfall, condition, settlersWelcome, volleyTerms } from './economy';
import { flowBalance } from './flowBook';
import { fmtClock, type DayInfo } from './daynight';

// ─────────────────────────── requests ───────────────────────────

/** Where the chooser should look: the resource it is for, a building to
 *  stand like, the rule asking, the network's edge (Relay Masts). */
export interface SiteIntent { res?: ResourceId; like?: number; rule?: AutoRuleId | 'order'; edge?: boolean }

export type AutoRequest =
  | {
    kind: 'place'; type: BuildingId; by: 'rule' | 'order';
    rule?: AutoRuleId; order?: number; intent: SiteIntent;
    /** the signal, for the alert: 'regolith 18▲/min short' */
    why: string;
    /** a life-support or power crisis: with the Governor, the site jumps the rover queue */
    crisis?: boolean;
    /** Maintenance: the worn building this one replaces */
    replaces?: number;
    /** hazards (docs/14) may skip the cap or the reserve — never the weld debt */
    bypass?: { cap?: boolean; reserve?: boolean };
    /** RUNAWAY RULE (docs/14 §3.5): a junk site for this hazard (its id) */
    junk?: number;
  }
  | { kind: 'demolish'; id: number; why: string }
  /** a planned dig site, applied when an auto excavator stands */
  | { kind: 'dig'; id: number; x: number; z: number }
  /** Feed Planner: re-aim this excavator at the feed the furnaces want */
  | { kind: 'feed'; id: number };

// ─────────────────────────── helpers ───────────────────────────

const isSite = (b: { construction?: number }) => (b.construction ?? 0) > 0;
const complete = (b: { construction?: number }) => !isSite(b);
const name = (t: BuildingId) => BUILDINGS[t].name;
const label = (b: BuildingState) => `${name(b.type)} #${b.id}`;
const plural = (t: BuildingId, n: number) => (n === 1 ? name(t) : `${name(t)}s`);
const glyph = (r: ResourceId) => RESOURCES[r].glyph;
/** '18', '1.2', '0.3' (per-minute rates and the like) */
export function num(v: number): string {
  const a = Math.abs(v);
  return a >= 10 ? String(Math.round(v)) : a >= 1 ? v.toFixed(1).replace(/\.0$/, '') : v.toFixed(2).replace(/0$/, '');
}
const perMin = (perS: number) => num(perS * 60);

/** the tech that unlocks a building, for 'locked — …' */
function unlocker(type: BuildingId): string {
  for (const t of TECH_ORDER) {
    if (TECHS[t].effects.some((fx) => fx.kind === 'unlock' && fx.building === type)) return TECHS[t].name;
  }
  return 'research';
}

/** the tech that unlocks a family's rules (a lane tech, or an Automation
 *  pick that extends the Builder: docs/14 §2.5) */
export function familyTech(f: AutoFamily): string {
  for (const t of TECH_ORDER) {
    if (TECHS[t].effects.some((fx) => (fx.kind === 'autoRule' && fx.family === f) ||
      (fx.kind === 'builder' && fx.families?.includes(f)))) return TECHS[t].name;
  }
  return 'a later tech';
}

export function ruleState(s: GameState, id: AutoRuleId): RuleState {
  return (s.auto.rules[id] ??= defaultRule(id));
}

/** the building a rule adds here (life support: whatever makes its resource;
 *  never a destiny building, until Selenic Mind lets rules build everything) */
export function ruleBuilding(s: GameState, mods: Mods, id: AutoRuleId): BuildingId | null {
  const d = RULES[id];
  if (d.building !== 'producer') return d.building;
  if (!d.res) return null;
  const p = producerOf(d.res, s, mods, mods.builderAll ? [] : DESTINY_BUILDINGS);
  return p?.kind === 'building' ? p.id : null;
}

/** the effective cap (destiny's cap multiplier applies) */
export const effCap = (r: RuleState, mods: Mods) => Math.max(0, Math.round(r.cap * mods.builderCapMult));

const count = (s: GameState, t: BuildingId) => s.buildings.filter((b) => b.type === t).length;
const completeCount = (s: GameState, t: BuildingId) => s.buildings.filter((b) => b.type === t && complete(b)).length;

/** the draw a new building of the type adds (agent tax as placement sets it) */
function newDraw(s: GameState, mods: Mods, site: SiteDef, type: BuildingId, automated: boolean): number {
  const kw = effectiveRates(type, mods, site, undefined, {
    robotic: s.expedition === 'robotic', agentRun: automated && BUILDINGS[type].crew > 0,
  }).powerKW;
  return kw < 0 ? -kw : 0;
}

function nameplate(s: GameState, mods: Mods, site: SiteDef, type: BuildingId) {
  return effectiveRates(type, mods, site, undefined, { robotic: s.expedition === 'robotic', agentRun: s.expedition === 'robotic' });
}

/** Is a Data Center running (Predictive Scheduling needs one)? */
export const predictiveOn = (s: GameState, mods: Mods) =>
  mods.predictive && s.buildings.some((b) => isCompute(b.type) && b.active);

/** the power book as the rules read it */
export function powerBook(s: GameState, mods: Mods) {
  const p = s.power;
  const load = Math.max(0, p.demand - (p.construction ?? 0));
  const full = p.supplyFull ?? p.supply;
  const pending = pendingDraw(s);
  // the night: day loads scaled to night draw, against what the night leaves
  const nightLoad = mods.dayDrawMult > 0 ? (load / mods.dayDrawMult) * mods.nightDrawMult : load;
  const nightShort = Math.max(0, nightLoad - (p.supplyNight ?? 0));
  const cover = nightShort > 0 ? p.capacity / (nightShort * NIGHT_S) : Infinity;
  // what refilling the bank by dusk takes, spread over the sunlit hours
  const recharge = Math.min(p.capacity, nightShort * NIGHT_S) / (DAY_S * 0.85);
  return { load, full, pending, headroom: full - load - pending, nightShort, cover, recharge };
}

/** nameplate draw of every site still under construction (it will draw when it stands) */
function pendingDraw(s: GameState): number {
  let kw = 0;
  for (const b of s.buildings) {
    if (!isSite(b)) continue;
    const d = BUILDINGS[b.type].powerKW;
    if (d < 0) kw += -d * (b.automated && BUILDINGS[b.type].crew > 0 ? 1.6 : 1);
  }
  return kw;
}

/** parts the queue still needs to finish welding */
export function weldDebt(s: GameState, mods: Mods): number {
  let sec = 0;
  for (const b of s.buildings) if (isSite(b)) sec += (b.construction ?? 0) / Math.max(1e-6, mods.weldRateMult);
  return sec * CONSTRUCTION_PARTS_PER_S * mods.weldPartsMult;
}

export function buildCostAt(type: BuildingId, site: SiteDef): Partial<Record<ResourceId, number>> {
  const out: Partial<Record<ResourceId, number>> = {};
  for (const [r, a] of Object.entries(BUILDINGS[type].buildCost)) out[r as ResourceId] = Math.ceil((a ?? 0) * site.buildCostMult);
  return out;
}

/** The Governor's floor for a resource (the player's, else the default). */
export function governorFloor(s: GameState, r: ResourceId): number {
  const set = s.auto.reserve[r];
  if (set !== undefined) return set;
  if (r === 'chips') return AUTO.governorChips;
  if (r === 'metals' || r === 'silicon' || r === 'parts') return Math.round((s.storageCaps?.[r] ?? 0) * AUTO.governorShare);
  return 0;
}

/** research goods the builder leaves alone: stalled techs (and, with the
 *  Governor, techs at least AUTO.governorPaid paid) */
function researchHeld(s: GameState, mods: Mods): Partial<Record<ResourceId, number>> {
  const out: Partial<Record<ResourceId, number>> = {};
  for (const tid of s.researchQueue) {
    const c = techCost(tid, s);
    const paid = (s.researchSpent[tid] ?? 0) / Math.max(1, c.data);
    if (!(s.researchStalled.includes(tid) || (mods.governor && paid >= AUTO.governorPaid))) continue;
    for (const [r, a] of Object.entries(c.goods)) out[r as ResourceId] = (out[r as ResourceId] ?? 0) + (a ?? 0);
  }
  return out;
}

export interface BudgetOpts {
  /** 'rule': one more of the same stays in stock; 'order': the player's command; 'held': a held order */
  by: 'rule' | 'order' | 'held';
  /** hazard requests (docs/14): skip the rule reserve (never the weld debt, never the Governor's floors) */
  bypassReserve?: boolean;
  /** higher-priority rules saving up (the Governor's holds) */
  holds?: Partial<Record<ResourceId, number>>;
}

/** Why the builder may not pay for one of `type` now ('' = it may). */
export function budgetShort(s: GameState, mods: Mods, site: SiteDef, type: BuildingId, o: BudgetOpts): string {
  const cost = buildCostAt(type, site);
  const held = o.by === 'order' ? {} : researchHeld(s, mods);
  for (const [r, amt] of Object.entries(cost) as [ResourceId, number][]) {
    let reserve = 0;
    if (o.by === 'rule' && !o.bypassReserve) reserve = amt;
    if (mods.governor && o.by !== 'order') reserve = Math.max(reserve, governorFloor(s, r));
    reserve += held[r] ?? 0;
    reserve += o.holds?.[r] ?? 0;
    if (r === 'parts') reserve += weldDebt(s, mods) + AUTO.partsFloor;
    const have = s.resources[r] ?? 0;
    if (have - amt < reserve - 1e-6) {
      const floor = Math.ceil(reserve);
      return floor > 0
        ? `needs ${amt}${glyph(r)} above the ${floor}${glyph(r)} reserve (have ${Math.floor(have)})`
        : `needs ${amt}${glyph(r)} (have ${Math.floor(have)})`;
    }
  }
  return '';
}

/** Crew for a new station on a crewed base: crewed if hands are free, else
 *  Autonomous where the base allows it, else a refusal. */
export function crewPlan(s: GameState, mods: Mods, type: BuildingId): { automated: boolean; refusal: string } {
  if (s.expedition === 'robotic') return { automated: true, refusal: '' };
  const seats = Math.max(0, BUILDINGS[type].crew + (mods.crewDelta[type] ?? 0));
  if (seats === 0) return { automated: false, refusal: '' };
  let used = 0;
  for (const b of s.buildings) {
    if (!b.enabled || b.automated) continue;
    used += Math.max(0, BUILDINGS[b.type].crew + (mods.crewDelta[b.type] ?? 0));
  }
  if (s.crew - used >= seats) return { automated: false, refusal: '' };
  if (mods.automation) return { automated: true, refusal: '' };
  return { automated: false, refusal: `no free hands for a ${name(type)} (${seats} crew) — Construction Robotics lets agents run it` };
}

// ─────────────────────────── signals ───────────────────────────

interface Signal {
  /** the trigger holds */
  past: boolean;
  /** back past the re-arm level: the dwell resets */
  rearmed: boolean;
  /** what the signal reads, for the status line */
  text: string;
  /** act at once (no dwell): a dawn after a dry bank, a prerequisite request */
  now?: boolean;
  crisis?: boolean;
  /** not readable now (by day only, no crew): the dwell holds */
  hold?: boolean;
  /** the resource the site is for, when the signal picks it (a full store) */
  res?: ResourceId;
}

/** predicted change to a resource's balance from sites still being built (Predictive Scheduling) */
function pendingBalance(s: GameState, mods: Mods, site: SiteDef, r: ResourceId): number {
  let d = 0;
  for (const b of s.buildings) {
    if (!isSite(b)) continue;
    const e = nameplate(s, mods, site, b.type);
    d += (e.outputs[r] ?? 0) - (e.inputs[r] ?? 0);
  }
  return d;
}

function balanceOf(s: GameState, mods: Mods, site: SiteDef, r: ResourceId): number {
  return flowBalance(s, r) + (predictiveOn(s, mods) ? pendingBalance(s, mods, site, r) : 0);
}

const shortText = (r: ResourceId, bal: number) => (bal < 0
  ? `${RESOURCES[r].name.toLowerCase()} ${perMin(-bal)}${glyph(r)}/min short`
  : `${RESOURCES[r].name.toLowerCase()} supply ${perMin(bal)}${glyph(r)}/min over demand`);

const pct = (f: number) => `${Math.round(f * 100)}%`;

/** The day is readable: full sun, no flare. */
const fullSun = (s: GameState, site: SiteDef, day: DayInfo) =>
  !day.isNight && day.sunFactor >= site.solarDayMult * 0.95 && s.flare.phase !== 'active';

function signalOf(s: GameState, mods: Mods, site: SiteDef, day: DayInfo, id: AutoRuleId, r: RuleState): Signal {
  const d = RULES[id];
  const T = r.threshold;
  const H = d.rearm ?? T + (d.rearmDelta ?? 0);
  const stockBelow = (res: ResourceId, share: number) => {
    const cap = s.storageCaps?.[res];
    return cap === undefined || s.resources[res] < cap * share;
  };
  switch (id) {
    case 'excavator': case 'iceHarvester': {
      const res = d.res!;
      const bal = balanceOf(s, mods, site, res);
      return { past: bal < T && stockBelow(res, 0.5), rearmed: bal >= H, text: shortText(res, bal) };
    }
    case 'smelter': case 'refinery': case 'partsFab': {
      const res = d.res!;
      const bal = balanceOf(s, mods, site, res);
      const stalled = id === 'refinery' && s.researchStalled.some((t) => (techCost(t, s).goods.silicon ?? 0) > s.resources.silicon);
      return {
        past: (bal < T && stockBelow(res, 0.5)) || stalled,
        rearmed: !stalled && (bal >= H || !stockBelow(res, 0.6)),
        text: stalled ? 'research waits on silicon' : shortText(res, bal),
      };
    }
    case 'solar': {
      const m = s.auto.margin;
      if (m === null || !fullSun(s, site, day)) {
        return { past: false, rearmed: false, hold: true, text: m === null ? 'the day’s margin is read in full sun' : `margin ${pct(m)} (read by day)` };
      }
      return { past: m < T, rearmed: m >= H, text: `the day’s margin ${pct(m)} after the bank’s recharge` };
    }
    case 'battery': {
      if (day.isNight) return { past: false, rearmed: false, hold: true, text: 'never builds at night' };
      const dry = (s.stats.bankDryDawns ?? 0) > (r.seen ?? 0);
      if (dry) return { past: true, rearmed: false, now: true, text: 'the bank ran dry last night' };
      if (predictiveOn(s, mods)) {
        const c = powerBook(s, mods).cover;
        return {
          past: c < T, rearmed: c >= H,
          text: c === Infinity ? 'the night needs no bank' : `the bank carries ${pct(Math.min(9.99, c))} of a night (forecast)`,
        };
      }
      return { past: false, rearmed: true, text: 'waits for a night the bank runs dry (Predictive Scheduling forecasts it)' };
    }
    case 'reactor': {
      if (day.isNight) return { past: false, rearmed: false, hold: true, text: 'reads the night by day' };
      const pb = powerBook(s, mods);
      const bat = ruleState(s, 'battery');
      const full = count(s, 'battery') >= effCap(bat, mods);
      return {
        past: pb.nightShort > T && full, rearmed: pb.nightShort <= T,
        text: `the night runs ${Math.round(pb.nightShort)} kW short${full ? '' : ' (batteries first)'}`,
      };
    }
    case 'storageYard': {
      // room at the top only helps when the base will pay more of it at once
      // than the store holds: the largest queued research payment
      const bigPay = (res: ResourceId) => s.researchQueue.reduce((m, t) => Math.max(m, techCost(t, s).goods[res] ?? 0), 0);
      let worst: ResourceId | null = null;
      let fill = 0;
      let need = 0;
      for (const [res, cap] of Object.entries(s.storageCaps ?? {}) as [ResourceId, number][]) {
        if (!cap) continue;
        const f = s.resources[res] / cap;
        const idle = s.buildings.some((b) => b.idleReason === 'full' && (effectiveDef(b.type, mods).outputs[res] ?? 0) > 0);
        const pay = bigPay(res);
        if (f >= T && idle && cap < 1.5 * pay && f > fill) { fill = f; worst = res; need = pay; }
      }
      const any = Object.entries(s.storageCaps ?? {}).some(([res, cap]) => cap && s.resources[res as ResourceId] / cap >= H &&
        cap < 1.5 * bigPay(res as ResourceId));
      return {
        past: worst !== null, rearmed: !any, ...(worst ? { res: worst } : {}),
        text: worst
          ? `${RESOURCES[worst].name.toLowerCase()} ${pct(fill)} full, and research will want ${need}${glyph(worst)} of it at once`
          : 'every store has room for what research will ask',
      };
    }
    case 'chipFab': {
      const stalled = s.researchStalled.some((t) => (techCost(t, s).goods.chips ?? 0) > s.resources.chips);
      let need = 0;
      for (const t of s.researchQueue) need += techCost(t, s).goods.chips ?? 0;
      const soon = s.resources.chips + (s.flowBook.chips?.made ?? 0) * 600;
      const short = need > 0 && need > 1.5 * soon;
      return {
        past: stalled || short, rearmed: !stalled && !short,
        text: stalled ? 'research waits on chips' : short ? `queued research wants ${need}▣, ~${Math.floor(soon)} in 10 min` : 'chips keep up',
      };
    }
    case 'roboticsBay': {
      const backlog = s.buildings.filter((b) => isSite(b) && b.enabled && b.idleReason === 'queued').length;
      return { past: backlog >= T, rearmed: backlog <= (d.rearm ?? 0), text: `${backlog} site${backlog === 1 ? '' : 's'} waiting for a rover` };
    }
    case 'oxygen': case 'food': case 'water': {
      const res = d.res!;
      if (s.crew <= 0) return { past: false, rearmed: true, hold: true, text: 'nobody aboard yet' };
      const net = s.rates[res] ?? 0;
      const runway = net < 0 ? s.resources[res] / -net : Infinity;
      const bal = balanceOf(s, mods, site, res);
      const min = runway / 60;
      return {
        past: min < T || (bal < 0 && min < 3 * T),
        rearmed: min >= H && bal >= 0,
        crisis: runway < AUTO.crisisRunwayS,
        text: runway === Infinity ? `${RESOURCES[res].name.toLowerCase()} holding` : `${RESOURCES[res].name.toLowerCase()} lasts ${fmtClock(runway)}`,
      };
    }
    case 'habitat': {
      const free = (s.housingActive ?? 0) - s.crew;
      const possible = settlersWelcome(s) && s.morale > CREW.growthMorale &&
        boardingShortfall(s, mods.inputMult.habitat) === '';
      if (!possible) return { past: false, rearmed: free >= H, hold: true, text: `${Math.max(0, free)} free bed${free === 1 ? '' : 's'} · no arrival due` };
      return { past: free < T, rearmed: free >= H, text: `${Math.max(0, free)} free bed${free === 1 ? '' : 's'}` };
    }
    case 'relayMast': {
      const stuck = RULE_ORDER.find((x) => x !== 'relayMast' && s.auto.rules[x]?.phase === 'nosite' && (s.auto.rules[x]?.holdT ?? 0) >= AUTO.nositeS);
      return { past: !!stuck, rearmed: !stuck, text: stuck ? `the ${FAMILY_LABEL[RULES[stuck].family]} rule has no ground` : 'every rule has ground' };
    }
    case 'lab': {
      const rr = researchRates(s, mods);
      const waits = s.researchQueue.length > 0 && !s.researchPaused && rr.cap > 0 && s.data >= 60 * rr.cap;
      return { past: waits, rearmed: s.data < 20 * rr.cap, text: waits ? `${Math.floor(s.data)}≡ banked behind a ${num(rr.cap * 60)}≡/min transfer cap` : 'research keeps up' };
    }
    case 'foilFactory': {
      const v = volleyTerms(s, mods);
      const held = mods.launchArmed && s.resources.launch >= v.launch && s.resources.foils < v.foils;
      return { past: held, rearmed: !held, text: held ? `a volley waits on foils (${Math.floor(s.resources.foils)}/${v.foils}▰)` : 'foils keep up' };
    }
    case 'replace':
      return { past: false, rearmed: true, text: '' };
  }
}

// ─────────────────────────── checks ───────────────────────────

/** the main input a processor needs another of (and the rule that supplies it) */
const INPUT_OF: Partial<Record<BuildingId, { res: ResourceId; rule: AutoRuleId }>> = {
  smelter: { res: 'regolith', rule: 'excavator' },
  refinery: { res: 'regolith', rule: 'excavator' },
  partsFab: { res: 'metals', rule: 'smelter' },
  chipFab: { res: 'silicon', rule: 'refinery' },
  hydroponics: { res: 'water', rule: 'water' },
  foilFactory: { res: 'silicon', rule: 'refinery' },
};

/** 'holding' reasons: producers that are dark or short-handed (more would not help) */
function capacityTrouble(s: GameState, type: BuildingId): string {
  const live = s.buildings.filter((b) => b.type === type && complete(b) && b.enabled);
  const dark = live.filter((b) => b.idleReason === 'power').length;
  if (dark) return `${dark} of ${live.length} ${plural(type, live.length)} dark (power) — more would not help`;
  const crew = live.filter((b) => b.idleReason === 'crew').length;
  if (crew) return `${crew} of ${live.length} ${plural(type, live.length)} short of crew — more would not help`;
  return '';
}

function inputShort(s: GameState, mods: Mods, site: SiteDef, type: BuildingId): { res: ResourceId; rule: AutoRuleId } | null {
  const inp = INPUT_OF[type];
  if (!inp) return null;
  const starved = s.buildings.some((b) => b.type === type && complete(b) && b.enabled && b.idleReason === 'inputs');
  const want = nameplate(s, mods, site, type).inputs[inp.res] ?? 0;
  const bal = flowBalance(s, inp.res);
  if (starved || (bal < 0 && s.resources[inp.res] < 600 * want)) return inp;
  return null;
}

// ─────────────────────────── the tick ───────────────────────────

const REFUSAL: RulePhase[] = ['waiting', 'holding', 'nosite', 'founded'];

/** Raise a rule's pending refusal as a condition once it has held long enough. */
function raiseRefusal(s: GameState, id: AutoRuleId, r: RuleState) {
  if (!REFUSAL.includes(r.phase) || r.holdT < AUTO.refusalAlertS || r.phase === 'founded') return;
  const fam = RULES[id].family;
  const crit = fam === 'life' || fam === 'power';
  const head = r.phase === 'holding' ? 'AUTO HOLD' : r.phase === 'nosite' ? 'AUTO NO SITE' : 'AUTO WAITING';
  condition(s, `auto:${id}`, `${head} — ${FAMILY_LABEL[fam]}: ${r.why}`, crit && r.phase !== 'nosite' ? 'warn' : 'info', { panel: 'builder' });
}

function setPhase(s: GameState, id: AutoRuleId, r: RuleState, phase: RulePhase, why: string, dt: number) {
  if (phase === 'capped' && r.phase !== 'capped') {
    const t = RULES[id].building;
    alert(s, `AUTO CAP — ${r.cap}/${r.cap} ${t === 'producer' ? 'makers' : plural(t, r.cap)}: the ${FAMILY_LABEL[RULES[id].family]} rule stops here · raise the cap in [B]`,
      'info', { panel: 'builder' });
  }
  r.holdT = REFUSAL.includes(phase) && (r.phase === phase || REFUSAL.includes(r.phase)) ? r.holdT + dt : REFUSAL.includes(phase) ? dt : 0;
  r.phase = phase;
  r.why = why;
}

export function logAuto(s: GameState, text: string, id?: number) {
  s.auto.log.push({ at: s.simTime, text, ...(id !== undefined ? { id } : {}) });
  if (s.auto.log.length > AUTO.logMax) s.auto.log.splice(0, s.auto.log.length - AUTO.logMax);
}

/** Economy step 12. Returns what Game.econStep should place, dig or demolish. */
export function automationTick(s: GameState, site: SiteDef, mods: Mods, day: DayInfo, dt: number): AutoRequest[] {
  const out: AutoRequest[] = [];
  const now = s.simTime;
  const a = s.auto;
  a.vetoes = a.vetoes.filter((v) => v.until > now);

  // the day's margin: an EMA of full-sun samples only
  if (fullSun(s, site, day)) {
    const pb = powerBook(s, mods);
    // the margin left once the bank's recharge is paid (a bank that never fills runs dry every night)
    const m = (pb.full - pb.load - pb.recharge) / Math.max(1, pb.load);
    a.margin = a.margin === null ? m : a.margin + (m - a.margin) * Math.min(1, dt / 20);
  }

  // a family newly unlocked switches its rules on (a loaded save never does:
  // its families were recorded when they unlocked)
  const seen = a.families;
  for (const f of FAMILY_PRIORITY) {
    if (!mods.autoFamilies.has(f) || seen.includes(f)) continue;
    seen.push(f);
    const on = rulesOf(f).filter((id) => RULES[id].onByDefault && !(id === 'iceHarvester' && !site.hasIce));
    for (const id of on) ruleState(s, id).on = true;
    const main = on[0];
    const capped = main && RULES[main].capRange[1] > 1 ? ` · cap ${ruleState(s, main).cap}` : '';
    alert(s, `BUILDER — the ${FAMILY_LABEL[f]} rule${on.length === 1 ? ' is' : 's are'} on` +
      (main ? `: ${RULE_TEXT[main]}${capped}` : '') + ' · [B] to tune', 'info', { panel: 'builder' });
  }

  // sites the builder placed: completions settle their rule; planned dig sites apply
  for (const b of s.buildings) {
    const t = b.auto;
    if (!t || isSite(b)) continue;
    if (t.dig && b.type === 'excavator') {
      out.push({ kind: 'dig', id: b.id, x: t.dig.x, z: t.dig.z });
      delete t.dig;
    }
    if (t.replaces !== undefined) {
      const old = s.buildings.find((x) => x.id === t.replaces);
      if (old) out.push({ kind: 'demolish', id: old.id, why: `replaced by ${label(b)}` });
      delete t.replaces;
    }
  }
  for (const id of RULE_ORDER) {
    const r = a.rules[id];
    if (!r || r.site === null) continue;
    const b = s.buildings.find((x) => x.id === r.site);
    if (b && isSite(b)) continue;
    r.site = null;
    if (b) {
      // it stands: let the averages catch up before the next one (an excavator's first load is late)
      const haul = RULES[id].building === 'excavator' ? HAUL.digS + HAUL.unloadS + 60 : 0;
      r.nextAt = Math.max(r.nextAt, now + RULES[id].settleS + haul);
      r.dwell = 0;
    }
  }

  const frozenAll = a.frozenUntil > now;
  const order: AutoFamily[] = mods.governor ? a.priority : FAMILY_PRIORITY;
  const holds: Partial<Record<ResourceId, number>> = {};
  const busy = new Set<AutoFamily>();
  for (const b of s.buildings) if (isSite(b) && b.auto?.by === 'rule' && b.auto.rule) busy.add(RULES[b.auto.rule].family);
  let placed = 0;
  const forced = new Set<AutoRuleId>();
  const predictive = predictiveOn(s, mods);

  const evaluate = (id: AutoRuleId) => {
    const d: RuleDef = RULES[id];
    const r = ruleState(s, id);
    if (id === 'replace') return; // maintenance runs below
    if (!mods.autoFamilies.has(d.family)) { setPhase(s, id, r, 'locked', `locked — ${familyTech(d.family)}`, dt); r.dwell = 0; return; }
    if (!r.on) { setPhase(s, id, r, 'off', 'off', dt); r.dwell = 0; return; }
    if (id === 'iceHarvester' && !site.hasIce) { setPhase(s, id, r, 'locked', 'no polar ice at this site', dt); return; }
    const type = ruleBuilding(s, mods, id);
    if (!type) { setPhase(s, id, r, 'locked', `nothing here makes ${RESOURCES[d.res!].name.toLowerCase()} yet`, dt); return; }
    if (!mods.unlocked.has(type)) { setPhase(s, id, r, 'locked', `locked — ${unlocker(type)}`, dt); return; }
    const frozen = Math.max(frozenAll ? a.frozenUntil : 0, r.frozenUntil ?? 0);
    if (frozen > now) { setPhase(s, id, r, 'frozen', `frozen · resumes in ${fmtClock(frozen - now)}`, dt); return; }
    if (r.site !== null) {
      const b = s.buildings.find((x) => x.id === r.site);
      setPhase(s, id, r, 'building', b ? siteLine(b) : '→ building', dt);
      return;
    }
    if (now < r.nextAt) {
      const vetoed = r.phase === 'vetoed';
      setPhase(s, id, r, vetoed ? 'vetoed' : 'settling', vetoed
        ? `${r.why.split(' — resumes')[0]} — resumes in ${fmtClock(r.nextAt - now)}`
        : `settling ${fmtClock(r.nextAt - now)} — letting the rates catch up`, dt);
      return;
    }
    const sig = signalOf(s, mods, site, day, id, r);
    const force = forced.has(id);
    // dark or short-handed producers: the shortfall is theirs, not the fleet's —
    // hold, and start the dwell over once it clears
    const trouble = !force && (sig.past || sig.now) ? capacityTrouble(s, type) : '';
    if (trouble) { r.dwell = 0; setPhase(s, id, r, 'holding', `holding · ${trouble}`, dt); return; }
    if (!sig.hold) r.dwell = sig.past ? r.dwell + dt : sig.rearmed ? 0 : Math.max(0, r.dwell - dt);
    const dwellS = d.dwellS * mods.builderDwellMult * (predictive ? 0.5 : 1);
    if (!force && !sig.now && !(sig.past && r.dwell >= dwellS)) {
      if (!sig.past && r.dwell === 0) setPhase(s, id, r, 'ok', `ok · ${sig.text}`, dt);
      else setPhase(s, id, r, 'watching', `watching · ${sig.text} for ${Math.floor(r.dwell)} s of ${Math.round(dwellS)}`, dt);
      return;
    }
    const why = force ? `asked for by another rule · ${sig.text}` : sig.text;
    // would build: in order, what stops it
    if (busy.has(d.family)) {
      const other = s.buildings.find((b) => isSite(b) && b.auto?.by === 'rule' && b.auto.rule && RULES[b.auto.rule].family === d.family);
      setPhase(s, id, r, 'waiting', `waiting · the family's site ${other ? label(other) : ''} first`.trim(), dt);
      return;
    }
    if (placed >= AUTO.maxPerTick) { setPhase(s, id, r, 'watching', `watching · ${why}`, dt); return; }
    const cap = effCap(r, mods);
    const n = count(s, type);
    if (n >= cap) { setPhase(s, id, r, 'capped', `cap ${n}/${cap} ${plural(type, cap)} — raise the cap to let it build more`, dt); return; }
    if (completeCount(s, type) === 0) {
      setPhase(s, id, r, 'founded', `found the first ${name(type)} yourself — the builder extends what you found`, dt);
      return;
    }
    if (s.buildings.some((b) => b.type === type && isSite(b) && b.auto?.by === 'order')) {
      setPhase(s, id, r, 'waiting', `waiting · your order for ${plural(type, 2)} is still building`, dt);
      return;
    }
    const busyTrouble = capacityTrouble(s, type);
    if (busyTrouble) { setPhase(s, id, r, 'holding', `holding · ${busyTrouble}`, dt); return; }
    const crew = crewPlan(s, mods, type);
    if (crew.refusal) { setPhase(s, id, r, 'holding', `holding · ${crew.refusal}`, dt); return; }
    // power headroom for a consumer
    const draw = newDraw(s, mods, site, type, crew.automated);
    if (draw > 0) {
      const pb = powerBook(s, mods);
      if (pb.headroom < AUTO.headroom * draw) {
        const solar = ruleState(s, 'solar');
        if (mods.autoFamilies.has('power') && solar.on && id !== 'solar') {
          forced.add('solar');
          setPhase(s, id, r, 'waiting', `waiting for power · a Solar Array first (${Math.round(pb.headroom)} kW spare, needs ${Math.ceil(draw * AUTO.headroom)})`, dt);
        } else {
          setPhase(s, id, r, 'holding', `holding · a ${name(type)}'s ${num(draw)} kW would brown the grid out — build power first (Automated Power does)`, dt);
        }
        return;
      }
    }
    const inp = inputShort(s, mods, site, type);
    if (inp) {
      const other = ruleState(s, inp.rule);
      const res = RESOURCES[inp.res].name.toLowerCase();
      if (mods.autoFamilies.has(RULES[inp.rule].family) && other.on && inp.rule !== id) {
        forced.add(inp.rule);
        setPhase(s, id, r, 'waiting', `waiting for ${res} · the ${FAMILY_LABEL[RULES[inp.rule].family]} rule first`, dt);
      } else {
        setPhase(s, id, r, 'holding', `holding · no ${res} for another ${name(type)} — ${familyTech(RULES[inp.rule].family)} would supply it`, dt);
      }
      return;
    }
    const short = budgetShort(s, mods, site, type, { by: 'rule', holds });
    if (short) {
      setPhase(s, id, r, 'waiting', `waiting · ${short}`, dt);
      if (mods.governor) for (const [res, amt] of Object.entries(buildCostAt(type, site))) holds[res as ResourceId] = (holds[res as ResourceId] ?? 0) + (amt ?? 0);
      return;
    }
    out.push({
      kind: 'place', type, by: 'rule', rule: id, intent: { res: sig.res ?? d.res, rule: id, ...(id === 'relayMast' ? { edge: true } : {}) }, why,
      crisis: !!sig.crisis || (id === 'solar' && s.power.brownout && !day.isNight),
    });
    if (sig.now && id === 'battery') r.seen = s.stats.bankDryDawns ?? 0;
    busy.add(d.family);
    placed++;
    setPhase(s, id, r, 'building', `→ placing ${name(type)}`, dt);
    // the Governor: a lower rule does not spend what a higher one is saving
    if (mods.governor && r.dwell >= dwellS / 2) {
      for (const [res, amt] of Object.entries(buildCostAt(type, site))) holds[res as ResourceId] = (holds[res as ResourceId] ?? 0) + (amt ?? 0);
    }
  };

  for (const f of order) for (const id of rulesOf(f)) evaluate(id);
  // prerequisites asked for this tick by rules later in the order
  for (const id of forced) {
    const r = a.rules[id];
    if (r && r.phase !== 'building' && placed < AUTO.maxPerTick) evaluate(id);
  }
  for (const id of RULE_ORDER) { const r = a.rules[id]; if (r) raiseRefusal(s, id, r); }

  // ── held orders (Build Orders) ──
  for (const o of [...a.orders]) {
    o.placed = o.placed.filter((bid) => s.buildings.some((b) => b.id === bid));
    if (o.placed.length >= o.count) {
      a.orders = a.orders.filter((x) => x.id !== o.id);
      logAuto(s, `order #${o.id} filled: ${o.count} ${plural(o.type, o.count)}`);
      continue;
    }
    if (mods.orderBook <= 0 || frozenAll) continue;
    const why = orderRefusal(s, mods, site, o.type) || budgetShort(s, mods, site, o.type, { by: 'held' });
    o.waiting = why;
    if (why) {
      condition(s, `order:${o.id}`, `ORDER WAITING — ${name(o.type)} ${o.placed.length + 1} of ${o.count} ${why}`, 'info', { panel: 'builder' });
      continue;
    }
    if (placed >= AUTO.maxPerTick) continue;
    out.push({ kind: 'place', type: o.type, by: 'order', order: o.id, intent: o.intent, why: `order #${o.id}` });
    placed++;
  }

  // ── Maintenance Automation: worn machines replaced, tripped overclocks re-armed ──
  const rep = ruleState(s, 'replace');
  if (mods.maintenanceWear > 0) {
    const thr = rep.threshold;
    for (const b of s.buildings) {
      if (b.type === 'lander' || isSite(b)) { b.wornT = 0; continue; }
      b.wornT = b.wear >= thr ? (b.wornT ?? 0) + dt : 0;
      // an overclock that tripped at WORN comes back once it has healed, if the grid has room
      if (b.ocTripped && b.wear < AUTO.rearmWear && mods.actions.has('overclock') && (a.margin ?? 0) >= AUTO.rearmMargin) {
        b.ocTripped = false;
        b.overclock = true;
        alert(s, `OVERCLOCK RE-ARMED — ${label(b)} healed to ${Math.round((1 - b.wear) * 100)}%`, 'info', { select: b.id });
      }
    }
    const pending = s.buildings.find((b) => isSite(b) && b.auto?.replaces !== undefined);
    if (!rep.on) setPhase(s, 'replace', rep, 'off', 'off', dt);
    else if (frozenAll || (rep.frozenUntil ?? 0) > now) setPhase(s, 'replace', rep, 'frozen', 'frozen', dt);
    else if (pending) setPhase(s, 'replace', rep, 'building', siteLine(pending), dt);
    else if (now < rep.nextAt) setPhase(s, 'replace', rep, 'settling', `settling ${fmtClock(rep.nextAt - now)}`, dt);
    else {
      const worn = s.buildings
        .filter((b) => (b.wornT ?? 0) >= RULES.replace.dwellS && !s.buildings.some((x) => x.auto?.replaces === b.id))
        .sort((x, y) => (y.wornT ?? 0) - (x.wornT ?? 0) || x.id - y.id)[0];
      if (!worn) {
        const most = s.buildings.reduce((m, b) => Math.max(m, b.wornT ?? 0), 0);
        setPhase(s, 'replace', rep, 'ok', most > 0 ? `ok · a machine worn ≥${pct(thr)} for ${fmtClock(most)} of ${fmtClock(RULES.replace.dwellS)}` : 'ok · nothing worn out', dt);
      } else if (!mods.unlocked.has(worn.type)) {
        setPhase(s, 'replace', rep, 'holding', `holding · ${label(worn)} cannot be rebuilt here`, dt);
      } else {
        const short = budgetShort(s, mods, site, worn.type, { by: 'rule', holds });
        if (short) setPhase(s, 'replace', rep, 'waiting', `waiting · ${label(worn)} worn ${pct(worn.wear)}: ${short}`, dt);
        else if (placed < AUTO.maxPerTick) {
          out.push({
            kind: 'place', type: worn.type, by: 'rule', rule: 'replace', intent: { like: worn.id, rule: 'replace' },
            why: `${label(worn)} worn ${pct(worn.wear)} for a lunar day`, replaces: worn.id, bypass: { cap: true },
          });
          placed++;
          setPhase(s, 'replace', rep, 'building', `→ replacing ${label(worn)}`, dt);
        }
      }
    }
    raiseRefusal(s, 'replace', rep);
  } else {
    setPhase(s, 'replace', rep, 'locked', `locked — ${familyTech('maintenance')}`, dt);
  }

  // ── Feed Planner: one excavator a tick, each at most every 120 s ──
  if (mods.feedPlanner && !frozenAll) {
    const digs = s.buildings.filter((b) => b.type === 'excavator' && complete(b) && b.enabled && !b.feedPlanOff);
    if (digs.length) {
      const slot = Math.floor(now) % 120;
      const b = digs.find((x) => x.id % 120 === slot);
      if (b) out.push({ kind: 'feed', id: b.id });
    }
  }
  return out;
}

/** '→ building Excavator #7 · 38%' or '→ Excavator #7 queued for a rover' */
function siteLine(b: BuildingState): string {
  if (b.idleReason === 'queued') return `→ ${label(b)} queued for a rover`;
  const done = b.buildTotal ? Math.round((1 - (b.construction ?? 0) / b.buildTotal) * 100) : 0;
  return `→ building ${label(b)} · ${done}%`;
}

/** A threshold in the unit the UI shows: '−6/min', '10%', '20 min', '2'. */
export function fmtThreshold(id: AutoRuleId, v: number): string {
  const d = RULES[id];
  switch (d.unit) {
    case 'rate': return `${v < 0 ? '−' : v > 0 ? '+' : ''}${num(Math.abs(v) * 60)}${d.res ? glyph(d.res) : ''}/min`;
    case 'share': return `${Math.round(v * 100)}%`;
    case 'min': return `${Math.round(v)} min`;
    case 'kw': return `${Math.round(v)} kW`;
    case 'count': return String(Math.round(v));
    case 'none': return '';
  }
}

// ─────────────────────────── results, vetoes, orders ───────────────────────────

/** A request placed a building: tag it, log it, alert it. */
export function recordPlaced(s: GameState, req: Extract<AutoRequest, { kind: 'place' }>, b: BuildingState, why: string, survey: boolean) {
  const tag: AutoTag = { by: req.by, at: s.simTime, why, survey };
  if (req.rule) tag.rule = req.rule;
  if (req.order !== undefined) tag.order = req.order;
  if (req.replaces !== undefined) tag.replaces = req.replaces;
  b.auto = tag;
  if (req.by === 'rule' && req.rule) {
    const r = ruleState(s, req.rule);
    r.site = b.id;
    r.built += 1;
    r.nextAt = s.simTime + RULES[req.rule].cooldownS;
    r.holdT = 0;
    const fam = FAMILY_LABEL[RULES[req.rule].family];
    const text = req.rule === 'replace'
      ? `AUTO — ${label(b)} placed to replace ${req.why}`
      : `AUTO — ${label(b)} placed, ${why} · ${req.why}`;
    alert(s, text, 'info', { select: b.id });
    logAuto(s, `${label(b)} · ${fam} · ${why}`, b.id);
  } else if (req.order !== undefined) {
    const o = s.auto.orders.find((x) => x.id === req.order);
    if (o) o.placed.push(b.id);
    logAuto(s, `${label(b)} · order #${req.order} · ${why}`, b.id);
  }
}

/** The chooser found no ground (or the budget changed under it). */
export function recordRefused(s: GameState, req: Extract<AutoRequest, { kind: 'place' }>, reason: string, dt = 1) {
  if (req.by === 'rule' && req.rule) {
    const r = ruleState(s, req.rule);
    const nosite = /no valid ground/.test(reason);
    setPhase(s, req.rule, r, nosite ? 'nosite' : 'waiting', nosite ? reason : `waiting · ${reason}`, dt);
  } else if (req.order !== undefined) {
    const o = s.auto.orders.find((x) => x.id === req.order);
    if (o) o.waiting = reason;
  }
}

/** The player removed a building: an untouched auto site is a veto of that
 *  ground; any demolition defers the rules that build its type a lunar day. */
export function onPlayerDemolish(s: GameState, mods: Mods, b: BuildingState, untouched: boolean) {
  const until = s.simTime + AUTO.vetoS;
  for (const id of RULE_ORDER) {
    const r = s.auto.rules[id];
    if (!r || !r.on) continue;
    const t = ruleBuilding(s, mods, id);
    if (t !== b.type) continue;
    if (r.site === b.id) r.site = null;
    r.nextAt = Math.max(r.nextAt, until);
    r.dwell = 0;
    const why = untouched && b.auto ? `you cancelled ${label(b)}` : `you removed ${label(b)}`;
    r.phase = 'vetoed';
    r.why = why;
  }
  if (untouched && b.auto) {
    const w = BUILDINGS[b.type].footprint;
    const [fw, fd] = b.rot % 2 === 0 ? w : [w[1], w[0]];
    s.auto.vetoes.push({
      rule: b.auto.rule ?? 'order', gx0: b.gx - 1, gz0: b.gz - 1, gx1: b.gx + fw + 1, gz1: b.gz + fd + 1, until,
    });
    if (b.auto.rule) {
      alert(s, `AUTO SITE CANCELLED — the ${FAMILY_LABEL[RULES[b.auto.rule].family]} rule leaves that ground alone for a lunar day`,
        'info', { panel: 'builder' });
    }
  }
}

/** Why an order of `type` cannot be placed at all ('' = it can be tried). */
export function orderRefusal(s: GameState, mods: Mods, site: SiteDef, type: BuildingId): string {
  if (NOT_ORDERABLE.includes(type)) return 'the Lander is one of a kind';
  if (type === 'relayMast' && !mods.autoFamilies.has('network')) {
    return 'Relay Masts need a direction: place them yourself (Self-Expanding Base plants them)';
  }
  if (BUILDINGS[type].requiresIce && !site.hasIce) return 'no polar ice at this site';
  if (!mods.unlocked.has(type)) return `${name(type)} is locked: ${unlocker(type)}`;
  return '';
}

/** A new held-order record (Build Orders). */
export function newOrder(s: GameState, type: BuildingId, count: number, intent: AutoOrder['intent']): AutoOrder {
  const o: AutoOrder = { id: s.auto.nextOrderId++, type, count, placed: [], intent, at: s.simTime, waiting: '' };
  return o;
}

/** Freeze every rule (or one) for `seconds` (Freeze rules; hazards). */
export function freezeRules(s: GameState, seconds: number, rule?: AutoRuleId) {
  const until = seconds > 0 ? s.simTime + seconds : 0;
  if (rule) ruleState(s, rule).frozenUntil = until;
  else s.auto.frozenUntil = until;
}

// ─────────────────────────── the panel's view ───────────────────────────

export interface RuleView {
  id: AutoRuleId;
  family: AutoFamily;
  familyLabel: string;
  building: string;
  objective: string;
  on: boolean;
  locked: boolean;
  phase: RulePhase;
  status: string;
  threshold: number;
  thresholdText: string;
  unit: RuleDef['unit'];
  range: [number, number];
  step: number;
  cap: number;
  capRange: [number, number];
  count: number;
  res?: ResourceId;
  site: number | null;
  built: number;
}

export interface AutomationView {
  families: AutoFamily[];
  priority: AutoFamily[];
  orderBook: number;
  orderMax: number;
  governor: boolean;
  predictive: boolean;
  predictiveLive: boolean;
  siteSurvey: boolean;
  feedPlanner: boolean;
  rules: RuleView[];
  orders: { id: number; type: BuildingId; name: string; count: number; placed: number; waiting: string }[];
  reserve: { res: ResourceId; amount: number; set: boolean }[];
  log: { at: number; text: string; id?: number }[];
  pending: number;
  frozenFor: number;
  margin: number | null;
  /** the flow book per resource, per game-second (supply, demand incl. builds) */
  flow: Partial<Record<ResourceId, { made: number; want: number; spend: number }>>;
}

export function automationView(s: GameState, mods: Mods): AutomationView {
  const rules: RuleView[] = [];
  for (const f of mods.governor ? s.auto.priority : FAMILY_PRIORITY) {
    for (const id of rulesOf(f)) {
      const d = RULES[id];
      const r = s.auto.rules[id] ?? defaultRule(id);
      const type = ruleBuilding(s, mods, id);
      const locked = !mods.autoFamilies.has(f);
      // extension families and site-impossible rules stay out of the list until they matter
      if (locked && (f === 'research' || f === 'export')) continue;
      rules.push({
        id, family: f, familyLabel: FAMILY_LABEL[f],
        building: type ? name(type) : d.res ? `the ${RESOURCES[d.res].name.toLowerCase()} maker` : 'the machine',
        objective: d.objective.replace(' T', d.unit === 'none' ? '' : ` ${fmtThreshold(id, r.threshold)}`),
        on: r.on, locked, phase: locked ? 'locked' : r.phase,
        status: locked ? `locked — ${familyTech(f)}` : r.why || (r.on ? 'ok' : 'off'),
        threshold: r.threshold, thresholdText: fmtThreshold(id, r.threshold), unit: d.unit, range: d.range, step: d.step,
        cap: r.cap, capRange: d.capRange, count: type ? count(s, type) : 0, res: d.res, site: r.site, built: r.built,
      });
    }
  }
  const reserve = (['metals', 'silicon', 'parts', 'chips'] as ResourceId[]).map((res) => ({
    res, amount: governorFloor(s, res), set: s.auto.reserve[res] !== undefined,
  }));
  return {
    families: [...mods.autoFamilies], priority: [...s.auto.priority],
    orderBook: mods.orderBook, orderMax: mods.orderMax, governor: mods.governor,
    predictive: mods.predictive, predictiveLive: predictiveOn(s, mods), siteSurvey: mods.siteSurvey, feedPlanner: mods.feedPlanner,
    rules,
    orders: s.auto.orders.map((o) => ({
      id: o.id, type: o.type, name: name(o.type), count: o.count, placed: o.placed.length, waiting: o.waiting,
    })),
    reserve,
    log: [...s.auto.log].reverse(),
    pending: s.buildings.filter((b) => isSite(b) && b.auto).length,
    frozenFor: Math.max(0, s.auto.frozenUntil - s.simTime),
    margin: s.auto.margin,
    flow: Object.fromEntries(Object.entries(s.flowBook ?? {}).map(([r, e]) => [r, { made: e!.made, want: e!.want, spend: e!.spend }])),
  };
}

/** Rules whose signal lives on a resource panel ('power', 'crew', 'bots' too). */
export function rulesForPanel(key: string): AutoRuleId[] {
  if (key === 'power') return ['solar', 'battery', 'reactor'];
  if (key === 'crew') return ['habitat', 'oxygen', 'food', 'water'];
  if (key === 'bots') return ['roboticsBay'];
  if (key === 'data') return ['lab'];
  return RULE_ORDER.filter((id) => RULES[id].res === key && id !== 'replace');
}

/** a building's current Builder tag line for the inspector */
export function autoTagLine(b: BuildingState): string {
  const t = b.auto;
  if (!t) return '';
  const when = fmtClock(t.at);
  const who = t.by === 'rule' && t.rule
    ? (t.rule === 'replace' ? 'Maintenance' : `${FAMILY_LABEL[RULES[t.rule].family]} rule`)
    : `your order #${t.order ?? '?'}`;
  return `AUTO · ${who} · ${when} — ${t.why}`;
}

// ─────────────────────────── hazards (docs/14 §3.5, §3.10) ───────────────────────────

/** RUNAWAY RULE: the hijacked rule's next junk site — its own building, at
 *  its own kind of ground, ignoring its cap and the rule reserve, never the
 *  weld debt, the Governor's floors (Budget Governor) or life-support stock.
 *  null when the stock is not there (the drift orders nothing it cannot pay). */
export function runawaySite(s: GameState, mods: Mods, site: SiteDef, rule: AutoRuleId, hazard: number): AutoRequest | null {
  const type = ruleBuilding(s, mods, rule);
  if (!type || !mods.unlocked.has(type)) return null;
  if (budgetShort(s, mods, site, type, { by: 'rule', bypassReserve: true })) return null;
  const d = RULES[rule];
  return {
    kind: 'place', type, by: 'rule', rule, intent: { res: d.res, rule }, why: 'RULE DRIFT — a hijacked cap',
    bypass: { cap: true, reserve: true }, junk: hazard,
  };
}

/** The post-incident audit, the machines' grief: after a loss the Builder's
 *  rules pause 120 s, and the rules that build the lost building's type are
 *  vetoed for a lunar day (as a cancelled site is, docs/13 §3.2). */
export function postIncidentAudit(s: GameState, mods: Mods, type?: BuildingId) {
  const now = s.simTime;
  s.auto.frozenUntil = Math.max(s.auto.frozenUntil, now + 120);
  if (!type) return;
  for (const id of RULE_ORDER) {
    const r = s.auto.rules[id];
    if (!r || !r.on || ruleBuilding(s, mods, id) !== type) continue;
    r.nextAt = Math.max(r.nextAt, now + AUTO.vetoS);
    r.dwell = 0;
    r.phase = 'vetoed';
    r.why = `post-incident audit: ${name(type)} lost`;
  }
  logAuto(s, `post-incident audit: rules paused 2:00${type ? `, ${name(type)} vetoed a lunar day` : ''}`);
}
