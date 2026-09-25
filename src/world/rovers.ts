/** The construction-rover fleet made visible: one instanced rover per unit
 *  in the sim's roster (`state.rovers`, core/fleet.ts), docked at the
 *  structures that supply them (the Lander, Robotics Bays); the one lent to
 *  a survey is away. A rover with a site drives out to it, prints (a shuffle
 *  along the wall, a small bob) and drives home to park when the sim frees
 *  it; several at one site spread round its walls. Paths are straight legs
 *  that hop round the corners of any footprint in the way (core/paths.ts);
 *  heading follows the velocity with a turn-rate limit, and the chassis sits
 *  on the heightfield, pitched and rolled to it. The selected rover wears a
 *  ring; rovers are picked by instance (or by nearness on screen).
 *
 *  Rovers use the building material (same program, finishes, lamps and a
 *  blinking beacon; unlit twin in safe mode) and cast no shadow-map shadow —
 *  a moving caster would re-render the map every frame. A soft decal smeared
 *  down-sun stands in for it. Motion runs on game time: pause freezes them. */
import * as THREE from 'three';
import { BUILDINGS } from '../data/buildings';
import { CELL_M } from '../data/balance';
import type { BuildingState, GameState } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import { centerOf } from '../buildings/instances';
import { PATH_HALF as HALF, inside, plan, worldRect, type Rect } from '../core/paths';
import {
  BEACON, BODY, GLASS, LAMP, PLATE, TRIM, bar, box, cyl, dome, merge, withInstanceState,
} from '../buildings/meshKit';
import { materials } from './materials';
import type { DustEmitter } from './dust';
import { MAX_ROVER_VOICES, type RoverSound } from '../audio/roverVoices';

const MAX_ROVERS = 64;
/** a command view's listener height, as a share of the camera's distance */
const LISTENER_LIFT = 0.3;
const SCALE = 1.25;
const SPEED = 4.5;        // m/s cruise
const ACCEL = 3;          // m/s²
const TURN = 2.4;         // rad/s
const CLEAR = 1.2;        // m kept off walls when planning
const WORK_OUT = 1.8;     // m out from a site's footprint
const PARK_OUT = 3.2;     // m out from the dock's footprint
const PARK_PITCH = 2.8;   // m between parked rovers
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
export function blobTexture(): THREE.DataTexture {
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

interface Rover {
  /** the sim roster's id (core/fleet.ts): the voice and the selection follow it */
  id: number;
  x: number; z: number; yaw: number; v: number;
  home: number;
  site: number | null;
  /** where it is headed (site slot or parking slot): a new key replans */
  key: string;
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
    // the selected rover's ring: flat on the ground, unlit, over the decals
    const ring = new THREE.RingGeometry(1.55, 1.9, 40);
    ring.rotateX(-PI / 2);
    this.ring = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({
      color: 0xf5f7f9, transparent: true, opacity: 0.85, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
    }));
    this.ring.renderOrder = 2;
    this.ring.visible = false;
    this.ring.frustumCulled = false;
    this.group.add(this.mesh, this.decals, this.ring);
  }

  private ring: THREE.Mesh;
  /** the rover the inspector shows (its ring is drawn), by roster id */
  selected: number | null = null;

  /** Per frame: `dt` game seconds (0 while paused). */
  update(dt: number, state: GameState, sunDir: THREE.Vector3, sunLight: number) {
    this.clock += dt;
    this.frozen = dt <= 0;
    this.syncRects(state);
    this.syncFleet(state);
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

  /** The visuals follow the sim roster, keyed by rover id; the one lent to a
   *  survey is away. A rover with a site heads for its slot round that site's
   *  walls; the rest park in a row beside their dock. */
  private syncFleet(state: GameState) {
    const away = state.survey?.active?.rover;
    const roster = (state.rovers ?? []).filter((u) => u.id !== away).slice(0, MAX_ROVERS);
    const byId = new Map(this.rovers.map((r) => [r.id, r]));
    const at = new Map(state.buildings.map((b) => [b.id, b]));
    const crew = new Map<number, number[]>();
    const parked = new Map<number, number[]>();
    for (const u of roster) {
      const site = u.site !== null ? at.get(u.site) : undefined;
      if (site && (site.construction ?? 0) > 0) (crew.get(site.id) ?? crew.set(site.id, []).get(site.id)!).push(u.id);
      else (parked.get(u.home) ?? parked.set(u.home, []).get(u.home)!).push(u.id);
    }
    const next: Rover[] = [];
    for (const u of roster) {
      const dock = at.get(u.home) ?? state.buildings.find((b) => b.type === 'lander');
      if (!dock) continue;
      let r = byId.get(u.id);
      if (!r) {
        const list = parked.get(u.home) ?? [u.id];
        const [x, z] = this.parkSpot(dock, Math.max(0, list.indexOf(u.id)), list.length);
        r = { id: u.id, x, z, yaw: this.parkYaw(dock), v: 0, home: dock.id, site: null, key: '', path: [],
          face: this.parkYaw(dock), side: [1, 0], working: false, phase: u.id * 2.399 };
        r.key = `park:${dock.id}:${Math.max(0, list.indexOf(u.id))}/${list.length}`;
      }
      r.home = dock.id;
      const site = u.site !== null ? at.get(u.site) : undefined;
      const team = site ? crew.get(site.id) : undefined;
      if (site && team) {
        const key = `site:${site.id}:${team.indexOf(u.id)}/${team.length}`;
        if (key !== r.key) {
          r.key = key;
          r.site = site.id;
          const first = at.get((state.rovers ?? []).find((x) => x.id === team[0])?.home ?? dock.id) ?? dock;
          this.goSite(r, site, team.indexOf(u.id), team.length, centerOf(first));
        }
      } else {
        const list = parked.get(u.home) ?? [u.id];
        const k = Math.max(0, list.indexOf(u.id));
        const key = `park:${dock.id}:${k}/${list.length}`;
        if (key !== r.key) {
          r.key = key;
          r.site = null;
          this.goPark(r, dock, k, list.length);
        }
      }
      next.push(r);
    }
    this.rovers = next;
  }

  /** Parking spots in a row beside the dock (its local −x side first). */
  private parkSpot(dock: BuildingState, k: number, count: number): [number, number] {
    const [w, d] = BUILDINGS[dock.type].footprint;
    const hw = (w * CELL_M) / 2, hd = (d * CELL_M) / 2;
    const off = (k - (count - 1) / 2) * PARK_PITCH;
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

  private goPark(r: Rover, dock: BuildingState, k: number, count: number) {
    r.working = false;
    const [x, z] = this.parkSpot(dock, k, count);
    r.path = plan(r.x, r.z, x, z, this.rects);
    r.face = this.parkYaw(dock);
  }

  /** Work spot k of m round a site: the first just off the wall nearest the
   *  crew's dock, the rest spread evenly round the walls, off the corners so
   *  each shuffle stays along one wall. */
  private goSite(r: Rover, site: BuildingState, k: number, m: number, from: [number, number]) {
    const rect = worldRect(site);
    const x0 = rect.x0 - WORK_OUT, x1 = rect.x1 + WORK_OUT, z0 = rect.z0 - WORK_OUT, z1 = rect.z1 + WORK_OUT;
    const w = x1 - x0, d = z1 - z0, per = 2 * (w + d);
    // perimeter parameter, clockwise from the (x0, z0) corner: +x, +z, −x, −z
    const toU = (x: number, z: number): number => {
      const cx = clamp(x, x0, x1), cz = clamp(z, z0, z1);
      const e = [cz - z0, x1 - cx, z1 - cz, cx - x0];
      const i = e.indexOf(Math.min(...e));
      return i === 0 ? cx - x0 : i === 1 ? w + (cz - z0) : i === 2 ? w + d + (x1 - cx) : 2 * w + d + (z1 - cz);
    };
    const fromU = (u: number): { x: number; z: number; e: number } => {
      u = ((u % per) + per) % per;
      // off the corners
      const edge = (len: number, t: number) => clamp(t, Math.min(1.6, len / 2), Math.max(len - 1.6, len / 2));
      if (u < w) return { x: x0 + edge(w, u), z: z0, e: 2 };
      if (u < w + d) return { x: x1, z: z0 + edge(d, u - w), e: 1 };
      if (u < 2 * w + d) return { x: x1 - edge(w, u - w - d), z: z1, e: 3 };
      return { x: x0, z: z1 - edge(d, u - 2 * w - d), e: 0 };
    };
    const p = fromU(toU(from[0], from[1]) + (k * per) / Math.max(1, m));
    const [cx, cz] = centerOf(site);
    r.path = plan(r.x, r.z, p.x, p.z, this.rects);
    // face the wall: square to it, toward the centre
    r.face = p.e < 2 ? Math.atan2(cx - p.x, 0) : Math.atan2(0, cz - p.z);
    r.side = p.e < 2 ? [0, 1] : [1, 0];
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
    // picking reads fresh bounds: the rovers moved
    this.mesh.boundingSphere = null;
    const sel = this.selected === null ? undefined : this.rovers.find((r) => r.id === this.selected);
    this.ring.visible = !!sel;
    if (sel) {
      const pulse = 1 + 0.06 * Math.sin(this.clock * 3);
      this.ring.position.set(sel.x, this.hf.sample(sel.x, sel.z) + 0.08, sel.z);
      this.ring.scale.setScalar(pulse);
    }
  }

  /** The rover under a ray (its roster id), and how far along the ray. */
  pick(raycaster: THREE.Raycaster): { id: number; d: number } | null {
    const hit = raycaster.intersectObject(this.mesh, false).find((h) => h.instanceId !== undefined);
    const r = hit ? this.rovers[hit.instanceId!] : undefined;
    return r ? { id: r.id, d: hit!.distance } : null;
  }

  /** Where a rover is drawn (world), or null if it is away or unknown. */
  pose(id: number): { x: number; y: number; z: number; yaw: number } | null {
    const r = this.rovers.find((x) => x.id === id);
    return r ? { x: r.x, y: this.hf.sample(r.x, r.z), z: r.z, yaw: r.yaw } : null;
  }

  /** Every drawn rover's position (screen-space picking of a small target). */
  poses(): { id: number; x: number; y: number; z: number }[] {
    return this.rovers.map((r) => ({ id: r.id, x: r.x, y: this.hf.sample(r.x, r.z) + 0.8, z: r.z }));
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

  /** The rovers nearest the listener, for the audio layer: distance, bearing
   *  as a stereo pan, speed as a fraction of cruise, and whether printing.
   *  On foot the listener is the camera. From a command view it is the
   *  ground point in view (`focus`), lifted by a share of the camera's
   *  distance: what you look at is heard, and zooming out quietens it,
   *  whatever lens the view uses (the isometric one sits far off). */
  sounds(cam: THREE.Camera, focus: THREE.Vector3 | null = null): RoverSound[] {
    const out = this.soundList;
    out.length = 0;
    if (!this.rovers.length) return out;
    const p = cam.position;
    const lift = focus ? LISTENER_LIFT * p.distanceTo(focus) : 0;
    this.right.setFromMatrixColumn(cam.matrixWorld, 0);
    for (let i = 0; i < this.rovers.length; i++) {
      const r = this.rovers[i];
      const dx = r.x - p.x, dy = this.hf.sample(r.x, r.z) + 0.6 - p.y, dz = r.z - p.z;
      const d = focus ? Math.hypot(r.x - focus.x, r.z - focus.z, lift) : Math.hypot(dx, dy, dz);
      const pan = (dx * this.right.x + dy * this.right.y + dz * this.right.z) / Math.max(d, 1);
      const moving = this.frozen ? 0 : clamp(r.v / SPEED, 0, 1);
      out.push({ id: r.id, d, pan: clamp(pan * 0.9, -1, 1), speed: moving, working: !this.frozen && r.working && r.v < 0.1 });
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
      ids: this.rovers.map((r) => r.id),
      sites: this.rovers.map((r) => r.site),
      selected: this.selected,
      ring: this.ring.visible,
    };
  }
}
