/** WebGL renderer + camera. AgX tonemapping and physically-lit units give the
 *  Apollo-photograph contrast the art direction calls for. */
import * as THREE from 'three';

export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // SMAA in the post chain
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  // hard-edged PCF (radius set on the sun): no atmosphere, razor shadows
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
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
