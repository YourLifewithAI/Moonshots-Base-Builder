/** Touch gestures on the world (touch mode only; docs/07 §13). One
 *  recognizer on the canvas, for touch and pen pointers — a mouse keeps its
 *  desktop handlers, so `?touch` on a laptop still clicks.
 *
 *   | gesture                 | command view         | placing        | road tool          |
 *   |-------------------------|----------------------|----------------|--------------------|
 *   | tap                     | select (a click)     | ghost to there | start / end a road |
 *   | one-finger drag         | pan                  | drag the ghost | draw the road      |
 *   | long-press (0.5 s)      | info                 | —              | —                  |
 *   | two fingers             | pan · pinch · twist  | same           | same               |
 *
 *  A drag never selects: past a 10 px slop a touch is a drag for good. Two
 *  fingers pan by their midpoint, zoom by their spread and turn by their
 *  angle; the second finger never joins a ghost or road drag already
 *  running. The pointerdown is cancelled and stops at the window (capture),
 *  so neither the camera's own handlers nor the compatibility mouse events
 *  (the game's click path) ever see a touch. */

export type TouchMode = 'select' | 'place' | 'road' | 'target';

export interface TouchHost {
  /** gestures act on the world now (playing, command view, nothing over it) */
  ready(): boolean;
  mode(): TouchMode;
  tap(x: number, y: number): void;
  longPress(x: number, y: number): void;
  /** camera */
  pan(dx: number, dy: number): void;
  pinch(phase: 'start' | 'move' | 'end', scale?: number): void;
  twist(rad: number): void;
  twistReset(): void;
  /** the placement ghost, dragged by a screen delta */
  ghostDrag(dx: number, dy: number): void;
  /** the road tool: press (at the drag's start), follow, release */
  roadDown(x: number, y: number): void;
  roadMove(x: number, y: number): void;
  roadUp(x: number, y: number): void;
}

/** px a touch may wander and still be a tap (or a long-press) */
export const TAP_SLOP = 10;
/** ms a still touch takes to become a long-press */
export const LONG_MS = 500;

interface Pt { x: number; y: number; x0: number; y0: number }

type Gesture =
  | { kind: 'idle' }
  /** one finger down, not yet moved past the slop */
  | { kind: 'press'; id: number; t0: number; timer: number }
  /** one finger dragging: what it drags was decided as it passed the slop */
  | { kind: 'drag'; id: number; what: 'pan' | 'ghost' | 'road' }
  /** two fingers: pan, pinch, twist */
  | { kind: 'multi'; a: number; b: number; d0: number; ang: number; mx: number; my: number }
  /** the gesture ended early (a long-press fired, a finger of a pair lifted):
   *  nothing more until every finger is up */
  | { kind: 'spent' };

/** ms after a touch during which mouse events are the browser's
 *  compatibility copies of it (a tap on a button sends a mousemove there) */
const COMPAT_MS = 800;

export class TouchControls {
  private pts = new Map<number, Pt>();
  private g: Gesture = { kind: 'idle' };
  private touchAt = -Infinity;
  /** what the recognizer did last (tests, probes) */
  readonly log: string[] = [];

  constructor(private canvas: HTMLCanvasElement, private host: TouchHost) {
    const opts = { capture: true, passive: false } as const;
    // any touch, anywhere (a HUD button too), marks the mouse events after it as copies
    const seen = (e: PointerEvent) => { if (e.pointerType !== 'mouse') this.touchAt = performance.now(); };
    for (const ev of ['pointerdown', 'pointermove', 'pointerup'] as const) window.addEventListener(ev, seen, { capture: true, passive: true });
    window.addEventListener('pointerdown', (e) => this.onDown(e), opts);
    window.addEventListener('pointermove', (e) => this.onMove(e), opts);
    window.addEventListener('pointerup', (e) => this.onUp(e, false), opts);
    window.addEventListener('pointercancel', (e) => this.onUp(e, true), opts);
    // no long-press callout or context menu on the world
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Is a mouse event now the browser's copy of a touch (not a real mouse)? */
  compatMouse(): boolean {
    return performance.now() - this.touchAt < COMPAT_MS;
  }

  private note(s: string) {
    this.log.push(s);
    if (this.log.length > 40) this.log.shift();
  }

  private mine(e: PointerEvent): boolean {
    return e.pointerType !== 'mouse' && (e.target === this.canvas || this.pts.has(e.pointerId));
  }

  private onDown(e: PointerEvent) {
    if (!this.mine(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* fine without */ }
    this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    if (!this.host.ready()) { this.g = { kind: 'spent' }; return; }
    const g = this.g;
    if (g.kind === 'idle' && this.pts.size === 1) {
      const id = e.pointerId;
      const timer = window.setTimeout(() => this.longFire(id), LONG_MS);
      this.g = { kind: 'press', id, t0: performance.now(), timer };
      return;
    }
    // a second finger: a pair gesture — unless one finger is drawing (a
    // ghost or a road), which the second never interrupts
    if (this.pts.size === 2 && (g.kind === 'press' || (g.kind === 'drag' && g.what === 'pan'))) {
      if (g.kind === 'press') window.clearTimeout(g.timer);
      const [a, b] = [...this.pts.keys()];
      const pa = this.pts.get(a)!, pb = this.pts.get(b)!;
      this.g = {
        kind: 'multi', a, b, d0: Math.max(1, Math.hypot(pb.x - pa.x, pb.y - pa.y)),
        ang: Math.atan2(pb.y - pa.y, pb.x - pa.x), mx: (pa.x + pb.x) / 2, my: (pa.y + pb.y) / 2,
      };
      this.host.pinch('start');
      this.host.twistReset();
      this.note('multi');
    }
  }

  private onMove(e: PointerEvent) {
    const p = this.pts.get(e.pointerId);
    if (!p || e.pointerType === 'mouse') return;
    e.preventDefault();
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    const g = this.g;
    if (!this.host.ready()) {
      if (g.kind === 'multi') this.host.pinch('end');
      if (g.kind === 'press') window.clearTimeout(g.timer);
      if (g.kind !== 'idle') this.g = { kind: 'spent' };
      return;
    }
    if (g.kind === 'press' && g.id === e.pointerId) {
      if (Math.hypot(p.x - p.x0, p.y - p.y0) <= TAP_SLOP) return;
      window.clearTimeout(g.timer);
      const mode = this.host.mode();
      const what = mode === 'place' ? 'ghost' : mode === 'road' ? 'road' : 'pan';
      this.g = { kind: 'drag', id: g.id, what };
      this.note(`drag:${what}`);
      // the drag takes the whole way from where the finger went down
      if (what === 'road') { this.host.roadDown(p.x0, p.y0); this.host.roadMove(p.x, p.y); }
      else if (what === 'ghost') this.host.ghostDrag(p.x - p.x0, p.y - p.y0);
      else this.host.pan(p.x - p.x0, p.y - p.y0);
      return;
    }
    if (g.kind === 'drag' && g.id === e.pointerId) {
      if (g.what === 'road') this.host.roadMove(p.x, p.y);
      else if (g.what === 'ghost') this.host.ghostDrag(dx, dy);
      else this.host.pan(dx, dy);
      return;
    }
    if (g.kind === 'multi' && (e.pointerId === g.a || e.pointerId === g.b)) {
      const pa = this.pts.get(g.a)!, pb = this.pts.get(g.b)!;
      const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
      this.host.pan(mx - g.mx, my - g.my);
      g.mx = mx; g.my = my;
      this.host.pinch('move', Math.hypot(pb.x - pa.x, pb.y - pa.y) / g.d0);
      const ang = Math.atan2(pb.y - pa.y, pb.x - pa.x);
      let da = ang - g.ang;
      if (da > Math.PI) da -= 2 * Math.PI;
      if (da < -Math.PI) da += 2 * Math.PI;
      g.ang = ang;
      if (da) this.host.twist(da);
    }
  }

  private onUp(e: PointerEvent, cancelled: boolean) {
    const p = this.pts.get(e.pointerId);
    if (!p || e.pointerType === 'mouse') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.pts.delete(e.pointerId);
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* fine */ }
    const g = this.g;
    if (g.kind === 'press' && g.id === e.pointerId) {
      window.clearTimeout(g.timer);
      if (!cancelled && this.host.ready()) {
        this.note('tap');
        this.host.tap(e.clientX, e.clientY);
      }
    } else if (g.kind === 'drag' && g.id === e.pointerId) {
      if (g.what === 'road' && this.host.ready()) this.host.roadUp(cancelled ? p.x0 : e.clientX, cancelled ? p.y0 : e.clientY);
      this.note(`end:${g.what}`);
    } else if (g.kind === 'multi') {
      this.host.pinch('end');
      this.host.twistReset();
      this.note('end:multi');
    }
    // one finger of a pair lifting ends the pair; the other rests till it lifts
    this.g = this.pts.size ? { kind: 'spent' } : { kind: 'idle' };
  }

  private longFire(id: number) {
    const g = this.g;
    const p = this.pts.get(id);
    if (g.kind !== 'press' || g.id !== id || !p) return;
    this.g = { kind: 'spent' };
    if (!this.host.ready()) return;
    this.note('long');
    this.host.longPress(p.x, p.y);
  }

  /** the recognizer's state (tests, probes) */
  info() {
    return { gesture: this.g.kind, pointers: this.pts.size, log: [...this.log] };
  }
}
