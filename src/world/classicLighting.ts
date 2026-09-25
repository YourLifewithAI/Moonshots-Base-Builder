/** The classic style's light: one directional key light and a hemisphere
 *  fill, nothing else — no shadow map, no point lights, no spot lamp, so
 *  every lit program stays the cheapest Lambert three.js has.
 *
 *  Day and night are light colour and intensity, not exposure:
 *    day   — a warm white key from the sun's azimuth, its elevation lifted
 *            into a readable 22–48° band (the game's real sun never climbs
 *            past 32° and grazes at the pole; with no shadows to betray it,
 *            a higher light reads the relief and the buildings better),
 *            golden while the true sun is low, over a cool sky fill and a
 *            warm ground bounce;
 *    night — the key turns into earthshine from Earth's side of the sky
 *            (lifted to ≥ 35°), blue and dim, over a blue-black fill, so
 *            open ground sits well off black and every building still
 *            reads by its lit and shaded faces. The base's own lights (warm
 *            windows, flood discs) carry the rest.
 *
 *  Light levels are in albedo units (1 = the surface's own colour facing
 *  the light); three's lights take them × π. The classic building shader
 *  reads the same values through classicLightUniforms. The true sun
 *  direction still drives the sky, the solar wings and the rover decals. */
import * as THREE from 'three';
import type { SiteDef } from '../data/sites';
import { skyDirection } from './sky';

/** the key and fill as the classic building shader sees them */
export const classicLightUniforms = {
  uLightDir: { value: new THREE.Vector3(0, 1, 0) },
  uLightColor: { value: new THREE.Color(1, 1, 1) },
  uSky: { value: new THREE.Color(0.3, 0.3, 0.3) },
  uGround: { value: new THREE.Color(0.2, 0.2, 0.2) },
};

const DEG = Math.PI / 180;
const SUN_TOP = 0.56;                 // rad: the day arc's peak (core/daynight.ts)
const KEY_LOW = 22 * DEG, KEY_HIGH = 48 * DEG;
const EARTH_MIN = 35 * DEG;
const SUN = new THREE.Color(1.0, 0.97, 0.92).multiplyScalar(1.05);
const GOLDEN = new THREE.Color(1.0, 0.8, 0.58).multiplyScalar(1.0);
const SKY_DAY = new THREE.Color(0.34, 0.37, 0.43);
const GROUND_DAY = new THREE.Color(0.24, 0.215, 0.19);
const EARTH = new THREE.Color(0.16, 0.22, 0.38);
const SKY_NIGHT = new THREE.Color(0.06, 0.085, 0.15);
const GROUND_NIGHT = new THREE.Color(0.018, 0.024, 0.04);
/** on foot at night the eye adapts: key and fill lift this much */
const ADAPT = 0.45;

export class ClassicLighting {
  readonly sun: THREE.DirectionalLight;
  readonly fill: THREE.HemisphereLight;
  /** walk-mode night adaptation, 0..1 (named for the High detail headlamp
   *  it stands in for: probes read `headlamp.intensity`) */
  readonly headlamp = { intensity: 0 };
  /** shadow bookkeeping the High detail rig has; classic draws no shadows */
  readonly shadowTexel: [number, number] = [0, 0];
  readonly shadowRenders = 0;
  groundAlbedo = 0.3;

  private sunDir = new THREE.Vector3(0, 1, 0);
  private keyDir = new THREE.Vector3(0, 1, 0);
  private earthDir = new THREE.Vector3(0, 1, 0);
  private light = 1;
  private c = new THREE.Color();
  private v = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    scene.background = new THREE.Color(0x000000);
    this.sun = new THREE.DirectionalLight(0xffffff, Math.PI);
    this.sun.castShadow = false;
    this.fill = new THREE.HemisphereLight(0xffffff, 0x000000, Math.PI);
    scene.add(this.sun, this.sun.target, this.fill);
  }

  /** Earth's place in this site's sky (the night key comes from there). */
  setSite(site: SiteDef) {
    const e = site.earth;
    skyDirection(Math.max(EARTH_MIN, e.elevDeg * DEG), e.azimDeg * DEG, this.earthDir);
  }

  /** The camera joins the scene, as in High detail (no lamp rides on it). */
  attachHeadlamp(scene: THREE.Scene, camera: THREE.Camera) {
    scene.add(camera);
  }

  /** On foot: `night` 0..1 lifts the night light a little; 0 = off. */
  setHeadlamp(night: number) {
    const k = Math.min(1, Math.max(0, (night - 0.25) / 0.5));
    this.headlamp.intensity = k * k * (3 - 2 * k);
  }

  /** Per frame: the true sun (elevation, azimuth, radians) and 0 day … 1 night. */
  setSun(elev: number, azim: number, nightFactor = 0) {
    skyDirection(elev, azim, this.sunDir);
    this.sunDir.y = Math.max(this.sunDir.y, -0.09);
    this.sunDir.normalize();
    const up = Math.min(1, Math.max(0, (elev + 0.03) / 0.1));
    this.light = up;
    const night = Math.min(1, Math.max(0, nightFactor));
    const adapt = 1 + ADAPT * this.headlamp.intensity * night;

    // the day key: the sun's azimuth, lifted; golden while the sun is low
    const t = Math.min(1, Math.max(0, elev / SUN_TOP));
    skyDirection(KEY_LOW + (KEY_HIGH - KEY_LOW) * t, azim, this.keyDir);
    const warm = Math.min(1, Math.max(0, elev / 0.25));
    const key = this.c.copy(GOLDEN).lerp(SUN, warm).multiplyScalar(up * (1 - night));
    // the night key: earthshine; direction weighted by the two strengths
    const dayW = up * (1 - night), nightW = night * 0.3;
    this.v.copy(this.keyDir).multiplyScalar(dayW).addScaledVector(this.earthDir, nightW);
    if (this.v.lengthSq() < 1e-8) this.v.copy(this.earthDir);
    this.keyDir.copy(this.v.normalize());
    key.r += EARTH.r * night; key.g += EARTH.g * night; key.b += EARTH.b * night;
    key.multiplyScalar(adapt);

    this.sun.color.copy(key);
    this.sun.position.copy(this.keyDir).multiplyScalar(100);
    this.sun.target.position.set(0, 0, 0);
    this.sun.updateMatrixWorld();
    this.fill.color.copy(SKY_DAY).lerp(SKY_NIGHT, night).multiplyScalar(adapt);
    this.fill.groundColor.copy(GROUND_DAY).lerp(GROUND_NIGHT, night).multiplyScalar(adapt);

    const u = classicLightUniforms;
    u.uLightDir.value.copy(this.keyDir);
    u.uLightColor.value.copy(key);
    u.uSky.value.copy(this.fill.color);
    u.uGround.value.copy(this.fill.groundColor);
  }

  /** The sun's light as a fraction of full (0 once it has set). */
  get sunLight(): number { return this.light; }

  /** Unit vector toward the true sun (read-only). */
  get sunDirection(): THREE.Vector3 { return this.sunDir; }

  /** Unit vector toward the key light (sun or earthshine, as drawn). */
  get keyDirection(): THREE.Vector3 { return this.keyDir; }

  // the High detail rig's shadow and work-light hooks: nothing to do here
  requestShadowUpdate() { /* no shadow map */ }
  fitShadow(..._args: unknown[]) { /* no shadow map */ }
  useWorkLights(_on: boolean) { /* flood discs instead (buildings/instances.ts) */ }
  setWorkLights(..._args: unknown[]) { /* flood discs instead */ }
}
