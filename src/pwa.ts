/** Installable and offline (docs/07 §13.7): a production build registers
 *  the service worker the build wrote (scripts/pwa.mjs → sw.js). The dev
 *  server — and every test on it — never does; `?nosw` skips it too.
 *
 *  A new deploy installs behind the running version; the worker waits, and
 *  a small chip offers it: "Update ready — tap to reload". The tap saves the
 *  game, lets the new worker take over and reloads straight back into the
 *  base (the render-style switch's resume flag). */
import type { Game } from './core/game';
import { RESUME_KEY } from './core/style';
import { $phase } from './ui/stores';

let waiting: ServiceWorker | null = null;
let chip: HTMLButtonElement | null = null;
let reloading = false;

export function registerPwa(game: Game) {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  if (new URLSearchParams(location.search).has('nosw')) return;
  const sw = navigator.serviceWorker;
  const register = () => {
    sw.register('./sw.js').then((reg) => {
      const offer = (w: ServiceWorker | null) => {
        // the very first install has no page version to replace
        if (w && sw.controller) { waiting = w; showChip(game); }
      };
      if (reg.waiting) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
      });
      // a phone keeps the page for days: look again whenever it comes back
      document.addEventListener('visibilitychange', () => { if (!document.hidden) void reg.update().catch(() => {}); });
    }).catch((e) => console.warn('[MOONSHOTS] Service worker not registered:', e));
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
  // the new version took over: back into the saved base (the address's
  // site shortcut would start a new one instead)
  sw.addEventListener('controllerchange', () => {
    if (!waiting || reloading) return;
    reloading = true;
    const url = new URL(location.href);
    for (const k of ['site', 'exp']) url.searchParams.delete(k);
    location.assign(url.toString());
  });
}

function showChip(game: Game) {
  if (chip) return;
  chip = document.createElement('button');
  chip.id = 'update-chip';
  chip.className = 'btn panel';
  chip.textContent = 'Update ready — tap to reload';
  chip.title = 'A new version of the game is ready: the base is saved first';
  chip.addEventListener('click', async () => {
    if (!chip || !waiting) return;
    chip.disabled = true;
    chip.textContent = 'Saving…';
    if ($phase.get() === 'playing') {
      await game.doSave();
      try { sessionStorage.setItem(RESUME_KEY, '1'); } catch { /* the title screen, then */ }
    }
    waiting.postMessage({ type: 'skip-waiting' });
  });
  document.getElementById('ui-root')?.appendChild(chip);
}
