/** Overhead build/plan camera — MapControls (left-drag pan, right-drag orbit,
 *  wheel zoom toward the cursor) plus keys: WASD/arrows pan at a rate scaled
 *  by camera distance, Q/E orbit. The orbit target rides the terrain, the
 *  camera never sinks below a clearance over the ground, and focus() glides
 *  to a point. Target clamped to keep the map in frame. */
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { MAP_M } from '../data/balance';

export const HOME_DIST = 90;
/** target → camera, ~22° above the horizon: the landing site with its horizon */
export const HOME_DIR = new THREE.Vector3(0.52, 0.37, 0.77).normalize();
const CLEARANCE = 4;        // m over the highest ground under the camera
const PAN_RATE = 0.75;      // camera distances per second
const ORBIT_RATE = 1.5;     // rad/s
const FOLLOW_RATE = 5;      // 1/s: target easing onto the ground
const GLIDE_S = 0.6;
const PAN_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};
const UP = new THREE.Vector3(0, 1, 0);

/** What the game and the mode manager need from a command-view camera:
 *  this free one (High detail) or the classic isometric one (isoCam.ts). */
export interface CommandCam {
  /** the ground point the view is centred on (it rides the terrain) */
  readonly target: THREE.Vector3;
  enabled: boolean;
  groundAt: (x: number, z: number) => number;
  keyDown(code: string): void;
  keyUp(code: string): void;
  clearKeys(): void;
  /** frame (x, y, z) from home, instantly */
  home(x: number, y: number, z: number): void;
  /** glide to (x, y, z); `exact` = at the home framing (H), else closer (F) */
  focus(x: number, y: number, z: number, dist: number, exact?: boolean): void;
  /** place the view exactly (debug views; the isometric view keeps its pitch) */
  view(pos: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }): void;
  update(dt: number): void;
  /** metres from the camera down to the ground beneath it */
  readonly clearance: number;
}

/** Keys a command camera consumes (build mode only; walk mode owns WASD). */
export function commandKey(code: string): boolean {
  return code in PAN_KEYS || code === 'KeyQ' || code === 'KeyE';
}

export class BuildCam implements CommandCam {
  readonly controls: MapControls;
  /** terrain height anywhere, set per world */
  groundAt: (x: number, z: number) => number = () => 0;
  private keys = new Set<string>();
  private glide: {
    t: number; fromT: THREE.Vector3; toT: THREE.Vector3; fromP: THREE.Vector3; toP: THREE.Vector3;
  } | null = null;
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();
  private v = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.controls = new MapControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 18;
    this.controls.maxDistance = 700;
    this.controls.maxPolarAngle = Math.PI * 0.44;
    this.controls.zoomToCursor = true;
    this.controls.target.set(0, 0, 0);
  }

  /** Keys the build camera consumes (build mode only; walk mode owns WASD). */
  static handles(code: string): boolean {
    return commandKey(code);
  }

  get target(): THREE.Vector3 { return this.controls.target; }

  keyDown(code: string) { this.keys.add(code); }
  keyUp(code: string) { this.keys.delete(code); }
  clearKeys() { this.keys.clear(); }

  /** Frame (x, y, z) from the home direction, instantly. */
  home(x: number, y: number, z: number, dist = HOME_DIST) {
    this.glide = null;
    this.controls.target.set(x, y, z);
    this.camera.position.set(x, y, z).addScaledVector(HOME_DIR, dist);
    this.controls.update();
  }

  /** Place the camera and target exactly (debug views). */
  view(pos: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }) {
    this.glide = null;
    this.controls.target.set(target.x, target.y, target.z);
    this.camera.position.set(pos.x, pos.y, pos.z);
    this.controls.update();
  }

  /** Glide the target to (x, y, z), keeping the view direction; the camera
   *  closes to `dist` when farther (or sits exactly at it with `exact`). */
  focus(x: number, y: number, z: number, dist: number, exact = false) {
    const t = this.controls.target;
    const off = this.v.copy(this.camera.position).sub(t);
    const d = exact ? dist : Math.min(off.length(), dist);
    const toT = new THREE.Vector3(x, y, z);
    this.glide = {
      t: 0, fromT: t.clone(), toT,
      fromP: this.camera.position.clone(),
      toP: toT.clone().addScaledVector(off.normalize(), d),
    };
  }

  clampTarget() {
    const t = this.controls.target;
    const lim = MAP_M / 2 - 40;
    t.x = Math.min(lim, Math.max(-lim, t.x));
    t.z = Math.min(lim, Math.max(-lim, t.z));
  }

  update(dt: number) {
    const t = this.controls.target, cam = this.camera.position;
    if (this.glide) {
      const g = this.glide;
      g.t = Math.min(1, g.t + dt / GLIDE_S);
      const k = 1 - (1 - g.t) ** 3;
      t.lerpVectors(g.fromT, g.toT, k);
      cam.lerpVectors(g.fromP, g.toP, k);
      if (g.t >= 1) this.glide = null;
    }

    let fwd = 0, strafe = 0;
    for (const code of this.keys) {
      const k = PAN_KEYS[code];
      if (k) { strafe += k[0]; fwd += k[1]; }
    }
    const dist = cam.distanceTo(t);
    if (fwd || strafe) {
      this.glide = null;
      this.fwd.copy(t).sub(cam).setY(0);
      if (this.fwd.lengthSq() < 1e-6) this.fwd.set(0, 0, -1);
      this.fwd.normalize();
      this.right.crossVectors(this.fwd, UP);
      const step = PAN_RATE * dist * dt / Math.hypot(fwd, strafe);
      this.v.copy(t);
      t.addScaledVector(this.fwd, fwd * step).addScaledVector(this.right, strafe * step);
      this.clampTarget();
      cam.add(this.v.subVectors(t, this.v)); // the camera stops where the target does
    }
    const orbit = (this.keys.has('KeyQ') ? 1 : 0) - (this.keys.has('KeyE') ? 1 : 0);
    if (orbit) {
      this.v.copy(cam).sub(t).applyAxisAngle(UP, orbit * ORBIT_RATE * dt);
      cam.copy(t).add(this.v);
    }

    // ride the terrain: the target eases onto the ground and carries the camera
    const dy = (this.groundAt(t.x, t.z) - t.y) * (1 - Math.exp(-FOLLOW_RATE * dt));
    t.y += dy;
    cam.y += dy;
    this.clampTarget();
    this.controls.update();

    const floor = this.groundUnder(cam.x, cam.z) + CLEARANCE;
    if (cam.y < floor) {
      cam.y = floor;
      this.camera.lookAt(t);
    }
  }

  /** Highest ground within a couple of metres (the near plane's footprint). */
  private groundUnder(x: number, z: number): number {
    let h = this.groundAt(x, z);
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) h = Math.max(h, this.groundAt(x + dx, z + dz));
    return h;
  }

  /** Metres from the camera down to the ground beneath it (tests, probes). */
  get clearance(): number {
    const cam = this.camera.position;
    return cam.y - this.groundAt(cam.x, cam.z);
  }

  set enabled(v: boolean) { this.controls.enabled = v; }
  get enabled(): boolean { return this.controls.enabled; }
}
