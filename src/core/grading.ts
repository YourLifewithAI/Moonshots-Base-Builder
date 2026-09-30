/** Box-drag grading (docs/19 S5): the player drags a rectangle of cells and
 *  the rovers level it, one cell after another, over time.
 *
 *  - **The job.** A `GradeJob` holds the rectangle's cells in the order they
 *    level (a serpentine that starts at the corner nearest the road), the
 *    height they level to (the mean of the rectangle's samples), and the
 *    rover-seconds each takes: `GRADE_JOB.cellS` × (1 + the cell's relief ÷ 2 m).
 *    The energy (2.5 stored per cell; a heap's cells × (1 + relief ÷ 2 m)) is
 *    paid when the job is queued and refunded per undone cell on Cancel.
 *    Nothing moves until a rover stands on the next cell.
 *  - **The rovers.** core/fleet.ts `dispatchGrade` gives a job one rover (two
 *    above 32 cells); core/spots.ts stands each on a cell of the job (the
 *    first on the next cell to level, the second on the one after); core/
 *    transit.ts drives them there and counts who has arrived (`Arrivals.grade`).
 *  - **The work.** Economy step 2.65 (`gradeStep`) adds each arrived rover's
 *    share of the tick (its power, its scars, Site Grading's ×2) to the job.
 *    Every time the work passes the next cell's seconds the cell levels:
 *    `hf.flatten(gx, gz, gx + 1, gz + 1, h, false)` (no skirt), a one-cell
 *    `s.flattens` entry (`noSkirt`), a share of spoil to the nearest hopper.
 *    `padMask` accrues cell by cell, so the pits and `noRoad` see the graded
 *    ground at once. The last cell appends one ordinary whole-rectangle entry
 *    (its skirt feathered once) and the job is done.
 *  - **Cancel** refunds the undone cells' energy; the levelled cells stay.
 *
 *  Pure and deterministic: the state and the heightfield in, the same out. */
import { CELL_M, GRADE_CELLS, GRADE_JOB, MAP_CELLS, MAP_M } from '../data/balance';
import type { BuildingState, GameState, GradeJob, RoverUnit } from './state';
import type { Heightfield } from '../terrain/heightfield';
import type { Mods } from './mods';
import { beyondNetwork, inNetwork } from './exploration';
import { footprintRect, centerOf } from '../buildings/instances';
import { gradePitRefusal, terrainOf } from './pits';
import { cellKey, keyCell, nearestRoad, type OffArea } from './roads';
import { capOf, weldFlareMult } from './flareEffects';
import { hopperRoom } from './hubs';
import { GRADE_BIG_CELLS } from './fleet';
import { alert } from './economy';

type Cell = [number, number];
/** a rectangle of cells [gx0, gz0, gx1, gz1): gx1 and gz1 exclusive, as `flatten` reads it */
export type GradeRect = [number, number, number, number];

const N = MAP_CELLS + 1;

/** what the box would be: the tool's preview, the action's check, the job's numbers */
export interface GradePlan {
  ok: boolean;
  /** why not ('' when ok) */
  reason: string;
  rect: GradeRect;
  cells: number;
  /** the height it levels to, m (the mean of its samples) */
  h: number;
  /** relief now, m: the highest sample less the lowest */
  relief: number;
  /** rover-seconds the whole job takes at the base rate, and each cell's, in leveling order */
  secs: number;
  cellSecs: number[];
  /** the cells, in leveling order */
  order: number[];
  /** stored energy, paid when queued */
  energy: number;
  /** cells on a tailings heap (it takes Site Grading to level them) */
  spoil: number;
  /** rovers it would take */
  rovers: number;
  /** wall-game-seconds it takes with those rovers, once they are there (Site Grading counted) */
  eta: number;
}

/** m from the middle of its cell a rover's blade still works it (it creeps on from cell to cell as it grades) */
export const GRADE_REACH_M = 6;

/** the rate every rover's work runs at: Site Grading doubles it */
export const gradeRate = (mods: Pick<Mods, 'grading'>): number => (mods.grading ? GRADE_JOB.techMult : 1);

/** rovers a job of `cells` takes: one, two above `GRADE_BIG_CELLS` (core/fleet.ts) */
export const roversFor = (cells: number): number => (cells > GRADE_BIG_CELLS ? 2 : 1);

/** The rectangle between two cells, both inclusive (a drag's corners). */
export function rectBetween(a: Cell, b: Cell): GradeRect {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]) + 1, Math.max(a[1], b[1]) + 1];
}

/** a heap sample: spoil on the ground, not yet under a pad (it takes Site Grading to level) */
const onHeap = (hf: Heightfield, k: number) => hf.delta[k] > 0 && !hf.padMask[k];

/** The cells in the order they level: rows in a serpentine, from the corner nearest `from`. */
export function levelOrder(rect: GradeRect, from: Cell | null): number[] {
  const [x0, z0, x1, z1] = rect;
  const west = !from || from[0] < (x0 + x1) / 2;
  const north = !from || from[1] < (z0 + z1) / 2;
  const out: number[] = [];
  const nz = z1 - z0, nx = x1 - x0;
  for (let r = 0; r < nz; r++) {
    const z = north ? z0 + r : z1 - 1 - r;
    const lr = (r % 2 === 0) === west; // this row runs west to east
    for (let c = 0; c < nx; c++) out.push(cellKey(lr ? x0 + c : x1 - 1 - c, z));
  }
  return out;
}

/** What a box would be, and why it cannot be ('' = it can). `mods` is what Site Grading turns on. */
export function gradePlan(
  s: GameState, hf: Heightfield, mods: Pick<Mods, 'grading'>, rect: GradeRect, opts: { energy?: boolean } = {},
): GradePlan {
  const [x0, z0, x1, z1] = rect;
  const nx = x1 - x0, nz = z1 - z0;
  const plan: GradePlan = {
    ok: false, reason: '', rect, cells: Math.max(0, nx) * Math.max(0, nz), h: 0, relief: 0, secs: 0, cellSecs: [], order: [],
    energy: 0, spoil: 0, rovers: 0, eta: 0,
  };
  if (nx < 1 || nz < 1) { plan.reason = 'Drag a box'; return plan; }
  if (x0 < 1 || z0 < 1 || x1 > MAP_CELLS - 1 || z1 > MAP_CELLS - 1) { plan.reason = 'Outside survey area'; return plan; }
  if (plan.cells > GRADE_JOB.maxCells) {
    plan.reason = `TOO BIG — ${nx}×${nz} cells; at most ${GRADE_JOB.maxCells} (${Math.round(Math.sqrt(GRADE_JOB.maxCells) * CELL_M)} m square)`;
    return plan;
  }
  // the numbers first (the preview shows them whatever refuses the box)
  let sum = 0, n = 0, lo = Infinity, hi = -Infinity;
  for (let iz = z0; iz <= z1; iz++) {
    for (let ix = x0; ix <= x1; ix++) {
      const v = hf.h[iz * N + ix];
      sum += v; n++;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  const h = sum / n;
  plan.h = h;
  plan.relief = hi - lo;
  const from = nearestRoad(s, ((x0 + x1) / 2) * CELL_M - MAP_M / 2, ((z0 + z1) / 2) * CELL_M - MAP_M / 2);
  plan.order = levelOrder(rect, from);
  let energy = 0;
  for (const key of plan.order) {
    const [gx, gz] = keyCell(key);
    let dev = 0, heap = false;
    for (let dz = 0; dz <= 1; dz++) {
      for (let dx = 0; dx <= 1; dx++) {
        const k = (gz + dz) * N + gx + dx;
        dev = Math.max(dev, Math.abs(hf.h[k] - h));
        if (onHeap(hf, k)) heap = true;
      }
    }
    const t = Math.round(GRADE_JOB.cellS * (1 + dev / GRADE_JOB.reliefM) * 100) / 100;
    plan.cellSecs.push(t);
    plan.secs += t;
    energy += GRADE_JOB.energyPerCell * (heap ? 1 + dev / GRADE_JOB.reliefM : 1);
    if (heap) plan.spoil++;
  }
  plan.secs = Math.round(plan.secs * 100) / 100;
  plan.energy = Math.ceil(energy - 1e-9);
  plan.rovers = roversFor(plan.cells);
  plan.eta = plan.secs / (gradeRate(mods) * plan.rovers);
  // what refuses it
  const rectHas = (b: BuildingState) => {
    const o = footprintRect(b);
    return x0 < o.gx1 && x1 > o.gx0 && z0 < o.gz1 && z1 > o.gz0;
  };
  if (s.buildings.some(rectHas)) { plan.reason = 'A structure is in the way'; return plan; }
  for (const j of s.gradeJobs ?? []) {
    const r = jobRect(j);
    if (x0 < r[2] && x1 > r[0] && z0 < r[3] && z1 > r[1]) { plan.reason = 'ALREADY BEING GRADED — cancel that job first'; return plan; }
  }
  // a hole is refused wherever it is: grading cannot fill it (docs/17 §11.3)
  const pit = gradePitRefusal(s, hf, x0, z0, nx, nz);
  if (pit) { plan.reason = pit; return plan; }
  if (plan.spoil > 0 && !mods.grading) {
    plan.reason = 'ON SPOIL — a tailings heap; Site Grading lets rovers level it';
    return plan;
  }
  const cx = ((x0 + x1) / 2) * CELL_M - MAP_M / 2, cz = ((z0 + z1) / 2) * CELL_M - MAP_M / 2;
  if (s.buildings.length > 0 && !inNetwork(s, cx, cz)) { plan.reason = beyondNetwork(s); return plan; }
  if (opts.energy !== false && s.powerStored < plan.energy) {
    plan.reason = `Need ${plan.energy} stored energy — have ${Math.floor(s.powerStored)}`;
    return plan;
  }
  plan.ok = true;
  return plan;
}

/** A job's rectangle (its own, or the bounds of its cells). */
export function jobRect(j: GradeJob): GradeRect {
  if (j.rect) return j.rect;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const k of j.cells) {
    const [gx, gz] = keyCell(k);
    x0 = Math.min(x0, gx); z0 = Math.min(z0, gz); x1 = Math.max(x1, gx + 1); z1 = Math.max(z1, gz + 1);
  }
  return [x0, z0, x1, z1];
}

/** Queue a box: refused with the words, or paid for and made a job. */
export function queueGrade(
  s: GameState, hf: Heightfield, mods: Pick<Mods, 'grading'>, rect: GradeRect,
): { ok: boolean; reason: string; job?: GradeJob } {
  const plan = gradePlan(s, hf, mods, rect);
  if (!plan.ok) return { ok: false, reason: plan.reason };
  s.powerStored -= plan.energy;
  const job: GradeJob = {
    id: s.nextGradeJob ?? 1, cells: plan.order, h: plan.h, done: 0, total: plan.secs, left: plan.secs,
    energy: plan.energy, rect: [...rect] as GradeRect, secs: plan.cellSecs, at: s.simTime,
  };
  s.nextGradeJob = job.id + 1;
  (s.gradeJobs ??= []).push(job);
  return { ok: true, reason: '', job };
}

/** Cancel a job: the undone cells' energy comes back; the levelled cells stay. */
export function cancelGrade(s: GameState, id: number): { ok: boolean; reason: string; refund: number } {
  const i = (s.gradeJobs ?? []).findIndex((j) => j.id === id);
  if (i < 0) return { ok: false, reason: 'NO SUCH JOB', refund: 0 };
  const j = s.gradeJobs![i];
  const undone = j.cells.length - j.done;
  const refund = j.cells.length ? Math.round((j.energy * undone / j.cells.length) * 100) / 100 : 0;
  s.powerStored += refund;
  s.gradeJobs!.splice(i, 1);
  for (const r of s.rovers ?? []) if (r.grade === id) delete r.grade;
  return { ok: true, reason: '', refund };
}

// ───────────────────────────── where the rovers stand ─────────────────────────────

/** The rovers on a job, in roster order (their rank is their place on the cells). */
export const crewOf = (s: Pick<GameState, 'rovers'>, id: number): RoverUnit[] => (s.rovers ?? []).filter((r) => r.grade === id);

/** The index (into `cells`) the rover of rank `rank` stands on: the next cell to level, then the one after. */
export const standIndex = (j: GradeJob, rank: number): number => Math.max(0, Math.min(j.cells.length - 1, j.done + rank));

/** The cell key a rover of this job stands on (its rank among the job's rovers). */
export function standOf(s: Pick<GameState, 'rovers'>, j: GradeJob, r: RoverUnit): number {
  const rank = Math.max(0, crewOf(s, j.id).indexOf(r));
  return j.cells[standIndex(j, rank)];
}

/** The way along the rows at cell index `i` (a unit vector: dx, dz), for the way a rover faces. */
export function rowDir(j: GradeJob, i: number): Cell {
  const a = keyCell(j.cells[Math.min(i, j.cells.length - 1)]);
  const b = i + 1 < j.cells.length ? keyCell(j.cells[i + 1]) : null;
  const c = i > 0 ? keyCell(j.cells[i - 1]) : null;
  const [dx, dz] = b ? [b[0] - a[0], b[1] - a[1]] : c ? [a[0] - c[0], a[1] - c[1]] : [1, 0];
  return [Math.sign(dx), Math.sign(dz)];
}

/** The ground a job's rovers work, as an off-road area with one gate (the road cell nearest it): a rover
 *  that hops from cell to cell stays in it and is not sent out to the road and back. Null: no road. */
export function gradeArea(s: GameState, j: GradeJob): OffArea | null {
  const r = jobRect(j);
  const g = nearestRoad(s, ((r[0] + r[2]) / 2) * CELL_M - MAP_M / 2, ((r[1] + r[3]) / 2) * CELL_M - MAP_M / 2);
  return g ? { id: `grade:${j.id}`, gates: [g] } : null;
}

/** Is the point on the job's ground (its rectangle, a cell round)? */
export function onGradeGround(j: GradeJob, x: number, z: number): boolean {
  const r = jobRect(j);
  const gx = (x + MAP_M / 2) / CELL_M, gz = (z + MAP_M / 2) / CELL_M;
  return gx >= r[0] - 1 && gx <= r[2] + 1 && gz >= r[1] - 1 && gz <= r[3] + 1;
}

// ───────────────────────────── the work ─────────────────────────────

/** Spoil from a levelled cell: into the nearest smelter's or refinery's hopper with room, else the pile
 *  (as the old one-click pass did, docs/17 §11.3). */
function spoilFrom(s: GameState, gx: number, gz: number) {
  const y = GRADE_JOB.spoilPerCell;
  const cx = (gx + 0.5) * CELL_M - MAP_M / 2, cz = (gz + 0.5) * CELL_M - MAP_M / 2;
  let hub: BuildingState | undefined;
  let best = Infinity;
  for (const b of s.buildings) {
    if ((b.type !== 'smelter' && b.type !== 'refinery') || !b.hub || (b.construction ?? 0) > 0 || hopperRoom(b) < y) continue;
    const [bx, bz] = centerOf(b);
    const d = Math.hypot(bx - cx, bz - cz);
    if (d < best) { best = d; hub = b; }
  }
  if (hub) hub.hub!.hopper += y;
  s.resources.regolith += y;
}

/** Level cell `i` of a job (one flatten of a cell, no skirt, and its share of spoil). */
function levelCell(s: GameState, hf: Heightfield, j: GradeJob, i: number) {
  const [gx, gz] = keyCell(j.cells[i]);
  hf.flatten(gx, gz, gx + 1, gz + 1, j.h, false);
  s.flattens.push({ x0: gx, z0: gz, x1: gx + 1, z1: gz + 1, h: j.h, noSkirt: true });
  hf.leveled.push(gx, gz, gx + 1, gz + 1);
  spoilFrom(s, gx, gz);
}

/** The last cell: one whole-rectangle entry (its interior idempotent, its skirt feathered once), the job gone. */
function finishJob(s: GameState, hf: Heightfield, j: GradeJob) {
  const [x0, z0, x1, z1] = jobRect(j);
  hf.flatten(x0, z0, x1, z1, j.h);
  s.flattens.push({ x0, z0, x1, z1, h: j.h });
  hf.leveled.push(x0, z0, x1, z1);
  s.gradeJobs = (s.gradeJobs ?? []).filter((q) => q !== j);
  for (const r of s.rovers ?? []) if (r.grade === j.id) delete r.grade;
  const nx = x1 - x0, nz = z1 - z0;
  alert(s, `GRADING DONE — ${nx}×${nz} cells levelled (${nx * nz * CELL_M * CELL_M} m²)`, 'info');
}

/** Rover-seconds of work each cell takes (its own, else an even share of the job's). */
const secsOf = (j: GradeJob, i: number): number => j.secs?.[i] ?? j.total / Math.max(1, j.cells.length);

/** Add `work` rover-seconds to a job: every cell it passes levels. Returns the cells levelled. */
export function addWork(s: GameState, hf: Heightfield, j: GradeJob, work: number): number {
  if (work <= 0 || j.cells.length === 0) return 0;
  j.left = Math.max(0, j.left - work);
  const did = j.total - j.left;
  let cum = 0;
  for (let i = 0; i < j.done; i++) cum += secsOf(j, i);
  let n = 0;
  while (j.done < j.cells.length) {
    cum += secsOf(j, j.done);
    if (j.left > 1e-9 && cum > did + 1e-9) break;
    levelCell(s, hf, j, j.done);
    j.done++;
    n++;
  }
  if (j.done >= j.cells.length) finishJob(s, hf, j);
  return n;
}

/** Level what is left of a job at once (the debug API, tests, and `gradeBox` with `instant`):
 *  no cell entries for the cells not yet done, only the whole-rectangle one. */
export function finishNow(s: GameState, hf: Heightfield, j: GradeJob) {
  for (let i = j.done; i < j.cells.length; i++) {
    const [gx, gz] = keyCell(j.cells[i]);
    spoilFrom(s, gx, gz);
  }
  j.done = j.cells.length;
  j.left = 0;
  finishJob(s, hf, j);
}

/** Economy step 2.65: the arrived rovers work their jobs. `pay(r)` is the share of the tick each gets to
 *  work at (its power: the grid's, else its pack's); the job levels every cell the work reaches. */
export function gradeStep(
  s: GameState, mods: Pick<Mods, 'grading'>, here: ReadonlyMap<number, RoverUnit[]>, pay: (r: RoverUnit) => number, dt: number,
) {
  if (!s.gradeJobs?.length) return;
  const hf = terrainOf(s);
  if (!hf) return;
  const rate = gradeRate(mods) * weldFlareMult(s);
  for (const j of [...s.gradeJobs]) {
    const team = here.get(j.id) ?? [];
    if (!team.length) continue;
    let work = 0;
    for (const r of team) {
      const share = pay(r);
      if (share <= 1e-9) continue;
      r.task = 'grade';
      work += dt * share * capOf(r) * rate;
    }
    if (work > 0) addWork(s, hf, j, work);
  }
}

/** The view the fleet panel and the debug API read: each job's progress. */
export interface GradeView {
  id: number; cells: number; done: number; secs: number; left: number; h: number; rovers: number[];
  rect: GradeRect; energy: number; eta: number;
}
export function gradeView(s: GameState, mods: Pick<Mods, 'grading'>): GradeView[] {
  return (s.gradeJobs ?? []).map((j) => {
    const crew = crewOf(s, j.id);
    const rate = gradeRate(mods) * Math.max(1, crew.length);
    return {
      id: j.id, cells: j.cells.length, done: j.done, secs: j.total, left: j.left, h: j.h, rovers: crew.map((r) => r.id),
      rect: jobRect(j), energy: j.energy, eta: j.left / rate,
    };
  });
}

/** The legacy square (`gradeAt`, the old click): the 4×4 cells at (gx, gz). */
export const squareAt = (gx: number, gz: number): GradeRect => [gx, gz, gx + GRADE_CELLS, gz + GRADE_CELLS];
