/** Lunar Map vocabulary (spec §5b). The prospect table, maria, and the
 *  survey/outpost class tables are filled in by the map workstream. */

export type ProspectId =
  | 'tranquilityBase' | 'moltke' | 'maskelyne' | 'tranqRegolith' | 'tranqPit' | 'descartes'
  | 'taurusLittrow' | 'ina' | 'lamont'
  | 'shackletonFloor' | 'connectingRidge' | 'cabeus' | 'haworth' | 'malapert' | 'schrodinger' | 'shoemakerIce'
  | 'mariusTube' | 'mariusDomes' | 'reinerGamma' | 'aristarchus' | 'monsRumker' | 'gruithuisen'
  | 'fraMauro' | 'copernicus' | 'hadley' | 'hermite'
  | 'daedalus' | 'moscoviense' | 'vonKarman' | 'comptonBelkovich' | 'ingeniiPit' | 'apolloBasin'
  | 'spaMass' | 'procellarumTubes';

export const PROSPECT_IDS: ProspectId[] = [
  'tranquilityBase', 'moltke', 'maskelyne', 'tranqRegolith', 'tranqPit', 'descartes',
  'taurusLittrow', 'ina', 'lamont',
  'shackletonFloor', 'connectingRidge', 'cabeus', 'haworth', 'malapert', 'schrodinger', 'shoemakerIce',
  'mariusTube', 'mariusDomes', 'reinerGamma', 'aristarchus', 'monsRumker', 'gruithuisen',
  'fraMauro', 'copernicus', 'hadley', 'hermite',
  'daedalus', 'moscoviense', 'vonKarman', 'comptonBelkovich', 'ingeniiPit', 'apolloBasin',
  'spaMass', 'procellarumTubes',
];

/** distance class relative to the home site (great-circle); subsurface is flagged */
export type ProspectClass = 'local' | 'regional' | 'near' | 'far' | 'subsurface';

export type ProspectKind =
  | 'heritage' | 'anomaly'
  | 'ilmenite' | 'volatiles' | 'silica' | 'glass' | 'ice' | 'kreep' | 'radio';

/** heritage and anomaly prospects are survey-only */
export type OutpostKind = Exclude<ProspectKind, 'heritage' | 'anomaly'>;

/** Map views, innermost first; each coverage tier unlocks the next. */
export type MapView = 'site' | 'vicinity' | 'region' | 'near' | 'far' | 'moon';

/** A live outpost's link load, added to powerDelta.lander by computeMods. */
export const OUTPOST_LINK_KW: Record<ProspectClass, number> = {
  local: -1, regional: -1, near: -1.5, far: -2, subsurface: -2,
};
