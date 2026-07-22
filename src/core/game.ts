/** The orchestrator: owns GameState, the Three.js world, input, the render/sim
 *  loops, action handling, store publishing, and save/load. */
import * as THREE from 'three';
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { SITES, type SiteId } from '../data/sites';
import { TECHS, type TechId } from '../data/techs';
import { MILESTONES } from '../data/milestones';
import {
  AUTOSAVE_S, LAUNCH_COST_FOILS, LAUNCH_POWER_BURST, SPEEDS, SWARM_PCT_PER_LAUNCH,
} from '../data/balance';
import { createInitialState, type GameState } from './state';
import { ActionQueue, type Action } from './actions';
import { economyTick, currentDay, refreshDerived, alert, computeMods, type Mods } from './economy';
import { Heightfield } from '../terrain/heightfield';
import { TerrainChunks } from '../terrain/chunks';
import { BuildingInstances, centerOf, footprintRect } from '../buildings/instances';
import { PlacementController, buildCost, checkPlacement } from '../buildings/placement';
import { BUILDING_MATERIAL } from '../buildings/meshKit';
import { createRenderer, createCamera } from '../world/renderer';
import { Lighting } from '../world/lighting';
import { PostFX } from '../world/post';
import { BuildCam } from '../player/buildCam';
import { WalkController } from '../player/walk';
import { ModeManager } from '../player/modes';
import { saveGame, loadGame, clearSave, type SaveBlob } from './save';
import {
  $alerts, $defeat, $hasSave, $lookAt, $milestones, $mode, $phase, $placing, $power,
  $resources, $selection, $siteId, $swarm, $tech, $time, $victory, $vitals,
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
  private post: PostFX;
  private hf!: Heightfield;
  private chunks!: TerrainChunks;
  private instances!: BuildingInstances;
  private placement!: PlacementController;
  private buildCam: BuildCam;
  private walk!: WalkController;
  private modes!: ModeManager;

  private playing = false;
  private econAcc = 0;
  private autosaveAcc = 0;
  private lookAcc = 0;
  private mouse = new THREE.Vector2();      // NDC
  private mousePx = { x: 0, y: 0 };
  private downPos = { x: 0, y: 0 };
  private raycaster = new THREE.Raycaster();
  private lastT = performance.now();
  private worldGroup: THREE.Group | null = null;

  constructor(private canvas: HTMLCanvasElement, readonly opts: GameOptions) {
    this.renderer = createRenderer(canvas);
    this.camera = createCamera();
    this.lighting = new Lighting(this.scene);
    this.post = new PostFX(this.renderer, this.scene, this.camera, opts.lowfx, opts.fx);
    this.post.onIssue = (msg) => {
      if (this.state) { alert(this.state, msg, 'warn'); this.publish(); }
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
    void loadGame().then((blob) => $hasSave.set(blob !== null));
  }

  // ─────────────────────────── lifecycle ───────────────────────────

  startNew(siteId: SiteId) {
    const state = createInitialState(siteId, this.opts.seed);
    this.bootWorld(state);
    // pre-place the Lander at the map heart and pad the ground under it
    const gx = 126, gz = 126;
    this.commitPlace('lander', gx, gz, 0, true);
    this.buildCam.controls.target.set(0, 0, 0);
    this.camera.position.set(70, 80, 120);
    this.publish();
    alert(this.state, 'TOUCHDOWN — begin with a Solar Array', 'info');
  }

  loadFrom(blob: SaveBlob) {
    this.bootWorld(blob.state);
    // replay flattens onto the regenerated terrain, in order
    for (const f of this.state.flattens) this.hf.flatten(f.x0, f.z0, f.x1, f.z1, f.h);
    if (this.state.flattens.length) this.chunks.rebuildAround(0, 0, 255, 255);
    this.instances.rebuild(this.state);
    this.walk.colliders = this.instances.colliders(this.state);
    if (blob.player.mode === 'walk') {
      this.walk.pos.set(blob.player.x, blob.player.y, blob.player.z);
      this.walk.yaw = blob.player.yaw;
      this.walk.pitch = blob.player.pitch;
      this.modes.set('walk');
    }
    this.publish();
  }

  private bootWorld(state: GameState) {
    this.state = state;
    this.mods = refreshDerived(state);
    if (this.worldGroup) this.scene.remove(this.worldGroup);
    this.hf = new Heightfield(SITES[state.siteId], state.seed);
    this.chunks = new TerrainChunks(this.hf);
    this.instances = new BuildingInstances(this.hf);
    this.placement = new PlacementController(this.scene, this.hf, SITES[state.siteId]);
    this.walk = new WalkController(this.hf);
    this.modes = new ModeManager(this.camera, this.buildCam, this.walk, (m) => {
      $mode.set(m);
      if (m === 'walk' && !this.opts.nolock) this.canvas.requestPointerLock();
      if (m === 'build' && document.pointerLockElement) document.exitPointerLock();
    });
    this.worldGroup = new THREE.Group();
    this.worldGroup.add(this.chunks.group, this.instances.group);
    this.scene.add(this.worldGroup);
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
        case 'Escape':
          this.cancelPlacement();
          $selection.set(null);
          break;
        default:
          if (this.modes.mode === 'walk') this.walk.keyDown(e.code);
      }
    });
    window.addEventListener('keyup', (e) => { this.walk?.keyUp(e.code); });
    window.addEventListener('blur', () => this.walk?.clearKeys());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.playing) void this.doSave();
    });
  }

  private onWorldClick() {
    if (this.placement.active) {
      const p = this.placement.probe!;
      if (p.valid) {
        this.actions.push({ kind: 'place', type: p.type, gx: p.gx, gz: p.gz, rot: p.rot });
        // keep placing while shift held? keep simple: exit placement
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

  beginPlacement(type: BuildingId) {
    if (this.modes.mode !== 'build') return;
    $selection.set(null);
    this.placement.begin(type);
    $placing.set({ type, valid: false, reason: '' });
  }

  cancelPlacement() {
    this.placement?.cancel();
    $placing.set(null);
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
        for (const [rid, amt] of Object.entries(BUILDINGS[b.type].buildCost)) {
          s.resources[rid as keyof typeof s.resources] += Math.floor(amt * 0.5);
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
        if (b && this.mods.automation && BUILDINGS[b.type].crew > 0) b.automated = a.automated;
        break;
      }
      case 'setPriority': {
        const b = s.buildings.find((x) => x.id === a.id);
        if (b) b.priority = a.priority;
        break;
      }
      case 'research': {
        const def = TECHS[a.tech];
        if (!def) break;
        if (s.techsDone.includes(a.tech) || s.researchQueue.includes(a.tech)) break;
        if (def.era > s.era) break;
        if (!def.requires.every((r) => s.techsDone.includes(r) || s.researchQueue.includes(r))) break;
        if (s.researchQueue.length >= 3) break;
        s.researchQueue.push(a.tech);
        break;
      }
      case 'cancelResearch': {
        const i = s.researchQueue.indexOf(a.tech);
        if (i >= 0) {
          // canceling an earlier item also drops anything that required it
          s.researchQueue = s.researchQueue.filter((t, j) =>
            j < i || (t !== a.tech && !TECHS[t].requires.includes(a.tech)));
          if (i === 0) s.researchProgress = 0;
        }
        break;
      }
      case 'setSpeed': s.speed = a.speed; break;
      case 'setPaused': s.paused = a.paused; break;
      case 'launch': this.doLaunch(); break;
      case 'dismissAlert': s.alerts = s.alerts.filter((al) => al.id !== a.id); break;
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
    // rough terrain slows construction the same way it inflates costs
    const buildTotal = Math.round(BUILDINGS[type].buildTime * SITES[s.siteId].buildCostMult);
    s.buildings.push({
      id: s.nextBuildingId++, type, gx, gz, rot,
      enabled: true, automated: false, priority: BUILDINGS[type].priority, wear: 0, dust: 0,
      construction: free ? 0 : buildTotal, buildTotal,
      active: false, idleReason: free ? '' : 'building',
    });
    this.instances.rebuild(s);
    this.walk.colliders = this.instances.colliders(s);
    // deadlock early-warning: metals gone before your first smelter exists
    if (!free && !s.buildings.some((b) => b.type === 'smelter')) {
      const smelterCost = Math.ceil((BUILDINGS.smelter.buildCost.metals ?? 40) * SITES[s.siteId].buildCostMult);
      if (s.resources.metals < smelterCost + 20) {
        alert(s, `METALS LOW — a Regolith Smelter costs ${smelterCost}; without one you cannot make more`, 'warn');
      }
    }
  }

  private doLaunch() {
    const s = this.state;
    if (!this.mods.launchArmed) return;
    if (s.resources.foils < LAUNCH_COST_FOILS || s.resources.launch < 1 ||
        s.powerStored < LAUNCH_POWER_BURST) return;
    s.resources.foils -= LAUNCH_COST_FOILS;
    s.resources.launch -= 1;
    s.powerStored -= LAUNCH_POWER_BURST;
    s.launches += 1;
    s.swarmPct += SWARM_PCT_PER_LAUNCH;
    alert(s, `COLLECTOR VOLLEY ${s.launches} AWAY — swarm ${(s.swarmPct).toFixed(4)}%`, 'info');
  }

  // ─────────────────────────── loop ───────────────────────────

  private playFrames = 0;      // frames since gameplay (not page load) began
  private nextProbe = 40;      // next black-frame probe, in playFrames
  private safeMode = false;
  private hadConstruction = false;

  private frame(t: number) {
    requestAnimationFrame((tt) => this.frame(tt));
    const dt = Math.min((t - this.lastT) / 1000, 0.1);
    this.lastT = t;
    if (this.playing) this.tick(dt);
    this.post.render(dt);
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
      } else if (this.post.outputLooksBlack()) {
        const stepped = this.post.degrade('black frame detected');
        if (!stepped) this.enableSafeMode();
        this.nextProbe = this.playFrames + 40;       // verify the next rung quickly
      } else {
        this.nextProbe = this.playFrames + 900;      // healthy — routine re-check
      }
    }
  }

  /** Last-resort rendering: unlit vertex-color materials, no shadows, no
   *  effects. Renders on anything that can draw a triangle. */
  enableSafeMode() {
    if (this.safeMode) return;
    this.safeMode = true;
    console.warn('[MOONSHOTS] Safe render mode enabled — simplified materials, no shadows.');
    this.renderer.shadowMap.enabled = false;
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
      if (mat && mat.isMeshStandardMaterial) {
        mesh.material = new THREE.MeshBasicMaterial({ vertexColors: mat.vertexColors });
      }
    });
    if (this.state) {
      alert(this.state, 'SAFE RENDER MODE — simplified visuals (GPU issue detected)', 'warn');
      this.publish();
    }
  }

  private tick(dt: number) {
    // actions first, every frame, so the UI feels immediate
    const acts = this.actions.drain();
    for (const a of acts) this.applyAction(a);

    const tweening = this.modes.update(dt);
    if (!tweening) {
      if (this.modes.mode === 'build') {
        this.buildCam.update();
        if (this.placement.active) {
          this.raycaster.setFromCamera(this.mouse, this.camera);
          this.placement.update(this.state, this.mods.unlocked,
            this.raycaster.ray.origin, this.raycaster.ray.direction);
          const p = this.placement.probe!;
          $placing.set({ type: p.type, valid: p.valid, reason: p.reason });
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
      const gdt = dt * this.state.speed;
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
        if (ev.modsChanged) this.mods = computeMods(this.state.techsDone);
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
        // animate construction sites (rise + un-dim) while any are active
        const constructing = this.state.buildings.some((b) => (b.construction ?? 0) > 0);
        if (constructing || this.hadConstruction) {
          this.instances.rebuild(this.state);
          this.hadConstruction = constructing;
        }
        this.publish();
      }
      if (victory) $victory.set(true); // after publish so the overlay reads fresh stats
      if (defeat) $defeat.set(true);
    } else if (acts.length) {
      this.publish();
    }

    // sun follows the clock; shadow frustum follows the camera focus
    const day = currentDay(this.state, SITES[this.state.siteId]);
    const focus = this.modes.mode === 'walk' ? this.walk.pos : this.buildCam.controls.target;
    this.lighting.setSun(day.sunElev, day.sunAzim, focus as THREE.Vector3, day.nightFactor);
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

  private updateLookAt() {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    this.raycaster.far = 60;
    const id = this.instances.pick(this.raycaster);
    this.raycaster.far = Infinity;
    if (id === null) { $lookAt.set(null); return; }
    const b = this.state.buildings.find((x) => x.id === id);
    if (!b) { $lookAt.set(null); return; }
    $lookAt.set({ name: BUILDINGS[b.type].name, x: window.innerWidth / 2, y: window.innerHeight / 2 - 40 });
  }

  // ─────────────────────────── publish ───────────────────────────

  publish() {
    const s = this.state;
    const day = currentDay(s, SITES[s.siteId]);
    $resources.set({ ...s.resources });
    $power.set({
      supply: s.power.supply, demand: s.power.demand,
      stored: s.powerStored, capacity: s.power.capacity, brownout: s.power.brownout,
    });
    let housing = 0;
    for (const b of s.buildings) housing += BUILDINGS[b.type].housing ?? 0;
    $vitals.set({
      crew: s.crew, housing, morale: Math.round(s.morale), data: s.data,
      botsFree: (s.bots?.total ?? 0) - (s.bots?.busy ?? 0), botsTotal: s.bots?.total ?? 0,
    });
    $time.set({
      dayIndex: day.dayIndex, tCycle: day.tCycle, isNight: day.isNight, sunFactor: day.sunFactor,
      speed: s.speed, paused: s.paused, flare: s.flare.phase, flareTimer: Math.ceil(s.flare.timer),
    });
    $tech.set({
      era: s.era, done: [...s.techsDone], queue: [...s.researchQueue],
      progress: s.researchProgress, unlocked: [...this.mods.unlocked],
      automation: this.mods.automation,
    });
    $alerts.set([...s.alerts]);
    $milestones.set({ done: [...s.milestonesDone], total: MILESTONES.length });
    $swarm.set({
      pct: s.swarmPct, launches: s.launches, armed: this.mods.launchArmed,
      canLaunch: this.mods.launchArmed && s.resources.foils >= LAUNCH_COST_FOILS &&
        s.resources.launch >= 1 && s.powerStored >= LAUNCH_POWER_BURST,
      burst: LAUNCH_POWER_BURST,
    });
    const sel = $selection.get();
    if (sel) {
      const live = s.buildings.find((b) => b.id === sel.id);
      $selection.set(live ? { ...live } : null);
    }
  }

  // ─────────────────────────── persistence ───────────────────────────

  async doSave() {
    if (!this.playing) return;
    const blob: SaveBlob = {
      state: this.state,
      player: {
        mode: this.modes.mode,
        x: this.walk.pos.x, y: this.walk.pos.y, z: this.walk.pos.z,
        yaw: this.walk.yaw, pitch: this.walk.pitch,
      },
      savedAt: Date.now(),
    };
    await saveGame(blob);
    $hasSave.set(true);
  }

  async continueSave(): Promise<boolean> {
    const blob = await loadGame();
    if (!blob) return false;
    this.loadFrom(blob);
    return true;
  }

  async newGame(siteId: SiteId) {
    await clearSave();
    this.startNew(siteId);
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

  debugCompleteTech(id: TechId) {
    if (!this.state.techsDone.includes(id)) {
      this.state.techsDone.push(id);
      this.mods = refreshDerived(this.state);
      this.publish();
    }
  }

  debugAdvance(gameSeconds: number) {
    // apply anything the UI/debug API queued this frame before ticking
    for (const a of this.actions.drain()) this.applyAction(a);
    let victory = false;
    let defeat = false;
    for (let i = 0; i < gameSeconds; i++) {
      const ev = economyTick(this.state, SITES[this.state.siteId], this.mods, 1);
      this.state.simTime += 1;
      if (ev.modsChanged) this.mods = computeMods(this.state.techsDone);
      if (ev.victory && !this.state.victoryShown) {
        this.state.victoryShown = true;
        victory = true;
      }
      if (ev.defeat && !this.state.defeatShown) {
        this.state.defeatShown = true;
        defeat = true;
      }
    }
    if (gameSeconds > 0) {
      this.instances.rebuild(this.state);
      this.publish();
    }
    if (victory) $victory.set(true);
    if (defeat) $defeat.set(true);
  }

  setModeInstant(m: 'build' | 'walk') {
    if (m === 'walk' && this.modes.mode !== 'walk') {
      const t = this.buildCam.controls.target;
      this.walk.spawnAt(t.x, t.z, 0);
    }
    this.modes.set(m);
  }

  get walkController() { return this.walk; }
}
