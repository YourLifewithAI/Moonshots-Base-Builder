/** Overhead build/plan camera — MapControls (left-drag pan, right-drag orbit,
 *  wheel zoom), clamped to keep the map in frame. */
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { MAP_M } from '../data/balance';

export class BuildCam {
  readonly controls: MapControls;

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.controls = new MapControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 18;
    this.controls.maxDistance = 700;
    this.controls.maxPolarAngle = Math.PI * 0.44;
    this.controls.target.set(0, 0, 0);
  }

  clampTarget() {
    const t = this.controls.target;
    const lim = MAP_M / 2 - 40;
    t.x = Math.min(lim, Math.max(-lim, t.x));
    t.z = Math.min(lim, Math.max(-lim, t.z));
  }

  update() {
    this.clampTarget();
    this.controls.update();
  }

  set enabled(v: boolean) { this.controls.enabled = v; }
  get enabled(): boolean { return this.controls.enabled; }
}
