/** The cel ground program (docs/19, S1a): the one small ShaderMaterial the
 *  terrain chunks, the horizon ring, berms, boulders, roads and the placement
 *  ghost share. It keeps what the stock Lambert gave them — vertex colours
 *  (or the boulders' instance colours) and the faceted geometry's face
 *  normals — and swaps the smooth light for a ramp of two steps: a face wears
 *  the top step, and the shaded step (`GROUND_RAMP.shade`) once it turns from
 *  the key light by more than `GROUND_RAMP.drop`, measured from level ground's
 *  own n·l. Plains stay one tone; crater walls, berms, pit cuts and the far
 *  side of a boulder read as bands. Per fragment, no derivatives, no
 *  extensions, no loops. (The placement ghost takes the buildings' own
 *  three-step ramp instead — `ramp: 'building'` — so a form reads like the
 *  structure it will become.)
 *
 *  Every material made here shares the program's source (three compiles it
 *  once per set of options), so the ground costs one or two programs. The
 *  `#define MBB_CEL` marker makes a compile error in it the cel programs'
 *  own fault: game.ts falls back to stock Lambert for all of them
 *  (materials.replaceCustom). */
import * as THREE from 'three';
import { celLightUniforms } from './celLighting';

const VERT = /* glsl */`
#define MBB_CEL
varying vec3 vCol;
varying vec3 vN;
void main() {
	vec3 c = vec3( 1.0 );
	#ifdef USE_COLOR
		c = color;
	#endif
	vec3 n = normal;
	mat4 m = modelMatrix;
	#ifdef USE_INSTANCING_COLOR
		c *= instanceColor;
	#endif
	#ifdef USE_INSTANCING
		// the normal matrix of a squashed boulder: as three's own Lambert does it
		mat3 im = mat3( instanceMatrix );
		n /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
		n = im * n;
		m = modelMatrix * instanceMatrix;
	#endif
	vN = normalize( mat3( modelMatrix ) * n );
	vCol = c;
	gl_Position = projectionMatrix * viewMatrix * m * vec4( position, 1.0 );
}
`;

/** the ground's tone steps: linear brightness per step (about 6% of the
 *  mare's own tone; no logarithms, which software GL pays for), and the soft
 *  share of each step's edge (a linear ramp from 0.4 to 0.6 of the step) */
const POSTER_STEP = 0.014, POSTER_EDGE = ['0.4', '5.0'];

const FRAG = /* glsl */`
#define MBB_CEL
uniform vec3 uLightDir;
uniform vec3 uLightFull;
uniform vec2 uGroundRamp;
uniform vec3 uRamp;
uniform vec2 uRampEdge;
uniform float uRampSoft;
uniform vec3 uTint;
uniform vec3 uEmit;
uniform float uOpacity;
varying vec3 vCol;
varying vec3 vN;
void main() {
	vec3 albedo = vCol;
	#ifdef CEL_POSTER
		// the ground's own tone in flat patches, not a smear: brightness in steps
		// of about ${POSTER_STEP} (linear, the hue left alone), each edge a hair soft
		float lum = max( dot( albedo, vec3( 0.3, 0.59, 0.11 ) ), 0.0001 );
		float t = lum * ${(1 / POSTER_STEP).toFixed(2)};
		float r = fract( t );
		albedo *= ( t - r + clamp( ( r - ${POSTER_EDGE[0]} ) * ${POSTER_EDGE[1]}, 0.0, 1.0 ) ) / t;
	#endif
	float ndl = dot( normalize( vN ), uLightDir );
	#ifdef CEL_BUILDING_RAMP
		float s0 = smoothstep( uRampEdge.x - uRampSoft, uRampEdge.x + uRampSoft, ndl );
		float s1 = smoothstep( uRampEdge.y - uRampSoft, uRampEdge.y + uRampSoft, ndl );
		float q = mix( mix( uRamp.z, uRamp.y, s1 ), uRamp.x, s0 );
	#else
		// n·l against level ground's own: 0 on the flat, negative turned from the light
		float d = ndl - uLightDir.y;
		float s = smoothstep( -uGroundRamp.y - uRampSoft, -uGroundRamp.y + uRampSoft, d );
		float q = mix( uGroundRamp.x, 1.0, s );
	#endif
	gl_FragColor = vec4( albedo * uTint * uLightFull * q + uEmit, uOpacity );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`;

/** A ground material: vertex colours and/or instance colours, `tint` a flat
 *  multiplier (1 = none), the rest as any three material's parameters. */
export function celSurface(name: string, params: {
  vertexColors?: boolean; tint?: THREE.ColorRepresentation; emit?: THREE.ColorRepresentation; opacity?: number;
  /** 'ground' (default): two steps; 'building': the buildings' ramp */
  ramp?: 'ground' | 'building';
  /** the vertex colours' brightness in flat steps (the terrain and the horizon ring) */
  poster?: boolean;
  transparent?: boolean; depthWrite?: boolean;
  polygonOffset?: boolean; polygonOffsetFactor?: number; polygonOffsetUnits?: number;
} = {}): THREE.ShaderMaterial {
  const { tint = 0xffffff, emit = 0x000000, opacity = 1, ramp = 'ground', poster = false, ...rest } = params;
  const mat = new THREE.ShaderMaterial({
    name,
    vertexShader: VERT,
    fragmentShader: FRAG,
    ...rest,
    defines: { ...(ramp === 'building' ? { CEL_BUILDING_RAMP: 1 } : {}), ...(poster ? { CEL_POSTER: 1 } : {}) },
    transparent: rest.transparent ?? opacity < 1,
    uniforms: {
      uLightDir: celLightUniforms.uLightDir,
      uLightFull: celLightUniforms.uLightFull,
      uGroundRamp: celLightUniforms.uGroundRamp,
      uRamp: celLightUniforms.uRamp,
      uRampEdge: celLightUniforms.uRampEdge,
      uRampSoft: celLightUniforms.uRampSoft,
      uTint: { value: new THREE.Color(tint) },
      uEmit: { value: new THREE.Color(emit) },
      uOpacity: { value: opacity },
    },
  });
  mat.opacity = opacity; // (safe mode's unlit twin copies it)
  return mat;
}

/** Stock Lambert in the same colours: the fallback when the ground program
 *  does not compile on a GPU. */
export function celSurfaceFallback(params: { vertexColors?: boolean } = {}): THREE.Material {
  return new THREE.MeshLambertMaterial(params);
}
