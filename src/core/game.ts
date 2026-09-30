/** The orchestrator: owns the player's base (a `BaseSim`, core/baseSim.ts: the GameState, its mods and its ground), the
 *  Three.js world, input, the render/sim loops, store publishing, and save/load. The sim mutates; this class drains what
 *  the sim did (its `out` mailbox) into the world and publishes. */
import * as THREE from 'three';
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { SITES, type SiteId } from '../data/sites';
import { TECHS, type TechId } from '../data/techs';
import { MILESTONES, milestoneHint } from '../data/milestones';
import { RESOURCES, type ResourceId } from '../data/resources';
import { ALERTS, AUTOSAVE_S, CREW, CYCLE_S, SPEEDS } from '../data/balance';
import { DEPOSIT_INFO } from '../data/deposits';
import { TIER_VIEW, type MapView } from '../data/lunarMap';
import { BaseSim, PLAYER_MODE, ANY_SELECTION, type SimMode } from './baseSim';
import { missionDay, missionDayAt, type AlertMsg, type GameState } from './state';
import { canToggleCrew, effectiveDef, effectiveRates, waterReclaimFactor } from './mods';
import { ActionQueue } from './actions';
import {
  boardingShortfall, currentDay, refreshDerived, alert, logStampOf, missionLost, orderDelayS, settlersWelcome, type Mods,
  volleyTerms,
} from './economy';
import { modsFor } from './mods';
import { automationView, type SiteIntent } from './automation';
import { chooseSite } from './siting';
import { AUTO } from '../data/automation';
import { cancel, onTechComplete, researchView, destinyOf } from './research';
import { fmtClock } from './daynight';
import { depositRevealed, depositsView, forceOutposts, lunarView, type LunarUi } from './exploration';
import { crewParts } from './fleet';
import { TRANSIT, freeReach, siteTransit } from './transit';
import { TRAFFIC, trafficInfo, trafficStats } from './traffic';
import { accessCell, joinCell, keyCell } from './roads';
import { UNIT_VID, isHubType } from '../data/hubs';
import { ghostBlock, hubLight, type HubLight, type LightSource } from './hubPreview';
import { DepositHighlight, PitMarks } from '../world/depositHighlight';
import { ROAD } from '../data/roads';
import { digSiteKey, onDig, pitsView } from './pits';
import { encodeDelta, takeCarved } from '../terrain/pitCarve';
import { lookInfo } from '../terrain/pitLook';
import { fleetView } from './fleetView';
import { forceHazard, hazardView } from './hazards';
import { arrayView, migrateFlareSchema, previewChoice, shownClass, startFlare, weatherView, type ChoicePreview } from './spaceWeather';
import type { ArrayChoice, FlareClass } from '../data/spaceWeather';
import { aheadClass, withForecast } from './forecast';
import { HAZARD_NAME, type HazardId, type Tier } from '../data/hazards';
import { FleetTarget, type Mode as FleetMode } from '../player/fleetTarget';
import { RoadTool } from '../player/roadTool';
import { GradeTool } from '../player/gradeTool';
import { GradeMarks } from '../world/gradeMarks';
import { cancelGrade, finishNow, gradePlan, gradeView } from './grading';
import { Heightfield } from '../terrain/heightfield';
import { TerrainChunks } from '../terrain/chunks';
import { Horizon } from '../terrain/horizon';
import { Rocks } from '../terrain/rocks';
import { BuildingInstances, centerOf } from '../buildings/instances';
import { BuildingDarkness } from '../buildings/darkness';
import { PlacementController, buildCost, checkGrade, checkPlacement, type PlaceableType } from '../buildings/placement';
import { BaseOverlays } from '../buildings/overlays';
import { createRenderer, createCamera, drawFrame, probeGround } from '../world/renderer';
import { CelLighting, sunStep } from '../world/celLighting';
import { ramp } from '../world/celStyle';
import { installCel } from '../world/cel';
import { CEL_MARKER } from '../buildings/celBuilding';
import { INK_MARKER, breakInk, inkFaulted, inkInfo, outlineList, setInkEnabled, setInkVariant } from '../world/ink';
import { BaseLife } from '../world/life';
import { leanFrom } from '../buildings/look';
import { materials } from '../world/materials';
import { IsoCam, commandKey } from '../player/isoCam';
import { TouchControls, type TouchHost } from '../player/touch';
import { saveGame, loadGame, clearSave, type SaveBlob } from './save';
import { loadSettings, saveSettings, RESUME_KEY } from './settings';
import { autoTouch, type TouchChoice } from './touch';
import { sfx } from '../audio/sfx';
import {
  modalUp, $alerts, $autoMarkers, $automation, $caps, $counts, $defeat, $depositMarkers, $depositOverlay, $deposits, $depositSel,
  $feed, $hasSave, $ice, $lander, $lostMission, $lunar, $menuOpen, $milestones, $phase, $placeFlash, $placing, $power, $rates,
  $resourcePanel, $resources, $research, $selection, $siteId, $swarm, $tech, $time, $victory, $vitals, $wearMarkers, overlayUp,
  spawnFloater, $announce, type Announcement, $fleet, $fleetTarget, $roverSel, $unitSel, $log, $fieldCards, type FieldCard,
  $destiny, $hazards, $hazardMarkers, $lossStory, $weather, $hubCard, $hubLight, $touchInfo, type DepositView, type HubLightView,
} from '../ui/stores';

export interface GameOptions {
  /** safe render mode from the very first frame (?safe, or the stored setting) */
  safe: boolean;
  seed: number;
  /** touch mode (core/touch.ts): gestures on the world, saves on every hide */
  touch?: boolean;
}

/** What the menu shows about the render path. */
export interface RenderStatus {
  /** leaving safe mode waits for its black-frame check */
  checking: boolean;
  safe: boolean;
  /** safe mode came from the black-frame check, not the player */
  safeAuto: boolean;
}

/** frame the home view at this distance (the isometric view frames it by its own zoom) */
const HOME_DIST = 90;

/** game-seconds of bank runway below which the hum starts to sag */
const GRID_RUNWAY_S = 180;

/** keys that toggle or jump: a held key fires them once, not at the OS
 *  repeat rate (camera keys keep repeating) */
const TOGGLE_KEYS = new Set([
  'Space', 'KeyT', 'KeyM', 'KeyI', 'Tab', 'Escape', 'Digit1', 'Digit2', 'Digit3', 'KeyF', 'KeyH', 'Home',
]);

export class Game {
  /** the player's base: the sim (core/baseSim.ts) owns the state, the mods and the ground; this class owns the world, the input and the UI */
  sim!: BaseSim;
  get state(): GameState { return this.sim?.state; }
  get mods(): Mods { return this.sim?.mods; }
  private get hf(): Heightfield { return this.sim.hf; }
  readonly actions = new ActionQueue();
  /** set while the menu holds the sim paused: saves record this paused
   *  state (the game as the player left it), not the menu's pause */
  savePausedAs: boolean | null = null;

  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private scene = new THREE.Scene();
  private lighting: CelLighting;
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
  /** the command view: the fixed isometric camera */
  private buildCam: IsoCam;
  /** Send to… / Dig at… (player/fleetTarget.ts) */
  private fleetTarget!: FleetTarget;
  /** the road tool (player/roadTool.ts) */
  private roadTool!: RoadTool;
  /** the grading tool (player/gradeTool.ts, docs/19 S5) and what marks its jobs on the ground */
  private gradeTool!: GradeTool;
  private gradeMarks!: GradeMarks;
  /** debug: a placement's road is laid open (tests that time builds, not roads); it outlasts a new game, as the sim's mode is rebuilt from it */
  private openRoads = false;
  get debugOpenRoads() { return this.openRoads; }
  set debugOpenRoads(on: boolean) {
    this.openRoads = on;
    if (this.sim) this.sim.mode.openRoads = on;
  }
  /** touch mode's gesture recognizer (player/touch.ts); null on desktop */
  private touchCtl: TouchControls | null = null;
  /** touch: the road tool's Remove toggle (Alt-drag on desktop) */
  roadRemove = false;

  private playing = false;
  private econAcc = 0;
  private autosaveAcc = 0;
  private mouse = new THREE.Vector2();      // NDC
  private mousePx = { x: 0, y: 0 };
  private downPos = { x: 0, y: 0 };
  private raycaster = new THREE.Raycaster();
  private lastT = performance.now();
  private worldGroup: THREE.Group | null = null;
  /** revealed deposits' rings ([I]); rebuilt when the revealed set changes */
  private depositOverlay: THREE.Group | null = null;
  private revealedIds = new Set<string>();
  /** the sim's `revealedRev` the rings were last drawn at */
  private revealedRev = -1;
  private markerSig = '';
  /** the resource highlight (docs/17 §6): a hub ghost's, a selected hub's or a hub card's lit deposits */
  private highlight: DepositHighlight | null = null;
  /** the pits in an end state: a flag and a dashed ring each, always on (docs/19 S2b) */
  private pitMarks: PitMarks | null = null;
  private light: HubLight | null = null;
  private lightKey = '';
  private lightClock = 0;
  /** $deposits as the last publish made it, before the highlight is merged in */
  private depBase: DepositView[] = [];
  private depLitSig: string | null = null;
  /** the lit ids the base overlay leaves to the highlight, and whether it fades the rest */
  private overlayLit = '';
  /** Lunar Map screen bookkeeping (the view shown, the tier last seen) */
  private lunarUi: LunarUi = { open: false, view: 'site', seenTier: 0 };
  /** the Space Weather panel's 'Arrays: choose now…' card is open (docs/16 §10.2): its previews are built only then */
  private forecastUi: { ahead: boolean } = { ahead: false };

  constructor(private canvas: HTMLCanvasElement, readonly opts: GameOptions) {
    // the cel program and its palette reach every mesh creator before the
    // first mesh exists
    this.renderer = createRenderer(canvas);
    installCel();
    this.camera = createCamera();
    this.lighting = new CelLighting(this.scene);
    // a program that fails to compile is reported here (replacing three's
    // console dump); the response waits until the frame has finished
    this.renderer.debug.onShaderError = (gl, program, vs, fs) => {
      const log = (s: WebGLShader) => gl.getShaderInfoLog(s)?.trim() ?? '';
      console.error(`THREE.WebGLProgram: Shader Error — ${gl.getProgramInfoLog(program)?.trim() ?? ''}\n` +
        `vertex: ${log(vs)}\nfragment: ${log(fs)}`);
      const src = (m: string) => [vs, fs].some((s) => gl.getShaderSource(s)?.includes(m));
      // the cel building program's own fault outranks any other; the ink
      // outline program's is the cheapest of all (hide the outlines), so any
      // other program's fault (safe mode, which hides them too) outranks it
      if (src(CEL_MARKER)) this.shaderFault = 'cel';
      else if (src(INK_MARKER)) this.shaderFault ??= 'ink';
      else if (this.shaderFault !== 'cel') this.shaderFault = 'other';
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
    this.buildCam = new IsoCam(this.camera, canvas);
    this.buildCam.enabled = false;
    this.bindInput();
    if (opts.touch) this.bindTouch();
    window.addEventListener('resize', () => this.onResize());
    $depositOverlay.subscribe(() => this.showOverlay());
    // safe mode (the player's, or the render check's from an earlier launch)
    // holds from the very first frame
    if (opts.safe) this.enableSafeMode(false, false);
    requestAnimationFrame((t) => this.frame(t));
    void loadGame().then((blob) => this.publishSaveSlot(blob));
  }

  // ─────────────────────────── lifecycle ───────────────────────────

  /** how the player's base runs (core/baseSim.ts): the usual mode, plus the debug flags that outlast a new game */
  private playerMode(): SimMode {
    return { ...PLAYER_MODE, openRoads: this.openRoads };
  }

  startNew(siteId: SiteId, expedition: 'human' | 'robotic' = 'human') {
    // the Lander pre-placed at the map heart with its pad, rovers and drone, and the TOUCHDOWN alert
    const sim = BaseSim.create({ siteId, seed: this.opts.seed, expedition, mode: this.playerMode() });
    this.bootWorld(sim);
    this.drain(true);
    this.homeCamera(false);
    this.introPending = true;
    this.publish();
  }

  loadFrom(blob: SaveBlob) {
    // every migration, the regenerated ground with the pits' deltas and the flattens replayed on it
    const sim = BaseSim.fromState(blob.state, this.playerMode());
    this.bootWorld(sim);
    // (the world was built over the finished ground: the chunks need no rebuild, only the rocks and the horizon the flattens touch)
    this.drain(true);
    this.chunks.clearQueue();
    if (sim.carvedOnLoad) this.rocks.clearPits(0, 0, 255, 255);
    this.homeCamera(false);
    // the view the player left (turn, tilt, zoom); an older save has none and keeps the default
    if (blob.camera) this.buildCam.setPreset(blob.camera);
    this.publish();
    if (missionLost(this.state)) $defeat.set(true);
  }

  /** The world over a sim: its ground, buildings and life. The sim half (mods, heightfield, binds) is `BaseSim`'s constructor. */
  private bootWorld(sim: BaseSim) {
    const state = sim.state;
    this.sim = sim;
    $unitSel.set(null);
    this.alertClock.clear();
    if (this.worldGroup) this.scene.remove(this.worldGroup);
    this.chunks = new TerrainChunks(this.hf);
    this.horizon = new Horizon(this.hf);
    this.rocks = new Rocks(this.hf);
    this.darkness = new BuildingDarkness(this.hf);
    this.instances = new BuildingInstances(this.hf, this.darkness);
    this.lighting.setSite(SITES[state.siteId]);
    this.placement = new PlacementController(this.scene, this.hf, SITES[state.siteId]);
    // a hub ghost's own warning (a water plant with no ice in reach), asked once like the rest
    this.placement.extraWarn = (p) => (p.type !== 'grade' && isHubType(p.type)
      ? ghostBlock(this.state, this.mods, SITES[this.state.siteId], p as { type: BuildingId; gx: number; gz: number; rot: 0 | 1 | 2 | 3 }).warn : '');
    this.overlays = new BaseOverlays(this.hf);
    this.life = new BaseLife(this.hf);
    this.instances.panelDust = (b) => this.life.panelDust(b);
    // an excavator away from its pad is drawn by the haulers, not the pad instance
    this.life.haulers.onAway = (ids) => this.instances.setHidden(ids);
    this.life.haulers.darkOf = (id) => this.instances.darkness.of(id);
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
      holdCamera: (on) => { this.buildCam.enabled = !on; },
    }, this.scene);
    this.gradeTool?.cancel();
    this.gradeTool = new GradeTool({
      state: () => this.state, mods: () => this.mods, hf: this.hf,
      ray: () => { this.raycaster.setFromCamera(this.mouse, this.camera); return this.raycaster.ray; },
      push: (a) => this.actions.push(a),
      holdCamera: (on) => { this.buildCam.enabled = !on; },
    }, this.scene);
    this.gradeMarks = new GradeMarks(this.hf);
    $roverSel.set(null);
    this.worldGroup = new THREE.Group();
    this.highlight?.dispose();
    this.highlight = new DepositHighlight(this.hf);
    this.pitMarks?.dispose();
    this.pitMarks = new PitMarks(this.hf);
    this.light = null;
    this.lightKey = '';
    this.overlayLit = '';
    this.depLitSig = null;
    $hubLight.set(null);
    this.worldGroup.add(this.chunks.group, this.horizon.mesh, this.rocks.group, this.instances.group,
      this.overlays.group, this.life.group, this.fleetTarget.group, this.highlight.group, this.pitMarks.group,
      this.gradeMarks.group);
    for (const c of this.depositOverlay?.children ?? []) (c as THREE.LineSegments).geometry.dispose();
    this.depositOverlay = null;
    this.revealedIds = new Set();
    this.revealedRev = -1;
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
    this.buildCam.groundAt = this.groundAnywhere;
    this.buildCam.enabled = true;
    this.playing = true;
    this.playFrames = 0; // sentinel probes count from gameplay start
    this.nextProbe = 40;
    if (this.safeMode) {
      this.safeMode = false; // fresh world = fresh materials; re-apply
      this.enableSafeMode(this.safeAuto, false);
    }
    this.cueSeen = null;
    this.announceSeen = null;
    this.announceDrilled = null;
    this.hazardSeen = null;
    this.fieldSeen = null;
    this.logRef = null;
    $announce.set([]);
    $fieldCards.set([]);
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
    });
    this.canvas.addEventListener('mousedown', (e) => {
      this.downPos = { x: e.clientX, y: e.clientY };
      if (e.button === 0 && this.roadTool?.active) this.roadTool.down(e.altKey);
      if (e.button === 0 && this.gradeTool?.active) { this.gradeTool.update(); this.gradeTool.down(); }
    });
    this.canvas.addEventListener('mouseup', (e) => {
      if (!this.playing) return;
      // the road tool takes the left button's drags and clicks
      if (this.roadTool?.active) {
        if (e.button === 0) this.roadTool.up();
        if (e.button === 2 && Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y) <= 5) this.roadTool.cancel();
        return;
      }
      // the grading tool takes them too: a drag is a box, a click the 16 m square
      if (this.gradeTool?.active) {
        if (e.button === 0) this.gradeTool.up();
        if (e.button === 2 && Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y) <= 5) this.gradeTool.cancel();
        return;
      }
      const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
      if (moved > 5) return; // drag = camera, not click
      if (e.button === 0) this.onWorldClick(e.shiftKey);
      if (e.button === 2 && this.placement.active) this.cancelPlacement();
      if (e.button === 2 && this.fleetTarget.active) this.fleetTarget.cancel();
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
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
          // Tab is inert: no focus walk onto the HUD, where a Space would press a button
          e.preventDefault();
          break;
        case 'Space':
          // Space never presses a focused HUD button: it pauses
          e.preventDefault();
          this.actions.push({ kind: 'setPaused', paused: !this.state.paused });
          break;
        case 'Digit1': this.chooseSpeed(SPEEDS[0]); break;
        case 'Digit2': this.chooseSpeed(SPEEDS[1]); break;
        case 'Digit3': this.chooseSpeed(SPEEDS[2]); break;
        case 'KeyR': if (this.placement.active) this.placement.rotate(); break;
        case 'KeyN': if (this.roadTool.active) this.roadTool.cancel(); else this.beginRoadTool(); break;
        case 'KeyI': $depositOverlay.set(!$depositOverlay.get()); break;
        case 'KeyB':
          // the Builder: orders and standing rules (one panel at a time, like the resource panels)
          $resourcePanel.set($resourcePanel.get() === 'builder' ? null : 'builder');
          break;
        case 'KeyG':
          // the Hazards panel (docs/14 §3.8): risks, counters, the network
          $resourcePanel.set($resourcePanel.get() === 'hazards' ? null : 'hazards');
          break;
        case 'Backspace':
          // drawing a road: the last waypoint back
          if (this.roadTool.active) { e.preventDefault(); this.roadTool.undo(); }
          break;
        case 'Enter': case 'NumpadEnter':
          // drawing a road: lay it through its waypoints (docs/19 S3)
          if (this.roadTool.active) { e.preventDefault(); this.roadTool.commit(); break; }
          // while placing: let the rovers choose the site for this one
          if (this.placement.active && this.placement.probe && this.placement.probe.type !== 'grade') {
            e.preventDefault();
            this.actions.push({ kind: 'order', type: this.placement.probe.type, count: 1 });
            if (!e.shiftKey) this.cancelPlacement();
          }
          break;
        case 'KeyE':
          // E orbits with Q
          e.preventDefault();
          this.buildCam.keyDown(e.code);
          break;
        case 'Escape':
          // one thing at a time: placement, the inspector, a resource panel —
          // and with nothing left to cancel, the menu
          if (this.roadTool.active) this.roadTool.cancel();
          else if (this.gradeTool.active) this.gradeTool.cancel();
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
          if (!sel && rover === null && unit === null) break;
          const at = sel ? this.life.haulers.pose(sel.id) : unit !== null ? this.life.haulers.pose(UNIT_VID + unit) : this.life.rovers.pose(rover!);
          const [x, z] = at ? [at.x, at.z] : sel ? centerOf(sel) : [0, 0];
          this.buildCam.focus(x, this.hf.sample(x, z), z, 60);
          break;
        }
        case 'KeyH':
        case 'Home':
          this.homeCamera(true);
          break;
        default:
          if (commandKey(e.code)) {
            e.preventDefault();
            this.buildCam.keyDown(e.code);
          }
      }
    });
    window.addEventListener('keyup', (e) => {
      this.buildCam.keyUp(e.code);
    });
    window.addEventListener('blur', () => {
      this.buildCam.clearKeys();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.playing) void this.doSave(!!this.opts.touch);
    });
    // a victory or defeat overlay takes the screen: nothing half-placed underneath
    const overlayShown = (up: boolean) => { if (up && this.playing) this.cancelPlacement(); };
    $victory.subscribe(overlayShown);
    $defeat.subscribe(overlayShown);
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
    this.cancelPlacement();
    this.roadTool.cancel();
    this.gradeTool.cancel();
    this.fleetTarget.begin(mode);
  }

  cancelFleetTarget() { this.fleetTarget?.cancel(); }

  /** A speed button or key 1/2/3: set the speed and, when the game is paused, resume. The
   *  core `setSpeed` action stays a plain set (a test holds the pause and sets a speed). No
   *  resume under a victory or defeat overlay or an era or hazard banner: those wait for their
   *  own Continue. */
  chooseSpeed(speed: number) {
    this.actions.push({ kind: 'setSpeed', speed });
    if (this.state?.paused && !missionLost(this.state) && !modalUp()) this.actions.push({ kind: 'setPaused', paused: false });
  }

  /** The road tool (N, the palette's ROAD button). */
  beginRoadTool() {
    this.cancelPlacement();
    this.fleetTarget.cancel();
    this.gradeTool.cancel();
    $selection.set(null);
    this.roadTool.begin();
  }
  cancelRoadTool() { this.roadTool?.cancel(); }
  /** ✓ Lay on the touch bar (Enter): the road through its waypoints */
  commitRoad() { this.roadTool?.commit(); }
  debugRoadTool() { return this.roadTool.info(); }

  /** The grading tool (the palette's GRADE button, docs/19 S5): drag a box, the rovers level it. Every site has it from landing. */
  beginGradeTool() {
    this.cancelPlacement();
    this.fleetTarget.cancel();
    this.roadTool.cancel();
    $selection.set(null);
    this.gradeTool.begin();
  }
  cancelGradeTool() { this.gradeTool?.cancel(); }
  debugGradeTool() { return this.gradeTool.info(); }
  /** Cancel a queued grading job: the cells not yet levelled refund their energy. */
  cancelGradeJob(id: number) { this.actions.push({ kind: 'cancelGrade', id }); }

  beginPlacement(type: PlaceableType) {
    // the old click-a-square placement is the grading tool now (its click is the 16 m square)
    if (type === 'grade') { this.beginGradeTool(); return; }
    this.fleetTarget.cancel();
    this.roadTool.cancel();
    this.gradeTool.cancel();
    $selection.set(null);
    $roverSel.set(null);
    this.placement.begin(type, this.state.techsDone);
    // where you dig is a production decision: a hub's ghost lights its ground
    // (docs/17 §6.1: updateHubLight, which shows the rings whatever [I] says)
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
      ready: () => this.playing && !overlayUp() && !$menuOpen.get(),
      mode: () => (this.placement?.active ? 'place' : this.roadTool?.active || this.gradeTool?.active ? 'road'
        : this.fleetTarget?.active ? 'target' : 'select'),
      tap: (x, y) => this.touchTap(x, y),
      longPress: (x, y) => this.touchLongPress(x, y),
      pan: (dx, dy) => this.buildCam.panPx(dx, dy, true),
      pinch: (phase, scale) => this.buildCam.pinch(phase, scale),
      twist: (rad) => this.buildCam.twist(rad),
      twistReset: () => this.buildCam.twistReset(),
      ghostDrag: (dx, dy) => this.pointAt(this.mousePx.x + dx, this.mousePx.y + dy),
      roadDown: (x, y) => {
        this.pointAt(x, y);
        if (this.gradeTool.active) { this.gradeTool.update(); this.gradeTool.down(); return; }
        this.roadTool.update(); this.roadTool.down(this.roadRemove);
      },
      roadMove: (x, y) => this.pointAt(x, y),
      roadUp: (x, y) => {
        this.pointAt(x, y);
        if (this.gradeTool.active) { this.gradeTool.update(); this.gradeTool.up(); return; }
        this.roadTool.update(); this.roadTool.up();
      },
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
    if (this.gradeTool.active) {
      // a tap: the 16 m square there
      this.gradeTool.update();
      this.gradeTool.down();
      this.gradeTool.up();
      return;
    }
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
    if (this.placement.active || this.roadTool.active || this.gradeTool.active || this.fleetTarget.active) return;
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
    if (this.placement?.active && this.playing) this.onWorldClick(keep);
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
    if (this.playing) this.buildCam.turnStep(dir);
  }

  /** ▱ (and V's flip in the isometric view): tilt the command view, low ↔ high. */
  tiltView() {
    if (this.commandView) this.buildCam.tiltStep();
  }

  /** H: glide home to the Lander. F: glide to the selection. */
  cameraHome() {
    if (this.playing) this.homeCamera(true);
  }
  focusSelection() {
    const sel = $selection.get();
    const rover = $roverSel.get();
    if (!this.playing || (!sel && rover === null)) return;
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
    this.pitMarks?.set(this.state.pits ?? []);
    this.overlayClock += dt;
    if (this.overlayOwed && this.overlayClock >= 1) {
      this.overlayOwed = false;
      this.overlayClock = 0;
      if (this.depositOverlay) this.rebuildDepositOverlay();
      this.highlight?.redrape();
      this.pitMarks?.redrape();
    }
  }

  /** The boxes the pits carved since the last look: their chunks queued, their rocks cleared. */
  private takeTerrain() {
    // ground the rovers levelled (core/grading.ts): the chunks it touches rebuild, the rocks on it go
    const lv = this.hf.leveled;
    if (lv.length) {
      for (let i = 0; i < lv.length; i += 4) {
        this.chunks.markDirty(lv[i], lv[i + 1], lv[i + 2], lv[i + 3]);
        this.onFlattened(lv[i], lv[i + 1], lv[i + 2], lv[i + 3]);
      }
      lv.length = 0;
      this.overlayOwed = true;
    }
    if (!this.hf.carved.length) return;
    takeCarved(this.hf, (gx0, gz0, gx1, gz1) => {
      this.chunks.markDirty(gx0, gz0, gx1, gz1);
      this.rocks.clearPits(gx0, gz0, gx1, gz1);
    });
    this.overlayOwed = true;
  }

  /** Cells [x0..x1) × [z0..z1) were flattened: clear the rocks off them and
   *  keep the horizon's shared edge in step with the grid. */
  private onFlattened(x0: number, z0: number, x1: number, z1: number) {
    this.rocks.clearRect(x0, z0, x1, z1);
    this.horizon.onFlatten(x0, z0, x1, z1);
  }

  /** The mailbox the sim wrote (core/baseSim.ts `SimOut`) shown in the world, then emptied: the ground it levelled, the
   *  buildings redrawn, the volleys on the rail, the selection a wreck cleared, the sound and floating price of a placement.
   *  `built`: the world was just made over the finished ground, so its chunks need no rebuild.
   *  Called after the frame's actions and again after its economy ticks, where the world lines it replaces used to stand. */
  private drain(built = false) {
    const sim = this.sim;
    const out = sim.out;
    if (out.flattened.length) {
      for (const r of out.flattened) {
        if (!built) this.chunks.rebuildAround(r.x0, r.z0, r.x1, r.z1);
        this.onFlattened(r.x0, r.z0, r.x1, r.z1);
      }
      out.flattened.length = 0;
    }
    if (out.buildings) {
      out.buildings = false;
      this.instances.rebuild(sim.state);
    }
    for (let i = 0; i < out.launches; i++) this.life.onLaunch(sim.state);
    out.launches = 0;
    if (out.wrecked.length) {
      const sel = $selection.get()?.id ?? -1;
      if (out.wrecked.includes(ANY_SELECTION) || out.wrecked.includes(sel)) $selection.set(null);
      out.wrecked.length = 0;
    }
    if (out.placed.length) {
      const site = SITES[sim.state.siteId];
      for (const b of out.placed) {
        sfx.play('place');
        // the price floats up from the pad it was paid for
        const [cx, cz] = centerOf(b);
        const at = this.screenOf(cx, this.hf.sample(cx, cz) + BUILDINGS[b.type].height * 0.6, cz);
        const text = Object.entries(buildCost(b.type, site)).filter(([, n]) => (n ?? 0) > 0)
          .map(([rid, n]) => `−${n}${RESOURCES[rid as ResourceId].glyph}`).join(' ');
        if (at.visible && text) spawnFloater(text, at.x, at.y);
      }
      out.placed.length = 0;
    }
    this.syncDepositsWorld();
  }

  /** The deposit rings follow what the sim has revealed: drawn again when its set moved (a strike, a mast, a tech, a load). */
  private syncDepositsWorld() {
    const sim = this.sim;
    if (this.depositOverlay && this.revealedRev === sim.revealedRev) return;
    this.revealedRev = sim.revealedRev;
    this.revealedIds = new Set(sim.revealedIds);
    this.rebuildDepositOverlay();
  }

  /** open the inspector on a building (null closes it) */
  select(id: number | null) {
    const b = id === null ? undefined : this.state.buildings.find((x) => x.id === id);
    if (b) { $roverSel.set(null); $unitSel.set(null); }
    $selection.set(b ? { ...b } : null);
  }

  // ─────────────────────────── actions ───────────────────────────

  /** Every grading job with its progress, the box tool's state and the marks on the ground (debug). */
  debugGrading() {
    const s = this.state;
    return {
      jobs: gradeView(s, this.mods).map((v) => ({ ...v, job: s.gradeJobs?.find((j) => j.id === v.id) })),
      tool: this.gradeTool.info(), marks: this.gradeMarks.info(), next: s.nextGradeJob ?? 1,
    };
  }

  /** What a box would be (debug): the plan without its per-cell arrays. */
  debugPlanGrade(gx0: number, gz0: number, gx1: number, gz1: number) {
    const p = gradePlan(this.state, this.hf, this.mods, [gx0, gz0, gx1, gz1]);
    const { cellSecs, order, ...rest } = p;
    return { ...rest, first: order.length ? keyCell(order[0]) : null, last: order.length ? keyCell(order[order.length - 1]) : null,
      minCell: cellSecs.length ? Math.min(...cellSecs) : 0, maxCell: cellSecs.length ? Math.max(...cellSecs) : 0 };
  }

  /** Level what is left of grading job `id` (every job without one) at once (the debug API). */
  debugFinishGrading(id?: number) {
    const s = this.state;
    for (const j of [...(s.gradeJobs ?? [])]) if (id === undefined || j.id === id) finishNow(s, this.hf, j);
    this.takeTerrain();
    this.chunks.flushQueue();
    this.publish();
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
  private safeAuto = false;
  /** the player left safe mode: back to it if the lit frame comes out black */
  private safeTrial = false;
  /** full-screen opaque screens over the world: the tech tree */
  private techOpen = false;
  private framesDrawn = 0;
  /** the render path the very first frame drew with */
  private firstFrame: { safe: boolean } | null = null;
  /** scene render errors already reported (each is reported once) */
  private sceneFaults = new Set<string>();
  /** alert id → real time (ms) it was last raised, as seen by this session */
  private alertClock = new Map<number, { t: number; count: number }>();
  private playFrames = 0;      // frames since gameplay (not page load) began
  private nextProbe = 40;      // next black-frame probe, in playFrames
  private probeHeld = false;   // debug: terrain hidden, the check waits for an explicit probe
  /** black-frame probe verdicts so far (tests, probes) */
  private probes = { ok: 0, black: 0, unknown: 0 };
  private safeMode = false;
  /** a shader program that failed to compile this frame: the cel building
   *  program (its fallback is stock Lambert), the ink outline program (its
   *  fallback is no outlines) or any other (safe mode). */
  private shaderFault: 'cel' | 'ink' | 'other' | null = null;
  /** the last drawn frame's totals */
  private frameStats = { calls: 0, triangles: 0, points: 0, lines: 0 };

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
    this.firstFrame ??= { safe: this.safeMode };
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
    const drawn = !covered && this.drawScene();
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
    if (drawn && this.playFrames >= this.nextProbe) this.probeFrame();
  }

  /** Forward-render the scene to the canvas. A throw skips the frame and is
   *  reported once, so one bad frame never stops the loop. */
  private drawScene(): boolean {
    const fault = drawFrame(this.renderer, this.scene, this.camera);
    if (fault === null) return true;
    if (!this.sceneFaults.has(fault)) {
      this.sceneFaults.add(fault);
      if (this.state) { alert(this.state, `RENDER — a frame failed to draw (${fault})`, 'warn'); this.publish(); }
    }
    return false;
  }

  /** Black-screen sentinel: some drivers fail shaders silently instead of
   *  throwing. The frame just drawn is read wherever the ground cannot
   *  legitimately be black — under a risen sun, at night (the earthshine key
   *  holds open ground well off black), and at any hour in safe mode (unlit).
   *  Dusk and dawn and views with too little ground are inconclusive:
   *  checked again soon. A black frame switches safe mode on; in safe mode it
   *  can do no more. */
  private probeFrame() {
    const day = currentDay(this.state, SITES[this.state.siteId]);
    const readable = this.safeMode || this.lighting.sunLight >= 0.75 || day.nightFactor >= 0.9;
    const verdict = readable ? probeGround(this.renderer, (u, v) => this.groundAt(u, v)) : 'unknown';
    this.probes[verdict]++;
    if (verdict === 'unknown') {
      this.nextProbe = this.playFrames + 120;
    } else if (verdict === 'ok') {
      this.renderVerified();
      this.nextProbe = this.playFrames + 900;      // healthy — routine re-check
    } else {
      this.nextProbe = this.playFrames + 40;       // verify quickly
      this.renderFailed('black frame detected');
    }
    if (this.probeHeld) this.nextProbe = Number.POSITIVE_INFINITY;
  }

  /** A probe passed: leaving safe mode is kept. */
  private renderVerified() {
    if (this.safeMode) return;
    if (this.safeTrial) {
      this.safeTrial = false;
      saveSettings({ safe: false });
    }
  }

  /** The frame is black, or a program failed to compile: safe mode. */
  private renderFailed(_reason: string) {
    if (this.safeMode) {
      // nothing simpler to fall back to than safe mode itself
      this.nextProbe = this.playFrames + 900;
      return;
    }
    // leaving safe mode did not draw: straight back to it
    this.safeTrial = false;
    this.enableSafeMode();
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

  /** A shader failed to compile this frame. The cel programs (the buildings'
   *  and the ground's) are the likely culprits and the cheapest to lose:
   *  stock Lambert in the same palette takes their place (the ramp, the glow
   *  and the print reveal go). The ink outlines' program failing only hides
   *  the outlines. Any other program means safe mode. */
  private recoverFromShaderFault() {
    const fault = this.shaderFault;
    this.shaderFault = null;
    if (fault === 'cel' && materials.replaceCustom(this.scene)) {
      console.warn('[MOONSHOTS] Cel shader failed to compile — stock Lambert.');
      if (this.state) { alert(this.state, 'RENDER — building lights disabled (GPU limitation), plain materials', 'warn'); this.publish(); }
      return;
    }
    if (fault === 'ink') {
      inkFaulted();
      console.warn('[MOONSHOTS] Ink outline shader failed to compile — no outlines.');
      if (this.state) { alert(this.state, 'RENDER — outlines disabled (GPU limitation)', 'warn'); this.publish(); }
      return;
    }
    this.renderFailed('shader compile error');
  }

  /** Last-resort rendering: unlit vertex-color materials — the plain forward
   *  path on anything that can draw a triangle, including meshes created
   *  later, which take their material from the registry. `auto`: the render
   *  check turned it on (and says so), not the player. `persist`: remember it
   *  for the next launch (not for a boot flag or a re-apply). */
  enableSafeMode(auto = true, persist = true) {
    if (this.safeMode) return;
    this.safeMode = true;
    this.safeAuto = auto;
    this.safeTrial = false;
    console.warn('[MOONSHOTS] Safe render mode enabled — simplified materials, no effects.');
    materials.enableSafe(this.scene);
    setInkEnabled(false); // no custom programs in safe mode: no outlines
    this.rocks?.setSafe(true);
    if (persist) saveSettings({ safe: true });
    if (this.state && auto) {
      alert(this.state, 'SAFE RENDER MODE — simplified visuals (GPU issue detected)', 'warn');
      this.publish();
    }
    this.reprobe();
  }

  /** Lit rendering again — only ever on the player's word — as a checked
   *  step: kept (in settings) once a probe passes, and straight back to safe
   *  mode if the frame comes out black. */
  disableSafeMode() {
    if (!this.safeMode) return;
    this.safeMode = false;
    this.safeAuto = false;
    this.safeTrial = true;
    console.warn('[MOONSHOTS] Safe render mode off — lit materials.');
    materials.disableSafe(this.scene);
    setInkEnabled(true);
    this.rocks?.setSafe(false);
    this.reprobe(2);
  }

  get safeModeOn(): boolean { return this.safeMode; }

  /** The tech tree covers the world (the UI calls this). */
  setTechOpen(open: boolean) {
    this.techOpen = open;
  }

  renderStatus(): RenderStatus {
    return { checking: !this.safeMode && this.safeTrial, safe: this.safeMode, safeAuto: this.safeAuto };
  }

  /** Hold the black-frame sentinel off (a test of what only a probe sees). */
  /** the ink outlines' program fails to compile on the next frame (tests) */
  debugBreakInk() { breakInk(); }

  /** the bake-off's variant for the outlines, over the constant (screenshots, tests) */
  debugSetInkVariant(v: 'A' | 'B' | 'C' | null) { setInkVariant(v); }

  debugHoldProbe(on: boolean) {
    this.probeHeld = on;
    this.nextProbe = on ? Number.POSITIVE_INFINITY : this.playFrames + 40;
  }

  /** check `frames` from now (unless a probe is holding the check off) */
  private reprobe(frames = 40) {
    if (this.playing && Number.isFinite(this.nextProbe)) {
      this.nextProbe = Math.min(this.nextProbe, this.playFrames + frames);
    }
  }

  /** One frame of play. Camera and effects step at most 0.1 s,
   *  but game time takes up to 0.5 s of it, so a slow GPU still runs the clock
   *  at full speed (the tick loop's guard bounds the catch-up). */
  private step(realDt: number) {
    this.tick(Math.min(realDt, 0.1), Math.min(realDt, 0.5));
  }

  private tick(dt: number, simDt: number) {
    // actions first, every frame, so the UI feels immediate
    const acts = this.actions.drain();
    const counts = acts.length ? new Map(this.state.alerts.map((a) => [a.id, a.count])) : null;
    for (const a of acts) this.sim.apply(a);
    this.drain();
    if (counts) this.cueRefusals(counts);

    this.buildCam.update(dt);
    if (this.fleetTarget.active) this.fleetTarget.update();
    if (this.roadTool.active) this.roadTool.update();
    if (this.gradeTool.active) this.gradeTool.update();
    this.gradeMarks.update(this.state);
    if (this.placement.active) {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      this.placement.update(this.state, this.mods.unlocked,
        this.raycaster.ray.origin, this.raycaster.ray.direction, this.mods.surveyTier);
      const p = this.placement.probe!;
      const block = p.valid && p.type !== 'grade' && isHubType(p.type)
        ? ghostBlock(this.state, this.mods, SITES[this.state.siteId], p as { type: BuildingId; gx: number; gz: number; rot: 0 | 1 | 2 | 3 }) : null;
      // a hub ghost also shows the haul road its units would take on from the network (dashed)
      this.placement.haulPreview.show(block?.road?.length ? block.road : undefined, false, true);
      $placing.set({
        type: p.type, valid: p.valid, reason: p.reason, warn: p.warn, note: p.note, confirm: p.confirm,
        road: p.road?.length, roadS: p.roadS, offM: p.offM, travelS: p.valid && p.type !== 'grade' ? this.placeTravel(p) : undefined,
        hub: block?.headline || undefined, hubBlock: block?.lines.length ? block.lines : undefined,
      });
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
        // (the clock moved by this frame's own share above: the whole seconds run the economy step only)
        const ev = this.sim.econStep();
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
        this.sim.out.buildings = true;
        this.drain();
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
        margin: this.gridMargin(),
        night: currentDay(this.state, SITES[this.state.siteId]).nightFactor > 0.5,
      });
      this.cueDestiny();
    }
    this.updateHubLight(dt);
    this.updateDepositMarkers();

    // the sun follows the clock
    const day = currentDay(this.state, SITES[this.state.siteId]);
    this.lighting.setSun(day.sunElev, day.sunAzim, day.nightFactor);
    this.camera.updateMatrixWorld();
    // the isometric view stands hundreds of metres off: small rocks round its
    // focus, and none once they would be specks
    this.rocks.update(this.camera, this.buildCam.distance <= 350 ? this.buildCam.target : null);
    this.syncTerrain(dt);
    // the sun step grows with game speed: the solar wings turn once per step
    const step = sunStep(this.state.paused ? 1 : this.state.speed);
    // the lights fade on wall time (up to 0.5 s a frame, as the clock runs), so
    // a slow GPU does not stretch a one-second fade over many seconds.
    // Wherever a structure stands dark it carries its own light: window glow
    // and flood pools at its darkness (instances.ts)
    this.darkness.update(simDt, day.nightFactor, day.sunElev, this.lighting.sunLight);
    this.instances.update(dt, day.nightFactor, this.lighting.sunDirection, step);
    this.overlays.update(this.state, this.placement.probe, this.placement.ghost?.visible ?? false,
      $selection.get());
    this.life.update({
      dt, paused: this.state.paused, speed: this.state.speed, state: this.state, camera: this.camera,
      sunDir: this.lighting.sunDirection, sunLight: this.lighting.sunLight,
      tickFrac: this.econAcc,
    });
    this.life.rovers.selected = $roverSel.get();
    sfx.setRovers(this.life.rovers.sounds(this.camera, this.buildCam.target));

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
  private cueDestiny() {
    const d = $destiny.get();
    sfx.setDestiny(leanFrom(d.c, d.a, d.band));
    const at = this.buildCam.target;
    const lift = 0.3 * this.camera.position.distanceTo(at);
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
      // a flare's warning has its own cue (the pop-up's, docs/19 S7)
      else if (a.kind === 'warn' && was === undefined && a.family !== 'weather') warn = fresh(a.key, 30_000) || warn;
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
    if (!this.playing) { if ($autoMarkers.get().length) $autoMarkers.set([]); return; }
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
    if (!this.playing || !ms.length) { if ($hazardMarkers.get().length) $hazardMarkers.set([]); return; }
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
    if (!this.playing) { $wearMarkers.set([]); return; }
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
   *  leads (build mode, overlay on); the atom changes only when they move.
   *  With a hub's highlight up (docs/17 §6.1) only its lit and dimmer
   *  deposits are labelled — trip, faces, pit — and its plain pits and the
   *  ghost's stake join them, overlay on or off. */
  private updateDepositMarkers() {
    const light = this.light;
    if (!this.playing || (!$depositOverlay.get() && !light)) {
      if (this.markerSig) { this.markerSig = ''; $depositMarkers.set([]); }
      return;
    }
    const v = new THREE.Vector3();
    const out: { id: string; x: number; y: number; glyph: string; label: string; lead: boolean; lit?: string; pit?: boolean }[] = [];
    const put = (m: Omit<(typeof out)[number], 'x' | 'y'>, x: number, z: number) => {
      v.set(x, this.hf.sample(x, z) + 2.5, z).project(this.camera);
      if (v.z > 1 || v.x < -1 || v.x > 1 || v.y < -1 || v.y > 1) return;
      out.push({
        ...m,
        x: Math.round((v.x * 0.5 + 0.5) * window.innerWidth),
        y: Math.round((-v.y * 0.5 + 0.5) * window.innerHeight),
      });
    };
    for (const d of $deposits.get()) {
      // a hub's highlight labels only its own kinds
      if (light && !d.lit) continue;
      const at = d.revealed ? { x: d.x, z: d.z } : d.lead;
      if (!at) continue;
      put({
        id: d.id, glyph: d.glyph, label: d.lit ? d.lit.label : d.label, lead: !d.revealed,
        lit: d.lit ? `${d.lit.tier} ${d.lit.state}${d.lit.best ? ' best' : ''}` : '',
      }, at.x, at.z);
    }
    for (const e of light?.entries ?? []) {
      if (e.state !== 'plain' && e.state !== 'stake') continue;
      put({ id: e.id, glyph: e.glyph, label: e.label, lead: false, lit: `lit ${e.state}${e.best ? ' best' : ''}`, pit: true },
        e.pit?.cx ?? e.cx, e.pit?.cz ?? e.cz);
    }
    const sig = out.map((m) => `${m.id}${m.x},${m.y}${m.glyph}${m.label}${m.lit ?? ''}`).join('|');
    if (sig === this.markerSig) return;
    this.markerSig = sig;
    $depositMarkers.set(out);
  }

  // ─────────────────────────── the resource highlight (docs/17 §5–§6) ───────────────────────────

  /** What lights: a hub's ghost, else a selected hub, else a hub's palette
   *  card (hover, or the touch info card). Build mode only. */
  private lightSource(): LightSource | null {
    if (!this.playing) return null;
    const p = this.placement?.active ? this.placement.probe : null;
    if (p) return p.type !== 'grade' && isHubType(p.type) ? { kind: 'ghost', type: p.type, gx: p.gx, gz: p.gz, rot: p.rot } : null;
    const sel = $selection.get();
    if (sel && isHubType(sel.type)) return { kind: 'selected', id: sel.id };
    const card = $hubCard.get() ?? $touchInfo.get()?.type ?? null;
    if (card && isHubType(card)) return { kind: 'card', type: card };
    return null;
  }

  /** The highlight follows its source: at once when the ghost moves a cell
   *  or the source changes, else at most four times a second (trips, faces
   *  and pits move with the sim). The base rings leave the lit ones to it and
   *  fade to 30%; $deposits and $hubLight carry it to the labels and the map. */
  private updateHubLight(dt: number) {
    const src = this.lightSource();
    this.lightClock += dt;
    let key = '';
    if (src) {
      const who = src.kind === 'ghost' ? `g${src.type},${src.gx},${src.gz},${src.rot}` : src.kind === 'selected' ? `s${src.id}` : `c${src.type}`;
      key = `${who}|${Math.floor(this.lightClock * 4)}`;
    }
    if (key === this.lightKey) return;
    this.lightKey = key;
    const site = SITES[this.state.siteId];
    const light = !src ? null
      : src.kind === 'ghost' ? ghostBlock(this.state, this.mods, site, src).light
      : hubLight(this.state, this.mods, site, src);
    this.light = light && light.entries.length ? light : null;
    this.highlight?.set(this.light);
    const lit = this.light ? this.light.entries.map((e) => e.id).sort().join(',') + '|' : '';
    if (lit !== this.overlayLit) {
      this.overlayLit = lit;
      if (this.depositOverlay) this.rebuildDepositOverlay();
    }
    this.showOverlay();
    const L = this.light;
    const view: HubLightView | null = L ? {
      type: L.type, source: L.source, hubId: L.hubId, reachS: L.reachS, mre: L.mre,
      extra: L.entries.filter((e) => e.state === 'plain' || e.state === 'stake').map((e) => ({
        id: e.id, x: e.pit?.cx ?? e.cx, z: e.pit?.cz ?? e.cz, r: e.r, fullR: e.fullR, state: e.state as 'plain' | 'stake',
        label: e.label, pitR: e.pit?.R ?? null,
      })),
    } : null;
    const prev = $hubLight.get();
    if (JSON.stringify(prev) !== JSON.stringify(view)) $hubLight.set(view);
    this.publishLit();
  }

  /** $deposits: the last publish's, with the highlight's lit states in (docs/17 §6.1). */
  private publishLit() {
    const L = this.light;
    const sig = L ? `${L.sig}#${L.labelSig}` : '';
    if (sig === this.depLitSig) return;
    this.depLitSig = sig;
    const byId = new Map((L?.entries ?? []).filter((e) => e.state !== 'plain' && e.state !== 'stake').map((e) => [e.id, e]));
    if (!byId.size) { $deposits.set(this.depBase); return; }
    $deposits.set(this.depBase.map((d) => {
      const e = byId.get(d.id);
      if (!e) return d;
      return {
        ...d,
        lit: {
          tier: e.tier, state: e.state, eta: e.eta, approx: e.approx, faces: e.faces, used: e.used,
          pitR: e.pit?.R ?? null, ...(e.pit ? { pitX: e.pit.cx, pitZ: e.pit.cz } : {}), fullR: e.fullR, best: e.best, label: e.label,
          ...(e.reserves?.left !== undefined ? { ore: { left: e.reserves.left, ...(e.reserves.precision ? { precision: e.reserves.precision } : {}) } } : {}),
          ...(e.reserves?.cutQ !== undefined ? { grade: e.reserves.cutQ } : {}),
        },
      };
    }));
  }

  /** The base rings show with the overlay on [I], and whenever a hub's highlight is up. */
  private showOverlay() {
    if (this.depositOverlay) this.depositOverlay.visible = $depositOverlay.get() || !!this.light;
  }

  /** The pits' flags and rings as drawn (tests). */
  debugPitMarks() {
    return this.pitMarks?.info() ?? null;
  }

  /** The highlight as drawn (tests). */
  debugHighlight() {
    return { drawn: this.highlight?.info() ?? null, light: this.light };
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
      if (b.enabled) upkeep += effectiveRates(b.type, this.mods, site, b, { feed: s.feed, waterReclaim: waterReclaimFactor(s, this.mods) }).upkeepPartsPerDay / CYCLE_S;
    }
    const ls = s.crew * this.mods.inputMult.habitat;
    const waterReclaim = waterReclaimFactor(s, this.mods);
    $vitals.set({
      crew: s.crew, housing: s.housingActive ?? 0, beds, morale: Math.round(s.morale), data: s.data,
      botsFree: (s.bots?.total ?? 0) - (s.bots?.busy ?? 0), botsTotal: s.bots?.total ?? 0,
      expedition: s.expedition ?? 'human',
      boardingHold: settlersWelcome(s) ? boardingShortfall(s, this.mods.inputMult.habitat, waterReclaim) : '',
      lifeSupport: { oxygen: ls * CREW.oxygenPerCrew, food: ls * CREW.foodPerCrew, water: ls * CREW.waterPerCrew * waterReclaim },
      waterReclaim,
      sites, welding, weldParts, upkeep,
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
      phaseLeft: day.phaseLeft, missionDay: missionDay(s), landedAt: s.landedAt ?? 0,
      speed: s.speed, paused: s.paused, flare: s.flare.phase, flareTimer: Math.ceil(s.flare.timer),
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
    this.publishLog();
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
    this.depBase = depositsView(s, this.hf.deposits, this.mods.surveyTier);
    this.depLitSig = null;
    this.publishLit();
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

  /** the newest log id the dispatch card has seen (null: take the baseline, as a loaded world does) */
  private fieldSeen: number | null = null;
  /** the log array $log last copied, and the stamp it copied at */
  private logRef: GameState['log'] | null = null;
  private logStampSeen = -1;

  /** The notification log to the UI, and each new field report to the dispatch card
   *  (ui/notifyUi.ts). A loaded world takes only the baseline; test runs (?debug) draw
   *  no card unless they ask (&tips), as for the discovery cards. */
  private publishLog() {
    const s = this.state;
    const log = (s.log ??= []);
    const stamp = logStampOf(s).n;
    if (this.logRef !== log || this.logStampSeen !== stamp) {
      this.logRef = log;
      this.logStampSeen = stamp;
      $log.set([...log]);
    }
    const last = log.length ? log[log.length - 1].id : 0;
    if (this.fieldSeen === null) { this.fieldSeen = last; return; }
    const seen = this.fieldSeen;
    this.fieldSeen = last;
    const fresh: FieldCard[] = [];
    for (let i = log.length - 1; i >= 0 && log[i].id > seen; i--) {
      const e = log[i];
      if (e.family === 'field' && e.report) fresh.unshift({ id: e.id, text: e.text, report: e.report, action: e.action });
    }
    if (!fresh.length) return;
    sfx.play('chirp');
    const q = new URLSearchParams(location.search);
    if (q.has('debug') && !q.has('tips')) return;
    $fieldCards.set([...$fieldCards.get(), ...fresh].slice(-5));
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
    sfx.play('flare');
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
      alert(s, `PAUSED — ${fresh[0] ? `${HAZARD_NAME[fresh[0].kind]}: ${fresh[0].targetName}` : 'a lethal warning'} · Space or a speed resumes (the menu sets when hazards pause)`, 'info');
    }
  }

  private ringMats = {
    strong: new THREE.LineBasicMaterial({ color: 0xdfe9f5, transparent: true, opacity: 0.7, depthWrite: false }),
    faint: new THREE.LineBasicMaterial({ color: 0xdfe9f5, transparent: true, opacity: 0.34, depthWrite: false }),
    // a hub's highlight is up: the kinds it does not want, at 30% (docs/17 §6.1)
    strongFaded: new THREE.LineBasicMaterial({ color: 0xdfe9f5, transparent: true, opacity: 0.7 * 0.3, depthWrite: false }),
    faintFaded: new THREE.LineBasicMaterial({ color: 0xdfe9f5, transparent: true, opacity: 0.34 * 0.3, depthWrite: false }),
  };

  /** Terrain-conforming rings around the revealed deposits. Kinds differ by
   *  pattern (solid, dashed, dotted, double, thin, thin dotted) and by their
   *  DOM glyphs, never by colour. With a hub's highlight up, its lit and
   *  dimmer deposits are the highlight's to draw (world/depositHighlight.ts),
   *  and the rest fade to 30%. */
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
    const lit = new Set(this.light?.entries.map((e) => e.id) ?? []);
    for (const d of this.hf.deposits) {
      if (!this.revealedIds.has(d.id) || lit.has(d.id)) continue;
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
    const fade = !!this.light;
    for (const [pts, mat] of [
      [strong, fade ? this.ringMats.strongFaded : this.ringMats.strong], [faint, fade ? this.ringMats.faintFaded : this.ringMats.faint],
    ] as const) {
      if (!pts.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
      const lines = new THREE.LineSegments(g, mat);
      lines.renderOrder = 3;
      group.add(lines);
    }
    group.visible = $depositOverlay.get() || fade;
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
    return {
      state: this.sim.saveState(this.savePausedAs),
      camera: this.buildCam.preset(),
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
      ? { siteId: blob.state.siteId, day: missionDay(blob.state), ...(last?.hazard ? { cause: deathClause(last.cause) } : {}) }
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
  debugCheckGrade(gx: number, gz: number) { return checkGrade(this.state, this.hf, gx, gz, this.mods); }

  /** Relief (m) over a sample rect, as the placement check reads it. */
  debugRelief(gx0: number, gz0: number, gx1: number, gz1: number) { return this.hf.maxDelta(gx0, gz0, gx1, gz1); }

  /** A hash of every height and delta sample (save and reload must reproduce it bit for bit). */
  debugTerrainHash(): string {
    return this.hf.terrainHash();
  }

  /** `tonnes` dug at world (x, z), into that ground's pit (the tests' shortcut: hub units dig their target's pit, core/hubs.ts `dug`). */
  debugPitDig(x: number, z: number, tonnes: number, q = 1) {
    onDig(this.state, digSiteKey(x, z), tonnes, q);
  }

  debugPlace(type: BuildingId, gx: number, gz: number, rot: 0 | 1 | 2 | 3 = 0): boolean {
    const chk = checkPlacement(this.state, SITES[this.state.siteId], this.hf, this.mods.unlocked, type, gx, gz, rot,
      this.mods.surveyTier);
    if (!chk.valid) return false;
    this.sim.commitPlace(type, gx, gz, rot, false);
    this.drain();
    this.publish();
    return true;
  }

  /** Tests: a deterministic clock. Pauses, sets the game clock to `at` and clears the tick accumulator, so two page loads
   *  that ran a different number of frames before this call start the same game-second (the live loop leaves a fractional
   *  second that depends on load). Meant for the moment right after boot, before the base has anything stamped with a time. */
  debugSettleClock(at = 90) {
    this.state.paused = true;
    this.state.simTime = at;
    this.econAcc = 0;
    this.publish();
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
    TRAFFIC.bypass = on;
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

  /** the sim's reservations off (true: units drive through each other, as before docs/19 S4a) or on */
  debugTrafficBypass(on: boolean) { TRAFFIC.bypass = on; }

  /** who holds which road cell, and the sim's traffic counters (core/traffic.ts) */
  debugTraffic() { return trafficInfo(this.state); }

  debugCompleteTech(id: TechId) {
    if (!TECHS[id] || this.state.techsDone.includes(id)) return;
    this.state.techsDone.push(id);
    onTechComplete(this.state, id);
    this.sim.mods = refreshDerived(this.state);
    this.sim.syncDeposits(true);
    this.drain();
    this.publish();
  }

  debugAdvance(gameSeconds: number) {
    // apply anything the UI/debug API queued this frame before ticking
    const acts = this.actions.drain();
    for (const a of acts) this.sim.apply(a);
    this.drain();
    let victory = false;
    let defeat = false;
    // as in play: the clock moves first and the tick reads the second it
    // closes, shading follows the sun (every 5 game-seconds, the live loop's
    // cadence at 10×), and a lost base never ticks again
    for (let i = 0; i < gameSeconds && !missionLost(this.state); i++) {
      if (i % 5 === 0) this.updateShading();
      const ev = this.sim.tick();
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
      this.sim.out.buildings = true;
      this.drain();
      this.publish();
    }
    if (victory) $victory.set(true);
    if (defeat) {
      $defeat.set(true);
      void this.recordLoss();
    }
  }

  /** Frame the camera deterministically (screenshots / probes). */
  debugSetView(pos: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }) {
    this.buildCam.view(pos, target);
  }

  /** Render-path state for tests and probes. `style` is 'cel' (the one
   *  renderer); `outlines` is S1b's ink pass, `ramp` the variant's step count. */
  debugRenderInfo() {
    const gl = this.renderer.getContext();
    const iso = this.buildCam.info();
    return {
      style: 'cel' as const,
      safe: this.safeMode,
      drawCalls: this.frameStats.calls,
      triangles: this.frameStats.triangles,
      camera: { rot: iso.rot, tilt: iso.tilt, zoom: iso.zoom },
      /** ink outline meshes drawing this frame (0 in safe mode or after a fault); `ink` has the detail */
      outlines: inkInfo().drawn,
      ink: { ...inkInfo(), list: outlineList() },
      ramp: ramp().steps,
      /** the last drawn frame */
      frame: { ...this.frameStats },
      context: {
        antialias: gl.getContextAttributes()?.antialias ?? false,
        samples: gl.getParameter(gl.SAMPLES) as number,
        pixelRatio: this.renderer.getPixelRatio(),
        toneMapping: this.renderer.toneMapping,
        shadowMap: this.renderer.shadowMap.enabled,
      },
      safeMode: this.safeMode,
      framesDrawn: this.framesDrawn,
      probes: { ...this.probes },
      /** the render path the very first frame drew with */
      firstFrame: this.firstFrame,
      buildingMaterials: this.instances.materialTypes(),
      terrainMaterial: this.chunks.materialType,
      terrain: this.chunks.info(),
      horizonMaterial: (this.horizon.mesh.material as THREE.Material).type,
      horizonSeam: this.horizon.seamError(),
      rocks: this.rocks.stats(),
      base: { ...this.instances.renderInfo(), sunDir: this.lighting.sunDirection.toArray() },
      // (the sim's reservation counters ride with the visuals' traffic ones: core/traffic.ts)
      life: (() => { const l = this.life.info(); return { ...l, traffic: { ...l.traffic, sim: trafficStats(this.state) } }; })(),
      lens: { fov: this.camera.fov, near: this.camera.near },
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

  /** What the chunks hold of the pits' look: contour levels, ribbons, tones, the palette (tests, probes). */
  debugPitLook() {
    return lookInfo(this.hf);
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
      /** the isometric view's state: rot, tilt, zoom and the older aliases */
      iso: this.buildCam.info(),
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

  /** a world is up and the command view has the screen (the only view there is) */
  get commandView() { return this.playing; }
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
    this.sim.syncDeposits(false);
    this.drain();
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
    this.sim.mods = modsFor(this.state);
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
  const day = (t: number) => missionDayAt(s, t);
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
