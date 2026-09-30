/** A rival program (docs/20 §4.5): another faction's base on the same Moon, a real `BaseSim` nobody draws. It runs the
 *  economy on a flat stand-in ground (`FlatHeights`), with straight legs, no traffic and virtual pits
 *  (`HEADLESS_MODE`), ticks once per Moon second in lockstep with the player's base (dt is always 1), plays its faction and
 *  writes its standing to `moon.race`.
 *
 *  THE MIND (stream S4). A rival is run by the same Builder the player can switch on, relaxed to play a whole base:
 *   - at landing every rule is on, at its faction's caps, and the mods it computes are pushed through `rivalMods` each time
 *     they are recomputed (`BaseSim.modsHook`): every Builder family, rules may build everything and found the first of a
 *     kind (`builderFounds`), Autonomous Cadence, AUTO SURVEY on;
 *   - every RESEARCH_EVERY seconds it fills its research queue from `FACTIONS[f].policy` (destiny picks and doctrines
 *     first, then the priority list, the faction's own techs, then what is cheapest);
 *   - every ORDERS_EVERY seconds it places what no rule builds (`policy.orders`: labs, Data Centers, mass driver …) through
 *     the same order action a click takes, which obeys the budget;
 *   - every CLAIMS_EVERY seconds it claims the best surveyed prospect it can pay for, by `policy.claimKinds` then distance.
 *  Nothing here reads a clock or a random number: every cadence is a function of the state's own `simTime`, so a rival
 *  loaded from a save and stepped on plays exactly what the one that never saved did. A rival never gets a free resource. */
import { BaseSim } from './baseSim';
import { HEADLESS_MODE } from './simMode';
import { onFeed, pushFeed, type MoonState } from './moon';
import { hashString } from './rng';
import type { GameState } from './state';
import type { Mods } from './mods';
import { alert, missionLost } from './economy';
import { modsFor } from './mods';
import {
  enqueue, enqueuePath, goodsShortfall, isDoctrineHere, techAvailability, techCost, techVisible, resolveTech,
} from './research';
import { budgetShort, orderRefusal, powerBook, ruleState } from './automation';
import { chooseSite } from './siting';
import { claimRefusal, prospectDist, KIND_LABEL, type RivalInfo } from './exploration';
import { SITES, type SiteId } from '../data/sites';
import type { ResourceId } from '../data/resources';
import { FACTIONS, FACTION_NAME, FACTION_ORDER, type FactionId } from '../data/factions';
import { DOCTRINES, DOCTRINE_ORDER, ERA_NAMES, TECHS, TECH_ORDER, TRACKS, type Era, type Side, type TechId } from '../data/techs';
import { FAMILY_PRIORITY, RULE_ORDER, RULES, type AutoRuleId } from '../data/automation';
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { PROSPECTS, PROSPECT_IDS, type ProspectId, type OutpostKind } from '../data/lunarMap';
import { NIGHT_S, QUEUE_MAX } from '../data/balance';
import { HZ } from '../data/hazards';

/** A rival's seed: the Moon's seed mixed with its faction (its ground's deposits, every base-local draw). The
 *  PLAYER's base keeps the game's own seed, so a faction game on a site has the terrain of the solo game on it. */
export const rivalSeed = (moonSeed: number, faction: FactionId, salt = 0): number =>
  (moonSeed ^ hashString(faction) ^ (salt ? Math.imul(salt, 0x9e3779b1) : 0)) >>> 0;

/** Can a base stand on the flat ground this seed draws at this site? A deposit zone now and then covers the end of the Lander's road
 *  stub (the generator keeps them 15 m off the Lander, the stub runs 16 m), and no road can start: the base could place nothing
 *  and would sit on its Lander for ever. A rival's seed is bumped (salt 1, 2, …: deterministic) until the first solar array finds a site. */
function groundWorks(siteId: SiteId, seed: number): boolean {
  const b = BaseSim.create({ siteId, seed, expedition: 'robotic', mode: HEADLESS_MODE, flat: true });
  const pick = chooseSite(b.state, b.mods, SITES[siteId], b.hf, { type: 'solar', intent: { rule: 'order' }, survey: false, skip: [] });
  return !('refusal' in pick);
}

/** How often a rival thinks, in Moon seconds (offsets keep the three from landing on one tick). */
export const RIVAL_CADENCE = { research: 30, orders: 20, ordersAt: 5, claims: 60, claimsAt: 40, life: 30, lifeAt: 10, hazards: 10, hazardsAt: 3 } as const;

/** The relaxations a rival's mods carry (`BaseSim.modsHook`): every Builder family (the rules the player unlocks one lane tech at a
 *  time), rules that may build destiny buildings, rules that found the first building of a kind, and Autonomous Cadence. */
export function rivalMods(m: Mods): void {
  m.autoFamilies = new Set(FAMILY_PRIORITY);
  m.builderAll = true;
  m.builderFounds = true;
  m.autoLaunch = true;
  m.automation = true;
}

/** Every rule on, at the faction's caps (landing): what the player's panel would show with the whole Builder unlocked. */
function switchOnRules(s: GameState, faction: FactionId): void {
  const caps = FACTIONS[faction].policy.ruleCaps;
  for (const id of RULE_ORDER) {
    const r = ruleState(s, id);
    r.on = true;
    const d = RULES[id];
    const cap = caps[id];
    if (cap !== undefined) r.cap = Math.min(d.capRange[1], Math.max(d.capRange[0], Math.round(cap)));
  }
  // every family is "already unlocked": no per-family BUILDER banner a player would read
  for (const f of FAMILY_PRIORITY) if (!s.auto.families.includes(f)) s.auto.families.push(f);
}

/** Guardianship (S3's `rivalAid`): when another program suffers a disaster (its crew lost, a hearing) the watch sits it and the data comes to the
 *  player whose base carries the tech (`mods.rivalAidData`). Registered once; a reload replaces its own earlier copy. */
let rivalAidOff: (() => void) | null = null;
export function registerRivalAid(): void {
  rivalAidOff?.();
  rivalAidOff = onFeed('*', (e, { player }) => {
    if (e.kind !== 'lost' && e.kind !== 'hearing') return;
    if (e.faction === player.faction) return;
    const aid = modsFor(player).rivalAidData;
    if (aid <= 0) return;
    player.data += aid;
    alert(player, `GUARDIANSHIP — ${FACTION_NAME[e.faction]} is in trouble; the Commons sit the watch: +${aid}≡ of their telemetry`, 'info', { panel: 'race' }, 'race', undefined, e.faction);
  });
}
registerRivalAid();

export class RivalProgram {
  /** Does a rival have a mind? On always, but a spec that drives a rival by hand (`debug.setRivalMind(false)`, before the game starts) wants the
   *  passive base of stream W0i: no Builder relaxations, no rules on, no policy. Not part of any state. */
  static mind = true;
  readonly faction: FactionId;
  readonly base: BaseSim;
  readonly moon: MoonState;
  /** whole steps this program has run (the debug counters read it) */
  steps = 0;

  private constructor(faction: FactionId, base: BaseSim, moon: MoonState) {
    this.faction = faction;
    this.base = base;
    this.moon = moon;
    // the mods it computes from now on carry the Builder's relaxations (and the ones it has now do)
    if (RivalProgram.mind) {
      base.modsHook = rivalMods;
      rivalMods(base.mods);
    }
  }

  /** A faction lands: its base on `siteId`, its clock starting at `landedAt + 90` (mid-morning of its landing day). The Builder
   *  is on, at its caps, before the first step. */
  static land(faction: FactionId, moon: MoonState, siteId: SiteId, landedAt: number): RivalProgram {
    let seed = rivalSeed(moon.seed, faction);
    for (let salt = 1; salt <= 12 && !groundWorks(siteId, seed); salt++) seed = rivalSeed(moon.seed, faction, salt);
    const base = BaseSim.create({
      siteId, seed, expedition: FACTIONS[faction].expedition, faction, landedAt, mode: HEADLESS_MODE, flat: true, moon,
    });
    const r = new RivalProgram(faction, base, moon);
    if (RivalProgram.mind) switchOnRules(base.state, faction);
    r.report();
    return r;
  }

  /** A saved rival (the stripped state `save.ts` keeps): back on its ground and its Moon. Its rules and queue are in the state. */
  static fromState(faction: FactionId, state: GameState, moon: MoonState): RivalProgram {
    const r = new RivalProgram(faction, BaseSim.fromState(state, HEADLESS_MODE, moon, true), moon);
    r.base.clearOut();
    return r;
  }

  get state(): GameState { return this.base.state; }

  /** One Moon second: the economy step (the clock moves by 1 and the base ticks), the mailbox nobody reads emptied, the
   *  policy on its cadence, the standing written to the Moon. */
  step() {
    const s = this.base.state;
    const ev = this.base.tick();
    // a crewed base whose last crew died falls silent (economy.ts): it is lost, as the player's would be, and its ticks end there
    if (ev.defeat && !s.defeatShown) {
      s.defeatShown = true;
      pushFeed(this.moon, {
        faction: this.faction, kind: 'lost', era: s.era,
        text: `${FACTION_NAME[this.faction].toUpperCase()} HAS GONE SILENT — the last of its crew is lost`,
      });
    }
    this.base.clearOut();
    this.steps++;
    if (RivalProgram.mind && !missionLost(s)) this.think();
    this.report();
  }

  // ─────────────────────────── the policy ───────────────────────────

  /** The cadence is the state's own clock (whole seconds since its landing), so nothing needs saving. */
  private think() {
    const s = this.base.state;
    const t = Math.round(s.simTime - (s.landedAt ?? 0));
    if (t % RIVAL_CADENCE.research === 0) { this.research(); this.capHands(); this.lateCaps(); this.rationParts(); this.gate(); this.resupply(); }
    if (t % RIVAL_CADENCE.life === RIVAL_CADENCE.lifeAt) this.life();
    if (t % RIVAL_CADENCE.hazards === RIVAL_CADENCE.hazardsAt) this.hazards();
    if (t % RIVAL_CADENCE.orders === RIVAL_CADENCE.ordersAt) this.orders();
    if (t % RIVAL_CADENCE.claims === RIVAL_CADENCE.claimsAt) this.claims();
  }

  /** Keep the research queue full and in the faction's order. The order of wants: the era's destiny pick once three of its techs are in
   *  hand (it gates the next era and is one of the four the gate counts), the faction's priority list, its own techs, a doctrine and a pick
   *  the lists did not reach, then what is cheapest (this era's first). The queue is filled in that order, and the techs in it are kept
   *  in it too (data flows down the queue: a priority tech that was queued last still goes first), never ahead of a tech it needs. */
  private research() {
    const s = this.base.state;
    const mods = this.base.mods;
    const pol = FACTIONS[this.faction].policy;
    const done = new Set<TechId>(s.techsDone);
    const era = s.era;
    const order: TechId[] = [];
    const seen = new Set<TechId>();
    const want = (tid: TechId) => { if (!seen.has(tid) && TECHS[tid] && !done.has(tid)) { seen.add(tid); order.push(tid); } };
    // the era's pick, once three of the era's own techs are done or queued
    if (era >= 2) {
      let inHand = 0;
      for (const tid of TECH_ORDER) {
        const d = TECHS[tid];
        if (d.track || !(done.has(tid) || s.researchQueue.includes(tid))) continue;
        if (eraOf(s, tid) === era && techVisible(resolveTech(d, s.expedition, this.faction), s)) inHand++;
      }
      if (inHand >= 3) want(this.destinyPick(era as Era));
    }
    for (const tid of pol.research as TechId[]) if (this.wanted(tid)) want(tid);
    for (const tid of FACTIONS[this.faction].uniqueTechs) if (this.wanted(tid)) want(tid);
    for (let e = 2 as Era; e <= era; e = (e + 1) as Era) want(this.destinyPick(e));
    for (const g of DOCTRINE_ORDER) {
      if (DOCTRINES[g].era > era) continue;
      const pick = this.doctrinePick(g);
      if (pick) want(pick);
    }
    const rest = TECH_ORDER.filter((tid) => !seen.has(tid) && !done.has(tid) && this.wanted(tid));
    rest.sort((a, b) => eraOf(s, a) - eraOf(s, b) || techCost(a, s, mods).data - techCost(b, s, mods).data || TECH_ORDER.indexOf(a) - TECH_ORDER.indexOf(b));
    for (const tid of rest) want(tid);

    // fill
    for (const tid of order) {
      if (s.researchQueue.length >= QUEUE_MAX) break;
      if (s.researchQueue.includes(tid)) continue;
      const a = techAvailability(tid, s, mods);
      if (a.state === 'available') {
        if (!goodsHopeless(s, mods, tid)) enqueue(s, tid);
      } else if (a.state === 'requires' || a.state === 'requiresAny') {
        // the path's goods are checked one tech at a time as they come up; a path that does not fit the queue waits
        enqueuePath(s, tid);
      }
    }
    // keep the queue in the order of wants: a tech moves up past any that it does not need (and never out of a prerequisite's way)
    const q = s.researchQueue;
    if (q.length > 1) {
      const rank = new Map<TechId, number>();
      order.forEach((tid, i) => rank.set(tid, i));
      const at = (tid: TechId) => rank.get(tid) ?? order.length;
      for (let i = 1; i < q.length; i++) {
        for (let j = i; j > 0 && at(q[j - 1]) > at(q[j]) && !needs(q[j], q[j - 1]); j--) [q[j - 1], q[j]] = [q[j], q[j - 1]];
      }
    }
  }

  /** May this tech be queued on the faction's own account? A doctrine member only if it is the faction's pick of its group, a
   *  destiny pick only if it is the faction's side of its era (the other side is never researched). */
  private wanted(tid: TechId): boolean {
    const def = TECHS[tid];
    if (!def) return false;
    if (FACTIONS[this.faction].policy.skip?.includes(tid)) return false;
    const s = this.base.state;
    if (def.track && !def.track.landing) return this.destinyPick(def.track.era) === tid;
    if (def.exclusive && isDoctrineHere(def, s)) return this.doctrinePick(def.exclusive) === tid;
    return true;
  }

  /** The faction's side for an era's destiny pick (`policy.destiny`: one side, a side per era, or the landing's own). */
  private sideOf(era: Era): Side {
    const d = FACTIONS[this.faction].policy.destiny;
    if (typeof d === 'string') return d;
    return d[era] ?? TECHS[FACTIONS[this.faction].landingTech].track?.side ?? 'automation';
  }
  private destinyPick(era: Era): TechId { return TRACKS[era][this.sideOf(era)]; }

  /** The tech the faction takes for a doctrine group: its policy's pick, else the cheaper visible member. */
  private doctrinePick(g: keyof typeof DOCTRINES): TechId | null {
    const s = this.base.state;
    const members = DOCTRINES[g].members.filter((m) => techVisible(resolveTech(TECHS[m], s.expedition, this.faction), s));
    // (a group with one visible member here is no doctrine: it is an ordinary tech the lists reach)
    if (members.length < 2) return null;
    const set = FACTIONS[this.faction].policy.doctrines[g];
    if (set && members.includes(set)) return set;
    return [...members].sort((a, b) => techCost(a, s).data - techCost(b, s).data)[0];
  }

  /** A crewed base with no Construction Robotics has only its own hands, and they are shared out by priority (life support first, the labs
   *  last): a base that lets its rules add a second smelter, a second farm and a water plant on top has no hand left for the lab, so no
   *  research, so no agents, for ever. Until the agents come, the rules that add crewed stations stop at what stands (the first of each
   *  is the orders'; a lab's cap is the labs ordered); their caps open with Construction Robotics. */
  private capHands() {
    const s = this.base.state;
    if (s.expedition === 'robotic') return;
    const caps = FACTIONS[this.faction].policy.ruleCaps;
    const free = !!this.base.mods.automation;
    for (const id of HAND_RULES) {
      const r = ruleState(s, id);
      const d = RULES[id];
      const cap = Math.min(d.capRange[1], Math.max(d.capRange[0], Math.round(caps[id] ?? d.cap)));
      if (free) { r.cap = cap; continue; }
      let n = 0;
      for (const b of s.buildings) if (b.type === RULE_TYPE[id]) n++;
      r.cap = Math.max(1, Math.min(cap, n));
    }
  }

  /** Past Era RIVAL_LATE_ERA the base's night and a volley's burst need a bigger bank and baseload than the Builder's stock caps allow
   *  (`policy.lateCaps`: the caps only ever go up). */
  private lateCaps() {
    const s = this.base.state;
    if (s.era < RIVAL_LATE_ERA) return;
    for (const [id, cap] of Object.entries(FACTIONS[this.faction].policy.lateCaps) as [AutoRuleId, number][]) {
      const r = ruleState(s, id);
      r.cap = Math.max(r.cap, Math.min(RULES[id].capRange[1], Math.max(RULES[id].capRange[0], Math.round(cap))));
    }
  }

  /** Is the base standing on its own feet? A crewed base's three life-support stocks would each last 40 minutes at their present rate (or are
   *  not falling), and, until its parts fabricator stands, the parts cache holds 40. An unstable base builds what steadies it (power,
   *  smelter, farm, water, parts, the first lab) and nothing else: growth on a base that is starving for parts, water or air is how a
   *  rival built twenty solar arrays and a fifth lab and died of thirst. */
  private stable(ignoreNight = false): boolean {
    const s = this.base.state;
    if (s.crew > 0 && s.expedition !== 'robotic') {
      for (const res of ['oxygen', 'food', 'water'] as const) {
        const net = s.rates[res] ?? 0;
        if (net < -1e-6 && s.resources[res] / -net < STABLE_S) return false;
      }
    }
    // a site with no night sun carries the night on its bank: loads are added only while the bank covers half of it (the lights go out
    // for the farms first, and a crop that goes dark is lost)
    if (!ignoreNight && s.expedition !== 'robotic' && SITES[s.siteId].nightSolarFraction < 0.5) {
      const pb = powerBook(s, this.base.mods);
      if (pb.nightShort > 0 && s.power.capacity < pb.nightShort * NIGHT_S * STABLE_NIGHT) return false;
    }
    // a late base whose day's supply does not cover its load stops adding loads (labs, Data Centers, bays): it fills a bank before it grows
    if (s.era >= LOADED_ERA) {
      const pb = powerBook(s, this.base.mods);
      if (pb.full < pb.load * LOADED_MARGIN) return false;
    }
    return s.resources.parts >= STABLE_PARTS || s.buildings.some((b) => b.type === 'partsFab' && (b.construction ?? 0) <= 0);
  }

  /** The Builder's growth rules wait while the base is unstable (they come back on with it). */
  private gate() {
    const s = this.base.state;
    const ok = this.stable();
    const labs = ok || (this.bankless() && this.stable(true));
    for (const id of GROWTH_RULES) ruleState(s, id).on = id === 'lab' ? labs : ok;
    if (labs && !ok) { const r = ruleState(s, 'lab'); r.cap = Math.min(r.cap, BANKLESS_LABS); }
  }

  /** A crewed base on a site with no night sun and no Battery Storage yet: the night's bank it would wait for cannot exist until the
   *  labs have researched it, so the first BANKLESS_LABS labs are not held back by it (one lab alone took the whole twelve days to get there). */
  private bankless(): boolean {
    const s = this.base.state;
    return s.expedition !== 'robotic' && SITES[s.siteId].nightSolarFraction < 0.5 && !this.base.mods.unlocked.has('battery');
  }

  /** Earth sends 40 parts and 60 metals a lunar day after the order (the player's own Lander action): a base with no parts fabricator yet
   *  and a cache under 70 orders it, twice at the most (each later order waits a day longer). */
  private resupply() {
    const s = this.base.state;
    if (s.resupply?.pending || (s.resupply?.ordered ?? 0) >= 2) return;
    if (s.resources.parts >= RESUPPLY_PARTS || s.buildings.some((b) => b.type === 'partsFab' && (b.construction ?? 0) <= 0)) return;
    this.base.apply({ kind: 'orderResupply' });
  }

  /** The spare-parts cache is all a base has until its parts fabricator stands, and every hopper survey spends some of it: AUTO SURVEY
   *  waits for the fabricator (or a cache that can pay for the flight and keep 60, as the pacing probe's player does). */
  private rationParts() {
    const s = this.base.state;
    const fab = s.buildings.some((b) => b.type === 'partsFab' && (b.construction ?? 0) <= 0);
    ruleState(s, 'autoSurvey').on = fab || s.resources.parts >= SURVEY_PARTS_FLOOR;
  }

  /** Keeping the crew alive comes before everything (a crewed base only). When a life-support stock would run out within LIFE_RUNWAY_S
   *  at the rate it is falling, and nothing that makes it is being built, one more maker is ordered: a smelter for oxygen, a
   *  hydroponics farm for food, a water plant for water. The order action does not look for free hands (the Builder's rules do, and
   *  a base whose labs hold them would wait forever): the crew is shared out by priority each tick, so the new maker is staffed
   *  and the labs are the ones that stand idle. */
  private life() {
    const b = this.base;
    const s = b.state;
    if (s.expedition === 'robotic' || s.crew <= 0) return;
    const mods = b.mods;
    const site = SITES[s.siteId];
    const plan: [ResourceId, BuildingId][] = [['oxygen', 'smelter'], ['water', 'waterPlant'], ['food', 'hydroponics']];
    for (const [res, type] of plan) {
      const net = s.rates[res] ?? 0;
      if (net >= -1e-6 || s.resources[res] / -net > LIFE_RUNWAY_S) continue;
      if (!mods.unlocked.has(type)) continue;
      let have = 0, building = 0;
      for (const x of s.buildings) if (x.type === type) { have++; if ((x.construction ?? 0) > 0) building++; }
      if (building > 0 || have >= (mods.automation ? (LIFE_MAX[type] ?? 0) : 1)) continue;
      if (have === 0 && s.simTime - (s.landedAt ?? 0) < 90) continue; // (the opening orders place the first ones)
      const crisis = s.resources[res] / -net < CRISIS_S;
      if (!handsFor(s, mods, type, crisis)) continue;
      if (orderRefusal(s, mods, site, type) || budgetShort(s, mods, site, type, { by: 'order' })) continue;
      b.apply({ kind: 'order', type, count: 1 });
    }
  }

  /** The answers to the hazards that have a free or cheap counter (docs/14 §3.7), through the same counter action the player's buttons
   *  take: a fouled water loop is flushed (it would poison one of the crew a lunar day until then), a breach sealed (a rover and a few
   *  parts) or, when that is refused, evacuated, a blight quarantined, a cascade shed, a firmware rollout held or the fleet docked for a
   *  flare's push, rogue drones killed at their dock, a hacked outpost's keys rotated, a cabin-fever crew given a Commons night.
   *  A drill (the first of a kind) cannot hurt and is left alone. */
  private hazards() {
    const b = this.base;
    const s = b.state;
    if (!s.hazards?.live.length && !s.buildings.some((x) => x.infected)) return;
    const now = s.simTime;
    for (const h of [...(s.hazards?.live ?? [])]) {
      if (h.drill) continue;
      switch (h.kind) {
        case 'contamination':
          if (h.phase === 'active' && h.used.flush === undefined && s.crew > 0) b.apply({ kind: 'counter', counter: 'flush' });
          break;
        case 'breach':
          if (s.crew > 0 && h.used.seal === undefined && h.used.evacuate === undefined) {
            b.apply({ kind: 'counter', counter: 'seal', id: h.id });
            if (h.used.seal === undefined) b.apply({ kind: 'counter', counter: 'evacuate', id: h.id });
          }
          break;
        case 'blight':
          if (h.used.quarantine === undefined) b.apply({ kind: 'counter', counter: 'quarantine', id: h.id });
          break;
        case 'cascade':
          if (s.crew > 0 && h.used.shedLoads === undefined) b.apply({ kind: 'counter', counter: 'shedLoads' });
          break;
        case 'firmware':
          if (h.phase === 'telegraph') {
            const c = h.flare ? 'dockFleet' : 'holdRollout';
            if (h.used[c] === undefined) b.apply({ kind: 'counter', counter: c });
          }
          break;
        case 'runaway': // a hijacked rule orders junk: the Builder holds every rule for a minute or two
          if (h.used.freezeRules === undefined) b.apply({ kind: 'counter', counter: 'freezeRules' });
          break;
        case 'rogueDrones':
          if (h.used.killSwitch === undefined) b.apply({ kind: 'counter', counter: 'killSwitch', id: h.id });
          break;
        case 'hackedOutpost':
          if (h.used.rotateKeys === undefined) b.apply({ kind: 'counter', counter: 'rotateKeys', id: h.id });
          break;
        case 'cabinFever':
          if (s.crew > 0 && h.used.commonsNight === undefined) b.apply({ kind: 'counter', counter: 'commonsNight' });
          break;
        default: break;
      }
    }
    // malware: a worm is starved by air-gapping the node it names before it unpacks (free; the node is joined to the network again as soon
    // as the warning is over), and what slipped through is reimaged when the 40≡ happen to be in the pool
    const worm = (s.hazards?.live ?? []).find((h) => h.kind === 'malware');
    if (worm && !worm.drill && worm.phase === 'telegraph' && worm.target !== null) {
      const t = s.buildings.find((x) => x.id === worm.target);
      if (t && !t.airGapped) b.apply({ kind: 'airGap', id: t.id, on: true });
    }
    for (const x of s.buildings) if (x.airGapped && !(worm && worm.target === x.id)) b.apply({ kind: 'airGap', id: x.id, on: false });
    const sick = s.buildings.find((x) => x.infected && (x.reimageUntil ?? 0) <= now);
    if (sick && s.data >= HZ.malware.reimage.data) b.apply({ kind: 'counter', counter: 'reimage', id: sick.id });
  }

  /** Power comes before growth: the day's supply stays ahead of what runs, what is being built and the bank's recharge (the pacing probe's
   *  reasonable player does the same, from the same book as the Builder's solar rule; the rule itself waits to see a shortfall, dwells,
   *  cools down and builds one array at a time, and a base that browns out cannot build the parts that would end it), and the bank
   *  carries the night on a site with no night sun. Returns whether it placed something (one building a turn). */
  private power(): boolean {
    const b = this.base;
    const s = b.state;
    const mods = b.mods;
    const site = SITES[s.siteId];
    const pb = powerBook(s, mods);
    let solar = 0, solarSites = 0, batteries = 0, batterySites = 0;
    for (const x of s.buildings) {
      const site0 = (x.construction ?? 0) > 0;
      if (x.type === 'solar') { solar++; if (site0) solarSites++; } else if (x.type === 'battery') { batteries++; if (site0) batterySites++; }
    }
    const kw = 10 * mods.powerMult.solar * site.solarDayMult;
    const capS = ruleState(s, 'solar').cap * mods.builderCapMult;
    if (pb.full + solarSites * kw < (pb.load + pb.pending) * POWER_MARGIN + pb.recharge && solarSites < 2 && solar < capS) {
      if (!orderRefusal(s, mods, site, 'solar') && !budgetShort(s, mods, site, 'solar', { by: 'order' })) {
        b.apply({ kind: 'order', type: 'solar', count: 1 });
        return true;
      }
    }
    // the night: a site with no night sun runs it on the bank
    if (site.nightSolarFraction < 0.5 && mods.unlocked.has('battery') && batterySites < 2) {
      const per = (BUILDINGS.battery.storageKWh ?? 0) * mods.batteryCapMult;
      const want = pb.nightShort * NIGHT_S * NIGHT_COVER;
      const capB = ruleState(s, 'battery').cap * mods.builderCapMult;
      if (s.power.capacity < want && batteries < capB && per > 0 && !orderRefusal(s, mods, site, 'battery') && !budgetShort(s, mods, site, 'battery', { by: 'order' })) {
        b.apply({ kind: 'order', type: 'battery', count: 1 });
        return true;
      }
    }
    return false;
  }

  /** The buildings no rule places: each `policy.orders` entry asks for `count` of its type in all (built or building), through
   *  the order action a click takes, one building a turn (the budget and the site decide the rest). */
  private orders() {
    const b = this.base;
    const s = b.state;
    const mods = b.mods;
    const site = SITES[s.siteId];
    if (this.power()) return;
    const stable = this.stable();
    const bankless = this.bankless() && this.stable(true);
    for (const o of FACTIONS[this.faction].policy.orders) {
      if (!mods.unlocked.has(o.type)) continue;
      if (!stable && !STEADYING.includes(o.type) && !(o.type === 'lab' && (o.count === 1 || (o.count <= BANKLESS_LABS && bankless)))) continue;
      if (o.when && !o.when(s, mods)) continue;
      if (!handsFor(s, mods, o.type)) continue;
      let have = 0;
      for (const x of s.buildings) if (x.type === o.type) have++;
      if (have >= o.count) continue;
      if (s.auto.orders.some((x) => x.type === o.type)) continue; // already held in the order book
      // a cheap look before the siting one: only ask what the budget and the unlocks allow
      if (orderRefusal(s, mods, site, o.type) || budgetShort(s, mods, site, o.type, { by: 'order' })) continue;
      // one building a turn: choosing a site is the costliest thing a base does, and a turn that places several is a frame that stalls
      b.apply({ kind: 'order', type: o.type, count: 1 });
      if (o.rush) for (const x of s.buildings) if (x.type === o.type && (x.construction ?? 0) > 0) b.apply({ kind: 'buildNext', id: x.id });
      return;
    }
  }

  /** Claim the best prospect it can pay for: the faction's preferred kinds first, then the nearest. One a minute. */
  private claims() {
    const b = this.base;
    const s = b.state;
    const mods = b.mods;
    if (!s.survey.outposts.length && !Object.keys(s.survey.prospects).length) return;
    const prefs = FACTIONS[this.faction].policy.claimKinds;
    let best: ProspectId | null = null;
    let bestRank = Infinity;
    let bestDist = Infinity;
    for (const pid of PROSPECT_IDS) {
      if (!s.survey.prospects[pid]) continue;
      const kind = PROSPECTS[pid].kind as OutpostKind;
      let rank = prefs.indexOf(kind);
      if (rank < 0) rank = prefs.length; // a kind the faction does not favour still beats an empty slot, after the ones it does
      if (claimRefusal(s, mods, pid)) continue;
      const d = prospectDist(s.siteId, pid);
      if (rank < bestRank || (rank === bestRank && d < bestDist)) { best = pid; bestRank = rank; bestDist = d; }
    }
    if (!best) return;
    b.apply({ kind: 'claimOutpost', id: best });
    if (s.survey.outposts.some((o) => o.id === best)) {
      const p = PROSPECTS[best];
      pushFeed(this.moon, {
        faction: this.faction, kind: 'claim', prospect: best, era: s.era,
        text: `${FACTION_NAME[this.faction].toUpperCase()} CLAIMS ${p.short.toUpperCase()} — ${KIND_LABEL[p.kind as OutpostKind]} outpost`,
      });
    }
  }

  // ─────────────────────────── the race ───────────────────────────

  /** `moon.race[faction]`: what the race reads of this program (launches, its share of the swarm, its first light, its era), and
   *  the feed's lines for what changed: an era opened, the first volley, every fifth volley. */
  private report() {
    const s = this.base.state;
    const prev = this.moon.race[this.faction];
    const f = this.faction;
    const name = FACTION_NAME[f].toUpperCase();
    if (s.era > prev.era) {
      for (let e = prev.era + 1; e <= s.era; e++) {
        pushFeed(this.moon, { faction: f, kind: 'era', era: e, n: e, text: `${name} ENTERS ERA ${e} — ${ERA_NAMES[e]}` });
      }
    }
    const first = prev.firstLaunchAt ?? (s.launches > 0 ? s.simTime : null);
    if (prev.firstLaunchAt === null && first !== null) {
      pushFeed(this.moon, { faction: f, kind: 'firstLight', era: s.era, n: s.launches, text: `${name} — FIRST LIGHT: the first collector volley is away` });
    }
    if (s.launches > prev.launches && Math.floor(s.launches / 5) > Math.floor(prev.launches / 5)) {
      pushFeed(this.moon, { faction: f, kind: 'launch', era: s.era, n: s.launches, text: `${name} HAS LAUNCHED ${s.launches} VOLLEYS — swarm ${s.swarmPct.toFixed(4)}%` });
    }
    this.moon.race[f] = { launches: s.launches, swarmPct: s.swarmPct, era: s.era, firstLaunchAt: first };
  }
}

/** Crew to run a new station of the type. A crewed base with no Construction Robotics has only its own hands, and the economy
 *  shares them out by priority (life support first, the labs last): a base that spends them all on smelters, farms and water plants
 *  has no lab running, so no research, so no agents, and stays that way. So a station other than a lab is ordered only while a first
 *  lab's two seats stay free (the pacing probe's human runs two labs, a smelter and a farm on seven people, and the water plant
 *  only where the ice makes it worth it). `crisis`: a life-support stock about to run out takes the hands (the labs idle instead). */
function handsFor(s: GameState, mods: Mods, type: BuildingId, crisis = false): boolean {
  if (s.expedition === 'robotic' || mods.automation || crisis) return true;
  const seats = Math.max(0, BUILDINGS[type].crew + (mods.crewDelta[type] ?? 0));
  if (seats === 0) return true;
  let used = 0;
  let labs = 0;
  for (const b of s.buildings) {
    if (b.type === 'lab') labs++;
    if (!b.enabled || b.automated) continue;
    used += Math.max(0, BUILDINGS[b.type].crew + (mods.crewDelta[b.type] ?? 0));
  }
  const free = s.crew - used - seats;
  return free >= (type === 'lab' || labs > 0 ? 0 : 2);
}

/** the rules that add a crewed station, and the building each adds (life support's rules add whatever makes their resource here: a
 *  smelter, a farm, a water plant) */
const HAND_RULES: readonly AutoRuleId[] = ['lab', 'oxygen', 'food', 'water', 'partsFab', 'refinery', 'smelter', 'chipFab'];
const RULE_TYPE: Partial<Record<AutoRuleId, BuildingId>> = {
  lab: 'lab', oxygen: 'smelter', food: 'hydroponics', water: 'waterPlant', partsFab: 'partsFab', refinery: 'refinery', smelter: 'smelter', chipFab: 'chipFab',
};

/** the day's supply a rival keeps over its load, and the share of a night's deficit its bank covers */
const POWER_MARGIN = 1.15;
const SURVEY_PARTS_FLOOR = 70;
/** a base with no parts fabricator orders Earth's shipment once its cache falls under this */
const RESUPPLY_PARTS = 100;
const STABLE_S = 2400;
const STABLE_PARTS = 40;
const STABLE_NIGHT = 0.5;
/** the rules that only grow the base (labs past the first are the orders' business, and gated there) */
const GROWTH_RULES: readonly AutoRuleId[] = ['lab', 'roboticsBay', 'relayMast', 'chipFab', 'foilFactory', 'storageYard'];
/** what an unstable base may still order */
const STEADYING: readonly BuildingId[] = ['solar', 'smelter', 'partsFab', 'waterPlant', 'hydroponics', 'battery', 'refinery', 'habitat'];
const NIGHT_COVER = 0.9;
/** from this era a base whose full-sun supply is under this share of its load adds no load (see `stable`) */
const LOADED_ERA = 5;
const LOADED_MARGIN = 0.9;
/** the era from which `policy.lateCaps` apply */
const RIVAL_LATE_ERA = 6;
/** labs a base may run while it has no bank to carry the night (see `bankless`) */
const BANKLESS_LABS = 3;

/** a life-support stock that would run out inside this many seconds at its present rate asks for another maker; inside CRISIS_S it may
 *  take the hands a lab needs */
const LIFE_RUNWAY_S = 1500;
const CRISIS_S = 600;
const LIFE_MAX: Partial<Record<BuildingId, number>> = { smelter: 3, waterPlant: 2, hydroponics: 2 };

/** Does `a` need `b` first (directly: a prerequisite or an any-of member)? */
const needs = (a: TechId, b: TechId): boolean => TECHS[a].requires.includes(b) || !!TECHS[a].requiresAny?.includes(b);

/** A tech's resolved era for this base's faction and expedition (what the gates count). */
const eraOf = (s: GameState, tid: TechId): number => resolveTech(TECHS[tid], s.expedition, (s as { faction?: FactionId }).faction).era;

/** A tech whose goods the base has none of and nothing is making would sit fully paid in the queue and hold a slot. And chips are the
 *  claim's price (5 a prospect): until the first outpost is held the techs that spend chips wait for a cache that can pay both. */
function goodsHopeless(s: GameState, mods: Mods, tid: TechId): boolean {
  const goods = techCost(tid, s, mods).goods;
  if ((goods.chips ?? 0) > 0 && s.survey.outposts.length === 0 && s.resources.chips < 5 + (goods.chips ?? 0)) return true;
  for (const g of goodsShortfall(goods, s, mods)) {
    if (g.have >= g.need * 0.5) continue;
    if ((s.rates[g.res] ?? 0) > 1e-4) continue;
    if (g.res === 'foils' || g.res === 'chips') return true; // the late goods wait for their maker
  }
  return false;
}

/** The other programs as the Lunar Map and the race panels read them (`lunarView`'s `rivals`): in landing order, the
 *  landed ones with their outposts, the rest as "lands day N". Empty in a solo game. */
export function rivalInfos(moon: MoonState, rivals: readonly RivalProgram[]): RivalInfo[] {
  if (moon.player === null) return [];
  return FACTION_ORDER.filter((f) => f !== moon.player).map((f) => {
    const m = moon.factions[f];
    const r = rivals.find((x) => x.faction === f);
    return {
      faction: f, name: FACTION_NAME[f], siteId: m.siteId, landed: m.landed, landedAt: m.landedAt,
      outposts: r ? r.state.survey.outposts.map((o) => o.id) : [], launches: moon.race[f].launches, era: moon.race[f].era,
      surveying: r ? (r.state.survey.flights ?? []).map((fl) => fl.id) : [],
    };
  });
}
