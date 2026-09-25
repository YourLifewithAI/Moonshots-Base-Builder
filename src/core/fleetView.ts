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
import { crewKW, crewRate, roversAt, siteEta, summonPick, surveyRover } from './fleet';
import { digsHome, haulSpec, tripFor } from './haul';
import { centerOf } from '../buildings/instances';
import { inside, worldRect } from './paths';
import { spurLeft, spurSeconds } from './roads';
import { PROSPECTS } from '../data/lunarMap';

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

function roverState(s: GameState, r: GameState['rovers'][number], survey: boolean): string {
  if (survey) {
    const a = s.survey.active;
    return a ? `OUT ON A SURVEY — ${PROSPECTS[a.id]?.short ?? a.id}` : 'OUT ON A SURVEY';
  }
  const site = r.site !== null ? s.buildings.find((b) => b.id === r.site) : undefined;
  const home = s.buildings.find((b) => b.id === r.home);
  if (!site && r.road !== undefined) {
    const j = s.roadJobs?.find((x) => x.id === r.road);
    const by = j?.by !== undefined ? s.buildings.find((b) => b.id === j.by) : undefined;
    return j?.kind === 'haul' && by ? `LAYING A HAUL ROAD — out to ${label(by)}'s dig` : 'LAYING A ROAD — the one you drew';
  }
  if (!site) return `PARKED — at ${home ? label(home) : 'its dock'}, free for the next site`;
  const pin = r.pinned ? ' · pinned' : '';
  if (!site.enabled) return `WAITING — ${label(site)} is paused${pin}`;
  if (site.idleReason === 'power') return `HELD — ${label(site)} has no power${pin}`;
  if (site.idleReason === 'inputs') return `HELD — ${label(site)} is out of weld parts${pin}`;
  if (site.idleReason === 'road') return `LAYING ROAD — out to ${label(site)} (${spurLeft(s, site)} cells to go)${pin}`;
  return `BUILDING — ${label(site)}${pin}`;
}

export function fleetView(
  s: GameState, mods: Mods, site: SiteDef, deposits: readonly Deposit[], revealed: (d: Deposit) => boolean,
): FleetView {
  const away = surveyRover(s);
  const at = new Map(s.buildings.map((b) => [b.id, b]));
  const rovers: RoverView[] = (s.rovers ?? []).map((r) => {
    const siteB = r.site !== null ? at.get(r.site) : undefined;
    const home = at.get(r.home);
    return {
      id: r.id, home: r.home, homeName: home ? label(home) : '—',
      site: r.site, siteName: siteB ? label(siteB) : '', pinned: r.pinned, survey: r.id === away,
      state: roverState(s, r, r.id === away),
    };
  });
  const sites: Record<number, SiteCrewView> = {};
  for (const b of s.buildings) {
    if (!isSite(b)) continue;
    const crew = roversAt(s, b.id);
    const n = b.enabled ? crew.length : 0;
    const roadS = spurSeconds(s, b);
    sites[b.id] = {
      n: crew.length, pinned: crew.filter((r) => r.pinned).length,
      eta: siteEta(mods, b, n, roadS), etaPlus: siteEta(mods, b, n + 1, roadS),
      kw: crewKW(mods, n), speed: crewRate(n), summon: summonPick(s, b.id).reason,
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
    const line = !b.enabled ? 'SHUT DOWN'
      : b.idleReason === 'power' ? `IDLE — no power · ${n(cargo)}/${n(bucket)}${G} aboard`
      : waiting ? `WAITING TO UNLOAD — no room for ${n(cargo)}${G}; the regolith store is full`
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
      rate: trip.rate, homeRate: homeTrip.rate, waiting, nearby,
    };
  }
  return { rovers, sites, hauls };
}
