/** Ore (docs/17 §9, §10, §13; Phase 4): grade, the ore halo, the cutoff,
 *  reserves, faces and the survey's estimate. Pure functions of the seed,
 *  the deposit and the pit's shape: nothing here is stored (§10.5).
 *
 *  - **Grade.** q is a load's grade against its hub's recipe reference. A
 *    deposit is rich at its centre and falls to plain ground at 1.3 × its
 *    ring: g(ρ) = plain + (centre − plain) × max(0, 1 − (ρ / 1.3 r)²).
 *  - **The cut.** A pit's grade is the mean over the wall it is cutting:
 *    the cone while it opens, then the band R − 2L … R round its centre as
 *    it widens. So a pit starts rich and gets leaner as it grows: the lean
 *    tail is the geometry. Bedrock benches (Deep Coring) cut the floor: 80%
 *    of the grade above it.
 *  - **Reserves.** A deposit is dug out when its cut falls to the cutoff
 *    (plain + 15% of its enrichment). Its ore is every tonne a round pit at
 *    its centre cuts until then: the full-size pit, R_full.
 *  - **Faces.** floor(free rim / 30 m), 1–6: a small pit holds few diggers.
 *  - **The survey** shows ore and centre grade to ±precision, its centre
 *    off the truth by a seeded share of up to half of it: the truth is
 *    always inside the range.
 *
 *  Phase 5 reads these: `reservesOf`, `faceCapacity` (core/pits.ts),
 *  `gradeAtPoint` and `surveyPrecision`. */
import { PIT } from '../data/balance';
import type { BuildingId } from '../data/buildings';
import type { DepositKind } from '../data/deposits';
import { FACES, GRADE, ORE_PROCESS, SIZE_CLASS, type Ground, type Process } from '../data/ore';
import type { SiteDef, SiteId } from '../data/sites';
import type { Deposit } from '../terrain/heightfield';
import { pitVolume } from '../terrain/pitCarve';
import { effectiveDef, type Mods } from './mods';
import { hashString, mulberry32 } from './rng';
import type { GameState } from './state';

/** The site's plain ground (§9.1): the pole is highland, the rest mare. */
export const groundOf = (siteId: SiteId): Ground => (siteId === 'southpole' ? 'highland' : 'mare');

/** The process a hub runs (null: not a hub). An MRE smelter melts any ground at q 1. */
export function processOf(mods: Mods, site: Pick<SiteDef, 'hasIce'>, type: BuildingId): Process | null {
  if (type === 'smelter') return effectiveDef('smelter', mods).feedInsensitive ? 'MRE' : 'H2';
  if (type === 'refinery') return 'plag';
  if (type === 'waterPlant') return site.hasIce ? 'ice' : 'soil';
  return null;
}

/** Plain ground's grade for a process at this site, before any crew or research. */
export const plainQ = (process: Process, siteId: SiteId): number => GRADE.plain[process][groundOf(siteId)];

/** The research and the crew on a load's grade: Beneficiation (H₂), ore
 *  sorting (every process), a crew high-grading plain ground (§9.3). */
export function gradeMult(s: Pick<GameState, 'crew'>, mods: Mods, process: Process, plain: boolean): number {
  if (process === 'MRE') return 1;
  let m = mods.gradeAll * (process === 'H2' ? mods.gradeH2 : 1);
  if (plain && process !== 'ice' && s.crew >= GRADE.crewMin) m *= GRADE.crew;
  return m;
}

// ───────────────────────────── a deposit's ore, from the seed ─────────────────────────────

export interface OreProfile {
  id: string;
  kind: DepositKind;
  cx: number; cz: number; r: number;
  /** the process its ore is measured in (null: no ore bed — KREEP, a peak of light) */
  process: Process | null;
  /** the loose layer's depth, m (§8.5): the floor a pit widens at */
  L: number;
  /** centre grade per process (q); a process not named sees plain ground */
  centre: Partial<Record<Process, number>>;
  /** the survey's seeded offsets (−1…1): its estimate sits off the truth by up to half the precision */
  offOre: number; offGrade: number;
}

const profiles = new Map<string, OreProfile>();

/** The loose layer's range for a kind of ground (§8.5). */
export function looseRange(kind: DepositKind | null | undefined, siteId: SiteId): readonly [number, number] {
  if (kind === 'anorthosite') return PIT.looseHighland;
  if (kind === 'ice') return PIT.looseIce;
  if (kind === 'volatiles') return PIT.looseVolatiles;
  if (kind) return PIT.looseMare;
  return siteId === 'southpole' ? PIT.looseHighland : PIT.looseMare;
}

/** A deposit's ore (§10.1): its loose layer, centre grades and survey offsets,
 *  derived from (seed, deposit id). Memoised. */
export function profileOf(s: Pick<GameState, 'seed' | 'siteId'>, d: Deposit): OreProfile {
  const key = `${s.seed}|${s.siteId}|${d.id}`;
  const hit = profiles.get(key);
  if (hit) return hit;
  const rng = mulberry32((s.seed ^ 0x7e5e ^ hashString(d.id)) >>> 0);
  const [l0, l1] = d.kind === 'ice' && d.id === 'ice-0' ? [5, 6] : looseRange(d.kind, s.siteId);
  const L = Math.round((l0 + rng() * (l1 - l0)) * 10) / 10;
  const centre: Partial<Record<Process, number>> = {};
  for (const proc of ['H2', 'plag', 'ice', 'soil'] as Process[]) {
    let range = GRADE.centre[d.kind]?.[proc];
    if (proc === 'ice' && d.kind === 'ice' && d.id === 'ice-0') range = GRADE.starterIce;
    const u = rng(); // drawn whether or not the kind names it: a stable stream
    if (range) centre[proc] = Math.round((range[0] + u * (range[1] - range[0])) * 1000) / 1000;
  }
  const p: OreProfile = {
    id: d.id, kind: d.kind, cx: d.cx, cz: d.cz, r: d.r, process: ORE_PROCESS[d.kind] ?? null, L, centre,
    offOre: rng() * 2 - 1, offGrade: rng() * 2 - 1,
  };
  if (profiles.size > 512) profiles.clear();
  profiles.set(key, p);
  return p;
}

/** Centre grade of a deposit for a process (plain when the kind does not name it). */
export function centreQ(p: OreProfile, process: Process, siteId: SiteId): number {
  if (process === 'MRE') return 1;
  return p.centre[process] ?? plainQ(process, siteId);
}

/** The ore halo's share at ρ from the centre: 1 there, 0 at 1.3 × the ring. */
export function haloShare(p: Pick<OreProfile, 'r'>, rho: number): number {
  const c = GRADE.halo * p.r;
  return Math.max(0, 1 - (rho / c) ** 2);
}

/** The grade (q, before crew and research) at world (x, z) of one deposit's halo. */
export function gradeOf(p: OreProfile, process: Process, siteId: SiteId, x: number, z: number): number {
  if (process === 'MRE') return 1;
  const gp = plainQ(process, siteId);
  return gp + (centreQ(p, process, siteId) - gp) * haloShare(p, Math.hypot(x - p.cx, z - p.cz));
}

/** The grade (q, before crew and research) at a world point: the richest halo
 *  there, else plain ground (Phase 5's "grade at a point"). */
export function gradeAtPoint(s: Pick<GameState, 'seed' | 'siteId'>, deps: readonly Deposit[], process: Process, x: number, z: number): number {
  if (process === 'MRE') return 1;
  let best = plainQ(process, s.siteId);
  for (const d of deps) {
    const p = profileOf(s, d);
    if (Math.hypot(x - p.cx, z - p.cz) >= GRADE.halo * p.r) continue;
    const g = gradeOf(p, process, s.siteId, x, z);
    if (g > best) best = g;
  }
  return best;
}

/** The cutoff (q): plain + 15% of the enrichment. Null: no enrichment, no ore. */
export function cutoffQ(p: OreProfile, siteId: SiteId): number | null {
  if (!p.process) return null;
  const gp = plainQ(p.process, siteId), gc = centreQ(p, p.process, siteId);
  if (gc <= gp + 1e-9) return null;
  return gp + GRADE.cutoff * (gc - gp);
}

// ───────────────────────────── the cut ─────────────────────────────

/** Where a pit stands, for its grade: its centre now, its rim, its loose layer, and bedrock. */
export interface CutShape { cx: number; cz: number; R: number; L: number; rock?: boolean }

/** The mean grade across the wall a pit is cutting (§10.1): the cone while it
 *  opens, then the band R − 2L … R round its centre (area-weighted, sampled on
 *  equal-area rings); on bedrock benches the floor's disc × 0.8. */
export function cutGrade(p: OreProfile, process: Process, siteId: SiteId, c: CutShape): number {
  if (process === 'MRE') return 1;
  const R = Math.max(c.R, 1);
  let a = Math.max(0, R - 2 * c.L), b = R;
  if (c.rock) { b = Math.max(1, R - 2 * c.L); a = 0; }
  const NR = 4, NA = 16;
  let sum = 0;
  for (let i = 0; i < NR; i++) {
    const rho = Math.sqrt(a * a + (b * b - a * a) * ((i + 0.5) / NR));
    for (let k = 0; k < NA; k++) {
      const th = ((k + 0.5) / NA) * Math.PI * 2;
      sum += gradeOf(p, process, siteId, c.cx + Math.cos(th) * rho, c.cz + Math.sin(th) * rho);
    }
  }
  const g = sum / (NR * NA);
  return c.rock ? g * GRADE.bedrock : g;
}

/** The mean halo share over the annulus a … b round the centre (closed form). */
function haloMean(p: Pick<OreProfile, 'r'>, a: number, b: number): number {
  const c = GRADE.halo * p.r;
  const F = (rho: number) => { const m = Math.min(rho, c); return (m * m) / 2 - (m ** 4) / (4 * c * c); };
  const area = (b * b - a * a) / 2;
  return area > 1e-9 ? (F(b) - F(a)) / area : haloShare(p, a);
}

/** The full-size pit (§10.1): the rim radius at which a round pit at the
 *  deposit's centre cuts at the cutoff. 0: no ore bed. */
export function fullRadius(p: OreProfile, siteId: SiteId): number {
  if (cutoffQ(p, siteId) === null) return 0;
  const share = (R: number) => haloMean(p, Math.max(0, R - 2 * p.L), R);
  let lo = 0, hi = GRADE.halo * p.r + 2 * p.L + 4;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (share(m) > GRADE.cutoff) lo = m; else hi = m;
  }
  return Math.round(((lo + hi) / 2) * 10) / 10;
}

export interface OreTruth {
  /** ▲ of ore (every tonne the full-size pit cuts), its mean q, R_full */
  ore: number; q: number; fullR: number;
  /** the centre grade (q) in its process, and the process */
  centre: number; process: Process;
}

const truths = new Map<string, OreTruth | null>();

/** What a deposit really holds (null: no ore bed). Memoised. */
export function oreTruth(s: Pick<GameState, 'seed' | 'siteId'>, d: Deposit): OreTruth | null {
  const key = `${s.seed}|${s.siteId}|${d.id}`;
  if (truths.has(key)) return truths.get(key)!;
  const p = profileOf(s, d);
  let out: OreTruth | null = null;
  if (p.process && cutoffQ(p, s.siteId) !== null) {
    const R = fullRadius(p, s.siteId);
    const vol = pitVolume(R, p.L);
    // the mean grade of it all: each ring's depth × its grade
    let wq = 0, w = 0;
    const n = 64;
    for (let i = 0; i < n; i++) {
      const rho = ((i + 0.5) / n) * R;
      const depth = Math.min(p.L, (R - rho) / 2);
      const wt = depth * rho;
      wq += gradeOf(p, p.process, s.siteId, p.cx + rho, p.cz) * wt;
      w += wt;
    }
    out = { ore: vol * PIT.tPerM3, q: w > 0 ? wq / w : centreQ(p, p.process, s.siteId), fullR: R, centre: centreQ(p, p.process, s.siteId), process: p.process };
  }
  if (truths.size > 512) truths.clear();
  truths.set(key, out);
  return out;
}

/** Bedrock ore under a floor (§8.5): the frustum `depth` m below a floor of radius R − 2L, ▲. */
export function bedrockOre(R: number, L: number, depth: number): number {
  if (depth <= 0) return 0;
  const r1 = Math.max(0, R - 2 * L), r2 = Math.max(0, r1 - 2 * depth);
  return ((Math.PI * depth) / 3) * (r1 * r1 + r1 * r2 + r2 * r2) * PIT.tPerM3;
}

// ───────────────────────────── faces ─────────────────────────────

/** Faces a rim holds (§8.2): floor(free rim / 30 m), 1–6. */
export function facesFor(R: number, free = 1): number {
  return Math.max(1, Math.min(FACES.max, Math.floor((2 * Math.PI * Math.max(0, R) * Math.max(0, Math.min(1, free))) / FACES.perM)));
}

/** The rim radius at which a round pit opens its n-th face. */
export const faceOpensAt = (n: number, free = 1): number => (n * FACES.perM) / (2 * Math.PI * Math.max(1e-6, free));

// ───────────────────────────── the survey ─────────────────────────────

/** The precision a survey reads to now (±share): ±30%, ±15% with Sample-Return Caches, ±5% with Gravity Gradiometry. */
export const surveyPrecision = (mods: Pick<Mods, 'surveyPrecision'>): number => mods.surveyPrecision;

export interface OreEstimate {
  /** ▲ of ore, as read (and the range at its precision) */
  ore: number; lo: number; hi: number;
  /** centre grade (q), as read, and its range */
  centre: number; centreLo: number; centreHi: number;
  precision: number;
}

/** A survey's reading of a deposit at a precision: its centre off the truth by
 *  a seeded share of up to half the precision, so the truth is always inside. */
export function estimateOf(s: Pick<GameState, 'seed' | 'siteId'>, d: Deposit, precision: number): OreEstimate | null {
  const t = oreTruth(s, d);
  if (!t) return null;
  const p = profileOf(s, d);
  const ore = t.ore * (1 + p.offOre * precision * 0.5);
  const centre = t.centre * (1 + p.offGrade * precision * 0.5);
  return {
    ore, lo: ore * (1 - precision), hi: ore * (1 + precision),
    centre, centreLo: centre * (1 - precision), centreHi: centre * (1 + precision), precision,
  };
}

/** A mapped deposit's size class before its survey (§13.1). */
export function sizeClass(d: Pick<Deposit, 'r'>): string {
  const a = Math.PI * d.r * d.r;
  return a < SIZE_CLASS.patch ? 'a small patch' : a >= SIZE_CLASS.broad ? 'a broad bed' : 'a bed';
}

/** The measure a grade reads as: '11% ilmenite', '7.5 wt% ice'. */
export function measureText(process: Process, q: number): string {
  const v = q * GRADE.ref[process];
  const txt = v >= 20 ? Math.round(v).toString() : v >= 10 ? v.toFixed(0) : v.toFixed(1);
  return `${txt}${GRADE.unit[process]}`;
}

/** '12.2k', '860' */
export const kilo = (t: number): string => (t >= 9950 ? `${(t / 1000).toFixed(1)}k` : t >= 1000 ? `${(t / 1000).toFixed(1)}k` : `${Math.round(t)}`);
