/** The roads made visible (docs/15-roads.md §9, docs/19 S3): one merged, draped mesh of
 *  the open cells — the carriageway with its inner corners filleted, kerbs on the
 *  outer edges only (dashed on sintered roads), a centre line that runs on through
 *  bends, passing and holding bays as a widened shoulder with a dashed edge,
 *  parking stripes in bays — an ink line along the road's edge (`drapedLine(…,
 *  'road')`), and one mesh of the cells still being sintered (an outline, filling as
 *  the rovers work). Both meshes are rebuilt on change only. The roadway tier
 *  changes the look:
 *
 *  | tier | carriageway | marks |
 *  |---|---|---|
 *  | Sintered Roads (start) | pale sintered regolith | dashed kerbs and centre |
 *  | Basalt Paving | dark basalt pavers | a pale solid centre line |
 *  | Guidance Beacons | as before | beacon posts on the kerbs, lit at night |
 *  | Guideway Rails | as before | twin steel rails down the centre |
 *  | Maglev Freight Lines | as before | a glowing coil strip down the centre |
 *
 *  A gate (`RoadCell.gate`, core/roads.ts: where a road stops at an extraction zone's
 *  rim) carries a striped line across its edge facing into the zone.
 *
 *  Its colours come from the cel palette (`road`, `roadMark`). */
import * as THREE from 'three';
import type { GameState } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import { cellCentre, cellKey, footprintCells, isGate, isOpen, roadMap } from '../core/roads';
import { zoneCells } from '../core/zones';
import { MAP_CELLS } from '../data/balance';
import { ROAD } from '../data/roads';
import { CEL_PALETTE } from '../buildings/celBuilding';
import { materials } from './materials';
import { celSurface } from './celSurface';
import { drape, drapedLine } from './ink';

const LIFT = 0.07;          // m over the ground
const MARK_LIFT = 0.09;
const H = 2;                // half a cell, m
const FILLET = 1.4;         // the radius of a bend's inner corner, m
const FILLET_SEG = 4;
const TIERS = ['basaltPaving', 'guidanceBeacons', 'guidewayRails', 'maglevFreight'] as const;

materials.define('road', celSurface('cel-road', {
  vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
}), () => new THREE.MeshLambertMaterial({
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
  /** a triangle draped over the ground (wound so it faces up) */
  tri(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, c: THREE.Color, lift: number) {
    const base = this.pos.length / 3;
    for (const [x, z] of [[ax, az], [bx, bz], [cx, cz]]) {
      this.pos.push(x, this.hf.sample(x, z) + lift, z);
      this.col.push(c.r, c.g, c.b);
    }
    const n = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (n >= 0) this.idx.push(base, base + 1, base + 2); else this.idx.push(base, base + 2, base + 1);
  }
  /** a strip of width w along the segment (x0, z0)–(x1, z1) */
  seg(x0: number, z0: number, x1: number, z1: number, w: number, c: THREE.Color, lift: number) {
    const l = Math.hypot(x1 - x0, z1 - z0) || 1;
    const px = ((z1 - z0) / l) * (w / 2), pz = (-(x1 - x0) / l) * (w / 2);
    this.quad(x0 + px, z0 + pz, x1 + px, z1 + pz, x1 - px, z1 - pz, x0 - px, z0 - pz, c, lift);
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
  /** the road's edge in ink (drapedLine 'road'), one line a loop of the network's boundary */
  private ink: THREE.Line[] = [];
  private posts: THREE.InstancedMesh;
  private postMat: THREE.MeshBasicMaterial;
  private sig = '';
  private pendingSig = '';
  private tier = 0;
  private cells = 0;

  constructor(private hf: Heightfield) {
    this.postMat = new THREE.MeshBasicMaterial({ color: 0x55504a });
    const post = new THREE.BoxGeometry(0.16, 0.9, 0.16);
    post.translate(0, 0.45, 0);
    this.posts = new THREE.InstancedMesh(post, this.postMat, 4096);
    this.posts.count = 0;
    this.posts.frustumCulled = false;
    this.group.add(this.posts);
  }

  private colors() {
    const pal = CEL_PALETTE;
    const road = new THREE.Color(pal.road);
    const mark = new THREE.Color(pal.roadMark);
    if (this.tier >= 1) road.multiplyScalar(0.55); // basalt pavers
    const bay = road.clone().lerp(new THREE.Color(0x000000), 0.12);
    const rail = new THREE.Color(0xc9ccd1);
    return { road, mark, bay, rail };
  }

  /** Per frame: rebuild what changed; `night` lights the beacons. */
  update(s: GameState, night: number) {
    const tier = roadTier(s.techsDone);
    const sig = `${s.roadRev ?? 0}:${s.roads?.length ?? 0}:${tier}:z${s.zones?.length ?? 0}`;
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
    const zones = zoneCells(s);
    const { road, mark, bay, rail } = this.colors();
    const b = new Builder(this.hf);
    const glow = new Builder(this.hf);
    const posts: [number, number][] = [];
    const dash = this.tier === 0;
    const occ = new Set<number>();
    for (const o of s.buildings) for (const k of footprintCells(o)) occ.add(k);
    const openAt = (gx: number, gz: number) => { const o = map.get(cellKey(gx, gz)); return !!o && isOpen(o); };
    // a carriageway proper: not a bay, nor a shoulder (a passing or holding bay)
    const wayAt = (gx: number, gz: number) => { const o = map.get(cellKey(gx, gz)); return !!o && isOpen(o) && !o.bay && !o.pass && !o.hold; };
    const vkey = (vx: number, vz: number) => vz * (MAP_CELLS + 1) + vx;
    const vworld = (vx: number, vz: number): [number, number] => { const [x, z] = cellCentre(vx, vz); return [x - H, z - H]; };
    // the inner corners of bends, filleted: a road's inner corner vertex → true (docs/19 S3)
    const fillets = new Set<number>();
    const DIAG: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const c of s.roads ?? []) {
      if (!isOpen(c) || c.bay || c.pass || c.hold) continue;
      for (const [dx, dz] of DIAG) {
        if (!wayAt(c.gx + dx, c.gz) || !wayAt(c.gx, c.gz + dz) || openAt(c.gx + dx, c.gz + dz) || occ.has(cellKey(c.gx + dx, c.gz + dz))) continue;
        fillets.add(vkey(c.gx + (dx > 0 ? 1 : 0), c.gz + (dz > 0 ? 1 : 0)));
      }
    }
    let n = 0;
    for (const c of s.roads ?? []) {
      if (!isOpen(c)) continue;
      n++;
      const [x, z] = cellCentre(c.gx, c.gz);
      const has = (dx: number, dz: number) => openAt(c.gx + dx, c.gz + dz);
      const E = has(1, 0), W = has(-1, 0), S = has(0, 1), N = has(0, -1);
      const shoulder = !!(c.pass || c.hold);
      b.rect(x - H, z - H, x + H, z + H, c.bay ? bay : road, LIFT, 2);
      // the inner corners of bends: pavement rounds off the notch (a fillet), its edge a short arc
      if (!c.bay && !shoulder) {
        for (const [dx, dz] of DIAG) {
          if (!fillets.has(vkey(c.gx + (dx > 0 ? 1 : 0), c.gz + (dz > 0 ? 1 : 0)))) continue;
          if (!(wayAt(c.gx + dx, c.gz) && wayAt(c.gx, c.gz + dz) && !has(dx, dz))) continue;
          const vx = x + dx * H, vz = z + dz * H;
          const cx = vx + dx * FILLET, cz = vz + dz * FILLET;
          let px = vx + dx * FILLET, pz = vz;
          for (let i = 1; i <= FILLET_SEG; i++) {
            const t = (i / FILLET_SEG) * (Math.PI / 2);
            const qx = cx - dx * FILLET * Math.sin(t), qz = cz - dz * FILLET * Math.cos(t);
            b.tri(vx, vz, px, pz, qx, qz, road, LIFT);
            b.seg(px, pz, qx, qz, 0.18, mark, MARK_LIFT);
            px = qx; pz = qz;
          }
        }
      }
      // kerbs on the outer edges only — a side no road carries on from — trimmed short of a filleted
      // corner; dashed on sintered roads. A shoulder has a dashed edge instead.
      const side = (vx0: number, vz0: number, vx1: number, vz1: number, ax: number, az: number, bx: number, bz: number) => {
        // the side from (ax, az) to (bx, bz) (world); its ends' vertices decide the trims
        const t0 = fillets.has(vkey(vx0, vz0)) ? FILLET : 0, t1 = fillets.has(vkey(vx1, vz1)) ? FILLET : 0;
        const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
        const pieces: [number, number][] = shoulder ? [[0.3, 1.1], [1.6, 2.4], [2.9, 3.7]] : dash ? [[0.2, 1.4], [2.2, 3.4]] : [[0, len]];
        const inset = shoulder ? 0.3 : 0.1, w = shoulder ? 0.16 : 0.18;
        // inward normal: toward the cell's centre
        const nx = uz, nz = -ux;
        const sgn = (x - ax) * nx + (z - az) * nz >= 0 ? 1 : -1;
        for (const [u0, u1] of pieces) {
          const a0 = Math.max(u0, t0), a1 = Math.min(u1, len - t1);
          if (a1 - a0 < 0.15) continue;
          const o = (inset + w / 2) * sgn;
          b.seg(ax + ux * a0 + nx * o, az + uz * a0 + nz * o, ax + ux * a1 + nx * o, az + uz * a1 + nz * o, w, mark, MARK_LIFT);
        }
      };
      if (!N) side(c.gx, c.gz, c.gx + 1, c.gz, x - H, z - H, x + H, z - H);
      if (!S) side(c.gx, c.gz + 1, c.gx + 1, c.gz + 1, x - H, z + H, x + H, z + H);
      if (!W) side(c.gx, c.gz, c.gx, c.gz + 1, x - H, z - H, x - H, z + H);
      if (!E) side(c.gx + 1, c.gz, c.gx + 1, c.gz + 1, x + H, z - H, x + H, z + H);
      // a gate (RoadCell.gate, core/roads.ts): the road stops at an extraction zone's rim; a
      // striped line across its edge facing into the zone, where units go on off-road
      if (!c.bay && !shoulder && isGate(s, c.gx, c.gz)) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          if (has(dx, dz) || !zones.has(cellKey(c.gx + dx, c.gz + dz))) continue;
          const ex = x + dx * (H - 0.45), ez = z + dz * (H - 0.45);
          for (let k = -1; k <= 1; k++) {
            const o = k * 1.2;
            if (dx) b.rect(ex - 0.2, ez + o - 0.4, ex + 0.2, ez + o + 0.4, mark, MARK_LIFT, 1);
            else b.rect(ex + o - 0.4, ez - 0.2, ex + o + 0.4, ez + 0.2, mark, MARK_LIFT, 1);
          }
        }
      }
      if (c.bay) {
        // two parking stripes across the bay
        const alongX = E || W;
        for (const o of [-ROAD.lane * 2, 0, ROAD.lane * 2]) {
          if (alongX) b.rect(x - 1.2, z + o * 0.5 - 0.06, x + 1.2, z + o * 0.5 + 0.06, mark, MARK_LIFT);
          else b.rect(x + o * 0.5 - 0.06, z - 1.2, x + o * 0.5 + 0.06, z + 1.2, mark, MARK_LIFT);
        }
        continue;
      }
      // down the middle: a dashed (sintered) or solid (basalt) centre line, on through a bend
      // (a quarter circle about its inner corner); nothing across a junction or a shoulder
      const cw = 0.09;
      const arms: [number, number][] = [];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (!shoulder && wayAt(c.gx + dx, c.gz + dz)) arms.push([dx, dz]);
      if (arms.length === 2) {
        const [a, o] = arms;
        if (a[0] + o[0] === 0 && a[1] + o[1] === 0) {
          if (a[0] !== 0) { if (dash) b.rect(x - 1, z - cw, x + 1, z + cw, mark, MARK_LIFT); else b.rect(x - H, z - cw, x + H, z + cw, mark, MARK_LIFT, 2); }
          else if (dash) b.rect(x - cw, z - 1, x + cw, z + 1, mark, MARK_LIFT);
          else b.rect(x - cw, z - H, x + cw, z + H, mark, MARK_LIFT, 2);
        } else {
          const vx = x + (a[0] + o[0]) * H, vz = z + (a[1] + o[1]) * H;
          const K = 6;
          let px = vx - H * o[0], pz = vz - H * o[1];
          for (let i = 1; i <= K; i++) {
            const t = (i / K) * (Math.PI / 2);
            const qx = vx - H * (o[0] * Math.cos(t) + a[0] * Math.sin(t)), qz = vz - H * (o[1] * Math.cos(t) + a[1] * Math.sin(t));
            if (!dash || (i >= 2 && i <= K - 1)) b.seg(px, pz, qx, qz, cw * 2, mark, MARK_LIFT);
            px = qx; pz = qz;
          }
        }
      }
      // guideway rails, and the maglev strip, along every arm from the centre
      const lay: [number, number][] = [];
      if (E) lay.push([1, 0]); if (W) lay.push([-1, 0]); if (S) lay.push([0, 1]); if (N) lay.push([0, -1]);
      for (const [dx, dz] of lay) {
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
      if (this.tier >= 2 && !shoulder) {
        if (!N && !W) posts.push([x - H + 0.3, z - H + 0.3]);
        if (!S && !E) posts.push([x + H - 0.3, z + H - 0.3]);
      }
    }
    this.cells = n;
    this.buildInk(s, fillets, openAt, vkey, vworld);
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

  /** The ink along the road's edge (docs/19 S3): the boundary of the open cells, walked clockwise into
   *  loops, its filleted corners as arcs, draped on the ground: one `drapedLine(…, 'road')` a loop. */
  private buildInk(
    s: GameState, fillets: Set<number>, openAt: (gx: number, gz: number) => boolean,
    vkey: (vx: number, vz: number) => number, vworld: (vx: number, vz: number) => [number, number],
  ) {
    for (const l of this.ink) { this.group.remove(l); l.geometry.dispose(); (l.material as THREE.Material).dispose(); }
    this.ink = [];
    const next = new Map<number, number[]>();
    const at = new Map<number, [number, number]>();
    const edge = (ax: number, az: number, bx: number, bz: number) => {
      const a = vkey(ax, az), b = vkey(bx, bz);
      at.set(a, [ax, az]); at.set(b, [bx, bz]);
      const l = next.get(a);
      if (l) l.push(b); else next.set(a, [b]);
    };
    for (const c of s.roads ?? []) {
      if (!isOpen(c)) continue;
      const { gx, gz } = c;
      if (!openAt(gx, gz - 1)) edge(gx, gz, gx + 1, gz);
      if (!openAt(gx + 1, gz)) edge(gx + 1, gz, gx + 1, gz + 1);
      if (!openAt(gx, gz + 1)) edge(gx + 1, gz + 1, gx, gz + 1);
      if (!openAt(gx - 1, gz)) edge(gx, gz + 1, gx, gz);
    }
    const used = new Set<string>();
    const starts = [...next.keys()].sort((a, b) => a - b);
    for (const st of starts) {
      for (const first of next.get(st)!) {
        if (used.has(`${st}>${first}`)) continue;
        // walk the loop: vertices in order, back to the start
        const loop: number[] = [st];
        let a = st, b = first;
        for (let guard = 0; guard < 100000; guard++) {
          used.add(`${a}>${b}`);
          if (b === st) break;
          loop.push(b);
          const opts = (next.get(b) ?? []).filter((q) => !used.has(`${b}>${q}`));
          if (!opts.length) break;
          a = b; b = opts[0];
        }
        if (loop.length < 3) continue;
        const pts: [number, number][] = [];
        const L = loop.length;
        for (let i = 0; i < L; i++) {
          const v = loop[i], [vx, vz] = at.get(v)!;
          const [px, pz] = at.get(loop[(i + L - 1) % L])!, [nx, nz] = at.get(loop[(i + 1) % L])!;
          const [wx, wz] = vworld(vx, vz);
          if (fillets.has(v)) {
            // the corner's arc: in along the edge it came by, out along the one it leaves by
            const din: [number, number] = [Math.sign(vx - px), Math.sign(vz - pz)], dout: [number, number] = [Math.sign(nx - vx), Math.sign(nz - vz)];
            const ix = wx - din[0] * FILLET, iz = wz - din[1] * FILLET;
            const cx = ix + dout[0] * FILLET, cz = iz + dout[1] * FILLET;
            const ux = (ix - cx) / FILLET, uz = (iz - cz) / FILLET;
            const ox = wx + dout[0] * FILLET, oz = wz + dout[1] * FILLET;
            const vxn = (ox - cx) / FILLET, vzn = (oz - cz) / FILLET;
            for (let k = 0; k <= FILLET_SEG; k++) {
              const t = (k / FILLET_SEG) * (Math.PI / 2);
              pts.push([cx + FILLET * (ux * Math.cos(t) + vxn * Math.sin(t)), cz + FILLET * (uz * Math.cos(t) + vzn * Math.sin(t))]);
            }
          } else pts.push([wx, wz]);
        }
        pts.push(pts[0]);
        // a point every 2 m at most, so the line follows the ground
        const dense: [number, number][] = [pts[0]];
        for (let i = 1; i < pts.length; i++) {
          const [x0, z0] = pts[i - 1], [x1, z1] = pts[i];
          const k = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 2));
          for (let j = 1; j <= k; j++) dense.push([x0 + ((x1 - x0) * j) / k, z0 + ((z1 - z0) * j) / k]);
        }
        const line = drapedLine(drape(this.hf, dense, 0.13), 'road');
        this.group.add(line);
        this.ink.push(line);
      }
    }
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
    return { cells: this.cells, tier: this.tier, beacons: this.posts.count, glow: !!this.glow, ink: this.ink.length };
  }
}
