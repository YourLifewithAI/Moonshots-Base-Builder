/** Overhead build/plan camera — MapControls (left-drag pan, right-drag orbit,
 *  wheel zoom toward the cursor) plus keys: WASD/arrows pan at a rate scaled
 *  by camera distance, Q/E orbit. The orbit target rides the terrain, the
 *  camera never sinks below a clearance over the ground, and focus() glides
 *  to a point. Target clamped to keep the map in frame.
 *
 *  Touch (player/touch.ts) drives it through the CommandCam touch methods
 *  (MapControls never sees a touch): one finger drags the ground, a pinch
 *  dollies, a twist orbits with the fingers, ⟲ ⟳ orbit 90° eased. */
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { MAP_M } from '../data/balance';
import { commandKey, type CommandCam } from './isoCam';

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

// The interface and the key test now live in isoCam.ts (the fixed isometric
// view is the command camera); this file keeps the free camera and forwards
// the two, until the renderer collapse deletes it.
export { commandKey, type CommandCam } from './isoCam';

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
  /** touch: the pinch's starting distance, and a ⟲ ⟳ orbit in progress */
  private pinch0: number | null = null;
  private orbit: { left: number } | null = null;

  constructor(private camera: THREE.PerspectiveCamera, private dom: HTMLElement) {
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

  // ── touch ──

  panPx(dx: number, dy: number, stopGlide = false) {
    if (!this.enabled) return;
    if (stopGlide) this.glide = null;
    const t = this.controls.target, cam = this.camera.position;
    this.fwd.copy(t).sub(cam);
    const dist = this.fwd.length();
    const pitch = Math.max(0.2, Math.asin(Math.min(1, Math.max(-1, -this.fwd.y / Math.max(1e-6, dist)))));
    this.fwd.setY(0);
    if (this.fwd.lengthSq() < 1e-6) this.fwd.set(0, 0, -1);
    this.fwd.normalize();
    this.right.crossVectors(this.fwd, UP);
    const h = this.dom.clientHeight || window.innerHeight;
    const m = (2 * dist * Math.tan((this.camera.fov / 2) * (Math.PI / 180))) / h;
    this.v.copy(t);
    t.addScaledVector(this.right, -dx * m).addScaledVector(this.fwd, (dy * m) / Math.sin(pitch));
    this.clampTarget();
    cam.add(this.v.subVectors(t, this.v));
  }

  pinch(phase: 'start' | 'move' | 'end', scale = 1) {
    const t = this.controls.target, cam = this.camera.position;
    if (phase === 'start') { this.pinch0 = cam.distanceTo(t); this.glide = null; return; }
    if (phase === 'end' || this.pinch0 === null || !this.enabled) { this.pinch0 = null; return; }
    const d = Math.min(this.controls.maxDistance, Math.max(this.controls.minDistance, this.pinch0 / Math.max(0.05, scale)));
    this.v.copy(cam).sub(t).setLength(d);
    cam.copy(t).add(this.v);
  }

  twist(rad: number) {
    if (!this.enabled) return;
    const t = this.controls.target, cam = this.camera.position;
    // the ground turns with the fingers: the camera orbits the other way
    this.v.copy(cam).sub(t).applyAxisAngle(UP, rad);
    cam.copy(t).add(this.v);
  }

  twistReset() { /* the free camera orbits continuously: nothing to reset */ }

  /** −1 turns the ground clockwise on screen (the camera orbits the other
   *  way), as Q does and as the isometric view's step does */
  turnStep(dir: -1 | 1) {
    this.orbit = { left: (this.orbit?.left ?? 0) - dir * (Math.PI / 2) };
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
    // ⟲ ⟳ (touch): a 90° orbit, eased out over about a third of a second
    if (this.orbit) {
      const step = Math.abs(this.orbit.left) < 0.002 ? this.orbit.left : this.orbit.left * (1 - Math.exp(-12 * dt));
      this.v.copy(cam).sub(t).applyAxisAngle(UP, step);
      cam.copy(t).add(this.v);
      this.orbit.left -= step;
      if (Math.abs(this.orbit.left) < 1e-4) this.orbit = null;
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
