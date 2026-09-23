/** The sky, re-centred on the camera every frame so nothing in it parallaxes:
 *  stars and a faint Milky Way, the sun disc with a restrained glare, and
 *  Earth.
 *
 *  Every piece is a stock unlit material — the sky adds no shader program of
 *  its own, so it draws the same at every FX level and in safe mode. All but
 *  the glare render first in the opaque pass with depth writes off (group
 *  renderOrder −1), so the ground paints over them wherever it stands; the
 *  glare is additive, drawn last, and fades out when terrain hides the sun.
 *
 *  - Stars: magnitudes from N(<m) ∝ 10^0.45m over −1.4…6.5 (≈ ×2.8 per
 *    magnitude), flux 2.512^−m compressed for display, sizes in three pixel
 *    buckets; a third of them crowd a tilted galactic band. No twinkle —
 *    there is no air. Exposure follows the sun: by day they drop to 0.6%
 *    (Apollo film shows none), at night they are full.
 *  - Milky Way: a vertex-coloured back-face sphere, gaussian in galactic
 *    latitude, brightest toward the galactic centre, faded like the stars.
 *  - Sun: a 0.63° disc at ×30 (AgX clips it white, FX-0 bloom catches it)
 *    and a soft additive glare sprite, both faded with the sun's light.
 *  - Earth: a 1.9° sphere whose vertex colours are re-lit from the sun
 *    direction as it moves, so its lit side always faces the sun you see
 *    and the phase follows (crescent near noon, gibbous at night). */
import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { mulberry32, type Rng } from '../core/rng';
import type { SiteDef } from '../data/sites';

const SKY_R = 2900;
const EARTH_DIST = 2800;
const EARTH_R = 46;
const SUN_R = 16;
const SUN_HDR = 30;
const GLARE = 0.5;
const GLARE_M = 700;           // sprite size at SKY_R (~14°)
const DAY_STARS = 0.006;
const MAG_MIN = -1.4, MAG_MAX = 6.5, MAG_K = 0.45;
const FIELD_STARS = 4200, BAND_STARS = 2600;
const BUCKETS = [
  { maxMag: 0.8, size: 2.8 },
  { maxMag: 2.8, size: 1.8 },
  { maxMag: Infinity, size: 1.0 },
];
const EARTH_BLUE = new THREE.Color(0x8fa8c8);
const CLOUD = new THREE.Color(0xdfe6ee);
const OCCLUSION_S = 0.2;

function sampleMag(rng: Rng): number {
  const a = 10 ** (MAG_K * MAG_MIN), b = 10 ** (MAG_K * MAG_MAX);
  return Math.log10(a + rng() * (b - a)) / MAG_K;
}

function gauss(rng: Rng): number {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
}

/** Radial alpha: `fn(r)` over r ∈ 0..1 from the centre. */
function radialTexture(size: number, fn: (r: number) => number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
      const o = (y * size + x) * 4;
      const a = Math.round(Math.min(1, Math.max(0, fn(r))) * 255);
      data[o] = data[o + 1] = data[o + 2] = 255;
      data[o + 3] = a;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Unit direction for (elevation, azimuth) in the scene's sun convention. */
export function skyDirection(elev: number, azim: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(Math.cos(azim) * Math.cos(elev), Math.sin(elev), Math.sin(azim) * Math.cos(elev));
}

export class Sky {
  readonly group = new THREE.Group();
  private starMats: THREE.PointsMaterial[] = [];
  private glowMat: THREE.MeshBasicMaterial;
  private glow: THREE.Mesh;
  private sun: THREE.Mesh;
  private sunMat: THREE.MeshBasicMaterial;
  private glare: THREE.Sprite;
  private earth: THREE.Mesh;
  private earthBase: Float32Array;
  private earthDir = new THREE.Vector3();
  private litFor = new THREE.Vector3();
  private sunDir = new THREE.Vector3(0, 1, 0);
  private site: SiteDef | null = null;
  private safe = false;
  private occludedAt = -Infinity;
  private blocked = false;
  private glareVis = 0;
  private clock = 0;
  /** star exposure last frame, 0.006 (day) … 1 (night) */
  starLevel = 0;

  constructor(scene: THREE.Scene) {
    this.group.renderOrder = -1;
    scene.add(this.group);

    // galactic frame: the band's pole, its centre, and the third axis
    const nG = new THREE.Vector3(0.55, 0.3, -0.78).normalize();
    const top = new THREE.Vector3(0, 1, 0).addScaledVector(nG, -nG.y).normalize();
    const side = new THREE.Vector3().crossVectors(nG, top).normalize();
    const phi = 0.93; // puts the galactic centre ~35° up
    const gC = top.clone().multiplyScalar(Math.cos(phi)).addScaledVector(side, Math.sin(phi));
    const gS = new THREE.Vector3().crossVectors(nG, gC);

    const rng = mulberry32(0x57a25);
    const buckets: number[][][] = BUCKETS.map(() => [[], []]);
    const addStar = (v: THREE.Vector3, mag: number) => {
      const flux = 10 ** (-0.4 * (mag - MAG_MIN));
      const lum = 0.05 + 0.95 * flux ** 0.42;
      const b = BUCKETS.findIndex((k) => mag < k.maxMag);
      buckets[b][0].push(v.x * SKY_R, v.y * SKY_R, v.z * SKY_R);
      const cool = 1 + (rng() - 0.5) * 0.04;
      buckets[b][1].push(lum * 0.86, lum * 0.88, lum * 0.9 * cool);
    };
    const v = new THREE.Vector3();
    for (let i = 0; i < FIELD_STARS; i++) {
      const u = rng() * 2 - 1, th = rng() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      addStar(v.set(r * Math.cos(th), u, r * Math.sin(th)), sampleMag(rng));
    }
    for (let i = 0; i < BAND_STARS; i++) {
      const l = rng() < 0.4 ? gauss(rng) * 0.7 : rng() * Math.PI * 2;
      const b = gauss(rng) * 0.1;
      v.copy(gC).multiplyScalar(Math.cos(l)).addScaledVector(gS, Math.sin(l))
        .multiplyScalar(Math.cos(b)).addScaledVector(nG, Math.sin(b));
      addStar(v, Math.max(3.8, sampleMag(rng)));
    }
    const round = radialTexture(16, (r) => (r < 0.8 ? 1 : 0));
    BUCKETS.forEach((k, i) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(buckets[i][0], 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(buckets[i][1], 3));
      const mat = new THREE.PointsMaterial({
        size: k.size, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false,
        alphaMap: i === 0 ? round : null, alphaTest: i === 0 ? 0.5 : 0,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.renderOrder = -3;
      this.starMats.push(mat);
      this.group.add(pts);
    });

    // Milky Way glow
    const glowGeo = new THREE.SphereGeometry(SKY_R * 1.02, 96, 48);
    const gp = glowGeo.getAttribute('position');
    const gcol = new Float32Array(gp.count * 3);
    const noise = createNoise3D(mulberry32(0x6a1a));
    for (let i = 0; i < gp.count; i++) {
      v.set(gp.getX(i), gp.getY(i), gp.getZ(i)).normalize();
      const b = Math.asin(v.dot(nG));
      const l = Math.atan2(v.dot(gS), v.dot(gC));
      const clump = 0.55 + 0.45 * noise(v.x * 4, v.y * 4, v.z * 4);
      const lane = 1 - 0.45 * Math.exp(-((b / 0.03) ** 2)) * (0.5 + 0.5 * noise(v.x * 9, v.y * 9, v.z * 9));
      const I = 0.018 * Math.exp(-((b / 0.15) ** 2)) * clump * lane * (1 + 1.4 * Math.exp(-((l / 0.8) ** 2)));
      gcol[i * 3] = I * 0.96; gcol[i * 3 + 1] = I * 0.98; gcol[i * 3 + 2] = I;
    }
    glowGeo.setAttribute('color', new THREE.BufferAttribute(gcol, 3));
    this.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false });
    this.glow = new THREE.Mesh(glowGeo, this.glowMat);
    this.glow.frustumCulled = false;
    this.glow.renderOrder = -4;
    this.group.add(this.glow);

    // sun disc + glare
    this.sunMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false, fog: false });
    this.sun = new THREE.Mesh(new THREE.CircleGeometry(SUN_R, 32), this.sunMat);
    this.sun.frustumCulled = false;
    this.sun.renderOrder = -2;
    this.group.add(this.sun);
    this.glare = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialTexture(128, (r) => 0.55 * Math.exp(-((r / 0.06) ** 2)) + 0.45 * Math.max(0, 1 - r) ** 4),
      color: new THREE.Color(1, 0.98, 0.95), blending: THREE.AdditiveBlending,
      depthTest: false, depthWrite: false, transparent: true, fog: false,
    }));
    this.glare.scale.setScalar(GLARE_M);
    this.glare.renderOrder = 30;
    this.glare.frustumCulled = false;
    this.group.add(this.glare);

    // Earth: static albedo (blue with drifting cloud), re-lit per sun move
    const earthGeo = new THREE.SphereGeometry(EARTH_R, 48, 24);
    const ep = earthGeo.getAttribute('position');
    this.earthBase = new Float32Array(ep.count * 3);
    const cn = createNoise3D(mulberry32(0xea57));
    const c = new THREE.Color();
    for (let i = 0; i < ep.count; i++) {
      v.set(ep.getX(i), ep.getY(i), ep.getZ(i)).normalize();
      const cloud = Math.max(0, cn(v.x * 2.2, v.y * 2.2, v.z * 2.2) + 0.5 * cn(v.x * 5, v.y * 5, v.z * 5) - 0.1);
      c.copy(EARTH_BLUE).lerp(CLOUD, Math.min(0.6, cloud * 0.55));
      this.earthBase[i * 3] = c.r; this.earthBase[i * 3 + 1] = c.g; this.earthBase[i * 3 + 2] = c.b;
    }
    earthGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(ep.count * 3), 3));
    this.earth = new THREE.Mesh(earthGeo, new THREE.MeshBasicMaterial({ vertexColors: true, depthWrite: false, fog: false }));
    this.earth.frustumCulled = false;
    this.earth.renderOrder = -1;
    this.group.add(this.earth);
  }

  setSite(site: SiteDef) {
    this.site = site;
    this.litFor.set(0, 0, 0);
  }

  /** Safe mode drops the two blended layers; stars, sun and Earth stay. */
  setSafe(on: boolean) {
    this.safe = on;
  }

  /** Per frame, after the camera has moved. `sunLight` is the sun's light
   *  fraction (0 set … 1 up); `groundAt` answers terrain height anywhere. */
  update(camera: THREE.Camera, sunElev: number, sunAzim: number, sunLight: number, tCycle: number,
    dt: number, groundAt: (x: number, z: number) => number) {
    this.clock += dt;
    this.group.position.copy(camera.position);
    skyDirection(sunElev, sunAzim, this.sunDir);

    const dark = 1 - sunLight;
    this.starLevel = DAY_STARS + (1 - DAY_STARS) * dark * dark;
    for (const m of this.starMats) m.color.setScalar(this.starLevel);
    this.glowMat.color.setScalar(dark * dark);
    this.glow.visible = !this.safe && dark > 0.05;

    this.sun.visible = sunLight > 0;
    this.sun.position.copy(this.sunDir).multiplyScalar(SKY_R);
    this.sun.quaternion.copy(camera.quaternion);
    this.sunMat.color.setScalar(SUN_HDR * sunLight);

    if (this.clock - this.occludedAt > OCCLUSION_S) {
      this.occludedAt = this.clock;
      this.blocked = sunLight > 0 && this.sunBlocked(camera.position, groundAt);
    }
    const target = this.safe || this.blocked ? 0 : sunLight;
    this.glareVis += (target - this.glareVis) * Math.min(1, dt * 6);
    this.glare.visible = this.glareVis > 0.003;
    this.glare.position.copy(this.sun.position);
    (this.glare.material as THREE.SpriteMaterial).opacity = GLARE * this.glareVis;

    if (this.site) {
      const e = this.site.earth;
      const elev = (e.elevDeg + e.librationDeg * Math.sin(2 * Math.PI * tCycle)) * Math.PI / 180;
      skyDirection(elev, e.azimDeg * Math.PI / 180, this.earthDir);
      this.earth.position.copy(this.earthDir).multiplyScalar(EARTH_DIST);
      if (this.sunDir.dot(this.litFor) < 0.9999996) this.relightEarth();
    }
  }

  private relightEarth() {
    this.litFor.copy(this.sunDir);
    const geo = this.earth.geometry;
    const n = geo.getAttribute('normal');
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    const out = col.array as Float32Array;
    const s = this.sunDir;
    for (let i = 0; i < n.count; i++) {
      const lambert = Math.max(0, n.getX(i) * s.x + n.getY(i) * s.y + n.getZ(i) * s.z);
      const k = 1.25 * lambert + 0.02;
      out[i * 3] = this.earthBase[i * 3] * k;
      out[i * 3 + 1] = this.earthBase[i * 3 + 1] * k;
      out[i * 3 + 2] = this.earthBase[i * 3 + 2] * k;
    }
    col.needsUpdate = true;
  }

  /** March from the eye toward the sun over the terrain (map and ring). */
  private sunBlocked(o: THREE.Vector3, groundAt: (x: number, z: number) => number): boolean {
    const d = this.sunDir;
    for (let t = 2; t < 14_000; t = t * 1.07 + 1) {
      const x = o.x + d.x * t, z = o.z + d.z * t;
      if (o.y + d.y * t < groundAt(x, z)) return true;
    }
    return false;
  }

  /** Probe/test view of the sky state. */
  info() {
    return {
      starLevel: this.starLevel,
      sunVisible: this.sun.visible,
      glare: this.glareVis,
      sunBlocked: this.blocked,
      // lit fraction of Earth's disc as seen from here: (1 + cos α) / 2
      earthPhase: (1 - this.sunDir.dot(this.earthDir)) / 2,
      earthElevDeg: Math.asin(this.earthDir.y) * 180 / Math.PI,
    };
  }
}
