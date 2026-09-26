/** Player settings from the in-game menu, kept in localStorage, plus what the
 *  render checks learned about this GPU. Read once at boot (main.ts) so the
 *  FX level, safe mode and audio apply before the first frame. Storage can be
 *  missing or throw (private mode, quota): every access is guarded, and a
 *  failure only means the choice lasts this session. */

const KEY = 'mbb-settings';

export interface Settings {
  /** the player's own FX level (0 full … 3 plain); null = never chosen */
  fx: number | null;
  /** safe render mode chosen in the menu */
  safe: boolean;
  /** safe render mode the render check switched on (the player's own choice
   *  clears it) */
  safeAuto: boolean;
  /** FX levels that failed a render check on this GPU (the menu asks twice
   *  before raising to one) */
  fxFailed: number[];
  /** master volume 0..1 */
  volume: number;
  /** the ambient score, 0..1 (under the master volume) */
  music: number;
  /** cues, radio, hum and rovers, 0..1 (under the master volume) */
  effects: number;
  muted: boolean;
  /** discovery pop-ups and era explainers (the running tutorial) */
  tips: boolean;
  /** hazards (docs/14 §3.8): pause when a new hazard is announced; pause on every lethal warning */
  pauseHazards: boolean;
  pauseLethal: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  fx: null, safe: false, safeAuto: false, fxFailed: [], volume: 0.7, music: 0.7, effects: 1, muted: false, tips: true,
  pauseHazards: true, pauseLethal: false,
};

const isLevel = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 3;

const clamp01 = (v: unknown, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d;

function read(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Settings> | null;
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
    return {
      fx: isLevel(raw.fx) ? raw.fx : null,
      style: isRenderStyle(raw.style) ? raw.style : undefined,
      safe: raw.safe === true,
      safeAuto: raw.safeAuto === true,
      fxFailed: Array.isArray(raw.fxFailed) ? [...new Set(raw.fxFailed.filter(isLevel))].sort() : [],
      volume: clamp01(raw.volume, DEFAULT_SETTINGS.volume),
      music: clamp01(raw.music, DEFAULT_SETTINGS.music),
      effects: clamp01(raw.effects, DEFAULT_SETTINGS.effects),
      muted: raw.muted === true,
      tips: raw.tips !== false,
      pauseHazards: raw.pauseHazards !== false,
      pauseLethal: raw.pauseLethal === true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let current: Settings | null = null;

export function loadSettings(): Settings {
  current ??= read();
  return { ...current, fxFailed: [...current.fxFailed] };
}

/** Merge `patch` into the settings and persist them; returns the result. */
export function saveSettings(patch: Partial<Settings>): Settings {
  current = { ...loadSettings(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* session-only */ }
  return loadSettings();
}

// ───────────────────────────── render style ─────────────────────────────

/** How the world is drawn: 'classic' (the default: flat colours, faceted
 *  Lambert, the isometric camera, no post chain — runs on any GPU) or
 *  'detailed' (the FX ladder: post chain, shadows, shader patches, the free
 *  camera). Read once at boot, since the renderer's context attributes
 *  (antialias) depend on it: a change saves the game and reloads. */
export type RenderStyle = 'classic' | 'detailed';
export const DEFAULT_STYLE: RenderStyle = 'classic';
export const isRenderStyle = (v: unknown): v is RenderStyle => v === 'classic' || v === 'detailed';

export interface Settings {
  /** the render style chosen in the menu; absent = DEFAULT_STYLE */
  style?: RenderStyle;
}

/** The stored render style (the menu's), or the default. */
export function storedStyle(): RenderStyle {
  return loadSettings().style ?? DEFAULT_STYLE;
}
