/** Space weather (docs/16-space-weather.md), economy step 8: `weatherTick`.
 *
 *  - The solar cycle over game time, seeded; classes C, M and X drawn at each
 *    telegraph under the era floors and the drill rules (§3); the class shows
 *    as a range until the X-ray peak, 20 s in.
 *  - The phases: telegraph (the flash, the pop-up) → active (the protons) →
 *    after an X a 120 s proton-storm tail → idle. CMEs after every X and one M
 *    in three. The spot-group watch half a day before an X.
 *  - The arrays (§4.3, §5): one choice per flare — keep all running, stow
 *    all, a share, or all but the critical feed — made by a field override,
 *    the player's click, the remembered choice, the Builder's flareStance or
 *    the safe default, in that order; executed for every array 10 s before
 *    the protons (the wing turns in 10 s). Running arrays are destroyed (a
 *    seeded draw weighted by exposure) or scarred; stowed ones take
 *    repairable damage that a rover repairs, field by field.
 *  - The legacy mode (`s.weather.legacy`): today's flare, for the probe.
 *
 *  Pure and deterministic: every draw is mulberry32((seed ^ K) + index). */
import { BUILDINGS } from '../data/buildings';
import { CYCLE_S, DEPOSIT_FX } from '../data/balance';
import {
  CLASS_RANK, LEGACY_FLARE, PORTIONS, SPACE_WEATHER as W, worse,
  type ArrayChoice, type FlareClass, type FlareDecider,
} from '../data/spaceWeather';
import type { SiteDef } from '../data/sites';
import {
  defaultFlare, defaultWeather, type BuildingState, type FlareLogEntry, type FlareState, type GameState, type WeatherState,
} from './state';
import type { Mods } from './mods';
import { alertIn, condition } from './economy';
import { fmtClock, type DayInfo } from './daynight';
import { mulberry32 } from './rng';
import { wreckBuilding } from './hazards';
import { budgetShort, buildCostAt, ruleState } from './automation';
import {
  drawMachines, effectsTick, effectsView, migrateScars, onActiveStart, onFlareEnd, replaceDone, resolveScars, type EffectsView,
} from './flareEffects';
import { applyAhead, flareDataMult, forecastDusk, forecastTick, type ForecastView } from './forecast';
import {
  copySched, isDriver, moonCatchUp, moonCtx, moonOf, schedActive, schedCme, schedDue, schedEnd, schedStart, schedTail, schedWatch,
  weatherSeed, type MoonState, type SchedCtx, type SchedFields,
} from './moon';

/** every alert here belongs to one notification family (docs/19 S7) */
const alert = alertIn('weather');

const isSite = (b: { construction?: number }) => (b.construction ?? 0) > 0;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Tests: stand-ins for protection the later phases bring (F4): Rad-Hard Cells' ×0.4 on array damage,
 *  and a σ for every structure (berms, water walls) that the rad scars and the §4 multipliers read. */
export const WEATHER_STUB = { arrayHard: 1, sigma: 0 };

// ─────────────────────────── the cycle (§3.4) ───────────────────────────

/** The cycle's peak (lunar days) and strength for cycle k (0: the first, drawn once). */
export function cycleOf(seed: number, k = 0): { tMax: number; aMax: number } {
  const r = mulberry32((seed ^ W.keys.cycle) + k);
  const tMax = W.cycle.tMax + (r() - 0.5) * 2 * W.cycle.tMaxShift;
  const aMax = W.cycle.aMaxLo + (W.cycle.aMaxHi - W.cycle.aMaxLo) * r();
  return { tMax, aMax };
}

/** The activity a (0.1 … ~1) at T lunar days since landing. */
export function activity(seed: number, T: number): number {
  const C = W.cycle;
  const k = Math.max(0, Math.floor(T / C.periodDays));
  const t = T - k * C.periodDays;
  const { tMax, aMax } = cycleOf(seed, k);
  const x = t <= tMax ? Math.sin((Math.PI / 2) * (t / tMax)) ** 2
    : Math.cos((Math.PI / 2) * Math.min(1, (t - tMax) / C.fallDays)) ** 2;
  return C.aMin + (aMax - C.aMin) * x;
}

export type Band = 'QUIET' | 'ACTIVE' | 'STORMY';
export const bandOf = (a: number): Band => (a >= W.bands.stormy ? 'STORMY' : a >= W.bands.active ? 'ACTIVE' : 'QUIET');
const gaugeOf = (b: Band) => (b === 'STORMY' ? '▮▮▮' : b === 'ACTIVE' ? '▮▮▯' : '▮▯▯');

/** The class odds for an activity and an era (the drill and the rules aside): C · M · X. */
export function classOdds(a: number, era: number, xAllowed = true): { C: number; M: number; X: number } {
  const O = W.odds;
  const X = xAllowed && era >= O.xEra ? O.xPerA2 * a * a : 0;
  const M = era >= O.mEra ? Math.min(1 - X, O.mBase + O.mPerA * a) : 0;
  return { C: 1 - X - M, M, X };
}

/** What the class rules remember between flares (the forecast's look ahead passes its own, core/forecast.ts). */
export interface ClassCtx { seenM: boolean; xCount: number; lastX: number; noXUntil: number }

/** The class of flare n if its telegraph came now, in this era (§3.4's rules). */
export function drawClass(s: { seed: number; flare?: FlareState }, n: number, at: number, era: number, ctx?: ClassCtx): FlareClass {
  const f = s.flare;
  if (n === 0) return 'C'; // rule 1: the first is a C drill
  // the Moon's seed when the base is on one (a bare `{ seed }` is the schedule's own: moon.ts)
  const seed = weatherSeed(s);
  const c: ClassCtx = ctx ?? { seenM: !!f?.seen?.M, xCount: f?.xCount ?? 0, lastX: f?.lastX ?? -1e9, noXUntil: f?.noXUntil ?? 0 };
  const O = W.odds;
  const T = at / CYCLE_S;
  const a = activity(seed, T);
  const lastXDay = c.lastX / CYCLE_S;
  const graced = at < c.noXUntil;
  const u = mulberry32((seed ^ W.keys.cls) + n)();
  const gapOk = T - lastXDay >= O.xGapDays;
  const pX = !graced && era >= O.xEra && gapOk ? O.xPerA2 * a * a : 0;
  const pM = era >= O.mEra ? O.mBase + O.mPerA * a : 0;
  let cls: FlareClass = u < pX ? 'X' : u < pX + pM ? 'M' : 'C';
  // rule 2: the first flare from Era 2 is an M
  if (era >= O.mEra && !c.seenM && cls !== 'X') cls = 'M';
  const xs = c.xCount;
  const { tMax } = cycleOf(seed, 0);
  // rule 4: at least one X, by the maximum
  if (!graced && cls !== 'X' && era >= O.xEra && xs === 0 && T >= tMax - 1) cls = 'X';
  // rule 5: a second X once Era 5 is open and the Sun is busy
  if (!graced && cls !== 'X' && era >= W.secondX.era && xs === 1 && gapOk && a >= W.secondX.minA) cls = 'X';
  return cls;
}

/** The range shown until the X-ray peak: the true class and a neighbour. */
export function rangeOf(seed: number, n: number, cls: FlareClass): [FlareClass, FlareClass] {
  if (cls === 'C') return ['C', 'M'];
  if (cls === 'X') return ['M', 'X'];
  return mulberry32((seed ^ W.keys.forecast) + n * 64 + 63)() < 0.5 ? ['C', 'M'] : ['M', 'X'];
}

/** The telegraph a class gets (the drill's is 60 s longer). */
export const telegraphOf = (cls: FlareClass, drill: boolean) => W.classes[cls].telegraphS + (drill ? W.drillExtraS : 0);

/** Game seconds the next flare's protons arrive (0: none scheduled). The
 *  hazard scheduler keeps its windows clear of it (hazards.ts flareBlocks). */
export function nextActiveAt(s: GameState): number {
  const f = s.flare;
  if (!f.nextAt) return 0;
  if (s.weather?.legacy) return f.nextAt + LEGACY_FLARE.telegraphS;
  const n = f.n ?? 0;
  const cls = f.nextCls === 'X' ? 'X' : 'C';
  return f.nextAt + telegraphOf(cls, n === 0 || (cls === 'X' && (f.xCount ?? 0) === 0));
}

/** The protons are in (the active phase or an X's tail). */
export const flareStorm = (s: GameState) => s.flare.phase === 'active' || s.flare.phase === 'tail';

/** Nothing to do with a flare: quiet, and every wing back tracking the sun (the Builder's power book). */
export const flareQuiet = (s: GameState) => s.flare.phase === 'idle' && !s.buildings.some((b) => (b.stowT ?? 0) > 0);

/** This flare's class as the player can know it now: the worse of the range until the peak. */
export function shownClass(s: GameState): FlareClass | null {
  const f = s.flare;
  if (f.phase === 'idle' || !f.cls) return null;
  if (f.phase === 'telegraph' && f.range && s.simTime < (f.firmAt ?? 0)) return worse(f.range[0], f.range[1]);
  return f.cls;
}

// ─────────────────────────── migration (§14.3) ───────────────────────────

/** flareSchema 0 → 1, steps 1–5 (and 7's defaults, 10's alert). Idempotent. */
export function migrateFlareSchema(s: GameState) {
  if ((s.flareSchema ?? 0) >= 1 && s.weather) return;
  const old = s.flare ?? { phase: 'idle', timer: 0, nextAt: 0 };
  const t = s.simTime;
  const f: FlareState = { ...defaultFlare(), phase: old.phase, timer: old.timer, nextAt: old.nextAt };
  // step 2: the index on the old cadence
  f.n = 1 + Math.floor(Math.max(0, t - LEGACY_FLARE.firstAtDay * CYCLE_S) / 1500);
  // step 3: the first flare has passed if its time has
  f.seen = { C: t > LEGACY_FLARE.firstAtDay * CYCLE_S, M: false, X: false, xReal: false };
  if (!f.seen.C) f.n = 0;
  // step 4: a day's grace for X; the first X after it is the drill
  f.noXUntil = t + W.loadGraceDays * CYCLE_S;
  // step 1: a flare in flight finishes as an M at today's 45 s
  if (old.phase === 'telegraph' || old.phase === 'active') {
    f.cls = 'M';
    f.drill = false;
    f.range = ['M', 'M'];
    f.startedAt = t - (old.phase === 'telegraph' ? LEGACY_FLARE.telegraphS - old.timer : LEGACY_FLARE.telegraphS);
    f.firmAt = t;
    f.activeAt = old.phase === 'telegraph' ? t + old.timer : t - (LEGACY_FLARE.activeS - old.timer);
    f.a = activity(s.seed, t / CYCLE_S);
    f.decidedBy = 'default';
    f.choice = { mode: 'feed' };
    f.tally = emptyTally(s, f);
    // an active one was dark in the old save: every array stays stowed to its end
    if (old.phase === 'active') {
      f.exposure = {};
      const ids = (s.buildings ?? []).filter((b) => b.type === 'solar' && !isSite(b)).map((b) => b.id);
      f.plan = { stow: ids, run: [], keep: [], criticalKW: 0, locked: true };
    }
  } else {
    f.phase = 'idle';
    if (!f.nextAt) f.nextAt = 0;
  }
  s.flare = f;
  // step 5: arrays whole, nothing stowed, no wrecks, no overrides; step 7: the defaults
  const dark = new Set(f.plan?.stow ?? []);
  for (const b of s.buildings ?? []) {
    if (b.type !== 'solar') continue;
    delete b.cap; delete b.flareDmg; delete b.wreck; delete b.fieldOverride; delete b.stow; delete b.stowT; delete b.fix;
    if (dark.has(b.id)) { b.stow = true; b.stowT = 1; }
  }
  // step 6: nothing scarred on load (capability 1.0 on every structure, rover, drone and unit)
  migrateScars(s);
  s.weather = { ...defaultWeather(), ...(s.weather ?? {}) };
  const fresh = (s.flareSchema ?? 0) < 1 && t > 120;
  s.flareSchema = 1;
  // step 10
  if (fresh) {
    alert(s, 'SPACE WEATHER — flares now come as C, M and X on a solar cycle · the warning asks what to do with your arrays · open ☉ [O]',
      'info', { panel: 'weather' });
  }
}

// ─────────────────────────── fields (§5.3) ───────────────────────────

export interface FieldInfo {
  /** 1-based: F1, F2 … by the lowest array id in each */
  n: number;
  ids: number[];
  /** the fields' override (the first array's; absent: follow) */
  override?: 'stow' | 'run';
}

const fieldMemo = new WeakMap<BuildingState[], { sig: string; fields: FieldInfo[]; of: Map<number, number> }>();

/** Solar Arrays clustered into fields: arrays whose footprints come within a cell of each other. */
export function fieldsOf(s: GameState): { fields: FieldInfo[]; of: Map<number, number> } {
  const arrays = s.buildings.filter((b) => b.type === 'solar');
  const sig = arrays.map((b) => `${b.id}:${b.gx},${b.gz},${b.rot}`).join(';');
  const hit = fieldMemo.get(s.buildings);
  if (hit && hit.sig === sig) {
    for (const f of hit.fields) f.override = s.buildings.find((b) => b.id === f.ids[0])?.fieldOverride;
    return hit;
  }
  const rect = (b: BuildingState) => {
    const [w, d] = b.rot % 2 === 0 ? BUILDINGS.solar.footprint : [BUILDINGS.solar.footprint[1], BUILDINGS.solar.footprint[0]];
    return [b.gx, b.gz, b.gx + w, b.gz + d];
  };
  const parent = arrays.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < arrays.length; i++) {
    const [ax0, az0, ax1, az1] = rect(arrays[i]);
    for (let j = i + 1; j < arrays.length; j++) {
      const [bx0, bz0, bx1, bz1] = rect(arrays[j]);
      const gx = Math.max(bx0 - ax1, ax0 - bx1), gz = Math.max(bz0 - az1, az0 - bz1);
      if (gx <= 1 && gz <= 1) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, number[]>();
  arrays.forEach((b, i) => { const r = find(i); (groups.get(r) ?? groups.set(r, []).get(r)!).push(b.id); });
  const lists = [...groups.values()].map((ids) => ids.sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
  const fields: FieldInfo[] = lists.map((ids, i) => ({ n: i + 1, ids, override: s.buildings.find((b) => b.id === ids[0])?.fieldOverride }));
  const of = new Map<number, number>();
  for (const f of fields) for (const id of f.ids) of.set(id, f.n);
  const out = { sig, fields, of };
  fieldMemo.set(s.buildings, out);
  return out;
}

// ─────────────────────────── the arrays ───────────────────────────

/** each array's panel output at full sun (kW, after dust and shade), from economy step 1 */
const panelMemo = new WeakMap<GameState, Map<number, number>>();
export function notePanel(s: GameState, id: number, kw: number) {
  (panelMemo.get(s) ?? panelMemo.set(s, new Map()).get(s)!).set(id, kw);
}

/** What an array makes of its panel: 0 wrecked; × its stow, capability and damage. */
export function solarMult(b: BuildingState): number {
  if (b.wreck) return 0;
  return (1 - (b.stowT ?? 0)) * (b.cap ?? 1) * (1 - (b.flareDmg ?? 0));
}

/** An array that is up: built, not a wreck, not under repair. */
const upArray = (b: BuildingState) => b.type === 'solar' && !isSite(b) && !b.wreck;

/** The array's output now if it runs (kW): its panel × the sun × capability × damage. */
function outputNow(s: GameState, b: BuildingState, day: DayInfo): number {
  const panel = panelMemo.get(s)?.get(b.id) ?? 10;
  return panel * day.sunFactor * (b.cap ?? 1) * (1 - (b.flareDmg ?? 0));
}

/** the power beam through a flare */
export function beamMult(s: GameState): number {
  const f = s.flare;
  if (s.weather?.legacy) return f.phase === 'active' ? 0 : 1;
  if (f.phase === 'tail') return W.beam.tail;
  if (f.phase === 'active' && f.cls) return W.beam[f.cls];
  return 1;
}

/** The morale target a flare adds (§4.10): by class, ×(1 − σ of the homes); storm shelters halve it; none in the tube. */
export function flareMoraleTarget(s: GameState, site: SiteDef, mods: Mods): number {
  const f = s.flare;
  if (s.weather?.legacy) return f.phase === 'active' && !site.tubeShelter ? -LEGACY_FLARE.moraleTarget : 0;
  if (site.tubeShelter || !flareStorm(s) || !f.cls) return 0;
  if (f.drill && f.cls === 'C') return 0;
  const t = f.phase === 'tail' ? W.morale.tail : W.morale[f.cls].target;
  return -t * (mods.guards.has('stormShelters') ? 0.5 : 1);
}

/** Stowed-array shield (§4.1): field berms with Regolith Shielding (domes: F4). */
const stowSigma = (mods: Mods) => mods.stowShield ?? 0;
/** Array hardening (Rad-Hard Cells ×0.4, F4; a test stand-in until then). */
const arrayHard = (mods: Mods) => (mods.arrayHardMult ?? 1) * WEATHER_STUB.arrayHard;

/** Repair parts for a stowed array's damage: 1⚙ per 10%, rounded, halves up (none under 5%). */
export const repairParts = (pct: number) => Math.floor(pct / W.repair.pctPerPart + 0.5);
/** Rover seconds for it: 6 s + 0.2 s per %. */
export const repairSeconds = (pct: number) => W.repair.baseS + W.repair.perPctS * pct;

export interface ArrayPlan {
  stow: number[]; run: number[]; keep: number[];
  /** the kW priority 0–1 loads need from the arrays through the flare (× the margin) */
  criticalKW: number;
  runKW: number; stowKW: number;
  /** a share asked for more than it got: the keep set held back this many */
  keptForFeed: number;
  /** the sun is down: every array self-stows for the night */
  night: boolean;
}

/** The seconds the arrays stay stowed for a class: the active phase, the tail and the motion. */
export const flareSeconds = (cls: FlareClass) => W.classes[cls].activeS + W.classes[cls].tailS + W.stowS;

interface PlanCtx { s: GameState; mods: Mods; day: DayInfo; margin: number; left: number }

/** The critical feed (§5.3): max(0, priority 0–1 demand − other supply − bank ÷ the flare's seconds) × the margin. */
export function criticalKW(s: GameState, margin: number, left: number): number {
  const p = s.power;
  const other = Math.max(0, p.supply - (p.solar ?? 0));
  return Math.max(0, (p.crit ?? 0) - other - s.powerStored / Math.max(1, left)) * margin;
}

/** The arrays' plan for a choice (§5.3): which stow, which run, the keep set. */
function planFor(c: PlanCtx, choice: ArrayChoice): ArrayPlan {
  const { s, day } = c;
  const night = day.sunFactor <= 0.01;
  const { fields, of } = fieldsOf(s);
  const arrays = s.buildings.filter(upArray);
  const out: ArrayPlan = { stow: [], run: [], keep: [], criticalKW: 0, runKW: 0, stowKW: 0, keptForFeed: 0, night };
  const kw = new Map(arrays.map((b) => [b.id, outputNow(s, b, day)]));
  const choosers: BuildingState[] = [];
  for (const b of arrays) {
    const f = fields[(of.get(b.id) ?? 1) - 1];
    if (!b.enabled || f?.override === 'stow') out.stow.push(b.id);
    else if (f?.override === 'run') out.run.push(b.id);
    else choosers.push(b);
  }
  // the keep set: the fewest, strongest choosers that carry the critical kW
  const crit = night ? 0 : criticalKW(s, c.margin, c.left);
  out.criticalKW = crit;
  const overrideRun = out.run.reduce((n, id) => n + (kw.get(id) ?? 0), 0);
  const keep = new Set<number>();
  let carried = overrideRun;
  for (const b of [...choosers].sort((x, y) => (kw.get(y.id)! - kw.get(x.id)!) || x.id - y.id)) {
    if (carried >= crit - 1e-9) break;
    if ((kw.get(b.id) ?? 0) <= 1e-9) break;
    keep.add(b.id);
    carried += kw.get(b.id)!;
  }
  out.keep = [...keep];
  // the stow order: whole fields first, weakest per array first, then by field; the last field split, weakest first
  const byField = new Map<number, BuildingState[]>();
  for (const b of choosers) { const n = of.get(b.id) ?? 0; (byField.get(n) ?? byField.set(n, []).get(n)!).push(b); }
  const mean = (list: BuildingState[]) => list.reduce((n, b) => n + kw.get(b.id)!, 0) / list.length;
  const order = [...byField.entries()].sort((a, b) => mean(a[1]) - mean(b[1]) || a[0] - b[0])
    .flatMap(([, list]) => [...list].sort((x, y) => kw.get(x.id)! - kw.get(y.id)! || x.id - y.id));
  let want = 0;
  if (choice.mode === 'stow') want = order.length;
  else if (choice.mode === 'portion') want = Math.ceil(Math.max(0, Math.min(1, choice.p ?? 0)) * order.length - 1e-9);
  else if (choice.mode === 'feed') want = order.length;
  const stow = new Set<number>();
  for (const b of order) {
    if (stow.size >= want) break;
    if (keep.has(b.id) && choice.mode !== 'stow') continue;
    stow.add(b.id);
  }
  if (choice.mode === 'portion') out.keptForFeed = Math.max(0, Math.min(want, order.length) - stow.size);
  for (const b of choosers) (stow.has(b.id) ? out.stow : out.run).push(b.id);
  for (const id of out.run) out.runKW += kw.get(id) ?? 0;
  for (const id of out.stow) out.stowKW += kw.get(id) ?? 0;
  return out;
}

// ─────────────────────────── previews (§5.2) ───────────────────────────

export interface ChoicePreview {
  key: string;
  choice: ArrayChoice;
  stowN: number; runN: number; stowKW: number; runKW: number;
  /** the expected count the sim will use, rounded */
  destroyed: number;
  scarred: number; scarPct: number;
  damaged: number; dmgPct: number; repairParts: number; repairS: number;
  rebuild: number;
  keptForFeed: number;
  /** seconds until a priority 0–1 load goes dark (null: the bank covers it) */
  darkAt: number | null;
  darkName: string;
  /** 'F1, F2, F4 and 3 of F3' */
  stowsText: string; runsText: string;
  /** its preview line */
  line: string;
}

/** 'F1, F2 and 3 of F3' for a set of array ids */
function fieldsText(s: GameState, ids: readonly number[]): string {
  const { fields } = fieldsOf(s);
  const set = new Set(ids);
  const parts: string[] = [];
  for (const f of fields) {
    const n = f.ids.filter((id) => set.has(id)).length;
    if (!n) continue;
    parts.push(n === f.ids.length ? `F${f.n}` : `${n} of F${f.n}`);
  }
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

const kwTxt = (v: number) => `${Math.round(v)} kW`;

/** A choice's outcome for class `cls` (exact: the sim uses the same expected count). */
export function previewChoice(s: GameState, mods: Mods, site: SiteDef, day: DayInfo, choice: ArrayChoice, cls: FlareClass, key = ''): ChoicePreview {
  const f = s.flare;
  const margin = feedMargin(s, mods);
  const left = flareSeconds(cls);
  const plan = planFor({ s, mods, day, margin, left }, choice);
  const drillX = cls === 'X' && (f.phase === 'idle' ? (f.xCount ?? 0) === 0 : !!f.drill);
  const K: FlareClass = drillX ? 'M' : cls;
  const hard = arrayHard(mods);
  const tail = cls === 'X';
  const runIds = plan.night ? [] : plan.run;
  const stowIds = plan.night ? [...plan.run, ...plan.stow] : plan.stow;
  const destroyed = Math.round(runIds.length * W.arrays.destroy[K] * hard + 1e-9);
  const scar = (W.arrays.scar[K] + (tail ? W.arrays.scar.tail : 0)) * hard;
  const dmg = Math.min(W.arrays.dmgMax, (W.arrays.stowed[cls] + (tail ? W.arrays.stowed.tail : 0)) * (1 - stowSigma(mods)) * hard);
  const pct = Math.round(dmg * 100);
  const byId = new Map(s.buildings.map((b) => [b.id, b]));
  let parts = 0, secs = 0, damaged = 0;
  if (pct > 0) {
    for (const id of stowIds) {
      const b = byId.get(id);
      const total = Math.min(W.arrays.dmgMax, (b?.flareDmg ?? 0) + dmg);
      const p = Math.round(total * 100);
      damaged++;
      parts += repairParts(p);
      secs += repairSeconds(p);
    }
  }
  // the bank: priority 0–1 loads against the other supply and what keeps running
  const pw = s.power;
  const other = Math.max(0, pw.supply - (pw.solar ?? 0));
  const short = (pw.crit ?? 0) - other - plan.runKW;
  const runway = short > 0.01 ? s.powerStored / short : Infinity;
  const darkAt = runway < left ? runway : null;
  const home = s.buildings.find((b) => (b.type === 'habitat' || b.type === 'gardenDome') && !isSite(b) && b.enabled);
  const darkName = home ? `${BUILDINGS[home.type].name} #${home.id}` : 'life support';
  const rebuildEach = buildCostAt('solar', site).metals ?? 15;
  const p: ChoicePreview = {
    key, choice, stowN: stowIds.length, runN: runIds.length, stowKW: plan.stowKW, runKW: plan.runKW,
    destroyed, scarred: Math.max(0, runIds.length - destroyed), scarPct: scar * 100,
    damaged, dmgPct: pct, repairParts: parts, repairS: secs, rebuild: destroyed * rebuildEach,
    keptForFeed: plan.keptForFeed, darkAt, darkName,
    stowsText: fieldsText(s, stowIds), runsText: fieldsText(s, runIds), line: '',
  };
  p.line = previewLine(p, cls, left);
  return p;
}

function previewLine(p: ChoicePreview, cls: FlareClass, left: number): string {
  const bits: string[] = [];
  if (p.runN > 0) {
    bits.push(p.stowN ? `runs ${p.runsText} (${p.runN}, ${kwTxt(p.runKW)})` : 'full power');
    if (p.destroyed) bits.push(`an ${cls}: **${p.destroyed} destroyed** (${p.rebuild}◆)`);
    if (p.scarred) bits.push(`${p.scarred} scarred −${p.scarPct.toFixed(p.scarPct < 1 ? 1 : 1).replace(/\.0$/, '')}%`);
  }
  if (p.stowN > 0) {
    bits.unshift(p.runN ? `stows ${p.stowsText} (${p.stowN})` : `−${kwTxt(p.stowKW)} for ${fmtClock(left)}`);
    if (p.damaged) bits.push(`−${p.dmgPct}% on ${p.damaged === 1 ? 'one' : p.runN ? p.damaged : `all ${p.damaged}`}, repaired for ${p.repairParts}⚙`);
    else bits.push('no damage');
  }
  if (p.keptForFeed) bits.push(`${p.keptForFeed} kept running for life support`);
  if (p.darkAt !== null) bits.push(`⚠ ${p.darkName} dark at ${fmtClock(p.darkAt)}`);
  return bits.join(' · ');
}

/** The Builder's margin (flareStance's threshold) or the default. */
export function feedMargin(s: GameState, mods: Mods): number {
  const r = s.auto?.rules?.flareStance;
  return mods.autoFamilies.has('power') && r?.on ? r.threshold : W.feedMargin;
}

// ─────────────────────────── the choice (§5.4) ───────────────────────────

/** The Builder's stance for a class (§5.5): run through C, all but the critical feed at M and X. */
export const stanceChoice = (cls: FlareClass): ArrayChoice => (cls === 'C' ? { mode: 'run' } : { mode: 'feed' });

/** flareStance is deciding (Automated Power, the rule on). */
export function builderDecides(s: GameState, mods: Mods): boolean {
  return mods.autoFamilies.has('power') && !!s.auto?.rules?.flareStance?.on;
}

/** Who decides this flare's arrays now, and what (a click stands). The
 *  shortcuts read the flare's own class: the plan locks after the X-ray peak,
 *  so a range never decides; only the previews show its worse class. */
export function resolveChoice(s: GameState, mods: Mods): { choice: ArrayChoice; by: FlareDecider } {
  const f = s.flare;
  if (f.decidedBy === 'click' && f.choice) return { choice: f.choice, by: 'click' };
  const cls = f.cls ?? 'C';
  const mem = s.weather?.remember?.[cls];
  if (mem) return { choice: mem, by: 'remembered' };
  if (builderDecides(s, mods)) return { choice: stanceChoice(cls), by: 'builder' };
  return { choice: { mode: 'feed' }, by: 'default' };
}

export function choiceText(c: ArrayChoice): string {
  switch (c.mode) {
    case 'run': return 'keep all running';
    case 'stow': return 'stow all';
    case 'feed': return 'stow all but the critical feed';
    default: return `stow ${Math.round((c.p ?? 0) * 100)}%`;
  }
}
const choiceKey = (c: ArrayChoice) => (c.mode === 'portion' ? `p${Math.round((c.p ?? 0) * 100)}` : c.mode);

// ─────────────────────────── actions ───────────────────────────

export interface WeatherResult { ok: boolean; reason: string }
const OK: WeatherResult = { ok: true, reason: '' };
const no = (reason: string): WeatherResult => ({ ok: false, reason });

/** The pop-up's Confirm (§5.2): the choice for every array, and its two checkboxes. */
export function confirmChoice(s: GameState, choice: ArrayChoice, o: { repair?: boolean; remember?: boolean } = {}): WeatherResult {
  const f = s.flare;
  const w = weatherOf(s);
  if (o.repair !== undefined) w.autoRepair = o.repair;
  if (f.phase !== 'telegraph' || !f.cls) {
    // ahead of a flare: only a standing choice can be set
    return no('NO FLARE TO ANSWER — the choice waits for the next telegraph');
  }
  if (f.plan?.locked) return no('TOO LATE TO CHANGE — the arrays are moving: 10 s to the protons');
  const clean: ArrayChoice = choice.mode === 'portion' ? { mode: 'portion', p: Math.max(0, Math.min(1, choice.p ?? 0)) } : { mode: choice.mode };
  f.choice = clean;
  f.decidedBy = 'click';
  const cls = shownClass(s) ?? f.cls;
  w.answered[cls] = true;
  w.answered[f.cls] = true;
  if (o.remember) w.remember[cls] = clean;
  return OK;
}

/** The PROTOCOLS block: set or clear a class's remembered choice. */
export function setRemembered(s: GameState, cls: FlareClass, choice: ArrayChoice | null): WeatherResult {
  const w = weatherOf(s);
  if (choice) w.remember[cls] = choice; else delete w.remember[cls];
  return OK;
}

/** A field's override (the inspector): follow · always stow · always run. */
export function setFieldOverride(s: GameState, id: number, mode: 'follow' | 'stow' | 'run'): WeatherResult {
  const { fields, of } = fieldsOf(s);
  const f = fields[(of.get(id) ?? 0) - 1];
  if (!f) return no('NOT AN ARRAY FIELD');
  for (const aid of f.ids) {
    const b = s.buildings.find((x) => x.id === aid);
    if (!b) continue;
    if (mode === 'follow') delete b.fieldOverride; else b.fieldOverride = mode;
  }
  f.override = mode === 'follow' ? undefined : mode;
  return OK;
}

function weatherOf(s: GameState): WeatherState {
  return (s.weather ??= defaultWeather());
}

const label = (b: BuildingState) => `${BUILDINGS[b.type].name} #${b.id}`;

/** Rebuild a wreck (§4.3): its full build cost; the build plus 10 s to clear it, a rover's weld. */
export function rebuildWreck(s: GameState, mods: Mods, site: SiteDef, id: number): WeatherResult {
  const b = s.buildings.find((x) => x.id === id);
  if (!b?.wreck) return no('NOT A WRECK');
  if (b.wreck.job) return no(`ALREADY ${b.wreck.job === 'rebuild' ? 'REBUILDING' : 'CLEARING'} — ${label(b)}`);
  const cost = buildCostAt('solar', site);
  for (const [r, amt] of Object.entries(cost)) {
    if ((s.resources[r as keyof typeof s.resources] ?? 0) < (amt ?? 0)) return no(`REBUILD NEEDS ${amt}◆ — have ${Math.floor(s.resources.metals)}`);
  }
  for (const [r, amt] of Object.entries(cost)) s.resources[r as keyof typeof s.resources] -= amt ?? 0;
  const ridge = b.deposit === 'ridge' ? DEPOSIT_FX.ridgeSolarBuildTime : 1;
  const t = Math.round(BUILDINGS.solar.buildTime * site.buildCostMult * mods.buildSpeedMult * mods.buildTimeMult.solar * ridge) + W.wreck.clearWreckS;
  b.wreck.job = 'rebuild';
  b.construction = t;
  b.buildTotal = t;
  b.buildSeq = s.nextBuildingId;
  b.idleReason = 'queued';
  return OK;
}

/** Clear a wreck (§4.3): 15 s of a rover; 25% of its cost back as salvage. */
export function clearWreck(s: GameState, id: number): WeatherResult {
  const b = s.buildings.find((x) => x.id === id);
  if (!b?.wreck) return no('NOT A WRECK');
  if (b.wreck.job) return no(`ALREADY ${b.wreck.job === 'rebuild' ? 'REBUILDING' : 'CLEARING'} — ${label(b)}`);
  b.wreck.job = 'clear';
  b.construction = W.wreck.clearS;
  b.buildTotal = W.wreck.clearS;
  b.buildSeq = s.nextBuildingId;
  b.idleReason = 'queued';
  return OK;
}

/** Every wreck at once (the alert, the panel): rebuild what can be paid, or clear. */
export function allWrecks(s: GameState, mods: Mods, site: SiteDef, how: 'rebuild' | 'clear'): WeatherResult {
  const list = s.buildings.filter((b) => b.wreck && !b.wreck.job);
  if (!list.length) return no('NO WRECKS');
  let done = 0, why = '';
  for (const b of list) {
    const r = how === 'rebuild' ? rebuildWreck(s, mods, site, b.id) : clearWreck(s, b.id);
    if (r.ok) done++; else why = r.reason;
  }
  return done ? OK : no(why);
}

/** Queue repairs (§4.3): one job per field, each damaged array in turn. `ids`: these arrays' fields only. */
export function queueRepairs(s: GameState, ids?: number[]): WeatherResult {
  const w = weatherOf(s);
  const { fields, of } = fieldsOf(s);
  const want = ids ? new Set(ids.map((id) => of.get(id) ?? 0)) : null;
  const queued = new Set(w.repairs.flat());
  let added = 0;
  for (const f of fields) {
    if (want && !want.has(f.n)) continue;
    const todo = f.ids.filter((id) => {
      const b = s.buildings.find((x) => x.id === id);
      return b && (b.flareDmg ?? 0) > 1e-6 && !b.wreck && !queued.has(id);
    });
    if (!todo.length) continue;
    const job = w.repairs.find((q) => q.some((id) => of.get(id) === f.n));
    if (job) job.push(...todo); else w.repairs.push(todo);
    added += todo.length;
  }
  return added ? OK : no('NOTHING TO REPAIR — no stowed array is damaged');
}

/** Each field's job: its head array becomes a repair site behind every build (economy step 2.5 works it). */
function repairTick(s: GameState, mods: Mods) {
  const w = weatherOf(s);
  const { of } = fieldsOf(s);
  const byId = new Map(s.buildings.map((b) => [b.id, b]));
  w.repairs = w.repairs.map((q) => q.filter((id) => {
    const b = byId.get(id);
    return !!b && !b.wreck && ((b.flareDmg ?? 0) > 1e-6 || !!b.fix);
  }));
  for (const q of w.repairs) {
    const b = byId.get(q[0]);
    if (!b || b.fix || isSite(b)) continue;
    const pct = Math.max(1, Math.round((b.flareDmg ?? 0) * 100));
    b.fix = { pct, parts: repairParts(pct) };
    const t = Math.round(repairSeconds(pct) / Math.max(0.05, mods.buildSpeedMult));
    b.construction = t;
    b.buildTotal = t;
    b.buildSeq = W.repair.queueAt + b.id;
    b.idleReason = 'queued';
  }
  const done = w.repairs.filter((q) => q.length === 0).length;
  w.repairs = w.repairs.filter((q) => q.length > 0);
  if (done && !w.repairs.length) alert(s, 'REPAIRED — every stowed array is back to full', 'info', { panel: 'weather' });
  void of;
}

/** Economy step 2.5, as a repair, rebuild or clear site finishes. True: handled here (not a build). */
export function siteDone(s: GameState, b: BuildingState): boolean {
  // a Replace (or an excavator's Re-print, docs/16 §4.14): new, capability 100%
  if (replaceDone(s, b)) return true;
  if (b.fix) {
    delete b.fix;
    b.flareDmg = 0;
    delete b.buildSeq;
    return true;
  }
  if (b.wreck?.job === 'rebuild') {
    delete b.wreck;
    b.cap = 1;
    b.flareDmg = 0;
    b.wear = 0;
    b.dust = 0;
    delete b.buildSeq;
    alert(s, `REBUILT — ${label(b)} is back on the grid`, 'info', { select: b.id });
    return true;
  }
  if (b.wreck?.job === 'clear') {
    b.wreck.cleared = true;
    return true;
  }
  return false;
}

/** Economy step 2.5: a repair pays its parts before its rover starts (none under 5%). '' = go. */
export function siteParts(s: GameState, b: BuildingState): 'none' | 'paid' | 'short' {
  if (!b.fix) return b.wreck?.job === 'clear' ? 'none' : 'paid';
  if (b.fix.paid || b.fix.parts <= 0) { b.fix.paid = true; return 'none'; }
  if (s.resources.parts < b.fix.parts) return 'short';
  s.resources.parts -= b.fix.parts;
  b.fix.paid = true;
  return 'none';
}

// ─────────────────────────── step 8 ───────────────────────────

export interface WeatherTickResult { removed: number[] }

const emptyTally = (s: GameState, f: FlareState): FlareLogEntry => ({
  n: f.n ?? 0, cls: f.cls ?? 'C', drill: !!f.drill, at: f.startedAt ?? s.simTime, era: s.era,
  decidedBy: f.decidedBy ?? 'default', choice: f.choice ? choiceText(f.choice) : '',
  stowed: 0, running: 0, destroyed: 0, scarred: 0, scar: 0, damaged: 0, repairParts: 0, repairS: 0, solarLost: 0, data: 0,
});

/** The schedule's inputs for a solo game: its own seed, era, clock, forecast lead and tier. */
const soloCtx = (s: GameState): SchedCtx => ({
  seed: s.seed, era: s.era, now: s.simTime, lead: s.weather?.lead ?? 0, tier: s.weather?.tier ?? 0,
});

/** The first of its class, for the FIRST FLARE card: on the schedule in a solo game, and in a faction's game the
 *  first this BASE has met (a base that lands after the Moon's first flares still gets its card). */
function firstForBase(s: GameState, cls: FlareClass, onSchedule: boolean): boolean {
  if (!s.faction) return onSchedule;
  const w = weatherOf(s);
  const seen = (w.intro ??= {});
  const first = !seen[cls];
  seen[cls] = true;
  return first;
}

/** What a base does at a flare's telegraph, its own half of `startFlare`: a fresh choice and exposure, its tally,
 *  the choice made ahead, the first-of-its-class card. */
function startLocal(s: GameState, cls: FlareClass, first: boolean) {
  const f = s.flare;
  delete f.choice;
  delete f.decidedBy;
  delete f.plan;
  f.exposure = {};
  f.tally = emptyTally(s, f);
  applyAhead(s); // 'Arrays: choose now…' answers this telegraph (core/forecast.ts)
  if (first && !s.weather?.legacy) {
    const intro: Record<FlareClass, string> = {
      C: 'FIRST FLARE — a C-class drill: the warning asks what to do with your arrays · stowed arrays make nothing, running ones take the protons',
      M: 'FIRST M-CLASS FLARE — running arrays can be destroyed (15%); stowed ones take repairable damage · the pop-up decides',
      X: 'FIRST X-CLASS FLARE — a drill in its permanent parts: running arrays lose an M’s share, not half · stow before the protons',
    };
    alert(s, intro[cls], cls === 'C' ? 'info' : 'warn', { panel: 'weather' });
  }
}

/** Start a flare's telegraph now (a forced DOSE, debug.forceFlare; the schedule itself starts it in `weatherTick`).
 *  `flashAt`: the flash the schedule set; a forecast's lead starts the telegraph that much
 *  before it (docs/16 §6.1). Unset: the flash comes after the base's lead, from now.
 *  On a Moon the flare is the Moon's: every base on it sees it begin. */
export function startFlare(s: GameState, site: SiteDef, cls: FlareClass, o: { drill?: boolean; flashAt?: number } = {}) {
  const moon = moonOf(s);
  if (moon) {
    moonCatchUp(moon, s.simTime);
    const first = schedStart(moon.weather, { ...moonCtx(moon, s.simTime), lead: s.weather?.lead ?? 0, tier: s.weather?.tier ?? 0 }, cls, o);
    moon.weather.first = first;
    syncFlare(s, moon);
    startLocal(s, cls, firstForBase(s, cls, first));
    return;
  }
  startLocal(s, cls, schedStart(s.flare, soloCtx(s), cls, o));
  void site;
}

/** Mirror the Moon's flare schedule into this base's `s.flare` (phase, timer, index, class, drill, range, flash, firm
 *  and proton times, the counters, the watch, the CME), so hazards, the forecast and the HUD read it as they always
 *  did. Everything the base does about a flare (choice, plan, exposure, tally, log) is its own and is not touched. */
export function syncFlare(s: GameState, moon: MoonState) {
  copySched(s.flare, moon.weather);
}

/** Economy step 8. */
export function weatherTick(s: GameState, site: SiteDef, mods: Mods, day: DayInfo, dt: number): WeatherTickResult {
  const out: WeatherTickResult = { removed: [] };
  if ((s.flareSchema ?? 0) < 1 || !s.weather) migrateFlareSchema(s);
  const f = s.flare;
  const w = s.weather!;
  // cleared wrecks leave (their salvage paid)
  for (const b of [...s.buildings]) {
    if (!b.wreck?.cleared) continue;
    const cost = buildCostAt('solar', site);
    const back = Math.floor((cost.metals ?? 0) * W.wreck.salvage);
    s.resources.metals += back;
    wreckBuilding(s, b.id, out.removed);
    alert(s, `WRECK CLEARED — ${label(b)} salvaged for +${back}◆; its pad is free`, 'info');
  }
  if (w.legacy) { legacyTick(s, site, day, dt); return out; }
  const moon = moonOf(s);
  if (!moon && f.nextAt === 0) f.nextAt = W.firstAtDay * CYCLE_S;
  const now = s.simTime;
  forecastTick(s, site, mods, day, dt); // the tier, its lead, the window (docs/16 §6)

  if (moon) moonPhases(s, site, mods, day, dt, moon);
  else switch (f.phase) {
    case 'idle': {
      const c = soloCtx(s);
      // the spot-group watch: half a day ahead, the next flare's class is looked at; an X is locked in
      if (schedWatch(f, c)) {
        alert(s, 'BIG SPOT GROUP ON THE DISC — an X-class flare is possible within ½ day · stow, dock and shield before it', 'warn', { panel: 'weather' });
      }
      // a forecast's lead starts the telegraph early; the flash (and the protons) keep the schedule's time
      const due = schedDue(f, c);
      if (due) startFlare(s, site, due.cls, { flashAt: due.flashAt });
      break;
    }
    case 'telegraph': {
      f.timer -= dt;
      telegraphTick(s, mods, day);
      if (f.timer <= 0) beginActive(s, site, mods, day);
      break;
    }
    case 'active': {
      f.timer -= dt;
      activeTick(s, mods, day, dt);
      if (f.timer <= 0) {
        flashOver(s, site, mods, day);
        if ((f.cls ?? 'C') === 'X') {
          schedTail(f);
          tailStart(s, site, mods);
        } else endFlare(s, mods, site);
      }
      break;
    }
    case 'tail': {
      f.timer -= dt;
      tailTick(s, mods, day, dt);
      if (f.timer <= 0) {
        tailOver(s, site, mods, day);
        endFlare(s, mods, site);
      }
      break;
    }
  }
  void now;
  finishPhases(s, site, mods, day, dt);
  return out;
}

// ── the phase bodies every base runs (a solo game's switch above and a Moon's edges below share them) ──

/** The telegraph: the plan follows the choice until the arrays start to move (10 s before the protons). */
function telegraphTick(s: GameState, mods: Mods, day: DayInfo) {
  const f = s.flare;
  const cls = f.cls ?? 'C';
  const { choice, by } = resolveChoice(s, mods);
  if (!f.plan?.locked) {
    f.choice = choice;
    f.decidedBy = by;
  }
  if (!f.plan?.locked && f.timer <= W.stowS) lockPlan(s, mods, day, cls);
}

/** The protons: the exposure counts, and 'all but the critical feed' holds its feed. */
function activeTick(s: GameState, mods: Mods, day: DayInfo, dt: number) {
  const f = s.flare;
  tallyExposure(s, day, dt);
  if (f.choice?.mode === 'feed') holdFeed(s, mods, day, f.timer + (f.cls === 'X' ? W.classes.X.tailS : 0) + W.stowS);
}

/** The flash is over: the arrays and the scars pay for it. */
function flashOver(s: GameState, site: SiteDef, mods: Mods, day: DayInfo) {
  resolveArrays(s, mods, day, 'flash');
  resolveScars(s, site, mods, 'flash');
}

/** An X's tail begins: a fresh exposure, and the machines draw again, as a C (§4.2). */
function tailStart(s: GameState, site: SiteDef, mods: Mods) {
  s.flare.exposure = {};
  drawMachines(s, site, mods, 'tail');
}

function tailTick(s: GameState, mods: Mods, day: DayInfo, dt: number) {
  const f = s.flare;
  tallyExposure(s, day, dt);
  if (f.choice?.mode === 'feed') holdFeed(s, mods, day, f.timer + W.stowS);
}

function tailOver(s: GameState, site: SiteDef, mods: Mods, day: DayInfo) {
  resolveArrays(s, mods, day, 'tail');
  resolveScars(s, site, mods, 'tail');
}

// ── a base on a Moon: the schedule is the Moon's, the rest of each flare is the base's ──

const NEXT_PHASE = (p: FlareState['phase'], cls: FlareClass): FlareState['phase'] =>
  p === 'idle' ? 'telegraph' : p === 'telegraph' ? 'active' : p === 'active' ? (cls === 'X' ? 'tail' : 'idle') : 'idle';

/** Economy step 8 on a Moon. The Moon's machine has already run this second (whoever reaches a second first
 *  drives it, `moonCatchUp`); this base mirrors its schedule and does its own half at each edge, in the order
 *  the solo switch does: the phase's body, the end's per-base half on the fields as they were, the mirror,
 *  the start's per-base half on the fields as they are. A base that lands mid-flare sits it out. */
function moonPhases(s: GameState, site: SiteDef, mods: Mods, day: DayInfo, dt: number, moon: MoonState) {
  const f = s.flare;
  const w = s.weather!;
  const mw = moon.weather;
  // the player's forecast is the one the shared telegraph follows (the class odds use the player's era)
  if (isDriver(s, moon)) { mw.era = s.era; mw.lead = w.lead ?? 0; mw.tier = w.tier ?? 0; }
  moonCatchUp(moon, s.simTime);
  const prev = f.phase;
  // landed after this flare's telegraph began: it never saw it, and sits it out as if quiet
  if (mw.phase !== 'idle' && prev === 'idle' && (mw.startedAt ?? 0) <= (s.landedAt ?? 0) + 90) {
    syncFlare(s, moon);
    f.phase = 'idle';
    f.timer = 0;
    return;
  }
  const cur = mw.phase;
  // the timer the phase's body sees: the Moon has already counted this second down
  f.timer = cur === prev ? mw.timer : f.timer - dt;
  if (prev === 'telegraph') telegraphTick(s, mods, day);
  else if (prev === 'active') activeTick(s, mods, day, dt);
  else if (prev === 'tail') tailTick(s, mods, day, dt);
  // the edges this base has to cross to reach the Moon's phase (one, unless it missed some seconds)
  const hops: [FlareState['phase'], FlareState['phase']][] = [];
  for (let p = prev; p !== cur && hops.length < 4;) { const nx = NEXT_PHASE(p, mw.cls ?? f.cls ?? 'C'); hops.push([p, nx]); p = nx; }
  // the end of a flare: the arrays and scars pay, and the base writes its log, before the schedule moves on
  for (const [from, to] of hops) {
    if (from === 'active') flashOver(s, site, mods, day);
    else if (from === 'tail') tailOver(s, site, mods, day);
    if (to === 'idle' && from !== 'idle') endFlare(s, mods, site, mw.lastDays ?? 0);
  }
  // the spot-group watch: locked half a day ahead, told once
  const watched = cur === 'idle' && prev === 'idle' && !!mw.watch && !f.watch;
  syncFlare(s, moon);
  if (watched) alert(s, 'BIG SPOT GROUP ON THE DISC — an X-class flare is possible within ½ day · stow, dock and shield before it', 'warn', { panel: 'weather' });
  for (const [from, to] of hops) {
    if (from === 'idle') startLocal(s, f.cls ?? 'C', firstForBase(s, f.cls ?? 'C', !!mw.first));
    else if (to === 'active') activeStart(s, site, mods, day);
    else if (to === 'tail') tailStart(s, site, mods);
  }
}

/** What every tick ends with, flare or not: the wings, repairs, the Builder's stance, the conditions, and §4 beyond
 *  the arrays (core/flareEffects.ts): the machines' draw, the scars' count, reboots, re-flashes, warm-ups. */
function finishPhases(s: GameState, site: SiteDef, mods: Mods, day: DayInfo, dt: number) {
  moveWings(s, dt);
  repairTick(s, mods);
  stanceTick(s, mods, site);
  raiseConditions(s, mods, site, day);
  effectsTick(s, site, mods);
}

/** The wings turn toward their target, 10 s end to end; a shut-down array stows through a flare. */
function moveWings(s: GameState, dt: number) {
  const f = s.flare;
  const flare = f.phase !== 'idle' && !!f.plan?.locked;
  const step = dt / W.stowS;
  for (const b of s.buildings) {
    if (b.type !== 'solar') continue;
    if (b.wreck || isSite(b)) { if (b.stowT) b.stowT = 0; continue; }
    const target = flare && (b.stow || !b.enabled) ? 1 : 0;
    const t = b.stowT ?? 0;
    if (t === target) continue;
    const next = target > t ? Math.min(1, t + step) : Math.max(0, t - step);
    if (next <= 0) delete b.stowT; else b.stowT = next;
  }
}

/** 10 s before the protons: the plan locks and the arrays start to move. */
function lockPlan(s: GameState, mods: Mods, day: DayInfo, cls: FlareClass) {
  const f = s.flare;
  const choice = f.choice ?? { mode: 'feed' };
  const plan = planFor({ s, mods, day, margin: feedMargin(s, mods), left: flareSeconds(cls) }, choice);
  const stow = new Set(plan.stow);
  for (const b of s.buildings) {
    if (b.type !== 'solar') continue;
    if (stow.has(b.id)) b.stow = true; else delete b.stow;
  }
  f.plan = { stow: plan.stow, run: plan.run, keep: plan.keep, criticalKW: plan.criticalKW, locked: true };
  const t = f.tally ?? (f.tally = emptyTally(s, f));
  t.decidedBy = f.decidedBy ?? 'default';
  t.choice = choiceText(choice);
  t.stowed = plan.stow.length;
  t.running = plan.run.length;
  t.night = plan.night;
  if (f.decidedBy === 'default' || f.decidedBy === 'remembered' || f.decidedBy === 'builder') {
    const who = f.decidedBy === 'default' ? 'the safe default' : f.decidedBy === 'builder' ? 'the Builder' : `your ${cls} choice`;
    alert(s, `☉ ${cls} FLARE — ${who}: ${choiceText(choice)} · STOWING ${plan.stow.length}${plan.run.length ? ` · RUNNING ${plan.run.length}, ${kwTxt(plan.runKW)}` : ''}`,
      'info', { panel: 'weather' });
  }
}

/** 'all but the critical feed': as the bank drains the feed can rise — arrays come back to carry it. */
function holdFeed(s: GameState, mods: Mods, day: DayInfo, left: number) {
  const f = s.flare;
  if (!f.plan || Math.floor(s.simTime) % 5 !== 0) return;
  const crit = criticalKW(s, feedMargin(s, mods), left);
  const byId = new Map(s.buildings.map((b) => [b.id, b]));
  let carried = f.plan.run.reduce((n, id) => { const b = byId.get(id); return n + (b && upArray(b) ? outputNow(s, b, day) : 0); }, 0);
  if (carried >= crit - 1e-9) return;
  const stowed = f.plan.stow.map((id) => byId.get(id)).filter((b): b is BuildingState => !!b && upArray(b) && b.enabled && !b.fieldOverride)
    .sort((a, b) => outputNow(s, b, day) - outputNow(s, a, day) || a.id - b.id);
  for (const b of stowed) {
    if (carried >= crit - 1e-9) break;
    const kw = outputNow(s, b, day);
    if (kw <= 1e-9) break;
    delete b.stow;
    f.plan.stow = f.plan.stow.filter((id) => id !== b.id);
    f.plan.run.push(b.id);
    f.plan.keep.push(b.id);
    carried += kw;
  }
}

function tallyExposure(s: GameState, day: DayInfo, dt: number) {
  const f = s.flare;
  const ex = (f.exposure ??= {});
  const night = day.sunFactor <= 0.01;
  const t = f.tally;
  for (const b of s.buildings) {
    if (!upArray(b)) continue;
    const st = night ? 1 : (b.stowT ?? 0);
    const e = ex[b.id] ?? (ex[b.id] = [0, 0]);
    e[0] += (1 - st) * dt;
    e[1] += st * dt;
    if (t) t.solarLost += (panelMemo.get(s)?.get(b.id) ?? 0) * day.sunFactor * st * dt;
  }
}

/** The protons in, a solo game's whole step: the schedule, the base's half, the CME. */
function beginActive(s: GameState, site: SiteDef, mods: Mods, day: DayInfo) {
  const c = soloCtx(s);
  schedActive(s.flare, c);
  activeStart(s, site, mods, day);
  schedCme(s.flare, c);
}

/** The protons in, the base's half: morale, heliophysics data, the insight's count. */
function activeStart(s: GameState, site: SiteDef, mods: Mods, day: DayInfo) {
  const f = s.flare;
  const cls = f.cls ?? 'C';
  f.exposure = {};
  if (!f.plan?.locked) lockPlan(s, mods, day, cls);
  // the arrays still moving at the protons finish now: the last seconds were the motion
  if (!site.tubeShelter && s.crew > 0) {
    const hit = f.drill && cls === 'C' ? W.morale.drillHit : W.morale[cls].hit;
    s.morale = Math.max(0, s.morale - hit * (mods.guards.has('stormShelters') ? 0.5 : 1));
  }
  // a pro: an operating lab reads the particle storm; a Solar Observatory that sees it doubles it (docs/16 §4.2)
  const obsMult = flareDataMult(s, day);
  if (obsMult > 1 || s.buildings.some((b) => b.type === 'lab' && b.active)) {
    const d = W.heliophysics[cls] * obsMult;
    s.data += d;
    if (f.tally) f.tally.data += d;
    alert(s, `HELIOPHYSICS — the ${cls} flare was also an experiment · +${d}≡`, 'info');
  }
  if (!site.tubeShelter && s.buildings.filter((b) => b.active && b.type !== 'lander').length >= 6) s.stats.flaresWithSix += 1;
  // §4 beyond the arrays: the blackout, crew indoors, the head tech, wear, an X's batch (core/flareEffects.ts)
  onActiveStart(s, site, mods);
}

/** The flash or the tail has passed: the arrays pay for it (§4.3). */
function resolveArrays(s: GameState, mods: Mods, day: DayInfo, part: 'flash' | 'tail') {
  const f = s.flare;
  const cls = f.cls ?? 'C';
  const ex = f.exposure ?? {};
  const hard = arrayHard(mods);
  const drillX = cls === 'X' && !!f.drill;
  const K: 'C' | 'M' | 'X' | 'tail' = part === 'tail' ? 'tail' : drillX ? 'M' : cls;
  const pD = W.arrays.destroy[K] * hard;
  const scar = W.arrays.scar[K] * hard;
  const dmg = (part === 'tail' ? W.arrays.stowed.tail : W.arrays.stowed[cls]) * (1 - stowSigma(mods)) * hard;
  const n = f.n ?? 0;
  const arrays = s.buildings.filter((b) => upArray(b) && ex[b.id]);
  const share = (b: BuildingState) => { const [r, st] = ex[b.id]; return r + st > 0 ? r / (r + st) : 0; };
  // which are destroyed: the expected count, rounded, by a seeded draw weighted by exposure
  const expected = arrays.reduce((m, b) => m + share(b) * pD, 0);
  const count = Math.min(arrays.length, Math.round(expected + 1e-9));
  const keyed = arrays.filter((b) => share(b) > 1e-9)
    .map((b) => ({ b, k: Math.pow(mulberry32((s.seed ^ W.keys.arrays) + n * 4096 + b.id)(), 1 / share(b)) }))
    .sort((x, y) => y.k - x.k || x.b.id - y.b.id);
  const gone = new Set(keyed.slice(0, count).map((x) => x.b.id));
  const t = f.tally ?? (f.tally = emptyTally(s, f));
  let scarred = 0, scarSum = 0, damaged = 0;
  for (const b of arrays) {
    const r = share(b);
    if (gone.has(b.id)) {
      b.wreck = { at: s.simTime, n, cls };
      delete b.stow; delete b.stowT; delete b.flareDmg;
      continue;
    }
    if (r > 1e-9 && scar > 0) {
      const cut = scar * r;
      b.cap = Math.max(W.arrays.capFloor, (b.cap ?? 1) * (1 - cut));
      scarred++;
      scarSum += cut;
    }
    const d = dmg * (1 - r);
    if (d > 1e-9) {
      b.flareDmg = Math.min(W.arrays.dmgMax, (b.flareDmg ?? 0) + d);
      damaged++;
    }
  }
  t.destroyed += gone.size;
  if (part === 'flash') { t.scarred = scarred; t.scar = scarred ? scarSum / scarred : 0; }
  else if (scarred) t.scar += scarSum / scarred;
  t.damaged = Math.max(t.damaged, damaged);
  if (gone.size) {
    alert(s, `ARRAYS DESTROYED — ${plural(gone.size, 'Solar Array')} kept running through the ${cls} flare ${gone.size === 1 ? 'is a wreck' : 'are wrecks'} · Rebuild or Clear`,
      'warn', { panel: 'weather' });
  }
  // the first X: what a real one would have cost (§4.11)
  if (drillX && part === 'flash') {
    const real = Math.round(arrays.reduce((m, b) => m + share(b) * W.arrays.destroy.X * hard, 0) + 1e-9);
    const ran = arrays.filter((b) => share(b) > 1e-9).length;
    alert(s, `THIS ONE WAS A DRILL — a real X on this base would have destroyed ${real} of your ${ran} running arrays` +
      `${real ? ` (${gone.size} were)` : ''} · stow, dock, shut down or shield before the next`, 'warn', { panel: 'weather' });
  }
  void day;
}

/** Quiet again: arrays unstow, repairs queue, the log line, the next flare scheduled. `days`: on a Moon the schedule
 *  has moved on already (its interval to the next flare); a solo game's schedule moves here. */
function endFlare(s: GameState, mods: Mods, site: SiteDef, days?: number) {
  const f = s.flare;
  const w = weatherOf(s);
  const cls = f.cls ?? 'C';
  for (const b of s.buildings) if (b.type === 'solar') delete b.stow;
  const damaged = s.buildings.filter((b) => b.type === 'solar' && (b.flareDmg ?? 0) > 1e-6 && !b.wreck);
  const t = f.tally ?? emptyTally(s, f);
  let parts = 0, secs = 0;
  for (const b of damaged) { const p = Math.round((b.flareDmg ?? 0) * 100); parts += repairParts(p); secs += repairSeconds(p); }
  t.repairParts = parts;
  t.repairS = secs;
  const repair = damaged.length > 0 && (w.autoRepair || builderDecides(s, mods));
  if (repair) queueRepairs(s);
  const log = (f.log ??= []);
  log.push(t);
  if (log.length > W.logMax) log.splice(0, log.length - W.logMax);
  // the log line, or the near miss
  const wrecks = s.buildings.filter((b) => b.wreck && !b.wreck.job).length;
  const cost = buildCostAt('solar', site).metals ?? 15;
  const bits: string[] = [];
  if (t.destroyed) bits.push(`${plural(t.destroyed, 'array')} destroyed [Rebuild ${t.destroyed * cost}◆]`);
  if (damaged.length) bits.push(repair ? `${damaged.length} repairs queued (${parts}⚙)` : `${damaged.length} stowed arrays damaged: Repair all (${parts}⚙)`);
  if (t.scarred) bits.push(`${t.scarred} scarred −${(t.scar * 100).toFixed(1)}%`);
  // the machines, research, crew, fabs and scars (core/flareEffects.ts)
  bits.push(...onFlareEnd(s).map((x) => x.replace(/\*\*/g, '')));
  // the next
  if (days === undefined) days = schedEnd(f, soloCtx(s));
  delete f.plan;
  delete f.exposure;
  const text = bits.length ? `☉ ${cls} PASSED — ${bits.join(' · ')} · the next in ~${days.toFixed(1)} lunar days`
    : `☉ ${cls} PASSED — everything was docked, stowed or shielded · the next in ~${days.toFixed(1)} lunar days`;
  alert(s, text, wrecks || (t.lost ?? 0) > 0 ? 'warn' : 'info', { panel: 'weather' });
  delete f.tally;
}

/** The Builder's flareStance (§5.5): its status line; after a flare, wrecks rebuilt within the Governor's floors. */
function stanceTick(s: GameState, mods: Mods, site: SiteDef) {
  if (!s.auto?.rules) return;
  const r = ruleState(s, 'flareStance');
  if (!mods.autoFamilies.has('power')) { r.phase = 'locked'; r.why = 'locked — Automated Power'; return; }
  if (!r.on) { r.phase = 'off'; r.why = 'off'; return; }
  const f = s.flare;
  if (f.phase !== 'idle' && f.cls && f.decidedBy === 'builder') {
    const plan = f.plan;
    r.phase = 'holding';
    r.why = f.cls === 'C' ? 'run all · C: 0.5% scars, no losses'
      : `stow all but ${plan?.run.length ?? 0} · ${f.cls}: running arrays would lose ${Math.round(W.arrays.destroy[f.cls] * 100)}% outright`;
    return;
  }
  r.phase = 'ok';
  r.why = 'ok · STOW M and X but the critical feed; RUN through C';
  if (f.phase !== 'idle') return;
  // wrecks: rebuilt through the budget (its floors hold)
  for (const b of s.buildings) {
    if (!b.wreck || b.wreck.job) continue;
    if (budgetShort(s, mods, site, 'solar', { by: 'rule' })) break;
    if (rebuildWreck(s, mods, site, b.id).ok) r.built += 1;
  }
}

/** The telegraph and active conditions (the pop-up is the UI's; this is the alert line). */
function raiseConditions(s: GameState, mods: Mods, site: SiteDef, day: DayInfo) {
  const f = s.flare;
  const cls = shownClass(s);
  if (f.watch && f.phase === 'idle') {
    condition(s, 'flare-watch', `☉ BIG SPOT GROUP — an X-class flare is possible within ½ day · [O] space weather`, 'warn', { panel: 'weather' });
  }
  if (!cls) return;
  const range = f.phase === 'telegraph' && f.range && s.simTime < (f.firmAt ?? 0) ? `${f.range[0]}–${f.range[1]}` : f.cls;
  const kind = cls === 'X' ? 'crit' : cls === 'M' ? 'warn' : 'info';
  if (f.phase === 'telegraph') {
    const plan = f.plan;
    const tail = plan ? ` · STOWED ${plan.stow.length}${plan.run.length ? ` · RUNNING ${plan.run.length}` : ''}`
      : f.choice ? ` · ${f.decidedBy === 'click' ? 'your choice' : f.decidedBy === 'remembered' ? `your ${f.cls} choice` : f.decidedBy === 'builder' ? 'the Builder' : 'unanswered: the safe default'}: ${choiceText(f.choice)}` : '';
    condition(s, 'flare', `☉ ${range} FLARE — protons in ${fmtClock(f.timer)}${tail}`, kind, { panel: 'weather' });
  } else {
    const stowed = s.buildings.filter((b) => upArray(b) && (b.stowT ?? 0) > 0.5).length;
    const lost = s.buildings.filter((b) => upArray(b) && (b.stowT ?? 0) > 0.5)
      .reduce((n, b) => n + (panelMemo.get(s)?.get(b.id) ?? 0) * day.sunFactor, 0);
    const what = f.phase === 'tail' ? `${f.cls} tail` : `${f.cls} FLARE`;
    condition(s, 'flare', `☉ ${what} — ${fmtClock(f.timer)} · ${stowed} stowed${lost > 0.5 ? ` (−${Math.round(lost)} kW)` : ''}` +
      (site.tubeShelter ? ' · the tube shelters crew, labs and compute' : ''), kind, { panel: 'weather' });
  }
  void mods;
}

// ─────────────────────────── the legacy flare (§12.3) ───────────────────────────

function legacyTick(s: GameState, site: SiteDef, day: DayInfo, dt: number) {
  const f = s.flare;
  const L = LEGACY_FLARE;
  if (f.nextAt === 0) f.nextAt = L.firstAtDay * CYCLE_S;
  switch (f.phase) {
    case 'idle':
      if (s.simTime >= f.nextAt) {
        f.phase = 'telegraph';
        f.timer = L.telegraphS;
        f.cls = 'M';
        f.drill = false;
        f.startedAt = s.simTime;
        f.firmAt = s.simTime;
        f.range = ['M', 'M'];
      }
      break;
    case 'telegraph':
      f.timer -= dt;
      if (f.timer <= 0) {
        f.phase = 'active';
        f.timer = L.activeS;
        if (!site.tubeShelter && s.crew > 0) s.morale = Math.max(0, s.morale - L.moraleHit);
        if (s.buildings.some((b) => b.type === 'lab' && b.active)) {
          s.data += L.data;
          alert(s, `HELIOPHYSICS — the flare was also an experiment · +${L.data}≡`, 'info');
        }
        if (!site.tubeShelter && s.buildings.filter((b) => b.active && b.type !== 'lander').length >= 6) s.stats.flaresWithSix += 1;
      }
      break;
    case 'active':
    case 'tail':
      f.timer -= dt;
      if (f.timer <= 0) {
        f.phase = 'idle';
        const jitter = mulberry32((s.seed ^ W.keys.interval) + day.dayIndex)();
        f.nextAt = s.simTime + (L.periodDays + (jitter - 0.5) * 2 * L.jitterDays) * CYCLE_S;
        f.n = (f.n ?? 0) + 1;
      }
      break;
  }
  // today's solar 0 while active, the tube aside (economy step 1 reads stowT)
  const dark = f.phase === 'active' && !site.tubeShelter;
  for (const b of s.buildings) {
    if (b.type !== 'solar') continue;
    if (dark) b.stowT = 1; else delete b.stowT;
  }
  if (f.phase === 'telegraph') {
    condition(s, 'flare', site.tubeShelter
      ? 'SOLAR FLARE INBOUND — lava tube shielding will hold'
      : `SOLAR FLARE INBOUND — radiation storm in ${Math.ceil(f.timer)} s`, site.tubeShelter ? 'info' : 'crit');
  } else if (f.phase === 'active' && !site.tubeShelter) {
    condition(s, 'flare', `SOLAR FLARE — solar arrays dark, crew sheltering for ${Math.ceil(f.timer)} s`, 'crit', { panel: 'power' });
  }
}

// ─────────────────────────── what the UI reads ───────────────────────────

export interface WeatherView {
  legacy: boolean;
  /** T0 (Earth's bulletin) */
  band: Band; gauge: string; a: number; rising: boolean;
  /** the chip's text and shape */
  chip: string; chipShape: '' | 'watch' | 'telegraph' | 'crit' | 'active' | 'tail' | 'cruise';
  phase: FlareState['phase'];
  cls: FlareClass | null;
  /** 'M–X' while a range, else the class */
  classText: string;
  firmIn: number; timer: number; drill: boolean;
  watch: boolean;
  night: boolean;
  /** the pop-up (§5.2, §10.3) */
  popup: null | {
    n: number; full: boolean; pauses: boolean; locked: boolean; decidedBy: FlareDecider; choice: ArrayChoice;
    choiceKey: string; remembered: boolean; builder: boolean; answeredClass: boolean;
    /** the pop-up paused the game, and it still is */
    pausedBy: boolean;
    arrays: number; fields: number; kw: number; bankS: number; criticalKW: number; criticalN: number;
    options: ChoicePreview[];
    autoRepair: boolean;
    /** the class the remember box speaks for */
    rememberCls: FlareClass;
    headline: string;
    defaultLine: string;
    /** 'Arrays: choose now…' (core/forecast.ts): the card ahead of the flare, its clock, title and foot */
    ahead?: true; clockText?: string; touchTitle?: string; footText?: string;
  };
  last: FlareLogEntry | null;
  log: FlareLogEntry[];
  wrecks: { id: number; field: number; job: string; cls: FlareClass }[];
  repairs: { queued: number; parts: number; working: number };
  remember: Partial<Record<FlareClass, string>>;
  arrays: { n: number; fields: number; kw: number };
  /** the next flare's time (debug and tests only: the chip never shows it at T0) */
  nextAt: number;
  cme: { at: number; until: number } | null;
  /** the power panel's flare line (§5.6), '' outside a flare */
  powerLine: string;
  /** §4 beyond the arrays (core/flareEffects.ts): the telegraph's buttons, EXPOSURE, SCARRED, the blackout */
  fx: EffectsView;
  /** the forecast (core/forecast.ts withForecast): the NEXT block, the timeline, the ahead pop-up */
  forecast?: ForecastView;
}

const PREVIEW_CHOICES: [string, ArrayChoice][] = [
  ['run', { mode: 'run' }], ['stow', { mode: 'stow' }],
  ...PORTIONS.map((p) => [`p${Math.round(p * 100)}`, { mode: 'portion', p }] as [string, ArrayChoice]),
  ['feed', { mode: 'feed' }],
];

/** Everything the chip, the pop-up, the panel and the inspector show. */
export function weatherView(s: GameState, mods: Mods, site: SiteDef, day: DayInfo, slider?: number): WeatherView {
  const f = s.flare;
  const w = s.weather ?? defaultWeather();
  const T = s.simTime / CYCLE_S;
  const a = activity(weatherSeed(s), T);
  const band = bandOf(a);
  const cls = shownClass(s);
  const ranged = f.phase === 'telegraph' && !!f.range && s.simTime < (f.firmAt ?? 0);
  const classText = cls ? (ranged ? `${f.range![0]}–${f.range![1]}` : f.cls!) : '';
  const arrays = s.buildings.filter(upArray);
  const { fields } = fieldsOf(s);
  const kwNow = arrays.reduce((n, b) => n + outputNow(s, b, day), 0);
  let chip = `☉ ${gaugeOf(band)}`;
  let chipShape: WeatherView['chipShape'] = '';
  if (w.legacy) {
    chip = f.phase === 'telegraph' ? `☉ FLARE ${fmtClock(f.timer)}` : f.phase === 'active' ? `☉ FLARE ▮▮▮ ${fmtClock(f.timer)}` : '☉';
  } else if (f.phase === 'telegraph' && cls) {
    chip = `☉ ${classText} ${fmtClock(f.timer)}`; chipShape = cls === 'X' ? 'crit' : 'telegraph';
  } else if (f.phase === 'active' && f.cls) {
    chip = `☉ ${f.cls} ▮▮▮ ${fmtClock(f.timer)}`; chipShape = 'active';
  } else if (f.phase === 'tail') {
    chip = `☉ X tail ${fmtClock(f.timer)}`; chipShape = 'tail';
  } else if (f.watch) {
    chip = `☉ X? ½d`; chipShape = 'watch';
  }
  const fx = effectsView(s, mods, site);
  // the comms blackout (§10.1): ⌁ on the chip
  if (!w.legacy && fx.dark > 0) chip += ' ⌁';
  let popup: WeatherView['popup'] = null;
  if (!w.legacy && f.phase === 'telegraph' && cls) {
    const { choice, by } = f.plan?.locked ? { choice: f.choice ?? { mode: 'feed' as const }, by: f.decidedBy ?? 'default' as FlareDecider } : resolveChoice(s, mods);
    const opts: [string, ArrayChoice][] = [...PREVIEW_CHOICES];
    if (slider !== undefined && !PORTIONS.some((p) => Math.abs(p - slider) < 1e-6)) opts.push([`p${Math.round(slider * 100)}`, { mode: 'portion', p: slider }]);
    if (choice.mode === 'portion' && !opts.some(([k]) => k === choiceKey(choice))) opts.push([choiceKey(choice), choice]);
    const options = opts.map(([k, c]) => previewChoice(s, mods, site, day, c, cls, k));
    const feed = options.find((o) => o.key === 'feed')!;
    const pw = s.power;
    const other = Math.max(0, pw.supply - (pw.solar ?? 0));
    const load = Math.max(0, pw.demand - (pw.construction ?? 0));
    const bankS = load - other > 0.01 ? s.powerStored / (load - other) : Infinity;
    const remembered = by === 'remembered';
    const builder = by === 'builder';
    // the form follows the flare's own class (a C opens small once one was answered); the previews its range
    const own = f.cls ?? cls;
    const answeredClass = !!w.answered[own];
    const full = by === 'click' ? false : !(remembered || builder || (own === 'C' && answeredClass));
    const critN = options.find((o) => o.key === 'feed')?.runN ?? 0;
    popup = {
      n: f.n ?? 0, full, pauses: full && own !== 'C', locked: !!f.plan?.locked, decidedBy: by, choice, choiceKey: choiceKey(choice),
      remembered, builder, answeredClass,
      pausedBy: s.paused && f.pausedAt !== undefined && f.pausedAt >= (f.startedAt ?? 0),
      arrays: arrays.length, fields: fields.filter((x) => x.ids.some((id) => arrays.some((b) => b.id === id))).length, kw: kwNow,
      bankS, criticalKW: feed ? planFor({ s, mods, day, margin: feedMargin(s, mods), left: flareSeconds(cls) }, { mode: 'feed' }).criticalKW : 0,
      criticalN: critN, options, autoRepair: w.autoRepair, rememberCls: cls,
      headline: `☉ FLARE INBOUND — class ${classText}${ranged ? ` (a range: firm in ${fmtClock((f.firmAt ?? 0) - s.simTime)})` : ''}${f.drill ? ' · DRILL' : ''}`,
      defaultLine: remembered ? `your ${own} choice: ${choiceText(choice)}` : builder ? `the Builder: ${choiceText(choice)}` : 'the safe default (stow all but the critical feed)',
    };
  }
  const wrecks = s.buildings.filter((b) => b.wreck).map((b) => ({
    id: b.id, field: fieldsOf(s).of.get(b.id) ?? 0, job: b.wreck!.job ?? '', cls: b.wreck!.cls,
  }));
  let queued = 0, parts = 0, working = 0;
  for (const q of w.repairs) for (const id of q) {
    const b = s.buildings.find((x) => x.id === id);
    if (!b) continue;
    queued++;
    const p = b.fix ? b.fix.pct : Math.round((b.flareDmg ?? 0) * 100);
    parts += b.fix?.paid ? 0 : repairParts(p);
    if (b.fix && b.idleReason === 'building') working++;
  }
  return {
    legacy: !!w.legacy, band, gauge: gaugeOf(band), a, rising: activity(weatherSeed(s), T + 0.25) >= a,
    chip, chipShape, phase: f.phase, cls, classText, firmIn: Math.max(0, (f.firmAt ?? 0) - s.simTime),
    timer: f.timer, drill: !!f.drill, watch: !!f.watch, night: day.sunFactor <= 0.01,
    popup, last: f.log?.length ? f.log[f.log.length - 1] : null, log: [...(f.log ?? [])].reverse().slice(0, 8),
    wrecks, repairs: { queued, parts, working },
    remember: Object.fromEntries(Object.entries(w.remember).map(([k, c]) => [k, choiceText(c!)])),
    arrays: { n: arrays.length, fields: fields.length, kw: kwNow },
    nextAt: f.nextAt, cme: f.cme ?? null, powerLine: powerLine(s, day), fx,
  };
}

/** One array's line for the inspector (§10.7). */
export function arrayView(s: GameState, site: SiteDef, day: DayInfo, id: number) {
  const b = s.buildings.find((x) => x.id === id);
  if (!b || b.type !== 'solar') return null;
  const { fields, of } = fieldsOf(s);
  const fld = fields[(of.get(id) ?? 0) - 1];
  const list = fld ? fld.ids.map((x) => s.buildings.find((y) => y.id === x)!).filter(Boolean) : [b];
  const kw = list.filter(upArray).reduce((n, x) => n + outputNow(s, x, day), 0);
  const dmg = list.filter((x) => (x.flareDmg ?? 0) > 1e-6 && !x.wreck);
  const parts = dmg.reduce((n, x) => n + repairParts(Math.round((x.flareDmg ?? 0) * 100)), 0);
  const cost = buildCostAt('solar', site).metals ?? 15;
  return {
    field: fld?.n ?? 0, arrays: list.length, kw, cap: b.cap ?? 1, dmg: b.flareDmg ?? 0, override: fld?.override ?? 'follow',
    fieldDamaged: dmg.length, repairParts: parts, queued: (s.weather?.repairs ?? []).some((q) => q.includes(id)),
    wreck: b.wreck ? { cls: b.wreck.cls, day: Math.floor(b.wreck.at / CYCLE_S) + 1, job: b.wreck.job ?? '' } : null,
    rebuild: cost, salvage: Math.floor(cost * W.wreck.salvage), stowT: b.stowT ?? 0,
  };
}

/** The power panel's line during a flare (§5.6), or ''. */
export function powerLine(s: GameState, day: DayInfo): string {
  const f = s.flare;
  if (f.phase === 'idle' || !f.cls || s.weather?.legacy) return '';
  const stowed = s.buildings.filter((b) => upArray(b) && ((b.stowT ?? 0) > 0.5 || b.stow));
  const lost = stowed.reduce((n, b) => n + (panelMemo.get(s)?.get(b.id) ?? 0) * day.sunFactor, 0);
  const running = s.buildings.filter((b) => upArray(b) && !stowed.includes(b)).length;
  const p = s.power;
  const drain = p.demand - p.supply;
  const left = f.phase === 'telegraph' ? f.timer + flareSeconds(f.cls) : f.timer + (f.phase === 'active' ? W.classes[f.cls].tailS : 0) + W.stowS;
  const covers = drain <= 0.01 || s.powerStored / drain >= left;
  return `FLARE ${shownClass(s)} — ${stowed.length} arrays stowed (−${Math.round(lost)} kW), ${running} running${f.plan?.keep.length ? ' on the critical feed' : ''}` +
    ` · the bank ${covers ? `covers ${fmtClock(left)} ✓` : `runs dry at ${fmtClock(s.powerStored / Math.max(0.01, drain))}`}`;
}

/** The dusk line's flare tail (economy step 2): a flare under way at dusk, or the spot-group watch. */
export function duskLine(s: GameState): string {
  const f = s.flare;
  if (s.weather?.legacy) return '';
  if (f.phase !== 'idle' && f.cls) {
    const stowed = s.buildings.filter((b) => upArray(b) && (b.stow || (b.stowT ?? 0) > 0.5)).length;
    return ` · a ${shownClass(s)} flare holds ${stowed} arrays stowed into the dusk`;
  }
  if (f.watch) return ' · a big spot group: an X-class flare is possible within ½ day';
  return forecastDusk(s); // from T1: the next flare due (core/forecast.ts)
}

export { CLASS_RANK };
