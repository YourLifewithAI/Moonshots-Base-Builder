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
 *  1.2 × `s` tall including the line under it (y −0.6 s … +0.5 s). */
export function glyphParts(f: FactionId, s: number, relief: number): THREE.BufferGeometry[] {
  const zc = relief / 2;
  const out: THREE.BufferGeometry[] = [];
  const gy = 0.1 * s; // the glyph's centre, over the line
  if (f === 'robots') {
    // a gear: a ten-sided plate, six teeth, a dark hub
    out.push(cyl(0.34 * s, 0.34 * s, relief, MARK, 0, gy, zc, PI / 2, 0, 10));
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * PI * 2 + PI / 12;
      out.push(box(0.26 * s, 0.17 * s, relief, MARK, Math.cos(a) * 0.4 * s, gy + Math.sin(a) * 0.4 * s, zc, 0, a));
    }
    out.push(cyl(0.13 * s, 0.13 * s, relief + 0.03, PLATE, 0, gy, zc + 0.015, PI / 2, 0, 8));
  } else if (f === 'accelerationists') {
    // a solid triangle, point up (a three-sided prism; its first vertex points down before the turn)
    out.push(cyl(0.5 * s, 0.5 * s, relief, MARK, 0, gy + 0.05 * s, zc, PI / 2, PI, 3));
  } else {
    // a flower: five petals round a hub
    for (let k = 0; k < 5; k++) {
      const a = PI / 2 + (k / 5) * PI * 2;
      out.push(cyl(0.17 * s, 0.17 * s, relief, MARK, Math.cos(a) * 0.27 * s, gy + Math.sin(a) * 0.27 * s, zc, PI / 2, 0, 5));
    }
    out.push(cyl(0.12 * s, 0.12 * s, relief + 0.03, PLATE, 0, gy, zc + 0.015, PI / 2, 0, 6));
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
export const DOOR_MARK: MarkSpec = { ry: 0, size: 1.3, side: 0.55, y0: 1.0, y1: 4.2, yPref: 1.9 };

/** A digger's flank (the hubs' units and the legacy pad digger): on the side away from the rig, above the livery band. */
export const UNIT_MARK: MarkSpec = { ry: PI, size: 0.32, side: 0, y0: 1.25, y1: 1.5, yPref: 1.43 };
/** A construction rover's flanks (before its scale): toward the rear of the body. */
export const ROVER_MARK: MarkSpec = { ry: PI / 2, size: 0.26, side: 0.5, y0: 0.5, y1: 0.78, yPref: 0.64 };
/** A drone's flanks (before its scale): the body is a hand's breadth tall. */
export const DRONE_MARK: MarkSpec = { ry: PI / 2, size: 0.12, side: 0, y0: 0.36, y1: 0.48, yPref: 0.42 };

const rc = new THREE.Raycaster();
const dirV = new THREE.Vector3();
const orgV = new THREE.Vector3();

interface Spot { t: number; y: number; d0: number; relief: number }

const nearV = (a: number, b: number) => Math.abs(a - b) < 0.012;
/** is this vertex plain hull (BODY)? */
function isHull(g: THREE.BufferGeometry, i: number): boolean {
  const c = g.getAttribute('color'), m = g.getAttribute('mat');
  return nearV(c.getX(i), BODY.v) && nearV(m.getX(i), BODY.rough) && nearV(m.getY(i), BODY.metal) && Math.round(m.getZ(i)) === 0;
}

/** The first spot of the wall facing `spec.ry` that is flat hull all over a mark, or null. */
export function findSpot(base: THREE.BufferGeometry, spec: MarkSpec): Spot | null {
  if (!base.boundingBox) base.computeBoundingBox();
  const bb = base.boundingBox!;
  const n = [Math.sin(spec.ry), Math.cos(spec.ry)]; // (x, z) of the outward normal
  const tt = [Math.cos(spec.ry), -Math.sin(spec.ry)]; // along the wall, to the right
  let tMin = Infinity, tMax = -Infinity, nMax = -Infinity;
  for (const x of [bb.min.x, bb.max.x]) for (const z of [bb.min.z, bb.max.z]) {
    const t = x * tt[0] + z * tt[1], d = x * n[0] + z * n[1];
    tMin = Math.min(tMin, t); tMax = Math.max(tMax, t); nMax = Math.max(nMax, d);
  }
  const half = spec.size * 0.6;
  const t0 = tMin + half + 0.25, t1 = tMax - half - 0.25;
  const yTop = Math.min(spec.y1, bb.max.y - half - 0.1);
  if (t1 < t0 || yTop < spec.y0) return null;
  const tc = (tMin + tMax) / 2 + spec.side * (tMax - tMin) / 2;
  const cands: { t: number; y: number; score: number }[] = [];
  const step = Math.max(0.1, spec.size * 0.3);
  for (let t = t0; t <= t1 + 1e-6; t += step) {
    for (let y = spec.y0; y <= yTop + 1e-6; y += step) {
      cands.push({ t, y, score: Math.abs(t - tc) + 1.3 * Math.abs(y - spec.yPref) });
    }
  }
  cands.sort((a, b) => a.score - b.score || a.t - b.t || a.y - b.y);
  const mesh = new THREE.Mesh(base, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const probe = spec.size * 0.45;
  const offs: [number, number][] = [[0, 0], [-probe, -probe], [probe, -probe], [-probe, probe], [probe, probe]];
  dirV.set(-n[0], 0, -n[1]);
  for (const c of cands) {
    let dMin = Infinity, dMax = -Infinity, ok = true;
    for (const [ot, oy] of offs) {
      const t = c.t + ot, y = c.y + oy;
      orgV.set(tt[0] * t + n[0] * (nMax + 2), y, tt[1] * t + n[1] * (nMax + 2));
      rc.set(orgV, dirV);
      const hit = rc.intersectObject(mesh, false)[0];
      if (!hit || !hit.face) { ok = false; break; }
      const nrm = hit.face.normal;
      if (nrm.x * n[0] + nrm.z * n[1] < 0.88 || Math.abs(nrm.y) > 0.3 || !isHull(base, hit.face.a)) { ok = false; break; }
      const d = hit.point.x * n[0] + hit.point.z * n[1];
      dMin = Math.min(dMin, d); dMax = Math.max(dMax, d);
      if (dMax - dMin > 0.16) { ok = false; break; }
    }
    if (ok) return { t: c.t, y: c.y, d0: dMin - 0.02, relief: dMax - dMin + 0.09 };
  }
  return null;
}

/** `base` with the faction's mark on the wall `spec` names (`base` unchanged when no wall has a flat
 *  stretch of hull big enough; the spec then tries the `fallback`, if any). The result is a fresh merge. */
export function withMark(base: THREE.BufferGeometry, f: FactionId, spec: MarkSpec, ...fallback: MarkSpec[]): THREE.BufferGeometry {
  for (const sp of [spec, ...fallback]) {
    const spot = findSpot(base, sp);
    if (!spot) continue;
    const n = [Math.sin(sp.ry), Math.cos(sp.ry)], tt = [Math.cos(sp.ry), -Math.sin(sp.ry)];
    const parts = glyphParts(f, sp.size, spot.relief).map((g) => g
      .rotateY(sp.ry)
      .translate(tt[0] * spot.t + n[0] * spot.d0, spot.y, tt[1] * spot.t + n[1] * spot.d0));
    return merge([base, ...parts]);
  }
  return base;
}
