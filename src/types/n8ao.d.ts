declare module 'n8ao' {
  import type { Camera, Scene } from 'three';
  import { Pass } from 'postprocessing';
  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    /** on (the default), the first frame with a transparent material turns
     *  transparencyAware on: two more scene renders every frame */
    autoDetectTransparency: boolean;
    configuration: {
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      color: unknown;
      aoSamples: number;
      denoiseSamples: number;
      denoiseRadius: number;
      halfRes: boolean;
      depthAwareUpsampling: boolean;
      transparencyAware: boolean;
    };
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
  }
}
