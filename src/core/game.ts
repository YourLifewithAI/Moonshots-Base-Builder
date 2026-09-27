/** The orchestrator: owns GameState, the Three.js world, input, the render/sim
 *  loops, action handling, store publishing, and save/load. */
import * as THREE from 'three';
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { SITES, type SiteId } from '../data/sites';
import { TECHS, type TechId } from '../data/techs';
import { MILESTONES, milestoneHint } from '../data/milestones';
import { RESOURCES, type ResourceId } from '../data/resources';
import {
  ALERTS, AUTOSAVE_S, CREW, CYCLE_S, DEPOSIT_FX, DOWNLINK, EYE_HEIGHT, GRADE_CELLS, GRADE_COST_ENERGY,
  GRADE_REGOLITH_YIELD, LAUNCH_CAP_PER_VOLLEY, LAUNCH_COST_FOILS, LAUNCH_POWER_BURST, OVERCLOCK, RESUPPLY,
  SPEEDS, SWARM_PCT_PER_LAUNCH,
} from '../data/balance';
import { DEPOSIT_INFO, type DepositKind } from '../data/deposits';
import { TIER_VIEW, type MapView, type ProspectId } from '../data/lunarMap';
import { createInitialState, type AlertMsg, type BuildingState, type GameState } from './state';
import { OVERCLOCKABLE, canToggleCrew, crewToggleRule, effectiveDef, effectiveRates } from './mods';
import { ActionQueue, type Action } from './actions';
import {
  boardingShortfall, downlinkCost, economyTick, currentDay, refreshDerived, alert, computeMods, landerAction,
  missionLost, orderDelayS, queuePos, settlersWelcome, type Mods,
  launchVolley, volleyTerms,
} from './economy';
import { modsFor } from './mods';
import {
  automationView, budgetShort, crewPlan, freezeRules, newOrder, onPlayerDemolish, orderRefusal, recordPlaced,
  recordRefused, ruleState, logAuto, type AutoRequest, type SiteIntent,
} from './automation';
import { chooseSite, feedPlan } from './siting';
import { recordSpend } from './flowBook';
import { AUTO, RULES } from '../data/automation';
import {
  cancel, enqueue, enqueuePath, migrateTechSchema, moveInQueue, onTechComplete, researchView,
  destinyOf,
} from './research';
import { fmtClock } from './daynight';
import {
  abandonOutpost, claimOutpost, depositRevealed, depositsView, forceOutposts, groundMapped, lunarView, revealDeposits,
  revealRadiusM, startSurvey, strikeEffect, type LunarUi,
} from './exploration';
import { crewParts, fleetRefresh, releaseRover, sendRover, summonRover, unpinRover } from './fleet';
import { TRANSIT, freeReach, siteTransit, transitPlan } from './transit';
import { digAtHome, digRefusal, setDigSite } from './haul';
import { accessCell, bumpRoads, cellAt, dropSpur, hasRoads, joinCell, keyCell, layApron, laySpur, migrateRoads, planLink, planSpur } from './roads';
import { zonesFrom } from './zones';
import {
  assignPit, autoUnit, bindHeights, cancelJob, choicesFor, dispatchUnit, facePoint, hopperRoom, migrateHubs, newHubState, openPit,
  hubGhostLine, plainZones, queueJob, recallUnit, sendUnit, stakeHubPit,
} from './hubs';
import { UNIT_VID, isHubType } from '../data/hubs';
import { ROAD } from '../data/roads';
import { bindTerrain, digSiteKey, onDig, pitsView, restoreTerrain, saveTerrain, syncPitZones } from './pits';
import { encodeDelta, takeCarved } from '../terrain/pitCarve';
import { roadAction } from './roadActions';
import { fleetView, groundName } from './fleetView';
import { applyCounter, forceHazard, hazardView, setAirGap } from './hazards';
import {
  allWrecks, arrayView, clearWreck, confirmChoice, migrateFlareSchema, previewChoice, queueRepairs, rebuildWreck, setFieldOverride,
  setRemembered, shownClass, startFlare, weatherView, type ChoicePreview,
} from './spaceWeather';
import { applyFlareCounter, commsDark, isFlareCounter } from './flareEffects';
import type { ArrayChoice, FlareClass } from '../data/spaceWeather';
import { aheadClass, launchSentinel, setAhead, withForecast } from './forecast';
import { HAZARDS, HAZARD_NAME, type HazardId, type Tier } from '../data/hazards';
import { FleetTarget, type Mode as FleetMode } from '../player/fleetTarget';
import { RoadTool } from '../player/roadTool';
import { Heightfield, type Deposit } from '../terrain/heightfield';
import { TerrainChunks } from '../terrain/chunks';
import { Horizon } from '../terrain/horizon';
import { Rocks } from '../terrain/rocks';
import { BuildingInstances, centerOf, footprintRect } from '../buildings/instances';
import { BuildingDarkness } from '../buildings/darkness';
import {
  PlacementController, buildCost, checkGrade, checkPlacement, demolishRefund, gradeCost, untouchedSite, type PlaceableType,
} from '../buildings/placement';
import { BUILDING_MATERIAL } from '../buildings/meshKit';
import { BaseOverlays } from '../buildings/overlays';
import { createRenderer, createCamera } from '../world/renderer';
import { Lighting, sunStep } from '../world/lighting';
import { ClassicLighting } from '../world/classicLighting';
import { installClassic } from '../world/classic';
import { CLASSIC_MARKER, classicFallbackMaterial } from '../buildings/classicBuilding';
import { Sky } from '../world/sky';
import { FX_PLAIN, PostFX } from '../world/post';
import { FxSelfCheck, type FxCheckResult } from '../world/fxcheck';
import { REPORT_EXTENSIONS, diagnosticTargets } from '../world/fxcaps';
import { applyFxBreak, fxBreak, sanitizeUniform, setFxBreak, setHardening, type FxBreak } from '../world/fxguard';
import { copyText, gpuStrings, installRenderLog, logRender, pollGlErrors, renderLog } from '../world/renderReport';
import { BaseLife } from '../world/life';
import { leanFrom } from '../buildings/look';
import { materials, PATCH_MARKER } from '../world/materials';
import { BuildCam, HOME_DIST, commandKey, type CommandCam } from '../player/buildCam';
import { ISO_FOV, IsoCam } from '../player/isoCam';
import { WalkController } from '../player/walk';
import { ModeManager } from '../player/modes';
import { TouchControls, type TouchHost } from '../player/touch';
import { saveGame, loadGame, clearSave, type SaveBlob } from './save';
import { loadSettings, saveSettings, type RenderStyle } from './settings';
import { autoTouch, type TouchChoice } from './touch';
import { RESUME_KEY, setActiveStyle } from './style';
import { sfx } from '../audio/sfx';
import {
  $alerts, $autoMarkers, $automation, $caps, $counts, $defeat, $depositMarkers, $depositOverlay, $deposits, $depositSel, $feed, $hasSave, $ice,
  $iceOverlay, $lookAt, $lander, $lostMission, $lunar, $menuOpen, $milestones, $mode, $phase, $placeFlash,
  $placing, $power, $rates, $resourcePanel, $resources, $research, $selection, $siteId, $swarm, $tech,
  $time, $victory, $vitals, $wearMarkers, overlayUp, spawnFloater, $announce, type Announcement,
  $fleet, $fleetTarget, $roverSel, $unitSel,
  $destiny, $hazards, $hazardMarkers, $lossStory, $weather,
} from '../ui/stores';

export interface GameOptions {
  nolock: boolean;
  lowfx: boolean;
  safe: boolean;
  /** the safe mode at boot came from the render check, not the player */
  safeAuto?: boolean;
  fx?: number;      // explicit FX-ladder level override (?fx=0..3)
  /** the player's own FX level from the menu: boot never renders above it */
  fxChoice?: number;
  seed: number;
  /** how the world is drawn this session (fixed at boot: a change reloads) */
  style: RenderStyle;
  /** touch mode (core/touch.ts): gestures on the world, saves on every hide */
  touch?: boolean;
}

/** What the menu shows about the render path. */
export interface RenderStatus {
  /** the level being drawn (plain in safe mode) */
  level: number;
  /** the ladder's level: what leaving safe mode returns to */
  ladder: number;
  /** levels that failed a render check on this GPU (black frame, shader
   *  error, throwing pass, a failed raise) — kept across sessions */
  failed: number[];
  /** why the ladder last stepped down ('' = it has not, this session) */
  reason: string;
  /** a raise (or leaving safe mode) waits for its black-frame check */
  checking: boolean;
  safe: boolean;
  /** safe mode came from the black-frame check, not the player */
  safeAuto: boolean;
  /** ?lowfx holds the ladder at 2 or below */
  floor: number;
}

/** game-seconds of bank runway below which the hum starts to sag */
const GRID_RUNWAY_S = 180;

/** keys that toggle or jump: a held key fires them once, not at the OS
 *  repeat rate (camera keys keep repeating) */
const TOGGLE_KEYS = new Set([
  'Space', 'KeyT', 'KeyM', 'KeyI', 'Tab', 'Escape', 'Digit1', 'Digit2', 'Digit3', 'KeyF', 'KeyH', 'Home',
]);

export class Game {
  state!: GameState;
  mods!: Mods;
  readonly actions = new ActionQueue();
  /** set while the menu holds the sim paused: saves record this paused
   *  state (the game as the player left it), not the menu's pause */
  savePausedAs: boolean | null = null;

  private renderer: THREE.WebGLRenderer;
  /** the classic render style (no post chain, no shadows, the iso camera) */
  readonly classic: boolean;
  private camera: THREE.PerspectiveCamera;
  private scene = new THREE.Scene();
  private lighting: Lighting | ClassicLighting;
  private sky: Sky;
  private post: PostFX;
  private hf!: Heightfield;
  private chunks!: TerrainChunks;
  private horizon!: Horizon;
  private rocks!: Rocks;
  private instances!: BuildingInstances;
  /** how dark each structure stands, for its own lights (visual only,
   *  renderer-independent: `darkness.of(id)`) */
  darkness!: BuildingDarkness;
  private placement!: PlacementController;
  private overlays!: BaseOverlays;
  private life!: BaseLife;
  /** the command view: the free camera (High detail) or the isometric one (classic) */
  private buildCam: CommandCam;
  private walk!: WalkController;
  private modes!: ModeManager;
  /** Send to… / Dig at… (player/fleetTarget.ts) */
  private fleetTarget!: FleetTarget;
  /** the road tool (player/roadTool.ts) */
  private roadTool!: RoadTool;
  /** debug: a placement's road is laid open (tests that time builds, not roads) */
  debugOpenRoads = false;
  /** touch mode's gesture recognizer (player/touch.ts); null on desktop */
  private touchCtl: TouchControls | null = null;
  /** touch: the road tool's Remove toggle (Alt-drag on desktop) */
  roadRemove = false;

  private playing = false;
  private econAcc = 0;
  private autosaveAcc = 0;
  private lookAcc = 0;
  private lookId: number | null = null;   // the building under the walk-mode reticle
  private mouse = new THREE.Vector2();      // NDC
  private mousePx = { x: 0, y: 0 };
  private downPos = { x: 0, y: 0 };
  private raycaster = new THREE.Raycaster();
  private lastT = performance.now();
  private worldGroup: THREE.Group | null = null;
  /** revealed deposits' rings ([I]); rebuilt when the revealed set changes */
  private depositOverlay: THREE.Group | null = null;
  private revealedIds = new Set<string>();
  private markerSig = '';
  /** Lunar Map screen bookkeeping (the view shown, the tier last seen) */
  private lunarUi: LunarUi = { open: false, view: 'site', seenTier: 0 };
  /** the Space Weather panel's 'Arrays: choose now…' card is open (docs/16 §10.2): its previews are built only then */
  private forecastUi: { ahead: boolean } = { ahead: false };
  /** what the last Builder place action did: the building, or why it refused */
  private lastPlace: BuildingState | string | null = null;

  constructor(private canvas: HTMLCanvasElement, readonly opts: GameOptions) {
    // the style reaches every mesh creator and the material registry before
    // the first mesh exists
    this.classic = opts.style === 'classic';
    setActiveStyle(opts.style);
    materials.setClassic(this.classic);
    installRenderLog();
    this.renderer = createRenderer(canvas, this.classic);
    this.watchRenderTargets();
    if (this.classic) installClassic();
    this.camera = createCamera();
    this.lighting = this.classic ? new ClassicLighting(this.scene) : new Lighting(this.scene);
    this.sky = new Sky(this.scene);
    this.lighting.attachHeadlamp(this.scene, this.camera);
    this.post = new PostFX(this.renderer, this.scene, this.camera, {
      lowFx: opts.lowfx, fxOverride: opts.fx, fxChoice: opts.fxChoice, safe: opts.safe, classic: this.classic,
    });
    this.post.onIssue = (msg) => {
      logRender('alert', msg);
      if (this.state) { alert(this.state, msg, 'warn'); this.publish(); }
    };
    // the capability floor held the boot below the stored/chosen level: the
    // menu says why (the level itself never failed, so it is not remembered)
    if (this.post.capHeld !== null && this.post.caps) this.fxReason = this.post.caps.floorReason;
    if (!this.classic) this.fxCheck = new FxSelfCheck(this.renderer, this.scene, this.camera, this.post.caps?.halfFloat.ok ?? false);
    // the self-check's own two renders are not the frame's
    this.scene.onBeforeRender = () => { if (!this.inFxCheck) this.sceneRenders++; };
    // scene shader patches ride the same ladder as the post chain (safe mode
    // draws unlit twins, so the ladder level stays theirs to return to)
    if (opts.fx !== undefined) materials.clearFault();
    materials.setFxLevel(this.post.ladderLevel);
    this.post.onLevelChange = (level, cause, reason, failed = []) => {
      if (cause === 'choice') materials.clearFault();
      if (failed.length) {
        for (const l of failed) this.fxFailed.add(l);
        this.fxReason = reason ?? 'render error';
        this.saveFailed();
      }
      materials.setFxLevel(level);
      if (!this.classic) this.rocks?.setFxLevel(level);
      logRender('fx', `FX ${level} (${cause}${reason ? `: ${reason}` : ''})`);
      // a raise is checked on the next frames that can tell; a new rung soon
      this.reprobe(this.post.onTrial ? 2 : 40);
      // …and the self-check compares the new level's frame with the plain path
      this.scheduleFxCheck();
    };
    // a program that fails to compile is reported here (replacing three's
    // console dump); the response waits until the frame has finished
    this.renderer.debug.onShaderError = (gl, program, vs, fs) => {
      const log = (s: WebGLShader) => gl.getShaderInfoLog(s)?.trim() ?? '';
      // (the console mirror files this in the render log too)
      console.error(`THREE.WebGLProgram: Shader Error — ${gl.getProgramInfoLog(program)?.trim() ?? ''}\n` +
        `vertex: ${log(vs)}\nfragment: ${log(fs)}`);
      const src = (m: string) => [vs, fs].some((s) => gl.getShaderSource(s)?.includes(m));
      if (src(CLASSIC_MARKER)) this.shaderFault = 'classic';
      else if (this.shaderFault !== 'patch' && this.shaderFault !== 'classic') {
        this.shaderFault = src(PATCH_MARKER) ? 'patch' : 'other';
      }
    };
    // context loss (driver reset / tab memory pressure) looks like a permanent
    // black screen with a working HUD — tell the player what happened
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('[MOONSHOTS] WebGL context lost.');
      if (this.state) { alert(this.state, 'GPU CONTEXT LOST — reload the page to restore visuals', 'crit'); this.publish(); }
    });
    canvas.addEventListener('webglcontextrestored', () => {
      console.warn('[MOONSHOTS] WebGL context restored.');
    });
    this.buildCam = this.classic ? new IsoCam(this.camera, canvas) : new BuildCam(this.camera, canvas);
    this.buildCam.enabled = false;
    this.bindInput();
    if (opts.touch) this.bindTouch();
    window.addEventListener('resize', () => this.onResize());
    $depositOverlay.subscribe((v) => { if (this.depositOverlay) this.depositOverlay.visible = v; });
    // safe mode (the player's, or the render check's from an earlier launch)
    // holds from the very first frame
    if (opts.safe) this.enableSafeMode(opts.safeAuto ?? false, false);
    requestAnimationFrame((t) => this.frame(t));
    void loadGame().then((blob) => this.publishSaveSlot(blob));
  }

  // ─────────────────────────── lifecycle ───────────────────────────

  startNew(siteId: SiteId, expedition: 'human' | 'robotic' = 'human') {
    const state = createInitialState(siteId, this.opts.seed, expedition);
    this.bootWorld(state);
    // pre-place the Lander at the map heart and pad the ground under it
    const gx = 126, gz = 126;
    this.commitPlace('lander', gx, gz, 0, true);
    fleetRefresh(this.state, this.mods); // the Lander's rovers, before the first tick
    transitPlan(this.state, this.mods, false); // parked in its bays
    this.syncDeposits(false);
    this.homeCamera(false);
    this.introPending = true;
    this.publish();
    alert(this.state, 'TOUCHDOWN — begin with a Solar Array', 'info');
  }

  loadFrom(blob: SaveBlob) {
    // migrate pre-bank saves: scalar researchProgress → per-tech researchSpent
    const legacy = blob.state as GameState & { researchProgress?: number };
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
    for (const a of legacy.alerts) {
      if (a.key !== undefined) continue;
      a.key = a.text;
      a.count = 1;
      if (a.kind === 'crit') a.kind = 'warn';
    }
    // saves from the 34-tech tree: retired ids refunded, the queue sanitized
    migrateTechSchema(blob.state);
    // saves from before classed flares (docs/16 §14.3, flareSchema 0 → 1)
    migrateFlareSchema(blob.state);
    this.bootWorld(blob.state);
    // the pits' height deltas onto the regenerated surface, then the flattens
    // replay over them, in order (base → deltas → flattens, docs/17 §11.1)
    const carved = restoreTerrain(this.state, this.hf);
    for (const f of this.state.flattens) {
      this.hf.flatten(f.x0, f.z0, f.x1, f.z1, f.h);
      this.onFlattened(f.x0, f.z0, f.x1, f.z1);
    }
    // migration rule 7: a Lander ice survey mapped every ice deposit; every
    // building's deposit comes from the regenerated heightfield
    const struck = this.state.survey.struck;
    if (this.state.iceSurveyed) for (const d of this.hf.iceDeposits) if (!struck.includes(d.id)) struck.push(d.id);
    for (const b of this.state.buildings) this.stampDeposit(b);
    migrateRoads(this.state, this.hf); // a save from before roads gets them now
    this.syncDeposits(false);
    // a save from before extraction hubs (docs/17 §19): excavators join their hubs
    migrateHubs(this.state, this.mods, SITES[this.state.siteId]);
    // the pits' zones come back from the grid (the save leaves them out)
    syncPitZones(this.state, this.hf, undefined, false);
    if (this.state.flattens.length || carved) this.chunks.rebuildAround(0, 0, 255, 255);
    this.chunks.clearQueue();
    if (carved) { this.rocks.clearPits(0, 0, 255, 255); this.walk.boulders = this.rocks.colliders(); }
    this.hf.carved.length = 0;
    this.instances.rebuild(this.state);
    this.homeCamera(false);
    this.walk.colliders = this.instances.colliders(this.state);
    // touch mode has no walk mode: a desktop save made on foot loads in the command view
    if (blob.player.mode === 'walk' && !this.opts.touch) {
      this.walk.pos.set(blob.player.x, blob.player.y, blob.player.z);
      this.walk.yaw = blob.player.yaw;
      this.walk.pitch = blob.player.pitch;
      this.modes.set('walk');
    }
    this.publish();
    if (missionLost(this.state)) $defeat.set(true);
  }

  private bootWorld(state: GameState) {
    this.state = state;
    $unitSel.set(null);
    this.alertClock.clear();
    this.mods = refreshDerived(state);
    if (this.worldGroup) this.scene.remove(this.worldGroup);
    this.hf = new Heightfield(SITES[state.siteId], state.seed);
    // the sim plans hub units' haul roads and stakes plain pits on it (core/hubs.ts)
    bindHeights(state, this.hf);
    bindTerrain(state, this.hf); // the pits carve this ground (core/pits.ts, economy step 4.2)
    this.chunks = new TerrainChunks(this.hf);
    this.horizon = new Horizon(this.hf);
    this.rocks = new Rocks(this.hf);
    // classic draws half the small rocks (the FX 2 density), whatever the ladder
    this.rocks.setFxLevel(this.classic ? 2 : this.post.ladderLevel);
    this.darkness = new BuildingDarkness(this.hf);
    this.instances = new BuildingInstances(this.hf, this.darkness);
    this.chunks.onShadowCastersChanged = this.instances.onShadowCastersChanged =
      this.rocks.onShadowCastersChanged = () => this.lighting.requestShadowUpdate();
    this.lighting.requestShadowUpdate();
    this.lighting.groundAlbedo = SITES[state.siteId].terrain.albedo;
    if (this.lighting instanceof ClassicLighting) this.lighting.setSite(SITES[state.siteId]);
    this.placement = new PlacementController(this.scene, this.hf, SITES[state.siteId]);
    this.overlays = new BaseOverlays(this.hf);
    this.life = new BaseLife(this.hf, () => this.lighting.requestShadowUpdate());
    this.instances.panelDust = (b) => this.life.panelDust(b);
    // an excavator away from its pad is drawn by the haulers, not the pad instance
    this.life.haulers.onAway = (ids) => this.instances.setHidden(ids);
    this.life.haulers.darkOf = (id) => this.instances.darkness.of(id);
    // ?lowfx: the work animations keep their motion and glow, drop their particles
    this.life.work.lowFx = this.opts.lowfx;
    // the hazards' look (docs/14 §3): flicker, dark, tints on the instances; plumes in the dust
    const hazardFx = (id: number) => $hazards.get()?.fx?.[id];
    this.instances.fxOf = hazardFx;
    this.life.fxOf = hazardFx;
    this.fleetTarget?.cancel();
    this.fleetTarget = new FleetTarget({
      state: () => this.state, mods: () => this.mods, hf: this.hf,
      ray: () => { this.raycaster.setFromCamera(this.mouse, this.camera); return this.raycaster.ray; },
      pickBuilding: () => { this.raycaster.setFromCamera(this.mouse, this.camera); return this.instances.pick(this.raycaster); },
      push: (a) => this.actions.push(a),
    });
    this.roadTool?.cancel();
    this.roadTool = new RoadTool({
      state: () => this.state, hf: this.hf,
      ray: () => { this.raycaster.setFromCamera(this.mouse, this.camera); return this.raycaster.ray; },
      push: (a) => this.actions.push(a),
      holdCamera: (on) => { this.buildCam.enabled = !on && this.modes?.mode === 'build'; },
    }, this.scene);
    $roverSel.set(null);
    this.walk = new WalkController(this.hf);
    this.walk.boulders = this.rocks.colliders();
    this.modes = new ModeManager(this.camera, this.buildCam, this.walk, (m) => {
      $mode.set(m);
      this.buildCam.clearKeys();
      if (m === 'walk' && !this.opts.nolock) this.canvas.requestPointerLock();
      if (m === 'build' && document.pointerLockElement) document.exitPointerLock();
    }, this.classic ? { fov: ISO_FOV, near: 20, far: 5000 } : undefined);
    this.worldGroup = new THREE.Group();
    this.worldGroup.add(this.chunks.group, this.horizon.mesh, this.rocks.group, this.instances.group,
      this.overlays.group, this.life.group, this.fleetTarget.group);
    for (const c of this.depositOverlay?.children ?? []) (c as THREE.LineSegments).geometry.dispose();
    this.depositOverlay = null;
    this.revealedIds = new Set();
    this.markerSig = '';
    this.lunarUi = { open: false, view: 'site', seenTier: this.mods.surveyTier };
    // constrained sites show their buildable boundary as a faint ring
    const site = SITES[state.siteId];
    if (site.buildableRadiusM > 0) {
      const pts: number[] = [];
      const segs = 96;
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const x = Math.cos(a) * site.buildableRadiusM;
        const z = Math.sin(a) * site.buildableRadiusM;
        pts.push(x, this.hf.sample(x, z) + 0.6, z);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
      const ring = new THREE.Line(g, new THREE.LineBasicMaterial({
        color: 0xf5f7f9, transparent: true, opacity: 0.22,
      }));
      this.worldGroup.add(ring);
    }
    this.scene.add(this.worldGroup);
    this.sky.setSite(site);
    this.buildCam.groundAt = this.groundAnywhere;
    this.buildCam.enabled = true;
    this.playing = true;
    this.playFrames = 0; // sentinel probes count from gameplay start
    this.nextProbe = 40;
    this.scheduleFxCheck(30);
    if (this.safeMode) {
      this.safeMode = false; // fresh world = fresh materials; re-apply
      this.enableSafeMode(this.safeAuto, false);
    }
    this.cueSeen = null;
    this.announceSeen = null;
    this.announceDrilled = null;
    this.hazardSeen = null;
    $announce.set([]);
    $phase.set('playing');
    $siteId.set(state.siteId);
    $victory.set(false);
    $defeat.set(false);
  }

  // ─────────────────────────── input ───────────────────────────

  private bindInput() {
    window.addEventListener('mousemove', (e) => {
      // touch mode: a tap's compatibility mousemove must not drag the ghost to the button tapped
      if (this.touchCtl?.compatMouse()) return;
      this.mousePx = { x: e.clientX, y: e.clientY };
      this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      if (document.pointerLockElement === this.canvas && this.modes?.mode === 'walk') {
        this.walk.look(e.movementX, e.movementY);
      }
    });
    this.canvas.addEventListener('mousedown', (e) => {
      this.downPos = { x: e.clientX, y: e.clientY };
      if (e.button === 0 && this.roadTool?.active && this.modes.mode === 'build') this.roadTool.down(e.altKey);
    });
    this.canvas.addEventListener('mouseup', (e) => {
      if (!this.playing || this.modes.mode !== 'build' || this.modes.transitioning) return;
      // the road tool takes the left button's drags and clicks
      if (this.roadTool?.active) {
        if (e.button === 0) this.roadTool.up();
        if (e.button === 2 && Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y) <= 5) this.roadTool.cancel();
        return;
      }
      const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
      if (moved > 5) return; // drag = camera, not click
      if (e.button === 0) this.onWorldClick(e.shiftKey);
      if (e.button === 2 && this.placement.active) this.cancelPlacement();
      if (e.button === 2 && this.fleetTarget.active) this.fleetTarget.cancel();
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('click', () => {
      if (this.playing && this.modes.mode === 'walk' && !this.opts.nolock &&
          document.pointerLockElement !== this.canvas) {
        this.canvas.requestPointerLock();
      }
    });
    window.addEventListener('keydown', (e) => {
      if (!this.playing) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      // a victory or defeat overlay owns the screen: nothing moves under it
      if (overlayUp()) return;
      if (e.repeat && TOGGLE_KEYS.has(e.code)) {
        // no focus walk, no page scroll, no button press from the repeats either
        if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
        return;
      }
      switch (e.code) {
        case 'Tab':
          e.preventDefault();
          // touch mode has no walk mode, even with a keyboard attached (docs/07 §13.9)
          if (this.opts.touch) break;
          this.cancelPlacement();
          this.modes.toggle();
          break;
        case 'Space':
          // Space never presses a focused HUD button: it pauses, or it jumps
          e.preventDefault();
          if (this.modes.mode === 'build') {
            this.actions.push({ kind: 'setPaused', paused: !this.state.paused });
          } else {
            this.walk.keyDown(e.code);
          }
          break;
        case 'Digit1': this.actions.push({ kind: 'setSpeed', speed: SPEEDS[0] }); break;
        case 'Digit2': this.actions.push({ kind: 'setSpeed', speed: SPEEDS[1] }); break;
        case 'Digit3': this.actions.push({ kind: 'setSpeed', speed: SPEEDS[2] }); break;
        case 'KeyR': if (this.placement.active) this.placement.rotate(); break;
        case 'KeyN': if (this.modes.mode === 'build') { if (this.roadTool.active) this.roadTool.cancel(); else this.beginRoadTool(); } break;
        case 'KeyI': $depositOverlay.set(!$depositOverlay.get()); break;
        case 'KeyB':
          // the Builder: orders and standing rules (one panel at a time, like the resource panels)
          if (this.modes.mode === 'build') $resourcePanel.set($resourcePanel.get() === 'builder' ? null : 'builder');
          break;
        case 'KeyG':
          // the Hazards panel (docs/14 §3.8): risks, counters, the network
          if (this.modes.mode === 'build') $resourcePanel.set($resourcePanel.get() === 'hazards' ? null : 'hazards');
          break;
        case 'Enter': case 'NumpadEnter':
          // while placing: let the rovers choose the site for this one
          if (this.placement.active && this.placement.probe && this.placement.probe.type !== 'grade') {
            e.preventDefault();
            this.actions.push({ kind: 'order', type: this.placement.probe.type, count: 1 });
            if (!e.shiftKey) this.cancelPlacement();
          }
          break;
        case 'KeyE':
          // on foot: inspect what the reticle rests on (back to command view,
          // selected); in command view E orbits with Q
          if (this.modes.mode === 'walk') {
            if (this.lookId !== null && !this.modes.transitioning) {
              const id = this.lookId;
              this.modes.toggle();
              this.select(id);
            }
          } else {
            e.preventDefault();
            this.buildCam.keyDown(e.code);
          }
          break;
        case 'Escape':
          // one thing at a time: placement, the inspector, a resource panel —
          // and with nothing left to cancel, the menu
          if (this.roadTool.active) this.roadTool.cancel();
          else if (this.fleetTarget.active) this.fleetTarget.cancel();
          else if (this.placement.active) this.cancelPlacement();
          else if ($selection.get()) $selection.set(null);
          else if ($roverSel.get() !== null) $roverSel.set(null);
          else if ($unitSel.get() !== null) $unitSel.set(null);
          else if ($depositSel.get()) $depositSel.set(null);
          else if ($announce.get()[0]?.kind === 'tech') $announce.set($announce.get().slice(1));
          else if ($resourcePanel.get()) $resourcePanel.set(null);
          else $menuOpen.set(true);
          break;
        case 'KeyF': {
          const sel = $selection.get();
          const rover = $roverSel.get();
          const unit = $unitSel.get();
          if (this.modes.mode !== 'build' || (!sel && rover === null && unit === null)) break;
          const at = sel ? this.life.haulers.pose(sel.id) : unit !== null ? this.life.haulers.pose(UNIT_VID + unit) : this.life.rovers.pose(rover!);
          const [x, z] = at ? [at.x, at.z] : sel ? centerOf(sel) : [0, 0];
          this.buildCam.focus(x, this.hf.sample(x, z), z, 60);
          break;
        }
        case 'KeyH':
        case 'Home':
          if (this.modes.mode === 'build') this.homeCamera(true);
          break;
        default:
          if (this.modes.mode === 'walk') this.walk.keyDown(e.code);
          else if (commandKey(e.code)) {
            e.preventDefault();
            this.buildCam.keyDown(e.code);
          }
      }
    });
    window.addEventListener('keyup', (e) => {
      this.walk?.keyUp(e.code);
      this.buildCam.keyUp(e.code);
    });
    window.addEventListener('blur', () => {
      this.walk?.clearKeys();
      this.buildCam.clearKeys();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.playing) void this.doSave(!!this.opts.touch);
    });
    // a victory or defeat overlay takes the screen: back to the command view
    // with the pointer free and nothing half-placed underneath
    const toCommandView = (up: boolean) => {
      if (!up || !this.playing || !this.modes) return;
      this.cancelPlacement();
      if (this.modes.mode !== 'build' || this.modes.transitioning) {
        this.modes.set('build'); // exits pointer lock (onModeChange)
        this.homeCamera(false);
      } else if (document.pointerLockElement) {
        document.exitPointerLock();
      }
    };
    $victory.subscribe(toCommandView);
    $defeat.subscribe(toCommandView);
  }

  /** `keep` (Shift held): stay in placing mode after this building */
  private onWorldClick(keep = false) {
    if (this.fleetTarget.active) { this.fleetTarget.click(); return; }
    if (this.placement.active) {
      const p = this.placement.probe!;
      if (!p.valid) {
        // say no out loud: the hint flashes its reason, the radio blips
        $placeFlash.set($placeFlash.get() + 1);
        sfx.play('invalid');
        return;
      }
      if (p.type !== 'grade' && !this.placement.confirmed()) {
        // a placement that would strand the base asks first: the hint says
        // why, and a second click builds it anyway
        $placeFlash.set($placeFlash.get() + 1);
        return;
      }
      if (p.type === 'grade') {
        // grading stays active: multiple passes are the point
        this.actions.push({ kind: 'grade', gx: p.gx, gz: p.gz });
      } else {
        this.actions.push({ kind: 'place', type: p.type, gx: p.gx, gz: p.gz, rot: p.rot });
        if (!keep) this.cancelPlacement();
      }
      return;
    }
    // selection: the nearest of a rover, a hauling excavator and a structure
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hit = this.pickWorld();
    if (hit?.rover !== undefined) { this.selectRover(hit.rover); return; }
    if (hit?.unit !== undefined) { this.selectUnit(hit.unit); return; }
    const b = hit?.building !== undefined ? this.state.buildings.find((x) => x.id === hit.building) ?? null : null;
    $roverSel.set(null);
    $unitSel.set(null);
    $selection.set(b ? { ...b } : null);
  }

  /** Under the ray: a rover (by instance, or within a few pixels on screen —
   *  they are small), a digger away from its pad, or a structure. */
  private pickWorld(): { rover?: number; building?: number; unit?: number } | null {
    const rover = this.life.rovers.pick(this.raycaster);
    const digger = this.life.haulers.pick(this.raycaster);
    const id = this.instances.pick(this.raycaster);
    const hits = this.raycaster.intersectObjects(this.instances.group.children, false);
    const bd = id !== null
      ? hits.find((h) => h.instanceId !== undefined && h.object.userData.buildingType)?.distance ?? 0 : Infinity;
    type Hit = { d: number; v: { rover?: number; building?: number; unit?: number } };
    const cands: Hit[] = [];
    if (rover) cands.push({ d: rover.d - 0.5, v: { rover: rover.id } });
    // a hub unit is drawn under its own key (UNIT_VID + id); a legacy pad's under its building's
    if (digger) cands.push({ d: digger.d, v: digger.id >= UNIT_VID ? { unit: digger.id - UNIT_VID } : { building: digger.id } });
    if (id !== null) cands.push({ d: bd, v: { building: id } });
    const best = cands.sort((x, y) => x.d - y.d)[0];
    if (best?.v.rover !== undefined) return best.v;
    // a rover within 14 px of the click beats open ground (never a structure hit)
    if (!best) {
      let near: number | null = null, nd = 14;
      for (const p of this.life.rovers.poses()) {
        const at = this.screenOf(p.x, p.y, p.z);
        const d = Math.hypot(at.x - this.mousePx.x, at.y - this.mousePx.y);
        if (at.visible && d < nd) { nd = d; near = p.id; }
      }
      if (near !== null) return { rover: near };
    }
    return best?.v ?? null;
  }

  /** open the rover inspector (null closes it); a building selection closes */
  selectRover(id: number | null) {
    if (id !== null && !this.state.rovers.some((r) => r.id === id)) id = null;
    if (id !== null) { $selection.set(null); $unitSel.set(null); }
    $roverSel.set(id);
  }

  /** open a hub unit's inspector (null closes it); a building or rover selection closes */
  selectUnit(id: number | null) {
    if (id !== null && !this.state.haulers.some((u) => u.id === id)) id = null;
    if (id !== null) { $selection.set(null); $roverSel.set(null); }
    $unitSel.set(id);
  }

  /** Send to… (a rover) or Dig at… (an excavator): the next click picks the target. */
  beginFleetTarget(mode: FleetMode) {
    if (this.modes.mode !== 'build') return;
    this.cancelPlacement();
    this.roadTool.cancel();
    this.fleetTarget.begin(mode);
  }

  cancelFleetTarget() { this.fleetTarget?.cancel(); }

  /** The road tool (N, the palette's ROAD button). */
  beginRoadTool() {
    if (this.modes.mode !== 'build') return;
    this.cancelPlacement();
    this.fleetTarget.cancel();
    $selection.set(null);
    this.roadTool.begin();
  }
  cancelRoadTool() { this.roadTool?.cancel(); }
  debugRoadTool() { return this.roadTool.info(); }

  beginPlacement(type: PlaceableType) {
    if (this.modes.mode !== 'build') return;
    if (type === 'grade' && !this.mods.grading) return;
    this.fleetTarget.cancel();
    this.roadTool.cancel();
    $selection.set(null);
    $roverSel.set(null);
    this.placement.begin(type, this.state.techsDone);
    // where you dig is a production decision: show the ground
    if (type === 'iceHarvester' || type === 'excavator') $depositOverlay.set(true);
    $placing.set({ type, valid: false, reason: '', warn: '', note: '' });
  }

  cancelPlacement() {
    this.placement?.cancel();
    $placing.set(null);
  }

  // ─────────────────────────── touch (docs/07 §13) ───────────────────────────

  /** Gestures on the world, and a save on every way the page can go away
   *  (iOS kills a background tab without warning). */
  private bindTouch() {
    const host: TouchHost = {
      ready: () => this.playing && this.commandView && !overlayUp() && !$menuOpen.get(),
      mode: () => (this.placement?.active ? 'place' : this.roadTool?.active ? 'road'
        : this.fleetTarget?.active ? 'target' : 'select'),
      tap: (x, y) => this.touchTap(x, y),
      longPress: (x, y) => this.touchLongPress(x, y),
      pan: (dx, dy) => this.buildCam.panPx(dx, dy, true),
      pinch: (phase, scale) => this.buildCam.pinch(phase, scale),
      twist: (rad) => this.buildCam.twist(rad),
      twistReset: () => this.buildCam.twistReset(),
      ghostDrag: (dx, dy) => this.pointAt(this.mousePx.x + dx, this.mousePx.y + dy),
      roadDown: (x, y) => { this.pointAt(x, y); this.roadTool.update(); this.roadTool.down(this.roadRemove); },
      roadMove: (x, y) => this.pointAt(x, y),
      roadUp: (x, y) => { this.pointAt(x, y); this.roadTool.update(); this.roadTool.up(); },
    };
    this.touchCtl = new TouchControls(this.canvas, host);
    window.addEventListener('pagehide', () => { if (this.playing) void this.doSave(true); });
  }

  /** The pointer the ghost, the road tool and picking read, at a screen
   *  point (CSS px; clamped to the viewport). */
  pointAt(x: number, y: number) {
    const w = window.innerWidth, h = window.innerHeight;
    x = Math.min(w - 1, Math.max(0, x));
    y = Math.min(h - 1, Math.max(0, y));
    this.mousePx = { x, y };
    this.mouse.set((x / w) * 2 - 1, -(y / h) * 2 + 1);
  }

  /** Where the pointer (the ghost, while placing) stands, CSS px. */
  get pointer() { return { ...this.mousePx }; }

  /** A tap on the world: a click, except that while placing it only moves
   *  the ghost there (✓ places). Empty ground clears every selection; with
   *  the deposit overlay on, a revealed deposit there opens its card. */
  private touchTap(x: number, y: number) {
    this.pointAt(x, y);
    if (this.roadTool.active) {
      this.roadTool.update();
      this.roadTool.down(this.roadRemove);
      this.roadTool.up();
      return;
    }
    if (this.placement.active) return;
    if (this.fleetTarget.active) { this.fleetTarget.update(); this.fleetTarget.click(); return; }
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hit = this.pickWorld();
    if (hit?.rover !== undefined) { this.selectRover(hit.rover); $depositSel.set(null); return; }
    const b = hit?.building !== undefined ? this.state.buildings.find((x) => x.id === hit.building) ?? null : null;
    $roverSel.set(null);
    $selection.set(b ? { ...b } : null);
    const dep = b || !$depositOverlay.get() ? null : this.depositUnder();
    $depositSel.set(dep);
  }

  /** A long-press: what is this? A structure or a rover opens its inspector
   *  (the UI adds its info card); ground opens the card of a revealed
   *  deposit there. Returns what was found, for the UI. */
  private touchLongPress(x: number, y: number) {
    if (this.placement.active || this.roadTool.active || this.fleetTarget.active) return;
    this.pointAt(x, y);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hit = this.pickWorld();
    let info: { kind: 'building' | 'rover' | 'deposit' | 'ground'; type?: BuildingId; id?: string | number; x: number; y: number };
    if (hit?.rover !== undefined) {
      this.selectRover(hit.rover);
      info = { kind: 'rover', id: hit.rover, x, y };
    } else if (hit?.building !== undefined) {
      this.select(hit.building);
      const b = this.state.buildings.find((o) => o.id === hit.building);
      info = { kind: 'building', type: b?.type, id: hit.building, x, y };
    } else {
      const dep = this.depositUnder();
      if (dep) {
        $selection.set(null);
        $roverSel.set(null);
        $depositSel.set(dep);
        info = { kind: 'deposit', id: dep, x, y };
      } else {
        info = { kind: 'ground', x, y };
      }
    }
    window.dispatchEvent(new CustomEvent('moonshots:long-press', { detail: info }));
  }

  /** the revealed deposit under the pointer (its id), or null */
  private depositUnder(): string | null {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const { origin: o, direction: d } = this.raycaster.ray;
    const g = this.hf.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 3000);
    if (!g) return null;
    const dep = this.hf.depositAt(g[0], g[2]);
    return dep && depositRevealed(this.state, dep, this.mods.surveyTier) ? dep.id : null;
  }

  /** ✓ in the placement bar: place at the ghost, as a click would (a
   *  blocked spot flashes its reason; a stranding one asks twice). */
  confirmPlacement(keep = false) {
    if (this.placement?.active && this.commandView) this.onWorldClick(keep);
  }

  /** R, or ⟳ in the placement bar. */
  rotatePlacement() {
    if (this.placement?.active) this.placement.rotate();
  }

  /** Enter while placing, or Order in the placement bar: the rovers choose
   *  the site for this one. */
  orderPlacing(): boolean {
    const p = this.placement?.active ? this.placement.probe : null;
    if (!p || p.type === 'grade') return false;
    this.actions.push({ kind: 'order', type: p.type, count: 1 });
    this.cancelPlacement();
    return true;
  }

  /** ⟲ ⟳ (and Q/E's step in the isometric view): turn the command view. */
  turnView(dir: -1 | 1) {
    if (this.commandView) this.buildCam.turnStep(dir);
  }

  /** H: glide home to the Lander. F: glide to the selection. */
  cameraHome() {
    if (this.commandView) this.homeCamera(true);
  }
  focusSelection() {
    const sel = $selection.get();
    const rover = $roverSel.get();
    if (!this.commandView || (!sel && rover === null)) return;
    const at = sel ? this.life.haulers.pose(sel.id) : this.life.rovers.pose(rover!);
    const [x, z] = at ? [at.x, at.z] : sel ? centerOf(sel) : [0, 0];
    this.buildCam.focus(x, this.hf.sample(x, z), z, 60);
  }

  /** The recognizer's state and the pointer (tests, probes). */
  debugTouch() {
    const p = this.placement?.active ? this.placement.probe : null;
    return {
      on: !!this.touchCtl, ...(this.touchCtl?.info() ?? {}), pointer: this.pointer,
      roadRemove: this.roadRemove,
      placing: p ? { type: p.type, gx: p.gx, gz: p.gz, rot: p.rot, valid: p.valid, reason: p.reason } : null,
    };
  }

  /** Frame the Lander from the home direction (a glide unless `glide` is false). */
  /** Glide the command camera over a ground point (a deposit card's buttons). */
  focusGround(x: number, z: number) {
    if (this.modes.mode !== 'build') return;
    this.buildCam.focus(x, this.hf.sample(x, z), z, 70, true);
  }

  private homeCamera(glide: boolean) {
    const lander = this.state.buildings.find((b) => b.type === 'lander');
    const [x, z] = lander ? centerOf(lander) : [0, 0];
    const y = this.hf.sample(x, z);
    if (glide) this.buildCam.focus(x, y, z, HOME_DIST, true);
    else this.buildCam.home(x, y, z);
  }

  private overlayOwed = false;
  private overlayClock = 0;
  /** The pits changed the ground (docs/17 §11.6): the chunks they touched join
   *  the rebuild queue (one a frame, two a second, shadows every 2 s), rocks
   *  on the cut go, and the deposit rings re-drape at most once a second.
   *  Nothing is allocated on a frame without a carve. */
  private syncTerrain(dt: number) {
    this.takeTerrain();
    this.chunks.pump(dt);
    this.overlayClock += dt;
    if (this.overlayOwed && this.overlayClock >= 1) {
      this.overlayOwed = false;
      this.overlayClock = 0;
      if (this.depositOverlay) this.rebuildDepositOverlay();
    }
  }

  /** The boxes the pits carved since the last look: their chunks queued, their rocks cleared. */
  private takeTerrain() {
    if (!this.hf.carved.length) return;
    takeCarved(this.hf, (gx0, gz0, gx1, gz1) => {
      this.chunks.markDirty(gx0, gz0, gx1, gz1);
      this.rocks.clearPits(gx0, gz0, gx1, gz1);
    });
    this.walk.boulders = this.rocks.colliders();
    this.overlayOwed = true;
  }

  /** Cells [x0..x1) × [z0..z1) were flattened: clear the rocks off them and
   *  keep the horizon's shared edge in step with the grid. */
  private onFlattened(x0: number, z0: number, x1: number, z1: number) {
    this.rocks.clearRect(x0, z0, x1, z1);
    this.walk.boulders = this.rocks.colliders();
    this.horizon.onFlatten(x0, z0, x1, z1);
  }

  /** open the inspector on a building (null closes it) */
  select(id: number | null) {
    const b = id === null ? undefined : this.state.buildings.find((x) => x.id === id);
    if (b) { $roverSel.set(null); $unitSel.set(null); }
    $selection.set(b ? { ...b } : null);
  }

  // ─────────────────────────── actions ───────────────────────────

  private applyAction(a: Action) {
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
        const cost = buildCost(a.type, SITES[s.siteId]);
        const placed = this.commitPlace(a.type, a.gx, a.gz, a.rot, false, a.builder?.automated);
        if (a.builder) this.lastPlace = placed;
        sfx.play('place');
        // the price floats up from the pad it was paid for
        const [cx, cz] = centerOf(a);
        const at = this.screenOf(cx, this.hf.sample(cx, cz) + BUILDINGS[a.type].height * 0.6, cz);
        const text = Object.entries(cost).filter(([, n]) => (n ?? 0) > 0)
          .map(([rid, n]) => `−${n}${RESOURCES[rid as ResourceId].glyph}`).join(' ');
        if (at.visible && text) spawnFloater(text, at.x, at.y);
        break;
      }
      case 'demolish': {
        const b = s.buildings.find((x) => x.id === a.id);
        if (!b || b.type === 'lander') break;
        // the Builder takes the hint: a cancelled auto site vetoes that ground,
        // and a removed building is not rebuilt for a lunar day
        onPlayerDemolish(s, this.mods, b, untouchedSite(b));
        this.demolishBuilding(b.id);
        $selection.set(null);
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
        for (const id of o.placed) this.applyAction({ kind: 'buildNext', id });
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
      // hazards (core/hazards.ts, docs/14 §3.7): a counter works while paused, as placement does
      case 'counter': {
        // the flare's own counters (docs/16 §4): Recall machines, Checkpoint, Shut down exposed, Replace, Re-print
        const flare = isFlareCounter(a.counter);
        const r = flare ? applyFlareCounter(s, this.mods, SITES[s.siteId], a.counter as never, a.id) : applyCounter(s, this.mods, a.counter as never, a.id);
        if (!r.ok) alert(s, r.reason, 'warn');
        else if (flare && (a.counter === 'flareReplace' || a.counter === 'flareReplaceWorst')) this.instances.rebuild(s);
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
        else if (a.kind === 'wreck') this.instances.rebuild(s);
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
      case 'grade': {
        if (!this.mods.grading) break;
        const chk = checkGrade(s, this.hf, a.gx, a.gz);
        if (!chk.valid) { alert(s, `CANNOT GRADE — ${chk.reason}`, 'warn'); break; }
        s.powerStored -= gradeCost(this.hf, a.gx, a.gz);
        const h = this.hf.flatten(a.gx, a.gz, a.gx + GRADE_CELLS, a.gz + GRADE_CELLS);
        s.flattens.push({ x0: a.gx, z0: a.gz, x1: a.gx + GRADE_CELLS, z1: a.gz + GRADE_CELLS, h });
        this.chunks.rebuildAround(a.gx, a.gz, a.gx + GRADE_CELLS, a.gz + GRADE_CELLS);
        this.onFlattened(a.gx, a.gz, a.gx + GRADE_CELLS, a.gz + GRADE_CELLS);
        // dozed spoil, recovered: into the nearest smelter's or refinery's hopper with room, else the pile
        const [gcx, gcz] = [(a.gx + GRADE_CELLS / 2) * 4 - 512, (a.gz + GRADE_CELLS / 2) * 4 - 512];
        const hub = s.buildings.filter((b) => (b.type === 'smelter' || b.type === 'refinery') && b.hub && (b.construction ?? 0) <= 0 &&
          hopperRoom(b) >= GRADE_REGOLITH_YIELD)
          .sort((p, q) => Math.hypot(centerOf(p)[0] - gcx, centerOf(p)[1] - gcz) - Math.hypot(centerOf(q)[0] - gcx, centerOf(q)[1] - gcz))[0];
        if (hub) hub.hub!.hopper += GRADE_REGOLITH_YIELD;
        s.resources.regolith += GRADE_REGOLITH_YIELD;
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

  private commitPlace(
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
    this.chunks.rebuildAround(r.gx0, r.gz0, r.gx1, r.gz1);
    this.onFlattened(r.gx0, r.gz0, r.gx1, r.gz1);
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
        laySpur(s, this.hf, b, free || this.debugOpenRoads);
        s.zones = mapped;
        bumpRoads(s);
      } else laySpur(s, this.hf, b, free || this.debugOpenRoads);
    }
    if (isHubType(type) && !free) this.hubPlaced(b);
    this.instances.rebuild(s);
    this.walk.colliders = this.instances.colliders(s);
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
  private hubPlaced(b: BuildingState) {
    const s = this.state;
    const site = SITES[s.siteId];
    b.hub = newHubState();
    if (!choicesFor(s, this.mods, site, b, 1).some((c) => c.inReach && !c.target.plain)) stakeHubPit(s, this.mods, site, b);
    const best = choicesFor(s, this.mods, site, b, 1).find((c) => c.inReach);
    if (!best || best.trip.connected || !hasRoads(s)) return;
    const [fx, fz] = facePoint(s, best.target, 0);
    const plan = planLink(s, this.hf, null, cellAt(fx, fz));
    (b.hub.roads ??= {})[best.target.key] = { job: 0, at: s.simTime, ...(plan.reason ? { why: `NO HAUL ROAD — ${plan.reason}` } : {}) };
    if (plan.reason || !plan.cells.length) return;
    const open = this.debugOpenRoads;
    for (const k of plan.fresh) { const [gx, gz] = keyCell(k); s.roads!.push({ gx, gz, left: open ? 0 : ROAD.cellS }); }
    if (!open) b.spur = [...(b.spur ?? []), ...plan.cells.filter((k) => !(b.spur ?? []).includes(k))];
    bumpRoads(s);
  }

  /** b.deposit: the deposit under the footprint centre (placement and load);
   *  an excavator's is the ground it digs, its pad's kept in its haul */
  private stampDeposit(b: BuildingState) {
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
  private digAt(id: number, x: number, z: number) {
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
  private strike(b: BuildingState, d: Deposit) {
    const s = this.state;
    if (depositRevealed(s, d, this.mods.surveyTier)) return;
    s.survey.struck.push(d.id);
    this.revealedIds.add(d.id);
    this.rebuildDepositOverlay();
    alert(s, `PROSPECT STRUCK — ${BUILDINGS[b.type].name} #${b.id} is on ${DEPOSIT_INFO[d.kind].name} ` +
      `(${strikeEffect(d.kind, this.mods)})`, 'info', { select: b.id });
  }

  /** After a tick, a tech or a load: completed masts map their ground, and
   *  anything newly revealed joins the overlay (announced unless loading). */
  private syncDeposits(announce: boolean) {
    const s = this.state;
    revealDeposits(s, this.hf.deposits);
    const tier = this.mods.surveyTier;
    const now = this.hf.deposits.filter((d) => depositRevealed(s, d, tier));
    this.syncZones(now);
    const fresh = now.filter((d) => !this.revealedIds.has(d.id));
    if (!fresh.length && this.depositOverlay) return;
    this.revealedIds = new Set(now.map((d) => d.id));
    this.rebuildDepositOverlay();
    if (!announce || !fresh.length) return;
    const count = new Map<DepositKind, number>();
    for (const d of fresh) count.set(d.kind, (count.get(d.kind) ?? 0) + 1);
    const list = [...count].map(([k, n]) => `${DEPOSIT_INFO[k].name}${n > 1 ? ` ×${n}` : ''}`).join(' · ');
    alert(s, `DEPOSITS MAPPED — ${list} · overlay [I]`, 'info');
  }

  /** The extraction zones are the deposits the player sees (core/zones.ts):
   *  auto roads stop at their rims from now on. */
  private syncZones(revealed = this.hf.deposits.filter((d) => depositRevealed(this.state, d, this.mods.surveyTier))) {
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
  private crewAllStations() {
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
  private setOverclock(id: number, on: boolean) {
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
  private doDownlink() {
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
  private doLaunch() {
    const s = this.state;
    const refused = launchVolley(s, this.mods);
    if (refused) { alert(s, refused, 'warn'); return; }
    this.life.onLaunch(s);
  }

  // ─────────────────────────── loop ───────────────────────────

  private shadeAcc = 0;
  private alertAcc = 0;
  private cueSeen: {
    alerts: Map<number, AlertMsg['kind']>; night: boolean; launches: number; techs: number; built: number;
  } | null = null;
  /** what the discovery queue has already seen (null = take the baseline) */
  private announceSeen: { techs: number; era: number } | null = null;
  /** hazard kinds already drilled when the discovery queue last looked */
  private announceDrilled: number | null = null;
  private announceId = 1;
  /** a brand-new mission: its first publish opens with the Era 1 explainer */
  private introPending = false;
  /** alert key → real time (ms) its radio call last played */
  private cueKeyAt = new Map<string, number>();
  /** FX levels that failed a render check on this GPU (kept in settings),
   *  and the last cause this session */
  private fxFailed = new Set<number>(loadSettings().fxFailed);
  private fxReason = '';
  private safeAuto = false;
  /** the player left safe mode: back to it if the lit frame comes out black */
  private safeTrial = false;
  /** full-screen opaque screens over the world: the tech tree */
  private techOpen = false;
  /** renders of the whole scene so far: the render pass, and any pass that
   *  draws it again (N8AO's transparency pass did, twice a frame) */
  private sceneRenders = 0;
  private framesDrawn = 0;
  private firstFrame: { fx: number; safe: boolean } | null = null;
  /** alert id → real time (ms) it was last raised, as seen by this session */
  private alertClock = new Map<number, { t: number; count: number }>();
  private playFrames = 0;      // frames since gameplay (not page load) began
  private nextProbe = 40;      // next black-frame probe, in playFrames
  private probeHeld = false;   // debug: terrain hidden, the check waits for an explicit probe
  /** black-frame probe verdicts so far (tests, probes) */
  private probes = { ok: 0, black: 0, unknown: 0 };
  private safeMode = false;
  /** the FX self-check (world/fxcheck.ts): High detail only; due at boot and
   *  after every level change, on a frame at FX 0–2 */
  private fxCheck: FxSelfCheck | null = null;
  private fxCheckDue = false;
  private fxCheckAt = 0;
  private fxCheckTries = 0;
  /** debug: automatic checks off (an explicit fxCheckNext still runs one) */
  private fxCheckAuto = true;
  private fxCheckForced = false;
  private inFxCheck = false;
  private shaderFault: 'patch' | 'classic' | 'other' | null = null;
  /** the last drawn frame's totals over every pass (shadow map included) */
  private frameStats = { calls: 0, triangles: 0, points: 0, lines: 0 };
  /** texture types of every render target bound so far (the classic style
   *  binds none: it draws straight to the canvas) */
  private targetTypes = new Set<number>();

  /** Record each render target the renderer binds (probes, tests). */
  private watchRenderTargets() {
    const r = this.renderer;
    const set = r.setRenderTarget.bind(r);
    r.setRenderTarget = (target, ...rest) => {
      if (target && !diagnosticTargets.has(target)) this.targetTypes.add((target.texture as THREE.Texture).type);
      set(target, ...rest);
    };
  }

  /** The player picked a render style (the menu): stored, the game saved,
   *  and the page reloaded straight back into it — the renderer's context
   *  attributes are fixed at creation. URL shortcuts that would override
   *  the choice or start a new game are dropped. */
  async switchStyle(style: RenderStyle) {
    saveSettings({ style });
    if (style === this.opts.style) return;
    if (this.playing && !missionLost(this.state)) {
      await this.doSave();
      try { sessionStorage.setItem(RESUME_KEY, '1'); } catch { /* the title screen, then */ }
    }
    this.playing = false; // nothing may write the save again before the reload
    const url = new URL(location.href);
    for (const k of ['style', 'site', 'exp', 'fx', 'safe']) url.searchParams.delete(k);
    location.assign(url.toString());
  }

  /** Would this touch choice change the running mode (and so reload)? */
  touchSwitchReloads(choice: TouchChoice): boolean {
    const next = choice === 'auto' ? autoTouch() : choice === 'on';
    return next !== !!this.opts.touch;
  }

  /** The player picked touch controls (the menu): stored; when that changes
   *  the running mode, the game saves and the page reloads straight back
   *  into it — the touch layout is built once, at boot. A ?touch flag in the
   *  address is dropped, or it would override the choice. */
  async switchTouch(choice: TouchChoice) {
    saveSettings({ touch: choice });
    if (!this.touchSwitchReloads(choice)) return;
    if (this.playing && !missionLost(this.state)) {
      await this.doSave();
      try { sessionStorage.setItem(RESUME_KEY, '1'); } catch { /* the title screen, then */ }
    }
    this.playing = false;
    const url = new URL(location.href);
    for (const k of ['touch', 'site', 'exp']) url.searchParams.delete(k);
    location.assign(url.toString());
  }

  private frame(t: number) {
    requestAnimationFrame((tt) => this.frame(tt));
    // touch mode (a phone's battery): a hidden page neither draws nor steps
    if (this.opts.touch && document.hidden) { this.lastT = t; return; }
    this.firstFrame ??= { fx: this.post.fxLevel, safe: this.safeMode };
    const realDt = Math.max(0, (t - this.lastT) / 1000);
    this.lastT = t;
    if (this.playing) {
      this.step(realDt);
      this.alertAcc += realDt;
      if (this.alertAcc > 0.5) { this.alertAcc = 0; this.ageAlerts(t); }
    }
    // an opaque full-screen screen hides the world: the sim ticks, the GPU rests
    const covered = this.playing && (this.techOpen || this.lunarUi.open);
    this.renderer.info.reset();
    const drawn = !covered && this.post.render(Math.min(realDt, 0.1));
    if (drawn) {
      this.framesDrawn++;
      const r = this.renderer.info.render;
      this.frameStats = { calls: r.calls, triangles: r.triangles, points: r.points, lines: r.lines };
    }
    if (this.shaderFault) this.recoverFromShaderFault();
    // Counted from gameplay start (the player may sit on the title screen for
    // any length of time), and re-probed periodically to catch mid-game
    // driver failures. Only a frame drawn just now can be read back.
    if (!this.playing) return;
    this.playFrames++;
    if (drawn && this.fxCheckDue && this.playFrames >= this.fxCheckAt) this.runFxCheck();
    if (drawn && this.playFrames >= this.nextProbe) this.probeFrame();
  }

  /** The self-check is due `frames` from now (the level has settled by then:
   *  its programs compiled, its first frames drawn). */
  private scheduleFxCheck(frames = 20) {
    if (this.classic) return;
    this.fxCheckDue = true;
    this.fxCheckTries = 0;
    this.fxCheckAt = this.playFrames + frames;
  }

  /** Compare the frame just drawn with the plain path (world/fxcheck.ts). A
   *  gross deviation fails the level like a black frame does: a raise on
   *  trial goes back, anything else steps one rung down — and the next
   *  level is checked the same way. Inconclusive views are retried. */
  private runFxCheck() {
    this.fxCheckDue = false;
    const forced = this.fxCheckForced;
    this.fxCheckForced = false;
    const level = this.post.fxLevel;
    if (!this.fxCheck || this.safeMode || level >= FX_PLAIN || !this.post.chainBuilt) return;
    if (!this.fxCheckAuto && !forced) return;
    let res: FxCheckResult | null = null;
    try {
      res = this.fxCheck.run(level, (on) => { this.inFxCheck = on; applyFxBreak(level, on); });
    } catch (e) {
      console.warn('[MOONSHOTS] FX self-check could not run.', e);
    } finally {
      this.inFxCheck = false;
      applyFxBreak(level);
    }
    pollGlErrors(this.renderer.getContext(), 'FX self-check');
    if (!res) return;
    const m = res.metrics;
    const summary = `lost ${m.lost}, gained ${m.gained}, flat ${m.flat}, mean ×${m.meanRatio}, hist ${m.hist}`
      + `${res.hdr ? `, NaN ${res.hdr.nan}, max ${res.hdr.max}` : ''}, ${res.ms} ms`;
    if (res.verdict === 'unknown') {
      if (++this.fxCheckTries < 20) { this.fxCheckDue = true; this.fxCheckAt = this.playFrames + 120; }
      return;
    }
    this.fxCheckTries = 0;
    if (res.verdict === 'pass') {
      console.log(`[MOONSHOTS] FX self-check: level ${level} passed (${summary})`);
      logRender('fx', `self-check passed at FX ${level}: ${summary}`);
      return;
    }
    const why = res.reasons.join('; ');
    console.warn(`[MOONSHOTS] FX self-check: level ${level} failed (${why}; ${summary})`);
    this.renderFailed(`FX self-check: ${why}`);
  }

  /** Black-screen sentinel: some drivers fail shaders silently instead of
   *  throwing. The frame just drawn is read wherever the ground cannot
   *  legitimately be black — under a risen sun, at night where the landscape
   *  patch lays its earthshine floor (FX 0–2, ~30 r+g+b on open ground), and
   *  at any hour in safe mode (unlit). Dusk and dawn, FX 3 nights and views
   *  with too little ground are inconclusive: checked again soon. A black
   *  frame first drops the post chain (a raise on trial goes straight back),
   *  then escalates to safe mode; in safe mode it can at most keep the
   *  effects off. */
  private probeFrame() {
    const day = currentDay(this.state, SITES[this.state.siteId]);
    // classic nights hold open ground well off black (the earthshine key)
    const readable = this.safeMode || this.lighting.sunLight >= 0.75
      || (day.nightFactor >= 0.9 && (this.classic || materials.patched('terrain')));
    const verdict = readable ? this.post.probe((u, v) => this.groundAt(u, v)) : 'unknown';
    this.probes[verdict]++;
    if (verdict === 'unknown') {
      this.nextProbe = this.playFrames + 120;
    } else if (verdict === 'ok') {
      this.renderVerified();
      this.nextProbe = this.playFrames + 900;      // healthy — routine re-check
    } else {
      this.nextProbe = this.playFrames + 40;       // verify the next rung quickly
      this.renderFailed('black frame detected');
    }
    if (this.probeHeld) this.nextProbe = Number.POSITIVE_INFINITY;
  }

  /** A probe passed: a raise on trial is kept, and so is leaving safe mode. */
  private renderVerified() {
    if (this.safeMode) return;
    this.post.confirm();
    if (this.safeTrial) {
      this.safeTrial = false;
      saveSettings({ safe: false, safeAuto: false });
    }
    // the remembered failures are the High detail ladder's
    if (!this.classic && this.fxFailed.delete(this.post.fxLevel)) this.saveFailed();
  }

  /** The frame is black, or a program failed to compile. */
  private renderFailed(reason: string) {
    if (this.safeMode) {
      // nothing simpler to fall back to than safe mode itself
      this.post.forceFallback(`${reason} in safe mode`);
      this.nextProbe = this.playFrames + 900;
      return;
    }
    if (this.safeTrial) {
      // leaving safe mode did not draw: straight back to it
      this.safeTrial = false;
      if (!this.classic) {
        this.fxFailed.add(this.post.fxLevel);
        this.fxReason = reason;
        this.saveFailed();
      }
      this.enableSafeMode();
      return;
    }
    if (!this.post.fail(reason)) this.enableSafeMode();
  }

  private saveFailed() {
    saveSettings({ fxFailed: [...this.fxFailed].sort() });
  }

  /** CSS-pixel position of a world point under the live camera. */
  private screenOf(x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return {
      x: r.left + ((v.x + 1) / 2) * r.width,
      y: r.top + ((1 - v.y) / 2) * r.height,
      visible: v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1,
    };
  }

  /** Terrain height anywhere: the grid inside the map, the horizon ring past it. */
  private groundAnywhere = (x: number, z: number) => this.horizon.heightAt(x, z);

  /** Does the screen point (u, v ∈ 0..1, origin bottom-left) look at terrain? */
  private groundAt(u: number, v: number): boolean {
    this.raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, v * 2 - 1), this.camera);
    const { origin: o, direction: d } = this.raycaster.ray;
    return this.hf.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 1500) !== null;
  }

  /** A shader failed to compile this frame. A patched scene shader is the
   *  likely culprit and the cheapest to lose: strip the patches first. Any
   *  other program steps the post ladder down (then safe mode). */
  private recoverFromShaderFault() {
    const fault = this.shaderFault;
    this.shaderFault = null;
    // the classic building shader is the classic style's only custom program
    if (fault === 'classic' && materials.replaceClassic('building', classicFallbackMaterial(), this.scene)) {
      console.warn('[MOONSHOTS] Classic building shader failed to compile — stock Lambert.');
      if (this.state) { alert(this.state, 'RENDER — building lights disabled (GPU limitation), plain materials', 'warn'); this.publish(); }
      return;
    }
    if (fault === 'patch' && materials.stripPatches()) {
      console.warn('[MOONSHOTS] Detail shaders failed to compile — stock materials.');
      if (this.state) { alert(this.state, 'RENDER — detail shaders disabled (GPU limitation)', 'warn'); this.publish(); }
      return;
    }
    this.renderFailed('shader compile error');
  }

  /** Last-resort rendering: unlit vertex-color materials, no shadows, no
   *  effects — the plain forward path, no composer. Renders on anything that
   *  can draw a triangle — including meshes created later, which take their
   *  material from the registry. `auto`: the render checks turned it on (and
   *  say so), not the player. `persist`: remember it for the next launch
   *  (not for a boot flag or a re-apply). */
  enableSafeMode(auto = true, persist = true) {
    if (this.safeMode) return;
    this.safeMode = true;
    this.safeAuto = auto;
    this.safeTrial = false;
    console.warn('[MOONSHOTS] Safe render mode enabled — simplified materials, no shadows, no effects.');
    this.post.setSafe(true);
    this.renderer.shadowMap.enabled = false;
    materials.enableSafe(this.scene);
    this.rocks?.setSafe(true);
    this.sky.setSafe(true);
    if (persist) saveSettings(auto ? { safeAuto: true } : { safe: true, safeAuto: false });
    if (this.state && auto) {
      alert(this.state, 'SAFE RENDER MODE — simplified visuals (GPU issue detected)', 'warn');
      this.publish();
    }
    this.reprobe();
  }

  /** Lit rendering again — only ever on the player's word — at the ladder's
   *  level, as a checked raise: kept (in settings) once a probe passes, and
   *  straight back to safe mode if the frame comes out black. */
  disableSafeMode() {
    if (!this.safeMode) return;
    this.safeMode = false;
    this.safeAuto = false;
    this.safeTrial = true;
    console.warn('[MOONSHOTS] Safe render mode off — lit materials and shadows.');
    this.renderer.shadowMap.enabled = !this.classic;
    materials.disableSafe(this.scene);
    this.rocks?.setSafe(false);
    this.sky.setSafe(false);
    this.post.setSafe(false);
    this.lighting.requestShadowUpdate();
    this.reprobe(2);
    this.scheduleFxCheck();
  }

  get safeModeOn(): boolean { return this.safeMode; }
  get fxLevel(): number { return this.post.fxLevel; }

  /** The player's FX pick (the menu). Lowering is always safe; raising is
   *  theirs to ask for — even to a level that failed before — and is a
   *  trial: the black-frame check reads the next frames that can tell, the
   *  level is stored once one passes, and a black one goes straight back. In
   *  safe mode the pick is the level leaving it returns to. */
  setFxLevel(n: number) {
    this.post.setLevel(n);
  }

  /** The tech tree covers the world (the UI calls this). */
  setTechOpen(open: boolean) {
    this.techOpen = open;
  }

  renderStatus(): RenderStatus {
    return {
      level: this.post.fxLevel, ladder: this.post.ladderLevel, failed: [...this.fxFailed].sort(),
      reason: this.fxReason, checking: !this.safeMode && (this.post.onTrial || this.safeTrial),
      safe: this.safeMode, safeAuto: this.safeAuto, floor: this.opts.lowfx ? 2 : 0,
    };
  }

  /** The render report (menu → Copy render report): what this GPU and
   *  browser are, what the ladder did and why, the self-check's numbers and
   *  the render log. Plain data, JSON-ready. */
  renderReport() {
    const gl = this.renderer.getContext();
    pollGlErrors(gl, 'report');
    const caps = this.post.caps;
    const supported = new Set(gl.getSupportedExtensions() ?? []);
    const s = loadSettings();
    const attrs = gl.getContextAttributes();
    return {
      report: 'Moonshots Base Builder render report',
      generated: new Date().toISOString(),
      page: location.pathname + location.search,
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      gpu: gpuStrings(this.renderer),
      webgl: {
        webgl2: caps?.webgl2 ?? (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext),
        extensions: caps?.extensions ?? Object.fromEntries(REPORT_EXTENSIONS.map((e) => [e, supported.has(e)])),
        supportedCount: supported.size,
        precision: caps?.precision ?? null,
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
        maxSamples: this.renderer.capabilities.maxSamples,
        context: { antialias: attrs?.antialias ?? null, alpha: attrs?.alpha ?? null, powerPreference: attrs?.powerPreference ?? null },
        drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        pixelRatio: this.renderer.getPixelRatio(),
      },
      style: this.opts.style,
      fx: {
        level: this.post.fxLevel,
        ladder: this.post.ladderLevel,
        stored: this.post.storedLevel,
        choice: s.fx,
        failed: [...this.fxFailed].sort(),
        reason: this.fxReason,
        onTrial: this.post.onTrial,
        chainBuilt: this.post.chainBuilt,
        sanitizer: this.post.sanitizer,
        lowfx: this.opts.lowfx,
        capFloor: caps?.floor ?? null,
        capFloorReason: caps?.floorReason ?? '',
        capHeld: this.post.capHeld,
        halfFloatProbe: caps?.halfFloat ?? null,
        debugBreak: fxBreak(),
      },
      safe: { on: this.safeMode, auto: this.safeAuto, stored: s.safe, storedAuto: s.safeAuto },
      patches: materials.variants(),
      patchFault: materials.patchesFaulted,
      selfCheck: this.fxCheck ? this.fxCheck.history.map((r) => ({ ...r })) : [],
      probes: { ...this.probes },
      framesDrawn: this.framesDrawn,
      log: renderLog(),
    };
  }

  /** Copy the report to the clipboard and print it; false when the browser
   *  refused the clipboard (it is in the console either way). */
  async copyRenderReport(): Promise<boolean> {
    const text = JSON.stringify(this.renderReport(), null, 2);
    console.log(`[MOONSHOTS] Render report\n${text}`);
    return copyText(text);
  }

  /** Run the FX self-check on the next drawn frame (tests, probes). */
  debugFxCheckNext() {
    this.fxCheckForced = true;
    this.fxCheckDue = true;
    this.fxCheckTries = 0;
    this.fxCheckAt = this.playFrames + 1;
  }

  /** The self-check's results so far, newest last. */
  debugFxChecks(): FxCheckResult[] {
    return this.fxCheck ? this.fxCheck.history.map((r) => JSON.parse(JSON.stringify(r))) : [];
  }

  /** The last self-check's two images (display luminance, bottom row first). */
  debugFxCheckImages() {
    const im = this.fxCheck?.lastImages;
    return im ? { W: im.W, H: im.H, chain: [...im.chain].map((v) => Math.round(v)), plain: [...im.plain].map((v) => Math.round(v)) } : null;
  }

  /** Hold the black-frame sentinel off (a test of what only the self-check sees). */
  debugHoldProbe(on: boolean) {
    this.probeHeld = on;
    this.nextProbe = on ? Number.POSITIVE_INFINITY : this.playFrames + 40;
  }

  /** Automatic self-checks on or off (an explicit debugFxCheckNext still runs). */
  debugSetFxCheckAuto(on: boolean) { this.fxCheckAuto = on; }

  /** Make FX `level` draw wrong the way a faulty GPU would (null: mend it). */
  debugBreakFx(level: number | null, mode: FxBreak = 'player') { setFxBreak(level, mode); }

  /** The HDR sanitiser on or off (a test that shows what it stops). */
  debugSetSanitize(on: boolean) { sanitizeUniform.value = on; }

  /** The whole hardening (N8AO composite + sanitiser) on or off: off draws
   *  what the stock chain drew (a test that the look did not change). */
  debugSetHardening(on: boolean) { setHardening(on); }

  /** check `frames` from now (unless a probe is holding the check off) */
  private reprobe(frames = 40) {
    if (this.playing && Number.isFinite(this.nextProbe)) {
      this.nextProbe = Math.min(this.nextProbe, this.playFrames + frames);
    }
  }

  /** One frame of play. Camera, walk physics and effects step at most 0.1 s,
   *  but game time takes up to 0.5 s of it, so a slow GPU still runs the clock
   *  at full speed (the tick loop's guard bounds the catch-up). */
  private step(realDt: number) {
    this.tick(Math.min(realDt, 0.1), Math.min(realDt, 0.5));
  }

  private tick(dt: number, simDt: number) {
    // actions first, every frame, so the UI feels immediate
    const acts = this.actions.drain();
    const counts = acts.length ? new Map(this.state.alerts.map((a) => [a.id, a.count])) : null;
    for (const a of acts) this.applyAction(a);
    if (counts) this.cueRefusals(counts);

    const tweening = this.modes.update(dt);
    if (!tweening) {
      if (this.modes.mode === 'build') {
        this.buildCam.update(dt);
        if (this.fleetTarget.active) this.fleetTarget.update();
        if (this.roadTool.active) this.roadTool.update();
        if (this.placement.active) {
          this.raycaster.setFromCamera(this.mouse, this.camera);
          this.placement.update(this.state, this.mods.unlocked,
            this.raycaster.ray.origin, this.raycaster.ray.direction, this.mods.surveyTier);
          const p = this.placement.probe!;
          $placing.set({
            type: p.type, valid: p.valid, reason: p.reason, warn: p.warn, note: p.note, confirm: p.confirm,
            road: p.road?.length, roadS: p.roadS, offM: p.offM, travelS: p.valid && p.type !== 'grade' ? this.placeTravel(p) : undefined,
            hub: p.valid && p.type !== 'grade' && isHubType(p.type) ? hubGhostLine(this.state, this.mods, SITES[this.state.siteId], p as { type: BuildingId; gx: number; gz: number; rot: 0 | 1 | 2 | 3 }) : undefined,
          });
        }
      } else {
        this.walk.update(dt);
        this.walk.applyToCamera(this.camera);
        this.lookAcc += dt;
        if (this.lookAcc > 0.12) { this.lookAcc = 0; this.updateLookAt(); }
      }
    }

    // game time + economy at fixed 1 Hz (of game time)
    if (!this.state.paused) {
      const gdt = simDt * this.state.speed;
      this.state.simTime += gdt;
      this.econAcc += gdt;
      let publish = acts.length > 0;
      let guard = 0;
      let victory = false;
      let defeat = false;
      while (this.econAcc >= 1 && guard < 120) {
        this.econAcc -= 1;
        guard++;
        const ev = this.econStep();
        if (ev.victory && !this.state.victoryShown) {
          this.state.victoryShown = true;
          victory = true;
        }
        if (ev.defeat && !this.state.defeatShown) {
          this.state.defeatShown = true;
          defeat = true;
        }
        publish = true;
      }
      if (publish) {
        // sync construction rise/dim AND brownout darkening every economy tick
        this.instances.rebuild(this.state);
        this.publish();
      }
      if (victory) $victory.set(true); // after publish so the overlay reads fresh stats
      if (defeat) {
        $defeat.set(true);
        void this.recordLoss();
      }
    } else if (acts.length) {
      this.publish();
    }

    this.shadeAcc += dt;
    if (this.shadeAcc > 0.5) {
      this.shadeAcc = 0;
      this.updateShading();
      this.updateDarkness();
      this.updateWearMarkers();
      this.updateAutoMarkers();
      this.updateHazardMarkers();
      sfx.setAmbience({
        margin: this.gridMargin(), walking: this.modes.mode === 'walk' && !tweening,
        night: currentDay(this.state, SITES[this.state.siteId]).nightFactor > 0.5,
      });
      this.cueDestiny(tweening);
    }
    this.updateDepositMarkers();

    // sun follows the clock; the shadow window hugs the ground in view
    const day = currentDay(this.state, SITES[this.state.siteId]);
    const walking = this.modes.mode === 'walk';
    const focus = walking ? this.walk.pos : this.buildCam.target;
    this.lighting.setSun(day.sunElev, day.sunAzim, day.nightFactor);
    this.camera.updateMatrixWorld();
    this.sky.update(this.camera, day.sunElev, day.sunAzim, this.lighting.sunLight, day.tCycle, dt,
      this.groundAnywhere);
    // the isometric view never looks above the horizon: the sky only draws
    // on foot and on the way down
    if (this.classic) this.sky.group.visible = walking || tweening;
    // the isometric view stands hundreds of metres off: small rocks round its
    // focus, and none once they would be specks
    if (this.buildCam instanceof IsoCam && !walking) {
      this.rocks.update(this.camera, this.buildCam.distance <= 350 ? this.buildCam.target : null);
    } else {
      this.rocks.update(this.camera);
    }
    this.syncTerrain(dt);
    // the sun step grows with game speed; the wings turn first, so their
    // re-aim joins this frame's shadow render instead of forcing another
    const step = sunStep(this.state.paused ? 1 : this.state.speed);
    // the lights fade on wall time (up to 0.5 s a frame, as the clock runs), so
    // a slow GPU does not stretch a one-second fade over many seconds
    this.darkness.update(simDt, day.nightFactor, day.sunElev, this.lighting.sunLight);
    this.instances.update(dt, day.nightFactor, this.lighting.sunDirection, step);
    this.lighting.fitShadow(this.camera, focus, walking ? 160
      : Math.min(900, Math.max(140, 2.2 * this.camera.position.distanceTo(focus))), dt, step);
    // wherever it stands dark the base carries its own light: window glow and
    // floods in the shader patches, or (stock path) ground discs and work
    // lights over the dark structures nearest the camera (hull glow at night);
    // classic keys its windows and pools on the same darkness (instances.ts)
    const stockLights = !this.classic && !this.instances.shaderLights;
    this.lighting.useWorkLights(stockLights);
    this.lighting.setWorkLights(stockLights ? this.instances.nearestDark(focus, this.lighting.workSpots) : 0);
    this.overlays.update(this.state, this.placement.probe, this.placement.ghost?.visible ?? false,
      $selection.get(), this.lighting.sunDirection);
    const onFoot = walking && !tweening;
    this.lighting.setHeadlamp(onFoot ? day.nightFactor : 0);
    this.life.update({
      dt, paused: this.state.paused, speed: this.state.speed, state: this.state, camera: this.camera,
      sunDir: this.lighting.sunDirection, sunLight: this.lighting.sunLight, walker: onFoot ? this.walk : null,
      tickFrac: this.econAcc,
    });
    this.life.rovers.selected = $roverSel.get();
    sfx.setRovers(this.life.rovers.sounds(this.camera, onFoot ? null : this.buildCam.target));

    // autosave (real time)
    this.autosaveAcc += dt;
    if (this.autosaveAcc > AUTOSAVE_S) {
      this.autosaveAcc = 0;
      void this.doSave();
    }
  }

  private droneLaunches = -1;
  /** The destiny's sound (docs/14 §4.6), twice a second: the score follows
   *  the lean from $destiny; rotors, walkers' radios and greenhouse air by
   *  what is near the listener; a data chirp as a drone takes a job. */
  private cueDestiny(tweening: boolean) {
    const d = $destiny.get();
    sfx.setDestiny(leanFrom(d.c, d.a, d.band));
    const onFoot = this.modes.mode === 'walk' && !tweening;
    const at = onFoot ? this.walk.pos : this.buildCam.target;
    const lift = onFoot ? 0 : 0.3 * this.camera.position.distanceTo(this.buildCam.target);
    const life = this.life.soundscape(this.state, at.x, at.z, lift);
    sfx.setLife(life);
    if (this.droneLaunches >= 0 && life.launches > this.droneLaunches) sfx.play('modem');
    this.droneLaunches = life.launches;
    // the hazards (docs/14 §4.6): a lethal telegraph holds the score; a death
    // keeps it to the night pool; an Automation hazard starts with a modem chirp
    const hz = $hazards.get();
    if (!hz) return;
    sfx.holdScore(hz.active.some((h) => h.phase === 'telegraph' && (h.lethal || h.destroys) && !h.drill));
    const deaths = hz.deaths;
    if (this.hazardDeaths >= 0 && deaths > this.hazardDeaths) sfx.mourn();
    this.hazardDeaths = deaths;
    let fresh = false;
    for (const h of hz.active) {
      if (h.side === 'automation' && !this.hazardsHeard.has(h.id)) { this.hazardsHeard.add(h.id); fresh = true; }
    }
    if (fresh) sfx.play('modem');
  }
  private hazardDeaths = -1;
  private hazardsHeard = new Set<number>();

  /** A refused action (a warn event raised or repeated by it) blips, and
   *  stays off the radio: the player caused it and is looking at it. */
  private cueRefusals(before: Map<number, number>) {
    let refused = false;
    for (const a of this.state.alerts) {
      if (a.kind !== 'warn' || a.cond || (before.get(a.id) ?? 0) >= a.count) continue;
      refused = true;
      this.cueSeen?.alerts.set(a.id, a.kind);
    }
    if (refused) sfx.play('invalid');
  }

  /** Grid health for the hum: 1 surplus … 0 balanced; below 0 the bank is
   *  draining, reaching −1 as its runway nears zero or the grid browns out. */
  private gridMargin(): number {
    const s = this.state;
    const p = s.power;
    if (p.brownout) return -1;
    if (p.shed) return -0.7;
    if (p.supply >= p.demand) return Math.min(1, (p.supply - p.demand) / Math.max(5, p.demand));
    const runway = s.powerStored / Math.max(1e-6, p.demand - p.supply);
    return -Math.min(1, Math.max(0, 1 - runway / GRID_RUNWAY_S));
  }

  /** Sound follows the published state: new warn/crit alerts come over the
   *  radio, finished sites and techs chime, nightfall swells, launches roar.
   *  A world's first publish only takes the baseline. */
  private playCues(isNight: boolean) {
    const s = this.state;
    let built = 0;
    for (const b of s.buildings) if ((b.construction ?? 0) <= 0) built++;
    const seen = this.cueSeen;
    this.cueSeen = {
      alerts: new Map(s.alerts.map((a) => [a.id, a.kind])),
      night: isNight, launches: s.launches, techs: s.techsDone.length, built,
    };
    if (!seen) return;
    const now = performance.now();
    // a flickering condition comes back under a new id: one call per key a while
    const fresh = (key: string, quietMs: number) => {
      if (now - (this.cueKeyAt.get(key) ?? -Infinity) < quietMs) return false;
      this.cueKeyAt.set(key, now);
      return true;
    };
    let warn = false, crit = false;
    for (const a of s.alerts) {
      const was = seen.alerts.get(a.id);
      if (a.kind === 'crit' && was !== 'crit') crit = fresh(a.key, 15_000) || crit;
      else if (a.kind === 'warn' && was === undefined) warn = fresh(a.key, 30_000) || warn;
    }
    if (crit) sfx.play('crit');
    else if (warn) sfx.play('warn');
    if (built > seen.built) sfx.play('built');
    if (s.techsDone.length > seen.techs) sfx.play('research');
    if (s.launches > seen.launches) sfx.play('launch');
    if (isNight && !seen.night) sfx.play('nightfall');
  }

  /** Finished techs and opened eras join the discovery queue (ui/discovery.ts).
   *  A loaded world only takes the baseline; a brand-new one opens with the
   *  Era 1 explainer. Test runs (?debug) stay quiet unless they ask (&tips). */
  private queueAnnouncements() {
    const s = this.state;
    const seen = this.announceSeen;
    this.announceSeen = { techs: s.techsDone.length, era: s.era };
    const intro = this.introPending;
    this.introPending = false;
    const q = new URLSearchParams(location.search);
    if (!loadSettings().tips || (q.has('debug') && !q.has('tips'))) return;
    const add: Announcement[] = [];
    if (!seen) {
      if (intro) add.push({ id: this.announceId++, kind: 'era', era: 1, intro: true });
    } else {
      for (const tid of s.techsDone.slice(seen.techs)) add.push({ id: this.announceId++, kind: 'tech', tid });
      for (let e = seen.era + 1; e <= s.era; e++) add.push({ id: this.announceId++, kind: 'era', era: e, intro: false });
    }
    // hazards (docs/14 §3.10): a side's first 2 picks put it live; the first of each kind is its drill
    const hzs = s.hazards;
    for (const side of ['colony', 'automation'] as const) {
      const d = $destiny.get();
      if ((side === 'colony' ? d.c : d.a) >= 2 && !hzs.liveSides.includes(side)) {
        hzs.liveSides.push(side);
        if (seen) add.push({ id: this.announceId++, kind: 'hazardsLive', side });
      }
    }
    const drilled = this.announceDrilled ?? hzs.drilled.length;
    if (seen) for (const k of hzs.drilled.slice(drilled)) add.push({ id: this.announceId++, kind: 'hazard', hazard: k as HazardId });
    this.announceDrilled = hzs.drilled.length;
    if (add.length) $announce.set([...$announce.get(), ...add]);
  }

  /** Alerts age in real time, whatever the game speed: info events leave
   *  after ALERTS.fadeInfoS, warn events after ALERTS.fadeWarnS, and an info
   *  condition goes quiet (still listed while it holds). Crit waits. */
  private ageAlerts(nowMs: number) {
    const s = this.state;
    let changed = false;
    const listed = new Set<number>();
    s.alerts = s.alerts.filter((a) => {
      listed.add(a.id);
      const c = this.alertClock.get(a.id);
      if (!c || (!a.cond && c.count !== a.count)) {
        this.alertClock.set(a.id, { t: nowMs, count: a.count });
        return true;
      }
      const life = a.kind === 'info' ? ALERTS.fadeInfoS : a.kind === 'warn' && !a.cond ? ALERTS.fadeWarnS : Infinity;
      if ((nowMs - c.t) / 1000 < life) return true;
      if (a.cond) {
        if (!a.quiet) { a.quiet = true; changed = true; }
        return true;
      }
      changed = true;
      return false;
    });
    for (const id of this.alertClock.keys()) if (!listed.has(id)) this.alertClock.delete(id);
    if (changed) this.publish();
  }

  /** Solar arrays in terrain shadow lose 85% output: march a ray toward the
   *  sun from each panel through the heightfield (cheap at this cadence). */
  private updateShading() {
    // masts stand above the terrain's shadows: nothing to march
    if (this.mods.solarShadeImmune) {
      for (const b of this.state.buildings) if (b.type === 'solar' || b.type === 'solarObservatory') b.shaded = false;
      return;
    }
    const d = currentDay(this.state, SITES[this.state.siteId]);
    if (d.sunFactor <= 0.01 || d.sunElev <= 0.01) return;
    const dirX = Math.cos(d.sunAzim) * Math.cos(d.sunElev);
    const dirY = Math.sin(d.sunElev);
    const dirZ = Math.sin(d.sunAzim) * Math.cos(d.sunElev);
    for (const b of this.state.buildings) {
      // a Solar Observatory's shade blinds its forecast too (docs/16 §6.2)
      if ((b.type !== 'solar' && b.type !== 'solarObservatory') || (b.construction ?? 0) > 0) continue;
      const [cx, cz] = centerOf(b);
      const y = this.hf.sample(cx, cz);
      b.shaded = this.hf.raycast(cx, y + 3.2, cz, dirX, dirY, dirZ, 400) !== null;
    }
  }

  /** The base's own lights: how dark each structure stands — night, a low or
   *  set sun, terrain between it and the sun (buildings/darkness.ts). Visual
   *  only: `b.shaded` stays the economy's solar test above. */
  private updateDarkness() {
    const d = currentDay(this.state, SITES[this.state.siteId]);
    this.darkness.sample(this.state, d.sunElev, d.sunAzim);
  }

  /** Damaged buildings get an on-screen condition bar (build mode only). */
  /** Tags over construction sites (build mode): AUTO over the Builder's,
   *  and over any whose rover is on its way, when it gets there
   *  ('EN ROUTE 0:24', core/transit.ts) */
  private updateAutoMarkers() {
    if (!this.playing || this.modes.mode !== 'build') { if ($autoMarkers.get().length) $autoMarkers.set([]); return; }
    const v = new THREE.Vector3();
    const out: { id: number; x: number; y: number; auto: boolean; text: string }[] = [];
    for (const b of this.state.buildings) {
      if ((b.construction ?? 0) <= 0) continue;
      let text = '';
      if (b.enabled && b.idleReason === 'enroute') {
        const eta = siteTransit(this.state, b.id).eta;
        text = `EN ROUTE${Number.isFinite(eta) ? ` ${fmtClock(Math.ceil(eta))}` : ''}`;
      }
      if (!b.auto && !text) continue;
      const [cx, cz] = centerOf(b);
      v.set(cx, this.hf.sample(cx, cz) + BUILDINGS[b.type].height * 0.5 + 3, cz);
      v.project(this.camera);
      if (v.z > 1 || v.x < -1 || v.x > 1 || v.y < -1 || v.y > 1) continue;
      out.push({ id: b.id, x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, auto: !!b.auto, text });
      if (out.length >= 12) break;
    }
    const prev = $autoMarkers.get();
    if (out.length !== prev.length || out.some((m, i) => m.id !== prev[i].id || m.text !== prev[i].text || m.auto !== prev[i].auto
      || Math.abs(m.x - prev[i].x) > 0.5 || Math.abs(m.y - prev[i].y) > 0.5)) {
      $autoMarkers.set(out);
    }
  }

  /** DOM markers over hazard targets (docs/14 §3.8): the hiss with who is aboard, blight, ⚠ NET, the strip bar */
  private updateHazardMarkers() {
    const ms = $hazards.get()?.markers ?? [];
    if (!this.playing || this.modes.mode !== 'build' || !ms.length) { if ($hazardMarkers.get().length) $hazardMarkers.set([]); return; }
    const v = new THREE.Vector3();
    const out: { id: number; x: number; y: number; glyph: string; text: string; frac?: number }[] = [];
    for (const m of ms) {
      const b = this.state.buildings.find((x) => x.id === m.id);
      if (!b) continue;
      const [cx, cz] = centerOf(b);
      v.set(cx, this.hf.sample(cx, cz) + BUILDINGS[b.type].height + 5, cz).project(this.camera);
      if (v.z > 1 || v.x < -1 || v.x > 1 || v.y < -1 || v.y > 1) continue;
      out.push({ ...m, x: Math.round((v.x * 0.5 + 0.5) * window.innerWidth), y: Math.round((-v.y * 0.5 + 0.5) * window.innerHeight) });
      if (out.length >= 12) break;
    }
    $hazardMarkers.set(out);
  }

  private updateWearMarkers() {
    if (!this.playing || this.modes.mode !== 'build') { $wearMarkers.set([]); return; }
    const v = new THREE.Vector3();
    const out: { id: number; x: number; y: number; frac: number }[] = [];
    for (const b of this.state.buildings) {
      if (b.wear < 0.15 || (b.construction ?? 0) > 0) continue;
      const [cx, cz] = centerOf(b);
      v.set(cx, this.hf.sample(cx, cz) + BUILDINGS[b.type].height + 2, cz);
      v.project(this.camera);
      if (v.z > 1 || v.x < -1 || v.x > 1 || v.y < -1 || v.y > 1) continue;
      out.push({
        id: b.id,
        x: (v.x * 0.5 + 0.5) * window.innerWidth,
        y: (-v.y * 0.5 + 0.5) * window.innerHeight,
        frac: 1 - b.wear,
      });
      if (out.length >= 14) break;
    }
    $wearMarkers.set(out);
  }

  /** The overlay's glyph labels at the projected deposit centres and '?'
   *  leads (build mode, overlay on); the atom changes only when they move. */
  private updateDepositMarkers() {
    if (!this.playing || this.modes.mode !== 'build' || !$depositOverlay.get()) {
      if (this.markerSig) { this.markerSig = ''; $depositMarkers.set([]); }
      return;
    }
    const v = new THREE.Vector3();
    const out: { id: string; x: number; y: number; glyph: string; label: string; lead: boolean }[] = [];
    for (const d of $deposits.get()) {
      const at = d.revealed ? { x: d.x, z: d.z } : d.lead;
      if (!at) continue;
      v.set(at.x, this.hf.sample(at.x, at.z) + 2.5, at.z).project(this.camera);
      if (v.z > 1 || v.x < -1 || v.x > 1 || v.y < -1 || v.y > 1) continue;
      out.push({
        id: d.id, glyph: d.glyph, label: d.label, lead: !d.revealed,
        x: Math.round((v.x * 0.5 + 0.5) * window.innerWidth),
        y: Math.round((-v.y * 0.5 + 0.5) * window.innerHeight),
      });
    }
    const sig = out.map((m) => `${m.id}${m.x},${m.y}${m.glyph}`).join('|');
    if (sig === this.markerSig) return;
    this.markerSig = sig;
    $depositMarkers.set(out);
  }

  private updateLookAt() {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    this.raycaster.far = 60;
    const id = this.instances.pick(this.raycaster);
    this.raycaster.far = Infinity;
    this.lookId = id;
    if (id === null) { $lookAt.set(null); return; }
    const b = this.state.buildings.find((x) => x.id === id);
    if (!b) { this.lookId = null; $lookAt.set(null); return; }
    $lookAt.set({ name: BUILDINGS[b.type].name, x: window.innerWidth / 2, y: window.innerHeight / 2 - 40 });
  }

  // ─────────────────────────── publish ───────────────────────────

  publish() {
    const s = this.state;
    const day = currentDay(s, SITES[s.siteId]);
    $resources.set({ ...s.resources });
    $power.set({
      supply: s.power.supply, demand: s.power.demand, served: s.power.served ?? s.power.demand,
      stored: s.powerStored, capacity: s.power.capacity,
      brownout: s.power.brownout, shed: s.power.shed ?? false,
      fleet: s.power.fleet ?? 0, charging: s.power.charging ?? 0, flat: s.power.flat ?? 0,
    });
    const site = SITES[s.siteId];
    let beds = 0;
    let agentRun = 0;
    let sites = 0;
    let welding = 0;
    let weldParts = 0;
    let upkeep = 0;
    let seats = 0;
    let crewIdle = 0;
    let covered = 0;
    for (const b of s.buildings) {
      if ((b.construction ?? 0) > 0) {
        sites++;
        if (b.idleReason === 'building') {
          welding++;
          weldParts += crewParts(this.mods, s.rovers.filter((r) => r.site === b.id).length);
        }
        continue;
      }
      beds += effectiveDef(b.type, this.mods).housing ?? 0;
      if (b.enabled && b.automated && BUILDINGS[b.type].crew > 0) agentRun++;
      if (b.enabled && !b.automated && BUILDINGS[b.type].crew > 0) {
        seats += Math.max(0, BUILDINGS[b.type].crew + this.mods.crewDelta[b.type]);
      }
      if (b.enabled && b.idleReason === 'crew') crewIdle++;
      if (b.agentCover && b.automated) covered++;
      if (b.enabled) upkeep += effectiveRates(b.type, this.mods, site, b, { feed: s.feed }).upkeepPartsPerDay / CYCLE_S;
    }
    const ls = s.crew * this.mods.inputMult.habitat;
    $vitals.set({
      crew: s.crew, housing: s.housingActive ?? 0, beds, morale: Math.round(s.morale), data: s.data,
      botsFree: (s.bots?.total ?? 0) - (s.bots?.busy ?? 0), botsTotal: s.bots?.total ?? 0,
      expedition: s.expedition ?? 'human',
      boardingHold: settlersWelcome(s) ? boardingShortfall(s, this.mods.inputMult.habitat) : '',
      lifeSupport: { oxygen: ls * CREW.oxygenPerCrew, food: ls * CREW.foodPerCrew, water: ls * CREW.waterPerCrew },
      sites, welding, weldParts, upkeep, surveying: s.survey.active ? 1 : 0,
      crewHome: !!s.crewHome,
      seats, crewIdle, covered,
      canCover: canToggleCrew(s.expedition, s.crew, this.mods), agentCover: s.agentCover !== false,
    });
    $lander.set({
      resupplyPending: s.resupply?.pending ?? false,
      etaS: s.resupply?.pending ? Math.max(0, Math.ceil(s.resupply.arriveAt - s.simTime)) : 0,
      orderDays: Math.round(orderDelayS(s) / CYCLE_S),
      agentRun,
    });
    $time.set({
      dayIndex: day.dayIndex, tCycle: day.tCycle, isNight: day.isNight, sunFactor: day.sunFactor,
      phaseLeft: day.phaseLeft, speed: s.speed, paused: s.paused, flare: s.flare.phase, flareTimer: Math.ceil(s.flare.timer),
    });
    $tech.set({
      era: s.era, done: [...s.techsDone], queue: [...s.researchQueue],
      progress: s.researchQueue[0] ? (s.researchSpent[s.researchQueue[0]] ?? 0) : 0,
      unlocked: [...this.mods.unlocked],
      automation: this.mods.automation, grading: this.mods.grading,
    });
    $research.set(researchView(s, this.mods));
    $automation.set(automationView(s, this.mods));
    $alerts.set([...s.alerts]);
    const next = MILESTONES.find((m) => !s.milestonesDone.includes(m.id));
    $milestones.set({
      done: [...s.milestonesDone], total: MILESTONES.length, progress: next?.progress?.(s) ?? '',
      hints: Object.fromEntries(MILESTONES.map((m) => [m.id, milestoneHint(m, s)])),
    });
    const vt = volleyTerms(s, this.mods);
    $swarm.set({
      pct: s.swarmPct, launches: s.launches, armed: this.mods.launchArmed,
      canLaunch: this.mods.launchArmed && s.resources.foils >= vt.foils &&
        s.resources.launch >= vt.launch && s.powerStored >= vt.burst,
      burst: vt.burst,
      foils: s.resources.foils, launch: s.resources.launch, stored: s.powerStored,
      needFoils: vt.foils, needLaunch: vt.launch, auto: this.mods.autoLaunch, crewed: vt.crewed, minCrew: vt.minCrew,
    });
    $destiny.set(destinyOf(s));
    $hazards.set(hazardView(s, this.mods));
    const wv = withForecast(weatherView(s, this.mods, site, day), s, this.mods, site, day, this.forecastUi);
    // the ahead card closes once there is nothing to choose ahead for (a telegraph opened, the forecast went)
    if (this.forecastUi.ahead && !wv.forecast?.popup) this.forecastUi.ahead = false;
    $weather.set(wv);
    $lossStory.set(lossStory(s));
    $ice.set({ hasIce: SITES[s.siteId].hasIce, surveyed: s.iceSurveyed ?? false });
    $feed.set({ ...s.feed });
    $deposits.set(depositsView(s, this.hf.deposits, this.mods.surveyTier));
    // a tier that grows while the map is open moves the view out at once;
    // while it is shut the chip pulses until the next open
    const ui = this.lunarUi;
    if (ui.open && this.mods.surveyTier > ui.seenTier) ui.view = TIER_VIEW[this.mods.surveyTier];
    $lunar.set(lunarView(s, this.mods, ui));
    if (ui.open) ui.seenTier = this.mods.surveyTier;
    $caps.set({ ...(s.storageCaps ?? {}) });
    const counts: Partial<Record<BuildingId, { total: number; active: number; dark: number }>> = {};
    for (const b of s.buildings) {
      const c = counts[b.type] ?? (counts[b.type] = { total: 0, active: 0, dark: 0 });
      c.total += 1;
      if (b.active) c.active += 1;
      if (b.idleReason === 'power' && (b.construction ?? 0) <= 0) c.dark += 1;
    }
    $counts.set(counts);
    $rates.set({ ...(s.rates ?? {}) });
    const tier = this.mods.surveyTier;
    $fleet.set(fleetView(s, this.mods, site, this.hf.deposits, (d) => depositRevealed(s, d, tier)));
    const rv = $roverSel.get();
    if (rv !== null && !s.rovers.some((r) => r.id === rv)) $roverSel.set(null);
    const us = $unitSel.get();
    if (us !== null && !s.haulers.some((u) => u.id === us)) $unitSel.set(null);
    const sel = $selection.get();
    if (sel) {
      const live = s.buildings.find((b) => b.id === sel.id);
      $selection.set(live ? { ...live } : null);
    }
    this.playCues(day.isNight);
    this.queueAnnouncements();
    this.hazardPauses();
    this.flarePauses();
  }

  /** the flare pop-up last seen (the pause-on setting fires once a flare) */
  private flareSeen = -1;
  /** Pause on flare warnings (docs/16 §5.2, §10.4): the full pop-up pauses M
   *  and X by default (all · off in the menu); never once a choice is
   *  remembered or the Builder decides. Test runs (?debug) pause only when
   *  they ask (&flarepause), as for hazards. */
  private flarePauses() {
    const s = this.state;
    const p = $weather.get()?.popup;
    if (!p) return;
    if (this.flareSeen === p.n) return;
    this.flareSeen = p.n;
    const q = new URLSearchParams(location.search);
    if (q.has('debug') && !q.has('flarepause')) return;
    const set = loadSettings().pauseFlares;
    const cls = s.flare.cls ?? shownClass(s);
    const want = p.full && cls !== null && (set === 'all' || (set === 'mx' && cls !== 'C'));
    if (want && !s.paused) {
      this.actions.push({ kind: 'setPaused', paused: true });
      s.flare.pausedAt = s.simTime;
    }
  }

  /** The pop-up's preview of a choice (the slider's positions): pure, from the live state. */
  flarePreview(choice: ArrayChoice): ChoicePreview | null {
    const s = this.state;
    // ahead of a flare ('Arrays: choose now…'): the forecast's worse class
    const cls = shownClass(s) ?? (this.forecastUi.ahead && s.flare.phase === 'idle' ? aheadClass(s) : null);
    if (!s || !cls) return null;
    const site = SITES[s.siteId];
    return previewChoice(s, this.mods, site, currentDay(s, site), choice, cls);
  }

  get forecastAheadOpen() { return this.forecastUi.ahead; }

  /** The Space Weather panel's 'Arrays: choose now…' card opens or closes (docs/16 §10.2). */
  setForecastAhead(open: boolean) {
    if (this.forecastUi.ahead === open) return;
    this.forecastUi.ahead = open;
    this.publish();
  }

  /** A Solar Array's inspector line (docs/16 §10.7): its field, capability, damage, override, wreck. */
  arrayView(id: number) {
    const s = this.state;
    const site = SITES[s.siteId];
    return arrayView(s, site, currentDay(s, site), id);
  }

  /** debug.forceFlare: a flare's telegraph now (the first of a class is still its drill unless opts say). */
  debugForceFlare(cls: FlareClass, o: { drill?: boolean } = {}) {
    const s = this.state;
    if (s.flare.phase !== 'idle') return false;
    migrateFlareSchema(s);
    startFlare(s, SITES[s.siteId], cls, o);
    this.publish();
    return true;
  }

  /** hazards the session has seen (the pause-on settings, docs/14 §3.8) */
  private hazardSeen: { live: Set<number>; clocks: Set<string>; drilled: number; sides: number } | null = null;

  /** Pause on a new hazard (menu setting, on by default), or on every lethal
   *  warning (off by default). Test runs (?debug) pause only when they ask (&hzpause). */
  private hazardPauses() {
    const s = this.state;
    const v = $hazards.get();
    if (!v) return;
    const seen = this.hazardSeen;
    const clocks = new Set(v.active.filter((a) => a.deadly && a.clockLeft !== null).map((a) => `${a.id}`));
    this.hazardSeen = { live: new Set(v.active.map((a) => a.id)), clocks, drilled: s.hazards.drilled.length, sides: s.hazards.liveSides.length };
    if (!seen) return;
    const q = new URLSearchParams(location.search);
    if (q.has('debug') && !q.has('hzpause')) return;
    const set = loadSettings();
    const fresh = v.active.filter((a) => !seen.live.has(a.id));
    const lethal = fresh.some((a) => a.deadly) || [...clocks].some((c) => !seen.clocks.has(c));
    if (!s.paused && ((set.pauseHazards && fresh.length) || (set.pauseLethal && lethal))) {
      this.actions.push({ kind: 'setPaused', paused: true });
      alert(s, `PAUSED — ${fresh[0] ? `${HAZARD_NAME[fresh[0].kind]}: ${fresh[0].targetName}` : 'a lethal warning'} · Space resumes (the menu sets when hazards pause)`, 'info');
    }
  }

  private ringMats = {
    strong: new THREE.LineBasicMaterial({ color: 0xdfe9f5, transparent: true, opacity: 0.7, depthWrite: false }),
    faint: new THREE.LineBasicMaterial({ color: 0xdfe9f5, transparent: true, opacity: 0.34, depthWrite: false }),
  };

  /** Terrain-conforming rings around the revealed deposits. Kinds differ by
   *  pattern (solid, dashed, dotted, double, thin, thin dotted) and by their
   *  DOM glyphs, never by colour. */
  private rebuildDepositOverlay() {
    if (!this.worldGroup) return;
    if (this.depositOverlay) {
      this.worldGroup.remove(this.depositOverlay);
      for (const c of this.depositOverlay.children) (c as THREE.LineSegments).geometry.dispose();
    }
    const strong: number[] = [];
    const faint: number[] = [];
    // `on` segments of ~1.5 m drawn, then `off` skipped, around the ring
    const ring = (out: number[], cx: number, cz: number, r: number, on: number, off: number) => {
      const segs = Math.max(24, Math.round((2 * Math.PI * r) / 1.5));
      const at = (i: number) => {
        const a = (i / segs) * Math.PI * 2;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        return [x, this.hf.sample(x, z) + 0.45, z];
      };
      for (let i = 0; i < segs; i++) {
        if (i % (on + off) >= on) continue;
        out.push(...at(i), ...at(i + 1));
      }
    };
    for (const d of this.hf.deposits) {
      if (!this.revealedIds.has(d.id)) continue;
      switch (DEPOSIT_INFO[d.kind].pattern) {
        case 'solid': ring(strong, d.cx, d.cz, d.r, 1, 0); break;
        case 'dashed': ring(strong, d.cx, d.cz, d.r, 4, 2); break;
        case 'dotted': ring(strong, d.cx, d.cz, d.r, 1, 1); break;
        case 'double': ring(strong, d.cx, d.cz, d.r, 1, 0); ring(strong, d.cx, d.cz, d.r - 2.5, 1, 0); break;
        case 'thin': ring(faint, d.cx, d.cz, d.r, 1, 0); break;
        case 'thinDotted': ring(faint, d.cx, d.cz, d.r, 1, 2); break;
      }
    }
    const group = new THREE.Group();
    for (const [pts, mat] of [[strong, this.ringMats.strong], [faint, this.ringMats.faint]] as const) {
      if (!pts.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
      const lines = new THREE.LineSegments(g, mat);
      lines.renderOrder = 3;
      group.add(lines);
    }
    group.visible = $depositOverlay.get();
    this.depositOverlay = group;
    this.worldGroup.add(group);
  }

  // ─────────────────────────── the Lunar Map ───────────────────────────

  /** The map screen opened or closed (the UI calls this): an unseen tier
   *  expansion takes the view out to the new edge as it opens. */
  setMapOpen(open: boolean) {
    this.lunarUi.open = open;
    this.publish();
  }

  /** The map view the player picked (clamped to what the tier unlocks). */
  setMapView(view: MapView) {
    this.lunarUi.view = view;
    this.publish();
  }

  // ─────────────────────────── persistence ───────────────────────────

  private saveBlob(): SaveBlob {
    const held = this.savePausedAs;
    // the height-delta grid, sparse (docs/17 §11.5); pit zones are rebuilt from it on load
    saveTerrain(this.state, this.hf);
    const base = held === null || missionLost(this.state) ? this.state : { ...this.state, paused: held };
    return {
      state: base.zones?.some((z) => z.kind === 'pit') ? { ...base, zones: base.zones.filter((z) => z.kind !== 'pit') } : base,
      player: {
        mode: this.modes.mode,
        x: this.walk.pos.x, y: this.walk.pos.y, z: this.walk.pos.z,
        yaw: this.walk.yaw, pitch: this.walk.pitch,
      },
      savedAt: Date.now(),
    };
  }

  /** `sync` (touch mode, the page going away): a synchronous copy too, which
   *  outlives a tab the OS kills before the database write lands. */
  async doSave(sync = false) {
    // a lost base is written once, at the moment of loss, and never again
    if (!this.playing || missionLost(this.state)) return;
    await saveGame(this.saveBlob(), sync);
    $hasSave.set(true);
  }

  private async recordLoss() {
    const blob = this.saveBlob();
    await saveGame(blob);
    this.publishSaveSlot(blob);
  }

  /** the title screen's view of the save slot: a lost mission is shown, not continued */
  private publishSaveSlot(blob: SaveBlob | null) {
    const lost = blob !== null && missionLost(blob.state);
    $hasSave.set(blob !== null && !lost);
    const last = lost ? blob.state.deaths?.[blob.state.deaths.length - 1] : undefined;
    $lostMission.set(lost
      ? { siteId: blob.state.siteId, day: Math.floor(blob.state.simTime / CYCLE_S) + 1, ...(last?.hazard ? { cause: deathClause(last.cause) } : {}) }
      : null);
  }

  async continueSave(): Promise<boolean> {
    const blob = await loadGame();
    if (!blob || missionLost(blob.state)) { this.publishSaveSlot(blob); return false; }
    this.loadFrom(blob);
    return true;
  }

  /** Give up this base: the save is erased and the page starts over at site
   *  selection (URL site/expedition shortcuts dropped). */
  async abandonMission() {
    this.playing = false; // no autosave or hide-save may write it back
    await clearSave();
    const url = new URL(location.href);
    url.searchParams.delete('site');
    url.searchParams.delete('exp');
    location.assign(url.toString());
  }

  async newGame(siteId: SiteId, expedition: 'human' | 'robotic' = 'human') {
    await clearSave();
    this.publishSaveSlot(null);
    this.startNew(siteId, expedition);
  }

  private onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.post.setSize(window.innerWidth, window.innerHeight);
  }

  /** Remove a building for the usual refund (½, or all of an untouched site). */
  private demolishBuilding(id: number) {
    const s = this.state;
    const i = s.buildings.findIndex((b) => b.id === id);
    if (i < 0 || s.buildings[i].type === 'lander') return;
    const b = s.buildings[i];
    dropSpur(s, b);
    for (const [rid, amt] of Object.entries(demolishRefund(b, SITES[s.siteId]))) {
      s.resources[rid as keyof typeof s.resources] += amt ?? 0;
    }
    s.buildings.splice(i, 1);
    this.instances.rebuild(s);
    this.walk.colliders = this.instances.colliders(s);
    if ($selection.get()?.id === id) $selection.set(null);
  }

  // ─────────────────────────── the Builder ───────────────────────────

  /** Pick a site and place one auto building (an order's or a rule's). */
  /** Pick a site and place there through the player's own place action (the
   *  same validity, cost, pad, floater — and whatever else a placement does,
   *  like its road). A site the action refuses is skipped for the next best. */
  private placeAuto(type: BuildingId, intent: SiteIntent, automated: boolean): { b: BuildingState; why: string } | string {
    const s = this.state;
    const site = SITES[s.siteId];
    const skip: string[] = [];
    let refused = '';
    for (let n = 0; n < AUTO.placeTries; n++) {
      const pick = chooseSite(s, this.mods, site, this.hf, { type, intent, survey: this.mods.siteSurvey, skip });
      if ('refusal' in pick) return refused ? `${pick.refusal} (the nearer sites: ${refused})` : pick.refusal;
      this.lastPlace = null;
      this.applyAction({ kind: 'place', type, gx: pick.gx, gz: pick.gz, rot: pick.rot, builder: { automated } });
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
  private fillOrder(type: BuildingId, count: number, intent: SiteIntent) {
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
  private resolveBuild(reqs: AutoRequest[]) {
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
      if (req.crisis && this.mods.governor) this.applyAction({ kind: 'buildNext', id: r.b.id });
    }
  }

  /** One economy tick, as the live loop and the debug fast-forward both run it:
   *  the tick, the mods it changed, the Builder's requests, the deposits. */
  private econStep() {
    const launches = this.state.launches;
    const ev = economyTick(this.state, SITES[this.state.siteId], this.mods, 1);
    // Autonomous Cadence fired a volley inside the tick: the rail shows it
    if (this.state.launches > launches) this.life.onLaunch(this.state);
    if (ev.modsChanged) this.mods = modsFor(this.state);
    // a hazard wrecked something (docs/14 §3.10): the world forgets it
    if (ev.wrecked?.length) {
      this.walk.colliders = this.instances.colliders(this.state);
      if (ev.wrecked.includes($selection.get()?.id ?? -1)) $selection.set(null);
    }
    if (ev.build.length) this.resolveBuild(ev.build);
    this.syncDeposits(true);
    return ev;
  }

  // ─────────────────────────── debug hooks ───────────────────────────

  /** Every pit and its derived numbers, the grid encoded, the rebuild queue (docs/17 §21). */
  debugPits() {
    const s = this.state;
    const delta = encodeDelta(this.hf.delta);
    let nonzero = 0, cut = 0, heap = 0;
    for (let k = 0; k < this.hf.delta.length; k++) {
      const d = this.hf.delta[k];
      if (!d) continue;
      nonzero++;
      if (d < 0) cut -= d * 1.6; else heap += d * 1.6;
    }
    return {
      pits: pitsView(s, this.hf), rev: s.terrain?.rev ?? 0, clock: s.terrain?.clock ?? 0,
      delta, bytes: delta.length, nonzero, cutM3: cut, heapM3: heap, queue: this.chunks.queueInfo(),
    };
  }

  /** One grid sample: height now, the generated surface, the delta (dm), locks. */
  debugSample(ix: number, iz: number) {
    const k = iz * 257 + ix;
    return { h: this.hf.h[k], base: this.hf.base[k], delta: this.hf.delta[k], pad: this.hf.padMask[k], skirt: this.hf.skirt[k] };
  }

  /** Site Grading's check at (gx, gz), as the ghost runs it. */
  debugCheckGrade(gx: number, gz: number) { return checkGrade(this.state, this.hf, gx, gz); }

  /** Relief (m) over a sample rect, as the placement check reads it. */
  debugRelief(gx0: number, gz0: number, gx1: number, gz1: number) { return this.hf.maxDelta(gx0, gz0, gx1, gz1); }

  /** A hash of every height and delta sample (save and reload must reproduce it bit for bit). */
  debugTerrainHash(): string {
    const bits = new Uint32Array(this.hf.h.buffer, this.hf.h.byteOffset, this.hf.h.length);
    let a = 0x811c9dc5, b = 0x01000193;
    for (let i = 0; i < bits.length; i++) {
      a = Math.imul(a ^ bits[i], 0x01000193) >>> 0;
      b = Math.imul(b ^ (this.hf.delta[i] & 0xffff), 0x85ebca6b) >>> 0;
    }
    return `${a.toString(16)}:${b.toString(16)}`;
  }

  /** `tonnes` dug at world (x, z), into that ground's pit (the tests' shortcut: hub units dig their target's pit, core/hubs.ts `dug`). */
  debugPitDig(x: number, z: number, tonnes: number, q = 1) {
    onDig(this.state, digSiteKey(x, z), tonnes, q);
  }

  debugPlace(type: BuildingId, gx: number, gz: number, rot: 0 | 1 | 2 | 3 = 0): boolean {
    const chk = checkPlacement(this.state, SITES[this.state.siteId], this.hf, this.mods.unlocked, type, gx, gz, rot,
      this.mods.surveyTier);
    if (!chk.valid) return false;
    this.commitPlace(type, gx, gz, rot, false);
    this.publish();
    return true;
  }

  /** run one frame of play as if `realDt` wall-seconds had passed (no render) */
  debugFrame(realDt: number) {
    if (this.playing) this.step(realDt);
  }

  private travelMemo = { key: '', s: Infinity };
  /** The ghost's ETA (docs/15 §6): how long the nearest free rover would
   *  take, from where it is, to where the placement's road leaves the
   *  network (its door or service cell when it needs none). Once a second. */
  private placeTravel(p: { type: BuildingId | 'grade'; gx: number; gz: number; rot: 0 | 1 | 2 | 3; road?: number[] }): number {
    if (p.type === 'grade') return Infinity;
    const s = this.state;
    const key = `${p.type},${p.gx},${p.gz},${p.rot}|${s.roadRev ?? 0}|${Math.floor(s.simTime)}`;
    if (key === this.travelMemo.key) return this.travelMemo.s;
    const probe = { type: p.type, gx: p.gx, gz: p.gz, rot: p.rot };
    const to = p.road?.length ? joinCell(s, p.road[0]) : accessCell(s, probe);
    const night = currentDay(s, SITES[s.siteId]).isNight;
    const t = freeReach(s, this.mods, night, to, centerOf(probe));
    this.travelMemo = { key, s: t };
    return t;
  }

  /** every trip ends as it starts (core/transit.ts TRANSIT.instant); on, the ones under way end now */
  debugInstantTravel(on: boolean) {
    TRANSIT.instant = on;
    if (on) {
      for (const r of this.state.rovers ?? []) {
        const t = r.trip;
        if (!t || t.stuck) continue;
        t.t = t.dur;
        [r.x, r.z] = t.pts[t.pts.length - 1];
      }
    }
    this.publish();
  }

  debugCompleteTech(id: TechId) {
    if (!TECHS[id] || this.state.techsDone.includes(id)) return;
    this.state.techsDone.push(id);
    onTechComplete(this.state, id);
    this.mods = refreshDerived(this.state);
    this.syncDeposits(true);
    this.publish();
  }

  debugAdvance(gameSeconds: number) {
    // apply anything the UI/debug API queued this frame before ticking
    const acts = this.actions.drain();
    for (const a of acts) this.applyAction(a);
    let victory = false;
    let defeat = false;
    // as in play: the clock moves first and the tick reads the second it
    // closes, shading follows the sun (every 5 game-seconds, the live loop's
    // cadence at 10×), and a lost base never ticks again
    for (let i = 0; i < gameSeconds && !missionLost(this.state); i++) {
      if (i % 5 === 0) this.updateShading();
      this.state.simTime += 1;
      const ev = this.econStep();
      if (ev.victory && !this.state.victoryShown) {
        this.state.victoryShown = true;
        victory = true;
      }
      if (ev.defeat && !this.state.defeatShown) {
        this.state.defeatShown = true;
        defeat = true;
      }
    }
    if (gameSeconds > 0 || acts.length) {
      // the ground the pits cut while no frame showed it: every changed chunk, once
      this.takeTerrain();
      this.chunks.flushQueue();
      this.instances.rebuild(this.state);
      this.publish();
    }
    if (victory) $victory.set(true);
    if (defeat) {
      $defeat.set(true);
      void this.recordLoss();
    }
  }

  setModeInstant(m: 'build' | 'walk') {
    if (m === 'walk' && this.modes.mode !== 'walk') {
      const t = this.buildCam.target;
      this.walk.spawnAt(t.x, t.z, 0);
    }
    this.modes.set(m);
  }

  /** Frame the camera deterministically (screenshots / probes). In walk mode
   *  the astronaut stands at pos (x, z) and faces the target. */
  debugSetView(pos: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }) {
    if (this.modes.mode === 'walk') {
      this.walk.spawnAt(pos.x, pos.z, 0);
      const eyeY = this.walk.pos.y + EYE_HEIGHT;
      const dx = target.x - pos.x, dz = target.z - pos.z;
      this.walk.yaw = Math.atan2(-dx, -dz);
      this.walk.pitch = Math.atan2(target.y - eyeY, Math.hypot(dx, dz));
      this.walk.applyToCamera(this.camera);
      return;
    }
    this.buildCam.view(pos, target);
  }

  /** Render-path state for tests and probes. */
  debugRenderInfo() {
    const gl = this.renderer.getContext();
    return {
      /** 'classic' (the default) or 'detailed' (High detail) */
      style: this.opts.style,
      /** the last drawn frame, summed over every pass */
      frame: { ...this.frameStats },
      /** texture types of the render targets bound so far; any float or half-float? */
      targets: {
        types: [...this.targetTypes].sort(),
        float: [...this.targetTypes].some((t) => t === THREE.FloatType || t === THREE.HalfFloatType),
      },
      context: {
        antialias: gl.getContextAttributes()?.antialias ?? false,
        samples: gl.getParameter(gl.SAMPLES) as number,
        pixelRatio: this.renderer.getPixelRatio(),
        toneMapping: this.renderer.toneMapping,
        shadowMap: this.renderer.shadowMap.enabled,
      },
      fxLevel: this.post.fxLevel,
      /** the ladder level stored for the next launch (a raise on trial is not) */
      fxStored: this.post.storedLevel,
      postChain: this.post.chainBuilt,
      safeMode: this.safeMode,
      /** scene renders and drawn frames so far (renders per frame = passes over the scene) */
      sceneRenders: this.sceneRenders,
      framesDrawn: this.framesDrawn,
      probes: { ...this.probes },
      /** the render path the very first frame drew with */
      firstFrame: this.firstFrame,
      shadowTexel: this.lighting.shadowTexel,
      shadowRenders: this.lighting.shadowRenders,
      patches: materials.variants(),
      patchFault: materials.patchesFaulted,
      buildingMaterials: this.instances.materialTypes(),
      terrainMaterial: this.chunks.materialType,
      terrain: this.chunks.info(),
      horizonMaterial: (this.horizon.mesh.material as THREE.Material).type,
      horizonSeam: this.horizon.seamError(),
      rocks: this.rocks.stats(),
      sky: this.sky.info(),
      base: { ...this.instances.renderInfo(), sunDir: this.lighting.sunDirection.toArray() },
      life: this.life.info(),
      lens: { fov: this.camera.fov, near: this.camera.near },
      headlamp: this.lighting.headlamp.intensity,
    };
  }

  /** Build-camera pose and its clearance over the ground (tests, probes). */
  /** CSS-pixel position of the ground at world (x, z) — `lift` m above it —
   *  under the live camera. */
  debugScreenOf(x: number, z: number, lift = 0) {
    return this.screenOf(x, this.hf.sample(x, z) + lift, z);
  }

  /** The terrain mesh's vertex colour nearest (x, z) (tests). */
  debugTerrainColor(x: number, z: number) {
    return this.chunks.colorAt(x, z);
  }

  /** The drawn ground against hf.sample (tests, probes). */
  debugTerrainError() {
    return this.chunks.surfaceError();
  }

  /** A structure's per-instance light: glow level and powered flag (tests). */
  debugBuildingGlow(id: number) {
    return this.instances.glowOf(id);
  }

  debugCamera() {
    const t = this.buildCam.target, p = this.camera.position;
    return {
      pos: { x: p.x, y: p.y, z: p.z },
      target: { x: t.x, y: t.y, z: t.z },
      targetGround: this.groundAnywhere(t.x, t.z),
      clearance: this.buildCam.clearance,
      dist: p.distanceTo(t),
      azimuth: Math.atan2(p.z - t.z, p.x - t.x),
      fov: this.camera.fov,
      /** the classic isometric view's steps (null in High detail) */
      iso: this.buildCam instanceof IsoCam ? this.buildCam.info() : null,
    };
  }

  /** Rocks still standing with centres in a world rect (tests, probes). */
  debugRocksIn(x0: number, z0: number, x1: number, z1: number): number {
    return this.rocks.countIn(x0, z0, x1, z1);
  }

  /** Select a building as a click would (tests). */
  /** Hide the terrain so a screenshot masks the buildings (probe pixel stats).
   *  The black-frame sentinel is held off meanwhile — a terrain-less frame is
   *  mostly black sky by construction. */
  debugSetTerrainVisible(v: boolean) {
    this.chunks.group.visible = v;
    this.probeHeld = !v;
    this.nextProbe = v ? this.playFrames + 40 : Number.POSITIVE_INFINITY;
  }

  /** Run the black-frame check on the next drawn frame, even while hidden
   *  terrain holds it off: with the terrain hidden this is a silent terrain
   *  program failure, as the probe sees it (tests). */
  debugProbeNext() {
    this.nextProbe = this.playFrames + 1;
  }

  get walkController() { return this.walk; }
  /** settled in command view: not walking, not flying between the two */
  get commandView() { return this.modes.mode === 'build' && !this.modes.transitioning; }
  get iceDepositList() { return this.hf.iceDeposits; }

  debugCheckPlace(type: BuildingId, gx: number, gz: number, rot: 0 | 1 | 2 | 3 = 0) {
    return checkPlacement(this.state, SITES[this.state.siteId], this.hf, this.mods.unlocked, type, gx, gz, rot,
      this.mods.surveyTier);
  }

  debugDeposits() { return depositsView(this.state, this.hf.deposits, this.mods.surveyTier); }
  /** the Builder's chooser as a dry run: where it would put one (no state change) */
  debugPlanSite(type: BuildingId, intent: SiteIntent = {}) {
    return chooseSite(this.state, this.mods, SITES[this.state.siteId], this.hf, { type, intent, survey: this.mods.siteSurvey });
  }
  debugAutomation() { return automationView(this.state, this.mods); }
  /** the $fleet payload, fresh */
  debugFleet() {
    const tier = this.mods.surveyTier;
    return fleetView(this.state, this.mods, SITES[this.state.siteId], this.hf.deposits, (d) => depositRevealed(this.state, d, tier));
  }
  /** Where a rover or an excavator is drawn, on screen (CSS px) and in the world. */
  debugPoseOnScreen(kind: 'rover' | 'digger' | 'unit', id: number) {
    const p = kind === 'rover' ? this.life.rovers.pose(id) : this.life.haulers.pose(kind === 'unit' ? UNIT_VID + id : id);
    if (!p) return null;
    return { ...this.screenOf(p.x, p.y + (kind === 'rover' ? 0.8 : 1.5), p.z), wx: p.x, wz: p.z };
  }
  /** the targeting mode on now (null = none), as the hint shows it */
  debugFleetTarget() { return { mode: this.fleetTarget.modeInfo, hint: $fleetTarget.get() }; }
  debugLunar() { return lunarView(this.state, this.mods, this.lunarUi); }
  debugDepositAt(x: number, z: number) { return this.hf.depositAt(x, z); }
  /** every deposit struck, as if surveyed on foot */
  debugRevealAll() {
    for (const d of this.hf.deposits) if (!this.state.survey.struck.includes(d.id)) this.state.survey.struck.push(d.id);
    this.syncDeposits(false);
    this.publish();
  }
  // ── hazards (docs/14 §3) ──
  debugHazards() { return hazardView(this.state, this.mods); }
  debugForceHazard(kind: HazardId, target?: number, opts: { drill?: boolean; tier?: Tier } = {}) {
    const r = forceHazard(this.state, this.mods, SITES[this.state.siteId], kind, target, opts);
    this.publish();
    return typeof r === 'string' ? r : r.id;
  }
  /** the next window in `seconds` (and the scheduler started); with `id`, that live hazard's clock ends in `seconds` */
  debugHazardClock(seconds: number, id?: number) {
    const hz = this.state.hazards;
    if (id !== undefined) {
      const h = hz.live.find((x) => x.id === id);
      if (!h) return false;
      if (h.phase === 'telegraph') h.at = this.state.simTime + seconds;
      else h.clockAt = this.state.simTime + seconds;
    } else {
      hz.era3At = Math.min(hz.era3At ?? this.state.simTime, this.state.simTime - 720);
      hz.graceUntil = Math.min(hz.graceUntil, this.state.simTime);
      hz.nextAt = this.state.simTime + seconds;
      hz.lastStartAt = -1e9;
    }
    this.publish();
    return true;
  }
  debugHoldHazards(on: boolean) { this.state.hazards.hold = on; }

  debugForceOutposts(n: number) {
    forceOutposts(this.state, n);
    this.mods = modsFor(this.state);
    this.publish();
  }
}

/** 'Habitat #7 decompressed' → the title line's clause. */
function deathClause(cause: string): string {
  return cause.replace(/^./, (c) => c.toUpperCase());
}

/** The lost-mission screen's story (docs/14 §3.10): the last death and its
 *  missed warning, and the ones before it. */
function lossStory(s: GameState): { lead: string; warning: string; earlier: string } | null {
  const deaths = s.deaths ?? [];
  const last = deaths[deaths.length - 1];
  if (!last || !s.defeatShown) return null;
  const day = (t: number) => Math.floor(t / CYCLE_S) + 1;
  const warned = last.warnedAt !== null ? `The warning came ${fmtClock(Math.max(0, last.at - last.warnedAt))} before; nobody answered it in time.` : '';
  const before = deaths.slice(0, -1);
  const groups = new Map<string, { n: number; day: number }>();
  for (const d of before) {
    const k = d.cause;
    const g = groups.get(k) ?? { n: 0, day: day(d.at) };
    g.n++;
    groups.set(k, g);
  }
  const earlier = [...groups].map(([cause, g]) => `${g.n} crew — ${cause} (day ${g.day})`).join(' · ');
  return {
    lead: `The base fell silent. The last settler died: ${last.cause}.`,
    warning: warned,
    earlier: earlier ? `Earlier: ${earlier}` : '',
  };
}
