/** The destiny column of an era page's header, the destiny pip on its tab and
 *  the destiny meter (docs/14 §1.2–1.3, §2.4). The tree calls destinySlot(),
 *  destinyPip() and destinyMeter(), and handles clicks on `[data-select]`.
 *
 *  - Era 1 shows the landing expedition, chosen at landing.
 *  - Eras 2–8 show the era's pick: two cards, ⌂ Colony left and ◉ Automation
 *    right, each with up to two generated ⊕ and ⊖ lines, its visual line, its
 *    cost and its state. A click only selects; the detail sheet commits
 *    (the doctrine flow of docs/11 §6). Doctrine pairs stay on the board. */
import {
  BAND_LABEL, CAPSTONES, SIDES, SIDE_GLYPH, SIDE_LABEL, TECHS, TRACKS, describeTech,
  type Era, type Side, type TechId,
} from '../data/techs';
import { PURE_AT } from '../data/balance';
import { RESOURCES, type ResourceId } from '../data/resources';
import type { SiteId } from '../data/sites';
import type { DestinyView, ResearchCard, ResearchView } from '../core/research';
import type { Game } from '../core/game';
import { PERSON_SVG } from './hud';
import { expeditionCopy } from './expeditionCopy';

export interface DestinySlot {
  html: string;
  /** the header is rebuilt when this changes */
  sig: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const glyph = (r: string) => RESOURCES[r as ResourceId]?.glyph ?? '';
const sideName = (s: Side) => (s === 'colony' ? 'Colony' : 'Automation');

/** The destiny column for page `era` (never null now: every era has a choice). */
export function destinySlot(era: Era, game: Game, v: ResearchView): DestinySlot | null {
  const s = game.state;
  if (era === 1) return landingSlot(s.expedition, s.siteId);
  return pickSlot(era, v, s.siteId, s.expedition, s.techsDone);
}

/** The tab's destiny pip: ⌂ or ◉ once chosen, ○ before. */
export function destinyPip(era: Era, _game: Game, v: ResearchView): string {
  const p = v.destiny.picks[era - 1];
  return p ? SIDE_GLYPH[p] : '○';
}

/** `⌂◉⌂⌂○○○○`: the eight picks in era order */
export const destinyPips = (d: DestinyView) => d.picks.map((p) => (p ? SIDE_GLYPH[p] : '○')).join('');

/** The reach line (the meter's hover): what each band still needs of the picks left. */
export function reachLine(d: DestinyView): string {
  if (d.band) {
    const n = d.band === 'colony' ? d.c : d.band === 'automation' ? d.a : Math.max(d.c, d.a);
    const pure = d.band !== 'concord';
    return `band: ${BAND_LABEL[d.band]}${pure ? ` ${n}/8 — pure` : ` (${SIDE_GLYPH.colony}${d.c} · ${SIDE_GLYPH.automation}${d.a})`}` +
      ` · ${TECHS[CAPSTONES[d.band]].name} unlocked`;
  }
  const side = (s: Side) => {
    const r = d.reach[s];
    return `pure ${sideName(s)}: ${r.ok ? `${r.need} of the ${d.left} left` : 'out of reach'}`;
  };
  return `${side('colony')} · ${side('automation')} · ${d.reach.concord ? 'otherwise Concord' : 'Concord out of reach'}`;
}

/** The destiny meter in the era column: pips, counts and what is left. */
export function destinyMeter(d: DestinyView): string {
  const counts = `${SIDE_GLYPH.colony}${d.c} · ${SIDE_GLYPH.automation}${d.a}`;
  const tail = d.band ? `${BAND_LABEL[d.band]}${d.band === 'concord' ? '' : ' · pure'}`
    : `pure at ${PURE_AT} · ${d.left} to choose`;
  return `<div class="ph-meter mono" data-g="meter" title="${esc(reachLine(d))}">` +
    `<span class="dm-pips">${destinyPips(d)}</span> <span class="dm-n">${counts} · ${esc(tail)}</span></div>`;
}

function landingSlot(exp: 'human' | 'robotic', siteId: SiteId): DestinySlot {
  const mine = expeditionCopy(exp, siteId);
  const other = exp === 'human' ? 'robotic' : 'human';
  const oc = expeditionCopy(other, siteId);
  const side: Side = exp === 'human' ? 'colony' : 'automation';
  const g = (e: string) => (e === 'human' ? PERSON_SVG : '◉');
  const col = (list: string[], sign: 'pro' | 'con') => list
    .map((t) => `<div class="fx fx-${sign}" title="${esc(t)}">${sign === 'pro' ? '⊕' : '⊖'} ${esc(t)}</div>`).join('');
  return {
    sig: `landing|${exp}|${siteId}`,
    html: `<div class="dz-head label">DESTINY · chosen at landing <span class="dz-q">— ${esc(TRACKS[1].question)}</span></div>
      <div class="dz-landing">
        <div class="dz-exp chosen side-${side}" data-exp="${exp}" data-side="${side}">
          <div class="dz-name">${g(exp)} ${esc(mine.title)} <span class="dz-tag">${SIDE_GLYPH[side]} ${SIDE_LABEL[side]} · ✓ CHOSEN</span></div>
          <div class="dz-fx"><div>${col(mine.pros, 'pro')}</div><div>${col(mine.cons, 'con')}</div></div>
        </div>
        <div class="dz-exp other" data-exp="${other}" title="${esc(oc.place)}">
          <div class="dz-name">${g(other)} ${esc(oc.title.split(' · ')[0])}</div>
          <div class="dz-why">not taken · fixed at landing</div>
        </div>
      </div>`,
  };
}

const PICK_STATE: Partial<Record<ResearchCard['state'], string>> = {
  done: '✓ CHOSEN', stalled: 'queued · waiting on goods', foreclosed: 'foreclosed',
  crewLocked: 'crew tech', requires: 'locked', requiresAny: 'locked', full: 'queue full',
};

function pickSlot(era: Era, v: ResearchView, siteId: SiteId, exp: 'human' | 'robotic', done: readonly TechId[]): DestinySlot {
  const t = TRACKS[era];
  const qi = (tid: TechId) => v.queue.findIndex((q) => q.tid === tid);
  const card = (side: Side) => {
    const tid = side === 'colony' ? t.colony : t.automation;
    const c = v.cards[tid];
    const def = TECHS[tid];
    const st = c.state === 'queued' || c.state === 'stalled' ? 'queued' : c.state === 'done' ? 'done'
      : c.state === 'foreclosed' ? 'foreclosed' : c.state === 'available' ? 'available' : c.state === 'full' ? 'full'
      : c.state === 'eraLocked' ? 'future' : 'locked';
    const status = c.state === 'available' ? '[select]'
      : c.state === 'queued' ? `#${qi(tid) + 1} queued`
      : c.state === 'eraLocked' ? `choose when Era ${era} opens` : PICK_STATE[c.state] ?? '';
    const lines = describeTech(def, { siteId, expedition: exp, done });
    const pros = lines.filter((l) => l.sign === 'pro').slice(0, 2);
    const cons = lines.filter((l) => l.sign === 'con').slice(0, 2);
    const goods = Object.entries(c.cost.goods).map(([r, a]) => ` <span class="g" data-res="${r}" data-need="${a}">${a}${glyph(r)}</span>`).join('');
    const fx = [
      ...pros.map((l) => `<span class="dz-fx fx-pro" title="${esc(l.text)}">⊕ ${esc(l.text)}</span>`),
      ...cons.map((l) => `<span class="dz-fx fx-con" title="${esc(l.text)}">⊖ ${esc(l.text)}</span>`),
    ].join('');
    const hint = c.state === 'available' ? 'a click selects; commit in the sheet' : c.reason;
    return `<button class="dz-card side-${side} st-${st}" data-select="${tid}" data-side="${side}" data-state="${c.state}"
        title="${esc(`${SIDE_GLYPH[side]} ${SIDE_LABEL[side]} · ${c.name}${hint ? ` — ${hint}` : ''}`)}">
      <span class="dz-l1"><span class="gl">${SIDE_GLYPH[side]}</span><span class="nm">${esc(c.name)}</span>
        <span class="dz-st">${esc(status)}</span></span>
      ${fx}
      <span class="dz-vis">${esc(def.visual ?? '')}</span>
      <span class="dz-l2 mono">${c.state === 'done' ? `${SIDE_LABEL[side]} · researched` : `${c.cost.data}≡${goods}`}</span>
    </button>`;
  };
  const sig = SIDES.map((sd) => {
    const tid = sd === 'colony' ? t.colony : t.automation;
    const c = v.cards[tid];
    return `${tid}${c.state}${qi(tid)}${c.cost.data}${c.goodsShort.join('')}`;
  }).join(',');
  return {
    sig: `pick|${era}|${siteId}|${exp}|${sig}|${done.includes('humanCohabitation') ? 'cohab' : ''}`,
    html: `<div class="dz-head label">DESTINY · choose one · permanent <span class="dz-q">— ${esc(t.question)}</span></div>
      <div class="dz-cards">${card('colony')}${card('automation')}</div>`,
  };
}
