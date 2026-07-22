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
  first (labs), then industry, then food, and life support (0) last.
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
| Regolith Excavator (1) | S | 1 crew, −6 kW → 1.5 regolith/s | Highest dust wear on the base (halved by Dust Mitigation) | Feeds every industry on the Moon | Thrown dust abrades everything — the highest parts wear on the base |
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
| Hydroponics Farm (1) | S | 1 crew, −6 kW, 0.2 water/s → 0.35 food/s | Morale +5 while running | Fresh food, green light — the crew's favorite corridor | Crops die if power drops through the night. It holds your grid hostage |
| Algae Bioreactor (2) | C | water + power → food + oxygen trickle | O₂ redundancy independent of smelting; compact | Two life-support loops from one tank — and it shrugs off brownouts | Nobody dreams of algae for dinner; higher crew tiers demand variety |
| Medical Bay (3) | C | crew, power, parts → crew-health coverage | Heals flare/micrometeorite injuries; softens starvation losses; Technician-tier need | Turns disasters from deaths into recoveries | Staffed by exactly the skilled crew your industry is short of |
| Recreation Dome (3) | S | 1 crew, −4 kW, 0.05 food/s → — | Morale +14 — the largest single lever | The biggest single lever on morale — and morale multiplies everything | A pure cost center. It consumes and produces nothing but goodwill |

## Industry

| Building (Era) | St | Inputs → Outputs | Secondary effect | Pro | Con |
|---|---|---|---|---|---|
| Parts Fabricator (3) | S | 3 crew, −10 kW, 0.4 metals/s → 0.3 parts/s | Ends dependence on the lander's spares cache | Ends your dependence on the lander's spare-parts cache | Three crew on the line — your scarcest resource, standing at a bench |
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

## Roster accounting

- **Shipped (14):** Solar Array, Battery Bank, Thorium Reactor, Regolith
  Excavator, Ice Harvester, Regolith Smelter, Silicon Refinery, Habitat Module,
  Hydroponics Farm, Recreation Dome, Research Lab, Parts Fabricator, Foil
  Factory, Mass Driver — plus the free pre-placed Lander.
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
