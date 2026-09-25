/** The classic style's buildings (and everything else on the building
 *  material: solar wings and dishes, rovers, the cargo lander).
 *
 *  Palette. The kit bakes each part's finish into its vertices (a gray
 *  value in `color`, roughness / metalness / emissive id in `mat`); classic
 *  maps each finish to a colour, per structure where it helps identity:
 *    hull (BODY)       warm white       radiators   white
 *    panels (PLATE)    mid gray         trim        orange accent
 *    PV cells (GLASS)  dark blue        windows     dark blue glass
 *    lamps             warm white       beacons     red, blinking
 *    MLI foil          gold             decks       slate (trim parts with
 *                                                   a face over 5 m²: roofs,
 *                                                   plinths, stacks — the
 *                                                   orange stays an accent)
 *    foliage (LEAF)    greenhouse green
 *  with the solar wings' and arrays' frames silver, the Foil Factory's trim
 *  gold, the Server Monolith near-black with teal glass, the Drone Hive dark
 *  and the Garden Dome's ribs silver. The colours go into the instanced view's own `color`
 *  attribute, so the shared recipe buffers stay High detail's.
 *
 *  Shader. One small ShaderMaterial, no patches, no loops, no derivatives,
 *  no extensions: Lambert from the key light plus the hemisphere fill,
 *  evaluated per vertex (the kit's parts are flat or smooth by geometry),
 *  and per-instance state: unpowered = dark windows and no beacon, wear
 *  darkens, dust greys the PV glass, and fragments above the print cut are
 *  discarded under a warm band (the 3D-print reveal). Windows and lamps glow
 *  at their light level (lightLevel below, per instance in `iGlow`;
 *  −1 = follow the night, for rovers and moving parts), warm or cold by the
 *  instance's `iWarm` (CLASSIC_WARM … CLASSIC_COLD), and flicker red while
 *  its `iAlarm` is up. If a GPU rejects it,
 *  game.ts swaps in stock Lambert (classicFallbackMaterial) — the palette
 *  stays, the glow and the reveal go. */
import * as THREE from 'three';
import type { BuildingState } from '../core/state';
import type { BuildingId } from '../data/buildings';
import { materials } from '../world/materials';
import { classicLightUniforms } from '../world/classicLighting';
import { CUT_NONE, buildingUniforms } from './buildingShader';
import {
  BEACON, BODY, FOIL, GLASS, LAMP, LEAF, PLATE, RADIATOR, TRIM, WINDOW, setInstanceHook, type Finish,
} from './meshKit';
import type { PartId } from './recipes';

/** How brightly a structure's own lights burn, 0 (off) … 1 (full): the one
 *  place the classic windows and flood discs key on. A complete, enabled,
 *  powered structure lights as dark as it stands (`dark`: the structure's
 *  darkness from darkness.ts — night, a set or grazing sun, terrain shadow). */
export function lightLevel(b: BuildingState, dark: number): number {
  const powered = (b.construction ?? 0) <= 0 && b.enabled && b.idleReason !== 'power';
  return powered ? dark : 0;
}

export type PaletteKey = 'hull' | 'radiator' | 'panel' | 'trim' | 'deck' | 'cell' | 'window' | 'lamp' | 'beacon' | 'foil'
  | 'leaf' | 'road' | 'roadMark';
type Palette = Record<PaletteKey, number>;

/** sRGB, as authored (the classic renderer does no tone mapping) */
export const CLASSIC_PALETTE: Readonly<Palette> = {
  hull: 0xebe6dc,
  radiator: 0xf3f2ed,
  panel: 0x8e9197,
  trim: 0xd9772b,
  deck: 0x6f747c,
  cell: 0x1d3a6c,
  window: 0x2a4c80,
  lamp: 0xfff1d6,
  beacon: 0xb02a22,
  foil: 0xd8a53a,
  /** foliage under glass (LEAF): the Colony's green (docs/14 §4.4) */
  leaf: 0x5f8f3f,
  /** the roads (world/roads.ts): sintered regolith, and their kerb and centre marks */
  road: 0xa8a299,
  roadMark: 0xe9e4d8,
};

const SILVER: Partial<Palette> = { trim: 0xc4c8ce, panel: 0xaeb2b8 };
/** per structure (or moving part) */
export const PALETTE_OVERRIDES: Partial<Record<BuildingId | PartId, Partial<Palette>>> = {
  wing: SILVER,
  wingXL: SILVER, // Wing Extensions: the same wing, a row longer
  solar: { trim: 0xb7bbc1 },
  dish: { trim: 0xb7bbc1 },
  foilFactory: { trim: 0xcf9d36 },
  // the destiny buildings (docs/14 §4.4): near-black slabs with teal glass,
  // a dark hive, the dome's silver ribs
  serverMonolith: { hull: 0x23262b, window: 0x0f3a44 },
  droneHive: { hull: 0x3a3f46 },
  gardenDome: { trim: 0xc4c8ce },
};

const FINISHES: [Finish, PaletteKey][] = [
  [BODY, 'hull'], [RADIATOR, 'radiator'], [PLATE, 'panel'], [TRIM, 'trim'], [GLASS, 'cell'],
  [WINDOW, 'window'], [LAMP, 'lamp'], [BEACON, 'beacon'], [FOIL, 'foil'], [LEAF, 'leaf'],
];

const near = (a: number, b: number) => Math.abs(a - b) < 0.012;
/** m²: a trim part with a face this big is a deck, not an accent */
const DECK_AREA = 5;

/** Which palette entry a baked vertex is (by the kit's own finish values). */
export function finishKey(v: number, rough: number, metal: number, emit: number): PaletteKey {
  for (const [f, k] of FINISHES) {
    if (near(f.v, v) && near(f.rough, rough) && near(f.metal, metal) && (f.emit ?? 0) === Math.round(emit)) return k;
  }
  // a finish outside the kit: by emission and value
  if (emit >= 1.5) return 'beacon';
  if (emit >= 0.5) return v < 0.3 ? 'window' : 'lamp';
  return v < 0.3 ? 'cell' : v > 0.6 ? 'hull' : 'panel';
}

const colors = new WeakMap<THREE.BufferGeometry, THREE.BufferAttribute>();

/** The classic colour attribute for a baked geometry (cached per source). */
export function classicColors(src: THREE.BufferGeometry): THREE.BufferAttribute {
  let attr = colors.get(src);
  if (attr) return attr;
  const col = src.getAttribute('color');
  const mat = src.getAttribute('mat');
  const id = (src.userData.recipe ?? src.userData.part) as BuildingId | PartId | undefined;
  const pal: Palette = { ...CLASSIC_PALETTE, ...(id ? PALETTE_OVERRIDES[id] : undefined) };
  const lin = new Map<PaletteKey, THREE.Color>();
  for (const k of Object.keys(pal) as PaletteKey[]) lin.set(k, new THREE.Color(pal[k]));
  const area = src.userData.partArea as Float32Array | undefined;
  const out = new Float32Array(col.count * 3);
  for (let i = 0; i < col.count; i++) {
    let key = mat ? finishKey(col.getX(i), mat.getX(i), mat.getY(i), mat.getZ(i)) : 'hull';
    if (key === 'trim' && (area?.[i] ?? 0) > DECK_AREA) key = 'deck';
    const c = lin.get(key)!;
    out[i * 3] = c.r; out[i * 3 + 1] = c.g; out[i * 3 + 2] = c.b;
  }
  attr = new THREE.BufferAttribute(out, 3);
  colors.set(src, attr);
  return attr;
}

/** window and lamp light, linear: a warm sodium-ish yellow (≈ #ffd494 on screen) */
export const CLASSIC_WARM = new THREE.Color(1.0, 0.66, 0.29);
/** …and the machines' cold light (≈ #bfe9ff on screen): server cyan, the
 *  Automation's night (docs/14 §4.4). Each instance mixes the two by its iWarm. */
export const CLASSIC_COLD = new THREE.Color(0.52, 0.815, 1.0);
const vec = (c: THREE.Color) => `vec3( ${c.r.toFixed(3)}, ${c.g.toFixed(3)}, ${c.b.toFixed(3)} )`;
const warm = vec(CLASSIC_WARM);
const cold = vec(CLASSIC_COLD);

const VERT = /* glsl */`
#define MBB_CLASSIC
attribute vec3 mat;
#ifdef USE_INSTANCING
	attribute vec4 iState;
	attribute float iGlow;
	attribute float iWarm;
	attribute float iAlarm;
#endif
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uSky;
uniform vec3 uGround;
uniform float uBldNight;
uniform float uBldTime;
varying vec3 vLit;
varying vec3 vEmit;
varying float vY;
varying float vCut;
void main() {
	vec4 st = vec4( 1.0, 0.0, 0.0, ${CUT_NONE.toFixed(1)} );
	float glow = uBldNight;
	float phase = 0.0;
	float warmth = 1.0;
	float alarm = 0.0;
	mat4 m = modelMatrix;
	#ifdef USE_INSTANCING
		st = iState;
		glow = iGlow < 0.0 ? uBldNight : iGlow;
		warmth = iWarm;
		alarm = iAlarm;
		m = modelMatrix * instanceMatrix;
		phase = fract( dot( instanceMatrix[ 3 ].xz, vec2( 0.1373, 0.2719 ) ) );
	#endif
	vec3 c = vec3( 1.0 );
	#ifdef USE_COLOR
		c = color;
	#endif
	#ifdef USE_INSTANCING_COLOR
		c *= instanceColor;
	#endif
	float powered = step( 0.5, st.x );
	float glass = 1.0 - step( 0.25, mat.x );
	float win = step( 0.5, mat.z ) * step( mat.z, 1.5 );
	float beacon = step( 1.5, mat.z );
	c = mix( c, vec3( 0.28 ), st.y * glass * 0.85 * ( 1.0 - win ) );
	c *= 1.0 - 0.3 * st.z;
	vec3 n = normalize( mat3( m ) * normal );
	vec3 light = mix( uGround, uSky, 0.5 + 0.5 * n.y ) + uLightColor * max( dot( n, uLightDir ), 0.0 );
	float g = clamp( win * powered * glow, 0.0, 1.0 );
	vLit = c * light * ( 1.0 - g * glass );
	vEmit = mix( ${cold}, ${warm}, clamp( warmth, 0.0, 1.0 ) ) * g * mix( 0.55, 1.15, glass );
	float blink = step( 0.9, fract( uBldTime * 0.5 + phase ) );
	vEmit += vec3( 1.0, 0.13, 0.08 ) * ( beacon * powered * blink * ( 0.9 + 0.6 * uBldNight ) );
	// the alarm hook (instances.ts alarmOf): windows and lamps flicker red, day or night
	float flick = step( 0.5, fract( uBldTime * 2.3 + phase ) ) * step( 0.5, mat.z );
	vEmit += vec3( 1.0, 0.16, 0.08 ) * ( clamp( alarm, 0.0, 1.0 ) * flick * 0.9 );
	vY = position.y;
	vCut = st.w;
	gl_Position = projectionMatrix * viewMatrix * m * vec4( position, 1.0 );
}
`;

const FRAG = /* glsl */`
#define MBB_CLASSIC
varying vec3 vLit;
varying vec3 vEmit;
varying float vY;
varying float vCut;
void main() {
	if ( vY > vCut ) discard;
	// the print head: a warm band just under the cut while building
	float band = ( 1.0 - smoothstep( 0.0, 0.14, vCut - vY ) ) * step( vCut, 999.0 );
	gl_FragColor = vec4( vLit + vEmit + ${warm} * ( band * 1.3 ), 1.0 );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`;

/** Marks the classic building program: a compile error in it is the classic
 *  shader's own fault (game.ts swaps in stock Lambert). */
export const CLASSIC_MARKER = 'MBB_CLASSIC';

export const CLASSIC_BUILDING = new THREE.ShaderMaterial({
  name: 'classic-building',
  vertexShader: VERT,
  fragmentShader: FRAG,
  vertexColors: true,
  uniforms: {
    ...classicLightUniforms,
    uBldNight: buildingUniforms.uBldNight,
    uBldTime: buildingUniforms.uBldTime,
  },
});
materials.defineClassic('building', CLASSIC_BUILDING);

/** Stock Lambert in the classic palette: the fallback when the classic
 *  shader does not compile on a GPU. */
export function classicFallbackMaterial(): THREE.Material {
  return new THREE.MeshLambertMaterial({ vertexColors: true });
}

/** Install the classic palette and light level on every instanced view
 *  made from here on (call once at boot, classic style only). */
export function installClassicBuildings() {
  setInstanceHook((view, src, max) => {
    if (src.getAttribute('color')) view.setAttribute('color', classicColors(src));
    view.setAttribute('iGlow', new THREE.InstancedBufferAttribute(new Float32Array(max).fill(-1), 1));
  });
}
