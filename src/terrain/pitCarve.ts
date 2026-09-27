/** Strip-mine terrain (docs/17 §8, §11): the height-delta grid's writers.
 *
 *  - The grid is `Heightfield.delta`, decimetres, 0 almost everywhere. A
 *    carved sample's height is exactly `base + delta / 10`; a load applies the
 *    grid to the regenerated surface before the flattens replay (base →
 *    deltas → flattens), so the ground comes back byte for byte.
 *  - A pit is an inverted, terraced cone round its centre: 1:2 walls in 2 m
 *    benches (each 4 m sample ring a bench lower), a flat floor at the loose
 *    layer L, and a straight ramp at 1:4 down its gate side. A heap is a
 *    flat-topped dump, sides at 35°, at most 6 m high.
 *  - Growth is by volume: the rim radius R is solved by bisection so that the
 *    ground actually cut (the union with what was cut before) matches what
 *    was dug. Carving is monotone: a carved sample never rises again (Reclaim,
 *    Phase 4, is the one writer that may: `raiseCut`).
 *  - What a pit may not dig, and a heap not bury (the masks): building pads
 *    and their two-sample skirts, a margin past them, road cells and a margin,
 *    every flatten (graded ground, old pads), other pits and every heap, and
 *    the map's border. Near a blocked sample a wall's depth is capped at half
 *    its distance, so walls stay 1:2 everywhere.
 *  - Grow away (§8.1 as shipped): probes past the rim find the blocked sides,
 *    and each carve drifts the centre away from them by up to the rim's
 *    advance, so a pit elongates away from what stands beside it.
 *
 *  Pure: plain data in, the grid out. No Three.js, no randomness; scratch
 *  buffers are reused, never allocated per call once grown. */
import { CELL_M, MAP_CELLS, MAP_M, PIT } from '../data/balance';
import type { Heightfield } from './heightfield';

const N = MAP_CELLS + 1;
const HALF = MAP_M / 2;
const BIG = 1e12;

/** What stands on the map: structure footprints (cell rects) and road cells,
 *  doors and bays (cell keys, gz × 256 + gx). */
export interface Blockers {
  pads: readonly { gx0: number; gz0: number; gx1: number; gz1: number }[];
  cells: readonly number[];
  /** discs no stake may take (other pits' and heaps' planned ground), world m */
  discs?: readonly { x: number; z: number; r: number }[];
}

/** A pit's shape parameters (core/pits.ts keeps them on PitState). */
export interface PitShape {
  /** its centre now (it drifts away from blocked sides), world m */
  cx: number; cz: number;
  /** the loose layer's depth, m (its floor) */
  L: number;
  /** the ramp's line: through (ox, oz), running out along (ux, uz), its top at `A` m along */
  ox: number; oz: number; ux: number; uz: number; A: number;
  /** rim radius of the last carve, m */
  R: number;
  /** a sample of its own cut (index), −1 before the first carve */
  anchor: number;
}

/** A heap's shape: its centre, its base radius so far, a sample of it. */
export interface HeapShape { hx: number; hz: number; Rh: number; anchor: number }

export interface CarveResult {
  /** m³ cut this carve (or dumped, for a heap) */
  added: number;
  /** samples changed, and their bounding box (sample indices) */
  changed: number;
  ix0: number; iz0: number; ix1: number; iz1: number;
  /** the deepest (or highest) sample of it now, m */
  extreme: number;
}

// ───────────────────────────── scratch ─────────────────────────────

let cap = 0;
let blocked = new Uint8Array(0);
let dist = new Float32Array(0);     // m to the nearest blocked sample
let own = new Uint8Array(0);        // this pit's (or heap's) own samples
let stack = new Int32Array(0);
let cIdx = new Int32Array(0), cRho = new Float32Array(0), cCap = new Float32Array(0);
let cAlong = new Float32Array(0), cCur = new Int16Array(0);
let line = new Float64Array(0), lineOut = new Float64Array(0), lineZ = new Float64Array(0);
let lineV = new Int32Array(0);

function ensure(n: number, side: number) {
  if (n > cap) {
    cap = n;
    blocked = new Uint8Array(n); dist = new Float32Array(n); own = new Uint8Array(n);
    stack = new Int32Array(n); cIdx = new Int32Array(n); cRho = new Float32Array(n);
    cCap = new Float32Array(n); cAlong = new Float32Array(n); cCur = new Int16Array(n);
  }
  if (side + 1 > line.length) {
    line = new Float64Array(side + 1); lineOut = new Float64Array(side + 1);
    lineZ = new Float64Array(side + 2); lineV = new Int32Array(side + 1);
  }
}

/** A window of samples: [x0, x0 + w) × [z0, z0 + h), clamped to the map. */
interface Win { x0: number; z0: number; w: number; h: number }

function windowAt(x: number, z: number, halfM: number): Win {
  const x0 = Math.max(0, Math.floor((x - halfM + HALF) / CELL_M));
  const z0 = Math.max(0, Math.floor((z - halfM + HALF) / CELL_M));
  const x1 = Math.min(N - 1, Math.ceil((x + halfM + HALF) / CELL_M));
  const z1 = Math.min(N - 1, Math.ceil((z + halfM + HALF) / CELL_M));
  return { x0, z0, w: x1 - x0 + 1, h: z1 - z0 + 1 };
}

const sx = (ix: number) => ix * CELL_M - HALF;
const nearest = (v: number) => Math.round((v + HALF) / CELL_M);

// ───────────────────────────── masks ─────────────────────────────

/** Mark a sample rect (global indices, inclusive) blocked, clipped to the window. */
function stamp(win: Win, ix0: number, iz0: number, ix1: number, iz1: number) {
  const a = Math.max(ix0, win.x0), b = Math.min(ix1, win.x0 + win.w - 1);
  const c = Math.max(iz0, win.z0), d = Math.min(iz1, win.z0 + win.h - 1);
  for (let iz = c; iz <= d; iz++) {
    const row = (iz - win.z0) * win.w - win.x0;
    for (let ix = a; ix <= b; ix++) blocked[row + ix] = 1;
  }
}

/** Flood this shape's own samples from its anchor: 8-connected, of one sign
 *  (−1 a pit's cut, +1 a heap). Shapes keep a sample apart, so the flood
 *  never runs into another's. */
function floodOwn(hf: Heightfield, win: Win, anchor: number, sign: -1 | 1) {
  own.fill(0, 0, win.w * win.h);
  if (anchor < 0) return;
  const ax = anchor % N, az = Math.floor(anchor / N);
  if (ax < win.x0 || az < win.z0 || ax >= win.x0 + win.w || az >= win.z0 + win.h) return;
  if (Math.sign(hf.delta[anchor]) !== sign) return;
  let sp = 0;
  const l0 = (az - win.z0) * win.w + (ax - win.x0);
  own[l0] = 1;
  stack[sp++] = l0;
  while (sp > 0) {
    const l = stack[--sp];
    const lx = l % win.w, lz = (l - lx) / win.w;
    for (let dz = -1; dz <= 1; dz++) {
      const nz = lz + dz;
      if (nz < 0 || nz >= win.h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = lx + dx;
        if ((dx === 0 && dz === 0) || nx < 0 || nx >= win.w) continue;
        const nl = nz * win.w + nx;
        if (own[nl]) continue;
        const k = (win.z0 + nz) * N + win.x0 + nx;
        if (Math.sign(hf.delta[k]) !== sign) continue;
        own[nl] = 1;
        stack[sp++] = nl;
      }
    }
  }
}

/** The mask for a pit's cut ('dig') or a heap ('dump'), over the window. */
function buildMask(hf: Heightfield, win: Win, bl: Blockers, mode: 'dig' | 'dump', discs = false) {
  const n = win.w * win.h;
  blocked.fill(0, 0, n);
  const B = PIT.border;
  const r = PIT.pitRings;
  // the map's border, flattens (pads, skirts, graded ground) and other shapes
  for (let lz = 0; lz < win.h; lz++) {
    const iz = win.z0 + lz;
    for (let lx = 0; lx < win.w; lx++) {
      const ix = win.x0 + lx;
      const l = lz * win.w + lx;
      if (ix < B || iz < B || ix > N - 1 - B || iz > N - 1 - B) { blocked[l] = 1; continue; }
      const k = iz * N + ix;
      if (hf.padMask[k] || hf.skirt[k]) blocked[l] = 1;
    }
  }
  // other pits and every heap (for a heap: every pit and other heaps), a sample apart:
  // scanned a ring past the window so a neighbour just outside still keeps its distance
  const ax0 = Math.max(0, win.x0 - r), ax1 = Math.min(N - 1, win.x0 + win.w - 1 + r);
  const az0 = Math.max(0, win.z0 - r), az1 = Math.min(N - 1, win.z0 + win.h - 1 + r);
  for (let iz = az0; iz <= az1; iz++) {
    for (let ix = ax0; ix <= ax1; ix++) {
      const d = hf.delta[iz * N + ix];
      if (d === 0) continue;
      const inWin = ix >= win.x0 && iz >= win.z0 && ix < win.x0 + win.w && iz < win.z0 + win.h;
      const mine = inWin && own[(iz - win.z0) * win.w + ix - win.x0] === 1;
      const other = mode === 'dig' ? (d > 0 || !mine) : (d < 0 || !mine);
      if (other) stamp(win, ix - r, iz - r, ix + r, iz + r);
    }
  }
  // structures: the pad, its skirt and a margin
  const pr = PIT.padRings;
  for (const p of bl.pads) stamp(win, p.gx0 - pr, p.gz0 - pr, p.gx1 + pr, p.gz1 + pr);
  // roads, doors, bays and the Lander's apron: a sample either side and a margin
  const rr = PIT.roadRings;
  for (const key of bl.cells) {
    const gx = key % MAP_CELLS, gz = Math.floor(key / MAP_CELLS);
    stamp(win, gx - rr, gz - rr, gx + 1 + rr, gz + 1 + rr);
  }
  if (discs && bl.discs) {
    for (const d of bl.discs) {
      const i0 = Math.floor((d.x - d.r + HALF) / CELL_M), i1 = Math.ceil((d.x + d.r + HALF) / CELL_M);
      const j0 = Math.floor((d.z - d.r + HALF) / CELL_M), j1 = Math.ceil((d.z + d.r + HALF) / CELL_M);
      for (let iz = Math.max(j0, win.z0); iz <= Math.min(j1, win.z0 + win.h - 1); iz++) {
        for (let ix = Math.max(i0, win.x0); ix <= Math.min(i1, win.x0 + win.w - 1); ix++) {
          const dx = sx(ix) - d.x, dz = sx(iz) - d.z;
          if (dx * dx + dz * dz <= d.r * d.r) blocked[(iz - win.z0) * win.w + ix - win.x0] = 1;
        }
      }
    }
  }
  void mode;
}

/** 1-D squared distance transform (Felzenszwalb–Huttenlocher) of line[0..n). */
function edt1(n: number) {
  let k = 0;
  lineV[0] = 0; lineZ[0] = -BIG; lineZ[1] = BIG;
  for (let q = 1; q < n; q++) {
    let s = ((line[q] + q * q) - (line[lineV[k]] + lineV[k] * lineV[k])) / (2 * q - 2 * lineV[k]);
    while (s <= lineZ[k]) {
      k--;
      s = ((line[q] + q * q) - (line[lineV[k]] + lineV[k] * lineV[k])) / (2 * q - 2 * lineV[k]);
    }
    k++;
    lineV[k] = q; lineZ[k] = s; lineZ[k + 1] = BIG;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (lineZ[k + 1] < q) k++;
    const d = q - lineV[k];
    lineOut[q] = d * d + line[lineV[k]];
  }
}

/** dist[] = metres from each window sample to the nearest blocked one (exact Euclidean). */
function distances(win: Win) {
  const { w, h } = win;
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < h; z++) line[z] = blocked[z * w + x] ? 0 : BIG;
    edt1(h);
    for (let z = 0; z < h; z++) dist[z * w + x] = lineOut[z];
  }
  for (let z = 0; z < h; z++) {
    const row = z * w;
    for (let x = 0; x < w; x++) line[x] = dist[row + x];
    edt1(w);
    for (let x = 0; x < w; x++) dist[row + x] = Math.min(1e6, Math.sqrt(lineOut[x]) * CELL_M);
  }
}

// ───────────────────────────── volumes ─────────────────────────────

/** Volume of a free round pit of rim radius R (1:2 walls, floor at L), m³. */
export function pitVolume(R: number, L: number): number {
  if (R <= 0) return 0;
  if (R <= 2 * L) return (Math.PI * R * R * R) / 6;
  const r = R - 2 * L;
  return ((Math.PI * L) / 3) * (R * R + R * r + r * r);
}

/** The rim radius a free round pit of volume V reaches (the inverse of pitVolume). */
export function pitRadius(V: number, L: number): number {
  if (V <= 0) return 0;
  let lo = 0, hi = 4;
  while (pitVolume(hi, L) < V && hi < 1e4) hi *= 2;
  for (let i = 0; i < 48; i++) {
    const m = (lo + hi) / 2;
    if (pitVolume(m, L) < V) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

/** Volume of a free heap of base radius Rb (35° sides, flat top at PIT.heapMaxH), m³. */
export function heapVolume(Rb: number): number {
  if (Rb <= 0) return 0;
  const run = PIT.heapMaxH / PIT.heapSlope;
  if (Rb <= run) return (Math.PI * Rb * Rb * Rb * PIT.heapSlope) / 3;
  const rt = Rb - run;
  return ((Math.PI * PIT.heapMaxH) / 3) * (Rb * Rb + Rb * rt + rt * rt);
}

export function heapRadius(V: number): number {
  if (V <= 0) return 0;
  let lo = 0, hi = 4;
  while (heapVolume(hi) < V && hi < 1e4) hi *= 2;
  for (let i = 0; i < 48; i++) {
    const m = (lo + hi) / 2;
    if (heapVolume(m) < V) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

/** m³ of one decimetre on one sample (the bilinear surface's tent over a 4 m cell) */
const DM_M3 = 0.1 * CELL_M * CELL_M;

// ───────────────────────────── the pit ─────────────────────────────

/** The bench a wall of continuous depth w (m) is cut to: 2 m steps. */
const bench = (w: number) => (w <= 0 ? 0 : PIT.bench * Math.floor(w / PIT.bench + 0.5));

let nCand = 0;

/** Gather the samples a pit may cut within rHi of its centre. */
function gatherPit(hf: Heightfield, win: Win, p: PitShape, rHi: number) {
  nCand = 0;
  const r2 = rHi * rHi;
  const Lr = p.L * PIT.rampRun;
  for (let lz = 0; lz < win.h; lz++) {
    const iz = win.z0 + lz, z = sx(iz), dz = z - p.cz;
    if (dz * dz > r2) continue;
    for (let lx = 0; lx < win.w; lx++) {
      const l = lz * win.w + lx;
      if (blocked[l]) continue;
      const ix = win.x0 + lx, x = sx(ix), dx = x - p.cx;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const k = iz * N + ix;
      const cur = hf.delta[k];
      if (cur > 0) continue; // a heap sample (never ours to cut)
      cIdx[nCand] = k;
      cRho[nCand] = Math.sqrt(d2);
      cCap[nCand] = dist[l] / 2;
      cCur[nCand] = -cur;
      // the ramp's band: 8 m wide along its line, within 4L below its top (tested per R)
      const ax = x - p.ox, az = z - p.oz;
      const along = ax * p.ux + az * p.uz;
      const perp = Math.abs(-ax * p.uz + az * p.ux);
      cAlong[nCand] = perp <= PIT.rampHalfW && along >= -Lr - 8 ? along : NaN;
      nCand++;
    }
  }
}

/** The ramp's top for rim radius R: the farthest along its line the wall cuts. */
function rampTop(p: PitShape, R: number): number {
  let A = p.A;
  for (let i = 0; i < nCand; i++) {
    const a = cAlong[i];
    if (a !== a || a <= A) continue; // NaN: not in the band
    if (bench(Math.min((R - cRho[i]) / 2, cCap[i])) > 0) A = a;
  }
  return A;
}

/** Target depth (dm) of candidate i at rim radius R and ramp top A. */
function pitTarget(i: number, p: PitShape, Ldm: number, R: number, A: number): number {
  let t = Math.min(Math.round(bench(Math.min((R - cRho[i]) / 2, cCap[i])) * 10), Ldm);
  if (t <= 0) return 0;
  const a = cAlong[i];
  if (a === a && a <= A && a >= A - p.L * PIT.rampRun) {
    t = Math.min(t, Math.round(((A - a) / PIT.rampRun) * 10));
  }
  return t;
}

/** m³ a carve at rim radius R would add. */
function pitAdded(p: PitShape, Ldm: number, R: number): number {
  const A = rampTop(p, R);
  let dm = 0;
  for (let i = 0; i < nCand; i++) {
    const t = pitTarget(i, p, Ldm, R, A);
    if (t > cCur[i]) dm += t - cCur[i];
  }
  return dm * DM_M3;
}

/** Is the window sample nearest (x, z) one of this pit's own, unblocked? */
function ownAt(win: Win, x: number, z: number): boolean {
  const lx = nearest(x) - win.x0, lz = nearest(z) - win.z0;
  if (lx < 0 || lz < 0 || lx >= win.w || lz >= win.h) return false;
  const l = lz * win.w + lx;
  return own[l] === 1 && blocked[l] === 0;
}

/** Grow away: where past the rim the ground is blocked, push the centre the
 *  other way by up to `dR` (the rim's advance for this carve). A pit blocked
 *  on half its rim drifts about dR, keeping its blocked side where it is. */
function drift(win: Win, p: PitShape, dR: number): void {
  if (dR <= 0 || p.anchor < 0) return;
  let bx = 0, bz = 0;
  const K = PIT.probes;
  for (let k = 0; k < K; k++) {
    const a = (2 * Math.PI * k) / K;
    const ux = Math.cos(a), uz = Math.sin(a);
    let run = PIT.probeM;
    for (let m = CELL_M; m <= PIT.probeM; m += CELL_M) {
      const x = p.cx + ux * (p.R + m), z = p.cz + uz * (p.R + m);
      const lx = nearest(x) - win.x0, lz = nearest(z) - win.z0;
      const out = lx < 0 || lz < 0 || lx >= win.w || lz >= win.h;
      // blocked, or too close to a blocker for another bench there
      if (out || dist[lz * win.w + lx] < 2 * CELL_M) { run = m - CELL_M; break; }
    }
    const b = 1 - run / PIT.probeM;
    bx -= b * ux;
    bz -= b * uz;
  }
  const mag = Math.sqrt(bx * bx + bz * bz);
  if (mag < 0.5) return;
  let step = dR * Math.min(1, mag / (K / Math.PI));
  for (let tries = 0; tries < 4; tries++, step /= 2) {
    const nx = p.cx + (bx / mag) * step, nz = p.cz + (bz / mag) * step;
    // the centre stays over its own cut, so the pit stays one hole
    if (ownAt(win, nx, nz)) { p.cx = nx; p.cz = nz; return; }
  }
}

/** Cut a pit toward `addM3` more of volume (never past it): drift its centre
 *  away from blocked sides by up to `dR`, solve its rim radius, write the
 *  grid. Mutates `p` (centre, R, A, anchor). */
export function carvePit(hf: Heightfield, p: PitShape, bl: Blockers, addM3: number, dR: number): CarveResult {
  const res: CarveResult = { added: 0, changed: 0, ix0: N, iz0: N, ix1: -1, iz1: -1, extreme: 0 };
  if (addM3 <= 0) return res;
  const Rfree = pitRadius(addM3 + pitVolume(p.R, p.L), p.L);
  const rHi = Math.min(140, Math.max(p.R, Rfree) * 1.5 + 12);
  const win = windowAt(p.cx, p.cz, rHi + dR + 2 * p.L + 2 * CELL_M);
  ensure(win.w * win.h, Math.max(win.w, win.h));
  floodOwn(hf, win, p.anchor, -1);
  buildMask(hf, win, bl, 'dig');
  distances(win);
  drift(win, p, dR);
  gatherPit(hf, win, p, rHi);
  const Ldm = Math.round(p.L * 10);
  let R = rHi;
  if (pitAdded(p, Ldm, rHi) > addM3) {
    // the largest R that adds no more than was dug (what is left carries over)
    let lo = 0, hi = rHi;
    for (let i = 0; i < 22; i++) {
      const m = (lo + hi) / 2;
      if (pitAdded(p, Ldm, m) <= addM3) lo = m; else hi = m;
    }
    R = lo;
  }
  const A = rampTop(p, R);
  let dm = 0, deepK = -1, deep = 0;
  for (let i = 0; i < nCand; i++) {
    const t = pitTarget(i, p, Ldm, R, A);
    const k = cIdx[i];
    if (t > deep) { deep = t; deepK = k; }
    if (t <= cCur[i]) continue;
    dm += t - cCur[i];
    hf.setDelta(k, -t);
    res.changed++;
    const ix = k % N, iz = (k - ix) / N;
    if (ix < res.ix0) res.ix0 = ix; if (ix > res.ix1) res.ix1 = ix;
    if (iz < res.iz0) res.iz0 = iz; if (iz > res.iz1) res.iz1 = iz;
  }
  res.added = dm * DM_M3;
  res.extreme = deep / 10;
  if (res.changed) {
    p.R = Math.max(R, 0);
    p.A = A;
    if (p.anchor < 0 || hf.delta[p.anchor] >= 0) p.anchor = deepK;
    hf.carved.push(res.ix0 - 1, res.iz0 - 1, res.ix1, res.iz1);
  }
  return res;
}

// ───────────────────────────── the heap ─────────────────────────────

/** Dump toward `addM3` more spoil on a heap (never past it). Mutates `h`. */
export function dumpHeap(hf: Heightfield, h: HeapShape, bl: Blockers, addM3: number): CarveResult {
  const res: CarveResult = { added: 0, changed: 0, ix0: N, iz0: N, ix1: -1, iz1: -1, extreme: 0 };
  if (addM3 <= 0) return res;
  const rHi = Math.min(120, Math.max(h.Rh, heapRadius(addM3 + heapVolume(h.Rh))) * 1.5 + 8);
  const win = windowAt(h.hx, h.hz, rHi + 2 * CELL_M);
  ensure(win.w * win.h, Math.max(win.w, win.h));
  floodOwn(hf, win, h.anchor, 1);
  buildMask(hf, win, bl, 'dump');
  distances(win);
  nCand = 0;
  const r2 = rHi * rHi;
  for (let lz = 0; lz < win.h; lz++) {
    const iz = win.z0 + lz, dz = sx(iz) - h.hz;
    for (let lx = 0; lx < win.w; lx++) {
      const l = lz * win.w + lx;
      if (blocked[l]) continue;
      const ix = win.x0 + lx, dx = sx(ix) - h.hx;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const k = iz * N + ix;
      if (hf.delta[k] < 0) continue;
      cIdx[nCand] = k; cRho[nCand] = Math.sqrt(d2); cCap[nCand] = dist[l]; cCur[nCand] = hf.delta[k];
      nCand++;
    }
  }
  const Hdm = Math.round(PIT.heapMaxH * 10);
  const target = (i: number, Rb: number) =>
    Math.max(0, Math.min(Hdm, Math.round(Math.min(Rb - cRho[i], cCap[i]) * PIT.heapSlope * 10)));
  const added = (Rb: number) => {
    let dm = 0;
    for (let i = 0; i < nCand; i++) { const t = target(i, Rb); if (t > cCur[i]) dm += t - cCur[i]; }
    return dm * DM_M3;
  };
  let Rb = rHi;
  if (added(rHi) > addM3) {
    let lo = 0, hi = rHi;
    for (let i = 0; i < 22; i++) {
      const m = (lo + hi) / 2;
      if (added(m) <= addM3) lo = m; else hi = m;
    }
    Rb = lo;
  }
  let dm = 0, topK = -1, top = 0;
  for (let i = 0; i < nCand; i++) {
    const t = target(i, Rb);
    const k = cIdx[i];
    if (t > top) { top = t; topK = k; }
    if (t <= cCur[i]) continue;
    dm += t - cCur[i];
    hf.setDelta(k, t);
    res.changed++;
    const ix = k % N, iz = (k - ix) / N;
    if (ix < res.ix0) res.ix0 = ix; if (ix > res.ix1) res.ix1 = ix;
    if (iz < res.iz0) res.iz0 = iz; if (iz > res.iz1) res.iz1 = iz;
  }
  res.added = dm * DM_M3;
  res.extreme = top / 10;
  if (res.changed) {
    h.Rh = Rb;
    if (h.anchor < 0 || hf.delta[h.anchor] <= 0) h.anchor = topK;
    hf.carved.push(res.ix0 - 1, res.iz0 - 1, res.ix1, res.iz1);
  }
  return res;
}

// ───────────────────────────── staking ─────────────────────────────

/** Where a pit opens for a dig at (x, z): the nearest free ground (§8.6), on
 *  the side away from `away` (the base's heart), on the dig's deposit if it
 *  is on one (`onDeposit`), with room to open to its floor (clear 2L + 4 m
 *  round it) and, best, to its plan radius. Null: nowhere near is free. */
export function stakePit(
  hf: Heightfield, bl: Blockers, x: number, z: number, L: number, planR: number,
  away: { x: number; z: number } | null, onDeposit: ((x: number, z: number) => boolean) | null,
): { x: number; z: number; clear: number } | null {
  const reach = PIT.stakeMaxM;
  const win = windowAt(x, z, reach + 2 * L + 3 * CELL_M);
  ensure(win.w * win.h, Math.max(win.w, win.h));
  own.fill(0, 0, win.w * win.h);
  buildMask(hf, win, bl, 'dig', true);
  distances(win);
  const need = 2 * L + CELL_M;
  let ax = 0, az = 0;
  if (away) { const d = Math.hypot(away.x - x, away.z - z); if (d > 1) { ax = (away.x - x) / d; az = (away.z - z) / d; } }
  let best: { x: number; z: number; clear: number } | null = null, bestS = Infinity;
  let fall: { x: number; z: number; clear: number } | null = null, fallS = -Infinity;
  const ANG = 24;
  for (let d = 0; d <= reach; d += CELL_M) {
    const n = d === 0 ? 1 : ANG;
    for (let a = 0; a < n; a++) {
      const th = (2 * Math.PI * a) / ANG;
      const px = x + Math.cos(th) * d, pz = z + Math.sin(th) * d;
      const lx = nearest(px) - win.x0, lz = nearest(pz) - win.z0;
      if (lx < 0 || lz < 0 || lx >= win.w || lz >= win.h) continue;
      const clear = dist[lz * win.w + lx];
      if (clear > fallS) { fallS = clear; fall = { x: px, z: pz, clear }; }
      if (clear < need) continue;
      let score = d;
      if (d > 0) score += 8 * (Math.cos(th) * ax + Math.sin(th) * az); // toward the base costs
      if (onDeposit && !onDeposit(px, pz)) score += 20;
      if (clear < planR) score += 0.5 * (planR - clear);
      if (score < bestS - 1e-9) { bestS = score; best = { x: px, z: pz, clear }; }
    }
  }
  if (best) return best;
  // a shallow pit where nothing deeper fits
  return fall && fall.clear >= 2 * CELL_M ? fall : null;
}

/** Where a pit's heap goes (§8.4): beside it, just outside its plan ring, a
 *  quarter turn from its gate by preference, but first on the side away from
 *  structures and roads (the greatest clearance from them). */
export function stakeHeap(
  hf: Heightfield, bl: Blockers, pit: { x: number; z: number; gateX: number; gateZ: number }, planR: number, heapR: number,
): { x: number; z: number } {
  const D0 = planR + heapR + 2 * CELL_M;
  const win = windowAt(pit.x, pit.z, D0 + 16 + heapR + 3 * CELL_M);
  ensure(win.w * win.h, Math.max(win.w, win.h));
  own.fill(0, 0, win.w * win.h);
  buildMask(hf, win, bl, 'dump', true);
  // the pit's own plan ring is no place for spoil either
  for (let lz = 0; lz < win.h; lz++) {
    for (let lx = 0; lx < win.w; lx++) {
      const dx = sx(win.x0 + lx) - pit.x, dz = sx(win.z0 + lz) - pit.z;
      if (dx * dx + dz * dz <= (planR + CELL_M) ** 2) blocked[lz * win.w + lx] = 1;
    }
  }
  distances(win);
  // clearance from structures and roads (not from terrain masks): the "away" score
  const awayOf = (x: number, z: number) => {
    let m = Infinity;
    for (const p of bl.pads) {
      const x0 = p.gx0 * CELL_M - HALF, x1 = p.gx1 * CELL_M - HALF, z0 = p.gz0 * CELL_M - HALF, z1 = p.gz1 * CELL_M - HALF;
      const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
      m = Math.min(m, Math.sqrt(dx * dx + dz * dz));
    }
    for (const key of bl.cells) {
      const cx = (key % MAP_CELLS + 0.5) * CELL_M - HALF, cz = (Math.floor(key / MAP_CELLS) + 0.5) * CELL_M - HALF;
      const dx = cx - x, dz = cz - z;
      m = Math.min(m, Math.sqrt(dx * dx + dz * dz));
    }
    return m;
  };
  const gate = Math.atan2(pit.gateZ, pit.gateX);
  let best: { x: number; z: number } | null = null, bestS = -Infinity;
  for (const D of [D0, D0 + 8, D0 + 16]) {
    for (let a = 0; a < 16; a++) {
      const th = (2 * Math.PI * a) / 16;
      const x = pit.x + Math.cos(th) * D, z = pit.z + Math.sin(th) * D;
      const lx = nearest(x) - win.x0, lz = nearest(z) - win.z0;
      if (lx < 0 || lz < 0 || lx >= win.w || lz >= win.h) continue;
      const clear = dist[lz * win.w + lx];
      if (clear < CELL_M) continue;
      const quarter = Math.abs(Math.cos(th - gate)); // 0 a quarter turn from the gate
      const score = Math.min(awayOf(x, z), 80) + Math.min(clear, heapR) * 1.5 - 6 * quarter - (D - D0) * 0.25;
      if (score > bestS + 1e-9) { bestS = score; best = { x, z }; }
    }
    if (best && bestS > 0) break;
  }
  return best ?? { x: pit.x + Math.cos(gate + Math.PI / 2) * D0, z: pit.z + Math.sin(gate + Math.PI / 2) * D0 };
}

// ───────────────────────────── cells ─────────────────────────────

/** The cells a pit's cut touches (any corner one of its own samples, flooded
 *  from `anchor` inside the sample bounds), grown by `ring` cells: its zone
 *  (core/zones.ts). Sorted cell keys. */
export function pitCells(hf: Heightfield, anchor: number, ix0: number, iz0: number, ix1: number, iz1: number, ring = 1): number[] {
  if (anchor < 0 || ix1 < ix0) return [];
  const x0 = Math.max(0, ix0 - 2), z0 = Math.max(0, iz0 - 2);
  const win: Win = { x0, z0, w: Math.min(N - 1, ix1 + 2) - x0 + 1, h: Math.min(N - 1, iz1 + 2) - z0 + 1 };
  ensure(win.w * win.h, Math.max(win.w, win.h));
  floodOwn(hf, win, anchor, -1);
  const mark = new Set<number>();
  for (let lz = 0; lz < win.h; lz++) {
    for (let lx = 0; lx < win.w; lx++) {
      if (!own[lz * win.w + lx]) continue;
      const ix = win.x0 + lx, iz = win.z0 + lz;
      // a sample is a corner of the four cells round it
      for (let gz = iz - 1 - ring; gz <= iz + ring; gz++) {
        for (let gx = ix - 1 - ring; gx <= ix + ring; gx++) {
          if (gx < 0 || gz < 0 || gx >= MAP_CELLS || gz >= MAP_CELLS) continue;
          mark.add(gz * MAP_CELLS + gx);
        }
      }
    }
  }
  return [...mark].sort((a, b) => a - b);
}

/** Take the cell rects the pits changed since the last call (the renderer:
 *  chunks, rocks, the overlay). Calls `fn(gx0, gz0, gx1, gz1)` per rect. */
export function takeCarved(hf: Heightfield, fn: (gx0: number, gz0: number, gx1: number, gz1: number) => void): number {
  const a = hf.carved;
  const n = a.length / 4;
  for (let i = 0; i < a.length; i += 4) fn(a[i], a[i + 1], a[i + 2], a[i + 3]);
  a.length = 0;
  return n;
}

/** Reclaim's hook (Phase 4, docs/17 §12.2): the one writer allowed to raise a
 *  carved sample, to `dm` (never above the ground it was cut from). */
export function raiseCut(hf: Heightfield, k: number, dm: number) {
  const cur = hf.delta[k];
  if (cur >= 0) return;
  hf.setDelta(k, Math.min(0, Math.max(cur, dm)));
  const ix = k % N, iz = (k - ix) / N;
  hf.carved.push(ix - 1, iz - 1, ix, iz);
}

// ───────────────────────────── the look ─────────────────────────────

/** The cut's and the heap's tone (§20), a multiplier on the ground's colour:
 *  fresh regolith is brighter than the weathered surface round it, fading in
 *  over the first 2 m of the rim; every other bench a shade brighter still, so
 *  the terraces read from the isometric view. Graded ground is plain. */
export function cutTone(hf: Heightfield, ix: number, iz: number): number {
  const k = Math.min(Math.max(iz, 0), N - 1) * N + Math.min(Math.max(ix, 0), N - 1);
  const d = hf.delta[k];
  if (d === 0 || hf.padMask[k]) return 1;
  if (d > 0) return 1 + PIT.heapBright * Math.min(1, d / 10);
  const depth = -d / 10;
  const band = Math.floor(depth / PIT.bench + 0.5) % 2 === 1 ? PIT.benchBand : 0;
  return 1 + PIT.cutBright * Math.min(1, depth / 2) + band;
}

// ───────────────────────────── saving ─────────────────────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: Uint8Array, n: number): string {
  let out = '';
  for (let i = 0; i < n; i += 3) {
    const a = bytes[i], b = i + 1 < n ? bytes[i + 1] : 0, c = i + 2 < n ? bytes[i + 2] : 0;
    const v = (a << 16) | (b << 8) | c;
    out += B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + (i + 1 < n ? B64[(v >> 6) & 63] : '=') + (i + 2 < n ? B64[v & 63] : '=');
  }
  return out;
}

function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const v = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1] ?? 'A') << 12)
      | ((i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : 0) << 6) | (i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : 0);
    if (o < out.length) out[o++] = (v >> 16) & 255;
    if (o < out.length && i + 2 < clean.length) out[o++] = (v >> 8) & 255;
    if (o < out.length && i + 3 < clean.length) out[o++] = v & 255;
  }
  return out.subarray(0, o);
}

/** The grid as sorted (index gap, value) pairs: varint gaps, int16 values
 *  (little-endian), base64 (§11.5). '' when nothing is carved. */
export function encodeDelta(delta: Int16Array): string {
  let n = 0;
  for (let k = 0; k < delta.length; k++) if (delta[k] !== 0) n++;
  if (!n) return '';
  const bytes = new Uint8Array(n * 5);
  let o = 0, prev = -1;
  for (let k = 0; k < delta.length; k++) {
    const v = delta[k];
    if (v === 0) continue;
    let gap = k - prev;
    prev = k;
    while (gap >= 0x80) { bytes[o++] = (gap & 0x7f) | 0x80; gap >>>= 7; }
    bytes[o++] = gap;
    bytes[o++] = v & 255;
    bytes[o++] = (v >> 8) & 255;
  }
  return toBase64(bytes, o);
}

/** Decode a saved grid: calls `put(index, dm)` for every carved or heaped sample. */
export function decodeDelta(s: string, put: (k: number, dm: number) => void): number {
  if (!s) return 0;
  const bytes = fromBase64(s);
  let i = 0, k = -1, n = 0;
  while (i < bytes.length) {
    let gap = 0, shift = 0;
    for (;;) {
      const b = bytes[i++];
      gap |= (b & 0x7f) << shift;
      if (!(b & 0x80)) break;
      shift += 7;
    }
    k += gap;
    if (i + 1 >= bytes.length) break;
    const lo = bytes[i++], hi = bytes[i++];
    let v = lo | (hi << 8);
    if (v & 0x8000) v -= 0x10000;
    if (k >= 0 && k < N * N) { put(k, v); n++; }
  }
  return n;
}
