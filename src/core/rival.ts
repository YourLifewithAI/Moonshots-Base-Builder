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
import { pushFeed, type MoonState } from './moon';
import { hashString } from './rng';
import type { GameState } from './state';
import type { Mods } from './mods';
import { missionLost } from './economy';
import {
  enqueue, enqueuePath, goodsShortfall, isDoctrineHere, techAvailability, techCost, techVisible, resolveTech,
} from './research';
import { budgetShort, orderRefusal, ruleState } from './automation';
import { claimRefusal, prospectDist, KIND_LABEL, type RivalInfo } from './exploration';
import { SITES, type SiteId } from '../data/sites';
import type { ResourceId } from '../data/resources';
import { FACTIONS, FACTION_NAME, FACTION_ORDER, type FactionId } from '../data/factions';
import { DOCTRINES, DOCTRINE_ORDER, ERA_NAMES, TECHS, TECH_ORDER, TRACKS, type Era, type Side, type TechId } from '../data/techs';
import { FAMILY_PRIORITY, RULE_ORDER, RULES } from '../data/automation';
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { PROSPECTS, PROSPECT_IDS, type ProspectId, type OutpostKind } from '../data/lunarMap';
import { QUEUE_MAX } from '../data/balance';

/** A rival's seed: the Moon's seed mixed with its faction (its ground's deposits, every base-local draw). The
 *  PLAYER's base keeps the game's own seed, so a faction game on a site has the terrain of the solo game on it. */
export const rivalSeed = (moonSeed: number, faction: FactionId): number => (moonSeed ^ hashString(faction)) >>> 0;

/** How often a rival thinks, in Moon seconds (offsets keep the three from landing on one tick). */
export const RIVAL_CADENCE = { research: 30, orders: 20, ordersAt: 5, claims: 60, claimsAt: 40, life: 30, lifeAt: 10 } as const;

/** The relaxations a rival's mods carry (`BaseSim.modsHook`): every Builder family (the rules the player unlocks one lane tech at a
 *  time), rules that may build destiny buildings, rules that found the first building of a kind, and Autonomous Cadence. */
export function rivalMods(m: Mods): void {
  m.autoFamilies = new Set(FAMILY_PRIORITY);
  m.builderAll = true;
  m.builderFounds = true;
  m.autoLaunch = true;
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

export class RivalProgram {
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
    base.modsHook = rivalMods;
    rivalMods(base.mods);
  }

  /** A faction lands: its base on `siteId`, its clock starting at `landedAt + 90` (mid-morning of its landing day). The Builder
   *  is on, at its caps, before the first step. */
  static land(faction: FactionId, moon: MoonState, siteId: SiteId, landedAt: number): RivalProgram {
    const base = BaseSim.create({
      siteId, seed: rivalSeed(moon.seed, faction), expedition: FACTIONS[faction].expedition, faction, landedAt,
      mode: HEADLESS_MODE, flat: true, moon,
    });
    const r = new RivalProgram(faction, base, moon);
    switchOnRules(base.state, faction);
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
    if (!missionLost(s)) this.think();
    this.report();
  }

  // ─────────────────────────── the policy ───────────────────────────

  /** The cadence is the state's own clock (whole seconds since its landing), so nothing needs saving. */
  private think() {
    const s = this.base.state;
    const t = Math.round(s.simTime - (s.landedAt ?? 0));
    if (t % RIVAL_CADENCE.research === 0) { this.research(); this.capHands(); }
    if (t % RIVAL_CADENCE.life === RIVAL_CADENCE.lifeAt) this.life();
    if (t % RIVAL_CADENCE.orders === RIVAL_CADENCE.ordersAt) this.orders();
    if (t % RIVAL_CADENCE.claims === RIVAL_CADENCE.claimsAt) this.claims();
  }

  /** Fill the research queue: the decisions the gates need (a destiny pick per era, a doctrine per group), then the faction's
   *  priority list, its own techs, and whatever is cheapest, in that order, until the queue is full. */
  private research() {
    const s = this.base.state;
    if (s.researchQueue.length >= QUEUE_MAX) return;
    const mods = this.base.mods;
    const pol = FACTIONS[this.faction].policy;
    const done = new Set<TechId>(s.techsDone);
    const tried = new Set<TechId>();
    const offer = (tid: TechId): boolean => {
      if (tried.has(tid) || done.has(tid) || !TECHS[tid]) return false;
      tried.add(tid);
      if (s.researchQueue.length >= QUEUE_MAX) return false;
      const a = techAvailability(tid, s, mods);
      if (a.state === 'available') {
        if (goodsHopeless(s, mods, tid)) return false;
        return enqueue(s, tid).ok;
      }
      if (a.state === 'requires' || a.state === 'requiresAny') {
        // the path's goods are checked one tech at a time as they come up; a path that does not fit the queue waits
        return enqueuePath(s, tid).ok;
      }
      return false;
    };
    // 1 · the era's destiny pick once two of its techs are in hand (it gates the next era, and is one of the four the gate counts)
    const era = s.era;
    if (era >= 2) {
      let inHand = 0;
      for (const tid of TECH_ORDER) {
        const d = TECHS[tid];
        if (d.track || !(done.has(tid) || s.researchQueue.includes(tid))) continue;
        if (eraOf(s, tid) === era && techVisible(resolveTech(d, s.expedition, this.faction), s)) inHand++;
      }
      if (inHand >= 3) offer(this.destinyPick(era as Era));
    }
    // 2 · the priority list, 3 · the faction's own techs
    for (const tid of pol.research as TechId[]) { if (this.wanted(tid)) offer(tid); }
    for (const tid of FACTIONS[this.faction].uniqueTechs) { if (this.wanted(tid)) offer(tid); }
    // a doctrine and a pick the lists did not reach (the gates need the picks, the any-of techs need a doctrine)
    for (let e = 2 as Era; e <= era; e = (e + 1) as Era) offer(this.destinyPick(e));
    for (const g of DOCTRINE_ORDER) {
      if (DOCTRINES[g].era > era) continue;
      const pick = this.doctrinePick(g);
      if (pick) offer(pick);
    }
    // 4 · the rest: this era's first, then the cheapest
    if (s.researchQueue.length >= QUEUE_MAX) return;
    const rest = TECH_ORDER.filter((tid) => !done.has(tid) && !tried.has(tid) && this.wanted(tid));
    rest.sort((a, b) => eraOf(s, a) - eraOf(s, b) || techCost(a, s, mods).data - techCost(b, s, mods).data || TECH_ORDER.indexOf(a) - TECH_ORDER.indexOf(b));
    for (const tid of rest) { if (s.researchQueue.length >= QUEUE_MAX) break; offer(tid); }
  }

  /** May this tech be queued on the faction's own account? A doctrine member only if it is the faction's pick of its group, a
   *  destiny pick only if it is the faction's side of its era (the other side is never researched). */
  private wanted(tid: TechId): boolean {
    const def = TECHS[tid];
    if (!def) return false;
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

  /** A crewed base with no Construction Robotics has only its own hands: its labs stop at the ones ordered (a lab rule that takes the
   *  last two hands leaves no one for the second smelter or the water plant the life rules ask for). The cap opens with the agents. */
  private capHands() {
    const s = this.base.state;
    if (s.expedition === 'robotic') return;
    const r = ruleState(s, 'lab');
    const cap = FACTIONS[this.faction].policy.ruleCaps.lab ?? RULES.lab.cap;
    if (this.base.mods.automation) { r.cap = Math.min(RULES.lab.capRange[1], cap); return; }
    let labs = 0;
    for (const b of s.buildings) if (b.type === 'lab') labs++;
    r.cap = Math.max(1, Math.min(cap, labs));
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
      if (building > 0 || have >= (LIFE_MAX[type] ?? 0)) continue;
      if (have === 0 && s.simTime - (s.landedAt ?? 0) < 90) continue; // (the opening orders place the first ones)
      const crisis = s.resources[res] / -net < CRISIS_S;
      if (!handsFor(s, mods, type, crisis)) continue;
      if (orderRefusal(s, mods, site, type) || budgetShort(s, mods, site, type, { by: 'order' })) continue;
      b.apply({ kind: 'order', type, count: 1 });
    }
  }

  /** The buildings no rule places: each `policy.orders` entry asks for `count` of its type in all (built or building), through
   *  the order action a click takes, one building a turn (the budget and the site decide the rest). */
  private orders() {
    const b = this.base;
    const s = b.state;
    const mods = b.mods;
    const site = SITES[s.siteId];
    for (const o of FACTIONS[this.faction].policy.orders) {
      if (!mods.unlocked.has(o.type)) continue;
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
 *  has no lab running, so no research, so no agents, and stays that way; one that spends them on labs has nobody left for the
 *  water plant. So a lab stands only while a hand stays spare for the farm or the water plant, and any other station only while
 *  a first lab's two seats stay free. `crisis`: a life-support stock about to run out takes the hands (the labs idle instead). */
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
  return free >= (type === 'lab' ? (labs > 0 ? 1 : 0) : (labs === 0 ? 2 : 0));
}

/** a life-support stock that would run out inside this many seconds at its present rate asks for another maker; inside CRISIS_S it may
 *  take the hands a lab needs */
const LIFE_RUNWAY_S = 1500;
const CRISIS_S = 600;
const LIFE_MAX: Partial<Record<BuildingId, number>> = { smelter: 3, waterPlant: 2, hydroponics: 3 };

/** A tech's resolved era for this base's faction and expedition (what the gates count). */
const eraOf = (s: GameState, tid: TechId): number => resolveTech(TECHS[tid], s.expedition, (s as { faction?: FactionId }).faction).era;

/** A tech whose goods the base has none of and nothing is making would sit fully paid in the queue and hold a slot. */
function goodsHopeless(s: GameState, mods: Mods, tid: TechId): boolean {
  const short = goodsShortfall(techCost(tid, s, mods).goods, s, mods);
  for (const g of short) {
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
