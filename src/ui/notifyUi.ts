/** The DOM half of the notification system (docs/19 S7; the pure half, the family
 *  table and `notify()`, is notify.ts):
 *   - the field family's dispatch card (`#field-card`): lower left above the
 *     objectives, a torn top edge, title, a geology line and one line per
 *     reward, each with its own button;
 *   - the Log panel (`#notify-log`): every notification of every family,
 *     newest first, with its glyph, filtered by family, and a click that does
 *     what the alert did;
 *   - what an alert's action opens (`runAlertAction`): a panel, a deposit's
 *     card, a building, the map at a prospect, the tree at a tech;
 *   - the two layout hooks that keep the families' positions apart
 *     (`--ms-h`: the objectives' height; `--wx-bottom`: the flare pop-up's).
 *  The research, era and hazard cards are ui/discovery.ts's; the weather card
 *  is the flare pop-up (ui/weatherPanel.ts). */
import './notify.css';
import type { Game } from '../core/game';
import type { AlertAction, FieldReward, NotifyFamily } from '../core/state';
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { el, perFrame } from './hud';
import {
  $depositOverlay, $depositSel, $fieldCards, $log, $logOpen, $menuOpen, $phase, $resourcePanel, $tech, overlayUp,
  type FieldCard,
} from './stores';
import { FAMILY, NOTIFY_FAMILIES, PLAIN_GLYPH, esc, logEntries, logRowHtml, setActionRunner } from './notify';
import { openTechTreeAt } from './techTree';

/** Open the Lunar Map at a prospect (ui/lunarMap.ts listens for this). */
export const OPEN_MAP_EVENT = 'moonshots:open-map';

export function mountNotify(root: HTMLElement, game: Game) {
  // ── what an action opens ──
  const run = (a: AlertAction) => {
    if ('panel' in a) $resourcePanel.set(a.panel);
    else if ('deposit' in a) {
      // a deposit's alert opens its card (docs/17 §13.4)
      $depositOverlay.set(true);
      $depositSel.set(a.deposit);
    } else if ('select' in a) game.select(a.select);
    else if ('map' in a) window.dispatchEvent(new CustomEvent(OPEN_MAP_EVENT, { detail: { prospect: a.map } }));
    else if ('tech' in a) openTechTreeAt(a.tech);
    else if ('building' in a) {
      // a placed building by id; a kind of building selects the first one standing, else starts placing it
      if (typeof a.building === 'number') game.select(a.building);
      else {
        const type = a.building as BuildingId;
        const b = game.state.buildings.find((x) => x.type === type && (x.construction ?? 0) <= 0)
          ?? game.state.buildings.find((x) => x.type === type);
        if (b) game.select(b.id);
        else if (BUILDINGS[type] && $tech.get().unlocked.includes(type)) game.beginPlacement(type);
      }
    }
  };
  setActionRunner(run);
  /** the screens that cover the HUD close under an action that opens another */
  const closeLog = () => $logOpen.set(false);

  // ── layout hooks: the families never share a slot ──
  const layout = () => {
    // the bottom-left slot is the objectives, inside the first-mine guide's stack when that is mounted and showing
    const ms = [document.getElementById('first-mine-stack'), document.getElementById('milestones')]
      .find((e) => e && e.offsetParent !== null);
    const fp = document.getElementById('flare-popup');
    const r = root.getBoundingClientRect();
    root.style.setProperty('--ms-h', `${ms ? Math.ceil(ms.getBoundingClientRect().height) : 0}px`);
    const shown = fp && fp.style.display !== 'none' ? fp.getBoundingClientRect() : null;
    root.style.setProperty('--wx-bottom', shown ? `${Math.ceil(shown.bottom - r.top)}px` : '0px');
  };
  const relayout = perFrame(layout);
  const ro = new ResizeObserver(relayout);
  for (const id of ['first-mine-stack', 'milestones', 'flare-popup']) {
    const e = document.getElementById(id);
    if (e) ro.observe(e);
  }
  const mo = new MutationObserver(relayout);
  const fp0 = document.getElementById('flare-popup');
  if (fp0) mo.observe(fp0, { attributes: true, attributeFilter: ['style'] });
  window.addEventListener('resize', relayout);
  relayout();

  // ───────────────────────── the field card ─────────────────────────
  const card = el('div', 'panel interactive nf nf-field');
  card.id = 'field-card';
  card.style.display = 'none';
  card.setAttribute('role', 'status');
  root.appendChild(card);
  let shown = -1;

  const rewardHtml = (r: FieldReward, i: number) =>
    `<div class="fc-rw">${r.tag ? `<span class="fc-tag mono">${esc(r.tag)}</span>` : ''}<span class="fc-txt">${esc(r.text)}</span>` +
    `${r.button ? `<button class="btn fc-btn" data-fc="reward" data-i="${i}">${esc(r.button.label)}</button>` : ''}</div>`;

  const renderCard = () => {
    const list = $fieldCards.get();
    const c: FieldCard | undefined = list[list.length - 1];
    if (!c || $phase.get() !== 'playing') {
      card.style.display = 'none';
      shown = -1;
      return;
    }
    const sig = `${c.id}|${list.length}`;
    card.style.display = '';
    if (sig === card.dataset.sig) return;
    card.dataset.sig = sig;
    const fresh = c.id !== shown;
    shown = c.id;
    const earlier = list.length - 1;
    card.innerHTML =
      `<div class="fc-head"><span class="nf-g" aria-hidden="true">${FAMILY.field.glyph}</span><span class="label">Field report</span>` +
      `${earlier ? `<span class="fc-more mono">+${earlier} earlier</span>` : ''}` +
      `<button class="fc-x" data-fc="x" title="Dismiss" aria-label="Dismiss">✕</button></div>` +
      `<div class="fc-title">${esc(c.report.title)}</div>` +
      (c.report.geology ? `<div class="fc-geo">${esc(c.report.geology)}</div>` : '') +
      `<div class="fc-rewards">${c.report.rewards.map(rewardHtml).join('')}</div>`;
    if (fresh) { card.classList.remove('slide'); void card.offsetWidth; card.classList.add('slide'); }
  };
  $fieldCards.subscribe(renderCard);
  $phase.subscribe(renderCard);
  const dismissCard = () => {
    const list = $fieldCards.get();
    if (list.length) $fieldCards.set(list.slice(0, -1));
  };
  card.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-fc]');
    if (!t) return;
    if (t.dataset.fc === 'x') { dismissCard(); return; }
    const list = $fieldCards.get();
    const c = list[list.length - 1];
    const r = c?.report.rewards[Number(t.dataset.i)];
    if (!r?.button) return;
    run(r.button.action);
    dismissCard();
  });

  // ───────────────────────── the log ─────────────────────────
  const log = el('div', 'panel interactive');
  log.id = 'notify-log';
  log.style.display = 'none';
  log.setAttribute('role', 'dialog');
  log.setAttribute('aria-label', 'Notification log');
  log.innerHTML =
    '<div class="nl-head"><span class="label">Log · every notification</span><button class="btn nl-x" data-nl="x" title="Close the log (Esc)">✕</button></div>' +
    '<div class="nl-filters" role="tablist"></div><div class="nl-list" role="list"></div>';
  root.appendChild(log);
  const filters = log.querySelector('.nl-filters') as HTMLElement;
  const list = log.querySelector('.nl-list') as HTMLElement;
  let filter: NotifyFamily | 'all' = 'all';
  let logSig = '';
  const renderLog = () => {
    if (!$logOpen.get()) return;
    const all = $log.get();
    const counts: Record<string, number> = { all: all.length, plain: 0 };
    for (const f of NOTIFY_FAMILIES) counts[f] = 0;
    for (const e of all) {
      const f = e.family ?? (e.kind === 'crit' ? 'hazard' : 'plain');
      counts[f]++;
    }
    const rows = logEntries(all, filter === 'all' ? undefined : filter);
    const sig = `${filter}|${all.length}|${all[all.length - 1]?.id ?? ''}|${all[all.length - 1]?.count ?? ''}|${rows.length}`;
    if (sig === logSig) return;
    logSig = sig;
    filters.innerHTML = ([['all', 'All', PLAIN_GLYPH]] as [string, string, string][])
      .concat(NOTIFY_FAMILIES.map((f) => [f, FAMILY[f].label, FAMILY[f].glyph] as [string, string, string]))
      .map(([id, label, g]) => `<button class="btn nl-f nf ${id === 'all' ? '' : `nf-${id}`}${filter === id ? ' active' : ''}" role="tab" ` +
        `aria-selected="${filter === id}" data-nl="filter" data-f="${id}"><span class="nl-g" aria-hidden="true">${g}</span>${label}` +
        `<span class="nl-c mono">${counts[id]}</span></button>`).join('');
    const keep = list.scrollTop;
    list.innerHTML = rows.length ? rows.map(logRowHtml).join('') : '<div class="nl-empty">Nothing here yet.</div>';
    list.scrollTop = keep;
  };
  const scheduleLog = perFrame(renderLog);
  const openLog = (on: boolean) => {
    log.style.display = on ? 'flex' : 'none';
    if (on) { logSig = ''; renderLog(); }
  };
  $logOpen.subscribe(openLog);
  $log.subscribe(scheduleLog);
  $phase.subscribe((p) => { if (p !== 'playing') closeLog(); });
  log.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('[data-nl]');
    if (b?.dataset.nl === 'x') { closeLog(); return; }
    if (b?.dataset.nl === 'filter') { filter = b.dataset.f as NotifyFamily | 'all'; logSig = ''; renderLog(); return; }
    const row = t.closest<HTMLElement>('.nl-row.actionable');
    if (!row) return;
    const entry = $log.get().find((x) => x.id === Number(row.dataset.log));
    if (!entry?.action) return;
    closeLog();
    run(entry.action);
  });
  log.addEventListener('keydown', (e) => {
    if ((e.code === 'Enter' || e.code === 'Space') && (e.target as HTMLElement).classList.contains('actionable')) {
      e.preventDefault();
      (e.target as HTMLElement).click();
    }
  });
  // Esc closes the log before anything else (capture, after the menu's own)
  window.addEventListener('keydown', (e) => {
    if (!$logOpen.get() || $menuOpen.get() || overlayUp()) return;
    if (e.code === 'Escape') {
      e.stopImmediatePropagation();
      e.preventDefault();
      if (!e.repeat) closeLog();
    }
  }, true);
  // a click on the world (anywhere outside the panel and its button) puts the log away
  window.addEventListener('pointerdown', (e) => {
    if (!$logOpen.get()) return;
    const t = e.target as HTMLElement;
    if (t.closest('#notify-log, #log-btn')) return;
    closeLog();
  }, true);
}
