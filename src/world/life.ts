/** Everything that moves or changes on its own around the base, in one
 *  place so the game loop makes a single call: the rover fleet, regolith
 *  dust, launch and resupply events, research made visible (berms, the
 *  swarm's glints, cleaner panels) and the astronaut's bootprints.
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
import { RoverFleet } from './rovers';
import { SwarmGlints } from './swarm';

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
}

// panel film (visual only): a thin coat from base traffic settles on the
// arrays, the equilibrium set by how fast it is cleared
const FILM_GAIN = 0.25 / CYCLE_S;          // per game second, doubled near activity
const FILM_MAX = 0.35;
const FILM_TAU = CYCLE_S;                  // uncleaned: a lunar day to settle
const FILM_TAU_MITIGATED = 60;             // electrostatic curtains
const NEAR_M = 45;

type Part = 'rovers' | 'dust' | 'launch' | 'resupply' | 'berms' | 'swarm' | 'prints' | 'film';

export class BaseLife {
  readonly group = new THREE.Group();
  readonly rovers: RoverFleet;
  readonly dust = new DustField();
  readonly launch: LaunchFx;
  readonly resupply: ResupplyFx;
  readonly berms: Berms;
  readonly swarm = new SwarmGlints();
  readonly prints: Footprints;
  private film = new Map<number, number>();
  private filmAcc = 0;
  private failed = new Set<Part>();
  private emitList: { e: DustEmitter; d: number }[] = [];
  private earthAzim: number;

  constructor(private hf: Heightfield, requestShadowUpdate: () => void) {
    this.rovers = new RoverFleet(hf);
    this.launch = new LaunchFx(hf);
    this.resupply = new ResupplyFx(hf);
    this.berms = new Berms(hf);
    this.prints = new Footprints(hf);
    this.resupply.onShadowCastersChanged = this.berms.onShadowCastersChanged = requestShadowUpdate;
    this.earthAzim = hf.site.earth.azimDeg * Math.PI / 180;
    this.group.add(this.rovers.group, this.dust.points, this.launch.group, this.resupply.group,
      this.berms.mesh, this.swarm.group, this.prints.mesh);
  }

  update(f: LifeFrame) {
    const vdt = f.paused ? 0 : f.dt;
    const gdt = vdt * f.speed;
    const s = f.state;
    this.run('rovers', () => this.rovers.update(gdt, s, f.sunDir, f.sunLight));
    this.run('resupply', () => this.resupply.update(s, this.earthAzim, vdt));
    this.run('launch', () => this.launch.update(vdt));
    this.run('berms', () => this.berms.update(s));
    this.run('swarm', () => this.swarm.update(f.camera, f.sunDir, s.swarmPct, f.dt));
    if (f.walker) this.run('prints', () => this.prints.update(f.walker!));
    this.run('film', () => this.updateFilm(s, gdt));
    this.run('dust', () => {
      const list: DustEmitter[] = [];
      this.resupply.emitters(list);
      const cands = this.emitList;
      cands.length = 0;
      this.rovers.emitters(f.camera.position, cands);
      this.excavators(s, f.camera.position, cands);
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
      console.warn(`[MOONSHOTS] ${part} visuals disabled after an error.`, e);
      const objects: Partial<Record<Part, THREE.Object3D>> = {
        rovers: this.rovers.group, dust: this.dust.points, launch: this.launch.group,
        resupply: this.resupply.group, berms: this.berms.mesh, swarm: this.swarm.group, prints: this.prints.mesh,
      };
      const o = objects[part];
      if (o) o.visible = false;
    }
  }

  /** Active excavators throw spoil off the bucket wheel's cutting face. */
  private excavators(s: GameState, cam: THREE.Vector3, out: { e: DustEmitter; d: number }[]) {
    for (const b of s.buildings) {
      if (b.type !== 'excavator' || !b.active || (b.construction ?? 0) > 0) continue;
      const [cx, cz] = centerOf(b);
      const a = -b.rot * Math.PI / 2, c = Math.cos(a), sn = Math.sin(a);
      const lx = 3.9, lz = 0.7; // the recipe's bucket wheel, front face
      const x = cx + lx * c + lz * sn, z = cz - lx * sn + lz * c;
      out.push({ d: Math.hypot(x - cam.x, z - cam.z), e: {
        x, y: this.hf.sample(x, z), z, strength: 0.7,
        vx: c * 0.9, vy: 1.3, vz: -sn * 0.9, hSpread: 0.9, vSpread: 1.1, h0: 0.3, size: 0.06,
      } });
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
      dust: this.dust.info(),
      launch: this.launch.info(),
      resupply: this.resupply.info(),
      berms: this.berms.count,
      swarmGlints: this.swarm.count,
      footprints: this.prints.count,
      panelFilm: Math.round(film * 1000) / 1000,
      failed: [...this.failed],
    };
  }
}
