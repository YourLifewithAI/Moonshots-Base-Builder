/** Material registry. Every mesh creator (building instances, terrain chunks,
 *  later rocks and the horizon) asks here for its surface instead of holding a
 *  material itself, so the render-safety switches reach meshes created at any
 *  time — including the first building of a type placed after safe mode:
 *
 *    safe mode   → an unlit MeshBasicMaterial twin (vertex colors kept)
 *    FX level    → which shader-patch variant a lit material compiles with
 *    patch fault → a GPU rejected a patched shader: every patch is stripped
 *                  back to the stock three.js shader (remembered across
 *                  launches, cleared by an explicit FX-level choice) */
import * as THREE from 'three';

export type MaterialKey = 'building' | 'terrain';

/** Installs a shader patch on its material for an FX level. Returns a cache
 *  key naming the variant, or null when that level runs the stock shader. */
export type ShaderPatch = (mat: THREE.MeshStandardMaterial, level: number) => string | null;

/** Every patched shader carries this define; a compile error whose source
 *  contains it is a patch fault, not a driver/post-chain fault. */
export const PATCH_MARKER = 'MBB_PATCHED';

const FAULT_KEY = 'mbb-patch-fault';

interface Entry {
  lit: THREE.MeshStandardMaterial;
  patch?: ShaderPatch;
  basic?: THREE.MeshBasicMaterial;
  variant: string | null;
}

function storedFault(): boolean {
  try { return localStorage.getItem(FAULT_KEY) === '1'; } catch { return false; }
}

const STOCK_COMPILE = THREE.Material.prototype.onBeforeCompile;
const STOCK_KEY = THREE.Material.prototype.customProgramCacheKey;

class MaterialRegistry {
  private entries = new Map<MaterialKey, Entry>();
  private level = 0;
  private safe = false;
  private faulted = storedFault();

  define(key: MaterialKey, lit: THREE.MeshStandardMaterial, patch?: ShaderPatch) {
    const e: Entry = { lit, patch, variant: null };
    this.entries.set(key, e);
    this.install(e);
  }

  /** The material a new mesh should use right now. */
  get(key: MaterialKey): THREE.Material {
    const e = this.entries.get(key);
    if (!e) throw new Error(`material '${key}' not defined`);
    return this.safe ? this.twin(e) : e.lit;
  }

  /** The lit material, whatever mode is active (for per-frame uniform tweaks). */
  lit(key: MaterialKey): THREE.MeshStandardMaterial | undefined {
    return this.entries.get(key)?.lit;
  }

  get safeMode(): boolean { return this.safe; }
  get patchesFaulted(): boolean { return this.faulted; }

  /** Active shader-patch variant per material (debug/probes). */
  variants(): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const [k, e] of this.entries) out[k] = e.variant;
    return out;
  }

  private twin(e: Entry): THREE.MeshBasicMaterial {
    e.basic ??= new THREE.MeshBasicMaterial({
      vertexColors: e.lit.vertexColors, color: e.lit.color, side: e.lit.side,
    });
    return e.basic;
  }

  private install(e: Entry) {
    const variant = !this.faulted && e.patch ? e.patch(e.lit, this.level) : null;
    if (variant === null) {
      e.lit.onBeforeCompile = STOCK_COMPILE;
      e.lit.customProgramCacheKey = STOCK_KEY;
    } else {
      e.lit.customProgramCacheKey = () => variant;
    }
    if (variant !== e.variant) e.lit.needsUpdate = true;
    e.variant = variant;
  }

  setFxLevel(level: number) {
    this.level = level;
    for (const e of this.entries.values()) this.install(e);
  }

  /** A patched shader failed to compile: fall back to stock shaders for good.
   *  Returns false when nothing was patched (the fault lies elsewhere). */
  stripPatches(): boolean {
    const any = [...this.entries.values()].some((e) => e.variant !== null);
    this.faulted = true;
    try { localStorage.setItem(FAULT_KEY, '1'); } catch { /* session-only then */ }
    for (const e of this.entries.values()) this.install(e);
    return any;
  }

  /** An explicit FX choice (settings / ?fx= / debug) retries the patches. */
  clearFault() {
    if (!this.faulted) return;
    this.faulted = false;
    try { localStorage.removeItem(FAULT_KEY); } catch { /* fine */ }
    for (const e of this.entries.values()) this.install(e);
  }

  /** Switch to unlit twins: everything under `root` now, and every mesh a
   *  creator makes from here on (they all come through get()). */
  enableSafe(root: THREE.Object3D) {
    this.safe = true;
    const twins = new Map<THREE.Material, THREE.Material>();
    for (const e of this.entries.values()) twins.set(e.lit, this.twin(e));
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.Material | undefined;
      if (!mat || Array.isArray(mat)) return;
      const twin = twins.get(mat);
      if (twin) mesh.material = twin;
      else if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        mesh.material = new THREE.MeshBasicMaterial({
          vertexColors: mat.vertexColors, color: (mat as THREE.MeshStandardMaterial).color,
        });
      }
    });
  }
}

export const materials = new MaterialRegistry();
