/** The $fleet payload (game.publish): every rover's state, every site's
 *  crew and ETA, every excavator's haul and the deposits it could dig — the
 *  numbers the inspector and the targeting hint show, from the sim's own
 *  functions (core/fleet.ts, core/haul.ts). */
import { BUILDINGS } from '../data/buildings';
import { RESOURCES } from '../data/resources';
import type { SiteDef } from '../data/sites';
import { DEPOSIT_INFO, feedKindOf, type DepositKind } from '../data/deposits';
import type { Deposit } from '../terrain/heightfield';
import type { DigOption, FleetView, HaulView, RoverView, SiteCrewView } from '../ui/stores';
import type { BuildingState, GameState } from './state';
import { effectiveRates, type Mods } from './mods';
import { crewKW, crewRate, isDrone, roversAt, siteEta, summonPick } from './fleet';
import { arrived, siteTransit, tripLeft } from './transit';
import { fmtClock } from './daynight';
import { digsHome, haulSpec, tripFor } from './haul';
import { centerOf } from '../buildings/instances';
import { inside, worldRect } from './paths';
import { spurLeft, spurSeconds } from './roads';
import { PROSPECTS } from '../data/lunarMap';
import { packLine } from './unitPower';
import { hubViews } from './hubView';
import { gradeView, jobRect } from './grading';
import { surveyFleetView } from './surveyDrones';

const G = RESOURCES.regolith.glyph;
const label = (b: BuildingState) => `${BUILDINGS[b.type].name} #${b.id}`;
const isSite = (b: { construction?: number }) => (b.construction ?? 0) > 0;

/** What digging a kind of ground does to the feed (the hint's last word). */
export function feedNote(kind: DepositKind | undefined, mods: Mods): string {
  switch (feedKindOf(kind)) {
    case 'ilmenite': return 'smelter feed ↑';
    case 'anorthosite': return 'refinery feed ↑ · smelter ↓';
    case 'glass': return 'smelter O₂ ↑ · wear ↑';
    case 'kreep': return 'reactor make-up · smelter ↓';
    case 'volatiles':
      return (mods.recipe.excavator?.outputs?.water ?? 0) > 0 ? 'water ×2.5 · regolith ×0.9' : 'regolith ×0.9 (water with Solar-Wind Volatiles)';
    default: return 'plain feed';
  }
}

/** The ground's name for the hint ('high-Ti basalt', 'plain regolith'). */
export const groundName = (kind: DepositKind | undefined) =>
  kind && feedKindOf(kind) !== 'plain' ? DEPOSIT_INFO[kind].name : 'plain regolith';

/** An excavator's regolith output per second digging ground of `kind`. */
export function digOutput(s: GameState, mods: Mods, site: SiteDef, b: BuildingState, kind: DepositKind | undefined): number {
  const probe: BuildingState = { ...b, ...(kind ? { deposit: kind } : {}) };
  if (!kind) delete probe.deposit;
  const robotic = s.expedition === 'robotic';
  return effectiveRates('excavator', mods, site, probe, { robotic, agentRun: b.automated || (robotic && s.crew <= 0) })
    .outputs.regolith ?? 0;
}

/** Open ground inside a deposit to dig: its centre, else the nearest clear
 *  point on rings out from it (null if structures cover it all). */
export function digSpotIn(s: GameState, b: BuildingState, d: Pick<Deposit, 'cx' | 'cz' | 'r'>): [number, number] | null {
  const rects = s.buildings.filter((o) => o.id !== b.id).map(worldRect);
  const clear = (x: number, z: number) => !rects.some((r) => inside(x, z, r, 2));
  if (clear(d.cx, d.cz)) return [d.cx, d.cz];
  for (let rr = 4; rr < d.r - 1; rr += 4) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const x = d.cx + Math.cos(a) * rr, z = d.cz + Math.sin(a) * rr;
      if (clear(x, z)) return [x, z];
    }
  }
  return null;
}

function roverState(s: GameState, r: GameState['rovers'][number]): string {
  const site = r.site !== null ? s.buildings.find((b) => b.id === r.site) : undefined;
  const home = s.buildings.find((b) => b.id === r.home);
  // on its way (core/transit.ts): where to, and when it gets there
  const t = r.trip;
  const going = !!t && !t.stuck && !arrived(t) && !t.local;
  // (held up by a digger's reservation, core/traffic.ts: its ETA stretches)
  const left = going ? ` · ${fmtClock(Math.ceil(tripLeft(t)))}${(t!.held ?? 0) >= 2 ? ' · held up by a digger' : ''}` : '';
  if (!site && r.road !== undefined) {
    const j = s.roadJobs?.find((x) => x.id === r.road);
    const by = j?.by !== undefined ? s.buildings.find((b) => b.id === j.by) : undefined;
    const what = j?.kind === 'haul' && by ? `the haul road out to ${label(by)}'s dig` : 'the road you drew';
    if (t?.stuck) return `NO ROAD — it cannot reach ${what} by road`;
    if (going && t!.job === r.road) return `EN ROUTE to ${what}${left}`;
    return j?.kind === 'haul' && by ? `LAYING A HAUL ROAD — out to ${label(by)}'s dig` : 'LAYING A ROAD — the one you drew';
  }
  // levelling a box the player dragged (docs/19 S5, core/grading.ts)
  if (!site && r.grade !== undefined) {
    const j = s.gradeJobs?.find((x) => x.id === r.grade);
    if (j) {
      const what = `the ${jobRect(j)[2] - jobRect(j)[0]}×${jobRect(j)[3] - jobRect(j)[1]} box`;
      if (t?.stuck) return `NO ROAD — it cannot reach ${what} by road`;
      if (going && t!.kind === 'grade') return `EN ROUTE to ${what}${left}`;
      if (r.src === 'flat') return `OUT OF CHARGE — at ${what}, waiting for the grid`;
      return `GRADING — ${what}, cell ${Math.min(j.done + 1, j.cells.length)} of ${j.cells.length}`;
    }
  }
  if (!site) {
    if (r.src === 'flat') return `OUT OF CHARGE — waiting for the grid${going ? ` on its way to ${home ? label(home) : 'its dock'}` : ''}`;
    if (going && t!.kind === 'dock') return `RETURNING to ${home ? label(home) : 'its dock'}${left}`;
    return `PARKED — at ${home ? label(home) : 'its dock'}, free for the next site`;
  }
  const pin = r.pinned ? ' · pinned' : '';
  if (t?.site === site.id && t.stuck) return `NO ROAD — it cannot reach ${label(site)} by road${pin}`;
  if (going && t!.site === site.id) return `EN ROUTE to ${label(site)}${left}${pin}`;
  if (!site.enabled) return `WAITING — ${label(site)} is paused${pin}`;
  if (r.src === 'flat') return `OUT OF CHARGE — at ${label(site)}, waiting for the grid${pin}`;
  if (site.idleReason === 'power') return `HELD — ${label(site)} has no power${pin}`;
  if (site.idleReason === 'inputs') return `HELD — ${label(site)} is out of weld parts${pin}`;
  if (site.idleReason === 'road') return `LAYING ROAD — out to ${label(site)} (${spurLeft(s, site)} cells to go)${pin}`;
  return `BUILDING — ${label(site)}${pin}`;
}

export function fleetView(
  s: GameState, mods: Mods, site: SiteDef, deposits: readonly Deposit[], revealed: (d: Deposit) => boolean,
): FleetView {
  const at = new Map(s.buildings.map((b) => [b.id, b]));
  const brown = !!s.power?.brownout;
  const rovers: RoverView[] = (s.rovers ?? []).map((r) => {
    const siteB = r.site !== null ? at.get(r.site) : undefined;
    const home = at.get(r.home);
    return {
      id: r.id, home: r.home, homeName: home ? label(home) : '—',
      site: r.site, siteName: siteB ? label(siteB) : '', pinned: r.pinned,
      state: roverState(s, r),
      tripS: r.trip && !r.trip.stuck ? tripLeft(r.trip) : 0,
      pack: packLine(r, isDrone(s, r) ? 'drone' : 'rover', mods, brown), flat: r.src === 'flat',
    };
  });
  const sites: Record<number, SiteCrewView> = {};
  for (const b of s.buildings) {
    if (!isSite(b)) continue;
    const crew = roversAt(s, b.id);
    const n = b.enabled ? crew.length : 0;
    const roadS = spurSeconds(s, b);
    // nobody there yet: the first to arrive, and the drive before the build
    const tr = crew.length ? siteTransit(s, b.id) : { wait: '' as const, eta: Infinity };
    const wait = tr.wait === 'enroute' || tr.wait === 'noroad' ? tr.wait : '';
    const drive = wait === 'enroute' && Number.isFinite(tr.eta) ? tr.eta : 0;
    // the draw: the ones at their stands (one on its way, or queued behind a frontier, draws nothing)
    const there = crew.filter((r) => r.trip?.site === b.id && arrived(r.trip) && (r.trip.kind === 'weld' || r.trip.kind === 'front')).length;
    sites[b.id] = {
      n: crew.length, pinned: crew.filter((r) => r.pinned).length,
      eta: drive + siteEta(mods, b, n, roadS), etaPlus: drive + siteEta(mods, b, n + 1, roadS),
      kw: crewKW(mods, there), speed: crewRate(n), summon: summonPick(s, b.id).reason,
      wait, arrive: tr.eta, flat: crew.filter((r) => r.src === 'flat').length,
    };
  }
  const hauls: Record<number, HaulView> = {};
  const spec = haulSpec(mods);
  for (const b of s.buildings) {
    if (b.type !== 'excavator' || isSite(b)) continue;
    const h = b.haul;
    const [hx, hz] = centerOf(b);
    const out = digOutput(s, mods, site, b, b.deposit);
    const home = digsHome(b);
    const digX = h?.digX ?? hx, digZ = h?.digZ ?? hz;
    const trip = tripFor(s, mods, b, digX, digZ, out);
    const homeTrip = home ? trip : tripFor(s, mods, b, hx, hz, digOutput(s, mods, site, b, h?.pad));
    const bucket = trip.load;
    const cargo = h?.cargo.regolith ?? 0;
    const drop = h?.drop !== null && h?.drop !== undefined ? at.get(h.drop) : trip.drop ?? undefined;
    const digName = home ? `its own pad (${groundName(b.deposit)})` : `${groundName(b.deposit)} ${Math.round(Math.hypot(digX - hx, digZ - hz))} m out`;
    const waiting = b.idleReason === 'full';
    const phase = h?.phase ?? 'dig';
    const n = (v: number) => Math.floor(v);
    const pack = h ? packLine(h, 'digger', mods, brown) : '';
    const line = !b.enabled ? 'SHUT DOWN'
      : b.idleReason === 'power' ? `${h?.src === 'flat' ? pack : 'IDLE — no power'} · ${n(cargo)}/${n(bucket)}${G} aboard`
      : waiting ? `WAITING TO UNLOAD — no room for ${n(cargo)}${G}; the regolith store is full (it waits ${home ? 'on its pad' : 'at its dig'}, off the road)`
      : phase === 'dig' ? `DIGGING ${groundName(b.deposit)} · ${n(cargo)}/${n(bucket)}${G}`
      : phase === 'toDrop' ? `HAULING ${n(cargo)}${G} to ${drop ? label(drop) : 'a consumer'}`
      : phase === 'unload' ? `UNLOADING ${n(cargo)}${G} at ${drop ? label(drop) : 'a consumer'}`
      : `RETURNING to ${home ? 'its pad' : 'the dig'}`;
    // the nearest revealed deposits it could dig instead
    const nearby: DigOption[] = [];
    for (const d of deposits) {
      if (feedKindOf(d.kind) === 'plain' || !revealed(d)) continue;
      if (Math.hypot(digX - d.cx, digZ - d.cz) <= d.r) continue; // digging it already
      if (site.buildableRadiusM > 0 && Math.hypot(d.cx, d.cz) > site.buildableRadiusM) continue;
      const spot = digSpotIn(s, b, d);
      if (!spot) continue;
      nearby.push({
        id: d.id, kind: d.kind, name: DEPOSIT_INFO[d.kind].name, glyph: DEPOSIT_INFO[d.kind].glyph,
        x: spot[0], z: spot[1], distM: Math.round(Math.hypot(spot[0] - hx, spot[1] - hz)),
        rate: 0, feed: feedNote(d.kind, mods),
      });
    }
    nearby.sort((a, c) => a.distM - c.distM);
    nearby.length = Math.min(nearby.length, 3);
    for (const o of nearby) o.rate = tripFor(s, mods, b, o.x, o.z, digOutput(s, mods, site, b, o.kind)).rate;
    hauls[b.id] = {
      phase, line, cargo, bucket: bucket || spec.bucket, home, digName,
      dropName: trip.drop ? label(trip.drop) : '—', routeM: trip.routeM,
      rate: trip.rate, homeRate: homeTrip.rate, waiting, nearby, pack,
    };
  }
  return { rovers, sites, hauls, grading: gradeView(s, mods), ...hubViews(s, mods, site), survey: surveyFleetView(s, mods) };
}
