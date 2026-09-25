/** 21 building silhouettes from the primitive kit, plus the research
 *  upgrades each one grows (upgrades.ts, keyed by upgradeKey). Silhouette-first: in a
 *  monochrome world, shape is identity — dome = life, tank = industry,
 *  rail = export. Detail is load-bearing only: a door frame says "people go
 *  in here", a radiator says "this runs hot", a dish says "we talk to Earth".
 *  Base of every recipe sits at y=0, centered on its footprint, door side +z.
 *
 *  Parts that move (sun-tracking solar wings, dishes aimed at Earth) are not
 *  in the recipe: MOUNTS places them, and buildings/trackers.ts instances
 *  them separately. */
import * as THREE from 'three';
import type { BufferGeometry } from 'three';
import type { BuildingId } from '../data/buildings';
import { TECHS, type TechId } from '../data/techs';
import {
  BEACON, BODY, FOIL, GLASS, LAMP, LEAF, PLATE, RADIATOR, TRIM, WINDOW,
  antenna, archWall, bands, bar, berm, box, cableTray, circle, cyl, dome, domeBand, door, junction,
  ladder, lathe, lattice, merge, pane, pipe, radiator, rail, vault, windowRing, windowStrip,
} from './meshKit';
import { flatten, upgradeTechs, upgradesIn, type Mount, type PartId } from './upgrades';

export type { Mount, PartId } from './upgrades';
type Parts = (BufferGeometry | BufferGeometry[])[];
const PI = Math.PI;

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
    bands(r(6.1), 0, 0, [6.1], TRIM, 0.16, 28),
    bands(r(8.5), 0, 0, [8.5], TRIM, 0.16, 28),
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
    bar([0.4, 1.7, 0.7], [2.7, 1.5, 0.7], 0.45, BODY),
    bar([0.4, 2.0, 0.7], [2.6, 1.9, 0.7], 0.12, TRIM),
    bar([0.2, 1.6, 0.7], [0.2, 3.6, 0.7], 0.2, TRIM),
    bar([0.2, 3.6, 0.7], [2.5, 1.9, 0.7], 0.06, TRIM),
    cyl(1.1, 1.1, 0.35, TRIM, 2.9, 1.45, 0.7, PI / 2, 0, 20, true),
    cyl(0.25, 0.25, 0.5, PLATE, 2.9, 1.45, 0.7, PI / 2, 0, 10),
    radiator(1.2, 0.9, -1.84, 1.6, 0.7, -PI / 2),
    rail([[-1.75, 0.2], [-1.75, 1.25], [0.2, 1.25]], 1.6),
    antenna(-1.4, 2.9, -0.9, 1.4),
  ];
  for (const side of [-1, 1]) {
    p.push(box(3.8, 0.7, 0.7, TRIM, 0, 0.4, side * 1.55));
    for (const x of [-1.4, -0.47, 0.47, 1.4]) p.push(cyl(0.34, 0.34, 0.74, PLATE, x, 0.36, side * 1.55, PI / 2, 0, 12));
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * PI * 2;
    p.push(box(0.42, 0.42, 0.55, PLATE, 2.9 + Math.cos(a) * 1.15, 1.45 + Math.sin(a) * 1.15, 0.7, 0, a));
    if (k % 2 === 0) p.push(bar([2.9, 1.45, 0.7], [2.9 + Math.cos(a) * 1.05, 1.45 + Math.sin(a) * 1.05, 0.7], 0.08, TRIM));
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
    box(0.8, 0.4, 0.8, TRIM, 0, 6.35, 0),
    dome(0.14, BEACON, 0, 6.6, 0, 8),
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
    windowStrip(2.0, 3, 0.45, 0, 2.2, 2.81, 0),
    door(-1.31, 2.0, -PI / 2, 0.9, 1.6, 1.0),
    cyl(0.12, 0.16, 5.5, TRIM, 3.2, 3.75, -2.2, 0, 0, 8),
    dome(0.14, BEACON, 3.2, 6.55, -2.2, 8),
    cableTray([3.5, 1.8], [5.6, 1.8]),
    junction(5.8, 1.8, PI / 2),
  ];
  for (const [x, r, h] of cols) {
    p.push(
      cyl(r, r, h, BODY, x, 1 + h / 2, -0.4, 0, 0, 20),
      dome(r, TRIM, x, 1 + h, -0.4, 16),
      bands(r, x, -0.4, [2.2, 3.4, 4.6].filter((y) => y < 1 + h - 0.3), TRIM, 0.14, 20),
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
    windowStrip(4.0, 5, 0.7, 0, 1.9, 2.72, 0),
    windowStrip(4.0, 5, 0.7, 2.72, 1.9, 0, PI / 2),
    door(-2.72, 0.6, -PI / 2, 1.1, 2.0),
    cyl(0.3, 0.4, 1.3, TRIM, 1.4, 3.95, 1.4, 0, 0, 12),
    box(0.5, 0.3, 0.3, PLATE, 1.4, 4.7, 1.4),
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
    // a second rover on charge at the side door
    box(1.4, 0.45, 0.9, BODY, -3.7, 0.72, 0.6, PI / 2),
    box(0.8, 0.04, 1.1, GLASS, -3.7, 0.97, 0.6),
    bar([-3.7, 0.95, 1.2], [-3.7, 1.5, 1.2], 0.05, TRIM),
    box(0.25, 0.15, 0.2, PLATE, -3.7, 1.57, 1.2),
    door(-3.32, 0.6, -PI / 2, 1.2, 1.9),
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
    cyl(0.9, 0.9, 2.4, TRIM, 5.0, 1.2, -1.9, 0, 0, 14),
    pipe([3.4, 1.8, -1.2], [4.2, 1.8, -1.6], 0.16, PLATE),
    box(1.8, 1.6, 1.4, BODY, -1.0, 0.8, 5.2),
    pane(0.8, 0.4, -1.3, 1.1, 5.9, 0),
    door(-1.0, 4.48, PI, 0.8, 1.3),
    cableTray([0.2, 5.3], [0.2, 5.9]),
    junction(0.8, 5.8, 0),
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
    cyl(0.35, 0.45, 2.6, TRIM, 2.6, 4.3, -1.8, 0, 0, 12),
    bands(0.4, 2.6, -1.8, [3.8, 4.8]),
    dome(0.14, BEACON, 2.6, 5.65, -1.8, 8),
    cyl(0.35, 0.45, 2.2, TRIM, 3.8, 4.1, -1.8, 0, 0, 12),
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
    cyl(0.5, 0.5, 3.2, TRIM, -3.6, 6.4, -3.0, 0, 0, 14),
    bands(0.5, -3.6, -3.0, [5.6, 6.8]),
    dome(0.14, BEACON, -3.6, 8.05, -3.0, 8),
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
    windowStrip(3.4, 4, 0.45, -9, 2.2, 2.62, 0),
    door(-11.32, 0, -PI / 2, 1.2, 2.0),
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
    cyl(1.5, 1.5, 0.4, TRIM, 10.5, railY(10.5) + 0.2, 0, 0, tilt - PI / 2, 20, true),
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
    ...[0, 1, 2].map((k) => lathe([[9.82 - k * 0.68, 1.16 + k * 1.12], [9.1 - k * 0.66, 1.21 + k * 1.12]], TRIM, 36)),
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
/** where the Drone Hive's parked drones perch on its deck (building frame, the deck top at y 1.62) */
export const HIVE_PADS: readonly (readonly [number, number])[] = [[-2.1, 1.3], [2.1, 1.3], [-2.1, 3.9], [2.1, 3.9]];
export const HIVE_DECK_Y = 1.64;

/** Server Monolith (2×2 cells, 8 m): a 16 m windowless slab (Classic near
 *  black), a vertical cold LAMP stripe and thin teal status slits down its
 *  face, a RADIATOR fin stack at the rear, a BEACON on top. */
function serverMonolith(): Parts {
  const p: Parts = [
    box(4.2, 0.5, 6.8, TRIM, 0, 0.25, 0),
    box(3.0, 14.6, 5.2, BODY, 0, 7.8, -0.2),
    box(3.1, 0.3, 5.3, TRIM, 0, 15.25, -0.2),
    box(3.06, 0.12, 5.26, PLATE, 0, 5.0, -0.2),
    box(3.06, 0.12, 5.26, PLATE, 0, 10.0, -0.2),
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
  dataCenter, foilFactory, massDriver, relayMast, propellantPlant,
  greenhouseRing, gardenDome, droneHive, serverMonolith,
};

/** Moving parts of the stock recipes: pivot in building space, scale (dish
 *  radius, m). Upgrades edit them per key (mountsFor). */
export const MOUNTS: Partial<Record<BuildingId, Mount[]>> = {
  solar: [{ part: 'wing', p: [0, 2.45, 0], s: 1 }],
  lander: [{ part: 'dish', p: [0.6, 12.55, -0.4], s: 0.8 }],
  lab: [{ part: 'dish', p: [1.4, 4.85, 1.4], s: 1.3 }],
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
  if (!mounts.length) return recipeGeometry(id, key);
  const k = `${id}|${key}`;
  let g = ghostCache.get(k);
  if (!g) {
    const parts = [recipeGeometry(id, key).clone()];
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
  tris(recipeGeometry(id, key)) + mountsFor(id, key).reduce((n, m) => n + tris(partGeometry(m.part)), 0);

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
