/** Parametric primitive kit. Every building is composed from these, merged into
 *  ONE geometry so each building type renders as a single InstancedMesh — one
 *  draw call per type. Each part is baked with a Finish: its gray value goes
 *  into vertex colors, and its surface response into a per-vertex `mat`
 *  attribute (roughness, metalness, emissive id) that the building shader
 *  patch reads (buildingShader.ts). The stock shader ignores `mat`, so FX 3
 *  and safe mode still show the values. Every bake writes both attributes:
 *  merged parts must carry identical attribute sets. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { materials } from '../world/materials';
import { CUT_NONE, buildingDepthPatch, buildingPatch } from './buildingShader';

export interface Finish {
  /** linear gray value */
  v: number;
  rough: number;
  metal: number;
  /** 0 none · 1 window (lit from inside at night) · 2 blinking beacon */
  emit?: number;
}

// three values only — hull, trim, glass; finishes differ in response
export const BODY: Finish = { v: 0.81, rough: 0.55, metal: 0.15 };      // satin aluminum hull
export const TRIM: Finish = { v: 0.42, rough: 0.62, metal: 0.2 };       // frames, struts, stacks
export const GLASS: Finish = { v: 0.07, rough: 0.18, metal: 0 };        // PV cells, dark glass
export const WINDOW: Finish = { ...GLASS, emit: 1 };
export const LAMP: Finish = { v: 0.81, rough: 0.4, metal: 0, emit: 1 };  // work lamp lens
export const BEACON: Finish = { v: 0.81, rough: 0.4, metal: 0, emit: 2 };
export const RADIATOR: Finish = { v: 0.81, rough: 0.9, metal: 0 };      // matte white panels
export const FOIL: Finish = { v: 0.81, rough: 0.3, metal: 0.45 };       // MLI blankets
export const PLATE: Finish = { v: 0.42, rough: 0.45, metal: 0.35 };     // bare machined metal

type V3 = readonly [number, number, number];
const UP = new THREE.Vector3(0, 1, 0);

function bake(geo: THREE.BufferGeometry, f: Finish): THREE.BufferGeometry {
  const count = geo.getAttribute('position').count;
  const col = new Float32Array(count * 3);
  const mat = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    col[i * 3] = f.v; col[i * 3 + 1] = f.v; col[i * 3 + 2] = f.v;
    mat[i * 3] = f.rough; mat[i * 3 + 1] = f.metal; mat[i * 3 + 2] = f.emit ?? 0;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('mat', new THREE.BufferAttribute(mat, 3));
  geo.deleteAttribute('uv'); // no textures anywhere; keeps merges compatible
  // the part's largest face (m²): the classic palette keeps its orange
  // accent to small parts and greys big slabs (classicBuilding.ts)
  geo.computeBoundingBox();
  const sz = geo.boundingBox!.getSize(new THREE.Vector3()).toArray().sort((a, b) => b - a);
  geo.userData.area = sz[0] * sz[1];
  return geo;
}

export function box(w: number, h: number, d: number, f: Finish,
  x = 0, y = 0, z = 0, ry = 0, rz = 0, rx = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return bake(g, f);
}

export function cyl(rt: number, rb: number, h: number, f: Finish,
  x = 0, y = 0, z = 0, rx = 0, rz = 0, seg = 16, open = false): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return bake(g, f);
}

export function dome(r: number, f: Finish, x = 0, y = 0, z = 0, seg = 24): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, seg, Math.ceil(seg / 2), 0, Math.PI * 2, 0, Math.PI / 2);
  g.translate(x, y, z);
  return bake(g, f);
}

/** A latitude band of a dome (polar angles t0..t1 from the top), a hair
 *  proud of the shell — window bands, skylights. */
export function domeBand(r: number, t0: number, t1: number, f: Finish,
  x = 0, y = 0, z = 0, seg = 24, phi0 = 0, phiLen = Math.PI * 2): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, seg, 2, phi0, phiLen, t0, t1 - t0);
  g.translate(x, y, z);
  return bake(g, f);
}

/** Half-pipe greenhouse vault (cylinder segment, open side down), along z. */
export function vault(r: number, len: number, f: Finish, x = 0, y = 0, z = 0,
  theta0 = 0, thetaLen = Math.PI, seg = 16): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true, theta0, thetaLen);
  g.rotateZ(Math.PI / 2);
  g.rotateY(Math.PI / 2);
  g.translate(x, y, z);
  return bake(g, f);
}

/** Half-disc end wall for a vault (flat side down, thickness t along z). */
export function archWall(r: number, t: number, f: Finish, x = 0, y = 0, z = 0, seg = 16): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, t, seg, 1, false, 0, Math.PI);
  g.rotateX(Math.PI / 2);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return bake(g, f);
}

/** Surface of revolution about +y from a [radius, y] profile (dish shells). */
export function lathe(pts: readonly (readonly [number, number])[], f: Finish, seg = 20): THREE.BufferGeometry {
  return bake(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), f);
}

/** Regolith berm against a wall: a triangular prism `len` long whose
 *  vertical face backs onto the wall and whose slope runs out toward yaw ry
 *  (0 = +z). (x, z) is the foot of the wall face. */
export function berm(len: number, h: number, x: number, z: number, ry = 0, f: Finish = TRIM): THREE.BufferGeometry {
  const r = h / 0.866;
  const g = new THREE.CylinderGeometry(r, r, len, 3);
  g.rotateZ(Math.PI / 2);      // axis along x, apex toward +z, back face at z = −r/2
  g.translate(0, 0, r / 2);
  g.rotateY(ry);
  g.translate(x, 0, z);
  return bake(g, f);
}

/** Simple truss leg: thin box. */
export function strut(h: number, f: Finish, x = 0, y = 0, z = 0, lean = 0): THREE.BufferGeometry {
  return box(0.28, h, 0.28, f, x, y, z, 0, lean);
}

/** Square-section member from a to b (rails, braces, legs). */
export function bar(a: V3, b: V3, t: number, f: Finish): THREE.BufferGeometry {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length();
  const g = new THREE.BoxGeometry(t, len, t);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return bake(g, f);
}

/** Round pipe from a to b. */
export function pipe(a: V3, b: V3, r: number, f: Finish, seg = 8): THREE.BufferGeometry {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return bake(g, f);
}

/** Handrail along a closed or open polyline of [x, z] at deck height y:
 *  posts every ~1.6 m, a top rail and a knee rail. */
export function rail(pts: readonly (readonly [number, number])[], y: number, closed = false,
  f: Finish = TRIM, h = 1.0): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const posts = Math.max(1, Math.round(len / 1.6));
    for (let k = 0; k < posts; k++) {
      const t = k / posts;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      out.push(box(0.06, h, 0.06, f, x, y + h / 2, z));
    }
    out.push(bar([x0, y + h, z0], [x1, y + h, z1], 0.06, f));
    out.push(bar([x0, y + h * 0.5, z0], [x1, y + h * 0.5, z1], 0.04, f));
  }
  if (!closed) {
    const [x, z] = pts[pts.length - 1];
    out.push(box(0.06, h, 0.06, f, x, y + h / 2, z));
  }
  return out;
}

/** Points on a circle (for ring rails). */
export function circle(r: number, n: number, cx = 0, cz = 0, a0 = 0, a1 = Math.PI * 2): [number, number][] {
  const out: [number, number][] = [];
  const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-6;
  const steps = full ? n : n - 1;
  for (let i = 0; i < n; i++) {
    const a = a0 + (a1 - a0) * (i / steps);
    out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return out;
}

/** A framed pane on a wall. (x, y, z) is the pane center on the wall face,
 *  ry the wall's outward yaw (0 = facing +z). */
export function pane(w: number, h: number, x: number, y: number, z: number, ry = 0,
  f: Finish = WINDOW): THREE.BufferGeometry[] {
  const s = Math.sin(ry), c = Math.cos(ry);
  return [
    box(w + 0.16, h + 0.16, 0.06, TRIM, x + s * 0.03, y, z + c * 0.03, ry),
    box(w, h, 0.08, f, x + s * 0.05, y, z + c * 0.05, ry),
  ];
}

/** Evenly spaced panes along a wall (a window strip). */
export function windowStrip(len: number, count: number, h: number, x: number, y: number, z: number,
  ry = 0, f: Finish = WINDOW): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const pitch = len / count, w = pitch * 0.72;
  const tx = Math.cos(ry), tz = -Math.sin(ry); // along the wall
  for (let i = 0; i < count; i++) {
    const o = -len / 2 + pitch * (i + 0.5);
    out.push(...pane(w, h, x + tx * o, y, z + tz * o, ry, f));
  }
  return out;
}

/** Panes around a vertical cylinder of radius r (angles in radians, 0 = +x). */
export function windowRing(r: number, y: number, h: number, count: number, w: number,
  a0 = 0, a1 = Math.PI * 2, f: Finish = WINDOW): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-6;
  for (let i = 0; i < count; i++) {
    const a = a0 + (a1 - a0) * ((i + (full ? 0 : 0.5)) / count);
    const ry = Math.PI / 2 - a;
    out.push(...pane(w, h, Math.cos(a) * r, y, Math.sin(a) * r, ry, f));
  }
  return out;
}

/** Airlock/door on a wall facing yaw ry: a recessed leaf in a heavy frame,
 *  a porthole, a work lamp over the lintel and a sill step. */
export function door(x: number, z: number, ry = 0, w = 1.1, h = 2.0, y = 0): THREE.BufferGeometry[] {
  const s = Math.sin(ry), c = Math.cos(ry);
  const tx = Math.cos(ry), tz = -Math.sin(ry);
  const at = (o: number, out: number) => [x + tx * o + s * out, z + tz * o + c * out] as const;
  const [lx, lz] = at(-w / 2 - 0.1, 0.06), [rx, rz] = at(w / 2 + 0.1, 0.06);
  const [cx, cz] = at(0, 0.06), [lpx, lpz] = at(0, 0.22), [sx, sz] = at(0, 0.3);
  return [
    box(0.2, h + 0.2, 0.14, TRIM, lx, y + (h + 0.2) / 2, lz, ry),
    box(0.2, h + 0.2, 0.14, TRIM, rx, y + (h + 0.2) / 2, rz, ry),
    box(w + 0.4, 0.2, 0.14, TRIM, cx, y + h + 0.1, cz, ry),
    box(w, h, 0.06, PLATE, cx, y + h / 2, cz, ry),
    box(0.34, 0.34, 0.08, WINDOW, at(0, 0.1)[0], y + h * 0.72, at(0, 0.1)[1], ry),
    box(0.5, 0.12, 0.3, LAMP, lpx, y + h + 0.32, lpz, ry),
    box(w + 0.3, 0.14, 0.6, TRIM, sx, y + 0.07, sz, ry),
  ];
}

/** Whip antenna with a blinking beacon on top. */
export function antenna(x: number, y: number, z: number, h: number, r = 0.05): THREE.BufferGeometry[] {
  return [
    cyl(r, r * 1.6, h, TRIM, x, y + h / 2, z, 0, 0, 6),
    cyl(r * 3, r * 3, 0.12, TRIM, x, y + 0.06, z, 0, 0, 8),
    dome(0.14, BEACON, x, y + h, z, 8),
  ];
}

/** Stand-off radiator: a matte white ribbed panel on two legs (facing yaw ry). */
export function radiator(w: number, h: number, x: number, y: number, z: number, ry = 0): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [box(w, h, 0.08, RADIATOR, x, y + h / 2, z, ry)];
  const tx = Math.cos(ry), tz = -Math.sin(ry);
  const ribs = Math.max(2, Math.round(w / 0.5));
  for (let i = 0; i <= ribs; i++) {
    const o = -w / 2 + (w * i) / ribs;
    out.push(box(0.05, h, 0.14, TRIM, x + tx * o, y + h / 2, z + tz * o, ry));
  }
  if (y > 0.05) {
    for (const o of [-w / 2 + 0.2, w / 2 - 0.2]) {
      out.push(box(0.12, y, 0.12, TRIM, x + tx * o, y / 2, z + tz * o, ry));
    }
  }
  return out;
}

/** Ground cable tray from a to b ([x, z]) on low trestles. */
export function cableTray(a: readonly [number, number], b: readonly [number, number], y = 0.35): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [bar([a[0], y, a[1]], [b[0], y, b[1]], 0.3, TRIM)];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.round(len / 2));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
    out.push(box(0.08, y, 0.08, TRIM, x, y / 2, z));
  }
  return out;
}

/** Junction box at a footprint edge (where the base's cable network lands). */
export function junction(x: number, z: number, ry = 0): THREE.BufferGeometry[] {
  return [box(0.6, 0.8, 0.4, TRIM, x, 0.4, z, ry), box(0.2, 0.1, 0.1, LAMP, x, 0.7, z + 0.22, ry)];
}

/** Horizontal bands around a vertical cylinder (hoops, stiffeners). */
export function bands(r: number, x: number, z: number, ys: readonly number[], f: Finish = TRIM,
  h = 0.14, seg = 16): THREE.BufferGeometry[] {
  return ys.map((y) => cyl(r + 0.04, r + 0.04, h, f, x, y, z, 0, 0, seg, true));
}

/** Lattice mast: `legs` legs on a circle of radius r (tapering to rTop),
 *  horizontal rings and zig-zag braces every `bay` metres. */
export function lattice(h: number, r: number, rTop: number, x = 0, z = 0, y0 = 0,
  legs = 3, bay = 1.4, f: Finish = TRIM): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const at = (i: number, y: number): [number, number, number] => {
    const rr = r + (rTop - r) * ((y - y0) / h);
    const a = (i / legs) * Math.PI * 2;
    return [x + Math.cos(a) * rr, y, z + Math.sin(a) * rr];
  };
  const bays = Math.max(1, Math.round(h / bay));
  for (let i = 0; i < legs; i++) out.push(bar(at(i, y0), at(i, y0 + h), 0.09, f));
  for (let k = 1; k <= bays; k++) {
    const y = y0 + (h * k) / bays, yp = y0 + (h * (k - 1)) / bays;
    for (let i = 0; i < legs; i++) {
      out.push(bar(at(i, y), at(i + 1, y), 0.05, f));
      out.push(bar(at(i, yp), at(i + 1, y), 0.04, f));
    }
  }
  return out;
}

/** Ladder up a wall facing yaw ry, from y0 to y1. */
export function ladder(x: number, z: number, y0: number, y1: number, ry = 0): THREE.BufferGeometry[] {
  const tx = Math.cos(ry), tz = -Math.sin(ry);
  const out: THREE.BufferGeometry[] = [];
  for (const o of [-0.22, 0.22]) out.push(box(0.05, y1 - y0, 0.05, TRIM, x + tx * o, (y0 + y1) / 2, z + tz * o));
  for (let y = y0 + 0.3; y < y1; y += 0.35) out.push(box(0.44, 0.03, 0.03, TRIM, x, y, z, ry));
  return out;
}

export function merge(parts: (THREE.BufferGeometry | THREE.BufferGeometry[])[]): THREE.BufferGeometry {
  const flat = parts.flat();
  const merged = mergeGeometries(flat, false)!;
  // per-vertex part size, in merge order (not an attribute: no GPU cost)
  const area = new Float32Array(merged.getAttribute('position').count);
  let o = 0;
  for (const p of flat) {
    const n = p.getAttribute('position').count;
    const src = p.userData.partArea as Float32Array | undefined;
    if (src) area.set(src, o);
    else area.fill(p.userData.area ?? 0, o, o + n);
    o += n;
  }
  merged.userData = { partArea: area };
  flat.forEach((p) => p.dispose());
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

export const BUILDING_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.55,
  metalness: 0.15,
});
materials.define('building', BUILDING_MATERIAL, buildingPatch);
/** Shadow-pass twin of the building patch: the same print-reveal cut, so a
 *  half-printed structure casts a half-height shadow. */
export const BUILDING_DEPTH_MATERIAL = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
materials.define('buildingDepth', BUILDING_DEPTH_MATERIAL, buildingDepthPatch);

/** Style-specific extras for every instanced view (the classic palette and
 *  its per-instance light level — buildings/classicBuilding.ts installs it). */
type InstanceHook = (view: THREE.BufferGeometry, src: THREE.BufferGeometry, max: number) => void;
let instanceHook: InstanceHook | null = null;
export function setInstanceHook(hook: InstanceHook | null) {
  instanceHook = hook;
}

/** An instanced view of a shared recipe geometry (same GPU buffers) with its
 *  own per-instance state: iState = (lit, dust, wear, print cut height). */
export function withInstanceState(src: THREE.BufferGeometry, max: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) g.setAttribute(name, attr);
  g.setIndex(src.index);
  g.boundingBox = src.boundingBox?.clone() ?? null;
  g.boundingSphere = src.boundingSphere?.clone() ?? null;
  const st = new Float32Array(max * 4);
  for (let i = 0; i < max; i++) { st[i * 4] = 1; st[i * 4 + 3] = CUT_NONE; }
  g.setAttribute('iState', new THREE.InstancedBufferAttribute(st, 4));
  instanceHook?.(g, src, max);
  return g;
}
