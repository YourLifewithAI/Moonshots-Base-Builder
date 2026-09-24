/** The lunar lighting rig: one hard white sun (long shadows, black sky) + a
 *  faint blue earthshine hemisphere — the only color in the entire scene —
 *  whose ground half carries the neutral bounce off sunlit regolith. The
 *  sky itself (stars, sun disc, Earth) lives in world/sky.ts.
 *
 *  Sun shadows: one 2048² ortho map fitted to the ground the camera can see
 *  and snapped to whole texels, re-rendered only when something changed (the
 *  sun turned a step, the view left the window, casters rebuilt) and at most
 *  every MIN_RENDER_S — never at night.
 *
 *  Walk mode adds the suit's headlamp: a SpotLight riding on the camera. It
 *  never leaves the scene (a light joining or leaving recompiles every lit
 *  program); it simply sits at intensity 0 except on foot at night. */
import * as THREE from 'three';

const WORK_LIGHTS = 8; // stock-path floods over the buildings nearest the camera
const HEADLAMP = 16;    // cd at full night
// Earthshine by day is a whisper under the sun; at night the eye adapts to
// it. The landscape gets its own floor on top (world/floodlights.ts).
const EARTHSHINE_DAY = 0.3;
const EARTHSHINE_NIGHT = 1.0;

export const SUN_INTENSITY = 5.4;
const SHADOW_MAP = 2048;
const SUN_DIST = 900;           // light sits this far sunward of the shadow window
const SHADOW_MARGIN = 6;        // m of slack around the fitted ground…
const MARGIN_FRAC = 0.03;       // …or this share of its extent, if more (pans stay inside longer)
const RECEIVER_H = 20;          // m: walls and roofs above the fitted ground still receive
const SHADOW_MIN = 48, SHADOW_MAX = 1600;
const SUN_STEP_RAD = 0.1 * Math.PI / 180; // re-render once the sun turns 0.1° (up to 3×)
const MIN_RENDER_S = 0.1;       // real seconds between shadow renders, whatever asks
const FAR_SLACK = 60;           // m of depth past the lowest receiver at the last render
const BIAS_M = 0.04;            // depth bias in metres (back faces fill the map)
const BOUNCE = 0.6;             // fraction of the ground's exitance reaching shaded walls
const UP = new THREE.Vector3(0, 1, 0);
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;

/** The sun turn (as a cosine) that re-renders the map and re-aims the solar
 *  wings: 0.1° up to 3× speed, growing with speed past that — so the sweep
 *  costs about as many shadow renders a second at 10× as at 3×. */
export function sunStep(speed: number): number {
  return Math.cos(SUN_STEP_RAD * Math.max(1, speed / 3));
}

/** The ground in view, in the light-space basis of one sun direction. */
interface ViewBox { minX: number; maxX: number; minY: number; maxY: number; minZ: number }

/** Window size along one axis for extent `w`: margin, clamp, 9% steps —
 *  holding `prev` while it still fits and is not much too big, so a
 *  panning camera doesn't flip between sizes every frame. */
function windowSize(w: number, prev: number): number {
  w = Math.min(SHADOW_MAX, Math.max(SHADOW_MIN, w + 2 * Math.max(SHADOW_MARGIN, MARGIN_FRAC * w)));
  if (w <= prev && w > prev * 0.8) return prev;
  return 2 ** (Math.ceil(Math.log2(w) * 8) / 8);
}

export class Lighting {
  readonly sun: THREE.DirectionalLight;
  readonly earthshine: THREE.HemisphereLight;
  readonly headlamp: THREE.SpotLight;
  private workLights: THREE.PointLight[] = [];
  /** regolith albedo under the base (drives the bounce light) */
  groundAlbedo = 0.3;

  private sunDir = new THREE.Vector3(0, 1, 0);
  private shadowDirty = true;
  private shadowDir = new THREE.Vector3();
  /** the window at the last render: centre and size in its light basis, and
   *  the depth (along the light) its far plane reaches */
  private win = { cx: NaN, cy: NaN, sx: 0, sy: 0, zFar: 0 };
  private sinceRender = Infinity;
  /** shadow-map renders requested so far (probes) */
  shadowRenders = 0;
  private bx = new THREE.Vector3();
  private by = new THREE.Vector3();
  private v = new THREE.Vector3();
  private p = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    // exterior work lights: warm point lights that carry the base at night
    for (let i = 0; i < WORK_LIGHTS; i++) {
      const l = new THREE.PointLight(0xffe8c4, 0, 30, 1.8);
      l.castShadow = false;
      scene.add(l);
      this.workLights.push(l);
    }
    scene.background = new THREE.Color(0x000000);

    this.sun = new THREE.DirectionalLight(0xfffdf8, SUN_INTENSITY);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    this.sun.shadow.autoUpdate = false;
    this.sun.shadow.radius = 1;
    this.sun.shadow.camera.near = 10;
    scene.add(this.sun, this.sun.target);

    this.earthshine = new THREE.HemisphereLight(0x2a3a55, 0x000000, 0.42);
    scene.add(this.earthshine);

    // helmet-mounted, a hand above the eye, aimed a little below the gaze
    this.headlamp = new THREE.SpotLight(0xfff6ea, 0, 40, 0.52, 0.6, 2);
    this.headlamp.castShadow = false;
    this.headlamp.position.set(0, 0.12, 0);
    this.headlamp.target.position.set(0, -0.3, -1);
  }

  /** Parent the headlamp to the camera (which then joins the scene). */
  attachHeadlamp(scene: THREE.Scene, camera: THREE.Camera) {
    camera.add(this.headlamp, this.headlamp.target);
    scene.add(camera);
  }

  /** On foot: `night` 0..1 drives the lamp; 0 switches it off. */
  setHeadlamp(night: number) {
    const k = Math.min(1, Math.max(0, (night - 0.25) / 0.5));
    this.headlamp.intensity = HEADLAMP * k * k * (3 - 2 * k);
  }

  /** Point the sun from (elevation, azimuth) radians; called per frame. */
  setSun(elev: number, azim: number, nightFactor = 0) {
    this.sunDir.set(
      Math.cos(azim) * Math.cos(elev),
      Math.max(Math.sin(elev), -0.09),
      Math.sin(azim) * Math.cos(elev),
    ).normalize();
    // dusk: fade the sun as it sinks. Night is claustrophobic by design —
    // earthshine is only a dim floor; the base's own light pools carry it.
    const t = Math.min(1, Math.max(0, (elev + 0.03) / 0.1));
    this.sun.intensity = SUN_INTENSITY * t;
    this.earthshine.intensity = EARTHSHINE_DAY + (EARTHSHINE_NIGHT - EARTHSHINE_DAY) * nightFactor;
    // sunlit regolith lights whatever faces it — shaded walls, undersides —
    // with neutral gray, never blue; gone once the sun is
    const exitance = this.sun.intensity * Math.max(0, Math.sin(elev)) * this.groundAlbedo;
    this.earthshine.groundColor.setScalar(BOUNCE * exitance / Math.max(this.earthshine.intensity, 1e-3));
  }

  /** The sun's light as a fraction of full (0 once it has set). */
  get sunLight(): number { return this.sun.intensity / SUN_INTENSITY; }

  /** Unit vector toward the sun (read-only). */
  get sunDirection(): THREE.Vector3 { return this.sunDir; }

  /** Later shadow casters that move (rovers, sun-tracking panels, …) call
   *  this to get the map re-rendered on the next frame. */
  requestShadowUpdate() { this.shadowDirty = true; }

  /** The light-space basis of sun direction `L` into bx, by. */
  private basis(L: THREE.Vector3) {
    const bx = this.bx.crossVectors(UP, L);
    if (bx.lengthSq() < 1e-8) bx.set(1, 0, 0);
    bx.normalize();
    this.by.crossVectors(L, bx);
  }

  /** The ground visible from `camera` (view rays clamped to `reach` m,
   *  intersected with the plane through `focus`, padded for receivers) in
   *  the basis of `L` (call basis(L) first). */
  private viewBox(camera: THREE.PerspectiveCamera, focus: THREE.Vector3, reach: number, L: THREE.Vector3): ViewBox {
    const bx = this.bx, by = this.by;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity;
    const add = (q: THREE.Vector3) => {
      const x = q.dot(bx), y = q.dot(by), z = q.dot(L);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
    };
    const addColumn = (q: THREE.Vector3) => { add(q); q.y += RECEIVER_H; add(q); };
    const o = camera.position;
    for (const [nx, ny] of CORNERS) {
      const dir = this.v.set(nx, ny, 0.5).unproject(camera).sub(o).normalize();
      let t = reach;
      if (dir.y < -1e-4) t = Math.min(t, Math.max(0, (focus.y - o.y) / dir.y));
      // rays that miss the ground (sky) still bound the ground beneath them
      this.p.copy(o).addScaledVector(dir, t).y = focus.y;
      addColumn(this.p);
    }
    // a camera standing among the receivers (walk mode) sees walls at its feet
    if (o.y - focus.y < RECEIVER_H) addColumn(this.p.set(o.x, focus.y, o.z));
    add(focus);
    return { minX, maxX, minY, maxY, minZ };
  }

  /** Does the last render's window still cover `b` (same basis), at the
   *  size a fresh fit would pick? */
  private covers(b: ViewBox): boolean {
    const w = this.win;
    if (windowSize(b.maxX - b.minX, w.sx) !== w.sx || windowSize(b.maxY - b.minY, w.sy) !== w.sy) return false;
    return b.minX >= w.cx - w.sx / 2 && b.maxX <= w.cx + w.sx / 2
      && b.minY >= w.cy - w.sy / 2 && b.maxY <= w.cy + w.sy / 2 && b.minZ >= w.zFar + 10;
  }

  /** Fit the shadow window to the ground visible from `camera`, snap it to
   *  texels, and flag a shadow render if anything changed: the sun turned by
   *  `step` (a cosine, see sunStep), the view left the window, or casters
   *  changed — at most once per MIN_RENDER_S of real time (`dt` s since the
   *  last call). */
  fitShadow(camera: THREE.PerspectiveCamera, focus: THREE.Vector3, reach: number, dt = 0,
    step = sunStep(1)) {
    const shadow = this.sun.shadow;
    this.sinceRender += dt;
    if (this.sun.intensity <= 0) { shadow.needsUpdate = false; return; }
    const L = this.sunDir;
    const first = !Number.isFinite(this.win.cx);
    const turned = first || L.dot(this.shadowDir) < step;
    if (!turned && !this.shadowDirty) {
      // the map stands while the view stays inside the window it was drawn for
      this.basis(this.shadowDir);
      if (this.covers(this.viewBox(camera, focus, reach, this.shadowDir))) return;
    }
    if (!first && this.sinceRender < MIN_RENDER_S) return;

    this.basis(L);
    const bx = this.bx, by = this.by;
    const { minX, maxX, minY, maxY, minZ } = this.viewBox(camera, focus, reach, L);
    const sx = windowSize(maxX - minX, this.win.sx);
    const sy = windowSize(maxY - minY, this.win.sy);
    const tx = sx / SHADOW_MAP, ty = sy / SHADOW_MAP;
    const cx = Math.round((minX + maxX) / 2 / tx) * tx;
    const cy = Math.round((minY + maxY) / 2 / ty) * ty;

    const zRef = focus.dot(L);
    const anchor = this.v.copy(bx).multiplyScalar(cx).addScaledVector(by, cy).addScaledVector(L, zRef);
    this.sun.target.position.copy(anchor);
    this.sun.position.copy(anchor).addScaledVector(L, SUN_DIST);
    this.sun.updateMatrixWorld();
    this.sun.target.updateMatrixWorld();
    const cam = shadow.camera;
    cam.left = -sx / 2; cam.right = sx / 2;
    cam.bottom = -sy / 2; cam.top = sy / 2;
    cam.far = SUN_DIST + Math.max(0, zRef - minZ) + FAR_SLACK;
    cam.updateProjectionMatrix();
    shadow.bias = -BIAS_M / (cam.far - cam.near);
    shadow.normalBias = 0.5 * Math.max(tx, ty);
    shadow.needsUpdate = true;

    this.win = { cx, cy, sx, sy, zFar: Math.min(zRef, minZ) - FAR_SLACK };
    this.shadowDir.copy(L);
    this.shadowDirty = false;
    this.sinceRender = 0;
    this.shadowRenders++;
  }

  /** Current shadow texel size in metres (x, y) — probes and tests. */
  get shadowTexel(): [number, number] {
    return [this.win.sx / SHADOW_MAP, this.win.sy / SHADOW_MAP];
  }

  /** The PointLights are the stock path only: while the shader floods run
   *  they leave the scene's light count (a recompile, so only on a switch). */
  useWorkLights(on: boolean) {
    if (this.workLights[0].visible === on) return;
    for (const l of this.workLights) l.visible = on;
  }

  /** Park the work lights above the given building positions (nearest-first).
   *  Settlers need to see the Moon around them — each structure lights its
   *  own patch of regolith. */
  setWorkLights(points: { x: number; y: number; z: number }[], nightFactor: number) {
    for (let i = 0; i < this.workLights.length; i++) {
      const l = this.workLights[i];
      const p = points[i];
      if (!p || nightFactor < 0.03) { l.intensity = 0; continue; }
      l.position.set(p.x, p.y + 8, p.z);
      l.intensity = 60 * nightFactor;
    }
  }
}
