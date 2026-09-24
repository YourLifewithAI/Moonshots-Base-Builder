/** Moving parts, instanced apart from their buildings so they can turn:
 *  solar wings track the sun each frame (yaw to its azimuth, tilt to its
 *  elevation — near-vertical under the pole's grazing sun, stowed flat at
 *  night) and dishes hold on Earth, which never moves in a site's sky.
 *  Picking maps a hit back to its building; colliders stay the recipe AABB.
 *  Built structures only: a part is mounted once its building is complete. */
import * as THREE from 'three';
import type { BuildingState } from '../core/state';
import { MOUNTS, partGeometry, type PartId } from './recipes';
import { withInstanceState } from './meshKit';
import { CUT_NONE } from './buildingShader';
import { materials } from '../world/materials';
import { skyDirection } from '../world/sky';
import type { SiteDef } from '../data/sites';

const MAX: Record<PartId, number> = { wing: 96, dish: 256 };
const SUN_STEP = Math.cos(0.1 * Math.PI / 180);
const MIN_ELEV = 0.05; // rad: below this the wing stands vertical, not past it
const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);

export interface Placed { b: BuildingState; x: number; y: number; z: number }

interface Slot { id: number; pivot: THREE.Vector3; s: number }

export class Trackers {
  readonly group = new THREE.Group();
  readonly meshes: Record<PartId, THREE.InstancedMesh>;
  private slots: Record<PartId, Slot[]> = { wing: [], dish: [] };
  private sunSeen = new THREE.Vector3(0, -2, 0);
  private stowSeen = -1;
  private earthQ = new THREE.Quaternion();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private qt = new THREE.Quaternion();
  private one = new THREE.Vector3(1, 1, 1);

  constructor(site: SiteDef) {
    const e = site.earth;
    this.earthQ.setFromUnitVectors(UP, skyDirection(e.elevDeg * Math.PI / 180, e.azimDeg * Math.PI / 180));
    const make = (part: PartId) => {
      const mesh = new THREE.InstancedMesh(withInstanceState(partGeometry(part), MAX[part]),
        materials.get('building'), MAX[part]);
      mesh.customDepthMaterial = materials.get('buildingDepth');
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.userData.part = part;
      this.group.add(mesh);
      return mesh;
    };
    this.meshes = { wing: make('wing'), dish: make('dish') };
  }

  /** Re-seat the parts on the completed structures (after any rebuild). */
  rebuild(placed: readonly Placed[]) {
    const rot = new THREE.Quaternion();
    for (const part of ['wing', 'dish'] as PartId[]) this.slots[part] = [];
    for (const { b, x, y, z } of placed) {
      rot.setFromAxisAngle(UP, -b.rot * Math.PI / 2);
      for (const mount of MOUNTS[b.type] ?? []) {
        const list = this.slots[mount.part];
        if (list.length >= MAX[mount.part]) continue;
        const pivot = new THREE.Vector3(...mount.p).applyQuaternion(rot).add(new THREE.Vector3(x, y, z));
        const i = list.length;
        list.push({ id: b.id, pivot, s: mount.s });
        const st = this.meshes[mount.part].geometry.getAttribute('iState') as THREE.InstancedBufferAttribute;
        const lit = b.enabled && b.idleReason !== 'power' ? 1 : 0;
        st.setXYZW(i, lit, b.type === 'solar' ? b.dust : 0, b.wear, CUT_NONE);
      }
    }
    for (const part of ['wing', 'dish'] as PartId[]) {
      const mesh = this.meshes[part];
      mesh.count = this.slots[part].length;
      mesh.geometry.getAttribute('iState').needsUpdate = true;
    }
    const dishes = this.meshes.dish;
    this.slots.dish.forEach((sl, i) => {
      dishes.setMatrixAt(i, this.m.compose(sl.pivot, this.earthQ, new THREE.Vector3(sl.s, sl.s, sl.s)));
    });
    dishes.instanceMatrix.needsUpdate = true;
    dishes.computeBoundingSphere();
    this.sunSeen.set(0, -2, 0); // wings re-aim next update
  }

  /** Aim the wings at the sun; they fold flat once it is below the
   *  horizon. True when anything moved (the shadow map needs a render). */
  update(sunDir: THREE.Vector3): boolean {
    const wings = this.meshes.wing;
    const elev = Math.asin(Math.min(1, Math.max(-1, sunDir.y)));
    const stow = Math.round(Math.min(1, Math.max(0, (elev + 0.03) / 0.04)) * 100) / 100;
    if (sunDir.dot(this.sunSeen) >= SUN_STEP && stow === this.stowSeen) return false;
    this.sunSeen.copy(sunDir);
    this.stowSeen = stow;
    if (wings.count === 0) return false;
    const azim = Math.atan2(sunDir.z, sunDir.x);
    const tilt = (Math.PI / 2 - Math.max(elev, MIN_ELEV)) * stow;
    this.q.setFromAxisAngle(UP, Math.PI / 2 - azim).multiply(this.qt.setFromAxisAngle(X, tilt));
    this.slots.wing.forEach((sl, i) => wings.setMatrixAt(i, this.m.compose(sl.pivot, this.q, this.one)));
    wings.instanceMatrix.needsUpdate = true;
    wings.computeBoundingSphere();
    return true;
  }

  /** Building id under a hit on a part, or undefined. */
  idOf(mesh: THREE.Object3D, instanceId: number): number | undefined {
    const part = mesh.userData.part as PartId | undefined;
    return part ? this.slots[part][instanceId]?.id : undefined;
  }

  /** Tracker normals and counts (tests, probes). */
  info() {
    const n = new THREE.Vector3();
    if (this.meshes.wing.count > 0) {
      this.meshes.wing.getMatrixAt(0, this.m);
      n.set(0, 1, 0).transformDirection(this.m);
    }
    return {
      wings: this.meshes.wing.count, dishes: this.meshes.dish.count,
      wingNormal: [n.x, n.y, n.z],
      material: (this.meshes.wing.material as THREE.Material).type,
    };
  }
}
