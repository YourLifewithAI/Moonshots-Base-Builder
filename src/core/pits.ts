/** Strip-mine pits (docs/17 §8, §11; Phase 3): every place that is dug becomes
 *  a pit, and the ground deforms as it grows.
 *
 *  - **Who digs.** Hub units (docs/17 Phases 1–2): core/hubs.ts's `dug` is
 *    the one place a dig happens, and calls `digInto(s, pitFor(s, key),
 *    tonnes, q)` with its target's key — a deposit's (`dep:<id>`, shared by
 *    every unit on it) or a staked plain pit's (`plain:<id>`). `onDig` with a
 *    dig site's key is kept for the debug `pitDig` (the tests' shortcut).
 *    Once a pit is cut its units drive in by its zone and down its ramp to
 *    faces on its floor (core/hubs.ts `wayIn`, `facePoint`).
 *  - **The volume.** ▲ is a tonne; the hole is ▲ ÷ 1.5 m³ whatever the grade
 *    (§9.2: the grade sets how much product a tonne makes, so a lean cut digs
 *    more hole per product, not per tonne). Today's grade of the load (the
 *    feed factor its kind gives, the stand-in for q) is kept per pit as an
 *    amount-weighted EMA for Phase 4. The heap takes 70% of the mass back at
 *    1.3 t/m³: 0.81 × the pit's volume.
 *  - **Where.** A pit opens at the nearest free ground to its key's point
 *    (§8.6): a deposit's heart, a plain pit's stake, a dig cell. The nearest
 *    ground with room to open to its floor, on its deposit if it has one,
 *    away from the Lander.
 *  - **Step 4.2** (economy): in batches — a pit carves at most every 5 game-s,
 *    once its rim would move 0.5 m or 150 m³ is owed — in id order, on the
 *    pits' own tick clock, in integer decimetres (terrain/pitCarve.ts). A pit
 *    only grows over ground joined to its own cut, never across a road or a
 *    structure's setback.
 *  - **Grow away, never toward** (the player's rule, docs/17 §8.1): nothing
 *    is dug within 12 m of a structure's walls (its pad, the two-sample skirt
 *    and a 4 m margin) or 8 m of a road, door, bay or the Lander's apron;
 *    blocked sides push the pit's centre the other way; heaps go on the side
 *    away from structures and roads; a building placed later is respected from
 *    the next carve on; no pad's footing ever changes.
 *
 *  The heightfield is bound per state (`bindTerrain`, by Game.bootWorld): the
 *  economy tick has no terrain of its own. Pure otherwise: no Three.js, no
 *  randomness beyond the seeded loose layer and stake jitter. */
import { CELL_M, CYCLE_S, FEED, HAUL, MAP_CELLS, MAP_M, PIT } from '../data/balance';
import { FIELD_TYPES } from '../data/roads';
import { DEPOSIT_INFO, type FeedKind } from '../data/deposits';
import { DEP_SURVEY, GRADE, RECLAIM, STRIP } from '../data/ore';
import type { SiteDef } from '../data/sites';
import type { GameState, PitState, ZoneState } from './state';
import type { Deposit, Heightfield } from '../terrain/heightfield';
import {
  carvePit, decodeDelta, dumpHeap, encodeDelta, fillPit, heapRadius, lowerHeap, ownSamples, pitCells, pitRadius, stakeHeap, stakePit,
  type Blockers, type HeapShape, type PitShape,
} from '../terrain/pitCarve';
import {
  bedrockOre, cutGrade, cutoffQ, estimateOf, facesFor, gradeMult, looseRange, measureText, oreTruth, plainQ, processOf, profileOf,
  type OreEstimate, type OreTruth,
} from './ore';
import type { Mods } from './mods';
import { footprintRect } from '../buildings/instances';
import { bumpRoads, cellAt, cellCentre, cellKey, doorCell } from './roads';
import { mulberry32 } from './rng';
import { alert } from './economy';
import { depositRevealed, networkRadius } from './exploration';

const N = MAP_CELLS + 1;
/** the heap's volume per m³ of pit: 70% of the mass, stacked loose */
export const HEAP_PER_PIT = (PIT.tailings * PIT.tPerM3) / PIT.heapTPerM3;
/** a boxed-in or unstakeable pit looks again this often (terrain-clock seconds) */
const RETRY_S = 60;

// ───────────────────────────── the terrain binding ─────────────────────────────

const terrains = new WeakMap<GameState, Heightfield>();

/** The heightfield this state's pits carve (Game.bootWorld binds it). */
export function bindTerrain(s: GameState, hf: Heightfield) { terrains.set(s, hf); }
export const terrainOf = (s: GameState): Heightfield | undefined => terrains.get(s);

// ───────────────────────────── the adapter (today's hauling) ─────────────────────────────

/** A dig site's key: the cell a digger stands on while it digs. */
export function digSiteKey(x: number, z: number): string {
  const [gx, gz] = cellAt(x, z);
  return `dig:${gx},${gz}`;
}

/** Today's grade of a load (the stand-in for q, §9.1): the feed factor its
 *  ground gives the processor that wants it — high-Ti basalt and KREEP at the
 *  smelter, anorthosite at the refinery; plain ground, glass and soil 1. */
export function digGrade(kind: FeedKind): number {
  if (kind === 'ilmenite') return 1 + FEED.smelter.ilmenite;
  if (kind === 'anorthosite') return 1 + FEED.refinery.anorthosite;
  if (kind === 'kreep') return 1 + FEED.smelter.kreep;
  return 1;
}

/** `tonnes` of regolith dug at a dig site: into its pit (opened when first dug).
 *  Every digger on one deposit shares that deposit's pit (`dep:<id>`); on plain
 *  ground each dig site is its own pit. (The debug `pitDig` calls it; hub units
 *  dig their target's pit directly: `pitFor` and `digInto`, core/hubs.ts.) */
export function onDig(s: GameState, siteKey: string, tonnes: number, q: number) {
  if (!(tonnes > 0)) return;
  const hf = terrains.get(s);
  if (hf) siteKey = pitKeyOf(hf, siteKey);
  digInto(s, pitFor(s, siteKey), tonnes, q);
}

/** The pit a site key names, opened if it has none yet: a deposit's
 *  (`dep:<id>`), a staked plain pit's (`plain:<id>`, docs/17 §8.6), a dig cell's. */
export function pitFor(s: GameState, key: string): PitState {
  s.pits ??= [];
  for (let i = s.pits.length - 1; i >= 0; i--) if (s.pits[i].key === key) return s.pits[i];
  return newPit(s, key);
}

/** The open pit a site key names (null: none dug there yet, or not staked). */
export function pitOf(s: GameState, key: string): PitState | null {
  for (const p of s.pits ?? []) if (p.key === key && p.state !== 'new' && p.anchor >= 0) return p;
  return null;
}

/** The growth itself (Phase 2 calls this for a hub unit's pit). A deposit's
 *  pit tallies its ore while its cut is above the cutoff, and on bedrock. */
export function digInto(_s: GameState, p: PitState, tonnes: number, q: number) {
  if (p.state === 'reclaiming' || p.state === 'reclaimed') return;
  const a = tonnes / (tonnes + HAUL.feedMemory);
  p.q = p.tonnes > 0 ? p.q + (q - p.q) * a : q;
  p.tonnes += tonnes;
  p.dugM3 += tonnes / PIT.tPerM3;
  if (p.key.startsWith('dep:') && (!p.spent || p.rockR !== undefined)) p.ore = (p.ore ?? 0) + tonnes;
}

function newPit(s: GameState, key: string): PitState {
  s.nextPitId ??= 1;
  const p: PitState = {
    id: s.nextPitId++, key, deposit: null, state: 'new',
    cx: 0, cz: 0, ox: 0, oz: 0, ux: 1, uz: 0, A: 0, R: 0,
    tonnes: 0, dugM3: 0, cutM3: 0, heapM3: 0, q: 1, deep: 0, anchor: -1, heap: null,
    box: [N, N, -1, -1], at: -1e9,
  };
  s.pits.push(p);
  return p;
}

/** A dig site's pit key: its deposit's (`dep:<id>`), else its own cell's. Memoised per heightfield. */
const keyMemo = new WeakMap<Heightfield, Map<string, string>>();
function pitKeyOf(hf: Heightfield, siteKey: string): string {
  if (!siteKey.startsWith('dig:')) return siteKey;
  let m = keyMemo.get(hf);
  if (!m) { m = new Map(); keyMemo.set(hf, m); }
  let k = m.get(siteKey);
  if (k === undefined) {
    const [x, z] = keyPoint(null, siteKey);
    const d = hf.depositAt(x, z);
    k = d && d.kind !== 'ridge' ? `dep:${d.id}` : siteKey;
    m.set(siteKey, k);
  }
  return k;
}

/** The point a key names: a dig cell's centre, a deposit's centre, or a
 *  staked plain pit's point (the hubs' plain pits, docs/17 §8.6). */
function keyPoint(hf: Heightfield | null | undefined, key: string, s?: Pick<GameState, 'plainPits'>): [number, number] {
  if (key.startsWith('dep:')) {
    const d = hf?.deposits.find((x) => x.id === key.slice(4));
    if (d) return [d.cx, d.cz];
  }
  if (key.startsWith('plain:')) {
    const p = s?.plainPits?.find((x) => x.id === Number(key.slice(6)));
    if (p) return [p.x, p.z];
  }
  const [gx, gz] = key.slice(4).split(',').map(Number);
  return cellCentre(gx, gz);
}

// ───────────────────────────── derived, never stored ─────────────────────────────

/** The loose layer a pit widens at (§8.5), m: a deposit's from (seed, deposit
 *  id) — the survey reads it before a pit is dug (core/ore.ts) — a plain pit's
 *  seeded from (seed, pit id) within its ground's range. */
export function looseLayer(s: Pick<GameState, 'seed' | 'siteId'>, p: Pick<PitState, 'id' | 'deposit'>): number {
  if (p.deposit) {
    const d = terrains.get(s as GameState)?.deposits.find((x) => x.id === p.deposit);
    if (d) return profileOf(s, d).L;
  }
  const range = looseRange(p.deposit?.split('-')[0] as Deposit['kind'] | undefined, s.siteId);
  const rng = mulberry32((s.seed ^ 0x9175ea ^ Math.imul(p.id, 0x9e3779b1)) >>> 0);
  return Math.round((range[0] + rng() * (range[1] - range[0])) * 10) / 10;
}

/** The floor's depth below the ground now, m: the loose layer, and any bedrock benches cut or being cut. */
export function floorDepth(s: Pick<GameState, 'seed' | 'siteId'>, p: PitState): number {
  return looseLayer(s, p) + (p.rockR !== undefined ? p.rockTo ?? 0 : p.rock ?? 0);
}

/** The deposit a pit is dug into (undefined: plain ground). */
export function depositOf(s: GameState, p: Pick<PitState, 'deposit'>): Deposit | undefined {
  return p.deposit ? terrains.get(s)?.deposits.find((d) => d.id === p.deposit) : undefined;
}

/** The ring a pit is planned to reach (three lunar days of digging, §8.4; a deposit's ring ×1.3). */
function planRadius(hf: Heightfield, p: PitState, L: number): number {
  const d = p.deposit ? hf.deposits.find((x) => x.id === p.deposit) : undefined;
  return Math.max(pitRadius(PIT.planM3, L), d ? d.r * 1.3 : 0);
}
const heapPlanR = () => heapRadius(PIT.planM3 * HEAP_PER_PIT);

// ───────────────────────────── what stands in the way ─────────────────────────────

/** Every structure's footprint, and every road cell, door and bay (the masks' input). */
export function blockersOf(s: GameState): Blockers {
  const pads = s.buildings.map((b) => { const r = footprintRect(b); return { gx0: r.gx0, gz0: r.gz0, gx1: r.gx1, gz1: r.gz1 }; });
  const cells: number[] = [];
  for (const c of s.roads ?? []) cells.push(cellKey(c.gx, c.gz));
  for (const b of s.buildings) {
    if (FIELD_TYPES.has(b.type)) continue;
    const d = doorCell(b);
    if (d) cells.push(cellKey(d[0], d[1]));
  }
  return { pads, cells };
}

function shapeOf(s: GameState, p: PitState): PitShape {
  const L = looseLayer(s, p) + (p.rockR !== undefined ? p.rockTo ?? 0 : 0);
  return { cx: p.cx, cz: p.cz, L, ox: p.ox, oz: p.oz, ux: p.ux, uz: p.uz, A: p.A, R: p.R, anchor: p.anchor };
}

// ───────────────────────────── step 4.2 ─────────────────────────────

/** Economy step 4.2: stake new pits, carve what was dug, dump the spoil; the
 *  pit zones follow. Then Phase 4's states (§10.2): a deposit's pit whose cut
 *  has fallen to the cutoff is EXHAUSTED, one that can neither widen nor
 *  deepen is BOXED IN, either reopens for bedrock benches once research
 *  allows (§8.5), and Reclaim fills a pit back (§12.2). The hubs read what
 *  happened (`news`, core/hubs.ts pitNews). Deterministic: pits in id order
 *  on the terrain clock. */
export function pitsStep(s: GameState, dt: number, mods?: Pick<Mods, 'pitBedrockBenches'>) {
  const hf = terrains.get(s);
  if (!hf || !s.pits?.length) return;
  s.terrain ??= { rev: 0, clock: 0, delta: '' };
  const clock = (s.terrain.clock += dt);
  const rock = (mods?.pitBedrockBenches ?? 0) * PIT.bench;
  let bl: Blockers | null = null;
  const carved = new Set<number>();
  for (const p of s.pits) {
    rateStep(p, dt);
    // bedrock benches (§8.5, §10.3): a dug-out or hemmed-in pit reopens to deepen
    if ((p.state === 'boxed' || p.state === 'exhausted') && p.anchor >= 0 && p.rockR === undefined && rock > (p.rock ?? 0) + 1e-9) {
      openRock(p, rock);
    }
    if (p.state === 'reclaiming') {
      if (clock - p.at < PIT.everyS - 1e-9) continue;
      p.at = clock;
      if (reclaimStep(s, hf, p)) carved.add(p.id);
      continue;
    }
    if (p.state !== 'new' && p.state !== 'open' && p.state !== 'boxed' && p.state !== 'exhausted') continue;
    const wait = p.state === 'boxed' ? RETRY_S : PIT.everyS;
    if (clock - p.at < wait - 1e-9) continue;
    const owe = p.dugM3 - p.cutM3;
    if (p.state === 'new') {
      if (p.dugM3 < PIT.firstM3) continue;
      p.at = clock;
      bl ??= blockersOf(s);
      if (!stake(s, hf, p, bl)) continue;
    } else if (p.state === 'boxed' && owe < 20) {
      // hemmed in, with nothing owed: does it have room again (a structure demolished)?
      p.at = clock;
      bl ??= blockersOf(s);
      const sh = shapeOf(s, p);
      const r = carvePit(hf, sh, bl, 20, 0, p.rockR, true);
      if (r.added >= 0.5) { p.state = p.spent ? 'exhausted' : 'open'; p.free = r.free ?? p.free; delete p.endedAt; }
      continue;
    } else {
      const L = shapeOf(s, p).L;
      const move = p.rockR !== undefined ? 0 : pitRadius(p.dugM3, L) - pitRadius(p.cutM3, L);
      if (owe < 20 || (move < PIT.rimMoveM && owe < PIT.batchM3)) continue;
      p.at = clock;
    }
    bl ??= blockersOf(s);
    if (carve(s, hf, p, bl, owe)) carved.add(p.id);
    exhaustCheck(s, p);
    runningOut(s, p);
  }
  if (!carved.size) return;
  s.terrain.rev++;
  syncPitZones(s, hf, carved);
}

/** The pit's dig rate, ▲/s: an EMA over two minutes (life, the running-out warning). */
function rateStep(p: PitState, dt: number) {
  if (!(dt > 0)) return;
  const seen = p.seenT ?? p.tonnes;
  const now = (p.tonnes - seen) / dt;
  const k = Math.min(1, dt / 120);
  p.rate = (p.rate ?? 0) + (now - (p.rate ?? 0)) * k;
  p.seenT = p.tonnes;
}

/** Bedrock benches open (§10.3): the rim is held, the floor goes `depth` m below the loose layer. */
function openRock(p: PitState, depth: number) {
  p.rockFrom = p.state === 'exhausted' ? 'exhausted' : 'boxed';
  p.rockR = Math.max(1, p.R);
  p.rockTo = depth;
  p.oreRock = p.ore ?? 0;
  p.state = 'open';
  delete p.endedAt;
  (p.news ??= []).push('rock');
}

/** A deposit's pit is dug out (§10.2) when the grade of its cut has fallen to the cutoff. */
function exhaustCheck(s: GameState, p: PitState) {
  if (p.spent || p.rockR !== undefined || !p.key.startsWith('dep:') || p.anchor < 0) return;
  const d = depositOf(s, p);
  if (!d) return;
  const prof = profileOf(s, d);
  const cut = cutoffQ(prof, s.siteId);
  if (cut === null || !prof.process) return;
  const g = cutGrade(prof, prof.process, s.siteId, { cx: p.cx, cz: p.cz, R: p.R, L: prof.L });
  if (g > cut + 1e-9) return;
  p.spent = true;
  p.endedAt = s.simTime;
  if (p.state === 'open') p.state = 'exhausted';
  (p.news ??= []).push('exhausted');
}

/** A surveyed deposit's pit with a lunar day of ore left at its dig says so, once. */
function runningOut(s: GameState, p: PitState) {
  if (p.warned || p.spent || !p.deposit || !s.oreSurvey?.done[p.deposit] || !((p.rate ?? 0) > 0.05)) return;
  const left = pitOreLeft(s, p);
  if (left === null || left / p.rate! > CYCLE_S) return;
  p.warned = true;
  (p.news ??= []).push('running');
}

/** ▲ of ore still in a deposit pit's ground (the truth; null: a plain pit or no ore bed). */
export function pitOreLeft(s: GameState, p: PitState): number | null {
  const d = depositOf(s, p);
  const t = d ? oreTruth(s, d) : null;
  if (!d || !t) return null;
  if (p.rockR !== undefined) {
    const held = bedrockOre(p.rockR, profileOf(s, d).L + (p.rock ?? 0), (p.rockTo ?? 0) - (p.rock ?? 0));
    return Math.max(0, held - ((p.ore ?? 0) - (p.oreRock ?? 0)));
  }
  return p.spent ? 0 : Math.max(0, t.ore - (p.ore ?? 0));
}

/** Open a pit: its ground (the dig's deposit), centre, ramp and heap. */
function stake(s: GameState, hf: Heightfield, p: PitState, bl: Blockers): boolean {
  const [x, z] = keyPoint(hf, p.key, s);
  p.deposit = p.key.startsWith('dep:') ? p.key.slice(4) : p.key.startsWith('plain:') ? null : hf.depositAt(x, z)?.id ?? null;
  const L = looseLayer(s, p);
  const planR = planRadius(hf, p, L);
  // other pits' and heaps' planned ground is taken
  const discs: { x: number; z: number; r: number }[] = [];
  for (const o of s.pits) {
    if (o === p || o.state === 'new') continue;
    discs.push({ x: o.cx, z: o.cz, r: Math.max(o.R, planRadius(hf, o, looseLayer(s, o))) + CELL_M });
    if (o.heap) discs.push({ x: o.heap.x, z: o.heap.z, r: Math.max(o.heap.Rh, heapPlanR()) + CELL_M });
  }
  const lander = s.buildings.find((b) => b.type === 'lander');
  const away = lander ? (() => { const r = footprintRect(lander); return { x: ((r.gx0 + r.gx1) / 2) * CELL_M - MAP_M / 2, z: ((r.gz0 + r.gz1) / 2) * CELL_M - MAP_M / 2 }; })() : null;
  const dep = p.deposit ? hf.deposits.find((d) => d.id === p.deposit) : undefined;
  const onDep = dep ? (px: number, pz: number) => Math.hypot(px - dep.cx, pz - dep.cz) <= dep.r : null;
  const at = stakePit(hf, { ...bl, discs }, x, z, L, planR, away, onDep);
  if (!at) return false;
  // off the sample grid by a seeded sub-metre step: no ring of samples ties
  const rng = mulberry32((s.seed ^ 0x57a4e ^ Math.imul(p.id, 0x85ebca6b)) >>> 0);
  const cx = at.x + (rng() - 0.5) * 1.6, cz = at.z + (rng() - 0.5) * 1.6;
  p.cx = p.ox = cx;
  p.cz = p.oz = cz;
  // the ramp faces its diggers (the dig site, or the deposit's heart where their
  // pads stand); a pit opened right there faces the Lander
  let gx = x - cx, gz = z - cz;
  if (Math.hypot(gx, gz) < 1 && away) { gx = away.x - cx; gz = away.z - cz; }
  const gl = Math.hypot(gx, gz);
  p.ux = gl > 1e-6 ? gx / gl : 1;
  p.uz = gl > 1e-6 ? gz / gl : 0;
  p.A = 0;
  const h = stakeHeap(hf, { ...bl, discs }, { x: cx, z: cz, gateX: p.ux, gateZ: p.uz }, planR, heapPlanR());
  p.heap = { x: h.x, z: h.z, Rh: 0, anchor: -1 };
  p.state = 'open';
  return true;
}

/** Carve what a pit is owed and dump its spoil. True: the grid changed. A
 *  carve that cuts nothing with a batch owed (or no free rim left) boxes the
 *  pit in; one that cuts nothing on bedrock has cut its benches. */
function carve(s: GameState, hf: Heightfield, p: PitState, bl: Blockers, owe: number): boolean {
  const sh = shapeOf(s, p);
  const rock = p.rockR !== undefined;
  const dR = rock ? 0 : Math.max(0, pitRadius(p.dugM3, sh.L) - pitRadius(p.cutM3, sh.L));
  const r = carvePit(hf, sh, bl, p.dugM3 - p.cutM3, dR, p.rockR);
  let changed = false;
  if (r.changed) {
    changed = true;
    p.cx = sh.cx; p.cz = sh.cz; p.R = sh.R; p.A = sh.A; p.anchor = sh.anchor;
    p.cutM3 += r.added;
    p.deep = Math.max(p.deep, r.extreme);
    grow(p.box, r);
  }
  if (!rock && r.free !== undefined) p.free = Math.round(r.free * 1000) / 1000;
  const stuck = r.added < 0.5 && (owe >= PIT.batchM3 || (r.free ?? 1) <= 1e-9);
  if (rock) {
    if (stuck || r.added < 0.5) {
      // its bedrock benches are cut: back to what it was
      p.rock = p.rockTo;
      p.state = p.rockFrom ?? 'boxed';
      delete p.rockR; delete p.rockTo; delete p.rockFrom;
      p.endedAt = s.simTime;
      (p.news ??= []).push('rockDone');
    } else p.state = 'open';
  } else if (stuck) {
    if (p.state !== 'boxed') { p.endedAt = s.simTime; (p.news ??= []).push('boxed'); }
    p.state = 'boxed';
  } else if (r.added >= 0.5) p.state = p.spent ? 'exhausted' : 'open';
  if (p.cutM3 > 0) p.scar = countOwn(hf, p) * CELL_M * CELL_M;
  if (p.heap) {
    const owe = p.cutM3 * HEAP_PER_PIT - p.heapM3;
    if (owe >= 8) {
      const hs: HeapShape = { hx: p.heap.x, hz: p.heap.z, Rh: p.heap.Rh, anchor: p.heap.anchor };
      const d = dumpHeap(hf, hs, bl, owe);
      if (d.changed) {
        changed = true;
        p.heap.Rh = hs.Rh; p.heap.anchor = hs.anchor;
        p.heapM3 += d.added;
        grow(p.box, d);
      }
    }
  }
  return changed;
}

function grow(box: PitState['box'], r: { ix0: number; iz0: number; ix1: number; iz1: number }) {
  box[0] = Math.min(box[0], r.ix0); box[1] = Math.min(box[1], r.iz0);
  box[2] = Math.max(box[2], r.ix1); box[3] = Math.max(box[3], r.iz1);
}

// ───────────────────────────── zones ─────────────────────────────

/** A pit's zone (§11.2): its cut and a cell round it, as explicit cells — never
 *  a road cell or a footprint. Zones are kept after the deposits' (so a
 *  deposit's zone keeps its cells, and its gates). A zone that grew bumps the
 *  network's revision (gates and routes are cached on it). `only`: just
 *  these pits' zones are recomputed; `bump` false on a load. */
export function syncPitZones(s: GameState, hf: Heightfield, only?: ReadonlySet<number>, bump = true) {
  const all = s.zones ?? [];
  const keep = all.filter((z) => z.kind !== 'pit');
  const old = new Map(all.filter((z) => z.kind === 'pit').map((z) => [z.id, z]));
  let occ: Set<number> | null = null;
  let roads: Set<number> | null = null;
  const next: ZoneState[] = [];
  let changed = false;
  for (const p of s.pits ?? []) {
    // a reclaimed pit's zone closes (§12.2); its deposit, if any, stays mapped
    if (p.anchor < 0 || p.state === 'reclaimed') continue;
    const id = `pit-${p.id}`;
    const prev = old.get(id);
    if (prev && only && !only.has(p.id)) { next.push(prev); continue; }
    if (!occ) {
      occ = new Set();
      for (const b of s.buildings) {
        const r = footprintRect(b);
        for (let gz = r.gz0; gz < r.gz1; gz++) for (let gx = r.gx0; gx < r.gx1; gx++) occ.add(cellKey(gx, gz));
      }
      roads = new Set((s.roads ?? []).map((c) => cellKey(c.gx, c.gz)));
    }
    const cells = pitCells(hf, p.anchor, p.box[0], p.box[1], p.box[2], p.box[3], 1)
      .filter((k) => !occ!.has(k) && !roads!.has(k));
    const same = !!prev?.cells && prev.cells.length === cells.length && prev.cells.every((k, i) => k === cells[i]);
    if (same) { next.push(prev!); continue; }
    changed = true;
    next.push({ id, kind: 'pit', cx: Math.round(p.cx * 10) / 10, cz: Math.round(p.cz * 10) / 10, r: Math.round((p.R + CELL_M) * 10) / 10, cells });
  }
  if (next.length !== old.size) changed = true;
  if (!changed) return;
  s.zones = [...keep, ...next];
  // (a load rebuilds the zones the save left out: the network it saved is unchanged)
  if (bump) bumpRoads(s);
}

// ───────────────────────────── saving ─────────────────────────────

/** Write the grid into the state as saved (Game.saveBlob). */
export function saveTerrain(s: GameState, hf: Heightfield) {
  s.terrain ??= { rev: 0, clock: 0, delta: '' };
  s.terrain.delta = encodeDelta(hf.delta);
}

/** A load: the saved grid onto the regenerated surface (base → deltas; the
 *  flattens replay after). Returns the samples restored. */
export function restoreTerrain(s: GameState, hf: Heightfield): number {
  return decodeDelta(s.terrain?.delta ?? '', (k, dm) => hf.setDelta(k, dm));
}

// ───────────────────────────── building near pits (§11.3) ─────────────────────────────

/** The pit whose cut holds sample k (by its bounds), for the words. */
function pitAt(s: GameState, k: number): PitState | undefined {
  const ix = k % N, iz = Math.floor(k / N);
  return (s.pits ?? []).find((p) => ix >= p.box[0] && ix <= p.box[2] && iz >= p.box[1] && iz <= p.box[3] && p.anchor >= 0);
}

const depthWords = (s: GameState, k: number, hf: Heightfield) => {
  const deep = pitAt(s, k)?.deep ?? -hf.delta[k] / 10;
  return `${deep.toFixed(1)} m`;
};

/** Why nothing may stand on this cell rect ('' = the pits allow it): on a pit,
 *  on spoil, or within 4 m of a rim. Graded spoil is buildable. */
export function pitRefusal(s: GameState, hf: Heightfield, gx0: number, gz0: number, gx1: number, gz1: number): string {
  let spoil = false;
  const rec = reclaimedSet(s, hf);
  for (let iz = gz0; iz <= gz1; iz++) {
    for (let ix = gx0; ix <= gx1; ix++) {
      const k = iz * N + ix;
      const d = hf.delta[k];
      if (d < 0 && rec.has(k)) continue; // reclaimed ground builds (§12.2)
      if (d < 0) return `ON A PIT — its benches go ${depthWords(s, k, hf)} down; build ${PIT.rimClearM} m back from the rim`;
      if (d > 0 && !hf.padMask[k]) spoil = true;
    }
  }
  if (spoil) return 'ON SPOIL — a tailings heap; level it with Site Grading, or build elsewhere';
  const ring = Math.ceil(PIT.rimClearM / CELL_M);
  for (let iz = gz0 - ring; iz <= gz1 + ring; iz++) {
    for (let ix = gx0 - ring; ix <= gx1 + ring; ix++) {
      if (ix < 0 || iz < 0 || ix >= N || iz >= N) continue;
      if (hf.delta[iz * N + ix] < 0 && !rec.has(iz * N + ix)) {
        return `TOO CLOSE TO A PIT — nothing within ${PIT.rimClearM} m of a rim; build ${PIT.rimClearM} m back`;
      }
    }
  }
  return '';
}

/** Site Grading on a 4-cell square at (gx, gz): refused over a pit (its
 *  skirt too — grading never fills a hole), '' otherwise. */
export function gradePitRefusal(s: GameState, hf: Heightfield, gx: number, gz: number, cells: number): string {
  const rec = reclaimedSet(s, hf);
  for (let iz = gz - 2; iz <= gz + cells + 2; iz++) {
    for (let ix = gx - 2; ix <= gx + cells + 2; ix++) {
      if (ix < 0 || iz < 0 || ix >= N || iz >= N) continue;
      const k = iz * N + ix;
      if (hf.delta[k] < 0 && !rec.has(k)) return `a pit (${depthWords(s, k, hf)} deep): grading cannot fill it; Reclaim it once it is worked out`;
    }
  }
  return '';
}

/** Site Grading's stored energy (§11.3): on spoil, 40 × (1 + the square's relief ÷ 2 m); else the base cost. */
export function gradeEnergy(hf: Heightfield, gx: number, gz: number, cells: number, base: number): number {
  for (let iz = gz; iz <= gz + cells; iz++) {
    for (let ix = gx; ix <= gx + cells; ix++) {
      const k = iz * N + ix;
      if (hf.delta[k] > 0 && !hf.padMask[k]) {
        return Math.round(base * (1 + hf.maxDelta(gx, gz, gx + cells, gz + cells) / 2));
      }
    }
  }
  return base;
}

// ───────────────────────────── the view (debug, cards) ─────────────────────────────

/** Every pit with its derived numbers (tests, probes). */
export function pitsView(s: GameState, hf: Heightfield | undefined) {
  return (s.pits ?? []).map((p) => ({
    ...p, box: [...p.box], heap: p.heap ? { ...p.heap } : null,
    L: looseLayer(s, p),
    heapRatio: p.cutM3 > 0 ? p.heapM3 / p.cutM3 : 0,
    rimFromKey: (() => { const [x, z] = keyPoint(hf, p.key, s); return Math.hypot(x - p.ox, z - p.oz); })(),
    samples: hf ? countOwn(hf, p) : 0,
  }));
}

function countOwn(hf: Heightfield, p: PitState): number {
  let n = 0;
  for (let iz = Math.max(0, p.box[1]); iz <= Math.min(N - 1, p.box[3]); iz++) {
    for (let ix = Math.max(0, p.box[0]); ix <= Math.min(N - 1, p.box[2]); ix++) if (hf.delta[iz * N + ix] !== 0) n++;
  }
  return n;
}

// ───────────────────────────── Phase 4: reclaim (§12.2) ─────────────────────────────

const reclaimMasks = new WeakMap<Heightfield, { key: string; set: Set<number> }>();

/** Every sample of a reclaimed pit (buildable ground again), memoised on the terrain's revision. */
function reclaimedSet(s: GameState, hf: Heightfield): Set<number> {
  const done = (s.pits ?? []).filter((p) => p.state === 'reclaimed' && p.anchor >= 0);
  const key = `${s.terrain?.rev ?? 0}|${done.map((p) => p.id).join(',')}`;
  const hit = reclaimMasks.get(hf);
  if (hit && hit.key === key) return hit.set;
  const set = new Set<number>();
  for (const p of done) for (const k of ownSamples(hf, p.anchor, p.box, -1)) set.add(k);
  reclaimMasks.set(hf, { key, set });
  return set;
}

/** Why a pit may not be reclaimed ('' = it may): only a dug-out, hemmed-in or idle pit, with spoil to push back. */
export function reclaimRefusal(s: GameState, p: PitState | undefined): string {
  if (!p) return 'NO SUCH PIT';
  if (p.state === 'reclaimed') return 'ALREADY RECLAIMED — the ground builds again';
  if (p.state === 'reclaiming') return 'RECLAIM UNDER WAY';
  if (p.state === 'new' || p.anchor < 0) return 'NOTHING DUG YET';
  if (!p.heap || p.heapM3 < 1) return 'NO SPOIL TO PUSH BACK — its heap is gone';
  const worked = s.haulers.some((u) => u.target === p.key);
  if (!p.spent && p.state !== 'boxed' && worked) return 'STILL WORKED — Reclaim a dug-out, hemmed-in or idle pit';
  if (!reclaimHubFor(s, p)) return 'NO HUB TO PUSH IT BACK — a Smelter, Refinery or Water Plant’s units do it';
  return '';
}

/** The hub whose units push the heap back: the one nearest the pit. */
function reclaimHubFor(s: GameState, p: PitState): number | null {
  let best: number | null = null, bd = Infinity;
  for (const b of s.buildings) {
    if (!b.hub || (b.construction ?? 0) > 0) continue;
    const r = footprintRect(b);
    const x = ((r.gx0 + r.gx1) / 2) * CELL_M - MAP_M / 2, z = ((r.gz0 + r.gz1) / 2) * CELL_M - MAP_M / 2;
    const d = Math.hypot(x - p.cx, z - p.cz);
    if (d < bd - 1e-9) { bd = d; best = b.id; }
  }
  return best;
}

/** Units off a pit: each re-chooses (pinned ones too: their pit is done). */
export function releasePit(s: GameState, key: string): number {
  let n = 0;
  for (const u of s.haulers) {
    if (u.target !== key) continue;
    u.target = null;
    u.face = -1;
    u.pinned = false;
    n++;
  }
  return n;
}

/** Reclaim: the nearest hub's units push its heap back in, instead of digging. */
export function startReclaim(s: GameState, pitId: number): string {
  const p = (s.pits ?? []).find((x) => x.id === pitId);
  const why = reclaimRefusal(s, p);
  if (why) return why;
  releasePit(s, p!.key);
  p!.state = 'reclaiming';
  p!.reclaimHub = reclaimHubFor(s, p!)!;
  p!.fill = 0;
  p!.filled = 0;
  return '';
}

/** A unit pushed `m3` of spoil back into a reclaiming pit (core/hubs.ts, in place of a dig). */
export function pushFill(p: PitState, m3: number) {
  if (p.state === 'reclaiming' && m3 > 0) p.fill = (p.fill ?? 0) + m3;
}

/** Write what was pushed back: the pit fills from the bottom toward a metre
 *  below the ground, its heap comes down by as much; when either is done the
 *  pit is reclaimed and its heap is gone. True: the grid changed. */
function reclaimStep(s: GameState, hf: Heightfield, p: PitState): boolean {
  const owe = (p.fill ?? 0) - (p.filled ?? 0);
  if (owe < RECLAIM.batchM3 && p.heapM3 >= 1) return false;
  const samples = ownSamples(hf, p.anchor, p.box, -1);
  const r = fillPit(hf, samples, Math.min(owe, p.heapM3), RECLAIM.floorM * 10);
  let changed = r.changed > 0;
  if (r.added > 0) p.filled = (p.filled ?? 0) + r.added;
  if (p.heap && r.added > 0) {
    const hs = ownSamples(hf, p.heap.anchor, p.box, 1);
    const taken = lowerHeap(hf, hs, Math.max(0, (p.heapM3 - r.added) / Math.max(1e-6, p.heapM3)));
    p.heapM3 = Math.max(0, p.heapM3 - taken);
    if (hf.delta[p.heap.anchor] <= 0) {
      let top = -1, h = 0;
      for (const k of hs) if (hf.delta[k] > h) { h = hf.delta[k]; top = k; }
      if (top >= 0) p.heap.anchor = top;
    }
  }
  if (r.added < 0.5 || p.heapM3 < 1) {
    // done: the heap is gone; the ground builds again (the zone closes)
    if (p.heap && p.heap.anchor >= 0 && hf.delta[p.heap.anchor] > 0) {
      if (lowerHeap(hf, ownSamples(hf, p.heap.anchor, p.box, 1), 0) > 0) changed = true;
    }
    p.heapM3 = 0;
    p.state = 'reclaimed';
    p.endedAt = s.simTime;
    releasePit(s, p.key);
    (p.news ??= []).push('reclaimed');
    changed = true;
  }
  if (changed) p.scar = countOwn(hf, p) * CELL_M * CELL_M;
  return changed;
}

// ───────────────────────────── Phase 4: grade, faces, reserves ─────────────────────────────

const gradeMemo = new Map<string, number>();

/** The grade (q) a hub's units bring from a target now (§9.1): a deposit's cut
 *  (its centre, before a pit), plain ground's grade for a plain pit or a
 *  dug-out deposit, bedrock's 80% on bedrock benches; × the research and, on
 *  plain ground, a crew's high-grading. MRE: 1 anywhere. */
export function targetGrade(s: GameState, mods: Mods, site: Pick<SiteDef, 'hasIce'>, hubType: PitHubType, key: string): number {
  const proc = processOf(mods, site, hubType);
  if (!proc) return 1;
  if (proc === 'MRE') return 1;
  const plain = (rock = false) => plainQ(proc, s.siteId) * (rock ? GRADE.bedrock : 1) * gradeMult(s, mods, proc, true);
  const p = pitOf(s, key);
  if (!key.startsWith('dep:')) return plain(p?.rockR !== undefined);
  const d = terrains.get(s)?.deposits.find((x) => x.id === key.slice(4));
  if (!d) return plain();
  const prof = profileOf(s, d);
  if (prof.centre[proc] === undefined) return plain(p?.rockR !== undefined);
  if (p && p.rockR === undefined && (p.spent || p.state === 'reclaiming' || p.state === 'reclaimed')) return plain();
  const shape = p
    ? { cx: p.cx, cz: p.cz, R: p.rockR ?? p.R, L: prof.L, rock: p.rockR !== undefined }
    : { cx: d.cx, cz: d.cz, R: 4, L: prof.L };
  const mk = `${s.seed}|${key}|${proc}|${shape.cx.toFixed(1)},${shape.cz.toFixed(1)}|${shape.R.toFixed(1)}|${shape.rock ? 1 : 0}`;
  let g = gradeMemo.get(mk);
  if (g === undefined) {
    g = cutGrade(prof, proc, s.siteId, shape);
    if (gradeMemo.size > 2000) gradeMemo.clear();
    gradeMemo.set(mk, g);
  }
  return g * gradeMult(s, mods, proc, false);
}
type PitHubType = Parameters<typeof processOf>[2];

/** Faces at a target (§8.2): now (a new pit 1; boxed in, reclaimed 0; on
 *  bedrock, its floor's) and at full size (a deposit's full-size pit; a plain
 *  pit's three-lunar-day ring). Phase 5 reads it. */
export function faceCapacity(s: GameState, key: string): { now: number; full: number } {
  const p = pitOf(s, key);
  const d = key.startsWith('dep:') ? terrains.get(s)?.deposits.find((x) => x.id === key.slice(4)) : undefined;
  const t = d ? oreTruth(s, d) : null;
  const free = p?.free ?? 1;
  const L = d ? profileOf(s, d).L : p ? looseLayer(s, p) : PIT.looseMare[0];
  const full = facesFor(t ? t.fullR : Math.max(p?.R ?? 0, pitRadius(PIT.planM3, L)), free);
  if (!p) return { now: 1, full };
  if (p.state === 'boxed' || p.state === 'reclaimed') return { now: 0, full };
  if (p.rockR !== undefined) return { now: facesFor(p.rockR - 2 * looseLayer(s, p)), full };
  const now = facesFor(p.R, free);
  return { now, full: Math.max(full, now) };
}

export interface ReserveView {
  id: string;
  /** the process its ore is measured in (null: no ore bed) */
  process: string | null;
  /** surveyed, and the precision it reads to (±share) */
  surveyed: boolean; precision: number | null; surveyedAt: number | null;
  /** the survey's reading (null unsurveyed): ore ▲ and centre grade, with ranges */
  est: OreEstimate | null;
  /** what the ground really holds (the tests; the UI shows `est`) */
  truth: OreTruth | null;
  /** ▲ of ore dug, left (the truth), and left as the survey reads it */
  dug: number; left: number; leftLo: number | null; leftHi: number | null;
  /** the pit's state ('untouched': no pit yet), EXHAUSTED, on bedrock benches */
  state: PitState['state'] | 'untouched'; spent: boolean; bedrock: boolean;
  /** the pit: its rim now, its full size, its depth, the loose layer */
  pitR: number; fullR: number; deep: number; L: number;
  faces: number; facesFull: number;
  /** the grade of the cut now, in its ore's process (null: none) */
  cutQ: number | null;
  /** ▲/s dug now, and seconds of ore left at it (Infinity) */
  rate: number; life: number;
  /** ▲ of ore two bedrock benches (Deep Coring, 4 m) would hold under it */
  rockMore: number;
  /** the heap's m³ and the scar's m² */
  heapM3: number; scar: number;
}

/** A deposit's reserves as a card shows them (§13.4). Phase 5 reads it. Null: no such deposit. */
export function reservesOf(s: GameState, mods: Pick<Mods, 'surveyPrecision'>, depId: string): ReserveView | null {
  const d = terrains.get(s)?.deposits.find((x) => x.id === depId);
  if (!d) return null;
  const prof = profileOf(s, d);
  const t = oreTruth(s, d);
  const p = pitOf(s, `dep:${depId}`) ?? (s.pits ?? []).find((x) => x.key === `dep:${depId}`) ?? null;
  const sv = s.oreSurvey?.done[depId];
  const est = sv && t ? estimateOf(s, d, sv.precision) : null;
  const dug = p?.ore ?? 0;
  const left = p ? pitOreLeft(s, p) ?? 0 : t?.ore ?? 0;
  const spent = !!p?.spent;
  const inRock = p?.rockR !== undefined;
  const leftLo = est ? (spent && !inRock ? 0 : Math.max(0, est.lo - dug)) : null;
  const leftHi = est ? (spent && !inRock ? 0 : Math.max(0, est.hi - dug)) : null;
  const fc = faceCapacity(s, `dep:${depId}`);
  const cutQ = prof.process
    ? p && p.anchor >= 0
      ? cutGrade(prof, prof.process, s.siteId, { cx: p.cx, cz: p.cz, R: p.rockR ?? p.R, L: prof.L, rock: inRock })
      : cutGrade(prof, prof.process, s.siteId, { cx: d.cx, cz: d.cz, R: 4, L: prof.L })
    : null;
  const rate = p?.rate ?? 0;
  const R = p && p.anchor >= 0 ? p.R : 0;
  return {
    id: depId, process: prof.process, surveyed: !!sv, precision: sv ? sv.precision : null, surveyedAt: sv ? sv.at : null,
    est, truth: t, dug, left, leftLo, leftHi,
    state: p ? p.state : 'untouched', spent, bedrock: inRock,
    pitR: R, fullR: t?.fullR ?? 0, deep: p?.deep ?? 0, L: prof.L,
    faces: fc.now, facesFull: fc.full, cutQ, rate, life: rate > 0.02 && left > 0 ? left / rate : Infinity,
    rockMore: t ? bedrockOre(R || t.fullR, prof.L, 2 * PIT.bench) : 0,
    heapM3: p?.heapM3 ?? 0, scar: p?.scar ?? 0,
  };
}

/** A pit's name: 'high-Ti basalt #0', 'plain pit P4'. */
export function pitName(s: GameState, p: Pick<PitState, 'key' | 'id' | 'deposit'>): string {
  if (p.key.startsWith('plain:')) return `plain pit P${p.key.slice(6)}`;
  const id = p.key.startsWith('dep:') ? p.key.slice(4) : p.deposit;
  const d = id ? terrains.get(s)?.deposits.find((x) => x.id === id) : undefined;
  return d ? `${DEPOSIT_INFO[d.kind].name} #${d.id.split('-').pop()}` : `pit ${p.id}`;
}

// ───────────────────────────── Phase 4: strip-mine morale (§12.1) ─────────────────────────────

export interface StripTerm {
  /** the morale target's term (≤ 0, capped) */
  term: number;
  /** the pit that costs most: its name, how far from which home, its own term */
  worst: { name: string; dist: number; home: string; term: number } | null;
}

/** A crewed base minds the scars it lives beside: every pit and its heap within
 *  250 m of a habitat or the crewed Lander (full within 100 m) — a plain pit or
 *  a dead deposit pit −1 per 1,000 m², a working deposit's −0.4, reclaimed
 *  ground ×0.2 — capped at −12. A robotic base shows none. */
export function stripMorale(s: GameState): StripTerm {
  if (s.crew <= 0 || !s.pits?.length) return { term: 0, worst: null };
  const homes: { x: number; z: number; name: string }[] = [];
  for (const b of s.buildings) {
    if ((b.construction ?? 0) > 0) continue;
    if (b.type !== 'habitat' && !(b.type === 'lander' && !s.crewHome)) continue;
    const r = footprintRect(b);
    homes.push({
      x: ((r.gx0 + r.gx1) / 2) * CELL_M - MAP_M / 2, z: ((r.gz0 + r.gz1) / 2) * CELL_M - MAP_M / 2,
      name: b.type === 'lander' ? 'the Lander' : `Habitat #${b.id}`,
    });
  }
  if (!homes.length) return { term: 0, worst: null };
  let term = 0;
  let worst: StripTerm['worst'] = null;
  for (const p of s.pits) {
    if (!(p.scar ?? 0) || p.anchor < 0) continue;
    const live = p.key.startsWith('dep:') && !p.spent && p.state !== 'boxed';
    let per = live ? STRIP.deposit : STRIP.plain;
    if (p.state === 'reclaimed') per *= STRIP.reclaimed;
    let near = homes[0], nd = Infinity;
    for (const h of homes) {
      const d = Math.max(0, Math.hypot(h.x - p.cx, h.z - p.cz) - p.R);
      if (d < nd) { nd = d; near = h; }
    }
    const f = nd <= STRIP.nearM ? 1 : nd >= STRIP.farM ? 0 : (STRIP.farM - nd) / (STRIP.farM - STRIP.nearM);
    const t = (per * (p.scar ?? 0) / 1000) * f;
    if (t >= -1e-6) continue;
    term += t;
    if (!worst || t < worst.term) worst = { name: pitName(s, p), dist: Math.round(nd), home: near.name, term: t };
  }
  return { term: Math.max(STRIP.cap, term), worst };
}

// ───────────────────────────── Phase 4: the deposit survey (§13) ─────────────────────────────

const HUB_FOR: Record<string, string> = { H2: 'smelter', plag: 'refinery', ice: 'water plant', soil: 'water plant' };

/** Why a deposit's survey may not be queued ('' = it may). */
export function surveyRefusal(s: GameState, mods: Mods, depId: string): string {
  const d = terrains.get(s)?.deposits.find((x) => x.id === depId);
  if (!d) return 'NO SUCH DEPOSIT';
  if (!depositRevealed(s, d, mods.surveyTier)) return 'UNMAPPED — map it first (Prospecting Rovers, a Relay Mast)';
  if (!profileOf(s, d).process) return 'NO ORE BED — KREEP soil and peaks of light hold no ore to measure';
  const done = s.oreSurvey?.done[depId];
  if (done) return `ALREADY SURVEYED (±${Math.round(done.precision * 100)}%)`;
  const job = s.oreSurvey?.jobs.find((j) => j.id === depId);
  if (job) return job.rover !== undefined ? 'SURVEY UNDER WAY — a rover is coring it' : 'SURVEY QUEUED — it waits for a free rover';
  if ((s.oreSurvey?.jobs.length ?? 0) >= DEP_SURVEY.queueMax) return `SURVEY QUEUE FULL — ${DEP_SURVEY.queueMax} deposits at once`;
  if (!s.rovers?.length) return 'SURVEY NEEDS A ROVER — the construction fleet is empty';
  if (s.powerStored < DEP_SURVEY.energy) return `SURVEY NEEDS ${DEP_SURVEY.energy} STORED ENERGY — have ${Math.floor(s.powerStored)}`;
  if (s.resources.parts < DEP_SURVEY.parts) return `SURVEY NEEDS ${DEP_SURVEY.parts}⚙ — have ${Math.floor(s.resources.parts)}`;
  return '';
}

/** Survey: pay the core drill's energy and its bits, and queue the job for a
 *  free rover (taken before road jobs). '' on success, else the refusal. */
export function queueSurvey(s: GameState, mods: Mods, depId: string): string {
  const why = surveyRefusal(s, mods, depId);
  if (why) return why;
  s.powerStored -= DEP_SURVEY.energy;
  s.resources.parts -= DEP_SURVEY.parts;
  s.oreSurvey.jobs.push({ id: depId, t: 0 });
  const free = s.rovers.some((r) => r.site === null && !r.pinned && r.core === undefined && r.id !== s.survey?.active?.rover);
  if (!free) alert(s, 'SURVEY NEEDS A FREE ROVER — it waits in the queue', 'info', { deposit: depId });
  return '';
}

/** The survey's line (the alert, the card's head): ore, grade, loose layer, faces, life. */
export function surveyLine(s: GameState, depId: string): string {
  const d = terrains.get(s)?.deposits.find((x) => x.id === depId);
  const sv = s.oreSurvey?.done[depId];
  if (!d || !sv) return '';
  const est = estimateOf(s, d, sv.precision);
  const prof = profileOf(s, d);
  const t = oreTruth(s, d);
  if (!est || !t || !prof.process) return '';
  const fc = faceCapacity(s, `dep:${depId}`);
  const days = est.ore / (2 * CYCLE_S);
  return `${kiloT(est.lo)}–${kiloT(est.hi)}▲ of ore (±${Math.round(sv.precision * 100)}%) · centre ${measureText(prof.process, est.centre)} (q ${est.centre.toFixed(1)})` +
    ` · loose to ${prof.L.toFixed(1)} m · ${fc.now} face${fc.now === 1 ? '' : 's'} now, ${fc.full} at full size (R ${Math.round(t.fullR)} m)` +
    ` · ~${days >= 10 ? Math.round(days) : days.toFixed(1)} lunar days at one ${HUB_FOR[prof.process]}`;
}
const kiloT = (t: number) => (t >= 1000 ? `${(t / 1000).toFixed(1)}k` : `${Math.round(t)}`);

/** Economy step 4.3: rovers core their deposits (once there, or when no road
 *  reaches the gate), surveyed deposits are re-read when a precision tech
 *  completes, and masts with Neutron Spectrometry survey ice and soil free. */
export function oreSurveyStep(s: GameState, mods: Mods, dt: number) {
  const hf = terrains.get(s);
  const sv = (s.oreSurvey ??= { done: {}, jobs: [] });
  if (!hf) return;
  // re-read: research tightened the precision
  let reread = 0;
  for (const v of Object.values(sv.done)) {
    if (v.precision > mods.surveyPrecision + 1e-9) { v.precision = mods.surveyPrecision; reread++; }
  }
  if (reread) alert(s, `SURVEYS RE-READ — ${reread} deposit${reread === 1 ? '' : 's'} now ±${Math.round(mods.surveyPrecision * 100)}%`, 'info');
  // masts survey ice and mature soil in their radius (Neutron Spectrometry)
  if (mods.mastSurveyKinds.size) {
    const r = networkRadius('relayMast', s.techsDone);
    for (const b of s.buildings) {
      if (b.type !== 'relayMast' || (b.construction ?? 0) > 0) continue;
      const fr = footprintRect(b);
      const mx = ((fr.gx0 + fr.gx1) / 2) * CELL_M - MAP_M / 2, mz = ((fr.gz0 + fr.gz1) / 2) * CELL_M - MAP_M / 2;
      for (const d of hf.deposits) {
        if (!mods.mastSurveyKinds.has(d.kind) || sv.done[d.id] || Math.hypot(d.cx - mx, d.cz - mz) - d.r > r) continue;
        sv.done[d.id] = { at: s.simTime, precision: mods.surveyPrecision };
        sv.jobs = sv.jobs.filter((j) => j.id !== d.id);
        alert(s, `SURVEYED BY RELAY MAST #${b.id} — ${pitName(s, { key: `dep:${d.id}`, id: 0, deposit: d.id })}: ${surveyLine(s, d.id)}`, 'info', { deposit: d.id });
      }
    }
  }
  // the rovers' cores
  const need = DEP_SURVEY.coreS * mods.surveyTimeMult;
  for (const j of [...sv.jobs]) {
    const r = j.rover !== undefined ? s.rovers.find((x) => x.id === j.rover && x.core === j.id) : undefined;
    const t = r?.trip;
    if (!r || !t || t.kind !== 'core') continue;
    if (!t.stuck && t.t < t.dur - 1e-9) continue;
    j.t += dt * (r.pw ?? 1);
    if (j.t < need - 1e-9) continue;
    sv.done[j.id] = { at: s.simTime, precision: mods.surveyPrecision };
    sv.jobs = sv.jobs.filter((x) => x !== j);
    delete r.core;
    s.data += DEP_SURVEY.data;
    alert(s, `SURVEYED — ${pitName(s, { key: `dep:${j.id}`, id: 0, deposit: j.id })}: ${surveyLine(s, j.id)} · +${DEP_SURVEY.data}≡`, 'info', { deposit: j.id });
  }
}
