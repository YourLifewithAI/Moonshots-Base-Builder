/** Classic style: a soft dark footprint under every structure, standing in
 *  for the shadow map it does not draw — the building sits on the ground
 *  instead of floating over it. One merged mesh: per structure a 4×4-vertex
 *  nine-slice (a fixed 1.6 m feathered margin whatever the footprint's
 *  size), draped on the heightfield, vertex alpha 1 inside and 0 at the rim.
 *  Rebuilt only when the set of footprints changes. */
import * as THREE from 'three';
import type { GameState } from '../core/state';
import { CELL_M, MAP_M } from '../data/balance';
import type { Heightfield } from '../terrain/heightfield';
import { footprintRect } from './instances';

const MARGIN_M = 1.0;   // feathered edge outside the footprint
const INSET_M = 1.2;    // full darkness starts this far inside it
const LIFT_M = 0.06;
const OPACITY = 0.3;

export class ContactDecals {
  readonly mesh: THREE.Mesh;
  private sig = '';

  constructor(private hf: Heightfield) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
      color: 0x000000, vertexColors: true, transparent: true, opacity: OPACITY, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    }));
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Sync with the structures (every rebuild; cheap unless footprints moved). */
  rebuild(state: GameState) {
    const sig = state.buildings.map((b) => `${b.gx},${b.gz},${b.rot},${b.type}`).join(';') + `|${state.flattens.length}`;
    if (sig === this.sig) return;
    this.sig = sig;
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    for (const b of state.buildings) {
      const r = footprintRect(b);
      const x0 = r.gx0 * CELL_M - MAP_M / 2, x1 = r.gx1 * CELL_M - MAP_M / 2;
      const z0 = r.gz0 * CELL_M - MAP_M / 2, z1 = r.gz1 * CELL_M - MAP_M / 2;
      const xs = [x0 - MARGIN_M, x0 + INSET_M, x1 - INSET_M, x1 + MARGIN_M];
      const zs = [z0 - MARGIN_M, z0 + INSET_M, z1 - INSET_M, z1 + MARGIN_M];
      const base = pos.length / 3;
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) {
          const x = xs[i], z = zs[j];
          pos.push(x, this.hf.sample(x, z) + LIFT_M, z);
          const inner = i > 0 && i < 3 && j > 0 && j < 3;
          col.push(1, 1, 1, inner ? 1 : 0);
        }
      }
      for (let j = 0; j < 3; j++) {
        for (let i = 0; i < 3; i++) {
          const a = base + j * 4 + i, bb = a + 1, c = a + 4, d = c + 1;
          idx.push(a, c, bb, bb, c, d);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(idx);
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
    this.mesh.visible = state.buildings.length > 0;
  }

  get count(): number {
    return this.mesh.visible ? (this.mesh.geometry.getAttribute('position')?.count ?? 0) / 16 : 0;
  }
}
