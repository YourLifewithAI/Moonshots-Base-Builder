/** First-person astronaut controller. Real lunar gravity (1.62 m/s²): jumps are
 *  high and slow, arcs are long — the floatiness IS the moon feel. Capsule vs
 *  analytic heightfield + building AABBs; no physics engine. Runs on real dt so
 *  pausing the economy still lets you wander the frozen base. */
import * as THREE from 'three';
import { EYE_HEIGHT, GRAVITY, JUMP_V, MAP_M, PLAYER_RADIUS, WALK_SPEED } from '../data/balance';
import type { Heightfield } from '../terrain/heightfield';

interface Collider { minX: number; maxX: number; minZ: number; maxZ: number; top: number }

export class WalkController {
  pos = new THREE.Vector3();
  yaw = 0;
  pitch = -0.05;
  private velY = 0;
  private grounded = true;
  private keys = new Set<string>();
  colliders: Collider[] = [];

  constructor(private hf: Heightfield) {}

  spawnAt(x: number, z: number, yaw = 0) {
    // never materialize inside a structure: spiral outward to the first free spot
    const inside = (px: number, pz: number) => this.colliders.some((c) =>
      px > c.minX - PLAYER_RADIUS && px < c.maxX + PLAYER_RADIUS &&
      pz > c.minZ - PLAYER_RADIUS && pz < c.maxZ + PLAYER_RADIUS);
    if (inside(x, z)) {
      outer: for (let r = 3; r < 60; r += 3) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
          const nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r;
          if (!inside(nx, nz)) { x = nx; z = nz; break outer; }
        }
      }
    }
    this.pos.set(x, this.hf.sample(x, z), z);
    this.velY = 0;
    this.yaw = yaw;
    this.pitch = -0.05;
  }

  keyDown(code: string) { this.keys.add(code); }
  keyUp(code: string) { this.keys.delete(code); }
  clearKeys() { this.keys.clear(); }

  look(dx: number, dy: number) {
    this.yaw -= dx * 0.0024;
    this.pitch = Math.min(1.45, Math.max(-1.45, this.pitch - dy * 0.0024));
  }

  update(dt: number) {
    dt = Math.min(dt, 0.1); // matches the frame clamp; low-fps machines stay walkable
    // arrow-key look (works without pointer lock; accessibility + headless tests)
    if (this.keys.has('ArrowLeft')) this.yaw += 1.8 * dt;
    if (this.keys.has('ArrowRight')) this.yaw -= 1.8 * dt;
    if (this.keys.has('ArrowUp')) this.pitch = Math.min(1.45, this.pitch + 1.2 * dt);
    if (this.keys.has('ArrowDown')) this.pitch = Math.max(-1.45, this.pitch - 1.2 * dt);

    const fwd = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const strafe = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 1.6 : 1;
    const airControl = this.grounded ? 1 : 0.25; // vacuum: you can't steer a leap much

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let vx = (fwd * -sin + strafe * cos) * WALK_SPEED * sprint;
    let vz = (fwd * -cos + strafe * -sin) * WALK_SPEED * sprint;
    if (fwd !== 0 && strafe !== 0) { vx *= 0.7071; vz *= 0.7071; }

    this.pos.x += vx * airControl * dt;
    this.pos.z += vz * airControl * dt;

    // map bounds
    const lim = MAP_M / 2 - 6;
    this.pos.x = Math.min(lim, Math.max(-lim, this.pos.x));
    this.pos.z = Math.min(lim, Math.max(-lim, this.pos.z));

    // building push-out (XZ, cylinder-vs-AABB)
    for (const c of this.colliders) {
      const nx = Math.min(Math.max(this.pos.x, c.minX), c.maxX);
      const nz = Math.min(Math.max(this.pos.z, c.minZ), c.maxZ);
      const dx = this.pos.x - nx, dz = this.pos.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 < PLAYER_RADIUS * PLAYER_RADIUS) {
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          this.pos.x = nx + (dx / d) * PLAYER_RADIUS;
          this.pos.z = nz + (dz / d) * PLAYER_RADIUS;
        } else {
          // inside the box: push out the nearest face
          const pushL = this.pos.x - c.minX, pushR = c.maxX - this.pos.x;
          const pushN = this.pos.z - c.minZ, pushF = c.maxZ - this.pos.z;
          const m = Math.min(pushL, pushR, pushN, pushF);
          if (m === pushL) this.pos.x = c.minX - PLAYER_RADIUS;
          else if (m === pushR) this.pos.x = c.maxX + PLAYER_RADIUS;
          else if (m === pushN) this.pos.z = c.minZ - PLAYER_RADIUS;
          else this.pos.z = c.maxZ + PLAYER_RADIUS;
        }
      }
    }

    // vertical: lunar gravity + ground snap
    const ground = this.hf.sample(this.pos.x, this.pos.z);
    if (this.grounded && this.keys.has('Space')) {
      this.velY = JUMP_V;
      this.grounded = false;
    }
    if (!this.grounded) {
      this.velY -= GRAVITY * dt;
      this.pos.y += this.velY * dt;
      if (this.pos.y <= ground) { this.pos.y = ground; this.velY = 0; this.grounded = true; }
    } else {
      // walk up/down slopes; fall if the ground drops away
      if (this.pos.y > ground + 0.4) this.grounded = false;
      else this.pos.y = ground;
    }
  }

  applyToCamera(cam: THREE.PerspectiveCamera) {
    cam.position.set(this.pos.x, this.pos.y + EYE_HEIGHT, this.pos.z);
    cam.rotation.set(0, 0, 0);
    cam.rotateY(this.yaw);
    cam.rotateX(this.pitch);
  }

  lookRay(): { origin: THREE.Vector3; dir: THREE.Vector3 } {
    const dir = new THREE.Vector3(0, 0, -1)
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    return { origin: new THREE.Vector3(this.pos.x, this.pos.y + EYE_HEIGHT, this.pos.z), dir };
  }
}
