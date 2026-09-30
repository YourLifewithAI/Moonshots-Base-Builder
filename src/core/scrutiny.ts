/** The Vanguard's scrutiny meter and the faction buildings' small effects (docs/20 S2).
 *
 *  Scrutiny (`mods.scrutiny`, the Vanguard's landing tech): every death, every building wrecked and every hazard that
 *  starts raises a meter (SCRUTINY.death · wreck · hazard), which falls SCRUTINY.decayPerDay a lunar day (×2 under a
 *  standing Mission Ops). From 50 crewed stations' outputs are ×0.7 and research data ×0.8 (`scrutinyPenalty`, read
 *  through effectiveRates' `crewedMult` / `dataMult`); at 80 HEARINGS: a quarter of the crew (rounded up, never the
 *  last one) is recalled to Earth for two lunar days through the existing rotation (`s.crewRotation` with `recall`,
 *  which economy's crewRotationTick brings back), the meter drops to 40, and there is at most one hearing in three
 *  days. A hearing is an alert and, on a Moon, a `hearing` feed event (docs/20 §4.5). Rivals run the same code: a
 *  base only has a meter when its own mods say so, so a solo game and every other faction carry no state at all.
 *
 *  The faction buildings are defined by stream S3 (`faradayShed`, `nightVault`, `missionOps`, `skunkworks`); their
 *  effects are read here by id string, so this compiles with or without them: `countOf`, `shedCover`,
 *  `nightVaultStanding`, `uplinkBonus`. */
import { CYCLE_S, FARADAY, SCRUTINY } from '../data/balance';
import { FACTION_NAME } from '../data/factions';
import { centerOf } from '../buildings/instances';
import type { GameState, ScrutinyState } from './state';
import type { Mods } from './mods';
import { alertIn } from './economy';
import { moonOf, pushFeed } from './moon';
import { fmtClock } from './daynight';

/** every alert here is a hazard-family one (an accident's consequence, docs/19 S7) */
const alert = alertIn('hazard');

// ─────────────────────────── standing faction buildings ───────────────────────────

/** Standing (built, not a wreck) buildings of a type, by id string: S3's faction buildings may not exist yet. */
export function countOf(s: Pick<GameState, 'buildings'>, type: string): number {
  let n = 0;
  for (const b of s.buildings) if ((b.type as string) === type && !((b.construction ?? 0) > 0) && !b.wreck) n++;
  return n;
}

/** Faraday Sheds (docs/20 §1): null when none stands; else `f(x, z)` = ×0.4 within 40 m of a standing shed, else 1. A
 *  machine's or an array's flare damage and draw probabilities are multiplied by it. */
export function shedCover(s: Pick<GameState, 'buildings'>): ((x: number, z: number) => number) | null {
  const pts: [number, number][] = [];
  for (const b of s.buildings) {
    if ((b.type as string) !== 'faradayShed' || (b.construction ?? 0) > 0 || b.wreck) continue;
    pts.push(centerOf(b));
  }
  if (!pts.length) return null;
  return (x, z) => (pts.some(([sx, sz]) => Math.hypot(sx - x, sz - z) <= FARADAY.radiusM) ? FARADAY.mult : 1);
}

/** A Night Vault stands: docked units hibernate at night (unitPower.hibernating; economy step 2). */
export const nightVaultStanding = (s: Pick<GameState, 'buildings'>): boolean => countOf(s, 'nightVault') > 0;

/** Mission Ops: one more lab at full uplink weight (research.uplinkShare's `bonus`). */
export const uplinkBonus = (s: Pick<GameState, 'buildings'>): 0 | 1 => (countOf(s, 'missionOps') > 0 ? 1 : 0);

// ─────────────────────────── the meter ───────────────────────────

const fresh = (): ScrutinyState => ({ value: 0, tier: 0, hearingsUntil: 0, lastHearingAt: -1e9, log: [] });

/** Raise the meter (a death, a wreck, a hazard starting). Nothing on a base that has none. */
export function scrutinyAdd(s: GameState, amount: number, why: string): void {
  const sc = s.scrutiny;
  if (!sc || amount <= 0) return;
  sc.value = Math.min(SCRUTINY.max, sc.value + amount);
  sc.log.push({ at: s.simTime, text: why, value: Math.round(sc.value * 10) / 10 });
  if (sc.log.length > SCRUTINY.logMax) sc.log.splice(0, sc.log.length - SCRUTINY.logMax);
}

/** What the meter takes off a second: SCRUTINY.decayPerDay a lunar day, ×2 with a standing Mission Ops, and × Press Corps'
 *  `mods.scrutinyDecayMult` (1.5; it stacks with the Mission Ops: ×3 with both; ×1 where no tech tunes it). */
export function decayPerSecond(s: Pick<GameState, 'buildings'>, mods?: Partial<Pick<Mods, 'scrutinyDecayMult'>>): number {
  return (SCRUTINY.decayPerDay / CYCLE_S) * (countOf(s, 'missionOps') > 0 ? SCRUTINY.missionOpsDecay : 1) * (mods?.scrutinyDecayMult ?? 1);
}

/** The penalties at this meter: crewed stations' outputs × and research data ×, or null below the threshold (and with
 *  no meter: every other game). */
export function scrutinyPenalty(s: Pick<GameState, 'scrutiny'>): { crewed: number; data: number } | null {
  const sc = s.scrutiny;
  return sc && sc.value >= SCRUTINY.penaltyAt ? { crewed: SCRUTINY.crewedMult, data: SCRUTINY.dataMult } : null;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Economy step 8.35: the thresholds (on the meter as the tick's events left it), the hearing, then the decay. */
export function scrutinyTick(s: GameState, mods: Mods, dt: number): void {
  if (!mods.scrutiny) return;
  const sc = (s.scrutiny ??= fresh());
  const now = s.simTime;
  const tier = (v: number): 0 | 1 | 2 => (v >= SCRUTINY.hearingAt ? 2 : v >= SCRUTINY.penaltyAt ? 1 : 0);
  const was = sc.tier ?? 0;
  const at = tier(sc.value);
  const name = FACTION_NAME[s.faction ?? 'accelerationists'].toUpperCase();
  const gap = SCRUTINY.hearingGapDays * CYCLE_S;
  const due = at === 2 && now - sc.lastHearingAt >= gap;
  if (at > was) {
    const v = Math.round(sc.value);
    if (at === 1) {
      alert(s, `SCRUTINY ${v} — the press is watching: crewed stations ×${SCRUTINY.crewedMult}, research ×${SCRUTINY.dataMult} until it falls under ${SCRUTINY.penaltyAt}`,
        'warn', { panel: 'crew' });
    } else {
      alert(s, `SCRUTINY ${v} — ${due ? `${name} IS CALLED BEFORE CONGRESS: hearings now` : `over ${SCRUTINY.hearingAt}, but the last hearing was under ${SCRUTINY.hearingGapDays} days ago`}`,
        'warn', { panel: 'crew' });
    }
  }
  if (due) hearing(s, sc, name, mods);
  sc.tier = tier(sc.value);
  if (sc.value > 0) sc.value = Math.max(0, sc.value - decayPerSecond(s, mods) * dt);
}

/** HEARINGS: a quarter of the crew (rounded up; one always stays: the last crew member is never recalled) goes to Earth for
 *  two lunar days, the meter drops to 40. Hearing Prep (`mods.scrutinyRecallMult`, 0.5) halves the share. */
function hearing(s: GameState, sc: ScrutinyState, name: string, mods?: Partial<Pick<Mods, 'scrutinyRecallMult'>>): void {
  const now = s.simTime;
  const recallMult = mods?.scrutinyRecallMult ?? 1;
  const n = Math.min(Math.ceil(s.crew * SCRUTINY.recallShare * recallMult), Math.max(0, s.crew - 1));
  const days = SCRUTINY.recallDays;
  sc.lastHearingAt = now;
  sc.value = SCRUTINY.hearingTo;
  sc.hearingsUntil = now + days * CYCLE_S;
  sc.log.push({ at: now, text: 'HEARINGS', value: sc.value });
  if (sc.log.length > SCRUTINY.logMax) sc.log.splice(0, sc.log.length - SCRUTINY.logMax);
  if (n > 0) {
    s.crew -= n;
    // the existing rotation machinery brings them back (economy.crewRotationTick); one already waiting takes them in
    const rot = s.crewRotation;
    s.crewRotation = rot
      ? { at: Math.max(rot.at, sc.hearingsUntil), count: rot.count + n, recall: true }
      : { at: sc.hearingsUntil, count: n, recall: true };
  }
  alert(s, `HEARINGS — ${name} BEFORE CONGRESS: ${n > 0 ? `${plural(n, 'crew member')} recalled to Earth for ${days} lunar days` : 'nobody can be spared to go'} · scrutiny back to ${SCRUTINY.hearingTo}`,
    'crit', { panel: 'crew' });
  const moon = moonOf(s);
  if (moon) {
    const what = recallMult === 1 ? 'a quarter of the crew recalled' : `${plural(n, 'crew member')} recalled`;
    pushFeed(moon, { faction: s.faction ?? 'accelerationists', kind: 'hearing', text: `${name} BEFORE CONGRESS — ${what}`, n });
  }
}

/** FIRST LIGHT (economy.launchVolley, the base's first volley; docs/20 S3's Media Blitz): clears the meter and lifts morale
 *  by `mods.firstLightMorale` for a lunar day (economy's morale target reads `moraleUntil`). Nothing where no tech asks for
 *  either (every solo game, every other faction), and nothing on a base with no meter. fs6 extends it for the race. */
export function onFirstLight(s: GameState, mods: Pick<Mods, 'scrutiny' | 'firstLightClearsScrutiny' | 'firstLightMorale'>): void {
  const sc = s.scrutiny;
  if (!mods.scrutiny || !sc) return;
  const said: string[] = [];
  if (mods.firstLightClearsScrutiny && sc.value > 0) {
    sc.value = 0;
    sc.tier = 0;
    sc.log.push({ at: s.simTime, text: 'FIRST LIGHT', value: 0 });
    if (sc.log.length > SCRUTINY.logMax) sc.log.splice(0, sc.log.length - SCRUTINY.logMax);
    said.push('the scrutiny meter is cleared');
  }
  if (mods.firstLightMorale > 0) {
    sc.moraleUntil = s.simTime + CYCLE_S;
    said.push(`+${mods.firstLightMorale} morale for a lunar day`);
  }
  if (said.length) alert(s, `FIRST LIGHT — the press is at the window: ${said.join(', ')}`, 'info', { panel: 'crew' });
}

// ─────────────────────────── what the UI reads ───────────────────────────

export interface ScrutinyView {
  value: number;
  tier: 0 | 1 | 2;
  penaltyAt: number;
  hearingAt: number;
  /** points a lunar day, and whether a Mission Ops is doubling it */
  decayPerDay: number;
  missionOps: boolean;
  /** game-seconds until the meter falls under the threshold below its tier (under the penalty at 50 when in tier 1; under 80 in tier 2; clear in tier 0), and that threshold (0 = clear) */
  toNextS: number | null;
  nextAt: number;
  /** crew away at the hearings, and the seconds until they are back (0 when none) */
  recalled: number;
  backInS: number;
  /** seconds until another hearing may be held (0 when one may) */
  nextHearingS: number;
}

/** The meter for the info panel and the tests; null where none runs (no `mods`: where none has been created). */
export function scrutinyView(s: GameState, mods?: Pick<Mods, 'scrutiny'> & Partial<Pick<Mods, 'scrutinyDecayMult'>>): ScrutinyView | null {
  if (mods && !mods.scrutiny) return null;
  const sc = s.scrutiny ?? (mods ? fresh() : undefined);
  if (!sc) return null;
  const tier: 0 | 1 | 2 = sc.value >= SCRUTINY.hearingAt ? 2 : sc.value >= SCRUTINY.penaltyAt ? 1 : 0;
  const rate = decayPerSecond(s, mods);
  const nextAt = tier === 2 ? SCRUTINY.hearingAt : tier === 1 ? SCRUTINY.penaltyAt : 0;
  const rot = s.crewRotation;
  return {
    value: sc.value, tier, penaltyAt: SCRUTINY.penaltyAt, hearingAt: SCRUTINY.hearingAt,
    decayPerDay: rate * CYCLE_S, missionOps: countOf(s, 'missionOps') > 0,
    toNextS: sc.value > nextAt && rate > 0 ? (sc.value - nextAt) / rate : null,
    nextAt,
    recalled: rot?.recall ? rot.count : 0,
    backInS: rot?.recall ? Math.max(0, rot.at - s.simTime) : 0,
    nextHearingS: Math.max(0, sc.lastHearingAt + SCRUTINY.hearingGapDays * CYCLE_S - s.simTime),
  };
}

/** `fmtClock` of the seconds to the next tier, for one line of text ('' when it is not falling). */
export const untilText = (v: ScrutinyView): string => (v.toNextS === null ? '' : fmtClock(v.toNextS));
