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

/** sessionStorage flag: a style switch saved the game and reloaded, so the
 *  next boot continues it (main.ts) instead of showing the title screen. */
export const RESUME_KEY = 'mbb-resume';
