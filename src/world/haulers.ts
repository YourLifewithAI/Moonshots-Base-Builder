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
import { digsHome, haulSpeed } from '../core/haul';
import type { BuildingState, GameState, HaulState } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import { centerOf } from '../buildings/instances';
import { recipeGeometry } from '../buildings/recipes';
import { upgradeKey } from '../buildings/upgrades';
import { withInstanceState } from '../buildings/meshKit';
import { litChannel } from '../buildings/buildingShader';
import { UNIT, lineClear, pathLength, plan } from '../core/paths';
import { materials } from './materials';
import { blobTexture } from './rovers';
import type { DustEmitter } from './dust';
import type { Agent, Driver, Pose, Traffic } from './traffic';

const MAX = 48;
const TURN = 2.2;          // rad/s: tracks turn on the spot
const CATCH = 1.6;         // × haul speed: the most a digger drives to catch up with the sim
const GAIN = 1.5;          // 1/s: how hard it closes the gap
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
  /** the ground it drives: from where it stood when the sim's leg began (or
   *  where it was, lagging), through the sim's legs since */
  track: [number, number][];
  /** arc lengths along the track (cumulative, from track[0]) */
  arc: number[];
  /** how far along it has come, m, and where the sim is along it (the goal) */
  s: number;
  target: number;
  /** the sim's leg it last took on (a new one extends the track) */
  leg: string;
  /** the sim drives now (m/s along the track), 0 while it digs or unloads */
  simV: number;
  /** game-seconds of sim time this frame against the visuals' (≥ 1: slow frames) */
  pace: number;
  /** the pad's heading, and whether the sim has it digging on its pad */
  padYaw: number;
  homeDig: boolean;
  pad: [number, number];
  agent: Agent;
  /** a move proposed this substep */
  next: { yaw: number; s: number; on: boolean };
}

/** The point at arc length u along a track (and the segment it is on). */
function along(t: [number, number][], arc: number[], u: number): { x: number; z: number; i: number } {
  if (t.length === 1 || u <= 0) return { x: t[0][0], z: t[0][1], i: 0 };
  for (let i = 1; i < t.length; i++) {
    if (u <= arc[i] || i === t.length - 1) {
      const l = arc[i] - arc[i - 1];
      const k = l > 1e-9 ? clamp((u - arc[i - 1]) / l, 0, 1) : 1;
      return { x: t[i - 1][0] + (t[i][0] - t[i - 1][0]) * k, z: t[i - 1][1] + (t[i][1] - t[i - 1][1]) * k, i };
    }
  }
  const e = t[t.length - 1];
  return { x: e[0], z: e[1], i: t.length - 1 };
}

function arcs(t: [number, number][]): number[] {
  const out = [0];
  for (let i = 1; i < t.length; i++) out.push(out[i - 1] + Math.hypot(t[i][0] - t[i - 1][0], t[i][1] - t[i - 1][1]));
  return out;
}

/** The arc of the track point nearest (x, z), searched from `from` − 1 m to `to`. */
function project(t: [number, number][], arc: number[], x: number, z: number, from: number, to: number): { u: number; d: number } {
  let best = { u: from, d: Infinity };
  for (let i = 1; i < t.length; i++) {
    if (arc[i] < from - 1 || arc[i - 1] > to) continue;
    const [ax, az] = t[i - 1], [bx, bz] = t[i];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const k = l2 > 1e-9 ? clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1) : 0;
    const d = Math.hypot(x - ax - dx * k, z - az - dz * k);
    if (d < best.d) best = { u: arc[i - 1] + Math.sqrt(l2) * k, d };
  }
  if (t.length === 1) best = { u: 0, d: Math.hypot(x - t[0][0], z - t[0][1]) };
  return best;
}

/** The sim's leg as a track: the whole route (or, from an old save, what is left of it). */
function legOf(h: HaulState): [number, number][] {
  if (h.route?.length) return h.route.map(([x, z]): [number, number] => [x, z]);
  return [[h.x, h.z], ...h.path.map(([x, z]): [number, number] => [x, z])];
}
const legKey = (h: HaulState) => {
  const t = h.route?.length ? h.route : null;
  const f = (v: number) => v.toFixed(2);
  return t ? `${f(t[0][0])},${f(t[0][1])}>${f(t[t.length - 1][0])},${f(t[t.length - 1][1])}#${t.length}`
    : `old>${h.path.length ? `${f(h.path[h.path.length - 1][0])},${f(h.path[h.path.length - 1][1])}` : `${f(h.x)},${f(h.z)}`}`;
};

export class Haulers implements Driver {
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
  /** the sim clock at the last frame: time the visuals missed is caught up, or jumped */
  private lastSim: number | null = null;
  private speed = HAUL.speed;
  /** the most any digger has trailed the sim since the last read, game-seconds */
  private lagMax = 0;

  constructor(private hf: Heightfield, private traffic?: Traffic) {
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
   *  next economy second already gone, so a driving digger heads for where
   *  the sim will have it, not where it stood at the last tick. Then the
   *  traffic step moves it (or the fallback, alone) and draw() shows it. */
  update(dt: number, state: GameState, sunLight: number, frac = 0) {
    this.sync(dt, state, frac);
    if (!this.traffic) {
      // no traffic layer: straight to where the sim has it
      for (const v of this.all.values()) this.jump(v);
    }
    this.finish(dt, sunLight);
  }

  /** Before the traffic step: follow the sim — its legs extend each digger's
   *  track, its position sets how far along the digger should be. */
  sync(dt: number, state: GameState, frac = 0) {
    // research grows parts on the excavator: the digger wears them too (a
    // swap keeps the per-instance attributes, as the building instances do)
    const key = upgradeKey('excavator', state.techsDone);
    if (key !== this.key) {
      const old = this.mesh.geometry;
      this.mesh.geometry = withInstanceState(recipeGeometry('excavator', key), MAX, old);
      old.dispose();
      this.key = key;
    }
    const simDelta = this.lastSim === null ? Infinity : state.simTime - this.lastSim;
    this.lastSim = state.simTime;
    // sim time the visuals were not shown (debug advances, a load, a long
    // stall): jump; a slow frame's shortfall is driven faster instead
    const jumped = simDelta < 0 || (dt <= 0 ? simDelta > 1e-6 : simDelta - dt > 3);
    const pace = dt > 0 ? clamp(simDelta / dt, 1, 5) : 1;
    const seen = new Set<number>();
    const speed = this.speed = haulSpeed(state.techsDone);
    for (const b of state.buildings) {
      const h = b.haul;
      if (b.type !== 'excavator' || !h || (b.construction ?? 0) > 0) continue;
      seen.add(b.id);
      const pad = centerOf(b);
      const padYaw = -b.rot * PI / 2;
      const driving = (h.phase === 'toDig' || h.phase === 'toDrop') && h.path.length > 0 && b.active;
      // how much of the leg the sim has left, advanced by the tick fraction
      const rem = Math.max(0, pathLength(h.x, h.z, h.path) - (driving ? speed * clamp(frac, 0, 1) : 0));
      let v = this.all.get(b.id);
      if (!v) {
        v = {
          id: b.id, powered: false, x: h.x, z: h.z, yaw: padYaw, v: 0, away: false, digging: false,
          track: [[h.x, h.z]], arc: [0], s: 0, target: 0, leg: '', simV: 0, pace: 1, padYaw, homeDig: false, pad,
          agent: null!, next: { yaw: padYaw, s: 0, on: true },
        };
        v.agent = {
          kind: 'digger', id: b.id, key: b.id, x: v.x, z: v.z, fx: Math.cos(padYaw), fz: -Math.sin(padYaw), vx: 0, vz: 0,
          r: UNIT.digger.r, off: UNIT.digger.off, wallM: UNIT.digger.body, cls: 2, still: true, anchored: false,
          home: b.id, cruise: speed, pvx: 0, pvz: 0, reach: 0, held: false, drv: this,
        };
        this.all.set(b.id, v);
        this.retrack(v, h, true);
      } else if (jumped) {
        this.retrack(v, h, true);
      } else if (legKey(h) !== v.leg) {
        this.retrack(v, h, false);
      }
      v.target = Math.max(0, v.arc[v.arc.length - 1] - rem);
      if (jumped) {
        v.s = v.target;
        const p = along(v.track, v.arc, v.s);
        v.x = p.x; v.z = p.z;
      }
      v.simV = driving ? speed : 0;
      v.pace = pace;
      v.pad = pad;
      v.padYaw = padYaw;
      v.homeDig = h.phase === 'dig' && digsHome(b);
      v.digging = h.phase === 'dig' && b.active;
      v.powered = b.enabled && b.idleReason !== 'power';
      const a = v.agent;
      a.cls = h.phase === 'toDrop' || h.phase === 'unload' ? 3 : 2;
      a.cruise = speed;
      a.x = v.x; a.z = v.z;
      a.fx = Math.cos(v.yaw); a.fz = -Math.sin(v.yaw);
      const home = Math.hypot(v.x - pad[0], v.z - pad[1]) < 0.3;
      a.anchored = home && v.homeDig && v.target - v.s < 0.05;
      a.still = v.simV === 0 && v.target - v.s < 0.05;
    }
    for (const id of [...this.all.keys()]) if (!seen.has(id)) this.all.delete(id);
    this.traffic?.enlist('digger', [...this.all.values()].map((v) => v.agent));
  }

  /** A new sim leg: the track from where the digger is to the leg's start
   *  (the rest of the track it drives, or a planned connector), then the leg.
   *  `fresh`: start over on the sim's position (a jump). */
  private retrack(v: Digger, h: HaulState, fresh: boolean) {
    const leg = legOf(h);
    v.leg = legKey(h);
    if (fresh) {
      // the leg from where the sim is on it
      v.track = [[h.x, h.z], ...h.path.map(([x, z]): [number, number] => [x, z])];
      v.arc = arcs(v.track);
      v.s = 0;
      v.x = h.x; v.z = h.z;
      return;
    }
    const head: [number, number][] = [[v.x, v.z]];
    const [lx, lz] = leg[0];
    // the leg begins where the sim stood: on the track ahead, normally
    const onTrack = project(v.track, v.arc, lx, lz, v.s, Infinity);
    if (onTrack.d < 1) {
      const endI = along(v.track, v.arc, onTrack.u).i;
      const startI = along(v.track, v.arc, v.s).i;
      for (let i = startI; i < endI; i++) head.push(v.track[i]);
      head.push([lx, lz]);
    } else {
      const rects = this.traffic?.planRects(v.id) ?? [];
      if (!lineClear(v.x, v.z, lx, lz, rects, HAUL.clear * 0.9)) head.push(...plan(v.x, v.z, lx, lz, rects, HAUL.clear));
      else head.push([lx, lz]);
    }
    const track: [number, number][] = [];
    for (const p of [...head, ...leg.slice(1)]) {
      const last = track[track.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) track.push([p[0], p[1]]);
    }
    v.track = track;
    v.arc = arcs(track);
    v.s = 0;
  }

  /** No traffic step (it failed): each digger straight to where the sim has it. */
  follow() { for (const v of this.all.values()) this.jump(v); }

  /** Where the sim has it. */
  private jump(v: Digger) {
    v.s = v.target;
    const p = along(v.track, v.arc, v.s);
    const dx = p.x - v.x, dz = p.z - v.z;
    if (Math.hypot(dx, dz) > 1e-4) v.yaw = Math.atan2(-dz, dx);
    v.x = p.x; v.z = p.z;
  }

  // ── the traffic driver ──

  prefer(a: Agent) {
    const v = this.all.get(a.id)!;
    const gap = v.target - v.s;
    // driving on with the sim: no end in sight; else it stops where the sim is
    a.reach = v.simV > 0 ? Infinity : Math.max(0, gap);
    if (a.anchored || (gap < 0.02 && v.simV === 0)) { a.pvx = 0; a.pvz = 0; return; }
    const cap = CATCH * this.speed * v.pace;
    const want = clamp(v.simV * v.pace + GAIN * gap, 0, cap);
    const here = along(v.track, v.arc, v.s);
    const off = Math.hypot(here.x - v.x, here.z - v.z);
    // on the track: along it; pushed off it: back toward a point ahead on it
    const aim = off < 0.25 ? along(v.track, v.arc, Math.min(v.s + 0.5, v.target + 0.01)) : along(v.track, v.arc, Math.min(v.s + 3, v.target));
    let dx = aim.x - v.x, dz = aim.z - v.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) {
      // at a joint: the next leg's heading
      const ahead = along(v.track, v.arc, Math.min(v.s + 1, v.arc[v.arc.length - 1]));
      dx = ahead.x - v.x; dz = ahead.z - v.z;
    }
    const l = Math.hypot(dx, dz) || 1;
    a.pvx = (dx / l) * want;
    a.pvz = (dz / l) * want;
  }

  propose(a: Agent, vx: number, vz: number, dt: number, out: Pose, turn = false) {
    const v = this.all.get(a.id)!;
    const sp = Math.hypot(vx, vz);
    let x = v.x, z = v.z, s = v.s, on = false;
    if (turn) {
      let yaw = v.yaw;
      if (sp > 1e-6) yaw += clamp(wrap(Math.atan2(-vz, vx) - yaw), -TURN * dt, TURN * dt);
      out.x = x; out.z = z; out.fx = Math.cos(yaw); out.fz = -Math.sin(yaw);
      v.next = { yaw, s, on: false };
      return;
    }
    const here = along(v.track, v.arc, v.s);
    const onTrack = Math.hypot(here.x - v.x, here.z - v.z) < 0.25;
    if (sp > 1e-6 && onTrack && Math.abs(vx - a.pvx) < 1e-9 && Math.abs(vz - a.pvz) < 1e-9) {
      // as wanted, on the track: along it, round its corners exactly
      s = Math.min(v.s + sp * dt, Math.max(v.target, v.s));
      const p = along(v.track, v.arc, s);
      x = p.x; z = p.z; on = true;
    } else if (sp > 1e-6) {
      x += vx * dt; z += vz * dt;
    }
    let yaw = v.yaw;
    const mx = x - v.x, mz = z - v.z;
    let face: number | null = null;
    if (Math.hypot(mx, mz) > 1e-5) face = Math.atan2(-mz, mx);
    else if (sp > 1e-6) face = Math.atan2(-vz, vx);
    else if (v.homeDig && Math.hypot(v.x - v.pad[0], v.z - v.pad[1]) < 0.3) face = v.padYaw;
    if (face !== null) yaw += clamp(wrap(face - yaw), -TURN * dt, TURN * dt);
    out.x = x; out.z = z; out.fx = Math.cos(yaw); out.fz = -Math.sin(yaw);
    v.next = { yaw, s, on };
  }

  commit(a: Agent, p: Pose | null, dt: number) {
    const v = this.all.get(a.id)!;
    if (!p) { v.v = 0; return; }
    const moved = Math.hypot(p.x - v.x, p.z - v.z);
    v.v = dt > 0 ? Math.min(20, moved / dt) : 0;
    v.x = p.x; v.z = p.z; v.yaw = v.next.yaw;
    if (v.next.on) v.s = v.next.s;
    else if (moved > 0) v.s = clamp(project(v.track, v.arc, v.x, v.z, v.s, v.s + moved + 2).u, v.s - 1, Math.max(v.target, v.s));
    a.x = v.x; a.z = v.z; a.fx = p.fx; a.fz = p.fz;
  }

  /** After the traffic step: which diggers are away from their pads, then draw. */
  finish(dt: number, sunLight: number) {
    for (const v of this.all.values()) {
      const home = Math.hypot(v.x - v.pad[0], v.z - v.pad[1]) < 0.3;
      // home on its pad and squared up: the building instance takes over
      v.away = !home || Math.abs(wrap(v.padYaw - v.yaw)) > 0.02;
      if (dt > 0) this.lagMax = Math.max(this.lagMax, Math.max(0, v.target - v.s) / this.speed);
    }
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

  private takeLag() { const l = this.lagMax; this.lagMax = 0; return l; }

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
        /** m the digger trails the sim along its track */
        lagM: Math.round((v.target - v.s) * 100) / 100,
      })),
      /** the most any digger trailed the sim since the last read, game-seconds of driving */
      lagMaxS: Math.round(this.takeLag() * 100) / 100,
    };
  }
}
