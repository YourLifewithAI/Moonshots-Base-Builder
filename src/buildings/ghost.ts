/** Placement ghost. The registry's stock translucent Lambert (world/cel.ts:
 *  the form reads by its lit and shaded faces, pale = yes, dark = no) over a
 *  depth-only pre-pass, so only the front surface blends — internal faces
 *  never double up. Valid = pale, blocked = dark (value, never hue). */
import * as THREE from 'three';
import { materials } from '../world/materials';

const VALID = { color: new THREE.Color(0xf5f7f9), opacity: 0.42 };
const BLOCKED = { color: new THREE.Color(0x14161a), opacity: 0.6 };

// pushed back a hair so the ghost's own front faces pass the depth test
const PREPASS = new THREE.MeshBasicMaterial({
  colorWrite: false, transparent: true,
  polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
});

export function createGhost(geo: THREE.BufferGeometry): THREE.Mesh {
  const ghost = new THREE.Mesh(geo, materials.get('ghost'));
  ghost.renderOrder = 11;
  const pre = new THREE.Mesh(geo, PREPASS);
  pre.renderOrder = 10;
  ghost.add(pre);
  return ghost;
}

export function setGhostBlocked(ghost: THREE.Mesh, blocked: boolean) {
  const m = ghost.material as THREE.MeshBasicMaterial;
  const s = blocked ? BLOCKED : VALID;
  m.color.copy(s.color);
  m.opacity = s.opacity;
}
