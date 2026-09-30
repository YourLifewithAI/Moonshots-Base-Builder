/** Player settings from the in-game menu, kept in localStorage, plus what the
 *  render check learned about this GPU (safe mode). Read once at boot
 *  (main.ts) so safe mode and audio apply before the first frame. Storage can be
 *  missing or throw (private mode, quota): every access is guarded, and a
 *  failure only means the choice lasts this session. */

import { isTouchChoice, type TouchChoice } from './touch';

const KEY = 'mbb-settings';

/** sessionStorage flag: a touch-mode switch or a service-worker update saved
 *  the game and reloaded, so the next boot continues it (main.ts) instead of
 *  showing the title screen. */
export const RESUME_KEY = 'mbb-resume';

export interface Settings {
  /** safe render mode: the player's choice in the menu, or the one the
   *  black-frame check switched on (the player turning it off clears it) */
  safe: boolean;
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
  /** space weather (docs/16 §10.4): pause on flare warnings — M and X (default), all, or off */
  pauseFlares: 'mx' | 'all' | 'off';
  /** notifications (docs/19 S7): a hazard's first-of-its-kind drill card holds the game paused until Continue */
  pauseDrills: boolean;
  /** notifications (docs/20 S1): the `race` family's news (a rival lands, reaches an era, faces a hearing) pauses the game; off by default */
  pauseRace: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  safe: false, volume: 0.7, music: 0.7, effects: 1, muted: false, tips: true,
  pauseHazards: true, pauseLethal: false, pauseFlares: 'mx', pauseDrills: true, pauseRace: false,
};

const clamp01 = (v: unknown, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d;

function read(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Settings> | null;
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
    return {
      // (an older save's render-check safe mode, `safeAuto`, is the same flag now)
      safe: raw.safe === true || (raw as { safeAuto?: unknown }).safeAuto === true,
      volume: clamp01(raw.volume, DEFAULT_SETTINGS.volume),
      music: clamp01(raw.music, DEFAULT_SETTINGS.music),
      effects: clamp01(raw.effects, DEFAULT_SETTINGS.effects),
      muted: raw.muted === true,
      tips: raw.tips !== false,
      pauseHazards: raw.pauseHazards !== false,
      pauseLethal: raw.pauseLethal === true,
      pauseFlares: raw.pauseFlares === 'all' || raw.pauseFlares === 'off' ? raw.pauseFlares : 'mx',
      pauseDrills: raw.pauseDrills !== false,
      pauseRace: raw.pauseRace === true,
      touch: isTouchChoice(raw.touch) ? raw.touch : undefined,
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
  return loadSettings();
}

// ───────────────────────────── touch mode ─────────────────────────────

export interface Settings {
  /** touch controls (core/touch.ts): Auto, On or Off; absent = Auto. Read
   *  once at boot — a change saves the game and reloads */
  touch?: TouchChoice;
}

/** The stored touch choice (the menu's), or Auto. */
export function storedTouch(): TouchChoice {
  return loadSettings().touch ?? 'auto';
}
