/** Placement pipeline: heightfield ray → grid snap → validity (occupancy, slope,
 *  build radius, site rules, cost, unlock) → ghost preview → commit action.
 *  Validity is shown by shape/value, never hue: pale ghost = valid,
 *  dark ghost + flat outline = blocked. */
import * as THREE from 'three';
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { BUILD_RADIUS_M, CELL_M, MAP_CELLS, MAP_M, MAX_SLOPE_DELTA } from '../data/balance';
import type { SiteDef } from '../data/sites';
import type { GameState } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import { recipeGeometry } from './recipes';
import { centerOf, footprintRect } from './instances';

export interface PlacementProbe {
  type: BuildingId;
  gx: number; gz: number; rot: 0 | 1 | 2 | 3;
  valid: boolean;
  reason: string;
}

const GHOST_VALID = new THREE.MeshBasicMaterial({
  color: 0xf5f7f9, transparent: true, opacity: 0.42, depthWrite: false,
});
const GHOST_BLOCKED = new THREE.MeshBasicMaterial({
  color: 0x14161a, transparent: true, opacity: 0.6, depthWrite: false,
});

export function buildCost(type: BuildingId, site: SiteDef): Partial<Record<string, number>> {
  const out: Partial<Record<string, number>> = {};
  for (const [rid, amt] of Object.entries(BUILDINGS[type].buildCost)) {
    out[rid] = Math.ceil(amt * site.buildCostMult);
  }
  return out;
}

export class PlacementController {
  ghost: THREE.Mesh | null = null;
  probe: PlacementProbe | null = null;
  private outline: THREE.LineSegments;

  constructor(
    private scene: THREE.Scene,
    private hf: Heightfield,
    private site: SiteDef,
  ) {
    this.outline = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xf5f7f9, transparent: true, opacity: 0.6 }),
    );
    this.outline.visible = false;
    scene.add(this.outline);
  }

  begin(type: BuildingId) {
    this.cancel();
    this.ghost = new THREE.Mesh(recipeGeometry(type), GHOST_VALID);
    this.ghost.visible = false;
    this.scene.add(this.ghost);
    this.probe = { type, gx: 0, gz: 0, rot: 0, valid: false, reason: '' };
  }

  rotate() {
    if (this.probe) this.probe.rot = ((this.probe.rot + 1) % 4) as 0 | 1 | 2 | 3;
  }

  cancel() {
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    this.outline.visible = false;
    this.probe = null;
  }

  get active(): boolean { return this.probe !== null; }

  /** Update ghost to the terrain point under the given world ray. */
  update(state: GameState, unlocked: Set<BuildingId>, origin: THREE.Vector3, dir: THREE.Vector3) {
    if (!this.probe || !this.ghost) return;
    const hit = this.hf.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z);
    if (!hit) { this.ghost.visible = false; this.outline.visible = false; return; }
    const def = BUILDINGS[this.probe.type];
    const [w, d] = this.probe.rot % 2 === 0 ? def.footprint : [def.footprint[1], def.footprint[0]];
    this.probe.gx = Math.round((hit[0] + MAP_M / 2) / CELL_M - w / 2);
    this.probe.gz = Math.round((hit[2] + MAP_M / 2) / CELL_M - d / 2);
    this.validate(state, unlocked);

    const [cx, cz] = centerOf(this.probe);
    const y = this.hf.sample(cx, cz);
    this.ghost.position.set(cx, y, cz);
    this.ghost.rotation.y = -this.probe.rot * Math.PI / 2;
    this.ghost.material = this.probe.valid ? GHOST_VALID : GHOST_BLOCKED;
    this.ghost.visible = true;
    this.updateOutline(w, d, cx, cz, y);
  }

  private updateOutline(w: number, d: number, cx: number, cz: number, y: number) {
    const hw = (w * CELL_M) / 2, hd = (d * CELL_M) / 2;
    const pts: number[] = [];
    const seg = 8;
    const edge = (x0: number, z0: number, x1: number, z1: number) => {
      for (let i = 0; i < seg; i++) {
        const t0 = i / seg, t1 = (i + 1) / seg;
        const xa = x0 + (x1 - x0) * t0, za = z0 + (z1 - z0) * t0;
        const xb = x0 + (x1 - x0) * t1, zb = z0 + (z1 - z0) * t1;
        pts.push(xa, this.hf.sample(xa, za) + 0.15, za, xb, this.hf.sample(xb, zb) + 0.15, zb);
      }
    };
    edge(cx - hw, cz - hd, cx + hw, cz - hd);
    edge(cx + hw, cz - hd, cx + hw, cz + hd);
    edge(cx + hw, cz + hd, cx - hw, cz + hd);
    edge(cx - hw, cz + hd, cx - hw, cz - hd);
    this.outline.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    this.outline.geometry = g;
    this.outline.visible = true;
  }

  validate(state: GameState, unlocked: Set<BuildingId>): boolean {
    const p = this.probe!;
    const res = checkPlacement(state, this.site, this.hf, unlocked, p.type, p.gx, p.gz, p.rot);
    p.valid = res.valid;
    p.reason = res.reason;
    return p.valid;
  }
}

/** Standalone validity check — shared by the ghost controller, the action
 *  handler, and the debug API. */
export function checkPlacement(
  state: GameState,
  site: SiteDef,
  hf: Heightfield,
  unlocked: Set<BuildingId>,
  type: BuildingId,
  gx: number,
  gz: number,
  rot: 0 | 1 | 2 | 3,
): { valid: boolean; reason: string } {
  const def = BUILDINGS[type];
  const probe = { type, gx, gz, rot };
  const r = footprintRect(probe);
  if (!unlocked.has(type)) return { valid: false, reason: 'Locked — research required' };
  if (r.gx0 < 1 || r.gz0 < 1 || r.gx1 > MAP_CELLS - 1 || r.gz1 > MAP_CELLS - 1) {
    return { valid: false, reason: 'Outside survey area' };
  }
  if (def.requiresIce && !site.hasIce) return { valid: false, reason: 'No ice deposits at this site' };
  const [cx, cz] = centerOf(probe);
  if (site.buildableRadiusM > 0 && Math.hypot(cx, cz) > site.buildableRadiusM) {
    return { valid: false, reason: 'Beyond the lava tube footprint' };
  }
  for (const b of state.buildings) {
    const o = footprintRect(b);
    if (r.gx0 < o.gx1 && r.gx1 > o.gx0 && r.gz0 < o.gz1 && r.gz1 > o.gz0) {
      return { valid: false, reason: 'Overlaps a structure' };
    }
  }
  if (hf.maxDelta(r.gx0, r.gz0, r.gx1, r.gz1) > MAX_SLOPE_DELTA) {
    return { valid: false, reason: 'Terrain too rough' };
  }
  let near = state.buildings.length === 0;
  for (const b of state.buildings) {
    if (b.type !== 'lander' && b.type !== 'habitat') continue;
    const [bx, bz] = centerOf(b);
    if (Math.hypot(cx - bx, cz - bz) <= BUILD_RADIUS_M) { near = true; break; }
  }
  if (!near) return { valid: false, reason: 'Too far from habitat network' };
  for (const [rid, amt] of Object.entries(buildCost(type, site))) {
    if (state.resources[rid as keyof typeof state.resources] < (amt ?? 0)) {
      return { valid: false, reason: 'Insufficient resources' };
    }
  }
  return { valid: true, reason: '' };
}
