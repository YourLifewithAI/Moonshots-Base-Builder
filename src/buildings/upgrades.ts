/** Research you can see (docs/12 §6): every tech that touches a building adds
 *  a part to that building type's recipe — a second dish, a cupola, radiator
 *  fins, a tank, a mast. Parts sit in the building's own frame (base at
 *  y = 0, door side +z, as in recipes.ts) and use only the shared finishes,
 *  so both render styles colour them unchanged. A type's upgrade key is the
 *  list of its upgrade techs that are done (upgradeKey); recipes.ts merges
 *  base + parts per key, and `mounts` edits the moving parts (trackers.ts).
 *  Each part stays within a few hundred triangles. */
import type { BufferGeometry } from 'three';
import type { BuildingId } from '../data/buildings';
import type { TechId } from '../data/techs';
import { DESTINY_UPGRADES } from './destinyParts';
import {
  BEACON, BODY, FOIL, GLASS, LAMP, PLATE, RADIATOR, TRIM, WINDOW,
  antenna, archWall, bands, bar, box, cyl, dome, domeBand, lathe, lattice, pane, pipe, radiator, vault,
  type Finish,
} from './meshKit';

/** parts nest freely (helpers return lists); recipes.ts flattens them */
export type Deep = BufferGeometry | Deep[];
type Parts = Deep[];
export const flatten = (xs: readonly Deep[]): BufferGeometry[] => xs.flatMap((x) => (Array.isArray(x) ? flatten(x) : [x]));
export type PartId = 'wing' | 'wingXL' | 'dish';
/** a moving part: pivot in building space, scale (dish radius, m) */
export interface Mount { part: PartId; p: [number, number, number]; s: number }

export interface Upgrade {
  tech: TechId;
  parts?: () => Parts;
  /** edits the moving parts: add a dish, raise a pivot, swap a wing */
  mounts?: (m: Mount[]) => Mount[];
}

const PI = Math.PI;

/** A full sphere (tanks), as a lathe of a half circle. */
function sphere(r: number, f: Finish, x: number, y: number, z: number, seg = 14): BufferGeometry {
  const pts: [number, number][] = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const a = -PI / 2 + (PI * i) / n;
    pts.push([Math.max(1e-3, Math.cos(a) * r), Math.sin(a) * r]);
  }
  return lathe(pts, f, seg).translate(x, y, z);
}

/** A stand-off radiator panel whose legs start at y0 (roof or ground). */
function roofRadiator(w: number, h: number, x: number, y0: number, lift: number, z: number, ry = 0): Parts {
  const y = y0 + lift;
  const tx = Math.cos(ry), tz = -Math.sin(ry);
  const out: Parts = [box(w, h, 0.08, RADIATOR, x, y + h / 2, z, ry)];
  const ribs = Math.max(2, Math.round(w / 0.5));
  for (let i = 0; i <= ribs; i++) {
    const o = -w / 2 + (w * i) / ribs;
    out.push(box(0.05, h, 0.14, TRIM, x + tx * o, y + h / 2, z + tz * o, ry));
  }
  for (const o of [-w / 2 + 0.2, w / 2 - 0.2]) {
    out.push(bar([x + tx * o, y0, z + tz * o], [x + tx * o, y, z + tz * o], 0.1, TRIM));
  }
  return out;
}

/** A sensor mast: a pole, a small instrument head and a status lamp. */
function sensorMast(x: number, y0: number, z: number, h = 1.6): Parts {
  return [
    cyl(0.05, 0.07, h, TRIM, x, y0 + h / 2, z, 0, 0, 6),
    box(0.34, 0.22, 0.26, BODY, x, y0 + h + 0.11, z),
    box(0.18, 0.08, 0.04, LAMP, x, y0 + h + 0.14, z + 0.14),
    cyl(0.07, 0.07, 0.24, GLASS, x + 0.2, y0 + h + 0.1, z, 0, PI / 2, 8),
  ];
}

/** A lamp mast for inspection lighting. */
function lampMast(x: number, z: number, h = 4.4, ry = 0): Parts {
  const s = Math.sin(ry), c = Math.cos(ry);
  return [
    cyl(0.07, 0.1, h, TRIM, x, h / 2, z, 0, 0, 8),
    cyl(0.3, 0.34, 0.12, TRIM, x, 0.06, z, 0, 0, 8),
    bar([x, h - 0.1, z], [x + s * 0.8, h - 0.1, z + c * 0.8], 0.07, TRIM),
    box(0.44, 0.14, 0.3, LAMP, x + s * 0.85, h - 0.22, z + c * 0.85, ry),
  ];
}

/** A rack of upright gas bottles in a frame. */
function bottleRack(x: number, y0: number, z: number, n = 4, ry = 0): Parts {
  const tx = Math.cos(ry), tz = -Math.sin(ry);
  const w = n * 0.4;
  const out: Parts = [
    box(w + 0.2, 0.1, 0.5, TRIM, x, y0 + 0.05, z, ry),
    bar([x - tx * (w / 2 + 0.05), y0 + 0.1, z - tz * (w / 2 + 0.05)], [x - tx * (w / 2 + 0.05), y0 + 1.3, z - tz * (w / 2 + 0.05)], 0.06, TRIM),
    bar([x + tx * (w / 2 + 0.05), y0 + 0.1, z + tz * (w / 2 + 0.05)], [x + tx * (w / 2 + 0.05), y0 + 1.3, z + tz * (w / 2 + 0.05)], 0.06, TRIM),
    bar([x - tx * (w / 2 + 0.05), y0 + 1.0, z - tz * (w / 2 + 0.05)], [x + tx * (w / 2 + 0.05), y0 + 1.0, z + tz * (w / 2 + 0.05)], 0.05, TRIM),
  ];
  for (let i = 0; i < n; i++) {
    const o = -w / 2 + 0.2 + i * 0.4;
    out.push(cyl(0.15, 0.15, 1.1, PLATE, x + tx * o, y0 + 0.65, z + tz * o, 0, 0, 8));
    out.push(dome(0.15, PLATE, x + tx * o, y0 + 1.2, z + tz * o, 8));
  }
  return out;
}

/** Survey stakes: reflector posts at the pad corners (Launch-Site Survey). */
function surveyStakes(pts: readonly (readonly [number, number])[]): Parts {
  return pts.map(([x, z]) => [
    box(0.1, 1.1, 0.1, TRIM, x, 0.55, z),
    box(0.22, 0.22, 0.06, LAMP, x, 1.2, z),
    box(0.4, 0.06, 0.4, PLATE, x, 0.03, z),
  ]);
}

/** A small tracking-beacon mast (swarm tracking). */
function beaconMast(x: number, y0: number, z: number, h = 4.2): Parts {
  return [
    cyl(0.08, 0.12, h, TRIM, x, y0 + h / 2, z, 0, 0, 8),
    cyl(0.3, 0.3, 0.1, TRIM, x, y0 + 0.05, z, 0, 0, 8),
    cyl(0.22, 0.22, 0.16, LAMP, x, y0 + h * 0.7, z, 0, 0, 10),
    dome(0.18, BEACON, x, y0 + h, z, 8),
    bar([x, y0 + h * 0.8, z], [x + 0.9, y0 + 0.02, z + 0.5], 0.03, TRIM),
    bar([x, y0 + h * 0.8, z], [x - 0.9, y0 + 0.02, z + 0.5], 0.03, TRIM),
    bar([x, y0 + h * 0.8, z], [x, y0 + 0.02, z - 1.0], 0.03, TRIM),
  ];
}

/** A pylon carrying a tracked dish (the dish itself is a mount). */
function dishPylon(x: number, z: number, h: number): Parts {
  return [
    cyl(0.5, 0.6, 0.2, TRIM, x, 0.1, z, 0, 0, 12),
    cyl(0.16, 0.24, h, TRIM, x, h / 2, z, 0, 0, 10),
    box(0.5, 0.4, 0.5, PLATE, x, h - 0.1, z),
  ];
}

// ─────────────────────────── per building ───────────────────────────

const lander: Upgrade[] = [
  { // a second, larger Earth dish on its own pylon (−x)
    tech: 'teleoperation',
    parts: () => [dishPylon(-4.9, 0, 3.0), box(0.9, 0.9, 0.7, BODY, -4.9, 0.45, 0.9), box(0.2, 0.1, 0.05, LAMP, -4.9, 0.7, 1.26)],
    mounts: (m) => [...m, { part: 'dish', p: [-4.9, 3.15, 0], s: 1.1 }],
  },
  { // rover charging dock and a parked rover (+x, −z)
    tech: 'prospectingRovers',
    parts: () => [
      box(2.4, 0.14, 1.7, PLATE, 4.3, 0.07, -2.7),
      box(0.3, 1.3, 0.3, TRIM, 5.3, 0.65, -3.3),
      box(0.22, 0.12, 0.05, LAMP, 5.3, 1.1, -3.13),
      box(1.2, 0.42, 0.8, BODY, 4.1, 0.55, -2.6),
      box(0.8, 0.04, 0.6, GLASS, 4.1, 0.78, -2.6),
      [-0.4, 0.4].flatMap((dx) => [-0.42, 0.42].map((dz) => cyl(0.18, 0.18, 0.14, PLATE, 4.1 + dx, 0.2, -2.6 + dz, PI / 2, 0, 8))),
      bar([4.6, 0.8, -2.6], [4.6, 1.3, -2.6], 0.04, TRIM),
    ],
  },
  { // sample-cache carousel beside the ladder (+z, −x)
    tech: 'sampleCaches',
    parts: () => [
      cyl(0.72, 0.8, 0.3, TRIM, -2.3, 0.15, 4.6, 0, 0, 14),
      cyl(0.5, 0.5, 1.0, BODY, -2.3, 0.8, 4.6, 0, 0, 14),
      dome(0.5, FOIL, -2.3, 1.3, 4.6, 12),
      bands(0.5, -2.3, 4.6, [0.55, 1.05], TRIM, 0.08, 14),
      [0, 1, 2, 3, 4, 5].map((k) => {
        const a = (k / 6) * PI * 2;
        return box(0.18, 0.5, 0.14, PLATE, -2.3 + Math.cos(a) * 0.56, 0.8, 4.6 + Math.sin(a) * 0.56, -a);
      }),
      box(0.16, 0.08, 0.04, LAMP, -2.3, 1.1, 5.12),
    ],
  },
  { // a tracking dish for the polar orbiter on a short lattice (−z)
    tech: 'orbitalProspector',
    parts: () => [cyl(0.55, 0.6, 0.2, TRIM, 0, 0.1, -5.0, 0, 0, 12), lattice(2.4, 0.42, 0.2, 0, -5.0, 0.2, 3, 1.2), box(0.5, 0.3, 0.5, PLATE, 0, 2.7, -5.0)],
    mounts: (m) => [...m, { part: 'dish', p: [0, 2.95, -5.0], s: 0.8 }],
  },
  { // gravimeter mast (corner +x −z)
    tech: 'gravimetry',
    parts: () => [
      cyl(0.4, 0.45, 0.2, TRIM, 5.2, 0.1, -5.2, 0, 0, 10),
      cyl(0.06, 0.08, 3.4, TRIM, 5.2, 1.9, -5.2, 0, 0, 8),
      cyl(0.26, 0.26, 0.6, FOIL, 5.2, 3.8, -5.2, 0, 0, 12),
      dome(0.26, BODY, 5.2, 4.1, -5.2, 10),
      box(0.5, 0.5, 0.4, BODY, 5.2, 0.45, -4.7),
      box(0.2, 0.08, 0.04, LAMP, 5.2, 0.6, -4.48),
    ],
  },
  { // far-side relay link: a tall lattice mast with a horn (corner −x −z)
    tech: 'farSideRelay',
    parts: () => [
      box(1.3, 0.3, 1.3, TRIM, -5.1, 0.15, -5.1),
      lattice(8.6, 0.5, 0.18, -5.1, -5.1, 0.3, 3, 1.45),
      cyl(0.55, 0.12, 1.1, BODY, -5.1, 9.3, -4.7, PI / 2 - 0.5, 0, 12, true),
      box(0.4, 0.4, 0.4, PLATE, -5.1, 9.1, -5.1),
      dome(0.14, BEACON, -5.1, 9.35, -5.1, 8),
    ],
  },
  { // seismometer pods set out round the Lander
    tech: 'deepSounding',
    parts: () => [[5.6, 2.8], [-5.6, 2.4], [2.8, -5.6], [-0.4, 5.6]].flatMap(([x, z]) => [
      cyl(0.36, 0.4, 0.12, TRIM, x, 0.06, z, 0, 0, 10),
      dome(0.32, PLATE, x, 0.12, z, 10),
      box(0.12, 0.06, 0.12, LAMP, x, 0.45, z),
    ]),
  },
  { // laser-ranging telescope dome (corner +x +z)
    tech: 'laserRanging',
    parts: () => [
      box(1.3, 0.7, 1.3, TRIM, 4.7, 0.35, 4.8),
      cyl(0.62, 0.62, 0.4, BODY, 4.7, 0.9, 4.8, 0, 0, 14),
      dome(0.62, BODY, 4.7, 1.1, 4.8, 14),
      box(0.24, 0.5, 0.64, GLASS, 4.95, 1.35, 4.8, 0, -0.5),
    ],
  },
  { tech: 'safetyProtocols', parts: () => [lampMast(-5.3, 5.2, 4.6, PI * 0.75)] },
  { // rectenna mesh on two legs, tilted toward the sky (−x)
    tech: 'powerBeaming',
    parts: () => {
      const out: Parts = [];
      const x0 = -5.2, z0 = -1.6, z1 = -3.8, yb = 0.5, yt = 2.4;
      out.push(box(0.08, 2.4, 2.4, GLASS, x0 - 0.1, (yb + yt) / 2, (z0 + z1) / 2, 0, -0.5));
      for (let i = 0; i <= 4; i++) {
        const z = z0 + ((z1 - z0) * i) / 4;
        out.push(bar([x0 + 0.35, yb, z], [x0 - 0.55, yt, z], 0.04, TRIM));
      }
      out.push(bar([x0, 0, z0], [x0, 1.1, z0], 0.1, TRIM), bar([x0, 0, z1], [x0, 1.1, z1], 0.1, TRIM));
      return out;
    },
  },
  { // Build Orders: a planning mast beside the pad — a pole, the work-list board, a lamp
    tech: 'buildOrders',
    parts: () => [
      cyl(0.3, 0.36, 0.14, TRIM, 4.9, 0.07, -2.6, 0, 0, 8),
      cyl(0.06, 0.08, 4.0, TRIM, 4.9, 2.1, -2.6, 0, 0, 6),
      box(1.0, 0.7, 0.06, PLATE, 4.9, 3.1, -2.52),
      box(0.8, 0.08, 0.02, WINDOW, 4.9, 3.25, -2.48),
      box(0.8, 0.08, 0.02, WINDOW, 4.9, 3.0, -2.48),
      box(0.3, 0.16, 0.2, LAMP, 4.9, 4.15, -2.5),
    ],
  },
];

const solar: Upgrade[] = [
  { // white reflector apron under the wing, on four feet
    tech: 'bifacialCells',
    parts: () => [
      box(6.4, 0.05, 6.4, RADIATOR, 0, 0.14, 0),
      [[-3, -3], [3, -3], [3, 3], [-3, 3]].map(([x, z]) => box(0.14, 0.12, 0.14, TRIM, x, 0.06, z)),
      box(6.44, 0.07, 0.07, TRIM, 0, 0.18, 3.2), box(6.44, 0.07, 0.07, TRIM, 0, 0.18, -3.2),
    ],
  },
  { // finned inverter cabinet on the pedestal
    tech: 'mpptInverters',
    parts: () => {
      const out: Parts = [box(0.62, 0.82, 0.34, BODY, 0, 1.25, 0.36), box(0.16, 0.06, 0.03, LAMP, 0.12, 1.55, 0.54)];
      for (let i = 0; i < 5; i++) out.push(box(0.03, 0.72, 0.18, TRIM, -0.24 + i * 0.12, 1.25, 0.1));
      return out;
    },
  },
  { // sintered-regolith heat wadi with an absorber lid (mare)
    tech: 'thermalWadis',
    parts: () => [
      box(1.7, 0.6, 1.3, TRIM, -2.5, 0.3, 2.5),
      box(1.5, 0.04, 1.1, GLASS, -2.5, 0.62, 2.5),
      pipe([-1.7, 0.4, 2.1], [-0.2, 0.4, 0.3], 0.05, PLATE),
    ],
  },
  { // a 10 m lattice mast; the wing rides on top (south pole)
    tech: 'peakLightMasts',
    parts: () => [lattice(7.9, 0.46, 0.26, 0, 0, 2.3, 3, 1.6), cyl(0.3, 0.3, 0.3, PLATE, 0, 10.2, 0, 0, 0, 12)],
    mounts: (m) => m.map((x) => (x.part === 'wing' || x.part === 'wingXL' ? { ...x, p: [x.p[0], 10.35, x.p[2]] } : x)),
  },
  { // a heliostat mirror on a post, clear of the wing's sweep (lava tube)
    tech: 'skylightHeliostats',
    parts: () => [
      cyl(0.08, 0.1, 1.3, TRIM, -3.3, 0.65, -3.3, 0, 0, 8),
      box(1.3, 0.05, 0.9, FOIL, -3.3, 1.45, -3.3, PI / 4, 0, 0.7),
      bar([-3.3, 1.3, -3.3], [-3.0, 1.55, -3.0], 0.05, TRIM),
    ],
  },
  { // an electrostatic dust fence round the pad
    tech: 'dustMitigation',
    parts: () => {
      const out: Parts = [];
      const c = 3.6;
      const corners: [number, number][] = [[-c, -c], [c, -c], [c, c], [-c, c]];
      for (let i = 0; i < 4; i++) {
        const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
        for (let k = 0; k < 3; k++) {
          const t = k / 3;
          out.push(box(0.05, 0.62, 0.05, TRIM, ax + (bx - ax) * t, 0.31, az + (bz - az) * t));
        }
        out.push(bar([ax, 0.6, az], [bx, 0.6, bz], 0.03, PLATE), bar([ax, 0.35, az], [bx, 0.35, bz], 0.03, PLATE));
      }
      return out;
    },
  },
  { // a fifth row of cells on every wing
    tech: 'wingExtensions',
    mounts: (m) => m.map((x) => (x.part === 'wing' ? { ...x, part: 'wingXL' as const } : x)),
  },
  { // Automated Power: a combiner box with a status lamp at the mast's foot
    tech: 'autoPower',
    parts: () => [
      box(0.7, 0.8, 0.36, BODY, -1.0, 0.4, 1.0),
      box(0.74, 0.06, 0.4, TRIM, -1.0, 0.83, 1.0),
      box(0.16, 0.08, 0.03, LAMP, -1.0, 0.62, 1.2),
      bar([-1.0, 0.8, 1.0], [-0.12, 1.1, 0.12], 0.05, TRIM),
    ],
  },
];

const excavator: Upgrade[] = [
  { // slotted grizzly screen over the back deck
    tech: 'grizzlyScreens',
    parts: () => {
      const out: Parts = [bar([0.25, 1.62, -1.25], [0.25, 2.1, -1.25], 0.06, TRIM), bar([1.55, 1.62, -1.25], [1.55, 2.3, -1.25], 0.06, TRIM),
        bar([0.25, 1.62, 0.05], [0.25, 2.1, 0.05], 0.06, TRIM), bar([1.55, 1.62, 0.05], [1.55, 2.3, 0.05], 0.06, TRIM)];
      for (let i = 0; i < 6; i++) {
        const z = -1.15 + i * 0.22;
        out.push(bar([0.2, 2.1, z], [1.6, 2.3, z], 0.05, PLATE));
      }
      out.push(bar([0.2, 2.12, -1.25], [0.2, 2.12, 0.05], 0.06, TRIM), bar([1.6, 2.32, -1.25], [1.6, 2.32, 0.05], 0.06, TRIM));
      return out;
    },
  },
  { // heated volatiles retort and its cold-trap tank (mare, lava tube)
    tech: 'regolithVolatiles',
    parts: () => [
      cyl(0.34, 0.34, 1.2, FOIL, -1.0, 1.95, 0.85, 0, PI / 2, 12),
      cyl(0.36, 0.36, 0.08, TRIM, -1.5, 1.95, 0.85, 0, PI / 2, 12),
      cyl(0.36, 0.36, 0.08, TRIM, -0.5, 1.95, 0.85, 0, PI / 2, 12),
      cyl(0.22, 0.22, 0.6, BODY, 0.05, 1.9, 1.15, 0, 0, 10),
      dome(0.22, BODY, 0.05, 2.2, 1.15, 8),
      pipe([-0.4, 2.0, 0.85], [0.05, 2.1, 1.15], 0.05, PLATE),
    ],
  },
  { // magnetic separator drum and chute off the back (mare, lava tube)
    tech: 'ilmeniteBeneficiation',
    parts: () => [
      cyl(0.42, 0.42, 1.1, PLATE, -2.35, 1.05, -0.75, PI / 2, 0, 14),
      box(0.5, 0.9, 1.2, TRIM, -2.05, 1.0, -0.75),
      box(0.3, 0.12, 0.9, PLATE, -2.5, 0.45, -0.75, 0, -0.5),
      box(0.14, 0.06, 0.04, LAMP, -2.35, 1.55, -0.18),
    ],
  },
  { // dust skirts over the tracks
    tech: 'dustMitigation',
    parts: () => [box(3.9, 0.4, 0.06, FOIL, 0, 0.72, 1.93), box(3.9, 0.4, 0.06, FOIL, 0, 0.72, -1.93),
      box(3.94, 0.06, 0.12, TRIM, 0, 0.94, 1.93), box(3.94, 0.06, 0.12, TRIM, 0, 0.94, -1.93)],
  },
  { // optical ore-sorting hood beside the wheel
    tech: 'oreSorting',
    parts: () => [
      box(0.9, 0.55, 0.5, BODY, 1.9, 2.05, 1.35),
      box(0.7, 0.06, 0.36, GLASS, 1.9, 1.76, 1.35),
      box(0.5, 0.06, 0.04, LAMP, 1.9, 2.2, 1.61),
      bar([1.5, 1.6, 1.35], [1.5, 1.8, 1.35], 0.06, TRIM), bar([2.3, 1.55, 1.35], [2.3, 1.8, 1.35], 0.06, TRIM),
    ],
  },
  { tech: 'conditionOptimization', parts: () => [sensorMast(1.7, 1.6, -1.2, 1.3)] },
  { // wider bucket lips round the wheel and a haul-road lidar bar on the cab
    tech: 'autonomousHaulage',
    parts: () => {
      const out: Parts = [
        box(0.1, 0.14, 1.5, TRIM, -0.22, 2.78, -0.4),
        bar([-0.22, 2.4, -1.1], [-0.22, 2.72, -1.1], 0.05, TRIM), bar([-0.22, 2.4, 0.3], [-0.22, 2.72, 0.3], 0.05, TRIM),
      ];
      for (const z of [-0.95, -0.4, 0.15]) out.push(cyl(0.08, 0.08, 0.12, GLASS, -0.15, 2.78, z, 0, PI / 2, 8));
      out.push(box(0.12, 0.05, 0.03, LAMP, -0.15, 2.9, -0.4));
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * PI * 2 + PI / 8;
        out.push(box(0.26, 0.12, 0.72, PLATE, 2.9 + Math.cos(a) * 1.36, 1.45 + Math.sin(a) * 1.36, 0.7, 0, a));
      }
      return out;
    },
  },
  { // Feed Planner: an assay drill on the rear frame
    tech: 'feedPlanner',
    parts: () => [
      box(0.5, 0.12, 0.5, TRIM, -2.1, 1.35, -0.8),
      bar([-2.1, 0.1, -0.8], [-2.1, 2.5, -0.8], 0.08, PLATE),
      box(0.3, 0.36, 0.3, BODY, -2.1, 1.9, -0.8),
      box(0.12, 0.05, 0.03, LAMP, -2.1, 2.0, -0.64),
      cyl(0.1, 0.03, 0.3, TRIM, -2.1, 0.12, -0.8, 0, 0, 6),
    ],
  },
];

const habitat: Upgrade[] = [
  { // a bunk annex against the airlock
    tech: 'bunkRacks',
    parts: () => [
      box(1.3, 1.35, 1.3, BODY, 1.55, 0.68, 2.85),
      box(1.4, 0.12, 1.4, TRIM, 1.55, 1.41, 2.85),
      pane(0.6, 0.32, 1.55, 0.95, 3.5, 0),
      pane(0.5, 0.32, 2.2, 0.95, 2.85, PI / 2),
    ],
  },
  { // CO₂ scrubber stack and water-recovery tanks (−z)
    tech: 'closedLoopLS',
    parts: () => [
      cyl(0.3, 0.34, 2.3, TRIM, -1.4, 1.15, -3.4, 0, 0, 12),
      bands(0.32, -1.4, -3.4, [0.6, 1.4, 2.0]),
      cyl(0.36, 0.36, 1.3, BODY, 0.5, 0.45, -3.55, 0, PI / 2, 12),
      cyl(0.36, 0.36, 1.3, BODY, 0.5, 1.15, -3.55, 0, PI / 2, 12),
      pipe([-1.1, 1.6, -3.4], [-0.15, 1.15, -3.55], 0.06, PLATE),
    ],
  },
  { // sandbagged regolith collar over the dome (overburden)
    tech: 'btLavaTubeCaverns',
    parts: () => [domeBand(3.3, 0.3, 0.58, TRIM, 0, 1.4, 0, 24), domeBand(3.36, 0.34, 0.5, TRIM, 0, 1.4, 0, 12)],
  },
  { tech: 'safetyProtocols', parts: () => [lampMast(-3.1, 3.2, 4.2, PI * 0.75)] },
  { // Automated Life Support: an air-monitor mast by the door
    tech: 'autoLifeSupport',
    parts: () => [cyl(0.2, 0.24, 0.1, TRIM, 1.3, 0.05, 4.0, 0, 0, 8), ...sensorMast(1.3, 0.1, 4.0, 2.0)],
  },
];

const smelter: Upgrade[] = [
  { // foil heat-recovery jackets round both stacks
    tech: 'heatRecoveryJackets',
    parts: () => [
      cyl(0.94, 1.07, 3.8, FOIL, -2.1, 6.8, -1.2, 0, 0, 18, true),
      cyl(0.82, 0.95, 3.0, FOIL, -0.4, 6.3, -1.2, 0, 0, 18, true),
      pipe([-1.3, 5.2, -1.2], [-1.3, 4.5, 0.6], 0.14, PLATE),
      box(1.0, 0.6, 0.8, TRIM, -1.3, 4.8, 0.9),
    ],
  },
  { // an electrolysis cell with heavy busbars on the roof
    tech: 'moltenElectrolysis',
    parts: () => [
      box(1.6, 1.2, 1.8, BODY, 2.3, 5.1, -1.1),
      box(1.7, 0.14, 1.9, TRIM, 2.3, 5.75, -1.1),
      [-0.5, 0, 0.5].map((dz) => bar([3.05, 5.3, -1.1 + dz], [3.55, 4.4, -1.1 + dz], 0.16, PLATE)),
      [-0.5, 0, 0.5].map((dz) => box(0.22, 0.3, 0.22, TRIM, 2.9, 5.95, -1.1 + dz)),
      box(0.3, 0.1, 0.04, LAMP, 2.3, 5.3, -0.19),
    ],
  },
  { // a hopper for volcanic glass beads, chuting into the feed box
    tech: 'btVolcanicGlass',
    parts: () => [
      cyl(0.85, 0.22, 1.2, BODY, 5.0, 2.9, -2.6, 0, 0, 14),
      cyl(0.88, 0.88, 0.14, TRIM, 5.0, 3.55, -2.6, 0, 0, 14),
      [0, 1, 2].map((k) => {
        const a = (k / 3) * PI * 2;
        return bar([5.0 + Math.cos(a) * 0.7, 0, -2.6 + Math.sin(a) * 0.7], [5.0 + Math.cos(a) * 0.55, 2.8, -2.6 + Math.sin(a) * 0.55], 0.1, TRIM);
      }),
      bar([5.0, 2.25, -2.6], [4.5, 2.9, -0.8], 0.16, PLATE),
    ],
  },
  { // slag conveyor out to a cooling bed (+x, front)
    tech: 'slagRecycling',
    parts: () => [
      bar([3.5, 1.3, 2.2], [5.3, 0.45, 3.1], 0.3, TRIM),
      bar([4.4, 0, 2.65], [4.4, 0.85, 2.65], 0.08, TRIM),
      box(1.9, 0.24, 1.3, TRIM, 5.1, 0.12, 3.3),
      [[4.6, 3.0], [5.2, 3.5], [5.6, 3.0], [4.9, 3.6]].map(([x, z]) => box(0.34, 0.22, 0.3, PLATE, x, 0.34, z, x)),
    ],
  },
  { // silver MLI blanket on the west wall (mare, lava tube)
    tech: 'mliBlankets',
    parts: () => [box(0.05, 3.0, 4.8, FOIL, -3.53, 2.25, 0), [-1.6, 0, 1.6].map((z) => box(0.07, 3.0, 0.05, TRIM, -3.55, 2.25, z))],
  },
  { // a second tier of radiator wings over the ground radiators
    tech: 'deployableRadiators',
    parts: () => [roofRadiator(2.6, 1.6, -1.8, 0, 2.85, -3.5, PI), roofRadiator(2.6, 1.6, 1.6, 0, 2.85, -3.5, PI)],
  },
  { // cold-box liquefier and a spherical LOX tank on the roof
    tech: 'oxygenLiquefaction',
    parts: () => [
      sphere(0.72, BODY, 2.4, 5.3, 1.45),
      cyl(0.5, 0.6, 0.35, TRIM, 2.4, 4.68, 1.45, 0, 0, 12),
      box(0.9, 1.1, 0.8, BODY, 0.9, 5.05, 1.7),
      box(0.4, 0.08, 0.04, LAMP, 0.9, 5.3, 2.11),
      pipe([1.35, 5.2, 1.6], [1.7, 5.3, 1.5], 0.07, PLATE),
    ],
  },
  { // refractory courses banded round both stacks
    tech: 'refractoryLinings',
    parts: () => [bands(1.03, -2.1, -1.2, [5.1, 6.7, 8.3], TRIM, 0.24, 18), bands(0.9, -0.4, -1.2, [5.3, 7.0], TRIM, 0.24, 18)],
  },
  { tech: 'conditionOptimization', parts: () => [sensorMast(-3.0, 4.5, 2.1, 1.8)] },
];

const iceHarvester: Upgrade[] = [
  { // a foil sublimation tent over the dig beside the deck (+x; south pole)
    tech: 'sublimationTents',
    parts: () => [
      vault(1.05, 2.3, FOIL, 3.0, 0, -1.0, 0, PI, 14),
      archWall(1.05, 0.12, TRIM, 3.0, 0, 0.15, 14),
      archWall(1.05, 0.12, TRIM, 3.0, 0, -2.15, 14),
      pipe([2.3, 1.1, -1.0], [2.0, 1.3, -0.6], 0.08, PLATE),
    ],
  },
  { // a second, heated auger slanting in between the tanks (south pole)
    tech: 'heatedAugers',
    parts: () => [
      bar([1.9, 4.5, 0], [1.05, 0.05, 0], 0.26, PLATE),
      [0.25, 0.45, 0.65].map((t) => cyl(0.22, 0.22, 0.18, FOIL, 1.9 - 0.85 * t, 4.5 - 4.45 * t, 0, 0, 0.19, 10)),
      box(0.62, 0.55, 0.62, BODY, 1.95, 4.75, 0),
      box(0.18, 0.08, 0.04, LAMP, 1.95, 4.85, 0.32),
    ],
  },
  { tech: 'conditionOptimization', parts: () => [sensorMast(-1.7, 1.4, -1.6, 1.4)] },
];

const hydroponics: Upgrade[] = [
  { // LED grow-light strips along the vault crown
    tech: 'growLights',
    parts: () => [-1.3, -0.45, 0.45, 1.3].map((x) => box(0.12, 0.05, 8.6, LAMP, x, 0.5 + Math.sqrt(2.62 ** 2 - x * x) + 0.03, 0, 0, -Math.asin(x / 2.62))),
  },
  { // nutrient recirculation tanks on the west side
    tech: 'nutrientRecirculation',
    parts: () => [
      [-2.2, 0, 2.2].map((z) => cyl(0.4, 0.4, 1.3, BODY, -3.35, 0.65, z, 0, 0, 12)),
      [-2.2, 0, 2.2].map((z) => bands(0.4, -3.35, z, [0.35, 1.0])),
      pipe([-3.35, 1.45, -3.0], [-3.35, 1.45, 3.0], 0.08, PLATE),
    ],
  },
  { // a galley bay with a picture window at the door end
    tech: 'galleyGarden',
    parts: () => [
      box(2.0, 1.7, 1.5, BODY, 2.1, 1.35, 5.25),
      box(2.1, 0.12, 1.6, TRIM, 2.1, 2.26, 5.25),
      pane(1.4, 0.8, 2.1, 1.45, 6.0, 0),
    ],
  },
  { tech: 'btColdTrapChemistry', parts: () => [bottleRack(-2.3, 0.5, 5.3, 4)] },
];

const battery: Upgrade[] = [
  { // a second tier of cells
    tech: 'stackedCells',
    parts: () => [-2.2, 0, 2.2].flatMap((x) => [
      box(1.8, 0.1, 2.2, TRIM, x, 3.1, 0),
      box(1.7, 1.15, 2.0, BODY, x, 3.73, 0),
      box(0.3, 0.1, 0.05, WINDOW, x, 4.05, 1.01),
      [0, 1, 2, 3].map((k) => box(1.5, 0.28, 0.05, RADIATOR, x, 4.45, -0.6 + k * 0.4)),
    ]),
  },
  { // paired hydrogen and oxygen tanks at the ends
    tech: 'regenFuelCells',
    parts: () => [[3.62, -0.45], [-3.62, -0.5]].flatMap(([x, z]) => [
      cyl(0.34, 0.34, 2.2, FOIL, x, 1.1, z, 0, 0, 12),
      dome(0.34, BODY, x, 2.2, z, 10),
      bands(0.34, x, z, [0.4, 1.2, 1.9]),
    ]),
  },
  { // a third, high-pressure tank on saddles behind the cells
    tech: 'pressureTanks',
    parts: () => [
      cyl(0.32, 0.32, 5.4, BODY, 0, 0.62, -1.72, 0, PI / 2, 14),
      dome(0.32, BODY, 2.7, 0.62, -1.72, 10),
      [-1.8, 0, 1.8].map((x) => box(0.2, 0.4, 0.5, TRIM, x, 0.2, -1.72)),
    ],
  },
  { // sealed vault doors over the cabinets
    tech: 'solidStateCells',
    parts: () => [-2.2, 0, 2.2].flatMap((x) => [
      box(1.72, 2.0, 0.08, PLATE, x, 1.55, 1.18),
      cyl(0.18, 0.18, 0.06, TRIM, x, 1.55, 1.24, PI / 2, 0, 10),
      box(0.08, 1.9, 0.1, TRIM, x - 0.82, 1.55, 1.2),
    ]),
  },
];

const refinery: Upgrade[] = [
  { // a fourth distillation column (front right)
    tech: 'refluxColumns',
    parts: () => [
      cyl(0.62, 0.62, 3.8, BODY, 2.5, 2.9, 2.2, 0, 0, 16),
      dome(0.62, TRIM, 2.5, 4.8, 2.2, 12),
      bands(0.62, 2.5, 2.2, [1.8, 3.0, 4.2], TRIM, 0.12, 16),
      pipe([2.5, 4.5, 1.6], [2.4, 5.0, -0.2], 0.1, PLATE),
    ],
  },
  { // silver MLI wrap on the tall column (mare, lava tube)
    tech: 'mliBlankets',
    parts: () => [cyl(1.56, 1.56, 2.4, FOIL, 0.6, 3.1, -0.4, 0, 0, 20, true)],
  },
  { // radiator wings behind the columns
    tech: 'deployableRadiators',
    parts: () => [roofRadiator(2.4, 1.6, -1.6, 0, 1.0, -3.3, PI), roofRadiator(2.4, 1.6, 1.8, 0, 1.0, -3.3, PI)],
  },
  { // refractory courses on every column
    tech: 'refractoryLinings',
    parts: () => [
      bands(1.56, -2.0, -0.4, [2.8, 4.0], TRIM, 0.22, 20),
      bands(1.56, 0.6, -0.4, [2.4, 4.9], TRIM, 0.22, 20),
      bands(1.16, 2.8, -0.4, [2.9], TRIM, 0.22, 20),
    ],
  },
  { tech: 'conditionOptimization', parts: () => [sensorMast(-0.9, 4.65, -0.4, 1.4)] },
  { // Automated Smelting & Refining: an ore-sampler arm over the feed
    tech: 'autoSmelting',
    parts: () => [
      cyl(0.16, 0.2, 2.2, TRIM, -3.0, 2.1, 2.2, 0, 0, 8),
      bar([-3.0, 3.1, 2.2], [-1.9, 2.9, 1.5], 0.12, TRIM),
      bar([-1.9, 2.9, 1.5], [-1.9, 2.3, 1.5], 0.08, TRIM),
      box(0.34, 0.3, 0.34, PLATE, -1.9, 2.15, 1.5),
      box(0.16, 0.06, 0.03, LAMP, -3.0, 2.9, 2.38),
    ],
  },
];

const lab: Upgrade[] = [
  { // spectrometer turret on the roof
    tech: 'fieldSpectrometers',
    parts: () => [
      box(0.7, 0.36, 0.7, TRIM, 0.2, 3.48, -0.4),
      cyl(0.3, 0.3, 0.5, BODY, 0.2, 3.91, -0.4, 0, 0, 12),
      cyl(0.13, 0.13, 0.36, GLASS, 0.5, 4.0, -0.4, 0, PI / 2, 10),
    ],
  },
  { // a robot sample bench behind a new window bay (crewed runs)
    tech: 'benchRobots',
    parts: () => [box(2.0, 1.4, 0.64, BODY, -1.2, 1.45, -3.02), box(2.1, 0.1, 0.72, TRIM, -1.2, 2.2, -3.02),
      pane(1.5, 0.6, -1.2, 1.55, -3.36, PI)],
  },
  { // cryogenic sample dewar on the roof
    tech: 'cryoSampleStore',
    parts: () => [
      cyl(0.4, 0.4, 1.0, FOIL, -2.0, 3.8, -0.2, 0, 0, 14),
      dome(0.4, BODY, -2.0, 4.3, -0.2, 12),
      bands(0.4, -2.0, -0.2, [3.5, 4.1]),
      pipe([-1.6, 3.9, -0.2], [-1.1, 3.55, -0.6], 0.05, PLATE),
    ],
  },
  { // silver MLI blanket on the back wall (mare, lava tube)
    tech: 'mliBlankets',
    parts: () => [box(2.2, 2.2, 0.05, FOIL, 1.3, 1.5, -2.74), box(0.05, 2.2, 0.08, TRIM, 0.2, 1.5, -2.76)],
  },
  { // a glazed observation cupola
    tech: 'scienceCrews',
    parts: () => [
      cyl(0.78, 0.82, 0.3, TRIM, -0.6, 3.45, 1.1, 0, 0, 16),
      dome(0.74, BODY, -0.6, 3.6, 1.1, 16),
      domeBand(0.76, 0.35, 1.15, WINDOW, -0.6, 3.6, 1.1, 8),
    ],
  },
  { // a second uplink dish on its own pedestal
    tech: 'uplinkDishes',
    parts: () => [cyl(0.24, 0.3, 1.0, TRIM, 2.0, 3.8, -1.1, 0, 0, 10), box(0.4, 0.26, 0.3, PLATE, 2.0, 4.35, -1.1)],
    mounts: (m) => [...m, { part: 'dish', p: [2.0, 4.5, -1.1], s: 0.85 }],
  },
];

const roboticsBay: Upgrade[] = [
  { // a rooftop rack of swarm charging cradles
    tech: 'swarmRobotics',
    parts: () => {
      const out: Parts = [box(4.2, 0.12, 1.8, PLATE, 0, 3.16, 1.2)];
      for (let i = 0; i < 6; i++) {
        const x = -1.75 + i * 0.7;
        out.push(box(0.5, 0.22, 0.44, BODY, x, 3.36, 1.2), box(0.1, 0.05, 0.03, LAMP, x, 3.4, 1.43));
      }
      return out;
    },
  },
  { // a heavy gantry crane over the roof
    tech: 'heavyConstructors',
    parts: () => [
      bar([-3.0, 3.1, 1.9], [-3.0, 6.0, 1.9], 0.22, TRIM), bar([3.0, 3.1, 1.9], [3.0, 6.0, 1.9], 0.22, TRIM),
      bar([-3.1, 6.0, 1.9], [3.1, 6.0, 1.9], 0.3, TRIM),
      box(0.7, 0.5, 0.6, PLATE, 0.6, 5.65, 1.9),
      bar([0.6, 5.4, 1.9], [0.6, 4.3, 1.9], 0.04, TRIM),
      box(0.3, 0.2, 0.3, PLATE, 0.6, 4.2, 1.9),
    ],
  },
  { // a replicator assembly arm on the roof
    tech: 'selfReplication',
    parts: () => [
      cyl(0.32, 0.38, 0.3, PLATE, 2.6, 3.25, -0.2, 0, 0, 10),
      bar([2.6, 3.35, -0.2], [2.1, 4.6, 0.3], 0.14, TRIM),
      bar([2.1, 4.6, 0.3], [1.3, 3.9, 0.5], 0.1, TRIM),
      box(0.26, 0.26, 0.26, PLATE, 1.25, 3.75, 0.5),
    ],
  },
  { // a navigation mast: a radar dome and the lidar heads the rovers plan by
    tech: 'roverAutonomy',
    parts: () => {
      const out: Parts = [
        cyl(0.07, 0.1, 1.9, TRIM, 3.0, 4.05, -1.7, 0, 0, 8),
        cyl(0.28, 0.32, 0.14, TRIM, 3.0, 3.17, -1.7, 0, 0, 10),
        dome(0.3, BODY, 3.0, 5.0, -1.7, 10),
        cyl(0.3, 0.3, 0.06, TRIM, 3.0, 5.0, -1.7, 0, 0, 10),
        box(0.14, 0.05, 0.03, LAMP, 3.0, 4.7, -1.53),
      ];
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * PI * 2;
        out.push(cyl(0.07, 0.07, 0.1, GLASS, 3.0 + Math.cos(a) * 0.2, 4.55, -1.7 + Math.sin(a) * 0.2, 0, 0, 8));
      }
      return out;
    },
  },
  { // a diagnostics mast with a beacon
    tech: 'predictiveMaintenance',
    parts: () => [antenna(3.0, 3.1, 2.5, 3.0, 0.06), box(0.4, 0.3, 0.3, BODY, 3.0, 3.3, 2.1), box(0.16, 0.06, 0.03, LAMP, 3.0, 3.38, 2.26)],
  },
  { // Automated Excavation: a dispatch mast — a lattice tower with a beacon
    tech: 'autoExcavation',
    parts: () => [
      lattice(2.4, 0.26, 0.14, -1.0, -0.2, 3.1, 3, 1.2),
      cyl(0.2, 0.2, 0.08, TRIM, -1.0, 5.54, -0.2, 0, 0, 8),
      dome(0.16, BEACON, -1.0, 5.58, -0.2, 8),
    ],
  },
  { // Site Survey AI: a survey drone on its roof pad
    tech: 'siteSurveyAI',
    parts: () => {
      const out: Parts = [
        box(1.1, 0.06, 1.1, PLATE, 0.55, 3.13, -0.75),
        box(0.36, 0.14, 0.36, BODY, 0.55, 3.28, -0.75),
        box(0.12, 0.04, 0.03, LAMP, 0.55, 3.3, -0.56),
      ];
      for (const [dx, dz] of [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]]) {
        out.push(bar([0.55, 3.3, -0.75], [0.55 + dx, 3.32, -0.75 + dz], 0.04, TRIM));
        out.push(cyl(0.16, 0.16, 0.02, TRIM, 0.55 + dx, 3.36, -0.75 + dz, 0, 0, 8));
      }
      return out;
    },
  },
  { // Maintenance Automation: a service crane arm over the charging rover
    tech: 'maintenanceAutomation',
    parts: () => [
      cyl(0.22, 0.28, 0.2, TRIM, -3.95, 0.1, -0.9, 0, 0, 8),
      cyl(0.09, 0.11, 2.9, TRIM, -3.95, 1.55, -0.9, 0, 0, 8),
      bar([-3.95, 2.9, -0.9], [-3.75, 2.75, 0.9], 0.1, TRIM),
      bar([-3.75, 2.72, 0.9], [-3.75, 1.9, 0.9], 0.03, TRIM),
      box(0.26, 0.2, 0.26, PLATE, -3.75, 1.8, 0.9),
      box(0.14, 0.06, 0.03, LAMP, -3.95, 2.7, -0.76),
    ],
  },
];

const partsFab: Upgrade[] = [
  { // a tool-changer carousel on the west wall
    tech: 'toolChangers',
    parts: () => {
      const out: Parts = [cyl(0.55, 0.55, 0.4, PLATE, -3.55, 1.7, 2.3, 0, PI / 2, 14), box(0.3, 0.3, 0.3, TRIM, -3.4, 1.7, 2.3)];
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * PI * 2;
        out.push(box(0.16, 0.22, 0.14, TRIM, -3.8, 1.7 + Math.cos(a) * 0.5, 2.3 + Math.sin(a) * 0.5));
      }
      return out;
    },
  },
  { // a replicator assembly arm at the loading door
    tech: 'selfReplication',
    parts: () => [
      cyl(0.34, 0.4, 0.3, PLATE, 2.3, 0.15, 3.7, 0, 0, 10),
      bar([2.3, 0.3, 3.7], [1.9, 1.9, 3.5], 0.16, TRIM),
      bar([1.9, 1.9, 3.5], [1.2, 1.2, 3.6], 0.12, TRIM),
      box(0.28, 0.28, 0.28, PLATE, 1.1, 1.05, 3.6),
    ],
  },
  { // Automated Fabrication: a gantry crane across the roof
    tech: 'autoFabrication',
    parts: () => [
      bar([-3.75, 0, -1.0], [-3.75, 5.0, -1.0], 0.2, TRIM),
      bar([3.75, 0, -1.0], [3.75, 5.0, -1.0], 0.2, TRIM),
      bar([-3.85, 5.0, -1.0], [3.85, 5.0, -1.0], 0.26, TRIM),
      box(0.6, 0.4, 0.6, PLATE, 0.8, 4.75, -1.0),
      bar([0.8, 4.55, -1.0], [0.8, 4.4, -1.0], 0.04, TRIM),
      box(0.16, 0.06, 0.03, LAMP, 0.8, 4.8, -0.68),
    ],
  },
];

const reactor: Upgrade[] = [
  { // a Brayton turbine skid (+x)
    tech: 'braytonConverters',
    parts: () => [
      box(2.2, 0.3, 1.5, TRIM, 4.9, 0.15, 1.5),
      cyl(0.48, 0.34, 1.6, BODY, 4.6, 0.85, 1.5, 0, PI / 2, 14),
      box(0.9, 0.9, 1.0, BODY, 5.6, 0.75, 1.5),
      pipe([3.7, 1.5, 1.5], [3.9, 0.85, 1.5], 0.16, PLATE),
      box(0.2, 0.08, 0.04, LAMP, 5.6, 1.0, 2.01),
    ],
  },
  { // a fuel-handling jib crane over the dome (−x)
    tech: 'highBurnupFuel',
    parts: () => [
      cyl(0.18, 0.26, 10.4, TRIM, -5.1, 5.2, 0, 0, 0, 10),
      cyl(0.5, 0.6, 0.3, TRIM, -5.1, 0.15, 0, 0, 0, 10),
      bar([-5.3, 10.2, 0], [-0.6, 10.2, 0], 0.22, TRIM),
      bar([-5.1, 9.2, 0], [-3.3, 10.2, 0], 0.1, TRIM),
      box(0.5, 0.4, 0.5, PLATE, -1.2, 9.9, 0),
      bar([-1.2, 9.7, 0], [-1.2, 9.2, 0], 0.03, TRIM),
      dome(0.14, BEACON, -0.6, 10.35, 0, 8),
    ],
  },
];

const recDome: Upgrade[] = [
  { // a low-g court annex under a glass vault (+x)
    tech: 'lowGCourt',
    parts: () => [
      vault(1.1, 3.6, WINDOW, 4.9, 0.1, 0, 0, PI, 14),
      box(2.3, 0.1, 3.7, TRIM, 4.9, 0.05, 0),
      [-1.2, 0, 1.2].map((z) => vault(1.14, 0.12, TRIM, 4.9, 0.1, z, 0, PI, 14)),
    ],
  },
];

const chipFab: Upgrade[] = [
  { // sandbag overburden on the cleanroom roof
    tech: 'btLavaTubeCaverns',
    parts: () => [box(3.8, 0.34, 3.4, TRIM, -2.2, 4.77, 0), box(3.2, 0.24, 2.8, TRIM, -2.3, 5.05, 0.1), box(1.0, 0.2, 1.0, TRIM, -3.2, 5.25, -0.9)],
  },
  { // a shielded ion-implanter annex
    tech: 'radHardProcess',
    parts: () => [
      box(2.0, 1.7, 1.6, BODY, 2.4, 3.85, 0.2),
      [3.3, 3.9, 4.5].map((y) => box(2.06, 0.12, 1.66, PLATE, 2.4, y, 0.2)),
      box(0.3, 0.1, 0.04, LAMP, 2.4, 4.3, 1.02),
    ],
  },
  { // a sealed wafer-transfer tunnel and a handling arm
    tech: 'cleanroomRobotics',
    parts: () => [
      box(2.6, 0.7, 0.7, BODY, 0.95, 3.35, -1.1),
      pane(1.2, 0.3, 0.95, 3.4, -0.74, 0),
      cyl(0.28, 0.32, 0.26, PLATE, 0.6, 3.13, 1.1, 0, 0, 10),
      bar([0.6, 3.25, 1.1], [0.2, 4.2, 0.8], 0.1, TRIM),
      bar([0.2, 4.2, 0.8], [-0.3, 3.7, 0.6], 0.08, TRIM),
    ],
  },
  { // a boost radiator for overclocking
    tech: 'dynamicClocking',
    parts: () => [roofRadiator(1.8, 1.1, 3.8, 3.0, 0.3, 2.0, 0)],
  },
  { // a glass-roofed wafer-polishing annex
    tech: 'waferPolishing',
    parts: () => [box(1.2, 0.9, 1.2, BODY, 4.0, 3.45, -0.4), box(1.3, 0.06, 1.3, WINDOW, 4.0, 3.93, -0.4), box(1.34, 0.08, 1.34, TRIM, 4.0, 3.97, -0.4)],
  },
  { // a second tier of radiator wings over the roof radiator
    tech: 'deployableRadiators',
    parts: () => [roofRadiator(2.4, 1.0, 1.4, 3.0, 1.35, 1.8, 0)],
  },
  { // an immersion-lithography tower on the cleanroom
    tech: 'immersionLitho',
    parts: () => [
      cyl(0.45, 0.45, 2.2, BODY, -3.2, 5.7, -1.05, 0, 0, 14),
      dome(0.45, TRIM, -3.2, 6.8, -1.05, 12),
      bands(0.45, -3.2, -1.05, [5.2, 6.2]),
      box(0.2, 0.08, 0.04, LAMP, -3.2, 6.0, -0.58),
    ],
  },
  { // superconducting bus ducts along the front
    tech: 'superconductingBus',
    parts: () => [pipe([-4.5, 3.3, 3.0], [4.5, 3.3, 3.0], 0.12, FOIL), pipe([-4.5, 3.55, 3.0], [4.5, 3.55, 3.0], 0.12, FOIL),
      [-3.6, -1.2, 1.2, 3.6].map((x) => box(0.12, 0.6, 0.3, TRIM, x, 3.3, 3.0))],
  },
];

const dataCenter: Upgrade[] = [
  { // a sandbag parapet round the roof
    tech: 'btLavaTubeCaverns',
    parts: () => [box(8.6, 0.4, 0.5, TRIM, 0, 3.9, -4.1), box(0.5, 0.4, 8.6, TRIM, -4.1, 3.9, 0), box(0.5, 0.4, 8.6, TRIM, 4.1, 3.9, 0),
      box(3.6, 0.4, 0.5, TRIM, 2.1, 3.9, 4.1)],
  },
  { // accelerator heat-exchanger towers at the back corners
    tech: 'acceleratorDesign',
    parts: () => [3.5, -3.5].flatMap((x) => [
      cyl(0.45, 0.52, 2.4, BODY, x, 4.9, -3.6, 0, 0, 14),
      dome(0.45, TRIM, x, 6.1, -3.6, 12),
      bands(0.48, x, -3.6, [4.3, 5.3]),
    ]),
  },
  { // a boost radiator along the front of the roof
    tech: 'dynamicClocking',
    parts: () => [roofRadiator(4.0, 1.4, 0.2, 3.7, 0.2, 3.85, 0)],
  },
  { // a second tier of cryo radiator fins on every row
    tech: 'cryoRadiators',
    parts: () => [-2.6, -0.9, 0.9, 2.6].flatMap((z) => [
      box(7.6, 1.5, 0.12, RADIATOR, 0, 7.1, z),
      box(7.7, 0.08, 0.22, TRIM, 0, 7.88, z),
      [-3.8, 0, 3.8].map((x) => box(0.08, 1.5, 0.2, TRIM, x, 7.1, z)),
    ]),
  },
  { // superconducting bus ducts across the roof
    tech: 'superconductingBus',
    parts: () => [pipe([-2.2, 3.95, 3.3], [3.0, 3.95, 3.3], 0.13, FOIL), pipe([-2.2, 4.25, 3.3], [3.0, 4.25, 3.3], 0.13, FOIL),
      [-1.6, 0.6, 2.6].map((x) => box(0.12, 0.6, 0.3, TRIM, x, 3.95, 3.3))],
  },
  { // coolant manifolds down to a pump skid by the door
    tech: 'liquidCooling',
    parts: () => [
      box(1.8, 0.3, 1.3, TRIM, -0.7, 0.15, 5.1),
      cyl(0.32, 0.32, 0.7, BODY, -1.1, 0.65, 5.1, 0, PI / 2, 12),
      cyl(0.32, 0.32, 0.7, BODY, -0.3, 0.65, 5.1, 0, PI / 2, 12),
      pipe([-1.1, 0.95, 4.8], [-1.1, 3.8, 4.35], 0.1, PLATE),
      pipe([-0.3, 0.95, 4.8], [-0.3, 3.8, 4.35], 0.1, PLATE),
      box(0.18, 0.08, 0.04, LAMP, -0.7, 0.4, 5.76),
    ],
  },
  { // a rack annex half-buried in the front berm
    tech: 'rackDensification',
    parts: () => [box(3.0, 1.5, 1.6, BODY, 2.5, 0.75, 5.1), box(3.1, 0.12, 1.7, TRIM, 2.5, 1.56, 5.1),
      box(2.4, 0.12, 0.05, WINDOW, 2.5, 1.2, 5.91)],
  },
  { // Predictive Scheduling: a scheduling antenna — a tall whip mast with crossbars
    tech: 'predictiveScheduling',
    parts: () => [
      cyl(0.18, 0.22, 0.14, TRIM, -3.7, 3.77, -3.7, 0, 0, 8),
      cyl(0.03, 0.06, 5.2, TRIM, -3.7, 6.3, -3.7, 0, 0, 6),
      bar([-4.2, 7.0, -3.7], [-3.2, 7.0, -3.7], 0.04, TRIM),
      bar([-4.0, 8.0, -3.7], [-3.4, 8.0, -3.7], 0.04, TRIM),
      dome(0.12, BEACON, -3.7, 8.9, -3.7, 8),
    ],
  },
];

const foilFactory: Upgrade[] = [
  { // a second roll-to-roll coating line on the roof
    tech: 'rollToRoll',
    parts: () => [
      box(4.8, 0.8, 1.0, BODY, -1.5, 5.2, 2.8),
      [-3.4, -1.5, 0.4].map((x) => cyl(0.26, 0.26, 1.1, PLATE, x, 5.75, 2.8, PI / 2, 0, 12)),
      cyl(0.4, 0.4, 1.2, FOIL, 1.3, 5.3, 2.8, PI / 2, 0, 14),
      pane(3.0, 0.3, -1.6, 5.25, 3.3, 0),
    ],
  },
  { // solar annealing ovens with mirror lids on the roof
    tech: 'foilAnnealing',
    parts: () => [-1.2, 0.6].flatMap((z) => [
      box(1.4, 0.9, 1.4, BODY, -3.4, 5.25, z),
      box(1.2, 0.05, 1.2, GLASS, -3.4, 5.72, z),
      box(1.4, 0.05, 1.3, FOIL, -3.4, 6.2, z - 0.55, 0, 0, 1.0),
    ]),
  },
  { // a canister press at the loading dock (+x)
    tech: 'canisterPress',
    parts: () => [
      bar([4.9, 0, 2.6], [4.9, 2.6, 2.6], 0.18, TRIM), bar([5.7, 0, 2.6], [5.7, 2.6, 2.6], 0.18, TRIM),
      box(1.1, 0.5, 0.7, PLATE, 5.3, 2.4, 2.6),
      box(0.8, 0.12, 0.6, TRIM, 5.3, 0.9, 2.6),
      [-0.25, 0, 0.25].map((dx) => cyl(0.1, 0.1, 0.5, FOIL, 5.3 + dx, 0.25, 3.3, 0, 0, 8)),
    ],
  },
  { // seed-factory pods on the roof
    tech: 'vonNeumann',
    parts: () => [[-1.0, -2.6], [0.5, -2.6], [-0.2, -0.9]].flatMap(([x, z]) => [
      cyl(0.72, 0.72, 0.3, TRIM, x, 4.95, z, 0, 0, 10),
      dome(0.68, FOIL, x, 5.1, z, 10),
      box(0.16, 0.06, 0.04, LAMP, x, 5.25, z + 0.66),
    ]),
  },
  { // superconducting bus ducts on the west wall
    tech: 'superconductingBus',
    parts: () => [pipe([-4.95, 2.8, -3.5], [-4.95, 2.8, 2.0], 0.13, FOIL), pipe([-4.95, 3.1, -3.5], [-4.95, 3.1, 2.0], 0.13, FOIL),
      [-2.8, -0.8, 1.2].map((z) => box(0.3, 0.6, 0.12, TRIM, -4.9, 2.95, z))],
  },
];

const massDriver: Upgrade[] = [
  { tech: 'launchSiteSurvey', parts: () => [surveyStakes([[-11.6, 3.6], [11.6, 3.6], [11.6, -3.6], [-11.6, -3.6], [0, 3.7], [0, -3.7]])] },
  { // a swarm-tracking beacon mast on the drive house
    tech: 'swarmProtocol',
    parts: () => [beaconMast(-10.3, 3.3, 1.6, 4.4)],
  },
  { // capacitor banks alongside the rail
    tech: 'railCapacitors',
    parts: () => [-4, -1, 2, 5, 8].flatMap((x) => [
      box(1.3, 0.9, 0.9, BODY, x, 0.45, 2.7),
      box(1.36, 0.08, 0.96, TRIM, x, 0.92, 2.7),
      box(0.16, 0.06, 0.04, LAMP, x, 0.7, 3.16),
      bar([x, 0.9, 2.4], [x, 2.6 + Math.tan(0.18) * (x - 0.6), 1.2], 0.06, PLATE),
    ]),
  },
];

const relayMast: Upgrade[] = [
  { // a neutron-spectrometer boom at mid-height
    tech: 'neutronSpectrometry',
    parts: () => [
      bar([-0.3, 6.2, -0.1], [-1.6, 6.2, -0.7], 0.08, TRIM),
      bar([-0.3, 7.2, -0.1], [-1.5, 6.3, -0.66], 0.04, TRIM),
      cyl(0.18, 0.18, 0.6, BODY, -1.65, 6.0, -0.72, 0, 0, 10),
      dome(0.18, BODY, -1.65, 6.3, -0.72, 8),
    ],
  },
  { // Self-Expanding Base: a beacon crown and a cable reel at the foot
    tech: 'selfExpandingBase',
    parts: () => {
      const out: Parts = [
        cyl(0.45, 0.45, 0.5, PLATE, -1.0, 0.65, 0.9, PI / 2, 0, 12),
        box(0.12, 0.8, 0.7, TRIM, -1.3, 0.4, 0.9),
        box(0.12, 0.8, 0.7, TRIM, -0.7, 0.4, 0.9),
      ];
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * PI * 2 + PI / 6;
        const x = Math.cos(a) * 0.75, z = Math.sin(a) * 0.75;
        out.push(bar([0, 10.3, 0], [x, 10.45, z], 0.05, TRIM), dome(0.13, BEACON, x, 10.5, z, 8));
      }
      return out;
    },
  },
];

const propellantPlant: Upgrade[] = [
  { tech: 'launchSiteSurvey', parts: () => [surveyStakes([[-5.9, 3.95], [5.8, 3.9], [5.8, -3.9], [-5.9, -3.95]])] },
  { tech: 'btColdTrapChemistry', parts: () => [bottleRack(-0.1, 0, 3.4, 4)] },
  { tech: 'swarmProtocol', parts: () => [beaconMast(-4.9, 2.7, -3.2, 3.6)] },
  { // cryocooler heads on the tank tops
    tech: 'cryocoolerHeads',
    parts: () => [-1.8, 1.8].flatMap((z) => [
      cyl(0.32, 0.36, 0.6, BODY, 2.8, 7.8, z, 0, 0, 12),
      [7.65, 7.85, 8.05].map((y) => cyl(0.46, 0.46, 0.05, TRIM, 2.8, y, z, 0, 0, 12)),
      box(0.3, 0.3, 0.3, PLATE, 2.8, 8.25, z),
    ]),
  },
];

const storageYard: Upgrade[] = [
  { // Budget Governor: a manifest gantry — a scanner bar on two legs across the racks
    tech: 'budgetGovernor',
    parts: () => [
      bar([-2.95, 0.4, 0.05], [-2.95, 3.0, 0.05], 0.12, TRIM),
      bar([2.95, 0.4, 0.05], [2.95, 3.0, 0.05], 0.12, TRIM),
      bar([-3.05, 3.0, 0.05], [3.05, 3.0, 0.05], 0.16, TRIM),
      box(0.5, 0.3, 0.4, BODY, 0.6, 2.8, 0.05),
      box(0.4, 0.04, 0.3, LAMP, 0.6, 2.63, 0.05),
    ],
  },
];

const LANE: Partial<Record<BuildingId, Upgrade[]>> = {
  lander, solar, excavator, habitat, smelter, iceHarvester, hydroponics, battery, refinery, lab,
  roboticsBay, partsFab, reactor, recDome, chipFab, dataCenter, foilFactory, massDriver, relayMast,
  propellantPlant, storageYard,
};

/** Every type's upgrades: the lane techs' parts, then the destiny's (the
 *  picks, the capstones, and the destiny buildings' own lists; destinyParts.ts). */
export const UPGRADES: Partial<Record<BuildingId, Upgrade[]>> = Object.fromEntries(
  [...new Set([...Object.keys(LANE), ...Object.keys(DESTINY_UPGRADES)])].map((t) => [
    t, [...(LANE[t as BuildingId] ?? []), ...(DESTINY_UPGRADES[t as BuildingId] ?? [])],
  ]),
);

/** Techs with a mesh part on this building type, in recipe order. */
export function upgradeTechs(type: BuildingId): TechId[] {
  return (UPGRADES[type] ?? []).map((u) => u.tech);
}

/** The type's upgrade key: its upgrade techs that are done, comma-joined in
 *  recipe order ('' = the stock recipe). */
export function upgradeKey(type: BuildingId, techsDone: readonly string[]): string {
  const list = UPGRADES[type];
  if (!list) return '';
  return list.filter((u) => techsDone.includes(u.tech)).map((u) => u.tech).join(',');
}

/** Every upgrade entry named by a key. */
export function upgradesIn(type: BuildingId, key: string): Upgrade[] {
  if (!key) return [];
  const on = new Set(key.split(','));
  return (UPGRADES[type] ?? []).filter((u) => on.has(u.tech));
}
