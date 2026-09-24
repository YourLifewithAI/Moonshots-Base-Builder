/** The Dyson swarm in the sky: collectors glinting on a thin ellipse through
 *  the sun (the ring seen nearly edge-on), more of them with every volley —
 *  n = 12 + 40·log10(1 + swarm% · 10⁴), so the first launch already shows
 *  and the growth stays legible from 0.0001 % to 100 %. Each glint idles
 *  dim and flashes as its foil catches the sun (HDR, so FX 0 blooms it).
 *
 *  A camera-centred group drawn in the sky slot (group order −1, depth
 *  writes off), so the ground paints over it like the stars; a stock
 *  PointsMaterial, the same at every FX level and in safe mode. */
import * as THREE from 'three';
import { mulberry32 } from '../core/rng';

const MAX = 400;
const R = 2750;          // inside the sky sphere, ahead of the sun disc
const MAJOR = 0.16;      // rad: ellipse half-length along the sun's path
const MINOR = 0.022;     // rad: half-width
const CLEAR = 0.014;     // rad kept clear of the disc
const UP = new THREE.Vector3(0, 1, 0);

export function swarmGlints(pct: number): number {
  return pct > 0 ? Math.min(MAX, Math.round(12 + 40 * Math.log10(1 + pct * 1e4))) : 0;
}

export class SwarmGlints {
  readonly group = new THREE.Group();
  private points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private theta = new Float32Array(MAX);
  private rad = new Float32Array(MAX);
  private rate = new Float32Array(MAX);
  private flash = new Float32Array(MAX * 2);
  private clock = 0;
  private e1 = new THREE.Vector3();
  private e2 = new THREE.Vector3();
  private v = new THREE.Vector3();
  count = 0;

  constructor() {
    const rng = mulberry32(0x5a1e);
    for (let i = 0; i < MAX; i++) {
      this.theta[i] = rng() * Math.PI * 2;
      this.rad[i] = 0.55 + 0.45 * Math.sqrt(rng());
      this.rate[i] = (0.002 + 0.004 * rng()) * (rng() < 0.5 ? -1 : 1);
      this.flash[i * 2] = 0.3 + 0.9 * rng();         // flash frequency, rad/s
      this.flash[i * 2 + 1] = rng() * Math.PI * 2;   // phase
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setDrawRange(0, 0);
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 2, sizeAttenuation: false, vertexColors: true, depthWrite: false, fog: false,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = -3;
    this.group.renderOrder = -1;
    this.group.add(this.points);
  }

  /** Per frame, after the camera moved. `sunDir` unit, toward the sun. */
  update(camera: THREE.Camera, sunDir: THREE.Vector3, swarmPct: number, dt: number) {
    this.clock += dt;
    this.group.position.copy(camera.position);
    const n = swarmGlints(swarmPct);
    this.count = n;
    this.points.visible = n > 0 && sunDir.y > -0.2;
    if (!this.points.visible) return;
    // e1 runs along the sun's daily path, e2 across it
    this.e1.crossVectors(UP, sunDir);
    if (this.e1.lengthSq() < 1e-6) this.e1.set(1, 0, 0);
    this.e1.normalize();
    this.e2.crossVectors(sunDir, this.e1).normalize();
    for (let i = 0; i < n; i++) {
      this.theta[i] += this.rate[i] * dt;
      const th = this.theta[i], r = this.rad[i];
      let ox = Math.cos(th) * MAJOR * r, oy = Math.sin(th) * MINOR * r;
      const d = Math.hypot(ox, oy);
      if (d < CLEAR) { ox *= CLEAR / Math.max(d, 1e-6); oy *= CLEAR / Math.max(d, 1e-6); }
      this.v.copy(sunDir).addScaledVector(this.e1, ox).addScaledVector(this.e2, oy).normalize().multiplyScalar(R);
      this.pos[i * 3] = this.v.x; this.pos[i * 3 + 1] = this.v.y; this.pos[i * 3 + 2] = this.v.z;
      const s = Math.max(0, Math.sin(this.clock * this.flash[i * 2] + this.flash[i * 2 + 1]));
      const b = 0.22 + 2.8 * s ** 24;
      this.col[i * 3] = b; this.col[i * 3 + 1] = b; this.col[i * 3 + 2] = b * 0.98;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('color').needsUpdate = true;
  }
}
