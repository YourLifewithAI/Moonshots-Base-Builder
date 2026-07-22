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
  BATTERY_EFF, BEAM_KW_PER_LAUNCH, CREW, CYCLE_S, FLARE, MORALE,
  SOLAR_DUST_MAX, SOLAR_DUST_PER_DAY, SOLAR_DUST_RECOVER, START,
} from '../data/balance';
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
  const ev: EconEvents = { modsChanged: false, victory: false };
  const day = currentDay(s, site);
  const workMult = moraleWorkMult(s.morale);

  // ── 0 · construction — building sites are inert until complete ─────
  const building = (b: BuildingState) => (b.construction ?? 0) > 0;
  for (const b of s.buildings) {
    if (!building(b)) continue;
    b.construction = Math.max(0, (b.construction ?? 0) - dt);
    b.active = false;
    b.idleReason = 'building';
    if (b.construction === 0) {
      b.idleReason = '';
      alert(s, `CONSTRUCTION COMPLETE — ${BUILDINGS[b.type].name}`, 'info');
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
      let out = def.powerKW * mods.powerMult[b.type];
      if (b.type === 'solar') out *= day.sunFactor * (1 - b.dust);
      if (b.wear > 0.3) out *= 0.5;
      supply += out;
    }
  }
  if (mods.powerBeam) supply += s.launches * BEAM_KW_PER_LAUNCH;

  // ── 2 · demand + priority idling ───────────────────────────────────
  const consumers = s.buildings
    .filter((b) => BUILDINGS[b.type].powerKW < 0 && !building(b))
    .sort((a, b) => a.priority - b.priority || a.id - b.id);
  let budget = supply * dt + s.powerStored;
  let demand = 0;
  let drawn = 0;
  let brownout = false;
  const powered = new Set<number>();
  for (const b of consumers) {
    const def = BUILDINGS[b.type];
    const draw = -def.powerKW * mods.powerMult[b.type] * dt;
    b.active = false;
    b.idleReason = '';
    if (!b.enabled) { b.idleReason = 'off'; continue; }
    demand += draw / dt;
    if (draw <= budget) {
      budget -= draw;
      drawn += draw;
      powered.add(b.id);
    } else {
      b.idleReason = 'power';
      brownout = true;
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
    const need = Math.max(0, def.crew + mods.crewDelta[b.type]);
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
      if (def.crew > 0) outMult *= workMult;
      if (b.wear > 0.3) outMult *= 0.5;
      for (const [rid, rate] of Object.entries(def.outputs)) {
        let amt = rate * outMult;
        if (rid === 'launch') amt *= site.launchMult;
        s.resources[rid as keyof typeof s.resources] += amt;
      }
      if (type === 'lab') s.data += 0.3 * dt * Math.pow(workMult, 1.5);
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

  // ── 5 · life support & crew ────────────────────────────────────────
  const lsMult = mods.inputMult['habitat'];
  const o2Need = s.crew * CREW.oxygenPerCrew * lsMult * dt;
  const foodNeed = s.crew * CREW.foodPerCrew * lsMult * dt;
  const o2ok = s.resources.oxygen >= o2Need;
  const foodok = s.resources.food >= foodNeed;
  s.resources.oxygen = Math.max(0, s.resources.oxygen - o2Need);
  s.resources.food = Math.max(0, s.resources.food - foodNeed);
  let housing = 0;
  for (const b of s.buildings) {
    const def = BUILDINGS[b.type];
    if (!def.housing || !b.enabled || building(b)) continue;
    if (def.powerKW < 0 && !powered.has(b.id)) continue;
    housing += def.housing;
  }
  if (!o2ok || !foodok) {
    s.starveT += dt;
    alert(s, !o2ok ? 'OXYGEN DEPLETED — crew is suffocating' : 'FOOD DEPLETED — crew is starving', 'crit');
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
  // growth
  if (s.morale > CREW.growthMorale && s.crew < housing && o2ok && foodok) {
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
  target += o2ok && foodok ? MORALE.fed : MORALE.starving;
  target += s.crew > housing ? MORALE.crowded : MORALE.housed;
  if (s.power.brownout) target += MORALE.blackout;
  if (s.flare.phase === 'active') target += MORALE.flare;
  target = Math.max(0, Math.min(100, target));
  s.morale += (target - s.morale) * MORALE.lerp * dt;

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
        if (!site.flareImmune) s.morale = Math.max(0, s.morale - FLARE.moraleHit);
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

  // ── 9 · research ───────────────────────────────────────────────────
  const head = s.researchQueue[0];
  if (head) {
    const def = TECHS[head];
    const needed = def.costData - s.researchProgress;
    const spend = Math.min(needed, s.data);
    s.data -= spend;
    s.researchProgress += spend;
    if (s.researchProgress >= def.costData) {
      let affordable = true;
      for (const [rid, amt] of Object.entries(def.costGoods ?? {})) {
        if (s.resources[rid as keyof typeof s.resources] < amt) { affordable = false; break; }
      }
      if (affordable) {
        for (const [rid, amt] of Object.entries(def.costGoods ?? {})) {
          s.resources[rid as keyof typeof s.resources] -= amt;
        }
        s.researchQueue.shift();
        s.researchProgress = 0;
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
  if (s.wasNight && !day.isNight && s.crew > 0) {
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
