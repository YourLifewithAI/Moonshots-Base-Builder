/** Flare forecasting (docs/16 §6, phase F3), run inside economy step 8
 *  (spaceWeather.ts weatherTick calls forecastTick first).
 *
 *  - The tier: T0 the flash and Earth's bulletin · T1 Heliophysics
 *    Forecasting and a built Solar Observatory · T2 the L1 Sentinel on station
 *    · T3 Solar-Cycle Forecasting with the sentinel.
 *  - The telegraph bonus: a tier's lead starts the telegraph earlier; the
 *    protons still come when the schedule says (research never moves the Sun).
 *  - The window: every 60 s, the next flare's flash inside a window that
 *    narrows as it nears (§6.2), and its class range. A forecast never lies:
 *    the flash is the schedule's own time, and the class is the telegraph's
 *    own rule at this era, looked at again whenever the era changes.
 *  - Blind: at night off the pole, in a ridge's shade or without power the
 *    observatory holds its last window, widening 20% a game-minute. The
 *    sentinel is never blind.
 *  - T3: the schedule run forward — the next three flares.
 *  - The L1 Sentinel's launch and cruise; 'Arrays: choose now…' (a choice
 *    set ahead, applied at the telegraph as a click).
 *
 *  Pure and deterministic: every draw is mulberry32((seed ^ K) + index). */
import { BUILDINGS } from '../data/buildings';
import { CYCLE_S, DAY_S } from '../data/balance';
import { RESOURCES, type ResourceId } from '../data/resources';
import { FORECAST as F, TIER_NAME, type ForecastTier } from '../data/forecast';
import { CLASS_RANK, PORTIONS, SPACE_WEATHER as W, worse, type ArrayChoice, type FlareClass, type FlareDecider } from '../data/spaceWeather';
import type { SiteDef } from '../data/sites';
import { defaultWeather, type BuildingState, type GameState, type WeatherState } from './state';
import type { Mods } from './mods';
import { alertIn } from './economy';
import { fmtClock, type DayInfo } from './daynight';
import { mulberry32 } from './rng';
import { weatherSeed } from './moon';
import {
  activity, bandOf, builderDecides, choiceText, cycleOf, drawClass, feedMargin, flareSeconds, criticalKW, previewChoice,
  rangeOf, stanceChoice, telegraphOf, type ChoicePreview, type ClassCtx, type WeatherResult, type WeatherView,
} from './spaceWeather';

/** every alert here belongs to one notification family (docs/19 S7) */
const alert = alertIn('weather');

const OK: WeatherResult = { ok: true, reason: '' };
const no = (reason: string): WeatherResult => ({ ok: false, reason });
const isSite = (b: { construction?: number }) => (b.construction ?? 0) > 0;
const label = (b: BuildingState) => `${BUILDINGS[b.type].name} #${b.id}`;
const weatherOf = (s: GameState): WeatherState => (s.weather ??= defaultWeather());
const glyph = (r: string) => RESOURCES[r as ResourceId]?.glyph ?? r;
const goods = (g: Partial<Record<string, number>>) => Object.entries(g).map(([r, v]) => `${v}${glyph(r)}`).join(' ');
const rangeText = (r: readonly [FlareClass, FlareClass]) => (r[0] === r[1] ? r[0] : `${r[0]}–${r[1]}`);

// ─────────────────────────── the tier ───────────────────────────

/** Built Solar Observatories (a site does not count). */
export const observatories = (s: GameState) => s.buildings.filter((b) => b.type === 'solarObservatory' && !isSite(b));
/** it works: on and powered (economy step 4 set b.active this tick) */
const working = (b: BuildingState) => b.enabled && !!b.active;
/** It sees the Sun: working, the Sun up (the pole's ridge keeps it by night), no ridge's shade. */
export const sees = (b: BuildingState, day: DayInfo) => working(b) && day.sunFactor > F.seesSun && !b.shaded;

/** The sentinel is on station. */
export function sentinelOnline(s: GameState): boolean {
  const t = s.weather?.sentinel;
  return !!t && s.simTime >= t.onlineAt;
}

/** The base's tier now: what research allows, with the hardware it needs. */
export function tierOf(s: GameState, mods: Mods): ForecastTier {
  if (s.weather?.legacy) return 0;
  const t = mods.forecastTier ?? 0;
  if (t >= 2 && sentinelOnline(s)) return t >= 3 ? 3 : 2;
  if (t >= 1 && observatories(s).length > 0) return 1;
  return 0;
}

/** the extra warning a tier gives every telegraph (s) */
export const leadOf = (tier: ForecastTier) => F.leadS[tier] ?? 0;

// ─────────────────────────── the truth, as the forecast sees it ───────────────────────────

/** The next flare's class as the telegraph will draw it, at this era: the
 *  spot-group watch locks an X half a day ahead, and an X it did not see
 *  comes as an M (spaceWeather.ts, the idle phase). */
export function trueClass(s: GameState, era: number): FlareClass {
  const f = s.flare;
  const n = f.n ?? 0;
  let cls = drawClass(s, n, f.nextAt, era);
  if (f.watchN === n) {
    if (f.nextCls === 'X') return 'X';
    if (cls === 'X') cls = 'M';
  }
  return cls;
}

export interface Predicted { n: number; cls: FlareClass; drill: boolean; flash: number }

/** The schedule run forward (T3): the next `count` flares after the one in
 *  flight (or from the next, when quiet), each with its class at this era,
 *  its drill and its flash — the same rules endFlare and drawClass apply. */
export function predictFlares(s: GameState, count: number): Predicted[] {
  const f = s.flare;
  const seed = weatherSeed(s);
  const era = s.era;
  const ctx: ClassCtx = { seenM: !!f.seen?.M, xCount: f.xCount ?? 0, lastX: f.lastX ?? -1e9, noXUntil: f.noXUntil ?? 0 };
  const out: Predicted[] = [];
  const next = (n: number, cls: FlareClass, end: number, a: number) => {
    const u = mulberry32((seed ^ W.keys.interval) + n)();
    const days = (W.interval.base - W.interval.slope * a) * (1 + (u - 0.5) * 2 * W.interval.jitter);
    return end + days * CYCLE_S;
  };
  let n = f.n ?? 0;
  let flash: number;
  if (f.phase === 'idle') {
    if (!f.nextAt) return out;
    flash = f.nextAt;
  } else {
    // the flare in flight: its class and end are known
    const cls = f.cls ?? 'C';
    const C = W.classes[cls];
    const end = f.phase === 'telegraph' ? s.simTime + f.timer + C.activeS + C.tailS
      : f.phase === 'active' ? s.simTime + f.timer + C.tailS : s.simTime + f.timer;
    flash = next(n, cls, end, f.a ?? activity(seed, s.simTime / CYCLE_S));
    n += 1;
  }
  for (let i = 0; i < count; i++) {
    const cls = i === 0 && f.phase === 'idle' ? trueClass(s, era) : drawClass(s, n, flash, era, ctx);
    const drill = n === 0 || (cls === 'X' && ctx.xCount === 0);
    out.push({ n, cls, drill, flash });
    if (cls === 'M') ctx.seenM = true;
    if (cls === 'X') { ctx.xCount += 1; ctx.lastX = flash; }
    const C = W.classes[cls];
    const end = flash + telegraphOf(cls, drill) + C.activeS + C.tailS;
    flash = next(n, cls, end, activity(seed, flash / CYCLE_S));
    n += 1;
  }
  return out;
}

/** A window of width max(minS, f·(t − at)) that holds t, placed by the seeded v (§6.2). */
function placeWindow(seed: number, key: number, k: number, t: number, at: number, p: { f: number; minS: number }) {
  const width = Math.max(p.minS, p.f * Math.max(0, t - at));
  const v = F.window.vLo + F.window.vSpan * mulberry32((seed ^ W.keys.forecast) + key * 64 + (k % 63))();
  const lo = t - width * v;
  return { lo, hi: lo + width };
}

const unionRange = (a: readonly [FlareClass, FlareClass], b: readonly [FlareClass, FlareClass]): [FlareClass, FlareClass] => [
  CLASS_RANK[a[0]] <= CLASS_RANK[b[0]] ? a[0] : b[0], worse(a[1], b[1]),
];

// ─────────────────────────── the tick ───────────────────────────

/** Economy step 8, before the flare's phases: the tier and its lead, the
 *  sentinel's cruise, the observatory's look and trickle, the window. */
export function forecastTick(s: GameState, site: SiteDef, mods: Mods, day: DayInfo, dt: number) {
  const w = weatherOf(s);
  const f = s.flare;
  const now = s.simTime;
  const tier = tierOf(s, mods);
  w.tier = tier;
  w.lead = leadOf(tier);
  // the sentinel reaches L1
  const st = w.sentinel;
  if (st && !st.online && now >= st.onlineAt) {
    st.online = true;
    alert(s, `L1 SENTINEL ON STATION — the next flare's class for sure and a tight window, day and night · telegraphs +${leadOf(2)} s`,
      'info', { panel: 'weather' });
  }
  // the observatory's look: heliophysics while it sees the Sun
  const seeing = !w.legacy && observatories(s).some((b) => sees(b, day));
  if (seeing) {
    w.seenSunAt = now;
    s.data += F.obsDataPerS * dt;
  }
  if (tier === 0) { delete w.window; return; }
  if (f.phase !== 'idle' || !f.nextAt) return;
  const n = f.n ?? 0;
  const live = tier >= 2 || seeing;
  const k = Math.floor(now / F.updateS);
  const win = w.window;
  if (live) {
    if (!win || win.n !== n || win.tier !== tier || win.era !== s.era || win.k !== k) {
      const { lo, hi } = placeWindow(weatherSeed(s), n, k, f.nextAt, now, tier >= 2 ? F.window.t2 : F.window.t1);
      const cls = trueClass(s, s.era);
      w.window = { n, lo, hi, range: tier >= 2 ? [cls, cls] : rangeOf(weatherSeed(s), n, cls), k, at: now, era: s.era, tier };
    }
  } else if (win && win.n !== n) {
    // blind, and the forecast was of a flare that has passed: nothing to hold
    delete w.window;
  } else if (win && win.era !== s.era) {
    // blind, and an era opened: the class may have moved, and the range widens to hold it
    win.range = unionRange(win.range, rangeOf(weatherSeed(s), n, trueClass(s, s.era)));
    win.era = s.era;
  }
  void site;
}

/** The window as shown now: the stored one, widened while blind (it still holds the flash). */
function shownWindow(s: GameState, live: boolean): { lo: number; hi: number; blindS: number } | null {
  const w = s.weather;
  const win = w?.window;
  if (!win || win.n !== (s.flare.n ?? 0)) return null;
  if (live) return { lo: win.lo, hi: win.hi, blindS: 0 };
  const blindS = Math.max(0, s.simTime - Math.max(w!.seenSunAt ?? 0, win.at));
  const extra = F.blindWiden * (win.hi - win.lo) * (blindS / 60);
  return { lo: win.lo - extra / 2, hi: win.hi + extra / 2, blindS };
}

/** A choice made ahead answers this telegraph as a click (startFlare calls it). */
export function applyAhead(s: GameState) {
  const w = s.weather;
  const f = s.flare;
  const a = w?.ahead;
  if (!w || !a) return;
  delete w.ahead;
  if (a.n !== (f.n ?? 0) || !f.cls) return;
  f.choice = a.choice;
  f.decidedBy = 'click';
  w.autoRepair = a.repair;
  w.answered[f.cls] = true;
}

/** The dusk line's forecast tail (economy step 2, from T1): the next flare due, and what a stow would take. */
export function forecastDusk(s: GameState): string {
  const w = s.weather;
  const f = s.flare;
  const win = w?.window;
  if (!w || !win || (w.tier ?? 0) < 1 || f.phase !== 'idle' || win.n !== (f.n ?? 0)) return '';
  const lead = w.lead ?? 0;
  const a = Math.max(0, win.lo - lead - s.simTime), b = Math.max(0, win.hi - lead - s.simTime);
  const cls = worse(win.range[0], win.range[1]);
  const kws = (s.power.solar ?? 0) * flareSeconds(cls);
  return ` · ${rangeText(win.range)} due in ${fmtClock(a)}–${fmtClock(b)}${kws > 500 ? ` would take ${Math.round(kws / 1000)}k if stowed` : ''}`;
}

/** Heliophysics data a flare pays ×2 while an observatory sees the Sun (§4.2). */
export function flareDataMult(s: GameState, day: DayInfo): number {
  return observatories(s).some((b) => sees(b, day)) ? F.obsFlareMult : 1;
}

/** The telegraph's X-ray peak: 20 s after the flash, or at once with the sentinel (§3.1). */
export function firmAtOf(s: GameState, flashAt: number): number {
  return (s.weather?.tier ?? 0) >= 2 ? s.simTime : flashAt + W.firmAtS;
}

// ─────────────────────────── actions ───────────────────────────

const massDriverUp = (s: GameState) => s.buildings.some((b) => b.type === 'massDriver' && !isSite(b) && b.enabled && b.active);

/** What a launch costs now: the Mass Driver throws it for stored energy, else the hopper burns propellant. */
function sentinelCost(s: GameState): { goods: Record<string, number>; energy: number; by: 'hopper' | 'driver' } {
  const S = F.sentinel;
  return massDriverUp(s)
    ? { goods: { ...S.cost }, energy: S.driverEnergy, by: 'driver' }
    : { goods: { ...S.cost, ...S.propellant }, energy: 0, by: 'hopper' };
}

/** Whether the sentinel can go now, and why not. */
export function canLaunchSentinel(s: GameState, mods: Mods): WeatherResult {
  if (!mods.actions.has('sentinel')) return no('NEEDS L1 SENTINEL — research it to launch one');
  const st = s.weather?.sentinel;
  if (st) return no(sentinelOnline(s) ? 'ONE SENTINEL — it is already on station at L1' : `ONE SENTINEL — it is cruising to L1: on station in ${fmtClock(st.onlineAt - s.simTime)}`);
  const c = sentinelCost(s);
  for (const [r, amt] of Object.entries(c.goods)) {
    const have = s.resources[r as ResourceId] ?? 0;
    if (have < amt) return no(`LAUNCH NEEDS ${amt}${glyph(r)} — have ${Math.floor(have)}`);
  }
  if (c.energy && s.powerStored < c.energy) return no(`THE MASS DRIVER NEEDS ${c.energy} STORED — have ${Math.floor(s.powerStored)}`);
  return OK;
}

/** Launch sentinel (§6.4): an action at the Lander. The hopper lifts a kick
 *  stage (or the Mass Driver throws it); it cruises a lunar day to L1. One, and it does not fail. */
export function launchSentinel(s: GameState, mods: Mods): WeatherResult {
  const ok = canLaunchSentinel(s, mods);
  if (!ok.ok) return ok;
  const c = sentinelCost(s);
  for (const [r, amt] of Object.entries(c.goods)) s.resources[r as ResourceId] -= amt;
  if (c.energy) s.powerStored -= c.energy;
  const cruise = F.sentinel.cruiseDays * CYCLE_S;
  weatherOf(s).sentinel = { launchedAt: s.simTime, onlineAt: s.simTime + cruise, by: c.by };
  alert(s, `SENTINEL LAUNCHED — ${c.by === 'driver' ? 'the Mass Driver throws it sunward' : 'the hopper lifts its kick stage'} · ` +
    `it cruises to L1 for a lunar day: on station in ${fmtClock(cruise)}`, 'info', { panel: 'weather' });
  return OK;
}

/** The class the ahead pop-up speaks for: the worse of the forecast's range. */
export function aheadClass(s: GameState): FlareClass {
  const win = s.weather?.window;
  return win && win.n === (s.flare.n ?? 0) ? worse(win.range[0], win.range[1]) : 'M';
}

/** 'Arrays: choose now…' (§10.2): the arrays' choice for the next flare, from a forecast; it waits for the telegraph. null clears it. */
export function setAhead(s: GameState, mods: Mods, choice: ArrayChoice | null, o: { repair?: boolean; remember?: boolean } = {}): WeatherResult {
  const w = weatherOf(s);
  const f = s.flare;
  if (choice === null) {
    if (!w.ahead) return no('NO CHOICE SET AHEAD');
    delete w.ahead;
    alert(s, 'ARRAYS — the choice set ahead is cleared: the next flare asks again', 'info', { panel: 'weather' });
    return OK;
  }
  if (f.phase !== 'idle') return no('A FLARE IS UNDER WAY — answer it in its pop-up');
  if (tierOf(s, mods) < 1) return no('CHOOSING AHEAD NEEDS A FORECAST — Heliophysics Forecasting and a Solar Observatory');
  const clean: ArrayChoice = choice.mode === 'portion' ? { mode: 'portion', p: Math.max(0, Math.min(1, choice.p ?? 0)) } : { mode: choice.mode };
  w.ahead = { n: f.n ?? 0, choice: clean, repair: o.repair ?? w.autoRepair };
  const cls = aheadClass(s);
  if (o.remember) w.remember[cls] = clean;
  const win = w.window;
  alert(s, `ARRAYS SET AHEAD — ${choiceText(clean)} for the next flare${win ? ` (${rangeText(win.range)})` : ''}: it waits for the telegraph`,
    'info', { panel: 'weather' });
  return OK;
}

// ─────────────────────────── what the UI reads ───────────────────────────

export interface TimelineMark {
  /** game time */
  a: number; b: number;
  kind: 'flare' | 'far' | 'now-flare' | 'past' | 'cme' | 'sail' | 'watch';
  label: string;
  /** 0..1: past flares fade out over half a day */
  fade: number;
  /** the flare's index (forecast boxes) */
  n?: number;
}

export interface ForecastView {
  tier: ForecastTier; tierName: string; lead: number;
  /** T1 sees now, or the sentinel */
  live: boolean;
  /** T1 blind: why ('night', 'shade', 'no power') and for how long */
  blindWhy: string; blindS: number;
  source: string;
  /** the next flare (idle, T1+): its class range and when its warning comes */
  next: null | { n: number; classText: string; range: [FlareClass, FlareClass]; inLo: number; inHi: number; text: string };
  /** T2+: the next flare's CME, or a CME on its way (T1: its window) */
  cme: string;
  /** T3: the cycle */
  cycle: null | { strip: string; nowIdx: number; text: string; maxDay: number };
  /** T3: the next three (from the next, or after the flare in flight) */
  three: { n: number; classText: string; text: string }[];
  sentinel: null | { state: 'none' | 'cruise' | 'online'; inS: number; can: boolean; why: string; cost: string };
  /** a choice set ahead for the next flare */
  aheadSet: string;
  canAhead: boolean; aheadWhy: string;
  /** 'Arrays: choose now…': the pop-up's data ahead of the flare, when the UI has it open */
  popup: WeatherView['popup'];
  /** the chip in quiet times (null: T0's gauge) */
  chip: string | null; chipShape: WeatherView['chipShape'];
  timeline: { from: number; to: number; now: number; nights: [number, number][]; marks: TimelineMark[]; curve: number[] | null; maxAt: number | null };
  /** T0's hint: what forecasting would show */
  hint: string;
}

const PREVIEWS: [string, ArrayChoice][] = [
  ['run', { mode: 'run' }], ['stow', { mode: 'stow' }],
  ...PORTIONS.map((p) => [`p${Math.round(p * 100)}`, { mode: 'portion', p }] as [string, ArrayChoice]),
  ['feed', { mode: 'feed' }],
];
const keyOf = (c: ArrayChoice) => (c.mode === 'portion' ? `p${Math.round((c.p ?? 0) * 100)}` : c.mode);

/** The ahead pop-up (§10.2 `Arrays: choose now…`), shaped as the telegraph's so the same card shows it. */
function aheadPopup(s: GameState, mods: Mods, site: SiteDef, day: DayInfo, v: WeatherView, next: NonNullable<ForecastView['next']>, slider?: number): WeatherView['popup'] {
  const w = s.weather ?? defaultWeather();
  const cls = worse(next.range[0], next.range[1]);
  const set = w.ahead && w.ahead.n === next.n ? w.ahead.choice : null;
  const mem = w.remember[cls];
  const builder = builderDecides(s, mods);
  const choice: ArrayChoice = set ?? mem ?? (builder ? stanceChoice(cls) : { mode: 'feed' });
  const by: FlareDecider = set ? 'click' : mem ? 'remembered' : builder ? 'builder' : 'default';
  const opts: [string, ArrayChoice][] = [...PREVIEWS];
  if (slider !== undefined && !PORTIONS.some((p) => Math.abs(p - slider) < 1e-6)) opts.push([`p${Math.round(slider * 100)}`, { mode: 'portion', p: slider }]);
  if (choice.mode === 'portion' && !opts.some(([k]) => k === keyOf(choice))) opts.push([keyOf(choice), choice]);
  const options: ChoicePreview[] = opts.map(([k, c]) => previewChoice(s, mods, site, day, c, cls, k));
  const pw = s.power;
  const other = Math.max(0, pw.supply - (pw.solar ?? 0));
  const load = Math.max(0, pw.demand - (pw.construction ?? 0));
  const defaultLine = mem ? `your ${cls} choice: ${choiceText(mem)}` : builder ? `the Builder: ${choiceText(stanceChoice(cls))}` : 'the safe default (stow all but the critical feed)';
  return {
    // the card always opens full (a set choice would read as a click and fold it): its foot says what is set
    n: -1 - next.n, full: true, pauses: false, locked: false, decidedBy: by === 'click' ? 'default' : by, choice, choiceKey: keyOf(choice),
    remembered: by === 'remembered', builder: by === 'builder', answeredClass: !!w.answered[cls], pausedBy: false,
    arrays: v.arrays.n, fields: v.arrays.fields, kw: v.arrays.kw,
    bankS: load - other > 0.01 ? s.powerStored / (load - other) : Infinity,
    criticalKW: criticalKW(s, feedMargin(s, mods), flareSeconds(cls)),
    criticalN: options.find((o) => o.key === 'feed')?.runN ?? 0,
    options, autoRepair: w.ahead?.repair ?? w.autoRepair, rememberCls: cls,
    headline: `☉ NEXT FLARE — class ${next.classText} · choose now: it waits for the telegraph`,
    defaultLine,
    ahead: true,
    clockText: `due ${next.text}`,
    touchTitle: `☉ NEXT ${next.classText} · due ${next.text}`,
    footText: set ? `Set: ${choiceText(set)} — Confirm changes it; Cancel keeps it` : `Unset, the telegraph asks; unanswered: ${defaultLine}`,
  };
}

/** Everything the chip, the NEXT block, the timeline and the ahead pop-up show. */
export function forecastView(s: GameState, mods: Mods, site: SiteDef, day: DayInfo, v: WeatherView,
  ui: { ahead?: boolean; slider?: number } = {}): ForecastView {
  const w = s.weather ?? defaultWeather();
  const f = s.flare;
  const now = s.simTime;
  const seed = weatherSeed(s);
  const tier = tierOf(s, mods);
  const lead = leadOf(tier);
  const obs = observatories(s);
  const seeing = obs.filter((b) => sees(b, day));
  const live = tier >= 2 || seeing.length > 0;
  const blindWhy = tier !== 1 || live ? '' : !obs.some(working) ? 'no power' : day.sunFactor <= F.seesSun ? 'night' : 'shade';
  const source = tier >= 2 ? 'L1 sentinel' : obs.length ? label(seeing[0] ?? obs.find(working) ?? obs[0]) : '';
  const idle = f.phase === 'idle';
  // the next flare
  let next: ForecastView['next'] = null;
  let blindS = 0;
  const sw = tier >= 1 && idle ? shownWindow(s, live) : null;
  if (sw) {
    blindS = sw.blindS;
    const range = w.window!.range;
    const inLo = Math.max(0, sw.lo - lead - now), inHi = Math.max(0, sw.hi - lead - now);
    const text = tier >= 2 ? `in ${fmtClock((inLo + inHi) / 2)} ±${fmtClock((inHi - inLo) / 2)}` : `in ${fmtClock(inLo)}–${fmtClock(inHi)}`;
    next = { n: w.window!.n, classText: rangeText(range), range: [range[0], range[1]], inLo, inHi, text };
  }
  // the CME: the next flare's (T2: the draw is known) or one on its way
  let cme = '';
  if (tier >= 2 && next) {
    const cls = next.range[0];
    const comes = cls === 'X' || (cls === 'M' && mulberry32((seed ^ W.keys.cme) + next.n)() < W.cme.mShare);
    cme = comes ? `CME after it: arrives ${fmtClock(W.cme.delayDays * CYCLE_S)} after the flash · sail window ${fmtClock(W.cme.sailS)}` : 'no CME after it';
  }
  if (tier >= 1 && f.cme && f.cme.at > now) {
    if (tier >= 2) cme = `CME arrives in ${fmtClock(f.cme.at - now)} · sail window ${fmtClock(W.cme.sailS)}`;
    else {
      const k = Math.floor(now / F.updateS);
      const cw = placeWindow(seed, 0x4000 + (f.n ?? 0), k, f.cme.at, k * F.updateS, F.window.t1);
      cme = `CME due in ${fmtClock(Math.max(0, cw.lo - now))}–${fmtClock(Math.max(0, cw.hi - now))} · sail window ${fmtClock(W.cme.sailS)}`;
    }
  }
  // T3: the cycle and the next three
  let cycle: ForecastView['cycle'] = null;
  let three: ForecastView['three'] = [];
  let maxAt: number | null = null;
  if (tier >= 3) {
    const T = now / CYCLE_S;
    const kC = Math.max(0, Math.floor(T / W.cycle.periodDays));
    const tMax = cycleOf(seed, kC).tMax + kC * W.cycle.periodDays;
    maxAt = tMax * CYCLE_S;
    const bars = '▁▂▃▄▅▆▇█';
    const d0 = kC * W.cycle.periodDays;
    let strip = '';
    for (let d = 0; d < F.cycleDays; d++) {
      const a = activity(seed, d0 + d + 0.5);
      strip += bars[Math.max(0, Math.min(7, Math.floor(((a - W.cycle.aMin) / (1 - W.cycle.aMin)) * 8)))];
    }
    const nowIdx = Math.min(F.cycleDays - 1, Math.floor(T - d0));
    const maxIn = tMax - T;
    const text = maxIn > 0.05 ? `maximum in ${maxIn.toFixed(1)} lunar days (day ${Math.floor(tMax) + 1}) · falling after it`
      : `past its maximum (day ${Math.floor(tMax) + 1}) · falling · ${bandOf(activity(seed, T))}`;
    cycle = { strip, nowIdx, text, maxDay: Math.floor(tMax) + 1 };
    const k = Math.floor(now / F.updateS);
    three = predictFlares(s, F.aheadN).map((p, i) => {
      if (i === 0 && idle && next) return { n: p.n, classText: next.classText, text: next.text };
      const win = placeWindow(seed, p.n, k, p.flash, k * F.updateS, F.window.t3);
      const lo = Math.max(0, win.lo - lead - now), hi = Math.max(0, win.hi - lead - now);
      return { n: p.n, classText: rangeText(rangeOf(seed, p.n, p.cls)), text: `in ${fmtClock(lo)}–${fmtClock(hi)}` };
    });
  }
  // the sentinel
  const st = w.sentinel;
  const can = canLaunchSentinel(s, mods);
  const sc = sentinelCost(s);
  const sentinel: ForecastView['sentinel'] = mods.actions.has('sentinel') || st ? {
    state: !st ? 'none' : now >= st.onlineAt ? 'online' : 'cruise',
    inS: st ? Math.max(0, st.onlineAt - now) : 0,
    can: can.ok, why: can.reason,
    cost: `${goods(F.sentinel.cost)} · ${sc.by === 'driver' ? `${sc.energy} stored (the Mass Driver)` : `${goods(F.sentinel.propellant)} of hopper propellant`}`,
  } : null;
  // a choice set ahead
  const aheadSet = w.ahead && w.ahead.n === (f.n ?? 0) ? choiceText(w.ahead.choice) : '';
  const canAhead = tier >= 1 && idle && !w.legacy;
  const aheadWhy = canAhead ? '' : !idle ? 'a flare is under way: answer it in its pop-up'
    : 'needs a forecast: Heliophysics Forecasting and a Solar Observatory';
  const popup = ui.ahead && canAhead && next ? aheadPopup(s, mods, site, day, v, next, ui.slider) : null;
  // the chip in quiet times
  let chip: string | null = null;
  let chipShape: WeatherView['chipShape'] = v.chipShape;
  if (idle && tier >= 1) {
    const moon = !live ? (blindWhy === 'night' ? ' ☾' : ' (blind)') : '';
    chip = next ? `☉ ${next.classText} ${tier >= 2 ? next.text.replace(/^in /, '') : `${fmtClock(next.inLo)}–${fmtClock(next.inHi)}`}${moon}`
      : `☉ ${v.gauge}${moon}`;
    if (tier >= 3 && cycle) chip += maxAt !== null && maxAt > now ? ` · max in ${((maxAt - now) / CYCLE_S).toFixed(1)} d` : ' · falling';
  }
  if (idle && st && now < st.onlineAt) {
    chip = `${chip ?? v.chip} · L1 in ${fmtClock(st.onlineAt - now)}`;
    if (!v.watch) chipShape = 'cruise';
  }
  // the timeline (§10.5)
  const from = now - F.timeline.pastDays * CYCLE_S;
  const to = now + (F.timeline.days[tier] ?? 1) * CYCLE_S;
  const nights: [number, number][] = [];
  for (let c = Math.floor(from / CYCLE_S); c * CYCLE_S < to; c++) {
    const a = c * CYCLE_S + DAY_S, b = (c + 1) * CYCLE_S;
    if (b > from && a < to) nights.push([Math.max(from, a), Math.min(to, b)]);
  }
  const marks: TimelineMark[] = [];
  for (const l of f.log ?? []) {
    const C = W.classes[l.cls];
    const end = l.at + telegraphOf(l.cls, l.drill) + C.activeS + C.tailS;
    if (end < from) continue;
    marks.push({ a: l.at, b: end, kind: 'past', label: l.cls, fade: Math.min(1, (now - end) / (F.timeline.fadeDays * CYCLE_S)) });
  }
  if (!idle && f.cls) {
    const C = W.classes[f.cls];
    const end = f.phase === 'telegraph' ? now + f.timer + C.activeS + C.tailS : f.phase === 'active' ? now + f.timer + C.tailS : now + f.timer;
    marks.push({ a: f.startedAt ?? now, b: end, kind: 'now-flare', label: v.classText || f.cls, fade: 0 });
  }
  if (next) marks.push({ a: now + next.inLo, b: now + next.inHi, kind: 'flare', label: next.classText, fade: 0, n: next.n });
  if (tier >= 3) {
    const k = Math.floor(now / F.updateS);
    for (const p of predictFlares(s, F.aheadN)) {
      if (idle && next && p.n === next.n) continue;
      const win = placeWindow(seed, p.n, k, p.flash, k * F.updateS, F.window.t3);
      marks.push({ a: win.lo - lead, b: win.hi - lead, kind: 'far', label: rangeText(rangeOf(seed, p.n, p.cls)), fade: 0, n: p.n });
    }
  }
  if (tier >= 1 && f.cme && f.cme.until > from) {
    marks.push({ a: f.cme.at, b: f.cme.at, kind: 'cme', label: 'CME', fade: 0 });
    marks.push({ a: f.cme.at, b: f.cme.until, kind: 'sail', label: 'sail', fade: 0 });
  }
  if (tier === 0 && idle && f.watch) marks.push({ a: now, b: now + W.watchDays * CYCLE_S, kind: 'watch', label: 'X?', fade: 0 });
  let curve: number[] | null = null;
  if (tier >= 3) {
    curve = [];
    for (let i = 0; i <= 48; i++) curve.push(activity(seed, (from + ((to - from) * i) / 48) / CYCLE_S));
  }
  const hint = tier >= 1 ? ''
    : mods.forecastTier >= 1 ? 'Place a Solar Observatory in the sun: the ☉ chip then shows the next flare’s window and likely class.'
    : 'Heliophysics Forecasting and a Solar Observatory show the next flare’s window and likely class.';
  return {
    tier, tierName: TIER_NAME[tier], lead, live, blindWhy, blindS, source, next, cme, cycle, three, sentinel,
    aheadSet, canAhead, aheadWhy, popup, chip, chipShape,
    timeline: { from, to, now, nights, marks, curve, maxAt: maxAt !== null && maxAt >= from && maxAt <= to ? maxAt : null },
    hint,
  };
}

/** The weather view with its forecast: the chip, the NEXT block, the timeline, the ahead pop-up. */
export function withForecast(v: WeatherView, s: GameState, mods: Mods, site: SiteDef, day: DayInfo,
  ui: { ahead?: boolean; slider?: number } = {}): WeatherView {
  if (v.legacy) return v;
  const fv = forecastView(s, mods, site, day, v, ui);
  const out: WeatherView = { ...v, forecast: fv };
  if (fv.chip) { out.chip = fv.chip; out.chipShape = fv.chipShape; }
  return out;
}
