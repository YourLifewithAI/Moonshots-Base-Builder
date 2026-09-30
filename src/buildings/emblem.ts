/** The faction emblem as geometry (docs/20 S7): the faction's glyph (⚙ ▲ ❀) as a small flat mark of
 *  the kit's own primitives, in the MARK finish (the livery trim), with a short line under it, stuck on
 *  a flat stretch of hull on a structure's door side (+z, else +x) or a unit's flank. No text, no
 *  texture: a gear of eight plates and a hub, a solid triangle, a five-petal flower.
 *
 *  Where it goes is found on the geometry itself, so the same code marks all 35 recipes and the
 *  units and survives every upgrade: candidate spots on the wall are scored by how close they are
 *  to where a door-side mark belongs, and the first one whose five probe rays (centre and corners)
 *  all hit hull (BODY) within a few degrees of the wall's normal and within a few centimetres of one
 *  another wins. The glyph's slab is as thick as the wall's spread plus a hair, so on a round hull
 *  (the Lander, a dome's base) it sits in the wall, not over it. Nothing is placed in a solo game
 *  (the callers check `lookFaction`). */
import * as THREE from 'three';
import type { FactionId } from '../data/factions';
import { BODY, MARK, PLATE, box, cyl, merge } from './meshKit';

const PI = Math.PI;

/** The glyph in its own frame: x right, y up, the wall at z = 0, `relief` thick (z 0 … relief), about
 *  1.2 × `s` tall including the line under it (y −0.6 s … +0.5 s). A structure's (s ≥ 0.6 m) has its detail,
 *  a unit's or a walker's is a plate and a line: every instance draws it twice (the ink twin), so a small
 *  mark earns no more triangles than it shows pixels. About 92 (gear), 24 (triangle) and 104 (flower) △ a
 *  structure's, 44 / 22 / 36 a small one's. */
export function glyphParts(f: FactionId, s: number, relief: number, detail = s >= 0.6): THREE.BufferGeometry[] {
  const zc = relief / 2;
  const out: THREE.BufferGeometry[] = [];
  const gy = 0.1 * s; // the glyph's centre, over the line
  const small = !detail;
  if (f === 'robots') {
    // a gear: an eight-sided plate and six square teeth (a plate and a line when small)
    out.push(cyl(0.34 * s, 0.34 * s, relief, MARK, 0, gy, zc, PI / 2, 0, 8));
    if (!small) {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * PI * 2 + PI / 12;
        out.push(box(0.26 * s, 0.17 * s, relief, MARK, Math.cos(a) * 0.4 * s, gy + Math.sin(a) * 0.4 * s, zc, 0, a));
      }
    }
  } else if (f === 'accelerationists') {
    // a solid triangle, point up (a three-sided prism; its first vertex points down before the turn)
    out.push(cyl(0.5 * s, 0.5 * s, relief, MARK, 0, gy + 0.05 * s, zc, PI / 2, PI, 3));
  } else if (small) {
    // a flower, small: its hub
    out.push(cyl(0.3 * s, 0.3 * s, relief, MARK, 0, gy, zc, PI / 2, 0, 6));
  } else {
    // a flower: five petals round a hub
    for (let k = 0; k < 5; k++) {
      const a = PI / 2 + (k / 5) * PI * 2;
      out.push(cyl(0.18 * s, 0.18 * s, relief, MARK, Math.cos(a) * 0.27 * s, gy + Math.sin(a) * 0.27 * s, zc, PI / 2, 0, 4));
    }
    out.push(box(0.2 * s, 0.2 * s, relief + 0.03, PLATE, 0, gy, zc + 0.015));
  }
  // the faction's trim line under it
  out.push(box(1.0 * s, 0.1 * s, relief, MARK, 0, -0.52 * s, zc));
  return out;
}

/** Where on a wall a mark goes (all metres, in the geometry's own frame). */
export interface MarkSpec {
  /** the wall's outward yaw: 0 = +z (the door side), π/2 = +x */
  ry: number;
  /** glyph height, m (the mark with its line is about 1.2 of it) */
  size: number;
  /** along the wall (right when facing it), −1 … 1 across the wall's width: the side it likes */
  side: number;
  /** the height band, and the height it likes */
  y0: number; y1: number; yPref: number;
}

/** A structure's mark: the door side, right of the door, at eye level. */
export const DOOR_MARK: MarkSpec = { ry: 0, size: 1.3, side: 0.55, y0: 0.35, y1: 4.2, yPref: 1.9 };

/** A digger's flank (the hubs' units and the legacy pad digger): on the side away from the rig, above the livery band. */
export const UNIT_MARK: MarkSpec = { ry: PI, size: 0.32, side: 0, y0: 1.25, y1: 1.5, yPref: 1.43 };
/** A construction rover's flanks (before its scale): toward the rear of the body. */
export const ROVER_MARK: MarkSpec = { ry: PI / 2, size: 0.26, side: 0.5, y0: 0.5, y1: 0.78, yPref: 0.64 };
/** A drone's flanks (before its scale): the body is a hand's breadth tall. */
export const DRONE_MARK: MarkSpec = { ry: PI / 2, size: 0.12, side: 0, y0: 0.36, y1: 0.48, yPref: 0.42 };

const nearV = (a: number, b: number) => Math.abs(a - b) < 0.012;

/** The triangles of a geometry seen from a wall: each in the wall's own frame (t along it to the right, y up, d out), its
 *  (t, y) bounds for a quick reject, whether its normal faces the wall squarely and whether it is plain hull or some
 *  other solid (a window, lamp or beacon is neither). */
interface WallTris {
  n: number;
  t: Float32Array; y: Float32Array; d: Float32Array; // 3 per triangle
  box: Float32Array; // minT maxT minY maxY per triangle
  flat: Uint8Array; // 1 = the face looks along the wall's normal and stands up
  kind: Uint8Array; // 2 = hull (BODY), 1 = another solid, 0 = emissive (never a backing)
}

const wallCache = new WeakMap<THREE.BufferGeometry, Map<number, WallTris>>();

function wallTris(g: THREE.BufferGeometry, ry: number): WallTris {
  let per = wallCache.get(g);
  if (!per) { per = new Map(); wallCache.set(g, per); }
  const hit = per.get(ry);
  if (hit) return hit;
  const pos = g.getAttribute('position'), ix = g.index;
  const c = g.getAttribute('color'), m = g.getAttribute('mat');
  const n = (ix ? ix.count : pos.count) / 3;
  const nx = Math.sin(ry), nz = Math.cos(ry), tx = Math.cos(ry), tz = -Math.sin(ry);
  const w: WallTris = {
    n, t: new Float32Array(n * 3), y: new Float32Array(n * 3), d: new Float32Array(n * 3), box: new Float32Array(n * 4),
    flat: new Uint8Array(n), kind: new Uint8Array(n),
  };
  const P = [0, 0, 0].map(() => [0, 0, 0]);
  for (let i = 0; i < n; i++) {
    let first = 0;
    for (let k = 0; k < 3; k++) {
      const v = ix ? ix.getX(i * 3 + k) : i * 3 + k;
      if (k === 0) first = v;
      P[k][0] = pos.getX(v); P[k][1] = pos.getY(v); P[k][2] = pos.getZ(v);
      w.t[i * 3 + k] = P[k][0] * tx + P[k][2] * tz;
      w.y[i * 3 + k] = P[k][1];
      w.d[i * 3 + k] = P[k][0] * nx + P[k][2] * nz;
    }
    w.box[i * 4] = Math.min(w.t[i * 3], w.t[i * 3 + 1], w.t[i * 3 + 2]);
    w.box[i * 4 + 1] = Math.max(w.t[i * 3], w.t[i * 3 + 1], w.t[i * 3 + 2]);
    w.box[i * 4 + 2] = Math.min(w.y[i * 3], w.y[i * 3 + 1], w.y[i * 3 + 2]);
    w.box[i * 4 + 3] = Math.max(w.y[i * 3], w.y[i * 3 + 1], w.y[i * 3 + 2]);
    // the face normal
    const ax = P[1][0] - P[0][0], ay = P[1][1] - P[0][1], az = P[1][2] - P[0][2];
    const bx = P[2][0] - P[0][0], by = P[2][1] - P[0][1], bz = P[2][2] - P[0][2];
    let fx = ay * bz - az * by, fy = az * bx - ax * bz, fz = ax * by - ay * bx;
    const len = Math.hypot(fx, fy, fz) || 1;
    fx /= len; fy /= len; fz /= len;
    w.flat[i] = Math.abs(fx * nx + fz * nz) >= 0.88 && Math.abs(fy) <= 0.3 ? 1 : 0;
    const emit = Math.round(m.getZ(first));
    w.kind[i] = emit > 0 ? 0 : nearV(c.getX(first), BODY.v) && nearV(m.getX(first), BODY.rough) && nearV(m.getY(first), BODY.metal) ? 2 : 1;
  }
  per.set(ry, w);
  return w;
}

/** What a ray along the wall's inward normal, through (t, y), meets first: its depth d and the triangle, or null. */
function wallHit(w: WallTris, t: number, y: number): { d: number; i: number } | null {
  let best = -Infinity, bi = -1;
  for (let i = 0; i < w.n; i++) {
    const b = i * 4;
    if (t < w.box[b] || t > w.box[b + 1] || y < w.box[b + 2] || y > w.box[b + 3]) continue;
    const o = i * 3;
    const t0 = w.t[o], t1 = w.t[o + 1], t2 = w.t[o + 2], y0 = w.y[o], y1 = w.y[o + 1], y2 = w.y[o + 2];
    const den = (y1 - y2) * (t0 - t2) + (t2 - t1) * (y0 - y2);
    if (Math.abs(den) < 1e-9) continue; // edge-on
    const l0 = ((y1 - y2) * (t - t2) + (t2 - t1) * (y - y2)) / den;
    const l1 = ((y2 - y0) * (t - t2) + (t0 - t2) * (y - y2)) / den;
    const l2 = 1 - l0 - l1;
    if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
    const d = l0 * w.d[o] + l1 * w.d[o + 1] + l2 * w.d[o + 2];
    if (d > best) { best = d; bi = i; }
  }
  return bi < 0 ? null : { d: best, i: bi };
}

/** Where a mark goes: the glyph's size and the wall it is on, its place on the wall, how deep the wall lies there and how thick
 *  the slab must be to sit in it. */
export interface Placement { ry: number; size: number; t: number; y: number; d0: number; relief: number }

/** The first spot of the wall facing `spec.ry` that is flat all over a mark (hull only when `strict`, any solid when not), or null. */
export function findSpot(base: THREE.BufferGeometry, spec: MarkSpec, strict = true): Placement | null {
  if (!base.boundingBox) base.computeBoundingBox();
  const bb = base.boundingBox!;
  const n = [Math.sin(spec.ry), Math.cos(spec.ry)]; // (x, z) of the outward normal
  const tt = [Math.cos(spec.ry), -Math.sin(spec.ry)]; // along the wall, to the right
  let tMin = Infinity, tMax = -Infinity;
  for (const x of [bb.min.x, bb.max.x]) for (const z of [bb.min.z, bb.max.z]) {
    const t = x * tt[0] + z * tt[1];
    tMin = Math.min(tMin, t); tMax = Math.max(tMax, t);
  }
  const half = spec.size * 0.6;
  const t0 = tMin + half, t1 = tMax - half;
  const yTop = Math.min(spec.y1, bb.max.y - half - 0.1);
  if (t1 < t0 || yTop < spec.y0) return null;
  const tc = (tMin + tMax) / 2 + spec.side * (tMax - tMin) / 2;
  const cands: { t: number; y: number; score: number }[] = [];
  const step = Math.max(0.12, spec.size * 0.2);
  for (let t = t0; t <= t1 + 1e-6; t += step) {
    for (let y = spec.y0; y <= yTop + 1e-6; y += step) {
      cands.push({ t, y, score: Math.abs(t - tc) + 1.3 * Math.abs(y - spec.yPref) });
    }
  }
  cands.sort((a, b) => a.score - b.score || a.t - b.t || a.y - b.y);
  const w = wallTris(base, spec.ry);
  const probe = spec.size * 0.45;
  const offs: [number, number][] = [[0, 0], [-probe, -probe], [probe, -probe], [-probe, probe], [probe, probe]];
  const need = strict ? 2 : 1;
  for (const c of cands) {
    let dMin = Infinity, dMax = -Infinity, ok = true;
    for (const [ot, oy] of offs) {
      const hit = wallHit(w, c.t + ot, c.y + oy);
      if (!hit || !w.flat[hit.i] || w.kind[hit.i] < need) { ok = false; break; }
      dMin = Math.min(dMin, hit.d); dMax = Math.max(dMax, hit.d);
      if (dMax - dMin > 0.16) { ok = false; break; }
    }
    if (ok) return { ry: spec.ry, size: spec.size, t: c.t, y: c.y, d0: dMin - 0.02, relief: dMax - dMin + 0.09 };
  }
  return null;
}

/** The best placement among the walls `spec` and `fallback` name: hull first, then any solid; the full size, then 0.8, 0.65,
 *  0.5 and 0.4 of it (the wall a mark goes on matters less than that it is there). */
export function findMark(base: THREE.BufferGeometry, spec: MarkSpec, ...fallback: MarkSpec[]): Placement | null {
  for (const strict of [true, false]) {
    for (const k of [1, 0.8, 0.65, 0.5, 0.4]) {
      for (const w of [spec, ...fallback]) {
        if (w.size * k < 0.09) continue; // a mark smaller than a hand is not a mark
        const pl = findSpot(base, { ...w, size: w.size * k }, strict);
        if (pl) return pl;
      }
    }
  }
  return null;
}

/** `base` with the glyph stuck where `pl` says (a fresh merge). */
export function applyMark(base: THREE.BufferGeometry, f: FactionId, pl: Placement): THREE.BufferGeometry {
  const n = [Math.sin(pl.ry), Math.cos(pl.ry)], tt = [Math.cos(pl.ry), -Math.sin(pl.ry)];
  const parts = glyphParts(f, pl.size, pl.relief).map((g) => g
    .rotateY(pl.ry)
    .translate(tt[0] * pl.t + n[0] * pl.d0, pl.y, tt[1] * pl.t + n[1] * pl.d0));
  return merge([base, ...parts]);
}

/** `base` with the faction's mark on the wall `spec` names (else a `fallback` wall, smaller, or any solid), or `base` itself when there is no
 *  flat wall anywhere. The result is a fresh merge. */
export function withMark(base: THREE.BufferGeometry, f: FactionId, spec: MarkSpec, ...fallback: MarkSpec[]): THREE.BufferGeometry {
  const pl = findMark(base, spec, ...fallback);
  return pl ? applyMark(base, f, pl) : base;
}
