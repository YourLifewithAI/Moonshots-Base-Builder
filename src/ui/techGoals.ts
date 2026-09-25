/** The goals column of an era page's header (docs/14 §1.3): what opens the
 *  next era, with live progress, read from the sim's own charter progress
 *  (research.ts gateProgress, published as ResearchView.gates). The current
 *  page shows the next era's charter, a past page what it opened, a future
 *  page what opens it, and Era 8 the FIRST LIGHT checklist. The skeleton is
 *  built with the page; the numbers and bars update in place. */
import { ERA_GATES, ERA_NAMES, TECHS, TECH_ORDER, type Era } from '../data/techs';
import { LAUNCH_CAP_PER_VOLLEY, LAUNCH_COST_FOILS, LAUNCH_POWER_BURST } from '../data/balance';
import { RESOURCES } from '../data/resources';
import type { GateProgress, ResearchView } from '../core/research';
import { fmt } from './hud';
import { isCapstone } from './techPage';

/** what the goals column reads besides the research view ($swarm) */
export interface SwarmNow { armed: boolean; foils: number; launch: number; stored: number; launches: number }

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

/** the charter rows for the gate that opens `g.era` */
function gateRows(g: GateProgress): string {
  const prev = g.era - 1;
  let html = row('ck-techs', `<span class="gl-pips mono" data-g="pips"></span> <span data-g="techs"></span> of ${g.techsNeed} Era-${prev} techs`);
  html += row('ck-deed', `<span class="gl-or">or</span> ${g.deedTechsNeed} + ${esc(g.deed)}`, 'gl-deed');
  if (g.deedNeed > 1) {
    html += `<div class="gl-row gl-barrow"><span class="gl-ck"></span><div class="gl-bar"><i data-g="bar"></i></div>` +
      `<span class="mono gl-v" data-g="deed"></span></div>`;
  }
  if (g.requires) html += row('ck-req', `and ${esc(TECHS[g.requires.tech].name)} (robotic runs, either route)`);
  return html;
}

/** The column's skeleton for this page; `updateGoals` fills in the numbers. */
export function goalsHtml(page: Era, v: ResearchView): string {
  const kind = pageKind(page, v.era);
  if (page === 8 && kind !== 'future') {
    const f = RESOURCES.foils.glyph, l = RESOURCES.launch.glyph;
    return `<div class="gl-title label">FINAL GOAL · FIRST LIGHT</div>
      ${row('fl-armed', `${esc(TECHS[CAPSTONE].name)} researched`)}
      ${row('fl-foils', `${LAUNCH_COST_FOILS}${f} foils <span class="mono gl-v" data-g="fl-foils-v"></span>`)}
      ${row('fl-launch', `${LAUNCH_CAP_PER_VOLLEY}${l} launch capacity <span class="mono gl-v" data-g="fl-launch-v"></span>`)}
      ${row('fl-stored', `${LAUNCH_POWER_BURST} stored energy <span class="mono gl-v" data-g="fl-stored-v"></span>`)}
      ${row('fl-launched', `LAUNCH a collector volley <span class="mono gl-v" data-g="fl-launched-v"></span>`)}`;
  }
  if (kind === 'past') {
    const next = page + 1;
    return `<div class="gl-title label">ERA GOALS → Era ${next} ${esc(ERA_NAMES[next])}</div>
      <div class="gl-row gl-opened"><span class="gl-ck">✓</span><span class="gl-b">opened Era ${next}</span></div>
      <div class="gl-row"><span class="gl-ck"></span><span class="gl-b" data-g="page-count"></span></div>`;
  }
  if (kind === 'future') {
    const g = v.gates.find((x) => x.era === page)!;
    const wait = page - 1 > v.era ? `<div class="gl-row gl-note"><span class="gl-ck"></span><span class="gl-b">once Era ${page - 1} opens</span></div>` : '';
    const then = page === 8 ? `<div class="gl-row gl-note"><span class="gl-ck"></span><span class="gl-b">then FIRST LIGHT: ${esc(TECHS[CAPSTONE].name)} and a launch</span></div>` : '';
    return `<div class="gl-title label">LOCKED · ERA ${page} OPENS WITH</div>${gateRows(g)}${wait}${then}`;
  }
  const g = v.gates.find((x) => x.era === page + 1)!;
  return `<div class="gl-title label">ERA GOALS → Era ${page + 1} ${esc(ERA_NAMES[page + 1])}</div>${gateRows(g)}`;
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

/** Live numbers into the skeleton: text and bar widths only, never a rebuild. */
export function updateGoals(root: HTMLElement, page: Era, v: ResearchView, sw: SwarmNow) {
  const kind = pageKind(page, v.era);
  if (page === 8 && kind !== 'future') {
    check(root, 'fl-armed', sw.armed);
    check(root, 'fl-foils', sw.foils >= LAUNCH_COST_FOILS);
    set(root, 'fl-foils-v', `${fmt(sw.foils)}/${LAUNCH_COST_FOILS}`);
    check(root, 'fl-launch', sw.launch >= LAUNCH_CAP_PER_VOLLEY);
    set(root, 'fl-launch-v', `${fmt(sw.launch)}/${LAUNCH_CAP_PER_VOLLEY}`);
    check(root, 'fl-stored', sw.stored >= LAUNCH_POWER_BURST);
    set(root, 'fl-stored-v', `${fmt(sw.stored)}/${LAUNCH_POWER_BURST}`);
    check(root, 'fl-launched', sw.launches >= 1);
    set(root, 'fl-launched-v', sw.launches ? `${sw.launches} launched` : '');
    return;
  }
  if (kind === 'past') {
    let n = 0, done = 0, left = 0;
    for (const t of TECH_ORDER) {
      const c = v.cards[t];
      if (c.era !== page || c.state === 'hidden') continue;
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
  if (g.requires) check(root, 'ck-req', g.requires.done);
  root.classList.toggle('open', g.open);
}

/** the goals line an era tab carries in its title */
export function gateTitle(g: GateProgress | undefined): string {
  if (!g) return '';
  const gate = ERA_GATES[g.era];
  return `Era ${g.era} opens with ${g.techsNeed} Era-${g.era - 1} techs (${g.techs} done), or ${g.deedTechsNeed} + ${gate?.deed ?? g.deed} ` +
    `(${deedValue(g)})${g.requires ? `; robotic runs also need ${TECHS[g.requires.tech].name}` : ''}`;
}
