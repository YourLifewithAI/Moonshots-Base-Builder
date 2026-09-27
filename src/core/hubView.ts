/** What the hub inspector and the unit inspector show (docs/17 §4.7): the
 *  $fleet payload's hubs and units, from core/hubs.ts's own functions. */
import { BUILDINGS } from '../data/buildings';
import { HUB, UNIT_DEFS } from '../data/hubs';
import { RESOURCES } from '../data/resources';
import { DEPOSIT_INFO, FEED_KINDS, FEED_LABEL } from '../data/deposits';
import type { SiteDef } from '../data/sites';
import type { GameState, Hauler } from './state';
import type { Mods } from './mods';
import type { HubView, PitView, UnitView } from '../ui/stores';
import {
  bayCap, choicesFor, hopperCap, hubHunger, hubName, hubOf, hubUnit, hubsOf, jobCost, jobTime, queueRefusal, targetOf,
  tripTo, unitName, unitRates, unitSpec, unitTag, unitWhy, unitsOf,
} from './hubs';
import { packLine } from './unitPower';
import { fmtClock } from './daynight';
import { unitFlareLine, unitFlareStatus } from './flareEffects';

const G = RESOURCES.regolith.glyph;
const n0 = (v: number) => Math.floor(v);
const costText = (c: Record<string, number>) =>
  Object.entries(c).filter(([, a]) => a > 0).map(([rid, a]) => `${a}${RESOURCES[rid as keyof typeof RESOURCES].glyph}`).join(' ');

/** A unit's line: what it is doing now. */
function unitLine(s: GameState, u: Hauler, bucket: number): string {
  const h = u.haul;
  const t = targetOf(s, u.target);
  const b = hubOf(s, u);
  const cargo = h.cargo.regolith ?? 0;
  // a flare's reboot or latch-up holds it (docs/16 §4.5)
  const fl = unitFlareStatus(s, u);
  if (fl) return fl;
  if (h.src === 'flat') return 'NO POWER — waiting for the grid';
  switch (h.phase) {
    case 'park':
      return u.parked === 'recalled' ? 'PARKED — recalled; Dispatch sends it back to work'
        : u.parked === 'off' ? `PARKED — ${b ? hubName(b) : 'its hub'} is shut down`
        : u.parked === 'charge' ? 'CHARGING — in its bay'
        : u.parked === 'noPit' ? (unitWhy(u) || 'IDLE — no pit in reach with a free face')
        : 'PARKED — in its bay';
    case 'toBay': return u.parked === 'recalled' ? 'RETURNING — recalled to its bay' : 'RETURNING — to its bay';
    case 'toDig':
      if (h.wait === 'gate') return t ? `WAITING AT THE GATE — ${t.name} has ${t.faces}/${t.faces} faces working` : 'WAITING AT THE GATE';
      if (h.noRoad) return `NO HAUL ROAD — no road reaches ${t?.name ?? 'its pit'} yet`;
      return `OUT TO ${t ? t.name : 'its pit'}${u.face >= 0 ? `, face ${u.face + 1}` : ''}`;
    case 'dig':
      if (h.full) return `WAITING AT THE FACE — ${b ? hubName(b) : 'its hub'}'s hopper is full · ${n0(cargo)}/${n0(bucket)}${G}`;
      return `DIGGING ${t ? t.name : 'its pit'}${u.face >= 0 ? `, face ${u.face + 1}` : ''} · ${n0(cargo)}/${n0(bucket)}${G}`;
    case 'toDrop': return `HAULING ${n0(cargo)}${G} to ${b ? hubName(b) : 'its hub'}`;
    case 'unload': return `TIPPING ${n0(cargo)}${G} into ${b ? hubName(b) : 'its hub'}'s hopper`;
  }
  return '';
}

export function unitView(s: GameState, mods: Mods, site: SiteDef, u: Hauler): UnitView {
  const b = hubOf(s, u);
  const t = targetOf(s, u.target);
  const r = unitRates(s, mods, site, u, t?.kind);
  const spec = unitSpec(mods, u.type, r);
  const trip = b && t ? tripTo(s, mods, b, t) : null;
  const tripS = trip && Number.isFinite(trip.t) ? trip.t : 0;
  const cycle = spec.digS + spec.unloadS + 2 * tripS;
  return {
    id: u.id, tag: unitTag(u), type: u.type, name: unitName(u.type), hub: u.hub, hubName: b ? hubName(b) : '—', bay: u.bay,
    line: unitLine(s, u, spec.bucket), target: u.target, targetName: t?.name ?? '', pinned: !!u.pinned, parked: u.parked ?? '',
    phase: u.haul.phase, cargo: u.haul.cargo.regolith ?? 0, bucket: spec.bucket, tripS,
    rate: t && trip ? spec.bucket / cycle : 0,
    pack: packLine(u.haul, 'digger', mods, !!s.power?.brownout), wear: u.wear, flat: u.haul.src === 'flat',
    cap: u.cap ?? 1, flare: unitFlareLine(s, site, u), reprint: (u.cap ?? 1) < 0.9995 && !!b,
  };
}

export function hubViews(s: GameState, mods: Mods, site: SiteDef): { hubs: Record<number, HubView>; units: UnitView[] } {
  const hubs: Record<number, HubView> = {};
  for (const b of hubsOf(s)) {
    const h = b.hub!;
    const units = unitsOf(s, b.id);
    const type = hubUnit(b.type, site);
    const cap = bayCap(b, mods);
    const n = Math.max(1, units.filter((u) => !u.pinned).length);
    const pits: PitView[] = choicesFor(s, mods, site, b, n).slice(0, 6).map((c) => ({
      key: c.target.key, name: c.target.name, glyph: c.target.kind ? DEPOSIT_INFO[c.target.kind].glyph : '▭',
      tripS: c.trip.t, connected: c.trip.connected, faces: c.target.faces, used: c.target.faces - c.free, q: c.q,
      rate: c.rate, score: c.score, inReach: c.inReach, assigned: h.prefer === c.target.key, plain: c.target.plain,
    }));
    const mix = FEED_KINDS.filter((k) => h.feed[k] > 0.005);
    const shown = mix.filter((k) => k !== 'plain');
    const feed = mix.length ? (shown.length ? shown : mix).map((k) => `${Math.round(h.feed[k] * 100)}% ${FEED_LABEL[k]}`).join(' · ') : 'nothing delivered yet';
    // the hint under UNITS: is another worth it? (starved ≥ 10%, a face free, a bay free)
    const hunger = hubHunger(mods, site, b);
    let hint = '';
    const best = pits.find((p) => p.inReach && p.connected);
    const canUnit = queueRefusal(s, mods, b, 'unit');
    if (h.starved >= 0.1 && best) {
      const ordinal = ['1st', '2nd', '3rd', '4th', '5th'][units.length] ?? `${units.length + 1}th`;
      if (canUnit) hint = `starved ${Math.round(h.starved * 100)}% — ${canUnit}`;
      else if (best.used >= best.faces) hint = `starved ${Math.round(h.starved * 100)}% — ${best.name} has every face working`;
      else {
        const now = Math.min(units.length * best.rate, hunger);
        const more = Math.min((units.length + 1) * best.rate, hunger);
        hint = `A ${ordinal} ${unitName(type).toLowerCase()} would add +${(more - now).toFixed(1)}${G}/s at ${best.name} (hunger ${hunger.toFixed(1)}${G}/s)`;
      }
    }
    const status = h.starved >= 0.3 && b.idleReason === 'inputs'
      ? `STARVED — the hopper is empty: its units deliver less than the ${hunger.toFixed(1)}${G}/s it burns` : '';
    hubs[b.id] = {
      id: b.id, name: hubName(b), level: h.level, bays: cap, units: units.map((u) => u.id),
      hopper: h.hopper, hopperCap: hopperCap(b), q: h.q, feed, starved: h.starved,
      queue: h.queue.map((j, i) => ({
        kind: j.kind, name: j.kind === 'bay' ? '+ Bay' : j.kind === 'reprint' ? `Re-print ${unitName(type).toLowerCase()} #${j.unit}` : `+ ${unitName(type)}`, pct: j.total > 0 ? j.t / j.total : 0,
        left: Math.max(0, j.total - j.t), paid: !!j.paid, waiting: i === 0 ? h.waiting ?? '' : '',
      })),
      unitName: unitName(type), unitCost: costText(jobCost(b, 'unit', site)), unitTime: jobTime(b, 'unit', site, mods),
      canUnit, canBay: queueRefusal(s, mods, b, 'bay'), bayCost: `${costText(jobCost(b, 'bay', site))} · ${fmtClock(jobTime(b, 'bay', site, mods))}`,
      pits, prefer: h.prefer ?? null, plainPit: h.plainPit ?? null, hint, status,
    };
  }
  const units = s.haulers.filter((u) => hubOf(s, u)).map((u) => unitView(s, mods, site, u));
  void HUB; void UNIT_DEFS; void BUILDINGS;
  return { hubs, units };
}
