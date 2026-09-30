/** The race's HUD (docs/20 §2, stream S1): the ⚑ RACE chip in the chip column (after the OUTPOSTS chip; hidden in a solo game),
 *  the RACE side panel it opens (panel key `race`, the pattern of the hazards and weather panels), and the `race` notification
 *  family's card stack (`#race-card`, lower right) with the Moon's feed handlers that raise it.
 *
 *  Everything is read from `$race` (core/raceView.ts, built in Game.publish from `moon.factions`, `moon.race`, the rival bases
 *  and the feed): the panel lists each faction in standings order with its glyph, site, landing day, era, launches, first light,
 *  outposts and its last event. The swarm meter's three share bars and the verdict are stream S6's (they read the same `$race`). */
import './race.css';
import type { Game } from '../core/game';
import { onFeed, type FeedEvent } from '../core/moon';
import { ordinal, type RaceRow, type RaceView } from '../core/raceView';
import { CYCLE_S } from '../data/balance';
import { el } from './hud';
import { $race, $raceCards, $resourcePanel, $time, type RaceCard } from './stores';
import { esc, glyphOf, factionTrim, notify, runAlertAction } from './notify';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const dayOf = (at: number) => Math.floor(at / CYCLE_S);

// ─────────────────────────── the chip ───────────────────────────

/** The chip's text: your standing and the two that matter, `⚑ RACE 2nd · Foundry 3 volleys · you 1`; before the first volley
 *  there is no standing to show (`⚑ RACE · no first light yet`); once the race closes, the winner. */
export function raceChip(v: RaceView | null): { text: string; title: string } | null {
  if (!v) return null;
  const you = v.rows.find((r) => r.player)!;
  const lead = v.rows[0];
  const standings = v.rows.map((r) => `${ordinal(r.rank)} ${r.short}${r.player ? ' (you)' : ''} ${plural(r.launches, 'volley')}`).join(' · ');
  const title = `The race — ${standings} · ${v.combined}/${v.closeAt} combined volleys — the RACE panel`;
  if (v.phase === 'closed') {
    const w = v.rows.find((r) => r.faction === v.winner) ?? lead;
    return { text: `⚑ RACE CLOSED · ${w.player ? 'you win' : `${w.short} wins`}`, title };
  }
  if (v.combined === 0) return { text: '⚑ RACE · no first light yet', title: `The race — no volley has flown yet · ${v.closeAt} combined volleys close it — the RACE panel` };
  const text = lead.player
    ? `⚑ RACE ${ordinal(v.rank)} · you ${plural(you.launches, 'volley')} · ${v.rows[1].short} ${v.rows[1].launches}`
    : `⚑ RACE ${ordinal(v.rank)} · ${lead.short} ${plural(lead.launches, 'volley')} · you ${you.launches}`;
  return { text, title };
}

// ─────────────────────────── the panel ───────────────────────────

function landedLine(r: RaceRow, moonDay: number): string {
  if (r.landed) return `landed day ${r.landDay}`;
  const left = r.landDay - moonDay;
  return `lands day ${r.landDay}${left > 0 ? ` · in ${plural(left, 'day')}` : ''}`;
}

function rowHtml(r: RaceRow, v: RaceView): string {
  const stats = r.landed
    ? `<div class="rc-stats mono"><span class="rc-era">ERA ${r.era}</span> · <span class="rc-launches">${plural(r.launches, 'volley')}</span> · ` +
      `<span class="rc-fl">first light ${r.firstLightDay === null ? '—' : `day ${r.firstLightDay}`}</span></div>` +
      `<div class="rc-stats mono"><span class="rc-op">${plural(r.outposts, 'outpost')}</span> · <span class="rc-bld">${plural(r.buildings, 'building')}</span></div>`
    : `<div class="rc-stats mono"><span class="rc-era">not landed yet</span></div>`;
  const last = r.last
    ? `<span class="rc-ld">day ${dayOf(r.last.at)}</span> ${esc(r.last.text)}`
    : r.landed ? '<span class="rc-none">nothing to report</span>' : '<span class="rc-none">—</span>';
  return `<section class="rc-row${r.player ? ' you' : ''}" data-faction="${r.faction}" data-rank="${r.rank}" style="--ft:${r.trim}">` +
    `<div class="rc-head"><span class="rc-rank mono">${ordinal(r.rank)}</span><span class="rc-g" aria-hidden="true">${r.glyph}</span>` +
    `<b class="rc-name">${esc(r.name)}</b>${r.player ? '<span class="rc-you label">you</span>' : ''}</div>` +
    `<div class="rc-site label">${esc(r.site)} · ${landedLine(r, v.moonDay)}</div>` +
    `${stats}` +
    `<div class="rc-last">${last}</div></section>`;
}

/** The panel's body (exported for the spec's reading of it). */
export function raceBody(v: RaceView, missionDay: number): string {
  const close = v.phase === 'closed' ? 'The race is closed.'
    : v.combined === 0 ? `First light is open: the first volley any program flies. The race closes at ${v.closeAt} combined volleys.`
    : `${v.combined} of ${v.closeAt} combined volleys — the largest share wins at ${v.closeAt}; a tie goes to the earlier first light.`;
  return `<section class="rc-top"><div class="tt-name"><span>⚑ THE RACE</span><span class="label">Moon day ${v.moonDay} · your mission day ${missionDay}</span></div>` +
    `<div class="rc-close goal-hint">${esc(close)}</div></section>` +
    v.rows.map((r) => rowHtml(r, v)).join('');
}

// ─────────────────────────── the feed's news ───────────────────────────

let registered = false;

/** The Moon's feed handlers that tell the player (docs/20 §2, S1: a rival landed, a rival reached an era, a hearing). Each
 *  raises a `race`-family line in the alert stack and the log, dressed in the event's faction; the claim, launch, first light,
 *  standing and verdict kinds belong to the map and race streams (S5, S6). Registered once per page. */
export function registerRaceFeed() {
  if (registered) return;
  registered = true;
  const card = (e: FeedEvent, kind: 'info' | 'warn' = 'info') =>
    ({ text: e.text, kind, faction: e.faction, action: { panel: 'race' } });
  // the player's own landing and eras have their own screens; it is the other programs' that are news
  onFeed('landed', (e, { player }) => { if (e.faction !== player.faction) notify(player, 'race', card(e)); });
  onFeed('era', (e, { player }) => { if (e.faction !== player.faction) notify(player, 'race', card(e)); });
  // your own hearings are warnings; a rival's is news
  onFeed('hearing', (e, { player }) => notify(player, 'race', card(e, e.faction === player.faction ? 'warn' : 'info')));
}

// ─────────────────────────── the mount ───────────────────────────

/** how long a race card stays up (real seconds; the news is also in the log and the panel) */
const CARD_MS = 18_000;

export function mountRacePanel(root: HTMLElement, game: Game) {
  void game;
  registerRaceFeed();

  // ── the chip, after the OUTPOSTS chip ──
  const chip = el('button', 'btn panel interactive') as HTMLButtonElement;
  chip.id = 'race-chip';
  chip.style.display = 'none';
  const after = root.querySelector('#outposts-chip') ?? root.querySelector('#map-chip') ?? root.querySelector('#era-chip');
  const timeCol = root.querySelector('#time-controls');
  if (after) after.after(chip);
  else if (timeCol) timeCol.insertBefore(chip, timeCol.querySelector('#alerts'));
  else root.appendChild(chip);
  chip.addEventListener('click', () => {
    chip.blur();
    $resourcePanel.set($resourcePanel.get() === 'race' ? null : 'race');
  });

  // ── the panel ──
  const panel = el('div', 'panel interactive');
  panel.id = 'race-panel';
  panel.style.display = 'none';
  const body = el('div', 'rc-body');
  const foot = el('section', 'actions', '<button class="btn" id="race-close">Close</button>');
  panel.append(body, foot);
  (root.querySelector('#hud-left') ?? root).appendChild(panel);
  foot.querySelector('#race-close')!.addEventListener('click', () => $resourcePanel.set(null));
  let html = '';
  const render = () => {
    const v = $race.get();
    const c = raceChip(v);
    chip.style.display = c ? '' : 'none';
    if (c) {
      if (chip.textContent !== c.text) chip.textContent = c.text;
      chip.title = c.title;
    }
    chip.dataset.phase = v?.phase ?? '';
    chip.classList.toggle('lit', v?.phase === 'lit');
    chip.classList.toggle('behind', !!v && v.combined > 0 && !v.rows[0].player);
    const open = $resourcePanel.get() === 'race';
    if (!open || !v) { panel.style.display = 'none'; html = ''; return; }
    panel.style.display = '';
    const next = raceBody(v, $time.get().missionDay);
    if (next !== html) { html = next; body.innerHTML = next; }
  };
  $race.subscribe(render);
  $resourcePanel.subscribe(render);
  $time.subscribe(render);

  // ── the race family's card stack: the newest news, lower right, each dressed in its faction ──
  const stack = el('div', 'interactive');
  stack.id = 'race-card';
  stack.style.display = 'none';
  stack.setAttribute('role', 'status');
  root.appendChild(stack);
  const timers = new Map<number, number>();
  const drop = (id: number) => {
    window.clearTimeout(timers.get(id));
    timers.delete(id);
    $raceCards.set($raceCards.get().filter((c) => c.id !== id));
  };
  const itemHtml = (c: RaceCard) => {
    const trim = factionTrim(c.faction ?? undefined);
    return `<div class="rc-item nf nf-race" data-id="${c.id}"${c.faction ? ` data-faction="${c.faction}"` : ''}${trim ? ` style="--nf:${trim}"` : ''}>` +
      `<span class="rc-ig nf-g" aria-hidden="true">${glyphOf('race', c.faction ?? undefined)}</span>` +
      `<span class="rc-it">${esc(c.text)}</span>` +
      `${c.action ? '<button class="btn rc-open" data-rc="open" title="Open the RACE panel">Race ▸</button>' : ''}` +
      `<button class="rc-x" data-rc="x" title="Dismiss" aria-label="Dismiss">✕</button></div>`;
  };
  let sig = '';
  const renderCards = () => {
    const list = $raceCards.get();
    for (const c of list) if (!timers.has(c.id)) timers.set(c.id, window.setTimeout(() => drop(c.id), CARD_MS));
    for (const id of [...timers.keys()]) if (!list.some((c) => c.id === id)) { window.clearTimeout(timers.get(id)); timers.delete(id); }
    const next = list.map((c) => c.id).join(',');
    stack.style.display = list.length ? '' : 'none';
    if (next === sig) return;
    sig = next;
    stack.innerHTML = list.map(itemHtml).join('');
  };
  $raceCards.subscribe(renderCards);
  stack.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-rc]');
    const item = (e.target as HTMLElement).closest<HTMLElement>('.rc-item');
    if (!item) return;
    const id = Number(item.dataset.id);
    const card = $raceCards.get().find((c) => c.id === id);
    if (t?.dataset.rc === 'x') { drop(id); return; }
    if (card?.action) { runAlertAction(card.action); drop(id); }
  });
}
