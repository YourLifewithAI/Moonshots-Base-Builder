/** The grading tool (docs/19 S5): the palette's GRADE button.
 *
 *   - press on the ground and drag: a rectangle of cells, previewed with its size, the rover-seconds
 *     and stored energy it takes and any refusal; release queues it (`gradeBox`), a job the rovers
 *     level cell by cell (core/grading.ts);
 *   - a click without a drag: the 16 m square (4×4 cells) centred on the cell (what the old one-click
 *     tool graded);
 *   - the tool stays on for the next box; right-click or Esc stops.
 *
 *  Nothing moves until a rover gets there; a queued job can be cancelled from the fleet panel
 *  (it refunds the cells not yet levelled). The hint above the palette ($gradeTool) says what a
 *  release would do. */
import * as THREE from 'three';
import type { Action } from '../core/actions';
import type { GameState } from '../core/state';
import type { Mods } from '../core/mods';
import type { Heightfield } from '../terrain/heightfield';
import { GRADE_CELLS, MAP_CELLS } from '../data/balance';
import { cellAt } from '../core/roads';
import { gradePlan, rectBetween, squareAt, type GradePlan, type GradeRect } from '../core/grading';
import { CellPreview } from '../buildings/cellPreview';
import { gradeOutline } from '../world/gradeMarks';
import { $gradeTool, $placeFlash } from '../ui/stores';
import { sfx } from '../audio/sfx';

export interface GradeToolHost {
  state(): GameState;
  mods(): Mods;
  hf: Heightfield;
  /** the ray under the cursor */
  ray(): THREE.Ray;
  push(a: Action): void;
  /** hold the camera still while a drag draws */
  holdCamera(on: boolean): void;
}

type Cell = [number, number];

export class GradeTool {
  active = false;
  private start: Cell | null = null;
  private dragging = false;
  private preview: CellPreview;
  private outline: THREE.Line | null = null;
  private outlineKey = '';
  private last = '';
  /** the plan the box under the cursor would be (probes) */
  plan: GradePlan | null = null;

  constructor(private host: GradeToolHost, private scene: THREE.Scene) {
    this.preview = new CellPreview(scene, host.hf);
  }

  begin() {
    this.active = true;
    this.start = null;
    this.dragging = false;
    this.last = '';
    this.publish(null);
  }

  cancel() {
    if (!this.active) return;
    this.active = false;
    this.start = null;
    this.dragging = false;
    this.host.holdCamera(false);
    this.hide();
    $gradeTool.set(null);
  }

  private hide() {
    this.preview.hide();
    this.setOutline(null);
    this.plan = null;
  }

  /** the cell under the cursor */
  private cursor(): Cell | null {
    const r = this.host.ray();
    const hit = this.host.hf.raycast(r.origin.x, r.origin.y, r.origin.z, r.direction.x, r.direction.y, r.direction.z);
    return hit ? cellAt(hit[0], hit[2]) : null;
  }

  /** The box a drag from `a` to `b` marks (a plain click: the square centred on the cell). */
  private rectFor(a: Cell, b: Cell): GradeRect {
    if (a[0] === b[0] && a[1] === b[1]) {
      const gx = Math.max(1, Math.min(MAP_CELLS - 1 - GRADE_CELLS, a[0] - GRADE_CELLS / 2));
      const gz = Math.max(1, Math.min(MAP_CELLS - 1 - GRADE_CELLS, a[1] - GRADE_CELLS / 2));
      return squareAt(gx, gz);
    }
    return rectBetween(a, b);
  }

  /** Left button down: the box's first corner. */
  down() {
    const c = this.cursor();
    if (!c) return;
    this.start = c;
    this.dragging = true;
    this.host.holdCamera(true);
  }

  /** Left button up: queue the box (refused: the hint says why, the radio blips). */
  up() {
    this.host.holdCamera(false);
    if (!this.start) return;
    const c = this.cursor() ?? this.start;
    const rect = this.rectFor(this.start, c);
    const plan = gradePlan(this.host.state(), this.host.hf, this.host.mods(), rect);
    this.dragging = false;
    this.start = null;
    this.last = '';
    if (!plan.ok) { $placeFlash.set($placeFlash.get() + 1); sfx.play('invalid'); return; }
    this.host.push({ kind: 'gradeBox', gx0: rect[0], gz0: rect[1], gx1: rect[2], gz1: rect[3] });
    this.hide();
  }

  /** Per frame while active: the box under the cursor, previewed. */
  update() {
    if (!this.active) return;
    const c = this.cursor();
    const s = this.host.state();
    const key = `${c?.join(',')}|${this.start?.join(',')}|${s.powerStored | 0}|${(s.gradeJobs ?? []).length}|${this.host.mods().grading}`;
    if (key === this.last) return;
    this.last = key;
    if (!c) { this.hide(); this.publish(null); return; }
    // before a press the cursor's own square shows (a click grades it); a press shows the drag
    const rect = this.rectFor(this.start ?? c, c);
    const plan = gradePlan(s, this.host.hf, this.host.mods(), rect);
    this.plan = plan;
    const cells = plan.order;
    this.preview.show(cells.length && cells.length <= 512 ? cells : undefined, !plan.ok);
    this.setOutline(plan.cells > 0 ? rect : null);
    this.publish(plan);
  }

  private setOutline(rect: GradeRect | null) {
    const key = rect ? rect.join(',') : '';
    if (key === this.outlineKey) return;
    this.outlineKey = key;
    if (this.outline) {
      this.scene.remove(this.outline);
      this.outline.geometry.dispose();
      (this.outline.material as THREE.Material).dispose();
      this.outline = null;
    }
    if (rect) {
      this.outline = gradeOutline(this.host.hf, rect);
      this.scene.add(this.outline);
    }
  }

  private publish(p: GradePlan | null) {
    $gradeTool.set({
      started: !!this.start,
      cells: p?.cells ?? 0, w: p ? p.rect[2] - p.rect[0] : 0, d: p ? p.rect[3] - p.rect[1] : 0,
      secs: p?.secs ?? 0, eta: p?.eta ?? 0, rovers: p?.rovers ?? 0, energy: p?.energy ?? 0, relief: p?.relief ?? 0,
      spoil: p?.spoil ?? 0, ok: !!p?.ok, reason: p && !p.ok ? p.reason : '',
    });
  }

  info() {
    return {
      active: this.active, start: this.start, dragging: this.dragging, preview: this.preview.count,
      outline: !!this.outline, plan: this.plan ? { ok: this.plan.ok, cells: this.plan.cells, energy: this.plan.energy, reason: this.plan.reason } : null,
    };
  }
}
