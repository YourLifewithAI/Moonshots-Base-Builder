# 03 · Tech Tree

The research tree is **129 technologies in 7 swimlanes across 8 eras**, built
around the realistic rollout of lunar construction: robots land and build
first, and humans arrive only once the machines have made the base worth
inhabiting. Most eras hold two or three big unlocks and a run of small,
concrete steps (+10% smelter output, a second lab dish), and **every tech
visibly changes the buildings it affects**: its `visual` line names the part
it adds (`src/buildings/upgrades.ts`; per building in
[04-buildings.md](04-buildings.md)). The full design rationale, pacing model
and test plan live in [11-research-and-map-spec.md](11-research-and-map-spec.md)
§2–§3, the expansion in [12-tree-expansion.md](12-tree-expansion.md) and the
destiny tracks in [14-destiny-tracks.md](14-destiny-tracks.md); this
page is the player-facing summary plus tables generated from
`src/data/techs.ts`.

`src/core/research.ts` is the single source of truth for availability, cost,
the queue and era progress. The UI (`src/ui/techTree.ts`), the economy tick,
debug hooks and tests all call into it; nothing else recomputes them.

## Eras and lanes

| Era | Name | The game becomes about… |
|---|---|---|
| 1 | FIRST LANDING | smelting, ice, grading and survey on the lander's cache |
| 2 | EARLY CONSTRUCTION | surviving the night; silicon, parts, construction robotics |
| 3 | ROBOTIC FABRICATION | baseload power, a workforce of machines, the first breakthrough |
| 4 | CHIP FABRICATION | vacuum cleanrooms and what your chips are for |
| 5 | LUNAR COMPUTE | Data Centers under regolith; research that scales |
| 6 | HUMAN HABITATION | people: life support, wellness, safety, science crews |
| 7 | SWARM INDUSTRY | foils, the launch architecture, self-replication |
| 8 | DYSON SWARM | the swarm protocol, and what the swarm is for |

The seven lanes are rows on the tree screen: ⚡ POWER, ◆ MATERIALS,
◉ ROBOTS & FAB, ▣ SILICON & COMPUTE, ⌂ HABITAT, ◎ EXPLORATION (map tiers and
the three breakthrough slots) and ↑ EXPORT. Era 8 is a lane-free capstone
column (★ below).

## The rules

1. **Charters.** Era N opens once **4 techs of era N−1** are done, or **2 of
   them plus that era's deed** (a production milestone such as "450◆ smelted",
   or "a Data Center held a full night with every priority-0/1 load powered").
   From Era 3 on, **era N−1's destiny pick must be one of them**. The deed
   routes teach the loop of each era; the tree header shows both routes'
   progress. On robotic runs, era 7 also requires Human Cohabitation, which
   either Era 6 pick settles.
2. **Destiny.** Each era has one ⌂ Colony / ◉ Automation pick in its page
   header (docs/14). The landing is Era 1's and never counts toward Era 2.
   Queuing one side forecloses the other until you cancel; done is permanent.
   Six of eight on one side make a pure destiny and its capstone (Lunar
   Commonwealth, Selenic Mind); anything else is Concord.
3. **Prerequisites** (`requires`) always apply; `requiresAny` needs one member
   of a set (for example either night-power doctrine, or Swarm Protocol's
   Era 8 pick).
4. **Doctrines** are six permanent either/or picks (◈). Queuing one member
   forecloses the other until you cancel; completing it forecloses the other
   for the rest of the run. Data already spent on an abandoned pick is kept.
   Each site has a natural answer, shown on the bracket.
5. **Goods.** Many techs also cost manufactured goods. Missing goods never
   block queueing: the data is paid first, then the tech waits for the goods
   with a `RESEARCH WAITING` alert that names the producer.
6. **Research transfer.** Data accrues in a bank (labs, Data Centers, surveys,
   flares, the Daedalus radio outpost) and flows into the queue at up to
   0.4/s per lab plus 2.5/s per Data Center (2.2/s per Server Monolith). Agent-run labs share one Earth
   uplink, so the fifth and later labs add less. The queue holds 5.
7. **Insights** (✎). In-base deeds discount specific techs by up to 50%, for
   example "a night with any load shed" makes Battery Banks 40% cheaper. They
   fire even while the tech is locked, and there are none in era 1.
8. **Breakthroughs** (✦). Three techs are hidden until you survey a host
   prospect on the Lunar Map ([M]). Each has a fixed slot in the Exploration
   lane and a fixed era; one found early waits for its era.
9. **Robotic runs.** Some techs resolve into a different era or cost on
   robotic expeditions. Human-comfort techs (farms, wellness) are visible but
   locked until Human Cohabitation brings a crew rotation aboard. The first
   ⌂ Colony pick from Era 3 on brings Cohabitation forward (it never counts
   toward a charter); the Era 6 ◉ pick waives it for Era 7.

## Verbs the tree unlocks

- **Overclock** (inspector toggle): a station runs ×1.5 at extra power and
  wear.
- **Downlink** (lander): sell banked data to Earth for a cargo drop.
- **Crew rotation** (Human Cohabitation on robotic runs, or a ⌂ pick that
  brings it forward): settlers arrive and crewed stations stop paying the
  agent power tax.
- **Launch day** (⌂ Crewed Mission Control): a volley takes 2↑ with 4 crew on
  console, and lifts morale for a lunar day. **Autonomous Cadence** (◉) fires
  volleys itself once the bank keeps the night's reserve.
- **Survey / claim / abandon** on the Lunar Map: surveys borrow a rover
  (never a pinned one) and pay data with novelty decay; outposts stream
  resources for hopper fuel and upkeep.
- **Fleet capability** (not a doctrine, so every run has it): Rover Autonomy
  (Era 4) builds +25% faster per rover at ×1.3 construction draw; Autonomous
  Haulage (Era 5) drives excavators ×1.3 with a ×1.25 bucket at +25% draw and
  +20% upkeep. The doctrines keep the rover counts: Construction Robotics'
  Robotics Bay (+2), Swarm Robotics (+1 per Bay) against Heavy Constructors
  (×2.2 per rover, −1 per Bay), and Self-Replication (+1 per Bay).

## The tree

The tables below are regenerated by `node scripts/gen-tech-doc.mjs` (use
`--check` in CI to fail on a stale page). Do not edit between the markers.

<!-- BEGIN GENERATED: node scripts/gen-tech-doc.mjs -->
Costs are data after `ERA_COST_SCALE`; `robotic →` marks the resolved era and cost on robotic
runs. Pros and cons are generated by `describeTech()` exactly as the tree cards show them
(no site filter, human crew). ✎ = an insight discount can be earned in-base; ◈ = doctrine pick;
⌂ / ◉ = the era's destiny pick (docs/14), ★ in the Lane column = a pick or the Era 8 capstone column.
Hazard hooks (`exposure`, `guard`) carry no card line until the hazards ship.

### Era 1 · FIRST LANDING

**Destiny · Who goes to the Moon?** ⌂ Crewed Landing or ◉ Robotic Mission — chosen on the landing screen.

| Tech | Lane | Data | Goods | Requires | Pros | Cons | Visual |
|---|---|---|---|---|---|---|---|
| **Regolith Smelting** | ◆ | 48 | — | — | UNLOCK Regolith Smelter<br>makes 0.5◆ + 0.25○ + 0.05≈/s | −12 kW<br>eats 2▲/s<br>2⚙/day upkeep<br>2 crew<br>40◆ 10⚙ to build | Regolith Smelters can rise: a furnace hall with twin stacks. |
| **Earth Teleoperation** | ◉ | 192 | — | — | builds 15% faster<br>NEW ACTION downlink: 150≡ → 60◆ 20⚙ 5▣ | each downlink spends 150 + 50·n banked data<br>−10% output: Research Lab | The Lander raises a second, larger Earth dish for the teleoperators. |
| **Prospecting Rovers** | ◎ | 160 | — | — | MAP T1 REGIONAL: local reveal 320 m, Moon map ≤27°, hopper surveys<br>UNLOCK Relay Mast<br>extends the build network 45 m | every survey borrows 1 rover (never a pinned one) for its duration<br>−1.5 kW<br>0.5⚙/day upkeep<br>20◆ 5⚙ to build<br>−1 kW: Lander | A rover charging dock appears beside the Lander, and Relay Masts can rise. |
| **Site Grading**<br><sub>sites: SHACKLETON RIM, MARIUS HILLS TUBE</sub> | ◉ | 144 | — | — | NEW TOOL grade 16×16 m pads (≤0.8 m relief for large pads) | 40 stored energy per pass | Graded pads show as raked, flattened ground under your large structures. |
| **Cryo Ice Extraction**<br><sub>sites: SHACKLETON RIM</sub> | ⌂ | 208 | — | — | UNLOCK Ice Harvester<br>makes 0.4≈/s | −8 kW<br>2⚙/day upkeep<br>1 crew<br>25◆ 5⚙ to build | Ice Harvesters can rise: a drill derrick over the cold trap. |
| **Solar-Wind Volatiles**<br><sub>sites: ILMENITE PLAINS, MARIUS HILLS TUBE</sub> | ⌂ | 160 | — | — | Regolith Excavator: +0.02≈/s | Regolith Excavator: −9 kW (was −6) | Excavators carry a heated volatiles retort with a cold-trap tank. |
| **Bifacial Cells** | ⚡ | 128 | — | — | +8% power: Solar Array | build time ×1.25: Solar Array | Solar Arrays lay a white reflector apron beneath their wings. |
| **Grizzly Screens** | ◆ | 112 | — | — | +10% output: Regolith Excavator | +15% draw: Regolith Excavator | Excavators carry a slotted grizzly screen over the back deck. |
| **Sample-Return Caches** | ◎ | 144 | — | Prospecting Rovers | survey data ×1.25 | −0.5 kW: Lander | A sample-cache carousel stands beside the Lander’s ladder. |
| **Field Spectrometers** | ▣ | 144 | — | — | +10% output: Research Lab | +20% draw: Research Lab | Research Labs bolt a spectrometer turret onto the roof. |
| **Crewed Landing**<br><sub>human only · ⌂ COLONY · the Era 1 destiny (the landing)</sub> | ★ | 0 | — | — | — | — | The Lander flies a flag, and its crew cabin shows a lit window band. |
| **Robotic Mission**<br><sub>robotic only · ◉ AUTOMATION · the Era 1 destiny (the landing)</sub> | ★ | 0 | — | — | — | — | The Lander’s cabin windows are blanked, and a rover cradle rides the deck. |

### Era 2 · EARLY CONSTRUCTION

Opens with 4 techs of era 1, or 2 plus the deed: **450◆ smelted**.

**Destiny · Who are these halls built for?** ⌂ Pressure-Rated Halls or ◉ Dispatch Mesh.

| Tech | Lane | Data | Goods | Requires | Pros | Cons | Visual |
|---|---|---|---|---|---|---|---|
| **Battery Banks** | ⚡ | 220<br><sub>✎ −40%: a night with any load shed</sub> | — | — | UNLOCK Battery Bank<br>stores 3,000 energy | 15% round-trip loss<br>1⚙/day upkeep<br>50◆ 10◇ to build | Battery Banks can rise: three cell cabinets with radiator lids. |
| **Thermal Wadis**<br><sub>sites: ILMENITE PLAINS</sub> | ⚡ | 240<br><sub>✎ −40%: a building held dark ≥60 s at night</sub> | — | — | −15% draw at night | +5% draw by day | Solar Arrays each bank a sintered-regolith heat wadi at their feet. |
| **Vertical Solar Masts**<br><sub>sites: SHACKLETON RIM</sub> | ⚡ | 260<br><sub>✎ −40%: an array shaded ≥60 s</sub> | 20◆ | Prospecting Rovers | solar arrays ignore terrain shade<br>+10% power: Solar Array | build time ×1.5: Solar Array<br>+30% upkeep: Solar Array | Solar Arrays climb onto 10 m lattice masts. |
| **Skylight Heliostats**<br><sub>sites: MARIUS HILLS TUBE</sub> | ⚡ | 260<br><sub>✎ −40%: a daytime brownout</sub> | 20◆ | Prospecting Rovers | +25% power: Solar Array | +50% solar dust | Each Solar Array gains a heliostat mirror on a boom. |
| **Silicon Refining** | ▣ | 260<br><sub>✎ −30%: 150▲ in stock</sub> | — | Regolith Smelting | UNLOCK Silicon Refinery<br>makes 0.4◇/s | −14 kW<br>eats 2▲/s<br>2⚙/day upkeep<br>2 crew<br>50◆ 15⚙ to build | Silicon Refineries can rise: three distillation columns. |
| **Parts Fabrication** | ◉ | 220<br><sub>✎ −40%: parts below 20</sub> | — | Regolith Smelting | UNLOCK Parts Fabricator<br>makes 0.2⚙/s | −10 kW<br>eats 0.3◆/s<br>1⚙/day upkeep<br>1 crew<br>60◆ to build | Parts Fabricators can rise: a sawtooth-roofed machine shop. |
| **Construction Robotics** | ◉ | 260<br><sub>✎ −40%: 5 buildings completed</sub> | — | any of Earth Teleoperation / Prospecting Rovers | UNLOCK Robotics Bay<br>+2 construction rovers<br>NEW TOGGLE Crewed / Autonomous on every station | −3 kW<br>1⚙/day upkeep<br>40◆ 10⚙ to build<br>agent-run stations draw ×1.6 | Robotics Bays can rise, a rover on charge at the side door. |
| **Regolith Shielding** | ⌂ | 280<br><sub>✎ −40%: a flare goes active with ≥6 structures running</sub> | — | any of Site Grading / Construction Robotics | −15% upkeep: all structures<br>BREACH: micrometeorite pitting ×0.5 | wear heals ×0.5 | Regolith berms are bulldozed against every shielded wall. |
| **Molten Regolith Electrolysis**<br><sub>◈ How hard do you push the furnace?</sub> | ◆ | 300<br><sub>✎ −30%: 300◆ smelted</sub> | 10⚙ | Regolith Smelting | Regolith Smelter: +0.15◆/s<br>Regolith Smelter: +0.15○/s<br>Regolith Smelter: +0.04◇/s<br>Regolith Smelter melts any soil (feed-insensitive) | Regolith Smelter: no water (was 0.05≈/s)<br>Regolith Smelter: −22 kW (was −12)<br>+50% upkeep: Regolith Smelter | Smelters grow an electrolysis cell with heavy busbars. |
| **Ilmenite Beneficiation**<br><sub>◈ How hard do you push the furnace? · sites: ILMENITE PLAINS, MARIUS HILLS TUBE</sub> | ◆ | 280<br><sub>✎ −40%: an excavator digging ilmenite for 60 s</sub> | — | Regolith Smelting, Prospecting Rovers | ilmenite feed ×2: H₂ smelter yield +60% per unit share<br>−20% inputs: Regolith Smelter | +30% draw: Regolith Excavator | Excavators carry a magnetic separator drum. |
| **MPPT Inverters** | ⚡ | 220<br><sub>✎ −30%: 6 Solar Arrays operating</sub> | — | Bifacial Cells | +8% power: Solar Array | +25% upkeep: Solar Array | Solar Arrays hang a finned inverter cabinet on the pedestal. |
| **Heat-Recovery Jackets** | ◆ | 240<br><sub>✎ −30%: 200◆ smelted</sub> | — | Regolith Smelting | −12% draw: Regolith Smelter | +25% upkeep: Regolith Smelter | Smelter stacks wrap in foil heat-recovery jackets. |
| **Sublimation Tents**<br><sub>sites: SHACKLETON RIM</sub> | ⌂ | 240 | — | Cryo Ice Extraction | +15% output: Ice Harvester | +20% draw: Ice Harvester | Ice Harvesters pitch a foil sublimation tent over the dig. |
| **Neutron Spectrometry** | ◎ | 220<br><sub>✎ −40%: 3 prospects surveyed</sub> | — | Sample-Return Caches | survey data ×1.2 | +40% draw: Relay Mast | Relay Masts hang a neutron-spectrometer boom. |
| **Bench Robots**<br><sub>human only</sub> | ▣ | 200 | — | — | −1 crew: Research Lab | +25% draw: Research Lab | Research Labs fit a robot sample bench behind a new window bay. |
| **Build Orders** | ◉ | 240 | — | Earth Teleoperation | NEW ORDER BOOK: 4 held orders, up to ×10 each — orders wait for stock instead of skipping | held orders take stock the moment it lands<br>−1 kW: Lander | The Lander raises a planning mast: a pole with a work lamp beside its top deck. |
| **Pressure-Rated Halls**<br><sub>⌂ COLONY · the Era 2 destiny</sub> | ★ | 240 | 20◆ | — | −20% upkeep: Research Lab, Parts Fabricator, Robotics Bay<br>wear heals ×1.15<br>+2 morale: Research Lab (with crew)<br>Suitports: DUST ×0.5 | build time ×1.3: Research Lab, Parts Fabricator, Robotics Bay<br>BREACH: Research Lab, Parts Fabricator, Robotics Bay hold air — a breach can kill<br>DUST: Research Lab, Parts Fabricator, Robotics Bay take in airlock dust — clogged filters wear the hull | Labs, Parts Fabricators and Robotics Bays gain an airlock porch with a lit round window. |
| **Dispatch Mesh**<br><sub>◉ AUTOMATION · the Era 2 destiny</sub> | ★ | 240 | 10⚙ | — | builds 12% faster<br>Relay Masts reach 60 m (from 45) | +40% draw: Relay Mast<br>−1 kW: Lander<br>MALWARE: Relay Mast, Robotics Bay, Lander are network nodes — an infected node can burn out | Robotics Bays and Relay Masts raise a mesh-radio whip with a blinking node lamp; the Lander gains a router cabinet. |

### Era 3 · ROBOTIC FABRICATION

Opens with 4 techs of era 2, or 2 plus the deed: **200⚙ fabricated**; one of them must be era 2's destiny pick, ⌂ Pressure-Rated Halls or ◉ Dispatch Mesh.

**Destiny · Who comes next: people, or more machines?** ⌂ Crew Rotation Charter or ◉ Drone Hives.

| Tech | Lane | Data | Goods | Requires | Pros | Cons | Visual |
|---|---|---|---|---|---|---|---|
| **Thorium Reactor**<br><sub>◈ How does the base survive the 14-day night?</sub> | ⚡ | 296<br><sub>✎ −30%: 2 nights survived</sub> | 80◆ | Regolith Shielding | UNLOCK Thorium Reactor<br>+40 kW | 4⚙/day upkeep<br>1 crew<br>-5 morale<br>120◆ 40⚙ to build | Thorium Reactors can rise: a domed drum ringed with radiator petals. |
| **Regenerative Fuel Cells**<br><sub>◈ How does the base survive the 14-day night?</sub> | ⚡ | 278<br><sub>✎ −40%: 100≈ banked</sub> | 80≈ | Battery Banks | battery capacity ×2 | grid round-trip 85% → 60% | Battery Banks sprout paired hydrogen and oxygen tanks. |
| **Swarm Robotics**<br><sub>◈ Many hands, or strong ones?</sub> | ◉ | 278<br><sub>✎ −30%: 3 sites waiting for robots at once</sub> | 20⚙ | Construction Robotics | +1 construction rover per Robotics Bay<br>builds 15% faster | construction draw ×1.5 (6 kW per working rover)<br>+50% upkeep: Robotics Bay | Robotics Bays add a rooftop rack of swarm charging cradles. |
| **Heavy Constructors**<br><sub>◈ Many hands, or strong ones?</sub> | ◉ | 278<br><sub>✎ −30%: 3 sites waiting for robots at once</sub> | 20⚙ | Construction Robotics | ×2.2 build rate per rover<br>−40% weld parts | −1 construction rover per Robotics Bay<br>construction draw ×2 (8 kW per working rover) | Robotics Bays raise a heavy gantry crane. |
| **Dust Mitigation** | ◆ | 296<br><sub>✎ −50%: an array at ≥25% dust</sub> | — | any of Parts Fabrication / Construction Robotics | −60% solar dust<br>−50% upkeep: Regolith Excavator<br>DUST in the airlocks ×0.4 | −5% power: Solar Array | Solar Arrays sprout electrostatic curtain wands and excavators wear dust skirts. |
| **Lava-Tube Caverns**<br><sub>✦ breakthrough — survey Tranquillitatis pit, Marius tube, Ingenii pit</sub> | ◎ | 352 | — | — | −15% draw: Habitat Module, Data Center<br>−30% upkeep: Habitat Module, Data Center, Chip Fab | build time ×1.3: Habitat Module, Data Center, Chip Fab | Habitats, Data Centers and Chip Fabs pile a sandbag overburden on their roofs. |
| **Stacked Cell Racks** | ⚡ | 296<br><sub>✎ −30%: 2 nights with load shed</sub> | 20◆ | Battery Banks | battery capacity ×1.25 | +40% upkeep: Battery Bank | Battery Banks stack a second tier of cells. |
| **Slag Recycling** | ◆ | 278<br><sub>✎ −30%: 600◆ smelted</sub> | — | Heat-Recovery Jackets | −12% inputs: Regolith Smelter | +20% upkeep: Regolith Smelter | Smelters run a slag conveyor out to a cooling bed. |
| **Reflux Columns** | ▣ | 296<br><sub>✎ −30%: 300◇ refined</sub> | — | Silicon Refining | +12% output: Silicon Refinery | +12% draw: Silicon Refinery | Silicon Refineries raise a fourth distillation column. |
| **Cryo Sample Store** | ▣ | 278<br><sub>✎ −30%: 4 labs operating</sub> | — | Field Spectrometers | +10% output: Research Lab | +40% upkeep: Research Lab | Research Labs stand a cryogenic sample dewar on the roof. |
| **Bunk Racks**<br><sub>crew tech (robotic: after Cohabitation)</sub> | ⌂ | 278 | — | — | +1 housing: Habitat Module | −2 morale: Habitat Module | Habitats bolt a bunk annex onto their airlock. |
| **Automated Excavation** | ◉ | 278 | 10⚙ | Build Orders | NEW RULE Excavation: +1 Regolith Excavator when regolith demand outruns supply by 6▲/min for 60 s (cap 6)<br>NEW RULE Excavation: +1 Ice Harvester when water demand outruns supply by 1.2≈/min for 60 s (cap 3) | the builder spends your stock unasked: 16◆ 4⚙ per Regolith Excavator<br>−1 kW: Robotics Bay | Robotics Bays grow a dispatch mast: a lattice tower with a beacon on the roof. |
| **Site Survey AI** | ▣ | 278 | — | Build Orders, Prospecting Rovers | auto sites weigh deposits, peaks of light and haul lanes (before: distance only) | +20% upkeep: Robotics Bay | A survey drone rests on a pad on each Robotics Bay roof. |
| **Basalt Paving** | ◆ | 278 | — | Regolith Smelting | +25% road travel (rovers and excavators)<br>−50% road dust | +20% road sintering time a cell | The roads turn to dark basalt pavers with a pale centre line. |
| **Crew Rotation Charter**<br><sub>⌂ COLONY · the Era 3 destiny</sub> | ★ | 278 | 30⚙ | — | brings Human Cohabitation forward: habitats and farms unlock; 2 settlers board in 4:00 if the base can keep them<br>settlers arrive ×1.5 as often<br>EVA crews by day (10% of free hands): dust clears ×1.3, repairs ×1.1 (with crew)<br>Earth contact: each rotation or resupply eases CABIN FEVER by 15 | the crew needs O₂, food, water and beds from now on<br>+20% draw: Habitat Module<br>DOSE: EVA crews are caught by flares — a dose can kill<br>CABIN FEVER: the crew grows restless — a crisis sends people home | Habitats wear a lit hab-ring collar and a suit-port porch; the Lander raises a crew-rotation beacon mast. |
| **Drone Hives**<br><sub>◉ AUTOMATION · the Era 3 destiny</sub> | ★ | 278 | 30⚙ | — | UNLOCK Drone Hive<br>+4 construction rovers<br>wear heals ×1.15<br>Hive re-flash: a Drone Hive re-flashes 2 rovers per 30 s | −7 kW<br>2⚙/day upkeep<br>60◆ 30⚙ to build<br>FIRMWARE: every drone takes the same push — a bricked rover can be lost | Drone Hives can rise: a honeycomb of docks under a landing deck. |

### Era 4 · CHIP FABRICATION

Opens with 4 techs of era 3, or 2 plus the deed: **600◇ refined**; one of them must be era 3's destiny pick, ⌂ Crew Rotation Charter or ◉ Drone Hives.

**Destiny · Does a fab need a window or a network?** ⌂ Hydroponic Commons or ◉ Lights-Out Fabs.

| Tech | Lane | Data | Goods | Requires | Pros | Cons | Visual |
|---|---|---|---|---|---|---|---|
| **Wafer Fabrication** | ◆ | 494<br><sub>✎ −30%: 150◇ in stock</sub> | 40◇ | Silicon Refining, Parts Fabrication | UNLOCK Chip Fab<br>makes 0.05▣/s | −18 kW<br>eats 0.15◇ + 0.02⚙/s<br>2⚙/day upkeep<br>2 crew<br>60◆ 30◇ 20⚙ to build | Chip Fabs can rise: a long cleanroom hall with twin exhaust stacks. |
| **Accelerator Design**<br><sub>◈ What are your chips for?</sub> | ▣ | 494 | 30◇ | Wafer Fabrication | +50% output: Data Center | +25% inputs: Chip Fab | Data Centers mount accelerator cooling towers on the roof. |
| **Rad-Hard Process**<br><sub>◈ What are your chips for?</sub> | ▣ | 494 | 30◇ | Wafer Fabrication | +40% output: Chip Fab<br>agent-run draw ×1.6 → ×1.36<br>flare bit flips ×0.5 | −15% output: Data Center | Chip Fabs add a shielded ion-implanter annex. |
| **Cleanroom Robotics** | ◉ | 532<br><sub>✎ −30%: first Chip Fab completes</sub> | 30⚙ | Wafer Fabrication, any of Swarm Robotics / Heavy Constructors | −30% draw: Chip Fab<br>−20% inputs: Chip Fab | +50% upkeep: Chip Fab | Chip Fabs gain a sealed wafer-transfer tunnel and a handling arm. |
| **Rover Autonomy** | ◉ | 456<br><sub>✎ −30%: 2 rovers on one site at once</sub> | 20⚙ | Construction Robotics | +25% build rate per rover | construction draw ×1.3 (5.2 kW per working rover) | Robotics Bays raise a navigation mast: a radar dome and the lidar heads the rovers plan their paths by. |
| **Orbital Prospector** | ◎ | 456<br><sub>✎ −40%: 3 regional prospects surveyed</sub> | 5▣ | Prospecting Rovers, Wafer Fabrication | MAP T2 NEAR SIDE: whole local map, near side, first outpost slot | −2 kW: Lander | The Lander adds a tracking dish for the polar orbiter. |
| **Volcanic Glass Reduction**<br><sub>✦ breakthrough — survey Taurus–Littrow, Aristarchus, Schrödinger</sub> | ◎ | 532 | — | — | +20% output: Regolith Smelter | +15% draw: Regolith Smelter | Smelters raise a hopper for orange volcanic glass beads. |
| **Brayton Converters** | ⚡ | 456<br><sub>✎ −30%: 3 nights survived</sub> | 20⚙ | Thorium Reactor | +12% power: Thorium Reactor | +25% upkeep: Thorium Reactor | Thorium Reactors add a Brayton turbine skid. |
| **High-Pressure Tanks** | ⚡ | 456 | 30◆ | Regenerative Fuel Cells | battery capacity ×1.2 | build time ×1.3: Battery Bank | Battery Banks add a third, high-pressure tank. |
| **MLI Blankets**<br><sub>sites: ILMENITE PLAINS, MARIUS HILLS TUBE</sub> | ⚡ | 418 | — | — | −7% draw at night | +5% upkeep: all structures | Smelters, Refineries and Labs wear silver MLI blankets. |
| **Wafer Polishing** | ◆ | 475<br><sub>✎ −30%: 50▣ fabbed</sub> | — | Wafer Fabrication | +10% output: Chip Fab | +30% upkeep: Chip Fab | Chip Fabs add a glass-roofed wafer-polishing annex. |
| **Optical Ore Sorting** | ◆ | 418<br><sub>✎ −30%: 4 excavators operating</sub> | — | Grizzly Screens | +10% output: Regolith Excavator | +30% upkeep: Regolith Excavator | Excavators mount an optical ore-sorting hood over the bucket wheel. |
| **Heated Augers**<br><sub>sites: SHACKLETON RIM</sub> | ⌂ | 437 | — | Sublimation Tents | +15% output: Ice Harvester | +30% upkeep: Ice Harvester | Ice Harvesters sink a second, heated auger. |
| **LED Grow Lights**<br><sub>crew tech (robotic: after Cohabitation)</sub> | ⌂ | 418 | — | — | +15% output: Hydroponics Farm | +20% draw: Hydroponics Farm | Hydroponics vaults glow with LED grow-light strips. |
| **Automated Power** | ⚡ | 456 | 20◆ | Automated Excavation | NEW RULE Power: +1 Solar Array when the day’s grid margin, the bank’s recharge paid, is under 10% for 30 s (cap 24)<br>NEW RULE Power: +1 Battery Bank at dawn after the bank ran dry (cap 6)<br>NEW RULE Power: a Thorium Reactor when the night runs 25 kW short (cap 1: raise it to let the builder add one) | the builder spends your stock unasked: 12◆ per Solar Array<br>+10% upkeep: Solar Array | Solar Arrays gain a combiner box with a status lamp at the foot of the mast. |
| **Budget Governor** | ▣ | 456 | 5▣ | Automated Excavation | RESERVES and PRIORITIES: floors the builder never spends below; queued research goods kept; rules act in your order; crisis sites jump the rover queue<br>a drifting rule never spends below your floors | rules wait for your floors — the builder acts later<br>+50% upkeep: Storage Yard | Storage Yards get a manifest gantry: a scanner bar on two legs spanning the racks. |
| **Automated Life Support**<br><sub>crew tech (robotic: after Cohabitation)</sub> | ◉ | 456<br><sub>robotic → E7 · 1294</sub> | 10⚙ | Automated Excavation | NEW RULE Life support: the oxygen maker when oxygen would last under 20 min (cap 5)<br>NEW RULE Life support: +1 Hydroponics Farm when food would last under 20 min (cap 4)<br>NEW RULE Life support: the water maker when water would last under 20 min (cap 3)<br>NEW RULE Life support: +1 Habitat Module when no bed is free for the next settler (cap 4) | the builder spends your stock unasked: the maker’s build cost<br>+10% draw: Habitat Module | Each Habitat Module gets an air-monitor mast by its door. |
| **Hydroponic Commons**<br><sub>⌂ COLONY · the Era 4 destiny</sub> | ★ | 456 | 30◆ | — | brings Human Cohabitation forward: habitats and farms unlock; 2 settlers board in 4:00 if the base can keep them<br>+15% output: Hydroponics Farm<br>+3 morale: Hydroponics Farm (with crew)<br>Commons meals: CABIN FEVER −10/day while a farm runs | the crew needs O₂, food, water and beds from now on<br>+25% inputs: Hydroponics Farm<br>BLIGHT: farms within 24 m share air — a blight can starve the crew | Hydroponics vaults open a glazed galley end with long tables, and a trellis runs the vault. |
| **Lights-Out Fabs**<br><sub>◉ AUTOMATION · the Era 4 destiny</sub> | ★ | 456 | 15⚙ | — | −1 crew: Parts Fabricator, Chip Fab<br>+10% output: Chip Fab<br>Signed firmware: a failed rollout holds itself | +20% draw: Parts Fabricator, Chip Fab<br>MALWARE: Parts Fabricator, Chip Fab are network nodes — an infected node can burn out<br>FIRMWARE: every drone takes the same push — a bricked rover can be lost | Chip Fabs and Parts Fabricators shutter their windows and run a roof cable tray to a node with a cold lamp. |

### Era 5 · LUNAR COMPUTE

Opens with 4 techs of era 4, or 2 plus the deed: **50▣ chips fabbed**; one of them must be era 4's destiny pick, ⌂ Hydroponic Commons or ◉ Lights-Out Fabs.

**Destiny · What grows here: gardens or compute?** ⌂ Greenhouse Rings or ◉ Fleet OS.

| Tech | Lane | Data | Goods | Requires | Pros | Cons | Visual |
|---|---|---|---|---|---|---|---|
| **Lunar Data Center** | ▣ | 609<br><sub>✎ −40%: 6 labs operating</sub> | 10▣ | Wafer Fabrication | UNLOCK Data Center | −30 kW<br>2.5⚙/day upkeep<br>80◆ 15▣ 30⚙ to build | Data Centers can rise: bermed racks under black-sky radiators. |
| **Dynamic Clocking** | ▣ | 638 | 5▣ | any of Accelerator Design / Rad-Hard Process | NEW ACTION overclock: output ×1.5 per building | overclocked: kW and inputs ×1.5, wear +0.35/day, trips at WORN | Chip Fabs and Data Centers mount boost radiators for overclocking. |
| **Cryo Radiators** | ⚡ | 696<br><sub>✎ −30%: a Data Center has operated 720 s</sub> | 60◆ | Lunar Data Center | −35% draw: Data Center | +60% upkeep: Data Center | Data Centers unfold a second tier of cryo radiator fins. |
| **Autonomous Haulage** | ◉ | 580<br><sub>✎ −30%: an excavator hauling 100 m</sub> | 30⚙ | Rover Autonomy | +30% excavator haul speed<br>+25% excavator bucket (131.25▲ a load) | +25% draw: Regolith Excavator<br>+20% upkeep: Regolith Excavator | Excavators widen their bucket lips and mount a haul-road lidar bar on the cab. |
| **Crew Wellness Program**<br><sub>crew tech (robotic: after Cohabitation)</sub> | ⌂ | 667<br><sub>robotic → E7 · 1150</sub><br><sub>✎ −40%: morale below 50</sub> | — | — | UNLOCK Recreation Dome<br>+14 morale | −4 kW<br>eats 0.05✳/s<br>1⚙/day upkeep<br>1 crew<br>50◆ 5◇ to build | Recreation Domes can rise: a great glass-banded dome. |
| **Wing Extensions** | ⚡ | 580 | 30◇ | MPPT Inverters | +10% power: Solar Array | +20% upkeep: Solar Array<br>build time ×1.2: Solar Array | Solar Array wings grow a fifth row of cells. |
| **Deployable Radiators** | ⚡ | 580 | 40◆ | — | −8% draw: Regolith Smelter, Silicon Refinery, Chip Fab | +20% upkeep: Regolith Smelter, Silicon Refinery, Chip Fab | Smelters, Refineries and Chip Fabs unfold extra radiator wings. |
| **Oxygen Liquefaction** | ◆ | 551 | — | Slag Recycling | +10% output: Regolith Smelter | +15% draw: Regolith Smelter | Smelters add a cold-box liquefier and a spherical LOX tank. |
| **Immersion Lithography** | ◆ | 609 | 5▣ | Wafer Polishing | +12% output: Chip Fab | +10% inputs: Chip Fab | Chip Fabs raise an immersion-lithography tower. |
| **Tool Changers** | ◉ | 551<br><sub>✎ −30%: 500⚙ fabricated</sub> | — | Parts Fabrication | +15% output: Parts Fabricator | +10% inputs: Parts Fabricator | Parts Fabricators add a tool-changer carousel on the roof. |
| **Nutrient Recirculation**<br><sub>crew tech (robotic: after Cohabitation)</sub> | ⌂ | 551 | — | LED Grow Lights | −30% inputs: Hydroponics Farm | +30% upkeep: Hydroponics Farm | Hydroponics farms add a row of nutrient recirculation tanks. |
| **Gravity Gradiometry** | ◎ | 522 | — | Neutron Spectrometry | survey data ×1.2 | −1 kW: Lander | The Lander raises a gravimeter mast. |
| **Automated Smelting & Refining** | ◉ | 580 | 20⚙ | Automated Excavation, Silicon Refining | NEW RULE Smelting: +1 Regolith Smelter when metals demand, builds included, outruns supply for 90 s (cap 4)<br>NEW RULE Smelting: +1 Silicon Refinery when silicon demand outruns supply for 90 s (cap 3)<br>NEW RULE Smelting: +1 Storage Yard when a full store idles its producers and is too small for the research queued (60 s) (cap 4) | the builder spends your stock unasked: 32◆ 8⚙ per Regolith Smelter<br>+10% upkeep: Regolith Smelter, Silicon Refinery | Silicon Refineries grow an ore-sampler arm over the feed hopper. |
| **Feed Planner** | ▣ | 580 | — | Site Survey AI | excavators re-aimed at the feed the furnaces want, as far as the haul pays (opt one out in its panel) | longer hauls carry less<br>+10% draw: Regolith Excavator | Excavators carry an assay drill beside the bucket. |
| **Guidance Beacons** | ◆ | 580 | 5▣ | Basalt Paving | +10% road travel (rovers and excavators)<br>+25% road travel at night | +15% road sintering time a cell | Beacon posts line the road edges and light up at night. |
| **Greenhouse Rings**<br><sub>⌂ COLONY · the Era 5 destiny</sub> | ★ | 580 | 20◇ | — | UNLOCK Greenhouse Ring<br>makes 0.32✳/s<br>+6 morale<br>brings Human Cohabitation forward: habitats and farms unlock; 2 settlers board in 4:00 if the base can keep them<br>Seed bank: a quarantined farm regrows in 60 s | −14 kW<br>eats 0.08≈/s<br>2⚙/day upkeep<br>2 crew<br>80◆ 20◇ 10⚙ to build<br>the crew needs O₂, food, water and beds from now on<br>BLIGHT: farms within 24 m share air — a blight can starve the crew<br>CONTAMINATION: the water loop can foul — poisoned water can kill | Greenhouse Rings can rise: glass vaults round a domed hub. |
| **Fleet OS**<br><sub>◉ AUTOMATION · the Era 5 destiny</sub> | ★ | 580 | 10▣ | — | UNLOCK Server Monolith<br>agent-run draw ×1.6 → ×1.51<br>Builder: rule dwell ×0.5<br>NEW RULE Research: +1 Research Lab when research waits on the transfer cap for 120 s (cap 4)<br>Intrusion detection: MALWARE warnings ×2; a new infection isolates itself for 30 s | −26 kW<br>3⚙/day upkeep<br>60◆ 20▣ 20⚙ to build<br>+15% draw: Data Center<br>CONTROL PLANE: agent-run stations halve while no Data Center runs — drones in flight can fall | Server Monoliths can rise: black slabs with a cold lamp stripe. |

### Era 6 · HUMAN HABITATION

Opens with 4 techs of era 5, or 2 plus the deed: **a Data Center held a full night with every priority-0/1 load powered**; one of them must be era 5's destiny pick, ⌂ Greenhouse Rings or ◉ Fleet OS.

**Destiny · Is the Moon a home, or a machine?** ⌂ Settler Charter or ◉ Lights-Out Charter.

| Tech | Lane | Data | Goods | Requires | Pros | Cons | Visual |
|---|---|---|---|---|---|---|---|
| **Human Cohabitation**<br><sub>robotic only</sub> | ⌂ | 1785<br><sub>✎ −40%: 2 consecutive clean nights</sub> | 30⚙ 10▣ | Regolith Shielding, any of Thorium Reactor / Regenerative Fuel Cells | UNLOCK Habitat Module<br>houses 4<br>extends the build network 60 m<br>UNLOCK Hydroponics Farm<br>makes 0.1✳/s<br>+5 morale | −4 kW<br>1⚙/day upkeep<br>30◆ 10⚙ to build<br>−6 kW<br>eats 0.03≈/s<br>1⚙/day upkeep<br>1 crew<br>25◆ 5⚙ to build | Habitats and Hydroponics Farms can rise for the first crew. |
| **Closed-Loop Life Support**<br><sub>crew tech (robotic: after Cohabitation)</sub> | ⌂ | 1955<br><sub>✎ −40%: a life-support reserve under 5 min</sub> | 25⚙ | any of Thorium Reactor / Regenerative Fuel Cells | −40% inputs: Habitat Module<br>CONTAMINATION clears itself in 60 s; CASCADE grace and suit air +30 s | +30% draw: Habitat Module | Habitats add a CO₂ scrubber stack and water-recovery tanks. |
| **Safety Protocols**<br><sub>crew tech (robotic: after Cohabitation)</sub> | ◉ | 2040<br><sub>✎ −50%: a building worn past 0.3</sub> | 10▣ | Regolith Shielding | −20% upkeep: all structures<br>Colony hazard warnings last ×1.5 | builds 15% slower | Inspection lamp masts go up beside Habitats and the Lander. |
| **Condition Optimization**<br><sub>crew tech (robotic: after Cohabitation)</sub> | ◆ | 2040 | 10▣ | Lunar Data Center | +15% output: Regolith Excavator, Ice Harvester, Regolith Smelter, Silicon Refinery | +25% draw: Habitat Module | Excavators, Smelters, Refineries and Ice Harvesters sprout sensor masts. |
| **Science Crews**<br><sub>crew tech (robotic: after Cohabitation)</sub> | ▣ | 1955<br><sub>✎ −25%: 6 crew aboard</sub> | — | Lunar Data Center | +35% output: Research Lab (crewed only)<br>survey data ×1.5 while ≥2 crew are aboard | +40% draw: Research Lab | Research Labs raise a glazed observation cupola. |
| **Far-Side Relay** | ◎ | 1870<br><sub>✎ −40%: 3 near-side prospects surveyed</sub> | 15▣ 20⚙ | Orbital Prospector | MAP T3 FAR SIDE: far side, +1 outpost slot | −2 kW: Lander | The Lander raises a lattice mast for the far-side relay link. |
| **Cold-Trap Chemistry**<br><sub>✦ breakthrough — survey Cabeus, Hermite</sub> | ◎ | 1955 | — | — | +40% output: Hydroponics Farm<br>+25% output: Propellant Plant<br>+10% output: Chip Fab | +30% upkeep: Hydroponics Farm, Propellant Plant, Chip Fab | Hydroponics Farms and Propellant Plants rack process-gas bottles. |
| **Solid-State Cells** | ⚡ | 1615 | 20◇ | Stacked Cell Racks | battery capacity ×1.3 | build time ×1.5: Battery Bank | Battery Banks seal their cells in solid-state vaults. |
| **High-Burnup Fuel** | ⚡ | 1700 | 30⚙ | Brayton Converters | +10% power: Thorium Reactor | −2 morale: Thorium Reactor | Thorium Reactors raise a fuel-handling crane over the dome. |
| **Refractory Linings** | ◆ | 1615 | 40◆ | Slag Recycling | −25% upkeep: Regolith Smelter, Silicon Refinery | build time ×1.3: Regolith Smelter, Silicon Refinery | Smelter stacks and Refinery columns are banded with refractory courses. |
| **Predictive Maintenance** | ◉ | 1700 | 10▣ | Parts Fabrication | wear heals ×1.3 | −2 kW: Lander | Robotics Bays raise a diagnostics mast with a beacon. |
| **Lab Uplink Dishes** | ▣ | 1615 | 10▣ | Cryo Sample Store | +10% output: Research Lab | +15% draw: Research Lab | Research Labs raise a second uplink dish. |
| **Galley Garden**<br><sub>crew tech (robotic: after Cohabitation)</sub> | ⌂ | 1530<br><sub>robotic → E7 · 1150</sub> | — | LED Grow Lights | +3 morale: Hydroponics Farm | +15% draw: Hydroponics Farm | Hydroponics farms open a galley bay with a picture window. |
| **Launch-Site Survey** | ↑ | 1530 | — | Orbital Prospector | build time ×0.75: Mass Driver, Propellant Plant | −1 kW: Lander | Mass Drivers and Propellant Plants rise on staked, surveyed pads with reflector posts. |
| **Automated Fabrication** | ◉ | 1700 | 10▣ | Automated Smelting & Refining, Parts Fabrication | NEW RULE Fabrication: +1 Parts Fabricator when parts demand outruns supply for 90 s (cap 3)<br>NEW RULE Fabrication: +1 Chip Fab when research waits on chips for 120 s (cap 3)<br>NEW RULE Fabrication: +1 Robotics Bay when 2 sites wait for a rover for 120 s (cap 3) | the builder spends your stock unasked: 48◆ per Parts Fabricator<br>+20% upkeep: Parts Fabricator | Parts Fabricators get a gantry crane across the roof. |
| **Predictive Scheduling** | ▣ | 1700 | 10▣ | Automated Power, Lunar Data Center | rules act on forecasts while a Data Center runs: batteries before dusk, sites still welding counted, dwell ×0.5 | reactive again whenever no Data Center runs<br>+10% draw: Data Center | Each Data Center adds a scheduling antenna: a tall whip mast beside its dish. |
| **Guideway Rails** | ◆ | 1700 | 30⚙ | Guidance Beacons | +30% excavator speed on roads | +20% road sintering time a cell | Twin steel rails run down the centre of the roads. |
| **Settler Charter**<br><sub>⌂ COLONY · the Era 6 destiny</sub> | ★ | 1700 | 40◆ | — | brings Human Cohabitation forward: habitats and farms unlock; 2 settlers board in 4:00 if the base can keep them<br>+1 housing: Habitat Module<br>settlers arrive ×1.5 as often (with crew)<br>+15% output: Research Lab, Regolith Smelter, Silicon Refinery, Parts Fabricator, Chip Fab (crewed only)<br>Storm shelters: EVA recalls itself on the flare warning; doses ×0.5 | the crew needs O₂, food, water and beds from now on<br>+20% inputs: Habitat Module<br>CABIN FEVER: the crew grows restless — a crisis sends people home | Habitats stack a second storey: a habitation terrace with a balcony rail, planters and warm windows. |
| **Lights-Out Charter**<br><sub>◉ AUTOMATION · the Era 6 destiny</sub> | ★ | 1700 | 20▣ | — | Era 7 opens without Human Cohabitation<br>agent-run draw ×1.6 → ×1.48<br>wear heals ×1.2<br>Watchdogs and failover: Reimage in 20 s; the Lander carries the CONTROL PLANE for 120 s | +20% draw: Data Center, Robotics Bay<br>no new settlers are invited (with crew) | Relay Masts wear a firewall node, Robotics Bays add an antenna farm, and any Habitats shutter their windows. |

### Era 7 · SWARM INDUSTRY

Opens with 4 techs of era 6, or 2 plus the deed: **two outposts operated a full lunar day together**; one of them must be era 6's destiny pick, ⌂ Settler Charter or ◉ Lights-Out Charter (robotic runs also need Human Cohabitation, which either Era 6 pick settles).

**Destiny · Domes, or replicators?** ⌂ Garden Domes or ◉ Replicator Stacks.

| Tech | Lane | Data | Goods | Requires | Pros | Cons | Visual |
|---|---|---|---|---|---|---|---|
| **Thin-Film Foils** | ◆ | 1438<br><sub>✎ −30%: 250◇ in stock</sub> | 40◇ | Wafer Fabrication, any of Cleanroom Robotics / Dust Mitigation | UNLOCK Foil Factory<br>makes 0.05▰/s | −20 kW<br>eats 0.6◇ + 0.2◆/s<br>2⚙/day upkeep<br>3 crew<br>80◆ 30⚙ to build | Foil Factories can rise: a coating hall with a foil-roll dock. |
| **Electromagnetic Mass Driver**<br><sub>◈ How does a foil reach orbit?</sub> | ↑ | 1610<br><sub>✎ −30%: 400◆ banked</sub> | 50⚙ | Parts Fabrication, Battery Banks | UNLOCK Mass Driver<br>makes 0.01↑/s | −15 kW<br>eats 0.02⚙/s<br>3⚙/day upkeep<br>2 crew<br>150◆ 50⚙ to build | Mass Drivers can rise: a 20 m inclined coil rail. |
| **Propellant Depot**<br><sub>◈ How does a foil reach orbit?</sub> | ↑ | 1610<br><sub>✎ −40%: 300≈ banked</sub> | 40⚙ 40◆ | Parts Fabrication, any of Cryo Ice Extraction / Solar-Wind Volatiles | UNLOCK Propellant Plant<br>makes 0.01↑/s | −18 kW<br>eats 0.3≈ + 0.05○/s<br>2⚙/day upkeep<br>1 crew<br>90◆ 30⚙ 20◇ to build | Propellant Plants can rise: twin foil-banded tanks. |
| **Self-Replicating Systems** | ◉ | 1955<br><sub>✎ −30%: a fleet of 8 robots</sub> | 80⚙ 15▣ | Lunar Data Center, any of Swarm Robotics / Heavy Constructors | +30% output: Regolith Excavator, Regolith Smelter, Silicon Refinery, Ice Harvester<br>+60% output: Parts Fabricator, Foil Factory<br>−1 crew: Parts Fabricator, Foil Factory<br>+1 construction rover per Robotics Bay | +25% draw: Regolith Excavator, Regolith Smelter, Silicon Refinery, Ice Harvester, Parts Fabricator, Foil Factory<br>×2 upkeep: Robotics Bay | Parts Fabricators and Robotics Bays grow replicator assembly arms. |
| **Deep Sounding Network** | ◎ | 1438<br><sub>✎ −40%: a far-side prospect surveyed</sub> | 20▣ | Far-Side Relay | MAP T4 SUBSURFACE: subsurface prospects, +1 outpost slot, enables ATLAS | −3 kW: Lander | A ring of seismometer pods is set out around the Lander. |
| **Superconducting Bus** | ⚡ | 1265 | 60◆ | Cryo Radiators | −8% draw: Chip Fab, Data Center, Foil Factory | +20% upkeep: Chip Fab, Data Center, Foil Factory | Data Centers, Chip Fabs and Foil Factories run superconducting bus ducts. |
| **Roll-to-Roll Coating** | ◆ | 1265<br><sub>✎ −30%: 30▰ manufactured</sub> | — | Thin-Film Foils | +12% output: Foil Factory | +10% inputs: Foil Factory | Foil Factories add a second roll-to-roll coating line. |
| **Foil Annealing Ovens** | ◆ | 1265 | — | Thin-Film Foils | −15% draw: Foil Factory | +30% upkeep: Foil Factory | Foil Factories raise annealing ovens on the roof. |
| **Liquid Cooling** | ▣ | 1265<br><sub>✎ −30%: a Data Center has operated 2,160 s</sub> | 40◆ | Lunar Data Center | −12% draw: Data Center | +25% upkeep: Data Center | Data Centers run coolant manifolds to a pump skid. |
| **Rack Densification** | ▣ | 1323 | 10▣ | Lunar Data Center | +12% output: Data Center | +15% draw: Data Center | Data Centers add a rack annex at the berm. |
| **Low-G Court**<br><sub>human only</sub> | ⌂ | 1150 | — | Crew Wellness Program | +4 morale: Recreation Dome | +40% inputs: Recreation Dome | Recreation Domes add a low-g court annex under a glass vault. |
| **Laser Ranging** | ◎ | 1150 | — | Far-Side Relay | survey data ×1.2 | −1.5 kW: Lander | The Lander adds a laser-ranging telescope dome. |
| **Self-Expanding Base** | ◉ | 1294 | 10▣ 40⚙ | Automated Fabrication, Site Survey AI | NEW RULE Network: +1 Relay Mast at the network edge when a rule finds no ground for 60 s (cap 4) | the builder spends your stock unasked: 16◆ 4⚙ per Relay Mast<br>+30% draw: Relay Mast | Relay Masts wear a beacon crown and a cable reel at the foot. |
| **Maintenance Automation** | ▣ | 1294 | 30⚙ | Automated Fabrication | parts triage: short of parts, priority 0 is paid first · machines worn ≥40% for a lunar day replaced · tripped overclocks re-armed once healed | a replacement costs a new build, less half the old one’s price<br>+30% upkeep: Robotics Bay | Robotics Bays get a service crane arm over the charging rover. |
| **Maglev Freight Lines** | ◉ | 1265 | 10▣ | Guideway Rails | +30% road travel (rovers and excavators)<br>no road dust | +25% road sintering time a cell | A glowing coil strip runs down the centre of the roads. |
| **Garden Domes**<br><sub>⌂ COLONY · the Era 7 destiny</sub> | ★ | 1294 | 40◇ | — | UNLOCK Garden Dome<br>makes 0.04✳/s<br>houses 10<br>+10 morale<br>extends the build network 60 m<br>brings Human Cohabitation forward: habitats and farms unlock; 2 settlers board in 4:00 if the base can keep them<br>Pressure bulkheads: a BREACH kills no one and seals itself in 30 s | −12 kW<br>eats 0.05≈/s<br>3⚙/day upkeep<br>1 crew<br>150◆ 40◇ 25⚙ to build<br>the crew needs O₂, food, water and beds from now on<br>BREACH: Garden Dome hold air — a breach can kill | Garden Domes can rise: a glass dome over trees, ringed by lit window terraces. |
| **Replicator Stacks**<br><sub>◉ AUTOMATION · the Era 7 destiny</sub> | ★ | 1294 | 20▣ 30⚙ | — | +20% output: Parts Fabricator, Foil Factory<br>Builder: rule caps ×2<br>NEW RULE Export: +1 Foil Factory when foils hold a volley back for 120 s (cap 3)<br>Rule attestation: a drifting rule stops after 1 site | +20% draw: Parts Fabricator, Foil Factory<br>+30% upkeep: Robotics Bay, Drone Hive<br>RUNAWAY RULE: replicators follow the rules — a hijacked rule wastes stock | Parts Fabricators and Foil Factories stack a second fab storey under a gantry. |

On robotic runs Automated Life Support, Crew Wellness Program, Galley Garden also resolve into this era.

### Era 8 · DYSON SWARM

Opens with 4 techs of era 7, or 2 plus the deed: **25▰ manufactured**; one of them must be era 7's destiny pick, ⌂ Garden Domes or ◉ Replicator Stacks.

**Destiny · Who launches the swarm?** ⌂ Crewed Mission Control or ◉ Autonomous Cadence.

| Tech | Lane | Data | Goods | Requires | Pros | Cons | Visual |
|---|---|---|---|---|---|---|---|
| **Rail Capacitor Banks** | ★ | 2080 | — | Electromagnetic Mass Driver | −20% draw: Mass Driver | +40% upkeep: Mass Driver | Mass Drivers line their rail with capacitor banks. |
| **Cryocooler Heads** | ★ | 2080 | — | Propellant Depot | +15% output: Propellant Plant | +20% draw: Propellant Plant | Propellant Plants cap their tanks with cryocooler heads. |
| **Canister Press** | ★ | 2080 | — | Thin-Film Foils | +10% output: Foil Factory | +30% upkeep: Foil Factory | Foil Factories add a canister press at the loading dock. |
| **Swarm Protocol** | ★ | 2340<br><sub>✎ −25%: ATLAS COMPLETE</sub> | 5▰ 10▣ | Thin-Film Foils, any of Crewed Mission Control / Autonomous Cadence | NEW ACTION launch — LAUNCH is armed | each volley costs 10▰ + 3↑ + 400 stored | Mass Drivers and Propellant Plants raise a swarm-tracking beacon mast. |
| **Power Beaming Return**<br><sub>◈ What is the swarm for?</sub> | ★ | 4420 | — | Swarm Protocol, Battery Banks | +4 kW per volley launched | the beam drops to 0 while a flare is active | A rectenna mesh unfolds beside the Lander. |
| **Von Neumann Foundry**<br><sub>◈ What is the swarm for?</sub> | ★ | 5200 | 20▰ | Swarm Protocol, Self-Replicating Systems | ×3 output: Foil Factory | +50% draw: Foil Factory | Foil Factories sprout seed-factory pods on the roof. |
| **Crewed Mission Control**<br><sub>⌂ COLONY · the Era 8 destiny</sub> | ★ | 2080 | — | — | a volley needs 2↑ instead of 3<br>each volley: +8 morale for a lunar day<br>brings Human Cohabitation forward: habitats and farms unlock; 2 settlers board in 4:00 if the base can keep them<br>Launch days: each volley eases CABIN FEVER by 30 | a volley needs 4 crew on console (without them: 3↑ and no ceremony)<br>the crew needs O₂, food, water and beds from now on<br>+1 crew: Mass Driver, Propellant Plant | Mass Drivers and Propellant Plants gain a glazed launch-control blockhouse with lit consoles and a viewing gallery. |
| **Autonomous Cadence**<br><sub>◉ AUTOMATION · the Era 8 destiny</sub> | ★ | 2080 | — | — | volleys fire themselves when ready (never below the night’s reserve)<br>launch burst −25% (300 stored) | +30% draw: Mass Driver, Propellant Plant<br>MALWARE: Mass Driver, Propellant Plant are network nodes — an infected node can burn out | Mass Drivers and Propellant Plants raise a black guidance monolith with a cold tracking lamp. |
| **Lunar Commonwealth**<br><sub>destiny capstone · the ⌂ Colony band only</sub> | ★ | 4420 | — | Swarm Protocol | +10 morale everywhere (with crew)<br>+2 housing: Habitat Module<br>+2 housing: Garden Dome<br>+10% output: Research Lab, Regolith Smelter, Silicon Refinery, Parts Fabricator, Chip Fab, Foil Factory, Hydroponics Farm, Greenhouse Ring (crewed only) | +20% inputs: Habitat Module<br>CABIN FEVER: the crew grows restless — a crisis sends people home | Habitats and Garden Domes string festival lamps, and the Lander gains a commons plaza with a flagpole. |
| **Selenic Mind**<br><sub>destiny capstone · the ◉ Automation band only</sub> | ★ | 4420 | — | Swarm Protocol | Builder: rule caps ×2<br>NEW RULE Research: +1 Research Lab when research waits on the transfer cap for 120 s (cap 4)<br>NEW RULE Export: +1 Foil Factory when foils hold a volley back for 120 s (cap 3)<br>Builder: every rule may build the destiny buildings too (rings, domes, hives, monoliths)<br>+25% output: Foil Factory, Data Center, Server Monolith | +25% draw: Foil Factory, Data Center, Server Monolith<br>MALWARE: are network nodes — an infected node can burn out | Server Monoliths and Data Centers crown themselves with radiator fins. |
| **Concord**<br><sub>destiny capstone · the Concord band only</sub> | ★ | 4420 | — | Swarm Protocol | agent-run draw ×1.6 → ×1.48<br>+5 morale everywhere (with crew)<br>hazard windows ×0.7 as often | +10% upkeep: all structures | The Lander raises a joint-operations mast: a lit crew cabin under a drone perch. |

### Doctrines

| Era | Question | Members | Site notes |
|---|---|---|---|
| 2 | How hard do you push the furnace? | Molten Regolith Electrolysis / Ilmenite Beneficiation | ILMENITE PLAINS: Plenty of ilmenite, and MRE kills the only water trickle.<br>SHACKLETON RIM: MRE stands alone: highland soil barely reacts to H₂.<br>MARIUS HILLS TUBE: A genuine split. |
| 3 | How does the base survive the 14-day night? | Thorium Reactor / Regenerative Fuel Cells | ILMENITE PLAINS: Thorium: the night is long.<br>SHACKLETON RIM: Fuel cells: ice gives water and the pole’s night is short.<br>MARIUS HILLS TUBE: Thorium: the sun is a rumour down here. |
| 3 | Many hands, or strong ones? | Swarm Robotics / Heavy Constructors | — |
| 4 | What are your chips for? | Accelerator Design / Rad-Hard Process | — |
| 7 | How does a foil reach orbit? | Electromagnetic Mass Driver / Propellant Depot | ILMENITE PLAINS: Driver: the equator gives it ×1.5.<br>SHACKLETON RIM: Propellant: it ignores the pole’s ×0.6.<br>MARIUS HILLS TUBE: A split. |
| 8 | What is the swarm for? | Power Beaming Return / Von Neumann Foundry | — |

129 techs: 123 researchable from the start of their era (16 of them destiny picks, the two landings
among them), 3 breakthroughs, 3 destiny capstones; 6 doctrines, 47 insights.
<!-- END GENERATED -->

## Save migration

Saves from the six-era tree (tech schema 1) migrate on load: retired techs
(Hydroponics, Autonomous Ops, Robotic Self-Assembly, Inference Optimization,
Automated Fabrication, High-Efficiency Launch) refund their data, renamed ids
map to their successors, and a save that already finished both members of a
doctrine keeps both. See spec §8. Schema 3 → 4 (docs/14 §7) adds the landing
pick to `techsDone`, keeps the era, and leaves past eras' picks open as
leftovers at their old prices; a pick is required only for eras still to open.
