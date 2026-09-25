/** The 1 Hz economy tick — deterministic resolution order:
 *  generator staffing → power supply → stockpile caps → priority idling →
 *  worker allocation → production (tier order) → life support & crew →
 *  parts upkeep & wear → net rates → morale → flare events → Earth
 *  shipments → exploration and the crew rotation → research → night
 *  tracking → charters → milestones → the Builder. Every building's numbers come from mods.effectiveRates, the
 *  same function the tooltips and previews read.
 *  Timberborn-style priority idling: under shortage, low-priority buildings
 *  auto-idle first; habitats brown out last. */
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { MILESTONES } from '../data/milestones';
import {
  ALERTS, BEAM_KW_PER_LAUNCH, BROWNOUT_HOLD_S,
  CREW, CREW_ROTATION, CROP_LOSS, CYCLE_S, DOWNLINK, DUSK_WARN_S, FLARE, HELIOPHYSICS_DATA, NIGHT_S,
  LOW_SUPPLY_S, MORALE, OVERCLOCK, POWER_RELEASE_MARGIN, RATE_SMOOTH_S, RESUPPLY, SOLAR_DUST_MAX,
  SOLAR_DUST_PER_DAY, SOLAR_DUST_RECOVER, WEAR,
} from '../data/balance';
import { RESOURCES, type ResourceId } from '../data/resources';
import type { SiteDef } from '../data/sites';
import { fillStateDefaults, type AlertAction, type AlertMsg, type GameState, type BuildingState } from './state';
import {
  canToggleCrew, computeMods, effectiveDef, effectiveRates, modsFor, wearDerate, type EffectiveRates, type Mods,
} from './mods';
import { computeEra, eraTick, insightTick, producerHint, researchTick, uplinkShare } from './research';
import { explorationTick } from './exploration';
import { assignRovers, crewKW, crewParts, crewRate, fleetRefresh, syncRoster } from './fleet';
import { ensureHaul, haulTick, haulWaiting } from './haul';
import { settleJobs, sinter, spurLeft } from './roads';
import { dayInfo, fmtClock, type DayInfo } from './daynight';
import { updateFlowBook } from './flowBook';
import { automationTick, type AutoRequest } from './automation';
import { mulberry32 } from './rng';

const PROD_ORDER: BuildingId[] = [
  'excavator', 'iceHarvester',            // extraction
  'smelter', 'refinery', 'partsFab', 'chipFab', // industry (same-tick chaining)
  'hydroponics', 'recDome',               // life
  'foilFactory', 'massDriver', 'propellantPlant', // export
  'lab', 'dataCenter',                    // science
];

export interface EconEvents {
  modsChanged: boolean;
  victory: boolean;
  defeat: boolean;
  /** step 12: what the Builder wants placed or demolished (Game.econStep resolves them) */
  build: AutoRequest[];
}

type AlertKind = AlertMsg['kind'];
const SEVERITY: Record<AlertKind, number> = { info: 0, warn: 1, crit: 2 };

/** A one-shot event. Repeating one still listed merges into it (×N). */
export function alert(s: GameState, text: string, kind: AlertKind = 'info', action?: AlertAction) {
  const i = s.alerts.findIndex((a) => !a.cond && a.key === text);
  if (i >= 0) {
    const [a] = s.alerts.splice(i, 1);
    a.count += 1;
    a.at = s.simTime;
    a.quiet = false;
    s.alerts.push(a);
    return;
  }
  s.alerts.push({ id: s.nextAlertId++, text, kind, at: s.simTime, key: text, count: 1, action });
  // bounded: the least severe, then the oldest, event makes room
  const events = s.alerts.filter((a) => !a.cond);
  if (events.length > ALERTS.maxEvents) {
    const out = events.reduce((m, a) => (SEVERITY[a.kind] < SEVERITY[m.kind] ? a : m));
    s.alerts.splice(s.alerts.indexOf(out), 1);
  }
}

/** conditions raised during the economy tick in progress: key → times */
let raised: Map<string, number> | null = null;

/** A recurring condition: raise it every tick it holds, with its current
 *  wording; it clears itself shortly after it stops being raised. A
 *  dismissed condition is snoozed rather than re-raised the next tick. */
export function condition(
  s: GameState, key: string, text: string, kind: AlertKind, action?: AlertAction,
) {
  if ((s.alertSnooze?.[key] ?? 0) > s.simTime) return;
  const n = (raised?.get(key) ?? 0) + 1;
  raised?.set(key, n);
  const live = s.alerts.find((a) => a.cond && a.key === key);
  if (!live) {
    s.alerts.push({
      id: s.nextAlertId++, text, kind, at: s.simTime, key, cond: true, count: 1,
      ttl: ALERTS.lingerTicks, action,
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
export function boardingShortfall(s: GameState, lsMult: number): '' | 'oxygen' | 'food' | 'water' {
  for (const [rid, rate] of LIFE_SUPPORT) {
    const perCrew = rate * lsMult;
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
  return dayInfo(s.simTime, site, s.flare.phase === 'active');
}

/** Advance the economy by dt game-seconds (call at 1 Hz of game time). */
export function economyTick(s: GameState, site: SiteDef, mods: Mods, dt: number): EconEvents {
  if (missionLost(s)) return { modsChanged: false, victory: false, defeat: false, build: [] };
  const seen = new Map<string, number>();
  raised = seen;
  const ev = runTick(s, site, mods, dt);
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
  // a robotic mission runs unmanned until Human Cohabitation brings settlers;
  // once anyone is aboard, moods, life support, and crewed stations all apply
  const unmanned = robotic && s.crew <= 0;
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
      r = effectiveRates(b.type, mods, site, b, { ...rateOpts, agentRun: isAuto(b), feed: s.feed });
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

  // ── 0 · construction rovers — the roster follows the docks; auto rovers
  // go one per site in queue order (placement order unless Build next), a
  // shut-down site keeps its place in line but frees its rover, pinned
  // rovers stay put, and a survey borrows one (core/fleet.ts) ────────────
  const building = (b: BuildingState) => (b.construction ?? 0) > 0;
  syncRoster(s, mods);
  const crews = assignRovers(s);
  const sites = s.buildings.filter(building).sort((a, b) => queuePos(a) - queuePos(b) || a.id - b.id);
  st.waitingSitesPeak = Math.max(st.waitingSitesPeak,
    sites.filter((b) => b.enabled && !crews.has(b.id)).length);
  for (const n of crews.values()) st.crowdedSiteMax = Math.max(st.crowdedSiteMax ?? 0, n);

  // ── 0.5 · generator staffing — crewed generators take workers first,
  // because every other station's power depends on them ───────────────
  let workers = s.crew;
  const staffed = new Set<number>();
  const crewedGen = (b: BuildingState) => eff(b.type).powerKW > 0 && BUILDINGS[b.type].crew > 0;
  for (const b of [...s.buildings].sort((a, c) => a.priority - c.priority || a.id - c.id)) {
    if (building(b) || !crewedGen(b)) continue;
    b.active = false;
    b.idleReason = '';
    if (!b.enabled) { b.idleReason = 'off'; continue; }
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
    if (def.storageKWh) capacity += def.storageKWh * (b.type === 'battery' ? mods.batteryCapMult : 1);
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
        solarFull += panel;
        solarNow += panel * day.sunFactor;
        supply += panel * day.sunFactor;
        continue;
      }
      supply += out;
    }
  }
  // the beam comes from the swarm, and a flare blinds it
  if (mods.powerBeam && s.flare.phase !== 'active') supply += s.launches * BEAM_KW_PER_LAUNCH;
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

  // ── 2 · demand + priority idling (construction sites draw too) ─────
  interface Draw { b: BuildingState; draw: number; prio: number; isSite: boolean }
  const wants: Draw[] = [];
  for (const b of s.buildings) {
    if (building(b)) {
      // an active construction site pulls welding power at its building's
      // idle priority: each rover on it draws its own
      const n = crews.get(b.id) ?? 0;
      if (n > 0) wants.push({ b, draw: crewKW(mods, n) * dt, prio: b.priority, isSite: true });
      continue;
    }
    if (eff(b.type).powerKW >= 0) continue;
    if (b.enabled && outputFull(b)) { b.active = false; b.idleReason = 'full'; continue; }
    // autonomous agents trade crew and morale for watts (1 + agentTax); night
    // and day draw multipliers and overclock ride the same number
    wants.push({ b, draw: -rates(b).powerKW * dt, prio: b.priority, isSite: false });
  }
  // within a priority, running loads keep their power ahead of new construction
  const drawOrder = (w: Draw) => (w.isSite ? queuePos(w.b) : w.b.id);
  wants.sort((a, b) => a.prio - b.prio || Number(a.isSite) - Number(b.isSite) || drawOrder(a) - drawOrder(b));
  let budget = supply * dt + s.powerStored;
  let supplyLeft = supply * dt;
  let demand = 0; // requested — loads held dark still want their watts
  let drawn = 0;
  const powered = new Set<number>();
  const dark: Draw[] = [];
  for (const w of wants) {
    if (!w.isSite) {
      w.b.active = false;
      w.b.idleReason = '';
      if (!w.b.enabled) { w.b.idleReason = 'off'; continue; }
    }
    demand += w.draw / dt;
    // hysteresis: a browned-out building stays dark for a few seconds before
    // retrying, so marginal grids don't strobe the base on and off — but it
    // comes back in priority order once the grid carries it with margin: from
    // this tick's supply alone, or from the bank for the rest of its hold
    const hold = w.b.brownoutHold ?? 0;
    if (hold > 0) w.b.brownoutHold = hold - 1;
    const margin = w.draw * POWER_RELEASE_MARGIN;
    const fits = hold > 0
      ? supplyLeft >= margin || budget >= margin * hold
      : w.draw <= budget;
    if (fits) {
      w.b.brownoutHold = 0;
      budget -= w.draw;
      supplyLeft = Math.max(0, supplyLeft - w.draw);
      drawn += w.draw;
      powered.add(w.b.id);
    } else {
      if (hold === 0) w.b.brownoutHold = BROWNOUT_HOLD_S;
      dark.push(w);
    }
  }
  // a dark priority 0–1 load is a brownout; idling only 2–3 is load shedding.
  // A paused construction site is never a brownout: nobody lives in it yet
  let brownout = false;
  let shed = false;
  for (const w of dark) {
    if (!w.isSite) w.b.idleReason = 'power';
    if (w.prio <= 1 && !w.isSite) brownout = true;
    else shed = true;
  }
  if (brownout && !day.isNight && !s.power.brownout) st.dayBrownouts += 1;
  if (day.isNight && brownout) st.nightCritDark = true;
  if (day.isNight && (brownout || shed)) st.nightLoadShed = true;
  // how long each load has been held dark at night — leaky, so a load the
  // brownout hold lets back on for one tick in nine still counts as dark;
  // a farm dark too long loses its crop
  const darkNow = new Set(dark.filter((w) => !w.isSite).map((w) => w.b.id));
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

  // ── 2.5 · construction progress: needs a rover, grid power, AND parts;
  // n rovers build n^0.85 times as fast, on the same weld parts per build ──
  for (const b of sites) {
    b.active = false;
    if (!b.enabled) { b.idleReason = 'off'; continue; }
    const crew = crews.get(b.id) ?? 0;
    if (crew === 0) { b.idleReason = 'queued'; continue; }
    if (!powered.has(b.id)) { b.idleReason = 'power'; continue; }
    // its road first: the crew sinters the spur out to the door, cell by cell
    // (the crew's draw, no weld parts), then welds (core/roads.ts)
    if (b.spur?.length && spurLeft(s, b) > 0) {
      b.idleReason = 'road';
      sinter(s, b.spur, dt * mods.weldRateMult * crewRate(crew) / mods.roadCellMult);
      if (spurLeft(s, b) === 0) b.spur = [];
      continue;
    }
    const weld = crewParts(mods, crew) * dt;
    add(want, 'parts', weld);
    if (s.resources.parts < weld) {
      b.idleReason = 'inputs'; // welding consumables ran dry
      condition(s, 'stalled', 'CONSTRUCTION STALLED — no parts for welding', 'warn', { panel: 'parts' });
      continue;
    }
    s.resources.parts -= weld;
    b.idleReason = 'building';
    b.construction = Math.max(0, (b.construction ?? 0) - dt * mods.weldRateMult * crewRate(crew));
    if (b.construction === 0) {
      b.idleReason = '';
      st.built += 1;
      alert(s, `CONSTRUCTION COMPLETE — ${BUILDINGS[b.type].name}`, 'info', { select: b.id });
    }
  }
  // ── 2.6 · free rovers sinter the roads drawn and the haul roads, oldest
  // first, one rover a job (their batteries: no grid draw) ──
  if (s.roadJobs?.length) {
    for (const j of s.roadJobs) {
      const n = s.rovers.filter((r) => r.road === j.id).length;
      if (n) sinter(s, j.cells, dt * mods.weldRateMult * crewRate(n) / mods.roadCellMult);
    }
    settleJobs(s);
  }
  // settle storage: net energy this tick
  const net = supply * dt - drawn;
  if (net >= 0) s.powerStored = Math.min(capacity, s.powerStored + net * mods.storageEff);
  else s.powerStored = Math.max(0, s.powerStored + net);
  let construction = 0;
  for (const w of wants) if (w.isSite) construction += w.draw / dt;
  s.power = { supply, demand, served: drawn / dt, capacity, brownout, shed, supplyFull, supplyNight, construction };
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
    if (short <= 0) {
      condition(s, 'dusk', `${lead} — night supply carries the base`, 'info', { panel: 'power' });
    } else if (runway >= NIGHT_S) {
      condition(s, 'dusk', `${lead} — ${Math.floor(s.powerStored)} stored carries the night at ${Math.ceil(short)} kW short`,
        'info', { panel: 'power' });
    } else {
      condition(s, 'dusk', `${lead} — ${Math.floor(s.powerStored)} stored lasts ~${fmtClock(runway)} of the ` +
        `${fmtClock(NIGHT_S)} night at ${Math.ceil(short)} kW short; lower priorities or shut down`, 'warn', { panel: 'power' });
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
  const runs = (b: BuildingState) => b.enabled && !building(b) && staffed.has(b.id) &&
    (eff(b.type).powerKW >= 0 || powered.has(b.id));
  // agent-run labs share one DSN link: the share counts every agent lab that
  // runs this tick (labs have no inputs, so each that is powered and staffed runs)
  const share = uplinkShare((byType.get('lab') ?? []).filter((b) => runs(b) && isAuto(b)).length);
  let smelterO2 = 0; // this tick's smelter oxygen, for the crew rotation's check
  let ilmeniteDug = false;
  // excavators credit their loads on unload (core/haul.ts): the lumps, and
  // the cycles' average delivery the smoothed net rates count instead
  const hauled: Partial<Record<ResourceId, number>> = {};
  const haulFlow: Partial<Record<ResourceId, number>> = {};
  for (const type of PROD_ORDER) {
    const list = byType.get(type);
    if (!list) continue;
    for (const b of list) {
      if (!runs(b)) continue;
      // recipe, multipliers, agents, morale, wear, overclock, feed, site and deposit
      const r = effectiveRates(type, mods, site, b, {
        ...rateOpts, agentRun: isAuto(b), feed: s.feed, uplinkShare: share,
      });
      // what it asks for counts as demand, covered or not (the flow book)
      for (const [rid, rate] of Object.entries(r.inputs)) add(want, rid as ResourceId, (rate ?? 0) * dt);
      // inputs
      let short: '' | 'inputs' | 'reserve' = '';
      for (const [rid, rate] of Object.entries(r.inputs)) {
        const need = (rate ?? 0) * dt;
        const have = s.resources[rid as ResourceId];
        if (have < need) { short = 'inputs'; break; }
        if (have - (reserve[rid as ResourceId] ?? 0) < need) short = 'reserve';
      }
      if (short) { b.idleReason = short; continue; }
      for (const [rid, rate] of Object.entries(r.inputs)) {
        s.resources[rid as ResourceId] -= (rate ?? 0) * dt;
      }
      if (type === 'excavator') {
        const h = haulTick(s, mods, b, r, dt, caps, day.isNight);
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
      // outputs — a farm that lost its crop is regrowing and makes nothing yet
      const regrowing = type === 'hydroponics' && (b.cropRegrowT ?? 0) > 0;
      if (regrowing) b.cropRegrowT = Math.max(0, b.cropRegrowT! - dt);
      else {
        for (const [rid, rate] of Object.entries(r.outputs)) {
          const amt = (rate ?? 0) * dt;
          s.resources[rid as ResourceId] += amt;
          st.produced[rid as ResourceId] += amt;
          add(made, rid as ResourceId, amt);
        }
      }
      if (type === 'smelter') smelterO2 += r.outputs.oxygen ?? 0;
      // labs (uplink share on agent-run ones, crewed ones scale with morale)
      // and data centers: the same numbers researchRates reports
      s.data += r.data * dt;
      b.active = true;
    }
  }
  if (ilmeniteDug) st.ilmeniteDigS += dt;
  // structures with no inputs/outputs/crew that were powered count as active
  // (crewed generators were settled by the staffing pass)
  for (const b of s.buildings) {
    if (building(b)) continue;
    const def = eff(b.type);
    if (def.powerKW >= 0 && Object.keys(def.outputs).length === 0 && def.crew === 0) b.active = b.enabled;
    if (b.enabled && def.powerKW < 0 && powered.has(b.id) && Object.keys(def.outputs).length === 0
        && Object.keys(def.inputs).length === 0 && staffed.has(b.id)) b.active = true;
  }
  const dcActive = s.buildings.some((b) => b.type === 'dataCenter' && b.active);
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
  const waterNeed = s.crew * CREW.waterPerCrew * lsMult * dt;
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
          s.crew -= 1;
          s.morale = Math.max(0, s.morale - 15);
          alert(s, 'CREW LOST — life support failure', 'crit', { panel: 'crew' });
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
  const waterRate = Math.max(1e-6, s.crew * CREW.waterPerCrew * lsMult);
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
  if (!robotic && s.crew <= 0 && !s.defeatShown) {
    ev.defeat = true;
    s.paused = true;
    return ev;
  }
  // growth — robotic missions attract settlers only after Human Cohabitation
  // (its crew rotation boards first), and nobody boards a base that cannot
  // keep one more alive
  const sustainable = boardingShortfall(s, lsMult) === '';
  if (settlersWelcome(s) && !s.crewRotation && sustainable && s.morale > CREW.growthMorale && s.crew < housing &&
      o2ok && foodok && waterok) {
    s.growthT += dt;
    if (s.growthT >= CREW.growthPeriod) {
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
    if (!b.enabled || building(b)) continue;
    const rate = (rates(b).upkeepPartsPerDay / CYCLE_S) * dt;
    add(want, 'parts', rate);
    if (s.resources.parts >= rate) {
      s.resources.parts -= rate;
      // an overclocked machine runs hot: paid upkeep no longer heals it
      if (!(b.overclock && b.active)) b.wear = Math.max(0, b.wear - (WEAR.healPerDay * mods.repairMult / CYCLE_S) * dt);
      if (b.type === 'solar') {
        b.dust = Math.max(0, b.dust +
          ((SOLAR_DUST_PER_DAY * mods.dustMult - SOLAR_DUST_RECOVER) / CYCLE_S) * dt);
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
  if (s.flare.phase === 'active') target += MORALE.flare;
  target = Math.max(0, Math.min(100, target));
  if (unmanned) s.morale = 70; // machines hold steady
  else s.morale += (target - s.morale) * MORALE.lerp * dt;
  if (s.crew > 0) st.minMorale = Math.min(st.minMorale, s.morale);

  // ── 8 · solar flare state machine ──────────────────────────────────
  if (s.flare.nextAt === 0) s.flare.nextAt = FLARE.firstAtDay * CYCLE_S;
  switch (s.flare.phase) {
    case 'idle':
      if (s.simTime >= s.flare.nextAt) {
        s.flare.phase = 'telegraph';
        s.flare.timer = FLARE.telegraphS;
      }
      break;
    case 'telegraph':
      s.flare.timer -= dt;
      if (s.flare.timer <= 0) {
        s.flare.phase = 'active';
        s.flare.timer = FLARE.activeS;
        if (!site.flareImmune && s.crew > 0) s.morale = Math.max(0, s.morale - FLARE.moraleHit);
        // a flare has a pro: an operating lab reads the particle storm
        if (s.buildings.some((b) => b.type === 'lab' && b.active)) {
          s.data += HELIOPHYSICS_DATA;
          alert(s, `HELIOPHYSICS — the flare was also an experiment · +${HELIOPHYSICS_DATA}≡`, 'info');
        }
        if (!site.flareImmune && s.buildings.filter((b) => b.active && b.type !== 'lander').length >= 6) {
          st.flaresWithSix += 1;
        }
      }
      break;
    case 'active':
      s.flare.timer -= dt;
      if (s.flare.timer <= 0) {
        s.flare.phase = 'idle';
        const jitter = mulberry32((s.seed ^ 0x5f1a) + day.dayIndex)();
        s.flare.nextAt = s.simTime + (FLARE.periodDays + (jitter - 0.5) * 2 * FLARE.jitterDays) * CYCLE_S;
      }
      break;
  }
  if (s.flare.phase === 'telegraph') {
    condition(s, 'flare', site.flareImmune
      ? 'SOLAR FLARE INBOUND — lava tube shielding will hold'
      : `SOLAR FLARE INBOUND — radiation storm in ${Math.ceil(s.flare.timer)} s`, site.flareImmune ? 'info' : 'crit');
  } else if (s.flare.phase === 'active' && !site.flareImmune) {
    condition(s, 'flare', `SOLAR FLARE — solar arrays dark, crew sheltering for ${Math.ceil(s.flare.timer)} s`, 'crit',
      { panel: 'power' });
  }

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
  if (s.resupply.pending) {
    if (s.simTime >= s.resupply.arriveAt) {
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
  const operating = s.survey.outposts.filter((o) => o.live && o.fuelOk).length;
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

  // ── 11 · charters, then milestones (in order, progressive disclosure) ──
  eraTick(s);
  // ── 11 · milestones — each latches the moment it is met, in any order
  // (the objectives panel still reads top-down); the first launch is victory
  // whatever else is outstanding ─────────────────────────────────────
  for (const m of MILESTONES) {
    if (s.milestonesDone.includes(m.id) || !m.check(s)) continue;
    s.milestonesDone.push(m.id);
    alert(s, `MILESTONE — ${m.title}`, 'info');
    if (m.id === 'first-light') ev.victory = true;
  }

  // ── 12 · the Builder: standing rules, held orders, maintenance (core/automation.ts);
  // Game.econStep places what it asks for, through the same path as a click ──
  ev.build = automationTick(s, site, mods, day, dt);

  return ev;
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
  if (s.crew > 0) { s.crewRotation = null; return; }
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
  // excavator digging its own pad — as it did
  fleetRefresh(s, mods);
  for (const b of s.buildings) ensureHaul(b);
  return mods;
}

export { computeMods };
export type { Mods };
