/** The cel style's light: one directional key light and a hemisphere
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
 *            windows, flood pools) carry the rest.
 *
 *  Light levels are in albedo units (1 = the surface's own colour facing
 *  the light); three's lights take them × π. The cel building shader
 *  reads the same values through celLightUniforms. The true sun
 *  direction still drives the solar wings and the rover decals. */
import * as THREE from 'three';
import type { SiteDef } from '../data/sites';
import { skyDirection } from '../core/daynight';
import { GROUND_RAMP, ramp } from './celStyle';

const SUN_STEP_RAD = 0.1 * Math.PI / 180; // re-aim once the sun turns 0.1° (up to 3×)

/** The sun turn (as a cosine) that re-aims the solar wings: 0.1° up to 3×
 *  speed, growing with speed past that — so the sweep costs about as many
 *  re-aims a second at 10× as at 3×. */
export function sunStep(speed: number): number {
  return Math.cos(SUN_STEP_RAD * Math.max(1, speed / 3));
}

/** the light as the cel programs see it (the building shader and the ground's
 *  own, world/celSurface.ts): the key, the fill, the colour a face at the top
 *  step wears (`uLightFull`, albedo units) and the ramp that steps it. */
export const celLightUniforms = {
  uLightDir: { value: new THREE.Vector3(0, 1, 0) },
  uLightColor: { value: new THREE.Color(1, 1, 1) },
  uSky: { value: new THREE.Color(0.3, 0.3, 0.3) },
  uGround: { value: new THREE.Color(0.2, 0.2, 0.2) },
  uLightFull: { value: new THREE.Color(1, 1, 1) },
  /** the building ramp: the levels (brightest first; a 2-step ramp repeats its last) and where they begin */
  uRamp: { value: new THREE.Vector3(1, 0.72, 0.5) },
  uRampEdge: { value: new THREE.Vector2(0.3, -0.15) },
  uRampSoft: { value: 0.02 },
  /** the ground ramp: the shaded step's level and how far a face turns (n·l) before it wears it */
  uGroundRamp: { value: new THREE.Vector2(GROUND_RAMP.shade, GROUND_RAMP.drop) },
};

{
  // the variant's ramp (celStyle.ts, `?cel=`) into the uniforms, once
  const r = ramp();
  const lv = r.levels;
  celLightUniforms.uRamp.value.set(lv[0], lv[1], lv[lv.length - 1]);
  celLightUniforms.uRampEdge.value.set(r.edges[0], r.edges.length > 1 ? r.edges[1] : -2);
  celLightUniforms.uRampSoft.value = r.soft;
}

/** what a face at the top step wears: the key and a share of the fill (so a
 *  noon roof shows its own colour, and dusk and earthshine dim it) */
const KEY_SHARE = 0.85, FILL_SHARE = 0.35;

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
/** the clear colour is the sky: a deep dusk blue by day, near-black by night
 *  (no dome and no stars; what the camera never sees needs no more) */
const SKY_CLEAR_DAY = new THREE.Color(0x101828);
const SKY_CLEAR_NIGHT = new THREE.Color(0x04060b);

export class CelLighting {
  readonly sun: THREE.DirectionalLight;
  readonly fill: THREE.HemisphereLight;

  /** the scene's clear colour */
  private readonly clear: THREE.Color;
  private sunDir = new THREE.Vector3(0, 1, 0);
  private keyDir = new THREE.Vector3(0, 1, 0);
  private earthDir = new THREE.Vector3(0, 1, 0);
  private light = 1;
  private c = new THREE.Color();
  private v = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.clear = new THREE.Color().copy(SKY_CLEAR_DAY);
    scene.background = this.clear;
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

  /** Per frame: the true sun (elevation, azimuth, radians) and 0 day … 1 night. */
  setSun(elev: number, azim: number, nightFactor = 0) {
    skyDirection(elev, azim, this.sunDir);
    this.sunDir.y = Math.max(this.sunDir.y, -0.09);
    this.sunDir.normalize();
    const up = Math.min(1, Math.max(0, (elev + 0.03) / 0.1));
    this.light = up;
    const night = Math.min(1, Math.max(0, nightFactor));

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

    this.sun.color.copy(key);
    this.sun.position.copy(this.keyDir).multiplyScalar(100);
    this.sun.target.position.set(0, 0, 0);
    this.sun.updateMatrixWorld();
    this.clear.copy(SKY_CLEAR_DAY).lerp(SKY_CLEAR_NIGHT, Math.max(night, 1 - up));
    this.fill.color.copy(SKY_DAY).lerp(SKY_NIGHT, night);
    this.fill.groundColor.copy(GROUND_DAY).lerp(GROUND_NIGHT, night);

    const u = celLightUniforms;
    u.uLightDir.value.copy(this.keyDir);
    u.uLightColor.value.copy(key);
    u.uSky.value.copy(this.fill.color);
    u.uGround.value.copy(this.fill.groundColor);
    const f = this.fill.color;
    u.uLightFull.value.setRGB(key.r * KEY_SHARE + f.r * FILL_SHARE, key.g * KEY_SHARE + f.g * FILL_SHARE, key.b * KEY_SHARE + f.b * FILL_SHARE);
  }

  /** The sun's light as a fraction of full (0 once it has set). */
  get sunLight(): number { return this.light; }

  /** Unit vector toward the true sun (read-only). */
  get sunDirection(): THREE.Vector3 { return this.sunDir; }

  /** Unit vector toward the key light (sun or earthshine, as drawn). */
  get keyDirection(): THREE.Vector3 { return this.keyDir; }
}
