/** WebGL renderer + camera. The one path: the canvas is the only target — MSAA
 *  on the context, no shadow map, no tone mapping (the palette is authored as
 *  the colours you see), sRGB output, and the pixel ratio held to 1.5 so a
 *  HiDPI laptop does not quadruple the fill. There is no post chain, no
 *  render target and no float buffer. */
import * as THREE from 'three';

export function createRenderer(canvas: HTMLCanvasElement, _classic?: boolean /* deprecated: dropped with the game.ts pass */): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = false;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // per-frame counts summed over every pass (game.ts resets them each frame)
  renderer.info.autoReset = false;
  console.log('[MOONSHOTS] GPU:', gpuInfo(renderer));
  return renderer;
}

export function gpuInfo(renderer: THREE.WebGLRenderer): string {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown GPU';
    return `${name} · WebGL2: ${typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext}`;
  } catch {
    return 'unavailable';
  }
}

export function createCamera(): THREE.PerspectiveCamera {
  // far reaches the horizon ring's rim; depth precision rides on `near`
  const cam = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 16000);
  cam.position.set(90, 110, 150);
  cam.lookAt(0, 0, 0);
  return cam;
}
