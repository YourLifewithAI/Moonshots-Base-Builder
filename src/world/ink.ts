/** Ink: the outlines of the cel style (docs/19, S1b), and the lines drawn on
 *  the ground (pit benches and rims, grading sites, roads). S1b owns this file.
 *
 *  Outlines are an inverted hull, no screen-space pass (no render target, MSAA
 *  kept). Every instanced class gets a twin, an InstancedMesh that draws the
 *  same geometry (a getter, so an upgrade's new geometry is followed at once),
 *  the same `instanceMatrix` and `count`, with the back faces pushed out along
 *  a smoothed normal and painted flat ink. The twin is a child of its source
 *  (`inked(mesh)`), so it hides, moves and is removed with it. One shared
 *  material; nothing is created per frame.
 *
 *    width     constant on screen: the camera is a perspective, so the push
 *              is `px · depth · 2·tan(fov/2) / viewportH` metres (about 0.10 m
 *              at the 170 m home distance for 1.5 px, 0.49 m at 830 m)
 *    normals   the kit bakes split face normals (every box corner has three),
 *              so pushing along `normal` would open gaps: `oDir` (made once per
 *              recipe, by position hash) is the mitre of the faces meeting at
 *              a vertex, long enough that each of them moves by exactly one
 *              width (capped at two), with the width scale in `w`: parts under
 *              0.4 m² take half
 *    print     the vertex shader keeps the source's print cut: fragments above
 *              iState.w are discarded, so a half-printed building grows no
 *              full-height outline
 *    colour    the day ink, lerped to the night ink with the building night
 *              level; variant C tints it by each vertex's own colour instead
 *    fault     `MBB_INK` marks the program: game.ts hides the outlines when it
 *              fails to compile (never the game), and in safe mode
 *
 *  `drapedLine` is the other half: real 1 px lines on the ground. */
import * as THREE from 'three';
import { INK, ink, type CelVariant, type InkPreset } from './celStyle';
import { CUT_NONE, buildingUniforms } from '../buildings/celBuilding';
import { addInstanceHook } from '../buildings/meshKit';

/** What a ground line marks; each has its own colour (and, later, dash). */
export type InkKind = 'bench' | 'rim' | 'grade' | 'road';

/** the cut's own dark, for bench lines drawn on ochre */
const BENCH_INK = 0x3a2c1a;

/** Marks the outline program: a compile error in it is the ink's own fault
 *  (game.ts recoverFromShaderFault hides the outlines). */
export const INK_MARKER = 'MBB_INK';

/** A part's ink fades in between these sizes on screen (px; the part's size is
 *  the side of a square of its largest face's area): a rail or a window frame
 *  is a line, not an outlined object, and the small parts of a far building
 *  would otherwise turn it into a black blot. Full width from the second. */
export const FADE_PX: readonly [number, number] = [2, 10];
/** the size, m, of a part with no size on record: full ink at any distance */
const NO_SIZE = 99;
/** a vertex's push is never more than this many widths (a sharp mitre) */
const MITRE_MAX = 2;

// ─────────────────────────── the mitre directions ───────────────────────────

const dirs = new WeakMap<THREE.BufferAttribute | THREE.InterleavedBufferAttribute, THREE.BufferAttribute>();

/** Every instanced view carries its `oDir` from the moment it is made, so the
 *  source's first draw already has it in its attribute state (an attribute
 *  added after a geometry has been drawn is never bound). */
addInstanceHook((view, src) => { view.setAttribute('oDir', outlineDirs(src)); });

/** Per vertex, `oDir` = (mitre direction · length, part size, m): the faces that
 *  meet at a position (its distinct normals, by position and part size) are
 *  summed; the push is that mean direction, long enough for the flattest of
 *  them to move by one width. A smooth surface is a plain normal; a box corner
 *  is √3 long along its diagonal; opposite faces at one point fall back to the
 *  vertex's own normal. `partArea` (the kit's per-vertex part size) is the size
 *  the ink fades by. Cached per position buffer, which the recipe, its views
 *  and every upgrade of it share. */
export function outlineDirs(geo: THREE.BufferGeometry): THREE.BufferAttribute {
  const pos = geo.getAttribute('position');
  let attr = dirs.get(pos);
  if (attr) return attr;
  const nor = geo.getAttribute('normal');
  const area = geo.userData.partArea as Float32Array | undefined;
  const n = pos.count;
  const Q = 500; // positions to 2 mm
  const key = (i: number) =>
    `${Math.round(pos.getX(i) * Q)},${Math.round(pos.getY(i) * Q)},${Math.round(pos.getZ(i) * Q)},${Math.round((area?.[i] ?? 0) * 100)}`;
  // the distinct normals at each position (the same direction is one face)
  const at = new Map<string, number[]>();
  const keys: string[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const k = key(i);
    keys[i] = k;
    let list = at.get(k);
    if (!list) { list = []; at.set(k, list); }
    const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
    let seen = false;
    for (let j = 0; j < list.length; j += 3) {
      if (list[j] * nx + list[j + 1] * ny + list[j + 2] * nz > 0.98) { seen = true; break; }
    }
    if (!seen) list.push(nx, ny, nz);
  }
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const list = at.get(keys[i])!;
    let sx = 0, sy = 0, sz = 0;
    for (let j = 0; j < list.length; j += 3) { sx += list[j]; sy += list[j + 1]; sz += list[j + 2]; }
    let len = Math.hypot(sx, sy, sz);
    let dx: number, dy: number, dz: number, scale = 1;
    if (list.length <= 3 || len < 0.35) {
      // one face, or faces that cancel: the vertex's own normal
      dx = nor.getX(i); dy = nor.getY(i); dz = nor.getZ(i);
    } else {
      dx = sx / len; dy = sy / len; dz = sz / len;
      let flat = 1;
      for (let j = 0; j < list.length; j += 3) flat = Math.min(flat, list[j] * dx + list[j + 1] * dy + list[j + 2] * dz);
      scale = Math.min(MITRE_MAX, 1 / Math.max(flat, 1 / MITRE_MAX));
    }
    len = Math.hypot(dx, dy, dz) || 1;
    out[i * 4] = (dx / len) * scale;
    out[i * 4 + 1] = (dy / len) * scale;
    out[i * 4 + 2] = (dz / len) * scale;
    out[i * 4 + 3] = area ? Math.sqrt(area[i]) : NO_SIZE;
  }
  attr = new THREE.BufferAttribute(out, 4);
  dirs.set(pos, attr);
  return attr;
}

// ─────────────────────────── the program ───────────────────────────

const VERT = /* glsl */`
#define ${INK_MARKER}
attribute vec4 oDir;
#ifdef USE_INSTANCING
	attribute vec4 iState;
#endif
uniform float uInkPx;
uniform float uInkK;
uniform float uBldNight;
uniform vec3 uInkDay;
uniform vec3 uInkNight;
uniform float uTint;
uniform float uTintKeep;
uniform vec2 uInkFade;
varying vec3 vInk;
varying float vY;
varying float vCut;
void main() {
	mat4 m = modelMatrix;
	float cut = ${CUT_NONE.toFixed(1)};
	#ifdef USE_INSTANCING
		m = modelMatrix * instanceMatrix;
		cut = iState.w;
	#endif
	vec4 wp = m * vec4( position, 1.0 );
	// the instance's rotation alone (the work kit's pieces are scaled): the push is in metres
	mat3 R = mat3(
		m[ 0 ].xyz / max( length( m[ 0 ].xyz ), 1e-5 ),
		m[ 1 ].xyz / max( length( m[ 1 ].xyz ), 1e-5 ),
		m[ 2 ].xyz / max( length( m[ 2 ].xyz ), 1e-5 ) );
	float depth = max( - ( viewMatrix * wp ).z, 0.5 );
	// the metre a pixel is here; a part's ink fades out as the part shrinks toward a few pixels
	float perPx = uInkK * depth;
	float size = oDir.w * ( length( m[ 0 ].xyz ) + length( m[ 1 ].xyz ) + length( m[ 2 ].xyz ) ) / 3.0;
	wp.xyz += R * oDir.xyz * ( uInkPx * perPx * smoothstep( uInkFade.x, uInkFade.y, size / perPx ) );
	vec3 flatInk = mix( uInkDay, uInkNight, uBldNight );
	vec3 c = flatInk;
	#ifdef USE_COLOR
		c = mix( flatInk, color * uTintKeep * mix( 1.0, 0.3, uBldNight ), uTint );
	#endif
	vInk = c;
	vY = position.y;
	vCut = cut;
	gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */`
varying vec3 vInk;
varying float vY;
varying float vCut;
void main() {
	if ( vY > vCut ) discard;
	gl_FragColor = vec4( vInk, 1.0 );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`;

/** what the live outlines are doing (getRenderInfo().outlines, tests) */
const state = {
  /** the game asked for them off (safe mode) */
  off: false,
  /** the program failed to compile: off for the session */
  faulted: false,
  /** the width scale of the last frame, m of push per metre of depth per px */
  k: 0,
  variant: null as CelVariant | null,
};

const live = new Set<THREE.InstancedMesh>();
let material: THREE.ShaderMaterial | null = null;

const preset = (): InkPreset => (state.variant ? INK[state.variant] : ink());

/** The one material every outline draws with. */
function inkMaterial(): THREE.ShaderMaterial {
  if (material) return material;
  const m = new THREE.ShaderMaterial({
    name: 'cel-ink',
    vertexShader: VERT,
    fragmentShader: FRAG,
    vertexColors: true,
    side: THREE.BackSide,
    uniforms: {
      uInkPx: { value: 1.5 },
      uInkK: { value: 0.0007 },
      uBldNight: buildingUniforms.uBldNight,
      uInkDay: { value: new THREE.Color(0x141618) },
      uInkNight: { value: new THREE.Color(0x06080b) },
      uTint: { value: 0 },
      uTintKeep: { value: 0.4 },
      uInkFade: { value: new THREE.Vector2(FADE_PX[0], FADE_PX[1]) },
    },
  });
  const size = new THREE.Vector2();
  // the width follows the viewport and the lens as they are when it draws
  m.onBeforeRender = (renderer, _scene, camera) => {
    const p = preset();
    const u = m.uniforms;
    renderer.getSize(size);
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 20;
    state.k = (2 * Math.tan((fov * Math.PI) / 360)) / Math.max(1, size.y);
    u.uInkK.value = state.k;
    u.uInkPx.value = p.px;
    u.uInkDay.value.set(p.day);
    u.uInkNight.value.set(p.night);
    u.uTint.value = p.tinted ? 1 : 0;
    u.uTintKeep.value = 1 - p.tintDark;
  };
  m.visible = !state.off && !state.faulted;
  material = m;
  return m;
}

/** An outline twin of an instanced mesh (see the file's header): a mesh to
 *  add as a child of `source` — `inked(source)` does. */
class InkMesh extends THREE.InstancedMesh {
  constructor(source: THREE.InstancedMesh) {
    super(source.geometry, inkMaterial(), 1);
    // the source's own buffers and count, read live: nothing to keep in step
    Object.defineProperty(this, 'geometry', { get: () => source.geometry, set: () => { /* follows the source */ } });
    Object.defineProperty(this, 'instanceMatrix', { get: () => source.instanceMatrix, set: () => { /* shared */ } });
    Object.defineProperty(this, 'count', { get: () => source.count, set: () => { /* mirrored */ } });
    this.frustumCulled = false;
    this.name = 'ink';
    this.userData.source = source;
  }

  /** never a pick target */
  raycast(): void { /* the outline is not in the world */ }
}

/** The outline of a mesh (its instances included): a group to add beside it
 *  (as its child, so it follows the source's visibility and transform). An
 *  instanced source gets an inverted-hull twin; anything else gets an empty
 *  group. */
export function outlineMesh(source: THREE.Mesh): THREE.Group {
  const g = new THREE.Group();
  g.name = 'ink';
  g.userData.source = source;
  if ((source as THREE.InstancedMesh).isInstancedMesh) {
    const twin = new InkMesh(source as THREE.InstancedMesh);
    g.add(twin);
    live.add(twin);
    source.addEventListener('removed', () => live.delete(twin));
    source.addEventListener('added', () => live.add(twin));
  }
  return g;
}

/** Give an instanced mesh its outline (a child) and hand the mesh back:
 *  `group.add(inked(mesh))`. */
export function inked<T extends THREE.Mesh>(mesh: T, label = ''): T {
  if (label) mesh.userData.ink = label;
  mesh.add(outlineMesh(mesh));
  return mesh;
}

/** Outlines on or off: safe mode (plain materials, no custom programs) hides
 *  them, a compile fault hides them for the session. */
export function setInkEnabled(on: boolean) {
  state.off = !on;
  if (material) material.visible = !state.off && !state.faulted;
}

/** The outline program failed to compile: no outlines from here on. */
export function inkFaulted() {
  state.faulted = true;
  if (material) material.visible = false;
}

/** Are outlines drawing (not off, not faulted)? */
export const inkOn = (): boolean => !state.off && !state.faulted;

/** Debug (tests, screenshots): the look bake-off's variant, over the constant. */
export function setInkVariant(v: CelVariant | null) { state.variant = v; }

/** Debug (tests): make the outline program fail to compile, as a bad GPU would. */
export function breakInk() {
  const m = inkMaterial();
  m.fragmentShader = `${FRAG}\nthis is not glsl`;
  m.needsUpdate = true;
}

/** Every live outline mesh (tests, probes). */
export const outlineMeshes = (): readonly THREE.InstancedMesh[] => [...live];

/** Each live outline as a plain summary (tests, probes): what it draws, its
 *  count against its source's, whether it shares the source's geometry and
 *  matrices, and the first vertex directions. */
export function outlineList() {
  return [...live].map((m) => {
    const src = m.userData.source as THREE.InstancedMesh;
    const d = m.geometry.getAttribute('oDir');
    return {
      of: (src.userData.ink ?? src.userData.buildingType ?? src.userData.part ?? src.userData.links ?? '') as string,
      count: m.count, sourceCount: src.count,
      sameGeometry: m.geometry === src.geometry, sameMatrices: m.instanceMatrix === src.instanceMatrix,
      vertices: m.geometry.getAttribute('position').count,
      dirs: d ? Array.from(d.array.slice(0, 16)).map((v) => +v.toFixed(2)) : null,
      visible: src.visible, material: (m.material as THREE.Material).type,
    };
  });
}

/** What the outlines are doing now (getRenderInfo().outlines, tests). */
export function inkInfo() {
  let drawn = 0, instances = 0;
  for (const m of live) {
    const src = m.userData.source as THREE.InstancedMesh;
    let vis = src.count > 0;
    for (let o: THREE.Object3D | null = src; o && vis; o = o.parent) vis = o.visible;
    if (vis) { drawn++; instances += src.count; }
  }
  return {
    on: inkOn(), faulted: state.faulted, meshes: live.size, drawn: inkOn() ? drawn : 0,
    instances: inkOn() ? instances : 0,
    variant: state.variant ?? null, px: preset().px, tinted: preset().tinted,
    /** metres of push per metre of depth per pixel, as the last frame drew it */
    k: state.k,
  };
}

// ─────────────────────────── lines on the ground ───────────────────────────

/** Points on the ground: each (x, z) with the height the terrain has there, a little proud of it. */
export function drape(
  ground: { sample(x: number, z: number): number }, points: readonly (readonly [number, number])[], lift = 0.12,
): THREE.Vector3[] {
  return points.map(([x, z]) => new THREE.Vector3(x, ground.sample(x, z) + lift, z));
}

/** A line along already-draped points (`drape` makes them), 1 px wide (the
 *  GPU's line), coloured by what it marks: the day ink for outlines, the
 *  cut's own dark for benches. Depth-tested, never written. */
export function drapedLine(points: readonly THREE.Vector3[], kind: InkKind): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints(points as THREE.Vector3[]);
  const mat = new THREE.LineBasicMaterial({
    color: kind === 'bench' ? BENCH_INK : ink().day, depthWrite: false,
  });
  const line = new THREE.Line(geo, mat);
  line.name = `ink:${kind}`;
  line.userData.kind = kind;
  line.frustumCulled = false;
  return line;
}
