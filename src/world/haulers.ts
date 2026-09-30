/** The Regolith Excavator as a mobile digger, made visible (core/haul.ts).
 *
 *  Parked square on its pad, an excavator is drawn by the building
 *  instances like any structure (shadow, print reveal, floods). Anywhere
 *  else it is drawn here: one instance per digger away from its pad, in
 *  the mesh of its (unit type, hub kind) — one InstancedMesh each, so the
 *  hubs' diggers can differ in shape and livery (docs/19, S2a) — the
 *  building material, chasing the sim's position (the
 *  sim moves it once a game-second; this glides after it with a heavy
 *  machine's turn rate), pitched and rolled to the ground, with a soft
 *  contact decal instead of a shadow-map shadow (a moving caster would
 *  re-render the map every frame). `onAway` tells the instances which pads
 *  to leave empty. Its tracks throw dust while it drives and the bucket
 *  wheel throws spoil while it digs, wherever it is. Game time: pause
 *  freezes it. */
import * as THREE from 'three';
import { HAUL } from '../data/balance';
import { UNIT_KEYS, liveryOf, unitKey, type UnitKey } from '../data/families';
import type { BuildingId } from '../data/buildings';
import { digsHome, haulSpeed } from '../core/haul';
import type { GameState, HaulState } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import { centerOf } from '../buildings/instances';
import { unitRecipeGeometry } from '../buildings/recipes';
import { upgradeKey } from '../buildings/upgrades';
import { withInstanceState } from '../buildings/meshKit';
import { litChannel } from '../buildings/celBuilding';
import { pathLength } from '../core/paths';
import { cellAt, cellKey, frontDir, groundWay, isOpen, roadMap, roadRoute, routePoints } from '../core/roads';
import { bayPoint, rampsOf } from '../core/hubs';
import { UNIT_VID, type UnitType } from '../data/hubs';
import { materials } from './materials';
import { inked } from './ink';
import { blobTexture, roadSpeedFor } from './rovers';
import type { DustEmitter } from './dust';
import { Traffic, WHOLE, pointAt, type Agent, type Driver } from './traffic';
import type { WorkAnim } from './workAnim';

const MAX = 64;
const TURN = Math.PI / 2;  // rad/s (90°/s): the tracks turn on the spot no faster
const BEND = 0.26;         // rad (15°): the turns the lane keeps clear of
const HAIRPIN = 2.1;       // rad (120°): a sharper turn reverses the direction of travel: the unit stops there
const TURN_SLOW = 0.9;     // rad (50°): its speed falls to nothing as its heading falls this far behind the way's: it turns on the spot
const CATCH = 1.6;         // × haul speed: the most a digger drives to catch up with the replay of the sim
const GAIN = 1.5;          // 1/s: how hard it closes the gap
const ACCEL = 6;           // m/s²: a haul unit's ramps (a rover keeps ROVER.accel)
const DECEL = 10;
const SETTLE_S = 0.3;      // s it stands still on arrival before it goes to work
const REVERSE_M = 30;      // m of straight it will back along when its way leaves the way it faces; longer, it turns round
const LEAD_M = 1.5;        // m ahead of it the way's heading is read for the yaw it steers to
const LANE_M = 1.5;        // m off its way, inside a zone (ground the sim does not reserve): each unit in its own lane
const CLEAR_M = 3.4;       // m a unit keeps between its body and another's there: it passes wide of one it drives by
const RAMP_M = 3.2;        // m: on a pit's ramp (within this of it) a unit keeps to it: it may move over by RAMP_SLACK_M at most
const RAMP_SLACK_M = 1.1;
const LANE_V = 3;          // m/s a lane change takes
const LAG_S = 12;          // legacy pads only (no sim reservations, docs/19 S4b): s of driving one may trail the sim before it is set down there
const PI = Math.PI;
/** each unit type's body, for the traffic agent: 3.0 m wide (two units in the
 *  lanes ±1.5 m off a way clear each other), from 1.9 m behind its origin to
 *  the wheel 4.3 m ahead */
export const UNIT_BODY: Record<UnitType, { hw: number; front: number; back: number }> = {
  excavator: { hw: 1.5, front: 4.3, back: 1.9 },
  iceMiner: { hw: 1.5, front: 4.3, back: 1.9 },
};

/** The upgrade lane each mesh wears (buildings/upgrades.ts): the ice miner's
 *  own, the excavator's for every digger. The models are buildings/recipes.ts
 *  `unitRecipeGeometry`: the smelter's open-bin digger, the refinery's covered
 *  hopper, the ice miner's tank and cutter drum; the legacy pad's and a water
 *  plant's excavator wear the plain excavator. */
const UNIT_RECIPE: Record<UnitKey, BuildingId> = {
  'excavator:pad': 'excavator',
  'excavator:smelter': 'excavator',
  'excavator:refinery': 'excavator',
  'excavator:waterPlant': 'excavator',
  'iceMiner:waterPlant': 'iceMiner',
};

/** A mesh's geometry with per-instance state, for the upgrades in `key` (a swap keeps the instances' attributes). */
function unitGeometry(mk: UnitKey, key: string, prev?: THREE.BufferGeometry): THREE.BufferGeometry {
  return withInstanceState(unitRecipeGeometry(mk, key), MAX, prev);
}

/** One (unit type, hub kind)'s instanced diggers. */
interface UnitMesh {
  mk: UnitKey;
  mesh: THREE.InstancedMesh;
  /** the recipe's upgrade key the mesh was built with (the same parts as the pad's) */
  key: string;
  /** the diggers drawn in it this frame, in instance order */
  drawn: Digger[];
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
type Pt = [number, number];

interface Digger {
  /** a legacy pad's building id, or UNIT_VID + a hub unit's id */
  id: number;
  /** a hub unit (docs/17): no pad, always drawn here; `pad` is its bay. Its picture only follows the
   *  sim (world/traffic.ts `free`): nothing holds it up, nothing sets it down */
  unit: boolean;
  /** what it is, and the mesh it is drawn in (its type and its hub's kind; a legacy pad: 'pad') */
  type: UnitType;
  mk: UnitKey;
  /** its instance in that mesh, this frame */
  slot: number;
  /** complete, enabled, powered: its lamps and windows may light */
  powered: boolean;
  x: number; z: number;
  /** rotation about +y, as a building's (−rot·π/2): local +x (the bucket wheel) leads */
  yaw: number;
  v: number;
  away: boolean;
  digging: boolean;
  /** the way it drives is the sim's own path from where the picture is: `tail` is the sim's path as the
   *  way was made (what the sim has left is a suffix of it while nothing changes), `leg` its leg */
  leg: string;
  tail: Pt[];
  /** where the sim has it along the way at the last two economy ticks (arcs of `agent`); the picture
   *  replays the second between them, so it shows the sim's positions a tick late and exactly */
  arcPrev: number; arcCur: number;
  /** the arc the replay is at now (it never goes back), the arc the picture is driven to, and the replay's pace, m/s */
  reach: number;
  target: number;
  simV: number;
  /** the pad's heading, whether the sim has it digging on its pad, the pad's centre */
  padYaw: number;
  homeDig: boolean;
  pad: [number, number];
  /** the heading it turns (or pivots) to */
  aim: number;
  /** its lane inside a zone: the side it keeps (+1 right of its way, −1 left), how far off its way it is,
   *  and whether the ground it stands on is a zone's (the sim does not reserve that) */
  side: number;
  /** how far it is off its way (world metres, the way's point is where the sim is) and the lane offset it steers to
   *  (right of its direction of travel is +), before the fade at the end of its way */
  ox: number; oz: number;
  latAim: number;
  inZone: boolean;
  /** the arc of the next bend ahead (its lane fades out there) */
  bend: number | null;
  /** how its way was last made (debug) */
  mode: string;
  /** s it has stood still (it works once it has settled) */
  still: number;
  /** legacy pads: backing off for another: until when (sim time) it waits before heading on */
  yieldUntil: number;
  agent: Agent;
}

/** The sim's leg as a way (a legacy pad's old save has no `route`: what is left of its path). */
const legKey = (h: HaulState) => {
  const t = h.route?.length ? h.route : null;
  const f = (v: number) => v.toFixed(2);
  return t ? `${f(t[0][0])},${f(t[0][1])}>${f(t[t.length - 1][0])},${f(t[t.length - 1][1])}#${t.length}`
    : `old>${h.path.length ? `${f(h.path[h.path.length - 1][0])},${f(h.path[h.path.length - 1][1])}` : `${f(h.x)},${f(h.z)}`}`;
};

/** Is `b` (the sim's path now) what is left of `a` (the path the way was made from)? */
function leftOf(a: readonly Pt[], b: readonly Pt[]): boolean {
  const k = a.length - b.length;
  if (k < 0) return false;
  for (let i = 0; i < b.length; i++) if (a[k + i][0] !== b[i][0] || a[k + i][1] !== b[i][1]) return false;
  return true;
}

/** A way without its repeated points (pieces under 5 cm). */
function dedupe(pts: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.05) out.push([p[0], p[1]]);
  }
  return out;
}

/** m from (x, z) to the segment a–b */
function segDist(x: number, z: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
  const k = l2 > 1e-9 ? clamp(((x - a[0]) * dx + (z - a[1]) * dz) / l2, 0, 1) : 0;
  return Math.hypot(x - a[0] - dx * k, z - a[1] - dz * k);
}

/** The first bend sharper than BEND ahead of arc `from` (within 60 m), and the first hairpin (sharper than HAIRPIN):
 *  their arcs. */
function bendsAhead(a: Agent, from: number): { bend: number | null; hairpin: number | null } {
  const P = a.pts, A = a.arcs;
  let bend: number | null = null;
  for (let i = 1; i < P.length - 1; i++) {
    if (A[i] <= from + 0.05) continue;
    if (A[i] > from + 60) break;
    const ix = P[i][0] - P[i - 1][0], iz = P[i][1] - P[i - 1][1];
    const il = Math.hypot(ix, iz);
    if (il < 1e-6) continue;
    // the next piece with a length
    let j = i + 1;
    while (j < P.length - 1 && Math.hypot(P[j][0] - P[i][0], P[j][1] - P[i][1]) < 1e-6) j++;
    const ox = P[j][0] - P[i][0], oz = P[j][1] - P[i][1];
    const ol = Math.hypot(ox, oz);
    if (ol < 1e-6) continue;
    const turn = Math.acos(clamp((ix * ox + iz * oz) / (il * ol), -1, 1));
    if (turn > BEND && bend === null) bend = A[i];
    if (turn > HAIRPIN) return { bend, hairpin: A[i] };
  }
  return { bend, hairpin: null };
}

export class Haulers implements Driver {
  readonly group = new THREE.Group();
  /** one mesh per (unit type, hub kind), in UNIT_KEYS order */
  private meshes: UnitMesh[] = [];
  private byKey = new Map<UnitKey, UnitMesh>();
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
  /** the work animations (life.ts sets them): the boom and bucket wheel on
   *  each digger drawn here (world/workAnim.ts; on its pad it draws them itself) */
  work: WorkAnim | null = null;
  /** the sim clock at the last frame: time the visuals missed is jumped */
  private lastSim: number | null = null;
  /** the sim's last economy tick, as a time (sim time minus the part of the next second gone): it moves by one a tick */
  private lastTick: number | null = null;
  private speed = HAUL.speed;
  /** the most any digger has trailed the sim since the last read, game-seconds (its position now; the replay's own tick included) */
  private lagMax = 0;
  /** … and the replay of it (its position one tick ago: what the driving costs alone) */
  private replayMax = 0;
  /** pictures placed on the sim's position outside a jump: a legacy pad set down after a long lag, or a hub
   *  unit whose new way did not join the one it drove (never, but for a patch of the state) */
  private setDowns = 0;
  private snaps = 0;

  constructor(private hf: Heightfield, private traffic?: Traffic) {
    for (const mk of UNIT_KEYS) {
      const mesh = new THREE.InstancedMesh(unitGeometry(mk, ''), materials.get('building'), MAX);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = false;
      const um: UnitMesh = { mk, mesh, key: '', drawn: [] };
      this.meshes.push(um);
      this.byKey.set(mk, um);
      this.group.add(inked(mesh, mk));
    }
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
    this.group.add(this.decals);
  }

  /** The mesh a digger is drawn in. */
  private meshOf(v: Digger): UnitMesh { return this.byKey.get(v.mk) ?? this.meshes[0]; }

  /** Per frame: `dt` game seconds (0 while paused); `frac` the part of the
   *  next economy second already gone, which is how far along its tick the
   *  replay is. Then the traffic step moves it (or the fallback, alone) and
   *  finish() shows it. */
  update(dt: number, state: GameState, sunLight: number, frac = 0) {
    this.sync(dt, state, frac);
    if (!this.traffic) for (const v of this.all.values()) this.jump(v);
    this.finish(dt, sunLight);
  }

  /** Before the traffic step: follow the sim. The way each digger drives is
   *  the path the sim drove (a new leg, or a step aside, extends it); where the
   *  sim has it at the last two ticks says how far along that way the picture
   *  is driven — the second between them, replayed. */
  sync(dt: number, state: GameState, frac = 0, night = false) {
    // research grows parts on the excavator: the digger wears them too (a
    // swap keeps the per-instance attributes, as the building instances do)
    for (const um of this.meshes) {
      const key = upgradeKey(UNIT_RECIPE[um.mk], state.techsDone);
      if (key === um.key) continue;
      const old = um.mesh.geometry;
      um.mesh.geometry = unitGeometry(um.mk, key, old);
      old.dispose();
      um.key = key;
    }
    this.state = state;
    frac = clamp(frac, 0, 1);
    const simDelta = this.lastSim === null ? Infinity : state.simTime - this.lastSim;
    this.lastSim = state.simTime;
    // sim time the visuals were not shown (debug advances, a load, a long stall): jump
    const jumped = simDelta < 0 || (dt <= 0 ? simDelta > 1e-6 : simDelta - dt > 3);
    const boundary = state.simTime - frac;
    const ticked = this.lastTick !== null && boundary - this.lastTick > 0.5;
    this.lastTick = boundary;
    const seen = new Set<number>();
    const road = roadSpeedFor(state.techsDone, night, true);
    const speed = this.speed = haulSpeed(state.techsDone) * road;
    // the diggers: legacy pads (a building each) and hub units (docs/17: drawn here always, parked in their bays)
    const srcs: { id: number; h: HaulState; pad: [number, number]; padYaw: number; active: boolean; powered: boolean; homeDig: boolean; unit: boolean; type: UnitType; mk: UnitKey }[] = [];
    for (const b of state.buildings) {
      const h = b.haul;
      if (b.type !== 'excavator' || !h || (b.construction ?? 0) > 0) continue;
      srcs.push({ id: b.id, h, pad: centerOf(b), padYaw: -b.rot * PI / 2, active: b.active, powered: b.enabled && b.idleReason !== 'power',
        homeDig: h.phase === 'dig' && digsHome(b), unit: false, type: 'excavator', mk: unitKey('excavator', 'pad') });
    }
    for (const u of state.haulers ?? []) {
      const hub = state.buildings.find((b) => b.id === u.hub);
      if (!hub) continue;
      const [fx, fz] = frontDir(hub);
      const h = u.haul;
      srcs.push({ id: UNIT_VID + u.id, h, pad: bayPoint(state, hub, u.bay), padYaw: Math.atan2(fz, -fx), active: h.src !== 'flat',
        powered: hub.enabled && h.src !== 'flat', homeDig: h.phase === 'park', unit: true, type: u.type, mk: unitKey(u.type, hub.type) });
    }
    this.hauls = new Map(srcs.map((x) => [x.id, x.h]));
    for (const src of srcs) {
      const { h, pad, padYaw } = src;
      seen.add(src.id);
      let v = this.all.get(src.id);
      let placed = false;
      let rebuilt = false;
      if (!v) {
        v = {
          id: src.id, unit: src.unit, type: src.type, mk: src.mk, slot: 0, powered: false, x: h.x, z: h.z, yaw: padYaw, v: 0, away: src.unit, digging: false,
          leg: '', tail: [], arcPrev: 0, arcCur: 0, reach: 0, target: 0, simV: 0, padYaw, homeDig: false, pad, aim: padYaw,
          side: src.id % 2 ? -1 : 1, ox: 0, oz: 0, latAim: 0, inZone: false, bend: null, mode: '', still: SETTLE_S, yieldUntil: 0, agent: null!,
        };
        v.agent = {
          kind: 'digger', id: src.id, key: src.id, x: h.x, z: h.z, fx: Math.cos(padYaw), fz: -Math.sin(padYaw),
          hw: UNIT_BODY[src.type].hw, front: UNIT_BODY[src.type].front, back: UNIT_BODY[src.type].back, wide: true, cls: 2,
          pts: [], arcs: [], spans: [], s: 0, v: 0, vmax: 0, stop: 0, accel: ACCEL, decel: DECEL,
          standMode: WHOLE, held: new Map(), blocker: null, waited: 0, drv: this, free: src.unit,
        };
        this.all.set(src.id, v);
        this.track(v, h, 'fresh');
        placed = rebuilt = true;
      } else if (jumped) {
        this.track(v, h, 'fresh');
        placed = rebuilt = true;
      } else if (legKey(h) !== v.leg && (v.unit || state.simTime >= v.yieldUntil)) {
        this.track(v, h, 'leg');
        rebuilt = true;
      } else if (!leftOf(v.tail, h.path)) {
        this.track(v, h, 'path');
        rebuilt = true;
      } else if (h.path.length < v.tail.length) {
        // the sim drove on: what it has left is the rest of the path (a step back onto a waypoint it passed is a new path)
        v.tail = v.tail.slice(v.tail.length - h.path.length);
      }
      const a = v.agent;
      // legacy pads: held up too long by the picture's traffic: set down where the sim has it, if that ground is free
      // (a hub unit is never held up)
      let late = false;
      if (!v.unit && !placed && this.traffic && dt > 0 && v.target - a.s > LAG_S * speed && state.simTime >= v.yieldUntil) {
        const way: Pt[] = [[h.x, h.z], ...h.path.map(([x, z]): Pt => [x, z])];
        const yaw = way.length > 1 && Math.hypot(way[1][0] - h.x, way[1][1] - h.z) > 1e-6
          ? Math.atan2(-(way[1][1] - h.z), way[1][0] - h.x) : src.homeDig ? padYaw : v.yaw;
        if (this.traffic.boxFree(a, h.x, h.z, Math.cos(yaw), -Math.sin(yaw))) {
          this.track(v, h, 'fresh');
          v.yaw = v.aim = yaw;
          a.fx = Math.cos(yaw); a.fz = -Math.sin(yaw);
          v.yieldUntil = 0;
          late = true;
          this.setDowns++;
        }
      }
      if (placed || late) {
        // set down where the sim stands, then on as usual: digging its own pad (a unit: parked in its bay), squared up on it
        if (src.homeDig && Math.hypot(h.x - pad[0], h.z - pad[1]) < 0.3) {
          v.yaw = v.aim = padYaw;
          a.fx = Math.cos(padYaw); a.fz = -Math.sin(padYaw);
        }
        this.traffic?.place(a);
      }
      // the sim's place along the way; on a tick the window slides on (a leg or a step aside just made the way with it)
      const cur = Traffic.end(a) - pathLength(h.x, h.z, h.path);
      if (!rebuilt && (ticked || Math.abs(cur - v.arcCur) > 1e-6)) { v.arcPrev = v.arcCur; v.arcCur = cur; }
      const replay = v.arcPrev + (v.arcCur - v.arcPrev) * frac;
      v.reach = Math.max(v.reach, Math.min(replay, v.arcCur));
      // (a legacy pad giving way drives out the way it backs off along, then waits)
      v.target = !v.unit && state.simTime < v.yieldUntil ? Traffic.end(a) : v.reach;
      v.simV = Math.max(0, v.arcCur - v.arcPrev);
      v.padYaw = padYaw;
      v.pad = pad;
      v.homeDig = src.homeDig;
      v.digging = h.phase === 'dig' && src.active && !(src.unit && h.full);
      v.powered = src.powered;
      a.cls = h.phase === 'toDrop' || h.phase === 'unload' ? 3 : 2;
    }
    for (const id of [...this.all.keys()]) if (!seen.has(id)) this.all.delete(id);
    this.lanes(state);
    this.traffic?.enlist('digger', [...this.all.values()].map((v) => v.agent));
  }

  private state: GameState | null = null;
  /** each digger's haul this frame (a pad's or a unit's), by its key */
  private hauls = new Map<number, HaulState>();

  /** Where the sim lets units share ground the picture keeps them apart, sideways. Inside a zone (off the open road,
   *  the sim keeps no cells there) each unit takes a lane, by id parity, and two that meet head on both take their right
   *  shoulder. And wherever the way the sim has driven leads a unit past one that stands (a digger at its face, a unit
   *  waiting in a bay), it passes CLEAR_M wide of it: on a pit's ramp it keeps to the ramp. Set once a frame: the lane
   *  offset each unit steers to. */
  private lanes(state: GameState) {
    const vs = [...this.all.values()].filter((v) => v.unit);
    let ramps: ReturnType<typeof rampsOf> | null = null;
    const map = roadMap(state);
    const onRamp = (v: Digger) => (ramps ??= rampsOf(state)).some((r) => segDist(v.x, v.z, r.a, r.b) < RAMP_M);
    for (const v of vs) {
      v.inZone = !isOpen(map.get(cellKey(...cellAt(v.x, v.z))));
      v.latAim = 0;
    }
    for (const v of vs) {
      const a = v.agent;
      // (on a pit's ramp it keeps to the ramp: a body's width less than the ramp's)
      const cap = onRamp(v) ? RAMP_SLACK_M : CLEAR_M;
      const sg = a.reverse ? -1 : 1;
      const tx = a.fx * sg, tz = a.fz * sg;
      let side = v.id % 2 ? -1 : 1;
      let base = 0;
      if (v.inZone && cap === CLEAR_M) {
        base = 1;
        for (const o of vs) {
          if (o === v || !o.inZone) continue;
          const dx = o.x - v.x, dz = o.z - v.z;
          if (dx * dx + dz * dz > 32 * 32) continue;
          const so = o.agent.reverse ? -1 : 1;
          if ((tx * o.agent.fx + tz * o.agent.fz) * so < -0.5 && (dx * tx + dz * tz) > 0 && (a.v > 0.3 || o.agent.v > 0.3)) { side = 1; break; }
        }
        base = side * LANE_M;
      }
      // the way the sim has driven from here (the replay and a little on), past a unit that stands
      let want = 0, need = 0;
      const to = Math.min(v.arcCur, a.s + 12);
      for (const o of vs) {
        // (a unit the sim has standing, or standing aside: where it will be, though the picture may still be driving there)
        if (o === v || o.arcCur - o.arcPrev > 1e-3) continue;
        const spot = pointAt(o.agent.pts, o.agent.arcs, o.arcCur);
        const ox = spot.x, oz = spot.z;
        if ((ox - v.x) * (ox - v.x) + (oz - v.z) * (oz - v.z) > 30 * 30) continue;
        for (let u = a.s; u <= to + 1e-6; u += 1) {
          const p = pointAt(a.pts, a.arcs, u);
          const dx = ox - p.x, dz = oz - p.z;
          if (dx * dx + dz * dz >= CLEAR_M * CLEAR_M) continue;
          const oLat = dx * p.dz - dz * p.dx;   // right of the way is +
          const dir = Math.abs(oLat) < 0.4 ? side : -Math.sign(oLat);
          const L = clamp(oLat + dir * CLEAR_M, -cap, cap);
          if (Math.abs(L) > need) { need = Math.abs(L); want = L; }
        }
      }
      v.latAim = need > Math.abs(base) ? want : base;
    }
  }

  /** The way the picture drives, made again: `fresh` from the sim's position (a jump, or a start);
   *  `leg` the sim began a new leg (the way it drove runs on into it); `path` the sim changed its path where it
   *  stands (a step aside into a bay, and back). The way is the path the picture has left up to where the sim
   *  was at its last tick, then what the sim's path says. */
  private track(v: Digger, h: HaulState, mode: 'fresh' | 'leg' | 'path') {
    const a = v.agent;
    v.mode = mode;
    const rest = h.path.map(([x, z]): Pt => [x, z]);
    v.leg = legKey(h);
    v.tail = rest;
    if (mode !== 'fresh' && a.pts.length > 1) {
      const s0 = a.s;
      const here = pointAt(a.pts, a.arcs, s0);
      // where the sim's way meets the one driven: the sim's last place (a new path from it), or its leg's first point
      let u = clamp(v.arcCur, s0, Traffic.end(a));
      let join: Pt = [pointAt(a.pts, a.arcs, u).x, pointAt(a.pts, a.arcs, u).z];
      let ahead: Pt[] = [[h.x, h.z], ...rest];
      let ok = true;
      if (mode === 'leg' && h.route?.length) {
        const [lx, lz] = h.route[0];
        let best = { u: Infinity, d: Infinity };
        for (let i = 1; i < a.pts.length; i++) {
          if (a.arcs[i] < s0 - 1e-6) continue;
          const [ax, az] = a.pts[i - 1], [bx, bz] = a.pts[i];
          const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
          const k = l2 > 1e-9 ? clamp(((lx - ax) * dx + (lz - az) * dz) / l2, 0, 1) : 0;
          const d = Math.hypot(lx - ax - dx * k, lz - az - dz * k);
          if (d < best.d - 1e-6) best = { u: a.arcs[i - 1] + Math.sqrt(l2) * k, d };
        }
        if (best.d < 1) {
          u = Math.max(s0, best.u);
          join = [lx, lz];
          ahead = h.route.slice(1).map(([x, z]): Pt => [x, z]);
        } else if (v.unit) ok = false;
        else {
          // a legacy pad that backed off: from where it stands to the leg's start by road, and on
          const gw = this.state ? groundWay(this.state, [here.x, here.z], [lx, lz]) : null;
          const cells = gw || !this.state ? null : roadRoute(this.state, cellAt(here.x, here.z), cellAt(lx, lz));
          if (!gw && !cells) { v.leg = ''; return; }
          const mid: Pt[] = gw ? gw.pts.slice(1, -1) : routePoints(cells!).slice(1);
          const way = dedupe([[here.x, here.z], ...mid, [lx, lz], ...h.route.slice(1).map(([x, z]): Pt => [x, z])]);
          this.setWay(v, way);
          v.arcPrev = 0; v.reach = 0;
          v.arcCur = Traffic.end(a) - pathLength(h.x, h.z, h.path);
          return;
        }
      } else if (mode === 'leg') {
        // (an old save has no route: its path as it stands)
      }
      if (ok) {
        const way: Pt[] = [[here.x, here.z]];
        for (let i = 1; i < a.pts.length; i++) if (a.arcs[i] > s0 + 1e-6 && a.arcs[i] < u - 1e-6) way.push(a.pts[i]);
        way.push(join, ...ahead);
        const prev = clamp(v.arcCur - s0, 0, Math.max(0, u - s0));
        const reach = Math.max(0, v.reach - s0);
        this.setWay(v, dedupe(way));
        v.arcPrev = prev;
        v.reach = Math.min(reach, Traffic.end(a));
        v.arcCur = Traffic.end(a) - pathLength(h.x, h.z, h.path);
        return;
      }
      this.snaps++;
    }
    // from the sim's position, nothing behind it
    const way: Pt[] = [[h.x, h.z], ...rest];
    v.x = h.x; v.z = h.z; v.ox = 0; v.oz = 0; a.x = h.x; a.z = h.z;
    this.face(v, way);
    this.traffic?.drop(a);
    this.setWay(v, way);
    v.arcPrev = 0; v.reach = 0;
    v.arcCur = Traffic.end(a) - pathLength(h.x, h.z, h.path);
  }

  private setWay(v: Digger, way: Pt[]) {
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
  private face(v: Digger, way: Pt[]) {
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
    a.s = Math.min(v.arcCur, Traffic.end(a));
    const p = pointAt(a.pts, a.arcs, a.s);
    if (Math.hypot(p.x - v.x, p.z - v.z) > 1e-4) v.yaw = Math.atan2(-p.dz, p.dx);
    v.x = p.x; v.z = p.z; a.x = p.x; a.z = p.z;
  }

  // ── the traffic driver ──

  prefer(a: Agent) {
    const v = this.all.get(a.id)!;
    const end = Traffic.end(a);
    // never past where the sim has it; the replay leads, the ramps follow it
    const cur = clamp(v.arcCur, a.s, end);
    const gap = v.target - a.s;
    a.stop = cur;
    let vmax = Math.min(CATCH * this.speed, Math.max(0, v.simV + GAIN * gap), Math.sqrt(2 * DECEL * 0.9 * Math.max(0, cur - a.s)));
    const { bend, hairpin } = bendsAhead(a, a.s);
    v.bend = bend;
    // a hairpin reverses its direction of travel: it comes to a stop there
    if (hairpin !== null) {
      a.stop = Math.min(a.stop, hairpin);
      vmax = Math.min(vmax, Math.sqrt(2 * DECEL * 0.9 * Math.max(0, hairpin - a.s)));
    }
    // nothing but the ramp holds it now: the last of the way at a crawl, so it stops on the spot
    if (a.stop - a.s > 1e-4 && v.target >= a.stop - 1e-6) vmax = Math.max(vmax, 0.3);
    if (a.stop - a.s <= 1e-4 && gap < 1e-4) vmax = 0;
    // the tracks: which way it faces. At the end of its way a unit parked in its bay squares up on it, any other stays as it is.
    if (end - a.s < 1e-3) {
      a.reverse = false;
      v.aim = v.homeDig && Math.hypot(v.x - v.pad[0], v.z - v.pad[1]) < 0.3 ? v.padYaw : v.yaw;
    } else {
      const q = pointAt(a.pts, a.arcs, Math.min(a.s + LEAD_M, end));
      const want = Math.atan2(-q.dz, q.dx);
      const errF = Math.abs(wrap(want - v.yaw)), errR = Math.abs(wrap(want + PI - v.yaw));
      // backing along a straight, when its way leaves the way it faces (it stands facing a wall, or the way turns back
      // on itself: out of a bay) and runs straight for no more than REVERSE_M
      const run = (bend ?? end) - a.s;
      a.reverse = a.reverse ? errR < 2.2 && run <= REVERSE_M + 5 : errF > 2.3 && run <= REVERSE_M;
      v.aim = a.reverse ? want + PI : want;
      // it slows as its heading falls behind the way's, and stands and turns when it is far behind
      vmax *= clamp(1 - Math.abs(wrap(v.aim - v.yaw)) / TURN_SLOW, 0, 1);
    }
    a.vmax = vmax;
    a.pivot = a.v < 0.5 && Math.abs(wrap(v.aim - v.yaw)) > 0.3;
  }

  moved(a: Agent, dt: number) {
    const v = this.all.get(a.id)!;
    const p = pointAt(a.pts, a.arcs, a.s);
    // inside a zone it keeps its lane, off its way to the right or the left; the lane fades out short of the end of
    // its way (it stands on the sim's spot). The offset is a world vector that moves at LANE_V m/s toward its aim, so a bend
    // or a turn on the spot moves the picture smoothly.
    const fade = clamp((Traffic.end(a) - a.s - 0.5) / 4, 0, 1);
    const lat = v.unit ? v.latAim * fade : 0;
    const sg = a.reverse ? -1 : 1;
    const tx = a.fx * sg, tz = a.fz * sg;
    const gx = tz * lat - v.ox, gz = -tx * lat - v.oz;
    const gl = Math.hypot(gx, gz), step = Math.min(gl, LANE_V * dt);
    if (gl > 1e-9) { v.ox += gx / gl * step; v.oz += gz / gl * step; }
    const x = p.x + v.ox, z = p.z + v.oz;
    const moved = Math.hypot(x - v.x, z - v.z);
    v.v = dt > 0 ? Math.min(20, moved / dt) : 0;
    v.x = x; v.z = z;
    a.x = x; a.z = z;
    // the tracks turn toward the way's heading at 90°/s at most, on the spot or on the move
    v.yaw += clamp(wrap(v.aim - v.yaw), -TURN * dt, TURN * dt);
    a.fx = Math.cos(v.yaw); a.fz = -Math.sin(v.yaw);
    // standing still, in its lane, and turned: it has settled once it has for SETTLE_S
    v.still = a.v < 0.05 && gl < 0.03 && Math.abs(wrap(v.aim - v.yaw)) < 0.02 ? v.still + dt : 0;
  }

  /** Legacy pads only (a hub unit is never asked): back off along the way it came until its body is clear of
   *  the others' ways, wait there a moment, then head on (true: it found such a place). */
  yieldTo(a: Agent, others: Agent[]): boolean {
    const v = this.all.get(a.id);
    const t = this.traffic;
    if (!v || v.unit || !t || a.s <= 0) return false;
    const avoid = new Set<number>();
    for (const o of others) for (const k of t.claimOf(o, 40)) avoid.add(k);
    // walk back a metre at a time: every cell passed must be free, the stop clear of their ways
    for (let u = a.s - 1; u >= 0; u -= 1) {
      const cells = t.cellsAt(a, u);
      if (cells.some((k) => t.heldByOther(a, k) && !avoid.has(k))) return false;
      if (cells.some((k) => avoid.has(k))) continue;
      // back to arc u: the way reversed from here
      const back: Pt[] = [[v.x, v.z]];
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

  /** The last resort, for a legacy pad only: set down where the sim has it, if that ground is free (never onto another unit).
   *  A hub unit is never set down: the sim keeps it clear of the others. */
  rescue(a: Agent) {
    const v = this.all.get(a.id);
    const h = this.hauls.get(a.id);
    const t = this.traffic;
    if (!v || v.unit || !h || !t) return;
    const yaw = v.yaw;
    if (!t.boxFree(a, h.x, h.z, Math.cos(yaw), -Math.sin(yaw))) return;
    this.track(v, h, 'fresh');
    this.setDowns++;
  }

  /** After the traffic step: which diggers are away from their pads, then draw. */
  finish(dt: number, sunLight: number) {
    for (const v of this.all.values()) {
      const home = Math.hypot(v.x - v.pad[0], v.z - v.pad[1]) < 0.3;
      // home on its pad and squared up: the building instance takes over (a hub unit has no pad: always here)
      v.away = v.unit || !home || Math.abs(wrap(v.padYaw - v.yaw)) > 0.02;
      // how far the picture trails the sim (its position now, not the replay of its last tick), in seconds of driving
      if (dt > 0) {
        this.lagMax = Math.max(this.lagMax, Math.max(0, v.arcCur - v.agent.s) / this.speed);
        this.replayMax = Math.max(this.replayMax, Math.max(0, v.reach - v.agent.s) / this.speed);
      }
    }
    this.drawn = [...this.all.values()].filter((v) => v.away).slice(0, MAX);
    const sig = this.drawn.filter((v) => !v.unit).map((v) => v.id).join(',');
    if (sig !== this.awaySig) {
      this.awaySig = sig;
      this.onAway?.(new Set(this.drawn.filter((v) => !v.unit).map((v) => v.id)));
    }
    this.draw(sunLight);
  }

  private draw(sunLight: number) {
    const n = this.drawn.length;
    for (const um of this.meshes) um.drawn.length = 0;
    this.decals.count = n;
    this.decalMat.opacity = 0.45 * sunLight;
    this.decals.visible = sunLight > 0.02 && n > 0;
    const hf = this.hf;
    for (let i = 0; i < n; i++) {
      const v = this.drawn[i];
      const um = this.meshOf(v);
      v.slot = um.drawn.length;
      um.drawn.push(v);
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
      um.mesh.setMatrixAt(v.slot, this.m);
      // (a unit that has not settled yet is not at work: the rig is told it still drives)
      this.work?.diggerAt(v.id, this.m, v.still >= SETTLE_S ? v.v : Math.max(v.v, 0.25));
      this.q.setFromAxisAngle(this.by.set(0, 1, 0), v.yaw);
      this.m.compose(this.p.set(v.x, hf.sample(v.x, v.z) + 0.05, v.z), this.q, this.sc.set(9, 1, 5.2));
      this.decals.setMatrixAt(i, this.m);
    }
    this.decals.instanceMatrix.needsUpdate = true;
    for (const um of this.meshes) {
      um.mesh.count = um.drawn.length;
      um.mesh.visible = um.drawn.length > 0;
      um.mesh.instanceMatrix.needsUpdate = true;
      um.mesh.boundingSphere = null;
      // its lights as the pad's would be: the lit channel 0 / 2 + k, and the window level
      const g = um.mesh.geometry;
      const st = g.getAttribute('iState') as THREE.InstancedBufferAttribute;
      const glow = g.getAttribute('iGlow') as THREE.InstancedBufferAttribute | undefined;
      for (let i = 0; i < um.drawn.length; i++) {
        const v = um.drawn[i];
        const k = this.darkOf?.(v.id) ?? 0;
        st.setX(i, this.darkOf ? litChannel(v.powered, k) : v.powered ? 1 : 0);
        glow?.setX(i, v.powered ? (this.darkOf ? k : -1) : 0);
      }
      st.needsUpdate = true;
      if (glow) glow.needsUpdate = true;
    }
  }

  /** The digger under a ray (its building id) and how far along the ray. */
  pick(raycaster: THREE.Raycaster): { id: number; d: number } | null {
    let best: { id: number; d: number } | null = null;
    for (const um of this.meshes) {
      if (!um.drawn.length) continue;
      const hit = raycaster.intersectObject(um.mesh, false).find((h) => h.instanceId !== undefined);
      const v = hit ? um.drawn[hit.instanceId!] : undefined;
      if (v && (!best || hit!.distance < best.d)) best = { id: v.id, d: hit!.distance };
    }
    return best;
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
      if (v.digging && v.v < 0.2 && v.still >= SETTLE_S) {
        const lx = 3.9, lz = 0.7; // the recipe's bucket wheel, front face
        const x = v.x + lx * c + lz * sn, z = v.z - lx * sn + lz * c;
        out.push({ d: Math.hypot(x - cam.x, z - cam.z), e: {
          x, y: this.hf.sample(x, z), z, strength: 0.7,
          vx: c * 0.9, vy: 1.3, vz: -sn * 0.9, hSpread: 0.9, vSpread: 1.1, h0: 0.3, size: 0.06,
          tint: liveryOf(v.mk).band, // the spoil takes the digger's accent
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
  private takeReplay() { const l = this.replayMax; this.replayMax = 0; return l; }

  info() {
    const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    const first = this.meshes[0];
    return {
      count: this.all.size,
      away: this.drawn.map((v) => v.id),
      /** the upgrade key and triangles of the first mesh (the legacy pad's excavator) */
      key: first.key,
      triangles: tris(first.mesh.geometry),
      /** each mesh by its key ('excavator:smelter'…): what it draws, its triangles and its size (m) */
      meshes: Object.fromEntries(this.meshes.map((um) => {
        const g = um.mesh.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        const sz = g.boundingBox!.getSize(new THREE.Vector3());
        return [um.mk, { count: um.drawn.length, triangles: tris(g), size: [sz.x, sz.y, sz.z].map((x) => Math.round(x * 100) / 100), key: um.key }];
      })),
      lit: this.drawn.map((v) => (this.meshOf(v).mesh.geometry.getAttribute('iState') as THREE.InstancedBufferAttribute).getX(v.slot)),
      dark: this.drawn.map((v) => this.darkOf?.(v.id) ?? null),
      material: (first.mesh.material as THREE.Material).type,
      poses: [...this.all.values()].map((v) => ({
        id: v.id, x: Math.round(v.x * 100) / 100, z: Math.round(v.z * 100) / 100, yaw: Math.round(v.yaw * 1000) / 1000, digging: v.digging, away: v.away,
        /** m the picture trails the sim's position along its track */
        lagM: Math.round((v.arcCur - v.agent.s) * 100) / 100,
        s: Math.round(v.agent.s * 100) / 100, end: Math.round(Traffic.end(v.agent) * 100) / 100,
        mode: v.mode, inZone: v.inZone, latAim: Math.round(v.latAim * 100) / 100, bend: v.bend, reach: Math.round(v.reach * 100) / 100, cur: Math.round(v.arcCur * 100) / 100, aim: Math.round(v.aim * 1000) / 1000,
        v: Math.round(v.v * 100) / 100, lat: Math.round(Math.hypot(v.ox, v.oz) * 100) / 100, settled: v.still >= SETTLE_S,
        pivot: !!v.agent.pivot, reverse: !!v.agent.reverse, way: v.agent.pts.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]),
      })),
      /** the most any digger trailed the sim since the last read, game-seconds of driving */
      lagMaxS: Math.round(this.takeLag() * 100) / 100,
      /** … behind the replay of the sim (its position one economy tick ago) */
      replayLagMaxS: Math.round(this.takeReplay() * 100) / 100,
      /** pictures placed on the sim's position outside a jump of sim time (a legacy pad set down after a long lag) and
       *  hub units whose new way did not join the one they drove: a hub unit is never set down, so 0 */
      setDowns: this.setDowns,
      snaps: this.snaps,
    };
  }
}
