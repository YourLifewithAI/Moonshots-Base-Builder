/** The 1 Hz economy tick — deterministic resolution order:
 *  generator staffing → power supply → stockpile caps → priority idling →
 *  worker allocation → production (tier order) → life support & crew →
 *  parts upkeep & wear → net rates → morale → space weather (flares) → Earth
 *  shipments → exploration and the crew rotation → research → night
 *  tracking → charters → milestones → the Builder. Every building's numbers come from mods.effectiveRates, the
 *  same function the tooltips and previews read.
 *  Timberborn-style priority idling: under shortage, low-priority buildings
 *  auto-idle first; habitats brown out last. */
import { BUILDINGS, isCompute, type BuildingId } from '../data/buildings';
import { MILESTONES } from '../data/milestones';
import { TECHS } from '../data/techs';
import {
  ALERTS, BEAM_KW_PER_LAUNCH, BROWNOUT_HOLD_S,
  CREW, CREW_ROTATION, CROP_LOSS, CYCLE_S, DOWNLINK, DUSK_WARN_S, NIGHT_S,
  LOW_SUPPLY_S, MORALE, OVERCLOCK, POWER_RELEASE_MARGIN, RATE_SMOOTH_S, RESUPPLY, SOLAR_DUST_MAX,
  SOLAR_DUST_PER_DAY, SOLAR_DUST_RECOVER, UNIT_POWER, WEAR, HAUL,
  EVA, LAUNCH_CAP_PER_VOLLEY, LAUNCH_COST_FOILS, LAUNCH_POWER_BURST, SWARM_PCT_PER_LAUNCH,
} from '../data/balance';
import { RESOURCES, type ResourceId } from '../data/resources';
import type { SiteDef } from '../data/sites';
import { fillStateDefaults, type AlertAction, type AlertMsg, type FieldReport, type GameState, type BuildingState, type NotifyFamily, type RoverUnit } from './state';
import {
  canToggleCrew, computeMods, effectiveDef, effectiveRates, modsFor, unmanned as isUnmanned, waterReclaimFactor, wearDerate, type EffectiveRates, type Mods,
} from './mods';
import { computeEra, destinyOf, eraTick, insightTick, producerHint, researchTick, uplinkShare } from './research';
import { explorationTick } from './exploration';
import { assignRovers, crewKW, crewParts, crewRate, fleetRefresh, syncRoster } from './fleet';
import {
  PackTick, atHome, atSiteStand, chargeKW, chargeOf, driveKW, packCap, packUnits, powerKind, unitKey, unitPriority, type PackUnit,
} from './unitPower';
import { ensureHaul, haulTick, haulWaiting } from './haul';
import {
  ensureHubs, hopperCap, hubDraw, hubHave, hubOf, hubsOf, joinLegacy, meanFeed, noteStarved, pitNews, planTraffic, printTick, printing,
  reconcileRegolith, targetOf, unitRates, unitTick, writeRegolith,
} from './hubs';
import { HUB, isHubType } from '../data/hubs';
import { FEED_KINDS } from '../data/deposits';
import { oreSurveyStep, pitsStep, stripMorale } from './pits';
import { gradeStep } from './grading';
import { settleJobs, sinter, spurLeft } from './roads';
import { siteTransit, transitArrive, transitPlan, type Arrivals } from './transit';
import { instantOf } from './simMode';
import { dayInfo, fmtClock, type DayInfo } from './daynight';
import { updateFlowBook } from './flowBook';
import { automationTick, type AutoRequest } from './automation';
import { HZ } from '../data/hazards';
import {
  beamMult, duskLine, flareMoraleTarget, flareStorm, notePanel, siteDone, siteParts, solarMult, weatherTick,
} from './spaceWeather';
import { capOf, commsDark, flareOff, flareOutputMult, rebooting, teamCap, weldFlareMult } from './flareEffects';
import {
  attachCounters, evaHeld, growthHeld, hazardBedsOff, hazardDrawMult, hazardDuskLine, hazardMorale, hazardOff,
  hazardOutputMult, hazardTick, hazardUpkeepMult, killCrew, sickCrew, starveCause,
} from './hazards';

const PROD_ORDER: BuildingId[] = [
  'excavator', 'iceHarvester',            // extraction: legacy pads (docs/17 §19); hub units run after them (4.1)
  'smelter', 'refinery', 'waterPlant', 'partsFab', 'chipFab', // hubs, then industry (same-tick chaining)
  'hydroponics', 'recDome',               // life
  'foilFactory', 'massDriver', 'propellantPlant', // export
  'lab', 'dataCenter',                    // science
  'greenhouseRing', 'gardenDome', 'serverMonolith', // destiny buildings (docs/14 §2.8)
];

export interface EconEvents {
  modsChanged: boolean;
  victory: boolean;
  defeat: boolean;
  /** step 12: what the Builder wants placed or demolished (Game.econStep resolves them) */
  build: AutoRequest[];
  /** step 8.3: buildings a hazard wrecked or removed (Game refreshes the world) */
  wrecked?: number[];
}

type AlertKind = AlertMsg['kind'];
const SEVERITY: Record<AlertKind, number> = { info: 0, warn: 1, crit: 2 };

/** Tests: the grid at 0 while `dark` — no supply reaches a load and the bank
 *  is out of reach (debug forceGridDark; a forced brownout). */
export const GRID = { dark: false };

/** Bumped whenever the notification log gains a line or a repeat counts on one
 *  (the UI republishes `$log` when it changes: game.publish). */
export const logStamp = { n: 0 };

/** A one-shot event. Repeating one still listed merges into it (×N). It
 *  belongs to a notification `family` (docs/19 S7; a crit alert with none is a
 *  hazard) and is written to the saved log (`s.log`, the last ALERTS.logMax
 *  events). `report` is a field card's body (title, geology, reward lines). */
export function alert(
  s: GameState, text: string, kind: AlertKind = 'info', action?: AlertAction, family?: NotifyFamily, report?: FieldReport,
) {
  const i = s.alerts.findIndex((a) => !a.cond && a.key === text);
  logStamp.n++;
  if (i >= 0) {
    const [a] = s.alerts.splice(i, 1);
    a.count += 1;
    a.at = s.simTime;
    a.quiet = false;
    s.alerts.push(a);
    const line = (s.log ??= []).find((e) => e.id === a.id);
    if (line) { line.count = a.count; line.at = s.simTime; }
    return;
  }
  const fam = family ?? (kind === 'crit' ? 'hazard' : undefined);
  const id = s.nextAlertId++;
  s.alerts.push({ id, text, kind, at: s.simTime, key: text, count: 1, action, ...(fam ? { family: fam } : {}), ...(report ? { report } : {}) });
  const log = (s.log ??= []);
  log.push({ id, at: s.simTime, kind, text, count: 1, ...(action ? { action } : {}), ...(fam ? { family: fam } : {}), ...(report ? { report } : {}) });
  if (log.length > ALERTS.logMax) log.splice(0, log.length - ALERTS.logMax);
  // bounded: the least severe, then the oldest, event makes room
  const events = s.alerts.filter((a) => !a.cond);
  if (events.length > ALERTS.maxEvents) {
    const out = events.reduce((m, a) => (SEVERITY[a.kind] < SEVERITY[m.kind] ? a : m));
    s.alerts.splice(s.alerts.indexOf(out), 1);
  }
}

/** `alert` bound to one notification family: a module whose every alert is one
 *  family's writes `const alert = alertIn('hazard')` and its call sites stay as they are.
 *  (A function declaration, so a module in an import cycle with this one may call it as it loads.) */
export function alertIn(family: NotifyFamily) {
  return (s: GameState, text: string, kind: AlertKind = 'info', action?: AlertAction) => alert(s, text, kind, action, family);
}

/** conditions raised during the economy tick in progress: key → times */
let raised: Map<string, number> | null = null;

/** A recurring condition: raise it every tick it holds, with its current
 *  wording; it clears itself shortly after it stops being raised. A
 *  dismissed condition is snoozed rather than re-raised the next tick. */
export function condition(
  s: GameState, key: string, text: string, kind: AlertKind, action?: AlertAction, family?: NotifyFamily,
) {
  if ((s.alertSnooze?.[key] ?? 0) > s.simTime) return;
  const n = (raised?.get(key) ?? 0) + 1;
  raised?.set(key, n);
  const live = s.alerts.find((a) => a.cond && a.key === key);
  if (!live) {
    s.alerts.push({
      id: s.nextAlertId++, text, kind, at: s.simTime, key, cond: true, count: 1,
      ttl: ALERTS.lingerTicks, action, ...(family ? { family } : {}),
    });
    return;
  }
  if (live.kind !== kind) live.quiet = false;
  live.text = text;
  live.kind = kind;
  live.at = s.simTime;
  live.count = n;
  live.ttl = ALERTS.lingerTicks;
  live.action = action;
  if (family) live.family = family;
}

/** clicking an alert about Earth traffic opens the Lander */
export function landerAction(s: GameState): AlertAction | undefined {
  const lander = s.buildings.find((b) => b.type === 'lander');
  return lander ? { select: lander.id } : undefined;
}

/** end of tick: conditions nobody raised count down and leave */
function settleConditions(s: GameState, seen: Map<string, number>) {
  s.alerts = s.alerts.filter((a) => {
    if (!a.cond || seen.has(a.key)) return true;
    a.ttl = (a.ttl ?? 1) - 1;
    return a.ttl > 0;
  });
  for (const [key, until] of Object.entries(s.alertSnooze ?? {})) {
    if (until <= s.simTime) delete s.alertSnooze[key];
  }
}

export function moraleWorkMult(morale: number): number {
  return MORALE.workMultMin + (morale / 100) * MORALE.workMultSpan;
}

/** a human base whose last crewmember died stays lost: no growth, no
 *  production, no second life from a save (robotic missions cannot fall) */
export function missionLost(s: GameState): boolean {
  return s.expedition !== 'robotic' && s.defeatShown;
}

export { wearDerate };

/** settlers come to any human base, and to a robotic one once it is ready for them */
export function settlersWelcome(s: GameState): boolean {
  return s.expedition !== 'robotic' || s.techsDone.includes('humanCohabitation');
}

const LIFE_SUPPORT: ['oxygen' | 'food' | 'water', number][] = [
  ['oxygen', CREW.oxygenPerCrew], ['food', CREW.foodPerCrew], ['water', CREW.waterPerCrew],
];

/** The crew's life-support reserve of a resource: LOW_SUPPLY_S of what they
 *  breathe, eat and drink (0 for anything else). Production, surveys, hoppers
 *  and research goods all leave it in the tanks. */
export function crewReserve(s: Pick<GameState, 'crew'>, mods: Pick<Mods, 'inputMult'>, rid: ResourceId): number {
  const per = rid === 'oxygen' ? CREW.oxygenPerCrew : rid === 'water' ? CREW.waterPerCrew
    : rid === 'food' ? CREW.foodPerCrew : 0;
  return s.crew * per * mods.inputMult.habitat * LOW_SUPPLY_S;
}

/** The life-support supply that cannot carry one more settler, or '' when all
 *  can: at the current net flow, each must keep crew+1 alive for a lunar day,
 *  with at least five minutes of their supply in the tanks (night stops most
 *  producers). No production means a full lunar day in reserve. */
export function boardingShortfall(s: GameState, lsMult: number, waterMult = 1): '' | 'oxygen' | 'food' | 'water' {
  for (const [rid, rate] of LIFE_SUPPORT) {
    const perCrew = rate * lsMult * (rid === 'water' ? waterMult : 1);
    const flow = s.rates?.[rid] ?? -s.crew * perCrew;
    const deficit = Math.max(0, perCrew - flow); // the newcomer's share the base can't make
    const stock = s.resources[rid];
    if (stock < (s.crew + 1) * perCrew * LOW_SUPPLY_S || stock < deficit * CYCLE_S) return rid;
  }
  return '';
}

/** transit time of a shipment ordered by hand now: Earth's patience thins */
export function orderDelayS(s: GameState): number {
  return RESUPPLY.delayS + (s.resupply?.ordered ?? 0) * RESUPPLY.orderStepS;
}

/** banked data the next Earth downlink costs: each one asks more */
export function downlinkCost(s: GameState): number {
  return DOWNLINK.baseData + DOWNLINK.stepData * (s.downlinks ?? 0);
}

/** a construction site's place in the robot queue (lower builds first) */
export function queuePos(b: BuildingState): number {
  return b.buildSeq ?? b.id;
}

export function currentDay(s: GameState, site: SiteDef): DayInfo {
  return dayInfo(s.simTime, site);
}

/** Advance the economy by dt game-seconds (call at 1 Hz of game time). */
export function economyTick(s: GameState, site: SiteDef, mods: Mods, dt: number): EconEvents {
  if (missionLost(s)) return { modsChanged: false, victory: false, defeat: false, build: [] };
  const seen = new Map<string, number>();
  raised = seen;
  const ev = runTick(s, site, mods, dt);
  // the tick's end: every unit whose goal changed sets off now (core/transit.ts)
  transitPlan(s, mods, currentDay(s, site).isNight);
  raised = null;
  settleConditions(s, seen);
  return ev;
}

function runTick(s: GameState, site: SiteDef, mods: Mods, dt: number): EconEvents {
  const ev: EconEvents = { modsChanged: false, victory: false, defeat: false, build: [] };
  // the flow book's tick (docs/13 §3.1): what was made, and what was asked for
  const made: Partial<Record<ResourceId, number>> = {};
  const want: Partial<Record<ResourceId, number>> = {};
  const add = (book: Partial<Record<ResourceId, number>>, rid: ResourceId, amt: number) => {
    if (amt > 0) book[rid] = (book[rid] ?? 0) + amt;
  };
  const before = { ...s.resources };
  const day = currentDay(s, site);
  const robotic = s.expedition === 'robotic';
  // a robotic mission runs unmanned until Human Cohabitation brings settlers
  // (and a crewed one after its last crew rotated home, docs/14 §5); once
  // anyone is aboard, moods, life support, and crewed stations all apply
  const unmanned = isUnmanned(s);
  const workMult = unmanned ? 1 : moraleWorkMult(s.morale);
  const isAuto = (b: BuildingState) => b.automated || unmanned;
  const st = s.stats;
  // recipe overrides and flat kW deltas (a comms-loaded Lander turns consumer)
  const eff = (t: BuildingId) => effectiveDef(t, mods);
  // what each building does this tick, sun, dust and shade aside
  const rateCache = new Map<number, EffectiveRates>();
  const rateOpts = { robotic, workMult, isNight: day.isNight };
  const rates = (b: BuildingState): EffectiveRates => {
    let r = rateCache.get(b.id);
    if (!r) {
      // a hub runs on its own feed (docs/17 §3.2); the rest read the base's
      r = effectiveRates(b.type, mods, site, b, { ...rateOpts, agentRun: isAuto(b), feed: b.hub?.feed ?? s.feed,
        waterReclaim: waterReclaimFactor(s, mods) });
      rateCache.set(b.id, r);
    }
    return r;
  };
  // a new night: the per-night charter and insight accumulators start clean
  if (day.isNight && !s.wasNight) {
    st.nightCritDark = false;
    st.nightLoadShed = false;
    st.nightDcAllActive = true;
    st.nightBankEmpty = false;
  }

  // hubs get their state and their first unit as they commission (docs/17 §4.2)
  ensureHubs(s, mods, site);
  // ── 0 · construction rovers — the roster follows the docks; auto rovers
  // go one per site in queue order (placement order unless Build next), a
  // shut-down site keeps its place in line but frees its rover, pinned
  // rovers stay put, and a survey borrows one (core/fleet.ts). Then every
  // trip advances a second, and a site works only with the units that have
  // got there (core/transit.ts) ────────────
  const building = (b: BuildingState) => (b.construction ?? 0) > 0;
  syncRoster(s, mods);
  const crews = assignRovers(s);
  // (debug instant travel: a new goal is reached in the tick that sets it, as before transit)
  if (instantOf(s)) transitPlan(s, mods, false);
  // (docs/19 S4a: every unit's reservations are planned, in priority order, before any of them moves)
  planTraffic(s);
  const here: Arrivals = transitArrive(s, dt);
  /** a site's road is still to sinter: its crew works from the frontier */
  const roadFirst = (b: BuildingState) => !!b.spur?.length && spurLeft(s, b) > 0;
  /** the units working a site this tick: behind its road's frontier, else at its stands */
  const siteTeam = (b: BuildingState) => (roadFirst(b) ? here.front : here.weld).get(b.id) ?? [];
  const sites = s.buildings.filter(building).sort((a, b) => queuePos(a) - queuePos(b) || a.id - b.id);
  st.waitingSitesPeak = Math.max(st.waitingSitesPeak,
    sites.filter((b) => b.enabled && !crews.has(b.id)).length);
  for (const n of crews.values()) st.crowdedSiteMax = Math.max(st.crowdedSiteMax ?? 0, n);

  // hazards (docs/14 §3): what a hazard holds offline this tick, and who is off work
  const hzOff = new Map<number, string>();
  // (and a flare's hold on a legacy pad's excavator: rebooting, latched up, burned out — docs/16 §4.5)
  for (const b of s.buildings) { const o = hazardOff(s, b) || flareOff(s, b); if (o) hzOff.set(b.id, o); }
  const hzIdle = (b: BuildingState) => { b.active = false; b.idleReason = hzOff.get(b.id)!.startsWith('ON STRIKE') ? 'strike' : 'hazard'; };

  // ── 0.5 · generator staffing — crewed generators take workers first,
  // because every other station's power depends on them ───────────────
  let workers = s.crew - sickCrew(s);
  const staffed = new Set<number>();
  const crewedGen = (b: BuildingState) => eff(b.type).powerKW > 0 && BUILDINGS[b.type].crew > 0;
  for (const b of [...s.buildings].sort((a, c) => a.priority - c.priority || a.id - c.id)) {
    if (building(b) || !crewedGen(b)) continue;
    b.active = false;
    b.idleReason = '';
    if (!b.enabled) { b.idleReason = 'off'; continue; }
    if (hzOff.has(b.id)) { hzIdle(b); continue; }
    const need = isAuto(b) ? 0 : Math.max(0, BUILDINGS[b.type].crew + mods.crewDelta[b.type]);
    if (workers >= need) {
      workers -= need;
      staffed.add(b.id);
      b.active = true;
    } else {
      b.idleReason = 'crew';
    }
  }

  // ── 1 · power supply ───────────────────────────────────────────────
  let supply = 0;
  let capacity = 0;
  let solarNow = 0;   // this tick's solar share of supply
  let solarFull = 0;  // the same panels under a full sun (for the dusk forecast)
  const sunUp = day.sunFactor > 0.01;
  for (const b of s.buildings) {
    if (building(b)) continue;
    const def = eff(b.type);
    // shut down is off, as for a Storage Yard's caps: no upkeep, no storage
    if (!b.enabled) continue;
    // a bank's capacity × its capability: rad scars (docs/16 §4.13; the Lander never scars)
    if (def.storageKWh) capacity += def.storageKWh * (b.type === 'battery' ? mods.batteryCapMult : 1) * capOf(b);
    if (def.powerKW > 0) {
      if (crewedGen(b) && !staffed.has(b.id)) continue;
      // multipliers, wear, the agents' skim and a ridge's extra light
      const out = rates(b).powerKW;
      if (b.type === 'solar') {
        // a peak of light is never in terrain shade, and masts stand above it
        const shaded = !!b.shaded && !mods.solarShadeImmune && b.deposit !== 'ridge';
        if (sunUp) b.shadedT = shaded ? (b.shadedT ?? 0) + dt : 0;
        st.shadedMaxS = Math.max(st.shadedMaxS, b.shadedT ?? 0);
        const panel = out * (1 - b.dust) * (shaded ? 0.15 : 1);
        // a flare (docs/16 §4.3): stowed wings make nothing; scars and stowed damage derate; a wreck is dead
        notePanel(s, b.id, panel);
        const live = panel * solarMult(b);
        solarFull += b.wreck ? 0 : panel * (b.cap ?? 1) * (1 - (b.flareDmg ?? 0));
        solarNow += live * day.sunFactor;
        supply += live * day.sunFactor;
        continue;
      }
      supply += out;
    }
  }
  // the beam comes from the swarm, and a flare blinds it by class (docs/16 §4.2)
  if (mods.powerBeam) supply += s.launches * BEAM_KW_PER_LAUNCH * beamMult(s);
  // the Builder's power book: the same panels under a full sun, and what a night would leave
  const supplyFull = supply - solarNow + solarFull * site.solarDayMult;
  const supplyNight = supply - solarNow + solarFull * site.nightSolarFraction * site.solarDayMult;
  // a bank shut down or demolished takes the charge the rest cannot hold
  // (only when capacity drops: a debug grant above it still carries a night)
  const spilled = s.powerStored - capacity;
  if (capacity < (s.power?.capacity ?? capacity) && spilled > 0) {
    s.powerStored = capacity;
    if (spilled >= 1) {
      alert(s, `CHARGE LOST — ${Math.floor(spilled)} stored energy went with the bank; the grid holds ${Math.floor(capacity)} now`,
        'warn', { panel: 'power' });
    }
  }

  // ── 1.5 · stockpile caps (this tick's structures) ──────────────────
  const caps: Partial<Record<ResourceId, number>> = {};
  for (const b of s.buildings) {
    if (!b.enabled || building(b)) continue;
    for (const [rid, amt] of Object.entries(BUILDINGS[b.type].caps ?? {})) {
      caps[rid as ResourceId] = (caps[rid as ResourceId] ?? 0) + (amt ?? 0);
    }
  }
  // regolith lives in the hubs' hoppers (docs/17 §3.2); the structures' own
  // regolith room holds the pile: resources.regolith is their sum
  const pileCap = caps.regolith ?? 0;
  for (const b of s.buildings) if (b.hub && b.enabled && !building(b)) caps.regolith = (caps.regolith ?? 0) + hopperCap(b);
  s.storageCaps = caps;
  // a producer with no room for a tick of any of its outputs stands by: it
  // would only burn inputs, power and crew to make product lost on the ground.
  // (Room for a whole tick, not "below cap": upkeep nibbling a full yard
  // must not wake a fabricator every tick.)
  const outputFull = (b: BuildingState) => {
    // an excavator stands by only at the consumer, when there is no room for its load
    if (b.type === 'excavator') return haulWaiting(s, b, caps);
    const outs = Object.entries(rates(b).outputs) as [ResourceId, number][];
    return outs.length > 0 && outs.every(([rid, rate]) => caps[rid] !== undefined &&
      s.resources[rid] + rate * dt > caps[rid]!);
  };

  // ── 2 · demand + priority idling (construction sites and the fleet draw too) ─────
  // Within a priority: running structures, then construction sites, then
  // the fleet's own driving and road work, then its chargers (core/unitPower.ts)
  interface Draw {
    b: BuildingState | null; draw: number; prio: number;
    /** 0 a structure · 1 a construction site · 2 a unit's driving and road work · 3 a unit's charger */
    kind: 0 | 1 | 2 | 3;
    u?: PackUnit;
    /** a hub's print job (docs/17 §4.2): the hub's id */
    print?: number;
    /** a charger plugged in through a site's feed or an excavator's own: it charges only if that is lit */
    via?: number;
  }
  const wants: Draw[] = [];
  for (const b of s.buildings) {
    if (building(b)) {
      // an active construction site pulls welding power at its building's
      // idle priority: each rover there draws its own (one on its way, none)
      const n = siteTeam(b).length;
      if (n > 0) wants.push({ b, draw: crewKW(mods, n) * dt, prio: b.priority, kind: 1 });
      continue;
    }
    if (eff(b.type).powerKW >= 0) continue;
    if (b.enabled && hzOff.has(b.id)) { hzIdle(b); continue; }
    if (b.enabled && outputFull(b)) { b.active = false; b.idleReason = 'full'; continue; }
    // autonomous agents trade crew and morale for watts (1 + agentTax); night
    // and day draw multipliers and overclock ride the same number; an
    // infected node's phantom load rides it too (docs/14 §3.5)
    wants.push({ b, draw: -rates(b).powerKW * dt * hazardDrawMult(s, b), prio: b.priority, kind: 0 });
  }
  // the fleet (docs/02 · On-board power): each unit's driving and road work at its
  // priority (its site's, else its dock's), and a charger wherever it is
  // plugged in and not full — at its home, or through a site's feed
  const units = packUnits(s);
  const unitOf = new Map<RoverUnit, PackUnit>();
  for (const u of units) if (u.kind === 'rover' || u.kind === 'drone') unitOf.set(u.unit, u);
  const onJob = new Set<RoverUnit>();
  for (const team of here.jobs.values()) for (const r of team) onJob.add(r);
  // a rover levelling its cell draws the same as one sintering (docs/19 S5)
  for (const team of here.grade.values()) for (const r of team) onJob.add(r);
  const drives = (u: PackUnit) => (u.kind === 'rover' || u.kind === 'drone') && !!u.unit.trip && !u.unit.trip.stuck && u.unit.trip.t < u.unit.trip.dur - 1e-9;
  // a hub unit's use (docs/17 §4.5): digging its nameplate (a working face), driving its tracks
  const haulerUse = (u: PackUnit): number => {
    if (u.kind !== 'hauler') return 0;
    const hb = hubOf(s, u.h);
    const h = u.h.haul;
    if (!hb?.enabled && h.phase !== 'toBay' && h.phase !== 'toDrop' && h.phase !== 'unload') return 0;
    if (h.phase === 'dig' && !h.full) return -unitRates(s, mods, site, u.h, targetOf(s, u.h.target)?.kind, day.isNight).powerKW;
    if ((h.phase === 'toDig' || h.phase === 'toDrop' || h.phase === 'toBay') && h.path.length > 0) return driveKW('digger', mods);
    return 0;
  };
  for (const u of units) {
    const prio = unitPriority(s, u);
    if (u.kind === 'rover' || u.kind === 'drone') {
      const use = (drives(u) ? driveKW(u.kind, mods) : 0) + (onJob.has(u.unit) ? crewKW(mods, 1) : 0);
      if (use > 0) wants.push({ b: null, draw: use * dt, prio, kind: 2, u });
    }
    if (u.kind === 'hauler') {
      const use = haulerUse(u);
      if (use > 0) wants.push({ b: null, draw: use * dt, prio, kind: 2, u });
      if (!hubOf(s, u.h)?.enabled) continue; // its hub shut down: its bays are dark
    }
    if (u.kind === 'digger' && !u.b.enabled) continue;
    const pk = powerKind(u);
    const cap = packCap(pk, mods);
    const room = cap - chargeOf(u.pack, cap);
    if (room <= 1e-9) continue;
    const via = atHome(s, u) ? (u.kind === 'digger' ? u.b.id : u.kind === 'hauler' ? u.h.hub : -1) : atSiteStand(u);
    if (via === null) continue;
    wants.push({ b: null, draw: (Math.min(chargeKW(pk), room / dt) / mods.chargeEff) * dt, prio, kind: 3, u, via });
  }
  // a hub's print job draws a construction rover's kW at the hub's priority (docs/17 §4.2)
  for (const b of s.buildings) {
    if (!b.hub || building(b) || !printing(b)) continue;
    wants.push({ b: null, draw: HUB.printKW * mods.constructionKWMult * dt, prio: b.priority, kind: 2, print: b.id });
  }
  // the flare's critical feed reads what priority 0–1 structures ask (docs/16 §5.3)
  let critKW = 0;
  for (const w of wants) if (w.kind === 0 && w.prio <= 1 && w.b!.enabled) critKW += w.draw / dt;
  // within a priority, running loads keep their power ahead of new construction
  const drawOrder = (w: Draw) => (w.kind === 1 ? queuePos(w.b!) : w.b ? w.b.id : 0);
  wants.sort((a, b) => a.prio - b.prio || a.kind - b.kind || drawOrder(a) - drawOrder(b));
  if (GRID.dark) supply = 0;
  let budget = GRID.dark ? 0 : supply * dt + s.powerStored;
  let supplyLeft = supply * dt;
  let demand = 0; // requested — loads held dark still want their watts
  let drawn = 0;
  let fleetKW = 0, chargingKW = 0;
  const powered = new Set<number>();
  const darkIds = new Set<number>();
  /** the units whose driving and road work the grid served, and whose chargers it fed */
  const onGrid = new Set<string>();
  const charged = new Set<string>();
  /** hubs whose print job the grid served */
  const printLit = new Set<number>();
  // a brownout sheds priority 2–3 whole: once a priority 0–1 structure is
  // dark, no lower load takes what is left (it would dig or weld through the
  // brownout on the budget the critical load could not use); in a load shed
  // the loads left fit what they can, as before
  let critDark = false;
  const dark: Draw[] = [];
  for (const w of wants) {
    if (w.kind === 3 && w.via !== undefined && w.via >= 0 && darkIds.has(w.via)) continue; // its feed is dark
    if (w.kind === 0) {
      w.b!.active = false;
      w.b!.idleReason = '';
      if (!w.b!.enabled) { w.b!.idleReason = 'off'; continue; }
    }
    demand += w.draw / dt;
    if (w.kind >= 2 && w.print === undefined) { fleetKW += w.draw / dt; if (w.kind === 3) chargingKW += w.draw / dt; }
    // hysteresis: a browned-out building stays dark for a few seconds before
    // retrying, so marginal grids don't strobe the base on and off — but it
    // comes back in priority order once the grid carries it with margin: from
    // this tick's supply alone, or from the bank for the rest of its hold
    // (the fleet's small loads have no hold: their packs ride the flicker)
    const hold = w.b?.brownoutHold ?? 0;
    if (w.b && hold > 0) w.b.brownoutHold = hold - 1;
    const margin = w.draw * POWER_RELEASE_MARGIN;
    const fits = critDark && w.prio >= 2 ? false
      : hold > 0 ? supplyLeft >= margin || budget >= margin * hold
      : w.draw <= budget;
    if (fits) {
      if (w.b) w.b.brownoutHold = 0;
      budget -= w.draw;
      supplyLeft = Math.max(0, supplyLeft - w.draw);
      drawn += w.draw;
      if (w.u) (w.kind === 2 ? onGrid : charged).add(unitKey(w.u));
      else if (w.print !== undefined) printLit.add(w.print);
      else powered.add(w.b!.id);
    } else {
      if (w.b && hold === 0 && !(critDark && w.prio >= 2)) w.b.brownoutHold = BROWNOUT_HOLD_S;
      if (w.b) darkIds.add(w.b.id);
      if (w.kind === 0 && w.prio <= 1) critDark = true;
      dark.push(w);
    }
  }
  // a dark priority 0–1 load is a brownout; idling only 2–3 is load shedding.
  // A paused construction site is never a brownout: nobody lives in it yet
  // (and a unit's driving or charger held dark is the fleet's, never a brownout)
  let brownout = false;
  let shed = false;
  for (const w of dark) {
    if (w.kind === 0) w.b!.idleReason = 'power';
    if (w.prio <= 1 && w.kind === 0) brownout = true;
    else shed = true;
  }
  if (brownout && !day.isNight && !s.power.brownout) st.dayBrownouts += 1;
  if (day.isNight && brownout) st.nightCritDark = true;
  if (day.isNight && (brownout || shed)) st.nightLoadShed = true;
  // how long each load has been held dark at night — leaky, so a load the
  // brownout hold lets back on for one tick in nine still counts as dark;
  // a farm dark too long loses its crop
  const darkNow = new Set(dark.filter((w) => w.kind === 0).map((w) => w.b!.id));
  for (const b of s.buildings) {
    if (building(b)) continue;
    const was = b.darkT ?? 0;
    b.darkT = day.isNight && darkNow.has(b.id) ? was + dt : Math.max(0, was - dt);
    st.darkNightMaxS = Math.max(st.darkNightMaxS, b.darkT);
    if (b.type === 'hydroponics' && was <= CROP_LOSS.darkS && b.darkT > CROP_LOSS.darkS) {
      b.cropRegrowT = CROP_LOSS.regrowS;
      alert(s, `CROP LOST — Hydroponics #${b.id} went dark ${CROP_LOSS.darkS} s; ` +
        `regrowing ${fmtClock(CROP_LOSS.regrowS)}`, 'warn', { select: b.id });
    }
  }

  // ── 2.5 · construction progress: needs a rover there, power, AND
  // parts; n rovers build n^0.85 times as fast, on the same weld parts per
  // build. A rover on its way does nothing yet. Power: the site's grid draw,
  // else each rover's own pack (its RPU first) — the crew works at the share
  // its packs carry, and a crew out of charge waits for the grid (docs/02 · On-board power) ──
  const packs = new PackTick(mods, dt);
  for (const b of sites) {
    b.active = false;
    delete b.onPack;
    if (!b.enabled) { b.idleReason = 'off'; continue; }
    if ((crews.get(b.id) ?? 0) === 0) { b.idleReason = 'queued'; continue; }
    const road = roadFirst(b);
    const team = siteTeam(b);
    const crew = team.length;
    if (crew === 0) {
      // assigned, but nobody there: on its way, stepping to the next cell, or no road to it
      const w = siteTransit(s, b.id).wait;
      b.idleReason = w === 'enroute' ? 'enroute' : w === 'noroad' ? 'noroad' : road ? 'road' : 'building';
      continue;
    }
    // welding consumables first: nobody spends a pack on a weld with no parts
    // (a flare's repair pays its own parts up front, and clearing a wreck welds nothing: docs/16 §4.3)
    const flareJob = !!b.fix || b.wreck?.job === 'clear';
    if (flareJob && siteParts(s, b) === 'short') {
      b.idleReason = 'inputs';
      condition(s, 'repair-parts', `REPAIRS WAITING — ${b.fix?.parts ?? 0}⚙ to repair Solar Array #${b.id}`, 'warn', { panel: 'parts' });
      continue;
    }
    const weld = road || flareJob ? 0 : crewParts(mods, crew) * dt;
    if (!road && !flareJob) {
      add(want, 'parts', weld);
      if (s.resources.parts < weld) {
        b.idleReason = 'inputs'; // welding consumables ran dry
        condition(s, 'stalled', 'CONSTRUCTION STALLED — no parts for welding', 'warn', { panel: 'parts' });
        continue;
      }
    }
    // the grid's draw, or each rover's pack: the share of the crew at work
    const lit = powered.has(b.id);
    const shares = team.map((r) => {
      const u = unitOf.get(r);
      if (!u) return lit ? 1 : 0;
      if (lit) { packs.grid(u); return 1; }
      return packs.pay(u, crewKW(mods, 1) * dt);
    });
    const at = shares.reduce((a, f) => a + f, 0) / crew;
    if (at <= 1e-9) { b.idleReason = 'power'; continue; }
    if (!lit) b.onPack = true;
    const working = team.filter((_, i) => shares[i] > 1e-9);
    // scarred rovers weld and sinter at their capability; the blackout takes Earth Teleoperation's speed (docs/16 §4.8, §4.13)
    const fx = teamCap(working) * weldFlareMult(s);
    // its road first: the crew sinters the spur out to the door, cell by
    // cell from the network, stepping on to each cell it opens (the crew's
    // draw, no weld parts), then welds (core/roads.ts)
    if (road) {
      b.idleReason = 'road';
      sinter(s, b.spur!, dt * at * fx * mods.weldRateMult * crewRate(crew) / mods.roadCellMult);
      for (const r of working) r.task = 'sinter';
      if (spurLeft(s, b) === 0) b.spur = [];
      continue;
    }
    s.resources.parts -= weld * at;
    b.idleReason = 'building';
    for (const r of working) r.task = 'weld';
    b.construction = Math.max(0, (b.construction ?? 0) - dt * at * fx * mods.weldRateMult * crewRate(crew));
    if (b.construction === 0) {
      b.idleReason = '';
      delete b.onPack;
      // a repair, a rebuild or a cleared wreck (docs/16 §4.3) is no new building
      if (siteDone(s, b)) continue;
      st.built += 1;
      alert(s, `CONSTRUCTION COMPLETE — ${BUILDINGS[b.type].name}`, 'info', { select: b.id });
    }
  }
  // ── 2.6 · free rovers sinter the roads drawn and the haul roads, oldest
  // first, one rover a job, from the frontier it stands behind: the work is
  // each rover's own load at its dock's priority, else its pack's ──
  if (s.roadJobs?.length) {
    for (const j of s.roadJobs) {
      const team = here.jobs.get(j.id) ?? [];
      if (!team.length) continue;
      const shares = team.map((r) => {
        const u = unitOf.get(r);
        if (!u) return 1;
        if (onGrid.has(unitKey(u))) { packs.grid(u); return 1; }
        return packs.pay(u, crewKW(mods, 1) * dt);
      });
      const at = shares.reduce((a, f) => a + f, 0) / team.length;
      if (at <= 1e-9) continue;
      sinter(s, j.cells, dt * at * teamCap(team) * weldFlareMult(s) * mods.weldRateMult * crewRate(team.length) / mods.roadCellMult);
      team.forEach((r, i) => { if (shares[i] > 1e-9) r.task = 'sinter'; });
    }
    settleJobs(s);
  }
  // ── 2.65 · box-drag grading (docs/19 S5, core/grading.ts): the rovers at their stands level their job's cells,
  // each at its own share of the tick (the grid, else its pack: as a sinter), Site Grading doubling the rate ──
  if (s.gradeJobs?.length) {
    gradeStep(s, mods, here.grade, (r) => {
      const u = unitOf.get(r);
      if (!u) return 1;
      if (onGrid.has(unitKey(u))) { packs.grid(u); return 1; }
      return packs.pay(u, crewKW(mods, 1) * dt);
    }, dt);
  }
  // ── 2.7 · the fleet's driving: on the grid, else the pack; an excavator
  // whose grid draw is dark digs and drives on its own (its phase's draw) —
  // step 4 runs its cycle at the share its pack carries ──
  const diggerShare = new Map<number, number>();
  /** hub units: the share of their tick they work (their pack's, in a brownout) */
  const haulerShare = new Map<number, number>();
  for (const u of units) {
    if (u.kind === 'hauler') {
      const use = haulerUse(u);
      if (use <= 0) continue;
      if (onGrid.has(unitKey(u))) { packs.grid(u); continue; }
      haulerShare.set(u.h.id, packs.pay(u, use * dt));
      continue;
    }
    if (u.kind === 'digger') {
      const b = u.b;
      if (powered.has(b.id)) { packs.grid(u); continue; }
      if (!darkNow.has(b.id)) continue; // shut down, standing by, or held by a hazard: it draws nothing
      const h = u.pack;
      const kw = h.phase === 'dig' && !h.full ? -rates(b).powerKW : driveKW('digger', mods);
      const f = packs.pay(u, kw * dt);
      if (f > 1e-9) { diggerShare.set(b.id, f); b.idleReason = ''; b.onPack = true; }
      continue;
    }
    if (!drives(u)) continue;
    if (onGrid.has(unitKey(u))) packs.grid(u);
    else packs.pay(u, driveKW(powerKind(u), mods) * dt);
  }
  for (const b of s.buildings) if (b.type === 'excavator' && !diggerShare.has(b.id)) delete b.onPack;
  packs.finish(units, charged);
  // the share of its clock a unit drives on next tick (the visuals read it off the trip)
  let flat = 0, stalled = 0;
  for (const u of units) {
    if (u.pack.src === 'flat') { flat++; if ((u.pack.flatT ?? 0) >= UNIT_POWER.alertS) stalled++; }
    if (u.kind === 'digger' || u.kind === 'hauler') continue;
    const t = u.unit.trip;
    if (!t) continue;
    if (u.pack.pw !== undefined) t.rate = u.pack.pw; else delete t.rate;
  }
  if (stalled) {
    condition(s, 'flat', `OUT OF CHARGE — ${flat} unit${flat === 1 ? '' : 's'} waiting for the grid; ` +
      'batteries, or bigger packs (Rover Power Packs), carry them through', 'warn', { panel: 'bots' });
  }
  // settle storage: net energy this tick
  const net = supply * dt - drawn;
  if (net >= 0) s.powerStored = Math.min(capacity, s.powerStored + net * mods.storageEff);
  else s.powerStored = Math.max(0, s.powerStored + net);
  let construction = 0;
  for (const w of wants) if (w.kind === 1) construction += w.draw / dt;
  s.power = {
    supply, demand, served: drawn / dt, capacity, brownout, shed, supplyFull, supplyNight, construction,
    fleet: fleetKW, charging: chargingKW, flat, crit: critKW, solar: solarNow,
  };
  // the bank could not carry the night (the Builder's battery rule answers at dawn)
  if (day.isNight && (brownout || shed) && s.powerStored < Math.max(1, capacity * 0.05)) st.nightBankEmpty = true;
  if (brownout) {
    condition(s, 'brownout', day.isNight
      ? 'BROWNOUT — night demand exceeds stored power'
      : 'BROWNOUT — grid demand exceeds supply', 'crit', { panel: 'power' });
  } else if (shed) {
    condition(s, 'shed', 'LOAD SHED — low-priority systems idled to protect the grid', 'info', { panel: 'power' });
  }
  // a minute before dusk: what the bank will carry through the night
  if (!day.isNight && day.phaseLeft <= DUSK_WARN_S) {
    const nightSupply = supply - solarNow + solarFull * site.nightSolarFraction * site.solarDayMult;
    const short = demand - nightSupply;
    const runway = short > 0 ? s.powerStored / short : Infinity;
    const lead = `NIGHTFALL IN ${Math.ceil(day.phaseLeft)} s`;
    const wx = duskLine(s); // a flare under way, or the spot-group watch (docs/16 §5.6)
    // the hazards' lines: habitats or Data Centers the bank will not carry (docs/14 §3.4–3.5)
    const upTo = (p: number) => wants.filter((w) => w.kind === 0 && w.prio <= p).reduce((n, w) => n + w.draw / dt, 0);
    const hzLine = runway < NIGHT_S ? hazardDuskLine(s, mods, nightSupply, runway, upTo) : null;
    if (hzLine) {
      condition(s, 'dusk', `${lead} — ${Math.floor(s.powerStored)} stored lasts ~${fmtClock(runway)} of the ` +
        `${fmtClock(NIGHT_S)} night at ${Math.ceil(short)} kW short${hzLine.text}${wx}`, 'warn', { panel: 'power' });
      attachCounters(s, 'dusk', hzLine.counters);
    } else if (short <= 0) {
      condition(s, 'dusk', `${lead} — night supply carries the base${wx}`, 'info', { panel: 'power' });
    } else if (runway >= NIGHT_S) {
      condition(s, 'dusk', `${lead} — ${Math.floor(s.powerStored)} stored carries the night at ${Math.ceil(short)} kW short${wx}`,
        'info', { panel: 'power' });
    } else {
      condition(s, 'dusk', `${lead} — ${Math.floor(s.powerStored)} stored lasts ~${fmtClock(runway)} of the ` +
        `${fmtClock(NIGHT_S)} night at ${Math.ceil(short)} kW short; lower priorities or shut down${wx}`, 'warn', { panel: 'power' });
    }
  }

  // ── 3 · worker allocation (priority order) ─────────────────────────
  for (const b of [...s.buildings].sort((a, c) => a.priority - c.priority || a.id - c.id)) {
    if (building(b) || crewedGen(b)) continue;
    const def = eff(b.type);
    const need = isAuto(b) ? 0 : Math.max(0, def.crew + mods.crewDelta[b.type]);
    if (!b.enabled || need === 0) { staffed.add(b.id); continue; }
    if (def.powerKW < 0 && !powered.has(b.id)) continue; // already power-idled
    if (workers >= need) { workers -= need; staffed.add(b.id); }
    else if (b.idleReason === '') b.idleReason = 'crew';
  }
  // EVA crews (Crew Rotation Charter): by day, a share of the free hands goes
  // outside — dust off the arrays, hands on the worn machines. Nobody walks
  // out into a flare (docs/14 §2.7)
  const eva = mods.evaShare > 0 && s.crew > 0 && workers > 0 && !day.isNight && !flareStorm(s) && !evaHeld(s, mods)
    ? Math.ceil(workers * mods.evaShare) : 0;
  s.evaCrew = eva;

  // ── 3.5 · agents cover the gaps: once stations can run on agents, one
  // left short-handed goes agent-run from the next tick (at the agents'
  // power), and every 30 s the settlers left free take covered stations
  // back, priority first. A station the player crewed by hand stays crewed.
  if (s.agentCover !== false && !unmanned && canToggleCrew(s.expedition, s.crew, mods)) {
    const covered: BuildingState[] = [];
    for (const b of s.buildings) {
      if (b.idleReason !== 'crew' || b.automated || b.crewPinned || building(b) || !b.enabled) continue;
      b.automated = true;
      b.agentCover = true;
      covered.push(b);
    }
    // one line per type (a repeat counts up ×n rather than stacking)
    for (const type of new Set(covered.map((b) => b.type))) {
      alert(s, `AGENTS COVER ${BUILDINGS[type].name.toUpperCase()} — no crew free; agent-run at ` +
        `×${(1 + mods.agentTax).toFixed(1)} power until settlers free up`, 'info',
        { select: covered.find((b) => b.type === type)!.id });
    }
    if (Math.floor(s.simTime / 30) !== Math.floor((s.simTime - dt) / 30)) {
      const back = s.buildings.filter((b) => b.agentCover && b.automated && !building(b))
        .sort((a, c) => a.priority - c.priority || a.id - c.id);
      for (const b of back) {
        const need = Math.max(0, eff(b.type).crew + mods.crewDelta[b.type]);
        if (need > workers) continue;
        workers -= need;
        b.automated = false;
        b.agentCover = false;
      }
    }
  }

  // ── 4 · production in tier order (a tick's regolith can smelt same tick) ──
  // the crew drinks first: production may not touch the last few minutes of
  // life support, so a farm idles before it takes the crew's water
  const lsMult = mods.inputMult['habitat'];
  const reserve: Partial<Record<ResourceId, number>> = {
    oxygen: crewReserve(s, mods, 'oxygen'),
    food: crewReserve(s, mods, 'food'),
    water: crewReserve(s, mods, 'water'),
  };
  const byType = new Map<BuildingId, BuildingState[]>();
  for (const b of s.buildings) {
    if (!byType.has(b.type)) byType.set(b.type, []);
    byType.get(b.type)!.push(b);
  }
  const runs = (b: BuildingState) => b.enabled && !building(b) && staffed.has(b.id) && !hzOff.has(b.id) &&
    (eff(b.type).powerKW >= 0 || powered.has(b.id) || diggerShare.has(b.id));
  // agent-run labs share one DSN link: the share counts every agent lab that
  // runs this tick (labs have no inputs, so each that is powered and staffed runs)
  const share = uplinkShare((byType.get('lab') ?? []).filter((b) => runs(b) && isAuto(b)).length);
  let smelterO2 = 0; // this tick's smelter oxygen, for the crew rotation's check
  let ilmeniteDug = false;
  // excavators credit their loads on unload (core/haul.ts): the lumps, and
  // the cycles' average delivery the smoothed net rates count instead
  const hauled: Partial<Record<ResourceId, number>> = {};
  const haulFlow: Partial<Record<ResourceId, number>> = {};
  // ── 4.1 · hub units (docs/17 §4.5): after the legacy pads, every unit in id
  // order digs, drives and tips into its own hub's hopper; hubs then draw from
  // their own hoppers (the pile first). The prints pay and progress here ──
  const unitsStep = () => {
    reconcileRegolith(s); // grants, grading, research goods, a legacy pad's load: the pile
    pitNews(s, mods, site); // pits dug out or hemmed in: their units choose again (docs/17 §10.2)
    const gone = joinLegacy(s, mods, site);
    if (gone.length) ev.wrecked = [...(ev.wrecked ?? []), ...gone];
    for (const b of s.buildings) if (b.hub) b.hub.drew = 0;
    for (const u of s.haulers) {
      const hb = hubOf(s, u);
      if (!hb) continue;
      // a flare reboot holds it where it stands (docs/16 §4.5)
      if (rebooting(s, u)) continue;
      const o = unitTick(s, mods, site, u, hb, dt * (haulerShare.get(u.id) ?? 1), day.isNight, caps);
      if (o.tipped > 0) { hauled.regolith = (hauled.regolith ?? 0) + o.tipped; st.produced.regolith += o.tipped; }
      for (const [rid, amt] of Object.entries(o.credited) as [ResourceId, number][]) {
        hauled[rid] = (hauled[rid] ?? 0) + amt;
        st.produced[rid] += amt;
      }
      for (const [rid, f] of Object.entries(o.flow) as [ResourceId, number][]) {
        haulFlow[rid] = (haulFlow[rid] ?? 0) + f;
        add(made, rid, f * dt);
      }
      if (o.dugS > 0 && o.kind === 'ilmenite') ilmeniteDug = true;
    }
    printTick(s, mods, site, dt, printLit);
    writeRegolith(s);
  };
  for (const type of PROD_ORDER) {
    if (type === 'smelter') unitsStep();
    const list = byType.get(type);
    if (!list) continue;
    for (const b of list) {
      if (!runs(b)) continue;
      // recipe, multipliers, agents, morale, wear, overclock, feed, site and deposit
      const r = effectiveRates(type, mods, site, b, {
        ...rateOpts, agentRun: isAuto(b), feed: b.hub?.feed ?? s.feed, uplinkShare: share,
        waterReclaim: waterReclaimFactor(s, mods),
      });
      // what it asks for counts as demand, covered or not (the flow book)
      for (const [rid, rate] of Object.entries(r.inputs)) add(want, rid as ResourceId, (rate ?? 0) * dt);
      // inputs (a hub's regolith: the pile, then its own hopper)
      const hub = isHubType(type) && b.hub ? b : null;
      let short: '' | 'inputs' | 'reserve' = '';
      for (const [rid, rate] of Object.entries(r.inputs)) {
        const need = (rate ?? 0) * dt;
        const have = hub && rid === 'regolith' ? hubHave(s, hub) : s.resources[rid as ResourceId];
        if (have < need) { short = 'inputs'; break; }
        if (have - (reserve[rid as ResourceId] ?? 0) < need) short = 'reserve';
      }
      if (hub) {
        noteStarved(hub, short === 'inputs', dt); // (its q is the grade its units tip: core/hubs.ts)
      }
      if (short) { b.idleReason = short; continue; }
      for (const [rid, rate] of Object.entries(r.inputs)) {
        if (hub && rid === 'regolith') { hubDraw(s, hub, (rate ?? 0) * dt); continue; }
        s.resources[rid as ResourceId] -= (rate ?? 0) * dt;
      }
      if (type === 'excavator') {
        // on its pack in a brownout: its cycle runs at the share the pack carries
        const h = haulTick(s, mods, b, r, dt * (diggerShare.get(b.id) ?? 1), caps, day.isNight);
        for (const [rid, amt] of Object.entries(h.credited) as [ResourceId, number][]) {
          hauled[rid] = (hauled[rid] ?? 0) + amt;
          st.produced[rid] += amt;
        }
        for (const [rid, f] of Object.entries(h.flow) as [ResourceId, number][]) {
          haulFlow[rid] = (haulFlow[rid] ?? 0) + f;
          add(made, rid, f * dt);
        }
        if (h.dugS > 0 && b.deposit === 'ilmenite') ilmeniteDug = true;
        if (h.note) alert(s, h.note, 'warn', { select: b.id });
        b.active = true;
        continue;
      }
      // outputs — a farm that lost its crop is regrowing and makes nothing yet;
      // a hazard's multiplier (infected, blighted, a fouled loop, the control plane)
      const regrowing = (type === 'hydroponics' || type === 'greenhouseRing') && (b.cropRegrowT ?? 0) > 0;
      // (and a flare's by class: labs, Chip Fab yield, compute errors — docs/16 §4.6, §4.7)
      const hzMult = hazardOutputMult(s, b) * flareOutputMult(s, mods, site, b);
      if (regrowing) b.cropRegrowT = Math.max(0, b.cropRegrowT! - dt);
      else {
        for (const [rid, rate] of Object.entries(r.outputs)) {
          const amt = (rate ?? 0) * dt * hzMult;
          s.resources[rid as ResourceId] += amt;
          st.produced[rid as ResourceId] += amt;
          add(made, rid as ResourceId, amt);
        }
      }
      if (type === 'smelter') smelterO2 += r.outputs.oxygen ?? 0;
      // labs (uplink share on agent-run ones, crewed ones scale with morale)
      // and data centers: the same numbers researchRates reports
      s.data += r.data * dt * hzMult;
      b.active = true;
    }
  }
  if (ilmeniteDug) st.ilmeniteDigS += dt;
  // ▲ is the hoppers' sum and the pile (the pile over its room is lost on the ground);
  // the base's feed is the hubs' feeds weighted by what each drew
  s.pile = Math.min(s.pile ?? 0, pileCap);
  writeRegolith(s);
  const fed = meanFeed(s);
  if (fed) {
    // an EMA by amount, as a hub's own feed is (HAUL.feedMemory)
    const drew = s.buildings.reduce((n, b) => n + (b.hub?.drew ?? 0), 0);
    const k = drew / (drew + HAUL.feedMemory);
    const was = FEED_KINDS.reduce((n, f) => n + s.feed[f], 0) > 1e-9;
    for (const f of FEED_KINDS) s.feed[f] = was ? s.feed[f] * (1 - k) + fed[f] * k : fed[f];
  }
  // ── 4.2 · pits: what was dug deforms the ground (core/pits.ts, docs/17 §11);
  // pits run out, box in and reopen for bedrock (§10); 4.3 · deposit surveys (§13) ──
  pitsStep(s, dt, mods);
  oreSurveyStep(s, mods, dt);
  // structures with no inputs/outputs/crew that were powered count as active
  // (crewed generators were settled by the staffing pass)
  for (const b of s.buildings) {
    if (building(b) || hzOff.has(b.id)) continue;
    const def = eff(b.type);
    if (def.powerKW >= 0 && Object.keys(def.outputs).length === 0 && def.crew === 0) b.active = b.enabled && !b.wreck;
    if (b.enabled && def.powerKW < 0 && powered.has(b.id) && Object.keys(def.outputs).length === 0
        && Object.keys(def.inputs).length === 0 && staffed.has(b.id)) b.active = true;
  }
  const dcActive = s.buildings.some((b) => isCompute(b.type) && b.active);
  if (dcActive) st.dcOpS += dt;
  if (day.isNight && !dcActive) st.nightDcAllActive = false;
  // later steps read post-production rates (and this tick's feed grade)
  rateCache.clear();

  // ── 4.5 · stockpile caps: excess production is lost on the ground ──
  for (const [rid, cap] of Object.entries(caps)) {
    const r = rid as ResourceId;
    if (s.resources[r] > (cap ?? 0)) s.resources[r] = cap ?? 0;
    // full within a couple of percent: producers top up and stand by there
    if (s.resources[r] >= (cap ?? 0) - Math.max(1, (cap ?? 0) * 0.02)) {
      // a byproduct tank topping off is routine; a full yard idles its producers
      condition(s, `full:${r}`, r === 'oxygen' || r === 'water'
        ? `TANKS FULL — surplus ${r} vented`
        : `STORAGE FULL — ${r} at capacity; its producers stand by until a Storage Yard adds room`, 'info', { panel: r });
    }
  }

  // ── 5 · life support & crew (nobody aboard → nothing to keep alive) ─
  const o2Need = s.crew * CREW.oxygenPerCrew * lsMult * dt;
  const foodNeed = s.crew * CREW.foodPerCrew * lsMult * dt;
  const waterMult = waterReclaimFactor(s, mods);
  const waterNeed = s.crew * CREW.waterPerCrew * lsMult * waterMult * dt;
  add(want, 'oxygen', o2Need);
  add(want, 'food', foodNeed);
  add(want, 'water', waterNeed);
  const o2ok = s.crew <= 0 || s.resources.oxygen >= o2Need;
  const foodok = s.crew <= 0 || s.resources.food >= foodNeed;
  const waterok = s.crew <= 0 || s.resources.water >= waterNeed;
  s.resources.oxygen = Math.max(0, s.resources.oxygen - o2Need);
  s.resources.food = Math.max(0, s.resources.food - foodNeed);
  s.resources.water = Math.max(0, s.resources.water - waterNeed);
  let housing = 0;
  for (const b of s.buildings) {
    const def = effectiveDef(b.type, mods);
    if (!def.housing || !b.enabled || building(b)) continue;
    if (def.powerKW < 0 && !powered.has(b.id)) continue;
    if (hazardBedsOff(s, b)) continue; // evacuated, breached, decompressed (docs/14 §3.4)
    housing += def.housing;
  }
  s.housingActive = housing;
  if (!o2ok || !foodok || !waterok) {
    s.starveT += dt;
    const gone = !o2ok ? 'oxygen' : !waterok ? 'water' : 'food';
    condition(s, 'depleted', !o2ok ? 'OXYGEN DEPLETED — crew is suffocating'
      : !waterok ? 'WATER DEPLETED — crew is dehydrating'
      : 'FOOD DEPLETED — crew is starving', 'crit', { panel: gone });
    if (s.starveT > CREW.starveGraceS) {
      const losses = Math.floor((s.starveT - CREW.starveGraceS) / CREW.lossPeriodS);
      if (losses > 0) {
        s.starveT = CREW.starveGraceS;
        if (s.crew > 0) {
          // CREW LOST with its cause, and grief (docs/14 §3.10)
          const c = starveCause(s, gone);
          killCrew(s, 1, c.cause, c.hazard, c.warnedAt, '', { panel: gone });
        }
      }
    }
  } else {
    s.starveT = Math.max(0, s.starveT - dt);
  }
  // low reserves breed anxiety long before they kill: below ~5 minutes of
  // supply the crew notices, and morale sinks (robots notice nothing)
  const o2Rate = Math.max(1e-6, s.crew * CREW.oxygenPerCrew * lsMult);
  const foodRate = Math.max(1e-6, s.crew * CREW.foodPerCrew * lsMult);
  const waterRate = Math.max(1e-6, s.crew * CREW.waterPerCrew * lsMult * waterMult);
  const o2Anxious = s.crew > 0 && s.resources.oxygen / o2Rate < LOW_SUPPLY_S;
  const foodAnxious = s.crew > 0 && s.resources.food / foodRate < LOW_SUPPLY_S;
  const waterAnxious = s.crew > 0 && s.resources.water / waterRate < LOW_SUPPLY_S;
  if (o2Anxious) condition(s, 'low:oxygen', 'OXYGEN RESERVES LOW — the crew is anxious', 'warn', { panel: 'oxygen' });
  if (foodAnxious) condition(s, 'low:food', 'FOOD RESERVES LOW — the crew is anxious', 'warn', { panel: 'food' });
  if (waterAnxious) condition(s, 'low:water', 'WATER RESERVES LOW — the crew is anxious', 'warn', { panel: 'water' });
  if (s.crew > 0) {
    st.minReserveS = Math.min(st.minReserveS,
      s.resources.oxygen / o2Rate, s.resources.food / foodRate, s.resources.water / waterRate);
  }
  // the base falls silent when the last crewmember dies (humans only —
  // a robotic mission has no one to lose)
  if (!robotic && s.crew <= 0 && !s.defeatShown && !s.crewHome) {
    ev.defeat = true;
    s.paused = true;
    return ev;
  }
  // growth — robotic missions attract settlers only after Human Cohabitation
  // (its crew rotation boards first), and nobody boards a base that cannot
  // keep one more alive
  const sustainable = boardingShortfall(s, lsMult, waterMult) === '';
  // a destiny sets the pace: charters invite settlers faster, a Lights-Out
  // Charter invites none, and a crew sent home at FIRST LIGHT does not return
  const invited = mods.growthMult > 0 && !s.crewHome;
  if (settlersWelcome(s) && invited && !s.crewRotation && sustainable && s.morale > CREW.growthMorale && s.crew < housing &&
      o2ok && foodok && waterok && !growthHeld(s)) {
    s.growthT += dt;
    if (s.growthT >= CREW.growthPeriod * mods.growthMult) {
      s.growthT = 0;
      s.crew += 1;
      alert(s, 'ARRIVAL — a new crewmember has joined the base', 'info', { panel: 'crew' });
      if (robotic && s.crew === 1 && s.buildings.some((b) => b.automated && BUILDINGS[b.type].crew > 0)) {
        alert(s, 'SETTLERS ABOARD — stations are still agent-run; crew them from the Lander to save power and lift the labs’ agent cap',
          'info', landerAction(s));
      }
    }
  } else {
    s.growthT = Math.max(0, s.growthT - dt * 0.5);
  }

  // ── 6 · parts upkeep, wear, dust ───────────────────────────────────
  let partsShort = false;
  // Maintenance Automation's parts triage: short of parts, priority 0 is paid first
  const upkeepOrder = mods.maintenanceWear > 0
    ? [...s.buildings].sort((a, c) => a.priority - c.priority || a.id - c.id) : s.buildings;
  for (const b of upkeepOrder) {
    if (!b.enabled || building(b) || b.wreck) continue; // a wreck costs no upkeep (docs/16 §4.3)
    const rate = (rates(b).upkeepPartsPerDay / CYCLE_S) * dt * hazardUpkeepMult(s, b);
    add(want, 'parts', rate);
    if (s.resources.parts >= rate) {
      s.resources.parts -= rate;
      // an overclocked machine runs hot: paid upkeep no longer heals it; EVA crews help
      const heal = WEAR.healPerDay * mods.repairMult * (eva ? EVA.repairMult : 1);
      if (!(b.overclock && b.active)) b.wear = Math.max(0, b.wear - (heal / CYCLE_S) * dt);
      if (b.type === 'solar') {
        b.dust = Math.max(0, b.dust +
          ((SOLAR_DUST_PER_DAY * mods.dustMult - SOLAR_DUST_RECOVER * (eva ? EVA.dustRecoverMult : 1)) / CYCLE_S) * dt);
      }
    } else {
      partsShort = true;
      if (b.type !== 'lander') b.wear = Math.min(1, b.wear + (WEAR.risePerDay / CYCLE_S) * dt);
      if (b.type === 'solar') {
        b.dust = Math.min(SOLAR_DUST_MAX, b.dust + ((SOLAR_DUST_PER_DAY * mods.dustMult) / CYCLE_S) * dt);
      }
    }
    if (b.overclock && b.active) {
      b.wear = Math.min(1, b.wear + (OVERCLOCK.wearPerDay / CYCLE_S) * dt);
      if (b.wear >= OVERCLOCK.tripWear) {
        b.overclock = false;
        b.ocTripped = true;
        alert(s, `OVERCLOCK TRIPPED — ${BUILDINGS[b.type].name} #${b.id} reached WORN`, 'warn', { select: b.id });
      }
    }
    if (b.wear >= OVERCLOCK.tripWear) st.wornSeen = true;
    if (b.type === 'solar') st.maxDust = Math.max(st.maxDust, b.dust);
  }
  // hub units wear like buildings (docs/17 §4.1: 2⚙ a lunar day each)
  for (const u of s.haulers) {
    const hb = hubOf(s, u);
    if (!hb?.enabled) continue;
    const rate = (unitRates(s, mods, site, u, targetOf(s, u.target)?.kind).upkeepPartsPerDay / CYCLE_S) * dt;
    add(want, 'parts', rate);
    if (s.resources.parts >= rate) {
      s.resources.parts -= rate;
      u.wear = Math.max(0, u.wear - ((WEAR.healPerDay * mods.repairMult * (eva ? EVA.repairMult : 1)) / CYCLE_S) * dt);
    } else {
      partsShort = true;
      u.wear = Math.min(1, u.wear + (WEAR.risePerDay / CYCLE_S) * dt);
    }
  }
  if (s.simTime > 120 && s.resources.parts < 20) st.lowPartsSeen = true;
  if (partsShort) {
    condition(s, 'parts', s.resupply?.pending
      ? 'PARTS DEPLETED — equipment wearing down until the Earth shipment lands at the Lander'
      : 'PARTS DEPLETED — equipment wearing down; order an Earth shipment at the Lander', 'warn', { panel: 'parts' });
  }

  // ── 6.5 · net flow rates (before deliveries and research goods; an
  // excavator's load counts as its cycle's average, not as a lump) ──────
  if (!s.rates) s.rates = {};
  const k = Math.min(1, dt / RATE_SMOOTH_S);
  for (const rid of Object.keys(s.resources) as ResourceId[]) {
    const r = (s.resources[rid] - before[rid] - (hauled[rid] ?? 0)) / dt + (haulFlow[rid] ?? 0);
    const prev = s.rates[rid];
    s.rates[rid] = prev === undefined ? r : prev + (r - prev) * k;
  }

  // ── 7 · morale ─────────────────────────────────────────────────────
  let target = site.moraleBase;
  for (const b of s.buildings) {
    const def = effectiveDef(b.type, mods);
    if (def.moraleDelta && b.active) target += def.moraleDelta;
  }
  target += o2ok && foodok && waterok ? MORALE.fed : MORALE.starving;
  if (o2Anxious) target -= 10;
  if (foodAnxious) target -= 10;
  if (waterAnxious) target -= 10;
  target += s.crew > housing ? MORALE.crowded : MORALE.housed;
  if (s.power.brownout) target += MORALE.blackout;
  else if (s.power.shed) target += MORALE.shed;
  target += flareMoraleTarget(s, site, mods); // by class (docs/16 §4.10)
  target += stripMorale(s).term; // strip mines near homes (docs/17 §12.1)
  // the destiny: a capstone's morale everywhere, and a launch day's lift
  target += mods.moraleBase;
  if (s.simTime < (s.launchDayUntil ?? 0)) target += mods.volleyMorale;
  // grief, a cabin-fever crisis, a boil-water notice (docs/14 §3)
  target += hazardMorale(s);
  target = Math.max(0, Math.min(100, target));
  if (unmanned) s.morale = 70; // machines hold steady
  else s.morale += (target - s.morale) * MORALE.lerp * dt;
  if (s.crew > 0) st.minMorale = Math.min(st.minMorale, s.morale);

  // ── 8 · space weather (core/spaceWeather.ts, docs/16): the cycle, the
  // classes, the phases, the arrays' choice and what it costs them ──
  const wx = weatherTick(s, site, mods, day, dt);

  // ── 8.3 · hazards (core/hazards.ts, docs/14 §3): the scheduler, the
  // flare and event kinds, the meters, each live hazard, the fleet's re-flash ──
  const hz = hazardTick(s, site, mods, day, dt);
  if (hz.modsChanged) ev.modsChanged = true;
  if (hz.wrecked.length || wx.removed.length) ev.wrecked = [...hz.wrecked, ...wx.removed];

  // ── 8.5 · emergency Earth resupply (the anti-softlock) ─────────────
  // no smelter anywhere and not enough metals to build one = stuck; no
  // working parts fabricator and the spares cache nearly gone = stuck too,
  // since welding and upkeep both burn parts. Earth notices; a shipment
  // launches — and takes a full lunar day.
  if (!s.resupply) s.resupply = { pending: false, arriveAt: 0, shipments: 0 };
  const smelterCost = Math.ceil((BUILDINGS.smelter.buildCost.metals ?? 40) * site.buildCostMult);
  const hasSmelter = s.buildings.some((b) => b.type === 'smelter');
  const hasPartsFab = s.buildings.some((b) => b.type === 'partsFab' && !building(b));
  const stranded = !hasSmelter && s.resources.metals < smelterCost ? 'metals'
    : !hasPartsFab && s.resources.parts < RESUPPLY.partsFloor ? 'parts'
    : '';
  if (s.resupply.pending && s.resupply.medevac && s.simTime >= s.resupply.arriveAt) {
    // the slot flew a dosed crew member home (docs/14 §3.4): no cargo
    s.resupply.pending = false;
    s.resupply.medevac = false;
    alert(s, 'MEDEVAC LANDED — the dosed crew member reached Earth alive; the shipment slot is free', 'info', landerAction(s));
  } else if (s.resupply.pending) {
    // a comms blackout holds the landing until the link returns (docs/16 §4.8)
    if (s.simTime >= s.resupply.arriveAt && commsDark(s)) {
      condition(s, 'resupply-held', `${s.resupply.downlink ? 'DOWNLINK CARGO' : 'RESUPPLY'} HELD — it circles until the flare’s blackout lifts`, 'info', landerAction(s));
    } else if (s.simTime >= s.resupply.arriveAt) {
      // one slot, two cargoes: a resupply, or what a data downlink bought
      const downlink = !!s.resupply.downlink;
      s.resupply.pending = false;
      s.resupply.downlink = false;
      s.resupply.shipments += 1;
      const cargo: [ResourceId, number][] = downlink
        ? Object.entries(DOWNLINK.cargo) as [ResourceId, number][]
        : [['metals', RESUPPLY.metals], ['parts', RESUPPLY.parts]];
      // cargo that does not fit the stockpile is lost — and the log says so
      const lost: string[] = [];
      for (const [rid, amt] of cargo) {
        const room = Math.max(0, (caps[rid] ?? Infinity) - s.resources[rid]);
        s.resources[rid] += Math.min(amt, room);
        if (amt - room >= 1) lost.push(`${Math.floor(amt - room)} ${rid}`);
      }
      alert(s, `${downlink ? 'DOWNLINK CARGO LANDED' : 'RESUPPLY LANDED'} — ` +
        `${cargo.map(([rid, amt]) => `+${amt} ${rid}`).join(', ')} from Earth` +
        (lost.length ? ` · ${lost.join(' and ')} lost to full storage` : ''), lost.length ? 'warn' : 'info', landerAction(s));
    }
  } else if (stranded) {
    s.resupply.pending = true;
    s.resupply.downlink = false;
    s.resupply.arriveAt = s.simTime + RESUPPLY.delayS;
    if (s.crew > 0) s.morale = Math.max(0, s.morale - RESUPPLY.moraleHit);
    alert(s, stranded === 'metals'
      ? 'STRANDED — Earth resupply launched, arrival in 1 lunar day'
      : 'STRANDED — spare parts nearly gone and no Parts Fabricator; Earth resupply launched, arrival in 1 lunar day',
    'crit', landerAction(s));
  }

  // ── 8.7 · off-site operations and the crew rotation ─────────────────
  // surveys, outpost streams, hopper fuel and upkeep: their continuous flows
  // count in the net rates as if step 6.5 had seen them
  const ex = explorationTick(s, mods, site, dt);
  if (ex.modsChanged) ev.modsChanged = true;
  for (const [rid, f] of Object.entries(ex.flow) as [ResourceId, number][]) {
    s.rates[rid] = (s.rates[rid] ?? 0) + f * k;
    if (f > 0) add(made, rid, f * dt); else add(want, rid, -f * dt);
  }
  // ── 8.9 · the flow book: supply against demand (the Builder's signal) ──
  updateFlowBook(s, made, want, dt);
  // the Era 7 deed: outposts have operated (a grounded hopper is not operating)
  const operating = s.survey.outposts.filter((o) => o.live && o.fuelOk && !o.hacked).length;
  if (operating >= 1) st.outpostOpS += dt;
  if (operating >= 2) st.outpostPairOpS += dt;
  crewRotationTick(s, mods, smelterO2);

  // ── 9 · research (queue, transfer cap, goods pass: core/research.ts) ──
  if (researchTick(s, mods, dt).modsChanged) ev.modsChanged = true;
  insightTick(s);

  // ── 10 · night survival tracking ───────────────────────────────────
  if (s.wasNight && !day.isNight) {
    if (st.nightLoadShed) st.nightBrownouts += 1;
    // clean: nothing went dark all night, not even a lab
    st.cleanNightStreak = st.nightLoadShed ? 0 : st.cleanNightStreak + 1;
    // the Era 6 deed: compute held the whole night and no critical load went dark
    if (st.nightDcAllActive && !st.nightCritDark) st.dcCleanNight = true;
    if (st.nightBankEmpty) st.bankDryDawns = (st.bankDryDawns ?? 0) + 1;
    if (s.crew > 0 || robotic) {
      s.nightsSurvived += 1;
      alert(s, `DAWN — night ${s.nightsSurvived} survived`, 'info');
    }
  }
  s.wasNight = day.isNight;

  // ── 10.5 · Autonomous Cadence: a volley fires itself once it is ready and
  // the bank keeps the night's reserve (one a tick; docs/14 §2.7) ──
  if (mods.autoLaunch && mods.launchArmed) autoLaunchTick(s, mods, day);

  // ── 11 · charters, then milestones (in order, progressive disclosure) ──
  eraTick(s);
  // ── 11 · milestones — each latches the moment it is met, in any order
  // (the objectives panel still reads top-down); the first launch is victory
  // whatever else is outstanding ─────────────────────────────────────
  for (const m of MILESTONES) {
    if (s.milestonesDone.includes(m.id) || !m.check(s)) continue;
    s.milestonesDone.push(m.id);
    alert(s, `MILESTONE — ${m.title}`, 'info', undefined, 'era');
    if (m.id === 'first-light') ev.victory = true;
  }

  // ── 12 · the Builder: standing rules, held orders, maintenance (core/automation.ts);
  // Game.econStep places what it asks for, through the same path as a click ──
  ev.build = automationTick(s, site, mods, day, dt);
  if (hz.build.length) ev.build.push(...hz.build); // a runaway rule's junk sites

  return ev;
}

// ─────────────────────────── volleys (docs/14 §2.7, §5) ───────────────────────────

/** What the next volley costs under these mods: Crewed Mission Control takes
 *  2↑ with enough crew on console (3↑ and no ceremony without them);
 *  Autonomous Cadence trims the burst. */
export interface VolleyTerms { foils: number; launch: number; burst: number; crewed: boolean; minCrew: number }
export function volleyTerms(s: Pick<GameState, 'crew'>, mods: Mods): VolleyTerms {
  const onConsole = mods.volleyMinCrew <= 0 || s.crew >= mods.volleyMinCrew;
  return {
    foils: LAUNCH_COST_FOILS,
    launch: onConsole ? mods.volleyCap : LAUNCH_CAP_PER_VOLLEY,
    burst: LAUNCH_POWER_BURST * mods.launchBurstMult,
    crewed: mods.volleyMinCrew > 0 && onConsole,
    minCrew: mods.volleyMinCrew,
  };
}

/** Launch one collector volley: '' on success, else the refusal to alert.
 *  The first volley of a pure Automation band sends the last crew home. */
export function launchVolley(s: GameState, mods: Mods): string {
  if (!mods.launchArmed) return `LAUNCH NEEDS ${TECHS.swarmProtocol.name}`;
  const v = volleyTerms(s, mods);
  if (s.resources.foils < v.foils) return `LAUNCH NEEDS ${v.foils}▰ — have ${Math.floor(s.resources.foils)}`;
  if (s.resources.launch < v.launch) {
    if (mods.volleyMinCrew > 0 && !v.crewed && s.resources.launch >= mods.volleyCap) {
      return `A VOLLEY NEEDS ${v.minCrew} CREW ON CONSOLE — have ${s.crew}; without them a volley needs ${LAUNCH_CAP_PER_VOLLEY}↑`;
    }
    return `LAUNCH NEEDS ${v.launch}↑ CAPACITY — have ${s.resources.launch.toFixed(1)}↑`;
  }
  if (s.powerStored < v.burst) return `LAUNCH NEEDS ${Math.round(v.burst)} STORED ENERGY — have ${Math.floor(s.powerStored)}`;
  s.resources.foils -= v.foils;
  s.resources.launch -= v.launch;
  s.powerStored -= v.burst;
  s.launches += 1;
  s.swarmPct += SWARM_PCT_PER_LAUNCH;
  // Launch days (Crewed Mission Control): each volley eases cabin fever (docs/14 §3.6)
  if (mods.guards.has('launchDays') && s.hazards) s.hazards.isolation = Math.max(0, s.hazards.isolation - HZ.cabinFever.launchDays);
  if (v.crewed && mods.volleyMorale > 0) s.launchDayUntil = s.simTime + CYCLE_S;
  alert(s, `COLLECTOR VOLLEY ${s.launches} AWAY — swarm ${(s.swarmPct).toFixed(4)}%${v.crewed ? ' · a launch day' : ''}`, 'info');
  if (s.launches === 1) crewHome(s);
  return '';
}

/** CREW HOME (docs/14 §5): FIRST LIGHT in a pure Automation band — the last
 *  crew boards the rotation home and every station runs on agents. Crew 0 is
 *  then no defeat, and no settler is invited again. */
export function crewHome(s: GameState): boolean {
  if (s.crewHome || s.crew <= 0 || destinyOf(s).band !== 'automation') return false;
  const n = s.crew;
  s.crewHome = true;
  s.crew = 0;
  s.crewRotation = null;
  s.growthT = 0;
  for (const b of s.buildings) if (BUILDINGS[b.type].crew > 0) b.automated = true;
  alert(s, `CREW HOME — the last ${n} crew board the rotation home; the Moon runs itself`, 'info', landerAction(s));
  return true;
}

/** The stored energy the rest of the night (or the whole next one) needs
 *  beyond what the night supply carries — never more than a full bank less
 *  the burst, so a full bank always fires. */
export function nightReserve(s: GameState, mods: Mods, burst: number, day: DayInfo): number {
  const p = s.power;
  const load = Math.max(0, p.demand - (p.construction ?? 0));
  const nightLoad = !day.isNight && mods.dayDrawMult > 0 ? (load / mods.dayDrawMult) * mods.nightDrawMult : load;
  const short = Math.max(0, nightLoad - (p.supplyNight ?? p.supply));
  const left = day.isNight ? day.phaseLeft : NIGHT_S;
  return Math.min(short * left, Math.max(0, p.capacity - burst));
}

function autoLaunchTick(s: GameState, mods: Mods, day: DayInfo) {
  const v = volleyTerms(s, mods);
  if (s.resources.foils < v.foils || s.resources.launch < v.launch || s.powerStored < v.burst) return;
  const reserve = nightReserve(s, mods, v.burst, day);
  if (s.powerStored - v.burst < reserve) {
    condition(s, 'cadence', `AUTONOMOUS CADENCE HOLDING — the volley waits until the bank keeps ${Math.ceil(reserve)} for the night`,
      'info', { panel: 'power' });
    return;
  }
  launchVolley(s, mods);
}

/** The first check of CREW_ROTATION the base fails, as an alert tail, or ''. */
export function rotationShortfall(s: GameState, mods: Mods, smelterO2: number, count: number): string {
  const R = CREW_ROTATION;
  // what makes it under these mods (an MRE smelter makes no water)
  const need = (res: ResourceId, amt: number) =>
    `needs ${amt} ${RESOURCES[res].name.toLowerCase()} (have ${Math.floor(s.resources[res])})${producerHint(res, s, mods)}`;
  if (s.resources.oxygen < R.minO2 && smelterO2 < R.minO2Rate) return need('oxygen', R.minO2);
  if (s.resources.food < R.minFood) return need('food', R.minFood);
  if (s.resources.water < R.minWater) return need('water', R.minWater);
  const beds = (s.housingActive ?? 0) - s.crew;
  if (beds < Math.max(R.minHousing, count)) {
    return `needs ${Math.max(R.minHousing, count)} free beds (have ${Math.max(0, beds)}) · build ${BUILDINGS.habitat.name}`;
  }
  return '';
}

/** At its time, the rotation boards if the base can keep them, else it is held
 *  and re-checked every CREW_ROTATION.retryS. It brings a robotic base its
 *  first crew; if someone is already aboard, it is not needed. */
function crewRotationTick(s: GameState, mods: Mods, smelterO2: number) {
  const rot = s.crewRotation;
  if (!rot || s.simTime < rot.at) return;
  // the flare's blackout holds the landing (docs/16 §4.8)
  if (commsDark(s)) { condition(s, 'rotation-held', 'CREW ROTATION HELD — the lander waits out the flare’s blackout', 'info', { panel: 'crew' }); return; }
  if (s.crew > 0) { s.crewRotation = null; return; }
  // grief (docs/14 §3.10): nobody wants to come for a lunar day after a death
  if (growthHeld(s)) {
    rot.at = s.simTime + CREW_ROTATION.retryS;
    alert(s, 'CREW ROTATION HELD — after the deaths, nobody boards for a lunar day', 'warn', { panel: 'crew' });
    return;
  }
  const short = rotationShortfall(s, mods, smelterO2, rot.count);
  if (short) {
    rot.at = s.simTime + CREW_ROTATION.retryS;
    alert(s, `CREW ROTATION HELD — ${short}`, 'warn', { panel: 'crew' });
    return;
  }
  s.crew += rot.count;
  s.crewRotation = null;
  alert(s, `CREW ROTATION — ${rot.count} settlers aboard. Stations are still agent-run: ` +
    'switch labs to Crewed in the inspector', 'info', landerAction(s));
}

/** Recompute mods + era from scratch (load, debug completeTech). The era never goes down. */
export function refreshDerived(s: GameState): Mods {
  fillStateDefaults(s);
  s.era = computeEra(s);
  const mods = modsFor(s);
  // saves from before fleet control: a roster from the docks, and every
  // excavator digging its own pad — as it did; every rover in its place
  // (a save from before transit: at its work, arrived — core/transit.ts)
  fleetRefresh(s, mods);
  transitPlan(s, mods, false);
  for (const b of s.buildings) ensureHaul(b);
  return mods;
}

export { computeMods };
export type { Mods };
