/** Everything that moves or changes on its own around the base, in one
 *  place so the game loop makes a single call: the rover fleet, the hauling
 *  excavators, regolith
 *  dust, launch and resupply events, research made visible (berms, the
 *  swarm's glints, cleaner panels), the destiny's links and EVA walkers
 *  (docs/14 §4.3), and the astronaut's bootprints.
 *
 *  Each part fails soft: an exception disables that part (its objects are
 *  hidden) and the game carries on. */
import * as THREE from 'three';
import { CYCLE_S } from '../data/balance';
import type { BuildingState, GameState } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import { centerOf } from '../buildings/instances';
import { Berms } from '../buildings/berms';
import { Footprints, type Walker } from '../player/footprints';
import { DUST_SLOTS, DustField, type DustEmitter } from './dust';
import { LaunchFx, ResupplyFx } from './events';
import { RoverFleet, syncGround } from './rovers';
import { Haulers } from './haulers';
import { Traffic } from './traffic';
import { RoadMesh } from './roads';
import { SwarmGlints } from './swarm';
import { Links } from '../buildings/links';
import { Settlers } from './settlers';

export interface LifeFrame {
  /** real seconds since the last frame */
  dt: number;
  paused: boolean;
  speed: number;
  state: GameState;
  camera: THREE.Camera;
  sunDir: THREE.Vector3;
  /** the sun's light as a fraction of full */
  sunLight: number;
  /** the astronaut, while walking */
  walker: Walker | null;
  /** the part of the next economy second already gone (the haulers glide on it) */
  tickFrac?: number;
}

// panel film (visual only): a thin coat from base traffic settles on the
// arrays, the equilibrium set by how fast it is cleared
const FILM_GAIN = 0.25 / CYCLE_S;          // per game second, doubled near activity
const FILM_MAX = 0.35;
const FILM_TAU = CYCLE_S;                  // uncleaned: a lunar day to settle
const FILM_TAU_MITIGATED = 60;             // electrostatic curtains
const NEAR_M = 45;
const EMPTY: ReadonlySet<number> = new Set();

type Part = 'rovers' | 'haulers' | 'traffic' | 'roads' | 'dust' | 'launch' | 'resupply' | 'berms' | 'swarm' | 'prints' | 'film'
  | 'links' | 'settlers';

export class BaseLife {
  readonly group = new THREE.Group();
  /** every ground unit's motion: rovers and excavators keep off each other */
  readonly traffic = new Traffic();
  readonly rovers: RoverFleet;
  readonly haulers: Haulers;
  /** the road network, drawn */
  readonly roads: RoadMesh;
  readonly dust = new DustField();
  readonly launch: LaunchFx;
  readonly resupply: ResupplyFx;
  readonly berms: Berms;
  readonly swarm = new SwarmGlints();
  readonly prints: Footprints;
  /** the destiny's links: walkways and conveyor spines (docs/14 §4.3) */
  readonly links: Links;
  /** the Colony's EVA walkers (docs/14 §4.3) */
  readonly settlers: Settlers;
  private film = new Map<number, number>();
  private filmAcc = 0;
  private failed = new Set<Part>();
  private emitList: { e: DustEmitter; d: number }[] = [];
  private earthAzim: number;

  constructor(private hf: Heightfield, requestShadowUpdate: () => void) {
    this.rovers = new RoverFleet(hf, this.traffic);
    this.haulers = new Haulers(hf, this.traffic);
    this.roads = new RoadMesh(hf);
    this.launch = new LaunchFx(hf);
    this.resupply = new ResupplyFx(hf);
    this.berms = new Berms(hf);
    this.prints = new Footprints(hf);
    this.links = new Links(hf);
    this.settlers = new Settlers(hf);
    this.resupply.onShadowCastersChanged = this.berms.onShadowCastersChanged = this.links.onShadowCastersChanged = requestShadowUpdate;
    this.earthAzim = hf.site.earth.azimDeg * Math.PI / 180;
    this.group.add(this.roads.group, this.rovers.group, this.haulers.group, this.dust.points, this.launch.group, this.resupply.group,
      this.berms.mesh, this.swarm.group, this.prints.mesh, this.links.group, this.settlers.group);
  }

  update(f: LifeFrame) {
    const vdt = f.paused ? 0 : f.dt;
    const gdt = vdt * f.speed;
    const s = f.state;
    // the ground units: where each wants to be, then one traffic step for
    // all of them (they keep off each other), then drawn where they got to
    const night = f.sunLight < 0.1;
    this.run('roads', () => this.roads.update(s, 1 - Math.min(1, f.sunLight * 4)));
    this.run('rovers', () => { syncGround(this.traffic, s); this.rovers.sync(gdt, s, night); });
    this.run('haulers', () => this.haulers.sync(gdt, s, f.tickFrac ?? 0, night));
    this.run('traffic', () => this.traffic.step(gdt));
    if (this.failed.has('traffic')) this.run('haulers', () => this.haulers.follow());
    this.run('rovers', () => this.rovers.draw(gdt, f.sunDir, f.sunLight));
    this.run('haulers', () => this.haulers.finish(gdt, f.sunLight));
    this.run('resupply', () => this.resupply.update(s, this.earthAzim, vdt));
    this.run('launch', () => this.launch.update(vdt));
    this.run('berms', () => this.berms.update(s));
    this.run('links', () => this.links.update(s));
    this.run('settlers', () => this.settlers.update(gdt, s, this.failed.has('links') ? EMPTY : this.links.ground, f.sunDir, f.sunLight));
    this.run('swarm', () => this.swarm.update(f.camera, f.sunDir, s.swarmPct, f.dt));
    if (f.walker) this.run('prints', () => this.prints.update(f.walker!));
    this.run('film', () => this.updateFilm(s, gdt));
    this.run('dust', () => {
      const list: DustEmitter[] = [];
      this.resupply.emitters(list);
      const cands = this.emitList;
      cands.length = 0;
      this.rovers.emitters(f.camera.position, cands);
      if (!this.failed.has('haulers')) this.haulers.emitters(f.camera.position, cands);
      cands.sort((a, b) => a.d - b.d);
      for (const c of cands) {
        if (list.length >= DUST_SLOTS) break;
        list.push(c.e);
      }
      // sunlit grains catch the light brighter than the ground they leave;
      // a faint floor so night dust near the floods is not pure black
      this.dust.update(vdt, list, 0.015 + 0.45 * f.sunLight);
    });
  }

  /** What the audio hears of the destiny's life at a listener point (x, z),
   *  `lift` m up (docs/14 §4.6): rotors near the drones, walkers near
   *  enough to hear their radios, greenhouses and domes breathing; and how
   *  many drones have taken off so far (each a data chirp). */
  soundscape(s: GameState, x: number, z: number, lift: number) {
    let garden = 0;
    for (const b of s.buildings) {
      if (b.type !== 'greenhouseRing' && b.type !== 'gardenDome' || (b.construction ?? 0) > 0) continue;
      const [bx, bz] = centerOf(b);
      garden += 1 / (1 + (Math.hypot(bx - x, bz - z, lift) / 30) ** 2);
    }
    return {
      rotor: this.failed.has('rovers') ? 0 : this.rovers.drones.rotorLevel(x, z, lift),
      walkers: this.failed.has('settlers') ? 0 : Math.min(1, this.settlers.near(x, z, 60 + lift) / 3),
      garden: Math.min(1, garden),
      launches: this.rovers.drones.launches,
    };
  }

  /** A volley just left the mass driver (Game.doLaunch). */
  onLaunch(state: GameState) {
    this.run('launch', () => this.launch.fire(state));
  }

  /** Dust the building shader shows on a solar array's glass. */
  panelDust(b: BuildingState): number {
    return Math.max(b.dust ?? 0, this.film.get(b.id) ?? 0);
  }

  private run(part: Part, fn: () => void) {
    if (this.failed.has(part)) return;
    try {
      fn();
    } catch (e) {
      this.failed.add(part);
      // a part gone: its units leave the ground traffic
      if (part === 'rovers') this.traffic.enlist('rover', []);
      if (part === 'haulers') this.traffic.enlist('digger', []);
      console.warn(`[MOONSHOTS] ${part} visuals disabled after an error.`, e);
      const objects: Partial<Record<Part, THREE.Object3D>> = {
        rovers: this.rovers.group, haulers: this.haulers.group, roads: this.roads.group, dust: this.dust.points, launch: this.launch.group,
        resupply: this.resupply.group, berms: this.berms.mesh, swarm: this.swarm.group, prints: this.prints.mesh,
        links: this.links.group, settlers: this.settlers.group,
      };
      const o = objects[part];
      if (o) o.visible = false;
    }
  }

  private updateFilm(s: GameState, gdt: number) {
    this.filmAcc += gdt;
    if (this.filmAcc < 1) return;
    const dt = this.filmAcc;
    this.filmAcc = 0;
    const tau = s.techsDone.includes('dustMitigation') ? FILM_TAU_MITIGATED : FILM_TAU;
    const busy: [number, number][] = [];
    for (const b of s.buildings) {
      const site = (b.construction ?? 0) > 0 && b.idleReason === 'building';
      if (site || (b.type === 'excavator' && b.active)) busy.push(centerOf(b));
    }
    const seen = new Set<number>();
    for (const b of s.buildings) {
      if (b.type !== 'solar' || (b.construction ?? 0) > 0) continue;
      seen.add(b.id);
      const [x, z] = centerOf(b);
      const near = busy.some(([bx, bz]) => Math.hypot(bx - x, bz - z) < NEAR_M) ? 2 : 1;
      let f = this.film.get(b.id) ?? 0;
      // exact decay toward the equilibrium over the step
      const eq = Math.min(FILM_MAX, FILM_GAIN * near * tau);
      f = eq + (f - eq) * Math.exp(-dt / tau);
      this.film.set(b.id, f);
    }
    for (const id of this.film.keys()) if (!seen.has(id)) this.film.delete(id);
  }

  info() {
    let film = 0;
    for (const v of this.film.values()) film = Math.max(film, v);
    return {
      rovers: this.rovers.info(),
      haulers: this.haulers.info(),
      traffic: this.traffic.info(),
      roads: this.roads.info(),
      dust: this.dust.info(),
      launch: this.launch.info(),
      resupply: this.resupply.info(),
      berms: this.berms.count,
      swarmGlints: this.swarm.count,
      footprints: this.prints.count,
      links: this.links.info(),
      settlers: this.settlers.info(),
      panelFilm: Math.round(film * 1000) / 1000,
      failed: [...this.failed],
    };
  }
}
