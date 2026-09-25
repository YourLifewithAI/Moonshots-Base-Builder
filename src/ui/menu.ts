/** The in-game menu — Esc with nothing left to cancel, or the ☰ button:
 *  resume, save, new mission, graphics, audio and the controls list. The sim
 *  pauses while it is open and resumes exactly as it was left. Choices
 *  persist through core/settings.ts and apply at the next boot before the
 *  first frame (main.ts).
 *
 *  Graphics: the render style first — Classic (the default: flat colours,
 *  the isometric camera, no effects) or High detail. A switch saves the
 *  game, stores the choice and reloads straight back into it (the canvas's
 *  context attributes are fixed at creation). The FX ladder and safe mode
 *  belong to High detail and show only there (safe mode also shows in
 *  Classic while the render check has it on, so it can be turned off).
 *
 *  High detail: the running FX level is shown as the ladder left it. Lowering is
 *  always one click; raising is the player's explicit pick, and a level that
 *  failed a render check on this GPU (in any session) asks for a second
 *  click. A raise — and turning safe mode off — is checked by the black-frame
 *  check on the next frames that can tell, kept once one passes, and undone
 *  if the frame comes out black; the game (not the menu) stores those. */
import type { Game } from '../core/game';
import { loadSettings, saveSettings } from '../core/settings';
import { sfx } from '../audio/sfx';
import { el } from './hud';
import { $announce, $defeat, $menuOpen, $phase, $time } from './stores';

const FX_LEVELS = [
  { name: 'Full', desc: 'HDR buffers, ambient occlusion, bloom and film' },
  { name: 'Standard', desc: 'standard buffers with ambient occlusion' },
  { name: 'No AO', desc: 'standard buffers, no ambient occlusion' },
  { name: 'Plain', desc: 'no post effects at all' },
];

const STYLES = [
  { id: 'classic', name: 'Classic', desc: 'flat colours, a fixed isometric view, no effects — made to run well on any GPU' },
  { id: 'detailed', name: 'High detail', desc: 'shadows, ambient occlusion, bloom and a free camera; steps down on its own if the GPU struggles' },
] as const;

/** Camera lines by style: the isometric view steps, the free one orbits. */
const CAMERA_KEYS: Record<'classic' | 'detailed', [string, string][]> = {
  classic: [
    ['Right-drag · middle-drag', 'pan'],
    ['Wheel', 'zoom — five steps'],
    ['W A S D · arrows', 'pan the camera'],
    ['Q · E', 'turn the view 90°'],
  ],
  detailed: [
    ['Drag · right-drag · wheel', 'pan · orbit · zoom'],
    ['W A S D · arrows', 'pan the camera'],
    ['Q · E', 'orbit'],
  ],
};

export const controlsFor = (style: 'classic' | 'detailed'): [string, string][] => [
  ['Click', 'place · select a building'],
  ['⇧ Click', 'keep placing'],
  ['R', 'rotate while placing'],
  ['Right-click · Esc', 'stop placing · close the inspector'],
  ...CAMERA_KEYS[style],
  ['F', 'focus the selection'],
  ['H · Home', 'back to the Lander'],
  ['Space', 'pause'],
  ['1 · 2 · 3', 'speed 1× · 3× · 10×'],
  ['T', 'research tree'],
  ['M', 'Lunar Map — surveys and outposts'],
  ['I', 'deposit overlay'],
  ['Click a rover', 'inspect it · Send to… then click a site'],
  ['Site · Summon', 'another rover onto a build (Release lets one go)'],
  ['Excavator · Dig at…', 'click a deposit or mapped ground · Esc cancels'],
  ['Tab', 'walk the surface · command view'],
  ['On foot', 'W A S D move · Space jump · ⇧ run · E inspect'],
  ['Esc', 'this menu'],
];

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
            <div class="seg seg-2" id="menu-style">${STYLES.map((st) =>
              `<button class="btn" data-style="${st.id}" title="${st.name} — ${st.desc}">${st.name}</button>`).join('')}</div>
            <div class="menu-note" id="menu-style-note"></div>
            <div class="seg" id="menu-fx">${FX_LEVELS.map((l, n) =>
              `<button class="btn" data-fx="${n}" title="FX ${n} — ${l.desc}"><b>${n}</b>${l.name}</button>`).join('')}</div>
            <div class="menu-note" id="menu-fx-note"></div>
            <div class="menu-row" id="menu-safe-row">
              <span>Safe render mode</span>
              <button class="btn" data-act="safe" id="menu-safe" aria-pressed="false">Off</button>
            </div>
            <div class="menu-note" id="menu-safe-note"></div>
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
        </div>
        <div class="menu-col">
          <section>
            <span class="label">Controls</span>
            <div class="keys" id="menu-keys">${controlsFor(game.opts.style).map(([k, v]) =>
              `<kbd>${k}</kbd><span>${v}</span>`).join('')}</div>
          </section>
        </div>
      </div>
    </div>`;
  root.appendChild(veil);
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => veil.querySelector(sel) as T;
  const note = $('#menu-note');
  const confirmRow = $('#menu-confirm');
  const fxNote = $('#menu-fx-note');
  const safeBtn = $<HTMLButtonElement>('#menu-safe');
  const safeNote = $('#menu-safe-note');
  const vol = $<HTMLInputElement>('#menu-vol');
  const volVal = $('#menu-vol-val');
  const muteBtn = $<HTMLButtonElement>('#menu-mute');
  const musicVol = $<HTMLInputElement>('#menu-music');
  const musicVal = $('#menu-music-val');
  const fxVol = $<HTMLInputElement>('#menu-effects');
  const fxVal = $('#menu-effects-val');

  /** a raise to a level that failed a render check waits for a second click */
  let confirmFx: number | null = null;

  const styleNote = $('#menu-style-note');
  /** a style switch is saving and reloading */
  let switching = false;

  const renderStyle = (st: ReturnType<Game['renderStatus']>) => {
    const running = game.opts.style;
    veil.querySelectorAll<HTMLButtonElement>('[data-style]').forEach((b) => {
      b.classList.toggle('active', b.dataset.style === running);
      b.disabled = switching;
    });
    const cur = STYLES.find((x) => x.id === running)!;
    styleNote.textContent = switching ? 'Saving and reloading…'
      : `${cur.name}: ${cur.desc}. Switching saves the game and reloads.`;
    // the FX ladder and safe mode are High detail's; Classic shows safe mode
    // only while the render check has it on
    const detailed = running === 'detailed';
    for (const id of ['#menu-fx', '#menu-fx-note']) $(id).style.display = detailed ? '' : 'none';
    const safeShown = detailed || st.safe;
    $('#menu-safe-row').style.display = safeShown ? '' : 'none';
    safeNote.style.display = safeShown ? '' : 'none';
  };

  const renderGfx = () => {
    const st = game.renderStatus();
    renderStyle(st);
    const choice = loadSettings().fx ?? 0;
    veil.querySelectorAll<HTMLButtonElement>('[data-fx]').forEach((b) => {
      const n = Number(b.dataset.fx);
      b.classList.toggle('active', n === st.level);
      b.classList.toggle('mine', n === choice);
      b.classList.toggle('failed', st.failed.includes(n));
      b.classList.toggle('confirm', n === confirmFx);
    });
    const auto = st.ladder > choice;
    const restore = `<button class="btn" data-act="restore" id="menu-fx-restore">Restore FX ${choice}</button>`;
    const html = confirmFx !== null
      ? `FX ${confirmFx} drew a black frame or failed to build on this GPU before. Try it anyway? It is checked at once, kept only if it draws, and a black frame puts FX ${st.ladder} back. <button class="btn" data-act="try" data-level="${confirmFx}" id="menu-fx-try">Try FX ${confirmFx}</button>`
      : st.safe
        ? `Safe mode draws with no effects. Turning it off returns to FX ${st.ladder}: ${FX_LEVELS[st.ladder].desc}.`
        : st.checking
          ? `Checking FX ${st.level}: ${FX_LEVELS[st.level].desc}. Kept once a frame draws; a black frame goes straight back.`
          : auto && !st.reason && st.level <= st.floor
            ? `Held at FX ${st.level} by the ?lowfx address. Your setting: FX ${choice} ◆ ${restore}`
            : auto
              ? `<span class="menu-auto">AUTO</span> Lowered to FX ${st.level} — ${st.reason || 'a render check in an earlier session'}. Your setting: FX ${choice} ◆ ${restore}`
              : `FX ${st.level}: ${FX_LEVELS[st.level].desc}. A black-frame check steps down on its own if the frame comes out black.`;
    if (fxNote.dataset.html !== html) { fxNote.dataset.html = html; fxNote.innerHTML = html; }
    fxNote.dataset.level = String(st.level);
    safeBtn.textContent = st.safe ? 'On' : 'Off';
    safeBtn.classList.toggle('active', st.safe);
    safeBtn.setAttribute('aria-pressed', String(st.safe));
    safeNote.textContent = st.safe && st.safeAuto
      ? `Switched on by the render check (GPU issue detected). Turning it off retries lit rendering at FX ${st.ladder}; it stays off once a frame draws, and a black frame switches it back on.`
      : st.safe ? 'Unlit materials, no shadows, no post effects — draws on any GPU.'
      : st.checking ? 'Checking the lit frame — safe mode switches back on if it comes out black.'
      : 'The last resort for a GPU that shows black: unlit materials, no shadows, no post effects.';
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
    const tipsBtn = $<HTMLButtonElement>('#menu-tips');
    tipsBtn.textContent = s.tips ? 'On' : 'Off';
    tipsBtn.classList.toggle('active', s.tips);
    tipsBtn.setAttribute('aria-pressed', String(s.tips));
  };

  const pickFx = (n: number) => {
    const st = game.renderStatus();
    if (n < st.ladder && st.failed.includes(n) && confirmFx !== n) { confirmFx = n; renderGfx(); return; }
    confirmFx = null;
    saveSettings({ fx: n });
    if (n !== st.ladder) game.setFxLevel(n);
    renderGfx();
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
      confirmFx = null;
      confirmRow.style.display = 'none';
      note.textContent = '';
      renderGfx();
      renderAudio();
      veil.style.display = 'flex';
      poll = window.setInterval(renderGfx, 500); // the ladder can still step while paused
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
    const fx = t.closest<HTMLElement>('[data-fx]');
    if (fx) { pickFx(Number(fx.dataset.fx)); return; }
    const style = t.closest<HTMLButtonElement>('[data-style]');
    if (style) {
      const want = style.dataset.style as 'classic' | 'detailed';
      if (want === game.opts.style || switching) return;
      switching = true;
      renderGfx();
      void game.switchStyle(want);
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
      case 'restore': pickFx(loadSettings().fx ?? 0); break;
      case 'try': pickFx(Number(b.dataset.level)); break;
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
