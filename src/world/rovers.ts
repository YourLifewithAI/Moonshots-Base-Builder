/** The construction-rover fleet made visible: one instanced rover per unit
 *  in the sim's roster (`state.rovers`, core/fleet.ts), docked at the
 *  structures that supply them (the Lander, Robotics Bays); the one lent to
 *  a survey is away. Rovers live on the roads (docs/15-roads.md): each has a
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
 *  Rovers use the building material (same program, finishes, lamps and a
 *  blinking beacon; unlit twin in safe mode) and cast no shadow-map shadow —
 *  a moving caster would re-render the map every frame. A soft decal smeared
 *  down-sun stands in for it. Motion runs on game time: pause freezes them. */
import * as THREE from 'three';
import type { GameState, RoverUnit } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import { cellAt, cellCentre, cellKey, doorCell, frontierOf, isOpen, roadMap, roadRoute } from '../core/roads';
import { DRONE, unitKind } from '../core/fleet';
import { BUILDINGS } from '../data/buildings';
import { centerOf } from '../buildings/instances';
import { HIVE_DECK_Y, HIVE_PADS } from '../buildings/recipes';
import { roverSpots, type RoverSpot } from '../core/spots';
import { ROAD } from '../data/roads';
import { TECHS, type TechId } from '../data/techs';
import {
  BEACON, BODY, GLASS, LAMP, PLATE, TRIM, bar, box, cyl, dome, merge, withInstanceState,
} from '../buildings/meshKit';
import { materials } from './materials';
import type { DustEmitter } from './dust';
import { MAX_ROVER_VOICES, type RoverSound } from '../audio/roverVoices';
import { Traffic, WHOLE, laneAxis, laneMode, laneSide, pointAt, type Agent, type Driver } from './traffic';

const MAX_ROVERS = 64;
/** a command view's listener height, as a share of the camera's distance */
const LISTENER_LIFT = 0.3;
const SCALE = 1.25;
const SPEED = 4.5;        // m/s cruise on a sintered road
const ACCEL = 3;          // m/s²
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
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const spotKey = (p: RoverSpot) => `${p.site ?? 'p'}:${p.road ?? ''}@${p.gx},${p.gz},${p.side}${p.inside ? 'in' : ''}`;
type Cell = [number, number];

/** The right-hand lane's offset for travel along `d` (a unit cell step). */
const right = (d: Cell): [number, number] => [-d[1] * ROAD.lane, d[0] * ROAD.lane];

/** A rover's way along road cells: from where it stands, in the right-hand
 *  lane (the first cell left in the half it stands in when `keep` — another
 *  stands beside it — the last entered in the half of its slot), to the slot. */
export function laneWay(cells: Cell[], from: [number, number], to: [number, number], keep = true): [number, number][] {
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
    if (i === n - 2) {
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
    this.drones = new DroneFlight(hf, this.group);
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
   *  survey is away. Each rover's slot (core/spots.ts), and a way there along
   *  the open road when the slot changes. */
  sync(dt: number, state: GameState, night = false) {
    this.clock += dt;
    this.frozen = dt <= 0;
    this.state = state;
    this.speed = SPEED * roadSpeedFor(state.techsDone, night);
    const sig = spotSignature(state);
    const fresh = sig !== this.spotSig;
    const away = state.survey?.active?.rover;
    if (fresh) {
      this.spotSig = sig;
      // hive units fly: they take no road slot, and leave the ground to the rovers
      const all = state.rovers ?? [];
      this.hiveUnits = new Set(all.filter((u) => unitKind(state, u) === 'drone').map((u) => u.id));
      this.droneUnits = all.filter((u) => this.hiveUnits.has(u.id) && u.id !== away);
      this.spots = roverSpots(this.hiveUnits.size ? { ...state, rovers: all.filter((u) => !this.hiveUnits.has(u.id)) } : state);
    }
    this.drones.sync(dt, state, this.droneUnits, fresh);
    const roster = (state.rovers ?? []).filter((u) => u.id !== away && !this.hiveUnits.has(u.id)).slice(0, MAX_ROVERS);
    const next: Rover[] = [];
    for (const u of roster) {
      const spot = this.spots.get(u.id);
      if (!spot) continue;
      let r = this.byId.get(u.id);
      if (!r) {
        // a new rover: parked on its slot, or inside its dock until it rolls out
        const parked = spot.site === null && spot.road === undefined && !spot.inside;
        const [x, z] = parked ? [spot.x, spot.z] : [spot.x, spot.z];
        r = {
          id: u.id, x, z, yaw: spot.face, v: 0, home: spot.dock, site: spot.site, spot: parked ? spot : null,
          key: parked ? spotKey(spot) : '', inside: !parked, working: false, phase: u.id * 2.399, yieldUntil: 0,
          revUntil: -Infinity, turning: false, aim: spot.face, agent: null!,
        };
        r.agent = {
          kind: 'rover', id: u.id, key: 1e6 + u.id, x, z, fx: Math.sin(r.yaw), fz: Math.cos(r.yaw),
          hw: ROVER_BODY.hw, front: ROVER_BODY.front, back: ROVER_BODY.back, wide: false, cls: 1,
          pts: [], arcs: [], spans: [], s: 0, v: 0, vmax: 0, stop: 0, accel: ACCEL, decel: 2 * ACCEL,
          standMode: laneMode(spot.axis === 'x' ? 0 : 1, spot.side), held: new Map(), blocker: null, waited: 0, drv: this,
        };
        if (parked) this.traffic.setWay(r.agent, [[x, z]]);
      }
      r.home = spot.dock;
      const key = spotKey(spot);
      if (key !== r.key && this.clock >= r.yieldUntil) this.head(r, spot, state);
      next.push(r);
    }
    this.rovers = next;
    this.byId = new Map(next.map((r) => [r.id, r]));
    this.drawn = next.filter((r) => !r.inside);
    this.traffic.enlist('rover', this.drawn.map((r) => r.agent));
  }

  /** Head for a slot: a way along the open road from where it is (or out of
   *  its dock's door). No way yet: it stays and asks again next frame. */
  private head(r: Rover, spot: RoverSpot, s: GameState) {
    if (spot.inside) {
      // into the dock: from the door it drives in and is gone
      const dock = s.buildings.find((b) => b.id === spot.dock);
      const d = dock ? doorCell(dock) : null;
      if (!r.inside && d) {
        const cells = roadRoute(s, cellAt(r.x, r.z), d);
        if (!cells) return;
        this.traffic.setWay(r.agent, laneWay(cells, [r.x, r.z], cellCentre(d[0], d[1])));
        r.agent.standMode = WHOLE;
        r.spot = spot;
        r.key = spotKey(spot);
        return;
      }
      r.spot = spot;
      r.key = spotKey(spot);
      r.inside = true;
      return;
    }
    let from: Cell;
    if (r.inside) {
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
  }

  // ── the traffic driver ──

  prefer(a: Agent) {
    const r = this.byId.get(a.id);
    const end = Traffic.end(a);
    // ease into the slot: slow over the last few metres
    const left = end - a.s;
    a.vmax = Math.min(this.speed, Math.sqrt(2 * ACCEL * Math.max(0, left)) + 0.3);
    a.stop = end;
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
    r.working = there && r.site !== null && r.spot?.site === r.site && a.v < 0.1;
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
    const start = cellAt(r.x, r.z);
    const sk = cellKey(start[0], start[1]);
    const refuge = (cells: Cell[], mode: number, x: number, z: number) => {
      const pts = laneWay(cells, [r.x, r.z], [x, z]);
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
        if (!c || !isOpen(c) || t.taken(a, x + dx, z + dz)) continue;
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

  /** The last resort: back inside its dock (it rolls out again when the door is clear). */
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
      if (r.working && r.spot) {
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
      /** m of way left to its slot (0: there) */
      legs: this.rovers.map((r) => Math.round(Math.max(0, Traffic.end(r.agent) - r.agent.s) * 10) / 10),
      /** parked inside its dock (not drawn) */
      inside: this.rovers.map((r) => r.inside),
      drawn: this.drawn.length,
      yaws: this.rovers.map((r) => Math.round(r.yaw * 100) / 100),
      selected: this.selected,
      ring: this.ring.visible,
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
  for (const r of s.rovers ?? []) k += `${r.id}:${r.home}:${r.site}:${r.road ?? ''};`;
  return `${k}|${s.survey?.active?.rover ?? ''}`;
}

/** The traffic's road cells from the state (on change only). */
export function syncGround(t: Traffic, s: GameState) {
  const sig = `${s.roadRev ?? 0}:${s.roads?.length ?? 0}`;
  if (sig === t.roadSignature) return;
  const cells: [number, number][] = [];
  for (const c of s.roads ?? []) if (isOpen(c)) cells.push([c.gx, c.gz]);
  t.setRoads(sig, cells);
}

// ─────────────────────── drones (docs/14 §4.3) ───────────────────────

const MAX_DRONES = 48;
const DRONE_SCALE = 1.3;

/** A quadcopter from the kit (about 200 △): a body, four arms and rotor
 *  discs, skids, a nose lamp and a beacon. */
function droneGeometry(): THREE.BufferGeometry {
  const parts: (THREE.BufferGeometry | THREE.BufferGeometry[])[] = [
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
  g.translate(0, -0.28, 0); // skids at y 0
  g.scale(DRONE_SCALE, DRONE_SCALE, DRONE_SCALE);
  g.computeBoundingBox();
  g.computeBoundingSphere();
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

  constructor(private hf: Heightfield, group: THREE.Group) {
    const geo = withInstanceState(droneGeometry(), MAX_DRONES);
    // machines' light: cold (docs/14 §4.4)
    (geo.getAttribute('iWarm').array as Float32Array).fill(0);
    this.mesh = new THREE.InstancedMesh(geo, materials.get('building'), MAX_DRONES);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
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

  /** The drones follow the sim roster's hive units (keyed by id); `fresh`:
   *  the slots' signature changed (sites, roads, the roster), so re-aim. */
  sync(dt: number, s: GameState, units: readonly RoverUnit[], fresh: boolean) {
    this.clock += dt;
    if (fresh || units.length !== this.list.length) {
      const next: Drone[] = [];
      const perHive = new Map<number, number>();
      for (const u of units.slice(0, MAX_DRONES)) {
        const pad = perHive.get(u.home) ?? 0;
        perHive.set(u.home, pad + 1);
        let d = this.byId.get(u.id);
        if (!d) {
          const [px, py, pz] = this.padPoint(s, u.home, pad);
          d = { id: u.id, x: px, y: py, z: pz, yaw: 0, v: 0, gx: px, gy: py, gz: pz, cruise: DRONE.cruiseMin + (u.id % 5),
            site: null, job: false, perched: true, working: false, phase: u.id * 1.913, home: u.home, pad };
        }
        d.home = u.home;
        d.pad = pad;
        if (d.site === null && u.site !== null && d.perched) this.launches++;
        d.site = u.site;
        d.job = false;
        this.aim(d, s, u);
        next.push(d);
      }
      this.list = next;
      this.byId = new Map(next.map((d) => [d.id, d]));
    }
    for (const d of this.list) this.fly(d, dt);
  }

  /** a hive pad's world point (the deck top) */
  private padPoint(s: GameState, home: number, pad: number): [number, number, number] {
    const hive = s.buildings.find((b) => b.id === home);
    if (!hive) return [0, 0, 0];
    const [cx, cz] = centerOf(hive);
    const [lx, lz] = HIVE_PADS[pad % HIVE_PADS.length];
    const a = -hive.rot * PI / 2, c = Math.cos(a), sn = Math.sin(a);
    const x = cx + lx * c + lz * sn, z = cz - lx * sn + lz * c;
    return [x, this.hf.sample(cx, cz) + HIVE_DECK_Y, z];
  }

  /** where it is going: over its site, over its road's frontier, or home to its pad */
  private aim(d: Drone, s: GameState, u: RoverUnit) {
    const site = u.site !== null ? s.buildings.find((b) => b.id === u.site && (b.construction ?? 0) > 0) : undefined;
    if (site) {
      const [cx, cz] = centerOf(site);
      const def = BUILDINGS[site.type];
      const r = Math.max(2, Math.min(def.footprint[0], def.footprint[1]) * 2 - 1.5);
      const a = (d.id % 4) * PI / 2 + 0.6;
      d.gx = cx + Math.cos(a) * r; d.gz = cz + Math.sin(a) * r;
      d.gy = this.hf.sample(cx, cz) + Math.min(9, def.height * 0.6) + 2.5;
      return;
    }
    const job = u.road !== undefined ? s.roadJobs?.find((j) => j.id === u.road) : undefined;
    const f = job ? frontierOf(s, job.cells) : null;
    if (f) {
      const [x, z] = cellCentre(f.cell.gx, f.cell.gz);
      d.gx = x + ((d.id % 3) - 1) * 1.2; d.gz = z;
      d.gy = this.hf.sample(x, z) + 3.2;
      d.job = true;
      return;
    }
    [d.gx, d.gy, d.gz] = this.padPoint(s, u.home, d.pad);
  }

  /** straight at its cruise height: climb, fly, descend onto its goal */
  private fly(d: Drone, dt: number) {
    if (dt <= 0) return;
    const dx = d.gx - d.x, dz = d.gz - d.z;
    const dist = Math.hypot(dx, dz);
    const ground = this.hf.sample(d.x, d.z);
    const cruiseY = Math.max(ground, this.hf.sample(d.gx, d.gz)) + d.cruise;
    const near = dist < 9;
    const wantY = near ? d.gy : Math.max(cruiseY, d.gy);
    // the climb comes first: it sets off once it is up, or when the goal is close
    const up = d.y >= Math.min(wantY, ground + 3) - 0.3 || near;
    const vmax = up ? Math.min(DRONE.speed, Math.sqrt(2 * DRONE.accel * dist) + 0.2) : 0;
    d.v = Math.min(vmax, d.v + DRONE.accel * dt);
    if (dist > 1e-3) {
      const step = Math.min(dist, d.v * dt);
      d.x += (dx / dist) * step; d.z += (dz / dist) * step;
      if (d.v > 0.3) d.yaw += Math.max(-2 * dt, Math.min(2 * dt, Math.atan2(Math.sin(Math.atan2(dx, dz) - d.yaw), Math.cos(Math.atan2(dx, dz) - d.yaw))));
    } else d.v = 0;
    const dy = wantY - d.y;
    d.y += Math.max(-DRONE.climb * dt, Math.min(DRONE.climb * dt, dy));
    d.y = Math.max(d.y, this.hf.sample(d.x, d.z) + 0.3 * (d.perched && dist < 0.2 ? 0 : 1));
    const there = dist < 0.3 && Math.abs(dy) < 0.15;
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
      ids: this.list.map((d) => d.id),
      heights: this.list.map((d) => Math.round((d.y - this.hf.sample(d.x, d.z)) * 10) / 10),
      positions: this.list.map((d) => [Math.round(d.x * 10) / 10, Math.round(d.z * 10) / 10]),
      launches: this.launches,
    };
  }
}
