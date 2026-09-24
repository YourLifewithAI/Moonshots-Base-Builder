/** Building surface patch for the shared building MeshStandardMaterial,
 *  injected via onBeforeCompile through the material registry (variants per
 *  FX level, stripped whole on a compile fault, absent in safe mode):
 *
 *   - per-vertex finish: roughness / metalness from the kit's `mat` attribute;
 *   - panel seams: fwidth-antialiased lines every 1.2 m in object space on
 *     the axes tangent to each face, darkening 12%, faded out once they fall
 *     under a pixel (and with distance) so they never shimmer;
 *   - per-instance state (`iState` = lit, dust, wear, print cut height):
 *     windows glow warm-white × lit × night, beacons blink, dust mattes and
 *     grays the glass, wear darkens, and fragments above the cut are
 *     discarded with a glowing band at the cut (the 3D-print reveal);
 *   - night floods (world/floodlights.ts), the same pools the ground gets.
 *
 *  Variant by FX level: 0–1 seams + 32 floods, 2 no seams + 16 floods,
 *  3 stock (squash-rise fallback, whole-hull glow, discs + PointLights). */
import * as THREE from 'three';
import { PATCH_MARKER, hasAnchors, injectAll, type ShaderPatch } from '../world/materials';
import { FLOOD_COLOR, WORLD_NORMAL, bindFloodUniforms, floodPars, floodSlots } from '../world/floodlights';

/** Cut height meaning "fully built" (no discard, no band). */
export const CUT_NONE = 1e4;

export const buildingUniforms = {
  uBldNight: { value: 0 },
  uBldTime: { value: 0 },
};

const warm = `vec3( ${FLOOD_COLOR.r.toFixed(3)}, ${FLOOD_COLOR.g.toFixed(3)}, ${FLOOD_COLOR.b.toFixed(3)} )`;

const VERT_PARS = /* glsl */`
#define ${PATCH_MARKER}
attribute vec3 mat;
#ifdef USE_INSTANCING
	attribute vec4 iState;
#endif
varying vec3 vBldMat;
varying vec4 vBldState;
varying vec3 vBldObj;
varying vec3 vBldObjN;
varying vec3 vBldWorld;
varying float vBldPhase;
`;

const VERT_MAIN = /* glsl */`
	vBldMat = mat;
	vBldObj = transformed;
	vBldObjN = objectNormal;
	#ifdef USE_INSTANCING
		vBldState = iState;
		vBldWorld = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
		vBldPhase = fract( dot( instanceMatrix[ 3 ].xz, vec2( 0.1373, 0.2719 ) ) );
	#else
		vBldState = vec4( 1.0, 0.0, 0.0, ${CUT_NONE.toFixed(1)} );
		vBldWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
		vBldPhase = 0.0;
	#endif
`;

const FRAG_PARS = (seams: boolean) => /* glsl */`
#define ${PATCH_MARKER}
${seams ? '#define BLD_SEAMS' : ''}
uniform float uBldNight;
uniform float uBldTime;
varying vec3 vBldMat;
varying vec4 vBldState;
varying vec3 vBldObj;
varying vec3 vBldObjN;
varying vec3 vBldWorld;
varying float vBldPhase;
`;

const FRAG_CUT = /* glsl */`
	if ( vBldObj.y > vBldState.w ) discard;
`;

// after vertex colors: dust on glass, wear, panel seams
const FRAG_COLOR = /* glsl */`
	float bldGlass = 1.0 - smoothstep( 0.22, 0.34, vBldMat.x );
	float bldDust = vBldState.y * bldGlass;
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.3 ), bldDust * 0.85 );
	diffuseColor.rgb *= 1.0 - 0.3 * vBldState.z;
	#ifdef BLD_SEAMS
	{
		vec3 fw = fwidth( vBldObj );
		vec3 dist = abs( fract( vBldObj * ( 1.0 / 1.2 ) - 0.5 ) - 0.5 ) * 1.2;
		// edges kept apart and the normal never normalized from zero: a NaN
		// here would smear through the bloom mips
		vec3 tangent = 1.0 - smoothstep( 0.55, 0.85, abs( vBldObjN ) / max( length( vBldObjN ), 1e-4 ) );
		vec3 line = ( 1.0 - smoothstep( vec3( 0.012 ), 0.012 + max( 1.5 * fw, vec3( 1e-4 ) ), dist ) )
			* tangent * ( 1.0 - smoothstep( vec3( 0.02 ), vec3( 0.07 ), fw ) );
		float seam = max( max( line.x, line.y ), line.z ) * ( 1.0 - bldGlass ) * step( vBldMat.z, 0.5 )
			* ( 1.0 - smoothstep( 80.0, 160.0, length( vViewPosition ) ) );
		diffuseColor.rgb *= 1.0 - 0.12 * seam;
	}
	#endif
`;

const FRAG_ROUGH = /* glsl */`
	roughnessFactor = mix( mix( vBldMat.x, 0.92, bldDust ), 1.0, 0.35 * vBldState.z );
`;

const FRAG_METAL = /* glsl */`
	metalnessFactor = vBldMat.y * ( 1.0 - bldDust );
`;

const FRAG_EMISSIVE = /* glsl */`
	{
		float lit = vBldState.x;
		float win = step( 0.5, vBldMat.z ) * step( vBldMat.z, 1.5 );
		float beacon = step( 1.5, vBldMat.z );
		float blink = step( 0.9, fract( uBldTime * 0.5 + vBldPhase ) );
		totalEmissiveRadiance += ${warm} * ( win * lit * uBldNight * 1.6 );
		totalEmissiveRadiance += vec3( 1.0 ) * ( beacon * lit * blink * ( 0.8 + 5.0 * uBldNight ) );
		// the print head: a hot band just under the cut while building
		float band = ( 1.0 - smoothstep( 0.0, 0.14, vBldState.w - vBldObj.y ) ) * step( vBldState.w, 999.0 );
		totalEmissiveRadiance += ${warm} * ( band * 2.4 );
	}
`;

const FRAG_FLOODS = /* glsl */`
	reflectedLight.directDiffuse += floodIrradiance( vBldWorld, ${WORLD_NORMAL} ) * BRDF_Lambert( material.diffuseColor );
`;

const vertEdits = (): [string, string][] => [
  ['#include <common>', VERT_PARS],
  ['#include <project_vertex>', VERT_MAIN],
];
const fragEdits = (seams: boolean, floods: number): [string, string][] => [
  ['#include <common>', FRAG_PARS(seams)],
  ['#include <clipping_planes_fragment>', FRAG_CUT],
  ['#include <color_fragment>', FRAG_COLOR],
  ['#include <roughnessmap_fragment>', FRAG_ROUGH],
  ['#include <metalnessmap_fragment>', FRAG_METAL],
  ['#include <emissivemap_fragment>', FRAG_EMISSIVE],
  ['#include <lights_physical_pars_fragment>', floodPars(floods)],
  ['#include <lights_fragment_end>', FRAG_FLOODS],
];
const ANCHORS_OK = hasAnchors(THREE.ShaderLib.standard.vertexShader, vertEdits())
  && hasAnchors(THREE.ShaderLib.standard.fragmentShader, fragEdits(true, 1));

export const buildingPatch: ShaderPatch = (mat, level) => {
  if (level > 2 || !ANCHORS_OK) return null;
  const seams = level <= 1;
  const floods = floodSlots(level);
  mat.onBeforeCompile = (shader) => {
    const vs = injectAll(shader.vertexShader, vertEdits());
    const fs = injectAll(shader.fragmentShader, fragEdits(seams, floods));
    if (!vs || !fs) return;
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
    shader.uniforms.uBldNight = buildingUniforms.uBldNight;
    shader.uniforms.uBldTime = buildingUniforms.uBldTime;
    bindFloodUniforms(shader.uniforms);
  };
  return `bldg-${seams ? 2 : 1}`;
};

const DEPTH_VERT_PARS = /* glsl */`
#define ${PATCH_MARKER}
#ifdef USE_INSTANCING
	attribute vec4 iState;
#endif
varying float vBldY;
varying float vBldCut;
`;
const DEPTH_VERT = /* glsl */`
	vBldY = transformed.y;
	#ifdef USE_INSTANCING
		vBldCut = iState.w;
	#else
		vBldCut = ${CUT_NONE.toFixed(1)};
	#endif
`;
const DEPTH_FRAG_PARS = /* glsl */`
#define ${PATCH_MARKER}
varying float vBldY;
varying float vBldCut;
`;
const depthVertEdits = (): [string, string][] => [
  ['#include <common>', DEPTH_VERT_PARS],
  ['#include <project_vertex>', DEPTH_VERT],
];
const depthFragEdits = (): [string, string][] => [
  ['#include <common>', DEPTH_FRAG_PARS],
  ['#include <clipping_planes_fragment>', '\tif ( vBldY > vBldCut ) discard;'],
];
const DEPTH_ANCHORS_OK = hasAnchors(THREE.ShaderLib.depth.vertexShader, depthVertEdits())
  && hasAnchors(THREE.ShaderLib.depth.fragmentShader, depthFragEdits());

/** The shadow pass keeps in step with the reveal (same levels, same cut). */
export const buildingDepthPatch: ShaderPatch<THREE.MeshDepthMaterial> = (mat, level) => {
  if (level > 2 || !DEPTH_ANCHORS_OK || !ANCHORS_OK) return null;
  mat.onBeforeCompile = (shader) => {
    const vs = injectAll(shader.vertexShader, depthVertEdits());
    const fs = injectAll(shader.fragmentShader, depthFragEdits());
    if (!vs || !fs) return;
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
  };
  return 'bldg-depth';
};
