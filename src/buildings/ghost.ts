/** Placement ghost. A registry material (patched at FX 0–2, stock at FX 3,
 *  a stock copy in safe mode) over a depth-only pre-pass, so only the front
 *  surface blends — internal faces never double up.
 *
 *  Patched: half-Lambert from the sun plus a fresnel rim, so the form reads;
 *  valid = pale, blocked = dark with a diagonal hatch (value and pattern,
 *  never hue). Stock: today's flat pale / dark fill. */
import * as THREE from 'three';
import { PATCH_MARKER, hasAnchors, injectAll, materials, type ShaderPatch } from '../world/materials';

export const ghostUniforms = {
  uGhostSun: { value: new THREE.Vector3(0, 1, 0) },
  uGhostBlocked: { value: 0 },
};

const VALID = { color: new THREE.Color(0xf5f7f9), opacity: 0.42 };
const BLOCKED = { color: new THREE.Color(0x14161a), opacity: 0.6 };

const VERT_PARS = /* glsl */`
#define ${PATCH_MARKER}
varying vec3 vGhostN;
varying vec3 vGhostW;
`;
const VERT_MAIN = /* glsl */`
	vGhostN = mat3( modelMatrix ) * normal;
	vGhostW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
`;
const FRAG_PARS = /* glsl */`
#define ${PATCH_MARKER}
uniform vec3 uGhostSun;
uniform float uGhostBlocked;
varying vec3 vGhostN;
varying vec3 vGhostW;
`;
const FRAG_MAIN = /* glsl */`
	{
		vec3 gN = vGhostN / max( length( vGhostN ), 1e-4 );
		vec3 gV = cameraPosition - vGhostW;
		gV /= max( length( gV ), 1e-4 );
		if ( dot( gN, gV ) < 0.0 ) gN = - gN;
		float lam = 0.5 + 0.5 * dot( gN, uGhostSun );
		float rim = pow( 1.0 - saturate( dot( gN, gV ) ), 3.0 );
		float hatch = step( 0.5, fract( ( gl_FragCoord.x + gl_FragCoord.y ) * 0.1 ) );
		vec3 valid = vec3( 0.9 ) * lam + 0.45 * rim;
		vec3 blocked = mix( vec3( 0.025 ), vec3( 0.36 ) * lam, hatch ) + 0.2 * rim;
		outgoingLight = mix( valid, blocked, uGhostBlocked );
		diffuseColor.a = mix( 0.36 + 0.3 * rim, 0.55 + 0.25 * rim, uGhostBlocked );
	}
`;
const vertEdits = (): [string, string][] => [
  ['#include <common>', VERT_PARS],
  ['#include <project_vertex>', VERT_MAIN],
];
const fragEdits = (): [string, string, boolean][] => [
  ['#include <common>', FRAG_PARS, false],
  ['#include <opaque_fragment>', FRAG_MAIN, true],
];
const ANCHORS_OK = hasAnchors(THREE.ShaderLib.basic.vertexShader, vertEdits())
  && hasAnchors(THREE.ShaderLib.basic.fragmentShader, fragEdits());

const ghostPatch: ShaderPatch<THREE.MeshBasicMaterial> = (mat, level) => {
  if (level > 2 || !ANCHORS_OK) return null;
  mat.onBeforeCompile = (shader) => {
    const vs = injectAll(shader.vertexShader, vertEdits());
    const fs = injectAll(shader.fragmentShader, fragEdits());
    if (!vs || !fs) return;
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
    shader.uniforms.uGhostSun = ghostUniforms.uGhostSun;
    shader.uniforms.uGhostBlocked = ghostUniforms.uGhostBlocked;
  };
  return 'ghost-lit';
};

materials.define('ghost', new THREE.MeshBasicMaterial({
  color: VALID.color, transparent: true, opacity: VALID.opacity, depthWrite: false,
}), ghostPatch);

// pushed back a hair so the ghost's own front faces pass the depth test
const PREPASS = new THREE.MeshBasicMaterial({
  colorWrite: false, transparent: true,
  polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
});

export function createGhost(geo: THREE.BufferGeometry): THREE.Mesh {
  const ghost = new THREE.Mesh(geo, materials.get('ghost'));
  ghost.renderOrder = 11;
  const pre = new THREE.Mesh(geo, PREPASS);
  pre.renderOrder = 10;
  ghost.add(pre);
  return ghost;
}

export function setGhostBlocked(ghost: THREE.Mesh, blocked: boolean) {
  const m = ghost.material as THREE.MeshBasicMaterial;
  const s = blocked ? BLOCKED : VALID;
  m.color.copy(s.color);
  m.opacity = s.opacity;
  ghostUniforms.uGhostBlocked.value = blocked ? 1 : 0;
}
