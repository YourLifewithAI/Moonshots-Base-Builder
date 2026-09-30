/** The pit's look (docs/19 S2b): what a chunk that holds a cut or a heap adds
 *  to the ground's own geometry. `decorate` is the hook terrain/chunks.ts calls
 *  last in `buildGeometry` (W0d's contract), so the ground's shading (S1a) and
 *  the pit's look never share a function.
 *
 *  Everything is baked into the chunk's vertex buffers: no extra draw call, no
 *  texture, and it rides the pits' rebuild queue (`markDirty / pump /
 *  flushQueue`), a chunk at a time. A chunk with nothing carved returns at once.
 *
 *  - **Benches.** The grid's depth (`−delta / 10`, m) is cut on the odd metres,
 *    1, 3, 5 …: a triangle that crosses one is split there, so every piece lies
 *    in one bench band and wears one flat colour. The bands alternate ochre and
 *    dark ochre from the rim in (band `i` covers `2i − 1 … 2i + 1` m, i.e.
 *    `floor(depth / PIT.bench + 0.5)`, the bench index of carve `bench()`); the
 *    floor, the flat triangles at the pit's floor depth, has its own tone. The
 *    cel ground program (world/celSurface.ts) quantises the light to two steps
 *    and posterises brightness in linear steps of 0.014: the palette's tones
 *    are at least ten steps apart in luminance, so benches stay distinct
 *    through both.
 *  - **Contours.** Where a triangle is split, a ribbon `PIT.benchBand` wide
 *    (0.25 m) is laid along the cut, `PIT.contourLift` (0.05 m) proud of the
 *    face, in the cut's own dark: one ring per bench, so the ribbons' levels
 *    number the benches (the floor's toe counts). The width is a world
 *    constant: about 3 px at the home zoom, under 1 px at 830 m, where the
 *    palette carries the bench.
 *  - **The ramp** (`PitLook`, filled by core/pits.ts) is a lighter tread with an
 *    ink edge each side and an arrow pointing down it. The strip is cut out of
 *    the triangles it crosses (four half-planes), the arrow is the tread's
 *    piece clipped to a shaft and a head.
 *  - **The heap** is a cool grey, outlined where it is `PIT.heapFootH` high, and
 *    hatched both ways every `PIT.hatchM` m in a darker ink.
 *
 *  Chunk geometry is non-indexed after `facet()`: cell `(ix, iz)` owns vertices
 *  `6 (iz · 32 + ix) …+5`, the triangles `a c b` and `b c d` of chunks.ts. A
 *  touched cell's two triangles are replaced by their pieces; every other cell
 *  is copied. The ink ribbons and the arrow come after every ground vertex
 *  (`geometry.userData.decalFrom`), so a reader that walks the ground (the
 *  surface error probe, `colorAt`) stops there. */
import * as THREE from 'three';
import { CELL_M, CHUNKS, CHUNK_CELLS, MAP_CELLS, MAP_M, PIT } from '../data/balance';
import type { Heightfield } from './heightfield';

const N = MAP_CELLS + 1;
const HALF = MAP_M / 2;
const EPS = 1e-7;

type Rgb = readonly [number, number, number];

/** linear components of an sRGB hex, scaled (the ground's own colours are linear too) */
const tone = (hex: number, k = 1): Rgb => {
  const c = new THREE.Color(hex);
  return [c.r * k, c.g * k, c.b * k];
};

/** the pit's palette, linear (data/balance.ts PIT holds the sRGB hex) */
export const PALETTE = {
  ochre: tone(PIT.cutOchre, PIT.cutBright),
  dark: tone(PIT.cutDark, PIT.cutBright),
  floor: tone(PIT.cutFloor, PIT.cutBright),
  tread: tone(PIT.cutTread, PIT.cutBright),
  heap: tone(PIT.heapTone, PIT.heapBright),
  hatch: tone(PIT.heapHatchInk),
  contour: tone(PIT.contourInk),
  arrow: tone(PIT.arrowInk),
  foot: tone(PIT.heapFootInk),
} as const;

/** the bench index of a depth (m): 0 the ground's own, 1 the first bench … */
export const benchOf = (depth: number): number => (depth < 1 - EPS ? 0 : Math.floor(depth / PIT.bench + 0.5 + EPS));

// ───────────────────────────── what core/pits.ts tells the look ─────────────────────────────

/** A pit as the look needs it: its ramp and its floor. */
export interface PitLook {
  id: number;
  /** the centre now, and the rim radius of the last carve, world m */
  cx: number; cz: number; R: number;
  /** the ramp: its line runs through (ox, oz) along (ux, uz), its top `A` m along (down it, toward the centre, is down) */
  ox: number; oz: number; ux: number; uz: number; A: number;
  /** the floor's depth, m below the ground, and the deepest sample so far */
  floor: number; deep: number;
}

const looks = new WeakMap<Heightfield, readonly PitLook[]>();

/** The pits standing on a heightfield (core/pits.ts `syncPitZones`: after every carve and on a load). */
export function setPitLooks(hf: Heightfield, pits: readonly PitLook[]) { looks.set(hf, pits); }
export const pitLooks = (hf: Heightfield): readonly PitLook[] => looks.get(hf) ?? [];

// ───────────────────────────── depth ─────────────────────────────

/** a sample's depth below its original ground, m: + a pit's cut, − a heap's height; graded ground is plain */
function depthOf(hf: Heightfield, k: number): number {
  const d = hf.delta[k];
  return d === 0 || hf.padMask[k] ? 0 : -d / 10;
}

/** The depth at a point, on the terrain's own triangulation (`a c b`, `b c d`: chunks.ts `surfaceAt`). */
export function depthAtPoint(hf: Heightfield, x: number, z: number): number {
  const fx = (x + HALF) / CELL_M, fz = (z + HALF) / CELL_M;
  const gx = Math.max(0, Math.min(Math.floor(fx), N - 2)), gz = Math.max(0, Math.min(Math.floor(fz), N - 2));
  const tx = Math.min(1, Math.max(0, fx - gx)), tz = Math.min(1, Math.max(0, fz - gz));
  const k = gz * N + gx;
  const a = depthOf(hf, k), b = depthOf(hf, k + 1), c = depthOf(hf, k + N), d = depthOf(hf, k + N + 1);
  return tx + tz <= 1 ? a + (b - a) * tx + (c - a) * tz : d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
}

/** The palette colour a sample wears at its own depth (null: plain ground). */
export function cutTone(hf: Heightfield, ix: number, iz: number): Rgb | null {
  const k = Math.min(Math.max(iz, 0), N - 1) * N + Math.min(Math.max(ix, 0), N - 1);
  const d = depthOf(hf, k);
  if (d === 0) return null;
  if (d < 0) return PALETTE.heap;
  const band = benchOf(d);
  return band <= 0 ? null : band % 2 === 1 ? PALETTE.ochre : PALETTE.dark;
}

/** The real outline of a cut or a heap round (cx, cz): per ray, the outermost point (within `rMax`) where the
 *  depth is at least `level` m (a cut: the first bench's contour, its rim) or the height is at least `−level`
 *  (a heap, `level` negative). World (x, z) points, closed. Null when nothing reaches it. */
export function outlineOf(hf: Heightfield, cx: number, cz: number, rMax: number, level: number, rays = 96): [number, number][] | null {
  const pts: [number, number][] = [];
  const sign = level >= 0 ? 1 : -1;
  const thr = Math.abs(level);
  const at = (a: number, r: number) => sign * depthAtPoint(hf, cx + Math.cos(a) * r, cz + Math.sin(a) * r);
  let hit = 0;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    let r = rMax;
    while (r > 0 && at(a, r) < thr) r -= 1;
    if (r <= 0) { pts.push([cx, cz]); continue; }
    hit++;
    // between r (in) and r + 1 (out): where the depth crosses the level
    const v0 = at(a, r), v1 = at(a, r + 1);
    const t = v0 > v1 ? (v0 - thr) / (v0 - v1) : 0;
    pts.push([cx + Math.cos(a) * (r + t), cz + Math.sin(a) * (r + t)]);
  }
  if (hit < rays / 2) return null;
  pts.push(pts[0]);
  return pts;
}

// ───────────────────────────── polygons ─────────────────────────────

/** a polygon corner: position, the ground's own colour, and the depth (m) */
interface V { x: number; y: number; z: number; r: number; g: number; b: number; d: number }

const lerpV = (a: V, b: V, t: number): V => ({
  x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t,
  r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, d: a.d + (b.d - a.d) * t,
});

interface Cut { inn: V[]; out: V[]; p: V | null; q: V | null }

/** A convex polygon cut by a line: the corners where `fv >= 0` (inn), the rest (out), and the two points on the line. */
function split(poly: readonly V[], fv: readonly number[]): Cut {
  const inn: V[] = [], out: V[] = [];
  let p: V | null = null, q: V | null = null;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const fa = fv[i], fb = fv[(i + 1) % n];
    const ia = fa >= -EPS, ib = fb >= -EPS;
    (ia ? inn : out).push(a);
    if (ia !== ib) {
      const m = lerpV(a, b, fa / (fa - fb));
      inn.push(m); out.push(m);
      if (!p) p = m; else q = m;
    }
  }
  return { inn, out, p, q };
}

const cross = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): [number, number, number] =>
  [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];

/** twice the polygon's area (a fan of cross products), m² × 2 */
function area2(poly: readonly V[]): number {
  let ax = 0, ay = 0, az = 0;
  const o = poly[0];
  for (let i = 1; i < poly.length - 1; i++) {
    const c = cross(poly[i].x - o.x, poly[i].y - o.y, poly[i].z - o.z, poly[i + 1].x - o.x, poly[i + 1].y - o.y, poly[i + 1].z - o.z);
    ax += c[0]; ay += c[1]; az += c[2];
  }
  return Math.hypot(ax, ay, az);
}

const valid = (poly: readonly V[]): boolean => poly.length >= 3 && area2(poly) > 1e-5;

/** growing vertex buffers */
class Buf {
  pos: number[] = [];
  col: number[] = [];
  nrm: number[] = [];
  get verts() { return this.pos.length / 3; }
  vert(x: number, y: number, z: number, c: Rgb, n: readonly number[]) {
    this.pos.push(x, y, z);
    this.col.push(c[0], c[1], c[2]);
    this.nrm.push(n[0], n[1], n[2]);
  }
}

// ───────────────────────────── decorate ─────────────────────────────

/** What one chunk added (tests, probes). */
interface ChunkLook {
  /** bench contour levels cut (m), ribbons laid at them, and the tread edges, heap feet, hatch lines, arrow pieces */
  levels: number[]; contour: number; edge: number; foot: number; hatch: number; arrow: number;
  /** pieces wearing each tone */
  ochre: number; dark: number; floor: number; tread: number; heap: number;
  /** triangles drawn now */
  tris: number;
}

const stats = new WeakMap<Heightfield, Map<number, ChunkLook>>();

function chunkStats(hf: Heightfield): Map<number, ChunkLook> {
  let m = stats.get(hf);
  if (!m) { m = new Map(); stats.set(hf, m); }
  return m;
}

/** What the chunks hold now: the bench levels the contours are laid at (the union over chunks), ribbon counts, tone counts. */
export function lookInfo(hf: Heightfield) {
  const levels = new Set<number>();
  const sum = { chunks: 0, contour: 0, edge: 0, foot: 0, hatch: 0, arrow: 0, ochre: 0, dark: 0, floor: 0, tread: 0, heap: 0, tris: 0 };
  for (const c of chunkStats(hf).values()) {
    sum.chunks++;
    for (const l of c.levels) levels.add(l);
    sum.contour += c.contour; sum.edge += c.edge; sum.foot += c.foot; sum.hatch += c.hatch; sum.arrow += c.arrow;
    sum.ochre += c.ochre; sum.dark += c.dark; sum.floor += c.floor; sum.tread += c.tread; sum.heap += c.heap; sum.tris += c.tris;
  }
  const srgb = (c: Rgb) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace).convertLinearToSRGB()
    .toArray().map((v) => Math.round(v * 255)) as [number, number, number];
  return {
    ...sum, levels: [...levels].sort((a, b) => a - b),
    palette: {
      ochre: srgb(PALETTE.ochre), dark: srgb(PALETTE.dark), floor: srgb(PALETTE.floor), tread: srgb(PALETTE.tread),
      heap: srgb(PALETTE.heap), hatch: srgb(PALETTE.hatch), contour: srgb(PALETTE.contour), arrow: srgb(PALETTE.arrow),
    },
    looks: pitLooks(hf).length,
  };
}

/** one half-plane of a convex part, in the ramp's own (along, across) coordinates: `na · a + np · p − c >= 0` */
type Half = readonly [na: number, np: number, c: number];

/** The half-planes of a convex polygon in (a, p), each facing the polygon's inside. */
function halves(pts: readonly (readonly [number, number])[]): Half[] {
  let ga = 0, gp = 0;
  for (const [a, p] of pts) { ga += a / pts.length; gp += p / pts.length; }
  const out: Half[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [a0, p0] = pts[i], [a1, p1] = pts[(i + 1) % pts.length];
    let na = -(p1 - p0), np = a1 - a0;
    const len = Math.hypot(na, np) || 1;
    na /= len; np /= len;
    let c = na * a0 + np * p0;
    if (na * ga + np * gp - c < 0) { na = -na; np = -np; c = -c; }
    out.push([na, np, c]);
  }
  return out;
}

/** the ramp's arrow, pointing down it: a shaft and a head, in (a, p) (none on a tread too short) */
function arrowParts(look: PitLook): Half[][] {
  const span = look.deep * PIT.rampRun;
  const len = Math.min(PIT.arrowMaxM, span * PIT.arrowShare);
  if (len < PIT.arrowMinM) return [];
  const mid = look.A - span / 2;
  const tail = mid + len / 2, tip = mid - len / 2;
  const headLen = 0.42 * len, headW = Math.min(0.5 * len, 4.4), shaftW = Math.min(0.15 * len, 1.6);
  const neck = tip + headLen;
  return [
    halves([[neck, -shaftW / 2], [tail, -shaftW / 2], [tail, shaftW / 2], [neck, shaftW / 2]]),
    halves([[tip, 0], [neck, headW / 2], [neck, -headW / 2]]),
  ];
}

/**
 * The chunk-geometry hook (terrain/chunks.ts calls it last in `buildGeometry`, once per chunk `(cx, cz)` rebuild).
 * Returns the chunk's geometry with the pit's look in it: the cut's triangles split on the bench contours and
 * coloured by band, the ramp's tread and arrow, the heap's tone, outline and hatch, and the ink ribbons.
 */
export function decorate(geo: THREE.BufferGeometry, cx: number, cz: number, hf: Heightfield): THREE.BufferGeometry {
  const nc = CHUNK_CELLS;
  const gx0 = cx * nc, gz0 = cz * nc;
  const book = chunkStats(hf);
  const chunk = cz * CHUNKS + cx;
  const carved = (k: number) => hf.delta[k] !== 0 && !hf.padMask[k];
  // anything carved on the chunk's samples (its shared edge included)?
  let any = false;
  for (let iz = 0; iz <= nc && !any; iz++) {
    const row = (gz0 + iz) * N + gx0;
    for (let ix = 0; ix <= nc; ix++) if (carved(row + ix)) { any = true; break; }
  }
  const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
  const col = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (!any || !pos || !col || !nrm || geo.index || pos.count !== nc * nc * 6) {
    book.delete(chunk);
    return geo;
  }
  const P = pos.array as Float32Array, C = col.array as Float32Array, Nm = nrm.array as Float32Array;
  const pits = pitLooks(hf);
  const arrows = new Map<PitLook, Half[][]>();
  const stat: ChunkLook = { levels: [], contour: 0, edge: 0, foot: 0, hatch: 0, arrow: 0, ochre: 0, dark: 0, floor: 0, tread: 0, heap: 0, tris: 0 };
  const seen = new Set<number>();
  const ground = new Buf(), decal = new Buf();
  const halfW = PIT.benchBand / 2;

  /** a polygon as a fan; `c` its flat colour, or the corners' own; lifted along the face normal by `lift` */
  const emit = (b: Buf, poly: readonly V[], c: Rgb | null, n: readonly number[], lift = 0) => {
    if (!valid(poly)) return;
    for (let i = 1; i < poly.length - 1; i++) {
      for (const v of [poly[0], poly[i], poly[i + 1]]) {
        b.vert(v.x + n[0] * lift, v.y + n[1] * lift, v.z + n[2] * lift, c ?? [v.r, v.g, v.b], n);
      }
    }
  };

  /** an ink ribbon along (p, q) in the face's plane, `w` wide, `lift` proud of it, its ends a half width long */
  const ribbon = (p: V, q: V, n: readonly number[], w: number, c: Rgb, lift: number) => {
    const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-3) return;
    const d = [dx / len, dy / len, dz / len];
    const sv = cross(n[0], n[1], n[2], d[0], d[1], d[2]);
    const sl = Math.hypot(sv[0], sv[1], sv[2]) || 1;
    const s = [(sv[0] / sl) * (w / 2), (sv[1] / sl) * (w / 2), (sv[2] / sl) * (w / 2)];
    const e = w / 2;
    const ax = p.x - d[0] * e + n[0] * lift, ay = p.y - d[1] * e + n[1] * lift, az = p.z - d[2] * e + n[2] * lift;
    const bx = q.x + d[0] * e + n[0] * lift, by = q.y + d[1] * e + n[1] * lift, bz = q.z + d[2] * e + n[2] * lift;
    const A = [ax - s[0], ay - s[1], az - s[2]], B = [ax + s[0], ay + s[1], az + s[2]];
    const Cc = [bx + s[0], by + s[1], bz + s[2]], D = [bx - s[0], by - s[1], bz - s[2]];
    // wind it to face the way the ground does
    const face = cross(B[0] - A[0], B[1] - A[1], B[2] - A[2], Cc[0] - A[0], Cc[1] - A[1], Cc[2] - A[2]);
    const quad = face[0] * n[0] + face[1] * n[1] + face[2] * n[2] >= 0 ? [A, B, Cc, A, Cc, D] : [A, Cc, B, A, D, Cc];
    for (const v of quad) decal.vert(v[0], v[1], v[2], c, n);
  };

  /** the pit a point belongs to (nearest centre within its rim and a margin), for its floor */
  const ownerOf = (x: number, z: number): PitLook | null => {
    let best: PitLook | null = null, bd = Infinity;
    for (const l of pits) {
      const d = Math.hypot(x - l.cx, z - l.cz);
      if (d <= l.R + 20 && d < bd) { best = l; bd = d; }
    }
    return best;
  };

  /** the cut's bands: a piece split on every odd metre it spans, each part flat in its band's tone; the ground's own (band 0) is returned */
  const bands = (poly: V[], n: readonly number[], floor: number): V[][] => {
    const rest: V[][] = [];
    let cur = poly;
    let dmin = Infinity, dmax = -Infinity;
    for (const v of cur) { dmin = Math.min(dmin, v.d); dmax = Math.max(dmax, v.d); }
    const settle = (piece: V[]) => {
      if (!valid(piece)) return;
      let mean = 0, lo = Infinity;
      for (const v of piece) { mean += v.d / piece.length; lo = Math.min(lo, v.d); }
      const band = benchOf(mean);
      if (band <= 0) { rest.push(piece); return; }
      let c: Rgb;
      if (floor > 0 && lo >= floor - 0.05) { c = PALETTE.floor; stat.floor++; }
      else if (band % 2 === 1) { c = PALETTE.ochre; stat.ochre++; }
      else { c = PALETTE.dark; stat.dark++; }
      emit(ground, piece, c, n);
    };
    // the levels 1, 3, 5 … strictly above the lowest corner, up to (and with) the highest
    for (let k = Math.max(1, Math.floor((dmin + 1) / 2 + EPS) + 1); 2 * k - 1 <= dmax + EPS && valid(cur); k++) {
      const level = 2 * k - 1;
      const cut = split(cur, cur.map((v) => v.d - level));
      if (cut.p && cut.q) {
        ribbon(cut.p, cut.q, n, PIT.benchBand, PALETTE.contour, PIT.contourLift);
        if (Math.hypot(cut.p.x - cut.q.x, cut.p.z - cut.q.z) > 1e-3) {
          stat.contour++;
          if (!seen.has(level)) { seen.add(level); stat.levels.push(level); }
        }
      }
      settle(cut.out);
      cur = cut.inn;
    }
    settle(cur);
    return rest;
  };

  /** the heap: its foot outlined where it is `heapFootH` high, the part above wearing the heap's tone and its hatch */
  const heap = (poly: V[], n: readonly number[]) => {
    const level = -PIT.heapFootH;
    const cut = split(poly, poly.map((v) => level - v.d));
    let mine: V[] | null = null;
    if (cut.p && cut.q) {
      ribbon(cut.p, cut.q, n, PIT.benchBand, PALETTE.foot, PIT.contourLift);
      stat.foot++;
      mine = cut.inn;
      if (valid(cut.out)) emit(ground, cut.out, null, n);
    } else if (poly.every((v) => v.d <= level + EPS)) mine = poly;
    else emit(ground, poly, null, n);
    if (mine && valid(mine)) {
      emit(ground, mine, PALETTE.heap, n);
      stat.heap++;
      // hatch both ways: the lines x + z = k m and x − z = k m
      const S = PIT.hatchM;
      for (const dir of [1, -1]) {
        const u = (v: V) => (v.x + dir * v.z) / S;
        let lo = Infinity, hi = -Infinity;
        for (const v of mine) { lo = Math.min(lo, u(v)); hi = Math.max(hi, u(v)); }
        for (let k = Math.ceil(lo + EPS); k <= hi - EPS; k++) {
          const pts: V[] = [];
          for (let i = 0; i < mine.length; i++) {
            const a = mine[i], b = mine[(i + 1) % mine.length];
            const fa = u(a) - k, fb = u(b) - k;
            if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) pts.push(lerpV(a, b, fa / (fa - fb)));
            else if (fa === 0) pts.push(a);
          }
          if (pts.length >= 2) {
            ribbon(pts[0], pts[pts.length - 1], n, PIT.hatchW, PALETTE.hatch, PIT.contourLift);
            stat.hatch++;
          }
        }
      }
    }
  };

  /** the ramp's strip cut out of a piece: the tread (with its edges and arrow) and what lies outside it */
  const strip = (poly: V[], n: readonly number[], look: PitLook): V[][] | null => {
    const w = PIT.rampHalfW;
    const aLo = look.A - Math.max(look.deep, 1) * PIT.rampRun - 2;
    const a = (v: V) => (v.x - look.ox) * look.ux + (v.z - look.oz) * look.uz;
    const p = (v: V) => -(v.x - look.ox) * look.uz + (v.z - look.oz) * look.ux;
    // does the triangle reach the strip at all?
    let hiA = -Infinity, loA = Infinity, hiP = -Infinity, loP = Infinity;
    for (const v of poly) { const av = a(v), pv = p(v); hiA = Math.max(hiA, av); loA = Math.min(loA, av); hiP = Math.max(hiP, pv); loP = Math.min(loP, pv); }
    if (loA > look.A || hiA < aLo || loP > w || hiP < -w) return null;
    const planes: ((v: V) => number)[] = [(v) => look.A - a(v), (v) => a(v) - aLo, (v) => w - p(v), (v) => w + p(v)];
    const outs: V[][] = [];
    let cur: V[] | null = poly;
    const edges: [V, V][] = [];
    for (let i = 0; i < planes.length && cur; i++) {
      const fv = cur.map(planes[i]);
      if (fv.every((f) => f >= -EPS)) continue;
      if (fv.every((f) => f <= EPS)) { outs.push(cur); cur = null; break; }
      const cut = split(cur, fv);
      if (valid(cut.out)) outs.push(cut.out);
      if (i >= 2 && cut.p && cut.q) edges.push([cut.p, cut.q]);
      cur = valid(cut.inn) ? cut.inn : null;
    }
    if (cur) {
      emit(ground, cur, PALETTE.tread, n);
      stat.tread++;
      for (const [e0, e1] of edges) { ribbon(e0, e1, n, PIT.benchBand, PALETTE.contour, PIT.contourLift); stat.edge++; }
      let parts = arrows.get(look);
      if (!parts) { parts = arrowParts(look); arrows.set(look, parts); }
      for (const part of parts) {
        let piece: V[] | null = cur;
        for (const [na, np, c] of part) {
          if (!piece) break;
          const fv = piece.map((v) => na * a(v) + np * p(v) - c);
          if (fv.every((f) => f >= -EPS)) continue;
          if (fv.every((f) => f <= EPS)) { piece = null; break; }
          const cut = split(piece, fv);
          piece = valid(cut.inn) ? cut.inn : null;
        }
        if (piece) { emit(decal, piece, PALETTE.arrow, n, PIT.arrowLift); stat.arrow++; }
      }
    }
    return outs;
  };

  // ── every cell: copied, or (a corner carved) its two triangles replaced by their pieces ──
  for (let iz = 0; iz < nc; iz++) {
    for (let ix = 0; ix < nc; ix++) {
      const vi = (iz * nc + ix) * 6;
      const k0 = (gz0 + iz) * N + gx0 + ix;
      const kk = [[k0, k0 + N, k0 + 1], [k0 + 1, k0 + N, k0 + N + 1]];
      if (!(carved(k0) || carved(k0 + 1) || carved(k0 + N) || carved(k0 + N + 1))) {
        for (let j = vi * 3; j < (vi + 6) * 3; j += 3) ground.vert(P[j], P[j + 1], P[j + 2], [C[j], C[j + 1], C[j + 2]], [Nm[j], Nm[j + 1], Nm[j + 2]]);
        continue;
      }
      for (let t = 0; t < 2; t++) {
        const poly: V[] = [];
        let isCut = false, heapy = false;
        for (let i = 0; i < 3; i++) {
          const j = (vi + t * 3 + i) * 3;
          const d = depthOf(hf, kk[t][i]);
          if (d > 0) isCut = true; else if (d < 0) heapy = true;
          poly.push({ x: P[j], y: P[j + 1], z: P[j + 2], r: C[j], g: C[j + 1], b: C[j + 2], d });
        }
        const j0 = (vi + t * 3) * 3;
        const n = [Nm[j0], Nm[j0 + 1], Nm[j0 + 2]];
        let leave: V[][] = [poly];
        if (isCut) {
          const cxm = (poly[0].x + poly[1].x + poly[2].x) / 3, czm = (poly[0].z + poly[1].z + poly[2].z) / 3;
          const own = ownerOf(cxm, czm);
          leave = [];
          let pieces: V[][] = [poly];
          if (own && own.deep >= 1) {
            const s = strip(poly, n, own);
            if (s) pieces = s;
          }
          for (const pc of pieces) for (const rest of bands(pc, n, own?.floor ?? 0)) leave.push(rest);
        }
        for (const rest of leave) {
          if (heapy) heap(rest, n);
          else emit(ground, rest, null, n);
        }
      }
    }
  }

  // ── the new buffers: the ground first, then the decals ──
  const total = ground.verts + decal.verts;
  const outP = new Float32Array(total * 3), outC = new Float32Array(total * 3), outN = new Float32Array(total * 3);
  outP.set(ground.pos); outP.set(decal.pos, ground.pos.length);
  outC.set(ground.col); outC.set(decal.col, ground.col.length);
  outN.set(ground.nrm); outN.set(decal.nrm, ground.nrm.length);
  geo.setAttribute('position', new THREE.BufferAttribute(outP, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(outC, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(outN, 3));
  geo.userData.decalFrom = ground.verts;
  geo.computeBoundingSphere();
  stat.tris = total / 3;
  stat.levels.sort((a, b) => a - b);
  book.set(chunk, stat);
  return geo;
}

/** Was a chunk vertex made by the pit's look and not on the grid? (probes skip them) */
export const onGrid = (x: number, z: number): boolean =>
  Math.abs(x + HALF - Math.round((x + HALF) / CELL_M) * CELL_M) < 0.01 && Math.abs(z + HALF - Math.round((z + HALF) / CELL_M) * CELL_M) < 0.01;
