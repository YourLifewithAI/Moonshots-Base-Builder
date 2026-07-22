/** Save/load: one JSON blob in IndexedDB (idb-keyval). Terrain is never saved —
 *  it regenerates deterministically from (siteId, seed), then the flatten
 *  history is replayed in order. */
import { get, set, del } from 'idb-keyval';
import type { GameState } from './state';

const KEY = 'mbb-save-v1';

export interface SaveBlob {
  state: GameState;
  player: { mode: 'build' | 'walk'; x: number; y: number; z: number; yaw: number; pitch: number };
  savedAt: number;
}

export async function saveGame(blob: SaveBlob): Promise<void> {
  try {
    await set(KEY, JSON.parse(JSON.stringify(blob)));
  } catch {
    try { localStorage.setItem(KEY, JSON.stringify(blob)); } catch { /* storage unavailable */ }
  }
}

export async function loadGame(): Promise<SaveBlob | null> {
  try {
    const v = await get<SaveBlob>(KEY);
    if (v?.state?.version === 1) return v;
  } catch { /* fall through */ }
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as SaveBlob;
      if (v?.state?.version === 1) return v;
    }
  } catch { /* no save */ }
  return null;
}

export async function clearSave(): Promise<void> {
  try { await del(KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
