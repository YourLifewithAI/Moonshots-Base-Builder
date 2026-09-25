/** Boot: parse URL params, create the Game, mount the UI.
 *  ?site=mare|southpole|lavatube  skip site select and land immediately
 *  ?seed=42                       deterministic world + events
 *  ?debug                         expose window.__game
 *  ?nolock                        walk mode without pointer lock (headless tests)
 *  ?lowfx                         drop AO for weak GPUs
 *  ?safe                          safe render mode (also a menu setting)
 *
 *  A browser without WebGL2 (or with hardware acceleration off) cannot run
 *  the game at all: it gets a page saying so instead of a blank canvas. */
import { Game } from './core/game';
import { mountUI } from './ui/mount';
import { attachDebug } from './debug';
import { SITES, type SiteId } from './data/sites';
import { loadSettings } from './core/settings';
import { installAudio, sfx } from './audio/sfx';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('world') as HTMLCanvasElement;
// the menu's choices apply before the first frame is drawn
const settings = loadSettings();
sfx.setVolume(settings.volume);
sfx.setMusicVolume(settings.music);
sfx.setEffectsVolume(settings.effects);
sfx.setMuted(settings.muted);
installAudio();

function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

/** The game cannot start: say why, in plain DOM (no renderer, no UI layer). */
function showFatal(title: string, lines: string[]) {
  const box = document.createElement('div');
  box.id = 'fatal';
  box.setAttribute('role', 'alert');
  box.style.cssText = 'position:fixed; inset:0; display:flex; flex-direction:column; justify-content:center; '
    + 'align-items:center; gap:12px; padding:24px; text-align:center; background:var(--ink-900); '
    + 'color:var(--ink-100); font:14px/1.5 var(--font-ui);';
  const h = document.createElement('h1');
  h.textContent = title;
  h.style.cssText = 'font-size:22px; font-weight:600; letter-spacing:0.04em; color:var(--paper);';
  box.appendChild(h);
  for (const text of lines) {
    const p = document.createElement('p');
    p.textContent = text;
    p.style.maxWidth = '560px';
    box.appendChild(p);
  }
  document.body.appendChild(box);
}

let game: Game | null = null;
try {
  game = new Game(canvas, {
    nolock: params.has('nolock'),
    lowfx: params.has('lowfx'),
    safe: params.has('safe') || settings.safe || settings.safeAuto,
    safeAuto: !params.has('safe') && !settings.safe && settings.safeAuto,
    fx: params.has('fx') ? Number(params.get('fx')) : undefined,
    fxChoice: settings.fx ?? 0,
    seed: Number(params.get('seed') ?? Math.floor(Math.random() * 1e9)),
  });
} catch (e) {
  console.error('[MOONSHOTS] The renderer could not start.', e);
  canvas.style.display = 'none';
  if (!hasWebGL2()) {
    showFatal('MOONSHOTS NEEDS WEBGL2', [
      'This browser could not create a WebGL2 context, which the game needs to draw anything.',
      'Make sure hardware acceleration is enabled in the browser settings — “Use graphics acceleration '
        + 'when available” (Chrome: Settings → System; Edge: Settings → System and performance) — then '
        + 'restart the browser.',
      'On Windows, a current Chrome or Edge is recommended.',
    ]);
  } else {
    showFatal('MOONSHOTS COULD NOT START', [
      `The renderer failed to start: ${e instanceof Error ? e.message : String(e)}`,
      'Reloading the page may help. On Windows, a current Chrome or Edge with hardware acceleration enabled is recommended.',
    ]);
  }
}

if (game) {
  mountUI(game);

  if (params.has('debug')) attachDebug(game);

  const siteParam = params.get('site');
  if (siteParam && siteParam in SITES) {
    game.startNew(siteParam as SiteId, params.get('exp') === 'robotic' ? 'robotic' : 'human');
  }
}
