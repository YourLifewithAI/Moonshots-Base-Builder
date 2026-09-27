/** Ore (docs/17 §9–§13, Phase 4): the grade tables, the ore halo and the
 *  cutoff, faces, the deposit survey, strip-mine morale and Reclaim. The
 *  logic is core/ore.ts (pure) and core/pits.ts (the pits' states).
 *
 *  **q** is a load's grade against its hub's recipe reference: the hub's
 *  output is recipe × q. Every grade here is in q; the words turn it back
 *  into the measure (`ref`: 6.5% ilmenite is q 1 for hydrogen reduction). */
import type { DepositKind } from './deposits';

/** How a hub turns regolith into product, which sets what grade means (§9.1). */
export type Process = 'H2' | 'MRE' | 'plag' | 'ice' | 'soil';

/** The process a deposit's ore is measured in: its wanted hub's. KREEP (the
 *  reactor's make-up, by share) and peaks of light hold no ore to measure. */
export const ORE_PROCESS: Partial<Record<DepositKind, Process>> = {
  ilmenite: 'H2', glass: 'H2', anorthosite: 'plag', ice: 'ice', volatiles: 'soil',
};

/** The site's plain ground: the pole is highland; the mare and the lava tube are mare ground. */
export type Ground = 'mare' | 'highland';

type Range = readonly [number, number];

export const GRADE = {
  /** the recipe's reference (q 1) in its measure, for the words */
  ref: { H2: 6.5, MRE: 100, plag: 75, ice: 5, soil: 100 } as Record<Process, number>,
  /** '11% ilmenite', '96% plagioclase', '7.5 wt% ice', 'volatiles 100% of mature soil's' */
  unit: { H2: '% ilmenite', MRE: '% oxides', plag: '% plagioclase', ice: ' wt% ice', soil: '% of mature soil’s volatiles' } as Record<Process, string>,
  /** plain ground, q, by the site's ground (robots dig it in bulk) */
  plain: {
    H2: { mare: 0.62, highland: 0.45 },
    MRE: { mare: 1, highland: 1 },
    plag: { mare: 0.8, highland: 1.0 },
    ice: { mare: 0, highland: 0 },
    soil: { mare: 0.4, highland: 0.4 },
  } as Record<Process, Record<Ground, number>>,
  /** a deposit's centre grade, q, seeded within its range per deposit; a process a
   *  kind does not name sees it as plain ground */
  centre: {
    ilmenite: { H2: [1.4, 2.0], plag: [0.6, 0.6] },
    anorthosite: { H2: [0.3, 0.3], plag: [1.23, 1.33] },
    glass: { H2: [1.0, 1.3], plag: [0.6, 0.6] },
    kreep: { H2: [0.5, 0.5] },
    volatiles: { soil: [1.0, 1.0] },
    ice: { ice: [0.6, 1.8] },
    ridge: {},
  } as Record<DepositKind, Partial<Record<Process, Range>>>,
  /** the pole's starter cold trap (its first ice deposit) is seeded rich: 8–10 wt% */
  starterIce: [1.6, 2.0] as Range,
  /** the ore halo reaches this × the ring, falling to plain ground there (§10.1) */
  halo: 1.3,
  /** a deposit is dug out when its cut falls to plain + this share of its enrichment */
  cutoff: 0.15,
  /** a crew (this many aboard or more) high-grades plain ground: q × `crew` */
  crew: 1.25, crewMin: 2,
  /** bedrock benches (Deep Coring): 80% of the grade above, dug at ×0.3 */
  bedrock: 0.8, bedrockDig: 0.3,
};

/** Faces (§8.2): a working bench needs this much free rim; a pit holds 1 to `max`. */
export const FACES = { perM: 30, max: 6 };

/** The deposit survey (§13.2): a free construction rover's job. */
export const DEP_SURVEY = {
  /** stored energy (the core drill) and parts (bits), paid when it is queued */
  energy: 30, parts: 2,
  /** rover-seconds at the deposit */
  coreS: 40,
  /** the cores go to the labs */
  data: 5,
  /** a first survey's precision (±30%); research tightens it (mods.surveyPrecision) */
  precision: 0.3,
  /** jobs queued at once */
  queueMax: 4,
};

/** Size classes of a mapped deposit before its survey (§13.1), m². */
export const SIZE_CLASS = { patch: 1000, broad: 2000 };

/** Strip-mine morale (§12.1): the target, per 1,000 m² of scar (pit and heap). */
export const STRIP = {
  plain: -1, deposit: -0.4, reclaimed: 0.2,
  /** full within `nearM` of a habitat or the crewed Lander, fading to 0 at `farM` */
  nearM: 100, farM: 250,
  cap: -12,
};

/** Reclaim (§12.2): units push the heap back in, filling the pit to −1 m. */
export const RECLAIM = {
  /** the fill's level, m below the ground it was cut from */
  floorM: 1,
  /** m³ owed before the ground is rewritten */
  batchM3: 60,
};
