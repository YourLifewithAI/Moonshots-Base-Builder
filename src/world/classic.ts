/** The classic render style's materials, registered beside the High detail
 *  ones (world/materials.ts hands out whichever style is drawing):
 *
 *    terrain · ring · berms   stock Lambert, vertex colours (the geometry
 *                             is faceted; terrain/classicGround.ts colours it)
 *    rocks                    stock Lambert, per-instance colours
 *    buildings · parts ·      the one small classic shader (palette, glow,
 *    rovers · cargo lander    beacons, print reveal): buildings/classicBuilding.ts
 *    placement ghost          stock Lambert, translucent: the form reads by
 *                             its lit and shaded faces, pale = yes, dark = no
 *    dust                     stock points (static puffs placed on the CPU)
 *
 *  Nothing here is a shader patch: no onBeforeCompile, no FX variants, no
 *  float render targets. */
import * as THREE from 'three';
import { materials } from './materials';
import { installClassicBuildings } from '../buildings/classicBuilding';

materials.defineClassic('terrain', new THREE.MeshLambertMaterial({ vertexColors: true }));
materials.defineClassic('rock', new THREE.MeshLambertMaterial());
materials.defineClassic('ghost', new THREE.MeshLambertMaterial({
  color: 0xf5f7f9, emissive: 0x2a2c30, transparent: true, opacity: 0.5, depthWrite: false,
}));
materials.defineClassic('dust', new THREE.PointsMaterial({
  color: 0x303030, size: 2, sizeAttenuation: false, transparent: true, opacity: 0.9, depthWrite: false,
}));

/** Boot-time setup for a classic session (before any world exists). */
export function installClassic() {
  installClassicBuildings();
}
