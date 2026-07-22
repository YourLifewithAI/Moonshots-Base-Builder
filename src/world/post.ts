/** Post chain with a degradation ladder. Not every GPU/driver runs the full
 *  chain; instead of all-or-nothing we walk down until something renders:
 *
 *    level 0 — half-float buffers · AO · grain/vignette/SMAA   (the full look)
 *    level 1 — standard buffers   · AO · grain/vignette/SMAA   (half-float unsupported)
 *    level 2 — standard buffers   · no AO                      (AO shader unsupported)
 *    level 3 — plain forward rendering                          (composer unsupported)
 *
 *  The black-frame sentinel in game.ts drives descent; a throwing composer
 *  descends too. The working level persists to localStorage so later launches
 *  boot straight into it — no black flash while re-discovering. */
import * as THREE from 'three';
import {
  BlendFunction, EffectComposer, EffectPass, NoiseEffect, RenderPass,
  SMAAEffect, VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

const STORE_KEY = 'mbb-fx-level';
export const FX_PLAIN = 3;

const LEVEL_ALERTS: Record<number, string> = {
  1: 'RENDER — high-precision buffers unavailable, effects retrying in standard precision',
  2: 'RENDER — ambient occlusion disabled (GPU limitation)',
  3: 'RENDER — effects disabled, using plain rendering',
};

function storedLevel(): number {
  try {
    const v = Number(localStorage.getItem(STORE_KEY));
    return Number.isInteger(v) && v >= 0 && v <= FX_PLAIN ? v : 0;
  } catch { return 0; }
}

export class PostFX {
  private composer: EffectComposer | null = null;
  private level: number;
  /** surfaced into the in-game alert stack so players see render issues without F12 */
  onIssue?: (msg: string) => void;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    lowFx: boolean,
    fxOverride?: number,
  ) {
    if (fxOverride !== undefined && fxOverride >= 0 && fxOverride <= FX_PLAIN) {
      this.level = fxOverride;
      this.persist();
    } else {
      this.level = Math.max(storedLevel(), lowFx ? 2 : 0);
    }
    console.log(`[MOONSHOTS] FX level ${this.level} (0=full … 3=plain)`);
    this.buildComposer();
  }

  get fxLevel(): number { return this.level; }
  get usingFallback(): boolean { return this.level >= FX_PLAIN; }

  private persist() {
    try { localStorage.setItem(STORE_KEY, String(this.level)); } catch { /* fine */ }
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
    if (this.level >= FX_PLAIN) return;
    try {
      const frameBufferType = this.level === 0 ? THREE.HalfFloatType : THREE.UnsignedByteType;
      const composer = new EffectComposer(this.renderer, { frameBufferType });
      composer.addPass(new RenderPass(this.scene, this.camera));
      if (this.level < 2) {
        try {
          const ao = new N8AOPostPass(this.scene, this.camera, window.innerWidth, window.innerHeight);
          ao.configuration.aoRadius = 3.0;
          ao.configuration.intensity = 2.5;
          ao.configuration.distanceFalloff = 1.0;
          ao.setQualityMode('Low');
          composer.addPass(ao);
        } catch (e) {
          console.warn('[MOONSHOTS] Ambient occlusion unavailable, continuing without it.', e);
        }
      }
      try {
        const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true });
        grain.blendMode.opacity.value = 0.14;
        const vignette = new VignetteEffect({ offset: 0.28, darkness: 0.52 });
        const smaa = new SMAAEffect();
        composer.addPass(new EffectPass(this.camera, grain, vignette, smaa));
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
    if (this.level >= FX_PLAIN) return false;
    this.level++;
    this.persist();
    console.warn(`[MOONSHOTS] Render degraded to FX level ${this.level}.`, reason ?? '');
    const msg = LEVEL_ALERTS[this.level];
    if (msg) this.onIssue?.(msg);
    this.buildComposer();
    return true;
  }

  /** Explicitly set a level (debug hook / settings). */
  setLevel(n: number) {
    this.level = Math.min(FX_PLAIN, Math.max(0, Math.round(n)));
    this.persist();
    this.buildComposer();
  }

  /** Jump straight to plain rendering (throwing-driver path, debug hook). */
  forceFallback(reason?: unknown) {
    if (this.level >= FX_PLAIN) return;
    this.level = FX_PLAIN;
    this.persist();
    console.warn('[MOONSHOTS] Post-processing disabled — plain rendering.', reason ?? '');
    this.onIssue?.(LEVEL_ALERTS[FX_PLAIN]);
    this.disposeComposer();
  }

  setSize(w: number, h: number) {
    try { this.composer?.setSize(w, h); } catch { /* plain path unaffected */ }
  }

  render(dt: number) {
    if (this.composer) {
      try {
        this.composer.render(dt);
        return;
      } catch (e) {
        this.degrade(e); // a throwing pass may work at a lower level
        if (this.composer) return; // rebuilt — try it next frame
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Some drivers fail shader compilation silently and render pure black.
   *  Called right after a daytime render: samples the drawing buffer; true if
   *  every sample is black (the sunlit Moon is never black). */
  outputLooksBlack(): boolean {
    const gl = this.renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    if (w === 0 || h === 0) return false;
    const px = new Uint8Array(4);
    let total = 0;
    for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.4], [0.7, 0.6], [0.5, 0.25]]) {
      gl.readPixels(Math.floor(w * fx), Math.floor(h * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      total += px[0] + px[1] + px[2];
    }
    return total <= 8;
  }
}
