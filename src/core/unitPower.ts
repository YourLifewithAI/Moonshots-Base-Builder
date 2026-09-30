/** On-board power (docs/02 · On-board power, docs/15 §6): every construction rover,
 *  drone and regolith excavator carries a pack, charged from the grid.
 *
 *  - **Grid first.** A unit's use — working (a weld, a sinter, a dig) and
 *    driving — is a grid load at its priority: a site's rovers weld on the
 *    site's draw, an excavator digs on its own, and driving and road work are
 *    each unit's own load (its site's priority, else its dock's). Served,
 *    the pack is not touched.
 *  - **In a brownout** (its draw unserved at its priority) the pack pays.
 *    An empty pack stops the unit where it stands — no weld, no dig, no
 *    drive — and it takes its work up again once the grid serves it (the
 *    grid reaches a waiting unit wherever it stands, so nobody is
 *    stranded). Radioisotope Power Units give every unit a trickle of its
 *    own: with the grid at 0 it works at that share of its draw.
 *  - **Charging.** Plugged in at a charge point — its home (homeOf /
 *    chargeSpotOf: a rover's dock, a drone's hive pad, an excavator's own
 *    pad, or the consumer it tips at) or a site's feed while that site is
 *    served — a unit not full draws its charger's kW: one more load at its
 *    priority, so triage decides who charges in a shortage.
 *
 *  The pack rides on the unit (RoverUnit) or the digger's haul
 *  (HaulState), never on a pad. A hub's units (docs/17) call their hub home
 *  and charge in its bays (`homeOf`, `chargeSpotOf`); nothing else here knows
 *  where home is.
 *
 *  Pure and deterministic: roster order, building order; O(units) a tick. */
import { UNIT_POWER } from '../data/balance';
import type { BuildingState, GameState, HaulState, Hauler, PackState, RoverUnit } from './state';
import type { Mods } from './mods';
import { centerOf } from '../buildings/instances';
import { isDrone, roverDown } from './fleet';
import { arrived, dronePads, padPoint } from './transit';
import { bayPoint, hubOf } from './hubs';

/** The three kinds of pack. */
export type PackKind = 'rover' | 'drone' | 'digger';

/** A unit with a pack: a roster unit (a rover or a drone), a legacy
 *  excavator pad (its haul carries the pack), or a hub's unit (docs/17: its
 *  haul carries it too; a digger's pack). */
export type PackUnit =
  | { kind: 'rover' | 'drone'; unit: RoverUnit; pack: PackState }
  | { kind: 'digger'; b: BuildingState; pack: HaulState }
  | { kind: 'hauler'; h: Hauler; pack: HaulState };

/** The pack a unit carries: a hub unit's is a digger's. */
export const powerKind = (u: PackUnit): PackKind => (u.kind === 'hauler' ? 'digger' : u.kind);

type PackMods = Pick<Mods, 'packMult' | 'unitDriveMult' | 'chargeEff' | 'rpu'>;

// ───────────────────────────── the numbers ─────────────────────────────

/** A full pack, kWh. */
export const packCap = (kind: PackKind, mods: Pick<Mods, 'packMult'>): number => UNIT_POWER.pack[kind] * mods.packMult;
/** kWh aboard (an absent charge is a full pack: a new unit, an old save). */
export const chargeOf = (p: PackState, cap: number): number => Math.max(0, Math.min(cap, p.charge ?? cap));
/** The draw of driving, kW. */
export const driveKW = (kind: PackKind, mods: Pick<Mods, 'unitDriveMult'>): number => UNIT_POWER.driveKW[kind] * mods.unitDriveMult;
/** What the charger puts in the pack, kW (the grid pays ÷ chargeEff of it). */
export const chargeKW = (kind: PackKind): number => UNIT_POWER.chargeKW[kind];
/** The charger's grid draw, kW. */
export const chargerKW = (kind: PackKind, mods: Pick<Mods, 'chargeEff'>): number => UNIT_POWER.chargeKW[kind] / mods.chargeEff;
/** A Radioisotope Power Unit's constant output, kW (0 without one). */
export const rpuKW = (kind: PackKind, mods: Pick<Mods, 'rpu'>): number => (mods.rpu ? UNIT_POWER.rpuKW[kind] : 0);

// ───────────────────────────── home and charging ─────────────────────────────

/** Every unit with a pack, in roster order then building order (held or bricked ones left out). */
export function packUnits(s: GameState): PackUnit[] {
  const out: PackUnit[] = [];
  for (const r of s.rovers ?? []) {
    if (roverDown(s, r)) continue;
    out.push({ kind: isDrone(s, r) ? 'drone' : 'rover', unit: r, pack: r });
  }
  for (const b of s.buildings) {
    if (b.type !== 'excavator' || (b.construction ?? 0) > 0 || !b.haul) continue;
    out.push({ kind: 'digger', b, pack: b.haul });
  }
  // hub units (docs/17), in id order: those whose hub stands
  for (const h of s.haulers ?? []) if (hubOf(s, h)) out.push({ kind: 'hauler', h, pack: h.haul });
  return out;
}

/** Where a unit calls home: a rover's dock (the Lander, a Robotics Bay), a
 *  drone's Drone Hive, a legacy excavator's own pad (the building itself), a
 *  hub unit's hub (docs/17 §4.3). */
export function homeOf(s: Pick<GameState, 'buildings'>, u: PackUnit): BuildingState | null {
  if (u.kind === 'digger') return u.b;
  if (u.kind === 'hauler') return s.buildings.find((b) => b.id === u.h.hub) ?? null;
  return s.buildings.find((b) => b.id === u.unit.home) ?? null;
}

/** Where a unit plugs in at home (world metres): the dock it parks at, its
 *  hive pad, its excavator pad's centre, a hub unit's bay. Null: no home. */
export function chargeSpotOf(s: GameState, u: PackUnit): { at: BuildingState; x: number; z: number } | null {
  const at = homeOf(s, u);
  if (!at) return null;
  if (u.kind === 'hauler') {
    const [x, z] = bayPoint(s, at, u.h.bay);
    return { at, x, z };
  }
  if (u.kind === 'drone') {
    const [x, z] = padPoint(at, dronePads(s).get(u.unit.id) ?? 0);
    return { at, x, z };
  }
  const [x, z] = centerOf(at);
  return { at, x, z };
}

/** Is it plugged in at home now? A rover or drone parked at its dock or
 *  pad; an excavator on its own pad, or tipping its bucket at a consumer; a
 *  hub unit in its bay, or tipping at its hub. */
export function atHome(s: GameState, u: PackUnit): boolean {
  if (u.kind === 'digger' || u.kind === 'hauler') {
    const h = u.pack;
    if (h.phase === 'unload') return true;
    if (u.kind === 'hauler' && h.phase !== 'park') return false;
    const spot = chargeSpotOf(s, u);
    return !!spot && Math.hypot(h.x - spot.x, h.z - spot.z) < 0.5;
  }
  const t = u.unit.trip;
  return !!t && arrived(t) && t.kind === 'dock';
}

/** Parked at its dock and plugged in, asleep at night when a Night Vault stands (docs/20 S2): a rover or drone at its
 *  dock (the caller checked `atHome`), a hub unit in its bay. A legacy excavator pad is a working machine, never parked. */
export function hibernating(u: PackUnit): boolean {
  if (u.kind === 'digger') return false;
  if (u.kind === 'hauler') return u.pack.phase === 'park';
  return true;
}

/** At its site's stand (a rover: plugged into the site's feed while the site is served). */
export function atSiteStand(u: PackUnit): number | null {
  if (u.kind !== 'rover') return null; // a drone hovers: it charges only on its pad
  const r = u.unit, t = r.trip;
  if (!t || !arrived(t) || r.site === null || t.site !== r.site) return null;
  return t.kind === 'weld' || t.kind === 'front' ? r.site : null;
}

/** The priority it draws at: its site's, else its dock's; an excavator's own; a hub unit's hub's. */
export function unitPriority(s: Pick<GameState, 'buildings'>, u: PackUnit): number {
  if (u.kind === 'digger') return u.b.priority;
  if (u.kind === 'hauler') return homeOf(s, u)?.priority ?? 2;
  const r = u.unit;
  const site = r.site !== null ? s.buildings.find((b) => b.id === r.site) : undefined;
  if (site && (site.construction ?? 0) > 0) return site.priority;
  return homeOf(s, u)?.priority ?? 2;
}

/** A unit's key in a tick's ledger. */
export const unitKey = (u: PackUnit): string => (u.kind === 'digger' ? `b${u.b.id}` : u.kind === 'hauler' ? `h${u.h.id}` : `r${u.unit.id}`);

// ───────────────────────────── one tick's ledger ─────────────────────────────

interface Line { u: PackUnit; cap: number; rpu: number; share: number; paid: boolean; used: boolean }

/** One economy tick's packs: what each unit could not get from the grid is
 *  paid here (its RPU's trickle first, then the pack), and `finish` charges
 *  what was plugged in and served and sets each unit's share of the next tick. */
export class PackTick {
  private lines = new Map<PackState, Line>();
  /** hibernating units' charge rate × (a Night Vault at night; the charger draws the same share) */
  private slow = new Map<PackState, number>();
  constructor(private mods: PackMods, private dt: number) {}

  private line(u: PackUnit): Line {
    let l = this.lines.get(u.pack);
    if (!l) {
      l = { u, cap: packCap(powerKind(u), this.mods), rpu: rpuKW(powerKind(u), this.mods) * this.dt, share: 1, paid: false, used: false };
      this.lines.set(u.pack, l);
    }
    return l;
  }

  /** It sleeps this tick: its charger delivers `f` of its rate. */
  hibernate(u: PackUnit, f: number) { this.slow.set(u.pack, f); }

  /** It drew from the grid this tick (its work or its drive was served). */
  grid(u: PackUnit) { this.line(u).used = true; }

  /** It needs `kwh` the grid did not serve: its RPU pays first, then its pack.
   *  Returns the share it got (1 all of it, 0 none: flat). */
  pay(u: PackUnit, kwh: number): number {
    const l = this.line(u);
    l.used = true;
    if (kwh <= 1e-12) return 1;
    const fromRpu = Math.min(l.rpu, kwh);
    l.rpu -= fromRpu;
    const have = chargeOf(u.pack, l.cap);
    const fromPack = Math.min(have, kwh - fromRpu);
    u.pack.charge = have - fromPack;
    const share = Math.min(1, (fromRpu + fromPack) / kwh);
    l.share = Math.min(l.share, share);
    l.paid = true;
    return share;
  }

  /** What it could pay for `kwh` now, without paying (a site asks before it welds). */
  could(u: PackUnit, kwh: number): number {
    const l = this.line(u);
    if (kwh <= 1e-12) return 1;
    return Math.min(1, (l.rpu + chargeOf(u.pack, l.cap)) / kwh);
  }

  /** The tick's end, for every unit: the RPU's trickle left over and the
   *  grid's charge (`charged`: its charge load was served) go into the pack;
   *  its share of the next tick, how it ran and how long it has waited flat. */
  finish(units: readonly PackUnit[], charged: ReadonlySet<string>) {
    for (const u of units) {
      const l = this.line(u);
      const p = u.pack;
      let c = chargeOf(p, l.cap);
      if (l.rpu > 1e-12) c = Math.min(l.cap, c + l.rpu);
      const plugged = charged.has(unitKey(u));
      if (plugged) c = Math.min(l.cap, c + chargeKW(powerKind(u)) * this.dt * (this.slow.get(p) ?? 1));
      // a full pack is left absent (no noise in the save); anything less is written
      if (c >= l.cap - 1e-9) delete p.charge; else p.charge = c;
      if (plugged) p.chg = true; else delete p.chg;
      const flat = l.paid && l.share <= 1e-9;
      if (l.paid && l.share < 1 - 1e-9) p.pw = l.share; else delete p.pw;
      p.src = !l.used ? undefined : flat ? 'flat' : !l.paid ? 'grid' : l.share < 1 - 1e-9 ? 'rpu' : 'pack';
      if (!p.src) delete p.src;
      if (flat) p.flatT = (p.flatT ?? 0) + this.dt; else delete p.flatT;
    }
  }
}

// ───────────────────────────── what the UI reads ─────────────────────────────

/** 'BATTERY 64% · charging', 'ON BATTERY 40% — the grid is short (brownout)',
 *  'NO POWER — waiting for the grid (brownout)': a unit's pack line. */
export function packLine(p: PackState, kind: PackKind, mods: Pick<Mods, 'packMult' | 'rpu'>, brownout: boolean): string {
  const cap = packCap(kind, mods);
  const pct = Math.round((chargeOf(p, cap) / Math.max(1e-9, cap)) * 100);
  const why = brownout ? 'brownout' : 'load shed';
  switch (p.src) {
    case 'flat': return `NO POWER — waiting for the grid (${why})`;
    case 'rpu': return `ON ITS RPU — ${Math.round((p.pw ?? 0) * 100)}% speed, the grid is short (${why})`;
    case 'pack': return `ON BATTERY ${pct}% — the grid is short (${why})`;
    default: return `BATTERY ${pct}%${p.chg ? ' · charging' : ''}${mods.rpu ? ' · RPU aboard' : ''}`;
  }
}
