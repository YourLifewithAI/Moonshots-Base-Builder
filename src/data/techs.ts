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
import { siteHasDeposit, type FeedKind } from './deposits';
import { AUTO, FAMILY_LABEL, RULES, RULE_TEXT, rulesOf, type AutoFamily } from './automation';
import type { ProspectId } from './lunarMap';
import type { GameState } from '../core/state';
import {
  AGENT_TAX, BATTERY_EFF, BEAM_KW_PER_LAUNCH, CONSTRUCTION_KW, DOWNLINK, FEED,
  GRADE_COST_ENERGY, HAUL, LAUNCH_CAP_PER_VOLLEY, LAUNCH_COST_FOILS, LAUNCH_POWER_BURST,
  MAX_SLOPE_LARGE, OVERCLOCK, SURVEY_TIERS,
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
  | 'buildOrders'
  // era 3 — robotic fabrication
  | 'thoriumPower' | 'regenFuelCells' | 'swarmRobotics' | 'heavyConstructors' | 'dustMitigation' | 'btLavaTubeCaverns'
  | 'stackedCells' | 'slagRecycling' | 'refluxColumns' | 'cryoSampleStore' | 'bunkRacks'
  | 'autoExcavation' | 'siteSurveyAI'
  | 'basaltPaving'
  // era 4 — chip fabrication
  | 'waferFab' | 'acceleratorDesign' | 'radHardProcess' | 'cleanroomRobotics' | 'orbitalProspector' | 'btVolcanicGlass'
  | 'braytonConverters' | 'pressureTanks' | 'mliBlankets' | 'waferPolishing' | 'oreSorting' | 'heatedAugers' | 'growLights'
  | 'roverAutonomy'
  | 'autoPower' | 'budgetGovernor' | 'autoLifeSupport'
  // era 5 — lunar compute
  | 'lunarDataCenter' | 'dynamicClocking' | 'cryoRadiators' | 'crewWellness'
  | 'wingExtensions' | 'deployableRadiators' | 'oxygenLiquefaction' | 'immersionLitho' | 'toolChangers'
  | 'nutrientRecirculation' | 'gravimetry' | 'autonomousHaulage'
  | 'autoSmelting' | 'feedPlanner'
  | 'guidanceBeacons'
  // era 6 — human habitation
  | 'humanCohabitation' | 'closedLoopLS' | 'safetyProtocols' | 'conditionOptimization' | 'scienceCrews'
  | 'farSideRelay' | 'btColdTrapChemistry'
  | 'solidStateCells' | 'highBurnupFuel' | 'refractoryLinings' | 'predictiveMaintenance' | 'uplinkDishes' | 'galleyGarden'
  | 'launchSiteSurvey'
  | 'autoFabrication' | 'predictiveScheduling'
  | 'guidewayRails'
  // era 7 — swarm industry
  | 'foilManufacturing' | 'massDriver' | 'propellantDepot' | 'selfReplication' | 'deepSounding'
  | 'superconductingBus' | 'rollToRoll' | 'foilAnnealing' | 'liquidCooling' | 'rackDensification' | 'lowGCourt'
  | 'laserRanging'
  | 'selfExpandingBase' | 'maintenanceAutomation'
  | 'maglevFreight'
  // era 8 — dyson swarm (lane-free capstone column)
  | 'swarmProtocol' | 'powerBeaming' | 'vonNeumann' | 'railCapacitors' | 'cryocoolerHeads' | 'canisterPress';

/** Any effect may be limited to some sites / expeditions; computeMods skips it elsewhere. */
export interface EffectFilter { sites?: SiteId[]; expeditions?: Expedition[] }

export interface RecipeOverride {
  inputs?: Partial<Record<ResourceId, number>>;
  outputs?: Partial<Record<ResourceId, number>>;
  powerKW?: number;
  /** output ignores the feed grade (MRE melts any soil) */
  feedInsensitive?: boolean;
}

export type TechEffect = EffectFilter & (
  | { kind: 'unlock'; building: BuildingId }
  | { kind: 'outputMult'; buildings: BuildingId[]; mult: number; crewedOnly?: true }
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
  | { kind: 'action'; id: 'overclock' | 'downlink' }
  | { kind: 'survey'; tier?: 1 | 2 | 3 | 4; dataMult?: number; minCrew?: number }
  | { kind: 'powerDelta'; building: BuildingId; kw: number }
  | { kind: 'nightDraw'; night: number; day: number }
  | { kind: 'feedBonus'; deposit: FeedKind; mult: number }
  | { kind: 'housing'; building: BuildingId; delta: number }   // beds per building of that type
  | { kind: 'morale'; building: BuildingId; delta: number }    // morale while that building runs
  /** excavator haul cycle: drive speed, and bucket size (its dig time grows with it) */
  | { kind: 'haul'; speedMult?: number; bucketMult?: number }
  /** the roadway (docs/15-roads.md): travel on roads (all, excavators alone,
   *  at night), road dust, and the sintering a cell takes */
  | { kind: 'road'; speedMult?: number; haulMult?: number; nightMult?: number; dustMult?: number; cellMult?: number }
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
  /** extends the Builder (docs/14 Automation picks): rule dwell and caps, extra families */
  | { kind: 'builder'; dwellMult?: number; capMult?: number; families?: AutoFamily[] }
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
  /** robotic-run overrides, merged by resolveTech() */
  robotic?: { era?: Era; costData?: number };
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
}

const M: SiteId = 'mare', P: SiteId = 'southpole', L: SiteId = 'lavatube';

export const TECHS: Record<TechId, TechDef> = {
  // ─── ERA 1 · FIRST LANDING ───
  regolithProcessing: {
    id: 'regolithProcessing', era: 1, lane: 'materials', name: 'Regolith Smelting', short: 'Regolith Smelting',
    costData: 30, requires: [],
    effects: [{ kind: 'unlock', building: 'smelter' }],
    desc: 'FeTiO₃ + H₂ → Fe + TiO₂ + H₂O: iron, oxygen and a trickle of water from ilmenite.',
    visual: 'Regolith Smelters can rise: a furnace hall with twin stacks.',
    tradeoff: 'Only the ilmenite reacts — dig where the basalt is dark.',
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
    id: 'prospectingRovers', era: 1, lane: 'exploration', name: 'Prospecting Rovers', short: 'Prospecting Rovers',
    costData: 100, requires: [],
    effects: [
      { kind: 'survey', tier: 1 },
      { kind: 'unlock', building: 'relayMast' },
      { kind: 'powerDelta', building: 'lander', kw: -1 },
    ],
    desc: 'Neutron and X-ray spectrometers on wheels, and a hopper for anything past driving range.',
    visual: 'A rover charging dock appears beside the Lander, and Relay Masts can rise.',
    tradeoff: 'Every kilometre surveyed is a robot not building.',
  },
  siteGrading: {
    id: 'siteGrading', era: 1, lane: 'robotics', name: 'Site Grading', short: 'Site Grading',
    costData: 90, requires: [], sites: [P, L],
    effects: [{ kind: 'grading' }],
    desc: 'Dozer blades flatten rough ground into pads for reactors, racks and rails.',
    visual: 'Graded pads show as raked, flattened ground under your large structures.',
    tradeoff: 'Each pass spends the night you were saving.',
  },
  iceExtraction: {
    id: 'iceExtraction', era: 1, lane: 'habitat', name: 'Cryo Ice Extraction', short: 'Ice Extraction',
    costData: 130, requires: [], sites: [P],
    effects: [{ kind: 'unlock', building: 'iceHarvester' }],
    desc: 'Mine water ice from permanently shadowed cold traps at 40 K. It is hopper propellant from day one.',
    visual: 'Ice Harvesters can rise: a drill derrick over the cold trap.',
    tradeoff: 'The ice is in the dark, and so is the harvester.',
  },
  regolithVolatiles: {
    id: 'regolithVolatiles', era: 1, lane: 'habitat', name: 'Solar-Wind Volatiles', short: 'Volatile Mining',
    costData: 100, requires: [], sites: [M, L],
    effects: [{ kind: 'recipe', building: 'excavator', outputs: { regolith: 1.5, water: 0.02 }, powerKW: -9 }],
    desc: 'Heat mature soil to ~700 °C and the implanted solar wind comes out: H₂, H₂O, ³He.',
    visual: 'Excavators carry a heated volatiles retort with a cold-trap tank.',
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

  // ─── ERA 2 · EARLY CONSTRUCTION ───
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
    costData: 130, requires: ['regolithProcessing'],
    effects: [{ kind: 'unlock', building: 'refinery' }],
    desc: 'Anorthite to wafer-grade silicon.',
    visual: 'Silicon Refineries can rise: three distillation columns.',
    tradeoff: 'Another furnace for the night to strangle.',
  },
  partsFabrication: {
    id: 'partsFabrication', era: 2, lane: 'robotics', name: 'Parts Fabrication', short: 'Parts Fabrication',
    costData: 110, requires: ['regolithProcessing'],
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
    ],
    desc: 'Two metres of berm on every structure: thermal mass, radiation, micrometeorites.',
    visual: 'Regolith berms are bulldozed against every shielded wall.',
    tradeoff: 'Buried machines are slower to reach.',
  },
  moltenElectrolysis: {
    id: 'moltenElectrolysis', era: 2, lane: 'materials', name: 'Molten Regolith Electrolysis', short: 'MRE Smelting',
    costData: 150, costGoods: { parts: 10 }, requires: ['regolithProcessing'], exclusive: 'smeltDoctrine',
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
    costData: 140, requires: ['regolithProcessing', 'prospectingRovers'], exclusive: 'smeltDoctrine', sites: [M, L],
    effects: [
      { kind: 'feedBonus', deposit: 'ilmenite', mult: 2 },
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
    costData: 120, requires: ['regolithProcessing'],
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
      { kind: 'outputMult', buildings: ['iceHarvester'], mult: 1.15 },
      { kind: 'powerMult', buildings: ['iceHarvester'], mult: 1.2 },
    ],
    desc: 'Heat the ice in place under a tent and catch the vapour on a cold plate (the Colorado School of Mines trials).',
    visual: 'Ice Harvesters pitch a foil sublimation tent over the dig.',
    tradeoff: 'You are heating a 40 K crater.',
  },
  neutronSpectrometry: {
    id: 'neutronSpectrometry', era: 2, lane: 'exploration', name: 'Neutron Spectrometry', short: 'Neutron Spectrometry',
    costData: 110, requires: ['sampleCaches'],
    effects: [
      { kind: 'survey', dataMult: 1.2 },
      { kind: 'powerMult', buildings: ['relayMast'], mult: 1.4 },
    ],
    desc: 'Epithermal neutrons count the hydrogen a metre down, from the masts as well as the rovers.',
    visual: 'Relay Masts hang a neutron-spectrometer boom.',
    tradeoff: 'Every mast becomes an instrument, and instruments draw.',
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

  // ─── ERA 3 · ROBOTIC FABRICATION ───
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
      { kind: 'upkeepMult', buildings: ['excavator'], mult: 0.5 },
      { kind: 'powerMult', buildings: ['solar'], mult: 0.95 },
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
      { kind: 'powerDelta', building: 'roboticsBay', kw: -1 },
    ],
    desc: 'The rovers watch the regolith books themselves: when the furnaces want more than the diggers deliver, they raise another excavator.',
    visual: 'Robotics Bays grow a dispatch mast: a lattice tower with a beacon on the roof.',
    tradeoff: 'It spends your metals before you have decided what they were for.',
  },
  siteSurveyAI: {
    id: 'siteSurveyAI', era: 3, lane: 'compute', name: 'Site Survey AI', short: 'Site Survey AI',
    costData: 150, requires: ['buildOrders', 'prospectingRovers'],
    effects: [
      { kind: 'siting' },
      { kind: 'upkeepMult', buildings: ['roboticsBay'], mult: 1.2 },
    ],
    desc: 'A survey drone flies every candidate pad first: the deposit under it, the light on it, the haul lanes across it.',
    visual: 'A survey drone rests on a pad on each Robotics Bay roof.',
    tradeoff: 'Drones that fly every pad wear like rovers.',
  },
  basaltPaving: {
    id: 'basaltPaving', era: 3, lane: 'materials', name: 'Basalt Paving', short: 'Basalt Paving',
    costData: 150, requires: ['regolithProcessing'],
    effects: [
      { kind: 'road', speedMult: 1.25, dustMult: 0.5 },
      { kind: 'road', cellMult: 1.2 },
    ],
    desc: 'Cast basalt pavers, poured from the smelter’s slag, give the rovers a hard running surface.',
    visual: 'The roads turn to dark basalt pavers with a pale centre line.',
    tradeoff: 'Every new cell is cast, not just sintered.',
  },

  // ─── ERA 4 · CHIP FABRICATION ───
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
  orbitalProspector: {
    id: 'orbitalProspector', era: 4, lane: 'exploration', name: 'Orbital Prospector', short: 'Orbital Prospector',
    costData: 240, costGoods: { chips: 5 }, requires: ['prospectingRovers', 'waferFab'],
    effects: [
      { kind: 'survey', tier: 2 },
      { kind: 'powerDelta', building: 'lander', kw: -2 },
    ],
    desc: 'A polar orbiter with a gamma-ray spectrometer: your chips, Earth’s rocket.',
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
      { kind: 'outputMult', buildings: ['excavator'], mult: 1.1 },
      { kind: 'upkeepMult', buildings: ['excavator'], mult: 1.3 },
    ],
    desc: 'Cameras over the wheel reject the anorthosite lumps before they ride the belt.',
    visual: 'Excavators mount an optical ore-sorting hood over the bucket wheel.',
    tradeoff: 'Lenses in a dust storm.',
  },
  heatedAugers: {
    id: 'heatedAugers', era: 4, lane: 'habitat', name: 'Heated Augers', short: 'Heated Augers',
    costData: 230, requires: ['sublimationTents'], sites: [P],
    effects: [
      { kind: 'outputMult', buildings: ['iceHarvester'], mult: 1.15 },
      { kind: 'upkeepMult', buildings: ['iceHarvester'], mult: 1.3 },
    ],
    desc: 'A second auger with heated flights lifts icy regolith the tent cannot reach.',
    visual: 'Ice Harvesters sink a second, heated auger.',
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

  // ─── ERA 5 · LUNAR COMPUTE ───
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
    visual: 'Data Centers unfold a second tier of cryo radiator fins.',
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
      { kind: 'powerDelta', building: 'lander', kw: -1 },
    ],
    desc: 'A gradiometer at the Lander weighs the buried mass under every survey line.',
    visual: 'The Lander raises a gravimeter mast.',
    tradeoff: 'The quietest instrument needs the steadiest power.',
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
    ],
    desc: 'Human inspectors walk the lines the agents only watch. This is the safety-measures purpose.',
    visual: 'Inspection lamp masts go up beside Habitats and the Lander.',
    tradeoff: 'Checklists slow everything they save.',
  },
  conditionOptimization: {
    id: 'conditionOptimization', era: 6, lane: 'materials', name: 'Condition Optimization', short: 'Condition Tuning',
    costData: 1200, costGoods: { chips: 10 }, requires: ['lunarDataCenter'], crewTech: true,
    effects: [
      { kind: 'outputMult', buildings: ['excavator', 'iceHarvester', 'smelter', 'refinery'], mult: 1.15 },
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
      { kind: 'survey', tier: 3 },
      { kind: 'powerDelta', building: 'lander', kw: -2 },
    ],
    desc: 'A halo-orbit relay at Earth–Moon L2, like Queqiao.',
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
      { kind: 'outputMult', buildings: ['excavator', 'smelter', 'refinery', 'iceHarvester'], mult: 1.3 },
      { kind: 'outputMult', buildings: ['partsFab', 'foilFactory'], mult: 1.6 },
      { kind: 'crewDelta', buildings: ['partsFab', 'foilFactory'], delta: -1 },
      { kind: 'botPerBay', delta: 1 },
      {
        kind: 'powerMult', mult: 1.25,
        buildings: ['excavator', 'smelter', 'refinery', 'iceHarvester', 'partsFab', 'foilFactory'],
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
    visual: 'Data Centers run coolant manifolds to a pump skid.',
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
    visual: 'Data Centers add a rack annex at the berm.',
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
    id: 'maglevFreight', era: 7, lane: 'power', name: 'Maglev Freight Lines', short: 'Maglev Freight',
    costData: 1100, costGoods: { chips: 10 }, requires: ['guidewayRails'],
    effects: [
      { kind: 'road', speedMult: 1.3, dustMult: 0 },
      { kind: 'road', cellMult: 1.25 },
    ],
    desc: 'Superconducting coils under the pavers lift the loads: nothing touches the ground, nothing kicks up dust.',
    visual: 'A glowing coil strip runs down the centre of the roads.',
    tradeoff: 'Coils take their time to bury.',
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
    requires: ['foilManufacturing'], requiresAny: ['railCapacitors', 'cryocoolerHeads'],
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

/** The generated +/− lines of one effect, driven by a polarity table per kind. */
export function describeEffect(fx: TechEffect, ctx: DescribeCtx = {}): EffectLine[] {
  switch (fx.kind) {
    case 'unlock': return buildingLines(fx.building, ctx);
    case 'outputMult': {
      const text = `${pctDelta(fx.mult)} output: ${names(fx.buildings)}${fx.crewedOnly ? ' (crewed only)' : ''}`;
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
        con('the beam drops to 0 while a flare is active', 1, 'mult'),
      ];
    case 'automation':
      return [
        pro('NEW TOGGLE Crewed / Autonomous on every station', 1, 'flag'),
        con(`agent-run stations draw ×${num(1 + (ctx.agentTax ?? AGENT_TAX))}`, ctx.agentTax ?? AGENT_TAX, 'mult'),
      ];
    case 'grading':
      return [
        pro(`NEW TOOL grade 16×16 m pads (≤${MAX_SLOPE_LARGE} m relief for large pads)`, 1, 'flag'),
        con(`${GRADE_COST_ENERGY} stored energy per pass`, GRADE_COST_ENERGY, 'use'),
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
        const text = `grid round-trip ${Math.round(BATTERY_EFF * 100)}% → ${Math.round(fx.efficiency * 100)}%`;
        const m = mag(fx.efficiency / BATTERY_EFF);
        out.push(fx.efficiency >= BATTERY_EFF ? pro(text, m, 'mult') : con(text, m, 'mult'));
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
        const detail = fx.tier === 1 ? 'local reveal 320 m, Moon map ≤27°, hopper surveys'
          : fx.tier === 2 ? 'whole local map, near side, first outpost slot'
          : fx.tier === 3 ? 'far side, +1 outpost slot'
          : 'subsurface prospects, +1 outpost slot, enables ATLAS';
        out.push(pro(`MAP T${fx.tier} ${t.label}: ${detail}`, fx.tier, 'count'));
        if (fx.tier === 1) out.push(con('every survey borrows 1 rover (never a pinned one) for its duration', 1, 'use'));
      }
      if (fx.dataMult !== undefined) {
        out.push(pro(`survey data ×${num(fx.dataMult)}${fx.minCrew ? ` while ≥${fx.minCrew} crew are aboard` : ''}`,
          mag(fx.dataMult), 'mult'));
      }
      return out;
    }
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
      return out;
    }
    case 'feedBonus': {
      const p = FEED_POSITIVE[fx.deposit];
      const text = p
        ? `${fx.deposit} feed ×${num(fx.mult)}: ${p.what} +${Math.round(p.coef * fx.mult * 100)}% per unit share`
        : `${fx.deposit} feed ×${num(fx.mult)}`;
      return [fx.mult >= 1 ? pro(text, mag(fx.mult), 'mult') : con(text, mag(fx.mult), 'mult')];
    }
  }
}

export function effectApplies(fx: TechEffect, siteId?: SiteId | null, exp?: Expedition): boolean {
  if (fx.sites && siteId && !fx.sites.includes(siteId)) return false;
  if (fx.expeditions && exp && !fx.expeditions.includes(exp)) return false;
  return true;
}

/** Every generated line of a tech, pros first, after effect-level site/expedition filtering. */
export function describeTech(def: TechDef, ctx: DescribeCtx = {}): EffectLine[] {
  const lines = def.effects
    .filter((fx) => effectApplies(fx, ctx.siteId, ctx.expedition))
    .flatMap((fx) => describeEffect(fx, ctx));
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
  const site = SITES[siteId];
  const anyPlaceable = (bs: BuildingId[] | 'all') =>
    bs === 'all' || bs.some((b) => buildingPlaceableAt(b, siteId));
  for (const fx of def.effects) {
    if (!effectApplies(fx, siteId, exp)) continue;
    if (!describeEffect(fx, { siteId, expedition: exp }).some((l) => l.sign === 'pro')) continue;
    switch (fx.kind) {
      case 'unlock': case 'recipe': case 'powerDelta': case 'housing': case 'morale':
        if (buildingPlaceableAt(fx.building, siteId)) return true;
        break;
      case 'outputMult': case 'inputMult': case 'powerMult': case 'upkeepMult': case 'crewDelta': case 'buildTime':
        if (anyPlaceable(fx.buildings)) return true;
        break;
      case 'grading': if (site.terrain.roughness >= 0.8) return true; break;
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

/** debug.auditTechs(): generated pro/con counts and the weakest con per tech. */
export function auditTechs(ctx: DescribeCtx = {}): { id: TechId; pros: number; cons: number; minConMagnitude: number; lines: EffectLine[] }[] {
  return TECH_ORDER.map((id) => {
    const lines = describeTech(TECHS[id], ctx);
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
