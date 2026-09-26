/** Work animations (docs/06 §7): what the machines do while they work, big
 *  enough to read at the isometric zooms (170–290 m), cheap enough for the
 *  old laptop Classic is made for.
 *
 *  | Unit | Working | Otherwise |
 *  |---|---|---|
 *  | Rover welding a site | the print arm unfolds off the nose and sweeps over the site; a spark flickers at the nozzle (a warm pool under it at night); a regolith plume rises | the arm folds back over the nose |
 *  | Rover sintering a road cell | it crawls along the cell toward the frontier, the arm pointed down; the cell glows orange as it sinters and cools to dull red behind | — |
 *  | Drone printing | a nozzle spark and a print beam down to the site (orange, to the road, on a road job) | — |
 *  | Excavator | digging (home or away): the wheel turns, the boom dips and rises, spoil clods fly; unloading: boom up, wheel back, a spill | still while it drives, the boom carried high |
 *
 *  Two meshes, whatever is on the map: the **kit** (one unit box on the
 *  building material: rover arms, excavator booms, stays and wheels, spoil
 *  clods) and the **glow** (one additive quad: sparks, beams, sinter
 *  patches, pools, plume puffs). Nothing is allocated per frame and nothing
 *  is random: every motion is a function of the game clock and each unit's
 *  id, so pause freezes it and 3× / 10× run it at game speed. Classic has
 *  no bloom: its sparks are a bright unlit colour and a scale pulse; High
 *  detail's are HDR (they bloom). Safe mode and ?lowfx keep the motion and
 *  the glow but drop the particles (clods, plume).
 *
 *  Hooks. rovers.ts and haulers.ts report each drawn unit (roverBody,
 *  droneAt, diggerAt) as they draw it, and ask a rover's work offset (the
 *  weld's shuffle, the sinter's crawl) back through roverOffset; life.ts
 *  brackets the frame with begin() and end(). How a unit works is
 *  `modeOf` (WorkModeFn): derived from the sim's state today; the sim's
 *  own word replaces it when it has one (docs/06 §7.1). */
import * as THREE from 'three';
import type { BuildingState, GameState, RoadCell, RoverUnit } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import type { RoverSpot } from '../core/spots';
import { cellCentre, frontierOf, isOpen } from '../core/roads';
import { ROAD } from '../data/roads';
import { BUILDINGS } from '../data/buildings';
import { CELL_M, GRAVITY, MAP_M } from '../data/balance';
import { BODY, PLATE, TRIM, box, merge, withInstanceState, type Finish } from '../buildings/meshKit';
import { CUT_NONE } from '../buildings/buildingShader';
import { DIGGER_BOOM, DIGGER_RIG, diggerWheel, type RigBox } from '../buildings/rigs';
import { recipeGeometry } from '../buildings/recipes';
import { upgradeKey } from '../buildings/upgrades';
import { CLASSIC_PALETTE } from '../buildings/classicBuilding';
import { SITE_GROUND } from '../terrain/classicGround';
import { classicActive } from '../core/style';
import { materials } from './materials';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ───────────────────────────── the hook: weld or sinter ─────────────────────────────

/** How a unit at work is working: printing a structure, or sintering a road cell. */
export type WorkMode = 'weld' | 'sinter';

/** The one place the animations learn how a unit works (null: it is not
 *  working — no site or road job, or its site waits on power, parts or its
 *  turn). The transit work (the sim's rovers really travelling) can set
 *  `WorkAnim.modeOf` to its own reading of the sim's state. */
export type WorkModeFn = (s: GameState, u: RoverUnit) => WorkMode | null;

/** Today's reading, from the sim's state as it stands: a site's crew
 *  sinters its spur first (`idleReason` 'road'), then welds ('building');
 *  a free unit on a road job sinters. */
export const workModeOf: WorkModeFn = (s, u) => {
  if (u.site !== null) {
    const b = byId(s, u.site);
    if (!b || (b.construction ?? 0) <= 0) return null;
    return b.idleReason === 'building' ? 'weld' : b.idleReason === 'road' ? 'sinter' : null;
  }
  if (u.road !== undefined) {
    for (const j of s.roadJobs ?? []) if (j.id === u.road) return 'sinter';
  }
  return null;
};

function byId(s: GameState, id: number): BuildingState | null {
  for (const b of s.buildings) if (b.id === id) return b;
  return null;
}

// ───────────────────────────── tuning ─────────────────────────────

const MAX_KIT = 4096;
const MAX_FX = 1024;
const MAX_ROVERS = 64;
const MAX_DRONES = 48;
const MAX_AWAY = 64;
/** the kit box sits at 0.1…1.1 in its own space (clear of the panel seams at 0) */
const KIT_O = 0.6;
const PI = Math.PI;
const UP = new THREE.Vector3(0, 1, 0);
const ZAXIS = new THREE.Vector3(0, 0, 1);
const ONE = new THREE.Vector3(1, 1, 1);

/** s (game) the print arm takes to unfold, or fold */
const UNFOLD_S = 1.2;
/** the sinter crawl: m/s toward the frontier, and how far */
const CRAWL_V = 0.4;
const CRAWL_MAX = 1.2;

// the rover's print arm, rover space (its geometry is scaled 1.25): the
// shoulder on the nose, and the folded pose rovers.ts once modelled
const RS = 1.25;
const SHOULDER = new THREE.Vector3(-0.25 * RS, 0.88 * RS, 0.35 * RS);
const L1 = Math.hypot(0.37, 0.35) * RS;
const REST = { yaw: 0, up: Math.atan2(0.37, 0.35), down: Math.atan2(-0.3, 0.35), l2: Math.hypot(0.3, 0.35) * RS };
const SINTER = { up: 0.42, down: -1.25, l2: 0.95 };
const ARM_T = [0.15, 0.12];
const HEAD = new THREE.Vector3(0.22, 0.28, 0.22);

// the excavator: rad/s the wheel turns digging (a bucket every ~0.6 s), and
// its dump on unload
const WHEEL_W = 1.3;
const DUMP_S = 3.2;
const BOOM_RATE = 0.3; // rad/s
/** the rig's top (the stay's head): shown on a site once the print passes it */
const RIG_TOP = DIGGER_RIG.stayTop.y;

/** deterministic 0..1 from a number (no Math.random anywhere here) */
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const smooth = (x: number) => x * x * (3 - 2 * x);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const approach = (x: number, to: number, step: number) => (x < to ? Math.min(to, x + step) : Math.max(to, x - step));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The glow's two profiles side by side: a radial glow — a hot core and a
 *  soft halo, purely added (sparks, pools, puffs) — and a soft slab, flat
 *  with feathered edges, that also covers what is under it (sinter patches,
 *  beams: they read orange on a sunlit road, not just paler). */
function glowTexture(): THREE.DataTexture {
  const N = 64;
  const data = new Uint8Array(2 * N * N * 4);
  const soft = (t: number) => { const u = clamp((1 - Math.abs(t)) / 0.45, 0, 1); return u * u * (3 - 2 * u); };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < 2 * N; x++) {
      const lx = (x % N) + 0.5 - N / 2, ly = y + 0.5 - N / 2;
      let v: number, cover = 0;
      if (x < N) {
        const r = Math.hypot(lx, ly) / (N / 2 - 1);
        v = Math.min(1, 0.72 * Math.exp(-((r / 0.24) ** 2)) + 0.4 * Math.max(0, 1 - r) ** 2);
      } else cover = 0.9 * (v = soft(lx / (N / 2 - 1)) * soft(ly / (N / 2 - 1)));
      const o = (y * 2 * N + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = Math.round(v * 255);
      data[o + 3] = Math.round(cover * 255);
    }
  }
  const t = new THREE.DataTexture(data, 2 * N, N, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** The glow's quad, flat on the ground (billboards stand it up), twice: the
 *  radial profile wound to face +y, the slab wound to face −y. An instance
 *  mirrored (a negative x scale) turns the one away and the other to the
 *  camera, so one draw call carries both profiles. */
function glowQuad(): THREE.BufferGeometry {
  const a = new THREE.PlaneGeometry(1, 1);
  a.rotateX(-PI / 2);
  const b = a.clone();
  const uvA = a.getAttribute('uv'), uvB = b.getAttribute('uv');
  for (let i = 0; i < uvA.count; i++) {
    uvA.setX(i, 0.004 + uvA.getX(i) * 0.492);
    uvB.setX(i, 0.504 + uvB.getX(i) * 0.492);
  }
  const idx = b.index!.array as Uint16Array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  const g = mergeGeometries([a, b])!;
  a.dispose(); b.dispose();
  return g;
}

// ───────────────────────────── per-unit state ─────────────────────────────

interface RoverAnim {
  id: number;
  /** the weld's unfold and the sinter's arm-down, 0..1 (eased when drawn) */
  weld: number;
  sinter: number;
  /** m crawled toward the frontier */
  crawl: number;
  mode: WorkMode | null;
  atWork: boolean;
  spark: boolean;
  /** the arm as drawn: yaw off the nose (rad), reach (m), the nozzle (world) */
  yaw: number;
  reach: number;
  tip: THREE.Vector3;
  /** the frontier cell it sinters, cached per road revision and job */
  front: RoadCell | null;
  frontRev: number;
  /** the job it was found for: a site id, or −1 − the road job's */
  frontJob: number;
  seen: number;
}

interface DroneAnim { id: number; mode: WorkMode | null; spark: boolean; front: RoadCell | null; frontRev: number; frontJob: number; seen: number }

interface DiggerAnim {
  id: number;
  /** wheel angle, rad (unwrapped), and the boom's dip (rad, + raises) */
  phi: number;
  theta: number;
  /** s into an unload (the dump) */
  dumpT: number;
  digging: boolean;
  dumping: boolean;
  driving: boolean;
  away: boolean;
  seen: number;
}

/** A drawn rover as rovers.ts reports it. */
export interface WorkRover { id: number; unit: RoverUnit | null; spot: RoverSpot | null; x: number; z: number; v: number }

interface RoverSlot { a: RoverAnim | null; B: THREE.Matrix4; r: WorkRover | null; there: boolean }
interface DroneSlot { id: number; unit: RoverUnit | null; working: boolean; p: THREE.Vector3 }

/** The offset rovers.ts draws a working rover at (reused). */
export interface WorkOffset { dx: number; dz: number; dyaw: number; bob: number }

export class WorkAnim {
  readonly group = new THREE.Group();
  readonly kit: THREE.InstancedMesh;
  readonly fx: THREE.InstancedMesh;
  /** how a unit works (the hook): see workModeOf */
  modeOf: WorkModeFn = workModeOf;
  /** ?lowfx: the particles drop (the motion and the glow stay) */
  lowFx = false;
  private readonly classic = classicActive();
  private clock = 0;
  private dt = 0;
  private frame = 0;
  private state: GameState | null = null;
  private rovers = new Map<number, RoverAnim>();
  private droneAnims = new Map<number, DroneAnim>();
  private diggers = new Map<number, DiggerAnim>();
  private rov: RoverSlot[] = [];
  private nRov = 0;
  private drn: DroneSlot[] = [];
  private nDrn = 0;
  private awayIds = new Int32Array(MAX_AWAY);
  private awayM: THREE.Matrix4[] = [];
  private awayV = new Float32Array(MAX_AWAY);
  private nAway = 0;
  private nKit = 0;
  private nFx = 0;
  private clods = 0;
  private offset: WorkOffset = { dx: 0, dz: 0, dyaw: 0, bob: 0 };
  /** kit tints per finish (relative to the kit's BODY), and the spoil's */
  private tint: Record<'body' | 'trim' | 'plate' | 'soil', THREE.Color>;
  private dark = new THREE.Color();
  private dim = new THREE.Color(0.55, 0.55, 0.6);
  // the rig's pieces as kit matrices (their frames': building or wheel space)
  private rigL = new WeakMap<RigBox, THREE.Matrix4>();
  private TP = new THREE.Matrix4().makeTranslation(DIGGER_RIG.pivot.x, DIGGER_RIG.pivot.y, DIGGER_RIG.pivot.z);
  private TnP = new THREE.Matrix4().makeTranslation(-DIGGER_RIG.pivot.x, -DIGGER_RIG.pivot.y, -DIGGER_RIG.pivot.z);
  private TH = new THREE.Matrix4().makeTranslation(DIGGER_RIG.hub.x, DIGGER_RIG.hub.y, DIGGER_RIG.hub.z);
  private digKey = '';
  private digTechs = -1;
  private digTop = 0;
  private wheel: readonly RigBox[] = diggerWheel('');
  // cells that opened lately (they cool), and the closed set they came from
  private closed = new Set<number>();
  private roadRev = -1;
  private roadsRef: unknown = null;
  private cool: { x: number; z: number; y: number; t0: number; on: boolean }[] = [];
  private coolAt = 0;
  private frontSeen: (RoadCell | null)[] = new Array(64).fill(null);
  private nFront = 0;
  // scratch
  private camQ = new THREE.Quaternion();
  private camP = new THREE.Vector3();
  private qUp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), PI / 2);
  private m0 = new THREE.Matrix4();
  private m1 = new THREE.Matrix4();
  private m2 = new THREE.Matrix4();
  private mB = new THREE.Matrix4();
  private mF = new THREE.Matrix4();
  private mW = new THREE.Matrix4();
  private q0 = new THREE.Quaternion();
  private q1 = new THREE.Quaternion();
  private e0 = new THREE.Euler(0, 0, 0, 'YXZ');
  private v0 = new THREE.Vector3();
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private S = new THREE.Vector3();
  private E = new THREE.Vector3();
  private N = new THREE.Vector3();
  private d1 = new THREE.Vector3();
  private d2 = new THREE.Vector3();
  private ko = new THREE.Vector3();
  private sp = new THREE.Vector3();
  private sc = new THREE.Vector3();

  constructor(private hf: Heightfield) {
    const g = merge([box(1, 1, 1, BODY, KIT_O, KIT_O, KIT_O)]);
    this.kit = new THREE.InstancedMesh(withInstanceState(g, MAX_KIT), materials.get('building'), MAX_KIT);
    this.kit.setColorAt(0, new THREE.Color(1, 1, 1)); // the colour attribute from the start
    this.kit.count = 0;
    this.kit.frustumCulled = false;
    this.kit.castShadow = false; // it moves: no shadow-map shadow (as the rovers)
    this.kit.receiveShadow = true;
    this.kit.visible = false;
    // light added (rgb) over what it covers (alpha): out = src + dst · (1 − a)
    const glow = new THREE.MeshBasicMaterial({
      map: glowTexture(), transparent: true, depthWrite: false, fog: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquation: THREE.AddEquation, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
    });
    // a slab covers as much as it glows: it fades out whole as it cools
    glow.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
	#ifdef USE_COLOR
		diffuseColor.a *= min( 1.0, 4.0 * max( vColor.r, max( vColor.g, vColor.b ) ) );
	#endif`);
    };
    glow.customProgramCacheKey = () => 'mbb-work-glow';
    this.fx = new THREE.InstancedMesh(glowQuad(), glow, MAX_FX);
    this.fx.setColorAt(0, new THREE.Color(0, 0, 0));
    this.fx.count = 0;
    this.fx.frustumCulled = false;
    this.fx.renderOrder = 5;
    this.fx.visible = false;
    this.group.add(this.kit, this.fx);
    for (let i = 0; i < MAX_ROVERS; i++) this.rov.push({ a: null, B: new THREE.Matrix4(), r: null, there: false });
    for (let i = 0; i < MAX_DRONES; i++) this.drn.push({ id: 0, unit: null, working: false, p: new THREE.Vector3() });
    for (let i = 0; i < MAX_AWAY; i++) this.awayM.push(new THREE.Matrix4());
    for (let i = 0; i < 24; i++) this.cool.push({ x: 0, z: 0, y: 0, t0: 0, on: false });
    this.tint = this.tints();
  }

  /** Kit tints: the colour each finish draws in this style, over the kit's BODY. */
  private tints() {
    const rel = (c: THREE.Color, base: THREE.Color) => new THREE.Color(c.r / base.r, c.g / base.g, c.b / base.b);
    if (this.classic) {
      const hull = new THREE.Color(CLASSIC_PALETTE.hull);
      const soil = (SITE_GROUND[this.hf.site.id] ?? SITE_GROUND.mare).clone().multiplyScalar(0.72);
      return {
        body: new THREE.Color(1, 1, 1), trim: rel(new THREE.Color(CLASSIC_PALETTE.trim), hull),
        plate: rel(new THREE.Color(CLASSIC_PALETTE.panel), hull), soil: rel(soil, hull),
      };
    }
    const k = (f: Finish) => new THREE.Color().setScalar(f.v / BODY.v);
    return { body: k(BODY), trim: k(TRIM), plate: k(PLATE), soil: new THREE.Color().setScalar(this.hf.site.terrain.albedo * 0.9 / BODY.v) };
  }

  private tintOf(f: Finish): THREE.Color { return f === TRIM ? this.tint.trim : f === PLATE ? this.tint.plate : this.tint.body; }

  /** spoil clods: chunky for Classic's zooms, finer in High detail's close views */
  private readonly clodScale = this.classic ? 1 : 0.65;

  /** The particles (spoil clods, the print plume) are drawn: not in safe mode or ?lowfx. */
  get particles(): boolean { return !this.lowFx && !materials.safeMode; }

  // ───────────────────────────── the frame ─────────────────────────────

  /** Before the units draw: `dt` game seconds (0 while paused). */
  begin(dt: number, s: GameState) {
    this.dt = Math.max(0, dt);
    this.clock += this.dt;
    this.state = s;
    this.nRov = 0;
    this.nDrn = 0;
    this.nAway = 0;
  }

  /** rovers.ts, per drawn rover before it composes it: the work offset it
   *  is drawn at (the weld's shuffle along its road, the sinter's crawl
   *  toward the frontier). `t`: its own clock (game s + its phase). */
  roverOffset(id: number, spot: RoverSpot | null, t: number): WorkOffset {
    const o = this.offset;
    o.dx = 0; o.dz = 0; o.dyaw = 0; o.bob = 0;
    const a = this.rovers.get(id);
    if (!a || !spot) return o;
    if (a.mode === 'weld' && a.atWork) {
      const sh = 0.25 * Math.sin(t * 0.9);
      o.dx = spot.shuffle[0] * sh; o.dz = spot.shuffle[1] * sh;
      o.bob = 0.02 * Math.sin(t * 9);
      o.dyaw = 0.05 * Math.sin(t * 1.7);
    } else if (a.crawl > 0) {
      o.dx = Math.sin(spot.face) * a.crawl; o.dz = Math.cos(spot.face) * a.crawl;
      if (a.atWork) o.bob = 0.012 * Math.sin(t * 23);
    }
    return o;
  }

  /** rovers.ts, per drawn rover: its body as drawn (`m`), and whether it
   *  stands on its slot. */
  roverBody(r: WorkRover, m: THREE.Matrix4, there: boolean) {
    if (this.nRov >= MAX_ROVERS) return;
    const sl = this.rov[this.nRov++];
    sl.r = r;
    sl.there = there;
    sl.B.copy(m);
  }

  /** DroneFlight.draw, per drone: where it is drawn and whether it works. */
  droneAt(id: number, unit: RoverUnit | null, working: boolean, x: number, y: number, z: number) {
    if (this.nDrn >= MAX_DRONES) return;
    const d = this.drn[this.nDrn++];
    d.id = id; d.unit = unit; d.working = working; d.p.set(x, y, z);
  }

  /** haulers.ts, per excavator it draws away from its pad: its body and speed. */
  diggerAt(id: number, m: THREE.Matrix4, v: number) {
    if (this.nAway >= MAX_AWAY) return;
    const i = this.nAway++;
    this.awayIds[i] = id;
    this.awayM[i].copy(m);
    this.awayV[i] = v;
  }

  /** Is this rover's spark on (it welds), and where its nozzle is. */
  welding(id: number): boolean { return !!this.rovers.get(id)?.spark; }
  nozzle(id: number): THREE.Vector3 | null { const a = this.rovers.get(id); return a?.spark ? a.tip : null; }

  /** After the units drew: the kit and the glow, from what they reported. */
  end(camera: THREE.Camera, sunLight: number) {
    const s = this.state;
    if (!s) return;
    const t0 = performance.now();
    this.frame++;
    camera.updateMatrixWorld();
    camera.getWorldQuaternion(this.camQ);
    camera.getWorldPosition(this.camP);
    this.nKit = 0;
    this.nFx = 0;
    this.nFront = 0;
    this.clods = 0;
    const night = 1 - Math.min(1, sunLight * 4);
    this.trackOpenings(s);
    for (let i = 0; i < this.nRov; i++) this.rover(s, this.rov[i], night, sunLight);
    for (let i = 0; i < this.nDrn; i++) this.drone(s, this.drn[i], night, sunLight);
    this.excavators(s);
    this.cooling();
    this.flush();
    if (this.frame % 120 === 0) this.prune();
    this.ms += (performance.now() - t0 - this.ms) * 0.05;
  }
  /** CPU ms end() takes, smoothed (probes) */
  private ms = 0;

  // ───────────────────────────── rovers ─────────────────────────────

  private rover(s: GameState, sl: RoverSlot, night: number, sun: number) {
    const r = sl.r!;
    let a = this.rovers.get(r.id);
    if (!a) {
      a = { id: r.id, weld: 0, sinter: 0, crawl: 0, mode: null, atWork: false, spark: false, yaw: 0, reach: 0,
        tip: new THREE.Vector3(), front: null, frontRev: -1, frontJob: 0, seen: 0 };
      this.rovers.set(r.id, a);
    }
    a.seen = this.frame;
    const u = r.unit, spot = r.spot, dt = this.dt;
    const mode = u && !((u.brickedUntil ?? 0) > 0) ? this.modeOf(s, u) : null;
    const stopped = sl.there && r.v < 0.1;
    const near = !!spot && Math.hypot(r.x - spot.x, r.z - spot.z) < 6;
    a.mode = mode;
    a.atWork = mode === 'weld' ? stopped : mode === 'sinter' ? near : false;
    a.weld = approach(a.weld, a.atWork && mode === 'weld' ? 1 : 0, dt / UNFOLD_S);
    a.sinter = approach(a.sinter, a.atWork && mode === 'sinter' ? 1 : 0, dt / UNFOLD_S);
    // the sinter crawl: creeps toward the frontier while it stands, eases back as it drives on
    a.crawl = mode === 'sinter' && stopped && a.atWork ? Math.min(CRAWL_MAX, a.crawl + CRAWL_V * dt) : Math.max(0, a.crawl - 1.5 * dt);
    const B = sl.B;
    const e = B.elements;
    const t = this.clock + r.id * 1.7;
    const w = smooth(a.weld), sn = smooth(a.sinter);
    // aim at the site: its centre in the rover's own frame
    let aim = 0;
    if (w > 0 && u?.site !== null && u?.site !== undefined) {
      const b = byId(s, u.site);
      if (b) {
        const c = this.centre(b);
        const dx = c[0] - e[12], dz = c[1] - e[14];
        aim = clamp(Math.atan2(dx * e[0] + dz * e[2], dx * e[8] + dz * e[10]), -2.5, 2.5);
      }
    }
    const yaw = w * (aim + 0.5 * Math.sin(t * 1.85));
    const up = REST.up + w * (1.0 - REST.up) + sn * (SINTER.up - REST.up);
    const down = REST.down + w * (-0.42 + 0.12 * Math.sin(t * 2.7) - REST.down) + sn * (SINTER.down - REST.down);
    const l2 = REST.l2 + w * (1.65 + 0.3 * Math.sin(t * 1.19 + 1) - REST.l2) + sn * (SINTER.l2 - REST.l2);
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    this.d1.set(sy * Math.cos(up), Math.sin(up), cy * Math.cos(up));
    this.d2.set(sy * Math.cos(down), Math.sin(down), cy * Math.cos(down));
    this.S.copy(SHOULDER);
    this.E.copy(this.d1).multiplyScalar(L1).add(this.S);
    this.N.copy(this.d2).multiplyScalar(l2).add(this.E);
    a.yaw = yaw;
    a.reach = Math.hypot(this.N.x - this.S.x, this.N.z - this.S.z);
    this.kitBar(B, this.S, this.E, ARM_T[0], this.tint.trim, 0);
    this.kitBar(B, this.E, this.N, ARM_T[1], this.tint.trim, 0);
    // the head, along the forearm
    this.v0.copy(this.d2).multiplyScalar(0.04).add(this.N);
    this.q0.setFromUnitVectors(UP, this.d2);
    this.kitAt(B, this.v0, this.q0, HEAD, this.tint.plate, 0);
    // the nozzle's tip, world
    a.tip.copy(this.d2).multiplyScalar(0.2).add(this.N).applyMatrix4(B);
    a.spark = false;
    const fl = this.flicker(t, r.id);
    if (mode === 'weld' && w > 0.92) {
      a.spark = true;
      this.spark(a.tip, fl, 1, night, sun, true);
    } else if (mode === 'sinter' && sn > 0.5) {
      // the sinter head: a hot spot on the ground under it, cooling behind
      const fx = e[8], fz = e[10], fl2 = Math.hypot(fx, fz) || 1;
      const ux = fx / fl2, uz = fz / fl2;
      const hy = Math.atan2(ux, uz);
      const k = 0.8 + 0.2 * fl.k;
      for (let j = 0; j < 6; j++) {
        const d = j * 0.95;
        const heat = Math.exp(-j * 0.45) * k * sn;
        const x = a.tip.x - ux * d, z = a.tip.z - uz * d;
        this.patch(x, z, hy, 1.5, 1.3, heat, 0.14 + j * 0.004);
      }
      this.bill(this.v0.copy(a.tip).addScaledVector(UP, 0.05), 0.5 * (0.8 + 0.4 * fl.s), 1.0, 0.7, 0.4, 0.8 * k * this.hot);
      if (night > 0) this.ground(a.tip.x, a.tip.z, hy, 5, 5, 1.0, 0.45, 0.15, 0.3 * night * this.warm);
      if (u) this.frontier(s, a, u);
    }
  }

  /** a rover's or drone's frontier cell glows as it sinters (once a frame per cell) */
  private frontier(s: GameState, a: RoverAnim | DroneAnim, u: RoverUnit) {
    const job = u.site !== null ? u.site : -1 - (u.road ?? 0);
    const rev = s.roadRev ?? 0;
    if (a.frontRev !== rev || a.frontJob !== job) {
      a.frontRev = rev;
      a.frontJob = job;
      let cells: readonly number[] | undefined;
      if (u.site !== null) cells = byId(s, u.site)?.spur;
      else for (const j of s.roadJobs ?? []) if (j.id === u.road) cells = j.cells;
      a.front = cells?.length ? frontierOf(s, cells)?.cell ?? null : null;
    }
    const c = a.front;
    if (!c || isOpen(c)) return;
    for (let i = 0; i < this.nFront; i++) if (this.frontSeen[i] === c) return;
    if (this.nFront < this.frontSeen.length) this.frontSeen[this.nFront++] = c;
    const done = clamp(1 - c.left / ROAD.cellS, 0, 1);
    if (done < 0.02) return;
    const x = (c.gx + 0.5) * CELL_M - MAP_M / 2, z = (c.gz + 0.5) * CELL_M - MAP_M / 2;
    const size = 3.6 * Math.max(0.4, done);
    const fl = this.flicker(this.clock, c.gx * 7 + c.gz);
    this.patch(x, z, 0, size, size, 0.75 + 0.25 * fl.k, 0.15);
  }

  // ───────────────────────────── drones ─────────────────────────────

  private drone(s: GameState, sl: DroneSlot, night: number, sun: number) {
    let a = this.droneAnims.get(sl.id);
    if (!a) {
      a = { id: sl.id, mode: null, spark: false, front: null, frontRev: -1, frontJob: 0, seen: 0 };
      this.droneAnims.set(sl.id, a);
    }
    a.seen = this.frame;
    const u = sl.unit;
    a.mode = sl.working && u && !((u.brickedUntil ?? 0) > 0) ? this.modeOf(s, u) : null;
    a.spark = false;
    if (!a.mode) return;
    const p = sl.p;
    const g = this.hf.sample(p.x, p.z);
    const t = this.clock + sl.id * 2.3;
    const fl = this.flicker(t, sl.id + 500);
    const noz = this.v1.set(p.x, p.y - 0.12, p.z);
    if (a.mode === 'weld') {
      a.spark = true;
      // the beam down to the print, a spark where it lands
      const bottom = Math.max(g + 0.3, p.y - 2.7);
      const k = 0.65 + 0.35 * fl.k;
      this.beam(p.x, bottom, noz.y, p.z, 0.34, 1.0, 0.78, 0.45, 0.5 * k * this.warm);
      this.bill(noz, 0.55 * (0.8 + 0.4 * fl.s), 1.0, 0.9, 0.7, 0.8 * k * this.hot);
      this.spark(this.v2.set(p.x, bottom, p.z), fl, 0.9, night, sun, false);
    } else {
      // a road job: an orange beam to the frontier, the cell glowing
      const k = 0.7 + 0.3 * fl.k;
      this.beam(p.x, g + 0.1, noz.y, p.z, 0.3, 1.0, 0.5, 0.15, 0.55 * k * this.warm);
      this.patch(p.x, p.z, 0, 1.8, 1.8, k, 0.15);
      if (u) this.frontier(s, a, u);
    }
  }

  // ───────────────────────────── excavators ─────────────────────────────

  private excavators(s: GameState) {
    if (s.techsDone.length !== this.digTechs) {
      this.digTechs = s.techsDone.length;
      this.digKey = upgradeKey('excavator', s.techsDone);
      this.wheel = diggerWheel(this.digKey);
      this.digTop = recipeGeometry('excavator', this.digKey).boundingBox?.max.y ?? 4;
    }
    const reveal = materials.patched('building') || materials.classicCustom('building');
    const dt = this.dt;
    for (const b of s.buildings) {
      if (b.type !== 'excavator') continue;
      const left = b.construction ?? 0;
      if (left > 0) {
        // a site: its rig stands once the print has passed it
        const total = b.buildTotal ?? 0;
        if (!reveal || total <= 0 || (1 - left / total) * this.digTop < RIG_TOP) continue;
      }
      let a = this.diggers.get(b.id);
      if (!a) {
        a = { id: b.id, phi: 0, theta: 0, dumpT: 0, digging: false, dumping: false, driving: false, away: false, seen: 0 };
        this.diggers.set(b.id, a);
      }
      a.seen = this.frame;
      let v = 0;
      let away = -1;
      for (let i = 0; i < this.nAway; i++) if (this.awayIds[i] === b.id) { away = i; break; }
      if (away >= 0) { this.mB.copy(this.awayM[away]); v = this.awayV[away]; }
      else {
        const c = this.centre(b);
        this.q0.setFromAxisAngle(UP, -b.rot * PI / 2);
        this.mB.compose(this.v0.set(c[0], this.hf.sample(c[0], c[1]), c[1]), this.q0, ONE);
      }
      a.away = away >= 0;
      const h = left > 0 ? undefined : b.haul;
      a.digging = !!h && b.active && h.phase === 'dig' && v < 0.2;
      a.dumping = !!h && h.phase === 'unload';
      a.driving = !!h && (h.phase === 'toDig' || h.phase === 'toDrop') && (v > 0.05 || h.path.length > 0);
      a.dumpT = a.dumping ? a.dumpT + dt : 0;
      const spill = a.dumping && a.dumpT > 0.6 && a.dumpT < 2.7;
      a.phi += (a.digging ? WHEEL_W : spill ? -2.4 : 0) * dt;
      const cyc = 0.5 - 0.5 * Math.cos((this.clock / 6.5) * 2 * PI + b.id);
      const want = a.digging ? -0.05 - 0.08 * cyc
        : a.dumping ? 0.3 * Math.sin(PI * clamp(a.dumpT / DUMP_S, 0, 1))
        : a.driving ? 0.09 : 0;
      a.theta = approach(a.theta, want, BOOM_RATE * dt);
      const dark = b.idleReason === 'power' || !b.enabled;
      this.rig(a, b, dark);
      if (this.particles && (a.digging || spill)) this.spoil(a, b.id, a.digging);
    }
  }

  /** the boom, stay and wheel of one excavator, on the body `mB` */
  private rig(a: DiggerAnim, b: BuildingState, dark: boolean) {
    const { pivot, stayTop, stayFoot, stayT } = DIGGER_RIG;
    const wear = b.wear ?? 0;
    // boom frame = B · T(pivot) · Rz(θ) · T(−pivot); wheel frame = boom · T(hub) · Rz(φ)
    this.m0.makeRotationZ(a.theta);
    this.mF.multiplyMatrices(this.mB, this.TP).multiply(this.m0).multiply(this.TnP);
    this.m0.makeRotationZ(a.phi % (2 * PI));
    this.mW.multiplyMatrices(this.mF, this.TH).multiply(this.m0);
    for (const p of DIGGER_BOOM) this.kitRig(this.mF, p, wear, dark);
    for (const p of this.wheel) this.kitRig(this.mW, p, wear, dark);
    // the stay: from the mast's head to the boom where it dips
    this.v1.subVectors(stayFoot, pivot).applyAxisAngle(ZAXIS, a.theta).add(pivot);
    this.kitBar(this.mB, stayTop, this.v1, stayT, dark ? this.dimmed(this.tint.trim) : this.tint.trim, wear);
  }

  /** Spoil clods off the wheel: flung up and ahead while it digs, spilt
   *  off its face as it dumps. Body space, then the body. */
  private spoil(a: DiggerAnim, id: number, dig: boolean) {
    const n = dig ? 10 : 8;
    const { pivot, hub } = DIGGER_RIG;
    // the hub where the boom has it
    this.v2.subVectors(hub, pivot).applyAxisAngle(ZAXIS, a.theta).add(pivot);
    for (let j = 0; j < n; j++) {
      const P = dig ? 1.5 + 0.8 * hash(j * 7.1 + id) : 1.1 + 0.4 * hash(j * 5.3 + id);
      const u = this.clock / P + hash(j * 3.3 + id * 1.9);
      const cyc = Math.floor(u);
      const tau = (u - cyc) * P;
      const seed = cyc * 1.7 + j * 13.3 + id * 0.37;
      const h1 = hash(seed), h2 = hash(seed + 1.1), h3 = hash(seed + 2.3), h4 = hash(seed + 3.7);
      const ang = dig ? 0.25 + 0.85 * h1 : -0.35 + 0.7 * h1;
      const r = 1.25;
      const vx = dig ? 0.6 + 1.3 * h2 : 0.3 + 0.5 * h2;
      const vy = dig ? 1.3 + 1.4 * h3 : 0.1 + 0.3 * h3;
      const vz = (h4 - 0.5) * (dig ? 1.6 : 0.8);
      const x = this.v2.x + Math.cos(ang) * r + vx * tau;
      const y = this.v2.y + Math.sin(ang) * r + vy * tau - 0.5 * GRAVITY * tau * tau;
      const z = this.v2.z + (h3 - 0.5) * 0.4 + vz * tau;
      if (y < -0.1) continue; // landed: it lies in the spoil until its next throw
      const sz = (0.22 + 0.2 * h3) * this.clodScale;
      this.e0.set(tau * (2 + 3 * h1), tau * (1 + 2 * h2), tau * 1.3);
      this.q0.setFromEuler(this.e0);
      this.v3.set(sz, sz * 0.8, sz * 0.9);
      this.kitAt(this.mB, this.v0.set(x, y, z), this.q0, this.v3, this.tint.soil, 0);
      this.clods++;
    }
  }

  // ───────────────────────────── cooling road cells ─────────────────────────────

  /** Cells that open as the rovers sinter them cool behind them: noted on
   *  each road revision (a bulk open — a load, a debug finish — is not). */
  private trackOpenings(s: GameState) {
    const rev = s.roadRev ?? 0;
    if (rev === this.roadRev && s.roads === this.roadsRef) return;
    const same = s.roads === this.roadsRef && this.roadRev >= 0;
    this.roadRev = rev;
    this.roadsRef = s.roads;
    let opened = 0;
    if (same) {
      for (const c of s.roads ?? []) {
        if (!isOpen(c) || !this.closed.has(c.gz * 4096 + c.gx)) continue;
        if (++opened > 6) break;
      }
    }
    const bulk = opened > 6;
    if (same && !bulk) {
      for (const c of s.roads ?? []) {
        if (!isOpen(c) || !this.closed.has(c.gz * 4096 + c.gx)) continue;
        const [x, z] = cellCentre(c.gx, c.gz);
        const k = this.cool[this.coolAt];
        this.coolAt = (this.coolAt + 1) % this.cool.length;
        k.x = x; k.z = z; k.y = this.hf.sample(x, z); k.t0 = this.clock; k.on = true;
      }
    }
    this.closed.clear();
    for (const c of s.roads ?? []) if (!isOpen(c)) this.closed.add(c.gz * 4096 + c.gx);
    if (!same) for (const k of this.cool) k.on = false;
  }

  private cooling() {
    for (const k of this.cool) {
      if (!k.on) continue;
      const age = this.clock - k.t0;
      if (age > 9 || age < 0) { k.on = false; continue; }
      const heat = Math.exp(-age / 2.2);
      this.patch(k.x, k.z, 0, 3.8, 3.8, heat, 0.13);
    }
  }

  // ───────────────────────────── writers ─────────────────────────────

  /** gains: sparks are HDR in High detail (they bloom), glows a little over */
  private get hot() { return this.classic ? 1 : 6; }
  private get warm() { return this.classic ? 1 : 1.8; }

  /** the arc's flicker: a level and a size pulse, with a stutter now and then */
  private flicker(t: number, id: number): { k: number; s: number } {
    const q = Math.floor(t * 17);
    const h1 = hash(q * 1.37 + id * 91.7), h2 = hash(q * 2.91 + id * 13.1);
    this.fl.k = h1 > 0.07 ? 0.7 + 0.3 * h2 : 0.15;
    this.fl.s = h2;
    return this.fl;
  }
  private fl = { k: 1, s: 0.5 };

  /** A weld spark at `p`: a hot core pulled toward the camera (clear of the
   *  nozzle), a halo, a warm pool on the ground at night, and the plume. */
  private spark(p: THREE.Vector3, fl: { k: number; s: number }, scale: number, night: number, sun: number, plume: boolean) {
    const k = fl.k;
    p = this.sp.copy(p);
    this.sc.subVectors(this.camP, p).normalize().multiplyScalar(0.35).add(p);
    // the arc: a hot core, a four-point glint that turns as it flickers, a halo
    this.bill(this.sc, 1.2 * scale * (0.7 + 0.6 * fl.s), 1.0, 0.9, 0.62, k * this.hot);
    const len = 3.0 * scale * (0.6 + 0.5 * k), rot = fl.s * PI;
    this.streak(this.sc, 0.2 * scale, len, rot, 1.0, 0.78, 0.4, 0.8 * k * this.hot);
    this.streak(this.sc, 0.2 * scale, len * 0.7, rot + PI / 2, 1.0, 0.78, 0.4, 0.8 * k * this.hot);
    this.bill(this.sc, 3.4 * scale, 1.0, 0.5, 0.15, 0.34 * k * this.warm);
    if (night > 0) this.ground(p.x, p.z, 0, 11 * scale, 11 * scale, 1.0, 0.6, 0.28, 0.65 * night * (0.8 + 0.2 * k) * this.warm);
    if (plume && this.particles) {
      const P = 1.8;
      const lit = 0.12 + 0.88 * sun;
      for (let j = 0; j < 3; j++) {
        const u = (this.clock / P + j / 3) % 1;
        const fade = Math.sin(PI * u) * 0.45 * lit;
        const dx = (hash(j * 3.1 + Math.floor(this.clock / P + j / 3)) - 0.5) * 0.8 * u;
        this.v0.set(p.x + dx, p.y - 0.15 + 1.7 * u, p.z - dx * 0.5);
        this.bill(this.v0, 0.5 + 1.6 * u, 0.42, 0.4, 0.37, fade * this.warm);
      }
    }
  }

  /** a sinter glow on the ground: `heat` 1 orange … 0 dull red, fading out */
  private patch(x: number, z: number, yaw: number, w: number, l: number, heat: number, lift: number) {
    const h = clamp(heat, 0, 1);
    const r = 0.45 + 0.55 * h, g = 0.05 + 0.37 * h * h, b = 0.015 + 0.065 * h * h * h;
    this.ground(x, z, yaw, -w, l, r, g, b, 0.85 * h ** 0.6 * this.warm, lift);
  }

  private fxPut(m: THREE.Matrix4, r: number, g: number, b: number, k: number) {
    const n = this.nFx;
    if (n >= MAX_FX || k <= 0.002) return;
    this.nFx++;
    this.fx.setMatrixAt(n, m);
    const c = this.fx.instanceColor!.array as Float32Array;
    c[n * 3] = r * k; c[n * 3 + 1] = g * k; c[n * 3 + 2] = b * k;
  }

  /** a camera-facing glow */
  private bill(p: THREE.Vector3, size: number, r: number, g: number, b: number, k: number) {
    this.q1.multiplyQuaternions(this.camQ, this.qUp);
    this.m1.compose(p, this.q1, this.v2.set(size, 1, size));
    this.fxPut(this.m1, r, g, b, k);
  }

  /** a camera-facing streak `w` × `l`, turned `rot` about the line of sight */
  private streak(p: THREE.Vector3, w: number, l: number, rot: number, r: number, g: number, b: number, k: number) {
    this.q0.setFromAxisAngle(ZAXIS, rot);
    this.q1.multiplyQuaternions(this.camQ, this.q0).multiply(this.qUp);
    this.m1.compose(p, this.q1, this.v2.set(w, 1, l));
    this.fxPut(this.m1, r, g, b, k);
  }

  /** a vertical slab of light from y0 to y1, turned to the camera about +y */
  private beam(x: number, y0: number, y1: number, z: number, w: number, r: number, g: number, b: number, k: number) {
    const h = Math.max(0.05, y1 - y0);
    this.q0.setFromAxisAngle(UP, Math.atan2(this.camP.x - x, this.camP.z - z));
    this.q1.multiplyQuaternions(this.q0, this.qUp);
    // mirrored: the slab profile, even along its length
    this.m1.compose(this.v2.set(x, (y0 + y1) / 2, z), this.q1, this.v3.set(-w, 1, h * 1.15));
    this.fxPut(this.m1, r, g, b, k);
  }

  /** a glow lying on the ground, tilted to it */
  private ground(x: number, z: number, yaw: number, w: number, l: number, r: number, g: number, b: number, k: number, lift = 0.16) {
    const hf = this.hf;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const hl = l * 0.4, hw = Math.abs(w) * 0.4; // w < 0: the slab profile
    const front = hf.sample(x + fx * hl, z + fz * hl), back = hf.sample(x - fx * hl, z - fz * hl);
    const left = hf.sample(x + fz * hw, z - fx * hw), right = hf.sample(x - fz * hw, z + fx * hw);
    this.e0.set(-Math.atan2(front - back, 2 * hl), yaw, Math.atan2(left - right, 2 * hw));
    this.q0.setFromEuler(this.e0);
    this.m1.compose(this.v2.set(x, (front + back + left + right) / 4 + lift, z), this.q0, this.v3.set(w, 1, l));
    this.fxPut(this.m1, r, g, b, k);
  }

  /** a kit box: `c`, `q`, `s` in the frame `F` */
  private kitAt(F: THREE.Matrix4, c: THREE.Vector3, q: THREE.Quaternion, s: THREE.Vector3, tint: THREE.Color, wear: number) {
    // the kit box spans 0.1…1.1: centre it first
    this.ko.copy(s).multiplyScalar(-KIT_O).applyQuaternion(q).add(c);
    this.m2.compose(this.ko, q, s);
    this.kitPut(this.m1.multiplyMatrices(F, this.m2), tint, wear);
  }

  /** a kit member from a to b (frame F), as meshKit's bar */
  private kitBar(F: THREE.Matrix4, a: THREE.Vector3, b: THREE.Vector3, t: number, tint: THREE.Color, wear: number) {
    const d = this.v2.subVectors(b, a);
    const len = d.length();
    if (len < 1e-4) return;
    this.q1.setFromUnitVectors(UP, d.divideScalar(len));
    this.kitAt(F, this.v0.addVectors(a, b).multiplyScalar(0.5), this.q1, this.v2.set(t, len, t), tint, wear);
  }

  /** a rig piece (its kit matrix cached) in frame F */
  private kitRig(F: THREE.Matrix4, p: RigBox, wear: number, dark: boolean) {
    let L = this.rigL.get(p);
    if (!L) {
      const o = p.s.clone().multiplyScalar(-KIT_O).applyQuaternion(p.q).add(p.c);
      L = new THREE.Matrix4().compose(o, p.q, p.s);
      this.rigL.set(p, L);
    }
    const tint = this.tintOf(p.f);
    this.kitPut(this.m1.multiplyMatrices(F, L), dark ? this.dimmed(tint) : tint, wear);
  }

  private dimmed(c: THREE.Color): THREE.Color { return this.dark.copy(c).multiply(this.dim); }

  private kitPut(m: THREE.Matrix4, tint: THREE.Color, wear: number) {
    const n = this.nKit;
    if (n >= MAX_KIT) return;
    this.nKit++;
    this.kit.setMatrixAt(n, m);
    const c = this.kit.instanceColor!.array as Float32Array;
    c[n * 3] = tint.r; c[n * 3 + 1] = tint.g; c[n * 3 + 2] = tint.b;
    const st = (this.kit.geometry.getAttribute('iState') as THREE.InstancedBufferAttribute).array as Float32Array;
    st[n * 4] = 1; st[n * 4 + 1] = 0; st[n * 4 + 2] = wear; st[n * 4 + 3] = CUT_NONE;
  }

  /** this frame's instances up to the GPU (only the part in use) */
  private up(attr: THREE.BufferAttribute, n: number, size: number) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, n * size);
    attr.needsUpdate = true;
  }

  private flush() {
    const k = this.nKit, f = this.nFx;
    this.kit.count = k;
    this.kit.visible = k > 0;
    if (k > 0) {
      this.up(this.kit.instanceMatrix, k, 16);
      this.up(this.kit.instanceColor!, k, 3);
      this.up(this.kit.geometry.getAttribute('iState') as THREE.InstancedBufferAttribute, k, 4);
    }
    this.fx.count = f;
    this.fx.visible = f > 0;
    if (f > 0) {
      this.up(this.fx.instanceMatrix, f, 16);
      this.up(this.fx.instanceColor!, f, 3);
    }
  }

  /** a structure's footprint centre, world (no allocation) */
  private cc: [number, number] = [0, 0];
  private centre(b: BuildingState): [number, number] {
    const fp = BUILDINGS[b.type].footprint;
    const w = b.rot % 2 === 0 ? fp[0] : fp[1], d = b.rot % 2 === 0 ? fp[1] : fp[0];
    this.cc[0] = (b.gx + w / 2) * CELL_M - MAP_M / 2;
    this.cc[1] = (b.gz + d / 2) * CELL_M - MAP_M / 2;
    return this.cc;
  }

  /** forget units gone a while (every couple of seconds) */
  private prune() {
    const old = this.frame - 120;
    for (const [id, a] of this.rovers) if (a.seen < old) this.rovers.delete(id);
    for (const [id, a] of this.droneAnims) if (a.seen < old) this.droneAnims.delete(id);
    for (const [id, a] of this.diggers) if (a.seen < old) this.diggers.delete(id);
  }

  // ───────────────────────────── probes ─────────────────────────────

  /** Each unit's work pose as drawn (tests, probes; docs/06 §7). */
  info() {
    const r2 = (v: number) => Math.round(v * 1000) / 1000;
    const drawn = (m: Map<number, { seen: number }>) => [...m.values()].filter((a) => a.seen === this.frame);
    return {
      clock: r2(this.clock),
      rovers: (drawn(this.rovers) as RoverAnim[]).map((a) => ({
        id: a.id, mode: a.mode, atWork: a.atWork, spark: a.spark, crawl: r2(a.crawl),
        arm: { unfold: r2(smooth(a.weld)), down: r2(smooth(a.sinter)), yaw: r2(a.yaw), reach: r2(a.reach),
          tip: [r2(a.tip.x), r2(a.tip.y), r2(a.tip.z)] },
      })),
      drones: (drawn(this.droneAnims) as DroneAnim[]).map((a) => ({ id: a.id, mode: a.mode, spark: a.spark })),
      diggers: (drawn(this.diggers) as DiggerAnim[]).map((a) => ({
        id: a.id, wheel: r2(a.phi), boom: r2(a.theta), digging: a.digging, dumping: a.dumping, driving: a.driving, away: a.away,
      })),
      kit: this.nKit, fx: this.nFx, clods: this.clods, cooling: this.cool.filter((k) => k.on).length, ms: r2(this.ms),
      particles: this.particles, visible: this.group.visible,
    };
  }
}

/** a wrap-safe angle difference (the arm's aim, probes) */
export const angleDiff = (a: number, b: number) => wrap(a - b);
