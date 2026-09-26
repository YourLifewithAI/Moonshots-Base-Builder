/** Destiny hazards (docs/14 §3): the data. ⌂ Colony faces the environment
 *  (it can kill crew), ◉ Automation the network (it destroys machines, data
 *  and stock for good). Every hazard is telegraphed, names its target and
 *  offers a counter; its kind and target are deterministic; a death or a loss
 *  comes only from a warning ignored or a counter that failed or came late,
 *  and never without a visible clock. Every lethal hazard has a free counter
 *  that saves the people, and every destructive one a free counter that saves
 *  the machines. The first of each kind is a drill that cannot kill.
 *  The engine is core/hazards.ts; the picks and six lane techs carry the
 *  `exposure` and `guard` effects that mods collect (mods.exposure,
 *  mods.guards, mods.hazardRateMult). */
import type { BuildingId } from './buildings';
import { CYCLE_S } from './balance';

/** true: the scheduler runs, and exposure, guard and hazard-rate lines show on the cards */
export const HAZARDS_LIVE = true;

export type HazardSide = 'colony' | 'automation';

export type HazardId =
  // ⌂ Colony: the environment gets in (§3.4)
  | 'cascade' | 'breach' | 'blight' | 'contamination' | 'dose' | 'cabinFever' | 'dust'
  // ◉ Automation: the network gets in (§3.5)
  | 'controlPlane' | 'malware' | 'firmware' | 'rogueDrones' | 'runaway' | 'hackedOutpost';

export type GuardId =
  // pick guards (§3.6)
  | 'suitports' | 'earthContact' | 'commonsMeals' | 'seedBank' | 'stormShelters' | 'bulkheads' | 'launchDays'
  | 'hiveReflash' | 'signedFirmware' | 'intrusionDetection' | 'watchdogs' | 'attestation'
  // lane-tech guards: both sides can use them
  | 'micrometeoriteShield' | 'dustScreens' | 'radHard' | 'governorFloors' | 'closedLoop' | 'safety';

/** Every counter is one action (`{ kind: 'counter', counter, id }`, §3.7).
 *  `id` is the live hazard's id for hazard counters, the building's for
 *  building counters (clean, reimage, repair), and optional for base ones. */
export type CounterId =
  | 'seal' | 'evacuate' | 'repair'                 // BREACH
  | 'shedLoads'                                    // LIFE-SUPPORT CASCADE
  | 'quarantine'                                   // BLIGHT
  | 'flush'                                        // CONTAMINATION
  | 'recallEva' | 'medevac'                        // DOSE
  | 'commonsNight' | 'callHome'                    // CABIN FEVER
  | 'clean'                                        // DUST
  | 'landDrones'                                   // CONTROL PLANE
  | 'reimage' | 'patch'                            // MALWARE (and Air-gap, its own action)
  | 'holdRollout' | 'dockFleet'                    // FIRMWARE
  | 'killSwitch'                                   // ROGUE DRONES
  | 'freezeRules'                                  // RUNAWAY RULE
  | 'rotateKeys';                                  // HACKED OUTPOST

/** 0 minor (2–3 picks) · 1 moderate (4–5) · 2 major (6–8) */
export type Tier = 0 | 1 | 2;
export const TIER_LABEL = ['minor', 'moderate', 'major'] as const;

/** How the scheduler meets a kind (§3.2): windows are scheduled; events
 *  come from a brownout; flare kinds ride the flare's own telegraph;
 *  ambient and meter kinds build up over time. */
export type HazardClass = 'window' | 'event' | 'flare' | 'ambient' | 'meter';

export const HAZARD_NAME: Record<HazardId, string> = {
  cascade: 'LIFE-SUPPORT CASCADE', breach: 'BREACH', blight: 'BLIGHT', contamination: 'CONTAMINATION',
  dose: 'DOSE', cabinFever: 'CABIN FEVER', dust: 'DUST', controlPlane: 'CONTROL PLANE', malware: 'MALWARE',
  firmware: 'FIRMWARE', rogueDrones: 'ROGUE DRONES', runaway: 'RUNAWAY RULE', hackedOutpost: 'HACKED OUTPOST',
};

/** what an exposure line says the pick puts at risk, and what ignoring it costs */
export const EXPOSURE_TEXT: Record<HazardId, { what: string; cost: string }> = {
  cascade: { what: 'habitats need power at night', cost: 'a dark habitat can kill' },
  breach: { what: 'hold air', cost: 'a breach can kill' },
  blight: { what: 'farms within 24 m share air', cost: 'a blight can starve the crew' },
  contamination: { what: 'the water loop can foul', cost: 'poisoned water can kill' },
  dose: { what: 'EVA crews are caught by flares', cost: 'a dose can kill' },
  cabinFever: { what: 'the crew grows restless', cost: 'a crisis sends people home' },
  dust: { what: 'take in airlock dust', cost: 'clogged filters wear the hull' },
  controlPlane: { what: 'agent-run stations halve while no Data Center runs', cost: 'drones in flight can fall' },
  malware: { what: 'are network nodes', cost: 'an infected node can burn out' },
  firmware: { what: 'every drone takes the same push', cost: 'a bricked rover can be lost' },
  rogueDrones: { what: 'hijacked drones strip buildings', cost: 'a stripped building is wrecked' },
  runaway: { what: 'replicators follow the rules', cost: 'a hijacked rule wastes stock' },
  hackedOutpost: { what: 'outposts ride the Earth link', cost: 'a hacked outpost can be lost' },
};

/** the `⚠ risk` line a pick's discovery card shows (§3.10 rule 3) */
export const RISK_TEXT: Record<HazardId, string> = {
  cascade: 'This can kill: a habitat left dark at night leaves its crew on suit air.',
  breach: 'This can kill: pressurized halls can breach.',
  blight: 'This can kill: a blight left to spread starves the crew.',
  contamination: 'This can kill: a fouled water loop poisons the crew.',
  dose: 'This can kill: a crew caught outside by a flare takes a dose.',
  cabinFever: 'People can quit: a cabin-fever crisis sends crew home.',
  dust: 'Airlock dust clogs the filters and wears the hull toward a breach.',
  controlPlane: 'This can destroy: drones in flight fall when the control plane drops.',
  malware: 'This can destroy: an infected node can burn out, and ransomware wipes data.',
  firmware: 'This can destroy: a bricked rover not re-flashed in time is lost.',
  rogueDrones: 'This can destroy: hijacked drones strip a building to scrap.',
  runaway: 'This can destroy: a hijacked rule welds junk and wastes the stock.',
  hackedOutpost: 'This can destroy: a hacked outpost can be flown into the ground.',
};

export const GUARD_TEXT: Record<GuardId, string> = {
  suitports: 'Suitports: DUST ×0.5',
  earthContact: 'Earth contact: each rotation or resupply eases CABIN FEVER by 15',
  commonsMeals: 'Commons meals: CABIN FEVER −10/day while a farm runs',
  seedBank: 'Seed bank: a quarantined farm regrows in 60 s',
  stormShelters: 'Storm shelters: EVA recalls itself on the flare warning; doses ×0.5',
  bulkheads: 'Pressure bulkheads: a BREACH kills no one and seals itself in 30 s',
  launchDays: 'Launch days: each volley eases CABIN FEVER by 30',
  hiveReflash: 'Hive re-flash: a Drone Hive re-flashes 2 rovers per 30 s',
  signedFirmware: 'Signed firmware: a failed rollout holds itself',
  intrusionDetection: 'Intrusion detection: MALWARE warnings ×2; a new infection isolates itself for 30 s',
  watchdogs: 'Watchdogs and failover: Reimage in 20 s; the Lander carries the CONTROL PLANE for 120 s',
  attestation: 'Rule attestation: a drifting rule stops after 1 site',
  micrometeoriteShield: 'BREACH: micrometeorite pitting ×0.5',
  dustScreens: 'DUST in the airlocks ×0.4',
  radHard: 'flare bit flips ×0.5',
  governorFloors: 'a drifting rule never spends below your floors',
  closedLoop: 'CONTAMINATION clears itself in 60 s; CASCADE grace and suit air +30 s',
  safety: 'Colony hazard warnings last ×1.5',
};

/** the hazard each guard answers (the Hazards panel's guard column) */
export const GUARD_FOR: Record<GuardId, HazardId> = {
  suitports: 'dust', earthContact: 'cabinFever', commonsMeals: 'cabinFever', seedBank: 'blight',
  stormShelters: 'dose', bulkheads: 'breach', launchDays: 'cabinFever', hiveReflash: 'firmware',
  signedFirmware: 'firmware', intrusionDetection: 'malware', watchdogs: 'controlPlane', attestation: 'runaway',
  micrometeoriteShield: 'breach', dustScreens: 'dust', radHard: 'firmware', governorFloors: 'runaway',
  closedLoop: 'contamination', safety: 'breach',
};

/** the side each hazard belongs to (the scheduler's round-robin, §3.2) */
export const HAZARD_SIDE: Record<HazardId, HazardSide> = {
  cascade: 'colony', breach: 'colony', blight: 'colony', contamination: 'colony', dose: 'colony',
  cabinFever: 'colony', dust: 'colony', controlPlane: 'automation', malware: 'automation', firmware: 'automation',
  rogueDrones: 'automation', runaway: 'automation', hackedOutpost: 'automation',
};

/** pressurized types before `pressureHalls` adds its three (§3.4) */
export const PRESSURIZED: readonly BuildingId[] = ['habitat', 'hydroponics', 'recDome', 'greenhouseRing', 'gardenDome'];

/** network nodes before the exposures add fabs and launchers (§3.5); every
 *  agent-run station joins them while ◉ picks ≥ 2 */
export const NETWORK_NODES: readonly BuildingId[] = ['lander', 'relayMast', 'dataCenter', 'serverMonolith', 'roboticsBay', 'droneHive'];

/** One kind: side, class, the tier it needs, what it names, what ignoring it
 *  costs by tier, its counters (paid first, the free one last), what the
 *  next one will do after the drill, and the near-miss news. */
export interface HazardDef {
  id: HazardId;
  side: HazardSide;
  cls: HazardClass;
  /** the lowest tier it comes at (rogue drones, runaway and outposts: moderate) */
  minTier: Tier;
  glyph: string;
  /** can kill (⌂) · can destroy (◉) when ignored */
  lethal?: true;
  destroys?: true;
  counters: CounterId[];
  /** the counter that saves the people (⌂) or the machines (◉), and needs nothing */
  free: CounterId | 'airGap' | null;
  /** what ignoring it costs, by tier */
  ignored: [string, string, string];
  /** the drill card's last line: what the next one will do */
  drillNext: string;
  /** the near-miss event (risk under 0.2): {t} is the target */
  nearMiss: string;
}

export const HAZARDS: Record<HazardId, HazardDef> = {
  breach: {
    id: 'breach', side: 'colony', cls: 'window', minTier: 0, glyph: '≋', lethal: true,
    counters: ['seal', 'evacuate'], free: 'evacuate',
    ignored: ['it vents air until sealed', 'people inside will die', 'people inside will die'],
    drillNext: 'This one was a drill. Next time, the people inside die if the breach is not sealed or evacuated in time.',
    nearMiss: 'SEALS HELD — {t}’s seals were renewed in time; nothing vented',
  },
  cascade: {
    id: 'cascade', side: 'colony', cls: 'event', minTier: 0, glyph: '☍', lethal: true,
    counters: ['shedLoads'], free: 'shedLoads',
    ignored: ['crew go on suit air', 'crew on suit air will die', 'crew on suit air will die'],
    drillNext: 'This one was a drill. Next time, crew left on suit air die when it runs out with their habitat still dark.',
    nearMiss: 'SCRUBBERS HELD — {t} kept its power',
  },
  blight: {
    id: 'blight', side: 'colony', cls: 'window', minTier: 0, glyph: '✲', lethal: true,
    counters: ['quarantine'], free: 'quarantine',
    ignored: ['the farm yields −40%', 'it spreads; famine can kill', 'it spreads fast; famine can kill'],
    drillNext: 'This one was a drill. Next time, a blight left alone spreads through every farm within 24 m.',
    nearMiss: 'CROPS CLEAN — the farms are spaced well; no blight took hold',
  },
  contamination: {
    id: 'contamination', side: 'colony', cls: 'window', minTier: 0, glyph: '≈', lethal: true,
    counters: ['flush'], free: 'flush',
    ignored: ['farms and morale drop; poisoning after 3 days', 'poisoning after 2 days can kill', 'poisoning after 1 day can kill'],
    drillNext: 'This one was a drill. Next time, an unflushed loop makes the crew sick, then poisons them.',
    nearMiss: 'WATER CLEAN — the assay came back clean',
  },
  dose: {
    id: 'dose', side: 'colony', cls: 'flare', minTier: 0, glyph: '☢', lethal: true,
    counters: ['recallEva'], free: 'recallEva',
    ignored: ['a dose keeps crew off work', 'a dose keeps crew off work', 'a dose can kill'],
    drillNext: 'This one was a drill. Next time, a crew caught outside can take a lethal dose.',
    nearMiss: 'EVA CLEAR — nobody was outside',
  },
  cabinFever: {
    id: 'cabinFever', side: 'colony', cls: 'meter', minTier: 0, glyph: '◐',
    counters: ['commonsNight', 'callHome'], free: null,
    ignored: ['a crisis: a strike and −20 morale', 'a crisis: a strike and −20 morale', 'a crisis: a strike and −20 morale'],
    drillNext: 'This one was a drill. Next time, a crisis sets a station on strike, and two crises send crew home.',
    nearMiss: 'SPIRITS HOLD — the crew is steady',
  },
  dust: {
    id: 'dust', side: 'colony', cls: 'ambient', minTier: 0, glyph: '∴',
    counters: ['clean'], free: null,
    ignored: ['clogged filters: upkeep ×2 and wear', 'clogged filters: upkeep ×2 and wear', 'clogged filters: upkeep ×2 and wear'],
    drillNext: 'Next time, clogged filters double the upkeep and wear the hull toward a breach.',
    nearMiss: 'AIRLOCKS CLEAN',
  },
  controlPlane: {
    id: 'controlPlane', side: 'automation', cls: 'event', minTier: 0, glyph: '⌬', destroys: true,
    counters: ['landDrones'], free: 'landDrones',
    ignored: ['agent-run output ×0.7', 'agent-run output ×0.5', 'drones in flight fall and are lost'],
    drillNext: 'This one was a drill. Next time, at major tier, drones in flight fall when the control plane drops.',
    nearMiss: 'CONTROL PLANE HELD',
  },
  malware: {
    id: 'malware', side: 'automation', cls: 'window', minTier: 0, glyph: '⚠', destroys: true,
    counters: ['reimage', 'patch'], free: 'airGap',
    ignored: ['infected nodes halve and spread', 'ransomware wipes 15% of banked data a day', 'an infected node burns out'],
    drillNext: 'This one was a drill. Next time, ransomware wipes banked data, and at major tier an infected node burns out.',
    nearMiss: 'FIREWALL HELD — the probe found nothing to take',
  },
  firmware: {
    id: 'firmware', side: 'automation', cls: 'window', minTier: 0, glyph: '⟲', destroys: true,
    counters: ['holdRollout'], free: 'holdRollout',
    ignored: ['30% of rovers bricked', '50% bricked; drones in flight fall', '70% bricked; drones in flight fall'],
    drillNext: 'This one was a drill. Next time, a rover still bricked at its re-flash deadline is lost.',
    nearMiss: 'ROLLOUT CLEAN — the canary passed',
  },
  rogueDrones: {
    id: 'rogueDrones', side: 'automation', cls: 'window', minTier: 1, glyph: '✈', destroys: true,
    counters: ['killSwitch'], free: 'killSwitch',
    ignored: ['—', 'the target is stripped and wrecked', 'two targets stripped and wrecked'],
    drillNext: 'This one was a drill. Next time, the drones strip their target to scrap: wrecked, no refund.',
    nearMiss: 'DOCKS SECURE — the drones answered their own keys',
  },
  runaway: {
    id: 'runaway', side: 'automation', cls: 'window', minTier: 1, glyph: '∞', destroys: true,
    counters: ['freezeRules'], free: 'freezeRules',
    ignored: ['—', '4 junk sites: half their stock wasted', '8 junk sites: half their stock wasted'],
    drillNext: 'This one was a drill. Next time, the drifting rule welds junk, and half its stock is gone for good.',
    nearMiss: 'RULES ATTESTED — every cap read true',
  },
  hackedOutpost: {
    id: 'hackedOutpost', side: 'automation', cls: 'window', minTier: 1, glyph: '⊘', destroys: true,
    counters: ['rotateKeys'], free: null,
    ignored: ['—', 'the stream stops', 'the stream stops; the outpost is lost after a day'],
    drillNext: 'This one was a drill. Next time, at major tier, a hacked outpost is flown into the ground after a day.',
    nearMiss: 'KEYS HELD — the uplinks answered true',
  },
};

/** table order: ties in risk go to the earlier kind (§3.2) */
export const HAZARD_ORDER: readonly HazardId[] = [
  'breach', 'blight', 'contamination', 'cascade', 'dose', 'cabinFever', 'dust',
  'malware', 'firmware', 'rogueDrones', 'runaway', 'hackedOutpost', 'controlPlane',
];

export interface CounterDef {
  id: CounterId;
  name: string;
  /** the button's cost text: '12⚙', 'free' */
  cost: string;
  /** needs nothing and saves the people (⌂) or the machines (◉) */
  free: boolean;
  /** what the button's `id` names */
  scope: 'hazard' | 'building' | 'base';
  hazard: HazardId;
  desc: string;
}

export const COUNTERS: Record<CounterId, CounterDef> = {
  seal: { id: 'seal', name: 'Seal', cost: 'the tier’s ⚙', free: false, scope: 'hazard', hazard: 'breach',
    desc: 'The nearest rover seals the hull in 20 s: start it 20 s before the deadline. Saves the people and the hall.' },
  evacuate: { id: 'evacuate', name: 'Evacuate', cost: 'free', free: true, scope: 'hazard', hazard: 'breach',
    desc: 'Everyone inside moves out: the beds stay off until it is sealed. Saves the people.' },
  repair: { id: 'repair', name: 'Repair', cost: '30⚙', free: false, scope: 'building', hazard: 'breach',
    desc: 'A decompressed section back on line.' },
  shedLoads: { id: 'shedLoads', name: 'Shed loads', cost: 'free', free: true, scope: 'base', hazard: 'cascade',
    desc: 'Every priority 2–3 load off for 120 s, so the bank feeds priority 0. Saves the people.' },
  quarantine: { id: 'quarantine', name: 'Quarantine', cost: 'the crop', free: true, scope: 'hazard', hazard: 'blight',
    desc: 'Burn the crop (it regrows in 150 s, 60 s with a seed bank) and stop the spread.' },
  flush: { id: 'flush', name: 'Flush', cost: '30% of ≈', free: true, scope: 'base', hazard: 'contamination',
    desc: 'Dump 30% of the water and reset the loop. Always possible. Saves the people.' },
  recallEva: { id: 'recallEva', name: 'Recall EVA', cost: 'free', free: true, scope: 'base', hazard: 'dose',
    desc: 'Everyone outside comes in: the EVA bonus stops for the flare. Saves the people.' },
  medevac: { id: 'medevac', name: 'Medevac', cost: 'the shipment slot', free: false, scope: 'hazard', hazard: 'dose',
    desc: 'The Earth shipment slot flies a lethally dosed crew member home alive.' },
  commonsNight: { id: 'commonsNight', name: 'Commons night', cost: '30✳', free: false, scope: 'base', hazard: 'cabinFever',
    desc: 'A feast in the commons: cabin fever −20.' },
  callHome: { id: 'callHome', name: 'Call home', cost: '60≡', free: false, scope: 'base', hazard: 'cabinFever',
    desc: 'A call to Earth from the Lander: cabin fever −25, once a lunar day.' },
  clean: { id: 'clean', name: 'Clean', cost: '5⚙', free: false, scope: 'building', hazard: 'dust',
    desc: 'New airlock filters.' },
  landDrones: { id: 'landDrones', name: 'Land drones', cost: 'free', free: true, scope: 'base', hazard: 'controlPlane',
    desc: 'Drones set down and wait out the control plane. Saves the machines.' },
  reimage: { id: 'reimage', name: 'Reimage', cost: '40≡ · 60 s offline', free: false, scope: 'building', hazard: 'malware',
    desc: 'Wipe and reload one node: clean, and 60 s offline (20 s with Watchdogs).' },
  patch: { id: 'patch', name: 'Patch', cost: '200≡ · 120 s', free: false, scope: 'base', hazard: 'malware',
    desc: 'At a running Data Center or Monolith: every node cleaned, and immune for a lunar day.' },
  holdRollout: { id: 'holdRollout', name: 'Hold rollout', cost: 'free', free: true, scope: 'hazard', hazard: 'firmware',
    desc: 'The update never leaves the canary. Saves the machines.' },
  dockFleet: { id: 'dockFleet', name: 'Dock fleet', cost: 'free', free: true, scope: 'hazard', hazard: 'firmware',
    desc: 'Every rover goes home: construction pauses for the flare. Saves the machines.' },
  killSwitch: { id: 'killSwitch', name: 'Kill switch', cost: 'free', free: true, scope: 'hazard', hazard: 'rogueDrones',
    desc: 'The dock offline 60 s and its rovers home. Saves the machines.' },
  freezeRules: { id: 'freezeRules', name: 'Freeze rules', cost: 'free', free: true, scope: 'base', hazard: 'runaway',
    desc: 'Every Builder rule off for 120 s. Saves the stock.' },
  rotateKeys: { id: 'rotateKeys', name: 'Rotate keys', cost: '5▣', free: false, scope: 'hazard', hazard: 'hackedOutpost',
    desc: 'New keys for every uplink, before or during.' },
};

/** Magnitudes (§3.3), game-seconds and per-second rates. Index by Tier. */
export const HZ = {
  /** nothing before Era 3 opens plus a lunar day */
  startDelayS: CYCLE_S,
  /** the window interval in lunar days by era */
  intervalDays: { 3: 1.6, 4: 1.6, 5: 1.3, 6: 1.3, 7: 1.0, 8: 1.0 } as Record<number, number>,
  /** ×clamp(sizeBase / structures, sizeClamp): a big base sees windows more often */
  sizeBase: 30, sizeClamp: [0.75, 1.25] as const,
  jitterDays: 0.25,
  /** no new hazard within gapS of another's start, of a flare's active phase, or flareGapS after one */
  gapS: 240, flareGapS: 90,
  nearMiss: 0.2,
  /** a kind that fired the side's last window counts this share of its risk (variety) */
  repeatMult: 0.5,
  telegraphS: [150, 120, 90] as const,
  drillExtraS: 60,
  /** a drill's effect lasts at most this long (it cannot kill or destroy) */
  drillS: 180,
  /** Safety Protocols: Colony telegraphs ×1.5 */
  safetyMult: 1.5,
  /** a death: morale −15 at once (economy's CREW LOST), grief −10 on the target a lunar day, to −30 */
  grief: { morale: 10, max: 30, s: CYCLE_S, now: 15 },
  /** a machine loss: the Builder's rules pause 120 s, the lost family's rule vetoed a lunar day */
  audit: { freezeS: 120, vetoS: CYCLE_S },
  /** a dock prints a lost rover's replacement, one at a time */
  reprint: { metals: 10, parts: 15, s: 120 },
  /** the hazard log keeps this many (the panel shows 8) */
  logMax: 40,

  breach: {
    vent: [0.3, 0.6, 1.0] as const, seal: [8, 12, 20] as const, sealS: 20, deaths: [0, 1, 2] as const,
    decompressS: 120, repair: 30, bulkheadSealS: 30, bulkheadVent: 0.5, pitting: 0.15, wearK: 1.5,
  },
  cascade: {
    alarmS: 20, suitAir: [180, 120, 90] as const, closedLoopS: 30, cap: [1, 2, 99] as const, evacHoldS: 90,
    deathEveryS: 30, shedS: 120, o2Mult: 1.3,
  },
  blight: { output: [0.6, 0.4, 0.2] as const, spreadS: [0, 180, 120] as const, clusterM: 24, clearS: CYCLE_S, commons: 1.5 },
  contamination: {
    output: [0.7, 0.5, 0.3] as const, morale: [6, 10, 14] as const, poisonDays: [3, 2, 1] as const, sickDays: 1,
    sickShare: 0.25, lossPerMin: 0.01, flush: 0.3, closedLoopS: 60, criticalS: 180, coldTrap: 1.3,
    source: { ice: 1, volatiles: 0.8, smelter: 0.5 },
  },
  dose: {
    offDays: [0.5, 1, 1.5] as const, morale: 5, walkInS: 20, lethalShare: [0, 0, 1 / 3] as const, limit: 6, warnAt: 5,
    shelter: 0.5, criticalS: 180,
  },
  cabinFever: {
    rise: [10, 15, 20] as const, crowd: 10, domeEase: 10, domeMax: 30, commons: 10, earthContact: 15, warnAt: 70,
    reset: 40, morale: 20, crisisS: 360, commonsNight: { food: 30, ease: 20 }, callHome: { data: 60, ease: 25 },
    launchDays: 30, windowDays: 3, leave: 2, minCrew: 2,
  },
  dust: { perSource: 0.25, perEva: 0.05, radiusM: 30, warnAt: 0.7, clean: 5, clogUpkeep: 2, clogWear: 0.1, screens: 0.4, suitports: 0.5 },
  controlPlane: { darkS: 15, output: [0.7, 0.5, 0.4] as const, resumeS: 30, failoverS: 120, holdS: 120 },
  malware: {
    cap: [3, 6, 99] as const, spreadS: [60, 40, 25] as const, output: 0.5, draw: 1.3, linkM: 45, hubM: 60,
    reimage: { data: 40, s: 60, watchdogS: 20 }, patch: { data: 200, s: 120, immuneS: CYCLE_S },
    ransom: 0.15, isolateS: 30, nodesPerRisk: 12, supplyChain: 0.2, criticalS: 180, detectMult: 2,
  },
  firmware: { minRovers: 4, share: [0.3, 0.5, 0.7] as const, deadline: [480, 360, 240] as const, reflashS: 30, radHard: 0.5 },
  rogueDrones: { rangeM: 60, stripPerS: 0.01, killS: 60, targets: [0, 1, 2] as const },
  runaway: { sites: [0, 4, 8] as const, everyS: 20, weldS: 20, replicator: 1.5 },
  hackedOutpost: { chips: 5, lossS: CYCLE_S },
};
