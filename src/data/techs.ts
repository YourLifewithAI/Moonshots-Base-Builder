/** 47 technologies in 7 swimlanes × 8 eras — the robots-first arc of lunar
 *  development (docs/11-research-and-map-spec.md §3). Era N opens with 2 of
 *  era N−1's techs, or 1 plus that era's deed (ERA_GATES). Six doctrines are
 *  permanent either/or picks. Every card's pros and cons are generated from
 *  its effects by describeEffect(); `tradeoff` is flavour only.
 *  Availability, cost and the queue live in core/research.ts. */
import { BUILDINGS, type BuildingId } from './buildings';
import { RESOURCES, type ResourceId } from './resources';
import { SITES, SITE_ORDER, type SiteId } from './sites';
import { siteHasDeposit, type FeedKind } from './deposits';
import type { ProspectId } from './lunarMap';
import type { GameState } from '../core/state';
import {
  AGENT_TAX, BATTERY_EFF, BEAM_KW_PER_LAUNCH, CONSTRUCTION_KW, DOWNLINK, FEED,
  GRADE_COST_ENERGY, LAUNCH_CAP_PER_VOLLEY, LAUNCH_COST_FOILS, LAUNCH_POWER_BURST,
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
  // era 2 — early construction
  | 'batteryStorage' | 'thermalWadis' | 'peakLightMasts' | 'skylightHeliostats' | 'siliconRefining'
  | 'partsFabrication' | 'constructionRobotics' | 'regolithShielding' | 'moltenElectrolysis' | 'ilmeniteBeneficiation'
  // era 3 — robotic fabrication
  | 'thoriumPower' | 'regenFuelCells' | 'swarmRobotics' | 'heavyConstructors' | 'dustMitigation' | 'btLavaTubeCaverns'
  // era 4 — chip fabrication
  | 'waferFab' | 'acceleratorDesign' | 'radHardProcess' | 'cleanroomRobotics' | 'orbitalProspector' | 'btVolcanicGlass'
  // era 5 — lunar compute
  | 'lunarDataCenter' | 'dynamicClocking' | 'cryoRadiators' | 'crewWellness'
  // era 6 — human habitation
  | 'humanCohabitation' | 'closedLoopLS' | 'safetyProtocols' | 'conditionOptimization' | 'scienceCrews'
  | 'farSideRelay' | 'btColdTrapChemistry'
  // era 7 — swarm industry
  | 'foilManufacturing' | 'massDriver' | 'propellantDepot' | 'selfReplication' | 'deepSounding'
  // era 8 — dyson swarm (lane-free capstone column)
  | 'swarmProtocol' | 'powerBeaming' | 'vonNeumann';

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
}

const M: SiteId = 'mare', P: SiteId = 'southpole', L: SiteId = 'lavatube';

export const TECHS: Record<TechId, TechDef> = {
  // ─── ERA 1 · FIRST LANDING ───
  regolithProcessing: {
    id: 'regolithProcessing', era: 1, lane: 'materials', name: 'Regolith Smelting', short: 'Regolith Smelting',
    costData: 30, requires: [],
    effects: [{ kind: 'unlock', building: 'smelter' }],
    desc: 'FeTiO₃ + H₂ → Fe + TiO₂ + H₂O: iron, oxygen and a trickle of water from ilmenite.',
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
    tradeoff: 'Ops video and science share one antenna.',
  },
  prospectingRovers: {
    id: 'prospectingRovers', era: 1, lane: 'exploration', name: 'Prospecting Rovers', short: 'Prospecting Rovers',
    costData: 120, requires: [],
    effects: [
      { kind: 'survey', tier: 1 },
      { kind: 'unlock', building: 'relayMast' },
      { kind: 'powerDelta', building: 'lander', kw: -1 },
    ],
    desc: 'Neutron and X-ray spectrometers on wheels, and a hopper for anything past driving range.',
    tradeoff: 'Every kilometre surveyed is a robot not building.',
  },
  siteGrading: {
    id: 'siteGrading', era: 1, lane: 'robotics', name: 'Site Grading', short: 'Site Grading',
    costData: 90, requires: [], sites: [P, L],
    effects: [{ kind: 'grading' }],
    desc: 'Dozer blades flatten rough ground into pads for reactors, racks and rails.',
    tradeoff: 'Each pass spends the night you were saving.',
  },
  iceExtraction: {
    id: 'iceExtraction', era: 1, lane: 'habitat', name: 'Cryo Ice Extraction', short: 'Ice Extraction',
    costData: 130, requires: [], sites: [P],
    effects: [{ kind: 'unlock', building: 'iceHarvester' }],
    desc: 'Mine water ice from permanently shadowed cold traps at 40 K. It is hopper propellant from day one.',
    tradeoff: 'The ice is in the dark, and so is the harvester.',
  },
  regolithVolatiles: {
    id: 'regolithVolatiles', era: 1, lane: 'habitat', name: 'Solar-Wind Volatiles', short: 'Volatile Mining',
    costData: 100, requires: [], sites: [M, L],
    effects: [{ kind: 'recipe', building: 'excavator', outputs: { regolith: 1.5, water: 0.02 }, powerKW: -9 }],
    desc: 'Heat mature soil to ~700 °C and the implanted solar wind comes out: H₂, H₂O, ³He.',
    tradeoff: 'Four billion years of wind, a teaspoon a minute.',
  },

  // ─── ERA 2 · EARLY CONSTRUCTION ───
  batteryStorage: {
    id: 'batteryStorage', era: 2, lane: 'power', name: 'Battery Banks', short: 'Battery Banks',
    costData: 110, requires: [],
    effects: [{ kind: 'unlock', building: 'battery' }],
    desc: 'Store the day. Survive the night.',
    tradeoff: 'Metals you wanted elsewhere.',
  },
  thermalWadis: {
    id: 'thermalWadis', era: 2, lane: 'power', name: 'Thermal Wadis', short: 'Thermal Wadis',
    costData: 120, requires: [], sites: [M],
    effects: [{ kind: 'nightDraw', night: 0.85, day: 1.05 }],
    desc: 'Sintered-regolith heat banks, charged by day, keep machines above survival temperature through the night (Balasubramaniam et al. 2010).',
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
    tradeoff: 'Mirrors love dust.',
  },
  siliconRefining: {
    id: 'siliconRefining', era: 2, lane: 'compute', name: 'Silicon Refining', short: 'Silicon Refining',
    costData: 130, requires: ['regolithProcessing'],
    effects: [{ kind: 'unlock', building: 'refinery' }],
    desc: 'Anorthite to wafer-grade silicon.',
    tradeoff: 'Another furnace for the night to strangle.',
  },
  partsFabrication: {
    id: 'partsFabrication', era: 2, lane: 'robotics', name: 'Parts Fabrication', short: 'Parts Fabrication',
    costData: 110, requires: ['regolithProcessing'],
    effects: [{ kind: 'unlock', building: 'partsFab' }],
    desc: 'Make your own spares.',
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
    tradeoff: 'Chase the ore: the map decides your yield.',
  },

  // ─── ERA 3 · ROBOTIC FABRICATION ───
  thoriumPower: {
    id: 'thoriumPower', era: 3, lane: 'power', name: 'Thorium Reactor', short: 'Thorium Reactor',
    costData: 200, costGoods: { metals: 80 }, requires: ['regolithShielding'], exclusive: 'nightPower',
    effects: [{ kind: 'unlock', building: 'reactor' }],
    desc: 'Fission surface power behind a regolith berm.',
    tradeoff: 'Baseload that eats parts like a rover fleet.',
  },
  regenFuelCells: {
    id: 'regenFuelCells', era: 3, lane: 'power', name: 'Regenerative Fuel Cells', short: 'Fuel Cells',
    costData: 180, costGoods: { water: 80 }, requires: ['batteryStorage'], exclusive: 'nightPower',
    effects: [{ kind: 'storage', capacityMult: 2, efficiency: 0.6 }],
    desc: 'Split water by day and recombine it by night: bulk tanks, not cells.',
    tradeoff: 'Half of what you store comes back.',
  },
  swarmRobotics: {
    id: 'swarmRobotics', era: 3, lane: 'robotics', name: 'Swarm Robotics', short: 'Swarm Robotics',
    costData: 180, costGoods: { parts: 20 }, requires: ['constructionRobotics'], exclusive: 'constructionDoctrine',
    effects: [
      { kind: 'botPerBay', delta: 1 },
      { kind: 'buildSpeed', mult: 0.85 },
      { kind: 'construction', kwMult: 1.5 },
      { kind: 'upkeepMult', buildings: ['roboticsBay'], mult: 1.5 },
    ],
    desc: 'The fleet coordinates itself.',
    tradeoff: 'One bad firmware push walks in formation.',
  },
  heavyConstructors: {
    id: 'heavyConstructors', era: 3, lane: 'robotics', name: 'Heavy Constructors', short: 'Heavy Constructors',
    costData: 180, costGoods: { parts: 20 }, requires: ['constructionRobotics'], exclusive: 'constructionDoctrine',
    effects: [
      { kind: 'construction', rateMult: 2.2, partsMult: 0.6 },
      { kind: 'botPerBay', delta: -1 },
      { kind: 'construction', kwMult: 2 },
    ],
    desc: 'Fewer, bigger machines: each build 2.2× faster on 60% of the weld.',
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
    tradeoff: 'Down is slow.',
  },

  // ─── ERA 4 · CHIP FABRICATION ───
  waferFab: {
    id: 'waferFab', era: 4, lane: 'materials', name: 'Wafer Fabrication', short: 'Wafer Fabrication',
    costData: 260, costGoods: { silicon: 40 }, requires: ['siliconRefining', 'partsFabrication'],
    effects: [{ kind: 'unlock', building: 'chipFab' }],
    desc: 'Hard vacuum is the cleanest cleanroom ever built.',
    tradeoff: 'The most delicate machine, in the dustiest place.',
  },
  acceleratorDesign: {
    id: 'acceleratorDesign', era: 4, lane: 'compute', name: 'Accelerator Design', short: 'Accelerator Design',
    costData: 300, costGoods: { silicon: 30 }, requires: ['waferFab'], exclusive: 'chipDoctrine',
    effects: [
      { kind: 'outputMult', buildings: ['dataCenter'], mult: 1.5 },
      { kind: 'inputMult', buildings: ['chipFab'], mult: 1.25 },
    ],
    desc: 'TPU-class masks tuned for inference.',
    tradeoff: 'Specialised silicon does one thing.',
  },
  radHardProcess: {
    id: 'radHardProcess', era: 4, lane: 'compute', name: 'Rad-Hard Process', short: 'Rad-Hard Chips',
    costData: 300, costGoods: { silicon: 30 }, requires: ['waferFab'], exclusive: 'chipDoctrine',
    effects: [
      { kind: 'outputMult', buildings: ['chipFab'], mult: 1.4 },
      { kind: 'agentTax', mult: 0.6 },
      { kind: 'outputMult', buildings: ['dataCenter'], mult: 0.85 },
    ],
    desc: 'Older, larger nodes and thick oxides that shrug off cosmic rays.',
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
    tradeoff: 'More robots for the parts budget.',
  },
  orbitalProspector: {
    id: 'orbitalProspector', era: 4, lane: 'exploration', name: 'Orbital Prospector', short: 'Orbital Prospector',
    costData: 240, costGoods: { chips: 5 }, requires: ['prospectingRovers', 'waferFab'],
    effects: [
      { kind: 'survey', tier: 2 },
      { kind: 'powerDelta', building: 'lander', kw: -2 },
    ],
    desc: 'A polar orbiter with a gamma-ray spectrometer: your chips, Earth’s rocket.',
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
    tradeoff: 'Hotter, faster, hungrier.',
  },

  // ─── ERA 5 · LUNAR COMPUTE ───
  lunarDataCenter: {
    id: 'lunarDataCenter', era: 5, lane: 'compute', name: 'Lunar Data Center', short: 'Data Center',
    costData: 420, costGoods: { chips: 10 }, requires: ['waferFab'],
    effects: [{ kind: 'unlock', building: 'dataCenter' }],
    desc: 'Racks under regolith, radiators facing the black sky.',
    tradeoff: 'The night negotiates with your batteries.',
  },
  dynamicClocking: {
    id: 'dynamicClocking', era: 5, lane: 'compute', name: 'Dynamic Clocking', short: 'Dynamic Clocking',
    costData: 440, costGoods: { chips: 5 }, requires: [], requiresAny: ['acceleratorDesign', 'radHardProcess'],
    effects: [{ kind: 'action', id: 'overclock' }],
    desc: 'Push silicon and machines past nameplate when it counts.',
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
    tradeoff: 'Acres of foil that micrometeorites love.',
  },
  crewWellness: {
    id: 'crewWellness', era: 5, lane: 'habitat', name: 'Crew Wellness Program', short: 'Crew Wellness',
    costData: 460, requires: [], crewTech: true, robotic: { era: 7, costData: 1000 },
    effects: [{ kind: 'unlock', building: 'recDome' }],
    desc: 'Plants, a screen, low-g handball.',
    tradeoff: 'A pure cost centre.',
  },

  // ─── ERA 6 · HUMAN HABITATION ───
  humanCohabitation: {
    id: 'humanCohabitation', era: 6, lane: 'habitat', name: 'Human Cohabitation', short: 'Human Cohabitation',
    costData: 1250, costGoods: { parts: 30, chips: 10 },
    requires: ['regolithShielding'], requiresAny: ['thoriumPower', 'regenFuelCells'], expeditions: ['robotic'],
    effects: [
      { kind: 'unlock', building: 'habitat' },
      { kind: 'unlock', building: 'hydroponics' },
    ],
    desc: 'Shielded quarters and night-proof power, then invite the humans.',
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
    tradeoff: 'Useful chemistry is corrosive chemistry.',
  },

  // ─── ERA 7 · SWARM INDUSTRY ───
  foilManufacturing: {
    id: 'foilManufacturing', era: 7, lane: 'materials', name: 'Thin-Film Foils', short: 'Thin-Film Foils',
    costData: 1250, costGoods: { silicon: 40 }, requires: ['waferFab'], requiresAny: ['cleanroomRobotics', 'dustMitigation'],
    effects: [{ kind: 'unlock', building: 'foilFactory' }],
    desc: 'Collector foils micrometres thick. Thin film needs clean handling.',
    tradeoff: 'The largest draw you will ever build.',
  },
  massDriver: {
    id: 'massDriver', era: 7, lane: 'export', name: 'Electromagnetic Mass Driver', short: 'Mass Driver',
    costData: 1400, costGoods: { parts: 50 }, requires: ['partsFabrication', 'batteryStorage'], exclusive: 'launchArchitecture',
    effects: [{ kind: 'unlock', building: 'massDriver' }],
    desc: 'A 2.4 km/s rail with no propellant.',
    tradeoff: 'Rails can’t steer: latitude is destiny.',
  },
  propellantDepot: {
    id: 'propellantDepot', era: 7, lane: 'export', name: 'Propellant Depot', short: 'Propellant Depot',
    costData: 1400, costGoods: { parts: 40, metals: 40 },
    requires: ['partsFabrication'], requiresAny: ['iceExtraction', 'regolithVolatiles'], exclusive: 'launchArchitecture',
    effects: [{ kind: 'unlock', building: 'propellantPlant' }],
    desc: 'Water becomes LOX/LH₂; rockets steer where rails can’t.',
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
    tradeoff: 'Listening to the whole Moon takes power.',
  },

  // ─── ERA 8 · DYSON SWARM (capstone column) ───
  swarmProtocol: {
    id: 'swarmProtocol', era: 8, name: 'Swarm Protocol', short: 'Swarm Protocol',
    costData: 3300, costGoods: { foils: 5, chips: 10 },
    requires: ['foilManufacturing'], requiresAny: ['massDriver', 'propellantDepot'],
    effects: [{ kind: 'launchAction' }],
    desc: 'Deployment doctrine for a trillion collectors.',
    tradeoff: 'The five test foils never come back.',
  },
  powerBeaming: {
    id: 'powerBeaming', era: 8, name: 'Power Beaming Return', short: 'Power Beaming',
    costData: 3400, requires: ['swarmProtocol', 'batteryStorage'], exclusive: 'swarmPurpose',
    effects: [{ kind: 'powerBeam' }],
    desc: 'The swarm pays rent in microwaves.',
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

/** The deed that opens era `era` alongside 1 visible done tech of era − 1. */
export interface EraGate {
  era: Era;
  deed: string;
  need: number;
  value: (s: GameState) => number;
  /** hard requirement on robotic runs, on either route */
  roboticRequires?: TechId;
}
export const ERA_GATES: Partial<Record<Era, EraGate>> = {
  2: { era: 2, deed: '100◆ smelted', need: 100, value: (s) => s.stats.produced.metals },
  3: { era: 3, deed: '80⚙ fabricated', need: 80, value: (s) => s.stats.produced.parts },
  4: { era: 4, deed: '150◇ refined', need: 150, value: (s) => s.stats.produced.silicon },
  5: { era: 5, deed: '20▣ chips fabbed', need: 20, value: (s) => s.stats.produced.chips },
  6: {
    era: 6, deed: 'a Data Center held a full night with every priority-0/1 load powered',
    need: 1, value: (s) => (s.stats.dcCleanNight ? 1 : 0),
  },
  7: {
    era: 7, deed: 'an outpost operated a full lunar day',
    need: 720, value: (s) => s.stats.outpostOpS, roboticRequires: 'humanCohabitation',
  },
  8: { era: 8, deed: '10▰ manufactured', need: 10, value: (s) => s.stats.produced.foils },
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
  if (d.bots) out.push(pro(`+${d.bots} robots`, d.bots, 'count'));
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
      const text = `${fx.delta > 0 ? '+' : '−'}${Math.abs(fx.delta)} robot per Robotics Bay`;
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
        const text = `each build ×${num(fx.rateMult)} speed per site`;
        out.push(fx.rateMult >= 1 ? pro(text, mag(fx.rateMult), 'mult') : con(text, mag(fx.rateMult), 'mult'));
      }
      if (fx.partsMult !== undefined) {
        const text = `${pctDelta(fx.partsMult)} weld parts`;
        out.push(fx.partsMult <= 1 ? pro(text, mag(fx.partsMult), 'mult') : con(text, mag(fx.partsMult), 'mult'));
      }
      if (fx.kwMult !== undefined) {
        const text = `construction draw ×${num(fx.kwMult)} (${num(CONSTRUCTION_KW * fx.kwMult)} kW per active site)`;
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
        if (fx.tier === 1) out.push(con('every survey borrows 1 robot for its duration', 1, 'use'));
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
      case 'unlock': case 'recipe': case 'powerDelta':
        if (buildingPlaceableAt(fx.building, siteId)) return true;
        break;
      case 'outputMult': case 'inputMult': case 'powerMult': case 'upkeepMult': case 'crewDelta': case 'buildTime':
        if (anyPlaceable(fx.buildings)) return true;
        break;
      case 'grading': if (site.terrain.roughness >= 0.8) return true; break;
      case 'shadeImmune': if (site.terrain.roughness >= 1.0) return true; break;
      case 'nightDraw': if (site.nightSolarFraction < 0.5) return true; break;
      case 'feedBonus': if (fx.deposit !== 'plain' && siteHasDeposit(siteId, fx.deposit)) return true; break;
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
