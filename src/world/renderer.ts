/** WebGL renderer + camera.
 *
 *  High detail: AgX tonemapping and physically-lit units give the
 *  Apollo-photograph contrast the art direction calls for; no MSAA (SMAA
 *  runs in the post chain), PCF sun shadows.
 *
 *  Classic: the canvas is the only target — MSAA on the context, no shadow
 *  map, no tone mapping (the palette is authored as the colours you see),
 *  the pixel ratio held to 1.5 so a HiDPI laptop does not quadruple the
 *  fill. Context attributes are fixed at creation, hence the reload on a
 *  style change. */
import * as THREE from 'three';

export function createRenderer(canvas: HTMLCanvasElement, classic = false): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: classic, // detailed: SMAA in the post chain
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, classic ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = !classic;
  // hard-edged PCF (radius set on the sun): no atmosphere, razor shadows
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = classic ? THREE.NoToneMapping : THREE.AgXToneMapping;
  renderer.toneMappingExposure = classic ? 1 : 1.1;
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
