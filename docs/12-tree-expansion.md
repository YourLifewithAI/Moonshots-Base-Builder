# 12 · Tree expansion: 47 → 90 techs, eras twice as long, research you can see

**Status:** design (Phase A), implemented in the same branch (Phase B).
**Supersedes** the counts in [11-research-and-map-spec.md](11-research-and-map-spec.md)
§3 and the pacing targets of §7; every other rule there still holds.
Generated per-tech tables stay in [03-tech-tree.md](03-tech-tree.md); the
per-building visual upgrades are listed in [04-buildings.md](04-buildings.md).

## 1. What the player asked for

> The transition between eras is too quick. Extending the eras should mean
> expanding the tree: more granular unlocks, each gain smaller. And each bit
> of research should make something look different — the research center
> gets another dish, or a dome. Visual, iterative improvement of the
> buildings that makes progress visually obvious.

Chosen targets:

| Target | Today (probe, reasonable policy, median of 3 seeds) | After |
|---|---|---|
| Era length | 12–16 game-min (lava E3 23) | **25–30 game-min** each |
| FIRST LIGHT, robotic mare | 108.6 game-min | **210 ± 25** |
| FIRST LIGHT, other sites | 106–125 | within **+30%** of robotic mare |
| Longest idle stretch | 4–7 min | **≤ 5 min** |
| Techs | 47 | **90** (43 new, mostly small steps) |
| Every tech | numbers only (berms and clean panels aside) | **visibly changes the buildings it affects** |

Two other branches add techs in parallel, so the layout and pacing are
planned for **about 104 techs** in all: `work/fleet` adds 1–2
(per-rover construction rate, possibly excavator haul speed or bucket
size) and the automation branch adds about 12 (standing build orders per
building family and smarter-builder upgrades), mostly in ◉ ROBOTS & FAB and
▣ SILICON & COMPUTE, eras 2–7. This design adds **no** rover-count,
construction-rate, haul, bucket or auto-build techs, and leaves room for
theirs (§5).

## 2. Rules that change

### 2.1 Charters: 4 techs, or 2 plus the deed

With ~11 techs per era a 2-tech charter would open the next era after the
two cheapest small steps, so eras would get *shorter*. The charter scales
with the tree:

- **Era N opens with 4 visible done techs of resolved era N−1, or 2 of
  them plus that era's deed.** (`CHARTER_TECHS = 4`, `CHARTER_DEED_TECHS = 2`.)
- Robotic era 7 still hard-requires Human Cohabitation on either route.
- The deeds scale with the longer eras (a deed should arrive late in its
  era, not halfway): see the table. Era 6 and era 7 deeds are durations and
  stay as they are.

| Opens | Deed today | Deed after |
|---|---|---|
| 2 | 100◆ smelted | **250◆ smelted** |
| 3 | 80⚙ fabricated | **200⚙ fabricated** |
| 4 | 150◇ refined | **400◇ refined** |
| 5 | 20▣ fabbed | **50▣ fabbed** |
| 6 | a DC held a full night | unchanged |
| 7 | an outpost operated a full lunar day (+ Cohabitation, robotic) | unchanged |
| 8 | 10▰ manufactured | **25▰ manufactured** |

The tree header reads *An era opens with 4 of the previous era's techs — or
2 plus a deed*, and the era-head pips show `◼◼◻◻ 2/4 · or 2 + …`.

### 2.2 Doctrine follow-ups are foreclosed with their doctrine

Five new techs build on one doctrine member (Brayton Converters and
High-Burnup Fuel on Thorium; High-Pressure Tanks on Fuel Cells; Rail
Capacitor Banks on the Mass Driver; Cryocooler Heads on the Propellant
Depot). A tech whose `requires` closure contains a doctrine member whose
rival is **done** is `foreclosed — needs Thorium Reactor; you chose
Regenerative Fuel Cells` instead of a dead `requires` card. Nothing
existing depends on a single doctrine member, so no existing card changes.

### 2.3 Two new effect kinds, one fix

| Kind | Mods field | Semantics | Generated line |
|---|---|---|---|
| `{kind:'housing', building, delta}` | `housingDelta[b]` | added to `housing` of that building type (only types that house) via `effectiveDef` | `+1 housing: Habitat Module` (pro; negative = con) |
| `{kind:'morale', building, delta}` | `moraleDelta[b]` | added to that building's `moraleDelta` while it is active, via `effectiveDef` | `+3 morale: Hydroponics Farm` (pro; negative = con) |

Both are relevant wherever the building is placeable. **Fix:** a survey
`dataMult` without `minCrew` now always applies (`surveyDataMult`), and one
with `minCrew` goes to its own `surveyCrewDataMult`; before, Science Crews'
`minCrew: 2` would have gated every other survey multiplier.

### 2.4 Costs and the cost dial

New small techs cost about 60–85% of their era's big techs (table below).
`ERA_COST_SCALE` stays the single tuning dial; the probe sets it (§8).

## 3. The 43 new techs

Columns: **id** · **lane** · **data** (base `costData`, before
`ERA_COST_SCALE`) + goods · **requires** · **pro / con** (exactly the
generated lines) · **visual** (the `visual` field; the mesh part it names is
added to that building type's recipe, §6). *crew* = `crewTech` (robotic runs:
visible, locked until Human Cohabitation). ✎ = new insight (§3.9).

### 3.1 Era 1 · FIRST LANDING (+4)

| id | lane | data | requires | pro / con | visual |
|---|---|---|---|---|---|
| `bifacialCells` | ⚡ | 80 | — | +8% power: Solar Array / build time ×1.25: Solar Array | Solar Arrays lay a white reflector apron beneath their wings. |
| `grizzlyScreens` | ◆ | 70 | — | +10% output: Regolith Excavator / +15% draw: Regolith Excavator | Excavators carry a slotted grizzly screen over the back deck. |
| `sampleCaches` | ◎ | 90 | Prospecting Rovers | survey data ×1.25 / −0.5 kW: Lander | A sample-cache carousel stands beside the Lander's ladder. |
| `fieldSpectrometers` | ▣ | 90 | — | +10% output: Research Lab / +20% draw: Research Lab | Research Labs bolt a spectrometer turret onto the roof. |

### 3.2 Era 2 · EARLY CONSTRUCTION (+4)

| id | lane | data | requires | pro / con | visual |
|---|---|---|---|---|---|
| `mpptInverters` ✎ | ⚡ | 110 | Bifacial Cells | +8% power: Solar Array / +25% upkeep: Solar Array | Solar Arrays hang a finned inverter cabinet on the pedestal. |
| `heatRecoveryJackets` ✎ | ◆ | 120 | Regolith Smelting | −12% draw: Regolith Smelter / +25% upkeep: Regolith Smelter | Smelter stacks wrap in foil heat-recovery jackets. |
| `sublimationTents` (P) | ⌂ | 120 | Cryo Ice Extraction | +15% output: Ice Harvester / +20% draw: Ice Harvester | Ice Harvesters pitch a foil sublimation tent over the dig. |
| `neutronSpectrometry` ✎ | ◎ | 110 | Sample-Return Caches | survey data ×1.2 / +40% draw: Relay Mast | Relay Masts hang a neutron-spectrometer boom. |

### 3.3 Era 3 · ROBOTIC FABRICATION (+5)

| id | lane | data | requires | pro / con | visual |
|---|---|---|---|---|---|
| `stackedCells` ✎ | ⚡ | 160 + 20◆ | Battery Banks | battery capacity ×1.25 / +40% upkeep: Battery Bank | Battery Banks stack a second tier of cells. |
| `slagRecycling` ✎ | ◆ | 150 | Heat-Recovery Jackets | −12% inputs: Regolith Smelter / +20% upkeep: Regolith Smelter | Smelters run a slag conveyor out to a cooling bed. |
| `refluxColumns` ✎ | ▣ | 160 | Silicon Refining | +12% output: Silicon Refinery / +12% draw: Silicon Refinery | Silicon Refineries raise a fourth distillation column. |
| `cryoSampleStore` ✎ | ▣ | 150 | Field Spectrometers | +10% output: Research Lab / +40% upkeep: Research Lab | Research Labs stand a cryogenic sample dewar on the roof. |
| `bunkRacks` *crew* | ⌂ | 150 | — | +1 housing: Habitat Module / −2 morale: Habitat Module | Habitats bolt a bunk annex onto their airlock. |

### 3.4 Era 4 · CHIP FABRICATION (+7)

| id | lane | data | requires | pro / con | visual |
|---|---|---|---|---|---|
| `braytonConverters` ✎ | ⚡ | 240 + 20⚙ | Thorium Reactor | +12% power: Thorium Reactor / +25% upkeep: Thorium Reactor | Thorium Reactors add a Brayton turbine skid. |
| `pressureTanks` | ⚡ | 240 + 30◆ | Regenerative Fuel Cells | battery capacity ×1.2 / build time ×1.3: Battery Bank | Battery Banks add a third, high-pressure tank. |
| `mliBlankets` (M, L) | ⚡ | 220 | — | −7% draw at night / +5% upkeep: all structures | Smelters, Refineries and Labs wear silver MLI blankets. |
| `waferPolishing` ✎ | ◆ | 250 | Wafer Fabrication | +10% output: Chip Fab / +30% upkeep: Chip Fab | Chip Fabs add a glass-roofed wafer-polishing annex. |
| `oreSorting` ✎ | ◆ | 220 | Grizzly Screens | +10% output: Regolith Excavator / +30% upkeep: Regolith Excavator | Excavators mount an optical ore-sorting hood over the bucket wheel. |
| `heatedAugers` (P) | ⌂ | 230 | Sublimation Tents | +15% output: Ice Harvester / +30% upkeep: Ice Harvester | Ice Harvesters sink a second, heated auger. |
| `growLights` *crew* | ⌂ | 220 | — | +15% output: Hydroponics Farm / +20% draw: Hydroponics Farm | Hydroponics vaults glow with LED grow-light strips. |

### 3.5 Era 5 · LUNAR COMPUTE (+7)

| id | lane | data | requires | pro / con | visual |
|---|---|---|---|---|---|
| `wingExtensions` | ⚡ | 400 + 30◇ | MPPT Inverters | +10% power: Solar Array / +20% upkeep: Solar Array, build time ×1.2: Solar Array | Solar Array wings grow a fifth row of cells. |
| `deployableRadiators` | ⚡ | 400 + 40◆ | — | −8% draw: Regolith Smelter, Silicon Refinery, Chip Fab / +20% upkeep: the same | Smelters, Refineries and Chip Fabs unfold extra radiator wings. |
| `oxygenLiquefaction` | ◆ | 380 | Slag Recycling | +10% output: Regolith Smelter / +15% draw: Regolith Smelter | Smelters add a cold-box liquefier and a spherical LOX tank. |
| `immersionLitho` | ◆ | 420 + 5▣ | Wafer Polishing | +12% output: Chip Fab / +10% inputs: Chip Fab | Chip Fabs raise an immersion-lithography tower. |
| `toolChangers` ✎ | ◉ | 380 | Parts Fabrication | +15% output: Parts Fabricator / +10% inputs: Parts Fabricator | Parts Fabricators add a tool-changer carousel on the roof. |
| `nutrientRecirculation` *crew* | ⌂ | 380 | LED Grow Lights | −30% inputs: Hydroponics Farm / +30% upkeep: Hydroponics Farm | Hydroponics farms add a row of nutrient recirculation tanks. |
| `gravimetry` | ◎ | 360 | Neutron Spectrometry | survey data ×1.2 / −1 kW: Lander | The Lander raises a gravimeter mast. |

### 3.6 Era 6 · HUMAN HABITATION (+6)

| id | lane | data | requires | pro / con | visual |
|---|---|---|---|---|---|
| `solidStateCells` | ⚡ | 950 + 20◇ | Stacked Cell Racks | battery capacity ×1.3 / build time ×1.5: Battery Bank | Battery Banks seal their cells in solid-state vaults. |
| `highBurnupFuel` | ⚡ | 1000 + 30⚙ | Brayton Converters | +10% power: Thorium Reactor / −2 morale: Thorium Reactor | Thorium Reactors raise a fuel-handling crane over the dome. |
| `refractoryLinings` | ◆ | 950 + 40◆ | Slag Recycling | −25% upkeep: Regolith Smelter, Silicon Refinery / build time ×1.3: the same | Smelter stacks and Refinery columns are banded with refractory courses. |
| `predictiveMaintenance` | ◉ | 1000 + 10▣ | Parts Fabrication | wear heals ×1.3 / −2 kW: Lander | Robotics Bays raise a diagnostics mast with a beacon. |
| `uplinkDishes` | ▣ | 950 + 10▣ | Cryo Sample Store | +10% output: Research Lab / +15% draw: Research Lab | Research Labs raise a second uplink dish. |
| `galleyGarden` *crew* (robotic → E7 · 1000) | ⌂ | 900 | LED Grow Lights | +3 morale: Hydroponics Farm / +15% draw: Hydroponics Farm | Hydroponics farms open a galley bay with a picture window. |

### 3.7 Era 7 · SWARM INDUSTRY (+7)

| id | lane | data | requires | pro / con | visual |
|---|---|---|---|---|---|
| `superconductingBus` | ⚡ | 1100 + 60◆ | Cryo Radiators | −8% draw: Chip Fab, Data Center, Foil Factory / +20% upkeep: the same | Data Centers, Chip Fabs and Foil Factories run superconducting bus ducts. |
| `rollToRoll` ✎ | ◆ | 1100 | Thin-Film Foils | +12% output: Foil Factory / +10% inputs: Foil Factory | Foil Factories add a second roll-to-roll coating line. |
| `foilAnnealing` | ◆ | 1100 | Thin-Film Foils | −15% draw: Foil Factory / +30% upkeep: Foil Factory | Foil Factories raise annealing ovens on the roof. |
| `liquidCooling` ✎ | ▣ | 1100 + 40◆ | Lunar Data Center | −12% draw: Data Center / +25% upkeep: Data Center | Data Centers run coolant manifolds to a pump skid. |
| `rackDensification` | ▣ | 1150 + 10▣ | Lunar Data Center | +12% output: Data Center / +15% draw: Data Center | Data Centers add a rack annex at the berm. |
| `lowGCourt` (human) | ⌂ | 1000 | Crew Wellness Program | +4 morale: Recreation Dome / +40% inputs: Recreation Dome | Recreation Domes add a low-g court annex under a glass vault. |
| `laserRanging` | ◎ | 1000 | Far-Side Relay | survey data ×1.2 / −1.5 kW: Lander | The Lander adds a laser-ranging telescope dome. |

### 3.8 Era 8 · DYSON SWARM, lane-free column (+3)

| id | data | requires | pro / con | visual |
|---|---|---|---|---|
| `railCapacitors` | 2400 | Electromagnetic Mass Driver | −20% draw: Mass Driver / +40% upkeep: Mass Driver | Mass Drivers line their rail with capacitor banks. |
| `cryocoolerHeads` | 2400 | Propellant Depot | +15% output: Propellant Plant / +20% draw: Propellant Plant | Propellant Plants cap their tanks with cryocooler heads. |
| `canisterPress` | 2200 | Thin-Film Foils | +10% output: Foil Factory / +30% upkeep: Foil Factory | Foil Factories add a canister press at the loading dock. |

In the Era-8 column the pre-capstone techs sit above Swarm Protocol (still
the double-height capstone, centred) and the swarmPurpose pair below it.

### 3.9 New insights (in-base deeds; era 1 still has none)

| Tech | Discount | Deed |
|---|---|---|
| MPPT Inverters | −30% | 6 Solar Arrays operating |
| Heat-Recovery Jackets | −30% | 200◆ smelted |
| Neutron Spectrometry | −40% | 3 prospects surveyed |
| Stacked Cell Racks | −30% | 2 nights with load shed |
| Slag Recycling | −30% | 600◆ smelted |
| Reflux Columns | −30% | 300◇ refined |
| Cryo Sample Store | −30% | 4 labs operating |
| Brayton Converters | −30% | 3 nights survived |
| Wafer Polishing | −30% | 50▣ fabbed |
| Ore Sorting | −30% | 4 excavators operating |
| Tool Changers | −30% | 500⚙ fabricated |
| Roll-to-Roll Coating | −30% | 30▰ manufactured |
| Liquid Cooling | −30% | a Data Center has operated 2,160 s |

## 4. Visuals for the 47 existing techs

A pure unlock's visual is the building it unlocks. Everything else gets a
mesh part on the buildings its effects touch (the Lander for survey tiers,
whose con is Lander draw).

| Tech | visual |
|---|---|
| Regolith Smelting | Regolith Smelters can rise: a furnace hall with twin stacks. |
| Earth Teleoperation | The Lander raises a second, larger Earth dish for the teleoperators. |
| Prospecting Rovers | A rover charging dock appears beside the Lander, and Relay Masts can rise. |
| Site Grading | Graded pads show as raked, flattened ground under your large structures. |
| Cryo Ice Extraction | Ice Harvesters can rise: a drill derrick over the cold trap. |
| Solar-Wind Volatiles | Excavators carry a heated volatiles retort with a cold-trap tank. |
| Battery Banks | Battery Banks can rise: three cell cabinets with radiator lids. |
| Thermal Wadis | Solar Arrays each bank a sintered-regolith heat wadi at their feet. |
| Vertical Solar Masts | Solar Arrays climb onto 10 m lattice masts. |
| Skylight Heliostats | Each Solar Array gains a heliostat mirror on a boom. |
| Silicon Refining | Silicon Refineries can rise: three distillation columns. |
| Parts Fabrication | Parts Fabricators can rise: a sawtooth-roofed machine shop. |
| Construction Robotics | Robotics Bays can rise, a rover on charge at the side door. |
| Regolith Shielding | Regolith berms are bulldozed against every shielded wall. (already shipped, `berms.ts`) |
| Molten Regolith Electrolysis | Smelters grow an electrolysis cell with heavy busbars. |
| Ilmenite Beneficiation | Excavators carry a magnetic separator drum. |
| Thorium Reactor | Thorium Reactors can rise: a domed drum ringed with radiator petals. |
| Regenerative Fuel Cells | Battery Banks sprout paired hydrogen and oxygen tanks. |
| Swarm Robotics | Robotics Bays add a rooftop rack of swarm charging cradles. |
| Heavy Constructors | Robotics Bays raise a heavy gantry crane. |
| Dust Mitigation | Solar Arrays sprout electrostatic curtain wands and excavators wear dust skirts. (plus the shipped clean-glass film) |
| Lava-Tube Caverns | Habitats, Data Centers and Chip Fabs pile a sandbag overburden on their roofs. |
| Wafer Fabrication | Chip Fabs can rise: a long cleanroom hall with twin exhaust stacks. |
| Accelerator Design | Data Centers mount accelerator cooling towers on the roof. |
| Rad-Hard Process | Chip Fabs add a shielded ion-implanter annex. |
| Cleanroom Robotics | Chip Fabs gain a sealed wafer-transfer tunnel and a handling arm. |
| Orbital Prospector | The Lander adds a tracking dish for the polar orbiter. |
| Volcanic Glass Reduction | Smelters raise a hopper for orange volcanic glass beads. |
| Lunar Data Center | Data Centers can rise: bermed racks under black-sky radiators. |
| Dynamic Clocking | Chip Fabs and Data Centers mount boost radiators for overclocking. |
| Cryo Radiators | Data Centers unfold a second tier of cryo radiator fins. |
| Crew Wellness Program | Recreation Domes can rise: a great glass-banded dome. |
| Human Cohabitation | Habitats and Hydroponics Farms can rise for the first crew. |
| Closed-Loop Life Support | Habitats add a CO₂ scrubber stack and water-recovery tanks. |
| Safety Protocols | Inspection lamp masts go up beside Habitats and the Lander. |
| Condition Optimization | Excavators, Smelters, Refineries and Ice Harvesters sprout sensor masts. |
| Science Crews | Research Labs raise a glazed observation cupola. |
| Far-Side Relay | The Lander raises a lattice mast for the far-side relay link. |
| Cold-Trap Chemistry | Hydroponics Farms and Propellant Plants rack process-gas bottles. |
| Thin-Film Foils | Foil Factories can rise: a coating hall with a foil-roll dock. |
| Electromagnetic Mass Driver | Mass Drivers can rise: a 20 m inclined coil rail. |
| Propellant Depot | Propellant Plants can rise: twin foil-banded tanks. |
| Self-Replicating Systems | Parts Fabricators and Robotics Bays grow replicator assembly arms. |
| Deep Sounding Network | A ring of seismometer pods is set out around the Lander. |
| Swarm Protocol | Mass Drivers and Propellant Plants raise a swarm-tracking beacon mast. |
| Power Beaming Return | A rectenna mesh unfolds beside the Lander. |
| Von Neumann Foundry | Foil Factories sprout seed-factory pods on the roof. |

## 5. Lane budget (per run) and where the other branches slot in

Lane heights come from the per-run maximum cell count. After this design
(counting site- and expedition-filtered techs only where they show):

| Lane | E1 | E2 | E3 | E4 | E5 | E6 | E7 | rows |
|---|---|---|---|---|---|---|---|---|
| ⚡ POWER | 1 | 3 | 3 | 3 (P 2) | 3 | 2 | 1 | 3 |
| ◆ MATERIALS | 2 | 3 (P 2) | 2 | 3 | 2 | 2 | 3 | 3 |
| ◉ ROBOTS & FAB | 1 (P, L 2) | 2 | 2 | 1 | 1 | 2 | 1 | **2** |
| ▣ SILICON & COMPUTE | 1 | 1 | 2 | 2 | 2 | 2 | 2 | **2** |
| ⌂ HABITAT | 1 | 1 (P 2) | 1 | 1 (P 2) | 1 (human 2) | 2 | 2 (human 1) | 2 |
| ◎ EXPLORATION | 2 | 1 | 1 | 2 | 1 | 2 | 2 | 2 |
| ↑ EXPORT | — | — | — | — | — | — | 2 | 2 |

**16 slots** per run. ◉ and ▣ are held at 2 so that one automation tech per
era (E2–E7) in each of them adds exactly one row each: **18 slots**, which
fits 1280×720 at ≥ 28 px (§7). Free cells after automation takes one per
era: ◉ E1 (mare), E4, E5, E7 and ▣ E1 still have a spare row — the right
place for the fleet branch's 1–2 techs. Anything beyond 18 slots is packed
by the layout's overflow rule (§7) instead of breaking the fit.

Visible techs per run (after site and expedition filters; doctrine rivals
and breakthrough placeholders counted): robotic mare 83, pole 84, lava
tube 84; human mare 83, pole 84, lava tube 84. That is about 11 per era,
of which a charter needs 4.

## 6. Upgrade geometry

**Data.** `src/buildings/upgrades.ts` maps each building type to an ordered
list of `{ tech, parts(), mounts? }`. `parts()` returns meshKit geometry in
the building's own frame (base at y = 0, door side +z) built only from the
existing finishes (BODY, TRIM, GLASS, WINDOW, LAMP, BEACON, RADIATOR, FOIL,
PLATE), so both render styles colour them unchanged. `mounts` edits the
moving parts: an extra Earth dish (Teleoperation, Orbital Prospector, Uplink
Dishes), a raised pivot (Vertical Solar Masts), a wider wing (Wing
Extensions).

**Key.** `upgradeKey(type, techsDone)` is the comma-joined list of that
type's upgrade techs that are done, in list order (`''` = stock).
`recipeGeometry(type, key)` merges the base recipe with those parts and
caches by `type|key`; `mountsFor(type, key)` does the same for moving parts.

**Instances.** `BuildingInstances.rebuild(state)` computes each type's key
and, only when it differs from the key its mesh was built with, swaps the
InstancedMesh's geometry for the new recipe view — reusing the mesh (so the
instance matrices, instance colours, material, custom depth material and
shadow flags stay) and the same `iState` attribute object (per-instance
lit / dust / wear / cut). Nothing is rebuilt per frame; a tech completing
changes at most the few types it touches. The trackers take mounts per
placed building, so an extra dish appears on every lab at once.

**Ghosts and scaffolds.** The placement ghost is built from
`ghostGeometry(type, key)` for the run's current key (and swapped if a tech
completes mid-placement); the scaffold and the print reveal use the
upgraded recipe's height, so a lab with a cupola prints to the top of it.

**Save/load.** The key is derived from `techsDone`, which the save already
holds, so a loaded base shows exactly the upgrades it had. Nothing new is
saved.

**Budget.** Each upgrade part is at most a few hundred triangles (most are
40–250). Base recipes are 500–2,800 triangles; the fully upgraded totals
per type are recorded in [04-buildings.md](04-buildings.md) and checked by a
test (every fully upgraded type ≤ 6,000 triangles, every single upgrade ≤ 600).

## 7. Tree UI fit

- **Adaptive sheet.** `--sheet-h = clamp(112px, 100cqh − 74px − slots × 28px, 148px)`:
  the detail sheet gives up height before the slots fall under 28 px. At
  1280×720 with 16 slots the sheet keeps its 148 px (slots 30.4 px); at 18
  slots it is 130 px and slots are exactly 28 px.
- **Overflow packing (safety valve).** If the per-run slot count still
  exceeds what fits at 28 px, the layout lowers the tallest lanes' row counts
  until it fits, and a cell holding more cards than its lane has rows packs
  them at `rows / count` slot height as **compact** single-line cards
  (glyph, name, cost). Never needed by this tree alone; it keeps the merged
  ~104-tech tree on one screen.
- **Era 8 column.** Pre-capstone techs (single height) above the capstone,
  the swarmPurpose pair below, the block centred as before.
- The design language of 07 §6 is unchanged: two-line cards, state by shape
  and value, the same link routing.

## 8. Pacing plan

- The probe (`scripts/probe-pacing.mjs`, reasonable policy, 3 seeds) already
  handles new techs generically: its priority list is followed by the rest
  of `TECH_ORDER`, so once an era's priority techs are queued the player
  picks up that era's small steps first. With a 4-tech charter those small
  steps are what opens the next era.
- Each era's research throughput is set by the policy's lab and DC counts,
  not by the clock, so an era's length is its researched data over its
  rate. Doubling eras means doubling the data researched per era: the charter
  (4 instead of 2) roughly doubles the techs, and `ERA_COST_SCALE` absorbs
  the rest. Throughput gains from the new techs (three +10% lab steps, DC
  steps, four survey-data steps) are paid back in the scale.
- Tuning order: deeds first (they must arrive late in their era), then
  `ERA_COST_SCALE[1..8]` in ±10% steps until robotic mare lands at 210 ± 25
  with every era 25–30 min, then the other four runs are checked against
  +30%.
- Results (before/after, per-era) are recorded in §11 once measured.

## 9. Save migration (techSchema 2 → 3)

- `migrateTechSchema` runs the 1 → 2 step as today, then the 2 → 3 step:
  it sets `techSchema = 3`, keeps `techsDone`, `researchSpent`, the queue
  (re-sanitized) and the era (**never lowered** — `era = max(stored,
  computeEra)`, so a save already in era 5 stays there even though the new
  charter asks for 4 techs), and raises `RESEARCH TREE EXPANDED — 43 new
  techs; nothing you researched is lost` (info).
- New techs simply appear in their eras; no tech is renamed or retired, no
  data is refunded, no doctrine is granted.
- New games start at `techSchema: 3`.

## 10. Tests

- Counts 47 → 90 and every test that assumed the 2-tech charter (they now
  complete 4 techs of the era, or 2 plus the scaled deed), keeping intent.
- Every tech has a non-empty `visual`; `auditTechs` gives every tech ≥ 1 pro
  and ≥ 1 con; no visible tech fails `techRelevance` at any site ×
  expedition.
- Completing a tech with a visual changes its building type's upgrade key
  and triangle count, the placement ghost matches, and a save round-trip
  restores the same key and geometry.
- The 1280×720 and 1600×900 fit tests, plus a forced-overflow viewport
  where compact packing must still leave no overlaps and nothing off screen.
- Doctrine follow-ups are foreclosed with their doctrine.

## 11. Results

Filled in by Phase B (see the commit that tunes pacing).
