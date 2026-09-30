/** What a flare costs beyond the arrays (docs/16 §4, phase F2b). weatherTick
 *  (core/spaceWeather.ts) calls it at the flare's moments; the economy, the
 *  fleet, research and the explorers read its per-tick hooks.
 *
 *  - σ, a thing's shield (§4.1): the lava tube's for what lives in it, a
 *    dock's for the machine parked in it, and a stand-in for the shields F4
 *    brings (WEATHER_STUB.sigma). Prepared: a structure shut down or off, a
 *    machine docked, an excavator parked.
 *  - Rad scars and capability (§4.13): each second of the protons is counted
 *    as exposed or prepared, and at the end of the flash and of the tail every
 *    structure with an output, rate or capacity and every machine loses
 *    capability: the class's rate × (1 − σ)² × (a tenth if prepared) ×
 *    hardening. For good, down to 10%; Replace and Re-print (§4.14) clear it.
 *  - Machines (§4.5): rovers and drones, hub units (docs/17) and a legacy
 *    pad's excavator. Each draws once as the protons arrive (after the bit
 *    flips) and again, as a C, in an X's tail: reboots, latch-ups (bricked,
 *    re-flashed at the dock or bay, lost at 480 s) and burn-outs (lost). A
 *    docked machine only reboots. Hubs recall their own units on M and X;
 *    Recall machines docks every machine that can make it home.
 *  - Crew indoors (§4.4); labs and the head tech, Checkpoint (§4.6); Chip Fabs
 *    and compute, Shut down exposed (§4.7); the comms blackout (§4.8); wear (§4.9).
 *
 *  Pure and deterministic: each machine's draw is mulberry32((seed ^ 0x5f1e) + n·4096 + id). */
import { BUILDINGS, isCompute, type BuildingId } from '../data/buildings';
import { CYCLE_S, DEPOSIT_FX } from '../data/balance';
import { TECHS } from '../data/techs';
import { RESOURCES, type ResourceId } from '../data/resources';
import {
  FLARE_EFFECTS as E, SPACE_WEATHER as W, type FlareClass, type FlareCounterId, type FlareKey,
} from '../data/spaceWeather';
import type { SiteDef } from '../data/sites';
import type { AlertCounter, BuildingState, FlareLogEntry, GameState, Hauler, RoverUnit } from './state';
import { effectiveDef, effectiveRates, type Mods } from './mods';
import { alertIn, condition } from './economy';
import { fmtClock } from './daynight';
import { mulberry32 } from './rng';
import { attachCounters, occupancy, pressurizedTypes } from './hazards';
import { reachS, siteEntry } from './fleet';
import { instantOf } from './simMode';
import { buildCostAt } from './automation';
import { techCost } from './research';
import { hubName, hubOf, jobCost, jobTime, recallUnit, targetOf, tripTo, unitTag } from './hubs';
import { HUB } from '../data/hubs';
import { centerOf } from '../buildings/instances';
import { WEATHER_STUB, flareStorm } from './spaceWeather';
import { shedCover } from './scrutiny';

/** every alert here belongs to one notification family (docs/19 S7) */
const alert = alertIn('weather');

const isSite = (b: { construction?: number }) => (b.construction ?? 0) > 0;
const label = (b: BuildingState) => `${BUILDINGS[b.type].name} #${b.id}`;
const plural = (n: number, w: string, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const costText = (c: Partial<Record<ResourceId, number>>) =>
  Object.entries(c).filter(([, v]) => (v ?? 0) > 0).map(([r, v]) => `${v}${RESOURCES[r as ResourceId].glyph}`).join(' ');

export interface EffectResult { ok: boolean; reason: string }
const OK: EffectResult = { ok: true, reason: '' };
const no = (reason: string): EffectResult => ({ ok: false, reason });

// ─────────────────────────── σ and who scars (§4.1, §4.13) ───────────────────────────

/** What lives in the lava tube (§3.6): the pressurized halls, labs, compute, fabs and the Lander's cabin. */
const TUBE_TYPES: readonly BuildingId[] = ['lander', 'lab', 'dataCenter', 'serverMonolith', 'chipFab', 'partsFab'];

/** A structure's shield σ, 0..1: the best of its sources (the tube's 1; F4's berms and water walls through the stand-in). */
export function sigmaOf(s: GameState, mods: Mods, site: SiteDef, b: BuildingState): number {
  if (site.tubeShelter && (TUBE_TYPES.includes(b.type) || pressurizedTypes(mods).has(b.type))) return 1;
  void s;
  return Math.max(0, Math.min(1, WEATHER_STUB.sigma));
}

/** A structure that carries capability: a rated output, rate or capacity (§4.13). Not the Lander (it never
 *  wears), not Solar Arrays (their own rows, §4.3), not homes, halls, yards, masts or docks. */
export function scarsOn(b: Pick<BuildingState, 'type'>): boolean {
  if (b.type === 'lander' || b.type === 'solar') return false;
  const d = BUILDINGS[b.type];
  return d.powerKW > 0 || (d.storageKWh ?? 0) > 0 || Object.keys(d.outputs).length > 0 || b.type === 'lab' || isCompute(b.type);
}

/** Rad-Hard Process hardens the silicon: labs, compute and Chip Fabs. */
const radHardOn = (b: Pick<BuildingState, 'type'>) => b.type === 'lab' || b.type === 'chipFab' || isCompute(b.type);

export const capOf = (x: { cap?: number }) => x.cap ?? 1;

/** The flare's column now: its class, or the tail's. */
const keyNow = (s: GameState): FlareKey => (s.flare.phase === 'tail' ? 'tail' : s.flare.cls ?? 'C');

// ─────────────────────────── machines ───────────────────────────

const awayOf = (r: RoverUnit) => r.site !== null || r.road !== undefined;

/** A rover or drone in the open (§4.5): out working, or still driving. */
export function inOpen(s: GameState, r: RoverUnit): boolean {
  if (awayOf(r)) return true;
  const t = r.trip;
  return !!t && (!!t.stuck || t.t < t.dur - 1e-9);
}

/** A reboot holds it where it stands: no driving, no work (core/transit.ts). */
export const rebooting = (s: Pick<GameState, 'simTime'>, r: { rebootUntil?: number }) => (r.rebootUntil ?? 0) > s.simTime;

/** An excavator's digger out working (not parked, off or dead): the only kind of structure that glitches. */
const diggerOut = (b: BuildingState) => b.type === 'excavator' && !isSite(b) && b.enabled && !b.flareShut && !b.burned;

const droneOf = (s: GameState, r: RoverUnit) => s.buildings.find((b) => b.id === r.home)?.type === 'droneHive';

/** Where a rover stands (world metres): where the sim has it, else at its dock. */
function roverAt(s: GameState, r: RoverUnit): [number, number] {
  if (r.x !== undefined && r.z !== undefined) return [r.x, r.z];
  const dock = s.buildings.find((b) => b.id === r.home);
  return dock ? centerOf(dock) : [0, 0];
}

/** A hub unit out of its bay (docs/17 §4.3): digging, driving, tipping; parked in its bay it is docked. */
export const unitOpen = (u: Hauler) => u.haul.phase !== 'park';

/** A hub unit lost to the flare: its bay is free; its hub prints another when asked. */
function loseUnit(s: GameState, u: Hauler, cause: string) {
  const b = hubOf(s, u);
  s.haulers = s.haulers.filter((x) => x.id !== u.id);
  const warnedAt = s.flare.startedAt ?? s.simTime;
  (s.losses ??= []).push({ at: s.simTime, what: 'building', name: `unit ${unitTag(u)}`, cause, hazard: 'flare', warnedAt });
  alert(s, `UNIT LOST — ${cause} · warned ${fmtClock(Math.max(0, s.simTime - warnedAt))} before; it was not in its bay` +
    (b ? ` · ${hubName(b)} prints a new one from its queue` : ''), 'crit', b ? { select: b.id } : undefined);
}

/** A machine lost to the flare, logged as a loss (docs/14 §3.10); a rover's dock prints its replacement. */
function loseRover(s: GameState, r: RoverUnit, cause: string) {
  const dock = s.buildings.find((b) => b.id === r.home);
  if (dock) dock.slotsLost = (dock.slotsLost ?? 0) + 1;
  s.rovers = s.rovers.filter((x) => x.id !== r.id);
  const drone = dock?.type === 'droneHive';
  const warnedAt = s.flare.startedAt ?? s.simTime;
  (s.losses ??= []).push({ at: s.simTime, what: drone ? 'drone' : 'rover', name: `${drone ? 'drone' : 'rover'} #${r.id}`, cause, hazard: 'flare', warnedAt });
  alert(s, `${drone ? 'DRONE' : 'ROVER'} LOST — ${cause} · warned ${fmtClock(Math.max(0, s.simTime - warnedAt))} before; it was not docked` +
    (dock ? ` · ${label(dock)} prints a replacement` : ''), 'crit', dock ? { select: dock.id } : undefined);
}

function burnDigger(s: GameState, b: BuildingState, cls: FlareClass, cause: string) {
  b.burned = { at: s.simTime, n: s.flare.n ?? 0, cls };
  delete b.latch; delete b.rebootUntil;
  if (b.haul) { b.haul.cargo = {}; b.haul.full = false; }
  const warnedAt = s.flare.startedAt ?? s.simTime;
  (s.losses ??= []).push({ at: s.simTime, what: 'building', name: `${label(b)}’s digger`, cause, hazard: 'flare', warnedAt });
  alert(s, `EXCAVATOR LOST — ${cause} · warned ${fmtClock(Math.max(0, s.simTime - warnedAt))} before; it was not parked · Re-print it in its inspector`,
    'crit', { select: b.id });
}

const tallyOf = (s: GameState): FlareLogEntry | undefined => s.flare.tally;

/** The machines' draw (§4.5): as the protons arrive ('flash', a second in, after the bit flips) and in an X's tail. */
export function drawMachines(s: GameState, site: SiteDef, mods: Mods, part: 'flash' | 'tail') {
  const f = s.flare;
  const cls = f.cls ?? 'C';
  const key: FlareKey = part === 'tail' ? 'tail' : cls;
  const drillX = cls === 'X' && !!f.drill;
  const n = f.n ?? 0;
  const M = E.machines;
  const rh = mods.guards.has('radHard') ? E.radHard : 1;
  const secs = mods.guards.has('watchdogs') ? Math.min(M.watchdogS, M.rebootS[key]) : M.rebootS[key];
  const now = s.simTime;
  const t = tallyOf(s);
  let rebooted = 0, latched = 0, lost = 0;
  // the Foundry's machines are more fragile (mods.machineFlareMult, each probability clamped to 1); a standing Faraday Shed
  // shields the machines within 40 m (docs/20 S2). Neutral: both 1, and the products below are then exactly the old ones.
  const vuln = mods.machineFlareMult;
  const shed = shedCover(s);
  const pick = (id: number, open: boolean, sigma: number, at?: readonly [number, number]): '' | 'reboot' | 'latch' | 'burn' => {
    const u = mulberry32((s.seed ^ W.keys.machine) + n * 4096 + id + (part === 'tail' ? 2048 : 0))();
    const k = vuln * (shed && at ? shed(at[0], at[1]) : 1);
    const scale = (p: number) => (k === 1 ? p : Math.min(1, p * k));
    const pBurn = open ? scale(M.burn[key] * rh) : 0;
    const pLatch = open ? scale(M.latch[key] * rh) : 0;
    const pReboot = scale(M.reboot[key] * (1 - sigma));
    const out = u < pBurn ? 'burn' : u < pBurn + pLatch ? 'latch' : u < pBurn + pLatch + pReboot ? 'reboot' : '';
    // the first X is a drill in its permanent parts (§4.11): what would burn out latches up
    return out === 'burn' && drillX ? 'latch' : out;
  };
  for (const r of [...s.rovers].sort((a, b) => a.id - b.id)) {
    const open = inOpen(s, r);
    const out = pick(r.id, open, open ? 0 : M.dockSigma, shed ? roverAt(s, r) : undefined);
    if (!out) continue;
    // the bit flips bricked it first (docs/16 §9.3): only a burn-out is worse
    if ((r.brickedUntil ?? 0) > 0 && out !== 'burn') continue;
    if (out === 'reboot') {
      r.rebootUntil = Math.max(r.rebootUntil ?? 0, now + secs);
      r.lastFlare = `rebooted ${fmtClock(secs)} in the ${cls}${part === 'tail' ? ' tail' : ''}`;
      rebooted++;
    } else if (out === 'latch') {
      r.brickedUntil = now + M.deadlineS;
      r.brickedBy = undefined;
      r.latch = { real: !drillX, n };
      r.site = null; r.pinned = false; delete r.road; delete r.rebootUntil;
      r.lastFlare = `latched up in the ${cls}`;
      latched++;
    } else {
      loseRover(s, r, `#${r.id} burned out in the ${cls} flare`);
      lost++;
    }
  }
  // hub units: out of their bays in the open; in a bay, the hub's dock σ
  for (const u of [...s.haulers]) {
    if (u.latch) continue;
    const open = unitOpen(u);
    const out = pick(700 + u.id, open, open ? 0 : M.dockSigma, shed ? [u.haul.x, u.haul.z] : undefined);
    if (part === 'flash' && open && E.machineWear[cls] > 0) u.wear = Math.min(1, u.wear + E.machineWear[cls]);
    if (!out) continue;
    if (out === 'reboot') {
      u.rebootUntil = Math.max(u.rebootUntil ?? 0, now + secs);
      // at M and X the job's work is lost: the bucket is dumped at its face
      if (key === 'M' || key === 'X') { u.haul.cargo = {}; u.haul.full = false; if (u.haul.phase === 'dig') u.haul.t = 0; }
      u.lastFlare = `rebooted ${fmtClock(secs)}${key === 'M' || key === 'X' ? ', its bucket dumped' : ''}`;
      rebooted++;
    } else if (out === 'latch') {
      // it drops its job and limps home in safe mode; its bay re-flashes it (§4.5)
      u.latch = { until: now + M.deadlineS, real: !drillX, n };
      u.haul.cargo = {}; u.haul.full = false;
      if (u.parked !== 'recalled') recallUnit(s, mods, u.id);
      u.lastFlare = `latched up in the ${cls}`;
      latched++;
    } else {
      loseUnit(s, u, `${unitTag(u)} burned out in the ${cls} flare`);
      lost++;
    }
  }
  // a legacy pad's excavator: a digger out working glitches as a rover in the open does; parked (powered off), it does not
  for (const b of s.buildings) {
    if (!diggerOut(b) || b.latch) continue;
    const out = pick(1400 + b.id, true, 0, shed ? centerOf(b) : undefined);
    if (part === 'flash' && E.machineWear[cls] > 0) b.wear = Math.min(1, b.wear + E.machineWear[cls]);
    if (!out) continue;
    if (out === 'reboot') {
      b.rebootUntil = Math.max(b.rebootUntil ?? 0, now + secs);
      // at M and X the job's work is lost: the bucket is dumped at its face
      if (key === 'M' || key === 'X') { if (b.haul) { b.haul.cargo = {}; b.haul.full = false; } }
      b.lastFlare = `rebooted ${fmtClock(secs)}${key === 'M' || key === 'X' ? ', its bucket dumped' : ''}`;
      rebooted++;
    } else if (out === 'latch') {
      b.latch = { until: now + M.deadlineS, real: !drillX, n };
      if (b.haul) { b.haul.cargo = {}; b.haul.full = false; }
      b.lastFlare = `latched up in the ${cls}`;
      latched++;
    } else {
      burnDigger(s, b, cls, `${label(b)}’s digger burned out in the ${cls} flare`);
      b.lastFlare = `burned out in the ${cls}`;
      lost++;
    }
  }
  if (t) { t.rebooted = (t.rebooted ?? 0) + rebooted; t.latched = (t.latched ?? 0) + latched; t.lost = (t.lost ?? 0) + lost; }
  if (rebooted + latched + lost > 0) {
    const bits = [rebooted ? `${rebooted} rebooted` : '', latched ? `${latched} latched up (re-flashed at their docks; lost at ${fmtClock(M.deadlineS)})` : '',
      lost ? `${lost} burned out` : ''].filter(Boolean);
    alert(s, `MACHINES — the ${cls}${part === 'tail' ? ' tail' : ' flare'}: ${bits.join(', ')}${drillX && latched ? ' · a drill: what would have burned out latched up' : ''}`,
      lost ? 'crit' : latched ? 'warn' : 'info', { panel: 'weather' });
  }
  void site;
}

// ─────────────────────────── the protons arrive (§4.4, §4.6, §4.7, §4.8, §4.9) ───────────────────────────

/** beginActive's second half: the blackout, crew indoors, the head tech, wear, an X's batch. */
export function onActiveStart(s: GameState, site: SiteDef, mods: Mods) {
  const f = s.flare;
  const cls = f.cls ?? 'C';
  const now = s.simTime;
  const t = tallyOf(s);
  f.scarEx = {};
  f.drawn = false;
  // the comms blackout: the Earth dish is on the surface, even in the tube
  const bl = E.blackout[cls];
  if (bl > 0) {
    f.blackoutUntil = Math.max(f.blackoutUntil ?? 0, now + bl);
    if (t) t.blackoutS = bl;
    alert(s, `COMMS DARK — the ${cls} flare’s blackout for ${fmtClock(bl)}: Earth shipments hold, streams buffer, no downlink`, 'warn', { panel: 'weather' });
  }
  // crew indoors: at an X a share of each home is sick, never lethal, never feeding the EVA dose
  if (cls === 'X' && s.crew > 0 && s.hazards) {
    const occ = occupancy(s, mods);
    const homes = s.buildings.filter((b) => ((effectiveDef(b.type, mods).housing ?? 0) > 0) && (occ.get(b.id) ?? 0) > 0)
      .sort((a, b) => a.id - b.id);
    const shelters = mods.guards.has('stormShelters');
    const q = homes.map((b) => ({ id: b.id, q: (occ.get(b.id) ?? 0) * E.sick.share * (shelters ? 0 : 1 - sigmaOf(s, mods, site, b)) }));
    let sick = q.reduce((m, x) => m + Math.floor(x.q), 0);
    const rem = q.reduce((m, x) => m + (x.q % 1), 0);
    if (rem >= 0.5 - 1e-9) sick += 1;
    sick = Math.min(sick, s.crew);
    if (sick > 0) {
      s.hazards.sick.push({ n: sick, until: now + E.sick.days * CYCLE_S });
      if (t) t.sick = sick;
      alert(s, `SICK BAY — ${plural(sick, 'crew member')} sick from the X flare’s protons: off work ½ lunar day · never lethal indoors`, 'warn', { panel: 'crew' });
    }
  }
  // the head tech loses progress (M, X), unless checkpointed
  const loss = E.headLoss[cls];
  const head = s.researchQueue?.[0];
  if (loss > 0 && head && !f.checkpoint) {
    const stations = s.buildings.filter((b) => (b.type === 'lab' || isCompute(b.type)) && b.active);
    let wsum = 0, wsig = 0;
    for (const b of stations) {
      const w = Math.max(1e-6, effectiveRates(b.type, mods, site, b).data);
      wsum += w; wsig += w * sigmaOf(s, mods, site, b);
    }
    const spent = s.researchSpent[head] ?? 0;
    if (stations.length && spent > 0) {
      const lostData = Math.min(spent, loss * techCost(head, s).data * (1 - wsig / wsum));
      if (lostData >= 0.5) {
        s.researchSpent[head] = spent - lostData;
        if (t) { t.researchLost = Math.round(lostData); t.researchTech = TECHS[head].name; }
        alert(s, `RESEARCH SET BACK — the flare corrupted ${Math.round(lostData)}≡ of ${TECHS[head].name} (${pct(lostData / techCost(head, s).data)}) · Checkpoint next time`,
          'warn', { panel: 'weather' });
      }
    }
  }
  // wear: every running structure (the arrays have their own damage)
  const w = E.wear[cls];
  if (w > 0) {
    for (const b of s.buildings) {
      if (!b.active || isSite(b) || b.wreck || b.type === 'solar' || b.type === 'lander' || b.type === 'excavator') continue;
      b.wear = Math.min(1, b.wear + w * (1 - sigmaOf(s, mods, site, b)));
    }
  }
  // an X scraps the batch in every running Chip Fab: 60 s of its output
  if (cls === 'X') {
    const rh = mods.guards.has('radHard') ? E.radHard : 1;
    let chips = 0;
    for (const b of s.buildings) {
      if (b.type !== 'chipFab' || !b.active) continue;
      chips += (effectiveRates(b.type, mods, site, b).outputs.chips ?? 0) * E.batchS * (1 - sigmaOf(s, mods, site, b)) * rh;
    }
    chips = Math.min(chips, s.resources.chips);
    if (chips > 0.05) {
      s.resources.chips -= chips;
      if (t) t.chipsLost = Math.round(chips * 10) / 10;
      alert(s, `BATCH SCRAPPED — the X flare ruined ${chips.toFixed(1)}▣ in the Chip Fabs · Shut down exposed next time`, 'warn', { panel: 'chips' });
    }
  }
}

// ─────────────────────────── per tick ───────────────────────────

/** The comms blackout (§4.8): Earth traffic holds, the downlink and Call home wait, streams buffer. */
export function commsDark(s: Pick<GameState, 'flare' | 'simTime'> & { weather?: GameState['weather'] }): boolean {
  return !s.weather?.legacy && (s.flare?.blackoutUntil ?? 0) > s.simTime;
}

/** Earth Teleoperation's build speed is lost in the blackout: welding × this. */
export function weldFlareMult(s: GameState): number {
  return commsDark(s) && s.techsDone.includes('teleoperation') ? E.teleop : 1;
}

/** Research transfers held: Checkpoint, from the protons to the flare's end (§4.6). */
export const researchHeld = (s: GameState) => !!s.flare?.checkpoint && flareStorm(s);

/** Labs, Chip Fabs and compute while the protons are in: output or data × this (§4.6, §4.7). */
export function flareOutputMult(s: GameState, mods: Mods, site: SiteDef, b: BuildingState): number {
  if (s.weather?.legacy || !flareStorm(s)) return 1;
  const key = keyNow(s);
  const one = (loss: number) => 1 - loss * (1 - sigmaOf(s, mods, site, b));
  const rh = mods.guards.has('radHard') ? E.radHard : 1;
  switch (b.type) {
    case 'lab': return one(E.labs[key]);
    case 'chipFab': return one(E.chips[key] * rh);
    case 'dataCenter': case 'serverMonolith': return one((1 - E.compute[key]) * rh);
    default: return 1;
  }
}

/** Why a flare holds an excavator offline ('' = it runs): rebooting, latched up, burned out. */
export function flareOff(s: GameState, b: BuildingState): string {
  if (b.burned) return `BURNED OUT — its digger was lost in the ${b.burned.cls} flare · Re-print it`;
  if (b.latch) return `LATCHED UP — safe mode, re-flashing over the Lander’s link · ${b.latch.real ? 'lost' : 're-flashed from Earth'} in ${fmtClock(Math.max(0, b.latch.until - s.simTime))}`;
  if (rebooting(s, b)) return `REBOOTING — back in ${fmtClock(b.rebootUntil! - s.simTime)}`;
  return '';
}

/** The mean capability of a site's welders (weld and sinter × it). */
export function teamCap(team: readonly RoverUnit[]): number {
  return team.length ? team.reduce((m, r) => m + capOf(r), 0) / team.length : 1;
}

/** Each second of the protons: exposed or prepared, for the scars. */
function tallyScars(s: GameState) {
  const f = s.flare;
  const ex = (f.scarEx ??= {});
  for (const b of s.buildings) {
    if (!scarsOn(b) || isSite(b) || b.wreck || b.burned) continue;
    const e = ex[`b${b.id}`] ?? (ex[`b${b.id}`] = [0, 0]);
    e[!b.enabled || b.flareShut ? 1 : 0] += 1;
  }
  for (const r of s.rovers) {
    const e = ex[`r${r.id}`] ?? (ex[`r${r.id}`] = [0, 0]);
    e[inOpen(s, r) ? 0 : 1] += 1;
  }
  for (const u of s.haulers) {
    const e = ex[`h${u.id}`] ?? (ex[`h${u.id}`] = [0, 0]);
    e[unitOpen(u) ? 0 : 1] += 1;
  }
}

// ─────────────────────────── rad scars (§4.13) ───────────────────────────

/** The flash or the tail has passed: every exposed structure and machine loses capability. */
export function resolveScars(s: GameState, site: SiteDef, mods: Mods, part: 'flash' | 'tail') {
  const f = s.flare;
  const cls = f.cls ?? 'C';
  const drillX = cls === 'X' && !!f.drill;
  // the first X scars as an M (§4.11); the tail its own
  const rate = E.scar[part === 'tail' ? 'tail' : drillX ? 'M' : cls];
  const ex = f.scarEx ?? {};
  const rh = mods.guards.has('radHard') ? E.radHard : 1;
  const t = tallyOf(s);
  const shed = shedCover(s); // a machine within 40 m of a standing Faraday Shed scars ×0.4 (docs/20 S2)
  let nB = 0, sumB = 0, nM = 0, sumM = 0;
  const crossed: string[] = [];
  const scar = <T extends { cap?: number; scars?: number; capWarned?: boolean }>(x: T, cut: number, name: string, fix: string): number => {
    if (cut <= 1e-9) return 0;
    const before = capOf(x);
    x.cap = Math.max(E.capFloor, before * (1 - cut));
    if (part === 'flash') x.scars = (x.scars ?? 0) + 1;
    if (!x.capWarned && before >= E.alertAt && x.cap < E.alertAt) { x.capWarned = true; crossed.push(`${name}|${fix}`); }
    return before - x.cap;
  };
  const byId = new Map(s.buildings.map((b) => [b.id, b]));
  for (const [k, [open, prep]] of Object.entries(ex)) {
    const tot = open + prep;
    if (tot <= 0) continue;
    if (k[0] === 'b') {
      const b = byId.get(Number(k.slice(1)));
      if (!b || !scarsOn(b) || isSite(b) || b.wreck) continue;
      const sg = sigmaOf(s, mods, site, b);
      const cut = rate * (1 - sg) ** 2 * ((open + prep * E.prep) / tot) * (radHardOn(b) ? rh : 1);
      const d = scar(b, cut, label(b), `Replace ${costText(replaceCost(b, site))} in its inspector`);
      if (d > 0) { nB++; sumB += cut; }
      if (crossed.length && crossed[crossed.length - 1].startsWith(label(b))) {
        crossed[crossed.length - 1] += `|b${b.id}`;
      }
    } else {
      // a machine: docked, it is behind its dock's σ and prepared
      const docked = (1 - E.machines.dockSigma) ** 2 * E.prep;
      let cut = rate * ((open + prep * docked) / tot);
      const id = Number(k.slice(1));
      if (k[0] === 'r') {
        const r = s.rovers.find((x) => x.id === id);
        if (!r) continue;
        if (shed) { const [rx, rz] = roverAt(s, r); cut *= shed(rx, rz); }
        const name = `${droneOf(s, r) ? 'drone' : 'rover'} #${r.id}`;
        const d = scar(r, cut, name, `Re-print ${E.reprint.metals}◆ ${E.reprint.parts}⚙ at its dock`);
        if (d > 0) { nM++; sumM += cut; }
        if (crossed.length && crossed[crossed.length - 1].startsWith(name)) crossed[crossed.length - 1] += `|r${r.id}`;
      } else {
        const u = s.haulers.find((x) => x.id === id);
        const hb = u ? hubOf(s, u) : undefined;
        if (!u) continue;
        if (shed) cut *= shed(u.haul.x, u.haul.z);
        const name = `unit ${unitTag(u)}`;
        const d = scar(u, cut, name, `Re-print ${hb ? `${costText(jobCost(hb, 'reprint', site))} at ${hubName(hb)}` : 'at its hub'}`);
        if (d > 0) { nM++; sumM += cut; }
        if (crossed.length && crossed[crossed.length - 1].startsWith(name)) crossed[crossed.length - 1] += `|h${u.id}`;
      }
    }
  }
  // excavators are machines too: their exposure is the structure's, above (parked = prepared)
  if (t) {
    if (part === 'flash') { t.scarredB = nB; t.scarB = nB ? sumB / nB : 0; t.scarredM = nM; t.scarM = nM ? sumM / nM : 0; }
    else { t.scarB = (t.scarB ?? 0) + (nB ? sumB / nB : 0); t.scarM = (t.scarM ?? 0) + (nM ? sumM / nM : 0); }
  }
  for (const c of crossed) {
    const [name, fix, ref] = c.split('|');
    const b = ref?.[0] === 'b' ? byId.get(Number(ref.slice(1))) : undefined;
    const r = ref?.[0] === 'r' ? s.rovers.find((x) => x.id === Number(ref.slice(1))) : undefined;
    const u = ref?.[0] === 'h' ? s.haulers.find((x) => x.id === Number(ref.slice(1))) : undefined;
    const hb = u ? hubOf(s, u) : undefined;
    const cap = b ? capOf(b) : r ? capOf(r) : u ? capOf(u) : 0;
    const text = `CAPABILITY — ${name} is down to ${Math.floor(cap * 100)}% from rad scars · ${fix}`;
    alert(s, text, 'warn', b ? { select: b.id } : r ? { select: r.home } : hb ? { select: hb.id } : undefined);
    const counter: AlertCounter | null = b ? { counter: 'flareReplace', id: b.id, label: `Replace ${costText(replaceCost(b, site))}` }
      : r ? { counter: 'flareReprint', id: r.id, label: `Re-print ${E.reprint.metals}◆ ${E.reprint.parts}⚙` }
      : u && hb ? { counter: 'flareReprintUnit', id: u.id, label: `Re-print ${costText(jobCost(hb, 'reprint', site))}` } : null;
    if (counter) attachCounters(s, text, [counter]);
  }
  f.scarEx = {};
}

// ─────────────────────────── the flare's end ───────────────────────────

/** endFlare's part: shut-down structures warm up; the log line's bits. */
export function onFlareEnd(s: GameState): string[] {
  const f = s.flare;
  const t = tallyOf(s);
  const now = s.simTime;
  for (const id of f.shut ?? []) {
    const b = s.buildings.find((x) => x.id === id);
    if (b?.flareShut) b.flareShut = { warm: now + E.warmS };
  }
  // the hub units the flare sent home go back to work (a latched one waits for its re-flash)
  for (const id of f.unitsHome ?? []) {
    const u = s.haulers.find((x) => x.id === id);
    if (u && u.parked === 'recalled' && !u.latch) delete u.parked;
  }
  if (t) { t.recalled = !!f.recalled; t.checkpoint = !!f.checkpoint; t.shut = (f.shut ?? []).length; }
  delete f.recalled; delete f.checkpoint; delete f.shut; delete f.drawn; delete f.scarEx; delete f.unitsHome; delete f.hubsRecalled;
  const bits: string[] = [];
  if (!t) return bits;
  const m = [t.rebooted ? `${t.rebooted} rebooted` : '', t.latched ? `${t.latched} latched up` : '', t.lost ? `**${t.lost} lost**` : ''].filter(Boolean);
  if (m.length) bits.push(`machines: ${m.join(', ')}`);
  if (t.researchLost) bits.push(`−${t.researchLost}≡ of ${t.researchTech}`);
  if (t.sick) bits.push(`${t.sick} crew sick`);
  if (t.chipsLost) bits.push(`${t.chipsLost}▣ scrapped`);
  if (t.scarredB) bits.push(`${plural(t.scarredB, 'structure')} scarred −${((t.scarB ?? 0) * 100).toFixed(2).replace(/0$/, '')}%`);
  if (t.scarredM) bits.push(`${plural(t.scarredM, 'machine')} scarred −${((t.scarM ?? 0) * 100).toFixed(2).replace(/0$/, '')}%`);
  return bits;
}

/** Each tick: the machines' draw, the scar count, reboots, the excavators' re-flash and deadlines,
 *  warm-ups, re-prints, the blackout's condition and the streams it held. */
export function effectsTick(s: GameState, site: SiteDef, mods: Mods) {
  const f = s.flare;
  const now = s.simTime;
  if (s.weather?.legacy) return;
  if (f.phase === 'active' && !f.drawn && now >= (f.activeAt ?? now) + 1 - 1e-9) {
    f.drawn = true;
    drawMachines(s, site, mods, 'flash');
  }
  // hubs recall their own units on M and X by themselves, from landing (§7.4); C flares keep them digging
  if (f.phase === 'telegraph' && !f.hubsRecalled && (f.cls === 'M' || f.cls === 'X')) {
    f.hubsRecalled = true;
    const sent = recallUnits(s, mods);
    if (sent.home) {
      alert(s, `HUBS RECALL — ${plural(sent.home, 'unit')} home to ${sent.home === 1 ? 'its bay' : 'their bays'} for the ${f.cls} flare` +
        (sent.out ? ` · ${plural(sent.out, 'unit')} cannot make it in ${fmtClock(f.timer)}: ${sent.out === 1 ? 'it keeps' : 'they keep'} digging` : ''),
        'info', { panel: 'weather' });
    }
  }
  if (flareStorm(s)) tallyScars(s);
  // hub units: reboots end; a latched one is re-flashed in its bay, one per 30 s a hub; lost at its deadline
  const R0 = E.machines.reflashS;
  const tickR = Math.floor(now / R0) !== Math.floor((now - 1) / R0);
  const flashed = new Set<number>();
  for (const u of [...s.haulers].sort((a, b) => (a.latch?.until ?? 0) - (b.latch?.until ?? 0) || a.id - b.id)) {
    if (u.rebootUntil !== undefined && u.rebootUntil <= now) delete u.rebootUntil;
    if (!u.latch) continue;
    const hb = hubOf(s, u);
    if (tickR && hb && !flashed.has(hb.id) && !unitOpen(u) && hb.enabled && hb.idleReason !== 'power') {
      flashed.add(hb.id);
      delete u.latch;
      u.lastFlare = 're-flashed after a latch-up';
      if (u.parked === 'recalled' && (f.phase === 'idle' || !(f.unitsHome ?? []).includes(u.id))) delete u.parked;
      alert(s, `RE-FLASHED — ${unitTag(u)} back at work from ${hubName(hb)}`, 'info', { select: hb.id });
      continue;
    }
    if (u.latch.until > now) continue;
    if (u.latch.real) loseUnit(s, u, `${unitTag(u)} was never re-flashed after the X flare’s latch-up`);
    else {
      delete u.latch;
      if (u.parked === 'recalled') delete u.parked;
      alert(s, `RE-FLASHED FROM EARTH — ${unitTag(u)} (a drill); next time a latched machine at its deadline is lost`, 'info', hb ? { select: hb.id } : undefined);
    }
  }
  for (const r of s.rovers) {
    if (r.rebootUntil !== undefined && r.rebootUntil <= now) delete r.rebootUntil;
    if (r.reprintUntil !== undefined && r.reprintUntil <= now) {
      delete r.reprintUntil; delete r.cap; delete r.scars; delete r.capWarned; delete r.lastFlare;
      alert(s, `RE-PRINTED — rover #${r.id} rolls out new: capability 100%`, 'info', { select: r.home });
    }
    if (!(r.brickedUntil ?? 0)) delete r.latch;
  }
  // excavators: reboots end; latched diggers re-flash over the Lander's link, one per 30 s; lost at the deadline
  const latched = s.buildings.filter((b) => b.latch).sort((a, b) => a.latch!.until - b.latch!.until || a.id - b.id);
  const lander = s.buildings.find((b) => b.type === 'lander');
  const R = E.machines.reflashS;
  if (latched.length && lander && !lander.airGapped && Math.floor(now / R) !== Math.floor((now - 1) / R)) {
    const b = latched.shift()!;
    delete b.latch;
    b.lastFlare = 're-flashed after a latch-up';
    alert(s, `RE-FLASHED — ${label(b)}’s digger is back at work`, 'info', { select: b.id });
  }
  for (const b of latched) {
    if (b.latch!.until > now) continue;
    if (b.latch!.real) burnDigger(s, b, 'X', `${label(b)}’s digger was never re-flashed after the X flare’s latch-up`);
    else { delete b.latch; alert(s, `RE-FLASHED FROM EARTH — ${label(b)}’s digger (a drill); next time a latched machine at its deadline is lost`, 'info', { select: b.id }); }
  }
  for (const b of s.buildings) {
    if (b.rebootUntil !== undefined && b.rebootUntil <= now) delete b.rebootUntil;
    // a Replace finished outside the weld (debug.finishConstruction): new all the same
    if (b.replace && !isSite(b)) replaceDone(s, b);
    // a shut-down structure restarts after its warm-up (the player may have switched it on already)
    if (b.flareShut && b.flareShut.warm > 0 && now >= b.flareShut.warm) {
      delete b.flareShut;
      if (!b.enabled) b.enabled = true;
    }
  }
  // the blackout: a condition while dark; the streams it held land when the link returns
  const w = s.weather;
  if (commsDark(s)) {
    condition(s, 'flare-dark', `⌁ COMMS DARK — ${fmtClock((f.blackoutUntil ?? now) - now)}: Earth shipments hold, streams buffer, no downlink or call home`,
      'info', { panel: 'weather' });
  } else if (w?.held && Object.values(w.held).some((v) => (v ?? 0) > 1e-6)) {
    const caps = s.storageCaps ?? {};
    const got: string[] = [];
    for (const [rid, amt] of Object.entries(w.held) as [ResourceId | 'data', number][]) {
      if (amt <= 1e-6) continue;
      if (rid === 'data') { s.data += amt; got.push(`${Math.round(amt)}≡`); continue; }
      const room = caps[rid] !== undefined ? Math.max(0, caps[rid]! - s.resources[rid]) : Infinity;
      const add = Math.min(amt, room);
      s.resources[rid] += add;
      got.push(`${add.toFixed(1)}${RESOURCES[rid].glyph}`);
    }
    w.held = {};
    if (got.length) alert(s, `LINK BACK — the outposts’ buffered streams landed: ${got.join(' ')}`, 'info');
  }
  // the telegraph's buttons on the flare's alert (at most four: the hazards' ride their own)
  if (f.phase === 'telegraph' || f.phase === 'active') {
    const ctrs = flareCounters(s, mods, site);
    if (ctrs.length) attachCounters(s, 'flare', ctrs);
  }
}

/** Outpost streams in the blackout: held for when the link returns (exploration.ts). */
export function holdStream(s: GameState, rid: ResourceId | 'data', amt: number) {
  const w = s.weather;
  if (!w || amt <= 0) return;
  const held = (w.held ??= {});
  held[rid] = (held[rid] ?? 0) + amt;
}

// ─────────────────────────── the counters (§4.5–4.7, §7.4) ───────────────────────────

/** When the flare in flight ends (game time). */
function flareEndsAt(s: GameState): number {
  const f = s.flare;
  const cls = f.cls ?? 'C';
  const C = W.classes[cls];
  if (f.phase === 'telegraph') return s.simTime + f.timer + C.activeS + C.tailS;
  if (f.phase === 'active') return s.simTime + f.timer + C.tailS;
  return s.simTime + f.timer;
}

/** A hub unit's trip home (s): back from its target, as the hub reckons it (0: it is in or by its bay). */
function unitHomeS(s: GameState, mods: Mods, u: Hauler): number {
  if (!unitOpen(u) || instantOf(s)) return 0;
  const b = hubOf(s, u);
  const tt = targetOf(s, u.target);
  if (!b || !tt || u.haul.phase === 'toBay' || u.haul.phase === 'toDrop' || u.haul.phase === 'unload') return 0;
  const est = tripTo(s, mods, b, tt).t;
  return Number.isFinite(est) ? est : Infinity;
}

/** Send home every hub unit in the open whose trip fits in the time to the protons (the hubs' own recall,
 *  and Recall machines). They go back to work when the flare has passed. */
export function recallUnits(s: GameState, mods: Mods): { home: number; out: number } {
  const f = s.flare;
  const left = f.phase === 'telegraph' ? f.timer : 0;
  let home = 0, out = 0;
  for (const u of s.haulers) {
    if (!unitOpen(u) || u.parked === 'recalled' || u.latch) continue;
    if (unitHomeS(s, mods, u) > left + 1e-9) { out++; continue; }
    recallUnit(s, mods, u.id);
    (f.unitsHome ??= []).push(u.id);
    home++;
  }
  return { home, out };
}

/** Rovers and drones whose trip home fits in the time to the protons, and the excavators that can park. */
function recallPlan(s: GameState): { home: RoverUnit[]; out: RoverUnit[]; park: BuildingState[] } {
  const f = s.flare;
  const left = f.phase === 'telegraph' ? f.timer : 0;
  const home: RoverUnit[] = [], out: RoverUnit[] = [];
  for (const r of s.rovers) {
    if (!inOpen(s, r) || (r.brickedUntil ?? 0) > 0) continue;
    const dock = s.buildings.find((b) => b.id === r.home);
    const secs = !dock || instantOf(s) ? 0 : reachS(s, r, siteEntry(s, dock), centerOf(dock));
    (secs <= left + 1e-9 ? home : out).push(r);
  }
  return { home, out, park: s.buildings.filter(diggerOut) };
}

/** The structures Shut down exposed takes (§4.7): a scar at stake, σ under 0.5, not life support or power;
 *  the last running Data Center stays once Fleet OS is done (the CONTROL PLANE, docs/14 §3.5). */
export function shutTargets(s: GameState, mods: Mods, site: SiteDef): BuildingState[] {
  const list = s.buildings.filter((b) => scarsOn(b) && b.type !== 'excavator' && !isSite(b) && b.enabled && !b.wreck && !b.flareShut &&
    BUILDINGS[b.type].category !== 'life' && BUILDINGS[b.type].category !== 'power' && sigmaOf(s, mods, site, b) < 0.5);
  if (s.techsDone.includes('fleetOS')) {
    const running = s.buildings.filter((b) => isCompute(b.type) && !isSite(b) && b.enabled);
    const shut = list.filter((b) => isCompute(b.type));
    if (running.length && shut.length >= running.length) {
      const keep = [...shut].sort((a, b) => a.priority - b.priority || a.id - b.id)[0];
      return list.filter((b) => b !== keep);
    }
  }
  return list;
}

/** The flare's buttons for the telegraph (the alert, the pop-up's ALSO row, the panel): what each would take. */
export function flareCounters(s: GameState, mods: Mods, site: SiteDef): AlertCounter[] {
  const f = s.flare;
  if (s.weather?.legacy || f.phase === 'idle' || f.phase === 'tail') return [];
  const out: AlertCounter[] = [];
  if (!f.recalled && f.phase === 'telegraph') {
    const p = recallPlan(s);
    const left = f.timer;
    const units = s.haulers.filter((u) => unitOpen(u) && u.parked !== 'recalled' && !u.latch);
    const uHome = units.filter((u) => unitHomeS(s, mods, u) <= left + 1e-9).length;
    const n = p.home.length + p.park.length + uHome;
    const cant = p.out.length + units.length - uHome;
    if (n > 0) out.push({ counter: 'flareRecall', label: `Recall machines ${n}${cant ? ` (${cant} can’t)` : ''}` });
  }
  if (!f.checkpoint && s.researchQueue?.length && f.phase === 'telegraph') out.push({ counter: 'flareCheckpoint', label: 'Checkpoint research' });
  const shut = shutTargets(s, mods, site).length;
  if (shut > 0) out.push({ counter: 'flareShutDown', label: `Shut down exposed ${shut}` });
  return out;
}

/** Recall machines (§7.4): home before the protons, every machine whose trip fits; the excavators park
 *  (powered off where they stand). The rest keep working. */
export function recallMachines(s: GameState, mods: Mods): EffectResult {
  const f = s.flare;
  if (s.weather?.legacy || f.phase === 'idle') return no('NO FLARE TO RECALL FOR — the recall waits for a warning');
  if (f.phase === 'tail') return no('TOO LATE TO RECALL — the X’s tail is on; its draw is done');
  const p = recallPlan(s);
  const until = flareEndsAt(s);
  // every docked machine stays docked, and those that can make it come home
  for (const r of s.rovers) {
    if (inOpen(s, r) && !p.home.includes(r)) continue;
    r.heldUntil = Math.max(r.heldUntil ?? 0, until);
    r.site = null; r.pinned = false; delete r.road;
  }
  for (const b of p.park) { b.enabled = false; b.flareShut = { warm: 0 }; (f.shut ??= []).push(b.id); }
  const units = recallUnits(s, mods);
  f.recalled = true;
  const cantN = p.out.length + units.out;
  const cant = cantN ? ` · ${plural(cantN, 'machine')} cannot make it home in ${fmtClock(f.phase === 'telegraph' ? f.timer : 0)}: they keep working` : '';
  alert(s, `MACHINES RECALLED — ${plural(p.home.length + units.home, 'machine')} home for the flare${p.park.length ? `, ${plural(p.park.length, 'excavator')} parked` : ''}; construction pauses${cant}`,
    'info', { panel: 'weather' });
  return OK;
}

/** Checkpoint research (§4.6): transfers pause from the protons to the flare's end; nothing is lost. */
export function checkpointResearch(s: GameState): EffectResult {
  const f = s.flare;
  if (s.weather?.legacy || f.phase === 'idle') return no('NO FLARE TO CHECKPOINT FOR — the checkpoint waits for a warning');
  if (f.checkpoint) return no('ALREADY CHECKPOINTED');
  if (f.phase !== 'telegraph') return no('TOO LATE TO CHECKPOINT — the protons are in');
  f.checkpoint = true;
  alert(s, 'CHECKPOINT — research transfers pause from the protons to the flare’s end; the labs keep filling the bank, nothing is lost', 'info', { panel: 'weather' });
  return OK;
}

/** Shut down exposed (§4.7): off for the flare, prepared (a tenth of the scar, no yield loss); back 20 s after it. */
export function shutDownExposed(s: GameState, mods: Mods, site: SiteDef): EffectResult {
  const f = s.flare;
  if (s.weather?.legacy || f.phase === 'idle') return no('NO FLARE TO SHUT DOWN FOR');
  const list = shutTargets(s, mods, site);
  if (!list.length) return no('NOTHING EXPOSED TO SHUT DOWN — life support, power and shielded structures run on');
  for (const b of list) { b.enabled = false; b.flareShut = { warm: 0 }; (f.shut ??= []).push(b.id); }
  alert(s, `SHUT DOWN — ${plural(list.length, 'exposed structure')} off for the flare; ${list.length === 1 ? 'it warms' : 'they warm'} up ${E.warmS} s after it`,
    'info', { panel: 'weather' });
  return OK;
}

// ─────────────────────────── Replace and Re-print (§4.14) ───────────────────────────

/** Half the build cost, rounded up per resource. */
export function replaceCost(b: Pick<BuildingState, 'type'>, site: SiteDef): Partial<Record<ResourceId, number>> {
  const out: Partial<Record<ResourceId, number>> = {};
  for (const [r, a] of Object.entries(buildCostAt(b.type, site))) out[r as ResourceId] = Math.ceil((a ?? 0) * E.replace.cost);
  return out;
}

/** 60% of the build time, as placement scales it. */
export function replaceSeconds(b: BuildingState, mods: Mods, site: SiteDef): number {
  const ridge = b.type === 'solar' && b.deposit === 'ridge' ? DEPOSIT_FX.ridgeSolarBuildTime : 1;
  return Math.max(1, Math.round(BUILDINGS[b.type].buildTime * site.buildCostMult * mods.buildSpeedMult * mods.buildTimeMult[b.type] * ridge * E.replace.time));
}

/** Replace a scarred structure (an excavator's Re-print): half its cost, 60% of its time offline, a rover welds;
 *  its pad, roads, door, priority and settings stay. */
export function replaceBuilding(s: GameState, mods: Mods, site: SiteDef, id: number): EffectResult {
  const b = s.buildings.find((x) => x.id === id);
  if (!b) return no('NO SUCH STRUCTURE');
  if (!scarsOn(b) && b.type !== 'solar') return no(`NOTHING TO REPLACE — ${label(b)} carries no capability`);
  if (isSite(b)) return no(`ALREADY A SITE — ${label(b)} is being built or replaced`);
  if (b.wreck) return no(`A WRECK — Rebuild ${label(b)} instead`);
  if (capOf(b) >= 0.9995 && !b.burned) return no(`NOTHING TO REPLACE — ${label(b)} is at 100%`);
  const cost = replaceCost(b, site);
  for (const [r, amt] of Object.entries(cost)) {
    const have = s.resources[r as ResourceId] ?? 0;
    if (have < (amt ?? 0)) return no(`REPLACE NEEDS ${costText(cost)} — have ${Math.floor(have)}${RESOURCES[r as ResourceId].glyph}`);
  }
  for (const [r, amt] of Object.entries(cost)) s.resources[r as ResourceId] -= amt ?? 0;
  const secs = replaceSeconds(b, mods, site);
  b.replace = { at: s.simTime };
  b.construction = secs;
  b.buildTotal = secs;
  b.buildSeq = s.nextBuildingId;
  b.idleReason = 'queued';
  b.active = false;
  if (b.flareShut) { delete b.flareShut; b.enabled = true; }
  alert(s, `${b.burned ? 'RE-PRINT' : 'REPLACE'} QUEUED — ${label(b)} (${pct(capOf(b))}) for ${costText(cost)}: ${fmtClock(secs)} offline while a rover welds`,
    'info', { select: b.id });
  return OK;
}

/** siteDone's part: a replaced structure is new — capability 100%, wear 0. */
export function replaceDone(s: GameState, b: BuildingState): boolean {
  if (!b.replace) return false;
  const burned = !!b.burned;
  delete b.replace; delete b.cap; delete b.scars; delete b.capWarned; delete b.burned; delete b.latch; delete b.rebootUntil; delete b.lastFlare;
  delete b.buildSeq;
  b.wear = 0;
  if (b.haul) { b.haul.cargo = {}; b.haul.full = false; }
  if (b.type === 'solar') { b.flareDmg = 0; b.dust = 0; }
  if (s.weather) s.weather.replaced = (s.weather.replaced ?? 0) + 1;
  alert(s, `${burned ? 'RE-PRINTED' : 'REPLACED'} — ${label(b)} is new: capability 100%`, 'info', { select: b.id });
  return true;
}

/** Re-print a scarred rover or drone at its dock (§4.14): 5◆ 8⚙, 72 s docked; it keeps its dock and pin. */
export function reprintRover(s: GameState, id: number): EffectResult {
  const r = s.rovers.find((x) => x.id === id);
  if (!r) return no('NO SUCH ROVER');
  if (r.reprintUntil) return no(`ALREADY RE-PRINTING — #${r.id} rolls out in ${fmtClock(r.reprintUntil - s.simTime)}`);
  if ((r.brickedUntil ?? 0) > 0) return no(`BRICKED — #${r.id} must be re-flashed first`);
  if (capOf(r) >= 0.9995) return no(`NOTHING TO RE-PRINT — #${r.id} is at 100%`);
  const P = E.reprint;
  if (s.resources.metals < P.metals || s.resources.parts < P.parts) return no(`RE-PRINT NEEDS ${P.metals}◆ ${P.parts}⚙ — have ${Math.floor(s.resources.metals)}◆ ${Math.floor(s.resources.parts)}⚙`);
  s.resources.metals -= P.metals;
  s.resources.parts -= P.parts;
  r.reprintUntil = s.simTime + P.s;
  r.heldUntil = Math.max(r.heldUntil ?? 0, r.reprintUntil);
  r.site = null; delete r.road;
  alert(s, `RE-PRINT — ${droneOf(s, r) ? 'drone' : 'rover'} #${r.id} (${pct(capOf(r))}) at its dock for ${P.metals}◆ ${P.parts}⚙: back new in ${fmtClock(P.s)}`, 'info', { select: r.home });
  return OK;
}

/** Re-print a scarred hub unit (§4.14, docs/17 §4.2): a job in its hub's queue, half the unit's price and
 *  60% of its print; it keeps its bay, and the old unit is scrapped as the new one rolls out. */
export function reprintUnit(s: GameState, mods: Mods, site: SiteDef, id: number): EffectResult {
  const u = s.haulers.find((x) => x.id === id);
  const b = u ? hubOf(s, u) : undefined;
  if (!u || !b?.hub) return no('NO SUCH UNIT');
  if (capOf(u) >= 0.9995) return no(`NOTHING TO RE-PRINT — ${unitTag(u)} is at 100%`);
  if (b.hub.queue.some((j) => j.kind === 'reprint' && j.unit === u.id)) return no(`ALREADY QUEUED — ${unitTag(u)}’s Re-print is in ${hubName(b)}’s queue`);
  if (b.hub.queue.length >= HUB.queueMax) return no(`QUEUE FULL — ${hubName(b)} holds ${HUB.queueMax} jobs`);
  b.hub.queue.push({ kind: 'reprint', unit: u.id, paid: null, t: 0, total: jobTime(b, 'reprint', site, mods), by: 'player' });
  alert(s, `RE-PRINT QUEUED — ${unitTag(u)} (${pct(capOf(u))}) at ${hubName(b)} for ${costText(jobCost(b, 'reprint', site))}: it works on until the new one rolls out`,
    'info', { select: b.id });
  return OK;
}

/** The scarred, worst first (the panel's SCARRED line, Replace worst, the probe). */
export function scarredList(s: GameState): { kind: 'b' | 'r' | 'h'; id: number; name: string; cap: number; burned: boolean }[] {
  const out: { kind: 'b' | 'r' | 'h'; id: number; name: string; cap: number; burned: boolean }[] = [];
  for (const b of s.buildings) {
    if ((scarsOn(b) || b.type === 'solar') && !isSite(b) && !b.wreck && (capOf(b) < 0.9995 || b.burned)) out.push({ kind: 'b', id: b.id, name: label(b), cap: b.burned ? 0 : capOf(b), burned: !!b.burned });
  }
  for (const r of s.rovers) {
    if (capOf(r) < 0.9995 && !r.reprintUntil) out.push({ kind: 'r', id: r.id, name: `${droneOf(s, r) ? 'drone' : 'rover'} #${r.id}`, cap: capOf(r), burned: false });
  }
  for (const u of s.haulers) {
    const hb = hubOf(s, u);
    const queued = !!hb?.hub?.queue.some((j) => j.kind === 'reprint' && j.unit === u.id);
    if (capOf(u) < 0.9995 && !queued) out.push({ kind: 'h', id: u.id, name: `unit ${unitTag(u)}`, cap: capOf(u), burned: false });
  }
  return out.sort((a, b) => a.cap - b.cap || a.id - b.id);
}

/** Replace worst: the scarred structure or machine with the least capability left. */
export function replaceWorst(s: GameState, mods: Mods, site: SiteDef): EffectResult {
  const w = scarredList(s)[0];
  if (!w) return no('NOTHING SCARRED — every structure and machine is at 100%');
  return w.kind === 'b' ? replaceBuilding(s, mods, site, w.id) : w.kind === 'r' ? reprintRover(s, w.id) : reprintUnit(s, mods, site, w.id);
}

/** A flare counter pressed (the alert, the pop-up, the panel): game.ts routes 'counter' actions here. */
export function applyFlareCounter(s: GameState, mods: Mods, site: SiteDef, c: FlareCounterId, id?: number): EffectResult {
  switch (c) {
    case 'flareRecall': return recallMachines(s, mods);
    case 'flareCheckpoint': return checkpointResearch(s);
    case 'flareShutDown': return shutDownExposed(s, mods, site);
    case 'flareReplace': return id === undefined ? no('NO STRUCTURE NAMED') : replaceBuilding(s, mods, site, id);
    case 'flareReprint': return id === undefined ? no('NO ROVER NAMED') : reprintRover(s, id);
    case 'flareReprintUnit': return id === undefined ? no('NO UNIT NAMED') : reprintUnit(s, mods, site, id);
    case 'flareReplaceWorst': return replaceWorst(s, mods, site);
  }
}

export const isFlareCounter = (c: string): c is FlareCounterId =>
  c === 'flareRecall' || c === 'flareCheckpoint' || c === 'flareShutDown' || c === 'flareReplace' || c === 'flareReprint' ||
  c === 'flareReprintUnit' || c === 'flareReplaceWorst';

// ─────────────────────────── what the UI reads ───────────────────────────

export interface EffectsView {
  /** the telegraph's buttons (the pop-up's ALSO row, the panel's NOW) */
  also: AlertCounter[];
  /** the EXPOSURE block's lines (§10.2) */
  exposure: { crew: string; machines: string; research: string; buildings: string; comms: string };
  /** SCARRED: under 85%, the worst few, and every one scarred */
  scarred: { under: number; any: number; worst: string; burned: number };
  /** seconds of blackout left (0: the link is up) */
  dark: number;
  /** a telegraph's counters pressed */
  recalled: boolean; checkpoint: boolean; shut: number;
}

export function effectsView(s: GameState, mods: Mods, site: SiteDef): EffectsView {
  const f = s.flare;
  const occ = s.crew > 0 && s.hazards ? occupancy(s, mods) : new Map<number, number>();
  const homes = s.buildings.filter((b) => (effectiveDef(b.type, mods).housing ?? 0) > 0 && (occ.get(b.id) ?? 0) > 0);
  const bare = homes.filter((b) => sigmaOf(s, mods, site, b) < 0.5 && !mods.guards.has('stormShelters'))
    .reduce((n, b) => n + (occ.get(b.id) ?? 0), 0);
  const machines = s.rovers.length + s.haulers.length + s.buildings.filter((b) => b.type === 'excavator' && !isSite(b)).length;
  const out = s.rovers.filter((r) => inOpen(s, r)).length + s.haulers.filter(unitOpen).length + s.buildings.filter(diggerOut).length;
  const head = s.researchQueue?.[0];
  const labsBare = s.buildings.filter((b) => b.type === 'lab' && !isSite(b) && b.enabled && sigmaOf(s, mods, site, b) < 0.5).length;
  const exposed = s.buildings.filter((b) => scarsOn(b) && !isSite(b) && b.enabled && !b.wreck && sigmaOf(s, mods, site, b) < 0.5).length;
  const compute = s.buildings.filter((b) => isCompute(b.type) && !isSite(b));
  const dark = Math.max(0, (f.blackoutUntil ?? 0) - s.simTime);
  const due = s.resupply?.pending && !s.resupply.medevac ? s.resupply.arriveAt - s.simTime : null;
  const list = scarredList(s);
  const under = list.filter((x) => x.cap < E.alertAt);
  return {
    also: flareCounters(s, mods, site),
    exposure: {
      crew: s.crew > 0 ? `${s.crew} · ${bare} in unshielded homes · ${s.evaCrew} on EVA` : 'none aboard',
      machines: `${machines} · ${out} out` +
        `${[...s.rovers, ...s.haulers].some((r) => rebooting(s, r)) ? ` · ${[...s.rovers, ...s.haulers].filter((r) => rebooting(s, r)).length} rebooting` : ''}` +
        `${[...s.rovers, ...s.haulers].some((r) => r.latch) ? ` · ${[...s.rovers, ...s.haulers].filter((r) => r.latch).length} latched` : ''}`,
      research: head ? `${TECHS[head].name} ${pct(Math.min(1, (s.researchSpent[head] ?? 0) / Math.max(1, techCost(head, s).data)))} · ${plural(labsBare, 'lab')} unshielded` : 'nothing queued',
      buildings: `${exposed} unshielded with a scar at stake${compute.length ? ` · ${compute.length} compute (σ ${sigmaOf(s, mods, site, compute[0]).toFixed(1)})` : ''}`,
      comms: dark > 0 ? `DARK ${fmtClock(dark)} · Earth traffic holds` : due !== null ? `a shipment lands in ${fmtClock(Math.max(0, due))}${due > 0 ? ': held if the blackout comes' : ''}` : 'the link is up',
    },
    scarred: {
      under: under.length, any: list.length, burned: list.filter((x) => x.burned).length,
      worst: under.slice(0, 2).map((x) => `${x.name} ${x.burned ? 'burned out' : pct(x.cap)}`).join(' · '),
    },
    dark, recalled: !!f.recalled, checkpoint: !!f.checkpoint, shut: (f.shut ?? []).length,
  };
}

/** A structure's capability line (the inspector, §10.7): its capability, the scars, Replace and its payback. */
export function capabilityView(s: GameState, mods: Mods, site: SiteDef, b: BuildingState) {
  if (!scarsOn(b) && b.type !== 'solar') return null;
  const cap = capOf(b);
  const secs = replaceSeconds(b, mods, site);
  // the output-time payback: the new one out-makes the old after it has made up its time offline
  const payback = cap < 0.9995 ? (secs * cap) / Math.max(1e-6, 1 - cap) : Infinity;
  return {
    cap, scars: b.scars ?? 0, sigma: sigmaOf(s, mods, site, b), burned: !!b.burned, replacing: !!b.replace,
    cost: costText(replaceCost(b, site)), secs, payback, status: flareOff(s, b), last: b.lastFlare ?? '',
  };
}

/** A rover's or drone's flare line (the rover inspector, §10.7). */
export function roverFlareView(s: GameState, id: number) {
  const r = s.rovers.find((x) => x.id === id);
  if (!r) return null;
  const open = inOpen(s, r);
  return {
    sigma: open ? 0 : E.machines.dockSigma, open, cap: capOf(r), scars: r.scars ?? 0, last: r.lastFlare ?? '',
    rebootS: rebooting(s, r) ? r.rebootUntil! - s.simTime : 0, latched: !!r.latch, reprintS: r.reprintUntil ? r.reprintUntil - s.simTime : 0,
    cost: `${E.reprint.metals}◆ ${E.reprint.parts}⚙`,
  };
}

/** A hub unit's flare status for its line ('' = none) and its capability line (the unit inspector). */
export function unitFlareStatus(s: GameState, u: Hauler): string {
  if (u.latch) return `LATCHED UP — safe mode, home to its bay for a re-flash · ${u.latch.real ? 'lost' : 're-flashed from Earth'} in ${fmtClock(Math.max(0, u.latch.until - s.simTime))}`;
  if (rebooting(s, u)) return `REBOOTING — back in ${fmtClock(u.rebootUntil! - s.simTime)}`;
  return '';
}
export function unitFlareLine(s: GameState, site: SiteDef, u: Hauler): string {
  const b = hubOf(s, u);
  const open = unitOpen(u);
  const queued = !!b?.hub?.queue.some((j) => j.kind === 'reprint' && j.unit === u.id);
  return `σ ${open ? 0 : E.machines.dockSigma} ${open ? 'in the open' : 'in its bay'} · CAPABILITY ${pct(capOf(u))}` +
    `${u.scars ? ` · rad scars from ${plural(u.scars, 'flare')}` : ''}${u.lastFlare ? ` · last flare: ${u.lastFlare}` : ''}` +
    `${queued ? ' · Re-print queued' : capOf(u) < 0.9995 && b ? ` · Re-print ${costText(jobCost(b, 'reprint', site))}` : ''}`;
}

/** Migration step 6 (§14.3): nothing scarred on load, no glitch in flight. */
export function migrateScars(s: GameState) {
  for (const b of s.buildings ?? []) {
    delete b.cap; delete b.scars; delete b.capWarned; delete b.replace; delete b.flareShut; delete b.rebootUntil; delete b.latch; delete b.burned; delete b.lastFlare;
  }
  for (const r of s.rovers ?? []) { delete r.cap; delete r.scars; delete r.capWarned; delete r.rebootUntil; delete r.latch; delete r.reprintUntil; delete r.lastFlare; }
  for (const u of s.haulers ?? []) { delete u.cap; delete u.scars; delete u.capWarned; delete u.rebootUntil; delete u.latch; delete u.lastFlare; }
}
