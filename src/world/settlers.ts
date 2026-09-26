/** EVA walkers (docs/14 §4.3): the Colony's people outside. One suited
 *  figure per EVA crew member (`s.evaCrew`, economy step 3: a share of the
 *  free hands, by day, never into a flare; at most MAX_WALKERS drawn), so
 *  the game rule is what you see: walkers = EVA crew. They step out of a
 *  habitat's suit-port, lope to the arrays (dust), a worn machine or a
 *  building site, work there a while, and go on to the next; at night, or
 *  when the EVA crew shrinks, they walk home and go in.
 *
 *  Walkers keep to open ground: a 4 m grid of free cells — never a road
 *  cell (the carriageway, its bays and the Lander's apron), never a
 *  footprint, a link's leg or an excavator's dig — so they never meet the
 *  ground traffic (world/traffic.ts) or stand where a rover drives. They
 *  move cell centre to cell centre (plus a small fixed offset each, inside
 *  the cell), so every point of a walk lies on free cells. A target they
 *  cannot reach without crossing a road is skipped. Routes are planned
 *  (BFS) only when a walker sets off; per frame, nothing is allocated.
 *
 *  Visual only: the sim never reads them. One instanced figure on the
 *  building material (about 100 △, no shadow-map shadow: a contact decal
 *  like the rovers'), warm light. Game time: pause freezes them. */
import * as THREE from 'three';
import type { BuildingState, GameState } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import { cellAt, cellCentre, cellKey, footprintCells, roadMap } from '../core/roads';
import { footprintRect } from '../buildings/instances';
import { BODY, GLASS, LAMP, PLATE, box, merge, withInstanceState } from '../buildings/meshKit';
import { materials } from './materials';
import { blobTexture } from './rovers';
import { mixHash } from '../buildings/links';
import { CELL_M, MAP_CELLS, MAP_M } from '../data/balance';

type Cell = [number, number];

/** the most walkers drawn */
export const MAX_WALKERS = 24;
/** m/s: a lunar lope */
const SPEED = 1.3;
const SCALE = 1.2;
/** cells a walk may reach from its habitat */
const REACH = 45;
const PI = Math.PI;

/** The suited figure (about 100 △): legs, torso, arms, helmet and visor, a
 *  backpack, a headlamp. Feet at y 0, facing +z. */
function walkerGeometry(): THREE.BufferGeometry {
  const g = merge([
    box(0.17, 0.72, 0.2, BODY, -0.13, 0.36, 0), box(0.17, 0.72, 0.2, BODY, 0.13, 0.36, 0),
    box(0.5, 0.64, 0.34, BODY, 0, 1.04, 0),
    box(0.13, 0.56, 0.15, BODY, -0.33, 1.0, 0.02), box(0.13, 0.56, 0.15, BODY, 0.33, 1.0, 0.02),
    box(0.36, 0.34, 0.36, BODY, 0, 1.55, 0.01),
    box(0.28, 0.16, 0.04, GLASS, 0, 1.56, 0.2),
    box(0.42, 0.52, 0.2, PLATE, 0, 1.1, -0.26),
    box(0.08, 0.05, 0.04, LAMP, 0, 1.7, 0.2),
  ]);
  g.scale(SCALE, SCALE, SCALE);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

interface Walker {
  active: boolean;
  /** walking home to go in */
  going: boolean;
  /** working at its target (game seconds left) */
  work: number;
  home: number;
  x: number; z: number; yaw: number;
  /** its route: cell centres; it is between path[seg] and path[seg + 1] at t */
  path: Cell[];
  seg: number; t: number;
  trip: number;
  /** a fixed offset inside the cell (±0.6 m) */
  ox: number; oz: number;
  phase: number;
  moving: boolean;
}

interface Home { id: number; cell: Cell }

export class Settlers {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private decals: THREE.InstancedMesh;
  private decalMat: THREE.MeshBasicMaterial;
  private pool: Walker[] = [];
  private sig = NaN;
  /** cells a walker may stand on is: free = not blocked */
  private blocked = new Set<number>();
  private homes: Home[] = [];
  /** structures worth a walk: the arrays first, then the worn and the sites, then the rest */
  private targets: BuildingState[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private p = new THREE.Vector3();
  private sc = new THREE.Vector3(1, 1, 1);
  private clock = 0;
  private wanted = 0;
  private state: GameState | null = null;

  constructor(private hf: Heightfield) {
    const geo = withInstanceState(walkerGeometry(), MAX_WALKERS);
    this.mesh = new THREE.InstancedMesh(geo, materials.get('building'), MAX_WALKERS);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-PI / 2);
    this.decalMat = new THREE.MeshBasicMaterial({
      color: 0x000000, alphaMap: blobTexture(), transparent: true, opacity: 0.45, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    this.decals = new THREE.InstancedMesh(plane, this.decalMat, MAX_WALKERS);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 1;
    this.group.add(this.mesh, this.decals);
    for (let i = 0; i < MAX_WALKERS; i++) {
      this.pool.push({
        active: false, going: false, work: 0, home: -1, x: 0, z: 0, yaw: 0, path: [], seg: 0, t: 0, trip: 0,
        ox: (((i * 7) % 5) - 2) * 0.3, oz: (((i * 3) % 5) - 2) * 0.3, phase: i * 1.37, moving: false,
      });
    }
  }

  /** Per frame, `dt` game seconds (0 paused); `ground` = cells the links stand on. */
  update(dt: number, s: GameState, ground: ReadonlySet<number>, sunDir: THREE.Vector3, sunLight: number) {
    this.clock += dt;
    this.state = s;
    const sig = this.signature(s, ground.size);
    if (sig !== this.sig) {
      this.sig = sig;
      this.rebuild(s, ground);
    }
    // walkers = EVA crew (at most MAX_WALKERS), from the habitats that have a way out
    const want = this.homes.length ? Math.min(MAX_WALKERS, Math.max(0, s.evaCrew ?? 0)) : 0;
    this.wanted = want;
    let out = 0;
    for (const w of this.pool) if (w.active && !w.going) out++;
    for (let i = 0; i < this.pool.length && out < want; i++) {
      const w = this.pool[i];
      if (w.active) {
        // one walking home turns back out
        if (w.going) { w.going = false; this.plan(w); out++; }
        continue;
      }
      this.spawn(w, i);
      out++;
    }
    for (let i = this.pool.length - 1; i >= 0 && out > want; i--) {
      const w = this.pool[i];
      if (!w.active || w.going) continue;
      this.sendHome(w);
      out--;
    }
    for (const w of this.pool) if (w.active) this.step(w, dt);
    this.draw(sunDir, sunLight);
  }

  /** what the walk grid depends on (allocation-free) */
  private signature(s: GameState, links: number): number {
    let h = mixHash(mixHash(links, s.roadRev ?? 0), s.roads?.length ?? 0);
    for (const b of s.buildings) {
      h = mixHash(mixHash(mixHash(mixHash(mixHash(h, b.id), b.gx), b.gz), b.rot), (b.construction ?? 0) > 0 ? 1 : 0);
      h = mixHash(h, Math.round((b.wear ?? 0) * 4));
      if (b.haul) h = mixHash(mixHash(h, Math.round(b.haul.digX)), Math.round(b.haul.digZ));
    }
    return h;
  }

  /** The walk grid, the habitats' suit-ports and the targets, after a change. */
  private rebuild(s: GameState, ground: ReadonlySet<number>) {
    const blocked = this.blocked;
    blocked.clear();
    for (const b of s.buildings) {
      for (const k of footprintCells(b)) blocked.add(k);
      const h = b.haul;
      if (h && b.type === 'excavator') {
        const [gx, gz] = cellAt(h.digX, h.digZ);
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) blocked.add(cellKey(gx + dx, gz + dz));
      }
    }
    // every road cell: the carriageway, bays, cells still being sintered
    for (const c of roadMap(s).values()) blocked.add(cellKey(c.gx, c.gz));
    for (const k of ground) blocked.add(k);
    // homes: habitats (their suit-port on the +x side), then the domes and rings
    this.homes = [];
    for (const b of s.buildings) {
      if ((b.construction ?? 0) > 0) continue;
      if (b.type !== 'habitat' && b.type !== 'gardenDome' && b.type !== 'greenhouseRing') continue;
      const cell = this.suitport(b);
      if (cell) this.homes.push({ id: b.id, cell });
    }
    this.homes.sort((a, b) => a.id - b.id);
    const arrays = s.buildings.filter((b) => b.type === 'solar' && (b.construction ?? 0) <= 0);
    const busy = s.buildings.filter((b) => b.type !== 'solar' && ((b.construction ?? 0) > 0 || (b.wear ?? 0) > 0.25));
    const rest = s.buildings.filter((b) => b.type !== 'solar' && b.type !== 'lander' && !busy.includes(b));
    this.targets = [...arrays, ...busy, ...rest];
    // anyone now standing somewhere blocked (a road laid under them): replan from the nearest free cell
    for (const w of this.pool) {
      if (!w.active) continue;
      const c = this.cellOf(w);
      if (this.blocked.has(cellKey(c[0], c[1]))) {
        const free = this.nearestFree(c);
        if (!free) { w.active = false; continue; }
        const [x, z] = cellCentre(free[0], free[1]);
        w.x = x + w.ox; w.z = z + w.oz;
      }
      if (w.going) this.sendHome(w); else this.plan(w);
    }
  }

  /** the free cell a structure's walkers come out by: the habitat's suit-port side (+x), else any free side */
  private suitport(b: BuildingState): Cell | null {
    const r = footprintRect(b);
    const a = -b.rot * PI / 2;
    // local +x rotated as the mesh is
    const ux = Math.round(Math.cos(a)), uz = Math.round(-Math.sin(a));
    const cx = Math.floor((r.gx0 + r.gx1) / 2), cz = Math.floor((r.gz0 + r.gz1) / 2);
    const first: Cell = ux > 0 ? [r.gx1, cz] : ux < 0 ? [r.gx0 - 1, cz] : uz > 0 ? [cx, r.gz1] : [cx, r.gz0 - 1];
    if (!this.blocked.has(cellKey(first[0], first[1]))) return first;
    for (let x = r.gx0; x < r.gx1; x++) for (const z of [r.gz0 - 1, r.gz1]) if (!this.blocked.has(cellKey(x, z))) return [x, z];
    for (let z = r.gz0; z < r.gz1; z++) for (const x of [r.gx0 - 1, r.gx1]) if (!this.blocked.has(cellKey(x, z))) return [x, z];
    return null;
  }

  private cellOf(w: Walker): Cell {
    return cellAt(w.x - w.ox, w.z - w.oz);
  }

  private nearestFree(c: Cell): Cell | null {
    for (let r = 1; r < 6; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (!this.blocked.has(cellKey(c[0] + dx, c[1] + dz))) return [c[0] + dx, c[1] + dz];
      }
    }
    return null;
  }

  private spawn(w: Walker, slot: number) {
    const home = this.homes[slot % this.homes.length];
    w.active = true;
    w.going = false;
    w.home = home.id;
    w.trip = slot;
    w.work = 0;
    const [x, z] = cellCentre(home.cell[0], home.cell[1]);
    w.x = x + w.ox; w.z = z + w.oz;
    w.path = [];
    this.plan(w);
  }

  private sendHome(w: Walker) {
    w.going = true;
    w.work = 0;
    const home = this.homes.find((h) => h.id === w.home) ?? this.homes[0];
    const path = home ? this.route(this.cellOf(w), new Set([cellKey(home.cell[0], home.cell[1])])) : null;
    if (!path) { w.active = false; return; }
    this.walk(w, path);
  }

  /** the next target: a structure by the walker's slot and trip, reached by free cells only */
  private plan(w: Walker) {
    const from = this.cellOf(w);
    const n = this.targets.length;
    for (let k = 0; k < Math.min(n, 8); k++) {
      const b = this.targets[(w.trip * 5 + k * 3 + (w.trip >> 1)) % n];
      const goals = new Set<number>();
      const r = footprintRect(b);
      for (let x = r.gx0; x < r.gx1; x++) for (const z of [r.gz0 - 1, r.gz1]) goals.add(cellKey(x, z));
      for (let z = r.gz0; z < r.gz1; z++) for (const x of [r.gx0 - 1, r.gx1]) goals.add(cellKey(x, z));
      for (const g of goals) if (this.blocked.has(g)) goals.delete(g);
      if (!goals.size) continue;
      const path = this.route(from, goals);
      if (path && path.length > 1) { this.walk(w, path); return; }
    }
    // nowhere to go: a few cells about the habitat
    const goals = new Set<number>();
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const k = cellKey(from[0] + dx, from[1] + dz);
      if (!this.blocked.has(k) && (dx || dz) && ((dx * 3 + dz + w.trip) % 4 === 0)) goals.add(k);
    }
    const path = goals.size ? this.route(from, goals) : null;
    this.walk(w, path ?? [from]);
  }

  private walk(w: Walker, path: Cell[]) {
    w.path = path;
    w.seg = 0;
    w.t = 0;
    w.trip++;
  }

  /** BFS over free cells from `a` to the nearest of `goals` (cell keys), within REACH. */
  private route(a: Cell, goals: ReadonlySet<number>): Cell[] | null {
    const ak = cellKey(a[0], a[1]);
    if (goals.has(ak)) return [a];
    const from = new Map<number, number>([[ak, -1]]);
    const q = [ak];
    for (let i = 0; i < q.length && i < 8000; i++) {
      const k = q[i];
      const x = k % MAP_CELLS, z = Math.floor(k / MAP_CELLS);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 1 || nz < 1 || nx >= MAP_CELLS - 1 || nz >= MAP_CELLS - 1) continue;
        if (Math.abs(nx - a[0]) > REACH || Math.abs(nz - a[1]) > REACH) continue;
        const nk = cellKey(nx, nz);
        if (from.has(nk) || this.blocked.has(nk)) continue;
        from.set(nk, k);
        if (goals.has(nk)) {
          const out: Cell[] = [];
          for (let p = nk; p !== -1; p = from.get(p)!) out.push([p % MAP_CELLS, Math.floor(p / MAP_CELLS)]);
          return out.reverse();
        }
        q.push(nk);
      }
    }
    return null;
  }

  private step(w: Walker, dt: number) {
    w.moving = false;
    if (dt <= 0) return;
    if (w.work > 0) {
      w.work -= dt;
      if (w.work <= 0) this.plan(w);
      return;
    }
    const path = w.path;
    let move = SPEED * dt;
    while (move > 0 && w.seg < path.length - 1) {
      const dx = (path[w.seg + 1][0] - path[w.seg][0]) * CELL_M, dz = (path[w.seg + 1][1] - path[w.seg][1]) * CELL_M;
      const len = Math.hypot(dx, dz) || 1;
      const left = (1 - w.t) * len;
      if (move < left) { w.t += move / len; move = 0; } else { move -= left; w.seg++; w.t = 0; }
      w.yaw = Math.atan2(dx, dz);
      w.moving = true;
    }
    // on the segment between two free cell centres (+ its offset): every point on free cells
    const a = path[Math.min(w.seg, path.length - 1)], b = path[Math.min(w.seg + 1, path.length - 1)];
    const t = w.seg < path.length - 1 ? w.t : 0;
    w.x = ((a[0] + (b[0] - a[0]) * t) + 0.5) * CELL_M - MAP_M / 2 + w.ox;
    w.z = ((a[1] + (b[1] - a[1]) * t) + 0.5) * CELL_M - MAP_M / 2 + w.oz;
    if (w.seg >= path.length - 1) {
      if (w.going) { w.active = false; return; }
      // at the target: work a while (12–24 s)
      w.work = 12 + ((w.trip * 37) % 13);
    }
  }

  private draw(sunDir: THREE.Vector3, sunLight: number) {
    let n = 0;
    const elev = Math.max(0.1, Math.asin(Math.max(-1, Math.min(1, sunDir.y))));
    const smear = Math.min(5, (0.9 * SCALE) / Math.tan(elev));
    const hx = -sunDir.x, hz = -sunDir.z, hl = Math.hypot(hx, hz) || 1;
    const sx = hx / hl, sz = hz / hl, sunYaw = Math.atan2(sx, sz);
    for (const w of this.pool) {
      if (!w.active) continue;
      const g = this.hf.sample(w.x, w.z);
      const t = this.clock * 5.5 + w.phase;
      // a bounding lope while walking; a slow crouch-and-reach at work
      const bob = w.moving ? 0.14 * Math.abs(Math.sin(t)) : w.work > 0 ? 0.05 * Math.sin(this.clock * 1.4 + w.phase) : 0;
      const lean = w.moving ? 0.16 : w.work > 0 ? 0.22 + 0.1 * Math.sin(this.clock * 1.4 + w.phase) : 0;
      this.e.set(lean, w.yaw, 0);
      this.mesh.setMatrixAt(n, this.m.compose(this.p.set(w.x, g + bob, w.z), this.q.setFromEuler(this.e), this.sc.set(1, 1, 1)));
      const len = 0.8 + smear;
      const cx = w.x + sx * smear * 0.45, cz = w.z + sz * smear * 0.45;
      this.e.set(0, sunYaw, 0);
      this.decals.setMatrixAt(n, this.m.compose(this.p.set(cx, this.hf.sample(cx, cz) + 0.04, cz),
        this.q.setFromEuler(this.e), this.sc.set(0.8, 1, len)));
      n++;
    }
    this.mesh.count = n;
    this.decals.count = n;
    this.decals.visible = sunLight > 0.02 && n > 0;
    this.decalMat.opacity = 0.45 * sunLight;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.decals.instanceMatrix.needsUpdate = true;
  }

  /** How many walkers are within `r` m of a listener point (the radio squelch). */
  near(x: number, z: number, r: number): number {
    let n = 0;
    for (const w of this.pool) if (w.active && Math.hypot(w.x - x, w.z - z) < r) n++;
    return n;
  }

  info() {
    const s = this.state;
    const map = s ? roadMap(s) : new Map();
    const act = this.pool.filter((w) => w.active);
    const cells = act.map((w) => cellAt(w.x, w.z));
    let onFootprint = 0;
    if (s) {
      const fp = new Set<number>();
      for (const b of s.buildings) for (const k of footprintCells(b)) fp.add(k);
      onFootprint = cells.filter(([x, z]) => fp.has(cellKey(x, z))).length;
    }
    return {
      eva: this.wanted,
      out: act.filter((w) => !w.going).length,
      returning: act.filter((w) => w.going).length,
      drawn: this.mesh.count,
      working: act.filter((w) => w.work > 0).length,
      homes: this.homes.length,
      positions: act.map((w) => [Math.round(w.x * 100) / 100, Math.round(w.z * 100) / 100]),
      cells,
      onRoad: cells.filter(([x, z]) => map.has(cellKey(x, z))).length,
      onFootprint,
    };
  }
}
