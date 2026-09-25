/** The Builder (docs/13-automation-spec.md): the standing-rule table, the
 *  families research unlocks, and the builder's tuning constants. Rules are
 *  data; core/automation.ts runs them and core/siting.ts picks their sites.
 *
 *  Thresholds are stored in each rule's own unit — per game-second for rates
 *  (the UI shows per minute), a fraction for shares, minutes for runways,
 *  plain counts — and every threshold and cap is player-settable within its
 *  range. The families `research` and `export` exist for later work that
 *  extends the Builder (docs/14): no tech in this tree unlocks them. */
import type { BuildingId } from './buildings';
import type { ResourceId } from './resources';

export type AutoFamily =
  | 'excavation' | 'power' | 'smelting' | 'fabrication' | 'life' | 'maintenance' | 'network'
  // extension families: unlocked only through `builder { families }` effects
  | 'research' | 'export';

export type AutoRuleId =
  | 'excavator' | 'iceHarvester'
  | 'solar' | 'battery' | 'reactor'
  | 'smelter' | 'refinery' | 'storageYard'
  | 'partsFab' | 'chipFab' | 'roboticsBay'
  | 'oxygen' | 'food' | 'water' | 'habitat'
  | 'replace'
  | 'relayMast'
  | 'lab' | 'foilFactory';

/** rate: per game-second (shown per minute) · share: a fraction (shown in %) ·
 *  min: minutes · count · kw · none (the rule has no tunable threshold) */
export type RuleUnit = 'rate' | 'share' | 'min' | 'count' | 'kw' | 'none';

export interface RuleDef {
  id: AutoRuleId;
  family: AutoFamily;
  /** what it builds; `producer` = whatever makes `res` here (life support) */
  building: BuildingId | 'producer';
  /** the resource its signal watches (panel placement, balance, input checks) */
  res?: ResourceId;
  /** the objective, as the panel and the resource panels print it */
  objective: string;
  unit: RuleUnit;
  /** trigger T, in the unit (see the rule's signal in core/automation.ts) */
  threshold: number;
  range: [number, number];
  step: number;
  /** re-arm: the signal must come back past this (absolute, or T + rearmDelta) */
  rearm?: number;
  rearmDelta?: number;
  dwellS: number;
  cooldownS: number;
  settleS: number;
  cap: number;
  capRange: [number, number];
  /** switched on when its family unlocks (the reactor's cap of 1 keeps it the player's call) */
  onByDefault: boolean;
}

const R = (d: RuleDef) => d;

/** In table order; rules within a family act in this order. */
export const RULES: Record<AutoRuleId, RuleDef> = {
  excavator: R({
    id: 'excavator', family: 'excavation', building: 'excavator', res: 'regolith',
    objective: 'KEEP regolith supply ≥ demand', unit: 'rate', threshold: -0.1, range: [-1, 0], step: 0.05, rearm: 0,
    dwellS: 60, cooldownS: 120, settleS: 60, cap: 6, capRange: [0, 30], onByDefault: true,
  }),
  iceHarvester: R({
    id: 'iceHarvester', family: 'excavation', building: 'iceHarvester', res: 'water',
    objective: 'KEEP water supply ≥ demand', unit: 'rate', threshold: -0.02, range: [-0.5, 0], step: 0.01, rearm: 0,
    dwellS: 60, cooldownS: 120, settleS: 60, cap: 3, capRange: [0, 12], onByDefault: true,
  }),
  solar: R({
    id: 'solar', family: 'power', building: 'solar',
    objective: 'KEEP the day’s grid margin ≥ T', unit: 'share', threshold: 0.1, range: [0.05, 0.5], step: 0.05, rearmDelta: 0.1,
    dwellS: 30, cooldownS: 60, settleS: 30, cap: 24, capRange: [0, 150], onByDefault: true,
  }),
  battery: R({
    id: 'battery', family: 'power', building: 'battery',
    objective: 'CARRY the night', unit: 'share', threshold: 1, range: [0.5, 1.5], step: 0.1, rearmDelta: 0.1,
    dwellS: 60, cooldownS: 60, settleS: 30, cap: 6, capRange: [0, 40], onByDefault: true,
  }),
  reactor: R({
    id: 'reactor', family: 'power', building: 'reactor',
    objective: 'BASELOAD for the night', unit: 'kw', threshold: 25, range: [5, 100], step: 5,
    dwellS: 120, cooldownS: 600, settleS: 120, cap: 1, capRange: [0, 6], onByDefault: true,
  }),
  smelter: R({
    id: 'smelter', family: 'smelting', building: 'smelter', res: 'metals',
    objective: 'KEEP metals supply ≥ demand (builds included)', unit: 'rate', threshold: 0, range: [-0.5, 0.2], step: 0.05, rearmDelta: 0.05,
    dwellS: 90, cooldownS: 180, settleS: 90, cap: 4, capRange: [0, 12], onByDefault: true,
  }),
  refinery: R({
    id: 'refinery', family: 'smelting', building: 'refinery', res: 'silicon',
    objective: 'KEEP silicon supply ≥ demand (builds included)', unit: 'rate', threshold: 0, range: [-0.5, 0.2], step: 0.05, rearmDelta: 0.05,
    dwellS: 90, cooldownS: 180, settleS: 90, cap: 3, capRange: [0, 12], onByDefault: true,
  }),
  storageYard: R({
    id: 'storageYard', family: 'smelting', building: 'storageYard',
    objective: 'ROOM at the top of every store', unit: 'share', threshold: 0.95, range: [0.7, 1], step: 0.05, rearm: 0.85,
    dwellS: 60, cooldownS: 120, settleS: 30, cap: 4, capRange: [0, 20], onByDefault: true,
  }),
  partsFab: R({
    id: 'partsFab', family: 'fabrication', building: 'partsFab', res: 'parts',
    objective: 'KEEP parts supply ≥ demand', unit: 'rate', threshold: 0, range: [-0.2, 0.1], step: 0.01, rearmDelta: 0.02,
    dwellS: 90, cooldownS: 180, settleS: 90, cap: 3, capRange: [0, 10], onByDefault: true,
  }),
  chipFab: R({
    id: 'chipFab', family: 'fabrication', building: 'chipFab', res: 'chips',
    objective: 'CHIPS for what is queued', unit: 'none', threshold: 0, range: [0, 0], step: 0,
    dwellS: 120, cooldownS: 300, settleS: 120, cap: 3, capRange: [0, 6], onByDefault: true,
  }),
  roboticsBay: R({
    id: 'roboticsBay', family: 'fabrication', building: 'roboticsBay',
    objective: 'NO site waits long for a rover', unit: 'count', threshold: 2, range: [1, 8], step: 1, rearm: 0,
    dwellS: 120, cooldownS: 300, settleS: 60, cap: 3, capRange: [0, 8], onByDefault: true,
  }),
  oxygen: R({
    id: 'oxygen', family: 'life', building: 'producer', res: 'oxygen',
    objective: 'KEEP ≥ T min of oxygen', unit: 'min', threshold: 20, range: [5, 60], step: 5, rearmDelta: 10,
    dwellS: 30, cooldownS: 120, settleS: 60, cap: 5, capRange: [0, 12], onByDefault: true,
  }),
  food: R({
    id: 'food', family: 'life', building: 'producer', res: 'food',
    objective: 'KEEP ≥ T min of food', unit: 'min', threshold: 20, range: [5, 60], step: 5, rearmDelta: 10,
    dwellS: 30, cooldownS: 120, settleS: 60, cap: 4, capRange: [0, 16], onByDefault: true,
  }),
  water: R({
    id: 'water', family: 'life', building: 'producer', res: 'water',
    objective: 'KEEP ≥ T min of water', unit: 'min', threshold: 20, range: [5, 60], step: 5, rearmDelta: 10,
    dwellS: 30, cooldownS: 120, settleS: 60, cap: 3, capRange: [0, 12], onByDefault: true,
  }),
  habitat: R({
    id: 'habitat', family: 'life', building: 'habitat',
    objective: 'A BED for the next settler', unit: 'count', threshold: 1, range: [1, 6], step: 1, rearm: 2,
    dwellS: 120, cooldownS: 300, settleS: 60, cap: 4, capRange: [0, 20], onByDefault: true,
  }),
  replace: R({
    id: 'replace', family: 'maintenance', building: 'producer',
    objective: 'REPLACE machines worn ≥ T for a lunar day', unit: 'share', threshold: 0.4, range: [0.2, 0.8], step: 0.05,
    dwellS: 720, cooldownS: 120, settleS: 0, cap: 1, capRange: [1, 1], onByDefault: true,
  }),
  relayMast: R({
    id: 'relayMast', family: 'network', building: 'relayMast',
    objective: 'REACH the ground the rules need', unit: 'none', threshold: 0, range: [0, 0], step: 0,
    dwellS: 60, cooldownS: 300, settleS: 60, cap: 4, capRange: [0, 20], onByDefault: true,
  }),
  // ── extension families (docs/14 extends the Builder with these) ──
  lab: R({
    id: 'lab', family: 'research', building: 'lab',
    objective: 'LABS when research waits on the transfer cap', unit: 'none', threshold: 0, range: [0, 0], step: 0,
    dwellS: 120, cooldownS: 300, settleS: 60, cap: 4, capRange: [0, 12], onByDefault: true,
  }),
  foilFactory: R({
    id: 'foilFactory', family: 'export', building: 'foilFactory', res: 'foils',
    objective: 'FOILS for every volley', unit: 'none', threshold: 0, range: [0, 0], step: 0,
    dwellS: 120, cooldownS: 300, settleS: 120, cap: 3, capRange: [0, 6], onByDefault: true,
  }),
};

export const RULE_ORDER = Object.keys(RULES) as AutoRuleId[];

export const FAMILY_LABEL: Record<AutoFamily, string> = {
  excavation: 'Excavation', power: 'Power', smelting: 'Smelting', fabrication: 'Fabrication',
  life: 'Life support', maintenance: 'Maintenance', network: 'Network', research: 'Research', export: 'Export',
};

/** upstream first: the default order rules act in (the Budget Governor makes it the player's) */
export const FAMILY_PRIORITY: AutoFamily[] = [
  'life', 'power', 'excavation', 'smelting', 'fabrication', 'maintenance', 'network', 'research', 'export',
];

export const rulesOf = (f: AutoFamily): AutoRuleId[] => RULE_ORDER.filter((r) => RULES[r].family === f);

/** Buildings no standing rule builds — research pace, doctrine and the endgame
 *  stay the player's (the extension families lift labs and foil factories). */
export const NEVER_RULE_BUILT: BuildingId[] = [
  'lander', 'lab', 'dataCenter', 'recDome', 'foilFactory', 'massDriver', 'propellantPlant', 'relayMast',
];

/** Orders place anything a click could, except the Lander, and Relay Masts
 *  until Self-Expanding Base (a mast's placement is a direction). */
export const NOT_ORDERABLE: BuildingId[] = ['lander'];

export const AUTO = {
  /** auto placements per economy tick, across every family */
  maxPerTick: 2,
  /** one-shot orders before Build Orders, held orders with it */
  orderMax: 3,
  bookMax: 4,
  bookOrderMax: 10,
  /** a cancelled auto site (or a demolished building of the type) defers the rule this long */
  vetoS: 720,
  /** refusals raise an alert only after persisting this long */
  refusalAlertS: 60,
  /** lump spending (placements, research goods, claims) is averaged over this long */
  spendSmoothS: 300,
  /** a life-support runway below this is a crisis (Governor: Build next) */
  crisisRunwayS: 300,
  /** parts the builder always leaves above the weld debt */
  partsFloor: 20,
  /** Governor defaults: share of each capped build currency kept back, and chips */
  governorShare: 0.25,
  governorChips: 10,
  /** research goods held back once a queued tech is this far paid (Governor) */
  governorPaid: 0.6,
  /** power headroom the builder wants before it adds a consumer */
  headroom: 1.1,
  /** Self-Expanding Base: a rule stuck without ground this long raises the network rule */
  nositeS: 60,
  /** the log the panel shows */
  logMax: 8,
  /** Maintenance Automation: a tripped overclock re-arms below this wear, with this day margin */
  rearmWear: 0.05,
  rearmMargin: 0.2,
};

/** Each rule's default trigger in words (tech cards, the discovery card, the panel's help). */
export const RULE_TEXT: Record<AutoRuleId, string> = {
  excavator: '+1 Regolith Excavator when regolith demand outruns supply by 6▲/min for 60 s',
  iceHarvester: '+1 Ice Harvester when water demand outruns supply by 1.2≈/min for 60 s',
  solar: '+1 Solar Array when the day’s grid margin is under 10% for 30 s',
  battery: '+1 Battery Bank at dawn after the bank ran dry',
  reactor: 'a Thorium Reactor when the night runs 25 kW short (cap 1: raise it to let the builder add one)',
  smelter: '+1 Regolith Smelter when metals demand, builds included, outruns supply for 90 s',
  refinery: '+1 Silicon Refinery when silicon demand outruns supply for 90 s',
  storageYard: '+1 Storage Yard when a full store idles its producers for 60 s',
  partsFab: '+1 Parts Fabricator when parts demand outruns supply for 90 s',
  chipFab: '+1 Chip Fab when research waits on chips for 120 s',
  roboticsBay: '+1 Robotics Bay when 2 sites wait for a rover for 120 s',
  oxygen: 'the oxygen maker when oxygen would last under 20 min',
  food: '+1 Hydroponics Farm when food would last under 20 min',
  water: 'the water maker when water would last under 20 min',
  habitat: '+1 Habitat Module when no bed is free for the next settler',
  replace: 'a new machine for one worn ≥40% for a lunar day (the old one demolished, ½ refunded)',
  relayMast: '+1 Relay Mast at the network edge when a rule finds no ground for 60 s',
  lab: '+1 Research Lab when research waits on the transfer cap for 120 s',
  foilFactory: '+1 Foil Factory when foils hold a volley back for 120 s',
};
