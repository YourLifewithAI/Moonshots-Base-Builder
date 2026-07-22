/** Assemble the DOM overlay. Canvas renders the world; everything else is
 *  HTML/CSS on top (free text, layout, focus, accessibility). */
import './ui.css';
import type { Game } from '../core/game';
import { mountHud } from './hud';
import { mountPalette } from './palette';
import { mountSiteSelect, mountTechTree, mountVictory } from './screens';
import { $phase } from './stores';

export function mountUI(game: Game) {
  const root = document.getElementById('ui-root')!;
  const hudLayer = document.createElement('div');
  hudLayer.id = 'hud-layer';
  hudLayer.style.display = 'none';
  root.appendChild(hudLayer);

  mountHud(hudLayer, game);
  mountPalette(hudLayer, game);
  mountTechTree(hudLayer, game);
  mountVictory(root, game);
  mountSiteSelect(root, game);

  $phase.subscribe((p) => {
    hudLayer.style.display = p === 'playing' ? 'block' : 'none';
  });
}
