/** What this GPU can run of the post ladder, found once at boot (High
 *  detail only) before the first level is picked (docs/08 §Render safety).
 *
 *  Extensions say what a driver claims; a claim can be wrong (a browser may
 *  expose EXT_color_buffer_float and still store or filter half-floats
 *  badly). So FX 0's own needs are also tried: a 4×1 half-float target is
 *  drawn (values past 1, a small one, an additive blend on top), sampled
 *  between two texels with linear filtering, and read back. The whole test
 *  is two tiny draws.
 *
 *    level  needs                                                  why
 *    0      EXT_color_buffer_float or _half_float + the probe       RGBA16F scene, bloom mips (render, blend, linear)
 *    0–1    EXT_color_buffer_float                                 N8AO's R32F depth and RGBA16F targets
 *    2      nothing past WebGL2                                    8-bit buffers only
 *
 *  OES_texture_float_linear is not needed by any level: the only 32-bit
 *  float texture (N8AO's downsampled depth) is sampled nearest, and linear
 *  filtering of half-float is core WebGL2. It is reported, not required. */
import * as THREE from 'three';

/** Render targets made for probes and checks (kept out of the chain's
 *  render-target census, game.ts watchRenderTargets). */
export const diagnosticTargets = new WeakSet<object>();

/** Extensions the report lists (the chain's, and the ones that explain it). */
export const REPORT_EXTENSIONS = [
  'EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'EXT_float_blend',
  'OES_texture_float_linear', 'OES_texture_half_float_linear', 'EXT_texture_filter_anisotropic',
  'WEBGL_debug_renderer_info', 'KHR_parallel_shader_compile', 'EXT_disjoint_timer_query_webgl2',
  'WEBGL_lose_context', 'OES_draw_buffers_indexed', 'EXT_clip_control', 'WEBGL_multi_draw',
] as const;

export interface HalfFloatProbe {
  ok: boolean;
  /** why it failed ('' when it passed) */
  why: string;
  /** stored texel 0 (after the blend) and the linear sample between texels 0 and 1 */
  stored?: number[];
  sampled?: number[];
}

export interface FxCaps {
  webgl2: boolean;
  extensions: Record<string, boolean>;
  halfFloat: HalfFloatProbe;
  /** the best level this GPU can boot at (0 full … 2), and why not better */
  floor: number;
  floorReason: string;
  /** shader float precision (fragment/vertex × high/medium): [log2 range min, max, precision bits] */
  precision: Record<string, [number, number, number]>;
}

const QUAD = new THREE.PlaneGeometry(2, 2);
const CAM = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const probeMaterial = (frag: string, blending: THREE.Blending, uniforms: Record<string, THREE.IUniform> = {}) =>
  new THREE.ShaderMaterial({
    uniforms, blending, depthTest: false, depthWrite: false, toneMapped: false,
    transparent: blending !== THREE.NoBlending,
    vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
    fragmentShader: `varying vec2 vUv;\n${frag}`,
  });

function readFloat(renderer: THREE.WebGLRenderer, t: THREE.WebGLRenderTarget, w: number, h: number): Float32Array | null {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  renderer.setRenderTarget(t);
  const out = new Float32Array(w * h * 4);
  for (let i = 0; i < 16 && gl.getError() !== gl.NO_ERROR; i++) { /* drain */ }
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, out);
  return gl.getError() === gl.NO_ERROR ? out : null;
}

/** FX 0's buffers on this GPU: render, blend, filter, read back. */
export function probeHalfFloat(renderer: THREE.WebGLRenderer): HalfFloatProbe {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const mk = (w: number) => {
    const t = new THREE.WebGLRenderTarget(w, 1, {
      type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, generateMipmaps: false,
    });
    diagnosticTargets.add(t);
    return t;
  };
  const a = mk(4), b = mk(1);
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(QUAD);
  quad.frustumCulled = false;
  scene.add(quad);
  // texel 0: (1, 0.004, 3) · texels 1–3: (3, 0.004, 1000); then +0.5 red on top
  const base = probeMaterial('void main() { gl_FragColor = vUv.x < 0.25 ? vec4( 1.0, 0.004, 3.0, 1.0 ) : vec4( 3.0, 0.004, 1000.0, 1.0 ); }',
    THREE.NoBlending);
  const add = probeMaterial('void main() { gl_FragColor = vec4( 0.5, 0.0, 0.0, 1.0 ); }', THREE.AdditiveBlending);
  const sample = probeMaterial('uniform sampler2D map;\nvoid main() { gl_FragColor = texture2D( map, vec2( 0.25, 0.5 ) ); }',
    THREE.NoBlending, { map: { value: a.texture } });
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.autoClear;
  const prevColor = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  try {
    renderer.setRenderTarget(a);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      return { ok: false, why: 'a half-float render target is not framebuffer-complete' };
    }
    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    quad.material = base; renderer.render(scene, CAM);
    quad.material = add; renderer.render(scene, CAM);
    renderer.setRenderTarget(b);
    renderer.clear(true, false, false);
    quad.material = sample; renderer.render(scene, CAM);
    const stored = readFloat(renderer, a, 4, 1);
    const sampled = readFloat(renderer, b, 1, 1);
    if (!stored || !sampled) return { ok: false, why: 'half-float pixels cannot be read back as float' };
    const s = [...stored.slice(0, 4)].map((v) => +v.toFixed(4));
    const m = [...sampled.slice(0, 4)].map((v) => +v.toFixed(4));
    const near = (v: number, want: number, tol: number) => Number.isFinite(v) && Math.abs(v - want) <= tol;
    // blended: 1 + 0.5 (red), the small value kept, 3 kept past 1
    if (!near(s[0], 1.5, 0.01) || !near(s[1], 0.004, 2e-4) || !near(s[2], 3, 0.01)) {
      return { ok: false, why: `half-float storage or blending is wrong (read ${s.join(', ')}, want 1.5, 0.004, 3)`, stored: s, sampled: m };
    }
    // halfway between texel 0 and 1: linear filtering averages (nearest would give 1.5 or 3.5)
    if (!near(m[0], 2.5, 0.05) || !near(m[2], 501.5, 2)) {
      return { ok: false, why: `half-float linear filtering is wrong (sampled ${m.join(', ')}, want 2.5, 0.004, 501.5)`, stored: s, sampled: m };
    }
    return { ok: true, why: '', stored: s, sampled: m };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : String(e) };
  } finally {
    renderer.autoClear = prevClear;
    renderer.setClearColor(prevColor, prevAlpha);
    renderer.setRenderTarget(prevTarget);
    for (const mat of [base, add, sample]) mat.dispose();
    a.dispose(); b.dispose();
  }
}

export function probeCaps(renderer: THREE.WebGLRenderer): FxCaps {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  const supported = new Set(gl.getSupportedExtensions() ?? []);
  const extensions: Record<string, boolean> = {};
  for (const e of REPORT_EXTENSIONS) extensions[e] = supported.has(e);
  const precision: Record<string, [number, number, number]> = {};
  for (const [name, shader] of [['fragment', gl.FRAGMENT_SHADER], ['vertex', gl.VERTEX_SHADER]] as const) {
    for (const [p, kind] of [['high', gl.HIGH_FLOAT], ['medium', gl.MEDIUM_FLOAT]] as const) {
      const f = gl.getShaderPrecisionFormat(shader, kind);
      if (f) precision[`${name}.${p}`] = [f.rangeMin, f.rangeMax, f.precision];
    }
  }
  const float = extensions.EXT_color_buffer_float;
  const half = float || extensions.EXT_color_buffer_half_float;
  const halfFloat: HalfFloatProbe = !webgl2 ? { ok: false, why: 'no WebGL2' }
    : !half ? { ok: false, why: 'no EXT_color_buffer_float or EXT_color_buffer_half_float' }
    : probeHalfFloat(renderer);
  let floor = 0, floorReason = '';
  if (!float) {
    floor = 2;
    floorReason = 'EXT_color_buffer_float is missing (ambient occlusion needs float targets)';
  } else if (!halfFloat.ok) {
    floor = 1;
    floorReason = `half-float buffers failed the capability check: ${halfFloat.why}`;
  }
  return { webgl2, extensions, halfFloat, floor, floorReason, precision };
}
