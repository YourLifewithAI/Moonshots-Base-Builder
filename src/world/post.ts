/** Post chain: N8AO (readability of white-on-gray forms) → film grain →
 *  vignette → SMAA. Degradable three ways:
 *  - `?lowfx` skips AO up front (weak integrated GPUs)
 *  - if the AO pass fails to construct, the chain continues without it
 *  - if the composer throws at render time (driver/GPU quirks), we fall back
 *    permanently to plain forward rendering — less filmic, never a black screen. */
import * as THREE from 'three';
import {
  BlendFunction, EffectComposer, EffectPass, NoiseEffect, RenderPass,
  SMAAEffect, VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export class PostFX {
  readonly composer: EffectComposer;
  private failed = false;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    lowFx: boolean,
  ) {
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(scene, camera));

    if (!lowFx) {
      try {
        const ao = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight);
        ao.configuration.aoRadius = 3.0;
        ao.configuration.intensity = 2.5;
        ao.configuration.distanceFalloff = 1.0;
        ao.setQualityMode('Low');
        this.composer.addPass(ao);
      } catch (e) {
        console.warn('[MOONSHOTS] Ambient occlusion unavailable on this GPU, continuing without it.', e);
      }
    }

    try {
      const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true });
      grain.blendMode.opacity.value = 0.14;
      const vignette = new VignetteEffect({ offset: 0.28, darkness: 0.52 });
      const smaa = new SMAAEffect();
      this.composer.addPass(new EffectPass(camera, grain, vignette, smaa));
    } catch (e) {
      console.warn('[MOONSHOTS] Film effects unavailable on this GPU, continuing without them.', e);
    }
  }

  setSize(w: number, h: number) {
    if (this.failed) return;
    try {
      this.composer.setSize(w, h);
    } catch { /* fallback path handles rendering */ }
  }

  render(dt: number) {
    if (!this.failed) {
      try {
        this.composer.render(dt);
        return;
      } catch (e) {
        this.forceFallback(e);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  forceFallback(reason?: unknown) {
    if (this.failed) return;
    this.failed = true;
    console.warn('[MOONSHOTS] Post-processing failed on this GPU — falling back to plain rendering.', reason ?? '');
    try { this.composer.dispose(); } catch { /* best effort */ }
  }

  get usingFallback(): boolean { return this.failed; }

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
