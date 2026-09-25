/** The road tool (docs/15-roads.md §4): N or the palette's ROAD button.
 *
 *   - press on an open road cell and drag (or click it, then click the end):
 *     the road the rovers would lay there — the same A* as a spur — is
 *     previewed with its cost; release (or the second click) lays it, a job
 *     for free rovers;
 *   - Alt-drag marks the road cells in the box dragged over; release removes
 *     them, warning first if that strands a structure;
 *   - right-click or Esc stops.
 *
 *  The hint above the palette ($roadTool) says what a release would do. */
import * as THREE from 'three';
import type { Action } from '../core/actions';
import type { GameState } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import { ROAD } from '../data/roads';
import { cellAt, cellKey, isOpen, planLink, roadMap, strands } from '../core/roads';
import { CellPreview } from '../buildings/cellPreview';
import { $roadTool, $placeFlash } from '../ui/stores';
import { sfx } from '../audio/sfx';

export interface RoadToolHost {
  state(): GameState;
  hf: Heightfield;
  /** the ray under the cursor */
  ray(): THREE.Ray;
  push(a: Action): void;
  /** hold the camera still while a drag draws (a left-drag pans High detail's) */
  holdCamera(on: boolean): void;
}

type Cell = [number, number];

export class RoadTool {
  active = false;
  private start: Cell | null = null;
  private remove = false;
  private dragging = false;
  private preview: CellPreview;
  private last = '';

  constructor(private host: RoadToolHost, scene: THREE.Scene) {
    this.preview = new CellPreview(scene, host.hf);
  }

  begin() {
    this.active = true;
    this.start = null;
    this.dragging = false;
    this.publish('', 0, 0, '');
  }

  cancel() {
    if (!this.active) return;
    this.active = false;
    this.start = null;
    this.dragging = false;
    this.host.holdCamera(false);
    this.preview.hide();
    $roadTool.set(null);
  }

  /** the cell under the cursor */
  private cursor(): Cell | null {
    const r = this.host.ray();
    const hit = this.host.hf.raycast(r.origin.x, r.origin.y, r.origin.z, r.direction.x, r.direction.y, r.direction.z);
    return hit ? cellAt(hit[0], hit[2]) : null;
  }

  /** Left button down: start a road from here (an open road cell), or a removal box (Alt). */
  down(alt: boolean) {
    const c = this.cursor();
    if (!c) return;
    const s = this.host.state();
    this.remove = alt;
    if (!alt && !this.start) {
      const r = roadMap(s).get(cellKey(c[0], c[1]));
      if (!r || !isOpen(r) || r.bay) {
        this.publish('', 0, 0, 'START ON A ROAD — press on an open road cell and drag out');
        $placeFlash.set($placeFlash.get() + 1);
        sfx.play('invalid');
        return;
      }
    }
    if (!this.start) this.start = c;
    this.dragging = true;
    this.host.holdCamera(true);
  }

  /** Left button up: a drag lays (or removes); a click on the start waits for the end click. */
  up() {
    this.host.holdCamera(false);
    if (!this.start) return;
    const c = this.cursor();
    this.dragging = false;
    if (!c) return;
    if (c[0] === this.start[0] && c[1] === this.start[1] && !this.remove) return; // a click: the end comes next
    const s = this.host.state();
    if (this.remove) {
      const cells = this.box(s, this.start, c);
      if (cells.length) this.host.push({ kind: 'removeRoad', cells: cells.map((k) => [k % 256, Math.floor(k / 256)] as Cell) });
    } else {
      const plan = planLink(s, this.host.hf, this.start, c);
      if (plan.reason) { $placeFlash.set($placeFlash.get() + 1); sfx.play('invalid'); return; }
      if (plan.cells.length) this.host.push({ kind: 'layRoad', from: this.start, to: c });
    }
    this.start = null;
    this.remove = false;
    this.preview.hide();
    this.last = '';
  }

  /** open road cells in the box between two cells */
  private box(s: GameState, a: Cell, b: Cell): number[] {
    const map = roadMap(s);
    const out: number[] = [];
    for (let z = Math.min(a[1], b[1]); z <= Math.max(a[1], b[1]); z++) {
      for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++) {
        if (map.has(cellKey(x, z))) out.push(cellKey(x, z));
      }
    }
    return out;
  }

  /** Per frame while active: the preview under the cursor. */
  update() {
    if (!this.active) return;
    const c = this.cursor();
    const s = this.host.state();
    const key = `${c?.join(',')}|${this.start?.join(',')}|${this.remove}|${s.roadRev ?? 0}`;
    if (key === this.last) return;
    this.last = key;
    if (!c || !this.start) { this.preview.hide(); this.publish('', 0, 0, ''); return; }
    if (this.remove) {
      const cells = this.box(s, this.start, c);
      this.preview.show(cells, true);
      const cut = strands(s, cells);
      this.publish('remove', cells.length, 0, cut.length ? `strands ${cut.slice(0, 2).join(', ')}${cut.length > 2 ? '…' : ''}: no road to its door` : '');
      return;
    }
    const plan = planLink(s, this.host.hf, this.start, c);
    this.preview.show(plan.reason ? undefined : plan.cells);
    this.publish('lay', plan.cells.length, plan.cells.length * ROAD.cellS, plan.reason);
  }

  private publish(mode: '' | 'lay' | 'remove', cells: number, seconds: number, reason: string) {
    $roadTool.set({ mode, cells, seconds, reason, started: !!this.start });
  }

  info() { return { active: this.active, start: this.start, remove: this.remove, preview: this.preview.count, dragging: this.dragging }; }
}
