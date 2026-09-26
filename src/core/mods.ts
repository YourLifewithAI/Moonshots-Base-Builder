/** Tech-effect modifiers, recomputed whenever a tech completes or an outpost
 *  goes live / is abandoned. The economy consults this instead of re-scanning
 *  tech defs every tick; effectiveDef/effectiveRates give every reader (sim,
 *  palette, inspector, previews) the same numbers. */
import { BUILDINGS, type BuildingDef, type BuildingId } from '../data/buildings';
import { TECHS, effectApplies, type Expedition, type RecipeOverride, type TechId } from '../data/techs';
import type { GuardId, HazardId } from '../data/hazards';
import type { SiteDef, SiteId } from '../data/sites';
import type { ResourceId } from '../data/resources';
import { FEED_KINDS, emptyFeed, type FeedGrade, type FeedKind } from '../data/deposits';
import { OUTPOST_LINK_KW } from '../data/lunarMap';
import {
  AGENT_GEN_TAX, AGENT_TAX, BATTERY_EFF, DC_DATA_PER_S, DEPOSIT_FX, FEED, LAB_DATA, LAUNCH_CAP_PER_VOLLEY, MONOLITH,
  OVERCLOCK, SURVEY_TIERS, WEAR,
} from '../data/balance';
import type { BuildingState, GameState, OutpostState } from './state';
import { AUTO, type AutoFamily } from '../data/automation';

export type ActionId = 'overclock' | 'downlink';
export type SurveyTier = 0 | 1 | 2 | 3 | 4;

export interface Mods {
  outputMult: Record<BuildingId, number>;
  inputMult: Record<BuildingId, number>;
  powerMult: Record<BuildingId, number>;
  upkeepMult: Record<BuildingId, number>;
  crewDelta: Record<BuildingId, number>;
  /** outputMult with crewedOnly: applied only while the station is crewed */
  crewedOutputMult: Record<BuildingId, number>;
  dustMult: number;
  buildSpeedMult: number;
  botPerBay: number;
  launchArmed: boolean;
  powerBeam: boolean;
  automation: boolean;
  grading: boolean;
  unlocked: Set<BuildingId>;
  /** recipe overrides (inputs / outputs / powerKW / feedInsensitive), merged field-wise */
  recipe: Partial<Record<BuildingId, RecipeOverride>>;
  /** agent-run crewed stations draw ×(1 + agentTax) */
  agentTax: number;
  constructionKWMult: number;
  weldRateMult: number;
  weldPartsMult: number;
  batteryCapMult: number;
  /** grid-wide charge efficiency (replaces BATTERY_EFF) */
  storageEff: number;
  repairMult: number;
  solarShadeImmune: boolean;
  /** build time multiplier for new placements, per type */
  buildTimeMult: Record<BuildingId, number>;
  actions: Set<ActionId>;
  surveyTier: SurveyTier;
  /** survey data multiplier that always applies */
  surveyDataMult: number;
  /** survey data multiplier that applies while s.crew ≥ surveyMinCrew */
  surveyCrewDataMult: number;
  surveyMinCrew: number;
  /** from the tier; ATLAS adds its extra slot at runtime */
  outpostSlots: number;
  /** flat kW added to powerKW before powerMult (a negative Lander becomes a draw) */
  powerDelta: Record<BuildingId, number>;
  nightDrawMult: number;
  dayDrawMult: number;
  /** multiplies each deposit's positive feed coefficient */
  feedBonus: Record<FeedKind, number>;
  /** beds added to each building of a type that houses (effectiveDef.housing) */
  housingDelta: Record<BuildingId, number>;
  /** morale added while each building of a type runs (effectiveDef.moraleDelta) */
  moraleDelta: Record<BuildingId, number>;
  /** a live, fuelled KREEP outpost: reactor upkeep ×0.6 (see reactorUpkeepFactor), output ×1.15, chipFab ×1.1 */
  kreepOutpost: boolean;
  /** excavator haul cycle (core/haul.ts): drive speed and bucket size */
  haulSpeedMult: number;
  haulBucketMult: number;
  /** the roadway tier (core/roads.ts, docs/15-roads.md): travel speed on
   *  roads (all, excavators alone, at night), road dust, sintering time a cell */
  roadSpeedMult: number;
  roadHaulMult: number;
  roadNightMult: number;
  roadDustMult: number;
  roadCellMult: number;
  // ── the Builder (docs/13, core/automation.ts) ──
  /** held orders the order book keeps (0 = one-shot orders only) */
  orderBook: number;
  /** most sites one order may ask for */
  orderMax: number;
  /** families of standing rules unlocked */
  autoFamilies: Set<AutoFamily>;
  /** Site Survey AI: sites weigh deposits, peaks of light and haul lanes */
  siteSurvey: boolean;
  /** Budget Governor: floors, priorities, crisis sites first */
  governor: boolean;
  /** Predictive Scheduling (needs an operating Data Center to act) */
  predictive: boolean;
  /** Feed Planner re-aims excavators */
  feedPlanner: boolean;
  /** Maintenance Automation: the wear that marks a machine for replacement (0 = off) */
  maintenanceWear: number;
  /** extension points (docs/14 Automation picks): rule dwell and cap multipliers */
  builderDwellMult: number;
  builderCapMult: number;
  /** Selenic Mind: standing rules may build the destiny buildings too */
  builderAll: boolean;
  // ── destiny (docs/14 §2.7) ──
  /** crew growth period multiplier (0 = no new settlers are invited) */
  growthMult: number;
  /** charter requirements waived (robotic Era 7's Human Cohabitation) */
  waived: Set<TechId>;
  /** share of free hands out on EVA by day (0 = none) */
  evaShare: number;
  /** build-network radius added per building type (m) */
  radiusDelta: Record<BuildingId, number>;
  /** ↑ a volley needs when enough crew are on console (else LAUNCH_CAP_PER_VOLLEY) */
  volleyCap: number;
  /** morale for a lunar day after each crewed volley */
  volleyMorale: number;
  /** crew on console for the crewed volley (0 = none needed) */
  volleyMinCrew: number;
  /** volleys fire themselves when ready (economy step 10.5) */
  autoLaunch: boolean;
  launchBurstMult: number;
  /** morale target everywhere */
  moraleBase: number;
  /** hazard hooks (data/hazards.ts; read by core/hazards.ts) */
  hazardRateMult: number;
  guards: Set<GuardId>;
  exposure: Map<HazardId, Set<BuildingId>>;
}

const IDS = Object.keys(BUILDINGS) as BuildingId[];
const fill = (v: number) => Object.fromEntries(IDS.map((b) => [b, v])) as Record<BuildingId, number>;

export function computeMods(
  techsDone: readonly TechId[],
  expedition: Expedition = 'human',
  siteId: SiteId | null = null,
  outposts: readonly OutpostState[] = [],
): Mods {
  const m: Mods = {
    outputMult: fill(1), inputMult: fill(1), powerMult: fill(1), upkeepMult: fill(1),
    crewDelta: fill(0), crewedOutputMult: fill(1),
    dustMult: 1,
    buildSpeedMult: 1,
    botPerBay: 0,
    launchArmed: false,
    powerBeam: false,
    automation: false,
    grading: false,
    // robots need no quarters and grow no food: habitat and hydroponics wait
    // for Human Cohabitation on robotic runs
    unlocked: new Set(IDS.filter((b) => BUILDINGS[b].unlockedFromStart &&
      !(expedition === 'robotic' && (b === 'habitat' || b === 'hydroponics')))),
    recipe: {},
    agentTax: AGENT_TAX,
    constructionKWMult: 1, weldRateMult: 1, weldPartsMult: 1,
    batteryCapMult: 1, storageEff: BATTERY_EFF,
    repairMult: 1,
    solarShadeImmune: false,
    buildTimeMult: fill(1),
    actions: new Set(),
    surveyTier: 0, surveyDataMult: 1, surveyCrewDataMult: 1, surveyMinCrew: 0,
    outpostSlots: 0,
    powerDelta: fill(0),
    nightDrawMult: 1, dayDrawMult: 1,
    feedBonus: Object.fromEntries(FEED_KINDS.map((k) => [k, 1])) as Record<FeedKind, number>,
    housingDelta: fill(0), moraleDelta: fill(0),
    kreepOutpost: false,
    haulSpeedMult: 1, haulBucketMult: 1,
    roadSpeedMult: 1, roadHaulMult: 1, roadNightMult: 1, roadDustMult: 1, roadCellMult: 1,
    orderBook: 0, orderMax: AUTO.orderMax, autoFamilies: new Set(), siteSurvey: false, governor: false,
    predictive: false, feedPlanner: false, maintenanceWear: 0, builderDwellMult: 1, builderCapMult: 1,
    builderAll: false,
    growthMult: 1, waived: new Set(), evaShare: 0, radiusDelta: fill(0),
    volleyCap: LAUNCH_CAP_PER_VOLLEY, volleyMorale: 0, volleyMinCrew: 0, autoLaunch: false, launchBurstMult: 1,
    moraleBase: 0, hazardRateMult: 1, guards: new Set(), exposure: new Map(),
  };

  // a Server Monolith counts as a Data Center wherever one is read (docs/14
  // §2.8): a tech that changes Data Centers' output, power or upkeep changes
  // Monoliths' too, unless it names the Monolith itself
  const compute = (list: readonly BuildingId[]) =>
    list.includes('dataCenter') && !list.includes('serverMonolith') ? [...list, 'serverMonolith' as const] : list;
  for (const tid of techsDone) {
    const def = TECHS[tid];
    if (!def) continue; // retired id on an unmigrated save
    for (const fx of def.effects) {
      if (!effectApplies(fx, siteId, expedition, techsDone)) continue;
      switch (fx.kind) {
        case 'unlock': m.unlocked.add(fx.building); break;
        case 'outputMult': {
          const target = fx.crewedOnly ? m.crewedOutputMult : m.outputMult;
          for (const b of compute(fx.buildings)) target[b] *= fx.mult;
          break;
        }
        case 'inputMult': for (const b of fx.buildings) m.inputMult[b] *= fx.mult; break;
        case 'powerMult': for (const b of compute(fx.buildings)) m.powerMult[b] *= fx.mult; break;
        case 'upkeepMult': {
          const list = fx.buildings === 'all' ? IDS : compute(fx.buildings);
          for (const b of list) m.upkeepMult[b] *= fx.mult;
          break;
        }
        case 'crewDelta': for (const b of fx.buildings) m.crewDelta[b] += fx.delta; break;
        case 'dustMult': m.dustMult *= fx.mult; break;
        case 'buildSpeed': m.buildSpeedMult *= fx.mult; break;
        case 'botPerBay': m.botPerBay += fx.delta; break;
        case 'launchAction': m.launchArmed = true; break;
        case 'powerBeam': m.powerBeam = true; break;
        case 'automation': m.automation = true; break;
        case 'grading': m.grading = true; break;
        case 'recipe': {
          const { building, inputs, outputs, powerKW, feedInsensitive } = fx;
          const prev = m.recipe[building] ?? {};
          m.recipe[building] = {
            ...prev,
            ...(inputs ? { inputs } : {}),
            ...(outputs ? { outputs } : {}),
            ...(powerKW !== undefined ? { powerKW } : {}),
            ...(feedInsensitive !== undefined ? { feedInsensitive } : {}),
          };
          break;
        }
        case 'agentTax': m.agentTax *= fx.mult; break;
        case 'construction':
          m.constructionKWMult *= fx.kwMult ?? 1;
          m.weldRateMult *= fx.rateMult ?? 1;
          m.weldPartsMult *= fx.partsMult ?? 1;
          break;
        case 'storage':
          m.batteryCapMult *= fx.capacityMult ?? 1;
          if (fx.efficiency !== undefined) m.storageEff = fx.efficiency;
          break;
        case 'repair': m.repairMult *= fx.mult; break;
        case 'shadeImmune': m.solarShadeImmune = true; break;
        case 'buildTime': for (const b of fx.buildings) m.buildTimeMult[b] *= fx.mult; break;
        case 'action': m.actions.add(fx.id); break;
        case 'survey':
          if (fx.tier && fx.tier > m.surveyTier) m.surveyTier = fx.tier;
          if (fx.dataMult !== undefined && fx.minCrew) {
            m.surveyCrewDataMult *= fx.dataMult;
            m.surveyMinCrew = Math.max(m.surveyMinCrew, fx.minCrew);
          } else if (fx.dataMult !== undefined) {
            m.surveyDataMult *= fx.dataMult;
          }
          break;
        case 'powerDelta': m.powerDelta[fx.building] += fx.kw; break;
        case 'nightDraw': m.nightDrawMult *= fx.night; m.dayDrawMult *= fx.day; break;
        case 'feedBonus': m.feedBonus[fx.deposit] *= fx.mult; break;
        case 'haul':
          m.haulSpeedMult *= fx.speedMult ?? 1;
          m.haulBucketMult *= fx.bucketMult ?? 1;
          break;
        case 'road':
          m.roadSpeedMult *= fx.speedMult ?? 1;
          m.roadHaulMult *= fx.haulMult ?? 1;
          m.roadNightMult *= fx.nightMult ?? 1;
          m.roadDustMult *= fx.dustMult ?? 1;
          m.roadCellMult *= fx.cellMult ?? 1;
          break;
        case 'housing': m.housingDelta[fx.building] += fx.delta; break;
        case 'orders': m.orderBook = Math.max(m.orderBook, fx.book); m.orderMax = Math.max(m.orderMax, fx.maxCount); break;
        case 'autoRule': m.autoFamilies.add(fx.family); break;
        case 'siting': m.siteSurvey = true; break;
        case 'governor': m.governor = true; break;
        case 'predictive': m.predictive = true; break;
        case 'feedPlanner': m.feedPlanner = true; break;
        case 'maintenance':
          m.maintenanceWear = m.maintenanceWear ? Math.min(m.maintenanceWear, fx.wear) : fx.wear;
          m.autoFamilies.add('maintenance');
          break;
        case 'builder':
          m.builderDwellMult *= fx.dwellMult ?? 1;
          m.builderCapMult *= fx.capMult ?? 1;
          for (const f of fx.families ?? []) m.autoFamilies.add(f);
          if (fx.all) m.builderAll = true;
          break;
        // ── destiny (docs/14 §2.7) ──
        case 'growth': m.growthMult *= fx.mult; break;
        case 'bringsCrew': break; // research.onTechComplete acts on it once
        case 'waive': m.waived.add(fx.tech); break;
        case 'eva': m.evaShare = Math.max(m.evaShare, fx.share); break;
        case 'radius': m.radiusDelta[fx.building] += fx.deltaM; break;
        case 'volley':
          if (fx.launchCap !== undefined) m.volleyCap = Math.min(m.volleyCap, fx.launchCap);
          m.volleyMorale += fx.morale ?? 0;
          m.volleyMinCrew = Math.max(m.volleyMinCrew, fx.minCrew ?? 0);
          break;
        case 'autoLaunch': m.autoLaunch = true; m.launchBurstMult *= fx.burstMult ?? 1; break;
        case 'moraleBase': m.moraleBase += fx.delta; break;
        case 'hazardRate': m.hazardRateMult *= fx.mult; break;
        case 'guard': m.guards.add(fx.guard); break;
        case 'exposure': {
          const set = m.exposure.get(fx.hazard) ?? new Set<BuildingId>();
          for (const b of fx.buildings ?? []) set.add(b);
          m.exposure.set(fx.hazard, set);
          break;
        }
        case 'morale': m.moraleDelta[fx.building] += fx.delta; break;
      }
    }
  }
  m.outpostSlots = SURVEY_TIERS[m.surveyTier].slots;

  for (const o of outposts) {
    if (!o.live) continue;
    // a grounded hopper keeps its link up (it is still out there, waiting on
    // fuel); only a fuelled outpost is online for its modifier
    m.powerDelta.lander += OUTPOST_LINK_KW[o.cls];
    if (o.kind === 'kreep' && o.fuelOk && !m.kreepOutpost) {
      m.kreepOutpost = true;
      m.powerMult.reactor *= FEED.kreepOutputMult;
      m.outputMult.chipFab *= FEED.kreepChipMult;
    }
  }
  return m;
}

/** computeMods for a live state (site, expedition and outposts included). */
export function modsFor(s: GameState): Mods {
  return computeMods(s.techsDone, s.expedition, s.siteId, s.survey?.outposts ?? []);
}

// ─────────────────────────── effective definitions ───────────────────────────

export type EffectiveDef = BuildingDef & { feedInsensitive: boolean };
const defCache = new WeakMap<Mods, Map<BuildingId, EffectiveDef>>();

/** The base definition with recipe overrides, the powerDelta sum and the
 *  housing / morale deltas applied. Multipliers are NOT applied here (see
 *  effectiveRates). */
export function effectiveDef(type: BuildingId, mods: Mods): EffectiveDef {
  let cache = defCache.get(mods);
  if (!cache) { cache = new Map(); defCache.set(mods, cache); }
  let d = cache.get(type);
  if (!d) {
    const base = BUILDINGS[type];
    const r = mods.recipe[type];
    d = {
      ...base,
      inputs: r?.inputs ?? base.inputs,
      outputs: r?.outputs ?? base.outputs,
      powerKW: (r?.powerKW ?? base.powerKW) + mods.powerDelta[type],
      feedInsensitive: r?.feedInsensitive ?? false,
      housing: base.housing ? Math.max(0, base.housing + mods.housingDelta[type]) : base.housing,
      moraleDelta: mods.moraleDelta[type] ? (base.moraleDelta ?? 0) + mods.moraleDelta[type] : base.moraleDelta,
      buildRadiusM: base.buildRadiusM ? base.buildRadiusM + mods.radiusDelta[type] : base.buildRadiusM,
    };
    cache.set(type, d);
  }
  return d;
}

/** output multiplier from equipment wear — linear; the Lander, the lifeboat, never wears */
export function wearDerate(b: Pick<BuildingState, 'type' | 'wear'>): number {
  return b.type === 'lander' ? 1 : 1 - WEAR.derate * b.wear;
}

/** Nobody aboard to run anything: a robotic run before its crew, or a crewed
 *  landing whose last crew rotated home at FIRST LIGHT (docs/14 §2.5). */
export function unmanned(s: Pick<GameState, 'expedition' | 'crew'> & { crewHome?: boolean }): boolean {
  return (s.expedition === 'robotic' || !!s.crewHome) && s.crew <= 0;
}

/** A station runs on agents when toggled Autonomous, or when the base is unmanned. */
export function isAgentRun(b: BuildingState, s: Pick<GameState, 'expedition' | 'crew'> & { crewHome?: boolean }): boolean {
  return b.automated || unmanned(s);
}

/** H₂-reduction smelter feed factor (all outputs) and its extra O₂ factor. */
export function smelterFeed(mods: Mods, g: FeedGrade): { all: number; o2: number } {
  const c = FEED.smelter;
  const all = Math.max(FEED.floor,
    1 + c.ilmenite * mods.feedBonus.ilmenite * g.ilmenite + c.anorthosite * g.anorthosite + c.kreep * g.kreep);
  return { all, o2: 1 + FEED.smelterO2Glass * mods.feedBonus.glass * g.glass };
}

export function refineryFeed(mods: Mods, g: FeedGrade): number {
  const c = FEED.refinery;
  return Math.max(FEED.floor, 1 + c.anorthosite * mods.feedBonus.anorthosite * g.anorthosite + c.ilmenite * g.ilmenite);
}

/** KREEP feed or a KREEP outpost cuts reactor upkeep; they do not stack. */
export function reactorUpkeepFactor(mods: Mods, g: FeedGrade): number {
  return mods.kreepOutpost || g.kreep >= FEED.kreepReactorShare ? FEED.kreepReactorUpkeep : 1;
}

const ISRU: BuildingId[] = ['excavator', 'iceHarvester', 'smelter', 'refinery'];

/** Dynamic Clocking may push these past nameplate (spec S8.1). */
export const OVERCLOCKABLE: readonly BuildingId[] = [
  'excavator', 'iceHarvester', 'smelter', 'refinery', 'partsFab', 'chipFab', 'lab', 'dataCenter',
  'foilFactory', 'massDriver', 'propellantPlant',
  'serverMonolith',
];

export interface RateOpts {
  /** default: b ? b.automated : false */
  agentRun?: boolean;
  /** robotic run (agent labs hold 0.75) */
  robotic?: boolean;
  /** crewed stations' morale work multiplier (default 1) */
  workMult?: number;
  /** apply night/day draw multipliers; omitted = nameplate */
  isNight?: boolean;
  feed?: FeedGrade;
  /** agent-run labs' shared DSN share (default 1) */
  uplinkShare?: number;
}

export interface EffectiveRates {
  /** signed nameplate kW: generators +, consumers − (agent tax, overclock, day/night applied) */
  powerKW: number;
  inputs: Partial<Record<ResourceId, number>>;
  outputs: Partial<Record<ResourceId, number>>;
  /** research data/s (labs, Data Centers) */
  data: number;
  upkeepPartsPerDay: number;
  crew: number;
  agentRun: boolean;
  /** processors: the feed-grade yield factor (1 elsewhere) */
  feedFactor: number;
}

const NO_FEED: FeedGrade = emptyFeed();

/** Exactly what one building does per second under these mods — multipliers,
 *  agent tax, feed factor, overclock, wear, site ISRU/launch and the deposit it
 *  sits on. The economy runs on these numbers. Sun, dust and shading are left
 *  to the caller (they vary by tick). */
export function effectiveRates(
  type: BuildingId, mods: Mods, site: SiteDef, b?: BuildingState, opts: RateOpts = {},
): EffectiveRates {
  const def = effectiveDef(type, mods);
  const agentRun = opts.agentRun ?? b?.automated ?? false;
  const crewed = def.crew > 0 && !agentRun;
  const oc = b?.overclock ? OVERCLOCK.mult : 1;
  const wear = b ? wearDerate(b) : 1;
  const workMult = opts.workMult ?? 1;
  const g = opts.feed ?? NO_FEED;
  const deposit = b?.deposit;

  let powerKW = 0;
  if (def.powerKW > 0) {
    powerKW = def.powerKW * mods.powerMult[type] * wear;
    // agents running a crewed generator skim its output for their own load
    if (agentRun && def.crew > 0) powerKW *= 1 - AGENT_GEN_TAX;
    if (type === 'solar' && deposit === 'ridge') powerKW *= DEPOSIT_FX.ridgeSolar;
  } else if (def.powerKW < 0) {
    const tax = agentRun && def.crew > 0 ? 1 + mods.agentTax : 1;
    const dn = opts.isNight === undefined ? 1 : opts.isNight ? mods.nightDrawMult : mods.dayDrawMult;
    powerKW = def.powerKW * mods.powerMult[type] * tax * oc * dn;
  }

  const inputs: Partial<Record<ResourceId, number>> = {};
  for (const [r, v] of Object.entries(def.inputs)) inputs[r as ResourceId] = (v ?? 0) * mods.inputMult[type] * oc;

  let outMult = mods.outputMult[type] * oc * wear;
  if (crewed) outMult *= workMult * mods.crewedOutputMult[type];
  if (ISRU.includes(type)) outMult *= site.isruMult;
  let feedFactor = 1;
  let o2Factor = 1;
  if (type === 'smelter' && !def.feedInsensitive) {
    const f = smelterFeed(mods, g);
    feedFactor = f.all;
    o2Factor = f.o2;
  } else if (type === 'refinery') {
    feedFactor = refineryFeed(mods, g);
  }
  const outputs: Partial<Record<ResourceId, number>> = {};
  for (const [r, v] of Object.entries(def.outputs)) {
    let amt = (v ?? 0) * outMult * feedFactor;
    if (r === 'oxygen') amt *= o2Factor;
    if (r === 'launch' && !def.ignoresLaunchMult) amt *= site.launchMult;
    if (type === 'excavator' && deposit === 'volatiles' && (def.outputs.water ?? 0) > 0) {
      if (r === 'water') amt *= DEPOSIT_FX.volatilesWater;
      if (r === 'regolith') amt *= DEPOSIT_FX.volatilesRegolith;
    }
    outputs[r as ResourceId] = amt;
  }

  let data = 0;
  if (type === 'lab') {
    const mode = agentRun
      ? (opts.robotic ? LAB_DATA.roboticAgent : LAB_DATA.humanAgent) * (opts.uplinkShare ?? 1)
      : Math.pow(workMult, LAB_DATA.crewedMoraleExp) * mods.crewedOutputMult.lab;
    data = LAB_DATA.base * mods.outputMult.lab * mode * oc * wear;
  } else if (type === 'dataCenter') {
    data = DC_DATA_PER_S * mods.outputMult.dataCenter * oc * wear;
  } else if (type === 'serverMonolith') {
    data = MONOLITH.dataPerS * mods.outputMult.serverMonolith * oc * wear;
  }

  let upkeep = def.upkeepParts * mods.upkeepMult[type] * site.upkeepMult;
  if (type === 'excavator' && deposit === 'glass') upkeep *= DEPOSIT_FX.glassExcavatorUpkeep;
  if (type === 'reactor') upkeep *= reactorUpkeepFactor(mods, g);

  return {
    powerKW, inputs, outputs, data,
    upkeepPartsPerDay: upkeep,
    crew: agentRun ? 0 : Math.max(0, def.crew + mods.crewDelta[type]),
    agentRun,
    feedFactor,
  };
}

/** Whether stations may switch between crewed and agent-run — the one rule
 *  both the action handler and the inspector use. Construction Robotics
 *  (automation) allows it anywhere; a robotic base runs on agents from the
 *  start, so once settlers are aboard they may take stations over. */
export function canToggleCrew(
  expedition: Expedition,
  crew: number,
  mods: Pick<Mods, 'automation'>,
): boolean {
  return mods.automation || (expedition === 'robotic' && crew > 0);
}

/** canToggleCrew for one building, with the reason when it is refused (spec S8.6). */
export function crewToggleRule(
  s: Pick<GameState, 'expedition' | 'crew'>, mods: Mods, b: BuildingState,
): { ok: boolean; reason: string } {
  if (BUILDINGS[b.type].crew <= 0) return { ok: false, reason: 'NO CREW STATION — this structure runs itself' };
  if (canToggleCrew(s.expedition, s.crew, mods)) return { ok: true, reason: '' };
  if (s.expedition === 'robotic') return { ok: false, reason: 'NO CREW ABOARD — Human Cohabitation brings a crew rotation' };
  return { ok: false, reason: 'NEEDS CONSTRUCTION ROBOTICS (automation)' };
}
