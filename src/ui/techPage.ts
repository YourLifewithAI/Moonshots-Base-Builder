/** One era's page of the research tree (docs/14 §1.4–1.5): which cards it
 *  holds, one row per lane that has any, their order and packing, the
 *  doctrine brackets, and the stubs that point to other eras. Pure: it reads
 *  the published ResearchView and the static tech table, nothing else. */
import {
  LANES, LANE_ORDER, TECHS, TECH_ORDER,
  type DoctrineId, type Era, type Lane, type TechId,
} from '../data/techs';
import type { ResearchCard, ResearchView } from '../core/research';

export const isVisible = (c: ResearchCard) => c.state !== 'hidden';
/** an undiscovered breakthrough keeps its reserved place as a placeholder */
export const isPlaceholder = (c: ResearchCard) => c.state === 'hidden' && !!c.breakthrough;
/** the tech that arms the launch: drawn double width on the Era 8 page */
export const isCapstone = (tid: TechId) => TECHS[tid].effects.some((fx) => fx.kind === 'launchAction');
/** a card that has a place on its era's page */
export const onBoard = (c: ResearchCard) => isVisible(c) || isPlaceholder(c);

/** geometry (px): the lane-label column, a card, a compact card and the gutter */
export const GEO = { lw: 116, cw: 204, compactW: 140, gap: 8 } as const;
/** a row with more cards than this packs them as compact one-line cards */
export const ROW_MAX = 5;

/** direct dependents (static data; the caller filters visibility) */
export const DEPENDENTS = new Map<TechId, TechId[]>();
for (const tid of TECH_ORDER) {
  for (const r of [...TECHS[tid].requires, ...(TECHS[tid].requiresAny ?? [])]) {
    if (!DEPENDENTS.has(r)) DEPENDENTS.set(r, []);
    DEPENDENTS.get(r)!.push(tid);
  }
}

export interface PageRow {
  key: string;
  lane: Lane | null;
  label: string;
  holds: string;
  cards: TechId[];
  compact: boolean;
  /** px from the board's left edge to the row's right end */
  width: number;
}
export interface PageItem {
  tid: TechId;
  row: number;
  /** px from the board's left edge */
  x: number;
  w: number;
  ph: boolean;
  compact: boolean;
  capstone: boolean;
}
export interface PageBracket { group: DoctrineId; row: number; x0: number; x1: number }
/** a link to other eras: the eras in order, the first tech to select in each */
export interface Stub { eras: Era[]; target: Partial<Record<Era, TechId>>; techs: TechId[]; done: boolean }
export interface PageLayout {
  era: Era;
  rows: PageRow[];
  items: Map<TechId, PageItem>;
  brackets: PageBracket[];
  /** px: the widest row */
  width: number;
  /** off-page prerequisites (the ◂ stub) and dependents (the ▸ stub) */
  before: Map<TechId, Stub>;
  after: Map<TechId, Stub>;
}

const ORDER = new Map<TechId, number>(TECH_ORDER.map((t, i) => [t, i]));
const prereqs = (t: TechId) => [...TECHS[t].requires, ...(TECHS[t].requiresAny ?? [])];

/** The cards of one era page, in rows. `maxWidth` is the room the board has:
 *  a row that would not fit at full size packs as compact cards too. */
export function computePageLayout(v: ResearchView, era: Era, maxWidth = Infinity): PageLayout {
  const cards = TECH_ORDER.map((t) => v.cards[t]).filter((c) => c.era === era && onBoard(c));
  const here = new Set(cards.map((c) => c.tid));

  // depth: the longest chain of this page's prerequisites below a card
  const depth = new Map<TechId, number>();
  const depthOf = (t: TechId, seen = new Set<TechId>()): number => {
    if (depth.has(t)) return depth.get(t)!;
    if (seen.has(t)) return 0;
    seen.add(t);
    let d = 0;
    if (isVisible(v.cards[t])) {
      for (const r of prereqs(t)) if (here.has(r) && isVisible(v.cards[r])) d = Math.max(d, depthOf(r, seen) + 1);
    }
    depth.set(t, d);
    return d;
  };

  // rows: one per lane with a card here, in lane order; lane-free cards (the
  // Era 8 capstone column) make the SWARM block: steps, capstone, purpose
  const groups: { key: string; lane: Lane | null; label: string; holds: string; list: ResearchCard[] }[] = [];
  for (const lane of LANE_ORDER) {
    const list = cards.filter((c) => c.lane === lane);
    const d = LANES.find((l) => l.id === lane)!;
    if (list.length) groups.push({ key: lane, lane, label: d.label, holds: d.holds, list });
  }
  const free = cards.filter((c) => !c.lane);
  const steps = free.filter((c) => !c.doctrine && !isCapstone(c.tid));
  const caps = free.filter((c) => !c.doctrine && isCapstone(c.tid));
  const purpose = free.filter((c) => c.doctrine);
  if (steps.length) groups.push({ key: 'swarm', lane: null, label: '✺ SWARM', holds: 'the steps before the launch', list: steps });
  if (caps.length) groups.push({ key: 'capstone', lane: null, label: 'CAPSTONE', holds: 'arms the launch: FIRST LIGHT', list: caps });
  if (purpose.length) groups.push({ key: 'purpose', lane: null, label: '◇ PURPOSE', holds: 'what the swarm is for', list: purpose });

  const rows: PageRow[] = [];
  const items = new Map<TechId, PageItem>();
  const brackets: PageBracket[] = [];
  for (const g of groups) {
    // roots first, then table order; breakthroughs keep their slot order at the end
    const main = g.list.filter((c) => !c.breakthrough)
      .sort((a, b) => depthOf(a.tid) - depthOf(b.tid) || ORDER.get(a.tid)! - ORDER.get(b.tid)!);
    // a doctrine pair sits together, where its first member falls
    const ordered: ResearchCard[] = [];
    for (const c of main) {
      if (ordered.includes(c)) continue;
      ordered.push(c);
      if (c.doctrine) for (const m of main) if (m !== c && m.doctrine === c.doctrine && !ordered.includes(m)) ordered.push(m);
    }
    ordered.push(...g.list.filter((c) => c.breakthrough).sort((a, b) => a.breakthrough!.slot - b.breakthrough!.slot));
    const spans = ordered.map((c) => (!c.lane && isCapstone(c.tid) ? 2 : 1));
    const slots = spans.reduce((a, s) => a + s, 0);
    const full = GEO.lw + slots * (GEO.cw + GEO.gap) - GEO.gap;
    const compact = slots > ROW_MAX || full > maxWidth;
    const cw = compact ? GEO.compactW : GEO.cw;
    const r = rows.length;
    let x = GEO.lw;
    const docSpan = new Map<DoctrineId, [number, number]>();
    ordered.forEach((c, i) => {
      const w = spans[i] * cw + (spans[i] - 1) * GEO.gap;
      items.set(c.tid, {
        tid: c.tid, row: r, x, w, ph: isPlaceholder(c), compact, capstone: spans[i] > 1,
      });
      if (c.doctrine) {
        const s = docSpan.get(c.doctrine);
        docSpan.set(c.doctrine, s ? [s[0], x + w] : [x, x + w]);
      }
      x += w + GEO.gap;
    });
    for (const [group, [x0, x1]] of docSpan) brackets.push({ group, row: r, x0, x1 });
    rows.push({ key: g.key, lane: g.lane, label: g.label, holds: g.holds, cards: ordered.map((c) => c.tid), compact, width: x - GEO.gap });
  }

  // stubs: prerequisites and dependents that live on other pages
  const before = new Map<TechId, Stub>();
  const after = new Map<TechId, Stub>();
  const done = (t: TechId) => v.cards[t].state === 'done';
  const stubOf = (list: TechId[], solid: boolean): Stub | null => {
    if (!list.length) return null;
    list.sort((a, b) => v.cards[a].era - v.cards[b].era || ORDER.get(a)! - ORDER.get(b)!);
    const eras = [...new Set(list.map((t) => v.cards[t].era as Era))];
    const target: Partial<Record<Era, TechId>> = {};
    for (const e of eras) {
      const inEra = list.filter((t) => v.cards[t].era === e);
      target[e] = inEra.find((t) => !done(t)) ?? inEra[0];
    }
    return { eras, target, techs: list, done: solid };
  };
  for (const c of cards) {
    if (!isVisible(c)) continue;
    const def = TECHS[c.tid];
    const off = (t: TechId) => isVisible(v.cards[t]) && v.cards[t].era !== era;
    const req = def.requires.filter(off);
    const any = (def.requiresAny ?? []).filter(off);
    const anyMet = (def.requiresAny ?? []).some((t) => isVisible(v.cards[t]) && done(t));
    const b = stubOf([...req, ...any], req.every(done) && (!any.length || anyMet));
    if (b) before.set(c.tid, b);
    const deps = (DEPENDENTS.get(c.tid) ?? []).filter(off);
    const a = stubOf(deps, deps.every(done));
    if (a) after.set(c.tid, a);
  }

  return { era, rows, items, brackets, width: Math.max(GEO.lw, ...rows.map((r) => r.width)), before, after };
}
