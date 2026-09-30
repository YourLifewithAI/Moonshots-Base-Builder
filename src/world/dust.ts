/** Regolith ejecta: one Points cloud of grains in pooled emitter slots. Each
 *  live slot's grains are parked in a low puff placed on the CPU (2 px static
 *  grains from the registry's stock points material, world/cel.ts) — no
 *  shader program of its own, so it draws the same everywhere. Safe mode
 *  shows no dust at all. */
import * as THREE from 'three';
import { mulberry32 } from '../core/rng';
import { materials } from './materials';

export const DUST_SLOTS = 20;
const PER_SLOT = 96;
const COUNT = DUST_SLOTS * PER_SLOT;

export interface DustEmitter {
  /** launch point on the ground (world) */
  x: number; y: number; z: number;
  /** share of the slot's grains in flight, 0..1 */
  strength: number;
  /** base launch velocity relative to the emitter, m/s */
  vx: number; vy: number; vz: number;
  /** random horizontal speed added in a random direction, m/s */
  hSpread: number;
  /** random extra upward speed, m/s */
  vSpread: number;
  /** launch height above the ground, m (spoil dropping off a conveyor) */
  h0?: number;
  /** grain size, m */
  size?: number;
  /** the grains' accent (0xRRGGBB): a digging unit's spoil takes its colour; unset = regolith grey */
  tint?: number;
}

/** how far a tinted emitter's grains go toward its accent (the rest stays regolith) */
const TINT_SHARE = 0.75;

export class DustField {
  readonly points: THREE.Points;
  private geo = new THREE.BufferGeometry();
  private pos = new Float32Array(COUNT * 3);
  /** per grain: the slot strength above which it stays hidden (0..1) */
  private gate = new Float32Array(COUNT);
  /** puff offsets per grain (unit hemisphere, flattened) */
  private puff = new Float32Array(COUNT * 3);
  /** per grain drawn: its colour (white = the regolith grey the material gives) */
  private col = new Float32Array(COUNT * 3).fill(1);
  private tmp = new THREE.Color();
  private live: (DustEmitter | null)[] = new Array(DUST_SLOTS).fill(null);
  private shown = 0;

  constructor() {
    const rnd = mulberry32(0xd057);
    for (let i = 0; i < COUNT; i++) {
      rnd(); rnd(); // (the retired GPU path's phase and seed: kept so the puffs lay out as before)
      this.gate[i] = 0.001 + 0.998 * rnd();
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd());
      this.puff.set([Math.cos(a) * r, rnd() * 0.5, Math.sin(a) * r], i * 3);
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.points = new THREE.Points(this.geo, materials.get('dust'));
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    this.points.visible = false;
  }

  /** Per frame. `dt` real seconds (0 while paused); the first DUST_SLOTS
   *  emitters of `list` fly; `light` is the grains' brightness. */
  update(_dt: number, list: readonly DustEmitter[], light: number) {
    let any = false;
    for (let k = 0; k < DUST_SLOTS; k++) {
      const e = list[k] ?? null;
      this.live[k] = e && e.strength > 0 ? e : null;
      if (this.live[k]) any = true;
    }
    const mat = this.points.material as THREE.PointsMaterial;
    mat.color.setScalar(light);
    this.points.visible = any && !materials.safeMode;
    if (!this.points.visible) { this.shown = 0; return; }
    this.placePuffs();
  }

  /** Each live slot's grains parked in a low puff. */
  private placePuffs() {
    let n = 0;
    for (let k = 0; k < DUST_SLOTS; k++) {
      const e = this.live[k];
      if (!e) continue;
      const rh = 0.4 + 0.3 * (e.hSpread + Math.hypot(e.vx, e.vz));
      const rv = 0.3 + 0.35 * (e.vy + e.vSpread);
      // sRGB accent → linear, then part of the way from white
      const c = e.tint === undefined ? null : this.tmp.set(e.tint);
      const r = c ? 1 + (c.r - 1) * TINT_SHARE : 1, g = c ? 1 + (c.g - 1) * TINT_SHARE : 1, b = c ? 1 + (c.b - 1) * TINT_SHARE : 1;
      for (let j = 0; j < PER_SLOT; j++) {
        const i = k * PER_SLOT + j;
        if (this.gate[i] > e.strength) continue;
        this.pos[n * 3] = e.x + this.puff[i * 3] * rh;
        this.pos[n * 3 + 1] = e.y + (e.h0 ?? 0) + this.puff[i * 3 + 1] * rv;
        this.pos[n * 3 + 2] = e.z + this.puff[i * 3 + 2] * rh;
        this.col[n * 3] = r; this.col[n * 3 + 1] = g; this.col[n * 3 + 2] = b;
        n++;
      }
    }
    this.geo.setDrawRange(0, n);
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    this.shown = n;
  }

  /** Emitter and grain counts, and which path draws them (tests, probes). */
  info() {
    return {
      emitters: this.live.filter(Boolean).length,
      grains: this.shown,
      visible: this.points.visible,
      mode: materials.safeMode ? 'none' : 'static',
      material: (this.points.material as THREE.Material).type,
    };
  }
}
