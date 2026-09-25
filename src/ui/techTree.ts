/** The research tree (docs/14 §1): one page per era, E1…E8. Each page has
 *  a header (the era, its destiny column, its goals with live charter
 *  progress) over a lane board of that era's cards only, with stubs to the
 *  eras before and after. The queue strip and the detail sheet are global
 *  across pages. It renders $research and dispatches research actions;
 *  availability, cost and ETA all come from core/research.ts. */
import './techTree.css';
import {
  DOCTRINES, ERA_BLURB, ERA_NAMES, LANES, TECHS, TECH_ORDER, describeTech,
  type DoctrineId, type Era, type EffectLine, type Lane, type TechId,
} from '../data/techs';
import { BUILDINGS } from '../data/buildings';
import { CHARTER_DEED_TECHS, CHARTER_TECHS } from '../data/balance';
import { RESOURCES, type ResourceId } from '../data/resources';
import { SITES, type SiteId } from '../data/sites';
import type { Expedition } from '../data/techs';
import {
  previewTech, producerName, producerOf,
  type ResearchCard, type ResearchView, type TechState,
} from '../core/research';
import type { Game } from '../core/game';
import type { Action } from '../core/actions';
import { el, fmt } from './hud';
import {
  $alerts, $counts, $defeat, $lunar, $mode, $phase, $research, $resources, $siteId, $swarm, $time, $victory, $vitals, overlayUp,
} from './stores';
import {
  DEPENDENTS, GEO, computePageLayout, isPlaceholder, isVisible,
  type PageItem, type PageLayout, type Stub,
} from './techPage';
import { destinyPip, destinySlot } from './techDestiny';
import { gateTitle, goalsHtml, pageKind, updateGoals } from './techGoals';

// ─────────────────────────── text helpers ───────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const siteName = (id: SiteId) => titleCase(SITES[id].name);
const glyph = (r: string) => RESOURCES[r as ResourceId]?.glyph ?? '';
const laneDef = (l: Lane | null) => LANES.find((d) => d.id === l);
const clampEra = (n: number) => Math.min(8, Math.max(1, Math.round(n))) as Era;

function fmtClock(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return '—';
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
const pct = (p: number) => `${Math.floor(p * 100)}%`;

const ABBR: Record<string, string> = { output: 'out', inputs: 'in', draw: 'draw', power: 'pow', upkeep: 'upk' };
/** the card tag: the first generated pro, compacted for one card line */
function tagOf(lines: EffectLine[]): string {
  const p = lines.find((l) => l.sign === 'pro');
  if (!p) return '';
  const m = /^(\S+) (output|inputs|draw|power|upkeep): (.+)$/.exec(p.text);
  if (m) return `${m[1]} ${ABBR[m[2]]} ${m[3]}`;
  const colon = p.text.indexOf(':');
  if (/^(NEW|MAP) /.test(p.text) && colon > 0) return p.text.slice(0, colon);
  return p.text;
}

const STATUS: Record<TechState, string> = {
  hidden: 'HIDDEN', done: 'RESEARCHED', queued: 'QUEUED', stalled: 'WAITING ON GOODS', foreclosed: 'FORECLOSED',
  crewLocked: 'CREW TECH', eraLocked: 'ERA LOCKED', requires: 'LOCKED', requiresAny: 'LOCKED',
  full: 'QUEUE FULL', available: 'AVAILABLE',
};
const LOCKED: TechState[] = ['crewLocked', 'eraLocked', 'requires', 'requiresAny'];
const STATE_CLASS = (s: TechState) =>
  s === 'queued' || s === 'stalled' ? `queued${s === 'stalled' ? ' stalled' : ''}`
    : LOCKED.includes(s) ? 'locked' : s;
const STATE_GLYPH: Partial<Record<TechState, string>> = {
  done: '✓', stalled: '⚠', foreclosed: '✗', full: '⊘',
  crewLocked: '⬑', eraLocked: '⬑', requires: '⬑', requiresAny: '⬑',
};
const STATE_IDX = new Map<TechState, number>(
  (['hidden', 'done', 'queued', 'stalled', 'foreclosed', 'crewLocked', 'eraLocked', 'requires', 'requiresAny', 'full', 'available'] as TechState[])
    .map((s, i) => [s, i]));
/** a leftover on a past page: something that could still be queued */
const OPEN_STATES: TechState[] = ['available', 'full', 'requires', 'requiresAny'];

/** goods → the techs whose building makes them as its main product, or whose
 *  recipe adds them as a byproduct; drives the dotted goods links */
const GOODS_BY_UNLOCK: Partial<Record<ResourceId, TechId[]>> = {};
const GOODS_BY_RECIPE: Partial<Record<ResourceId, TechId[]>> = {};
for (const tid of TECH_ORDER) {
  for (const fx of TECHS[tid].effects) {
    if (fx.kind === 'unlock') {
      const outs = Object.entries(BUILDINGS[fx.building].outputs) as [ResourceId, number][];
      if (outs.length) (GOODS_BY_UNLOCK[outs.reduce((a, b) => (b[1] > a[1] ? b : a))[0]] ??= []).push(tid);
    } else if (fx.kind === 'recipe' && fx.outputs) {
      for (const r of Object.keys(fx.outputs) as ResourceId[]) {
        if (!(r in BUILDINGS[fx.building].outputs)) (GOODS_BY_RECIPE[r] ??= []).push(tid);
      }
    }
  }
}

const CHARTER_RULE = `An era opens with ${CHARTER_TECHS} of the previous era’s techs — or ${CHARTER_DEED_TECHS} plus a deed.`;

function prettyProspect(id: string): string {
  return id.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (c) => c.toUpperCase());
}

// ─────────────────────────── the screen ───────────────────────────

let focusHook: ((tid: TechId | null) => void) | null = null;
/** Open the tree on `tid`'s era page, the tech selected (its detail sheet up)
 *  and pulsing once. null, or a tech with no card here, opens the current era. */
export function openTechTreeAt(tid: TechId | null) { focusHook?.(tid); }

export function mountTechTree(root: HTMLElement, game: Game) {
  const push = (a: Action) => game.actions.push(a);

  // the era chip with the live research gauge, in the top-right stack
  const chip = el('button', 'btn panel interactive');
  chip.id = 'era-chip';
  const timeCol = root.querySelector('#time-controls');
  const alertsEl = timeCol?.querySelector('#alerts') ?? null;
  if (timeCol) timeCol.insertBefore(chip, alertsEl);
  else root.appendChild(chip);

  const screen = el('div', 'interactive');
  screen.id = 'tech-screen';
  screen.tabIndex = -1; // takes focus on open, so Enter and Space never reach the chip
  screen.style.display = 'none';
  let tabsHtml = '';
  for (let e = 1; e <= 8; e++) {
    tabsHtml += `<button class="era-tab" data-era="${e}" role="tab" aria-selected="false">` +
      '<span class="et-n">E' + e + '</span><span class="et-g"></span><span class="et-pip"></span>' +
      '<span class="et-left"></span><span class="et-q"></span></button>';
  }
  screen.innerHTML = `
    <div id="tech-head">
      <div class="th-name"><b>RESEARCH</b></div>
      <div id="tech-tabs" role="tablist" title="[ ] or PgUp PgDn change page · Home: the current era">${tabsHtml}</div>
      <div id="tech-alerts"></div>
      <div id="tech-rate" class="mono"></div>
      <button class="btn" id="tech-map" style="display:none" title="Open the Lunar Map">[M] Map</button>
      <button class="btn" id="tech-close">Close [T]</button>
    </div>
    <div id="tech-page-head"></div>
    <div id="tech-main"><div id="tech-board"></div></div>
    <div id="tech-sheet">
      <div id="tech-strip">
        <div id="tech-queue"></div>
        <div id="tech-other-sites"></div>
        <button class="btn sh-toggle" id="tech-sheet-toggle" title="Collapse the detail sheet">▾</button>
      </div>
      <div id="tech-sheet-body"></div>
    </div>`;
  root.appendChild(screen);
  const $ = <T extends Element = HTMLElement>(sel: string) => screen.querySelector(sel) as T;
  const tabsEl = $('#tech-tabs');
  const pageHead = $('#tech-page-head');
  const main = $('#tech-main');
  const board = $('#tech-board');
  const queueEl = $('#tech-queue');
  const otherEl = $('#tech-other-sites');
  const sheet = $('#tech-sheet');
  const sheetBody = $('#tech-sheet-body');
  const alertRail = $('#tech-alerts');
  const rateEl = $('#tech-rate');

  let open = false;
  /** the era page on show */
  let page: Era = 1;
  /** the era last seen while open: a higher one pulses its tab */
  let seenEra = 0;
  let view: ResearchView | null = null;
  let layout: PageLayout | null = null;
  let pageSig = '';
  let queueSig = '';
  let sheetSig = '';
  let hover: TechId | null = null;
  /** sticky across pages: a card chosen on E3 stays in the sheet on E5 */
  let selected: TechId | null = null;
  let collapsed = false;
  let rowH = 56;
  const cardEls = new Map<TechId, HTMLElement>();
  const tagCache = new Map<string, string>();

  const ctx = () => ({
    siteId: ($siteId.get() ?? 'mare') as SiteId,
    expedition: ($vitals.get().expedition ?? 'human') as Expedition,
  });
  const linesOf = (tid: TechId) => describeTech(TECHS[tid], ctx());
  const tag = (tid: TechId) => {
    const k = `${tid}|${ctx().siteId}|${ctx().expedition}`;
    if (!tagCache.has(k)) tagCache.set(k, tagOf(linesOf(tid)));
    return tagCache.get(k)!;
  };
  const eraOf = (tid: TechId) => (view?.cards[tid].era ?? TECHS[tid].era) as Era;

  const toggle = (v: boolean, at?: Era) => {
    open = v;
    hover = null;
    screen.style.display = open ? 'flex' : 'none';
    game.setTechOpen(open);
    if (open) {
      const r = $research.get();
      // T opens on the current era's page
      page = at ?? clampEra(r?.era ?? 1);
      seenEra = r?.era ?? 0;
      pageSig = ''; queueSig = ''; sheetSig = ''; refresh();
      // the chip (or a palette card) that opened it lets go of the keyboard
      if (!screen.contains(document.activeElement)) screen.focus({ preventScroll: true });
    }
  };
  /** show another era's page; the selection stays */
  const setPage = (p: number) => {
    const next = clampEra(p);
    if (next === page) return;
    page = next;
    hover = null;
    refresh();
  };
  /** go to a tech's page and select it (stubs, queue items, sheet links) */
  const jumpTo = (tid: TechId) => {
    if (!view || !(isVisible(view.cards[tid]) || isPlaceholder(view.cards[tid]))) return;
    selected = tid;
    hover = null;
    const p = eraOf(tid);
    if (p !== page) setPage(p); else refreshFocus();
    pulse(tid);
  };
  const pulse = (tid: TechId) => {
    const card = cardEls.get(tid);
    if (!card) return;
    card.classList.remove('pulse');
    void card.offsetWidth;
    card.classList.add('pulse');
  };

  // a command-view screen: the chip never opens it on foot or mid-flight
  chip.addEventListener('click', () => {
    if (open) toggle(false);
    else if (game.commandView && !overlayUp()) toggle(true);
  });
  $('#tech-close').addEventListener('click', () => toggle(false));
  $('#tech-map').addEventListener('click', () => {
    toggle(false);
    window.dispatchEvent(new CustomEvent('moonshots:open-map'));
  });
  $('#tech-sheet-toggle').addEventListener('click', () => {
    collapsed = !collapsed;
    sheet.classList.toggle('collapsed', collapsed);
    screen.classList.toggle('sheet-collapsed', collapsed);
    $('#tech-sheet-toggle').textContent = collapsed ? '▴' : '▾';
    sheetSig = '';
    refresh();
  });
  tabsEl.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLButtonElement>('.era-tab');
    if (!t) return;
    t.blur(); // Space pauses the game; it must not re-press a tab
    setPage(Number(t.dataset.era));
  });

  // ── era chip (HUD): rebuilt when the era changes, the gauge updated in place ──
  const renderChip = (v: ResearchView | null) => {
    const era = v?.era ?? 1;
    if (chip.dataset.era !== String(era)) {
      chip.dataset.era = String(era);
      chip.innerHTML = `ERA ${era} · ${ERA_NAMES[era]} <span class="cap mono">— tech [T]</span>
        <div class="res-line">
          <span class="label res-name" id="chip-res-name"></span>
          <div class="res-bar"><i id="chip-res-fill"></i></div>
          <span class="cap mono" id="chip-res-pct"></span>
        </div>`;
    }
    // spec S6 chip states; the transfer flows past stalled items, so name the one receiving data
    const q = v?.queue ?? [];
    const active = q.find((x) => !x.stalled);
    const head = active ?? q[0];
    let name: string, right = '';
    if (!head) name = 'QUEUE EMPTY — pick research [T]';
    else if (v!.paused) name = v!.paused === 'brownout' ? 'PAUSED — labs browned out' : 'PAUSED — no lab';
    else if (!active) {
      const need = head.need.replace(/(\d+\S+) [a-z₂]+ \(have/g, '$1 (have').replace(' · made by ', ' · ');
      name = `WAITING — ${TECHS[head.tid].short} needs ${need}`;
    } else {
      name = `Researching ${TECHS[head.tid].short}`;
      right = `${pct(head.pct)} · ETA ${fmtClock(head.eta)}`;
    }
    const n = chip.querySelector('#chip-res-name') as HTMLElement;
    const p = chip.querySelector('#chip-res-pct') as HTMLElement;
    if (n.textContent !== name) { n.textContent = name; n.title = name; }
    if (p.textContent !== right) p.textContent = right;
    (chip.querySelector('#chip-res-fill') as HTMLElement).style.width = `${(head?.pct ?? 0) * 100}%`;
  };

  // ── the page signature: the page rebuilds only when this changes ──
  const cardSig = (v: ResearchView, t: TechId) => {
    const c = v.cards[t];
    return `${t}${STATE_IDX.get(c.state)!.toString(16)}${c.insight?.earned ? 'e' : ''}${c.doctrine ? 'd' : ''}` +
      `${c.cost.data}#${v.queue.findIndex((q) => q.tid === t)}`;
  };
  const stubSig = (m: Map<TechId, Stub>) => [...m].map(([t, s]) => `${t}${s.done ? 1 : 0}${s.eras.join('')}`).join(',');
  function signature(v: ResearchView, L: PageLayout, dsig: string): string {
    const { siteId, expedition } = ctx();
    return `${page}|${v.era}|${siteId}|${expedition}|${dsig}|` +
      L.rows.map((r) => `${r.key}${r.compact ? '~' : ''}:${r.cards.map((t) => cardSig(v, t)).join(',')}`).join('/') +
      `|<${stubSig(L.before)}|>${stubSig(L.after)}`;
  }
  /** every card's state: the sheet can show a card of any page */
  const globalSig = (v: ResearchView) =>
    `${v.era}|${v.queue.map((q) => q.tid + (q.stalled ? '!' : '')).join(',')}|` +
    TECH_ORDER.map((t) => cardSig(v, t)).join('.');

  function refresh() {
    const v = $research.get();
    renderChip(v);
    if (!open || !v) return;
    view = v;
    // a new era while the tree is open: the page stays, the new tab pulses once
    if (seenEra && v.era > seenEra) pulseTab(clampEra(v.era));
    seenEra = v.era;
    const L = computePageLayout(v, page, main.clientWidth || Infinity);
    const slot = destinySlot(page, game, v);
    const sig = signature(v, L, slot?.sig ?? '');
    layout = L;
    if (sig !== pageSig) {
      pageSig = sig;
      buildHead(slot?.html ?? null);
      buildBoard();
      if (hover && !L.items.has(hover)) hover = null;
    }
    if (selected && !(isVisible(v.cards[selected]) || isPlaceholder(v.cards[selected]))) selected = null;
    updateTabs();
    updateHeader();
    updatePageHead();
    updateCards();
    renderQueue();
    renderSheet();
    applyHighlight();
  }

  // ── top bar: tabs and the rate chip ──
  function pulseTab(era: Era) {
    const t = tabsEl.querySelector<HTMLElement>(`.era-tab[data-era="${era}"]`);
    if (!t) return;
    t.classList.remove('pulse');
    void t.offsetWidth;
    t.classList.add('pulse');
  }
  function updateTabs() {
    const v = view!;
    const left = new Array(9).fill(0), queued = new Array(9).fill(0);
    for (const t of TECH_ORDER) {
      const c = v.cards[t];
      if (OPEN_STATES.includes(c.state)) left[c.era]++;
    }
    for (const q of v.queue) queued[v.cards[q.tid].era]++;
    tabsEl.querySelectorAll<HTMLElement>('.era-tab').forEach((t) => {
      const e = Number(t.dataset.era) as Era;
      const kind = pageKind(e, v.era);
      t.classList.toggle('cur', kind === 'current');
      t.classList.toggle('past', kind === 'past');
      t.classList.toggle('future', kind === 'future');
      t.classList.toggle('view', e === page);
      t.setAttribute('aria-selected', String(e === page));
      const g = kind === 'current' ? '●' : kind === 'past' ? '✓' : '⊘';
      const lft = kind === 'past' && left[e] ? `·${left[e]}` : '';
      const q = queued[e] ? `#${queued[e]}` : '';
      const pip = destinyPip(e, game, v);
      const set = (cls: string, txt: string) => {
        const s = t.querySelector(cls) as HTMLElement;
        if (s.textContent !== txt) s.textContent = txt;
      };
      set('.et-g', g); set('.et-left', lft); set('.et-q', q); set('.et-pip', pip);
      const state = kind === 'current' ? 'the current era' : kind === 'past' ? `open${left[e] ? ` · ${left[e]} left to research` : ''}`
        : `locked — ${gateTitle(v.gates.find((x) => x.era === e))}`;
      const title = `Era ${e} · ${ERA_NAMES[e]} — ${state}${queued[e] ? ` · ${queued[e]} queued` : ''}`;
      if (t.title !== title) t.title = title;
    });
  }
  function updateHeader() {
    const v = view!;
    const paused = v.paused === 'noLab' ? 'PAUSED — no lab · ' : v.paused === 'brownout' ? 'PAUSED — labs browned out · ' : '';
    const txt = `${paused}≡ ${v.rate.toFixed(1)}/s · cap ${v.cap.toFixed(1)}/s · bank ${fmt(v.bank)}≡`;
    if (rateEl.textContent !== txt) rateEl.textContent = txt;
    rateEl.classList.toggle('paused', !!v.paused);
    rateEl.title = `Transfer ${v.rate.toFixed(2)}≡/s (30 s average) of a ${v.cap.toFixed(1)}/s cap — 0.4/s per operating lab + 2.5/s per Data Center.\n` +
      `Labs ${v.labsActive} (agent-run ${v.agentLabs}, uplink share ${Math.round(v.uplinkShare * 100)}%) · Data Centers ${v.dcsActive} · production ${v.production.toFixed(2)}≡/s`;
    ($('#tech-map') as HTMLElement).style.display = $lunar.get() ? '' : 'none';
  }

  // the HUD's alert stack sits under this opaque screen, so the newest two are echoed here
  const renderAlerts = () => {
    const list = $alerts.get().slice(-2).reverse();
    const sig = list.map((a) => a.id).join(',');
    if (alertRail.dataset.sig === sig) return;
    const fresh = list.length && String(list[0].id) !== (alertRail.dataset.sig ?? '').split(',')[0];
    alertRail.dataset.sig = sig;
    alertRail.innerHTML = list.map((a) =>
      `<div class="ta ${a.kind}" data-alert="${a.id}" title="Dismiss">${esc(a.text)}</div>`).join('');
    if (fresh) alertRail.firstElementChild?.classList.add('flash');
  };
  alertRail.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-alert]');
    if (a) push({ kind: 'dismissAlert', id: Number(a.dataset.alert) });
  });

  // ── the page header: era · destiny · goals ──
  function buildHead(destiny: string | null) {
    const v = view!;
    const kind = pageKind(page, v.era);
    const word = kind === 'current' ? 'CURRENT ERA' : kind === 'past' ? 'OPEN · PAST ERA' : 'LOCKED';
    pageHead.className = `${destiny ? '' : 'no-destiny '}k-${kind}`;
    pageHead.dataset.era = String(page);
    pageHead.innerHTML = `
      <div class="ph-era">
        <div class="ph-k label">ERA ${page} · ${word}</div>
        <div class="ph-name">${esc(ERA_NAMES[page])}</div>
        <div class="ph-blurb">${esc(ERA_BLURB[page] ?? '')}</div>
        <div class="ph-count mono" data-g="count"></div>
      </div>
      ${destiny ? `<div class="ph-destiny">${destiny}</div>` : ''}
      <div class="ph-goals">${goalsHtml(page, v)}</div>`;
  }
  function updatePageHead() {
    const v = view!;
    let n = 0, done = 0, q = 0, avail = 0;
    for (const t of TECH_ORDER) {
      const c = v.cards[t];
      if (c.era !== page || c.state === 'hidden') continue;
      n++;
      if (c.state === 'done') done++;
      else if (c.state === 'queued' || c.state === 'stalled') q++;
      else if (c.state === 'available') avail++;
    }
    const txt = `${n} techs · ${done} researched${q ? ` · ${q} queued` : ''}${avail ? ` · ${avail} available` : ''}`;
    const cEl = pageHead.querySelector<HTMLElement>('[data-g="count"]');
    if (cEl && cEl.textContent !== txt) cEl.textContent = txt;
    const goals = pageHead.querySelector<HTMLElement>('.ph-goals');
    if (goals) updateGoals(goals, page, v, $swarm.get());
  }
  pageHead.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-select]');
    if (!b) return;
    (b as HTMLButtonElement).blur?.();
    jumpTo(b.dataset.select as TechId);
  });

  // ── the lane board ──
  function stubHtml(s: Stub, dir: 'in' | 'out', compact: boolean): string {
    const v = view!;
    const tick = (t: TechId) => (v.cards[t].state === 'done' ? '✓' : '◻');
    const title = `${dir === 'in' ? 'Needs from other eras' : 'Leads to later eras'}: ` +
      s.techs.map((t) => `${tick(t)} E${v.cards[t].era} ${v.cards[t].name}`).join(' · ') + ' — click to go there';
    const lab = (e: Era) => (dir === 'in' ? `◂E${e}` : `E${e}▸`);
    const shown = compact ? s.eras.slice(0, 1) : s.eras.length > 2 ? s.eras.slice(0, 1) : s.eras;
    const more = !compact && s.eras.length > 2 ? s.eras.length - 1 : 0;
    const items = shown.map((e) =>
      `<span class="st-e" data-jump="${s.target[e]}">${compact ? (dir === 'in' ? '◂' : '▸') : lab(e)}</span>`).join('') +
      (more ? `<span class="st-e st-more" data-jump="${s.target[s.eras[1]]}">+${more}</span>` : '');
    return `<span class="stub stub-${dir} ${s.done ? 'done' : 'pend'}" data-stub="${dir}" data-eras="${s.eras.join(',')}" title="${esc(title)}">${items}</span>`;
  }

  function cardHtml(c: ResearchCard, it: PageItem): string {
    if (it.ph) {
      return `<div class="cb"><div class="l1"><span class="gl">✦</span><span class="nm">? Breakthrough</span></div>
        <div class="l2"><span class="l2a">survey an anomaly</span></div></div>`;
    }
    const v = view!;
    const L = layout!;
    const qi = v.queue.findIndex((q) => q.tid === c.tid) + 1;
    const glyphTxt = c.state === 'queued' ? `#${qi}` : c.state === 'stalled' ? `#${qi}⚠` : STATE_GLYPH[c.state] ?? '';
    const marks: string[] = [];
    if (c.doctrine) marks.push('<span title="Doctrine — choose one, permanent">◇</span>');
    if (c.breakthrough) marks.push('<span title="Breakthrough">✦</span>');
    if (c.siteTech) {
      const only = (TECHS[c.tid].sites ?? []).map(siteName).join(' / ');
      marks.push(`<span title="${esc(only)} only">◬</span>`);
    }
    const before = L.before.get(c.tid), after = L.after.get(c.tid);
    const sIn = before ? stubHtml(before, 'in', it.compact) : '';
    const sOut = after ? stubHtml(after, 'out', it.compact) : '';
    const prog = c.state === 'queued' || c.state === 'stalled' || c.spent > 0 ? '<div class="prog"><i></i></div>' : '';
    const l1 = `<div class="l1"><span class="gl">${glyphTxt}</span><span class="nm">${esc(c.short)}</span><span class="mk">${marks.join('')}</span>`;
    if (it.compact) {
      const right = c.state === 'done' ? '' : c.state === 'queued' || c.state === 'stalled'
        ? '<span class="cc" data-live="pct"></span>' : `<span class="cc">${c.cost.data}≡</span>`;
      return `${sIn}<div class="cb">${l1}${right}</div></div>${sOut}${prog}`;
    }
    let l2: string;
    if (c.state === 'done') {
      l2 = '<span class="l2a dim">researched</span>';
    } else if (c.state === 'queued') {
      l2 = '<span class="l2a"><span data-live="pct"></span> · ETA <span data-live="eta"></span></span>';
    } else if (c.state === 'stalled') {
      l2 = '<span class="l2a">⚠ needs <span data-live="need"></span></span>';
    } else if (c.state === 'foreclosed') {
      const chosen = c.doctrine && DOCTRINES[c.doctrine].members.find((m) => m !== c.tid && v.cards[m].state === 'done');
      // a doctrine follow-up: foreclosed with the doctrine it builds on
      const via = !c.doctrine ? /you chose (.+)$/.exec(c.reason)?.[1] : undefined;
      const viaShort = via ? TECH_ORDER.find((t) => TECHS[t].name === via) : undefined;
      l2 = `<span class="l2a">${chosen ? `you chose ${esc(TECHS[chosen].short)}`
        : viaShort ? `you chose ${esc(TECHS[viaShort].short)}` : 'foreclosed (pending)'}</span>`;
    } else {
      const goods = Object.entries(c.cost.goods)
        .map(([r, a]) => `<span class="g" data-res="${r}" data-need="${a}">${a}${glyph(r)}</span>`).join(' ');
      const ins = c.insight?.earned ? ` <span class="ins">✎−${Math.round(c.cost.discount * 100)}%</span>` : '';
      l2 = `<span class="l2a">${c.cost.data}≡${goods ? ' ' + goods : ''}${ins}</span>`;
    }
    const cap = it.capstone ? `<span class="l3k label">CAPSTONE · ${esc(ERA_NAMES[8])}</span> ` : '';
    return `${sIn}<div class="cb">${l1}</div><div class="l2">${l2}</div><div class="l3">${cap}${esc(tag(c.tid))}</div></div>${sOut}${prog}`;
  }

  /** row height from the room the board has: 56 px, less on short screens */
  function fitRows() {
    const L = layout;
    if (!L) return;
    const rows = Math.max(1, L.rows.length);
    const h = main.clientHeight;
    const next = h > 0 ? Math.max(36, Math.min(56, Math.floor(h / rows))) : 56;
    rowH = next;
    board.style.setProperty('--row-h', `${next}px`);
    board.classList.toggle('tight', next < 50);
  }

  function buildBoard() {
    const v = view!, L = layout!;
    cardEls.clear();
    board.style.setProperty('--rows', String(L.rows.length));
    board.style.width = `${L.width}px`;
    board.className = `k-${pageKind(page, v.era)}`;
    board.dataset.era = String(page);
    let html = '<svg id="tech-links" aria-hidden="true"></svg>';
    for (const [i, r] of L.rows.entries()) {
      html += `<div class="lane${i % 2 ? ' alt' : ''}${r.compact ? ' compact' : ''}" data-lane="${r.key}" style="--r:${i}" title="${esc(r.holds)}">
        <span class="lane-label">${esc(r.label)}</span></div>`;
    }
    for (const b of L.brackets) {
      const q = DOCTRINES[b.group].question;
      html += `<div class="doc-bracket" data-group="${b.group}" style="--r:${b.row};--x0:${b.x0}px;--x1:${b.x1}px"
        title="DOCTRINE · CHOOSE ONE · PERMANENT — ${esc(q)}"><span>◇ CHOOSE ONE</span></div>`;
    }
    if (!L.rows.length) html += '<div class="board-empty">No research on this page here.</div>';
    board.innerHTML = html;
    for (const [tid, it] of L.items) {
      const c = v.cards[tid];
      const cls = it.ph ? 'ph' : STATE_CLASS(c.state);
      const e = el('div', `tech-card ${cls}${c.doctrine ? ' doctrine' : ''}${it.capstone ? ' capstone' : ''}${it.compact ? ' compact' : ''}`);
      e.dataset.tech = tid;
      e.dataset.state = it.ph ? 'placeholder' : c.state;
      e.setAttribute('role', 'button');
      e.tabIndex = -1;
      e.style.cssText = `--r:${it.row};--x:${it.x}px;--w:${it.w}px`;
      e.setAttribute('aria-label', it.ph ? 'Undiscovered breakthrough' : `${c.name} — ${STATUS[c.state]}${c.reason ? `: ${c.reason}` : ''}`);
      e.innerHTML = cardHtml(c, it);
      board.appendChild(e);
      cardEls.set(tid, e);
    }
    fitRows();
    board.dataset.focus = '';
    drawLinks();
  }

  function updateCards() {
    const v = view!;
    for (const [tid, e] of cardEls) {
      const c = v.cards[tid];
      const bar = e.querySelector('.prog i') as HTMLElement | null;
      if (bar) bar.style.width = `${c.pct * 100}%`;
      e.querySelectorAll<HTMLElement>('[data-live]').forEach((s) => {
        const k = s.dataset.live;
        const t = k === 'pct' ? pct(c.pct) : k === 'eta' ? fmtClock(c.eta) : k === 'need' ? c.stalledNeed.replace(/ · made by .*$/, '') : '';
        if (s.textContent !== t) s.textContent = t;
      });
      // the sim's rule, not raw stock: the crew's reserve is never research goods
      e.querySelectorAll<HTMLElement>('.g[data-res]').forEach((g) => {
        g.classList.toggle('short', c.goodsShort.includes(g.dataset.res as ResourceId));
      });
    }
  }

  // ── links: only the focused card's, one SVG behind the cards ──
  interface Focus {
    tid: TechId;
    nodes: Set<TechId>;
    edges: Set<string>;
    dashed: Set<string>;
    goods: { from: TechId; res: ResourceId }[];
  }
  /** this page's prerequisite closure (OR groups: the satisfied member, else
   *  every member) plus direct dependents; it drives the dimming and the links */
  function focusOf(tid: TechId): Focus {
    const v = view!, L = layout!;
    const on = (t: TechId) => L.items.has(t) && isVisible(v.cards[t]);
    const has = (t: TechId) => ['done', 'queued', 'stalled'].includes(v.cards[t].state);
    const f: Focus = { tid, nodes: new Set([tid]), edges: new Set(), dashed: new Set(), goods: [] };
    const walk = (t: TechId) => {
      const def = TECHS[t];
      for (const r of def.requires) {
        if (!on(r)) continue;
        f.edges.add(`${r}>${t}`);
        if (!f.nodes.has(r)) { f.nodes.add(r); walk(r); }
      }
      const any = (def.requiresAny ?? []).filter((r) => isVisible(v.cards[r]));
      const sat = any.filter(has);
      for (const r of (sat.length ? sat : any).filter(on)) {
        f.edges.add(`${r}>${t}`);
        if (!sat.length) f.dashed.add(`${r}>${t}`);
        if (!f.nodes.has(r)) { f.nodes.add(r); walk(r); }
      }
    };
    if (!L.items.get(tid)?.ph) walk(tid);
    for (const d of DEPENDENTS.get(tid) ?? []) {
      if (!on(d)) continue;
      f.nodes.add(d);
      f.edges.add(`${tid}>${d}`);
    }
    for (const r of Object.keys(v.cards[tid].cost.goods) as ResourceId[]) {
      const ok = (p: TechId) => p !== tid && on(p);
      const makers = (GOODS_BY_UNLOCK[r] ?? []).filter(ok);
      for (const p of makers.length ? makers : (GOODS_BY_RECIPE[r] ?? []).filter(ok)) f.goods.push({ from: p, res: r });
    }
    return f;
  }

  function drawLinks() {
    const svg = board.querySelector('#tech-links') as SVGSVGElement | null;
    if (!svg || !layout || !view) return;
    const v = view, L = layout;
    const W = L.width, H = L.rows.length * rowH;
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const focusTid = hover ?? selected;
    const f = focusTid && L.items.has(focusTid) && !L.items.get(focusTid)!.ph ? focusOf(focusTid) : null;
    // the default board draws no lines at all
    if (!f) { svg.innerHTML = ''; return; }
    const box = (it: PageItem) => {
      const top = it.row * rowH + 3, bottom = (it.row + 1) * rowH - 8;
      return { x0: it.x, x1: it.x + it.w, y0: top, y1: bottom, ym: (top + bottom) / 2 };
    };
    const edges: { a: TechId; b: TechId; or: boolean }[] = [];
    for (const key of f.edges) {
      const [a, b] = key.split('>') as [TechId, TechId];
      edges.push({ a, b, or: (TECHS[b].requiresAny ?? []).includes(a) });
    }
    // incoming AND and OR edges on one card enter at different heights
    const incoming = new Map<TechId, { and: boolean; or: boolean }>();
    for (const e of edges) {
      const m = incoming.get(e.b) ?? { and: false, or: false };
      if (e.or) m.or = true; else m.and = true;
      incoming.set(e.b, m);
    }
    const entryY = (t: TechId, or: boolean) => {
      const b = box(L.items.get(t)!);
      const m = incoming.get(t);
      return m?.and && m.or ? b.ym + (or ? 5 : -5) : b.ym;
    };
    const between = (row: number, x0: number, x1: number) =>
      [...L.items.values()].some((s) => s.row === row && s.x > x0 && s.x + s.w < x1 + 1 && s.x < x1);
    /** right out of the source, down or up a gutter, along the gap next to
     *  the target's row, down its left gutter and in */
    const route = (a: TechId, b: TechId, or: boolean): string => {
      const sa = L.items.get(a)!, sb = L.items.get(b)!;
      const A = box(sa), B = box(sb);
      const sy = A.ym, ty = entryY(b, or);
      const tx = or ? B.x0 - 4 : B.x0;
      if (sa.row === sb.row && B.x0 >= A.x1 && !between(sa.row, A.x1, B.x0)) return `M${A.x1},${sy}H${tx}`;
      const gy = sa.row === sb.row ? sa.row * rowH + 1.5
        : sb.row > sa.row ? sb.row * rowH + 1.5 : (sb.row + 1) * rowH + 1.5;
      const out = B.x0 >= A.x1 || sa.row !== sb.row ? A.x1 : A.x0;
      const gx = out === A.x1 ? A.x1 + 4 : A.x0 - 4;
      return `M${out},${sy}H${gx}V${gy}H${B.x0 - 4}V${ty}H${tx}`;
    };
    let hi = '', marks = '';
    const diamonds = new Set<TechId>();
    for (const e of edges) {
      const key = `${e.a}>${e.b}`;
      const done = v.cards[e.a].state === 'done';
      const dashed = !done || f.dashed.has(key);
      hi += `<path class="lk hi${done ? ' done' : ''}${dashed ? ' pend' : ''}" d="${route(e.a, e.b, e.or)}" data-edge="${key}"/>`;
      if (e.or) diamonds.add(e.b);
    }
    for (const t of diamonds) {
      const B = box(L.items.get(t)!);
      const x = B.x0 - 4, y = entryY(t, true);
      marks += `<path class="lk hi" d="M${x + 3},${y}H${B.x0}"/>` +
        `<path class="or-dia hi" data-or="${t}" d="M${x - 3},${y}L${x},${y - 3}L${x + 3},${y}L${x},${y + 3}Z"><title>any one of these</title></path>`;
    }
    let goods = '';
    for (const g of f.goods) goods += `<path class="lk goods" d="${route(g.from, f.tid, false)}" data-goods="${g.res}"/>`;
    svg.innerHTML = `<g class="goods">${goods}</g><g class="hi">${hi}</g><g class="marks">${marks}</g>`;
  }

  function applyHighlight() {
    const L = layout;
    if (!L) return;
    const focusTid = hover ?? selected;
    const f = hover && L.items.has(hover) ? focusOf(hover) : null;
    board.classList.toggle('hovering', !!f);
    for (const [tid, e] of cardEls) {
      const lit = !!f && f.nodes.has(tid);
      e.classList.toggle('hl', lit);
      e.classList.toggle('hov', tid === hover);
      e.classList.toggle('goods-src', !!f && f.goods.some((g) => g.from === tid));
      e.classList.toggle('sel', tid === selected);
      // the closure reaches another era: that card's stubs pulse
      e.querySelectorAll('.stub').forEach((s) => s.classList.toggle('hl', lit));
    }
    const key = `${page}|${focusTid ?? ''}|${hover ?? ''}|${rowH}`;
    if (board.dataset.focus !== key) {
      board.dataset.focus = key;
      drawLinks();
    }
  }

  // ── queue strip (global: every era, each item tagged) ──
  function renderQueue() {
    const v = view!;
    const sig = v.queue.map((q) => q.tid + (q.stalled ? '!' : '')).join(',') + `|${v.queueMax}|${page}`;
    if (sig !== queueSig) {
      queueSig = sig;
      if (!v.queue.length) {
        queueEl.innerHTML = `<span class="q-head label">Queue 0/${v.queueMax}</span>
          <span class="q-empty">empty — click an available tech · Shift-click queues its whole path</span>`;
      } else {
        queueEl.innerHTML = `<span class="q-head label">Queue ${v.queue.length}/${v.queueMax}</span>` + v.queue.map((q, i) => {
          const e = v.cards[q.tid].era;
          return `
          <span class="q-item${q.stalled ? ' stalled' : ''}${e === page ? ' here' : ''}" data-tech="${q.tid}" data-era="${e}"
            title="${esc(`${TECHS[q.tid].name} — Era ${e}; click to go to its page`)}">
            <span class="q-nm">${i + 1}. <span class="q-era mono">E${e}</span> ${esc(TECHS[q.tid].short)}</span>
            <span class="q-live mono" data-live="q"></span>
            ${i > 0 ? `<button class="q-btn" data-act="up" data-tech="${q.tid}" title="Move up">↑</button>` : ''}
            <button class="q-btn" data-act="cancel" data-tech="${q.tid}" title="Cancel (dependents drop too)">×</button>
          </span>`;
        }).join('');
      }
      const others = v.otherSites;
      otherEl.textContent = others.length ? `◬ ${others.length} techs belong to other landing sites` : '';
      otherEl.title = others.map((t) => `${TECHS[t].name} — ${(TECHS[t].sites ?? []).map(siteName).join(' / ')}`).join('\n');
    }
    queueEl.querySelectorAll<HTMLElement>('.q-item').forEach((it) => {
      const q = v.queue.find((x) => x.tid === it.dataset.tech);
      const live = it.querySelector('[data-live="q"]') as HTMLElement | null;
      if (!q || !live) return;
      const t = q.stalled ? `⚠ waiting: ${q.need}` : `${pct(q.pct)} · ETA ${fmtClock(q.eta)}`;
      if (live.textContent !== t) { live.textContent = t; live.title = t; }
    });
  }

  // ── detail sheet (global: the sticky selection follows you across pages) ──
  const subject = (): TechId | null => hover ?? selected;

  function siteNote(tid: TechId): string {
    const site = ctx().siteId;
    const def = TECHS[tid];
    const notes: string[] = [];
    if (def.exclusive) {
      const n = DOCTRINES[def.exclusive].siteNote[site];
      if (n) notes.push(n);
    }
    if (def.sites) notes.push(`a ${def.sites.map(siteName).join(' / ')} technology`);
    return notes.length ? `At ${siteName(site)}: ${notes.join(' · ')}` : '';
  }

  const fxHtml = (tid: TechId) => {
    const lines = linesOf(tid);
    const col = (sign: 'pro' | 'con') => lines.filter((l) => l.sign === sign)
      .map((l) => `<div class="fx fx-${sign}">${sign === 'pro' ? '⊕' : '⊖'} ${esc(l.text)}</div>`).join('');
    return `<div class="fx-grid"><div>${col('pro')}</div><div>${col('con')}</div></div>`;
  };

  function previewHtml(tid: TechId): string {
    const lines = previewTech(tid, game.state);
    return lines.length
      ? lines.map((l) => `<div class="yb">${esc(l.text)}</div>`).join('')
      : '<div class="yb none">no existing building changes yet</div>';
  }

  function unlocksHtml(tid: TechId): string {
    const out: string[] = [];
    for (const fx of TECHS[tid].effects) {
      if (fx.kind !== 'unlock') continue;
      const b = BUILDINGS[fx.building];
      out.push(`<div class="unl"><span class="k">Unlocks</span><b>${esc(b.name)}</b> <span class="pro">${esc(b.pro)}</span> <span class="con">${esc(b.con)}</span></div>`);
    }
    return out.join('');
  }

  const tick = (t: TechId) => {
    const s = view!.cards[t].state;
    return s === 'done' ? '✓' : s === 'queued' || s === 'stalled' ? '◷' : '◻';
  };
  /** `✓ E2 Parts Fab`, a jump link to its page */
  const link = (t: TechId) =>
    `<span class="lnk" data-jump="${t}" title="${esc(`${TECHS[t].name} — go to the E${eraOf(t)} page`)}">${tick(t)} <span class="lk-era mono">E${eraOf(t)}</span> ${esc(TECHS[t].short)}</span>`;

  function pathHtml(c: ResearchCard): string {
    const v = view!;
    const def = TECHS[c.tid];
    const vis = (t: TechId) => isVisible(v.cards[t]);
    const rows: string[] = [];
    const cost = c.cost.discount > 0
      ? `<span class="mono">${c.cost.base} → ${c.cost.data}≡</span> · ✎ ${esc(c.cost.insightLabel)}`
      : `<span class="mono">${c.cost.data}≡</span>`;
    rows.push(`<div><span class="k">Cost</span>${cost}${c.spent > 0 && c.state !== 'done'
      ? ` · banked <span class="mono" data-live="spent"></span>` : ''}</div>`);
    const goods = Object.entries(c.cost.goods);
    if (goods.length) {
      rows.push(`<div><span class="k">Goods</span>${goods.map(([r, a]) => {
        const p = producerOf(r as ResourceId, game.state, game.mods);
        return `<span class="mono g" data-res="${r}" data-need="${a}">${a}${glyph(r)}</span> <span data-live="have:${r}"></span>${p ? ` · ${esc(producerName(p))}` : ''}`;
      }).join(' · ')}</div>`);
    }
    if (c.state !== 'done') rows.push(`<div><span class="k">ETA</span><span data-live="eta"></span></div>`);
    const req = def.requires.filter(vis);
    const any = (def.requiresAny ?? []).filter(vis);
    if (req.length || any.length) {
      rows.push(`<div class="sh-links"><span class="k">Needs</span>${[
        ...req.map(link),
        ...(any.length ? [any.map(link).join(' <span class="or">OR</span> ')] : []),
      ].join(' · ')}</div>`);
    }
    const deps = (DEPENDENTS.get(c.tid) ?? []).filter(vis)
      .sort((a, b) => eraOf(a) - eraOf(b) || TECH_ORDER.indexOf(a) - TECH_ORDER.indexOf(b));
    if (deps.length) {
      const names = deps.map((t) => `E${eraOf(t)} ${TECHS[t].short}`).join(', ');
      rows.push(`<div class="sh-links" title="${esc(names)}"><span class="k">Leads to</span>${deps.map(link).join(' · ')}</div>`);
    }
    if (c.insight) {
      rows.push(c.insight.earned
        ? `<div class="ins">✎ earned −${Math.round(c.cost.discount * 100)}% — ${esc(c.insight.hint)}</div>`
        : `<div class="ins">⚡ Insight: ${esc(c.insight.hint)} (−${Math.round(c.insight.discount * 100)}%)</div>`);
    }
    return rows.join('');
  }

  function buttonsHtml(c: ResearchCard): string {
    const q = c.state === 'queued' || c.state === 'stalled';
    const canPath = c.state === 'available' || c.state === 'requires' || c.state === 'requiresAny' || c.state === 'full';
    return `<div class="sh-btns">
      <button class="btn" data-act="queue" data-tech="${c.tid}" ${c.state === 'available' ? '' : 'disabled'}>Queue</button>
      <button class="btn" data-act="path" data-tech="${c.tid}" ${canPath ? '' : 'disabled'}>Queue path ⇧</button>
      <button class="btn" data-act="cancel" data-tech="${c.tid}" ${q ? '' : 'disabled'}>Cancel</button>
    </div>`;
  }

  function statusHtml(c: ResearchCard): string {
    const v = view!;
    const qi = v.queue.findIndex((q) => q.tid === c.tid);
    const word = c.state === 'queued' ? `QUEUED #${qi + 1}` : STATUS[c.state];
    const reason = c.state === 'queued' || c.state === 'done' || c.state === 'available' ? '' : c.reason;
    return `<div class="sh-status st-${STATE_CLASS(c.state).split(' ')[0]}">${word}${reason ? ` — ${esc(reason)}` : ''}</div>`;
  }

  /** the sticky selection lives on another page: a way back to it */
  const jumpBack = (c: ResearchCard) => (c.era !== page
    ? ` <button class="lnk sh-jump" data-jump="${c.tid}">on the E${c.era} page ↩</button>` : '');

  function identityHtml(c: ResearchCard): string {
    const def = TECHS[c.tid];
    const badges: string[] = [];
    if (c.doctrine) badges.push('◇ DOCTRINE');
    if (c.breakthrough) badges.push('✦ BREAKTHROUGH');
    if (c.siteTech) badges.push(`◬ ${esc((def.sites ?? []).map(siteName).join(' / '))} only`);
    const lane = laneDef(c.lane);
    const note = siteNote(c.tid);
    return `<div class="sh-name">${esc(c.name)} <span class="badges">${badges.join(' · ')}</span></div>
      <div class="sh-meta label">E${c.era} · ${esc(ERA_NAMES[c.era])}${lane ? ` · ${esc(lane.label)}` : ' · ✺ SWARM'}${jumpBack(c)}</div>
      ${statusHtml(c)}
      <div class="sh-desc">${esc(def.desc)}</div>
      <div class="sh-flavor"><i>${esc(def.tradeoff)}</i></div>
      ${note ? `<div class="sh-site">${esc(note)}</div>` : ''}`;
  }

  function doctrineSide(tid: TechId, group: DoctrineId): string {
    const c = view!.cards[tid];
    const members = DOCTRINES[group].members.filter((m) => isVisible(view!.cards[m]));
    const other = members.find((m) => m !== tid);
    let action = '';
    if (c.state === 'done') action = '<span class="chosen">✓ CHOSEN</span>';
    else if (c.state === 'queued' || c.state === 'stalled') {
      action = `<button class="btn" data-act="cancel" data-tech="${tid}">Cancel — reopens ${esc(other ? TECHS[other].short : '')}</button>`;
    } else if (c.state === 'available' || c.state === 'requires' || c.state === 'requiresAny' || c.state === 'full') {
      action = `<button class="btn primary commit" data-act="commit" data-tech="${tid}">Commit to ${esc(c.short)} — permanent</button>`;
    } else {
      action = `<span class="why">${esc(c.reason)}</span>`;
    }
    const lines = linesOf(tid);
    const pros = lines.filter((l) => l.sign === 'pro').map((l) => `<div class="fx fx-pro">⊕ ${esc(l.text)}</div>`).join('');
    const cons = lines.filter((l) => l.sign === 'con').map((l) => `<div class="fx fx-con">⊖ ${esc(l.text)}</div>`).join('');
    const eta = c.state === 'done' ? '' : c.state === 'stalled' ? ' · data paid, waiting on goods' : ` · ETA ${fmtClock(c.eta)}`;
    return `<div class="doc-side st-${STATE_CLASS(c.state).split(' ')[0]}${tid === subject() ? ' focus' : ''}" data-tech="${tid}">
      <div class="ds-head"><span class="ds-name">${esc(c.name)}</span>
        <span class="mono ds-cost">${c.cost.data}≡${Object.entries(c.cost.goods)
          .map(([r, a]) => ` <span class="g" data-res="${r}" data-need="${a}">${a}${glyph(r)}</span>`).join('')}${eta}</span>
        ${action}</div>
      <div class="ds-fx"><div>${pros}</div><div>${cons}</div>
        <div class="ds-yb"><div class="sh-h label">Your base</div>${c.state === 'done' ? '' : previewHtml(tid)}</div></div>
    </div>`;
  }

  function placeholderHtml(tid: TechId): string {
    const c = view!.cards[tid];
    const bt = c.breakthrough!;
    const lunar = $lunar.get();
    const known = (lunar?.prospects ?? []).filter((p) => p.visible && bt.hosts.includes(p.id));
    const hint = known.length
      ? `survey an anomaly: ${known.map((p) => `${prettyProspect(p.id)} (${p.cls})`).join(', ')}`
      : `survey an anomaly to reveal it — ${bt.hosts.length} candidate sites on the Moon`;
    return `<div class="sh-col"><div class="sh-name">✦ ? Breakthrough</div>
        <div class="sh-meta label">E${c.era} · ${esc(ERA_NAMES[c.era])} · ◎ EXPLORATION slot ${bt.slot}${jumpBack(c)}</div>
        <div class="sh-status st-locked">UNDISCOVERED — ${esc(hint)}</div>
        <div class="sh-desc">A reserved slot: surveying a real anomaly reveals a technology researchable in Era ${c.era}.</div></div>`;
  }

  function summaryHtml(): string {
    const v = view!;
    return `<div class="sh-col"><div class="sh-name">Research</div>
        <div class="sh-desc">Labs operating ${v.labsActive} (agent-run ${v.agentLabs}, uplink share ${Math.round(v.uplinkShare * 100)}%) ·
          Data Centers ${v.dcsActive} · production <span class="mono">${v.production.toFixed(2)}≡/s</span> ·
          transfer cap <span class="mono">${v.cap.toFixed(1)}/s</span></div>
        <div class="sh-flavor"><i>${CHARTER_RULE}</i></div></div>
      <div class="sh-col"><div class="sh-h label">Controls</div>
        <div class="sh-desc">Hover a tech for details · Click queues · Shift-click queues the whole path, across eras ·
          Click or right-click a queued tech to cancel · [ ] or PgUp/PgDn change era page · Home: the current era ·
          Arrows move · Enter queues · Shift+Enter queues the path · Esc closes</div></div>`;
  }

  function renderSheet() {
    const v = view!;
    const tid = subject();
    const c = tid ? v.cards[tid] : null;
    const shown = !!c && (isVisible(c) || isPlaceholder(c));
    const counts = Object.values($counts.get()).reduce((a, x) => a + (x?.total ?? 0), 0);
    const doctrine = c?.doctrine ?? null;
    const sig = `${tid}|${page}|${globalSig(v)}|${counts}|${collapsed}`;
    if (sig !== sheetSig) {
      sheetSig = sig;
      if (collapsed) sheetBody.innerHTML = '';
      else if (!tid || !c || !shown) sheetBody.innerHTML = summaryHtml();
      else if (isPlaceholder(c)) sheetBody.innerHTML = placeholderHtml(tid);
      else if (doctrine) {
        const d = DOCTRINES[doctrine];
        const members = d.members.filter((m) => isVisible(v.cards[m]));
        const note = d.siteNote[ctx().siteId];
        sheetBody.innerHTML = `<div class="doc-sheet" data-group="${doctrine}">
          <div class="doc-head"><b>DOCTRINE · CHOOSE ONE · PERMANENT</b> — ${esc(d.question)}${note
            ? ` <span class="sh-site">At ${esc(siteName(ctx().siteId))}: ${esc(note)}</span>` : ''}${jumpBack(c)}</div>
          <div class="doc-cols">${members.map((m) => doctrineSide(m, doctrine)).join('')}</div></div>`;
      } else {
        sheetBody.innerHTML = `
          <div class="sh-col sh-id">${identityHtml(c)}${unlocksHtml(tid)}</div>
          <div class="sh-col sh-fx">${fxHtml(tid)}
            ${c.state !== 'done' ? `<div class="sh-h label">Your base</div>${previewHtml(tid)}` : ''}</div>
          <div class="sh-col sh-path">${buttonsHtml(c)}${pathHtml(c)}</div>`;
      }
    }
    if (!c || !shown) return;
    // live fields only; buttons and layout stay put between rebuilds
    const res = $resources.get();
    const speed = $time.get().speed;
    sheetBody.querySelectorAll<HTMLElement>('[data-live]').forEach((s) => {
      const k = s.dataset.live!;
      let t = '';
      if (k === 'eta') {
        const q = c.state === 'queued' || c.state === 'stalled';
        const wall = c.eta && speed > 1 ? ` · ≈${fmtClock(c.eta / speed)} at ${speed}×` : '';
        t = c.state === 'stalled' && c.pct >= 1 ? `data paid — waiting for ${c.stalledNeed}`
          : c.eta === null
            ? v.paused ? `— ${v.paused === 'brownout' ? 'labs browned out' : 'no operating lab or Data Center'}` : '— no data transfer'
            : `${fmtClock(c.eta)}${q ? '' : ' if queued alone'}${wall}${c.state === 'stalled' ? ` · then waits for ${c.stalledNeed}` : ''}`;
      } else if (k === 'spent') t = `${Math.floor(c.spent)}≡ (${pct(c.pct)})`;
      else if (k.startsWith('have:')) t = `have ${Math.floor(res[k.slice(5) as ResourceId] ?? 0)}`;
      if (s.textContent !== t) s.textContent = t;
    });
    // each chip answers for its own tech: a doctrine sheet shows both members
    sheetBody.querySelectorAll<HTMLElement>('.g[data-res]').forEach((g) => {
      const own = g.closest<HTMLElement>('.doc-side[data-tech]')?.dataset.tech as TechId | undefined;
      const oc = (own && v.cards[own]) || c;
      g.classList.toggle('short', oc.goodsShort.includes(g.dataset.res as ResourceId));
    });
  }

  // ── input ──
  /** click semantics: doctrine cards only select (the sheet commits); a queued
   *  card cancels; anything else asks research.ts, which alerts on refusal
   *  (a future page's card: ERA LOCKED and what opens its era) */
  function activate(tid: TechId, path: boolean) {
    const c = view?.cards[tid];
    const it = layout?.items.get(tid);
    if (!c || !it) return;
    selected = tid;
    if (it.ph || c.state === 'done') return;
    if (c.state === 'queued' || c.state === 'stalled') { push({ kind: 'cancelResearch', tech: tid }); return; }
    if (c.doctrine) return;
    push({ kind: path ? 'researchPath' : 'research', tech: tid });
  }

  board.addEventListener('click', (e) => {
    const j = (e.target as HTMLElement).closest<HTMLElement>('[data-jump]');
    if (j) { jumpTo(j.dataset.jump as TechId); return; }
    const card = (e.target as HTMLElement).closest<HTMLElement>('.tech-card');
    if (!card) { selected = null; refreshFocus(); return; }
    activate(card.dataset.tech as TechId, e.shiftKey);
    refreshFocus();
  });
  board.addEventListener('contextmenu', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.tech-card');
    if (!card) return;
    e.preventDefault();
    const c = view?.cards[card.dataset.tech as TechId];
    if (c && (c.state === 'queued' || c.state === 'stalled')) push({ kind: 'cancelResearch', tech: c.tid });
  });
  // gaps between cards keep the last hover, so the sheet does not flicker in transit
  board.addEventListener('mouseover', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.tech-card');
    const t = (card?.dataset.tech as TechId | undefined) ?? null;
    if (t && t !== hover) { hover = t; refreshFocus(); }
  });
  board.addEventListener('mouseleave', () => { if (hover) { hover = null; refreshFocus(); } });

  const onAct = (e: Event) => {
    const j = (e.target as HTMLElement).closest<HTMLElement>('[data-jump]');
    if (j) { (j as HTMLButtonElement).blur?.(); jumpTo(j.dataset.jump as TechId); return; }
    const qi = (e.target as HTMLElement).closest<HTMLElement>('.q-item');
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (qi && !b) { jumpTo(qi.dataset.tech as TechId); return; }
    if (!b || b.disabled) return;
    b.blur(); // Space pauses the game; it must not re-press a focused sheet button
    const tid = b.dataset.tech as TechId;
    const c = view?.cards[tid];
    switch (b.dataset.act) {
      case 'queue': push({ kind: 'research', tech: tid }); break;
      case 'path': push({ kind: 'researchPath', tech: tid }); break;
      case 'cancel': push({ kind: 'cancelResearch', tech: tid }); break;
      case 'up': push({ kind: 'moveResearch', tech: tid, delta: -1 }); break;
      case 'commit':
        push({ kind: c && c.state !== 'available' ? 'researchPath' : 'research', tech: tid });
        selected = tid;
        break;
    }
  };
  sheet.addEventListener('click', onAct);

  function refreshFocus() {
    if (!view || !layout) return;
    renderSheet();
    applyHighlight();
  }

  /** arrows move the selection within the page: ←/→ along a lane row, ↑/↓ to
   *  the nearest card of the row above or below */
  function moveSel(dx: number, dy: number) {
    if (!layout || !view) return;
    const v = view;
    const items = [...layout.items.values()];
    const on = (t: TechId | null) => (t ? layout!.items.get(t) : undefined);
    const cur = on(selected) ?? on(hover)
      ?? items.find((s) => ['queued', 'stalled'].includes(v.cards[s.tid].state))
      ?? items.find((s) => v.cards[s.tid].state === 'available') ?? items[0];
    if (!cur) return;
    if (!on(selected) && !on(hover)) { selected = cur.tid; hover = null; refreshFocus(); return; }
    const cx = cur.x + cur.w / 2;
    let best: PageItem | null = null, bestD = Infinity;
    for (const s of items) {
      if (s.tid === cur.tid) continue;
      let d: number;
      if (dx) {
        if (s.row !== cur.row || Math.sign(s.x - cur.x) !== dx) continue;
        d = Math.abs(s.x - cur.x);
      } else {
        if (s.row !== cur.row + dy) continue;
        d = Math.abs(s.x + s.w / 2 - cx);
      }
      if (d < bestD) { bestD = d; best = s; }
    }
    if (best) { selected = best.tid; hover = null; refreshFocus(); }
  }

  // capture phase, so the build camera never pans or homes on the keys the tree uses
  window.addEventListener('keydown', (e) => {
    // under a victory or defeat overlay the tree stays shut
    if ($phase.get() !== 'playing' || overlayUp() || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.code === 'KeyT' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.stopPropagation();
      if (!e.repeat) toggle(!open); // a held T toggles once
      return;
    }
    if (!open) return;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const pages: Record<string, number> = { BracketLeft: -1, BracketRight: 1, PageUp: -1, PageDown: 1 };
    if (e.code === 'Escape') {
      e.stopPropagation(); e.preventDefault();
      if (!e.repeat) toggle(false);
      return;
    }
    if (e.code in arrows) {
      e.stopPropagation(); e.preventDefault();
      moveSel(...arrows[e.code]);
      return;
    }
    if (e.code in pages && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.stopPropagation(); e.preventDefault();
      setPage(page + pages[e.code]);
      return;
    }
    if (e.code === 'Home') {
      e.stopPropagation(); e.preventDefault();
      if (view) setPage(view.era);
      return;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      // a focused button of the tree's own takes its Enter; any other (the
      // chip that opened it) must not close the tree instead of queueing
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'BUTTON' && screen.contains(target)) { e.stopPropagation(); return; }
      e.stopPropagation(); e.preventDefault();
      if (!selected) return;
      const c = view?.cards[selected];
      if (!c || c.state === 'queued' || c.state === 'stalled') return;
      if (c.doctrine) {
        sheetBody.querySelector<HTMLButtonElement>(`button.commit[data-tech="${selected}"]`)?.focus();
        return;
      }
      if (layout?.items.has(selected)) activate(selected, e.shiftKey);
      else push({ kind: e.shiftKey ? 'researchPath' : 'research', tech: selected });
      refreshFocus();
      return;
    }
    if (e.code === 'Tab') e.stopPropagation();
  }, true);

  // a new size: rows re-fit, a row that no longer fits packs, links redraw
  new ResizeObserver(() => {
    if (!open || !layout) return;
    fitRows();
    board.dataset.focus = '';
    refresh();
  }).observe(main);

  focusHook = (tid) => {
    if (!game.commandView || overlayUp()) return;
    const v = $research.get();
    const c = tid && v ? v.cards[tid] : null;
    const target = c && (isVisible(c) || isPlaceholder(c)) ? c : null;
    if (!open) toggle(true, target ? clampEra(target.era) : undefined);
    if (!target) return;
    jumpTo(target.tid);
  };

  $research.subscribe(refresh);
  $resources.subscribe(() => { if (open && view) { updateCards(); renderSheet(); } });
  $swarm.subscribe(() => { if (open && view) updatePageHead(); });
  $alerts.subscribe(renderAlerts);
  $phase.subscribe((p) => {
    // '' lets the stylesheet decide: walk mode hides the chip
    chip.style.display = p === 'playing' ? '' : 'none';
    if (p !== 'playing') toggle(false);
  });
  // on foot, or under a victory or defeat overlay, the tree is shut
  $mode.subscribe((m) => { if (m === 'walk' && open) toggle(false); });
  for (const store of [$victory, $defeat]) store.subscribe((up) => { if (up && open) toggle(false); });
  renderChip(null);
}
