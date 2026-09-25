/** The classic command view: a fixed isometric camera in the SimCity
 *  2000/3000 manner. A near-orthographic perspective (a 20° lens) at a
 *  fixed 32° pitch, so picking, screenOf and the overlays work unchanged:
 *
 *   - yaw at 45° + k·90°; Q/E turn one step with a short eased tween
 *     (presses queue: two quick taps turn 180°);
 *   - the wheel steps through five zoom levels, eased;
 *   - W A S D / arrows pan at a rate scaled by the view's size; right- or
 *     middle-drag pans, the ground following the pointer (the left button
 *     stays select / place / target);
 *   - F glides to the selection (closing to the nearest level, if farther),
 *     H glides home to the Lander at the home level;
 *   - the target rides the terrain and stays inside the map; the camera
 *     never sits below its clearance over the ground; the clip planes track
 *     the zoom (near-to-far ratio ~30 — plenty of depth precision for the
 *     ground decals).
 *
 *  The camera never looks above the horizon (the top of the frame is 22°
 *  below it): the sky shows on foot and on the way down. */
import * as THREE from 'three';
import { MAP_M } from '../data/balance';
import { commandKey, type CommandCam } from './buildCam';

const DEG = Math.PI / 180;
export const ISO_FOV = 20;
export const ISO_PITCH_DEG = 32;
/** target → camera distances (m); home framing ≈ 107 m of ground across a 16:9 view */
export const ISO_LEVELS = [100, 170, 290, 490, 830] as const;
export const ISO_HOME_LEVEL = 1;
const FOCUS_LEVEL = 0;
const YAW0 = 45 * DEG;
const TURN_S = 0.35;
const ZOOM_RATE = 9;        // 1/s, in log distance
const GLIDE_S = 0.6;
const PAN_RATE = 1.1;       // view heights per second
const FOLLOW_RATE = 5;      // 1/s: the target easing onto the ground
const CLEARANCE = 4;        // m over the highest ground under the camera
const WHEEL_STEP = 50;      // accumulated deltaY per zoom step (trackpads)
const MARGIN = 40;          // m: the target stays this far inside the map
const PAN_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};
const UP = new THREE.Vector3(0, 1, 0);

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class IsoCam implements CommandCam {
  readonly target = new THREE.Vector3();
  groundAt: (x: number, z: number) => number = () => 0;
  private on = true;
  private keys = new Set<string>();
  /** yaw step k (the view looks from 45° + k·90°) and the eased yaw */
  private step = 0;
  private yaw = YAW0;
  private turn: { from: number; to: number; t: number } | null = null;
  private level = ISO_HOME_LEVEL;
  private dist: number = ISO_LEVELS[ISO_HOME_LEVEL];
  private glide: { t: number; from: THREE.Vector3; to: THREE.Vector3 } | null = null;
  private drag: { id: number; x: number; y: number } | null = null;
  private wheelAcc = 0;
  private wheelAt = 0;
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();
  private v = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera, private dom: HTMLElement) {
    dom.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    dom.addEventListener('pointerdown', (e) => this.onDown(e));
    dom.addEventListener('pointermove', (e) => this.onMove(e));
    const up = (e: PointerEvent) => {
      if (this.drag?.id !== e.pointerId) return;
      this.drag = null;
      if (dom.hasPointerCapture?.(e.pointerId)) dom.releasePointerCapture(e.pointerId);
    };
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', up);
    // the middle button's autoscroll would steal the drag
    dom.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
  }

  set enabled(v: boolean) {
    this.on = v;
    if (!v) { this.drag = null; this.keys.clear(); }
  }
  get enabled(): boolean { return this.on; }

  keyDown(code: string) {
    if (!commandKey(code)) return;
    const fresh = !this.keys.has(code);
    this.keys.add(code);
    // a held key turns once; OS repeats arrive while it is still held
    if (fresh && (code === 'KeyQ' || code === 'KeyE')) this.rotate(code === 'KeyQ' ? -1 : 1);
  }
  keyUp(code: string) { this.keys.delete(code); }
  clearKeys() { this.keys.clear(); }

  /** Turn the view one 90° step (−1 or +1), eased; presses queue. */
  rotate(dir: -1 | 1) {
    this.step += dir;
    this.turn = { from: this.yaw, to: YAW0 + this.step * 90 * DEG, t: 0 };
  }

  /** Step the zoom by `d` levels (clamped), eased. */
  zoom(d: number) {
    this.level = Math.min(ISO_LEVELS.length - 1, Math.max(0, this.level + d));
  }

  home(x: number, y: number, z: number) {
    this.glide = null;
    this.turn = null;
    this.step = 0;
    this.yaw = YAW0;
    this.level = ISO_HOME_LEVEL;
    this.dist = ISO_LEVELS[ISO_HOME_LEVEL];
    this.target.set(x, y, z);
    this.clampTarget();
    this.place();
  }

  focus(x: number, y: number, z: number, _dist: number, exact = false) {
    this.glide = { t: 0, from: this.target.clone(), to: new THREE.Vector3(x, y, z) };
    this.level = exact ? ISO_HOME_LEVEL : Math.min(this.level, FOCUS_LEVEL);
  }

  /** Debug views: the target exactly; the yaw step and zoom level nearest
   *  the given camera position (the pitch is the view's own). */
  view(pos: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }) {
    this.glide = null;
    this.turn = null;
    this.target.set(target.x, target.y, target.z);
    const az = Math.atan2(pos.z - target.z, pos.x - target.x);
    this.step = Math.round((az - YAW0) / (90 * DEG));
    this.yaw = YAW0 + this.step * 90 * DEG;
    const d = Math.hypot(pos.x - target.x, pos.y - target.y, pos.z - target.z);
    let best = 0;
    ISO_LEVELS.forEach((l, i) => { if (Math.abs(Math.log(l / d)) < Math.abs(Math.log(ISO_LEVELS[best] / d))) best = i; });
    this.level = best;
    this.dist = ISO_LEVELS[best];
    this.clampTarget();
    this.place();
  }

  private clampTarget() {
    const lim = MAP_M / 2 - MARGIN;
    this.target.x = Math.min(lim, Math.max(-lim, this.target.x));
    this.target.z = Math.min(lim, Math.max(-lim, this.target.z));
  }

  /** Metres of ground per screen pixel at the target, across the view. */
  private metresPerPx(): number {
    const h = this.dom.clientHeight || window.innerHeight;
    return (2 * this.dist * Math.tan((ISO_FOV / 2) * DEG)) / h;
  }

  /** Ground axes of the view: forward (away from the camera) and right. */
  private axes() {
    this.fwd.set(-Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.right.crossVectors(this.fwd, UP);
  }

  private onWheel(e: WheelEvent) {
    if (!this.on) return;
    e.preventDefault();
    const now = performance.now();
    if (now - this.wheelAt > 250) this.wheelAcc = 0;
    this.wheelAt = now;
    // a mouse notch is ~100 (one step); a trackpad's trickle adds up
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    if (Math.abs(dy) >= WHEEL_STEP) { this.wheelAcc = 0; this.zoom(Math.sign(dy)); return; }
    this.wheelAcc += dy;
    if (Math.abs(this.wheelAcc) >= WHEEL_STEP) {
      this.zoom(Math.sign(this.wheelAcc));
      this.wheelAcc = 0;
    }
  }

  private onDown(e: PointerEvent) {
    if (!this.on || (e.button !== 1 && e.button !== 2)) return;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    this.glide = null;
    try { this.dom.setPointerCapture(e.pointerId); } catch { /* fine without */ }
  }

  private onMove(e: PointerEvent) {
    const d = this.drag;
    if (!this.on || !d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX; d.y = e.clientY;
    // the ground under the pointer follows it
    const m = this.metresPerPx();
    this.axes();
    this.target.addScaledVector(this.right, -dx * m).addScaledVector(this.fwd, (dy * m) / Math.sin(ISO_PITCH_DEG * DEG));
    this.clampTarget();
  }

  update(dt: number) {
    const t = this.target;
    if (this.glide) {
      const g = this.glide;
      g.t = Math.min(1, g.t + dt / GLIDE_S);
      t.lerpVectors(g.from, g.to, 1 - (1 - g.t) ** 3);
      if (g.t >= 1) this.glide = null;
    }
    let fwd = 0, strafe = 0;
    for (const code of this.keys) {
      const k = PAN_KEYS[code];
      if (k) { strafe += k[0]; fwd += k[1]; }
    }
    if (fwd || strafe) {
      this.glide = null;
      this.axes();
      const step = (PAN_RATE * 2 * this.dist * Math.tan((ISO_FOV / 2) * DEG) * dt) / Math.hypot(fwd, strafe);
      t.addScaledVector(this.fwd, fwd * step).addScaledVector(this.right, strafe * step);
    }
    if (this.turn) {
      const r = this.turn;
      r.t = Math.min(1, r.t + dt / TURN_S);
      this.yaw = r.from + (r.to - r.from) * easeInOut(r.t);
      if (r.t >= 1) this.turn = null;
    }
    const want = ISO_LEVELS[this.level];
    this.dist = Math.exp(Math.log(want) + (Math.log(this.dist) - Math.log(want)) * Math.exp(-ZOOM_RATE * dt));
    if (Math.abs(this.dist - want) < 0.01) this.dist = want;
    // ride the terrain
    t.y += (this.groundAt(t.x, t.z) - t.y) * (1 - Math.exp(-FOLLOW_RATE * dt));
    this.clampTarget();
    this.place();
  }

  /** Put the camera on its arm from the target, over the ground. */
  private place() {
    const cam = this.camera.position, t = this.target;
    const p = ISO_PITCH_DEG * DEG, d = this.dist;
    cam.set(t.x + Math.cos(this.yaw) * Math.cos(p) * d, t.y + Math.sin(p) * d, t.z + Math.sin(this.yaw) * Math.cos(p) * d);
    let floor = this.groundAt(cam.x, cam.z);
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) floor = Math.max(floor, this.groundAt(cam.x + dx, cam.z + dz));
    if (cam.y < floor + CLEARANCE) cam.y = floor + CLEARANCE;
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(t);
    const near = Math.max(1, 0.2 * d), far = 6 * d + 800;
    if (Math.abs(this.camera.near - near) > 0.01 || Math.abs(this.camera.far - far) > 0.1) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Target → camera distance now (eased toward the zoom level's). */
  get distance(): number { return this.dist; }

  get clearance(): number {
    const cam = this.camera.position;
    return cam.y - this.groundAt(cam.x, cam.z);
  }

  /** The view's state (tests, probes). */
  info() {
    const yawDeg = (this.yaw / DEG) % 360;
    return {
      yawStep: this.step, yawDeg: yawDeg < 0 ? yawDeg + 360 : yawDeg, turning: this.turn !== null,
      level: this.level, levels: [...ISO_LEVELS], dist: this.dist, pitchDeg: ISO_PITCH_DEG, fov: ISO_FOV,
    };
  }
}
