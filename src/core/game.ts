/** The orchestrator: owns GameState, the Three.js world, input, the render/sim
 *  loops, action handling, store publishing, and save/load. */
import * as THREE from 'three';
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { SITES, type SiteId } from '../data/sites';
import { TECHS, type TechId } from '../data/techs';
import { MILESTONES } from '../data/milestones';
import { RESOURCES, type ResourceId } from '../data/resources';
import {
  ALERTS, AUTOSAVE_S, CREW, CYCLE_S, DOWNLINK, EYE_HEIGHT, GRADE_CELLS, GRADE_COST_ENERGY, GRADE_REGOLITH_YIELD,
  ICE_SURVEY_COST, LAUNCH_CAP_PER_VOLLEY, LAUNCH_COST_FOILS, LAUNCH_POWER_BURST, OVERCLOCK, RESUPPLY,
  SPEEDS, SWARM_PCT_PER_LAUNCH,
} from '../data/balance';
import { createInitialState, type BuildingState, type GameState } from './state';
import { OVERCLOCKABLE, canToggleCrew, crewToggleRule, effectiveRates } from './mods';
import { ActionQueue, type Action } from './actions';
import {
  boardingShortfall, downlinkCost, economyTick, currentDay, refreshDerived, alert, computeMods, landerAction,
  missionLost, orderDelayS, queuePos, settlersWelcome, type Mods,
} from './economy';
import { modsFor } from './mods';
import {
  cancel, enqueue, enqueuePath, migrateTechSchema, moveInQueue, onTechComplete, researchView,
} from './research';
import { fmtClock } from './daynight';
import { Heightfield } from '../terrain/heightfield';
import { TerrainChunks } from '../terrain/chunks';
import { Horizon } from '../terrain/horizon';
import { Rocks } from '../terrain/rocks';
import { BuildingInstances, centerOf, footprintRect } from '../buildings/instances';
import {
  PlacementController, buildCost, checkGrade, checkPlacement, demolishRefund, type PlaceableType,
} from '../buildings/placement';
import { BUILDING_MATERIAL } from '../buildings/meshKit';
import { createRenderer, createCamera } from '../world/renderer';
import { Lighting } from '../world/lighting';
import { Sky } from '../world/sky';
import { PostFX } from '../world/post';
import { materials, PATCH_MARKER } from '../world/materials';
import { BuildCam, HOME_DIST } from '../player/buildCam';
import { WalkController } from '../player/walk';
import { ModeManager } from '../player/modes';
import { saveGame, loadGame, clearSave, type SaveBlob } from './save';
import {
  $alerts, $caps, $counts, $defeat, $hasSave, $ice, $iceOverlay, $lookAt,
  $lander, $lostMission, $milestones, $mode, $phase, $placing, $power, $rates, $resources,
  $research, $selection, $siteId, $swarm, $tech, $time, $victory, $vitals, $wearMarkers,
} from '../ui/stores';

export interface GameOptions {
  nolock: boolean;
  lowfx: boolean;
  safe: boolean;
  fx?: number;      // explicit FX-ladder level override (?fx=0..3)
  seed: number;
}

export class Game {
  state!: GameState;
  mods!: Mods;
  readonly actions = new ActionQueue();

  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private scene = new THREE.Scene();
  private lighting: Lighting;
  private sky: Sky;
  private post: PostFX;
  private hf!: Heightfield;
  private chunks!: TerrainChunks;
  private horizon!: Horizon;
  private rocks!: Rocks;
  private instances!: BuildingInstances;
  private placement!: PlacementController;
  private buildCam: BuildCam;
  private walk!: WalkController;
  private modes!: ModeManager;

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
  private iceOverlay: THREE.Group | null = null;

  constructor(private canvas: HTMLCanvasElement, readonly opts: GameOptions) {
    this.renderer = createRenderer(canvas);
    this.camera = createCamera();
    this.lighting = new Lighting(this.scene);
    this.sky = new Sky(this.scene);
    this.post = new PostFX(this.renderer, this.scene, this.camera, opts.lowfx, opts.fx);
    this.post.onIssue = (msg) => {
      if (this.state) { alert(this.state, msg, 'warn'); this.publish(); }
    };
    // scene shader patches ride the same ladder as the post chain
    if (opts.fx !== undefined) materials.clearFault();
    materials.setFxLevel(this.post.fxLevel);
    this.post.onLevelChange = (level, explicit) => {
      if (explicit) materials.clearFault();
      materials.setFxLevel(level);
      this.rocks?.setFxLevel(level);
    };
    // a program that fails to compile is reported here (replacing three's
    // console dump); the response waits until the frame has finished
    this.renderer.debug.onShaderError = (gl, program, vs, fs) => {
      const log = (s: WebGLShader) => gl.getShaderInfoLog(s)?.trim() ?? '';
      console.error(`THREE.WebGLProgram: Shader Error — ${gl.getProgramInfoLog(program)?.trim() ?? ''}\n` +
        `vertex: ${log(vs)}\nfragment: ${log(fs)}`);
      const patched = [vs, fs].some((s) => gl.getShaderSource(s)?.includes(PATCH_MARKER));
      if (this.shaderFault !== 'patch') this.shaderFault = patched ? 'patch' : 'other';
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
    this.buildCam = new BuildCam(this.camera, canvas);
    this.buildCam.enabled = false;
    this.bindInput();
    window.addEventListener('resize', () => this.onResize());
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
    this.homeCamera(false);
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
    this.bootWorld(blob.state);
    // replay flattens onto the regenerated terrain, in order
    for (const f of this.state.flattens) {
      this.hf.flatten(f.x0, f.z0, f.x1, f.z1, f.h);
      this.onFlattened(f.x0, f.z0, f.x1, f.z1);
    }
    if (this.state.flattens.length) this.chunks.rebuildAround(0, 0, 255, 255);
    this.instances.rebuild(this.state);
    this.homeCamera(false);
    this.walk.colliders = this.instances.colliders(this.state);
    if (blob.player.mode === 'walk') {
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
    this.alertClock.clear();
    this.mods = refreshDerived(state);
    if (this.worldGroup) this.scene.remove(this.worldGroup);
    this.hf = new Heightfield(SITES[state.siteId], state.seed);
    this.chunks = new TerrainChunks(this.hf);
    this.horizon = new Horizon(this.hf);
    this.rocks = new Rocks(this.hf);
    this.rocks.setFxLevel(this.post.fxLevel);
    this.instances = new BuildingInstances(this.hf);
    this.chunks.onShadowCastersChanged = this.instances.onShadowCastersChanged =
      this.rocks.onShadowCastersChanged = () => this.lighting.requestShadowUpdate();
    this.lighting.requestShadowUpdate();
    this.lighting.groundAlbedo = SITES[state.siteId].terrain.albedo;
    this.placement = new PlacementController(this.scene, this.hf, SITES[state.siteId]);
    this.walk = new WalkController(this.hf);
    this.walk.boulders = this.rocks.colliders();
    this.modes = new ModeManager(this.camera, this.buildCam, this.walk, (m) => {
      $mode.set(m);
      this.buildCam.clearKeys();
      if (m === 'walk' && !this.opts.nolock) this.canvas.requestPointerLock();
      if (m === 'build' && document.pointerLockElement) document.exitPointerLock();
    });
    this.worldGroup = new THREE.Group();
    this.worldGroup.add(this.chunks.group, this.horizon.mesh, this.rocks.group, this.instances.group);
    this.iceOverlay = this.buildIceOverlay();
    if (this.iceOverlay) this.worldGroup.add(this.iceOverlay);
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
    if (this.opts.safe || this.safeMode) {
      this.safeMode = false; // fresh world = fresh materials; re-apply
      this.enableSafeMode();
    }
    $phase.set('playing');
    $siteId.set(state.siteId);
    $victory.set(false);
    $defeat.set(false);
  }

  // ─────────────────────────── input ───────────────────────────

  private bindInput() {
    window.addEventListener('mousemove', (e) => {
      this.mousePx = { x: e.clientX, y: e.clientY };
      this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      if (document.pointerLockElement === this.canvas && this.modes?.mode === 'walk') {
        this.walk.look(e.movementX, e.movementY);
      }
    });
    this.canvas.addEventListener('mousedown', (e) => { this.downPos = { x: e.clientX, y: e.clientY }; });
    this.canvas.addEventListener('mouseup', (e) => {
      if (!this.playing || this.modes.mode !== 'build' || this.modes.transitioning) return;
      const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
      if (moved > 5) return; // drag = camera, not click
      if (e.button === 0) this.onWorldClick();
      if (e.button === 2 && this.placement.active) this.cancelPlacement();
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
      switch (e.code) {
        case 'Tab':
          e.preventDefault();
          this.cancelPlacement();
          this.modes.toggle();
          break;
        case 'Space':
          if (this.modes.mode === 'build') {
            e.preventDefault();
            this.actions.push({ kind: 'setPaused', paused: !this.state.paused });
          } else {
            this.walk.keyDown(e.code);
          }
          break;
        case 'Digit1': this.actions.push({ kind: 'setSpeed', speed: SPEEDS[0] }); break;
        case 'Digit2': this.actions.push({ kind: 'setSpeed', speed: SPEEDS[1] }); break;
        case 'Digit3': this.actions.push({ kind: 'setSpeed', speed: SPEEDS[2] }); break;
        case 'KeyR': if (this.placement.active) this.placement.rotate(); break;
        case 'KeyI': if (this.state?.iceSurveyed) $iceOverlay.set(!$iceOverlay.get()); break;
        case 'KeyE':
          // inspect what the reticle rests on: back to command view, selected
          if (this.modes.mode === 'walk' && this.lookId !== null && !this.modes.transitioning) {
            const id = this.lookId;
            this.modes.toggle();
            this.select(id);
          }
          break;
        case 'Escape':
          this.cancelPlacement();
          $selection.set(null);
          break;
        case 'KeyF': {
          const sel = $selection.get();
          if (this.modes.mode !== 'build' || !sel) break;
          const [x, z] = centerOf(sel);
          this.buildCam.focus(x, this.hf.sample(x, z), z, 60);
          break;
        }
        case 'KeyH':
        case 'Home':
          if (this.modes.mode === 'build') this.homeCamera(true);
          break;
        default:
          if (this.modes.mode === 'walk') this.walk.keyDown(e.code);
          else if (BuildCam.handles(e.code)) {
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
      if (document.hidden && this.playing) void this.doSave();
    });
  }

  private onWorldClick() {
    if (this.placement.active) {
      const p = this.placement.probe!;
      if (!p.valid) return;
      if (p.type === 'grade') {
        // grading stays active: multiple passes are the point
        this.actions.push({ kind: 'grade', gx: p.gx, gz: p.gz });
      } else {
        this.actions.push({ kind: 'place', type: p.type, gx: p.gx, gz: p.gz, rot: p.rot });
        this.cancelPlacement();
      }
      return;
    }
    // selection
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const id = this.instances.pick(this.raycaster);
    const b = id !== null ? this.state.buildings.find((x) => x.id === id) ?? null : null;
    $selection.set(b ? { ...b } : null);
  }

  beginPlacement(type: PlaceableType) {
    if (this.modes.mode !== 'build') return;
    if (type === 'grade' && !this.mods.grading) return;
    $selection.set(null);
    this.placement.begin(type);
    if (type === 'iceHarvester' && this.state.iceSurveyed) $iceOverlay.set(true);
    $placing.set({ type, valid: false, reason: '', warn: '' });
  }

  cancelPlacement() {
    this.placement?.cancel();
    $placing.set(null);
  }

  /** Frame the Lander from the home direction (a glide unless `glide` is false). */
  private homeCamera(glide: boolean) {
    const lander = this.state.buildings.find((b) => b.type === 'lander');
    const [x, z] = lander ? centerOf(lander) : [0, 0];
    const y = this.hf.sample(x, z);
    if (glide) this.buildCam.focus(x, y, z, HOME_DIST, true);
    else this.buildCam.home(x, y, z);
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
    $selection.set(b ? { ...b } : null);
  }

  // ─────────────────────────── actions ───────────────────────────

  private applyAction(a: Action) {
    const s = this.state;
    switch (a.kind) {
      case 'place': {
        const chk = checkPlacement(s, SITES[s.siteId], this.hf, this.mods.unlocked, a.type, a.gx, a.gz, a.rot);
        if (!chk.valid) { alert(s, `CANNOT BUILD — ${chk.reason}`, 'warn'); break; }
        this.commitPlace(a.type, a.gx, a.gz, a.rot, false);
        break;
      }
      case 'demolish': {
        const i = s.buildings.findIndex((b) => b.id === a.id);
        if (i < 0 || s.buildings[i].type === 'lander') break;
        const b = s.buildings[i];
        for (const [rid, amt] of Object.entries(demolishRefund(b, SITES[s.siteId]))) {
          s.resources[rid as keyof typeof s.resources] += amt ?? 0;
        }
        s.buildings.splice(i, 1);
        this.instances.rebuild(s);
        this.walk.colliders = this.instances.colliders(s);
        $selection.set(null);
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
        break;
      }
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
        s.powerStored -= GRADE_COST_ENERGY;
        const h = this.hf.flatten(a.gx, a.gz, a.gx + GRADE_CELLS, a.gz + GRADE_CELLS);
        s.flattens.push({ x0: a.gx, z0: a.gz, x1: a.gx + GRADE_CELLS, z1: a.gz + GRADE_CELLS, h });
        this.chunks.rebuildAround(a.gx, a.gz, a.gx + GRADE_CELLS, a.gz + GRADE_CELLS);
        this.onFlattened(a.gx, a.gz, a.gx + GRADE_CELLS, a.gz + GRADE_CELLS);
        s.resources.regolith += GRADE_REGOLITH_YIELD; // dozed spoil, recovered
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
      case 'surveyIce': {
        if (!SITES[s.siteId].hasIce || s.iceSurveyed) break;
        if (s.powerStored < ICE_SURVEY_COST) {
          alert(s, `SURVEY NEEDS ${ICE_SURVEY_COST} STORED ENERGY — charge the banks first`, 'warn');
          break;
        }
        s.powerStored -= ICE_SURVEY_COST;
        s.iceSurveyed = true;
        $iceOverlay.set(true);
        alert(s, 'SURVEY COMPLETE — ice deposits mapped. Toggle the overlay with [I]', 'info');
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

  private commitPlace(type: BuildingId, gx: number, gz: number, rot: 0 | 1 | 2 | 3, free: boolean) {
    const s = this.state;
    if (!free) {
      for (const [rid, amt] of Object.entries(buildCost(type, SITES[s.siteId]))) {
        s.resources[rid as keyof typeof s.resources] -= amt ?? 0;
      }
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
    const buildTotal = Math.round(BUILDINGS[type].buildTime * SITES[s.siteId].buildCostMult *
      this.mods.buildSpeedMult * this.mods.buildTimeMult[type]);
    s.buildings.push({
      id: s.nextBuildingId++, type, gx, gz, rot,
      enabled: true,
      // robotic missions place every station under agent control, so arriving
      // settlers never strand a running base — crewing is an opt-in upgrade
      automated: s.expedition === 'robotic',
      priority: BUILDINGS[type].priority, wear: 0, dust: 0,
      construction: free ? 0 : buildTotal, buildTotal,
      active: false, idleReason: free ? '' : 'building',
    });
    this.instances.rebuild(s);
    this.walk.colliders = this.instances.colliders(s);
    // deadlock early-warning: metals gone before your first smelter exists
    if (!free && !s.buildings.some((b) => b.type === 'smelter')) {
      const smelterCost = Math.ceil((BUILDINGS.smelter.buildCost.metals ?? 40) * SITES[s.siteId].buildCostMult);
      if (s.resources.metals < smelterCost + 20) {
        alert(s, `METALS LOW — a Regolith Smelter costs ${smelterCost}; without one you cannot make more`,
          'warn', { panel: 'metals' });
      }
    }
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
    s.data -= cost;
    s.downlinks += 1;
    s.resupply = { ...(s.resupply ?? { shipments: 0 }), pending: true, downlink: true, arriveAt: s.simTime + DOWNLINK.delayS };
    const cargo = Object.entries(DOWNLINK.cargo)
      .map(([rid, amt]) => `${amt}${RESOURCES[rid as ResourceId].glyph}`).join(' ');
    alert(s, `DOWNLINK SENT — ${cost}≡ to Earth; ${cargo} lands in ${fmtClock(DOWNLINK.delayS)}`,
      'info', landerAction(s));
  }

  private doLaunch() {
    const s = this.state;
    const refuse = (text: string) => alert(s, `LAUNCH ${text}`, 'warn');
    if (!this.mods.launchArmed) { refuse(`NEEDS ${TECHS.swarmProtocol.name}`); return; }
    if (s.resources.foils < LAUNCH_COST_FOILS) {
      refuse(`NEEDS ${LAUNCH_COST_FOILS}${RESOURCES.foils.glyph} — have ${Math.floor(s.resources.foils)}`);
      return;
    }
    if (s.resources.launch < LAUNCH_CAP_PER_VOLLEY) {
      refuse(`NEEDS ${LAUNCH_CAP_PER_VOLLEY}${RESOURCES.launch.glyph} CAPACITY — have ${s.resources.launch.toFixed(1)}${RESOURCES.launch.glyph}`);
      return;
    }
    if (s.powerStored < LAUNCH_POWER_BURST) {
      refuse(`NEEDS ${LAUNCH_POWER_BURST} STORED ENERGY — have ${Math.floor(s.powerStored)}`);
      return;
    }
    s.resources.foils -= LAUNCH_COST_FOILS;
    s.resources.launch -= LAUNCH_CAP_PER_VOLLEY;
    s.powerStored -= LAUNCH_POWER_BURST;
    s.launches += 1;
    s.swarmPct += SWARM_PCT_PER_LAUNCH;
    alert(s, `COLLECTOR VOLLEY ${s.launches} AWAY — swarm ${(s.swarmPct).toFixed(4)}%`, 'info');
  }

  // ─────────────────────────── loop ───────────────────────────

  private shadeAcc = 0;
  private alertAcc = 0;
  /** alert id → real time (ms) it was last raised, as seen by this session */
  private alertClock = new Map<number, { t: number; count: number }>();
  private playFrames = 0;      // frames since gameplay (not page load) began
  private nextProbe = 40;      // next black-frame probe, in playFrames
  private safeMode = false;
  private shaderFault: 'patch' | 'other' | null = null;

  private frame(t: number) {
    requestAnimationFrame((tt) => this.frame(tt));
    const realDt = Math.max(0, (t - this.lastT) / 1000);
    this.lastT = t;
    if (this.playing) {
      this.step(realDt);
      this.alertAcc += realDt;
      if (this.alertAcc > 0.5) { this.alertAcc = 0; this.ageAlerts(t); }
    }
    this.post.render(Math.min(realDt, 0.1));
    if (this.shaderFault) this.recoverFromShaderFault();
    // black-screen sentinel: some drivers fail shaders silently instead of
    // throwing. Probe the rendered output during daylight — first drop the
    // post chain, then escalate to safe mode. Counted from gameplay start
    // (the player may sit on the title screen for any length of time), and
    // re-probed periodically to catch mid-game driver failures.
    if (!this.playing) return;
    this.playFrames++;
    if (this.playFrames >= this.nextProbe && !this.safeMode) {
      const day = currentDay(this.state, SITES[this.state.siteId]);
      if (day.sunFactor <= 0.3) {
        this.nextProbe = this.playFrames + 120;      // night/dusk — check again soon
      } else if (this.post.outputLooksBlack((u, v) => this.groundAt(u, v))) {
        const stepped = this.post.degrade('black frame detected');
        if (!stepped) this.enableSafeMode();
        this.nextProbe = this.playFrames + 40;       // verify the next rung quickly
      } else {
        this.nextProbe = this.playFrames + 900;      // healthy — routine re-check
      }
    }
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
    if (fault === 'patch' && materials.stripPatches()) {
      console.warn('[MOONSHOTS] Detail shaders failed to compile — stock materials.');
      if (this.state) { alert(this.state, 'RENDER — detail shaders disabled (GPU limitation)', 'warn'); this.publish(); }
      return;
    }
    if (this.safeMode) return;
    if (!this.post.degrade('shader compile error')) this.enableSafeMode();
  }

  /** Last-resort rendering: unlit vertex-color materials, no shadows, no
   *  effects. Renders on anything that can draw a triangle — including
   *  meshes created later, which take their material from the registry. */
  enableSafeMode() {
    if (this.safeMode) return;
    this.safeMode = true;
    console.warn('[MOONSHOTS] Safe render mode enabled — simplified materials, no shadows.');
    this.renderer.shadowMap.enabled = false;
    materials.enableSafe(this.scene);
    this.rocks?.setSafe(true);
    this.sky.setSafe(true);
    if (this.state) {
      alert(this.state, 'SAFE RENDER MODE — simplified visuals (GPU issue detected)', 'warn');
      this.publish();
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
    for (const a of acts) this.applyAction(a);

    const tweening = this.modes.update(dt);
    if (!tweening) {
      if (this.modes.mode === 'build') {
        this.buildCam.update(dt);
        if (this.placement.active) {
          this.raycaster.setFromCamera(this.mouse, this.camera);
          this.placement.update(this.state, this.mods.unlocked,
            this.raycaster.ray.origin, this.raycaster.ray.direction);
          const p = this.placement.probe!;
          $placing.set({ type: p.type, valid: p.valid, reason: p.reason, warn: p.warn });
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
        const ev = economyTick(this.state, SITES[this.state.siteId], this.mods, 1);
        if (ev.modsChanged) this.mods = modsFor(this.state);
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
      this.updateWearMarkers();
    }

    // sun follows the clock; the shadow window hugs the ground in view
    const day = currentDay(this.state, SITES[this.state.siteId]);
    const walking = this.modes.mode === 'walk';
    const focus = walking ? this.walk.pos : this.buildCam.controls.target;
    this.lighting.setSun(day.sunElev, day.sunAzim, day.nightFactor);
    this.camera.updateMatrixWorld();
    this.sky.update(this.camera, day.sunElev, day.sunAzim, this.lighting.sunLight, day.tCycle, dt,
      this.groundAnywhere);
    this.rocks.update(this.camera);
    this.lighting.fitShadow(this.camera, focus, walking ? 160
      : Math.min(900, Math.max(140, 2.2 * this.camera.position.distanceTo(focus))));
    // at night the base carries its own light: hull glow, ground pools, and
    // exterior work lights over the structures nearest the camera
    this.instances.setNightGlow(day.nightFactor);
    if (BUILDING_MATERIAL.isMeshStandardMaterial) {
      BUILDING_MATERIAL.emissive.setScalar(0.09 * day.nightFactor);
    }
    this.lighting.setWorkLights(
      day.nightFactor > 0.03
        ? this.instances.completedCenters(this.state, { x: focus.x, z: focus.z })
        : [],
      day.nightFactor,
    );

    // autosave (real time)
    this.autosaveAcc += dt;
    if (this.autosaveAcc > AUTOSAVE_S) {
      this.autosaveAcc = 0;
      void this.doSave();
    }
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
      for (const b of this.state.buildings) if (b.type === 'solar') b.shaded = false;
      return;
    }
    const d = currentDay(this.state, SITES[this.state.siteId]);
    if (d.sunFactor <= 0.01 || d.sunElev <= 0.01) return;
    const dirX = Math.cos(d.sunAzim) * Math.cos(d.sunElev);
    const dirY = Math.sin(d.sunElev);
    const dirZ = Math.sin(d.sunAzim) * Math.cos(d.sunElev);
    for (const b of this.state.buildings) {
      if (b.type !== 'solar' || (b.construction ?? 0) > 0) continue;
      const [cx, cz] = centerOf(b);
      const y = this.hf.sample(cx, cz);
      b.shaded = this.hf.raycast(cx, y + 3.2, cz, dirX, dirY, dirZ, 400) !== null;
    }
  }

  /** Damaged buildings get an on-screen condition bar (build mode only). */
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
    });
    const site = SITES[s.siteId];
    let beds = 0;
    let agentRun = 0;
    let sites = 0;
    let welding = 0;
    let upkeep = 0;
    for (const b of s.buildings) {
      if ((b.construction ?? 0) > 0) {
        sites++;
        if (b.idleReason === 'building') welding++;
        continue;
      }
      beds += BUILDINGS[b.type].housing ?? 0;
      if (b.enabled && b.automated && BUILDINGS[b.type].crew > 0) agentRun++;
      if (b.enabled) upkeep += effectiveRates(b.type, this.mods, site, b, { feed: s.feed }).upkeepPartsPerDay / CYCLE_S;
    }
    const ls = s.crew * this.mods.inputMult.habitat;
    $vitals.set({
      crew: s.crew, housing: s.housingActive ?? 0, beds, morale: Math.round(s.morale), data: s.data,
      botsFree: (s.bots?.total ?? 0) - (s.bots?.busy ?? 0), botsTotal: s.bots?.total ?? 0,
      expedition: s.expedition ?? 'human',
      boardingHold: settlersWelcome(s) ? boardingShortfall(s, this.mods.inputMult.habitat) : '',
      lifeSupport: { oxygen: ls * CREW.oxygenPerCrew, food: ls * CREW.foodPerCrew, water: ls * CREW.waterPerCrew },
      sites, welding, upkeep,
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
    $alerts.set([...s.alerts]);
    const next = MILESTONES.find((m) => !s.milestonesDone.includes(m.id));
    $milestones.set({
      done: [...s.milestonesDone], total: MILESTONES.length, progress: next?.progress?.(s) ?? '',
    });
    $swarm.set({
      pct: s.swarmPct, launches: s.launches, armed: this.mods.launchArmed,
      canLaunch: this.mods.launchArmed && s.resources.foils >= LAUNCH_COST_FOILS &&
        s.resources.launch >= LAUNCH_CAP_PER_VOLLEY && s.powerStored >= LAUNCH_POWER_BURST,
      burst: LAUNCH_POWER_BURST,
      foils: s.resources.foils, launch: s.resources.launch, stored: s.powerStored,
    });
    $ice.set({ hasIce: SITES[s.siteId].hasIce, surveyed: s.iceSurveyed ?? false });
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
    const sel = $selection.get();
    if (sel) {
      const live = s.buildings.find((b) => b.id === sel.id);
      $selection.set(live ? { ...live } : null);
    }
  }

  /** Terrain-conforming discs marking surveyed ice deposits (toggle overlay). */
  private buildIceOverlay(): THREE.Group | null {
    if (!this.hf.iceDeposits.length) return null;
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xdfe9f5, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide,
    });
    const lineMat = new THREE.LineBasicMaterial({ color: 0xdfe9f5, transparent: true, opacity: 0.55 });
    for (const d of this.hf.iceDeposits) {
      const segs = 28;
      const verts: number[] = [d.cx, this.hf.sample(d.cx, d.cz) + 0.4, d.cz];
      const ring: number[] = [];
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const x = d.cx + Math.cos(a) * d.r;
        const z = d.cz + Math.sin(a) * d.r;
        const y = this.hf.sample(x, z) + 0.4;
        verts.push(x, y, z);
        ring.push(x, y + 0.05, z);
      }
      const idx: number[] = [];
      for (let i = 1; i <= segs; i++) idx.push(0, i, i + 1);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
      geo.setIndex(idx);
      const disc = new THREE.Mesh(geo, mat);
      disc.renderOrder = 3;
      const ringGeo = new THREE.BufferGeometry();
      ringGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ring), 3));
      const edge = new THREE.Line(ringGeo, lineMat);
      edge.renderOrder = 3;
      group.add(disc, edge);
    }
    group.visible = false;
    $iceOverlay.subscribe((v) => { group.visible = v && (this.state?.iceSurveyed ?? false); });
    return group;
  }

  // ─────────────────────────── persistence ───────────────────────────

  private saveBlob(): SaveBlob {
    return {
      state: this.state,
      player: {
        mode: this.modes.mode,
        x: this.walk.pos.x, y: this.walk.pos.y, z: this.walk.pos.z,
        yaw: this.walk.yaw, pitch: this.walk.pitch,
      },
      savedAt: Date.now(),
    };
  }

  async doSave() {
    // a lost base is written once, at the moment of loss, and never again
    if (!this.playing || missionLost(this.state)) return;
    await saveGame(this.saveBlob());
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
    $lostMission.set(lost
      ? { siteId: blob.state.siteId, day: Math.floor(blob.state.simTime / CYCLE_S) + 1 }
      : null);
  }

  async continueSave(): Promise<boolean> {
    const blob = await loadGame();
    if (!blob || missionLost(blob.state)) { this.publishSaveSlot(blob); return false; }
    this.loadFrom(blob);
    return true;
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

  // ─────────────────────────── debug hooks ───────────────────────────

  debugPlace(type: BuildingId, gx: number, gz: number, rot: 0 | 1 | 2 | 3 = 0): boolean {
    const chk = checkPlacement(this.state, SITES[this.state.siteId], this.hf, this.mods.unlocked, type, gx, gz, rot);
    if (!chk.valid) return false;
    this.commitPlace(type, gx, gz, rot, false);
    this.publish();
    return true;
  }

  /** run one frame of play as if `realDt` wall-seconds had passed (no render) */
  debugFrame(realDt: number) {
    if (this.playing) this.step(realDt);
  }

  debugCompleteTech(id: TechId) {
    if (!TECHS[id] || this.state.techsDone.includes(id)) return;
    this.state.techsDone.push(id);
    onTechComplete(this.state, id);
    this.mods = refreshDerived(this.state);
    this.publish();
  }

  debugAdvance(gameSeconds: number) {
    // apply anything the UI/debug API queued this frame before ticking
    const acts = this.actions.drain();
    for (const a of acts) this.applyAction(a);
    let victory = false;
    let defeat = false;
    // as in play: shading follows the sun (every 5 game-seconds, the live
    // loop's cadence at 10×), and a lost base never ticks again
    for (let i = 0; i < gameSeconds && !missionLost(this.state); i++) {
      if (i % 5 === 0) this.updateShading();
      const ev = economyTick(this.state, SITES[this.state.siteId], this.mods, 1);
      this.state.simTime += 1;
      if (ev.modsChanged) this.mods = modsFor(this.state);
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
      const t = this.buildCam.controls.target;
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
    return {
      fxLevel: this.post.fxLevel,
      safeMode: this.safeMode,
      shadowTexel: this.lighting.shadowTexel,
      shadowRenders: this.lighting.shadowRenders,
      patches: materials.variants(),
      patchFault: materials.patchesFaulted,
      buildingMaterials: this.instances.materialTypes(),
      terrainMaterial: this.chunks.materialType,
      horizonMaterial: (this.horizon.mesh.material as THREE.Material).type,
      horizonSeam: this.horizon.seamError(),
      rocks: this.rocks.stats(),
      sky: this.sky.info(),
    };
  }

  /** Build-camera pose and its clearance over the ground (tests, probes). */
  debugCamera() {
    const t = this.buildCam.controls.target, p = this.camera.position;
    return {
      pos: { x: p.x, y: p.y, z: p.z },
      target: { x: t.x, y: t.y, z: t.z },
      targetGround: this.groundAnywhere(t.x, t.z),
      clearance: this.buildCam.clearance,
      dist: p.distanceTo(t),
      azimuth: Math.atan2(p.z - t.z, p.x - t.x),
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
    this.nextProbe = v ? this.playFrames + 40 : Number.POSITIVE_INFINITY;
  }

  get walkController() { return this.walk; }
  /** settled in command view: not walking, not flying between the two */
  get commandView() { return this.modes.mode === 'build' && !this.modes.transitioning; }
  get iceDepositList() { return this.hf.iceDeposits; }

  debugCheckPlace(type: BuildingId, gx: number, gz: number) {
    return checkPlacement(this.state, SITES[this.state.siteId], this.hf, this.mods.unlocked, type, gx, gz, 0);
  }
}
