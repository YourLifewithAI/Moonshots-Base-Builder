/** Regolith shading patch for the terrain's MeshStandardMaterial, injected via
 *  onBeforeCompile so the stock shader is always one removal away:
 *
 *   - micro-relief: a runtime-generated tiling texture (value-noise grain plus
 *     power-law craterlets, bowl + rim) holding detail slopes and an albedo
 *     offset, sampled at two world scales with the pixel footprint (fwidth)
 *     and distance fading each scale out before it can shimmer;
 *   - lunar photometry: McEwen lunar-Lambert diffuse (a Lommel–Seeliger /
 *     Lambert blend weighted by phase angle — the Moon's flat, limb-bright
 *     look) times a Hapke-style opposition surge, the bright halo around your
 *     own shadow in Apollo frames. μ is floored so the blend never divides
 *     by zero at grazing view angles.
 *
 *   - night: the shared work-light array (world/floodlights.ts), so pools
 *     drape over whatever relief they fall on, and the earthshine floor.
 *
 *  Variant by FX level: 0–1 both scales + 32 floods, 2 the coarse scale only
 *  + 16 floods, 3 stock. */
import * as THREE from 'three';
import { mulberry32 } from '../core/rng';
import { PATCH_MARKER, hasAnchors, injectAll, type ShaderPatch } from '../world/materials';
import { bindFloodUniforms, floodPars, floodSlots, landscapeNight } from '../world/floodlights';

const TEX = 512;
const FINE_M = 7.3;    // fine tile period (m): grain and 3–60 cm pits
const COARSE_M = 41;   // coarse tile period (m): 0.2–3.5 m craterlets

let detailTexture: THREE.DataTexture | null = null;

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Tiling micro-relief: RG = surface normal x/z (0.5-biased), B = albedo
 *  offset (0.5-biased). Everything wraps, so the tile repeats seamlessly. */
function buildDetailTexture(): THREE.DataTexture {
  const N = TEX;
  const h = new Float32Array(N * N);
  const alb = new Float32Array(N * N);
  const rng = mulberry32(0x5e1e7e);

  for (const [cells, amp] of [[32, 1.4], [64, 0.7], [128, 0.35]] as const) {
    const lat = new Float32Array(cells * cells);
    for (let i = 0; i < lat.length; i++) lat[i] = rng() * 2 - 1;
    const step = N / cells;
    for (let y = 0; y < N; y++) {
      const fy = y / step, iy = Math.floor(fy), ty = smooth(fy - iy);
      const r0 = (iy % cells) * cells, r1 = ((iy + 1) % cells) * cells;
      for (let x = 0; x < N; x++) {
        const fx = x / step, ix = Math.floor(fx), tx = smooth(fx - ix);
        const c0 = ix % cells, c1 = (ix + 1) % cells;
        const top = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * tx;
        const bot = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * tx;
        const v = amp * (top + (bot - top) * ty);
        h[y * N + x] += v;
        alb[y * N + x] += v * 0.025;
      }
    }
  }

  // craterlets: cumulative N(>r) ∝ r⁻², mostly degraded, a few fresh with
  // dark floors and bright immature rims
  const RMIN = 1.5, RMAX = 44;
  for (let i = 0; i < 1600; i++) {
    const r = RMIN / Math.sqrt(1 - rng() * (1 - (RMIN / RMAX) ** 2));
    const cx = rng() * N, cy = rng() * N;
    const fresh = rng() ** 3;
    const depth = r * (0.03 + 0.2 * fresh);
    const rimH = depth * 0.3;
    const reach = Math.ceil(r * 1.9);
    const x0 = Math.floor(cx), y0 = Math.floor(cy);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const d = Math.hypot(x0 + dx - cx, y0 + dy - cy) / r;
        if (d >= 1.9) continue;
        const k = (((y0 + dy) % N + N) % N) * N + (((x0 + dx) % N + N) % N);
        const rim = Math.exp(-(((d - 1) / 0.25) ** 2));
        h[k] += (d < 1 ? depth * (d * d - 1) : 0) + rimH * rim;
        alb[k] += fresh * (d < 1 ? -0.07 * (1 - d * d) : 0) + fresh * 0.09 * rim;
      }
    }
  }

  const data = new Uint8Array(N * N * 4);
  const enc = (v: number) => Math.round(Math.min(1, Math.max(0, 0.5 + 0.5 * v)) * 255);
  for (let y = 0; y < N; y++) {
    const up = ((y + 1) % N) * N, dn = ((y + N - 1) % N) * N, row = y * N;
    for (let x = 0; x < N; x++) {
      const sx = (h[row + (x + 1) % N] - h[row + (x + N - 1) % N]) * 0.5;
      const sz = (h[up + x] - h[dn + x]) * 0.5;
      const len = Math.hypot(sx, sz, 1);
      const o = (row + x) * 4;
      data[o] = enc(-sx / len);
      data[o + 1] = enc(-sz / len);
      data[o + 2] = enc(alb[row + x] * 2);
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const VERT_PARS = /* glsl */`
#define ${PATCH_MARKER}
varying vec3 vRegolithWorld;
`;
const VERT_MAIN = /* glsl */`
	vRegolithWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
`;

const FRAG_PARS = (detail: number) => /* glsl */`
#define ${PATCH_MARKER}
#define REGOLITH_DETAIL ${detail}
uniform sampler2D uRegolithDetail;
varying vec3 vRegolithWorld;
`;

const FRAG_FLOODS = landscapeNight('vRegolithWorld');

// albedo + slope from the detail tile; runs right after vertex colors
const FRAG_ALBEDO = /* glsl */`
	vec2 regXZ = vRegolithWorld.xz;
	float regFw = length( fwidth( regXZ ) );
	float regDist = length( vViewPosition );
	const mat2 REG_ROT = mat2( 0.8, 0.6, -0.6, 0.8 );
	vec4 regC = texture2D( uRegolithDetail, REG_ROT * regXZ * ${(1 / COARSE_M).toFixed(6)} );
	float regFadeC = ( 1.0 - smoothstep( ${(COARSE_M / 64).toFixed(3)}, ${(COARSE_M / 20).toFixed(3)}, regFw ) )
		* ( 1.0 - smoothstep( 260.0, 420.0, regDist ) );
	vec2 regSlope = ( ( regC.rg * 2.0 - 1.0 ) * REG_ROT ) * ( 0.6 * regFadeC );
	float regAlb = ( regC.b - 0.5 ) * regFadeC;
	#if REGOLITH_DETAIL > 1
		vec4 regF = texture2D( uRegolithDetail, regXZ * ${(1 / FINE_M).toFixed(6)} );
		float regFadeF = ( 1.0 - smoothstep( ${(FINE_M / 64).toFixed(3)}, ${(FINE_M / 22).toFixed(3)}, regFw ) )
			* ( 1.0 - smoothstep( 45.0, 90.0, regDist ) );
		regSlope += ( regF.rg * 2.0 - 1.0 ) * ( 0.65 * regFadeF );
		regAlb += ( regF.b - 0.5 ) * ( 0.7 * regFadeF );
	#endif
	diffuseColor.rgb *= max( 1.0 + regAlb, 0.5 );
`;

const FRAG_NORMAL = /* glsl */`
	normal = normalize( normal + mat3( viewMatrix ) * vec3( regSlope.x, 0.0, regSlope.y ) );
`;

const FRAG_LIGHT = /* glsl */`
float regolithPhaseL( const in float cosG ) {
	float g = degrees( acos( cosG ) );
	return clamp( 1.0 + g * ( -0.019 + g * ( 2.42e-4 - g * 1.46e-6 ) ), 0.0, 1.0 );
}
void RE_Direct_Regolith( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float mu0 = saturate( dot( geometryNormal, directLight.direction ) );
	float mu = max( dot( geometryNormal, geometryViewDir ), 0.05 );
	float cosG = clamp( dot( directLight.direction, geometryViewDir ), -1.0, 1.0 );
	float tanHalfG = sqrt( ( 1.0 - cosG ) / max( 1.0 + cosG, 1e-3 ) );
	float surge = 1.0 + 0.8 / ( 1.0 + tanHalfG / 0.07 );
	float shade = mix( mu0, 2.0 * mu0 / ( mu0 + mu ), regolithPhaseL( cosG ) ) * surge;
	reflectedLight.directDiffuse += shade * directLight.color * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += mu0 * directLight.color * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Regolith
`;

const vertEdits = (): [string, string][] => [
  ['#include <common>', VERT_PARS],
  ['#include <project_vertex>', VERT_MAIN],
];
const fragEdits = (detail: number, floods: number): [string, string][] => [
  ['#include <common>', FRAG_PARS(detail)],
  ['#include <color_fragment>', FRAG_ALBEDO],
  ['#include <normal_fragment_maps>', FRAG_NORMAL],
  ['#include <lights_physical_pars_fragment>', FRAG_LIGHT + floodPars(floods)],
  ['#include <lights_fragment_end>', FRAG_FLOODS],
];
const ANCHORS_OK = hasAnchors(THREE.ShaderLib.standard.vertexShader, vertEdits())
  && hasAnchors(THREE.ShaderLib.standard.fragmentShader, fragEdits(2, 1));

export const regolithPatch: ShaderPatch = (mat, level) => {
  if (level > 2 || !ANCHORS_OK) return null;
  const detail = level <= 1 ? 2 : 1;
  const floods = floodSlots(level);
  mat.onBeforeCompile = (shader) => {
    const vs = injectAll(shader.vertexShader, vertEdits());
    const fs = injectAll(shader.fragmentShader, fragEdits(detail, floods));
    if (!vs || !fs) return;
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
    shader.uniforms.uRegolithDetail = { value: detailTexture ??= buildDetailTexture() };
    bindFloodUniforms(shader.uniforms);
  };
  return `regolith-${detail}`;
};
