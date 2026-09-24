/** Player settings from the in-game menu, kept in localStorage. Read once at
 *  boot (main.ts) so the FX level, safe mode and audio apply before the first
 *  frame. Storage can be missing or throw (private mode, quota): every access
 *  is guarded, and a failure only means the choice lasts this session. */

const KEY = 'mbb-settings';

export interface Settings {
  /** the player's own FX level (0 full … 3 plain); null = never chosen */
  fx: number | null;
  /** safe render mode chosen in the menu */
  safe: boolean;
  /** master volume 0..1 */
  volume: number;
  muted: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = { fx: null, safe: false, volume: 0.7, muted: false };

const clamp01 = (v: unknown, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d;

function read(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Settings> | null;
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
    const fx = typeof raw.fx === 'number' && Number.isInteger(raw.fx) && raw.fx >= 0 && raw.fx <= 3 ? raw.fx : null;
    return {
      fx,
      safe: raw.safe === true,
      volume: clamp01(raw.volume, DEFAULT_SETTINGS.volume),
      muted: raw.muted === true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let current: Settings | null = null;

export function loadSettings(): Settings {
  current ??= read();
  return { ...current };
}

/** Merge `patch` into the settings and persist them; returns the result. */
export function saveSettings(patch: Partial<Settings>): Settings {
  current = { ...loadSettings(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* session-only */ }
  return { ...current };
}
