/** Draped build-mode overlays (lines only, so every FX level and safe mode
 *  draw them alike):
 *   - a 4 m cell grid under the placement footprint, fading out past it;
 *   - dashed build-radius rings around every network structure while placing
 *     (`buildRadiusM` where a type defines one, else the Lander/Habitat
 *     radius), so "Too far from habitat network" has an in-world answer;
 *   - corner brackets around the selected structure. */
import * as THREE from 'three';
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { BUILD_RADIUS_M, CELL_M, GRADE_CELLS, MAP_M } from '../data/balance';
import type { GameState } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import { centerOf, footprintRect } from './instances';
import { ghostUniforms } from './ghost';
import type { PlacementProbe } from './placement';

const GRID_MARGIN = 2;     // cells of fading grid beyond the footprint
const LIFT = 0.12;         // m above the ground

type Footprinted = { id: number; type: BuildingId; gx: number; gz: number; rot: number };

/** Build radius of a structure that extends the network, else 0. */
export function networkRadius(type: BuildingId): number {
  const r = BUILDINGS[type].buildRadiusM;
  if (r !== undefined) return r;
  return type === 'lander' || type === 'habitat' ? BUILD_RADIUS_M : 0;
}

export class BaseOverlays {
  readonly group = new THREE.Group();
  private grid: THREE.LineSegments;
  private rings: THREE.LineSegments;
  private bracket: THREE.LineSegments;
  private gridKey = '';
  private ringKey = '';
  private bracketKey = '';

  constructor(private hf: Heightfield) {
    const line = (mat: THREE.LineBasicMaterial | THREE.LineDashedMaterial) => {
      const l = new THREE.LineSegments(new THREE.BufferGeometry(), mat);
      l.frustumCulled = false;
      l.renderOrder = 3;
      l.visible = false;
      this.group.add(l);
      return l;
    };
    this.grid = line(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
    this.rings = line(new THREE.LineDashedMaterial({
      color: 0xe8ebef, transparent: true, opacity: 0.5, dashSize: 2.2, gapSize: 1.6, depthWrite: false,
    }));
    this.bracket = line(new THREE.LineBasicMaterial({
      color: 0xf5f7f9, transparent: true, opacity: 0.9, depthWrite: false,
    }));
  }

  /** Per frame. `probe` is the active placement (null when not placing). */
  update(state: GameState, probe: PlacementProbe | null, ghostVisible: boolean,
    selected: Footprinted | null, sunDir: THREE.Vector3) {
    ghostUniforms.uGhostSun.value.copy(sunDir);
    this.updateGrid(probe && ghostVisible ? probe : null);
    this.updateRings(state, probe);
    this.updateBracket(selected);
  }

  private y(x: number, z: number) { return this.hf.sample(x, z) + LIFT; }

  /** Line from (x0,z0) to (x1,z1), draped every metre; `alpha(x, z)` per vertex. */
  private drape(pos: number[], col: number[] | null, x0: number, z0: number, x1: number, z1: number,
    lift = 0, alpha?: (x: number, z: number) => number) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0)));
    for (let i = 0; i < n; i++) {
      const xa = x0 + (x1 - x0) * (i / n), za = z0 + (z1 - z0) * (i / n);
      const xb = x0 + (x1 - x0) * ((i + 1) / n), zb = z0 + (z1 - z0) * ((i + 1) / n);
      pos.push(xa, this.y(xa, za) + lift, za, xb, this.y(xb, zb) + lift, zb);
      if (col && alpha) col.push(0.95, 0.96, 0.97, alpha(xa, za), 0.95, 0.96, 0.97, alpha(xb, zb));
    }
  }

  private setLines(obj: THREE.LineSegments, pos: number[], col?: number[]) {
    obj.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    if (col) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 4));
    obj.geometry = g;
    obj.visible = pos.length > 0;
  }

  private updateGrid(p: PlacementProbe | null) {
    let w = GRADE_CELLS, d = GRADE_CELLS;
    if (p && p.type !== 'grade') {
      const fp = BUILDINGS[p.type].footprint;
      [w, d] = p.rot % 2 === 0 ? fp : [fp[1], fp[0]];
    }
    const key = p ? `${p.type}:${p.gx},${p.gz},${p.rot}` : '';
    if (key === this.gridKey) return;
    this.gridKey = key;
    if (!p) { this.grid.visible = false; return; }
    const m = GRID_MARGIN;
    const toX = (gx: number) => gx * CELL_M - MAP_M / 2;
    const ax0 = toX(p.gx), ax1 = toX(p.gx + w), az0 = toX(p.gz), az1 = toX(p.gz + d);
    const alpha = (x: number, z: number) => {
      const out = Math.max(ax0 - x, x - ax1, az0 - z, z - az1, 0);
      return 0.5 * Math.max(0, 1 - out / (m * CELL_M));
    };
    const pos: number[] = [], col: number[] = [];
    const x0 = toX(p.gx - m), x1 = toX(p.gx + w + m), z0 = toX(p.gz - m), z1 = toX(p.gz + d + m);
    for (let i = 0; i <= w + 2 * m; i++) {
      const x = toX(p.gx - m + i);
      this.drape(pos, col, x, z0, x, z1, 0, alpha);
    }
    for (let j = 0; j <= d + 2 * m; j++) {
      const z = toX(p.gz - m + j);
      this.drape(pos, col, x0, z, x1, z, 0, alpha);
    }
    this.setLines(this.grid, pos, col);
  }

  private updateRings(state: GameState, p: PlacementProbe | null) {
    const nodes = p ? state.buildings.filter((b) => networkRadius(b.type) > 0) : [];
    const key = nodes.map((b) => `${b.id}:${b.gx},${b.gz}`).join(';');
    if (key === this.ringKey) return;
    this.ringKey = key;
    const pos: number[] = [];
    for (const b of nodes) {
      const [cx, cz] = centerOf(b);
      const r = networkRadius(b.type);
      const n = Math.ceil((2 * Math.PI * r) / 1.5);
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
        const xa = cx + Math.cos(a0) * r, za = cz + Math.sin(a0) * r;
        const xb = cx + Math.cos(a1) * r, zb = cz + Math.sin(a1) * r;
        pos.push(xa, this.y(xa, za) + 0.2, za, xb, this.y(xb, zb) + 0.2, zb);
      }
    }
    this.setLines(this.rings, pos);
    if (pos.length) this.rings.computeLineDistances();
  }

  private updateBracket(b: Footprinted | null) {
    const key = b ? `${b.id}:${b.type}:${b.gx},${b.gz},${b.rot}` : '';
    if (key === this.bracketKey) return;
    this.bracketKey = key;
    if (!b) { this.bracket.visible = false; return; }
    const r = footprintRect(b);
    const pad = 1.2;
    const x0 = r.gx0 * CELL_M - MAP_M / 2 - pad, x1 = r.gx1 * CELL_M - MAP_M / 2 + pad;
    const z0 = r.gz0 * CELL_M - MAP_M / 2 - pad, z1 = r.gz1 * CELL_M - MAP_M / 2 + pad;
    const arm = Math.min(3, 0.3 * Math.min(x1 - x0, z1 - z0));
    const pos: number[] = [];
    for (const [cx, cz, sx, sz] of [[x0, z0, 1, 1], [x1, z0, -1, 1], [x1, z1, -1, -1], [x0, z1, 1, -1]]) {
      this.drape(pos, null, cx, cz, cx + sx * arm, cz, 0.08);
      this.drape(pos, null, cx, cz, cx, cz + sz * arm, 0.08);
    }
    this.setLines(this.bracket, pos);
  }
}
