/** The road tool (docs/15-roads.md §4): N or the palette's ROAD button.
 *
 *   - press on an open road cell and drag: the road the rovers would lay there
 *     — the same A* as a spur — is previewed with its cost; release lays it, a
 *     job for free rovers;
 *   - or click the start, then click each waypoint the road must pass (the
 *     road is planned leg by leg and previewed whole); Enter or a double-click
 *     on the last one lays it (docs/19 S3); Backspace takes the last waypoint
 *     back;
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
import { cellAt, cellKey, isOpen, planLink, planPath, roadMap, strands } from '../core/roads';
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
  /** the cells the road must pass, in order (the last is where it ends) */
  private waypoints: Cell[] = [];
  private remove = false;
  private dragging = false;
  /** this press set the start (so a release elsewhere is a drag: it lays at once) */
  private pressStarted = false;
  private lastClickAt = 0;
  private preview: CellPreview;
  /** the waypoints, drawn dark over the road previewed */
  private marks: CellPreview;
  private last = '';

  constructor(private host: RoadToolHost, scene: THREE.Scene) {
    this.preview = new CellPreview(scene, host.hf);
    this.marks = new CellPreview(scene, host.hf);
  }

  begin() {
    this.active = true;
    this.start = null;
    this.waypoints = [];
    this.dragging = false;
    this.publish('', 0, 0, '');
  }

  cancel() {
    if (!this.active) return;
    this.active = false;
    this.start = null;
    this.waypoints = [];
    this.dragging = false;
    this.host.holdCamera(false);
    this.preview.hide();
    this.marks.hide();
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
    this.pressStarted = false;
    if (!alt && !this.start) {
      const r = roadMap(s).get(cellKey(c[0], c[1]));
      if (!r || !isOpen(r) || r.bay) {
        this.publish('', 0, 0, 'START ON A ROAD — press on an open road cell and drag out');
        $placeFlash.set($placeFlash.get() + 1);
        sfx.play('invalid');
        return;
      }
    }
    if (!this.start) { this.start = c; this.pressStarted = true; }
    this.dragging = true;
    this.host.holdCamera(true);
  }

  /** Left button up: a drag from the start lays; a click on the start waits for waypoints; a
   *  click after that adds one (a second click on it, or Enter, lays the road). */
  up() {
    this.host.holdCamera(false);
    if (!this.start) return;
    const c = this.cursor();
    this.dragging = false;
    if (!c) return;
    const s = this.host.state();
    const same = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];
    if (this.remove) {
      if (same(c, this.start)) return; // a click on the start: the end comes next
      const cells = this.box(s, this.start, c);
      if (cells.length) this.host.push({ kind: 'removeRoad', cells: cells.map((k) => [k % 256, Math.floor(k / 256)] as Cell) });
      this.reset();
      return;
    }
    if (this.pressStarted) {
      this.pressStarted = false;
      if (same(c, this.start)) return; // a click on the start: waypoints come next
      this.lay([c]); // a drag out from the start: lay at once
      return;
    }
    // a click with the start set: a waypoint
    const last = this.waypoints[this.waypoints.length - 1];
    const now = performance.now();
    if (last && same(last, c) && now - this.lastClickAt < 450) { this.commit(); return; } // a double-click lays it
    if (!last && same(c, this.start)) return;
    if (last && same(last, c)) return;
    const plan = planPath(s, this.host.hf, this.start, [...this.waypoints, c]);
    if (plan.reason) { $placeFlash.set($placeFlash.get() + 1); sfx.play('invalid'); return; }
    this.waypoints.push(c);
    this.lastClickAt = now;
    this.last = '';
  }

  /** Enter, or a double-click on the last waypoint: lay the road through them all. */
  commit() {
    if (!this.active || !this.start || this.remove || !this.waypoints.length) return;
    this.lay([...this.waypoints]);
  }

  /** Backspace: the last waypoint back (with none left, the start). */
  undo() {
    if (!this.active) return;
    if (this.waypoints.length) this.waypoints.pop();
    else this.start = null;
    this.last = '';
    if (!this.start) { this.preview.hide(); this.marks.hide(); this.publish('', 0, 0, ''); }
  }

  /** Lay the road from the start through `via` (the last is its end), if it plans. */
  private lay(via: Cell[]) {
    const s = this.host.state();
    const plan = planPath(s, this.host.hf, this.start!, via);
    if (plan.reason) { $placeFlash.set($placeFlash.get() + 1); sfx.play('invalid'); return; }
    if (plan.cells.length) {
      const to = via[via.length - 1];
      this.host.push({ kind: 'layRoad', from: this.start!, to, ...(via.length > 1 ? { via: via.slice(0, -1) } : {}) });
    }
    this.reset();
  }

  private reset() {
    this.start = null;
    this.waypoints = [];
    this.remove = false;
    this.pressStarted = false;
    this.preview.hide();
    this.marks.hide();
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
    const key = `${c?.join(',')}|${this.start?.join(',')}|${this.waypoints.map((w) => w.join(',')).join(';')}|${this.remove}|${s.roadRev ?? 0}`;
    if (key === this.last) return;
    this.last = key;
    if (!c || !this.start) { this.preview.hide(); this.marks.hide(); this.publish('', 0, 0, ''); return; }
    if (this.remove) {
      const cells = this.box(s, this.start, c);
      this.preview.show(cells, true);
      const cut = strands(s, cells);
      this.publish('remove', cells.length, 0, cut.length ? `strands ${cut.slice(0, 2).join(', ')}${cut.length > 2 ? '…' : ''}: no road to its door` : '');
      return;
    }
    const plan = this.waypoints.length || !this.pressStarted && this.start
      ? planPath(s, this.host.hf, this.start, [...this.waypoints, c])
      : planLink(s, this.host.hf, this.start, c);
    this.preview.show(plan.reason ? undefined : plan.cells);
    this.marks.show(this.waypoints.map((w) => cellKey(w[0], w[1])), true);
    this.publish('lay', plan.cells.length, plan.cells.length * ROAD.cellS, plan.reason);
  }

  private publish(mode: '' | 'lay' | 'remove', cells: number, seconds: number, reason: string) {
    $roadTool.set({ mode, cells, seconds, reason, started: !!this.start, waypoints: this.waypoints.length });
  }

  info() {
    return {
      active: this.active, start: this.start, remove: this.remove, preview: this.preview.count, dragging: this.dragging,
      waypoints: this.waypoints.map((w) => [...w]),
    };
  }
}
