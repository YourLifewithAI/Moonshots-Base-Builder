/** The in-game menu — Esc with nothing left to cancel, or the ☰ button:
 *  resume, save, new mission, graphics, audio and the controls list. The sim
 *  pauses while it is open and resumes exactly as it was left. Choices
 *  persist through core/settings.ts and apply at the next boot before the
 *  first frame (main.ts).
 *
 *  Graphics: one row, safe render mode — the last resort for a GPU that shows
 *  black (unlit materials, no effects). The game turns it on by itself when
 *  the black-frame check fires (it says so here); turning it off retries lit
 *  rendering, kept once a frame draws and undone if the frame comes out
 *  black. The game (not the menu) stores those. */
import type { Game } from '../core/game';
import { loadSettings, saveSettings, storedTouch } from '../core/settings';
import { FLARE_PAUSE_LABEL } from '../data/spaceWeather';
import { autoTouch, touchOn, type TouchChoice } from '../core/touch';
import { sfx } from '../audio/sfx';
import { el } from './hud';
import { $announce, $defeat, $menuOpen, $phase, $time } from './stores';

/** Camera lines: the fixed isometric view. */
const CAMERA_KEYS: [string, string][] = [
  ['Right-drag · middle-drag', 'pan'],
  ['Wheel', 'zoom'],
  ['W A S D · arrows', 'pan the camera'],
  ['Q · E', 'turn the view 90°'],
  ['V', 'tilt the view — low or high'],
];

/** The keyboard controls (one table: there is one camera). */
export const CONTROLS: [string, string][] = [
  ['Click', 'place · select a building'],
  ['⇧ Click', 'keep placing'],
  ['R', 'rotate while placing'],
  ['Right-click · Esc', 'stop placing · close the inspector'],
  ...CAMERA_KEYS,
  ['F', 'focus the selection'],
  ['H · Home', 'back to the Lander'],
  ['Space', 'pause'],
  ['1 · 2 · 3', 'speed 1× · 3× · 10× (resumes when paused)'],
  ['T', 'research tree'],
  ['M', 'Lunar Map — surveys and outposts'],
  ['I', 'deposit overlay'],
  ['N', 'road tool: drag out from a road · Alt-drag removes'],
  ['B', 'Builder — orders and standing rules'],
  ['G', 'Hazards — risks, counters, the network'],
  ['O', 'Space weather — flares and the arrays’ choice by class'],
  ['Ctrl-click a card', 'order one: the rovers choose the site (⇧ ×3)'],
  ['Enter while placing', 'let the rovers choose the site'],
  ['Click a rover', 'inspect it · Send to… then click a site'],
  ['Site · Summon', 'another rover onto a build (Release lets one go)'],
  ['Excavator · Dig at…', 'click a deposit or mapped ground · Esc cancels'],
  ['Esc', 'this menu'],
];

/** Touch mode's controls (docs/07 §13): what each key became. */
export const TOUCH_CONTROLS: [string, string][] = [
  ['Tap', 'select a building, rover or site · empty ground clears'],
  ['Hold', 'what is it: a building’s card · a deposit’s card'],
  ['Drag', 'pan the view (a drag never selects)'],
  ['Pinch', 'zoom'],
  ['Twist · ⟲ ⟳', 'turn the view 90°'],
  ['▱ Tilt', 'tilt the view — low or high'],
  ['⌂ Home · ⊙ Focus', 'back to the Lander · to the selection'],
  ['◌ Ore', 'deposit overlay'],
  ['Build', 'the palette · tap a card: its ghost in the middle'],
  ['Drag the ghost', 'move it · ⟳ rotate · ✓ place · ✕ cancel'],
  ['Hold a card · Order', 'the rovers choose the site'],
  ['Keep', 'keep placing after ✓'],
  ['Road', 'drag out from a road · Remove toggles · ✕ done'],
  ['Tree', 'tap a tech to see it, again to queue · hold: the whole path'],
  ['Map · Builder · Hazards', 'the Lunar Map · orders and rules · risks and counters'],
  ['❚❚ · 1×', 'pause · speed 1× → 3× → 10×'],
  ['☰', 'this menu'],
];

const TOUCH_NAME: Record<TouchChoice, string> = { auto: 'Auto', on: 'On', off: 'Off' };

export function mountMenu(root: HTMLElement, game: Game) {
  const veil = el('div', 'interactive');
  veil.id = 'menu';
  veil.setAttribute('role', 'dialog');
  veil.setAttribute('aria-modal', 'true');
  veil.setAttribute('aria-label', 'Mission menu');
  veil.innerHTML = `
    <div class="menu-panel panel">
      <div class="menu-head"><b>MISSION MENU</b><span class="label">Simulation paused</span></div>
      <div class="menu-body">
        <div class="menu-col">
          <section class="menu-actions">
            <button class="btn primary" data-act="resume">▸ Resume</button>
            <button class="btn" data-act="save">Save now</button>
            <button class="btn" data-act="new">New mission…</button>
            <div class="menu-confirm" id="menu-confirm" style="display:none">
              <div class="menu-note">Abandon this base? Its save is erased and you choose a new landing site.</div>
              <div class="menu-row">
                <button class="btn" data-act="new-yes" id="menu-new-yes">Abandon base</button>
                <button class="btn" data-act="new-no">Keep playing</button>
              </div>
            </div>
            <div class="menu-note" id="menu-note"></div>
          </section>
          <section>
            <span class="label">Graphics</span>
            <div class="menu-row" id="menu-safe-row">
              <span>Safe render mode</span>
              <button class="btn" data-act="safe" id="menu-safe" aria-pressed="false">Off</button>
            </div>
            <div class="menu-note" id="menu-safe-note"></div>
          </section>
          <section>
            <span class="label">Touch controls</span>
            <div class="seg seg-3" id="menu-touch">${(['auto', 'on', 'off'] as const).map((c) =>
              `<button class="btn" data-touch="${c}">${TOUCH_NAME[c]}</button>`).join('')}</div>
            <div class="menu-note" id="menu-touch-note"></div>
          </section>
          <section>
            <span class="label">Audio</span>
            <div class="menu-row">
              <span class="menu-vol-k">Master</span>
              <input type="range" id="menu-vol" min="0" max="100" step="5" aria-label="Master volume">
              <span class="mono" id="menu-vol-val"></span>
              <button class="btn" data-act="mute" id="menu-mute" aria-pressed="false">Mute</button>
            </div>
            <div class="menu-row">
              <span class="menu-vol-k">Music</span>
              <input type="range" id="menu-music" min="0" max="100" step="5" aria-label="Music volume">
              <span class="mono" id="menu-music-val"></span>
            </div>
            <div class="menu-row">
              <span class="menu-vol-k">Effects</span>
              <input type="range" id="menu-effects" min="0" max="100" step="5" aria-label="Effects volume">
              <span class="mono" id="menu-effects-val"></span>
            </div>
          </section>
          <section>
            <span class="label">Guidance</span>
            <div class="menu-row">
              <span>Discovery pop-ups &amp; era explainers</span>
              <button class="btn" data-act="tips" id="menu-tips" aria-pressed="true">On</button>
            </div>
          </section>
          <section id="menu-pause">
            <span class="label">Pause on…</span>
            <div class="menu-row" data-family="era">
              <span><span class="nf-g" aria-hidden="true">⚑</span> Era explainers</span>
              <span class="mono menu-fixed" id="menu-pause-era">Until Continue</span>
            </div>
            <div class="menu-row" data-family="weather">
              <span><span class="nf-g" aria-hidden="true">☉</span> Flare warnings</span>
              <button class="btn" data-act="pause-flares" id="menu-pause-flares" title="M and X · All · Off">M and X</button>
            </div>
            <div class="menu-row" data-family="hazard">
              <span><span class="nf-g" aria-hidden="true">⚠</span> Hazard drills</span>
              <button class="btn" data-act="pause-drills" id="menu-pause-drills" aria-pressed="true">On</button>
            </div>
            <div class="menu-row" data-family="hazard">
              <span><span class="nf-g" aria-hidden="true">⚠</span> New hazards</span>
              <button class="btn" data-act="pause-hz" id="menu-pause-hz" aria-pressed="true">On</button>
            </div>
            <div class="menu-row" data-family="hazard">
              <span><span class="nf-g" aria-hidden="true">⚠</span> Every lethal warning</span>
              <button class="btn" data-act="pause-lethal" id="menu-pause-lethal" aria-pressed="false">Off</button>
            </div>
            <div class="menu-note">Research ✦ and field ◎ notifications never pause the game.</div>
          </section>
        </div>
        <div class="menu-col">
          <section>
            <span class="label">Controls</span>
            <div class="keys" id="menu-keys">${(touchOn() ? TOUCH_CONTROLS : CONTROLS).map(([k, v]) =>
              `<kbd>${k}</kbd><span>${v}</span>`).join('')}</div>
          </section>
        </div>
      </div>
    </div>`;
  root.appendChild(veil);
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => veil.querySelector(sel) as T;
  const note = $('#menu-note');
  const confirmRow = $('#menu-confirm');
  const safeBtn = $<HTMLButtonElement>('#menu-safe');
  const safeNote = $('#menu-safe-note');
  const vol = $<HTMLInputElement>('#menu-vol');
  const volVal = $('#menu-vol-val');
  const muteBtn = $<HTMLButtonElement>('#menu-mute');
  const musicVol = $<HTMLInputElement>('#menu-music');
  const musicVal = $('#menu-music-val');
  const fxVol = $<HTMLInputElement>('#menu-effects');
  const fxVal = $('#menu-effects-val');

  const renderGfx = () => {
    const st = game.renderStatus();
    safeBtn.textContent = st.safe ? 'On' : 'Off';
    safeBtn.classList.toggle('active', st.safe);
    safeBtn.setAttribute('aria-pressed', String(st.safe));
    safeNote.textContent = st.safe && st.safeAuto
      ? 'Switched on by the render check (GPU issue detected). Turning it off retries lit rendering; it stays off once a frame draws, and a black frame switches it back on.'
      : st.safe ? 'Unlit materials, no effects — draws on any GPU.'
      : st.checking ? 'Checking the lit frame — safe mode switches back on if it comes out black.'
      : 'The last resort for a GPU that shows black: unlit materials, no effects.';
  };

  /** a touch-mode switch is saving and reloading */
  let touchSwitching = false;
  const renderTouch = () => {
    const choice = storedTouch();
    veil.querySelectorAll<HTMLButtonElement>('[data-touch]').forEach((b) => {
      b.classList.toggle('active', b.dataset.touch === choice);
      b.disabled = touchSwitching;
    });
    const now = touchOn() ? 'on' : 'off';
    $('#menu-touch-note').textContent = touchSwitching ? 'Saving and reloading…'
      : `${choice === 'auto' ? `Auto: on for a touch screen with no mouse — ${autoTouch() ? 'this one' : 'not this one'}. ` : ''}` +
        `Touch controls are ${now}. Switching saves the game and reloads.`;
  };

  const renderAudio = () => {
    const s = loadSettings();
    const pct = Math.round(s.volume * 100);
    if (vol.value !== String(pct)) vol.value = String(pct);
    volVal.textContent = `${pct}%`;
    for (const [input, out, v] of [[musicVol, musicVal, s.music], [fxVol, fxVal, s.effects]] as const) {
      const p = Math.round(v * 100);
      if (input.value !== String(p)) input.value = String(p);
      out.textContent = `${p}%`;
    }
    muteBtn.textContent = s.muted ? 'Unmute' : 'Mute';
    muteBtn.classList.toggle('active', s.muted);
    muteBtn.setAttribute('aria-pressed', String(s.muted));
    for (const [id, on] of [['#menu-tips', s.tips], ['#menu-pause-hz', s.pauseHazards], ['#menu-pause-lethal', s.pauseLethal],
      ['#menu-pause-drills', s.pauseDrills]] as const) {
      const btn = $<HTMLButtonElement>(id);
      btn.textContent = on ? 'On' : 'Off';
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    }
    const pf = $<HTMLButtonElement>('#menu-pause-flares');
    pf.textContent = FLARE_PAUSE_LABEL[s.pauseFlares];
    pf.classList.toggle('active', s.pauseFlares !== 'off');
  };

  // open: pause (remembering how it was); close: put it back. A save made
  // meanwhile (Save now, autosave, tab hidden) records the game as it was
  // before the menu, not paused by it
  let resumePaused: boolean | null = null;
  let poll = 0;
  const show = (open: boolean) => {
    if (open === (veil.style.display === 'flex')) return;
    if (open) {
      resumePaused = $time.get().paused;
      game.savePausedAs = resumePaused;
      if (!resumePaused) game.actions.push({ kind: 'setPaused', paused: true });
      confirmRow.style.display = 'none';
      note.textContent = '';
      renderGfx();
      renderAudio();
      renderTouch();
      veil.style.display = 'flex';
      poll = window.setInterval(renderGfx, 500); // the render check can still answer while paused
      $<HTMLButtonElement>('[data-act="resume"]').focus({ preventScroll: true });
    } else {
      veil.style.display = 'none';
      window.clearInterval(poll);
      if (resumePaused === false) game.actions.push({ kind: 'setPaused', paused: false });
      resumePaused = null;
      game.savePausedAs = null;
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  };
  $menuOpen.subscribe(show);
  $phase.subscribe((p) => { if (p !== 'playing') $menuOpen.set(false); });
  // "Simulation paused" is heard too: the hum ducks and the suit stops
  // breathing while the menu is up or the game stands paused
  const duck = () => sfx.setDucked($menuOpen.get() || ($phase.get() === 'playing' && $time.get().paused));
  $menuOpen.subscribe(duck);
  $time.subscribe(duck);
  $phase.subscribe(duck);

  veil.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === veil) { $menuOpen.set(false); return; } // a click outside the panel resumes
    const tc = t.closest<HTMLButtonElement>('[data-touch]');
    if (tc) {
      if (touchSwitching) return;
      const want = tc.dataset.touch as TouchChoice;
      touchSwitching = game.touchSwitchReloads(want);
      renderTouch();
      void game.switchTouch(want);
      return;
    }
    const b = t.closest<HTMLButtonElement>('button[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'resume': $menuOpen.set(false); break;
      case 'save':
        if ($defeat.get()) { note.textContent = 'A lost mission is not saved.'; break; }
        note.textContent = 'Saving…';
        void game.doSave().then(() => {
          note.textContent = `Saved · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        });
        break;
      case 'new':
        confirmRow.style.display = confirmRow.style.display === 'none' ? 'block' : 'none';
        break;
      case 'new-no': confirmRow.style.display = 'none'; break;
      case 'new-yes':
        b.disabled = true;
        b.textContent = 'Leaving orbit…';
        void game.abandonMission();
        break;
      case 'safe':
        // the game stores it: on at once, off once a lit frame has drawn
        if (game.safeModeOn) game.disableSafeMode();
        else game.enableSafeMode(false);
        renderGfx();
        break;
      case 'tips': {
        const tips = !loadSettings().tips;
        saveSettings({ tips });
        if (!tips) $announce.set([]);
        renderAudio();
        break;
      }
      case 'pause-hz': saveSettings({ pauseHazards: !loadSettings().pauseHazards }); renderAudio(); break;
      case 'pause-lethal': saveSettings({ pauseLethal: !loadSettings().pauseLethal }); renderAudio(); break;
      case 'pause-drills': saveSettings({ pauseDrills: !loadSettings().pauseDrills }); renderAudio(); break;
      case 'pause-flares': {
        const next = { mx: 'all', all: 'off', off: 'mx' } as const;
        saveSettings({ pauseFlares: next[loadSettings().pauseFlares] });
        renderAudio();
        break;
      }
      case 'mute': {
        const muted = !loadSettings().muted;
        saveSettings({ muted });
        sfx.setMuted(muted);
        renderAudio();
        break;
      }
    }
  });
  vol.addEventListener('input', () => {
    const volume = Number(vol.value) / 100;
    saveSettings({ volume });
    sfx.setVolume(volume);
    renderAudio();
  });
  vol.addEventListener('change', () => sfx.play('tick'));
  musicVol.addEventListener('input', () => {
    const music = Number(musicVol.value) / 100;
    saveSettings({ music });
    sfx.setMusicVolume(music);
    renderAudio();
  });
  fxVol.addEventListener('input', () => {
    const effects = Number(fxVol.value) / 100;
    saveSettings({ effects });
    sfx.setEffectsVolume(effects);
    renderAudio();
  });
  fxVol.addEventListener('change', () => sfx.play('tick'));

  // capture, registered before the other screens: while open, the menu owns
  // the keyboard (Esc closes it; nothing reaches the camera, the tree or the
  // sim). A held Esc does not close what its first press opened. Tab walks
  // the menu's own controls only, never onto the HUD behind the veil
  window.addEventListener('keydown', (e) => {
    if (!$menuOpen.get()) return;
    e.stopImmediatePropagation();
    if (e.code === 'Escape') { e.preventDefault(); if (!e.repeat) $menuOpen.set(false); return; }
    if (e.code === 'Tab') {
      e.preventDefault();
      const stops = [...veil.querySelectorAll<HTMLElement>('button, input')]
        .filter((x) => !(x as HTMLButtonElement).disabled && x.offsetParent !== null);
      if (!stops.length) return;
      const i = stops.indexOf(document.activeElement as HTMLElement);
      const next = i < 0 ? (e.shiftKey ? stops.length - 1 : 0) : (i + (e.shiftKey ? stops.length - 1 : 1)) % stops.length;
      stops[next].focus({ preventScroll: true });
    }
  }, true);
  // a click or script that moves focus behind the veil is brought back
  document.addEventListener('focusin', (e) => {
    if ($menuOpen.get() && !veil.contains(e.target as Node)) {
      $<HTMLButtonElement>('[data-act="resume"]').focus({ preventScroll: true });
    }
  });
}
