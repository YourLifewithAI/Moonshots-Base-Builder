/** The cel style's materials — the one renderer. Registered in the material
 *  registry (world/materials.ts), which hands them out to every mesh creator:
 *
 *    terrain · ring · berms   the ground program (world/celSurface.ts): vertex
 *                             colours, faceted normals, two light steps
 *                             (terrain/celGround.ts colours it)
 *    rocks                    the same program, per-instance colours
 *    buildings · parts ·      the one small cel shader (palette, three-step
 *    rovers · cargo lander    ramp, glow, beacons, print reveal):
 *                             buildings/celBuilding.ts
 *    roads                    the ground program, vertex colours (world/roads.ts)
 *    placement ghost          the ground program on the buildings' ramp,
 *                             translucent: the form reads by its lit and
 *                             shaded faces, pale = yes, dark = no
 *    dust                     stock points (static puffs placed on the CPU,
 *                             tinted per emitter)
 *
 *  Nothing here is a shader patch: no onBeforeCompile, no FX variants, no
 *  float render targets, no post chain. A compile fault in any cel program
 *  swaps stock Lambert in for all of them (materials.replaceCustom). */
import * as THREE from 'three';
import { materials } from './materials';
import { celSurface, celSurfaceFallback } from './celSurface';
import { installCelBuildings } from '../buildings/celBuilding';

materials.define('terrain', celSurface('cel-terrain', { vertexColors: true, poster: true }),
  () => celSurfaceFallback({ vertexColors: true }));
materials.define('rock', celSurface('cel-rock'), () => celSurfaceFallback());
materials.define('ghost', celSurface('cel-ghost', {
  ramp: 'building', tint: 0xf5f7f9, emit: 0x2a2c30, opacity: 0.5, depthWrite: false,
}), () => new THREE.MeshLambertMaterial({
  color: 0xf5f7f9, emissive: 0x2a2c30, transparent: true, opacity: 0.5, depthWrite: false,
}));
materials.define('dust', new THREE.PointsMaterial({
  color: 0x303030, size: 2, sizeAttenuation: false, transparent: true, opacity: 0.9, depthWrite: false,
  vertexColors: true,
}));

/** Boot-time setup (before any world exists). */
export function installCel() {
  installCelBuildings();
}
