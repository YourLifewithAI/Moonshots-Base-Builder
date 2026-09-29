/** The render style this session draws with, fixed at boot (Game's
 *  constructor, from main.ts: ?style= or the menu's setting). Mesh creators
 *  that differ by style (terrain colours, rock and berm tints, building
 *  palettes) ask here; everything else takes its material from the registry
 *  (world/materials.ts), which knows the style too. */
import type { RenderStyle } from './settings';

let active: RenderStyle = 'classic';

export function setActiveStyle(style: RenderStyle) {
  active = style;
}

export function activeStyle(): RenderStyle {
  return active;
}

/** Is the classic look drawing (not High detail)? */
export function classicActive(): boolean {
  return active === 'classic';
}

/** @deprecated moved to core/settings.ts (this file goes with the game.ts pass) */
export { RESUME_KEY } from './settings';
