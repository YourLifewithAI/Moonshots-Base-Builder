/** Post chain: N8AO (readability of white-on-gray forms) → film grain →
 *  vignette → SMAA. Degradable: `?lowfx` drops AO for integrated GPUs. */
import * as THREE from 'three';
import {
  BlendFunction, EffectComposer, EffectPass, NoiseEffect, RenderPass,
  SMAAEffect, VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export class PostFX {
  readonly composer: EffectComposer;
  private ao?: N8AOPostPass;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    lowFx: boolean,
  ) {
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(scene, camera));

    if (!lowFx) {
      this.ao = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight);
      this.ao.configuration.aoRadius = 3.0;
      this.ao.configuration.intensity = 2.5;
      this.ao.configuration.distanceFalloff = 1.0;
      this.ao.setQualityMode('Low');
      this.composer.addPass(this.ao);
    }

    const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true });
    grain.blendMode.opacity.value = 0.14;
    const vignette = new VignetteEffect({ offset: 0.28, darkness: 0.52 });
    const smaa = new SMAAEffect();
    this.composer.addPass(new EffectPass(camera, grain, vignette, smaa));
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
  }

  render(dt: number) {
    this.composer.render(dt);
  }
}
