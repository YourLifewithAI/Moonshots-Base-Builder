/** The race's HUD (docs/20 §2, stream S1): the ⚑ RACE chip in the chip column (after the OUTPOSTS chip; hidden in a solo game),
 *  the RACE side panel it opens (panel key `race`, the pattern of the hazards and weather panels), and the `race` notification
 *  family's card stack (`#race-card`, lower right) with the Moon's feed handlers that raise it.
 *
 *  Everything is read from `$race` (core/raceView.ts, built in Game.publish from `moon.factions`, `moon.race`, the rival bases
 *  and the feed): the panel lists each faction in standings order with its glyph, site, landing day, era, launches, first light,
 *  outposts and its last event. S6 adds the feed's race beats (a rival's first light as a banner under the swarm meter, the standings,
 *  the verdict); the swarm meter's three share bars are in hud.ts and the verdict screen in screens.ts (both read the same `$race`). */
import './race.css';
import type { Game } from '../core/game';
import { onFeed, standingsOrder, type FeedEvent } from '../core/moon';
import { ordinal, ordinalWord, VERDICT_TITLE, verdictLine, verdictView, type RaceRow, type RaceView } from '../core/raceView';
import { CYCLE_S } from '../data/balance';
import { FACTIONS, FACTION_ORDER } from '../data/factions';
import { el } from './hud';
import { $race, $raceBanner, $raceCards, $resourcePanel, $time, $verdict, type RaceBanner, type RaceCard } from './stores';
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
    // how it ended for you (the verdict), then the standings as they are now: the leaderboard stays live after the close
    const w = v.rows.find((r) => r.faction === v.winner) ?? lead;
    const how = v.verdict?.kind === 'yours' ? 'yours' : v.verdict?.kind === 'shared' ? 'shared' : w.player ? 'you win' : `${w.short} wins`;
    return { text: `⚑ RACE CLOSED · ${how}`, title: `${title} · ${v.verdict ? VERDICT_TITLE[v.verdict.kind].toLowerCase() : 'closed'}` };
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
      `<span class="rc-fl">first light ${r.firstLightDay === null ? '—' : `day ${r.firstLightDay}`}</span> · ` +
      `<span class="rc-op">${plural(r.outposts, 'outpost')}</span></div>`
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
  const close = v.phase === 'closed'
    ? `The race closed at ${v.verdict?.total ?? v.closeAt} combined volleys${v.verdict ? ` — ${VERDICT_TITLE[v.verdict.kind]}` : ''}. The standings below stay live.`
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
  onFeed('landed', (e, { player }) => { if (player && e.faction !== player.faction) notify(player, 'race', card(e)); });
  onFeed('era', (e, { player }) => { if (player && e.faction !== player.faction) notify(player, 'race', card(e)); });
  // your own hearing is already a hazard-family alert on the base (core/scrutiny.hearing): only a rival's is news here
  onFeed('hearing', (e, { player }) => { if (player && e.faction !== player.faction) notify(player, 'race', card(e)); });

  // ── the race itself (S6) ──
  // A rival's FIRST LIGHT is a banner above the palette (your own has its screen): who lit, which to light, where you stand. The
  // line also goes in the log and the alert stack like any race news; its small card would say it twice, so the stack skips it.
  onFeed('firstLight', (e, { moon, player }) => {
    if (!player || e.faction === player.faction) return;
    const lit = FACTION_ORDER.filter((f) => moon.race[f].firstLaunchAt !== null)
      .sort((a, b) => moon.race[a].firstLaunchAt! - moon.race[b].firstLaunchAt! || FACTION_ORDER.indexOf(a) - FACTION_ORDER.indexOf(b));
    const theirs = lit.indexOf(e.faction) + 1;
    const mine = player.faction ? lit.indexOf(player.faction) + 1 : 0;
    const day = dayOf(moon.race[e.faction].firstLaunchAt ?? e.at);
    const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
    const you = mine > 0 ? `You lit ${ordinalWord(mine)}.` : 'You have not lit: your share starts with your first volley.';
    const text = `${cap(ordinalWord(theirs))} of ${FACTION_ORDER.length} to light, on Moon day ${day}. ${you} ` +
      `The race closes at ${moon.race.closeAt} combined volleys.`;
    bannered.add(e.text);
    notify(player, 'race', card(e, 'warn'));
    $raceBanner.set({ id: e.id, faction: e.faction, title: `FIRST LIGHT · ${FACTIONS[e.faction].name.toUpperCase()}`, text });
  });
  // A standings beat (every RACE.beatEvery combined volleys, and a change of lead): the feed's line and where you stand in it
  onFeed('standing', (e, { moon, player }) => {
    if (!player) return;
    const me = player.faction;
    const rank = me ? standingsOrder(moon.race).indexOf(me) + 1 : 0;
    const tail = !me || e.faction === me ? '' : ` — you are ${ordinal(rank)}`;
    notify(player, 'race', card({ ...e, text: e.text + tail }));
  });
  // The close: one race line for the record, and the verdict screen (ui/screens.ts mountVerdict reads `$verdict` and `$race.verdict`)
  onFeed('verdict', (e, { moon, player }) => {
    const r = moon.race;
    if (!player || !player.faction || !r.verdict || !r.final || !r.winner) return;
    const v = verdictView(moon, r.final, r.verdict, r.winner, player.faction);
    notify(player, 'race', { text: `${VERDICT_TITLE[v.kind]} — ${verdictLine(v)}`, kind: 'warn', faction: e.faction, action: { panel: 'race' } });
    $verdict.set(true);
  });
}

/** texts a banner has taken over from the card stack (a rival's first light) */
const bannered = new Set<string>();

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
    const shown = list.filter((c) => !bannered.has(c.text));
    stack.style.display = shown.length ? '' : 'none';
    if (next === sig) return;
    sig = next;
    stack.innerHTML = shown.map(itemHtml).join('');
  };
  $raceCards.subscribe(renderCards);

  // ── the banner above the palette (S6): a rival's first light, in its colours; it stays 20 real seconds or until dismissed ──
  const banner = el('div', 'interactive nf nf-race');
  banner.id = 'race-banner';
  banner.style.display = 'none';
  banner.setAttribute('role', 'status');
  root.appendChild(banner);
  let bannerTimer = 0;
  const hideBanner = () => { window.clearTimeout(bannerTimer); if ($raceBanner.get()) $raceBanner.set(null); };
  $raceBanner.subscribe((b: RaceBanner | null) => {
    window.clearTimeout(bannerTimer);
    if (!b || !$race.get()) { banner.style.display = 'none'; banner.innerHTML = ''; return; }
    const d = FACTIONS[b.faction];
    banner.dataset.faction = b.faction;
    banner.style.setProperty('--nf', d.livery.trim);
    banner.innerHTML = `<span class="rb-g nf-g" aria-hidden="true">${d.glyph}\uFE0E</span>` +
      `<div class="rb-t"><b class="rb-title">${esc(b.title)}</b><span class="rb-text">${esc(b.text)}</span></div>` +
      `<button class="btn rb-open" data-rb="open" title="Open the RACE panel">Race ▸</button>` +
      `<button class="rc-x" data-rb="x" title="Dismiss" aria-label="Dismiss">✕</button>`;
    // centred just above the build palette, wherever its top stands: the top of the screen is the flare pop-up's and the research card's,
    // the lander sits in the middle, the right is the alert stack
    const pal = root.querySelector('#palette') as HTMLElement | null;
    const top = pal && pal.offsetParent !== null ? pal.getBoundingClientRect().top : window.innerHeight - 100;
    banner.style.bottom = `${Math.round(window.innerHeight - top + 10)}px`;
    banner.style.display = '';
    bannerTimer = window.setTimeout(hideBanner, 20_000);
  });
  banner.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-rb]');
    if (!t) return;
    if (t.dataset.rb === 'open') $resourcePanel.set('race');
    hideBanner();
  });
  // a new game or a solo game has no banner
  $race.subscribe((v) => { if (!v && $raceBanner.get()) $raceBanner.set(null); });
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
