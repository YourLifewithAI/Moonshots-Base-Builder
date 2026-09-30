/** Placement ghost. The registry's translucent ground program on the
 *  buildings' ramp (world/cel.ts, world/celSurface.ts: the form reads by its
 *  lit and shaded bands, pale = yes, dark = no) over a depth-only pre-pass,
 *  so only the front surface blends — internal faces never double up. Valid
 *  = pale, blocked = dark (value, never hue). In safe mode (or after a
 *  shader fault) the material is an unlit or stock twin: same colours. */
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
  const m = ghost.material as THREE.MeshBasicMaterial | THREE.ShaderMaterial;
  const s = blocked ? BLOCKED : VALID;
  if ((m as THREE.ShaderMaterial).isShaderMaterial) {
    const u = (m as THREE.ShaderMaterial).uniforms;
    (u.uTint.value as THREE.Color).copy(s.color);
    u.uOpacity.value = s.opacity;
  } else (m as THREE.MeshBasicMaterial).color.copy(s.color);
  m.opacity = s.opacity;
}
