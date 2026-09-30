/** Save/load: one JSON blob in IndexedDB (idb-keyval). Terrain is never saved —
 *  it regenerates deterministically from (siteId, seed), then the flatten
 *  history is replayed in order. state.version stays 1: the tech tree carries
 *  its own techSchema, migrated by research.migrateTechSchema in game.loadFrom.
 *
 *  Two shapes share the key (docs/20 §4.4). v1, `{ state, camera?, savedAt }`, is a solo game and loads as SOLO
 *  forever: `asV2` wraps it in a solo Moon. v2, `{ version: 2, moon, player, rivals, camera?, savedAt }`, is a
 *  game with a faction: the shared Moon, the player's base and each rival's (stripped: `stripForRivalSave`). */
import { get, set, del } from 'idb-keyval';
import type { GameState } from './state';
import { moonFromState, type FactionId, type MoonState } from './moon';

const KEY = 'mbb-save-v1';
/** touch mode's synchronous copy, written as the page hides or goes away
 *  (iOS can kill a background tab before the database write lands); the
 *  newer of it and the database wins at load */
const SYNC_KEY = 'mbb-save-v1-sync';

export interface SaveBlob {
  state: GameState;
  // (saves from before walk mode was removed also carry a `player` block: nothing reads it)
  /** the isometric view's preset (player/isoCam.ts CameraPreset): the yaw step,
   *  the tilt (0 low, 1 high) and the zoom distance (m); absent in older saves,
   *  which load with the default view */
  camera?: { step: number; tilt: number; dist: number };
  savedAt: number;
}

/** A saved game with a Moon (docs/20 §4.4). */
export interface SaveBlobV2 {
  version: 2;
  moon: MoonState;
  /** the player's base */
  player: GameState;
  /** every rival that has landed (a faction that lands later is created when the Moon's clock reaches its day) */
  rivals: { faction: FactionId; state: GameState }[];
  camera?: SaveBlob['camera'];
  savedAt: number;
}

/** Either shape, as it is stored. */
export type SaveFile = SaveBlob | SaveBlobV2;

export const isV2 = (b: SaveFile): b is SaveBlobV2 => (b as SaveBlobV2).version === 2;

/** The whole file as a v2: a v1 is a SOLO game (its state, a Moon synthesised from it with no player, no
 *  rivals and race phase 'solo'). A v2 is returned as it is. */
export function asV2(file: SaveFile): SaveBlobV2 {
  if (isV2(file)) return file;
  file.state.landedAt ??= 0;
  return { version: 2, moon: moonFromState(file.state), player: file.state, rivals: [], camera: file.camera, savedAt: file.savedAt };
}

/** A rival's state as it is saved: a shallow copy without what nobody reads again (the logs, the alerts, the flatten
 *  history, the pits' height delta, the extraction zones, the haul routes). The flat terrain regenerates from the
 *  site and the seed. The live state is not touched. */
export function stripForRivalSave(state: GameState): GameState {
  const s: GameState = { ...state };
  s.log = [];
  s.alerts = [];
  s.alertSnooze = {};
  s.flattens = [];
  s.terrain = { ...state.terrain, delta: '' };
  s.hazards = { ...state.hazards, log: [] };
  s.flare = { ...state.flare, log: [] };
  s.auto = { ...state.auto, log: [] };
  delete s.zones;
  const bare = <T extends { route?: unknown }>(h: T): T => { if (!h.route) return h; const { route: _r, ...rest } = h; return rest as T; };
  s.buildings = state.buildings.map((b) => (b.haul?.route ? { ...b, haul: bare(b.haul) } : b));
  s.haulers = state.haulers.map((u) => (u.haul?.route ? { ...u, haul: bare(u.haul) } : u));
  return s;
}

export async function saveGame(blob: SaveFile, sync = false): Promise<void> {
  if (sync) {
    try { localStorage.setItem(SYNC_KEY, JSON.stringify(blob)); } catch { /* quota: the database copy only */ }
  }
  try {
    await set(KEY, JSON.parse(JSON.stringify(blob)));
  } catch {
    try { localStorage.setItem(KEY, JSON.stringify(blob)); } catch { /* storage unavailable */ }
  }
}

/** The save as it is stored, v1 or v2 (the newer of the synchronous copy and the database). */
export async function loadSave(): Promise<SaveFile | null> {
  const main = await loadMain();
  const copy = readLocal(SYNC_KEY);
  return copy && (!main || (copy.savedAt ?? 0) > (main.savedAt ?? 0)) ? copy : main;
}

/** The save in v1's shape, for a Game that does not know the Moon yet: a v2 collapses to its player's base. The
 *  integrated Game calls `loadSave`. */
export async function loadGame(): Promise<SaveBlob | null> {
  const f = await loadSave();
  return f && (isV2(f) ? { state: f.player, camera: f.camera, savedAt: f.savedAt } : f);
}

const valid = (v: SaveFile | null | undefined): v is SaveFile =>
  !!v && ((v as SaveBlobV2).version === 2 ? (v as SaveBlobV2).player?.version === 1 && (v as SaveBlobV2).moon?.version === 2
    : (v as SaveBlob).state?.version === 1);

async function loadMain(): Promise<SaveFile | null> {
  try {
    const v = await get<SaveFile>(KEY);
    if (valid(v)) return v;
  } catch { /* fall through */ }
  return readLocal(KEY);
}

function readLocal(key: string): SaveFile | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const v = JSON.parse(raw) as SaveFile;
      if (valid(v)) return v;
    }
  } catch { /* no save */ }
  return null;
}

export async function clearSave(): Promise<void> {
  try { await del(KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(KEY); localStorage.removeItem(SYNC_KEY); } catch { /* ignore */ }
}
