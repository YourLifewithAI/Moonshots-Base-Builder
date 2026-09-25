/** One InstancedMesh per building type = one draw call per type.
 *  Rebuilt from GameState whenever buildings change (placement is rare;
 *  a full rebuild of a type's matrices is trivially cheap), and on every
 *  economy tick, which also refills the floods and the per-instance state
 *  the building shader reads (lit, dust, wear, print cut height).
 *
 *  The base's own light follows each structure's darkness (darkness.ts):
 *  per frame, while any k moves, it is written into the lit channel, the
 *  flood slots and the stock discs — nothing is re-sorted or re-clustered.
 *
 *  Two looks, chosen by whether the building patch is live:
 *    patched (FX 0–2)      3D-print reveal, window glow, shader floods
 *    stock (FX 3 / fault / safe)
 *                          squash-rise + dim, whole-hull glow (night only),
 *                          additive discs + 8 PointLights
 *    classic               the classic shader's print reveal and window
 *                          glow at each structure's light level
 *                          (classicBuilding.ts lightLevel, keyed on its
 *                          darkness), draped flood pools at the same level
 *                          (classicFloods.ts), a contact decal under every
 *                          footprint (no shadow map) */
import * as THREE from 'three';
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { CELL_M, MAP_M } from '../data/balance';
import type { BuildingState, GameState } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import { MOUNTS, recipeGeometry } from './recipes';
import { BUILDING_MATERIAL, withInstanceState } from './meshKit';
import { CUT_NONE, EMISSIVE, buildingUniforms, channelDark, litChannel } from './buildingShader';
import { DARK_LIVE, type BuildingDarkness } from './darkness';
import { Trackers, type Placed } from './trackers';
import { scaffoldGeometry, type ScaffoldSite } from './scaffold';
import { materials } from '../world/materials';
import {
  floodSlotOf, floodSlots, floodStats, refreshFloods, setFloodNight, setFloodSlots, setFloodSources,
  type FloodSource,
} from '../world/floodlights';
import { classicActive } from '../core/style';
import { lightLevel } from './classicBuilding';
import { ContactDecals } from './contactDecals';
import { ClassicFloods } from './classicFloods';
import type { WorkSpot } from '../world/lighting';

const MAX_PER_TYPE = 96;

export function footprintRect(b: { type: BuildingId; gx: number; gz: number; rot: number }) {
  const def = BUILDINGS[b.type];
  const [w, d] = b.rot % 2 === 0 ? def.footprint : [def.footprint[1], def.footprint[0]];
  return { gx0: b.gx, gz0: b.gz, gx1: b.gx + w, gz1: b.gz + d, w, d };
}

export function centerOf(b: { type: BuildingId; gx: number; gz: number; rot: number }): [number, number] {
  const r = footprintRect(b);
  return [
    (r.gx0 + r.w / 2) * CELL_M - MAP_M / 2,
    (r.gz0 + r.d / 2) * CELL_M - MAP_M / 2,
  ];
}

const MAX_DISCS = 256;

/** A type's instances as the lit channel sees them (the rebuild's order). */
interface Row { st: THREE.InstancedBufferAttribute; ids: number[] }

export class BuildingInstances {
  readonly group = new THREE.Group();
  private meshes = new Map<BuildingId, THREE.InstancedMesh>();
  /** instance order per type, mirroring rebuild() — used for picking */
  private ids = new Map<BuildingId, number[]>();
  /** stock-path pools: one soft additive disc under each lit building,
   *  its instance color the building's darkness */
  private discs: THREE.InstancedMesh;
  private discMaterial: THREE.MeshBasicMaterial;
  private rows: Row[] = [];
  /** lit structures at the last rebuild: flood i and disc i stand for litIds[i] */
  private litIds: number[] = [];
  private litAt: { x: number; y: number; z: number }[] = [];
  private floods: FloodSource[] = [];
  /** the darkness revision last written out (−1: write on the next frame) */
  private darkSeen = -1;
  private darkest = 0;
  private tint = new THREE.Color();
  private trackers: Trackers;
  private scaffold: THREE.LineSegments;
  private scaffoldSig = '';
  /** placement + construction-rise of every instance at the last rebuild */
  private casterSig = '';
  private last: GameState | null = null;
  private revisionSeen = -1;
  /** fired when a rebuild moved, added or removed a shadow caster */
  onShadowCastersChanged?: () => void;
  /** dust shown on a solar array's glass (visual only; default b.dust) */
  panelDust?: (b: BuildingState) => number;
  /** classic style: per-instance light levels, contact decals */
  private readonly classic = classicActive();
  private decals: ContactDecals | null = null;
  private pools: ClassicFloods | null = null;
  private night = 0;
  private glowNight = -1;
  private glowSeen = -1;
  /** instance order per type as structures (the classic glow refresh) */
  private lists = new Map<BuildingId, BuildingState[]>();
  private litList: BuildingState[] = [];

  constructor(private hf: Heightfield, readonly darkness: BuildingDarkness) {
    const discGeo = new THREE.CircleGeometry(1, 24);
    discGeo.rotateX(-Math.PI / 2);
    // radial falloff via vertex alpha-in-color: bright center, dark rim
    const pos = discGeo.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(pos.getX(i), pos.getZ(i));
      const v = Math.max(0, 1 - d) ** 1.6;
      col[i * 3] = v; col[i * 3 + 1] = v * 0.98; col[i * 3 + 2] = v * 0.92; // faintly warm
    }
    discGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.discMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    this.discs = new THREE.InstancedMesh(discGeo, this.discMaterial, MAX_DISCS);
    // the instance colors exist from the start: the program never recompiles for them
    this.discs.setColorAt(0, this.tint.setScalar(0));
    this.discs.count = 0;
    this.discs.renderOrder = 2;
    this.discs.visible = false;
    this.group.add(this.discs);

    this.trackers = new Trackers(hf.site);
    this.group.add(this.trackers.group);
    this.scaffold = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
      color: 0xc9cdd3, transparent: true, opacity: 0.55, depthWrite: false,
    }));
    this.scaffold.frustumCulled = false;
    this.group.add(this.scaffold);
    if (this.classic) {
      this.decals = new ContactDecals(hf);
      this.pools = new ClassicFloods(hf);
      this.group.add(this.decals.mesh, this.pools.mesh);
    }
  }

  /** The base's lights run in the shader patches (floods + windows). */
  get shaderLights(): boolean {
    return materials.patched('building') && materials.patched('terrain');
  }

  /** Construction shows as the print reveal rather than the squash-rise. */
  private get reveal(): boolean { return materials.patched('building') || materials.classicCustom('building'); }

  /** Per frame, before the shadow fit (and after the darkness update): shader
   *  clocks, night level, the look switch after an FX / fault / safe-mode
   *  change, each structure's darkness into its lights, and the sun-tracking
   *  wings (re-aimed each `step`, see Lighting.fitShadow). */
  update(dt: number, nightFactor: number, sunDir: THREE.Vector3, step: number) {
    buildingUniforms.uBldTime.value = (buildingUniforms.uBldTime.value + dt) % 1000;
    buildingUniforms.uBldNight.value = nightFactor;
    this.night = nightFactor;
    // the stock material has no window mask: the old whole-hull glow stands
    // in, at night only
    BUILDING_MATERIAL.emissive.setScalar(this.reveal ? 0 : 0.09 * nightFactor);
    if (materials.revision !== this.revisionSeen) {
      this.revisionSeen = materials.revision;
      setFloodSlots(floodSlots(materials.fxLevel));
      if (this.last) this.rebuild(this.last);
    }
    const shader = this.shaderLights;
    this.writeDarkness();
    setFloodNight(nightFactor, shader);
    this.discs.visible = !this.classic && !shader && this.darkest > DARK_LIVE;
    // classic keys windows and pools on the same darkness: refresh when a k moved
    if (this.classic && (this.darkness.revision !== this.glowSeen || Math.abs(nightFactor - this.glowNight) > 0.004)) {
      this.refreshGlow();
    }
    if (this.trackers.update(sunDir, step)) this.onShadowCastersChanged?.();
  }

  /** Each lit structure's darkness into its lit channel (2 + k), its flood
   *  and its disc — only when a k moved. Allocation-free. */
  private writeDarkness() {
    const dk = this.darkness;
    if (dk.revision === this.darkSeen) return;
    this.darkSeen = dk.revision;
    for (let r = 0; r < this.rows.length; r++) {
      const { st, ids } = this.rows[r];
      const a = st.array as Float32Array;
      let dirty = false;
      for (let i = 0; i < ids.length; i++) {
        if (a[i * 4] < 0.5) continue; // unlit stays dark at any k
        const x = litChannel(true, dk.of(ids[i]));
        if (Math.abs(a[i * 4] - x) < 1e-4) continue;
        a[i * 4] = x;
        dirty = true;
      }
      if (dirty) st.needsUpdate = true;
    }
    let darkest = 0;
    for (let i = 0; i < this.litIds.length; i++) {
      const k = dk.of(this.litIds[i]);
      this.floods[i].k = k;
      if (k > darkest) darkest = k;
      if (i < MAX_DISCS) this.discs.setColorAt(i, this.tint.setScalar(k));
    }
    this.darkest = darkest;
    if (this.discs.instanceColor) this.discs.instanceColor.needsUpdate = true;
    refreshFloods();
  }

  /** The stock path's work lights: the lit structures standing dark nearest
   *  to `focus`, nearest first, written into `out` (pooled; up to its
   *  length). Returns how many. Allocation-free. */
  nearestDark(focus: { x: number; z: number }, out: WorkSpot[]): number {
    let n = 0;
    for (let i = 0; i < this.litIds.length; i++) {
      const k = this.darkness.of(this.litIds[i]);
      if (k <= DARK_LIVE) continue;
      const p = this.litAt[i];
      const d = (p.x - focus.x) ** 2 + (p.z - focus.z) ** 2;
      let j = n;
      if (n < out.length) n++;
      else if (d >= out[n - 1].d) continue;
      else j = n - 1;
      for (; j > 0 && out[j - 1].d > d; j--) {
        const a = out[j], b = out[j - 1];
        a.x = b.x; a.y = b.y; a.z = b.z; a.k = b.k; a.d = b.d;
      }
      const s = out[j];
      s.x = p.x; s.y = p.y; s.z = p.z; s.k = k; s.d = d;
    }
    return n;
  }

  private meshFor(type: BuildingId): THREE.InstancedMesh {
    let m = this.meshes.get(type);
    if (!m) {
      m = new THREE.InstancedMesh(withInstanceState(recipeGeometry(type), MAX_PER_TYPE),
        materials.get('building'), MAX_PER_TYPE);
      m.customDepthMaterial = materials.get('buildingDepth');
      m.castShadow = true;
      m.receiveShadow = true;
      m.count = 0;
      m.userData.buildingType = type;
      this.meshes.set(type, m);
      this.group.add(m);
    }
    return m;
  }

  /** Sync all instance matrices from state (call after place/demolish/load,
   *  and each economy tick while anything is under construction). */
  rebuild(state: GameState) {
    this.last = state;
    const types = new Set<BuildingId>(this.meshes.keys());
    for (const b of state.buildings) types.add(b.type);
    let sig = '';
    for (const type of types) sig += this.rebuildType(state, type);

    const lit = state.buildings.filter((b) =>
      (b.construction ?? 0) <= 0 && b.idleReason !== 'power' && b.enabled);
    this.litIds = lit.map((b) => b.id);
    this.litAt = lit.map((b) => {
      const [x, z] = centerOf(b);
      return { x, y: this.hf.sample(x, z), z };
    });
    this.rows = [];
    for (const [type, m] of this.meshes) {
      this.rows.push({ st: m.geometry.getAttribute('iState') as THREE.InstancedBufferAttribute, ids: this.ids.get(type) ?? [] });
    }
    const placed: Placed[] = [];
    for (const b of state.buildings) {
      if ((b.construction ?? 0) > 0 || !MOUNTS[b.type]) continue;
      const [x, z] = centerOf(b);
      placed.push({ b, x, y: this.hf.sample(x, z), z, dust: this.panelDust?.(b) });
    }
    this.trackers.rebuild(placed);
    sig += `|parts:${placed.map((p) => p.b.id).join(',')}`;
    if (sig !== this.casterSig) {
      this.casterSig = sig;
      this.onShadowCastersChanged?.();
    }

    // light pools from every completed, POWERED structure — brownouts go dark
    // the lamp stands out in front of the door side, so the facade catches it;
    // each pool is as bright as its structure stands dark
    const floods: FloodSource[] = lit.map((b) => {
      const [x, z] = centerOf(b);
      const [w, d] = BUILDINGS[b.type].footprint;
      const out = (d * CELL_M) / 2 + 2.5;
      const a = -b.rot * Math.PI / 2;
      const lx = x + Math.sin(a) * out, lz = z + Math.cos(a) * out;
      const mast = Math.min(12, Math.max(7, BUILDINGS[b.type].height + 2));
      const reach = (Math.max(w, d) * CELL_M) / 2 + 10 + 2.5;
      return { x: lx, z: lz, y: this.hf.sample(x, z) + mast, r: Math.hypot(mast, reach), k: this.darkness.of(b.id) };
    });
    this.floods = floods;
    setFloodSources(floods);
    this.darkSeen = -1; // discs and the darkest k are written on the next frame
    this.discs.count = Math.min(lit.length, MAX_DISCS);
    const mat = new THREE.Matrix4();
    lit.forEach((b, i) => {
      if (i >= MAX_DISCS) return;
      const [cx, cz] = centerOf(b);
      const y = this.hf.sample(cx, cz);
      const r = footprintRect(b);
      const radius = Math.max(r.w, r.d) * 4 * 1.1; // meters; a little past the walls
      mat.makeScale(radius, 1, radius);
      mat.setPosition(cx, y + 0.12, cz);
      this.discs.setMatrixAt(i, mat);
    });
    this.discs.instanceMatrix.needsUpdate = true;
    this.discs.computeBoundingSphere();
    this.litList = lit;
    this.pools?.rebuild(lit);
    if (this.classic) this.refreshGlow();
    this.decals?.rebuild(state);

    this.rebuildScaffold(state);
  }

  /** Classic: every structure's light level into its windows (iGlow) and
   *  its flood pool, at its own darkness (night, a set or grazing sun, or
   *  terrain shadow: darkness.ts). */
  private refreshGlow() {
    this.glowNight = this.night;
    this.glowSeen = this.darkness.revision;
    for (const [type, mesh] of this.meshes) {
      const list = this.lists.get(type) ?? [];
      const glow = mesh.geometry.getAttribute('iGlow') as THREE.InstancedBufferAttribute | undefined;
      if (!glow) continue;
      for (let i = 0; i < mesh.count; i++) glow.setX(i, list[i] ? lightLevel(list[i], this.darkness.of(list[i].id)) : 0);
      glow.needsUpdate = true;
    }
    const byId = new Map(this.litList.map((b) => [b.id, b]));
    this.pools?.setLevels((id) => {
      const b = byId.get(id);
      return b ? lightLevel(b, this.darkness.of(b.id)) : 0;
    });
  }

  private rebuildScaffold(state: GameState) {
    const sites: ScaffoldSite[] = [];
    let sig = '';
    for (const b of state.buildings) {
      if ((b.construction ?? 0) <= 0) continue;
      const r = footprintRect(b);
      sites.push({
        x0: r.gx0 * CELL_M - MAP_M / 2, x1: r.gx1 * CELL_M - MAP_M / 2,
        z0: r.gz0 * CELL_M - MAP_M / 2, z1: r.gz1 * CELL_M - MAP_M / 2,
        h: BUILDINGS[b.type].height,
      });
      sig += `${b.id}:${b.gx},${b.gz},${b.rot};`;
    }
    if (sig === this.scaffoldSig) return;
    this.scaffoldSig = sig;
    this.scaffold.geometry.dispose();
    this.scaffold.geometry = scaffoldGeometry(this.hf, sites);
    this.scaffold.visible = sites.length > 0;
  }

  private static DIM = new THREE.Color(0.45, 0.45, 0.5);   // construction site (squash path)
  private static DARK = new THREE.Color(0.55, 0.55, 0.6);   // browned-out (lights off)
  private static FULL = new THREE.Color(1, 1, 1);

  /** Returns this type's caster signature (placements + rise). */
  private rebuildType(state: GameState, type: BuildingId): string {
    const mesh = this.meshFor(type);
    const list = state.buildings.filter((b) => b.type === type);
    mesh.count = Math.min(list.length, MAX_PER_TYPE);
    const st = mesh.geometry.getAttribute('iState') as THREE.InstancedBufferAttribute;
    const topY = mesh.geometry.boundingBox?.max.y ?? BUILDINGS[type].height;
    const reveal = this.reveal;
    const mat = new THREE.Matrix4();
    const rot = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const order: number[] = [];
    let sig = type;
    list.forEach((b, i) => {
      if (i >= MAX_PER_TYPE) return;
      const [cx, cz] = centerOf(b);
      const y = this.hf.sample(cx, cz);
      rot.setFromAxisAngle(up, -b.rot * Math.PI / 2);
      const remaining = b.construction ?? 0;
      const total = b.buildTotal ?? 0;
      const progress = remaining > 0 && total > 0 ? 1 - remaining / total : 1;
      // patched: printed bottom-up at full size; stock: rises squashed from the pad
      const sy = progress >= 1 || reveal ? 1 : 0.12 + 0.88 * progress;
      const cut = progress >= 1 || !reveal ? CUT_NONE : progress * topY;
      mat.compose(new THREE.Vector3(cx, y, cz), rot, new THREE.Vector3(1, sy, 1));
      mesh.setMatrixAt(i, mat);
      const powered = progress >= 1 && b.enabled && b.idleReason !== 'power';
      const color = progress < 1 && !reveal ? BuildingInstances.DIM
        : b.idleReason === 'power' ? BuildingInstances.DARK
        : BuildingInstances.FULL;
      mesh.setColorAt(i, color);
      // lit, and the darkness it stands in (the shader's light level)
      st.setXYZW(i, litChannel(powered, this.darkness.of(b.id)), b.dust ?? 0, b.wear ?? 0, cut);
      order.push(b.id);
      sig += `|${b.gx},${b.gz},${b.rot},${sy.toFixed(3)},${cut === CUT_NONE ? '-' : cut.toFixed(2)}`;
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    st.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.ids.set(type, order);
    this.lists.set(type, list.slice(0, MAX_PER_TYPE));
    return sig;
  }

  /** A structure's per-instance light (tests): its glow level (the classic
   *  windows' iGlow; null in High detail) and the powered flag (iState.x). */
  glowOf(id: number): { glow: number | null; powered: number } | null {
    for (const [type, order] of this.ids) {
      const i = order.indexOf(id);
      if (i < 0) continue;
      const g = this.meshes.get(type)!.geometry;
      const glow = g.getAttribute('iGlow') as THREE.InstancedBufferAttribute | undefined;
      // the lit channel is 0 (unpowered), 1 (lit at the night) or 2 + k: powered is ≥ 0.5
      return { glow: glow ? glow.getX(i) : null, powered: g.getAttribute('iState').getX(i) >= 0.5 ? 1 : 0 };
    }
    return null;
  }

  /** Material class per building type (safe-mode checks, probes). */
  materialTypes(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [type, m] of this.meshes) out[type] = (m.material as THREE.Material).type;
    return out;
  }

  /** One structure's light as the renderer holds it: its darkness and the
   *  inputs behind it, the lit channel its instance carries, the emissive
   *  gains that makes (as the building shader computes them) and its flood
   *  slot (tests, probes). */
  lightInfo(id: number) {
    let x: number | null = null;
    for (const { st, ids } of this.rows) {
      const i = ids.indexOf(id);
      if (i >= 0 && i < MAX_PER_TYPE) { x = st.getX(i); break; }
    }
    const lit = x !== null && x >= 0.5;
    const dark = lit ? channelDark(x!, buildingUniforms.uBldNight.value) : 0;
    const blinkOn = EMISSIVE.beaconDay + EMISSIVE.beaconDark * dark + EMISSIVE.beaconNight * buildingUniforms.uBldNight.value;
    const fi = this.litIds.indexOf(id);
    return {
      ...this.darkness.info(id),
      lit,
      /** the darkness the instance lights at (null: unlit or no instance) */
      instanceK: lit ? dark : null,
      window: lit ? EMISSIVE.window * Math.max(dark, EMISSIVE.windowDay) : 0,
      lamp: lit ? EMISSIVE.lamp * dark : 0,
      beacon: lit ? blinkOn : 0,
      flood: fi >= 0 ? floodSlotOf(fi) : null,
      path: this.shaderLights ? 'shader' : 'stock',
    };
  }

  /** Night-lighting path, floods and moving parts (tests, probes). */
  renderInfo() {
    return {
      nightLights: this.classic ? 'classic' : this.shaderLights ? 'shader' : 'stock',
      reveal: this.reveal,
      floods: floodStats(),
      discs: this.discs.visible ? this.discs.count : this.pools?.count ?? 0,
      decals: this.decals?.count ?? 0,
      scaffold: this.scaffold.visible ? this.scaffold.geometry.getAttribute('position')?.count / 2 : 0,
      trackers: this.trackers.info(),
      clock: buildingUniforms.uBldTime.value,
    };
  }

  /** Raycast → building id (for selection). */
  pick(raycaster: THREE.Raycaster): number | null {
    const parts = Object.values(this.trackers.meshes);
    const hits = raycaster.intersectObjects([...this.meshes.values(), ...parts], false);
    for (const hit of hits) {
      if (hit.instanceId === undefined) continue;
      const type = hit.object.userData.buildingType as BuildingId | undefined;
      const id = type ? this.ids.get(type)?.[hit.instanceId] : this.trackers.idOf(hit.object, hit.instanceId);
      if (id !== undefined) return id;
    }
    return null;
  }

  /** AABBs for walk-mode collision. */
  colliders(state: GameState): { minX: number; maxX: number; minZ: number; maxZ: number; top: number }[] {
    return state.buildings.map((b) => {
      const r = footprintRect(b);
      const [cx, cz] = centerOf(b);
      const y = this.hf.sample(cx, cz);
      return {
        minX: r.gx0 * CELL_M - MAP_M / 2,
        maxX: r.gx1 * CELL_M - MAP_M / 2,
        minZ: r.gz0 * CELL_M - MAP_M / 2,
        maxZ: r.gz1 * CELL_M - MAP_M / 2,
        top: y + BUILDINGS[b.type].height,
      };
    });
  }
}
