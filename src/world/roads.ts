/** The roads made visible (docs/15-roads.md §9): one merged, draped mesh of
 *  the open cells — the carriageway, kerbs where a cell has no road beside
 *  it, a centre mark on straights, parking stripes in bays — and one of the
 *  cells still being sintered (an outline, filling as the rovers work).
 *  Both are rebuilt on change only. The roadway tier changes the look:
 *
 *  | tier | carriageway | marks |
 *  |---|---|---|
 *  | Sintered Roads (start) | pale sintered regolith | dashed kerbs and centre |
 *  | Basalt Paving | dark basalt pavers | a pale solid centre line |
 *  | Guidance Beacons | as before | beacon posts on the kerbs, lit at night |
 *  | Guideway Rails | as before | twin steel rails down the centre |
 *  | Maglev Freight Lines | as before | a glowing coil strip down the centre |
 *
 *  Classic reads its colours from the classic palette (`road`, `roadMark`). */
import * as THREE from 'three';
import type { GameState } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import { cellCentre, cellKey, isOpen, roadMap } from '../core/roads';
import { ROAD } from '../data/roads';
import { CLASSIC_PALETTE } from '../buildings/classicBuilding';
import { materials } from './materials';
import { classicActive } from '../core/style';

const LIFT = 0.07;          // m over the ground
const MARK_LIFT = 0.09;
const H = 2;                // half a cell, m
const TIERS = ['basaltPaving', 'guidanceBeacons', 'guidewayRails', 'maglevFreight'] as const;

materials.define('road', new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.96, metalness: 0,
  polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
}));
materials.defineClassic('road', new THREE.MeshLambertMaterial({
  vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
}));

/** The roadway tier the techs done reach (0: sintered). */
export function roadTier(techsDone: readonly string[]): number {
  let t = 0;
  TIERS.forEach((id, i) => { if (techsDone.includes(id)) t = i + 1; });
  return t;
}

class Builder {
  pos: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  constructor(private hf: Heightfield) {}
  /** a quad draped over the ground: corners a b c d (counter-clockwise from above), `n` pieces each way */
  quad(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number, c: THREE.Color, lift: number, n = 1) {
    const base = this.pos.length / 3;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const u = i / n, v = j / n;
        // bilinear over the four corners
        const x = (ax * (1 - u) + bx * u) * (1 - v) + (dx * (1 - u) + cx * u) * v;
        const z = (az * (1 - u) + bz * u) * (1 - v) + (dz * (1 - u) + cz * u) * v;
        this.pos.push(x, this.hf.sample(x, z) + lift, z);
        this.col.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = base + j * (n + 1) + i, b = a + 1, d = a + n + 1, e = d + 1;
        this.idx.push(a, d, b, b, d, e);
      }
    }
  }
  /** an axis-aligned rectangle x0..x1 × z0..z1 */
  rect(x0: number, z0: number, x1: number, z1: number, c: THREE.Color, lift: number, n = 1) {
    this.quad(x0, z0, x1, z0, x1, z1, x0, z1, c, lift, n);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

export class RoadMesh {
  readonly group = new THREE.Group();
  private open: THREE.Mesh | null = null;
  private pending: THREE.Mesh | null = null;
  private glow: THREE.Mesh | null = null;
  private posts: THREE.InstancedMesh;
  private postMat: THREE.MeshBasicMaterial;
  private sig = '';
  private pendingSig = '';
  private tier = 0;
  private classic: boolean;
  private cells = 0;

  constructor(private hf: Heightfield, classic = classicActive()) {
    this.classic = classic;
    this.postMat = new THREE.MeshBasicMaterial({ color: 0x55504a });
    const post = new THREE.BoxGeometry(0.16, 0.9, 0.16);
    post.translate(0, 0.45, 0);
    this.posts = new THREE.InstancedMesh(post, this.postMat, 4096);
    this.posts.count = 0;
    this.posts.frustumCulled = false;
    this.group.add(this.posts);
  }

  private colors() {
    const pal = CLASSIC_PALETTE;
    const road = new THREE.Color(this.classic ? pal.road : 0x8a867f);
    const mark = new THREE.Color(this.classic ? pal.roadMark : 0xd9d4c8);
    if (this.tier >= 1) road.multiplyScalar(0.55); // basalt pavers
    const bay = road.clone().lerp(new THREE.Color(0x000000), 0.12);
    const rail = new THREE.Color(0xc9ccd1);
    return { road, mark, bay, rail };
  }

  /** Per frame: rebuild what changed; `night` lights the beacons. */
  update(s: GameState, night: number) {
    const tier = roadTier(s.techsDone);
    const sig = `${s.roadRev ?? 0}:${s.roads?.length ?? 0}:${tier}`;
    if (sig !== this.sig) {
      this.sig = sig;
      this.tier = tier;
      this.buildOpen(s);
    }
    // the cells being sintered fill as the rovers work (a few times a second is plenty)
    let pend = '';
    for (const c of s.roads ?? []) if (!isOpen(c)) pend += `${c.gx},${c.gz},${Math.round(c.left * 4)};`;
    if (pend !== this.pendingSig) {
      this.pendingSig = pend;
      this.buildPending(s);
    }
    // the beacons burn at night
    const k = Math.max(0, Math.min(1, night));
    this.postMat.color.setRGB(0.33 + 0.67 * k, 0.31 + 0.47 * k, 0.29 + 0.1 * k);
  }

  private buildOpen(s: GameState) {
    const map = roadMap(s);
    const { road, mark, bay, rail } = this.colors();
    const b = new Builder(this.hf);
    const glow = new Builder(this.hf);
    const posts: [number, number][] = [];
    let n = 0;
    for (const c of s.roads ?? []) {
      if (!isOpen(c)) continue;
      n++;
      const [x, z] = cellCentre(c.gx, c.gz);
      const has = (dx: number, dz: number) => { const o = map.get(cellKey(c.gx + dx, c.gz + dz)); return !!o && isOpen(o); };
      const E = has(1, 0), W = has(-1, 0), S = has(0, 1), N = has(0, -1);
      b.rect(x - H, z - H, x + H, z + H, c.bay ? bay : road, LIFT, 2);
      // kerbs where no road carries on (dashed on sintered roads)
      const dash = this.tier === 0;
      const kerb = (x0: number, z0: number, x1: number, z1: number) => {
        if (!dash) { b.rect(x0, z0, x1, z1, mark, MARK_LIFT, 2); return; }
        const along = x1 - x0 > z1 - z0;
        for (let k = 0; k < 2; k++) {
          if (along) b.rect(x0 + k * 2 + 0.2, z0, x0 + k * 2 + 1.4, z1, mark, MARK_LIFT);
          else b.rect(x0, z0 + k * 2 + 0.2, x1, z0 + k * 2 + 1.4, mark, MARK_LIFT);
        }
      };
      const kw = 0.18;
      if (!N) kerb(x - H, z - H + 0.1, x + H, z - H + 0.1 + kw);
      if (!S) kerb(x - H, z + H - 0.1 - kw, x + H, z + H - 0.1);
      if (!W) kerb(x - H + 0.1, z - H, x - H + 0.1 + kw, z + H);
      if (!E) kerb(x + H - 0.1 - kw, z - H, x + H - 0.1, z + H);
      if (c.bay) {
        // two parking stripes across the bay
        const alongX = E || W;
        for (const o of [-ROAD.lane * 2, 0, ROAD.lane * 2]) {
          if (alongX) b.rect(x - 1.2, z + o * 0.5 - 0.06, x + 1.2, z + o * 0.5 + 0.06, mark, MARK_LIFT);
          else b.rect(x + o * 0.5 - 0.06, z - 1.2, x + o * 0.5 + 0.06, z + 1.2, mark, MARK_LIFT);
        }
        continue;
      }
      // down the middle: a dashed (sintered) or solid (basalt) centre line on straights
      const straightX = (E || W) && !N && !S, straightZ = (N || S) && !E && !W;
      const cw = 0.09;
      if (straightX) {
        if (this.tier === 0) b.rect(x - 1, z - cw, x + 1, z + cw, mark, MARK_LIFT);
        else b.rect(x - H, z - cw, x + H, z + cw, mark, MARK_LIFT, 2);
      } else if (straightZ) {
        if (this.tier === 0) b.rect(x - cw, z - 1, x + cw, z + 1, mark, MARK_LIFT);
        else b.rect(x - cw, z - H, x + cw, z + H, mark, MARK_LIFT, 2);
      }
      // guideway rails, and the maglev strip, along every arm from the centre
      const arms: [number, number][] = [];
      if (E) arms.push([1, 0]); if (W) arms.push([-1, 0]); if (S) arms.push([0, 1]); if (N) arms.push([0, -1]);
      for (const [dx, dz] of arms) {
        const x1 = x + dx * H, z1 = z + dz * H;
        if (this.tier >= 3) {
          for (const o of [-0.55, 0.55]) {
            if (dx) b.rect(Math.min(x, x1), z + o - 0.07, Math.max(x, x1), z + o + 0.07, rail, MARK_LIFT + 0.02, 2);
            else b.rect(x + o - 0.07, Math.min(z, z1), x + o + 0.07, Math.max(z, z1), rail, MARK_LIFT + 0.02, 2);
          }
        }
        if (this.tier >= 4) {
          const g = new THREE.Color(0xbfe7ff);
          if (dx) glow.rect(Math.min(x, x1), z - 0.22, Math.max(x, x1), z + 0.22, g, MARK_LIFT + 0.03, 2);
          else glow.rect(x - 0.22, Math.min(z, z1), x + 0.22, Math.max(z, z1), g, MARK_LIFT + 0.03, 2);
        }
      }
      // guidance beacons on the kerb corners without a road beside
      if (this.tier >= 2) {
        if (!N && !W) posts.push([x - H + 0.3, z - H + 0.3]);
        if (!S && !E) posts.push([x + H - 0.3, z + H - 0.3]);
      }
    }
    this.cells = n;
    if (this.open) { this.group.remove(this.open); this.open.geometry.dispose(); }
    this.open = new THREE.Mesh(b.geometry(), materials.get('road'));
    this.open.receiveShadow = true;
    this.open.renderOrder = -1;
    this.group.add(this.open);
    if (this.glow) { this.group.remove(this.glow); this.glow.geometry.dispose(); this.glow = null; }
    if (glow.pos.length) {
      this.glow = new THREE.Mesh(glow.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true }));
      this.group.add(this.glow);
    }
    const m = new THREE.Matrix4();
    this.posts.count = Math.min(posts.length, 4096);
    for (let i = 0; i < this.posts.count; i++) {
      const [x, z] = posts[i];
      m.makeTranslation(x, this.hf.sample(x, z), z);
      this.posts.setMatrixAt(i, m);
    }
    this.posts.instanceMatrix.needsUpdate = true;
  }

  private buildPending(s: GameState) {
    const b = new Builder(this.hf);
    const { road, mark } = this.colors();
    const dim = road.clone().multiplyScalar(0.7);
    for (const c of s.roads ?? []) {
      if (isOpen(c)) continue;
      const [x, z] = cellCentre(c.gx, c.gz);
      const w = 0.16;
      // an outline, and the part sintered so far (from the centre out)
      b.rect(x - H, z - H, x + H, z - H + w, mark, MARK_LIFT);
      b.rect(x - H, z + H - w, x + H, z + H, mark, MARK_LIFT);
      b.rect(x - H, z - H, x - H + w, z + H, mark, MARK_LIFT);
      b.rect(x + H - w, z - H, x + H, z + H, mark, MARK_LIFT);
      const done = Math.max(0, Math.min(1, 1 - c.left / ROAD.cellS));
      if (done > 0.02) {
        const r = (H - w) * done;
        b.rect(x - r, z - r, x + r, z + r, dim, LIFT, 1);
      }
    }
    if (this.pending) { this.group.remove(this.pending); this.pending.geometry.dispose(); }
    this.pending = new THREE.Mesh(b.geometry(), materials.get('road'));
    this.group.add(this.pending);
  }

  info() {
    return { cells: this.cells, tier: this.tier, beacons: this.posts.count, glow: !!this.glow };
  }
}
