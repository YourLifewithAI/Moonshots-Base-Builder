/** Space weather's UI (docs/16 §10): the ☉ chip under the era chip, the flare
 *  pop-up (the arrays' one decision, §5.2 and §10.3; a touch layout under
 *  html.touch), the Space Weather panel [O] (panel key `weather`), and the
 *  Solar Array inspector's lines (§10.7). Everything comes from $weather
 *  (core/spaceWeather.ts weatherView); every button is an action. DOM is
 *  rebuilt only when its shape changes, so a click is never lost under a
 *  running sim. Monochrome: open, half and solid squares for the classes,
 *  inversion for the choice and for an X, a dashed border for a watch. */
import './weather.css';
import type { Game } from '../core/game';
import type { BuildingState } from '../core/state';
import type { ChoicePreview, WeatherView } from '../core/spaceWeather';
import type { ArrayChoice, FlareClass } from '../data/spaceWeather';
import { FLARE_EFFECTS, SPACE_WEATHER } from '../data/spaceWeather';

const SPACE_WEATHER_ALERT = FLARE_EFFECTS.alertAt;
import { fmtClock } from '../core/daynight';
import { el } from './hud';
import { $hazards, $resourcePanel, $weather, $placing, $mode } from './stores';
import { counterButton, counterClick } from './hazardsPanel';
import { capabilityView } from '../core/flareEffects';
import { SITES } from '../data/sites';
import { forecastClick, mountForecastSections, refreshForecast } from './forecastPanel';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/** a preview line: **bold** is the destroyed count (§10.3) */
const rich = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const plain = (s: string) => s.replace(/\*\*/g, '');

function setText(root: ParentNode, sel: string, text: string) {
  const e = root.querySelector(sel);
  if (e && e.textContent !== text) e.textContent = text;
}
function setHtml(root: ParentNode, sel: string, html: string) {
  const e = root.querySelector(sel) as HTMLElement | null;
  if (e && e.dataset.h !== html) { e.dataset.h = html; e.innerHTML = html; }
}

const isTouch = () => document.documentElement.classList.contains('touch');
const hide = (e: Element | null, off: boolean) => { if (e) (e as HTMLElement).style.display = off ? 'none' : ''; };

const CLASS_GLYPH: Record<FlareClass, string> = { C: SPACE_WEATHER.classes.C.glyph, M: SPACE_WEATHER.classes.M.glyph, X: SPACE_WEATHER.classes.X.glyph };

/** the option key a choice selects in the pop-up */
const keyOf = (c: ArrayChoice) => (c.mode === 'portion' ? `p${Math.round((c.p ?? 0) * 100)}` : c.mode);
const choiceOf = (k: string): ArrayChoice => (k.startsWith('p') ? { mode: 'portion', p: Number(k.slice(1)) / 100 } : { mode: k as ArrayChoice['mode'] });
const shortChoice = (c: ArrayChoice) => (c.mode === 'run' ? 'keep all running' : c.mode === 'stow' ? 'stow all'
  : c.mode === 'feed' ? 'stow all but the feed' : `stow ${Math.round((c.p ?? 0) * 100)}%`);

/** the flare's own counters (Recall machines, Checkpoint research, Shut down exposed: docs/16 §4.5–4.7),
 *  then those of the hazards riding it (DOSE's Recall EVA; bit flips' Dock fleet, which Recall machines covers) */
function alsoCounters(): string {
  const own = $weather.get()?.fx.also ?? [];
  const v = $hazards.get();
  const hz = v ? v.active.filter((a) => (a.kind === 'dose' || a.kind === 'firmware') && a.phase === 'telegraph')
    .flatMap((a) => a.counters).filter((c) => !(c.counter === 'dockFleet' && own.some((o) => o.counter === 'flareRecall'))) : [];
  return [...own, ...hz].map(counterButton).join('');
}

export function mountWeatherPanel(root: HTMLElement, game: Game) {
  // ── the chip, under the era chip, beside the hazard chip ──
  const chip = el('button', 'btn panel interactive mono') as HTMLButtonElement;
  chip.id = 'weather-chip';
  const eraChip = root.querySelector('#era-chip');
  const hzChip = root.querySelector('#hazard-chip');
  const timeCol = root.querySelector('#time-controls');
  if (hzChip) hzChip.after(chip);
  else if (eraChip) eraChip.after(chip);
  else if (timeCol) timeCol.insertBefore(chip, timeCol.querySelector('#alerts'));
  else root.appendChild(chip);
  const togglePanel = () => $resourcePanel.set($resourcePanel.get() === 'weather' ? null : 'weather');
  chip.addEventListener('click', () => { chip.blur(); togglePanel(); });

  // ── the pop-up ──
  const pop = el('div', 'panel interactive');
  pop.id = 'flare-popup';
  pop.style.display = 'none';
  root.appendChild(pop);
  /** UI-local: this flare's selection until Confirm */
  const ui = { n: -1, sel: 'feed', slider: 75, fine: false, repair: true, remember: false, open: false, accepted: false, sig: '' };
  const selectedChoice = (): ArrayChoice => (ui.sel === 'slider' ? { mode: 'portion', p: ui.slider / 100 } : choiceOf(ui.sel));
  const previewFor = (v: NonNullable<WeatherView['popup']>, key: string): ChoicePreview | null => {
    if (key === 'slider') return game.flarePreview({ mode: 'portion', p: ui.slider / 100 });
    return v.options.find((o) => o.key === key) ?? game.flarePreview(choiceOf(key));
  };
  const confirm = () => {
    const v = $weather.get();
    const p = v?.popup ?? v?.forecast?.popup;
    if (!p || p.locked) return;
    // 'Arrays: choose now…' (docs/16 §10.2): the choice waits for the telegraph
    if (p.ahead) { game.actions.push({ kind: 'flareAhead', choice: selectedChoice(), repair: ui.repair, remember: ui.remember }); game.setForecastAhead(false); return; }
    game.actions.push({ kind: 'flareChoice', choice: selectedChoice(), repair: ui.repair, remember: ui.remember });
    ui.open = false;
    // the pop-up's own pause lifts with its answer
    if (p.pausedBy) game.actions.push({ kind: 'setPaused', paused: false });
  };

  const fullHtml = (touch: boolean) => touch ? `
    <div class="fp-head"><b class="fp-t"></b><span class="fp-sub mono"></span></div>
    <div class="fp-seg" role="radiogroup">${['run', 'p25', 'p50', 'p75', 'feed', 'stow'].map((k) =>
      `<button class="btn fp-k" data-k="${k}" role="radio">${{ run: 'Keep all', p25: '25%', p50: '50%', p75: '75%', feed: 'All but feed', stow: 'Stow all' }[k]}</button>`).join('')}</div>
    <div class="fp-pv mono"></div>
    <div class="fp-fine-row"><input type="range" class="fp-slider" min="0" max="100" step="5" aria-label="Stow share"><span class="fp-sv mono"></span></div>
    <div class="fp-boxes"><button class="btn fp-repair" aria-pressed="true"></button><button class="btn fp-remember" aria-pressed="false"></button><button class="btn fp-fine" aria-pressed="false">Fine…</button></div>
    <div class="fp-also"></div>
    <div class="fp-foot"><span class="fp-def"></span><span class="fp-btns"><button class="btn fp-cancel">Cancel</button><button class="btn primary fp-confirm">Confirm</button></span></div>` : `
    <div class="fp-head"><b class="fp-t"></b><span class="fp-clock mono"></span></div>
    <div class="fp-sub mono"></div>
    <div class="fp-row" data-k="run"><span class="fp-dot"></span><span class="fp-lab">Keep all running</span><span class="fp-pv mono"></span></div>
    <div class="fp-row" data-k="stow"><span class="fp-dot"></span><span class="fp-lab">Stow all</span><span class="fp-pv mono"></span></div>
    <div class="fp-row fp-portion" data-k="portion"><span class="fp-dot"></span><span class="fp-lab">Stow a portion</span>
      <span class="fp-shares">${['p25', 'p50', 'p75', 'feed'].map((k) => `<button class="btn fp-k" data-k="${k}">${{ p25: '25%', p50: '50%', p75: '75%', feed: 'All but the feed' }[k]}</button>`).join('')}</span>
      <input type="range" class="fp-slider" min="0" max="100" step="5" aria-label="Stow share"><span class="fp-sv mono"></span>
      <span class="fp-pv fp-pv2 mono"></span></div>
    <div class="fp-boxes"><label><input type="checkbox" class="fp-repair-cb"> Repair stowed arrays after the flare</label>
      <label><input type="checkbox" class="fp-remember-cb"> <span class="fp-remember-t"></span></label></div>
    <div class="fp-also"></div>
    <div class="fp-foot"><span class="fp-def"></span><span class="fp-btns"><button class="btn fp-cancel">Cancel</button><button class="btn primary fp-confirm">Confirm</button></span></div>`;
  const compactHtml = () => '<span class="fp-line mono"></span><span class="fp-btns"><button class="btn fp-accept">Accept</button><button class="btn fp-change">Change</button></span>';

  const renderPop = () => {
    const v = $weather.get();
    const p = v?.popup ?? v?.forecast?.popup ?? null; // the telegraph's, else the ahead card (core/forecast.ts)
    if (!v || !p) { pop.style.display = 'none'; ui.sig = ''; return; }
    if (ui.n !== p.n) {
      // a new flare: its choice as decided now, the boxes as the base keeps them
      ui.n = p.n;
      ui.sel = keyOf(p.choice);
      if (p.choice.mode === 'portion') { ui.sel = keyOf(p.choice); ui.slider = Math.round((p.choice.p ?? 0) * 100); }
      ui.repair = p.autoRepair;
      ui.remember = false;
      ui.open = false;
      ui.accepted = false;
      ui.fine = false;
    }
    const touch = isTouch();
    const full = !p.locked && (p.full || ui.open) && !(p.decidedBy === 'click' && !ui.open);
    const shape = `${full ? 'F' : 'c'}|${touch}|${p.locked}|${p.builder}`;
    pop.style.display = '';
    pop.classList.toggle('touch', touch);
    pop.classList.toggle('compact', !full);
    pop.classList.toggle('x', v.cls === 'X');
    if (shape !== ui.sig) {
      ui.sig = shape;
      pop.innerHTML = full ? fullHtml(touch) : compactHtml();
    }
    const cls = v.cls!;
    const left = fmtClock(v.timer);
    if (!full) {
      // the compact form: one line, and [Change]
      const cur = p.options.find((o) => o.key === p.choiceKey) ?? previewFor(p, p.choiceKey);
      const who = p.decidedBy === 'click' ? '' : p.remembered ? `${p.defaultLine.replace(/:.*/, '')}: ` : p.builder ? 'the Builder: ' : 'unanswered — the safe default: ';
      const res = cur ? (p.decidedBy === 'click' || p.locked
        ? ` · STOWED ${cur.stowN}${cur.stowsText ? ` (${cur.stowsText})` : ''} · RUNNING ${cur.runN}${cur.runN ? `, ${Math.round(cur.runKW)} kW` : ''}` +
          (cur.darkAt === null ? ' · the bank covers the rest ✓' : ` · ⚠ ${cur.darkName} dark at ${fmtClock(cur.darkAt)}`)
        : ` (${cur.stowN} of ${cur.stowN + cur.runN})`) : '';
      const line = `☉ ${v.classText} FLARE ${p.locked ? '— protons in' : 'in'} ${left} · ${who}${shortChoice(p.choice)}${res}${p.locked ? ' · arrays moving' : ''}`;
      setText(pop, '.fp-line', line);
      const acc = pop.querySelector<HTMLElement>('.fp-accept');
      if (acc) acc.style.display = p.builder && !ui.accepted && !p.locked ? '' : 'none';
      const chg = pop.querySelector<HTMLElement>('.fp-change');
      if (chg) chg.style.display = p.locked ? 'none' : '';
      return;
    }
    // the full card
    setText(pop, '.fp-t', touch ? (p.touchTitle ?? `☉ FLARE ${v.classText} · protons in ${left}${v.drill ? ' · DRILL' : ''}`) : p.headline);
    setText(pop, '.fp-clock', p.clockText ?? `protons in ${left}`);
    hide(pop.querySelector('.fp-cancel'), !p.ahead);
    const bank = Number.isFinite(p.bankS) ? fmtClock(p.bankS) : 'the whole flare';
    const sub = touch
      ? `${p.arrays} arrays · ${Math.round(p.kw)} kW · feed ${Math.round(p.criticalKW)} kW`
      : `${p.arrays} arrays in ${p.fields} field${p.fields === 1 ? '' : 's'} · ${Math.round(p.kw)} kW now · the bank carries the base ${bank} without them` +
        ` · critical feed ${Math.round(p.criticalKW)} kW (${p.criticalN} array${p.criticalN === 1 ? '' : 's'})${v.night ? ' · night: the arrays are folded' : ''}`;
    setText(pop, '.fp-sub', sub);
    const portionSel = ui.sel === 'slider' || ui.sel.startsWith('p') || ui.sel === 'feed';
    for (const row of pop.querySelectorAll<HTMLElement>('.fp-row')) {
      const k = row.dataset.k!;
      const on = k === 'portion' ? portionSel : ui.sel === k;
      row.classList.toggle('on', on);
      setText(row, '.fp-dot', on ? '●' : '○');
      if (k !== 'portion') {
        const pv = previewFor(p, k);
        setHtml(row, '.fp-pv', pv ? rich(pv.line) : '');
      }
    }
    for (const b of pop.querySelectorAll<HTMLElement>('.fp-k')) {
      const on = b.dataset.k === ui.sel;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    }
    const slider = pop.querySelector<HTMLInputElement>('.fp-slider');
    if (slider && document.activeElement !== slider && slider.value !== String(ui.slider)) slider.value = String(ui.slider);
    setText(pop, '.fp-sv', `${ui.slider}%`);
    const selPv = previewFor(p, ui.sel);
    if (touch) setHtml(pop, '.fp-pv', selPv ? rich(selPv.line) : '');
    else setHtml(pop, '.fp-pv2', portionSel && selPv ? rich(selPv.line) : '');
    const fineRow = pop.querySelector<HTMLElement>('.fp-fine-row');
    if (fineRow) fineRow.style.display = ui.fine ? '' : 'none';
    const fineBtn = pop.querySelector<HTMLElement>('.fp-fine');
    if (fineBtn) { fineBtn.classList.toggle('active', ui.fine); fineBtn.setAttribute('aria-pressed', String(ui.fine)); }
    // the two boxes
    const rep = pop.querySelector<HTMLInputElement>('.fp-repair-cb');
    if (rep) rep.checked = ui.repair;
    const mem = pop.querySelector<HTMLInputElement>('.fp-remember-cb');
    if (mem) mem.checked = ui.remember;
    setText(pop, '.fp-remember-t', `Use this choice for future ${p.rememberCls} flares`);
    const repB = pop.querySelector<HTMLElement>('.fp-repair');
    if (repB) { repB.textContent = `${ui.repair ? '✓' : '○'} Repair after`; repB.classList.toggle('active', ui.repair); repB.setAttribute('aria-pressed', String(ui.repair)); }
    const memB = pop.querySelector<HTMLElement>('.fp-remember');
    if (memB) { memB.textContent = `${ui.remember ? '✓ ' : ''}Remember for ${p.rememberCls}`; memB.classList.toggle('active', ui.remember); memB.setAttribute('aria-pressed', String(ui.remember)); }
    setHtml(pop, '.fp-also', alsoCounters() ? `<span class="label">ALSO</span>${alsoCounters()}` : '');
    setText(pop, '.fp-def', p.footText ?? (touch ? (p.remembered || p.builder ? `Unanswered: ${p.defaultLine}` : 'Unanswered: the safe default')
      : `Unanswered in ${left}: ${p.defaultLine}`));
  };
  pop.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (counterClick(game, t)) return;
    if (t.closest('.fp-confirm')) { confirm(); return; }
    if (t.closest('.fp-cancel')) { game.setForecastAhead(false); return; }
    if (t.closest('.fp-change')) { ui.open = true; ui.sig = ''; renderPop(); return; }
    if (t.closest('.fp-accept')) { ui.accepted = true; renderPop(); return; }
    if (t.closest('.fp-fine')) { ui.fine = !ui.fine; if (ui.fine) ui.sel = 'slider'; renderPop(); return; }
    if (t.closest('.fp-repair')) { ui.repair = !ui.repair; renderPop(); return; }
    if (t.closest('.fp-remember')) { ui.remember = !ui.remember; renderPop(); return; }
    if (t.closest('input')) return;
    const k = t.closest<HTMLElement>('[data-k]')?.dataset.k;
    if (!k) return;
    ui.sel = k === 'portion' ? (ui.sel.startsWith('p') || ui.sel === 'slider' || ui.sel === 'feed' ? ui.sel : 'slider') : k;
    renderPop();
  });
  pop.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.classList.contains('fp-repair-cb')) ui.repair = t.checked;
    if (t.classList.contains('fp-remember-cb')) ui.remember = t.checked;
    renderPop();
  });
  pop.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.classList.contains('fp-slider')) return;
    ui.slider = Number(t.value);
    ui.sel = 'slider';
    renderPop();
  });
  // Enter confirms; ← → move the slider in 5% steps (§10.3). [O] opens the panel.
  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
    if (e.code === 'KeyO' && $mode.get() !== 'walk' && !e.repeat) { togglePanel(); return; }
    const open = pop.style.display !== 'none' && !pop.classList.contains('compact');
    if (!open) return;
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !$placing.get()) {
      e.preventDefault(); e.stopImmediatePropagation(); confirm(); return;
    }
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault(); e.stopImmediatePropagation();
      if (ui.sel !== 'slider') ui.slider = ui.sel.startsWith('p') ? Number(ui.sel.slice(1)) : ui.sel === 'stow' || ui.sel === 'feed' ? 100 : 0;
      ui.slider = Math.max(0, Math.min(100, ui.slider + (e.code === 'ArrowLeft' ? -5 : 5)));
      ui.sel = 'slider';
      renderPop();
    }
  }, { capture: true });

  // ── the panel [O] ──
  const panel = el('div', 'panel interactive');
  panel.id = 'weather-panel';
  panel.style.display = 'none';
  const body = el('div', 'wx-body');
  const foot = el('section', 'actions', '<button class="btn" id="wx-close">Close</button>');
  panel.append(body, foot);
  (root.querySelector('#hud-left') ?? root).appendChild(panel);
  foot.querySelector('#wx-close')!.addEventListener('click', () => $resourcePanel.set(null));
  let psig = '';
  const choices: [string, string][] = [['', 'ask'], ['run', 'run all'], ['feed', 'all but the feed'], ['stow', 'stow all'], ['p50', '50%']];
  const panelBody = (v: WeatherView) => `
    <section><div class="tt-name"><span>☉ SPACE WEATHER</span><span class="label">[O]</span></div>
      <div class="label mono wx-band"></div></section>
    <section><span class="label">Now</span><div class="mono wx-now"></div><div class="wx-btns wx-now-btns"></div></section>
    <section><span class="label">Exposure</span><div class="mono wx-exp"></div>
      <div class="mono wx-exp-l" data-l="crew"></div><div class="mono wx-exp-l" data-l="machines"></div>
      <div class="mono wx-exp-l" data-l="research"></div><div class="mono wx-exp-l" data-l="buildings"></div>
      <div class="mono wx-exp-l" data-l="comms"></div></section>
    <section class="wx-after"><span class="label">After the last flare</span>
      <div class="wx-line mono wx-wrecks"></div><div class="wx-btns">
        <button class="btn" data-wx="rebuild-all">Rebuild all</button><button class="btn" data-wx="clear-all">Clear all</button></div>
      <div class="wx-line mono wx-repairs"></div><div class="wx-btns"><button class="btn" data-wx="repair-all">Repair all</button></div>
      <div class="wx-line mono wx-scarred"></div><div class="wx-btns"><button class="btn" data-wx="replace-worst">Replace worst</button></div></section>
    <section><span class="label">Protocols — the arrays' choice by class</span>
      ${(['C', 'M', 'X'] as FlareClass[]).map((c) => `<div class="wx-proto" data-cls="${c}"><span class="mono">${CLASS_GLYPH[c]} ${c}</span>
        ${choices.map(([k, t]) => `<button class="btn wx-pc" data-cls="${c}" data-k="${k}">${t}</button>`).join('')}</div>`).join('')}
      <div class="goal-hint">Unset, the pop-up asks, and unanswered the safe default stows all but the critical feed. Set, the next ${'flare'} of that class opens small and does not pause.</div>
      <div class="wx-line"><label><input type="checkbox" class="wx-autorepair"> Repair stowed arrays after each flare</label></div></section>
    <section><span class="label">Log — the last flares</span><div class="mono wx-log"></div></section>`;
  const refreshPanel = (v: WeatherView) => {
    const tier = v.forecast?.tierName ?? 'T0 · the flash and Earth’s bulletin';
    setText(panel, '.wx-band', `activity ${v.gauge} ${v.band} · ${v.rising ? 'rising' : 'falling'} · ${tier}`);
    const now = v.phase === 'idle'
      ? `quiet${v.watch ? ' · BIG SPOT GROUP: an X-class flare is possible within ½ day' : ''}${v.last ? ` · the last: ${v.last.cls}, day ${Math.floor(v.last.at / 720) + 1} (stowed ${v.last.stowed}, ${v.last.destroyed} destroyed)` : ''}`
      : `${v.classText} flare · ${v.phase === 'telegraph' ? `protons in ${fmtClock(v.timer)}` : v.phase === 'tail' ? `proton-storm tail ${fmtClock(v.timer)}` : `active ${fmtClock(v.timer)}`}${v.drill ? ' · a drill' : ''}`;
    setText(panel, '.wx-now', now + (v.fx.dark > 0 ? ` · ⌁ comms dark ${fmtClock(v.fx.dark)}` : '') +
      (v.phase !== 'idle' && (v.fx.recalled || v.fx.checkpoint || v.fx.shut) ? ` · ${[v.fx.recalled ? 'machines recalled' : '', v.fx.checkpoint ? 'research checkpointed' : '',
        v.fx.shut ? `${v.fx.shut} shut down` : ''].filter(Boolean).join(', ')}` : ''));
    setHtml(panel, '.wx-now-btns', v.phase !== 'idle' ? alsoCounters() : '');
    setText(panel, '.wx-exp', `Arrays ${v.arrays.n} in ${v.arrays.fields} field${v.arrays.fields === 1 ? '' : 's'} · ${Math.round(v.arrays.kw)} kW` +
      (Object.keys(v.remember).length ? ` · ${Object.entries(v.remember).map(([c, t]) => `${c}: ${t}`).join(' · ')}` : ' · every class: ask'));
    const EXP: Record<string, string> = { crew: 'Crew', machines: 'Machines', research: 'Research', buildings: 'Buildings', comms: 'Comms' };
    for (const [k, lbl] of Object.entries(EXP)) setText(panel, `.wx-exp-l[data-l="${k}"]`, `${lbl} ${v.fx.exposure[k as keyof typeof v.fx.exposure]}`);
    const sc = v.fx.scarred;
    setText(panel, '.wx-scarred', sc.under ? `SCARRED ${sc.under} under 85% · ${sc.worst}${sc.any > sc.under ? ` · ${sc.any - sc.under} more scarred` : ''}`
      : sc.any ? `SCARRED ${sc.any}, none under 85%` : 'SCARRED none');
    const rw = panel.querySelector<HTMLButtonElement>('[data-wx="replace-worst"]');
    if (rw) rw.disabled = !sc.any;
    const open = v.wrecks.filter((w) => !w.job);
    setText(panel, '.wx-wrecks', open.length ? `WRECKS ${open.length} (${[...new Set(open.map((w) => `F${w.field}`))].join(', ')})` +
      `${v.wrecks.length > open.length ? ` · ${v.wrecks.length - open.length} being rebuilt or cleared` : ''}` : v.wrecks.length ? `WRECKS ${v.wrecks.length} being rebuilt or cleared` : 'WRECKS none');
    setText(panel, '.wx-repairs', v.repairs.queued ? `REPAIRS ${v.repairs.queued} queued · ${v.repairs.parts}⚙ · ${v.repairs.working} being worked` : 'REPAIRS none queued');
    for (const b of panel.querySelectorAll<HTMLButtonElement>('[data-wx="rebuild-all"], [data-wx="clear-all"]')) b.disabled = !open.length;
    for (const b of panel.querySelectorAll<HTMLElement>('.wx-pc')) {
      const c = b.dataset.cls as FlareClass;
      const k = b.dataset.k!;
      const cur = game.state.weather?.remember?.[c];
      b.classList.toggle('active', (cur ? keyOf(cur) : '') === k);
    }
    const ar = panel.querySelector<HTMLInputElement>('.wx-autorepair');
    if (ar) ar.checked = game.state.weather?.autoRepair ?? true;
    const log = v.log.length ? v.log.map((l) => `<div>${CLASS_GLYPH[l.cls]} ${l.cls}${l.drill ? ' drill' : ''} · day ${Math.floor(l.at / 720) + 1} · ${esc(l.choice)}` +
      ` (${l.decidedBy}) · stowed ${l.stowed}, ran ${l.running}${l.destroyed ? ` · ${l.destroyed} destroyed` : ''}` +
      `${l.damaged ? ` · ${l.damaged} damaged (${l.repairParts}⚙)` : ''}${l.scarred ? ` · ${l.scarred} scarred −${(l.scar * 100).toFixed(1)}%` : ''}${l.night ? ' · night' : ''}` +
      `${l.rebooted || l.latched || l.lost ? ` · machines ${[l.rebooted ? `${l.rebooted} rebooted` : '', l.latched ? `${l.latched} latched` : '', l.lost ? `${l.lost} lost` : ''].filter(Boolean).join(', ')}` : ''}` +
      `${l.researchLost ? ` · −${l.researchLost}≡ ${esc(l.researchTech ?? '')}` : ''}${l.sick ? ` · ${l.sick} sick` : ''}` +
      `${l.scarredB ? ` · ${l.scarredB} structures scarred −${((l.scarB ?? 0) * 100).toFixed(2)}%` : ''}${l.scarredM ? ` · ${l.scarredM} machines −${((l.scarM ?? 0) * 100).toFixed(2)}%` : ''}</div>`).join('')
      : '<div class="goal-hint">No flare yet. The first comes on day 3, a C-class drill.</div>';
    setHtml(panel, '.wx-log', log);
  };
  panel.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (forecastClick(game, t)) return;
    const b = t.closest<HTMLElement>('[data-wx]');
    if (b) {
      const a = b.dataset.wx!;
      if (a === 'rebuild-all') game.actions.push({ kind: 'wreck', how: 'rebuild' });
      if (a === 'clear-all') game.actions.push({ kind: 'wreck', how: 'clear' });
      if (a === 'repair-all') game.actions.push({ kind: 'repairArrays' });
      if (a === 'replace-worst') game.actions.push({ kind: 'counter', counter: 'flareReplaceWorst' });
      return;
    }
    if (counterClick(game, t)) return;
    const pc = t.closest<HTMLElement>('.wx-pc');
    if (pc) {
      const k = pc.dataset.k!;
      game.actions.push({ kind: 'flareRemember', cls: pc.dataset.cls as FlareClass, choice: k ? choiceOf(k) : null });
    }
  });
  panel.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.classList.contains('wx-autorepair')) game.actions.push({ kind: 'flareAutoRepair', on: t.checked });
  });

  const render = () => {
    const v = $weather.get();
    const text = v?.chip ?? '';
    chip.style.display = text ? '' : 'none';
    if (chip.textContent !== text) chip.textContent = text;
    for (const c of ['watch', 'telegraph', 'crit', 'active', 'tail']) chip.classList.toggle(c, v?.chipShape === c);
    chip.title = v ? `Space weather — activity ${v.band.toLowerCase()} (Earth's bulletin) · [O]` : '';
    renderPop();
    const open = $resourcePanel.get() === 'weather';
    if (!open || !v) { panel.style.display = 'none'; psig = ''; return; }
    panel.style.display = '';
    const sig = 'p1';
    if (sig !== psig) { psig = sig; body.innerHTML = panelBody(v); mountForecastSections(body); }
    refreshPanel(v);
    refreshForecast(game, body, v); // NEXT and TIMELINE (docs/16 §6.5, §10.5)
  };
  $weather.subscribe(render);
  $resourcePanel.subscribe(render);
  $hazards.subscribe(renderPop);
}

// ─────────────────────────── the inspector (§10.7) ───────────────────────────

const capOfSel = (game: Game, sel: BuildingState) => capabilityView(game.state, game.mods, SITES[game.state.siteId], sel);

/** A structure's capability line (§4.13): FLARE SHIELD σ, CAPABILITY, its rad scars, Replace and its payback. */
function capHtml(game: Game, sel: BuildingState): { html: string; sig: string } {
  const c = capOfSel(game, sel);
  if (!c) return { html: '', sig: '' };
  const offer = (c.cap < 0.9995 || c.burned) && !c.replacing;
  const verb = c.burned ? 'Re-print' : 'Replace';
  return {
    sig: `c${offer}|${c.burned}|${c.replacing}`,
    html: `<section class="wx-insp"><span class="label mono" id="wx-cap-line"></span>
      ${offer ? `<div class="prio"><button class="btn" data-wxi="replace" title="New: capability 100%, wear 0 — ${fmtClock(c.secs)} offline while a rover welds; its pad, roads, door and settings stay">${verb} ${esc(c.cost)}</button></div>` : ''}</section>`,
  };
}

/** A Solar Array's lines: its field, capability, stowed damage and [Repair], the
 *  override; a wreck's Rebuild and Clear. Any structure with an output: its
 *  capability and Replace. `sig` changes when the shape does. */
export function weatherInspector(game: Game, sel: BuildingState): { html: string; sig: string } {
  if (sel.type !== 'solar') return capHtml(game, sel);
  const a = game.arrayView(sel.id);
  if (!a) return { html: '', sig: '' };
  if (a.wreck) {
    const busy = a.wreck.job === 'rebuild' ? 'rebuilding' : a.wreck.job === 'clear' ? 'clearing' : '';
    return {
      sig: `w${a.wreck.job}`,
      html: `<section class="wx-insp"><span class="label">✕ WRECK — destroyed in the ${a.wreck.cls} flare, day ${a.wreck.day}${busy ? ` · ${busy}` : ''}</span>
        ${busy ? '' : `<div class="prio"><button class="btn" data-wxi="rebuild">Rebuild ${a.rebuild}◆</button><button class="btn" data-wxi="clear">Clear +${a.salvage}◆</button></div>`}</section>`,
    };
  }
  const ov = a.override;
  const c = capOfSel(game, sel);
  const replace = !!c && c.cap < 0.9995 && !c.replacing;
  return {
    sig: `a${a.field}|${ov}|${a.fieldDamaged > 0}|${a.queued}|${replace}`,
    html: `<section class="wx-insp"><span class="label mono" id="wx-insp-line"></span>
      ${a.fieldDamaged > 0 && !a.queued ? `<div class="prio"><button class="btn" data-wxi="repair">Repair ${a.repairParts}⚙</button></div>` : ''}
      ${replace ? `<div class="prio"><button class="btn" data-wxi="replace" title="Its rad scars never heal: a new array, capability 100%">Replace ${esc(c!.cost)}</button></div>` : ''}
      <div class="prio wx-ov"><span class="label">Flare</span>${(['follow', 'stow', 'run'] as const).map((m) =>
        `<button class="btn${ov === m ? ' active' : ''}" data-wxi="ov-${m}">${m === 'follow' ? 'Follow the choice' : m === 'stow' ? 'Always stow' : 'Always run'}</button>`).join('')}</div></section>`,
  };
}

/** The live text of the array's line, or a structure's capability line. */
export function refreshWeatherInspector(game: Game, root: ParentNode, sel: BuildingState) {
  if (sel.type !== 'solar') {
    const c = capOfSel(game, sel);
    if (!c) return;
    const pay = Number.isFinite(c.payback) ? ` · pays back in ${fmtClock(c.payback)}` : '';
    setText(root, '#wx-cap-line', `FLARE SHIELD σ ${c.sigma.toFixed(c.sigma % 1 ? 2 : 0)}${c.sigma >= 1 ? ' (the tube)' : ''} · ` +
      (c.burned ? 'BURNED OUT — its digger is lost' : `CAPABILITY ${Math.round(c.cap * 100)}%${c.cap < SPACE_WEATHER_ALERT ? ' ▼' : ''}` +
        `${c.scars ? ` · rad scars from ${c.scars} flare${c.scars === 1 ? '' : 's'}` : ' · no rad scars'}`) +
      `${c.replacing ? ' · being replaced' : c.cap < 0.9995 && !c.burned ? `${pay} (${fmtClock(c.secs)} offline)` : ''}${c.last ? ` · last flare: ${c.last}` : ''}`);
    return;
  }
  const a = game.arrayView(sel.id);
  if (!a || a.wreck) return;
  setText(root, '#wx-insp-line', `FIELD F${a.field} · ${a.arrays} array${a.arrays === 1 ? '' : 's'} · ${Math.round(a.kw)} kW · CAPABILITY ${Math.round(a.cap * 100)}%` +
    (a.dmg > 1e-6 ? ` · stowed damage −${Math.round(a.dmg * 100)}%${a.queued ? ' (repair queued)' : ''}` : '') + (a.stowT > 0 ? ` · STOWED ${Math.round(a.stowT * 100)}%` : ''));
}

/** An inspector click on one of these buttons; true if it was one. */
export function weatherInspectorClick(game: Game, btn: HTMLElement, sel: BuildingState): boolean {
  const k = btn.dataset.wxi;
  if (!k) return false;
  if (k === 'rebuild' || k === 'clear') game.actions.push({ kind: 'wreck', how: k, id: sel.id });
  else if (k === 'repair') game.actions.push({ kind: 'repairArrays', id: sel.id });
  else if (k === 'replace') game.actions.push({ kind: 'counter', counter: 'flareReplace', id: sel.id });
  else if (k.startsWith('ov-')) game.actions.push({ kind: 'fieldOverride', id: sel.id, mode: k.slice(3) as 'follow' | 'stow' | 'run' });
  return true;
}

export { plain as plainPreview };
