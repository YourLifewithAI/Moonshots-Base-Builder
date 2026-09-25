/** Classic style: each lit structure's flood as a soft additive pool on the
 *  ground — the stock path's discs, draped on the heightfield so a pool
 *  follows the slope it falls on instead of cutting into it, and feathered
 *  to nothing at the rim. One merged mesh (a centre and rings every ~3 m);
 *  positions are rebuilt only when the lit set moves, colours whenever a
 *  structure's light level changes (instances.ts, via lightLevel). */
import * as THREE from 'three';
import { BUILDINGS } from '../data/buildings';
import { CELL_M } from '../data/balance';
import type { BuildingState } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import { centerOf } from './instances';

const SEGMENTS = 20;
const RING_M = 3;
const REACH_M = 7;        // past the footprint's half-width
const LIFT_M = 0.25;
const GAIN = 0.16;
const WARM = new THREE.Color(1.0, 0.74, 0.42);

export class ClassicFloods {
  readonly mesh: THREE.Mesh;
  private sig = '';
  /** per structure: its first vertex and vertex count */
  private spans: { id: number; start: number; count: number }[] = [];
  private falloff = new Float32Array(0);

  constructor(private hf: Heightfield) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
      vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    }));
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** The lit structures (complete, enabled, powered), then their levels. */
  rebuild(lit: readonly BuildingState[]) {
    const sig = lit.map((b) => `${b.id}:${b.gx},${b.gz},${b.rot}`).join(';');
    if (sig === this.sig) return;
    this.sig = sig;
    const pos: number[] = [], fall: number[] = [], idx: number[] = [];
    this.spans = [];
    for (const b of lit) {
      const [cx, cz] = centerOf(b);
      const [w, d] = BUILDINGS[b.type].footprint;
      const R = (Math.max(w, d) * CELL_M) / 2 + REACH_M;
      const rings = Math.max(3, Math.ceil(R / RING_M));
      const start = pos.length / 3;
      pos.push(cx, this.hf.sample(cx, cz) + LIFT_M, cz);
      fall.push(1);
      for (let k = 1; k <= rings; k++) {
        const r = (k / rings) * R;
        const f = (1 - (k / rings) ** 2) ** 3;
        for (let s = 0; s < SEGMENTS; s++) {
          const a = (s / SEGMENTS) * Math.PI * 2;
          const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
          pos.push(x, this.hf.sample(x, z) + LIFT_M, z);
          fall.push(f);
        }
      }
      for (let s = 0; s < SEGMENTS; s++) idx.push(start, start + 1 + ((s + 1) % SEGMENTS), start + 1 + s);
      for (let k = 1; k < rings; k++) {
        const r0 = start + 1 + (k - 1) * SEGMENTS, r1 = r0 + SEGMENTS;
        for (let s = 0; s < SEGMENTS; s++) {
          const s1 = (s + 1) % SEGMENTS;
          idx.push(r0 + s, r0 + s1, r1 + s, r1 + s, r0 + s1, r1 + s1);
        }
      }
      this.spans.push({ id: b.id, start, count: pos.length / 3 - start });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(fall.length * 3), 3));
    g.setIndex(idx);
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
    this.falloff = new Float32Array(fall);
  }

  /** Colour every pool by its structure's light level (0 = dark). */
  setLevels(level: (id: number) => number) {
    const col = this.mesh.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    let any = false;
    if (col) {
      const a = col.array as Float32Array;
      for (const sp of this.spans) {
        const l = level(sp.id) * GAIN;
        if (l > 0.005) any = true;
        for (let i = sp.start; i < sp.start + sp.count; i++) {
          const f = this.falloff[i] * l;
          a[i * 3] = WARM.r * f; a[i * 3 + 1] = WARM.g * f; a[i * 3 + 2] = WARM.b * f;
        }
      }
      col.needsUpdate = true;
    }
    this.mesh.visible = any;
  }

  /** Pools drawn (tests, probes). */
  get count(): number { return this.mesh.visible ? this.spans.length : 0; }
}
