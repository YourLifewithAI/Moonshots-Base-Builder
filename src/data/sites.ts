/** Landing sites. Three of the five designed sites ship in the slice —
 *  chosen for maximum strategic contrast (see docs/05-sites.md for all five).
 *  Every modifier is a real lunar trade-off expressed mechanically. */

export type SiteId = 'southpole' | 'mare' | 'lavatube';

export interface SiteDef {
  id: SiteId;
  name: string;
  place: string;
  blurb: string;
  /** solar output multiplier during the lunar day */
  solarDayMult: number;
  /** fraction of solar output that persists through the night (peaks of eternal light) */
  nightSolarFraction: number;
  hasIce: boolean;
  isruMult: number;        // extraction/refining output multiplier
  buildCostMult: number;
  launchMult: number;      // mass-driver efficiency (equatorial advantage)
  flareImmune: boolean;    // lava tube shielding
  upkeepMult: number;      // thermal stability discount
  moraleBase: number;      // baseline morale target
  /** buildable-footprint constraint (lava tube): radius in meters from map center, or 0 = whole map */
  buildableRadiusM: number;
  terrain: { roughness: number; craterCount: number; craterMaxD: number; skylight: boolean };
  /** x/5 ratings for the site-select card — identical dimensions across sites */
  ratings: { solar: number; ice: number; isru: number; launch: number; safety: number; terrain: number };
  pros: string[];
  cons: string[];
  difficulty: string;
}

export const SITES: Record<SiteId, SiteDef> = {
  southpole: {
    id: 'southpole',
    name: 'SHACKLETON RIM',
    place: 'South Pole · 89.9°S',
    blurb: 'A ridge of near-eternal light above craters of eternal dark. Water ice below, sunlight almost always — but the equator, and easy launches, are far away.',
    solarDayMult: 1.0,
    nightSolarFraction: 0.85,
    hasIce: true,
    isruMult: 1.0,
    buildCostMult: 1.25,
    launchMult: 0.6,
    flareImmune: false,
    upkeepMult: 1.0,
    moraleBase: 62,
    buildableRadiusM: 0,
    terrain: { roughness: 1.5, craterCount: 26, craterMaxD: 180, skylight: false },
    ratings: { solar: 5, ice: 5, isru: 3, launch: 2, safety: 3, terrain: 2 },
    pros: ['Near-continuous sunlight — the night barely bites', 'Local water ice: hydroponics and life support thrive'],
    cons: ['Rough polar terrain: +25% build costs', 'Mass driver efficiency only 60% — the endgame is a grind'],
    difficulty: 'EASY START · SLOW FINISH',
  },
  mare: {
    id: 'mare',
    name: 'ILMENITE PLAINS',
    place: 'Mare Tranquillitatis · 0.8°N',
    blurb: 'Flat, iron-rich basalt on the equator. The best mines and the best launch site on the Moon — and a 14-day night that will try to kill you every cycle.',
    solarDayMult: 1.0,
    nightSolarFraction: 0.0,
    hasIce: false,
    isruMult: 1.25,
    buildCostMult: 0.8,
    launchMult: 1.5,
    flareImmune: false,
    upkeepMult: 1.0,
    moraleBase: 58,
    buildableRadiusM: 0,
    terrain: { roughness: 0.45, craterCount: 10, craterMaxD: 90, skylight: false },
    ratings: { solar: 3, ice: 0, isru: 5, launch: 5, safety: 2, terrain: 5 },
    pros: ['Ilmenite-rich regolith: +25% extraction and smelting', 'Equatorial mass driver: 150% launch efficiency, −20% build costs'],
    cons: ['Full lunar night: zero solar for 14 days — stockpile or die', 'No water ice: food from stores until closed-loop tech'],
    difficulty: 'BRUTAL NIGHTS · EXPORT POWERHOUSE',
  },
  lavatube: {
    id: 'lavatube',
    name: 'MARIUS HILLS TUBE',
    place: 'Oceanus Procellarum · 14.1°N',
    blurb: 'A collapsed skylight into an intact lava tube. Constant 17°C, no radiation, no micrometeorites — a fortress. But the sun is a rumor down here.',
    solarDayMult: 0.7,
    nightSolarFraction: 0.0,
    hasIce: false,
    isruMult: 0.9,
    buildCostMult: 1.2,
    launchMult: 1.0,
    flareImmune: true,
    upkeepMult: 0.85,
    moraleBase: 72,
    buildableRadiusM: 220,
    terrain: { roughness: 0.8, craterCount: 14, craterMaxD: 110, skylight: true },
    ratings: { solar: 2, ice: 0, isru: 3, launch: 3, safety: 5, terrain: 3 },
    pros: ['Immune to solar flares; thermal stability cuts upkeep 15%', 'Sheltered crew: highest baseline morale on the Moon'],
    cons: ['Only 70% solar throughput reaches the grid', 'Constrained buildable footprint around the skylight'],
    difficulty: 'SAFE HARBOR · ENERGY POOR',
  },
};

export const SITE_ORDER: SiteId[] = ['southpole', 'mare', 'lavatube'];
