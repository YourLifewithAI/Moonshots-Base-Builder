/** The construction-robot fleet made visible: one instanced rover per bot in
 *  `state.bots.total`, docked at the structures that supply them (the
 *  Lander, Robotics Bays). The economy gives every assigned construction
 *  site one bot; here that bot drives out to the site, prints (a shuffle
 *  along the wall, a small bob) and drives home to park when the site is
 *  done. Paths are straight legs that hop round the corners of any
 *  footprint in the way; heading follows the velocity with a turn-rate
 *  limit, and the chassis sits on the heightfield, pitched and rolled to it.
 *
 *  Rovers use the building material (same program, finishes, lamps and a
 *  blinking beacon; unlit twin in safe mode) and cast no shadow-map shadow —
 *  a moving caster would re-render the map every frame. A soft decal smeared
 *  down-sun stands in for it. Motion runs on game time: pause freezes them. */
import * as THREE from 'three';
import { BUILDINGS } from '../data/buildings';
import { CELL_M, MAP_M } from '../data/balance';
import type { BuildingState, GameState } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import { centerOf, footprintRect } from '../buildings/instances';
import {
  BEACON, BODY, GLASS, LAMP, PLATE, TRIM, bar, box, cyl, dome, merge, withInstanceState,
} from '../buildings/meshKit';
import { materials } from './materials';
import type { DustEmitter } from './dust';
import { MAX_ROVER_VOICES, type RoverSound } from '../audio/roverVoices';

const MAX_ROVERS = 64;
const SCALE = 1.25;
const SPEED = 4.5;        // m/s cruise
const ACCEL = 3;          // m/s²
const TURN = 2.4;         // rad/s
const CLEAR = 1.2;        // m kept off walls when planning
const WORK_OUT = 1.8;     // m out from a site's footprint
const PARK_OUT = 3.2;     // m out from the dock's footprint
const PARK_PITCH = 2.8;   // m between parked rovers
const HALF = MAP_M / 2 - 8;
const PI = Math.PI;

function roverGeometry(): THREE.BufferGeometry {
  const parts: (THREE.BufferGeometry | THREE.BufferGeometry[])[] = [
    box(1.0, 0.4, 1.5, BODY, 0, 0.64, 0),
    box(0.92, 0.05, 1.1, GLASS, 0, 0.865, -0.1),
    box(1.08, 0.08, 1.56, TRIM, 0, 0.46, 0),
    box(0.28, 0.07, 0.04, LAMP, -0.28, 0.68, 0.76),
    box(0.28, 0.07, 0.04, LAMP, 0.28, 0.68, 0.76),
    bar([0.32, 0.88, -0.45], [0.32, 1.45, -0.45], 0.06, TRIM),
    box(0.34, 0.14, 0.18, PLATE, 0.32, 1.5, -0.42),
    dome(0.05, BEACON, 0.32, 1.57, -0.42, 8),
    // the print arm, folded over the nose
    bar([-0.25, 0.88, 0.35], [-0.25, 1.25, 0.7], 0.07, TRIM),
    bar([-0.25, 1.25, 0.7], [-0.25, 0.95, 1.05], 0.06, TRIM),
    cyl(0.05, 0.03, 0.14, PLATE, -0.25, 0.88, 1.08, 0, 0, 8),
  ];
  for (const x of [-0.58, 0.58]) {
    for (const z of [-0.52, 0.52]) {
      parts.push(cyl(0.26, 0.26, 0.2, PLATE, x, 0.26, z, 0, PI / 2, 12));
      parts.push(bar([x * 0.8, 0.47, z], [x, 0.3, z], 0.06, TRIM));
    }
  }
  const g = merge(parts);
  g.scale(SCALE, SCALE, SCALE);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Soft rounded blob (alpha in G) for the contact-shadow decals. */
function blobTexture(): THREE.DataTexture {
  const W = 32, H = 64;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W * 2 - 1, v = (y + 0.5) / H * 2 - 1;
      const d = Math.hypot(u, v * 1.02) ** 2.5 + Math.abs(u) ** 6;
      const a = Math.max(0, Math.min(1, (1 - d) / 0.55));
      const o = (y * W + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = Math.round(a * a * (3 - 2 * a) * 255);
      data[o + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

interface Rect { id: number; x0: number; z0: number; x1: number; z1: number }

interface Rover {
  x: number; z: number; yaw: number; v: number;
  home: number;
  site: number | null;
  path: [number, number][];
  /** yaw to settle to on arrival */
  face: number;
  /** along-wall direction of the print shuffle */
  side: [number, number];
  working: boolean;
  phase: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Entry parameter of segment p→q into rect r (grown by m), or null. */
function segmentHits(px: number, pz: number, qx: number, qz: number, r: Rect, m: number): number | null {
  let t0 = 0, t1 = 1;
  const dx = qx - px, dz = qz - pz;
  for (const [p, d, lo, hi] of [[px, dx, r.x0 - m, r.x1 + m], [pz, dz, r.z0 - m, r.z1 + m]]) {
    if (Math.abs(d) < 1e-9) {
      if (p <= lo || p >= hi) return null;
      continue;
    }
    let a = (lo - p) / d, b = (hi - p) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 >= t1) return null;
  }
  return t0;
}

const inside = (x: number, z: number, r: Rect, m: number) =>
  x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;

/** Straight legs from a to b, hopping round the corner of each footprint in
 *  the way (greedy, a few hops at most). */
function plan(ax: number, az: number, bx: number, bz: number, rects: readonly Rect[]): [number, number][] {
  const out: [number, number][] = [];
  let cx = ax, cz = az;
  const skip = new Set(rects.filter((r) => inside(ax, az, r, CLEAR) || inside(bx, bz, r, CLEAR)).map((r) => r.id));
  for (let hop = 0; hop < 6; hop++) {
    let hit: Rect | null = null, best = Infinity;
    for (const r of rects) {
      if (skip.has(r.id)) continue;
      const t = segmentHits(cx, cz, bx, bz, r, CLEAR * 0.9);
      if (t !== null && t < best) { best = t; hit = r; }
    }
    if (!hit) break;
    const m = CLEAR + 0.3;
    let pick: [number, number] | null = null, cost = Infinity;
    for (const [x, z] of [[hit.x0 - m, hit.z0 - m], [hit.x1 + m, hit.z0 - m], [hit.x1 + m, hit.z1 + m], [hit.x0 - m, hit.z1 + m]]) {
      if (segmentHits(cx, cz, x, z, hit, CLEAR * 0.9) !== null) continue;
      const c = Math.hypot(x - cx, z - cz) + Math.hypot(bx - x, bz - z);
      if (c < cost) { cost = c; pick = [clamp(x, -HALF, HALF), clamp(z, -HALF, HALF)]; }
    }
    if (!pick) break;
    out.push(pick);
    [cx, cz] = pick;
  }
  out.push([bx, bz]);
  return out;
}

function worldRect(b: BuildingState): Rect {
  const r = footprintRect(b);
  return {
    id: b.id,
    x0: r.gx0 * CELL_M - MAP_M / 2, x1: r.gx1 * CELL_M - MAP_M / 2,
    z0: r.gz0 * CELL_M - MAP_M / 2, z1: r.gz1 * CELL_M - MAP_M / 2,
  };
}

/** Building-local (x, z) → world, for a structure's centre and rotation. */
function toWorld(b: BuildingState, lx: number, lz: number): [number, number] {
  const [cx, cz] = centerOf(b);
  const a = -b.rot * PI / 2, c = Math.cos(a), s = Math.sin(a);
  return [cx + lx * c + lz * s, cz - lx * s + lz * c];
}

export class RoverFleet {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private decals: THREE.InstancedMesh;
  private decalMat: THREE.MeshBasicMaterial;
  private rovers: Rover[] = [];
  private rects: Rect[] = [];
  private rectSig = '';
  private clock = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private p = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private right = new THREE.Vector3();
  /** the last update was paused: the fleet stands still, and is heard so */
  private frozen = false;
  private soundList: RoverSound[] = [];

  constructor(private hf: Heightfield) {
    this.mesh = new THREE.InstancedMesh(withInstanceState(roverGeometry(), MAX_ROVERS),
      materials.get('building'), MAX_ROVERS);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-PI / 2);
    this.decalMat = new THREE.MeshBasicMaterial({
      color: 0x000000, alphaMap: blobTexture(), transparent: true, opacity: 0.5, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    this.decals = new THREE.InstancedMesh(plane, this.decalMat, MAX_ROVERS);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 1;
    this.group.add(this.mesh, this.decals);
  }

  /** Per frame: `dt` game seconds (0 while paused). */
  update(dt: number, state: GameState, sunDir: THREE.Vector3, sunLight: number) {
    this.clock += dt;
    this.frozen = dt <= 0;
    this.syncRects(state);
    this.syncFleet(state);
    this.assignSites(state);
    const steps = Math.min(40, Math.ceil(dt / 0.05));
    for (let k = 0; k < steps; k++) for (const r of this.rovers) this.step(r, dt / steps);
    this.draw(sunDir, sunLight);
  }

  private syncRects(state: GameState) {
    const sig = state.buildings.map((b) => `${b.id}:${b.gx},${b.gz},${b.rot}`).join(';');
    if (sig === this.rectSig) return;
    this.rectSig = sig;
    this.rects = state.buildings.map(worldRect);
  }

  /** Fleet size follows the economy; each rover belongs to a dock. */
  private syncFleet(state: GameState) {
    const n = Math.min(MAX_ROVERS, state.bots?.total ?? 0);
    const docks = state.buildings.filter((b) => b.enabled && (b.construction ?? 0) <= 0 &&
      ((BUILDINGS[b.type].bots ?? 0) > 0 || b.type === 'roboticsBay'));
    const homes: number[] = [];
    for (const d of docks) for (let i = 0; i < (BUILDINGS[d.type].bots ?? 0) && homes.length < n; i++) homes.push(d.id);
    // bots printed on top of the stock (self-assembly) live at the bays
    const bays = docks.filter((d) => d.type === 'roboticsBay');
    const extra = bays.length ? bays : docks;
    for (let i = 0; homes.length < n && extra.length; i++) homes.push(extra[i % extra.length].id);
    if (this.rovers.length > homes.length) this.rovers.length = homes.length;
    for (let i = 0; i < homes.length; i++) {
      let r = this.rovers[i];
      if (!r) {
        const dock = docks.find((d) => d.id === homes[i])!;
        const [x, z] = this.parkSpot(state, dock, i, homes);
        r = { x, z, yaw: 0, v: 0, home: dock.id, site: null, path: [], face: 0, side: [1, 0], working: false,
          phase: i * 2.399 };
        r.yaw = this.parkYaw(dock);
        r.face = r.yaw;
        this.rovers.push(r);
      } else if (r.home !== homes[i]) {
        r.home = homes[i];
        if (r.site === null) this.goPark(state, r, i, homes);
      }
    }
    this.homes = homes;
  }
  private homes: number[] = [];

  /** Parking spots in a row beside the dock (its local −x side first). */
  private parkSpot(state: GameState, dock: BuildingState, i: number, homes: readonly number[]): [number, number] {
    const mine = homes.map((h, j) => (h === dock.id ? j : -1)).filter((j) => j >= 0);
    const k = Math.max(0, mine.indexOf(i));
    const [w, d] = BUILDINGS[dock.type].footprint;
    const hw = (w * CELL_M) / 2, hd = (d * CELL_M) / 2;
    const off = (k - (mine.length - 1) / 2) * PARK_PITCH;
    const sides: [number, number][] = [[-(hw + PARK_OUT), off], [hw + PARK_OUT, off], [off, -(hd + PARK_OUT)], [off, hd + PARK_OUT]];
    for (const [lx, lz] of sides) {
      const [x, z] = toWorld(dock, lx, lz);
      if (Math.abs(x) < HALF && Math.abs(z) < HALF && !this.rects.some((r) => r.id !== dock.id && inside(x, z, r, 1.0))) {
        return [x, z];
      }
    }
    return toWorld(dock, sides[0][0], sides[0][1]);
  }

  /** Parked rovers face along the dock's side, nose to its door side. */
  private parkYaw(dock: BuildingState): number { return -dock.rot * PI / 2; }

  private goPark(state: GameState, r: Rover, i: number, homes: readonly number[]) {
    const dock = state.buildings.find((b) => b.id === r.home);
    r.working = false;
    if (!dock) { r.path = []; return; }
    const [x, z] = this.parkSpot(state, dock, i, homes);
    r.path = plan(r.x, r.z, x, z, this.rects);
    r.face = this.parkYaw(dock);
  }

  private assignSites(state: GameState) {
    const active = state.buildings.filter((b) => (b.construction ?? 0) > 0 && b.idleReason !== 'queued');
    const ids = new Set(active.map((b) => b.id));
    this.rovers.forEach((r, i) => {
      if (r.site !== null && !ids.has(r.site)) {
        r.site = null;
        this.goPark(state, r, i, this.homes);
      }
    });
    const taken = new Set(this.rovers.map((r) => r.site));
    for (const site of active) {
      if (taken.has(site.id)) continue;
      const [cx, cz] = centerOf(site);
      let best: Rover | null = null, bd = Infinity;
      for (const r of this.rovers) {
        if (r.site !== null) continue;
        const d = Math.hypot(r.x - cx, r.z - cz);
        if (d < bd) { bd = d; best = r; }
      }
      if (!best) break;
      best.site = site.id;
      taken.add(site.id);
      this.goSite(best, site);
    }
  }

  /** Work spot: just off the site's wall nearest the rover's dock side. */
  private goSite(r: Rover, site: BuildingState) {
    const rect = worldRect(site);
    const [cx, cz] = centerOf(site);
    const x0 = rect.x0 - WORK_OUT, x1 = rect.x1 + WORK_OUT, z0 = rect.z0 - WORK_OUT, z1 = rect.z1 + WORK_OUT;
    let x = clamp(r.x, x0, x1), z = clamp(r.z, z0, z1);
    const edges = [x - x0, x1 - x, z - z0, z1 - z];
    const e = edges.indexOf(Math.min(...edges));
    if (e === 0) x = x0; else if (e === 1) x = x1; else if (e === 2) z = z0; else z = z1;
    // off the corners, so the shuffle stays along one wall
    if (e < 2) z = clamp(z, rect.z0 + 0.8, rect.z1 - 0.8); else x = clamp(x, rect.x0 + 0.8, rect.x1 - 0.8);
    r.path = plan(r.x, r.z, x, z, this.rects);
    r.face = Math.atan2(cx - x, cz - z);
    r.side = e < 2 ? [0, 1] : [1, 0];
    r.working = false;
  }

  private step(r: Rover, dt: number) {
    if (!r.path.length) {
      r.v = 0;
      r.yaw += clamp(wrap(r.face - r.yaw), -TURN * dt, TURN * dt);
      if (r.site !== null) r.working = true;
      return;
    }
    const [tx, tz] = r.path[0];
    const dx = tx - r.x, dz = tz - r.z, d = Math.hypot(dx, dz);
    const last = r.path.length === 1;
    if (d < (last ? 0.3 : 1.2)) {
      r.path.shift();
      if (!r.path.length && last) { r.x = tx; r.z = tz; }
      return;
    }
    let remain = d;
    for (let i = 1; i < r.path.length; i++) {
      remain += Math.hypot(r.path[i][0] - r.path[i - 1][0], r.path[i][1] - r.path[i - 1][1]);
    }
    const want = Math.atan2(dx, dz);
    r.yaw += clamp(wrap(want - r.yaw), -TURN * dt, TURN * dt);
    const off = wrap(want - r.yaw);
    const cruise = Math.min(SPEED, Math.sqrt(2 * ACCEL * remain) + 0.3);
    const target = cruise * Math.max(0, Math.cos(off)) ** 2;
    r.v += clamp(target - r.v, -2 * ACCEL * dt, ACCEL * dt);
    const len = Math.min(r.v * dt, d);
    r.x += Math.sin(r.yaw) * len;
    r.z += Math.cos(r.yaw) * len;
  }

  private draw(sunDir: THREE.Vector3, sunLight: number) {
    const n = this.rovers.length;
    this.mesh.count = n;
    const elev = Math.max(0.06, Math.asin(clamp(sunDir.y, -1, 1)));
    const smear = Math.min(7, (1.1 * SCALE) / Math.tan(elev));
    const hx = -sunDir.x, hz = -sunDir.z, hl = Math.hypot(hx, hz) || 1;
    const sx = hx / hl, sz = hz / hl;
    const sunYaw = Math.atan2(sx, sz);
    this.decalMat.opacity = 0.5 * sunLight;
    this.decals.visible = sunLight > 0.02;
    this.decals.count = n;
    for (let i = 0; i < n; i++) {
      const r = this.rovers[i];
      let x = r.x, z = r.z, yaw = r.yaw, bob = 0;
      if (r.working) {
        const t = this.clock + r.phase;
        const sh = 0.35 * Math.sin(t * 0.9);
        x += r.side[0] * sh;
        z += r.side[1] * sh;
        bob = 0.02 * Math.sin(t * 9);
        yaw += 0.05 * Math.sin(t * 1.7);
      }
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const hf = this.hf;
      const front = hf.sample(x + fx * 0.9, z + fz * 0.9), back = hf.sample(x - fx * 0.9, z - fz * 0.9);
      const left = hf.sample(x + fz * 0.6, z - fx * 0.6), right = hf.sample(x - fz * 0.6, z + fx * 0.6);
      const y = (front + back + left + right) / 4 + bob;
      this.e.set(-Math.atan2(front - back, 1.8), yaw, Math.atan2(left - right, 1.2));
      this.mesh.setMatrixAt(i, this.m.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e), this.s.set(1, 1, 1)));

      const len = 2.2 + smear;
      const dcx = x + sx * smear * 0.45, dcz = z + sz * smear * 0.45;
      const a = hf.sample(dcx - sx * len / 2, dcz - sz * len / 2), b = hf.sample(dcx + sx * len / 2, dcz + sz * len / 2);
      this.e.set(-Math.atan2(b - a, len), sunYaw, 0);
      this.decals.setMatrixAt(i, this.m.compose(this.p.set(dcx, hf.sample(dcx, dcz) + 0.04, dcz),
        this.q.setFromEuler(this.e), this.s.set(1.6, 1, len)));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.decals.instanceMatrix.needsUpdate = true;
  }

  /** Rooster tails behind moving rovers and print dust at working ones,
   *  nearest the camera first. */
  emitters(cam: THREE.Vector3, out: { e: DustEmitter; d: number }[]) {
    for (const r of this.rovers) {
      const fx = Math.sin(r.yaw), fz = Math.cos(r.yaw);
      const d = Math.hypot(r.x - cam.x, r.z - cam.z);
      if (r.v > 0.6) {
        const k = Math.min(1, r.v / SPEED);
        const x = r.x - fx * 0.9, z = r.z - fz * 0.9;
        out.push({ d, e: { x, y: this.hf.sample(x, z), z, strength: 0.5 + 0.5 * k,
          vx: -fx * 1.3 * k, vy: 0.9, vz: -fz * 1.3 * k, hSpread: 0.7, vSpread: 1.4, size: 0.06 } });
      } else if (r.working) {
        const x = r.x + fx * 1.4, z = r.z + fz * 1.4;
        out.push({ d, e: { x, y: this.hf.sample(x, z), z, strength: 0.6,
          vx: fx * 0.4, vy: 0.5, vz: fz * 0.4, hSpread: 0.9, vSpread: 1.2, size: 0.05 } });
      }
    }
  }

  /** The rovers nearest the camera, for the audio layer: distance, bearing
   *  as a stereo pan, speed as a fraction of cruise, and whether printing. */
  sounds(cam: THREE.Camera): RoverSound[] {
    const out = this.soundList;
    out.length = 0;
    if (!this.rovers.length) return out;
    const p = cam.position;
    this.right.setFromMatrixColumn(cam.matrixWorld, 0);
    for (let i = 0; i < this.rovers.length; i++) {
      const r = this.rovers[i];
      const dx = r.x - p.x, dy = this.hf.sample(r.x, r.z) + 0.6 - p.y, dz = r.z - p.z;
      const d = Math.hypot(dx, dy, dz);
      const pan = (dx * this.right.x + dy * this.right.y + dz * this.right.z) / Math.max(d, 1);
      const moving = this.frozen ? 0 : clamp(r.v / SPEED, 0, 1);
      out.push({ id: i, d, pan: clamp(pan * 0.9, -1, 1), speed: moving, working: !this.frozen && r.working && r.v < 0.1 });
    }
    out.sort((a, b) => a.d - b.d);
    if (out.length > MAX_ROVER_VOICES) out.length = MAX_ROVER_VOICES;
    return out;
  }

  info() {
    return {
      count: this.rovers.length,
      moving: this.rovers.filter((r) => r.v > 0.1).length,
      working: this.rovers.filter((r) => r.working).length,
      assigned: this.rovers.filter((r) => r.site !== null).length,
      material: (this.mesh.material as THREE.Material).type,
      positions: this.rovers.map((r) => [Math.round(r.x * 10) / 10, Math.round(r.z * 10) / 10]),
    };
  }
}
