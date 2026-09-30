/** Extraction hubs (docs/17 §3–§5; Phases 1–2): the Regolith Smelter, the
 *  Silicon Refinery and the Water Management Plant print, dock, charge and
 *  dispatch their own units, and each unit feeds its own hub's hopper.
 *
 *  - **Hubs.** A hub commissions with its first unit (priced in). More are
 *    printed from its queue: paid at the head, printed at 4 kW, capped by
 *    bays (Level I: 2). Bays are the road bay cells beside its door; the
 *    tipping stand is the door cell.
 *  - **Units** (`s.haulers`). The cycle is the excavator's haul with new
 *    ends: bay → road → gate → off-road → face → dig → back → tip at the
 *    hub → out again. A full hopper leaves the unit waiting at its face.
 *  - **Where a unit digs** (§4.4): Send… pins it; else its hub's Assign if
 *    a face is free; else the best hub intake, min(units × rate, hunger) × q,
 *    over the mapped wanted deposits in reach (90 s one way) and the hub's
 *    plain pit. Faces are reserved at assignment and shared by every hub.
 *  - **Plain pits** are staked points (§8.6), each an extraction zone of kind
 *    'plain'. `dug` is the one place a dig happens: it grows the target's
 *    strip-mine pit (core/pits.ts, `digInto`), a deposit's shared by every
 *    unit on it. Once cut, units drive in by the pit's ramp to faces on its
 *    floor (`wayIn`, `facePoint`).
 *  - **Regolith.** Hoppers hold it; `resources.regolith` is pile + Σ hoppers,
 *    written every tick. Anything else that changes resources.regolith
 *    (grants, grading, research goods, a legacy pad's load) goes to or comes
 *    from the pile, which hubs draw first.
 *
 *  Deterministic: hubs in id order, units in id order, fixed tie-breaks. */
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { HUB, HUB_DEFS, UNIT_DEFS, isHubType, type UnitType } from '../data/hubs';
import { ROAD } from '../data/roads';
import { CELL_M, MAP_CELLS, MAP_M, PIT, UNIT_POWER } from '../data/balance';
import { RESOURCES, type ResourceId } from '../data/resources';
import { DEPOSIT_INFO, FEED_KINDS, emptyFeed, feedKindOf, type DepositKind, type FeedGrade, type FeedKind } from '../data/deposits';
import { SITES, type SiteDef } from '../data/sites';
import type { BuildingState, GameState, HaulState, Hauler, HubJob, HubState, PitState, PlainPit, ZoneState } from './state';
import { effectiveDef, effectiveRates, refineryFeed, smelterFeed, waterFeed, type EffectiveRates, type Mods } from './mods';
import {
  bumpRoads, cellAt, cellCentre, cellKey, doorCell, frontDir, gatesOf, groundWay, hasRoads, isOpen, jobOpen, keyCell,
  layJob, planLink, roadMap, type Heights, type LinkOpts, type OffArea, type Ring,
} from './roads';
import {
  digInto, faceCapacity, floorDepth, pitFor, pitName, pitOf, pitOreLeft, pitRefusal, pushFill, releasePit, reservesOf, ringOf, targetGrade, terrainOf,
} from './pits';
import { GRADE } from '../data/ore';
import { groundOf, plainQ, processOf } from './ore';
import { TECHS, TECH_ORDER } from '../data/techs';
import { HAUL } from '../data/balance';
import { zoneAt, zoneOfCell } from './zones';
import { creditFeed, legLen, stopShort } from './haul';
import { go, holdSpot, trafficPlan, yieldAside, type Ramp } from './traffic';
import { centerOf, footprintRect } from '../buildings/instances';
import { inside, worldRect } from './paths';
import { groundMapped, landerXZ } from './exploration';
import { mulberry32, hashString } from './rng';
import { recordSpend } from './flowBook';
import { alert, condition } from './economy';
import { fmtClock } from './daynight';
import { FLARE_EFFECTS } from '../data/spaceWeather';

type Pt = [number, number];
const isSite = (b: { construction?: number }) => (b.construction ?? 0) > 0;
export const hubName = (b: BuildingState) => `${BUILDINGS[b.type].name} #${b.id}`;
/** 'E3', 'I5' */
export const unitTag = (u: Pick<Hauler, 'id' | 'type'>) => `${UNIT_DEFS[u.type].letter}${u.id}`;
export const unitName = (t: UnitType) => BUILDINGS[t].name;

// ───────────────────────────── the heights (roads need them) ─────────────────────────────

const heights = new WeakMap<GameState, Heights>();
/** Game.bootWorld binds the heightfield: the sim plans haul roads and stakes plain pits with it. */
export function bindHeights(s: GameState, hf: Heights) { heights.set(s, hf); }
export const heightsOf = (s: GameState): Heights | undefined => heights.get(s);

// ───────────────────────────── hubs and their state ─────────────────────────────

export function newHubState(): HubState {
  return { level: 1, hopper: 0, q: 1, feed: emptyFeed(), queue: [], starved: 0 };
}

/** Complete hubs with their state, in id order. */
export function hubsOf(s: GameState): BuildingState[] {
  return s.buildings.filter((b) => isHubType(b.type) && !isSite(b) && !!b.hub);
}

export const hubOf = (s: GameState, u: Hauler): BuildingState | undefined =>
  s.buildings.find((b) => b.id === u.hub && !!b.hub);

export const unitsOf = (s: GameState, hubId: number): Hauler[] => s.haulers.filter((u) => u.hub === hubId);

/** The unit this hub prints at this site. */
export const hubUnit = (type: BuildingId, site: Pick<SiteDef, 'hasIce'>): UnitType => HUB_DEFS[type]!.unit(site);

/** Its hopper's capacity, ▲. */
export const hopperCap = (b: BuildingState): number => HUB_DEFS[b.type]?.hopper ?? 0;

/** Bays: Level I 2, II 3, III 4, and what research adds to every hub. */
export const bayCap = (b: BuildingState, mods: Pick<Mods, 'hubBays'>): number =>
  HUB.bays[(b.hub?.level ?? 1) - 1] + mods.hubBays;

/** The bay cells laid beside its door, in order (left and right of the door, then further out). */
export function bayCells(s: GameState, b: BuildingState): Pt[] {
  const d = doorCell(b);
  if (!d || !hasRoads(s)) return [];
  const [fx, fz] = frontDir(b);
  const map = roadMap(s);
  const out: Pt[] = [];
  for (let k = 1; k <= 3; k++) {
    for (const side of [-1, 1]) {
      const c: Pt = [d[0] + side * k * -fz, d[1] + side * k * fx];
      if (map.get(cellKey(c[0], c[1]))?.bay) out.push(c);
    }
  }
  return out;
}

/** Where bay `i` parks its unit (world m): the bay cell's centre (a hub with
 *  fewer bay cells than bays doubles up in its last one; with none, its door). */
export function bayPoint(s: GameState, b: BuildingState, i: number): Pt {
  const cells = bayCells(s, b);
  if (cells.length) { const c = cells[Math.min(i, cells.length - 1)]; return cellCentre(c[0], c[1]); }
  const d = doorCell(b);
  return d ? cellCentre(d[0], d[1]) : centerOf(b);
}

/** The lowest bay no unit of this hub holds. */
function freeBay(s: GameState, b: BuildingState): number {
  const held = new Set(unitsOf(s, b.id).map((u) => u.bay));
  let i = 0;
  while (held.has(i)) i++;
  return i;
}

// ───────────────────────────── targets: deposits and plain pits ─────────────────────────────

export interface Target {
  key: string;
  /** a deposit's kind, or undefined: plain ground */
  kind: DepositKind | undefined;
  name: string;
  cx: number; cz: number; r: number;
  zone: ZoneState | null;
  faces: number;
  plain: boolean;
}

/** 'dep:ilmenite-0', 'plain:3' */
export const depKey = (id: string) => `dep:${id}`;
export const plainKey = (id: number) => `plain:${id}`;
/** The target key a zone names: a deposit's, a plain pit's, or (a pit's zone) its pit's. */
export const keyOfZone = (s: GameState, z: ZoneState): string | null =>
  z.kind === 'pit' ? s.pits?.find((p) => `pit-${p.id}` === z.id)?.key ?? null : z.kind === 'plain' ? z.id : depKey(z.id);

/** A target's zone, faces and place (null: gone, or not mapped). */
export function targetOf(s: GameState, key: string | null | undefined): Target | null {
  if (!key) return null;
  if (key.startsWith('plain:')) {
    const id = Number(key.slice(6));
    const p = s.plainPits.find((x) => x.id === id);
    if (!p) return null;
    const zone = s.zones?.find((z) => z.id === key) ?? null;
    return { key, kind: undefined, name: `plain pit P${p.id}`, cx: p.x, cz: p.z, r: HUB.plainR, zone, faces: faceCapacity(s, key).now, plain: true };
  }
  if (!key.startsWith('dep:')) return null;
  const zone = s.zones?.find((z) => z.id === key.slice(4)) ?? null;
  if (!zone || zone.kind === 'plain' || zone.kind === 'pit') return null;
  // faces are benches (docs/17 §8.2): a new pit has one; they open as it widens
  const faces = faceCapacity(s, key).now;
  const n = zone.id.split('-').pop();
  return {
    key, kind: zone.kind, name: `${DEPOSIT_INFO[zone.kind].name} #${n}`, cx: zone.cx, cz: zone.cz, r: zone.r, zone, faces, plain: false,
  };
}

/** The pit a target is dug into, once cut (null: not yet). */
export const pitAt = (s: GameState, t: Pick<Target, 'key'>): PitState | null => pitOf(s, t.key);

/** m between two faces of one pit at least (a unit is 3.8 m across) */
const FACE_GAP_M = 3.6;

/** Face `i`'s point (world m). Once its pit is cut: on the pit's floor by
 *  the wall, spread round the far side from its ramp (1:2 walls: the floor
 *  is R − 2L across). Before: evenly round the target from a seeded angle. */
export function facePoint(s: GameState, t: Target, i: number): Pt {
  const p = pitAt(s, t);
  if (p) {
    let rf = Math.max(0, p.R - PIT.bench * floorDepth(s, p)) * 0.85;
    // (docs/19 S4a, S4b) faces sit far enough apart for the bodies of the units that dig them (a deep cone's
    // floor is a few metres across: its faces spread onto the wall's foot rather than pile up in the middle),
    // and on the far side from the ramp: the outer faces at least 100° round from its axis, so a unit driving up
    // to the ramp's foot does not pass within a body of one that digs
    const spread = t.faces > 1 ? Math.min(Math.PI * 1.2, 0.45 * Math.PI * (t.faces - 1)) : 0;
    if (t.faces > 1) rf = Math.min(Math.max(rf, FACE_GAP_M / 2 / Math.sin(spread / (2 * (t.faces - 1)))), 0.8 * p.R);
    const back = Math.atan2(-p.uz, -p.ux);
    const a = back + (t.faces > 1 ? (Math.max(0, i) / (t.faces - 1) - 0.5) * spread : 0);
    return [p.cx + Math.cos(a) * rf, p.cz + Math.sin(a) * rf];
  }
  const a0 = mulberry32((s.seed ^ hashString(t.key)) >>> 0)() * Math.PI * 2;
  const a = a0 + (Math.max(0, i) * Math.PI * 2) / t.faces;
  const rr = t.plain ? HUB.plainFaceR : HUB.faceR * t.r;
  return [t.cx + Math.cos(a) * rr, t.cz + Math.sin(a) * rr];
}

/** Faces held at a target (by any hub's units), but `except`'s. */
function heldFaces(s: GameState, key: string, except?: Hauler): Set<number> {
  const out = new Set<number>();
  for (const u of s.haulers) if (u !== except && u.target === key && u.face >= 0) out.add(u.face);
  return out;
}

/** The lowest free face at a target (-1: every face is working). */
export function freeFace(s: GameState, t: Target, except?: Hauler): number {
  const held = heldFaces(s, t.key, except);
  for (let i = 0; i < t.faces; i++) if (!held.has(i)) return i;
  return -1;
}

/** Faces working now at a target. */
export const facesUsed = (s: GameState, key: string): number => heldFaces(s, key).size;

// ───────────────────────────── speeds, legs and trips ─────────────────────────────

/** A unit's road speed now (m/s): its type's, the haul techs, the roadway tiers. */
export function unitSpeed(mods: Mods, type: UnitType, night = false): number {
  return UNIT_DEFS[type].speed * mods.haulSpeedMult * mods.roadSpeedMult * mods.roadHaulMult * (night ? mods.roadNightMult : 1);
}

/** Off-road weights under the mods (Pit Mapping speeds units off-road). */
function offWeights(w: number[] | undefined, mods: Mods): number[] | undefined {
  if (!w) return undefined;
  return w.map((x) => (x > 1 + 1e-9 ? x / mods.haulOffroadMult : x));
}

/** How a unit gets into a target (§6.1, §11.4): the area it leaves the road
 *  by — the target's zone, with its pit's zone once there is one (their
 *  gates) — and, once the pit is cut, its ramp: the top on the rim, then the
 *  foot where it meets the floor. */
export function wayIn(s: GameState, t: Target): { area: OffArea | null; via: Pt[] } {
  const gates: [number, number][] = [];
  const seen = new Set<number>();
  const add = (z: ZoneState | null | undefined) => {
    if (!z) return;
    for (const g of gatesOf(s, z)) { const k = cellKey(g[0], g[1]); if (!seen.has(k)) { seen.add(k); gates.push(g); } }
  };
  add(t.zone);
  const p = pitAt(s, t);
  let via: Pt[] = [];
  if (p) {
    add(s.zones?.find((z) => z.id === `pit-${p.id}`));
    const rf = Math.max(0, p.R - PIT.bench * floorDepth(s, p));
    via = [[p.ox + p.ux * p.A, p.oz + p.uz * p.A], [p.cx + p.ux * rf, p.cz + p.uz * rf]];
  }
  return { area: gates.length ? { id: t.key, gates } : null, via };
}

/** The target a unit works (else the one whose zone it stands in), and
 *  whether it is down in its pit (or at its face, before the first cut),
 *  so it leaves up the ramp. Null: no target, and in no zone. */
function standsIn(s: GameState, u: Hauler): { t: Target; face: boolean } | null {
  const h = u.haul;
  let t = u.target ? targetOf(s, u.target) : null;
  if (!t) {
    const z = zoneAt(s, h.x, h.z);
    const key = z ? keyOfZone(s, z) : null;
    t = key ? targetOf(s, key) : null;
  }
  if (!t) return null;
  const p = pitAt(s, t);
  const down = p ? Math.hypot(h.x - p.cx, h.z - p.cz) < Math.max(1, p.R - PIT.bench) : Math.hypot(h.x - h.digX, h.z - h.digZ) < 1;
  return { t, face: down };
}

/** A leg from `a` to `b`: the ground way (road, then off-road inside a zone),
 *  its first point dropped. `hub`: b is that hub's door (stop short of its
 *  wall). `from`: a is inside that target (`fromFace`: at a face, so up its
 *  ramp first); `to`: b is a face of that target (down its ramp last). */
function legTo(
  s: GameState, mods: Mods, a: Pt, b: Pt, hub?: BuildingState,
  ends: { from?: Target | null; fromFace?: boolean; to?: Target | null; variant?: 0 | 1 } = {},
): { pts: Pt[]; w?: number[] } | null {
  const OFF = 1 / ROAD.offroad;
  let head: Pt[] = [], tail: Pt[] = [];
  let aArea: OffArea | null = null, bArea: OffArea | null = null;
  let a0 = a, b0 = b;
  if (ends.from) {
    const wi = wayIn(s, ends.from);
    aArea = wi.area;
    if (ends.fromFace && wi.via.length) { head = [...wi.via].reverse(); a0 = head[head.length - 1]; }
  }
  if (ends.to) {
    const wi = wayIn(s, ends.to);
    bArea = wi.area;
    if (wi.via.length) { tail = [...wi.via.slice(1), b]; b0 = wi.via[0]; }
  }
  // face to face in one pit: across its floor
  if (ends.from && ends.to && ends.from.key === ends.to.key && ends.fromFace) { head = []; tail = [b]; a0 = a; b0 = a; }
  const way = a0 === b0 ? { pts: [a0], w: [] as number[] } : groundWay(s, a0, b0, null, hub ? doorCell(hub) : null, aArea, bArea, ends.variant ?? 0);
  if (!way) return null;
  // way.w[i] is the segment into way.pts[i + 1]: it lines up with the points after the first
  const mid = way.pts.slice(1);
  let pts: Pt[] = [...head, ...mid, ...tail];
  let w = head.length || tail.length || way.w
    ? offWeights([...head.map(() => OFF), ...(way.w?.slice() ?? mid.map(() => 1)), ...tail.map(() => OFF)], mods)
    : undefined;
  if (hub) pts = stopShort(pts, a, hub);
  if (pts.length && Math.hypot(pts[0][0] - a[0], pts[0][1] - a[1]) < 1e-6) { pts = pts.slice(1); w = w?.slice(1); }
  if (!pts.length) return { pts: [[a[0], a[1]]] };
  return { pts, ...(w ? { w } : {}) };
}

/** The hub's tipping stand (its door cell's centre). */
export function standPoint(b: BuildingState): Pt {
  const d = doorCell(b);
  return d ? cellCentre(d[0], d[1]) : centerOf(b);
}

export interface TripEst {
  /** one way from the hub's door to the face, s (Infinity: no way) */
  t: number;
  /** m of road, and of off-road (time-equivalent at the off-road weight) */
  roadM: number;
  offM: number;
  /** a road reaches the target's gate */
  connected: boolean;
}

const tripMemo = new Map<string, TripEst>();

/** One way from the hub's door to face 0 of a target, at the unit's speed.
 *  A target no road reaches yet is estimated: the straight line × 1.3 to its
 *  rim, then off-road (§6.1's ≈). Memoised on the network and the zones. */
export function tripTo(s: GameState, mods: Mods, b: BuildingState, t: Target, night = false): TripEst {
  const type = hubUnit(b.type, SITES[s.siteId]);
  const v = unitSpeed(mods, type, night);
  const pit = pitAt(s, t);
  const key = `${s.roadRev ?? 0},${s.roads?.length ?? 0},${s.zones?.length ?? 0}|${b.id}|${t.key}|${v.toFixed(3)}|${mods.haulOffroadMult}`
    + (pit ? `|${Math.round(pit.R)},${Math.round(pit.A)}` : '');
  const hit = tripMemo.get(key);
  if (hit) return hit;
  const from = standPoint(b);
  const face = facePoint(s, t, 0);
  // in by the target's gates (its pit's too), then down the ramp to the face
  const wi = wayIn(s, t);
  const inner: Pt[] = wi.via.length ? [...wi.via, face] : [];
  const way = wi.area ? groundWay(s, from, inner[0] ?? face, doorCell(b), null, null, wi.area) : null;
  let est: TripEst;
  const offW = 1 / (ROAD.offroad * mods.haulOffroadMult);
  if (way) {
    let roadM = 0, offM = 0;
    const w = way.w;
    for (let i = 1; i < way.pts.length; i++) {
      const l = Math.hypot(way.pts[i][0] - way.pts[i - 1][0], way.pts[i][1] - way.pts[i - 1][1]);
      if (w && (w[i - 1] ?? 1) > 1 + 1e-9) offM += l; else roadM += l;
    }
    for (let i = 1; i < inner.length; i++) offM += Math.hypot(inner[i][0] - inner[i - 1][0], inner[i][1] - inner[i - 1][1]);
    est = { t: (roadM + offM * offW) / v, roadM, offM, connected: true };
  } else {
      const d = Math.hypot(t.cx - from[0], t.cz - from[1]);
    const rim = Math.max(0, d - t.r);
    const offM = t.plain ? HUB.plainR - HUB.plainFaceR : t.r * (1 - HUB.faceR);
    est = { t: (rim * 1.3 + offM * offW) / v, roadM: rim * 1.3, offM, connected: false };
  }
  if (tripMemo.size > 4000) tripMemo.clear();
  tripMemo.set(key, est);
  return est;
}

/** A unit's rates digging `kind` ground (its wear, the techs, the site's ISRU, the deposit). */
export function unitRates(s: GameState, mods: Mods, site: SiteDef, u: Pick<Hauler, 'type' | 'wear'> & Partial<Pick<Hauler, 'cap' | 'target' | 'haul'>>, kind: DepositKind | undefined, night = false): EffectiveRates {
  // its rad scars (docs/16 §4.13) derate the bucket as wear does
  const stub = { id: -1, type: u.type, gx: 0, gz: 0, rot: 0, enabled: true, automated: true, priority: 2, wear: u.wear, dust: 0,
    ...(u.cap !== undefined ? { cap: u.cap } : {}),
    construction: 0, buildTotal: 0, active: true, idleReason: '', ...(kind ? { deposit: kind } : {}) } as BuildingState;
  const rates = effectiveRates(u.type, mods, site, stub, { agentRun: true, robotic: true, isNight: night });
  const pit = u.target ? (s.pits ?? []).find((p) => p.key === u.target) : undefined;
  if (u.haul?.phase === 'dig' && !u.haul.full && pit?.rockR !== undefined && pit.state !== 'reclaiming') rates.powerKW *= 1.25;
  return rates;
}

export interface UnitSpec { bucket: number; digS: number; unloadS: number; gain: number }

/** The cycle under the mods: a bucket (scaled by the unit's output
 *  multipliers, as the excavator's was), dig and tip times, and the fill
 *  rate per unit of recipe output. */
export function unitSpec(mods: Mods, type: UnitType, r: EffectiveRates): UnitSpec {
  const d = UNIT_DEFS[type];
  const ref = BUILDINGS[type].outputs.regolith ?? 1;
  const digS = d.digS * mods.haulBucketMult / mods.haulDigMult;
  const gain = d.bucket / (ref * d.digS) * mods.haulDigMult;
  return { bucket: (r.outputs.regolith ?? 0) * gain * digS, digS, unloadS: d.unloadS, gain };
}

// ───────────────────────────── the auto choice (§4.4) ─────────────────────────────

/** A hub's grade on `kind` ground in general (docs/17 §9.1: a deposit's
 *  mid-range centre, else plain ground), before crew: the ghost's estimate.
 *  The units' own choice reads the pit's cut (core/pits.ts targetGrade). */
export function groundQ(mods: Mods, site: SiteDef, type: BuildingId, kind: DepositKind | undefined): number {
  const proc = processOf(mods, site, type);
  if (!proc || proc === 'MRE') return 1;
  const range = kind ? GRADE.centre[kind]?.[proc] : undefined;
  const q = range ? (range[0] + range[1]) / 2 : plainQ(proc, site.id);
  return q * mods.gradeAll * (proc === 'H2' ? mods.gradeH2 : 1);
}
void effectiveDef; void smelterFeed; void refineryFeed; void waterFeed; void emptyFeed; void groundOf;

/** What the hub burns a second, ▲. */
export function hubHunger(mods: Mods, site: SiteDef, b: BuildingState): number {
  return effectiveRates(b.type, mods, site, b, { feed: b.hub?.feed }).inputs.regolith ?? 0;
}

// The ghost's HUB line and block (Phase 5): core/hubPreview.ts.

export interface Choice {
  target: Target;
  trip: TripEst;
  /** ▲/s one unit delivers there */
  rate: number;
  q: number;
  /** min(units × rate, hunger) × q */
  score: number;
  free: number;
  inReach: boolean;
}

/** Every place the hub's units might dig, best first (reach not applied: `inReach` says). */
export function choicesFor(s: GameState, mods: Mods, site: SiteDef, b: BuildingState, n = 1, night = false): Choice[] {
  const def = HUB_DEFS[b.type];
  if (!def) return [];
  const wants = new Set(def.wants(site));
  const type = def.unit(site);
  const out: Choice[] = [];
  const hunger = hubHunger(mods, site, b);
  const keys: string[] = [];
  for (const z of s.zones ?? []) {
    if (z.kind === 'pit') continue;
    if (z.kind === 'plain') { if (z.id === plainKey(b.hub?.plainPit ?? -1)) keys.push(z.id); continue; }
    if (wants.has(z.kind)) keys.push(depKey(z.id));
  }
  for (const key of keys) {
    const t = targetOf(s, key);
    if (!t) continue;
    if (t.plain && !def.plain(site)) continue;
    const pit = pitOf(s, key);
    if (pit && (pit.state === 'reclaiming' || pit.state === 'reclaimed')) continue;
    // the grade of its cut now (docs/17 §9); a water plant never digs a dug-out pit
    const q = targetGrade(s, mods, site, b.type, key);
    if (!(q > 0.005)) continue;
    const trip = tripTo(s, mods, b, t, night);
    const r = unitRates(s, mods, site, { type, wear: 0 }, t.kind);
    const spec = unitSpec(mods, type, r);
    const rate = spec.bucket / (spec.digS + spec.unloadS + 2 * trip.t) * (pit?.rockR !== undefined ? GRADE.bedrockDig : 1);
    out.push({
      target: t, trip, rate, q, score: Math.min(Math.max(1, n) * rate, hunger) * q, free: t.faces - facesUsed(s, key),
      inReach: trip.t <= HUB.reachS,
    });
  }
  out.sort((x, y) => y.score - x.score || x.trip.t - y.trip.t || (x.target.key < y.target.key ? -1 : 1));
  return out;
}

/** Why a unit of this hub may not dig at `t` ('' = it may): reach (`send`: 2×). */
function reachRefusal(s: GameState, mods: Mods, b: BuildingState, t: Target, send: boolean): string {
  const trip = tripTo(s, mods, b, t);
  const lim = HUB.reachS * (send ? HUB.sendReach : 1);
  if (trip.t > lim) return `OUT OF REACH — ${t.name} is ${fmtClock(trip.t)} one way (reach ${fmtClock(lim)})`;
  return '';
}

/** Where a haul road to a target aims (docs/19 S3): its pit's ramp top once cut, else the zone's
 *  centre. The road stops at a gate on the zone's rim, on the hub's side of it, and the pit's ramp
 *  will face that gate; the drive on from the gate is short whichever face it is. */
export function haulEnd(s: GameState, t: Target): Pt {
  const via = wayIn(s, t).via[0];
  if (via) return via;
  const [gx, gz] = cellAt(t.cx, t.cz);
  return !t.zone || zoneOfCell(s, gx, gz)?.id === t.zone.id ? [t.cx, t.cz] : facePoint(s, t, 0);
}

/** What a hub's haul road to `t` is planned with (core/roads.ts planLink): from the hub's door,
 *  keeping out of the other wanted pits' full-size rings, the tail of it inside its own ring
 *  sacrificial. */
export function haulOpts(s: GameState, hub: Pick<BuildingState, 'type' | 'gx' | 'gz' | 'rot'>, t: Target): LinkOpts {
  const site = SITES[s.siteId];
  const wanted = new Set<DepositKind>();
  for (const def of Object.values(HUB_DEFS)) for (const k of def!.wants(site)) wanted.add(k);
  const rings: Ring[] = [];
  for (const z of s.zones ?? []) {
    if (z.kind === 'pit') continue;
    const key = z.kind === 'plain' ? z.id : depKey(z.id);
    if (key === t.key || (z.kind !== 'plain' && !wanted.has(z.kind))) continue;
    const r = ringOf(s, key);
    if (r) rings.push(r);
  }
  return { hub, rings, ring: ringOf(s, t.key) };
}

/** Lay the haul road to a target no road reaches yet (a free-rover job, once;
 *  a refused one is asked again a minute later): planned from the hub's door,
 *  merging into the network, to a gate on the hub's side of the target. */
function askRoad(s: GameState, b: BuildingState, t: Target): string {
  const hf = heightsOf(s);
  const asks = (b.hub!.roads ??= {});
  const a = asks[t.key];
  if (a && a.job > 0 && !jobOpen(s, a.job)) return '';
  if (a && a.job > 0) return '';
  if (a && s.simTime - a.at < 60) return a.why ?? '';
  if (!hf) return 'no heights';
  const end = haulEnd(s, t);
  const plan = planLink(s, hf, null, cellAt(end[0], end[1]), haulOpts(s, b, t));
  if (plan.reason) { asks[t.key] = { job: 0, at: s.simTime, why: `NO HAUL ROAD — ${plan.reason}` }; return asks[t.key].why!; }
  const job = layJob(s, plan, 'haul', b.id);
  asks[t.key] = { job, at: s.simTime };
  return '';
}

/** Pick where an auto unit digs: Assign, else the best intake with a free
 *  face and a road to it (a better target no road reaches yet gets its haul
 *  road asked for). Returns the target and face, or why it parks. */
function chooseFor(s: GameState, mods: Mods, site: SiteDef, u: Hauler, b: BuildingState): { t: Target; face: number } | { why: string } {
  const hub = b.hub!;
  // Reclaim (docs/17 §12.2): the hub's units push a worked-out pit's heap back in, first
  for (const p of s.pits ?? []) {
    if (p.state !== 'reclaiming' || p.reclaimHub !== b.id) continue;
    const t = targetOf(s, p.key);
    if (!t) continue;
    const f = freeFace(s, t, u);
    if (f < 0) continue;
    if (tripTo(s, mods, b, t).connected) return { t, face: f };
    askRoad(s, b, t);
  }
  // Assign: the hub's preferred pit, while a face is free there
  if (hub.prefer) {
    const t = targetOf(s, hub.prefer);
    if (t && !reachRefusal(s, mods, b, t, false)) {
      const f = freeFace(s, t, u);
      if (f >= 0 && tripTo(s, mods, b, t).connected) return { t, face: f };
      if (f >= 0) askRoad(s, b, t);
    }
  }
  const auto = unitsOf(s, b.id).filter((x) => !x.pinned).length;
  const list = choicesFor(s, mods, site, b, auto).filter((c) => c.inReach);
  // the one it works now stays unless another is clearly better (no flip-flopping);
  // a deposit's pit with ore left keeps its units until it is dug out (docs/17 §10:
  // they extract it concentrically — moving them on early is Feed Planner's job)
  const cur = u.target ? list.find((c) => c.target.key === u.target && c.trip.connected) : undefined;
  if (cur && !cur.target.plain && freeFace(s, cur.target, u) >= 0) {
    const p = pitAt(s, cur.target);
    if (p && !p.spent && p.state !== 'boxed') {
      return { t: cur.target, face: u.face >= 0 && u.target === cur.target.key ? u.face : freeFace(s, cur.target, u) };
    }
  }
  let why = 'IDLE — no pit in reach with a free face';
  for (const c of list) {
    if (cur && c !== cur && c.score <= cur.score * 1.1 && freeFace(s, cur.target, u) >= 0) {
      return { t: cur.target, face: u.face >= 0 && u.target === cur.target.key ? u.face : freeFace(s, cur.target, u) };
    }
    const f = freeFace(s, c.target, u);
    if (f < 0) continue;
    if (!c.trip.connected) { const w = askRoad(s, b, c.target); if (w) why = w; continue; }
    return { t: c.target, face: u.target === c.target.key && u.face >= 0 ? u.face : f };
  }
  return { why };
}

// ───────────────────────────── plain pits (§8.6) ─────────────────────────────

/** The pits' setbacks (docs/17 §8.1; core/pits.ts): nothing is dug within
 *  12 m of a structure's walls or 8 m of a road, door, bay or apron. */
export const PIT_WALL_M = PIT.padRings * CELL_M;
export const PIT_ROAD_M = PIT.roadRings * CELL_M;

/** Why a plain pit may not be staked at (x, z) ('' = it may): its zone keeps
 *  the pits' setbacks from every structure and road. */
export function plainPitRefusal(s: GameState, mods: Mods, site: SiteDef, x: number, z: number): string {
  const half = MAP_M / 2 - CELL_M * 3 - HUB.plainR;
  if (Math.abs(x) > half || Math.abs(z) > half) return 'OUTSIDE THE SURVEY AREA';
  if (site.buildableRadiusM > 0 && Math.hypot(x, z) > site.buildableRadiusM - HUB.plainR) return 'BEYOND THE LAVA TUBE FOOTPRINT';
  if (!groundMapped(s, x, z, mods.surveyTier)) return 'UNMAPPED GROUND — map it first (Prospecting Drones, a Relay Mast)';
  for (const z0 of s.zones ?? []) {
    if (Math.hypot(z0.cx - x, z0.cz - z) < z0.r + HUB.plainR + 4) {
      return z0.kind === 'plain' || z0.kind === 'pit' ? 'ANOTHER PIT — too close to a pit' : 'A DEPOSIT — Assign it instead';
    }
  }
  const too = `TOO CLOSE — a pit keeps ${PIT_WALL_M} m from structures' walls and ${PIT_ROAD_M} m from roads`;
  for (const b of s.buildings) if (inside(x, z, worldRect(b), HUB.plainR + PIT_WALL_M)) return too;
  const clear = HUB.plainR + PIT_ROAD_M;
  const map = roadMap(s);
  const [gx, gz] = cellAt(x, z);
  const n = Math.ceil(clear / CELL_M);
  for (let dz = -n; dz <= n; dz++) {
    for (let dx = -n; dx <= n; dx++) {
      if (!map.has(cellKey(gx + dx, gz + dz))) continue;
      const [cx, cz] = cellCentre(gx + dx, gz + dz);
      if (Math.hypot(cx - x, cz - z) < clear) return too;
    }
  }
  return '';
}

/** Stake a plain pit (its zone joins s.zones); returns it. */
export function addPlainPit(s: GameState, x: number, z: number, hub: number | null): PlainPit {
  const p: PlainPit = { id: s.nextPlainPitId++, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, hub };
  s.plainPits.push(p);
  syncPlainZones(s);
  return p;
}

/** The plain pits' zones: after the deposits', before the carved pits' (Game.syncZones keeps all three). */
export function plainZones(s: GameState): ZoneState[] {
  return s.plainPits.map((p) => ({ id: plainKey(p.id), kind: 'plain' as const, cx: p.x, cz: p.z, r: HUB.plainR }));
}

/** s.zones with every plain pit's zone in it, in order: deposits, plain pits,
 *  carved pits (a cell in two stays the first's). A fresh array when it
 *  changes: the zone memos key on it. */
export function syncPlainZones(s: GameState) {
  const all = s.zones ?? [];
  const deps = all.filter((z) => z.kind !== 'plain' && z.kind !== 'pit');
  const next = [...deps, ...plainZones(s), ...all.filter((z) => z.kind === 'pit')];
  const prev = s.zones ?? [];
  if (prev.length === next.length && prev.every((z, i) => z.id === next[i].id)) return;
  s.zones = next;
  bumpRoads(s);
}

/** The hub's plain pit, proposed (§8.6): the nearest mapped open ground 20–60 m
 *  from its door, on the side away from the base's centre, clear of structures,
 *  roads, deposits and other pits, that a haul road can reach. Null: none. */
export function proposePlainPit(s: GameState, mods: Mods, site: SiteDef, b: Pick<BuildingState, 'type' | 'gx' | 'gz' | 'rot'>): Pt | null {
  const [dx, dz] = standPoint(b as BuildingState);
  const [lx, lz] = landerXZ(s);
  const [cx, cz] = centerOf(b);
  let ax = cx - lx, az = cz - lz;
  const al = Math.hypot(ax, az);
  if (al < 1) { const [fx, fz] = frontDir(b); ax = fx; az = fz; } else { ax /= al; az /= al; }
  const cands: { x: number; z: number; score: number }[] = [];
  for (let r = HUB.plainMinM; r <= HUB.plainMaxM; r += 4) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const x = dx + Math.cos(a) * r, z = dz + Math.sin(a) * r;
      const away = Math.cos(a) * ax + Math.sin(a) * az;
      cands.push({ x, z, score: r - 12 * away });
    }
  }
  cands.sort((p, q) => p.score - q.score || p.x - q.x || p.z - q.z);
  const hf = heightsOf(s);
  let tries = 0;
  for (const c of cands) {
    if (plainPitRefusal(s, mods, site, c.x, c.z)) continue;
    if (!hf || !hasRoads(s)) return [c.x, c.z];
    // the haul road must reach its rim: a trial zone, then the plan
    const zones = s.zones;
    s.zones = [...(zones ?? []), { id: 'plain:?', kind: 'plain', cx: c.x, cz: c.z, r: HUB.plainR }];
    const plan = planLink(s, hf, null, cellAt(c.x, c.z));
    s.zones = zones;
    if (!plan.reason) return [c.x, c.z];
    if (++tries >= 8) break;
  }
  return null;
}

/** Stake the hub's plain pit if it has none (the ghost does at placement; the
 *  sim does when its units find nothing else). */
export function stakeHubPit(s: GameState, mods: Mods, site: SiteDef, b: BuildingState): PlainPit | null {
  const h = b.hub;
  if (h?.plainPit !== undefined && s.plainPits.some((p) => p.id === h.plainPit)) return null;
  if (!HUB_DEFS[b.type]?.plain(site)) return null;
  const at = proposePlainPit(s, mods, site, b);
  if (!at) return null;
  const p = addPlainPit(s, at[0], at[1], b.id);
  if (h) h.plainPit = p.id;
  return p;
}

// ───────────────────────────── printing: the queue ─────────────────────────────

/** A job's price at this site. */
export function jobCost(b: BuildingState, kind: HubJob['kind'], site: SiteDef, mods?: Pick<Mods, 'hubPrintCost'>): Record<'metals' | 'parts', number> {
  const c = kind === 'bay' ? HUB.bay.cost : UNIT_DEFS[hubUnit(b.type, site)].cost;
  // a scarred unit's Re-print (docs/16 §4.14): half its price
  const k = (kind === 'reprint' ? FLARE_EFFECTS.replace.cost : 1) * (kind === 'bay' ? 1 : mods?.hubPrintCost ?? 1);
  return { metals: Math.ceil(c.metals * site.buildCostMult * k), parts: Math.ceil(c.parts * site.buildCostMult * k) };
}

/** A job's print time at this site, s. */
export function jobTime(b: BuildingState, kind: HubJob['kind'], site: SiteDef, mods: Pick<Mods, 'hubPrintTime'>): number {
  const t = kind === 'bay' ? HUB.bay.printS : UNIT_DEFS[hubUnit(b.type, site)].printS * (kind === 'reprint' ? FLARE_EFFECTS.replace.time : 1);
  return Math.round(t * site.buildCostMult * (kind === 'bay' ? 1 : mods.hubPrintTime));
}

/** Why the hub cannot queue that job ('' = it can). */
export function queueRefusal(s: GameState, mods: Mods, b: BuildingState | undefined, kind: HubJob['kind']): string {
  if (!b || !isHubType(b.type)) return 'NOT A HUB';
  if (isSite(b) || !b.hub) return 'STILL UNDER CONSTRUCTION — it prints once it stands';
  const h = b.hub;
  if (h.queue.length >= HUB.queueMax) return `QUEUE FULL — ${HUB.queueMax} jobs`;
  if (kind === 'unit') {
    const cap = bayCap(b, mods);
    const have = unitsOf(s, b.id).length;
    const queued = h.queue.filter((j) => j.kind === 'unit').length;
    if (have + queued >= cap) {
      return `BAYS FULL ${Math.min(have, cap)}/${cap}${queued ? ` (${queued} printing)` : ''}${h.level < mods.hubLevel ? ' — + Bay' : ' — every bay has its unit'}`;
    }
    const blocked = bonusBayRefusal(s, mods, b, have + queued);
    if (blocked) return blocked;
    return '';
  }
  const queued = h.queue.filter((j) => j.kind === 'bay').length;
  if (h.level + queued >= mods.hubLevel) {
    const tech = h.level === 1 ? TECHS.bayExtensions.name : TECHS.depotHalls.name;
    return h.level >= 3 ? 'LEVEL III — the most bays a hub holds' : `NEEDS ${tech.toUpperCase()} — research it, then buy this hub’s next bay`;
  }
  if (!nextBayCell(s, b, bayCells(s, b).length + queued)) return 'NO ROOM FOR ANOTHER BAY — beside its bays is a road, structure, pit or extraction zone';
  return '';
}

/** The cell the next bay would take (the k-th bay: further along the front), or null. */
function nextBayCell(s: GameState, b: BuildingState, k: number): Pt | null {
  const d = doorCell(b);
  if (!d) return null;
  const [fx, fz] = frontDir(b);
  const side = k % 2 === 0 ? -1 : 1;
  const dist = Math.floor(k / 2) + 1;
  const c: Pt = [d[0] + side * dist * -fz, d[1] + side * dist * fx];
  const k0 = cellKey(c[0], c[1]);
  if (c[0] < 1 || c[1] < 1 || c[0] >= MAP_CELLS - 1 || c[1] >= MAP_CELLS - 1) return null;
  if (roadMap(s).has(k0)) return null;
  for (const o of s.buildings) {
    const r = footprintRect(o);
    if (c[0] >= r.gx0 && c[0] < r.gx1 && c[1] >= r.gz0 && c[1] < r.gz1) return null;
  }
  // A bay follows the same ground rule as its hub: never erase a pit,
  // reclaim its spoil implicitly, or extend pavement into an extraction zone.
  if (zoneOfCell(s, c[0], c[1])) return null;
  const hf = terrainOf(s);
  if (hf && pitRefusal(s, hf, c[0], c[1], c[0] + 1, c[1] + 1)) return null;
  return c;
}

/** Free research bays use real parking cells too. Local jobs still own
 *  level changes, so a granted bay never advances or pays a + Bay job. */
function provisionBonusBays(s: GameState, mods: Pick<Mods, 'hubBays'>, b: BuildingState) {
  if (!(mods.hubBays > 0) || !hasRoads(s)) return;
  const target = bayCap(b, mods);
  while (bayCells(s, b).length < target) {
    const c = nextBayCell(s, b, bayCells(s, b).length);
    if (!c) break;
    s.roads!.push({ gx: c[0], gz: c[1], left: 0, bay: true });
    bumpRoads(s);
  }
}

/** A researched slot blocked by neighboring ground cannot hold a new unit. */
function bonusBayRefusal(s: GameState, mods: Pick<Mods, 'hubBays'>, b: BuildingState, used: number): string {
  const paid = HUB.bays[(b.hub?.level ?? 1) - 1];
  return mods.hubBays > 0 && hasRoads(s) && used >= paid && used >= bayCells(s, b).length &&
    !nextBayCell(s, b, bayCells(s, b).length)
    ? 'FLEET OS BAY BLOCKED — the extra parking cell needs clear ground beside this hub; roads, structures and pits keep it closed'
    : '';
}

/** Queue a job; '' on success, else the refusal. */
export function queueJob(s: GameState, mods: Mods, site: SiteDef, b: BuildingState | undefined, kind: HubJob['kind'], by: HubJob['by'] = 'player'): string {
  const why = queueRefusal(s, mods, b, kind);
  if (why) return why;
  b!.hub!.queue.push({ kind, paid: null, t: 0, total: jobTime(b!, kind, site, mods), by });
  return '';
}

/** Cancel a job: all it was paid comes back. */
export function cancelJob(s: GameState, b: BuildingState | undefined, index: number): string {
  const h = b?.hub;
  if (!h || index < 0 || index >= h.queue.length) return 'NO SUCH JOB';
  const [j] = h.queue.splice(index, 1);
  for (const [rid, amt] of Object.entries(j.paid ?? {})) s.resources[rid as ResourceId] += amt ?? 0;
  return '';
}

/** The head job printing now, drawing its kW (paid, and the hub on). */
export const printing = (b: BuildingState): HubJob | null => {
  const j = b.hub?.queue[0];
  return j && j.paid && b.enabled ? j : null;
};

// ───────────────────────────── a unit's cycle ─────────────────────────────

/** A new unit, parked in its bay. */
function newUnit(s: GameState, b: BuildingState, site: SiteDef): Hauler {
  const bay = freeBay(s, b);
  const [x, z] = bayPoint(s, b, bay);
  const haul: HaulState = { digX: x, digZ: z, phase: 'park', x, z, path: [], t: 0, cargo: {}, kind: 'plain', drop: b.id };
  return { id: s.nextHaulerId++, type: hubUnit(b.type, site), hub: b.id, bay, target: null, face: -1, parked: 'new', haul, wear: 0 };
}

/** A unit rolls out of the hub: parked in a free bay, ready for work. */
export function addUnit(s: GameState, b: BuildingState, site: SiteDef): Hauler {
  const u = newUnit(s, b, site);
  s.haulers.push(u);
  s.haulers.sort((a, c) => a.id - c.id);
  return u;
}

/** A new leg from where the unit stands: the path, and the whole leg kept (the visuals follow it). */
function setLeg(h: HaulState, leg: { pts: Pt[]; w?: number[] } | null) {
  h.noRoad = !leg;
  h.path = leg?.pts.map(([x, z]): Pt => [x, z]) ?? [];
  if (leg?.w) h.w = [...leg.w]; else delete h.w;
  h.route = [[h.x, h.z], ...h.path.map(([x, z]): Pt => [x, z])];
}

/** Release its face (and, unpinned, its target). */
function release(u: Hauler) {
  u.face = -1;
  if (!u.pinned) u.target = null;
}

/** Out to its face: the leg from where it stands (face −1: every face is
 *  working, so to the target's gate nearest it, to wait there for one). */
function goDig(s: GameState, mods: Mods, u: Hauler, t: Target, face: number) {
  const h = u.haul;
  if (face < 0) {
    u.target = t.key;
    u.face = -1;
    delete u.parked;
    const gates = wayIn(s, t).area?.gates ?? [];
    let gate: Pt | null = null, bd = Infinity;
    for (const g of gates) {
      const c = cellCentre(g[0], g[1]);
      const d = Math.hypot(c[0] - h.x, c[1] - h.z);
      if (d < bd - 1e-9) { bd = d; gate = c; }
    }
    // it waits in a holding bay beside the gate if there is one (docs/19 S4a), never on the
    // gate itself, where the loaded unit coming back would meet it head on
    const zones = [t.zone?.id, pitAt(s, t) ? `pit-${pitAt(s, t)!.id}` : undefined].filter((x): x is string => !!x);
    const bay = gates.length ? holdSpot(s, u, zones, gates) : null;
    if (bay) gate = bay;
    h.wait = 'gate';
    h.phase = 'toDig';
    h.t = 0;
    if (gate) [h.digX, h.digZ] = gate;
    setLeg(h, gate ? unitLeg(s, mods, u, gate) : { pts: [[h.x, h.z]] });
    return;
  }
  u.target = t.key;
  u.face = face;
  delete u.parked;
  const [fx, fz] = facePoint(s, t, face);
  h.digX = fx; h.digZ = fz;
  h.kind = feedKindOf(t.kind);
  h.phase = 'toDig';
  h.t = 0;
  delete h.wait;
  setLeg(h, unitLeg(s, mods, u, [fx, fz], undefined, t));
}

/** A unit's leg from where it stands: up out of its pit first when it stands
 *  at its face; down into `to`'s pit when it goes to a face there. */
function unitLeg(
  s: GameState, mods: Mods, u: Hauler, b: Pt, hub?: BuildingState, to?: Target | null,
  where: { t: Target; face: boolean } | null = standsIn(s, u),
): { pts: Pt[]; w?: number[] } | null {
  const h = u.haul;
  const at = where;
  // (docs/19 S4b: by id parity, two units take the two trunks when a base has two)
  const variant = (u.id & 1) as 0 | 1;
  let leg = legTo(s, mods, [h.x, h.z], b, hub, { from: at?.face ? at.t : null, fromFace: !!at?.face, to, variant });
  // part way in (recalled, re-sent): out by its target's gates
  if (!leg && at) leg = legTo(s, mods, [h.x, h.z], b, hub, { from: at.t, to, variant });
  return leg;
}

/** Home to its bay, to stand there (`why`: the parked reason). */
function goBay(s: GameState, mods: Mods, u: Hauler, b: BuildingState, why: Hauler['parked']) {
  const h = u.haul;
  const from = standsIn(s, u);
  release(u);
  u.parked = why;
  const [bx, bz] = bayPoint(s, b, u.bay);
  if (Math.hypot(h.x - bx, h.z - bz) < 0.5) { h.phase = 'park'; h.path = []; delete h.w; h.route = [[h.x, h.z]]; return; }
  h.phase = 'toBay';
  h.t = 0;
  setLeg(h, unitLeg(s, mods, u, [bx, bz], undefined, null, from));
}

/** To the tipping stand at its own hub. */
function goTip(s: GameState, mods: Mods, u: Hauler, b: BuildingState) {
  const h = u.haul;
  delete h.full;
  h.phase = 'toDrop';
  h.t = 0;
  h.drop = b.id;
  setLeg(h, unitLeg(s, mods, u, standPoint(b), b));
  const m = legLen(h.x, h.z, { pts: h.path, ...(h.w ? { w: h.w } : {}) });
  if (s.stats) s.stats.haulMaxM = Math.max(s.stats.haulMaxM ?? 0, m);
}

/** Room left in a hub's hopper, ▲. */
export const hopperRoom = (b: BuildingState): number => Math.max(0, hopperCap(b) - (b.hub?.hopper ?? 0));

/** The one place a dig happens: unit `u` cut `tonnes` at grade `q` at its
 *  target. Its pit grows (core/pits.ts): the target's key is the pit's
 *  ('dep:<id>', shared by every unit on that deposit, or 'plain:<id>'), the
 *  volume ▲ ÷ 1.5 m³, the grade kept on the pit; a deposit's pit tallies its
 *  ore (docs/17 §10). */
export function dug(s: GameState, u: Hauler, tonnes: number, _kind: FeedKind, q: number) {
  if (!(tonnes > 0) || !u.target) return;
  const book = (s.dug ??= {});
  book[u.target] = (book[u.target] ?? 0) + tonnes;
  digInto(s, pitFor(s, u.target), tonnes, q);
}

export interface UnitTickOut {
  /** ▲ tipped into its hopper this tick, and anything else it credited (the retort's water) */
  tipped: number;
  credited: Partial<Record<ResourceId, number>>;
  /** its cycle's average delivery a second (the smoothed rates count this, not the lumps) */
  flow: Partial<Record<ResourceId, number>>;
  dugS: number;
  kind: FeedKind;
}

/** Advance one unit by dt game-seconds (dt already scaled by the share of
 *  its draw it was served: its pack in a brownout). */
export function unitTick(
  s: GameState, mods: Mods, site: SiteDef, u: Hauler, b: BuildingState, dt: number, night: boolean,
  caps: Partial<Record<ResourceId, number>>,
): UnitTickOut {
  const h = u.haul;
  const out: UnitTickOut = { tipped: 0, credited: {}, flow: {}, dugS: 0, kind: h.kind };
  const hub = b.hub!;
  const v = unitSpeed(mods, u.type, night);
  // held up in traffic only while it drives; a unit standing where a higher-priority one must pass gives way
  if (h.phase !== 'toDig' && h.phase !== 'toBay' && h.phase !== 'toDrop') delete h.held;
  yieldAside(s, u);
  // its rates on the ground it digs now (re-read if it changes target this tick)
  let rk = '', r: EffectiveRates = null!, spec: UnitSpec = null!;
  const at = (key: string | null) => {
    const tt = targetOf(s, key);
    if (!r || rk !== (key ?? '')) { rk = key ?? ''; r = unitRates(s, mods, site, u, tt?.kind, night); spec = unitSpec(mods, u.type, r); }
    return tt;
  };
  at(u.target);
  const packFull = UNIT_POWER.pack.digger * mods.packMult;
  let t = dt;
  for (let guard = 0; t > 1e-9 && guard < 12; guard++) {
    if (h.phase === 'park') {
      // its hub shut down: it stands in its bay until it is on again
      if (!b.enabled) { u.parked = 'off'; release(u); break; }
      if (u.parked === 'off') delete u.parked;
      if (u.parked === 'recalled') break;
      if (u.parked === 'charge') {
        if (h.charge !== undefined && h.charge < packFull * 0.95) break;
        delete u.parked;
      }
      // not at its bay (a new home, a load): it drives there first
      const [bx, bz] = bayPoint(s, b, u.bay);
      if (Math.hypot(h.x - bx, h.z - bz) > 0.5) { goBay(s, mods, u, b, u.parked); continue; }
      const pick = pickTarget(s, mods, site, u, b);
      if ('why' in pick) { u.parked = 'noPit'; noteWhy(u, pick.why); break; }
      goDig(s, mods, u, pick.t, pick.face);
      at(u.target);
      continue;
    }
    if (h.phase === 'toDig' || h.phase === 'toBay' || h.phase === 'toDrop') {
      if (h.noRoad) {
        // no road there (cut, or not open yet): it asks again
        if (h.phase === 'toDig' && u.target) setLeg(h, unitLeg(s, mods, u, [h.digX, h.digZ], undefined, h.wait ? null : targetOf(s, u.target)));
        else if (h.phase === 'toBay') setLeg(h, unitLeg(s, mods, u, bayPoint(s, b, u.bay)));
        else if (h.phase === 'toDrop') setLeg(h, unitLeg(s, mods, u, standPoint(b), b));
        if (h.noRoad) break;
      }
      t = go(s, u, v, t);
      if (h.path.length) continue;
      if (h.phase === 'toBay') { h.phase = 'park'; h.t = 0; continue; }
      if (h.phase === 'toDrop') { h.phase = 'unload'; h.t = 0; continue; }
      // at its gate, waiting for a face (sent to a full pit)
      if (h.wait === 'gate') {
        const tt = targetOf(s, u.target);
        // its pit is done with (dug out, hemmed in, reclaimed): home, to choose again
        if (!tt) { delete h.wait; goBay(s, mods, u, b, 'noPit'); continue; }
        const f = freeFace(s, tt, u);
        if (f < 0) break;
        goDig(s, mods, u, tt, f);
        at(u.target);
        continue;
      }
      h.phase = 'dig';
      h.t = h.full ? spec.digS : 0;
      continue;
    }
    if (h.phase === 'dig') {
      // the target went (a pit unstaked, dug out, hemmed in, reclaimed): it
      // leaves with what its bucket holds, and chooses again (docs/17 §10.2)
      const tt = at(u.target);
      if (!tt) {
        if ((h.cargo.regolith ?? 0) > 1e-6) goTip(s, mods, u, b); else goBay(s, mods, u, b, 'noPit');
        continue;
      }
      const pit = pitAt(s, tt);
      // Reclaim (§12.2): it pushes the heap back in, at its dig rate, with nothing to haul
      if (pit?.state === 'reclaiming') {
        const step = Math.min(t, Math.max(0, spec.digS - h.t));
        pushFill(pit, ((r.outputs.regolith ?? 0) * spec.gain * step) / PIT.tPerM3);
        h.t += step;
        t -= step;
        out.dugS += step;
        if (h.t >= spec.digS - 1e-9) {
          h.t = 0;
          if (h.charge !== undefined && h.charge < packFull * HUB.chargeAt) { goBay(s, mods, u, b, 'charge'); continue; }
        }
        continue;
      }
      // a full bucket and a full hopper: it waits here, at its face
      if (h.full) {
        if (hopperRoom(b) < (h.cargo.regolith ?? 0) - 1e-6) break;
        goTip(s, mods, u, b);
        continue;
      }
      // bedrock benches dig at ×0.3 (§8.5); the bucket carries the grade it cut (§9.1)
      const rock = pit?.rockR !== undefined ? GRADE.bedrockDig : 1;
      // Research can shorten the cycle while this bucket is already filling.
      // Never rewind time or subtract cargo when its new duration is shorter.
      const step = Math.min(t, Math.max(0, spec.digS - h.t) / rock);
      const q = targetGrade(s, mods, site, b.type, tt.key);
      const had = h.cargo.regolith ?? 0;
      let cut = 0;
      for (const [rid, rate] of Object.entries(r.outputs) as [ResourceId, number][]) {
        const amt = rate * spec.gain * step * rock;
        h.cargo[rid] = (h.cargo[rid] ?? 0) + amt;
        if (rid === 'regolith') cut = amt;
      }
      if (cut > 0) h.q = had > 1e-9 && h.q !== undefined ? (h.q * had + q * cut) / (had + cut) : q;
      dug(s, u, cut, h.kind, q);
      h.t += step * rock;
      t -= step;
      out.dugS += step;
      if (h.t >= spec.digS - 1e-9) {
        if (hopperRoom(b) < (h.cargo.regolith ?? 0) - 1e-6) { h.full = true; break; }
        goTip(s, mods, u, b);
      }
      continue;
    }
    // unload: tip into its own hub's hopper (the rest of the load: the tanks)
    const step = Math.min(t, spec.unloadS - h.t);
    h.t += step;
    t -= step;
    if (h.t < spec.unloadS - 1e-9) continue;
    const reg = Math.min(h.cargo.regolith ?? 0, hopperRoom(b));
    hub.hopper += reg;
    out.tipped += reg;
    // the hub's grade (docs/17 §9.1): an EMA of its loads' q, by amount (the first load sets it)
    if (reg > 0) {
      const lq = h.q ?? hub.q;
      const fresh = FEED_KINDS.reduce((a, k) => a + hub.feed[k], 0) <= 1e-9;
      hub.q = fresh ? lq : hub.q + (lq - hub.q) * (reg / (reg + HAUL.feedMemory));
    }
    creditFeed(hub.feed, h.kind, reg);
    for (const [rid, amt] of Object.entries(h.cargo) as [ResourceId, number][]) {
      if (rid === 'regolith' || !(amt > 0)) continue;
      const room = caps[rid] === undefined ? Infinity : Math.max(0, caps[rid]! - s.resources[rid]);
      const add = Math.min(amt, room);
      s.resources[rid] += add;
      out.credited[rid] = (out.credited[rid] ?? 0) + add;
    }
    h.cargo = {};
    delete h.q;
    out.kind = h.kind;
    // then: out again, or home — shut down, recalled, its pack low
    if (!b.enabled) { goBay(s, mods, u, b, 'off'); continue; }
    if (u.parked === 'recalled') { goBay(s, mods, u, b, 'recalled'); continue; }
    if (h.charge !== undefined && h.charge < packFull * HUB.chargeAt) { goBay(s, mods, u, b, 'charge'); continue; }
    const pick = pickTarget(s, mods, site, u, b);
    if ('why' in pick) { noteWhy(u, pick.why); goBay(s, mods, u, b, 'noPit'); continue; }
    goDig(s, mods, u, pick.t, pick.face);
    at(u.target);
  }
  // the smoothed flow: this target's average, at this tick's rates
  const tNow = at(u.target);
  if (tNow && h.phase !== 'park' && h.phase !== 'toBay') {
    const trip = tripTo(s, mods, b, tNow, night);
    const cycle = spec.digS + spec.unloadS + 2 * trip.t;
    for (const [rid, rate] of Object.entries(r.outputs) as [ResourceId, number][]) {
      out.flow[rid] = (rate * spec.gain * spec.digS) / cycle;
    }
  }
  return out;
}

/** Why it stands idle, for the inspector (not saved: re-read each tick). */
const whyOf = new WeakMap<Hauler, string>();
function noteWhy(u: Hauler, why: string) { whyOf.set(u, why); }
export const unitWhy = (u: Hauler): string => whyOf.get(u) ?? '';

/** Where a unit goes next: pinned (Send…), else its hub's choice. */
function pickTarget(s: GameState, mods: Mods, site: SiteDef, u: Hauler, b: BuildingState): { t: Target; face: number } | { why: string } {
  if (u.pinned && u.target) {
    const t = targetOf(s, u.target);
    if (!t) { u.pinned = false; u.target = null; return chooseFor(s, mods, site, u, b); }
    // no road to it yet: its haul road is asked for (free rovers lay it); it waits in its bay
    if (!tripTo(s, mods, b, t).connected) {
      const why = askRoad(s, b, t);
      return { why: why || `WAITING FOR ITS HAUL ROAD — to ${t.name}` };
    }
    // every face working: it goes to wait at the gate (face −1)
    return { t, face: u.face >= 0 ? u.face : freeFace(s, t, u) };
  }
  return chooseFor(s, mods, site, u, b);
}

// ───────────────────────────── traffic (core/traffic.ts) ─────────────────────────────

/** Each cut pit's ramp as the units drive it: top on the rim, foot on the floor (one unit at a time). */
export function rampsOf(s: GameState): Ramp[] {
  const out: Ramp[] = [];
  for (const p of s.pits ?? []) {
    if (p.state === 'reclaimed' || p.state === 'new') continue;
    const rf = Math.max(0, p.R - PIT.bench * floorDepth(s, p));
    const a: Pt = [p.ox + p.ux * p.A, p.oz + p.uz * p.A], b: Pt = [p.cx + p.ux * rf, p.cz + p.uz * rf];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 3) continue;
    out.push({ pit: p.id, a, b });
  }
  return out;
}

/** Economy step 0: every unit's reservations planned, in priority order, before any moves. */
export function planTraffic(s: GameState) { trafficPlan(s, rampsOf(s)); }

// ───────────────────────────── the hub step (economy step 4.1) ─────────────────────────────

/** Regolith outside the hoppers plus in them: what resources.regolith shows. */
export function regolithHeld(s: GameState): number {
  let n = s.pile ?? 0;
  for (const b of s.buildings) if (b.hub && !isSite(b)) n += b.hub.hopper;
  return n;
}

/** Anything that changed resources.regolith since the last tick (grants,
 *  grading, research goods, a legacy pad's load) goes to or comes from the
 *  pile (then the hoppers, in hub order). */
export function reconcileRegolith(s: GameState) {
  const d = s.resources.regolith - regolithHeld(s);
  if (Math.abs(d) < 1e-9) return;
  if (d > 0) { s.pile = (s.pile ?? 0) + d; return; }
  let need = -d;
  const fromPile = Math.min(s.pile ?? 0, need);
  s.pile = (s.pile ?? 0) - fromPile;
  need -= fromPile;
  for (const b of s.buildings) {
    if (need <= 1e-12) break;
    if (!b.hub || isSite(b)) continue;
    const take = Math.min(b.hub.hopper, need);
    b.hub.hopper -= take;
    need -= take;
  }
}

/** resources.regolith = pile + Σ hoppers. */
export function writeRegolith(s: GameState) { s.resources.regolith = regolithHeld(s); }

/** Smelters and refineries draw the pile first (it is plain regolith; a water plant needs its own ice). */
const drawsPile = (b: BuildingState) => b.type === 'smelter' || b.type === 'refinery';

/** What a hub may draw this tick: the pile first (smelters and refineries), then its hopper. */
export const hubHave = (s: GameState, b: BuildingState): number =>
  (drawsPile(b) ? s.pile ?? 0 : 0) + (b.hub?.hopper ?? 0);

/** Draw `amt` for a hub: the pile first (smelters and refineries), then its own hopper. */
export function hubDraw(s: GameState, b: BuildingState, amt: number) {
  const fromPile = drawsPile(b) ? Math.min(s.pile ?? 0, amt) : 0;
  s.pile = (s.pile ?? 0) - fromPile;
  if (!b.hub) return;
  b.hub.hopper = Math.max(0, b.hub.hopper - (amt - fromPile));
  b.hub.drew = (b.hub.drew ?? 0) + amt;
}

/** Every complete hub gets its state, and its first unit rolls out (priced
 *  into the hub). Units whose hub went move to the nearest hub of its kind
 *  with a free bay; the rest are scrapped for half their price. */
export function ensureHubs(s: GameState, mods: Mods, site: SiteDef) {
  for (const b of s.buildings) {
    if (!isHubType(b.type) || isSite(b)) continue;
    if (!b.hub) b.hub = newHubState();
    provisionBonusBays(s, mods, b);
    if (!b.hub.seeded) {
      b.hub.seeded = true;
      if (unitsOf(s, b.id).length === 0) {
        const u = addUnit(s, b, site);
        alert(s, `${unitName(u.type).toUpperCase()} ${unitTag(u)} READY — ${hubName(b)} commissions with its first unit`, 'info', { select: b.id });
      }
    }
  }
  // a hub being replaced for its rad scars (docs/16 §4.14) keeps its units, bays and queue
  const alive = new Set(s.buildings.filter((b) => b.hub && (!isSite(b) || !!b.replace)).map((b) => b.id));
  for (const u of [...s.haulers]) {
    if (alive.has(u.hub)) continue;
    const old = s.buildings.find((b) => b.id === u.hub);
    const kind = old?.type;
    const [ux, uz] = [u.haul.x, u.haul.z];
    const next = s.buildings
      .filter((b) => b.hub && !isSite(b) && (kind ? b.type === kind : hubUnit(b.type, site) === u.type) &&
        unitsOf(s, b.id).length < bayCap(b, mods) && !bonusBayRefusal(s, mods, b, unitsOf(s, b.id).length))
      .sort((a, c) => Math.hypot(...sub(centerOf(a), [ux, uz])) - Math.hypot(...sub(centerOf(c), [ux, uz])) || a.id - c.id)[0];
    if (next) {
      u.hub = next.id;
      u.bay = freeBay(s, next);
      release(u);
      u.pinned = false;
      goBay(s, mods, u, next, 'new');
      continue;
    }
    const c = UNIT_DEFS[u.type].cost;
    s.resources.metals += Math.floor(c.metals * site.buildCostMult * 0.5);
    s.resources.parts += Math.floor(c.parts * site.buildCostMult * 0.5);
    s.haulers = s.haulers.filter((x) => x !== u);
    alert(s, `${unitName(u.type).toUpperCase()} ${unitTag(u)} SCRAPPED — its hub is gone and no other has a free bay; half its price back`, 'warn');
  }
}
const sub = (p: Pt, q: Pt): Pt => [p[0] - q[0], p[1] - q[1]];

/** Economy step 4.1's print half: each hub's head job pays, then prints at
 *  the share of its draw the grid served (`lit`). Returns the units that rolled out. */
export function printTick(s: GameState, mods: Mods, site: SiteDef, dt: number, lit: ReadonlySet<number>) {
  for (const b of hubsOf(s)) {
    provisionBonusBays(s, mods, b);
    const h = b.hub!;
    const j = h.queue[0];
    h.waiting = '';
    if (!j) continue;
    if (j.kind === 'unit') {
      const blocked = bonusBayRefusal(s, mods, b, unitsOf(s, b.id).length);
      if (blocked) { h.waiting = blocked; continue; }
    }
    if (!j.paid) {
      const cost = jobCost(b, j.kind, site, mods);
      const short = (Object.entries(cost) as [ResourceId, number][]).find(([rid, amt]) => s.resources[rid] < amt);
      if (short) {
        const [rid, amt] = short;
        h.waiting = `needs ${amt}${RESOURCES[rid].glyph} (have ${Math.floor(s.resources[rid])})`;
        condition(s, `print:${b.id}`, `PRINT WAITING — ${hubName(b)}'s ${j.kind === 'bay' ? 'bay' : unitName(hubUnit(b.type, site)).toLowerCase()} ${h.waiting}`,
          'info', { select: b.id });
        continue;
      }
      for (const [rid, amt] of Object.entries(cost) as [ResourceId, number][]) s.resources[rid] -= amt;
      recordSpend(s, cost);
      j.paid = cost;
      continue; // it draws from the next tick
    }
    if (!b.enabled || !lit.has(b.id)) continue; // shut down, or a brownout: it pauses
    j.t += dt;
    if (j.t < j.total - 1e-9) continue;
    if (j.kind === 'bay' && !nextBayCell(s, b, bayCells(s, b).length)) {
      h.waiting = 'BAY BLOCKED — clear the ground beside this hub; cancel to recover the paid materials';
      continue;
    }
    h.queue.shift();
    if (j.kind === 'reprint') {
      // the old unit is scrapped as the new one rolls out: same bay, capability 100%, wear 0 (docs/16 §4.14)
      const u = s.haulers.find((x) => x.id === j.unit);
      if (u) {
        delete u.cap; delete u.scars; delete u.capWarned; delete u.lastFlare;
        u.wear = 0;
        if (s.weather) s.weather.replaced = (s.weather.replaced ?? 0) + 1;
        alert(s, `RE-PRINTED — ${unitTag(u)} rolls out of ${hubName(b)} new: capability 100%`, 'info', { select: b.id });
      }
      continue;
    }
    if (j.kind === 'bay') {
      const c = nextBayCell(s, b, bayCells(s, b).length);
      if (c) { s.roads!.push({ gx: c[0], gz: c[1], left: 0, bay: true }); bumpRoads(s); }
      h.level = Math.min(3, h.level + 1) as 1 | 2 | 3;
      alert(s, `BAY ADDED — ${hubName(b)} is Level ${h.level === 2 ? 'II' : 'III'} · ${bayCap(b, mods)} bays`, 'info', { select: b.id });
      continue;
    }
    const u = addUnit(s, b, site);
    if (j.by === 'rule' || j.by === 'order') u.auto = { by: j.by, at: s.simTime };
    const pick = choicesFor(s, mods, site, b, unitsOf(s, b.id).length).find((c) => c.inReach && c.trip.connected);
    const where = pick ? ` — ${hubName(b)} sends it to ${pick.target.name} (trip ${fmtClock(pick.trip.t)})` : ` — ${hubName(b)}`;
    alert(s, `${unitName(u.type).toUpperCase()} ${unitTag(u)} READY${where}`, 'info', { select: b.id });
  }
}

/** A hub's starved share (EMA over HUB.starvedS): `idle` it stood for want of regolith, `ran` it ran. */
export function noteStarved(b: BuildingState, idle: boolean, dt: number) {
  const h = b.hub;
  if (!h) return;
  const k = Math.min(1, dt / HUB.starvedS);
  h.starved += ((idle ? 1 : 0) - h.starved) * k;
}

/** The base's feed (s.feed): the hubs' feeds, weighted by what each drew. */
export function meanFeed(s: GameState): FeedGrade | null {
  let w = 0;
  const g = emptyFeed();
  for (const b of hubsOf(s)) {
    const d = b.hub!.drew ?? 0;
    if (d <= 0) continue;
    w += d;
    for (const k of FEED_KINDS) g[k] += b.hub!.feed[k] * d;
  }
  if (w <= 0) return null;
  for (const k of FEED_KINDS) g[k] /= w;
  return g;
}

// ───────────────────────────── the player's verbs ─────────────────────────────

const unitById = (s: GameState, id: number) => s.haulers.find((u) => u.id === id);

/** Why no unit may be sent to or assigned a pit ('' = it may): reclaimed, being reclaimed, hemmed in. */
function pitClosed(s: GameState, key: string): string {
  const p = pitOf(s, key);
  if (!p) return '';
  if (p.state === 'reclaimed') return 'RECLAIMED — the ground builds again; its zone is closed';
  if (p.state === 'reclaiming') return 'RECLAIM UNDER WAY — its hub’s units are pushing the heap back in';
  if (p.state === 'boxed') return `BOXED IN — ${pitName(s, p)} can neither widen nor deepen`;
  return '';
}

/** Assign: the hub's auto units prefer this target while a face is free (null clears it). */
export function assignPit(s: GameState, mods: Mods, b: BuildingState | undefined, key: string | null): string {
  if (!b?.hub) return 'NOT A HUB';
  if (key === null) { delete b.hub.prefer; return ''; }
  const t = targetOf(s, key);
  if (!t) return 'NO SUCH PIT — pick a mapped deposit or a plain pit';
  const closed = pitClosed(s, key);
  if (closed) return closed;
  if (!t.plain && !HUB_DEFS[b.type]!.wants(SITES[s.siteId]).includes(t.kind!)) {
    return `NOT ITS GROUND — a ${BUILDINGS[b.type].name} wants ${HUB_DEFS[b.type]!.wants(SITES[s.siteId]).map((k) => DEPOSIT_INFO[k].name).join(' or ')}`;
  }
  const why = reachRefusal(s, mods, b, t, false);
  if (why) return why;
  b.hub.prefer = key;
  return '';
}

/** Open pit…: stake a plain pit at (x, z) for this hub; it becomes its plain pit. */
export function openPit(s: GameState, mods: Mods, b: BuildingState | undefined, x: number, z: number): string {
  if (!b?.hub) return 'NOT A HUB';
  const site = SITES[s.siteId];
  if (!HUB_DEFS[b.type]!.plain(site)) return 'NO ICE OUTSIDE THE SHADOWS — a water plant here digs cold traps only';
  const why = plainPitRefusal(s, mods, site, x, z);
  if (why) return why;
  const p = addPlainPit(s, x, z, b.id);
  b.hub.plainPit = p.id;
  // its haul road, for free rovers to lay (docs/17 §5.3)
  const t = targetOf(s, plainKey(p.id));
  if (t) askRoad(s, b, t);
  return '';
}

/** Send…: pin a unit to a target (up to twice its reach); it goes once it has tipped. */
export function sendUnit(s: GameState, mods: Mods, id: number, key: string): string {
  const u = unitById(s, id);
  const b = u ? hubOf(s, u) : undefined;
  if (!u || !b) return 'NO SUCH UNIT';
  const t = targetOf(s, key);
  if (!t) return 'NOT A PIT — click a mapped deposit or a plain pit';
  const closed = pitClosed(s, key);
  if (closed) return closed;
  const site = SITES[s.siteId];
  if (t.plain && !HUB_DEFS[b.type]!.plain(site)) return 'NO ICE OUTSIDE THE SHADOWS — its hub digs cold traps only';
  if ((t.kind === 'ice') !== (u.type === 'iceMiner')) {
    return u.type === 'iceMiner' ? 'AN ICE MINER DIGS COLD TRAPS — pick cold-trap ice' : 'ICE NEEDS AN ICE MINER — a Water Management Plant prints them';
  }
  const why = reachRefusal(s, mods, b, t, true);
  if (why) return why;
  const h = u.haul;
  u.pinned = true;
  if (u.target !== key) { u.target = key; u.face = -1; }
  delete u.parked;
  // no road reaches it yet: its haul road is asked for, and the unit waits in its bay
  if (!tripTo(s, mods, b, t).connected) {
    askRoad(s, b, t);
    if (h.phase !== 'park' && h.phase !== 'toDrop' && h.phase !== 'unload') {
      if ((h.cargo.regolith ?? 0) > 0) goTip(s, mods, u, b); else goBay(s, mods, u, b, undefined);
    }
    return '';
  }
  // a bucket under way is tipped first; in its bay or on the way out, it goes now
  if (h.phase === 'park' || h.phase === 'toBay' || h.phase === 'toDig' || (h.phase === 'dig' && !(h.cargo.regolith ?? 0))) {
    // every face working: it waits at the gate
    goDig(s, mods, u, t, freeFace(s, t, u));
  } else if (h.phase === 'dig') goTip(s, mods, u, b);
  return '';
}

/** Recall: home to its bay, to hold there. */
export function recallUnit(s: GameState, mods: Mods, id: number): string {
  const u = unitById(s, id);
  const b = u ? hubOf(s, u) : undefined;
  if (!u || !b) return 'NO SUCH UNIT';
  const h = u.haul;
  // a bucket with something in it is tipped on the way home
  if ((h.cargo.regolith ?? 0) > 0 && h.phase !== 'unload' && h.phase !== 'toDrop') { u.parked = 'recalled'; goTip(s, mods, u, b); u.parked = 'recalled'; return ''; }
  if (h.phase === 'toDrop' || h.phase === 'unload') { u.parked = 'recalled'; return ''; }
  goBay(s, mods, u, b, 'recalled');
  return '';
}

/** Dispatch: back to work from its bay. */
export function dispatchUnit(s: GameState, id: number): string {
  const u = unitById(s, id);
  if (!u) return 'NO SUCH UNIT';
  if (u.parked === 'recalled' || u.parked === 'noPit' || u.parked === 'new') delete u.parked;
  return '';
}

/** Auto: unpin a unit; its hub chooses for it again. */
export function autoUnit(s: GameState, id: number): string {
  const u = unitById(s, id);
  if (!u) return 'NO SUCH UNIT';
  u.pinned = false;
  return '';
}

/** Is a recalled unit to hold in its bay after tipping? (the unload path reads it) */
export const holding = (u: Hauler) => u.parked === 'recalled';

// ───────────────────────────── old saves (§19) ─────────────────────────────

/** The zone a world point lies in (a deposit's), as a target key. */
function depKeyAt(s: GameState, x: number, z: number): string | null {
  for (const zn of s.zones ?? []) {
    if (zn.kind === 'plain' || zn.kind === 'pit') continue;
    if (Math.hypot(x - zn.cx, z - zn.cz) <= zn.r) return depKey(zn.id);
  }
  return null;
}

/** A pad (an old excavator or ice harvester) becomes a unit of `b`, working
 *  the deposit it dug if its hub wants it; its wear goes with it. */
function padToUnit(s: GameState, site: SiteDef, pad: BuildingState, b: BuildingState): Hauler {
  const u = newUnit(s, b, site);
  u.wear = pad.wear ?? 0;
  // it starts where the pad stood, and drives to its bay
  const [px, pz] = centerOf(pad);
  u.haul.x = px; u.haul.z = pz;
  const dig = pad.haul ? depKeyAt(s, pad.haul.digX, pad.haul.digZ) : depKeyAt(s, px, pz);
  const t = targetOf(s, dig);
  if (t && (t.kind === 'ice') === (u.type === 'iceMiner') && HUB_DEFS[b.type]!.wants(site).includes(t.kind!)) {
    u.target = t.key;
    u.pinned = false;
  }
  if (pad.haul) {
    const p = pad.haul;
    if (p.charge !== undefined) u.haul.charge = p.charge;
  }
  s.haulers.push(u);
  s.haulers.sort((a, c) => a.id - c.id);
  return u;
}

/** The hub a pad joins: the nearest complete hub that prints its unit (by road from its pad, else straight). */
function hubForPad(s: GameState, site: SiteDef, pad: BuildingState): BuildingState | null {
  const want: UnitType = pad.type === 'iceHarvester' ? 'iceMiner' : 'excavator';
  const [px, pz] = centerOf(pad);
  const hubs = s.buildings.filter((b) => isHubType(b.type) && !isSite(b) && hubUnit(b.type, site) === want &&
    (want === 'iceMiner' || b.type !== 'waterPlant'));
  hubs.sort((a, c) => Math.hypot(...sub(centerOf(a), [px, pz])) - Math.hypot(...sub(centerOf(c), [px, pz])) || a.id - c.id);
  return hubs[0] ?? null;
}

/** Legacy pads join the first hub that completes (each a free unit; its pad
 *  goes, its flatten stays). Returns the pads removed. */
export function joinLegacy(s: GameState, mods: Mods, site: SiteDef): number[] {
  const pads = s.buildings.filter((b) => b.legacy && (b.type === 'excavator' || b.type === 'iceHarvester'));
  if (!pads.length) return [];
  const gone: number[] = [];
  const by = new Map<number, number>();
  for (const pad of pads) {
    const b = hubForPad(s, site, pad);
    if (!b) continue;
    if (!b.hub) b.hub = newHubState();
    b.hub.seeded = true;
    padToUnit(s, site, pad, b);
    by.set(b.id, (by.get(b.id) ?? 0) + 1);
    gone.push(pad.id);
  }
  if (!gone.length) return [];
  s.buildings = s.buildings.filter((b) => !gone.includes(b.id));
  const who = [...by].map(([id, n]) => `${n} to ${hubName(s.buildings.find((b) => b.id === id)!)}`).join(', ');
  alert(s, `LEGACY PADS JOIN THEIR HUB — ${who}: its hub docks, charges and sends them now`, 'info');
  void mods;
  return gone;
}

/** An old save (hubSchema unset, docs/17 §19): hubs get their state; old
 *  regolith fills the hoppers, the rest is the pile; excavators become units
 *  of the nearest hub (over its bays if need be), else stay legacy pads; ice
 *  harvesters stay legacy until a water plant stands. Nothing is carved. */
export function migrateHubs(s: GameState, mods: Mods, site: SiteDef) {
  if ((s.hubSchema ?? 0) >= 1) return;
  const hubs = s.buildings.filter((b) => isHubType(b.type) && !isSite(b));
  let stock = s.resources.regolith;
  for (const b of hubs) {
    b.hub = newHubState();
    b.hub.feed = { ...emptyFeed(), ...s.feed };
    const add = Math.min(stock, hopperCap(b));
    b.hub.hopper = add;
    stock -= add;
  }
  s.pile = Math.max(0, stock);
  // an excavator still being built was never going to be one: refunded in full
  const sites = s.buildings.filter((b) => (b.type === 'excavator' || b.type === 'iceHarvester') && isSite(b));
  for (const b of sites) {
    for (const [rid, amt] of Object.entries(BUILDINGS[b.type].buildCost)) s.resources[rid as ResourceId] += Math.ceil((amt ?? 0) * site.buildCostMult);
  }
  s.buildings = s.buildings.filter((b) => !sites.includes(b));
  const pads = s.buildings.filter((b) => b.type === 'excavator' || b.type === 'iceHarvester');
  for (const b of pads) b.legacy = true;
  const moved = pads.filter((b) => b.type === 'excavator' && hubForPad(s, site, b)).length;
  const gone = joinLegacy(s, mods, site);
  // a hub no unit joined commissions with its own
  for (const b of hubs) if (b.hub && !unitsOf(s, b.id).length) b.hub.seeded = false; else if (b.hub) b.hub.seeded = true;
  s.hubSchema = 1;
  writeRegolith(s);
  const left = s.buildings.filter((b) => b.legacy && b.type === 'excavator').length;
  if (moved || left) {
    alert(s, `EXTRACTION HUBS — ${moved ? `your ${moved} excavator${moved === 1 ? '' : 's'} now belong to their nearest hub` : 'no hub stands yet'}` +
      `${left ? ` · ${left} legacy pad${left === 1 ? '' : 's'} dig on until a Regolith Smelter stands` : ''} · hubs print their own units now`, 'info');
  }
  void gone;
}

// ───────────────────────────── pits run out (docs/17 §10.2; Phase 4) ─────────────────────────────

/** The first research not yet done that cuts bedrock benches, and how deep (for the words). */
export function bedrockTech(s: GameState): { name: string; m: number } | null {
  const ids = TECH_ORDER.filter((id) => !s.techsDone.includes(id) && TECHS[id].effects.some((fx) => fx.kind === 'pitDepth'));
  ids.sort((a, b) => TECHS[a].era - TECHS[b].era);
  const t = ids[0] ? TECHS[ids[0]] : null;
  if (!t) return null;
  const fx = t.effects.find((e) => e.kind === 'pitDepth');
  return { name: t.name, m: fx && fx.kind === 'pitDepth' ? fx.benches * PIT.bench : PIT.bench };
}

/** What hems a pit in, for the words: the structures and roads beside its rim. */
function hemmers(s: GameState, p: PitState): string {
  const near: { name: string; d: number }[] = [];
  for (const b of s.buildings) {
    const r = worldRect(b);
    const dx = Math.max(r.x0 - p.cx, 0, p.cx - r.x1), dz = Math.max(r.z0 - p.cz, 0, p.cz - r.z1);
    const d = Math.hypot(dx, dz) - p.R;
    if (d > 16) continue;
    near.push({ name: b.type === 'lander' ? 'the Lander’s apron' : `${BUILDINGS[b.type].name} #${b.id}`, d });
  }
  near.sort((a, b) => a.d - b.d || (a.name < b.name ? -1 : 1));
  const names = near.slice(0, 2).map((n) => n.name);
  const road = (s.roads ?? []).some((c) => { const [x, z] = cellCentre(c.gx, c.gz); return Math.hypot(x - p.cx, z - p.cz) - p.R < 12; });
  if (road) names.push('a road');
  return names.length ? names.join(names.length > 2 ? ', ' : ' and ').replace(/, ([^,]*)$/, ' and $1') : 'the ground round it';
}

/** The pits' news since the last tick (core/pits.ts sets it): units off a
 *  dug-out or hemmed-in pit choose again, and the alerts say why (§10.2). */
export function pitNews(s: GameState, mods: Mods, site: SiteDef) {
  for (const p of s.pits ?? []) {
    const news = p.news;
    if (!news?.length) continue;
    delete p.news;
    const name = pitName(s, p);
    const dep = p.key.startsWith('dep:') ? p.key.slice(4) : null;
    const surveyed = !!(dep && s.oreSurvey?.done[dep]);
    const act = dep ? { deposit: dep } : undefined;
    for (const n of news) {
      if (n === 'running') {
        const units = s.haulers.filter((u) => u.target === p.key).length;
        alert(s, `DEPOSIT RUNNING OUT — ${name}: ~1 lunar day of ore left at ${units} unit${units === 1 ? '' : 's'} · survey the next one [I]`, 'warn', act);
        continue;
      }
      if (n === 'rock') {
        const left = dep ? pitOreLeft(s, p) : null;
        const more = left ? `~${kilo(left)}▲ of ore in bedrock` : 'its bedrock';
        const by = TECH_ORDER.filter((id) => s.techsDone.includes(id) && TECHS[id].effects.some((fx) => fx.kind === 'pitDepth'))
          .map((id) => TECHS[id].name).join(' and ');
        alert(s, `DEEPER BENCHES — ${name} reopens: ${more} at ×${GRADE.bedrockDig} dig${by ? ` (${by})` : ''}`, 'info', act);
        continue;
      }
      if (n === 'reclaimed') {
        alert(s, `PIT RECLAIMED — ${name}: its heap is back in the ground, and it builds again`, 'info', act);
        continue;
      }
      // exhausted, boxed in, its bedrock cut: its units move on
      const on = s.haulers.filter((u) => u.target === p.key);
      const hubs = [...new Set(on.map((u) => u.hub))];
      releasePit(s, p.key);
      const moves = hubs.map((id) => {
        const b = s.buildings.find((x) => x.id === id);
        if (!b?.hub) return '';
        const k = on.filter((u) => u.hub === id).length;
        const unit = unitName(hubUnit(b.type, site)).toLowerCase();
        const who = `${hubName(b)}'s ${k > 1 ? `${k} ${unit}s` : unit}`;
        const next = choicesFor(s, mods, site, b, k).find((c) => c.inReach && c.trip.connected && c.free > 0);
        if (!next) return `${who} ${k > 1 ? 'park' : 'parks'}: nothing else in reach`;
        if (next.target.key === p.key || (next.target.plain && next.q < b.hub.q * 0.9)) {
          return `${who}: nothing richer in reach — ${k > 1 ? 'they dig' : 'it digs'} on at plain grade (q ${next.q.toFixed(2)})`;
        }
        return `${who} go${k > 1 ? '' : 'es'} to ${next.target.name} (${fmtClock(next.trip.t)}) · feed q ${b.hub.q.toFixed(2)} → ${next.q.toFixed(2)}`;
      }).filter(Boolean);
      const tail = moves.length ? ` · ${moves.join(' · ')}` : '';
      const sel = hubs.length ? { select: hubs[0] } : act;
      if (n === 'exhausted') {
        const never = surveyed ? '' : ' (never surveyed — a survey would have warned you a lunar day ahead)';
        // a pit hemmed off its rich centre runs lean with ore still in the ground: say so
        const R = dep ? reservesOf(s, mods, dep) : null;
        const stays = R?.truth ? Math.max(0, R.truth.ore - R.dug) : 0;
        const why = R?.truth && stays > R.truth.ore * 0.25
          ? `'s pit has cut into lean ground: ~${kilo(stays)}▲ of its ore stays in the ground, hemmed in by ${hemmers(s, p)}`
          : `'s ore is dug out`;
        alert(s, `DEPOSIT EXHAUSTED — ${name}${why}${tail}${never}`, 'warn', sel);
      } else if (n === 'boxed') {
        const left = pitOreLeft(s, p);
        const t = bedrockTech(s);
        const ore = left && left > 50 ? `; ${kilo(left)}▲ of ore stays in the ground` : '';
        const deeper = t ? ` · ${t.name} digs ${t.m} m below it` : '';
        alert(s, `PIT BOXED IN — ${name} is hemmed in by ${hemmers(s, p)}${ore}${deeper}${tail}`, 'warn', sel);
      } else if (n === 'rockDone') {
        alert(s, `BEDROCK BENCHES CUT — ${name} is dug to ${p.deep.toFixed(1)} m${tail}`, 'info', sel);
      }
    }
  }
}
const kilo = (t: number) => (t >= 1000 ? `${(t / 1000).toFixed(1)}k` : `${Math.round(t)}`);
