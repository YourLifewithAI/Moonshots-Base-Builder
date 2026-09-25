/** Road cells previewed on the ground (docs/15-roads.md): the spur a
 *  placement would lay, a road the road tool would draw, the cells it would
 *  remove. One instanced, unlit, translucent plate per cell, tilted to the
 *  ground under it; pale for a road to lay, dark for one to remove. */
import * as THREE from 'three';
import { CELL_M } from '../data/balance';
import type { Heightfield } from '../terrain/heightfield';
import { cellCentre, keyCell } from '../core/roads';

const MAX = 512;

export class CellPreview {
  private mesh: THREE.InstancedMesh;
  private mat: THREE.MeshBasicMaterial;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private sig = '';

  constructor(scene: THREE.Scene, private hf: Heightfield) {
    const g = new THREE.PlaneGeometry(CELL_M * 0.9, CELL_M * 0.9);
    g.rotateX(-Math.PI / 2);
    this.mat = new THREE.MeshBasicMaterial({
      color: 0xf5f7f9, transparent: true, opacity: 0.35, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
    });
    this.mesh = new THREE.InstancedMesh(g, this.mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
  }

  /** Show these cells (cell keys); `remove` draws them dark. */
  show(keys: readonly number[] | undefined, remove = false) {
    const sig = `${remove ? 'r' : 'a'}${keys?.join(',') ?? ''}`;
    if (sig === this.sig) return;
    this.sig = sig;
    const n = Math.min(MAX, keys?.length ?? 0);
    this.mat.color.set(remove ? 0x101214 : 0xf5f7f9);
    this.mat.opacity = remove ? 0.55 : 0.35;
    for (let i = 0; i < n; i++) {
      const [gx, gz] = keyCell(keys![i]);
      const [x, z] = cellCentre(gx, gz);
      const hx0 = this.hf.sample(x - 2, z), hx1 = this.hf.sample(x + 2, z);
      const hz0 = this.hf.sample(x, z - 2), hz1 = this.hf.sample(x, z + 2);
      this.e.set(Math.atan2(hz0 - hz1, CELL_M), 0, Math.atan2(hx1 - hx0, CELL_M));
      this.m.compose(this.p.set(x, this.hf.sample(x, z) + 0.2, z), this.q.setFromEuler(this.e), this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  hide() { this.show(undefined); }
  get count() { return this.mesh.count; }
}
