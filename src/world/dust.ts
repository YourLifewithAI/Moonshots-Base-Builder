/** Regolith ejecta: one Points cloud of grains in pooled emitter slots, each
 *  grain flying a closed-form vacuum ballistic — p = p0 + v·t + ½·g·t²,
 *  g = 1.62 m/s², no drag and no billowing, so arcs are the long clean
 *  parabolas of the Apollo rover rooster tails. The vertex shader derives a
 *  grain's launch from a hash of (grain, cycle), so the CPU only writes the
 *  emitter uniforms. A moving emitter's grains fly relative to it: exact for
 *  a rover at steady speed whose ejecta keep its velocity plus a kick.
 *
 *  The motion is a shader patch through the material registry (variant
 *  'dust-gpu' at FX 0–2, stripped with the rest on a compile fault). FX 3
 *  and a fault fall back to static puffs placed on the CPU; safe mode shows
 *  no dust at all. */
import * as THREE from 'three';
import { GRAVITY } from '../data/balance';
import { mulberry32 } from '../core/rng';
import { PATCH_MARKER, hasAnchors, injectAll, materials, type ShaderPatch } from './materials';

export const DUST_SLOTS = 20;
const PER_SLOT = 96;
const COUNT = DUST_SLOTS * PER_SLOT;

export interface DustEmitter {
  /** launch point on the ground (world) */
  x: number; y: number; z: number;
  /** share of the slot's grains in flight, 0..1 */
  strength: number;
  /** base launch velocity relative to the emitter, m/s */
  vx: number; vy: number; vz: number;
  /** random horizontal speed added in a random direction, m/s */
  hSpread: number;
  /** random extra upward speed, m/s */
  vSpread: number;
  /** launch height above the ground, m (spoil dropping off a conveyor) */
  h0?: number;
  /** grain size, m */
  size?: number;
}

const dustUniforms = {
  uDustA: { value: Array.from({ length: DUST_SLOTS }, () => new THREE.Vector4()) },
  uDustB: { value: Array.from({ length: DUST_SLOTS }, () => new THREE.Vector4()) },
  uDustC: { value: Array.from({ length: DUST_SLOTS }, () => new THREE.Vector4()) },
  uDustTime: { value: 0 },
};

const VERT_PARS = /* glsl */`
#define ${PATCH_MARKER}
attribute vec4 aDust;
uniform vec4 uDustA[ ${DUST_SLOTS} ];
uniform vec4 uDustB[ ${DUST_SLOTS} ];
uniform vec4 uDustC[ ${DUST_SLOTS} ];
uniform float uDustTime;
varying float vDustA;
float dustHash( float p ) {
	p = fract( p * 0.1031 );
	p *= p + 33.33;
	p *= p + p;
	return fract( p );
}
`;

// aDust = (slot, phase, seed, gate); A = (ground point, strength),
// B = (base velocity, horizontal spread), C = (vertical spread, h0, size, –)
const VERT_MAIN = /* glsl */`
	float dustSize = 0.0;
	{
		int k = int( aDust.x + 0.5 );
		vec4 A = uDustA[ k ];
		vec4 B = uDustB[ k ];
		vec4 C = uDustC[ k ];
		const float G = ${GRAVITY.toFixed(3)};
		float vTop = max( B.y + C.x, 0.05 );
		float period = ( vTop + sqrt( vTop * vTop + 2.0 * G * C.y ) ) / G + 0.1;
		float cyc = uDustTime / period + aDust.y;
		float n = floor( cyc );
		float t = ( cyc - n ) * period;
		float h1 = dustHash( aDust.z * 517.0 + n * 1.37 );
		float h2 = dustHash( aDust.z * 263.0 + n * 2.11 + 5.0 );
		float h3 = dustHash( aDust.z * 911.0 + n * 0.73 + 9.0 );
		float vy = B.y + C.x * h1;
		float az = 6.2831853 * h2;
		vec2 vh = B.xz + vec2( cos( az ), sin( az ) ) * B.w * ( 0.25 + 0.75 * h3 );
		float flight = ( vy + sqrt( max( vy * vy + 2.0 * G * C.y, 0.0 ) ) ) / G;
		float live = step( aDust.w, A.w ) * step( t, flight );
		transformed = vec3( A.x + vh.x * t, A.y + C.y + vy * t - 0.5 * G * t * t, A.z + vh.y * t );
		vDustA = live * smoothstep( 0.0, 0.05, t ) * ( 1.0 - smoothstep( 0.7 * flight, flight, t ) );
		dustSize = C.z;
	}
`;

// after the stock size: grains stay grains up close, and dead ones leave clip space
const VERT_SIZE = /* glsl */`
	gl_PointSize = clamp( dustSize * scale / max( - mvPosition.z, 0.1 ), 1.6, 3.5 );
	if ( vDustA < 0.002 ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
`;

const FRAG_PARS = /* glsl */`
#define ${PATCH_MARKER}
varying float vDustA;
`;
const FRAG_MAIN = /* glsl */`
	{
		vec2 dustP = gl_PointCoord - 0.5;
		if ( dot( dustP, dustP ) > 0.25 ) discard;
		diffuseColor.a *= vDustA;
	}
`;

const vertEdits = (): [string, string][] => [
  ['#include <common>', VERT_PARS],
  ['#include <begin_vertex>', VERT_MAIN],
  ['#include <fog_vertex>', VERT_SIZE],
];
const fragEdits = (): [string, string, boolean][] => [
  ['#include <common>', FRAG_PARS, false],
  ['#include <alphatest_fragment>', FRAG_MAIN, true],
];
const ANCHORS_OK = hasAnchors(THREE.ShaderLib.points.vertexShader, vertEdits())
  && hasAnchors(THREE.ShaderLib.points.fragmentShader, fragEdits());

const dustPatch: ShaderPatch<THREE.PointsMaterial> = (mat, level) => {
  if (level > 2 || !ANCHORS_OK) return null;
  mat.onBeforeCompile = (shader) => {
    const vs = injectAll(shader.vertexShader, vertEdits());
    const fs = injectAll(shader.fragmentShader, fragEdits());
    if (!vs || !fs) return;
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
    Object.assign(shader.uniforms, dustUniforms);
  };
  return 'dust-gpu';
};

// the stock (FX 3) look: 2 px static grains
materials.define('dust', new THREE.PointsMaterial({
  color: 0x303030, size: 2, sizeAttenuation: false, transparent: true, opacity: 0.9, depthWrite: false,
}), dustPatch);

export class DustField {
  readonly points: THREE.Points;
  private geo = new THREE.BufferGeometry();
  private pos = new Float32Array(COUNT * 3);
  private seeds = new Float32Array(COUNT * 4);
  /** static-fallback puff offsets per grain (unit hemisphere, flattened) */
  private puff = new Float32Array(COUNT * 3);
  private live: (DustEmitter | null)[] = new Array(DUST_SLOTS).fill(null);
  private shown = 0;

  constructor() {
    const rnd = mulberry32(0xd057);
    for (let i = 0; i < COUNT; i++) {
      this.seeds.set([Math.floor(i / PER_SLOT), rnd(), rnd(), 0.001 + 0.998 * rnd()], i * 4);
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd());
      this.puff.set([Math.cos(a) * r, rnd() * 0.5, Math.sin(a) * r], i * 3);
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aDust', new THREE.BufferAttribute(this.seeds, 4));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.points = new THREE.Points(this.geo, materials.get('dust'));
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    this.points.visible = false;
  }

  /** Per frame. `dt` real seconds (0 while paused); the first DUST_SLOTS
   *  emitters of `list` fly; `light` is the grains' brightness. */
  update(dt: number, list: readonly DustEmitter[], light: number) {
    dustUniforms.uDustTime.value = (dustUniforms.uDustTime.value + dt) % 3600;
    const A = dustUniforms.uDustA.value, B = dustUniforms.uDustB.value, C = dustUniforms.uDustC.value;
    let any = false;
    for (let k = 0; k < DUST_SLOTS; k++) {
      const e = list[k] ?? null;
      this.live[k] = e && e.strength > 0 ? e : null;
      if (!this.live[k]) { A[k].w = 0; continue; }
      any = true;
      A[k].set(e!.x, e!.y, e!.z, Math.min(1, e!.strength));
      B[k].set(e!.vx, e!.vy, e!.vz, e!.hSpread);
      C[k].set(e!.vSpread, e!.h0 ?? 0, e!.size ?? 0.07, 0);
    }
    const mat = this.points.material as THREE.PointsMaterial;
    mat.color.setScalar(light);
    this.points.visible = any && !materials.safeMode;
    if (!this.points.visible) { this.shown = 0; return; }
    if (materials.patched('dust')) {
      this.geo.setDrawRange(0, COUNT);
      this.shown = this.live.reduce((n, e) => n + (e ? Math.round(PER_SLOT * Math.min(1, e.strength)) : 0), 0);
    } else {
      this.placePuffs();
    }
  }

  /** Static fallback: each live slot's grains parked in a low puff. */
  private placePuffs() {
    let n = 0;
    for (let k = 0; k < DUST_SLOTS; k++) {
      const e = this.live[k];
      if (!e) continue;
      const rh = 0.4 + 0.3 * (e.hSpread + Math.hypot(e.vx, e.vz));
      const rv = 0.3 + 0.35 * (e.vy + e.vSpread);
      for (let j = 0; j < PER_SLOT; j++) {
        const i = k * PER_SLOT + j;
        if (this.seeds[i * 4 + 3] > e.strength) continue;
        this.pos[n * 3] = e.x + this.puff[i * 3] * rh;
        this.pos[n * 3 + 1] = e.y + (e.h0 ?? 0) + this.puff[i * 3 + 1] * rv;
        this.pos[n * 3 + 2] = e.z + this.puff[i * 3 + 2] * rh;
        n++;
      }
    }
    this.geo.setDrawRange(0, n);
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.shown = n;
  }

  /** Emitter and grain counts, and which path draws them (tests, probes). */
  info() {
    return {
      emitters: this.live.filter(Boolean).length,
      grains: this.shown,
      visible: this.points.visible,
      mode: materials.safeMode ? 'none' : materials.patched('dust') ? 'gpu' : 'static',
      material: (this.points.material as THREE.Material).type,
    };
  }
}
