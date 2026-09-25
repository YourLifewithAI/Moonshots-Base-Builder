/** The Regolith Excavator as a mobile digger (economy step 4).
 *
 *  Its home pad is where it was placed: the pad stays occupied and is its
 *  parking spot. Its dig site defaults to that pad (today's behaviour). The
 *  cycle: drive to the dig site → dig a bucket (HAUL.digS) → drive to the
 *  nearest operating regolith consumer (a smelter or refinery; the Lander if
 *  there is none) → unload (HAUL.unloadS) → back to the dig. Regolith, and
 *  whatever else the recipe digs, is credited on unload, and the feed grade
 *  (the smelter and refinery shares) is an EMA over the loads delivered,
 *  weighted by amount. The bucket scales with the excavator's output
 *  multipliers (wear, overclock, techs, the site's ISRU, the deposit), so
 *  every multiplier still means what it did; distance is the new lever.
 *  Power draw is as before, while the cycle runs. */
import { BUILDINGS } from '../data/buildings';
import { TECHS, type TechId } from '../data/techs';
import { HAUL } from '../data/balance';
import type { ResourceId } from '../data/resources';
import type { SiteDef } from '../data/sites';
import { FEED_KINDS, feedKindOf, type FeedGrade, type FeedKind } from '../data/deposits';
import type { BuildingState, GameState, HaulState } from './state';
import { effectiveDef, type EffectiveRates, type Mods } from './mods';
import { centerOf } from '../buildings/instances';
import { PATH_HALF, UNIT, inside, pathLength, plan, ring, wallSpot, worldRect, type Rect } from './paths';

const isSite = (b: { construction?: number }) => (b.construction ?? 0) > 0;
const label = (b: BuildingState) => `${BUILDINGS[b.type].name} #${b.id}`;
/** regolith per second the recipe names: the bucket's reference */
const NAMEPLATE = BUILDINGS.excavator.outputs.regolith ?? 1.5;
/** while digging, the bucket fills this many times faster than the old static
 *  output: a full bucket at nameplate is HAUL.bucket */
const GAIN = HAUL.bucket / (NAMEPLATE * HAUL.digS);

export interface HaulSpec { bucket: number; digS: number; unloadS: number; speed: number }

/** The cycle under the mods (Autonomous Haulage: speed, and a bigger bucket that takes longer to fill). */
export function haulSpec(mods: Pick<Mods, 'haulSpeedMult' | 'haulBucketMult'>): HaulSpec {
  return {
    bucket: HAUL.bucket * mods.haulBucketMult,
    digS: HAUL.digS * mods.haulBucketMult,
    unloadS: HAUL.unloadS,
    speed: HAUL.speed * mods.haulSpeedMult,
  };
}

/** The drive speed the techs done give (the visuals' copy of haulSpec().speed). */
export function haulSpeed(techsDone: readonly TechId[]): number {
  let m = 1;
  for (const t of techsDone) for (const fx of TECHS[t]?.effects ?? []) if (fx.kind === 'haul') m *= fx.speedMult ?? 1;
  return HAUL.speed * m;
}

/** A fresh cycle: digging its own pad. */
export function newHaul(b: BuildingState): HaulState {
  const [x, z] = centerOf(b);
  return {
    digX: x, digZ: z, phase: 'dig', x, z, path: [], t: 0, cargo: {}, kind: feedKindOf(b.deposit), drop: null,
    ...(b.deposit ? { pad: b.deposit } : {}),
  };
}

/** An excavator's haul state, created on first use (placement, or an old save). */
export function ensureHaul(b: BuildingState): HaulState | null {
  if (b.type !== 'excavator') return null;
  b.haul ??= newHaul(b);
  return b.haul;
}

/** Does it dig its own pad? */
export function digsHome(b: BuildingState): boolean {
  if (!b.haul) return true;
  const [x, z] = centerOf(b);
  return Math.hypot(b.haul.digX - x, b.haul.digZ - z) < 0.5;
}

const consumesRegolith = (b: BuildingState, mods: Mods) => (effectiveDef(b.type, mods).inputs.regolith ?? 0) > 0;

/** Where a load dug at (x, z) goes: the nearest operating regolith consumer
 *  (complete, enabled, not dark or short-handed), else the nearest complete
 *  one, else the Lander. */
export function dropFor(s: GameState, mods: Mods, x: number, z: number): BuildingState | null {
  const ready = s.buildings.filter((b) => b.enabled && !isSite(b) && consumesRegolith(b, mods));
  const operating = ready.filter((b) => b.idleReason !== 'power' && b.idleReason !== 'crew');
  const pool = operating.length ? operating : ready.length ? ready : s.buildings.filter((b) => b.type === 'lander');
  let best: BuildingState | null = null, bd = Infinity;
  for (const b of pool) {
    const p = wallSpot(worldRect(b), x, z, HAUL.unloadOut);
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

/** how far apart two diggers' resting spots stand (a dig, a pad, an unload
 *  stand): two bodies whose centres may each lead their origin by `off` */
export const DIGGER_GAP = 2 * (UNIT.digger.r + UNIT.digger.off);

/** A square keep-out round a digger standing at (x, z) (any heading), for
 *  planners: other units' paths keep their own clearance off it. */
export function keepOut(id: number, x: number, z: number, half = UNIT.digger.r + UNIT.digger.off): Rect {
  return { id: -1000 - id, x0: x - half, z0: z - half, x1: x + half, z1: z + half };
}

/** Where the other excavators stand still: each one's dig (its pad, or the
 *  ground it digs away from it) and the stand it holds at a consumer (driving
 *  there, or unloading). */
export function diggerSpots(s: GameState, self: number | null): { id: number; x: number; z: number; home: boolean }[] {
  const out: { id: number; x: number; z: number; home: boolean }[] = [];
  for (const o of s.buildings) {
    if (o.id === self || o.type !== 'excavator' || isSite(o)) continue;
    const h = o.haul;
    const home = digsHome(o);
    const [px, pz] = centerOf(o);
    out.push({ id: o.id, x: h?.digX ?? px, z: h?.digZ ?? pz, home });
    if (!home) out.push({ id: o.id, x: px, z: pz, home: true });
    const stand = h ? standHeld(h) : null;
    if (stand) out.push({ id: o.id, x: stand[0], z: stand[1], home: false });
  }
  return out;
}

/** The unload stand a haul holds: where it is headed to unload, or unloading. */
export function standHeld(h: HaulState): [number, number] | null {
  if (h.phase === 'unload') return [h.x, h.z];
  if (h.phase === 'toDrop') {
    const end = h.path[h.path.length - 1];
    return end ? [end[0], end[1]] : [h.x, h.z];
  }
  return null;
}

/** every footprint the digger drives around (its own pad it drives over), and
 *  the ground other diggers dig away from their pads (they stand there a
 *  minute at a time) */
function rectsFor(s: GameState, self: BuildingState): Rect[] {
  const out = s.buildings.filter((b) => b.id !== self.id).map(worldRect);
  for (const o of s.buildings) {
    if (o.id === self.id || o.type !== 'excavator' || !o.haul || isSite(o) || digsHome(o)) continue;
    out.push(keepOut(o.id, o.haul.digX, o.haul.digZ));
  }
  return out;
}

/** Where digger `b` unloads at `drop`, coming from (x, z): the wall spot
 *  nearest it (as it always was) when that is clear, else the nearest clear
 *  one round the walls — clear of every other footprint by the haul
 *  clearance, and DIGGER_GAP from wherever another digger stands still
 *  (so two never unload in one place, nor on each other's dig). */
export function standFor(s: GameState, b: BuildingState, drop: BuildingState, x: number, z: number): { x: number; z: number } {
  const r = worldRect(drop);
  const first = wallSpot(r, x, z, HAUL.unloadOut);
  const walls = s.buildings.filter((o) => o.id !== b.id && o.id !== drop.id).map(worldRect);
  const others = diggerSpots(s, b.id);
  const m = HAUL.clear * 0.9;
  const free = (px: number, pz: number) =>
    Math.abs(px) < PATH_HALF && Math.abs(pz) < PATH_HALF &&
    !walls.some((w) => inside(px, pz, w, m)) &&
    !others.some((o) => Math.hypot(o.x - px, o.z - pz) < DIGGER_GAP);
  if (free(first.x, first.z)) return { x: first.x, z: first.z };
  const rg = ring(r, HAUL.unloadOut);
  const u0 = rg.uOf(x, z);
  for (let k = 1; k <= rg.len; k++) {
    for (const u of [u0 + k, u0 - k]) {
      const p = rg.at(u);
      if (free(p.x, p.z)) return { x: p.x, z: p.z };
    }
  }
  return { x: first.x, z: first.z };
}

/** Why digger `b` should not dig at (x, z) because another one stands there
 *  ('' = none): another's dig, pad or stand within DIGGER_GAP. */
export function digCrowded(s: GameState, b: BuildingState, x: number, z: number): string {
  const o = diggerSpots(s, b.id).find((p) => Math.hypot(p.x - x, p.z - z) < DIGGER_GAP);
  if (!o) return '';
  const other = s.buildings.find((q) => q.id === o.id)!;
  return `TOO CLOSE TO ${label(other).toUpperCase()} — it ${o.home ? 'parks' : 'digs'} there; pick ground ${Math.ceil(DIGGER_GAP)} m off`;
}

export interface Trip {
  drop: BuildingState | null;
  /** path length dig site → unload spot, m */
  routeM: number;
  /** seconds per load: dig, both legs, unload */
  cycleS: number;
  /** regolith per game-second delivered at these output multipliers */
  rate: number;
  /** the load per trip, regolith */
  load: number;
}

/** What digging at (x, z) delivers: the drop it would haul to, the route and the rate. */
export function tripFor(
  s: GameState, mods: Mods, b: BuildingState, x: number, z: number, regolithOut: number,
): Trip {
  const spec = haulSpec(mods);
  const drop = dropFor(s, mods, x, z);
  let routeM = 0;
  if (drop) {
    const p = standFor(s, b, drop, x, z);
    routeM = pathLength(x, z, plan(x, z, p.x, p.z, rectsFor(s, b), HAUL.clear));
  }
  const load = regolithOut * GAIN * spec.digS;
  const cycleS = spec.digS + spec.unloadS + (2 * routeM) / spec.speed;
  return { drop, routeM, cycleS, rate: load / cycleS, load };
}

/** The feed grade after `amt` of `kind` is delivered: an amount-weighted EMA. */
export function creditFeed(feed: FeedGrade, kind: FeedKind, amt: number) {
  if (amt <= 0) return;
  const total = FEED_KINDS.reduce((a, k) => a + feed[k], 0);
  if (total <= 1e-9) {
    for (const k of FEED_KINDS) feed[k] = k === kind ? 1 : 0;
    return;
  }
  const a = amt / (amt + HAUL.feedMemory);
  for (const k of FEED_KINDS) feed[k] = (feed[k] / total) * (1 - a) + (k === kind ? a : 0);
}

/** Room the stockpile has for a resource (Infinity when uncapped). */
const roomFor = (s: GameState, caps: Partial<Record<ResourceId, number>>, rid: ResourceId) =>
  caps[rid] === undefined ? Infinity : Math.max(0, caps[rid]! - s.resources[rid]);

/** Waiting to unload: the stockpile has no room for the load (economy step 2
 *  stands it by, like a producer whose output is full — no power drawn). A
 *  load bigger than the whole store tips once the store is empty. */
export function haulWaiting(s: GameState, b: BuildingState, caps: Partial<Record<ResourceId, number>>): boolean {
  const h = b.haul;
  const reg = h?.phase === 'unload' ? h.cargo.regolith ?? 0 : 0;
  return reg > 0 && roomFor(s, caps, 'regolith') < Math.min(reg, caps.regolith ?? Infinity);
}

/** Drive along the path for up to `t` seconds; returns the time left over on arrival. */
function drive(h: HaulState, speed: number, t: number): number {
  while (h.path.length && t > 1e-9) {
    const [tx, tz] = h.path[0];
    const d = Math.hypot(tx - h.x, tz - h.z);
    const step = speed * t;
    if (step < d) {
      h.x += ((tx - h.x) / d) * step;
      h.z += ((tz - h.z) / d) * step;
      return 0;
    }
    h.x = tx;
    h.z = tz;
    t -= d / speed;
    h.path.shift();
  }
  return t;
}

/** The ground it digs is under a structure now: back to its own pad. */
function digBlocked(s: GameState, b: BuildingState, h: HaulState): BuildingState | null {
  return s.buildings.find((o) => o.id !== b.id && inside(h.digX, h.digZ, worldRect(o), 0)) ?? null;
}

/** A new leg from where it stands: the path, and the whole leg kept (the visuals follow it). */
function setLeg(h: HaulState, path: [number, number][]) {
  h.path = path;
  h.route = [[h.x, h.z], ...path.map(([x, z]): [number, number] => [x, z])];
}

function startDig(s: GameState, b: BuildingState, h: HaulState) {
  h.phase = 'toDig';
  h.t = 0;
  h.drop = null;
  setLeg(h, plan(h.x, h.z, h.digX, h.digZ, rectsFor(s, b), HAUL.clear));
}

function startDrop(s: GameState, mods: Mods, b: BuildingState, h: HaulState) {
  const drop = dropFor(s, mods, h.x, h.z);
  h.phase = 'toDrop';
  h.t = 0;
  h.drop = drop?.id ?? null;
  if (!drop) { setLeg(h, []); return; }
  const p = standFor(s, b, drop, h.x, h.z);
  setLeg(h, plan(h.x, h.z, p.x, p.z, rectsFor(s, b), HAUL.clear));
  const m = pathLength(h.x, h.z, h.path);
  if (s.stats) s.stats.haulMaxM = Math.max(s.stats.haulMaxM ?? 0, m);
}

export interface HaulTick {
  /** what was unloaded into the stockpile this tick */
  credited: Partial<Record<ResourceId, number>>;
  /** the cycle's average delivery per second (the HUD's smoothed flow counts this, not the lumps) */
  flow: Partial<Record<ResourceId, number>>;
  /** seconds spent digging this tick */
  dugS: number;
  /** an alert to raise, if any */
  note: string;
}

/** Advance one running excavator's cycle by dt game-seconds. `r` is its
 *  effective rates this tick (the bucket fills at r.outputs × GAIN). */
export function haulTick(
  s: GameState, mods: Mods, b: BuildingState, r: EffectiveRates, dt: number,
  caps: Partial<Record<ResourceId, number>>,
): HaulTick {
  const h = ensureHaul(b)!;
  const spec = haulSpec(mods);
  const out: HaulTick = { credited: {}, flow: {}, dugS: 0, note: '' };
  let t = dt;
  for (let guard = 0; t > 1e-9 && guard < 12; guard++) {
    if (h.phase === 'toDig') {
      t = drive(h, spec.speed, t);
      if (!h.path.length) { h.phase = 'dig'; h.t = 0; }
      continue;
    }
    if (h.phase === 'toDrop') {
      // the consumer it was heading for is gone or shut: find another
      const drop = s.buildings.find((x) => x.id === h.drop);
      if (!drop || !drop.enabled) startDrop(s, mods, b, h);
      t = drive(h, spec.speed, t);
      if (!h.path.length) { h.phase = 'unload'; h.t = 0; }
      continue;
    }
    if (h.phase === 'dig') {
      if (h.t <= 0) {
        const over = digBlocked(s, b, h);
        if (over) {
          const [x, z] = centerOf(b);
          h.digX = x;
          h.digZ = z;
          if (h.pad) b.deposit = h.pad; else delete b.deposit;
          out.note = `DIG SITE BUILT OVER — ${label(b)} is back on its own pad (${label(over)} stands there)`;
          if (Math.hypot(h.x - x, h.z - z) > 0.5) { startDig(s, b, h); continue; }
        }
        h.kind = feedKindOf(b.deposit);
      }
      const step = Math.min(t, spec.digS - h.t);
      for (const [rid, rate] of Object.entries(r.outputs) as [ResourceId, number][]) {
        h.cargo[rid] = (h.cargo[rid] ?? 0) + rate * GAIN * step;
      }
      h.t += step;
      t -= step;
      out.dugS += step;
      if (h.t >= spec.digS - 1e-9) startDrop(s, mods, b, h);
      continue;
    }
    // unload: tip the bucket, then back to the dig
    const step = Math.min(t, spec.unloadS - h.t);
    h.t += step;
    t -= step;
    if (h.t < spec.unloadS - 1e-9) continue;
    const reg = h.cargo.regolith ?? 0;
    if (haulWaiting(s, b, caps)) break; // waits for room (step 2 stands it by from the next tick)
    for (const [rid, amt] of Object.entries(h.cargo) as [ResourceId, number][]) {
      const add = Math.min(amt, roomFor(s, caps, rid));
      s.resources[rid] += add;
      out.credited[rid] = (out.credited[rid] ?? 0) + add;
    }
    creditFeed(s.feed, h.kind, reg);
    h.cargo = {};
    startDig(s, b, h);
  }
  // the smoothed flow: this route's average, at this tick's rates
  const routeM = routeEstimate(s, mods, h);
  const cycleS = spec.digS + spec.unloadS + (2 * routeM) / spec.speed;
  for (const [rid, rate] of Object.entries(r.outputs) as [ResourceId, number][]) {
    out.flow[rid] = (rate * GAIN * spec.digS) / cycleS;
  }
  return out;
}

/** straight-line estimate of the dig → drop leg (for the per-tick flow; the
 *  inspector's trip estimate plans the real route) */
function routeEstimate(s: GameState, mods: Mods, h: HaulState): number {
  const drop = (h.drop !== null && s.buildings.find((x) => x.id === h.drop)) || dropFor(s, mods, h.digX, h.digZ);
  if (!drop) return 0;
  const p = wallSpot(worldRect(drop), h.digX, h.digZ, HAUL.unloadOut);
  return Math.hypot(p.x - h.digX, p.z - h.digZ);
}

/** Why the excavator cannot dig at (x, z) ('' = it can). `mapped`: the
 *  ground is inside the survey radius or a mast's, or on a revealed deposit. */
export function digRefusal(
  s: GameState, site: SiteDef, b: BuildingState | undefined, x: number, z: number, mapped: boolean, revealM: number,
): string {
  if (!b || b.type !== 'excavator') return 'NOT AN EXCAVATOR';
  if (isSite(b)) return 'STILL UNDER CONSTRUCTION — it digs once it stands';
  if (Math.abs(x) > PATH_HALF || Math.abs(z) > PATH_HALF) return 'OUTSIDE THE SURVEY AREA';
  if (site.buildableRadiusM > 0 && Math.hypot(x, z) > site.buildableRadiusM) return 'BEYOND THE LAVA TUBE FOOTPRINT';
  if (!mapped) {
    return `UNMAPPED GROUND — the survey maps ${Math.round(revealM)} m around the Lander; a Relay Mast or the next map tier reaches further`;
  }
  const over = s.buildings.find((o) => o.id !== b.id && inside(x, z, worldRect(o), 0));
  if (over) return `UNDER A STRUCTURE — ${label(over)} stands there; pick open ground`;
  return digCrowded(s, b, x, z);
}

/** Point the excavator at new ground (validate with digRefusal first; the
 *  caller stamps b.deposit for the new ground). A bucket already started is
 *  hauled first; then it heads for the new dig. */
export function setDigSite(s: GameState, mods: Mods, b: BuildingState, x: number, z: number) {
  const h = ensureHaul(b)!;
  h.digX = x;
  h.digZ = z;
  if (h.phase === 'dig') {
    if ((h.cargo.regolith ?? 0) > 0) startDrop(s, mods, b, h); // take what it has dug to the consumer first
    else startDig(s, b, h);
  } else if (h.phase === 'toDig') {
    startDig(s, b, h);
  }
}

/** The dig site back on its own pad ("Return home"); b.deposit returns to the pad's. */
export function digAtHome(s: GameState, mods: Mods, b: BuildingState) {
  const [x, z] = centerOf(b);
  setDigSite(s, mods, b, x, z);
  const pad = b.haul?.pad;
  if (pad) b.deposit = pad; else delete b.deposit;
}
