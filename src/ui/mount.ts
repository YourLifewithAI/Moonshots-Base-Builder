/** Assemble the DOM overlay. Canvas renders the world; everything else is
 *  HTML/CSS on top (free text, layout, focus, accessibility). */
import './ui.css';
import type { Game } from '../core/game';
import { mountHud } from './hud';
import { mountInfoPanel } from './infoPanel';
import { mountPalette } from './palette';
import { mountDefeat, mountSiteSelect, mountVictory } from './screens';
import { mountTechTree } from './techTree';
import { mountMenu } from './menu';
import { $phase } from './stores';
import { mountVisor } from './visor';
import { sfx } from '../audio/sfx';

export function mountUI(game: Game) {
  const root = document.getElementById('ui-root')!;
  // first: its capture key handler must run before every other screen's
  mountMenu(root, game);
  // every control answers with a switch click
  root.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button, .chip, .alert, .tech-card, .site-card, #milestones')) sfx.play('tick');
  });
  const hudLayer = document.createElement('div');
  hudLayer.id = 'hud-layer';
  hudLayer.style.display = 'none';
  root.appendChild(hudLayer);

  mountHud(hudLayer, game);
  mountVisor(hudLayer);
  mountInfoPanel(hudLayer, game);
  mountPalette(hudLayer, game);
  mountTechTree(hudLayer, game);
  mountVictory(root, game);
  mountDefeat(root);
  mountSiteSelect(root, game);

  $phase.subscribe((p) => {
    hudLayer.style.display = p === 'playing' ? 'block' : 'none';
  });
}
