/** Material registry. Every mesh creator (building instances, terrain chunks,
 *  the horizon ring, rocks) asks here for its surface instead of holding a
 *  material itself, so the render-safety switches reach meshes created at any
 *  time — including the first building of a type placed after safe mode:
 *
 *    safe mode   → an unlit MeshBasicMaterial twin (vertex colors kept); a
 *                  patched helper material (shadow depth, placement ghost)
 *                  gets a stock, unpatched copy instead
 *    FX level    → which shader-patch variant a lit material compiles with
 *    patch fault → a GPU rejected a patched shader: every patch is stripped
 *                  back to the stock three.js shader (remembered across
 *                  launches, cleared by an explicit FX-level choice) */
import * as THREE from 'three';

export type MaterialKey = 'building' | 'buildingDepth' | 'terrain' | 'rock' | 'ghost' | 'dust';

/** Installs a shader patch on its material for an FX level. Returns a cache
 *  key naming the variant, or null when that level runs the stock shader. */
export type ShaderPatch<M extends THREE.Material = THREE.MeshStandardMaterial> =
  (mat: M, level: number) => string | null;

/** Every patched shader carries this define; a compile error whose source
 *  contains it is a patch fault, not a driver/post-chain fault. */
export const PATCH_MARKER = 'MBB_PATCHED';

const FAULT_KEY = 'mbb-patch-fault';

type Edit = [anchor: string, add: string, before?: boolean];

/** Replace every anchor or none: a partial patch would not compile. */
export function injectAll(src: string, edits: Edit[]): string | null {
  let out = src;
  for (const [anchor, add, before] of edits) {
    if (!out.includes(anchor)) return null;
    out = out.replace(anchor, before ? `${add}\n${anchor}` : `${anchor}\n${add}`);
  }
  return out;
}

/** Do a stock template's anchors all exist? A patch checks before claiming a
 *  variant, so an upgrade that moves an anchor leaves the stock shader (and
 *  its fallbacks) in charge instead of a variant that never injected. */
export function hasAnchors(template: string, edits: Edit[]): boolean {
  return edits.every(([anchor]) => template.includes(anchor));
}

interface Entry {
  lit: THREE.Material;
  patch?: ShaderPatch<THREE.Material>;
  /** safe-mode twin: unlit MeshBasic for a lit material, else a stock copy */
  basic?: THREE.Material;
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
  /** meshes whose unregistered lit material safe mode replaced */
  private replaced = new WeakMap<THREE.Object3D, THREE.Material>();
  /** bumped on every change of variant, fault or safe mode — meshes that
   *  render differently with and without a patch poll it */
  revision = 0;

  define<M extends THREE.Material>(key: MaterialKey, lit: M, patch?: ShaderPatch<M>) {
    const e: Entry = { lit, patch: patch as ShaderPatch<THREE.Material> | undefined, variant: null };
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
  lit(key: MaterialKey): THREE.Material | undefined {
    return this.entries.get(key)?.lit;
  }

  /** Is `key` drawing with its shader patch right now (not stock, not safe)? */
  patched(key: MaterialKey): boolean {
    return !this.safe && (this.entries.get(key)?.variant ?? null) !== null;
  }

  get safeMode(): boolean { return this.safe; }
  get fxLevel(): number { return this.level; }
  get patchesFaulted(): boolean { return this.faulted; }

  /** Active shader-patch variant per material (debug/probes). */
  variants(): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const [k, e] of this.entries) out[k] = e.variant;
    return out;
  }

  private twin(e: Entry): THREE.Material {
    if (!e.basic) {
      const lit = e.lit as THREE.MeshStandardMaterial;
      if (lit.isMeshStandardMaterial) {
        e.basic = new THREE.MeshBasicMaterial({
          vertexColors: lit.vertexColors, color: lit.color, side: lit.side,
        });
      } else {
        e.basic = e.lit.clone();
        e.basic.onBeforeCompile = STOCK_COMPILE;
        e.basic.customProgramCacheKey = STOCK_KEY;
      }
    }
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
    if (variant !== e.variant) {
      e.lit.needsUpdate = true;
      this.revision++;
    }
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
    this.revision++;
    const twins = new Map<THREE.Material, THREE.Material>();
    for (const e of this.entries.values()) twins.set(e.lit, this.twin(e));
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.Material | undefined;
      if (!mat || Array.isArray(mat)) return;
      const twin = twins.get(mat);
      if (twin) mesh.material = twin;
      else if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        this.replaced.set(mesh, mat);
        mesh.material = new THREE.MeshBasicMaterial({
          vertexColors: mat.vertexColors, color: (mat as THREE.MeshStandardMaterial).color,
        });
      }
    });
  }

  /** Back to lit materials under `root` (the player turned safe mode off).
   *  Every material recompiles, since shadows come back with it. */
  disableSafe(root: THREE.Object3D) {
    if (!this.safe) return;
    this.safe = false;
    this.revision++;
    const lit = new Map<THREE.Material, THREE.Material>();
    for (const e of this.entries.values()) if (e.basic) lit.set(e.basic, e.lit);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.Material | undefined;
      if (mat && !Array.isArray(mat)) {
        const back = lit.get(mat) ?? this.replaced.get(mesh);
        if (back) mesh.material = back;
        (mesh.material as THREE.Material).needsUpdate = true;
      }
      const depth = mesh.customDepthMaterial && lit.get(mesh.customDepthMaterial);
      if (depth) mesh.customDepthMaterial = depth;
      this.replaced.delete(mesh);
    });
  }
}

export const materials = new MaterialRegistry();
