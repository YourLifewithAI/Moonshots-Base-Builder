# Moonshots Base Builder: Research Tree and Lunar Map (final synthesized spec)

This is the implementation-ready spec. **Draft A (engineer)** is the base; the judges picked it by majority, 140 points to 129. It grafts the best parts of Draft B, resolves every must-fix item, and applies the cuts.

**Evidence base**
- `audit-researchtree.json` (primary)
- `audit-design-research.json`
- `audit-probe-robotic.json`
- `audit-probe-human.json`
- the current `src/`

**Models and data**
- Data model: `scratchpad/final/techs.py`
- Prospect geometry: `scratchpad/final/prospects.py` and `moon.py`
- Pacing model: `scratchpad/final/pace.py`, run as `python3 pace.py <site> <robotic|human> [pins=0.5] [maxdc=3] [chip=acc|rad] [-v] [-t]`

Every number in this document comes from those files.

**Ownership.** This spec owns everything in `src/data/techs.ts`, including `partsFabrication.requires = ['regolithProcessing']` (the P1b fix). It assumes the parallel **core-fixes** workstream has landed:
- partsFab costs metals only (0.3◆ → 0.2⚙, 1 crew)
- hydroponics 0.03≈ → 0.10 food
- storage caps for parts, O₂ and water
- idle when output is full (`idleReason 'full'`)
- faster wear healing
- a resupply gives 40⚙
- a guaranteed ice deposit at 35–55 m on ice sites

Anything below that touches a core-fixes file is listed in §2 S12, **Coordination**.

---

## 0. Decision log: how the judgments were resolved

| Topic | Decision | Judge basis |
|---|---|---|
| Base design | A's architecture: `research.ts` single source of truth, `effectiveDef`, lanes × eras, charters, doctrines, verbs, migration map, tests. | 3/3 picked A |
| First permanent choice | No doctrine in Era 1. `regolithProcessing` stays as the un-forked H₂-reduction smelter (same id, no rename). The smelting fork is **Era 2**: Molten Regolith Electrolysis vs Ilmenite Beneficiation. At the pole MRE stands alone, because Beneficiation is hidden there. Doctrines are capped at 2 per era (E2 1, E3 2, E4 1, E7 1, E8 1). | J2, J3 graft; J2 must-fix |
| Lunar Map framing | Local first. The map opens on the 1 km SITE view with a Moon thumbnail reading "orbital imagery only". Each Exploration tier animates the viewBox outward: site → vicinity → region → near side → far side → whole Moon. | 3/3 graft |
| Deposit effects | They act through **excavator feed grade**: "excavators dig the ground they sit on". The feed grade is an **instant, unsmoothed** share of what was dug last tick, so there is no lagged global mix. Only ice (harvester), ridge (solar), KREEP (no habitats) and the digging excavator's own wear stay location-based. | J1 must-fix (realism); J2/J3 cut B's *lagged* feedMix |
| Breakthroughs | **3** hidden techs, each revealed by surveying a real anomaly. Each has a **fixed era and a reserved Exploration-lane slot**, and uses **existing effect kinds only**. They replace anomaly→insight discounts. | J1, J2 graft (2–1); J3's overflow concern answered by the fixed slots |
| Survey costs | Stored energy, plus O₂ and water that scale with distance (hopper propellant), plus 1 borrowed robot for the trip. KSP-style novelty decay (×1, ×0.5, ×0.25) applies per geology kind. | J1, J3 graft; J2 must-fix ("borrow 1 robot") |
| Outposts | The first slot arrives at T2 (Near Side, Era 4). Claims cost chips. Six kinds, with a single cost/deploy table by distance class. Streams are continuous, with a first-delivery alert and a visible hopper-fuel line that raises HOPPER GROUNDED when it runs dry. | J3 graft; J2 cut; J2 must-fix |
| Comms and survey loads | Charged as `powerDelta` on the Lander (real kW in the power UI). No virtual consumer. | J1 cut, J3 graft |
| Humans | Research, safety **and** optimizing conditions, all non-exclusive: Science Crews, Safety Protocols, Condition Optimization. Crew Wellness is Era 5 on human runs and Era 7 on robotic runs. Cohabitation brings a 2-settler crew rotation after 240 s. | J1, J3 must-fix; 3/3 cut B's exclusive charter |
| Lab diminishing returns | A shared **uplink share** that applies to agent-run labs only. It is computed from the active count and shown on the palette card, the placement ghost, the inspector and the info panel. | J1, J2, J3 must-fix |
| Kept from B | Thermal Wadis (mare E2). Deep-Space Downlink (a teleoperation verb). `techRelevance` invariant. Footer showing other-site techs. Split PAUSED states. Experience-arc acceptance script. '?' leads. Site-weakness outpost framing. Parts deed for Era 3. Side-by-side doctrine commit. | majority grafts |
| Cut | statiteDeployment and the `launch` kind; edgeAutonomy; regolithSintering and `buildCost`/`b.paid`; hiEffLaunch; autonomousOps (merged into Construction Robotics); roboticSelfAssembly (merged into Self-Replication); the `oxygenProcess` E1 doctrine. Also cut from B: supervision, housingDelta, crewGrowthMult, sortieTimeMult, flareSolarFloor, regions and badges, vantage notes, walk-mode sampling, dawn-lump deliveries, the 21 extra effect kinds. Power cable, cryo and deepMetal outpost kinds are cut too. | J1–J3 cuts |
| Saves | `state.version` stays `1` (save.ts:26/32 accepts only 1). Add `techSchema: 2`. Removed ids are dropped and refunded. There are no renames, so no doctrine pick is forced through migration. | J3 must-fix; J2 criticism of B |

---

## 1. Pillars

The first sentence of each bullet in bold is its "one rule". The rules for the four systems are printed as header copy on the tree and map screens.

1. **Robots first; humans by charter.** The order is teleoperated landing, then ISRU, robotic fabrication, chips, compute, humans, industry and the swarm. On robotic runs Era 7 cannot open without Human Cohabitation, whatever else is met.
2. **"An era opens with 2 of the previous era's techs — or 1 plus a deed."** Charters make research respond to what you build.
3. **"Choose one; it stays chosen."** There are 6 permanent doctrines covering 12 techs, at most 2 per era, and none in Era 1. The site, not a hint, supplies the natural answer.
4. **"Doing it makes it cheaper."** Insights are one-off discounts earned by in-base deeds. Surveys and flares also pay out data.
5. **"Excavators dig the ground they sit on."** Deposits change yields through visible feed grade. Where you dig is a production decision.
6. **"Look, visit, settle."** The EXPLORATION lane grows the map from your 1 km site to the whole Moon. Surveys reveal geology, breakthroughs and data. Outposts turn a prospect into a resource stream, at a cost.
7. **Every card is a trade-off, and the numbers are generated.** The +/− lines come from `effects` through `describeEffect()`. Every tech has at least one mechanical con large enough to show up in `previewTech`.
8. **No silent failures.** Every rejected action alerts with the reason and the fix. Stalls name the missing goods and the building that makes them, and the queue flows past stalled items.
9. **Even pacing.** On the model, robotic mare reaches FIRST LIGHT at 103 game-min (34 min at 3×). Eras run 9–16 min. Pole and lava tube come in at +8% and +13%.
10. **Legible at 1280×720, DOM/SVG only.** 7 swimlanes × 8 eras, with the capstone always on screen and the detail sheet open. State is shown by shape and value, never by hue alone. No new WebGL.

---

## 2. Systems

### S1 · Research core: `src/core/research.ts` (new, single source of truth)

`game.ts` (actions), `economy.ts` (tick), `game.publish()` (stores), `debug.ts` and the tests all call these functions. Nothing else computes availability or cost.

| Function | Exact semantics |
|---|---|
| `resolveTech(def, exp)` | Merges `def.robotic` (`era`, `costData`) on robotic runs. Every function below uses the resolved def, and charters count **resolved** eras. |
| `techVisible(def, s)` | False if `def.sites` excludes `s.siteId`, if `def.expeditions` excludes `s.expedition`, or if `def.breakthrough` is set and the id is not in `s.discoveries`. An undiscovered breakthrough renders as a placeholder, not a card. Hidden techs never count for gates or `requiresAny`. |
| `techAvailability(tid, s)` | Returns `{state, reason}` from the first rule that matches, in this order: `hidden` → `done` → `queued` / `stalled` → `foreclosed` → `crewLocked` → `eraLocked` → `requires` → `requiresAny` → `full` → `available`. Missing goods never block queueing; they show as a shortfall. |
| `techCost(tid, s)` | `{data: round(resolved.costData × ERA_COST_SCALE[era] × (1 − min(0.5, s.insights[tid] ?? 0))), goods, discount, insightLabel}` |
| `enqueue(s, tid)`, `enqueuePath(s, tid)`, `cancel(s, tid)` | Return `{ok, reason}`, and the caller alerts on `!ok`. `enqueuePath` adds the prerequisite closure in topological order (resolved era, then `TECH_ORDER`). For each `requiresAny` it uses a member that is done or queued; otherwise the cheapest visible, non-foreclosed member. It aborts with an alert if the closure needs an undecided doctrine (`PATH NEEDS A DOCTRINE — choose Swarm Robotics or Heavy Constructors first`) or would exceed `QUEUE_MAX` (`QUEUE FULL — 3 of 4 fit`). |
| `sanitizeQueue(s)` | Loops until stable. Item *i* is kept only if every `requires` item is done or earlier in the queue, at least one visible `requiresAny` item is done or earlier, it is visible, not foreclosed, not crew-locked, and **its resolved era ≤ `s.era`**. Each drop raises `RESEARCH DROPPED — Parts Fabrication needs Regolith Smelting` (warn). `researchSpent` is kept. Runs after every cancel, after migration and at the top of `researchTick`. |
| `researchRates(s, mods)` | `{production, cap, labsActive, agentLabs, uplinkShare, dcsActive}` (S6). |
| `researchTick(s, mods, dt)` | Replaces `economy.ts:423-455`.<br>**Pass 1:** every queued item whose data is fully paid tries its goods. It completes if they are affordable, otherwise it joins `s.researchStalled`.<br>**Pass 2:** `budget = min(s.data, cap × dt)` flows to queue items in order, skipping paid items and spilling any remainder to the next.<br>Stall alert, once per stall episode: `RESEARCH WAITING — Lunar Data Center needs 10▣ chips (have 3) · made by Chip Fab`. The producer comes from `BUILDINGS[*].outputs`.<br>If the cap is 0 and the queue is non-empty: `RESEARCH PAUSED — no operating lab or Data Center`, or `PAUSED — labs browned out` when every lab has `idleReason 'power'`.<br>On completion it calls `onTechComplete(s, tid)`, which sets `modsChanged` and handles the Cohabitation crew rotation (S8.7). |
| `computeEra(s)`, `gateProgress(s, era)` | Charter rules (S2), moved from `mods.ts:69`. Evaluated **every** tick in economy step 11: `s.era = max(s.era, computeEra(s))`. On a change: `ERA 5 OPENS — via 1 tech + 20▣ chips fabbed`. |
| `previewTech(tid, s)` | Diffs `computeMods` with and without the tech over the buildings that exist. Returns lines such as `Your 2 Data Centers: −21 kW` and `Your 3 excavators: +0.06≈/s · −9 kW`. Used by the detail sheet and by the `auditTechs` magnitude check. |
| `techRelevance(def, siteId, exp)` | True if at least one **pro** effect, after site and expedition filtering, touches:<br>- a building placeable at that site on that expedition; or<br>- a global mod that means something there: dust always; grading when `site.terrain.roughness ≥ 0.8`; shadeImmune when `roughness ≥ 1.0`; nightDraw when `nightSolarFraction < 0.5`; survey, action and storage always; feedBonus only when `DEPOSIT_PLAN[site]` contains that kind.<br>This is a data invariant (test 3), not a runtime filter. |

**Constants** (`src/data/balance.ts`)

| Constant | Value | Notes |
|---|---|---|
| `QUEUE_MAX` | 5 | was a literal 3 at `game.ts:338` |
| `RESEARCH_RATE_PER_LAB` | 0.4 | existing |
| `RESEARCH_RATE_PER_DC` | 2.5 | |
| `LAB_UPLINK_WEIGHTS` | `[1,1,1,1,.6,.6,.6,.6,.3,.3,…]` | |
| `INSIGHT_MAX` | 0.5 | |
| `ERA_COST_SCALE` | `{1..8: 1.0}` | the single tuning dial for probes |

**Actions** (`actions.ts`): `researchPath{tech}`, `setOverclock{id,on}`, `downlink`, `surveyProspect{id}`, `claimOutpost{id}`, `abandonOutpost{id}`. The existing `research` and `cancelResearch` become thin calls into `research.ts`.

### S2 · Lanes, eras, charters (`techs.ts` `ERA_GATES`, `research.ts`, `state.ts`)

**Lanes.** `TechDef.lane` takes one of 7 values; Era 8 is a lane-free capstone column.

| Lane | Label | Holds |
|---|---|---|
| `power` | ⚡ POWER | |
| `materials` | ◆ MATERIALS | ISRU, smelting, dust, wafers, foils |
| `robotics` | ◉ ROBOTS & FAB | builders, parts, cleanroom, safety, replication |
| `compute` | ▣ SILICON & COMPUTE | silicon, chip doctrine, Data Centers, clocking, science crews |
| `habitat` | ⌂ HABITAT | water, shielding, humans |
| `exploration` | ◎ EXPLORATION | map tiers and the 3 breakthrough slots |
| `export` | ↑ EXPORT | launch doctrine |

**Charter rule.** Era N opens when **2 visible techs whose resolved era is N−1 are done**, or **1 of them is done and the deed below is met**. Breakthroughs count as techs of their era. On robotic runs Era 7 also hard-requires `humanCohabitation`, on either route.

| Opens | Deed (alongside 1 tech of the previous era) | Stat (writer) |
|---|---|---|
| 2 | 100◆ smelted on site | `stats.produced.metals` (step 4) |
| 3 | Parts Fabricators have produced 80⚙ | `stats.produced.parts` (step 4) |
| 4 | 150◇ refined | `stats.produced.silicon` (step 4) |
| 5 | 20▣ fabbed | `stats.produced.chips` (step 4) |
| 6 | A Data Center ran through a full night with every priority-0/1 load powered | `stats.dcCleanNight` (step 10) |
| 7 | An outpost has operated for a full lunar day (720 s). **Robotic: plus Human Cohabitation** | `stats.outpostOpS` (step 8.7) |
| 8 | 10▰ foils manufactured | `stats.produced.foils` (step 4) |

The deeds teach the loop of each era: smelt, then fab parts, refine, fab chips, hold the night with compute running, supply from off-site, and manufacture the swarm.

**New state: `GameState.stats`.** Zeroed on a new run and defaulted on load.

| Field | Writer and rule |
|---|---|
| `produced` (per resource) | Step 4, buildings only; outposts and shipments excluded |
| `built` | Step 2.5, on completion |
| `waitingSitesPeak` | Step 0 |
| `nightBrownouts` | Step 10, if the night had any load shed |
| `dayBrownouts` | Step 2 |
| `nightCritDark` | Step 2: a priority ≤1 load went dark at night; reset at dusk |
| `cleanNightStreak` | Step 10, at dawn |
| `dcCleanNight` | Step 10: a DC was active every night tick and `!nightCritDark` |
| `darkNightMaxS` | Step 2 |
| `shadedMaxS` | Step 1 |
| `maxDust`, `lowPartsSeen` (parts < 20 after t > 120), `wornSeen` | Step 6 |
| `flaresWithSix` | Step 8 |
| `ilmeniteDigS`, `dcOpS` | Step 4 |
| `outpostOpS` | Step 8.7 |
| `minReserveS` | Step 5 |
| `minMorale` | Step 7 |

### S3 · Doctrines (`techs.ts`: `exclusive`, `DOCTRINES`)

**States**
- A member of a group is **foreclosed** while another member is **queued**: `foreclosed while Swarm Robotics is queued — cancel it to reopen`.
- It is permanently foreclosed once another member is **done**: `foreclosed — you chose Swarm Robotics`.
- Banked `researchSpent` on an abandoned pick is kept and shown on its card.
- If only one member of a group is visible at a site, it is not a doctrine there: no bracket, nothing foreclosed.
- Saves that already have 2 members done are grandfathered (§8).

| Group | Era | Question (bracket hover) | Members | The site's natural answer |
|---|---|---|---|---|
| `smeltDoctrine` | 2 | How hard do you push the furnace? | moltenElectrolysis / ilmeniteBeneficiation (M, L) | Mare: Beneficiation. There is plenty of ilmenite, and MRE kills the only water trickle. Pole: MRE alone, since highland soil barely reacts to H₂. Lava tube: a genuine split. |
| `nightPower` | 3 | How does the base survive the 14-day night? | thoriumPower / regenFuelCells | Mare and lava tube: thorium. Pole: fuel cells, because ice gives water and the pole's night is short. |
| `constructionDoctrine` | 3 | Many hands, or strong ones? | swarmRobotics / heavyConstructors | Swarm when power is cheap; Heavy when parts are scarce. |
| `chipDoctrine` | 4 | What are your chips for? | acceleratorDesign / radHardProcess | Accelerator for pacing; Rad-Hard for agent-heavy robotic power budgets. |
| `launchArchitecture` | 7 | How does a foil reach orbit? | massDriver / propellantDepot | Mare: driver (×1.5). Pole: propellant, which ignores ×0.6. Lava tube: a split. |
| `swarmPurpose` | 8 | What is the swarm for? | powerBeaming / vonNeumann | Post-capstone. |

### S4 · Insights and field science (`src/data/insights.ts`, new)

**Insights.** `INSIGHTS: {tech, discount, hint, check(s)}[]` is checked each tick, after `researchTick`.
- On a hit: `s.insights[tech] = max(existing, discount)`, capped at 0.5, and the alert `INSIGHT — Battery Banks 40% cheaper: a night brownout taught you what storage is worth`.
- Insights fire even while the tech is locked; the card shows `✎ earned −40%`.
- Era 1 has none, as in Civ.
- There is no learning-curve system, so there is only one discount system.
- If a discount lands mid-research and `spent ≥ cost`, the tech completes on the next tick.
- **Insights come only from in-base deeds**; map anomalies give breakthroughs and data instead. The single exception is ATLAS COMPLETE (a deed) → Swarm Protocol −25%.
- Triggers are listed per tech in §3.

**Field science.** Data goes into the bank `s.data`, so it still flows through the transfer cap and research stays paced.

| Source | Data |
|---|---|
| Prospect surveys | §5b table, × novelty |
| Flare turning active while ≥1 lab operates | +25 (`HELIOPHYSICS — the flare was also an experiment`, step 8). A flare now has a pro. |
| Daedalus radio outpost | +0.35 data/s |

### S5 · Breakthroughs (the Stellaris pattern, bounded)

`TechDef.breakthrough = { hosts: ProspectId[] }`.

- **Discovery.** Surveying any host adds the tech to `s.discoveries` and alerts `BREAKTHROUGH — Lava-Tube Caverns found at Mare Tranquillitatis pit (researchable in Era 3)`.
- **Fixed era and cost.** A breakthrough found early waits for its era; one found late is researchable at once.
- **Fixed slot.** Each has a reserved Exploration-lane slot: E3 slot 1, E4 slot 2, E6 slot 2. The lane never overflows.
- **Placeholder.** Before discovery the slot renders as `✦ ? Breakthrough`, with a hint once a host pin is visible: `survey an anomaly: Tranquillitatis pit (regional)`.
- **Effects use existing kinds only.**
- Every site can reach at least 2 of its 3 breakthroughs by T1 (checked with `prospects.py`):

| Site | Breakthroughs within reach by T1 |
|---|---|
| Mare | Tranquillitatis pit (regional, 13°) → Caverns; Taurus-Littrow (regional, 21°) → Glass |
| Pole | Cabeus (regional, 5°) → Cold-Trap; Schrödinger (regional, 15°) → Glass |
| Lava tube | Marius tube (local, 0°) → Caverns; Aristarchus (regional, 13°) → Glass |

The third breakthrough on each site needs T2 (Near Side).

### S6 · Research economy (`researchRates`, economy step 4)

**Agent-run lab** (robotic runs, or any lab toggled Autonomous):
`data/s = 0.3 × 0.75 (robotic; human agent labs 1.0) × mods.outputMult.lab × uplinkShare × overclock(1.5) × wearDerate`

- `uplinkShare = E(n)/n`, where n is the number of **active agent-run labs** and `E(n) = Σ LAB_UPLINK_WEIGHTS[0..n−1]`.

| Active agent-run labs | E(n) | Share |
|---|---|---|
| 4 | 4.0 | 100% |
| 5 | 4.6 | 92% |
| 6 | 5.2 | 87% |
| 8 | 6.4 | 80% |
| 12 | 7.6 | 63% |

- **Why only agent labs.** Agent labs ship raw data to Earth over a shared Deep Space Network allocation. Crewed labs analyse on site. Data Centers process locally.
- **Uniform.** The share is computed from the count, and every agent lab gets the same share. Demolishing or browning out one lab recomputes it for all; there is no per-id weighting.
- **Surfaced in four places**, so it is never a hidden nerf:

| Where | Text |
|---|---|
| Lab palette card | `Next agent lab: +0.6 lab (uplink share → 92%)` |
| Placement ghost | `Lab #5 · uplink share 92% — the DSN link is saturating` |
| Inspector | `Agent-run · uplink share 87% of 6 labs` |
| Info-panel research section | the table above |

**Crewed lab:** `0.3 × workMult^1.5 × outputMult.lab × (Science Crews ×1.35) × overclock × wearDerate`. No uplink share applies.

**Data Center:** `1.0 × outputMult.dataCenter × overclock × wearDerate`.

**Transfer cap:** `0.4 × activeLabs + 2.5 × activeDCs`. There is no constant term. It was 1.2/s per DC; the new value covers a DC's maximum of 1.0 × 1.5 × 1.5 = 2.25/s.

**Changes from today**
- Lab data now multiplies `mods.outputMult.lab` for the first time, which makes the teleoperation con real.
- The wear derate now applies to data, fixing "worn labs keep full output" (`economy.ts:229`).

**HUD research chip states** (`hud.ts`, replacing the text at `screens.ts:172`)

| State | Example |
|---|---|
| Researching | `Researching Data Center 42% · ETA 2:10` |
| No lab | `PAUSED — no lab` |
| Browned out | `PAUSED — labs browned out` |
| Waiting on goods | `WAITING — Data Center needs 10▣ (have 3) · Chip Fab` |
| Empty | `QUEUE EMPTY — pick research [T]` |

ETA is `remaining / s.researchRateAvg`, a 30 s exponential moving average of the actual transfer.

### S7 · Effective building definitions, site-conditional effects, feed grade (`src/core/mods.ts`)

**Mods and effective definitions**
- `computeMods(techsDone, expedition, siteId, outposts)`. Any `TechEffect` may carry `sites?: SiteId[]` and `expeditions?: Exp[]`, and is skipped where they do not match. The KREEP outpost adds modifiers here. `modsChanged` is set when an outpost goes live or is abandoned.
- `effectiveDef(type, mods)` returns the base `BuildingDef` with `mods.recipe[type]` overrides and the `powerDelta` sum applied. Every reader uses it:
  - `economy.ts` steps 1, 2 and 4
  - `palette.ts` `ioRows` (line 32)
  - `infoPanel.ts` producer and consumer lines
  - the placement preview
- `effectiveRates(type, mods, site, b?)` applies the multipliers, agent tax, feed factor, overclock, site ISRU and deposit, so tooltips show exactly what the sim does. The hard-coded `×1.6` at `palette.ts:44/195/235` becomes `1 + mods.agentTax`.
- **Lander as consumer.** If `effectiveDef('lander').powerKW < 0` (comms and outpost loads exceed its 6 kW), the Lander becomes a priority-0 draw through the normal step-2 path. The Lander inspector reads `+6 kW − 7 kW comms & outposts = −1 kW`.
- **Unlocks by expedition.** Hydroponics becomes `unlockedFromStart` on human runs. On robotic runs `computeMods` keeps `habitat` and `hydroponics` locked until `humanCohabitation` unlocks both. This replaces `hydroponicFarming`.

**Feed grade** (the rule "excavators dig the ground they sit on")
- At the end of the excavator pass in step 4: `g[k] = Σ regolith dug this tick by operating excavators on kind k / Σ regolith dug this tick by all excavators`.
- If nothing was dug this tick, `s.feed` keeps its last value. The inspector says so: `Feed (last dug)`.
- Kinds: `ilmenite`, `anorthosite`, `glass`, `kreep`, `volatiles`, `plain`.
- There is no time constant and no stockpile model, so a test can assert it exactly.
- The same `g` feeds every smelter and refinery this tick, because PROD_ORDER runs excavators first.

| Processor | Factor, applied to all outputs unless noted |
|---|---|
| H₂-reduction smelter (base recipe) | `fS = max(0.5, 1 + K·g.ilmenite − 0.30·g.anorthosite − 0.15·g.kreep)`, with `K = 0.30 × mods.feedBonus.ilmenite` (2 with Beneficiation, giving 0.60). O₂ output additionally ×`(1 + 0.6·g.glass)`. |
| MRE smelter (`recipe.feedInsensitive`) | 1.0: it melts any soil |
| Refinery | `fR = max(0.5, 1 + 0.40·g.anorthosite − 0.20·g.ilmenite)` (high-Ti basalt is plagioclase-poor) |
| Reactor | `g.kreep ≥ 0.15` → reactor upkeep ×0.6 (thorium make-up from local KREEP). Does not stack with a KREEP outpost; take the stronger. |

**Location-based effects**, where the building on the spot is the one affected

| Kind | Effect |
|---|---|
| Ice | the harvester needs revealed ice |
| Ridge | solar ×1.2 and never terrain-shaded; solar build time ×1.3 |
| KREEP | habitats cannot be placed on it (`RADIATION — KREEP soil: no habitats here`) |
| Volatiles | with Solar-Wind Volatiles, that excavator's water ×2.5 and its regolith ×0.9 |
| Glass | that excavator's upkeep ×1.3 (abrasive beads) |

`BuildingState.deposit?: DepositKind` is set in `commitPlace` from the footprint centre (`hf.depositAt`) and recomputed on load.

### S8 · New verbs

1. **Overclock** (Dynamic Clocking)
   - `BuildingState.overclock?: boolean`; `Action setOverclock{id,on}`; an inspector toggle following `palette.ts:233-260`.
   - Eligible: excavator, iceHarvester, smelter, refinery, partsFab, chipFab, lab, dataCenter, foilFactory, massDriver, propellantPlant.
   - Economy: in step 2, draw ×1.5; in step 4, inputs, outputs and data ×1.5; in step 6, wear +0.35 per lunar day **even while upkeep is paid**.
   - At wear ≥ 0.3 it turns itself off: `OVERCLOCK TRIPPED — Chip Fab #12 reached WORN`.
   - The inspector reads `OVERCLOCKED ×1.5 · WORN in 7:40`.
   - Draw changes go through the existing `brownoutHold`.
2. **Downlink** (Earth Teleoperation)
   - A Lander inspector button: `⇪ Downlink 150≡ → 60◆ 20⚙ 5▣ (½ day)`.
   - Cost is `150 + 50 × s.downlinks` data from the bank. The cargo arrives after 360 s through the existing shipment slot (`game.ts:366-377`, one shipment at a time, shared with resupply).
   - Rejections alert: `DOWNLINK NEEDS 200≡ BANKED — have 140`, and `SHIPMENT ALREADY EN ROUTE`.
   - It is the only data sink, and a relief valve for parts-starved or goods-stalled runs.
3. **Survey, claim and abandon.** See §5b.
4. **Grading gets a job**
   - Footprints of 9 or more cells, plus the massDriver, need `maxDelta ≤ MAX_SLOPE_LARGE` (start at 1.2 m) in `placement.ts:216`, with the reason `Too rough for a large pad (1.8 m relief > 1.2 m) — grade it (Site Grading)`.
   - Calibrate on 20 seeds so that, within 60 m and without grading, mare has ≥12 valid 3×3 pads, lava tube 3–8 and pole ≤3. The probe placed 0 grading passes in 21 runs, so this rule is what makes the tech matter.
5. **Launch capacity binds**
   - `LAUNCH_CAP_PER_VOLLEY = 3`: a volley needs 10▰ + 3↑ + 400 stored energy.
   - Volley interval: mare mass driver 200 s, pole driver 500 s, propellant plant 300 s.
   - The HUD swarm chip reads `LAUNCH ↑ 2.1/3 · ▰ 8/10`, and the Swarm Protocol card lists the con.
   - Agree the number with core-fixes; the probe acceptance is in §9.
6. **Robotic Crewed toggle fixed.** `game.ts:323` allows `setAutomated` when `mods.automation || (robotic && s.crew > 0)`. Otherwise it alerts `NEEDS CONSTRUCTION ROBOTICS (automation)` or `NO CREW ABOARD`.
7. **Crew rotation** (Human Cohabitation, robotic only)
   - `onTechComplete` sets `s.crewRotation = {at: t + 240, count: 2}`. The HUD shows `CREW ROTATION 3:40`.
   - At `at`, 2 settlers board if the base can keep them:

| Check | Threshold |
|---|---|
| O₂ | ≥ 60, or smelter O₂ output ≥ 0.04/s |
| Food | ≥ 12 |
| Water | ≥ 8 |
| Housing | ≥ 2 |

   - Otherwise: `CREW ROTATION HELD — needs 12 food (have 0) · build Hydroponics`, re-checked every 60 s.
   - On boarding: `CREW ROTATION — 2 settlers aboard. Stations are still agent-run: switch labs to Crewed in the inspector`.
   - After that the existing growth rule applies. This gives humans about 25 min before FIRST LIGHT instead of about 15, and it fixes the probe's "settlers board unsustainable bases" finding for the first arrivals.

### S9 · Honest trade-offs, and bugs that make cons real

- **`describeEffect(fx, ctx)`** in `techs.ts` returns `{sign, text, magnitude}[]`, driven by a polarity table per kind.
  - `powerMult < 1` on a consumer is a pro; on a generator it is a con.
  - `upkeepMult > 1` is a con.
  - `powerDelta < 0` is a con.
  - An `unlock` emits the building's mechanical cons from `BUILDINGS`: kW draw, parts per day, crew, morale delta < 0, and inputs.
  - The UI shows the generated lines, followed by `tradeoff` in italics as flavour only.
- **`debug.auditTechs()`** returns `{id, pros, cons, minConMagnitude}`. The test asserts:
  - `cons ≥ 1` for all 47 techs;
  - each multiplicative con has `|mult − 1| ≥ 0.05`;
  - each additive con is ≥ 1 kW, or is a per-use cost.
- **Crop loss** makes the Hydroponics con true.
  - A farm with `idleReason 'power'` at night accumulates `b.darkT`.
  - After more than 30 s it sets `b.cropRegrowT = 150`: output 0 until it expires.
  - Alert: `CROP LOST — Hydroponics #7 went dark 30 s; regrowing 2:30`.
- **Reactor STANDBY bug** (probe). `economy.ts:236-242` never marks crewed generators active, so the reactor's −5 morale never applies.
  - Fix: a generator (`powerKW > 0`) is `active` when enabled, complete, and either `crew === 0`, automated, or `b.staffedPrev` (staffed at last tick's step 3).
  - Step-1 supply is gated the same way.
  - The Thorium Reactor's morale con then works.
- **Retire the "Survey for ice" button** (`palette.ts:223`/`254`). It is replaced by a Lander inspector button, `◎ Open Lunar Map [M]`. The `surveyIce` action stays only as a debug and test alias that alerts `Deposits are mapped automatically inside your survey radius — open the map [M]`; no UI emits it.

### S10 · New buildings (`buildings.ts`, procedural meshes in `recipes.ts` from `meshKit` primitives)

| Building | Unlock | Footprint / height | Build time / cost | Crew / power | I/O | Upkeep / prio | Pro | Con |
|---|---|---|---|---|---|---|---|---|
| `relayMast` | Prospecting Rovers | 1×1 / 12 m | 40 s / 20◆ 5⚙ | 0 / −1.5 kW | — | 0.5⚙/day / 1 | `buildRadiusM 45`. The network radius extends from any completed mast, so masts chain. Reveals deposits within 45 m on completion. | Produces nothing and needs power |
| `propellantPlant` | Propellant Depot | 3×2 / 7 m | 240 s / 90◆ 30⚙ 20◇ | 1 / −18 kW | 0.30≈ + 0.05○ → 0.01↑/s; `ignoresLaunchMult` | 2⚙/day / 2 | Launch from any latitude | Drinks the crew's water |

Meshes: mast = cylinder + dish; plant = 2 tanks + a box.

**`buildRadiusM` per building:** lander 60, habitat 60, relayMast 45. It replaces the lander/habitat check at `placement.ts:171/221`.

### S11 · Exploration runtime (`src/core/exploration.ts`, new)

This is the M workstream (§5).
- `explorationTick(s, mods, site, dt)` runs as economy step 8.7: survey timers, outpost streams, hopper fuel, outpost upkeep, atlas check and `stats.outpostOpS`.
- `surveyTier(mods)`, `outpostSlots(mods, s)`, `prospectClass(site, pid)`.
- `revealDeposits(s, hf, tier)` runs on tier change, on building completion and on load.
- Step 0 subtracts the borrowed robot: `botsTotal -= s.survey.active ? 1 : 0`, minimum 0. The robot chip reads `2/4 · 1 surveying`.

### S12 · Coordination with core-fixes (shared files)

This spec assumes these have landed: partsFab metals-only (0.3 → 0.2, crew 1); hydroponics 0.03 → 0.10; parts, O₂ and water caps; `idleReason 'full'`; faster healing; resupply +40⚙; guaranteed near ice at 35–55 m.

This spec adds the following, which must be merged with core-fixes:

| File | This spec's changes |
|---|---|
| `buildings.ts` | `relayMast`, `propellantPlant`, `buildRadiusM`, `ignoresLaunchMult`, `hydroponics.unlockedFromStart` |
| `economy.ts` | step changes listed in S13 |
| `placement.ts` | large-pad slope rule, `buildRadiusM` network, deposit gating (revealed ice; no habitat on KREEP) |
| `balance.ts` | new constants |
| `game.ts` | `doLaunch` 3↑; `setAutomated` fix; `loadFrom` migration |
| `heightfield.ts` | deposits. The guaranteed ice deposit from core-fixes becomes `kind:'ice'` index 0 of the ice stream (`seed ^ 0x1ce` preserved). |

`LAUNCH_CAP_PER_VOLLEY` needs explicit sign-off from core-fixes.

### S13 · Economy step map (`economy.ts`, after this spec)

| Step | Changes |
|---|---|
| 0 robots | Survey borrows 1 robot; `waitingSitesPeak` |
| 1 supply | `effectiveDef`; `shadeImmune`; ridge solar ×1.2 and unshaded; generator staffing (`staffedPrev`); `powerBeam` is 0 while a flare is active; `shadedMaxS` |
| 2 demand | `1 + agentTax`; `nightDraw`; overclock ×1.5; `construction.kwMult`; negative-kW Lander as a priority-0 draw; `nightCritDark`, `darkNightMaxS`, `dayBrownouts` |
| 2.5 construction | `rateMult`, `partsMult`; `built++` |
| 4 production | `effectiveDef` recipes; excavator deposit effects; feed grade after the excavator pass; smelter and refinery feed factors; lab data (uplink share, `outputMult.lab`, `crewedOnly`, wear, overclock); DC data; `produced`; crop loss; generator `active` fix |
| 5 life support | `minReserveS` |
| 6 upkeep | `repairMult`; overclock wear and trip; KREEP-feed reactor upkeep; `maxDust`, `lowPartsSeen`, `wornSeen` |
| 7 morale | `minMorale` |
| 8 flare | HELIOPHYSICS +25; `flaresWithSix` |
| 8.5 shipment | Resupply and downlink share one slot |
| 8.7 exploration | `explorationTick`; crew rotation |
| 9 research | `researchTick` |
| 10 dawn | `cleanNightStreak`, `dcCleanNight`, `nightBrownouts` |
| 11 | `computeEra` every tick; milestones |

---

## 3. Full tech table: 47 definitions

**Notation**

| Symbol | Meaning |
|---|---|
| ⊕b | unlocks building b |
| out / in / pow / upk[b]×m | existing output, input, power and upkeep multipliers |
| crew[b]±n | existing crew delta |
| dust×m | existing dust multiplier |
| buildT×m | existing `buildSpeed` (global build time) |
| bots±n | existing `botPerBay` |
| M / P / L | mare, south pole, lava tube |
| crew | `crewTech`: on robotic runs, visible but locked until Human Cohabitation |
| R-only | `expeditions:['robotic']` |
| (R: E7·1250) | robotic override: era 7 at 1250 data |

New kinds are defined in §4: `recipe`, `agentTax`, `construction`, `storage`, `repair`, `shadeImmune`, `buildTime`, `action`, `survey`, `powerDelta`, `nightDraw`, `feedBonus`, plus the `crewedOnly` flag on `outputMult`.

**Glyphs:** ≡ data · ◆ metals · ◇ silicon · ≈ water · ○ O₂ · ⚙ parts · ▣ chips · ▰ foils · ↑ launch · ▲ regolith.

**Columns** in every table below:
- **Cost** is data + goods.
- **Req** is `requires`; **Any** is `requiresAny`.
- **Excl** is the doctrine group; **Sites/Exp** is the site and expedition filter.

### Era 1 · FIRST LANDING

**`regolithProcessing`** · MATERIALS · Regolith Smelting
- **Gating:** 30 · Req — · Any — · Excl — · Sites/Exp: all
- **Effects (pro):** ⊕smelter with the H₂-reduction recipe: 2▲ → 0.5◆ 0.25○ 0.05≈, −12 kW, feed-sensitive (S7)
- **Con:** smelter −12 kW (×1.6 agent-run), 2⚙/day; yield ×(1 − 0.30·g.anorthosite) on highland feed
- **Desc:** FeTiO₃ + H₂ → Fe + TiO₂ + H₂O: iron, oxygen and a trickle of water from ilmenite.
- **Flavour:** *Only the ilmenite reacts — dig where the basalt is dark.*
- **Insight:** —

**`teleoperation`** · ROBOTS & FAB · Earth Teleoperation ("Teleoperation")
- **Gating:** 120 · Req — · Any — · Excl — · Sites/Exp: all
- **Effects (pro):** buildT×0.85; action `downlink`
- **Con:** out[lab]×0.9 (shared downlink); each downlink spends 150 + 50·n banked data
- **Desc:** Earth pilots drive the builders through the 2.6 s round trip, and the same link can sell your data for cargo.
- **Flavour:** *Ops video and science share one antenna.*
- **Insight:** —

**`prospectingRovers`** · EXPLORATION · Prospecting Rovers
- **Gating:** 120 · Req — · Any — · Excl — · Sites/Exp: all
- **Effects (pro):** survey{tier 1}: local reveal 120 → 320 m; Moon map REGIONAL (≤27°); hopper surveys; ⊕relayMast
- **Con:** powerDelta[lander] −1 kW (rover charging); every survey borrows 1 robot for its duration
- **Desc:** Neutron and X-ray spectrometers on wheels, and a hopper for anything past driving range.
- **Flavour:** *Every kilometre surveyed is a robot not building.*
- **Insight:** —

**`siteGrading`** · ROBOTS & FAB · Site Grading
- **Gating:** 90 · Req — · Any — · Excl — · Sites/Exp: P, L
- **Effects (pro):** grading (a 16×16 m dozer pass; the only way to get ≤1.2 m relief for large pads)
- **Con:** 40 stored energy per pass
- **Desc:** Dozer blades flatten rough ground into pads for reactors, racks and rails.
- **Flavour:** *Each pass spends the night you were saving.*
- **Insight:** —

**`iceExtraction`** · HABITAT · Cryo Ice Extraction ("Ice Extraction")
- **Gating:** 130 · Req — · Any — · Excl — · Sites/Exp: P
- **Effects (pro):** ⊕iceHarvester (0.4≈/s on *revealed* ice)
- **Con:** harvester −8 kW, 2⚙/day; cold-trap floors fail the large-pad slope rule
- **Desc:** Mine water ice from permanently shadowed cold traps at 40 K. It is hopper propellant from day one.
- **Flavour:** *The ice is in the dark, and so is the harvester.*
- **Insight:** —

**`regolithVolatiles`** · HABITAT · Solar-Wind Volatiles ("Volatile Extraction")
- **Gating:** 100 · Req — · Any — · Excl — · Sites/Exp: M, L
- **Effects (pro):** recipe[excavator]{out 1.5▲ + 0.02≈, −9 kW}; an excavator on a volatiles deposit makes ≈ ×2.5
- **Con:** excavator −9 kW (was −6); on volatiles soil, ▲ ×0.9
- **Desc:** Heat mature soil to ~700 °C and the implanted solar wind comes out: H₂, H₂O, ³He.
- **Flavour:** *Four billion years of wind, a teaspoon a minute.*
- **Insight:** —

Robotic runs have water uses from Era 1: every hopper survey burns ≈ and ○ (§5b). So Ice Extraction and Volatile Extraction are live in Era 1 on both expeditions, and there are no robotic era overrides for them.

### Era 2 · EARLY CONSTRUCTION

**`batteryStorage`** · POWER · Battery Banks
- **Gating:** 110 · Req — · Any — · Excl — · Sites/Exp: all
- **Effects (pro):** ⊕battery (3,000 stored)
- **Con:** 15% round-trip loss; 50◆ 10◇ per bank
- **Desc:** Store the day. Survive the night.
- **Flavour:** *Metals you wanted elsewhere.*
- **Insight:** a night with any load shed (−40%)

**`thermalWadis`** · POWER · Thermal Wadis
- **Gating:** 120 · Req — · Any — · Excl — · Sites/Exp: M
- **Effects (pro):** nightDraw{night ×0.85} on all consumers
- **Con:** nightDraw{day ×1.05} (charging the heat banks)
- **Desc:** Sintered-regolith heat banks, charged by day, keep machines above survival temperature through the night (Balasubramaniam et al. 2010).
- **Flavour:** *You pay for the night at noon.*
- **Insight:** a building held dark ≥60 s at night (−40%)

**`peakLightMasts`** · POWER · Vertical Solar Masts ("Solar Masts")
- **Gating:** 130 + 20◆ · Req prospectingRovers · Any — · Excl — · Sites/Exp: P
- **Effects (pro):** shadeImmune; pow[solar]×1.1
- **Con:** buildTime[solar]×1.5; upk[solar]×1.3
- **Desc:** 10 m masts lift arrays above the rim's own shadows (NASA VSAT).
- **Flavour:** *Tall is slow to build and hard to service.*
- **Insight:** an array shaded ≥60 s (−40%)

**`skylightHeliostats`** · POWER · Skylight Heliostats ("Heliostats")
- **Gating:** 130 + 10◇ · Req prospectingRovers · Any — · Excl — · Sites/Exp: L
- **Effects (pro):** pow[solar]×1.25
- **Con:** dust×1.5
- **Desc:** Rim mirrors pour sunlight down the skylight.
- **Flavour:** *Mirrors love dust.*
- **Insight:** a daytime brownout (−40%)

**`siliconRefining`** · SILICON & COMPUTE · Silicon Refining
- **Gating:** 130 · Req regolithProcessing · Any — · Excl — · Sites/Exp: all
- **Effects (pro):** ⊕refinery
- **Con:** refinery −14 kW, 2⚙/day; yield ×(1 − 0.20·g.ilmenite) on high-Ti feed
- **Desc:** Anorthite to wafer-grade silicon.
- **Flavour:** *Another furnace for the night to strangle.*
- **Insight:** 150▲ in stock (−30%)

**`partsFabrication`** · ROBOTS & FAB · Parts Fabrication
- **Gating:** 110 · Req regolithProcessing (**P1b**) · Any — · Excl — · Sites/Exp: all
- **Effects (pro):** ⊕partsFab (0.3◆ → 0.2⚙/s, 1 crew; core-fixes)
- **Con:** fab −10 kW; eats 0.3◆/s (48% of a mare smelter)
- **Desc:** Make your own spares.
- **Flavour:** *A supply chain that also needs maintaining.*
- **Insight:** parts below 20 (−40%)

**`constructionRobotics`** · ROBOTS & FAB · Construction Robotics
- **Gating:** 130 · Req — · Any teleoperation, prospectingRovers · Excl — · Sites/Exp: all
- **Effects (pro):** ⊕roboticsBay (+2 robots); `automation` `{expeditions:['human']}`, the per-station Crewed/Autonomous toggle (absorbs Autonomous Operations)
- **Con:** bay −3 kW and 1⚙/day even when idle; agent-run stations draw ×(1 + agentTax) = ×1.6
- **Desc:** Autonomous builders, and on crewed bases autonomous operators.
- **Flavour:** *Robots wait expensively.*
- **Insight:** 5 buildings completed (−40%)

**`regolithShielding`** · HABITAT · Regolith Shielding
- **Gating:** 140 · Req — · Any siteGrading, constructionRobotics · Excl — · Sites/Exp: all
- **Effects (pro):** upk[all]×0.85
- **Con:** repair×0.5 (wear heals at half speed)
- **Desc:** Two metres of berm on every structure: thermal mass, radiation, micrometeorites.
- **Flavour:** *Buried machines are slower to reach.*
- **Insight:** a flare goes active with ≥6 structures running (−40%)

**`moltenElectrolysis`** · MATERIALS · Molten Regolith Electrolysis ("MRE Smelting")
- **Gating:** 150 + 10⚙ · Req regolithProcessing · Any — · Excl smeltDoctrine (M, L); stands alone on P · Sites/Exp: all
- **Effects (pro):** recipe[smelter]{2▲ → 0.65◆ 0.40○ 0.04◇, −22 kW, feedInsensitive}
- **Con:** smelter −22 kW (was −12); **no water**; upk[smelter]×1.5 (anode wear)
- **Desc:** Melt regolith at ~1,600 °C and pass a current: O₂ at the anode, Fe–Si alloy at the cathode, from any soil.
- **Flavour:** *Brute force: the grid pays, and the water trickle dies.*
- **Insight:** 300◆ smelted (−30%)

**`ilmeniteBeneficiation`** · MATERIALS · Ilmenite Beneficiation ("Beneficiation")
- **Gating:** 140 · Req regolithProcessing, prospectingRovers · Any — · Excl smeltDoctrine · Sites/Exp: M, L
- **Effects (pro):** feedBonus{ilmenite ×2}, so the H₂ smelter gains +60% instead of +30% per unit of ilmenite share; in[smelter]×0.8
- **Con:** pow[excavator]×1.3 (magnetic separators on every excavator)
- **Desc:** Magnetic and electrostatic separation at the pit: feed the furnace only ilmenite.
- **Flavour:** *Chase the ore: the map decides your yield.*
- **Insight:** an excavator digging ilmenite for 60 s (−40%)

Beneficiation acts only through the ilmenite feed of the H₂ smelter, and MRE is foreclosed once you take it. It therefore always pairs with hydrogen reduction.

### Era 3 · ROBOTIC FABRICATION

**`thoriumPower`** · POWER · Thorium Reactor
- **Gating:** 200 + 80◆ · Req regolithShielding · Any — · Excl nightPower · Sites/Exp: all
- **Effects (pro):** ⊕reactor (+40 kW, independent of the sun)
- **Con:** 120◆ 40⚙ to build; 4⚙/day; −5 morale while humans are aboard (needs the S9 fix)
- **Desc:** Fission surface power behind a regolith berm.
- **Flavour:** *Baseload that eats parts like a rover fleet.*
- **Insight:** 2 nights survived (−30%)

**`regenFuelCells`** · POWER · Regenerative Fuel Cells ("Fuel Cells")
- **Gating:** 180 + 80≈ · Req batteryStorage · Any — · Excl nightPower · Sites/Exp: all
- **Effects (pro):** storage{battery capacity ×2}
- **Con:** storage{grid round-trip 0.85 → 0.60}; an 80≈ charge
- **Desc:** Split water by day and recombine it by night: bulk tanks, not cells.
- **Flavour:** *Half of what you store comes back.*
- **Insight:** 100≈ banked (−40%)

**`swarmRobotics`** · ROBOTS & FAB · Swarm Robotics
- **Gating:** 180 + 20⚙ · Req constructionRobotics · Any — · Excl constructionDoctrine · Sites/Exp: all
- **Effects (pro):** bots +1 per bay; buildT×0.85
- **Con:** construction{kW×1.5} (6 kW per active site); upk[roboticsBay]×1.5
- **Desc:** The fleet coordinates itself.
- **Flavour:** *One bad firmware push walks in formation.*
- **Insight:** 3 sites waiting for robots at once (−30%, shared)

**`heavyConstructors`** · ROBOTS & FAB · Heavy Constructors
- **Gating:** 180 + 20⚙ · Req constructionRobotics · Any — · Excl constructionDoctrine · Sites/Exp: all
- **Effects (pro):** construction{rate×2.2, parts×0.6}
- **Con:** bots −1 per bay; construction{kW×2} (8 kW per site)
- **Desc:** Fewer, bigger machines: each build 2.2× faster on 60% of the weld.
- **Flavour:** *Fewer builds at once, each a power spike.*
- **Insight:** shared with Swarm Robotics

**`dustMitigation`** · MATERIALS · Dust Mitigation
- **Gating:** 160 · Req — · Any partsFabrication, constructionRobotics · Excl — · Sites/Exp: all
- **Effects (pro):** dust×0.4; upk[excavator]×0.5
- **Con:** pow[solar]×0.95 (electrodynamic dust shields draw from the array)
- **Desc:** Electrostatic curtains and sealed bearings against the Moon's knife-dust.
- **Flavour:** *The brooms run on sunlight.*
- **Insight:** an array at ≥25% dust (−50%)

**`btLavaTubeCaverns`** · EXPLORATION (slot 1) · ✦ Lava-Tube Caverns (breakthrough)
- **Gating:** 190 · Req — (discovery) · Any — · Excl — · Sites/Exp: all
- **Discovery:** hosts `tranqPit`, `mariusTube`, `ingeniiPit`
- **Effects (pro):** pow[habitat, dataCenter]×0.85; upk[habitat, dataCenter, chipFab]×0.7
- **Con:** buildTime[habitat, dataCenter, chipFab]×1.3
- **Desc:** Radar-sounded tubes prove basalt vaults hold a steady temperature. Bury your most delicate machines, in a tube or a trench.
- **Flavour:** *Down is slow.*
- **Insight:** —

### Era 4 · CHIP FABRICATION

**`waferFab`** · MATERIALS · Wafer Fabrication
- **Gating:** 260 + 40◇ · Req siliconRefining, partsFabrication · Any — · Excl — · Sites/Exp: all
- **Effects (pro):** ⊕chipFab (0.15◇ + 0.02⚙ → 0.05▣/s)
- **Con:** chipFab −18 kW, 2⚙/day
- **Desc:** Hard vacuum is the cleanest cleanroom ever built.
- **Flavour:** *The most delicate machine, in the dustiest place.*
- **Insight:** 150◇ in stock (−30%)

**`acceleratorDesign`** · SILICON & COMPUTE · Accelerator Design
- **Gating:** 300 + 30◇ · Req waferFab · Any — · Excl chipDoctrine · Sites/Exp: all
- **Effects (pro):** out[dataCenter]×1.5 (absorbs Inference Optimization)
- **Con:** in[chipFab]×1.25 (big dies, lower yield)
- **Desc:** TPU-class masks tuned for inference.
- **Flavour:** *Specialised silicon does one thing.*
- **Insight:** —

**`radHardProcess`** · SILICON & COMPUTE · Rad-Hard Process ("Rad-Hard Chips")
- **Gating:** 300 + 30◇ · Req waferFab · Any — · Excl chipDoctrine · Sites/Exp: all
- **Effects (pro):** out[chipFab]×1.4; agentTax×0.6 (agent draw ×1.6 → ×1.36)
- **Con:** out[dataCenter]×0.85
- **Desc:** Older, larger nodes and thick oxides that shrug off cosmic rays.
- **Flavour:** *Robust silicon thinks slower.*
- **Insight:** —

**`cleanroomRobotics`** · ROBOTS & FAB · Cleanroom Robotics
- **Gating:** 280 + 30⚙ · Req waferFab · Any swarmRobotics, heavyConstructors · Excl — · Sites/Exp: all
- **Effects (pro):** pow[chipFab]×0.7; in[chipFab]×0.8
- **Con:** upk[chipFab]×1.5
- **Desc:** Sealed handling lines built by the construction fleet.
- **Flavour:** *More robots for the parts budget.*
- **Insight:** first Chip Fab completes (−30%)

**`orbitalProspector`** · EXPLORATION · Orbital Prospector
- **Gating:** 240 + 5▣ · Req prospectingRovers, waferFab · Any — · Excl — · Sites/Exp: all
- **Effects (pro):** survey{tier 2}: whole local map; NEAR SIDE; first outpost slot
- **Con:** powerDelta[lander] −2 kW (ground station)
- **Desc:** A polar orbiter with a gamma-ray spectrometer: your chips, Earth's rocket.
- **Flavour:** *Someone has to listen every pass.*
- **Insight:** 3 regional prospects surveyed (−40%)

**`btVolcanicGlass`** · EXPLORATION (slot 2) · ✦ Volcanic Glass Reduction ("Glass Reduction")
- **Gating:** 280 · Req — · Any — · Excl — · Sites/Exp: all
- **Discovery:** hosts `taurusLittrow`, `aristarchus`, `schrodinger`
- **Effects (pro):** out[smelter]×1.2
- **Con:** pow[smelter]×1.15 (hotter reduction)
- **Desc:** Apollo 17's orange beads reduce fastest. Tune every furnace to Fe-rich glass chemistry.
- **Flavour:** *Hotter, faster, hungrier.*
- **Insight:** —

### Era 5 · LUNAR COMPUTE

**`lunarDataCenter`** · SILICON & COMPUTE · Lunar Data Center ("Data Center")
- **Gating:** 420 + 10▣ · Req waferFab · Any — · Excl — · Sites/Exp: all
- **Effects (pro):** ⊕dataCenter (1.0≡/s; transfers 2.5/s)
- **Con:** −30 kW day and night; 2.5⚙/day; 15▣ to build
- **Desc:** Racks under regolith, radiators facing the black sky.
- **Flavour:** *The night negotiates with your batteries.*
- **Insight:** 6 labs operating (−40%)

**`dynamicClocking`** · SILICON & COMPUTE · Dynamic Clocking
- **Gating:** 440 + 5▣ · Req — · Any acceleratorDesign, radHardProcess · Excl — · Sites/Exp: all
- **Effects (pro):** action `overclock`: output ×1.5 per building (S8.1)
- **Con:** while overclocked, kW and inputs ×1.5 and wear +0.35/day; trips at WORN
- **Desc:** Push silicon and machines past nameplate when it counts.
- **Flavour:** *Heat is a debt.*
- **Insight:** —

**`cryoRadiators`** · POWER · Cryo Radiators
- **Gating:** 480 + 60◆ · Req lunarDataCenter · Any — · Excl — · Sites/Exp: all
- **Effects (pro):** pow[dataCenter]×0.65
- **Con:** upk[dataCenter]×1.6
- **Desc:** Reject heat to a 3 K sky.
- **Flavour:** *Acres of foil that micrometeorites love.*
- **Insight:** a Data Center has operated 720 s (−30%)

**`crewWellness`** · HABITAT · Crew Wellness Program ("Crew Wellness")
- **Gating:** 460 (robotic: E7 · 1250) · Req — · Any — · Excl — · Sites/Exp: all · crew
- **Effects (pro):** ⊕recDome (+14 morale)
- **Con:** dome −4 kW, 1 crew, 0.05 food/s
- **Desc:** Plants, a screen, low-g handball.
- **Flavour:** *A pure cost centre.*
- **Insight:** morale below 50 (−40%)

### Era 6 · HUMAN HABITATION

**`humanCohabitation`** · HABITAT · Human Cohabitation
- **Gating:** 1250 + 30⚙ 10▣ · Req regolithShielding · Any thoriumPower, regenFuelCells · Excl — · Sites/Exp: all · R-only
- **Effects (pro):** ⊕habitat, ⊕hydroponics; crew rotation of 2 settlers after 240 s (S8.7); unlocks the crew techs
- **Con:** life support per crew of 0.02○ + 0.008 food + 0.005≈ per second; habitats −4 kW; brownouts now cost morale; hopper O₂ now competes with lungs
- **Desc:** Shielded quarters and night-proof power, then invite the humans.
- **Flavour:** *Lungs, stomachs and moods.*
- **Insight:** 2 consecutive clean nights (−40%)

**`closedLoopLS`** · HABITAT · Closed-Loop Life Support ("Closed-Loop LS")
- **Gating:** 1150 + 25⚙ · Req — · Any thoriumPower, regenFuelCells · Excl — · Sites/Exp: all · crew
- **Effects (pro):** in[habitat]×0.6 (life-support need)
- **Con:** pow[habitat]×1.3
- **Desc:** Scrub, recycle, repeat.
- **Flavour:** *The recyclers never sleep.*
- **Insight:** a life-support reserve under 5 min (−40%)

**`safetyProtocols`** · ROBOTS & FAB · Safety Protocols
- **Gating:** 1200 + 10▣ · Req regolithShielding · Any — · Excl — · Sites/Exp: all · crew
- **Effects (pro):** upk[all]×0.8
- **Con:** buildT×1.15
- **Desc:** Human inspectors walk the lines the agents only watch. This is the *safety measures* purpose.
- **Flavour:** *Checklists slow everything they save.*
- **Insight:** a building worn past 0.3 (−50%)

**`conditionOptimization`** · MATERIALS · Condition Optimization ("Condition Tuning")
- **Gating:** 1200 + 10▣ · Req lunarDataCenter · Any — · Excl — · Sites/Exp: all · crew
- **Effects (pro):** out[excavator, iceHarvester, smelter, refinery]×1.15
- **Con:** pow[habitat]×1.25
- **Desc:** Researchers tune set-points that agents merely accept. This is the *optimizing conditions* purpose.
- **Flavour:** *Comfort costs watts.*
- **Insight:** —

**`scienceCrews`** · SILICON & COMPUTE · Science Crews
- **Gating:** 1150 · Req lunarDataCenter · Any — · Excl — · Sites/Exp: all · crew
- **Effects (pro):** out[lab]×1.35 `crewedOnly`; survey{dataMult 1.5 while ≥2 crew are aboard}
- **Con:** pow[lab]×1.4 (sample-prep and instrument racks on every lab)
- **Desc:** Geologists and physicists on site ask the questions the agents didn't. This is the *research* purpose.
- **Flavour:** *Every scientist is a bunk and a meal.*
- **Insight:** 6 crew aboard (−25%)

**`farSideRelay`** · EXPLORATION · Far-Side Relay
- **Gating:** 1100 + 15▣ 20⚙ · Req orbitalProspector · Any — · Excl — · Sites/Exp: all
- **Effects (pro):** survey{tier 3}: FAR SIDE; +1 outpost slot
- **Con:** powerDelta[lander] −2 kW
- **Desc:** A halo-orbit relay at Earth–Moon L2, like Queqiao.
- **Flavour:** *The whole far side through one antenna.*
- **Insight:** 3 near-side prospects surveyed (−40%)

**`btColdTrapChemistry`** · EXPLORATION (slot 2) · ✦ Cold-Trap Chemistry (breakthrough)
- **Gating:** 1150 · Req — · Any — · Excl — · Sites/Exp: all
- **Discovery:** hosts `cabeus`, `hermite`
- **Effects (pro):** out[hydroponics]×1.4; out[propellantPlant]×1.25; out[chipFab]×1.1
- **Con:** upk[hydroponics, propellantPlant, chipFab]×1.3 (NH₃/H₂S corrosion)
- **Desc:** The LCROSS plume held CO, NH₃ and H₂S: carbon, nitrogen and process gases for a living base.
- **Flavour:** *Useful chemistry is corrosive chemistry.*
- **Insight:** —

### Era 7 · SWARM INDUSTRY

**`foilManufacturing`** · MATERIALS · Thin-Film Foils
- **Gating:** 1250 + 40◇ · Req waferFab · Any cleanroomRobotics, dustMitigation · Excl — · Sites/Exp: all
- **Effects (pro):** ⊕foilFactory
- **Con:** −20 kW; consumes 0.6◇ + 0.2◆/s; 3 crew
- **Desc:** Collector foils micrometres thick. Thin film needs clean handling.
- **Flavour:** *The largest draw you will ever build.*
- **Insight:** 250◇ in stock (−30%)

**`massDriver`** · EXPORT · Electromagnetic Mass Driver ("Mass Driver")
- **Gating:** 1400 + 50⚙ · Req partsFabrication, batteryStorage · Any — · Excl launchArchitecture · Sites/Exp: all
- **Effects (pro):** ⊕massDriver: 0.01↑/s × site launchMult (M 1.5, L 1.0, P 0.6)
- **Con:** −15 kW; 6×2 pad with ≤1.2 m relief; at the pole, 500 s per 3↑ volley
- **Desc:** A 2.4 km/s rail with no propellant.
- **Flavour:** *Rails can't steer: latitude is destiny.*
- **Insight:** 400◆ banked (−30%)

**`propellantDepot`** · EXPORT · Propellant Depot
- **Gating:** 1400 + 40⚙ 40◆ · Req partsFabrication · Any iceExtraction, regolithVolatiles · Excl launchArchitecture · Sites/Exp: all
- **Effects (pro):** ⊕propellantPlant: 0.30≈ + 0.05○ → 0.01↑/s, ignores launchMult
- **Con:** drinks 18≈/min; −18 kW; 1 crew
- **Desc:** Water becomes LOX/LH₂; rockets steer where rails can't.
- **Flavour:** *The crew drinks the same water.*
- **Insight:** 300≈ banked (−40%)

**`selfReplication`** · ROBOTS & FAB · Self-Replicating Systems ("Self-Replication")
- **Gating:** 1700 + 80⚙ 15▣ · Req lunarDataCenter · Any swarmRobotics, heavyConstructors · Excl — · Sites/Exp: all
- **Effects (pro):** out[excavator, smelter, refinery, iceHarvester]×1.3; out[partsFab, foilFactory]×1.6; crew[partsFab, foilFactory]−1; bots +1 per bay
- **Con:** pow[those 6]×1.25; upk[roboticsBay]×2
- **Desc:** Machines that maintain and extend machines. Absorbs Self-Assembly and Automated Fabrication.
- **Flavour:** *Every doubling doubles a bad batch.*
- **Insight:** a fleet of 8 robots (−30%)

**`deepSounding`** · EXPLORATION · Deep Sounding Network ("Deep Sounding")
- **Gating:** 1250 + 20▣ · Req farSideRelay · Any — · Excl — · Sites/Exp: all
- **Effects (pro):** survey{tier 4}: SUBSURFACE; +1 slot; enables ATLAS
- **Con:** powerDelta[lander] −3 kW
- **Desc:** Orbital radar, GRAIL-class gravimetry and a seismometer network.
- **Flavour:** *Listening to the whole Moon takes power.*
- **Insight:** a far-side prospect surveyed (−40%)

**`crewWellness`**, robotic runs only (the same definition, resolved): HABITAT, **E7 · 1250**. On robotic runs it is visible and locked until Cohabitation; its row is shown here because charters count the resolved era. Everything else is as in Era 5.

### Era 8 · DYSON SWARM (lane-free capstone column)

**`swarmProtocol`** · Swarm Protocol (**capstone**)
- **Gating:** 3300 + 5▰ 10▣ · Req foilManufacturing · Any massDriver, propellantDepot · Excl — · Sites/Exp: all
- **Effects (pro):** launchAction (LAUNCH is armed)
- **Con:** consumes 5 test foils; each volley costs 10▰ + **3↑** + 400 stored
- **Desc:** Deployment doctrine for a trillion collectors.
- **Flavour:** *The five test foils never come back.*
- **Insight:** ATLAS COMPLETE (−25%)

**`powerBeaming`** · Power Beaming Return
- **Gating:** 3400 · Req swarmProtocol, batteryStorage · Any — · Excl swarmPurpose · Sites/Exp: all
- **Effects (pro):** powerBeam: +4 kW per volley launched
- **Con:** beam drops to 0 while a flare is active
- **Desc:** The swarm pays rent in microwaves.
- **Flavour:** *Your grid now depends on hardware 40 million km away.*
- **Insight:** —

**`vonNeumann`** · Von Neumann Foundry
- **Gating:** 4000 + 20▰ · Req swarmProtocol, selfReplication · Any — · Excl swarmPurpose · Sites/Exp: all
- **Effects (pro):** out[foilFactory]×3
- **Con:** pow[foilFactory]×1.5
- **Desc:** Foil factories that seed foil factories.
- **Flavour:** *A monument to obsolescence.*
- **Insight:** —

### Totals and metrics (computed by `final/techs.py`)

| Metric | Value |
|---|---|
| Definitions | **47**, including 3 breakthroughs; 32,330 data for the full tree |
| Available per run (after filtering and doctrine exclusivity; breakthroughs included) | robotic mare 37, pole 38, lava 38; human mare 36, pole 37, lava 37 |
| Visible before doctrine picks | 42–44 |
| Lane slots per run | 14 (robotic mare and lava), 13 (robotic pole; human mare and lava), 12 (human pole) |
| Requires edges | **58**, in **11 OR-groups**; **22** edges span 2 or more eras. The audit targeted ≥50, ≥8 and ≥8. |
| Doctrines | 6 groups, 12 techs; ≤2 per era; none in Era 1 |
| Cheapest robotic-mare path to FIRST LIGHT | 20 techs, 11,190 data before insights and deeds. The honest model path researches 33 techs, 14,354 data. |
| Dead techs where shown | **0** (`techRelevance` test) |
| Text-only trade-offs | **0** (`auditTechs` test) |
| Robotic era overrides | 1 (crewWellness → E7) |

**TechId changes against the current 34 ids**

| Change | Ids |
|---|---|
| Kept (28) | regolithProcessing, iceExtraction, siteGrading, teleoperation, batteryStorage, siliconRefining, partsFabrication, constructionRobotics, regolithShielding, thoriumPower, swarmRobotics, dustMitigation, waferFab, acceleratorDesign, cleanroomRobotics, lunarDataCenter, cryoRadiators, humanCohabitation, closedLoopLS, crewWellness, safetyProtocols, conditionOptimization, foilManufacturing, massDriver, selfReplication, swarmProtocol, powerBeaming, vonNeumann |
| New (19) | prospectingRovers, regolithVolatiles, thermalWadis, peakLightMasts, skylightHeliostats, moltenElectrolysis, ilmeniteBeneficiation, regenFuelCells, heavyConstructors, btLavaTubeCaverns, radHardProcess, orbitalProspector, btVolcanicGlass, dynamicClocking, scienceCrews, farSideRelay, btColdTrapChemistry, propellantDepot, deepSounding |
| Removed (6) | hydroponicFarming, autonomousOps, roboticSelfAssembly, inferenceOptimization, autoFabrication, hiEffLaunch (§8) |

**`TechDef` shape** (`techs.ts:45`)

```ts
type Lane = 'power'|'materials'|'robotics'|'compute'|'habitat'|'exploration'|'export';
type DoctrineId = 'smeltDoctrine'|'nightPower'|'constructionDoctrine'|'chipDoctrine'|'launchArchitecture'|'swarmPurpose';
interface TechDef {
  id: TechId; era: Era; lane?: Lane /* omitted for era 8 */; name: string; short: string /* ≤18 chars */;
  costData: number; costGoods?: Partial<Record<ResourceId, number>>;
  requires: TechId[]; requiresAny?: TechId[]; exclusive?: DoctrineId;
  sites?: SiteId[]; expeditions?: ('human'|'robotic')[];      // replaces roboticOnly
  crewTech?: boolean; robotic?: { era?: Era; costData?: number };
  breakthrough?: { hosts: ProspectId[]; slot: 1 | 2 };
  effects: TechEffect[]; desc: string; tradeoff: string /* flavour only */;
}
```

---

## 4. New effect kinds (`techs.ts` `TechEffect`, consumed via `mods.ts`)

Every kind accepts optional `sites?: SiteId[]` and `expeditions?: Exp[]`; `computeMods` skips the effect where they do not match. Multipliers compose multiplicatively; deltas add.

| Kind | Mods field (default) | Exact semantics | Consumed at |
|---|---|---|---|
| `{kind:'recipe', building, inputs?, outputs?, powerKW?, feedInsensitive?}` | `recipe[b]` (none) | Replaces those fields of the base definition, and multipliers apply afterwards. Within a doctrine only one member ever applies; otherwise the last in `techsDone` order wins. | `effectiveDef()`, used by economy steps 1, 2 and 4, `palette.ioRows`, `infoPanel` and the placement preview |
| `{kind:'agentTax', mult}` | `agentTax` (0.6) | An agent-run crewed station draws ×(1 + agentTax) | `economy.ts:113`; `palette.ts:44/195/235` |
| `{kind:'construction', kwMult?, rateMult?, partsMult?}` | `constructionKWMult`, `weldRateMult`, `weldPartsMult` (1) | Site draw = `CONSTRUCTION_KW × kwMult`; progress per tick = `dt × rateMult`; weld = `0.04 × partsMult` per second | `economy.ts:107`, `:158`, `:166` |
| `{kind:'storage', capacityMult?, efficiency?}` | `batteryCapMult` (1), `storageEff` (0.85) | Battery `storageKWh` × mult; charge efficiency replaces `BATTERY_EFF` grid-wide | `economy.ts:88`, `:174` |
| `{kind:'repair', mult}` | `repairMult` (1) | Wear recovery per lunar day × mult | `economy.ts:340` |
| `{kind:'shadeImmune'}` | `solarShadeImmune` (false) | Solar ignores `b.shaded` (the ×0.15) | `economy.ts:92`; the shading loop at `game.ts:567` is skipped |
| `{kind:'buildTime', buildings, mult}` | `buildTimeMult[b]` (1) | `buildTotal` × mult for new placements | `game.commitPlace` (`game.ts:408`) |
| `{kind:'action', id:'overclock'\|'downlink'}` | `actions: Set` | Enables the verb; without it the action alerts `NEEDS <tech>` | `game.applyAction`; palette inspector buttons |
| `{kind:'survey', tier?, dataMult?, minCrew?}` | `surveyTier` = max (0); `surveyDataMult` (1) | `tier` sets the reveal radius, the visible prospect classes and the outpost slots (§5b table). `dataMult` applies while `s.crew ≥ minCrew`. | `exploration.ts`, `placement.ts` (revealed-ice gate), `lunarMap.ts`, `$lunar` |
| `{kind:'powerDelta', building, kw}` | `powerDelta[b]` (0) | Flat kW added to the effective `powerKW` before `powerMult`. A negative Lander becomes a priority-0 draw. Outposts add their link kW to `powerDelta.lander` via `computeMods(…, outposts)`. | `effectiveDef` → economy steps 1 and 2; Lander inspector |
| `{kind:'nightDraw', night, day}` | `nightDrawMult` / `dayDrawMult` (1) | Every consumer's draw (not construction sites) × (isNight ? night : day) | `economy.ts:116` |
| `{kind:'feedBonus', deposit, mult}` | `feedBonus[k]` (1) | Multiplies that deposit's positive feed coefficient (S7) | economy step 4 feed factors; inspector feed line |

Existing kinds that change:
- `outputMult` gains `crewedOnly?: true`, applied only when `!isAuto(b)` (`economy.ts:218-220`, `:229`).
- `powerBeam` supplies 0 while `s.flare.phase === 'active'` (`economy.ts:97`).
- `automation` is now emitted by Construction Robotics with `expeditions:['human']`.
- `grading` is unchanged, and is now needed because of `MAX_SLOPE_LARGE`.

All other existing kinds are unchanged. There is no `launch` kind and no `buildCost` kind.

**`Mods` fields added:** `recipe`, `agentTax`, `constructionKWMult`, `weldRateMult`, `weldPartsMult`, `batteryCapMult`, `storageEff`, `repairMult`, `solarShadeImmune`, `buildTimeMult`, `actions`, `surveyTier`, `surveyDataMult`, `surveyMinCrew`, `outpostSlots`, `powerDelta`, `nightDrawMult`, `dayDrawMult`, `feedBonus`, `kreepOutpost`, `crewedOutputMult`.

---

## 5. Lunar map and deposits

### 5a · Local site deposits (`src/data/deposits.ts`, `src/terrain/heightfield.ts`)

**Generation**
- `Heightfield.deposits: Deposit[]` holds `{id, kind, cx, cz, r, leadX, leadZ}`, generated from `DEPOSIT_PLAN[site]`.
- The ice stream keeps `seed ^ 0x1ce`, so existing ice layouts and the core-fixes guaranteed deposit stay stable. Other kinds use `mulberry32(seed ^ (0xde90 + kindIndex))`.
- A candidate is rejected if it overlaps another deposit, lies within 20 m of the lander pad, or (lava tube) lies outside `buildableRadiusM`.
- A ridge is placed at the highest of 40 sampled candidates in its ring.
- `iceDeposits` stays as a filtered getter; `onIce` becomes `depositAt(x,z)?.kind === 'ice'`.

| Kind (overlay pattern, glyph) | Sites · count · radius · distance | Acts through | Pro | Con | Real basis |
|---|---|---|---|---|---|
| ilmenite / high-Ti basalt (dashed ring, ◆) | M 4 (1 guaranteed at 30–50 m), L 2 (1 at 30–50 m) · 16–26 m · 30–320 m | feed | H₂ smelter +0.30 × share (+0.60 with Beneficiation) | refinery −0.20 × share | Mare basalts with 5–10 wt% TiO₂ |
| anorthosite / highland (dotted ring, ◇) | P 3 (1 at 40–60 m); M 1 ejecta ray at 250–420 m · 22–34 m | feed | refinery +0.40 × share | H₂ smelter −0.30 × share | Plagioclase-rich crust; anorthite is silica- and Al-rich and Fe-poor |
| glass / pyroclastic (double ring, ○) | L 2 (1 within 60 m) · 16–24 m · ≤200 m | feed (O₂) + excavator | H₂ smelter O₂ +0.60 × share | the excavator digging it: upkeep ×1.3 | Apollo 17 beads gave the highest H₂-reduction O₂ yields |
| KREEP (thin ring + ☢) | L 1 · 18 m · 60–150 m | feed + location | share ≥ 0.15 → reactor upkeep ×0.6 | H₂ smelter −0.15 × share; **no habitats on it** | Marius Hills sit in the Procellarum KREEP Terrane |
| volatiles / mature soil (thin dotted ring, ≈) | M 3, L 1 · 24–36 m · 60–350 m | the excavator itself | with Volatile Extraction, that excavator's ≈ ×2.5 | that excavator's ▲ ×0.9 (fine agglutinates) | Solar-wind H at 50–150 ppm; high ³He in Tranquillitatis |
| ice / cold trap (solid ring, ❄) | P 6 + 1 guaranteed at 35–55 m · 18–34 m · 35–340 m | location | the only place an Ice Harvester works | crater floors fail the large-pad slope rule | LCROSS; permanently shadowed regions near 40 K |
| ridge / peak of light (thin ring + ▲) | P 2 · 14–20 m · 80–250 m, on local maxima | location | solar ×1.2 and never terrain-shaded | solar build time ×1.3 (steep access) | Shackleton rim illumination |

**Reveal: automatic and tier-driven**
- **T0:** 120 m from the lander.
- **T1** (Prospecting Rovers): 320 m.
- **T2** (Orbital Prospector): the whole 1 km map.

**Leads**
- Every unrevealed surface deposit within 400 m shows as a **'?' lead** at `(leadX, leadZ)`. The lead is jittered ±10 m, and the jitter is stable per seed.
- On the pole every cold-trap crater floor shows `? cold trap`.
- The overlay label is `? possible high-Ti basalt`. Kinds are hinted only when orbital data would show them (ilmenite, anorthosite, KREEP); others read `? unknown`.

**Other reveals**
- A completed Relay Mast reveals everything within 45 m.
- Placing a building on an unrevealed deposit reveals it on placement (`s.survey.struck`): `PROSPECT STRUCK — Excavator #9 is on ilmenite-rich basalt (smelter feed +30%)`.
- An Ice Harvester needs **revealed** ice: `ICE UNCONFIRMED — extend your survey (Prospecting Rovers) or place a Relay Mast nearby`.

**Legibility**
- **Placement ghost line**, one per kind:
  - `On high-Ti basalt — smelter feed ↑`
  - `On highland anorthosite — refinery feed ↑ · smelter feed ↓`
  - `On pyroclastic glass — smelter O₂ ↑ · excavator wear ×1.3`
  - `On KREEP — reactor fuel make-up at ≥15% feed · no habitats here`
  - `On mature soil — water ×2.5 with Volatile Extraction · regolith ×0.9`
  - `On confirmed ice`
  - `On a peak of light — solar ×1.2, never shaded · build ×1.3`
- **Smelter and refinery inspector:** `Feed (last dug): 64% high-Ti · 8% highland → yield +17%`.
- **Regolith info panel:** a stacked feed bar.

**Overlay** (`[I]`; `game.buildDepositOverlay()` replaces `buildIceOverlay()` at `game.ts:699`)
- Terrain-conforming `LineSegments` rings with the existing `LineBasicMaterial`, so no new shaders.
- Kinds are told apart by pattern (above), never by colour alone.
- DOM glyph labels sit at the projected centres through the wear-marker path (`$depositMarkers`). Leads draw as '?' glyphs.
- The HUD chip `◎ DEPOSITS [I]` replaces the ice chip, and the `KeyI` handler at `game.ts:242` no longer requires `iceSurveyed`.

### 5b · The Lunar Map (`[M]`; `src/ui/lunarMap.ts`, `src/data/lunarMap.ts`, DOM/SVG)

**Home coordinates** (new fields on `SiteDef` in `src/data/sites.ts`):

| Site | lat | lon | Basis |
|---|---|---|---|
| mare (ILMENITE PLAINS) | 0.8°N | 23.0°E | Mare Tranquillitatis |
| southpole (SHACKLETON RIM) | 89.9°S | 0° | rim |
| lavatube (MARIUS HILLS TUBE) | 14.1°N | 56.8°W | skylight at 14.09°N 303.23°E |

**Class of each prospect relative to home** (`prospectClass()`, great-circle haversine)

| Class | Rule |
|---|---|
| local | ≤ 2° (≈ 60 km) |
| regional | ≤ 27° (≈ 820 km) |
| near side | `\|lon\| ≤ 90° or \|lat\| ≥ 80°` |
| far side | everything else |
| subsurface | flagged prospects; always need T4 |

**Coverage tiers and what the map shows.** The map starts local and grows.

| Tier | Tech (era) | Views unlocked; the viewBox animates outward on unlock | Prospects visible (M / P / L) | Local reveal | Outpost slots |
|---|---|---|---|---|---|
| T0 Landing site | start | SITE (1 km top-down) and VICINITY (±3° orthographic around home) | 2 / 2 / 2 | 120 m | 0 |
| T1 Regional | Prospecting Rovers (E1) | REGION (±30° orthographic, centred on home) | 8 / 6 / 6 | 320 m | 0 |
| T2 Near side | Orbital Prospector (E4) | NEAR (full Earth-facing disc) | 23 / 24 / 23 | whole map | 1 |
| T3 Far side | Far-Side Relay (E6) | FAR (near/far toggle) | 30 / 30 / 30 | — | 2 |
| T4 Subsurface | Deep Sounding (E7) | MOON (both hemispheres side by side) | 34 / 34 / 34 | — | 3 |
| ATLAS COMPLETE | T4 + 12 prospects surveyed | — | — | — | 4 |

**What the player sees as it grows**
- **Minute 0.** The SITE view: lander, the 120 m reveal ring, the 60 m network ring, revealed deposits, '?' leads and buildings. A 120 px corner thumbnail shows a dark Moon with one pin, labelled `orbital imagery only — no ground truth`. The zoom-out control to VICINITY shows the 2 local prospects, 15–60 km away.
- **Each tier unlock.** If the map is open, the viewBox tweens outward over 1.2 s (instant under `prefers-reduced-motion`). If it is closed, the HUD map chip pulses `MAP EXPANDED — T2 NEAR SIDE` and the animation plays the next time it opens.
- **Projection changes** (REGION → NEAR, which moves the centre to 0°,0°) cross-fade over 300 ms.
- The 1 km SITE view stays as a 150 px inset in the bottom-left of every Moon view.

**Screen layout at 1280×720**

| Region | Size and position | Content |
|---|---|---|
| Header | 40 px | `LUNAR MAP · T2 NEAR SIDE · 9/34 surveyed · outposts 1/1 · survey: Cabeus 1:20`; the rule line *Look, visit, settle.*; view buttons `SITE · VICINITY · REGION · NEAR · FAR · MOON` (locked ones read `🔒 T2 Orbital Prospector`); close `[M]` |
| Main SVG | 836×600 at x 12–848, y 52–652 | the current view |
| Right panel | 408 px, x 860–1268 | the selected prospect's sheet, or a **"Next surveyable"** list sorted by class then distance, headed by the site-weakness line |
| Bottom strip | 56 px | the tier ladder (T0 … T4, ATLAS, each with its tech and status) plus outpost mini-cards: stream, fuel ✓/✗, upkeep ✓/✗ |

**Site-weakness framing** (top of the "Next surveyable" list)

| Site | Line |
|---|---|
| Mare | `Ilmenite Plains lacks water → Cabeus or Haworth ice outpost (near side, T2) · Tranquillitatis mature soil (regional)` |
| Pole | `Shackleton lacks metals and launch geometry → Maskelyne or Moltke ilmenite (near side) · pick Propellant Depot` |
| Lava tube | `Marius Hills lacks power → Marius Hills domes or Mons Rümker KREEP outpost (reactor upkeep ×0.6, output ×1.15)` |

**Basemap** (`MARIA` in `src/data/lunarMap.ts`)
- Each mare is a projected spherical cap of 48 vertices, filled `ink-600` over `ink-700` highlands, with a 30° graticule.
- Unrevealed areas are hatched by an SVG `<mask>`.

| Mare | Centre | Angular radius |
|---|---|---|
| Imbrium | 32.8N 15.6W | 18° |
| Serenitatis | 28.0N 17.5E | 11.5° |
| Tranquillitatis | 8.5N 31.4E | 14° |
| Crisium | 17.0N 59.1E | 9° |
| Fecunditatis | 7.8S 51.3E | 12° |
| Nectaris | 15.2S 35.5E | 5.5° |
| Nubium | 21.3S 16.6W | 11.5° |
| Humorum | 24.4S 38.6W | 6.5° |
| Vaporum | 13.3N 3.6E | 4° |
| Frigoris | 3 caps of 6° at 56N and lon −30, 0, 30 | 6° each |
| Procellarum | 3 caps: 30N 50W 15°; 10N 55W 15°; 0 45W 12° | — |
| Orientale | 19.4S 92.8W | 5°, plus a 15° dashed ring |
| Moscoviense | 27.3N 147.9E | 4.5° |
| Australe | 38.9S 93E | 10° |
| Smythii | 1.3N 87.3E | 6° |
| Ingenii | 33.7S 163.5E | 4° |
| South Pole–Aitken | 53S 169W | 41°, dashed outline |

**Markers**
- Glyph plus ring, with a hit target ≥ 16 px. States are shown by shape:

| State | Marker |
|---|---|
| unsurveyed | hollow |
| surveying | dashed ring rotating; static under reduced motion |
| surveyed | filled |
| outpost | square frame |
| heritage | ⌂ |
| breakthrough host | ✦ once surveyed; `✦?` before |

- Re-render only on a structural signature change (tier, view, surveyed set, outposts, discoveries). Timers update in place.

**Survey** (action `surveyProspect{id}`)
- One survey at a time. It borrows 1 robot for its duration.
- It is paid when started. Every shortfall alerts, for example `SURVEY NEEDS 33○ — have 21` or `SURVEY IN PROGRESS — Maskelyne 0:40`. `d` is the great-circle distance in degrees, and every formula result is rounded to the nearest whole unit.

| Class | Needs | Method | Stored energy | O₂ | Water | Parts | Time | Base data |
|---|---|---|---|---|---|---|---|---|
| local | T0 | lander micro-rover | 60 | 0 | 0 | 0 | 60 s | 20 |
| regional | T1 | hopper | 60 | min(200, 20 + 1.0·d) | min(40, 4 + 0.2·d) | 5 | min(420, 60 + 3·d) s | 30 |
| near side | T2 | hopper | 100 | same formula | same formula | 5 | same formula | 50 |
| far side | T3 | relay-guided hopper | 150 | same formula | same formula | 10 | same formula | 80 |
| subsurface | T4 | radar and seismic | 200 | 0 | 0 | 10 | 300 s | 100 |

- **Payout** = base × novelty, where novelty is ×1 / ×0.5 / ×0.25 for the 1st / 2nd / 3rd-and-later surveyed prospect of the same `kind`. Anomalies without a breakthrough add +20 before novelty. The total is × `surveyDataMult` (Science Crews, 1.5 while ≥2 crew are aboard).
- **Worked examples:** mare → Tranquillitatis pit (12.7°) costs 33○ 7≈ 5⚙ and takes 98 s. Mare → Cabeus (89°) costs 109○ 22≈ and takes 327 s. Mare → Daedalus (156°) costs 176○ 35≈ and takes 420 s.
- **Completion alert:** `SURVEY COMPLETE — Maskelyne high-Ti basalt · +30≡ · ilmenite outpost possible`, plus `BREAKTHROUGH …` if the prospect hosts one.
- The O₂ and water cost gives the robotic O₂ glut (1,200–5,800 in the probe) a use, and makes water matter from Era 1 on every site.

**Outposts** (actions `claimOutpost{id}` and `abandonOutpost{id}`)

**Claim requirements**
- surveyed;
- a free slot;
- the kind is not heritage or anomaly: `PROTECTED HERITAGE SITE — survey only` (the Artemis Accords keep-out) or `NOTHING TO EXTRACT — anomaly`;
- goods paid.

**Running rules**
- Streams are continuous from `readyAt`.
- The first delivery raises `OUTPOST ONLINE — Cabeus ice: +0.20≈/s`.
- Unpaid upkeep raises `OUTPOST WORN — stream ×0.5`.
- A hopper outpost whose fuel is short stops its stream and raises `HOPPER GROUNDED — Cabeus needs 0.02○/s + 0.004≈/s (have 0○)`. It resumes automatically.
- `abandonOutpost` frees the slot with no refund.

**Cost, deploy time and upkeep by class** (a single table)

| Class | Claim cost | Deploy | Upkeep | Link (added to `powerDelta.lander`) | Hopper fuel (visible line on the card) |
|---|---|---|---|---|---|
| local / regional (rover haul) | 60◆ 20⚙ 5▣ | 240 s | 2⚙/day | −1 kW | — |
| near side (hopper) | 100◆ 30⚙ 10▣ | 360 s | 3⚙/day | −1.5 kW | 0.02○ + 0.004≈ /s |
| far side (relay hopper) | 120◆ 40⚙ 15▣ | 480 s | 4⚙/day | −2 kW | 0.03○ + 0.006≈ /s |
| subsurface (drill) | 150◆ 40⚙ 20▣ | 600 s | 4⚙/day | −2 kW | 0.03○ + 0.006≈ /s |

**Outpost kinds** (6), with streams sized as a supplement

| Kind | Stream | Sized against |
|---|---|---|
| ice | 0.20≈/s (Shoemaker 0.25) | 50% of one Ice Harvester |
| volatiles | 0.08≈/s | about 2 volatile excavators |
| ilmenite | 0.20◆ + 0.08○/s (SPA mass 0.30◆) | 32% of a mare smelter, without its 19 kW |
| glass | 0.20○ + 0.02≈/s | 64% of a mare smelter's O₂ |
| silica | 0.15◇/s | 30% of a mare refinery |
| KREEP | modifier while online: reactor upkeep ×0.6 and output ×1.15; chipFab output ×1.1 (REE dopants) | never idle: the chip term covers Fuel Cells runs |
| radio | +0.35≡/s into the bank | about 1.6 robotic labs, still under the transfer cap |

**Supplement acceptance (probe):** at FIRST LIGHT, outposts supply ≤ 25% of each resource's production. Slots are at most 4.

**Prospects** (`PROSPECTS` in `src/data/lunarMap.ts`). There are 34. The class column gives the class and distance for each site, in the order Mare / Pole / Lava.

| id | Name | lat, lon | Class M / P / L | Kind · breakthrough | Real basis |
|---|---|---|---|---|---|
| tranquilityBase | Tranquility Base (Apollo 11) | 0.67N 23.47E | local 0° / near 91° / near 80° | heritage | EASEP and 57 years of dust; survey only |
| moltke | Moltke crater ejecta | 0.58S 24.16E | local 2° / near 89° / near 81° | ilmenite | fresh 7 km crater exposing high-Ti basalt |
| maskelyne | Maskelyne high-Ti basalt | 2.20N 30.10E | reg 7° / near 92° / near 86° | ilmenite | TiO₂ ~10 wt% flows |
| tranqRegolith | Central Tranquillitatis mature soil | ≈5N 28E | reg 7° / near 95° / near 84° | volatiles | highest solar-wind H and ³He in the maria |
| tranqPit | Mare Tranquillitatis pit | 8.34N 33.22E | reg 13° / near 98° / near 88° | anomaly · ✦ Caverns | LROC skylight about 100 m across |
| descartes | Descartes highlands (Apollo 16) | 8.97S 15.50E | reg 12° / near 81° / near 75° | silica | plagioclase-rich anorthosite |
| taurusLittrow | Taurus–Littrow orange glass (Apollo 17) | 20.19N 30.77E | reg 21° / near 110° / near 83° | glass · ✦ Glass | Shorty crater pyroclastic beads |
| ina | Ina irregular mare patch | 18.65N 5.30E | reg 25° / near 109° / near 59° | anomaly (+20) | possibly <100 Myr volcanism |
| lamont | Lamont mascon | 4.40N 23.70E | sub / sub / sub | anomaly (+20) | buried dense basalt that perturbs orbits |
| shackletonFloor | Shackleton floor (PSR) | 89.67S 129.80E | near 91° / local 0° / near 104° | ice | cold trap near 40 K |
| connectingRidge | Shackleton–de Gerlache ridge | ≈89.45S 125W | near 91° / local 1° / near 104° | silica | anorthositic massif, lit about 90% of the year |
| cabeus | Cabeus (LCROSS impact) | 84.68S 48.72W | near 89° / reg 5° / near 99° | ice · ✦ Cold-Trap | 5.6 wt% H₂O plus CO, NH₃, H₂S |
| haworth | Haworth PSR | 87.40S 5.00W | near 89° / reg 3° / near 102° | ice | large PSR with a strong radar CPR signal |
| malapert | Malapert Massif | 86.00S 2.70E | near 87° / reg 4° / near 102° | anomaly (+20) | 5 km peak with Earth always in view |
| schrodinger | Schrödinger basin vent | 75.00S 132.40E | far 96° / reg 15° / far 119° | glass · ✦ Glass | young pyroclastic vent on the basin floor |
| shoemakerIce | Shoemaker subsurface ice | 88.10S 44.90E | sub / sub / sub | ice (0.25≈) | Diviner ice-stability depth < 1 m |
| mariusTube | Marius Hills tube interior | 14.09N 56.77W | near 80° / near 104° / local 0° | anomaly · ✦ Caverns | radar-sounded intact tube beyond the skylight |
| mariusDomes | Marius Hills domes | ≈13.0N 55.5W | near 79° / near 103° / local 2° | kreep | Procellarum KREEP Terrane volcanics |
| reinerGamma | Reiner Gamma swirl | 7.50N 59.00W | near 82° / near 97° / reg 7° | anomaly (+20) | crustal magnetic anomaly that deflects the solar wind |
| aristarchus | Aristarchus Plateau dark mantle | ≈24.7N 49.0W | near 73° / near 115° / reg 13° | glass · ✦ Glass | pyroclastic glass, high Th |
| monsRumker | Mons Rümker | 40.80N 58.10W | near 83° / near 131° / reg 27° | kreep | KREEP-rich volcanic complex |
| gruithuisen | Gruithuisen silicic domes | ≈36.3N 40.5W | near 68° / near 126° / reg 27° | silica | rare silica-rich volcanism |
| fraMauro | Fra Mauro breccias (Apollo 14) | 3.65S 17.47W | near 41° / near 86° / near 43° | kreep | KREEP basalts, Th about 10× average |
| copernicus | Copernicus central peaks | 9.62N 20.08W | near 44° / near 100° / near 36° | anomaly (+20) | exposed deep-crust stratigraphy |
| hadley | Hadley Rille (Apollo 15) | 26.13N 3.63E | near 31° / near 116° / near 58° | heritage | Apollo 15 rover tracks |
| hermite | Hermite floor (~26 K) | 86.00N 89.90W | near 91° / near 176° / near 73° | ice · ✦ Cold-Trap | coldest measured spot (LRO Diviner) |
| daedalus | Daedalus radio-quiet zone | 5.90S 179.40E | far 156° / far 84° / far 124° | radio | shielded from Earth's radio noise |
| moscoviense | Mare Moscoviense | 27.30N 147.90E | far 120° / far 117° / far 132° | ilmenite | far-side mare basalt |
| vonKarman | Von Kármán (Chang'e 4) | 45.44S 177.60E | far 130° / far 45° / far 125° | heritage | first far-side landing, 2019 |
| comptonBelkovich | Compton–Belkovich | 61.10N 99.50E | far 83° / far 151° / far 102° | silica | far-side silicic volcano, Th hot spot |
| ingeniiPit | Mare Ingenii pit | 35.95S 166.06E | far 131° / far 54° / far 136° | anomaly · ✦ Caverns | far-side skylight inside a swirl |
| apolloBasin | Apollo basin (inside SPA) | 36.00S 151.00W | far 144° / far 54° / far 102° | ilmenite | FeO-rich deep-crust floor |
| spaMass | SPA deep mass anomaly | ≈56S 170W | sub / sub / sub | ilmenite (0.30◆) | GRAIL excess mass, possibly buried impactor iron |
| procellarumTubes | Procellarum buried tube network | ≈14.5N 57.5W | sub / sub / sub | anomaly (+20) | GRAIL gravity lows along sinuous rilles |

**Local T0 parity.** Every site has exactly 2 local prospects worth 20 data each, 40 in total:

| Site | Local prospects |
|---|---|
| Mare | Tranquility Base, Moltke |
| Pole | Shackleton floor, Shackleton–de Gerlache ridge |
| Lava tube | Marius tube, Marius domes |

This closes the Era-1 arithmetic (§7).

**ATLAS COMPLETE** (T4 plus 12 prospects surveyed) grants:
- +1 outpost slot (4 in total);
- all outpost streams ×1.25;
- an insight of Swarm Protocol −25% ("the survey net becomes the swarm's tracking-and-timing network"), or +500 data if Swarm Protocol is already done;
- the non-blocking milestone `SELENOGRAPHER`.

The map header shows `9/34 surveyed · ATLAS needs T4 + 12`.

**Stores**

```ts
$lunar = { tier, view, maxView, justExpanded, slots, used, surveyedCount, atlas,
           prospects: [{id, cls, dist, visible, surveyed, kind, bt, claimable, reason}],
           active: {id, remaining} | null,
           outposts: [{id, kind, readyAt, fuelOk, upkeepOk, stream}] }
$deposits = [{id, kind, x, z, r, revealed, lead: {x, z} | null, inNetwork}]
```

**HUD chip** (under the era chip): `◎ MAP [M] · T2 NEAR SIDE · survey 1:20`.

---

## 6. Tree UI (`src/ui/techTree.ts`, replacing `screens.ts:117-325`; DOM/SVG only)

### Layout at 1280×720, with the detail sheet open

| Row | Height | Content |
|---|---|---|
| Header | 36 px | `RESEARCH · ERA 5 LUNAR COMPUTE`; the rule *An era opens with 2 of the previous era's techs — or 1 plus a deed.*; the rate chip `≡ 2.4/s · cap 3.3/s`; `[M] Map`; `Close [T]` |
| Era header | 32 px | 8 columns (below) |
| Grid | 486 px | a 64 px lane-label column plus 8 era columns of 149 px (141 px cards and 8 px link gutters) |
| Sheet | 148 px | detail sheet, collapsible to 28 px |
| Padding | 18 px | 6 px top, 6 px above the sheet, 6 px bottom |

**Height check:** 36 + 32 + 486 + 148 + 18 = **720**.

**Era header columns** read `E5 · COMPUTE` with a gate line:
- `◼◻ 1/2 · or 1 + 20▣ fabbed (12/20)`
- On robotic runs, Era 7 adds `+ Cohabitation ✗`.
- The current column gets a faint band.

**Grid**
- Lanes are CSS grid rows sized by their **per-run** maximum slot count, computed from the visible techs and breakthrough placeholders.
- Robotic mare has 14 slots (2 per lane); human pole has 12.
- `--slot-h: clamp(28px, calc((100vh − 234px) / var(--slots)), 44px)`, which is 34.7 px at 720 px with 14 slots. Cards are `--slot-h − 4px`, about 30 px.
- Below 1280 px width, columns shrink to 118 px and names ellipsize.
- **Era 8 is a lane-free capstone column:** Swarm Protocol as a double-height card, centred, then the bracketed swarmPurpose pair. It is always on screen.
- The background is opaque: `#tech-screen` uses ink-900 at alpha 1; it was 0.97 at `ui.css:193`.

### Card: 141 × ~30 px, two lines

- **Line 1:** state glyph + `short` name, in 12px/14px weight 600, with ellipsis.
- **Line 2:** `cost≡ goods · tag`, in 10px/12px mono.
  - The tag is the first generated pro, for example `UNLOCK Chip Fab`, `+50% ≡ DC` or `NEW ACTION overclock`.
  - Goods you cannot afford are dimmed and struck through.
- **Markers**
  - ◇ plus the left bracket: doctrine
  - ✦: breakthrough
  - ◬: site tech (tooltip `Ilmenite Plains only`)
  - `✎−40%`: insight earned
  - ⚠ `needs 10▣`: stalled

| State | Rendering (shape and value, never hue alone) |
|---|---|
| done | solid border, ✓ |
| queued | `#n` and a 2 px progress bar |
| available | hairline border |
| locked | dashed border, 38% opacity, ⬑ |
| foreclosed | name struck through, 25% opacity |
| stalled | ⚠ |
| full | ⊘ |
| placeholder | dotted `✦ ?` |

### Detail sheet (hovered card, or the sticky selection)

**Header strip (26 px)**
- Left: the queue, `QUEUE 3/5 — 1. Data Center 45% ETA 2:10 · 2. Dynamic Clocking (waiting: 5▣, have 3 — Chip Fab) · …`
- Right: `◬ 4 techs belong to other landing sites`, listed on hover.

**Body (122 px), three columns**
1. **Identity.** Name, era·lane, doctrine badge, status and exact lock reason (for example `needs Thorium Reactor OR Regenerative Fuel Cells`), `desc`, italic flavour, and the site note, built from `@site` effects and site facts. Example: `At Ilmenite Plains: MRE makes no water — your hoppers need Volatile Extraction`.
2. **Effects.** The generated ⊕ and ⊖ lines (pros first); the unlocked building's `ioRows` from `effectiveRates` with its pro and con; and the **YOUR BASE** preview from `previewTech`, for example `Your 2 Data Centers: −21 kW`.
3. **Cost and path**
   - data after insight: `420 → 252 · ✎ 6 labs operating`;
   - goods as have/need plus the producer;
   - ETA from `researchRateAvg`: `ETA 3:40 · ≈1:13 at 3×`, or `then waits ~3:20 for 10▣ (Chip Fab 3/min)`;
   - requires and any-of, each ticked;
   - `leads to →` (direct dependents);
   - the insight hint before it fires: `⚡ Insight: a night brownout (−40%)`;
   - buttons `[Queue]`, `[Queue path ⇧]`, `[Cancel]`.

### Links (one SVG layer behind the cards; orthogonal routing in the gutters)

- **Solid** for a done source, **dashed** for pending.
- `requiresAny` edges converge on a 6 px "OR" diamond at the target's left edge.
- **Goods links** are computed, not authored, and drawn dotted, on hover only: chips → waferFab, foils → foilManufacturing, silicon → siliconRefining, water → iceExtraction or regolithVolatiles.
- By default only same-lane and adjacent-lane edges are drawn. All edges of the hovered or selected card are drawn highlighted.
- **Hover** highlights the prerequisite closure (for OR groups the satisfied member, or every member dashed) and the direct dependents, and dims everything else to 35%.

### Doctrine presentation

- A left bracket reads `DOCTRINE · CHOOSE ONE · PERMANENT`; the question shows on hover.
- Clicking a doctrine card only **selects** it. The sheet then shows **both members side by side**, with their generated ⊕/⊖ lines and YOUR BASE numbers, and a button `[Commit to Swarm Robotics — permanent]`.
- Only Commit pushes the `research` action.
- The sibling shows `foreclosed (pending)` until you cancel.
- At the pole, the lone MRE card has no bracket.

### Queue behaviour

- `QUEUE_MAX = 5`.
- **Click an available card** to enqueue it.
- **Click a queued card** (or right-click) to cancel it. The cancel is transitive: `sanitizeQueue` removes dependents, and each removed item alerts `RESEARCH DROPPED`.
- **Shift-click** queues the closure (`researchPath`).
- **Full queue:** the card shows the `full` state and the action alerts `QUEUE FULL (5/5) — cancel one first`.
- Items waiting on goods are skipped by the transfer, and complete by themselves the tick the goods exist.
- The queue can be reordered with ↑ in the sheet, and is re-sanitized after each move.

### Other rules

- **Rebuild** only when the signature `era|done|queue|doctrines|stalled|insights|discoveries|visible` changes. Progress and ETA update in place, as at `screens.ts:176` today.
- **Keys:** `T` toggles, arrows move the selection, `Enter` queues, `Shift+Enter` queues the path, `Esc` closes.
- **`$research`** replaces `$tech`. It is computed in `game.publish()` from `research.ts` as `{era, gates, cards{tid: {state, reason, cost, eta, stalledNeed, insight}}, queue[{tid, pct, eta, stalled, need}], rate, cap, bank, paused, otherSites[]}`. The UI never recomputes any of it.
- **Info panel** (`infoPanel.ts`, research section): each lab's mode and uplink share, the 0.75 robotic factor, each DC's output, and the cap formula. This replaces the lab-only text at `infoPanel.ts:103-106`.

---

## 7. Pacing model

**Model:** `scratchpad/final/pace.py`. It integrates second by second at 1×, from landing at t = 90 s. The day is 480 s and the night 240 s.

### What the model includes

- **Facilities appear only after their tech,** plus build time × site `buildCostMult` (mare 0.8, pole 1.25, lava 1.2), plus 30 s of player reaction. This fixes Draft A's error of building facilities before they were researched.

| Facility | Online when |
|---|---|
| Smelter, refinery, partsFab | tech + 120 s × bcm |
| Battery | max(tech, refinery + 40 s) + 60 × bcm |
| Reactor | tech + 300 × bcm |
| Fuel cells | tech, once a battery exists |
| Chip Fab #1 | waferFab + 200 × bcm |
| Chip Fab #2 | Chip Fab #1 + 15 min |
| DC #k | needs LDC done **and 15▣ in stock**; + 260 × bcm; at most one per 10 min; at most 3 |
| Foil factory | tech + 240 × bcm |
| Mass driver | tech + 360 × bcm |
| Propellant plant | tech + 240 × bcm |

- **Chips are an explicit stock:** 0.05▣/s per fab (×1.4 with Rad-Hard). Research goods, DC builds and outpost claims consume them.
- **Lab schedule** (robotic): 1 lab at 3.2 min, 2 at 4.0, 3 at 14, 4 at 22, 5 at 32, 6 at 42, 7 at 54, 8 at 66. Human: 1 lab at 3.5 min, 2 at 13, 3 at 22, 4 at 30, 5 at 40, 6 at 52, 7 at 64 (crew-limited early). Pole times are ×1.15, lava ×1.12.
- **Lab data per second** = `E(n) × 0.3 × 0.75 × 0.9 (teleop) × u`.

| Condition | Utilisation u |
|---|---|
| Day | 0.95 (×0.8 in E1–E2 for the power and parts crunch; lava ×0.85 until heliostats) |
| Mare or lava night, lander storage only | 0.25 |
| Night with batteries | 0.6 |
| Night with night power | 0.9 |
| Thermal Wadis | +0.08 at night |
| Pole | 0.9–0.95 day and night |

- **Crewed labs after Cohabitation plus Science Crews:** 2 labs at 0.28 × 1.35.
- **DC data** = 1.0 × 1.5 (Accelerator) × u_dc, with night u_dc = 0.4 / 0.6 / 0.95 by storage level.
- **Radio outpost:** +0.35/s. It is claimed after Far-Side Relay (15▣) and deploys in 480 s. The first outpost is claimed after Orbital Prospector (10▣) and deploys in 360 s.
- **Transfer cap** = 0.4 × labs + 2.5 × DCs, with no constant term.
- **Queue:** 5 items taken from a "reasonable player" priority list in `pace.py`, with the pass 1 / pass 2 goods skip.
- **Insights:** a 50% expected capture (cost × (1 − 0.5 × discount)). The no-insight bound is reported below.
- **Surveys:** one at a time, class by class with breakthrough hosts first, with the §5b data, novelty decay and cooldowns (duration + 150 s). Appetite per tier: T0 2, T1 all regional, T2 6, T3 3, T4 2.
- **Charters:** both routes are modelled with the §S2 deeds.
- **FIRST LIGHT:** Swarm Protocol done, ≥10▰ in stock and ≥3↑ banked.

### Robotic mare, the reference run (`python3 pace.py mare robotic -t`)

| Era | Opens (min) | Via | Duration | Labs / DCs at end | Avg data/s | Produced + survey data | Paid for these techs |
|---|---|---|---|---|---|---|---|
| 1 | 1.5 | start | **9.4** | 2 / 0 | 0.19 | 110 + 40 | RP 30 + Rovers 120 = **150** |
| 2 | 10.9 | 2 techs | **10.4** | 3 / 0 | 0.38 | 238 + 90 | Parts 88, Teleop 120, Silicon 110 = 318 |
| 3 | 21.3 | 2 techs | **11.3** | 5 / 0 | 0.62 | 422 + 45 | Battery 88, ConstrRob 104, Shielding 112, Thorium 170 = 474 |
| 4 | 32.6 | 1 + 150◇ deed | **14.4** | 6 / 0 | 0.85 | 735 + 25 | Swarm 153, Wadis 96, Wafer 221, Orbital 192 = 662 |
| 5 | 47.0 | 2 techs | **15.7** | 7 / 1 | 1.12 | 1,054 + 38 | Benef 112, Accel 300, LDC 336, Clocking 440 = 1,188 |
| 6 | 62.7 | 2 techs | **12.5** | 8 / 2 | 3.05 | 2,290 + 50 | Volatiles 100, Dust 120, ✦Caverns 190, Cryo 408, ✦Glass 280, Cleanroom 238, **Cohab 1,000** = 2,336 |
| 7 | 75.2 | 1 + outpost day + Cohab | **16.1** | 8 / 3 | 5.22 | 5,050 + 100 | Wellness 1,000, Far-Side 880, Science 1,006, Condition 1,200, Foils 1,062 = 5,148 |
| 8 | 91.4 | 2 techs | **11.7** to FIRST LIGHT | 8 / 3 | 6.42 | 4,507 + 20 | Mass Driver 1,190, Swarm Protocol 2,888 = 4,078 |

**Result.** Swarm Protocol completes at 101.9 min and **FIRST LIGHT comes at 103.1 game-min, or 34.4 min at 3×.** Era durations are 9.4 / 10.4 / 11.3 / 14.4 / 15.7 / 12.5 / 16.1 / 11.7, so the longest era is **1.7×** the shortest. Before the redesign that ratio was up to 3× in P1b-flat and 17× in the expert baseline.

**Arithmetic checks**
- **E1.** The labs produce 110 data and the two T0 local surveys add 40, for 150. The gate pair is Regolith Smelting 30 + Prospecting Rovers 120 = 150. The T0 survey lumps close the gap, and each site has the same 40 (§5b).
- **E2.** 238 + 90 = 328 produced against 318 paid; the remainder is spent on the next era's queue.
- **E5 rate.** 7 agent labs: E(7) = 5.8, × 0.225 × 0.9 × ~0.9 ≈ 1.06/s, plus the first DC for its last 0.5 min, averaging 1.12/s.
- **E7 rate.** At full strength: labs 6.4 × 0.2025 × 0.93 ≈ 1.2, plus 3 DCs × 1.5 × ~0.93 ≈ 4.2, plus radio 0.35, gives ≈ 5.75/s. DC#3 arrives at 82.2 min and radio at about 83, so the era average is 5.2/s ✓. The cap is 0.4 × 8 + 2.5 × 3 = 10.7, so it never binds after the DCs.
- **Chip budget.** This was never checked in the drafts.
  - Chip Fab #1 comes online at 45.4 min and #2 at 60.4 min.
  - From 45.4 to 60.4 min, 15 min × 3/min gives 45▣. Spent in that window: Orbital 5 + first outpost 10 + LDC 10 + DC#1 15 = 40.
  - After 60.4 min the base makes 6/min, against later demand of DC#2 15, DC#3 15, Cohab 10, Far-Side 15, radio outpost 15, Condition 10, Clocking 5 and Swarm Protocol 10.
  - The model ends with 166▣ spare with 2 fabs.
  - With **one** fab (`pace_fab.py fabs=1`), the reasonable path still finishes at 103.2 min, but with only 38▣ left. Adding the full chip set (Deep Sounding 20, Self-Replication 15, Safety 10, Clocking 5, which is +45▣) puts it in deficit, and DC#2/#3 wait on chips.
  - **The spec therefore plans for 2 Chip Fabs by about 60 min.** The detail sheet shows a chip forecast. When queued chip goods plus planned DC builds exceed 1.5× the next 10 minutes of production, a WAITING hint reads `2nd Chip Fab recommended: 3▣/min vs 5▣/min demand`.
  - Each fab draws 18 kW and eats 0.15◇/s (0.19 with Accelerator, 0.15 with Cleanroom), so 2 fabs with Accelerator take 0.375◇/s of a mare refinery's 0.5. Foils (0.6◇/s) need a second refinery in Era 7, which the Foils sheet says.
- **Data Centers go live only after LDC plus chips.** LDC is done at 57.1 min and DC#1 is online at 62.2, DC#2 at 72.2 and DC#3 at 82.2. None is placed before its tech.

### All six runs

| Run | FIRST LIGHT (game-min) | vs robotic mare | Era durations E1…E8 (min) |
|---|---|---|---|
| Robotic mare | **103.1** | — | 9.4 / 10.4 / 11.3 / 14.4 / 15.7 / 12.5 / 16.1 / 11.7 |
| Robotic pole | **111.1** | +7.8% | 8.5 / 15.0 / 11.1 / 15.9 / 16.0 / 13.3 / 16.5 / 13.4 |
| Robotic lava tube | **117.0** | +13.5% | 11.3 / 12.5 / 15.9 / 14.3 / 14.8 / 14.4 / 16.6 / 15.8 |
| Human mare | 95.2 | −7.6% | 10.8 / 12.7 / 9.4 / 12.4 / 13.3 / 13.1 / 13.3 / 8.6 |
| Human pole | 105.6 | +2.4% | 10.1 / 16.6 / 10.2 / 14.6 / 11.1 / 17.0 / 14.0 / 10.5 |
| Human lava tube | 110.7 | +7.4% | 13.0 / 13.1 / 15.2 / 13.0 / 10.2 / 18.0 / 14.0 / 12.7 |

### Sensitivities (robotic)

| Case | Mare | Pole | Lava |
|---|---|---|---|
| No insights (`pins=0`), the bound J3 asked for | 111.6 | 120.1 | 126.2 |
| Every insight earned (`pins=1`) | 93.8 | 101.7 | 106.9 |
| Only 1 Data Center (`maxdc=1`) | 124.4 | 129.0 | 133.8 |
| Rad-Hard doctrine (`chip=rad`, DC ×0.85) | 114.4 | 119.7 | 125.3 |

Every case stays within 130, except lava tube with a single DC at 133.8, which is the intended penalty for skipping compute.

### Known edges and their levers

- **Pole E1 (8.5 min).** The pole has no first night. Lever: iceExtraction 130 → 150.
- **Human E6 (17–18 min on pole and lava tube).** Four crew techs of about 1,150–1,200 each. Lever: `ERA_COST_SCALE[6] = 0.9` on human runs, if the probe confirms.
- **E7 at 16.1–16.6 min.** This is the human-transition era. Lever: Crew Wellness (robotic) 1250 → 1000.
- **Probe calibration.** If the median robotic-mare FIRST LIGHT falls outside 100–130, change only `ERA_COST_SCALE[3..8]`, in steps of ±10%.

### Experience arc: the acceptance script for "no idle stretch over 5 min" (robotic mare, from `pace.py -v`)

| Minute | What I decide | What I wait for | What surprises me | My map |
|---|---|---|---|---|
| 0–5 | Solar ×3, an excavator on the guaranteed high-Ti patch (ghost: `On high-Ti basalt — smelter feed ↑`), 2 labs. Queue Smelting, then Rovers. Survey Tranquility Base with the micro-rover (one robot lent for 60 s). | Smelting (4.2) | '?' leads at 150–400 m | SITE view; thumbnail "orbital imagery only"; VICINITY shows 2 pins |
| 5–11 | Smelter (online 6.3). Survey Moltke (6.0). Ride out the first night, 8.0–12.0. | Rovers (10.9) → Era 2 | Night brownout → `INSIGHT — Battery Banks −40%` | **Zooms out to REGION**: 6 pins, hopper arcs |
| 11–21 | Parts first (14.3; fab online 16.4). Masts toward a '?' lead. See the smelt doctrine side by side. | Silicon (21.3) → Era 3 | Tranquillitatis pit survey (12.6) → `BREAKTHROUGH — Lava-Tube Caverns`; Taurus–Littrow (17.1) → Volcanic Glass | Leads resolve into volatiles soil |
| 21–33 | Batteries (26.2), bays. Doctrines: thorium vs fuel cells, swarm vs heavy. | 150◇ deed → Era 4 (32.6) | Maskelyne pays only 15 (novelty ×0.5) | Region fully pinned |
| 33–47 | Reactor online (37.1), wadis, wafer fab (42.2), chip doctrine | Orbital Prospector (47.0) → Era 5 | — | **Zooms out to the NEAR SIDE disc**; first slot; `Ilmenite Plains lacks water → Cabeus ice` |
| 47–63 | Claim the first outpost; LDC (57.1); Chip Fab #2 (60.4); DC#1 (62.2); overclock toggles | Clocking (62.7) → Era 6 | `OUTPOST ONLINE` | Hopper arc to the pole |
| 63–75 | Cabeus survey (67.2); DC#2 (72.2); Cohabitation | Cohab + outpost day → Era 7 (75.2) | `BREAKTHROUGH — Cold-Trap Chemistry` | — |
| 75–91 | Crew rotation (+4 min), crew toggles, Science Crews, Condition Tuning, Far-Side Relay (82.5), radio outpost, DC#3 | Foils (91.4) → Era 8 | `CREW ROTATION — 2 settlers aboard` | **Near/far toggle**; far side unshrouded |
| 91–103 | Launch doctrine (driver ×1.5), foil factory (95.1), mass driver (99.8) | Swarm Protocol (101.9) | FIRST LIGHT at 103.1 | Deep Sounding later → **whole Moon** |

**Idle metric.** In the model, the longest stretch with no tech completion, facility coming online, survey return or era change is 5.1 min on mare, 4.4 on pole and 5.3 on lava tube. Construction decisions fill these stretches in real play.

**Probe acceptance** (§9): in no 5-minute window is there neither a player action nor a pending decision.

---

## 8. Save migration (`game.ts` `loadFrom` → new `migrateTechSchema(state)`)

**Versioning.** `state.version` stays **1**, because `save.ts:26/32` accepts only 1. Migration runs when `(state.techSchema ?? 1) < 2` and then sets `techSchema = 2`. There are **no id renames**: `regolithProcessing` keeps its id, and no doctrine member is ever granted by migration.

| Old id | Rule |
|---|---|
| hydroponicFarming | Drop. Refund `researchSpent` plus 40 if it was done. The building is now `unlockedFromStart` on human runs and comes with Cohabitation on robotic runs. |
| autonomousOps | Drop. Construction Robotics, its prerequisite, is always done already and now carries `automation` on human runs. Refund spent plus 260 if done; on robotic runs it did nothing. |
| roboticSelfAssembly | Drop. Refund spent plus 300 if done. Its bots +1 now live in Self-Replication; migration does not grant it. |
| inferenceOptimization | Drop. Refund spent plus 640 if done. Its DC ×1.5 now lives in Accelerator Design, a doctrine member, so it is not granted. |
| autoFabrication | Drop. Refund spent plus 1100 if done. |
| hiEffLaunch | Drop. Refund spent plus 1200 if done. |
| all kept ids | Unchanged. Effects follow the new definitions: old acceleratorDesign now boosts DCs; crewWellness moves era by expedition; partsFabrication's requires change. |

**Rules, in order**
1. Map the removed ids with their refunds, then deduplicate `techsDone`.
2. **Grandfather** doctrine conflicts in `techsDone`, such as powerBeaming and vonNeumann both done post-victory. Exclusivity blocks only new research.
3. A tech now hidden at its site stays done and keeps its effect.
4. Run `sanitizeQueue`. It drops items with missing requirements and **era-locked** items (for example crewWellness queued on a robotic save now at E7) and alerts on each. `researchSpent` is kept.
5. `era = max(stored, computeEra)`. The era never goes down.
6. Defaults for missing fields:

| Field | Default |
|---|---|
| `stats` | zero; charters count from load |
| `insights` | `{}` |
| `discoveries` | `[]` |
| `researchStalled` | `[]` |
| `researchRateAvg` | 0 |
| `feed` | all 0 |
| `downlinks` | 0 |
| `crewRotation` | null |
| `survey` | `{struck: [], prospects: {}, active: null, outposts: [], atlas: false}` |
| `b.overclock` | false |
| `b.cropRegrowT` | 0 |

7. If `iceSurveyed` is true, mark every ice deposit revealed (`struck`). Recompute `b.deposit` for all buildings from the regenerated heightfield.

**Debug and test aliases.** `TECH_ALIASES` maps `{autonomousOps: 'constructionRobotics', roboticSelfAssembly: 'selfReplication', inferenceOptimization: 'acceleratorDesign', autoFabrication: 'selfReplication', hydroponicFarming: null, hiEffLaunch: null}`. It is used only in `debug.completeTech/research/cancelResearch`, with a `console.warn`; `null` is a warned no-op. Old probe scripts keep working.

---

## 9. Test plan (`tests/smoke.spec.ts`, Playwright, `?debug`)

**Debug API additions** (`src/debug.ts`)
- `surveyProspect(id)`, `claimOutpost(id)`, `abandonOutpost(id)`
- `getLunar()`, `getDeposits()`, `revealAll()`, `forceOutposts(n)`
- `setOverclock(id, on)`, `downlink()`
- `getResearch()`, `auditTechs()`, `techRelevanceMatrix()`
- `setEnabled`, `setPriority`, `setAutomated`, `demolish`

### Updates to existing tests

| Test | Update |
|---|---|
| Tree test (`smoke.spec.ts:112`) | Uses `regolithProcessing` + `teleoperation`, so era 2 is still valid. Selectors change: `.era-head` ×8 and `.tech-card[data-tech]`. |
| Ice survey test (`:293`) | Rewritten as test 15 |
| Cohabitation test (`:412`) | Asserts `hydroponics` is placeable after Cohab and that the crew rotation boards 2 settlers after 240 s (test 25) |
| Chip/DC test (`:390`) | Asserts a DC transfers ≥2.25/s when the bank is full |
| Endgame test (`:437`, human mare) | Fast-forward list: regolithProcessing, teleoperation, prospectingRovers, siliconRefining, partsFabrication, batteryStorage, constructionRobotics, regolithShielding, thoriumPower, swarmRobotics, waferFab, orbitalProspector, acceleratorDesign, lunarDataCenter, dynamicClocking, closedLoopLS, scienceCrews, foilManufacturing, massDriver, swarmProtocol. Then `grantResources({foils: 15, launch: 3})` and keep the existing launch, victory and save/reload assertions. |

### New tests

1. **Layout at 1280×720 with the sheet open** (robotic mare and robotic lava tube, 14 slots). Also at 1280×720 with the sheet collapsed, and at 1600×900.
   - 7 `.lane` elements and 8 era heads;
   - every `.tech-card` box lies inside the viewport and above `#tech-sheet`'s top, and no two boxes intersect;
   - `[data-tech=swarmProtocol]` is fully visible;
   - `scrollWidth ≤ clientWidth`;
   - the computed `--slot-h` is ≥ 28 px;
   - the robotic HABITAT lane at maximum occupancy (Cohab and Closed-Loop in E6, Wellness in E7) does not overlap.
2. **Site filters.**
   - Mare hides siteGrading, iceExtraction, peakLightMasts and skylightHeliostats, and the footer reads `4 techs belong to other landing sites`.
   - Pole hides regolithVolatiles, thermalWadis, skylightHeliostats and ilmeniteBeneficiation, and MRE has no bracket.
   - Robotic mare's researchable count after doctrine picks is 37.
3. **`techRelevance` invariant** (B's T22): for each site × expedition, every visible tech passes. For each site-filtered tech, the filter is needed: it fails relevance at the hidden sites, or its `sites` field names a site fact.
4. **Honest trade-offs.** In `auditTechs()`, every row has pros ≥ 1 and cons ≥ 1, each multiplicative con has `|m − 1| ≥ 0.05`, and no line contains `undefined` or `NaN`.
5. **Transitive cancel.** Queue `[regolithProcessing, siliconRefining, partsFabrication]` and cancel regolithProcessing:
   - the queue becomes `[]` with 2 `RESEARCH DROPPED` alerts;
   - after `grantData(500)` and 600 s, neither dependent is done.
6. **Full queue.** A 6th item alerts `QUEUE FULL (5/5)` and the card has class `full`.
7. **Goods-stall skip.** With prerequisites complete, queue `[lunarDataCenter, dustMitigation]` with 0 chips, `grantData(2000)` and advance 600 s:
   - dust is done;
   - LDC is in `researchStalled`;
   - an alert matches `/needs 10▣.*Chip Fab/`;
   - after `grantResources({chips: 10})` and 2 s, LDC is done.
8. **Doctrine.** Queue swarmRobotics:
   - Heavy Constructors is `foreclosed`, and `research('heavyConstructors')` alerts `FORECLOSED`;
   - cancel → available again;
   - complete → permanently foreclosed;
   - clicking a doctrine card does not queue it; only `[Commit]` does.
9. **requiresAny.** On mare, regolithShielding's lock reason is exactly `needs Construction Robotics` (the hidden Site Grading is not listed).
10. **Charter by deed.** With only regolithProcessing done and a smelter plus excavator placed, advance until `stats.produced.metals ≥ 100`. Then `era === 2` and an alert includes `via 1 tech + 100◆ smelted`.
11. **Resolved-era charters and the robotic human gate.**
    - On robotic mare, complete humanCohabitation and crewWellness (resolved E7): the era stays 6.
    - Complete every non-crew E6 tech and `forceOutposts(1)` with 720 s of operation, but not Cohab: the era stays 6.
    - Complete Cohab: `era === 7`.
12. **Era-locked sanitize.** Load a robotic save with `crewWellness` queued at era 6: it is dropped with an alert and its spent is kept.
13. **Insight.** On mare with 2 labs and no batteries, run through the first night: `insights.batteryStorage === 0.4` and the card shows 66.
14. **Uplink share.**
    - With 6 active agent labs and no teleoperation, measured data/s is within 3% of 5.2 × 0.225.
    - The lab placement ghost text contains `uplink share 87%`.
    - Browning out one lab updates the other 5 to 92%.
15. **Deposits and feed.**
    - At the start on mare there is a revealed ilmenite deposit ≤ 55 m out, and at least one '?' lead beyond 120 m.
    - An excavator on it plus a smelter: after 60 s the inspector feed reads 100% high-Ti, and smelter metals/s is 1.30 ± 0.03 × the same layout with the excavator moved off the deposit.
    - On the pole, a harvester on unrevealed ice is rejected with `ICE UNCONFIRMED`.
    - On the lava tube, a habitat on KREEP is rejected with `RADIATION`.
    - Placing on an unrevealed deposit alerts `PROSPECT STRUCK`.
16. **Relay Mast.** Placement at 95 m fails with `Too far`. After a mast at 55 m completes, placement at 95 m succeeds, and deposits within 45 m of the mast are revealed.
17. **Lunar Map tiers.**
    - `M` opens `#map-screen` with `data-view="site"` and the thumbnail label.
    - VICINITY has 2 prospects.
    - After prospectingRovers, `data-view` animates to `region` (or is set instantly under reduced motion) with 8 visible on mare.
    - After orbitalProspector, 23 visible. After farSideRelay, 30. After deepSounding, 34.
18. **Survey.** `surveyProspect('tranqPit')` on mare:
    - deducts 60 stored, 33○, 7≈ and 5⚙, and `bots.total` drops by 1 while it runs;
    - after 98 s, data +30, `discoveries` includes btLavaTubeCaverns, the placeholder becomes a card, and a `BREAKTHROUGH` alert fires;
    - a second survey while active alerts `SURVEY IN PROGRESS`;
    - a second ilmenite-kind survey pays 50%.
19. **Outposts.**
    - Before T2, claiming alerts `NO OUTPOST SLOT — Orbital Prospector (Era 4)`.
    - After T2, claim Cabeus: 100◆ 30⚙ 10▣ are deducted; after 360 s, water rises by about 0.20/s and hopper fuel is drawn.
    - Drain O₂: `HOPPER GROUNDED` and the stream stops; restore O₂ and it resumes.
    - Claiming Tranquility Base alerts `PROTECTED HERITAGE SITE`.
20. **Overclock.** With dynamicClocking, `setOverclock(chipFab)` gives draw ×1.5 and chips/s ×1.5. After about 620 s, wear is ≥ 0.3, `overclock` is false, and an alert reads `OVERCLOCK TRIPPED`.
21. **Launch capacity.**
    - With Swarm Protocol and launch = 2, `launch()` is rejected with an alert naming `3↑`. At 3 it fires and launch returns to 0.
    - On the pole, the propellant plant makes 0.01↑/s against the mass driver's 0.006.
22. **Downlink.**
    - Spends 150 banked data and a shipment is pending; the next downlink costs 200.
    - While a shipment is pending, downlink alerts `SHIPMENT ALREADY EN ROUTE`.
    - Without teleoperation it alerts `NEEDS Earth Teleoperation`.
23. **Crop loss.** A dark farm at night: after 35 s `cropRegrowT > 0`, `CROP LOST` fires, and food output stays 0 until it regrows.
24. **Reactor fix.** A reactor built on a human run is `active`, and the morale target includes −5.
25. **Crew rotation.** Robotic Cohab done: 240 s later crew === 2. With food at 0, the rotation is held with an alert naming food.
26. **Save migration.** Inject a legacy blob: `version: 1`, no `techSchema`, `techsDone: [regolithProcessing, hydroponicFarming, inferenceOptimization, autonomousOps]`, `researchQueue: [autoFabrication, hiEffLaunch]`, `iceSurveyed: true` on the pole. Click `#btn-continue`:
    - `techsDone === [regolithProcessing]`;
    - `data` has risen by ≥ 940;
    - the queue is `[]`;
    - `techSchema === 2`;
    - ice deposits are revealed;
    - there are no console errors.
27. **No silent failures.** Loop over every rejection case and assert a new alert and no state change: hidden, foreclosed, era, requires, any-of, crew-locked, full, doctrine path, survey (range, energy, O₂, water, busy), claim (slot, heritage, anomaly, goods), overclock without the tech, downlink without data, and the robotic Crewed toggle with no crew.
28. **Robotic Crewed toggle.** After the crew rotation, `setAutomated(lab, false)` works without any automation tech, and the lab's data rate reflects crewed output.

### Pacing probe (`scripts/probe-pacing.mjs`; not CI; the scratchpad harness pattern)

An honest scripted player on 3 sites × 2 expeditions, seed 42, using public actions only. Acceptance:
- robotic mare FIRST LIGHT in 100–130 game-min;
- pole and lava ≤ 1.3× mare;
- every era 9–17 min;
- no 5-minute window without a player action or a pending decision;
- summed goods-stall time ≤ 15 min;
- chip-gated research stall ≤ 5 min in total (the bot builds a second Chip Fab when the forecast hint appears);
- outposts ≤ 25% of any resource's production at FIRST LIGHT;
- launch-capacity-bound volleys on pole driver runs only.

Then recalibrate `MAX_SLOPE_LARGE` against the S8.4 pad counts, and tune only `ERA_COST_SCALE`.

---

## 10. Implementation plan

Three workstreams. R1 lands the contracts first, then R2 and M proceed in parallel against them.

**Contracts, frozen at the end of R1a**
- `TechDef` and `TechEffect` (§3–4)
- `$research` (§6)
- `Mods.surveyTier`, `outpostSlots`, `powerDelta`, `feedBonus` (§4)
- `GameState.stats`, `survey`, `feed`, `discoveries` (§2)
- `$lunar` and `$deposits` (§5b)

### R1: sim and data

| Step | Files | Work |
|---|---|---|
| R1a (first) | `src/data/techs.ts`, `src/data/insights.ts` (new), `src/data/balance.ts`, `src/core/research.ts` (new), `src/core/mods.ts`, `src/core/state.ts`, `src/core/actions.ts` | The 47 techs, `ERA_GATES`, `DOCTRINES`, `describeEffect`, `techRelevance`, all research.ts functions, `computeMods` with the new kinds and `sites`/`expeditions`, `effectiveDef`, `effectiveRates`, new state fields and actions. Delete `techExpeditionLock` and `computeEra` from `mods.ts`. |
| R1b | `src/core/economy.ts`, `src/core/game.ts`, `src/core/save.ts` (comment only), `src/debug.ts` | Every S13 step change except the M items; `researchTick` wiring; `setAutomated` fix; `doLaunch` 3↑; overclock, downlink and crew rotation; reactor fix; crop loss; `migrateTechSchema`; `TECH_ALIASES`; `publish()` for `$research`; the debug API. |
| R1c | `src/data/buildings.ts`, `src/buildings/placement.ts`, `src/buildings/recipes.ts` | relayMast, propellantPlant, `buildRadiusM`, `ignoresLaunchMult`, `hydroponics.unlockedFromStart`; the large-pad slope rule; network radius; the 2 meshes. Coordinate with core-fixes. |
| R1d | `tests/smoke.spec.ts` | Existing-test updates and tests 3–14 and 20–28 |

### R2: tree UI (starts once R1a has published `$research`)

| Step | Files | Work |
|---|---|---|
| R2a | `src/ui/techTree.ts` (new), `src/ui/screens.ts` | Mount `techTree`; delete `mountTechTree` (117–325). Swimlane grid, cards, per-run slot calculation, era-8 column, era headers with gates. |
| R2b | `src/ui/techTree.ts`, `src/ui/ui.css` | The SVG link layer (orthogonal, OR diamond, goods dotted), hover closure highlight, detail sheet and queue strip, doctrine commit sheet, keys. Opaque background at `ui.css:193`; tree CSS replacing 220–254. |
| R2c | `src/ui/stores.ts`, `src/ui/hud.ts`, `src/ui/palette.ts`, `src/ui/infoPanel.ts` | `$research`; HUD research chip states; launch-cap chip; lab ghost and inspector uplink text; agent tax from mods; remove "Survey for ice"; overclock toggle; downlink and Open-Map buttons; research section of the info panel |
| R2d | tests | Tests 1, 2, 5–9 (UI parts) |

### M: map and deposits (M1 after R1a; M2 after M1 and R1b)

| Step | Files | Work |
|---|---|---|
| M1 | `src/data/deposits.ts` (new), `src/data/sites.ts` (home lat/lon), `src/terrain/heightfield.ts`, `src/core/game.ts` (`buildDepositOverlay`, `KeyI`, `commitPlace` deposit stamp and strike), `src/buildings/placement.ts` (revealed-ice and KREEP gating), `src/core/economy.ts` (feed grade in step 4) | `DEPOSIT_PLAN`, `deposits` and `depositAt`, leads, reveal radii, overlay patterns and glyphs, `$deposits`, ghost and inspector feed lines |
| M2 | `src/data/lunarMap.ts` (new: `PROSPECTS`, `MARIA`, `SURVEY_CLASS`, `OUTPOST_CLASS`, `OUTPOST_KINDS`), `src/core/exploration.ts` (new), `src/core/economy.ts` (step 8.7; step-0 borrowed robot), `src/core/game.ts` (the survey, claim and abandon actions), `src/core/mods.ts` (outposts → `powerDelta` and KREEP) | Surveys, novelty, breakthrough discovery, outposts, hopper fuel, atlas |
| M3 | `src/ui/lunarMap.ts` (new), `src/ui/stores.ts` (`$lunar`), `src/ui/hud.ts` (map chip), `src/ui/mount.ts` | The screen, views and zoom animation, thumbnail, basemap, markers, prospect sheet, next-surveyable list, tier ladder, outpost strip, reduced-motion handling |
| M4 | tests | Tests 15–19 |

### Order of work

1. **R1a** (contracts).
2. Then, in parallel: **R1b + R1c**, **R2a–b**, and **M1**.
3. Then **M2**, which needs survey tiers and economy hooks.
4. Then **R2c** and **M3**.
5. Then all tests.
6. Then the pacing probe, and tune `ERA_COST_SCALE` only.
7. Finally, update `docs/03-tech-tree.md` (regenerate the tables from `TECHS`), `docs/05-sites.md` (home coordinates, deposits, site techs, weakness outposts), and the `docs/07-ui-design.md` §6 swimlane and map description.
