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
import { CELL_M, FEED, HAUL, MAP_CELLS, MAP_M, PIT } from '../data/balance';
import { FIELD_TYPES } from '../data/roads';
import type { FeedKind } from '../data/deposits';
import type { GameState, PitState, ZoneState } from './state';
import type { Heightfield } from '../terrain/heightfield';
import {
  carvePit, decodeDelta, dumpHeap, encodeDelta, heapRadius, pitCells, pitRadius, stakeHeap, stakePit,
  type Blockers, type HeapShape, type PitShape,
} from '../terrain/pitCarve';
import { footprintRect } from '../buildings/instances';
import { bumpRoads, cellAt, cellCentre, cellKey, doorCell } from './roads';
import { mulberry32 } from './rng';

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

/** The growth itself (Phase 2 calls this for a hub unit's pit). */
export function digInto(_s: GameState, p: PitState, tonnes: number, q: number) {
  const a = tonnes / (tonnes + HAUL.feedMemory);
  p.q = p.tonnes > 0 ? p.q + (q - p.q) * a : q;
  p.tonnes += tonnes;
  p.dugM3 += tonnes / PIT.tPerM3;
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

/** The loose layer a pit widens at (§8.5), m: seeded from (seed, pit id) within its ground's range. */
export function looseLayer(s: Pick<GameState, 'seed' | 'siteId'>, p: Pick<PitState, 'id' | 'deposit'>): number {
  const kind = p.deposit?.split('-')[0];
  const range = kind === 'anorthosite' ? PIT.looseHighland
    : kind === 'ice' ? PIT.looseIce
    : kind === 'volatiles' ? PIT.looseVolatiles
    : kind ? PIT.looseMare
    : s.siteId === 'southpole' ? PIT.looseHighland : PIT.looseMare;
  const rng = mulberry32((s.seed ^ 0x9175ea ^ Math.imul(p.id, 0x9e3779b1)) >>> 0);
  return Math.round((range[0] + rng() * (range[1] - range[0])) * 10) / 10;
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
  return { cx: p.cx, cz: p.cz, L: looseLayer(s, p), ox: p.ox, oz: p.oz, ux: p.ux, uz: p.uz, A: p.A, R: p.R, anchor: p.anchor };
}

// ───────────────────────────── step 4.2 ─────────────────────────────

/** Economy step 4.2: stake new pits, carve what was dug, dump the spoil; the
 *  pit zones follow. Deterministic: pits in id order on the terrain clock. */
export function pitsStep(s: GameState, dt: number) {
  const hf = terrains.get(s);
  if (!hf || !s.pits?.length) return;
  s.terrain ??= { rev: 0, clock: 0, delta: '' };
  const clock = (s.terrain.clock += dt);
  let bl: Blockers | null = null;
  const carved = new Set<number>();
  for (const p of s.pits) {
    if (p.state !== 'new' && p.state !== 'open' && p.state !== 'boxed') continue;
    const wait = p.state === 'open' ? PIT.everyS : RETRY_S;
    if (clock - p.at < wait - 1e-9) continue;
    const owe = p.dugM3 - p.cutM3;
    if (p.state === 'new') {
      if (p.dugM3 < PIT.firstM3) continue;
      p.at = clock;
      bl ??= blockersOf(s);
      if (!stake(s, hf, p, bl)) continue;
    } else {
      const L = looseLayer(s, p);
      const move = pitRadius(p.dugM3, L) - pitRadius(p.cutM3, L);
      if (owe < 20 || (move < PIT.rimMoveM && owe < PIT.batchM3)) continue;
      p.at = clock;
    }
    bl ??= blockersOf(s);
    if (carve(s, hf, p, bl)) carved.add(p.id);
  }
  if (!carved.size) return;
  s.terrain.rev++;
  syncPitZones(s, hf, carved);
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

/** Carve what a pit is owed and dump its spoil. True: the grid changed. */
function carve(s: GameState, hf: Heightfield, p: PitState, bl: Blockers): boolean {
  const sh = shapeOf(s, p);
  const dR = Math.max(0, pitRadius(p.dugM3, sh.L) - pitRadius(p.cutM3, sh.L));
  const r = carvePit(hf, sh, bl, p.dugM3 - p.cutM3, dR);
  let changed = false;
  if (r.changed) {
    changed = true;
    p.cx = sh.cx; p.cz = sh.cz; p.R = sh.R; p.A = sh.A; p.anchor = sh.anchor;
    p.cutM3 += r.added;
    p.deep = Math.max(p.deep, r.extreme);
    grow(p.box, r);
  }
  p.state = r.added < 0.5 ? 'boxed' : 'open';
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
    if (p.anchor < 0) continue;
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
  for (let iz = gz0; iz <= gz1; iz++) {
    for (let ix = gx0; ix <= gx1; ix++) {
      const k = iz * N + ix;
      const d = hf.delta[k];
      if (d < 0) return `ON A PIT — its benches go ${depthWords(s, k, hf)} down; build ${PIT.rimClearM} m back from the rim`;
      if (d > 0 && !hf.padMask[k]) spoil = true;
    }
  }
  if (spoil) return 'ON SPOIL — a tailings heap; level it with Site Grading, or build elsewhere';
  const ring = Math.ceil(PIT.rimClearM / CELL_M);
  for (let iz = gz0 - ring; iz <= gz1 + ring; iz++) {
    for (let ix = gx0 - ring; ix <= gx1 + ring; ix++) {
      if (ix < 0 || iz < 0 || ix >= N || iz >= N) continue;
      if (hf.delta[iz * N + ix] < 0) {
        return `TOO CLOSE TO A PIT — nothing within ${PIT.rimClearM} m of a rim; build ${PIT.rimClearM} m back`;
      }
    }
  }
  return '';
}

/** Site Grading on a 4-cell square at (gx, gz): refused over a pit (its
 *  skirt too — grading never fills a hole), '' otherwise. */
export function gradePitRefusal(s: GameState, hf: Heightfield, gx: number, gz: number, cells: number): string {
  for (let iz = gz - 2; iz <= gz + cells + 2; iz++) {
    for (let ix = gx - 2; ix <= gx + cells + 2; ix++) {
      if (ix < 0 || iz < 0 || ix >= N || iz >= N) continue;
      const k = iz * N + ix;
      if (hf.delta[k] < 0) return `a pit (${depthWords(s, k, hf)} deep): grading cannot fill it; Reclaim it once it is worked out`;
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
