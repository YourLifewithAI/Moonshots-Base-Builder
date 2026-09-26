/** The base-wide links (docs/14 §4.3): what joins the buildings once the
 *  destiny tilts the base.
 *
 *   ⌂ walkways    from Crew Rotation Charter: pressurized tubes on short
 *                 legs between habitable buildings (habitats, farms, the
 *                 Recreation Dome, labs, the rings and domes; with
 *                 Pressure-Rated Halls the workshops too); glazed with a
 *                 lit window strip from Garden Domes.
 *   ◉ spines      from Lights-Out Fabs: box-truss conveyor belts at 1.2 m
 *                 between the industry (excavator pads, smelters,
 *                 refineries, fabs, foil factories, storage yards); cold
 *                 lamp chevrons every cell from Replicator Stacks.
 *
 *  Pure planning on the build grid (planLinks), then one merged mesh per
 *  layer, rebuilt like the berms only when its signature changes. Each
 *  layer is an InstancedMesh of one instance on the building material, so
 *  it lights, colours (the Classic palette) and warms (iWarm: walkways
 *  warm, spines cold) like the buildings.
 *
 *  Links and roads (docs/15). A link never sits on a road cell, a door or a
 *  bay. The crossing rule, one rule for both layers: a link crosses a road
 *  only straight across, at most 2 road cells at a time, as a raised
 *  skybridge — it climbs to BRIDGE_M over the ground on a TRIM gantry whose
 *  two posts stand on the free cells either side, so nothing of it touches
 *  the carriageway and a rover or an excavator passes under with metres to
 *  spare. Door cells, bays and the Lander's apron are never crossed, not
 *  even from above; nor is a bend ever made over a road.
 *
 *  Routes: straight, or one L-bend, from a free cell beside one footprint to
 *  a free cell beside the other, never through a footprint, an excavator's
 *  dig or another link. Pairs join nearest first as a spanning forest (no
 *  loops: every pair already joined through others is skipped), at most
 *  MAX_LINKS a layer. */
import * as THREE from 'three';
import type { BuildingId } from '../data/buildings';
import { MAP_CELLS } from '../data/balance';
import type { BuildingState, GameState } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import { cellAt, cellCentre, cellKey, doorCell, footprintCells, roadMap } from '../core/roads';
import { materials } from '../world/materials';
import { footprintRect } from './instances';
import { BODY, LAMP, PLATE, TRIM, WINDOW, bar, box, merge, pipe, withInstanceState } from './meshKit';

type Cell = [number, number];
export type LinkLayer = 'walkway' | 'spine';

/** at most this many links a layer */
export const MAX_LINKS = 40;
/** m a skybridge's tube runs over the ground at a road crossing */
export const BRIDGE_M = 5.4;
/** the most road cells one crossing spans */
const MAX_SPAN = 2;
/** footprint gap a link may bridge, cells (walkways ≈ 18 m door to door, spines ≈ 24 m) */
const GAP: Record<LinkLayer, number> = { walkway: 4, spine: 6 };
/** tube / belt centre height over the ground, m */
const HEIGHT: Record<LinkLayer, number> = { walkway: 1.35, spine: 1.2 };
/** how far into the footprint the tube reaches (into the wall), m */
const INSET = 1.3;
/** where a bridge landing on a building stands its riser: just inside the footprint, m */
const EDGE = 0.45;

const WALKWAY_BASE: ReadonlySet<BuildingId> = new Set<BuildingId>([
  'habitat', 'hydroponics', 'recDome', 'lab', 'greenhouseRing', 'gardenDome',
]);
const WALKWAY_HALLS: ReadonlySet<BuildingId> = new Set<BuildingId>(['partsFab', 'roboticsBay']);
const SPINE_TYPES: ReadonlySet<BuildingId> = new Set<BuildingId>([
  'excavator', 'smelter', 'refinery', 'partsFab', 'chipFab', 'foilFactory', 'storageYard',
]);

export interface Link {
  layer: LinkLayer;
  a: number; b: number;
  /** its cells, from beside a to beside b */
  cells: Cell[];
  /** per cell: a road cell it bridges over */
  over: boolean[];
}

/** Which layers are on, from the techs done. */
export function linkLayers(techsDone: readonly string[]) {
  return {
    walkway: techsDone.includes('crewCharter'),
    glazed: techsDone.includes('gardenDomes'),
    halls: techsDone.includes('pressureHalls'),
    spine: techsDone.includes('lightsOutFabs'),
    chevrons: techsDone.includes('replicatorStacks'),
  };
}

const built = (b: BuildingState) => (b.construction ?? 0) <= 0;

/** What the plan depends on, as a number (allocation-free, per frame): the
 *  techs that switch layers, the structures, the road network, and where
 *  the excavators dig. */
export function linkSignature(s: GameState): number {
  const t = s.techsDone;
  const walkway = t.includes('crewCharter'), spine = t.includes('lightsOutFabs');
  let h = (+walkway) | (+t.includes('gardenDomes') << 1) | (+t.includes('pressureHalls') << 2) | (+spine << 3)
    | (+t.includes('replicatorStacks') << 4);
  h = mixHash(mixHash(h, s.roadRev ?? 0), s.roads?.length ?? 0);
  if (!walkway && !spine) return h;
  for (const b of s.buildings) {
    h = mixHash(mixHash(mixHash(mixHash(mixHash(mixHash(h, b.id), b.gx), b.gz), b.rot), built(b) ? 1 : 0), b.type.length);
    if (b.haul) h = mixHash(mixHash(h, Math.round(b.haul.digX)), Math.round(b.haul.digZ));
  }
  return h;
}

/** one step of a small integer hash (allocation-free signatures) */
export const mixHash = (h: number, v: number) => (Math.imul(h, 31) + (v | 0)) | 0;

/** Cells a link may not use at all (footprints, doors, bays, the apron, digs),
 *  and the road cells it may only bridge. */
function obstacles(s: GameState) {
  const hard = new Set<number>();
  for (const b of s.buildings) {
    for (const k of footprintCells(b)) hard.add(k);
    const d = doorCell(b);
    if (d) hard.add(cellKey(d[0], d[1]));
    // an excavator digging away from its pad: its dig cell and the ring round it
    const h = b.haul;
    if (h && b.type === 'excavator') {
      const [gx, gz] = cellAt(h.digX, h.digZ);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) hard.add(cellKey(gx + dx, gz + dz));
    }
  }
  const road = new Set<number>();
  for (const c of roadMap(s).values()) {
    const k = cellKey(c.gx, c.gz);
    if (c.bay || c.closed) hard.add(k);
    else road.add(k);
  }
  // the Lander's apron: never crossed, not even from above
  const lander = s.buildings.find((b) => b.type === 'lander');
  const d = lander ? doorCell(lander) : null;
  if (d) {
    for (const c of roadMap(s).values()) {
      if (Math.abs(c.gx - d[0]) + Math.abs(c.gz - d[1]) <= 3) hard.add(cellKey(c.gx, c.gz));
    }
  }
  return { hard, road };
}

type Rect = { gx0: number; gz0: number; gx1: number; gz1: number };
const range = (a: number, b: number) => { const out: number[] = []; for (let i = a; i < b; i++) out.push(i); return out; };
/** the values in [lo, hi) nearest `mid` first */
const nearestFirst = (lo: number, hi: number, mid: number) => range(lo, hi).sort((p, q) => Math.abs(p + 0.5 - mid) - Math.abs(q + 0.5 - mid) || p - q);
/** the footprint gap between two rects, cells (Chebyshev), and whether they overlap on an axis */
function gapOf(p: Rect, q: Rect): number {
  const gx = Math.max(0, q.gx0 - p.gx1, p.gx0 - q.gx1);
  const gz = Math.max(0, q.gz0 - p.gz1, p.gz0 - q.gz1);
  return Math.max(gx, gz) + Math.min(gx, gz);
}

/** Candidate routes from beside p to beside q: straight where they face each
 *  other across an axis, else one L-bend either way round. */
function candidates(p: Rect, q: Rect): Cell[][] {
  const out: Cell[][] = [];
  const line = (a: Cell, b: Cell): Cell[] => {
    const cells: Cell[] = [];
    const dx = Math.sign(b[0] - a[0]), dz = Math.sign(b[1] - a[1]);
    let [x, z] = a;
    cells.push([x, z]);
    while (x !== b[0] || z !== b[1]) { x += dx; z += dz; cells.push([x, z]); }
    return cells;
  };
  // p's edge cell toward q along x (or z), q's likewise
  const xOverlap = [Math.max(p.gx0, q.gx0), Math.min(p.gx1, q.gx1)] as const;
  const zOverlap = [Math.max(p.gz0, q.gz0), Math.min(p.gz1, q.gz1)] as const;
  if (xOverlap[0] < xOverlap[1]) {
    const [z0, z1] = q.gz0 >= p.gz1 ? [p.gz1, q.gz0 - 1] : [p.gz0 - 1, q.gz1];
    if (q.gz0 >= p.gz1 ? q.gz0 > p.gz1 : p.gz0 > q.gz1) {
      for (const x of nearestFirst(xOverlap[0], xOverlap[1], (xOverlap[0] + xOverlap[1]) / 2)) out.push(line([x, z0], [x, z1]));
    }
    return out;
  }
  if (zOverlap[0] < zOverlap[1]) {
    const [x0, x1] = q.gx0 >= p.gx1 ? [p.gx1, q.gx0 - 1] : [p.gx0 - 1, q.gx1];
    if (q.gx0 >= p.gx1 ? q.gx0 > p.gx1 : p.gx0 > q.gx1) {
      for (const z of nearestFirst(zOverlap[0], zOverlap[1], (zOverlap[0] + zOverlap[1]) / 2)) out.push(line([x0, z], [x1, z]));
    }
    return out;
  }
  // an L: out of p along x then into q along z, or along z then x
  const right = q.gx0 >= p.gx1, down = q.gz0 >= p.gz1;
  const pRows = nearestFirst(p.gz0, p.gz1, down ? p.gz1 : p.gz0).slice(0, 6);
  const qCols = nearestFirst(q.gx0, q.gx1, right ? q.gx0 : q.gx1).slice(0, 6);
  for (const r of pRows) {
    for (const c of qCols) {
      const a: Cell = [right ? p.gx1 : p.gx0 - 1, r];
      const corner: Cell = [c, r];
      const end: Cell = [c, down ? q.gz0 - 1 : q.gz1];
      out.push([...line(a, corner), ...line(corner, end).slice(1)]);
    }
  }
  const pCols = nearestFirst(p.gx0, p.gx1, right ? p.gx1 : p.gx0).slice(0, 6);
  const qRows = nearestFirst(q.gz0, q.gz1, down ? q.gz0 : q.gz1).slice(0, 6);
  for (const c of pCols) {
    for (const r of qRows) {
      const a: Cell = [c, down ? p.gz1 : p.gz0 - 1];
      const corner: Cell = [c, r];
      const end: Cell = [right ? q.gx0 - 1 : q.gx1, r];
      out.push([...line(a, corner), ...line(corner, end).slice(1)]);
    }
  }
  return out;
}

/** The crossing rule on one route: a road cell is allowed only as part of a
 *  straight run of at most MAX_SPAN, never at either end, never at the bend.
 *  Returns the per-cell bridge flags, or null if the route breaks a rule. */
function checkRoute(cells: Cell[], hard: Set<number>, road: Set<number>, used: Set<number>,
  why?: Record<string, number>): boolean[] | null {
  const n = cells.length;
  const no = (r: string) => { if (why) why[r] = (why[r] ?? 0) + 1; return null; };
  if (!n) return no('empty');
  const over: boolean[] = [];
  let run = 0;
  for (let i = 0; i < n; i++) {
    const [x, z] = cells[i];
    if (x < 1 || z < 1 || x >= MAP_CELLS - 1 || z >= MAP_CELLS - 1) return no('map');
    const k = cellKey(x, z);
    if (hard.has(k)) return no('hard');
    if (used.has(k)) return no('used');
    const isRoad = road.has(k);
    if (isRoad) {
      // at an end, the building carries the bridge (a riser inside its footprint)
      if (i > 0 && i < n - 1) {
        const [px, pz] = cells[i - 1], [nx, nz] = cells[i + 1];
        if (px !== nx && pz !== nz) return no('bend over a road');
      }
      if (++run > MAX_SPAN) return no('span');
    } else run = 0;
    over.push(isRoad);
  }
  return over;
}

/** Plan both layers (pure; the same state gives the same links). */
export function planLinks(s: GameState, why?: Record<string, number>): Link[] {
  const on = linkLayers(s.techsDone);
  if (!on.walkway && !on.spine) return [];
  const { hard, road } = obstacles(s);
  const used = new Set<number>();
  const out: Link[] = [];
  const layers: [LinkLayer, (t: BuildingId) => boolean][] = [];
  if (on.walkway) layers.push(['walkway', (t) => WALKWAY_BASE.has(t) || (on.halls && WALKWAY_HALLS.has(t))]);
  if (on.spine) layers.push(['spine', (t) => SPINE_TYPES.has(t)]);
  for (const [layer, joins] of layers) {
    const list = s.buildings.filter((b) => built(b) && joins(b.type)).sort((p, q) => p.id - q.id);
    const rect = new Map(list.map((b) => [b.id, footprintRect(b)]));
    const pairs: [number, BuildingState, BuildingState][] = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const g = gapOf(rect.get(list[i].id)!, rect.get(list[j].id)!);
        if (g >= 1 && g <= GAP[layer]) pairs.push([g, list[i], list[j]]);
      }
    }
    pairs.sort((p, q) => p[0] - q[0] || p[1].id - q[1].id || p[2].id - q[2].id);
    // a spanning forest: union-find over the joined
    const root = new Map<number, number>();
    const find = (x: number): number => { let r = x; while (root.has(r) && root.get(r) !== r) r = root.get(r)!; return r; };
    let n = 0;
    for (const [, a, b] of pairs) {
      if (n >= MAX_LINKS) break;
      if (find(a.id) === find(b.id)) continue;
      for (const cells of candidates(rect.get(a.id)!, rect.get(b.id)!)) {
        const over = checkRoute(cells, hard, road, used, why);
        if (!over) continue;
        for (const [x, z] of cells) used.add(cellKey(x, z));
        out.push({ layer, a: a.id, b: b.id, cells, over });
        root.set(find(a.id), find(b.id));
        n++;
        break;
      }
    }
  }
  return out;
}

// ─────────────────────────── the mesh ───────────────────────────

type V3 = [number, number, number];

export class Links {
  readonly group = new THREE.Group();
  private meshes: Record<LinkLayer, THREE.InstancedMesh | null> = { walkway: null, spine: null };
  private sig = NaN;
  private plan: Link[] = [];
  /** triangles per layer at the last rebuild */
  private tris: Record<LinkLayer, number> = { walkway: 0, spine: 0 };
  /** the ground cells the links stand on (legs, gantry posts): walkers keep off them */
  readonly ground = new Set<number>();
  /** fired after a rebuild (the links cast shadows in High detail) */
  onShadowCastersChanged?: () => void;

  constructor(private hf: Heightfield) {}

  update(s: GameState) {
    const sig = linkSignature(s);
    if (sig === this.sig) return;
    this.sig = sig;
    this.plan = planLinks(s);
    this.ground.clear();
    for (const l of this.plan) l.cells.forEach(([x, z], i) => { if (!l.over[i]) this.ground.add(cellKey(x, z)); });
    const on = linkLayers(s.techsDone);
    const at = new Map(s.buildings.map((b) => [b.id, b]));
    for (const layer of ['walkway', 'spine'] as const) {
      const links = this.plan.filter((l) => l.layer === layer);
      const parts: THREE.BufferGeometry[] = [];
      for (const l of links) parts.push(...this.build(l, at.get(l.a)!, at.get(l.b)!, layer === 'walkway' ? on.glazed : on.chevrons));
      this.setMesh(layer, parts);
    }
    this.onShadowCastersChanged?.();
  }

  private setMesh(layer: LinkLayer, parts: THREE.BufferGeometry[]) {
    const old = this.meshes[layer];
    if (old) {
      this.group.remove(old);
      old.geometry.dispose();
      this.meshes[layer] = null;
    }
    this.tris[layer] = 0;
    if (!parts.length) return;
    const geo = merge(parts);
    geo.userData.recipe = layer;
    this.tris[layer] = (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3;
    const view = withInstanceState(geo, 1);
    // walkways burn warm (people), spines cold (machines)
    (view.getAttribute('iWarm') as THREE.InstancedBufferAttribute).setX(0, layer === 'walkway' ? 1 : 0);
    const m = new THREE.InstancedMesh(view, materials.get('building'), 1);
    m.setMatrixAt(0, new THREE.Matrix4());
    m.castShadow = true;
    m.receiveShadow = true;
    m.customDepthMaterial = materials.get('buildingDepth');
    m.computeBoundingSphere();
    m.userData.links = layer;
    this.meshes[layer] = m;
    this.group.add(m);
  }

  /** A wall point: the middle of the edge a cell shares with the footprint, pushed `inset` m into it. */
  private wall(b: BuildingState, c: Cell, inset = INSET): [number, number] {
    const r = footprintRect(b);
    const [cx, cz] = cellCentre(c[0], c[1]);
    const nx = c[0] < r.gx0 ? 1 : c[0] >= r.gx1 ? -1 : 0;
    const nz = c[1] < r.gz0 ? 1 : c[1] >= r.gz1 ? -1 : 0;
    return [cx + nx * (2 + inset), cz + nz * (2 + inset)];
  }

  /** One link's geometry: its points (a's wall, the cell centres, b's wall),
   *  lifted onto a gantry where it bridges a road, then tube (or belt) runs,
   *  ribs, legs and posts. */
  private build(l: Link, a: BuildingState, b: BuildingState, extra: boolean): THREE.BufferGeometry[] {
    const H = HEIGHT[l.layer];
    const n = l.cells.length;
    // lifted: the road cells and their neighbours (the gantry posts)
    const lift = l.over.map((o, i) => o || l.over[i - 1] || l.over[i + 1]);
    const [ax, az] = this.wall(a, l.cells[0]);
    const [bx, bz] = this.wall(b, l.cells[n - 1]);
    const [ex, ez] = this.wall(a, l.cells[0], EDGE);
    const [fx, fz] = this.wall(b, l.cells[n - 1], EDGE);
    let top = -Infinity;
    l.cells.forEach(([x, z], i) => {
      if (!lift[i]) return;
      const [cx, cz] = cellCentre(x, z);
      top = Math.max(top, this.hf.sample(cx, cz));
    });
    if (l.over[0]) top = Math.max(top, this.hf.sample(ex, ez));
    if (l.over[n - 1]) top = Math.max(top, this.hf.sample(fx, fz));
    const high = top + BRIDGE_M;
    const pts: V3[] = [];
    const at: number[] = [];
    pts.push([ax, this.hf.sample(ax, az) + H, az]);
    // a bridge that lands on a building: a riser tower against its wall, inside its footprint
    if (l.over[0]) pts.push([ex, this.hf.sample(ex, ez) + H, ez], [ex, high, ez]);
    l.cells.forEach(([x, z], i) => {
      const [cx, cz] = cellCentre(x, z);
      at.push(pts.length);
      pts.push([cx, lift[i] ? high : this.hf.sample(cx, cz) + H, cz]);
    });
    if (l.over[n - 1]) pts.push([fx, high, fz], [fx, this.hf.sample(fx, fz) + H, fz]);
    pts.push([bx, this.hf.sample(bx, bz) + H, bz]);
    const out: THREE.BufferGeometry[] = [];
    // runs: split where the direction or the lift changes
    const dir = (p: V3, q: V3) => `${Math.sign(Math.round((q[0] - p[0]) * 100))},${Math.sign(Math.round((q[2] - p[2]) * 100))}`;
    let i0 = 0;
    for (let i = 1; i < pts.length; i++) {
      const last = i === pts.length - 1;
      const turn = !last && (dir(pts[i - 1], pts[i]) !== dir(pts[i], pts[i + 1])
        || Math.abs(pts[i + 1][1] - pts[i][1]) > 0.8 || Math.abs(pts[i][1] - pts[i - 1][1]) > 0.8);
      if (last || turn) {
        out.push(...(l.layer === 'walkway' ? this.tube(pts[i0], pts[i], extra) : this.belt(pts[i0], pts[i])));
        i0 = i;
      }
    }
    // the riser towers: a TRIM frame up the wall
    for (const [x, z, on] of [[ex, ez, l.over[0]], [fx, fz, l.over[n - 1]]] as const) {
      if (!on) continue;
      const g = this.hf.sample(x, z);
      out.push(box(0.22, high - g + 0.3, 0.22, TRIM, x, g + (high - g + 0.3) / 2, z));
    }
    // per cell: a rib (walkways) or a chevron (spines), and what holds it up
    l.cells.forEach(([x, z], i) => {
      const k = at[i];
      const p = pts[k];
      const [cx, cz] = [p[0], p[2]];
      const g = this.hf.sample(cx, cz);
      const q = pts[k + 1], o = pts[k - 1];
      const dx = q[0] - o[0], dz = q[2] - o[2], dl = Math.hypot(dx, dz) || 1;
      const ux = dx / dl, uz = dz / dl;
      if (l.layer === 'walkway') {
        out.push(pipe([cx - ux * 0.12, p[1], cz - uz * 0.12], [cx + ux * 0.12, p[1], cz + uz * 0.12], 0.98, TRIM, 8));
      } else if (extra) {
        // a cold chevron on the belt, pointing along it
        const yaw = Math.atan2(ux, uz);
        out.push(box(0.14, 0.06, 0.8, LAMP, cx + Math.cos(yaw) * 0.28, p[1] + 0.16, cz - Math.sin(yaw) * 0.28, yaw + 0.7));
        out.push(box(0.14, 0.06, 0.8, LAMP, cx - Math.cos(yaw) * 0.28, p[1] + 0.16, cz + Math.sin(yaw) * 0.28, yaw - 0.7));
      }
      if (l.over[i]) return; // nothing touches a road
      if (lift[i]) {
        // a gantry: two posts either side of the tube, a crossbeam under it
        const sx = -uz * 1.3, sz = ux * 1.3;
        const beam = p[1] - (l.layer === 'walkway' ? 0.95 : 0.45);
        out.push(bar([cx + sx, g, cz + sz], [cx + sx, beam + 0.1, cz + sz], 0.2, TRIM));
        out.push(bar([cx - sx, g, cz - sz], [cx - sx, beam + 0.1, cz - sz], 0.2, TRIM));
        out.push(bar([cx + sx * 1.05, beam, cz + sz * 1.05], [cx - sx * 1.05, beam, cz - sz * 1.05], 0.22, TRIM));
      } else {
        out.push(bar([cx, g, cz], [cx, p[1] - (l.layer === 'walkway' ? 0.85 : 0.4), cz], 0.16, TRIM));
      }
    });
    return out;
  }

  /** a pressurized tube from a to b: BODY, with a WINDOW strip down each side (glazed: lit) */
  private tube(a: V3, b: V3, glazed: boolean): THREE.BufferGeometry[] {
    const out = [pipe(a, b, 0.9, BODY, 8)];
    const dx = b[0] - a[0], dz = b[2] - a[2], dl = Math.hypot(dx, dz);
    if (dl < 0.5) return out; // a riser
    const sx = (-dz / dl) * 0.86, sz = (dx / dl) * 0.86;
    const f = glazed ? WINDOW : PLATE;
    for (const k of [1, -1]) {
      out.push(bar([a[0] + sx * k, a[1] + 0.12, a[2] + sz * k], [b[0] + sx * k, b[1] + 0.12, b[2] + sz * k], glazed ? 0.3 : 0.12, f));
    }
    return out;
  }

  /** a conveyor belt from a to b: a PLATE belt on a TRIM box truss, with side rails */
  private belt(a: V3, b: V3): THREE.BufferGeometry[] {
    const dx = b[0] - a[0], dz = b[2] - a[2], dl = Math.hypot(dx, dz);
    if (dl < 0.5) return [bar(a, b, 0.7, TRIM)]; // a lift up a riser
    const sx = (-dz / dl) * 0.72, sz = (dx / dl) * 0.72;
    return [
      bar([a[0], a[1] - 0.3, a[2]], [b[0], b[1] - 0.3, b[2]], 0.6, TRIM),
      bar([a[0] + sx, a[1] + 0.08, a[2] + sz], [b[0] + sx, b[1] + 0.08, b[2] + sz], 0.12, TRIM),
      bar([a[0] - sx, a[1] + 0.08, a[2] - sz], [b[0] - sx, b[1] + 0.08, b[2] - sz], 0.12, TRIM),
      ...this.beltDeck(a, b),
    ];
  }

  /** the belt's flat deck (a wide thin box along a → b) */
  private beltDeck(a: V3, b: V3): THREE.BufferGeometry[] {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    const g = box(1.4, 0.1, len, PLATE, 0, 0, 0);
    const yaw = Math.atan2(dx, dz), pitch = -Math.atan2(dy, Math.hypot(dx, dz));
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')));
    g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    return [g];
  }

  /** the plan and its cost (tests, probes) */
  info() {
    const count = (layer: LinkLayer) => this.plan.filter((l) => l.layer === layer).length;
    return {
      walkways: count('walkway'), spines: count('spine'),
      triangles: { walkway: this.tris.walkway, spine: this.tris.spine },
      bridges: this.plan.reduce((k, l) => k + l.over.filter(Boolean).length, 0),
      links: this.plan.map((l) => ({ layer: l.layer, a: l.a, b: l.b, cells: l.cells.map(([x, z]) => [x, z]), over: [...l.over] })),
      visible: { walkway: !!this.meshes.walkway, spine: !!this.meshes.spine },
    };
  }
}

/** A building a walkway (or spine) may join (tests). */
export function joinsLayer(type: BuildingId, layer: LinkLayer, techsDone: readonly string[]): boolean {
  const on = linkLayers(techsDone);
  return layer === 'walkway' ? WALKWAY_BASE.has(type) || (on.halls && WALKWAY_HALLS.has(type)) : SPINE_TYPES.has(type);
}
