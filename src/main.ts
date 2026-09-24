/** Boot: parse URL params, create the Game, mount the UI.
 *  ?site=mare|southpole|lavatube  skip site select and land immediately
 *  ?seed=42                       deterministic world + events
 *  ?debug                         expose window.__game
 *  ?nolock                        walk mode without pointer lock (headless tests)
 *  ?lowfx                         drop AO for weak GPUs
 *  ?safe                          safe render mode (also a menu setting) */
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
sfx.setMuted(settings.muted);
installAudio();

const game = new Game(canvas, {
  nolock: params.has('nolock'),
  lowfx: params.has('lowfx'),
  safe: params.has('safe') || settings.safe,
  fx: params.has('fx') ? Number(params.get('fx')) : undefined,
  fxChoice: settings.fx ?? 0,
  seed: Number(params.get('seed') ?? Math.floor(Math.random() * 1e9)),
});

mountUI(game);

if (params.has('debug')) attachDebug(game);

const siteParam = params.get('site');
if (siteParam && siteParam in SITES) {
  game.startNew(siteParam as SiteId, params.get('exp') === 'robotic' ? 'robotic' : 'human');
}
