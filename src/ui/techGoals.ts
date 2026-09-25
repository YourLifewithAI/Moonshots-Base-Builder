/** The goals column of an era page's header (docs/14 §1.3): what opens the
 *  next era, with live progress, read from the sim's own charter progress
 *  (research.ts gateProgress, published as ResearchView.gates). The current
 *  page shows the next era's charter — from Era 3 on its first item is the
 *  era's destiny pick —, a past page what it opened, a future page what opens
 *  it, and Era 8 the FIRST LIGHT checklist with the band. The skeleton is
 *  built with the page; the numbers and bars update in place. */
import { ERA_GATES, ERA_NAMES, SIDE_GLYPH, TECHS, TECH_ORDER, TRACKS, type Era, type TechId } from '../data/techs';
import { RESOURCES } from '../data/resources';
import type { GateProgress, ResearchView } from '../core/research';
import { fmt } from './hud';
import { isCapstone } from './techPage';
import { reachLine } from './techDestiny';

/** what the goals column reads besides the research view ($swarm): what is
 *  held, and what the next volley needs (docs/14: a crewed volley takes 2↑) */
export interface SwarmNow {
  armed: boolean; foils: number; launch: number; stored: number; launches: number;
  needFoils: number; needLaunch: number; burst: number;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CAPSTONE = TECH_ORDER.find(isCapstone)!;

function clock(s: number): string {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/** `240/600`, or `5:12/12:00` for a deed counted in seconds */
function deedValue(g: GateProgress): string {
  return /^\d/.test(g.deed) ? `${fmt(g.deedValue)}/${g.deedNeed}` : `${clock(g.deedValue)}/${clock(g.deedNeed)}`;
}

export type PageKind = 'past' | 'current' | 'future';
export const pageKind = (page: number, era: number): PageKind => (page < era ? 'past' : page > era ? 'future' : 'current');

const row = (ck: string, body: string, cls = '') =>
  `<div class="gl-row${cls ? ` ${cls}` : ''}"><span class="gl-ck" data-g="${ck}">◻</span><span class="gl-b">${body}</span></div>`;
const note = (body: string) => `<div class="gl-row gl-note"><span class="gl-ck"></span><span class="gl-b">${body}</span></div>`;
/** `Destiny: choose ⌂ or ◉`, or `⌂ Crew Rotation Charter` once chosen */
const destinyText = (tid: TechId | null) => {
  const tr = tid ? TECHS[tid].track : null;
  return tid && tr ? `${SIDE_GLYPH[tr.side]} ${TECHS[tid].name}` : `Destiny: choose ${SIDE_GLYPH.colony} or ${SIDE_GLYPH.automation}`;
};

/** the charter rows for the gate that opens `g.era` */
function gateRows(g: GateProgress, landingNote: boolean): string {
  const prev = g.era - 1;
  let html = '';
  if (g.destiny) html += row('ck-destiny', `<span data-g="destiny">${esc(destinyText(g.destiny.tid))}</span>`);
  html += row('ck-techs', `<span class="gl-pips mono" data-g="pips"></span> <span data-g="techs"></span> of ${g.techsNeed} Era-${prev} techs` +
    (g.destiny ? ' (the destiny counts)' : ''));
  const deedText = g.destiny ? `the destiny, ${g.deedTechsNeed - 1} more + ${g.deed}` : `${g.deedTechsNeed} + ${g.deed}`;
  // a requires row below (robotic Era 7) keeps the deed to one line: the column holds 112 px
  html += `<div class="gl-row gl-deed${g.requires ? ' one' : ''}" title="${esc(`or ${deedText}`)}"><span class="gl-ck" data-g="ck-deed">◻</span>` +
    `<span class="gl-b"><span class="gl-or">or</span> ${esc(deedText)}</span></div>`;
  if (g.deedNeed > 1) {
    html += `<div class="gl-row gl-barrow"><span class="gl-ck"></span><div class="gl-bar"><i data-g="bar"></i></div>` +
      `<span class="mono gl-v" data-g="deed"></span></div>`;
  }
  // robotic Era 7: either Era 6 destiny settles Human Cohabitation (docs/14 §2.5)
  if (g.requires) {
    html += row('ck-req', `<span data-g="req">${esc(TECHS[g.requires.tech].name)} — either destiny settles it: ` +
      `${SIDE_GLYPH.colony} brings the crew · ${SIDE_GLYPH.automation} waives it</span>`);
  }
  if (landingNote) html += note('your landing choice does not count');
  return html;
}

/** The column's skeleton for this page; `updateGoals` fills in the numbers. */
export function goalsHtml(page: Era, v: ResearchView): string {
  const kind = pageKind(page, v.era);
  if (page === 8 && kind !== 'future') {
    const f = RESOURCES.foils.glyph, l = RESOURCES.launch.glyph;
    const pick = [TRACKS[8].colony, TRACKS[8].automation].find((t) => v.cards[t].state === 'done') ?? null;
    const item = (ck: string, body: string) => `<span class="gl-item"><span class="gl-ck" data-g="${ck}">◻</span> ${body}</span>`;
    return `<div class="gl-title label">FINAL GOAL · FIRST LIGHT</div>
      ${row('fl-destiny', `<span data-g="fl-destiny-t">${esc(destinyText(pick))}</span>`)}
      ${row('fl-armed', `${esc(TECHS[CAPSTONE].name)} researched`)}
      <div class="gl-row gl-items"><span class="gl-b">${item('fl-foils', `<span class="mono" data-g="fl-foils-v"></span>${f}`)} · ` +
        `${item('fl-launch', `<span class="mono" data-g="fl-launch-v"></span>${l}`)} · ` +
        `${item('fl-stored', `<span class="mono" data-g="fl-stored-v"></span> stored`)}</span></div>
      ${row('fl-launched', `LAUNCH a collector volley <span class="mono gl-v" data-g="fl-launched-v"></span>`)}
      ${note(`<span data-g="fl-band"></span>`)}`;
  }
  if (kind === 'past') {
    const next = page + 1;
    return `<div class="gl-title label">ERA GOALS → Era ${next} ${esc(ERA_NAMES[next])}</div>
      <div class="gl-row gl-opened"><span class="gl-ck">✓</span><span class="gl-b">opened Era ${next}</span></div>
      <div class="gl-row"><span class="gl-ck"></span><span class="gl-b" data-g="page-count"></span></div>`;
  }
  if (kind === 'future') {
    const g = v.gates.find((x) => x.era === page)!;
    const wait = page - 1 > v.era ? ` · once Era ${page - 1} opens` : '';
    const then = page === 8 ? `<div class="gl-row gl-note"><span class="gl-ck"></span><span class="gl-b">then FIRST LIGHT: the Era 8 destiny, ${esc(TECHS[CAPSTONE].name)} and a launch</span></div>` : '';
    return `<div class="gl-title label">LOCKED · ERA ${page} OPENS WITH${wait}</div>${gateRows(g, page === 2)}${then}`;
  }
  const g = v.gates.find((x) => x.era === page + 1)!;
  return `<div class="gl-title label">ERA GOALS → Era ${page + 1} ${esc(ERA_NAMES[page + 1])}</div>${gateRows(g, page === 1)}`;
}

function set(root: HTMLElement, key: string, text: string) {
  const e = root.querySelector<HTMLElement>(`[data-g="${key}"]`);
  if (e && e.textContent !== text) e.textContent = text;
}
function check(root: HTMLElement, key: string, ok: boolean) {
  const e = root.querySelector<HTMLElement>(`[data-g="${key}"]`);
  if (!e) return;
  const t = ok ? '✓' : '◻';
  if (e.textContent !== t) e.textContent = t;
  e.parentElement?.classList.toggle('met', ok);
}
const vol = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Live numbers into the skeleton: text and bar widths only, never a rebuild. */
export function updateGoals(root: HTMLElement, page: Era, v: ResearchView, sw: SwarmNow) {
  const kind = pageKind(page, v.era);
  if (page === 8 && kind !== 'future') {
    const pick = [TRACKS[8].colony, TRACKS[8].automation].find((t) => v.cards[t].state === 'done') ?? null;
    check(root, 'fl-destiny', !!pick);
    set(root, 'fl-destiny-t', destinyText(pick));
    check(root, 'fl-armed', sw.armed);
    check(root, 'fl-foils', sw.foils >= sw.needFoils);
    set(root, 'fl-foils-v', `${fmt(sw.foils)}/${sw.needFoils}`);
    check(root, 'fl-launch', sw.launch >= sw.needLaunch);
    set(root, 'fl-launch-v', `${fmt(sw.launch)}/${vol(sw.needLaunch)}`);
    check(root, 'fl-stored', sw.stored >= sw.burst);
    set(root, 'fl-stored-v', `${fmt(sw.stored)}/${Math.round(sw.burst)}`);
    check(root, 'fl-launched', sw.launches >= 1);
    set(root, 'fl-launched-v', sw.launches ? `${sw.launches} launched` : '');
    set(root, 'fl-band', v.destiny.band ? reachLine(v.destiny) : `the band settles with this pick · ${reachLine(v.destiny)}`);
    return;
  }
  if (kind === 'past') {
    let n = 0, done = 0, left = 0;
    for (const t of TECH_ORDER) {
      const c = v.cards[t];
      if (c.era !== page || c.state === 'hidden' || c.track) continue;
      n++;
      if (c.state === 'done') done++;
      else if (['available', 'full', 'requires', 'requiresAny'].includes(c.state)) left++;
    }
    set(root, 'page-count', `${done} of ${n} Era-${page} techs researched${left ? ` · ${left} left` : ''}`);
    return;
  }
  const g = v.gates.find((x) => x.era === (kind === 'future' ? page : page + 1));
  if (!g) return;
  const n = Math.min(g.techs, g.techsNeed);
  set(root, 'pips', `${'◼'.repeat(n)}${'◻'.repeat(Math.max(0, g.techsNeed - n))}`);
  set(root, 'techs', String(g.techs));
  check(root, 'ck-techs', g.techs >= g.techsNeed);
  check(root, 'ck-deed', g.techs >= g.deedTechsNeed && g.deedMet);
  set(root, 'deed', deedValue(g));
  const bar = root.querySelector<HTMLElement>('[data-g="bar"]');
  if (bar) {
    const w = `${Math.min(100, (g.deedValue / Math.max(1, g.deedNeed)) * 100).toFixed(1)}%`;
    if (bar.style.width !== w) bar.style.width = w;
  }
  if (g.destiny) {
    check(root, 'ck-destiny', g.destiny.done);
    set(root, 'destiny', destinyText(g.destiny.tid));
  }
  if (g.requires) {
    check(root, 'ck-req', g.requires.done || g.requires.waived);
    const name = TECHS[g.requires.tech].name;
    set(root, 'req', g.requires.done ? name
      : g.requires.waived ? `${name} waived — ${SIDE_GLYPH.automation} the Moon runs without a crew`
      : `${name} — either destiny settles it: ${SIDE_GLYPH.colony} brings the crew · ${SIDE_GLYPH.automation} waives it`);
  }
  root.classList.toggle('open', g.open);
}

/** the goals line an era tab carries in its title */
export function gateTitle(g: GateProgress | undefined): string {
  if (!g) return '';
  const gate = ERA_GATES[g.era];
  const destiny = g.destiny ? `the Era-${g.era - 1} destiny (${g.destiny.done ? 'chosen' : 'to choose'}) and ` : '';
  return `Era ${g.era} opens with ${destiny}${g.techsNeed} Era-${g.era - 1} techs (${g.techs} done), or ${g.deedTechsNeed} + ${gate?.deed ?? g.deed} ` +
    `(${deedValue(g)})${g.requires ? `; robotic runs also need ${TECHS[g.requires.tech].name}, or the destiny that waives it` : ''}`;
}
