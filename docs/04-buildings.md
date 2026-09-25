# 04 · Buildings

The full roster: **30 building designs plus the pre-placed Lander**. The slice
ships **14** of them (with two research designs merged into one shipped
building). For shipped buildings, `src/data/buildings.ts` is canonical — costs,
footprints, rates, and the exact pro/con strings. Cut buildings carry design
intent only; their numbers are targets for the balancing pass when they land.

## How every building works

- **Everything pulls and gives.** Every building draws power and/or resources
  and contributes something economic *or* social — and carries one honest pro
  and one honest con (pillar 1). The UI tooltip shows all of it, always.
- **Rates** are per game-second; **parts upkeep** (`upkeepParts`) is per lunar
  day — the universal maintenance sink (02).
- **Crew seats** (`crew`): under-crewed buildings idle.
- **Brownout priority** (0–3): under power shortage the grid sheds priority 3
  first (labs), then industry, then food, and life support (0) last. Idling
  only priority 2–3 loads is a *load shed* (morale −3); a dark priority 0–1
  load is a *brownout* (morale −15). Construction sites weld (4 kW per
  working rover) at their building's priority, after running loads of the
  same priority; a site held dark is shed load, never a brownout.
- **Construction**: auto rovers take one site each, in placement order unless
  *Build next* moves a queued site to the front. A shut-down site pauses and
  frees its auto rover. More rovers on one site — *Summon* at the site, or
  *Send to…* from a selected rover, each pinned until the site is built —
  build n^0.85 faster on the same weld parts (02, the construction fleet).
  Demolition refunds half the site-scaled price paid, or all of it for a site
  no rover has touched.
- **Placement**: 4 m grid cells, within 60 m of the Lander or any Habitat
  (coverage model, Cities: Skylines — no wires, no pipes).

**Status key:** **S** shipped · **C** cut · **M** merged into a shipped building.

Format, one row per building: *inputs → outputs | secondary effect | pro | con*.

## Power

| Building (Era) | St | Inputs → Outputs | Secondary effect | Pro | Con |
|---|---|---|---|---|---|
| Solar Array (1) | S | — → +10 kW, scaled by sun | Dust-degraded: −8%/lunar day uncleaned, cap −50% | Cheap, silent power that scales with your ambition | Dead all lunar night; regolith dust slowly chokes its output |
| Battery Bank (2) | S | stores 3,000 energy units | 85% round-trip efficiency | Sunlight in a box: 3,000 stored units against the fourteen-day dark | 15% of everything you store is lost to the round trip |
| Thorium Reactor (3) | S | 1 crew → +40 kW, constant | Morale −5 nearby; 4 parts/day upkeep (highest on the base) | Forty kilowatts that do not care whether the sun is up | Nobody sleeps well beside a reactor — and it eats parts like a fleet of rovers |
| Radiator Field (3) | C | — → heat rejection capacity | Required (design target) by reactor/foundry clusters; airless Moon rejects heat by radiation only | The cheap panel field that lets dense industry exist at all | A wide, fragile footprint that produces nothing and blocks buildable ground |

## Extraction & refining

| Building (Era) | St | Inputs → Outputs | Secondary effect | Pro | Con |
|---|---|---|---|---|---|
| Regolith Excavator (1) | S | no crew (teleoperated from the start), −6 kW → a 105-regolith bucket per haul (≈1.5/s dug 15 m from its consumer) | A mobile digger: its pad is home; *Dig at…* sends it to any revealed deposit or mapped ground, and it hauls each bucket to the nearest smelter or refinery (the Lander if none), credited on unload — far ground delivers less but sets a richer feed. Highest dust wear on the base (halved by Dust Mitigation) | Feeds every industry on the Moon | Thrown dust abrades everything — the highest parts wear on the base |
| Ice Harvester (1) | S | 1 crew, −8 kW → 0.4 water/s | Ice sites only (`requiresIce`) | Water from permanently shadowed ice — the pole's great gift | Useless anywhere without polar ice deposits |
| HRI Ilmenite Reduction Plant (1) | M | regolith (ilmenite-rich) → iron/titanium + **oxygen** | The oxygen-rich half of the merged Smelter; strongest on mare sites | Breathes for the base as a side effect of making metal | Feeble on ilmenite-poor highland and KREEP regolith |
| MRE Electrolyzer (2) | M | any regolith + heavy power → metals + oxygen trickle | The site-agnostic half of the merged Smelter | Eats any dirt on the Moon — no geology required | Power cost per ton is brutal; the night hits it first |
| **Regolith Smelter** (1) | S | 2 crew, −12 kW, 2 regolith/s → 0.5 metals + 0.25 oxygen + 0.05 water/s | The slice's **only oxygen source**, and the only water on iceless sites — industry keeps you alive | Ilmenite gives threefold: metals, oxygen, and a trickle of water | A furnace on the grid: the night hits it first |
| Silicon Refinery (2) | S | 2 crew, −14 kW, 2 regolith/s → 0.4 silicon/s | Feeds solar, foils — the whole endgame | Silicon for panels and foils — the whole endgame flows through here | The hungriest machine of the mid-game grid |
| Rare-Earth Extractor (3) | C | crew, power, regolith → rare earths + thorium | KREEP-terrane sites only (05); feeds Electronics + reactor fuel | Unlocks the one supply chain no other site can run | Worthless geology everywhere but Procellarum — a site bet, not a building |

## Life & society

| Building (Era) | St | Inputs → Outputs | Secondary effect | Pro | Con |
|---|---|---|---|---|---|
| **Lander** (1) | S | — → +6 kW; stores 800 energy units | Pre-placed, free; houses 8; carries the starting cache; build anchor | Home. Power, housing, and the supply cache you arrived with | There is only one, and it is not enough |
| Habitat Module (1) | S | −4 kW → houses 4 | Extends the buildable perimeter (60 m radius) | Room for four more; extends the buildable perimeter | Draws life support every second of the night, forever |
| Buried Habitat (2) | C | −power → houses crew under regolith berm | Flare-proof housing (Regolith Shielding tech); thermal-stable | Radiation and thermal swings simply stop mattering | Costlier, slower to build, and windowless — morale dims underground |
| Hydroponics Farm (1) | S | 1 crew, −6 kW, 0.03 water/s → 0.10 food/s (idles rather than drink the crew's 5-minute reserve) | Morale +5 while running | Fresh food, green light — the crew's favorite corridor | Crops die if power drops through the night. It holds your grid hostage |
| Algae Bioreactor (2) | C | water + power → food + oxygen trickle | O₂ redundancy independent of smelting; compact | Two life-support loops from one tank — and it shrugs off brownouts | Nobody dreams of algae for dinner; higher crew tiers demand variety |
| Medical Bay (3) | C | crew, power, parts → crew-health coverage | Heals flare/micrometeorite injuries; softens starvation losses; Technician-tier need | Turns disasters from deaths into recoveries | Staffed by exactly the skilled crew your industry is short of |
| Recreation Dome (3) | S | 1 crew, −4 kW, 0.05 food/s → — | Morale +14 — the largest single lever | The biggest single lever on morale — and morale multiplies everything | A pure cost center. It consumes and produces nothing but goodwill |

## Industry

| Building (Era) | St | Inputs → Outputs | Secondary effect | Pro | Con |
|---|---|---|---|---|---|
| Parts Fabricator (3) | S | 1 crew, −10 kW, 0.3 metals/s → 0.2 parts/s; stands by when the parts yard is full | Ends dependence on the lander's spares cache | Ends your dependence on the lander's spare-parts cache | Three metals in, two parts out — metals your next building was counting on |
| Electronics Assembler (3) | C | silicon + metals + rare earths → electronics | Gates advanced buildings/techs in the full design (02) | The chokepoint that makes automation, comms, and Cores possible | Three input chains converge here — any one starving stalls them all |
| Foundry / Structural Mill (3) | C | bulk metals + heavy power → structural sections | Cuts build cost of large late buildings; wants a Radiator Field | Big buildings stop devouring your raw-metal stockpile | A heat monster: the grid and the radiators both remember it |
| Foil Factory (4) | S | 3 crew, −20 kW, 0.6 silicon + 0.2 metals/s → 0.05 foils/s | Makes the literal substance of the swarm | Thin-film collector foils: the actual substance of the Dyson swarm | The largest power draw on the Moon. Your grid will remember this purchase |

## Science

| Building (Era) | St | Inputs → Outputs | Secondary effect | Pro | Con |
|---|---|---|---|---|---|
| Research Lab (1) | S | 2 crew, −5 kW → Data | Buildable from the start (the tree's entry point); priority 3: first to idle in a crunch | The only way forward: data toward every unlock | Produces nothing you can eat, breathe, or burn — and idles first in a crunch |
| Data-Core Foundry (3) | C | electronics + Data → Data Cores | Manufactured science: Era 4+ techs cost Cores (03) | Turns research into a product your industry can scale | Science itself now has a supply chain that can starve |
| Deep-Space Observatory (4) | C | crew, power → Data surge + Breakthrough discovery | Farside/radio-quiet concept: must sit far from the base, linked by Comms Relay | Finds the Breakthroughs no lab can compute its way to | Exiled beyond your perimeter — a remote outpost with your smartest people in it |

## Logistics & export

| Building (Era) | St | Inputs → Outputs | Secondary effect | Pro | Con |
|---|---|---|---|---|---|
| Drone Hub (3) | C | power + parts → hauling coverage radius | Automated Drone Logistics tech; frees crew from hauling | Invisible hands: logistics stop costing people | Its range rings now dictate your whole layout — and it is pure overhead |
| Comms Relay (4) | C | power → uplink coverage | Enables Observatory link + Swarm Coordination Network; calls home ease Unrest | The thread to Earth — and later, to the swarm itself | A mast that does nothing measurable until the day it is everything |
| Mass Driver (4) | S | 2 crew, −15 kW, 0.02 parts/s → 0.01 launch/s | Needs truly flat ground (6×2 footprint, max slope rule); site `launchMult` applies | Two point four kilometers a second, no rocket required | A power-hungry rail with a long shadow — and it needs truly flat ground |
| Propellant Plant (4) | C | water/volatiles + power → propellant | Chemical-launch alternative where driver geometry is poor (Shackleton) | Buys polar bases back into the export game | Burns the very water your crew and crops drink |
| Orbital Catcher / Depot (5) | C | launch + parts → recovered carriers | More foils delivered per launch window | Every volley starts paying for the next one's ride | An orbital asset maintained from the bottom of a gravity well |
| Self-Replicating Factory Seed (5) | C | enormous one-time cost → self-expanding factory complex | Grows its own sub-buildings on a timer; the Armstrong–Sandberg doubling made placeable (02) | Plant it, feed it, and watch the curve go vertical | While it grows, it eats everything — and a bad batch replicates too |
| Statite Deployment Launcher (6) | C | foils + launch → statite deployments | Higher swarm % per volley; requires Swarm Coordination uptime (03) | Collectors that hover on sunlight itself — no orbit, no rendezvous | Tie your victory meter to a relay chain and pray it holds |

## Destiny buildings

Four buildings open with a destiny pick (docs/14 §2.8). Standing rules never
build them until Selenic Mind; orders and clicks place them. Their recipes are
placeholders from the stock kit until the look phase (docs/14 §4.2).

| Building (Era) | St | Inputs → Outputs | Secondary effect | Pro | Con |
|---|---|---|---|---|---|
| Drone Hive (3) · ◉ Drone Hives | S | −7 kW → docks 4 construction rovers | 3×3; counts in the fleet like a Bay | Four construction drones from one pad | Seven kW whether they fly or not, and one firmware push reaches all four |
| Greenhouse Ring (5) · ⌂ Greenhouse Rings | S | 2 crew, −14 kW, 0.08 water/s → 0.32 food/s | Morale +6; 4×4 | Three farms' food on two crew and 14 kW | One blight takes the whole ring, and it drinks 0.08≈/s |
| Server Monolith (5) · ◉ Fleet OS | S | −26 kW → 0.9 data/s; transfer cap +2.2/s | Counts as a Data Center wherever one is read, Data Center techs included; 2×2, 16 m | A Data Center's work on less than half the ground | A network hub: everything within 60 m links to it |
| Garden Dome (7) · ⌂ Garden Domes | S | 1 crew, −12 kW, 0.05 water/s → 0.04 food/s | Houses 10; morale +10; extends the network 60 m; 5×5 | Ten beds round a park under glass | The largest pressure hull you will build |

## Roster accounting

- **Shipped (14):** Solar Array, Battery Bank, Thorium Reactor, Regolith
  Excavator, Ice Harvester, Regolith Smelter, Silicon Refinery, Habitat Module,
  Hydroponics Farm, Recreation Dome, Research Lab, Parts Fabricator, Foil
  Factory, Mass Driver — plus the free pre-placed Lander. Later additions
  (Storage Yard, Robotics Bay, Chip Fab, Data Center, Relay Mast, Propellant
  Plant, and the four destiny buildings above) are in `buildings.ts`.
- **Merged (2 → 1):** HRI Ilmenite Reduction Plant + MRE Electrolyzer → the
  shipped Regolith Smelter. Unmerging them restores a real strategic choice:
  oxygen-rich ilmenite reduction (site-dependent) vs. site-agnostic,
  power-hungry electrolysis.
- **Cut (15):** Radiator Field, Rare-Earth Extractor, Buried Habitat, Algae
  Bioreactor, Medical Bay, Electronics Assembler, Foundry/Structural Mill,
  Data-Core Foundry, Deep-Space Observatory, Drone Hub, Comms Relay, Propellant
  Plant, Orbital Catcher/Depot, Self-Replicating Factory Seed, Statite
  Deployment Launcher.

## Slice status

**Shipped:** the 14 buildings + Lander above, covering every category and every
era — each with crew seats, brownout priority, parts upkeep, and pro/con exactly
as in `buildings.ts`. **Deferred** (see [09-roadmap.md](09-roadmap.md)): the 15
cut buildings and the Smelter unmerge. They cluster into natural expansion
packs: the Electronics chain (Assembler, Data-Core Foundry, Rare-Earth
Extractor), the safety layer (Buried Habitat, Medical Bay, Radiator Field, with
micrometeorites from 02), the logistics layer (Drone Hub, Comms Relay,
Observatory), the alternate-launch set (Propellant Plant, Orbital Catcher), and
the endgame pair (Factory Seed, Statite Launcher).

## Research you can see

Techs change numbers *and* buildings: each research step grows a part on
the structures it affects, so a base's history reads from across the crater
(docs/12 §6). The part list and the triangle budget below are generated from
`src/buildings/upgrades.ts`: budget per part ≤ 600 △ on the recipe mesh,
fully upgraded ≤ 7,500 △ per type (checked by `tests/upgrades.spec.ts`).
Pure unlocks need no part — their visual is the building itself; Regolith
Shielding's berms (`berms.ts`) and Dust Mitigation's clean glass are drawn
by their own systems as before.

<!-- BEGIN GENERATED: node scripts/gen-tech-doc.mjs -->
Every tech that touches a building adds a part to that building type's recipe
(`src/buildings/upgrades.ts`). The part appears on every building of the type the
moment the tech completes, on placement ghosts and scaffolds, and after a load. △ is
the triangles the part adds to the recipe mesh; moving parts (an extra Earth dish,
the wider wing) reuse the shared dish and wing meshes and are counted apart (↻).

| Building | Stock △ | Fully upgraded △ | Upgrades |
|---|---|---|---|
| Lander | 2,760 | 7,112 | 11 |
| Solar Array | 896 | 2,012 | 8 |
| Battery Bank | 1,044 | 2,138 | 4 |
| Thorium Reactor | 1,752 | 2,044 | 2 |
| Regolith Excavator | 1,044 | 2,036 | 8 |
| Ice Harvester | 1,288 | 1,680 | 3 |
| Regolith Smelter | 1,204 | 2,492 | 9 |
| Silicon Refinery | 2,348 | 3,272 | 6 |
| Storage Yard | 956 | 1,016 | 1 |
| Robotics Bay | 1,336 | 2,678 | 8 |
| Parts Fabricator | 1,048 | 1,336 | 3 |
| Chip Fab | 1,144 | 1,924 | 8 |
| Habitat Module | 1,576 | 2,248 | 5 |
| Hydroponics Farm | 1,372 | 2,220 | 4 |
| Recreation Dome | 1,824 | 1,948 | 1 |
| Research Lab | 1,680 | 3,248 | 6 |
| Relay Mast | 1,616 | 2,012 | 2 |
| Data Center | 1,604 | 2,932 | 8 |
| Foil Factory | 1,416 | 2,362 | 5 |
| Mass Driver | 1,052 | 1,704 | 3 |
| Propellant Plant | 2,348 | 3,496 | 4 |
| Drone Hive | 776 | 776 | 0 |
| Greenhouse Ring | 1,400 | 1,400 | 0 |
| Garden Dome | 2,616 | 2,616 | 0 |
| Server Monolith | 420 | 420 | 0 |

#### Lander

| Tech | Era | What changes | △ |
|---|---|---|---|
| Earth Teleoperation | 1 | The Lander raises a second, larger Earth dish for the teleoperators. | 124 + 740 ↻ |
| Prospecting Rovers | 1 | A rover charging dock appears beside the Lander, and Relay Masts can rise. | 200 |
| Sample-Return Caches | 1 | A sample-cache carousel stands beside the Lander’s ladder. | 384 |
| Orbital Prospector | 4 | The Lander adds a tracking dish for the polar orbiter. | 240 + 740 ↻ |
| Gravity Gradiometry | 5 | The Lander raises a gravimeter mast. | 234 |
| Far-Side Relay | 6 | The Lander raises a lattice mast for the far-side relay link. | 572 |
| Deep Sounding Network | 7 | A ring of seismometer pods is set out around the Lander. | 568 |
| Laser Ranging | 7 | The Lander adds a laser-ranging telescope dome. | 262 |
| Safety Protocols | 6 | Inspection lamp masts go up beside Habitats and the Lander. | 88 |
| Power Beaming Return | 8 | A rectenna mesh unfolds beside the Lander. | 96 |
| Build Orders | 2 | The Lander raises a planning mast: a pole with a work lamp beside its top deck. | 104 |

#### Solar Array

| Tech | Era | What changes | △ |
|---|---|---|---|
| Bifacial Cells | 1 | Solar Arrays lay a white reflector apron beneath their wings. | 84 |
| MPPT Inverters | 2 | Solar Arrays hang a finned inverter cabinet on the pedestal. | 84 |
| Thermal Wadis (ILMENITE PLAINS) | 2 | Solar Arrays each bank a sintered-regolith heat wadi at their feet. | 40 |
| Vertical Solar Masts (SHACKLETON RIM) | 2 | Solar Arrays climb onto 10 m lattice masts. | 444 |
| Skylight Heliostats (MARIUS HILLS TUBE) | 2 | Each Solar Array gains a heliostat mirror on a boom. | 56 |
| Dust Mitigation | 3 | Solar Arrays sprout electrostatic curtain wands and excavators wear dust skirts. | 240 |
| Wing Extensions | 5 | Solar Array wings grow a fifth row of cells. | 0 + 120 ↻ |
| Automated Power | 4 | Solar Arrays gain a combiner box with a status lamp at the foot of the mast. | 48 |

#### Battery Bank

| Tech | Era | What changes | △ |
|---|---|---|---|
| Stacked Cell Racks | 3 | Battery Banks stack a second tier of cells. | 252 |
| Regenerative Fuel Cells | 3 | Battery Banks sprout paired hydrogen and oxygen tanks. | 468 |
| High-Pressure Tanks | 4 | Battery Banks add a third, high-pressure tank. | 182 |
| Solid-State Cells | 6 | Battery Banks seal their cells in solid-state vaults. | 192 |

#### Thorium Reactor

| Tech | Era | What changes | △ |
|---|---|---|---|
| Brayton Converters | 4 | Thorium Reactors add a Brayton turbine skid. | 108 |
| High-Burnup Fuel | 6 | Thorium Reactors raise a fuel-handling crane over the dome. | 184 |

#### Regolith Excavator

| Tech | Era | What changes | △ |
|---|---|---|---|
| Grizzly Screens | 1 | Excavators carry a slotted grizzly screen over the back deck. | 144 |
| Solar-Wind Volatiles (ILMENITE PLAINS, MARIUS HILLS TUBE) | 1 | Excavators carry a heated volatiles retort with a cold-trap tank. | 256 |
| Ilmenite Beneficiation (ILMENITE PLAINS, MARIUS HILLS TUBE) | 2 | Excavators carry a magnetic separator drum. | 92 |
| Dust Mitigation | 3 | Solar Arrays sprout electrostatic curtain wands and excavators wear dust skirts. | 48 |
| Optical Ore Sorting | 4 | Excavators mount an optical ore-sorting hood over the bucket wheel. | 60 |
| Condition Optimization | 6 | Excavators, Smelters, Refineries and Ice Harvesters sprout sensor masts. | 80 |
| Autonomous Haulage | 5 | Excavators widen their bucket lips and mount a haul-road lidar bar on the cab. | 240 |
| Feed Planner | 5 | Excavators carry an assay drill beside the bucket. | 72 |

#### Ice Harvester

| Tech | Era | What changes | △ |
|---|---|---|---|
| Sublimation Tents (SHACKLETON RIM) | 2 | Ice Harvesters pitch a foil sublimation tent over the dig. | 156 |
| Heated Augers (SHACKLETON RIM) | 4 | Ice Harvesters sink a second, heated auger. | 156 |
| Condition Optimization | 6 | Excavators, Smelters, Refineries and Ice Harvesters sprout sensor masts. | 80 |

#### Regolith Smelter

| Tech | Era | What changes | △ |
|---|---|---|---|
| Heat-Recovery Jackets | 2 | Smelter stacks wrap in foil heat-recovery jackets. | 100 |
| Molten Regolith Electrolysis | 2 | Smelters grow an electrolysis cell with heavy busbars. | 108 |
| Volcanic Glass Reduction | 4 | Smelters raise a hopper for orange volcanic glass beads. | 160 |
| Slag Recycling | 3 | Smelters run a slag conveyor out to a cooling bed. | 84 |
| MLI Blankets (ILMENITE PLAINS, MARIUS HILLS TUBE) | 4 | Smelters, Refineries and Labs wear silver MLI blankets. | 48 |
| Deployable Radiators | 5 | Smelters, Refineries and Chip Fabs unfold extra radiator wings. | 216 |
| Oxygen Liquefaction | 5 | Smelters add a cold-box liquefier and a spherical LOX tank. | 312 |
| Refractory Linings | 6 | Smelter stacks and Refinery columns are banded with refractory courses. | 180 |
| Condition Optimization | 6 | Excavators, Smelters, Refineries and Ice Harvesters sprout sensor masts. | 80 |

#### Silicon Refinery

| Tech | Era | What changes | △ |
|---|---|---|---|
| Reflux Columns | 3 | Silicon Refineries raise a fourth distillation column. | 308 |
| MLI Blankets (ILMENITE PLAINS, MARIUS HILLS TUBE) | 4 | Smelters, Refineries and Labs wear silver MLI blankets. | 40 |
| Deployable Radiators | 5 | Smelters, Refineries and Chip Fabs unfold extra radiator wings. | 216 |
| Refractory Linings | 6 | Smelter stacks and Refinery columns are banded with refractory courses. | 200 |
| Condition Optimization | 6 | Excavators, Smelters, Refineries and Ice Harvesters sprout sensor masts. | 80 |
| Automated Smelting & Refining | 5 | Silicon Refineries grow an ore-sampler arm over the feed hopper. | 80 |

#### Storage Yard

| Tech | Era | What changes | △ |
|---|---|---|---|
| Budget Governor | 4 | Storage Yards get a manifest gantry: a scanner bar on two legs spanning the racks. | 60 |

#### Robotics Bay

| Tech | Era | What changes | △ |
|---|---|---|---|
| Swarm Robotics | 3 | Robotics Bays add a rooftop rack of swarm charging cradles. | 156 |
| Heavy Constructors | 3 | Robotics Bays raise a heavy gantry crane. | 72 |
| Self-Replicating Systems | 7 | Parts Fabricators and Robotics Bays grow replicator assembly arms. | 76 |
| Rover Autonomy | 4 | Robotics Bays raise a navigation mast: a radar dome and the lidar heads the rovers plan their paths by. | 310 |
| Predictive Maintenance | 6 | Robotics Bays raise a diagnostics mast with a beacon. | 136 |
| Automated Excavation | 3 | Robotics Bays grow a dispatch mast: a lattice tower with a beacon on the roof. | 268 |
| Site Survey AI | 3 | A survey drone rests on a pad on each Robotics Bay roof. | 212 |
| Maintenance Automation | 7 | Robotics Bays get a service crane arm over the charging rover. | 112 |

#### Parts Fabricator

| Tech | Era | What changes | △ |
|---|---|---|---|
| Tool Changers | 5 | Parts Fabricators add a tool-changer carousel on the roof. | 140 |
| Self-Replicating Systems | 7 | Parts Fabricators and Robotics Bays grow replicator assembly arms. | 76 |
| Automated Fabrication | 6 | Parts Fabricators get a gantry crane across the roof. | 72 |

#### Chip Fab

| Tech | Era | What changes | △ |
|---|---|---|---|
| Lava-Tube Caverns | 3 | Habitats, Data Centers and Chip Fabs pile a sandbag overburden on their roofs. | 36 |
| Rad-Hard Process | 4 | Chip Fabs add a shielded ion-implanter annex. | 60 |
| Cleanroom Robotics | 4 | Chip Fabs gain a sealed wafer-transfer tunnel and a handling arm. | 100 |
| Dynamic Clocking | 5 | Chip Fabs and Data Centers mount boost radiators for overclocking. | 96 |
| Wafer Polishing | 4 | Chip Fabs add a glass-roofed wafer-polishing annex. | 36 |
| Deployable Radiators | 5 | Smelters, Refineries and Chip Fabs unfold extra radiator wings. | 108 |
| Immersion Lithography | 5 | Chip Fabs raise an immersion-lithography tower. | 264 |
| Superconducting Bus | 7 | Data Centers, Chip Fabs and Foil Factories run superconducting bus ducts. | 80 |

#### Habitat Module

| Tech | Era | What changes | △ |
|---|---|---|---|
| Bunk Racks | 3 | Habitats bolt a bunk annex onto their airlock. | 72 |
| Closed-Loop Life Support | 6 | Habitats add a CO₂ scrubber stack and water-recovery tanks. | 256 |
| Lava-Tube Caverns | 3 | Habitats, Data Centers and Chip Fabs pile a sandbag overburden on their roofs. | 144 |
| Safety Protocols | 6 | Inspection lamp masts go up beside Habitats and the Lander. | 88 |
| Automated Life Support | 4 | Each Habitat Module gets an air-monitor mast by its door. | 112 |

#### Hydroponics Farm

| Tech | Era | What changes | △ |
|---|---|---|---|
| LED Grow Lights | 4 | Hydroponics vaults glow with LED grow-light strips. | 48 |
| Nutrient Recirculation | 5 | Hydroponics farms add a row of nutrient recirculation tanks. | 352 |
| Galley Garden | 6 | Hydroponics farms open a galley bay with a picture window. | 48 |
| Cold-Trap Chemistry | 6 | Hydroponics Farms and Propellant Plants rack process-gas bottles. | 400 |

#### Recreation Dome

| Tech | Era | What changes | △ |
|---|---|---|---|
| Low-G Court (human only) | 7 | Recreation Domes add a low-g court annex under a glass vault. | 124 |

#### Research Lab

| Tech | Era | What changes | △ |
|---|---|---|---|
| Field Spectrometers | 1 | Research Labs bolt a spectrometer turret onto the roof. | 100 |
| Bench Robots (human only) | 2 | Research Labs fit a robot sample bench behind a new window bay. | 48 |
| Cryo Sample Store | 3 | Research Labs stand a cryogenic sample dewar on the roof. | 268 |
| MLI Blankets (ILMENITE PLAINS, MARIUS HILLS TUBE) | 4 | Smelters, Refineries and Labs wear silver MLI blankets. | 24 |
| Science Crews | 6 | Research Labs raise a glazed observation cupola. | 336 |
| Lab Uplink Dishes | 6 | Research Labs raise a second uplink dish. | 52 + 740 ↻ |

#### Relay Mast

| Tech | Era | What changes | △ |
|---|---|---|---|
| Neutron Spectrometry | 2 | Relay Masts hang a neutron-spectrometer boom. | 120 |
| Self-Expanding Base | 7 | Relay Masts wear a beacon crown and a cable reel at the foot. | 276 |

#### Data Center

| Tech | Era | What changes | △ |
|---|---|---|---|
| Lava-Tube Caverns | 3 | Habitats, Data Centers and Chip Fabs pile a sandbag overburden on their roofs. | 48 |
| Accelerator Design | 4 | Data Centers mount accelerator cooling towers on the roof. | 504 |
| Dynamic Clocking | 5 | Chip Fabs and Data Centers mount boost radiators for overclocking. | 144 |
| Cryo Radiators | 5 | Data Centers unfold a second tier of cryo radiator fins. | 240 |
| Superconducting Bus | 7 | Data Centers, Chip Fabs and Foil Factories run superconducting bus ducts. | 68 |
| Liquid Cooling | 7 | Data Centers run coolant manifolds to a pump skid. | 152 |
| Rack Densification | 7 | Data Centers add a rack annex at the berm. | 36 |
| Predictive Scheduling | 6 | Each Data Center adds a scheduling antenna: a tall whip mast beside its dish. | 136 |

#### Foil Factory

| Tech | Era | What changes | △ |
|---|---|---|---|
| Roll-to-Roll Coating | 7 | Foil Factories add a second roll-to-roll coating line. | 236 |
| Foil Annealing Ovens | 7 | Foil Factories raise annealing ovens on the roof. | 72 |
| Canister Press | 8 | Foil Factories add a canister press at the loading dock. | 144 |
| Von Neumann Foundry | 8 | Foil Factories sprout seed-factory pods on the roof. | 426 |
| Superconducting Bus | 7 | Data Centers, Chip Fabs and Foil Factories run superconducting bus ducts. | 68 |

#### Mass Driver

| Tech | Era | What changes | △ |
|---|---|---|---|
| Launch-Site Survey | 6 | Mass Drivers and Propellant Plants rise on staked, surveyed pads with reflector posts. | 216 |
| Swarm Protocol | 8 | Mass Drivers and Propellant Plants raise a swarm-tracking beacon mast. | 196 |
| Rail Capacitor Banks | 8 | Mass Drivers line their rail with capacitor banks. | 240 |

#### Propellant Plant

| Tech | Era | What changes | △ |
|---|---|---|---|
| Launch-Site Survey | 6 | Mass Drivers and Propellant Plants rise on staked, surveyed pads with reflector posts. | 144 |
| Cold-Trap Chemistry | 6 | Hydroponics Farms and Propellant Plants rack process-gas bottles. | 400 |
| Swarm Protocol | 8 | Mass Drivers and Propellant Plants raise a swarm-tracking beacon mast. | 196 |
| Cryocooler Heads | 8 | Propellant Plants cap their tanks with cryocooler heads. | 408 |
<!-- END GENERATED -->
