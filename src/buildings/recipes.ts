/** The building silhouettes from the primitive kit (docs/19 S2a: 29 recipes,
 *  the two hub units among them), plus the research upgrades each one grows
 *  (upgrades.ts, keyed by upgradeKey). Silhouette-first: in a monochrome world,
 *  shape is identity — dome = life, tank = industry, rail = export. Detail is
 *  load-bearing only: a door frame says "people go in here", a radiator says
 *  "this runs hot", a dish says "we talk to Earth".
 *  Base of every recipe sits at y=0, centered on its footprint, door side +z:
 *  the home camera looks from +x, +z, so the door is on one of the two faces
 *  it sees. Every recipe has ONE tall identifier (a stack, a tower, a mast, a
 *  cooling tower, a crane: 5 to 16 m) that carries the family accent —
 *  small TRIM parts, or BAND parts (meshKit.ts: the accent at any size) — so
 *  the family reads at far zoom.
 *
 *  Parts that move (sun-tracking solar wings, dishes aimed at Earth) are not
 *  in the recipe: MOUNTS places them, and buildings/trackers.ts instances
 *  them separately. Nor are the parts that move while a structure works
 *  (the excavator's boom and bucket wheel, the ice miner's cutter drum):
 *  rigs.ts, world/workAnim.ts. The hubs' diggers are `unitRecipeGeometry`. */
import * as THREE from 'three';
import type { BufferGeometry } from 'three';
import type { BuildingId } from '../data/buildings';
import { TECHS, type TechId } from '../data/techs';
import { HIVE_DECK_Y, HIVE_PADS } from '../data/roads';
import type { UnitKey } from '../data/families';
import {
  BAND, BEACON, BODY, FOIL, GLASS, LAMP, LEAF, PLATE, RADIATOR, TRIM, WINDOW,
  antenna, archWall, bands, bar, berm, box, cableTray, circle, cyl, dome, domeBand, door, junction,
  ladder, lathe, lattice, merge, pane, pipe, radiator, rail, vault, windowRing, windowStrip,
} from './meshKit';
import { flatten, upgradeTechs, upgradesIn, type Mount, type PartId } from './upgrades';
import { rigParts, rigTriangles } from './rigs';

export type { Mount, PartId } from './upgrades';
type Parts = (BufferGeometry | BufferGeometry[])[];
const PI = Math.PI;

/** An accent ring round a vertical tower or stack (BAND: the family accent at any size). */
const ring = (r: number, y: number, x = 0, z = 0, h = 0.3, seg = 14): BufferGeometry =>
  cyl(r + 0.04, r + 0.04, h, BAND, x, y, z, 0, 0, seg, true);

/** Rectangle corners for a deck rail, inset from ±hx/±hz. */
const rect = (hx: number, hz: number, cx = 0, cz = 0): [number, number][] =>
  [[cx - hx, cz - hz], [cx + hx, cz - hz], [cx + hx, cz + hz], [cx - hx, cz + hz]];

function lander(): Parts {
  const r = (y: number) => 2.6 - ((y - 1.7) / 7) * 0.4; // body radius at height y
  const p: Parts = [
    cyl(2.2, 2.6, 7, BODY, 0, 5.2, 0, 0, 0, 28),
    cyl(r(1.7) + 0.05, r(2.9) + 0.05, 1.2, FOIL, 0, 2.3, 0, 0, 0, 28, true),
    dome(2.2, BODY, 0, 8.7, 0, 28),
    cyl(1.1, 1.7, 1.8, TRIM, 0, 0.9, 0, 0, 0, 20),
    bands(r(6.1), 0, 0, [6.1], BAND, 0.16, 28),
    bands(r(8.5), 0, 0, [8.5], BAND, 0.16, 28),
    windowRing(r(7.4) + 0.02, 7.4, 0.46, 6, 0.5, PI * 0.62, PI * 2.38),
    door(0, r(3.9) - 0.02, 0, 0.9, 1.5, 3.1),
    box(1.5, 0.1, 1.0, PLATE, 0, 3.05, r(3.1) + 0.45),
    ladder(0.95, r(1.7) + 0.45, 0.15, 3.05, 0),
    box(1.2, 1.2, 1.2, TRIM, 0, 11.2, 0),
    antenna(-0.35, 11.8, 0.35, 3.0),
    box(0.16, 0.7, 0.16, TRIM, 0.6, 12.15, -0.4),
    cableTray([2.4, 1.4], [5.4, 1.4]),
    junction(5.6, 1.4, PI / 2),
  ];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2 + PI / 4;
    const c = Math.cos(a), s = Math.sin(a);
    p.push(
      bar([2.1 * c, 3.8, 2.1 * s], [4.4 * c, 0.14, 4.4 * s], 0.24, TRIM),
      bar([1.9 * c, 1.9, 1.9 * s], [3.5 * c, 1.55, 3.5 * s], 0.12, PLATE),
      cyl(0.55, 0.68, 0.14, TRIM, 4.4 * c, 0.07, 4.4 * s, 0, 0, 12),
      box(0.36, 0.36, 0.36, TRIM, 2.3 * Math.cos(a + PI / 4), 8.15, 2.3 * Math.sin(a + PI / 4)),
    );
  }
  return p;
}

function solar(): Parts {
  return [
    box(1.4, 0.3, 1.4, TRIM, 0, 0.15, 0),
    cyl(0.14, 0.2, 2.1, TRIM, 0, 1.3, 0, 0, 0, 12),
    cyl(0.26, 0.26, 0.36, PLATE, 0, 2.3, 0, 0, 0, 12),
    [0, 1, 2, 3].map((i) => {
      const a = (i / 4) * PI * 2;
      return bar([0.62 * Math.cos(a), 0.3, 0.62 * Math.sin(a)], [0.1 * Math.cos(a), 1.1, 0.1 * Math.sin(a)], 0.07, TRIM);
    }),
    box(0.8, 0.9, 0.5, TRIM, 1.0, 0.45, 1.0),
    box(0.22, 0.1, 0.04, WINDOW, 1.0, 0.75, 1.27),
    cableTray([1.0, 1.3], [1.0, 3.5]),
    junction(1.0, 3.7, 0),
    // the identifier: a sun-sensor mast clear of the wing's sweep, an amber pennant and rings
    cyl(0.07, 0.1, 5.4, TRIM, -3.2, 2.7, 2.9, 0, 0, 6),
    box(0.05, 0.8, 1.1, BAND, -3.2, 4.9, 3.5),
    ring(0.1, 1.2, -3.2, 2.9, 0.3, 6), ring(0.09, 2.4, -3.2, 2.9, 0.3, 6),
    dome(0.12, BEACON, -3.2, 5.45, 2.9, 8),
    box(0.7, 0.14, 0.7, TRIM, -3.2, 0.07, 2.9),
  ];
}

/** Two PV wings on a torque tube; pivot at the origin, cells facing +y,
 *  tube along x. Tracked per frame (trackers.ts). `rows` 4 is the stock
 *  wing; Wing Extensions adds a fifth row (the 'wingXL' part). */
function solarWing(rows = 4): Parts {
  const p: Parts = [cyl(0.07, 0.07, 7.4, PLATE, 0, 0, 0, 0, PI / 2, 8)];
  for (const side of [-1, 1]) {
    const cx = side * 2.0;
    const half = 1.45 + (rows - 4) * 0.35;
    p.push(
      box(3.4, 0.06, half * 2, TRIM, cx, -0.02, 0),
      box(3.4, 0.1, 0.06, TRIM, cx, -0.09, 0.9),
      box(3.4, 0.1, 0.06, TRIM, cx, -0.09, -0.9),
      box(0.26, 0.2, 0.26, PLATE, side * 0.36, 0, 0),
    );
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < rows; j++) {
        p.push(box(0.63, 0.04, 0.66, GLASS, cx + (i - 2) * 0.67, 0.03, (j - (rows - 1) / 2) * 0.7));
      }
    }
    p.push(box(3.44, 0.08, 0.05, TRIM, cx, 0.0, half), box(3.44, 0.08, 0.05, TRIM, cx, 0.0, -half));
  }
  return p;
}

/** Parabolic dish, 1 m radius; hub at the origin, boresight +y. */
function dishPart(): Parts {
  const inner: [number, number][] = [];
  for (let i = 0; i <= 6; i++) { const r = i / 6; inner.push([r, 0.12 + (r * r) / 2.4]); }
  const outer = inner.map(([r, y]) => [r, y - 0.05] as [number, number]).reverse();
  const p: Parts = [
    lathe([...inner, ...outer], BODY, 24),
    cyl(0.18, 0.22, 0.24, TRIM, 0, 0.02, 0, 0, 0, 12),
    cyl(0.05, 0.09, 0.2, PLATE, 0, 0.66, 0, 0, 0, 8),
  ];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * PI * 2;
    p.push(bar([0.93 * Math.cos(a), 0.52, 0.93 * Math.sin(a)], [0, 0.72, 0], 0.03, TRIM));
  }
  return p;
}

function excavator(): Parts {
  const p: Parts = [
    box(3.6, 1.0, 2.6, BODY, 0, 1.1, 0),
    box(1.5, 1.3, 1.6, TRIM, -1.0, 2.25, -0.4),
    pane(1.0, 0.5, -0.24, 2.45, -0.4, PI / 2),
    pane(0.8, 0.5, -1.0, 2.45, 0.41, 0),
    box(0.26, 0.14, 0.1, LAMP, -0.22, 2.0, -0.85, PI / 2),
    box(0.26, 0.14, 0.1, LAMP, -0.22, 2.0, 0.05, PI / 2),
    // the mast; the boom, its stay and the bucket wheel move (rigs.ts)
    bar([0.2, 1.6, 0.7], [0.2, 3.6, 0.7], 0.2, TRIM),
    radiator(1.2, 0.9, -1.84, 1.6, 0.7, -PI / 2),
    rail([[-1.75, 0.2], [-1.75, 1.25], [0.2, 1.25]], 1.6),
    antenna(-1.4, 2.9, -0.9, 1.4),
  ];
  for (const side of [-1, 1]) {
    p.push(box(3.8, 0.7, 0.7, TRIM, 0, 0.4, side * 1.55));
    for (const x of [-1.4, -0.47, 0.47, 1.4]) p.push(cyl(0.34, 0.34, 0.74, PLATE, x, 0.36, side * 1.55, PI / 2, 0, 12));
  }
  return p;
}

// ─── the hubs' diggers (docs/19 S2a) ───
// All three ride the excavator's frame: the wheel leads +x, the rig rides the
// +z side of the hull (rigs.ts: boom pivot (0.4, 1.7, 0.7), hub (2.9, 1.45, 0.7))
// and its stay's head stands at (0.2, 3.6, 0.7); the hull is 3.6 × 2.6 m on
// tracks 3.8 m long. What differs is what sits on the back deck and the
// livery (data/families.ts HUB_LIVERY: body, and the band the trim wears).

/** The smelter's digger: the excavator with an OPEN ore bin on its back deck
 *  (walls, a heap in it) and an ochre band along the hull. */
function smelterDigger(): Parts {
  const p = excavator();
  const bx = 1.05, bz = -0.6;
  p.push(
    box(1.5, 0.12, 1.3, PLATE, bx, 1.66, bz),
    box(1.5, 0.5, 0.1, BODY, bx, 1.95, bz - 0.6), box(1.5, 0.5, 0.1, BODY, bx, 1.95, bz + 0.6),
    box(0.1, 0.5, 1.3, BODY, bx - 0.7, 1.95, bz), box(0.1, 0.5, 1.3, BODY, bx + 0.7, 1.95, bz),
    cyl(0.45, 0.68, 0.34, PLATE, bx, 1.86, bz, 0, 0, 7),
    box(1.6, 0.07, 0.16, BAND, bx, 2.23, bz - 0.6), box(1.6, 0.07, 0.16, BAND, bx, 2.23, bz + 0.6),
    box(0.16, 0.07, 1.3, BAND, bx - 0.7, 2.23, bz), box(0.16, 0.07, 1.3, BAND, bx + 0.7, 2.23, bz),
    box(3.62, 0.2, 0.05, BAND, 0, 1.15, -1.31), box(3.62, 0.2, 0.05, BAND, 0, 1.15, 1.31),
  );
  return p;
}

/** The refinery's digger: a COVERED hopper (a gabled lid, hatches, a ridge
 *  stripe) on the back deck, a domed cab, no radiator or rail; tracks in
 *  slate, a violet band along the hull. */
function refineryDigger(): Parts {
  const bx = 1.05, bz = -0.6;
  const p: Parts = [
    box(3.6, 1.0, 2.6, BODY, 0, 1.1, 0),
    box(3.62, 0.2, 0.05, BAND, 0, 1.15, -1.31), box(3.62, 0.2, 0.05, BAND, 0, 1.15, 1.31),
    // the cab: a sealed box under a dome, a pane and a lamp
    box(1.4, 0.9, 1.6, BODY, -1.0, 2.05, -0.4),
    dome(0.8, BODY, -1.0, 2.5, -0.4, 14),
    pane(1.0, 0.45, -0.28, 2.2, -0.4, PI / 2),
    box(0.26, 0.14, 0.1, LAMP, -0.26, 2.7, -0.4, PI / 2),
    // the covered hopper: a box, its gabled lid, a ridge stripe and two hatches
    box(1.5, 0.7, 1.3, BODY, bx, 1.95, bz),
    box(1.6, 0.05, 0.7, BODY, bx, 2.5, bz - 0.28, 0, 0.55),
    box(1.6, 0.05, 0.7, BODY, bx, 2.5, bz + 0.28, 0, -0.55),
    box(1.6, 0.1, 0.12, BAND, bx, 2.78, bz),
    box(0.34, 0.1, 0.34, TRIM, bx - 0.4, 2.4, bz - 0.5), box(0.34, 0.1, 0.34, TRIM, bx + 0.4, 2.4, bz - 0.5),
    // the mast the stay hangs from, and a whip antenna
    bar([0.2, 1.6, 0.7], [0.2, 3.6, 0.7], 0.2, TRIM),
    antenna(-1.6, 2.9, 0.5, 2.4),
  ];
  for (const side of [-1, 1]) {
    p.push(box(3.8, 0.7, 0.7, PLATE, 0, 0.4, side * 1.55));
    for (const x of [-1.4, -0.47, 0.47, 1.4]) p.push(cyl(0.34, 0.34, 0.74, PLATE, x, 0.36, side * 1.55, PI / 2, 0, 12));
  }
  return p;
}

/** The Ice Miner: a crawler with an insulated foil tank across its back deck
 *  (cyan straps, domed ends), a small cab at the front-left, and a cutter
 *  drum for a wheel (rigs.ts iceDrum). Tracks in slate, a cyan band. */
function iceMiner(): Parts {
  const p: Parts = [
    box(3.6, 0.9, 2.6, BODY, 0, 1.05, 0),
    box(3.62, 0.2, 0.05, BAND, 0, 1.1, -1.31), box(3.62, 0.2, 0.05, BAND, 0, 1.1, 1.31),
    // the tank: a horizontal foil cylinder, straps, end domes, a filler cap
    cyl(0.85, 0.85, 2.1, FOIL, -0.85, 2.4, -0.4, 0, PI / 2, 16),
    [-1.6, -0.85, -0.1].map((x) => cyl(0.89, 0.89, 0.16, BAND, x, 2.4, -0.4, 0, PI / 2, 16, true)),
    cyl(0.16, 0.2, 0.2, TRIM, -0.85, 3.32, -0.4, 0, 0, 8),
    // a saddle under it and the cab ahead of it
    box(2.2, 0.16, 1.5, TRIM, -0.85, 1.58, -0.4),
    box(1.2, 1.0, 1.1, BODY, 0.85, 2.15, -0.75),
    box(1.3, 0.1, 1.2, BAND, 0.85, 2.7, -0.75),
    pane(0.8, 0.45, 1.46, 2.3, -0.75, PI / 2),
    box(0.24, 0.12, 0.1, LAMP, 1.47, 2.05, -1.1, PI / 2),
    // the mast the stay hangs from, and a whip antenna
    bar([0.2, 1.6, 0.7], [0.2, 3.6, 0.7], 0.2, TRIM),
    antenna(-1.7, 3.2, 0.7, 2.0),
    pipe([-1.2, 1.9, 0.62], [0.1, 1.75, 0.68], 0.07, PLATE),
  ];
  for (const side of [-1, 1]) {
    p.push(box(3.8, 0.7, 0.7, PLATE, 0, 0.4, side * 1.55));
    for (const x of [-1.4, -0.47, 0.47, 1.4]) p.push(cyl(0.34, 0.34, 0.74, PLATE, x, 0.36, side * 1.55, PI / 2, 0, 12));
  }
  return p;
}

function habitat(): Parts {
  const p: Parts = [
    cyl(3.1, 3.3, 1.4, TRIM, 0, 0.7, 0, 0, 0, 28),
    dome(3.1, BODY, 0, 1.4, 0, 28),
    domeBand(3.13, 1.02, 1.08, TRIM, 0, 1.4, 0, 28),
    domeBand(3.13, 0, 0.24, WINDOW, 0, 1.4, 0, 16),
    windowRing(3.23, 0.82, 0.46, 5, 0.9, PI / 2 + 0.75, PI * 2.5 - 0.75),
    box(1.6, 1.8, 1.6, BODY, 0, 0.9, 3.0),
    box(1.7, 0.14, 1.7, TRIM, 0, 1.87, 3.0),
    door(0, 3.8, 0, 1.0, 1.5, 0.05),
    radiator(1.6, 1.2, -3.75, 0.3, -1.4, -PI / 2),
    antenna(1.5, 3.85, -1.0, 2.2),
    cableTray([2.4, -2.9], [3.7, -2.9]),
    junction(3.8, -2.9, PI / 2),
    // the identifier: a lamp spire at the dome's flank, green rings and a beacon
    cyl(0.1, 0.16, 9.0, TRIM, 3.9, 4.5, -0.4, 0, 0, 8),
    ring(0.16, 2.6, 3.9, -0.4, 0.34, 8), ring(0.14, 5.0, 3.9, -0.4, 0.34, 8), ring(0.12, 7.4, 3.9, -0.4, 0.34, 8),
    box(0.4, 0.22, 0.4, LAMP, 3.9, 8.6, -0.4),
    dome(0.16, BEACON, 3.9, 9.1, -0.4, 8),
    box(0.9, 0.16, 0.9, TRIM, 3.9, 0.08, -0.4),
  ];
  for (let k = 0; k < 4; k++) {
    p.push(domeBand(3.12, 0.62, 0.86, WINDOW, 0, 1.4, 0, 4, k * PI / 2 + 0.5, 0.55));
  }
  return p;
}

function smelter(): Parts {
  return [
    box(7, 4, 5.4, BODY, 0, 2, 0),
    box(7.2, 0.5, 5.6, TRIM, 0, 4.25, 0),
    rail(rect(3.45, 2.65), 4.5, true),
    cyl(0.8, 1.0, 5.5, TRIM, -2.1, 7.25, -1.2, 0, 0, 18),
    bands(0.9, -2.1, -1.2, [6.0, 7.6, 9.2]),
    cyl(0.92, 0.92, 0.3, PLATE, -2.1, 10.05, -1.2, 0, 0, 18, true),
    dome(0.14, BEACON, -2.1, 10.2, -0.3, 8),
    cyl(0.7, 0.9, 4.4, TRIM, -0.4, 6.7, -1.2, 0, 0, 18),
    bands(0.78, -0.4, -1.2, [6.2, 7.8]),
    door(1.6, 2.72, 0, 2.2, 2.4),
    windowStrip(3.0, 4, 0.6, -1.7, 3.0, 2.72, 0),
    box(1.4, 1.6, 1.6, TRIM, 4.2, 2.6, 0),
    cyl(1.0, 0.35, 1.0, PLATE, 4.2, 3.9, 0, 0, 0, 4),
    bar([5.8, 0.3, 0], [4.6, 4.3, 0], 0.4, TRIM),
    bar([5.5, 0, 0.3], [5.5, 1.3, 0.3], 0.1, TRIM),
    bar([5.1, 0, -0.3], [5.1, 2.6, -0.3], 0.1, TRIM),
    radiator(2.6, 2.0, -1.8, 0.6, -3.45, PI),
    radiator(2.6, 2.0, 1.6, 0.6, -3.45, PI),
    cableTray([-3.6, 1.8], [-5.5, 1.8]),
    junction(-5.7, 1.8, -PI / 2),
  ];
}

function iceHarvester(): Parts {
  return [
    box(4.4, 1.4, 4.4, BODY, 0, 0.7, 0),
    rail(rect(2.1, 2.1), 1.4, true),
    lattice(4.8, 1.2, 0.35, 0, 0, 1.4, 4, 1.2),
    box(0.8, 0.4, 0.8, BAND, 0, 6.35, 0),
    dome(0.14, BEACON, 0, 6.6, 0, 8),
    ring(0.98, 3.0, 0, 0, 0.22, 12), ring(0.74, 4.6, 0, 0, 0.22, 12),
    cyl(0.2, 0.2, 5.2, PLATE, 0, 3.6, 0, 0, 0, 10),
    bands(0.2, 0, 0, [1.8, 2.6, 3.4, 4.2, 5.0]),
    cyl(0.45, 0.45, 1.8, FOIL, 1.1, 1.9, -1.25, 0, PI / 2, 16),
    cyl(0.45, 0.45, 1.8, FOIL, 1.1, 1.9, 1.25, 0, PI / 2, 16),
    box(1.4, 1.2, 1.2, TRIM, -1.4, 2.0, 1.4),
    pane(0.8, 0.45, -1.4, 2.15, 2.0, 0),
    pipe([0.25, 2.6, 0.2], [1.1, 2.35, 1.0], 0.08, TRIM),
    radiator(1.8, 1.3, 0, 1.4, -2.1, PI),
    cableTray([2.3, 1.6], [3.7, 1.6]),
    junction(3.8, 1.6, PI / 2),
  ];
}

/** The Water Management Plant (docs/17 §20, docs/19 S2a): nothing of the
 *  smelter's hall. A frosted cold-trap dome (a foil belt, an ochre band, a lit
 *  window ring) on the left, the one condenser tower on the right (finned
 *  plates, three ochre rings, a domed head: 11.5 m, the identifier), a vapour
 *  line between them, and a water tank on the ground. Door at +z (the dome's
 *  airlock). */
function waterPlant(): Parts {
  const dx = -2.4, dz = -0.3, R = 3.0;       // the dome
  const tx = 3.4, tz = -1.2;                 // the tower
  const p: Parts = [
    cyl(R + 0.15, R + 0.25, 1.0, TRIM, dx, 0.5, dz, 0, 0, 20),
    dome(R, RADIATOR, dx, 1.0, dz, 20),
    domeBand(R + 0.04, 0.62, 0.7, FOIL, dx, 1.0, dz, 20),
    domeBand(R + 0.05, 1.0, 1.08, BAND, dx, 1.0, dz, 20),
    windowRing(R + 0.22, 0.55, 0.4, 5, 0.85, PI / 2 + 0.85, PI * 2.5 - 0.85).map((g) => g.translate(dx, 0, dz)),
    // the airlock at +z
    box(1.9, 1.9, 1.5, BODY, dx, 0.95, 3.05),
    box(2.0, 0.14, 1.6, BAND, dx, 1.97, 3.05),
    door(dx, 3.8, 0, 1.0, 1.5, 0.05),
    radiator(2.6, 1.8, dx, 0.6, dz - R - 0.5, PI),
    // the condenser tower: footing, shaft, finned plates, rings, head, ladder
    cyl(1.15, 1.3, 1.2, TRIM, tx, 0.6, tz, 0, 0, 16),
    cyl(0.85, 0.95, 9.4, BODY, tx, 5.9, tz, 0, 0, 16),
    dome(0.85, TRIM, tx, 10.6, tz, 12),
    dome(0.14, BEACON, tx, 11.5, tz, 8),
    [2.1, 4.2, 6.6, 9.0].map((y) => cyl(1.4, 1.4, 0.08, RADIATOR, tx, y, tz, 0, 0, 16)),
    [3.1, 5.4, 7.8].map((y) => cyl(0.99, 0.99, 0.36, BAND, tx, y, tz, 0, 0, 16, true)),
    ladder(tx, tz + 0.95, 1.2, 9.6, 0),
    // the vapour line from the dome to the tower, and the drain
    pipe([dx + 2.8, 2.5, dz + 0.4], [tx - 0.85, 2.3, tz], 0.28, TRIM, 10),
    pipe([dx + 3.0, 1.3, dz + 0.6], [tx - 0.85, 1.3, tz + 0.4], 0.16, PLATE),
    // the water tanks, on the ground at +x
    cyl(0.9, 0.9, 3.0, BODY, 3.9, 0.95, 1.9, PI / 2, 0, 16),
    [0.7, 1.9, 3.1].map((z) => cyl(0.94, 0.94, 0.14, FOIL, 3.9, 0.95, z, PI / 2, 0, 16, true)),
    cyl(0.6, 0.6, 2.2, BODY, 5.35, 0.65, 2.0, PI / 2, 0, 12),
    cableTray([dx - 3.0, 1.0], [dx - 3.4, 1.0]),
    junction(dx - 3.5, 1.0, -PI / 2),
  ];
  return p;
}

function hydroponics(): Parts {
  const p: Parts = [
    box(5.6, 0.5, 9.6, TRIM, 0, 0.25, 0),
    vault(2.6, 9.2, BODY, 0, 0.5, 0, 0, PI, 20),
    archWall(2.6, 0.3, TRIM, 0, 0.5, 4.55),
    archWall(2.6, 0.3, TRIM, 0, 0.5, -4.55),
    door(0, 4.7, 0, 1.2, 2.0, 0.5),
    box(1.6, 1.4, 1.0, TRIM, -1.2, 1.2, -5.3),
    cyl(0.45, 0.45, 1.8, BODY, 1.3, 1.4, -5.3, 0, 0, 14),
    pipe([1.3, 2.0, -5.3], [1.3, 2.0, -4.7], 0.08, TRIM),
    pipe([-1.2, 1.7, -4.8], [-1.2, 1.7, -4.4], 0.1, TRIM),
    antenna(-2.2, 0.5, -5.0, 1.8),
    cableTray([-2.9, -3.0], [-3.8, -3.0]),
    junction(-3.9, -3.0, -PI / 2),
    pipe([3.35, 1.7, -3.2], [3.35, 1.7, 3.2], 0.08, PLATE),
    // the identifier: a nutrient silo at the back corner (8 m), green rings, a domed head
    cyl(0.95, 1.0, 7.4, BODY, 3.5, 3.9, -5.0, 0, 0, 14),
    dome(0.95, TRIM, 3.5, 7.6, -5.0, 12),
    ring(1.0, 2.0, 3.5, -5.0, 0.3, 14), ring(1.0, 4.2, 3.5, -5.0, 0.3, 14), ring(1.0, 6.4, 3.5, -5.0, 0.3, 14),
    ladder(3.5, -4.03, 0.2, 7.0, 0),
  ];
  for (const z of [-2.2, 0, 2.2]) {
    p.push(
      cyl(0.42, 0.42, 1.5, BODY, 3.35, 0.75, z, 0, 0, 14),
      bands(0.42, 3.35, z, [0.4, 1.1]),
      pipe([3.35, 1.5, z], [3.35, 1.7, z], 0.06, TRIM),
      box(0.3, 0.12, 0.1, LAMP, 2.85, 2.3, z + 1.1, PI / 2),
    );
  }
  for (let i = 0; i <= 6; i++) p.push(vault(2.66, 0.2, TRIM, 0, 0.5, -4.2 + i * 1.4, 0, PI, 20));
  for (let i = 0; i < 6; i++) {
    const z = -3.5 + i * 1.4;
    p.push(vault(2.63, 1.05, WINDOW, 0, 0.5, z, PI / 2 + 0.2, 0.42, 4));
    p.push(vault(2.63, 1.05, WINDOW, 0, 0.5, z, PI / 2 - 0.62, 0.42, 4));
  }
  return p;
}

function battery(): Parts {
  const p: Parts = [
    box(6.6, 0.5, 2.8, TRIM, 0, 0.25, 0),
    box(6.2, 0.2, 0.3, PLATE, 0, 2.5, -1.25),
    rail(rect(3.25, 1.35), 0.5, true, TRIM, 0.8),
    antenna(3.1, 0.5, 1.15, 1.2),
    junction(-3.7, 0.9, -PI / 2),
  ];
  for (const x of [-2.2, 0, 2.2]) {
    p.push(
      box(1.8, 2.2, 2.2, BODY, x, 1.6, 0),
      box(0.8, 1.8, 0.04, PLATE, x - 0.42, 1.5, 1.12),
      box(0.8, 1.8, 0.04, PLATE, x + 0.42, 1.5, 1.12),
      box(0.3, 0.1, 0.05, WINDOW, x, 2.5, 1.13),
      box(0.05, 0.3, 0.06, TRIM, x - 0.08, 1.5, 1.15),
      box(0.05, 0.3, 0.06, TRIM, x + 0.08, 1.5, 1.15),
    );
    for (let k = 0; k < 6; k++) p.push(box(1.5, 0.06, 0.1, TRIM, x, 0.9 + k * 0.24, -1.13));
    for (let k = 0; k < 5; k++) p.push(box(1.6, 0.35, 0.05, RADIATOR, x, 2.88, -0.8 + k * 0.4));
    if (x < 2) p.push(pipe([x + 0.9, 1.0, -0.8], [x + 1.3, 1.0, -0.8], 0.09, TRIM));
  }
  // the identifier: the middle cabinet stacks into a tower of three blocks (6.4 m),
  // amber joints between the tiers and a bus stripe up the front
  p.push(
    box(1.6, 1.5, 2.0, BODY, 0, 3.8, 0), box(1.4, 1.4, 1.8, BODY, 0, 5.25, 0),
    box(1.75, 0.14, 2.15, BAND, 0, 4.58, 0), box(1.55, 0.14, 1.95, BAND, 0, 5.98, 0),
    box(0.3, 2.9, 0.05, BAND, 0, 4.5, 1.03),
    box(0.5, 0.08, 0.05, WINDOW, 0, 5.6, 0.93),
    dome(0.14, BEACON, 0.4, 6.1, 0.3, 8),
  );
  return p;
}

function refinery(): Parts {
  const cols: [number, number, number][] = [[-2.0, 1.5, 4.4], [0.6, 1.5, 5.4], [2.8, 1.1, 3.4]];
  const p: Parts = [
    box(7, 1, 5.4, TRIM, 0, 0.5, 0),
    cyl(1.9, 1.9, 0.1, PLATE, 0.6, 4.6, -0.4, 0, 0, 18),
    rail(circle(1.85, 12, 0.6, -0.4), 4.65, true),
    ladder(0.6, 1.2, 1.0, 4.6, 0),
    pipe([-2.0, 5.0, -0.4], [2.8, 5.0, -0.4], 0.28, TRIM, 12),
    pipe([-3.0, 1.6, 1.4], [3.0, 1.6, 1.4], 0.12, PLATE),
    pipe([-3.0, 1.9, 1.4], [3.0, 1.9, 1.4], 0.12, PLATE),
    box(2.6, 1.8, 1.6, TRIM, 0, 1.9, 2.0),
    windowStrip(1.2, 2, 0.45, -0.65, 2.2, 2.81, 0),
    // the door on the +z face (the road side), on a stoop up to the plinth
    door(0.65, 2.8, 0, 0.8, 1.6, 1.0),
    box(1.3, 1.0, 0.7, PLATE, 0.65, 0.5, 3.15),
    cyl(0.12, 0.16, 5.5, TRIM, 3.2, 3.75, -2.2, 0, 0, 8),
    dome(0.14, BEACON, 3.2, 6.55, -2.2, 8),
    cableTray([3.5, 1.8], [5.6, 1.8]),
    junction(5.8, 1.8, PI / 2),
  ];
  for (const [x, r, h] of cols) {
    p.push(
      cyl(r, r, h, BODY, x, 1 + h / 2, -0.4, 0, 0, 20),
      dome(r, TRIM, x, 1 + h, -0.4, 16),
      bands(r, x, -0.4, [2.2, 3.4, 4.6].filter((y) => y < 1 + h - 0.3), BAND, 0.14, 20),
    );
  }
  for (const x of [-2.5, 0, 2.5]) p.push(box(0.1, 0.9, 0.1, TRIM, x, 1.45, 1.4));
  return p;
}

function lab(): Parts {
  return [
    box(5.4, 2.8, 5.4, BODY, 0, 1.4, 0),
    box(5.6, 0.5, 5.6, TRIM, 0, 3.05, 0),
    rail(rect(2.7, 2.7), 3.3, true),
    windowStrip(2.4, 3, 0.7, 1.3, 1.9, 2.72, 0),
    windowStrip(4.0, 5, 0.7, 2.72, 1.9, 0, PI / 2),
    door(-1.2, 2.72, 0, 1.1, 2.0),
    // the identifier: the dish on a lattice tower over the roof (MOUNTS.lab), a blue rim and rings
    cyl(0.5, 0.6, 0.3, TRIM, 1.4, 3.45, 1.4, 0, 0, 10),
    lattice(3.7, 0.5, 0.24, 1.4, 1.4, 3.6, 3, 1.25),
    box(0.9, 0.16, 0.9, TRIM, 1.4, 7.4, 1.4),
    box(0.5, 0.3, 0.3, PLATE, 1.4, 7.6, 1.4),
    ring(0.45, 5.0, 1.4, 1.4, 0.22, 8), ring(0.34, 6.2, 1.4, 1.4, 0.22, 8),
    box(0.8, 0.5, 0.6, TRIM, -1.4, 3.55, -1.2),
    box(0.5, 0.4, 0.5, PLATE, -0.4, 3.5, -1.6),
    antenna(-1.8, 3.3, 1.8, 2.4),
    radiator(2.0, 1.1, 0.6, 3.3, -2.3, PI),
    cableTray([-2.0, -2.8], [-2.0, -3.7]),
    junction(-2.0, -3.8, PI),
  ];
}

function storageYard(): Parts {
  const p: Parts = [
    box(7, 0.4, 7, TRIM, 0, 0.2, 0),
    box(2, 1.2, 2, BODY, -2, 1.0, -2),
    box(2.04, 0.08, 2.04, TRIM, -2, 1.2, -2),
    box(2, 1.6, 2, BODY, 0.4, 1.2, -1.6),
    box(2.04, 0.08, 2.04, TRIM, 0.4, 1.4, -1.6),
    box(2.04, 0.08, 2.04, TRIM, 0.4, 0.8, -1.6),
    box(2, 1.2, 2.6, BODY, -1.8, 1.0, 1.6),
    box(2.04, 0.08, 2.64, TRIM, -1.8, 1.2, 1.6),
    box(1.0, 1.4, 1.0, BODY, 2.4, 1.1, -1.8),
    pane(0.6, 0.4, 2.4, 1.35, -1.29, 0),
    box(0.12, 2.4, 0.12, TRIM, 3.2, 1.6, -3.2),
    box(0.55, 0.2, 0.4, LAMP, 3.05, 2.85, -3.05, PI / 4),
    box(7, 0.6, 0.7, TRIM, 0, 0.45, -3.4, 0, 0, 0.5),
    antenna(2.8, 1.8, -2.1, 1.0),
    junction(-3.7, -0.4, -PI / 2),
    rail([[-3.45, -3.0], [-3.45, 3.45], [3.45, 3.45], [3.45, 0.4]], 0.4, false, TRIM, 0.9),
    // yard loader parked by the racks
    box(1.3, 0.5, 0.8, BODY, -0.3, 0.75, 3.0),
    box(0.5, 0.5, 0.6, TRIM, -0.7, 1.25, 3.0),
    pane(0.36, 0.3, -0.44, 1.3, 3.0, PI / 2),
    bar([0.4, 0.5, 2.75], [0.4, 1.9, 2.75], 0.06, PLATE),
    bar([0.4, 0.5, 3.25], [0.4, 1.9, 3.25], 0.06, PLATE),
    box(0.7, 0.04, 0.6, PLATE, 0.8, 0.55, 3.0),
  ];
  for (const x of [-0.8, 0.2]) {
    for (const z of [2.62, 3.38]) p.push(cyl(0.22, 0.22, 0.14, PLATE, x, 0.62, z, PI / 2, 0, 10));
  }
  for (const x of [1.0, 3.2]) {
    for (const z of [0.8, 2.8]) p.push(bar([x, 0.4, z], [x, 2.7, z], 0.1, TRIM));
  }
  for (const y of [1.1, 1.9, 2.65]) {
    p.push(box(2.4, 0.08, 2.2, PLATE, 2.1, y, 1.8));
    p.push(box(0.9, 0.5, 0.8, BODY, 1.6, y + 0.29, 1.4), box(0.8, 0.45, 0.8, BODY, 2.6, y + 0.27, 2.2));
  }
  // gantry over the stacks
  p.push(
    bar([-3.3, 0.4, -3.0], [-3.3, 3.2, -3.0], 0.14, TRIM),
    bar([-3.3, 0.4, 3.0], [-3.3, 3.2, 3.0], 0.14, TRIM),
    bar([-3.3, 3.2, -3.0], [-3.3, 3.2, 3.0], 0.18, TRIM),
    box(0.5, 0.35, 0.5, PLATE, -3.3, 2.95, -0.8),
    // the identifier: a tower crane at the back corner, its jib over the racks, a violet counterweight
    lattice(8.4, 0.42, 0.3, 3.2, -3.2, 0.4, 4, 1.4),
    box(0.9, 0.5, 0.9, PLATE, 3.2, 8.95, -3.2),
    bar([3.2, 9.1, -3.2], [-3.6, 9.1, -3.2], 0.2, TRIM),
    bar([3.2, 9.1, -3.2], [4.6, 9.1, -3.2], 0.24, TRIM),
    box(0.8, 0.7, 0.8, BAND, 4.6, 8.6, -3.2),
    box(0.4, 0.3, 0.4, BAND, -1.4, 8.85, -3.2),
    bar([-1.4, 8.7, -3.2], [-1.4, 4.0, -3.2], 0.03, PLATE),
    ring(0.4, 3.2, 3.2, -3.2, 0.22, 8),
  );
  return p;
}

function roboticsBay(): Parts {
  const p: Parts = [
    box(6.6, 2.6, 5.4, BODY, 0, 1.3, 0),
    box(6.8, 0.5, 5.6, TRIM, 0, 2.85, 0),
    door(-1.6, 2.7, 0, 2.6, 2.0),
    windowStrip(2.2, 3, 0.5, 1.6, 2.0, 2.72, 0),
    box(1.6, 0.5, 1.0, BODY, 1.8, 0.75, 3.5),
    box(1.2, 0.04, 0.8, GLASS, 1.8, 1.03, 3.5),
    bar([2.4, 1.0, 3.2], [2.4, 1.7, 3.2], 0.06, TRIM),
    box(0.3, 0.18, 0.2, PLATE, 2.4, 1.78, 3.2),
    box(0.4, 1.2, 0.4, TRIM, 3.3, 0.6, 3.3),
    box(0.2, 0.12, 0.05, LAMP, 3.3, 1.0, 3.52),
    cyl(0.3, 0.35, 0.3, PLATE, -2.0, 3.25, -1.2, 0, 0, 10),
    bar([-2.0, 3.35, -1.2], [-1.4, 4.4, -1.4], 0.14, TRIM),
    bar([-1.4, 4.4, -1.4], [-0.3, 3.9, -1.5], 0.1, TRIM),
    box(0.25, 0.3, 0.25, PLATE, -0.3, 3.7, -1.5),
    antenna(-2.9, 3.1, -2.2, 2.4),
    rail(rect(3.35, 2.75), 3.1, true),
    radiator(2.2, 0.9, 1.4, 3.1, -2.0, PI),
    junction(-3.6, -1.8, -PI / 2),
    // the identifier: a print-arm tower on the roof, its arm reaching over the door, violet rings
    lattice(5.2, 0.5, 0.26, 2.9, -0.5, 3.1, 3, 1.3),
    box(0.8, 0.5, 0.8, PLATE, 2.9, 8.5, -0.5),
    bar([2.9, 8.6, -0.5], [0.4, 8.0, 1.6], 0.2, TRIM),
    bar([0.4, 8.0, 1.6], [-1.6, 7.0, 2.6], 0.14, TRIM),
    box(0.4, 0.34, 0.4, BAND, -1.6, 6.8, 2.6),
    ring(0.44, 5.0, 2.9, -0.5, 0.24, 8), ring(0.36, 6.7, 2.9, -0.5, 0.24, 8),
    // a second rover on charge at the flank
    box(1.4, 0.45, 0.9, BODY, -3.7, 0.72, 0.6, PI / 2),
    box(0.8, 0.04, 1.1, GLASS, -3.7, 0.97, 0.6),
    bar([-3.7, 0.95, 1.2], [-3.7, 1.5, 1.2], 0.05, TRIM),
    box(0.25, 0.15, 0.2, PLATE, -3.7, 1.57, 1.2),
  ];
  for (const z of [0.05, 1.15]) {
    for (const dx of [-0.42, 0.42]) p.push(cyl(0.25, 0.25, 0.18, PLATE, -3.7 + dx, 0.25, z, 0, PI / 2, 10));
  }
  for (let y = 0.35; y < 1.95; y += 0.32) p.push(box(2.6, 0.03, 0.04, TRIM, -1.6, y, 2.8));
  for (const x of [1.2, 2.4]) {
    for (const z of [3.0, 4.0]) p.push(cyl(0.28, 0.28, 0.2, PLATE, x, 0.28, z, PI / 2, 0, 10));
  }
  return p;
}

function partsFab(): Parts {
  const p: Parts = [
    box(6.6, 3, 6.6, BODY, 0, 1.5, 0),
    door(0, 3.3, 0, 2.2, 2.3),
    box(3.0, 0.5, 1.0, TRIM, 0, 0.25, 3.8),
    windowStrip(4.4, 4, 0.5, 3.32, 2.2, 0, PI / 2),
    radiator(2.4, 1.4, -3.75, 0.2, 0, -PI / 2),
    antenna(2.6, 3.0, -2.8, 1.6),
    cableTray([2.4, -3.4], [2.4, -3.8]),
    junction(3.2, -3.8, PI),
    ladder(-3.45, -1.8, 0, 3.0, -PI / 2),
    rail([[-1.5, 4.25], [1.5, 4.25]], 0.5),
    box(1.0, 1.0, 0.8, BODY, -2.6, 0.5, 3.8),
    cyl(0.6, 0.25, 0.6, PLATE, -2.6, 1.3, 3.8, 0, 0, 4),
    bar([-2.6, 1.6, 3.5], [-2.0, 2.6, 3.34], 0.3, TRIM),
    pipe([3.45, 2.6, -3.0], [3.45, 2.6, 3.0], 0.1, PLATE),
    pipe([3.45, 2.8, -3.0], [3.45, 2.8, 3.0], 0.1, PLATE),
    // the identifier: a tall exhaust stack up the back corner, violet rings, a beacon
    cyl(0.5, 0.65, 6.6, BODY, -3.0, 6.5, -3.0, 0, 0, 12),
    ring(0.6, 5.2, -3.0, -3.0, 0.3, 12), ring(0.55, 7.2, -3.0, -3.0, 0.3, 12), ring(0.5, 9.2, -3.0, -3.0, 0.3, 12),
    dome(0.14, BEACON, -3.0, 9.9, -3.0, 8),
  ];
  for (const x of [-2.2, 0, 2.2]) {
    p.push(
      box(2.2, 1.4, 6.7, TRIM, x, 3.6, 0, 0, 0.35),
      box(0.06, 0.8, 6.2, WINDOW, x + 1.0, 3.75, 0),
      box(0.8, 0.8, 0.3, PLATE, x, 2.2, -3.45),
      cyl(0.32, 0.32, 0.1, TRIM, x, 2.2, -3.62, PI / 2, 0, 14),
      box(2.25, 0.1, 0.1, PLATE, x, 4.28, 0, 0, 0.35),
    );
  }
  return p;
}

function reactor(): Parts {
  const r = (y: number) => 3.6 - (y / 5.5) * 0.4;
  const p: Parts = [
    cyl(3.2, 3.6, 5.5, BODY, 0, 2.75, 0, 0, 0, 28),
    [1.2, 2.6, 4.0].map((y) => cyl(r(y) + 0.04, r(y) + 0.04, 0.16, TRIM, 0, y, 0, 0, 0, 28, true)),
    dome(3.2, TRIM, 0, 5.5, 0, 28),
    cyl(0.8, 0.8, 0.4, PLATE, 0, 8.75, 0, 0, 0, 14),
    dome(0.16, BEACON, 0, 8.95, 0, 8),
    // the identifier: a hyperbolic cooling tower (12 m) with an amber rim and a white plume
    lathe([[1.4, 0], [1.05, 2.6], [0.78, 6], [0.74, 8], [0.95, 11]], BODY, 16).translate(5.0, 0, -1.9),
    ring(0.95, 10.9, 5.0, -1.9, 0.4, 16), ring(1.15, 1.2, 5.0, -1.9, 0.3, 16),
    dome(0.8, RADIATOR, 5.0, 11.0, -1.9, 10),
    pipe([3.4, 1.8, -1.2], [4.2, 1.8, -1.6], 0.16, PLATE),
    box(1.8, 1.6, 1.4, BODY, -1.0, 0.8, 4.8),
    pane(0.8, 0.4, -0.09, 1.1, 4.8, PI / 2),
    door(-1.0, 5.5, 0, 0.8, 1.3),
    cableTray([0.2, 4.9], [0.2, 5.5]),
    junction(0.8, 5.4, 0),
  ];
  for (const [x, z, w, d] of [[3.35, 0, 0.5, 2.4], [-3.35, 0, 0.5, 2.4], [0, 3.35, 2.4, 0.5], [0, -3.35, 2.4, 0.5]]) {
    p.push(box(w, 6, d, TRIM, x, 3, z));
  }
  for (let k = 0; k < 4; k++) {
    const a = PI / 4 + k * PI / 2;
    const c = Math.cos(a), s = Math.sin(a);
    p.push(box(2.3, 5.4, 0.12, RADIATOR, 4.75 * c, 3.0, 4.75 * s, -a));
    for (const t of [3.7, 4.45, 5.2, 5.85]) p.push(box(0.06, 5.4, 0.2, TRIM, t * c, 3.0, t * s, -a));
    p.push(pipe([3.2 * c, 5.0, 3.2 * s], [3.7 * c, 5.0, 3.7 * s], 0.14, PLATE));
  }
  return p;
}

function recDome(): Parts {
  const p: Parts = [
    cyl(5.2, 5.5, 1.1, TRIM, 0, 0.55, 0, 0, 0, 32),
    dome(5.2, BODY, 0, 1.1, 0, 32),
    domeBand(5.22, 0, 0.25, WINDOW, 0, 1.1, 0, 16),
    domeBand(5.24, 0.38, 0.42, TRIM, 0, 1.1, 0, 32),
    domeBand(5.24, 0.7, 0.74, TRIM, 0, 1.1, 0, 32),
    box(2.2, 2.2, 2.0, BODY, 0, 1.1, 4.9),
    box(2.3, 0.14, 2.1, TRIM, 0, 2.25, 4.9),
    door(0, 5.9, 0, 1.3, 1.9),
    antenna(2.4, 5.65, 0, 2.6),
    cableTray([-2.0, 5.0], [-2.0, 5.8]),
    junction(-2.6, 5.8, 0),
    // the identifier: a flag mast on the crown, a green pennant and rings
    cyl(0.1, 0.17, 7.4, TRIM, 0, 10.0, 0, 0, 0, 8),
    box(0.06, 1.0, 2.0, BAND, 0, 13.4, 1.1),
    ring(0.16, 7.6, 0, 0, 0.36, 8), ring(0.13, 10.0, 0, 0, 0.36, 8),
    dome(0.16, BEACON, 0, 13.8, 0, 8),
  ];
  for (let k = 0; k < 10; k++) p.push(domeBand(5.22, 1.02, 1.32, WINDOW, 0, 1.1, 0, 3, (k * PI * 2) / 10, 0.5));
  return p;
}

function chipFab(): Parts {
  return [
    box(9.6, 2.6, 6.6, BODY, 0, 1.3, 0),
    box(9.8, 0.4, 6.8, TRIM, 0, 2.8, 0),
    rail(rect(4.85, 3.35), 3.0, true),
    box(3.6, 1.6, 3.2, BODY, -2.2, 3.8, 0),
    cyl(0.6, 0.6, 0.15, PLATE, -3.1, 4.68, 0, 0, 0, 16),
    cyl(0.6, 0.6, 0.15, PLATE, -1.3, 4.68, 0, 0, 0, 16),
    // the identifier: the two exhaust stacks rise to 9 m, violet rings
    cyl(0.35, 0.45, 6.0, BODY, 2.6, 6.0, -1.8, 0, 0, 12),
    bands(0.4, 2.6, -1.8, [3.8, 4.8]),
    ring(0.42, 6.4, 2.6, -1.8, 0.3, 12), ring(0.4, 8.0, 2.6, -1.8, 0.3, 12),
    dome(0.14, BEACON, 2.6, 9.05, -1.8, 8),
    cyl(0.35, 0.45, 4.2, BODY, 3.8, 5.1, -1.8, 0, 0, 12),
    ring(0.4, 6.2, 3.8, -1.8, 0.3, 12),
    windowStrip(5.0, 6, 0.4, -1.8, 1.9, 3.32, 0),
    door(2.4, 3.32, 0, 1.6, 1.8),
    pipe([-4.5, 2.0, -3.45], [4.5, 2.0, -3.45], 0.1, PLATE),
    pipe([-4.5, 2.3, -3.45], [4.5, 2.3, -3.45], 0.1, PLATE),
    radiator(2.4, 1.0, 1.4, 3.0, 1.8, 0),
    cableTray([4.9, 1.8], [5.8, 1.8]),
    junction(5.9, 1.0, PI / 2),
  ];
}

function dataCenter(): Parts {
  const p: Parts = [
    box(8.6, 3.2, 8.6, BODY, 0, 1.6, 0),
    box(8.8, 0.5, 8.8, TRIM, 0, 3.45, 0),
    berm(9.4, 1.5, 0, -4.3, PI),
    berm(9.4, 1.5, 4.3, 0, PI / 2),
    berm(9.4, 1.5, -4.3, 0, -PI / 2),
    berm(3.6, 1.5, 2.4, 4.3, 0),
    door(-2.6, 4.32, 0, 1.4, 2.0),
    windowStrip(3.0, 6, 0.18, 1.6, 2.6, 4.32, 0),
    antenna(3.6, 3.7, 3.6, 2.8),
    cyl(0.2, 0.3, 0.8, TRIM, -3.4, 4.1, 3.4, 0, 0, 10),
    // the identifier: a chiller tower at the back corner, blue rings, a lit head
    cyl(0.75, 0.85, 6.4, BODY, -3.4, 6.7, -3.4, 0, 0, 14),
    ring(0.85, 4.8, -3.4, -3.4, 0.3, 14), ring(0.8, 6.8, -3.4, -3.4, 0.3, 14), ring(0.75, 8.8, -3.4, -3.4, 0.3, 14),
    dome(0.75, TRIM, -3.4, 9.9, -3.4, 10),
    dome(0.14, BEACON, -3.4, 10.7, -3.4, 8),
    cableTray([-4.4, 2.0], [-5.8, 2.0], 0.9),
    junction(-5.9, 3.0, -PI / 2),
  ];
  for (const z of [-2.6, -0.9, 0.9, 2.6]) {
    p.push(
      box(7.6, 2.6, 0.12, RADIATOR, 0, 5.0, z),
      box(7.7, 0.08, 0.22, TRIM, 0, 6.33, z),
      pipe([-3.8, 3.85, z], [3.8, 3.85, z], 0.12, PLATE),
    );
    for (const x of [-3.8, -1.3, 1.3, 3.8]) p.push(box(0.08, 2.6, 0.2, TRIM, x, 5.0, z));
  }
  return p;
}

function foilFactory(): Parts {
  return [
    box(9.6, 4.2, 8.6, BODY, 0, 2.1, 0),
    box(9.8, 0.6, 8.8, TRIM, 0, 4.5, 0),
    box(9.7, 1.1, 1.4, TRIM, 0, 3.3, 0),
    rail(rect(4.85, 4.35), 4.8, true),
    // the identifier: the foil-drawing tower, red rings and a gold spool at its head (12 m)
    cyl(0.55, 0.65, 7.2, BODY, -3.6, 8.4, -3.0, 0, 0, 14),
    ring(0.66, 6.2, -3.6, -3.0, 0.3, 14), ring(0.6, 8.2, -3.6, -3.0, 0.3, 14), ring(0.56, 10.2, -3.6, -3.0, 0.3, 14),
    cyl(0.95, 0.95, 0.9, FOIL, -3.6, 12.3, -3.0, 0, PI / 2, 14),
    dome(0.14, BEACON, -3.6, 13.1, -3.0, 8),
    box(1.2, 0.2, 3.6, TRIM, 5.3, 0.8, 0),
    [-1.2, 0, 1.2].map((z) => cyl(0.3, 0.3, 1.1, PLATE, 5.3, 1.1, z, 0, PI / 2, 12)),
    cyl(0.55, 0.55, 2.4, FOIL, 5.3, 1.5, 0, PI / 2, 0, 16),
    [-1.6, 1.6].map((z) => bar([5.3, 0, z], [5.3, 0.75, z], 0.12, TRIM)),
    windowStrip(6, 6, 0.5, -0.5, 3.7, 4.32, 0),
    door(0, 4.32, 0, 3.0, 2.8),
    radiator(3.4, 2.2, -2.4, 0.4, -4.75, PI),
    radiator(3.4, 2.2, 2.4, 0.4, -4.75, PI),
    bar([2.0, 4.8, -2.5], [2.0, 6.4, -2.5], 0.16, TRIM),
    bar([2.0, 4.8, 2.5], [2.0, 6.4, 2.5], 0.16, TRIM),
    bar([2.0, 6.4, -2.5], [2.0, 6.4, 2.5], 0.2, TRIM),
    box(0.5, 0.4, 0.5, PLATE, 2.0, 6.1, 0.6),
    cableTray([-4.9, 3.0], [-5.8, 3.0]),
    junction(-5.9, 3.8, -PI / 2),
  ];
}

function massDriver(): Parts {
  const tilt = 0.18;
  const railY = (x: number) => 3.3 + Math.tan(tilt) * (x - 0.6);
  const p: Parts = [
    box(4.6, 3, 5.2, BODY, -9, 1.5, 0),
    box(4.8, 0.3, 5.4, TRIM, -9, 3.15, 0),
    windowStrip(2.2, 3, 0.45, -10.0, 2.2, 2.62, 0),
    door(-7.9, 2.6, 0, 1.2, 2.0),
    box(20, 0.9, 2.4, BODY, 0.6, 3.3, 0, 0, tilt),
    box(20, 0.35, 3.0, TRIM, 0.6 - 0.7 * Math.sin(tilt), 3.3 + 0.62 * Math.cos(tilt), 0, 0, tilt),
    dome(0.16, BEACON, 10.4, railY(10.4) + 0.95, 0, 8),
    cableTray([-6.6, -2.2], [-2.0, -2.2]),
    junction(-11.6, 2.0, -PI / 2),
  ];
  for (let x = -7.4; x <= 10; x += 0.8) p.push(box(0.16, 1.35, 2.8, TRIM, x, railY(x) + 0.1, 0, 0, tilt));
  for (const z of [-1.05, 1.05]) {
    p.push(bar([-7.4, railY(-7.4) + 0.95, z], [10.4, railY(10.4) + 0.95, z], 0.08, PLATE));
  }
  p.push(
    cyl(1.5, 1.5, 0.4, BAND, 10.5, railY(10.5) + 0.2, 0, 0, tilt - PI / 2, 20, true),
    ...[-5.5, -1.5, 2.5, 6.5].map((x) => box(0.45, 0.06, 3.1, BAND, x, railY(x) + 0.8, 0, 0, tilt)),
    radiator(3.0, 1.0, -9, 3.3, -1.4, PI),
    pipe([-2.2, 1.0, -2.7], [-0.5, 2.4, -0.9], 0.08, TRIM),
    pipe([-3.8, 1.0, -2.7], [-5.5, 1.8, -0.9], 0.08, TRIM),
  );
  for (const x of [-5.5, -0.5, 4.5, 9.5]) {
    const top = railY(x) - 0.45;
    p.push(
      bar([x, 0, 1.8], [x, top, 0.9], 0.24, TRIM),
      bar([x, 0, -1.8], [x, top, -0.9], 0.24, TRIM),
      bar([x, top * 0.45, 1.4], [x, top * 0.45, -1.4], 0.12, TRIM),
    );
  }
  for (const x of [-5.4, -3.8, -2.2]) {
    p.push(box(1.4, 1.0, 1.0, BODY, x, 0.5, -3.2), box(0.3, 0.08, 0.04, WINDOW, x, 0.8, -2.69));
  }
  return p;
}

function relayMast(): Parts {
  return [
    box(1.6, 0.4, 1.6, TRIM, 0, 0.2, 0),
    lattice(10.4, 0.55, 0.22, 0, 0, 0.4, 3, 1.3),
    ring(0.52, 3.0, 0, 0, 0.3, 9), ring(0.44, 5.5, 0, 0, 0.3, 9), ring(0.36, 8.0, 0, 0, 0.3, 9),
    box(0.8, 1.1, 0.5, BODY, 1.1, 0.95, -1.1),
    box(0.2, 0.1, 0.05, LAMP, 1.1, 1.3, -0.83),
    cyl(0.5, 0.5, 0.1, PLATE, 0, 10.85, 0, 0, 0, 10),
    cyl(0.03, 0.04, 1.4, TRIM, 0.3, 11.6, 0, 0, 0, 5),
    cyl(0.03, 0.04, 1.4, TRIM, -0.3, 11.6, 0.1, 0, 0, 5),
    antenna(0, 10.9, -0.2, 1.3),
    bar([0.15, 9.8, 0], [0.5, 9.8, 0], 0.1, TRIM),
    junction(-1.2, 1.5, 0),
  ];
}

/** docs/16 §6.3, §11: a white dome with a slit on a pier, and beside it a
 *  coronagraph tube on a fork mount aimed sunward. F6 tracks the Sun and
 *  closes the slit at night; this is the readable stock silhouette. */
function solarObservatory(): Parts {
  const dx = -0.9, dz = -0.9;       // the dome's pier
  const cx = 1.9, cz = 1.9;         // the coronagraph's mount
  const r = 1.55, y0 = 5.35;        // the dome, raised on a tall pier (the identifier: 7 m)
  const p: Parts = [
    box(6.6, 0.3, 6.6, TRIM, 0, 0.15, 0),
    cyl(1.05, 1.25, 4.9, BODY, dx, 2.75, dz, 0, 0, 16),
    cyl(1.75, 1.75, 0.16, TRIM, dx, y0 - 0.09, dz, 0, 0, 20),
    ring(1.1, 3.4, dx, dz, 0.3, 16),
    ladder(dx + 1.05, dz + 0.6, 0.3, 5.1, PI / 4),
    dome(r, BODY, dx, y0, dz, 20),
    bands(r, dx, dz, [y0 + 0.05], BAND, 0.12, 20),
    // the observing slit, meridian to horizon, facing the coronagraph's side
    [0, 1, 2].map((i) => domeBand(r + 0.02, (i * PI) / 7, ((i + 1) * PI) / 7, GLASS, dx, y0, dz, 3, PI / 4 - 0.16, 0.32)),
    box(0.5, 0.9, 0.12, WINDOW, dx + 0.95, 1.2, dz + 0.95, PI / 4),
    // the coronagraph: a pier, a fork, the tube pitched up toward the Sun, a counterweight
    cyl(0.28, 0.34, 1.5, TRIM, cx, 1.05, cz, 0, 0, 10),
    box(0.9, 0.16, 0.5, PLATE, cx, 1.86, cz),
    bar([cx - 0.36, 1.9, cz], [cx - 0.36, 2.55, cz], 0.1, TRIM),
    bar([cx + 0.36, 1.9, cz], [cx + 0.36, 2.55, cz], 0.1, TRIM),
    cyl(0.2, 0.24, 2.3, PLATE, cx, 2.6, cz, -0.75, 0, 12),
    cyl(0.27, 0.27, 0.12, TRIM, cx, 2.6 + Math.cos(0.75) * 1.12, cz - Math.sin(0.75) * 1.12, -0.75, 0, 12, true),
    box(0.34, 0.34, 0.34, TRIM, cx, 2.6 - Math.cos(0.75) * 1.25, cz + Math.sin(0.75) * 1.25),
    // the electronics cabinet and its lamp
    box(0.9, 1.0, 0.6, BODY, 2.1, 0.8, -1.9),
    box(0.22, 0.1, 0.04, LAMP, 2.1, 1.1, -1.58),
    cableTray([1.6, -1.9], [-0.1, -1.9]),
    junction(-2.6, 2.6, 0),
  ];
  return p;
}

/** docs/19 S6: the survey-drone fleet's base, 2×2 cells. A low hangar with
 *  a rolled-back roof door and two dock cradles under it, a marked pad in
 *  front, and a slender beacon mast with a crossbar (the one tall part, so
 *  it reads at far zoom). The drones themselves are world/surveyFlight.ts. */
function prospectingBay(): Parts {
  const p: Parts = [
    box(7.4, 0.3, 7.4, TRIM, 0, 0.15, 0),
    box(6.4, 2.0, 3.6, BODY, 0, 1.3, -1.9),
    box(6.6, 0.22, 3.8, TRIM, 0, 2.41, -1.9),
    // the roll-back roof door, half open over the cradles
    box(3.2, 0.16, 3.0, PLATE, -1.55, 2.62, -1.9),
    box(2.6, 0.05, 2.8, GLASS, 1.9, 2.55, -1.9),
    // two dock cradles and the drones' charging lamps
    box(1.5, 0.3, 1.5, PLATE, -1.6, 2.6, -1.9),
    box(1.5, 0.3, 1.5, PLATE, 1.6, 2.6, -1.9),
    box(0.2, 0.1, 0.05, LAMP, -1.6, 2.2, -0.08),
    box(0.2, 0.1, 0.05, LAMP, 1.6, 2.2, -0.08),
    door(0, -0.1, 0, 1.6, 1.5),
    // the launch pad: a ring and a chevron toward the map edge
    cyl(1.7, 1.7, 0.08, PLATE, 0, 0.34, 2.0, 0, 0, 24),
    cyl(1.35, 1.35, 0.1, TRIM, 0, 0.36, 2.0, 0, 0, 24),
    box(0.16, 0.06, 1.9, LAMP, 0, 0.42, 2.0),
    box(1.0, 0.06, 0.16, LAMP, 0, 0.42, 1.4),
    // the beacon mast (the identifier, 10.4 m): blue rings, a blue crossbar and a radar array at its head
    cyl(0.14, 0.22, 9.2, TRIM, 3.1, 4.6, 2.9, 0, 0, 8),
    ring(0.22, 2.2, 3.1, 2.9, 0.4, 8), ring(0.18, 4.6, 3.1, 2.9, 0.4, 8), ring(0.16, 7.0, 3.1, 2.9, 0.4, 8),
    box(2.0, 0.16, 0.16, BAND, 3.1, 7.7, 2.9),
    box(2.6, 1.3, 0.12, PLATE, 3.1, 9.05, 2.9),
    box(2.7, 0.14, 0.18, BAND, 3.1, 9.75, 2.9), box(2.7, 0.14, 0.18, BAND, 3.1, 8.35, 2.9),
    box(0.14, 1.4, 0.18, BAND, 1.8, 9.05, 2.9), box(0.14, 1.4, 0.18, BAND, 4.4, 9.05, 2.9),
    dome(0.2, BEACON, 3.1, 10.3, 2.9, 8),
    cableTray([2.4, 2.9], [0, 1.0]),
    junction(-3.1, 3.0, 0),
  ];
  return p;
}

function propellantPlant(): Parts {
  const p: Parts = [
    box(4.6, 2.4, 7.6, BODY, -3.2, 1.2, 0),
    box(4.8, 0.3, 7.8, TRIM, -3.2, 2.55, 0),
    rail(rect(2.35, 3.85, -3.2), 2.7, true),
    radiator(2.2, 1.0, -3.2, 2.7, -2.2, PI / 2),
    radiator(2.2, 1.0, -3.2, 2.7, 2.0, PI / 2),
    windowStrip(5.0, 5, 0.5, -5.52, 1.6, 0, -PI / 2),
    door(-3.2, 3.82, 0, 1.2, 2.0),
    pipe([-2.5, 2.6, 0], [1.7, 2.6, 0], 0.25, TRIM, 12),
    ladder(3.85, 1.8, 0.2, 6.0, PI / 2),
    bar([3.2, 4.2, 0], [4.9, 1.0, 0], 0.14, TRIM),
    bar([4.9, 0, 0], [4.9, 1.1, 0], 0.18, TRIM),
    dome(0.14, BEACON, 2.2, 7.72, 1.8, 8),
    // the identifier: a flare stack (11 m) with red rings and a lit tip
    cyl(0.22, 0.32, 10.2, TRIM, 5.0, 5.1, -3.0, 0, 0, 8),
    ring(0.32, 3.0, 5.0, -3.0, 0.3, 8), ring(0.27, 6.0, 5.0, -3.0, 0.3, 8), ring(0.24, 9.0, 5.0, -3.0, 0.3, 8),
    box(0.5, 0.5, 0.5, LAMP, 5.0, 10.6, -3.0),
    cableTray([-5.5, -3.0], [-5.9, -3.0]),
    junction(-5.9, -2.2, -PI / 2),
  ];
  for (const z of [-1.8, 1.8]) {
    p.push(
      cyl(1.5, 1.5, 6.2, BODY, 2.2, 3.1, z, 0, 0, 22),
      dome(1.5, TRIM, 2.2, 6.2, z, 18),
      cyl(1.35, 1.45, 0.6, TRIM, 2.2, 0.3, z, 0, 0, 22),
      bands(1.5, 2.2, z, [1.6, 3.1, 4.6], FOIL, 0.3, 22),
      pipe([-0.9, 2.1, z * 0.55], [0.75, 2.1, z * 0.8], 0.14, PLATE),
    );
  }
  return p;
}

// ─── the destiny buildings (docs/14 §2.8, §4.2) ───

/** Greenhouse Ring (4×4 cells, 16 m): eight vault segments on BODY sills in
 *  a ring round a domed hub — the vault shells LEAF (the crop seen through
 *  the glass: green under glass is the Colony's signature), ribbed, with a
 *  glazed crown and LAMP grow strips on the ribs; four spokes to the hub,
 *  and a door porch at +z. */
function greenhouseRing(): Parts {
  const p: Parts = [
    box(15.2, 0.3, 15.2, TRIM, 0, 0.15, 0),
    cyl(2.2, 2.4, 2.4, BODY, 0, 1.2, 0, 0, 0, 16, true),
    dome(2.2, GLASS, 0, 2.4, 0, 16),
    domeBand(2.23, 0, 0.34, WINDOW, 0, 2.4, 0, 12),
    domeBand(2.24, 1.0, 1.08, TRIM, 0, 2.4, 0, 16),
    antenna(1.1, 4.1, -0.9, 1.6),
    // the identifier: a sun tower over the hub dome, green rings, grow-light strips, a beacon (11 m)
    cyl(0.5, 0.65, 6.4, BODY, 0, 7.7, 0, 0, 0, 12),
    ring(0.66, 5.6, 0, 0, 0.3, 12), ring(0.6, 8.0, 0, 0, 0.3, 12), ring(0.52, 10.2, 0, 0, 0.3, 12),
    box(0.12, 4.0, 0.12, LAMP, 0.52, 8.2, 0),
    dome(0.16, BEACON, 0, 11.0, 0, 8),
    // the porch at +z (the ring's joint): an airlock box, its door and lamp
    box(1.9, 2.1, 1.6, BODY, 0, 1.05, 7.0),
    box(2.0, 0.14, 1.7, TRIM, 0, 2.17, 7.0),
    door(0, 7.8, 0, 1.0, 1.6),
  ];
  const R0 = 5.4, len = 4.5;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * PI * 2 + PI / 8;
    const x = Math.cos(a) * R0, z = Math.sin(a) * R0;
    const seg: BufferGeometry[] = [
      box(3.9, 0.6, len, BODY, 0, 0.3, 0),
      vault(1.72, len - 0.1, LEAF, 0, 0.6, 0, 0, PI, 12),
      vault(1.74, len - 0.2, WINDOW, 0, 0.6, 0, PI / 2 - 0.34, 0.68, 2),
      ...[-1.5, 0, 1.5].map((dz) => vault(1.78, 0.14, TRIM, 0, 0.6, dz, 0, PI, 12)),
      box(0.12, 0.06, len - 0.6, LAMP, 1.05, 2.02, 0, 0, -0.63),
      box(0.12, 0.06, len - 0.6, LAMP, -1.05, 2.02, 0, 0, 0.63),
    ];
    p.push(seg.map((g) => g.rotateY(-a).translate(x, 0, z)));
  }
  // spokes: pressurized corridors from the hub to the ring
  for (const a of [0, PI / 2, PI, PI * 1.5]) {
    if (Math.abs(a - PI / 2) < 1e-6) continue; // the porch side
    const c = Math.cos(a), s = Math.sin(a);
    p.push(bar([c * 2.2, 1.05, s * 2.2], [c * 3.9, 1.05, s * 3.9], 1.3, BODY));
    p.push(bar([c * 2.2, 1.75, s * 2.2], [c * 3.9, 1.75, s * 3.9], 0.25, WINDOW));
  }
  return p;
}

/** Garden Dome (5×5 cells, 20 m): a 10 m glass dome — its crown GLASS on
 *  silver TRIM ribs, its lower band LEAF (the park's canopy seen through the
 *  glass) — on a BODY ring wall of three stepped terraces, each with a lit
 *  WINDOW band (the ten beds); a porch at +z and park lamps at the corners. */
function gardenDome(): Parts {
  const R = 8.3, Y = 3.4;
  const q = (t: number): [number, number] => [R * Math.sin(t), Y + R * Math.cos(t)];
  const p: Parts = [
    // the terraced ring wall, bottom to top: three storeys stepping in
    lathe([[9.8, 0], [9.75, 1.15], [9.1, 1.2], [9.05, 2.3], [8.45, 2.35], [8.4, 3.4], [7.9, 3.4]], BODY, 36),
    cyl(9.78, 9.78, 0.64, WINDOW, 0, 0.62, 0, 0, 0, 36, true),
    cyl(9.08, 9.08, 0.6, WINDOW, 0, 1.76, 0, 0, 0, 36, true),
    cyl(8.43, 8.43, 0.56, WINDOW, 0, 2.86, 0, 0, 0, 36, true),
    ...[0, 1, 2].map((k) => lathe([[9.82 - k * 0.68, 1.16 + k * 1.12], [9.1 - k * 0.66, 1.21 + k * 1.12]], BAND, 36)),
    // the dome: canopy band below, glass crown above
    lathe([q(PI / 2), q(1.28), q(1.02)], LEAF, 32),
    lathe([q(1.02), q(0.74), q(0.46), q(0.2), [0.001, Y + R]], GLASS, 32),
    lathe([q(1.035), q(0.995)].map(([r, y]) => [r + 0.05, y] as [number, number]), TRIM, 32),
    lathe([q(0.62), q(0.58)].map(([r, y]) => [r + 0.05, y] as [number, number]), TRIM, 32),
    cyl(0.55, 0.6, 0.3, TRIM, 0, Y + R - 0.02, 0, 0, 0, 10),
    dome(0.2, BEACON, 0, Y + R + 0.12, 0, 8),
    // the porch at +z, its door and a PLATE apron
    box(2.8, 2.6, 1.6, BODY, 0, 1.3, 9.0),
    box(2.9, 0.14, 1.7, TRIM, 0, 2.67, 9.0),
    door(0, 9.8, 0, 1.4, 2.0),
  ];
  // meridian ribs: eight, each four chords held just proud of the dome
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * PI * 2 + PI / 8;
    const c = Math.cos(a), s = Math.sin(a);
    const pts = [PI / 2, 1.15, 0.8, 0.45, 0.1].map((t) => { const [r, y] = q(t); return [c * (r + 0.2), y + 0.2 * Math.cos(t), s * (r + 0.2)] as const; });
    for (let i = 0; i < 4; i++) p.push(bar(pts[i], pts[i + 1], 0.16, TRIM));
  }
  // park lamps on the pad's corners, outside the ring
  for (const [x, z] of [[8.2, 8.2], [-8.2, 8.2], [8.2, -8.2], [-8.2, -8.2]]) {
    p.push(
      cyl(0.08, 0.1, 3.2, TRIM, x, 1.6, z, 0, 0, 6),
      box(0.5, 0.14, 0.5, TRIM, x, 0.07, z),
      box(0.36, 0.2, 0.36, LAMP, x, 3.25, z),
    );
  }
  return p;
}

/** Drone Hive (3×3 cells, 12 m): a honeycomb of hex-cell docks, 3 rows × 4,
 *  each mouth dark with a LAMP over it; a PLATE landing deck in front with
 *  four marked pads (the parked drones perch there, world/rovers.ts), a
 *  BEACON, and a RADIATOR on the back. The Classic hull is dark. Uncrewed:
 *  no door but the dock's, on the road at its front. */
function droneHive(): Parts {
  const p: Parts = [
    box(11.0, 0.3, 11.0, TRIM, 0, 0.15, 0),
    box(8.4, 0.5, 4.2, BODY, 0, 0.55, -2.8),
    // the landing deck on four legs, its pads and corner lamps
    box(8.4, 0.22, 5.2, PLATE, 0, 1.45, 2.6),
    ...[[-3.9, 0.3], [3.9, 0.3], [-3.9, 4.9], [3.9, 4.9]].map(([x, z]) => bar([x, 0.3, z], [x, 1.35, z], 0.2, TRIM)),
    ...HIVE_PADS.map(([x, z]) => box(1.7, 0.05, 1.7, TRIM, x, 1.58, z)),
    ...HIVE_PADS.map(([x, z]) => box(0.9, 0.03, 0.9, PLATE, x, 1.62, z)),
    ...[[-4.05, 0.15], [4.05, 0.15], [-4.05, 5.05], [4.05, 5.05]].map(([x, z]) => box(0.24, 0.12, 0.24, LAMP, x, 1.62, z)),
    dome(0.18, BEACON, 0, 1.6, 5.0, 8),
    ...radiator(3.4, 1.4, 0, 1.2, -5.2, PI),
    antenna(-3.2, 5.0, -3.9, 1.6),
    // the identifier: a landing-guidance mast at the back corner, violet rings, a strobe (9 m)
    cyl(0.1, 0.17, 8.0, TRIM, 4.9, 4.3, -4.9, 0, 0, 8),
    ring(0.17, 2.6, 4.9, -4.9, 0.34, 8), ring(0.14, 5.0, 4.9, -4.9, 0.34, 8), ring(0.12, 7.4, 4.9, -4.9, 0.34, 8),
    box(0.6, 0.16, 0.6, PLATE, 4.9, 8.4, -4.9),
    dome(0.2, BEACON, 4.9, 8.6, -4.9, 8),
  ];
  // the honeycomb: hex prisms along z, staggered rows
  for (let row = 0; row < 3; row++) {
    const n = row % 2 ? 4 : 5;
    for (let col = 0; col < n; col++) {
      const x = (col - (n - 1) / 2) * 1.6, y = 1.55 + row * 1.35;
      p.push(
        cyl(0.86, 0.86, 3.9, BODY, x, y, -2.75, PI / 2, 0, 6),
        cyl(0.62, 0.62, 0.06, GLASS, x, y, -0.78, PI / 2, 0, 6),
        cyl(0.88, 0.88, 0.16, PLATE, x, y, -0.83, PI / 2, 0, 6, true),
        box(0.34, 0.08, 0.06, LAMP, x, y + 0.5, -0.74),
      );
    }
  }
  return p;
}
/** where the Drone Hive's parked drones perch on its deck (data/roads.ts: the sim parks them there too) */
export { HIVE_PADS, HIVE_DECK_Y };

/** Server Monolith (2×2 cells, 8 m): a 16 m windowless slab of black glass
 *  (near black in both styles; Classic's override), a vertical cold LAMP
 *  stripe and thin teal status slits down its face, a RADIATOR fin stack at
 *  the rear, a BEACON on top. */
function serverMonolith(): Parts {
  const p: Parts = [
    box(4.2, 0.5, 6.8, TRIM, 0, 0.25, 0),
    box(3.0, 14.6, 5.2, GLASS, 0, 7.8, -0.2), // black glass: dark in both styles
    box(3.1, 0.3, 5.3, BAND, 0, 15.25, -0.2),
    box(3.06, 0.12, 5.26, BAND, 0, 5.0, -0.2),
    box(3.06, 0.12, 5.26, BAND, 0, 10.0, -0.2),
    box(0.2, 12.6, 0.06, LAMP, 0, 7.8, 2.42),
    ...[-0.9, -0.55, 0.55, 0.9].map((x) => box(0.07, 9.6, 0.05, WINDOW, x, 8.6, 2.42)),
    ...[-1.52, 1.52].map((x) => box(0.05, 9.6, 0.07, WINDOW, x, 8.6, 1.4)),
    door(0, 2.4, 0, 0.9, 1.9, 0.5),
    dome(0.2, BEACON, 0, 15.4, -0.2, 8),
    antenna(0.9, 15.4, -1.4, 0.5),
  ];
  for (let i = 0; i < 8; i++) p.push(box(2.6, 0.08, 0.9, RADIATOR, 0, 2.2 + i * 1.6, -3.2));
  p.push(bar([1.2, 0.5, -3.3], [1.2, 13.6, -3.3], 0.1, TRIM), bar([-1.2, 0.5, -3.3], [-1.2, 13.6, -3.3], 0.1, TRIM));
  return p;
}

const R: Record<BuildingId, () => Parts> = {
  lander, solar, excavator, habitat, smelter, iceHarvester, hydroponics, battery,
  refinery, lab, storageYard, roboticsBay, partsFab, reactor, recDome, chipFab,
  dataCenter, foilFactory, massDriver, relayMast, propellantPlant, solarObservatory, prospectingBay,
  waterPlant, iceMiner,
  greenhouseRing, gardenDome, droneHive, serverMonolith,
};

/** Moving parts of the stock recipes: pivot in building space, scale (dish
 *  radius, m). Upgrades edit them per key (mountsFor). */
export const MOUNTS: Partial<Record<BuildingId, Mount[]>> = {
  solar: [{ part: 'wing', p: [0, 2.45, 0], s: 1 }],
  lander: [{ part: 'dish', p: [0.6, 12.55, -0.4], s: 0.8 }],
  lab: [{ part: 'dish', p: [1.4, 7.75, 1.4], s: 1.3 }],
  relayMast: [{ part: 'dish', p: [0.62, 9.8, 0], s: 0.9 }],
  dataCenter: [{ part: 'dish', p: [-3.4, 4.55, 3.4], s: 1.0 }],
};

/** The moving parts of a type under an upgrade key. */
const mountCache = new Map<string, Mount[]>();
export function mountsFor(id: BuildingId, key = ''): Mount[] {
  const k = `${id}|${key}`;
  let m = mountCache.get(k);
  if (!m) {
    m = MOUNTS[id] ?? [];
    for (const u of upgradesIn(id, key)) if (u.mounts) m = u.mounts(m);
    mountCache.set(k, m);
  }
  return m;
}

/** A type's recipe with the upgrade parts its key names ('' = stock). */
const cache = new Map<string, BufferGeometry>();
export function recipeGeometry(id: BuildingId, key = ''): BufferGeometry {
  const k = `${id}|${key}`;
  let g = cache.get(k);
  if (!g) {
    const parts: Parts = R[id]();
    for (const u of upgradesIn(id, key)) if (u.parts) parts.push(...flatten(u.parts()));
    g = merge(parts);
    g.userData.recipe = id; // the classic palette's per-structure overrides
    cache.set(k, g);
  }
  return g;
}

/** What a hub's digger is drawn with (world/haulers.ts, one mesh per unit key):
 *  the smelter's, the refinery's and the ice miner's own models, each with the
 *  upgrade parts of its lane (the excavator's, or the ice miner's) and tagged
 *  with its unit key, so the cel palette gives it its livery. The legacy pad's
 *  excavator and a water plant's excavator wear the plain excavator recipe. */
const UNIT_R: Partial<Record<UnitKey, () => Parts>> = {
  'excavator:smelter': smelterDigger,
  'excavator:refinery': refineryDigger,
  'iceMiner:waterPlant': iceMiner,
};
const unitCache = new Map<string, BufferGeometry>();
/** the diggers' overall width, m (the chassis is modelled 3.8 m over its tracks) */
const UNIT_WIDTH_M = 3.0;
export function unitRecipeGeometry(mk: UnitKey, key = ''): BufferGeometry {
  const lane: BuildingId = mk.startsWith('iceMiner') ? 'iceMiner' : 'excavator';
  const build = UNIT_R[mk];
  if (!build) return recipeGeometry(lane, key);
  const k = `${mk}|${key}`;
  let g = unitCache.get(k);
  if (!g) {
    const parts: Parts = build();
    for (const u of upgradesIn(lane, key)) if (u.parts) parts.push(...flatten(u.parts()));
    g = merge(parts);
    g.userData.recipe = mk;
    // 3.0 m wide, tracks included (world/haulers.ts UNIT_BODY hw 1.5: two units in their lanes clear each other)
    g.scale(1, 1, UNIT_WIDTH_M / 3.8);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    unitCache.set(k, g);
  }
  return g;
}

const partCache = new Map<PartId, BufferGeometry>();
export function partGeometry(id: PartId): BufferGeometry {
  let g = partCache.get(id);
  if (!g) {
    g = merge(id === 'wing' ? solarWing() : id === 'wingXL' ? solarWing(5) : dishPart());
    g.userData.part = id;
    partCache.set(id, g);
  }
  return g;
}

/** Recipe plus its moving parts in a rest pose — the placement ghost. */
const ghostCache = new Map<string, BufferGeometry>();
export function ghostGeometry(id: BuildingId, key = ''): BufferGeometry {
  const mounts = mountsFor(id, key);
  if (!mounts.length && !rigTriangles(id, key)) return recipeGeometry(id, key);
  const k = `${id}|${key}`;
  let g = ghostCache.get(k);
  if (!g) {
    const parts = [recipeGeometry(id, key).clone(), ...rigParts(id, key)];
    for (const m of mounts) {
      const q = m.part === 'dish'
        ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), PI / 4)
        : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5);
      parts.push(partGeometry(m.part).clone().applyMatrix4(new THREE.Matrix4().compose(
        new THREE.Vector3(...m.p), q, new THREE.Vector3(m.s, m.s, m.s))));
    }
    g = merge(parts);
    ghostCache.set(k, g);
  }
  return g;
}

const tris = (g: BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
const withMounts = (id: BuildingId, key: string) =>
  tris(recipeGeometry(id, key)) + mountsFor(id, key).reduce((n, m) => n + tris(partGeometry(m.part)), 0) + rigTriangles(id, key);

/** Triangles per recipe, stock (probes; the art budget in docs/06). */
export function recipeTriangles(key: Partial<Record<BuildingId, string>> = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of Object.keys(R) as BuildingId[]) out[id] = withMounts(id, key[id] ?? '');
  return out;
}

/** The heaviest set of a type's upgrades one run can hold at once: every
 *  lane upgrade, but one side of each era's destiny pick (the landing is
 *  Era 1's) and one capstone (docs/14 §4.1). */
function fullKey(id: BuildingId, techs: readonly TechId[], one: (t: TechId) => number): string {
  const groups = new Map<string, TechId>();
  for (const t of techs) {
    const d = TECHS[t];
    const g = d.track ? `era${d.track.era}` : d.band ? 'capstone' : t;
    const cur = groups.get(g);
    if (!cur || one(t) > one(cur)) groups.set(g, t);
  }
  const keep = new Set(groups.values());
  return techs.filter((t) => keep.has(t)).join(',');
}

export interface UpgradeBudget {
  /** stock and fully upgraded triangles, moving parts included (fully: the
   *  heaviest set one run can hold — one side of each destiny pick, one capstone) */
  base: number;
  full: number;
  /** what each upgrade adds to the recipe mesh on its own */
  parts: Record<string, number>;
  /** what each upgrade adds as moving parts (an extra dish, a wider wing) */
  movers: Record<string, number>;
}
/** The upgrade budget (docs/12 §6). */
export function upgradeTriangles(): Record<string, UpgradeBudget> {
  const out: Record<string, UpgradeBudget> = {};
  for (const id of Object.keys(R) as BuildingId[]) {
    const base = withMounts(id, '');
    const mesh0 = tris(recipeGeometry(id, ''));
    const techs = upgradeTechs(id);
    const parts: Record<string, number> = {};
    const movers: Record<string, number> = {};
    for (const t of techs) {
      parts[t] = tris(recipeGeometry(id, t)) - mesh0;
      movers[t] = withMounts(id, t) - base - parts[t];
    }
    out[id] = { base, full: withMounts(id, fullKey(id, techs, (t) => parts[t] + movers[t])), parts, movers };
  }
  return out;
}
