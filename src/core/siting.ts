/** Choosing a site (docs/13 §2.3): one pure chooser for orders and rules.
 *
 *  The base chooser picks by distance to the type's anchor only — no deposit
 *  preference, no haul-lane preference — on a checkerboard of candidates.
 *  Site Survey AI tests every cell, measures planned paths, prefers the
 *  deposit the intent wants and peaks of light for solar, keeps off ground
 *  reserved for other families, never crosses an excavator's haul lane, and
 *  may plan an excavator's dig site. Both keep every door apron clear, obey
 *  the player's vetoes, and validate the winner with the real checkPlacement.
 *  Ground placement would refuse on sight (a road, too rough, no road can
 *  reach it) is struck before the ranking, so the validation walks every
 *  pad that might pass, not a fixed window; a refusal counts the pads by
 *  reason. No randomness: the same state, terrain and mods give the same
 *  site; ties break on (score, gz, gx, rot). It knows only what the overlay
 *  shows. */
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { CELL_M, FEED, HAUL, MAP_CELLS, MAP_M, MAX_SLOPE_DELTA } from '../data/balance';
import type { SiteDef } from '../data/sites';
import type { ResourceId } from '../data/resources';
import { DEPOSIT_INFO, feedKindOf, type DepositKind } from '../data/deposits';
import type { Deposit, Heightfield } from '../terrain/heightfield';
import { checkPlacement } from '../buildings/placement';
import { ROAD } from '../data/roads';
import { roadMap, spurHopeless } from './roads';
import { centerOf, footprintRect } from '../buildings/instances';
import type { AutoRuleId } from '../data/automation';
import type { BuildingState, GameState } from './state';
import { effectiveDef, type Mods } from './mods';
import { depositRevealed, networkNodes } from './exploration';
import { dropFor, tripFor } from './haul';
import { digOutput, digSpotIn } from './fleetView';
import { pathLength, plan, segmentHits, wallSpot, worldRect, type Rect } from './paths';
import { flowBalance } from './flowBook';

export type Ground = Pick<Heightfield, 'depositAt' | 'maxDelta' | 'deposits' | 'sample'>;

/** A new road cell weighs this many metres of distance, over the first ROAD_PICKS valid pads. */
const ROAD_M = 1.5;
const ROAD_PICKS = 6;

/** Why open pads (clear of footprints and door aprons) were not taken, by
 *  reason: the words a refusal counts them in. */
const TALLY: [key: string, words: string][] = [
  ['rough', 'too rough'], ['road', 'on roads'], ['route', 'no road route'], ['lane', 'on haul lanes'],
  ['veto', 'vetoed'], ['tube', 'outside the lava tube'], ['other', 'refused'],
];

/** 'of 412 open pads: 229 too rough, 150 on roads, 33 no road route' (largest first) */
function tallyText(open: number, n: Record<string, number>, other: string): string {
  const parts = TALLY.filter(([k]) => (n[k] ?? 0) > 0)
    .sort((a, b) => n[b[0]] - n[a[0]] || TALLY.indexOf(a) - TALLY.indexOf(b))
    .map(([k, w]) => `${n[k]} ${k === 'other' && other ? `refused (${other})` : w}`);
  return open ? `of ${open} open pad${open === 1 ? '' : 's'}${parts.length ? `: ${parts.join(', ')}` : ''}` : 'no open pad';
}

export interface SiteQuery {
  type: BuildingId;
  /** the resource it is for, a building to stand like, the asking rule, the network's edge */
  intent: { res?: ResourceId; like?: number; rule?: AutoRuleId | 'order'; edge?: boolean };
  /** Site Survey AI */
  survey: boolean;
  /** 'gx,gz,rot' candidates the place action already refused (the next one is tried) */
  skip?: string[];
}

export interface SitePick {
  gx: number; gz: number; rot: 0 | 1 | 2 | 3;
  why: string;
  score: number;
  /** Site Survey AI: dig here once the excavator stands */
  dig?: { x: number; z: number };
}
export type SiteResult = SitePick | { refusal: string };

const DOORLESS = new Set<BuildingId>(['solar', 'battery', 'excavator', 'storageYard', 'relayMast', 'massDriver', 'iceHarvester']);
const label = (b: BuildingState) => `${BUILDINGS[b.type].name} #${b.id}`;
const isSite = (b: { construction?: number }) => (b.construction ?? 0) > 0;
const idx = (gx: number, gz: number) => gz * MAP_CELLS + gx;
const cellOf = (m: number) => Math.floor((m + MAP_M / 2) / CELL_M);

/** the door apron: the cell strip in front of a building's door side */
function apron(t: BuildingId, gx: number, gz: number, rot: number): [number, number, number, number] | null {
  if (DOORLESS.has(t)) return null;
  const r = footprintRect({ type: t, gx, gz, rot });
  switch (rot % 4) {
    case 0: return [r.gx0, r.gz1, r.gx1, r.gz1 + 1];      // door +z
    case 1: return [r.gx0 - 1, r.gz0, r.gx0, r.gz1];      // −x
    case 2: return [r.gx0, r.gz0 - 1, r.gx1, r.gz0];      // −z
    default: return [r.gx1, r.gz0, r.gx1 + 1, r.gz1];     // +x
  }
}

/** occupancy: 1 footprint, 2 door apron, 4 haul lane, 8 road (bits) */
function raster(s: GameState, mods: Mods, lanes: boolean): Uint8Array {
  const g = new Uint8Array(MAP_CELLS * MAP_CELLS);
  // nothing is built on a road cell (docs/15-roads.md), open or still sintering
  for (const k of roadMap(s).keys()) g[k] |= 8;
  const mark = (x0: number, z0: number, x1: number, z1: number, bit: number) => {
    for (let z = Math.max(0, z0); z < Math.min(MAP_CELLS, z1); z++) {
      for (let x = Math.max(0, x0); x < Math.min(MAP_CELLS, x1); x++) g[idx(x, z)] |= bit;
    }
  };
  for (const b of s.buildings) {
    const r = footprintRect(b);
    mark(r.gx0, r.gz0, r.gx1, r.gz1, 1);
    const a = apron(b.type, b.gx, b.gz, b.rot);
    if (a) mark(a[0], a[1], a[2], a[3], 2);
  }
  if (lanes) {
    for (const b of s.buildings) {
      const h = b.type === 'excavator' ? b.haul : undefined;
      if (!h || isSite(b)) continue;
      const drop = dropFor(s, mods, h.digX, h.digZ);
      if (!drop) continue;
      const p = wallSpot(worldRect(drop), h.digX, h.digZ, HAUL.unloadOut);
      // cells within the haul clearance of the dig → drop leg
      const x0 = cellOf(Math.min(h.digX, p.x) - 4), x1 = cellOf(Math.max(h.digX, p.x) + 4) + 1;
      const z0 = cellOf(Math.min(h.digZ, p.z) - 4), z1 = cellOf(Math.max(h.digZ, p.z) + 4) + 1;
      for (let z = Math.max(0, z0); z < Math.min(MAP_CELLS, z1); z++) {
        for (let x = Math.max(0, x0); x < Math.min(MAP_CELLS, x1); x++) {
          const cell: Rect = { id: -1, x0: x * CELL_M - MAP_M / 2, z0: z * CELL_M - MAP_M / 2, x1: (x + 1) * CELL_M - MAP_M / 2, z1: (z + 1) * CELL_M - MAP_M / 2 };
          if (segmentHits(h.digX, h.digZ, p.x, p.z, cell, HAUL.clear) !== null) g[idx(x, z)] |= 4;
        }
      }
    }
  }
  return g;
}

/** the kind of ground an excavator's feed wants here ('' = none: distance only) */
export function feedTarget(s: GameState, mods: Mods, res?: ResourceId): DepositKind | null {
  if (res === 'water' && (mods.recipe.excavator?.outputs?.water ?? 0) > 0) return 'volatiles';
  if (res === 'oxygen' && !effectiveDef('smelter', mods).feedInsensitive) return 'glass';
  const refineries = s.buildings.some((b) => b.type === 'refinery');
  if (refineries && flowBalance(s, 'silicon') < flowBalance(s, 'metals')) return 'anorthosite';
  if (effectiveDef('smelter', mods).feedInsensitive) return null;
  return 'ilmenite';
}

/** the feed value of digging a kind (the share of processor yield it adds) */
function feedGain(kind: DepositKind | undefined, target: DepositKind | null, mods: Mods): number {
  const k = feedKindOf(kind);
  if (!target || k !== target) return 0;
  if (k === 'ilmenite') return FEED.smelter.ilmenite * mods.feedBonus.ilmenite;
  if (k === 'anorthosite') return FEED.refinery.anorthosite * mods.feedBonus.anorthosite;
  if (k === 'glass') return FEED.smelterO2Glass * mods.feedBonus.glass;
  if (k === 'volatiles') return 1.5;
  return 0;
}

interface Anchor { pts: { x: number; z: number; name: string }[] }

const centroid = (bs: BuildingState[]): [number, number] => {
  if (!bs.length) return [0, 0];
  let x = 0, z = 0;
  for (const b of bs) { const [cx, cz] = centerOf(b); x += cx; z += cz; }
  return [x / bs.length, z / bs.length];
};

/** Where a type wants to stand (docs/13 §2.3 anchors). */
function anchorFor(s: GameState, mods: Mods, type: BuildingId, q: SiteQuery['intent']): Anchor {
  const lander = s.buildings.find((b) => b.type === 'lander');
  const at = (b: BuildingState) => { const [x, z] = centerOf(b); return { x, z, name: label(b) }; };
  const landerPt = lander ? at(lander) : { x: 0, z: 0, name: 'the Lander' };
  if (lander) landerPt.name = 'the Lander';
  const list = (types: BuildingId[]) => s.buildings.filter((b) => types.includes(b.type) && !isSite(b)).map(at);
  const like = q.like !== undefined ? s.buildings.find((b) => b.id === q.like) : undefined;
  if (like) return { pts: [at(like)] };
  const base = () => {
    const [x, z] = centroid(s.buildings.filter((b) => !isSite(b)));
    return { pts: [{ x, z, name: 'the base centre' }] };
  };
  switch (type) {
    case 'excavator': {
      const c = s.buildings.filter((b) => !isSite(b) && b.enabled && (effectiveDef(b.type, mods).inputs.regolith ?? 0) > 0).map(at);
      return { pts: c.length ? c : [landerPt] };
    }
    case 'iceHarvester': case 'battery': case 'habitat': return { pts: [landerPt] };
    case 'solar': return base();
    case 'smelter': case 'refinery': {
      const digs = s.buildings.filter((b) => b.type === 'excavator' && b.haul);
      if (!digs.length) return { pts: [landerPt] };
      let x = 0, z = 0;
      for (const b of digs) { x += b.haul!.digX; z += b.haul!.digZ; }
      return { pts: [{ x: x / digs.length, z: z / digs.length, name: 'the excavators’ dig sites' }] };
    }
    case 'partsFab': case 'chipFab': {
      const c = list(['smelter', 'refinery']);
      return { pts: c.length ? c : [landerPt] };
    }
    case 'storageYard': {
      const makers = q.res ? s.buildings.filter((b) => !isSite(b) && (effectiveDef(b.type, mods).outputs[q.res!] ?? 0) > 0) : [];
      if (!makers.length) return base();
      const [x, z] = centroid(makers);
      return { pts: [{ x, z, name: `the ${q.res} makers` }] };
    }
    case 'roboticsBay': {
      const sites = s.buildings.filter(isSite);
      if (!sites.length) return base();
      const [x, z] = centroid(sites);
      return { pts: [{ x, z, name: 'the sites under construction' }] };
    }
    case 'hydroponics': {
      const c = list(['habitat']);
      return { pts: c.length ? c : [landerPt] };
    }
    default: return base();
  }
}

/** the deposit kinds each family keeps for itself (others stay off them) */
function reservedFor(type: BuildingId, kind: DepositKind | undefined, target: DepositKind | null): boolean {
  if (!kind) return false;
  if (type === 'excavator') return kind === 'ice' || kind === 'ridge';
  if (type === 'iceHarvester') return kind !== 'ice';
  if (type === 'solar') return kind !== 'ridge' && (kind === 'ice' || feedKindOf(kind) !== 'plain' || kind === target);
  return kind === 'ice' || kind === 'ridge' || feedKindOf(kind) !== 'plain';
}

/** Pick a site for `q.type`, or say why there is none. */
export function chooseSite(
  s: GameState, mods: Mods, site: SiteDef, ground: Ground, q: SiteQuery,
): SiteResult {
  const type = q.type;
  const def = BUILDINGS[type];
  const tier = mods.surveyTier;
  const known = (d: Deposit | null) => (d && depositRevealed(s, d, tier) ? d : null);
  const grid = raster(s, mods, q.survey);
  const nodes = networkNodes(s);
  if (!nodes.length) return { refusal: 'no build network yet' };
  const rots: (0 | 1)[] = def.footprint[0] === def.footprint[1] ? [0] : [0, 1];
  const vetoes = s.auto.vetoes.filter((v) => v.until > s.simTime && (v.rule === q.intent.rule || v.rule === 'order' || !q.intent.rule));
  const anchor = anchorFor(s, mods, type, q.intent);
  const target = type === 'excavator' ? feedTarget(s, mods, q.intent.res) : null;
  const like = q.intent.like !== undefined ? s.buildings.find((b) => b.id === q.intent.like) : undefined;
  const likeKind = like?.type === 'excavator' ? like.haul?.pad ?? like.deposit : like?.deposit;

  // candidates: every origin whose footprint centre is inside a node's radius
  const seen = new Set<number>();
  const cands: { gx: number; gz: number; rot: 0 | 1 }[] = [];
  for (const n of nodes) {
    const cx0 = cellOf(n.x - n.r) - 3, cx1 = cellOf(n.x + n.r) + 3;
    const cz0 = cellOf(n.z - n.r) - 3, cz1 = cellOf(n.z + n.r) + 3;
    for (let gz = Math.max(1, cz0); gz <= Math.min(MAP_CELLS - 2, cz1); gz++) {
      for (let gx = Math.max(1, cx0); gx <= Math.min(MAP_CELLS - 2, cx1); gx++) {
        if (!q.survey && (gx + gz) % 2 !== 0) continue;
        for (const rot of rots) {
          const key = (idx(gx, gz) << 1) | rot;
          if (seen.has(key)) continue;
          const [x, z] = centerOf({ type, gx, gz, rot });
          if (Math.hypot(x - n.x, z - n.z) > n.r) continue;
          seen.add(key);
          cands.push({ gx, gz, rot });
        }
      }
    }
  }

  // score each candidate that clears the raster, counting the open pads struck
  const tally: Record<string, number> = {};
  const strike = (k: string) => { tally[k] = (tally[k] ?? 0) + 1; };
  let open = 0;
  const scored: { gx: number; gz: number; rot: 0 | 1; score: number; d: number; name: string; kind?: DepositKind }[] = [];
  for (const c of cands) {
    const r = footprintRect({ type, ...c });
    if (r.gx0 < 1 || r.gz0 < 1 || r.gx1 > MAP_CELLS - 1 || r.gz1 > MAP_CELLS - 1) continue;
    let bits = 0;
    for (let z = r.gz0; z < r.gz1; z++) for (let x = r.gx0; x < r.gx1; x++) bits |= grid[idx(x, z)];
    if (bits & 3) continue;
    // its own door apron must be open ground
    const ap = apron(type, c.gx, c.gz, c.rot);
    let bad = false;
    if (ap) {
      for (let z = ap[1]; z < ap[3] && !bad; z++) for (let x = ap[0]; x < ap[2]; x++) if (grid[idx(x, z)] & 1) { bad = true; break; }
      if (bad) continue;
    }
    open++;
    if (q.survey && bits & 4) { strike('lane'); continue; }
    if (vetoes.some((v) => r.gx0 < v.gx1 && r.gx1 > v.gx0 && r.gz0 < v.gz1 && r.gz1 > v.gz0)) { strike('veto'); continue; }
    const [x, z] = centerOf({ type, ...c });
    if (site.buildableRadiusM > 0 && Math.hypot(x, z) > site.buildableRadiusM) { strike('tube'); continue; }
    // what placement refuses on sight: a road under it, rough ground, no road to it
    if (bits & 8) { strike('road'); continue; }
    const relief = ground.maxDelta(r.gx0, r.gz0, r.gx1, r.gz1);
    if (relief > MAX_SLOPE_DELTA) { strike('rough'); continue; }
    if (spurHopeless(s, ground, { type, ...c })) { strike('route'); continue; }
    let d = Infinity, nm = '';
    for (const p of anchor.pts) {
      const dd = Math.hypot(x - p.x, z - p.z);
      if (dd < d) { d = dd; nm = p.name; }
    }
    let score = d;
    let kind: DepositKind | undefined;
    if (q.intent.edge) {
      // a mast at the edge: as far from every network node as the network allows
      let near = Infinity;
      for (const n of nodes) near = Math.min(near, Math.hypot(x - n.x, z - n.z));
      score = -near;
      nm = 'the network edge';
      d = near;
    }
    if (q.survey && !q.intent.edge) {
      kind = known(ground.depositAt(x, z))?.kind;
      const wanted = type === 'solar' ? 'ridge' : type === 'excavator' ? target : likeKind ?? null;
      if (kind && wanted && kind === wanted) score -= 40;
      else if (reservedFor(type, kind, target)) score += 25;
    }
    score += 2 * relief;
    scored.push({ ...c, score, d, name: nm, kind });
  }
  scored.sort((a, b) => a.score - b.score || a.gz - b.gz || a.gx - b.gx || a.rot - b.rot);

  // Site Survey AI: re-rank the head by planned path length
  if (q.survey && !q.intent.edge && scored.length) {
    const rects = s.buildings.map(worldRect);
    const head = scored.slice(0, 24);
    for (const c of head) {
      const [x, z] = centerOf({ type, ...c });
      let best = Infinity;
      for (const p of anchor.pts) best = Math.min(best, pathLength(x, z, plan(x, z, p.x, p.z, rects, HAUL.clear)));
      c.score += best - c.d;
      c.d = best;
    }
    head.sort((a, b) => a.score - b.score || a.gz - b.gz || a.gx - b.gx || a.rot - b.rot);
    scored.splice(0, head.length, ...head);
  }

  const unlocked = mods.unlocked;
  let pick: typeof scored[number] | null = null;
  let pickRoad = 0;
  // of the first few valid pads, the one whose new road (docs/15-roads.md) costs least on top of its score;
  // every pad left is tried in order until they are found (placement stays the one truth)
  let best = Infinity, valid = 0, other = '';
  for (const c of scored) {
    if (q.skip?.includes(`${c.gx},${c.gz},${c.rot}`)) { strike('other'); continue; }
    const chk = checkPlacement(s, site, ground as Heightfield, unlocked, type, c.gx, c.gz, c.rot, tier);
    if (!chk.valid) {
      const k = /^On a road/.test(chk.reason) ? 'road' : /rough/i.test(chk.reason) ? 'rough' : /^NO ROAD ROUTE/.test(chk.reason) ? 'route' : 'other';
      if (k === 'other' && !other) other = chk.reason;
      strike(k);
      continue;
    }
    const cost = c.score + ROAD_M * (chk.roadS ?? 0) / ROAD.cellS;
    if (cost < best) { best = cost; pick = c; pickRoad = chk.road?.length ?? 0; }
    if (++valid >= ROAD_PICKS) break;
  }
  if (!pick) {
    return {
      refusal: `no valid ground for ${/^[AEIOU]/.test(def.name) ? 'an' : 'a'} ${def.name} inside the build network ` +
        `(${tallyText(open, tally, other)}) — a Relay Mast or Habitat extends it`,
    };
  }

  const m = Math.round(pick.d);
  let why = q.intent.edge
    ? `at the network edge, ${m} m from the nearest node`
    : `nearest free pad to ${pick.name} · ${m} m`;
  let dig: SitePick['dig'];
  if (q.survey && !q.intent.edge) {
    if (pick.kind && ((type === 'solar' && pick.kind === 'ridge') || (type === 'excavator' && pick.kind === target) || pick.kind === likeKind)) {
      why = type === 'solar' && pick.kind === 'ridge'
        ? 'on a peak of light · never shaded'
        : `on ${DEPOSIT_INFO[pick.kind].name} · ${m} m ${type === 'excavator' ? 'haul ' : ''}to ${pick.name}`;
    } else if (type === 'excavator' && target) {
      // option (b): a pad by the consumer, digging the wanted deposit farther out
      const probe: BuildingState = {
        id: -1, type, gx: pick.gx, gz: pick.gz, rot: pick.rot, enabled: true, automated: true, priority: 2,
        wear: 0, dust: 0, construction: 0, buildTotal: 0, active: false, idleReason: '',
      };
      const [px, pz] = centerOf(probe);
      const homeRate = tripFor(s, mods, probe, px, pz, digOutput(s, mods, site, probe, undefined)).rate;
      let best: { x: number; z: number; value: number; kind: DepositKind } | null = null;
      for (const dpt of ground.deposits) {
        if (dpt.kind !== target || !depositRevealed(s, dpt, tier)) continue;
        const spot = digSpotIn(s, probe, dpt);
        if (!spot) continue;
        const out = digOutput(s, mods, site, probe, dpt.kind);
        const rate = tripFor(s, mods, probe, spot[0], spot[1], out).rate;
        const value = rate * (1 + 0.5 * feedGain(dpt.kind, target, mods));
        if (!best || value > best.value) best = { x: spot[0], z: spot[1], value, kind: dpt.kind };
      }
      if (best && best.value > homeRate * 1.02) {
        dig = { x: best.x, z: best.z };
        why = `${m} m from ${pick.name}, digging ${DEPOSIT_INFO[best.kind].name} ${Math.round(Math.hypot(best.x - px, best.z - pz))} m out`;
      } else {
        why = `nearest free pad to ${pick.name} · ${m} m (no ${DEPOSIT_INFO[target].name} worth the haul)`;
      }
    }
  }
  if (pickRoad > 0) why += ` · a ${pickRoad}-cell road to it`;
  return { gx: pick.gx, gz: pick.gz, rot: pick.rot, why, score: pick.score, ...(dig ? { dig } : {}) };
}

/** Feed Planner: the best dig site for an existing excavator, or null to stay. */
export function feedPlan(
  s: GameState, mods: Mods, site: SiteDef, ground: Ground, b: BuildingState,
): { x: number; z: number; kind: DepositKind | undefined; gain: number } | null {
  if (b.type !== 'excavator' || !b.haul) return null;
  const target = feedTarget(s, mods);
  const tier = mods.surveyTier;
  const value = (x: number, z: number, kind: DepositKind | undefined) =>
    tripFor(s, mods, b, x, z, digOutput(s, mods, site, b, kind)).rate * (1 + 0.5 * feedGain(kind, target, mods));
  const h = b.haul;
  const curKind = ground.depositAt(h.digX, h.digZ);
  const cur = value(h.digX, h.digZ, curKind && depositRevealed(s, curKind, tier) ? curKind.kind : undefined);
  let best: { x: number; z: number; kind: DepositKind | undefined; v: number } | null = null;
  const [px, pz] = centerOf(b);
  const padDep = ground.depositAt(px, pz);
  const padKind = padDep && depositRevealed(s, padDep, tier) ? padDep.kind : undefined;
  const home = value(px, pz, padKind);
  best = { x: px, z: pz, kind: padKind, v: home };
  if (target) {
    for (const d of ground.deposits) {
      if (d.kind !== target || !depositRevealed(s, d, tier)) continue;
      const spot = digSpotIn(s, b, d);
      if (!spot) continue;
      const v = value(spot[0], spot[1], d.kind);
      if (v > best.v) best = { x: spot[0], z: spot[1], kind: d.kind, v };
    }
  }
  if (!best || best.v < cur * 1.05) return null;
  if (Math.hypot(best.x - h.digX, best.z - h.digZ) < 2) return null;
  return { x: best.x, z: best.z, kind: best.kind, gain: best.v / Math.max(1e-6, cur) - 1 };
}
