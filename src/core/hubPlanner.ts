/** Hub-aware Feed Planner. The planner only changes an empty unit's next
 * departure at home. Player pins, assigned pits, recalls, charging and flare
 * recovery always win; cargo is never redirected midway through a delivery. */
import { CYCLE_S, NIGHT_S, UNIT_POWER } from '../data/balance';
import { HUB } from '../data/hubs';
import type { SiteDef } from '../data/sites';
import type { BuildingState, GameState, Hauler, HubPolicy } from './state';
import type { Mods } from './mods';
import { dayInfo, fmtClock } from './daynight';
import {
  choicesFor, freeFace, hopperCap, hubHunger, hubOf, hubUnit, hubsOf, queueRefusal, sendUnit,
  standPoint, unitRates, unitSpec, unitsOf, type Choice,
} from './hubs';
import { pitOf, reservesOf } from './pits';

export const HUB_POLICIES: Record<HubPolicy, { label: string; help: string }> = {
  balanced: { label: 'Maximize product', help: 'Choose useful intake × ore grade, accounting for other units and available faces.' },
  conserve: { label: 'Conserve power', help: 'Choose useful output per unit of digging and driving energy; keep charging units at home.' },
  night: { label: 'Maintain night feed', help: 'Favor short, frequent deliveries while the hopper is below its night reserve target, then maximize product.' },
};
const REVIEW_S = 120;
const SWITCH_GAIN = 1.15;
export const hubPolicy = (b: BuildingState): HubPolicy => b.hub?.policy && b.hub.policy in HUB_POLICIES ? b.hub.policy : 'balanced';

export function setHubPolicy(s: GameState, mods: Mods, hub: number, policy: HubPolicy): string {
  const b = s.buildings.find((x) => x.id === hub);
  if (!mods.feedPlanner) return 'Feed Planner research unlocks hub policies';
  if (!b?.hub || !Object.hasOwn(HUB_POLICIES, policy)) return 'No such hub or policy';
  b.hub.policy = policy;
  b.hub.plannerWhy = `${HUB_POLICIES[policy].label} — applies at each empty departure; manual orders take priority`;
  for (const u of unitsOf(s, hub)) delete u.planAt;
  return '';
}

export function setUnitFeedPlan(s: GameState, mods: Mods, id: number, on: boolean): string {
  const u = s.haulers.find((x) => x.id === id);
  if (!mods.feedPlanner) return 'Feed Planner research is required';
  if (!u) return 'No such unit';
  u.feedPlanOff = !on;
  delete u.planAt;
  u.planWhy = on ? 'Feed Planner enabled — reviewing its next empty departure' : 'Feed Planner off — basic hub dispatch remains active';
  return '';
}

/** Known lower-bound reserves, never hidden deposit truth. Plain ground is
 * plentiful; an unsurveyed deposit has unknown reserves, not infinite ore. */
function knownOre(s: GameState, mods: Mods, c: Choice): number | null {
  if (c.target.plain) return Infinity;
  const r = reservesOf(s, mods, c.target.key.slice(4));
  return r?.surveyed ? r.leftLo : null;
}

function liveChoice(s: GameState, c: Choice, u?: Hauler): boolean {
  const pit = pitOf(s, c.target.key);
  return c.inReach && c.trip.connected && freeFace(s, c.target, u) >= 0 &&
    pit?.state !== 'boxed' && pit?.state !== 'reclaiming' && pit?.state !== 'reclaimed';
}

/** Why adding another unit would not help (or its best useful intake).
 * Budget policy stays in automation.ts, shared with the rest of the Builder. */
export function usefulUnit(s: GameState, mods: Mods, site: SiteDef, b: BuildingState, headroom: number): {
  why: string; choice?: Choice; draw: number; gain: number; cycle: number;
} {
  const no = (why: string, draw = 0) => ({ why, draw, gain: 0, cycle: 0 });
  if (!b.hub || !b.enabled) return no('hub is shut down');
  const queue = queueRefusal(s, mods, b, 'unit');
  if (queue) return no(queue);
  if (b.hub.queue.length) return no('finish its current print queue first');
  if (b.idleReason && b.idleReason !== 'inputs') return no(`hub is waiting on ${b.idleReason}, not excavation`);
  const units = unitsOf(s, b.id);
  if (units.some((u) => u.parked || u.haul.src === 'flat' || u.haul.chg || u.haul.full ||
    u.haul.noRoad || u.haul.wait || u.latch || (u.rebootUntil ?? 0) > s.simTime || u.face < 0)) {
    return no('an existing unit is idle, charging, recalled, blocked or recovering — use it first');
  }
  const type = hubUnit(b.type, site);
  const r = unitRates(s, mods, site, { type, wear: 0 }, undefined, dayInfo(s.simTime, site).isNight);
  const baselineDraw = Math.max(HUB.printKW, -r.powerKW, UNIT_POWER.driveKW.digger * mods.unitDriveMult,
    UNIT_POWER.chargeKW.digger / mods.chargeEff);
  if (s.power.brownout || headroom < baselineDraw * 1.1) return no(`power first: another unit needs ${Math.ceil(baselineDraw * 1.1)} kW spare (have ${Math.floor(headroom)})`, baselineDraw);
  const choices = choicesFor(s, mods, site, b, 1).filter((c) => liveChoice(s, c) && (!b.hub!.prefer || c.target.key === b.hub!.prefer));
  if (!choices.length) return no('no free working face on a connected pit in reach', baselineDraw);
  const hunger = hubHunger(mods, site, b);
  const all = choicesFor(s, mods, site, b, 1);
  const intake = units.reduce((sum, u) => sum + (all.find((c) => c.target.key === u.target)?.rate ?? 0), 0);
  let refusal = 'existing units already meet the hub’s feed demand';
  let draw = baselineDraw;
  for (const c of choices) {
    const gain = Math.min(c.rate, Math.max(0, hunger - intake));
    if (gain < Math.max(0.05, hunger * 0.05)) continue;
    const rates = unitRates(s, mods, site, { type, wear: 0 }, c.target.kind, dayInfo(s.simTime, site).isNight);
    const rock = pitOf(s, c.target.key)?.rockR !== undefined;
    draw = Math.max(baselineDraw, -rates.powerKW * (rock ? 1.25 : 1));
    if (headroom < draw * 1.1) { refusal = `power first: ${c.target.name}${rock ? ' bedrock' : ''} needs ${Math.ceil(draw * 1.1)} kW spare (have ${Math.floor(headroom)})`; continue; }
    const ore = knownOre(s, mods, c);
    const totalRate = c.rate * (s.haulers.filter((u) => u.target === c.target.key).length + 1);
    if (ore === null) { refusal = `survey ${c.target.name} to confirm a lunar day of ore before printing`; continue; }
    if (ore < totalRate * CYCLE_S) { refusal = `${c.target.name} has only ${(ore / Math.max(0.01, totalRate) / CYCLE_S).toFixed(1)} lunar days of surveyed ore at +1 unit`; continue; }
    const spec = unitSpec(mods, type, unitRates(s, mods, site, { type, wear: 0 }, c.target.kind));
    return { why: '', choice: c, draw, gain, cycle: spec.digS + spec.unloadS + 2 * c.trip.t };
  }
  return no(refusal, draw);
}

export interface PlannerChoice { choice: Choice; score: number; product: number; energy: number; reserve: number | null }

/** Rank feasible routes using the unit's actual wear/capability. Global face
 * reservations prevent two hubs from treating the same occupied face as free. */
export function plannerChoices(s: GameState, mods: Mods, site: SiteDef, b: BuildingState, u: Hauler): PlannerChoice[] {
  const day = dayInfo(s.simTime, site);
  const policy = hubPolicy(b);
  const hunger = hubHunger(mods, site, b);
  const all = choicesFor(s, mods, site, b, 1, day.isNight);
  const otherFeed = unitsOf(s, b.id).filter((o) => o !== u && o.parked !== 'recalled')
    .reduce((n, o) => n + (all.find((c) => c.target.key === o.target)?.rate ?? 0), 0);
  const need = Math.max(hunger * 0.1, hunger - otherFeed);
  const reserveTarget = Math.min(hopperCap(b) * 0.85, hunger * (day.isNight ? day.phaseLeft : NIGHT_S));
  const fillingNightReserve = policy === 'night' && (b.hub?.hopper ?? 0) < reserveTarget;
  const out: PlannerChoice[] = [];
  for (const c of all) {
    if (!liveChoice(s, c, u)) continue;
    // Evaluate the candidate cut, not the unit's previous target/phase.
    const rates = unitRates(s, mods, site, { type: u.type, wear: u.wear, cap: u.cap }, c.target.kind, day.isNight);
    if (pitOf(s, c.target.key)?.rockR !== undefined) rates.powerKW *= 1.25;
    const spec = unitSpec(mods, u.type, rates);
    const cycle = spec.digS + spec.unloadS + 2 * c.trip.t;
    const avgKW = (Math.max(0, -rates.powerKW) * spec.digS + UNIT_POWER.driveKW.digger * mods.unitDriveMult * 2 * c.trip.t) / cycle;
    const healthy = unitRates(s, mods, site, { type: u.type, wear: 0 }, c.target.kind, day.isNight);
    const healthyBucket = unitSpec(mods, u.type, healthy).bucket;
    const rate = c.rate * spec.bucket / Math.max(0.01, healthyBucket);
    const product = Math.min(rate, need) * c.q;
    const reserve = knownOre(s, mods, c);
    const reserveFactor = reserve === null ? 0.9 : Math.min(1, reserve / Math.max(1, 2 * spec.bucket));
    // Early departure from a nearly spent surveyed cut; no truth-only foresight.
    const score = (fillingNightReserve ? Math.min(rate, need) / (1 + c.trip.t / HUB.reachS)
      : policy === 'conserve' ? product / Math.max(0.1, avgKW) : product) * reserveFactor;
    out.push({ choice: c, score, product, energy: avgKW, reserve });
  }
  return out.sort((a, b) => b.score - a.score || a.choice.trip.t - b.choice.trip.t || a.choice.target.key.localeCompare(b.choice.target.key));
}

function playerOrSafetyHold(s: GameState, b: BuildingState, u: Hauler): string {
  if (u.feedPlanOff) return 'Feed Planner off — basic hub dispatch remains active';
  if (u.pinned) return 'Manual Send order — Feed Planner leaves this unit assigned';
  if (b.hub?.prefer) return 'Manual Assign order — Feed Planner follows the hub’s assigned pit';
  if (u.parked === 'recalled') return 'Recalled — waiting for your Dispatch order';
  if (!b.enabled || u.parked === 'off') return 'Hub shut down';
  if (u.parked === 'charge' || u.haul.chg || u.haul.src === 'flat') return 'Charging or awaiting power — routing resumes when ready';
  if (u.latch || (u.rebootUntil ?? 0) > s.simTime) return 'Machine recovery takes priority';
  if ((s.pits ?? []).some((p) => p.state === 'reclaiming' && p.reclaimHub === b.id)) return 'Reclamation takes priority';
  return '';
}

/** One review per tick, at most one switch per unit per two minutes. A 15%
 * improvement is required while its current route remains usable. */
export function planHubFeeds(s: GameState, mods: Mods, site: SiteDef): { unit: number; hub: number; why: string } | null {
  if (!mods.feedPlanner || s.auto.frozenUntil > s.simTime) return null;
  const sorted = [...s.haulers].sort((a, b) => (a.planAt ?? -1e9) - (b.planAt ?? -1e9) || a.id - b.id);
  for (const u of sorted) {
    const b = hubOf(s, u);
    if (!b?.hub) continue;
    const hold = playerOrSafetyHold(s, b, u);
    if (hold) { u.planWhy = hold; continue; }
    if (s.simTime - (u.planAt ?? -1e9) < REVIEW_S) continue;
    const h = u.haul;
    if ((h.cargo.regolith ?? 0) > 1e-6 || (h.phase !== 'park' && h.phase !== 'toDig')) continue;
    const [x, z] = standPoint(b);
    if (h.phase !== 'park' && Math.hypot(h.x - x, h.z - z) > 8) continue;
    u.planAt = s.simTime;
    const list = plannerChoices(s, mods, site, b, u);
    const best = list[0];
    const current = list.find((c) => c.choice.target.key === u.target);
    if (!best) {
      b.hub.plannerWhy = u.planWhy = 'Holding — no connected pit in reach with a free working face';
      return null;
    }
    const pick = current && best.score < current.score * SWITCH_GAIN ? current : best;
    const why = `${HUB_POLICIES[hubPolicy(b)].label}: ${pick.choice.target.name}, ${fmtClock(pick.choice.trip.t)} one way, grade ${pick.choice.q.toFixed(2)}`;
    if (pick.choice.target.key === u.target) {
      b.hub.plannerWhy = u.planWhy = `${why} — keeping this route; alternatives must improve the policy score by 15%`;
      return null;
    }
    const refusal = sendUnit(s, mods, u.id, pick.choice.target.key);
    // sendUnit supplies the safe, road-aware departure; this is an automatic
    // target, never a player pin. Every check above preserves manual orders.
    if (!refusal) {
      u.pinned = false;
      b.hub.plannerWhy = u.planWhy = why;
      return { unit: u.id, hub: b.id, why };
    }
    b.hub.plannerWhy = u.planWhy = `Holding — ${refusal}`;
    return null;
  }
  return null;
}

export function plannerSummary(s: GameState, mods: Mods, b: BuildingState): string {
  if (!mods.feedPlanner) return 'Feed Planner research unlocks routing policies; basic hub dispatch already finds reachable working faces.';
  if (s.auto.frozenUntil > s.simTime) return 'Builder frozen — Feed Planner paused';
  if (b.hub?.prefer) return 'Manual Assign order takes priority over routing policy';
  return b.hub?.plannerWhy ?? `${HUB_POLICIES[hubPolicy(b)].help} Reviews empty departures; manual orders take priority.`;
}
