/** Where every construction rover stands on the roads (world/rovers.ts
 *  drives them there; docs/15-roads.md §6). Pure: the state in, slots out —
 *  no Three.js, no randomness, a stable order.
 *
 *  A road cell holds two standing rovers, one in each half across its road
 *  (a *slot*). No two rovers share a slot, and a slot is always on an open
 *  road cell:
 *
 *   - parked: the bays beside its dock (the Lander's apron), nearest the
 *     door first, nose in; a dock out of bays keeps the rest inside (not drawn);
 *   - sintering a road: the open cell behind the frontier, facing it;
 *   - welding a site: its door cell, then back along its road, then any road
 *     cell beside it; a field structure from the road cell that serves it;
 *     a Relay Mast from its stand beside it, off the road (and inside an
 *     extraction zone, off the road at its door).
 *
 *  The sim drives every rover to its slot (core/transit.ts) and the visuals
 *  follow it there, so both read the same slots: groundSpots(). */
import { BUILDINGS } from '../data/buildings';
import type { BuildingState, GameState } from './state';
import {
  besideCells, cellAt, cellCentre, cellKey, doorCell, frontierOf, isOpen, mastStand, roadMap, serviceCell, zoneStand,
} from './roads';
import { centerOf } from '../buildings/instances';
import { FIELD_TYPES, ROAD } from '../data/roads';
import { unitKind } from './fleet';

type Cell = [number, number];

export interface RoverSpot {
  /** the slot: its cell and which half (0: −, 1: +) along the lateral axis */
  gx: number; gz: number; side: 0 | 1; axis: 'x' | 'z';
  /** world position of the slot */
  x: number; z: number;
  /** yaw it stands at, along its road (rovers' convention: forward = (sin, cos)) */
  face: number;
  /** the print shuffle's direction (along its road) */
  shuffle: [number, number];
  /** the site it works, or null */
  site: number | null;
  dock: number;
  /** a road job it sinters (free rover) */
  road?: number;
  /** out of bays: parked inside its dock (not drawn) */
  inside?: boolean;
  /** the cell it must come in from (a bay's opening), so the way in keeps to its half */
  via?: [number, number];
  /** off the road inside an extraction zone (a site there): reached from a gate (core/zones.ts) */
  offroad?: boolean;
  /** a deposit it cores (docs/17 §13.2): off the road at the deposit's centre */
  core?: string;
}

const isSite = (b: { construction?: number }) => (b.construction ?? 0) > 0;
const N4: Cell[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** The lateral axis of a cell whose road runs along `dir`. */
const lateral = (dir: Cell): 'x' | 'z' => (dir[0] !== 0 ? 'z' : 'x');

/** A slot's world position: the cell centre, a lane's width to one side. */
export function slotPoint(gx: number, gz: number, axis: 'x' | 'z', side: 0 | 1): [number, number] {
  const [cx, cz] = cellCentre(gx, gz);
  const o = (side ? 1 : -1) * ROAD.lane;
  return axis === 'x' ? [cx + o, cz] : [cx, cz + o];
}

/** The way a dead-end or bay cell opens onto the network (an open neighbour). */
function openingOf(s: GameState, c: Cell): Cell | null {
  const map = roadMap(s);
  for (const [dx, dz] of N4) {
    const n = map.get(cellKey(c[0] + dx, c[1] + dz));
    if (n && isOpen(n) && !n.bay) return [dx, dz];
  }
  return null;
}

/** the cell under a footprint's centre */
function centreCell(b: BuildingState): Cell {
  const f = BUILDINGS[b.type].footprint;
  const [w, d] = b.rot % 2 === 0 ? f : [f[1], f[0]];
  return [b.gx + Math.floor(w / 2), b.gz + Math.floor(d / 2)];
}

/** open non-bay road cells sharing an edge with c */
function neighbours(s: GameState, c: Cell): Cell[] {
  const map = roadMap(s);
  const out: Cell[] = [];
  for (const [dx, dz] of N4) {
    const n = map.get(cellKey(c[0] + dx, c[1] + dz));
    if (n && isOpen(n) && !n.bay) out.push([n.gx, n.gz]);
  }
  return out;
}

interface Stand { c: Cell; dir: Cell; face: Cell | null }

/** Every rover's slot, by roster id. */
export function roverSpots(s: GameState): Map<number, RoverSpot> {
  const roster = s.rovers ?? [];
  const at = new Map(s.buildings.map((b) => [b.id, b]));
  const lander = s.buildings.find((b) => b.type === 'lander');
  const map = roadMap(s);
  const out = new Map<number, RoverSpot>();
  const taken = new Set<string>();
  const slotKey = (gx: number, gz: number, side: number) => `${gx},${gz},${side}`;

  const dockOf = new Map<number, BuildingState>();
  const crews = new Map<number, number[]>();
  const jobs = new Map<number, number[]>();
  const parked = new Map<number, number[]>();
  const cores = new Map<string, number[]>();
  const push = (m: Map<number, number[]>, k: number, id: number) => (m.get(k) ?? m.set(k, []).get(k)!).push(id);
  for (const u of roster) {
    const dock = at.get(u.home) ?? lander;
    if (!dock) continue;
    dockOf.set(u.id, dock);
    const site = u.site !== null ? at.get(u.site) : undefined;
    if (site && isSite(site)) push(crews, site.id, u.id);
    else if (u.road !== undefined) push(jobs, u.road, u.id);
    else if (u.core !== undefined) (cores.get(u.core) ?? cores.set(u.core, []).get(u.core)!).push(u.id);
    else push(parked, dock.id, u.id);
  }

  const take = (id: number, st: Stand, site: number | null, road?: number, only?: 0 | 1): boolean => {
    const [gx, gz] = st.c;
    const axis = lateral(st.dir);
    for (const side of [0, 1] as const) {
      if (only !== undefined && side !== only) continue;
      if (taken.has(slotKey(gx, gz, side))) continue;
      taken.add(slotKey(gx, gz, side));
      const [x, z] = slotPoint(gx, gz, axis, side);
      // it stands along its road (two to a cell, side by side), the way that looks toward `face`
      const [fx, fz] = st.face ? cellCentre(st.face[0], st.face[1]) : [x + st.dir[0], z + st.dir[1]];
      const k = (fx - x) * st.dir[0] + (fz - z) * st.dir[1] >= 0 ? 1 : -1;
      const bay = map.get(cellKey(gx, gz))?.bay;
      out.set(id, {
        gx, gz, side, axis, x, z,
        face: Math.atan2(st.dir[0] * k, st.dir[1] * k), shuffle: [Math.abs(st.dir[0]), Math.abs(st.dir[1])],
        site, dock: dockOf.get(id)!.id, ...(road !== undefined ? { road } : {}),
        ...(bay ? { via: [gx + st.dir[0], gz + st.dir[1]] as [number, number] } : {}),
      });
      return true;
    }
    return false;
  };

  /** stand a crew along cells, two to a cell; returns who found no slot */
  const along = (ids: number[], stands: Stand[], site: number | null, road?: number) => {
    const left = [...ids];
    for (const st of stands) {
      while (left.length && take(left[0], st, site, road)) left.shift();
      if (!left.length) break;
    }
    return left;
  };

  /** the open cells back along a road from `from` toward the network */
  const backAlong = (cells: readonly number[], from: Cell): Cell[] => {
    const out: Cell[] = [from];
    const i = cells.indexOf(cellKey(from[0], from[1]));
    for (let k = i - 1; k >= 0 && out.length < 4; k--) {
      const c = map.get(cells[k]);
      if (c && isOpen(c) && !c.bay) out.push([c.gx, c.gz]);
    }
    return out;
  };

  /** at a road's frontier: the open cell behind it, facing it, then back along */
  const frontier = (cells: readonly number[]): Stand[] | null => {
    const f = frontierOf(s, cells);
    if (!f || !f.from) return null;
    const dir: Cell = [f.cell.gx - f.from[0], f.cell.gz - f.from[1]];
    const face: Cell = [f.cell.gx, f.cell.gz];
    return backAlong(cells, f.from).map((c) => ({ c, dir, face }));
  };

  // every road's frontier first: the cell behind it goes to that road's own
  // crew, two to the cell (the sim sinters a cell only with a rover there,
  // core/transit.ts), so no one standing for other work keeps a road unbuilt
  for (const b of s.buildings) {
    const team = crews.get(b.id);
    const st = team && b.spur?.length ? frontier(b.spur)?.[0] : undefined;
    if (!team || !st) continue;
    for (let i = 0; i < team.length && i < ROAD.bayCap; i++) if (!take(team[i], st, b.id)) break;
  }
  for (const j of s.roadJobs ?? []) {
    const team = jobs.get(j.id);
    const st = team ? frontier(j.cells)?.[0] : undefined;
    if (!team || !st) continue;
    for (let i = 0; i < team.length && i < ROAD.bayCap; i++) if (!take(team[i], st, null, j.id)) break;
  }

  /** a site inside an extraction zone: its crew off the road at its door
   *  (a field's wall), two abreast facing it, reached from a gate */
  const offRoad = (ids: number[], b: BuildingState, x: number, z: number): number[] => {
    // side by side in the cell it works from, across the way it faces the site (as in a road's two halves)
    const [bx, bz] = centerOf(b);
    const [gx, gz] = cellAt(x, z);
    const [cx, cz] = cellCentre(gx, gz);
    const dir: Cell = Math.abs(bx - cx) >= Math.abs(bz - cz) ? [Math.sign(bx - cx) || 1, 0] : [0, Math.sign(bz - cz) || 1];
    const axis = lateral(dir);
    const left = [...ids];
    for (const side of [0, 1] as const) {
      if (!left.length || taken.has(slotKey(gx, gz, side))) continue;
      taken.add(slotKey(gx, gz, side));
      const [px, pz] = slotPoint(gx, gz, axis, side);
      const id = left.shift()!;
      out.set(id, {
        gx, gz, side, axis, x: px, z: pz, face: Math.atan2(dir[0], dir[1]), shuffle: [Math.abs(dir[0]), Math.abs(dir[1])],
        site: b.id, dock: dockOf.get(id)!.id, offroad: true,
      });
    }
    return left;
  };

  // sites: their crews at the frontier of their road, else at the door
  for (const b of s.buildings) {
    const all = crews.get(b.id);
    const team = all?.filter((id) => !out.has(id));
    if (!team?.length) continue;
    const r = centreCell(b);
    let stands = b.spur?.length ? frontier(b.spur) : null;
    // inside an extraction zone (core/zones.ts), its road done: off the road at its door
    const zs = stands ? null : zoneStand(s, b);
    if (zs?.gate) {
      for (const id of offRoad(team, b, zs.x, zs.z)) push(parked, dockOf.get(id)!.id, id);
      continue;
    }
    // a Relay Mast (docs/15 §5b): off the road at its stand, driven out to from its gate
    const ms = stands ? null : mastStand(s, b);
    if (ms) {
      for (const id of offRoad(team, b, ms.x, ms.z)) push(parked, dockOf.get(id)!.id, id);
      continue;
    }
    if (!stands && FIELD_TYPES.has(b.type)) {
      const c = serviceCell(s, b);
      stands = c ? [c, ...neighbours(s, c)].map((x) => ({ c: x, dir: openingOf(s, x) ?? [0, 1], face: r })) : [];
    } else if (!stands) {
      stands = besideCells(s, b).map((c) => ({ c, dir: openingOf(s, c) ?? [c[0] - r[0], c[1] - r[1]], face: r }));
      const d = doorCell(b);
      if (d && b.spur) for (const c of backAlong(b.spur, d).slice(1)) stands.push({ c, dir: openingOf(s, c) ?? [0, 1], face: r });
    }
    for (const id of along(team, stands, b.id)) push(parked, dockOf.get(id)!.id, id);
  }

  // road jobs: at their frontier
  for (const j of s.roadJobs ?? []) {
    const team = jobs.get(j.id)?.filter((id) => !out.has(id));
    if (!team?.length) continue;
    for (const id of along(team, frontier(j.cells) ?? [], null, j.id)) push(parked, dockOf.get(id)!.id, id);
  }

  // deposit surveys (docs/17 §13.2): off the road at the deposit's centre, reached from its gate
  for (const [dep, team] of cores) {
    const z = s.zones?.find((q) => q.id === dep);
    if (!z) { for (const id of team) push(parked, dockOf.get(id)!.id, id); continue; }
    const [gx, gz] = cellAt(z.cx, z.cz);
    const left = [...team];
    for (const side of [0, 1] as const) {
      if (!left.length || taken.has(slotKey(gx, gz, side))) continue;
      taken.add(slotKey(gx, gz, side));
      const [px, pz] = slotPoint(gx, gz, 'x', side);
      const id = left.shift()!;
      out.set(id, { gx, gz, side, axis: 'x', x: px, z: pz, face: 0, shuffle: [1, 0], site: null, dock: dockOf.get(id)!.id, offroad: true, core: dep });
    }
    for (const id of left) push(parked, dockOf.get(id)!.id, id);
  }

  // parking: the bays within two cells of the dock's door, nearest first, nose
  // in — each rover its own slot, by its place in the dock's roster, so one
  // leaving moves nobody else
  const bays = (s.roads ?? []).filter((c) => c.bay && isOpen(c));
  const homed = new Map<number, number[]>();
  for (const u of roster) { const d = dockOf.get(u.id); if (d) push(homed, d.id, u.id); }
  for (const dock of s.buildings) {
    const list = parked.get(dock.id);
    if (!list?.length) continue;
    const d = doorCell(dock) ?? centreCell(dock);
    const dist = (c: { gx: number; gz: number }) => Math.abs(c.gx - d[0]) + Math.abs(c.gz - d[1]);
    const own = bays.filter((c) => dist(c) <= 2)
      .sort((p, q) => dist(p) - dist(q) || cellKey(p.gx, p.gz) - cellKey(q.gx, q.gz));
    const stands = own.map((c): Stand => {
      const cell: Cell = [c.gx, c.gz];
      const dir = openingOf(s, cell) ?? [0, 1];
      return { c: cell, dir, face: [c.gx - dir[0], c.gz - dir[1]] }; // nose in: it backs out
    });
    const order = homed.get(dock.id) ?? [];
    const left: number[] = [];
    for (const id of list) {
      const i = order.indexOf(id);
      const st = stands[i >> 1];
      if (!st || !take(id, st, null, undefined, (i & 1) as 0 | 1)) left.push(id);
    }
    for (const id of along(left, stands, null)) {
      // no bay left: inside the dock
      const [x, z] = cellCentre(...centreCell(dock));
      out.set(id, { gx: d[0], gz: d[1], side: 0, axis: 'x', x, z, face: 0, shuffle: [1, 0], site: null, dock: dock.id, inside: true });
    }
  }
  return out;
}

/** Every ground rover's slot: the roster without the Drone Hive's units,
 *  which fly (core/fleet.ts unitKind) and take no road slot. The sim
 *  (core/transit.ts) and the visuals (world/rovers.ts) both read these. */
export function groundSpots(s: GameState): Map<number, RoverSpot> {
  const all = s.rovers ?? [];
  const ground = all.filter((u) => unitKind(s, u) !== 'drone');
  return roverSpots(ground.length === all.length ? s : { ...s, rovers: ground });
}
