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
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

export function createCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 4000);
  cam.position.set(90, 110, 150);
  cam.lookAt(0, 0, 0);
  return cam;
}
