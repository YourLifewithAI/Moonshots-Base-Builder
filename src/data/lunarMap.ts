/** Lunar Map data (spec §5b): the 34 prospects, the maria basemap, and the
 *  survey / outpost tables by distance class. Coordinates are degrees,
 *  north and east positive. */
import type { ResourceId } from './resources';
import type { SiteId } from './sites';
import type { TechId } from './techs';

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
export const MAP_VIEWS: MapView[] = ['site', 'vicinity', 'region', 'near', 'far', 'moon'];

/** A live outpost's link load, added to powerDelta.lander by computeMods. */
export const OUTPOST_LINK_KW: Record<ProspectClass, number> = {
  local: -1, regional: -1, near: -1.5, far: -2, subsurface: -2,
};

export interface ProspectDef {
  id: ProspectId;
  name: string;
  /** for headers and timers ('Cabeus 1:20') */
  short: string;
  lat: number;
  lon: number;
  kind: ProspectKind;
  /** what the ground is, and why it matters (the real basis) */
  geology: string;
  /** buried: needs T4 (Deep Sounding) wherever home is */
  subsurface?: true;
  /** the breakthrough this prospect hosts (it must list the prospect in its hosts) */
  bt?: TechId;
  /** an outpost stream that differs from its kind's (Shoemaker, the SPA mass) */
  stream?: Partial<Record<ResourceId, number>>;
}

const P = (d: ProspectDef) => d;

export const PROSPECTS: Record<ProspectId, ProspectDef> = {
  tranquilityBase: P({ id: 'tranquilityBase', name: 'Tranquility Base (Apollo 11)', short: 'Tranquility Base',
    lat: 0.67, lon: 23.47, kind: 'heritage', geology: 'EASEP and 57 years of dust; survey only' }),
  moltke: P({ id: 'moltke', name: 'Moltke crater ejecta', short: 'Moltke',
    lat: -0.58, lon: 24.16, kind: 'ilmenite', geology: 'a fresh 7 km crater exposing high-Ti basalt' }),
  maskelyne: P({ id: 'maskelyne', name: 'Maskelyne high-Ti basalt', short: 'Maskelyne',
    lat: 2.20, lon: 30.10, kind: 'ilmenite', geology: 'lava flows with TiO₂ ~10 wt%' }),
  tranqRegolith: P({ id: 'tranqRegolith', name: 'Central Tranquillitatis mature soil', short: 'Tranquillitatis soil',
    lat: 5, lon: 28, kind: 'volatiles', geology: 'the highest solar-wind H and ³He in the maria' }),
  tranqPit: P({ id: 'tranqPit', name: 'Mare Tranquillitatis pit', short: 'Tranquillitatis pit',
    lat: 8.34, lon: 33.22, kind: 'anomaly', bt: 'btLavaTubeCaverns', geology: 'an LROC skylight about 100 m across' }),
  descartes: P({ id: 'descartes', name: 'Descartes highlands (Apollo 16)', short: 'Descartes',
    lat: -8.97, lon: 15.50, kind: 'silica', geology: 'plagioclase-rich anorthosite' }),
  taurusLittrow: P({ id: 'taurusLittrow', name: 'Taurus–Littrow orange glass (Apollo 17)', short: 'Taurus–Littrow',
    lat: 20.19, lon: 30.77, kind: 'glass', bt: 'btVolcanicGlass', geology: 'Shorty crater’s pyroclastic beads' }),
  ina: P({ id: 'ina', name: 'Ina irregular mare patch', short: 'Ina',
    lat: 18.65, lon: 5.30, kind: 'anomaly', geology: 'possibly <100 Myr volcanism' }),
  lamont: P({ id: 'lamont', name: 'Lamont mascon', short: 'Lamont',
    lat: 4.40, lon: 23.70, kind: 'anomaly', subsurface: true, geology: 'buried dense basalt that perturbs orbits' }),
  shackletonFloor: P({ id: 'shackletonFloor', name: 'Shackleton floor (PSR)', short: 'Shackleton floor',
    lat: -89.67, lon: 129.80, kind: 'ice', geology: 'a cold trap near 40 K' }),
  connectingRidge: P({ id: 'connectingRidge', name: 'Shackleton–de Gerlache ridge', short: 'Connecting ridge',
    lat: -89.45, lon: -125, kind: 'silica', geology: 'an anorthositic massif, lit about 90% of the year' }),
  cabeus: P({ id: 'cabeus', name: 'Cabeus (LCROSS impact)', short: 'Cabeus',
    lat: -84.68, lon: -48.72, kind: 'ice', bt: 'btColdTrapChemistry', geology: '5.6 wt% H₂O plus CO, NH₃, H₂S' }),
  haworth: P({ id: 'haworth', name: 'Haworth PSR', short: 'Haworth',
    lat: -87.40, lon: -5.00, kind: 'ice', geology: 'a large PSR with a strong radar CPR signal' }),
  malapert: P({ id: 'malapert', name: 'Malapert Massif', short: 'Malapert',
    lat: -86.00, lon: 2.70, kind: 'anomaly', geology: 'a 5 km peak with Earth always in view' }),
  schrodinger: P({ id: 'schrodinger', name: 'Schrödinger basin vent', short: 'Schrödinger',
    lat: -75.00, lon: 132.40, kind: 'glass', bt: 'btVolcanicGlass', geology: 'a young pyroclastic vent on the basin floor' }),
  shoemakerIce: P({ id: 'shoemakerIce', name: 'Shoemaker subsurface ice', short: 'Shoemaker',
    lat: -88.10, lon: 44.90, kind: 'ice', subsurface: true, stream: { water: 0.25 },
    geology: 'Diviner ice-stability depth < 1 m' }),
  mariusTube: P({ id: 'mariusTube', name: 'Marius Hills tube interior', short: 'Marius tube',
    lat: 14.09, lon: -56.77, kind: 'anomaly', bt: 'btLavaTubeCaverns', geology: 'a radar-sounded intact tube beyond the skylight' }),
  mariusDomes: P({ id: 'mariusDomes', name: 'Marius Hills domes', short: 'Marius domes',
    lat: 13.0, lon: -55.5, kind: 'kreep', geology: 'Procellarum KREEP Terrane volcanics' }),
  reinerGamma: P({ id: 'reinerGamma', name: 'Reiner Gamma swirl', short: 'Reiner Gamma',
    lat: 7.50, lon: -59.00, kind: 'anomaly', geology: 'a crustal magnetic anomaly that deflects the solar wind' }),
  aristarchus: P({ id: 'aristarchus', name: 'Aristarchus Plateau dark mantle', short: 'Aristarchus',
    lat: 24.7, lon: -49.0, kind: 'glass', bt: 'btVolcanicGlass', geology: 'pyroclastic glass, high Th' }),
  monsRumker: P({ id: 'monsRumker', name: 'Mons Rümker', short: 'Mons Rümker',
    lat: 40.80, lon: -58.10, kind: 'kreep', geology: 'a KREEP-rich volcanic complex' }),
  gruithuisen: P({ id: 'gruithuisen', name: 'Gruithuisen silicic domes', short: 'Gruithuisen',
    lat: 36.3, lon: -40.5, kind: 'silica', geology: 'rare silica-rich volcanism' }),
  fraMauro: P({ id: 'fraMauro', name: 'Fra Mauro breccias (Apollo 14)', short: 'Fra Mauro',
    lat: -3.65, lon: -17.47, kind: 'kreep', geology: 'KREEP basalts, Th about 10× average' }),
  copernicus: P({ id: 'copernicus', name: 'Copernicus central peaks', short: 'Copernicus',
    lat: 9.62, lon: -20.08, kind: 'anomaly', geology: 'exposed deep-crust stratigraphy' }),
  hadley: P({ id: 'hadley', name: 'Hadley Rille (Apollo 15)', short: 'Hadley',
    lat: 26.13, lon: 3.63, kind: 'heritage', geology: 'Apollo 15 rover tracks' }),
  hermite: P({ id: 'hermite', name: 'Hermite floor (~26 K)', short: 'Hermite',
    lat: 86.00, lon: -89.90, kind: 'ice', bt: 'btColdTrapChemistry', geology: 'the coldest measured spot (LRO Diviner)' }),
  daedalus: P({ id: 'daedalus', name: 'Daedalus radio-quiet zone', short: 'Daedalus',
    lat: -5.90, lon: 179.40, kind: 'radio', geology: 'shielded from Earth’s radio noise' }),
  moscoviense: P({ id: 'moscoviense', name: 'Mare Moscoviense', short: 'Moscoviense',
    lat: 27.30, lon: 147.90, kind: 'ilmenite', geology: 'far-side mare basalt' }),
  vonKarman: P({ id: 'vonKarman', name: 'Von Kármán (Chang’e 4)', short: 'Von Kármán',
    lat: -45.44, lon: 177.60, kind: 'heritage', geology: 'the first far-side landing, 2019' }),
  comptonBelkovich: P({ id: 'comptonBelkovich', name: 'Compton–Belkovich', short: 'Compton–Belkovich',
    lat: 61.10, lon: 99.50, kind: 'silica', geology: 'a far-side silicic volcano, Th hot spot' }),
  ingeniiPit: P({ id: 'ingeniiPit', name: 'Mare Ingenii pit', short: 'Ingenii pit',
    lat: -35.95, lon: 166.06, kind: 'anomaly', bt: 'btLavaTubeCaverns', geology: 'a far-side skylight inside a swirl' }),
  apolloBasin: P({ id: 'apolloBasin', name: 'Apollo basin (inside SPA)', short: 'Apollo basin',
    lat: -36.00, lon: -151.00, kind: 'ilmenite', geology: 'an FeO-rich deep-crust floor' }),
  spaMass: P({ id: 'spaMass', name: 'SPA deep mass anomaly', short: 'SPA mass',
    lat: -56, lon: -170, kind: 'ilmenite', subsurface: true, stream: { metals: 0.30, oxygen: 0.08 },
    geology: 'GRAIL excess mass, possibly buried impactor iron' }),
  procellarumTubes: P({ id: 'procellarumTubes', name: 'Procellarum buried tube network', short: 'Procellarum tubes',
    lat: 14.5, lon: -57.5, kind: 'anomaly', subsurface: true, geology: 'GRAIL gravity lows along sinuous rilles' }),
};

/** Survey methods by class (spec §5b). Hopper classes pay propellant by
 *  distance d (degrees): O₂ min(200, 20 + d), water min(40, 4 + 0.2d), and
 *  take min(420, 60 + 3d) s; every result rounds to a whole unit. */
export const SURVEY_CLASS: Record<ProspectClass, {
  tier: 0 | 1 | 2 | 3 | 4; method: string; energy: number; hopper: boolean; parts: number;
  /** fixed duration for non-hopper methods */
  timeS: number; data: number;
}> = {
  local: { tier: 0, method: 'lander micro-rover', energy: 60, hopper: false, parts: 0, timeS: 60, data: 20 },
  regional: { tier: 1, method: 'hopper', energy: 60, hopper: true, parts: 5, timeS: 0, data: 30 },
  near: { tier: 2, method: 'hopper', energy: 100, hopper: true, parts: 5, timeS: 0, data: 50 },
  far: { tier: 3, method: 'relay-guided hopper', energy: 150, hopper: true, parts: 10, timeS: 0, data: 80 },
  subsurface: { tier: 4, method: 'radar and seismic', energy: 200, hopper: false, parts: 10, timeS: 300, data: 100 },
};
export const HOPPER = {
  o2Base: 20, o2PerDeg: 1.0, o2Max: 200,
  waterBase: 4, waterPerDeg: 0.2, waterMax: 40,
  timeBase: 60, timePerDeg: 3, timeMax: 420,
};
/** survey data novelty: 1st, 2nd, 3rd-and-later surveyed prospect of a kind */
export const NOVELTY = [1, 0.5, 0.25];
/** anomalies that host no breakthrough pay this much extra, before novelty */
export const ANOMALY_BONUS_DATA = 20;

/** Outposts by class: claim cost, deploy time, parts upkeep, and hopper fuel
 *  per second while live (the link kW is OUTPOST_LINK_KW). */
export const OUTPOST_CLASS: Record<ProspectClass, {
  haul: string;
  cost: Partial<Record<ResourceId, number>>;
  deployS: number;
  upkeepPerDay: number;
  fuel: Partial<Record<ResourceId, number>> | null;
}> = {
  local: { haul: 'rover haul', cost: { metals: 60, parts: 20, chips: 5 }, deployS: 240, upkeepPerDay: 2, fuel: null },
  regional: { haul: 'rover haul', cost: { metals: 60, parts: 20, chips: 5 }, deployS: 240, upkeepPerDay: 2, fuel: null },
  near: { haul: 'hopper', cost: { metals: 100, parts: 30, chips: 10 }, deployS: 360, upkeepPerDay: 3, fuel: { oxygen: 0.02, water: 0.004 } },
  far: { haul: 'relay hopper', cost: { metals: 120, parts: 40, chips: 15 }, deployS: 480, upkeepPerDay: 4, fuel: { oxygen: 0.03, water: 0.006 } },
  subsurface: { haul: 'drill', cost: { metals: 150, parts: 40, chips: 20 }, deployS: 600, upkeepPerDay: 4, fuel: { oxygen: 0.03, water: 0.006 } },
};

/** Outpost streams, sized as a supplement (spec §5b). `data` goes into the
 *  bank; a KREEP outpost streams nothing and is a modifier (computeMods). */
export const OUTPOST_KINDS: Record<OutpostKind, {
  stream: Partial<Record<ResourceId, number>>;
  data?: number;
  modifier?: string;
  sizedAgainst: string;
}> = {
  ice: { stream: { water: 0.20 }, sizedAgainst: '50% of one Ice Harvester' },
  volatiles: { stream: { water: 0.08 }, sizedAgainst: 'about 2 volatile excavators' },
  ilmenite: { stream: { metals: 0.20, oxygen: 0.08 }, sizedAgainst: '32% of a mare smelter, without its 19 kW' },
  glass: { stream: { oxygen: 0.20, water: 0.02 }, sizedAgainst: '64% of a mare smelter’s O₂' },
  silica: { stream: { silicon: 0.15 }, sizedAgainst: '30% of a mare refinery' },
  kreep: {
    stream: {}, modifier: 'reactor upkeep ×0.6 · output ×1.15 · Chip Fab ×1.1',
    sizedAgainst: 'never idle: the chip term covers Fuel Cells runs',
  },
  radio: { stream: {}, data: 0.35, sizedAgainst: 'about 1.6 robotic labs, still under the transfer cap' },
};

/** The widest map view each coverage tier unlocks (T0 opens SITE and VICINITY). */
export const TIER_VIEW: MapView[] = ['vicinity', 'region', 'near', 'far', 'moon'];
/** The tech that raises coverage to each tier (T0 is the landing). */
export const TIER_TECH: (TechId | null)[] = [null, 'prospectingRovers', 'orbitalProspector', 'farSideRelay', 'deepSounding'];

/** what each site lacks, and the outposts that answer it (header of "Next surveyable") */
export const SITE_WEAKNESS: Record<SiteId, string> = {
  mare: 'Ilmenite Plains lacks water → Cabeus or Haworth ice outpost (near side, T2) · Tranquillitatis mature soil (regional)',
  southpole: 'Shackleton lacks metals and launch geometry → Maskelyne or Moltke ilmenite (near side) · pick Propellant Depot',
  lavatube: 'Marius Hills lacks power → Marius Hills domes or Mons Rümker KREEP outpost (reactor upkeep ×0.6, output ×1.15)',
};

/** Basemap maria: projected spherical caps (48 vertices each); a ring is an
 *  extra dashed outline, `outline` draws the whole mare dashed. */
export interface MareDef {
  id: string;
  name: string;
  caps: { lat: number; lon: number; r: number }[];
  ring?: { r: number };
  outline?: true;
}
export const MARE_CAP_VERTICES = 48;
export const MARIA: MareDef[] = [
  { id: 'imbrium', name: 'Imbrium', caps: [{ lat: 32.8, lon: -15.6, r: 18 }] },
  { id: 'serenitatis', name: 'Serenitatis', caps: [{ lat: 28.0, lon: 17.5, r: 11.5 }] },
  { id: 'tranquillitatis', name: 'Tranquillitatis', caps: [{ lat: 8.5, lon: 31.4, r: 14 }] },
  { id: 'crisium', name: 'Crisium', caps: [{ lat: 17.0, lon: 59.1, r: 9 }] },
  { id: 'fecunditatis', name: 'Fecunditatis', caps: [{ lat: -7.8, lon: 51.3, r: 12 }] },
  { id: 'nectaris', name: 'Nectaris', caps: [{ lat: -15.2, lon: 35.5, r: 5.5 }] },
  { id: 'nubium', name: 'Nubium', caps: [{ lat: -21.3, lon: -16.6, r: 11.5 }] },
  { id: 'humorum', name: 'Humorum', caps: [{ lat: -24.4, lon: -38.6, r: 6.5 }] },
  { id: 'vaporum', name: 'Vaporum', caps: [{ lat: 13.3, lon: 3.6, r: 4 }] },
  { id: 'frigoris', name: 'Frigoris', caps: [{ lat: 56, lon: -30, r: 6 }, { lat: 56, lon: 0, r: 6 }, { lat: 56, lon: 30, r: 6 }] },
  { id: 'procellarum', name: 'Procellarum', caps: [{ lat: 30, lon: -50, r: 15 }, { lat: 10, lon: -55, r: 15 }, { lat: 0, lon: -45, r: 12 }] },
  { id: 'orientale', name: 'Orientale', caps: [{ lat: -19.4, lon: -92.8, r: 5 }], ring: { r: 15 } },
  { id: 'moscoviense', name: 'Moscoviense', caps: [{ lat: 27.3, lon: 147.9, r: 4.5 }] },
  { id: 'australe', name: 'Australe', caps: [{ lat: -38.9, lon: 93, r: 10 }] },
  { id: 'smythii', name: 'Smythii', caps: [{ lat: 1.3, lon: 87.3, r: 6 }] },
  { id: 'ingenii', name: 'Ingenii', caps: [{ lat: -33.7, lon: 163.5, r: 4 }] },
  { id: 'spa', name: 'South Pole–Aitken', caps: [{ lat: -53, lon: -169, r: 41 }], outline: true },
];
