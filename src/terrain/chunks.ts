/** Terrain render meshes: 8×8 chunks over the shared heightfield (shared edge
 *  samples → no cracks). Vertex colors carry the regolith look: noise mottling,
 *  slope darkening, crater-floor basalt, bright rims — all relative to the
 *  site's albedo. Rebuilt per-chunk when a building pad flattens the field.
 *
 *  Classic style: the same grid samples (so the surface is the one
 *  hf.sample describes), each triangle its own vertices with a face normal
 *  — faceted Lambert with no derivative shading — coloured by the classic
 *  ground (terrain/classicGround.ts: site tint, relief, craters, deposits). */
import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { CELL_M, CHUNKS, CHUNK_CELLS, MAP_M } from '../data/balance';
import { mulberry32 } from '../core/rng';
import { materials } from '../world/materials';
import { regolithPatch } from './terrainShader';
import type { Crater, Heightfield } from './heightfield';
import { classicActive } from '../core/style';
import { classicGround, facet } from './classicGround';

materials.define('terrain', new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.96,
  metalness: 0.0,
}), regolithPatch);

const colorNoise = createNoise2D(mulberry32(0xc0ffee));

/** Regolith albedo at (x, z): mottled, darker in crater bowls, brighter on
 *  fresh rims, kept inside the site's band. Shared by the chunks and the
 *  horizon ring so the two agree at the map edge; `footprint` (m, the
 *  caller's sample spacing) fades mottle too fine for it to hold. */
export function regolithAlbedo(albedo: number, craters: readonly Crater[], x: number, z: number, footprint = 0): number {
  const fade = (period: number) => (footprint > 0 ? Math.min(1, Math.max(0, period / footprint - 1)) : 1);
  let v = 1;
  v += colorNoise(x / 55, z / 55) * 0.08 * fade(55);
  v += colorNoise(x / 11, z / 11) * 0.054 * fade(11);
  for (const c of craters) {
    const d = Math.hypot(x - c.cx, z - c.cz) / c.r;
    if (d < 0.9) v -= 0.134 * (1 - d);              // basalt floor
    else if (d < 1.35) v += 0.18 * (1.35 - d);      // fresh bright rim/ejecta
  }
  return albedo * Math.min(1.29, Math.max(0.54, v));
}

export class TerrainChunks {
  readonly group = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
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
    const nrm = new Float32Array(n * n * 3);
    const gx0 = cx * CHUNK_CELLS;
    const gz0 = cz * CHUNK_CELLS;
    const albedo = this.hf.site.terrain.albedo;
    const classic = classicActive() ? classicGround(this.hf) : null;
    let p = 0;
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const gx = gx0 + ix, gz = gz0 + iz;
        const x = gx * CELL_M - MAP_M / 2;
        const z = gz * CELL_M - MAP_M / 2;
        const y = this.hf.sampleGrid(gx, gz);
        pos[p] = x; pos[p + 1] = y; pos[p + 2] = z;
        this.hf.gridNormal(gx, gz, nrm, p);
        if (classic) {
          classic.color(x, z, y, nrm[p + 1], col, p);
        } else {
          const v = regolithAlbedo(albedo, this.hf.craters, x, z);
          col[p] = v; col[p + 1] = v; col[p + 2] = v * 1.005; // whisper of cool
        }
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
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    return classic ? facet(geo) : geo;
  }

  /** Rebuild the (≤4) chunks covering a cell rect after a flatten. */
  rebuildAround(gx0: number, gz0: number, gx1: number, gz1: number) {
    const cx0 = Math.max(0, Math.floor((gx0 - 3) / CHUNK_CELLS));
    const cz0 = Math.max(0, Math.floor((gz0 - 3) / CHUNK_CELLS));
    const cx1 = Math.min(CHUNKS - 1, Math.floor((gx1 + 3) / CHUNK_CELLS));
    const cz1 = Math.min(CHUNKS - 1, Math.floor((gz1 + 3) / CHUNK_CELLS));
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

  /** The mesh's vertex colour at the grid corner nearest (x, z) (tests). */
  colorAt(x: number, z: number): [number, number, number] | null {
    const gx = Math.round((x + MAP_M / 2) / CELL_M), gz = Math.round((z + MAP_M / 2) / CELL_M);
    const cx = Math.min(CHUNKS - 1, Math.floor(gx / CHUNK_CELLS)), cz = Math.min(CHUNKS - 1, Math.floor(gz / CHUNK_CELLS));
    const geo = this.meshes[cz * CHUNKS + cx]?.geometry;
    const col = geo?.getAttribute('color');
    const pos = geo?.getAttribute('position');
    if (!col || !pos) return null;
    const wx = gx * CELL_M - MAP_M / 2, wz = gz * CELL_M - MAP_M / 2;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getX(i) - wx) < 0.01 && Math.abs(pos.getZ(i) - wz) < 0.01) {
        return [col.getX(i), col.getY(i), col.getZ(i)];
      }
    }
    return null;
  }

  /** How far the drawn ground departs from hf.sample, which buildings,
   *  rovers and the walker stand on: the largest vertex offset from its grid
   *  sample (read back from the meshes), and the largest and mean gap of the
   *  triangulated surface from the bilinear sample over `n` seeded points
   *  (tests, probes). */
  surfaceError(n = 4000) {
    let vertex = 0;
    for (let i = 0; i < this.meshes.length; i++) {
      const pos = this.meshes[i].geometry.getAttribute('position');
      for (let k = 0; k < pos.count; k += 7) {
        const gx = Math.round((pos.getX(k) + MAP_M / 2) / CELL_M), gz = Math.round((pos.getZ(k) + MAP_M / 2) / CELL_M);
        vertex = Math.max(vertex, Math.abs(pos.getY(k) - this.hf.sampleGrid(gx, gz)));
      }
    }
    const rng = mulberry32(0x5e7f);
    let max = 0, sum = 0;
    for (let i = 0; i < n; i++) {
      const x = (rng() - 0.5) * (MAP_M - 8), z = (rng() - 0.5) * (MAP_M - 8);
      const e = Math.abs(this.surfaceAt(x, z) - this.hf.sample(x, z));
      max = Math.max(max, e);
      sum += e;
    }
    return { vertex, max, mean: sum / n };
  }

  /** Height of the drawn surface at (x, z): each cell's two triangles
   *  (a c b, b c d — split on the b–c diagonal), as buildGeometry lays them. */
  surfaceAt(x: number, z: number): number {
    const fx = (x + MAP_M / 2) / CELL_M, fz = (z + MAP_M / 2) / CELL_M;
    const gx = Math.min(Math.floor(fx), 255), gz = Math.min(Math.floor(fz), 255);
    const tx = fx - gx, tz = fz - gz;
    const a = this.hf.sampleGrid(gx, gz), b = this.hf.sampleGrid(gx + 1, gz);
    const c = this.hf.sampleGrid(gx, gz + 1), d = this.hf.sampleGrid(gx + 1, gz + 1);
    return tx + tz <= 1 ? a + (b - a) * tx + (c - a) * tz : d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  }

  /** Triangles, vertices, and whether the surface is faceted (probes). */
  info() {
    let triangles = 0, vertices = 0;
    for (const m of this.meshes) {
      const g = m.geometry;
      vertices += g.getAttribute('position').count;
      triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    }
    const mat = this.meshes[0].material as THREE.MeshLambertMaterial;
    return {
      material: mat.type, vertexColors: mat.vertexColors, faceted: !this.meshes[0].geometry.index,
      chunks: this.meshes.length, triangles, vertices,
    };
  }
}
