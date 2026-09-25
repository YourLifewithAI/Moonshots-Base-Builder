/** The destiny column of an era page's header, and the destiny pip on its
 *  tab (docs/14 §1.2–1.3). This file is the boundary the destiny tracks
 *  (docs/14 Phase B) replace; the tree only calls destinySlot() and
 *  destinyPip(), and handles clicks on `[data-select]`.
 *
 *  Until then:
 *  - Era 1 shows the landing expedition, chosen at landing.
 *  - An era with a doctrine shows its pair(s): the choice that commits
 *    the base to a track today. A click only selects; the sheet commits.
 *  - Any other era has no box (null), and the era column takes the room. */
import { DOCTRINES, TECHS, TECH_ORDER, describeTech, type DoctrineId, type Era, type TechId } from '../data/techs';
import { RESOURCES, type ResourceId } from '../data/resources';
import { SITES, type SiteId } from '../data/sites';
import type { ResearchCard, ResearchView } from '../core/research';
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
const siteName = (id: SiteId) => SITES[id].name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** The destiny column for page `era`, or null for no box. */
export function destinySlot(era: Era, game: Game, v: ResearchView): DestinySlot | null {
  const s = game.state;
  if (era === 1) return landingSlot(s.expedition, s.siteId);
  const pairs = new Map<DoctrineId, ResearchCard[]>();
  for (const tid of TECH_ORDER) {
    const c = v.cards[tid];
    if (c.era !== era || !c.doctrine || c.state === 'hidden') continue;
    if (!pairs.has(c.doctrine)) pairs.set(c.doctrine, []);
    pairs.get(c.doctrine)!.push(c);
  }
  if (!pairs.size) return null;
  return doctrineSlot(pairs, v, s.siteId, s.expedition);
}

/** The tab's destiny pip: ⌂ or ◉ once chosen, ○ before. Empty until the destiny tracks exist. */
export function destinyPip(_era: Era, _game: Game, _v: ResearchView): string {
  return '';
}

function landingSlot(exp: 'human' | 'robotic', siteId: SiteId): DestinySlot {
  const mine = expeditionCopy(exp, siteId);
  const other = exp === 'human' ? 'robotic' : 'human';
  const oc = expeditionCopy(other, siteId);
  const g = (e: string) => (e === 'human' ? PERSON_SVG : '◉');
  const col = (list: string[], sign: 'pro' | 'con') => list
    .map((t) => `<div class="fx fx-${sign}" title="${esc(t)}">${sign === 'pro' ? '⊕' : '⊖'} ${esc(t)}</div>`).join('');
  return {
    sig: `landing|${exp}|${siteId}`,
    html: `<div class="dz-head label">DESTINY · chosen at landing</div>
      <div class="dz-landing">
        <div class="dz-exp chosen" data-exp="${exp}">
          <div class="dz-name">${g(exp)} ${esc(mine.title)} <span class="dz-tag">✓ CHOSEN</span></div>
          <div class="dz-fx"><div>${col(mine.pros, 'pro')}</div><div>${col(mine.cons, 'con')}</div></div>
        </div>
        <div class="dz-exp other" data-exp="${other}" title="${esc(oc.place)}">
          <div class="dz-name">${g(other)} ${esc(oc.title.split(' · ')[0])}</div>
          <div class="dz-why">not taken · fixed at landing</div>
        </div>
      </div>`,
  };
}

const OPT_STATE: Partial<Record<ResearchCard['state'], string>> = {
  done: '✓ CHOSEN', queued: 'queued', stalled: 'queued · waiting on goods', foreclosed: 'foreclosed',
  eraLocked: 'era locked', crewLocked: 'crew tech', requires: 'locked', requiresAny: 'locked', full: 'queue full',
};

function doctrineSlot(pairs: Map<DoctrineId, ResearchCard[]>, v: ResearchView, siteId: SiteId, exp: 'human' | 'robotic'): DestinySlot {
  const one = pairs.size === 1;
  const qi = (t: TechId) => v.queue.findIndex((q) => q.tid === t);
  const opt = (c: ResearchCard) => {
    const st = c.state === 'queued' || c.state === 'stalled' ? 'queued' : c.state === 'done' ? 'done'
      : c.state === 'foreclosed' ? 'foreclosed' : c.state === 'available' ? 'available' : c.state === 'full' ? 'full' : 'locked';
    const gl = c.state === 'done' ? '✓' : c.state === 'foreclosed' ? '✗' : st === 'queued' ? `#${qi(c.tid) + 1}` : '◇';
    const goods = Object.entries(c.cost.goods).map(([r, a]) => ` ${a}${glyph(r)}`).join('');
    const status = c.state === 'available' ? 'select' : OPT_STATE[c.state] ?? '';
    const lines = one ? describeTech(TECHS[c.tid], { siteId, expedition: exp }) : [];
    const pro = lines.find((l) => l.sign === 'pro');
    const con = lines.find((l) => l.sign === 'con');
    return `<button class="dz-opt st-${st}" data-select="${c.tid}" data-state="${c.state}"
        title="${esc(`${c.name} — ${c.reason || (c.state === 'available' ? 'select to see both sides; commit in the sheet' : '')}`)}">
      <span class="dz-l1"><span class="gl">${gl}</span><span class="nm">${esc(c.short)}</span>
        <span class="dz-st">${esc(status)}</span></span>
      <span class="dz-l2 mono">${c.state === 'done' ? 'researched' : `${c.cost.data}≡${goods}`}</span>
      ${pro ? `<span class="dz-fx fx-pro">⊕ ${esc(pro.text)}</span>` : ''}
      ${con ? `<span class="dz-fx fx-con">⊖ ${esc(con.text)}</span>` : ''}
    </button>`;
  };
  let html = `<div class="dz-head label">DOCTRINE · choose one · permanent</div><div class="dz-pairs${one ? ' one' : ''}">`;
  const sig: string[] = [];
  for (const [group, list] of pairs) {
    const d = DOCTRINES[group];
    const note = d.siteNote[siteId];
    html += `<div class="dz-pair" data-group="${group}">
      <div class="dz-q" title="${esc(note ? `At ${siteName(siteId)}: ${note}` : d.question)}">◇ ${esc(d.question)}${note
        ? ` <span class="dz-note">· ${esc(note)}</span>` : ''}</div>
      <div class="dz-opts">${list.map(opt).join('<span class="dz-or">or</span>')}</div></div>`;
    sig.push(`${group}:${list.map((c) => `${c.tid}${c.state}${qi(c.tid)}${c.cost.data}`).join(',')}`);
  }
  html += '</div>';
  return { html, sig: `doctrine|${siteId}|${exp}|${sig.join('|')}` };
}
