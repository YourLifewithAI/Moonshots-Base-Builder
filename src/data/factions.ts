/** The three playable factions of docs/20 (factions and the race): the two you do
 *  not play are the rival programs on the same Moon. Ids are stable; names, glyphs,
 *  copy and numbers are placeholders the balance pass (stream S8) tunes here.
 *
 *  Every trait of a faction is a TECH EFFECT on its landing tech (data/techs.ts:
 *  landingFoundry / landingVanguard / landingCommons), so traits flow through
 *  computeMods and effectApplies with no special-casing; this file holds only the
 *  identity, the copy, the art colours and the rival's POLICY.
 *
 *  The solo game (?site=… with no faction) never reads it: a state with no `faction`
 *  plays exactly as before on the legacy landings (landingCrew / landingRobotic). */
import type { BuildingId } from './buildings';
import type { AutoRuleId } from './automation';
import type { OutpostKind } from './lunarMap';
import type { SiteId } from './sites';
import type { DoctrineId, Era, Expedition, Side, TechId } from './techs';
import type { GameState } from '../core/state';
import type { Mods } from '../core/mods';

export type FactionId = 'robots' | 'accelerationists' | 'solarpunks';

/** landing order on the Moon clock (day 0, 2, 4) */
export const FACTION_ORDER: FactionId[] = ['robots', 'accelerationists', 'solarpunks'];

/** hull / trim / suit colours of the art (CSS hex; docs/20 §7: celColors, EVA walkers, map and HUD) */
export interface FactionLivery { hull: string; trim: string; suit: string }

/** A building a rival's Builder places by an explicit order: no standing rule places it
 *  (mass driver, propellant plant, Data Center, Prospecting Bay, destiny buildings, the faction's own). */
export interface FactionOrder {
  type: BuildingId;
  count: number;
  /** omitted: always (once the building is unlocked) */
  when?: (s: GameState, mods: Mods) => boolean;
}

/** What the rival runner (stream S4, core/rival.ts) plays when nobody is at the keys.
 *  Typed here with EMPTY defaults: stream S4 fills them. Empty means: no priority
 *  (the runner's generic research order), the landing's side, no doctrine pinned,
 *  every outpost kind, the Builder's stock caps, no extra orders. */
export interface FactionPolicy {
  /** research priority list, first wanted first */
  research: TechId[];
  /** the destiny side per era; a bare Side means every era; {} follows the landing's side */
  destiny: Side | Partial<Record<Era, Side>>;
  /** the tech the rival takes when a doctrine group asks */
  doctrines: Partial<Record<DoctrineId, TechId>>;
  /** outpost kinds it claims, preferred first ([] = any) */
  claimKinds: OutpostKind[];
  /** caps on the Builder's standing rules, by rule id */
  ruleCaps: Partial<Record<AutoRuleId, number>>;
  orders: FactionOrder[];
}

export interface FactionDef {
  id: FactionId;
  /** The Foundry / The Vanguard / The Commons */
  name: string;
  /** Foundry / Vanguard / Commons (chips, tooltips) */
  short: string;
  glyph: string;
  /** derived from the faction: robots fly robotic, the two crewed programs human */
  expedition: Expedition;
  /** the Moon clock: day 0 is the robots' landing; every landing is at mid-morning of its day */
  landsAtDay: number;
  /** site preference, first wanted first: a player takes theirs, the rivals the rest in this order */
  sites: SiteId[];
  livery: FactionLivery;
  /** the landing tech the faction's traits ride on */
  landingTech: TechId;
  /** one line */
  ethos: string;
  /** 2–3 sentences for the briefing */
  briefing: string;
  advantages: string[];
  disadvantages: string[];
  /** the faction's own buildings and the eight techs of its branch, in era order (data/techs.ts, data/buildings.ts: stream S3) */
  uniqueBuildings: BuildingId[];
  uniqueTechs: TechId[];
  /** filled by stream S4 */
  policy: FactionPolicy;
}

/** the empty policy every faction starts with (a fresh object each: S4 edits them apart) */
const noPolicy = (): FactionPolicy => ({
  research: [], destiny: {}, doctrines: {}, claimKinds: [], ruleCaps: {}, orders: [],
});

export const FACTIONS: Record<FactionId, FactionDef> = {
  robots: {
    id: 'robots',
    name: 'The Foundry', short: 'Foundry', glyph: '⚙',
    expedition: 'robotic', landsAtDay: 0,
    sites: ['mare', 'lavatube', 'southpole'],
    livery: { hull: '#5b6068', trim: '#e8632b', suit: '#d9d4c8' },
    landingTech: 'landingFoundry',
    ethos: 'Machines first; people optional, later, if ever.',
    briefing: 'Nobody aboard: a lander full of machines that never tire, never eat and never ask to go home. ' +
      'You buy time with them, and pay for it twice: the Sun’s flares hit your arrays and your controllers harder than anyone’s, ' +
      'and through the long night your machines crawl on a thin, leaky bank.',
    advantages: [
      'Time: the first lander on the Moon, on day 0, with no life support to build',
      'Build time ×0.9',
      'Robotics and compute research ×0.85 cost',
      'Drones fly ×1.15 as far',
      'Colony picks can still bring a crew later',
    ],
    disadvantages: [
      'Flares: arrays take ×1.6 damage; machine reboot, latch and burn ×1.75',
      'Night: stations and units run at ×0.25 output, standby draw ×1.3',
      'The bank charges at 75 % and discharges ×1.25 as fast',
    ],
    uniqueBuildings: ['nightVault', 'faradayShed'],
    uniqueTechs: [
      'nightVaultDocks', 'faradaySheds', 'hardenedFirmware', 'isotopeWarmers', 'bankTrenches', 'selfRepairCells',
      'lightsOutFoundry', 'swarmRelayUplink',
    ],
    policy: noPolicy(),
  },
  accelerationists: {
    id: 'accelerationists',
    name: 'The Vanguard', short: 'Vanguard', glyph: '▲',
    expedition: 'human', landsAtDay: 2,
    sites: ['southpole', 'mare', 'lavatube'],
    livery: { hull: '#f2f3f5', trim: '#2f5fd0', suit: '#f2f3f5' },
    landingTech: 'landingVanguard',
    ethos: 'Move fast, publish, own the launch window.',
    briefing: 'Seven people land two days behind the Foundry, and they mean to take the launch window back. ' +
      'Their labs run hot and their data is cheap, but the whole world is watching: every death, wreck or accident ' +
      'feeds a scrutiny meter, and a hearing can bring a quarter of the crew home.',
    advantages: [
      'Seven crew from day 2',
      'Lab data ×1.35, Data Center ×1.2',
      'Compute and materials research ×0.8 cost',
      '+100 starting data',
    ],
    disadvantages: [
      'Morale base −8, and it falls ×2 faster',
      'Scrutiny: any death, wreck or accident raises a meter; above 50 crewed output ×0.7 and research ×0.8; ' +
        'above 80 a hearing recalls a quarter of the crew to Earth',
      'Hazard rate ×1.25',
      'Colony picks cost ×1.15',
    ],
    uniqueBuildings: ['missionOps', 'skunkworks'],
    uniqueTechs: [
      'pressCorps', 'crunchCulture', 'hazardWaivers', 'skunkworksLabs', 'hearingPrep', 'ventureFoils', 'launchFever',
      'mediaBlitz',
    ],
    policy: noPolicy(),
  },
  solarpunks: {
    id: 'solarpunks',
    name: 'The Commons', short: 'Commons', glyph: '❀',
    expedition: 'human', landsAtDay: 4,
    sites: ['lavatube', 'southpole', 'mare'],
    livery: { hull: '#d9c9a3', trim: '#5f9f3f', suit: '#e8dcb8' },
    landingTech: 'landingCommons',
    ethos: 'Live well on the Moon; the swarm as a commons against the other two.',
    briefing: 'The last to land, and the only program that came to stay. A well-fed, well-warned crew ' +
      'is slow to build and dear in steel and machines, but it does not break, and it grows. ' +
      'The swarm is everybody’s sky, and the Commons mean to keep a share of it.',
    advantages: [
      'Morale base +10',
      'Hazard rate ×0.6, and the safety guard from landing (longer warnings)',
      'Habitat research ×0.6 cost',
      'Settlers arrive ×1.25 as often',
      'Colony picks cost ×0.85',
    ],
    disadvantages: [
      'Build time ×1.3',
      'Materials, robotics and exploration research ×1.3 cost',
      'Lands last: day 4',
    ],
    uniqueBuildings: ['commonsHall', 'regolithTerrace'],
    uniqueTechs: [
      'commonsCharter', 'mutualAidDrills', 'slowBuildDoctrine', 'regolithTerraces', 'consensusCouncil', 'cooperativeSwarm',
      'guardianship', 'longNightGardens',
    ],
    policy: noPolicy(),
  },
};

export const FACTION_NAME: Record<FactionId, string> = {
  robots: FACTIONS.robots.name,
  accelerationists: FACTIONS.accelerationists.name,
  solarpunks: FACTIONS.solarpunks.name,
};

/** The faction each expedition plays as in the legacy (solo) mapping: robotic → the Foundry,
 *  human → the Vanguard. The Commons are reached only by id. */
export function factionOf(expedition: Expedition): FactionId {
  return expedition === 'robotic' ? 'robots' : 'accelerationists';
}

/** each faction's landing tech (traits ride on it; it is pushed into techsDone at landing) */
export const LANDING_TECH_FOR: Record<FactionId, TechId> = {
  robots: FACTIONS.robots.landingTech,
  accelerationists: FACTIONS.accelerationists.landingTech,
  solarpunks: FACTIONS.solarpunks.landingTech,
};

/** The faction a building belongs to (docs/20 §1), or undefined for every shared building */
export function factionOfBuilding(b: BuildingId): FactionId | undefined {
  return FACTION_ORDER.find((f) => FACTIONS[f].uniqueBuildings.includes(b));
}

export const isFactionId = (v: unknown): v is FactionId =>
  v === 'robots' || v === 'accelerationists' || v === 'solarpunks';

/** The faction of a state, read defensively: GameState gains `faction?` in stream W0c,
 *  and a solo game (or an older save) has none: undefined. */
export function factionOfState(s: object | null | undefined): FactionId | undefined {
  const f = (s as { faction?: FactionId | null } | null | undefined)?.faction;
  return isFactionId(f) ? f : undefined;
}

/** Where each faction lands in a game the player starts as `playerFaction` at `playerSite` (docs/20 §1):
 *  the player takes the site they chose, and the others, in landing order (FACTION_ORDER), each take the first site of
 *  their own preference that is not taken yet. Every game uses all three sites, so the result is three distinct sites
 *  (a faction always finds one: at most two are taken when it picks). */
export function assignSites(playerFaction: FactionId, playerSite: SiteId): Record<FactionId, SiteId> {
  const taken = new Set<SiteId>([playerSite]);
  const out = { [playerFaction]: playerSite } as Record<FactionId, SiteId>;
  for (const f of FACTION_ORDER) {
    if (f === playerFaction) continue;
    const site = FACTIONS[f].sites.find((s) => !taken.has(s)) as SiteId;
    taken.add(site);
    out[f] = site;
  }
  return out;
}
