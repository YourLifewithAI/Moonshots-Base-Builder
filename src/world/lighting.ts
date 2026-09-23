/** The lunar lighting rig: one hard white sun (long shadows, black sky) + a
 *  faint blue earthshine hemisphere — the only color in the entire scene —
 *  whose ground half carries the neutral bounce off sunlit regolith, plus a
 *  procedural starfield and a small Earth disc.
 *
 *  Sun shadows: one 2048² ortho map fitted each frame to the ground the camera
 *  can see and snapped to whole texels, re-rendered only when something
 *  changed (sun moved, window moved, casters rebuilt) — never at night. */
import * as THREE from 'three';
import { mulberry32 } from '../core/rng';

const WORK_LIGHTS = 8; // exterior floods over the buildings nearest the camera

export const SUN_INTENSITY = 5.4;
const SHADOW_MAP = 2048;
const SUN_DIST = 900;           // light sits this far sunward of the shadow window
const SHADOW_MARGIN = 6;        // m of slack around the fitted ground
const RECEIVER_H = 20;          // m: walls and roofs above the fitted ground still receive
const SHADOW_MIN = 48, SHADOW_MAX = 1600;
const SUN_STEP = Math.cos(0.1 * Math.PI / 180); // re-render once the sun turns 0.1°
const BIAS_M = 0.04;            // depth bias in metres (back faces fill the map)
const BOUNCE = 0.6;             // fraction of the ground's exitance reaching shaded walls
const UP = new THREE.Vector3(0, 1, 0);
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;

export class Lighting {
  readonly sun: THREE.DirectionalLight;
  readonly earthshine: THREE.HemisphereLight;
  readonly stars: THREE.Points;
  readonly earth: THREE.Mesh;
  private workLights: THREE.PointLight[] = [];
  /** regolith albedo under the base (drives the bounce light) */
  groundAlbedo = 0.3;

  private sunDir = new THREE.Vector3(0, 1, 0);
  private shadowDirty = true;
  private shadowDir = new THREE.Vector3();
  private win = { cx: NaN, cy: NaN, sx: 0, sy: 0 };
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

    // starfield: 1800 points on a far sphere
    const rng = mulberry32(0x57a25);
    const starCount = 1800;
    const pos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const u = rng() * 2 - 1;
      const th = rng() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos[i * 3] = r * Math.cos(th) * 3200;
      pos[i * 3 + 1] = Math.abs(u) * 3200 + 60; // keep stars above horizon
      pos[i * 3 + 2] = r * Math.sin(th) * 3200;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0xd7dbe0, size: 2.2, sizeAttenuation: false, fog: false }),
    );
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    // Earth: a small pale-blue disc hanging in the black — home, far away
    this.earth = new THREE.Mesh(
      new THREE.SphereGeometry(48, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0x8fa8c8 }),
    );
    this.earth.position.set(-1400, 950, -2200);
    scene.add(this.earth);
  }

  /** Point the sun from (elevation, azimuth) radians; called per frame. */
  setSun(elev: number, azim: number, nightFactor = 0) {
    this.sunDir.set(
      Math.cos(azim) * Math.cos(elev),
      Math.max(Math.sin(elev), -0.09),
      Math.sin(azim) * Math.cos(elev),
    ).normalize();
    // dusk: fade the sun as it sinks. Night is claustrophobic by design —
    // earthshine drops LOW so the base's own light pools carry the scene.
    const t = Math.min(1, Math.max(0, (elev + 0.03) / 0.1));
    this.sun.intensity = SUN_INTENSITY * t;
    this.earthshine.intensity = 0.3 - nightFactor * 0.19;
    // sunlit regolith lights whatever faces it — shaded walls, undersides —
    // with neutral gray, never blue; gone once the sun is
    const exitance = this.sun.intensity * Math.max(0, Math.sin(elev)) * this.groundAlbedo;
    this.earthshine.groundColor.setScalar(BOUNCE * exitance / Math.max(this.earthshine.intensity, 1e-3));
  }

  /** Later shadow casters that move (rovers, sun-tracking panels, …) call
   *  this to get the map re-rendered on the next frame. */
  requestShadowUpdate() { this.shadowDirty = true; }

  /** Fit the shadow window to the ground visible from `camera` (view rays
   *  clamped to `reach` m, intersected with the plane through `focus`), snap
   *  it to texels, and flag a shadow render if anything changed. */
  fitShadow(camera: THREE.PerspectiveCamera, focus: THREE.Vector3, reach: number) {
    const shadow = this.sun.shadow;
    if (this.sun.intensity <= 0) { shadow.needsUpdate = false; return; }
    const L = this.sunDir;
    const bx = this.bx.crossVectors(UP, L);
    if (bx.lengthSq() < 1e-8) bx.set(1, 0, 0);
    bx.normalize();
    const by = this.by.crossVectors(L, bx);

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

    const size = (w: number, prev: number) => {
      w = Math.min(SHADOW_MAX, Math.max(SHADOW_MIN, w + 2 * SHADOW_MARGIN));
      // hold the size while it still fits and is not much too big, so a
      // panning camera doesn't flip between sizes every frame
      if (w <= prev && w > prev * 0.8) return prev;
      return 2 ** (Math.ceil(Math.log2(w) * 8) / 8);
    };
    const sx = size(maxX - minX, this.win.sx);
    const sy = size(maxY - minY, this.win.sy);
    const tx = sx / SHADOW_MAP, ty = sy / SHADOW_MAP;
    const cx = Math.round((minX + maxX) / 2 / tx) * tx;
    const cy = Math.round((minY + maxY) / 2 / ty) * ty;

    const moved = cx !== this.win.cx || cy !== this.win.cy || sx !== this.win.sx || sy !== this.win.sy;
    const turned = L.dot(this.shadowDir) < SUN_STEP;
    if (!moved && !turned && !this.shadowDirty) return;

    const zRef = focus.dot(L);
    const anchor = this.v.copy(bx).multiplyScalar(cx).addScaledVector(by, cy).addScaledVector(L, zRef);
    this.sun.target.position.copy(anchor);
    this.sun.position.copy(anchor).addScaledVector(L, SUN_DIST);
    this.sun.updateMatrixWorld();
    this.sun.target.updateMatrixWorld();
    const cam = shadow.camera;
    cam.left = -sx / 2; cam.right = sx / 2;
    cam.bottom = -sy / 2; cam.top = sy / 2;
    cam.far = SUN_DIST + Math.max(0, zRef - minZ) + 60;
    cam.updateProjectionMatrix();
    shadow.bias = -BIAS_M / (cam.far - cam.near);
    shadow.normalBias = 0.5 * Math.max(tx, ty);
    shadow.needsUpdate = true;

    this.win = { cx, cy, sx, sy };
    this.shadowDir.copy(L);
    this.shadowDirty = false;
    this.shadowRenders++;
  }

  /** Current shadow texel size in metres (x, y) — probes and tests. */
  get shadowTexel(): [number, number] {
    return [this.win.sx / SHADOW_MAP, this.win.sy / SHADOW_MAP];
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
