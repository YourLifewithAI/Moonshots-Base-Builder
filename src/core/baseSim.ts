/** One base's simulation: the GameState, its mods, its ground and every
 *  mutation the player's actions and the Builder make to them, with nothing of
 *  the world (meshes, sounds, stores, the camera) in it. `Game` owns one for the
 *  player's base and drains its `out` mailbox into the world each frame; a
 *  rival's base (docs/20 §4) is another `BaseSim` nobody draws.
 *
 *  The methods here moved out of `Game` with their bodies unchanged; a line
 *  that touched the world became a write to `out` (docs/20 §4.1). */
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { SITES, type SiteDef, type SiteId } from '../data/sites';
import { TECHS } from '../data/techs';
import { RESOURCES, type ResourceId } from '../data/resources';
import { ALERTS, CYCLE_S, DEPOSIT_FX, DOWNLINK, OVERCLOCK, RESUPPLY } from '../data/balance';
import { DEPOSIT_INFO, type DepositKind } from '../data/deposits';
import { createInitialState, type BuildingState, type GameState } from './state';
import { OVERCLOCKABLE, canToggleCrew, crewToggleRule, modsFor, type Mods } from './mods';
import type { Action } from './actions';
import {
  downlinkCost, economyTick, refreshDerived, alert, landerAction, missionLost, orderDelayS, queuePos, launchVolley,
  type EconEvents,
} from './economy';
import {
  budgetShort, crewPlan, freezeRules, newOrder, onPlayerDemolish, orderRefusal, recordPlaced, recordRefused, ruleState, logAuto,
  type AutoRequest, type SiteIntent,
} from './automation';
import { chooseSite, feedPlan } from './siting';
import { recordSpend } from './flowBook';
import { AUTO, RULES } from '../data/automation';
import { applyGrants, cancel, enqueue, enqueuePath, migrateTechSchema, moveInQueue } from './research';
import { fmtClock } from './daynight';
import {
  abandonOutpost, claimOutpost, depositRevealed, groundMapped, revealDeposits, revealRadiusM, startSurvey, strikeEffect,
} from './exploration';
import { fleetRefresh, releaseRover, sendRover, summonRover, unpinRover } from './fleet';
import { ensureFleet, migrateSurveySchema } from './surveyDrones';
import { transitPlan } from './transit';
import { digAtHome, digRefusal, setDigSite } from './haul';
import { bumpRoads, cellAt, dropSpur, hasRoads, layApron, layPlan, laySpur, migrateRoads, planLink, planSpur } from './roads';
import { zonesFrom } from './zones';
import {
  assignPit, autoUnit, bindHeights, cancelJob, choicesFor, dispatchUnit, haulEnd, haulOpts, migrateHubs, newHubState, openPit,
  plainZones, queueJob, recallUnit, sendUnit, stakeHubPit,
} from './hubs';
import { isHubType } from '../data/hubs';
import { setHubPolicy, setUnitFeedPlan } from './hubPlanner';
import { bindTerrain, queueSurvey, restoreTerrain, saveTerrain, startReclaim, syncPitZones } from './pits';
import { roadAction } from './roadActions';
import { groundName } from './fleetView';
import { applyCounter, setAirGap } from './hazards';
import {
  allWrecks, clearWreck, confirmChoice, migrateFlareSchema, queueRepairs, rebuildWreck, setFieldOverride, setRemembered,
} from './spaceWeather';
import { applyFlareCounter, commsDark, isFlareCounter } from './flareEffects';
import { launchSentinel, setAhead } from './forecast';
import { cancelGrade, finishNow, queueGrade, squareAt, type GradeRect } from './grading';
import { Heightfield, type Deposit } from '../terrain/heightfield';
import { FlatHeights } from '../terrain/flatHeights';
import { bindMode } from './simMode';
import { bindMoon, type MoonState } from './moon';
import { landingTechFor } from '../data/techs';
import { factionOfState, type FactionId } from '../data/factions';
import { centerOf, footprintRect } from '../buildings/instances';
import { buildCost, checkPlacement, demolishRefund, untouchedSite } from '../buildings/placement';

/** How a base's sim runs (docs/20 §4.1). The player's is `PLAYER_MODE`; a rival's (W0b, S4) trades what nobody sees for speed.
 *  Only `openRoads` is read so far; the rest are declared for the headless stand-ins. */
export interface SimMode {
  /** no world is drawn for this base */
  headless: boolean;
  /** trips are straight lines (charged the time, not routed) */
  straightLegs: boolean;
  /** units reserve road cells (traffic) */
  traffic: boolean;
  /** pits are counted, not carved */
  virtualPits: boolean;
  /** a placement's road is laid open at once, no sintering (tests that time builds, not roads) */
  openRoads: boolean;
}

export const PLAYER_MODE: Readonly<SimMode> = {
  headless: false, straightLegs: false, traffic: true, virtualPits: false, openRoads: false,
};

/** A rectangle of heightfield cells [x0..x1) × [z0..z1). */
export interface CellRect { x0: number; z0: number; x1: number; z1: number }

/** `SimOut.wrecked` holds this when a demolish action clears whatever the player has selected, not one building. */
export const ANY_SELECTION = -1;

/** What the sim did that the world has to show. The sim only writes it; the owner (`Game.drain`) reads it and clears it.
 *  A mailbox, never callbacks: a rival's base writes the same fields and nobody reads them. */
export interface SimOut {
  /** the buildings changed (placed, demolished, replaced): the instances are rebuilt */
  buildings: boolean;
  /** ground levelled under a footprint (a placement, a saved flatten replayed): chunks, rocks and horizon follow */
  flattened: CellRect[];
  /** volleys launched since the last look: the rail shows one each */
  launches: number;
  /** ids of buildings gone (a hazard's wreck, a demolish): the selection clears if it is one of them */
  wrecked: number[];
  /** buildings placed through a place action since the last look: the sound and the floating price */
  placed: BuildingState[];
}

export const newOut = (): SimOut => ({ buildings: false, flattened: [], launches: 0, wrecked: [], placed: [] });

/** `BaseSim.create`'s inputs. */
export interface SimCreate {
  siteId: SiteId;
  seed: number;
  expedition: 'human' | 'robotic';
  /** a faction's base (docs/20): its landing tech stands in for the solo landing (`landingCrew`/`landingRobotic`) and its
   *  one-time grants are paid (the Vanguard's +100 data); `state.faction` is set. Absent: the solo game, exactly as before. */
  faction?: FactionId;
  /** the Moon clock at the start of the landing's day (`landsAtDay × CYCLE_S`); the base's clock starts at `landedAt + 90` */
  landedAt?: number;
  mode: SimMode;
  /** the Moon this base is on (bound to the state, `core/moon.ts`): a solo game passes its own one-faction Moon */
  moon?: MoonState;
  /** a headless base's ground (`FlatHeights`: flat, the real deposits, virtual pits) instead of the real `Heightfield`; pairs with
   *  `mode: HEADLESS_MODE` (a rival's base, core/rival.ts). The player's base leaves it off. */
  flat?: boolean;
}

export class BaseSim {
  state: GameState;
  mods: Mods;
  readonly site: SiteDef;
  hf: Heightfield;
  mode: SimMode;
  out: SimOut = newOut();
  /** what the last Builder place action did: the building, or why it refused */
  lastPlace: BuildingState | string | null = null;
  /** the faction this base plays (docs/20), the Moon second it landed at, and the Moon it is on: a solo base has no faction and lands at 0 */
  faction?: FactionId;
  landedAt = 0;
  moon?: MoonState;
  /** the deposits the last sync saw revealed; `revealedRev` counts its changes so the owner redraws the rings only when it moved */
  revealedIds = new Set<string>();
  revealedRev = 0;
  /** a first sync has run (until then it counts every revealed deposit as new) */
  private depositsSynced = false;
  /** a load carved the ground (the pits' saved height deltas): the owner's rocks on it go */
  carvedOnLoad = false;

  /** The sim half of `bootWorld`: the derived mods, the heightfield, and the binds the core reads it through. `flat`: a
   *  headless base's stand-in ground (docs/20 §4.2) and, through `mode`, its stand-in travel (§4.3). */
  private constructor(state: GameState, mode: SimMode, flat = false) {
    this.state = state;
    this.mode = mode;
    this.site = SITES[state.siteId];
    this.mods = refreshDerived(state);
    this.hf = flat ? new FlatHeights(SITES[state.siteId], state.seed) : new Heightfield(SITES[state.siteId], state.seed);
    // the sim plans hub units' haul roads and stakes plain pits on it (core/hubs.ts)
    bindHeights(state, this.hf);
    bindTerrain(state, this.hf); // the pits carve this ground (core/pits.ts, economy step 4.2)
    bindMode(state, mode); // the legs, the traffic and the pits read how this base runs from its state (core/simMode.ts)
    // a flat ground hashes its virtual pits' signature (even of none), as a load re-derives it: start from the same value
    if (flat) syncPitZones(state, this.hf, undefined, false);
  }

  /** A new base: the Lander at the map heart (free, with its apron), its rovers and survey drone, parked. */
  static create(o: SimCreate): BaseSim {
    const state = createInitialState(o.siteId, o.seed, o.expedition, o.landedAt ?? 0);
    if (o.faction) {
      // the faction's landing is its Era 1 pick, in place of the solo landing; its traits ride on it (docs/20 §1),
      // and a landing is never "researched", so its one-time grants are paid here
      const landing = landingTechFor(o.faction);
      state.faction = o.faction;
      state.techsDone = [landing];
      applyGrants(state, landing);
    }
    if (o.moon) bindMoon(state, o.moon);
    const sim = new BaseSim(state, o.mode, !!o.flat);
    sim.faction = o.faction;
    sim.landedAt = o.landedAt ?? 0;
    sim.moon = o.moon;
    // pre-place the Lander at the map heart and pad the ground under it
    const gx = 126, gz = 126;
    sim.commitPlace('lander', gx, gz, 0, true);
    fleetRefresh(sim.state, sim.mods); // the Lander's rovers, before the first tick
    ensureFleet(sim.state, sim.mods); // and its survey drone (docs/19 S6)
    transitPlan(sim.state, sim.mods, false); // parked in its bays
    sim.syncDeposits(false);
    alert(sim.state, 'TOUCHDOWN — begin with a Solar Array', 'info');
    return sim;
  }

  /** A saved base: every migration, the regenerated ground with the pits' deltas and the flattens replayed on it. `moon`: the
   *  Moon it is on (bound here); `flat`: a rival's stand-in ground (its saved state keeps the flattens, which mark the pads). */
  static fromState(state: GameState, mode: SimMode, moon?: MoonState, flat = false): BaseSim {
    // migrate pre-bank saves: scalar researchProgress → per-tech researchSpent
    const legacy = state as GameState & { researchProgress?: number };
    if (!legacy.researchSpent) {
      legacy.researchSpent = {};
      const head = legacy.researchQueue?.[0];
      if (head && legacy.researchProgress) legacy.researchSpent[head] = legacy.researchProgress;
    }
    // migrate robotic saves from before agent-control defaults: an unmanned
    // base's stations must all be automated or they'd idle waiting for crew
    if (legacy.expedition === 'robotic' && legacy.crew <= 0) {
      for (const b of legacy.buildings) b.automated = true;
    }
    // saves from before the chip era lack the chips stockpile
    legacy.resources.chips ??= 0;
    // saves from before economy-side rates and live housing
    legacy.rates ??= {};
    legacy.housingActive ??= legacy.buildings.reduce((n, b) =>
      n + (b.enabled && (b.construction ?? 0) <= 0 ? BUILDINGS[b.type].housing ?? 0 : 0), 0);
    // saves from before keyed alerts: an old line cannot tell whether it still
    // holds, so it becomes an event that fades — nothing stale stays pinned
    legacy.alertSnooze ??= {};
    // saves from before the notification log (docs/19): an empty one
    legacy.log ??= [];
    for (const a of legacy.alerts) {
      if (a.key !== undefined) continue;
      a.key = a.text;
      a.count = 1;
      if (a.kind === 'crit') a.kind = 'warn';
    }
    // saves from the 34-tech tree: retired ids refunded, the queue sanitized
    migrateTechSchema(state);
    // saves from before classed flares (docs/16 §14.3, flareSchema 0 → 1)
    migrateFlareSchema(state);
    // saves from before the survey-drone fleet (docs/19 S6, surveySchema 0 → 1)
    migrateSurveySchema(state);
    if (moon) bindMoon(state, moon);
    const sim = new BaseSim(state, mode, flat);
    sim.moon = moon;
    sim.faction = factionOfState(state);
    sim.landedAt = state.landedAt ?? 0;
    // the pits' height deltas onto the regenerated surface, then the flattens
    // replay over them, in order (base → deltas → flattens, docs/17 §11.1)
    const carved = restoreTerrain(sim.state, sim.hf);
    for (const f of sim.state.flattens) {
      // (a grading job's single cells carry no skirt: the job's whole rectangle, last, feathers it once)
      sim.hf.flatten(f.x0, f.z0, f.x1, f.z1, f.h, !f.noSkirt);
      sim.out.flattened.push({ x0: f.x0, z0: f.z0, x1: f.x1, z1: f.z1 });
    }
    // migration rule 7: a Lander ice survey mapped every ice deposit; every
    // building's deposit comes from the regenerated heightfield
    const struck = sim.state.survey.struck;
    if (sim.state.iceSurveyed) for (const d of sim.hf.iceDeposits) if (!struck.includes(d.id)) struck.push(d.id);
    for (const b of sim.state.buildings) sim.stampDeposit(b);
    migrateRoads(sim.state, sim.hf); // a save from before roads gets them now
    sim.syncDeposits(false);
    // a save from before extraction hubs (docs/17 §19): excavators join their hubs
    migrateHubs(sim.state, sim.mods, SITES[sim.state.siteId]);
    // the pits' zones come back from the grid (the save leaves them out)
    syncPitZones(sim.state, sim.hf, undefined, false);
    sim.carvedOnLoad = !!carved;
    sim.hf.carved.length = 0;
    sim.hf.leveled.length = 0;
    sim.out.buildings = true;
    return sim;
  }

  /** One game-second: the clock, then the economy step. The live loop advances the clock by the frame's own share
   *  of a second and calls `econStep` once per whole second instead. */
  tick(): EconEvents {
    this.state.simTime += 1;
    return this.econStep();
  }

  /** Forget what the sim did for the world: a base nobody draws (a rival's) empties its mailbox instead of draining it. */
  clearOut() {
    const o = this.out;
    o.buildings = false;
    o.flattened.length = 0;
    o.launches = 0;
    o.wrecked.length = 0;
    o.placed.length = 0;
  }

  /** The state to write to a save: the pits' height deltas saved into it, the pit zones left out (they come back from the grid),
   *  and `pausedAs` (the pause the player left) in place of the menu's. */
  saveState(pausedAs: boolean | null = null): GameState {
    // the height-delta grid, sparse (docs/17 §11.5); pit zones are rebuilt from it on load
    saveTerrain(this.state, this.hf);
    const base = pausedAs === null || missionLost(this.state) ? this.state : { ...this.state, paused: pausedAs };
    return base.zones?.some((z) => z.kind === 'pit') ? { ...base, zones: base.zones.filter((z) => z.kind !== 'pit') } : base;
  }

  /** One action: what was `Game.applyAction` (the player's clicks, the debug API, the Builder's place through `placeAuto`). */
  apply(a: Action) {
    const s = this.state;
    switch (a.kind) {
      case 'place': {
        const chk = checkPlacement(s, SITES[s.siteId], this.hf, this.mods.unlocked, a.type, a.gx, a.gz, a.rot,
          this.mods.surveyTier);
        if (!chk.valid) {
          if (a.builder) this.lastPlace = chk.reason; // the Builder tries its next site
          else alert(s, `CANNOT BUILD — ${chk.reason}`, 'warn');
          break;
        }
        const placed = this.commitPlace(a.type, a.gx, a.gz, a.rot, false, a.builder?.automated);
        if (a.builder) this.lastPlace = placed;
        // the owner plays the sound and floats the price up from the pad it was paid for (`out.placed`)
        this.out.placed.push(placed);
        break;
      }
      case 'demolish': {
        const b = s.buildings.find((x) => x.id === a.id);
        if (!b || b.type === 'lander') break;
        // the Builder takes the hint: a cancelled auto site vetoes that ground,
        // and a removed building is not rebuilt for a lunar day
        onPlayerDemolish(s, this.mods, b, untouchedSite(b));
        this.demolishBuilding(b.id);
        this.out.wrecked.push(ANY_SELECTION);
        break;
      }
      case 'order': this.fillOrder(a.type, a.count, a.intent ?? {}); break;
      case 'cancelOrder': {
        const o = s.auto.orders.find((x) => x.id === a.id);
        if (!o) break;
        s.auto.orders = s.auto.orders.filter((x) => x.id !== a.id);
        logAuto(s, `order #${o.id} cancelled: ${o.placed.length} of ${o.count} ${BUILDINGS[o.type].name} placed`);
        break;
      }
      case 'orderNext': {
        const o = s.auto.orders.find((x) => x.id === a.id);
        if (!o) break;
        for (const id of o.placed) this.apply({ kind: 'buildNext', id });
        break;
      }
      case 'setRule': {
        const r = ruleState(s, a.rule);
        const d = RULES[a.rule];
        if (a.on !== undefined) {
          r.on = a.on;
          if (a.on && r.phase === 'vetoed') r.nextAt = 0;
        }
        if (a.threshold !== undefined && d.step > 0) {
          r.threshold = Math.min(d.range[1], Math.max(d.range[0], Math.round(a.threshold / d.step) * d.step));
        }
        if (a.cap !== undefined) r.cap = Math.min(d.capRange[1], Math.max(d.capRange[0], Math.round(a.cap)));
        break;
      }
      case 'setReserve':
        if (!this.mods.governor) { alert(s, 'RESERVES NEED THE BUDGET GOVERNOR — research it to set floors', 'warn'); break; }
        if (a.amount === null) delete s.auto.reserve[a.res];
        else s.auto.reserve[a.res] = Math.max(0, Math.round(a.amount));
        break;
      case 'moveFamily': {
        if (!this.mods.governor) { alert(s, 'RULE ORDER NEEDS THE BUDGET GOVERNOR — research it to reorder rules', 'warn'); break; }
        const list = s.auto.priority;
        const i = list.indexOf(a.family);
        const j = i + a.delta;
        if (i < 0 || j < 0 || j >= list.length) break;
        [list[i], list[j]] = [list[j], list[i]];
        break;
      }
      case 'freezeRules':
        freezeRules(s, a.seconds);
        alert(s, a.seconds > 0 ? `RULES FROZEN — the Builder holds every rule for ${fmtClock(a.seconds)}` : 'RULES THAWED — the Builder resumes',
          'info', { panel: 'builder' });
        break;
      case 'setFeedPlan': {
        const b = s.buildings.find((x) => x.id === a.id);
        if (b && b.type === 'excavator') b.feedPlanOff = !a.on;
        break;
      }
      case 'setHubPolicy': {
        const why = setHubPolicy(s, this.mods, a.hub, a.policy);
        if (why) alert(s, why, 'warn');
        break;
      }
      case 'setUnitFeedPlan': {
        const why = setUnitFeedPlan(s, this.mods, a.unit, a.on);
        if (why) alert(s, why, 'warn');
        break;
      }
      case 'setElectrolysis': {
        const b = s.buildings.find((x) => x.id === a.id);
        if (!b || b.type !== 'waterPlant') break;
        if (a.on && !this.mods.actions.has('electrolysis')) {
          alert(s, 'Research Water Electrolysis to split water into oxygen.', 'warn');
          break;
        }
        b.electrolysis = a.on;
        break;
      }
      // hazards (core/hazards.ts, docs/14 §3.7): a counter works while paused, as placement does
      case 'counter': {
        // the flare's own counters (docs/16 §4): Recall machines, Checkpoint, Shut down exposed, Replace, Re-print
        const flare = isFlareCounter(a.counter);
        const r = flare ? applyFlareCounter(s, this.mods, SITES[s.siteId], a.counter as never, a.id) : applyCounter(s, this.mods, a.counter as never, a.id);
        if (!r.ok) alert(s, r.reason, 'warn');
        else if (flare && (a.counter === 'flareReplace' || a.counter === 'flareReplaceWorst')) this.out.buildings = true;
        break;
      }
      case 'airGap': {
        const r = setAirGap(s, this.mods, a.id, a.on);
        if (!r.ok) alert(s, r.reason, 'warn');
        break;
      }
      // space weather (docs/16 §5): every refusal says why
      // forecasting (core/forecast.ts, docs/16 §6)
      case 'flareAhead': case 'launchSentinel': {
        const r = a.kind === 'flareAhead' ? setAhead(s, this.mods, a.choice, { repair: a.repair, remember: a.remember })
          : launchSentinel(s, this.mods);
        if (!r.ok) alert(s, r.reason, 'warn');
        break;
      }
      case 'flareChoice': case 'flareRemember': case 'flareAutoRepair': case 'fieldOverride': case 'wreck': case 'repairArrays': {
        const site = SITES[s.siteId];
        const r = a.kind === 'flareChoice' ? confirmChoice(s, a.choice, { repair: a.repair, remember: a.remember })
          : a.kind === 'flareRemember' ? setRemembered(s, a.cls, a.choice)
          : a.kind === 'flareAutoRepair' ? (((s.weather ??= { remember: {}, autoRepair: true, answered: {}, repairs: [], seenSunAt: 0 }).autoRepair = a.on), { ok: true, reason: '' })
          : a.kind === 'fieldOverride' ? setFieldOverride(s, a.id, a.mode)
          : a.kind === 'repairArrays' ? queueRepairs(s, a.id !== undefined ? [a.id] : undefined)
          : a.id === undefined ? allWrecks(s, this.mods, site, a.how)
          : a.how === 'rebuild' ? rebuildWreck(s, this.mods, site, a.id) : clearWreck(s, a.id);
        if (!r.ok) alert(s, r.reason, 'warn');
        else if (a.kind === 'wreck') this.out.buildings = true;
        break;
      }
      case 'setEnabled': {
        const b = s.buildings.find((x) => x.id === a.id);
        if (b) b.enabled = a.enabled;
        break;
      }
      case 'setAutomated': {
        const b = s.buildings.find((x) => x.id === a.id);
        if (!b) break;
        const rule = crewToggleRule(s, this.mods, b);
        if (!rule.ok) { alert(s, rule.reason, 'warn'); break; }
        b.automated = a.automated;
        // a hand-crewed station stays crewed; a hand-set agent one stays agent-run
        b.crewPinned = !a.automated;
        b.agentCover = false;
        break;
      }
      case 'setAgentCover': {
        s.agentCover = a.on;
        if (!a.on) for (const b of s.buildings) b.agentCover = false;
        break;
      }
      case 'layRoad': case 'removeRoad': roadAction(s, this.hf, a); break;
      case 'setOverclock': this.setOverclock(a.id, a.on); break;
      case 'downlink': this.doDownlink(); break;
      case 'crewAll': this.crewAllStations(); break;
      case 'setPriority': {
        const b = s.buildings.find((x) => x.id === a.id);
        if (b) b.priority = a.priority;
        break;
      }
      case 'buildNext': {
        const b = s.buildings.find((x) => x.id === a.id);
        if (!b || (b.construction ?? 0) <= 0) break;
        const sites = s.buildings.filter((x) => (x.construction ?? 0) > 0 && x.id !== b.id);
        const head = Math.min(...sites.map(queuePos));
        if (queuePos(b) >= head) b.buildSeq = head - 1;
        break;
      }
      case 'research': case 'researchPath': case 'cancelResearch': case 'moveResearch': {
        // banked data (researchSpent) survives every queue change
        const r = a.kind === 'research' ? enqueue(s, a.tech)
          : a.kind === 'researchPath' ? enqueuePath(s, a.tech)
          : a.kind === 'cancelResearch' ? cancel(s, a.tech)
          : moveInQueue(s, a.tech, a.delta);
        if (!r.ok) alert(s, r.reason, 'warn');
        break;
      }
      case 'setSpeed': s.speed = a.speed; break;
      case 'setPaused':
        // a lost base stays frozen under its defeat screen
        if (!missionLost(s)) s.paused = a.paused;
        break;
      case 'launch': this.doLaunch(); break;
      case 'grade': this.queueBox(squareAt(a.gx, a.gz), false); break; // the old click: the 16 m square, as a job
      case 'gradeBox': this.queueBox([a.gx0, a.gz0, a.gx1, a.gz1], !!a.instant); break;
      case 'cancelGrade': {
        const j = s.gradeJobs?.find((x) => x.id === a.id);
        const r = cancelGrade(s, a.id);
        if (r.ok && j) {
          alert(s, `GRADING CANCELLED — ${j.cells.length - j.done} of ${j.cells.length} cells undone${r.refund >= 0.5 ? `, ${Math.round(r.refund)} stored energy back` : ''}`, 'info');
        }
        break;
      }
      case 'orderResupply': {
        if (s.resupply?.pending) {
          alert(s, 'SHIPMENT ALREADY EN ROUTE — one launch window at a time', 'warn');
          break;
        }
        if (!s.resupply) s.resupply = { pending: false, arriveAt: 0, shipments: 0 };
        const days = Math.round(orderDelayS(s) / CYCLE_S);
        s.resupply.pending = true;
        s.resupply.downlink = false;
        s.resupply.arriveAt = s.simTime + orderDelayS(s);
        s.resupply.ordered = (s.resupply.ordered ?? 0) + 1;
        if (s.crew > 0) s.morale = Math.max(0, s.morale - RESUPPLY.moraleHit);
        alert(s, `SHIPMENT ORDERED — Earth launch confirmed, arrival in ${days} lunar day${days === 1 ? '' : 's'}`,
          'info', landerAction(s));
        break;
      }
      case 'surveyIce':
        // retired: the survey radius maps deposits by itself
        alert(s, 'Deposits are mapped automatically inside your survey radius — open the map [M]', 'info');
        break;
      case 'surveyProspect': {
        const r = startSurvey(s, this.mods, a.id);
        if (!r.ok) alert(s, r.reason, 'warn');
        break;
      }
      case 'claimOutpost': {
        const r = claimOutpost(s, this.mods, a.id);
        if (!r.ok) alert(s, r.reason, 'warn');
        break;
      }
      case 'abandonOutpost': {
        const r = abandonOutpost(s, a.id);
        if (!r.ok) alert(s, r.reason, 'warn');
        else if (r.wasLive) this.mods = modsFor(s); // its link load and any KREEP modifier go with it
        break;
      }
      case 'summonRover': {
        const r = summonRover(s, a.site);
        if (!r.ok) alert(s, r.reason, 'warn');
        break;
      }
      case 'releaseRover': {
        const r = releaseRover(s, a.site);
        if (!r.ok) alert(s, r.reason, 'warn');
        break;
      }
      case 'sendRover': {
        const r = sendRover(s, a.rover, a.site);
        if (!r.ok) alert(s, `CANNOT SEND — ${r.reason}`, 'warn');
        break;
      }
      case 'unpinRover': {
        const r = unpinRover(s, a.rover);
        if (!r.ok) alert(s, r.reason, 'warn');
        break;
      }
      case 'digAt': this.digAt(a.id, a.x, a.z); break;
      // extraction hubs (core/hubs.ts, docs/17 §4)
      case 'queueUnit': case 'queueBay': {
        const b = s.buildings.find((x) => x.id === a.hub);
        const why = queueJob(s, this.mods, SITES[s.siteId], b, a.kind === 'queueBay' ? 'bay' : 'unit');
        if (why) alert(s, `CANNOT PRINT — ${why}`, 'warn');
        break;
      }
      case 'cancelJob': {
        const why = cancelJob(s, s.buildings.find((x) => x.id === a.hub), a.index);
        if (why) alert(s, why, 'warn');
        break;
      }
      case 'assignPit': {
        const why = assignPit(s, this.mods, s.buildings.find((x) => x.id === a.hub), a.key);
        if (why) alert(s, `CANNOT ASSIGN — ${why}`, 'warn');
        break;
      }
      case 'openPit': {
        const why = openPit(s, this.mods, s.buildings.find((x) => x.id === a.hub), a.x, a.z);
        if (why) alert(s, `CANNOT OPEN A PIT THERE — ${why}`, 'warn');
        break;
      }
      case 'sendUnit': {
        const why = sendUnit(s, this.mods, a.unit, a.key);
        if (why) alert(s, `CANNOT SEND — ${why}`, 'warn');
        break;
      }
      case 'recallUnit': { const why = recallUnit(s, this.mods, a.unit); if (why) alert(s, why, 'warn'); break; }
      case 'dispatchUnit': { const why = dispatchUnit(s, a.unit); if (why) alert(s, why, 'warn'); break; }
      case 'autoUnit': { const why = autoUnit(s, a.unit); if (why) alert(s, why, 'warn'); break; }
      case 'surveyDeposit': {
        const why = queueSurvey(s, this.mods, a.id);
        if (why) alert(s, `CANNOT SURVEY — ${why}`, 'warn', { deposit: a.id });
        break;
      }
      case 'reclaimPit': {
        const why = startReclaim(s, a.pit);
        if (why) alert(s, `CANNOT RECLAIM — ${why}`, 'warn');
        break;
      }
      case 'digHome': {
        const b = s.buildings.find((x) => x.id === a.id);
        if (!b || b.type !== 'excavator') break;
        digAtHome(s, this.mods, b);
        break;
      }
      case 'dismissAlert': {
        // a dismissed condition keeps quiet a while instead of returning next tick
        const al = s.alerts.find((x) => x.id === a.id);
        if (al?.cond) (s.alertSnooze ??= {})[al.key] = s.simTime + ALERTS.snoozeS;
        s.alerts = s.alerts.filter((x) => x.id !== a.id);
        break;
      }
    }
  }

  /** Queue a grading box (docs/19 S5): refused with the words, or paid for and made a job the rovers level
   *  cell by cell. `instant` (tests, the debug API): levelled at once. */
  queueBox(rect: GradeRect, instant: boolean) {
    const s = this.state;
    const r = queueGrade(s, this.hf, this.mods, rect);
    if (!r.ok) { alert(s, `CANNOT GRADE — ${r.reason}`, 'warn'); return; }
    const j = r.job!;
    if (instant) { finishNow(s, this.hf, j); return; }
    const nx = rect[2] - rect[0], nz = rect[3] - rect[1];
    alert(s, `GRADING QUEUED — ${nx}×${nz} cells, ${fmtClock(Math.ceil(j.total / (this.mods.grading ? 2 : 1)))} of rover time, ${Math.round(j.energy)} stored energy`, 'info');
  }

  commitPlace(
    type: BuildingId, gx: number, gz: number, rot: 0 | 1 | 2 | 3, free: boolean, automated?: boolean,
  ): BuildingState {
    const s = this.state;
    if (!free) {
      const cost = buildCost(type, SITES[s.siteId]);
      for (const [rid, amt] of Object.entries(cost)) {
        s.resources[rid as keyof typeof s.resources] -= amt ?? 0;
      }
      recordSpend(s, cost); // the flow book: builds are metals demand too
    }
    const probe = { type, gx, gz, rot };
    const r = footprintRect(probe);
    const h = this.hf.flatten(r.gx0, r.gz0, r.gx1, r.gz1);
    s.flattens.push({ x0: r.gx0, z0: r.gz0, x1: r.gx1, z1: r.gz1, h });
    this.out.flattened.push({ x0: r.gx0, z0: r.gz0, x1: r.gx1, z1: r.gz1 });
    // rough terrain slows construction the same way it inflates costs;
    // teleoperation / swarm-robotics techs speed every build, and some techs
    // slow one type (tall masts, buried racks)
    const dep = this.hf.depositAt(...centerOf(probe));
    // a peak of light is steep going: arrays up there take longer
    const ridge = type === 'solar' && dep?.kind === 'ridge' ? DEPOSIT_FX.ridgeSolarBuildTime : 1;
    const buildTotal = Math.round(BUILDINGS[type].buildTime * SITES[s.siteId].buildCostMult *
      this.mods.buildSpeedMult * this.mods.buildTimeMult[type] * ridge);
    const b: BuildingState = {
      id: s.nextBuildingId++, type, gx, gz, rot,
      enabled: true,
      // robotic missions place every station under agent control, so arriving
      // settlers never strand a running base — crewing is an opt-in upgrade
      automated: automated ?? (s.expedition === 'robotic' || !!s.crewHome),
      priority: BUILDINGS[type].priority, wear: 0, dust: 0,
      construction: free ? 0 : buildTotal, buildTotal,
      active: false, idleReason: free ? '' : 'building',
    };
    this.stampDeposit(b);
    s.buildings.push(b);
    // building on unmapped ground maps it — first, so its road knows the zone it stands in
    const zonesBefore = s.zones;
    if (dep && !free) { this.strike(b, dep); this.syncZones(); }
    // its road (core/roads.ts): the Lander lands with its apron, the rest get a spur
    // (one inside an extraction zone stops at the zone's rim, core/zones.ts)
    if (b.type === 'lander') { if (!s.roads) layApron(s, b); } else {
      // the zone its strike just mapped refuses the road the placement check
      // approved (a dock's bays on its ring): lay that road, the new zone set
      // aside, as a save's migration does — a site with no road waits forever
      if (s.zones !== zonesBefore && planSpur(s, this.hf, b).reason) {
        const mapped = s.zones;
        s.zones = zonesBefore;
        laySpur(s, this.hf, b, free || this.mode.openRoads);
        s.zones = mapped;
        bumpRoads(s);
      } else laySpur(s, this.hf, b, free || this.mode.openRoads);
    }
    if (isHubType(type) && !free) this.hubPlaced(b);
    this.out.buildings = true;
    // deadlock early-warning: metals gone before your first smelter exists
    if (!free && !s.buildings.some((b) => b.type === 'smelter')) {
      const smelterCost = Math.ceil((BUILDINGS.smelter.buildCost.metals ?? 40) * SITES[s.siteId].buildCostMult);
      if (s.resources.metals < smelterCost + 20) {
        // still locked: name the research it waits on
        alert(s, this.mods.unlocked.has('smelter')
          ? `METALS LOW — a Regolith Smelter costs ${smelterCost}◆; without one you cannot make more`
          : `METALS LOW — research ${TECHS.regolithProcessing.name}, then build a smelter (${smelterCost}◆); without one you cannot make more`,
        'warn', { panel: 'metals' });
      }
    }
    return b;
  }

  /** A hub placed (docs/17 §5.3): with no wanted deposit in reach it stakes
   *  its plain pit; the road to where its first unit will dig joins its spur,
   *  so its rovers sinter both before they weld. */
  hubPlaced(b: BuildingState) {
    const s = this.state;
    const site = SITES[s.siteId];
    b.hub = newHubState();
    if (!choicesFor(s, this.mods, site, b, 1).some((c) => c.inReach && !c.target.plain)) stakeHubPit(s, this.mods, site, b);
    const best = choicesFor(s, this.mods, site, b, 1).find((c) => c.inReach);
    if (!best || !hasRoads(s)) return;
    const [fx, fz] = haulEnd(s, best.target);
    const plan = planLink(s, this.hf, null, cellAt(fx, fz), haulOpts(s, b, best.target));
    (b.hub.roads ??= {})[best.target.key] = { job: 0, at: s.simTime, ...(plan.reason ? { why: `NO HAUL ROAD — ${plan.reason}` } : {}) };
    if (plan.reason || !(plan.cells.length || plan.gate)) return;
    // planned from its door: its own spur's cells lead the plan, then the road on from the network
    const open = this.mode.openRoads;
    layPlan(s, plan, open);
    if (!open) b.spur = [...(b.spur ?? []), ...plan.cells.filter((k) => !(b.spur ?? []).includes(k))];
  }

  /** b.deposit: the deposit under the footprint centre (placement and load);
   *  an excavator's is the ground it digs, its pad's kept in its haul */
  stampDeposit(b: BuildingState) {
    const kind: DepositKind | undefined = this.hf.depositAt(...centerOf(b))?.kind;
    const h = b.type === 'excavator' ? b.haul : undefined;
    if (h) {
      if (kind) h.pad = kind; else delete h.pad;
      const dug = this.hf.depositAt(h.digX, h.digZ)?.kind;
      if (dug) b.deposit = dug; else delete b.deposit;
      return;
    }
    if (kind) b.deposit = kind;
    else delete b.deposit;
  }

  /** Dig at…: point an excavator at mapped ground (refused with the reason). */
  digAt(id: number, x: number, z: number) {
    const s = this.state;
    const b = s.buildings.find((o) => o.id === id);
    const tier = this.mods.surveyTier;
    const dep = this.hf.depositAt(x, z);
    const known = dep && depositRevealed(s, dep, tier) ? dep : null;
    const why = digRefusal(s, SITES[s.siteId], b, x, z, groundMapped(s, x, z, tier) || !!known, revealRadiusM(tier));
    if (why || !b) { alert(s, `CANNOT DIG THERE — ${why}`, 'warn'); return; }
    const no = setDigSite(s, this.mods, b, x, z, this.hf);
    if (no) { alert(s, `CANNOT DIG THERE — ${no}`, 'warn'); return; }
    this.stampDeposit(b);
    const [hx, hz] = centerOf(b);
    alert(s, `DIG SITE SET — ${BUILDINGS[b.type].name} #${b.id} digs ${groundName(b.deposit)} ` +
      `${Math.round(Math.hypot(x - hx, z - hz))} m from its pad`, 'info', { select: b.id });
  }

  /** Building on unmapped ground finds out what it is: PROSPECT STRUCK. */
  strike(b: BuildingState, d: Deposit) {
    const s = this.state;
    if (depositRevealed(s, d, this.mods.surveyTier)) return;
    s.survey.struck.push(d.id);
    this.revealedIds.add(d.id);
    this.revealedRev++; // the owner redraws the rings
    alert(s, `PROSPECT STRUCK — ${BUILDINGS[b.type].name} #${b.id} is on ${DEPOSIT_INFO[d.kind].name} ` +
      `(${strikeEffect(d.kind, this.mods)})`, 'info', { select: b.id }, 'field');
  }

  /** After a tick, a tech or a load: completed masts map their ground, and
   *  anything newly revealed is announced unless loading. Returns the deposits
   *  newly revealed since the last sync; the owner redraws its rings when
   *  `revealedRev` moved (Game.syncDepositsWorld). */
  syncDeposits(announce: boolean): Deposit[] {
    const s = this.state;
    revealDeposits(s, this.hf.deposits);
    const tier = this.mods.surveyTier;
    const now = this.hf.deposits.filter((d) => depositRevealed(s, d, tier));
    this.syncZones(now);
    const fresh = now.filter((d) => !this.revealedIds.has(d.id));
    if (!fresh.length && this.depositsSynced) return fresh;
    this.depositsSynced = true;
    this.revealedIds = new Set(now.map((d) => d.id));
    this.revealedRev++;
    if (!announce || !fresh.length) return fresh;
    const count = new Map<DepositKind, number>();
    for (const d of fresh) count.set(d.kind, (count.get(d.kind) ?? 0) + 1);
    const list = [...count].map(([k, n]) => `${DEPOSIT_INFO[k].name}${n > 1 ? ` ×${n}` : ''}`).join(' · ');
    alert(s, `DEPOSITS MAPPED — ${list} · overlay [I]`, 'info', undefined, 'field');
    return fresh;
  }

  /** The extraction zones are the deposits the player sees (core/zones.ts):
   *  auto roads stop at their rims from now on. */
  syncZones(revealed = this.hf.deposits.filter((d) => depositRevealed(this.state, d, this.mods.surveyTier))) {
    const s = this.state;
    const prev = s.zones ?? [];
    // the deposits' zones, then the staked plain pits' (docs/17 §8.6), then the carved pits'
    const deps = zonesFrom(prev.filter((z) => z.kind !== 'plain'), revealed);
    const next = [...deps.filter((z) => z.kind !== 'pit'), ...plainZones(s), ...deps.filter((z) => z.kind === 'pit')];
    if (s.zones && prev.length === next.length && prev.every((z, i) => z.id === next[i].id)) return;
    s.zones = next;
    bumpRoads(s);
  }

  /** Settlers take agent-run stations in the order the economy staffs them,
   *  as far as free hands reach; the rest stay agent-run rather than idle. */
  crewAllStations() {
    const s = this.state;
    if (s.crew <= 0 || !canToggleCrew(s.expedition, s.crew, this.mods)) {
      alert(s, 'CANNOT CREW — no one aboard yet; stations stay agent-run', 'warn');
      return;
    }
    const seats = (b: BuildingState) => Math.max(0, BUILDINGS[b.type].crew + this.mods.crewDelta[b.type]);
    const stations = s.buildings.filter((b) =>
      BUILDINGS[b.type].crew > 0 && b.enabled && (b.construction ?? 0) <= 0);
    let free = s.crew;
    for (const b of stations) if (!b.automated) free -= seats(b);
    let crewed = 0;
    let left = 0;
    for (const b of stations.sort((x, y) => x.priority - y.priority || x.id - y.id)) {
      if (!b.automated) continue;
      if (seats(b) <= free) {
        free -= seats(b);
        b.automated = false;
        crewed++;
      } else {
        left++;
      }
    }
    if (crewed === 0) {
      alert(s, 'NO FREE HANDS — every settler already has a station', 'warn');
      return;
    }
    alert(s, `CREWED — ${crewed} station${crewed === 1 ? '' : 's'} handed to the settlers` +
      (left ? `; ${left} stay${left === 1 ? 's' : ''} agent-run for want of hands` : ''), 'info');
  }

  /** Dynamic Clocking: ×1.5 draw, inputs, outputs and data on one machine;
   *  it trips itself at WORN (economy step 6). */
  setOverclock(id: number, on: boolean) {
    const s = this.state;
    const b = s.buildings.find((x) => x.id === id);
    if (!b) return;
    const name = `${BUILDINGS[b.type].name} #${b.id}`;
    if (!this.mods.actions.has('overclock')) {
      alert(s, `NEEDS ${TECHS.dynamicClocking.name} — research it to overclock`, 'warn');
    } else if (!OVERCLOCKABLE.includes(b.type)) {
      alert(s, `CANNOT OVERCLOCK — the ${BUILDINGS[b.type].name} has no clock to push`, 'warn');
    } else if (on && (b.construction ?? 0) > 0) {
      alert(s, `CANNOT OVERCLOCK — ${name} is still under construction`, 'warn');
    } else if (on && b.wear >= OVERCLOCK.tripWear) {
      alert(s, `CANNOT OVERCLOCK — ${name} is WORN; paid upkeep heals it first`, 'warn');
    } else {
      b.overclock = on;
    }
  }

  /** Sell banked data to Earth for cargo, through the one shipment slot. */
  doDownlink() {
    const s = this.state;
    const cost = downlinkCost(s);
    if (!this.mods.actions.has('downlink')) {
      alert(s, `NEEDS ${TECHS.teleoperation.name} — the downlink rides the teleoperation link`, 'warn');
      return;
    }
    if (s.resupply?.pending) {
      alert(s, 'SHIPMENT ALREADY EN ROUTE — one launch window at a time', 'warn');
      return;
    }
    if (s.data < cost) {
      alert(s, `DOWNLINK NEEDS ${cost}≡ BANKED — have ${Math.floor(s.data)}`, 'warn');
      return;
    }
    // a flare's comms blackout (docs/16 §4.8): no link to sell over until it lifts
    if (commsDark(s)) {
      alert(s, 'DOWNLINK WAITS — the flare’s comms blackout: the Earth link is down', 'warn');
      return;
    }
    // the Lander is the Earth gateway (docs/14 §3.5): air-gapped, it has no link to sell over
    if (s.buildings.some((b) => b.type === 'lander' && b.airGapped)) {
      alert(s, 'DOWNLINK NEEDS THE EARTH LINK — the Lander is air-gapped; reconnect it in its inspector', 'warn');
      return;
    }
    s.data -= cost;
    s.downlinks += 1;
    s.resupply = { ...(s.resupply ?? { shipments: 0 }), pending: true, downlink: true, arriveAt: s.simTime + DOWNLINK.delayS };
    const cargo = Object.entries(DOWNLINK.cargo)
      .map(([rid, amt]) => `${amt}${RESOURCES[rid as ResourceId].glyph}`).join(' ');
    alert(s, `DOWNLINK SENT — ${cost}≡ to Earth; ${cargo} lands in ${fmtClock(DOWNLINK.delayS)}`,
      'info', landerAction(s));
  }

  /** A volley by hand: the economy's own launch (docs/14 §2.7: Crewed
   *  Mission Control's 2↑ volleys, Autonomous Cadence's burst). */
  doLaunch() {
    const s = this.state;
    const refused = launchVolley(s, this.mods);
    if (refused) { alert(s, refused, 'warn'); return; }
    this.out.launches++;
  }

  /** Remove a building for the usual refund (½, or all of an untouched site). */
  demolishBuilding(id: number) {
    const s = this.state;
    const i = s.buildings.findIndex((b) => b.id === id);
    if (i < 0 || s.buildings[i].type === 'lander') return;
    const b = s.buildings[i];
    dropSpur(s, b);
    for (const [rid, amt] of Object.entries(demolishRefund(b, SITES[s.siteId]))) {
      s.resources[rid as keyof typeof s.resources] += amt ?? 0;
    }
    s.buildings.splice(i, 1);
    this.out.buildings = true;
    this.out.wrecked.push(id);
  }

  // ─────────────────────────── the Builder ───────────────────────────

  /** Pick a site and place one auto building (an order's or a rule's). */
  /** Pick a site and place there through the player's own place action (the
   *  same validity, cost, pad, floater — and whatever else a placement does,
   *  like its road). A site the action refuses is skipped for the next best. */
  placeAuto(type: BuildingId, intent: SiteIntent, automated: boolean): { b: BuildingState; why: string } | string {
    const s = this.state;
    const site = SITES[s.siteId];
    const skip: string[] = [];
    let refused = '';
    for (let n = 0; n < AUTO.placeTries; n++) {
      const pick = chooseSite(s, this.mods, site, this.hf, { type, intent, survey: this.mods.siteSurvey, skip });
      if ('refusal' in pick) return refused ? `${pick.refusal} (the nearer sites: ${refused})` : pick.refusal;
      this.lastPlace = null;
      this.apply({ kind: 'place', type, gx: pick.gx, gz: pick.gz, rot: pick.rot, builder: { automated } });
      const b = this.lastPlace as BuildingState | string | null;
      this.lastPlace = null;
      if (b && typeof b !== 'string') {
        if (pick.dig) b.auto = { by: 'rule', at: s.simTime, why: pick.why, dig: pick.dig };
        return { b, why: pick.why };
      }
      refused = typeof b === 'string' ? b : 'refused';
      skip.push(`${pick.gx},${pick.gz},${pick.rot}`);
    }
    return `no ${BUILDINGS[type].name} site the rovers can reach in ${AUTO.placeTries} tries: ${refused}`;
  }

  /** The order action: place up to `count` now; the rest skip (or, with
   *  Build Orders, wait in the order book). Orders obey what a click obeys. */
  fillOrder(type: BuildingId, count: number, intent: SiteIntent) {
    const s = this.state;
    const site = SITES[s.siteId];
    const name = BUILDINGS[type].name;
    const refusal = orderRefusal(s, this.mods, site, type);
    if (refusal) { alert(s, `ORDER REFUSED — ${refusal}`, 'warn'); return; }
    const n = Math.max(1, Math.min(this.mods.orderMax, Math.round(count)));
    const order = newOrder(s, type, n, { res: intent.res, like: intent.like });
    const placed: BuildingState[] = [];
    const whys: string[] = [];
    let stop = '';
    for (let i = 0; i < n; i++) {
      stop = budgetShort(s, this.mods, site, type, { by: 'order' });
      if (stop) break;
      const crew = crewPlan(s, this.mods, type);
      const r = this.placeAuto(type, { ...intent, rule: 'order', ...(type === 'relayMast' ? { edge: true } : {}) }, crew.automated);
      if (typeof r === 'string') { stop = r; break; }
      r.b.auto = { by: 'order', order: order.id, at: s.simTime, why: r.why, survey: this.mods.siteSurvey, ...(r.b.auto?.dig ? { dig: r.b.auto.dig } : {}) };
      order.placed.push(r.b.id);
      placed.push(r.b);
      whys.push(`#${r.b.id} ${r.why}`);
      logAuto(s, `${name} #${r.b.id} · order #${order.id} · ${r.why}`, r.b.id);
    }
    const left = n - placed.length;
    const noHands = placed.length && crewPlan(s, this.mods, type).refusal ? ' · no free hands: it idles until crewed (or set Autonomous)' : '';
    const hold = left > 0 && this.mods.orderBook > 0 && !/no valid ground/.test(stop);
    if (hold) {
      if (s.auto.orders.length >= AUTO.bookMax) {
        alert(s, `ORDER BOOK FULL — ${s.auto.orders.length}/${AUTO.bookMax} open; cancel one first` +
          (placed.length ? ` · ${placed.length} ${name}${placed.length === 1 ? '' : 's'} placed` : ''), 'warn', { panel: 'builder' });
        return;
      }
      order.waiting = stop;
      s.auto.orders.push(order);
    }
    if (!placed.length && !hold) {
      alert(s, `ORDER REFUSED — ${stop}`, 'warn');
      return;
    }
    const head = `ORDER — ${placed.length} ${name}${placed.length === 1 ? '' : 's'} placed` +
      (whys.length ? ` (${whys.join('; ')})` : '');
    const tail = left <= 0 ? '' : hold ? ` · ${left} held in the order book: ${stop}` : ` · ${left} skipped: ${stop}`;
    alert(s, head + tail + noHands, left > 0 && !hold ? 'warn' : 'info', placed[0] ? { select: placed[0].id } : { panel: 'builder' });
  }

  /** What economy step 12 asked for: place, demolish, dig. */
  resolveBuild(reqs: AutoRequest[]) {
    const s = this.state;
    const site = SITES[s.siteId];
    for (const req of reqs) {
      if (req.kind === 'demolish') {
        const old = s.buildings.find((b) => b.id === req.id);
        if (!old) continue;
        const refund = Object.entries(demolishRefund(old, site)).filter(([, n]) => (n ?? 0) > 0)
          .map(([rid, n]) => `${n}${RESOURCES[rid as ResourceId].glyph}`).join(' ');
        this.demolishBuilding(old.id);
        alert(s, `REPLACED — ${BUILDINGS[old.type].name} #${old.id} (WORN ${Math.round(old.wear * 100)}%) ${req.why}; #${old.id} demolished, ½ refunded${refund ? ` (${refund})` : ''}`,
          'info');
        continue;
      }
      if (req.kind === 'unit') {
        const b = s.buildings.find((x) => x.id === req.hub);
        const why = queueJob(s, this.mods, site, b, 'unit', 'rule');
        if (!why && b) logAuto(s, `a unit queued at ${BUILDINGS[b.type].name} #${b.id} · ${req.why}`, b.id);
        continue;
      }
      if (req.kind === 'dig' || req.kind === 'feed') {
        const b = s.buildings.find((x) => x.id === req.id);
        if (!b || b.type !== 'excavator') continue;
        let x: number, z: number, note: string;
        if (req.kind === 'dig') { x = req.x; z = req.z; note = 'as Site Survey AI planned'; } else {
          const p = feedPlan(s, this.mods, site, this.hf, b);
          if (!p) continue;
          x = p.x; z = p.z; note = `Feed Planner: +${Math.round(p.gain * 100)}% feed value`;
        }
        const tier = this.mods.surveyTier;
        const dep = this.hf.depositAt(x, z);
        const known = dep && depositRevealed(s, dep, tier) ? dep : null;
        const why = digRefusal(s, site, b, x, z, groundMapped(s, x, z, tier) || !!known, revealRadiusM(tier));
        if (why) continue;
        if (setDigSite(s, this.mods, b, x, z, this.hf)) continue; // no haul road to it (docs/15-roads.md)
        this.stampDeposit(b);
        const [hx, hz] = centerOf(b);
        alert(s, `AUTO DIG — ${BUILDINGS[b.type].name} #${b.id} digs ${groundName(b.deposit)} ` +
          `${Math.round(Math.hypot(x - hx, z - hz))} m from its pad (${note})`, 'info', { select: b.id });
        continue;
      }
      // place: the budget again (an earlier request this tick may have spent it)
      const short = budgetShort(s, this.mods, site, req.type, {
        by: req.by === 'order' ? 'held' : 'rule', bypassReserve: req.bypass?.reserve || req.rule === 'replace',
      });
      if (short) { recordRefused(s, req, short); continue; }
      const crew = crewPlan(s, this.mods, req.type);
      const r = this.placeAuto(req.type, req.intent, crew.automated);
      // a runaway rule's junk site (docs/14 §3.5): tagged, never the rule's own bookkeeping
      if (req.junk !== undefined) {
        if (typeof r === 'string') continue;
        r.b.junk = req.junk;
        r.b.junkAt = s.simTime;
        r.b.auto = { by: 'rule', rule: req.rule, at: s.simTime, why: `RULE DRIFT — junk, ${r.why}` };
        logAuto(s, `junk ${BUILDINGS[r.b.type].name} #${r.b.id} · the drifting rule · ${r.why}`, r.b.id);
        alert(s, `JUNK SITE — ${BUILDINGS[r.b.type].name} #${r.b.id} ordered by the drifting rule · cancel it within 20 s for a full refund`,
          'warn', { select: r.b.id });
        continue;
      }
      if (typeof r === 'string') {
        recordRefused(s, req, r);
        if (req.by === 'order') continue;
        continue;
      }
      const dig = r.b.auto?.dig;
      recordPlaced(s, req, r.b, r.why, this.mods.siteSurvey);
      if (dig && r.b.auto) r.b.auto.dig = dig;
      // the Governor: a life-support or power crisis jumps the rover queue
      if (req.crisis && this.mods.governor) this.apply({ kind: 'buildNext', id: r.b.id });
    }
  }

  /** One economy tick, as the live loop and the debug fast-forward both run it:
   *  the tick, the mods it changed, the Builder's requests, the deposits. */
  econStep() {
    const launches = this.state.launches;
    const ev = economyTick(this.state, SITES[this.state.siteId], this.mods, 1);
    // Autonomous Cadence fired a volley inside the tick: the rail shows it
    if (this.state.launches > launches) this.out.launches++;
    if (ev.modsChanged) this.mods = modsFor(this.state);
    // a hazard wrecked something (docs/14 §3.10): the world forgets it
    if (ev.wrecked?.length) this.out.wrecked.push(...ev.wrecked);
    if (ev.build.length) this.resolveBuild(ev.build);
    this.syncDeposits(true);
    return ev;
  }
}
