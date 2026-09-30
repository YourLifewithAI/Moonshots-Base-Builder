/** WebGL renderer + camera. The one path: the canvas is the only target — MSAA
 *  on the context, no shadow map, no tone mapping (the palette is authored as
 *  the colours you see), sRGB output, and the pixel ratio held to 1.5 so a
 *  HiDPI laptop does not quadruple the fill. There is no post chain, no
 *  render target and no float buffer. */
import * as THREE from 'three';

export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
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

/** Draw the frame: forward rendering straight to the canvas. A throw skips the
 *  frame and returns the message (the caller reports it once), so one bad
 *  frame never stops the loop; null when the frame was drawn. */
export function drawFrame(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): string | null {
  try {
    renderer.render(scene, camera);
    return null;
  } catch (e) {
    console.error('[MOONSHOTS] Scene render failed — frame skipped.', e);
    return e instanceof Error ? e.message : e ? String(e) : 'render error';
  }
}

/** A probe of the frame just drawn: black, fine, or too little ground in
 *  view to tell. */
export type ProbeVerdict = 'black' | 'ok' | 'unknown';

/** r+g+b (0..255 each) at or under this is black: lit or floored regolith
 *  never is (the night ground, earthshine on a stepped ramp, sits far above),
 *  and the sky's dark clear colour is fine */
export const BLACK_SUM = 12;

/** Some drivers fail shader compilation silently and render pure black —
 *  sometimes only one program (the terrain) while buildings still draw.
 *  Called right after a render whose ground cannot legitimately be black:
 *  reads a 4×4 grid of the drawing buffer and asks `expectsGround(u, v)`
 *  (0..1, origin bottom-left) which samples should show terrain. Black if
 *  most of those are black, unknown with fewer than 3 such samples. */
export function probeGround(renderer: THREE.WebGLRenderer, expectsGround: (u: number, v: number) => boolean): ProbeVerdict {
  const gl = renderer.getContext();
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
      if (px[0] + px[1] + px[2] <= BLACK_SUM) black++;
    }
  }
  if (expected < 3) return 'unknown';
  return black >= expected * 0.75 ? 'black' : 'ok';
}

export function createCamera(): THREE.PerspectiveCamera {
  // far reaches the horizon ring's rim; depth precision rides on `near`
  const cam = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 16000);
  cam.position.set(90, 110, 150);
  cam.lookAt(0, 0, 0);
  return cam;
}
