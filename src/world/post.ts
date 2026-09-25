/** Post chain with a degradation ladder. Not every GPU/driver runs the full
 *  chain; instead of all-or-nothing we walk down until something renders:
 *
 *    level 0 — half-float buffers · half-res AO · bloom · SMAA/AgX/grain/vignette  (the full look)
 *    level 1 — standard buffers   · half-res AO · SMAA/AgX/grain/vignette          (half-float unsupported)
 *    level 2 — standard buffers   · no AO                                          (AO shader unsupported)
 *    level 3 — plain forward rendering, AgX in the material shaders                (composer unsupported)
 *
 *  Scene shader patches follow the same ladder (see world/materials.ts). The
 *  black-frame sentinel in game.ts drives descent; a throwing composer
 *  descends too. The working level persists to localStorage so later launches
 *  boot straight into it — no black flash while re-discovering.
 *
 *  A raise (menu, ?fx=, debug) is a trial: the level it left stays stored
 *  until a probe of the new one passes (confirm), and a failure goes straight
 *  back to it (revert). Safe mode draws plain whatever the level and never
 *  builds the composer; leaving it rebuilds the chain for the level.
 *
 *  The classic render style has no ladder at all: it draws the plain
 *  forward path straight to the (MSAA) canvas, never builds the composer,
 *  never reads or stores a level, and never steps — so it raises no
 *  "RENDER —" alert unless a frame genuinely fails to draw. */
import * as THREE from 'three';
import {
  BlendFunction, BloomEffect, EffectComposer, EffectPass, NoiseEffect, RenderPass,
  SMAAEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

const STORE_KEY = 'mbb-fx-level';
export const FX_PLAIN = 3;

const LEVEL_ALERTS: Record<number, string> = {
  1: 'RENDER — high-precision buffers unavailable, effects retrying in standard precision',
  2: 'RENDER — ambient occlusion disabled (GPU limitation)',
  3: 'RENDER — effects disabled, using plain rendering',
};

const reasonText = (r: unknown) => (r instanceof Error ? r.message : r ? String(r) : 'render error');

function storedLevel(): number {
  try {
    const v = Number(localStorage.getItem(STORE_KEY));
    return Number.isInteger(v) && v >= 0 && v <= FX_PLAIN ? v : 0;
  } catch { return 0; }
}

/** Why the level changed: the player's pick, a step down, a failed trial
 *  going back. */
export type LevelCause = 'choice' | 'descent' | 'revert';

/** A probe of the frame just drawn: black, fine, or too little ground in
 *  view to tell. */
export type ProbeVerdict = 'black' | 'ok' | 'unknown';

export interface PostOptions {
  lowFx: boolean;
  /** ?fx=: an explicit level for this launch (a raise is still a trial) */
  fxOverride?: number;
  /** the player's own level (menu): never boot above it */
  fxChoice?: number;
  /** safe render mode from the first frame: no composer at all */
  safe?: boolean;
  /** the classic render style: plain forward rendering, no ladder */
  classic?: boolean;
}

export class PostFX {
  private composer: EffectComposer | null = null;
  /** the ladder's level: what the composer is built for outside safe mode */
  private level: number;
  /** mirror of the stored level */
  private saved = storedLevel();
  /** a raise on trial: the level to go back to if it fails */
  private trialFrom: number | null = null;
  private safe: boolean;
  /** classic style: no composer and no ladder, ever */
  private readonly classic: boolean;
  /** scene render errors already reported (each is reported once) */
  private sceneFaults = new Set<string>();
  /** surfaced into the in-game alert stack so players see render issues without F12 */
  onIssue?: (msg: string) => void;
  /** every change of the ladder level; `failed` = the levels that just
   *  failed (a descent's rung, a trial's level), `reason` their cause */
  onLevelChange?: (level: number, cause: LevelCause, reason?: string, failed?: number[]) => void;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    opts: PostOptions,
  ) {
    this.safe = opts.safe ?? false;
    this.classic = opts.classic ?? false;
    if (this.classic) {
      // the stored level stays the High detail ladder's, untouched
      this.level = FX_PLAIN;
      console.log('[MOONSHOTS] Classic render style — forward rendering to the canvas, no post chain');
      return;
    }
    this.level = Math.min(FX_PLAIN, Math.max(this.saved, opts.lowFx ? 2 : 0, opts.fxChoice ?? 0));
    const o = opts.fxOverride;
    if (o !== undefined && Number.isFinite(o)) this.moveTo(Math.min(FX_PLAIN, Math.max(0, Math.round(o))));
    console.log(`[MOONSHOTS] FX level ${this.fxLevel} (0=full … 3=plain)${this.safe ? ' — safe mode' : ''}`);
    this.buildComposer();
  }

  /** The level being drawn: plain in safe mode. */
  get fxLevel(): number { return this.safe ? FX_PLAIN : this.level; }
  /** The ladder's level, which leaving safe mode returns to. */
  get ladderLevel(): number { return this.level; }
  /** The ladder level stored for the next launch. */
  get storedLevel(): number { return this.saved; }
  /** A raise is waiting for its probe (it is not stored yet). */
  get onTrial(): boolean { return this.trialFrom !== null; }
  /** Is the effect composer built (not safe mode, not plain)? */
  get chainBuilt(): boolean { return this.composer !== null; }
  get usingFallback(): boolean { return this.fxLevel >= FX_PLAIN; }

  private store(v: number) {
    this.saved = v;
    try { localStorage.setItem(STORE_KEY, String(v)); } catch { /* fine */ }
  }

  /** The level on disk: a trial's origin while one runs (never below the
   *  last level known to draw), else the level itself. */
  private storeLevel() {
    this.store(this.trialFrom === null ? this.level : Math.max(this.saved, this.trialFrom));
  }

  /** An explicit move: lowering is kept at once; a raise is on trial. */
  private moveTo(n: number) {
    const from = this.level;
    this.level = n;
    if (n < from) this.trialFrom ??= from;
    if (this.trialFrom !== null && n >= this.trialFrom) this.trialFrom = null;
    this.storeLevel();
  }

  private disposeComposer() {
    if (!this.composer) return;
    try { this.composer.dispose(); } catch { /* best effort */ }
    this.composer = null;
    // the composer leaves autoClear disabled; plain rendering needs it back
    this.renderer.autoClear = true;
    this.renderer.setRenderTarget(null);
  }

  private buildComposer() {
    this.disposeComposer();
    if (this.classic || this.safe || this.level >= FX_PLAIN) return;
    try {
      const frameBufferType = this.level === 0 ? THREE.HalfFloatType : THREE.UnsignedByteType;
      const composer = new EffectComposer(this.renderer, { frameBufferType });
      composer.addPass(new RenderPass(this.scene, this.camera));
      if (this.level < 2) {
        try {
          const ao = new N8AOPostPass(this.scene, this.camera, window.innerWidth, window.innerHeight);
          // transparent layers write no depth and stay out of the AO; left on
          // auto, N8AO finds one and draws the scene twice more every frame
          ao.autoDetectTransparency = false;
          ao.configuration.transparencyAware = false;
          ao.configuration.aoRadius = 3.0;
          ao.configuration.intensity = 2.5;
          ao.configuration.distanceFalloff = 1.0;
          // half resolution + depth-aware upsample: Medium costs less than
          // full-res Low did
          ao.configuration.halfRes = true;
          ao.configuration.depthAwareUpsampling = true;
          ao.setQualityMode('Medium');
          composer.addPass(ao);
        } catch (e) {
          console.warn('[MOONSHOTS] Ambient occlusion unavailable, continuing without it.', e);
        }
      }
      if (this.level === 0) {
        // HDR-only: sunlit white hull peaks near 1.5 in half-float buffers, so
        // only emissives (and the sun disc) pass this threshold
        try {
          const bloom = new BloomEffect({
            blendFunction: BlendFunction.ADD, mipmapBlur: true,
            luminanceThreshold: 2.0, luminanceSmoothing: 0.2, intensity: 0.6,
          });
          composer.addPass(new EffectPass(this.camera, bloom));
        } catch (e) {
          console.warn('[MOONSHOTS] Bloom unavailable, continuing without it.', e);
        }
      }
      try {
        // SMAA first: it re-reads the input buffer at edges, which would drop
        // any effect merged ahead of it. The composer bypasses the renderer's
        // tone mapping, so AgX runs here.
        const smaa = new SMAAEffect();
        const agx = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
        const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true });
        grain.blendMode.opacity.value = 0.14;
        const vignette = new VignetteEffect({ offset: 0.28, darkness: 0.52 });
        composer.addPass(new EffectPass(this.camera, smaa, agx, grain, vignette));
      } catch (e) {
        console.warn('[MOONSHOTS] Film effects unavailable, continuing without them.', e);
      }
      composer.setSize(window.innerWidth, window.innerHeight);
      this.composer = composer;
    } catch (e) {
      console.warn('[MOONSHOTS] Effect composer failed to build.', e);
      this.composer = null;
    }
  }

  /** Step one rung down the ladder. Returns false if already at plain. */
  degrade(reason?: unknown): boolean {
    if (this.classic || this.level >= FX_PLAIN) return false;
    const failed = this.level;
    this.level++;
    if (this.trialFrom !== null && this.level >= this.trialFrom) this.trialFrom = null;
    this.storeLevel();
    console.warn(`[MOONSHOTS] Render degraded to FX level ${this.level}.`, reason ?? '');
    const msg = LEVEL_ALERTS[this.level];
    if (msg) this.onIssue?.(msg);
    this.buildComposer();
    this.onLevelChange?.(this.level, 'descent', reasonText(reason), [failed]);
    return true;
  }

  /** The live level failed (black frame, shader error, throwing pass): a
   *  raise on trial goes straight back, anything else steps one rung down.
   *  False when there is nothing lower to go to. */
  fail(reason?: unknown): boolean {
    if (this.classic) return false;
    if (this.trialFrom === null) return this.degrade(reason);
    const failed = this.level;
    this.level = this.trialFrom;
    this.trialFrom = null;
    this.storeLevel();
    console.warn(`[MOONSHOTS] FX level ${failed} failed its check — back to FX ${this.level}.`, reason ?? '');
    this.onIssue?.(`RENDER — FX ${failed} did not draw (${reasonText(reason)}), back to FX ${this.level}`);
    this.buildComposer();
    this.onLevelChange?.(this.level, 'revert', reasonText(reason), [failed]);
    return true;
  }

  /** The live level drew a healthy frame: a raise on trial is kept. */
  confirm() {
    if (this.trialFrom === null) return;
    this.trialFrom = null;
    this.storeLevel();
  }

  /** Explicitly set a level (debug hook / settings). */
  setLevel(n: number) {
    if (this.classic) return;
    this.moveTo(Math.min(FX_PLAIN, Math.max(0, Math.round(n))));
    this.buildComposer();
    this.onLevelChange?.(this.level, 'choice');
  }

  /** Jump straight to plain rendering (throwing-driver path, debug hook). */
  forceFallback(reason?: unknown) {
    if (this.classic || this.level >= FX_PLAIN) return;
    const failed: number[] = [];
    for (let l = this.level; l < FX_PLAIN; l++) failed.push(l);
    this.level = FX_PLAIN;
    this.trialFrom = null;
    this.storeLevel();
    console.warn('[MOONSHOTS] Post-processing disabled — plain rendering.', reason ?? '');
    this.onIssue?.(LEVEL_ALERTS[FX_PLAIN]);
    this.disposeComposer();
    this.onLevelChange?.(this.level, 'descent', reasonText(reason), failed);
  }

  /** Safe mode draws plain, whatever the level: no composer at all. */
  setSafe(on: boolean) {
    if (on === this.safe) return;
    this.safe = on;
    this.buildComposer();
  }

  setSize(w: number, h: number) {
    try { this.composer?.setSize(w, h); } catch { /* plain path unaffected */ }
  }

  /** Draw a frame; false when nothing was drawn (the frame is not probed). */
  render(dt: number): boolean {
    if (this.composer) {
      try {
        this.composer.render(dt);
        return true;
      } catch (e) {
        // the chain or the scene? A plain render tells them apart: only a
        // chain that throws over a scene that draws is the chain's fault
        if (!this.renderPlain()) return false;
        this.fail(e);
        return true;
      }
    }
    return this.renderPlain();
  }

  /** Forward rendering straight to the canvas; a throw skips the frame and
   *  is reported once, so one bad frame never stops the loop. */
  private renderPlain(): boolean {
    const r = this.renderer;
    const autoClear = r.autoClear;
    try {
      r.autoClear = true;
      r.setRenderTarget(null);
      r.render(this.scene, this.camera);
      return true;
    } catch (e) {
      const msg = reasonText(e);
      if (!this.sceneFaults.has(msg)) {
        this.sceneFaults.add(msg);
        console.error('[MOONSHOTS] Scene render failed — frame skipped.', e);
        this.onIssue?.(`RENDER — a frame failed to draw (${msg})`);
      }
      return false;
    } finally {
      r.autoClear = autoClear;
    }
  }

  /** Some drivers fail shader compilation silently and render pure black —
   *  sometimes only one program (the terrain) while buildings still draw.
   *  Called right after a render whose ground cannot legitimately be black:
   *  reads a 4×4 grid of the drawing buffer and asks `expectsGround(u, v)`
   *  (0..1, origin bottom-left) which samples should show terrain. Black if
   *  most of those are black (r+g+b ≤ 2: lit or floored regolith never is;
   *  black sky is fine), unknown with fewer than 3 such samples. */
  probe(expectsGround: (u: number, v: number) => boolean): ProbeVerdict {
    const gl = this.renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    if (w === 0 || h === 0) return 'unknown';
    const px = new Uint8Array(4);
    let expected = 0, black = 0;
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        const u = (i + 0.5) / 4, v = (j + 0.5) / 4;
        if (!expectsGround(u, v)) continue;
        gl.readPixels(Math.floor(w * u), Math.floor(h * v), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        expected++;
        if (px[0] + px[1] + px[2] <= 2) black++;
      }
    }
    if (expected < 3) return 'unknown';
    return black >= expected * 0.75 ? 'black' : 'ok';
  }
}
