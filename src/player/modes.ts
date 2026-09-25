/** Build ⇄ walk transition: one camera, one smooth ~1.2 s dolly (no hard cut —
 *  continuity teaches the player the two views are the same place). The lens
 *  changes with it: 55° in command view (20° in the classic isometric one,
 *  whose clip planes the camera itself keeps), a wider 70° on foot (a suit
 *  visor, not a telephoto) with the near plane pulled in to 0.15 m. */
import * as THREE from 'three';
import { EYE_HEIGHT } from '../data/balance';
import { HOME_DIR, HOME_DIST, type CommandCam } from './buildCam';
import type { WalkController } from './walk';

export type Mode = 'build' | 'walk';

type Lens = { fov: number; near: number; far: number };
const LENS: Record<Mode, Lens> = {
  build: { fov: 55, near: 0.5, far: 16000 },
  walk: { fov: 70, near: 0.15, far: 16000 },
};

export class ModeManager {
  mode: Mode = 'build';
  private tween: {
    t: number; dur: number;
    fromPos: THREE.Vector3; toPos: THREE.Vector3;
    fromQuat: THREE.Quaternion; toQuat: THREE.Quaternion;
    fromFov: number; toFov: number;
    onDone: () => void;
  } | null = null;
  private savedBuildPos = HOME_DIR.clone().multiplyScalar(HOME_DIST);
  private savedBuildTarget = new THREE.Vector3(0, 0, 0);
  private lens: Record<Mode, Lens>;

  /** `buildLens`: the command view's lens when not the free camera's (the
   *  classic isometric view: narrow, its clip planes kept by the camera) */
  constructor(
    private camera: THREE.PerspectiveCamera,
    private buildCam: CommandCam,
    private walk: WalkController,
    private onModeChange: (m: Mode) => void,
    buildLens?: Lens,
  ) {
    this.lens = { ...LENS, build: buildLens ?? LENS.build };
    camera.fov = this.lens.build.fov;
    this.setLens(this.lens.build);
  }

  get transitioning(): boolean { return this.tween !== null; }

  toWalk() {
    if (this.mode !== 'build' || this.tween) return;
    this.savedBuildPos.copy(this.camera.position);
    this.savedBuildTarget.copy(this.buildCam.target);
    this.buildCam.enabled = false;

    const t = this.buildCam.target;
    this.walk.spawnAt(t.x, t.z, Math.atan2(
      this.camera.position.x - t.x,
      this.camera.position.z - t.z,
    ));
    const toPos = new THREE.Vector3(this.walk.pos.x, this.walk.pos.y + EYE_HEIGHT, this.walk.pos.z);
    const dummy = new THREE.Object3D();
    dummy.position.copy(toPos);
    dummy.rotation.set(0, 0, 0);
    dummy.rotateY(this.walk.yaw);
    dummy.rotateX(this.walk.pitch);
    this.setLens(this.lens.walk);
    this.startTween(toPos, dummy.quaternion.clone(), this.lens.walk.fov, () => {
      this.mode = 'walk';
      this.onModeChange('walk');
    });
  }

  toBuild() {
    if (this.mode !== 'walk' || this.tween) return;
    // rise back to the saved overhead framing, re-centered over the player
    const off = this.savedBuildPos.clone().sub(this.savedBuildTarget);
    const target = this.walk.pos.clone();
    const toPos = target.clone().add(off);
    const dummy = new THREE.Object3D();
    dummy.position.copy(toPos);
    dummy.lookAt(target);
    this.startTween(toPos, dummy.quaternion.clone(), this.lens.build.fov, () => {
      this.setLens(this.lens.build);
      this.mode = 'build';
      this.buildCam.target.copy(target);
      this.buildCam.enabled = true;
      this.onModeChange('build');
    });
  }

  toggle() {
    if (this.mode === 'build') this.toWalk();
    else this.toBuild();
  }

  /** Instant switch for headless tests / load. */
  set(mode: Mode) {
    this.tween = null;
    this.mode = mode;
    this.camera.fov = this.lens[mode].fov;
    this.setLens(this.lens[mode]);
    this.buildCam.enabled = mode === 'build';
    this.onModeChange(mode);
  }

  private setLens(lens: Lens) {
    this.camera.near = lens.near;
    this.camera.far = lens.far;
    this.camera.updateProjectionMatrix();
  }

  private startTween(toPos: THREE.Vector3, toQuat: THREE.Quaternion, toFov: number, onDone: () => void) {
    this.tween = {
      t: 0, dur: 1.2,
      fromPos: this.camera.position.clone(),
      toPos,
      fromQuat: this.camera.quaternion.clone(),
      toQuat,
      fromFov: this.camera.fov, toFov,
      onDone,
    };
  }

  /** Returns true while it owns the camera. */
  update(dt: number): boolean {
    if (!this.tween) return false;
    const tw = this.tween;
    tw.t += dt / tw.dur;
    const k = tw.t >= 1 ? 1 : 1 - Math.pow(1 - tw.t, 3); // ease-out cubic
    this.camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
    this.camera.quaternion.slerpQuaternions(tw.fromQuat, tw.toQuat, k);
    this.camera.fov = tw.fromFov + (tw.toFov - tw.fromFov) * k;
    this.camera.updateProjectionMatrix();
    if (tw.t >= 1) {
      this.tween = null;
      tw.onDone();
    }
    return true;
  }
}
