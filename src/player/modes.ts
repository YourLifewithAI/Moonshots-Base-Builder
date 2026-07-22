/** Build ⇄ walk transition: one camera, one smooth ~1.2 s dolly (no hard cut —
 *  continuity teaches the player the two views are the same place). */
import * as THREE from 'three';
import { EYE_HEIGHT } from '../data/balance';
import type { BuildCam } from './buildCam';
import type { WalkController } from './walk';

export type Mode = 'build' | 'walk';

export class ModeManager {
  mode: Mode = 'build';
  private tween: {
    t: number; dur: number;
    fromPos: THREE.Vector3; toPos: THREE.Vector3;
    fromQuat: THREE.Quaternion; toQuat: THREE.Quaternion;
    onDone: () => void;
  } | null = null;
  private savedBuildPos = new THREE.Vector3(90, 110, 150);
  private savedBuildTarget = new THREE.Vector3(0, 0, 0);

  constructor(
    private camera: THREE.PerspectiveCamera,
    private buildCam: BuildCam,
    private walk: WalkController,
    private onModeChange: (m: Mode) => void,
  ) {}

  get transitioning(): boolean { return this.tween !== null; }

  toWalk() {
    if (this.mode !== 'build' || this.tween) return;
    this.savedBuildPos.copy(this.camera.position);
    this.savedBuildTarget.copy(this.buildCam.controls.target);
    this.buildCam.enabled = false;

    const t = this.buildCam.controls.target;
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
    this.startTween(toPos, dummy.quaternion.clone(), () => {
      this.mode = 'walk';
      this.onModeChange('walk');
    });
  }

  toBuild() {
    if (this.mode !== 'walk' || this.tween) return;
    // rise back to the saved overhead framing, re-centered over the player
    const off = this.savedBuildPos.clone().sub(this.savedBuildTarget);
    const target = new THREE.Vector3(this.walk.pos.x, 0, this.walk.pos.z);
    const toPos = target.clone().add(off);
    const dummy = new THREE.Object3D();
    dummy.position.copy(toPos);
    dummy.lookAt(target);
    this.startTween(toPos, dummy.quaternion.clone(), () => {
      this.mode = 'build';
      this.buildCam.controls.target.copy(target);
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
    this.buildCam.enabled = mode === 'build';
    this.onModeChange(mode);
  }

  private startTween(toPos: THREE.Vector3, toQuat: THREE.Quaternion, onDone: () => void) {
    this.tween = {
      t: 0, dur: 1.2,
      fromPos: this.camera.position.clone(),
      toPos,
      fromQuat: this.camera.quaternion.clone(),
      toQuat,
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
    if (tw.t >= 1) {
      this.tween = null;
      tw.onDone();
    }
    return true;
  }
}
