# 03 · Tech Tree

The full tree: six eras, ~30 techs — the 18 shipped in the slice
(`src/data/techs.ts`, canonical) plus the 10 designed-but-cut techs and the
map-discovered Breakthroughs system. Every tech states an explicit trade-off
(pillar 1); none is a pure number-up.

## The six eras

Eras are the tree's act structure (Civilization's model): named chapters that
reframe what the game is about. Shipped names from `ERA_NAMES`:

| Era | Name | The game becomes about… | Research working title |
|---|---|---|---|
| 1 | FIRST LANDING | staying alive on the lander's cache | Site Survey / First Landing |
| 2 | SELF-SUFFICIENCY | surviving the night on your own systems; cutting the Earth umbilical | Self-Sufficiency |
| 3 | INDUSTRIALIZATION | supply chains, spare parts, baseload power, a real workforce | Industrialization |
| 4 | EXPORT ECONOMY | the mass driver; your site choice pays off — or bites | Mass Driver / Export Economy |
| 5 | SELF-REPLICATION | machines that extend machines; the curve bends exponential | Self-Replication |
| 6 | DYSON SWARM | launching the swarm; the meter; power flowing back | Dyson Swarm Contribution |

## Era gating rules

1. **Era N+1 opens once ≥ 2 techs of era N are complete** (`ERA_ADVANCE_COUNT = 2`).
   You must invest in an era's breadth before leaving it — no beelining the
   capstone through a single chain.
2. **Individual prerequisites still apply** (`requires`): e.g. Silicon Refining
   needs Regolith Smelting regardless of era count.
3. **Era 3+ techs also cost manufactured goods** (`costGoods`) on top of Data.
4. Research is sequential (one active tech, queue of 3 in the UI); Data accrues
   from staffed Research Labs, scaled by the morale work multiplier.

## The manufactured-science rationale

The Factorio lesson: **you cannot out-research your industry.** If progress
costs only an abstract point stream, the optimal base is a lab farm and the
economy is decoration. From Era 3 the slice charges metals, silicon, parts, and
finally foils for techs — so the tech tree periodically *becomes* a production
goal, and industry buildouts are research decisions.

**Full design goes further — Data Cores (CUT).** The Data-Core Foundry (04)
manufactures Data Cores from Electronics + Data, and every Era 4+ tech costs
Cores rather than raw goods: one currency, deep supply chain (Regolith → Silicon
/ Metals / Rare Earths → Electronics → Cores). The slice's `costGoods` fields
are that system flattened by one step — same pressure, fewer moving parts.
Cut alongside Electronics (02); they return together.

## The tree

Status: **S** = shipped (costs from `techs.ts`) · **C** = cut (costs are design
targets, to be balanced at implementation). Effects for shipped techs are
abbreviated; the code is canonical.

### Era 1 · FIRST LANDING

| Tech | St | Cost | Requires | Effect | Trade-off |
|---|---|---|---|---|---|
| Regolith Smelting | S | 15 Data | — | Unlock Regolith Smelter | Smelters are the grid's second-largest draw |
| Cryo Ice Extraction | S | 15 Data | — | Unlock Ice Harvester | Only pays off on sites that actually have ice |
| Hydroponics | S | 20 Data | — | Unlock Hydroponics Farm | Farms must run through the night — or the crop dies |
| Orbital Survey | C | (low Data) | — | Reveal map resource richness + anomaly (Breakthrough) sites | Spends your only early lab time on looking instead of building |
| Earth Resupply Link | C | (low Data) | — | Enable credit-spend resupply drops (02, umbilical arc) | Every drop deepens the habit the game will make you break |

### Era 2 · SELF-SUFFICIENCY

| Tech | St | Cost | Requires | Effect | Trade-off |
|---|---|---|---|---|---|
| Battery Banks | S | 40 Data | — | Unlock Battery Bank | 15% round-trip loss, and metals you wanted elsewhere |
| Closed-Loop Life Support | S | 60 Data | — | Habitat draw ×0.6, habitat power ×1.3 | The recyclers draw 30% more power per habitat |
| Silicon Refining | S | 50 Data | Regolith Smelting | Unlock Silicon Refinery | Another furnace for the night to strangle |
| Regolith Shielding | C | (mid Data) | — | Unlock Buried Habitat; bury habitats against radiation | Buried crews see less sun — morale trades against safety |

### Era 3 · INDUSTRIALIZATION

| Tech | St | Cost | Requires | Effect | Trade-off |
|---|---|---|---|---|---|
| Parts Fabrication | S | 110 Data + 60 metals | Silicon Refining | Unlock Parts Fabricator | Adds a whole supply chain that also needs maintaining |
| Thorium Reactor | S | 140 Data + 80 metals | Battery Banks | Unlock Thorium Reactor | Expensive, parts-hungry, and the crew hates living next to it |
| Crew Wellness Program | S | 100 Data | — | Unlock Recreation Dome | Diverts power, food, and a worker from every "productive" number |
| Automated Drone Logistics | C | (mid Data + goods) | — | Unlock Drone Hub; hauling within drone range, fewer crew-haulers | Range rings now constrain layout; hubs are pure overhead |
| Specialist Training | C | (mid Data + goods) | — | Enable crew tiers: Crew → Technicians → Scientists (02) | Every promotion hollows out the tier below |
| Advanced Research Cluster | C | (mid Data + goods) | — | Unlock Data-Core Foundry; Era 4+ techs cost Data Cores | Science itself now has a supply chain that can starve |

### Era 4 · EXPORT ECONOMY

| Tech | St | Cost | Requires | Effect | Trade-off |
|---|---|---|---|---|---|
| Thin-Film Foils | S | 220 Data + 40 silicon | Parts Fabrication | Unlock Foil Factory | The factory is the single largest power draw you will ever build |
| Electromagnetic Mass Driver | S | 260 Data + 50 parts | Parts Fabrication | Unlock Mass Driver | Site geometry now matters enormously — equatorial bases pull ahead |
| Dust Mitigation | S | 180 Data | — | Dust rate ×0.4; excavator upkeep ×0.5 | Research spent on brooms while rivals research rockets |
| Propellant Plant | C | (high Data + goods) | Cryo Ice Extraction | Unlock Propellant Plant: water/volatiles → propellant; chemical launch alternative | Burns the same water your farms and crew drink |

### Era 5 · SELF-REPLICATION

| Tech | St | Cost | Requires | Effect | Trade-off |
|---|---|---|---|---|---|
| Automated Fabrication | S | 420 Data + 60 parts | Thin-Film Foils | PartsFab/FoilFactory output ×2, crew −1 each | Automation fails ugly — wear bites harder with no one watching |
| Self-Replicating Systems | S | 520 Data + 80 parts | Automated Fabrication | Extraction/refining output ×1.5; ALL upkeep ×0.75 | Every doubling doubles the blast radius of a single bad batch |
| High-Efficiency Launch | S | 480 Data + 60 silicon | Electromagnetic Mass Driver | Mass driver power ×0.6, output ×2 | Superconductors demand silicon your foils were counting on |
| Orbital Catcher | C | (high Data + Cores) | Electromagnetic Mass Driver | Unlock Orbital Catcher/Depot: recover carriers, more foils delivered per launch | Another orbital asset to maintain from the ground |

In the full design, Self-Replicating Systems also unlocks the **Self-Replicating
Factory Seed** building (04) — replication as something you *place*, not just a
multiplier. The slice ships the multiplier form only.

### Era 6 · DYSON SWARM

| Tech | St | Cost | Requires | Effect | Trade-off |
|---|---|---|---|---|---|
| Swarm Protocol | S | 700 Data + 5 foils | High-Efficiency Launch | Arms the LAUNCH action | The five test foils it consumes never come back |
| Power Beaming Return | S | 800 Data | Swarm Protocol | +4 kW per volley launched, beamed back | Your grid now depends on hardware forty million kilometers away |
| Von Neumann Foundry | S | 1200 Data + 20 foils | Swarm Protocol | Foil Factory output ×3 | A monument to obsolescence: yours, specifically |
| Statite Deployment | C | (capstone Cores + foils) | Swarm Protocol | Unlock Statite Deployment Launcher: foils fly as radiation-pressure statites, swarm % per volley ↑ | Statites need station-keeping data — Comms Relay uptime becomes existential |
| Swarm Coordination Network | C | (capstone Cores) | Statite Deployment | Requires Comms Relay; swarm-wide efficiency and beaming multiplier; opens Von Neumann portfolio (02) | Centralizes the swarm on one relay chain — a single point of glorious failure |

## Breakthroughs (CUT — Surviving Mars)

A layer of **discovered, not researched** techs: anomaly sites seeded on the map
(revealed by Orbital Survey; more by the Deep-Space Observatory) grant unique
one-off techs when surveyed by crew or drones. Each run offers a different
handful, bending strategy around what the Moon gives you. Design-intent
examples: *Lava Tube Network* (extra buildable radius, lava-tube site),
*Pristine Ilmenite Vein* (+smelter yield), *Ancient Impactor Core* (free rare
earths cache), *Fission Refinement* (reactor upkeep ×0.5). Breakthroughs are the
tree's replayability valve — the only techs the player cannot plan for.

## Reading the tree as a player

The shipped spine is Smelting → Silicon → Parts Fabrication → Foils/Driver →
Automation → Swarm Protocol: seven techs deep. Everything else is a choice about
*which pressure to buy down* — night (batteries/reactor), people (wellness,
tiers), wear (dust mitigation), or distance (launch efficiency). Era gating
(rule 1) guarantees at least one such choice per era; capstones cost the very
resource they improve (foils), making the last techs economic decisions too.

## Slice status

**Shipped:** 18 techs across all six eras; era gating exactly as rules 1–3;
goods-cost gating from Era 3; queue of 3; the full-screen era-column tree UI
(07). **Deferred** (see [09-roadmap.md](09-roadmap.md)): the 10 cut techs above;
Data Cores replacing raw-goods costs from Era 4 (with Electronics and the
Data-Core Foundry, 02/04); the Breakthroughs layer (with Orbital Survey and map
anomalies); the Self-Replicating Factory Seed building form of Era 5.
