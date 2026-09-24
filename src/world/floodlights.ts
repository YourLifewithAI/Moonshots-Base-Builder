/** Night work lights as shader data instead of scene lights: one fixed-size
 *  uniform array of mast-top floods, shared by the terrain, rock and building
 *  patches, so a pool follows the ground it falls on (no flat discs cutting
 *  through slopes) and costs nothing by day (count 0 → the loop exits at once).
 *
 *  Filled on each economy tick from every powered structure — a brownout
 *  turns that structure's pool off, a visible cause. More structures than
 *  slots merge into grid clusters, so none is ever dropped and the set never
 *  re-sorts while the camera pans. FX 3, a patch fault and safe mode fall
 *  back to the old discs + PointLights (buildings/instances.ts). */
import * as THREE from 'three';
import { PATCH_MARKER, hasAnchors, injectAll, type ShaderPatch } from './materials';

export const FLOOD_MAX = 32;
/** neutral warm white (≈ 5000 K): pools, windows and the print band */
export const FLOOD_COLOR = new THREE.Color(1.0, 0.955, 0.88);
const FLOOD_INTENSITY = 6.2;
const FALLOFF_M = 9;            // inverse-square knee: about a mast height
/** Night earthshine floor on the landscape (terrain + rocks, not hulls):
 *  irradiance in earthshine blue, scaled so open ground reads ~8–12/255
 *  after AgX. The hemisphere alone would have to be so strong to get there
 *  that every unlit wall turned navy. */
const EARTH_FLOOR = new THREE.Color(0x2a3a55).multiplyScalar(0.11 / 0.0371);

/** Slots a patch compiles at an FX level (the loop is the cost). */
export function floodSlots(level: number): number {
  return level <= 1 ? FLOOD_MAX : level === 2 ? 16 : 0;
}

/** World-space normal from a view-space one (fragment shader snippet). */
export const WORLD_NORMAL = '( vec4( geometryNormal, 0.0 ) * viewMatrix ).xyz';

export const floodUniforms = {
  uFlood: { value: Array.from({ length: FLOOD_MAX }, () => new THREE.Vector4()) },
  uFloodCount: { value: 0 },
  uFloodGain: { value: 0 },
  uEarthFloor: { value: new THREE.Color(0, 0, 0) },
};

export interface FloodSource {
  x: number; z: number;
  /** lamp height (world y) */
  y: number;
  /** reach from the lamp (m) */
  r: number;
}

let sources: FloodSource[] = [];
let filled = 0;
let slots = FLOOD_MAX;
let night = 0;

function cluster(list: FloodSource[], cap: number): FloodSource[] {
  if (list.length <= cap) return list;
  for (let cell = 24; ; cell *= 1.5) {
    const bins = new Map<string, FloodSource[]>();
    for (const s of list) {
      const k = `${Math.floor(s.x / cell)},${Math.floor(s.z / cell)}`;
      let b = bins.get(k);
      if (!b) bins.set(k, (b = []));
      b.push(s);
    }
    if (bins.size > cap) continue;
    return [...bins.values()].map((b) => {
      let x = 0, z = 0, y = 0;
      for (const s of b) { x += s.x; z += s.z; y = Math.max(y, s.y); }
      x /= b.length; z /= b.length;
      let r = 0;
      for (const s of b) r = Math.max(r, Math.hypot(s.x - x, s.z - z) + s.r);
      return { x, z, y, r };
    });
  }
}

function upload() {
  const list = cluster(sources, slots);
  const arr = floodUniforms.uFlood.value;
  list.forEach((s, i) => arr[i].set(s.x, s.y, s.z, s.r));
  filled = list.length;
  floodUniforms.uFloodCount.value = night > 0.03 ? filled : 0;
}

/** Replace the set of lit structures (economy tick / rebuild). */
export function setFloodSources(list: FloodSource[]) {
  sources = list;
  upload();
}

/** Slots available at the current FX level (clusters shrink to fit). */
export function setFloodSlots(n: number) {
  if (n === slots || n <= 0) return;
  slots = n;
  upload();
}

/** 0 = day … 1 = deep night; per frame. */
export function setFloodNight(f: number) {
  night = f;
  floodUniforms.uFloodGain.value = FLOOD_INTENSITY * f;
  floodUniforms.uFloodCount.value = f > 0.03 ? filled : 0;
  floodUniforms.uEarthFloor.value.copy(EARTH_FLOOR).multiplyScalar(f);
}

export function floodStats() {
  return { sources: sources.length, slots: filled, live: floodUniforms.uFloodCount.value };
}

/** Uniforms + `vec3 floodIrradiance(worldPos, worldNormal)` for a fragment
 *  shader; `n` = compiled slot count (0 → no-op stub). Also declares the
 *  landscape's `uEarthFloor`. */
export function floodPars(n: number): string {
  if (n <= 0) return 'uniform vec3 uEarthFloor;\nvec3 floodIrradiance( vec3 p, vec3 n ) { return vec3( 0.0 ); }';
  const c = FLOOD_COLOR;
  return /* glsl */`
uniform vec3 uEarthFloor;
uniform vec4 uFlood[ ${n} ];
uniform int uFloodCount;
uniform float uFloodGain;
vec3 floodIrradiance( const in vec3 p, const in vec3 n ) {
	float sum = 0.0;
	for ( int i = 0; i < ${n}; i ++ ) {
		if ( i >= uFloodCount ) break;
		vec4 f = uFlood[ i ];
		vec3 d = f.xyz - p;
		float d2 = dot( d, d );
		float x = d2 / ( f.w * f.w );
		if ( x >= 1.0 ) continue;
		float win = 1.0 - x * x;
		sum += max( dot( n, d ), 0.0 ) * inversesqrt( max( d2, 1e-4 ) ) * win * win / ( 1.0 + d2 * ${(1 / FALLOFF_M ** 2).toFixed(5)} );
	}
	return sum * uFloodGain * vec3( ${c.r.toFixed(3)}, ${c.g.toFixed(3)}, ${c.b.toFixed(3)} );
}
`;
}

/** Hand the shared uniforms to a compiling shader. */
export function bindFloodUniforms(uniforms: Record<string, THREE.IUniform>) {
  uniforms.uFlood = floodUniforms.uFlood;
  uniforms.uFloodCount = floodUniforms.uFloodCount;
  uniforms.uFloodGain = floodUniforms.uFloodGain;
  uniforms.uEarthFloor = floodUniforms.uEarthFloor;
}

/** Landscape lighting at night: floods plus the earthshine floor (fragment
 *  snippet after lights_fragment_end; `wp` = world-position expression). */
export const landscapeNight = (wp: string) => /* glsl */`
	{
		vec3 wn = ${WORLD_NORMAL};
		reflectedLight.directDiffuse += floodIrradiance( ${wp}, wn ) * BRDF_Lambert( material.diffuseColor );
		reflectedLight.indirectDiffuse += uEarthFloor * ( 0.6 + 0.4 * wn.y ) * BRDF_Lambert( material.diffuseColor );
	}
`;


const FLOOD_VERT_PARS = /* glsl */`
#define ${PATCH_MARKER}
varying vec3 vFloodWorld;
`;
const FLOOD_VERT = /* glsl */`
	#ifdef USE_INSTANCING
		vFloodWorld = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
	#else
		vFloodWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
	#endif
`;
const FLOOD_FRAG = landscapeNight('vFloodWorld');
const floodVertEdits = (): [string, string][] => [
  ['#include <common>', FLOOD_VERT_PARS],
  ['#include <project_vertex>', FLOOD_VERT],
];
const floodFragEdits = (n: number): [string, string][] => [
  ['#include <common>', `#define ${PATCH_MARKER}\nvarying vec3 vFloodWorld;\n${floodPars(n)}`],
  ['#include <lights_fragment_end>', FLOOD_FRAG],
];
const FLOOD_ANCHORS_OK = hasAnchors(THREE.ShaderLib.standard.vertexShader, floodVertEdits())
  && hasAnchors(THREE.ShaderLib.standard.fragmentShader, floodFragEdits(1));

/** Floods + earthshine floor, for stock-lit props (rocks) on the landscape. */
export const floodPatch: ShaderPatch = (mat, level) => {
  const n = floodSlots(level);
  if (n === 0 || !FLOOD_ANCHORS_OK) return null;
  mat.onBeforeCompile = (shader) => {
    const vs = injectAll(shader.vertexShader, floodVertEdits());
    const fs = injectAll(shader.fragmentShader, floodFragEdits(n));
    if (!vs || !fs) return;
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
    bindFloodUniforms(shader.uniforms);
  };
  return `floods-${n}`;
};
