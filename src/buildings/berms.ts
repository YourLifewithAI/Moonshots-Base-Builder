/** Regolith Shielding made visible: once the tech is done, every shielded
 *  structure gets a bulldozed regolith berm around its footprint — steep
 *  against the wall, a long outer slope, open (tapered to the ground) at
 *  its doors. One merged mesh draped on the heightfield in the terrain's
 *  own material and albedo, so it shades, floods and falls back exactly
 *  like the ground it was pushed up from. Rebuilt only when the set of
 *  shielded structures or the ground under them changes. */
import * as THREE from 'three';
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { CELL_M } from '../data/balance';
import type { BuildingState, GameState } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import { regolithAlbedo } from '../terrain/chunks';
import { materials } from '../world/materials';
import { centerOf } from './instances';

type Side = '+x' | '-x' | '+z' | '-z';
interface Gap { side: Side; at: number; w: number }

/** Shielded structures and their door openings (building-local, from the
 *  recipes' door() calls; width = door + working clearance). */
const SHIELDED: Partial<Record<BuildingId, Gap[]>> = {
  habitat: [{ side: '+z', at: 0, w: 2.8 }],
  smelter: [{ side: '+z', at: 1.6, w: 3.8 }],
  hydroponics: [{ side: '+z', at: 0, w: 3.0 }],
  refinery: [{ side: '-x', at: 2.0, w: 2.6 }],
  lab: [{ side: '-x', at: 0.6, w: 2.8 }],
  roboticsBay: [{ side: '+z', at: -1.6, w: 4.4 }, { side: '-x', at: 0.6, w: 3.0 }],
  partsFab: [{ side: '+z', at: 0, w: 3.8 }],
  reactor: [{ side: '-z', at: -1.0, w: 2.6 }],
  recDome: [{ side: '+z', at: 0, w: 3.0 }],
  chipFab: [{ side: '+z', at: 2.4, w: 3.4 }],
  foilFactory: [{ side: '+z', at: 0, w: 4.6 }, { side: '+x', at: 0, w: 4.4 }],
  propellantPlant: [{ side: '+z', at: -3.2, w: 3.0 }],
  battery: [],
};

/** Cross-section: (outward distance from the wall line, height), m. */
const PROFILE: readonly [number, number][] = [
  [-0.05, -0.1], [0.15, 0.7], [0.45, 1.05], [0.8, 1.15], [1.3, 0.85], [2.1, -0.1],
];
const TAPER_M = 1.3;
const STEP_M = 0.8;

interface Station { x: number; z: number; nx: number; nz: number; f: number }

export class Berms {
  readonly mesh: THREE.Mesh;
  private sig = '';
  /** structures bermed at the last rebuild */
  count = 0;
  /** fired after a rebuild (berms cast shadows) */
  onShadowCastersChanged?: () => void;

  constructor(private hf: Heightfield) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), materials.get('terrain'));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
  }

  update(state: GameState) {
    const on = state.techsDone.includes('regolithShielding');
    const list = on ? state.buildings.filter((b) => SHIELDED[b.type] && (b.construction ?? 0) <= 0) : [];
    const sig = `${state.flattens.length}|` + list.map((b) => `${b.id}:${b.gx},${b.gz},${b.rot}`).join(';');
    if (sig === this.sig) return;
    this.sig = sig;
    this.mesh.geometry.dispose();
    this.mesh.geometry = this.build(list);
    this.mesh.visible = list.length > 0;
    this.count = list.length;
    this.onShadowCastersChanged?.();
  }

  private build(list: readonly BuildingState[]): THREE.BufferGeometry {
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const albedo = this.hf.site.terrain.albedo;
    const P = PROFILE.length;
    for (const b of list) {
      const st = this.stations(b);
      const base: number[] = [];
      for (const s of st) {
        base.push(pos.length / 3);
        for (const [d, h] of PROFILE) {
          const x = s.x + s.nx * d, z = s.z + s.nz * d;
          pos.push(x, this.hf.sample(x, z) + h * s.f - (s.f === 0 ? 0.1 : 0), z);
          const v = 0.9 * regolithAlbedo(albedo, this.hf.craters, x, z);
          col.push(v, v, v * 1.005);
        }
      }
      for (let i = 0; i < st.length; i++) {
        const j = (i + 1) % st.length;
        if (st[i].f === 0 && st[j].f === 0) continue;
        for (let k = 0; k < P - 1; k++) {
          const a = base[i] + k, c = base[j] + k;
          idx.push(a, a + 1, c, c, a + 1, c + 1);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  /** Wall-line stations round the footprint (world), outward normals, and
   *  the height factor f that opens the doors. Corners sweep as arcs. */
  private stations(b: BuildingState): Station[] {
    const [w, d] = BUILDINGS[b.type].footprint;
    const hw = (w * CELL_M) / 2 - 0.1, hd = (d * CELL_M) / 2 - 0.1;
    const gaps = SHIELDED[b.type] ?? [];
    const local: { x: number; z: number; nx: number; nz: number; side: Side; s: number }[] = [];
    // counter-clockwise from the +z face's −x end; s = position along the face
    const faces: { side: Side; ax: number; az: number; tx: number; tz: number; nx: number; nz: number; len: number }[] = [
      { side: '+z', ax: -hw, az: hd, tx: 1, tz: 0, nx: 0, nz: 1, len: 2 * hw },
      { side: '+x', ax: hw, az: hd, tx: 0, tz: -1, nx: 1, nz: 0, len: 2 * hd },
      { side: '-z', ax: hw, az: -hd, tx: -1, tz: 0, nx: 0, nz: -1, len: 2 * hw },
      { side: '-x', ax: -hw, az: -hd, tx: 0, tz: 1, nx: -1, nz: 0, len: 2 * hd },
    ];
    for (const [fi, f] of faces.entries()) {
      const n = Math.max(2, Math.ceil(f.len / STEP_M));
      for (let i = 0; i < n; i++) {
        const u = (i / n) * f.len;
        const x = f.ax + f.tx * u, z = f.az + f.tz * u;
        // along-face coordinate on the recipe's axis (x for ±z faces, z for ±x)
        const s = f.side === '+z' || f.side === '-z' ? x : z;
        local.push({ x, z, nx: f.nx, nz: f.nz, side: f.side, s });
      }
      // the corner at this face's end: sweep the normal to the next face's
      const g = faces[(fi + 1) % 4];
      const cx = f.ax + f.tx * f.len, cz = f.az + f.tz * f.len;
      const a0 = Math.atan2(f.nz, f.nx);
      let a1 = Math.atan2(g.nz, g.nx);
      while (a1 > a0) a1 -= Math.PI * 2;
      for (let k = 0; k <= 4; k++) {
        const a = a0 + ((a1 - a0) * k) / 4;
        local.push({ x: cx, z: cz, nx: Math.cos(a), nz: Math.sin(a), side: f.side, s: Infinity });
      }
    }
    const [cx, cz] = centerOf(b);
    const a = -b.rot * Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
    return local.map((p) => {
      let f = 1;
      for (const gap of gaps) {
        if (gap.side !== p.side || !Number.isFinite(p.s)) continue;
        f = Math.min(f, Math.min(1, Math.max(0, (Math.abs(p.s - gap.at) - gap.w / 2) / TAPER_M)));
      }
      return {
        x: cx + p.x * c + p.z * s, z: cz - p.x * s + p.z * c,
        nx: p.nx * c + p.nz * s, nz: -p.nx * s + p.nz * c, f,
      };
    });
  }
}
