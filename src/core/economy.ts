/** The 1 Hz economy tick — deterministic resolution order:
 *  power supply → priority idling → worker allocation → production (tier order)
 *  → life support & crew → parts upkeep & wear → morale → flare events →
 *  research → night tracking → milestones.
 *  Timberborn-style priority idling: under shortage, low-priority buildings
 *  auto-idle first; habitats brown out last. */
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { TECHS } from '../data/techs';
import { MILESTONES } from '../data/milestones';
import {
  BATTERY_EFF, BEAM_KW_PER_LAUNCH, CONSTRUCTION_KW, CONSTRUCTION_PARTS_PER_S,
  CREW, CYCLE_S, FLARE,
  LOW_SUPPLY_S, MORALE, RESEARCH_RATE_PER_LAB, RESUPPLY, SOLAR_DUST_MAX,
  SOLAR_DUST_PER_DAY, SOLAR_DUST_RECOVER, START,
} from '../data/balance';
import type { ResourceId } from '../data/resources';
import type { SiteDef } from '../data/sites';
import type { GameState, BuildingState } from './state';
import { computeEra, computeMods, type Mods } from './mods';
import { dayInfo, type DayInfo } from './daynight';
import { mulberry32 } from './rng';

const ISRU_BUILDINGS: BuildingId[] = ['excavator', 'iceHarvester', 'smelter', 'refinery'];
const PROD_ORDER: BuildingId[] = [
  'excavator', 'iceHarvester',            // extraction
  'smelter', 'refinery', 'partsFab',      // industry (same-tick chaining)
  'hydroponics', 'recDome',               // life
  'foilFactory', 'massDriver',            // export
  'lab',                                  // science
];

export interface EconEvents {
  modsChanged: boolean;
  victory: boolean;
  defeat: boolean;
}

export function alert(s: GameState, text: string, kind: 'info' | 'warn' | 'crit' = 'info') {
  // dedupe identical live alerts
  if (s.alerts.some((a) => a.text === text)) return;
  s.alerts.push({ id: s.nextAlertId++, text, kind, at: s.simTime });
  if (s.alerts.length > 6) s.alerts.shift();
}

export function moraleWorkMult(morale: number): number {
  return MORALE.workMultMin + (morale / 100) * MORALE.workMultSpan;
}

export function currentDay(s: GameState, site: SiteDef): DayInfo {
  return dayInfo(s.simTime, site, s.flare.phase === 'active');
}

/** Advance the economy by dt game-seconds (call at 1 Hz of game time). */
export function economyTick(s: GameState, site: SiteDef, mods: Mods, dt: number): EconEvents {
  const ev: EconEvents = { modsChanged: false, victory: false, defeat: false };
  const day = currentDay(s, site);
  const robotic = s.expedition === 'robotic';
  // robotic missions have no moods — and no morale multiplier upside
  const workMult = robotic ? 1 : moraleWorkMult(s.morale);
  const isAuto = (b: BuildingState) => b.automated || robotic;

  // ── 0 · construction robots — the fleet gates concurrent builds ────
  const building = (b: BuildingState) => (b.construction ?? 0) > 0;
  let botsTotal = 0;
  for (const b of s.buildings) {
    if (!b.enabled || building(b)) continue;
    botsTotal += BUILDINGS[b.type].bots ?? 0;
  }
  // FIFO by placement order: stable assignment, oldest sites build first
  const sites = s.buildings.filter(building).sort((a, b) => a.id - b.id);
  const botAssigned = new Set<number>();
  for (const site of sites) {
    if (botAssigned.size >= botsTotal) break;
    botAssigned.add(site.id);
  }
  s.bots = { total: botsTotal, busy: botAssigned.size };

  // ── 1 · power supply ───────────────────────────────────────────────
  let supply = 0;
  let capacity = 0;
  for (const b of s.buildings) {
    if (building(b)) continue;
    const def = BUILDINGS[b.type];
    if (def.storageKWh) capacity += def.storageKWh;
    if (!b.enabled) continue;
    if (def.powerKW > 0) {
      let out = def.powerKW * mods.powerMult[b.type];
      if (b.type === 'solar') out *= day.sunFactor * (1 - b.dust) * (b.shaded ? 0.15 : 1);
      if (b.wear > 0.3) out *= 0.5;
      supply += out;
    }
  }
  if (mods.powerBeam) supply += s.launches * BEAM_KW_PER_LAUNCH;

  // ── 2 · demand + priority idling (construction sites draw too) ─────
  interface Draw { b: BuildingState; draw: number; prio: number; isSite: boolean }
  const wants: Draw[] = [];
  for (const b of s.buildings) {
    if (building(b)) {
      // an active construction site pulls welding power — and is the FIRST
      // thing to stop in a brownout (priority 3)
      if (botAssigned.has(b.id)) {
        wants.push({ b, draw: CONSTRUCTION_KW * dt, prio: 3, isSite: true });
      }
      continue;
    }
    if (BUILDINGS[b.type].powerKW >= 0) continue;
    // autonomous agents trade crew and morale for watts
    const autoMult = isAuto(b) && BUILDINGS[b.type].crew > 0 ? 1.6 : 1;
    wants.push({
      b,
      draw: -BUILDINGS[b.type].powerKW * mods.powerMult[b.type] * autoMult * dt,
      prio: b.priority,
      isSite: false,
    });
  }
  wants.sort((a, b) => a.prio - b.prio || a.b.id - b.b.id);
  let budget = supply * dt + s.powerStored;
  let demand = 0;
  let drawn = 0;
  let brownout = false;
  const powered = new Set<number>();
  for (const w of wants) {
    if (!w.isSite) {
      w.b.active = false;
      w.b.idleReason = '';
      if (!w.b.enabled) { w.b.idleReason = 'off'; continue; }
    }
    // hysteresis: a browned-out building stays dark for a few seconds before
    // retrying, so marginal grids don't strobe the base on and off
    if ((w.b.brownoutHold ?? 0) > 0) {
      w.b.brownoutHold = (w.b.brownoutHold ?? 0) - 1;
      if (!w.isSite) w.b.idleReason = 'power';
      brownout = true; // a building held dark means the grid is still short
      continue;
    }
    demand += w.draw / dt;
    if (w.draw <= budget) {
      budget -= w.draw;
      drawn += w.draw;
      powered.add(w.b.id);
    } else {
      if (!w.isSite) w.b.idleReason = 'power';
      w.b.brownoutHold = 8;
      brownout = true;
    }
  }

  // ── 2.5 · construction progress: needs a robot, grid power, AND parts ──
  for (const b of sites) {
    b.active = false;
    if (!botAssigned.has(b.id)) { b.idleReason = 'queued'; continue; }
    if (!powered.has(b.id)) { b.idleReason = 'power'; continue; }
    const weld = CONSTRUCTION_PARTS_PER_S * dt;
    if (s.resources.parts < weld) {
      b.idleReason = 'inputs'; // welding consumables ran dry
      alert(s, 'CONSTRUCTION STALLED — no parts for welding', 'warn');
      continue;
    }
    s.resources.parts -= weld;
    b.idleReason = 'building';
    b.construction = Math.max(0, (b.construction ?? 0) - dt);
    if (b.construction === 0) {
      b.idleReason = '';
      alert(s, `CONSTRUCTION COMPLETE — ${BUILDINGS[b.type].name}`, 'info');
    }
  }
  // settle storage: net energy this tick
  const net = supply * dt - drawn;
  if (net >= 0) s.powerStored = Math.min(capacity, s.powerStored + net * BATTERY_EFF);
  else s.powerStored = Math.max(0, s.powerStored + net);
  s.power = { supply, demand, capacity, brownout };
  if (brownout && day.isNight) alert(s, 'BROWNOUT — night demand exceeds stored power', 'crit');
  else if (brownout) alert(s, 'BROWNOUT — grid demand exceeds supply', 'warn');

  // ── 3 · worker allocation (priority order) ─────────────────────────
  let workers = s.crew;
  const staffed = new Set<number>();
  for (const b of [...s.buildings].sort((a, c) => a.priority - c.priority || a.id - c.id)) {
    if (building(b)) continue;
    const def = BUILDINGS[b.type];
    const need = isAuto(b) ? 0 : Math.max(0, def.crew + mods.crewDelta[b.type]);
    if (!b.enabled || need === 0) { staffed.add(b.id); continue; }
    if (def.powerKW < 0 && !powered.has(b.id)) continue; // already power-idled
    if (workers >= need) { workers -= need; staffed.add(b.id); }
    else if (b.idleReason === '') b.idleReason = 'crew';
  }

  // ── 4 · production in tier order (a tick's regolith can smelt same tick) ──
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
      let ok = true;
      for (const [rid, rate] of Object.entries(def.inputs)) {
        if (s.resources[rid as keyof typeof s.resources] < rate * inMult * dt) { ok = false; break; }
      }
      if (!ok) { b.idleReason = 'inputs'; continue; }
      for (const [rid, rate] of Object.entries(def.inputs)) {
        s.resources[rid as keyof typeof s.resources] -= rate * inMult * dt;
      }
      // outputs
      let outMult = mods.outputMult[type] * dt;
      if (ISRU_BUILDINGS.includes(type)) outMult *= site.isruMult;
      if (def.crew > 0 && !isAuto(b)) outMult *= workMult; // agents don't have moods
      if (b.wear > 0.3) outMult *= 0.5;
      for (const [rid, rate] of Object.entries(def.outputs)) {
        let amt = rate * outMult;
        if (rid === 'launch') amt *= site.launchMult;
        s.resources[rid as keyof typeof s.resources] += amt;
      }
      // human insight beats agent inference: robotic labs run at 75%
      if (type === 'lab') s.data += 0.3 * dt * (robotic ? 0.75 : b.automated ? 1 : Math.pow(workMult, 1.5));
      b.active = true;
    }
  }
  // structures with no inputs/outputs/crew that were powered count as active
  for (const b of s.buildings) {
    if (building(b)) continue;
    const def = BUILDINGS[b.type];
    if (b.enabled && def.powerKW >= 0 && Object.keys(def.outputs).length === 0 && def.crew === 0) b.active = true;
    if (b.enabled && def.powerKW < 0 && powered.has(b.id) && Object.keys(def.outputs).length === 0
        && Object.keys(def.inputs).length === 0 && staffed.has(b.id)) b.active = true;
  }

  // ── 4.5 · stockpile caps: excess production is lost on the ground ──
  const caps: Partial<Record<ResourceId, number>> = {};
  for (const b of s.buildings) {
    if (!b.enabled || building(b)) continue;
    for (const [rid, amt] of Object.entries(BUILDINGS[b.type].caps ?? {})) {
      caps[rid as ResourceId] = (caps[rid as ResourceId] ?? 0) + (amt ?? 0);
    }
  }
  for (const [rid, cap] of Object.entries(caps)) {
    const r = rid as ResourceId;
    if (s.resources[r] > (cap ?? 0)) {
      if (s.resources[r] > (cap ?? 0) + 0.5) {
        alert(s, `STORAGE FULL — ${r} at capacity, build a Storage Yard`, 'warn');
      }
      s.resources[r] = cap ?? 0;
    }
  }
  s.storageCaps = caps;

  // ── 5 · life support & crew (robotic missions skip all of this) ────
  const lsMult = mods.inputMult['habitat'];
  const o2Need = robotic ? 0 : s.crew * CREW.oxygenPerCrew * lsMult * dt;
  const foodNeed = robotic ? 0 : s.crew * CREW.foodPerCrew * lsMult * dt;
  const waterNeed = robotic ? 0 : s.crew * CREW.waterPerCrew * lsMult * dt;
  const o2ok = robotic || s.resources.oxygen >= o2Need;
  const foodok = robotic || s.resources.food >= foodNeed;
  const waterok = robotic || s.resources.water >= waterNeed;
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
  if (!o2ok || !foodok || !waterok) {
    s.starveT += dt;
    alert(s, !o2ok ? 'OXYGEN DEPLETED — crew is suffocating'
      : !waterok ? 'WATER DEPLETED — crew is dehydrating'
      : 'FOOD DEPLETED — crew is starving', 'crit');
    if (s.starveT > CREW.starveGraceS) {
      const losses = Math.floor((s.starveT - CREW.starveGraceS) / CREW.lossPeriodS);
      if (losses > 0) {
        s.starveT = CREW.starveGraceS;
        if (s.crew > 0) {
          s.crew -= 1;
          s.morale = Math.max(0, s.morale - 15);
          alert(s, 'CREW LOST — life support failure', 'crit');
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
  const o2Anxious = !robotic && s.crew > 0 && s.resources.oxygen / o2Rate < LOW_SUPPLY_S;
  const foodAnxious = !robotic && s.crew > 0 && s.resources.food / foodRate < LOW_SUPPLY_S;
  const waterAnxious = !robotic && s.crew > 0 && s.resources.water / waterRate < LOW_SUPPLY_S;
  if (o2Anxious) alert(s, 'OXYGEN RESERVES LOW — the crew is anxious', 'warn');
  if (foodAnxious) alert(s, 'FOOD RESERVES LOW — the crew is anxious', 'warn');
  if (waterAnxious) alert(s, 'WATER RESERVES LOW — the crew is anxious', 'warn');
  // the base falls silent when the last crewmember dies (humans only —
  // a robotic mission has no one to lose)
  if (!robotic && s.crew <= 0 && !s.defeatShown) {
    ev.defeat = true;
    s.paused = true;
  }
  // growth
  if (!robotic && s.morale > CREW.growthMorale && s.crew < housing && o2ok && foodok && waterok) {
    s.growthT += dt;
    if (s.growthT >= CREW.growthPeriod) {
      s.growthT = 0;
      s.crew += 1;
      alert(s, 'ARRIVAL — a new crewmember has joined the base', 'info');
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
      b.wear = Math.max(0, b.wear - (0.1 / CYCLE_S) * dt);
      if (b.type === 'solar') {
        b.dust = Math.max(0, b.dust +
          ((SOLAR_DUST_PER_DAY * mods.dustMult - SOLAR_DUST_RECOVER) / CYCLE_S) * dt);
      }
    } else {
      partsShort = true;
      b.wear = Math.min(1, b.wear + (0.5 / CYCLE_S) * dt);
      if (b.type === 'solar') {
        b.dust = Math.min(SOLAR_DUST_MAX, b.dust + ((SOLAR_DUST_PER_DAY * mods.dustMult) / CYCLE_S) * dt);
      }
    }
  }
  if (partsShort) alert(s, 'PARTS DEPLETED — equipment is wearing down', 'warn');

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
  if (s.flare.phase === 'active') target += MORALE.flare;
  target = Math.max(0, Math.min(100, target));
  if (robotic) s.morale = 70; // machines hold steady
  else s.morale += (target - s.morale) * MORALE.lerp * dt;

  // ── 8 · solar flare state machine ──────────────────────────────────
  if (s.flare.nextAt === 0) s.flare.nextAt = FLARE.firstAtDay * CYCLE_S;
  switch (s.flare.phase) {
    case 'idle':
      if (s.simTime >= s.flare.nextAt) {
        s.flare.phase = 'telegraph';
        s.flare.timer = FLARE.telegraphS;
        alert(s, site.flareImmune
          ? 'SOLAR FLARE INBOUND — lava tube shielding will hold'
          : 'SOLAR FLARE INBOUND — radiation storm in 60s', 'crit');
      }
      break;
    case 'telegraph':
      s.flare.timer -= dt;
      if (s.flare.timer <= 0) {
        s.flare.phase = 'active';
        s.flare.timer = FLARE.activeS;
        if (!site.flareImmune && !robotic) s.morale = Math.max(0, s.morale - FLARE.moraleHit);
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

  // ── 8.5 · emergency Earth resupply (the anti-softlock) ─────────────
  // no smelter anywhere and not enough metals to build one = stuck.
  // Earth notices; a shipment launches — and takes a full lunar day.
  if (!s.resupply) s.resupply = { pending: false, arriveAt: 0, shipments: 0 };
  const smelterCost = Math.ceil((BUILDINGS.smelter.buildCost.metals ?? 40) * site.buildCostMult);
  const hasSmelter = s.buildings.some((b) => b.type === 'smelter');
  if (s.resupply.pending) {
    if (s.simTime >= s.resupply.arriveAt) {
      s.resupply.pending = false;
      s.resupply.shipments += 1;
      s.resources.metals += RESUPPLY.metals;
      s.resources.parts += RESUPPLY.parts;
      alert(s, `RESUPPLY LANDED — +${RESUPPLY.metals} metals, +${RESUPPLY.parts} parts from Earth`, 'info');
    }
  } else if (!hasSmelter && s.resources.metals < smelterCost) {
    s.resupply.pending = true;
    s.resupply.arriveAt = s.simTime + RESUPPLY.delayS;
    if (!robotic) s.morale = Math.max(0, s.morale - RESUPPLY.moraleHit);
    alert(s, 'STRANDED — Earth resupply launched, arrival in 1 lunar day', 'crit');
  }

  // ── 9 · research ───────────────────────────────────────────────────
  const head = s.researchQueue[0];
  if (head) {
    const def = TECHS[head];
    const banked = s.researchSpent[head] ?? 0;
    const needed = def.costData - banked;
    const activeLabs = s.buildings.filter((b) => b.type === 'lab' && b.active).length;
    const rate = RESEARCH_RATE_PER_LAB * activeLabs * dt;
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
        alert(s, `RESEARCH STALLED — ${def.name} needs manufactured goods`, 'warn');
      }
    }
  }

  // ── 10 · night survival tracking ───────────────────────────────────
  if (s.wasNight && !day.isNight && (s.crew > 0 || robotic)) {
    s.nightsSurvived += 1;
    alert(s, `DAWN — night ${s.nightsSurvived} survived`, 'info');
  }
  s.wasNight = day.isNight;

  // ── 11 · milestones (in order, progressive disclosure) ─────────────
  for (const m of MILESTONES) {
    if (s.milestonesDone.includes(m.id)) continue;
    if (m.check(s)) {
      s.milestonesDone.push(m.id);
      alert(s, `MILESTONE — ${m.title}`, 'info');
      if (m.id === 'first-light') ev.victory = true;
      continue; // only complete in order; check next
    }
    break;
  }

  return ev;
}

/** Recompute mods + era from scratch (load, debug completeTech). */
export function refreshDerived(s: GameState): Mods {
  s.era = computeEra(s.techsDone);
  return computeMods(s.techsDone);
}

export { computeMods };
export type { Mods };
