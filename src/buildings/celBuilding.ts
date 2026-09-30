/** The cel style's buildings (and everything else on the building material:
 *  solar wings and dishes, rovers, hub units, the cargo lander, the work kit).
 *
 *  Palette. The kit bakes each part's finish into its vertices (a gray
 *  value in `color`, roughness / metalness / emissive id in `mat`); the cel
 *  palette maps each finish to a colour, per structure where it helps identity:
 *    hull (BODY)       warm paper       radiators   white
 *    panels (PLATE)    cool slate       trim        the family accent
 *    PV cells (GLASS)  dark blue        windows     dark blue glass
 *    lamps             warm white       beacons     red, blinking
 *    MLI foil          gold             decks       slate (trim parts with
 *                                                   a face over 5 m²: roofs,
 *                                                   plinths, stacks — the
 *                                                   accent stays an accent)
 *    foliage (LEAF)    greenhouse green
 *  One accent per family (data/families.ts): a structure's trim is
 *  `FAMILY_ACCENT[FAMILY_OF[recipe]]`, a moving thing's its `UNIT_ACCENT`,
 *  a hub's digger its `HUB_LIVERY` band and body; anything untagged wears the
 *  logistics slate. The solar wings' and dishes' frames stay silver, the
 *  Server Monolith is near-black with teal glass and the Drone Hive dark. The
 *  colours go into the instanced view's own `color` attribute (celColors), so
 *  the shared recipe buffers stay the kit's grays.
 *
 *  Shader. One small ShaderMaterial, no patches, no loops, no derivatives,
 *  no extensions. A face's light is a ramp of its own colour: n·l against
 *  the key, evaluated per fragment (so a dome's terminator is a curve), steps
 *  the top step's colour (celLighting's `uLightFull`) by 1.0 / 0.72 / 0.5
 *  (variant A: two steps), edges 0.02 soft (celStyle.ts). Per-instance
 *  state: unpowered = dark windows and no beacon, wear
 *  darkens, dust greys the PV glass, and fragments above the print cut are
 *  discarded under a warm band (the 3D-print reveal). Windows and lamps glow
 *  at their light level (lightLevel below, per instance in `iGlow`;
 *  −1 = follow the night, for rovers and moving parts), warm or cold by the
 *  instance's `iWarm` (CEL_WARM … CEL_COLD), and flicker red while
 *  its `iAlarm` is up. If a GPU rejects it,
 *  game.ts swaps in stock Lambert (celFallbackMaterial, with the ground's) — the palette
 *  stays, the glow and the reveal go. */
import * as THREE from 'three';
import type { BuildingState } from '../core/state';
import type { BuildingId } from '../data/buildings';
import { FAMILY_ACCENT, FAMILY_OF, UNIT_ACCENT, liveryOf, type UnitKey } from '../data/families';
import { materials } from '../world/materials';
import { celLightUniforms } from '../world/celLighting';
import {
  BEACON, BODY, CUT_NONE, FOIL, GLASS, LAMP, LEAF, PLATE, RADIATOR, TRIM, WINDOW, setInstanceHook, type Finish,
} from './meshKit';
import type { PartId } from './recipes';

/** Cut height meaning "fully built" (no discard, no band); defined in
 *  meshKit.ts (the kit's own instance state needs it) and shared from here. */
export { CUT_NONE };

/** The per-frame uniforms the building program reads (night level, blink clock). */
export const buildingUniforms = {
  uBldNight: { value: 0 },
  uBldTime: { value: 0 },
};

/** The lit channel, iState.x: 0 unlit · 1 lit at the night's darkness (parts
 *  that carry only the flag: rovers, the cargo lander, dishes and wings) ·
 *  2 + k lit at the structure's own darkness k (buildings/darkness.ts). */
export function litChannel(powered: boolean, k: number): number {
  return powered ? 2 + Math.min(1, Math.max(0, k)) : 0;
}

/** The darkness a lit channel value lights at (as the shader reads it). */
export function channelDark(x: number, night: number): number {
  return x >= 1.5 ? Math.min(1, Math.max(0, x - 2)) : x >= 0.5 ? night : 0;
}

/** Emissive gains, all × lit: windows `window × max(k, windowDay)`, lamps
 *  `lamp × k`, beacons `beaconDay + beaconDark × k + beaconNight × night`
 *  while their flash is on (k = the structure's darkness). */
export const EMISSIVE = {
  window: 1.6, windowDay: 0.1, lamp: 2.6,
  beaconDay: 1.0, beaconDark: 3.0, beaconNight: 2.0,
};

/** How brightly a structure's own lights burn, 0 (off) … 1 (full): the one
 *  place the cel windows and flood pools key on. A complete, enabled,
 *  powered structure lights as dark as it stands (`dark`: the structure's
 *  darkness from darkness.ts — night, a set or grazing sun, terrain shadow). */
export function lightLevel(b: BuildingState, dark: number): number {
  const powered = (b.construction ?? 0) <= 0 && b.enabled && b.idleReason !== 'power';
  return powered ? dark : 0;
}

export type PaletteKey = 'hull' | 'radiator' | 'panel' | 'trim' | 'deck' | 'cell' | 'window' | 'lamp' | 'beacon' | 'foil'
  | 'leaf' | 'road' | 'roadMark';
type Palette = Record<PaletteKey, number>;

/** sRGB, as authored (the renderer does no tone mapping). `trim` is the extraction
 *  accent: the work kit's (world/workAnim.ts) and the default of a palette
 *  nobody tagged; a structure's own trim is its family's (celColors). */
export const CEL_PALETTE: Readonly<Palette> = {
  hull: 0xefeae0,
  radiator: 0xf3f2ed,
  panel: 0x828b99,
  trim: FAMILY_ACCENT.extraction,
  deck: 0x5d6675,
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

/** What a geometry may be tagged with (`userData.recipe` / `.part`): a
 *  structure, a moving part, a hub's digger, or a unit class. */
export type CelId = BuildingId | PartId | UnitKey | 'surveyDrone' | 'rover' | 'drone' | 'crew';

/** per structure (or moving part): what the family accent does not say */
export const PALETTE_OVERRIDES: Partial<Record<CelId, Partial<Palette>>> = {
  // the survey drone (docs/19 S6, world/rovers.ts surveyDroneGeometry): teal trim
  surveyDrone: { trim: UNIT_ACCENT.surveyDrone },
  // the moving parts' frames are bare metal, whoever they belong to
  wing: SILVER,
  wingXL: SILVER, // Wing Extensions: the same wing, a row longer
  dish: { trim: 0xb7bbc1 },
  // the destiny buildings (docs/14 §4.4): near-black slabs with teal glass, a dark hive
  serverMonolith: { hull: 0x23262b, cell: 0x23262b, window: 0x0f3a44 },
  droneHive: { hull: 0x3a3f46 },
};

/** The trim (and, for a hub's digger, the body) a tagged geometry wears:
 *  its family's accent, its unit class's, its livery's; the logistics slate
 *  when nothing says. */
export function accentOf(id: CelId | undefined): Partial<Palette> {
  if (!id) return { trim: FAMILY_ACCENT.logistics };
  if (id in FAMILY_OF) return { trim: FAMILY_ACCENT[FAMILY_OF[id as BuildingId]] };
  if (id in UNIT_ACCENT) return { trim: UNIT_ACCENT[id as keyof typeof UNIT_ACCENT] };
  if (id.includes(':')) {
    const l = liveryOf(id as UnitKey);
    return { trim: l.band, hull: l.body };
  }
  return { trim: FAMILY_ACCENT.logistics };
}

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

/** The cel colour attribute for a baked geometry (cached per source). */
export function celColors(src: THREE.BufferGeometry): THREE.BufferAttribute {
  let attr = colors.get(src);
  if (attr) return attr;
  const col = src.getAttribute('color');
  const mat = src.getAttribute('mat');
  const id = (src.userData.recipe ?? src.userData.part) as CelId | undefined;
  const pal: Palette = { ...CEL_PALETTE, ...accentOf(id), ...(id ? PALETTE_OVERRIDES[id] : undefined) };
  src.userData.celTrim = pal.trim;
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
export const CEL_WARM = new THREE.Color(1.0, 0.66, 0.29);
/** …and the machines' cold light (≈ #bfe9ff on screen): server cyan, the
 *  Automation's night (docs/14 §4.4). Each instance mixes the two by its iWarm. */
export const CEL_COLD = new THREE.Color(0.52, 0.815, 1.0);
const vec = (c: THREE.Color) => `vec3( ${c.r.toFixed(3)}, ${c.g.toFixed(3)}, ${c.b.toFixed(3)} )`;
const warm = vec(CEL_WARM);
const cold = vec(CEL_COLD);

const VERT = /* glsl */`
#define MBB_CEL
attribute vec3 mat;
#ifdef USE_INSTANCING
	attribute vec4 iState;
	attribute float iGlow;
	attribute float iWarm;
	attribute float iAlarm;
#endif
uniform float uBldNight;
uniform float uBldTime;
varying vec3 vAlb;
varying vec3 vN;
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
	vN = normalize( mat3( m ) * normal );
	float g = clamp( win * powered * glow, 0.0, 1.0 );
	vAlb = c * ( 1.0 - g * glass );
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
#define MBB_CEL
uniform vec3 uLightDir;
uniform vec3 uLightFull;
uniform vec3 uRamp;
uniform vec2 uRampEdge;
uniform float uRampSoft;
varying vec3 vAlb;
varying vec3 vN;
varying vec3 vEmit;
varying float vY;
varying float vCut;
void main() {
	if ( vY > vCut ) discard;
	// the ramp: n·l against the key, stepped (1.0 / 0.72 / 0.5; two steps for variant A)
	float ndl = dot( normalize( vN ), uLightDir );
	float s0 = smoothstep( uRampEdge.x - uRampSoft, uRampEdge.x + uRampSoft, ndl );
	float s1 = smoothstep( uRampEdge.y - uRampSoft, uRampEdge.y + uRampSoft, ndl );
	float q = mix( mix( uRamp.z, uRamp.y, s1 ), uRamp.x, s0 );
	// the print head: a warm band just under the cut while building
	float band = ( 1.0 - smoothstep( 0.0, 0.14, vCut - vY ) ) * step( vCut, 999.0 );
	gl_FragColor = vec4( vAlb * uLightFull * q + vEmit + ${warm} * ( band * 1.3 ), 1.0 );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`;

/** Marks the cel building program: a compile error in it is that shader's
 *  own fault (game.ts swaps in stock Lambert). */
export const CEL_MARKER = 'MBB_CEL';

export const CEL_BUILDING = new THREE.ShaderMaterial({
  name: 'cel-building',
  vertexShader: VERT,
  fragmentShader: FRAG,
  vertexColors: true,
  uniforms: {
    ...celLightUniforms,
    uBldNight: buildingUniforms.uBldNight,
    uBldTime: buildingUniforms.uBldTime,
  },
});
/** Stock Lambert in the cel palette: the fallback when the cel building
 *  shader does not compile on a GPU. */
export function celFallbackMaterial(): THREE.Material {
  return new THREE.MeshLambertMaterial({ vertexColors: true });
}

materials.define('building', CEL_BUILDING, celFallbackMaterial);

/** Install the cel palette and light level on every instanced view
 *  made from here on (call once at boot). */
export function installCelBuildings() {
  setInstanceHook((view, src, max) => {
    if (src.getAttribute('color')) view.setAttribute('color', celColors(src));
    view.setAttribute('iGlow', new THREE.InstancedBufferAttribute(new Float32Array(max).fill(-1), 1));
  });
}
