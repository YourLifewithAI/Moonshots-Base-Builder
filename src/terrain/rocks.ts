/** Boulder scatter: instanced procedural rocks for scale and depth in a
 *  fog-free world.
 *
 *  - Two noise-displaced polyhedra (small: a 36-facet dodecahedron, large:
 *    an 80-facet icosahedron), varied by per-instance rotation, squash and
 *    albedo — flat-shaded, stock material from the registry plus the night
 *    floods (safe mode gets its unlit twin).
 *  - Sizes follow power laws (N(>D) ∝ D^−α); a sparse background field
 *    thins toward the landing site (the descent engine swept it), and the
 *    blocks crowd crater rims and ejecta, largest on the biggest craters.
 *  - Small rocks (< 1 m) are one InstancedMesh refilled with those within
 *    range of the camera; large rocks are one static mesh and the only ones
 *    that cast shadows. Two draw calls, plus one in the shadow pass.
 *  - Building pads and graded patches clear what they cover (and resettle
 *    the rocks on their feathered skirts); load replays the same flattens.
 *  - Density by FX level: 0–1 full, 2 half the small rocks, 3 and safe
 *    mode a quarter. Large rocks stay at every level.
 *  - Classic style: stock flat Lambert (the facets are the geometry's),
 *    tinted a little lighter than the classic ground they sit on; half the
 *    small rocks, drawn round the view's focus (the isometric camera stands
 *    hundreds of metres off) and not at all once they would be specks. */
import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { CELL_M, MAP_M } from '../data/balance';
import { mulberry32, type Rng } from '../core/rng';
import { materials } from '../world/materials';
import { floodPatch } from '../world/floodlights';
import type { Heightfield } from './heightfield';
import { classicActive } from '../core/style';
import { classicGround } from './classicGround';

materials.define('rock', new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 }), floodPatch);

const HALF = MAP_M / 2;
const LARGE_D = 1.0;          // m: rocks this size and up cast shadows
const SMALL_RANGE = 300;      // m from the camera
const REFILL_M = 20;          // camera travel before the small set refills
const SMALL_DENSITY = [1, 1, 0.5, 0.25];

/** D from a truncated power law, cumulative N(>D) ∝ D^−alpha. */
function powerLaw(rng: Rng, dMin: number, dMax: number, alpha: number): number {
  const k = 1 - (dMin / dMax) ** alpha;
  return dMin / Math.pow(1 - rng() * k, 1 / alpha);
}

function rockGeometry(g: THREE.PolyhedronGeometry, seed: number): THREE.BufferGeometry {
  const noise = createNoise3D(mulberry32(seed));
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // position-keyed displacement: a corner shared by facets moves as one
    const k = 1 + 0.24 * noise(x * 1.1, y * 1.1, z * 1.1) + 0.09 * noise(x * 2.7 + 5, y * 2.7, z * 2.7);
    let ny = y * k;
    if (ny < -0.35) ny = -0.35 + (ny + 0.35) * 0.3; // a flattened, buried base
    p.setXYZ(i, x * k, ny, z * k);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals(); // non-indexed: flat facets
  return g;
}

interface RockSet {
  mesh: THREE.InstancedMesh;
  x: Float32Array; z: Float32Array; d: Float32Array; rank: Float32Array;
  removed: Uint8Array;
  matrices: Float32Array;   // 16 per rock, composed once
  colors: Float32Array;     // 3 per rock
}

export class Rocks {
  readonly group = new THREE.Group();
  private small: RockSet;
  private large: RockSet;
  private level = 0;
  private safe = false;
  private refillAt = new THREE.Vector3(Infinity, 0, 0);
  /** fired when large rocks were cleared (they cast shadows) */
  onShadowCastersChanged?: () => void;

  constructor(private hf: Heightfield) {
    const rng = mulberry32(hf.seed ^ 0x60c45);
    const t = hf.site.terrain;
    const rocky = 0.4 + 0.45 * t.roughness;
    const list: { x: number; z: number; d: number; fresh: number }[] = [];
    const inMap = (x: number, z: number) => Math.abs(x) < HALF - CELL_M && Math.abs(z) < HALF - CELL_M;

    // background field, swept thin around the landing site
    for (let i = 0, n = Math.round(6000 * rocky); i < n; i++) {
      const x = (rng() - 0.5) * MAP_M, z = (rng() - 0.5) * MAP_M;
      const r = Math.hypot(x, z);
      if (r < 45 && rng() > Math.max(0, (r - 10) / 35) ** 1.5) continue;
      if (inMap(x, z)) list.push({ x, z, d: powerLaw(rng, 0.25, 2.0, 2.0), fresh: 0 });
    }
    // crater blocks: most just outside the rim, a few slumped down the wall;
    // bigger craters dug deeper and threw bigger blocks
    for (const c of hf.craters) {
      const n = Math.round(2 * rocky * c.r ** 1.3);
      const dMax = Math.min(4, 0.3 + 0.06 * c.r);
      for (let i = 0; i < n; i++) {
        const ang = rng() * Math.PI * 2;
        const g = Math.abs(rng() + rng() + rng() - 1.5) / 0.5; // ~half-normal
        const dist = c.r * (rng() < 0.15 ? 0.55 + 0.45 * rng() : 1 + 0.45 * g);
        const x = c.cx + Math.cos(ang) * dist, z = c.cz + Math.sin(ang) * dist;
        if (inMap(x, z)) list.push({ x, z, d: powerLaw(rng, 0.4, dMax, 1.7), fresh: 1 });
      }
    }

    const albedo = t.albedo;
    const ground = classicActive() ? classicGround(hf) : null;
    const gc = [0, 0, 0];
    const make = (items: typeof list, geo: THREE.BufferGeometry): RockSet => {
      const n = items.length;
      const set: RockSet = {
        mesh: new THREE.InstancedMesh(geo, materials.get('rock'), Math.max(1, n)),
        x: new Float32Array(n), z: new Float32Array(n), d: new Float32Array(n),
        rank: new Float32Array(n), removed: new Uint8Array(n),
        matrices: new Float32Array(n * 16), colors: new Float32Array(n * 3),
      };
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      const s = new THREE.Vector3(), p = new THREE.Vector3();
      items.forEach((it, i) => {
        set.x[i] = it.x; set.z[i] = it.z; set.d[i] = it.d; set.rank[i] = rng();
        const squash = 0.6 + 0.35 * rng();
        s.set(0.5 * it.d * (0.8 + 0.4 * rng()), 0.5 * it.d * squash, 0.5 * it.d * (0.8 + 0.4 * rng()));
        // settle into the slope: tilt partly with the ground, bury the downhill side
        const gx = this.hf.sample(it.x + 1, it.z) - this.hf.sample(it.x - 1, it.z);
        const gz = this.hf.sample(it.x, it.z + 1) - this.hf.sample(it.x, it.z - 1);
        e.set(-gz * 0.25 + (rng() - 0.5) * 0.3, rng() * Math.PI * 2, gx * 0.25 + (rng() - 0.5) * 0.3, 'ZXY');
        q.setFromEuler(e);
        const slope = Math.hypot(gx, gz) / 2;
        p.set(it.x, this.hf.sample(it.x, it.z) - s.y * (0.3 + 0.8 * slope), it.z);
        m.compose(p, q, s);
        m.toArray(set.matrices, i * 16);
        // unweathered rock outshines the gardened regolith; fresh ejecta most
        const k = it.fresh ? 1.5 + 0.7 * rng() : 1.2 + 0.5 * rng();
        if (ground) {
          // classic: the ground's own colour, lifted and a little greyer
          ground.color(it.x, it.z, p.y, 1, gc, 0);
          const lift = 0.85 + 0.25 * k, grey = (gc[0] + gc[1] + gc[2]) / 3;
          for (let c = 0; c < 3; c++) set.colors[i * 3 + c] = Math.min(0.9, (gc[c] * 0.7 + grey * 0.3) * lift);
        } else {
          const v = albedo * k;
          set.colors[i * 3] = v; set.colors[i * 3 + 1] = v; set.colors[i * 3 + 2] = v * 1.01;
        }
      });
      set.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      set.mesh.setColorAt(0, new THREE.Color(0, 0, 0)); // allocates instanceColor
      set.mesh.receiveShadow = true;
      set.mesh.count = 0;
      this.group.add(set.mesh);
      return set;
    };
    this.small = make(list.filter((r) => r.d < LARGE_D), rockGeometry(new THREE.DodecahedronGeometry(1, 0), 0x5a11));
    this.large = make(list.filter((r) => r.d >= LARGE_D), rockGeometry(new THREE.IcosahedronGeometry(1, 1), 0xb16));
    this.large.mesh.castShadow = true;
    this.fill(this.large, null);
  }

  /** Scene shaders ride the FX ladder; rocks thin with it. */
  setFxLevel(level: number) {
    this.level = level;
    this.refillAt.set(Infinity, 0, 0);
  }

  setSafe(safe: boolean) {
    this.safe = safe;
    this.refillAt.set(Infinity, 0, 0);
  }

  private get smallDensity(): number {
    return this.safe ? SMALL_DENSITY[3] : SMALL_DENSITY[Math.min(3, this.level)];
  }

  /** Per frame: refill the small set once the camera has moved on. The
   *  classic isometric view passes its focus on the ground instead of the
   *  camera, and null when it stands too far off for small rocks at all. */
  update(camera: THREE.Camera, focus?: THREE.Vector3 | null) {
    if (focus === null) {
      if (this.small.mesh.count) { this.small.mesh.count = 0; this.refillAt.set(Infinity, 0, 0); }
      return;
    }
    const p = focus ?? camera.position;
    if (p.distanceToSquared(this.refillAt) < REFILL_M * REFILL_M) return;
    this.refillAt.copy(p);
    this.fill(this.small, p);
  }

  private fill(set: RockSet, near: THREE.Vector3 | null) {
    const arr = set.mesh.instanceMatrix.array as Float32Array;
    const col = set.mesh.instanceColor!.array as Float32Array;
    const density = near ? this.smallDensity : 1;
    const r2 = (SMALL_RANGE + REFILL_M) ** 2;
    let n = 0;
    for (let i = 0; i < set.x.length; i++) {
      if (set.removed[i] || set.rank[i] >= density) continue;
      if (near) {
        const dx = set.x[i] - near.x, dz = set.z[i] - near.z, dy = set.matrices[i * 16 + 13] - near.y;
        if (dx * dx + dy * dy + dz * dz > r2) continue;
      }
      arr.set(set.matrices.subarray(i * 16, i * 16 + 16), n * 16);
      col.set(set.colors.subarray(i * 3, i * 3 + 3), n * 3);
      n++;
    }
    set.mesh.count = n;
    set.mesh.instanceMatrix.needsUpdate = true;
    set.mesh.instanceColor!.needsUpdate = true;
    set.mesh.computeBoundingSphere();
  }

  /** A pad or graded patch flattened cells [gx0..gx1) × [gz0..gz1): rocks on
   *  it go, rocks on its two-cell skirt settle onto the new ground. */
  clearRect(gx0: number, gz0: number, gx1: number, gz1: number) {
    const x0 = gx0 * CELL_M - HALF, x1 = gx1 * CELL_M - HALF;
    const z0 = gz0 * CELL_M - HALF, z1 = gz1 * CELL_M - HALF;
    const skirt = 2 * CELL_M + 1;
    let largeChanged = false;
    for (const set of [this.small, this.large]) {
      let changed = false;
      for (let i = 0; i < set.x.length; i++) {
        if (set.removed[i]) continue;
        const x = set.x[i], z = set.z[i], pad = 0.5 * set.d[i] + 0.5;
        if (x < x0 - skirt - pad || x > x1 + skirt + pad || z < z0 - skirt - pad || z > z1 + skirt + pad) continue;
        changed = true;
        if (x > x0 - pad && x < x1 + pad && z > z0 - pad && z < z1 + pad) {
          set.removed[i] = 1;
        } else {
          const o = i * 16;
          const sy = Math.hypot(set.matrices[o + 4], set.matrices[o + 5], set.matrices[o + 6]);
          set.matrices[o + 13] = this.hf.sample(x, z) - sy * 0.3;
        }
      }
      if (!changed) continue;
      if (set === this.large) { largeChanged = true; this.fill(set, null); }
      else this.refillAt.set(Infinity, 0, 0);
    }
    if (largeChanged) this.onShadowCastersChanged?.();
  }

  /** Boulders big enough to walk into, as upright cylinders (walk mode). */
  colliders(): { x: number; z: number; r: number; top: number }[] {
    const out: { x: number; z: number; r: number; top: number }[] = [];
    const set = this.large;
    for (let i = 0; i < set.x.length; i++) {
      if (set.removed[i] || set.d[i] < 1.2) continue;
      const o = i * 16;
      const sy = Math.hypot(set.matrices[o + 4], set.matrices[o + 5], set.matrices[o + 6]);
      out.push({ x: set.x[i], z: set.z[i], r: 0.4 * set.d[i], top: set.matrices[o + 13] + 1.2 * sy });
    }
    return out;
  }

  /** Rocks still standing with centers in the world rect (tests, probes). */
  countIn(x0: number, z0: number, x1: number, z1: number): number {
    let n = 0;
    for (const set of [this.small, this.large]) {
      for (let i = 0; i < set.x.length; i++) {
        if (!set.removed[i] && set.x[i] >= x0 && set.x[i] <= x1 && set.z[i] >= z0 && set.z[i] <= z1) n++;
      }
    }
    return n;
  }

  stats() {
    return {
      small: this.small.x.length, large: this.large.x.length,
      smallDrawn: this.small.mesh.count, largeDrawn: this.large.mesh.count,
      smallDensity: this.smallDensity,
      largeCastShadow: this.large.mesh.castShadow,
      material: (this.large.mesh.material as THREE.Material).type,
    };
  }
}
