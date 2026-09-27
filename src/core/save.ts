/** Save/load: one JSON blob in IndexedDB (idb-keyval). Terrain is never saved —
 *  it regenerates deterministically from (siteId, seed), then the flatten
 *  history is replayed in order. state.version stays 1: the tech tree carries
 *  its own techSchema, migrated by research.migrateTechSchema in game.loadFrom. */
import { get, set, del } from 'idb-keyval';
import type { GameState } from './state';

const KEY = 'mbb-save-v1';
/** touch mode's synchronous copy, written as the page hides or goes away
 *  (iOS can kill a background tab before the database write lands); the
 *  newer of it and the database wins at load */
const SYNC_KEY = 'mbb-save-v1-sync';

export interface SaveBlob {
  state: GameState;
  player: { mode: 'build' | 'walk'; x: number; y: number; z: number; yaw: number; pitch: number };
  savedAt: number;
}

export async function saveGame(blob: SaveBlob, sync = false): Promise<void> {
  if (sync) {
    try { localStorage.setItem(SYNC_KEY, JSON.stringify(blob)); } catch { /* quota: the database copy only */ }
  }
  try {
    await set(KEY, JSON.parse(JSON.stringify(blob)));
  } catch {
    try { localStorage.setItem(KEY, JSON.stringify(blob)); } catch { /* storage unavailable */ }
  }
}

export async function loadGame(): Promise<SaveBlob | null> {
  const main = await loadMain();
  const copy = readLocal(SYNC_KEY);
  return copy && (!main || (copy.savedAt ?? 0) > (main.savedAt ?? 0)) ? copy : main;
}

async function loadMain(): Promise<SaveBlob | null> {
  try {
    const v = await get<SaveBlob>(KEY);
    if (v?.state?.version === 1) return v;
  } catch { /* fall through */ }
  return readLocal(KEY);
}

function readLocal(key: string): SaveBlob | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const v = JSON.parse(raw) as SaveBlob;
      if (v?.state?.version === 1) return v;
    }
  } catch { /* no save */ }
  return null;
}

export async function clearSave(): Promise<void> {
  try { await del(KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(KEY); localStorage.removeItem(SYNC_KEY); } catch { /* ignore */ }
}
