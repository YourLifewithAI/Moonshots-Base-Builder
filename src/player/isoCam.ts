/** The command view: a fixed isometric camera in the SimCity 2000/3000
 *  manner. A near-orthographic perspective (a 20° lens) at one of two fixed
 *  tilts, so picking, screenOf and the overlays work unchanged:
 *
 *   - yaw at 45° + k·90°; Q/E turn one step with a short eased tween
 *     (presses queue: two quick taps turn 180°);
 *   - V flips the tilt between the low view (32°, the framing the game has
 *     always had) and the high one (55°), eased over the same 0.35 s;
 *   - the wheel zooms continuously (a mouse notch is about the old level
 *     step), eased, clamped to the near and far levels;
 *   - W A S D / arrows pan at a rate scaled by the view's size; right- or
 *     middle-drag pans, the ground following the pointer (the left button
 *     stays select / place / target);
 *   - F glides to the selection (closing to the near level), H glides home
 *     to the Lander at the home level;
 *   - the target rides the terrain and stays inside the map; the camera
 *     never sits below its clearance over the ground; the clip planes track
 *     the zoom (near-to-far ratio ~30 — plenty of depth precision for the
 *     ground decals).
 *
 *  The camera never looks above the horizon (the top of the frame is 22°
 *  below it at the low tilt, 45° at the high one).
 *
 *  The preset (yaw step, tilt, distance) is what a save keeps (`preset()` /
 *  `setPreset()`; SaveBlob.camera).
 *
 *  Touch (player/touch.ts): one finger drags the ground (panPx), a pinch
 *  zooms freely and stays where the fingers leave it, a twist past ~40°
 *  turns one step, and the ⟲ ⟳ ▱ buttons turn and tilt. */
import * as THREE from 'three';
import { MAP_M } from '../data/balance';

const DEG = Math.PI / 180;
export const ISO_FOV = 20;
/** the two tilts (degrees above the horizon): low is today's framing, high
 *  shows more of the ground and less of the sky */
export const ISO_TILTS_DEG = [32, 55] as const;
/** the low tilt (kept for readers of the old constant) */
export const ISO_PITCH_DEG = ISO_TILTS_DEG[0];
/** target → camera distances (m); home framing ≈ 107 m of ground across a 16:9 view.
 *  The near and far ends clamp the zoom; the home level is where H and a new
 *  view stand and the near one is where F closes to. */
export const ISO_LEVELS = [100, 170, 290, 490, 830] as const;
export const ISO_HOME_LEVEL = 1;
export const ISO_MIN_DIST = ISO_LEVELS[0];
export const ISO_MAX_DIST = ISO_LEVELS[ISO_LEVELS.length - 1];
const FOCUS_LEVEL = 0;
const YAW0 = 45 * DEG;
const TURN_S = 0.35;
const TILT_S = 0.35;
const ZOOM_RATE = 9;        // 1/s, in log distance
const GLIDE_S = 0.6;
const PAN_RATE = 1.1;       // view heights per second
const FOLLOW_RATE = 5;      // 1/s: the target easing onto the ground
const CLEARANCE = 4;        // m over the highest ground under the camera
/** ln-distance per unit of wheel deltaY: a 100 notch is one old level step (×1.7) */
const WHEEL_LN = Math.log(1.7) / 100;
const WHEEL_MAX = 300;      // one wheel event moves the zoom by at most this much deltaY
const MARGIN = 40;          // m: the target stays this far inside the map
const TWIST_STEP = 0.7;     // rad of two-finger twist that turns the view one step
const PAN_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};
const UP = new THREE.Vector3(0, 1, 0);

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clampDist = (d: number) => Math.min(ISO_MAX_DIST, Math.max(ISO_MIN_DIST, d));
/** the index of the level nearest a distance (in log terms) */
const nearestLevel = (d: number) => {
  let best = 0;
  ISO_LEVELS.forEach((l, i) => { if (Math.abs(Math.log(l / d)) < Math.abs(Math.log(ISO_LEVELS[best] / d))) best = i; });
  return best;
};

/** The view a save keeps: the yaw step (the view looks from 45° + step·90°),
 *  the tilt (0 low, 1 high) and the target → camera distance (m). */
export interface CameraPreset {
  step: number;
  tilt: number;
  dist: number;
}

/** What the game and the mode manager need from a command-view camera:
 *  the classic isometric one (this file) or the free one (buildCam.ts). */
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
  /** place the view exactly (debug views; the isometric view keeps its tilt) */
  view(pos: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }): void;
  update(dt: number): void;
  /** metres from the camera down to the ground beneath it */
  readonly clearance: number;
  // ── touch (player/touch.ts) ──
  /** drag the ground by a screen delta (CSS px); `stopGlide`: take over from a glide */
  panPx(dx: number, dy: number, stopGlide?: boolean): void;
  /** a pinch: 'start' holds the zoom, 'move' scales it by the finger spread
   *  (÷ its start), 'end' lets go (the isometric view keeps the zoom, inside its clamps) */
  pinch(phase: 'start' | 'move' | 'end', scale?: number): void;
  /** a two-finger twist by `rad` (screen angle, clockwise +) since the last call */
  twist(rad: number): void;
  twistReset(): void;
  /** ⟲ ⟳: one step round the target (−1 or +1) */
  turnStep(dir: -1 | 1): void;
  // ── the isometric view only ──
  /** V, ▱: flip between the low and the high tilt */
  tiltStep?(): void;
  /** the view a save keeps, and putting it back */
  preset?(): CameraPreset;
  setPreset?(p: Partial<CameraPreset>): void;
}

/** Keys a command camera consumes (the command view only): pan, turn (Q/E), tilt (V). */
export function commandKey(code: string): boolean {
  return code in PAN_KEYS || code === 'KeyQ' || code === 'KeyE' || code === 'KeyV';
}

export class IsoCam implements CommandCam {
  readonly target = new THREE.Vector3();
  groundAt: (x: number, z: number) => number = () => 0;
  private on = true;
  private keys = new Set<string>();
  /** yaw step k (the view looks from 45° + k·90°) and the eased yaw */
  private step = 0;
  private yaw = YAW0;
  private turn: { from: number; to: number; t: number } | null = null;
  /** the tilt asked for (an index into ISO_TILTS_DEG) and the eased pitch (degrees) */
  private tilt = 0;
  private pitchDeg: number = ISO_TILTS_DEG[0];
  private tiltTw: { from: number; to: number; t: number } | null = null;
  /** the zoom asked for and the eased distance (m), both continuous */
  private want: number = ISO_LEVELS[ISO_HOME_LEVEL];
  private dist: number = ISO_LEVELS[ISO_HOME_LEVEL];
  private glide: { t: number; from: THREE.Vector3; to: THREE.Vector3 } | null = null;
  private drag: { id: number; x: number; y: number } | null = null;
  /** a pinch in progress: the distance it started from (null = none) */
  private pinch0: number | null = null;
  private twistAcc = 0;
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
    if (!v) { this.drag = null; this.keys.clear(); this.pinch0 = null; }
  }
  get enabled(): boolean { return this.on; }

  keyDown(code: string) {
    if (!commandKey(code)) return;
    const fresh = !this.keys.has(code);
    this.keys.add(code);
    // a held key acts once; OS repeats arrive while it is still held
    if (!fresh) return;
    if (code === 'KeyQ' || code === 'KeyE') this.rotate(code === 'KeyQ' ? -1 : 1);
    else if (code === 'KeyV') this.tiltStep();
  }
  keyUp(code: string) { this.keys.delete(code); }
  clearKeys() { this.keys.clear(); }

  /** Turn the view one 90° step (−1 or +1), eased; presses queue. */
  rotate(dir: -1 | 1) {
    this.step += dir;
    this.turn = { from: this.yaw, to: YAW0 + this.step * 90 * DEG, t: 0 };
  }

  /** Flip between the low and the high tilt, eased. */
  tiltStep() {
    this.setTilt(this.tilt === 0 ? 1 : 0);
  }

  /** Tilt to the low (0) or high (1) view, eased from wherever the pitch is now. */
  setTilt(i: number) {
    this.tilt = i >= 1 ? 1 : 0;
    this.tiltTw = { from: this.pitchDeg, to: ISO_TILTS_DEG[this.tilt], t: 0 };
  }

  /** Zoom by `d` old level steps (a notch is one; clamped), eased. */
  zoom(d: number) {
    this.zoomBy(Math.log(1.7) * d);
  }

  /** Zoom by a log-distance (positive is farther), eased and clamped. */
  private zoomBy(ln: number) {
    this.want = clampDist(this.want * Math.exp(ln));
  }

  home(x: number, y: number, z: number) {
    this.glide = null;
    this.turn = null;
    this.step = 0;
    this.yaw = YAW0;
    this.tilt = 0;
    this.tiltTw = null;
    this.pitchDeg = ISO_TILTS_DEG[0];
    this.want = this.dist = ISO_LEVELS[ISO_HOME_LEVEL];
    this.target.set(x, y, z);
    this.clampTarget();
    this.place();
  }

  focus(x: number, y: number, z: number, _dist: number, exact = false) {
    this.glide = { t: 0, from: this.target.clone(), to: new THREE.Vector3(x, y, z) };
    this.want = exact ? ISO_LEVELS[ISO_HOME_LEVEL] : Math.min(this.want, ISO_LEVELS[FOCUS_LEVEL]);
  }

  /** Debug views: the target exactly; the yaw step and zoom level nearest the
   *  given camera position (the tilt is the view's own). */
  view(pos: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }) {
    this.glide = null;
    this.turn = null;
    this.target.set(target.x, target.y, target.z);
    const az = Math.atan2(pos.z - target.z, pos.x - target.x);
    this.step = Math.round((az - YAW0) / (90 * DEG));
    this.yaw = YAW0 + this.step * 90 * DEG;
    const d = Math.hypot(pos.x - target.x, pos.y - target.y, pos.z - target.z);
    this.want = this.dist = ISO_LEVELS[nearestLevel(d)];
    this.clampTarget();
    this.place();
  }

  /** The view a save keeps. */
  preset(): CameraPreset {
    return { step: this.step, tilt: this.tilt, dist: Math.round(this.want * 10) / 10 };
  }

  /** Put a saved view back, instantly (a field that is missing or unreadable
   *  keeps its current value); the target stays where it is. */
  setPreset(p: Partial<CameraPreset>) {
    this.glide = null;
    this.turn = null;
    this.tiltTw = null;
    if (Number.isFinite(p.step)) {
      this.step = Math.round(p.step as number);
      this.yaw = YAW0 + this.step * 90 * DEG;
    }
    if (Number.isFinite(p.tilt)) {
      this.tilt = (p.tilt as number) >= 1 ? 1 : 0;
      this.pitchDeg = ISO_TILTS_DEG[this.tilt];
    }
    if (Number.isFinite(p.dist)) this.want = this.dist = clampDist(p.dist as number);
    this.place();
  }

  private clampTarget() {
    const lim = MAP_M / 2 - MARGIN;
    this.target.x = Math.min(lim, Math.max(-lim, this.target.x));
    this.target.z = Math.min(lim, Math.max(-lim, this.target.z));
  }

  /** Metres of ground per screen pixel at the target, across the view
   *  (horizontal, so the tilt does not enter; up the screen it is ÷ sin(pitch)). */
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
    // a mouse notch is ~100 (one old level step); a trackpad's trickle adds up
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    this.zoomBy(Math.max(-WHEEL_MAX, Math.min(WHEEL_MAX, dy)) * WHEEL_LN);
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
    this.panPx(dx, dy);
  }

  /** Drag the ground by a screen delta (CSS px): the ground under the
   *  pointer follows it. `stopGlide`: a touch drag takes over from an F/H glide. */
  panPx(dx: number, dy: number, stopGlide = false) {
    if (!this.on) return;
    if (stopGlide) this.glide = null;
    const m = this.metresPerPx();
    this.axes();
    this.target.addScaledVector(this.right, -dx * m).addScaledVector(this.fwd, (dy * m) / Math.sin(this.pitchDeg * DEG));
    this.clampTarget();
  }

  /** A pinch: 'start' holds the distance, 'move' scales it by the finger
   *  spread (÷ its start) — a little past the clamps while the fingers are
   *  down — and 'end' lets go: the zoom stays where it is, eased back inside
   *  the clamps if the fingers went past them. */
  pinch(phase: 'start' | 'move' | 'end', scale = 1) {
    if (!this.on) { this.pinch0 = null; return; }
    if (phase === 'start') { this.pinch0 = this.dist; this.glide = null; return; }
    if (this.pinch0 === null) return;
    if (phase === 'move') {
      const lo = ISO_MIN_DIST * 0.85, hi = ISO_MAX_DIST * 1.15;
      this.dist = Math.min(hi, Math.max(lo, this.pinch0 / Math.max(0.05, scale)));
      this.want = clampDist(this.dist);
      return;
    }
    this.pinch0 = null;
  }

  /** A two-finger twist by `rad` (screen angle, clockwise +) since the last
   *  call: past the threshold the view turns one step with the fingers. */
  twist(rad: number) {
    if (!this.on) return;
    this.twistAcc += rad;
    if (Math.abs(this.twistAcc) >= TWIST_STEP) {
      this.rotate(this.twistAcc > 0 ? -1 : 1);
      this.twistAcc = 0;
    }
  }

  /** a twist gesture began or ended: its turn starts from nothing */
  twistReset() { this.twistAcc = 0; }

  /** ⟲ ⟳ buttons: one 90° step (−1 turns the ground clockwise on screen, as Q). */
  turnStep(dir: -1 | 1) { this.rotate(dir); }

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
      // the view covers less ground up the screen at the high tilt: forward
      // keys keep their pace in screen terms (the low tilt's is the reference)
      const ahead = Math.sin(ISO_TILTS_DEG[0] * DEG) / Math.sin(this.pitchDeg * DEG);
      t.addScaledVector(this.fwd, fwd * step * ahead).addScaledVector(this.right, strafe * step);
    }
    if (this.turn) {
      const r = this.turn;
      r.t = Math.min(1, r.t + dt / TURN_S);
      this.yaw = r.from + (r.to - r.from) * easeInOut(r.t);
      if (r.t >= 1) this.turn = null;
    }
    if (this.tiltTw) {
      const r = this.tiltTw;
      r.t = Math.min(1, r.t + dt / TILT_S);
      this.pitchDeg = r.t >= 1 ? r.to : r.from + (r.to - r.from) * easeInOut(r.t);
      if (r.t >= 1) this.tiltTw = null;
    }
    // a pinch holds the distance where the fingers put it
    if (this.pinch0 === null) {
      const want = this.want;
      this.dist = Math.exp(Math.log(want) + (Math.log(this.dist) - Math.log(want)) * Math.exp(-ZOOM_RATE * dt));
      if (Math.abs(this.dist - want) < 0.01) this.dist = want;
    }
    // ride the terrain
    t.y += (this.groundAt(t.x, t.z) - t.y) * (1 - Math.exp(-FOLLOW_RATE * dt));
    this.clampTarget();
    this.place();
  }

  /** Put the camera on its arm from the target, over the ground. */
  private place() {
    const cam = this.camera.position, t = this.target;
    const p = this.pitchDeg * DEG, d = this.dist;
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

  /** Target → camera distance now (eased toward the zoom asked for). */
  get distance(): number { return this.dist; }

  get clearance(): number {
    const cam = this.camera.position;
    return cam.y - this.groundAt(cam.x, cam.z);
  }

  /** The view's state (tests, probes).
   *  `rot` (0–3), `tilt` (0 low, 1 high; the one asked for) and `zoom` (the
   *  distance, m; `zoomTo` the one it is easing toward) are the names
   *  getRenderInfo().camera reports. `yawStep`
   *  (unwrapped), `pitchDeg` (eased), `level` (the nearest of `levels`),
   *  `levels` and `dist` are the older names, kept as aliases. */
  info() {
    const yawDeg = (this.yaw / DEG) % 360;
    return {
      rot: ((this.step % 4) + 4) % 4, tilt: this.tilt, zoom: this.dist, zoomTo: this.want,
      yawStep: this.step, yawDeg: yawDeg < 0 ? yawDeg + 360 : yawDeg, turning: this.turn !== null,
      tilting: this.tiltTw !== null,
      level: nearestLevel(this.dist), levels: [...ISO_LEVELS], dist: this.dist, pitchDeg: this.pitchDeg, fov: ISO_FOV,
      pinching: this.pinch0 !== null,
    };
  }
}
