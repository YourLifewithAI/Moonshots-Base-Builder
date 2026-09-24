/** The 1 Hz economy tick — deterministic resolution order:
 *  generator staffing → power supply → stockpile caps → priority idling →
 *  worker allocation → production (tier order) → life support & crew →
 *  parts upkeep & wear → net rates → morale → flare events → resupply →
 *  research → night tracking → milestones.
 *  Timberborn-style priority idling: under shortage, low-priority buildings
 *  auto-idle first; habitats brown out last. */
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { TECHS } from '../data/techs';
import { MILESTONES } from '../data/milestones';
import {
  AGENT_GEN_TAX, ALERTS, BATTERY_EFF, BEAM_KW_PER_LAUNCH, BROWNOUT_HOLD_S, CONSTRUCTION_KW, CONSTRUCTION_PARTS_PER_S,
  CREW, CYCLE_S, DATA_RATE, FLARE,
  LOW_SUPPLY_S, MORALE, POWER_RELEASE_MARGIN, RATE_SMOOTH_S, RESEARCH_RATE_PER_LAB, RESUPPLY, SOLAR_DUST_MAX,
  SOLAR_DUST_PER_DAY, SOLAR_DUST_RECOVER, START, WEAR,
} from '../data/balance';
import type { ResourceId } from '../data/resources';
import type { SiteDef } from '../data/sites';
import type { AlertAction, AlertMsg, GameState, BuildingState } from './state';
import { computeEra, computeMods, type Mods } from './mods';
import { dayInfo, type DayInfo } from './daynight';
import { mulberry32 } from './rng';

const ISRU_BUILDINGS: BuildingId[] = ['excavator', 'iceHarvester', 'smelter', 'refinery'];
const PROD_ORDER: BuildingId[] = [
  'excavator', 'iceHarvester',            // extraction
  'smelter', 'refinery', 'partsFab', 'chipFab', // industry (same-tick chaining)
  'hydroponics', 'recDome',               // life
  'foilFactory', 'massDriver',            // export
  'lab', 'dataCenter',                    // science
];

export interface EconEvents {
  modsChanged: boolean;
  victory: boolean;
  defeat: boolean;
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

/** output multiplier from equipment wear — the Lander, the lifeboat, never wears */
export function wearDerate(b: BuildingState): number {
  return b.type === 'lander' ? 1 : 1 - WEAR.derate * b.wear;
}

/** settlers come to any human base, and to a robotic one once it is ready for them */
export function settlersWelcome(s: GameState): boolean {
  return s.expedition !== 'robotic' || s.techsDone.includes('humanCohabitation');
}

const LIFE_SUPPORT: ['oxygen' | 'food' | 'water', number][] = [
  ['oxygen', CREW.oxygenPerCrew], ['food', CREW.foodPerCrew], ['water', CREW.waterPerCrew],
];

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

/** a construction site's place in the robot queue (lower builds first) */
export function queuePos(b: BuildingState): number {
  return b.buildSeq ?? b.id;
}

export function currentDay(s: GameState, site: SiteDef): DayInfo {
  return dayInfo(s.simTime, site, s.flare.phase === 'active');
}

/** Advance the economy by dt game-seconds (call at 1 Hz of game time). */
export function economyTick(s: GameState, site: SiteDef, mods: Mods, dt: number): EconEvents {
  if (missionLost(s)) return { modsChanged: false, victory: false, defeat: false };
  const seen = new Map<string, number>();
  raised = seen;
  const ev = runTick(s, site, mods, dt);
  raised = null;
  settleConditions(s, seen);
  return ev;
}

function runTick(s: GameState, site: SiteDef, mods: Mods, dt: number): EconEvents {
  const ev: EconEvents = { modsChanged: false, victory: false, defeat: false };
  const before = { ...s.resources };
  const day = currentDay(s, site);
  const robotic = s.expedition === 'robotic';
  // a robotic mission runs unmanned until Human Cohabitation brings settlers;
  // once anyone is aboard, moods, life support, and crewed stations all apply
  const unmanned = robotic && s.crew <= 0;
  const workMult = unmanned ? 1 : moraleWorkMult(s.morale);
  const isAuto = (b: BuildingState) => b.automated || unmanned;

  // ── 0 · construction robots — the fleet gates concurrent builds ────
  const building = (b: BuildingState) => (b.construction ?? 0) > 0;
  let botsTotal = 0;
  for (const b of s.buildings) {
    if (!b.enabled || building(b)) continue;
    botsTotal += BUILDINGS[b.type].bots ?? 0;
    // self-assembly: bays print extra workers
    if (b.type === 'roboticsBay') botsTotal += mods.botPerBay;
  }
  // robot queue: placement order unless a site was moved up with Build next;
  // a shut-down site keeps its place in line but frees its robot
  const sites = s.buildings.filter(building).sort((a, b) => queuePos(a) - queuePos(b) || a.id - b.id);
  const botAssigned = new Set<number>();
  for (const site of sites) {
    if (botAssigned.size >= botsTotal) break;
    if (site.enabled) botAssigned.add(site.id);
  }
  s.bots = { total: botsTotal, busy: botAssigned.size };

  // ── 0.5 · generator staffing — crewed generators take workers first,
  // because every other station's power depends on them ───────────────
  let workers = s.crew;
  const staffed = new Set<number>();
  const crewedGen = (b: BuildingState) => BUILDINGS[b.type].powerKW > 0 && BUILDINGS[b.type].crew > 0;
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
  for (const b of s.buildings) {
    if (building(b)) continue;
    const def = BUILDINGS[b.type];
    if (def.storageKWh) capacity += def.storageKWh;
    if (!b.enabled) continue;
    if (def.powerKW > 0) {
      if (crewedGen(b) && !staffed.has(b.id)) continue;
      let out = def.powerKW * mods.powerMult[b.type];
      if (b.type === 'solar') out *= day.sunFactor * (1 - b.dust) * (b.shaded ? 0.15 : 1);
      if (crewedGen(b) && isAuto(b)) out *= 1 - AGENT_GEN_TAX;
      supply += out * wearDerate(b);
    }
  }
  if (mods.powerBeam) supply += s.launches * BEAM_KW_PER_LAUNCH;

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
    const outs = Object.entries(BUILDINGS[b.type].outputs) as [ResourceId, number][];
    return outs.length > 0 && outs.every(([rid, rate]) => caps[rid] !== undefined &&
      s.resources[rid] + rate * mods.outputMult[b.type] * dt > caps[rid]!);
  };

  // ── 2 · demand + priority idling (construction sites draw too) ─────
  interface Draw { b: BuildingState; draw: number; prio: number; isSite: boolean }
  const wants: Draw[] = [];
  for (const b of s.buildings) {
    if (building(b)) {
      // an active construction site pulls welding power at its building's
      // idle priority
      if (botAssigned.has(b.id)) {
        wants.push({ b, draw: CONSTRUCTION_KW * dt, prio: b.priority, isSite: true });
      }
      continue;
    }
    if (BUILDINGS[b.type].powerKW >= 0) continue;
    if (b.enabled && outputFull(b)) { b.active = false; b.idleReason = 'full'; continue; }
    // autonomous agents trade crew and morale for watts
    const autoMult = isAuto(b) && BUILDINGS[b.type].crew > 0 ? 1.6 : 1;
    wants.push({
      b,
      draw: -BUILDINGS[b.type].powerKW * mods.powerMult[b.type] * autoMult * dt,
      prio: b.priority,
      isSite: false,
    });
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

  // ── 2.5 · construction progress: needs a robot, grid power, AND parts ──
  for (const b of sites) {
    b.active = false;
    if (!b.enabled) { b.idleReason = 'off'; continue; }
    if (!botAssigned.has(b.id)) { b.idleReason = 'queued'; continue; }
    if (!powered.has(b.id)) { b.idleReason = 'power'; continue; }
    const weld = CONSTRUCTION_PARTS_PER_S * dt;
    if (s.resources.parts < weld) {
      b.idleReason = 'inputs'; // welding consumables ran dry
      condition(s, 'stalled', 'CONSTRUCTION STALLED — no parts for welding', 'warn', { panel: 'parts' });
      continue;
    }
    s.resources.parts -= weld;
    b.idleReason = 'building';
    b.construction = Math.max(0, (b.construction ?? 0) - dt);
    if (b.construction === 0) {
      b.idleReason = '';
      alert(s, `CONSTRUCTION COMPLETE — ${BUILDINGS[b.type].name}`, 'info', { select: b.id });
    }
  }
  // settle storage: net energy this tick
  const net = supply * dt - drawn;
  if (net >= 0) s.powerStored = Math.min(capacity, s.powerStored + net * BATTERY_EFF);
  else s.powerStored = Math.max(0, s.powerStored + net);
  s.power = { supply, demand, served: drawn / dt, capacity, brownout, shed };
  if (brownout) {
    condition(s, 'brownout', day.isNight
      ? 'BROWNOUT — night demand exceeds stored power'
      : 'BROWNOUT — grid demand exceeds supply', 'crit', { panel: 'power' });
  } else if (shed) {
    condition(s, 'shed', 'LOAD SHED — low-priority systems idled to protect the grid', 'info', { panel: 'power' });
  }

  // ── 3 · worker allocation (priority order) ─────────────────────────
  for (const b of [...s.buildings].sort((a, c) => a.priority - c.priority || a.id - c.id)) {
    if (building(b) || crewedGen(b)) continue;
    const def = BUILDINGS[b.type];
    const need = isAuto(b) ? 0 : Math.max(0, def.crew + mods.crewDelta[b.type]);
    if (!b.enabled || need === 0) { staffed.add(b.id); continue; }
    if (def.powerKW < 0 && !powered.has(b.id)) continue; // already power-idled
    if (workers >= need) { workers -= need; staffed.add(b.id); }
    else if (b.idleReason === '') b.idleReason = 'crew';
  }

  // ── 4 · production in tier order (a tick's regolith can smelt same tick) ──
  // the crew drinks first: production may not touch the last few minutes of
  // life support, so a farm idles before it takes the crew's water
  const lsMult = mods.inputMult['habitat'];
  const reserve: Partial<Record<ResourceId, number>> = {
    oxygen: s.crew * CREW.oxygenPerCrew * lsMult * LOW_SUPPLY_S,
    food: s.crew * CREW.foodPerCrew * lsMult * LOW_SUPPLY_S,
    water: s.crew * CREW.waterPerCrew * lsMult * LOW_SUPPLY_S,
  };
  const byType = new Map<BuildingId, BuildingState[]>();
  for (const b of s.buildings) {
    if (!byType.has(b.type)) byType.set(b.type, []);
    byType.get(b.type)!.push(b);
  }
  for (const type of PROD_ORDER) {
    const list = byType.get(type);
    if (!list) continue;
    const def = BUILDINGS[type];
    for (const b of list) {
      if (!b.enabled || building(b)) continue;
      if (def.powerKW < 0 && !powered.has(b.id)) continue;
      if (!staffed.has(b.id)) continue;
      // inputs
      const inMult = mods.inputMult[type];
      let short: '' | 'inputs' | 'reserve' = '';
      for (const [rid, rate] of Object.entries(def.inputs)) {
        const need = rate * inMult * dt;
        const have = s.resources[rid as ResourceId];
        if (have < need) { short = 'inputs'; break; }
        if (have - (reserve[rid as ResourceId] ?? 0) < need) short = 'reserve';
      }
      if (short) { b.idleReason = short; continue; }
      for (const [rid, rate] of Object.entries(def.inputs)) {
        s.resources[rid as keyof typeof s.resources] -= rate * inMult * dt;
      }
      // outputs
      const derate = wearDerate(b);
      let outMult = mods.outputMult[type] * dt * derate;
      if (ISRU_BUILDINGS.includes(type)) outMult *= site.isruMult;
      if (def.crew > 0 && !isAuto(b)) outMult *= workMult; // agents don't have moods
      for (const [rid, rate] of Object.entries(def.outputs)) {
        let amt = rate * outMult;
        if (rid === 'launch') amt *= site.launchMult;
        s.resources[rid as keyof typeof s.resources] += amt;
      }
      // human insight beats agent inference: agent-run labs on a robotic
      // mission hold 75% — staffing them after cohabitation lifts the cap
      if (type === 'lab') {
        s.data += DATA_RATE.lab * dt * derate *
          (isAuto(b) ? (robotic ? DATA_RATE.agentLabCap : 1) : Math.pow(workMult, 1.5));
      }
      // data centers research at machine speed, immune to moods and staffing
      if (type === 'dataCenter') s.data += DATA_RATE.dataCenter * dt * derate * mods.outputMult['dataCenter'];
      b.active = true;
    }
  }
  // structures with no inputs/outputs/crew that were powered count as active
  // (crewed generators were settled by the staffing pass)
  for (const b of s.buildings) {
    if (building(b)) continue;
    const def = BUILDINGS[b.type];
    if (def.powerKW >= 0 && Object.keys(def.outputs).length === 0 && def.crew === 0) b.active = b.enabled;
    if (b.enabled && def.powerKW < 0 && powered.has(b.id) && Object.keys(def.outputs).length === 0
        && Object.keys(def.inputs).length === 0 && staffed.has(b.id)) b.active = true;
  }

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
  const o2ok = s.crew <= 0 || s.resources.oxygen >= o2Need;
  const foodok = s.crew <= 0 || s.resources.food >= foodNeed;
  const waterok = s.crew <= 0 || s.resources.water >= waterNeed;
  s.resources.oxygen = Math.max(0, s.resources.oxygen - o2Need);
  s.resources.food = Math.max(0, s.resources.food - foodNeed);
  s.resources.water = Math.max(0, s.resources.water - waterNeed);
  let housing = 0;
  for (const b of s.buildings) {
    const def = BUILDINGS[b.type];
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
  // the base falls silent when the last crewmember dies (humans only —
  // a robotic mission has no one to lose)
  if (!robotic && s.crew <= 0 && !s.defeatShown) {
    ev.defeat = true;
    s.paused = true;
    return ev;
  }
  // growth — robotic missions attract settlers only after Human Cohabitation,
  // and nobody boards a base that cannot keep one more alive
  const sustainable = boardingShortfall(s, lsMult) === '';
  if (settlersWelcome(s) && sustainable && s.morale > CREW.growthMorale && s.crew < housing &&
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
  for (const b of s.buildings) {
    const def = BUILDINGS[b.type];
    if (!b.enabled || building(b)) continue;
    const rate = (def.upkeepParts * mods.upkeepMult[b.type] * site.upkeepMult / CYCLE_S) * dt;
    if (s.resources.parts >= rate) {
      s.resources.parts -= rate;
      b.wear = Math.max(0, b.wear - (WEAR.healPerDay / CYCLE_S) * dt);
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
  }
  if (partsShort) {
    condition(s, 'parts', s.resupply?.pending
      ? 'PARTS DEPLETED — equipment wearing down until the Earth shipment lands at the Lander'
      : 'PARTS DEPLETED — equipment wearing down; order an Earth shipment at the Lander', 'warn', { panel: 'parts' });
  }

  // ── 6.5 · net flow rates (before deliveries and research goods) ──────
  if (!s.rates) s.rates = {};
  const k = Math.min(1, dt / RATE_SMOOTH_S);
  for (const rid of Object.keys(s.resources) as ResourceId[]) {
    const r = (s.resources[rid] - before[rid]) / dt;
    const prev = s.rates[rid];
    s.rates[rid] = prev === undefined ? r : prev + (r - prev) * k;
  }

  // ── 7 · morale ─────────────────────────────────────────────────────
  let target = site.moraleBase;
  for (const b of s.buildings) {
    const def = BUILDINGS[b.type];
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
      s.resupply.pending = false;
      s.resupply.shipments += 1;
      // cargo that does not fit the stockpile is lost — and the log says so
      const lost: string[] = [];
      for (const [rid, amt] of [['metals', RESUPPLY.metals], ['parts', RESUPPLY.parts]] as const) {
        const room = Math.max(0, (caps[rid] ?? Infinity) - s.resources[rid]);
        s.resources[rid] += Math.min(amt, room);
        if (amt - room >= 1) lost.push(`${Math.floor(amt - room)} ${rid}`);
      }
      alert(s, `RESUPPLY LANDED — +${RESUPPLY.metals} metals, +${RESUPPLY.parts} parts from Earth` +
        (lost.length ? ` · ${lost.join(' and ')} lost to full storage` : ''), lost.length ? 'warn' : 'info', landerAction(s));
    }
  } else if (stranded) {
    s.resupply.pending = true;
    s.resupply.arriveAt = s.simTime + RESUPPLY.delayS;
    if (s.crew > 0) s.morale = Math.max(0, s.morale - RESUPPLY.moraleHit);
    alert(s, stranded === 'metals'
      ? 'STRANDED — Earth resupply launched, arrival in 1 lunar day'
      : 'STRANDED — spare parts nearly gone and no Parts Fabricator; Earth resupply launched, arrival in 1 lunar day',
    'crit', landerAction(s));
  }

  // ── 9 · research ───────────────────────────────────────────────────
  const head = s.researchQueue[0];
  if (head) {
    const def = TECHS[head];
    const banked = s.researchSpent[head] ?? 0;
    const needed = def.costData - banked;
    // each data center transfers like three labs — compute is the point of
    // them; worn racks and benches transfer at their derated rate
    let labs = 0;
    for (const b of s.buildings) {
      if (!b.active) continue;
      if (b.type === 'lab') labs += wearDerate(b);
      else if (b.type === 'dataCenter') labs += 3 * wearDerate(b);
    }
    const rate = RESEARCH_RATE_PER_LAB * labs * dt;
    const spend = Math.min(needed, s.data, rate);
    s.data -= spend;
    s.researchSpent[head] = banked + spend;
    if ((s.researchSpent[head] ?? 0) >= def.costData) {
      let affordable = true;
      for (const [rid, amt] of Object.entries(def.costGoods ?? {})) {
        if (s.resources[rid as keyof typeof s.resources] < amt) { affordable = false; break; }
      }
      if (affordable) {
        for (const [rid, amt] of Object.entries(def.costGoods ?? {})) {
          s.resources[rid as keyof typeof s.resources] -= amt;
        }
        s.researchQueue.shift();
        delete s.researchSpent[head];
        s.techsDone.push(head);
        s.era = computeEra(s.techsDone);
        ev.modsChanged = true;
        alert(s, `RESEARCH COMPLETE — ${def.name}`, 'info');
      } else {
        const missing = Object.keys(def.costGoods ?? {}).find((rid) =>
          s.resources[rid as ResourceId] < (def.costGoods?.[rid as ResourceId] ?? 0));
        condition(s, 'research', `RESEARCH STALLED — ${def.name} needs manufactured goods`, 'warn',
          missing ? { panel: missing } : undefined);
      }
    }
  }

  // ── 10 · night survival tracking ───────────────────────────────────
  if (s.wasNight && !day.isNight && (s.crew > 0 || robotic)) {
    s.nightsSurvived += 1;
    alert(s, `DAWN — night ${s.nightsSurvived} survived`, 'info');
  }
  s.wasNight = day.isNight;

  // ── 11 · milestones — each latches the moment it is met, in any order
  // (the objectives panel still reads top-down); the first launch is victory
  // whatever else is outstanding ─────────────────────────────────────
  for (const m of MILESTONES) {
    if (s.milestonesDone.includes(m.id) || !m.check(s)) continue;
    s.milestonesDone.push(m.id);
    alert(s, `MILESTONE — ${m.title}`, 'info');
    if (m.id === 'first-light') ev.victory = true;
  }

  return ev;
}

/** Recompute mods + era from scratch (load, debug completeTech). */
export function refreshDerived(s: GameState): Mods {
  s.era = computeEra(s.techsDone);
  return computeMods(s.techsDone, s.expedition);
}

export { computeMods };
export type { Mods };
