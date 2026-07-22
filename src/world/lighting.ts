/** The lunar lighting rig: one hard white sun (long shadows, black sky) + a
 *  faint blue earthshine hemisphere — the only color in the entire scene —
 *  plus a procedural starfield and a small Earth disc. */
import * as THREE from 'three';
import { mulberry32 } from '../core/rng';

export class Lighting {
  readonly sun: THREE.DirectionalLight;
  readonly earthshine: THREE.HemisphereLight;
  readonly stars: THREE.Points;
  readonly earth: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    scene.background = new THREE.Color(0x000000);

    this.sun = new THREE.DirectionalLight(0xfffdf8, 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = 260;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 1600;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);

    this.earthshine = new THREE.HemisphereLight(0x2a3a55, 0x000000, 0.42);
    scene.add(this.earthshine);

    // starfield: 1800 points on a far sphere
    const rng = mulberry32(0x57a25);
    const starCount = 1800;
    const pos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const u = rng() * 2 - 1;
      const th = rng() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos[i * 3] = r * Math.cos(th) * 3200;
      pos[i * 3 + 1] = Math.abs(u) * 3200 + 60; // keep stars above horizon
      pos[i * 3 + 2] = r * Math.sin(th) * 3200;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0xd7dbe0, size: 2.2, sizeAttenuation: false, fog: false }),
    );
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    // Earth: a small pale-blue disc hanging in the black — home, far away
    this.earth = new THREE.Mesh(
      new THREE.SphereGeometry(48, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0x8fa8c8 }),
    );
    this.earth.position.set(-1400, 950, -2200);
    scene.add(this.earth);
  }

  /** Point the sun from (elevation, azimuth) radians; called per frame. */
  setSun(elev: number, azim: number, focus: THREE.Vector3) {
    const dist = 900;
    const y = Math.sin(elev) * dist;
    const r = Math.cos(elev) * dist;
    this.sun.position.set(
      focus.x + Math.cos(azim) * r,
      Math.max(y, -80),
      focus.z + Math.sin(azim) * r,
    );
    this.sun.target.position.copy(focus);
    // dusk: fade the sun as it sinks; night is earthshine + stars only
    const t = Math.min(1, Math.max(0, (elev + 0.03) / 0.1));
    this.sun.intensity = 3.2 * t;
    this.earthshine.intensity = 0.28 + (1 - t) * 0.16;
  }
}
