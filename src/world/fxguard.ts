/** Numeric guards for the post chain (docs/08 §Render safety).
 *
 *  FX 0 keeps the scene in half-float buffers, which store what 8-bit ones
 *  cannot: NaN, ±Inf, negatives and values past 1. A real GPU makes NaN
 *  where SwiftShader often does not (pow of a negative, normalize(0), 0/0),
 *  and one NaN pixel fed to bloom's mip chain spreads over hundreds of
 *  pixels. The 8-bit levels clamp all of it away on every store, which is
 *  why a fault can show at FX 0 only.
 *
 *  So, before anything blurs or blends the HDR frame:
 *   - the sanitiser: NaN or Inf (any channel) → opaque black, the rest
 *     clamped to 0 … HDR_MAX. Its test reads the exponent bits (integer
 *     ops): a fast-math compiler may fold isnan() away, never this;
 *   - it rides in N8AO's composite, which already reads the scene once per
 *     pixel (no extra pass). That shader is hardened too: its fog factor
 *     starts at 0 (it is read uninitialised when the scene has no fog, as
 *     ours has none), and an AO or upsample weight that came out NaN leaves
 *     the pixel unoccluded instead of black;
 *   - no N8AO at FX 0 (it failed to build, or an upgrade moved an anchor):
 *     a one-pass sanitiser right after the scene render instead.
 *
 *  HDR_MAX leaves room for bloom's ADD on top (+0.6 × at most HDR_MAX)
 *  under the half-float ceiling of 65504. AgX saturates near 16, so the
 *  clamp is invisible.
 *
 *  Also here: the debug breaks (debugBreakFx), which make one FX level draw
 *  wrong the way a faulty GPU would, so the self-check can be tested. */
import * as THREE from 'three';
import { ShaderPass } from 'postprocessing';

export const HDR_MAX = 32000;

/** GLSL: mbbBadF / mbbBad / mbbSanitize (needs GLSL ES 3.00, as WebGL2 gives). */
export const SANITIZE_GLSL = /* glsl */`
uniform bool mbbSanitizeOn;
bool mbbBadF( float x ) { return ( floatBitsToUint( x ) & 0x7f800000u ) == 0x7f800000u; }
bool mbbBad( vec4 c ) {
	uvec4 e = floatBitsToUint( c ) & uvec4( 0x7f800000u );
	return any( equal( e, uvec4( 0x7f800000u ) ) );
}
vec4 mbbSanitize( vec4 c ) {
	if ( ! mbbSanitizeOn ) return c;
	return mbbBad( c ) ? vec4( 0.0, 0.0, 0.0, 1.0 )
		: vec4( clamp( c.rgb, 0.0, ${HDR_MAX.toFixed(1)} ), clamp( c.a, 0.0, 1.0 ) );
}
`;

/** Shared by every sanitiser: off only for a test that shows what it stops. */
export const sanitizeUniform = { value: true };

/** Hardened N8AO composites alive now, with their stock source (debug: a
 *  test draws the same frame with and without the hardening). */
const hardened = new Map<THREE.ShaderMaterial, { stock: string; patched: string }>();
let hardening = true;

type Edit = [anchor: string, replace: string];

/** N8AO's composite: fog factor initialised, AO and weights guarded, the
 *  scene read and the output sanitised. */
const N8AO_EDITS: Edit[] = [
  ['#include <dithering_pars_fragment>', `#include <dithering_pars_fragment>\n${SANITIZE_GLSL}`],
  ['vec4 sceneTexel = texture2D(sceneDiffuse, vUv);',
    'vec4 sceneTexel = mbbSanitize(texture2D(sceneDiffuse, vUv));'],
  ['if (totalWeight == 0.0) {', 'if (totalWeight <= 1e-6 || mbbBadF(totalWeight)) {'],
  ['float finalAo = pow(texel.r, intensity);',
    'float finalAo = pow(mbbBadF(texel.r) ? 1.0 : clamp(texel.r, 0.0, 1.0), intensity);\n'
    + '        if (mbbBadF(finalAo)) finalAo = 1.0;'],
  ['float fogFactor;', 'float fogFactor = 0.0;'],
  ['#include <dithering_fragment>', 'gl_FragColor = mbbSanitize(gl_FragColor);\n        #include <dithering_fragment>'],
];

interface N8AOLike {
  effectCompositerQuad?: { material: THREE.ShaderMaterial };
  configureEffectCompositer?: (...a: unknown[]) => void;
}

function patchComposite(mat: THREE.ShaderMaterial): boolean {
  if (hardened.has(mat)) return true;
  const stock = mat.fragmentShader;
  let src = stock;
  for (const [anchor, rep] of N8AO_EDITS) {
    if (src.split(anchor).length !== 2) return false; // missing or ambiguous: leave it stock
    src = src.replace(anchor, rep);
  }
  hardened.set(mat, { stock, patched: src });
  mat.addEventListener('dispose', () => hardened.delete(mat));
  mat.fragmentShader = hardening ? src : stock;
  mat.uniforms.mbbSanitizeOn = sanitizeUniform;
  mat.needsUpdate = true;
  return true;
}

/** Debug: the N8AO hardening and the sanitiser on or off together (off
 *  draws exactly what the stock chain drew). */
export function setHardening(on: boolean) {
  hardening = on;
  sanitizeUniform.value = on;
  for (const [mat, src] of hardened) {
    mat.fragmentShader = on ? src.patched : src.stock;
    mat.needsUpdate = true;
  }
}

/** Harden an N8AOPostPass in place (and again whenever it rebuilds its
 *  composite). False when its shader no longer has the anchors: the caller
 *  adds a sanitiser pass instead. */
export function hardenN8AO(ao: unknown): boolean {
  const a = ao as N8AOLike;
  const mat = a.effectCompositerQuad?.material;
  if (!mat || typeof a.configureEffectCompositer !== 'function' || !patchComposite(mat)) return false;
  const configure = a.configureEffectCompositer.bind(a);
  a.configureEffectCompositer = (...args: unknown[]) => {
    configure(...args);
    const m = a.effectCompositerQuad?.material;
    if (m) patchComposite(m);
  };
  return true;
}

/** The stand-alone sanitiser: one full-screen pass. */
export function sanitizePass(): ShaderPass {
  const mat = new THREE.ShaderMaterial({
    name: 'MBB.Sanitize',
    uniforms: { inputBuffer: { value: null }, mbbSanitizeOn: sanitizeUniform },
    vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4( position.xy, 1.0, 1.0 ); }',
    fragmentShader: `${SANITIZE_GLSL}\nuniform highp sampler2D inputBuffer;\nvarying vec2 vUv;\n`
      + 'void main() { gl_FragColor = mbbSanitize( texture2D( inputBuffer, vUv ) ); }',
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const pass = new ShaderPass(mat, 'inputBuffer');
  pass.name = 'MBB.Sanitize';
  return pass;
}

// ─────────────────────────── debug breaks ───────────────────────────

/** How a broken level draws:
 *   player — the report: open ground loses its earthshine (only the flood
 *            pools stay) and every hull goes flat mid-grey;
 *   zero   — the landscape draws black (floods and all);
 *   nan    — NaN in the hulls' light (in every render, the self-check's
 *            reference too: a scene-shader fault, which the sanitiser
 *            turns to black instead of letting bloom spread it). */
export type FxBreak = 'player' | 'zero' | 'nan';

/** x: landscape indirect off · y: hull flat grey radiance · z: hull poison
 *  (0 or NaN) · w: landscape direct off. Bound by the flood patches. */
export const fxBreakUniform = { value: new THREE.Vector4() };

let broken: { level: number; mode: FxBreak } | null = null;

export function setFxBreak(level: number | null, mode: FxBreak = 'player') {
  broken = level === null ? null : { level, mode };
}

export function fxBreak(): { level: number; mode: FxBreak } | null {
  return broken ? { ...broken } : null;
}

/** Before a render at `level`: the break's uniforms, or neutral. The
 *  self-check's reference renders pass `reference`: the chain-only breaks
 *  stand down for them (the scene itself is fine; its trip through the
 *  chain is not), the scene-shader one does not. */
export function applyFxBreak(level: number, reference = false) {
  const v = fxBreakUniform.value;
  v.set(0, 0, 0, 0);
  if (!broken || broken.level !== level) return;
  if (broken.mode === 'nan') v.z = NaN;
  else if (!reference) {
    if (broken.mode === 'player') v.set(1, 0.14, 0, 0);
    else v.set(1, 0, 0, 1);
  }
}
