/** The Regolith Excavator as a mobile digger, made visible (core/haul.ts).
 *
 *  Parked square on its pad, an excavator is drawn by the building
 *  instances like any structure (shadow, print reveal, floods). Anywhere
 *  else it is drawn here: one instance per digger away from its pad, the
 *  same recipe mesh and building material, chasing the sim's position (the
 *  sim moves it once a game-second; this glides after it with a heavy
 *  machine's turn rate), pitched and rolled to the ground, with a soft
 *  contact decal instead of a shadow-map shadow (a moving caster would
 *  re-render the map every frame). `onAway` tells the instances which pads
 *  to leave empty. Its tracks throw dust while it drives and the bucket
 *  wheel throws spoil while it digs, wherever it is. Game time: pause
 *  freezes it. */
import * as THREE from 'three';
import { HAUL } from '../data/balance';
import { haulSpeed } from '../core/haul';
import type { GameState } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import { centerOf } from '../buildings/instances';
import { recipeGeometry } from '../buildings/recipes';
import { upgradeKey } from '../buildings/upgrades';
import { withInstanceState } from '../buildings/meshKit';
import { litChannel } from '../buildings/buildingShader';
import { materials } from './materials';
import { blobTexture } from './rovers';
import type { DustEmitter } from './dust';

const MAX = 48;
const TURN = 2.2;          // rad/s: tracks turn on the spot
const PI = Math.PI;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

interface Digger {
  id: number;
  /** complete, enabled, powered: its lamps and windows may light */
  powered: boolean;
  x: number; z: number;
  /** rotation about +y, as a building's (−rot·π/2): local +x (the bucket wheel) leads */
  yaw: number;
  v: number;
  away: boolean;
  digging: boolean;
}

export class Haulers {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private decals: THREE.InstancedMesh;
  private decalMat: THREE.MeshBasicMaterial;
  private all = new Map<number, Digger>();
  /** the drawn ones (away from their pads), in instance order */
  private drawn: Digger[] = [];
  private awaySig = '';
  private m = new THREE.Matrix4();
  private bx = new THREE.Vector3();
  private by = new THREE.Vector3();
  private bz = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private sc = new THREE.Vector3();
  /** the pads to leave empty: diggers drawn here instead */
  onAway?: (ids: ReadonlySet<number>) => void;
  /** how dark a structure stands (buildings/darkness.ts): its lights follow it out */
  darkOf?: (id: number) => number;
  /** the recipe's upgrade key the mesh was built with (the same parts as the pad's) */
  private key = '';

  constructor(private hf: Heightfield) {
    this.mesh = new THREE.InstancedMesh(withInstanceState(recipeGeometry('excavator'), MAX),
      materials.get('building'), MAX);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-PI / 2);
    this.decalMat = new THREE.MeshBasicMaterial({
      color: 0x000000, alphaMap: blobTexture(), transparent: true, opacity: 0.45, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    this.decals = new THREE.InstancedMesh(plane, this.decalMat, MAX);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 1;
    this.group.add(this.mesh, this.decals);
  }

  /** Per frame: `dt` game seconds (0 while paused); `frac` the part of the
   *  next economy second already gone, so a driving digger is drawn where the
   *  sim will have it, not where it stood at the last tick. */
  update(dt: number, state: GameState, sunLight: number, frac = 0) {
    // research grows parts on the excavator: the digger wears them too (a
    // swap keeps the per-instance attributes, as the building instances do)
    const key = upgradeKey('excavator', state.techsDone);
    if (key !== this.key) {
      const old = this.mesh.geometry;
      this.mesh.geometry = withInstanceState(recipeGeometry('excavator', key), MAX, old);
      old.dispose();
      this.key = key;
    }
    const seen = new Set<number>();
    const speed = haulSpeed(state.techsDone);
    for (const b of state.buildings) {
      const h = b.haul;
      if (b.type !== 'excavator' || !h || (b.construction ?? 0) > 0) continue;
      seen.add(b.id);
      const [px, pz] = centerOf(b);
      const padYaw = -b.rot * PI / 2;
      // where the sim has it, advanced along its path by the tick fraction
      let x = h.x, z = h.z, want: number | null = null;
      const driving = (h.phase === 'toDig' || h.phase === 'toDrop') && h.path.length > 0;
      if (driving) {
        let left = b.active ? speed * clamp(frac, 0, 1) : 0;
        for (const [tx, tz] of h.path) {
          const d = Math.hypot(tx - x, tz - z);
          if (d > 1e-6) want = Math.atan2(-(tz - z), tx - x);
          if (left <= d) { if (d > 1e-6) { x += ((tx - x) / d) * left; z += ((tz - z) / d) * left; } break; }
          left -= d;
          x = tx;
          z = tz;
        }
      }
      let v = this.all.get(b.id);
      if (!v) {
        v = { id: b.id, powered: false, x, z, yaw: want ?? padYaw, v: 0, away: false, digging: false };
        this.all.set(b.id, v);
      }
      const moved = Math.hypot(x - v.x, z - v.z);
      v.v = dt > 0 ? Math.min(20, moved / dt) : 0;
      v.x = x;
      v.z = z;
      v.digging = h.phase === 'dig' && b.active;
      v.powered = b.enabled && b.idleReason !== 'power';
      // tracks turn on the spot: heading follows the leg being driven
      const home = Math.hypot(x - px, z - pz) < 0.3;
      const face = want ?? (home && h.phase === 'dig' ? padYaw : null);
      if (face !== null && dt > 0) v.yaw += clamp(wrap(face - v.yaw), -TURN * dt, TURN * dt);
      // home on its pad and squared up: the building instance takes over
      v.away = !home || Math.abs(wrap(padYaw - v.yaw)) > 0.02;
    }
    for (const id of [...this.all.keys()]) if (!seen.has(id)) this.all.delete(id);
    this.drawn = [...this.all.values()].filter((v) => v.away).slice(0, MAX);
    const sig = this.drawn.map((v) => v.id).join(',');
    if (sig !== this.awaySig) {
      this.awaySig = sig;
      this.onAway?.(new Set(this.drawn.map((v) => v.id)));
    }
    this.draw(sunLight);
  }

  private draw(sunLight: number) {
    const n = this.drawn.length;
    this.mesh.count = n;
    this.decals.count = n;
    this.decalMat.opacity = 0.45 * sunLight;
    this.decals.visible = sunLight > 0.02 && n > 0;
    const hf = this.hf;
    for (let i = 0; i < n; i++) {
      const v = this.drawn[i];
      const fx = Math.cos(v.yaw), fz = -Math.sin(v.yaw);   // forward (the wheel)
      const sx = Math.sin(v.yaw), sz = Math.cos(v.yaw);    // local +z
      const front = hf.sample(v.x + fx * 2.6, v.z + fz * 2.6), back = hf.sample(v.x - fx * 2.6, v.z - fz * 2.6);
      const left = hf.sample(v.x + sx * 1.5, v.z + sz * 1.5), right = hf.sample(v.x - sx * 1.5, v.z - sz * 1.5);
      const y = (front + back + left + right) / 4;
      // a basis on the ground: +x the forward tilt, +y the ground normal
      this.bx.set(fx * 5.2, front - back, fz * 5.2).normalize();
      this.bz.set(sx * 3, left - right, sz * 3).normalize();
      this.by.crossVectors(this.bz, this.bx).normalize();
      this.bz.crossVectors(this.bx, this.by).normalize();
      this.m.makeBasis(this.bx, this.by, this.bz).setPosition(v.x, y, v.z);
      this.mesh.setMatrixAt(i, this.m);
      this.q.setFromAxisAngle(this.by.set(0, 1, 0), v.yaw);
      this.m.compose(this.p.set(v.x, hf.sample(v.x, v.z) + 0.05, v.z), this.q, this.sc.set(9, 1, 5.2));
      this.decals.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.decals.instanceMatrix.needsUpdate = true;
    this.mesh.boundingSphere = null;
    // its lights as the pad's would be: the lit channel 0 / 2 + k, and classic's window level
    const g = this.mesh.geometry;
    const st = g.getAttribute('iState') as THREE.InstancedBufferAttribute;
    const glow = g.getAttribute('iGlow') as THREE.InstancedBufferAttribute | undefined;
    for (let i = 0; i < n; i++) {
      const v = this.drawn[i];
      const k = this.darkOf?.(v.id) ?? 0;
      st.setX(i, this.darkOf ? litChannel(v.powered, k) : v.powered ? 1 : 0);
      glow?.setX(i, v.powered ? (this.darkOf ? k : -1) : 0);
    }
    st.needsUpdate = true;
    if (glow) glow.needsUpdate = true;
  }

  /** The digger under a ray (its building id) and how far along the ray. */
  pick(raycaster: THREE.Raycaster): { id: number; d: number } | null {
    if (!this.drawn.length) return null;
    const hit = raycaster.intersectObject(this.mesh, false).find((h) => h.instanceId !== undefined);
    const v = hit ? this.drawn[hit.instanceId!] : undefined;
    return v ? { id: v.id, d: hit!.distance } : null;
  }

  /** Where an excavator is drawn (world), wherever it is. */
  pose(id: number): { x: number; y: number; z: number; yaw: number } | null {
    const v = this.all.get(id);
    return v ? { x: v.x, y: this.hf.sample(v.x, v.z), z: v.z, yaw: v.yaw } : null;
  }

  /** Spoil off the bucket wheel while digging (home or away), dust off the
   *  tracks while driving; nearest the camera first (BaseLife sorts). */
  emitters(cam: THREE.Vector3, out: { e: DustEmitter; d: number }[]) {
    for (const v of this.all.values()) {
      const c = Math.cos(v.yaw), sn = Math.sin(v.yaw);
      if (v.digging && v.v < 0.2) {
        const lx = 3.9, lz = 0.7; // the recipe's bucket wheel, front face
        const x = v.x + lx * c + lz * sn, z = v.z - lx * sn + lz * c;
        out.push({ d: Math.hypot(x - cam.x, z - cam.z), e: {
          x, y: this.hf.sample(x, z), z, strength: 0.7,
          vx: c * 0.9, vy: 1.3, vz: -sn * 0.9, hSpread: 0.9, vSpread: 1.1, h0: 0.3, size: 0.06,
        } });
      } else if (v.v > 0.6) {
        const k = Math.min(1, v.v / HAUL.speed);
        const x = v.x - c * 2.4, z = v.z + sn * 2.4;
        out.push({ d: Math.hypot(x - cam.x, z - cam.z), e: {
          x, y: this.hf.sample(x, z), z, strength: 0.55 + 0.4 * k,
          vx: -c * 1.1 * k, vy: 0.8, vz: sn * 1.1 * k, hSpread: 1.2, vSpread: 1.2, size: 0.07,
        } });
      }
    }
  }

  info() {
    return {
      count: this.all.size,
      away: this.drawn.map((v) => v.id),
      key: this.key,
      triangles: (this.mesh.geometry.index ? this.mesh.geometry.index.count : this.mesh.geometry.getAttribute('position').count) / 3,
      lit: this.drawn.map((_, i) => (this.mesh.geometry.getAttribute('iState') as THREE.InstancedBufferAttribute).getX(i)),
      dark: this.drawn.map((v) => this.darkOf?.(v.id) ?? null),
      material: (this.mesh.material as THREE.Material).type,
      poses: [...this.all.values()].map((v) => ({
        id: v.id, x: Math.round(v.x * 10) / 10, z: Math.round(v.z * 10) / 10, yaw: Math.round(v.yaw * 1000) / 1000, digging: v.digging, away: v.away,
      })),
    };
  }
}
