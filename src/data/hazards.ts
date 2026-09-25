/** Destiny hazards (docs/14 §3): the ids the tech table already names, and
 *  the card lines they will carry. Only the data hooks ship with the destiny
 *  tracks: picks and six lane techs list `exposure` and `guard` effects, and
 *  mods collect them (mods.exposure, mods.guards), but nothing schedules a
 *  hazard yet. Until the hazard phase ships, HAZARDS_LIVE keeps their lines
 *  off every card, so no card promises or threatens what the game does not do. */
import type { BuildingId } from './buildings';

/** false until core/hazards.ts runs: exposure, guard and hazard-rate lines stay off the cards */
export const HAZARDS_LIVE = false;

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

/** the side each hazard belongs to (the scheduler's round-robin, §3.2) */
export const HAZARD_SIDE: Record<HazardId, 'colony' | 'automation'> = {
  cascade: 'colony', breach: 'colony', blight: 'colony', contamination: 'colony', dose: 'colony',
  cabinFever: 'colony', dust: 'colony', controlPlane: 'automation', malware: 'automation', firmware: 'automation',
  rogueDrones: 'automation', runaway: 'automation', hackedOutpost: 'automation',
};

/** pressurized types before `pressureHalls` adds its three (§3.4) */
export const PRESSURIZED: readonly BuildingId[] = ['habitat', 'hydroponics', 'recDome', 'greenhouseRing', 'gardenDome'];
