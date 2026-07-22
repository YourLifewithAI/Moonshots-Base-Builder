/** One InstancedMesh per building type = one draw call per type.
 *  Rebuilt from GameState whenever buildings change (placement is rare;
 *  a full rebuild of a type's matrices is trivially cheap). */
import * as THREE from 'three';
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { CELL_M, MAP_M } from '../data/balance';
import type { GameState, BuildingState } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import { recipeGeometry } from './recipes';
import { BUILDING_MATERIAL } from './meshKit';

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

export class BuildingInstances {
  readonly group = new THREE.Group();
  private meshes = new Map<BuildingId, THREE.InstancedMesh>();
  /** instance order per type, mirroring rebuild() — used for picking */
  private ids = new Map<BuildingId, number[]>();
  /** night light pools: one soft additive disc under each completed building */
  private discs: THREE.InstancedMesh;
  private discMaterial: THREE.MeshBasicMaterial;

  constructor(private hf: Heightfield) {
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
      opacity: 0,
      depthWrite: false,
    });
    this.discs = new THREE.InstancedMesh(discGeo, this.discMaterial, MAX_DISCS);
    this.discs.count = 0;
    this.discs.renderOrder = 2;
    this.discs.visible = false;
    this.group.add(this.discs);
  }

  /** 0 = day (pools invisible) … 1 = deep night. Called per frame. */
  setNightGlow(f: number) {
    this.discMaterial.opacity = 0.5 * f;
    this.discs.visible = f > 0.02;
  }

  /** World positions of completed structures, nearest to `focus` first —
   *  feeds the exterior work-light pool. */
  completedCenters(state: GameState, focus: { x: number; z: number }): { x: number; y: number; z: number }[] {
    return state.buildings
      .filter((b) => (b.construction ?? 0) <= 0 && b.idleReason !== 'power' && b.enabled)
      .map((b) => {
        const [cx, cz] = centerOf(b);
        return { x: cx, y: this.hf.sample(cx, cz), z: cz,
          d: (cx - focus.x) ** 2 + (cz - focus.z) ** 2 };
      })
      .sort((a, b) => a.d - b.d);
  }

  private meshFor(type: BuildingId): THREE.InstancedMesh {
    let m = this.meshes.get(type);
    if (!m) {
      m = new THREE.InstancedMesh(recipeGeometry(type), BUILDING_MATERIAL, MAX_PER_TYPE);
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
    const types = new Set<BuildingId>(this.meshes.keys());
    for (const b of state.buildings) types.add(b.type);
    for (const type of types) this.rebuildType(state, type);
    // light pools under every completed, POWERED structure — brownouts go dark
    const done = state.buildings.filter((b) =>
      (b.construction ?? 0) <= 0 && b.idleReason !== 'power' && b.enabled);
    this.discs.count = Math.min(done.length, MAX_DISCS);
    const mat = new THREE.Matrix4();
    done.forEach((b, i) => {
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
  }

  private static DIM = new THREE.Color(0.45, 0.45, 0.5);   // construction site
  private static DARK = new THREE.Color(0.55, 0.55, 0.6);   // browned-out (lights off)
  private static FULL = new THREE.Color(1, 1, 1);

  private rebuildType(state: GameState, type: BuildingId) {
    const mesh = this.meshFor(type);
    const list = state.buildings.filter((b) => b.type === type);
    mesh.count = Math.min(list.length, MAX_PER_TYPE);
    const mat = new THREE.Matrix4();
    const rot = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const order: number[] = [];
    list.forEach((b, i) => {
      if (i >= MAX_PER_TYPE) return;
      const [cx, cz] = centerOf(b);
      const y = this.hf.sample(cx, cz);
      rot.setFromAxisAngle(up, -b.rot * Math.PI / 2);
      // constructing buildings rise from the pad and render dimmed
      const remaining = b.construction ?? 0;
      const total = b.buildTotal ?? 0;
      const progress = remaining > 0 && total > 0 ? 1 - remaining / total : 1;
      const sy = progress >= 1 ? 1 : 0.12 + 0.88 * progress;
      mat.compose(new THREE.Vector3(cx, y, cz), rot, new THREE.Vector3(1, sy, 1));
      mesh.setMatrixAt(i, mat);
      const color = progress < 1 ? BuildingInstances.DIM
        : b.idleReason === 'power' ? BuildingInstances.DARK
        : BuildingInstances.FULL;
      mesh.setColorAt(i, color);
      order.push(b.id);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.ids.set(type, order);
  }

  /** Raycast → building id (for selection). */
  pick(raycaster: THREE.Raycaster): number | null {
    const hits = raycaster.intersectObjects([...this.meshes.values()], false);
    for (const hit of hits) {
      const mesh = hit.object as THREE.InstancedMesh;
      const type = mesh.userData.buildingType as BuildingId;
      if (hit.instanceId === undefined) continue;
      const id = this.ids.get(type)?.[hit.instanceId];
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
