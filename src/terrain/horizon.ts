/** The far horizon: one mesh from the map's square edge out to ~12 km that
 *  continues the analytic terrain (fBm, the map's own craters, plus larger
 *  far-only craters), so the world ends in a horizon instead of a lip.
 *
 *  - Its inner row IS the map edge: the same grid samples, heights, normals
 *    and albedo as the border chunk vertices, so the seam is watertight and
 *    nothing overlaps (no z-fighting, no discard shader — it draws the same
 *    at every FX level, and safe mode takes the terrain material's twin).
 *  - Rows step outward geometrically (4 m at the edge, ~0.8 km at the rim,
 *    never more than twice a cell's width) and thin from 1024 to 256
 *    around: one draw call, ~43 k triangles. Octaves and mottle finer than
 *    a row's spacing fade out.
 *  - Past the edge the ground drops by d²/2R with R = 50 km — the Moon's
 *    curvature compressed ~35×, so the horizon "curves away too soon" and
 *    the ring's own rim always sits below it.
 *  - Classic style: coloured by the classic ground (its inner row by the
 *    very function and samples the border chunks use), then faceted like
 *    the chunks — every triangle its own vertices and face normal. */
import * as THREE from 'three';
import { CELL_M, MAP_CELLS, MAP_M } from '../data/balance';
import { mulberry32 } from '../core/rng';
import { materials } from '../world/materials';
import { regolithAlbedo } from './chunks';
import type { Crater, Heightfield } from './heightfield';
import { classicActive } from '../core/style';
import { classicGround, facet } from './classicGround';

const HALF = MAP_M / 2;
const REACH_M = 11_500;     // ring extent past the map edge
const CURVE_R = 50_000;     // m
const GROWTH = 1.13;        // row spacing ratio
const PERIM = 4 * MAP_CELLS; // grid samples around the map edge
const MIN_AROUND = 256;
const FAR_CRATERS = 3;      // far craters per map crater of the site

export class Horizon {
  readonly mesh: THREE.Mesh;
  private farCraters: Crater[] = [];
  private allCraters: Crater[];
  /** the largest inner-row height gap at the last build (seamError) */
  private seam = 0;

  constructor(private hf: Heightfield) {
    const rng = mulberry32(hf.seed ^ 0x401e20);
    const t = hf.site.terrain;
    for (let i = 0; i < t.craterCount * FAR_CRATERS; i++) {
      const r = 30 + Math.pow(rng(), 2.4) * (t.craterMaxD * 2.2);
      const ang = rng() * Math.PI * 2;
      const dist = Math.sqrt(HALF ** 2 + rng() * (9000 ** 2 - HALF ** 2));
      const cx = Math.cos(ang) * dist, cz = Math.sin(ang) * dist;
      // ejecta reaches 3r: keep every far crater off the grid and its border normals
      if (Math.max(Math.abs(cx), Math.abs(cz)) - HALF < 3 * r + 2 * CELL_M) continue;
      this.farCraters.push({ cx, cz, r, depth: r * 0.14, rimH: r * 0.048 });
    }
    this.allCraters = [...hf.craters, ...this.farCraters];
    this.mesh = new THREE.Mesh(this.buildGeometry(), materials.get('terrain'));
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.matrixAutoUpdate = false;
  }

  /** Ground height anywhere: the playable grid inside the map, the ring's
   *  surface beyond it (camera clearance, sun occlusion). */
  heightAt(x: number, z: number): number {
    if (Math.abs(x) <= HALF && Math.abs(z) <= HALF) return this.hf.sample(x, z);
    return this.farHeight(x, z, 0);
  }

  private farHeight(x: number, z: number, footprint: number): number {
    let h = this.hf.baseHeight(x, z, footprint);
    for (const c of this.farCraters) {
      const dx = x - c.cx, dz = z - c.cz;
      if (Math.abs(dx) > 3 * c.r || Math.abs(dz) > 3 * c.r) continue;
      const d = Math.hypot(dx, dz) / c.r;
      if (d < 1) {
        h += c.depth * (d * d - 1);
        h += c.rimH * Math.exp(-((d - 1) ** 2) / (2 * 0.12 ** 2));
      } else if (d < 3) {
        h += c.rimH * Math.pow(d, -3);
      }
    }
    const m = Math.max(Math.abs(x), Math.abs(z));
    if (m > HALF) {
      const past = Math.hypot(x, z) * (1 - HALF / m);
      h -= (past * past) / (2 * CURVE_R);
    }
    return h;
  }

  /** A flatten reaching the map's border rows moved the shared edge. */
  onFlatten(gx0: number, gz0: number, gx1: number, gz1: number) {
    const m = 3; // skirt (2) + normal stencil (1)
    if (gx0 > m && gz0 > m && gx1 < MAP_CELLS - m && gz1 < MAP_CELLS - m) return;
    this.mesh.geometry.dispose();
    this.mesh.geometry = this.buildGeometry();
  }

  /** Largest height gap between the ring's inner row and the grid edge (tests). */
  seamError(): number {
    return this.seam;
  }

  private measureSeam(pos: Float32Array): number {
    let worst = 0;
    for (let p = 0; p < PERIM; p++) {
      const [gx, gz] = perimCell(p);
      worst = Math.max(worst, Math.abs(pos[p * 3 + 1] - this.hf.sampleGrid(gx, gz)));
    }
    return worst;
  }

  private buildGeometry(): THREE.BufferGeometry {
    const rows: { n: number; s: number; fp: number }[] = [{ n: PERIM, s: 1, fp: 0 }];
    let r = 0, step = CELL_M, n = PERIM;
    while (r < REACH_M) {
      r += step;
      const s = 1 + r / HALF;
      if (n > MIN_AROUND && (4 * MAP_M * s) / (n / 2) <= 1.5 * step) n /= 2;
      const around = (4 * MAP_M * s) / n;
      rows.push({ n, s, fp: Math.max(step, around) });
      // cells no longer than twice their width: long radial slivers streak
      step = Math.min(step * GROWTH, 2 * around);
    }

    let verts = 0;
    for (const row of rows) verts += row.n;
    const pos = new Float32Array(verts * 3);
    const col = new Float32Array(verts * 3);
    const albedo = this.hf.site.terrain.albedo;
    const classic = classicActive();
    const fps = new Float32Array(verts);
    const bases: number[] = [];
    let v = 0;
    for (let k = 0; k < rows.length; k++) {
      const { n: count, s, fp } = rows[k];
      bases.push(v);
      for (let i = 0; i < count; i++, v++) {
        const [gx, gz] = perimCell(i * (PERIM / count));
        const o = v * 3;
        if (k === 0) {
          pos[o] = gx * CELL_M - HALF;
          pos[o + 2] = gz * CELL_M - HALF;
          pos[o + 1] = this.hf.sampleGrid(gx, gz);
        } else {
          pos[o] = (gx * CELL_M - HALF) * s;
          pos[o + 2] = (gz * CELL_M - HALF) * s;
          pos[o + 1] = this.farHeight(pos[o], pos[o + 2], fp);
        }
        fps[v] = fp;
        if (classic) continue; // coloured once the normals are known
        const a = regolithAlbedo(albedo, this.allCraters, pos[o], pos[o + 2], fp);
        col[o] = a; col[o + 1] = a; col[o + 2] = a * 1.005;
      }
    }

    const idx: number[] = [];
    for (let k = 0; k + 1 < rows.length; k++) {
      const A = bases[k], B = bases[k + 1], na = rows[k].n, nb = rows[k + 1].n;
      if (na === nb) {
        for (let i = 0; i < na; i++) {
          const i1 = (i + 1) % na;
          idx.push(A + i, B + i, A + i1, A + i1, B + i, B + i1);
        }
      } else {
        for (let j = 0; j < nb; j++) {
          const j1 = (j + 1) % nb, a0 = 2 * j, a1 = 2 * j + 1, a2 = (2 * j + 2) % na;
          idx.push(A + a0, B + j, A + a1, A + a1, B + j, B + j1, A + a1, B + j1, A + a2);
        }
      }
    }
    // the perimeter's handedness decides the winding: face the triangles up
    const ny = (i: number) => {
      const [a, b, c] = [idx[i] * 3, idx[i + 1] * 3, idx[i + 2] * 3];
      const ux = pos[b] - pos[a], uz = pos[b + 2] - pos[a + 2];
      const wx = pos[c] - pos[a], wz = pos[c + 2] - pos[a + 2];
      return uz * wx - ux * wz;
    };
    if (ny(0) < 0) {
      for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // the shared edge takes the grid's own normals, as the border chunks do
    const nrm = geo.getAttribute('normal').array as Float32Array;
    for (let p = 0; p < PERIM; p++) {
      const [gx, gz] = perimCell(p);
      this.hf.gridNormal(gx, gz, nrm, p * 3);
    }
    this.seam = this.measureSeam(pos);
    if (classic) {
      const ground = classicGround(this.hf);
      for (let i = 0; i < verts; i++) {
        ground.color(pos[i * 3], pos[i * 3 + 2], pos[i * 3 + 1], nrm[i * 3 + 1], col, i * 3, fps[i], this.allCraters);
      }
      return facet(geo);
    }
    geo.computeBoundingSphere();
    return geo;
  }
}

/** Grid sample of perimeter index p, walking the map edge once around. */
function perimCell(p: number): [number, number] {
  const e = Math.floor(p / MAP_CELLS), t = p % MAP_CELLS;
  switch (e) {
    case 0: return [t, 0];
    case 1: return [MAP_CELLS, t];
    case 2: return [MAP_CELLS - t, MAP_CELLS];
    default: return [0, MAP_CELLS - t];
  }
}
