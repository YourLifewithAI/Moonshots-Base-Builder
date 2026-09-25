/** Pacing probe (docs/11-research-and-map-spec.md §9) — not run in CI.
 *
 *   node scripts/probe-pacing.mjs [--runs=mare:robotic:reasonable,southpole:human:attentive,…]
 *       [--minutes=160] [--seeds=42,7,1234] [--port=5322] [--out=file.json] [--pick=smelt:moltenElectrolysis,…]
 *       [--quiet]   (--runs=all: robotic × 3 sites and human × mare/pole, both policies)
 *       [--reuse]   (drive a dev server already running on --port instead of starting one)
 *       [--auto=off|on]  (docs/13 §8.3: off — the Builder techs are never researched;
 *                         on — the core ones after their era's critical techs, the rest in the tail)
 *       [--savers=late|early]  (with --auto=on: early closes each era's critical block
 *                         with Automated Excavation and Power instead)
 *       [--destiny=natural|colony|automation|concord|late] [--picks=ACACACAC]
 *                         (docs/14 §6: each era's ⌂/◉ pick; the charter needs it.
 *                         natural: every pick follows the landing; colony / automation:
 *                         every Era 2–8 pick on that side; concord: alternate, starting
 *                         opposite the landing (4–4); late: 5 on the landing's side, then
 *                         switch (5–3). --picks names all eight, the landing first.)
 *
 * An honest scripted player: it reads only what the HUD shows (getState,
 * getResearch, getLunar, getDeposits, canPlace, the building and site tables)
 * and acts only through public verbs — placeBuilding, research, surveyProspect,
 * claimOutpost, gradeAt, orderResupply, downlink, setOverclock, setAutomated,
 * buildNext, summonRover (an idle rover onto a long build, --fleet=off to
 * skip), launch — and the clock. No grants, no completeTech, no setStats.
 * The bot runs inside the page (one evaluate per chunk), so a 160-min run takes
 * seconds. Two policies: 'reasonable' (reads milestone hints and alerts, builds
 * by need, reacts every 20 s) and 'attentive' (every 10 s; reserves research
 * goods, overclocks, downlinks, crews labs first, two Chip Fabs, three DCs).
 * A third, 'distracted' (every 120 s, one build a decision, thin margins), is a
 * measurement only: nothing is gated on it.
 * With --auto=on the bot researches the Builder techs as a player who wants
 * them would, and hands each family whose rules are on to the Builder: it
 * still founds the first of each type, but no longer adds more itself, and it
 * raises a rule's cap by +3 (+8 for Solar Arrays) when the [B] panel shows it
 * capped. No per-seed tuning.
 * Doctrines follow each site's natural answer (spec S3) unless --pick overrides. */
import { writeFileSync } from 'node:fs';
import { withGame } from './harness.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const a = argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const ALL = ['mare:robotic', 'southpole:robotic', 'lavatube:robotic', 'mare:human', 'southpole:human']
  .flatMap((r) => [`${r}:reasonable`, `${r}:attentive`]).join(',');
const RUNS = opt('runs', 'mare:robotic:reasonable').replace(/^all$/, ALL).split(',').map((r) => {
  const [site, exp = 'robotic', policy = 'reasonable'] = r.split(':');
  return { site, exp, policy };
});
const MINUTES = Number(opt('minutes', 160));
const SEEDS = opt('seeds', opt('seed', '42')).split(',').map(Number);
const PORT = Number(opt('port', 5322));
const OUT = opt('out', '');
const PICK = Object.fromEntries(opt('pick', '').split(',').filter(Boolean).map((p) => p.split(':')));
const QUIET = argv.includes('--quiet');
const FLEET_VERBS = opt('fleet', 'on') !== 'off';
const AUTO_ON = opt('auto', 'off') === 'on';
const SAVERS_EARLY = opt('savers', 'late') === 'early';
const DESTINY = opt('destiny', 'natural');
const PICKS_ARG = opt('picks', '');
/** --replace=off: the pick is added to the era's research instead of replacing its last small step */
const REPLACE_STEP = opt('replace', 'on') !== 'off';

// ───────────────────────── the in-page player ─────────────────────────
// Everything below runs inside the page: no outer references.
async function installBot(cfg) {
  const G = window.__game;
  const { BUILDINGS } = await import('/src/data/buildings.ts');
  const { SITES } = await import('/src/data/sites.ts');
  const { TECHS, TECH_ORDER, DOCTRINES, TRACKS } = await import('/src/data/techs.ts');
  const BAL = await import('/src/data/balance.ts');
  const { dayInfo } = await import('/src/core/daynight.ts');
  // the clock is the probe's: pause the live frame loop so no real-time tick slips
  // in between evaluate chunks (debug advances still run the economy)
  G.setPaused(true);
  G.advanceGameSeconds(0);
  const site = SITES[cfg.site];
  const robotic = cfg.exp === 'robotic';
  const bcm = site.buildCostMult;

  const POLICIES = {
    reasonable: {
      every: 20, labs: [0, 2, 3, 4, 5, 6, 7, 7, 7], margin: 1.1, nightCover: 0.5, recharge: 0.5,
      overclock: false, crewLabsFirst: false, reserveGoods: false, downlink: false,
      chipFabs: 1, dcs: 2, reactors: 1, partsLow: 5, extraSites: 1, queueFill: 2, perDecision: 2,
      surveyBuffer: 250, foilFabs: 1, yards: 3,
    },
    attentive: {
      every: 10, labs: [0, 2, 3, 5, 6, 7, 8, 8, 8], margin: 1.2, nightCover: 0.8, recharge: 1.0,
      overclock: true, crewLabsFirst: true, reserveGoods: true, downlink: true,
      chipFabs: 2, dcs: 3, reactors: 2, partsLow: 15, extraSites: 2, queueFill: 1, perDecision: 3,
      surveyBuffer: 150, foilFabs: 2, yards: 4,
    },
    // measurement only (docs/13 §9): a player who looks in once a minute
    distracted: {
      every: 120, labs: [0, 2, 3, 4, 4, 5, 6, 6, 6], margin: 1.05, nightCover: 0.3, recharge: 0.4,
      overclock: false, crewLabsFirst: false, reserveGoods: false, downlink: false,
      chipFabs: 1, dcs: 2, reactors: 1, partsLow: 5, extraSites: 1, queueFill: 2, perDecision: 1,
      surveyBuffer: 300, foilFabs: 1, yards: 2,
    },
  };
  const P = POLICIES[cfg.policy];

  // ── doctrines: the site's natural answer (spec S3) ──
  const NATURAL = {
    mare: { smeltDoctrine: 'ilmeniteBeneficiation', nightPower: 'thoriumPower', constructionDoctrine: 'swarmRobotics',
      chipDoctrine: 'acceleratorDesign', launchArchitecture: 'massDriver', swarmPurpose: 'powerBeaming' },
    southpole: { smeltDoctrine: 'moltenElectrolysis', nightPower: 'regenFuelCells', constructionDoctrine: 'swarmRobotics',
      chipDoctrine: 'acceleratorDesign', launchArchitecture: 'propellantDepot', swarmPurpose: 'powerBeaming' },
    lavatube: { smeltDoctrine: 'ilmeniteBeneficiation', nightPower: 'thoriumPower', constructionDoctrine: 'swarmRobotics',
      chipDoctrine: 'acceleratorDesign', launchArchitecture: 'massDriver', swarmPurpose: 'powerBeaming' },
  };
  const pick = { ...NATURAL[cfg.site] };
  for (const [k, v] of Object.entries(cfg.pick ?? {})) {
    const g = Object.keys(DOCTRINES).find((d) => d.startsWith(k));
    if (g) pick[g] = v;
  }
  const rejected = new Set(Object.values(DOCTRINES).flatMap((d) => d.members.filter((m) => m !== pick[d.id])));
  // ── destiny (docs/14 §6): the side of each era's pick, the landing first ──
  const land = robotic ? 'A' : 'C';
  const opp = land === 'A' ? 'C' : 'A';
  const PICKS = cfg.picks && /^[AC]{8}$/.test(cfg.picks) ? cfg.picks
    : cfg.destiny === 'colony' ? `${land}CCCCCCC`
    : cfg.destiny === 'automation' ? `${land}AAAAAAA`
    : cfg.destiny === 'concord' || cfg.destiny === 'mixed' ? `${land}${opp}${land}${opp}${land}${opp}${land}${opp}`
    : cfg.destiny === 'late' ? `${land}${land}${land}${land}${land}${opp}${opp}${opp}`
    : land.repeat(8);
  const pickOf = (e) => (PICKS[e - 1] === 'C' ? TRACKS[e].colony : TRACKS[e].automation);
  for (let e = 2; e <= 8; e++) rejected.add(PICKS[e - 1] === 'C' ? TRACKS[e].automation : TRACKS[e].colony);

  // ── research priority (the pacing model's reasonable-player list) ──
  let order = ['regolithProcessing', 'prospectingRovers', 'partsFabrication', 'teleoperation', 'siliconRefining',
    'batteryStorage', 'constructionRobotics', 'regolithShielding', 'thoriumPower', 'swarmRobotics', 'thermalWadis',
    'waferFab', 'orbitalProspector', 'ilmeniteBeneficiation', 'acceleratorDesign', 'lunarDataCenter', 'dynamicClocking',
    'regolithVolatiles', 'dustMitigation', 'btLavaTubeCaverns', 'cryoRadiators', 'btVolcanicGlass', 'cleanroomRobotics',
    'crewWellness', 'humanCohabitation', 'farSideRelay', 'scienceCrews', 'conditionOptimization',
    'foilManufacturing', 'massDriver', 'swarmProtocol', 'btColdTrapChemistry', 'deepSounding', 'selfReplication'];
  // the critical path: the named list (and each doctrine slot's pick, the site's special techs)
  const MAIN0 = new Set(order);
  const move = (id, before) => { order = order.filter((x) => x !== id); order.splice(order.indexOf(before), 0, id); };
  // the small steps (docs/12): a reasonable player takes the cheap upgrades for
  // what it already runs once each era's main techs are in, not after the
  // whole tree (the generic tail below would defer every one of them)
  const SMALL_AFTER = {
    prospectingRovers: ['grizzlyScreens', 'fieldSpectrometers'],
    teleoperation: ['bifacialCells'],
    siliconRefining: ['sampleCaches'],
    partsFabrication: ['benchRobots'],
    batteryStorage: ['mpptInverters', 'heatRecoveryJackets'],
    regolithShielding: ['neutronSpectrometry', 'sublimationTents'],
    thermalWadis: ['refluxColumns', 'cryoSampleStore', 'stackedCells', 'slagRecycling'],
    ilmeniteBeneficiation: ['mliBlankets'],
    acceleratorDesign: ['braytonConverters', 'pressureTanks', 'waferPolishing', 'oreSorting', 'heatedAugers', 'roverAutonomy'],
    cryoRadiators: ['toolChangers', 'wingExtensions', 'oxygenLiquefaction', 'immersionLitho', 'deployableRadiators', 'gravimetry',
      'autonomousHaulage'],
    humanCohabitation: ['uplinkDishes', 'solidStateCells', 'highBurnupFuel', 'refractoryLinings', 'predictiveMaintenance'],
    conditionOptimization: ['bunkRacks', 'growLights', 'nutrientRecirculation', 'galleyGarden', 'liquidCooling', 'rackDensification'],
    massDriver: ['rollToRoll', 'foilAnnealing', 'superconductingBus', 'laserRanging', 'lowGCourt'],
    swarmProtocol: ['railCapacitors', 'cryocoolerHeads', 'canisterPress'],
  };
  for (const [after, list] of Object.entries(SMALL_AFTER)) {
    const known = list.filter((t) => TECHS[t] && !order.includes(t));
    order.splice(order.indexOf(after) + 1, 0, ...known);
  }
  if (cfg.site === 'southpole') {
    order = order.map((x) => ({ regolithVolatiles: 'iceExtraction', thermalWadis: 'peakLightMasts' })[x] ?? x);
    order = order.filter((x) => x !== 'iceExtraction'); order.splice(1, 0, 'iceExtraction');
  }
  if (cfg.site === 'lavatube') {
    order = order.map((x) => (x === 'thermalWadis' ? 'skylightHeliostats' : x));
    move('skylightHeliostats', 'batteryStorage');
    // (probe option) rush the energy-poor site's baseload answer
    if (cfg.rushNight) {
      for (const t of ['constructionRobotics', 'regolithShielding', 'thoriumPower']) move(t, 'skylightHeliostats');
    }
  }
  // each doctrine slot takes the picked member
  order = order.map((x) => {
    const d = TECHS[x]?.exclusive;
    return d ? pick[d] : x;
  });
  if (pick.nightPower === 'regenFuelCells') move('regenFuelCells', 'swarmRobotics');
  if (!robotic) order = order.filter((x) => x !== 'humanCohabitation');
  // a crewed base's attentive player wants agents on the stations hands can't reach;
  // a reasonable one gets there once stations stand idle for want of crew (after
  // Parts Fabrication, before the era-2 small steps)
  if (!robotic && cfg.policy === 'attentive') move('constructionRobotics', 'teleoperation');
  else if (!robotic) move('constructionRobotics', 'batteryStorage');
  order = [...new Set(order)].filter((t) => t !== 'siteGrading');
  for (const t of TECH_ORDER) if (!order.includes(t) && t !== 'siteGrading') order.push(t); // then the rest of the tree
  order = order.filter((t) => !rejected.has(t));
  // ── the Builder techs (docs/13): never, or the core ones early in their era ──
  const BUILDER_KINDS = ['orders', 'autoRule', 'siting', 'governor', 'predictive', 'feedPlanner', 'maintenance', 'builder'];
  const BUILDER = TECH_ORDER.filter((t) => TECHS[t].effects.some((fx) => BUILDER_KINDS.includes(fx.kind)));
  if (!cfg.auto) order = order.filter((t) => !BUILDER.includes(t));
  else {
    // docs/13 §8.3 and §11: ahead of the optional techs of their era, never
    // ahead of the critical path (the named list above): Build Orders after
    // Parts Fabrication, Predictive Scheduling after the Lunar Data Center, the
    // rest after the last critical tech of their era. --savers=early instead
    // closes each era's critical block with the attention savers (Automated
    // Excavation, Automated Power, and Life Support on crewed runs): more of the
    // game on rules, at more research time before the Data Center (docs/13 §11).
    const R0 = G.getResearch();
    const eraOf = (t) => R0.cards[t]?.era ?? TECHS[t].era;
    const CRITICAL = new Set(order.filter((x) => MAIN0.has(x) || TECHS[x].exclusive ||
      ['iceExtraction', 'peakLightMasts', 'skylightHeliostats', 'constructionRobotics'].includes(x)));
    const SAVERS = cfg.saversEarly ? ['autoExcavation', 'autoPower', ...(robotic ? [] : ['autoLifeSupport'])] : [];
    const CORE = ['buildOrders', 'autoExcavation', 'siteSurveyAI', 'autoPower', 'budgetGovernor',
      ...(robotic ? [] : ['autoLifeSupport']), 'predictiveScheduling', 'autoSmelting', 'autoFabrication'];
    for (const t of CORE) {
      if (rejected.has(t)) continue;
      order = order.filter((x) => x !== t);
      const crit = order.filter((x) => CRITICAL.has(x));
      let at;
      if (t === 'buildOrders') at = order.indexOf('partsFabrication') + 1;
      else if (t === 'predictiveScheduling') at = order.indexOf('lunarDataCenter') + 1;
      else if (SAVERS.includes(t)) {
        const next = crit.find((x) => eraOf(x) > eraOf(t));
        at = next ? order.indexOf(next) : order.length;
      } else {
        const mine = crit.filter((x) => eraOf(x) === eraOf(t));
        at = mine.length ? order.indexOf(mine[mine.length - 1]) + 1 : order.length;
      }
      order.splice(Math.max(at, ...TECHS[t].requires.map((r) => order.indexOf(r) + 1)), 0, t);
    }
  }

  const log0 = { deferred: [] };
  // ── destiny picks in the order (docs/14 §6): the reasonable player queues the
  // era's pick right after that era's first main tech (the 2nd research of the
  // era), the attentive one first; Era 8's comes before Swarm Protocol, which needs it.
  // A pure-Automation robotic run never researches Human Cohabitation: its Era 6 pick waives it.
  {
    const R1 = G.getResearch();
    const eraOf = (t) => R1.cards[t]?.era ?? TECHS[t].era;
    // the pick replaces the era's lowest-priority small step (docs/14 §6): that
    // step moves to the tail, so the era's research is the same size — one
    // that nothing later in the list builds on, so no other step waits for it
    const SMALL = new Set(Object.values(SMALL_AFTER).flat());
    const needed = (x) => order.some((y) => TECHS[y].requires.includes(x));
    for (let e = 2; e <= 8; e++) {
      const t = pickOf(e);
      order = order.filter((x) => x !== t);
      const firstMain = order.findIndex((x) => eraOf(x) === e && (MAIN0.has(x) || TECHS[x].exclusive));
      const first = order.findIndex((x) => eraOf(x) === e);
      let at = firstMain >= 0 ? firstMain + (cfg.policy === 'attentive' ? 0 : 1) : first >= 0 ? first : order.length;
      if (e === 8) at = Math.min(at, order.indexOf('swarmProtocol'));
      order.splice(at, 0, t);
      if (cfg.replaceStep !== false && e < 8) {
        const small = order.filter((x) => eraOf(x) === e && SMALL.has(x) && !BUILDER.includes(x) && !needed(x));
        const drop = small[small.length - 1];
        if (drop) { order = order.filter((x) => x !== drop); order.push(drop); log0.deferred.push(drop); }
      }
    }
    if (robotic && PICKS[5] === 'A') order = order.filter((x) => x !== 'humanCohabitation');
  }

  // ── helpers over the shown state ──
  const now = () => G.getState();
  let s = now();
  const done = (t) => s.techsDone.includes(t);
  const UNLOCK = {
    smelter: 'regolithProcessing', relayMast: 'prospectingRovers', iceHarvester: 'iceExtraction',
    battery: 'batteryStorage', refinery: 'siliconRefining', partsFab: 'partsFabrication',
    roboticsBay: 'constructionRobotics', reactor: 'thoriumPower', chipFab: 'waferFab', dataCenter: 'lunarDataCenter',
    recDome: 'crewWellness', foilFactory: 'foilManufacturing', massDriver: 'massDriver', propellantPlant: 'propellantDepot',
    // the destiny buildings (docs/14 §2.8)
    greenhouseRing: 'greenhouseRings', gardenDome: 'gardenDomes', droneHive: 'droneHives', serverMonolith: 'fleetOS',
  };
  const unlocked = (t) => {
    if ((t === 'habitat' || t === 'hydroponics') && robotic) return done('humanCohabitation');
    if (BUILDINGS[t].unlockedFromStart) return true;
    return done(UNLOCK[t]);
  };
  const all = (t) => s.buildings.filter((b) => b.type === t);
  const complete = (b) => (b.construction ?? 0) <= 0;
  const nDone = (t) => all(t).filter(complete).length;
  const nAll = (t) => all(t).length;
  const sitesPending = () => s.buildings.filter((b) => !complete(b));
  const cost = (t) => {
    const out = {};
    for (const [r, a] of Object.entries(BUILDINGS[t].buildCost)) out[r] = Math.ceil(a * bcm);
    return out;
  };
  const agentRun = (b) => b.automated;
  /** a station's seats as its inspector shows them (the crew deltas of the techs done) */
  const seatsOf = (t) => Math.max(0, BUILDINGS[t].crew +
    (done('selfReplication') && ['partsFab', 'foilFactory'].includes(t) ? -1 : 0) +
    (done('benchRobots') && t === 'lab' ? -1 : 0) +
    (done('lightsOutFabs') && ['partsFab', 'chipFab'].includes(t) ? -1 : 0) +
    (done('missionControl') && ['massDriver', 'propellantPlant'].includes(t) ? 1 : 0));
  const drawOf = (t, auto) => {
    let kw = BUILDINGS[t].powerKW;
    if (t === 'smelter' && done('moltenElectrolysis')) kw = -22;
    if (t === 'excavator' && done('regolithVolatiles')) kw = -9;
    if (kw >= 0) return 0;
    const tax = auto && BUILDINGS[t].crew > 0 ? 1 + BAL.AGENT_TAX * (done('radHardProcess') ? 0.6 : 1) : 1;
    return -kw * tax;
  };
  const solarKW = () => 10 * site.solarDayMult * (done('peakLightMasts') ? 1.1 : 1) *
    (done('skylightHeliostats') ? 1.25 : 1) * (done('dustMitigation') ? 0.95 : 1);
  const reactorKW = () => 40 * (robotic && s.crew <= 0 ? 1 - BAL.AGENT_GEN_TAX : 1);
  const day = () => dayInfo(s.simTime, site, s.flare.phase === 'active');

  // ── log ──
  const log = {
    cfg, order, pick, picks: PICKS, deferred: log0.deferred, actions: [], events: [], eraOpen: { 1: s.simTime }, eraVia: {}, samples: [],
    acc: {
      t: 0, brownout: 0, brownoutNight: 0, shed: 0, night: 0, partsZero: 0, worn: 0, paused: 0, pausedBrownout: 0,
      queueEmpty: 0, goodsStall: 0, goodsBy: {}, siteIdle: {}, blockedBy: {}, bankMax: 0, deaths: 0,
      autoBy: {}, rulePhase: {},
    },
    autoSeen: [],
    firstLight: null, swarmProtocolAt: null, milestones: {},
    lastAction: s.simTime, lastEvent: s.simTime, actionGaps: [], eventGaps: [],
  };
  const act = (kind, what) => {
    const gap = s.simTime - log.lastAction;
    log.actionGaps.push({ at: log.lastAction, len: gap });
    log.lastAction = s.simTime;
    log.actions.push([Math.round(s.simTime), kind, what]);
  };
  const event = (what) => {
    log.eventGaps.push({ at: log.lastEvent, len: s.simTime - log.lastEvent });
    log.lastEvent = s.simTime;
    log.events.push([Math.round(s.simTime), what]);
  };
  const lastBlocked = {};
  const blocked = (res) => {
    log.acc.blockedBy[res] = (log.acc.blockedBy[res] ?? 0) + P.every;
    lastBlocked[res] = s.simTime;
  };

  // ── placement ──
  const LANDER = { gx: 127.5, gz: 127.5 };
  const cellOfX = (x) => Math.floor((x + 512) / 4);
  const footprint = (t, rot) => (rot % 2 === 0 ? BUILDINGS[t].footprint : [BUILDINGS[t].footprint[1], BUILDINGS[t].footprint[0]]);
  const centreOf = (t, gx, gz, rot) => {
    const [w, d] = footprint(t, rot);
    return [(gx + w / 2) * 4 - 512, (gz + d / 2) * 4 - 512];
  };
  const rotsOf = (t) => (BUILDINGS[t].footprint[0] === BUILDINGS[t].footprint[1] ? [0] : [0, 1]);
  const largeType = (t) => t === 'massDriver' || BUILDINGS[t].footprint[0] * BUILDINGS[t].footprint[1] >= 9;
  // keep the good ground for what digs it: ilmenite and ice stay free for excavators and harvesters
  const reservedKinds = new Set(cfg.site === 'southpole' ? ['ice'] : ['ilmenite']);
  const ringStart = {};
  function* ring(r) {
    const c = 127;
    if (r === 0) { yield [c, c]; return; }
    for (let i = -r; i <= r; i++) { yield [c + i, c - r]; yield [c + i, c + r]; }
    for (let i = -r + 1; i <= r - 1; i++) { yield [c - r, c + i]; yield [c + r, c + i]; }
  }
  let roughSeen = null;
  /** pads already graded (or refused — CANNOT GRADE): never try the same one twice */
  const graded = new Set();
  function findSpot(t, want = null) {
    const key = `${t}:${want ?? ''}`;
    const r0 = ringStart[key] ?? 0;
    roughSeen = null;
    for (let r = r0; r <= 60; r++) {
      for (const [gx, gz] of ring(r)) {
        for (const rot of rotsOf(t)) {
          const [cx, cz] = centreOf(t, gx, gz, rot);
          const dep = G.depositAt(cx, cz)?.kind ?? null;
          if (want && dep !== want) continue;
          if (!want && dep && reservedKinds.has(dep) && t !== 'excavator' && t !== 'iceHarvester') continue;
          const chk = G.canPlace(t, gx, gz, rot);
          if (chk.valid) { ringStart[key] = Math.max(0, r - 1); return { gx, gz, rot }; }
          if (!roughSeen && /Too rough for a large pad/.test(chk.reason) && !graded.has(`${gx},${gz}`)) roughSeen = { gx, gz, rot };
        }
      }
    }
    return null;
  }
  const revealed = (kind) => G.getDeposits().filter((d) => d.kind === kind && d.revealed && d.inNetwork);

  /** the goods queued research is about to need (attentive), or is waiting on (both) */
  function reserved() {
    const out = {};
    for (const q of R.queue) {
      const c = R.cards[q.tid];
      if (!(q.stalled || (P.reserveGoods && c.pct >= 0.6))) continue;
      for (const [r, a] of Object.entries(c.cost.goods)) out[r] = (out[r] ?? 0) + a;
    }
    return out;
  }
  let placedThisTick = 0;
  /** crewed missions: hands not yet assigned this decision (each placement takes its seats) */
  let freeHands = 99;
  /** goods held back this decision for a critical build the player is saving up for */
  let hold = {};
  function afford(t, reserve) {
    for (const [r, a] of Object.entries(cost(t))) {
      if (s.resources[r] - (reserve[r] ?? 0) - (hold[r] ?? 0) < a) return r;
    }
    return '';
  }
  /** try to build one t; returns true on success. A critical build that cannot
   *  be afforded yet holds its cost back from everything after it. */
  function build(t, why, { want = null, urgent = false, ignoreReserve = false, critical = false, bypass = false } = {}) {
    if (placedThisTick >= P.perDecision) return false;
    if (!unlocked(t)) return false;
    // CONSTRUCTION STALLED — no parts: until the fabricator stands, only what closes the loop
    const fabUp = s.buildings.some((b) => b.type === 'partsFab' && complete(b));
    const starved = s.resources.parts < (fabUp ? 5 : 20) && sitesPending().length > 0;
    if (starved && !(critical || urgent) && t !== 'partsFab') { blocked('parts'); return false; }
    if (!urgent && !bypass && sitesPending().length >= (s.bots?.total ?? 2) + P.extraSites) return false;
    // the maker of a resource research is waiting on is never held back by that wait
    const res0 = ignoreReserve ? {} : reserved();
    for (const r of Object.keys(BUILDINGS[t].outputs)) delete res0[r];
    const short = afford(t, res0);
    if (short) {
      blocked(short);
      if (critical || urgent) for (const [r, a] of Object.entries(cost(t))) hold[r] = (hold[r] ?? 0) + a;
      return false;
    }
    let spot = findSpot(t, want);
    if (!spot && want) return false; // the caller retries on any ground
    // 'Too rough for a large pad — grade it (Site Grading)': the refusal names the tech
    if (!spot && largeType(t) && roughSeen && !done('siteGrading') && !order.slice(0, 1).includes('siteGrading') &&
        R.cards.siteGrading && R.cards.siteGrading.state !== 'hidden') {
      order = ['siteGrading', ...order.filter((x) => x !== 'siteGrading')];
    }
    if (!spot && largeType(t) && roughSeen && done('siteGrading') && s.powerStored > 120) {
      // a large pad on rough ground: grade it first (the pad is placed next decision).
      // A 16 m pass covers a 3×3 pad from any of four anchors; one clear of neighbours works
      const { gx, gz } = roughSeen;
      graded.add(`${gx},${gz}`);
      const [w, d] = footprint(t, roughSeen.rot);
      const clear = (ax, az) => !s.buildings.some((b) => {
        const [bw, bd] = footprint(b.type, b.rot);
        return ax < b.gx + bw && ax + 4 > b.gx && az < b.gz + bd && az + 4 > b.gz;
      });
      const anchors = [[gx, gz], [gx - 1, gz], [gx, gz - 1], [gx - 1, gz - 1]]
        .filter(([ax, az]) => ax + 4 >= gx + Math.min(w, 4) && az + 4 >= gz + Math.min(d, 4) && clear(ax, az));
      if (anchors.length) {
        const [ax, az] = anchors[0];
        G.gradeAt(ax, az);
        if (w > 4) G.gradeAt(ax + 4, az);
        act('grade', t);
        placedThisTick++;
      }
      return false;
    }
    if (!spot) {
      // no room in the build network: a Relay Mast at its edge extends it
      if (t !== 'relayMast' && unlocked('relayMast') && !sitesPending().some((b) => b.type === 'relayMast')) {
        const m = findEdge();
        if (m && !afford('relayMast', {}) && G.placeBuilding('relayMast', m.gx, m.gz, 0)) {
          s = now(); act('build', 'relayMast(network)'); placedThisTick++;
        }
      }
      return false;
    }
    // the ghost's smelter warning: before a smelter exists, keep enough metals for one
    const chk = G.canPlace(t, spot.gx, spot.gz, spot.rot);
    if (chk.warn && t !== 'smelter') { blocked('metals'); return false; }
    if (!G.placeBuilding(t, spot.gx, spot.gz, spot.rot)) return false;
    if (!robotic) freeHands -= seatsOf(t);
    s = now();
    act('build', `${t}${why ? `(${why})` : ''}`);
    placedThisTick++;
    if (urgent) {
      const b = s.buildings[s.buildings.length - 1];
      G.buildNext(b.id);
    }
    return true;
  }
  function findEdge() {
    for (let r = 40; r >= 8; r--) {
      for (const [gx, gz] of ring(r)) {
        const [cx, cz] = centreOf('relayMast', gx, gz, 0);
        const dep = G.depositAt(cx, cz)?.kind;
        if (dep && reservedKinds.has(dep)) continue;
        if (G.canPlace('relayMast', gx, gz, 0).valid) return { gx, gz };
      }
    }
    return null;
  }

  // ── power book-keeping: what the power panel shows at full sun ──
  let pw = null;
  function powerModel() {
    const d = day();
    const full = !d.isNight && d.sunFactor >= site.solarDayMult * 0.999 && s.flare.phase !== 'active';
    const solarN = s.buildings.filter((b) => b.type === 'solar' && complete(b) && b.enabled).length;
    const reactorN = s.buildings.filter((b) => b.type === 'reactor' && complete(b) && b.enabled).length;
    if (full) pw = { supply: s.power.supply, demand: s.power.demand, solarN, reactorN };
    if (!pw) pw = { supply: 6 + solarN * solarKW(), demand: s.power.demand, solarN, reactorN };
    // carried forward over the night and through flares
    const supply = pw.supply + (solarN - pw.solarN) * solarKW() + (reactorN - pw.reactorN) * reactorKW();
    let pendingDraw = 0, pendingSupply = 0;
    for (const b of sitesPending()) {
      if (b.type === 'solar') pendingSupply += solarKW();
      else if (b.type === 'reactor') pendingSupply += reactorKW();
      else pendingDraw += drawOf(b.type, b.automated);
    }
    const demand = full ? s.power.demand : Math.max(pw.demand, s.power.demand);
    const projSupply = supply + pendingSupply;
    const projDemand = demand + pendingDraw;
    const constr = Math.min(sitesPending().length, s.bots?.total ?? 2) * BAL.CONSTRUCTION_KW;
    const nightSupply = 6 + (reactorN + all('reactor').filter((b) => !complete(b)).length) * reactorKW() +
      (solarN + all('solar').filter((b) => !complete(b)).length) * solarKW() * site.nightSolarFraction;
    const nightDemand = Math.max(0, projDemand - constr) * (done('thermalWadis') ? 0.85 : 1);
    const nightDeficit = Math.max(0, nightDemand - nightSupply);
    const capacity = s.power.capacity;
    const recharge = Math.min(capacity, nightDeficit * BAL.NIGHT_S) / (BAL.DAY_S * 0.85) * P.recharge;
    return { projSupply, projDemand, nightDeficit, capacity, recharge, full };
  }

  const LAB_CLOCK = robotic
    ? [[3.2, 1], [4, 2], [14, 3], [22, 4], [32, 5], [42, 6], [54, 7], [66, 8]]
    : [[3.5, 1], [13, 2], [22, 3], [30, 4], [40, 5], [52, 6], [64, 7]];
  const clockMult = cfg.site === 'southpole' ? 1.15 : cfg.site === 'lavatube' ? 1.12 : 1;
  const labsByClock = () => {
    let n = 0;
    for (const [min, k] of LAB_CLOCK) if (s.simTime >= min * 60 * clockMult) n = k;
    return Math.min(n, Math.max(...P.labs));
  };

  // ── decisions ──
  let R = G.getResearch();
  let L = G.getLunar();
  const surveyedByCls = () => {
    const out = {};
    for (const p of L.prospects) if (p.surveyed) out[p.cls] = (out[p.cls] ?? 0) + 1;
    return out;
  };
  const APPETITE = { local: 2, regional: 99, near: 6, far: 3, subsurface: 2 };
  const CLS_RANK = { local: 0, regional: 1, near: 2, far: 3, subsurface: 4 };
  const WEAKNESS = {
    mare: ['cabeus', 'haworth', 'tranqRegolith', 'maskelyne', 'moltke'],
    southpole: ['maskelyne', 'moltke', 'connectingRidge', 'shackletonFloor', 'haworth'],
    lavatube: ['mariusDomes', 'monsRumker', 'aristarchus', 'gruithuisen'],
  }[cfg.site];
  let lastDC = -1e9;
  // RESEARCH PAUSED — labs browned out: each night it happens, the player
  // resolves to cover more of the next one (the alert names the cause)
  let coverBoost = 0;
  let pausedThisNight = false;
  let crewSeen = 0;

  function decideResearch() {
    // WATER RESERVES LOW on a crewed base: the water panel names the makers
    if (!robotic && s.resources.water < 40 && (s.rates.water ?? 0) <= 0.005) {
      for (const t of ['regolithVolatiles', 'iceExtraction']) {
        if (R.cards[t] && R.cards[t].state !== 'hidden' && order.indexOf(t) > 1) { order = order.filter((x) => x !== t); order.unshift(t); }
      }
    }
    let q = R.queue.length;
    let fill = P.queueFill;
    // the attentive player keeps one item queued — a second only when the
    // head waits on goods or is nearly paid — so each new era's priority
    // tech goes straight in instead of behind leftovers
    if (P.queueFill === 1 && R.queue.length) {
      const h = R.queue[0];
      if (h.stalled || h.pct >= 0.8) fill = 2;
      if (R.queue.length >= 2 && R.queue[1].stalled) fill = 3;
    }
    for (const tid of order) {
      if (q >= fill) break;
      const c = R.cards[tid];
      if (c?.state === 'available') { G.research(tid); q++; act('research', tid); continue; }
      // the attentive player waits for a priority tech whose era is about to
      // open (its prerequisites are in hand) rather than queue leftovers ahead of it —
      // but never with the queue empty: the leftovers are what open that era
      // (an empty queue here deadlocked robotic mare in Era 6)
      if (P.queueFill === 1 && q > 0 && c?.state === 'eraLocked' && c.era === s.era + 1 &&
          TECHS[tid].requires.every((r) => done(r) || s.researchQueue.includes(r))) break;
    }
  }

  function decideCrew() {
    // settlers take stations; anything left short-handed goes back to the agents
    const canToggle = (robotic && s.crew > 0) || done('constructionRobotics') && !robotic;
    if (!canToggle) return;
    const seats = (b) => seatsOf(b.type);
    const stations = s.buildings.filter((b) => BUILDINGS[b.type].crew > 0 && b.enabled && complete(b));
    for (const b of stations) {
      if (!b.automated && b.idleReason === 'crew') { G.setAutomated(b.id, true); act('automate', b.type); }
    }
    if (!robotic) return; // crewed missions: agents only where hands ran out
    if (s.crew <= crewSeen && s.crew <= 0) return;
    let free = s.crew;
    for (const b of stations) if (!b.automated && b.idleReason !== 'crew') free -= seats(b);
    if (free <= 0) { crewSeen = s.crew; return; }
    const cand = stations.filter((b) => b.automated)
      .sort((x, y) => (P.crewLabsFirst ? Number(y.type === 'lab') - Number(x.type === 'lab') : 0) ||
        x.priority - y.priority || x.id - y.id);
    for (const b of cand) {
      if (seats(b) > free) continue;
      G.setAutomated(b.id, false);
      free -= seats(b);
      act('crew', b.type);
    }
    crewSeen = s.crew;
  }

  function decideMap() {
    // surveys: one at a time, breakthrough hosts first, class by class
    if (!L.active) {
      const seen = surveyedByCls();
      // crewed bases keep their water and oxygen well above the crew's reserve
      const lsOk = (p) => robotic || (s.resources.water - p.survey.water >= 20 + s.crew * 3 &&
        s.resources.oxygen - p.survey.oxygen >= 60 + s.crew * 6);
      // hoppers burn spare parts: not while the cache is all there is and it is running down
      const fabOnline = s.buildings.some((b) => b.type === 'partsFab' && complete(b));
      const partsOk = (p) => fabOnline || s.resources.parts - p.survey.parts >= 60;
      const cands = L.prospects.filter((p) => p.surveyable && (seen[p.cls] ?? 0) < APPETITE[p.cls] &&
        s.powerStored >= p.survey.energy + P.surveyBuffer && lsOk(p) && partsOk(p))
        .sort((a, b) => CLS_RANK[a.cls] - CLS_RANK[b.cls] || Number(!!b.bt) - Number(!!a.bt) || a.dist - b.dist);
      if (cands.length) { G.surveyProspect(cands[0].id); act('survey', cands[0].id); }
    }
    // outposts: the site's weakness first, then whatever is claimable
    if (L.slots > L.used) {
      const claimable = L.prospects.filter((p) => p.claimable);
      claimable.sort((a, b) => {
        const ia = WEAKNESS.indexOf(a.id), ib = WEAKNESS.indexOf(b.id);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || CLS_RANK[a.cls] - CLS_RANK[b.cls];
      });
      if (claimable.length) {
        const res = reserved();
        const c = claimable[0];
        const ok = Object.entries(c.claim.cost).every(([r, a]) => s.resources[r] - (res[r] ?? 0) >= a);
        if (ok) { G.claimOutpost(c.id); act('claim', c.id); } else blocked('claim');
      }
    }
  }

  function decideEmergency() {
    // the swarm meter's own terms (Crewed Mission Control: 2↑ with 4 on console;
    // Autonomous Cadence fires by itself, a press only helps)
    const v = done('swarmProtocol') ? G.getDestiny().volley : null;
    if (v && s.resources.foils >= v.foils && s.resources.launch >= v.launch && s.powerStored >= v.burst) {
      G.launch(); act('launch', '');
    }
    if (s.resupply?.pending) return;
    const fabOnline = s.buildings.some((b) => b.type === 'partsFab' && complete(b));
    if (s.resources.parts < P.partsLow || (P.downlink && !fabOnline && s.resources.parts < 30)) {
      const cost = 150 + 50 * (s.downlinks ?? 0);
      if (P.downlink && done('teleoperation') && s.data >= cost) { G.downlink(); act('downlink', ''); }
      // hand-placed orders each wait a lunar day longer: one early order, then the automatic one
      else if (s.resources.parts < 5 || (P.downlink && !fabOnline && !(s.resupply?.ordered > 0))) {
        G.orderResupply(); act('resupply', '');
      }
    }
  }

  // an idle rover goes to the longest build under way (the inspector's
  // Summon): the site keeps it until it is done
  function decideFleet() {
    if (!cfg.fleet) return;
    const free = (s.bots?.total ?? 0) - (s.bots?.busy ?? 0);
    if (free <= 0) return;
    const crew = (id) => (s.rovers ?? []).filter((r) => r.site === id).length;
    const long = sitesPending().filter((b) => b.enabled && b.idleReason === 'building' && b.construction > 90 && crew(b.id) < 3)
      .sort((a, b) => b.construction - a.construction);
    if (long.length) { G.summonRover(long[0].id); act('summon', long[0].type); }
  }

  function decideOverclock() {
    if (!P.overclock || !done('dynamicClocking')) return;
    const d = day();
    const m = powerModel();
    let spare = m.projSupply - m.projDemand * 1.1;
    for (const b of s.buildings) {
      if (!['dataCenter', 'chipFab', 'lab'].includes(b.type) || !complete(b)) continue;
      if (b.overclock && (d.isNight && site.nightSolarFraction < 0.5)) { G.setOverclock(b.id, false); act('overclock-off', b.type); continue; }
      const extra = drawOf(b.type, b.automated) * 0.5;
      if (!b.overclock && !d.isNight && b.wear < 0.05 && b.active && spare > extra) {
        G.setOverclock(b.id, true); spare -= extra; act('overclock', b.type);
      }
    }
  }

  // the [B] panel: which families the Builder runs, and rules stopped at their caps
  let AV = null;
  const famOn = (f) => !!cfg.auto && !!AV && AV.rules.some((r) => r.family === f && r.on && !r.locked);
  let marginSet = false;
  function decideBuilder() {
    if (!cfg.auto) return;
    AV = G.getAutomation();
    // the one documented setting (docs/13 §8.3): attentive runs a 15% power margin
    if (cfg.policy === 'attentive' && !marginSet && famOn('power')) {
      G.setRule('solar', { threshold: 0.15 }); marginSet = true; act('rule', 'solar margin 15%');
    }
    for (const r of AV.rules) {
      if (!r.on || r.phase !== 'capped' || r.cap >= r.capRange[1]) continue;
      G.setRule(r.id, { cap: Math.min(r.capRange[1], r.cap + (r.id === 'solar' ? 8 : 3)) });
      act('cap', `${r.id}→${r.cap + (r.id === 'solar' ? 8 : 3)}`);
    }
  }

  function decideBuilds() {
    placedThisTick = 0;
    hold = {};
    if (day().isNight && s.researchPaused === 'brownout' && !pausedThisNight) {
      pausedThisNight = true;
      coverBoost = Math.min(0.5, coverBoost + 0.1);
    } else if (!day().isNight) pausedThisNight = false;
    // the milestone buildings keep the head of the robot queue until they stand
    for (const t of ['partsFab', 'smelter']) {
      const site = s.buildings.find((b) => b.type === t && !complete(b));
      const weldStarved = s.resources.parts < 10 && sitesPending().some((b) => b.idleReason === 'inputs');
      if (site && (nDone(t) === 0 || (t === 'partsFab' && weldStarved))) G.buildNext(site.id);
    }
    const d = day();
    const m = powerModel();
    const era = s.era;
    const powerNeed = () => m.projSupply < m.projDemand * P.margin + m.recharge;
    // LOAD SHED or BROWNOUT by day: the grid is short now, not someday
    const dayBrown = (s.power.brownout || s.power.shed) && !d.isNight && d.sunFactor >= site.solarDayMult * 0.95 &&
      s.flare.phase !== 'active' && sitesPending().filter((b) => b.type === 'solar').length < 2;
    const res = s.resources;
    const caps = s.storageCaps ?? {};
    const isru = site.isruMult;
    freeHands = robotic ? 99 : s.crew - s.buildings
      .filter((b) => BUILDINGS[b.type].crew > 0 && !b.automated && b.enabled)
      .reduce((a, b) => a + seatsOf(b.type), 0);
    // a crewed base builds what keeps it alive whatever the roster says (the
    // economy staffs by priority and idles the lab), and once Construction
    // Robotics allows it, agents take the stations hands cannot reach
    const essential = (t) => ['smelter', 'excavator', 'hydroponics', 'iceHarvester', 'partsFab'].includes(t) && nAll(t) < 1;
    const crewOk = (t) => robotic || essential(t) || seatsOf(t) <= freeHands || done('constructionRobotics');
    const first = (t, why, o = {}) => unlocked(t) && nAll(t) < 1 && crewOk(t) && build(t, why, { critical: true, bypass: true, ...o });

    // power first: a daytime brownout, or the next loads outgrow the supply
    if (!famOn('power') && (dayBrown || powerNeed())) {
      if (unlocked('reactor') && nAll('reactor') < P.reactors && site.nightSolarFraction < 0.5 &&
          build('reactor', 'power', { urgent: dayBrown, critical: true })) return;
      build('solar', dayBrown ? 'brownout' : 'margin', { urgent: dayBrown, ignoreReserve: dayBrown, critical: dayBrown });
      if (dayBrown) return;
    }
    // the opener: power, a dig, a lab (milestones 1–3)
    if (nAll('solar') < 2) { build('solar', 'opener'); return; }
    const ilm = cfg.site !== 'southpole' && revealed('ilmenite').length ? 'ilmenite' : null;
    if (nAll('excavator') < 1) build('excavator', 'opener', { want: ilm, critical: true }) || build('excavator', 'opener', { critical: true });
    if (nAll('lab') < 1 && crewOk('lab')) build('lab', 'opener', { critical: true });
    // each milestone's first building is worth saving up for
    first('smelter', 'first metal', { urgent: true });
    if (!robotic && nAll('hydroponics') < 1 && s.simTime > 400 && crewOk('hydroponics')) build('hydroponics', 'food', { critical: true });
    first('partsFab', 'parts loop', { urgent: true });
    if (cfg.site === 'southpole' && unlocked('iceHarvester') && nAll('iceHarvester') < 1 && crewOk('iceHarvester')) {
      build('iceHarvester', 'water', { want: 'ice', critical: true });
    }
    first('refinery', 'silicon');
    first('chipFab', 'chips');
    if (unlocked('dataCenter') && nAll('dataCenter') < 1) {
      if (build('dataCenter', 'compute', { critical: true })) lastDC = s.simTime;
    }
    // compute: a Server Monolith instead of the 3rd Data Center and later (docs/14 §6)
    const computeN = () => nAll('dataCenter') + nAll('serverMonolith');
    const computeType = () => (unlocked('serverMonolith') && computeN() >= 2 ? 'serverMonolith' : 'dataCenter');
    if (unlocked('reactor') && site.nightSolarFraction < 0.5) first('reactor', 'night');
    first('foilFactory', 'foils');
    first('massDriver', 'launch');
    first('propellantPlant', 'launch');
    // regolith for every processor — a starving smelter comes before anything else
    const procIn = nAll('smelter') * 2 * (done('ilmeniteBeneficiation') ? 0.8 : 1) + nAll('refinery') * 2;
    const excavTarget = Math.ceil(procIn / (1.5 * isru) - 0.15) + (res.regolith < 40 && (s.rates.regolith ?? 0) < 0 ? 1 : 0);
    if (!famOn('excavation') && nAll('excavator') < excavTarget && res.regolith < 150 && crewOk('excavator')) {
      const kind = cfg.site === 'southpole' && done('moltenElectrolysis') && nAll('refinery') > 0 ? 'anorthosite' : ilm;
      const o = { critical: res.regolith < 20, bypass: res.regolith < 20 };
      build('excavator', 'feed', { want: kind, ...o }) || build('excavator', 'feed', o);
    }
    // science: the era's lab count, or the pacing model's clock (docs/11 §7:
    // robotic 3 labs at 14 min … 8 at 66, crewed later; pole ×1.15, lava ×1.12),
    // whichever is more — with long eras a player with spare metal adds labs
    const labTarget = Math.max(P.labs[Math.min(era, 8)], labsByClock());
    if (nAll('lab') < labTarget && crewOk('lab')) build('lab', `era ${era}`);
    // metals: a smelter per era of growth, sooner when builds keep waiting on metals
    const metalsTight = (res.metals < 60 && (s.rates.metals ?? 0) < 0.15) || s.simTime - (lastBlocked.metals ?? -1e9) < 60 ||
      all('partsFab').some((b) => b.idleReason === 'inputs') || R.queue.some((q) => q.stalled && /metals/.test(q.need));
    const smelterTarget = era >= 5 ? 3 : era >= 2 ? 2 : 1;
    if (!famOn('smelting') && unlocked('smelter') && nAll('smelter') < smelterTarget && metalsTight && nDone('smelter') === nAll('smelter') &&
        crewOk('smelter')) build('smelter', 'metals', { critical: true, bypass: true });
    // the night
    if (unlocked('battery') && !famOn('power')) {
      const per = 3000 * (done('regenFuelCells') ? 2 : 1);
      const target = m.nightDeficit * BAL.NIGHT_S * Math.min(1, P.nightCover + coverBoost);
      if (m.capacity + all('battery').filter((b) => !complete(b)).length * per < target && nAll('battery') < 12) build('battery', 'night');
    }
    // a Drone Hive instead of the 2nd Robotics Bay and later (docs/14 §6)
    const bays = nAll('roboticsBay') + nAll('droneHive');
    if (unlocked('roboticsBay') && bays < (famOn('fabrication') ? 1 : 2 + (era >= 4 && P.dcs >= 3 ? 1 : 0))) {
      build(unlocked('droneHive') && nAll('roboticsBay') >= 1 ? 'droneHive' : 'roboticsBay', 'robots');
    }

    // research-bound with full stockpiles: more science (a lab, or a Data Center once there is one)
    const researchBound = R.queue.length > 0 && !R.queue[0].stalled && res.metals > 250 && res.parts > 100 &&
      sitesPending().length === 0 && !powerNeed();
    if (researchBound && era >= 5) {
      if (unlocked('dataCenter') && computeN() < 4 && res.chips >= 15 + 10) build(computeType(), 'research-bound');
      else if (nAll('lab') < 10 && crewOk('lab')) build('lab', 'research-bound');
    }
    // stockpiles at their caps (parts are fine full: the fabricators stand by)
    for (const r of ['metals', 'silicon']) {
      if (!famOn('smelting') && caps[r] && res[r] >= caps[r] * 0.92 && nAll('storageYard') < P.yards &&
          !sitesPending().some((b) => b.type === 'storageYard')) {
        build('storageYard', `${r} full`);
      }
    }
    // parts: a second fabricator only when the first runs flat out and parts still fall
    // parts: another fabricator when the ones running cannot keep up — welding
    // sites waiting on parts (CONSTRUCTION STALLED), or a stock pinned near zero
    const fabs = all('partsFab');
    const weldStarved = sitesPending().some((b) => b.idleReason === 'inputs');
    const partsShort = (res.parts < 30 && (s.rates.parts ?? 0) < 0) || res.parts < 8 || weldStarved;
    if (!famOn('fabrication') && unlocked('partsFab') && fabs.length < (era >= 5 ? 3 : 2) + (era >= 7 ? 1 : 0) && partsShort &&
        fabs.every(complete) && crewOk('partsFab')) build('partsFab', 'parts', { critical: true, bypass: true });
    if (!famOn('power') && unlocked('reactor') && site.nightSolarFraction < 0.5 && nAll('reactor') < Math.min(P.reactors + (nAll('dataCenter') >= 2 ? 1 : 0), 3) &&
        m.nightDeficit > 25) build('reactor', 'night');
    const chipStalled = R.queue.some((q) => q.stalled && /chips/.test(q.need));
    if (!famOn('fabrication') && unlocked('chipFab') && nAll('chipFab') < P.chipFabs + (chipStalled ? 1 : 0) && nDone('chipFab') >= 1 &&
        crewOk('chipFab') && nAll('chipFab') < 3) build('chipFab', 'chips 2');
    if (unlocked('dataCenter') && computeN() < P.dcs && s.simTime - lastDC > 240 &&
        sitesPending().every((b) => b.type !== 'dataCenter' && b.type !== 'serverMonolith')) {
      if (build(computeType(), 'compute')) lastDC = s.simTime;
    }
    if (unlocked('habitat') && robotic && nAll('habitat') < 1) build('habitat', 'cohab');
    if (unlocked('hydroponics') && robotic && nAll('hydroponics') < 1) build('hydroponics', 'cohab');
    // a crewed base — or a robotic one its destiny brought people to — keeps
    // beds and food ahead of the crew: a Garden Dome instead of habitats once
    // unlocked, a Greenhouse Ring (three farms) instead of the 3rd farm and later
    const peopled = !robotic || s.crew > 0;
    if (!famOn('life') && peopled && unlocked('habitat') && s.crew >= (s.housingActive ?? 8) - 1 &&
        !sitesPending().some((b) => b.type === 'habitat' || b.type === 'gardenDome')) {
      build(unlocked('gardenDome') ? 'gardenDome' : 'habitat', 'beds');
    }
    const farms = nAll('hydroponics') + 3 * nAll('greenhouseRing');
    if (!famOn('life') && peopled && s.crew >= 8 && farms < Math.ceil(s.crew / 10) + 1 && crewOk('hydroponics')) {
      build(unlocked('greenhouseRing') && farms >= 2 ? 'greenhouseRing' : 'hydroponics', 'food');
    }
    if (unlocked('recDome') && nAll('recDome') < 1 && s.crew >= 2 && crewOk('recDome')) build('recDome', 'morale');
    if (unlocked('foilFactory') && nAll('foilFactory') < P.foilFabs && crewOk('foilFactory')) build('foilFactory', 'foils');
    if (!famOn('smelting') && unlocked('foilFactory') && nAll('refinery') < 2 + (nAll('foilFactory') >= 2 ? 1 : 0) && crewOk('refinery')) build('refinery', 'foil silicon');
    // RESEARCH WAITING names the maker: a stall on silicon (or a stock that keeps
    // falling) means another refinery
    const siStalled = R.queue.some((q) => q.stalled && /silicon/.test(q.need));
    const siTight = siStalled || (res.silicon < 30 && (s.rates.silicon ?? 0) < 0 && nAll('chipFab') > 0) ||
      s.simTime - (lastBlocked.silicon ?? -1e9) < 60;
    if (!famOn('smelting') && unlocked('refinery') && siTight && nAll('refinery') < 4 && nDone('refinery') === nAll('refinery') && crewOk('refinery')) {
      build('refinery', 'silicon short', { critical: true });
    }
    if (cfg.site === 'southpole' && unlocked('propellantPlant') && nAll('iceHarvester') < 2 && crewOk('iceHarvester')) {
      build('iceHarvester', 'propellant water', { want: 'ice' });
    }
  }

  // ── sampling ──
  let prev = { techs: s.techsDone.length, built: s.stats.built, surveyed: 0, era: s.era, crew: s.crew, live: 0 };
  function sample(dt) {
    const A = log.acc;
    const d = day();
    A.t += dt;
    if (d.isNight) A.night += dt;
    if (s.power.brownout) { A.brownout += dt; if (d.isNight) A.brownoutNight += dt; }
    if (s.power.shed) A.shed += dt;
    if (s.resources.parts < 1) A.partsZero += dt;
    const live = s.buildings.filter((b) => b.type !== 'lander' && complete(b));
    if (live.length) A.worn += dt * live.filter((b) => b.wear >= 0.3).length / live.length;
    if (s.researchPaused) { A.paused += dt; if (s.researchPaused === 'brownout') A.pausedBrownout += dt; }
    if (!s.researchQueue.length) A.queueEmpty += dt;
    if (s.researchStalled.length) {
      A.goodsStall += dt;
      for (const tid of s.researchStalled) {
        for (const [r, a] of Object.entries(TECHS[tid].costGoods ?? {})) {
          if (s.resources[r] < a) A.goodsBy[r] = (A.goodsBy[r] ?? 0) + dt;
        }
      }
    }
    for (const b of sitesPending()) A.siteIdle[b.idleReason || 'none'] = (A.siteIdle[b.idleReason || 'none'] ?? 0) + dt;
    // the Builder: what it placed (by rule or order), and where its live rules spent their time
    for (const b of s.buildings) {
      if (!b.auto || log.autoSeen.includes(b.id)) continue;
      log.autoSeen.push(b.id);
      const k = b.auto.by === 'rule' ? b.auto.rule : 'order';
      A.autoBy[k] = (A.autoBy[k] ?? 0) + 1;
    }
    if (cfg.auto && s.auto) {
      for (const r of Object.values(s.auto.rules)) {
        if (!r.on) continue;
        A.rulePhase[r.phase] = (A.rulePhase[r.phase] ?? 0) + dt;
      }
    }
    A.bankMax = Math.max(A.bankMax, s.data);
    // events: techs, buildings, surveys, eras, outposts, crew
    if (s.techsDone.length > prev.techs) {
      for (const t of s.techsDone.slice(prev.techs)) event(`tech ${t}`);
      if (s.techsDone.includes('swarmProtocol') && !log.swarmProtocolAt) log.swarmProtocolAt = s.simTime;
    }
    if (s.stats.built > prev.built) event(`built ×${s.stats.built - prev.built}`);
    const surveyed = Object.keys(s.survey.prospects).length;
    if (surveyed > prev.surveyed) event('survey');
    const live2 = s.survey.outposts.filter((o) => o.live).length;
    if (live2 > prev.live) event('outpost online');
    if (s.era > prev.era) {
      for (let e = prev.era + 1; e <= s.era; e++) {
        log.eraOpen[e] = s.simTime;
        const g = R.gates.find((x) => x.era === e);
        log.eraVia[e] = g ? (g.via === 'deed' ? `1+deed(${g.deed.slice(0, 28)})` : `${g.techs} techs`) : '?';
        event(`era ${e}`);
      }
    }
    if (s.crew < prev.crew) A.deaths += prev.crew - s.crew - 0; // rotations only add
    for (const m of s.milestonesDone) if (!(m in log.milestones)) log.milestones[m] = Math.round(s.simTime);
    if (s.launches >= 1 && !log.firstLight) { log.firstLight = s.simTime; event('FIRST LIGHT'); }
    prev = { techs: s.techsDone.length, built: s.stats.built, surveyed, era: s.era, crew: s.crew, live: live2 };
  }

  let nextDecision = s.simTime;
  let lastSampleAt = s.simTime;
  function step(minutes) {
    const until = s.simTime + minutes * 60;
    while (s.simTime < until && !log.firstLight && !s.defeatShown) {
      if (s.simTime >= nextDecision) {
        R = G.getResearch();
        L = G.getLunar();
        decideEmergency();
        decideResearch();
        decideCrew();
        decideMap();
        decideBuilder();
        decideBuilds();
        decideOverclock();
        decideFleet();
        nextDecision = s.simTime + P.every;
      }
      G.advanceGameSeconds(5);
      s = now();
      R = G.getResearch();
      sample(s.simTime - lastSampleAt);
      lastSampleAt = s.simTime;
      if (Math.round(s.simTime) % 60 < 5) {
        log.samples.push({
          t: Math.round(s.simTime), era: s.era, techs: s.techsDone.length, crew: s.crew,
          res: Object.fromEntries(Object.entries(s.resources).map(([k, v]) => [k, Math.round(v)])),
          supply: Math.round(s.power.supply), demand: Math.round(s.power.demand), stored: Math.round(s.powerStored),
          cap: Math.round(s.power.capacity), brown: s.power.brownout, rate: +s.researchRateAvg.toFixed(2),
          labs: R.labsActive, dcs: R.dcsActive, bots: s.bots?.total, bank: Math.round(s.data),
          queue: s.researchQueue.slice(), stalled: s.researchStalled.slice(), paused: s.researchPaused,
          n: s.buildings.length, pending: sitesPending().length,
        });
      }
    }
    return {
      t: s.simTime, era: s.era, techs: s.techsDone.length, crew: s.crew, firstLight: log.firstLight,
      defeat: !!s.defeatShown, labs: R.labsActive, dcs: R.dcsActive, rate: s.researchRateAvg,
      res: Object.fromEntries(Object.entries(s.resources).map(([k, v]) => [k, Math.round(v)])),
      queue: s.researchQueue, stalled: s.researchStalled,
    };
  }
  function report() {
    const s2 = now();
    const R2 = G.getResearch();
    log.techs = s2.techsDone.map((t) => {
      const ev = log.events.find((e) => e[1] === `tech ${t}`);
      return [t, R2.cards[t].era, R2.cards[t].cost.data, ev ? ev[0] : null];
    });
    log.actionGaps.push({ at: log.lastAction, len: s2.simTime - log.lastAction });
    log.eventGaps.push({ at: log.lastEvent, len: s2.simTime - log.lastEvent });
    log.final = {
      t: s2.simTime, era: s2.era, techsDone: s2.techsDone, crew: s2.crew, defeat: !!s2.defeatShown,
      buildings: Object.entries(s2.buildings.reduce((a, b) => { a[b.type] = (a[b.type] ?? 0) + 1; return a; }, {})),
      resources: s2.resources, stats: s2.stats, outposts: s2.survey.outposts.map((o) => [o.id, o.live]),
      surveyed: Object.keys(s2.survey.prospects), discoveries: s2.discoveries, insights: s2.insights,
      downlinks: s2.downlinks, resupply: s2.resupply,
      band: G.getDestiny().band, crewHome: s2.crewHome,
      alertsTail: s2.alerts.slice(-8).map((a) => a.text),
    };
    return log;
  }
  window.__bot = { step, report };
  return { order, pick, picks: PICKS };
}

// ───────────────────────── the Node side ─────────────────────────
const fmtMin = (sec) => (sec == null ? '—' : (sec / 60).toFixed(1));

function summarize(log) {
  const A = log.acc;
  const eras = [];
  for (let e = 1; e <= 8; e++) {
    const a = log.eraOpen[e];
    const b = e < 8 ? log.eraOpen[e + 1] : (log.swarmProtocolAt ?? log.final.t);
    eras.push(a == null ? null : ((b ?? log.final.t) - a) / 60);
  }
  const maxGap = (gaps) => gaps.reduce((m, g) => (g.len > m.len ? g : m), { len: 0, at: 0 });
  const ag = maxGap(log.actionGaps), eg = maxGap(log.eventGaps);
  // idle: a stretch with neither a player action nor an event to answer (spec §9 acceptance)
  const marks = [...log.actions.map((a) => a[0]), ...log.events.map((e) => e[0]), log.final.t].sort((a, b) => a - b);
  const idleGaps = [];
  for (let i = 1; i < marks.length; i++) idleGaps.push({ at: marks[i - 1], len: marks[i] - marks[i - 1] });
  const ig = maxGap(idleGaps);
  const over5 = idleGaps.filter((g) => g.len > 300).map((g) => `${fmtMin(g.len)}@${fmtMin(g.at)}`);
  const pct = (x) => `${Math.round((100 * x) / Math.max(1, A.t))}%`;
  return {
    run: `${log.cfg.site}:${log.cfg.exp}:${log.cfg.policy}${log.cfg.auto ? ':auto' : ''}:${log.picks}`, seed: log.cfg.seed,
    picks: log.picks, band: log.final.band, crewHome: log.final.crewHome,
    flMin: log.firstLight ? log.firstLight / 60 : null,
    eras: eras.map((x) => (x == null ? null : +x.toFixed(1))),
    actGap: ag.len / 60, evtGap: eg.len / 60, brownPct: A.brownout / Math.max(1, A.t), wornPct: A.worn / Math.max(1, A.t),
    stallMin: A.goodsStall / 60,
    firstLight: fmtMin(log.firstLight),
    swarmProtocol: fmtMin(log.swarmProtocolAt),
    eraOpen: Object.fromEntries(Object.entries(log.eraOpen).map(([e, t]) => [e, fmtMin(t)])),
    eraDur: eras.map((x) => (x == null ? '—' : x.toFixed(1))).join(' / '),
    via: log.eraVia,
    idleMax: `${fmtMin(ig.len)} @${fmtMin(ig.at)}`, idleMin: ig.len / 60, idleOver5: over5,
    idleMaxAction: `${fmtMin(ag.len)} @${fmtMin(ag.at)}`,
    idleMaxEvent: `${fmtMin(eg.len)} @${fmtMin(eg.at)}`,
    brownout: pct(A.brownout), brownoutNight: pct(A.brownoutNight), shed: pct(A.shed),
    partsZero: pct(A.partsZero), worn: pct(A.worn), paused: pct(A.paused), queueEmpty: pct(A.queueEmpty),
    goodsStallMin: fmtMin(A.goodsStall), goodsBy: Object.fromEntries(Object.entries(A.goodsBy).map(([k, v]) => [k, fmtMin(v)])),
    siteIdleMin: Object.fromEntries(Object.entries(A.siteIdle).map(([k, v]) => [k, fmtMin(v)])),
    blockedMin: Object.fromEntries(Object.entries(A.blockedBy).map(([k, v]) => [k, fmtMin(v)])),
    deaths: A.deaths, bankMax: Math.round(A.bankMax),
    outcome: log.firstLight ? 'FIRST LIGHT' : log.final.defeat ? 'DEFEAT' : `era ${log.final.era} at ${fmtMin(log.final.t)}`,
    techs: log.final.techsDone.length,
    buildings: log.final.buildings.map(([k, v]) => `${k}${v}`).join(' '),
    outposts: log.final.outposts, surveyed: log.final.surveyed.length, downlinks: log.final.downlinks,
    shipments: log.final.resupply?.shipments ?? 0, milestones: log.milestones,
    auto: log.cfg.auto ? 'on' : 'off',
    autoBuilt: A.autoBy, autoBuiltN: Object.values(A.autoBy).reduce((a, b) => a + b, 0),
    builtN: log.final.stats.built ?? null,
    rulePhaseMin: Object.fromEntries(Object.entries(A.rulePhase).map(([k, v]) => [k, fmtMin(v)])),
    caps: log.actions.filter((a) => a[1] === 'cap').map((a) => a[2]),
  };
}

const results = [];
await withGame({ port: PORT, site: RUNS[0].site, exp: RUNS[0].exp, seed: SEEDS[0], lowfx: true, reuseServer: argv.includes('--reuse'),
  viewport: { width: 480, height: 320 } }, async ({ page, errors }) => {
  // pause the moment the debug API attaches, so every run starts at the same
  // game-second no matter how long the page took to load (determinism)
  await page.addInitScript(() => {
    let g;
    Object.defineProperty(window, '__game', {
      configurable: true,
      get: () => g,
      // queued: the first frame applies it before it advances the clock
      set: (v) => { g = v; v.setPaused(true); },
    });
  });
  for (const run of RUNS) for (const seed of SEEDS) {
    const q = `?debug&nolock&lowfx&seed=${seed}&site=${run.site}${run.exp === 'robotic' ? '&exp=robotic' : ''}`;
    await page.goto(`http://127.0.0.1:${PORT}/${q}`);
    await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 30_000 });
    const info = await page.evaluate(installBot, {
      ...run, seed, pick: PICK, fleet: FLEET_VERBS, auto: AUTO_ON, saversEarly: SAVERS_EARLY, destiny: DESTINY, picks: PICKS_ARG,
      replaceStep: REPLACE_STEP,
    });
    if (!QUIET) console.log(`\n=== ${run.site} ${run.exp} ${run.policy} seed ${seed} · destiny ${info.picks} · doctrines ${JSON.stringify(info.pick)}`);
    for (let m = 0; m < MINUTES; m += 10) {
      const r = await page.evaluate((n) => window.__bot.step(n), Math.min(10, MINUTES - m));
      if (!QUIET) {
        console.log(`  t=${fmtMin(r.t).padStart(5)} era ${r.era} techs ${String(r.techs).padStart(2)} labs ${r.labs} dcs ${r.dcs} ` +
          `rate ${r.rate.toFixed(2)} crew ${r.crew} ◆${r.res.metals} ⚙${r.res.parts} ◇${r.res.silicon} ▣${r.res.chips} ` +
          `▰${r.res.foils} ↑${r.res.launch.toFixed?.(1) ?? r.res.launch} q[${r.queue.join(',')}]${r.stalled.length ? ` stalled[${r.stalled}]` : ''}`);
      }
      if (r.firstLight || r.defeat) break;
    }
    const log = await page.evaluate(() => window.__bot.report());
    const sum = summarize(log);
    results.push({ summary: sum, log });
    console.log(JSON.stringify(sum, null, 1));
    if (errors.length) console.log('page errors:', errors.slice(0, 5));
  }
});

console.log('\nrun                              | FIRST LIGHT | eras E1…E8 (min)                         | idle(both/act/evt) | brown | worn | goods-stall');
for (const { summary: r } of results) {
  console.log(`${`${r.run}#${r.seed}`.padEnd(33)}| ${String(r.firstLight).padEnd(11)} | ${r.eraDur.padEnd(40)} | ${r.idleMax.split(' ')[0]}/${r.idleMaxAction.split(' ')[0]}/${r.idleMaxEvent.split(' ')[0]}`.padEnd(110) +
    ` | ${r.brownout.padEnd(5)} | ${r.worn.padEnd(4)} | ${r.goodsStallMin} · ${r.outcome}`);
}
// medians across seeds (FIRST LIGHT not reached counts as the run length, flagged ›)
const med = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
if (SEEDS.length > 1) {
  console.log('\nmedian over seeds ' + SEEDS.join(',') + '\nrun                         | FIRST LIGHT      | eras E1…E8 (min)                          | idle max | act gap | brown | worn | stall');
  for (const run of RUNS) {
    const key = `${run.site}:${run.exp}:${run.policy}${AUTO_ON ? ':auto' : ''}`;
    const rs = results.map((x) => x.summary).filter((x) => x.run.startsWith(`${key}:`));
    const fl = rs.map((x) => x.flMin ?? MINUTES + 1);
    const flTxt = `${med(fl).toFixed(1)}${fl.some((x) => x > MINUTES) ? '›' : ''} [${fl.map((x) => (x > MINUTES ? '—' : x.toFixed(0))).join(',')}]`;
    const eras = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => med(rs.map((x) => x.eras[i])));
    console.log(`${key.padEnd(28)}| ${flTxt.padEnd(16)} | ${eras.map((x) => (x == null ? '—' : x.toFixed(1))).join(' / ').padEnd(41)} | ` +
      `${Math.max(...rs.map((x) => x.idleMin)).toFixed(1).padEnd(8)} | ${med(rs.map((x) => x.actGap)).toFixed(1).padEnd(7)} | ${(100 * med(rs.map((x) => x.brownPct))).toFixed(0).padEnd(4)}% | ` +
      `${(100 * med(rs.map((x) => x.wornPct))).toFixed(0).padEnd(3)}% | ${med(rs.map((x) => x.stallMin)).toFixed(1)}`);
  }
}
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 1));
