/** Bootprints behind the astronaut: an instanced ring buffer of 400 treaded
 *  soles pressed into the regolith every stride while grounded (both feet
 *  on landing from a leap). Nothing erodes them — no wind, no rain — so
 *  they stay until the buffer wraps. A stock unlit darkening decal with a
 *  generated tread texture, the same at every FX level and in safe mode. */
import * as THREE from 'three';
import type { Heightfield } from '../terrain/heightfield';

const MAX = 400;
const STRIDE_M = 1.15;
const FOOT_OFF = 0.13;       // m either side of the path
const SOLE: [number, number] = [0.15, 0.33];

/** A boot sole with chevron tread ribs (alpha in G). */
function soleTexture(): THREE.DataTexture {
  const W = 32, H = 64;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W * 2 - 1, v = (y + 0.5) / H * 2 - 1;  // v: −1 heel … +1 toe
      const halfW = 0.78 + 0.22 * v - 0.25 * Math.max(0, v - 0.6) / 0.4; // wider toe, rounded
      const edge = Math.max(Math.abs(u) / Math.max(halfW, 0.2), Math.abs(v));
      const sole = Math.max(0, Math.min(1, (1 - edge) / 0.12));
      const chevron = v * 9 + Math.abs(u) * 2.2;
      const rib = 0.5 + 0.5 * Math.cos(chevron * Math.PI);
      const a = sole * (0.55 + 0.45 * rib * (Math.abs(v) < 0.92 ? 1 : 0.4));
      const o = (y * W + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = Math.round(a * 255);
      data[o + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export interface Walker {
  readonly pos: THREE.Vector3;
  readonly yaw: number;
  readonly onGround: boolean;
}

export class Footprints {
  readonly mesh: THREE.InstancedMesh;
  private total = 0;
  private last = new THREE.Vector3(NaN, 0, NaN);
  private left = false;
  private wasGround = true;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private p = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);

  constructor(private hf: Heightfield) {
    const g = new THREE.PlaneGeometry(SOLE[0], SOLE[1]);
    g.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({
      color: 0x000000, alphaMap: soleTexture(), transparent: true, opacity: 0.42, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    }), MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Per frame while walking. */
  update(w: Walker) {
    const landed = w.onGround && !this.wasGround;
    this.wasGround = w.onGround;
    if (!w.onGround) return;
    if (landed) {
      this.press(w.pos.x, w.pos.z, w.yaw, true);
      this.press(w.pos.x, w.pos.z, w.yaw, false);
      this.last.copy(w.pos);
      return;
    }
    if (!Number.isFinite(this.last.x)) { this.last.copy(w.pos); return; }
    const d = Math.hypot(w.pos.x - this.last.x, w.pos.z - this.last.z);
    if (d < STRIDE_M) return;
    // a big jump (respawn, teleport) starts a fresh trail instead of a smear
    if (d < 4 * STRIDE_M) {
      const heading = Math.atan2(-(w.pos.x - this.last.x), -(w.pos.z - this.last.z));
      this.left = !this.left;
      this.press(w.pos.x, w.pos.z, heading, this.left);
    }
    this.last.copy(w.pos);
  }

  /** `yaw` in the walk convention (0 = facing −z). */
  private press(x: number, z: number, yaw: number, left: boolean) {
    const side = left ? -1 : 1;
    const px = x + Math.cos(yaw) * FOOT_OFF * side, pz = z - Math.sin(yaw) * FOOT_OFF * side;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const hf = this.hf;
    const front = hf.sample(px + fx * 0.3, pz + fz * 0.3), back = hf.sample(px - fx * 0.3, pz - fz * 0.3);
    // the sole's right (+x) side after the yaw is (cos yaw, −sin yaw)
    const rx = Math.cos(yaw) * 0.3, rz = -Math.sin(yaw) * 0.3;
    const right = hf.sample(px + rx, pz + rz), left_ = hf.sample(px - rx, pz - rz);
    // the rotated plane's toe points along −z, the walk convention's forward
    this.e.set(Math.atan2(front - back, 0.6), yaw, Math.atan2(right - left_, 0.6));
    const i = this.total % MAX;
    this.mesh.setMatrixAt(i, this.m.compose(this.p.set(px, hf.sample(px, pz) + 0.015, pz),
      this.q.setFromEuler(this.e), this.s));
    this.mesh.instanceMatrix.needsUpdate = true;
    this.total++;
    this.mesh.count = Math.min(this.total, MAX);
  }

  get count(): number { return this.mesh.count; }
}
