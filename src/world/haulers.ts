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
import type { GameState, HaulState } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import { centerOf } from '../buildings/instances';
import { recipeGeometry } from '../buildings/recipes';
import { upgradeKey } from '../buildings/upgrades';
import { withInstanceState } from '../buildings/meshKit';
import { litChannel } from '../buildings/buildingShader';
import { pathLength } from '../core/paths';
import { cellAt, roadRoute, routePoints } from '../core/roads';
import { materials } from './materials';
import { blobTexture, roadSpeedFor } from './rovers';
import type { DustEmitter } from './dust';
import { Traffic, WHOLE, pointAt, type Agent, type Driver } from './traffic';

const MAX = 48;
const TURN = 2.2;          // rad/s: tracks turn on the spot
const CATCH = 1.6;         // × haul speed: the most a digger drives to catch up with the sim
const GAIN = 1.5;          // 1/s: how hard it closes the gap
const LAG_S = 20;          // s of driving a digger may trail the sim (held up in traffic) before it is set down there
const PI = Math.PI;
/** the body: 3.8 m wide, from 1.9 m behind its origin to the wheel 4.3 m ahead */
export const DIGGER_BODY = { hw: 1.9, front: 4.3, back: 1.9 };
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
  /** where the sim is along the agent's way (its goal), m */
  target: number;
  /** the sim's leg it last took on (a new one extends the way) */
  leg: string;
  /** the sim drives now (m/s along the way), 0 while it digs or unloads */
  simV: number;
  /** game-seconds of sim time this frame against the visuals' (≥ 1: slow frames) */
  pace: number;
  /** the pad's heading, whether the sim has it digging on its pad, the pad's centre */
  padYaw: number;
  homeDig: boolean;
  pad: [number, number];
  /** where the sim has it now (a jump lands here) */
  simX: number; simZ: number;
  /** the heading it turns (or pivots) to */
  aim: number;
  /** backing off for another: until when (sim time) it waits before heading on */
  yieldUntil: number;
  agent: Agent;
}

/** The sim's leg as a way: the whole route (or, from an old save, what is left of it). */
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
   *  traffic step moves it (or the fallback, alone) and finish() shows it. */
  update(dt: number, state: GameState, sunLight: number, frac = 0) {
    this.sync(dt, state, frac);
    if (!this.traffic) for (const v of this.all.values()) this.jump(v);
    this.finish(dt, sunLight);
  }

  /** Before the traffic step: follow the sim — its legs extend each digger's
   *  way, its position sets how far along the digger should be. */
  sync(dt: number, state: GameState, frac = 0, night = false) {
    // research grows parts on the excavator: the digger wears them too (a
    // swap keeps the per-instance attributes, as the building instances do)
    const key = upgradeKey('excavator', state.techsDone);
    if (key !== this.key) {
      const old = this.mesh.geometry;
      this.mesh.geometry = withInstanceState(recipeGeometry('excavator', key), MAX, old);
      old.dispose();
      this.key = key;
    }
    this.state = state;
    const simDelta = this.lastSim === null ? Infinity : state.simTime - this.lastSim;
    this.lastSim = state.simTime;
    // sim time the visuals were not shown (debug advances, a load, a long
    // stall): jump; a slow frame's shortfall is driven faster instead
    const jumped = simDelta < 0 || (dt <= 0 ? simDelta > 1e-6 : simDelta - dt > 3);
    const pace = dt > 0 ? clamp(simDelta / dt, 1, 5) : 1;
    const seen = new Set<number>();
    const speed = this.speed = haulSpeed(state.techsDone) * roadSpeedFor(state.techsDone, night, true);
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
          target: 0, leg: '', simV: 0, pace: 1, padYaw, homeDig: false, pad, simX: h.x, simZ: h.z, aim: padYaw, yieldUntil: 0, agent: null!,
        };
        v.agent = {
          kind: 'digger', id: b.id, key: b.id, x: h.x, z: h.z, fx: Math.cos(padYaw), fz: -Math.sin(padYaw),
          hw: DIGGER_BODY.hw, front: DIGGER_BODY.front, back: DIGGER_BODY.back, wide: true, cls: 2,
          pts: [], arcs: [], spans: [], s: 0, v: 0, vmax: 0, stop: 0, accel: 4, decel: 8,
          standMode: WHOLE, held: new Map(), blocker: null, waited: 0, drv: this,
        };
        this.all.set(b.id, v);
        this.retrack(v, h, true);
      } else if (jumped) {
        this.retrack(v, h, true);
      } else if (legKey(h) !== v.leg && state.simTime >= v.yieldUntil) {
        this.retrack(v, h, false);
      }
      const a = v.agent;
      // backing off for another: out to the end of that way, then it waits
      let yielding = state.simTime < v.yieldUntil;
      v.target = yielding ? Traffic.end(a) : Math.max(0, Traffic.end(a) - rem);
      // held up too long: set down where the sim has it, if that ground is free (never onto another)
      let late = false;
      if (!jumped && this.traffic && dt > 0 && v.target - a.s > LAG_S * speed) {
        const way: [number, number][] = [[h.x, h.z], ...h.path.map(([x, z]): [number, number] => [x, z])];
        const yaw = way.length > 1 && Math.hypot(way[1][0] - h.x, way[1][1] - h.z) > 1e-6
          ? Math.atan2(-(way[1][1] - h.z), way[1][0] - h.x) : h.phase === 'dig' && digsHome(b) ? padYaw : v.yaw;
        if (this.traffic.boxFree(a, h.x, h.z, Math.cos(yaw), -Math.sin(yaw))) {
          this.retrack(v, h, true);
          v.yaw = v.aim = yaw;
          a.fx = Math.cos(yaw); a.fz = -Math.sin(yaw);
          v.yieldUntil = 0;
          yielding = false;
          v.target = Math.max(0, Traffic.end(a) - rem);
          late = true;
        }
      }
      if (jumped || late) {
        a.s = Math.min(v.target, Traffic.end(a));
        const p = pointAt(a.pts, a.arcs, a.s);
        v.x = p.x; v.z = p.z; a.x = p.x; a.z = p.z;
        this.traffic?.place(a);
      }
      v.simV = driving && !yielding ? speed : 0;
      v.pace = pace;
      v.pad = pad;
      v.padYaw = padYaw;
      v.homeDig = h.phase === 'dig' && digsHome(b);
      v.digging = h.phase === 'dig' && b.active;
      v.powered = b.enabled && b.idleReason !== 'power';
      v.simX = h.x; v.simZ = h.z;
      a.cls = h.phase === 'toDrop' || h.phase === 'unload' ? 3 : 2;
    }
    for (const id of [...this.all.keys()]) if (!seen.has(id)) this.all.delete(id);
    this.traffic?.enlist('digger', [...this.all.values()].map((v) => v.agent));
  }

  private state: GameState | null = null;

  /** A new sim leg: the way from where the digger is to the leg's start (the
   *  rest of the way it drives, or a road route) and then the leg.
   *  `fresh`: start over on the sim's position (a jump). */
  private retrack(v: Digger, h: HaulState, fresh: boolean) {
    const a = v.agent;
    const leg = legOf(h);
    v.leg = legKey(h);
    if (fresh) {
      const way: [number, number][] = [[h.x, h.z], ...h.path.map(([x, z]): [number, number] => [x, z])];
      v.x = h.x; v.z = h.z; a.x = h.x; a.z = h.z;
      this.face(v, way);
      this.traffic?.drop(a);
      this.setWay(v, way);
      return;
    }
    const head: [number, number][] = [[v.x, v.z]];
    const [lx, lz] = leg[0];
    // the leg begins where the sim stood: on the way ahead, normally
    let joined = false;
    if (a.pts.length > 1) {
      let best = { u: Infinity, d: Infinity, i: 0 };
      for (let i = 1; i < a.pts.length; i++) {
        if (a.arcs[i] < a.s - 1e-6) continue;
        const [ax, az] = a.pts[i - 1], [bx, bz] = a.pts[i];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
        const k = l2 > 1e-9 ? clamp(((lx - ax) * dx + (lz - az) * dz) / l2, 0, 1) : 0;
        const d = Math.hypot(lx - ax - dx * k, lz - az - dz * k);
        if (d < best.d - 1e-6) best = { u: a.arcs[i - 1] + Math.sqrt(l2) * k, d, i };
      }
      if (best.d < 1) {
        for (let i = 1; i < a.pts.length; i++) if (a.arcs[i] > a.s + 1e-6 && a.arcs[i] < best.u - 1e-6) head.push(a.pts[i]);
        joined = true;
      }
    }
    if (!joined && this.state) {
      const cells = roadRoute(this.state, cellAt(v.x, v.z), cellAt(lx, lz));
      // no road from here to the leg (cut, or not open yet): it waits where it is
      if (!cells) { v.leg = ''; return; }
      head.push(...routePoints(cells).slice(1));
    }
    const way: [number, number][] = [];
    for (const p of [...head, [lx, lz] as [number, number], ...leg.slice(1)]) {
      const last = way[way.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) way.push([p[0], p[1]]);
    }
    this.setWay(v, way);
  }

  private setWay(v: Digger, way: [number, number][]) {
    const a = v.agent;
    if (this.traffic) this.traffic.setWay(a, way);
    else {
      a.pts = [way[0], ...way];
      a.arcs = [0];
      for (let i = 1; i < a.pts.length; i++) a.arcs.push(a.arcs[i - 1] + Math.hypot(a.pts[i][0] - a.pts[i - 1][0], a.pts[i][1] - a.pts[i - 1][1]));
      a.s = 0;
    }
  }

  /** Square to the way it starts on. */
  private face(v: Digger, way: [number, number][]) {
    if (way.length < 2) return;
    const dx = way[1][0] - way[0][0], dz = way[1][1] - way[0][1];
    if (Math.hypot(dx, dz) < 1e-6) return;
    v.yaw = Math.atan2(-dz, dx);
    v.agent.fx = Math.cos(v.yaw); v.agent.fz = -Math.sin(v.yaw);
  }

  /** No traffic step (it failed): each digger straight to where the sim has it. */
  follow() { for (const v of this.all.values()) this.jump(v); }

  /** Where the sim has it. */
  private jump(v: Digger) {
    const a = v.agent;
    a.s = Math.min(v.target, Traffic.end(a));
    const p = pointAt(a.pts, a.arcs, a.s);
    if (Math.hypot(p.x - v.x, p.z - v.z) > 1e-4) v.yaw = Math.atan2(-p.dz, p.dx);
    v.x = p.x; v.z = p.z; a.x = p.x; a.z = p.z;
  }

  // ── the traffic driver ──

  prefer(a: Agent) {
    const v = this.all.get(a.id)!;
    const gap = v.target - a.s;
    const cap = CATCH * this.speed * v.pace;
    a.vmax = gap < 0.02 && v.simV === 0 ? 0 : clamp(v.simV * v.pace + GAIN * gap, 0, cap);
    a.stop = Math.min(v.target, Traffic.end(a));
    // tracks: forward along the way, backing straight out, or a pivot on the spot
    const end = Traffic.end(a);
    const there = a.s >= end - 1e-3;
    let want: number | null = null;
    if (!there && a.vmax > 0) {
      const p = pointAt(a.pts, a.arcs, a.s + 0.02);
      want = Math.atan2(-p.dz, p.dx);
    } else if (there && v.homeDig && Math.hypot(v.x - v.pad[0], v.z - v.pad[1]) < 0.3) {
      want = v.padYaw;
    }
    if (want === null) { a.pivot = false; return; }
    const fwd = Math.abs(wrap(want - v.yaw)), rev = Math.abs(wrap(want + PI - v.yaw));
    if (fwd < 0.04) { a.reverse = false; a.pivot = false; v.aim = want; }
    else if (rev < 0.04 && !there) { a.reverse = true; a.pivot = false; v.aim = want + PI; }
    else {
      // turn on the spot to face the way on (it backs up only where no turn is needed)
      a.pivot = true;
      a.reverse = false;
      v.aim = want;
      a.vmax = 0;
    }
  }

  moved(a: Agent, dt: number) {
    const v = this.all.get(a.id)!;
    const p = pointAt(a.pts, a.arcs, a.s);
    const moved = Math.hypot(p.x - v.x, p.z - v.z);
    v.v = dt > 0 ? Math.min(20, moved / dt) : 0;
    v.x = p.x; v.z = p.z;
    a.x = p.x; a.z = p.z;
    if (a.pivot) {
      if (!a.pivotOk) return;
      v.yaw += clamp(wrap(v.aim - v.yaw), -TURN * dt, TURN * dt);
      if (Math.abs(wrap(v.aim - v.yaw)) < 0.04) { v.yaw = v.aim; a.pivot = false; }
    } else if (moved > 1e-6) {
      // along the way: the heading of the piece it drives; a turn waits for a pivot
      const yaw = a.reverse ? Math.atan2(p.dz, -p.dx) : Math.atan2(-p.dz, p.dx);
      if (Math.abs(wrap(yaw - v.yaw)) < 0.2 && (this.traffic?.boxFree(a, v.x, v.z, Math.cos(yaw), -Math.sin(yaw)) ?? true)) v.yaw = yaw;
    }
    a.fx = Math.cos(v.yaw); a.fz = -Math.sin(v.yaw);
  }

  /** Back off along the way it came until its body is clear of the others'
   *  ways, wait there a moment, then head on (true: it found such a place). */
  yieldTo(a: Agent, others: Agent[]): boolean {
    const v = this.all.get(a.id);
    const t = this.traffic;
    if (!v || !t || a.s <= 0) return false;
    const avoid = new Set<number>();
    for (const o of others) for (const k of t.claimOf(o, 40)) avoid.add(k);
    // walk back a metre at a time: every cell passed must be free, the stop clear of their ways
    for (let u = a.s - 1; u >= 0; u -= 1) {
      const cells = t.cellsAt(a, u);
      if (cells.some((k) => t.heldByOther(a, k) && !avoid.has(k))) return false;
      if (cells.some((k) => avoid.has(k))) continue;
      // back to arc u: the way reversed from here
      const back: [number, number][] = [[v.x, v.z]];
      for (let i = a.pts.length - 1; i >= 1; i--) if (a.arcs[i] < a.s - 1e-6 && a.arcs[i] > u + 1e-6) back.push(a.pts[i]);
      const p = pointAt(a.pts, a.arcs, u);
      back.push([p.x, p.z]);
      if (back.length < 2 || Math.hypot(back[0][0] - p.x, back[0][1] - p.z) < 0.5) return false;
      this.setWay(v, back);
      a.reverse = true;
      v.yieldUntil = (this.state?.simTime ?? 0) + 4;
      v.leg = ''; // after the wait it takes up the sim's leg again from where it stands
      return true;
    }
    return false;
  }

  /** Set down where the sim has it, if that ground is free (never onto another unit). */
  rescue(a: Agent) {
    const v = this.all.get(a.id);
    const h = this.state?.buildings.find((b) => b.id === a.id)?.haul;
    const t = this.traffic;
    if (!v || !h || !t) return;
    const yaw = v.yaw;
    if (!t.boxFree(a, h.x, h.z, Math.cos(yaw), -Math.sin(yaw))) return;
    this.retrack(v, h, true);
    v.target = Traffic.end(a) - Math.max(0, pathLength(h.x, h.z, h.path));
  }

  /** After the traffic step: which diggers are away from their pads, then draw. */
  finish(dt: number, sunLight: number) {
    for (const v of this.all.values()) {
      const home = Math.hypot(v.x - v.pad[0], v.z - v.pad[1]) < 0.3;
      // home on its pad and squared up: the building instance takes over
      v.away = !home || Math.abs(wrap(v.padYaw - v.yaw)) > 0.02;
      if (dt > 0) this.lagMax = Math.max(this.lagMax, Math.max(0, v.target - v.agent.s) / this.speed);
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
        lagM: Math.round((v.target - v.agent.s) * 100) / 100,
        s: Math.round(v.agent.s * 100) / 100, end: Math.round(Traffic.end(v.agent) * 100) / 100,
        pivot: !!v.agent.pivot, reverse: !!v.agent.reverse, way: v.agent.pts.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]),
      })),
      /** the most any digger trailed the sim since the last read, game-seconds of driving */
      lagMaxS: Math.round(this.takeLag() * 100) / 100,
    };
  }
}
