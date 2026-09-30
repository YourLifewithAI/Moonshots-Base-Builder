/** The survey-drone fleet (docs/19 S6). Map surveys are flown by drones now, never by a borrowed
 *  construction rover: the Lander carries one from landing, and a Prospecting Bay prints more into
 *  its bays (2, 4 or 6 a Bay by level, one print at a time). Every docked, charged drone is one
 *  survey under way: `s.survey.flights[]` holds them in parallel. This module is the fleet's
 *  bookkeeping (who exists, who is docked, prints, recharging); core/exploration.ts prices a
 *  survey, launches it, resolves it and pays its rewards, and world/surveyFlight.ts draws it. */
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { PROSPECTS } from '../data/lunarMap';
import type { SurveyDroneView, SurveyFleetView } from '../ui/stores';
import { fmtClock } from './daynight';
import { SURVEY_DRONE } from '../data/balance';
import type { ProspectId } from '../data/lunarMap';
import type { BuildingState, GameState, SurveyDrone, SurveyFlight } from './state';
import { modsFor, type Mods } from './mods';
import { alert } from './economy';
import { recordSpend } from './flowBook';

const BAY: BuildingId = 'prospectingBay';
const done = (b: { construction?: number }) => (b.construction ?? 0) <= 0;

/** the survey state's fleet lists, created on first use (an older save has none) */
export function fleetLists(s: GameState): { drones: SurveyDrone[]; flights: SurveyFlight[] } {
  const sv = s.survey;
  return { drones: (sv.surveyDrones ??= []), flights: (sv.flights ??= []) };
}

/** drone bays a completed Prospecting Bay holds at this level (Level I: 2, II: 4, III: 6) */
export function baysPerBay(mods: Pick<Mods, 'surveyBayLevel'>): number {
  return SURVEY_DRONE.baysByLevel[Math.max(1, Math.min(3, mods.surveyBayLevel)) - 1];
}

/** the buildings drones dock at, with their bays: the Lander (one) and each completed Prospecting Bay */
export function docks(s: GameState, mods: Pick<Mods, 'surveyBayLevel'>): { b: BuildingState; bays: number }[] {
  const out: { b: BuildingState; bays: number }[] = [];
  for (const b of s.buildings) {
    if (b.type === 'lander') out.push({ b, bays: 1 });
    else if (b.type === BAY && done(b)) out.push({ b, bays: baysPerBay(mods) });
  }
  return out;
}

/** how many drones the docks can hold now */
export const fleetCap = (s: GameState, mods: Pick<Mods, 'surveyBayLevel'>) => docks(s, mods).reduce((n, d) => n + d.bays, 0);

/** flying: it is on a flight */
export const isOut = (s: GameState, id: number) => (s.survey.flights ?? []).some((f) => f.drone === id);
/** charged: a full pack (absent: full) */
export const isCharged = (d: SurveyDrone) => d.charge === undefined || d.charge >= 1 - 1e-9;
/** docked and charged: it can fly now */
export const isReady = (s: GameState, d: SurveyDrone) => isCharged(d) && !isOut(s, d.id);

/** the drone that would fly next: the lowest id that is docked and charged */
export function readyDrone(s: GameState): SurveyDrone | null {
  const { drones } = fleetLists(s);
  return drones.filter((d) => isReady(s, d)).sort((a, b) => a.id - b.id)[0] ?? null;
}

/** what the fleet is doing, for the refusal text and the fleet panel */
export interface FleetCount { total: number; ready: number; out: number; charging: number; cap: number; printing: number }
export function fleetCount(s: GameState, mods: Pick<Mods, 'surveyBayLevel'>): FleetCount {
  const { drones, flights } = fleetLists(s);
  const out = flights.filter((f) => drones.some((d) => d.id === f.drone)).length;
  const ready = drones.filter((d) => isReady(s, d)).length;
  return {
    total: drones.length, ready, out, charging: drones.length - out - ready,
    cap: fleetCap(s, mods), printing: (s.survey.prints ?? []).length,
  };
}

/** game-seconds until a drone can fly again (0: one is ready now; Infinity: no drone at all) */
export function nextReadyIn(s: GameState): number {
  const { drones, flights } = fleetLists(s);
  let best = Infinity;
  for (const d of drones) {
    const f = flights.find((x) => x.drone === d.id);
    const rest = (1 - (d.charge ?? 1)) * SURVEY_DRONE.rechargeS;
    const t = f ? Math.max(0, f.endsAt - s.simTime) + SURVEY_DRONE.rechargeS : rest;
    best = Math.min(best, t);
  }
  return best;
}

/** Keep the roster true to the docks. The Lander's drone exists from landing; a drone whose Bay is
 *  gone moves to any dock with a bay free, or is lost (a docked one; a flying one comes home first);
 *  an older save's rover survey becomes a flight (the schema 0 → 1 migration). */
export function ensureFleet(s: GameState, mods: Pick<Mods, 'surveyBayLevel'>) {
  const sv = s.survey;
  const { drones, flights } = fleetLists(s);
  sv.nextSurveyDrone ??= 1 + drones.reduce((n, d) => Math.max(n, d.id), 0);
  sv.prints ??= [];
  const dk = docks(s, mods);
  const lander = dk.find((d) => d.b.type === 'lander');
  const bayOf = new Map(dk.map((d) => [d.b.id, d.bays]));
  // homes in the building set: fewest homes first is not needed, ids are stable
  const held = new Map<number, number>();
  const orphans: SurveyDrone[] = [];
  for (const d of [...drones].sort((a, b) => a.id - b.id)) {
    const room = bayOf.get(d.home);
    if (room !== undefined && (held.get(d.home) ?? 0) < room) held.set(d.home, (held.get(d.home) ?? 0) + 1);
    else orphans.push(d);
  }
  for (const d of orphans) {
    const free = dk.find((x) => (held.get(x.b.id) ?? 0) < x.bays);
    if (free) { d.home = free.b.id; held.set(free.b.id, (held.get(free.b.id) ?? 0) + 1); continue; }
    // nowhere to dock: a docked drone is lost, a flying one is kept until it lands (then trimmed)
    if (!flights.some((f) => f.drone === d.id)) drones.splice(drones.indexOf(d), 1);
  }
  // the Lander carries one from landing
  if (lander && !drones.some((d) => d.home === lander.b.id)) {
    drones.push({ id: sv.nextSurveyDrone++, home: lander.b.id });
    drones.sort((a, b) => a.id - b.id);
  }
  // the migration: a rover survey from before the fleet flies on as a drone's flight, on the same clock
  if (sv.active) {
    const a = sv.active;
    sv.active = null;
    const d = readyDrone(s) ?? drones.find((x) => !flights.some((f) => f.drone === x.id));
    if (d) flights.push({ drone: d.id, id: a.id, startedAt: a.startedAt, endsAt: a.endsAt });
  }
  sv.surveySchema = 1;
  // a print at a Bay that no longer stands is lost
  sv.prints = sv.prints.filter((p) => bayOf.has(p.bay));
  // a flight whose drone was lost keeps its clock and pays out (the drone id may be gone: nothing to recharge)
}

/** Save migration `surveySchema` 0 → 1 (docs/19 S6, called by Game.loadFrom): the Lander gets its
 *  drone, and a rover survey in flight completes as if a drone had flown it (same clock, same
 *  prospect). The lent rover simply rejoins the fleet: `survey.active` is null from here on. */
export function migrateSurveySchema(s: GameState) {
  if ((s.survey.surveySchema ?? 0) >= 1 && s.survey.surveyDrones) return;
  ensureFleet(s, modsFor(s));
}

/** Prints and recharging (every economy tick, step 8.7). A completed, enabled Bay prints one drone at a
 *  time into a free bay, paying at the start: it waits, quietly, for the goods. */
export function fleetTick(s: GameState, mods: Mods, dt: number) {
  ensureFleet(s, mods);
  const { drones } = fleetLists(s);
  const prints = s.survey.prints!;
  // a drone home from a flight recharges at the dock
  for (const d of drones) {
    if (isOut(s, d.id) || isCharged(d)) continue;
    d.charge = Math.min(1, (d.charge ?? 0) + dt / SURVEY_DRONE.rechargeS);
  }
  // prints finish
  for (const p of [...prints]) {
    if (s.simTime < p.endsAt) continue;
    prints.splice(prints.indexOf(p), 1);
    const id = s.survey.nextSurveyDrone!++;
    drones.push({ id, home: p.bay });
    const c = fleetCount(s, mods);
    alert(s, `SURVEY DRONE PRINTED — ${c.total}/${c.cap} bays · ${c.ready} ready`, 'info', { building: p.bay }, 'field');
  }
  // a Bay with a free bay prints the next
  for (const { b, bays } of docks(s, mods)) {
    if (b.type !== BAY || !b.enabled || prints.some((p) => p.bay === b.id)) continue;
    const homed = drones.filter((d) => d.home === b.id).length;
    if (homed >= bays) continue;
    const c = SURVEY_DRONE.cost;
    if (s.resources.metals < c.metals || s.resources.parts < c.parts) continue;
    s.resources.metals -= c.metals;
    s.resources.parts -= c.parts;
    recordSpend(s, c);
    prints.push({ bay: b.id, startedAt: s.simTime, endsAt: s.simTime + SURVEY_DRONE.printS });
  }
}

/** A flight begins: drone `d` flies to `pid` and is back at `endsAt`. */
export function launchFlight(s: GameState, d: SurveyDrone, pid: ProspectId, timeS: number): SurveyFlight {
  const f: SurveyFlight = { drone: d.id, id: pid, startedAt: s.simTime, endsAt: s.simTime + timeS };
  fleetLists(s).flights.push(f);
  d.charge = 0;
  return f;
}

/** A flight ends: the drone is docked again, its pack empty. */
export function landFlight(s: GameState, f: SurveyFlight) {
  const { drones, flights } = fleetLists(s);
  flights.splice(flights.indexOf(f), 1);
  const d = drones.find((x) => x.id === f.drone);
  if (d) d.charge = 0;
}

/** the world flight and the fleet panel read the flight of a prospect */
export const flightTo = (s: GameState, pid: ProspectId) => (s.survey.flights ?? []).find((f) => f.id === pid);

// ─────────────────────────── the fleet panel's view ───────────────────────────

const nameOf = (b: BuildingState | undefined) => (b ? `${BUILDINGS[b.type].name} #${b.id}` : '—');

/** the $fleet.survey payload: every drone, the prints under way, and the one-line summary */
export function surveyFleetView(s: GameState, mods: Mods): SurveyFleetView {
  const { drones, flights } = fleetLists(s);
  const at = new Map(s.buildings.map((b) => [b.id, b]));
  const out = flights.filter((f) => drones.some((d) => d.id === f.drone));
  const list: SurveyDroneView[] = [...drones].sort((a, b) => a.id - b.id).map((d) => {
    const f = flights.find((x) => x.drone === d.id);
    const state = f ? 'out' : isCharged(d) ? 'ready' : 'charging';
    return {
      id: d.id, home: d.home, homeName: nameOf(at.get(d.home)), state, charge: f ? 0 : Math.min(1, d.charge ?? 1),
      prospect: f ? f.id : null, name: f ? PROSPECTS[f.id].short : '', remaining: f ? Math.max(0, Math.ceil(f.endsAt - s.simTime - 1e-6)) : 0,
    };
  });
  const c = fleetCount(s, mods);
  const bays = s.buildings.filter((b) => b.type === BAY && done(b)).length;
  const legs = [...out].sort((a, b) => a.endsAt - b.endsAt)
    .map((f) => `${PROSPECTS[f.id].short} ${fmtClock(Math.max(0, Math.ceil(f.endsAt - s.simTime - 1e-6)))}`);
  const line = c.total === 0 ? 'no drones' : `${c.total - out.length}/${c.total} docked${out.length ? ` · ${out.length} out → ${legs.join(', ')}` : ''}`;
  return {
    total: c.total, ready: c.ready, out: out.length, charging: c.charging, cap: c.cap, bays, level: mods.surveyBayLevel,
    baysEach: baysPerBay(mods), drones: list,
    prints: (s.survey.prints ?? []).map((p) => ({ bay: p.bay, name: nameOf(at.get(p.bay)), left: Math.max(0, Math.ceil(p.endsAt - s.simTime - 1e-6)) })),
    line,
  };
}
