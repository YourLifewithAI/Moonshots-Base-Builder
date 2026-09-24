/** Walk-mode helmet visor (docs/06 §9, formerly deferred): a DOM layer at the
 *  back of #walk-hud, so the reticle and helmet readouts sit on top of it
 *  and it shows and hides with the rest of the walk HUD. */
import './visor.css';

export function mountVisor(layer: HTMLElement) {
  const walkHud = layer.querySelector('#walk-hud');
  if (!walkHud || walkHud.querySelector('#visor')) return;
  const visor = document.createElement('div');
  visor.id = 'visor';
  visor.setAttribute('aria-hidden', 'true');
  walkHud.prepend(visor);
}
