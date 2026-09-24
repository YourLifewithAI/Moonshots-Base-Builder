/** Placement pipeline: heightfield ray → grid snap → validity (occupancy, slope,
 *  the build network, site and deposit rules, cost, unlock) → ghost preview → commit action.
 *  Validity is shown by value/pattern, never hue: pale lit ghost = valid,
 *  dark hatched ghost = blocked (buildings/ghost.ts). */
import * as THREE from 'three';
import { BUILDINGS, type BuildingId } from '../data/buildings';
import {
  CELL_M, GRADE_CELLS, GRADE_COST_ENERGY, MAP_CELLS, MAP_M,
  MAX_SLOPE_DELTA, MAX_SLOPE_LARGE,
} from '../data/balance';
import type { SiteDef } from '../data/sites';
import { TECHS } from '../data/techs';
import { DEPOSIT_INFO } from '../data/deposits';
import type { BuildingState, GameState } from '../core/state';
import type { SurveyTier } from '../core/mods';
import { beyondNetwork, depositRevealed, groundMapped, inNetwork } from '../core/exploration';
import type { Heightfield } from '../terrain/heightfield';
import { ghostGeometry } from './recipes';
import { centerOf, footprintRect } from './instances';
import { createGhost, setGhostBlocked } from './ghost';

export type PlaceableType = BuildingId | 'grade';

export interface PlacementProbe {
  type: PlaceableType;
  gx: number; gz: number; rot: 0 | 1 | 2 | 3;
  valid: boolean;
  reason: string;
  /** soft warning on a valid placement ('' = none) */
  warn: string;
  /** the revealed deposit under the footprint centre, as a ghost line ('' = none) */
  note: string;
}

export function buildCost(type: BuildingId, site: SiteDef): Partial<Record<string, number>> {
  const out: Partial<Record<string, number>> = {};
  for (const [rid, amt] of Object.entries(BUILDINGS[type].buildCost)) {
    out[rid] = Math.ceil(amt * site.buildCostMult);
  }
  return out;
}

/** Before any smelter exists, a placement that would leave too few metals to
 *  build one — without it there is no making more. A soft warning, never a block. */
export function smelterWarning(state: GameState, site: SiteDef, type: BuildingId): string {
  if (type === 'smelter' || state.buildings.some((b) => b.type === 'smelter')) return '';
  const cost = buildCost(type, site).metals ?? 0;
  if (cost <= 0) return '';
  const smelter = buildCost('smelter', site).metals ?? 0;
  const left = Math.floor(state.resources.metals - cost);
  return left < smelter ? `Leaves ${left}◆ — a Smelter needs ${smelter}◆` : '';
}

/** a site no robot has welded on yet: demolishing it cancels the order */
export function untouchedSite(b: BuildingState): boolean {
  return b.buildTotal > 0 && (b.construction ?? 0) >= b.buildTotal;
}

/** what demolition returns: half the site-scaled price paid, or all of it
 *  for an untouched site */
export function demolishRefund(b: BuildingState, site: SiteDef): Partial<Record<string, number>> {
  const full = untouchedSite(b);
  const out: Partial<Record<string, number>> = {};
  for (const [rid, amt] of Object.entries(buildCost(b.type, site))) {
    out[rid] = full ? amt : Math.floor((amt ?? 0) * 0.5);
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

  begin(type: PlaceableType) {
    this.cancel();
    const geo = type === 'grade'
      ? new THREE.PlaneGeometry(GRADE_CELLS * CELL_M, GRADE_CELLS * CELL_M).rotateX(-Math.PI / 2).translate(0, 0.25, 0)
      : ghostGeometry(type);
    this.ghost = createGhost(geo);
    this.ghost.visible = false;
    this.scene.add(this.ghost);
    this.probe = { type, gx: 0, gz: 0, rot: 0, valid: false, reason: '', warn: '', note: '' };
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
  update(state: GameState, unlocked: Set<BuildingId>, origin: THREE.Vector3, dir: THREE.Vector3, tier: SurveyTier = 0) {
    if (!this.probe || !this.ghost) return;
    const hit = this.hf.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z);
    if (!hit) { this.ghost.visible = false; this.outline.visible = false; return; }
    let w: number, d: number;
    if (this.probe.type === 'grade') {
      w = GRADE_CELLS; d = GRADE_CELLS;
    } else {
      const def = BUILDINGS[this.probe.type];
      [w, d] = this.probe.rot % 2 === 0 ? def.footprint : [def.footprint[1], def.footprint[0]];
    }
    this.probe.gx = Math.round((hit[0] + MAP_M / 2) / CELL_M - w / 2);
    this.probe.gz = Math.round((hit[2] + MAP_M / 2) / CELL_M - d / 2);
    this.validate(state, unlocked, tier);

    const [cx, cz] = this.probe.type === 'grade'
      ? gradeCenter(this.probe.gx, this.probe.gz)
      : centerOf(this.probe as { type: BuildingId; gx: number; gz: number; rot: number });
    const y = this.hf.sample(cx, cz);
    this.ghost.position.set(cx, y, cz);
    this.ghost.rotation.y = -this.probe.rot * Math.PI / 2;
    setGhostBlocked(this.ghost, !this.probe.valid);
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

  validate(state: GameState, unlocked: Set<BuildingId>, tier: SurveyTier = 0): boolean {
    const p = this.probe!;
    const res: { valid: boolean; reason: string; warn?: string; note?: string } = p.type === 'grade'
      ? checkGrade(state, this.hf, p.gx, p.gz)
      : checkPlacement(state, this.site, this.hf, unlocked, p.type, p.gx, p.gz, p.rot, tier);
    p.valid = res.valid;
    p.reason = res.reason;
    p.warn = res.warn ?? '';
    p.note = res.note ?? '';
    return p.valid;
  }
}

function gradeCenter(gx: number, gz: number): [number, number] {
  return [
    (gx + GRADE_CELLS / 2) * CELL_M - MAP_M / 2,
    (gz + GRADE_CELLS / 2) * CELL_M - MAP_M / 2,
  ];
}

/** Grading validity: in bounds, inside the build network, no structure on top,
 *  and enough stored energy for the dozer pass. */
export function checkGrade(
  state: GameState,
  hf: Heightfield,
  gx: number,
  gz: number,
): { valid: boolean; reason: string } {
  const gx1 = gx + GRADE_CELLS, gz1 = gz + GRADE_CELLS;
  if (gx < 1 || gz < 1 || gx1 > MAP_CELLS - 1 || gz1 > MAP_CELLS - 1) {
    return { valid: false, reason: 'Outside survey area' };
  }
  const [cx, cz] = gradeCenter(gx, gz);
  for (const b of state.buildings) {
    const o = footprintRect(b);
    if (gx < o.gx1 && gx1 > o.gx0 && gz < o.gz1 && gz1 > o.gz0) {
      return { valid: false, reason: 'A structure is in the way' };
    }
  }
  if (state.buildings.length > 0 && !inNetwork(state, cx, cz)) return { valid: false, reason: beyondNetwork(state) };
  if (state.powerStored < GRADE_COST_ENERGY) {
    return { valid: false, reason: `Need ${GRADE_COST_ENERGY} stored energy — have ${Math.floor(state.powerStored)}` };
  }
  return { valid: true, reason: '' };
}

/** Footprints of this many cells (and the mass driver) are large pads. */
const LARGE_PAD_CELLS = 9;

/** Large pads need gentle ground; the fix is Site Grading where it exists. */
function largePadRefusal(type: BuildingId, cells: number, relief: number, site: SiteDef): string {
  if (cells < LARGE_PAD_CELLS && type !== 'massDriver') return '';
  if (relief <= MAX_SLOPE_LARGE) return '';
  const grading = TECHS.siteGrading;
  const fix = !grading.sites || grading.sites.includes(site.id) ? `grade it (${grading.name})` : 'find flatter ground';
  // rounded up, so a refusal never reads '0.8 m > 0.8 m'
  return `Too rough for a large pad (${(Math.ceil(relief * 10) / 10).toFixed(1)} m relief > ${MAX_SLOPE_LARGE} m) — ${fix}`;
}

/** Standalone validity check — shared by the ghost controller, the action
 *  handler, and the debug API. A valid placement may carry a soft warning,
 *  and a note naming the revealed deposit under its centre. `tier` is the
 *  survey tier (what ground is mapped). */
export function checkPlacement(
  state: GameState,
  site: SiteDef,
  hf: Heightfield,
  unlocked: Set<BuildingId>,
  type: BuildingId,
  gx: number,
  gz: number,
  rot: 0 | 1 | 2 | 3,
  tier: SurveyTier = 0,
): { valid: boolean; reason: string; warn?: string; note?: string } {
  const def = BUILDINGS[type];
  const probe = { type, gx, gz, rot };
  const r = footprintRect(probe);
  if (!unlocked.has(type)) return { valid: false, reason: 'Locked — research required' };
  if (r.gx0 < 1 || r.gz0 < 1 || r.gx1 > MAP_CELLS - 1 || r.gz1 > MAP_CELLS - 1) {
    return { valid: false, reason: 'Outside survey area' };
  }
  if (def.requiresIce && !site.hasIce) return { valid: false, reason: 'No ice deposits at this site' };
  const [cx, cz] = centerOf(probe);
  const dep = hf.depositAt(cx, cz);
  const known = dep && depositRevealed(state, dep, tier) ? dep : null;
  if (def.requiresIce && known?.kind !== 'ice') {
    // unmapped ground says nothing either way, so the ghost never hints at hidden ice
    return groundMapped(state, cx, cz, tier)
      ? { valid: false, reason: 'No ice beneath this spot — check the deposit overlay [I]' }
      : { valid: false, reason: 'ICE UNCONFIRMED — extend your survey (Prospecting Rovers) or place a Relay Mast nearby' };
  }
  if (type === 'habitat' && dep?.kind === 'kreep') {
    return { valid: false, reason: 'RADIATION — KREEP soil: no habitats here' };
  }
  if (site.buildableRadiusM > 0 && Math.hypot(cx, cz) > site.buildableRadiusM) {
    return { valid: false, reason: 'Beyond the lava tube footprint' };
  }
  for (const b of state.buildings) {
    const o = footprintRect(b);
    if (r.gx0 < o.gx1 && r.gx1 > o.gx0 && r.gz0 < o.gz1 && r.gz1 > o.gz0) {
      return { valid: false, reason: 'Overlaps a structure' };
    }
  }
  const relief = hf.maxDelta(r.gx0, r.gz0, r.gx1, r.gz1);
  const large = largePadRefusal(type, r.w * r.d, relief, site);
  if (large) return { valid: false, reason: large };
  if (relief > MAX_SLOPE_DELTA) {
    return { valid: false, reason: 'Terrain too rough' };
  }
  if (state.buildings.length > 0 && !inNetwork(state, cx, cz)) return { valid: false, reason: beyondNetwork(state) };
  for (const [rid, amt] of Object.entries(buildCost(type, site))) {
    const have = state.resources[rid as keyof typeof state.resources];
    if (have < (amt ?? 0)) {
      return { valid: false, reason: `Need ${amt} ${rid} — have ${Math.floor(have)}` };
    }
  }
  return { valid: true, reason: '', warn: smelterWarning(state, site, type), note: known ? DEPOSIT_INFO[known.kind].ghost : '' };
}
