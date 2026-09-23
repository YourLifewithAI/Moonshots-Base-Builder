/** Insights (spec S4): "doing it makes it cheaper". One-off research discounts
 *  earned by in-base deeds, checked every tick after research (research.ts
 *  insightTick). They fire even while the tech is locked; Era 1 has none. */
import type { GameState } from '../core/state';
import type { TechId } from './techs';

export interface InsightDef {
  tech: TechId;
  /** fraction off the data cost (capped at INSIGHT_MAX) */
  discount: number;
  /** the deed, shown before it fires: `⚡ Insight: a night brownout (−40%)` */
  hint: string;
  /** the alert's second half: `INSIGHT — Battery Banks 40% cheaper: <lesson>` */
  lesson: string;
  check: (s: GameState) => boolean;
}

const built = (s: GameState, type: string) =>
  s.buildings.some((b) => b.type === type && (b.construction ?? 0) <= 0);
const surveyedOfClass = (s: GameState, cls: string) =>
  Object.values(s.survey.prospects).filter((p) => p?.cls === cls).length;
const activeCount = (s: GameState, type: string) =>
  s.buildings.filter((b) => b.type === type && b.active).length;

export const INSIGHTS: InsightDef[] = [
  // era 2
  { tech: 'batteryStorage', discount: 0.4, hint: 'a night with any load shed',
    lesson: 'a night brownout taught you what storage is worth', check: (s) => s.stats.nightBrownouts >= 1 },
  { tech: 'thermalWadis', discount: 0.4, hint: 'a building held dark ≥60 s at night',
    lesson: 'a machine froze in the dark — keep the heat in the ground', check: (s) => s.stats.darkNightMaxS >= 60 },
  { tech: 'peakLightMasts', discount: 0.4, hint: 'an array shaded ≥60 s',
    lesson: 'the rim’s own shadow ate an array — build above it', check: (s) => s.stats.shadedMaxS >= 60 },
  { tech: 'skylightHeliostats', discount: 0.4, hint: 'a daytime brownout',
    lesson: 'the grid went short at noon — bring the sun down the skylight', check: (s) => s.stats.dayBrownouts >= 1 },
  { tech: 'siliconRefining', discount: 0.3, hint: '150▲ in stock',
    lesson: 'a stockpile of anorthite-rich soil is waiting to be refined', check: (s) => s.resources.regolith >= 150 },
  { tech: 'partsFabrication', discount: 0.4, hint: 'parts below 20',
    lesson: 'the lander cache nearly ran dry — make your own', check: (s) => s.stats.lowPartsSeen },
  { tech: 'constructionRobotics', discount: 0.4, hint: '5 buildings completed',
    lesson: 'five builds taught the robots the routine', check: (s) => s.stats.built >= 5 },
  { tech: 'regolithShielding', discount: 0.4, hint: 'a flare goes active with ≥6 structures running',
    lesson: 'a radiation storm swept an exposed base — bury it', check: (s) => s.stats.flaresWithSix >= 1 },
  { tech: 'moltenElectrolysis', discount: 0.3, hint: '300◆ smelted',
    lesson: 'three hundred smelts mapped the furnace’s limits', check: (s) => s.stats.produced.metals >= 300 },
  { tech: 'ilmeniteBeneficiation', discount: 0.4, hint: 'an excavator digging ilmenite for 60 s',
    lesson: 'the dark basalt smelts richer — separate it at the pit', check: (s) => s.stats.ilmeniteDigS >= 60 },
  // era 3
  { tech: 'thoriumPower', discount: 0.3, hint: '2 nights survived',
    lesson: 'two long nights made the case for baseload', check: (s) => s.nightsSurvived >= 2 },
  { tech: 'regenFuelCells', discount: 0.4, hint: '100≈ banked',
    lesson: 'a tank of water is a battery waiting to be split', check: (s) => s.resources.water >= 100 },
  { tech: 'swarmRobotics', discount: 0.3, hint: '3 sites waiting for robots at once',
    lesson: 'three sites stood idle waiting for hands', check: (s) => s.stats.waitingSitesPeak >= 3 },
  { tech: 'heavyConstructors', discount: 0.3, hint: '3 sites waiting for robots at once',
    lesson: 'three sites stood idle waiting for hands', check: (s) => s.stats.waitingSitesPeak >= 3 },
  { tech: 'dustMitigation', discount: 0.5, hint: 'an array at ≥25% dust',
    lesson: 'a quarter of an array lost to dust', check: (s) => s.stats.maxDust >= 0.25 },
  // era 4
  { tech: 'waferFab', discount: 0.3, hint: '150◇ in stock',
    lesson: 'the silicon is piling up — make wafers of it', check: (s) => s.resources.silicon >= 150 },
  { tech: 'cleanroomRobotics', discount: 0.3, hint: 'first Chip Fab completes',
    lesson: 'the first fab showed where hands spoil wafers', check: (s) => built(s, 'chipFab') },
  { tech: 'orbitalProspector', discount: 0.4, hint: '3 regional prospects surveyed',
    lesson: 'three hopper surveys told the orbiter where to look', check: (s) => surveyedOfClass(s, 'regional') >= 3 },
  // era 5
  { tech: 'lunarDataCenter', discount: 0.4, hint: '6 labs operating',
    lesson: 'six labs saturated the uplink — think on site', check: (s) => activeCount(s, 'lab') >= 6 },
  { tech: 'cryoRadiators', discount: 0.3, hint: 'a Data Center has operated 720 s',
    lesson: 'a full day of racks measured the heat budget', check: (s) => s.stats.dcOpS >= 720 },
  { tech: 'crewWellness', discount: 0.4, hint: 'morale below 50',
    lesson: 'the crew’s mood slipped below half', check: (s) => s.stats.minMorale < 50 },
  // era 6
  { tech: 'humanCohabitation', discount: 0.4, hint: '2 consecutive clean nights',
    lesson: 'two nights without a dark load — the base is ready for people', check: (s) => s.stats.cleanNightStreak >= 2 },
  { tech: 'closedLoopLS', discount: 0.4, hint: 'a life-support reserve under 5 min',
    lesson: 'a reserve ran under five minutes — recycle it', check: (s) => s.stats.minReserveS < 300 },
  { tech: 'safetyProtocols', discount: 0.5, hint: 'a building worn past 0.3',
    lesson: 'a machine wore out before anyone noticed', check: (s) => s.stats.wornSeen },
  { tech: 'scienceCrews', discount: 0.25, hint: '6 crew aboard',
    lesson: 'six people aboard, and some of them are scientists', check: (s) => s.crew >= 6 },
  { tech: 'farSideRelay', discount: 0.4, hint: '3 near-side prospects surveyed',
    lesson: 'the near side is mapped — the far side is next', check: (s) => surveyedOfClass(s, 'near') >= 3 },
  // era 7
  { tech: 'foilManufacturing', discount: 0.3, hint: '250◇ in stock',
    lesson: 'enough silicon for a first run of foils', check: (s) => s.resources.silicon >= 250 },
  { tech: 'massDriver', discount: 0.3, hint: '400◆ banked',
    lesson: 'four hundred tonnes of rail metal on hand', check: (s) => s.resources.metals >= 400 },
  { tech: 'propellantDepot', discount: 0.4, hint: '300≈ banked',
    lesson: 'a reservoir of water is a reservoir of propellant', check: (s) => s.resources.water >= 300 },
  { tech: 'selfReplication', discount: 0.3, hint: 'a fleet of 8 robots',
    lesson: 'eight robots are enough to build the ninth', check: (s) => s.bots.total >= 8 },
  { tech: 'deepSounding', discount: 0.4, hint: 'a far-side prospect surveyed',
    lesson: 'the far side answered back — listen deeper', check: (s) => surveyedOfClass(s, 'far') >= 1 },
  // era 8 — the single map-derived insight
  { tech: 'swarmProtocol', discount: 0.25, hint: 'ATLAS COMPLETE',
    lesson: 'the survey net becomes the swarm’s tracking-and-timing network', check: (s) => s.survey.atlas },
];

export const INSIGHT_BY_TECH: Partial<Record<TechId, InsightDef>> =
  Object.fromEntries(INSIGHTS.map((i) => [i.tech, i]));
