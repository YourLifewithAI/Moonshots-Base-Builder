/** The construction-rover fleet made visible: one instanced rover per unit
 *  in the sim's roster (`state.rovers`, core/fleet.ts), docked at the
 *  structures that supply them (the Lander, Robotics Bays); the one lent to
 *  a survey is away. A rover with a site drives out to it, prints (a shuffle
 *  along the wall, a small bob) and drives home to park when the sim frees
 *  it; several at one site spread round its walls. Every spot comes from
 *  core/spots.ts (no two share ground; none on a footprint or an
 *  excavator's lane). Paths are planned round every footprint
 *  (core/paths.ts) when the spot changes; on the way the ground traffic
 *  (world/traffic.ts) keeps the rovers off each other and out of the
 *  excavators' way. Heading follows the velocity with a turn-rate limit, and
 *  the chassis sits on the heightfield, pitched and rolled to it. The selected rover wears a
 *  ring; rovers are picked by instance (or by nearness on screen).
 *
 *  Rovers use the building material (same program, finishes, lamps and a
 *  blinking beacon; unlit twin in safe mode) and cast no shadow-map shadow —
 *  a moving caster would re-render the map every frame. A soft decal smeared
 *  down-sun stands in for it. Motion runs on game time: pause freezes them. */
import * as THREE from 'three';
import type { GameState } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import { UNIT, inside, lineClear, plan, ring, worldRect, type Rect } from '../core/paths';
import { PARK_OUT, roverSpots, type RoverSpot } from '../core/spots';
import { digsHome, keepOut } from '../core/haul';
import {
  BEACON, BODY, GLASS, LAMP, PLATE, TRIM, bar, box, cyl, dome, merge, withInstanceState,
} from '../buildings/meshKit';
import { materials } from './materials';
import type { DustEmitter } from './dust';
import { MAX_ROVER_VOICES, type RoverSound } from '../audio/roverVoices';
import { Traffic, type Agent, type Driver, type Pose } from './traffic';

const MAX_ROVERS = 64;
/** a command view's listener height, as a share of the camera's distance */
const LISTENER_LIFT = 0.3;
const SCALE = 1.25;
const SPEED = 4.5;        // m/s cruise
const ACCEL = 3;          // m/s²
const TURN = 2.4;         // rad/s
const CLEAR = 1.2;        // m kept off walls when planning
const STUCK_S = 2.5;      // s held up before it plans round whatever holds it
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
  /** where it is headed (its spot): a new key replans */
  key: string;
  spot: RoverSpot | null;
  path: [number, number][];
  /** yaw to settle to on arrival */
  face: number;
  /** along-wall direction of the print shuffle */
  side: [number, number];
  working: boolean;
  phase: number;
  /** s held up with somewhere to be; pushed off its line by traffic */
  stuck: number;
  pushed: boolean;
  agent: Agent;
  /** the move proposed this substep */
  next: { yaw: number; v: number };
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const spotKey = (p: RoverSpot) => `${p.site === null ? `park:${p.dock}` : `site:${p.site}`}@${p.x.toFixed(1)},${p.z.toFixed(1)}`;

export class RoverFleet implements Driver {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private decals: THREE.InstancedMesh;
  private decalMat: THREE.MeshBasicMaterial;
  private rovers: Rover[] = [];
  private byId = new Map<number, Rover>();
  private spots = new Map<number, RoverSpot>();
  private spotSig = '';
  private clock = 0;
  /** the ground traffic that moves them (its own, if none is shared) */
  readonly traffic: Traffic;
  private ownTraffic: boolean;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private p = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private right = new THREE.Vector3();
  /** the last update was paused: the fleet stands still, and is heard so */
  private frozen = false;
  private soundList: RoverSound[] = [];

  constructor(private hf: Heightfield, traffic?: Traffic) {
    this.traffic = traffic ?? new Traffic();
    this.ownTraffic = !traffic;
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

  /** Per frame: `dt` game seconds (0 while paused). With a shared traffic
   *  layer the owner calls sync(), steps the traffic, then draw(). */
  update(dt: number, state: GameState, sunDir: THREE.Vector3, sunLight: number) {
    if (this.ownTraffic) syncGround(this.traffic, state);
    this.sync(dt, state);
    if (this.ownTraffic) this.traffic.step(dt);
    this.draw(dt, sunDir, sunLight);
  }

  /** The visuals follow the sim roster, keyed by rover id; the one lent to a
   *  survey is away. Each rover's spot (core/spots.ts) — a work spot at its
   *  site, else a parking spot by its dock — and a path there when it moves. */
  sync(dt: number, state: GameState) {
    this.clock += dt;
    this.frozen = dt <= 0;
    const sig = spotSignature(state);
    if (sig !== this.spotSig) {
      this.spotSig = sig;
      this.spots = roverSpots(state, this.traffic.rects, this.spots);
    }
    const away = state.survey?.active?.rover;
    const roster = (state.rovers ?? []).filter((u) => u.id !== away).slice(0, MAX_ROVERS);
    const next: Rover[] = [];
    // new rovers parked first (their spots are their own), then those sent
    // straight out, beside the dock clear of everyone
    const order = [...roster].sort((p, q) => {
      const np = !this.byId.has(p.id) && this.spots.get(p.id)?.site != null ? 1 : 0;
      const nq = !this.byId.has(q.id) && this.spots.get(q.id)?.site != null ? 1 : 0;
      return np - nq;
    });
    const taken: [number, number, number][] = this.traffic.agents
      .filter((a) => a.kind !== 'rover').map((a) => [Traffic.cx(a), Traffic.cz(a), a.r]);
    for (const r of this.rovers) if (roster.some((u) => u.id === r.id)) taken.push([r.x, r.z, UNIT.rover.r]);
    for (const u of order) {
      const spot = this.spots.get(u.id);
      if (!spot) continue;
      let r = this.byId.get(u.id);
      if (!r) {
        // a new rover rolls out of its dock: on its parking spot, or (sent
        // straight to a site) the clear point beside the dock nearest the site
        const [sx, sz] = spot.site === null ? [spot.x, spot.z] : this.rollOut(state, spot, taken);
        taken.push([sx, sz, UNIT.rover.r]);
        r = {
          id: u.id, x: sx, z: sz, yaw: spot.face, v: 0, home: spot.dock, site: null, key: '', spot: null,
          path: [], face: spot.face, side: spot.side, working: false, phase: u.id * 2.399, stuck: 0, pushed: false,
          agent: null!, next: { yaw: spot.face, v: 0 },
        };
        r.agent = {
          kind: 'rover', id: u.id, key: 1e6 + u.id, x: r.x, z: r.z, fx: Math.sin(r.yaw), fz: Math.cos(r.yaw), vx: 0, vz: 0,
          r: UNIT.rover.r, off: UNIT.rover.off, wallM: UNIT.rover.body, cls: 1, still: true, anchored: false,
          home: null, cruise: SPEED, pvx: 0, pvz: 0, reach: 0, held: false, drv: this,
        };
        if (spot.site === null) {
          r.key = spotKey(spot);
          r.spot = spot;
        }
      }
      r.home = spot.dock;
      const key = spotKey(spot);
      if (key !== r.key) {
        r.key = key;
        r.spot = spot;
        r.site = spot.site;
        r.working = false;
        r.path = this.route(r, spot.x, spot.z);
      }
      r.face = spot.face;
      r.side = spot.side;
      r.agent.still = !r.path.length;
      next.push(r);
    }
    next.sort((p, q) => roster.findIndex((u) => u.id === p.id) - roster.findIndex((u) => u.id === q.id));
    this.rovers = next;
    this.byId = new Map(next.map((r) => [r.id, r]));
    this.traffic.enlist('rover', next.map((r) => r.agent));
  }

  /** Beside the dock, the ring point nearest the spot with room for a rover. */
  private rollOut(state: GameState, spot: RoverSpot, taken: readonly [number, number, number][]): [number, number] {
    const dock = state.buildings.find((b) => b.id === spot.dock);
    if (!dock) return [spot.x, spot.z];
    const rg = ring(worldRect(dock), PARK_OUT, 0);
    const u0 = rg.uOf(spot.x, spot.z);
    const rects = this.traffic.rects;
    for (let k = 0; k <= rg.len; k++) {
      for (const u of k ? [u0 + k, u0 - k] : [u0]) {
        const p = rg.at(u);
        if (rects.some((r) => inside(p.x, p.z, r, CLEAR))) continue;
        if (taken.some(([x, z, r]) => Math.hypot(x - p.x, z - p.z) < r + UNIT.rover.r + 0.2)) continue;
        return [p.x, p.z];
      }
    }
    return [spot.x, spot.z];
  }

  /** A path from where the rover is to (x, z), round every footprint (and
   *  `extra`: whatever holds it up). */
  private route(r: Rover, x: number, z: number, extra: Rect[] = []): [number, number][] {
    return plan(r.x, r.z, x, z, [...this.traffic.planRects(), ...extra], CLEAR);
  }

  // ── the traffic driver ──

  prefer(a: Agent) {
    const r = this.byId.get(a.id)!;
    const spot = r.spot;
    // pushed off its line: back to the spot, or on round what now stands between
    if (r.pushed) {
      r.pushed = false;
      const [tx, tz] = r.path[0] ?? (spot ? [spot.x, spot.z] : [r.x, r.z]);
      if (Math.hypot(tx - r.x, tz - r.z) > 0.3 && !lineClear(r.x, r.z, tx, tz, this.traffic.planRects(), CLEAR * 0.9) && spot) {
        r.path = this.route(r, spot.x, spot.z);
      }
    }
    if (!r.path.length && spot && Math.hypot(spot.x - r.x, spot.z - r.z) > 0.3) r.path = [[spot.x, spot.z]];
    if (!r.path.length) { a.pvx = 0; a.pvz = 0; a.reach = 0; a.still = true; return; }
    a.still = false;
    let [tx, tz] = r.path[0];
    let d = Math.hypot(tx - r.x, tz - r.z);
    while (r.path.length > 1 && d < 1.2) {
      r.path.shift();
      [tx, tz] = r.path[0];
      d = Math.hypot(tx - r.x, tz - r.z);
    }
    if (r.path.length === 1 && d < 0.04) {
      r.path.length = 0;
      a.pvx = 0; a.pvz = 0; a.reach = 0; a.still = true;
      return;
    }
    let remain = d;
    for (let i = 1; i < r.path.length; i++) {
      remain += Math.hypot(r.path[i][0] - r.path[i - 1][0], r.path[i][1] - r.path[i - 1][1]);
    }
    const cruise = Math.min(SPEED, Math.sqrt(2 * ACCEL * remain) + 0.3);
    a.reach = remain;
    a.pvx = (tx - r.x) / d * cruise;
    a.pvz = (tz - r.z) / d * cruise;
  }

  propose(a: Agent, vx: number, vz: number, dt: number, out: Pose, turn = false) {
    const r = this.byId.get(a.id)!;
    const sp = Math.hypot(vx, vz);
    const pv = Math.hypot(a.pvx, a.pvz);
    // heading: along the velocity; standing, toward where it wants to go, or its spot's facing
    const want = sp > 0.05 ? Math.atan2(vx, vz) : pv > 0.05 ? Math.atan2(a.pvx, a.pvz) : r.path.length ? r.yaw : r.face;
    const yaw = r.yaw + clamp(wrap(want - r.yaw), -TURN * dt, TURN * dt);
    let v = 0;
    if (turn) {
      out.x = r.x; out.z = r.z; out.fx = Math.sin(yaw); out.fz = Math.cos(yaw);
      r.next = { yaw, v: 0 };
      return;
    }
    const [tx, tz] = r.path[0] ?? [r.x, r.z];
    const d = Math.hypot(tx - r.x, tz - r.z);
    if (r.path.length === 1 && d < 0.4 && sp > 1e-6 && Math.hypot(vx - a.pvx, vz - a.pvz) < 0.1) {
      // the last few centimetres onto its spot: an inching slide, square on
      const step = Math.min(d, 0.6 * dt);
      out.x = r.x + ((tx - r.x) / d) * step;
      out.z = r.z + ((tz - r.z) / d) * step;
      const y2 = r.yaw + clamp(wrap(r.face - r.yaw), -TURN * dt, TURN * dt);
      out.fx = Math.sin(y2); out.fz = Math.cos(y2);
      r.next = { yaw: y2, v: step / Math.max(dt, 1e-6) };
      return;
    }
    if (sp > 1e-6) {
      const off = wrap(want - yaw);
      const target = sp * Math.max(0, Math.cos(off)) ** 2;
      v = Math.max(0, r.v + clamp(target - r.v, -2 * ACCEL * dt, ACCEL * dt));
    }
    // never past the waypoint
    const len = Math.min(v * dt, r.path.length ? d : v * dt);
    out.x = r.x + Math.sin(yaw) * len;
    out.z = r.z + Math.cos(yaw) * len;
    out.fx = Math.sin(yaw);
    out.fz = Math.cos(yaw);
    r.next = { yaw, v };
  }

  commit(a: Agent, p: Pose | null, dt: number) {
    const r = this.byId.get(a.id)!;
    if (!p) {
      r.v = 0;
    } else {
      r.x = p.x; r.z = p.z; r.yaw = r.next.yaw; r.v = r.next.v;
      a.x = p.x; a.z = p.z; a.fx = p.fx; a.fz = p.fz;
    }
    // held up, or steered off the line it wanted: it may need a new way
    const pv = Math.hypot(a.pvx, a.pvz);
    if (pv > 0.05) {
      const took = p ? Math.hypot(a.vx - a.pvx, a.vz - a.pvz) : pv;
      if (took > 0.25 * pv) r.pushed = true;
      r.stuck = !p || r.v < 0.1 ? r.stuck + dt : 0;
      if (r.stuck > STUCK_S && r.spot) {
        r.stuck = 0;
        // plan round the units standing about it
        const extra: Rect[] = [];
        const out: Agent[] = [];
        for (const b of this.traffic.near(a, r.x, r.z, 12, out)) {
          if (b.still || b.held || Math.hypot(b.vx, b.vz) < 0.2) {
            const bx = Traffic.cx(b), bz = Traffic.cz(b);
            if (Math.hypot(bx - r.spot.x, bz - r.spot.z) > b.r + a.r) extra.push(keepOut(5000 + b.key, bx, bz, b.r));
          }
        }
        r.path = this.route(r, r.spot.x, r.spot.z, extra);
      }
    } else {
      r.stuck = 0;
    }
    r.working = r.site !== null && !r.path.length && r.v < 0.1 &&
      !!r.spot && Math.hypot(r.spot.x - r.x, r.spot.z - r.z) < 0.5;
    if (!r.path.length && r.v < 0.1) r.v = 0;
  }

  draw(_dt: number, sunDir: THREE.Vector3, sunLight: number) {
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
      /** where each is headed (its spot), and the legs left to it */
      spots: this.rovers.map((r) => (r.spot ? [Math.round(r.spot.x * 10) / 10, Math.round(r.spot.z * 10) / 10] : null)),
      legs: this.rovers.map((r) => r.path.length),
      yaws: this.rovers.map((r) => Math.round(r.yaw * 100) / 100),
      selected: this.selected,
      ring: this.ring.visible,
    };
  }
}

/** What the spots depend on: the footprints and sites, the roster, and
 *  where the excavators dig, stand and drive. */
export function spotSignature(s: GameState): string {
  let k = '';
  for (const b of s.buildings) {
    k += `${b.id}:${b.type}:${b.gx},${b.gz},${b.rot}:${(b.construction ?? 0) > 0 ? 1 : 0}${b.enabled ? 1 : 0}`;
    const h = b.haul;
    if (h) {
      const e = h.route?.[h.route.length - 1];
      k += `/${h.digX.toFixed(1)},${h.digZ.toFixed(1)},${h.phase},${e ? `${e[0].toFixed(1)},${e[1].toFixed(1)}` : ''}`;
    }
    k += ';';
  }
  k += '|';
  for (const r of s.rovers ?? []) k += `${r.id}:${r.home}:${r.site};`;
  return `${k}|${s.survey?.active?.rover ?? ''}`;
}

/** The traffic's footprints and keep-outs from the state (on change only). */
export function syncGround(t: Traffic, s: GameState) {
  let sig = '';
  for (const b of s.buildings) {
    sig += `${b.id}:${b.gx},${b.gz},${b.rot};`;
    if (b.type === 'excavator' && b.haul && (b.construction ?? 0) <= 0) sig += `d${b.haul.digX.toFixed(2)},${b.haul.digZ.toFixed(2)};`;
  }
  if (sig === t.groundSig) return;
  const rects = s.buildings.map(worldRect);
  const keep: Rect[] = [];
  for (const b of s.buildings) {
    if (b.type !== 'excavator' || !b.haul || (b.construction ?? 0) > 0 || digsHome(b)) continue;
    keep.push(keepOut(b.id, b.haul.digX, b.haul.digZ));
  }
  t.setRects(sig, rects, keep);
}
