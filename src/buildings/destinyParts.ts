/** The destiny made visible (docs/14 §4.1): the parts the 16 track techs
 *  (the eight era picks of each side, the landing included) and the three
 *  capstones add to the buildings they name, and the upgrade lists of the
 *  four destiny buildings. upgrades.ts appends these to each type's list,
 *  so they key, merge, ghost and scaffold like every other upgrade.
 *
 *  Same rules as upgrades.ts: the building's own frame (base at y = 0, door
 *  side +z), the shared finishes only (plus LEAF, the Colony's green), a few
 *  hundred triangles a part. Colony parts are lived in — porches, collars,
 *  terraces, windows, planters, lamps; Automation parts are for machines —
 *  whips and node lamps, shutters over the windows, cable trays, dark slabs,
 *  fin crowns. Both sides of one era's pick never meet on one building, so
 *  a pair may share a spot. */
import type { BufferGeometry } from 'three';
import type { BuildingId } from '../data/buildings';
import {
  BEACON, BODY, FOIL, GLASS, LAMP, LEAF, PLATE, RADIATOR, TRIM, WINDOW,
  antenna, arc, archWall, bar, box, cyl, domeBand, pipe, vault, type Finish,
} from './meshKit';
import type { Deep, Upgrade } from './upgrades';

type Parts = Deep[];
const PI = Math.PI;

/** A disc (round window, hatch) on a wall facing yaw ry (0 = +z; ±π/2 = ±x). */
function disc(r: number, t: number, f: Finish, x: number, y: number, z: number, ry: number, seg = 10): BufferGeometry {
  return Math.abs(Math.sin(ry)) > 0.5 ? cyl(r, r, t, f, x, y, z, 0, PI / 2, seg) : cyl(r, r, t, f, x, y, z, PI / 2, 0, seg);
}

/** Pressure-Rated Halls: an airlock porch on a wall — a vestibule, its outer
 *  door, a lit round window beside it, a lamp over the door. (x, z) is the
 *  wall point, ry the wall's outward yaw. */
function airlockPorch(x: number, z: number, ry: number, w = 1.7, h = 2.4, d = 1.0): Parts {
  const s = Math.sin(ry), c = Math.cos(ry);
  const tx = Math.cos(ry), tz = -Math.sin(ry);
  const at = (along: number, out: number): [number, number] => [x + tx * along + s * out, z + tz * along + c * out];
  const [bx, bz] = at(0, d / 2);
  const [fx, fz] = at(-0.3, d + 0.03);
  const [wx, wz] = at(0.45, d + 0.03);
  const [lx, lz] = at(-0.3, d + 0.16);
  return [
    box(w, h, d, BODY, bx, h / 2, bz, ry),
    box(w + 0.14, 0.14, d + 0.12, TRIM, bx, h + 0.07, bz, ry),
    box(0.66, 1.75, 0.06, PLATE, fx, 0.88, fz, ry),
    disc(0.24, 0.07, WINDOW, wx, 1.45, wz, ry),
    disc(0.3, 0.05, TRIM, wx, 1.45, wz, ry),
    box(0.44, 0.1, 0.24, LAMP, lx, 1.98, lz, ry),
  ];
}

/** Dispatch Mesh: a mesh-radio whip and its blinking node lamp. */
function meshWhip(x: number, y0: number, z: number, h = 3.0): Parts {
  return [
    antenna(x, y0, z, h, 0.045),
    box(0.3, 0.3, 0.3, BODY, x, y0 + h * 0.45, z),
    box(0.1, 0.1, 0.32, LAMP, x + 0.15, y0 + h * 0.45, z),
  ];
}

/** Shutters (Lights-Out): a BODY panel a hair proud of a run of panes. */
const shutter = (w: number, h: number, x: number, y: number, z: number, ry = 0) => box(w, h, 0.05, BODY, x, y, z, ry);

/** A cable tray over a roof to a network node with a cold lamp. */
function trayToNode(a: [number, number, number], b: [number, number, number]): Parts {
  return [
    bar(a, b, 0.22, TRIM),
    box(0.55, 0.6, 0.45, BODY, b[0], b[1] + 0.3, b[2]),
    box(0.6, 0.08, 0.5, TRIM, b[0], b[1] + 0.64, b[2]),
    box(0.3, 0.08, 0.04, LAMP, b[0], b[1] + 0.42, b[2] + 0.24),
  ];
}

/** A dark slab with a lamp stripe: the Automation's monolith (annex, guidance). */
function slab(w: number, h: number, d: number, x: number, y0: number, z: number, lampFace: 1 | -1 = 1): Parts {
  return [
    box(w, h, d, GLASS, x, y0 + h / 2, z),
    box(w + 0.1, 0.16, d + 0.1, TRIM, x, y0 + h + 0.08, z),
    box(0.12, h * 0.8, 0.04, LAMP, x, y0 + h * 0.5, z + lampFace * (d / 2 + 0.02)),
  ];
}

/** Festival lamp strings (Commonwealth): LAMP lines from a high point out to a ring of low ones. */
function festoons(top: [number, number, number], ends: readonly [number, number, number][]): Parts {
  return ends.map((e) => bar(top, e, 0.05, LAMP));
}

/** A parked quadcopter on a pad (the drone perch). */
function perchedDrone(x: number, y: number, z: number): Parts {
  const out: Parts = [box(0.5, 0.16, 0.5, BODY, x, y + 0.12, z), box(0.3, 0.04, 0.3, GLASS, x, y + 0.22, z)];
  for (const [dx, dz] of [[-0.36, -0.36], [0.36, -0.36], [0.36, 0.36], [-0.36, 0.36]]) {
    out.push(box(0.34, 0.03, 0.34, TRIM, x + dx, y + 0.2, z + dz));
  }
  return out;
}

// ─────────────────────────── per building ───────────────────────────

const landerR = (y: number) => 2.6 - ((y - 1.7) / 7) * 0.4; // the Lander's hull radius at height y

const lander: Upgrade[] = [
  { // Crewed Landing: a flag on its pole by the ladder, and the crew cabin's lit window band
    tech: 'landingCrew',
    parts: () => [
      cyl(0.05, 0.06, 5.4, TRIM, 2.6, 2.7, 4.3, 0, 0, 6),
      box(1.3, 0.72, 0.03, BODY, 3.27, 4.95, 4.3),
      box(1.3, 0.16, 0.035, TRIM, 3.27, 4.95, 4.3),
      cyl(landerR(6.75) + 0.03, landerR(6.75) + 0.03, 0.24, WINDOW, 0, 6.75, 0, 0, 0, 20, true),
    ],
  },
  { // Robotic Mission: the cabin windows blanked by a hull band, a rover stowed in a cradle on the hull
    tech: 'landingRobotic',
    parts: () => [
      cyl(landerR(7.4) + 0.14, landerR(7.4) + 0.14, 0.66, BODY, 0, 7.4, 0, 0, 0, 20, true),
      bar([-0.7, 4.2, -landerR(4.2) + 0.05], [-0.7, 4.2, -landerR(4.2) - 0.55], 0.12, TRIM),
      bar([0.7, 4.2, -landerR(4.2) + 0.05], [0.7, 4.2, -landerR(4.2) - 0.55], 0.12, TRIM),
      box(1.7, 0.5, 0.9, BODY, 0, 4.55, -landerR(4.5) - 0.62),
      box(1.2, 0.04, 0.7, GLASS, 0, 4.82, -landerR(4.5) - 0.62),
      box(1.8, 0.3, 0.2, PLATE, 0, 4.2, -landerR(4.2) - 1.02),
    ],
  },
  { // Dispatch Mesh: a router cabinet by the power junction, its whip and node lamp
    tech: 'dispatchMesh',
    parts: () => [
      box(0.8, 1.1, 0.5, BODY, 3.6, 0.55, 0.1),
      box(0.3, 0.08, 0.04, LAMP, 3.6, 0.85, 0.37),
      bar([3.85, 1.1, 0.1], [3.85, 2.9, 0.1], 0.04, TRIM),
      box(0.12, 0.12, 0.12, BEACON, 3.85, 2.95, 0.1),
    ],
  },
  { // Crew Rotation Charter: a crew-rotation beacon mast, guyed
    tech: 'crewCharter',
    parts: () => [
      box(0.6, 0.12, 0.6, TRIM, -3.7, 0.06, 1.7),
      cyl(0.06, 0.08, 5.6, TRIM, -3.7, 2.9, 1.7, 0, 0, 6),
      cyl(0.16, 0.16, 0.24, LAMP, -3.7, 4.4, 1.7, 0, 0, 6),
      box(0.22, 0.22, 0.22, BEACON, -3.7, 5.8, 1.7),
      bar([-3.7, 4.0, 1.7], [-4.6, 0.02, 2.2], 0.03, TRIM),
    ],
  },
  { // Lunar Commonwealth: a commons plaza round the Lander, a tall flagpole, festival strings
    tech: 'commonwealth',
    parts: () => [
      cyl(4.7, 4.7, 0.08, PLATE, 0, 0.04, 0, 0, 0, 16),
      cyl(0.06, 0.08, 7.6, TRIM, 1.3, 3.8, 4.35, 0, 0, 6),
      box(1.5, 0.8, 0.03, BODY, 2.07, 7.0, 4.35),
      festoons([1.3, 7.3, 4.35], [[2.3, 5.2, -0.6], [-2.3, 5.2, 0.6], [0.5, 5.3, 2.4]]),
    ],
  },
  { // Concord: a joint-operations mast — a lit crew cabin under a drone perch
    tech: 'concord',
    parts: () => [
      box(1.2, 1.2, 1.2, BODY, -3.2, 0.6, -4.6),
      box(1.24, 0.3, 1.24, WINDOW, -3.2, 0.85, -4.6),
      bar([-3.2, 1.2, -4.6], [-3.2, 4.2, -4.6], 0.14, TRIM),
      box(1.3, 0.08, 1.3, PLATE, -3.2, 4.25, -4.6),
      perchedDrone(-3.2, 4.29, -4.6),
      box(0.14, 0.14, 0.14, BEACON, -2.6, 4.4, -4.0),
    ],
  },
];

const lab: Upgrade[] = [
  { tech: 'pressureHalls', parts: () => [airlockPorch(-2.72, 0.6, -PI / 2, 2.0, 2.5, 1.15)] },
];

const partsFab: Upgrade[] = [
  { tech: 'pressureHalls', parts: () => [airlockPorch(-1.1, -3.3, PI, 1.3, 2.3, 0.7)] },
  { // Lights-Out Fabs: the wall strip and the sawtooth glazing shuttered; a roof tray to a node lamp
    tech: 'lightsOutFabs',
    parts: () => [
      shutter(4.5, 0.64, 3.44, 2.2, 0, PI / 2),
      ...[-2.2, 0, 2.2].map((x) => box(0.05, 0.86, 6.26, BODY, x + 1.06, 3.75, 0)),
      trayToNode([-2.8, 3.1, -3.5], [2.7, 3.05, -3.5]),
    ],
  },
  { // Replicator Stacks: a second fab storey on the roof, and a hoist gantry over it
    tech: 'replicatorStacks',
    parts: () => [
      box(4.8, 2.0, 2.6, BODY, 0, 5.3, 1.7),
      box(4.9, 0.14, 2.7, TRIM, 0, 6.37, 1.7),
      box(4.2, 0.3, 0.04, PLATE, 0, 5.4, 3.02),
      bar([-2.9, 4.3, 1.7], [-2.9, 7.4, 1.7], 0.16, TRIM),
      bar([2.9, 4.3, 1.7], [2.9, 7.4, 1.7], 0.16, TRIM),
      bar([-3.0, 7.4, 1.7], [3.0, 7.4, 1.7], 0.22, TRIM),
      box(0.5, 0.36, 0.5, PLATE, 1.0, 7.1, 1.7),
    ],
  },
];

const roboticsBay: Upgrade[] = [
  { tech: 'pressureHalls', parts: () => [airlockPorch(3.3, -0.8, PI / 2, 1.8, 2.3, 0.7)] },
  { tech: 'dispatchMesh', parts: () => [meshWhip(-2.8, 3.1, 0.8, 3.2)] },
  { // Drone Hives: a drone perch cantilevered off the back wall, a drone parked on it
    tech: 'droneHives',
    parts: () => [
      box(1.9, 0.08, 1.1, PLATE, -1.3, 2.4, -3.3),
      bar([-2.1, 1.6, -2.72], [-2.1, 2.36, -3.7], 0.08, TRIM),
      bar([-0.5, 1.6, -2.72], [-0.5, 2.36, -3.7], 0.08, TRIM),
      box(0.14, 0.06, 0.14, LAMP, -2.2, 2.47, -3.8),
      box(0.14, 0.06, 0.14, LAMP, -0.4, 2.47, -3.8),
      perchedDrone(-1.3, 2.44, -3.3),
    ],
  },
  { // Lights-Out Charter: an antenna farm along the back of the roof
    tech: 'lightsOutCharter',
    parts: () => [0.5, 1.4, 2.3, -0.4].map((x, i) => [
      cyl(0.03, 0.05, 1.6 + (i % 2) * 0.6, TRIM, x, 3.1 + (0.8 + (i % 2) * 0.3), -2.55, 0, 0, 5),
      box(0.1, 0.1, 0.1, BEACON, x, 3.1 + 1.6 + (i % 2) * 0.6, -2.55),
    ]),
  },
];

const relayMast: Upgrade[] = [
  { tech: 'dispatchMesh', parts: () => [meshWhip(-0.35, 10.9, 0.3, 2.2), box(0.36, 0.36, 0.3, BODY, 0.62, 5.2, 0.1), box(0.08, 0.08, 0.32, LAMP, 0.82, 5.2, 0.1)] },
  { // Lights-Out Charter: a firewall node cabinet at the foot
    tech: 'lightsOutCharter',
    parts: () => [
      box(0.8, 1.3, 0.6, BODY, 1.05, 0.65, 1.05),
      box(0.86, 0.1, 0.66, TRIM, 1.05, 1.35, 1.05),
      box(0.5, 0.06, 0.04, LAMP, 1.05, 1.05, 1.37),
      box(0.5, 0.06, 0.04, LAMP, 1.05, 0.85, 1.37),
    ],
  },
];

const habitat: Upgrade[] = [
  { // Crew Rotation Charter: a lit hab-ring collar round the dome, a suit-port porch on the +x side
    tech: 'crewCharter',
    parts: () => [
      cyl(2.66, 2.86, 0.5, BODY, 0, 2.93, 0, 0, 0, 20, true),
      cyl(2.73, 2.8, 0.2, WINDOW, 0, 2.95, 0, 0, 0, 20, true),
      box(0.9, 1.8, 1.5, BODY, 3.6, 0.9, 0.4),
      box(1.0, 0.12, 1.6, TRIM, 3.6, 1.86, 0.4),
      ...[0.05, 0.75].map((z) => disc(0.28, 0.08, PLATE, 4.07, 1.05, z, PI / 2, 8)),
      box(0.3, 0.08, 0.2, LAMP, 4.1, 1.62, 0.4),
    ],
  },
  { // Settler Charter: a second storey on the crown — a habitation terrace with a rail, planters, warm windows
    tech: 'settlerCharter',
    parts: () => [
      cyl(2.45, 2.45, 0.12, TRIM, 0, 3.92, 0, 0, 0, 16),
      cyl(1.65, 1.7, 1.5, BODY, 0, 4.72, 0, 0, 0, 16, true),
      cyl(1.72, 1.72, 0.42, WINDOW, 0, 4.78, 0, 0, 0, 16, true),
      cyl(1.8, 1.8, 0.14, TRIM, 0, 5.53, 0, 0, 0, 16),
      cyl(2.42, 2.42, 0.06, TRIM, 0, 4.9, 0, 0, 0, 16, true),
      [0, 1, 2, 3, 4, 5].map((k) => { const a = (k / 6) * PI * 2 + 0.3; return box(0.05, 0.9, 0.05, TRIM, Math.cos(a) * 2.42, 4.43, Math.sin(a) * 2.42); }),
      [0, 1, 2, 3].map((k) => { const a = (k / 4) * PI * 2 + PI / 4; return box(0.5, 0.3, 0.3, LEAF, Math.cos(a) * 2.1, 4.13, Math.sin(a) * 2.1, -a); }),
    ],
  },
  { // Lights-Out Charter: shutters over every window — the ring panes, the crown patches, the skylight
    tech: 'lightsOutCharter',
    parts: () => [
      arc(3.36, 3.36, 0.62, BODY, 0, 0.82, 0, PI / 2 + 0.7, PI * 2.5 - 0.7, 18),
      [0, 1, 2, 3].map((k) => domeBand(3.18, 0.6, 0.88, BODY, 0, 1.4, 0, 4, k * PI / 2 + 0.47, 0.61)),
      domeBand(3.17, 0, 0.27, BODY, 0, 1.4, 0, 12),
    ],
  },
  { // Garden Domes: pressure bulkheads — a heavy frame round the airlock
    tech: 'gardenDomes',
    parts: () => [
      box(0.22, 2.0, 0.22, TRIM, -0.9, 1.0, 3.82), box(0.22, 2.0, 0.22, TRIM, 0.9, 1.0, 3.82),
      box(2.02, 0.22, 0.22, TRIM, 0, 2.0, 3.82),
      box(1.9, 0.12, 1.9, TRIM, 0, 1.98, 3.0),
    ],
  },
  { // Lunar Commonwealth: festival lamp strings from the antenna down to the drum
    tech: 'commonwealth',
    parts: () => festoons([1.5, 5.9, -1.0], [[3.2, 1.4, 0.8], [-2.4, 1.4, 2.1], [-2.2, 1.4, -2.3], [2.5, 1.4, -2.1]]),
  },
];

const hydroponics: Upgrade[] = [
  { // Hydroponic Commons: the door end glazed (a lit galley behind the door), a leaf-green trellis down both flanks
    tech: 'hydroCommons',
    parts: () => [
      archWall(2.3, 0.04, WINDOW, 0, 0.5, 4.73, 12),
      vault(2.36, 0.08, TRIM, 0, 0.5, 4.74, 0, PI, 12),
      box(0.08, 2.3, 0.06, TRIM, -1.2, 1.65, 4.76), box(0.08, 2.3, 0.06, TRIM, 1.2, 1.65, 4.76),
      vault(2.65, 8.4, LEAF, 0, 0.5, 0, 0.28, 0.6, 3),
      vault(2.65, 8.4, LEAF, 0, 0.5, 0, PI - 0.88, 0.6, 3),
      bar([2.4, 2.02, -4.2], [2.4, 2.02, 4.2], 0.06, TRIM), bar([-2.4, 2.02, -4.2], [-2.4, 2.02, 4.2], 0.06, TRIM),
    ],
  },
  { // Greenhouse Rings: a seed-bank vault behind the farm (the ring's guard against blight)
    tech: 'greenhouseRings',
    parts: () => [
      box(1.2, 1.0, 1.0, BODY, 2.9, 0.5, -5.15),
      box(1.3, 0.1, 1.1, TRIM, 2.9, 1.05, -5.15),
      box(0.6, 0.6, 0.04, FOIL, 2.9, 0.5, -5.67),
      box(0.2, 0.06, 0.04, LAMP, 2.9, 0.9, -5.68),
    ],
  },
];

const chipFab: Upgrade[] = [
  { // Lights-Out Fabs: the front window strip shuttered; a roof tray to a node with a cold lamp
    tech: 'lightsOutFabs',
    parts: () => [
      shutter(5.2, 0.58, -1.8, 1.9, 3.44),
      trayToNode([-0.2, 3.12, 2.55], [4.3, 3.05, 2.55]),
    ],
  },
];

const dataCenter: Upgrade[] = [
  { // Fleet OS: a black server-monolith annex standing in the west berm, a cold lamp stripe
    tech: 'fleetOS',
    parts: () => [slab(1.2, 7.2, 1.5, -5.15, 0, -2.8, 1), box(0.4, 0.3, 0.8, TRIM, -4.55, 3.4, -2.8)],
  },
  { // Selenic Mind: a crown of radiator fins over the roof
    tech: 'selenicMind',
    parts: () => [
      cyl(0.5, 0.6, 0.6, TRIM, 0, 6.6, 0, 0, 0, 10),
      [0, 1, 2, 3, 4, 5].map((k) => { const a = (k / 6) * PI; return box(3.6, 2.2, 0.1, RADIATOR, 0, 8.0, 0, a); }),
      cyl(0.18, 0.18, 0.3, TRIM, 0, 9.25, 0, 0, 0, 8),
      box(0.16, 0.16, 0.16, BEACON, 0, 9.5, 0),
    ],
  },
];

const foilFactory: Upgrade[] = [
  { // Replicator Stacks: a second fab storey on the roof's east half, a gantry over it
    tech: 'replicatorStacks',
    parts: () => [
      box(2.0, 2.2, 5.2, BODY, 3.6, 5.9, -1.0),
      box(2.1, 0.14, 5.3, TRIM, 3.6, 7.07, -1.0),
      box(0.04, 0.3, 4.6, PLATE, 2.58, 6.0, -1.0),
      bar([3.6, 7.1, -3.3], [3.6, 8.6, -3.3], 0.16, TRIM), bar([3.6, 7.1, 1.3], [3.6, 8.6, 1.3], 0.16, TRIM),
      bar([3.6, 8.6, -3.4], [3.6, 8.6, 1.4], 0.22, TRIM),
      box(0.5, 0.4, 0.5, PLATE, 3.6, 8.3, 0.2),
    ],
  },
];

const massDriver: Upgrade[] = [
  { // Crewed Mission Control: a glazed launch-control blockhouse behind the rail, lit consoles, a viewing gallery on its roof
    tech: 'missionControl',
    parts: () => [
      box(3.0, 1.9, 1.4, BODY, 1.8, 0.95, -3.1),
      box(2.8, 0.5, 0.05, WINDOW, 1.8, 1.35, -2.38),
      box(0.6, 0.16, 0.3, LAMP, 1.2, 0.95, -2.62), box(0.6, 0.16, 0.3, LAMP, 2.4, 0.95, -2.62),
      box(3.2, 0.12, 1.6, TRIM, 1.8, 1.96, -3.1),
      bar([0.25, 2.8, -2.35], [3.35, 2.8, -2.35], 0.05, TRIM),
      [0.25, 1.8, 3.35].map((x) => box(0.05, 0.8, 0.05, TRIM, x, 2.42, -2.35)),
    ],
  },
  { // Autonomous Cadence: a black guidance monolith behind the rail, its tracking lamp aimed down-range
    tech: 'autoCadence',
    parts: () => [slab(1.0, 6.2, 1.4, 1.8, 0, -3.1, 1), box(0.5, 0.3, 0.5, TRIM, 1.8, 6.5, -3.1), box(0.3, 0.2, 0.3, LAMP, 2.1, 6.75, -2.9)],
  },
];

const propellantPlant: Upgrade[] = [
  { // Crewed Mission Control: a glazed control blockhouse on the plant's roof, between the radiators
    tech: 'missionControl',
    parts: () => [
      box(2.6, 1.3, 1.6, BODY, -3.0, 3.35, -0.1),
      box(2.4, 0.45, 0.05, WINDOW, -3.0, 3.5, 0.72),
      box(2.7, 0.1, 1.7, TRIM, -3.0, 4.05, -0.1),
      box(0.5, 0.12, 0.2, LAMP, -3.5, 3.1, 0.62), box(0.5, 0.12, 0.2, LAMP, -2.5, 3.1, 0.62),
    ],
  },
  { // Autonomous Cadence: a black guidance monolith on the roof, a cold tracking lamp on top
    tech: 'autoCadence',
    parts: () => [slab(0.9, 4.2, 1.2, -3.0, 2.7, -0.1, 1), box(0.3, 0.2, 0.3, LAMP, -3.0, 7.1, -0.1)],
  },
];

// ─────────────────────── the destiny buildings' own lists ───────────────────────

const serverMonolith: Upgrade[] = [
  { // Liquid Cooling: coolant risers down the fin stack to a pump skid
    tech: 'liquidCooling',
    parts: () => [
      pipe([0.8, 0.5, -3.75], [0.8, 13.4, -3.75], 0.1, PLATE),
      pipe([-0.8, 0.5, -3.75], [-0.8, 13.4, -3.75], 0.1, PLATE),
      box(2.2, 0.5, 0.6, TRIM, 0, 0.75, -3.75),
    ],
  },
  { // Cryogenic Radiators: fin stacks down both flanks
    tech: 'cryoRadiators',
    parts: () => [-1.75, 1.75].flatMap((x) => [0, 1, 2, 3, 4].map((i) => box(0.5, 0.08, 4.4, RADIATOR, x, 3.4 + i * 2.4, -0.4))),
  },
  { // Rack Densification: a rack annex at the foot, beside the door
    tech: 'rackDensification',
    parts: () => [box(1.0, 2.4, 2.4, BODY, 2.0, 1.7, -0.4), box(1.1, 0.12, 2.5, TRIM, 2.0, 2.96, -0.4), box(0.04, 1.4, 0.06, WINDOW, 2.52, 1.7, 0.5)],
  },
  { // Selenic Mind: a crown of radiator fins on the slab's top
    tech: 'selenicMind',
    parts: () => [
      cyl(0.5, 0.6, 0.5, TRIM, 0, 15.65, -0.2, 0, 0, 10),
      [0, 1, 2, 3].map((k) => box(3.2, 1.8, 0.08, RADIATOR, 0, 16.8, -0.2, (k / 4) * PI)),
      box(0.16, 0.16, 0.16, BEACON, 0, 17.9, -0.2),
    ],
  },
];

const droneHive: Upgrade[] = [
  { // Replicator Stacks: a drone printer — a gantry over the landing deck, its print head
    tech: 'replicatorStacks',
    parts: () => [
      bar([-4.1, 1.56, 2.6], [-4.1, 4.6, 2.6], 0.2, TRIM), bar([4.1, 1.56, 2.6], [4.1, 4.6, 2.6], 0.2, TRIM),
      bar([-4.2, 4.6, 2.6], [4.2, 4.6, 2.6], 0.26, TRIM),
      box(0.7, 0.5, 0.7, PLATE, 0, 4.25, 2.6),
      box(0.16, 0.06, 0.04, LAMP, 0, 4.3, 2.97),
    ],
  },
];

const greenhouseRing: Upgrade[] = [
  { // Garden Domes: pressure bulkheads — a heavy frame round the porch door
    tech: 'gardenDomes',
    parts: () => [
      box(0.24, 2.1, 0.24, TRIM, -1.0, 1.05, 7.82), box(0.24, 2.1, 0.24, TRIM, 1.0, 1.05, 7.82),
      box(2.24, 0.24, 0.24, TRIM, 0, 2.1, 7.82),
    ],
  },
  { // Lunar Commonwealth: festival lamp strings from the hub mast out over the ring
    tech: 'commonwealth',
    parts: () => festoons([1.1, 5.6, -0.9], [[6.0, 2.2, 3.0], [-6.0, 2.2, 3.0], [-3.0, 2.2, -6.0], [3.0, 2.2, -6.0], [0.3, 2.2, 6.5]]),
  },
];

const gardenDome: Upgrade[] = [
  { // Lunar Commonwealth: festival lamp strings from the crown down to the terraces
    tech: 'commonwealth',
    parts: () => festoons([0, 12.0, 0], [0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
      const a = (k / 8) * PI * 2;
      return [Math.cos(a) * 8.6, 3.5, Math.sin(a) * 8.6] as [number, number, number];
    })),
  },
];

export const DESTINY_UPGRADES: Partial<Record<BuildingId, Upgrade[]>> = {
  lander, lab, partsFab, roboticsBay, relayMast, habitat, hydroponics, chipFab, dataCenter,
  foilFactory, massDriver, propellantPlant, serverMonolith, droneHive, greenhouseRing, gardenDome,
};
