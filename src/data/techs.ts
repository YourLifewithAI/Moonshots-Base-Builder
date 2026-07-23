/** 18 techs across all six eras — the compressed slice of the full ~30-tech tree
 *  (docs/03-tech-tree.md). Era N+1 opens once ≥2 techs of era N are complete.
 *  Era 3+ techs also cost manufactured goods (the Factorio lesson: you cannot
 *  out-research your industry). Every tech states its trade-off. */
import type { BuildingId } from './buildings';
import type { ResourceId } from './resources';

export type TechId =
  | 'regolithProcessing' | 'iceExtraction' | 'hydroponicFarming' | 'siteGrading'
  | 'batteryStorage' | 'closedLoopLS' | 'siliconRefining' | 'constructionRobotics'
  | 'partsFabrication' | 'thoriumPower' | 'crewWellness' | 'autonomousOps'
  | 'foilManufacturing' | 'massDriver' | 'dustMitigation' | 'humanCohabitation'
  | 'autoFabrication' | 'selfReplication' | 'hiEffLaunch'
  | 'swarmProtocol' | 'powerBeaming' | 'vonNeumann';

export type TechEffect =
  | { kind: 'unlock'; building: BuildingId }
  | { kind: 'outputMult'; buildings: BuildingId[]; mult: number }
  | { kind: 'inputMult'; buildings: BuildingId[]; mult: number }
  | { kind: 'powerMult'; buildings: BuildingId[]; mult: number }
  | { kind: 'upkeepMult'; buildings: BuildingId[] | 'all'; mult: number }
  | { kind: 'crewDelta'; buildings: BuildingId[]; delta: number }
  | { kind: 'dustMult'; mult: number }
  | { kind: 'launchAction' }
  | { kind: 'powerBeam' }
  | { kind: 'automation' }
  | { kind: 'grading' };

export interface TechDef {
  id: TechId;
  era: 1 | 2 | 3 | 4 | 5 | 6;
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
    return 'needs Human Cohabitation (Era 4)';
  }
  return '';
}

export const TECHS: Record<TechId, TechDef> = {
  // ─── ERA 1 · FIRST LANDING ───
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
  hydroponicFarming: {
    id: 'hydroponicFarming', era: 1, name: 'Hydroponics',
    costData: 40, requires: [], crewTech: true,
    effects: [{ kind: 'unlock', building: 'hydroponics' }],
    desc: 'Grow food under lights, from water and patience.',
    tradeoff: 'Farms must run through the night — or the crop dies.',
  },

  siteGrading: {
    id: 'siteGrading', era: 1, name: 'Site Grading',
    costData: 40, requires: [],
    effects: [{ kind: 'grading' }],
    desc: 'Robot dozer blades: flatten rough terrain into buildable pads.',
    tradeoff: 'Each pass drains stored energy your night was counting on.',
  },

  // ─── ERA 2 · SELF-SUFFICIENCY ───
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

  // ─── ERA 3 · INDUSTRIALIZATION ───
  closedLoopLS: {
    id: 'closedLoopLS', era: 3, name: 'Closed-Loop Life Support',
    costData: 260, costGoods: { parts: 25 }, requires: [], crewTech: true,
    effects: [
      { kind: 'inputMult', buildings: ['habitat'], mult: 0.6 },
      { kind: 'powerMult', buildings: ['habitat'], mult: 1.3 },
    ],
    desc: 'Scrub, recycle, repeat: habitats need 40% less oxygen and food.',
    tradeoff: 'The recyclers draw 30% more power — and eat 25 parts to install.',
  },
  thoriumPower: {
    id: 'thoriumPower', era: 3, name: 'Thorium Reactor',
    costData: 280, costGoods: { metals: 80 }, requires: ['batteryStorage'],
    effects: [{ kind: 'unlock', building: 'reactor' }],
    desc: 'Baseload power that ignores the sun entirely.',
    tradeoff: 'Expensive, parts-hungry, and the crew hates living next to it.',
  },
  crewWellness: {
    id: 'crewWellness', era: 3, name: 'Crew Wellness Program',
    costData: 200, requires: [], crewTech: true,
    effects: [{ kind: 'unlock', building: 'recDome' }],
    desc: 'A dome with plants, a screen, and gravity-optional handball.',
    tradeoff: 'Diverts power, food, and a worker from every "productive" number.',
  },

  autonomousOps: {
    id: 'autonomousOps', era: 3, name: 'Autonomous Operations',
    costData: 260, costGoods: { parts: 30 }, requires: ['constructionRobotics'],
    effects: [{ kind: 'automation' }],
    desc: 'Agent crews for any workstation: switch buildings to run without humans.',
    tradeoff: 'Agents need no habs or food — but draw 60% more power than people.',
  },

  // ─── ERA 4 · EXPORT ECONOMY ───
  foilManufacturing: {
    id: 'foilManufacturing', era: 4, name: 'Thin-Film Foils',
    costData: 440, costGoods: { silicon: 40 }, requires: ['partsFabrication'],
    effects: [{ kind: 'unlock', building: 'foilFactory' }],
    desc: 'Collector foils micrometers thick — sunlight’s future harvest.',
    tradeoff: 'The factory is the single largest power draw you will ever build.',
  },
  massDriver: {
    id: 'massDriver', era: 4, name: 'Electromagnetic Mass Driver',
    costData: 520, costGoods: { parts: 50 }, requires: ['partsFabrication'],
    effects: [{ kind: 'unlock', building: 'massDriver' }],
    desc: 'A rail to orbit. 2.4 km/s and no propellant.',
    tradeoff: 'Site geometry now matters enormously — equatorial bases pull ahead.',
  },
  dustMitigation: {
    id: 'dustMitigation', era: 4, name: 'Dust Mitigation',
    costData: 360, requires: [],
    effects: [
      { kind: 'dustMult', mult: 0.4 },
      { kind: 'upkeepMult', buildings: ['excavator'], mult: 0.5 },
    ],
    desc: 'Electrostatic wands and sealed bearings against the Moon’s knife-dust.',
    tradeoff: 'Research spent on brooms while rivals research rockets.',
  },
  humanCohabitation: {
    id: 'humanCohabitation', era: 4, name: 'Human Cohabitation',
    costData: 420, costGoods: { parts: 30 }, requires: ['thoriumPower'], roboticOnly: true,
    effects: [{ kind: 'unlock', building: 'habitat' }],
    desc: 'Pressurized quarters, storm shelters, medical stores: ready the base for human partners.',
    tradeoff: 'Humans bring the morale work bonus — and lungs, stomachs, and moods to keep alive.',
  },

  // ─── ERA 5 · SELF-REPLICATION ───
  autoFabrication: {
    id: 'autoFabrication', era: 5, name: 'Automated Fabrication',
    costData: 840, costGoods: { parts: 60 }, requires: ['foilManufacturing'],
    effects: [
      { kind: 'outputMult', buildings: ['partsFab', 'foilFactory'], mult: 2 },
      { kind: 'crewDelta', buildings: ['partsFab', 'foilFactory'], delta: -1 },
    ],
    desc: 'Lines that run themselves: double output, one fewer human per line.',
    tradeoff: 'Automation fails ugly — wear costs bite harder when no one is watching.',
  },
  selfReplication: {
    id: 'selfReplication', era: 5, name: 'Self-Replicating Systems',
    costData: 1040, costGoods: { parts: 80 }, requires: ['autoFabrication'],
    effects: [
      { kind: 'outputMult', buildings: ['excavator', 'smelter', 'refinery', 'iceHarvester'], mult: 1.5 },
      { kind: 'upkeepMult', buildings: 'all', mult: 0.75 },
    ],
    desc: 'Machines that maintain and extend machines. The exponential turn.',
    tradeoff: 'Every doubling doubles the blast radius of a single bad batch.',
  },
  hiEffLaunch: {
    id: 'hiEffLaunch', era: 5, name: 'High-Efficiency Launch',
    costData: 960, costGoods: { silicon: 60 }, requires: ['massDriver'],
    effects: [
      { kind: 'powerMult', buildings: ['massDriver'], mult: 0.6 },
      { kind: 'outputMult', buildings: ['massDriver'], mult: 2 },
    ],
    desc: 'Superconducting rails: twice the launch windows at 60% of the power.',
    tradeoff: 'Superconductors demand silicon your foils were counting on.',
  },

  // ─── ERA 6 · DYSON SWARM ───
  swarmProtocol: {
    id: 'swarmProtocol', era: 6, name: 'Swarm Protocol',
    costData: 1400, costGoods: { foils: 5 }, requires: ['hiEffLaunch'],
    effects: [{ kind: 'launchAction' }],
    desc: 'Deployment doctrine for a trillion-collector swarm. LAUNCH is armed.',
    tradeoff: 'The five test foils it consumes never come back.',
  },
  powerBeaming: {
    id: 'powerBeaming', era: 6, name: 'Power Beaming Return',
    costData: 1600, requires: ['swarmProtocol'],
    effects: [{ kind: 'powerBeam' }],
    desc: 'The swarm pays rent: microwave power beamed back to your rectenna.',
    tradeoff: 'Your grid now depends on hardware forty million kilometers away.',
  },
  vonNeumann: {
    id: 'vonNeumann', era: 6, name: 'Von Neumann Foundry',
    costData: 2400, costGoods: { foils: 20 }, requires: ['swarmProtocol'],
    effects: [{ kind: 'outputMult', buildings: ['foilFactory'], mult: 3 }],
    desc: 'Foil factories that seed foil factories. The curve goes vertical.',
    tradeoff: 'A monument to obsolescence: yours, specifically.',
  },
};

export const TECH_ORDER = Object.keys(TECHS) as TechId[];
export const ERA_NAMES: Record<number, string> = {
  1: 'FIRST LANDING', 2: 'SELF-SUFFICIENCY', 3: 'INDUSTRIALIZATION',
  4: 'EXPORT ECONOMY', 5: 'SELF-REPLICATION', 6: 'DYSON SWARM',
};
export const ERA_ADVANCE_COUNT = 2; // techs of era N needed to open era N+1
