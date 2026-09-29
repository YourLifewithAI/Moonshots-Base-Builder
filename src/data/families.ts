/** Building families and their accent colours (docs/19, improvement 4): the
 *  one accent colour per family that the cel look paints on trim, the palette
 *  tabs carry, and the units wear. `FAMILY_OF` matches the palette tabs
 *  (`BuildingDef.category`); `logistics` is reserved for roads, rovers and
 *  the fleet (no building is filed under it yet). Colours are sRGB as
 *  authored, as CLASSIC_PALETTE's are; `FAMILY_CSS` is the same as CSS hex.
 *
 *  Contract stream W0d: read-only for the look (S1a) and the models (S2a). */
import type { BuildingId } from './buildings';
import type { UnitType } from './hubs';

export type Family = 'power' | 'extraction' | 'industry' | 'life' | 'science' | 'export' | 'logistics';

export const FAMILIES: readonly Family[] = ['power', 'extraction', 'industry', 'life', 'science', 'export', 'logistics'];

/** Every building's family: its palette tab. (A Record, so a new building must be filed here.) */
export const FAMILY_OF: Record<BuildingId, Family> = {
  lander: 'life',
  solar: 'power', battery: 'power', reactor: 'power',
  excavator: 'extraction', smelter: 'extraction', iceHarvester: 'extraction', refinery: 'extraction',
  waterPlant: 'extraction', iceMiner: 'extraction',
  storageYard: 'industry', roboticsBay: 'industry', partsFab: 'industry', chipFab: 'industry', droneHive: 'industry',
  habitat: 'life', hydroponics: 'life', recDome: 'life', greenhouseRing: 'life', gardenDome: 'life',
  lab: 'science', dataCenter: 'science', relayMast: 'science', solarObservatory: 'science', serverMonolith: 'science',
  foilFactory: 'export', massDriver: 'export', propellantPlant: 'export',
};

/** The family accent, as a 0xRRGGBB number (the initial palette; S1a may tune it). */
export const FAMILY_ACCENT: Record<Family, number> = {
  power: 0xe8b422,
  extraction: 0xd9772b,
  industry: 0x7a5cc7,
  life: 0x5f9f3f,
  science: 0x2f7fd0,
  export: 0xc9302c,
  logistics: 0x8e9197,
};

/** `0xd9772b` → `'#d9772b'` */
export const cssHex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

export const FAMILY_CSS: Record<Family, string> = Object.fromEntries(
  FAMILIES.map((f) => [f, cssHex(FAMILY_ACCENT[f])]),
) as Record<Family, string>;

/** What a moving thing is, for its accent: the two hub units, the construction
 *  rover, the Drone Hive's drone, the survey drone, the EVA crew. */
export type UnitClass = UnitType | 'rover' | 'drone' | 'surveyDrone' | 'crew';

export const UNIT_ACCENT: Record<UnitClass, number> = {
  excavator: FAMILY_ACCENT.extraction,
  iceMiner: 0x3bb6c9,
  rover: FAMILY_ACCENT.logistics,
  drone: FAMILY_ACCENT.industry,
  surveyDrone: 0x2fb3a6,
  crew: FAMILY_ACCENT.life,
};

/** A hub unit's mesh key: its type and its hub's kind (a legacy excavator building: 'pad').
 *  world/haulers.ts draws one InstancedMesh per key, in this order. A water
 *  plant prints ice miners on the ice and excavators elsewhere. */
export const UNIT_KEYS = [
  'excavator:pad', 'excavator:smelter', 'excavator:refinery', 'excavator:waterPlant', 'iceMiner:waterPlant',
] as const;
export type UnitKey = typeof UNIT_KEYS[number];

/** The key of a unit printed at a hub (`'pad'`: a legacy excavator building). */
export const unitKey = (type: UnitType, hub: BuildingId | 'pad'): UnitKey => `${type}:${hub}` as UnitKey;

/** A digger's livery: its body and the band that carries the accent. */
export interface Livery { body: number; band: number }

/** Per (unit type, hub): the smelter's digger (open bucket, ochre band), the
 *  refinery's (covered hopper, quartz-white body, violet band), the ice miner
 *  (cyan, tank). Keys not listed (a water plant's excavator, a legacy pad)
 *  wear `LIVERY_DEFAULT`. */
export const HUB_LIVERY: Partial<Record<UnitKey, Livery>> = {
  'excavator:smelter': { body: 0xebe6dc, band: FAMILY_ACCENT.extraction },
  'excavator:refinery': { body: 0xf4f3ee, band: FAMILY_ACCENT.industry },
  'iceMiner:waterPlant': { body: 0x5fc4d6, band: UNIT_ACCENT.iceMiner },
};

export const LIVERY_DEFAULT: Livery = { body: 0xebe6dc, band: FAMILY_ACCENT.extraction };

export const liveryOf = (k: UnitKey): Livery => HUB_LIVERY[k] ?? LIVERY_DEFAULT;
