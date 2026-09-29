/** Material registry. Every mesh creator (building instances, terrain chunks,
 *  the horizon ring, rocks) asks here for its surface instead of holding a
 *  material itself, so the render-safety switches reach meshes created at any
 *  time — including the first building of a type placed after safe mode:
 *
 *    define      → the cel style's material for a key: stock Lambert, or one
 *                  of the small custom programs (buildings/celBuilding.ts).
 *                  Set once at import; there is no other style, no shader
 *                  patch and no FX variant.
 *    safe mode   → an unlit MeshBasicMaterial twin (vertex colours kept); a
 *                  lit material nothing registered gets a basic copy
 *    replace     → a custom program failed on this GPU (game.ts
 *                  recoverFromShaderFault): every mesh drawing the key, and
 *                  every mesh made later, takes a stock fallback */
import * as THREE from 'three';

export type MaterialKey = 'building' | 'terrain' | 'rock' | 'ghost' | 'dust' | 'road';

class MaterialRegistry {
  private mats = new Map<MaterialKey, THREE.Material>();
  private twins = new Map<MaterialKey, THREE.Material>();
  private safe = false;
  /** meshes whose unregistered lit material safe mode replaced */
  private replaced = new WeakMap<THREE.Object3D, THREE.Material>();
  /** bumped on every fault fallback or safe-mode change: meshes that render
   *  differently under it poll it */
  revision = 0;

  /** The material for `key` (a later call replaces an earlier one). */
  define(key: MaterialKey, mat: THREE.Material) {
    this.mats.set(key, mat);
    this.twins.delete(key);
  }

  /** Is `key` drawing with its own custom program (not a stock fallback,
   *  not safe mode's unlit twin)? */
  custom(key: MaterialKey): boolean {
    return !this.safe && (this.mats.get(key) as THREE.ShaderMaterial | undefined)?.isShaderMaterial === true;
  }

  /** A custom program failed on this GPU: every mesh under `root` drawing
   *  `key` — and every mesh made later — takes `fallback`. False when `key`
   *  was not a custom program (the fault lies elsewhere). */
  replace(key: MaterialKey, fallback: THREE.Material, root: THREE.Object3D): boolean {
    const old = this.mats.get(key);
    if (!this.custom(key) || !old) return false;
    this.mats.set(key, fallback);
    this.twins.delete(key);
    this.revision++;
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.material === old) mesh.material = fallback;
    });
    return true;
  }

  private twin(key: MaterialKey, mat: THREE.Material): THREE.Material {
    let twin = this.twins.get(key);
    if (!twin) {
      const m = mat as THREE.MeshLambertMaterial;
      twin = m.isMeshLambertMaterial || (mat as THREE.ShaderMaterial).isShaderMaterial
        ? new THREE.MeshBasicMaterial({
          vertexColors: mat.vertexColors, color: m.color ?? 0xffffff, side: mat.side,
          transparent: mat.transparent, opacity: mat.opacity, depthWrite: mat.depthWrite,
        })
        : mat;
      this.twins.set(key, twin);
    }
    return twin;
  }

  /** The material a new mesh should use right now. */
  get(key: MaterialKey): THREE.Material {
    const m = this.mats.get(key);
    if (!m) throw new Error(`material '${key}' not defined`);
    return this.safe ? this.twin(key, m) : m;
  }

  get safeMode(): boolean { return this.safe; }

  /** Switch to unlit twins: everything under `root` now, and every mesh a
   *  creator makes from here on (they all come through get()). */
  enableSafe(root: THREE.Object3D) {
    this.safe = true;
    this.revision++;
    const twins = new Map<THREE.Material, THREE.Material>();
    for (const [key, m] of this.mats) twins.set(m, this.twin(key, m));
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.Material | undefined;
      if (!mat || Array.isArray(mat)) return;
      const twin = twins.get(mat);
      if (twin) mesh.material = twin;
      else if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial
        || (mat as THREE.MeshLambertMaterial).isMeshLambertMaterial) {
        this.replaced.set(mesh, mat);
        mesh.material = new THREE.MeshBasicMaterial({
          vertexColors: mat.vertexColors, color: (mat as THREE.MeshStandardMaterial).color,
        });
      }
    });
  }

  /** Back to lit materials under `root` (the player turned safe mode off). */
  disableSafe(root: THREE.Object3D) {
    if (!this.safe) return;
    this.safe = false;
    this.revision++;
    const lit = new Map<THREE.Material, THREE.Material>();
    for (const [key, twin] of this.twins) {
      const m = this.mats.get(key);
      if (m && twin !== m) lit.set(twin, m);
    }
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.Material | undefined;
      if (mat && !Array.isArray(mat)) {
        const back = lit.get(mat) ?? this.replaced.get(mesh);
        if (back) mesh.material = back;
        (mesh.material as THREE.Material).needsUpdate = true;
      }
      this.replaced.delete(mesh);
    });
  }

  // ── DEPRECATED, deleted with the game.ts pass (W0b1 M3): game.ts still
  // calls these; the cel style has no patches, no FX level and no second
  // style, so each answers "none".
  setClassic(_on: boolean) { /* one style */ }
  clearFault() { /* no patches to fault */ }
  setFxLevel(_level: number) { /* no FX ladder */ }
  stripPatches(): boolean { return false; }
  patched(_key: MaterialKey): boolean { return false; }
  variants(): Record<string, string | null> { return {}; }
  get patchesFaulted(): boolean { return false; }
  get fxLevel(): number { return 3; }
  classicCustom(key: MaterialKey): boolean { return this.custom(key); }
  replaceClassic(key: MaterialKey, fallback: THREE.Material, root: THREE.Object3D): boolean {
    return this.replace(key, fallback, root);
  }
}

export const materials = new MaterialRegistry();

/** @deprecated with the deprecated members above: game.ts still imports it. */
export const PATCH_MARKER = 'MBB_PATCHED';
