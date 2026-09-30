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
  /** the site goes to the head of the robot queue (the milestone buildings: the first smelter, the parts fabricator) */
  rush?: boolean;
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
  /** caps the Builder's rules are raised to once the base is past Era 6 (S4; `RIVAL_LATE_ERA` in core/rival.ts) */
  lateCaps: Partial<Record<AutoRuleId, number>>;
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
  /** filled by stream S3 */
  uniqueBuildings: BuildingId[];
  uniqueTechs: TechId[];
  /** filled by stream S4 */
  policy: FactionPolicy;
}

/** the empty policy (a fresh object each: a faction edits its own) */
const noPolicy = (): FactionPolicy => ({
  research: [], destiny: {}, doctrines: {}, claimKinds: [], ruleCaps: {}, lateCaps: {}, orders: [],
});

// ─────────────────────────── the rivals' policies (stream S4) ───────────────────────────
// What a rival plays when nobody is at the keys (core/rival.ts reads these). Research: destiny picks and doctrines first
// (they gate the eras), then `research` in order, then the faction's own techs, then whatever is cheapest. The Builder's
// rules (every one on, at `ruleCaps`) place what the signals ask for; `orders` place what no rule does. `lateCaps`: a base past Era 6 draws
// 400–800 kW and its bank has to carry a volley's 400 (Autonomous Cadence), so batteries 10 and reactors 4 (the defaults, 6 and 1, leave
// the bank empty for ever: the Foundry sat at Era 8 for a fortnight without one volley). Earlier they would only take the metals and silicon
// the first outpost and the crew's life support need.

const hasCrew = (s: GameState) => s.expedition !== 'robotic' || s.crew > 0;
const eraAtLeast = (n: number) => (s: GameState) => s.era >= n;
/** game-minutes since the base landed */
const minutes = (s: GameState) => (s.simTime - (s.landedAt ?? 0)) / 60;

/** Labs by the clock: [minutes since landing, labs wanted]. The pacing probe's reasonable player (scripts/probe-pacing.mjs LAB_CLOCK)
 *  runs a robotic base at 3 labs by minute 14 and eight by 66; a rival follows that clock a fifth slower (×`slow`). A crewed base
 *  can only crew two before Construction Robotics (core/rival.ts `handsFor`), and gets the rest as agents run them. */
const LAB_CLOCK: [number, number][] = [[3.2, 1], [4, 2], [14, 3], [22, 4], [32, 5], [42, 6], [54, 7], [66, 8]];
function labsByClock(slow = 1.2): FactionOrder[] {
  return LAB_CLOCK.map(([m, n]) => ({ type: 'lab' as const, count: n, when: (s: GameState) => minutes(s) >= m * slow }));
}

/** The buildings no standing rule places, in the order a rival wants them (each entry: `count` of the type in all). The first
 *  of each kind is the rival's own (the rules extend what stands): power, the smelter (the dig), a lab, food and water for a
 *  crew, the parts fabricator, then what each tech unlocks. */
function orders(...extra: FactionOrder[]): FactionOrder[] {
  return [
    { type: 'solar', count: 2 },
    { type: 'smelter', count: 1, rush: true },
    { type: 'lab', count: 1 },
    { type: 'partsFab', count: 1, rush: true },
    { type: 'waterPlant', count: 1, when: (s) => hasCrew(s) && s.siteId === 'southpole', rush: true },
    { type: 'solar', count: 3 },
    { type: 'smelter', count: 2, when: (s) => minutes(s) > 6 }, // (metals are the gate to Era 2 — 450 smelted — and to every build)
    { type: 'refinery', count: 1 },
    { type: 'chipFab', count: 1 },
    ...extra,
    ...labsByClock(),
    { type: 'prospectingBay', count: 1, when: eraAtLeast(3) },
    { type: 'dataCenter', count: 1, when: eraAtLeast(5) },
    { type: 'serverMonolith', count: 1 },
    { type: 'greenhouseRing', count: 1, when: hasCrew },
    { type: 'droneHive', count: 1 },
    { type: 'dataCenter', count: 2, when: eraAtLeast(5) },
    { type: 'foilFactory', count: 1 },
    { type: 'massDriver', count: 1 },
    { type: 'propellantPlant', count: 1 },
    { type: 'gardenDome', count: 1, when: hasCrew },
    { type: 'dataCenter', count: 3, when: eraAtLeast(6) },
    { type: 'smelter', count: 3, when: eraAtLeast(5) },
    { type: 'foilFactory', count: 2, when: eraAtLeast(7) },
    { type: 'massDriver', count: 2, when: eraAtLeast(8) },
    { type: 'propellantPlant', count: 2, when: eraAtLeast(8) },
  ];
}

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
    uniqueBuildings: [], uniqueTechs: [],
    policy: {
      // power, robotics, compute, materials: the landing branch's lanes first
      research: [
        // era 1: the two cheapest (Era 2 opens with two techs and 450 smelted), then era 2 at once: parts, silicon for the batteries, the
        // night, the builders; Prospecting Drones (the survey's data, the first outpost slot) wait for them
        'regolithProcessing', 'bifacialCells',
        'partsFabrication', 'siliconRefining', 'batteryStorage', 'constructionRobotics', 'prospectingRovers', 'mpptInverters',
        // era 3: the night's baseload, better siting, the builders' doctrine
        'regolithShielding', 'thoriumPower', 'siteSurveyAI', 'swarmRobotics', 'refluxColumns',
        // era 4: chips (the claim's price, the Data Center's), the survey's second tier
        'waferFab', 'orbitalProspector', 'radHardProcess', 'braytonConverters', 'roverAutonomy',
        // era 5: compute
        'lunarDataCenter', 'cryoRadiators', 'wingExtensions', 'dynamicClocking', 'autoSmelting',
        // era 6: the far side's relay (a second outpost), the pick that waives the crew tech
        'farSideRelay', 'launchSiteSurvey', 'solidStateCells', 'autoFabrication', 'predictiveScheduling',
        // era 7 and 8: foils, the launch doctrine, the swarm
        'foilManufacturing', 'massDriver', 'propellantDepot', 'selfReplication', 'maintenanceAutomation', 'rollToRoll',
        'swarmProtocol', 'canisterPress', 'railCapacitors', 'cryocoolerHeads', 'vonNeumann', 'powerBeaming',
      ],
      destiny: 'automation',
      doctrines: {
        smeltDoctrine: 'moltenElectrolysis', nightPower: 'thoriumPower', constructionDoctrine: 'swarmRobotics',
        chipDoctrine: 'acceleratorDesign', launchArchitecture: 'massDriver', swarmPurpose: 'vonNeumann',
      },
      claimKinds: ['ilmenite', 'glass', 'silica', 'kreep'],
      ruleCaps: {},
      lateCaps: { battery: 10, reactor: 4 },
      orders: orders(),
    },
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
    uniqueBuildings: [], uniqueTechs: [],
    policy: {
      // compute, materials, robotics: labs run hot and the data is cheap
      research: [
        // era 1: the cheapest and the water tech (Era 2 opens with two techs and 450 smelted), then era 2 at once: parts, the agents that run
        // what hands cannot, silicon for the batteries, Bench Robots (a lab on one seat); Prospecting Drones follow
        'regolithProcessing', 'iceExtraction', 'regolithVolatiles',
        'partsFabrication', 'constructionRobotics', 'siliconRefining', 'batteryStorage', 'benchRobots', 'prospectingRovers', 'moltenElectrolysis',
        // era 3: compute and baseload
        'regolithShielding', 'thoriumPower', 'siteSurveyAI', 'refluxColumns', 'cryoSampleStore', 'swarmRobotics',
        // era 4: chips, the survey's second tier
        'waferFab', 'radHardProcess', 'orbitalProspector', 'waferPolishing', 'cleanroomRobotics', 'budgetGovernor',
        // era 5: the Data Center
        'lunarDataCenter', 'dynamicClocking', 'immersionLitho', 'cryoRadiators',
        // era 6
        'scienceCrews', 'uplinkDishes', 'farSideRelay', 'launchSiteSurvey', 'predictiveScheduling',
        // era 7 and 8
        'foilManufacturing', 'propellantDepot', 'massDriver', 'rackDensification', 'liquidCooling',
        'swarmProtocol', 'canisterPress', 'railCapacitors', 'cryocoolerHeads', 'powerBeaming', 'vonNeumann',
      ],
      // colony early, automation from Era 5
      destiny: { 2: 'colony', 3: 'colony', 4: 'colony', 5: 'automation', 6: 'automation', 7: 'automation', 8: 'automation' },
      doctrines: {
        smeltDoctrine: 'moltenElectrolysis', nightPower: 'thoriumPower', constructionDoctrine: 'swarmRobotics',
        chipDoctrine: 'radHardProcess', launchArchitecture: 'propellantDepot', swarmPurpose: 'powerBeaming',
      },
      claimKinds: ['ice', 'ilmenite', 'radio'],
      ruleCaps: { food: 2 },
      lateCaps: { battery: 10, reactor: 4 },
      orders: orders(),
    },
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
    uniqueBuildings: [], uniqueTechs: [],
    policy: {
      // habitat, power, compute: a crew that eats well and a base that does not break
      research: [
        // era 1: the water tech (a sixth of its usual price here) and the cheapest (Era 2 opens with two techs and 450 smelted), then era 2
        // at once: parts, agents, silicon, the night, shielding; Prospecting Drones follow
        'regolithVolatiles', 'iceExtraction', 'regolithProcessing',
        'partsFabrication', 'constructionRobotics', 'siliconRefining', 'batteryStorage', 'regolithShielding', 'benchRobots', 'prospectingRovers',
        'moltenElectrolysis', 'sublimationTents',
        // era 3: baseload, beds and the water loop, siting
        'thoriumPower', 'waterReclamation', 'bunkRacks', 'siteSurveyAI', 'refluxColumns', 'swarmRobotics',
        // era 4: chips, the gardens, oxygen from water
        'waferFab', 'growLights', 'waterElectrolysis', 'radHardProcess', 'orbitalProspector', 'heatedAugers',
        // era 5: the Data Center, the commons' comforts
        'lunarDataCenter', 'crewWellness', 'nutrientRecirculation', 'cryoRadiators', 'dynamicClocking',
        // era 6
        'closedLoopLS', 'safetyProtocols', 'scienceCrews', 'farSideRelay', 'launchSiteSurvey', 'galleyGarden',
        // era 7 and 8
        'foilManufacturing', 'propellantDepot', 'massDriver', 'lowGCourt', 'rollToRoll',
        'swarmProtocol', 'canisterPress', 'cryocoolerHeads', 'railCapacitors', 'powerBeaming', 'vonNeumann',
      ],
      destiny: 'colony',
      doctrines: {
        smeltDoctrine: 'moltenElectrolysis', nightPower: 'thoriumPower', constructionDoctrine: 'swarmRobotics',
        chipDoctrine: 'radHardProcess', launchArchitecture: 'propellantDepot', swarmPurpose: 'powerBeaming',
      },
      claimKinds: ['ice', 'volatiles', 'silica'],
      ruleCaps: { food: 2 },
      lateCaps: { battery: 10, reactor: 4 },
      orders: orders(),
    },
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
