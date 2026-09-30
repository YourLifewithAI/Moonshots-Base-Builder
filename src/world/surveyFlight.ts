/** The survey-drone fleet in the world (docs/19 S6), instanced like DroneFlight: one InstancedMesh of
 *  delta-wing survey drones (world/rovers.ts surveyDroneGeometry, outlined by one `inked` line).
 *  A docked drone perches on its Lander or Prospecting Bay; one on a flight (state.survey.flights)
 *  lifts from its pad, flies out on its prospect's bearing to the edge of the map and vanishes, and
 *  is seen again at the edge as it flies back, the flight's length later, to settle on its pad.
 *  Everything is a pure function of the sim's clock: paused, the drones hang where they are; a load
 *  sets them right at once. Allocation-free per frame. */
import * as THREE from 'three';
import type { GameState } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import { MAP_M } from '../data/balance';
import { centerOf } from '../buildings/instances';
import { prospectBearing } from '../core/exploration';
import { withInstanceState } from '../buildings/meshKit';
import { materials } from './materials';
import { inked } from './ink';
import { surveyDroneGeometry } from './rovers';

const MAX_DRONES = 40;
/** cruise m/s over the ground on a flight, and the climb-out and settle-in (s) */
const SPEED = 80;
const CLIMB_S = 2;
const CRUISE_M = 22;
const HALF = MAP_M / 2;

/** perches, in a dock's own frame (x right, y up, z toward the door side): the Lander's apron, and a
 *  Prospecting Bay's two roof cradles then four apron points (recipes.ts prospectingBay) */
const LANDER_PERCH: readonly [number, number, number][] = [[0, 0.3, 5.0], [-2.6, 0.3, 5.0], [2.6, 0.3, 5.0]];
const BAY_PERCH: readonly [number, number, number][] = [
  [-1.6, 2.86, -1.9], [1.6, 2.86, -1.9], [-2.7, 0.5, 1.2], [2.7, 0.5, 1.2], [-3.5, 0.5, -1.9], [3.5, 0.5, -1.9],
];

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface Pose { x: number; y: number; z: number; yaw: number; pitch: number; out: boolean; flying: boolean; hidden: boolean }

export class SurveyFlights {
  readonly group = new THREE.Group();
  readonly mesh: THREE.InstancedMesh;
  private poses: (Pose & { id: number })[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private p = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  /** flights seen leaving so far (a launch counter for the audio and the specs) */
  launches = 0;
  private flying = new Set<number>();

  constructor(private hf: Heightfield) {
    const geo = withInstanceState(surveyDroneGeometry(), MAX_DRONES);
    // machines' light: cold (docs/14 §4.4)
    (geo.getAttribute('iWarm').array as Float32Array).fill(0);
    this.mesh = new THREE.InstancedMesh(geo, materials.get('building'), MAX_DRONES);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    inked(this.mesh, 'surveyDrone');
    this.group.add(this.mesh);
  }

  /** a dock's perch point, world metres: the dock's frame turned by its rotation, on its ground */
  private perch(s: GameState, home: number, slot: number): [number, number, number, number] | null {
    const b = s.buildings.find((x) => x.id === home);
    if (!b) return null;
    const table = b.type === 'lander' ? LANDER_PERCH : BAY_PERCH;
    const [lx, ly, lz] = table[slot % table.length];
    const [cx, cz] = centerOf(b);
    const a = -b.rot * Math.PI / 2, c = Math.cos(a), sn = Math.sin(a);
    return [cx + lx * c + lz * sn, this.hf.sample(cx, cz) + ly, cz - lx * sn + lz * c, a];
  }

  /** every drone's pose at `now` (sim seconds, the tick fraction added) */
  update(s: GameState, frac: number) {
    const now = s.simTime + Math.max(0, Math.min(1, frac));
    const drones = s.survey?.surveyDrones ?? [];
    const flights = s.survey?.flights ?? [];
    const slots = new Map<number, number>();
    this.poses.length = 0;
    const nowFlying = new Set<number>();
    for (const d of [...drones].sort((a, b) => a.id - b.id).slice(0, MAX_DRONES)) {
      const slot = slots.get(d.home) ?? 0;
      slots.set(d.home, slot + 1);
      const pad = this.perch(s, d.home, slot);
      if (!pad) continue;
      const f = flights.find((x) => x.drone === d.id);
      let pose: Pose = { x: pad[0], y: pad[1], z: pad[2], yaw: pad[3], pitch: 0, out: false, flying: false, hidden: false };
      if (f) {
        nowFlying.add(d.id);
        const T = Math.max(1, f.endsAt - f.startedAt);
        const t = now - f.startedAt;
        const bearing = prospectBearing(s.siteId, f.id) * Math.PI / 180;
        // north is −z, east is +x
        const dx = Math.sin(bearing), dz = -Math.cos(bearing);
        // where the ray from the pad meets the map's edge
        const tx = dx > 1e-6 ? (HALF - pad[0]) / dx : dx < -1e-6 ? (-HALF - pad[0]) / dx : Infinity;
        const tz = dz > 1e-6 ? (HALF - pad[2]) / dz : dz < -1e-6 ? (-HALF - pad[2]) / dz : Infinity;
        const D = Math.max(40, Math.min(tx, tz)) + 20;
        // a leg takes its climb and its cruise, at most half the flight
        const L = Math.max(1, Math.min(T / 2 - 0.5, CLIMB_S + D / SPEED));
        const out = t <= L;
        const back = t >= T - L;
        if (out || back) {
          const u = out ? t / L : (T - t) / L;
          const k = Math.max(0, Math.min(1, u));
          const x = pad[0] + dx * D * k, z = pad[2] + dz * D * k;
          const ramp = smooth(0, Math.min(0.5, CLIMB_S / L), k);
          const cruise = CRUISE_M + (d.id % 4) * 3;
          const y = pad[1] + (this.hf.sample(x, z) + cruise - pad[1]) * ramp;
          const yaw = Math.atan2(out ? dx : -dx, out ? dz : -dz);
          pose = { x, y, z, yaw, pitch: -0.16 * ramp, out, flying: true, hidden: false };
        } else pose = { ...pose, flying: true, hidden: true };
      }
      this.poses.push({ id: d.id, ...pose });
    }
    for (const id of nowFlying) if (!this.flying.has(id)) this.launches++;
    this.flying = nowFlying;
  }

  draw() {
    let n = 0;
    for (const p of this.poses) {
      // between its two legs a flying drone is off the map: not drawn
      if (p.hidden) continue;
      this.e.set(p.pitch, p.yaw, 0);
      this.mesh.setMatrixAt(n++, this.m.compose(this.p.set(p.x, p.y, p.z), this.q.setFromEuler(this.e), this.one));
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.boundingSphere = null;
  }

  info() {
    const vis = this.poses.filter((p) => !p.hidden);
    return {
      count: this.poses.length,
      drawn: vis.length,
      flying: this.poses.filter((p) => p.flying).length,
      offMap: this.poses.filter((p) => p.hidden).length,
      docked: this.poses.filter((p) => !p.flying).length,
      launches: this.launches,
      ids: this.poses.map((p) => p.id),
      positions: this.poses.map((p) => (p.hidden ? null : [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.z * 10) / 10])),
    };
  }
}
