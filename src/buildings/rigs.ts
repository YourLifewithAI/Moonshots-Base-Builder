/** Work rigs: the parts of a recipe that move while it works, kept out of
 *  the recipe so they can (world/workAnim.ts animates them; docs/06 §7).
 *  Two rigs: the Regolith Excavator's boom, its stay and its bucket wheel,
 *  and the Ice Miner's heavier boom and cutter drum (same pivot, hub and
 *  stay: the motion is shared). Every piece is a box of the kit, so one instanced unit box draws
 *  every rig (and the rover print arms) in a single call; the rest pose is
 *  merged into the placement ghost and counted in the triangle budget
 *  (recipes.ts). Frames are building space: base at y = 0, door side +z,
 *  the wheel leading along +x. */
import * as THREE from 'three';
import type { BufferGeometry } from 'three';
import type { BuildingId } from '../data/buildings';
import { BODY, PLATE, TRIM, box, type Finish } from './meshKit';

/** One box of a rig: its finish, centre, rotation and size in its frame. */
export interface RigBox { f: Finish; c: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }

type V3 = readonly [number, number, number];
const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const PI = Math.PI;

/** A square-section member from a to b, as meshKit's `bar`. */
export function barBox(a: V3, b: V3, t: number, f: Finish): RigBox {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length();
  return {
    f, c: new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2),
    q: new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), s: new THREE.Vector3(t, len, t),
  };
}

/** A box turned `rz` about +z (the wheel's axis). */
function boxZ(w: number, h: number, d: number, f: Finish, x: number, y: number, z: number, rz = 0): RigBox {
  return { f, c: new THREE.Vector3(x, y, z), q: new THREE.Quaternion().setFromAxisAngle(Z, rz), s: new THREE.Vector3(w, h, d) };
}

/** The excavator's rig, building space. The boom dips about +z at its
 *  root; the wheel rides its end and turns about +z at the hub; the stay
 *  runs from the mast's head (in the recipe) to the boom. */
export const DIGGER_RIG = {
  pivot: new THREE.Vector3(0.4, 1.7, 0.7),
  hub: new THREE.Vector3(2.9, 1.45, 0.7),
  stayTop: new THREE.Vector3(0.2, 3.6, 0.7),
  stayFoot: new THREE.Vector3(2.5, 1.9, 0.7),
  stayT: 0.06,
  /** the wheel's radius to the bucket lips, m */
  reach: 1.36,
};

/** the boom and its top rail (they dip about the pivot) */
export const DIGGER_BOOM: readonly RigBox[] = [
  barBox([0.4, 1.7, 0.7], [2.7, 1.5, 0.7], 0.45, BODY),
  barBox([0.4, 2.0, 0.7], [2.6, 1.9, 0.7], 0.12, TRIM),
];

const wheelCache = new Map<boolean, RigBox[]>();
/** The bucket wheel about its hub (+z its axle): an eight-sided rim, eight
 *  buckets, two spokes across and a hub; Autonomous Haulage's wider lips
 *  (upgrades.ts) turn with it. */
export function diggerWheel(key = ''): readonly RigBox[] {
  const lips = key.split(',').includes('autonomousHaulage');
  let w = wheelCache.get(lips);
  if (w) return w;
  w = [];
  const chord = 2 * 1.1 * Math.sin(PI / 8);
  for (let k = 0; k < 8; k++) {
    const a = (k + 0.5) * PI / 4, r = 1.1 * Math.cos(PI / 8);
    w.push(boxZ(0.07, chord + 0.05, 0.35, TRIM, Math.cos(a) * r, Math.sin(a) * r, 0, a));
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * PI * 2;
    w.push(boxZ(0.42, 0.42, 0.55, PLATE, Math.cos(a) * 1.15, Math.sin(a) * 1.15, 0, a));
  }
  w.push(boxZ(2.1, 0.08, 0.08, TRIM, 0, 0, 0), boxZ(0.08, 2.1, 0.08, TRIM, 0, 0, 0));
  w.push(boxZ(0.4, 0.4, 0.5, PLATE, 0, 0, 0), boxZ(0.4, 0.4, 0.5, PLATE, 0, 0, 0, PI / 4));
  if (lips) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * PI * 2 + PI / 8;
      w.push(boxZ(0.26, 0.12, 0.72, PLATE, Math.cos(a) * 1.36, Math.sin(a) * 1.36, 0, a));
    }
  }
  wheelCache.set(lips, w);
  return w;
}

/** the ice miner's boom: broader than the excavator's, a trim plate on top */
export const ICE_BOOM: readonly RigBox[] = [
  barBox([0.4, 1.7, 0.7], [2.7, 1.5, 0.7], 0.55, BODY),
  barBox([0.4, 2.05, 0.7], [2.6, 1.95, 0.7], 0.14, TRIM),
];

const drumCache = new Map<boolean, RigBox[]>();
/** The ice miner's cutter drum about its hub (+z its axle): a ten-slat shell,
 *  ten teeth, two octagonal flanges and a shaft. The heated-auger upgrade
 *  (upgrades.ts) adds a second row of teeth. */
export function iceDrum(key = ''): readonly RigBox[] {
  const hot = key.split(',').includes('heatedAugers');
  let d = drumCache.get(hot);
  if (d) return d;
  d = [];
  const n = 10, r = 0.85, chord = 2 * r * Math.sin(PI / n);
  for (let k = 0; k < n; k++) {
    const a = (k + 0.5) * 2 * PI / n, rr = r * Math.cos(PI / n);
    d.push(boxZ(0.1, chord + 0.04, 1.0, PLATE, Math.cos(a) * rr, Math.sin(a) * rr, 0, a));
  }
  for (let k = 0; k < n; k++) {
    const a = (k / n) * PI * 2;
    d.push(boxZ(0.26, 0.14, 0.86, TRIM, Math.cos(a) * (r + 0.12), Math.sin(a) * (r + 0.12), 0, a));
    if (hot) d.push(boxZ(0.16, 0.1, 0.5, TRIM, Math.cos(a + PI / n) * (r + 0.1), Math.sin(a + PI / n) * (r + 0.1), 0, a + PI / n));
  }
  for (const z of [-0.54, 0.54]) d.push(boxZ(1.5, 1.5, 0.08, BODY, 0, 0, z, 0), boxZ(1.5, 1.5, 0.08, BODY, 0, 0, z, PI / 4));
  d.push(boxZ(0.5, 0.5, 1.4, PLATE, 0, 0, 0));
  drumCache.set(hot, d);
  return d;
}

const bake = (b: RigBox, x = 0, y = 0, z = 0): BufferGeometry =>
  box(b.s.x, b.s.y, b.s.z, b.f).applyQuaternion(b.q).translate(b.c.x + x, b.c.y + y, b.c.z + z);

/** A type's rig in its rest pose (the placement ghost; the triangle
 *  budget), building space. Types without a rig: none. */
export function rigParts(id: BuildingId, key = ''): BufferGeometry[] {
  if (id !== 'excavator' && id !== 'iceMiner') return [];
  const { hub, stayTop, stayFoot, stayT } = DIGGER_RIG;
  const ice = id === 'iceMiner';
  return [
    ...(ice ? ICE_BOOM : DIGGER_BOOM).map((b) => bake(b)),
    bake(barBox(stayTop.toArray(), stayFoot.toArray(), stayT, TRIM)),
    ...(ice ? iceDrum(key) : diggerWheel(key)).map((b) => bake(b, hub.x, hub.y, hub.z)),
  ];
}

/** Triangles a type's rig draws (every piece a 12-triangle box). */
export function rigTriangles(id: BuildingId, key = ''): number {
  return id === 'excavator' ? (DIGGER_BOOM.length + 1 + diggerWheel(key).length) * 12
    : id === 'iceMiner' ? (ICE_BOOM.length + 1 + iceDrum(key).length) * 12 : 0;
}
