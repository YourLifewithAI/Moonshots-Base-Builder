/** Parametric primitive kit. Every building is composed from these, merged into
 *  ONE geometry with the two-tone palette baked into vertex colors (body
 *  #cfcfcf, trim #6b6b6b) so each building type renders as a single
 *  InstancedMesh — one draw call per type. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const BODY = 0.81; // lit metal
export const TRIM = 0.42; // panel accents

function bake(geo: THREE.BufferGeometry, v: number): THREE.BufferGeometry {
  const count = geo.getAttribute('position').count;
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    col[i * 3] = v; col[i * 3 + 1] = v; col[i * 3 + 2] = v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.deleteAttribute('uv'); // no textures anywhere; keeps merges compatible
  return geo;
}

export function box(w: number, h: number, d: number, v: number,
  x = 0, y = 0, z = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rz) g.rotateZ(rz);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return bake(g, v);
}

export function cyl(rt: number, rb: number, h: number, v: number,
  x = 0, y = 0, z = 0, rx = 0, rz = 0, seg = 12): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return bake(g, v);
}

export function dome(r: number, v: number, x = 0, y = 0, z = 0, seg = 16): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, seg, Math.ceil(seg / 2), 0, Math.PI * 2, 0, Math.PI / 2);
  g.translate(x, y, z);
  return bake(g, v);
}

/** Half-pipe greenhouse vault (cylinder segment, open side down). */
export function vault(r: number, len: number, v: number, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, len, 12, 1, true, 0, Math.PI);
  g.rotateZ(Math.PI / 2);
  g.rotateY(Math.PI / 2);
  g.translate(x, y, z);
  return bake(g, v);
}

/** Simple truss leg: thin box. */
export function strut(h: number, v: number, x = 0, y = 0, z = 0, lean = 0): THREE.BufferGeometry {
  return box(0.28, h, 0.28, v, x, y, z, 0, lean);
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  merged.computeVertexNormals();
  return merged;
}

export const BUILDING_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.55,
  metalness: 0.35,
});
