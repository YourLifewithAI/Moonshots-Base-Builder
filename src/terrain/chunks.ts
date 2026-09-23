/** Terrain render meshes: 8×8 chunks over the shared heightfield (shared edge
 *  samples → no cracks). Vertex colors carry the regolith look: noise mottling,
 *  slope darkening, crater-floor basalt, bright rims — all relative to the
 *  site's albedo. Rebuilt per-chunk when a building pad flattens the field. */
import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { CELL_M, CHUNKS, CHUNK_CELLS, MAP_M } from '../data/balance';
import { mulberry32 } from '../core/rng';
import { materials } from '../world/materials';
import { regolithPatch } from './terrainShader';
import type { Heightfield } from './heightfield';

materials.define('terrain', new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.96,
  metalness: 0.0,
}), regolithPatch);

export class TerrainChunks {
  readonly group = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  private colorNoise = createNoise2D(mulberry32(0xc0ffee));
  /** fired after a flatten rebuilt chunk geometry (terrain casts shadows) */
  onShadowCastersChanged?: () => void;

  constructor(private hf: Heightfield) {
    for (let cz = 0; cz < CHUNKS; cz++) {
      for (let cx = 0; cx < CHUNKS; cx++) {
        const mesh = new THREE.Mesh(this.buildGeometry(cx, cz), materials.get('terrain'));
        mesh.receiveShadow = true;
        // back faces fill the shadow map (three's default shadowSide), so lit
        // slopes never self-shadow into acne; ridges and crater walls do cast
        mesh.castShadow = true;
        mesh.matrixAutoUpdate = false;
        this.meshes.push(mesh);
        this.group.add(mesh);
      }
    }
  }

  private buildGeometry(cx: number, cz: number): THREE.BufferGeometry {
    const n = CHUNK_CELLS + 1;
    const pos = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    const gx0 = cx * CHUNK_CELLS;
    const gz0 = cz * CHUNK_CELLS;
    const albedo = this.hf.site.terrain.albedo;
    let p = 0;
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const gx = gx0 + ix, gz = gz0 + iz;
        const x = gx * CELL_M - MAP_M / 2;
        const z = gz * CELL_M - MAP_M / 2;
        const y = this.hf.sampleGrid(gx, gz);
        pos[p] = x; pos[p + 1] = y; pos[p + 2] = z;

        // regolith albedo relative to the site's: mottled, darker in crater
        // bowls, brighter on fresh rims
        let v = 1;
        v += this.colorNoise(x / 55, z / 55) * 0.08;
        v += this.colorNoise(x / 11, z / 11) * 0.054;
        for (const c of this.hf.craters) {
          const d = Math.hypot(x - c.cx, z - c.cz) / c.r;
          if (d < 0.9) v -= 0.134 * (1 - d);              // basalt floor
          else if (d < 1.35) v += 0.18 * (1.35 - d);      // fresh bright rim/ejecta
        }
        v = albedo * Math.min(1.29, Math.max(0.54, v));
        col[p] = v; col[p + 1] = v; col[p + 2] = v * 1.005; // whisper of cool
        p += 3;
      }
    }
    const idx: number[] = [];
    for (let iz = 0; iz < n - 1; iz++) {
      for (let ix = 0; ix < n - 1; ix++) {
        const a = iz * n + ix, b = a + 1, c = a + n, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  /** Rebuild the (≤4) chunks covering a cell rect after a flatten. */
  rebuildAround(gx0: number, gz0: number, gx1: number, gz1: number) {
    const cx0 = Math.max(0, Math.floor((gx0 - 2) / CHUNK_CELLS));
    const cz0 = Math.max(0, Math.floor((gz0 - 2) / CHUNK_CELLS));
    const cx1 = Math.min(CHUNKS - 1, Math.floor((gx1 + 2) / CHUNK_CELLS));
    const cz1 = Math.min(CHUNKS - 1, Math.floor((gz1 + 2) / CHUNK_CELLS));
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const i = cz * CHUNKS + cx;
        this.meshes[i].geometry.dispose();
        this.meshes[i].geometry = this.buildGeometry(cx, cz);
      }
    }
    this.onShadowCastersChanged?.();
  }

  /** Material class of the terrain meshes (safe-mode checks, probes). */
  get materialType(): string { return (this.meshes[0].material as THREE.Material).type; }
}
