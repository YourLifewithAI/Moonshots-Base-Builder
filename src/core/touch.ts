/** Touch mode (docs/07 §13): the phone held sideways. Decided once at boot
 *  (main.ts) and fixed for the session, like the render style: the touch
 *  layout restructures the HUD, so a change in the menu saves and reloads.
 *
 *   - `?touch` forces it on (`?touch=0` off) for this launch;
 *   - otherwise the menu's choice: On, Off, or Auto — on when the primary
 *     pointer is coarse and no fine pointer (mouse, trackpad, stylus) exists.
 *
 *  Off, nothing of it exists: no class on <html>, no touch DOM, no gesture
 *  listeners — the desktop game is byte-for-byte the same. */

export type TouchChoice = 'auto' | 'on' | 'off';
export const TOUCH_CHOICES: readonly TouchChoice[] = ['auto', 'on', 'off'];
export const isTouchChoice = (v: unknown): v is TouchChoice => v === 'auto' || v === 'on' || v === 'off';

let active = false;

/** Is touch mode on this session? */
export function touchOn(): boolean {
  return active;
}

/** What Auto would pick on this device: a coarse primary pointer and no fine one. */
export function autoTouch(): boolean {
  try {
    const mm = (q: string) => (typeof window.matchMedia === 'function' ? window.matchMedia(q).matches : false);
    return mm('(pointer: coarse)') && !mm('(any-pointer: fine)');
  } catch {
    return false;
  }
}

/** Boot's decision: the URL flag, then the menu's choice, then Auto. */
export function detectTouch(params: URLSearchParams, choice: TouchChoice): boolean {
  if (params.has('touch')) {
    const v = params.get('touch');
    return v !== '0' && v !== 'off' && v !== 'false';
  }
  if (choice !== 'auto') return choice === 'on';
  return autoTouch();
}

/** Fix the session's mode (main.ts, once, before the UI mounts). */
export function setTouchMode(on: boolean) {
  active = on;
  document.documentElement.classList.toggle('touch', on);
}
