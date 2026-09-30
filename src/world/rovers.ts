/** The construction-rover fleet made visible: one instanced rover per unit
 *  in the sim's roster (`state.rovers`, core/fleet.ts), docked at the
 *  structures that supply them (the Lander, Robotics Bays). Rovers live on the roads (docs/15-roads.md): each has a
 *  slot on a road cell from core/spots.ts — a parking bay by its dock, the
 *  frontier of a road it sinters, a site's door — and drives there along
 *  the open road in the right-hand lane when its slot changes. The ground
 *  traffic (world/traffic.ts) shares the cells out, so rovers queue, pass
 *  in opposite lanes, and never meet an excavator or each other. A dock out
 *  of bays keeps the rest inside (not drawn). Heading follows the lane with
 *  a turn-rate limit, and the chassis sits on the heightfield, pitched and
 *  rolled to it. The selected rover wears a ring; rovers are picked by
 *  instance (or by nearness on screen).
 *
 *  Units docked at a Drone Hive are drones (core/fleet.ts unitKind): drawn
 *  by DroneFlight at the end of this file, they fly straight to their work
 *  and take no road slot and no part in the ground traffic.
 *
 *  The sim drives them (core/transit.ts): each unit's trip — its route, its
 *  speed, when it set off — says where it should be now, and the visual
 *  follows, its progress along its own lane way matched to the sim's along
 *  the route (the tick fraction added), chasing up to 1.6× cruise when the
 *  traffic held it up. More than LAG_S of driving behind, or not yet at its
 *  stand when the sim has it at work, it is set down where the sim has it
 *  (if that ground is clear). Sim time the visuals never showed (a debug
 *  advance, a load) sets every one down where the sim has it.
 *
 *  Rovers use the building material (same program, finishes, lamps and a
 *  blinking beacon; unlit twin in safe mode) and cast no shadow-map shadow —
 *  a moving caster would re-render the map every frame. A soft decal smeared
 *  down-sun stands in for it. Motion runs on game time: pause freezes them. */
import * as THREE from 'three';
import type { GameState, RoverUnit } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import { cellAt, cellCentre, cellKey, doorCell, groundWay, isOpen, offAreaAt, roadMap, roadRoute } from '../core/roads';
import { zoneCells } from '../core/zones';
import { DRONE, unitKind } from '../core/fleet';
import { BUILDINGS } from '../data/buildings';
import { centerOf } from '../buildings/instances';
import { groundSpots, type RoverSpot } from '../core/spots';
import { HIVE_DECK_Y, ROAD, ROVER } from '../data/roads';
import { arrived, droneGoal, dronePads, padPoint, spotGoal, travelled, tripPoint, tripShare, tripSpeed } from '../core/transit';
import { TECHS, type TechId } from '../data/techs';
import {
  BEACON, BODY, GLASS, LAMP, PLATE, TRIM, bar, box, cyl, dome, merge, withInstanceState,
} from '../buildings/meshKit';
import { materials } from './materials';
import { inked } from './ink';
import type { DustEmitter } from './dust';
import { MAX_ROVER_VOICES, type RoverSound } from '../audio/roverVoices';
import { Traffic, WHOLE, laneAxis, laneMode, laneSide, pointAt, standAt, type Agent, type Driver } from './traffic';
import type { WorkAnim } from './workAnim';

const MAX_ROVERS = 64;
/** a command view's listener height, as a share of the camera's distance */
const LISTENER_LIFT = 0.3;
const SCALE = 1.25;
const SPEED = ROVER.speed; // m/s cruise on a sintered road (the sim's, data/roads.ts)
const ACCEL = ROVER.accel; // m/s²
const CATCH = 1.6;        // × cruise: the most a rover drives to catch up with the sim
const GAIN = 1.5;         // 1/s: how hard it closes the gap
const LAG_S = 6;          // s of driving a drone may trail the sim before it is set down where the sim has it (rovers are never set down)
const TURN = 2.4;         // rad/s
const YIELD_S = 4;        // s a rover waits at a refuge before it heads on
const PIVOT = 1;          // rad: a way that sets off further than this from its heading starts with a turn on the spot
const PI = Math.PI;
/** the body: 1.35 × 1.95 m */
export const ROVER_BODY = { hw: 0.68 * SCALE / 1.25, front: 0.98 * SCALE / 1.25, back: 0.98 * SCALE / 1.25 };

/** Road travel for the techs done, and the night (core/mods.ts has the sim's copy). */
export function roadSpeedFor(techsDone: readonly TechId[], night: boolean, hauler = false): number {
  let m = 1;
  for (const t of techsDone) {
    for (const fx of TECHS[t]?.effects ?? []) {
      if (fx.kind !== 'road') continue;
      m *= fx.speedMult ?? 1;
      if (hauler) m *= fx.haulMult ?? 1;
      if (night) m *= fx.nightMult ?? 1;
    }
  }
  return m;
}

/** The on-board power techs done (docs/02 · On-board power), as a key: each adds its part
 *  to every rover and drone (the excavator's are in buildings/upgrades.ts). */
const PACK_TECHS: readonly TechId[] = ['roverPowerPacks', 'fuelCellPacks', 'radioisotopeUnits'];
export const packKey = (techsDone: readonly TechId[]): string => PACK_TECHS.filter((t) => techsDone.includes(t)).join(',');

/** A rover's pack parts, rover space (before SCALE): battery pods on the flanks
 *  between the wheels, hydrogen and oxygen tanks across the rear deck, a finned
 *  radioisotope unit on the tail. */
function roverPackParts(key: string): THREE.BufferGeometry[] {
  const has = (t: TechId) => key.split(',').includes(t);
  const out: THREE.BufferGeometry[] = [];
  if (has('roverPowerPacks')) {
    for (const x of [-0.56, 0.56]) out.push(box(0.12, 0.2, 0.42, PLATE, x, 0.64, 0), box(0.13, 0.04, 0.44, BODY, x, 0.76, 0));
  }
  if (has('fuelCellPacks')) {
    out.push(cyl(0.08, 0.08, 0.5, BODY, -0.15, 0.95, -0.6, 0, PI / 2, 10), cyl(0.065, 0.065, 0.5, PLATE, -0.15, 0.94, -0.42, 0, PI / 2, 10));
  }
  if (has('radioisotopeUnits')) {
    out.push(cyl(0.09, 0.09, 0.3, TRIM, 0, 0.72, -0.88, PI / 2, 0, 10));
    out.push(box(0.34, 0.02, 0.26, PLATE, 0, 0.72, -0.88), box(0.02, 0.34, 0.26, PLATE, 0, 0.72, -0.88));
  }
  return out;
}

function roverGeometry(key = ''): THREE.BufferGeometry {
  const parts: (THREE.BufferGeometry | THREE.BufferGeometry[])[] = [
    ...roverPackParts(key),
    box(1.0, 0.4, 1.5, BODY, 0, 0.64, 0),
    box(0.92, 0.05, 1.1, GLASS, 0, 0.865, -0.1),
    box(1.08, 0.08, 1.56, TRIM, 0, 0.46, 0),
    box(0.28, 0.07, 0.04, LAMP, -0.28, 0.68, 0.76),
    box(0.28, 0.07, 0.04, LAMP, 0.28, 0.68, 0.76),
    bar([0.32, 0.88, -0.45], [0.32, 1.45, -0.45], 0.06, TRIM),
    box(0.34, 0.14, 0.18, PLATE, 0.32, 1.5, -0.42),
    dome(0.05, BEACON, 0.32, 1.57, -0.42, 8),
    // the print arm moves: world/workAnim.ts draws it (folded over the nose at rest)
  ];
  for (const x of [-0.58, 0.58]) {
    for (const z of [-0.52, 0.52]) {
      parts.push(cyl(0.26, 0.26, 0.2, PLATE, x, 0.26, z, 0, PI / 2, 12));
      parts.push(bar([x * 0.8, 0.47, z], [x, 0.3, z], 0.06, TRIM));
    }
  }
  const g = merge(parts);
  g.userData.recipe = 'rover'; // the cel palette: the logistics accent
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
  /** its roster unit (bricked by a hazard: parked, lamps and beacon off) */
  unit: RoverUnit | null;
  x: number; z: number; yaw: number; v: number;
  home: number;
  site: number | null;
  /** the slot it holds or heads for, and its key (a new key replans) */
  spot: RoverSpot | null;
  key: string;
  /** inside its dock (out of bays, or not yet out): not drawn, not in traffic */
  inside: boolean;
  working: boolean;
  phase: number;
  /** backing off to a refuge: until when (then it heads for its slot again) */
  yieldUntil: number;
  /** backing out (of a bay) up to this arc of its way */
  revUntil: number;
  /** turning on the spot (to `aim`) before it sets off */
  turning: boolean;
  aim: number;
  agent: Agent;
  /** the sim goal its way leads to (core/transit.ts spotGoal), and the sim trip it was built for */
  goal: string;
  tripId: string;
  /** the sim's progress (0..1) along that trip, and the arc it stood at, when the two were matched */
  p0: number;
  s0: number;
  /** the sim time it was first seen at work away from its stand (it gets a second to arrive) */
  /** how it moves: along with the sim's trip, held (the sim has not set off yet), or on its own */
  follow: 'sim' | 'hold' | 'free';
  /** where the sim has it along its way (arc, m), and the sim's cruise while it drives */
  target: number;
  vSim: number;
  /** what it does at its stand, from the sim (core/transit.ts, RoverUnit.task): welding a
   *  building, sintering a road cell, or nothing (driving, parked, waiting) */
  mode: 'weld' | 'sinter' | null;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const spotKey = (p: RoverSpot) => `${p.site ?? 'p'}:${p.road ?? ''}@${p.gx},${p.gz},${p.side}${p.inside ? 'in' : ''}`;
/** a sim trip's identity: a new one (a replan) rebuilds the way */
const tripKey = (t: RoverUnit['trip']) => (t ? `${t.goal}#${t.len.toFixed(2)}#${t.pts[0][0].toFixed(2)},${t.pts[0][1].toFixed(2)}${t.stuck ? '!' : ''}` : '');
/** the sim's progress along a trip, 0..1 of its real metres, `ahead` s on from its last tick */
const progress = (t: NonNullable<RoverUnit['trip']>, ahead: number) => tripShare(t, ahead);
type Cell = [number, number];

/** The right-hand lane's offset for travel along `d` (a unit cell step). */
const right = (d: Cell): [number, number] => [-d[1] * ROAD.lane, d[0] * ROAD.lane];

/** A rover's way along road cells: from where it stands, in the right-hand
 *  lane (the first cell left in the half it stands in when `keep` — another
 *  stands beside it — the last entered in the half of its slot), to the slot. */
export function laneWay(cells: Cell[], from: [number, number], to: [number, number], keep = true, late = false): [number, number][] {
  const pts: [number, number][] = [from];
  if (cells.length <= 1) { pts.push(to); return pts; }
  const n = cells.length;
  for (let i = 0; i < n - 1; i++) {
    const d: Cell = [cells[i + 1][0] - cells[i][0], cells[i + 1][1] - cells[i][1]];
    const [cx, cz] = cellCentre(cells[i][0], cells[i][1]);
    const ex = cx + d[0] * 2, ez = cz + d[1] * 2; // the edge it leaves by
    let [ox, oz] = right(d);
    if (i === 0 && keep) {
      // out of the first cell in the half it stands in
      const lat = d[0] !== 0 ? from[1] - cz : from[0] - cx;
      const side = Math.abs(lat) > 0.4 ? Math.sign(lat) * ROAD.lane : 0;
      if (d[0] !== 0) { ox = 0; oz = side || oz; } else { ox = side || ox; oz = 0; }
    }
    // (late: out of a shared first cell in its own half all the same, over to
    // the slot's half inside the last cell)
    if (i === n - 2 && !(late && i === 0 && keep && Math.abs(d[0] !== 0 ? from[1] - cz : from[0] - cx) > 0.4)) {
      // into the last cell in the half of its slot
      const [tx, tz] = cellCentre(cells[n - 1][0], cells[n - 1][1]);
      const lat = d[0] !== 0 ? to[1] - tz : to[0] - tx;
      if (Math.abs(lat) > 0.4) { if (d[0] !== 0) { ox = 0; oz = Math.sign(lat) * ROAD.lane; } else { ox = Math.sign(lat) * ROAD.lane; oz = 0; } }
    }
    pts.push([ex + ox, ez + oz]);
  }
  pts.push(to);
  return pts;
}

/** A bay cell's opening onto the road (its open non-bay neighbour), or null if c is no bay. */
function bayOpening(s: GameState, c: Cell): Cell | null {
  const map = roadMap(s);
  if (!map.get(cellKey(c[0], c[1]))?.bay) return null;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = map.get(cellKey(c[0] + dx, c[1] + dz));
    if (n && isOpen(n) && !n.bay) return [c[0] + dx, c[1] + dz];
  }
  return null;
}

export class RoverFleet implements Driver {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private decals: THREE.InstancedMesh;
  private decalMat: THREE.MeshBasicMaterial;
  private rovers: Rover[] = [];
  /** the ones drawn (not inside a dock), in instance order */
  private drawn: Rover[] = [];
  private byId = new Map<number, Rover>();
  private spots = new Map<number, RoverSpot>();
  private spotSig = '';
  private clock = 0;
  private state: GameState | null = null;
  private speed = SPEED;
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
  /** the Drone Hive's units (core/fleet.ts unitKind): they fly (docs/14 §4.3) */
  readonly drones: DroneFlight;
  private hiveUnits = new Set<number>();
  private droneUnits: RoverUnit[] = [];
  private seenState: GameState | null = null;
  /** lit channel per drawn instance, as last written (bricked: 0) */
  private litSeen = new Float32Array(MAX_ROVERS).fill(1);
  private soundList: RoverSound[] = [];
  /** the sim clock at the last frame: time the visuals missed sets them down where the sim has them */
  private lastSim: number | null = null;
  /** sim seconds a frame against the visuals' (≥ 1: slow frames drive faster), and the tick fraction */
  private pace = 1;
  private frac = 0;
  /** the most any rover trailed the sim since the last read (s of driving), and set-downs so far */
  private lagMax = 0;
  private setDowns = 0;

  constructor(private hf: Heightfield, traffic?: Traffic) {
    this.traffic = traffic ?? new Traffic();
    this.ownTraffic = !traffic;
    this.mesh = new THREE.InstancedMesh(withInstanceState(roverGeometry(), MAX_ROVERS),
      materials.get('building'), MAX_ROVERS);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    inked(this.mesh, 'rover');
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
    this.drones = new DroneFlight(hf, this.group);
  }

  private ring: THREE.Mesh;
  /** the pack parts drawn (packKey of the techs done) */
  private packKey = '';
  /** the rover the inspector shows (its ring is drawn), by roster id */
  selected: number | null = null;

  // ── the work animations' hooks (world/workAnim.ts) ──
  /** the work animations (life.ts sets them): each rover's arm and sparks, the drones' beams */
  private work: WorkAnim | null = null;
  setWork(w: WorkAnim | null) { this.work = w; this.drones.work = w; }

  /** Per frame: `dt` game seconds (0 while paused). With a shared traffic
   *  layer the owner calls sync(), steps the traffic, then draw(). */
  update(dt: number, state: GameState, sunDir: THREE.Vector3, sunLight: number) {
    if (this.ownTraffic) syncGround(this.traffic, state);
    this.sync(dt, state);
    if (this.ownTraffic) this.traffic.step(dt);
    this.draw(dt, sunDir, sunLight);
  }

  /** The visuals follow the sim roster, keyed by rover id. Each rover's slot
   *  (core/spots.ts groundSpots, the sim's too), a way there along the open
   *  road when the slot or the sim's trip changes, and how far along it the
   *  sim has it (core/transit.ts). `frac`: the part of the next economy
   *  second already gone. */
  sync(dt: number, state: GameState, night = false, frac = 0) {
    this.clock += dt;
    this.frozen = dt <= 0;
    this.state = state;
    // the on-board power techs grow their parts on every rover (the instance state carries over)
    const pk = packKey(state.techsDone);
    if (pk !== this.packKey) {
      const old = this.mesh.geometry;
      this.mesh.geometry = withInstanceState(roverGeometry(pk), MAX_ROVERS, old);
      old.dispose();
      this.packKey = pk;
    }
    this.speed = SPEED * roadSpeedFor(state.techsDone, night);
    this.frac = Math.max(0, Math.min(1, frac));
    const sig = spotSignature(state);
    // a load hands over new roster objects under the same layout: re-read them
    const loaded = state !== this.seenState;
    const fresh = sig !== this.spotSig || loaded;
    this.seenState = state;
    // sim time the visuals never showed (a debug advance, a load): set down where the sim has them
    const simDelta = this.lastSim === null ? Infinity : state.simTime - this.lastSim;
    this.lastSim = state.simTime;
    const jumped = loaded || simDelta < 0 || (dt <= 0 ? simDelta > 1e-6 : simDelta - dt > 3);
    this.pace = dt > 0 ? clamp(simDelta / dt, 1, 5) : 1;
    const all = state.rovers ?? [];
    if (fresh) {
      this.spotSig = sig;
      // hive units fly: they take no road slot, and leave the ground to the rovers
      this.hiveUnits = new Set(all.filter((u) => unitKind(state, u) === 'drone').map((u) => u.id));
      this.spots = groundSpots(state);
    }
    this.droneUnits = all.filter((u) => this.hiveUnits.has(u.id));
    this.drones.sync(dt, state, this.droneUnits, fresh, this.frac, jumped, this.pace);
    const roster = all.filter((u) => !this.hiveUnits.has(u.id)).slice(0, MAX_ROVERS);
    const next: Rover[] = [];
    const jump: Rover[] = [];
    for (const u of roster) {
      const spot = this.spots.get(u.id);
      if (!spot) continue;
      let r = this.byId.get(u.id);
      if (!r) {
        r = this.born(u, spot);
      } else if (jumped) jump.push(r);
      r.home = spot.dock;
      r.unit = u;
      next.push(r);
    }
    // the jump: everyone off their cells, then each set down where the sim has it (if clear)
    if (jump.length) {
      for (const r of jump) this.traffic.drop(r.agent);
      for (const r of jump) {
        const spot = this.spots.get(r.id)!;
        if (!this.setDown(r, spot)) { if (!r.inside) this.traffic.place(r.agent); }
      }
    }
    for (const r of next) {
      const u = r.unit!, spot = this.spots.get(r.id)!;
      const tk = tripKey(u.trip);
      const key = spotKey(spot);
      // a new slot: a new way there; the sim replanned for the slot it heads for: the same way, retimed
      if (key !== r.key && this.clock >= r.yieldUntil) this.head(r, spot, state);
      else if (tk !== r.tripId && key === r.key) this.retime(r, spot, state);
      this.follow(r, spot, jumped, dt);
    }
    this.rovers = next;
    this.byId = new Map(next.map((r) => [r.id, r]));
    this.drawn = next.filter((r) => !r.inside);
    this.traffic.enlist('rover', this.drawn.map((r) => r.agent));
  }

  /** A rover new to the visuals: where the sim has it (inside its dock if
   *  the sim has it in there), else on its slot (before the sim's first tick). */
  private born(u: RoverUnit, spot: RoverSpot): Rover {
    const t = u.trip;
    const simAt = u.x !== undefined && u.z !== undefined;
    const settled = !t || arrived(t);
    const inside = !!spot.inside && settled;
    const [x, z] = simAt ? [u.x!, u.z!] : [spot.x, spot.z];
    let yaw = spot.face;
    if (t && !settled && t.pts.length > 1) {
      const [ax, az] = tripPoint(t), [bx, bz] = tripPoint(t, 0.2);
      if (Math.hypot(bx - ax, bz - az) > 1e-6) yaw = Math.atan2(bx - ax, bz - az);
    }
    // on its slot already: no way to drive
    const onSlot = !inside && settled && Math.hypot(x - spot.x, z - spot.z) < 0.3;
    const r: Rover = {
      id: u.id, unit: u, x, z, yaw, v: 0, home: spot.dock, site: spot.site, spot: onSlot ? spot : null,
      key: onSlot ? spotKey(spot) : '', inside, working: false, phase: u.id * 2.399, yieldUntil: 0,
      revUntil: -Infinity, turning: false, aim: yaw, agent: null!,
      goal: '', tripId: '', p0: 0, s0: 0, follow: 'free', target: 0, vSim: 0, mode: null,
    };
    r.agent = {
      kind: 'rover', id: u.id, key: 1e6 + u.id, x, z, fx: Math.sin(yaw), fz: Math.cos(yaw),
      hw: ROVER_BODY.hw, front: ROVER_BODY.front, back: ROVER_BODY.back, wide: false, cls: 1,
      pts: [], arcs: [], spans: [], s: 0, v: 0, vmax: 0, stop: 0, accel: ACCEL, decel: 2 * ACCEL,
      standMode: laneMode(spot.axis === 'x' ? 0 : 1, spot.side), held: new Map(), blocker: null, waited: 0, drv: this,
    };
    if (!inside) {
      this.traffic.setWay(r.agent, [[x, z]]);
      // a clear spot: it holds its cells now; else it waits inside its dock until the lag brings it out
      if (this.traffic.laneFree(r.agent, x, z, r.agent.fx, r.agent.fz)) this.traffic.place(r.agent);
      else { r.inside = true; r.key = ''; }
    }
    if (onSlot && t) { r.goal = t.goal; r.tripId = tripKey(t); r.p0 = 1; r.follow = 'sim'; }
    return r;
  }

  /** Where the sim has it now: its trip's point (with the tick fraction) and
   *  heading, or its slot once there. Null: the sim has no place for it yet. */
  private simPose(r: Rover, spot: RoverSpot): { x: number; z: number; yaw: number; there: boolean } | null {
    const u = r.unit;
    const t = u?.trip;
    if (!u || !t || t.stuck || u.x === undefined) return null;
    if (arrived(t)) {
      // there: its slot, if the sim's goal is the slot it heads for
      const mine = spotGoal(this.state!, spot).key === t.goal;
      const [x, z] = mine ? [spot.x, spot.z] : t.pts[t.pts.length - 1];
      return { x, z, yaw: mine ? spot.face : r.yaw, there: true };
    }
    // on its way: the sim's point, in the right-hand lane of the road it drives
    // (the sim's route runs down the centre line); or where its own way,
    // retimed to the sim, has it
    if (r.follow === 'sim' && !r.inside && this.clock >= r.yieldUntil) {
      const q = pointAt(r.agent.pts, r.agent.arcs, r.target);
      return { x: q.x, z: q.z, yaw: Math.atan2(q.dx, q.dz), there: false };
    }
    const [x, z] = tripPoint(t, this.frac);
    const [bx, bz] = tripPoint(t, this.frac + 0.2);
    const dx = bx - x, dz = bz - z, l = Math.hypot(dx, dz);
    if (l < 1e-6) return { x, z, yaw: r.yaw, there: false };
    // off the road (inside a zone, out to a Relay Mast): the sim's point as it is
    if (offAreaAt(this.state!, x, z)) return { x, z, yaw: Math.atan2(dx, dz), there: false };
    const ux = dx / l, uz = dz / l;
    // the lane: a lane's width to the right of the way on, along its axis
    const [lx, lz] = Math.abs(ux) >= Math.abs(uz) ? [0, Math.sign(ux) * ROAD.lane] : [-Math.sign(uz) * ROAD.lane, 0];
    const [cx, cz] = cellCentre(...cellAt(x, z));
    const [px, pz] = Math.abs(ux) >= Math.abs(uz) ? [x, cz + lz] : [cx + lx, z];
    return { x: px, z: pz, yaw: Math.atan2(Math.abs(ux) >= Math.abs(uz) ? Math.sign(ux) : 0, Math.abs(ux) >= Math.abs(uz) ? 0 : Math.sign(uz)), there: false };
  }

  /** Set it down where the sim has it, if that ground is clear (never onto
   *  another unit); into its dock if the sim has it in there. True: done. */
  private setDown(r: Rover, spot: RoverSpot, count = true): boolean {
    const p = this.simPose(r, spot);
    if (!p) return false;
    const a = r.agent;
    if (p.there && spot.inside) {
      this.traffic.drop(a);
      r.inside = true;
      r.x = p.x; r.z = p.z; a.x = p.x; a.z = p.z;
      r.key = spotKey(spot); r.spot = spot;
      return true;
    }
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    if (!this.traffic.laneFree(a, p.x, p.z, fx, fz)) return false;
    this.traffic.drop(a);
    r.x = p.x; r.z = p.z; r.yaw = r.aim = p.yaw; r.v = 0;
    a.x = p.x; a.z = p.z; a.fx = fx; a.fz = fz; a.v = 0;
    r.inside = false; r.turning = false; r.yieldUntil = 0; r.revUntil = -Infinity;
    this.traffic.setWay(a, [[p.x, p.z]]);
    // it holds the half it stands in (not its slot's: another may pass in the other)
    a.standMode = standAt(p.x, p.z, fx, fz);
    this.traffic.place(a);
    // on from here: a new way to its slot
    r.key = ''; r.tripId = '';
    if (count) this.setDowns++;
    return true;
  }

  /** How it follows the sim this frame: its target arc along its way. It is
   *  never set down where the sim has it for trailing (S4b): it drives on. */
  private follow(r: Rover, spot: RoverSpot, jumped: boolean, dt: number) {
    const u = r.unit!;
    const t = u.trip;
    const a = r.agent;
    const yielding = this.clock < r.yieldUntil;
    r.follow = !t || u.x === undefined ? 'free' : t.stuck || t.goal !== r.goal ? 'hold' : 'sim';
    // its way does not lead to its slot (a refuge, no way there yet): on its own
    if (yielding || r.key !== spotKey(spot)) r.follow = r.follow === 'hold' ? 'hold' : 'free';
    if (r.follow === 'sim' && t) {
      const p = arrived(t) ? 1 : progress(t, this.frac);
      const k = r.p0 >= 1 - 1e-6 ? 1 : clamp((p - r.p0) / (1 - r.p0), 0, 1);
      const end = Traffic.end(a);
      r.target = r.s0 + (end - r.s0) * k;
      r.vSim = arrived(t) ? 0 : tripSpeed(t, this.frac);
    } else {
      r.target = Traffic.end(a);
      r.vSim = 0;
    }
    if (jumped || dt <= 0 || !t || t.stuck || u.x === undefined) return;
    // how far behind the sim it is, in seconds of driving
    let lag = 0;
    if (r.follow === 'sim' && !r.inside) lag = Math.max(0, r.target - a.s) / Math.max(this.speed, 0.1);
    else {
      const p = this.simPose(r, spot);
      if (p && (r.inside ? !(p.there && spot.inside) : true)) lag = Math.hypot(p.x - r.x, p.z - r.z) / Math.max(this.speed, 0.1);
    }
    this.lagMax = Math.max(this.lagMax, lag);
  }

  /** Head for a slot: a way along the open road from where it is (or out of
   *  its dock's door). No way yet: it stays and asks again next frame. */
  private head(r: Rover, spot: RoverSpot, s: GameState) {
    if (spot.inside) {
      // into the dock: from the door it drives in and is gone
      const dock = s.buildings.find((b) => b.id === spot.dock);
      const d = dock ? doorCell(dock) : null;
      if (!r.inside && d) {
        // (off the road inside a zone: out by its gate first)
        const gw = offAreaAt(s, r.x, r.z) ? groundWay(s, [r.x, r.z], cellCentre(d[0], d[1])) : null;
        const cells = gw ? null : roadRoute(s, cellAt(r.x, r.z), d);
        if (!gw && !cells) return;
        this.traffic.setWay(r.agent, gw ? gw.pts.map(([x, z]): [number, number] => [x, z]) : laneWay(cells!, [r.x, r.z], cellCentre(d[0], d[1])));
        r.agent.standMode = WHOLE;
        r.spot = spot;
        r.key = spotKey(spot);
        this.mark(r, spot, s);
        return;
      }
      r.spot = spot;
      r.key = spotKey(spot);
      r.inside = true;
      this.mark(r, spot, s);
      return;
    }
    let from: Cell;
    if (r.inside && r.unit?.x !== undefined) {
      // rolling out where the sim has it (its dock's door, as a rule), if that is clear
      if (!this.setDown(r, spot, false)) return;
      from = cellAt(r.x, r.z);
    } else if (r.inside) {
      // rolling out of its dock by the door, if the door is clear
      const dock = s.buildings.find((b) => b.id === spot.dock);
      const d = dock ? doorCell(dock) : null;
      if (!d || !isOpen(roadMap(s).get(cellKey(d[0], d[1]))) || this.traffic.taken(null, d[0], d[1])) return;
      const [x, z] = cellCentre(d[0], d[1]);
      r.x = x; r.z = z;
      r.agent.x = x; r.agent.z = z;
      from = d;
    } else {
      from = cellAt(r.x, r.z);
    }
    // off the road inside an extraction zone, either end (core/zones.ts): straight
    // off-road to and from the zone's gate, the road between in the right-hand lane
    if (spot.offroad || offAreaAt(s, r.x, r.z)) {
      const pts = this.offWay(r, spot, s, from);
      if (!pts) return;
      this.traffic.setWay(r.agent, pts);
      r.agent.standMode = laneMode(spot.axis === 'x' ? 0 : 1, spot.side);
      if (r.inside) this.traffic.place(r.agent);
      r.revUntil = -Infinity;
      r.spot = spot; r.key = spotKey(spot); r.site = spot.site; r.inside = false; r.working = false;
      this.mark(r, spot, s);
      return;
    }
    // a bay is left, and come into, by its opening only (the way keeps to the slot's half)
    const same = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];
    const here = same(from, [spot.gx, spot.gz]);
    const out = !here && !r.inside ? bayOpening(s, from) : null;
    const start: Cell = out ?? from;
    const into = spot.via && !here ? spot.via : null;
    const goal: Cell = into ?? [spot.gx, spot.gz];
    const mid = same(start, goal) ? [start] : roadRoute(s, start, goal);
    if (!mid) return;
    const cells: Cell[] = [...mid, ...(into ? [[spot.gx, spot.gz] as Cell] : [])];
    let pts: [number, number][];
    r.revUntil = -Infinity;
    if (out) {
      // out of a bay: straight along it into the opening (keeping its half), then on
      // from there — backing out if it stands nose in
      const [ox, oz] = cellCentre(out[0], out[1]);
      const along: [number, number] = out[0] !== from[0] ? [ox, r.z] : [r.x, oz];
      pts = [[r.x, r.z], ...laneWay(cells, along, [spot.x, spot.z])];
      const ux = out[0] - from[0], uz = out[1] - from[1];
      if (Math.sin(r.yaw) * ux + Math.cos(r.yaw) * uz < 0) r.revUntil = Math.hypot(along[0] - r.x, along[1] - r.z);
    } else {
      // out of its cell in the half it is in only if another stands beside it
      pts = laneWay(cells, [r.x, r.z], [spot.x, spot.z], this.traffic.taken(r.agent, from[0], from[1]));
    }
    const [dx, dz] = pts.length > 1 ? [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]] : [r.agent.fx, r.agent.fz];
    const l = Math.hypot(dx, dz);
    if (l > 1e-6 && r.inside) { r.agent.fx = dx / l; r.agent.fz = dz / l; r.yaw = Math.atan2(dx, dz); }
    this.traffic.setWay(r.agent, pts);
    r.agent.standMode = laneMode(spot.axis === 'x' ? 0 : 1, spot.side);
    // out of the door: its cells are taken now, so the next one out waits its turn
    if (r.inside) this.traffic.place(r.agent);
    r.spot = spot;
    r.key = spotKey(spot);
    r.site = spot.site;
    r.inside = false;
    r.working = false;
    this.mark(r, spot, s);
  }

  /** A way with an off-road end (core/roads.ts groundWay): off-road legs
   *  straight, the road between in lanes. */
  private offWay(r: Rover, spot: RoverSpot, s: GameState, from: Cell): [number, number][] | null {
    const gw = groundWay(s, [r.x, r.z], [spot.x, spot.z]);
    if (!gw) return null;
    const pts = gw.pts, w = gw.w ?? [];
    const za = (w[0] ?? 1) > 1, zb = (w[w.length - 1] ?? 1) > 1;
    const i0 = za ? 1 : 0, i1 = zb ? pts.length - 2 : pts.length - 1;
    if (i1 <= i0) return pts.map(([x, z]): [number, number] => [x, z]);
    const cells: Cell[] = [];
    for (let i = i0; i <= i1; i++) {
      const c = i === i0 && !za ? from : cellAt(pts[i][0], pts[i][1]);
      const l = cells[cells.length - 1];
      if (!l || l[0] !== c[0] || l[1] !== c[1]) cells.push(c);
    }
    const lane = laneWay(cells, pts[i0], pts[i1], !za && this.traffic.taken(r.agent, from[0], from[1]));
    return [...pts.slice(0, i0), ...lane, ...pts.slice(i1 + 1)].map(([x, z]): [number, number] => [x, z]);
  }

  /** The way now leads to this slot: the sim goal it serves, the sim trip it
   *  was built for, and how far along that trip the sim had it then. */
  private mark(r: Rover, spot: RoverSpot, s: GameState) {
    r.goal = spotGoal(s, spot).key;
    r.s0 = 0;
    this.match(r);
  }

  /** The sim planned a new trip to the slot its way already leads to (it
   *  set off, or replanned): what is left of the sim's trip is matched to
   *  what is left of the way from where it stands. */
  private retime(r: Rover, spot: RoverSpot, s: GameState) {
    r.goal = spotGoal(s, spot).key;
    r.s0 = r.agent.s;
    this.match(r);
  }

  private match(r: Rover) {
    const t = r.unit?.trip;
    r.tripId = tripKey(t);
    r.p0 = t && t.goal === r.goal && !t.stuck ? (arrived(t) ? 1 : progress(t, this.frac)) : 0;
  }

  // ── the traffic driver ──

  prefer(a: Agent) {
    const r = this.byId.get(a.id);
    const end = Traffic.end(a);
    // ease into the slot: slow over the last few metres
    const left = end - a.s;
    a.vmax = Math.min(this.speed, Math.sqrt(2 * ACCEL * Math.max(0, left)) + 0.3);
    a.stop = end;
    // the sim drives it (core/transit.ts): never past where the sim has it,
    // catching up (to CATCH × cruise) when the traffic held it back; held
    // still while the sim has not set off on this way yet
    if (r?.follow === 'hold') { a.vmax = 0; a.stop = a.s; }
    else if (r?.follow === 'sim') {
      const gap = r.target - a.s;
      a.stop = Math.min(end, Math.max(a.s, r.target));
      const chase = r.vSim * this.pace + GAIN * gap;
      // (at least a crawl while short of it: it always pulls right up to its slot)
      a.vmax = Math.min(Math.sqrt(2 * ACCEL * Math.max(0, left)) + 0.3, CATCH * Math.max(this.speed, r.vSim), Math.max(gap > 1e-4 ? 0.3 : 0, chase));
    }
    // a way that sets off well away from its heading starts with a turn on the spot
    a.pivot = false;
    if (!r) return;
    if (left < 1e-3) {
      // there: square up along its road (either way along it), turning on the spot
      if (!r.spot || r.spot.inside) { r.turning = false; return; }
      const f = r.spot.face;
      const aim = Math.abs(wrap(f - r.yaw)) <= Math.abs(wrap(f + PI - r.yaw)) + 1e-6 ? f : f + PI;
      r.turning = Math.abs(wrap(aim - r.yaw)) > 0.05;
      if (r.turning) { a.pivot = true; r.aim = aim; }
      return;
    }
    // only as it sets off: under way it steers round corners
    if (!r.turning && a.s > 0.3) return;
    const want = this.heading(r, a, a.s + 0.02);
    const err = Math.abs(wrap(want - r.yaw));
    r.turning = r.turning ? err > 0.05 : err > PIVOT;
    if (r.turning) { a.pivot = true; r.aim = want; a.vmax = 0; }
  }

  /** the yaw its way wants at arc u: along the lane, or backwards while backing out */
  private heading(r: Rover, a: Agent, u: number): number {
    const p = pointAt(a.pts, a.arcs, u);
    return Math.atan2(p.dx, p.dz) + (u < r.revUntil ? PI : 0);
  }

  moved(a: Agent, dt: number) {
    const r = this.byId.get(a.id);
    if (!r) return;
    const p = pointAt(a.pts, a.arcs, a.s);
    r.x = p.x; r.z = p.z;
    a.x = p.x; a.z = p.z;
    r.v = a.v;
    const end = Traffic.end(a);
    const there = a.s >= end - 1e-6;
    // heading: a turn on the spot, else along its lane (turn-rate limited); once there it holds it
    const want = a.pivot ? r.aim : there ? r.yaw : this.heading(r, a, a.s);
    // it turns on the spot only as a pivot (its sweep held); otherwise only while it rolls
    if (a.pivot ? a.pivotOk : a.v > 0.05) r.yaw += clamp(wrap(want - r.yaw), -TURN * dt, TURN * dt);
    a.fx = Math.sin(r.yaw); a.fz = Math.cos(r.yaw);
    // reached a slot inside the dock: gone in
    if (there && r.spot?.inside && !r.inside) {
      r.inside = true;
      this.traffic.drop(a);
    }
    // at work where the sim has it at work: welding a building or sintering a road cell
    const task = r.unit?.task;
    r.working = there && !!task && r.follow === 'sim' && a.v < 0.1;
    r.mode = r.working ? task! : null;
  }

  /** Get out of their way: over into the other half of its own cell if their
   *  ways through it keep to this half, else back off to the nearest cell off
   *  their ways with a free half — never through a cell anyone else holds. */
  yieldTo(a: Agent, others: Agent[]): boolean {
    const r = this.byId.get(a.id);
    const s = this.state;
    if (!r || !s) return false;
    const t = this.traffic;
    const avoid = new Set<number>();
    const ahead: Agent[] = [];
    for (const o of others) {
      for (const [gx, gz] of t.heldBy(o)) avoid.add(cellKey(gx, gz));
      for (const sp of o.spans) if (sp.road && sp.a1 > o.s && sp.a0 < o.s + 40) avoid.add(cellKey(sp.key % 4096, Math.floor(sp.key / 4096)));
      ahead.push(o);
    }
    const map = roadMap(s);
    const zones = zoneCells(s);
    const start = cellAt(r.x, r.z);
    const sk = cellKey(start[0], start[1]);
    const shared = t.taken(a, start[0], start[1]);
    const refuge = (cells: Cell[], mode: number, x: number, z: number) => {
      // out of a cell it shares in its own half (never across the one beside it)
      const pts = laneWay(cells, [r.x, r.z], [x, z], true, shared);
      t.setWay(a, pts);
      // back there if it lies behind it (no turn on the spot in the others' way)
      const p = pointAt(a.pts, a.arcs, 0.02);
      r.revUntil = Math.abs(wrap(Math.atan2(p.dx, p.dz) - r.yaw)) > 2 ? Infinity : -Infinity;
      a.standMode = mode;
      r.key = ''; // heads on for its slot once the refuge time is up
      r.yieldUntil = this.clock + YIELD_S;
      return true;
    };
    // 1. the other half of its own cell: their ways through it all keep to this half
    if (!t.taken(a, start[0], start[1])) {
      let m: number | null = null;
      let ok = true;
      const gk = start[1] * 4096 + start[0];
      for (const o of ahead) {
        for (const sp of o.spans) {
          if (sp.key !== gk || sp.a1 <= o.s) continue;
          if (sp.mode === WHOLE || (m !== null && (laneAxis(m) !== laneAxis(sp.mode) || laneSide(m) !== laneSide(sp.mode)))) ok = false;
          m = sp.mode;
        }
      }
      if (ok && m !== null) {
        const axis = laneAxis(m), side = (1 - laneSide(m)) as 0 | 1;
        const [cx, cz] = cellCentre(start[0], start[1]);
        const o = (side ? 1 : -1) * ROAD.lane;
        const [x, z] = axis === 0 ? [cx + o, cz] : [cx, cz + o];
        if (Math.hypot(x - r.x, z - r.z) > 0.3) return refuge([start], laneMode(axis, side), x, z);
      }
    }
    // 2. the nearest cell off their ways with a free half, through free cells only
    const from = new Map<number, number>([[sk, -1]]);
    const q = [sk];
    for (let i = 0; i < q.length && i < 400; i++) {
      const k = q[i];
      const [x, z] = [k % 256, Math.floor(k / 256)];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = cellKey(x + dx, z + dz);
        if (from.has(nk)) continue;
        const c = map.get(nk);
        if (!((c && isOpen(c)) || zones.has(nk)) || t.taken(a, x + dx, z + dz)) continue;
        from.set(nk, k);
        q.push(nk);
        if (avoid.has(nk)) continue;
        // a refuge: stand in the half on the right of the way in
        const cells: Cell[] = [];
        for (let p = nk; p !== -1; p = from.get(p)!) cells.push([p % 256, Math.floor(p / 256)]);
        cells.reverse();
        const [ox, oz] = right([dx, dz]);
        const axis: 0 | 1 = dx !== 0 ? 1 : 0;
        const side: 0 | 1 = (axis === 1 ? oz : ox) > 0 ? 1 : 0;
        const [cx, cz] = cellCentre(x + dx, z + dz);
        return refuge(cells, laneMode(axis, side), cx + ox, cz + oz);
      }
    }
    return false;
  }

  /** A detour: its slot by another road, round the cells a unit that is
   *  not moving holds (the player's side roads work as one), if it is no
   *  more than three times the way it had left (+40 m). */
  reroute(a: Agent, avoid: ReadonlySet<number>): boolean {
    const r = this.byId.get(a.id);
    const s = this.state;
    const spot = r?.spot;
    if (!r || !s || !spot || r.inside || spot.inside) return false;
    // giving way: it keeps to its refuge (a detour is a way to its slot)
    if (this.clock < r.yieldUntil) return false;
    const map = roadMap(s);
    const start = cellAt(r.x, r.z);
    const goal: Cell = spot.via ?? [spot.gx, spot.gz];
    const gk = cellKey(goal[0], goal[1]), sk = cellKey(start[0], start[1]);
    const blocked = (gx: number, gz: number) => avoid.has(gz * 4096 + gx);
    const from = new Map<number, number>([[sk, -1]]);
    const q = [sk];
    let found = false;
    for (let i = 0; i < q.length && !found; i++) {
      const [x, z] = [q[i] % 256, Math.floor(q[i] / 256)];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = cellKey(x + dx, z + dz);
        if (from.has(nk) || blocked(x + dx, z + dz)) continue;
        const c = map.get(nk);
        if (!c || !isOpen(c) || (c.bay && nk !== gk)) continue;
        from.set(nk, q[i]);
        if (nk === gk) { found = true; break; }
        q.push(nk);
      }
    }
    if (!found) return false;
    const cells: Cell[] = [];
    for (let k = gk; k !== -1; k = from.get(k)!) cells.push([k % 256, Math.floor(k / 256)]);
    cells.reverse();
    if (spot.via) cells.push([spot.gx, spot.gz]);
    if ((cells.length - 1) * 4 > 3 * Math.max(0, Traffic.end(a) - a.s) + 40) return false;
    const keep = this.traffic.taken(a, start[0], start[1]);
    let pts = laneWay(cells, [r.x, r.z], [spot.x, spot.z], keep);
    r.revUntil = -Infinity;
    // it sets off at a turn from its heading, pulled up short of the one in its
    // way: it backs up to its cell's centre first, where the turn on the spot
    // needs no one else's cell
    const [cx, cz] = cellCentre(start[0], start[1]);
    const back = Math.hypot(cx - r.x, cz - r.z);
    if (pts.length > 1 && back > 0.2) {
      const turn = Math.abs(wrap(Math.atan2(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) - r.yaw));
      const behind = Math.sin(r.yaw) * (cx - r.x) + Math.cos(r.yaw) * (cz - r.z) < 0;
      if (turn > PIVOT && behind) {
        pts = [[r.x, r.z], [cx, cz], ...laneWay(cells, [cx, cz], [spot.x, spot.z], keep).slice(1)];
        r.revUntil = back;
      }
    }
    this.traffic.setWay(a, pts);
    r.turning = false;
    // what is left of the sim's trip now maps onto the detour
    r.s0 = 0;
    this.match(r);
    return true;
  }

  /** The last resort: back inside its dock (it rolls out again, where the sim has it, when the door is clear).
   *  Never set down on the sim's position (docs/19 S4b). */
  rescue(a: Agent) {
    const r = this.byId.get(a.id);
    if (!r) return;
    r.inside = true;
    r.key = '';
    this.traffic.drop(a);
    this.drawn = this.drawn.filter((x) => x !== r);
    this.traffic.enlist('rover', this.drawn.map((x) => x.agent));
  }

  draw(_dt: number, sunDir: THREE.Vector3, sunLight: number) {
    const n = this.drawn.length;
    this.mesh.count = n;
    // a bricked rover (docs/14 §3.5), or one out of charge (docs/02 · On-board power),
    // sits dark: no lamps, no beacon
    const st = this.mesh.geometry.getAttribute('iState') as THREE.InstancedBufferAttribute;
    let dirty = false;
    for (let i = 0; i < n; i++) {
      const u = this.drawn[i].unit;
      const lit = (u?.brickedUntil ?? 0) > 0 || u?.src === 'flat' ? 0 : 1;
      if (this.litSeen[i] !== lit) { this.litSeen[i] = lit; st.setX(i, lit); dirty = true; }
    }
    if (dirty) st.needsUpdate = true;
    const elev = Math.max(0.06, Math.asin(clamp(sunDir.y, -1, 1)));
    const smear = Math.min(7, (1.1 * SCALE) / Math.tan(elev));
    const hx = -sunDir.x, hz = -sunDir.z, hl = Math.hypot(hx, hz) || 1;
    const sx = hx / hl, sz = hz / hl;
    const sunYaw = Math.atan2(sx, sz);
    this.decalMat.opacity = 0.5 * sunLight;
    this.decals.visible = sunLight > 0.02;
    this.decals.count = n;
    for (let i = 0; i < n; i++) {
      const r = this.drawn[i];
      let x = r.x, z = r.z, yaw = r.yaw, bob = 0;
      if (this.work) {
        // at work: the weld's shuffle along its road, the sinter's crawl (world/workAnim.ts)
        const o = this.work.roverOffset(r.id, r.spot, this.clock + r.phase);
        x += o.dx; z += o.dz; yaw += o.dyaw; bob = o.bob;
      } else if (r.working && r.spot) {
        const t = this.clock + r.phase;
        const sh = 0.25 * Math.sin(t * 0.9);
        x += r.spot.shuffle[0] * sh;
        z += r.spot.shuffle[1] * sh;
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
      this.work?.roverBody(r, this.m, Traffic.end(r.agent) - r.agent.s < 1e-3);

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
    this.drones.draw(sunDir, sunLight);
    const sel = this.selected === null ? undefined : this.drawn.find((r) => r.id === this.selected) ?? this.drones.pose(this.selected);
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
    const r = hit ? this.drawn[hit.instanceId!] : undefined;
    const drone = this.drones.pick(raycaster);
    if (drone && (!r || drone.d < hit!.distance)) return drone;
    return r ? { id: r.id, d: hit!.distance } : null;
  }

  /** Where a rover (or drone) is drawn (world), or null if it is away or unknown. */
  pose(id: number): { x: number; y: number; z: number; yaw: number } | null {
    const r = this.drawn.find((x) => x.id === id);
    return r ? { x: r.x, y: this.hf.sample(r.x, r.z), z: r.z, yaw: r.yaw } : this.drones.pose(id);
  }

  /** Every drawn rover's and drone's position (screen-space picking of a small target). */
  poses(): { id: number; x: number; y: number; z: number }[] {
    const out = this.drawn.map((r) => ({ id: r.id, x: r.x, y: this.hf.sample(r.x, r.z) + 0.8, z: r.z }));
    this.drones.each((d) => out.push({ id: d.id, x: d.x, y: d.y + 0.4, z: d.z }));
    return out;
  }

  /** Rooster tails behind moving rovers and print dust at working ones,
   *  nearest the camera first. */
  emitters(cam: THREE.Vector3, out: { e: DustEmitter; d: number }[]) {
    this.drones.emitters(cam, out);
    for (const r of this.drawn) {
      const fx = Math.sin(r.yaw), fz = Math.cos(r.yaw);
      const d = Math.hypot(r.x - cam.x, r.z - cam.z);
      if (r.v > 0.6) {
        const k = Math.min(1, r.v / SPEED);
        const x = r.x - fx * 0.9, z = r.z - fz * 0.9;
        out.push({ d, e: { x, y: this.hf.sample(x, z), z, strength: 0.5 + 0.5 * k,
          vx: -fx * 1.3 * k, vy: 0.9, vz: -fz * 1.3 * k, hSpread: 0.7, vSpread: 1.4, size: 0.06 } });
      } else if (this.work ? this.work.welding(r.id) : r.working) {
        // print dust: under the nozzle where the arm has it (world/workAnim.ts)
        const n = this.work?.nozzle(r.id);
        const x = n ? n.x : r.x + fx * 1.4, z = n ? n.z : r.z + fz * 1.4;
        out.push({ d, e: { x, y: this.hf.sample(x, z), z, strength: 0.85,
          vx: fx * 0.4, vy: 0.7, vz: fz * 0.4, hSpread: 1.1, vSpread: 1.5, size: 0.06 } });
      }
    }
  }

  /** The rovers nearest the listener, for the audio layer: distance, bearing
   *  as a stereo pan, speed as a fraction of cruise, and whether printing.
   *  With no `focus` the listener is the camera; otherwise it is the
   *  ground point in view, lifted by a share of the camera's
   *  distance: what you look at is heard, and zooming out quietens it,
   *  whatever lens the view uses (the isometric one sits far off). */
  sounds(cam: THREE.Camera, focus: THREE.Vector3 | null = null): RoverSound[] {
    const out = this.soundList;
    out.length = 0;
    if (!this.drawn.length) return out;
    const p = cam.position;
    const lift = focus ? LISTENER_LIFT * p.distanceTo(focus) : 0;
    this.right.setFromMatrixColumn(cam.matrixWorld, 0);
    for (let i = 0; i < this.drawn.length; i++) {
      const r = this.drawn[i];
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
    const lag = this.lagMax;
    this.lagMax = 0;
    return {
      /** the ground rovers in the fleet */
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
      /** m of way left to its slot (0: there) */
      legs: this.rovers.map((r) => Math.round(Math.max(0, Traffic.end(r.agent) - r.agent.s) * 10) / 10),
      /** parked inside its dock (not drawn) */
      inside: this.rovers.map((r) => r.inside),
      drawn: this.drawn.length,
      /** drawn dark: bricked by a hazard */
      dark: this.drawn.filter((r, i) => this.litSeen[i] === 0).map((r) => r.id),
      yaws: this.rovers.map((r) => Math.round(r.yaw * 100) / 100),
      selected: this.selected,
      ring: this.ring.visible,
      /** at its stand, what it does there (the sim's RoverUnit.task): 'weld', 'sinter' or null */
      modes: this.rovers.map((r) => r.mode),
      /** how each follows the sim (core/transit.ts): 'sim', 'hold' (not set off) or 'free' */
      follow: this.rovers.map((r) => r.follow),
      /** debug: each one's target arc and where it is along its way */
      track: this.rovers.map((r) => [Math.round(r.target * 10) / 10, Math.round(r.agent.s * 10) / 10, Math.round(Traffic.end(r.agent) * 10) / 10, r.goal, r.unit?.trip?.goal ?? '']),
      /** the most any rover trailed the sim since the last read, s of driving; set-downs so far */
      lagMaxS: Math.round(lag * 100) / 100,
      setDowns: this.setDowns,
      /** the hive units, drawn as drones (docs/14 §4.3) */
      drones: this.drones.info(),
    };
  }
}

/** What the slots depend on: the structures and sites, the roads (their
 *  revision), the roster and the road jobs. */
export function spotSignature(s: GameState): string {
  let k = `${s.roadRev ?? 0}|`;
  for (const b of s.buildings) k += `${b.id}:${b.type}:${b.gx},${b.gz},${b.rot}:${(b.construction ?? 0) > 0 ? 1 : 0};`;
  k += '|';
  // a rover's job is part of what its slot depends on: a road, a deposit's core, a grading job
  for (const r of s.rovers ?? []) k += `${r.id}:${r.home}:${r.site}:${r.road ?? ''}:${r.core ?? ''}:${r.grade ?? ''};`;
  // a grading job's stand moves with each cell it levels
  k += '|';
  for (const j of s.gradeJobs ?? []) k += `${j.id}:${j.done};`;
  return k;
}

/** The traffic's ground from the state (on change only): the open road
 *  cells, and every cell of an extraction zone (core/zones.ts), where units
 *  drive off-road — the same holds keep them apart there. */
export function syncGround(t: Traffic, s: GameState) {
  const sig = `${s.roadRev ?? 0}:${s.roads?.length ?? 0}:z${s.zones?.length ?? 0}`;
  if (sig === t.roadSignature) return;
  const cells: [number, number][] = [];
  for (const c of s.roads ?? []) if (isOpen(c)) cells.push([c.gx, c.gz]);
  for (const k of zoneCells(s).keys()) cells.push([k % 256, Math.floor(k / 256)]);
  t.setRoads(sig, cells);
}

// ─────────────────────── drones (docs/14 §4.3) ───────────────────────

const MAX_DRONES = 48;
const DRONE_SCALE = 1.3;

/** A drone's pack parts (before DRONE_SCALE): a battery pod slung between the
 *  skids, tanks along both sides of the deck, a finned unit under the nose. */
function dronePackParts(key: string): THREE.BufferGeometry[] {
  const has = (t: TechId) => key.split(',').includes(t);
  const out: THREE.BufferGeometry[] = [];
  if (has('roverPowerPacks')) out.push(box(0.3, 0.08, 0.36, PLATE, 0, 0.27, 0));
  if (has('fuelCellPacks')) {
    for (const x of [-0.25, 0.25]) out.push(cyl(0.05, 0.05, 0.4, BODY, x, 0.56, 0, PI / 2, 0, 8));
  }
  if (has('radioisotopeUnits')) {
    out.push(cyl(0.06, 0.06, 0.18, TRIM, 0, 0.26, 0.27, PI / 2, 0, 8), box(0.22, 0.015, 0.16, PLATE, 0, 0.26, 0.27));
  }
  return out;
}

/** A quadcopter from the kit (about 200 △): a body, four arms and rotor
 *  discs, skids, a nose lamp and a beacon. */
function droneGeometry(key = ''): THREE.BufferGeometry {
  const parts: (THREE.BufferGeometry | THREE.BufferGeometry[])[] = [
    ...dronePackParts(key),
    box(0.66, 0.2, 0.66, BODY, 0, 0.42, 0),
    box(0.4, 0.05, 0.4, GLASS, 0, 0.545, 0),
    box(0.2, 0.08, 0.05, LAMP, 0, 0.42, 0.34),
    box(0.08, 0.08, 0.08, BEACON, 0, 0.6, -0.2),
    bar([-0.25, 0.3, -0.3], [-0.25, 0.3, 0.3], 0.04, TRIM),
    bar([0.25, 0.3, -0.3], [0.25, 0.3, 0.3], 0.04, TRIM),
  ];
  for (const [x, z] of [[-0.55, -0.55], [0.55, -0.55], [0.55, 0.55], [-0.55, 0.55]]) {
    parts.push(bar([x * 0.35, 0.44, z * 0.35], [x, 0.5, z], 0.06, TRIM));
    parts.push(cyl(0.34, 0.34, 0.025, PLATE, x, 0.54, z, 0, 0, 8));
  }
  // skids' feet
  parts.push(box(0.06, 0.2, 0.06, TRIM, -0.25, 0.3, 0), box(0.06, 0.2, 0.06, TRIM, 0.25, 0.3, 0));
  const g = merge(parts);
  g.userData.recipe = 'drone'; // the cel palette: the Drone Hive's accent
  g.translate(0, -0.28, 0); // skids at y 0
  g.scale(DRONE_SCALE, DRONE_SCALE, DRONE_SCALE);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** The survey drone (docs/19 S6, world/surveyFlight.ts draws it): for now the
 *  hive drone's quadcopter, its trim the survey teal (the palette override
 *  `surveyDrone`). Contract stream W0d; S2a replaces it with the flat delta
 *  wing, this function's name and signature stay. */
export function surveyDroneGeometry(key = ''): THREE.BufferGeometry {
  const g = droneGeometry(key);
  g.userData.recipe = 'surveyDrone';
  return g;
}

interface Drone {
  id: number;
  x: number; y: number; z: number; yaw: number;
  /** horizontal speed, m/s */
  v: number;
  /** where it is headed, and the height it hovers or perches at there */
  gx: number; gy: number; gz: number;
  /** its cruise height above the ground, m (6–10, by id) */
  cruise: number;
  site: number | null;
  /** hovering over a road job's frontier (a free unit sinters roads too) */
  job: boolean;
  /** parked on its hive's deck (and settled there) */
  perched: boolean;
  working: boolean;
  phase: number;
  /** the hive it perches on and its pad there */
  home: number;
  pad: number;
  unit: RoverUnit;
  /** held (landed, waiting) or bricked by a hazard: set down where it is */
  down: boolean;
  /** the sim goal it is aimed at (core/transit.ts droneGoal) */
  goal: string;
  /** on its way: where the sim has it now (it chases that point), and the sim's cruise */
  chase: boolean;
  cx: number; cz: number;
  vSim: number;
  /** what it does over its stand, from the sim: welding a building, sintering a road cell, or nothing */
  mode: 'weld' | 'sinter' | null;
}

/** The Drone Hive's units, drawn as quadcopters that fly straight at their
 *  cruise height (docs/14 §4.3): off the roads and out of the ground
 *  traffic. Parked, a drone perches on one of its hive's four deck pads;
 *  sent to a site it climbs, flies straight over everything, hovers over
 *  the site and prints from the air; on a road job it hovers over the
 *  road's frontier. Game time, as the rovers: pause freezes them. No
 *  shadow-map shadow: a soft decal on the ground below, fainter with
 *  height. Allocation-free per frame. */
export class DroneFlight {
  readonly mesh: THREE.InstancedMesh;
  private decals: THREE.InstancedMesh;
  private decalMat: THREE.MeshBasicMaterial;
  private list: Drone[] = [];
  private byId = new Map<number, Drone>();
  private clock = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private p = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  /** launches so far (the audio's data chirp) */
  launches = 0;
  /** the pack parts drawn (packKey of the techs done) */
  private packKey = '';
  /** the work animations (RoverFleet.setWork): a printing drone's spark and beam */
  work: WorkAnim | null = null;

  constructor(private hf: Heightfield, group: THREE.Group) {
    const geo = withInstanceState(droneGeometry(), MAX_DRONES);
    // machines' light: cold (docs/14 §4.4)
    (geo.getAttribute('iWarm').array as Float32Array).fill(0);
    this.mesh = new THREE.InstancedMesh(geo, materials.get('building'), MAX_DRONES);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    inked(this.mesh, 'drone');
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-PI / 2);
    this.decalMat = new THREE.MeshBasicMaterial({
      color: 0x000000, alphaMap: blobTexture(), transparent: true, opacity: 0.35, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    this.decals = new THREE.InstancedMesh(plane, this.decalMat, MAX_DRONES);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 1;
    group.add(this.mesh, this.decals);
  }

  /** The drones follow the sim roster's hive units (keyed by id) and the
   *  sim's straight-line trips (core/transit.ts): each chases the point the
   *  sim has it at now (the tick fraction added), and hovers or perches at
   *  its goal once the sim has it there. `fresh`: the slots' signature
   *  changed, so re-aim; `jumped`: sim time the visuals never showed, so
   *  set each down where the sim has it. */
  sync(dt: number, s: GameState, units: readonly RoverUnit[], fresh: boolean, frac = 0, jumped = false, pace = 1) {
    this.clock += dt;
    const pk = packKey(s.techsDone);
    if (pk !== this.packKey) {
      const old = this.mesh.geometry;
      this.mesh.geometry = withInstanceState(droneGeometry(pk), MAX_DRONES, old);
      old.dispose();
      this.packKey = pk;
    }
    const pads = dronePads(s);
    if (fresh || units.length !== this.list.length) {
      const next: Drone[] = [];
      for (const u of units.slice(0, MAX_DRONES)) {
        const pad = pads.get(u.id) ?? 0;
        let d = this.byId.get(u.id);
        if (!d) {
          const [px, py, pz] = this.padPoint(s, u.home, pad);
          // where the sim has it (a load, a drone already out), else on its pad
          const [x, z] = u.x !== undefined && u.z !== undefined ? [u.x, u.z] : [px, pz];
          const onPad = Math.hypot(x - px, z - pz) < 0.3;
          const y = onPad ? py : this.hf.sample(x, z) + DRONE.cruiseMin;
          d = { id: u.id, x, y, z, yaw: 0, v: 0, gx: px, gy: py, gz: pz, cruise: DRONE.cruiseMin + (u.id % 5),
            site: null, job: false, perched: onPad, working: false, phase: u.id * 1.913, home: u.home, pad, unit: u, down: false,
            goal: '', chase: false, cx: x, cz: z, vSim: 0, mode: null };
        }
        d.home = u.home;
        d.pad = pad;
        d.unit = u;
        if (d.site === null && u.site !== null && d.perched) this.launches++;
        d.site = u.site;
        d.job = false;
        d.goal = ''; // re-aim below
        next.push(d);
      }
      this.list = next;
      this.byId = new Map(next.map((d) => [d.id, d]));
    }
    for (const d of this.list) {
      const u = d.unit, t = u.trip;
      // a hazard holds it (Land drones, the control plane down) or bricks it:
      // it sets down where it is and waits; freed, it takes up its work again
      // out of charge (docs/02 · On-board power) it sets down too, until the grid serves it
      const down = (u.brickedUntil ?? 0) > 0 || (u.heldUntil ?? 0) > s.simTime || u.src === 'flat';
      if (down) { d.gx = d.x; d.gz = d.z; d.gy = this.hf.sample(d.x, d.z); d.site = null; d.job = false; d.goal = 'down'; }
      else if (d.down || (t && t.goal !== d.goal) || (!t && d.goal === '')) { d.site = u.site; this.aim(d, s, u); d.goal = t?.goal ?? '-'; }
      d.down = down;
      // follow the sim: the point it has the drone at now, until it is there
      d.chase = !down && !!t && !t.stuck && !arrived(t) && u.x !== undefined;
      if (d.chase) { [d.cx, d.cz] = tripPoint(t!, frac); d.vSim = t!.v; } else d.vSim = 0;
      if (!down && t && !t.stuck && u.x !== undefined) {
        const [sx, sz] = d.chase ? [d.cx, d.cz] : [d.gx, d.gz];
        const off = Math.hypot(sx - d.x, sz - d.z);
        // time the visuals missed, more than LAG_S behind, or not over its work when the sim has it at work
        const due = !d.chase && !!u.task && off > 0.5;
        if (jumped || (dt > 0 && (off > LAG_S * DRONE.speed || due))) {
          d.x = sx; d.z = sz;
          if (!d.chase) { d.y = d.gy; d.v = 0; }
          else d.y = Math.max(d.y, this.hf.sample(sx, sz) + d.cruise);
        }
      }
      this.fly(d, dt, pace);
      d.mode = d.working && !d.chase ? u.task ?? null : null;
    }
    // a bricked drone is dark, and so is one out of charge
    const st = this.mesh.geometry.getAttribute('iState') as THREE.InstancedBufferAttribute;
    let dirty = false;
    for (let i = 0; i < this.list.length; i++) {
      const u = this.list[i].unit;
      const lit = (u.brickedUntil ?? 0) > 0 || u.src === 'flat' ? 0 : 1;
      if (st.getX(i) !== lit) { st.setX(i, lit); dirty = true; }
    }
    if (dirty) st.needsUpdate = true;
  }

  /** a hive pad's world point (the deck top) */
  private padPoint(s: GameState, home: number, pad: number): [number, number, number] {
    const hive = s.buildings.find((b) => b.id === home);
    if (!hive) return [0, 0, 0];
    const [x, z] = padPoint(hive, pad);
    const [cx, cz] = centerOf(hive);
    return [x, this.hf.sample(cx, cz) + HIVE_DECK_Y, z];
  }

  /** where it is going, as the sim sends it (core/transit.ts droneGoal): over
   *  its site, over the frontier of the road it sinters (its site's, while
   *  that is unfinished, or a road job's), into the Lander when lent, or home
   *  to its pad */
  private aim(d: Drone, s: GameState, u: RoverUnit) {
    const g = droneGoal(s, u, d.pad);
    d.gx = g.x; d.gz = g.z;
    d.job = false;
    switch (g.kind) {
      case 'weld': {
        const site = s.buildings.find((b) => b.id === g.site);
        const def = site ? BUILDINGS[site.type] : null;
        const [cx, cz] = site ? centerOf(site) : [g.x, g.z];
        d.gy = this.hf.sample(cx, cz) + Math.min(9, (def?.height ?? 4) * 0.6) + 2.5;
        return;
      }
      case 'front': case 'behind':
        d.gy = this.hf.sample(g.x, g.z) + 3.2;
        d.job = true;
        return;
      case 'down':
        d.gy = this.hf.sample(g.x, g.z);
        return;
      default:
        [d.gx, d.gy, d.gz] = this.padPoint(s, u.home, d.pad);
    }
  }

  /** straight at its cruise height: climb, fly, descend onto its goal. On
   *  its way it chases where the sim has it (up to CATCH × cruise). */
  private fly(d: Drone, dt: number, pace = 1) {
    if (dt <= 0) return;
    const [hx, hz] = d.chase ? [d.cx, d.cz] : [d.gx, d.gz];
    const dx = hx - d.x, dz = hz - d.z;
    const dist = Math.hypot(dx, dz);
    const fin = Math.hypot(d.gx - d.x, d.gz - d.z);
    const ground = this.hf.sample(d.x, d.z);
    const cruiseY = Math.max(ground, this.hf.sample(d.gx, d.gz)) + d.cruise;
    const near = fin < 9;
    const wantY = near ? d.gy : Math.max(cruiseY, d.gy);
    // the climb comes first: it sets off once it is up, or when the goal is close
    const up = d.y >= Math.min(wantY, ground + 3) - 0.3 || near;
    const vmax = !up ? 0 : d.chase ? Math.min(CATCH * DRONE.speed, d.vSim * pace + GAIN * dist)
      : Math.min(DRONE.speed, Math.sqrt(2 * DRONE.accel * dist) + 0.2);
    d.v = Math.min(vmax, d.v + DRONE.accel * dt);
    if (dist > 1e-3) {
      const step = Math.min(dist, d.v * dt);
      d.x += (dx / dist) * step; d.z += (dz / dist) * step;
      if (d.v > 0.3) d.yaw += Math.max(-2 * dt, Math.min(2 * dt, Math.atan2(Math.sin(Math.atan2(dx, dz) - d.yaw), Math.cos(Math.atan2(dx, dz) - d.yaw))));
    } else d.v = 0;
    const dy = wantY - d.y;
    d.y += Math.max(-DRONE.climb * dt, Math.min(DRONE.climb * dt, dy));
    d.y = Math.max(d.y, this.hf.sample(d.x, d.z) + 0.3 * (d.perched && fin < 0.2 ? 0 : 1));
    const there = !d.chase && fin < 0.3 && Math.abs(dy) < 0.15;
    d.working = there && (d.site !== null || d.job);
    d.perched = there && d.site === null && !d.job;
  }

  draw(sunDir: THREE.Vector3, sunLight: number) {
    const n = this.list.length;
    this.mesh.count = n;
    this.decals.count = n;
    this.decals.visible = sunLight > 0.02;
    this.decalMat.opacity = 0.4 * sunLight;
    const elev = Math.max(0.12, Math.asin(Math.max(-1, Math.min(1, sunDir.y))));
    for (let i = 0; i < n; i++) {
      const d = this.list[i];
      let x = d.x, y = d.y, z = d.z, pitch = -0.12 * (d.v / DRONE.speed), roll = 0;
      if (!d.perched) {
        // hover: a slow bob, and a small circle while it prints
        const t = this.clock + d.phase;
        y += 0.12 * Math.sin(t * 2.1);
        if (d.working) { x += 0.35 * Math.cos(t * 0.7); z += 0.35 * Math.sin(t * 0.7); roll = 0.05 * Math.sin(t * 1.3); }
      }
      this.e.set(pitch, d.yaw, roll);
      this.mesh.setMatrixAt(i, this.m.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e), this.s.set(1, 1, 1)));
      this.work?.droneAt(d.id, d.unit, d.working, x, y, z, d.mode);
      // the ground under it, pushed down-sun by its height
      const g = this.hf.sample(x, z);
      const h = Math.max(0, y - g);
      const off = Math.min(12, h / Math.tan(elev));
      const hx = -sunDir.x, hz = -sunDir.z, hl = Math.hypot(hx, hz) || 1;
      const sx = x + (hx / hl) * off, sz = z + (hz / hl) * off;
      const k = Math.max(0.35, 1 - h / 16);
      this.e.set(0, d.yaw, 0);
      this.decals.setMatrixAt(i, this.m.compose(this.p.set(sx, this.hf.sample(sx, sz) + 0.05, sz),
        this.q.setFromEuler(this.e), this.s.set(1.9 * k, 1, 1.9 * k)));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.decals.instanceMatrix.needsUpdate = true;
    this.mesh.boundingSphere = null;
  }

  /** The drone under a ray (its roster id), and how far along the ray. */
  pick(raycaster: THREE.Raycaster): { id: number; d: number } | null {
    this.mesh.computeBoundingSphere();
    const hit = raycaster.intersectObject(this.mesh, false).find((h) => h.instanceId !== undefined);
    const d = hit ? this.list[hit.instanceId!] : undefined;
    return d ? { id: d.id, d: hit!.distance } : null;
  }

  pose(id: number): { x: number; y: number; z: number; yaw: number } | null {
    const d = this.byId.get(id);
    return d ? { x: d.x, y: d.y, z: d.z, yaw: d.yaw } : null;
  }

  each(fn: (d: { id: number; x: number; y: number; z: number; v: number; working: boolean }) => void) {
    for (const d of this.list) fn(d);
  }

  /** Print dust under the drones working a site, nearest the camera first. */
  emitters(cam: THREE.Vector3, out: { e: DustEmitter; d: number }[]) {
    for (const d of this.list) {
      if (!d.working) continue;
      const y = this.hf.sample(d.x, d.z);
      out.push({ d: Math.hypot(d.x - cam.x, d.z - cam.z), e: { x: d.x, y, z: d.z, strength: 0.45,
        vx: 0, vy: 0.5, vz: 0, hSpread: 1.1, vSpread: 1.0, size: 0.05 } });
    }
  }

  /** How loud the rotors are at a listener point, 0..1: the nearest drones, flying louder than perched. */
  rotorLevel(lx: number, lz: number, lift: number): number {
    let lvl = 0;
    for (const d of this.list) {
      const dist = Math.hypot(d.x - lx, d.z - lz, lift);
      const k = (d.perched ? 0.25 : 1) / (1 + (dist / 25) ** 2);
      lvl += k;
    }
    return Math.min(1, lvl);
  }

  info() {
    return {
      count: this.list.length,
      flying: this.list.filter((d) => !d.perched).length,
      working: this.list.filter((d) => d.working).length,
      perched: this.list.filter((d) => d.perched).length,
      /** set down by a hazard (held or bricked), and those dark (bricked) */
      down: this.list.filter((d) => d.down).map((d) => d.id),
      dark: this.list.filter((d) => (d.unit.brickedUntil ?? 0) > 0).map((d) => d.id),
      ids: this.list.map((d) => d.id),
      heights: this.list.map((d) => Math.round((d.y - this.hf.sample(d.x, d.z)) * 10) / 10),
      positions: this.list.map((d) => [Math.round(d.x * 10) / 10, Math.round(d.z * 10) / 10]),
      launches: this.launches,
      /** over its stand, what it does there: 'weld', 'sinter' or null */
      modes: this.list.map((d) => d.mode),
    };
  }
}
