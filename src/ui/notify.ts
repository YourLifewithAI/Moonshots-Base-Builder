/** One notification system (docs/19, improvement 13; S7 owns this file): the
 *  one entry point for anything the player is told, in one of five families
 *  (research, field, era, weather, hazard), each with its own shape, colour
 *  rule, position, sound and pause behaviour, all listed in the log.
 *
 *  This file is the pure half (no DOM, no stores): the family table, `notify()`,
 *  the log's views and the action registry. Core code may import it. The DOM
 *  half is `notifyUi.ts` (the field card, the log panel, the action runner)
 *  and the cards each family already had: research's `#discovery-card`, era's
 *  `#era-banner` and hazard's `#hazard-card` (ui/discovery.ts) and weather's
 *  `#flare-popup` (ui/weatherPanel.ts).
 *
 *  Colour: docs/07 stays greyscale, with one exception, a 3 px family rule on
 *  a card (notify.css). The glyph always carries the family too, so colour is
 *  never the only signal. */
import { alert } from '../core/economy';
import { CYCLE_S } from '../data/balance';
import type { Cue } from '../audio/sfx';
import type { AlertAction, AlertMsg, FieldReport, GameState, LogEntry, NotifyFamily } from '../core/state';

export type { NotifyFamily, FieldReport, FieldReward } from '../core/state';

/** What a notification says. `action` is what clicking it opens: a resource panel,
 *  a building, a deposit's card, the map at a prospect, the tree at a tech. `report`
 *  is a field card's body: a title, a geology line and one line per reward. */
export interface NotifyCard {
  text: string;
  kind?: AlertMsg['kind'];
  action?: AlertAction;
  report?: FieldReport;
}

export const NOTIFY_FAMILIES: readonly NotifyFamily[] = ['research', 'field', 'era', 'weather', 'hazard'];

/** How one family looks, sounds and behaves. `container` is the id of its card. */
export interface FamilySpec {
  id: NotifyFamily;
  label: string;
  /** shape, never colour: what the card, the stack line and the log row carry */
  glyph: string;
  /** what it announces, for the menu and the docs */
  what: string;
  /** where its card sits */
  where: string;
  container: string;
  /** the cue its card plays (research, era: the existing ones); hazards keep the radio's warn / crit by severity */
  cue: Cue | null;
  /** never · until Continue · a menu setting */
  pauses: 'never' | 'continue' | 'setting';
}

export const FAMILY: Record<NotifyFamily, FamilySpec> = {
  research: {
    id: 'research', label: 'Research', glyph: '✦', what: 'a tech finished, an insight', where: 'top centre',
    container: 'discovery-card', cue: 'research', pauses: 'never',
  },
  field: {
    id: 'field', label: 'Field', glyph: '◎', what: 'survey reports, breakthroughs, outposts, the atlas, deposit surveys',
    where: 'lower left, above the objectives', container: 'field-card', cue: 'chirp', pauses: 'never',
  },
  era: {
    id: 'era', label: 'Era', glyph: '⚑', what: 'an era opens, era-ending milestones, victory and defeat', where: 'full screen',
    container: 'era-banner', cue: 'era', pauses: 'continue',
  },
  weather: {
    id: 'weather', label: 'Weather', glyph: '☉', what: 'flare warnings and the arrays’ decision, blackouts', where: 'the flare pop-up',
    container: 'flare-popup', cue: 'flare', pauses: 'setting',
  },
  hazard: {
    id: 'hazard', label: 'Hazard', glyph: '⚠', what: 'drills, live hazards, critical alerts', where: 'the drill card',
    container: 'hazard-card', cue: null, pauses: 'setting',
  },
};

/** the glyph of a line that belongs to no family (a plain event) */
export const PLAIN_GLYPH = '·';

/** The family an alert is filed under: its own, else a crit alert is a hazard, else none. */
export function familyOf(a: { family?: NotifyFamily; kind: AlertMsg['kind'] }): NotifyFamily | undefined {
  return a.family ?? (a.kind === 'crit' ? 'hazard' : undefined);
}

export const glyphOf = (f: NotifyFamily | undefined) => (f ? FAMILY[f].glyph : PLAIN_GLYPH);

/** Tell the player something, filed under `family`: a line in the alert stack and
 *  in the saved log, and (field, with a report) a dispatch card. */
export function notify(s: GameState, family: NotifyFamily, card: NotifyCard) {
  alert(s, card.text, card.kind ?? 'info', card.action, family, card.report);
}

// ─────────────────────────── the log ───────────────────────────

/** The log, newest first, all of it or one family's. */
export function logEntries(log: readonly LogEntry[] | undefined, family?: NotifyFamily): LogEntry[] {
  const out: LogEntry[] = [];
  const list = log ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (!family || familyOf(e) === family) out.push(e);
  }
  return out;
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** 'D3' for the third lunar day */
export const dayTag = (at: number) => `D${Math.floor(at / CYCLE_S) + 1}`;

/** One row of the log, or of a filtered view of it (the weather panel's): glyph, text, count, day. */
export function logRowHtml(e: LogEntry): string {
  const fam = familyOf(e);
  const n = e.count > 1 ? `<span class="nl-n mono">×${e.count}</span>` : '';
  const act = e.action ? ' actionable' : '';
  return `<div class="nl-row nf ${fam ? `nf-${fam}` : 'nf-plain'} ${e.kind}${act}" data-log="${e.id}" role="${e.action ? 'button' : 'listitem'}"` +
    `${e.action ? ' tabindex="0"' : ''} title="${esc(e.text)}${e.action ? ' — click to open' : ''}">` +
    `<span class="nl-g" aria-hidden="true">${glyphOf(fam)}</span><span class="nl-t">${esc(e.text)}</span>${n}` +
    `<span class="nl-at mono">${dayTag(e.at)}</span></div>`;
}

// ─────────────────────────── actions ───────────────────────────

let runner: ((a: AlertAction) => void) | null = null;

/** notifyUi.ts registers what an action opens (it has the game and the screens). */
export function setActionRunner(fn: (a: AlertAction) => void) { runner = fn; }

/** Do what clicking a notification does: open the panel, the deposit's card, the
 *  building, the map at a prospect, the tree at a tech. */
export function runAlertAction(a: AlertAction) { runner?.(a); }
