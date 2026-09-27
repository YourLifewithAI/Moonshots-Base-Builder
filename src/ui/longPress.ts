/** Touch mode's long-press on DOM controls (docs/07 §13): a palette card
 *  orders one, a research card queues its whole path. Touch and pen only —
 *  a mouse keeps its click. */
import { LONG_MS, TAP_SLOP } from '../player/touch';

/** A long-press on any `selector` inside `root` (touch and pen pointers):
 *  `fn` runs after LONG_MS held still, and the click that would follow the
 *  lift is swallowed. */
export function onLongPress(root: HTMLElement, selector: string, fn: (target: HTMLElement, x: number, y: number) => void) {
  let timer = 0;
  let start: { x: number; y: number; id: number } | null = null;
  let swallow = false;
  const clear = () => { window.clearTimeout(timer); start = null; };
  root.addEventListener('pointerdown', (e) => {
    // a lift that made no click (some browsers skip it after a long hold)
    // must not eat the next one
    swallow = false;
    if (e.pointerType === 'mouse') return;
    const t = (e.target as HTMLElement).closest<HTMLElement>(selector);
    if (!t || !root.contains(t)) return;
    clear();
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    timer = window.setTimeout(() => {
      if (!start) return;
      swallow = true;
      const { x, y } = start;
      start = null;
      fn(t, x, y);
    }, LONG_MS);
  });
  root.addEventListener('pointermove', (e) => {
    if (start && e.pointerId === start.id && Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP) clear();
  });
  root.addEventListener('pointerup', clear);
  root.addEventListener('pointercancel', clear);
  root.addEventListener('click', (e) => {
    if (!swallow) return;
    swallow = false;
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);
  // a long-press is not a context menu
  root.addEventListener('contextmenu', (e) => { if ((e.target as HTMLElement).closest(selector)) e.preventDefault(); });
}
