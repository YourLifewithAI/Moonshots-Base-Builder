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

export class BuildingInstances {
  readonly group = new THREE.Group();
  private meshes = new Map<BuildingId, THREE.InstancedMesh>();
  /** instance order per type, mirroring rebuild() — used for picking */
  private ids = new Map<BuildingId, number[]>();

  constructor(private hf: Heightfield) {}

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

  /** Sync all instance matrices from state (call after place/demolish/load). */
  rebuild(state: GameState) {
    const byType = new Map<BuildingId, BuildingState[]>();
    for (const b of state.buildings) {
      if (!byType.has(b.type)) byType.set(b.type, []);
      byType.get(b.type)!.push(b);
    }
    const mat = new THREE.Matrix4();
    const rot = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [type, mesh] of this.meshes) {
      const list = byType.get(type) ?? [];
      mesh.count = Math.min(list.length, MAX_PER_TYPE);
      const order: number[] = [];
      list.forEach((b, i) => {
        if (i >= MAX_PER_TYPE) return;
        const [cx, cz] = centerOf(b);
        const y = this.hf.sample(cx, cz);
        rot.setFromAxisAngle(up, -b.rot * Math.PI / 2);
        mat.compose(new THREE.Vector3(cx, y, cz), rot, new THREE.Vector3(1, 1, 1));
        mesh.setMatrixAt(i, mat);
        order.push(b.id);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      order.length = mesh.count;
      this.ids.set(type, order);
    }
    for (const type of byType.keys()) this.meshFor(type); // create lazily
    // second pass for newly created meshes
    for (const [type, mesh] of this.meshes) {
      if ((this.ids.get(type)?.length ?? -1) !== mesh.count) this.rebuildType(state, type);
    }
  }

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
      mat.compose(new THREE.Vector3(cx, y, cz), rot, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, mat);
      order.push(b.id);
    });
    mesh.instanceMatrix.needsUpdate = true;
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
