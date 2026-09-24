/** Research core — the single source of truth for tech visibility,
 *  availability, cost, the queue, the per-tick transfer, charters (eras),
 *  insights and previews (spec S1). game.ts actions, economy.ts, publish(),
 *  debug.ts and the tests all call these; nothing else computes them. */
import {
  DOCTRINES, ERA_GATES, ERA_NAMES, RETIRED_TECHS, TECHS, TECH_ORDER, techRelevance,
  type DoctrineId, type Era, type Expedition, type Lane, type TechDef, type TechId,
} from '../data/techs';
import { INSIGHTS, INSIGHT_BY_TECH } from '../data/insights';
import { BUILDINGS, BUILD_ORDER, type BuildingId } from '../data/buildings';
import { RESOURCES, type ResourceId } from '../data/resources';
import { SITES, type SiteId } from '../data/sites';
import { PROSPECTS, PROSPECT_IDS, type OutpostKind, type ProspectId } from '../data/lunarMap';
import {
  CHARTER_TECHS, CREW_ROTATION, ERA_COST_SCALE, INSIGHT_MAX, LAB_UPLINK_WEIGHTS, QUEUE_MAX,
  RESEARCH_RATE_EMA_S, RESEARCH_RATE_PER_DC, RESEARCH_RATE_PER_LAB,
} from '../data/balance';
import { fillStateDefaults, type BuildingState, type GameState } from './state';
import { computeMods, effectiveDef, effectiveRates, isAgentRun, modsFor, type Mods } from './mods';
import { alert, crewReserve, moraleWorkMult } from './economy';
import { KIND_LABEL, baseStream, outpostSlots, surveyCost } from './exploration';

export type TechState =
  | 'hidden' | 'done' | 'queued' | 'stalled' | 'foreclosed'
  | 'crewLocked' | 'eraLocked' | 'requires' | 'requiresAny' | 'full' | 'available';
export interface Availability { state: TechState; reason: string }
export interface ActionResult { ok: boolean; reason: string }
/** what techVisible needs — a live state, or a site/expedition pair for audits */
export interface TechCtx { siteId: SiteId; expedition: Expedition; discoveries?: readonly TechId[] }

const OK: ActionResult = { ok: true, reason: '' };
const nameOf = (t: TechId) => TECHS[t]?.name ?? t;
const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// ─────────────────────────── resolution & visibility ───────────────────────────

const robotCache: Partial<Record<TechId, TechDef>> = {};
/** Merges the robotic override (era, costData) on robotic runs. */
export function resolveTech(def: TechDef, exp: Expedition): TechDef {
  if (exp !== 'robotic' || !def.robotic) return def;
  let r = robotCache[def.id];
  if (!r) {
    r = { ...def, era: def.robotic.era ?? def.era, costData: def.robotic.costData ?? def.costData };
    robotCache[def.id] = r;
  }
  return r;
}
const R = (tid: TechId, exp: Expedition) => resolveTech(TECHS[tid], exp);

export function techVisible(def: TechDef, ctx: TechCtx): boolean {
  if (def.sites && !def.sites.includes(ctx.siteId)) return false;
  if (def.expeditions && !def.expeditions.includes(ctx.expedition)) return false;
  if (def.breakthrough && !(ctx.discoveries ?? []).includes(def.id)) return false;
  return true;
}

function hiddenReason(def: TechDef, ctx: TechCtx): string {
  if (def.sites && !def.sites.includes(ctx.siteId)) {
    return `${def.sites.map((id) => titleCase(SITES[id].name)).join(' / ')} only`;
  }
  if (def.expeditions && !def.expeditions.includes(ctx.expedition)) {
    return def.expeditions.includes('robotic') ? 'robotic expeditions only' : 'crewed expeditions only';
  }
  return '✦ undiscovered — survey an anomaly to reveal it';
}

/** Visible members of a doctrine group at this site (a lone member is no doctrine). */
export function doctrineMembersHere(group: DoctrineId, ctx: TechCtx): TechId[] {
  return DOCTRINES[group].members.filter((m) => techVisible(TECHS[m], ctx));
}
export function isDoctrineHere(def: TechDef, ctx: TechCtx): boolean {
  return !!def.exclusive && doctrineMembersHere(def.exclusive, ctx).length >= 2;
}

function rival(def: TechDef, s: GameState, queue: readonly TechId[] = s.researchQueue):
{ tid: TechId; state: 'done' | 'queued' } | null {
  if (!def.exclusive || !isDoctrineHere(def, s)) return null;
  const others = DOCTRINES[def.exclusive].members.filter((m) => m !== def.id && techVisible(TECHS[m], s));
  for (const m of others) if (s.techsDone.includes(m)) return { tid: m, state: 'done' };
  for (const m of others) if (queue.includes(m)) return { tid: m, state: 'queued' };
  return null;
}

const crewLocked = (def: TechDef, s: GameState) =>
  !!def.crewTech && s.expedition === 'robotic' && !s.techsDone.includes('humanCohabitation');

/** visible requiresAny members; hidden ones never count */
const anyVisible = (def: TechDef, ctx: TechCtx) =>
  (def.requiresAny ?? []).filter((r) => techVisible(TECHS[r], ctx));

// ─────────────────────────── cost ───────────────────────────

export interface TechCost {
  /** data after the era scale and any insight */
  data: number;
  /** data before the insight */
  base: number;
  goods: Partial<Record<ResourceId, number>>;
  discount: number;
  /** the deed that earned the discount ('' if none) */
  insightLabel: string;
}

export function techCost(tid: TechId, s: Pick<GameState, 'expedition' | 'insights'>): TechCost {
  const def = R(tid, s.expedition);
  const scaled = def.costData * ERA_COST_SCALE[def.era];
  const discount = Math.min(INSIGHT_MAX, s.insights?.[tid] ?? 0);
  return {
    data: Math.round(scaled * (1 - discount)),
    base: Math.round(scaled),
    goods: { ...(def.costGoods ?? {}) },
    discount,
    insightLabel: discount > 0 ? INSIGHT_BY_TECH[tid]?.hint ?? '' : '',
  };
}

/** `reserve`: the crew's life-support share of it, which goods never take */
export interface GoodsShort { res: ResourceId; need: number; have: number; reserve: number }
/** Goods a tech cannot take yet: oxygen, water and food count only above the
 *  crew's reserve (economy step 4's rule: the crew drinks first). */
export function goodsShortfall(goods: Partial<Record<ResourceId, number>>, s: GameState, mods: Mods): GoodsShort[] {
  const out: GoodsShort[] = [];
  for (const [r, amt] of Object.entries(goods)) {
    const res = r as ResourceId;
    const have = s.resources[res] ?? 0;
    const reserve = crewReserve(s, mods, res);
    if (have - reserve < (amt ?? 0)) out.push({ res, need: amt ?? 0, have, reserve });
  }
  return out;
}

export type Producer = { kind: 'building'; id: BuildingId } | { kind: 'outpost'; id: OutpostKind };

/** What makes a resource here under these mods (WAITING and HELD lines): the
 *  building whose effective recipe outputs it — one already unlocked first,
 *  then the biggest — never an Ice Harvester without ice; else, once there is
 *  an outpost slot, the outpost kind streaming the most of it from a prospect
 *  in coverage; null when nothing here can make it. */
export function producerOf(res: ResourceId, s: GameState, mods: Mods): Producer | null {
  const out = (b: BuildingId) => effectiveDef(b, mods).outputs[res] ?? 0;
  const makers = BUILD_ORDER
    .filter((b) => out(b) > 0 && !(BUILDINGS[b].requiresIce && !SITES[s.siteId].hasIce))
    .sort((a, b) => Number(mods.unlocked.has(b)) - Number(mods.unlocked.has(a)) || out(b) - out(a));
  if (makers.length) return { kind: 'building', id: makers[0] };
  if (outpostSlots(mods, s) <= 0) return null;
  let best: OutpostKind | null = null;
  let rate = 0;
  for (const pid of PROSPECT_IDS) {
    const kind = PROSPECTS[pid].kind;
    if (kind === 'heritage' || kind === 'anomaly' || surveyCost(s.siteId, pid).tier > mods.surveyTier) continue;
    const r = baseStream(pid).res[res] ?? 0;
    if (r > rate) { rate = r; best = kind; }
  }
  return best ? { kind: 'outpost', id: best } : null;
}

/** `Chip Fab`, `ice outpost` */
export function producerName(p: Producer): string {
  return p.kind === 'building' ? BUILDINGS[p.id].name : `${KIND_LABEL[p.id]} outpost`;
}
const article = (name: string) => `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;
/** ` · build Hydroponics Farm`, ` · claim an ice outpost`, or ` · nothing here makes water yet` */
export function producerHint(res: ResourceId, s: GameState, mods: Mods): string {
  const p = producerOf(res, s, mods);
  if (!p) return ` · nothing here makes ${RESOURCES[res].name.toLowerCase()} yet`;
  return p.kind === 'building' ? ` · build ${producerName(p)}` : ` · claim ${article(producerName(p))}`;
}

/** `10▣ chips (have 3) · made by Chip Fab`; life support names the crew's
 *  reserve: `80≈ water (have 90, 12 held for the crew) · made by Ice Harvester` */
export function shortfallText(tid: TechId, s: GameState, mods: Mods = modsFor(s)): string {
  const short = goodsShortfall(techCost(tid, s).goods, s, mods);
  if (!short.length) return '';
  const parts = short.map((g) =>
    `${g.need}${RESOURCES[g.res].glyph} ${RESOURCES[g.res].name.toLowerCase()} (have ${Math.floor(g.have)}` +
    `${g.reserve > 0 ? `, ${Math.ceil(g.reserve)} held for the crew` : ''})`);
  const makers: string[] = [];
  const none: string[] = [];
  for (const g of short) {
    const p = producerOf(g.res, s, mods);
    const name = p ? (p.kind === 'building' ? producerName(p) : article(producerName(p))) : '';
    if (!p) none.push(RESOURCES[g.res].name.toLowerCase());
    else if (!makers.includes(name)) makers.push(name);
  }
  return `${parts.join(', ')}${makers.length ? ` · made by ${makers.join(', ')}` : ''}` +
    `${none.length ? ` · nothing here makes ${none.join(' or ')} yet` : ''}`;
}

// ─────────────────────────── availability ───────────────────────────

/** First matching rule wins: hidden → done → queued/stalled → foreclosed →
 *  crewLocked → eraLocked → requires → requiresAny → full → available.
 *  Missing goods never block queueing. */
export function techAvailability(tid: TechId, s: GameState, mods?: Mods): Availability {
  const raw = TECHS[tid];
  if (!raw) return { state: 'hidden', reason: 'retired tech' };
  const def = resolveTech(raw, s.expedition);
  if (!techVisible(def, s)) return { state: 'hidden', reason: hiddenReason(def, s) };
  if (s.techsDone.includes(tid)) return { state: 'done', reason: 'researched' };
  const qi = s.researchQueue.indexOf(tid);
  if (qi >= 0) {
    return s.researchStalled.includes(tid)
      ? { state: 'stalled', reason: `waiting: ${shortfallText(tid, s, mods)}` }
      : { state: 'queued', reason: `queued #${qi + 1}` };
  }
  const rv = rival(def, s);
  if (rv) {
    return {
      state: 'foreclosed',
      reason: rv.state === 'done'
        ? `foreclosed — you chose ${nameOf(rv.tid)}`
        : `foreclosed while ${nameOf(rv.tid)} is queued — cancel it to reopen`,
    };
  }
  if (crewLocked(def, s)) return { state: 'crewLocked', reason: 'needs Human Cohabitation (Era 6)' };
  if (def.era > s.era) return { state: 'eraLocked', reason: `opens with Era ${def.era}` };
  const missing = def.requires.filter((r) => !s.techsDone.includes(r) && !s.researchQueue.includes(r));
  if (missing.length) return { state: 'requires', reason: `needs ${missing.map(nameOf).join(', ')}` };
  const any = anyVisible(def, s);
  if (any.length && !any.some((r) => s.techsDone.includes(r) || s.researchQueue.includes(r))) {
    return { state: 'requiresAny', reason: `needs ${any.map(nameOf).join(' OR ')}` };
  }
  if (s.researchQueue.length >= QUEUE_MAX) {
    return { state: 'full', reason: `queue full (${s.researchQueue.length}/${QUEUE_MAX})` };
  }
  return { state: 'available', reason: '' };
}

function gateHint(era: Era, s: GameState): string {
  const g = ERA_GATES[era];
  if (!g) return '';
  const cohab = g.roboticRequires && s.expedition === 'robotic' ? ` (+ ${nameOf(g.roboticRequires)})` : '';
  return `Era ${era} opens with ${CHARTER_TECHS} Era-${era - 1} techs, or 1 + ${g.deed}${cohab}`;
}

/** The alert for a rejected enqueue: what is wrong and how to fix it. */
function rejectText(tid: TechId, a: Availability, s: GameState): string {
  const n = nameOf(tid);
  switch (a.state) {
    case 'hidden': return `NOT AVAILABLE HERE — ${n}: ${a.reason}`;
    case 'done': return `ALREADY RESEARCHED — ${n}`;
    case 'queued': case 'stalled': return `ALREADY QUEUED — ${n} is #${s.researchQueue.indexOf(tid) + 1}`;
    case 'foreclosed': return `FORECLOSED — ${n} ${a.reason.replace(/^foreclosed /, '')}`;
    case 'crewLocked': return `CREW TECH — ${n} needs Human Cohabitation (Era 6) first`;
    case 'eraLocked': {
      const era = R(tid, s.expedition).era;
      return `ERA LOCKED — ${n} opens with Era ${era} · ${gateHint(era, s)}`;
    }
    case 'requires': case 'requiresAny':
      return `NEEDS PREREQUISITE — ${n} ${a.reason} · Shift-click queues the whole path`;
    case 'full': return `QUEUE FULL (${s.researchQueue.length}/${QUEUE_MAX}) — cancel one first`;
    case 'available': return '';
  }
}

// ─────────────────────────── queue verbs ───────────────────────────

export function enqueue(s: GameState, tid: TechId): ActionResult {
  const a = techAvailability(tid, s);
  if (a.state !== 'available') return { ok: false, reason: rejectText(tid, a, s) };
  s.researchQueue.push(tid);
  return OK;
}

/** Queue the prerequisite closure too, in topological order (resolved era,
 *  then TECH_ORDER). An OR-group uses a done/queued member, else the cheapest
 *  visible non-foreclosed one; it never makes a doctrine choice for the player. */
export function enqueuePath(s: GameState, tid: TechId): ActionResult {
  const head = techAvailability(tid, s);
  if (['hidden', 'done', 'queued', 'stalled', 'foreclosed', 'crewLocked', 'eraLocked'].includes(head.state)) {
    return { ok: false, reason: rejectText(tid, head, s) };
  }
  const picked = new Set<TechId>();
  const have = (t: TechId) => s.techsDone.includes(t) || s.researchQueue.includes(t) || picked.has(t);
  const undecided = (t: TechId) => {
    const d = TECHS[t];
    if (!d.exclusive || !isDoctrineHere(d, s)) return false;
    return !DOCTRINES[d.exclusive].members.some((m) => have(m));
  };
  const doctrineMsg = (t: TechId) => {
    const members = doctrineMembersHere(TECHS[t].exclusive!, s);
    return `PATH NEEDS A DOCTRINE — choose ${members.map(nameOf).join(' or ')} first`;
  };
  const visit = (t: TechId): string => {
    if (have(t)) return '';
    const def = R(t, s.expedition);
    const a = techAvailability(t, s);
    if (a.state === 'hidden') return `CANNOT QUEUE PATH — ${nameOf(t)}: ${a.reason}`;
    if (a.state === 'foreclosed') return `CANNOT QUEUE PATH — ${nameOf(t)} is ${a.reason}`;
    if (a.state === 'crewLocked' || a.state === 'eraLocked') return rejectText(t, a, s);
    if (t !== tid && undecided(t)) return doctrineMsg(t);
    for (const r of def.requires) {
      const e = visit(r);
      if (e) return e;
    }
    const any = anyVisible(def, s);
    if (any.length && !any.some(have)) {
      const open = any.filter((m) => !['hidden', 'foreclosed'].includes(techAvailability(m, s).state));
      const free = open.filter((m) => !undecided(m));
      if (!free.length) {
        return open.length ? doctrineMsg(open[0]) : `CANNOT QUEUE PATH — ${nameOf(t)} needs ${any.map(nameOf).join(' OR ')}`;
      }
      free.sort((x, y) => techCost(x, s).data - techCost(y, s).data || TECH_ORDER.indexOf(x) - TECH_ORDER.indexOf(y));
      const e = visit(free[0]);
      if (e) return e;
    }
    picked.add(t);
    return '';
  };
  const err = visit(tid);
  if (err) return { ok: false, reason: err };
  const order = [...picked].sort((x, y) =>
    R(x, s.expedition).era - R(y, s.expedition).era || TECH_ORDER.indexOf(x) - TECH_ORDER.indexOf(y));
  const room = QUEUE_MAX - s.researchQueue.length;
  if (order.length > room) return { ok: false, reason: `QUEUE FULL — ${Math.max(0, room)} of ${order.length} fit` };
  s.researchQueue.push(...order);
  return OK;
}

/** Cancel is transitive: sanitizeQueue drops dependents (each alerts). Banked data is kept. */
export function cancel(s: GameState, tid: TechId): ActionResult {
  const i = s.researchQueue.indexOf(tid);
  if (i < 0) return { ok: false, reason: `NOT QUEUED — ${nameOf(tid)}` };
  s.researchQueue.splice(i, 1);
  s.researchStalled = s.researchStalled.filter((t) => t !== tid);
  sanitizeQueue(s);
  return OK;
}

/** Move one step up (−1) or down (+1); refused if it would break a prerequisite. */
export function moveInQueue(s: GameState, tid: TechId, delta: -1 | 1): ActionResult {
  const q = s.researchQueue;
  const i = q.indexOf(tid);
  if (i < 0) return { ok: false, reason: `NOT QUEUED — ${nameOf(tid)}` };
  const j = i + delta;
  if (j < 0 || j >= q.length) return { ok: false, reason: `CANNOT MOVE — ${nameOf(tid)} is already ${delta < 0 ? 'first' : 'last'}` };
  const next = q.slice();
  [next[i], next[j]] = [next[j], next[i]];
  const up = next[Math.min(i, j)], down = next[Math.max(i, j)];
  if (dropReason(R(up, s.expedition), s, next.slice(0, Math.min(i, j)))) {
    return { ok: false, reason: `CANNOT MOVE — ${nameOf(up)} needs ${nameOf(down)} first` };
  }
  s.researchQueue = next;
  sanitizeQueue(s);
  return OK;
}

function dropReason(def: TechDef, s: GameState, earlier: readonly TechId[]): string {
  if (!techVisible(def, s)) return 'is not available here';
  const rv = rival(def, s, earlier);
  if (rv) return rv.state === 'done' ? `— you chose ${nameOf(rv.tid)}` : `is foreclosed by ${nameOf(rv.tid)}`;
  if (crewLocked(def, s)) return 'needs Human Cohabitation';
  if (def.era > s.era) return `opens with Era ${def.era}`;
  const ok = (r: TechId) => s.techsDone.includes(r) || earlier.includes(r);
  const missing = def.requires.filter((r) => !ok(r));
  if (missing.length) return `needs ${missing.map(nameOf).join(', ')}`;
  const any = anyVisible(def, s);
  if (any.length && !any.some(ok)) return `needs ${any.map(nameOf).join(' OR ')}`;
  return '';
}

/** Keeps item i only if its requires / any-of are done or earlier, it is visible,
 *  not foreclosed, not crew-locked, and its resolved era ≤ s.era. Each drop
 *  alerts; banked researchSpent is kept. Returns the dropped ids. */
export function sanitizeQueue(s: GameState): TechId[] {
  const dropped: TechId[] = [];
  let queue = s.researchQueue;
  for (;;) {
    const kept: TechId[] = [];
    let changed = false;
    for (const tid of queue) {
      // retired, already done (debug completeTech) or duplicated: nothing to tell
      if (!TECHS[tid] || s.techsDone.includes(tid) || kept.includes(tid)) { changed = true; continue; }
      const def = R(tid, s.expedition);
      const why = dropReason(def, s, kept);
      if (why) {
        changed = true;
        dropped.push(tid);
        alert(s, `RESEARCH DROPPED — ${def.name} ${why}`, 'warn');
        continue;
      }
      kept.push(tid);
    }
    queue = kept;
    if (!changed) break;
  }
  s.researchQueue = queue;
  s.researchStalled = s.researchStalled.filter((t) => queue.includes(t));
  return dropped;
}

// ─────────────────────────── rates & the tick ───────────────────────────

/** E(n)/n: every active agent-run lab gets the same share of the DSN link. */
export function uplinkShare(agentLabs: number): number {
  if (agentLabs <= 0) return 1;
  let e = 0;
  for (let i = 0; i < agentLabs; i++) e += LAB_UPLINK_WEIGHTS[Math.min(i, LAB_UPLINK_WEIGHTS.length - 1)];
  return e / agentLabs;
}

export interface ResearchRates {
  /** data/s generated by active labs and Data Centers */
  production: number;
  /** max data/s transferred from the bank into the queue */
  cap: number;
  labsActive: number;
  agentLabs: number;
  uplinkShare: number;
  dcsActive: number;
}

export function researchRates(s: GameState, mods: Mods): ResearchRates {
  let labsActive = 0, agentLabs = 0, dcsActive = 0;
  for (const b of s.buildings) {
    if (!b.active) continue;
    if (b.type === 'lab') { labsActive++; if (isAgentRun(b, s)) agentLabs++; }
    else if (b.type === 'dataCenter') dcsActive++;
  }
  const share = uplinkShare(agentLabs);
  const site = SITES[s.siteId];
  const workMult = s.expedition === 'robotic' && s.crew <= 0 ? 1 : moraleWorkMult(s.morale);
  let production = 0;
  for (const b of s.buildings) {
    if (!b.active || (b.type !== 'lab' && b.type !== 'dataCenter')) continue;
    production += effectiveRates(b.type, mods, site, b, {
      agentRun: isAgentRun(b, s), robotic: s.expedition === 'robotic', workMult, uplinkShare: share,
    }).data;
  }
  return {
    production,
    cap: RESEARCH_RATE_PER_LAB * labsActive + RESEARCH_RATE_PER_DC * dcsActive,
    labsActive, agentLabs, uplinkShare: share, dcsActive,
  };
}

/** Side effects of finishing a tech (crew rotation for robotic Cohabitation). */
export function onTechComplete(s: GameState, tid: TechId) {
  if (tid === 'humanCohabitation' && s.expedition === 'robotic' && !s.crewRotation && s.crew <= 0) {
    s.crewRotation = { at: s.simTime + CREW_ROTATION.delayS, count: CREW_ROTATION.count };
  }
}

function completeTech(s: GameState, tid: TechId, cost: TechCost) {
  const overshoot = (s.researchSpent[tid] ?? 0) - cost.data;
  if (overshoot > 0) s.data += overshoot; // a mid-research insight never wastes banked data
  s.researchQueue = s.researchQueue.filter((t) => t !== tid);
  delete s.researchSpent[tid];
  if (!s.techsDone.includes(tid)) s.techsDone.push(tid);
  alert(s, `RESEARCH COMPLETE — ${nameOf(tid)}`, 'info');
  onTechComplete(s, tid);
}

export interface ResearchTickResult { modsChanged: boolean; completed: TechId[] }

/** Economy step 9. Pass 1: fully paid items try their goods (complete, or
 *  join researchStalled). Pass 2: min(bank, cap·dt) flows down the queue,
 *  skipping paid items and spilling the remainder onward. */
export function researchTick(s: GameState, mods: Mods, dt: number): ResearchTickResult {
  sanitizeQueue(s);
  const rates = researchRates(s, mods);
  const completed: TechId[] = [];

  const stalled: TechId[] = [];
  for (const tid of [...s.researchQueue]) {
    const cost = techCost(tid, s);
    if ((s.researchSpent[tid] ?? 0) + 1e-9 < cost.data) continue;
    if (goodsShortfall(cost.goods, s, mods).length === 0) {
      for (const [r, amt] of Object.entries(cost.goods)) s.resources[r as ResourceId] -= amt ?? 0;
      completeTech(s, tid, cost);
      completed.push(tid);
    } else {
      stalled.push(tid);
    }
  }
  for (const tid of stalled) {
    if (!s.researchStalled.includes(tid)) {
      alert(s, `RESEARCH WAITING — ${nameOf(tid)} needs ${shortfallText(tid, s, mods)}`, 'warn');
    }
  }
  s.researchStalled = stalled;

  let budget = Math.min(s.data, rates.cap * dt);
  let moved = 0;
  let wantsData = false;
  for (const tid of s.researchQueue) {
    const need = techCost(tid, s).data - (s.researchSpent[tid] ?? 0);
    if (need <= 0) continue;
    wantsData = true;
    if (budget <= 0) break;
    const x = Math.min(budget, need);
    s.researchSpent[tid] = (s.researchSpent[tid] ?? 0) + x;
    s.data -= x;
    budget -= x;
    moved += x;
  }

  let paused: GameState['researchPaused'] = '';
  if (wantsData && rates.cap <= 0) {
    const stations = s.buildings.filter((b) =>
      (b.type === 'lab' || b.type === 'dataCenter') && b.enabled && (b.construction ?? 0) <= 0);
    paused = stations.length && stations.every((b) => b.idleReason === 'power') ? 'brownout' : 'noLab';
  }
  if (paused && paused !== s.researchPaused) {
    alert(s, paused === 'brownout'
      ? 'RESEARCH PAUSED — labs browned out'
      : 'RESEARCH PAUSED — no operating lab or Data Center', 'warn');
  }
  s.researchPaused = paused;

  s.researchRateAvg += (moved / dt - s.researchRateAvg) * Math.min(1, dt / RESEARCH_RATE_EMA_S);
  return { modsChanged: completed.length > 0, completed };
}

/** Insights: checked each tick after researchTick; they fire even while the tech is locked. */
export function insightTick(s: GameState): TechId[] {
  const fired: TechId[] = [];
  for (const ins of INSIGHTS) {
    const def = TECHS[ins.tech];
    if (s.techsDone.includes(ins.tech)) continue;
    if (!techVisible(def, s)) continue;
    const d = Math.min(INSIGHT_MAX, ins.discount);
    if ((s.insights[ins.tech] ?? 0) >= d || !ins.check(s)) continue;
    s.insights[ins.tech] = d;
    alert(s, `INSIGHT — ${def.name} ${Math.round(d * 100)}% cheaper: ${ins.lesson}`, 'info');
    fired.push(ins.tech);
  }
  return fired;
}

// ─────────────────────────── charters ───────────────────────────

export interface GateProgress {
  /** the era this gate opens */
  era: Era;
  /** visible done techs whose resolved era is era − 1 */
  techs: number;
  techsNeed: number;
  deed: string;
  deedValue: number;
  deedNeed: number;
  deedMet: boolean;
  /** robotic Era 7: Human Cohabitation, on either route */
  requires: { tech: TechId; done: boolean } | null;
  open: boolean;
  via: 'techs' | 'deed' | null;
}

export function gateProgress(s: GameState, era: Era): GateProgress {
  const gate = ERA_GATES[era];
  if (!gate) {
    return {
      era, techs: 0, techsNeed: 0, deed: '', deedValue: 0, deedNeed: 0, deedMet: true,
      requires: null, open: true, via: 'techs',
    };
  }
  let techs = 0;
  for (const tid of s.techsDone) {
    if (!TECHS[tid]) continue;
    const def = R(tid, s.expedition);
    if (def.era === era - 1 && techVisible(def, s)) techs++;
  }
  const deedValue = gate.value(s);
  const deedMet = deedValue >= gate.need;
  const requires = gate.roboticRequires && s.expedition === 'robotic'
    ? { tech: gate.roboticRequires, done: s.techsDone.includes(gate.roboticRequires) } : null;
  const via = techs >= CHARTER_TECHS ? 'techs' : techs >= 1 && deedMet ? 'deed' : null;
  return {
    era, techs, techsNeed: CHARTER_TECHS, deed: gate.deed, deedValue, deedNeed: gate.need, deedMet,
    requires, open: via !== null && (!requires || requires.done), via,
  };
}

/** The highest era reachable from the stored one, gate by gate (eras open in
 *  sequence and never close, so this is never below s.era). */
export function computeEra(s: GameState): Era {
  let era = Math.min(8, Math.max(1, s.era ?? 1)) as Era;
  while (era < 8 && gateProgress(s, (era + 1) as Era).open) era = (era + 1) as Era;
  return era;
}

/** Economy step 11: s.era = max(s.era, computeEra(s)), alerting each era opened. */
export function eraTick(s: GameState): Era[] {
  const target = computeEra(s);
  const opened: Era[] = [];
  while (s.era < target) {
    s.era += 1;
    const g = gateProgress(s, s.era as Era);
    const via = g.via === 'deed' ? `1 tech + ${g.deed}` : `${g.techs} techs`;
    alert(s, `ERA ${s.era} OPENS — ${ERA_NAMES[s.era]} · via ${via}`, 'info');
    opened.push(s.era as Era);
  }
  return opened;
}

// ─────────────────────────── previews & audits ───────────────────────────

export interface PreviewLine {
  type: BuildingId;
  count: number;
  /** `Your 2 Data Centers: draw −21 kW` */
  text: string;
  /** signed deltas summed over the buildings of this type */
  dKW: number;
  dOut: Partial<Record<ResourceId, number>>;
  dIn: Partial<Record<ResourceId, number>>;
  dData: number;
  dUpkeep: number;
  dBots: number;
}

const plural = (name: string, n: number) =>
  n === 1 ? name : /[^aeiou]y$/.test(name) ? `${name.slice(0, -1)}ies` : `${name}s`;
const fmtD = (v: number, digits = 2) => `${v > 0 ? '+' : '−'}${Number(Math.abs(v).toFixed(digits))}`;

/** Diffs computeMods with and without the tech over the buildings that exist. */
export function previewTech(tid: TechId, s: GameState): PreviewLine[] {
  if (!TECHS[tid] || s.techsDone.includes(tid)) return [];
  const outposts = s.survey?.outposts ?? [];
  const a = computeMods(s.techsDone, s.expedition, s.siteId, outposts);
  const b = computeMods([...s.techsDone, tid], s.expedition, s.siteId, outposts);
  const site = SITES[s.siteId];
  const robotic = s.expedition === 'robotic';
  const workMult = robotic && s.crew <= 0 ? 1 : moraleWorkMult(s.morale);
  const share = researchRates(s, a).uplinkShare;
  const byType = new Map<BuildingId, BuildingState[]>();
  for (const bs of s.buildings) {
    if (!byType.has(bs.type)) byType.set(bs.type, []);
    byType.get(bs.type)!.push(bs);
  }
  const lines: PreviewLine[] = [];
  for (const type of ['lander', ...BUILD_ORDER] as BuildingId[]) {
    const list = byType.get(type);
    if (!list?.length) continue;
    const line: PreviewLine = { type, count: list.length, text: '', dKW: 0, dOut: {}, dIn: {}, dData: 0, dUpkeep: 0, dBots: 0 };
    for (const inst of list) {
      const opts = { agentRun: isAgentRun(inst, s), robotic, workMult, uplinkShare: share, feed: s.feed };
      const ra = effectiveRates(type, a, site, inst, opts);
      const rb = effectiveRates(type, b, site, inst, opts);
      line.dKW += rb.powerKW - ra.powerKW;
      line.dData += rb.data - ra.data;
      line.dUpkeep += rb.upkeepPartsPerDay - ra.upkeepPartsPerDay;
      for (const r of new Set([...Object.keys(ra.outputs), ...Object.keys(rb.outputs)]) as Set<ResourceId>) {
        line.dOut[r] = (line.dOut[r] ?? 0) + (rb.outputs[r] ?? 0) - (ra.outputs[r] ?? 0);
      }
      for (const r of new Set([...Object.keys(ra.inputs), ...Object.keys(rb.inputs)]) as Set<ResourceId>) {
        line.dIn[r] = (line.dIn[r] ?? 0) + (rb.inputs[r] ?? 0) - (ra.inputs[r] ?? 0);
      }
    }
    if (type === 'roboticsBay') line.dBots = (b.botPerBay - a.botPerBay) * list.length;
    const parts: string[] = [];
    for (const [r, v] of Object.entries(line.dOut)) {
      if (Math.abs(v ?? 0) > 1e-6) parts.push(`${fmtD(v!)}${RESOURCES[r as ResourceId].glyph}/s`);
    }
    for (const [r, v] of Object.entries(line.dIn)) {
      if (Math.abs(v ?? 0) > 1e-6) parts.push(`inputs ${fmtD(v!)}${RESOURCES[r as ResourceId].glyph}/s`);
    }
    if (Math.abs(line.dData) > 1e-6) parts.push(`${fmtD(line.dData)}≡/s`);
    if (Math.abs(line.dKW) > 1e-6) {
      const generator = BUILDINGS[type].powerKW > 0;
      parts.push(generator ? `${fmtD(line.dKW, 1)} kW` : `draw ${fmtD(-line.dKW, 1)} kW`);
    }
    if (Math.abs(line.dUpkeep) > 1e-6) parts.push(`upkeep ${fmtD(line.dUpkeep)}⚙/day`);
    if (line.dBots) parts.push(`${fmtD(line.dBots, 0)} robots`);
    if (!parts.length) continue;
    line.text = `Your ${list.length} ${plural(BUILDINGS[type].name, list.length)}: ${parts.join(' · ')}`;
    lines.push(line);
  }
  return lines;
}

/** Visible techs at a site × expedition that fail the techRelevance invariant (should be none). */
export function irrelevantVisibleTechs(siteId: SiteId, expedition: Expedition): TechId[] {
  return TECH_ORDER.filter((t) => {
    const def = resolveTech(TECHS[t], expedition);
    const ctx: TechCtx = { siteId, expedition, discoveries: TECH_ORDER };
    return techVisible(def, ctx) && !techRelevance(def, siteId, expedition);
  });
}

/** Techs that belong to other landing sites (the tree footer). */
export function otherSiteTechs(siteId: SiteId): TechId[] {
  return TECH_ORDER.filter((t) => TECHS[t].sites && !TECHS[t].sites!.includes(siteId));
}

// ─────────────────────────── the $research view ───────────────────────────

export interface ResearchCard {
  tid: TechId;
  state: TechState;
  reason: string;
  era: Era;
  lane: Lane | null;
  name: string;
  short: string;
  cost: TechCost;
  spent: number;
  /** 0..1 of the data cost */
  pct: number;
  /** seconds at researchRateAvg (queued: cumulative down the queue); null when no transfer */
  eta: number | null;
  /** stalled only: `10▣ chips (have 3) · made by Chip Fab` */
  stalledNeed: string;
  insight: { discount: number; hint: string; earned: boolean } | null;
  /** set only where the doctrine really is a choice (≥2 visible members) */
  doctrine: DoctrineId | null;
  breakthrough: { slot: 1 | 2; hosts: ProspectId[] } | null;
  siteTech: boolean;
}
export interface ResearchQueueItem { tid: TechId; pct: number; eta: number | null; stalled: boolean; need: string }
export interface ResearchView {
  era: number;
  /** gates for eras 2..8 */
  gates: GateProgress[];
  cards: Record<TechId, ResearchCard>;
  queue: ResearchQueueItem[];
  queueMax: number;
  /** researchRateAvg (actual transfer, /s) */
  rate: number;
  cap: number;
  production: number;
  bank: number;
  paused: '' | 'noLab' | 'brownout';
  labsActive: number;
  agentLabs: number;
  uplinkShare: number;
  dcsActive: number;
  otherSites: TechId[];
}

export function researchView(s: GameState, mods: Mods): ResearchView {
  const rates = researchRates(s, mods);
  const rate = s.researchRateAvg;
  const etaOf = (remaining: number) => (remaining <= 0 ? 0 : rate > 1e-6 ? remaining / rate : null);
  const queueEta = new Map<TechId, number | null>();
  let cum = 0;
  for (const tid of s.researchQueue) {
    cum += Math.max(0, techCost(tid, s).data - (s.researchSpent[tid] ?? 0));
    queueEta.set(tid, etaOf(cum));
  }
  const cards = {} as Record<TechId, ResearchCard>;
  for (const tid of TECH_ORDER) {
    const def = R(tid, s.expedition);
    const av = techAvailability(tid, s, mods);
    const cost = techCost(tid, s);
    const spent = s.researchSpent[tid] ?? 0;
    const ins = INSIGHT_BY_TECH[tid];
    cards[tid] = {
      tid, state: av.state, reason: av.reason, era: def.era, lane: def.lane ?? null,
      name: def.name, short: def.short, cost, spent,
      pct: av.state === 'done' ? 1 : cost.data > 0 ? Math.min(1, spent / cost.data) : 1,
      eta: av.state === 'done' ? 0 : queueEta.has(tid) ? queueEta.get(tid)! : etaOf(cost.data - spent),
      stalledNeed: av.state === 'stalled' ? shortfallText(tid, s, mods) : '',
      insight: ins ? { discount: ins.discount, hint: ins.hint, earned: (s.insights[tid] ?? 0) > 0 } : null,
      doctrine: isDoctrineHere(def, s) ? def.exclusive! : null,
      breakthrough: def.breakthrough ? { slot: def.breakthrough.slot, hosts: [...def.breakthrough.hosts] } : null,
      siteTech: !!def.sites,
    };
  }
  const gates: GateProgress[] = [];
  for (let e = 2; e <= 8; e++) gates.push(gateProgress(s, e as Era));
  return {
    era: s.era,
    gates,
    cards,
    queue: s.researchQueue.map((tid) => ({
      tid,
      pct: cards[tid].pct,
      eta: queueEta.get(tid) ?? null,
      stalled: s.researchStalled.includes(tid),
      need: s.researchStalled.includes(tid) ? shortfallText(tid, s, mods) : '',
    })),
    queueMax: QUEUE_MAX,
    rate,
    cap: rates.cap,
    production: rates.production,
    bank: s.data,
    paused: s.researchPaused,
    labsActive: rates.labsActive,
    agentLabs: rates.agentLabs,
    uplinkShare: rates.uplinkShare,
    dcsActive: rates.dcsActive,
    otherSites: otherSiteTechs(s.siteId),
  };
}

// ─────────────────────────── save migration ───────────────────────────

/** techSchema 1 → 2 (spec §8): retired ids dropped and refunded, doctrine
 *  conflicts grandfathered, hidden-at-site techs kept, the queue sanitized,
 *  the era never lowered. Deposit re-stamping (rule 7) needs the heightfield
 *  and is done by the caller. */
export function migrateTechSchema(s: GameState): { refund: number; retired: string[] } {
  fillStateDefaults(s);
  if ((s.techSchema ?? 1) >= 2) return { refund: 0, retired: [] };
  const spentMap = s.researchSpent as Record<string, number | undefined>;
  const doneList = s.techsDone as string[];
  const queued = s.researchQueue as string[];
  let refund = 0;
  const retired: string[] = [];
  for (const [id, bonus] of Object.entries(RETIRED_TECHS)) {
    const spent = spentMap[id] ?? 0;
    const wasDone = doneList.includes(id);
    if (!spent && !wasDone && !queued.includes(id)) continue;
    refund += spent + (wasDone ? bonus : 0);
    delete spentMap[id];
    retired.push(id);
  }
  s.techsDone = [...new Set(doneList.filter((t) => t in TECHS))] as TechId[];
  s.researchQueue = queued.filter((t) => t in TECHS) as TechId[];
  s.data += refund;
  s.techSchema = 2;
  sanitizeQueue(s);
  s.era = Math.max(s.era ?? 1, computeEra(s));
  if (refund > 0) {
    alert(s, `RESEARCH TREE UPDATED — ${retired.length} retired tech${retired.length === 1 ? '' : 's'} refunded ${Math.round(refund)}≡`, 'info');
  }
  return { refund, retired };
}
