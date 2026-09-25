/** The research tree (docs/11 §6): 7 swimlanes × 8 eras plus the lane-free
 *  Era-8 capstone column, one SVG link layer behind the cards, era headers
 *  with both charter routes, the detail sheet and the queue strip.
 *  It renders $research and dispatches research actions; availability, cost
 *  and ETA all come from core/research.ts. */
import './techTree.css';
import {
  DOCTRINES, ERA_GATES, ERA_NAMES, ERA_SHORT, LANES, LANE_ORDER, TECHS, TECH_ORDER, describeTech,
  type DoctrineId, type EffectLine, type Lane, type TechId,
} from '../data/techs';
import { BUILDINGS } from '../data/buildings';
import { CHARTER_DEED_TECHS, CHARTER_TECHS } from '../data/balance';
import { RESOURCES, type ResourceId } from '../data/resources';
import { SITES, type SiteId } from '../data/sites';
import type { Expedition } from '../data/techs';
import {
  previewTech, producerName, producerOf,
  type GateProgress, type ResearchCard, type ResearchView, type TechState,
} from '../core/research';
import type { Game } from '../core/game';
import type { Action } from '../core/actions';
import { el, fmt } from './hud';
import {
  $alerts, $counts, $defeat, $lunar, $mode, $phase, $research, $resources, $siteId, $time, $victory, $vitals, overlayUp,
} from './stores';

// ─────────────────────────── geometry ───────────────────────────

/** lane-label column (px); era columns are --col-w wide with 4 px card inset
 *  each side, so the 8 px gutters sit centred on the column edges */
const LW = 64;
const INSET = 4;
const DOC_INDENT = 12;
const LANE_IDX = new Map<Lane, number>(LANE_ORDER.map((l, i) => [l, i]));

interface Slot {
  tid: TechId;
  col: number;
  /** slot units from the grid top; Era 8 and packed cells use fractional rows */
  row: number;
  h: number;
  indent: number;
  ph: boolean;
  /** packed into a crowded cell: one line (glyph, name, cost) */
  compact: boolean;
}
interface Bracket { group: DoctrineId; col: number; row: number; h: number }
interface Layout {
  slots: number;
  lanes: { lane: Lane; start: number; rows: number }[];
  items: Map<TechId, Slot>;
  brackets: Bracket[];
}

const isVisible = (c: ResearchCard) => c.state !== 'hidden';
/** an undiscovered breakthrough keeps its reserved slot as a placeholder */
const isPlaceholder = (c: ResearchCard) => c.state === 'hidden' && !!c.breakthrough;
/** the Era-8 capstone(s): the tech that arms the launch, drawn double height */
const isCapstone = (tid: TechId) => TECHS[tid].effects.some((fx) => fx.kind === 'launchAction');
/** the floor a slot may not fall under, and the least sheet the tree keeps (docs/12 §7) */
export const MIN_SLOT_PX = 28;
export const MIN_SHEET_PX = 112;

/** Lanes are as tall as their fullest cell on this run. If that is more rows
 *  than `maxSlots` allows, the tallest lanes give up rows (the Exploration
 *  lane keeps its two breakthrough slots) and a cell with more cards than its
 *  lane has rows packs them at rows/count height as compact cards. */
function computeLayout(v: ResearchView, maxSlots = Infinity): Layout {
  const cells = new Map<string, ResearchCard[]>();
  const e8: ResearchCard[] = [];
  for (const tid of TECH_ORDER) {
    const c = v.cards[tid];
    if (!isVisible(c) && !isPlaceholder(c)) continue;
    if (!c.lane) { e8.push(c); continue; }
    const k = `${c.lane}|${c.era}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k)!.push(c);
  }
  // rows within a cell: breakthroughs take their fixed slot, the rest fill in table order
  const rowsIn = new Map<string, Map<TechId, number>>();
  const laneRows = new Map<Lane, number>();
  for (const [k, list] of cells) {
    const taken = new Map<TechId, number>();
    const used = new Set<number>();
    for (const c of list) {
      if (c.breakthrough) { taken.set(c.tid, c.breakthrough.slot - 1); used.add(c.breakthrough.slot - 1); }
    }
    let r = 0;
    for (const c of list) {
      if (taken.has(c.tid)) continue;
      while (used.has(r)) r++;
      taken.set(c.tid, r);
      used.add(r);
    }
    rowsIn.set(k, taken);
    const lane = k.split('|')[0] as Lane;
    laneRows.set(lane, Math.max(laneRows.get(lane) ?? 1, Math.max(...used) + 1));
  }
  // overflow: take rows from the tallest lanes until the grid fits
  const floor = (l: Lane) => (l === 'exploration' ? 2 : 1);
  const total = () => LANE_ORDER.reduce((a, l) => a + (laneRows.get(l) ?? 1), 0);
  while (total() > maxSlots) {
    let pick: Lane | null = null;
    for (const l of LANE_ORDER) {
      const r = laneRows.get(l) ?? 1;
      if (r > floor(l) && (!pick || r > (laneRows.get(pick) ?? 1))) pick = l;
    }
    if (!pick) break;
    laneRows.set(pick, (laneRows.get(pick) ?? 1) - 1);
  }
  const lanes: Layout['lanes'] = [];
  let start = 0;
  for (const lane of LANE_ORDER) {
    const rows = laneRows.get(lane) ?? 1;
    lanes.push({ lane, start, rows });
    start += rows;
  }
  const slots = start;
  const items = new Map<TechId, Slot>();
  const brackets: Bracket[] = [];
  for (const [k, taken] of rowsIn) {
    const [lane, era] = k.split('|');
    const ln = lanes.find((l) => l.lane === lane)!;
    const need = Math.max(...taken.values()) + 1;
    const docs = new Map<DoctrineId, [number, number][]>();
    // a crowded cell: every card in table order (breakthroughs by slot) at rows/count
    const packed = need > ln.rows
      ? [...taken.keys()].sort((a, b) => taken.get(a)! - taken.get(b)!)
      : null;
    const h = packed ? ln.rows / packed.length : 1;
    for (const [tid, r] of taken) {
      const c = v.cards[tid];
      const row = packed ? ln.start + packed.indexOf(tid) * h : ln.start + r;
      items.set(tid, {
        tid, col: Number(era), row, h, indent: c.doctrine ? DOC_INDENT : 0, ph: isPlaceholder(c), compact: !!packed,
      });
      if (c.doctrine) {
        if (!docs.has(c.doctrine)) docs.set(c.doctrine, []);
        docs.get(c.doctrine)!.push([row, row + h]);
      }
    }
    for (const [group, spans] of docs) {
      const lo = Math.min(...spans.map((x) => x[0])), hi = Math.max(...spans.map((x) => x[1]));
      brackets.push({ group, col: Number(era), row: lo, h: hi - lo });
    }
  }
  // Era 8: the small steps, then the capstone double height, then each doctrine pair — centred
  const minors = e8.filter((c) => !c.doctrine && !isCapstone(c.tid));
  const caps = e8.filter((c) => !c.doctrine && isCapstone(c.tid));
  const pairs = new Map<DoctrineId, ResearchCard[]>();
  for (const c of e8) {
    if (!c.doctrine) continue;
    if (!pairs.has(c.doctrine)) pairs.set(c.doctrine, []);
    pairs.get(c.doctrine)!.push(c);
  }
  const pairRows = [...pairs.values()].reduce((a, p) => a + 0.5 + p.length, 0);
  const gap = minors.length ? 0.5 : 0;
  // minors squeeze (compact) before the capstone or the pairs ever do
  const minorH = minors.length ? Math.min(1, Math.max(0.5, (slots - caps.length * 2 - pairRows - gap) / minors.length)) : 1;
  const block = minors.length * minorH + gap + caps.length * 2 + pairRows;
  let r = Math.max(0, (slots - block) / 2);
  for (const c of minors) {
    items.set(c.tid, { tid: c.tid, col: 8, row: r, h: minorH, indent: 0, ph: false, compact: minorH < 1 });
    r += minorH;
  }
  r += gap;
  for (const c of caps) { items.set(c.tid, { tid: c.tid, col: 8, row: r, h: 2, indent: 0, ph: false, compact: false }); r += 2; }
  for (const [group, list] of pairs) {
    r += 0.5;
    brackets.push({ group, col: 8, row: r, h: list.length });
    for (const c of list) { items.set(c.tid, { tid: c.tid, col: 8, row: r, h: 1, indent: DOC_INDENT, ph: false, compact: false }); r += 1; }
  }
  return { slots, lanes, items, brackets };
}

// ─────────────────────────── text helpers ───────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const siteName = (id: SiteId) => titleCase(SITES[id].name);
const glyph = (r: string) => RESOURCES[r as ResourceId]?.glyph ?? '';
const laneDef = (l: Lane | null) => LANES.find((d) => d.id === l);

export function fmtClock(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return '—';
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
const pct = (p: number) => `${Math.floor(p * 100)}%`;

const ABBR: Record<string, string> = { output: 'out', inputs: 'in', draw: 'draw', power: 'pow', upkeep: 'upk' };
/** the card tag: the first generated pro, compacted for a 141 px line */
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

/** direct dependents (static data; visibility is filtered by the caller) */
const DEPENDENTS = new Map<TechId, TechId[]>();
for (const tid of TECH_ORDER) {
  for (const r of [...TECHS[tid].requires, ...(TECHS[tid].requiresAny ?? [])]) {
    if (!DEPENDENTS.has(r)) DEPENDENTS.set(r, []);
    DEPENDENTS.get(r)!.push(tid);
  }
}

const DEED_SHORT: Record<number, string> = { 6: 'DC night', 7: '2 outposts' };
const CHARTER_RULE = `An era opens with ${CHARTER_TECHS} of the previous era’s techs — or ${CHARTER_DEED_TECHS} plus a deed.`;

function prettyProspect(id: string): string {
  return id.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (c) => c.toUpperCase());
}

// ─────────────────────────── the screen ───────────────────────────

let focusHook: ((tid: TechId | null) => void) | null = null;
/** Open the tree on `tid`: selected (its detail sheet up) and pulsing once.
 *  null, or a tech with no card here, just opens the tree. */
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
  screen.innerHTML = `
    <div id="tech-head">
      <div class="th-title">
        <div class="th-name"><b>RESEARCH</b> · <span id="th-era"></span></div>
        <div class="th-rule">${CHARTER_RULE}</div>
      </div>
      <div id="tech-alerts"></div>
      <div id="tech-rate" class="mono"></div>
      <button class="btn" id="tech-map" style="display:none" title="Open the Lunar Map">[M] Map</button>
      <button class="btn" id="tech-close">Close [T]</button>
    </div>
    <div id="tech-main">
      <div id="tech-board">
        <div id="tech-eras"></div>
        <div id="tech-grid"></div>
      </div>
    </div>
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
  const board = $('#tech-board');
  const erasEl = $('#tech-eras');
  const grid = $('#tech-grid');
  const queueEl = $('#tech-queue');
  const otherEl = $('#tech-other-sites');
  const sheet = $('#tech-sheet');
  const sheetBody = $('#tech-sheet-body');
  const alertRail = $('#tech-alerts');
  const rateEl = $('#tech-rate');

  let open = false;
  let view: ResearchView | null = null;
  let layout: Layout | null = null;
  let structSig = '';
  let queueSig = '';
  let sheetSig = '';
  let hover: TechId | null = null;
  let selected: TechId | null = null;
  let collapsed = false;
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

  const toggle = (v: boolean) => {
    open = v;
    hover = null;
    screen.style.display = open ? 'flex' : 'none';
    game.setTechOpen(open);
    if (open) {
      structSig = ''; queueSig = ''; sheetSig = ''; refresh();
      // the chip (or a palette card) that opened it lets go of the keyboard
      if (!screen.contains(document.activeElement)) screen.focus({ preventScroll: true });
    }
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

  // ── structure signature: rebuild only when this changes ──
  const STATE_IDX = new Map<TechState, number>(
    (['hidden', 'done', 'queued', 'stalled', 'foreclosed', 'crewLocked', 'eraLocked', 'requires', 'requiresAny', 'full', 'available'] as TechState[])
      .map((s, i) => [s, i]));
  const signature = (v: ResearchView) =>
    `${v.era}|${v.otherSites.join(',')}|${v.queue.map((q) => q.tid + (q.stalled ? '!' : '')).join(',')}|` +
    TECH_ORDER.map((t) => {
      const c = v.cards[t];
      return `${STATE_IDX.get(c.state)!.toString(16)}${c.insight?.earned ? 'e' : ''}${c.doctrine ? 'd' : ''}${c.cost.data}`;
    }).join('.');

  function refresh() {
    const v = $research.get();
    renderChip(v);
    if (!open || !v) return;
    view = v;
    const sig = `${signature(v)}|${slotBudget()}`;
    if (sig !== structSig) {
      structSig = sig;
      layout = computeLayout(v, slotBudget());
      buildEraHeads();
      buildGrid();
      if (selected && !layout.items.has(selected)) selected = null;
      if (hover && !layout.items.has(hover)) hover = null;
    }
    updateHeader();
    updateEraHeads();
    updateCards();
    renderQueue();
    renderSheet();
    applyHighlight();
  }

  /** how many slots fit at MIN_SLOT_PX above the least sheet (the header,
   *  era heads and gaps take 74 px of the screen's 12 px-padded box) */
  function slotBudget(): number {
    const h = screen.clientHeight - 12;
    if (h <= 0) return Infinity;
    return Math.max(8, Math.floor((h - 74 - (collapsed ? 28 : MIN_SHEET_PX)) / MIN_SLOT_PX));
  }

  // ── header ──
  function updateHeader() {
    const v = view!;
    $('#th-era').textContent = `ERA ${v.era} ${ERA_NAMES[v.era]}`;
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

  // ── era headers ──
  function buildEraHeads() {
    let html = '<div class="eh-corner label">Lane · Era</div>';
    for (let e = 1; e <= 8; e++) {
      html += `<div class="era-head" data-era="${e}">
        <div class="eh-l1"><span class="eh-name">E${e} · ${ERA_SHORT[e]}</span><span class="eh-pips mono"></span></div>
        <div class="eh-l2 mono"></div><div class="eh-l3 mono"></div></div>`;
    }
    erasEl.innerHTML = html;
  }
  function gateLine(g: GateProgress): { pips: string; line: string; title: string } {
    const gate = ERA_GATES[g.era]!;
    const n = Math.min(g.techs, g.techsNeed);
    const pips = `${'◼'.repeat(n)}${'◻'.repeat(Math.max(0, g.techsNeed - n))} ${g.techs}/${g.techsNeed}`;
    const m = /^(\d+)(\S*)/.exec(gate.deed);
    let deed: string;
    if (g.deedNeed <= 1) deed = `${DEED_SHORT[g.era] ?? gate.deed} ${g.deedMet ? '✓' : '✗'}`;
    else if (m) deed = `${m[2]} ${fmt(g.deedValue)}/${g.deedNeed}${g.deedMet ? ' ✓' : ''}`;
    else deed = `${DEED_SHORT[g.era] ?? gate.deed} ${fmt(g.deedValue)}/${g.deedNeed}${g.era === 7 ? 's' : ''}${g.deedMet ? ' ✓' : ''}`;
    const cohab = g.requires ? ` Robotic runs also need ${TECHS[g.requires.tech].name} (${g.requires.done ? 'done' : 'not yet'}).` : '';
    return {
      pips,
      line: `or ${g.deedTechsNeed} + ${deed}`,
      title: `Era ${g.era} opens with ${g.techsNeed} Era-${g.era - 1} techs (${g.techs} done), or ${g.deedTechsNeed} + ${gate.deed} ` +
        `(${fmt(g.deedValue)}/${g.deedNeed}).${cohab}`,
    };
  }
  function updateEraHeads() {
    const v = view!;
    erasEl.querySelectorAll<HTMLElement>('.era-head').forEach((h) => {
      const e = Number(h.dataset.era);
      h.classList.toggle('cur', e === v.era);
      h.classList.toggle('future', e > v.era);
      const pipsEl = h.querySelector('.eh-pips') as HTMLElement;
      const l2 = h.querySelector('.eh-l2') as HTMLElement;
      const l3 = h.querySelector('.eh-l3') as HTMLElement;
      let pips = '', line = '', extra = '', title = `Era ${e} — ${ERA_NAMES[e]}`;
      if (e === 1) { line = 'landing · open'; }
      else if (e <= v.era) { line = '✓ open'; }
      else {
        const g = v.gates.find((x) => x.era === e);
        if (g) {
          const gl = gateLine(g);
          pips = gl.pips;
          line = gl.line;
          if (g.requires) extra = `+ Cohabitation ${g.requires.done ? '✓' : '✗'}`;
          title = `${title}\n${gl.title}`;
        }
      }
      if (pipsEl.textContent !== pips) pipsEl.textContent = pips;
      if (l2.textContent !== line) l2.textContent = line;
      if (l3.textContent !== extra) l3.textContent = extra;
      h.classList.toggle('three', !!extra);
      h.title = title;
    });
  }

  // ── grid ──
  function cardHtml(c: ResearchCard, slot: Slot): string {
    if (slot.ph) {
      return `<div class="l1"><span class="gl">✦</span><span class="nm">? Breakthrough</span></div>
        <div class="l2"><span class="l2a">survey an anomaly</span></div>`;
    }
    const v = view!;
    const glyphTxt = c.state === 'queued' ? `#${v.queue.findIndex((q) => q.tid === c.tid) + 1}`
      : c.state === 'stalled' ? `#${v.queue.findIndex((q) => q.tid === c.tid) + 1}⚠` : STATE_GLYPH[c.state] ?? '';
    const marks: string[] = [];
    if (c.doctrine) marks.push('<span title="Doctrine — choose one, permanent">◇</span>');
    if (c.breakthrough) marks.push('<span title="Breakthrough">✦</span>');
    if (c.siteTech) {
      const only = (TECHS[c.tid].sites ?? []).map(siteName).join(' / ');
      marks.push(`<span title="${esc(only)} only">◬</span>`);
    }
    let l2: string;
    if (c.state === 'done') {
      l2 = `<span class="l2b">${esc(tag(c.tid))}</span>`;
    } else if (c.state === 'queued') {
      l2 = `<span class="l2a"><span data-live="pct"></span> · ETA <span data-live="eta"></span></span><span class="l2b">${esc(tag(c.tid))}</span>`;
    } else if (c.state === 'stalled') {
      l2 = `<span class="l2a">⚠ needs <span data-live="need"></span></span>`;
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
      l2 = `<span class="l2a">${c.cost.data}≡${goods ? ' ' + goods : ''}${ins}</span><span class="l2b">${esc(tag(c.tid))}</span>`;
    }
    if (slot.compact) {
      const right = c.state === 'done' ? '' : c.state === 'queued' || c.state === 'stalled'
        ? '<span class="cc" data-live="pct"></span>' : `<span class="cc">${c.cost.data}≡</span>`;
      return `<div class="l1"><span class="gl">${glyphTxt}</span><span class="nm">${esc(c.short)}</span><span class="mk">${marks.join('')}</span>${right}</div>
        ${c.state === 'queued' || c.state === 'stalled' || c.spent > 0 ? '<div class="prog"><i></i></div>' : ''}`;
    }
    const cap = slot.h >= 2 ? `<div class="l3 label">CAPSTONE · ${esc(ERA_NAMES[8])}</div>` : '';
    return `<div class="l1"><span class="gl">${glyphTxt}</span><span class="nm">${esc(c.short)}</span><span class="mk">${marks.join('')}</span></div>
      ${cap}<div class="l2">${l2}</div>${c.state === 'queued' || c.state === 'stalled' || c.spent > 0 ? '<div class="prog"><i></i></div>' : ''}`;
  }

  function buildGrid() {
    const v = view!, L = layout!;
    // on the screen, not the board: the sheet's height reads it too (techTree.css)
    screen.style.setProperty('--slots', String(L.slots));
    cardEls.clear();
    let html = '<svg id="tech-links" aria-hidden="true"></svg>';
    for (const [i, ln] of L.lanes.entries()) {
      const d = laneDef(ln.lane)!;
      html += `<div class="lane${i % 2 ? ' alt' : ''}" data-lane="${ln.lane}" style="--r:${ln.start};--h:${ln.rows}" title="${esc(d.holds)}">
        <span class="lane-label">${esc(d.label)}</span></div>`;
    }
    html += `<div class="era-band" style="--c:${v.era}"></div>`;
    for (const b of L.brackets) {
      const q = DOCTRINES[b.group].question;
      html += `<div class="doc-bracket" data-group="${b.group}" style="--c:${b.col};--r:${b.row};--h:${b.h}"
        title="DOCTRINE · CHOOSE ONE · PERMANENT — ${esc(q)}"><span>DOCTRINE</span></div>`;
    }
    grid.innerHTML = html;
    for (const [tid, slot] of L.items) {
      const c = v.cards[tid];
      const cls = slot.ph ? 'ph' : STATE_CLASS(c.state);
      const e = el('div', `tech-card ${cls}${c.doctrine ? ' doctrine' : ''}${slot.h >= 2 ? ' capstone' : ''}${slot.compact ? ' compact' : ''}`);
      e.dataset.tech = tid;
      e.dataset.state = slot.ph ? 'placeholder' : c.state;
      e.setAttribute('role', 'button');
      e.tabIndex = -1;
      e.style.cssText = `--c:${slot.col};--r:${slot.row};--h:${slot.h};--i:${slot.indent}px`;
      e.setAttribute('aria-label', slot.ph ? 'Undiscovered breakthrough' : `${c.name} — ${STATUS[c.state]}${c.reason ? `: ${c.reason}` : ''}`);
      e.innerHTML = cardHtml(c, slot);
      grid.appendChild(e);
      cardEls.set(tid, e);
    }
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

  // ── links (one SVG behind the cards; verticals in gutters, horizontals in row gaps) ──
  interface Dims { colW: number; slotH: number }
  const dims = (): Dims => {
    const L = layout!;
    return { colW: (grid.clientWidth - LW) / 8, slotH: grid.clientHeight / Math.max(1, L.slots) };
  };

  interface Focus {
    tid: TechId;
    nodes: Set<TechId>;
    edges: Set<string>;
    dashed: Set<string>;
    goods: { from: TechId; res: ResourceId }[];
  }
  /** prerequisite closure (OR groups: the satisfied member, else every member)
   *  plus direct dependents; this drives both the card dimming and the link layer */
  function focusOf(tid: TechId): Focus {
    const v = view!;
    const vis = (t: TechId) => isVisible(v.cards[t]);
    const has = (t: TechId) => ['done', 'queued', 'stalled'].includes(v.cards[t].state);
    const f: Focus = { tid, nodes: new Set([tid]), edges: new Set(), dashed: new Set(), goods: [] };
    const walk = (t: TechId) => {
      const def = TECHS[t];
      for (const r of def.requires) {
        if (!vis(r)) continue;
        f.edges.add(`${r}>${t}`);
        if (!f.nodes.has(r)) { f.nodes.add(r); walk(r); }
      }
      const any = (def.requiresAny ?? []).filter(vis);
      const sat = any.filter(has);
      for (const r of sat.length ? sat : any) {
        f.edges.add(`${r}>${t}`);
        if (!sat.length) f.dashed.add(`${r}>${t}`);
        if (!f.nodes.has(r)) { f.nodes.add(r); walk(r); }
      }
    };
    if (!layout!.items.get(tid)?.ph) walk(tid);
    for (const d of DEPENDENTS.get(tid) ?? []) {
      if (!vis(d)) continue;
      f.nodes.add(d);
      f.edges.add(`${tid}>${d}`);
    }
    for (const r of Object.keys(v.cards[tid].cost.goods) as ResourceId[]) {
      const ok = (p: TechId) => p !== tid && vis(p) && layout!.items.has(p);
      const makers = (GOODS_BY_UNLOCK[r] ?? []).filter(ok);
      for (const p of makers.length ? makers : (GOODS_BY_RECIPE[r] ?? []).filter(ok)) f.goods.push({ from: p, res: r });
    }
    return f;
  }

  function drawLinks() {
    const svg = grid.querySelector('#tech-links') as SVGSVGElement | null;
    if (!svg || !layout || !view) return;
    const v = view, L = layout;
    const { colW, slotH } = dims();
    const W = grid.clientWidth, H = grid.clientHeight;
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const X = (c: number) => LW + (c - 1) * colW;
    const box = (s: Slot) => ({
      x0: X(s.col) + INSET + s.indent, x1: X(s.col) + colW - INSET,
      y0: s.row * slotH + 2, y1: (s.row + s.h) * slotH - 2, ym: (s.row + s.h / 2) * slotH,
    });
    const focusTid = hover ?? selected;
    const f = focusTid && L.items.has(focusTid) ? focusOf(focusTid) : null;
    const laneOf = (t: TechId) => v.cards[t].lane;
    const byDefault = (a: TechId, b: TechId) => {
      const la = laneOf(a), lb = laneOf(b);
      if (la && lb) return Math.abs(LANE_IDX.get(la)! - LANE_IDX.get(lb)!) <= 1;
      return v.cards[a].era >= 7;
    };
    const rowBlocked = (y: number, c0: number, c1: number) => {
      for (const s of L.items.values()) {
        if (s.col <= c0 || s.col >= c1) continue;
        const b = box(s);
        if (y >= b.y0 - 1 && y <= b.y1 + 1) return true;
      }
      return false;
    };
    /** the horizontal run across the columns between: the middle of a row that is
     *  empty in all of them, else a row gap; least vertical travel, then nearest the target */
    const channel = (sy: number, ty: number, c0: number, c1: number) => {
      let best = 0, bestCost = Infinity;
      for (let k = 0; k <= 2 * L.slots; k++) {
        const y = (k / 2) * slotH;
        const mid = k % 2 === 1;
        if (mid && rowBlocked(y, c0, c1)) continue;
        const cost = Math.abs(y - sy) + Math.abs(y - ty) + Math.abs(y - ty) * 0.01 + (mid ? 0 : slotH * 0.3);
        if (cost < bestCost) { bestCost = cost; best = y; }
      }
      return best;
    };
    // incoming AND and OR edges on one card enter at different heights
    const incoming = new Map<TechId, { and: boolean; or: boolean }>();
    const edges: { a: TechId; b: TechId; or: boolean }[] = [];
    for (const [tid, s] of L.items) {
      if (s.ph) continue;
      const def = TECHS[tid];
      for (const r of def.requires) if (L.items.has(r) && isVisible(v.cards[r])) edges.push({ a: r, b: tid, or: false });
      for (const r of def.requiresAny ?? []) if (L.items.has(r) && isVisible(v.cards[r])) edges.push({ a: r, b: tid, or: true });
    }
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
    const route = (a: TechId, b: TechId, or: boolean): string => {
      const sa = L.items.get(a)!, sb = L.items.get(b)!;
      const ba = box(sa), bb = box(sb);
      const sy = ba.ym, ty = entryY(b, or);
      const tx = or ? X(sb.col) + 3 : bb.x0;
      if (sb.col <= sa.col) {
        const g = X(sb.col);
        return `M${ba.x0},${sy}H${g}V${ty}H${tx}`;
      }
      const g1 = X(sa.col + 1), g2 = X(sb.col);
      if (sb.col === sa.col + 1) return `M${ba.x1},${sy}H${g1}V${ty}H${tx}`;
      if (Math.abs(sy - ty) < 0.5 && !rowBlocked(sy, sa.col, sb.col)) return `M${ba.x1},${sy}H${tx}`;
      const cy = channel(sy, ty, sa.col, sb.col);
      return `M${ba.x1},${sy}H${g1}V${cy}H${g2}V${ty}H${tx}`;
    };
    let base = '', hi = '', marks = '';
    const diamonds = new Map<TechId, boolean>();
    for (const e of edges) {
      const key = `${e.a}>${e.b}`;
      const inFocus = !!f && f.edges.has(key);
      if (!inFocus && !byDefault(e.a, e.b)) continue;
      const done = v.cards[e.a].state === 'done';
      const dashed = !done || (f?.dashed.has(key) ?? false);
      const d = route(e.a, e.b, e.or);
      const cls = `lk${done ? ' done' : ''}${dashed ? ' pend' : ''}${inFocus ? ' hi' : ''}`;
      const path = `<path class="${cls}" d="${d}" data-edge="${key}"/>`;
      if (inFocus) hi += path; else base += path;
      if (e.or) diamonds.set(e.b, (diamonds.get(e.b) ?? false) || inFocus);
      if (L.items.get(e.b)!.col <= L.items.get(e.a)!.col && !e.or) {
        const bb = box(L.items.get(e.b)!);
        marks += `<circle class="lk-dot${inFocus ? ' hi' : ''}" cx="${bb.x0}" cy="${entryY(e.b, false)}" r="2"/>`;
      }
    }
    for (const [t, isHi] of diamonds) {
      const s = L.items.get(t)!;
      const x = X(s.col), y = entryY(t, true), bx = box(s).x0;
      marks += `<path class="lk${isHi ? ' hi' : ''}" d="M${x + 3},${y}H${bx}"/>` +
        `<path class="or-dia${isHi ? ' hi' : ''}" data-or="${t}" d="M${x - 3},${y}L${x},${y - 3}L${x + 3},${y}L${x},${y + 3}Z"><title>any one of these</title></path>`;
    }
    let goods = '';
    if (f) {
      for (const g of f.goods) {
        goods += `<path class="lk goods" d="${route(g.from, f.tid, false)}" data-goods="${g.res}"/>`;
      }
    }
    svg.innerHTML = `<g class="base">${base}</g><g class="goods">${goods}</g><g class="hi">${hi}</g><g class="marks">${marks}</g>`;
  }

  function applyHighlight() {
    const focusTid = hover ?? selected;
    const f = hover && layout?.items.has(hover) ? focusOf(hover) : null;
    grid.classList.toggle('hovering', !!f);
    for (const [tid, e] of cardEls) {
      e.classList.toggle('hl', !!f && f.nodes.has(tid));
      e.classList.toggle('hov', tid === hover);
      e.classList.toggle('goods-src', !!f && f.goods.some((g) => g.from === tid));
      e.classList.toggle('sel', tid === selected);
    }
    const key = `${focusTid ?? ''}|${hover ?? ''}`;
    if (grid.dataset.focus !== key) {
      grid.dataset.focus = key;
      drawLinks();
    }
  }

  // ── queue strip ──
  function renderQueue() {
    const v = view!;
    const sig = v.queue.map((q) => q.tid + (q.stalled ? '!' : '')).join(',') + `|${v.queueMax}`;
    if (sig !== queueSig) {
      queueSig = sig;
      if (!v.queue.length) {
        queueEl.innerHTML = `<span class="q-head label">Queue 0/${v.queueMax}</span>
          <span class="q-empty">empty — click an available tech · Shift-click queues its whole path</span>`;
      } else {
        queueEl.innerHTML = `<span class="q-head label">Queue ${v.queue.length}/${v.queueMax}</span>` + v.queue.map((q, i) => `
          <span class="q-item${q.stalled ? ' stalled' : ''}" data-tech="${q.tid}">
            <span class="q-nm">${i + 1}. ${esc(TECHS[q.tid].short)}</span>
            <span class="q-live mono" data-live="q"></span>
            ${i > 0 ? `<button class="q-btn" data-act="up" data-tech="${q.tid}" title="Move up">↑</button>` : ''}
            <button class="q-btn" data-act="cancel" data-tech="${q.tid}" title="Cancel (dependents drop too)">×</button>
          </span>`).join('');
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

  // ── detail sheet ──
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
    return s === 'done' ? '✓' : s === 'queued' || s === 'stalled' ? '◷' : '✗';
  };

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
      rows.push(`<div><span class="k">Needs</span>${[
        ...req.map((t) => `${tick(t)} ${esc(TECHS[t].short)}`),
        ...(any.length ? [`any of ${any.map((t) => `${tick(t)} ${esc(TECHS[t].short)}`).join(' | ')}`] : []),
      ].join(' · ')}</div>`);
    }
    const deps = (DEPENDENTS.get(c.tid) ?? []).filter(vis);
    if (deps.length) {
      const names = deps.map((t) => esc(TECHS[t].short)).join(', ');
      rows.push(`<div title="${names}"><span class="k">Leads to</span>→ ${names}</div>`);
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

  function identityHtml(c: ResearchCard): string {
    const def = TECHS[c.tid];
    const badges: string[] = [];
    if (c.doctrine) badges.push('◇ DOCTRINE');
    if (c.breakthrough) badges.push('✦ BREAKTHROUGH');
    if (c.siteTech) badges.push(`◬ ${esc((def.sites ?? []).map(siteName).join(' / '))} only`);
    const lane = laneDef(c.lane);
    const note = siteNote(c.tid);
    return `<div class="sh-name">${esc(c.name)} <span class="badges">${badges.join(' · ')}</span></div>
      <div class="sh-meta label">E${c.era} · ${esc(ERA_NAMES[c.era])}${lane ? ` · ${esc(lane.label)}` : ' · CAPSTONE COLUMN'}</div>
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
        <div class="sh-meta label">E${c.era} · ${esc(ERA_NAMES[c.era])} · ◎ EXPLORATION slot ${bt.slot}</div>
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
        <div class="sh-desc">Hover a tech for details · Click queues · Shift-click queues the whole path ·
          Click or right-click a queued tech to cancel · Arrows move · Enter queues · Shift+Enter queues the path · Esc closes</div></div>`;
  }

  function renderSheet() {
    const v = view!;
    const tid = subject();
    const c = tid ? v.cards[tid] : null;
    const slot = tid ? layout!.items.get(tid) : undefined;
    const counts = Object.values($counts.get()).reduce((a, x) => a + (x?.total ?? 0), 0);
    const doctrine = c?.doctrine ?? null;
    const sig = `${tid}|${structSig}|${counts}|${collapsed}`;
    if (sig !== sheetSig) {
      sheetSig = sig;
      if (collapsed) sheetBody.innerHTML = '';
      else if (!tid || !c || !slot) sheetBody.innerHTML = summaryHtml();
      else if (slot.ph) sheetBody.innerHTML = placeholderHtml(tid);
      else if (doctrine) {
        const d = DOCTRINES[doctrine];
        const members = d.members.filter((m) => isVisible(v.cards[m]));
        const note = d.siteNote[ctx().siteId];
        sheetBody.innerHTML = `<div class="doc-sheet" data-group="${doctrine}">
          <div class="doc-head"><b>DOCTRINE · CHOOSE ONE · PERMANENT</b> — ${esc(d.question)}${note
            ? ` <span class="sh-site">At ${esc(siteName(ctx().siteId))}: ${esc(note)}</span>` : ''}</div>
          <div class="doc-cols">${members.map((m) => doctrineSide(m, doctrine)).join('')}</div></div>`;
      } else {
        sheetBody.innerHTML = `
          <div class="sh-col sh-id">${identityHtml(c)}${unlocksHtml(tid)}</div>
          <div class="sh-col sh-fx">${fxHtml(tid)}
            ${c.state !== 'done' ? `<div class="sh-h label">Your base</div>${previewHtml(tid)}` : ''}</div>
          <div class="sh-col sh-path">${buttonsHtml(c)}${pathHtml(c)}</div>`;
      }
    }
    if (!c) return;
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
   *  card cancels; anything else asks research.ts, which alerts on refusal */
  function activate(tid: TechId, path: boolean) {
    const c = view?.cards[tid];
    const slot = layout?.items.get(tid);
    if (!c || !slot) return;
    selected = tid;
    if (slot.ph || c.state === 'done') return;
    if (c.state === 'queued' || c.state === 'stalled') { push({ kind: 'cancelResearch', tech: tid }); return; }
    if (c.doctrine) return;
    push({ kind: path ? 'researchPath' : 'research', tech: tid });
  }

  grid.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.tech-card');
    if (!card) { selected = null; refreshFocus(); return; }
    activate(card.dataset.tech as TechId, e.shiftKey);
    refreshFocus();
  });
  grid.addEventListener('contextmenu', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.tech-card');
    if (!card) return;
    e.preventDefault();
    const c = view?.cards[card.dataset.tech as TechId];
    if (c && (c.state === 'queued' || c.state === 'stalled')) push({ kind: 'cancelResearch', tech: c.tid });
  });
  // gaps between cards keep the last hover, so the sheet does not flicker in transit
  grid.addEventListener('mouseover', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.tech-card');
    const t = (card?.dataset.tech as TechId | undefined) ?? null;
    if (t && t !== hover) { hover = t; refreshFocus(); }
  });
  grid.addEventListener('mouseleave', () => { if (hover) { hover = null; refreshFocus(); } });

  const onAct = (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
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

  /** arrows move the selection to the nearest card in that direction */
  function moveSel(dx: number, dy: number) {
    if (!layout) return;
    const items = [...layout.items.values()];
    const cur = layout.items.get(selected ?? hover ?? ('' as TechId))
      ?? layout.items.get(view?.queue[0]?.tid ?? ('' as TechId))
      ?? items.find((s) => view!.cards[s.tid].state === 'available') ?? items[0];
    if (!cur) return;
    if (!selected && !hover) { selected = cur.tid; refreshFocus(); return; }
    const cy = cur.row + cur.h / 2;
    let best: Slot | null = null, bestD = Infinity;
    for (const s of items) {
      if (s.tid === cur.tid) continue;
      const sy = s.row + s.h / 2;
      let d: number;
      if (dx) {
        if (Math.sign(s.col - cur.col) !== dx) continue;
        d = Math.abs(s.col - cur.col) * 100 + Math.abs(sy - cy);
      } else {
        if (s.col !== cur.col || Math.sign(sy - cy) !== dy) continue;
        d = Math.abs(sy - cy);
      }
      if (d < bestD) { bestD = d; best = s; }
    }
    if (best) { selected = best.tid; hover = null; refreshFocus(); }
  }

  // capture phase, so the build camera never pans on the arrows the tree uses
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
      activate(selected, e.shiftKey);
      refreshFocus();
      return;
    }
    if (e.code === 'Tab') e.stopPropagation();
  }, true);

  new ResizeObserver(() => { if (open && layout) drawLinks(); }).observe(grid);
  // a new height budget can re-pack the lanes
  new ResizeObserver(() => {
    if (!open || !layout || structSig.endsWith(`|${slotBudget()}`)) return;
    structSig = '';
    refresh();
  }).observe(screen);

  focusHook = (tid) => {
    if (!game.commandView || overlayUp()) return;
    toggle(true);
    if (!tid || !layout?.items.has(tid)) return;
    selected = tid;
    hover = null;
    refreshFocus();
    const card = cardEls.get(tid);
    if (!card) return;
    card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    card.classList.remove('pulse');
    void card.offsetWidth;
    card.classList.add('pulse');
  };

  $research.subscribe(refresh);
  $resources.subscribe(() => { if (open && view) { updateCards(); renderSheet(); } });
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
