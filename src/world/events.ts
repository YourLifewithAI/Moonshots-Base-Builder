/** Event visuals, read off the state the game logic already writes:
 *
 *  - Mass-driver launch (fired from Game.doLaunch after a volley leaves): a
 *    white-hot capsule accelerates up the rail, lights a kick motor at the
 *    muzzle and pitches up into the black, dragging a fading trail. Real
 *    time (a launch is watchable at ×10), frozen while paused.
 *  - Earth resupply (state.resupply): a cargo lander descends over the last
 *    12 game seconds before `arriveAt` on a braking burn — plume cone, then
 *    a flat radial sheet of dust once it is low — sits for 30 s, and lifts
 *    off again. Pure function of simTime, so saves, pauses and time jumps
 *    all land on the right frame.
 *
 *  Capsule, glow, trail and plume are stock unlit materials; the cargo lander
 *  is building material (its twin in safe mode), casting a shadow only while
 *  it stands still. Blended layers stay out of safe mode, as in the sky. */
import * as THREE from 'three';
import type { BuildingState, GameState } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import { CELL_M, MAP_M } from '../data/balance';
import { centerOf, footprintRect } from '../buildings/instances';
import {
  BEACON, BODY, FOIL, PLATE, TRIM, antenna, bar, box, cyl, merge, withInstanceState,
} from '../buildings/meshKit';
import { materials } from './materials';
import type { DustEmitter } from './dust';

const PI = Math.PI;

/** Radial alpha sprite texture. */
function glowTexture(): THREE.DataTexture {
  const N = 64;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const r = Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) / (N / 2);
      const a = Math.min(1, 0.7 * Math.exp(-((r / 0.18) ** 2)) + 0.3 * Math.max(0, 1 - r) ** 3);
      const o = (y * N + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = 255;
      data[o + 3] = Math.round(a * 255);
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// ───────────────────────────── launch ─────────────────────────────

const RAIL_TILT = 0.18;                 // the recipe's rail pitch
const RAIL_X0 = -7.0, RAIL_X1 = 10.4;   // capsule travel along the rail (building-local x)
const RAIL_A = 55;                      // m/s² on the rail
const KICK_A = 30;                      // m/s² kick motor after the muzzle
const CLIMB = 0.62;                     // rad the flight pitches up to
const FLIGHT_S = 7;
const TRAIL_S = 1.3;
const TRAIL_N = 48;
const TABLE_DT = 1 / 60;
const HDR = 9;
const MAX_FLIGHTS = 3;

interface Flight { t: number; path: Float32Array; rig: Rig }
interface Rig { capsule: THREE.Mesh; glow: THREE.Sprite; trail: THREE.Line }

export class LaunchFx {
  readonly group = new THREE.Group();
  private rigs: Rig[] = [];
  private flights: Flight[] = [];
  private glowTex = glowTexture();
  launched = 0;

  constructor(private hf: Heightfield) {
    const capGeo = new THREE.CapsuleGeometry(0.22, 0.8, 4, 10);
    capGeo.rotateX(PI / 2); // long axis along +z
    for (let i = 0; i < MAX_FLIGHTS; i++) {
      const capsule = new THREE.Mesh(capGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(HDR) }));
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTex, color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true,
        depthWrite: false, sizeAttenuation: false,
      }));
      glow.renderOrder = 6;
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
      tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
      const trail = new THREE.Line(tg, new THREE.LineBasicMaterial({
        vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      }));
      trail.frustumCulled = false;
      trail.renderOrder = 6;
      for (const o of [capsule, glow, trail]) { o.visible = false; this.group.add(o); }
      capsule.frustumCulled = false;
      this.rigs.push({ capsule, glow, trail });
    }
  }

  /** A volley just left: fly it from the first completed mass driver. */
  fire(state: GameState): boolean {
    const md = state.buildings.find((b) => b.type === 'massDriver' && (b.construction ?? 0) <= 0);
    if (!md) return false;
    const free = this.rigs.find((r) => !this.flights.some((f) => f.rig === r));
    if (!free) return false;
    this.flights.push({ t: 0, path: this.flightPath(md), rig: free });
    this.launched++;
    return true;
  }

  /** Positions every TABLE_DT from launch to FLIGHT_S (world, xyz). */
  private flightPath(md: BuildingState): Float32Array {
    const [cx, cz] = centerOf(md);
    const gy = this.hf.sample(cx, cz);
    const a = -md.rot * PI / 2, c = Math.cos(a), s = Math.sin(a);
    const h = new THREE.Vector3(c, 0, -s); // local +x in world
    const railY = (x: number) => 3.3 + Math.tan(RAIL_TILT) * (x - 0.6) + 1.15;
    const start = new THREE.Vector3(cx + RAIL_X0 * c, gy + railY(RAIL_X0), cz - RAIL_X0 * s);
    const len = (RAIL_X1 - RAIL_X0) / Math.cos(RAIL_TILT);
    const dir = (pitch: number) => h.clone().multiplyScalar(Math.cos(pitch)).setY(Math.sin(pitch));
    const n = Math.ceil(FLIGHT_S / TABLE_DT) + 1;
    const out = new Float32Array(n * 3);
    const p = start.clone();
    const tRail = Math.sqrt((2 * len) / RAIL_A);
    let v = 0;
    for (let i = 0; i < n; i++) {
      const t = i * TABLE_DT;
      if (t <= tRail) {
        p.copy(start).addScaledVector(dir(RAIL_TILT), 0.5 * RAIL_A * t * t);
        v = RAIL_A * t;
      } else {
        const k = t - tRail;
        const pitch = RAIL_TILT + (CLIMB - RAIL_TILT) * (1 - Math.exp(-k / 0.9));
        v += KICK_A * TABLE_DT;
        p.addScaledVector(dir(pitch), v * TABLE_DT);
      }
      out.set([p.x, p.y, p.z], i * 3);
    }
    return out;
  }

  private at(path: Float32Array, t: number, out: THREE.Vector3): THREE.Vector3 {
    const f = Math.min(Math.max(t, 0) / TABLE_DT, path.length / 3 - 1.001);
    const i = Math.floor(f), k = f - i;
    return out.set(
      path[i * 3] + (path[i * 3 + 3] - path[i * 3]) * k,
      path[i * 3 + 1] + (path[i * 3 + 4] - path[i * 3 + 1]) * k,
      path[i * 3 + 2] + (path[i * 3 + 5] - path[i * 3 + 2]) * k,
    );
  }

  /** `dt` real seconds (0 while paused). */
  update(dt: number) {
    const p = new THREE.Vector3(), q = new THREE.Vector3();
    for (const f of this.flights) f.t += dt;
    this.flights = this.flights.filter((f) => {
      const done = f.t > FLIGHT_S + TRAIL_S;
      if (done) for (const o of Object.values(f.rig)) o.visible = false;
      return !done;
    });
    const safe = materials.safeMode;
    for (const f of this.flights) {
      const { capsule, glow, trail } = f.rig;
      const flying = f.t < FLIGHT_S;
      this.at(f.path, f.t, p);
      this.at(f.path, f.t + 0.02, q);
      capsule.visible = flying;
      capsule.position.copy(p);
      capsule.lookAt(q);
      const fade = 1 - Math.min(1, Math.max(0, (f.t - (FLIGHT_S - 1.5)) / 1.5));
      glow.visible = flying && !safe;
      glow.position.copy(p);
      glow.scale.setScalar(0.05 * (0.6 + 0.4 * fade));
      glow.material.opacity = fade;
      trail.visible = !safe;
      const pos = trail.geometry.getAttribute('position') as THREE.BufferAttribute;
      const col = trail.geometry.getAttribute('color') as THREE.BufferAttribute;
      const head = Math.min(f.t, FLIGHT_S);
      const tail = Math.max(0, f.t - TRAIL_S);
      const after = f.t > FLIGHT_S ? 1 - (f.t - FLIGHT_S) / TRAIL_S : 1;
      for (let i = 0; i < TRAIL_N; i++) {
        const u = i / (TRAIL_N - 1);
        this.at(f.path, tail + (head - tail) * u, q);
        pos.setXYZ(i, q.x, q.y, q.z);
        const b = 2.2 * u * u * after;
        col.setXYZ(i, b, b, b);
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
    }
  }

  info() {
    const f = this.flights[0];
    return {
      launched: this.launched,
      inFlight: this.flights.length,
      capsule: f ? f.rig.capsule.position.toArray().map((v) => Math.round(v * 10) / 10) : null,
      t: f ? f.t : null,
    };
  }
}

// ──────────────────────────── resupply ────────────────────────────

const DESCENT_S = 12;
const LANDED_S = 30;
const ASCENT_S = 12;
const DESCENT_H = 220;   // m above the pad at the start of the burn
const DESCENT_D = 170;   // m of approach, from Earth's side
const DUST_ALT = 28;     // m: the sheet starts below this
const PAD_R = 7;         // m clear around the touchdown point

function cargoLanderGeometry(): THREE.BufferGeometry {
  const p: (THREE.BufferGeometry | THREE.BufferGeometry[])[] = [
    cyl(1.5, 1.7, 2.2, BODY, 0, 2.7, 0, 0, 0, 22),
    cyl(1.72, 1.74, 0.5, FOIL, 0, 1.6, 0, 0, 0, 22, true),
    cyl(1.3, 1.5, 0.3, TRIM, 0, 3.95, 0, 0, 0, 22),
    cyl(0.5, 0.85, 0.9, TRIM, 0, 1.0, 0, 0, 0, 16, true),
    box(1.3, 0.9, 1.1, PLATE, -0.5, 4.55, 0.1),
    box(0.9, 0.7, 0.9, BODY, 0.75, 4.45, -0.35),
    box(0.8, 0.5, 0.7, TRIM, 0.45, 4.35, 0.75),
    antenna(-0.9, 4.1, -0.9, 1.4),
  ];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2 + PI / 4, c = Math.cos(a), s = Math.sin(a);
    p.push(
      bar([1.45 * c, 2.2, 1.45 * s], [3.0 * c, 0.12, 3.0 * s], 0.16, TRIM),
      bar([1.6 * c, 1.4, 1.6 * s], [2.4 * c, 0.9, 2.4 * s], 0.08, PLATE),
      cyl(0.42, 0.52, 0.1, TRIM, 3.0 * c, 0.05, 3.0 * s, 0, 0, 12),
    );
  }
  p.push(cyl(0.12, 0.12, 0.1, BEACON, 0, 4.15, 1.35, 0, 0, 8));
  return merge(p);
}

export class ResupplyFx {
  readonly group = new THREE.Group();
  private lander: THREE.InstancedMesh;
  private plume: THREE.Mesh;
  private plumeMat: THREE.MeshBasicMaterial;
  private spot: [number, number, number] | null = null;
  private spotFor = -1;
  private shadowOn = false;
  private phase: 'idle' | 'descent' | 'landed' | 'ascent' = 'idle';
  private alt = 0;
  private throttle = 0;
  private flicker = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  /** fired when the lander starts or stops casting a shadow */
  onShadowCastersChanged?: () => void;

  constructor(private hf: Heightfield) {
    this.lander = new THREE.InstancedMesh(withInstanceState(cargoLanderGeometry(), 1), materials.get('building'), 1);
    this.lander.customDepthMaterial = materials.get('buildingDepth');
    this.lander.receiveShadow = true;
    this.lander.castShadow = false;
    this.lander.frustumCulled = false;
    this.lander.visible = false;
    // a faint frustum from the bell's lip, widening and fading downward
    const cone = new THREE.CylinderGeometry(0.75, 1.9, 1, 20, 6, true);
    cone.translate(0, -0.5, 0);
    const pos = cone.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const v = Math.max(0, 1 + pos.getY(i)) ** 3;
      col[i * 3] = v; col[i * 3 + 1] = v * 0.97; col[i * 3 + 2] = v * 0.92;
    }
    cone.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.plumeMat = new THREE.MeshBasicMaterial({
      vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    });
    this.plume = new THREE.Mesh(cone, this.plumeMat);
    this.plume.frustumCulled = false;
    this.plume.renderOrder = 5;
    this.plume.visible = false;
    this.group.add(this.lander, this.plume);
  }

  /** A pad beside the base, on Earth's side: clear of footprints, level. */
  private pickSpot(state: GameState, earthAzim: number): [number, number, number] {
    const lander = state.buildings.find((b) => b.type === 'lander');
    const [lx, lz] = lander ? centerOf(lander) : [0, 0];
    const rects = state.buildings.map((b) => {
      const r = footprintRect(b);
      return [r.gx0 * CELL_M - MAP_M / 2, r.gz0 * CELL_M - MAP_M / 2, r.gx1 * CELL_M - MAP_M / 2, r.gz1 * CELL_M - MAP_M / 2];
    });
    const lim = MAP_M / 2 - 30;
    for (const r of [36, 46, 58, 72, 90]) {
      for (let k = 0; k < 24; k++) {
        const a = earthAzim + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (PI / 12);
        const x = lx + Math.cos(a) * r, z = lz + Math.sin(a) * r;
        if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
        if (rects.some(([x0, z0, x1, z1]) => x > x0 - PAD_R && x < x1 + PAD_R && z > z0 - PAD_R && z < z1 + PAD_R)) continue;
        const hs = [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]].map(([dx, dz]) => this.hf.sample(x + dx, z + dz));
        if (Math.max(...hs) - Math.min(...hs) > 1.2) continue;
        return [x, this.hf.sample(x, z), z];
      }
    }
    const x = lx + Math.cos(earthAzim) * 40, z = lz + Math.sin(earthAzim) * 40;
    return [x, this.hf.sample(x, z), z];
  }

  /** Per frame from state; `t` runs from −12 (burn) through 0 (touchdown).
   *  `earthAzim` is Earth's azimuth in the sky (the approach side). */
  update(state: GameState, earthAzim: number, dt: number) {
    const rs = state.resupply;
    const t = rs ? state.simTime - rs.arriveAt : 0;
    const on = !!rs && rs.arriveAt > 0 && (rs.pending ? t >= -DESCENT_S : rs.shipments > 0 && t >= 0)
      && t < LANDED_S + ASCENT_S;
    if (!on) {
      this.phase = 'idle';
      this.lander.visible = this.plume.visible = false;
      this.setShadow(false);
      return;
    }
    if (this.spotFor !== rs!.arriveAt || !this.spot) {
      this.spot = this.pickSpot(state, earthAzim);
      this.spotFor = rs!.arriveAt;
    }
    const [sx, sy, sz] = this.spot;
    const ax = Math.cos(earthAzim), az = Math.sin(earthAzim);
    let alt: number, off: number, tilt = 0, thrust: number;
    if (t < 0) {
      const u = -t / DESCENT_S;
      this.phase = 'descent';
      alt = DESCENT_H * u * u;
      off = DESCENT_D * u ** 2.2;
      tilt = 0.32 * u;
      thrust = 1;
    } else if (t < LANDED_S) {
      this.phase = 'landed';
      alt = 0; off = 0;
      thrust = Math.max(0, 1 - t / 0.5);
    } else {
      const k = t - LANDED_S;
      this.phase = 'ascent';
      alt = 2.5 * k * k;
      off = 0.7 * k * k;
      tilt = 0.12 * Math.min(1, k / 3);
      thrust = Math.min(1, k / 0.4);
    }
    this.alt = alt;
    this.throttle = thrust;
    const x = sx + ax * off, z = sz + az * off, y = sy + alt;
    // lean back against the approach while braking
    this.q.setFromAxisAngle(new THREE.Vector3(az, 0, -ax), tilt);
    this.lander.setMatrixAt(0, this.m.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(1, 1, 1)));
    this.lander.instanceMatrix.needsUpdate = true;
    this.lander.visible = true;
    this.setShadow(this.phase === 'landed');

    this.flicker += dt;
    const len = Math.min(9, Math.max(0.4, alt + 0.3)) * (0.9 + 0.1 * Math.sin(this.flicker * 37));
    const wide = 1 + 0.8 * Math.max(0, 1 - alt / 10); // flares out in ground effect
    this.plume.visible = thrust > 0.01 && !materials.safeMode;
    this.plume.position.set(0, 0.55, 0).applyQuaternion(this.q).add(new THREE.Vector3(x, y, z));
    this.plume.quaternion.copy(this.q);
    this.plume.scale.set(wide, len, wide);
    this.plumeMat.color.setScalar(0.14 * thrust);
  }

  private setShadow(on: boolean) {
    if (on === this.shadowOn) return;
    this.shadowOn = on;
    this.lander.castShadow = on;
    this.onShadowCastersChanged?.();
  }

  /** The dust sheet under a low engine: flat and fast, six slots' worth. */
  emitters(out: DustEmitter[]) {
    if (!this.spot || this.phase === 'idle' || this.throttle <= 0.01 || this.alt > DUST_ALT) return;
    const k = (1 - this.alt / DUST_ALT) * this.throttle;
    const [x, y, z] = this.spot;
    for (let i = 0; i < 6; i++) {
      out.push({ x, y, z, strength: k, vx: 0, vy: 0.2 + 0.15 * i, vz: 0,
        hSpread: 5 + 2.5 * i, vSpread: 0.4 + 0.25 * i, size: 0.16 });
    }
  }

  info() {
    return {
      phase: this.phase,
      alt: Math.round(this.alt * 10) / 10,
      spot: this.spot ? this.spot.map((v) => Math.round(v)) : null,
      shadow: this.shadowOn,
      material: (this.lander.material as THREE.Material).type,
    };
  }
}

