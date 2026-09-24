/** Everything that moves or changes on its own around the base, in one
 *  place so the game loop makes a single call: the rover fleet, regolith
 *  dust, launch and resupply events and the astronaut's bootprints.
 *
 *  Each part fails soft: an exception disables that part (its objects are
 *  hidden) and the game carries on. */
import * as THREE from 'three';
import type { GameState } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import { centerOf } from '../buildings/instances';
import { Footprints, type Walker } from '../player/footprints';
import { DUST_SLOTS, DustField, type DustEmitter } from './dust';
import { LaunchFx, ResupplyFx } from './events';
import { RoverFleet } from './rovers';

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

type Part = 'rovers' | 'dust' | 'launch' | 'resupply' | 'prints';

export class BaseLife {
  readonly group = new THREE.Group();
  readonly rovers: RoverFleet;
  readonly dust = new DustField();
  readonly launch: LaunchFx;
  readonly resupply: ResupplyFx;
  readonly prints: Footprints;
  private failed = new Set<Part>();
  private emitList: { e: DustEmitter; d: number }[] = [];
  private earthAzim: number;

  constructor(private hf: Heightfield, requestShadowUpdate: () => void) {
    this.rovers = new RoverFleet(hf);
    this.launch = new LaunchFx(hf);
    this.resupply = new ResupplyFx(hf);
    this.prints = new Footprints(hf);
    this.resupply.onShadowCastersChanged = requestShadowUpdate;
    this.earthAzim = hf.site.earth.azimDeg * Math.PI / 180;
    this.group.add(this.rovers.group, this.dust.points, this.launch.group, this.resupply.group,
      this.prints.mesh);
  }

  update(f: LifeFrame) {
    const vdt = f.paused ? 0 : f.dt;
    const gdt = vdt * f.speed;
    const s = f.state;
    this.run('rovers', () => this.rovers.update(gdt, s, f.sunDir, f.sunLight));
    this.run('resupply', () => this.resupply.update(s, this.earthAzim, vdt));
    this.run('launch', () => this.launch.update(vdt));
    if (f.walker) this.run('prints', () => this.prints.update(f.walker!));
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

  private run(part: Part, fn: () => void) {
    if (this.failed.has(part)) return;
    try {
      fn();
    } catch (e) {
      this.failed.add(part);
      console.warn(`[MOONSHOTS] ${part} visuals disabled after an error.`, e);
      const objects: Partial<Record<Part, THREE.Object3D>> = {
        rovers: this.rovers.group, dust: this.dust.points, launch: this.launch.group,
        resupply: this.resupply.group, prints: this.prints.mesh,
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

  info() {
    return {
      rovers: this.rovers.info(),
      dust: this.dust.info(),
      launch: this.launch.info(),
      resupply: this.resupply.info(),
      footprints: this.prints.count,
      failed: [...this.failed],
    };
  }
}
