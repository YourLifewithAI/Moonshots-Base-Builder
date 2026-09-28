/** Evidence for real precursors, not a claim that the game's lunar industry exists.
 *  Maturity describes the specific capability in the linked source. Dates record
 *  editorial verification, not publication. Keep economics and game bonuses in
 *  techs.ts; this layer explains what remains between a precursor and the Moon. */
import type { TechId } from './techs';

export type EvidenceMaturity = 'commercial' | 'ground-demo' | 'flight-demo' | 'concept';

export interface EvidenceSource {
  company: string;
  country: string;
  url: string;
  title: string;
  maturity: EvidenceMaturity;
  verified: string;
}

export interface TechEvidence {
  whatExists: string;
  lunarGap: string;
  abstraction: string;
  sources: readonly EvidenceSource[];
}

export const EVIDENCE_MATURITY_LABEL: Record<EvidenceMaturity, string> = {
  commercial: 'Commercial on Earth',
  'ground-demo': 'Ground demonstration',
  'flight-demo': 'Demonstrated in space',
  concept: 'Concept / development',
};

const VERIFIED = '2026-09-27';
const source = (company: string, country: string, title: string, url: string, maturity: EvidenceMaturity): EvidenceSource =>
  ({ company, country, title, url, maturity, verified: VERIFIED });

const S = {
  mining: source('Epiroc', 'Sweden', 'Battery-electric underground mining trucks',
    'https://www.epiroc.com/en/products/loaders-and-trucks/electric-trucks', 'commercial'),
  charging: source('Epiroc', 'Sweden', 'Mining electrification and charging infrastructure',
    'https://www.epiroc.com/en/products/electrification-solutions/infrastructure-solutions', 'commercial'),
  autonomy: source('Epiroc', 'Sweden', 'Underground-to-surface autonomous hauling demonstration',
    'https://www.epiroc.com/en-pl/newsroom/2026/epiroc-deep-automation-introduces-seamless-underground-to-surface-truck-automation-with-3d-lidar-technology', 'ground-demo'),
  hardfacing: source('SSAB', 'Sweden', 'Duroxite wear overlays for mining equipment',
    'https://www.ssab.com/en/brands-and-products/duroxite/industries/mining', 'commercial'),
  machining: source('DMG MORI', 'Japan / Germany', 'LASERTEC 65 DED hybrid manufacturing',
    'https://en.dmgmori.com/products/machines/additive-manufacturing/powder-nozzle/lasertec-65-ded-hybrid-2nd', 'commercial'),
  inspection: source('ANYbotics', 'Switzerland', 'ANYmal autonomous industrial inspection',
    'https://www.anybotics.com/robotics/anymal/', 'commercial'),
  storage: source('SSI SCHAEFER', 'Germany', 'Automated storage and retrieval systems',
    'https://www.ssi-schaefer.com/en-gb/products/storage/automated-storage', 'commercial'),
  drillGround: source('Honeybee Robotics · NASA test report', 'United States', 'TRIDENT field and laboratory drilling tests',
    'https://ntrs.nasa.gov/citations/20240006512', 'ground-demo'),
  drillFlight: source('Honeybee Robotics · NASA mission report', 'United States', 'TRIDENT mechanism tests on the Moon',
    'https://www.nasa.gov/missions/artemis/nasas-lunar-drill-technology-passes-tests-on-the-moon/', 'flight-demo'),
  lifeSupport: source('Collins Aerospace', 'United States', 'Environmental control and life support systems',
    'https://www.collinsaerospace.com/-/media/CA/product-assets/marketing/e/eclss-data-sheet.pdf?rev=6d71b8c702964081ae99da5c24107c8f', 'flight-demo'),
  electrolysis: source('Nel Hydrogen', 'Norway', 'Industrial PEM and alkaline water electrolysers',
    'https://nelhydrogen.com/resources/electrolysers-brochure/', 'commercial'),
  blueAlchemist: source('Blue Origin', 'United States', 'Blue Alchemist: solar cells and metals from regolith simulant',
    'https://www.blueorigin.com/news/blue-alchemist-powers-our-lunar-future', 'ground-demo'),
  carbothermal: source('Sierra Space', 'United States', 'Regolith oxygen extraction in a ground thermal-vacuum chamber',
    'https://www.sierraspace.com/press-releases/sierra-space-unveils-breakthrough-technology-designed-to-extract-oxygen-from-lunar-soil/', 'ground-demo'),
  pilot: source('Sierra Space', 'United States', 'PILOT carbothermal system: water as an oxygen-processing intermediate',
    'https://www.sierraspace.com/wp-content/uploads/2024/01/Advanced_Life_Support_Systems-Carbothermal_Reduction_System_PILOT.pdf', 'ground-demo'),
  lunarSurvey: source('NASA · public mission', 'United States', 'Lunar Prospector composition mapping from orbit',
    'https://science.nasa.gov/mission/lunar-prospector/', 'flight-demo'),
  asteroidSurvey: source('AstroForge', 'United States', 'Odin mission debrief: asteroid reconnaissance remains unfinished',
    'https://www.astroforge.com/updates-collection/odint-mission-debrief', 'concept'),
  farming: source('Freight Farms / Growcer', 'United States / Canada', 'Greenery controlled-environment hydroponic farm',
    'https://www.freightfarms.com/greenery', 'commercial'),
  growcer: source('Growcer', 'Canada', 'Freight Farms continues under Growcer',
    'https://www.freightfarms.com/news/growcer-acquires-freight-farms-opening-a-new-chapter-for-modular-farming', 'commercial'),
  habitat: source('Sierra Space', 'United States', 'LIFE expandable habitat and ground pressure testing',
    'https://www.sierraspace.com/commercial-space-stations/life-space-habitat/', 'ground-demo'),
  lithography: source('ASML', 'Netherlands', 'Dry and immersion DUV lithography systems',
    'https://www.asml.com/en/products/duv-lithography-systems', 'commercial'),
  foundry: source('TSMC', 'Taiwan', '28 nm semiconductor volume production',
    'https://pr.tsmc.com/schinese/news/1689', 'commercial'),
  cooling: source('LiquidStack', 'United States / Netherlands', 'CDU-1MW direct-to-chip liquid cooling',
    'https://liquidstack.com/coolant-distribution-unit-1-megawatt', 'commercial'),
  solarMast: source('Astrobotic', 'United States', 'VOLT mobility, stability and Sun-tracking ground tests',
    'https://www.astrobotic.com/astrobotics-mobile-lunar-power-asset-completes-surface-stability-testing/', 'ground-demo'),
  solarWings: source('Redwire', 'United States', 'Roll-Out Solar Arrays operating on the ISS',
    'https://rdw.com/newsroom/redwires-roll-out-solar-array-technology-successfully-installed/', 'flight-demo'),
  fuelCells: source('Honda / Astrobotic', 'Japan / United States', 'Regenerative fuel cells for lunar power: integration study',
    'https://www.astrobotic.com/honda-and-astrobotic-establish-joint-development-agreement-to-explore-scalable-lunar-power-solutions/', 'concept'),
  beaming: source('Caltech · research institution', 'United States', 'MAPLE wireless power demonstration in orbit',
    'https://www.caltech.edu/about/news/space-solar-power-project-ends-first-in-space-mission-with-successes-and-lessons', 'flight-demo'),
};

export const EVIDENCE: Partial<Record<TechId, TechEvidence>> = {
  regolithProcessing: {
    whatExists: 'Electric mining trucks already move ore and rock in working Earth mines.',
    lunarGap: 'Lunar pits need tested traction, dust seals, thermal control and power systems for vacuum and low gravity.',
    abstraction: 'Pit Mapping compresses survey interpretation and route planning into one travel upgrade.',
    sources: [S.mining],
  },
  bayExtensions: {
    whatExists: 'Epiroc supplies charging infrastructure and helps design dedicated mining charge bays.',
    lunarGap: 'A lunar bay must reject heat without outside air and keep abrasive dust out of connectors and service tools.',
    abstraction: 'One bay purchase bundles the charger, controls and workshop space needed for another unit.',
    sources: [S.charging],
  },
  hardfacedTeeth: {
    whatExists: 'SSAB sells hardfacing overlays that protect bucket lips, dozer blades, chutes and other mining wear surfaces.',
    lunarGap: 'Cutting edges need wear and fracture tests in sharp lunar soil, vacuum and repeated temperature cycles.',
    abstraction: 'Faster filling and higher upkeep represent a chosen cutting regime, not a measured lunar product specification.',
    sources: [S.hardfacing],
  },
  roverPowerPacks: {
    whatExists: 'Battery-electric mining machines and their charging infrastructure are commercial products.',
    lunarGap: 'Lunar packs require temperature regulation, radiation-aware electronics and a dependable recharge plan.',
    abstraction: 'Packs cover unserved grid loads. The game does not model a physical cable to each moving machine.',
    sources: [S.charging],
  },
  autoExcavation: {
    whatExists: 'Epiroc demonstrated a battery-electric truck autonomously navigating between underground and surface operations in 2026.',
    lunarGap: 'Autonomy must handle unfamiliar lunar terrain and recover without a nearby human maintenance crew.',
    abstraction: 'The Builder buys another machine from a demand rule; autonomous hauling alone does not manufacture new robots.',
    sources: [S.autonomy],
  },
  autonomousHaulage: {
    whatExists: 'LiDAR localization and obstacle detection already support autonomous mine hauling demonstrations on Earth.',
    lunarGap: 'Lunar navigation needs reliable sensing in harsh lighting, dust and terrain with few familiar landmarks.',
    abstraction: 'The haul bonus bundles routing, loading and vehicle improvements into one upgrade.',
    sources: [S.autonomy],
  },
  partsFabrication: {
    whatExists: 'DMG MORI combines metal deposition and precision machining in a commercial hybrid machine.',
    lunarGap: 'A lunar workshop still needs suitable feedstock, tooling, metrology, process gases and reliable spare parts.',
    abstraction: 'Parts stand for many components. A fabricator cannot make every seal, bearing or electronic device from bulk metal.',
    sources: [S.machining],
  },
  moltenElectrolysis: {
    whatExists: 'Blue Origin extracted metals and oxygen from regolith simulant by molten electrolysis on Earth. Sierra Space tested a different, carbothermal oxygen process in a thermal-vacuum chamber in 2024.',
    lunarGap: 'Neither result is lunar production. Long-duration feed handling, reactor wear, power supply and heat rejection still need lunar qualification.',
    abstraction: 'Fixed yields and feed independence simplify real chemistry. Carbothermal reduction is an alternative process, not proof of the electrolysis recipe.',
    sources: [S.blueAlchemist, S.carbothermal],
  },
  siliconRefining: {
    whatExists: 'Blue Alchemist reported silicon above 99.999% purity and solar-cell fabrication from regolith simulant in its Earth laboratory.',
    lunarGap: 'Solar-cell material does not establish the purity and process control needed for integrated-circuit wafers or a lunar chip supply chain.',
    abstraction: 'One silicon inventory merges several purity grades; the linked result does not validate the game’s wafer-grade refinery.',
    sources: [S.blueAlchemist],
  },
  toolChangers: {
    whatExists: 'Hybrid machine tools integrate several additive and subtractive processes in one production cell.',
    lunarGap: 'Tool storage, alignment and inspection must stay clean and serviceable through long lunar operations.',
    abstraction: 'The throughput bonus represents less setup time across many jobs, rather than a universal increase in cutting speed.',
    sources: [S.machining],
  },
  depotHalls: {
    whatExists: 'Automated warehouses move and retrieve parts; hybrid machine tools can add and machine metal features.',
    lunarGap: 'Combining these into a lunar service hall requires assembly, inspection and imported components that cannot yet be made locally.',
    abstraction: 'Printing a complete unit bundles fabrication and assembly. The depot is not a demonstrated self-replicating factory.',
    sources: [S.storage, S.machining],
  },
  predictiveMaintenance: {
    whatExists: 'ANYmal robots inspect industrial plants using visual, thermal and other sensors.',
    lunarGap: 'Sensors, mobility and failure models need lunar qualification; an Earth inspection robot is not a lunar rover.',
    abstraction: 'Lower upkeep represents earlier fault detection and planned servicing, not machines that never fail.',
    sources: [S.inspection],
  },
  iceExtraction: {
    whatExists: 'Honeybee’s TRIDENT drill operated its rotation, extension, percussion and heater mechanisms on the Moon during IM-2.',
    lunarGap: 'The short mission did not demonstrate extracting a usable supply of lunar ice. Bulk mining and volatile capture remain major steps.',
    abstraction: 'The Ice Miner assumes a characterized deposit and a working extraction process; continuous water production is a future capability.',
    sources: [S.drillFlight],
  },
  deepCoring: {
    whatExists: 'A TRIDENT engineering model has drilled terrestrial lunar-analog terrain and collected subsurface information.',
    lunarGap: 'A metre-class sampling drill does not establish industrial bedrock excavation, deep reserves or economical lunar mining.',
    abstraction: 'Reopening two benches bundles geological investigation, rock breaking and extraction into one milestone.',
    sources: [S.drillGround],
  },
  waterReclamation: {
    whatExists: 'Collins life-support hardware has spaceflight heritage in water processing and cabin environmental control.',
    lunarGap: 'A settlement must manage contaminants, waste streams, replacement filters and incomplete recovery with limited resupply.',
    abstraction: 'A fixed recovery fraction summarizes several treatment stages; water is conserved, not created from nothing.',
    sources: [S.lifeSupport],
  },
  waterElectrolysis: {
    whatExists: 'Nel sells water electrolysers. Sierra Space’s ground-tested PILOT process also forms water as an intermediate, then electrolyzes it to recover oxygen from minerals.',
    lunarGap: 'Lunar operation adds feedwater purification, gas separation and thermal management. PILOT’s reaction water is not evidence of mining lunar ice.',
    abstraction: 'One plant setting bundles the equipment. Oxygen production consumes water and power; hydrogen handling is simplified.',
    sources: [S.electrolysis, S.pilot],
  },
  closedLoopLS: {
    whatExists: 'Collins offers staged life-support loops with flight-proven air and water management components.',
    lunarGap: 'A fully independent settlement still needs consumables, maintenance, nutrient supplies and contingency reserves.',
    abstraction: 'Reduced inputs represent partial loop closure, not a perfectly sealed ecosystem with zero losses.',
    sources: [S.lifeSupport],
  },
  growLights: {
    whatExists: 'Freight Farms sells controlled-environment hydroponic farms with artificial lighting and automated growing systems.',
    lunarGap: 'Lunar crops need pressure, reliable power, radiation protection, nutrients and suitable root-zone conditions.',
    abstraction: 'One food rate combines crop cycles, edible yield and harvest labor; salad crops alone do not supply a complete diet.',
    sources: [S.farming],
  },
  nutrientRecirculation: {
    whatExists: 'Greenery farms use a closed-loop hydroponic system; Freight Farms now operates under Canada’s Growcer.',
    lunarGap: 'A lunar farm must control pathogens and nutrient balance while replacing unavoidable water and nutrient losses.',
    abstraction: 'Lower water demand summarizes filtration, dosing and return plumbing rather than a lossless nutrient cycle.',
    sources: [S.farming, S.growcer],
  },
  humanCohabitation: {
    whatExists: 'Sierra Space has ground-tested full-scale expandable habitat pressure structures. Collins supplies life-support hardware with spaceflight heritage.',
    lunarGap: 'A lunar home must integrate shielding, dust control, power, waste treatment and long-term human health provisions.',
    abstraction: 'One unlock combines many qualification steps; a pressure-shell test is not an occupied lunar habitat.',
    sources: [S.habitat, S.lifeSupport],
  },
  pressureHalls: {
    whatExists: 'The LIFE habitat program has tested expandable pressure shells at full scale on Earth.',
    lunarGap: 'Surface foundations, shielding loads, dust-resistant airlocks and maintainable utilities still need integration.',
    abstraction: 'Housing capacity is a gameplay measure; ground pressure testing alone does not validate a complete settlement.',
    sources: [S.habitat],
  },
  waferFab: {
    whatExists: 'ASML supplies lithography equipment and TSMC manufactures chips at industrial scale on Earth.',
    lunarGap: 'Lunar fabs need ultrapure feedstocks, controlled cleanrooms, precision tools, process chemicals and a large support supply chain.',
    abstraction: 'Silicon and power summarize that supply chain. Lunar vacuum does not make dusty ground a cleanroom.',
    sources: [S.lithography, S.foundry],
  },
  immersionLitho: {
    whatExists: 'ASML’s commercial immersion DUV tools use liquid between the optics and wafer for semiconductor patterning.',
    lunarGap: 'Ultrapure water, contamination control, nanometre alignment and thermal stability must survive lunar operation.',
    abstraction: 'One yield bonus summarizes a coordinated manufacturing process, not simply pouring water onto a wafer.',
    sources: [S.lithography],
  },
  orbitalProspector: {
    whatExists: 'NASA’s Lunar Prospector mapped lunar composition from orbit. AstroForge launched Odin toward an asteroid in 2025, but lost contact early and did not complete its planned reconnaissance.',
    lunarGap: 'Orbital composition maps still need local sampling to establish mineable deposits. AstroForge’s development program has not demonstrated commercial asteroid mining.',
    abstraction: 'Surveying instantly reveals detailed deposits. Odin illustrates the communications and navigation challenge; it was not a lunar survey orbiter.',
    sources: [S.lunarSurvey, S.asteroidSurvey],
  },
  lunarDataCenter: {
    whatExists: 'LiquidStack supplies deployed direct-to-chip cooling systems for high-density computing on Earth.',
    lunarGap: 'A lunar facility must shield its electronics, handle dust and reject waste heat through an external radiator system.',
    abstraction: 'Compute becomes research data. Cooling hardware moves heat; it does not make a lunar data center automatically economical.',
    sources: [S.cooling],
  },
  liquidCooling: {
    whatExists: 'Commercial coolant distribution units circulate liquid through cold plates at heat-producing chips.',
    lunarGap: 'Lunar loops need leak-resistant plumbing and radiators with a useful view of cold space.',
    abstraction: 'Reduced electricity demand represents cooling efficiency. The processor’s waste heat still has to leave the base.',
    sources: [S.cooling],
  },
  peakLightMasts: {
    whatExists: 'Astrobotic ground-tested VOLT’s mobile base, stability, gimbal and Sun tracking on inclined lunar-soil simulant.',
    lunarGap: 'Deployment, structural loads, dust and real terrain shadows must be validated on the lunar surface.',
    abstraction: 'Shade immunity simplifies raising panels above local obstructions; a mast cannot guarantee uninterrupted sunlight.',
    sources: [S.solarMast],
  },
  wingExtensions: {
    whatExists: 'Redwire’s flexible Roll-Out Solar Arrays have deployed and generated power on the International Space Station.',
    lunarGap: 'Manufacturing cells from lunar materials and keeping surface arrays clean are separate, unproven industrial steps.',
    abstraction: 'Extra wing output combines more collecting area and local fabrication; orbital deployment does not prove lunar manufacture.',
    sources: [S.solarWings],
  },
  foilManufacturing: {
    whatExists: 'Blue Origin demonstrated solar cells, cover glass and transmission wire from regolith simulant on Earth; Redwire has deployed flexible solar arrays in orbit.',
    lunarGap: 'These are separate precursors. Neither demonstrates lunar production of ultralight collector foils or their survival in a large solar swarm.',
    abstraction: 'A single foil factory bundles refining, deposition, handling and quality control for an industry that does not yet exist.',
    sources: [S.blueAlchemist, S.solarWings],
  },
  regenFuelCells: {
    whatExists: 'Honda and Astrobotic announced an integration study pairing regenerative fuel cells with lunar solar-power infrastructure.',
    lunarGap: 'The integrated lunar system must demonstrate efficiency, storage, lifetime and reliable operation through long darkness.',
    abstraction: 'The research choice assumes that future integration succeeds; the linked study is not an operating lunar power plant.',
    sources: [S.fuelCells, S.electrolysis],
  },
  powerBeaming: {
    whatExists: 'Caltech’s MAPLE experiment demonstrated wireless power transfer in orbit and a signal detectable on Earth.',
    lunarGap: 'Useful power over much greater distances requires major advances in aperture size, pointing, efficiency and infrastructure.',
    abstraction: 'Instant power per launched volley extrapolates far beyond this small demonstration; no Dyson swarm has been built.',
    sources: [S.beaming],
  },
};
