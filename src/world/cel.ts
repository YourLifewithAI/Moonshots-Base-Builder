/** The cel style's materials — the one renderer. Registered in the material
 *  registry (world/materials.ts), which hands them out to every mesh creator:
 *
 *    terrain · ring · berms   stock Lambert, vertex colours (the geometry
 *                             is faceted; terrain/celGround.ts colours it)
 *    rocks                    stock Lambert, per-instance colours
 *    buildings · parts ·      the one small cel shader (palette, glow,
 *    rovers · cargo lander    beacons, print reveal): buildings/celBuilding.ts
 *    roads                    stock Lambert, vertex colours (world/roads.ts)
 *    placement ghost          stock Lambert, translucent: the form reads by
 *                             its lit and shaded faces, pale = yes, dark = no
 *    dust                     stock points (static puffs placed on the CPU)
 *
 *  Nothing here is a shader patch: no onBeforeCompile, no FX variants, no
 *  float render targets, no post chain. */
import * as THREE from 'three';
import { materials } from './materials';
import { installCelBuildings } from '../buildings/celBuilding';

materials.define('terrain', new THREE.MeshLambertMaterial({ vertexColors: true }));
materials.define('rock', new THREE.MeshLambertMaterial());
materials.define('ghost', new THREE.MeshLambertMaterial({
  color: 0xf5f7f9, emissive: 0x2a2c30, transparent: true, opacity: 0.5, depthWrite: false,
}));
materials.define('dust', new THREE.PointsMaterial({
  color: 0x303030, size: 2, sizeAttenuation: false, transparent: true, opacity: 0.9, depthWrite: false,
}));

/** Boot-time setup (before any world exists). */
export function installCel() {
  installCelBuildings();
}
