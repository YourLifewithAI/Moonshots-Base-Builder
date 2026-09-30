/** 106 technologies in 7 swimlanes × 8 eras — the robots-first arc of lunar
 *  development (docs/11-research-and-map-spec.md §3, expanded by
 *  docs/12-tree-expansion.md; the twelve Builder techs of docs/13 open
 *  orders and standing rules, data/automation.ts). Era N opens with 4 of era N−1's techs, or 2
 *  plus that era's deed (ERA_GATES). Six doctrines are permanent either/or
 *  picks. Every card's pros and cons are generated from its effects by
 *  describeEffect(); `tradeoff` is flavour only, `visual` names the mesh
 *  change the tech makes (buildings/upgrades.ts).
 *  Availability, cost and the queue live in core/research.ts. */
import { BUILDINGS, type BuildingId } from './buildings';
import { RESOURCES, type ResourceId } from './resources';
import { SITES, SITE_ORDER, type SiteId } from './sites';
import { DEPOSIT_INFO, siteHasDeposit, type DepositKind, type FeedKind } from './deposits';
import { EXPOSURE_TEXT, GUARD_TEXT, HAZARDS_LIVE, HAZARD_NAME, type GuardId, type HazardId } from './hazards';
import { AUTO, FAMILY_LABEL, RULES, RULE_TEXT, rulesOf, type AutoFamily } from './automation';
import type { ProspectId } from './lunarMap';
import { LANDING_TECH_FOR, type FactionId } from './factions';
import { FORECAST } from './forecast';
import type { GameState } from '../core/state';
import {
  AGENT_TAX, BATTERY_EFF, BEAM_KW_PER_LAUNCH, CONSTRUCTION_KW, DOWNLINK, FEED,
  GRADE_JOB, HAUL, LAUNCH_CAP_PER_VOLLEY, LAUNCH_COST_FOILS, LAUNCH_POWER_BURST,
  MAX_SLOPE_LARGE, OVERCLOCK, SURVEY_DRONE, SURVEY_TIERS,
  CREW_ROTATION, EVA, PURE_AT, UNIT_POWER,
} from './balance';

export type Era = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type Expedition = 'human' | 'robotic';
export type Lane = 'power' | 'materials' | 'robotics' | 'compute' | 'habitat' | 'exploration' | 'export';
export type DoctrineId =
  | 'smeltDoctrine' | 'nightPower' | 'constructionDoctrine' | 'chipDoctrine' | 'launchArchitecture' | 'swarmPurpose';

export type TechId =
  // era 1 — first landing
  | 'regolithProcessing' | 'teleoperation' | 'prospectingRovers' | 'siteGrading' | 'iceExtraction' | 'regolithVolatiles'
  | 'bifacialCells' | 'grizzlyScreens' | 'sampleCaches' | 'fieldSpectrometers'
  // era 2 — early construction
  | 'batteryStorage' | 'thermalWadis' | 'peakLightMasts' | 'skylightHeliostats' | 'siliconRefining'
  | 'partsFabrication' | 'constructionRobotics' | 'regolithShielding' | 'moltenElectrolysis' | 'ilmeniteBeneficiation'
  | 'mpptInverters' | 'heatRecoveryJackets' | 'sublimationTents' | 'neutronSpectrometry' | 'benchRobots'
  | 'buildOrders' | 'roverPowerPacks'
  | 'heliophysicsForecasting'
  | 'bayExtensions' | 'hardfacedTeeth'
  // era 3 — robotic fabrication
  | 'thoriumPower' | 'regenFuelCells' | 'swarmRobotics' | 'heavyConstructors' | 'dustMitigation' | 'btLavaTubeCaverns'
  | 'stackedCells' | 'slagRecycling' | 'refluxColumns' | 'cryoSampleStore' | 'bunkRacks'
  | 'autoExcavation' | 'siteSurveyAI'
  | 'basaltPaving'
  | 'waterReclamation'
  // era 4 — chip fabrication
  | 'waferFab' | 'acceleratorDesign' | 'radHardProcess' | 'cleanroomRobotics' | 'orbitalProspector' | 'btVolcanicGlass'
  | 'braytonConverters' | 'pressureTanks' | 'mliBlankets' | 'waferPolishing' | 'oreSorting' | 'heatedAugers' | 'growLights'
  | 'roverAutonomy' | 'fuelCellPacks'
  | 'autoPower' | 'budgetGovernor' | 'autoLifeSupport'
  | 'waterElectrolysis' | 'deepCoring'
  // era 5 — lunar compute
  | 'lunarDataCenter' | 'dynamicClocking' | 'cryoRadiators' | 'crewWellness'
  | 'wingExtensions' | 'deployableRadiators' | 'oxygenLiquefaction' | 'immersionLitho' | 'toolChangers'
  | 'nutrientRecirculation' | 'gravimetry' | 'autonomousHaulage' | 'radioisotopeUnits'
  | 'autoSmelting' | 'feedPlanner'
  | 'guidanceBeacons'
  | 'l1Sentinel'
  | 'depotHalls'
  // era 6 — human habitation
  | 'humanCohabitation' | 'closedLoopLS' | 'safetyProtocols' | 'conditionOptimization' | 'scienceCrews'
  | 'farSideRelay' | 'btColdTrapChemistry'
  | 'solidStateCells' | 'highBurnupFuel' | 'refractoryLinings' | 'predictiveMaintenance' | 'uplinkDishes' | 'galleyGarden'
  | 'launchSiteSurvey'
  | 'autoFabrication' | 'predictiveScheduling'
  | 'guidewayRails'
  | 'solarCycleForecasting'
  // era 7 — swarm industry
  | 'foilManufacturing' | 'massDriver' | 'propellantDepot' | 'selfReplication' | 'deepSounding'
  | 'superconductingBus' | 'rollToRoll' | 'foilAnnealing' | 'liquidCooling' | 'rackDensification' | 'lowGCourt'
  | 'laserRanging'
  | 'selfExpandingBase' | 'maintenanceAutomation'
  | 'maglevFreight'
  // era 8 — dyson swarm (lane-free capstone column)
  | 'swarmProtocol' | 'powerBeaming' | 'vonNeumann' | 'railCapacitors' | 'cryocoolerHeads' | 'canisterPress'
  // destiny (docs/14): the landing, a ⌂ Colony / ◉ Automation pick for eras 2–8, the three capstones
  | 'landingCrew' | 'landingRobotic'
  // the three faction landings (docs/20 §1): their traits are these techs' effects
  | 'landingFoundry' | 'landingVanguard' | 'landingCommons'
  | 'pressureHalls' | 'dispatchMesh' | 'crewCharter' | 'droneHives' | 'hydroCommons' | 'lightsOutFabs'
  | 'greenhouseRings' | 'fleetOS' | 'settlerCharter' | 'lightsOutCharter' | 'gardenDomes' | 'replicatorStacks'
  | 'missionControl' | 'autoCadence'
  | 'commonwealth' | 'selenicMind' | 'concord'
  // the faction branches (docs/20 §3): 8 techs per faction, each in its lane and era (drawn in the page's ⚑ FACTION row)
  | 'nightVaultDocks' | 'faradaySheds' | 'hardenedFirmware' | 'isotopeWarmers' | 'bankTrenches' | 'selfRepairCells'
  | 'lightsOutFoundry' | 'swarmRelayUplink'
  | 'pressCorps' | 'crunchCulture' | 'hazardWaivers' | 'skunkworksLabs' | 'hearingPrep' | 'ventureFoils' | 'launchFever'
  | 'mediaBlitz'
  | 'commonsCharter' | 'mutualAidDrills' | 'slowBuildDoctrine' | 'regolithTerraces' | 'consensusCouncil'
  | 'cooperativeSwarm' | 'guardianship' | 'longNightGardens';

/** the two destinies (docs/14 §2): ⌂ humans settle the Moon, ◉ the Moon runs itself */
export type Side = 'colony' | 'automation';
/** where the eight picks land: a pure destiny (6 of 8 on one side), or Concord */
export type Band = Side | 'concord';

/** Any effect may be limited to some sites / expeditions / factions; computeMods skips it elsewhere.
 *  `crew`: only where people live — human runs, and robotic runs once Human
 *  Cohabitation is done (the card line says `(with crew)`). */
export interface EffectFilter {
  sites?: SiteId[]; expeditions?: Expedition[]; crew?: true;
  /** only on these factions' bases (docs/20 §3); a solo game (no faction) skips every effect that has one */
  factions?: FactionId[];
}

export interface RecipeOverride {
  inputs?: Partial<Record<ResourceId, number>>;
  outputs?: Partial<Record<ResourceId, number>>;
  powerKW?: number;
  /** output ignores the feed grade (MRE melts any soil) */
  feedInsensitive?: boolean;
}

export type TechEffect = EffectFilter & (
  | { kind: 'unlock'; building: BuildingId }
  | { kind: 'outputMult'; buildings: BuildingId[]; mult: number; crewedOnly?: true;
      /** only while the station runs on agents (an unmanned base, or the Autonomous toggle): mods.agentOutputMult (docs/20, Lights-Out Foundry) */
      agentOnly?: true }
  | { kind: 'inputMult'; buildings: BuildingId[]; mult: number }
  | { kind: 'powerMult'; buildings: BuildingId[]; mult: number }
  | { kind: 'upkeepMult'; buildings: BuildingId[] | 'all'; mult: number }
  | { kind: 'crewDelta'; buildings: BuildingId[]; delta: number }
  | { kind: 'dustMult'; mult: number }
  | { kind: 'buildSpeed'; mult: number }        // global construction time multiplier
  | { kind: 'botPerBay'; delta: number }        // extra robots per Robotics Bay
  | { kind: 'launchAction' }
  | { kind: 'powerBeam' }
  | { kind: 'automation' }
  | { kind: 'grading' }
  | ({ kind: 'recipe'; building: BuildingId } & RecipeOverride)
  | { kind: 'agentTax'; mult: number }
  | { kind: 'construction'; kwMult?: number; rateMult?: number; partsMult?: number }
  | { kind: 'storage'; capacityMult?: number; efficiency?: number }
  | { kind: 'repair'; mult: number }
  | { kind: 'shadeImmune' }
  | { kind: 'buildTime'; buildings: BuildingId[]; mult: number }
  | { kind: 'action'; id: 'overclock' | 'downlink' | 'sentinel' | 'electrolysis' }
  | { kind: 'survey'; tier?: 1 | 2 | 3 | 4; dataMult?: number; minCrew?: number;
      /** the deposit survey (docs/17 §13): its precision (±share), its rover-seconds ×, and
       *  the deposit kinds Relay Masts survey free in their radius */
      precision?: number; depositTimeMult?: number; mastSurvey?: DepositKind[];
      /** the survey-drone fleet (docs/19 S6): the level a Prospecting Bay reaches (2 bays a level),
       *  and the drones' flight range ×range (their flights take 1/range as long) */
      bayLevel?: 2 | 3; range?: number }
  /** ore grade (docs/17 §9.1): every load's q ×mult (process 'H2': hydrogen reduction's only) */
  | { kind: 'grade'; mult: number; process?: 'H2' }
  /** bedrock benches (docs/17 §8.5): every pit may cut this many 2 m benches below its loose layer */
  | { kind: 'pitDepth'; benches: number }
  | { kind: 'powerDelta'; building: BuildingId; kw: number }
  | { kind: 'nightDraw'; night: number; day: number }
  | { kind: 'feedBonus'; deposit: FeedKind; mult: number }
  | { kind: 'housing'; building: BuildingId; delta: number }   // beds per building of that type
  | { kind: 'morale'; building: BuildingId; delta: number }    // morale while that building runs
  /** excavator haul cycle: drive speed, and bucket size (its dig time grows with it) */
  | { kind: 'haul'; speedMult?: number; bucketMult?: number; offroadMult?: number; digMult?: number }
  /** Hubs buy each new level locally; destiny bay grants are free capacity. */
  | { kind: 'hubLevel'; level: 2 | 3 }
  | { kind: 'hubBays'; delta: number }
  | { kind: 'hubPrint'; timeMult?: number; costMult?: number }
  /** Crew and farm water recovered while an operating Water Plant closes the loop. */
  | { kind: 'reclaim'; water: number }
  /** the roadway (docs/15-roads.md): travel on roads (all, excavators alone,
   *  at night), road dust, and the sintering a cell takes */
  | { kind: 'road'; speedMult?: number; haulMult?: number; nightMult?: number; dustMult?: number; cellMult?: number }
  /** on-board power (core/unitPower.ts, docs/02 · On-board power): every rover's, drone's
   *  and excavator's pack ×packMult, their driving draw ×driveMult, the
   *  charger's efficiency ×chargeEff; `rpu`: a Radioisotope Power Unit aboard each */
  | { kind: 'unitPower'; packMult?: number; driveMult?: number; chargeEff?: number; rpu?: true }
  // ── the Builder (docs/13, core/automation.ts) ──
  /** held orders and the order book */
  | { kind: 'orders'; book: number; maxCount: number }
  /** a family of standing rules */
  | { kind: 'autoRule'; family: AutoFamily }
  /** Site Survey AI: auto sites weigh deposits, peaks of light and haul lanes */
  | { kind: 'siting' }
  /** Budget Governor: reserve floors, rule priority, crisis sites first */
  | { kind: 'governor' }
  /** Predictive Scheduling: rules act on forecasts while a Data Center runs */
  | { kind: 'predictive' }
  /** Feed Planner: excavators re-aimed at the feed the furnaces want */
  | { kind: 'feedPlanner' }
  /** Maintenance Automation: parts triage, worn machines replaced at this wear */
  | { kind: 'maintenance'; wear: number }
  /** extends the Builder (docs/14 Automation picks): rule dwell and caps, extra families;
   *  `all`: rules may build the destiny buildings too (Selenic Mind) */
  | { kind: 'builder'; dwellMult?: number; capMult?: number; families?: AutoFamily[]; all?: true }
  // ── destiny (docs/14 §2.7) ──
  /** crew growth period ×mult (0 = no new settlers are invited) */
  | { kind: 'growth'; mult: number }
  /** robotic runs: brings Human Cohabitation forward and its crew rotation (research.onTechComplete) */
  | { kind: 'bringsCrew' }
  /** a charter requirement waived (robotic Era 7 without Human Cohabitation) */
  | { kind: 'waive'; tech: TechId }
  /** EVA crews by day: this share of the free hands goes outside (dust and repair bonuses) */
  | { kind: 'eva'; share: number }
  /** a building's build-network radius, +deltaM */
  | { kind: 'radius'; building: BuildingId; deltaM: number }
  /** crewed launches: ↑ per volley, morale for a lunar day, crew on console for it */
  | { kind: 'volley'; launchCap?: number; morale?: number; minCrew?: number }
  /** volleys fire themselves when ready; the burst ×burstMult */
  | { kind: 'autoLaunch'; burstMult?: number }
  /** morale target everywhere */
  | { kind: 'moraleBase'; delta: number }
  /** hazard windows (docs/14 §3.2) come ×1/mult as often */
  | { kind: 'hazardRate'; mult: number }
  /** a hazard guard (docs/14 §3.6, read by core/hazards.ts) */
  | { kind: 'guard'; guard: GuardId }
  /** what a pick puts at risk (docs/14 §2.7, read by core/hazards.ts) */
  | { kind: 'exposure'; hazard: HazardId; buildings?: BuildingId[] }
  /** space weather (docs/16 §13.3): field berms — stowed arrays fold behind a low berm, σ */
  | { kind: 'stowShield'; sigma: number }
  /** flare forecasting (docs/16 §6, core/forecast.ts): the tier this tech makes possible */
  | { kind: 'forecast'; tier: 1 | 2 | 3 }
  // ── factions (docs/20 §3; the readers come with stream S2, the cost readers are core/research.ts) ──
  /** a lane's research costs ×mult (techCost) */
  | { kind: 'laneCost'; lane: Lane; mult: number }
  /** a destiny side's picks cost ×mult (techCost, `track` techs that are not the landing) */
  | { kind: 'pickCost'; side: Side; mult: number }
  /** flare damage: solar arrays ×arrayHard (mods.arrayHardMult), machine reboot / latch / burn ×machine (mods.machineFlareMult) */
  | { kind: 'flareVuln'; arrayHard?: number; machine?: number }
  /** the long night: stations and units' output ×output (ABSOLUTE: several nightMode effects take the best output, so a
   *  later relief such as Isotope Warmers' 0.5 replaces the landing's 0.25 rather than multiplying it), standby draw ×standby,
   *  bank charge efficiency chargeEff (absolute: the worse of it and the grid's), bank discharge ×discharge.
   *  `relief`: the effect eases the faction's own night penalty (the card reads it as a pro: `×0.25 → ×0.5`) */
  | { kind: 'nightMode'; output?: number; standby?: number; chargeEff?: number; discharge?: number; relief?: true }
  /** morale falls ×fallMult as fast (the rise is untouched) */
  | { kind: 'moraleDynamics'; fallMult: number }
  /** the scrutiny meter (core/scrutiny.ts, stream S2): `on` makes it live (the Vanguard's landing); the rest tunes it:
   *  it fades ×decay as fast (mods.scrutinyDecayMult), a HEARING recalls ×recall as many crew (scrutinyRecallMult),
   *  and FIRST LIGHT clears the meter and lifts morale for a lunar day (firstLightClearsScrutiny, firstLightMorale) */
  | { kind: 'scrutiny'; on?: true; decay?: number; recall?: number; firstLight?: { clear?: true; morale?: number } }
  /** a volley's foils ×mult (mods.volleyFoilsMult; economy's volleyTerms) */
  | { kind: 'volleyFoils'; mult: number }
  /** another program's disaster grants this much data (mods.rivalAidData; the rival events of streams S4/S6 read it) */
  | { kind: 'rivalAid'; data: number }
  /** these buildings' output ×mult at night (mods.nightBuildingMult; effectiveRates reads it with `isNight`) */
  | { kind: 'nightOutput'; buildings: BuildingId[]; mult: number }
  /** a one-time grant when the tech completes (research.onTechComplete; the landing tech's is applied at landing) */
  | { kind: 'grant'; data?: number }
);
export type TechEffectKind = TechEffect['kind'];

export interface TechDef {
  id: TechId;
  era: Era;
  /** omitted for the era-8 capstone column */
  lane?: Lane;
  name: string;
  /** ≤18 chars, for tree cards */
  short: string;
  costData: number;
  costGoods?: Partial<Record<ResourceId, number>>;
  requires: TechId[];
  /** at least one visible member must be done (hidden members never count) */
  requiresAny?: TechId[];
  exclusive?: DoctrineId;
  sites?: SiteId[];
  expeditions?: Expedition[];
  /** human-comfort tech: on robotic runs visible but locked until Human Cohabitation */
  crewTech?: boolean;
  /** robotic-run overrides, merged by resolveTech() (robotic resolves through the Foundry) */
  robotic?: { era?: Era; costData?: number };
  /** faction-locked (docs/20 §3): visible only to these factions, never in a solo game (techVisible) */
  factions?: FactionId[];
  /** an ethos lock (docs/20 §3): visible to a solo game and to every faction EXCEPT these (`⚑ not open to The Commons`) */
  notFactions?: FactionId[];
  /** per-faction overrides, merged by resolveTech(faction) after `robotic` */
  factionOverride?: Partial<Record<FactionId, { era?: Era; costData?: number; name?: string; short?: string; desc?: string }>>;
  /** hidden until one of its hosts is surveyed; fixed Exploration-lane slot */
  breakthrough?: { hosts: ProspectId[]; slot: 1 | 2 };
  effects: TechEffect[];
  desc: string;
  /** flavour only — the mechanical pros and cons come from describeEffect() */
  tradeoff: string;
  /** one sentence: what visibly changes in the base when it completes (the
   *  discovery pop-up shows it; buildings/upgrades.ts carries the mesh part,
   *  and for a pure unlock it is the building itself) */
  visual?: string;
  /** a destiny pick (docs/14 §2): the era it answers, its side; the landing
   *  pick is made on the landing screen and never counts toward a charter */
  track?: { era: Era; side: Side; landing?: true };
  /** a destiny capstone: visible only once the Era 8 pick settles this band */
  band?: Band;
}

const M: SiteId = 'mare', P: SiteId = 'southpole', L: SiteId = 'lavatube';

export const TECHS: Record<TechId, TechDef> = {
  // ─── ERA 1 · FIRST LANDING ───
  // the smelter is known from landing (docs/17 §14.1): this slot is Pit Mapping's
  // now. Keep the shipped regolithProcessing id: saved completion, queue, spent
  // data and insight keys stay valid across the schema-5 extraction reshuffle.
  regolithProcessing: {
    id: 'regolithProcessing', era: 1, lane: 'materials', name: 'Pit Mapping', short: 'Pit Mapping',
    costData: 30, requires: [],
    effects: [
      { kind: 'haul', offroadMult: 1.3 },
      { kind: 'powerMult', buildings: ['excavator', 'iceMiner'], mult: 1.1 },
    ],
    desc: 'Stereo cameras map every bench and haul lane: hub units drive the rough ground in pits and deposits faster.',
    visual: 'Excavators and Ice Miners mount a stereo camera boom over the cab.',
    tradeoff: 'The cameras and their computers ride on the unit’s pack.',
  },
  teleoperation: {
    id: 'teleoperation', era: 1, lane: 'robotics', name: 'Earth Teleoperation', short: 'Teleoperation',
    costData: 120, requires: [],
    effects: [
      { kind: 'buildSpeed', mult: 0.85 },
      { kind: 'action', id: 'downlink' },
      { kind: 'outputMult', buildings: ['lab'], mult: 0.9 },
    ],
    desc: 'Earth pilots drive the builders through the 2.6 s round trip, and the same link can sell your data for cargo.',
    visual: 'The Lander raises a second, larger Earth dish for the teleoperators.',
    tradeoff: 'Ops video and science share one antenna.',
  },
  prospectingRovers: {
    id: 'prospectingRovers', era: 1, lane: 'exploration', name: 'Prospecting Drones', short: 'Prospecting Drones',
    costData: 100, requires: [],
    effects: [
      { kind: 'survey', tier: 1 },
      { kind: 'survey', depositTimeMult: 0.5 }, // docs/17 §14.4: deposit surveys in 20 rover-s
      { kind: 'unlock', building: 'prospectingBay' },
      { kind: 'unlock', building: 'relayMast' },
      { kind: 'powerDelta', building: 'lander', kw: -1 },
    ],
    desc: 'Neutron and X-ray spectrometers on a delta-wing drone: print more at a Prospecting Bay, and every drone flies its own survey of the Moon.',
    visual: 'A Prospecting Bay can be built to print survey drones, and Relay Masts can rise.',
    tradeoff: 'Every sortie spends stored energy, propellant and parts.',
  },
  siteGrading: {
    id: 'siteGrading', era: 1, lane: 'robotics', name: 'Site Grading', short: 'Site Grading',
    costData: 90, requires: [],
    effects: [{ kind: 'grading' }],
    desc: 'Dozer blades on every rover: a dragged box is graded twice as fast, and tailings heaps can be levelled into pads for reactors, racks and rails.',
    visual: 'Graded pads show as raked, flattened ground under your large structures.',
    tradeoff: 'Every cell graded spends the night you were saving.',
  },
  iceExtraction: {
    id: 'iceExtraction', era: 1, lane: 'habitat', name: 'Cryo Ice Extraction', short: 'Ice Extraction',
    costData: 130, requires: [], sites: [P],
    effects: [{ kind: 'unlock', building: 'waterPlant' }],
    desc: 'Mine water ice from permanently shadowed cold traps at 40 K. It is hopper propellant from day one.',
    visual: 'Water Management Plants can rise: a melt hall whose Ice Miners crawl out to the cold trap.',
    tradeoff: 'The ice is in the dark, and so are the miners.',
  },
  regolithVolatiles: {
    id: 'regolithVolatiles', era: 1, lane: 'habitat', name: 'Solar-Wind Volatiles', short: 'Volatile Mining',
    costData: 100, requires: [], sites: [M, L],
    effects: [
      { kind: 'unlock', building: 'waterPlant' },
    ],
    desc: 'Heat mature soil to ~700 °C and the implanted solar wind comes out: H₂, H₂O, ³He.',
    visual: 'Water Management Plants heat mature soil in a retort beside a cold-trap tank.',
    tradeoff: 'Four billion years of wind, a teaspoon a minute.',
  },
  bifacialCells: {
    id: 'bifacialCells', era: 1, lane: 'power', name: 'Bifacial Cells', short: 'Bifacial Cells',
    costData: 80, requires: [],
    effects: [
      { kind: 'powerMult', buildings: ['solar'], mult: 1.08 },
      { kind: 'buildTime', buildings: ['solar'], mult: 1.25 },
    ],
    desc: 'Cells that also drink the light bouncing up off a white glass-sintered apron.',
    visual: 'Solar Arrays lay a white reflector apron beneath their wings.',
    tradeoff: 'Every array now waits for its apron.',
  },
  grizzlyScreens: {
    id: 'grizzlyScreens', era: 1, lane: 'materials', name: 'Grizzly Screens', short: 'Grizzly Screens',
    costData: 70, requires: [],
    effects: [
      { kind: 'outputMult', buildings: ['excavator'], mult: 1.1 },
      { kind: 'powerMult', buildings: ['excavator'], mult: 1.15 },
    ],
    desc: 'Slotted bars shake the boulders out before the fines reach the hopper.',
    visual: 'Excavators carry a slotted grizzly screen over the back deck.',
    tradeoff: 'Shaking rock takes watts.',
  },
  sampleCaches: {
    id: 'sampleCaches', era: 1, lane: 'exploration', name: 'Sample-Return Caches', short: 'Sample Caches',
    costData: 90, requires: ['prospectingRovers'],
    effects: [
      { kind: 'survey', dataMult: 1.25 },
      { kind: 'survey', precision: 0.15 }, // docs/17 §13.3: deposit surveys ±15%
      { kind: 'powerDelta', building: 'lander', kw: -0.5 },
    ],
    desc: 'Rovers bring cores home instead of spectra: the labs read them twice.',
    visual: 'A sample-cache carousel stands beside the Lander’s ladder.',
    tradeoff: 'The freezer runs on the Lander’s bus.',
  },
  fieldSpectrometers: {
    id: 'fieldSpectrometers', era: 1, lane: 'compute', name: 'Field Spectrometers', short: 'Field Spectrometers',
    costData: 90, requires: [],
    effects: [
      { kind: 'outputMult', buildings: ['lab'], mult: 1.1 },
      { kind: 'powerMult', buildings: ['lab'], mult: 1.2 },
    ],
    desc: 'A roof turret reads the ground around the lab while the bench reads the samples.',
    visual: 'Research Labs bolt a spectrometer turret onto the roof.',
    tradeoff: 'Every instrument is another load.',
  },

  // ─── the faction branches (docs/20 §3) ───
  // Each faction's eight techs sit in their lane and era like any tech (lane costs and prerequisites follow the lane), are
  // `factions`-locked (visible only to their faction, never solo) and are drawn in their era page's ⚑ FACTION row. Their
  // prerequisites are never site-locked, doctrine or crew techs, so a branch is reachable on every site and expedition.
  // The Vanguard's Era 1 and the Commons' Era 1:
  pressCorps: {
    id: 'pressCorps', era: 1, lane: 'compute', name: 'Press Corps', short: 'Press Corps',
    costData: 90, requires: [], factions: ['accelerationists'],
    effects: [
      { kind: 'unlock', building: 'missionOps' },
      { kind: 'scrutiny', decay: 1.5 },
    ],
    desc: 'Reporters on the same link as the engineers: every stumble is published, and so is every correction. A Mission Ops console runs the story.',
    visual: 'Mission Ops can rise: a glass control room under a press dish, cobalt-trimmed.',
    tradeoff: 'The world reads the log, including the lines you would rather it did not.',
  },
  commonsCharter: {
    id: 'commonsCharter', era: 1, lane: 'habitat', name: 'Commons Charter', short: 'Commons Charter',
    costData: 100, requires: [], factions: ['solarpunks'],
    effects: [
      { kind: 'unlock', building: 'commonsHall' },
      { kind: 'moraleBase', delta: 6 },
    ],
    desc: 'A charter every settler signs: no one eats alone on the Moon. Commons Halls gather the crew, and the crew is glad of it.',
    visual: 'Commons Halls can rise: a long timber-roofed hall with a green banner and one long table.',
    tradeoff: 'Consensus takes time, and a hall is metal that was not a solar array.',
  },

  // ─── ERA 2 · EARLY CONSTRUCTION ───
  bayExtensions: {
    id: 'bayExtensions', era: 2, lane: 'robotics', name: 'Bay Extensions', short: 'Bay Extensions',
    costData: 120, requires: [],
    effects: [
      { kind: 'hubLevel', level: 2 },
      { kind: 'powerDelta', building: 'smelter', kw: -1 },
      { kind: 'powerDelta', building: 'refinery', kw: -1 },
      { kind: 'powerDelta', building: 'waterPlant', kw: -1 },
    ],
    desc: 'A third charging post and service bay at each processing hub. Buy the extension where another unit will help.',
    visual: 'Hubs raise a bay canopy over a third charging post.',
    tradeoff: 'The bay controls stay powered even when its machine is away.',
  },
  hardfacedTeeth: {
    id: 'hardfacedTeeth', era: 2, lane: 'materials', name: 'Hardfaced Teeth', short: 'Hardfaced Teeth',
    costData: 120, requires: [],
    effects: [
      { kind: 'haul', digMult: 1.25 },
      { kind: 'upkeepMult', buildings: ['excavator', 'iceMiner'], mult: 1.25 },
    ],
    desc: 'Wear-resistant cutting edges let wheels and augers fill the same bucket faster.',
    visual: 'Bucket wheels and augers wear a band of hardfaced teeth.',
    tradeoff: 'Faster cuts consume more replacement teeth.',
  },
  batteryStorage: {
    id: 'batteryStorage', era: 2, lane: 'power', name: 'Battery Banks', short: 'Battery Banks',
    costData: 110, requires: [],
    effects: [{ kind: 'unlock', building: 'battery' }],
    desc: 'Store the day. Survive the night.',
    visual: 'Battery Banks can rise: three cell cabinets with radiator lids.',
    tradeoff: 'Metals you wanted elsewhere.',
  },
  thermalWadis: {
    id: 'thermalWadis', era: 2, lane: 'power', name: 'Thermal Wadis', short: 'Thermal Wadis',
    costData: 120, requires: [], sites: [M],
    effects: [{ kind: 'nightDraw', night: 0.85, day: 1.05 }],
    desc: 'Sintered-regolith heat banks, charged by day, keep machines above survival temperature through the night (Balasubramaniam et al. 2010).',
    visual: 'Solar Arrays each bank a sintered-regolith heat wadi at their feet.',
    tradeoff: 'You pay for the night at noon.',
  },
  peakLightMasts: {
    id: 'peakLightMasts', era: 2, lane: 'power', name: 'Vertical Solar Masts', short: 'Solar Masts',
    costData: 130, costGoods: { metals: 20 }, requires: ['prospectingRovers'], sites: [P],
    effects: [
      { kind: 'shadeImmune' },
      { kind: 'powerMult', buildings: ['solar'], mult: 1.1 },
      { kind: 'buildTime', buildings: ['solar'], mult: 1.5 },
      { kind: 'upkeepMult', buildings: ['solar'], mult: 1.3 },
    ],
    desc: '10 m masts lift arrays above the rim’s own shadows (NASA VSAT).',
    visual: 'Solar Arrays climb onto 10 m lattice masts.',
    tradeoff: 'Tall is slow to build and hard to service.',
  },
  skylightHeliostats: {
    id: 'skylightHeliostats', era: 2, lane: 'power', name: 'Skylight Heliostats', short: 'Heliostats',
    costData: 130, costGoods: { metals: 20 }, requires: ['prospectingRovers'], sites: [L],
    effects: [
      { kind: 'powerMult', buildings: ['solar'], mult: 1.25 },
      { kind: 'dustMult', mult: 1.5 },
    ],
    desc: 'Rim mirrors pour sunlight down the skylight.',
    visual: 'Each Solar Array gains a heliostat mirror on a boom.',
    tradeoff: 'Mirrors love dust.',
  },
  siliconRefining: {
    id: 'siliconRefining', era: 2, lane: 'compute', name: 'Silicon Refining', short: 'Silicon Refining',
    costData: 130, requires: [],
    effects: [{ kind: 'unlock', building: 'refinery' }],
    desc: 'Anorthite to wafer-grade silicon.',
    visual: 'Silicon Refineries can rise: three distillation columns.',
    tradeoff: 'Another furnace for the night to strangle.',
  },
  partsFabrication: {
    id: 'partsFabrication', era: 2, lane: 'robotics', name: 'Parts Fabrication', short: 'Parts Fabrication',
    costData: 110, requires: [],
    effects: [{ kind: 'unlock', building: 'partsFab' }],
    desc: 'Make your own spares.',
    visual: 'Parts Fabricators can rise: a sawtooth-roofed machine shop.',
    tradeoff: 'A supply chain that also needs maintaining.',
  },
  constructionRobotics: {
    id: 'constructionRobotics', era: 2, lane: 'robotics', name: 'Construction Robotics', short: 'Constr. Robotics',
    costData: 130, requires: [], requiresAny: ['teleoperation', 'prospectingRovers'],
    effects: [
      { kind: 'unlock', building: 'roboticsBay' },
      { kind: 'automation', expeditions: ['human'] },
    ],
    desc: 'Autonomous builders, and on crewed bases autonomous operators.',
    visual: 'Robotics Bays can rise, a rover on charge at the side door.',
    tradeoff: 'Robots wait expensively.',
  },
  regolithShielding: {
    id: 'regolithShielding', era: 2, lane: 'habitat', name: 'Regolith Shielding', short: 'Regolith Shielding',
    costData: 140, requires: [], requiresAny: ['siteGrading', 'constructionRobotics'],
    effects: [
      { kind: 'upkeepMult', buildings: 'all', mult: 0.85 },
      { kind: 'repair', mult: 0.5 },
      { kind: 'guard', guard: 'micrometeoriteShield' }, // docs/14 §3.6
      { kind: 'stowShield', sigma: 0.5 }, // docs/16 §4.1: field berms
    ],
    desc: 'Two metres of berm on every structure: thermal mass, radiation, micrometeorites.',
    visual: 'Regolith berms are bulldozed against every shielded wall.',
    tradeoff: 'Buried machines are slower to reach.',
  },
  moltenElectrolysis: {
    id: 'moltenElectrolysis', era: 2, lane: 'materials', name: 'Molten Regolith Electrolysis', short: 'MRE Smelting',
    costData: 150, costGoods: { parts: 10 }, requires: [], exclusive: 'smeltDoctrine',
    effects: [
      {
        kind: 'recipe', building: 'smelter',
        inputs: { regolith: 2 }, outputs: { metals: 0.65, oxygen: 0.40, silicon: 0.04 },
        powerKW: -22, feedInsensitive: true,
      },
      { kind: 'upkeepMult', buildings: ['smelter'], mult: 1.5 },
    ],
    desc: 'Melt regolith at ~1,600 °C and pass a current: O₂ at the anode, Fe–Si alloy at the cathode, from any soil.',
    visual: 'Smelters grow an electrolysis cell with heavy busbars.',
    tradeoff: 'Brute force: the grid pays, and the water trickle dies.',
  },
  ilmeniteBeneficiation: {
    id: 'ilmeniteBeneficiation', era: 2, lane: 'materials', name: 'Ilmenite Beneficiation', short: 'Beneficiation',
    costData: 140, requires: ['prospectingRovers'], exclusive: 'smeltDoctrine', sites: [M, L],
    effects: [
      { kind: 'grade', mult: 1.25, process: 'H2' }, // docs/17 §9.1: it concentrates ilmenite at the face
      { kind: 'inputMult', buildings: ['smelter'], mult: 0.8 },
      { kind: 'powerMult', buildings: ['excavator'], mult: 1.3 },
    ],
    desc: 'Magnetic and electrostatic separation at the pit: feed the furnace only ilmenite.',
    visual: 'Excavators carry a magnetic separator drum.',
    tradeoff: 'Chase the ore: the map decides your yield.',
  },
  mpptInverters: {
    id: 'mpptInverters', era: 2, lane: 'power', name: 'MPPT Inverters', short: 'MPPT Inverters',
    costData: 110, requires: ['bifacialCells'],
    effects: [
      { kind: 'powerMult', buildings: ['solar'], mult: 1.08 },
      { kind: 'upkeepMult', buildings: ['solar'], mult: 1.25 },
    ],
    desc: 'Maximum-power-point trackers hold every string at its knee as the sun climbs.',
    visual: 'Solar Arrays hang a finned inverter cabinet on the pedestal.',
    tradeoff: 'Power electronics hate thermal cycling.',
  },
  heatRecoveryJackets: {
    id: 'heatRecoveryJackets', era: 2, lane: 'materials', name: 'Heat-Recovery Jackets', short: 'Heat Recovery',
    costData: 120, requires: [],
    effects: [
      { kind: 'powerMult', buildings: ['smelter'], mult: 0.88 },
      { kind: 'upkeepMult', buildings: ['smelter'], mult: 1.25 },
    ],
    desc: 'Exhaust heat preheats the next batch of feed instead of the sky.',
    visual: 'Smelter stacks wrap in foil heat-recovery jackets.',
    tradeoff: 'Jackets crack where the stack flexes.',
  },
  sublimationTents: {
    id: 'sublimationTents', era: 2, lane: 'habitat', name: 'Sublimation Tents', short: 'Sublimation Tents',
    costData: 120, requires: ['iceExtraction'], sites: [P],
    effects: [
      { kind: 'outputMult', buildings: ['iceMiner', 'iceHarvester'], mult: 1.15 },
      { kind: 'powerMult', buildings: ['iceMiner', 'iceHarvester'], mult: 1.2 },
    ],
    desc: 'Heat the ice in place under a tent and catch the vapour on a cold plate (the Colorado School of Mines trials).',
    visual: 'Ice Miners pitch a foil sublimation tent over the dig.',
    tradeoff: 'You are heating a 40 K crater.',
  },
  neutronSpectrometry: {
    id: 'neutronSpectrometry', era: 2, lane: 'exploration', name: 'Neutron Spectrometry', short: 'Neutron Spectrometry',
    costData: 110, requires: ['sampleCaches'],
    effects: [
      { kind: 'survey', dataMult: 1.2 },
      { kind: 'survey', mastSurvey: ['ice', 'volatiles'] }, // docs/17 §13.2: masts survey ice and soil
      { kind: 'powerMult', buildings: ['relayMast'], mult: 1.4 },
    ],
    desc: 'Epithermal neutrons count the hydrogen a metre down, from the masts as well as the rovers.',
    visual: 'Relay Masts hang a neutron-spectrometer boom.',
    tradeoff: 'Every mast becomes an instrument, and instruments draw.',
  },
  heliophysicsForecasting: {
    id: 'heliophysicsForecasting', era: 2, lane: 'exploration', name: 'Heliophysics Forecasting', short: 'Heliophysics',
    costData: 120, requires: ['prospectingRovers'],
    effects: [
      { kind: 'unlock', building: 'solarObservatory' },
      { kind: 'forecast', tier: 1 },
      { kind: 'powerDelta', building: 'lander', kw: -1 },
    ],
    desc: 'Watch the active regions rise: a coronagraph and an X-ray monitor on the ground, Earth’s bulletins over the link.',
    visual: 'Solar Observatories can rise: a white dome with a slit and a coronagraph on a pier, and a sun sensor on the pad for the forecast link.',
    tradeoff: 'An eye on the Sun sees nothing at night.',
  },
  benchRobots: {
    id: 'benchRobots', era: 2, lane: 'compute', name: 'Bench Robots', short: 'Bench Robots',
    costData: 100, requires: [], expeditions: ['human'],
    effects: [
      { kind: 'crewDelta', buildings: ['lab'], delta: -1 },
      { kind: 'powerMult', buildings: ['lab'], mult: 1.25 },
    ],
    desc: 'A sample-handling arm on every bench: one scientist runs what took two.',
    visual: 'Research Labs fit a robot sample bench behind a new window bay.',
    tradeoff: 'The arm never sleeps, so the lab never does.',
  },

  buildOrders: {
    id: 'buildOrders', era: 2, lane: 'robotics', name: 'Build Orders', short: 'Build Orders',
    costData: 120, requires: ['teleoperation'],
    effects: [
      { kind: 'orders', book: AUTO.bookMax, maxCount: AUTO.bookOrderMax },
      { kind: 'powerDelta', building: 'lander', kw: -1 },
    ],
    desc: 'Earth planners keep a work list for the rovers: an order you cannot pay for yet waits in the book and is placed as the stock arrives.',
    visual: 'The Lander raises a planning mast: a pole with a work lamp beside its top deck.',
    tradeoff: 'A list is a promise the stockpile has to keep.',
  },

  // on-board power (docs/02 · On-board power, core/unitPower.ts): the fleet's own packs
  roverPowerPacks: {
    id: 'roverPowerPacks', era: 2, lane: 'power', name: 'Rover Power Packs', short: 'Rover Power Packs',
    costData: 120, costGoods: { metals: 15 }, requires: ['batteryStorage'],
    effects: [{ kind: 'unitPower', packMult: 3, driveMult: 1.2 }],
    desc: 'Battery Bank cells, ruggedised for the fleet: every rover, drone and excavator carries three times the charge, enough to work through a lunar night off the grid.',
    visual: 'Rovers, drones and excavators bolt a pair of battery pods to their flanks.',
    tradeoff: 'A heavier rover rolls harder.',
  },

  // ── faction branches, Era 2 ──
  nightVaultDocks: {
    id: 'nightVaultDocks', era: 2, lane: 'power', name: 'Night Vault', short: 'Night Vault',
    costData: 130, requires: ['batteryStorage'], factions: ['robots'],
    effects: [{ kind: 'unlock', building: 'nightVault' }],
    desc: 'A berthing hall under the berm: units dock, hibernate and sip their heaters through the fourteen-day night.',
    visual: 'Night Vaults can rise: a low berthing hall under a regolith roof, its charging bays lit orange.',
    tradeoff: 'A hall for machines that do nothing is still a hall to power, pay for and keep dust out of.',
  },
  crunchCulture: {
    id: 'crunchCulture', era: 2, lane: 'compute', name: 'Crunch Culture', short: 'Crunch Culture',
    costData: 120, requires: ['fieldSpectrometers'], factions: ['accelerationists'],
    effects: [
      { kind: 'outputMult', buildings: ['lab', 'dataCenter'], mult: 1.15 },
      { kind: 'moraleBase', delta: -5 },
    ],
    desc: 'Labs on two shifts, publishing every Friday: data flows faster, and nobody goes home.',
    visual: 'Research Labs and Data Centers string a banner of status lights along the roof.',
    tradeoff: 'Nobody sleeps, and the morale meter notices.',
  },
  mutualAidDrills: {
    id: 'mutualAidDrills', era: 2, lane: 'habitat', name: 'Mutual Aid Drills', short: 'Mutual Aid Drills',
    costData: 130, requires: ['regolithShielding'], factions: ['solarpunks'],
    effects: [
      { kind: 'hazardRate', mult: 0.8 },
      { kind: 'outputMult', buildings: ['smelter', 'refinery', 'partsFab', 'lab'], mult: 0.95, crewedOnly: true },
    ],
    desc: 'Everyone learns everyone’s job: when a window opens, whoever is nearest is already suited up.',
    visual: 'Airlocks gain a leaf-green drill bell and a rescue-sled rack.',
    tradeoff: 'An hour of drill is an hour off the line.',
  },

  // ─── ERA 3 · ROBOTIC FABRICATION ───
  waterReclamation: {
    id: 'waterReclamation', era: 3, lane: 'habitat', name: 'Water Reclamation', short: 'Water Reclamation',
    costData: 150, requires: [], requiresAny: ['iceExtraction', 'regolithVolatiles'], crewTech: true,
    effects: [
      { kind: 'reclaim', water: 0.6 },
      { kind: 'powerDelta', building: 'waterPlant', kw: -4 },
    ],
    desc: 'An operating Water Management Plant recovers greywater from crew and farms, reducing their fresh-water draw.',
    visual: 'Water Management Plants add a greywater still: a squat tank with a vent stack.',
    tradeoff: 'The still needs steady electricity to keep the loop closed.',
  },
  thoriumPower: {
    id: 'thoriumPower', era: 3, lane: 'power', name: 'Thorium Reactor', short: 'Thorium Reactor',
    costData: 160, costGoods: { metals: 80 }, requires: ['regolithShielding'], exclusive: 'nightPower',
    effects: [{ kind: 'unlock', building: 'reactor' }],
    desc: 'Fission surface power behind a regolith berm.',
    visual: 'Thorium Reactors can rise: a domed drum ringed with radiator petals.',
    tradeoff: 'Baseload that eats parts like a rover fleet.',
  },
  regenFuelCells: {
    id: 'regenFuelCells', era: 3, lane: 'power', name: 'Regenerative Fuel Cells', short: 'Fuel Cells',
    costData: 150, costGoods: { water: 80 }, requires: ['batteryStorage'], exclusive: 'nightPower',
    effects: [{ kind: 'storage', capacityMult: 2, efficiency: 0.6 }],
    desc: 'Split water by day and recombine it by night: bulk tanks, not cells.',
    visual: 'Battery Banks sprout paired hydrogen and oxygen tanks.',
    tradeoff: 'Half of what you store comes back.',
  },
  swarmRobotics: {
    id: 'swarmRobotics', era: 3, lane: 'robotics', name: 'Swarm Robotics', short: 'Swarm Robotics',
    costData: 150, costGoods: { parts: 20 }, requires: ['constructionRobotics'], exclusive: 'constructionDoctrine',
    effects: [
      { kind: 'botPerBay', delta: 1 },
      { kind: 'buildSpeed', mult: 0.85 },
      { kind: 'construction', kwMult: 1.5 },
      { kind: 'upkeepMult', buildings: ['roboticsBay'], mult: 1.5 },
    ],
    desc: 'The fleet coordinates itself.',
    visual: 'Robotics Bays add a rooftop rack of swarm charging cradles.',
    tradeoff: 'One bad firmware push walks in formation.',
  },
  heavyConstructors: {
    id: 'heavyConstructors', era: 3, lane: 'robotics', name: 'Heavy Constructors', short: 'Heavy Constructors',
    costData: 150, costGoods: { parts: 20 }, requires: ['constructionRobotics'], exclusive: 'constructionDoctrine',
    effects: [
      { kind: 'construction', rateMult: 2.2, partsMult: 0.6 },
      { kind: 'botPerBay', delta: -1 },
      { kind: 'construction', kwMult: 2 },
    ],
    desc: 'Fewer, bigger machines: each build 2.2× faster on 60% of the weld.',
    visual: 'Robotics Bays raise a heavy gantry crane.',
    tradeoff: 'Fewer builds at once, each a power spike.',
  },
  dustMitigation: {
    id: 'dustMitigation', era: 3, lane: 'materials', name: 'Dust Mitigation', short: 'Dust Mitigation',
    costData: 160, requires: [], requiresAny: ['partsFabrication', 'constructionRobotics'],
    effects: [
      { kind: 'dustMult', mult: 0.4 },
      { kind: 'upkeepMult', buildings: ['excavator', 'iceMiner'], mult: 0.5 },
      { kind: 'powerMult', buildings: ['solar'], mult: 0.95 },
      { kind: 'guard', guard: 'dustScreens' }, // docs/14 §3.6
    ],
    desc: 'Electrostatic curtains and sealed bearings against the Moon’s knife-dust.',
    visual: 'Solar Arrays sprout electrostatic curtain wands and excavators wear dust skirts.',
    tradeoff: 'The brooms run on sunlight.',
  },
  btLavaTubeCaverns: {
    id: 'btLavaTubeCaverns', era: 3, lane: 'exploration', name: 'Lava-Tube Caverns', short: 'Lava-Tube Caverns',
    costData: 190, requires: [],
    breakthrough: { hosts: ['tranqPit', 'mariusTube', 'ingeniiPit'], slot: 1 },
    effects: [
      { kind: 'powerMult', buildings: ['habitat', 'dataCenter'], mult: 0.85 },
      { kind: 'upkeepMult', buildings: ['habitat', 'dataCenter', 'chipFab'], mult: 0.7 },
      { kind: 'buildTime', buildings: ['habitat', 'dataCenter', 'chipFab'], mult: 1.3 },
    ],
    desc: 'Radar-sounded tubes prove basalt vaults hold a steady temperature. Bury your most delicate machines, in a tube or a trench.',
    visual: 'Habitats, Data Centers and Chip Fabs pile a sandbag overburden on their roofs.',
    tradeoff: 'Down is slow.',
  },
  stackedCells: {
    id: 'stackedCells', era: 3, lane: 'power', name: 'Stacked Cell Racks', short: 'Stacked Cells',
    costData: 160, costGoods: { metals: 20 }, requires: ['batteryStorage'],
    effects: [
      { kind: 'storage', capacityMult: 1.25 },
      { kind: 'upkeepMult', buildings: ['battery'], mult: 1.4 },
    ],
    desc: 'A second tier of cells on the same pad and the same thermal loop.',
    visual: 'Battery Banks stack a second tier of cells.',
    tradeoff: 'Twice the cells to balance.',
  },
  slagRecycling: {
    id: 'slagRecycling', era: 3, lane: 'materials', name: 'Slag Recycling', short: 'Slag Recycling',
    costData: 150, requires: ['heatRecoveryJackets'],
    effects: [
      { kind: 'inputMult', buildings: ['smelter'], mult: 0.88 },
      { kind: 'upkeepMult', buildings: ['smelter'], mult: 1.2 },
    ],
    desc: 'Crushed slag goes back in with the feed: less digging per tonne of iron.',
    visual: 'Smelters run a slag conveyor out to a cooling bed.',
    tradeoff: 'Conveyors are wear parts.',
  },
  refluxColumns: {
    id: 'refluxColumns', era: 3, lane: 'compute', name: 'Reflux Columns', short: 'Reflux Columns',
    costData: 160, requires: ['siliconRefining'],
    effects: [
      { kind: 'outputMult', buildings: ['refinery'], mult: 1.12 },
      { kind: 'powerMult', buildings: ['refinery'], mult: 1.12 },
    ],
    desc: 'A fourth column refluxes the chlorosilane cut the first three let go.',
    visual: 'Silicon Refineries raise a fourth distillation column.',
    tradeoff: 'Another column to boil.',
  },
  cryoSampleStore: {
    id: 'cryoSampleStore', era: 3, lane: 'compute', name: 'Cryo Sample Store', short: 'Cryo Sample Store',
    costData: 150, requires: ['fieldSpectrometers'],
    effects: [
      { kind: 'outputMult', buildings: ['lab'], mult: 1.1 },
      { kind: 'upkeepMult', buildings: ['lab'], mult: 1.4 },
    ],
    desc: 'Volatile-bearing cores kept at 100 K keep what they came up with.',
    visual: 'Research Labs stand a cryogenic sample dewar on the roof.',
    tradeoff: 'Dewars boil off and seals wear.',
  },
  bunkRacks: {
    id: 'bunkRacks', era: 3, lane: 'habitat', name: 'Bunk Racks', short: 'Bunk Racks',
    costData: 150, requires: [], crewTech: true,
    effects: [
      { kind: 'housing', building: 'habitat', delta: 1 },
      { kind: 'morale', building: 'habitat', delta: -2 },
    ],
    desc: 'A fifth berth in every module, folded against the airlock wall.',
    visual: 'Habitats bolt a bunk annex onto their airlock.',
    tradeoff: 'Nobody likes the top bunk.',
  },

  autoExcavation: {
    id: 'autoExcavation', era: 3, lane: 'robotics', name: 'Automated Excavation', short: 'Auto Excavation',
    costData: 150, costGoods: { parts: 10 }, requires: ['buildOrders'],
    effects: [
      { kind: 'autoRule', family: 'excavation' },
      { kind: 'powerDelta', building: 'smelter', kw: -1 },
      { kind: 'powerDelta', building: 'refinery', kw: -1 },
      { kind: 'powerDelta', building: 'waterPlant', kw: -1 },
    ],
    desc: 'The hubs watch their intake: when their machines need more ore, an underfed hub prints another unit within its bay and pit limits.',
    visual: 'Smelters, Refineries and Water Management Plants grow a dispatch mast.',
    tradeoff: 'It spends your metals before you have decided what they were for.',
  },
  siteSurveyAI: {
    id: 'siteSurveyAI', era: 3, lane: 'compute', name: 'Site Survey AI', short: 'Site Survey AI',
    costData: 150, requires: ['buildOrders', 'prospectingRovers'],
    effects: [
      { kind: 'siting' },
      { kind: 'autoRule', family: 'survey' },
      { kind: 'upkeepMult', buildings: ['roboticsBay'], mult: 1.2 },
    ],
    desc: 'A survey drone flies every candidate pad first: the deposit under it, the light on it, the haul lanes across it. Idle drones fly the map on their own, nearest first, while the bank holds its reserve.',
    visual: 'A survey drone rests on a pad on each Robotics Bay roof.',
    tradeoff: 'Drones that fly every pad wear like rovers.',
  },
  basaltPaving: {
    id: 'basaltPaving', era: 3, lane: 'materials', name: 'Basalt Paving', short: 'Basalt Paving',
    costData: 150, requires: [],
    effects: [
      { kind: 'road', speedMult: 1.25, dustMult: 0.5 },
      { kind: 'road', cellMult: 1.2 },
    ],
    desc: 'Cast basalt pavers, poured from the smelter’s slag, give the rovers a hard running surface.',
    visual: 'The roads turn to dark basalt pavers with a pale centre line.',
    tradeoff: 'Every new cell is cast, not just sintered.',
  },

  // ── faction branches, Era 3 ──
  faradaySheds: {
    id: 'faradaySheds', era: 3, lane: 'robotics', name: 'Faraday Sheds', short: 'Faraday Sheds',
    costData: 150, requires: ['constructionRobotics'], factions: ['robots'],
    effects: [{ kind: 'unlock', building: 'faradayShed' }],
    desc: 'A steel-mesh hangar that shunts a flare around whatever is parked inside, and a little beyond its walls.',
    visual: 'Faraday Sheds can rise: a mesh-roofed hangar on grounded stilts, its ribs banded orange.',
    tradeoff: 'It saves what stands under it; everything outside is as bare as before.',
  },
  hardenedFirmware: {
    id: 'hardenedFirmware', era: 3, lane: 'compute', name: 'Hardened Firmware', short: 'Hardened Firmware',
    costData: 160, requires: ['siliconRefining'], factions: ['robots'],
    effects: [
      { kind: 'flareVuln', machine: 0.5 },
      { kind: 'powerMult', buildings: ['roboticsBay', 'partsFab'], mult: 1.15 },
    ],
    desc: 'Triple-voted controllers and a watchdog on every bus: a flare that used to reboot a machine now barely flips a bit.',
    visual: 'Robotics Bays and Parts Fabricators mount a shielded controller cabinet on the side wall.',
    tradeoff: 'Voting takes power and time: every controller is three.',
  },
  hazardWaivers: {
    id: 'hazardWaivers', era: 3, lane: 'robotics', name: 'Hazard Waivers', short: 'Hazard Waivers',
    costData: 150, requires: ['constructionRobotics'], factions: ['accelerationists'],
    effects: [
      { kind: 'buildSpeed', mult: 0.85 },
      { kind: 'hazardRate', mult: 1.2 },
    ],
    desc: 'Sign here: a crew that accepts the risk gets built for faster, and the schedule stops asking questions.',
    visual: 'Construction rovers wear a cobalt chevron and work under a striped gantry.',
    tradeoff: 'A waiver does not make the hazard any less real.',
  },
  slowBuildDoctrine: {
    id: 'slowBuildDoctrine', era: 3, lane: 'materials', name: 'Slow Build Doctrine', short: 'Slow Build',
    costData: 150, requires: ['basaltPaving'], factions: ['solarpunks'],
    effects: [
      { kind: 'buildSpeed', mult: 1.15 },
      { kind: 'upkeepMult', buildings: 'all', mult: 0.7 },
    ],
    desc: 'Build it once, build it to last: every structure rises slower and costs less to keep.',
    visual: 'New structures rise behind a leaf-green scaffold and a hand-laid regolith plinth.',
    tradeoff: 'Every foundation waits on the doctrine, and the Sun does not wait.',
  },

  // ─── ERA 4 · CHIP FABRICATION ───
  waterElectrolysis: {
    id: 'waterElectrolysis', era: 4, lane: 'habitat', name: 'Water Electrolysis', short: 'Water Electrolysis',
    costData: 240, costGoods: { parts: 10 }, requires: [], requiresAny: ['iceExtraction', 'regolithVolatiles'],
    effects: [
      { kind: 'action', id: 'electrolysis' },
      { kind: 'inputMult', buildings: ['propellantPlant'], mult: 0.6 },
    ],
    desc: 'Split a share of a plant’s water into oxygen and hydrogen. Each plant can keep water or make breathing oxygen as the base needs.',
    visual: 'Water Management Plants raise an electrolysis stack with heavy busbars and a vent mast.',
    tradeoff: 'Water spent making air cannot fill the reservoir; hydrogen is vented until a Propellant Plant stands.',
  },
  deepCoring: {
    id: 'deepCoring', era: 4, lane: 'exploration', name: 'Deep Coring', short: 'Deep Coring',
    costData: 240, costGoods: { parts: 10 }, requires: ['prospectingRovers'],
    effects: [
      { kind: 'pitDepth', benches: 2 },
      { kind: 'powerMult', buildings: ['excavator', 'iceMiner'], mult: 1.1 },
    ],
    desc: 'Rock breakers reopen worked-out and hemmed-in pits, cutting two more benches into bedrock below the loose soil.',
    visual: 'Excavators carry a rock-breaker arm; deep pits expose a bedrock bench.',
    tradeoff: 'Bedrock yields slowly and the cutters draw more power while they work it.',
  },
  waferFab: {
    id: 'waferFab', era: 4, lane: 'materials', name: 'Wafer Fabrication', short: 'Wafer Fabrication',
    costData: 260, costGoods: { silicon: 40 }, requires: ['siliconRefining', 'partsFabrication'],
    effects: [{ kind: 'unlock', building: 'chipFab' }],
    desc: 'Hard vacuum is the cleanest cleanroom ever built.',
    visual: 'Chip Fabs can rise: a long cleanroom hall with twin exhaust stacks.',
    tradeoff: 'The most delicate machine, in the dustiest place.',
  },
  acceleratorDesign: {
    id: 'acceleratorDesign', era: 4, lane: 'compute', name: 'Accelerator Design', short: 'Accelerator Design',
    costData: 260, costGoods: { silicon: 30 }, requires: ['waferFab'], exclusive: 'chipDoctrine',
    effects: [
      { kind: 'outputMult', buildings: ['dataCenter'], mult: 1.5 },
      { kind: 'inputMult', buildings: ['chipFab'], mult: 1.25 },
    ],
    desc: 'TPU-class masks tuned for inference.',
    visual: 'Data Centers mount accelerator cooling towers on the roof.',
    tradeoff: 'Specialised silicon does one thing.',
  },
  radHardProcess: {
    id: 'radHardProcess', era: 4, lane: 'compute', name: 'Rad-Hard Process', short: 'Rad-Hard Chips',
    costData: 260, costGoods: { silicon: 30 }, requires: ['waferFab'], exclusive: 'chipDoctrine',
    effects: [
      { kind: 'outputMult', buildings: ['chipFab'], mult: 1.4 },
      { kind: 'agentTax', mult: 0.6 },
      { kind: 'outputMult', buildings: ['dataCenter'], mult: 0.85 },
      { kind: 'guard', guard: 'radHard' }, // docs/14 §3.6
    ],
    desc: 'Older, larger nodes and thick oxides that shrug off cosmic rays.',
    visual: 'Chip Fabs add a shielded ion-implanter annex.',
    tradeoff: 'Robust silicon thinks slower.',
  },
  cleanroomRobotics: {
    id: 'cleanroomRobotics', era: 4, lane: 'robotics', name: 'Cleanroom Robotics', short: 'Cleanroom Robotics',
    costData: 280, costGoods: { parts: 30 }, requires: ['waferFab'], requiresAny: ['swarmRobotics', 'heavyConstructors'],
    effects: [
      { kind: 'powerMult', buildings: ['chipFab'], mult: 0.7 },
      { kind: 'inputMult', buildings: ['chipFab'], mult: 0.8 },
      { kind: 'upkeepMult', buildings: ['chipFab'], mult: 1.5 },
    ],
    desc: 'Sealed handling lines built by the construction fleet.',
    visual: 'Chip Fabs gain a sealed wafer-transfer tunnel and a handling arm.',
    tradeoff: 'More robots for the parts budget.',
  },
  roverAutonomy: {
    id: 'roverAutonomy', era: 4, lane: 'robotics', name: 'Rover Autonomy', short: 'Rover Autonomy',
    costData: 240, costGoods: { parts: 20 }, requires: ['constructionRobotics'],
    effects: [
      { kind: 'construction', rateMult: 1.25 },
      { kind: 'construction', kwMult: 1.3 },
    ],
    desc: 'Onboard weld vision and path planning: each construction rover works without waiting on the 2.6 s round trip to Earth.',
    visual: 'Robotics Bays raise a navigation mast: a radar dome and the lidar heads the rovers plan their paths by.',
    tradeoff: 'A rover that thinks for itself runs its compute hot.',
  },
  fuelCellPacks: {
    id: 'fuelCellPacks', era: 4, lane: 'robotics', name: 'Regenerative Fuel-Cell Packs', short: 'Fuel-Cell Packs',
    costData: 240, costGoods: { parts: 20 }, requires: ['roverPowerPacks'],
    effects: [{ kind: 'unitPower', packMult: 3, chargeEff: 0.7 }],
    desc: 'Each unit splits water while it charges and recombines it while it works: three times the charge again, in tanks instead of cells.',
    visual: 'Rovers, drones and excavators carry paired hydrogen and oxygen tanks behind their battery pods.',
    tradeoff: 'Electrolysis is a lossy way to fill a tank.',
  },
  orbitalProspector: {
    id: 'orbitalProspector', era: 4, lane: 'exploration', name: 'Orbital Prospector', short: 'Orbital Prospector',
    costData: 240, costGoods: { chips: 5 }, requires: ['prospectingRovers', 'waferFab'],
    effects: [
      { kind: 'survey', tier: 2, bayLevel: 2, range: 1.5 },
      { kind: 'powerDelta', building: 'lander', kw: -2 },
    ],
    desc: 'A polar orbiter with a gamma-ray spectrometer: your chips, Earth’s rocket. It steers the drones too: Prospecting Bays grow to four bays and every flight is a third shorter.',
    visual: 'The Lander adds a tracking dish for the polar orbiter.',
    tradeoff: 'Someone has to listen every pass.',
  },
  btVolcanicGlass: {
    id: 'btVolcanicGlass', era: 4, lane: 'exploration', name: 'Volcanic Glass Reduction', short: 'Glass Reduction',
    costData: 280, requires: [],
    breakthrough: { hosts: ['taurusLittrow', 'aristarchus', 'schrodinger'], slot: 2 },
    effects: [
      { kind: 'outputMult', buildings: ['smelter'], mult: 1.2 },
      { kind: 'powerMult', buildings: ['smelter'], mult: 1.15 },
    ],
    desc: 'Apollo 17’s orange beads reduce fastest. Tune every furnace to Fe-rich glass chemistry.',
    visual: 'Smelters raise a hopper for orange volcanic glass beads.',
    tradeoff: 'Hotter, faster, hungrier.',
  },
  braytonConverters: {
    id: 'braytonConverters', era: 4, lane: 'power', name: 'Brayton Converters', short: 'Brayton Converters',
    costData: 240, costGoods: { parts: 20 }, requires: ['thoriumPower'],
    effects: [
      { kind: 'powerMult', buildings: ['reactor'], mult: 1.12 },
      { kind: 'upkeepMult', buildings: ['reactor'], mult: 1.25 },
    ],
    desc: 'Closed-cycle gas turbines beat the Stirlings on the same core heat (Kilopower’s successor).',
    visual: 'Thorium Reactors add a Brayton turbine skid.',
    tradeoff: 'Turbines spin; spinning things wear.',
  },
  pressureTanks: {
    id: 'pressureTanks', era: 4, lane: 'power', name: 'High-Pressure Tanks', short: 'Pressure Tanks',
    costData: 240, costGoods: { metals: 30 }, requires: ['regenFuelCells'],
    effects: [
      { kind: 'storage', capacityMult: 1.2 },
      { kind: 'buildTime', buildings: ['battery'], mult: 1.3 },
    ],
    desc: 'Wound-metal tanks at 200 bar hold a fifth more of the day’s split water.',
    visual: 'Battery Banks add a third, high-pressure tank.',
    tradeoff: 'Every bank takes longer to certify.',
  },
  mliBlankets: {
    id: 'mliBlankets', era: 4, lane: 'power', name: 'MLI Blankets', short: 'MLI Blankets',
    costData: 220, requires: [], sites: [M, L],
    effects: [
      { kind: 'nightDraw', night: 0.93, day: 1 },
      { kind: 'upkeepMult', buildings: 'all', mult: 1.05 },
    ],
    desc: 'Twenty layers of aluminised film keep the heaters off through the night.',
    visual: 'Smelters, Refineries and Labs wear silver MLI blankets.',
    tradeoff: 'Blankets snag on everything.',
  },
  waferPolishing: {
    id: 'waferPolishing', era: 4, lane: 'materials', name: 'Wafer Polishing', short: 'Wafer Polishing',
    costData: 250, requires: ['waferFab'],
    effects: [
      { kind: 'outputMult', buildings: ['chipFab'], mult: 1.1 },
      { kind: 'upkeepMult', buildings: ['chipFab'], mult: 1.3 },
    ],
    desc: 'Chemical-mechanical polish between layers: flatter wafers, fewer dead dies.',
    visual: 'Chip Fabs add a glass-roofed wafer-polishing annex.',
    tradeoff: 'Slurry eats pads.',
  },
  oreSorting: {
    id: 'oreSorting', era: 4, lane: 'materials', name: 'Optical Ore Sorting', short: 'Ore Sorting',
    costData: 220, requires: ['grizzlyScreens'],
    effects: [
      { kind: 'grade', mult: 1.1 },
      { kind: 'upkeepMult', buildings: ['excavator', 'iceMiner'], mult: 1.3 },
    ],
    desc: 'Cameras over the wheel reject the anorthosite lumps before they ride the belt.',
    visual: 'Excavators mount an optical ore-sorting hood over the bucket wheel.',
    tradeoff: 'Abrasive lunar dust wears the lenses.',
  },
  heatedAugers: {
    id: 'heatedAugers', era: 4, lane: 'habitat', name: 'Heated Augers', short: 'Heated Augers',
    costData: 230, requires: ['sublimationTents'], sites: [P],
    effects: [
      { kind: 'outputMult', buildings: ['iceMiner', 'iceHarvester'], mult: 1.15 },
      { kind: 'upkeepMult', buildings: ['iceMiner', 'iceHarvester'], mult: 1.3 },
    ],
    desc: 'A second auger with heated flights lifts icy regolith the tent cannot reach.',
    visual: 'Ice Miners sink a second, heated auger.',
    tradeoff: 'Ice-bound flights shear.',
  },
  growLights: {
    id: 'growLights', era: 4, lane: 'habitat', name: 'LED Grow Lights', short: 'Grow Lights',
    costData: 220, requires: [], crewTech: true,
    effects: [
      { kind: 'outputMult', buildings: ['hydroponics'], mult: 1.15 },
      { kind: 'powerMult', buildings: ['hydroponics'], mult: 1.2 },
    ],
    desc: 'Red-blue strips tuned to chlorophyll, sixteen hours a day.',
    visual: 'Hydroponics vaults glow with LED grow-light strips.',
    tradeoff: 'Photons by the kilowatt.',
  },

  autoPower: {
    id: 'autoPower', era: 4, lane: 'power', name: 'Automated Power', short: 'Automated Power',
    costData: 240, costGoods: { metals: 20 }, requires: ['autoExcavation'],
    effects: [
      { kind: 'autoRule', family: 'power' },
      { kind: 'upkeepMult', buildings: ['solar'], mult: 1.1 },
    ],
    desc: 'The grid books itself: another array when the day runs thin, another bank at dawn after a night the bank ran dry.',
    visual: 'Solar Arrays gain a combiner box with a status lamp at the foot of the mast.',
    tradeoff: 'Every array now has a box to keep dust out of.',
  },
  budgetGovernor: {
    id: 'budgetGovernor', era: 4, lane: 'compute', name: 'Budget Governor', short: 'Budget Governor',
    costData: 240, costGoods: { chips: 5 }, requires: ['autoExcavation'],
    effects: [
      { kind: 'governor' },
      { kind: 'upkeepMult', buildings: ['storageYard'], mult: 1.5 },
      { kind: 'guard', guard: 'governorFloors' }, // docs/14 §3.6
    ],
    desc: 'A ledger for the builder: floors it never spends below, the research goods it leaves alone, and an order its rules act in.',
    visual: 'Storage Yards get a manifest gantry: a scanner bar on two legs spanning the racks.',
    tradeoff: 'A careful builder is a slower one.',
  },
  autoLifeSupport: {
    id: 'autoLifeSupport', era: 4, lane: 'robotics', name: 'Automated Life Support', short: 'Auto Life Support',
    costData: 240, costGoods: { parts: 10 }, requires: ['autoExcavation'], crewTech: true,
    robotic: { era: 7, costData: 1125 },
    effects: [
      { kind: 'autoRule', family: 'life' },
      { kind: 'powerMult', buildings: ['habitat'], mult: 1.1 },
    ],
    desc: 'The rovers keep the crew ahead of their own lungs: another oxygen, food or water maker before the tanks run short, and a bed for the next settler.',
    visual: 'Each Habitat Module gets an air-monitor mast by its door.',
    tradeoff: 'The monitors never sleep, and neither does their draw.',
  },

  // ── faction branches, Era 4 ──
  isotopeWarmers: {
    id: 'isotopeWarmers', era: 4, lane: 'power', name: 'Isotope Warmers', short: 'Isotope Warmers',
    costData: 240, requires: ['roverPowerPacks'], factions: ['robots'],
    effects: [
      { kind: 'nightMode', output: 0.5, relief: true },
      { kind: 'unitPower', packMult: 0.9 },
    ],
    desc: 'A radioisotope heater tucked into every gearbox: the machines keep their joints warm and work through the night instead of crawling.',
    visual: 'Rovers, excavators and drones carry a finned radioisotope heater block on their decks.',
    tradeoff: 'A heater is mass that could have been battery.',
  },
  skunkworksLabs: {
    id: 'skunkworksLabs', era: 4, lane: 'compute', name: 'Skunkworks', short: 'Skunkworks',
    costData: 260, requires: ['crunchCulture', 'cryoSampleStore'], factions: ['accelerationists'],
    effects: [{ kind: 'unlock', building: 'skunkworks' }],
    desc: 'A lab off the books: twice the data of a Research Lab from a hall that answers to no one, and trusts nobody’s shielding.',
    visual: 'Skunkworks can rise: a windowless, cobalt-trimmed research hall under a screened roof.',
    tradeoff: 'A secret lab is an exposed one: what strikes it strikes it hard.',
  },
  hearingPrep: {
    id: 'hearingPrep', era: 4, lane: 'habitat', name: 'Hearing Prep', short: 'Hearing Prep',
    costData: 230, requires: ['regolithShielding', 'pressCorps'], factions: ['accelerationists'],
    effects: [
      { kind: 'scrutiny', recall: 0.5 },
      { kind: 'outputMult', buildings: ['lab'], mult: 0.92 },
    ],
    desc: 'Counsel on retainer and a script for every mistake: when the hearings come, half as many people go home.',
    visual: 'Research Labs set a briefing alcove behind a cobalt-lit window.',
    tradeoff: 'Every hour of prep is an hour a lab was not running.',
  },
  regolithTerraces: {
    id: 'regolithTerraces', era: 4, lane: 'habitat', name: 'Regolith Terraces', short: 'Regolith Terraces',
    costData: 230, requires: ['growLights', 'commonsCharter'], factions: ['solarpunks'],
    effects: [{ kind: 'unlock', building: 'regolithTerrace' }],
    desc: 'Stepped beds cut into the berm: slow, sun-warmed soil farms that want no power through the night.',
    visual: 'Regolith Terraces can rise: stepped, leaf-green planting beds cut into a sintered berm.',
    tradeoff: 'Slow: a third of a farm’s food from the same ground, and it still drinks.',
  },

  // ─── ERA 5 · LUNAR COMPUTE ───
  depotHalls: {
    id: 'depotHalls', era: 5, lane: 'robotics', name: 'Depot Halls', short: 'Depot Halls',
    costData: 400, costGoods: { parts: 20 }, requires: ['bayExtensions'],
    effects: [
      { kind: 'hubLevel', level: 3 },
      { kind: 'hubPrint', timeMult: 0.75 },
      { kind: 'upkeepMult', buildings: ['smelter', 'refinery', 'waterPlant'], mult: 1.15 },
    ],
    desc: 'Roofed service halls hold a fourth bay and a gantry that prints units in three quarters of the time.',
    visual: 'Hubs roof their bays into a depot hall with a gantry.',
    tradeoff: 'The larger workshops need more spare parts.',
  },
  lunarDataCenter: {
    id: 'lunarDataCenter', era: 5, lane: 'compute', name: 'Lunar Data Center', short: 'Data Center',
    costData: 420, costGoods: { chips: 10 }, requires: ['waferFab'],
    effects: [{ kind: 'unlock', building: 'dataCenter' }],
    desc: 'Racks under regolith, radiators facing the black sky.',
    visual: 'Data Centers can rise: bermed racks under black-sky radiators.',
    tradeoff: 'The night negotiates with your batteries.',
  },
  dynamicClocking: {
    id: 'dynamicClocking', era: 5, lane: 'compute', name: 'Dynamic Clocking', short: 'Dynamic Clocking',
    costData: 440, costGoods: { chips: 5 }, requires: [], requiresAny: ['acceleratorDesign', 'radHardProcess'],
    effects: [{ kind: 'action', id: 'overclock' }],
    desc: 'Push silicon and machines past nameplate when it counts.',
    visual: 'Chip Fabs and Data Centers mount boost radiators for overclocking.',
    tradeoff: 'Heat is a debt.',
  },
  cryoRadiators: {
    id: 'cryoRadiators', era: 5, lane: 'power', name: 'Cryo Radiators', short: 'Cryo Radiators',
    costData: 480, costGoods: { metals: 60 }, requires: ['lunarDataCenter'],
    effects: [
      { kind: 'powerMult', buildings: ['dataCenter'], mult: 0.65 },
      { kind: 'upkeepMult', buildings: ['dataCenter'], mult: 1.6 },
    ],
    desc: 'Reject heat to a 3 K sky.',
    visual: 'Data Centers unfold a second tier of cryo radiator fins; Server Monoliths grow fins down both flanks.',
    tradeoff: 'Acres of foil that micrometeorites love.',
  },
  autonomousHaulage: {
    id: 'autonomousHaulage', era: 5, lane: 'robotics', name: 'Autonomous Haulage', short: 'Autonomous Haulage',
    costData: 400, costGoods: { parts: 30 }, requires: ['roverAutonomy'],
    effects: [
      { kind: 'haul', speedMult: 1.3, bucketMult: 1.25 },
      { kind: 'powerMult', buildings: ['excavator'], mult: 1.25 },
      { kind: 'upkeepMult', buildings: ['excavator'], mult: 1.2 },
    ],
    desc: 'Excavators grade their own haul roads and carry bigger buckets: the far deposits come within reach.',
    visual: 'Excavators widen their bucket lips and mount a haul-road lidar bar on the cab.',
    tradeoff: 'Heavier loads, hungrier motors.',
  },
  radioisotopeUnits: {
    id: 'radioisotopeUnits', era: 5, lane: 'robotics', name: 'Radioisotope Power Units', short: 'Radioisotope Units',
    costData: 400, costGoods: { parts: 30, chips: 5 }, requires: ['fuelCellPacks'],
    effects: [
      { kind: 'unitPower', rpu: true },
      { kind: 'upkeepMult', buildings: ['roboticsBay', 'droneHive', 'excavator'], mult: 1.25 },
      { kind: 'morale', building: 'roboticsBay', delta: -2, crew: true },
    ],
    desc: 'A plutonium-238 heat source and thermocouples on every unit, as on Curiosity: a trickle of power that no brownout and no night can take away.',
    visual: 'Rovers, drones and excavators grow a finned radioisotope unit on the tail.',
    tradeoff: 'A hot source on every machine, and a crew that knows it.',
  },
  crewWellness: {
    id: 'crewWellness', era: 5, lane: 'habitat', name: 'Crew Wellness Program', short: 'Crew Wellness',
    costData: 460, requires: [], crewTech: true, robotic: { era: 7, costData: 1000 },
    effects: [{ kind: 'unlock', building: 'recDome' }],
    desc: 'Plants, a screen, low-g handball.',
    visual: 'Recreation Domes can rise: a great glass-banded dome.',
    tradeoff: 'A pure cost centre.',
  },
  wingExtensions: {
    id: 'wingExtensions', era: 5, lane: 'power', name: 'Wing Extensions', short: 'Wing Extensions',
    costData: 400, costGoods: { silicon: 30 }, requires: ['mpptInverters'],
    effects: [
      { kind: 'powerMult', buildings: ['solar'], mult: 1.1 },
      { kind: 'upkeepMult', buildings: ['solar'], mult: 1.2 },
      { kind: 'buildTime', buildings: ['solar'], mult: 1.2 },
    ],
    desc: 'Lunar silicon, lunar cells: a fifth row on every wing.',
    visual: 'Solar Array wings grow a fifth row of cells.',
    tradeoff: 'Longer wings, heavier drives.',
  },
  deployableRadiators: {
    id: 'deployableRadiators', era: 5, lane: 'power', name: 'Deployable Radiators', short: 'Deploy. Radiators',
    costData: 400, costGoods: { metals: 40 }, requires: [],
    effects: [
      { kind: 'powerMult', buildings: ['smelter', 'refinery', 'chipFab'], mult: 0.92 },
      { kind: 'upkeepMult', buildings: ['smelter', 'refinery', 'chipFab'], mult: 1.2 },
    ],
    desc: 'Fold-out wings dump process heat, so the chillers idle.',
    visual: 'Smelters, Refineries and Chip Fabs unfold extra radiator wings.',
    tradeoff: 'More wing, more micrometeorite targets.',
  },
  oxygenLiquefaction: {
    id: 'oxygenLiquefaction', era: 5, lane: 'materials', name: 'Oxygen Liquefaction', short: 'O₂ Liquefaction',
    costData: 380, requires: ['slagRecycling'],
    effects: [
      { kind: 'outputMult', buildings: ['smelter'], mult: 1.1 },
      { kind: 'powerMult', buildings: ['smelter'], mult: 1.15 },
    ],
    desc: 'Pull the oxygen off as it forms and the reduction runs faster.',
    visual: 'Smelters add a cold-box liquefier and a spherical LOX tank.',
    tradeoff: 'Cryocoolers are hungry.',
  },
  immersionLitho: {
    id: 'immersionLitho', era: 5, lane: 'materials', name: 'Immersion Lithography', short: 'Immersion Litho',
    costData: 420, costGoods: { chips: 5 }, requires: ['waferPolishing'],
    effects: [
      { kind: 'outputMult', buildings: ['chipFab'], mult: 1.12 },
      { kind: 'inputMult', buildings: ['chipFab'], mult: 1.1 },
    ],
    desc: 'A film of ultrapure water under the lens sharpens every exposure.',
    visual: 'Chip Fabs raise an immersion-lithography tower.',
    tradeoff: 'Finer lines, more rework.',
  },
  toolChangers: {
    id: 'toolChangers', era: 5, lane: 'robotics', name: 'Tool Changers', short: 'Tool Changers',
    costData: 380, requires: ['partsFabrication'],
    effects: [
      { kind: 'outputMult', buildings: ['partsFab'], mult: 1.15 },
      { kind: 'inputMult', buildings: ['partsFab'], mult: 1.1 },
    ],
    desc: 'A carousel swaps heads between jobs: the mill never waits for a hand.',
    visual: 'Parts Fabricators add a tool-changer carousel on the roof.',
    tradeoff: 'Faster cuts, more swarf.',
  },
  nutrientRecirculation: {
    id: 'nutrientRecirculation', era: 5, lane: 'habitat', name: 'Nutrient Recirculation', short: 'Nutrient Recirc.',
    costData: 380, requires: ['growLights'], crewTech: true,
    effects: [
      { kind: 'inputMult', buildings: ['hydroponics'], mult: 0.7 },
      { kind: 'upkeepMult', buildings: ['hydroponics'], mult: 1.3 },
    ],
    desc: 'Drain-to-waste becomes a loop: filter, dose, return.',
    visual: 'Hydroponics farms add a row of nutrient recirculation tanks.',
    tradeoff: 'Loops foul.',
  },
  gravimetry: {
    id: 'gravimetry', era: 5, lane: 'exploration', name: 'Gravity Gradiometry', short: 'Gravimetry',
    costData: 360, requires: ['neutronSpectrometry'],
    effects: [
      { kind: 'survey', dataMult: 1.2 },
      { kind: 'survey', precision: 0.05 }, // docs/17 §13.3: deposit surveys ±5%
      { kind: 'powerDelta', building: 'lander', kw: -1 },
    ],
    desc: 'A gradiometer at the Lander weighs the buried mass under every survey line.',
    visual: 'The Lander raises a gravimeter mast.',
    tradeoff: 'The quietest instrument needs the steadiest power.',
  },

  l1Sentinel: {
    id: 'l1Sentinel', era: 5, lane: 'exploration', name: 'L1 Sentinel', short: 'L1 Sentinel',
    costData: 400, costGoods: { chips: 15 }, requires: ['heliophysicsForecasting', 'orbitalProspector'],
    effects: [
      { kind: 'action', id: 'sentinel' },
      { kind: 'forecast', tier: 2 },
      { kind: 'powerDelta', building: 'lander', kw: -1.5 },
    ],
    desc: 'A sun-watcher at the Earth–Sun L1 point, like SOHO, ACE and DSCOVR: it never loses the Sun to the lunar night.',
    visual: 'Solar Observatories add a dish on a pylon for the sentinel’s link.',
    tradeoff: 'A million and a half kilometres of link, every second of the day.',
  },
  autoSmelting: {
    id: 'autoSmelting', era: 5, lane: 'robotics', name: 'Automated Smelting & Refining', short: 'Auto Smelting',
    costData: 400, costGoods: { parts: 20 }, requires: ['autoExcavation', 'siliconRefining'],
    effects: [
      { kind: 'autoRule', family: 'smelting' },
      { kind: 'upkeepMult', buildings: ['smelter', 'refinery'], mult: 1.1 },
    ],
    desc: 'The furnaces count what the builders spend: another smelter or refinery when the base builds faster than it smelts, and a yard when a store tops out.',
    visual: 'Silicon Refineries grow an ore-sampler arm over the feed hopper.',
    tradeoff: 'Samplers in the feed wear like the feed.',
  },
  feedPlanner: {
    id: 'feedPlanner', era: 5, lane: 'compute', name: 'Feed Planner', short: 'Feed Planner',
    costData: 400, requires: ['siteSurveyAI'],
    effects: [
      { kind: 'feedPlanner' },
      { kind: 'powerMult', buildings: ['excavator'], mult: 1.1 },
    ],
    desc: 'Assays at the pit face: each excavator digs the ground the furnaces want, as far as the haul still pays.',
    visual: 'Excavators carry an assay drill beside the bucket.',
    tradeoff: 'Richer ground is usually farther ground.',
  },
  guidanceBeacons: {
    id: 'guidanceBeacons', era: 5, lane: 'materials', name: 'Guidance Beacons', short: 'Guidance Beacons',
    costData: 400, costGoods: { chips: 5 }, requires: ['basaltPaving'],
    effects: [
      { kind: 'road', speedMult: 1.1, nightMult: 1.25 },
      { kind: 'road', cellMult: 1.15 },
    ],
    desc: 'Retroreflector posts and radio pips along the kerbs: the rovers drive them faster, and faster still after dark.',
    visual: 'Beacon posts line the road edges and light up at night.',
    tradeoff: 'Every cell gets its posts.',
  },

  // ── faction branches, Era 5 ──
  bankTrenches: {
    id: 'bankTrenches', era: 5, lane: 'power', name: 'Bank Trenches', short: 'Bank Trenches',
    costData: 420, requires: ['isotopeWarmers'], factions: ['robots'],
    effects: [
      { kind: 'storage', efficiency: 0.85 },
      { kind: 'buildTime', buildings: ['battery'], mult: 1.3 },
      { kind: 'upkeepMult', buildings: ['battery'], mult: 1.2 },
    ],
    desc: 'Battery banks set in sintered trenches under the berm: the cells stay at the temperature they like, and the round trip comes back.',
    visual: 'Battery Banks sit in sintered trenches banked with regolith.',
    tradeoff: 'Every bank is now a dig, and a trench is upkeep.',
  },
  selfRepairCells: {
    id: 'selfRepairCells', era: 5, lane: 'robotics', name: 'Self-Repair Cells', short: 'Self-Repair Cells',
    costData: 400, requires: ['toolChangers'], factions: ['robots'],
    effects: [
      { kind: 'repair', mult: 1.3 },
      { kind: 'upkeepMult', buildings: ['partsFab'], mult: 1.3 },
    ],
    desc: 'Spare actuators and a swap arm in every bay: a worn machine heals itself before anyone notices the wear.',
    visual: 'Robotics Bays grow a spare-parts carousel beside the door.',
    tradeoff: 'The carousel is stocked by the parts fab, and the parts fab eats what it is given.',
  },
  ventureFoils: {
    id: 'ventureFoils', era: 5, lane: 'materials', name: 'Venture Foils', short: 'Venture Foils',
    costData: 420, requires: ['waferPolishing'], factions: ['accelerationists'],
    effects: [
      { kind: 'outputMult', buildings: ['foilFactory'], mult: 1.25 },
      { kind: 'upkeepMult', buildings: ['foilFactory'], mult: 1.5 },
    ],
    desc: 'Backed by the launch-window investors: a foil line pushed hard, for as long as the tooling lasts.',
    visual: 'Foil Factories run an extra, cobalt-railed casting line.',
    tradeoff: 'Investors want output, not maintenance: the tooling wears half again as fast.',
  },
  consensusCouncil: {
    id: 'consensusCouncil', era: 5, lane: 'compute', name: 'Consensus Council', short: 'Consensus Council',
    costData: 400, requires: ['budgetGovernor'], factions: ['solarpunks'],
    effects: [
      { kind: 'builder', dwellMult: 0.8 },
      { kind: 'crewDelta', buildings: ['lab'], delta: 1 },
    ],
    desc: 'Everyone has a vote on the standing rules, so the Builder need not wait to be sure: its rules act in four-fifths the time.',
    visual: 'Research Labs seat a round table behind a green-lit window.',
    tradeoff: 'Every lab seats a councillor, and councillors are not researchers.',
  },

  // ─── ERA 6 · HUMAN HABITATION ───
  humanCohabitation: {
    id: 'humanCohabitation', era: 6, lane: 'habitat', name: 'Human Cohabitation', short: 'Human Cohabitation',
    costData: 1050, costGoods: { parts: 30, chips: 10 },
    requires: ['regolithShielding'], requiresAny: ['thoriumPower', 'regenFuelCells'], expeditions: ['robotic'],
    effects: [
      { kind: 'unlock', building: 'habitat' },
      { kind: 'unlock', building: 'hydroponics' },
    ],
    desc: 'Shielded quarters and night-proof power, then invite the humans.',
    visual: 'Habitats and Hydroponics Farms can rise for the first crew.',
    tradeoff: 'Lungs, stomachs and moods.',
  },
  closedLoopLS: {
    id: 'closedLoopLS', era: 6, lane: 'habitat', name: 'Closed-Loop Life Support', short: 'Closed-Loop LS',
    costData: 1150, costGoods: { parts: 25 }, requires: [], requiresAny: ['thoriumPower', 'regenFuelCells'], crewTech: true,
    effects: [
      { kind: 'inputMult', buildings: ['habitat'], mult: 0.6 },
      { kind: 'powerMult', buildings: ['habitat'], mult: 1.3 },
      { kind: 'guard', guard: 'closedLoop' }, // docs/14 §3.6
    ],
    desc: 'Scrub, recycle, repeat.',
    visual: 'Habitats add a CO₂ scrubber stack and water-recovery tanks.',
    tradeoff: 'The recyclers never sleep.',
  },
  safetyProtocols: {
    id: 'safetyProtocols', era: 6, lane: 'robotics', name: 'Safety Protocols', short: 'Safety Protocols',
    costData: 1200, costGoods: { chips: 10 }, requires: ['regolithShielding'], crewTech: true,
    effects: [
      { kind: 'upkeepMult', buildings: 'all', mult: 0.8 },
      { kind: 'buildSpeed', mult: 1.15 },
      { kind: 'guard', guard: 'safety' }, // docs/14 §3.6
    ],
    desc: 'Human inspectors walk the lines the agents only watch. This is the safety-measures purpose.',
    visual: 'Inspection lamp masts go up beside Habitats and the Lander.',
    tradeoff: 'Checklists slow everything they save.',
  },
  conditionOptimization: {
    id: 'conditionOptimization', era: 6, lane: 'materials', name: 'Condition Optimization', short: 'Condition Tuning',
    costData: 1200, costGoods: { chips: 10 }, requires: ['lunarDataCenter'], crewTech: true,
    effects: [
      { kind: 'outputMult', buildings: ['excavator', 'iceMiner', 'iceHarvester', 'waterPlant', 'smelter', 'refinery'], mult: 1.15 },
      { kind: 'powerMult', buildings: ['habitat'], mult: 1.25 },
    ],
    desc: 'Researchers tune set-points that agents merely accept. This is the optimizing-conditions purpose.',
    visual: 'Excavators, Smelters, Refineries and Ice Harvesters sprout sensor masts.',
    tradeoff: 'Comfort costs watts.',
  },
  scienceCrews: {
    id: 'scienceCrews', era: 6, lane: 'compute', name: 'Science Crews', short: 'Science Crews',
    costData: 1150, requires: ['lunarDataCenter'], crewTech: true,
    effects: [
      { kind: 'outputMult', buildings: ['lab'], mult: 1.35, crewedOnly: true },
      { kind: 'survey', dataMult: 1.5, minCrew: 2 },
      { kind: 'powerMult', buildings: ['lab'], mult: 1.4 },
    ],
    desc: 'Geologists and physicists on site ask the questions the agents didn’t. This is the research purpose.',
    visual: 'Research Labs raise a glazed observation cupola.',
    tradeoff: 'Every scientist is a bunk and a meal.',
  },
  farSideRelay: {
    id: 'farSideRelay', era: 6, lane: 'exploration', name: 'Far-Side Relay', short: 'Far-Side Relay',
    costData: 1100, costGoods: { chips: 15, parts: 20 }, requires: ['orbitalProspector'],
    effects: [
      { kind: 'survey', tier: 3, bayLevel: 3 },
      { kind: 'powerDelta', building: 'lander', kw: -2 },
    ],
    desc: 'A halo-orbit relay at Earth–Moon L2, like Queqiao: the far side answers, and Prospecting Bays grow to six bays.',
    visual: 'The Lander raises a lattice mast for the far-side relay link.',
    tradeoff: 'The whole far side through one antenna.',
  },
  btColdTrapChemistry: {
    id: 'btColdTrapChemistry', era: 6, lane: 'exploration', name: 'Cold-Trap Chemistry', short: 'Cold-Trap Chem',
    costData: 1150, requires: [],
    breakthrough: { hosts: ['cabeus', 'hermite'], slot: 2 },
    effects: [
      { kind: 'outputMult', buildings: ['hydroponics'], mult: 1.4 },
      { kind: 'outputMult', buildings: ['propellantPlant'], mult: 1.25 },
      { kind: 'outputMult', buildings: ['chipFab'], mult: 1.1 },
      { kind: 'upkeepMult', buildings: ['hydroponics', 'propellantPlant', 'chipFab'], mult: 1.3 },
    ],
    desc: 'The LCROSS plume held CO, NH₃ and H₂S: carbon, nitrogen and process gases for a living base.',
    visual: 'Hydroponics Farms and Propellant Plants rack process-gas bottles.',
    tradeoff: 'Useful chemistry is corrosive chemistry.',
  },
  solidStateCells: {
    id: 'solidStateCells', era: 6, lane: 'power', name: 'Solid-State Cells', short: 'Solid-State Cells',
    costData: 950, costGoods: { silicon: 20 }, requires: ['stackedCells'],
    effects: [
      { kind: 'storage', capacityMult: 1.3 },
      { kind: 'buildTime', buildings: ['battery'], mult: 1.5 },
    ],
    desc: 'Glass electrolytes from lunar silicon: denser cells that shrug off the cold.',
    visual: 'Battery Banks seal their cells in solid-state vaults.',
    tradeoff: 'Each vault is sintered, not bolted.',
  },
  highBurnupFuel: {
    id: 'highBurnupFuel', era: 6, lane: 'power', name: 'High-Burnup Fuel', short: 'High-Burnup Fuel',
    costData: 1000, costGoods: { parts: 30 }, requires: ['braytonConverters'],
    effects: [
      { kind: 'powerMult', buildings: ['reactor'], mult: 1.1 },
      { kind: 'morale', building: 'reactor', delta: -2 },
    ],
    desc: 'Denser fuel pins run the core hotter and longer between reloads.',
    visual: 'Thorium Reactors raise a fuel-handling crane over the dome.',
    tradeoff: 'The crane is the part everyone watches.',
  },
  refractoryLinings: {
    id: 'refractoryLinings', era: 6, lane: 'materials', name: 'Refractory Linings', short: 'Refractory Linings',
    costData: 950, costGoods: { metals: 40 }, requires: ['slagRecycling'],
    effects: [
      { kind: 'upkeepMult', buildings: ['smelter', 'refinery'], mult: 0.75 },
      { kind: 'buildTime', buildings: ['smelter', 'refinery'], mult: 1.3 },
    ],
    desc: 'Sintered spinel bricks outlast the steel shells they line.',
    visual: 'Smelter stacks and Refinery columns are banded with refractory courses.',
    tradeoff: 'Bricklaying is slow.',
  },
  predictiveMaintenance: {
    id: 'predictiveMaintenance', era: 6, lane: 'robotics', name: 'Predictive Maintenance', short: 'Predictive Maint.',
    costData: 1000, costGoods: { chips: 10 }, requires: ['partsFabrication'],
    effects: [
      { kind: 'repair', mult: 1.3 },
      { kind: 'powerDelta', building: 'lander', kw: -2 },
    ],
    desc: 'Vibration and thermal signatures flag the bearing before it seizes.',
    visual: 'Robotics Bays raise a diagnostics mast with a beacon.',
    tradeoff: 'The model runs all night on the Lander’s servers.',
  },
  uplinkDishes: {
    id: 'uplinkDishes', era: 6, lane: 'compute', name: 'Lab Uplink Dishes', short: 'Uplink Dishes',
    costData: 950, costGoods: { chips: 10 }, requires: ['cryoSampleStore'],
    effects: [
      { kind: 'outputMult', buildings: ['lab'], mult: 1.1 },
      { kind: 'powerMult', buildings: ['lab'], mult: 1.15 },
    ],
    desc: 'A second dish per lab: raw data leaves on its own channel.',
    visual: 'Research Labs raise a second uplink dish.',
    tradeoff: 'Two transmitters, one grid.',
  },
  galleyGarden: {
    id: 'galleyGarden', era: 6, lane: 'habitat', name: 'Galley Garden', short: 'Galley Garden',
    costData: 900, requires: ['growLights'], crewTech: true, robotic: { era: 7, costData: 1000 },
    effects: [
      { kind: 'morale', building: 'hydroponics', delta: 3 },
      { kind: 'powerMult', buildings: ['hydroponics'], mult: 1.15 },
    ],
    desc: 'A table among the tomatoes, and a window to eat by.',
    visual: 'Hydroponics farms open a galley bay with a picture window.',
    tradeoff: 'Dinner is a heating load.',
  },
  launchSiteSurvey: {
    id: 'launchSiteSurvey', era: 6, lane: 'export', name: 'Launch-Site Survey', short: 'Launch-Site Survey',
    costData: 900, requires: ['orbitalProspector'],
    effects: [
      { kind: 'buildTime', buildings: ['massDriver', 'propellantPlant'], mult: 0.75 },
      { kind: 'powerDelta', building: 'lander', kw: -1 },
    ],
    desc: 'Laser-surveyed launch pads, staked before the rail or the tanks arrive.',
    visual: 'Mass Drivers and Propellant Plants rise on staked, surveyed pads with reflector posts.',
    tradeoff: 'The tracking radar never switches off.',
  },

  autoFabrication: {
    id: 'autoFabrication', era: 6, lane: 'robotics', name: 'Automated Fabrication', short: 'Auto Fabrication',
    costData: 1000, costGoods: { chips: 10 }, requires: ['autoSmelting', 'partsFabrication'],
    effects: [
      { kind: 'autoRule', family: 'fabrication' },
      { kind: 'upkeepMult', buildings: ['partsFab'], mult: 1.2 },
    ],
    desc: 'The fleet builds its own supply chain: parts fabricators when parts run behind, chip fabs when research waits on chips, bays when sites wait for rovers.',
    visual: 'Parts Fabricators get a gantry crane across the roof.',
    tradeoff: 'A crane that never rests wears its rails.',
  },
  predictiveScheduling: {
    id: 'predictiveScheduling', era: 6, lane: 'compute', name: 'Predictive Scheduling', short: 'Predictive Sched.',
    costData: 1000, costGoods: { chips: 10 }, requires: ['autoPower', 'lunarDataCenter'],
    effects: [
      { kind: 'predictive' },
      { kind: 'powerMult', buildings: ['dataCenter'], mult: 1.1 },
    ],
    desc: 'The Data Center runs the base forward: tonight’s deficit, the sites still welding, the next hour of demand.',
    visual: 'Each Data Center adds a scheduling antenna: a tall whip mast beside its dish.',
    tradeoff: 'Forecasting the night costs some of it.',
  },
  solarCycleForecasting: {
    id: 'solarCycleForecasting', era: 6, lane: 'compute', name: 'Solar-Cycle Forecasting', short: 'Solar-Cycle Fcst',
    costData: 1000, costGoods: { chips: 10 }, requires: ['l1Sentinel', 'lunarDataCenter'],
    effects: [
      { kind: 'forecast', tier: 3 },
      { kind: 'powerMult', buildings: ['dataCenter'], mult: 1.1 },
    ],
    desc: 'Helioseismology on the sentinel’s feed: the far side’s spots before they rotate into view, and the cycle’s curve.',
    visual: 'Data Centers add a helioseismology rack: a tall louvred cabinet with a slow-sweeping lamp.',
    tradeoff: 'Modelling the Sun takes racks from modelling the base.',
  },
  guidewayRails: {
    id: 'guidewayRails', era: 6, lane: 'materials', name: 'Guideway Rails', short: 'Guideway Rails',
    costData: 1000, costGoods: { parts: 30 }, requires: ['guidanceBeacons'],
    effects: [
      { kind: 'road', haulMult: 1.3 },
      { kind: 'road', cellMult: 1.2 },
    ],
    desc: 'Steel guide rails down the middle of every road: the excavators ride them at speed.',
    visual: 'Twin steel rails run down the centre of the roads.',
    tradeoff: 'Rails are laid, not poured.',
  },

  // ── faction branches, Era 6 ──
  lightsOutFoundry: {
    id: 'lightsOutFoundry', era: 6, lane: 'materials', name: 'Lights-Out Foundry', short: 'Lights-Out Foundry',
    costData: 1050, requires: ['autoSmelting'], factions: ['robots'],
    effects: [
      { kind: 'outputMult', buildings: ['foilFactory'], mult: 1.2, agentOnly: true },
      { kind: 'upkeepMult', buildings: ['foilFactory'], mult: 1.25 },
    ],
    desc: 'A foil line with no lights and no one in it: run by agents, the rolls come off cooler, cleaner and faster.',
    visual: 'Foil Factories black out their windows and hang an orange stack light above the line.',
    tradeoff: 'Nobody watching the line means nobody noticing it wear.',
  },
  launchFever: {
    id: 'launchFever', era: 6, lane: 'export', name: 'Launch Fever', short: 'Launch Fever',
    costData: 950, requires: ['launchSiteSurvey'], factions: ['accelerationists'],
    effects: [
      { kind: 'volley', launchCap: 2 },
      { kind: 'moraleBase', delta: -5 },
    ],
    desc: 'Launch day is a national holiday: a volley leaves needing one less unit of launch capacity.',
    visual: 'The Lander, Mass Drivers and Propellant Plants fly cobalt pennants.',
    tradeoff: 'The crew was promised a launch every day, and the mood sags when it does not come.',
  },
  cooperativeSwarm: {
    id: 'cooperativeSwarm', era: 6, lane: 'export', name: 'Cooperative Swarm', short: 'Cooperative Swarm',
    costData: 1000, requires: ['launchSiteSurvey'], factions: ['solarpunks'],
    effects: [
      { kind: 'volleyFoils', mult: 0.9 },
      { kind: 'upkeepMult', buildings: ['foilFactory', 'massDriver', 'propellantPlant'], mult: 1.15 },
    ],
    desc: 'Every program lends the others its tooling, and a shared sky needs fewer foils to fill: a volley flies with a tenth fewer.',
    visual: 'Foil Factories and Mass Drivers hang shared tooling racks painted leaf-green.',
    tradeoff: 'Shared tooling is shared wear.',
  },

  // ─── ERA 7 · SWARM INDUSTRY ───
  foilManufacturing: {
    id: 'foilManufacturing', era: 7, lane: 'materials', name: 'Thin-Film Foils', short: 'Thin-Film Foils',
    costData: 1250, costGoods: { silicon: 40 }, requires: ['waferFab'], requiresAny: ['cleanroomRobotics', 'dustMitigation'],
    effects: [{ kind: 'unlock', building: 'foilFactory' }],
    desc: 'Collector foils micrometres thick. Thin film needs clean handling.',
    visual: 'Foil Factories can rise: a coating hall with a foil-roll dock.',
    tradeoff: 'The largest draw you will ever build.',
  },
  massDriver: {
    id: 'massDriver', era: 7, lane: 'export', name: 'Electromagnetic Mass Driver', short: 'Mass Driver',
    costData: 1400, costGoods: { parts: 50 }, requires: ['partsFabrication', 'batteryStorage'], exclusive: 'launchArchitecture',
    effects: [{ kind: 'unlock', building: 'massDriver' }],
    desc: 'A 2.4 km/s rail with no propellant.',
    visual: 'Mass Drivers can rise: a 20 m inclined coil rail.',
    tradeoff: 'Rails can’t steer: latitude is destiny.',
  },
  propellantDepot: {
    id: 'propellantDepot', era: 7, lane: 'export', name: 'Propellant Depot', short: 'Propellant Depot',
    costData: 1400, costGoods: { parts: 40, metals: 40 },
    requires: ['partsFabrication'], requiresAny: ['iceExtraction', 'regolithVolatiles'], exclusive: 'launchArchitecture',
    effects: [{ kind: 'unlock', building: 'propellantPlant' }],
    desc: 'Water becomes LOX/LH₂; rockets steer where rails can’t.',
    visual: 'Propellant Plants can rise: twin foil-banded tanks.',
    tradeoff: 'The crew drinks the same water.',
  },
  selfReplication: {
    id: 'selfReplication', era: 7, lane: 'robotics', name: 'Self-Replicating Systems', short: 'Self-Replication',
    costData: 1700, costGoods: { parts: 80, chips: 15 },
    requires: ['lunarDataCenter'], requiresAny: ['swarmRobotics', 'heavyConstructors'],
    effects: [
      { kind: 'outputMult', buildings: ['excavator', 'smelter', 'refinery', 'iceMiner', 'iceHarvester', 'waterPlant'], mult: 1.3 },
      { kind: 'outputMult', buildings: ['partsFab', 'foilFactory'], mult: 1.6 },
      { kind: 'crewDelta', buildings: ['partsFab', 'foilFactory'], delta: -1 },
      { kind: 'botPerBay', delta: 1 },
      {
        kind: 'powerMult', mult: 1.25,
        buildings: ['excavator', 'smelter', 'refinery', 'iceMiner', 'iceHarvester', 'waterPlant', 'partsFab', 'foilFactory'],
      },
      { kind: 'upkeepMult', buildings: ['roboticsBay'], mult: 2 },
    ],
    desc: 'Machines that maintain and extend machines. Absorbs Self-Assembly and Automated Fabrication.',
    visual: 'Parts Fabricators and Robotics Bays grow replicator assembly arms.',
    tradeoff: 'Every doubling doubles a bad batch.',
  },
  deepSounding: {
    id: 'deepSounding', era: 7, lane: 'exploration', name: 'Deep Sounding Network', short: 'Deep Sounding',
    costData: 1250, costGoods: { chips: 20 }, requires: ['farSideRelay'],
    effects: [
      { kind: 'survey', tier: 4 },
      { kind: 'pitDepth', benches: 1 }, // docs/17 §10.3: one bedrock bench more
      { kind: 'powerDelta', building: 'lander', kw: -3 },
    ],
    desc: 'Orbital radar, GRAIL-class gravimetry and a seismometer network.',
    visual: 'A ring of seismometer pods is set out around the Lander.',
    tradeoff: 'Listening to the whole Moon takes power.',
  },
  superconductingBus: {
    id: 'superconductingBus', era: 7, lane: 'power', name: 'Superconducting Bus', short: 'Supercond. Bus',
    costData: 1100, costGoods: { metals: 60 }, requires: ['cryoRadiators'],
    effects: [
      { kind: 'powerMult', buildings: ['chipFab', 'dataCenter', 'foilFactory'], mult: 0.92 },
      { kind: 'upkeepMult', buildings: ['chipFab', 'dataCenter', 'foilFactory'], mult: 1.2 },
    ],
    desc: 'Cryo-cooled ducts carry the heavy loads with no resistive loss.',
    visual: 'Data Centers, Chip Fabs and Foil Factories run superconducting bus ducts.',
    tradeoff: 'A quench is a very bad day.',
  },
  rollToRoll: {
    id: 'rollToRoll', era: 7, lane: 'materials', name: 'Roll-to-Roll Coating', short: 'Roll-to-Roll',
    costData: 1100, requires: ['foilManufacturing'],
    effects: [
      { kind: 'outputMult', buildings: ['foilFactory'], mult: 1.12 },
      { kind: 'inputMult', buildings: ['foilFactory'], mult: 1.1 },
    ],
    desc: 'A second line coats while the first one cures.',
    visual: 'Foil Factories add a second roll-to-roll coating line.',
    tradeoff: 'Edge trim is scrap.',
  },
  foilAnnealing: {
    id: 'foilAnnealing', era: 7, lane: 'materials', name: 'Foil Annealing Ovens', short: 'Foil Annealing',
    costData: 1100, requires: ['foilManufacturing'],
    effects: [
      { kind: 'powerMult', buildings: ['foilFactory'], mult: 0.85 },
      { kind: 'upkeepMult', buildings: ['foilFactory'], mult: 1.3 },
    ],
    desc: 'Solar ovens on the roof anneal the film the grid used to.',
    visual: 'Foil Factories raise annealing ovens on the roof.',
    tradeoff: 'Oven mirrors pit.',
  },
  liquidCooling: {
    id: 'liquidCooling', era: 7, lane: 'compute', name: 'Liquid Cooling', short: 'Liquid Cooling',
    costData: 1100, costGoods: { metals: 40 }, requires: ['lunarDataCenter'],
    effects: [
      { kind: 'powerMult', buildings: ['dataCenter'], mult: 0.88 },
      { kind: 'upkeepMult', buildings: ['dataCenter'], mult: 1.25 },
    ],
    desc: 'Cold plates on every die, a pump loop to the radiators: fans retire.',
    visual: 'Data Centers run coolant manifolds to a pump skid; Server Monoliths, coolant risers down their fin stack.',
    tradeoff: 'Every fitting is a leak waiting.',
  },
  rackDensification: {
    id: 'rackDensification', era: 7, lane: 'compute', name: 'Rack Densification', short: 'Rack Density',
    costData: 1150, costGoods: { chips: 10 }, requires: ['lunarDataCenter'],
    effects: [
      { kind: 'outputMult', buildings: ['dataCenter'], mult: 1.12 },
      { kind: 'powerMult', buildings: ['dataCenter'], mult: 1.15 },
    ],
    desc: 'Twice the boards per rack, and an annex for the overflow.',
    visual: 'Data Centers add a rack annex at the berm, and Server Monoliths one at the foot.',
    tradeoff: 'Density is heat.',
  },
  lowGCourt: {
    id: 'lowGCourt', era: 7, lane: 'habitat', name: 'Low-G Court', short: 'Low-G Court',
    costData: 1000, requires: ['crewWellness'], expeditions: ['human'],
    effects: [
      { kind: 'morale', building: 'recDome', delta: 4 },
      { kind: 'inputMult', buildings: ['recDome'], mult: 1.4 },
    ],
    desc: 'Six-metre jumps, a ball that hangs: the best game on the Moon.',
    visual: 'Recreation Domes add a low-g court annex under a glass vault.',
    tradeoff: 'Athletes eat.',
  },
  laserRanging: {
    id: 'laserRanging', era: 7, lane: 'exploration', name: 'Laser Ranging', short: 'Laser Ranging',
    costData: 1000, requires: ['farSideRelay'],
    effects: [
      { kind: 'survey', dataMult: 1.2 },
      { kind: 'powerDelta', building: 'lander', kw: -1.5 },
    ],
    desc: 'Retroreflectors on every survey site tie the whole Moon to one centimetre grid.',
    visual: 'The Lander adds a laser-ranging telescope dome.',
    tradeoff: 'The laser fires all night.',
  },

  selfExpandingBase: {
    id: 'selfExpandingBase', era: 7, lane: 'robotics', name: 'Self-Expanding Base', short: 'Self-Expanding',
    costData: 1125, costGoods: { chips: 10, parts: 40 }, requires: ['autoFabrication', 'siteSurveyAI'],
    effects: [
      { kind: 'autoRule', family: 'network' },
      { kind: 'powerMult', buildings: ['relayMast'], mult: 1.3 },
    ],
    desc: 'The network grows itself: when the rules run out of ground, the rovers carry a mast to its edge.',
    visual: 'Relay Masts wear a beacon crown and a cable reel at the foot.',
    tradeoff: 'Every mast it plants is another light to keep burning.',
  },
  maintenanceAutomation: {
    id: 'maintenanceAutomation', era: 7, lane: 'compute', name: 'Maintenance Automation', short: 'Maint. Automation',
    costData: 1125, costGoods: { parts: 30 }, requires: ['autoFabrication'],
    effects: [
      { kind: 'maintenance', wear: 0.4 },
      { kind: 'upkeepMult', buildings: ['roboticsBay'], mult: 1.3 },
    ],
    desc: 'Short of parts, the critical loads are paid first; a machine that stays worn is replaced, and a tripped overclock comes back once it heals.',
    visual: 'Robotics Bays get a service crane arm over the charging rover.',
    tradeoff: 'Replacing is faster than repairing, and dearer.',
  },
  maglevFreight: {
    id: 'maglevFreight', era: 7, lane: 'robotics', name: 'Maglev Freight Lines', short: 'Maglev Freight',
    costData: 1100, costGoods: { chips: 10 }, requires: ['guidewayRails'],
    effects: [
      { kind: 'road', speedMult: 1.3, dustMult: 0 },
      { kind: 'road', cellMult: 1.25 },
    ],
    desc: 'Superconducting coils under the pavers lift the loads: nothing touches the ground, nothing kicks up dust.',
    visual: 'A glowing coil strip runs down the centre of the roads.',
    tradeoff: 'Coils take their time to bury.',
  },

  // ── faction branches, Era 7 ──
  swarmRelayUplink: {
    id: 'swarmRelayUplink', era: 7, lane: 'export', name: 'Swarm Relay Uplink', short: 'Swarm Relay Uplink',
    costData: 1400, requires: ['launchSiteSurvey'], factions: ['robots'],
    effects: [
      { kind: 'volley', launchCap: 2 },
      { kind: 'powerDelta', building: 'lander', kw: -3 },
    ],
    desc: 'A relay dish on every launcher, tied to the swarm itself: a volley leaves needing one less unit of launch capacity.',
    visual: 'The Lander raises a second relay dish, pointed at the swarm.',
    tradeoff: 'The dish never sleeps, and it draws on the Lander’s bus.',
  },
  mediaBlitz: {
    id: 'mediaBlitz', era: 7, lane: 'compute', name: 'Media Blitz', short: 'Media Blitz',
    costData: 1150, requires: ['pressCorps', 'scienceCrews'], factions: ['accelerationists'],
    effects: [
      { kind: 'scrutiny', firstLight: { clear: true, morale: 10 } },
      { kind: 'powerMult', buildings: ['lab', 'dataCenter'], mult: 1.15 },
    ],
    desc: 'First light is a broadcast: it clears every black mark on the meter, and for a lunar day nobody is tired.',
    visual: 'Mission Ops raise a second press dish and a media mast.',
    tradeoff: 'Broadcast-quality uplinks draw power the labs could have used.',
  },
  guardianship: {
    id: 'guardianship', era: 7, lane: 'exploration', name: 'Guardianship', short: 'Guardianship',
    costData: 1250, requires: ['farSideRelay'], factions: ['solarpunks'],
    effects: [
      { kind: 'rivalAid', data: 120 },
      { kind: 'powerDelta', building: 'lander', kw: -3 },
    ],
    desc: 'Someone has to watch the Moon: when another program suffers a disaster, the Commons sits the watch and the data comes to you.',
    visual: 'The Lander raises a beacon mast with a green watch lamp.',
    tradeoff: 'The watch never ends, and it runs on the Lander’s bus.',
  },
  longNightGardens: {
    id: 'longNightGardens', era: 7, lane: 'habitat', name: 'Long Night Gardens', short: 'Long Night Gardens',
    costData: 1000, requires: ['galleyGarden'], factions: ['solarpunks'],
    effects: [
      { kind: 'nightOutput', buildings: ['greenhouseRing'], mult: 1.2 },
      { kind: 'powerMult', buildings: ['greenhouseRing'], mult: 1.15 },
    ],
    desc: 'Banked soil, stored heat and lamps on a timer: the rings are at their best while everything else sleeps.',
    visual: 'Greenhouse Rings glow green through the night under thermal curtains.',
    tradeoff: 'Lamps in the dark are kilowatts, and the night is long.',
  },

  // ─── ERA 8 · DYSON SWARM (capstone column) ───
  railCapacitors: {
    id: 'railCapacitors', era: 8, name: 'Rail Capacitor Banks', short: 'Rail Capacitors',
    costData: 1600, requires: ['massDriver'],
    effects: [
      { kind: 'powerMult', buildings: ['massDriver'], mult: 0.8 },
      { kind: 'upkeepMult', buildings: ['massDriver'], mult: 1.4 },
    ],
    desc: 'Banks along the rail charge slowly and fire the coils in one breath: the launch cadence a swarm needs.',
    visual: 'Mass Drivers line their rail with capacitor banks.',
    tradeoff: 'Capacitors age with every shot.',
  },
  cryocoolerHeads: {
    id: 'cryocoolerHeads', era: 8, name: 'Cryocooler Heads', short: 'Cryocooler Heads',
    costData: 1600, requires: ['propellantDepot'],
    effects: [
      { kind: 'outputMult', buildings: ['propellantPlant'], mult: 1.15 },
      { kind: 'powerMult', buildings: ['propellantPlant'], mult: 1.2 },
    ],
    desc: 'Zero boil-off: every gram liquefied stays liquid, so rockets fly on a swarm’s cadence.',
    visual: 'Propellant Plants cap their tanks with cryocooler heads.',
    tradeoff: 'Cold costs watts forever.',
  },
  canisterPress: {
    id: 'canisterPress', era: 8, name: 'Canister Press', short: 'Canister Press',
    costData: 1600, requires: ['foilManufacturing'],
    effects: [
      { kind: 'outputMult', buildings: ['foilFactory'], mult: 1.1 },
      { kind: 'upkeepMult', buildings: ['foilFactory'], mult: 1.3 },
    ],
    desc: 'Foils fold into launch canisters at the dock instead of on the pad.',
    visual: 'Foil Factories add a canister press at the loading dock.',
    tradeoff: 'Presses wear dies.',
  },
  swarmProtocol: {
    id: 'swarmProtocol', era: 8, name: 'Swarm Protocol', short: 'Swarm Protocol',
    costData: 1800, costGoods: { foils: 5, chips: 10 },
    requires: ['foilManufacturing'], requiresAny: ['missionControl', 'autoCadence'],
    effects: [{ kind: 'launchAction' }],
    desc: 'Deployment doctrine for a trillion collectors.',
    visual: 'Mass Drivers and Propellant Plants raise a swarm-tracking beacon mast.',
    tradeoff: 'The five test foils never come back.',
  },
  powerBeaming: {
    id: 'powerBeaming', era: 8, name: 'Power Beaming Return', short: 'Power Beaming',
    costData: 3400, requires: ['swarmProtocol', 'batteryStorage'], exclusive: 'swarmPurpose',
    effects: [{ kind: 'powerBeam' }],
    desc: 'The swarm pays rent in microwaves.',
    visual: 'A rectenna mesh unfolds beside the Lander.',
    tradeoff: 'Your grid now depends on hardware 40 million km away.',
  },
  vonNeumann: {
    id: 'vonNeumann', era: 8, name: 'Von Neumann Foundry', short: 'Von Neumann',
    costData: 4000, costGoods: { foils: 20 }, requires: ['swarmProtocol', 'selfReplication'], exclusive: 'swarmPurpose',
    effects: [
      { kind: 'outputMult', buildings: ['foilFactory'], mult: 3 },
      { kind: 'powerMult', buildings: ['foilFactory'], mult: 1.5 },
    ],
    desc: 'Foil factories that seed foil factories.',
    visual: 'Foil Factories sprout seed-factory pods on the roof.',
    tradeoff: 'A monument to obsolescence.',
  },

  // ─── DESTINY (docs/14 §2): one ⌂ Colony / ◉ Automation pick per era, then a capstone ───
  // Picks live in their era page's header, not in a lane. Each costs its era's
  // median tech, is required to open the next era and counts toward its charter
  // (the landing pick excepted). No pick requires another, and none is a doctrine.
  landingCrew: {
    id: 'landingCrew', era: 1, name: 'Crewed Landing', short: 'Crewed Landing',
    costData: 0, requires: [], expeditions: ['human'], track: { era: 1, side: 'colony', landing: true },
    effects: [],
    desc: 'Seven people and a supply cache: the human expedition, chosen on the landing screen.',
    visual: 'The Lander flies a flag, and its crew cabin shows a lit window band.',
    tradeoff: 'People are the point, and people are fragile.',
  },
  landingRobotic: {
    id: 'landingRobotic', era: 1, name: 'Robotic Mission', short: 'Robotic Mission',
    costData: 0, requires: [], expeditions: ['robotic'], track: { era: 1, side: 'automation', landing: true },
    effects: [],
    desc: 'No one aboard: the robotic expedition, chosen on the landing screen.',
    visual: 'The Lander’s cabin windows are blanked, and a rover rides stowed in a cradle on its hull.',
    tradeoff: 'Machines cannot die, and cannot dream either.',
  },
  // ── the three faction landings (docs/20 §1): every trait of a faction is an effect here, so it
  // flows through computeMods like any tech. They are faction-locked (`factions`): solo games never
  // see them (landingCrew / landingRobotic stay the solo landings), a faction game sees only its own.
  landingFoundry: {
    id: 'landingFoundry', era: 1, name: 'Foundry Landing', short: 'Foundry Landing',
    costData: 0, requires: [], expeditions: ['robotic'], factions: ['robots'],
    track: { era: 1, side: 'automation', landing: true },
    effects: [
      { kind: 'buildSpeed', mult: 0.9 },
      { kind: 'laneCost', lane: 'robotics', mult: 0.85 },
      { kind: 'laneCost', lane: 'compute', mult: 0.85 },
      { kind: 'survey', range: 1.15 },
      { kind: 'flareVuln', arrayHard: 1.6, machine: 1.75 },
      { kind: 'nightMode', output: 0.25, standby: 1.3, chargeEff: 0.75, discharge: 1.25 },
    ],
    desc: 'Machines first. A lander with no beds, no air and nobody to wait for: the Foundry is on the Moon before anyone, and it builds while the rest are still packing.',
    visual: 'The Lander’s cabin windows are blanked, a rover rides stowed in a cradle on its hull, an antenna mast rises and orange hazard bands mark the plating.',
    tradeoff: 'Machines have no margin: a flare hits them hardest, and in the long night they crawl on a thin, leaky bank.',
  },
  landingVanguard: {
    id: 'landingVanguard', era: 1, name: 'Vanguard Landing', short: 'Vanguard Landing',
    costData: 0, requires: [], expeditions: ['human'], factions: ['accelerationists'],
    track: { era: 1, side: 'colony', landing: true },
    effects: [
      { kind: 'outputMult', buildings: ['lab'], mult: 1.35 },
      { kind: 'outputMult', buildings: ['dataCenter'], mult: 1.2 },
      { kind: 'laneCost', lane: 'compute', mult: 0.8 },
      { kind: 'laneCost', lane: 'materials', mult: 0.8 },
      { kind: 'grant', data: 100 },
      { kind: 'moraleBase', delta: -8 },
      { kind: 'moraleDynamics', fallMult: 2 },
      { kind: 'scrutiny', on: true },
      { kind: 'hazardRate', mult: 1.25 },
      { kind: 'pickCost', side: 'colony', mult: 1.15 },
    ],
    desc: 'Seven people, a flag and a launch window to win. The Vanguard runs its labs hot and publishes everything: data comes cheap, silicon and steel come cheaper, and the whole world reads the log.',
    visual: 'The Lander flies a flag, a press dish turns toward Earth, the crew cabin shows a lit window band and cobalt fins trim the hull.',
    tradeoff: 'Everybody is watching: a death, a wreck or an accident becomes a hearing, and a hearing brings people home.',
  },
  landingCommons: {
    id: 'landingCommons', era: 1, name: 'Commons Landing', short: 'Commons Landing',
    costData: 0, requires: [], expeditions: ['human'], factions: ['solarpunks'],
    track: { era: 1, side: 'colony', landing: true },
    effects: [
      { kind: 'moraleBase', delta: 10 },
      { kind: 'hazardRate', mult: 0.6 },
      { kind: 'guard', guard: 'safety' },
      { kind: 'laneCost', lane: 'habitat', mult: 0.6 },
      { kind: 'laneCost', lane: 'materials', mult: 1.3 },
      { kind: 'laneCost', lane: 'robotics', mult: 1.3 },
      { kind: 'laneCost', lane: 'exploration', mult: 1.3 },
      { kind: 'growth', mult: 1 / 1.25 },
      { kind: 'buildSpeed', mult: 1.3 },
      { kind: 'pickCost', side: 'colony', mult: 0.85 },
    ],
    desc: 'A crew that came to stay. The Commons build for people first: a well-fed, well-warned base that grows on its own and shelters the swarm as a commons, slow to raise and dear in steel and machines.',
    visual: 'The Lander wears solar awnings, planter boxes by its door and a green banner.',
    tradeoff: 'Nothing here is built in a hurry, and the machines are the dear part.',
  },
  pressureHalls: {
    id: 'pressureHalls', era: 2, name: 'Pressure-Rated Halls', short: 'Pressure Halls',
    costData: 120, costGoods: { metals: 20 }, requires: [], track: { era: 2, side: 'colony' },
    effects: [
      { kind: 'upkeepMult', buildings: ['lab', 'partsFab', 'roboticsBay'], mult: 0.8 },
      { kind: 'repair', mult: 1.15 },
      { kind: 'morale', building: 'lab', delta: 2, crew: true },
      { kind: 'guard', guard: 'suitports' },
      { kind: 'buildTime', buildings: ['lab', 'partsFab', 'roboticsBay'], mult: 1.3 },
      { kind: 'exposure', hazard: 'breach', buildings: ['lab', 'partsFab', 'roboticsBay'] },
      { kind: 'exposure', hazard: 'dust', buildings: ['lab', 'partsFab', 'roboticsBay'] },
    ],
    desc: 'Workshops built to hold air: a technician walks in without a suit, and the seals keep the knife-dust out of the bearings.',
    visual: 'Labs, Parts Fabricators and Robotics Bays gain an airlock porch with a lit round window.',
    tradeoff: 'A hull that holds air is a hull that can lose it.',
  },
  dispatchMesh: {
    id: 'dispatchMesh', era: 2, name: 'Dispatch Mesh', short: 'Dispatch Mesh',
    costData: 120, costGoods: { parts: 10 }, requires: [], track: { era: 2, side: 'automation' },
    effects: [
      { kind: 'buildSpeed', mult: 0.88 },
      { kind: 'radius', building: 'relayMast', deltaM: 15 },
      { kind: 'powerMult', buildings: ['relayMast'], mult: 1.4 },
      { kind: 'powerDelta', building: 'lander', kw: -1 },
      { kind: 'exposure', hazard: 'malware', buildings: ['relayMast', 'roboticsBay', 'lander'] },
    ],
    desc: 'The rovers stop waiting on Earth: a mesh radio lets every mast, bay and rover hand work to the next.',
    visual: 'Robotics Bays and Relay Masts raise a mesh-radio whip with a blinking node lamp; the Lander gains a router cabinet.',
    tradeoff: 'Every node that can talk can be talked to.',
  },
  crewCharter: {
    id: 'crewCharter', era: 3, name: 'Crew Rotation Charter', short: 'Crew Rotation',
    costData: 150, costGoods: { parts: 30 }, requires: [], track: { era: 3, side: 'colony' },
    effects: [
      { kind: 'bringsCrew', expeditions: ['robotic'] },
      { kind: 'growth', mult: 2 / 3, expeditions: ['human'] },
      { kind: 'eva', share: 0.1, crew: true },
      { kind: 'powerMult', buildings: ['habitat'], mult: 1.2 },
      { kind: 'exposure', hazard: 'dose' },
      { kind: 'exposure', hazard: 'cabinFever' },
      { kind: 'guard', guard: 'earthContact' },
    ],
    desc: 'A standing charter with Earth: crews rotate in on a schedule, and the ones aboard go outside to keep the base.',
    visual: 'Habitats wear a lit hab-ring collar and a suit-port porch; the Lander raises a crew-rotation beacon mast; pressurized walkways join the lived-in buildings, and suited EVA crews walk out by day.',
    tradeoff: 'People who come to stay have to be kept.',
  },
  droneHives: {
    id: 'droneHives', era: 3, name: 'Drone Hives', short: 'Drone Hives',
    costData: 150, costGoods: { parts: 30 }, requires: [], track: { era: 3, side: 'automation' },
    effects: [
      { kind: 'unlock', building: 'droneHive' },
      { kind: 'repair', mult: 1.15 },
      { kind: 'guard', guard: 'hiveReflash' },
      { kind: 'exposure', hazard: 'firmware' },
    ],
    desc: 'More machines instead of more people: a hive docks four construction drones on one pad.',
    visual: 'Drone Hives can rise: a honeycomb of docks by a landing deck, whose rovers fly as drones; Robotics Bays hang a drone perch off the back wall.',
    tradeoff: 'Four drones, one firmware image.',
  },
  hydroCommons: {
    id: 'hydroCommons', era: 4, name: 'Hydroponic Commons', short: 'Hydro Commons',
    costData: 240, costGoods: { metals: 30 }, requires: [], track: { era: 4, side: 'colony' },
    effects: [
      { kind: 'bringsCrew', expeditions: ['robotic'] },
      { kind: 'outputMult', buildings: ['hydroponics'], mult: 1.15 },
      { kind: 'morale', building: 'hydroponics', delta: 3, crew: true },
      { kind: 'guard', guard: 'commonsMeals' },
      { kind: 'inputMult', buildings: ['hydroponics'], mult: 1.25 },
      { kind: 'exposure', hazard: 'blight' },
    ],
    desc: 'The farms become the base’s living room: a galley among the vines, tended by the people who eat from it.',
    visual: 'Hydroponics vaults glaze their door end into a lit galley, and a leaf-green trellis runs down both flanks.',
    tradeoff: 'A garden is thirsty.',
  },
  lightsOutFabs: {
    id: 'lightsOutFabs', era: 4, name: 'Lights-Out Fabs', short: 'Lights-Out Fabs',
    costData: 240, costGoods: { parts: 15 }, requires: [], track: { era: 4, side: 'automation' },
    effects: [
      { kind: 'crewDelta', buildings: ['partsFab', 'chipFab'], delta: -1 },
      { kind: 'outputMult', buildings: ['chipFab'], mult: 1.1 },
      { kind: 'guard', guard: 'signedFirmware' },
      { kind: 'powerMult', buildings: ['partsFab', 'chipFab'], mult: 1.2 },
      { kind: 'exposure', hazard: 'malware', buildings: ['partsFab', 'chipFab'] },
      { kind: 'exposure', hazard: 'firmware' },
    ],
    desc: 'Fabs that need no window and no seat: masks and firmware arrive over the network, and the lights stay off.',
    visual: 'Chip Fabs and Parts Fabricators shutter their windows and run a roof cable tray to a node with a cold lamp; conveyor spines join the industry.',
    tradeoff: 'A fab that takes updates takes bad ones too.',
  },
  greenhouseRings: {
    id: 'greenhouseRings', era: 5, name: 'Greenhouse Rings', short: 'Greenhouse Rings',
    costData: 400, costGoods: { silicon: 20 }, requires: [], track: { era: 5, side: 'colony' },
    effects: [
      { kind: 'unlock', building: 'greenhouseRing' },
      { kind: 'bringsCrew', expeditions: ['robotic'] },
      { kind: 'guard', guard: 'seedBank' },
      { kind: 'exposure', hazard: 'blight' },
      { kind: 'exposure', hazard: 'contamination' },
    ],
    desc: 'What grows here is food: a ring of glass vaults round a hub, three farms’ harvest on two crew.',
    visual: 'Greenhouse Rings can rise: green vaults under glass round a domed hub; Hydroponics Farms keep a seed-bank vault.',
    tradeoff: 'One ring, one monoculture.',
  },
  fleetOS: {
    id: 'fleetOS', era: 5, name: 'Fleet OS', short: 'Fleet OS',
    costData: 400, costGoods: { chips: 10 }, requires: [], track: { era: 5, side: 'automation' },
    effects: [
      { kind: 'hubBays', delta: 1 },
      { kind: 'unlock', building: 'serverMonolith' },
      { kind: 'agentTax', mult: 0.85 },
      { kind: 'builder', dwellMult: 0.5, families: ['research'] },
      { kind: 'guard', guard: 'intrusionDetection' },
      { kind: 'powerMult', buildings: ['dataCenter'], mult: 1.15 },
      { kind: 'exposure', hazard: 'controlPlane' },
    ],
    desc: 'What grows here is compute: one operating system for every agent, rover and rule, run from the racks.',
    visual: 'Server Monoliths can rise: black slabs with a cold lamp stripe; Data Centers raise a monolith annex in their berm.',
    tradeoff: 'One control plane is one thing to lose.',
  },
  settlerCharter: {
    id: 'settlerCharter', era: 6, name: 'Settler Charter', short: 'Settler Charter',
    costData: 1000, costGoods: { metals: 40 }, requires: [], track: { era: 6, side: 'colony' },
    effects: [
      { kind: 'bringsCrew', expeditions: ['robotic'] },
      { kind: 'housing', building: 'habitat', delta: 1 },
      { kind: 'growth', mult: 2 / 3, crew: true },
      { kind: 'outputMult', buildings: ['lab', 'smelter', 'refinery', 'partsFab', 'chipFab', 'waterPlant'], mult: 1.15, crewedOnly: true },
      { kind: 'guard', guard: 'stormShelters' },
      { kind: 'inputMult', buildings: ['habitat'], mult: 1.2 },
      { kind: 'exposure', hazard: 'cabinFever' },
    ],
    desc: 'The Moon is a home: families, not rotations, and a vote on how the base is run.',
    visual: 'Habitats stack a second storey: a habitation terrace with a balcony rail, planters and warm windows.',
    tradeoff: 'Families stay, and families grow restless.',
  },
  lightsOutCharter: {
    id: 'lightsOutCharter', era: 6, name: 'Lights-Out Charter', short: 'Lights-Out Charter',
    costData: 1000, costGoods: { chips: 20 }, requires: [], track: { era: 6, side: 'automation' }, notFactions: ['solarpunks'],
    effects: [
      { kind: 'waive', tech: 'humanCohabitation', expeditions: ['robotic'] },
      { kind: 'agentTax', mult: 0.8 },
      { kind: 'repair', mult: 1.2 },
      { kind: 'guard', guard: 'watchdogs' },
      { kind: 'powerMult', buildings: ['dataCenter', 'roboticsBay'], mult: 1.2 },
      { kind: 'growth', mult: 0, crew: true },
    ],
    desc: 'The Moon is a machine: the base is certified to run with no one aboard, and no one else is invited.',
    visual: 'Relay Masts wear a firewall node, Robotics Bays add an antenna farm, and any Habitats shutter their windows.',
    tradeoff: 'A base built for no one is lonely by design.',
  },
  gardenDomes: {
    id: 'gardenDomes', era: 7, name: 'Garden Domes', short: 'Garden Domes',
    costData: 1125, costGoods: { silicon: 40 }, requires: [], track: { era: 7, side: 'colony' },
    effects: [
      { kind: 'unlock', building: 'gardenDome' },
      { kind: 'bringsCrew', expeditions: ['robotic'] },
      { kind: 'guard', guard: 'bulkheads' },
      { kind: 'exposure', hazard: 'breach', buildings: ['gardenDome'] },
    ],
    desc: 'Domes, not replicators: ten beds round a park under glass, the best place on the Moon to live.',
    visual: 'Garden Domes can rise: a glass dome over a green park, ringed by lit window terraces; walkways are glazed and lit, and airlocks gain pressure bulkheads.',
    tradeoff: 'The biggest hull holds the most air to lose.',
  },
  replicatorStacks: {
    id: 'replicatorStacks', era: 7, name: 'Replicator Stacks', short: 'Replicator Stacks',
    costData: 1125, costGoods: { chips: 20, parts: 30 }, requires: [], track: { era: 7, side: 'automation' }, notFactions: ['solarpunks'],
    effects: [
      { kind: 'hubPrint', timeMult: 0.5 },
      { kind: 'outputMult', buildings: ['partsFab', 'foilFactory'], mult: 1.2 },
      { kind: 'builder', capMult: 2, families: ['export'] },
      { kind: 'guard', guard: 'attestation' },
      { kind: 'powerMult', buildings: ['partsFab', 'foilFactory'], mult: 1.2 },
      { kind: 'upkeepMult', buildings: ['roboticsBay', 'droneHive'], mult: 1.3 },
      { kind: 'exposure', hazard: 'runaway' },
    ],
    desc: 'Replicators, not domes: fabs stacked two storeys high, and a Builder allowed twice as far.',
    visual: 'Parts Fabricators and Foil Factories stack a second fab storey under a gantry, and Drone Hives a drone printer; conveyor spines light cold chevrons.',
    tradeoff: 'A replicator does exactly what the rules say.',
  },
  missionControl: {
    id: 'missionControl', era: 8, name: 'Crewed Mission Control', short: 'Mission Control',
    costData: 1600, requires: [], track: { era: 8, side: 'colony' },
    effects: [
      { kind: 'volley', launchCap: 2, morale: 8, minCrew: 4 },
      { kind: 'bringsCrew', expeditions: ['robotic'] },
      { kind: 'guard', guard: 'launchDays' },
      { kind: 'crewDelta', buildings: ['massDriver', 'propellantPlant'], delta: 1 },
    ],
    desc: 'People launch the swarm: a crew on console calls every volley, and the base turns out to watch.',
    visual: 'Mass Drivers and Propellant Plants gain a glazed launch-control blockhouse with lit consoles and a viewing gallery.',
    tradeoff: 'A ceremony needs its people.',
  },
  autoCadence: {
    id: 'autoCadence', era: 8, name: 'Autonomous Cadence', short: 'Auto Cadence',
    costData: 1600, requires: [], track: { era: 8, side: 'automation' },
    effects: [
      { kind: 'autoLaunch', burstMult: 0.75 },
      { kind: 'powerMult', buildings: ['massDriver', 'propellantPlant'], mult: 1.3 },
      { kind: 'exposure', hazard: 'malware', buildings: ['massDriver', 'propellantPlant'] },
    ],
    desc: 'Machines launch the swarm: the rail fires whenever the foils, the capacity and the charge are ready.',
    visual: 'Mass Drivers and Propellant Plants raise a black guidance monolith with a cold tracking lamp.',
    tradeoff: 'Nobody presses the button, so nobody can stop it.',
  },
  commonwealth: {
    id: 'commonwealth', era: 8, name: 'Lunar Commonwealth', short: 'Commonwealth',
    costData: 3400, requires: ['swarmProtocol'], band: 'colony',
    effects: [
      { kind: 'moraleBase', delta: 10, crew: true },
      { kind: 'housing', building: 'habitat', delta: 2 },
      { kind: 'housing', building: 'gardenDome', delta: 2 },
      {
        kind: 'outputMult', mult: 1.1, crewedOnly: true,
        buildings: ['lab', 'smelter', 'refinery', 'partsFab', 'chipFab', 'foilFactory', 'hydroponics', 'greenhouseRing', 'waterPlant'],
      },
      { kind: 'inputMult', buildings: ['habitat'], mult: 1.2 },
      { kind: 'exposure', hazard: 'cabinFever' },
    ],
    desc: 'The Moon has citizens: a charter, a flag, and a city under glass that means to stay.',
    visual: 'Habitats, Greenhouse Rings and Garden Domes string festival lamps, and the Lander gains a commons plaza with a flagpole.',
    tradeoff: 'Citizens ask for more than settlers did.',
  },
  selenicMind: {
    id: 'selenicMind', era: 8, name: 'Selenic Mind', short: 'Selenic Mind',
    costData: 3400, requires: ['swarmProtocol'], band: 'automation',
    effects: [
      { kind: 'builder', capMult: 2, families: ['research', 'export'], all: true },
      { kind: 'outputMult', buildings: ['foilFactory', 'dataCenter', 'serverMonolith'], mult: 1.25 },
      { kind: 'powerMult', buildings: ['foilFactory', 'dataCenter', 'serverMonolith'], mult: 1.25 },
      { kind: 'exposure', hazard: 'malware' },
    ],
    desc: 'The Moon runs itself: one mind for every rack, rover and rule, building what it decides it needs.',
    visual: 'Server Monoliths and Data Centers crown themselves with radiator fins.',
    tradeoff: 'A mind this size is a target this size.',
  },
  concord: {
    id: 'concord', era: 8, name: 'Concord', short: 'Concord',
    costData: 3400, requires: ['swarmProtocol'], band: 'concord',
    effects: [
      { kind: 'agentTax', mult: 0.8 },
      { kind: 'moraleBase', delta: 5, crew: true },
      { kind: 'hazardRate', mult: 0.7 },
      { kind: 'upkeepMult', buildings: 'all', mult: 1.1 },
    ],
    desc: 'People and machines, each doing what they do best: joint operations, by treaty.',
    visual: 'The Lander raises a joint-operations mast: a lit crew cabin under a drone perch.',
    tradeoff: 'A treaty is two sets of maintenance.',
  },
};

/** Canonical order: the table above, era by era, prerequisites before dependents. */
export const TECH_ORDER = Object.keys(TECHS) as TechId[];

export const ERA_NAMES: Record<number, string> = {
  1: 'FIRST LANDING', 2: 'EARLY CONSTRUCTION', 3: 'ROBOTIC FABRICATION',
  4: 'CHIP FABRICATION', 5: 'LUNAR COMPUTE', 6: 'HUMAN HABITATION',
  7: 'SWARM INDUSTRY', 8: 'DYSON SWARM',
};
/** What opening an era means, in a sentence or two: the era explainer's
 *  body (ui/discovery.ts). Say what changes and what to aim for. */
export const ERA_BLURB: Record<number, string> = {
  1: 'The lander’s cache is all you have. Smelt regolith into metal, find water, and teach your robots the ground they will build on.',
  2: 'The base starts making its own parts. Batteries carry you through the night, silicon comes out of the soil, and robots begin to build for you.',
  3: 'Machines start making machines. Choose how the base survives the long night and how your fleet builds — both choices are permanent.',
  4: 'Vacuum is a free cleanroom. Turn silicon into chips, and decide what those chips are for.',
  5: 'Data Centers under regolith multiply your research. From here, compute is the engine of the base.',
  6: 'The base is ready for people. Life support, wellness and safety matter now, and crews research faster than agents.',
  7: 'Industry for orbit: thin-film foils, a way to throw them, and machines that copy themselves. Outposts across the Moon feed the base.',
  8: 'The first collectors fly. Every volley adds to a swarm that will one day circle the Sun.',
};
/** era-header column labels: `E5 · COMPUTE` */
export const ERA_SHORT: Record<number, string> = {
  1: 'LANDING', 2: 'CONSTRUCTION', 3: 'FABRICATION', 4: 'CHIPS',
  5: 'COMPUTE', 6: 'HABITATION', 7: 'INDUSTRY', 8: 'SWARM',
};

// ─────────────────────────── destiny (docs/14 §2) ───────────────────────────

/** One binary pick per era: ⌂ Colony or ◉ Automation. Era 1's is the landing. */
export const TRACKS: Record<Era, { colony: TechId; automation: TechId; question: string }> = {
  1: { colony: 'landingCrew', automation: 'landingRobotic', question: 'Who goes to the Moon?' },
  2: { colony: 'pressureHalls', automation: 'dispatchMesh', question: 'Who are these halls built for?' },
  3: { colony: 'crewCharter', automation: 'droneHives', question: 'Who comes next: people, or more machines?' },
  4: { colony: 'hydroCommons', automation: 'lightsOutFabs', question: 'Does a fab need a window or a network?' },
  5: { colony: 'greenhouseRings', automation: 'fleetOS', question: 'What grows here: gardens or compute?' },
  6: { colony: 'settlerCharter', automation: 'lightsOutCharter', question: 'Is the Moon a home, or a machine?' },
  7: { colony: 'gardenDomes', automation: 'replicatorStacks', question: 'Domes, or replicators?' },
  8: { colony: 'missionControl', automation: 'autoCadence', question: 'Who launches the swarm?' },
};
export const SIDES: Side[] = ['colony', 'automation'];
export const SIDE_GLYPH: Record<Side, string> = { colony: '⌂', automation: '◉' };
export const SIDE_LABEL: Record<Side, string> = { colony: 'COLONY', automation: 'AUTOMATION' };
export const BAND_LABEL: Record<Band, string> = { colony: '⌂ COLONY', automation: '◉ AUTOMATION', concord: 'CONCORD' };
/** the ending each band earns (docs/14 §5) */
export const BAND_ENDING: Record<Band, string> = {
  colony: 'THE COMMONWEALTH', automation: 'THE LIGHTS-OUT MOON', concord: 'THE CONCORD',
};
/** the capstone each band unlocks (Era 8, after Swarm Protocol) */
export const CAPSTONES: Record<Band, TechId> = { colony: 'commonwealth', automation: 'selenicMind', concord: 'concord' };
/** the landing pick of each expedition (pushed into techsDone at landing) */
export const LANDING_TECH: Record<Expedition, TechId> = { human: 'landingCrew', robotic: 'landingRobotic' };
/** the landing pick of a faction's game (docs/20): its own landing tech, which carries its traits */
export const landingTechFor = (faction: FactionId): TechId => LANDING_TECH_FOR[faction];
/** every landing, by the side it counts on toward the Era 1 destiny pick: the solo landings and the faction ones */
const LANDINGS_OF: Record<Side, TechId[]> = {
  colony: ['landingCrew', 'landingVanguard', 'landingCommons'],
  automation: ['landingRobotic', 'landingFoundry'],
};
/** Era 8's blurb once the band is known (banner and page header) */
export const ERA_BLURB_8: Record<Band, string> = {
  colony: 'The first collectors fly from a city under glass. Every volley is a launch day.',
  automation: 'The rail fires itself. Every volley is logged, not watched.',
  concord: 'People on console, machines on the rail.',
};

/** The picks done, per era and per side, and the band they make: settled
 *  once the Era 8 pick is done (6 of 8 on a side is pure, else Concord). */
export function destinyCounts(done: readonly string[]): {
  picks: Partial<Record<Era, Side>>; c: number; a: number; band: Band | null;
} {
  const picks: Partial<Record<Era, Side>> = {};
  let c = 0, a = 0;
  for (let e = 1 as Era; e <= 8; e = (e + 1) as Era) {
    const t = TRACKS[e];
    // Era 1's pick is the landing: a faction's own counts on its side as the solo landings do
    const col = e === 1 ? LANDINGS_OF.colony.some((l) => done.includes(l)) : done.includes(t.colony);
    const aut = e === 1 ? LANDINGS_OF.automation.some((l) => done.includes(l)) : done.includes(t.automation);
    if (col) c++;
    if (aut) a++;
    if (col || aut) picks[e] = col ? 'colony' : 'automation';
  }
  const settled = !!picks[8];
  const band: Band | null = !settled ? null : c >= PURE_AT ? 'colony' : a >= PURE_AT ? 'automation' : 'concord';
  return { picks, c, a, band };
}

export interface LaneDef { id: Lane; glyph: string; label: string; holds: string }
export const LANES: LaneDef[] = [
  { id: 'power', glyph: '⚡', label: '⚡ POWER', holds: 'generation, storage and the night' },
  { id: 'materials', glyph: '◆', label: '◆ MATERIALS', holds: 'ISRU, smelting, dust, wafers, foils' },
  { id: 'robotics', glyph: '◉', label: '◉ ROBOTS & FAB', holds: 'builders, parts, cleanroom, safety, replication' },
  { id: 'compute', glyph: '▣', label: '▣ SILICON & COMPUTE', holds: 'silicon, chip doctrine, Data Centers, clocking, science crews' },
  { id: 'habitat', glyph: '⌂', label: '⌂ HABITAT', holds: 'water, shielding, humans' },
  { id: 'exploration', glyph: '◎', label: '◎ EXPLORATION', holds: 'map tiers and the 3 breakthrough slots' },
  { id: 'export', glyph: '↑', label: '↑ EXPORT', holds: 'launch doctrine' },
];
export const LANE_ORDER: Lane[] = LANES.map((l) => l.id);

export interface DoctrineDef {
  id: DoctrineId;
  era: Era;
  /** bracket hover */
  question: string;
  members: [TechId, TechId];
  /** the site, not a hint, supplies the natural answer */
  siteNote: Partial<Record<SiteId, string>>;
}
export const DOCTRINES: Record<DoctrineId, DoctrineDef> = {
  smeltDoctrine: {
    id: 'smeltDoctrine', era: 2, question: 'How hard do you push the furnace?',
    members: ['moltenElectrolysis', 'ilmeniteBeneficiation'],
    siteNote: {
      mare: 'Plenty of ilmenite, and MRE kills the only water trickle.',
      southpole: 'MRE stands alone: highland soil barely reacts to H₂.',
      lavatube: 'A genuine split.',
    },
  },
  nightPower: {
    id: 'nightPower', era: 3, question: 'How does the base survive the 14-day night?',
    members: ['thoriumPower', 'regenFuelCells'],
    siteNote: {
      mare: 'Thorium: the night is long.',
      southpole: 'Fuel cells: ice gives water and the pole’s night is short.',
      lavatube: 'Thorium: the sun is a rumour down here.',
    },
  },
  constructionDoctrine: {
    id: 'constructionDoctrine', era: 3, question: 'Many hands, or strong ones?',
    members: ['swarmRobotics', 'heavyConstructors'],
    siteNote: {},
  },
  chipDoctrine: {
    id: 'chipDoctrine', era: 4, question: 'What are your chips for?',
    members: ['acceleratorDesign', 'radHardProcess'],
    siteNote: {},
  },
  launchArchitecture: {
    id: 'launchArchitecture', era: 7, question: 'How does a foil reach orbit?',
    members: ['massDriver', 'propellantDepot'],
    siteNote: {
      mare: 'Driver: the equator gives it ×1.5.',
      southpole: 'Propellant: it ignores the pole’s ×0.6.',
      lavatube: 'A split.',
    },
  },
  swarmPurpose: {
    id: 'swarmPurpose', era: 8, question: 'What is the swarm for?',
    members: ['powerBeaming', 'vonNeumann'],
    siteNote: {},
  },
};
export const DOCTRINE_ORDER = Object.keys(DOCTRINES) as DoctrineId[];

/** The deed that opens era `era` alongside CHARTER_DEED_TECHS visible done techs of era − 1. */
export interface EraGate {
  era: Era;
  deed: string;
  need: number;
  value: (s: GameState) => number;
  /** hard requirement on robotic runs, on either route */
  roboticRequires?: TechId;
}
export const ERA_GATES: Partial<Record<Era, EraGate>> = {
  2: { era: 2, deed: '450◆ smelted', need: 450, value: (s) => s.stats.produced.metals },
  3: { era: 3, deed: '200⚙ fabricated', need: 200, value: (s) => s.stats.produced.parts },
  4: { era: 4, deed: '600◇ refined', need: 600, value: (s) => s.stats.produced.silicon },
  5: { era: 5, deed: '50▣ chips fabbed', need: 50, value: (s) => s.stats.produced.chips },
  6: {
    era: 6, deed: 'a Data Center held a full night with every priority-0/1 load powered',
    need: 1, value: (s) => (s.stats.dcCleanNight ? 1 : 0),
  },
  7: {
    era: 7, deed: 'two outposts operated a full lunar day together',
    need: 720, value: (s) => s.stats.outpostPairOpS, roboticRequires: 'humanCohabitation',
  },
  8: { era: 8, deed: '25▰ manufactured', need: 25, value: (s) => s.stats.produced.foils },
};

/** Retired ids (techSchema 1) → data refunded when they were done (§8). */
export const RETIRED_TECHS: Record<string, number> = {
  hydroponicFarming: 40, autonomousOps: 260, roboticSelfAssembly: 300,
  inferenceOptimization: 640, autoFabrication: 1100, hiEffLaunch: 1200,
};
/** Debug/test aliases for retired ids (null = warned no-op). */
export const TECH_ALIASES: Record<string, TechId | null> = {
  autonomousOps: 'constructionRobotics', roboticSelfAssembly: 'selfReplication',
  inferenceOptimization: 'acceleratorDesign', autoFabrication: 'selfReplication',
  hydroponicFarming: null, hiEffLaunch: null,
};

// ─────────────────────────── generated trade-offs ───────────────────────────

export type EffectUnit = 'mult' | 'kW' | 'use' | 'rate' | 'upkeep' | 'crew' | 'morale' | 'count' | 'flag';
export interface EffectLine {
  sign: 'pro' | 'con';
  text: string;
  /** |mult − 1| for 'mult', kW for 'kW', the amount otherwise (1 for flags) */
  magnitude: number;
  unit: EffectUnit;
}
export interface DescribeCtx {
  siteId?: SiteId;
  expedition?: Expedition;
  /** current mods.agentTax, for agent-run draw notes (default AGENT_TAX) */
  agentTax?: number;
  /** techs done: a spent `bringsCrew` line is hidden once Human Cohabitation is */
  done?: readonly TechId[];
  /** the state's faction (none in a solo game): faction-filtered effects describe only there */
  faction?: FactionId;
}

const glyph = (r: string) => RESOURCES[r as ResourceId]?.glyph ?? '';
const num = (v: number) => String(Number(v.toFixed(3)));
const sgn = (v: number) => `${v < 0 ? '−' : ''}${num(Math.abs(v))}`;
const r4 = (v: number) => Number(v.toFixed(4));
const mag = (m: number) => Math.round(Math.abs(m - 1) * 1e4) / 1e4;
const bname = (b: BuildingId) => BUILDINGS[b].name;
const names = (bs: BuildingId[] | 'all') => (bs === 'all' ? 'all structures' : bs.map(bname).join(', '));
const pctUp = (m: number) => (m >= 2 ? `×${num(m)}` : `+${Math.round((m - 1) * 100)}%`);
const pctDown = (m: number) => `−${Math.round((1 - m) * 100)}%`;
const pctDelta = (m: number) => (m >= 1 ? pctUp(m) : pctDown(m));
const goodsText = (g: Partial<Record<ResourceId, number>>) =>
  Object.entries(g).map(([r, a]) => `${num(a ?? 0)}${glyph(r)}`).join(' ');
const pro = (text: string, magnitude: number, unit: EffectUnit): EffectLine => ({ sign: 'pro', text, magnitude, unit });
/** a building's build cost at the site (mare's ×0.8 when no site is given) */
const siteCost = (b: BuildingId, siteId?: SiteId) => {
  const m = SITES[siteId ?? 'mare'].buildCostMult;
  return Object.fromEntries(Object.entries(BUILDINGS[b].buildCost).map(([r, a]) => [r, Math.ceil((a ?? 0) * m)])) as Partial<Record<ResourceId, number>>;
};
const con = (text: string, magnitude: number, unit: EffectUnit): EffectLine => ({ sign: 'con', text, magnitude, unit });

const FEED_POSITIVE: Partial<Record<FeedKind, { coef: number; what: string }>> = {
  ilmenite: { coef: FEED.smelter.ilmenite, what: 'H₂ smelter yield' },
  anorthosite: { coef: FEED.refinery.anorthosite, what: 'refinery yield' },
  glass: { coef: FEED.smelterO2Glass, what: 'smelter O₂' },
};

/** Mechanical pros and cons of placing one building (for `unlock`). */
function buildingLines(b: BuildingId, ctx: DescribeCtx): EffectLine[] {
  const d = BUILDINGS[b];
  const out: EffectLine[] = [pro(`UNLOCK ${d.name}`, 1, 'flag')];
  const flows = (rec: Partial<Record<ResourceId, number>>) =>
    Object.entries(rec).map(([r, v]) => `${num(v ?? 0)}${glyph(r)}`).join(' + ');
  if (Object.keys(d.outputs).length) {
    const total = Object.values(d.outputs).reduce((a, v) => a + (v ?? 0), 0);
    out.push(pro(`makes ${flows(d.outputs)}/s`, r4(total), 'rate'));
  }
  if (d.powerKW > 0) out.push(pro(`+${num(d.powerKW)} kW`, d.powerKW, 'kW'));
  if (d.storageKWh) out.push(pro(`stores ${d.storageKWh.toLocaleString('en-US')} energy`, d.storageKWh, 'count'));
  if (d.housing) out.push(pro(`houses ${d.housing}`, d.housing, 'count'));
  if (d.bots) out.push(pro(`+${d.bots} construction rovers`, d.bots, 'count'));
  if (d.moraleDelta && d.moraleDelta > 0) out.push(pro(`+${d.moraleDelta} morale`, d.moraleDelta, 'morale'));
  if (d.buildRadiusM) out.push(pro(`extends the build network ${d.buildRadiusM} m`, d.buildRadiusM, 'count'));

  if (d.powerKW < 0) {
    const agentRun = ctx.expedition === 'robotic' && d.crew > 0;
    const tax = 1 + (ctx.agentTax ?? AGENT_TAX);
    out.push(con(`${sgn(d.powerKW)} kW${agentRun ? ` (×${num(tax)} agent-run)` : ''}`, -d.powerKW, 'kW'));
  }
  if (d.storageKWh) out.push(con(`${Math.round((1 - BATTERY_EFF) * 100)}% round-trip loss`, mag(BATTERY_EFF), 'mult'));
  if (Object.keys(d.inputs).length) {
    const total = Object.values(d.inputs).reduce((a, v) => a + (v ?? 0), 0);
    out.push(con(`eats ${flows(d.inputs)}/s`, r4(total), 'rate'));
  }
  if (d.upkeepParts > 0) out.push(con(`${num(d.upkeepParts)}⚙/day upkeep`, d.upkeepParts, 'upkeep'));
  if (d.crew > 0 && ctx.expedition !== 'robotic') out.push(con(`${d.crew} crew`, d.crew, 'crew'));
  if (d.moraleDelta && d.moraleDelta < 0) out.push(con(`${d.moraleDelta} morale`, -d.moraleDelta, 'morale'));
  if (Object.keys(d.buildCost).length) out.push(con(`${goodsText(d.buildCost)} to build`, 1, 'use'));
  return out;
}

function recipeLines(fx: { building: BuildingId } & RecipeOverride): EffectLine[] {
  const base = BUILDINGS[fx.building];
  const nm = base.name;
  const out: EffectLine[] = [];
  const diff = (from: Partial<Record<ResourceId, number>>, to: Partial<Record<ResourceId, number>>, isInput: boolean) => {
    const keys = new Set([...Object.keys(from), ...Object.keys(to)]) as Set<ResourceId>;
    for (const r of keys) {
      const a = from[r] ?? 0, b = to[r] ?? 0;
      if (Math.abs(a - b) < 1e-9) continue;
      const better = isInput ? b < a : b > a;
      const text = !isInput && b === 0
        ? `${nm}: no ${RESOURCES[r].name.toLowerCase()} (was ${num(a)}${glyph(r)}/s)`
        : `${nm}: ${b > a ? '+' : '−'}${num(Math.abs(b - a))}${glyph(r)}/s ${isInput ? 'input' : ''}`.trimEnd();
      out.push(better ? pro(text, r4(Math.abs(b - a)), 'rate') : con(text, r4(Math.abs(b - a)), 'rate'));
    }
  };
  if (fx.outputs) diff(base.outputs, fx.outputs, false);
  if (fx.inputs) diff(base.inputs, fx.inputs, true);
  if (fx.powerKW !== undefined && fx.powerKW !== base.powerKW) {
    const text = `${nm}: ${sgn(fx.powerKW)} kW (was ${sgn(base.powerKW)})`;
    const d = r4(Math.abs(fx.powerKW - base.powerKW));
    out.push(fx.powerKW > base.powerKW ? pro(text, d, 'kW') : con(text, d, 'kW'));
  }
  if (fx.feedInsensitive) out.push(pro(`${nm} melts any soil (feed-insensitive)`, 1, 'flag'));
  return out;
}

/** What a faction's landing does to the bank's charge efficiency (the Foundry's 75%); the grid's BATTERY_EFF otherwise
 *  (and in a solo game). Bank Trenches reads `from → 85%` off it. */
function factionChargeEff(faction?: FactionId): number {
  const fx = faction ? TECHS[LANDING_TECH_FOR[faction]]?.effects.find((e) => e.kind === 'nightMode' && e.chargeEff !== undefined) : undefined;
  return fx && fx.kind === 'nightMode' ? Math.min(BATTERY_EFF, fx.chargeEff!) : BATTERY_EFF;
}
/** The night output a faction's landing sets (the Foundry's ×0.25); ×1 otherwise. The Isotope Warmers card reads `was ×0.25`. */
function factionNightOutput(faction?: FactionId): number {
  const fx = TECHS[LANDING_TECH_FOR[faction ?? 'robots']]?.effects.find((e) => e.kind === 'nightMode' && e.output !== undefined);
  return fx && fx.kind === 'nightMode' ? fx.output! : 1;
}

/** The generated +/− lines of one effect, driven by a polarity table per kind. */
export function describeEffect(fx: TechEffect, ctx: DescribeCtx = {}): EffectLine[] {
  switch (fx.kind) {
    case 'unlock': return buildingLines(fx.building, ctx);
    case 'outputMult': {
      const text = `${pctDelta(fx.mult)} output: ${names(fx.buildings)}${fx.crewedOnly ? ' (crewed only)' : fx.agentOnly ? ' (agent-run only)' : ''}`;
      return [fx.mult >= 1 ? pro(text, mag(fx.mult), 'mult') : con(text, mag(fx.mult), 'mult')];
    }
    case 'inputMult': {
      const text = `${pctDelta(fx.mult)} inputs: ${names(fx.buildings)}`;
      return [fx.mult <= 1 ? pro(text, mag(fx.mult), 'mult') : con(text, mag(fx.mult), 'mult')];
    }
    case 'powerMult': {
      // < 1 on a consumer is a pro; on a generator it is a con
      const gens = fx.buildings.filter((b) => BUILDINGS[b].powerKW > 0);
      const cons = fx.buildings.filter((b) => BUILDINGS[b].powerKW <= 0);
      const out: EffectLine[] = [];
      if (gens.length) {
        const text = `${pctDelta(fx.mult)} power: ${names(gens)}`;
        out.push(fx.mult >= 1 ? pro(text, mag(fx.mult), 'mult') : con(text, mag(fx.mult), 'mult'));
      }
      if (cons.length) {
        const text = `${pctDelta(fx.mult)} draw: ${names(cons)}`;
        out.push(fx.mult <= 1 ? pro(text, mag(fx.mult), 'mult') : con(text, mag(fx.mult), 'mult'));
      }
      return out;
    }
    case 'upkeepMult': {
      const text = `${pctDelta(fx.mult)} upkeep: ${names(fx.buildings)}`;
      return [fx.mult <= 1 ? pro(text, mag(fx.mult), 'mult') : con(text, mag(fx.mult), 'mult')];
    }
    case 'crewDelta': {
      const text = `${fx.delta > 0 ? '+' : '−'}${Math.abs(fx.delta)} crew: ${names(fx.buildings)}`;
      return [fx.delta < 0 ? pro(text, -fx.delta, 'crew') : con(text, fx.delta, 'crew')];
    }
    case 'dustMult': {
      const text = `${pctDelta(fx.mult)} solar dust`;
      return [fx.mult <= 1 ? pro(text, mag(fx.mult), 'mult') : con(text, mag(fx.mult), 'mult')];
    }
    case 'buildSpeed': {
      const text = fx.mult <= 1
        ? `builds ${Math.round((1 - fx.mult) * 100)}% faster`
        : `builds ${Math.round((fx.mult - 1) * 100)}% slower`;
      return [fx.mult <= 1 ? pro(text, mag(fx.mult), 'mult') : con(text, mag(fx.mult), 'mult')];
    }
    case 'botPerBay': {
      const text = `${fx.delta > 0 ? '+' : '−'}${Math.abs(fx.delta)} construction rover per Robotics Bay`;
      return [fx.delta > 0 ? pro(text, fx.delta, 'count') : con(text, -fx.delta, 'count')];
    }
    case 'launchAction':
      return [
        pro('NEW ACTION launch — LAUNCH is armed', 1, 'flag'),
        con(`each volley costs ${LAUNCH_COST_FOILS}▰ + ${LAUNCH_CAP_PER_VOLLEY}↑ + ${LAUNCH_POWER_BURST} stored`, 1, 'use'),
      ];
    case 'powerBeam':
      return [
        pro(`+${BEAM_KW_PER_LAUNCH} kW per volley launched`, BEAM_KW_PER_LAUNCH, 'kW'),
        con('the beam halves in a C flare and drops to 0 in an M or X', 1, 'mult'),
      ];
    case 'automation':
      return [
        pro('NEW TOGGLE Crewed / Autonomous on every station', 1, 'flag'),
        con(`agent-run stations draw ×${num(1 + (ctx.agentTax ?? AGENT_TAX))}`, ctx.agentTax ?? AGENT_TAX, 'mult'),
      ];
    case 'grading':
      return [
        pro(`grading ×${GRADE_JOB.techMult}: rovers level a dragged box twice as fast, and can level tailings heaps (≤${MAX_SLOPE_LARGE} m relief for large pads)`, GRADE_JOB.techMult, 'mult'),
        con(`${GRADE_JOB.energyPerCell} stored energy per cell graded`, GRADE_JOB.energyPerCell, 'use'),
      ];
    case 'recipe': return recipeLines(fx);
    case 'agentTax': {
      const from = 1 + AGENT_TAX, to = 1 + AGENT_TAX * fx.mult;
      const text = `agent-run draw ×${num(from)} → ×${num(to)}`;
      return [fx.mult <= 1 ? pro(text, mag(fx.mult), 'mult') : con(text, mag(fx.mult), 'mult')];
    }
    case 'construction': {
      const out: EffectLine[] = [];
      if (fx.rateMult !== undefined) {
        const text = `${pctDelta(fx.rateMult)} build rate per rover`;
        out.push(fx.rateMult >= 1 ? pro(text, mag(fx.rateMult), 'mult') : con(text, mag(fx.rateMult), 'mult'));
      }
      if (fx.partsMult !== undefined) {
        const text = `${pctDelta(fx.partsMult)} weld parts`;
        out.push(fx.partsMult <= 1 ? pro(text, mag(fx.partsMult), 'mult') : con(text, mag(fx.partsMult), 'mult'));
      }
      if (fx.kwMult !== undefined) {
        const text = `construction draw ×${num(fx.kwMult)} (${num(CONSTRUCTION_KW * fx.kwMult)} kW per working rover)`;
        out.push(fx.kwMult <= 1 ? pro(text, mag(fx.kwMult), 'mult') : con(text, mag(fx.kwMult), 'mult'));
      }
      return out;
    }
    case 'storage': {
      const out: EffectLine[] = [];
      if (fx.capacityMult !== undefined) {
        const text = `battery capacity ×${num(fx.capacityMult)}`;
        out.push(fx.capacityMult >= 1 ? pro(text, mag(fx.capacityMult), 'mult') : con(text, mag(fx.capacityMult), 'mult'));
      }
      if (fx.efficiency !== undefined) {
        // a faction whose landing taxes the bank (the Foundry's 75%) starts from its own figure
        const from = factionChargeEff(ctx.faction);
        // read without a faction (a generic card), a restore to the grid's own figure reads as one, not as `85% → 85%`
        const text = fx.efficiency === from
          ? `grid round-trip restored to ${Math.round(fx.efficiency * 100)}%`
          : `grid round-trip ${Math.round(from * 100)}% → ${Math.round(fx.efficiency * 100)}%`;
        const m = fx.efficiency === from ? mag(fx.efficiency / factionChargeEff('robots')) : mag(fx.efficiency / from);
        out.push(fx.efficiency >= from ? pro(text, m, 'mult') : con(text, m, 'mult'));
      }
      return out;
    }
    case 'repair': {
      const text = `wear heals ×${num(fx.mult)}`;
      return [fx.mult >= 1 ? pro(text, mag(fx.mult), 'mult') : con(text, mag(fx.mult), 'mult')];
    }
    case 'shadeImmune': return [pro('solar arrays ignore terrain shade', 1, 'flag')];
    case 'buildTime': {
      const text = `build time ×${num(fx.mult)}: ${names(fx.buildings)}`;
      return [fx.mult <= 1 ? pro(text, mag(fx.mult), 'mult') : con(text, mag(fx.mult), 'mult')];
    }
    case 'action':
      if (fx.id === 'electrolysis') return [
        pro('NEW TOGGLE Electrolysis: a Water Plant splits 40% of its produced water into oxygen (0.89 oxygen per water)', 1, 'flag'),
        con('10 kW more per Water Plant while Electrolysis is on; 40% less water; hydrogen is vented until propellant production', 10, 'kW'),
      ];
      if (fx.id === 'sentinel') {
        const F = FORECAST.sentinel;
        return [
          pro(`NEW ACTION Launch sentinel (the Lander): on station at L1 a lunar day later`, 1, 'flag'),
          con(`${goodsText(F.cost)} and ${goodsText(F.propellant)} of hopper propellant to launch (a Mass Driver throws it for ${F.driverEnergy} stored)`, 1, 'use'),
        ];
      }
      return fx.id === 'overclock'
        ? [
          pro(`NEW ACTION overclock: output ×${OVERCLOCK.mult} per building`, OVERCLOCK.mult - 1, 'mult'),
          con(`overclocked: kW and inputs ×${OVERCLOCK.mult}, wear +${OVERCLOCK.wearPerDay}/day, trips at WORN`,
            OVERCLOCK.mult - 1, 'mult'),
        ]
        : [
          pro(`NEW ACTION downlink: ${DOWNLINK.baseData}≡ → ${goodsText(DOWNLINK.cargo)}`, 1, 'flag'),
          con(`each downlink spends ${DOWNLINK.baseData} + ${DOWNLINK.stepData}·n banked data`, DOWNLINK.baseData, 'use'),
        ];
    case 'survey': {
      const out: EffectLine[] = [];
      if (fx.tier) {
        const t = SURVEY_TIERS[fx.tier];
        const detail = fx.tier === 1 ? 'local reveal 320 m, Moon map ≤27°, drone surveys, first outpost slot'
          : fx.tier === 2 ? 'whole local map, near side'
          : fx.tier === 3 ? 'far side, +1 outpost slot'
          : 'subsurface prospects, +1 outpost slot, enables ATLAS';
        out.push(pro(`MAP T${fx.tier} ${t.label}: ${detail}`, fx.tier, 'count'));
        if (fx.tier === 1) out.push(con('every survey spends stored energy, hopper propellant and parts, and holds a drone for its flight', 1, 'use'));
      }
      if (fx.bayLevel !== undefined) {
        out.push(pro(`PROSPECTING BAY LEVEL ${fx.bayLevel === 2 ? 'II' : 'III'}: ${SURVEY_DRONE.baysByLevel[fx.bayLevel - 1]} drone bays a Bay`, fx.bayLevel, 'count'));
      }
      if (fx.range !== undefined) {
        out.push(pro(`drone range ×${num(fx.range)}: survey flights take ${Math.round((1 - 1 / fx.range) * 100)}% less time`, mag(fx.range), 'mult'));
      }
      if (fx.dataMult !== undefined) {
        out.push(pro(`survey data ×${num(fx.dataMult)}${fx.minCrew ? ` while ≥${fx.minCrew} crew are aboard` : ''}`,
          mag(fx.dataMult), 'mult'));
      }
      if (fx.precision !== undefined) {
        out.push(pro(`deposit surveys read ±${Math.round(fx.precision * 100)}%: ore and grade (surveyed deposits are re-read free)`, 1 - fx.precision, 'mult'));
      }
      if (fx.depositTimeMult !== undefined) {
        out.push(pro(`deposit surveys core in ${num(40 * fx.depositTimeMult)} rover-s`, mag(fx.depositTimeMult), 'mult'));
      }
      if (fx.mastSurvey?.length) {
        out.push(pro(`Relay Masts survey ${fx.mastSurvey.map((k) => DEPOSIT_INFO[k].name).join(' and ')} deposits in their radius, free`, 1, 'flag'));
      }
      return out;
    }
    case 'grade': {
      const text = `${pctDelta(fx.mult)} ore grade${fx.process === 'H2' ? ': the hydrogen-reduction smelter, on any ground' : ': every pit'}`;
      return [fx.mult >= 1 ? pro(text, mag(fx.mult), 'mult') : con(text, mag(fx.mult), 'mult')];
    }
    case 'pitDepth':
      return [pro(`pits cut ${fx.benches} bench${fx.benches === 1 ? '' : 'es'} (${fx.benches * 2} m) into bedrock: slow ore under dug-out and hemmed-in pits`, fx.benches, 'count'),
        con('bedrock digs at ×0.3 and draws +25% while cutting', 0.7, 'mult')];
    case 'hubLevel': return [
      pro(`LEVEL ${fx.level === 2 ? 'II' : 'III'} HUBS: + Bay at any hub (${fx.level + 1} bays)`, 1, 'flag'),
      con('buy each bay at its hub: 30 metals and 10 parts before site modifiers', 1, 'use'),
    ];
    case 'hubBays': return [pro(`+${fx.delta} free bay${fx.delta === 1 ? '' : 's'} at every hub`, fx.delta, 'count')];
    case 'hubPrint': {
      const out: EffectLine[] = [];
      for (const [m, label] of [[fx.timeMult, 'unit print time'], [fx.costMult, 'unit print cost']] as const) {
        if (m === undefined) continue;
        const text = `${label} ×${num(m)}`;
        out.push(m <= 1 ? pro(text, mag(m), 'mult') : con(text, mag(m), 'mult'));
      }
      return out;
    }
    case 'reclaim': return [pro(`${pctDelta(fx.water)} fresh water: crew and farms, while a Water Management Plant operates`, mag(fx.water), 'mult')];
    case 'powerDelta': {
      const text = `${fx.kw > 0 ? '+' : ''}${sgn(fx.kw)} kW: ${bname(fx.building)}`;
      return [fx.kw > 0 ? pro(text, fx.kw, 'kW') : con(text, -fx.kw, 'kW')];
    }
    case 'nightDraw': {
      const out: EffectLine[] = [];
      if (fx.night !== 1) {
        const text = `${pctDelta(fx.night)} draw at night`;
        out.push(fx.night < 1 ? pro(text, mag(fx.night), 'mult') : con(text, mag(fx.night), 'mult'));
      }
      if (fx.day !== 1) {
        const text = `${pctDelta(fx.day)} draw by day`;
        out.push(fx.day < 1 ? pro(text, mag(fx.day), 'mult') : con(text, mag(fx.day), 'mult'));
      }
      return out;
    }
    case 'haul': {
      const out: EffectLine[] = [];
      if (fx.speedMult !== undefined) {
        const text = `${pctDelta(fx.speedMult)} excavator haul speed`;
        out.push(fx.speedMult >= 1 ? pro(text, mag(fx.speedMult), 'mult') : con(text, mag(fx.speedMult), 'mult'));
      }
      if (fx.bucketMult !== undefined) {
        const text = `${pctDelta(fx.bucketMult)} excavator bucket (${num(HAUL.bucket * fx.bucketMult)}▲ a load)`;
        out.push(fx.bucketMult >= 1 ? pro(text, mag(fx.bucketMult), 'mult') : con(text, mag(fx.bucketMult), 'mult'));
      }
      if (fx.offroadMult !== undefined) {
        const text = `${pctDelta(fx.offroadMult)} speed off-road, in pits and deposits: Regolith Excavator, Ice Miner`;
        out.push(fx.offroadMult >= 1 ? pro(text, mag(fx.offroadMult), 'mult') : con(text, mag(fx.offroadMult), 'mult'));
      }
      if (fx.digMult !== undefined) {
        const text = `${pctDelta(fx.digMult)} dig rate: Regolith Excavator and Ice Miner; the same bucket fills sooner`;
        out.push(fx.digMult >= 1 ? pro(text, mag(fx.digMult), 'mult') : con(text, mag(fx.digMult), 'mult'));
      }
      return out;
    }
    case 'road': {
      const out: EffectLine[] = [];
      const line = (m: number | undefined, what: string, better: (m: number) => boolean) => {
        if (m === undefined) return;
        const text = `${pctDelta(m)} ${what}`;
        out.push(better(m) ? pro(text, mag(m), 'mult') : con(text, mag(m), 'mult'));
      };
      line(fx.speedMult, 'road travel (rovers and excavators)', (m) => m >= 1);
      line(fx.haulMult, 'excavator speed on roads', (m) => m >= 1);
      line(fx.nightMult, 'road travel at night', (m) => m >= 1);
      if (fx.dustMult !== undefined) {
        out.push(fx.dustMult <= 0 ? pro('no road dust', 1, 'mult') : fx.dustMult < 1
          ? pro(`${pctDelta(fx.dustMult)} road dust`, mag(fx.dustMult), 'mult')
          : con(`${pctDelta(fx.dustMult)} road dust`, mag(fx.dustMult), 'mult'));
      }
      line(fx.cellMult, 'road sintering time a cell', (m) => m <= 1);
      return out;
    }
    case 'unitPower': {
      // on-board power (core/unitPower.ts): what one charge carries, the RPU's trickle, and their costs
      const out: EffectLine[] = [];
      if (fx.packMult !== undefined) {
        const text = `unit packs ×${num(fx.packMult)}: rovers, drones and excavators work ×${num(fx.packMult)} as long off the grid`;
        out.push(fx.packMult >= 1 ? pro(text, mag(fx.packMult), 'mult') : con(text, mag(fx.packMult), 'mult'));
      }
      if (fx.rpu) {
        const k = UNIT_POWER.rpuKW;
        out.push(pro(`a Radioisotope Power Unit aboard every unit (${num(k.rover)} kW a rover or drone, ${num(k.digger)} kW an excavator): ` +
          `with the grid at 0 it works at that share of its draw`, k.rover, 'kW'));
      }
      if (fx.driveMult !== undefined) {
        const text = `${pctDelta(fx.driveMult)} unit driving draw (${num(UNIT_POWER.driveKW.rover * fx.driveMult)} kW a rover)`;
        out.push(fx.driveMult <= 1 ? pro(text, mag(fx.driveMult), 'mult') : con(text, mag(fx.driveMult), 'mult'));
      }
      if (fx.chargeEff !== undefined) {
        const text = `charging draws ×${num(Math.round((1 / fx.chargeEff) * 100) / 100)} (the packs return ${Math.round(fx.chargeEff * 100)}%)`;
        out.push(fx.chargeEff >= 1 ? pro(text, mag(fx.chargeEff), 'mult') : con(text, mag(1 / fx.chargeEff), 'mult'));
      }
      return out;
    }
    case 'housing': {
      const text = `${fx.delta > 0 ? '+' : '−'}${Math.abs(fx.delta)} housing: ${bname(fx.building)}`;
      return [fx.delta > 0 ? pro(text, fx.delta, 'count') : con(text, -fx.delta, 'count')];
    }
    case 'morale': {
      const text = `${fx.delta > 0 ? '+' : '−'}${Math.abs(fx.delta)} morale: ${bname(fx.building)}`;
      return [fx.delta > 0 ? pro(text, fx.delta, 'morale') : con(text, -fx.delta, 'morale')];
    }
    case 'orders':
      return [
        pro(`NEW ORDER BOOK: ${fx.book} held orders, up to ×${fx.maxCount} each — orders wait for stock instead of skipping`, 1, 'flag'),
        con('held orders take stock the moment it lands', 1, 'use'),
      ];
    case 'autoRule': {
      if (fx.family === 'survey') {
        return [
          pro(`NEW RULE ${FAMILY_LABEL.survey}: ${RULE_TEXT.autoSurvey} (T ${Math.round(RULES.autoSurvey.threshold * 100)}% of the bank)`, 1, 'flag'),
          con('an idle drone flies unasked: each sortie spends the survey’s stored energy, propellant and parts', 1, 'use'),
        ];
      }
      const rules = rulesOf(fx.family).filter((r) => !(r === 'iceHarvester' && ctx.siteId && !SITES[ctx.siteId].hasIce));
      const main = RULES[rules[0]].building;
      const out = rules.map((r) => pro(`NEW RULE ${FAMILY_LABEL[fx.family]}: ${RULE_TEXT[r]}${/\(cap /.test(RULE_TEXT[r]) || RULES[r].capRange[1] <= 1 ? '' : ` (cap ${RULES[r].cap})`}`, 1, 'flag'));
      const cost = main === 'producer' ? 'the maker’s build cost' : `${goodsText(siteCost(main, ctx.siteId))} per ${bname(main)}`;
      out.push(con(`the builder spends your stock unasked: ${cost}`, 1, 'use'));
      return out;
    }
    case 'siting':
      return [pro('auto sites weigh deposits, peaks of light and haul lanes (before: distance only)', 1, 'flag')];
    case 'governor':
      return [
        pro('RESERVES and PRIORITIES: floors the builder never spends below; queued research goods kept; rules act in your order; crisis sites jump the rover queue', 1, 'flag'),
        con('rules wait for your floors — the builder acts later', 1, 'flag'),
      ];
    case 'predictive':
      return [
        pro('rules act on forecasts while a Data Center runs: batteries before dusk, sites still welding counted, dwell ×0.5', 1, 'flag'),
        con('reactive again whenever no Data Center runs', 1, 'flag'),
      ];
    case 'feedPlanner':
      return [
        pro('excavators re-aimed at the feed the furnaces want, as far as the haul pays (opt one out in its panel)', 1, 'flag'),
        con('longer hauls carry less', 1, 'flag'),
      ];
    case 'maintenance':
      return [
        pro(`parts triage: short of parts, priority 0 is paid first · machines worn ≥${Math.round(fx.wear * 100)}% for a lunar day replaced · tripped overclocks re-armed once healed`, 1, 'flag'),
        con('a replacement costs a new build, less half the old one’s price', 1, 'use'),
      ];
    case 'builder': {
      const out: EffectLine[] = [];
      if (fx.dwellMult !== undefined) out.push(pro(`Builder: rule dwell ×${num(fx.dwellMult)}`, mag(fx.dwellMult), 'mult'));
      if (fx.capMult !== undefined) out.push(pro(`Builder: rule caps ×${num(fx.capMult)}`, mag(fx.capMult), 'mult'));
      for (const f of fx.families ?? []) {
        for (const r of rulesOf(f)) out.push(pro(`NEW RULE ${FAMILY_LABEL[f]}: ${RULE_TEXT[r]} (cap ${RULES[r].cap})`, 1, 'flag'));
      }
      if (fx.all) out.push(pro('Builder: every rule may build the destiny buildings too (rings, domes, hives, monoliths)', 1, 'flag'));
      return out;
    }
    // ── destiny (docs/14 §2.7) ──
    case 'growth': {
      if (fx.mult <= 0) return [con('no new settlers are invited', 1, 'use')];
      const text = `settlers arrive ×${num(Math.round((1 / fx.mult) * 100) / 100)} as often`;
      return [fx.mult < 1 ? pro(text, mag(1 / fx.mult), 'mult') : con(text, mag(1 / fx.mult), 'mult')];
    }
    case 'bringsCrew':
      if (ctx.done?.includes('humanCohabitation')) return [];
      return [
        pro(`brings Human Cohabitation forward: habitats and farms unlock; ${CREW_ROTATION.count} settlers board in ` +
          `${Math.floor(CREW_ROTATION.delayS / 60)}:${String(CREW_ROTATION.delayS % 60).padStart(2, '0')} if the base can keep them`, 1, 'flag'),
        con('the crew needs O₂, food, water and beds from now on', 1, 'use'),
      ];
    case 'waive': {
      const gate = Object.values(ERA_GATES).find((g) => g?.roboticRequires === fx.tech);
      return [pro(`Era ${gate?.era ?? '?'} opens without ${TECHS[fx.tech].name}`, 1, 'flag')];
    }
    case 'eva':
      return [pro(`EVA crews by day (${Math.round(fx.share * 100)}% of free hands): dust clears ×${num(EVA.dustRecoverMult)}, ` +
        `repairs ×${num(EVA.repairMult)}`, mag(EVA.dustRecoverMult), 'mult')];
    case 'radius': {
      const base = BUILDINGS[fx.building].buildRadiusM ?? 0;
      return [pro(`${bname(fx.building)}s reach ${num(base + fx.deltaM)} m (from ${num(base)})`, fx.deltaM, 'count')];
    }
    case 'volley': {
      const out: EffectLine[] = [];
      const l = RESOURCES.launch.glyph;
      if (fx.launchCap !== undefined && fx.launchCap < LAUNCH_CAP_PER_VOLLEY) {
        out.push(pro(`a volley needs ${fx.launchCap}${l} instead of ${LAUNCH_CAP_PER_VOLLEY}`, LAUNCH_CAP_PER_VOLLEY - fx.launchCap, 'count'));
      }
      if (fx.morale) out.push(pro(`each volley: +${fx.morale} morale for a lunar day`, fx.morale, 'morale'));
      if (fx.minCrew) {
        out.push(con(`a volley needs ${fx.minCrew} crew on console (without them: ${LAUNCH_CAP_PER_VOLLEY}${l} and no ceremony)`, 1, 'use'));
      }
      return out;
    }
    case 'autoLaunch': {
      const out: EffectLine[] = [pro('volleys fire themselves when ready (never below the night’s reserve)', 1, 'flag')];
      if (fx.burstMult !== undefined && fx.burstMult !== 1) {
        const text = `launch burst ${pctDelta(fx.burstMult)} (${num(LAUNCH_POWER_BURST * fx.burstMult)} stored)`;
        out.push(fx.burstMult < 1 ? pro(text, mag(fx.burstMult), 'mult') : con(text, mag(fx.burstMult), 'mult'));
      }
      return out;
    }
    case 'moraleBase': {
      const text = `${fx.delta > 0 ? '+' : '−'}${Math.abs(fx.delta)} morale everywhere`;
      return [fx.delta > 0 ? pro(text, fx.delta, 'morale') : con(text, -fx.delta, 'morale')];
    }
    // hazard hooks: no card promises what the game does not do yet (data/hazards.ts)
    case 'hazardRate':
      if (!HAZARDS_LIVE) return [];
      return [fx.mult < 1 ? pro(`hazard windows ×${num(fx.mult)} as often`, mag(fx.mult), 'mult')
        : con(`hazard windows ×${num(fx.mult)} as often`, mag(fx.mult), 'mult')];
    case 'guard':
      return HAZARDS_LIVE ? [pro(GUARD_TEXT[fx.guard], 1, 'flag')] : [];
    case 'stowShield': return [pro(`FIELD BERMS: stowed arrays σ ${fx.sigma}`, fx.sigma, 'flag')];
    case 'forecast': {
      const lead = FORECAST.leadS[fx.tier];
      const text = fx.tier === 1 ? `FORECAST T1: the next flare's window and class range while a Solar Observatory sees the Sun · telegraphs +${lead} s`
        : fx.tier === 2 ? `FORECAST T2: the next flare's class for sure and a tight window, day and night, once the sentinel is on station · telegraphs +${lead} s`
        : `FORECAST T3: the solar cycle's curve and the next ${FORECAST.aheadN} flares on the timeline`;
      return [pro(text, fx.tier, 'count')];
    }
    case 'exposure': {
      if (!HAZARDS_LIVE) return [];
      const t = EXPOSURE_TEXT[fx.hazard];
      const who = fx.buildings?.length ? `${names(fx.buildings)} ` : '';
      return [con(`${HAZARD_NAME[fx.hazard]}: ${who}${t.what} — ${t.cost}`, 1, 'use')];
    }
    // ── factions (docs/20 §3) ──
    case 'laneCost': {
      const lane = LANES.find((l) => l.id === fx.lane)?.label ?? fx.lane;
      const text = `${lane} research ×${num(fx.mult)} cost`;
      return [fx.mult <= 1 ? pro(text, mag(fx.mult), 'mult') : con(text, mag(fx.mult), 'mult')];
    }
    case 'pickCost': {
      const text = `${SIDE_GLYPH[fx.side]} ${SIDE_LABEL[fx.side]} picks ×${num(fx.mult)} cost`;
      return [fx.mult <= 1 ? pro(text, mag(fx.mult), 'mult') : con(text, mag(fx.mult), 'mult')];
    }
    case 'flareVuln': {
      const out: EffectLine[] = [];
      const line = (text: string, m: number) => out.push(m <= 1 ? pro(text, mag(m), 'mult') : con(text, mag(m), 'mult'));
      if (fx.arrayHard !== undefined && fx.arrayHard !== 1) line(`solar arrays take ×${num(fx.arrayHard)} flare damage`, fx.arrayHard);
      if (fx.machine !== undefined && fx.machine !== 1) line(`machine reboot, latch and burn ×${num(fx.machine)}`, fx.machine);
      return out;
    }
    case 'nightMode': {
      const out: EffectLine[] = [];
      const line = (text: string, m: number, good: boolean) =>
        out.push(good ? pro(text, mag(m), 'mult') : con(text, mag(m), 'mult'));
      if (fx.output !== undefined && fx.output !== 1) {
        // a relief (Isotope Warmers) eases the landing's own penalty: its card reads from → to
        const from = factionNightOutput(ctx.faction);
        if (fx.relief) line(`stations and units run at ×${num(fx.output)} output at night (was ×${num(from)})`, fx.output / from, fx.output >= from);
        else line(`stations and units run at ×${num(fx.output)} output at night`, fx.output, fx.output >= 1);
      }
      if (fx.standby !== undefined && fx.standby !== 1) line(`standby draw ×${num(fx.standby)} at night`, fx.standby, fx.standby <= 1);
      if (fx.chargeEff !== undefined) line(`the bank charges at ${Math.round(fx.chargeEff * 100)}%`, fx.chargeEff / BATTERY_EFF, fx.chargeEff >= BATTERY_EFF);
      if (fx.discharge !== undefined && fx.discharge !== 1) line(`the bank discharges ×${num(fx.discharge)} as fast`, fx.discharge, fx.discharge <= 1);
      return out;
    }
    case 'moraleDynamics': {
      const text = `morale falls ×${num(fx.fallMult)} as fast`;
      return [fx.fallMult <= 1 ? pro(text, mag(fx.fallMult), 'mult') : con(text, mag(fx.fallMult), 'mult')];
    }
    case 'scrutiny': {
      const out: EffectLine[] = [];
      if (fx.on) out.push(con('SCRUTINY: a death, wreck or accident raises a meter; high, it cuts crewed output and research, and hearings recall crew', 1, 'use'));
      if (fx.decay !== undefined) {
        const text = `scrutiny fades ×${num(fx.decay)} as fast`;
        out.push(fx.decay >= 1 ? pro(text, mag(fx.decay), 'mult') : con(text, mag(fx.decay), 'mult'));
      }
      if (fx.recall !== undefined) {
        const text = `a hearing recalls ×${num(fx.recall)} as many crew`;
        out.push(fx.recall <= 1 ? pro(text, mag(fx.recall), 'mult') : con(text, mag(fx.recall), 'mult'));
      }
      if (fx.firstLight?.clear) out.push(pro('FIRST LIGHT clears the scrutiny meter', 1, 'flag'));
      if (fx.firstLight?.morale) out.push(pro(`FIRST LIGHT: +${fx.firstLight.morale} morale for a lunar day`, fx.firstLight.morale, 'morale'));
      return out;
    }
    case 'volleyFoils': {
      const text = `a volley flies with ${Math.round(LAUNCH_COST_FOILS * fx.mult * 100) / 100}▰ instead of ${LAUNCH_COST_FOILS}▰`;
      return [fx.mult <= 1 ? pro(text, mag(fx.mult), 'mult') : con(text, mag(fx.mult), 'mult')];
    }
    case 'rivalAid':
      return [pro(`another program’s disaster grants +${num(fx.data)}≡ data`, fx.data, 'count')];
    case 'nightOutput': {
      const text = `${pctDelta(fx.mult)} output at night: ${names(fx.buildings)}`;
      return [fx.mult >= 1 ? pro(text, mag(fx.mult), 'mult') : con(text, mag(fx.mult), 'mult')];
    }
    case 'grant':
      return fx.data ? [pro(`+${num(fx.data)}≡ data on landing`, fx.data, 'count')] : [];
    case 'feedBonus': {
      const p = FEED_POSITIVE[fx.deposit];
      const text = p
        ? `${fx.deposit} feed ×${num(fx.mult)}: ${p.what} +${Math.round(p.coef * fx.mult * 100)}% per unit share`
        : `${fx.deposit} feed ×${num(fx.mult)}`;
      return [fx.mult >= 1 ? pro(text, mag(fx.mult), 'mult') : con(text, mag(fx.mult), 'mult')];
    }
  }
}

/** Does the effect apply here? `techsDone` (computeMods passes it) applies
 *  the crew filter: on a robotic run, crew effects wait for Human Cohabitation.
 *  `faction` (the state's; undefined in a solo game) applies the faction filter. */
export function effectApplies(
  fx: TechEffect, siteId?: SiteId | null, exp?: Expedition, techsDone?: readonly string[], faction?: FactionId | null,
): boolean {
  // a faction-filtered effect applies only on that faction's base: a solo game (no faction) skips it
  if (fx.factions && !(faction && fx.factions.includes(faction))) return false;
  if (fx.sites && siteId && !fx.sites.includes(siteId)) return false;
  if (fx.expeditions && exp && !fx.expeditions.includes(exp)) return false;
  if (fx.crew && exp === 'robotic' && techsDone && !techsDone.includes('humanCohabitation')) return false;
  return true;
}

/** Every generated line of a tech, pros first, after effect-level site/expedition filtering.
 *  A crew effect's lines say `(with crew)` wherever people may not be aboard. */
export function describeTech(def: TechDef, ctx: DescribeCtx = {}): EffectLine[] {
  const lines = def.effects
    .filter((fx) => effectApplies(fx, ctx.siteId, ctx.expedition, undefined, ctx.faction))
    .flatMap((fx) => {
      const out = describeEffect(fx, ctx);
      return fx.crew && ctx.expedition !== 'human' ? out.map((l) => ({ ...l, text: `${l.text} (with crew)` })) : out;
    });
  return [...lines.filter((l) => l.sign === 'pro'), ...lines.filter((l) => l.sign === 'con')];
}

/** Can this building ever be placed at the site (on that expedition)? */
export function buildingPlaceableAt(b: BuildingId, siteId: SiteId): boolean {
  const d = BUILDINGS[b];
  return !(d.requiresIce && !SITES[siteId].hasIce);
}

/** Data invariant (test 3): at least one pro effect, after filtering, touches
 *  something that exists or matters at this site on this expedition. */
export function techRelevance(def: TechDef, siteId: SiteId, exp: Expedition): boolean {
  // the landing is the expedition itself: its card copy is hand-written (ui/expeditionCopy.ts)
  if (def.track?.landing) return true;
  const site = SITES[siteId];
  const anyPlaceable = (bs: BuildingId[] | 'all') =>
    bs === 'all' || bs.some((b) => buildingPlaceableAt(b, siteId));
  for (const fx of def.effects) {
    if (!effectApplies(fx, siteId, exp)) continue;
    if (!describeEffect(fx, { siteId, expedition: exp }).some((l) => l.sign === 'pro')) continue;
    switch (fx.kind) {
      case 'unlock': case 'recipe': case 'powerDelta': case 'housing': case 'morale': case 'radius':
        if (buildingPlaceableAt(fx.building, siteId)) return true;
        break;
      case 'exposure': break; // a con, never a reason to take the tech
      case 'outputMult': case 'inputMult': case 'powerMult': case 'upkeepMult': case 'crewDelta': case 'buildTime':
        if (anyPlaceable(fx.buildings)) return true;
        break;
      case 'grading': return true; // every site: grading is the rovers' job everywhere (docs/19 S5)
      case 'shadeImmune': if (site.terrain.roughness >= 1.0) return true; break;
      case 'nightDraw': if (site.nightSolarFraction < 0.5) return true; break;
      case 'feedBonus': if (fx.deposit !== 'plain' && siteHasDeposit(siteId, fx.deposit)) return true; break;
      case 'autoRule':
        // a family matters where one of the buildings it adds can stand
        if (rulesOf(fx.family).some((r) => RULES[r].building === 'producer' || buildingPlaceableAt(RULES[r].building as BuildingId, siteId))) return true;
        break;
      default: return true; // dust, survey, action, storage and the global construction/launch mods
    }
  }
  return false;
}

/** debug.auditTechs(): generated pro/con counts and the weakest con per tech.
 *  The landing picks are exempt: their lines are the expedition card's own. */
export function auditTechs(ctx: DescribeCtx = {}): { id: TechId; pros: number; cons: number; minConMagnitude: number; lines: EffectLine[] }[] {
  return TECH_ORDER.filter((id) => !TECHS[id].track?.landing).map((id) => {
    // a faction tech is read on its own faction's base (the card a player of that faction sees)
    const lines = describeTech(TECHS[id], TECHS[id].factions && !ctx.faction ? { ...ctx, faction: TECHS[id].factions![0] } : ctx);
    const cons = lines.filter((l) => l.sign === 'con');
    return {
      id,
      pros: lines.length - cons.length,
      cons: cons.length,
      minConMagnitude: cons.length ? Math.min(...cons.map((l) => l.magnitude)) : 0,
      lines,
    };
  });
}

/** debug.techRelevanceMatrix(): relevance of every tech at every site × expedition. */
export function techRelevanceMatrix(): Record<TechId, Record<string, boolean>> {
  const out = {} as Record<TechId, Record<string, boolean>>;
  for (const id of TECH_ORDER) {
    out[id] = {};
    for (const site of SITE_ORDER) {
      for (const exp of ['robotic', 'human'] as Expedition[]) out[id][`${site}:${exp}`] = techRelevance(TECHS[id], site, exp);
    }
  }
  return out;
}
