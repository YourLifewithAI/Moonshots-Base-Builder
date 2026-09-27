/** The preview and the highlight (docs/17 §5.2, §6; Phase 5): placement shows
 *  its strategy. Pure: no Three.js, no DOM, and it never changes the sim.
 *
 *  - **The highlight** (`hubLight`). While a hub is placed (its ghost), while
 *    one is selected, or while its palette card is up (hover, or the touch
 *    info card), the deposits that hub wants light up: each with its trip
 *    one way from the hub's door, its faces working, the pit already cut and
 *    the full-size pit ring. Out of reach, full, exhausted and boxed-in read
 *    by weight and pattern (world/depositHighlight.ts, the Lunar Map), never
 *    by colour alone. A smelter's glass and KREEP show dimmer, with what they
 *    do for it. The hub's plain pit lights too — or, for a ghost with nothing
 *    wanted in reach, the plain pit it would stake.
 *  - **The ghost's HUB block** (`ghostBlock`). Under today's one HUB line
 *    (core/hubs.ts `hubGhostLine`, kept as its headline): the route to where
 *    its units would dig, the units that would fill it, the full-size pit
 *    against its walls, the next choice, the plain-pit stake, the MRE note,
 *    and the water plant's NO ICE IN REACH warning.
 *  - **The ring warning** (`pitWayWarning`). Any structure whose pit
 *    setback (12 m from its walls) reaches into a deposit's full-size pit
 *    ring, or a plain pit's three-lunar-day ring, stops that pit there: IN
 *    THE PIT'S WAY, asked once (the first click asks, the second builds).
 *
 *  **Time.** A deposit a road reaches reads the road: the ghost's spur (or
 *  the hub's door), the open network to the deposit's nearest gate, then off
 *  road to the face. One no road reaches reads the estimate core/hubs.ts
 *  gives it — 1.3 × the straight line to its rim, then off-road — marked ≈.
 *
 *  **Phase 4's numbers** (reserves left, grade, survey precision, faces at
 *  full size, life) come through `reservesOf`, which answers null today:
 *  every line and label that shows them renders only when they are present. */
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { HUB, HUB_DEFS, HUB_TYPES } from '../data/hubs';
import { ROAD } from '../data/roads';
import { CELL_M, FEED, MAP_M, PIT } from '../data/balance';
import { RESOURCES } from '../data/resources';
import { DEPOSIT_INFO, emptyFeed, type DepositKind } from '../data/deposits';
import type { SiteDef } from '../data/sites';
import type { BuildingState, GameState, PitState } from './state';
import { effectiveDef, smelterFeed, type Mods } from './mods';
import {
  PIT_WALL_M, choicesFor, depKey, facePoint, facesUsed, groundQ, heightsOf, hubHunger, hubUnit, plainKey,
  proposePlainPit, standPoint, targetOf, unitName, unitRates, unitSpec, unitSpeed, unitsOf, wayIn,
  type Target, type TripEst,
} from './hubs';
import { pitOf, looseLayer } from './pits';
import { cellCentre, cellKey, doorCell, hasRoads, joinCell, keyCell, planSpur, roadDistances, type SpurPlan } from './roads';
import { pitRadius } from '../terrain/pitCarve';
import { footprintRect } from '../buildings/instances';
import { fmtClock } from './daynight';

type Pt = [number, number];
const G = RESOURCES.regolith.glyph;

// ───────────────────────────── Phase 4's hooks ─────────────────────────────

/** What a survey and the grade model know about a deposit or a pit
 *  (docs/17 §10, §13). Every field is optional: Phase 4 fills what it has. */
export interface Reserves {
  /** ▲ of ore still in the ground, and what the deposit held at first */
  left?: number;
  total?: number;
  /** ± share of the estimate: 0.3 a first survey, 0.15, 0.05 */
  precision?: number;
  /** the grade q of the cut now, and at the centre */
  cutQ?: number;
  centreQ?: number;
  /** faces at full size (today's faces are a fixed count) */
  facesFull?: number;
  /** the full-size pit's rim radius, m (else the plan ring stands in: `fullRadius`) */
  fullR?: number;
  /** lunar days of ore left at the current dig */
  lifeDays?: number;
}

/** Phase 4 hook: a deposit's (`dep:<id>`) or plain pit's (`plain:<id>`)
 *  reserves, grade and survey precision. Null: not known (today, always). */
export function reservesOf(_s: GameState, _key: string): Reserves | null {
  return null;
}

// ───────────────────────────── shapes ─────────────────────────────

/** The middle of the loose layer a pit at this deposit (or plain ground) widens at. */
function looseMid(s: GameState, kind: DepositKind | null): number {
  const [a, b] = kind === 'anorthosite' ? PIT.looseHighland : kind === 'ice' ? PIT.looseIce
    : kind === 'volatiles' ? PIT.looseVolatiles : kind ? PIT.looseMare
    : s.siteId === 'southpole' ? PIT.looseHighland : PIT.looseMare;
  return (a + b) / 2;
}

/** The ring a pit is planned to reach (core/pits.ts planRadius: a deposit's
 *  ring × 1.3, where its ore halo ends; a plain pit's three lunar days of
 *  digging). Phase 4's survey may name it (`Reserves.fullR`). */
export function fullRadius(s: GameState, key: string, kind: DepositKind | null, r: number, pit?: PitState | null): number {
  const res = reservesOf(s, key);
  if (res?.fullR) return res.fullR;
  const L = pit ? looseLayer(s, pit) : looseMid(s, kind);
  return Math.max(pitRadius(PIT.planM3, L), kind ? r * 1.3 : 0);
}

// ───────────────────────────── the highlight ─────────────────────────────

export type LitTier = 'lit' | 'dim';
/** open: not dug · pit: dug, a face free · far: out of reach · full: every face working ·
 *  exhausted · boxed: it cannot widen · plain: a plain pit · stake: the plain pit a ghost would stake */
export type LitState = 'open' | 'pit' | 'far' | 'full' | 'exhausted' | 'boxed' | 'plain' | 'stake';

export interface LitEntry {
  /** the deposit's id ('ilmenite-0'); a plain pit's key ('plain:3'); 'stake' */
  id: string;
  key: string;
  kind: DepositKind | null;
  glyph: string;
  name: string;
  /** its ring (a deposit's, a plain pit's zone), world m */
  cx: number; cz: number; r: number;
  tier: LitTier;
  state: LitState;
  /** one way from the hub's door, s (null: no hub stands anywhere yet — its palette card) */
  eta: number | null;
  /** the estimate (no road reaches it yet): ≈ */
  approx: boolean;
  inReach: boolean;
  /** road m and off-road m of the trip */
  roadM: number; offM: number;
  faces: number;
  used: number;
  /** the pit already cut (null: not dug yet) */
  pit: { cx: number; cz: number; R: number; deep: number; heap: { x: number; z: number; Rh: number } | null } | null;
  /** the full-size pit's rim radius about the ring's centre, m */
  fullR: number;
  /** its feed factor for this hub (Phase 4's grade q stands in) */
  q: number;
  /** ▲/s one unit would deliver from it */
  rate: number;
  /** min(units × rate, hunger) × q: the auto choice's score */
  score: number;
  /** a dimmer kind's note ('O₂ +60%'); '' otherwise */
  note: string;
  /** Phase 4's numbers, when present */
  reserves: Reserves | null;
  /** where its units would go (the best in reach with a free face) */
  best: boolean;
  /** the marker's label (glyph apart) */
  label: string;
}

export interface HubLight {
  type: BuildingId;
  source: 'ghost' | 'selected' | 'card';
  /** the hub (selected), else null */
  hubId: number | null;
  /** its door (ghost, selected), world m */
  door: Pt | null;
  reachS: number;
  mre: boolean;
  entries: LitEntry[];
  /** what changes the drawing (not the labels): the renderers rebuild on it */
  sig: string;
  /** what changes the labels */
  labelSig: string;
}

export type LightSource =
  | { kind: 'ghost'; type: BuildingId; gx: number; gz: number; rot: 0 | 1 | 2 | 3 }
  | { kind: 'selected'; id: number }
  | { kind: 'card'; type: BuildingId };

const stubOf = (type: BuildingId, gx: number, gz: number, rot: 0 | 1 | 2 | 3): BuildingState => ({
  id: -1, type, gx, gz, rot, enabled: true, automated: true, priority: 2, wear: 0, dust: 0,
  construction: 0, buildTotal: 0, active: true, idleReason: '',
} as BuildingState);

/** The smelter's dimmer kinds (§6.1): what glass and KREEP do for it. */
function dimNotes(mods: Mods, type: BuildingId): Partial<Record<DepositKind, string>> {
  if (type !== 'smelter') return {};
  const g = emptyFeed();
  g.glass = 1;
  const o2 = smelterFeed(mods, g).o2;
  return {
    glass: `O₂ +${Math.round((o2 - 1) * 100)}%`,
    kreep: `reactor make-up at ${Math.round(FEED.kreepReactorShare * 100)}%`,
  };
}

/** One way from a ghost's door to face 0 of `t`: by its spur and the open
 *  network to the target's nearest gate, then off-road; with no gate, or no
 *  road to it, the estimate (§6.1's ≈). */
function ghostTrip(s: GameState, mods: Mods, site: SiteDef, stub: BuildingState, spur: SpurPlan | null, t: Target): TripEst {
  const v = unitSpeed(mods, hubUnit(stub.type, site));
  const offW = 1 / (ROAD.offroad * mods.haulOffroadMult);
  const from = standPoint(stub);
  const face = facePoint(s, t, 0);
  const wi = wayIn(s, t);
  const inner: Pt[] = wi.via.length ? [...wi.via, face] : [face];
  const door = doorCell(stub);
  if (wi.area?.gates.length && door && spur && !spur.reason && hasRoads(s)) {
    // where its road joins the open network: beside the spur's first cell, or its door already on it
    let join: number | null = null;
    let extra = 0;
    if (spur.cells.length) {
      const j = joinCell(s, spur.cells[0]);
      if (j) { join = cellKey(j[0], j[1]); extra = spur.cells.length; }
    } else join = cellKey(door[0], door[1]);
    if (join !== null) {
      let best: { n: number; g: [number, number] } | null = null;
      for (const g of wi.area.gates) {
        const n = roadDistances(s, g).get(join);
        if (n !== undefined && (!best || n < best.n)) best = { n, g };
      }
      if (best) {
        const roadM = (best.n + extra) * CELL_M;
        const [gx, gz] = cellCentre(best.g[0], best.g[1]);
        let offM = Math.hypot(inner[0][0] - gx, inner[0][1] - gz);
        for (let i = 1; i < inner.length; i++) offM += Math.hypot(inner[i][0] - inner[i - 1][0], inner[i][1] - inner[i - 1][1]);
        return { t: (roadM + offM * offW) / v, roadM, offM, connected: true };
      }
    }
  }
  return estimateTrip(v, offW, from, t);
}

/** core/hubs.ts tripTo's estimate for a target no road reaches. */
function estimateTrip(v: number, offW: number, from: Pt, t: Pick<Target, 'cx' | 'cz' | 'r' | 'plain'>): TripEst {
  const d = Math.hypot(t.cx - from[0], t.cz - from[1]);
  const rim = Math.max(0, d - t.r);
  const offM = t.plain ? HUB.plainR - HUB.plainFaceR : t.r * (1 - HUB.faceR);
  return { t: (rim * 1.3 + offM * offW) / v, roadM: rim * 1.3, offM, connected: false };
}

const kFmt = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);
const pm = (p?: number) => (p ? ` (±${Math.round(p * 100)}%)` : '');
export const etaText = (e: Pick<LitEntry, 'eta' | 'approx'>) => (e.eta === null ? '' : `${e.approx ? '≈' : ''}${fmtClock(e.eta)}`);

/** A lit marker's words (§6.1), the glyph apart: `0:15 · 1/3 faces · pit 18 m`. */
function labelOf(e: LitEntry, reachS: number): string {
  if (e.tier === 'dim') return e.note;
  const eta = etaText(e);
  const faces = `${e.used}/${e.faces}`;
  const ore = e.reserves?.left !== undefined ? `${kFmt(e.reserves.left)}${G}` : '';
  switch (e.state) {
    case 'far': return `> ${fmtClock(reachS)}`;
    case 'full': return [`FULL ${faces}`, eta].filter(Boolean).join(' · ');
    case 'exhausted': return 'EXHAUSTED';
    case 'boxed': return 'BOXED IN';
    case 'plain': return [e.name.replace('plain pit ', ''), `q ${e.q.toFixed(2)}`, faces, eta].filter(Boolean).join(' · ');
    case 'stake': return ['plain pit here', `q ${e.q.toFixed(2)}`, eta].filter(Boolean).join(' · ');
    default:
      return [eta, `${faces} faces`, ore, e.pit ? `pit ${Math.round(e.pit.R)} m` : ''].filter(Boolean).join(' · ');
  }
}

function pitView(p: PitState | null): LitEntry['pit'] {
  if (!p) return null;
  return { cx: p.cx, cz: p.cz, R: p.R, deep: p.deep, heap: p.heap && p.heap.Rh > 0 ? { x: p.heap.x, z: p.heap.z, Rh: p.heap.Rh } : null };
}

/** The highlight for a hub type from a source: its wanted deposits (lit), a
 *  smelter's glass and KREEP (dim), its plain pit, and for a ghost with
 *  nothing wanted in reach, the plain pit it would stake. Null: not a hub. */
export function hubLight(s: GameState, mods: Mods, site: SiteDef, src: LightSource, stake?: Pt | null): HubLight | null {
  const b = src.kind === 'selected' ? s.buildings.find((x) => x.id === src.id) : undefined;
  const type = src.kind === 'selected' ? b?.type : src.type;
  if (!type) return null;
  const def = HUB_DEFS[type];
  if (!def) return null;
  const wants = new Set(def.wants(site));
  const notes = dimNotes(mods, type);
  const unit = hubUnit(type, site);
  const mre = type === 'smelter' && !!effectiveDef('smelter', mods).feedInsensitive;
  const stub = src.kind === 'ghost' ? stubOf(type, src.gx, src.gz, src.rot) : b ?? null;
  const hunger = stub ? hubHunger(mods, site, stub) : 0;
  const hf = heightsOf(s);
  const spur = src.kind === 'ghost' && hf && stub ? planSpur(s, hf, stub) : null;
  const door = stub ? standPoint(stub) : null;
  const entries: LitEntry[] = [];
  // a selected hub: the sim's own choice list (its trips memoised on the network)
  const chosen = new Map<string, { trip: TripEst; rate: number; q: number; score: number }>();
  if (b) {
    const n = Math.max(1, unitsOf(s, b.id).filter((u) => !u.pinned).length);
    for (const c of choicesFor(s, mods, site, b, n)) chosen.set(c.target.key, c);
  }
  const specs = new Map<string, ReturnType<typeof unitSpec>>();
  const specFor = (kind: DepositKind | undefined) => {
    const k = kind ?? '';
    let sp = specs.get(k);
    if (!sp) { sp = unitSpec(mods, unit, unitRates(s, mods, site, { type: unit, wear: 0 }, kind)); specs.set(k, sp); }
    return sp;
  };
  const measure = (t: Target) => {
    const c = chosen.get(t.key);
    if (c) return c;
    if (!stub) return null;
    const trip = src.kind === 'ghost' ? ghostTrip(s, mods, site, stub, spur, t)
      : estimateTrip(unitSpeed(mods, unit), 1 / (ROAD.offroad * mods.haulOffroadMult), standPoint(stub), t);
    const sp = specFor(t.kind);
    const rate = sp.bucket / (sp.digS + sp.unloadS + 2 * trip.t);
    const q = groundQ(mods, site, type, t.kind);
    return { trip, rate, q, score: Math.min(rate, hunger) * q };
  };
  const push = (t: Target, tier: LitTier, state0: LitState | null, id: string) => {
    const m = tier === 'lit' ? measure(t) : null;
    const pit = pitOf(s, t.key);
    const used = facesUsed(s, t.key);
    const eta = m ? m.trip.t : null;
    const inReach = eta === null || eta <= HUB.reachS;
    const state: LitState = state0 ?? (pit?.state === 'exhausted' ? 'exhausted' : pit?.state === 'boxed' ? 'boxed'
      : !inReach ? 'far' : used >= t.faces ? 'full' : pit ? 'pit' : 'open');
    const kind = t.kind ?? null;
    const e: LitEntry = {
      id, key: t.key, kind, glyph: kind ? DEPOSIT_INFO[kind].glyph : '▭', name: t.name,
      cx: t.cx, cz: t.cz, r: t.r, tier, state, eta, approx: !!m && !m.trip.connected, inReach,
      roadM: m?.trip.roadM ?? 0, offM: m?.trip.offM ?? 0,
      faces: t.faces, used, pit: pitView(pit), fullR: fullRadius(s, t.key, kind, t.r, pit),
      q: m?.q ?? groundQ(mods, site, type, t.kind), rate: m?.rate ?? 0, score: m?.score ?? 0,
      note: tier === 'dim' && kind ? notes[kind] ?? '' : '', reserves: reservesOf(s, t.key), best: false, label: '',
    };
    entries.push(e);
  };
  for (const z of s.zones ?? []) {
    if (z.kind === 'plain' || z.kind === 'pit') continue;
    const tier: LitTier | null = wants.has(z.kind) ? 'lit' : notes[z.kind] ? 'dim' : null;
    if (!tier) continue;
    const t = targetOf(s, depKey(z.id));
    if (t) push(t, tier, null, z.id);
  }
  // its plain pit (a selected hub's; any pit its units work lights too, through their targets)
  const plainId = b?.hub?.plainPit;
  if (plainId !== undefined && def.plain(site)) {
    const t = targetOf(s, plainKey(plainId));
    if (t) push(t, 'lit', 'plain', t.key);
  }
  if (b) {
    for (const u of unitsOf(s, b.id)) {
      if (!u.target || entries.some((e) => e.key === u.target)) continue;
      const t = targetOf(s, u.target);
      if (t) push(t, 'lit', t.plain ? 'plain' : null, t.plain ? t.key : t.key.slice(4));
    }
  }
  // the plain pit a ghost would stake
  if (stake && stub && src.kind === 'ghost') {
    const t: Target = { key: 'stake', kind: undefined, name: 'plain pit', cx: stake[0], cz: stake[1], r: HUB.plainR, zone: null, faces: HUB.plainFaces, plain: true };
    push(t, 'lit', 'stake', 'stake');
  }
  // where its units would go: the best in reach with a free face
  let best: LitEntry | null = null;
  for (const e of entries) {
    if (e.tier !== 'lit' || !e.inReach || e.used >= e.faces || e.state === 'exhausted' || e.eta === null) continue;
    if (!best || e.score > best.score + 1e-9 || (Math.abs(e.score - best.score) <= 1e-9 && (e.eta ?? 0) < (best.eta ?? 0))) best = e;
  }
  if (best) best.best = true;
  for (const e of entries) e.label = labelOf(e, HUB.reachS);
  const sig = `${type}|${src.kind}|` + entries.map((e) =>
    `${e.id}:${e.tier}:${e.state}:${e.best ? 1 : 0}:${e.pit ? `${Math.round(e.pit.R * 2)},${Math.round(e.pit.cx)},${Math.round(e.pit.cz)},${Math.round((e.pit.heap?.Rh ?? 0) * 2)}` : '-'}:${Math.round(e.fullR)}:${Math.round(e.cx)},${Math.round(e.cz)}`).join(';');
  return {
    type, source: src.kind, hubId: b?.id ?? null, door, reachS: HUB.reachS, mre, entries, sig,
    labelSig: entries.map((e) => `${e.id}=${e.label}`).join('|'),
  };
}

// ───────────────────────────── the ghost's HUB block ─────────────────────────────

export interface GhostBlock {
  /** the HUB line (Phases 1–2's, kept): where its units would dig, how far, what a unit brings */
  headline: string;
  /** under the headline, in order */
  lines: string[];
  /** a warning the first click asks about ('' none): NO ICE IN REACH */
  warn: string;
  /** the plain pit it would stake (world m), or null */
  stake: Pt | null;
  light: HubLight | null;
}

/** Would a hub placed here stake a plain pit? As Game.hubPlaced decides it:
 *  no wanted deposit in reach by the estimate (the ghost's road is not open
 *  when it lands), and its units may dig plain ground. Then where: the spot
 *  core/hubs.ts proposes once the hub and its spur stand. */
function stakeFor(s: GameState, mods: Mods, site: SiteDef, stub: BuildingState, spur: SpurPlan | null): Pt | null {
  const def = HUB_DEFS[stub.type]!;
  if (!def.plain(site)) return null;
  const wants = new Set(def.wants(site));
  const v = unitSpeed(mods, hubUnit(stub.type, site));
  const offW = 1 / (ROAD.offroad * mods.haulOffroadMult);
  const from = standPoint(stub);
  for (const z of s.zones ?? []) {
    if (z.kind === 'plain' || z.kind === 'pit' || !wants.has(z.kind)) continue;
    if (estimateTrip(v, offW, from, { cx: z.cx, cz: z.cz, r: z.r, plain: false }).t <= HUB.reachS) return null;
  }
  // stand the ghost and its spur up for the proposal, then take them away again
  const bs = s.buildings, rs = s.roads;
  try {
    s.buildings = [...bs, stub];
    if (rs && spur) {
      const add = [...spur.fresh.map((k) => ({ k, bay: false })), ...spur.bays.map((k) => ({ k, bay: true }))];
      if (add.length) s.roads = [...rs, ...add.map(({ k, bay }) => { const [gx, gz] = keyCell(k); return { gx, gz, left: ROAD.cellS, ...(bay ? { bay: true } : {}) }; })];
    }
    return proposePlainPit(s, mods, site, stub);
  } finally {
    s.buildings = bs;
    s.roads = rs;
  }
}

const NO_BLOCK: GhostBlock = { headline: '', lines: [], warn: '', stake: null, light: null };
let blockMemo: { key: string; out: GhostBlock } = { key: '', out: NO_BLOCK };

/** The HUB block under a hub ghost's headline (§5.2). Memoised on the spot,
 *  the network, the zones, the pits and the game-second (the ghost asks
 *  every frame; its cell changes a few times a second). */
export function ghostBlock(s: GameState, mods: Mods, site: SiteDef, g: { type: BuildingId; gx: number; gz: number; rot: 0 | 1 | 2 | 3 }): GhostBlock {
  if (!HUB_DEFS[g.type]) return NO_BLOCK;
  const pits = (s.pits ?? []).map((p) => `${p.id}${p.state[0]}${Math.round(p.R)}`).join(',');
  const key = `${g.type},${g.gx},${g.gz},${g.rot}|${s.siteId}|${s.roadRev ?? 0},${s.roads?.length ?? 0}|${s.zones?.length ?? 0}|${s.buildings.length},${s.nextBuildingId}|${pits}|${s.haulers.length}|${Math.floor(s.simTime)}|${mods.haulSpeedMult},${mods.haulOffroadMult}`;
  if (key === blockMemo.key) return blockMemo.out;
  const out = buildBlock(s, mods, site, g);
  blockMemo = { key, out };
  return out;
}

function buildBlock(s: GameState, mods: Mods, site: SiteDef, g: { type: BuildingId; gx: number; gz: number; rot: 0 | 1 | 2 | 3 }): GhostBlock {
  const def = HUB_DEFS[g.type]!;
  const stub = stubOf(g.type, g.gx, g.gz, g.rot);
  const hf = heightsOf(s);
  const spur = hf ? planSpur(s, hf, stub) : null;
  const stake = stakeFor(s, mods, site, stub, spur);
  const light = hubLight(s, mods, site, { kind: 'ghost', ...g }, stake);
  const lines: string[] = [];
  let warn = '';
  if (!light) return { ...NO_BLOCK, stake };
  const unit = unitName(hubUnit(g.type, site)).toLowerCase();
  const hunger = hubHunger(mods, site, stub);
  const bays = HUB.bays[0] + mods.hubBays;
  const lit = light.entries.filter((e) => e.tier === 'lit' && e.state !== 'stake');
  const best = light.entries.find((e) => e.best) ?? null;
  const wanted = def.wants(site).map((k) => DEPOSIT_INFO[k].name).join(' or ');
  // the headline (Phases 1–2's words): the best in reach, else the best in reach even if full
  const head = best && best.state !== 'stake' ? best
    : lit.filter((e) => e.inReach && e.eta !== null && e.state !== 'exhausted').sort((a, b) => b.score - a.score)[0] ?? null;
  let headline: string;
  if (head) {
    const feed = Math.abs(head.q - 1) > 0.005 ? ` · feed ×${head.q.toFixed(2)}` : '';
    headline = `HUB — its ${unit}s dig ${head.name}, ~${Math.round(head.eta!)} s one way · ~${head.rate.toFixed(2)}${G}/s a unit; it burns ${hunger.toFixed(1)}${G}/s${feed}`;
  } else {
    headline = def.plain(site)
      ? `HUB — no ${wanted} within ${HUB.reachS} s one way: it stakes a plain pit by its door`
      : `HUB — no ${wanted} within ${HUB.reachS} s one way: its ${unit}s would stand idle`;
  }
  if (best && best.state !== 'stake') {
    // the route, the faces, and what the survey knows (Phase 4)
    const road = best.approx
      ? `≈${Math.round(best.roadM)} m (no road there yet) + ${Math.round(best.offM)} m off-road`
      : `${Math.round(best.roadM)} m by road + ${Math.round(best.offM)} m off-road`;
    const res = best.reserves;
    const faces = res?.facesFull !== undefined ? `faces ${best.faces} now, ${res.facesFull} at full size` : `faces ${best.used}/${best.faces} working`;
    const ore = res?.left !== undefined ? ` · ore ~${kFmt(res.left)}${G}${pm(res.precision)}` : '';
    const grade = res?.cutQ !== undefined ? ` · cut q ${res.cutQ.toFixed(2)}${res.centreQ !== undefined ? `, centre q ${res.centreQ.toFixed(2)}` : ''}` : '';
    lines.push(`${best.glyph} ${best.name} · ${road} · trip ${etaText(best)} · ${faces}${ore}${grade}${best.pit ? ` · its pit R ${Math.round(best.pit.R)} m` : ''}`);
    // is one unit enough? how many would fill it
    const need = best.rate > 0 ? hunger / best.rate : Infinity;
    const fill = need <= 1 ? 'one unit keeps it fed'
      : need <= bays ? `${Math.ceil(need - 1e-6)} units keep it fed — it comes with one; its ${bays} bays hold ${bays}`
      : `${need.toFixed(1)} units would keep it fed, but its ${bays} bays hold ${bays}: it will run starved here`;
    const life = res?.lifeDays !== undefined ? ` · ~${res.lifeDays.toFixed(1)} lunar days of ore at ${hunger.toFixed(1)}${G}/s` : '';
    lines.push(`a ${unit} brings ~${best.rate.toFixed(2)}${G}/s of the ${hunger.toFixed(1)}${G}/s it burns: ${fill}${life}`);
    // the full-size pit against its walls: clear, or in its way (the warning is placement's)
    const rect = rectOf(stub);
    const gap = distToRect(best.cx, best.cz, rect) - best.fullR - PIT_WALL_M;
    lines.push(gap >= 0
      ? `the full-size pit (R ${Math.round(best.fullR)} m) keeps ${Math.round(gap)} m clear of its setback`
      : `the full-size pit (R ${Math.round(best.fullR)} m) reaches its ${PIT_WALL_M} m setback: here it stops at its wall`);
    // full, or the next choice
    const full = lit.filter((e) => e.state === 'full' && e.inReach).sort((a, b) => (a.eta ?? 0) - (b.eta ?? 0))[0];
    if (full && full.score > best.score) {
      lines.push(`${full.name} is full (${full.used}/${full.faces} faces) — its units would go to ${best.name}, ${etaText(best)}`);
    } else {
      const next = lit.filter((e) => e !== best && e.inReach && e.used < e.faces && e.state !== 'exhausted')
        .sort((a, b) => b.score - a.score)[0];
      if (next) lines.push(`then ${next.glyph} ${next.name}, ${etaText(next)} one way`);
    }
  }
  const staked = light.entries.find((e) => e.state === 'stake');
  if (staked) {
    const door = light.door!;
    const m = Math.round(Math.hypot(staked.cx - door[0], staked.cz - door[1]));
    const q = staked.q;
    const qWord = q < 0.95 ? ` — about ${q < 0.7 ? 'half' : 'two-thirds'} the output, more hole` : '';
    lines.push(`no ${wanted} in reach: its ${unit} opens a plain pit here, ${m} m from its door (the dashed ring) · q ${q.toFixed(2)}${qWord}`);
  } else if (!best && def.plain(site)) {
    lines.push(`no ${wanted} in reach, and no room for a plain pit 20–60 m from its door: Open pit… once it stands`);
  }
  if (light.mre) lines.push('MRE melts any soil: a plain pit serves it as well as a deposit');
  // a water plant on the ice with no cold trap in reach: a warning, asked once
  if (!def.plain(site) && !best) {
    const ice = lit.filter((e) => e.eta !== null).sort((a, b) => (a.eta ?? 0) - (b.eta ?? 0))[0];
    warn = ice
      ? `NO ICE IN REACH — the nearest mapped cold trap is ${etaText(ice)} away (reach ${fmtClock(HUB.reachS)}); map further or build nearer`
      : 'NO ICE IN REACH — no cold trap is mapped yet; map further (Prospecting Rovers, a Relay Mast) or build nearer';
  }
  return { headline, lines, warn, stake, light };
}

/** The ghost's HUB line ('' for a type that is not a hub): the block's headline. */
export function hubGhostLine(s: GameState, mods: Mods, site: SiteDef, g: { type: BuildingId; gx: number; gz: number; rot: 0 | 1 | 2 | 3 }): string {
  return ghostBlock(s, mods, site, g).headline;
}

// ───────────────────────────── IN THE PIT'S WAY (§5.2, §11.3) ─────────────────────────────

interface Rect { x0: number; z0: number; x1: number; z1: number }
const rectOf = (b: Pick<BuildingState, 'type' | 'gx' | 'gz' | 'rot'>): Rect => {
  const r = footprintRect(b);
  const h = MAP_M / 2;
  return { x0: r.gx0 * CELL_M - h, x1: r.gx1 * CELL_M - h, z0: r.gz0 * CELL_M - h, z1: r.gz1 * CELL_M - h };
};
function distToRect(x: number, z: number, r: Rect): number {
  const dx = Math.max(r.x0 - x, 0, x - r.x1), dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}

/** The kinds some hub at this site digs: a deposit of any other kind is nobody's pit. */
function dugKinds(site: SiteDef): Set<DepositKind> {
  const out = new Set<DepositKind>();
  for (const t of HUB_TYPES) for (const k of HUB_DEFS[t]!.wants(site)) out.add(k);
  return out;
}

/** A structure here would stop a pit short (the pits keep 12 m from walls):
 *  the share of a deposit's ore inside its full-size ring (weighted by the
 *  ore halo, heaviest at the centre) — or of a plain pit's three-lunar-day
 *  ground — that its setback covers. The worst one, or null. */
export function pitWay(s: GameState, site: SiteDef, b: Pick<BuildingState, 'type' | 'gx' | 'gz' | 'rot'>): { name: string; fullR: number; share: number } | null {
  if (BUILDINGS[b.type].unit) return null;
  const rect = rectOf(b);
  const pad = PIT_WALL_M;
  const kinds = dugKinds(site);
  let worst: { name: string; fullR: number; share: number } | null = null;
  const consider = (key: string, name: string, kind: DepositKind | null, cx: number, cz: number, r: number) => {
    const pit = pitOf(s, key);
    if (pit?.state === 'exhausted') return;
    const fullR = fullRadius(s, key, kind, r, pit);
    if (distToRect(cx, cz, rect) >= fullR + pad) return;
    // sample the full-size disc on a 2 m grid: the ore halo weighs a deposit's centre most
    let all = 0, hit = 0;
    const step = 2;
    for (let z = -fullR; z <= fullR; z += step) {
      for (let x = -fullR; x <= fullR; x += step) {
        const rr = Math.hypot(x, z);
        if (rr > fullR) continue;
        const w = kind ? Math.max(0, 1 - (rr / fullR) ** 2) : 1;
        all += w;
        const px = cx + x, pz = cz + z;
        if (px > rect.x0 - pad && px < rect.x1 + pad && pz > rect.z0 - pad && pz < rect.z1 + pad) hit += w;
      }
    }
    const share = all > 0 ? hit / all : 0;
    if (share > 0.005 && (!worst || share > worst.share)) worst = { name, fullR, share };
  };
  for (const z of s.zones ?? []) {
    if (z.kind === 'pit') continue;
    if (z.kind === 'plain') {
      const p = s.plainPits.find((q) => plainKey(q.id) === z.id);
      if (p) consider(z.id, `plain pit P${p.id}`, null, p.x, p.z, HUB.plainR);
      continue;
    }
    if (!kinds.has(z.kind)) continue;
    consider(depKey(z.id), `${DEPOSIT_INFO[z.kind].name} #${z.id.split('-').pop()}`, z.kind, z.cx, z.cz, z.r);
  }
  return worst;
}

/** The ring warning's words ('' none). */
export function pitWayWarning(s: GameState, site: SiteDef, b: Pick<BuildingState, 'type' | 'gx' | 'gz' | 'rot'>): string {
  const w = pitWay(s, site, b);
  if (!w) return '';
  const pct = w.share >= 0.95 ? 'nearly all' : w.share < 0.05 ? 'a little' : `~${Math.max(5, Math.round((w.share * 100) / 5) * 5)}%`;
  return `IN THE PIT'S WAY — ${w.name}'s pit will reach ${Math.round(w.fullR)} m from its centre; here it stops at your wall and ${pct} of its ore stays in the ground`;
}
