/** Boot: parse URL params, create the Game, mount the UI.
 *  ?site=mare|southpole|lavatube  skip site select and land immediately
 *  ?seed=42                       deterministic world + events
 *  ?debug                         expose window.__game
 *  ?nolock                        walk mode without pointer lock (headless tests)
 *  ?lowfx                         drop AO for weak GPUs */
import { Game } from './core/game';
import { mountUI } from './ui/mount';
import { attachDebug } from './debug';
import { SITES, type SiteId } from './data/sites';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('world') as HTMLCanvasElement;

const game = new Game(canvas, {
  nolock: params.has('nolock'),
  lowfx: params.has('lowfx'),
  seed: Number(params.get('seed') ?? Math.floor(Math.random() * 1e9)),
});

mountUI(game);

if (params.has('debug')) attachDebug(game);

const siteParam = params.get('site');
if (siteParam && siteParam in SITES) {
  game.startNew(siteParam as SiteId);
}
