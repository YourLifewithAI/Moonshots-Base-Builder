/** Test/debug API — the testability keystone. Enabled with ?debug.
 *  Playwright drives the whole game loop through window.__game. */
import type { Game } from './core/game';
import type { BuildingId } from './data/buildings';
import { TECH_ALIASES, auditTechs, techRelevanceMatrix, type TechId } from './data/techs';
import type { SiteId } from './data/sites';
import type { ResourceId } from './data/resources';
import type { GameStats } from './core/state';
import { researchView } from './core/research';
import { recipeTriangles, upgradeTriangles } from './buildings/recipes';
import { upgradeKey } from './buildings/upgrades';
import type { UpgradeInfo } from './buildings/instances';
import { BUILDINGS } from './data/buildings';
import { MILESTONES, milestoneHint } from './data/milestones';
import type { MapView, ProspectId } from './data/lunarMap';
import { sfx, type Cue } from './audio/sfx';
import { worldRect } from './core/paths';
import { accessCell, doorCell, openAll, roadMap, roadRoute, servedFields } from './core/roads';
import type { AutoFamily, AutoRuleId } from './data/automation';

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
    setMode: (m: 'build' | 'walk') => game.setModeInstant(m),
    setView: (pos: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }) =>
      game.debugSetView(pos, target),
    setTerrainVisible: (v: boolean) => game.debugSetTerrainVisible(v),
    /** run the black-frame check on the next drawn frame (with the terrain
     *  hidden: a silent terrain failure, as the check sees it) */
    probeNext: () => game.debugProbeNext(),
    getPlayer: () => ({
      x: game.walkController.pos.x, y: game.walkController.pos.y, z: game.walkController.pos.z,
      yaw: game.walkController.yaw,
    }),
    save: () => game.doSave(),
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
    forceRenderFallback: () => (game as any).post.forceFallback('debug'),
    enableSafeMode: () => game.enableSafeMode(),
    /** the player turning safe mode off in the menu (a checked raise) */
    disableSafeMode: () => game.disableSafeMode(),
    getFxLevel: () => (game as any).post.fxLevel as number,
    setFxLevel: (n: number) => (game as any).post.setLevel(n),
    degradeFx: () => (game as any).post.degrade('debug'),
    getRenderInfo: () => game.debugRenderInfo(),
    /** one structure's own light: its darkness k (and what makes it), the
     *  lit channel its instance carries, the emissive gains and its flood slot */
    getBuildingLight: (id: number) => clone((game as any).instances.lightInfo(id)),
    /** what the menu shows about the render path */
    getRenderStatus: () => game.renderStatus(),
    /** the audio layer: context state, cues accepted per kind, the hum */
    getAudio: () => sfx.info(),
    playCue: (cue: Cue) => sfx.play(cue),
    getCamera: () => game.debugCamera(),
    /** CSS px of the ground at (x, z), `lift` m above it */
    screenOf: (x: number, z: number, lift = 0) => game.debugScreenOf(x, z, lift),
    /** the classic terrain mesh's vertex colour nearest (x, z) */
    terrainColorAt: (x: number, z: number) => game.debugTerrainColor(x, z),
    /** the drawn ground vs hf.sample: { vertex, max, mean } (m) */
    terrainError: () => game.debugTerrainError(),
    /** a structure's light: { glow (classic iGlow), powered } */
    buildingGlow: (id: number) => game.debugBuildingGlow(id),
    rocksIn: (x0: number, z0: number, x1: number, z1: number) => game.debugRocksIn(x0, z0, x1, z1),
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
    /** screen position of a drawn rover (roster id) or excavator (building id) */
    poseOnScreen: (kind: 'rover' | 'digger', id: number) => game.debugPoseOnScreen(kind, id),
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
    /** where the Builder would put one of `type` now (a dry run) */
    planSite: (type: BuildingId, intent?: { res?: ResourceId; like?: number; edge?: boolean }) => clone(game.debugPlanSite(type, intent)),
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
        return {
          id: b.id, type: b.type, door, cell, served: served.has(b.id), spur: [...(b.spur ?? [])],
          doorOpen: !!door && (map.get(door[1] * 256 + door[0])?.left ?? 1) <= 0,
          linked: !!(from && cell && roadRoute(s, from, cell)),
        };
      });
    },
    /** the save as written, and a load of one (the migration tests) */
    saveBlob: () => clone((game as unknown as { saveBlob(): unknown }).saveBlob()),
    loadBlob: (blob: Parameters<Game['loadFrom']>[0]) => game.loadFrom(blob),
    /** the road tool's actions: a road from an open road cell to a cell; remove cells */
    layRoad: (from: [number, number], to: [number, number]) => game.actions.push({ kind: 'layRoad', from, to }),
    removeRoad: (cells: [number, number][]) => game.actions.push({ kind: 'removeRoad', cells }),
  };
}

export function attachDebug(game: Game) {
  window.__game = api(game);
}
