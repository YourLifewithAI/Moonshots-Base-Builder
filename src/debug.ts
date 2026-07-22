/** Test/debug API — the testability keystone. Enabled with ?debug.
 *  Playwright drives the whole game loop through window.__game. */
import type { Game } from './core/game';
import type { BuildingId } from './data/buildings';
import type { TechId } from './data/techs';
import type { SiteId } from './data/sites';
import type { ResourceId } from './data/resources';

declare global {
  interface Window { __game?: ReturnType<typeof api> }
}

function api(game: Game) {
  return {
    getState: () => JSON.parse(JSON.stringify(game.state ?? null)),
    selectSite: (site: SiteId) => game.startNew(site),
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
    completeTech: (id: TechId) => game.debugCompleteTech(id),
    research: (id: TechId) => game.actions.push({ kind: 'research', tech: id }),
    launch: () => game.actions.push({ kind: 'launch' }),
    setSpeed: (n: number) => game.actions.push({ kind: 'setSpeed', speed: n }),
    setPaused: (p: boolean) => game.actions.push({ kind: 'setPaused', paused: p }),
    advanceGameMinutes: (min: number) => game.debugAdvance(Math.round(min * 60)),
    advanceGameSeconds: (s: number) => game.debugAdvance(Math.round(s)),
    setMode: (m: 'build' | 'walk') => game.setModeInstant(m),
    getPlayer: () => ({
      x: game.walkController.pos.x, y: game.walkController.pos.y, z: game.walkController.pos.z,
      yaw: game.walkController.yaw,
    }),
    save: () => game.doSave(),
    surveyIce: () => game.actions.push({ kind: 'surveyIce' }),
    getIceDeposits: () => JSON.parse(JSON.stringify(game.iceDepositList)),
    canPlace: (type: BuildingId, gx: number, gz: number) => game.debugCheckPlace(type, gx, gz),
    forceRenderFallback: () => (game as any).post.forceFallback('debug'),
    enableSafeMode: () => game.enableSafeMode(),
    getFxLevel: () => (game as any).post.fxLevel as number,
    setFxLevel: (n: number) => (game as any).post.setLevel(n),
    degradeFx: () => (game as any).post.degrade('debug'),
  };
}

export function attachDebug(game: Game) {
  window.__game = api(game);
}
