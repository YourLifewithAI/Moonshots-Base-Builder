/** 36 techs across eight eras — the robots-first arc of lunar development:
 *  land and prepare the site (1), stand up ISRU construction (2), automate the
 *  builders themselves (3), fab chips from lunar silicon (4), stand up compute
 *  on the Moon (5), THEN invite humans to optimize what the machines built (6),
 *  industrialize for export (7), and seed the Dyson swarm (8).
 *  Era N+1 opens once ≥2 techs of era N are complete. Later eras also cost
 *  manufactured goods (the Factorio lesson: you cannot out-research your
 *  industry). Every tech states its trade-off. */
import type { BuildingId } from './buildings';
import type { ResourceId } from './resources';

export type TechId =
  // era 1 — first landing
  | 'regolithProcessing' | 'iceExtraction' | 'siteGrading' | 'teleoperation' | 'hydroponicFarming'
  // era 2 — early construction
  | 'batteryStorage' | 'siliconRefining' | 'partsFabrication' | 'constructionRobotics' | 'regolithShielding'
  // era 3 — robotic fabrication
  | 'thoriumPower' | 'autonomousOps' | 'swarmRobotics' | 'roboticSelfAssembly' | 'dustMitigation'
  // era 4 — chip fabrication
  | 'waferFab' | 'acceleratorDesign' | 'cleanroomRobotics'
  // era 5 — lunar compute
  | 'lunarDataCenter' | 'cryoRadiators' | 'inferenceOptimization'
  // era 6 — human habitation
  | 'humanCohabitation' | 'closedLoopLS' | 'crewWellness' | 'safetyProtocols' | 'conditionOptimization'
  // era 7 — swarm industry
  | 'foilManufacturing' | 'massDriver' | 'autoFabrication' | 'selfReplication' | 'hiEffLaunch'
  // era 8 — dyson swarm
  | 'swarmProtocol' | 'powerBeaming' | 'vonNeumann';

export type TechEffect =
  | { kind: 'unlock'; building: BuildingId }
  | { kind: 'outputMult'; buildings: BuildingId[]; mult: number }
  | { kind: 'inputMult'; buildings: BuildingId[]; mult: number }
  | { kind: 'powerMult'; buildings: BuildingId[]; mult: number }
  | { kind: 'upkeepMult'; buildings: BuildingId[] | 'all'; mult: number }
  | { kind: 'crewDelta'; buildings: BuildingId[]; delta: number }
  | { kind: 'dustMult'; mult: number }
  | { kind: 'buildSpeed'; mult: number }        // construction time multiplier
  | { kind: 'botPerBay'; delta: number }        // extra robots per Robotics Bay
  | { kind: 'launchAction' }
  | { kind: 'powerBeam' }
  | { kind: 'automation' }
  | { kind: 'grading' };

export interface TechDef {
  id: TechId;
  era: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  name: string;
  costData: number;
  costGoods?: Partial<Record<ResourceId, number>>;
  requires: TechId[];
  effects: TechEffect[];
  desc: string;
  tradeoff: string;
  /** only researchable (and shown) on robotic expeditions */
  roboticOnly?: boolean;
  /** human-comfort tech: robotic missions must research Human Cohabitation first */
  crewTech?: boolean;
}

/** Expedition gating — '' when researchable, else the reason it is locked. */
export function techExpeditionLock(
  def: TechDef, expedition: 'human' | 'robotic', done: TechId[],
): string {
  if (def.roboticOnly && expedition !== 'robotic') return 'Robotic expeditions only';
  if (def.crewTech && expedition === 'robotic' && !done.includes('humanCohabitation')) {
    return 'needs Human Cohabitation (Era 6)';
  }
  return '';
}

export const TECHS: Record<TechId, TechDef> = {
  // ─── ERA 1 · FIRST LANDING — arrive, survey, prepare the site ───
  regolithProcessing: {
    id: 'regolithProcessing', era: 1, name: 'Regolith Smelting',
    costData: 30, requires: [],
    effects: [{ kind: 'unlock', building: 'smelter' }],
    desc: 'Hydrogen reduction of ilmenite: metals out, oxygen free.',
    tradeoff: 'Smelters are the grid’s second-largest draw.',
  },
  iceExtraction: {
    id: 'iceExtraction', era: 1, name: 'Cryo Ice Extraction',
    costData: 30, requires: [],
    effects: [{ kind: 'unlock', building: 'iceHarvester' }],
    desc: 'Mine water ice from permanently shadowed cold traps.',
    tradeoff: 'Only pays off on sites that actually have ice.',
  },
  siteGrading: {
    id: 'siteGrading', era: 1, name: 'Site Grading',
    costData: 40, requires: [],
    effects: [{ kind: 'grading' }],
    desc: 'Robot dozer blades: flatten rough terrain into buildable pads.',
    tradeoff: 'Each pass drains stored energy your night was counting on.',
  },
  teleoperation: {
    id: 'teleoperation', era: 1, name: 'Earth Teleoperation',
    costData: 40, requires: [],
    effects: [{ kind: 'buildSpeed', mult: 0.85 }],
    desc: 'Operators on Earth ride the 2.6-second delay: builds run 15% faster.',
    tradeoff: 'Every shift is hostage to the comms window and the delay.',
  },
  hydroponicFarming: {
    id: 'hydroponicFarming', era: 1, name: 'Hydroponics',
    costData: 40, requires: [], crewTech: true,
    effects: [{ kind: 'unlock', building: 'hydroponics' }],
    desc: 'Grow food under lights, from water and patience.',
    tradeoff: 'Farms must run through the night — or the crop dies.',
  },

  // ─── ERA 2 · EARLY CONSTRUCTION — the ISRU industrial base ───
  batteryStorage: {
    id: 'batteryStorage', era: 2, name: 'Battery Banks',
    costData: 80, requires: [],
    effects: [{ kind: 'unlock', building: 'battery' }],
    desc: 'Store the day. Survive the night.',
    tradeoff: '15% round-trip loss, and metals you wanted elsewhere.',
  },
  siliconRefining: {
    id: 'siliconRefining', era: 2, name: 'Silicon Refining',
    costData: 100, requires: ['regolithProcessing'],
    effects: [{ kind: 'unlock', building: 'refinery' }],
    desc: 'Anorthite to wafer-grade silicon.',
    tradeoff: 'Another furnace for the night to strangle.',
  },
  partsFabrication: {
    id: 'partsFabrication', era: 2, name: 'Parts Fabrication',
    costData: 110, requires: ['siliconRefining'],
    effects: [{ kind: 'unlock', building: 'partsFab' }],
    desc: 'Make your own spares. Cut the last umbilical to the lander cache.',
    tradeoff: 'Adds a whole supply chain that also needs maintaining.',
  },
  constructionRobotics: {
    id: 'constructionRobotics', era: 2, name: 'Construction Robotics',
    costData: 90, requires: [],
    effects: [{ kind: 'unlock', building: 'roboticsBay' }],
    desc: 'Autonomous builders: each Robotics Bay fields two more robots.',
    tradeoff: 'A bigger fleet builds faster — and drains the grid while it works.',
  },
  regolithShielding: {
    id: 'regolithShielding', era: 2, name: 'Regolith Shielding',
    costData: 90, requires: ['siteGrading'],
    effects: [{ kind: 'upkeepMult', buildings: 'all', mult: 0.85 }],
    desc: 'Berm every structure in two meters of soil: thermal mass, radiation, micrometeorites.',
    tradeoff: 'Buried machines are safer — and slower to reach when they fail.',
  },

  // ─── ERA 3 · ROBOTIC FABRICATION — the builders build themselves ───
  thoriumPower: {
    id: 'thoriumPower', era: 3, name: 'Thorium Reactor',
    costData: 280, costGoods: { metals: 80 }, requires: ['batteryStorage'],
    effects: [{ kind: 'unlock', building: 'reactor' }],
    desc: 'Baseload power that ignores the sun entirely.',
    tradeoff: 'Expensive, parts-hungry, and the crew hates living next to it.',
  },
  autonomousOps: {
    id: 'autonomousOps', era: 3, name: 'Autonomous Operations',
    costData: 260, costGoods: { parts: 30 }, requires: ['constructionRobotics'],
    effects: [{ kind: 'automation' }],
    desc: 'Agent crews for any workstation: switch buildings to run without humans.',
    tradeoff: 'Agents need no habs or food — but draw 60% more power than people.',
  },
  swarmRobotics: {
    id: 'swarmRobotics', era: 3, name: 'Swarm Robotics',
    costData: 240, costGoods: { parts: 20 }, requires: ['constructionRobotics'],
    effects: [{ kind: 'buildSpeed', mult: 0.75 }],
    desc: 'The fleet coordinates itself: builds finish 25% faster.',
    tradeoff: 'One bad firmware push now walks in formation.',
  },
  roboticSelfAssembly: {
    id: 'roboticSelfAssembly', era: 3, name: 'Robotic Self-Assembly',
    costData: 300, costGoods: { parts: 25 }, requires: ['constructionRobotics', 'partsFabrication'],
    effects: [{ kind: 'botPerBay', delta: 1 }],
    desc: 'Bays print their own workers: each Robotics Bay fields one extra robot.',
    tradeoff: 'Robots that make robots inherit each other’s defects.',
  },
  dustMitigation: {
    id: 'dustMitigation', era: 3, name: 'Dust Mitigation',
    costData: 240, requires: [],
    effects: [
      { kind: 'dustMult', mult: 0.4 },
      { kind: 'upkeepMult', buildings: ['excavator'], mult: 0.5 },
    ],
    desc: 'Electrostatic wands and sealed bearings against the Moon’s knife-dust.',
    tradeoff: 'Research spent on brooms while rivals research rockets.',
  },

  // ─── ERA 4 · CHIP FABRICATION — lunar silicon becomes lunar silicon ───
  waferFab: {
    id: 'waferFab', era: 4, name: 'Wafer Fabrication',
    costData: 380, costGoods: { silicon: 40 }, requires: ['partsFabrication'],
    effects: [{ kind: 'unlock', building: 'chipFab' }],
    desc: 'A cleanroom in hard vacuum: the Moon is the best fab floor ever built.',
    tradeoff: 'The most delicate machine on the Moon, in the dustiest place there is.',
  },
  acceleratorDesign: {
    id: 'acceleratorDesign', era: 4, name: 'Accelerator Design',
    costData: 440, costGoods: { silicon: 30 }, requires: ['waferFab'],
    effects: [{ kind: 'outputMult', buildings: ['chipFab'], mult: 1.5 }],
    desc: 'TPU-class masks tuned for the swarm’s workloads: 50% more chips per wafer.',
    tradeoff: 'Specialized silicon is useless for everything else.',
  },
  cleanroomRobotics: {
    id: 'cleanroomRobotics', era: 4, name: 'Cleanroom Robotics',
    costData: 400, costGoods: { parts: 30 }, requires: ['waferFab'],
    effects: [
      { kind: 'powerMult', buildings: ['chipFab'], mult: 0.7 },
      { kind: 'inputMult', buildings: ['chipFab'], mult: 0.8 },
    ],
    desc: 'Sealed handling lines: the fab draws 30% less power and wastes less feedstock.',
    tradeoff: 'Yet more robots for the parts budget to feed.',
  },

  // ─── ERA 5 · LUNAR COMPUTE — data centers where cooling is free ───
  lunarDataCenter: {
    id: 'lunarDataCenter', era: 5, name: 'Lunar Data Center',
    costData: 520, costGoods: { chips: 10 }, requires: ['waferFab'],
    effects: [{ kind: 'unlock', building: 'dataCenter' }],
    desc: 'Racks under regolith, radiators at the black sky: compute without a biosphere to warm.',
    tradeoff: 'The largest single power draw until the foil factory exists.',
  },
  cryoRadiators: {
    id: 'cryoRadiators', era: 5, name: 'Cryo Radiators',
    costData: 560, costGoods: { metals: 60 }, requires: ['lunarDataCenter'],
    effects: [{ kind: 'powerMult', buildings: ['dataCenter'], mult: 0.65 }],
    desc: 'Deep-sky radiators reject heat at 3 kelvin: the racks sip instead of gulp.',
    tradeoff: 'Acres of foil that dust and micrometeorites both love.',
  },
  inferenceOptimization: {
    id: 'inferenceOptimization', era: 5, name: 'Inference Optimization',
    costData: 640, costGoods: { chips: 15 }, requires: ['lunarDataCenter'],
    effects: [{ kind: 'outputMult', buildings: ['dataCenter'], mult: 1.5 }],
    desc: 'The base learns to think about itself: 50% more research per rack.',
    tradeoff: 'Models tuned on the base’s own data trust the base’s own blind spots.',
  },

  // ─── ERA 6 · HUMAN HABITATION — invite the humans the robots built for ───
  humanCohabitation: {
    id: 'humanCohabitation', era: 6, name: 'Human Cohabitation',
    costData: 700, costGoods: { parts: 30, chips: 10 }, requires: ['thoriumPower'], roboticOnly: true,
    effects: [{ kind: 'unlock', building: 'habitat' }],
    desc: 'Pressurized quarters, storm shelters, medical stores: ready the base for human partners.',
    tradeoff: 'Humans bring the morale work bonus — and lungs, stomachs, and moods to keep alive.',
  },
  closedLoopLS: {
    id: 'closedLoopLS', era: 6, name: 'Closed-Loop Life Support',
    costData: 640, costGoods: { parts: 25 }, requires: [], crewTech: true,
    effects: [
      { kind: 'inputMult', buildings: ['habitat'], mult: 0.6 },
      { kind: 'powerMult', buildings: ['habitat'], mult: 1.3 },
    ],
    desc: 'Scrub, recycle, repeat: habitats need 40% less oxygen and food.',
    tradeoff: 'The recyclers draw 30% more power — and eat 25 parts to install.',
  },
  crewWellness: {
    id: 'crewWellness', era: 6, name: 'Crew Wellness Program',
    costData: 600, requires: [], crewTech: true,
    effects: [{ kind: 'unlock', building: 'recDome' }],
    desc: 'A dome with plants, a screen, and gravity-optional handball.',
    tradeoff: 'Diverts power, food, and a worker from every "productive" number.',
  },
  safetyProtocols: {
    id: 'safetyProtocols', era: 6, name: 'Safety Protocols',
    costData: 680, costGoods: { chips: 10 }, requires: [], crewTech: true,
    effects: [{ kind: 'upkeepMult', buildings: 'all', mult: 0.8 }],
    desc: 'Human inspectors walk the lines the agents only watch: failures caught before they cascade.',
    tradeoff: 'Checklists slow everything they save.',
  },
  conditionOptimization: {
    id: 'conditionOptimization', era: 6, name: 'Condition Optimization',
    costData: 720, costGoods: { chips: 10 }, requires: [], crewTech: true,
    effects: [{ kind: 'outputMult', buildings: ['excavator', 'iceHarvester', 'smelter', 'refinery'], mult: 1.15 }],
    desc: 'Researchers tune what agents merely accept: extraction and refining gain 15%.',
    tradeoff: 'The gains last only while someone keeps caring.',
  },

  // ─── ERA 7 · SWARM INDUSTRY — the export economy ───
  foilManufacturing: {
    id: 'foilManufacturing', era: 7, name: 'Thin-Film Foils',
    costData: 900, costGoods: { silicon: 40 }, requires: ['partsFabrication'],
    effects: [{ kind: 'unlock', building: 'foilFactory' }],
    desc: 'Collector foils micrometers thick — sunlight’s future harvest.',
    tradeoff: 'The factory is the single largest power draw you will ever build.',
  },
  massDriver: {
    id: 'massDriver', era: 7, name: 'Electromagnetic Mass Driver',
    costData: 1000, costGoods: { parts: 50 }, requires: ['partsFabrication'],
    effects: [{ kind: 'unlock', building: 'massDriver' }],
    desc: 'A rail to orbit. 2.4 km/s and no propellant.',
    tradeoff: 'Site geometry now matters enormously — equatorial bases pull ahead.',
  },
  autoFabrication: {
    id: 'autoFabrication', era: 7, name: 'Automated Fabrication',
    costData: 1100, costGoods: { parts: 60, chips: 10 }, requires: ['foilManufacturing'],
    effects: [
      { kind: 'outputMult', buildings: ['partsFab', 'foilFactory'], mult: 2 },
      { kind: 'crewDelta', buildings: ['partsFab', 'foilFactory'], delta: -1 },
    ],
    desc: 'Lines that run themselves: double output, one fewer human per line.',
    tradeoff: 'Automation fails ugly — wear costs bite harder when no one is watching.',
  },
  selfReplication: {
    id: 'selfReplication', era: 7, name: 'Self-Replicating Systems',
    costData: 1300, costGoods: { parts: 80, chips: 15 }, requires: ['autoFabrication'],
    effects: [
      { kind: 'outputMult', buildings: ['excavator', 'smelter', 'refinery', 'iceHarvester'], mult: 1.5 },
      { kind: 'upkeepMult', buildings: 'all', mult: 0.75 },
    ],
    desc: 'Machines that maintain and extend machines. The exponential turn.',
    tradeoff: 'Every doubling doubles the blast radius of a single bad batch.',
  },
  hiEffLaunch: {
    id: 'hiEffLaunch', era: 7, name: 'High-Efficiency Launch',
    costData: 1200, costGoods: { silicon: 60 }, requires: ['massDriver'],
    effects: [
      { kind: 'powerMult', buildings: ['massDriver'], mult: 0.6 },
      { kind: 'outputMult', buildings: ['massDriver'], mult: 2 },
    ],
    desc: 'Superconducting rails: twice the launch windows at 60% of the power.',
    tradeoff: 'Superconductors demand silicon your foils were counting on.',
  },

  // ─── ERA 8 · DYSON SWARM ───
  swarmProtocol: {
    id: 'swarmProtocol', era: 8, name: 'Swarm Protocol',
    costData: 1600, costGoods: { foils: 5, chips: 10 }, requires: ['hiEffLaunch'],
    effects: [{ kind: 'launchAction' }],
    desc: 'Deployment doctrine for a trillion-collector swarm. LAUNCH is armed.',
    tradeoff: 'The five test foils it consumes never come back.',
  },
  powerBeaming: {
    id: 'powerBeaming', era: 8, name: 'Power Beaming Return',
    costData: 1900, requires: ['swarmProtocol'],
    effects: [{ kind: 'powerBeam' }],
    desc: 'The swarm pays rent: microwave power beamed back to your rectenna.',
    tradeoff: 'Your grid now depends on hardware forty million kilometers away.',
  },
  vonNeumann: {
    id: 'vonNeumann', era: 8, name: 'Von Neumann Foundry',
    costData: 2600, costGoods: { foils: 20 }, requires: ['swarmProtocol'],
    effects: [{ kind: 'outputMult', buildings: ['foilFactory'], mult: 3 }],
    desc: 'Foil factories that seed foil factories. The curve goes vertical.',
    tradeoff: 'A monument to obsolescence: yours, specifically.',
  },
};

export const TECH_ORDER = Object.keys(TECHS) as TechId[];
export const ERA_NAMES: Record<number, string> = {
  1: 'FIRST LANDING', 2: 'EARLY CONSTRUCTION', 3: 'ROBOTIC FABRICATION',
  4: 'CHIP FABRICATION', 5: 'LUNAR COMPUTE', 6: 'HUMAN HABITATION',
  7: 'SWARM INDUSTRY', 8: 'DYSON SWARM',
};
export const ERA_ADVANCE_COUNT = 2; // techs of era N needed to open era N+1
