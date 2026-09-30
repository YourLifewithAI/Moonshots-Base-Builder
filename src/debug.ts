/** Test/debug API — the testability keystone. Enabled with ?debug.
 *  Playwright drives the whole game loop through window.__game. */
import type { Game } from './core/game';
import type { BuildingId } from './data/buildings';
import { TECHS, TECH_ALIASES, TRACKS, auditTechs, techRelevanceMatrix, type Era, type Side, type TechId } from './data/techs';
import type { SiteId } from './data/sites';
import type { ResourceId } from './data/resources';
import type { GameStats, HubPolicy } from './core/state';
import { destinyOf, gateProgress, researchView } from './core/research';
import { GRID, volleyTerms } from './core/economy';
import { recipeTriangles, upgradeTriangles } from './buildings/recipes';
import { upgradeKey } from './buildings/upgrades';
import type { UpgradeInfo } from './buildings/instances';
import { BUILDINGS } from './data/buildings';
import { MILESTONES, milestoneHint } from './data/milestones';
import type { MapView, ProspectId } from './data/lunarMap';
import { sfx, type Cue } from './audio/sfx';
import { worldRect } from './core/paths';
import { accessCell, cellAt, doorCell, gatesOf, holdOf, mastStand, openAll, planLink, planPath, roadMap, roadRoute, servedFields } from './core/roads';
import { zoneCells } from './core/zones';
import { choicesFor, haulEnd, haulOpts, heightsOf, hubOf, plainPitRefusal, targetOf, unitsOf } from './core/hubs';
import { ghostBlock, hubGhostLine, hubLight, pitWayWarning } from './core/hubPreview';
import { $deposits, $hubCard, $hubLight } from './ui/stores';
import { SITES } from './data/sites';
import type { AutoFamily, AutoRuleId } from './data/automation';
import type { CounterId, HazardId, Tier } from './data/hazards';
import type { ArrayChoice, FlareClass, FlareCounterId } from './data/spaceWeather';
import { WEATHER_STUB, activity, arrayView, classOdds, cycleOf, drawClass, fieldsOf, weatherView } from './core/spaceWeather';
import { capabilityView, scarredList } from './core/flareEffects';
import { currentDay } from './core/economy';
import {
  faceCapacity, reclaimRefusal, reservesOf, stripMorale, surveyLine, surveyRefusal, targetGrade, terrainOf,
} from './core/pits';
import { gradeAtPoint } from './core/ore';
import { effectiveRates } from './core/mods';
import type { Process } from './data/ore';
import { predictFlares, trueClass, withForecast } from './core/forecast';

declare global {
  interface Window { __game?: ReturnType<typeof api> }
}

/** Old probe scripts may name retired techs: map them (spec §8), warning;
 *  a retired id with no successor is a warned no-op (null). */
function techId(id: string): TechId | null {
  if (!(id in TECH_ALIASES)) return id as TechId;
  const to = TECH_ALIASES[id];
  console.warn(`[debug] ${id} is retired${to ? ` — using ${to}` : ' — ignored'}`);
  return to;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function api(game: Game) {
  const withTech = (id: string, fn: (t: TechId) => void) => {
    const t = techId(id);
    if (t) fn(t);
  };
  return {
    getState: () => JSON.parse(JSON.stringify(game.state ?? null)),
    selectSite: (site: SiteId, exp: 'human' | 'robotic' = 'human') => game.startNew(site, exp),
    placeBuilding: (type: BuildingId, gx: number, gz: number, rot: 0 | 1 | 2 | 3 = 0) =>
      game.debugPlace(type, gx, gz, rot),
    grantResources: (map: Partial<Record<ResourceId, number>>) => {
      for (const [rid, amt] of Object.entries(map)) {
        game.state.resources[rid as ResourceId] += amt ?? 0;
      }
      game.publish();
    },
    grantData: (n: number) => { game.state.data += n; game.publish(); },
    grantCrew: (n: number) => { game.state.crew += n; game.publish(); },
    grantPower: (n: number) => { game.state.powerStored += n; game.publish(); },
    setPriority: (id: number, priority: 0 | 1 | 2 | 3) => game.actions.push({ kind: 'setPriority', id, priority }),
    setEnabled: (id: number, enabled: boolean) => game.actions.push({ kind: 'setEnabled', id, enabled }),
    setAutomated: (id: number, automated: boolean) => game.actions.push({ kind: 'setAutomated', id, automated }),
    setAgentCover: (on: boolean) => game.actions.push({ kind: 'setAgentCover', on }),
    demolish: (id: number) => game.actions.push({ kind: 'demolish', id }),
    buildNext: (id: number) => game.actions.push({ kind: 'buildNext', id }),
    /** open the inspector on a building (null closes it) */
    select: (id: number | null) => game.select(id),
    completeTech: (id: TechId) => withTech(id, (t) => game.debugCompleteTech(t)),
    research: (id: TechId) => withTech(id, (t) => game.actions.push({ kind: 'research', tech: t })),
    /** shift-click: the tech and its prerequisite closure */
    researchPath: (id: TechId) => game.actions.push({ kind: 'researchPath', tech: id }),
    cancelResearch: (id: TechId) => withTech(id, (t) => game.actions.push({ kind: 'cancelResearch', tech: t })),
    moveResearch: (id: TechId, delta: -1 | 1) => game.actions.push({ kind: 'moveResearch', tech: id, delta }),
    /** the $research payload: cards, gates, queue, rates */
    getResearch: () => clone(researchView(game.state, game.mods)),
    auditTechs: () => clone(auditTechs()),
    /** every objective as this run reads it: its hint (doctrine, expedition) and status line */
    getObjectives: () => MILESTONES.map((m) => ({
      id: m.id, done: game.state.milestonesDone.includes(m.id),
      hint: milestoneHint(m, game.state), progress: m.progress?.(game.state) ?? '',
    })),
    techRelevanceMatrix: () => techRelevanceMatrix(),
    /** force charter / insight counters (tests of deed routes) */
    setStats: (patch: Partial<GameStats>) => { Object.assign(game.state.stats, patch); game.publish(); },
    setOverclock: (id: number, on: boolean) => game.actions.push({ kind: 'setOverclock', id, on }),
    downlink: () => game.actions.push({ kind: 'downlink' }),
    launch: () => game.actions.push({ kind: 'launch' }),
    setSpeed: (n: number) => game.actions.push({ kind: 'setSpeed', speed: n }),
    setPaused: (p: boolean) => game.actions.push({ kind: 'setPaused', paused: p }),
    advanceGameMinutes: (min: number) => game.debugAdvance(Math.round(min * 60)),
    advanceGameSeconds: (s: number) => game.debugAdvance(Math.round(s)),
    /** one live frame of `realDt` wall-seconds, through the real loop's clamps */
    stepFrame: (realDt: number) => game.debugFrame(realDt),
    setView: (pos: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }) =>
      game.debugSetView(pos, target),
    setTerrainVisible: (v: boolean) => game.debugSetTerrainVisible(v),
    /** run the black-frame check on the next drawn frame (with the terrain
     *  hidden: a silent terrain failure, as the check sees it) */
    probeNext: () => game.debugProbeNext(),
    save: () => game.doSave(),
    /** touch mode: the gesture recognizer, the pointer, the road tool's Remove toggle */
    getTouch: () => clone(game.debugTouch()),
    /** the pointer the ghost and picking read (CSS px) */
    pointAt: (x: number, y: number) => game.pointAt(x, y),
    surveyIce: () => game.actions.push({ kind: 'surveyIce' }),
    orderResupply: () => game.actions.push({ kind: 'orderResupply' }),
    gradeAt: (gx: number, gz: number) => game.actions.push({ kind: 'grade', gx, gz }),
    getIceDeposits: () => JSON.parse(JSON.stringify(game.iceDepositList)),
    canPlace: (type: BuildingId, gx: number, gz: number, rot: 0 | 1 | 2 | 3 = 0) => game.debugCheckPlace(type, gx, gz, rot),
    // ── the Lunar Map and local deposits (spec §5) ──
    surveyProspect: (id: ProspectId) => game.actions.push({ kind: 'surveyProspect', id }),
    claimOutpost: (id: ProspectId) => game.actions.push({ kind: 'claimOutpost', id }),
    abandonOutpost: (id: ProspectId) => game.actions.push({ kind: 'abandonOutpost', id }),
    /** the $lunar payload */
    getLunar: () => clone(game.debugLunar()),
    /** the $deposits payload */
    getDeposits: () => clone(game.debugDeposits()),
    /** the deposit under a world point (null = plain ground) */
    depositAt: (x: number, z: number) => clone(game.debugDepositAt(x, z)),
    revealAll: () => game.debugRevealAll(),
    /** exactly n live outposts at the nearest claimable prospects (deed tests) */
    forceOutposts: (n: number) => game.debugForceOutposts(n),
    setMapOpen: (open: boolean) => game.setMapOpen(open),
    setMapView: (view: MapView) => game.setMapView(view),
    enableSafeMode: () => game.enableSafeMode(),
    /** the player turning safe mode off in the menu (a checked raise) */
    disableSafeMode: () => game.disableSafeMode(),
    getRenderInfo: () => game.debugRenderInfo(),
    /** the ink outlines (docs/19 S1b): make their program fail to compile, as a
     *  bad GPU would (the game hides the outlines, never itself); pick the
     *  bake-off variant A, B or C over the constant (null: the constant) */
    breakInk: () => game.debugBreakInk(),
    setInkVariant: (v: 'A' | 'B' | 'C' | null) => game.debugSetInkVariant(v),
    /** hold the black-frame sentinel off (true) or resume it */
    holdBlackFrameCheck: (on: boolean) => game.debugHoldProbe(on),
    /** the work animations (docs/06 §7): per rover its mode, arm (unfold, yaw,
     *  reach, tip) and spark; per drone its spark; per excavator its wheel and
     *  boom angles; the kit and glow instance counts */
    getWorkAnim: () => clone((game as any).life.work.info()),
    /** hide or show the work animations' two meshes (the draw-call budget) */
    setWorkAnimVisible: (on: boolean) => { (game as any).life.work.group.visible = on; },
    /** one structure's own light: its darkness k (and what makes it), the
     *  lit channel its instance carries, the emissive gains */
    getBuildingLight: (id: number) => clone((game as any).instances.lightInfo(id)),
    /** what the menu shows about the render path */
    getRenderStatus: () => game.renderStatus(),
    /** the audio layer: context state, cues accepted per kind, the hum */
    getAudio: () => sfx.info(),
    playCue: (cue: Cue) => sfx.play(cue),
    getCamera: () => game.debugCamera(),
    /** CSS px of the ground at (x, z), `lift` m above it */
    screenOf: (x: number, z: number, lift = 0) => game.debugScreenOf(x, z, lift),
    /** the terrain mesh's vertex colour nearest (x, z) */
    terrainColorAt: (x: number, z: number) => game.debugTerrainColor(x, z),
    /** the drawn ground vs hf.sample: { vertex, max, mean } (m) */
    terrainError: () => game.debugTerrainError(),
    /** a structure's light: { glow (the windows' iGlow), powered } */
    buildingGlow: (id: number) => game.debugBuildingGlow(id),
    /** a structure's light colour and alarm (docs/14 §4.4): { warm (iWarm 0 cold … 1 warm), alarm (iAlarm), lean } */
    buildingLook: (id: number) => clone((game as any).instances.lookOf(id)),
    /** the building-state visual hook (instances.ts alarmOf): (b) => 0 calm … 1 alarmed; null clears it */
    setAlarmHook: (fn: ((b: unknown) => number) | null) => { (game as any).instances.alarmOf = fn ?? undefined; },
    /** stand in for the hazards' fx (hazardView().fx) in the renderer: { id: ['flicker' | 'dark' | …] }; null restores it */
    setHazardFx: (fx: Record<number, string[]> | null) => {
      const g = game as any;
      g.hazardFxHook ??= g.instances.fxOf;
      const hook = fx ? (id: number) => fx[id] : g.hazardFxHook;
      g.instances.fxOf = hook;
      g.life.fxOf = hook;
    },
    /** a roster unit's hazard fields (tests): { brickedUntil, heldUntil } */
    patchRover: (id: number, patch: { brickedUntil?: number; heldUntil?: number }) => {
      const r = game.state.rovers.find((x) => x.id === id);
      if (r) Object.assign(r, patch);
      game.publish();
    },
    // ── space weather (docs/16) ──
    /** a flare's telegraph now: its class, and whether it is a drill (default: the first of the class, or flare 0) */
    forceFlare: (cls: FlareClass, o: { drill?: boolean } = {}) => game.debugForceFlare(cls, o),
    /** the $weather payload (chip, pop-up, panel), with an optional slider share for its previews */
    getSpaceWeather: (slider?: number) => {
      const s = game.state;
      const site = SITES[s.siteId];
      const day = currentDay(s, site);
      return clone(withForecast(weatherView(s, game.mods, site, day, slider), s, game.mods, site, day, { ahead: game.forecastAheadOpen, slider }));
    },
    // ── forecasting (docs/16 §6, core/forecast.ts) ──
    /** 'Arrays: choose now…': the choice set ahead for the next flare (null clears) */
    flareAhead: (choice: ArrayChoice | null, o: { repair?: boolean; remember?: boolean } = {}) =>
      game.actions.push({ kind: 'flareAhead', choice, ...o }),
    /** open or close the ahead card (its previews are built only while it is open) */
    setForecastAhead: (open: boolean) => game.setForecastAhead(open),
    /** Launch sentinel (the Lander's action) */
    launchSentinel: () => game.actions.push({ kind: 'launchSentinel' }),
    /** the schedule run forward, as T3 reads it: the next flares' true classes and flashes (tests) */
    predictFlares: (count = 3) => clone(predictFlares(game.state, count)),
    /** the next flare's true class at this era, as the telegraph will draw it (tests) */
    trueClass: () => trueClass(game.state, game.state.era),
    /** the pop-up's preview of one choice (the slider's), or null outside a telegraph */
    flarePreview: (choice: ArrayChoice) => clone(game.flarePreview(choice)),
    /** the pop-up's Confirm: the choice for every array, Repair after, Use this choice for future flares */
    flareChoice: (choice: ArrayChoice, o: { repair?: boolean; remember?: boolean } = {}) =>
      game.actions.push({ kind: 'flareChoice', choice, ...o }),
    flareRemember: (cls: FlareClass, choice: ArrayChoice | null) => game.actions.push({ kind: 'flareRemember', cls, choice }),
    flareAutoRepair: (on: boolean) => game.actions.push({ kind: 'flareAutoRepair', on }),
    fieldOverride: (id: number, mode: 'follow' | 'stow' | 'run') => game.actions.push({ kind: 'fieldOverride', id, mode }),
    wreckAction: (how: 'rebuild' | 'clear', id?: number) => game.actions.push({ kind: 'wreck', how, ...(id !== undefined ? { id } : {}) }),
    repairArrays: (id?: number) => game.actions.push({ kind: 'repairArrays', ...(id !== undefined ? { id } : {}) }),
    /** the probe's baseline: 'legacy' plays today's flare (docs/16 §12.3); 'on' the classed flares */
    setFlareMode: (mode: 'legacy' | 'on') => { (game.state.weather ??= { remember: {}, autoRepair: true, answered: {}, repairs: [], seenSunAt: 0 }).legacy = mode === 'legacy'; game.publish(); },
    /** the flare's counters (docs/16 §4): 'flareRecall' | 'flareCheckpoint' | 'flareShutDown' | 'flareReplace' (id) | 'flareReprint' (rover id)
     *  | 'flareReprintUnit' (unit id) | 'flareReplaceWorst' — as the alert and pop-up buttons push them */
    flareCounter: (counter: FlareCounterId, id?: number) => game.actions.push({ kind: 'counter', counter, ...(id !== undefined ? { id } : {}) }),
    /** a structure's ('b'), rover's ('r') or hub unit's ('h') capability, as rad scars would leave it (tests) */
    setCapability: (kind: 'b' | 'r' | 'h', id: number, cap: number) => {
      const s = game.state;
      const x: { cap?: number } | undefined = kind === 'b' ? s.buildings.find((b) => b.id === id) : kind === 'r' ? s.rovers.find((r) => r.id === id) : s.haulers.find((u) => u.id === id);
      if (x) x.cap = cap;
      game.publish();
    },
    /** the next flare's index (its seeded draws: the class, each machine's glitch; tests) */
    setFlareIndex: (n: number) => { game.state.flare.n = n; game.publish(); },
    /** the scarred, worst first (the panel's SCARRED line): kind 'b' a structure, 'r' a rover or drone, 'h' a hub unit */
    flareScarred: () => clone(scarredList(game.state)),
    /** a structure's capability line (σ, capability, scars, Replace's cost, time and payback) */
    flareCapability: (id: number) => {
      const s = game.state; const b = s.buildings.find((x) => x.id === id);
      return b ? clone(capabilityView(s, game.mods, SITES[s.siteId], b)) : null;
    },
    /** stand-ins for protection the later phases bring: Rad-Hard Cells' ×0.4 on array damage, a σ on every structure (F4) */
    setWeatherStub: (patch: Partial<typeof WEATHER_STUB>) => { Object.assign(WEATHER_STUB, patch); },
    /** the cycle and the class draw, as the schedule reads them */
    weatherCycle: (T: number) => ({ a: activity(game.state.seed, T), ...cycleOf(game.state.seed) }),
    classOdds: (a: number, era: number) => classOdds(a, era),
    drawClass: (n: number, at: number, era: number) => drawClass(game.state, n, at, era),
    /** a Solar Array's inspector line data (field, capability, damage, override, wreck) */
    arrayInfo: (id: number) => { const s = game.state; const site = SITES[s.siteId]; return clone(arrayView(s, site, currentDay(s, site), id)); },
    arrayFields: () => clone(fieldsOf(game.state).fields),
    /** raise the era now (tests of the era floors: no techs, no charters; the era never goes down) */
    forceEra: (n: number) => { game.state.era = Math.max(game.state.era, Math.min(8, n)); game.publish(); },
    /** on-board power (docs/02 · On-board power): the grid at 0 — no supply, the bank out of
     *  reach — while on (a forced brownout for tests; off returns the grid) */
    forceGridDark: (on = true) => { GRID.dark = on; game.publish(); },
    /** a unit's pack (tests): a roster unit by id, an excavator by building id, a hub unit by its id; kWh (null: full) */
    setCharge: (kind: 'rover' | 'digger' | 'unit', id: number, kwh: number | null) => {
      const p = kind === 'rover' ? game.state.rovers.find((x) => x.id === id)
        : kind === 'unit' ? game.state.haulers.find((u) => u.id === id)?.haul
        : game.state.buildings.find((b) => b.id === id)?.haul;
      if (!p) return false;
      if (kwh === null) delete p.charge; else p.charge = kwh;
      game.publish();
      return true;
    },
    rocksIn: (x0: number, z0: number, x1: number, z1: number) => game.debugRocksIn(x0, z0, x1, z1),
    // ── strip-mine pits (core/pits.ts, terrain/pitCarve.ts, docs/17 Phase 3) ──
    /** every pit (derived numbers too), the delta grid encoded, the chunk rebuild queue */
    getPits: () => clone(game.debugPits()),
    /** one heightfield sample: { h, base, delta (dm), pad, skirt } */
    terrainSample: (ix: number, iz: number) => game.debugSample(ix, iz),
    /** the adapter as an excavator calls it: `tonnes` of regolith dug at world (x, z) */
    pitDig: (x: number, z: number, tonnes: number, q = 1) => game.debugPitDig(x, z, tonnes, q),
    // ── grade, reserves, faces, surveys, morale and Reclaim (core/pits.ts, core/ore.ts, docs/17 Phase 4) ──
    /** a deposit's reserves as its card reads them (the truth too), or null */
    getReserves: (id: string) => clone(reservesOf(game.state, game.mods, id)),
    /** faces at a target key ('dep:<id>', 'plain:<id>'): now and at full size */
    faceCapacity: (key: string) => faceCapacity(game.state, key),
    /** the grade (q) a hub's units would bring from a target now */
    targetGrade: (hub: number, key: string) => {
      const b = game.state.buildings.find((x) => x.id === hub);
      return b ? targetGrade(game.state, game.mods, SITES[game.state.siteId], b.type, key) : null;
    },
    /** the grade (q, before crew and research) at world (x, z) for a process */
    oreGradeAt: (process: Process, x: number, z: number) => gradeAtPoint(game.state, terrainOf(game.state)?.deposits ?? [], process, x, z),
    /** Survey: a rover cores the deposit (queued; its refusal alerts) */
    surveyDeposit: (id: string) => game.actions.push({ kind: 'surveyDeposit', id }),
    surveyWhy: (id: string) => surveyRefusal(game.state, game.mods, id),
    surveyLine: (id: string) => surveyLine(game.state, id),
    /** Reclaim a pit (by its id) */
    reclaimPit: (pit: number) => game.actions.push({ kind: 'reclaimPit', pit }),
    reclaimWhy: (pit: number) => reclaimRefusal(game.state, game.state.pits.find((p) => p.id === pit)),
    /** the strip-mine morale term and its worst pit */
    stripMorale: () => clone(stripMorale(game.state)),
    /** a hub's recipe now: its q, the feed factor its output reads, and outputs at its q and at q 1 */
    hubOutput: (hub: number) => {
      const b = game.state.buildings.find((x) => x.id === hub);
      if (!b?.hub) return null;
      const site = SITES[game.state.siteId];
      const r = effectiveRates(b.type, game.mods, site, b, { feed: b.hub.feed, agentRun: true });
      const ref = effectiveRates(b.type, game.mods, site, b, { feed: b.hub.feed, agentRun: true, q: 1 });
      return { q: b.hub.q, feedFactor: r.feedFactor, outputs: r.outputs, ref: ref.outputs };
    },
    /** Site Grading's check at a square's corner cell: { valid, reason } */
    canGrade: (gx: number, gz: number) => clone(game.debugCheckGrade(gx, gz)),
    /** relief (m) over a sample rect */
    terrainRelief: (gx0: number, gz0: number, gx1: number, gz1: number) => game.debugRelief(gx0, gz0, gx1, gz1),
    /** a hash of every height and delta sample */
    terrainHash: () => game.debugTerrainHash(),
    recipeTriangles: () => recipeTriangles(),
    /** the upgrade budget: stock and fully upgraded triangles per type, and each part's */
    upgradeTriangles: () => upgradeTriangles(),
    /** research you can see: each type's upgrade key (from techsDone), the key and
     *  triangles its InstancedMesh draws, and the placement ghost's */
    getUpgrades: () => {
      const meshes = (game as any).instances.upgradeInfo() as Record<string, UpgradeInfo>;
      const want: Record<string, string> = {};
      for (const t of Object.keys(BUILDINGS) as BuildingId[]) want[t] = upgradeKey(t, game.state.techsDone);
      const g = (game as any).placement?.ghost as { geometry: { index: { count: number } | null; getAttribute(n: string): { count: number } } } | null;
      const ghost = g ? (g.geometry.index ? g.geometry.index.count : g.geometry.getAttribute('position').count) / 3 : null;
      const ri = (game as any).instances.renderInfo();
      return { want, meshes, ghost, trackers: ri.trackers, decals: ri.decals, pools: ri.discs };
    },
    beginPlacement: (type: BuildingId) => game.beginPlacement(type),
    cancelPlacement: () => game.cancelPlacement(),
    // ── fleet control (core/fleet.ts, core/haul.ts) ──
    summonRover: (site: number) => game.actions.push({ kind: 'summonRover', site }),
    releaseRover: (site: number) => game.actions.push({ kind: 'releaseRover', site }),
    sendRover: (rover: number, site: number) => game.actions.push({ kind: 'sendRover', rover, site }),
    unpinRover: (rover: number) => game.actions.push({ kind: 'unpinRover', rover }),
    digAt: (id: number, x: number, z: number) => game.actions.push({ kind: 'digAt', id, x, z }),
    digHome: (id: number) => game.actions.push({ kind: 'digHome', id }),
    /** open the rover inspector (null closes it) */
    selectRover: (id: number | null) => game.selectRover(id),
    /** Send to… / Dig at… as the inspector buttons start them */
    beginSendRover: (rover: number) => game.beginFleetTarget({ kind: 'send', rover }),
    beginDigAt: (id: number) => game.beginFleetTarget({ kind: 'dig', id }),
    cancelFleetTarget: () => game.cancelFleetTarget(),
    getFleetTarget: () => clone(game.debugFleetTarget()),
    /** the $fleet payload: rovers, site crews and ETAs, hauls and dig options */
    getFleet: () => clone(game.debugFleet()),
    /** screen position of a drawn rover (roster id), legacy excavator (building id) or hub unit (its id) */
    poseOnScreen: (kind: 'rover' | 'digger' | 'unit', id: number) => game.debugPoseOnScreen(kind, id),
    // ── extraction hubs (core/hubs.ts, docs/17) ──
    /** the hubs' and units' views ($fleet.hubs, $fleet.units) */
    getHubs: () => { const f = clone(game.debugFleet()); return { hubs: f.hubs, units: f.units }; },
    /** a hub's dig choices as its units rank them: key, trip (one way, s), rate, q, score, faces, reach */
    hubChoices: (hub: number) => {
      const s = game.state;
      const b = s.buildings.find((x) => x.id === hub);
      if (!b?.hub) return [];
      const n = Math.max(1, unitsOf(s, hub).filter((u) => !u.pinned).length);
      return choicesFor(s, game.mods, SITES[s.siteId], b, n).map((c) => ({
        key: c.target.key, name: c.target.name, t: c.trip.t, roadM: c.trip.roadM, offM: c.trip.offM, connected: c.trip.connected,
        rate: c.rate, q: c.q, score: c.score, faces: c.target.faces, free: c.free, inReach: c.inReach,
      }));
    },
    queueUnit: (hub: number) => game.actions.push({ kind: 'queueUnit', hub }),
    queueBay: (hub: number) => game.actions.push({ kind: 'queueBay', hub }),
    cancelJob: (hub: number, index = 0) => game.actions.push({ kind: 'cancelJob', hub, index }),
    assignPit: (hub: number, key: string | null) => game.actions.push({ kind: 'assignPit', hub, key }),
    openPit: (hub: number, x: number, z: number) => game.actions.push({ kind: 'openPit', hub, x, z }),
    /** a hub ghost's HUB line at (gx, gz, rot): where its units would dig, how far one way */
    hubGhost: (type: BuildingId, gx: number, gz: number, rot: 0 | 1 | 2 | 3 = 0) =>
      hubGhostLine(game.state, game.mods, SITES[game.state.siteId], { type, gx, gz, rot }),
    /** a hub ghost's whole HUB block at (gx, gz, rot): headline, lines, warning, stake, lit entries (docs/17 §5.2) */
    hubBlock: (type: BuildingId, gx: number, gz: number, rot: 0 | 1 | 2 | 3 = 0) => {
      const b = ghostBlock(game.state, game.mods, SITES[game.state.siteId], { type, gx, gz, rot });
      return {
        headline: b.headline, lines: [...b.lines], warn: b.warn, stake: b.stake, entries: b.light?.entries ?? [],
        // the dashed haul road it would plan from its door (docs/19 S3): [gx, gz] cells
        road: (b.road ?? []).map((k) => [k % 256, Math.floor(k / 256)]),
      };
    },
    /** the highlight a selected hub (its id) or a hub card (its type) would light */
    hubLightOf: (src: number | BuildingId) =>
      hubLight(game.state, game.mods, SITES[game.state.siteId], typeof src === 'number' ? { kind: 'selected', id: src } : { kind: 'card', type: src })?.entries ?? null,
    /** the highlight up now: what is drawn, and its entries (docs/17 §6.1) */
    getHighlight: () => ({ ...game.debugHighlight(), view: $hubLight.get() }),
    /** R: turn the ghost a quarter */
    rotatePlacement: () => game.rotatePlacement(),
    /** glide the build camera to look at world (x, z) */
    focusGround: (x: number, z: number) => game.focusGround(x, z),
    /** $deposits as the UI has it: the lit ones, with their lit state (docs/17 §6.1) */
    litDeposits: () => clone($deposits.get().filter((d) => d.lit)),
    /** view tests only: stand-in units hold faces at `key` till `n` are held in all (0 takes them away; never advance with them) */
    holdFaces: (key: string, n: number) => {
      const s = game.state;
      s.haulers = s.haulers.filter((u) => u.id < 90000);
      const proto = s.haulers[0];
      if (!proto || n <= 0) return 0;
      const held = new Set(s.haulers.filter((u) => u.target === key && u.face >= 0).map((u) => u.face));
      let k = 0;
      for (let f = 0; held.size + k < n && f < 12; f++) {
        if (held.has(f)) continue;
        s.haulers.push({ ...clone(proto), id: 90000 + f, hub: -1, target: key, face: f });
        k++;
      }
      return k;
    },
    /** view tests only: set the pit at `key`'s state ('boxed', 'exhausted', 'open') */
    setPitState: (key: string, state: 'open' | 'boxed' | 'exhausted') => {
      const p = game.state.pits?.find((x) => x.key === key);
      if (p) p.state = state;
      return !!p;
    },
    /** a hub's palette card hovered (null: none) */
    setHubCard: (type: BuildingId | null) => $hubCard.set(type),
    /** the ring warning a structure at (gx, gz, rot) would carry ('' none) */
    pitWayWhy: (type: BuildingId, gx: number, gz: number, rot: 0 | 1 | 2 | 3 = 0) =>
      pitWayWarning(game.state, SITES[game.state.siteId], { type, gx, gz, rot }),
    /** why a plain pit may not be staked at world (x, z) ('' = it may) */
    plainPitWhy: (x: number, z: number) => plainPitRefusal(game.state, game.mods, SITES[game.state.siteId], x, z),
    sendUnit: (unit: number, key: string) => game.actions.push({ kind: 'sendUnit', unit, key }),
    recallUnit: (unit: number) => game.actions.push({ kind: 'recallUnit', unit }),
    dispatchUnit: (unit: number) => game.actions.push({ kind: 'dispatchUnit', unit }),
    autoUnit: (unit: number) => game.actions.push({ kind: 'autoUnit', unit }),
    setHubPolicy: (hub: number, policy: HubPolicy) => game.actions.push({ kind: 'setHubPolicy', hub, policy }),
    setUnitFeedPlan: (unit: number, on: boolean) => game.actions.push({ kind: 'setUnitFeedPlan', unit, on }),
    setElectrolysis: (id: number, on: boolean) => game.actions.push({ kind: 'setElectrolysis', id, on }),
    /** open a hub unit's inspector (null closes it) */
    selectUnit: (id: number | null) => game.selectUnit(id),
    beginSendUnit: (unit: number) => game.beginFleetTarget({ kind: 'sendUnit', unit }),
    beginOpenPit: (hub: number) => game.beginFleetTarget({ kind: 'openPit', hub }),
    /** a unit's hub (tests) */
    unitHub: (unit: number) => { const u = game.state.haulers.find((x) => x.id === unit); return u ? hubOf(game.state, u)?.id ?? null : null; },
    /** a structure's footprint in world metres ({ x0, z0, x1, z1 }), or null */
    footprintOf: (id: number) => {
      const b = game.state.buildings.find((x) => x.id === id);
      if (!b) return null;
      const { x0, z0, x1, z1 } = worldRect(b);
      return { x0, z0, x1, z1 };
    },
    // ── the Builder (docs/13) ──
    order: (type: BuildingId, count = 1, intent?: { res?: ResourceId; like?: number }) =>
      game.actions.push({ kind: 'order', type, count, intent }),
    cancelOrder: (id: number) => game.actions.push({ kind: 'cancelOrder', id }),
    orderNext: (id: number) => game.actions.push({ kind: 'orderNext', id }),
    setRule: (rule: AutoRuleId, patch: { on?: boolean; threshold?: number; cap?: number }) =>
      game.actions.push({ kind: 'setRule', rule, ...patch }),
    setReserve: (res: ResourceId, amount: number | null) => game.actions.push({ kind: 'setReserve', res, amount }),
    moveFamily: (family: AutoFamily, delta: -1 | 1) => game.actions.push({ kind: 'moveFamily', family, delta }),
    freezeRules: (seconds: number) => game.actions.push({ kind: 'freezeRules', seconds }),
    setFeedPlan: (id: number, on: boolean) => game.actions.push({ kind: 'setFeedPlan', id, on }),
    /** the $automation payload: rules and their status lines, orders, reserves, the log */
    getAutomation: () => clone(game.debugAutomation()),
    /** set a building's wear (0..1) — the Maintenance tests */
    setWear: (id: number, wear: number) => {
      const b = game.state.buildings.find((x) => x.id === id);
      if (b) b.wear = Math.max(0, Math.min(1, wear));
      game.publish();
    },
    /** set a solar array's dust (0..SOLAR_DUST_MAX) — the EVA tests (docs/14) */
    setDust: (id: number, dust: number) => {
      const b = game.state.buildings.find((x) => x.id === id);
      if (b) b.dust = Math.max(0, Math.min(0.5, dust));
      game.publish();
    },
    /** where the Builder would put one of `type` now (a dry run) */
    planSite: (type: BuildingId, intent?: { res?: ResourceId; like?: number; edge?: boolean }) => clone(game.debugPlanSite(type, intent)),
    // ── destiny tracks (docs/14) ──
    /** complete an era's destiny pick, ⌂ 'colony' or ◉ 'automation' (as completeTech: no
     *  gate, no cost); returns the tech, or null for Era 1 (fixed at landing) or a rival done */
    pickDestiny: (era: Era, side: Side): TechId | null => {
      if (era < 2 || era > 8) return null;
      const t = TRACKS[era];
      const tid = side === 'colony' ? t.colony : t.automation;
      const other = side === 'colony' ? t.automation : t.colony;
      if (game.state.techsDone.includes(other)) return null;
      game.debugCompleteTech(tid);
      return tid;
    },
    /** the destiny meter and what the next volley costs (docs/14 §2.4, §2.7) */
    getDestiny: () => clone({
      ...destinyOf(game.state),
      crewHome: game.state.crewHome,
      forwarded: game.state.forwarded,
      evaCrew: game.state.evaCrew,
      volley: { ...volleyTerms(game.state, game.mods), auto: game.mods.autoLaunch },
      gates: Object.fromEntries([2, 3, 4, 5, 6, 7, 8].map((e) => [e, gateProgress(game.state, e as Era)])),
      tracks: Object.fromEntries(Object.entries(TRACKS).map(([e, t]) => [e, {
        ...t, colonyName: TECHS[t.colony].name, automationName: TECHS[t.automation].name,
      }])),
    }),
    /** Complete every construction site now, and open every road (one economy tick settles them). */
    finishConstruction: () => {
      for (const b of game.state.buildings) { b.construction = 0; b.spur = []; }
      openAll(game.state);
      game.debugAdvance(1);
    },
    /** the road tool as N starts it, and what it holds */
    beginRoadTool: () => game.beginRoadTool(),
    cancelRoadTool: () => game.cancelRoadTool(),
    getRoadTool: () => clone(game.debugRoadTool()),
    /** from now on a placement's road is laid open, no sintering (tests that time builds) */
    openRoads: (on = true) => { game.debugOpenRoads = on; },
    /** open every road cell now (sites stay as they are) */
    finishRoads: () => { openAll(game.state); game.publish(); },
    /** from now on every rover and drone trip ends as it starts, and the ones
     *  under way end now (tests where travel time is not the point; docs/15 §6) */
    instantTravel: (on = true) => { game.debugInstantTravel(on); },
    /** each structure's way in by road (docs/15-roads.md): its door (fields: none),
     *  the road cell it is reached by, and whether open road joins that to the Lander */
    roadAccess: () => {
      const s = game.state;
      const lander = s.buildings.find((b) => b.type === 'lander');
      const from = lander ? doorCell(lander) : null;
      const served = servedFields(s);
      const map = roadMap(s);
      return s.buildings.filter((b) => b.type !== 'lander').map((b) => {
        const door = doorCell(b);
        const cell = accessCell(s, b);
        const ms = mastStand(s, b);
        return {
          id: b.id, type: b.type, door, cell, served: served.has(b.id), spur: [...(b.spur ?? [])],
          doorOpen: !!door && (map.get(door[1] * 256 + door[0])?.left ?? 1) <= 0,
          linked: !!(from && cell && roadRoute(s, from, cell)),
          // a Relay Mast (docs/15 §5b): its gate, its stand and the off-road metres between
          ...(ms ? { stand: { gate: ms.gate, x: ms.x, z: ms.z, offM: ms.offM } } : {}),
        };
      });
    },
    /** the extraction zones (core/zones.ts): each one's circle, its cells and its gates */
    getZones: () => {
      const s = game.state;
      const cells = zoneCells(s);
      return (s.zones ?? []).map((z, i) => ({
        ...z, cells: [...cells].filter(([, j]) => j === i).map(([k]) => [k % 256, Math.floor(k / 256)]), gates: gatesOf(s, z),
      }));
    },
    /** the save as written, and a load of one (the migration tests) */
    saveBlob: () => clone((game as unknown as { saveBlob(): unknown }).saveBlob()),
    loadBlob: (blob: Parameters<Game['loadFrom']>[0]) => game.loadFrom(blob),
    // ── hazards (docs/14 §3) ──
    /** the Hazards panel's payload (hazardView) plus the raw state: live, log, meters, deaths, losses, grief */
    getHazards: () => clone({
      ...game.debugHazards(), state: game.state.hazards, deaths: game.state.deaths, losses: game.state.losses, grief: game.state.grief,
    }),
    /** start a hazard now (bypassing the scheduler); the first of a kind is its drill unless opts say.
     *  Returns the live hazard's id, or why it cannot start */
    forceHazard: (kind: HazardId, target?: number, opts?: { drill?: boolean; tier?: Tier }) => game.debugForceHazard(kind, target, opts),
    /** the next window in `seconds` (the scheduler started now); with `id`, that live hazard's clock ends in `seconds` */
    setHazardClock: (seconds: number, id?: number) => game.debugHazardClock(seconds, id),
    /** hold every hazard (tests that are not about them), or let them run */
    holdHazards: (on = true) => game.debugHoldHazards(on),
    /** a counter, as its button pushes it */
    counter: (counter: CounterId, id?: number) => game.actions.push({ kind: 'counter', counter, id }),
    airGap: (id: number, on = true) => game.actions.push({ kind: 'airGap', id, on }),
    /** the haul road a hub would plan to a target now (docs/19 S3): its whole route from the door, the
     *  gate, the holding bay, the passing bays and the sacrificial cells (cell [gx, gz] lists) */
    planHaul: (hub: number, key: string) => {
      const s = game.state, hf = heightsOf(s);
      const b = s.buildings.find((x) => x.id === hub), t = targetOf(s, key);
      if (!b || !t || !hf) return null;
      const end = haulEnd(s, t);
      const plan = planLink(s, hf, null, cellAt(end[0], end[1]), haulOpts(s, b, t));
      const xy = (k: number): [number, number] => [k % 256, Math.floor(k / 256)];
      return {
        reason: plan.reason, end, route: (plan.route ?? []).map(xy), gate: plan.gate ? { cell: xy(plan.gate.key), zone: plan.gate.zone } : null,
        hold: plan.hold !== undefined ? xy(plan.hold) : null, pass: (plan.pass ?? []).map(xy), sacrificial: (plan.sacrificial ?? []).map(xy),
        cells: plan.cells.map(xy), fresh: plan.fresh.map(xy),
      };
    },
    /** the road the tool would lay from an open road cell through waypoints to a cell (docs/19 S3): why not, and its cells */
    planRoad: (from: [number, number], to: [number, number], via: [number, number][] = []) => {
      const s = game.state, hf = heightsOf(s);
      if (!hf) return null;
      const plan = via.length ? planPath(s, hf, from, [...via, to]) : planLink(s, hf, from, to);
      return { reason: plan.reason, cells: plan.cells.map((k) => [k % 256, Math.floor(k / 256)]) };
    },
    /** the holding bay of a zone's gate, [gx, gz] (or null) */
    holdOf: (zone: string, gate: [number, number]) => {
      const z = game.state.zones?.find((q) => q.id === zone);
      return z ? holdOf(game.state, z, gate) : null;
    },
    /** the road tool's actions: a road from an open road cell to a cell; remove cells */
    layRoad: (from: [number, number], to: [number, number], via?: [number, number][]) => game.actions.push({ kind: 'layRoad', from, to, ...(via?.length ? { via } : {}) }),
    removeRoad: (cells: [number, number][]) => game.actions.push({ kind: 'removeRoad', cells }),
  };
}

export function attachDebug(game: Game) {
  window.__game = api(game);
}
