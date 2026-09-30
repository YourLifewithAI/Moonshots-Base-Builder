# 08 · Technical Architecture

> One plain-JSON state object, one action queue in, one set of store atoms
> out, and a renderer that only ever *reads*.

Stack: **Vite + TypeScript + Three.js** (`three` 0.180), with
`simplex-noise` (terrain),
`nanostores` (UI bridge), `idb-keyval` (saves). No physics engine, no React,
no web workers, zero binary assets. `npm run build` runs `tsc --noEmit` then
`vite build`.

---

## 1. Module map (the actual `src/` tree)

```
src/
  main.ts                 boot: URL params (?site ?seed ?debug ?safe ?touch; ?cel is read by world/celStyle.ts),
                          create Game, mount UI; a touch switch saves, reloads and continues the saved game
  debug.ts                window.__game test API (attached with ?debug)
  core/
    game.ts               orchestrator: owns GameState + Three scene, rAF loop, input,
                          action handling, placement commit, launch, publish(), save/load
    state.ts              GameState: the one serializable world object + createInitialState
    actions.ts            typed Action union + ActionQueue (UI → sim)
    economy.ts            the 1 Hz economy tick — the entire simulation
    mods.ts               tech-effect modifiers (computeMods) + era computation
    fleet.ts              the rover roster and assignments (who is soonest there by road); unitKind (a Drone Hive's units are drones)
    transit.ts            rovers in transit (docs/15 §6a): each unit's place and trip, planned on a new goal,
                          advanced by the clock; who has arrived where (economy step 0); ETAs
    zones.ts              extraction zones (docs/15 §5a): the revealed deposits' cells and rims; pit zones (explicit cells)
    pits.ts               strip-mine pits (docs/17 §8, §11): s.pits, the growth (digInto, called by hubs.ts dug),
                          economy step 4.2 (stake, carve, dump), pit zones, the placement and grading refusals;
                          Phase 4: the states (exhausted, boxed, bedrock, reclaimed; `news` for hubs.ts pitNews),
                          faceCapacity, targetGrade, reservesOf, stripMorale, Reclaim, deposit surveys (step 4.3)
    ore.ts                grade, the ore halo, the cutoff, reserves and the survey's reading (docs/17 §9–§13; pure,
                          derived from (seed, deposit id)); tables in data/ore.ts
    hubs.ts               extraction hubs (docs/17 Phases 1–2): hub state, units (s.haulers), the print queue, bays,
                          the auto choice, trips into pits by their ramps, plain pits, the pile and hoppers,
                          economy step 4.1 (unitsStep), Assign / Open pit / Send / Recall, old-save migration
    hubView.ts            the hub and unit inspectors' payload ($fleet.hubs, $fleet.units)
    hubPreview.ts         the preview and the highlight (docs/17 Phase 5): hubLight (a hub's lit deposits, plain
                          pits and stake, with trips, faces and pits), the ghost's HUB block and its headline,
                          the IN THE PIT'S WAY ring warning (checkPlacement); reservesOf (Phase 4's numbers)
    research.ts           availability, cost, the queue, charters (the destiny pick gates eras 3–8),
                          destinyOf (the meter, the band, the reach), techSchema migration
    automation.ts         the Builder (docs/13): rule signals + state machine, budget, orders, vetoes,
                          maintenance, the [B] view; economy step 12 returns AutoRequests
    siting.ts             the deterministic site chooser shared by orders and rules (+ Feed Planner aim)
    hazards.ts            destiny hazards (docs/14 §3): tiers, the scheduler, occupancy, the network graph,
                          each kind's flow, counters, deaths and losses; economy hooks; hazardView for the UI
    spaceWeather.ts       space weather (docs/16), economy step 8: the solar cycle, flare classes and drills,
                          the phases, the arrays' plan (the portion rule, the critical feed), previews,
                          wrecks and repairs, the legacy flare, migration; weatherView for the UI
    flareEffects.ts       what a flare costs beyond the arrays (docs/16 §4, F2b): σ, rad scars and capability,
                          machines' reboots, latch-ups and burn-outs (rovers, drones, hub units, legacy pads),
                          crew indoors, labs and Checkpoint, fabs and compute, Shut down exposed, the blackout,
                          wear, Replace and Re-print, Recall machines; per-tick hooks and effectsView for the UI
    forecast.ts           flare forecasting (docs/16 §6, F3), first in economy step 8: the tier (the observatory,
                          the sentinel), the telegraph's lead, the honest window and class range, the schedule
                          run forward (T3), the sentinel's launch, Arrays: choose now…; forecastView for the UI
    flowBook.ts           per-resource made / want / spend averages (supply against demand)
    roads.ts              the road network (docs/15): cells, doors, spurs (A*), routes, haul roads, old-save roads;
                          zone gates and ground ways (road, then off-road inside a zone)
    traffic.ts            the sim's reservations (docs/15 §6, docs/19 S4a): road cells, pit ramps, runs to the next
                          bay, two-phase tick, priority, waiting and stepping aside; claims kept on the unit
    grading.ts            box-drag grading as a rover job (docs/19 S5): gradePlan and its refusals, GradeJob per
                          cell, economy step 2.65, cancel and refund, gradeView
    surveyDrones.ts       the survey-drone fleet (docs/11 §5c, docs/19 S6): the Lander's drone, Prospecting Bay
                          prints, recharge, flights in parallel, migrateSurveySchema, the fleet panel's view
    roadActions.ts        the road tool's actions (lay, remove, waypoints via `via`) and their alerts
    spots.ts              where each rover stands: its bay, a site's door, a road's frontier (that road's crew
                          first), off-road at a site inside a zone; the sim and the visuals read the same slots
    daynight.ts           compressed lunar clock → DayInfo {sunFactor, elevation, night}
    save.ts               SaveBlob ⇄ idb-keyval ('mbb-save-v1') with localStorage fallback
    rng.ts                mulberry32 seeded PRNG + string hash
    settings.ts           menu settings in localStorage (safe mode, audio, touch, guidance pauses); RESUME_KEY
  data/                   pure data, no logic (single source of truth for content)
    balance.ts            every tuning constant (grid, day length, morale, flare, launch…)
    resources.ts          9 stockpiled resources, tiers, HUD glyphs
    buildings.ts          14 buildings + Lander: costs, rates, crew, priority, pro/con
    techs.ts              18 techs × 6 eras, effects, goods costs, trade-offs
    sites.ts              3 landing sites, every mechanical modifier
    milestones.ts         10 ordered goals (the tutorial) + swarm bands
    automation.ts         the Builder's rule table (RULES), families, AUTO constants, rule texts
    hubs.ts               hub and unit tables (HUB_DEFS, UNIT_DEFS, HUB): what each hub prints and wants, reach, bays
    hazards.ts            the 13 hazards (HAZARDS), their counters (COUNTERS), every magnitude (HZ), guard,
                          exposure and risk texts; HAZARDS_LIVE true
    spaceWeather.ts       the flare classes, the cycle, the array rows, repairs, wrecks, the draw seeds
                          (SPACE_WEATHER); the legacy flare (LEGACY_FLARE); the rest of §4 (FLARE_EFFECTS: scars,
                          machines, crew, labs, fabs, compute, the blackout, wear, Replace and Re-print)
    forecast.ts           the forecast tiers, leads, window widths, the observatory's data, the sentinel (FORECAST)
    roads.ts              road tuning (sintering, slope limit, lanes, turn cost, bays), field and dock types, the Lander's apron
    families.ts           the seven building families, their accents and glyphs, unit accents and hub liveries
                          (FAMILY_OF, FAMILY_ACCENT, FAMILY_GLYPH, UNIT_ACCENT, HUB_LIVERY: docs/06 §2)
  terrain/
    heightfield.ts        257² analytic heightfield: fBm + crater math, sample/flatten/raycast; the pits' delta grid
                          (base, delta, skirt mask, setDelta, noRoad)
    pitCarve.ts           the height-delta grid's writers (docs/17 §11): masks, distance transform, carvePit and
                          dumpHeap (volume-solved, monotone), stakes, pit cells, the sparse codec
    pitLook.ts            the pit's look baked into the chunks (docs/06 §9): bench bands and contours, the ramp's
                          tread and arrow, the heap's outline and hatch (`decorate`, `cutTone`)
    chunks.ts             8×8 render chunks, faceted, coloured by celGround, ≤4-chunk rebuilds; the pits'
                          rebuild queue (one a frame, two a second); the `decorate` hook (pitCarve.ts)
    celGround.ts          cel ground colour (site tint, relief, craters, deposits ×1.4) + facet()
    horizon.ts            far horizon ring continuing the terrain to ~12 km, compressed curvature
    rocks.ts              instanced boulder scatter (power-law sizes, crater blocks)
  buildings/
    meshKit.ts            parametric kit + detail helpers; bakes value + per-vertex finish (`mat`)
    recipes.ts            the 29 building silhouettes, each with one tall identifier and its family accent, the hub
                          units' meshes (`unitRecipeGeometry`) + moving-part mounts (cached)
    upgrades.ts           research you can see: each tech's parts per type, the upgrade key
    destinyParts.ts       the destiny's parts (docs/14 §4.1): 16 picks, 3 capstones, the 4 new types' lists
    look.ts               the destiny's lean (−1 ◉ … +1 ⌂) and each structure's light warmth (iWarm)
    links.ts              walkways (⌂) and conveyor spines (◉): planned on the grid round the roads,
                          skybridges over them; one merged mesh per layer, rebuilt on change
    instances.ts          one InstancedMesh per type + iState, iWarm (per type and lean), iAlarm (the
                          hazards' hook, `alarmOf`), iGlow; flood pools, contact decals, scaffold, picking
    celBuilding.ts        cel palette (per finish incl. `leaf`, per type), the one building shader (print
                          reveal, warm ↔ cold light by iWarm, the alarm flicker), lightLevel(), and the shared
                          CUT_NONE / buildingUniforms / litChannel / channelDark / EMISSIVE
    celFloods.ts          cel night floods: draped additive pools at each structure's light level
    contactDecals.ts      contact decals under every footprint (no shadow map)
    darkness.ts           per-structure darkness k (night, low or set sun, terrain shadow) for the base's own lights
    trackers.ts           sun-tracking solar wings, Earth-aimed dishes (instanced apart)
    scaffold.ts           construction scaffold line geometry
    ghost.ts              placement ghost (the registry's translucent Lambert) + depth pre-pass
    overlays.ts           draped placement grid, network radius rings, selection bracket
    placement.ts          ghost preview + checkPlacement validity chain (its road too) + site build costs
    cellPreview.ts        road cells a placement or the road tool would lay (or remove), on the ground
    berms.ts              Regolith Shielding berms draped round shielded footprints
  world/
    renderer.ts           WebGLRenderer (MSAA canvas, no shadow map, no tone mapping, DPR ≤ 1.5) + camera;
                          drawFrame() and the black-frame probeGround()
    celStyle.ts           the look's constants: the ramp and ink presets A/B/C, CEL_VARIANT, `?cel=` (docs/06 §3)
    celLighting.ts        one key light + hemisphere fill: day by the sun, night by earthshine; sunStep()
    celSurface.ts         the ground program: vertex colours, faceted normals, a two-step ramp, posterised tone
                          (terrain, ring, berms, rocks, roads, the ghost)
    cel.ts                the cel style's registry materials (the ground program, the ghost, stock points); installCel()
    ink.ts                the ink: an inverted-hull outline twin per instanced class (`inked`), and drapedLine
                          (bench, rim, grade, road lines on the ground)
    materials.ts          material registry: define/get/custom/replace, safe-mode unlit twins
    life.ts               the motion layer, one call per frame; each part fails soft
    rovers.ts             construction-robot fleet: bays, slots, lane ways along the roads, following the sim's
                          trips (core/transit.ts); and DroneFlight, the Drone Hive's units flying straight at
                          6–10 m, off the roads and out of traffic, following theirs
    settlers.ts           EVA walkers (⌂): one per EVA crew, on free cells only (never a road), home at night
    haulers.ts            the hub units (one InstancedMesh per unit key): replaying the sim's path a tick late
    depositHighlight.ts   a hub's lit deposits on the ground (docs/17 §6.1): draped ribbons in the kind's pattern,
                          fills, full-size rings, pit rims, hatched ore, cross-hatch
    traffic.ts            the picture's lanes: rovers' holds, queues, the deadlock breaker; hub units are free agents
    surveyFlight.ts       the survey drones perched and in flight (one InstancedMesh and its ink twin)
    gradeMarks.ts         a grading site's dashed outline, stakes and plates
    roads.ts              the road mesh: merged draped strips, markings by tier, beacon posts, pending cells
    dust.ts               regolith grains: pooled emitter slots, static puffs placed on the CPU
    events.ts             mass-driver launch and Earth-resupply landing visuals (read from state)
  player/
    isoCam.ts             the fixed isometric camera: 20° lens, 90° yaw steps (Q/E), two tilts 32°/55° (V), continuous zoom 100–830 m;
                          its preset (step, tilt, dist) is saved as SaveBlob.camera; owns commandKey and CommandCam
    roadTool.ts           the road tool [N]: drag out a road from the network, click waypoints and Enter, Alt-drag removes
    gradeTool.ts          the Grade tool: press-drag a box (or click a 16 m square), preview, release queues a job
  audio/
    sfx.ts                procedural cues, suit radio, hum; buses, limiter, meter; the destiny's
                          layers (docs/14 §4.6): rotor hum, walkers' squelch, greenhouse air, modem chirp
    music.ts              the generative score: day and night pools, tilted by the lean (setDestiny);
                          the hazards' hooks hold() and mourn()
    roverVoices.ts        the rovers' motors and servo chirps
  ui/
    tokens.css / ui.css   design tokens + HUD layout (see 07)
    stores.ts             nanostores atoms — the one-way sim → UI bridge
    mount.ts              assembles the DOM overlay
    hud.ts / palette.ts / screens.ts   HUD regions, build palette + tooltip + inspector,
                          site select + tech tree + victory screens
    notify.ts / notifyUi.ts / notify.css   the five notification families (docs/07 §4a): the pure half (family
                          table, log views, actions) and the DOM half (field card, log panel, action runner)
    builderPanel.ts       the [B] Builder panel and the resource panels' BUILDER section
    hubPanel.ts           the hub inspector (UNITS, QUEUE, ROBOTS, PITS IN REACH) and the unit inspector
    hazardsPanel.ts       the [G] Hazards panel, the HUD hazard chip, counter buttons (alerts, inspector)
    weatherPanel.ts       the ☉ chip, the flare pop-up (desktop and touch), the [O] panel, the arrays'
                          and every scarring structure's inspector lines (weather.css)
    forecastPanel.ts      the panel's NEXT block and TIMELINE (docs/16 §6.5, §10.5), placed after NOW and before LOG
    techTree.ts / techPage.ts / techGoals.ts / techDestiny.ts
                          the research tree: pages, lane board, goals, the destiny column and meter
tests/smoke.spec.ts       6-test full-loop Playwright suite
playwright.config.ts      test runner config (preinstalled Chromium aware)
```

## 2. The loop (`core/game.ts`)

One `requestAnimationFrame` loop; no separate sim thread. Per frame, with
`dt = min(frameDt, 0.1 s)` for the camera and effects, and
`simDt = min(frameDt, 0.5 s)` for game time (so a 2 fps GPU still runs the
clock at full speed):

1. **Drain the action queue** — every frame, before anything else, so UI
   commands feel immediate even when paused.
2. **Camera update** — the fixed isometric command camera (`IsoCam`), plus
   the placement ghost raycast.
3. **Game-time accumulation** — if not paused, `simTime += simDt × speed`
   (speeds 1/3/10).
4. **Fixed 1 Hz economy ticks** — an accumulator fires `econStep()` for each
   whole game-second, with a **120-tick catch-up guard** per frame (a
   background tab at 10× can owe minutes of sim; the guard bounds frame cost
   and simply carries the remainder). `econStep` runs `economyTick(state,
   site, mods, 1)`, refreshes the mods, then resolves what the Builder asked
   for (place through the chooser and `commitPlace`, demolish a replaced
   machine, re-aim a dig site). `debugAdvance` calls the same function, so
   tests and play take one path.
5. **Publish to stores** — once per frame *if* any economy tick ran or any
   action was applied (§4). Victory flips `$victory` after publish so the
   overlay reads fresh stats.
6. **Sun** — `lighting.setSun(elev, azim, nightFactor)` from the day clock
   (the key light, the fill and the clear colour; docs/06 §3.2).
7. **Autosave** — every 60 real seconds, plus on `visibilitychange` →
   hidden.

## 3. The economy tick (`core/economy.ts`)

Deterministic, ordered, one pass per game-second. The full resolution order
(steps 2–12 are the numbered sections in `economyTick`; 1 and 13 bracket it
in `game.ts`):

| # | Step | What happens |
|---|---|---|
| 1 | Action drain | UI commands applied to state (place/demolish/research/speed/…) |
| 1b | Rovers (`syncRoster`, `assignRovers`, `transitArrive`; economy step 0) | The roster follows the docks; auto rovers take sites in queue order, each the free one soonest there by road from where it is. Then every trip advances a second, and each site counts the units that have arrived: its welders at their stands, or the ones behind its road's frontier while the road is unfinished (docs/15 §6a). Only they draw power and build (step 2.5), and only a unit behind a road job's frontier sinters it (2.6) |
| 2 | Power supply | Sum generators: solar × `sunFactor` × (1 − dust) × `solarMult` (a flare's stow, capability and stowed damage; a wreck 0), wear > 0.3 halves output; + power-beaming return (4 kW × launches, × the flare's class) once researched; battery capacity summed. It keeps the priority 0–1 demand and the solar share in `s.power.crit` / `.solar` for the critical feed |
| 3 | Demand + priority idling | Consumers sorted by `(priority, id)` ascending draw from `supply·dt + stored`. Priority 0 (habitats, power) feeds first; 3 (labs) browns out first — Timberborn-style shortage triage. Net surplus charges storage at 85% round-trip efficiency; deficit drains it. Brownout raises an alert |
| 4 | Worker allocation | Crew assigned in the same `(priority, id)` order; unstaffed buildings idle with reason `crew`. Then agents cover: once stations may run on agents, a short-handed one goes agent-run (`agentCover`) from the next tick, and every 30 s free workers take covered ones back (not a station set to Crewed by hand, `crewPinned`; off with `s.agentCover = false`) |
| 5 | Production, tier order | `PROD_ORDER`: extraction → smelter/refinery/partsFab → life → foilFactory/massDriver → lab. **Same-tick chaining**: this tick's regolith can smelt this tick. Inputs checked/consumed, outputs scaled by tech mults × site ISRU × morale work-mult (0.5 + morale/100 × 0.7) × wear penalty; launch output × site launch mult; labs emit data at 0.3/s × workMult^1.5 |
| 5a | Hub units (`unitsStep`, economy step 4.1, first in `PROD_ORDER`'s processing tier) | ▲ changed elsewhere goes to or from the pile. Each unit, in id order, runs its cycle: bay → road → gate → down its pit's ramp → face → dig → back → tip into its own hub's hopper. Then the print queue at each hub. Hubs draw the pile first (smelters and refineries), then their hopper. `resources.regolith` is written back as pile + Σ hoppers |
| 5b | Pits (`pitsStep`, economy step 4.2) | Each unit's dig adds its tonnes, at the grade it cut, to its target's pit (`digInto`, from `dug` in core/hubs.ts). Then, in id order on the pits' own clock: a new pit stakes free ground; an open one carves once its rim would move 0.5 m or 150 m³ is owed (at most every 5 s); its heap takes 0.81× the cut. A deposit pit whose cut reaches the cutoff is exhausted; one that cannot widen is boxed in; bedrock benches reopen either; Reclaim fills. Pit zones follow; a grown one bumps `roadRev`. The hubs read the news next tick (units re-route, alerts). A hub's output is recipe × the q its units tipped (docs/17 §9) |
| 5c | Deposit surveys (`oreSurveyStep`, 4.3) | A rover on a survey job (`RoverUnit.core`, assigned before road jobs in `assignRovers`) cores once its `core` trip has arrived; research re-reads surveyed deposits; masts survey ice and soil with Neutron Spectrometry |
| 6 | Life support & crew | O₂ 0.02 and food 0.008 per crew-second (× closed-loop mult). Shortage runs a 60 s grace timer, then loses 1 crew per 30 s with a −15 morale hit. Growth: morale > 60 + a free powered bed + fed + life support that carries crew+1 for a lunar day at the current flow → +1 crew per lunar day |
| 7 | Parts upkeep, wear, dust | Each building pays `upkeepParts/day` (× tech × site mults). Paid → wear recovers, solar dust nets toward clean. Unpaid → wear climbs (0.5/day) toward the −50% output threshold, dust climbs to a 50% cap. The tick's net flow per resource so far (deliveries and research goods excluded) feeds a 20 s average, `state.rates`, which the info panels show |
| 8 | Morale | Target = site base + active-building deltas + fed/starving + crowding + brownout + flare penalties, clamped 0–100; state lerps toward it at 0.05/tick |
| 9 | Space weather (`weatherTick`, economy step 8) | docs/16. idle → telegraph (60 · 60 · 120 s by class, +60 s on a drill; the pop-up; the plan locks 10 s before the protons and the wings turn) → active (30 · 45 · 60 s: morale and data by class; the arrays' outcome at its end) → an X's 120 s tail → idle (repairs queue, the log line, the next in (2.3 − a)(1 ± 0.3) lunar days). The class is drawn at the telegraph from the seeded cycle and the era; an X is locked by the spot-group watch half a day ahead. Repairs, Rebuild and Clear become construction sites on the array (step 2.5 works them, `siteDone`). `s.weather.legacy`: the old machine, for the probe. Forecasting runs first (`forecastTick`, `core/forecast.ts`): its tier's lead starts the telegraph 30 or 60 s early, and the flash (`f.flashAt`) keeps the schedule's time; the window forecasts that flash. The rest of §4 (`core/flareEffects.ts`, F2b): at the protons the blackout, crew indoors, the head tech, wear and an X's batch; a second later (after the bit flips) each machine's draw, again in an X's tail; each second of the protons counts every structure and machine exposed or prepared, and at the end of the flash and of the tail they scar; `effectsTick` last: reboots, re-flashes, warm-ups, re-prints, buffered streams |
| 9b | Hazards (`hazardTick`, economy step 8.3) | After the flare, before resupply. The scheduler opens a window per side in turn (credit by picks), picks the kind and the weakest target deterministically, and starts its warning. Each live hazard runs telegraph → active → resolved; its alert carries the counters, and a death or loss clock is a condition. Then the meters (airlock dust, cabin fever, dose), the fleet (bricked rovers re-flash at their own dock, deadlines, dock reprints) and runaway junk. Returns wrecked buildings, junk sites for `econStep`, and whether mods changed. Its hooks in the other steps are in 02 |
| 10 | Research | Data drains into the queue head; on completion, era-3+ techs also gate on **manufactured goods** (Factorio rule: you cannot out-research your industry) — unaffordable techs stall with an alert. Completion recomputes era + mods |
| 11 | Night tracking | Day→night edge detection; surviving a night increments the counter and fires the DAWN alert |
| 11b | Autonomous Cadence | With the ◉ Era 8 pick: a ready volley fires itself, one a tick, only if the bank keeps the night's reserve (`launchVolley`, shared with the button). The first volley of a pure-Automation band runs CREW HOME |
| 12 | Milestones | Checked **in order**, only the next incomplete one — progressive disclosure by construction. `first-light` (first launch) raises the victory event |
| 12b | Flow book | Folded in at the end of production, life support and upkeep: per resource, `made` (outputs and hauled deliveries), `want` (what running buildings, the crew, upkeep and welding asked for, covered or not) and `spend` (build costs, research goods, surveys, claims) — the rates' averages, spend over 300 s. `made − want − spend` is the Builder's supply against demand |
| 12c | Builder (`automationTick`) | Families newly unlocked switch their rules on; completed auto sites settle their rule; each rule reads its signal and walks its state machine in family order (≤ 2 placements a tick, one pending site a family); held orders; Maintenance; Feed Planner. Returns `AutoRequest[]` for `econStep` — the tick itself never places |
| 12d | Trips (`transitPlan`, after the tick) | Every unit whose goal changed — a new assignment, a frontier moved on, a slot changed, home — plans one trip from where it stands (a road route, off-road inside a zone; a drone straight). It sets off at this second, so the visuals see it from its first metre |
| 13 | Publish | `game.publish()` copies state slices into the nanostores atoms |

The tick is `O(buildings)` with a handful of passes — trivial at the 96/type
slice scale (§12).

## 4. One-way data flow

```
DOM events ──► ActionQueue (typed Action union) ──► sim (applyAction / economyTick)
                                                        │ mutates
                                                    GameState  ◄── renderer reads
                                                        │ publish() at economy boundary
                                                nanostores atoms ($resources, $power, $time,
                                                 $tech, $swarm, $alerts, $milestones,
                                                 $selection, $placing, $victory…)
                                                        │ subscribe
                                                       DOM
```

The UI **never mutates GameState** — every intent is a typed `Action`
(`place`, `demolish`, `setEnabled`, `setAutomated`, `setPriority`,
`buildNext`, `crewAll`, `research`, `cancelResearch`, `setSpeed`, `setPaused`,
`launch`, `orderResupply`, `dismissAlert`, the Builder's `order`,
`cancelOrder`, `orderNext`, `setRule`, `setReserve`, `moveFamily`,
`freezeRules`, `setFeedPlan`, …) drained
at the top of the tick. Published snapshots are copies (`{...}` / array
spreads), so a subscriber can never reach back into live sim state. High-rate
UI state that isn't economy output (`$placing` per frame during placement) is set directly by the frame loop.

## 5. Placement pipeline (`buildings/placement.ts`, `game.ts`)

1. **Heightfield ray-march**: the cursor ray marches the analytic heightfield
   in 4 m steps, then refines the crossing with 8 bisection iterations — no
   mesh raycast, no BVH.
2. **Grid snap**: hit point → footprint-origin cell on the 4 m grid
   (rotation R swaps the footprint axes).
3. **`checkPlacement` validity chain**, one function shared by the ghost, the
   action handler, and the debug API — in order: unlocked → inside survey
   area (1-cell margin) → site ice requirement → lava-tube footprint radius →
   no overlap with any structure → terrain roughness (`maxDelta ≤ 2.5 m`
   across the footprint) → within 60 m of the Lander or any Habitat (the
   habitat network is the growth mechanic) → affordable at site-multiplied
   cost. First failure returns its human-readable reason, which the HUD shows
   verbatim.
4. **Ghost**: pale lit mesh when valid, dark hatched when blocked (see
   06/07), drawn over a depth-only pre-pass so internal faces never double
   up; a terrain-draped footprint outline (8 segments per edge, +0.15 m), a
   draped 4 m cell grid fading out two cells past the footprint, and dashed
   build-radius rings around every network structure (`buildRadiusM`, else
   60 m for the Lander and Habitats) — `buildings/overlays.ts`.
5. **Commit** (`commitPlace`): deduct cost → `heightfield.flatten()` the pad
   to mean height with a smoothed 1-sample skirt → **record the flatten** in
   `state.flattens` (§7) → rebuild the ≤4 affected terrain chunks → push
   `BuildingState` → rebuild that type's `InstancedMesh` matrices.

## 6. Terrain (`terrain/`)

- **257² heightfield** (256 cells × 4 m = 1,024 m square), generated
  analytically: 4+2-octave fBm plus explicit crater math (parabolic bowl,
  gaussian rim, d⁻³ ejecta — full formulas in 06 §5).
- **8×8 chunks share edge samples** — chunk (cx,cz) reads global grid rows,
  so adjacent chunks reference identical corner heights and cracks are
  impossible by construction, including after a flatten rebuild.
- **One bilinear `sample(x, z)` API** serves placement (pad heights, ray
  march) and rendering (instance Y placement).
  There is exactly one definition of "the ground."
- `raycast` and `flatten`/`maxDelta` live beside `sample` so all terrain
  queries stay analytic and allocation-free.
- **Pits deform it** (docs/17 §11). The heightfield keeps:

  | Field | Holds |
  |---|---|
  | `base` | The generated surface. |
  | `delta` | An `Int16Array` of decimetres, 0 almost everywhere. |
  | `skirt` | The samples on any flatten's two-ring skirt. |

  - A carved or heaped sample is exactly `base + delta / 10`.
  - A flatten's skirt skips cut and heaped samples. With no pits, this changes
    nothing.
  - `noRoad(gx, gz)` walls off the cells a road may not take.
- **The chunk rebuild queue.** The frame takes the carved boxes (`takeCarved`), and
  their chunks join a queue.
  - The queue rebuilds at most one chunk a frame and two a second of frame time.
  - A debug advance or a load rebuilds each changed chunk at once.
  - Rocks on cut or heaped cells go.

## 7. Determinism & seeding (`core/rng.ts`)

- **mulberry32** everywhere randomness matters. World gen consumes
  `mulberry32(seed ^ 0x9e3779b9)`; terrain vertex-color noise and the
  starfield use their own fixed seeds.
- **Terrain is never saved.** It regenerates from `(siteId, seed)`. The save
  stores the *diff* the player made to the Moon, not the Moon:
  - the pits' sparse delta grid, applied first;
  - then the flatten history, replayed in order.

  So the load order is **base → deltas → flattens**. Pits never touch a pad or its
  skirt, and a flatten's skirt skips cut samples, so the result is exact.
- **Pits are deterministic.** They carve in id order, on their own tick clock, in
  integer decimetres. The loose layer and the stake's sub-metre jitter are seeded
  from `(seed, pit id)`.
- **Flares are seeded** (docs/16 §14.1): every draw is `mulberry32((seed ^ K) + index)`,
  K fixed per use — the cycle `0x5c1e`, the interval `0x5f1a` (by the flare's
  index; the legacy flare by `dayIndex`), the class `0x5f1c`, the range `0x5f1d`,
  the CME `0x5f1f`, which arrays are destroyed `0x5f20`. A seed gives the same
  classes and times on the same era times (`tests/flares.spec.ts`).
- `Math.random` appears only in `main.ts` to pick a seed when none is given.

## 8. Picking and reservations

There is no player body and nothing to collide with in the view: the command
camera flies over the ground. What collides is the sim's units, and what is
picked is the ground and the instances.

- **Picking** raycasts the terrain (`hf.raycast`) and the instanced meshes:
  a building or a moving part by instance (`instances.pick`, a tracker part
  maps back to its building), a hub unit through `haulers.pick`, a rover by
  instance or within 14 px of the click (they are small; a rover near the
  click beats open ground, never a structure). The outline twins are never
  hit (`InkMesh.raycast` is a no-op).
- **Reservations** keep units apart in the sim (`core/traffic.ts`, docs/15
  §6): one unit a road cell, a pit ramp one at a time, runs granted whole or not
  at all, priority loaded digger > empty digger > rover. The picture replays
  the sim's positions a tick late (`world/haulers.ts`), so what is drawn is
  what the sim did.

## 9. Save format (`core/save.ts`)

Single JSON blob under key `mbb-save-v1` in IndexedDB via `idb-keyval`, with
a `localStorage` fallback when IDB is unavailable:

```ts
SaveBlob = {
  state: GameState,          // version: 1 — plain JSON, includes flatten history
  savedAt: number
}
```

- Written by autosave (60 s), `visibilitychange` → hidden, the victory
  Continue button, and the debug API. Serialized through
  `JSON.parse(JSON.stringify(...))` to guarantee plain data.
- Load checks `state.version === 1` and rejects anything else; within
  version 1, `fillStateDefaults` fills what older saves lack. The Builder's
  state is `state.auto` (`schema: 1`: rules by id with on / threshold / cap /
  phase / dwell / site / nextAt, the order book, reserves, family order,
  vetoes, the log, the day's margin, the families already switched on),
  `state.flowBook`, and `b.auto` on the buildings it placed. A save without
  them loads with every rule off; a family recorded as switched on is never
  switched on again, so a loaded save keeps the player's choices. The
  destiny tracks add `forwarded` (techs a pick brought forward),
  `crewHome`, `launchDayUntil` and `evaCrew`, and put the landing pick in
  `techsDone`; `techSchema` 4 (`migrateTechSchema` step 3 → 4) adds it to
  older saves. The hazards add `state.hazards` (`schema: 1`: the scheduler's
  clock, credit and windows, the live hazards, `drilled`, the log, the
  meters, suit air, the air-gap and shipment state), `deaths`, `losses` and
  `grief` (each record names its cause and the warning it followed), per
  building `infected` / `airGapped` / `airlockDust` / `evacT` / `stripT` /
  `breached` / `decompressed` / `junk` / `slotsLost` and the offline
  timers, per rover `brickedUntil` / `heldUntil`, and `hacked` on outposts.
  `fillStateDefaults` gives an older save a quiet scheduler that starts a
  lunar day after load, and empty lists. Space weather (docs/16) makes
  `state.flare` classed (`n`, `cls`, `drill`, `range`, `seen`, `xCount`,
  `lastX`, `noXUntil`, the watch, `cme`, the choice and its decider, the
  locked `plan`, the exposure, the log) and adds `state.weather` (remembered
  choices by class, `autoRepair`, the answered classes, `legacy`, the repair
  jobs by field) and `flareSchema` 1; per Solar Array `stowT` / `stow`,
  `cap`, `flareDmg`, `wreck`, `fieldOverride` and `fix`. F2b adds `cap`,
  `scars` and `capWarned` to every structure, rover and hub unit, per
  structure `replace`, `flareShut`, and a legacy excavator's `rebootUntil`,
  `latch`, `burned`; per rover `rebootUntil`, `latch`, `reprintUntil`; per
  unit `rebootUntil`, `latch`; a hub job of kind `reprint`; the flare's
  counters, shut-down list and exposure (`recalled`, `checkpoint`, `shut`,
  `drawn`, `scarEx`, `unitsHome`); `weather.held` and `replaced`; losses
  with `hazard: 'flare'`. `migrateFlareSchema` (in `loadFrom`, after
  `migrateTechSchema`) runs docs/16 §14.3 steps 1–6: a flare in flight ends
  as an M at 45 s, the index from the old cadence, the first flare seen
  once its time has passed, no X for a lunar day, every array whole, and
  nothing scarred (capability 1.0 on every structure and machine). Rovers in transit (docs/15 §6a) add
  `state.fleetSchema` (1) and per rover `x` / `z` and `trip` (goal, kind,
  route, weights off-road, length, cruise, elapsed and total seconds); an
  excavator's haul adds `full` and `w`. A save without `fleetSchema`
  settles each rover where its work is, arrived, on load. On-board power
  (docs/02) makes it `fleetSchema` 2: every rover and every excavator's
  haul carries a pack (`PackState`: `charge` kWh — absent is full — `pw`,
  the share of the next tick it can act, `src` grid / pack / rpu / flat,
  `chg` charging, `flatT` seconds waited flat), a trip its `rate`, a
  building `onPack` (its grid draw dark, its units' packs working), and
  `s.power` its `fleet`, `charging` and `flat`. `fleetSchema` 1 → 2 clears
  the pack fields: every unit starts fully charged. `state.zones`
  (docs/15 §5a) is rebuilt from the heightfield and the reveals on every
  load.
- **Extraction hubs** (docs/17 Phases 1–2) add these fields:

  | Field | Holds |
  |---|---|
  | `state.haulers` | The hub units: id, type, hub, bay, target, face, pinned, parked, haul, wear. |
  | `state.nextHaulerId` | The next unit's id. |
  | `building.hub` | A hub's level, hopper, grade q, feed mix, print queue, Assign, plain pit, starved share. |
  | `state.plainPits`, `state.nextPlainPitId` | The staked plain pits (x, z, hub). |
  | `state.pile` | ▲ outside the hoppers. |
  | `state.dug` | Tonnes dug per target key (Phase 4's reserves). |
  | `state.hubSchema` | 1. |

  - A save without `hubSchema` is migrated: its excavators join the nearest hub, its ▲ fills the hoppers, then
    the pile. Plain-pit zones are rebuilt from `plainPits`.
- **Strip-mine pits** (docs/17 §11.5) add these fields:

  | Field | Holds |
  |---|---|
  | `state.pits` | Each pit's growth parameters: key, deposit, state, centre and opening, ramp line and top, R, tonnes, dug, cut and heap m³, q, deepest, anchors, bounds, last carve. |
  | `state.nextPitId` | The next pit's id. |
  | `state.terrain` | `rev` (carves), `clock` (the pits' tick clock) and `delta`. |
  | `state.terrainSchema` | 1. |

  - `delta` is the grid as sorted (index gap, value) pairs: varint gaps, int16
    values, base64. It is written by `saveBlob`, about 1.1 KB a pit with its heap.
  - Pit zones are left out of the save and rebuilt from the grid on load.
  - Nothing derived is stored: the loose layer comes from `(seed, pit id)`.
  - A save without `terrainSchema` gets no pits and an empty grid. Nothing is
    carved on load.
- **The resource highlight** (docs/17 Phase 5) stores nothing. `Game.updateHubLight` picks its source (a
  hub's ghost, else a selected hub, else a hub card: `$hubCard` on hover, `$touchInfo` on touch) and asks
  `core/hubPreview.ts` at most four times a second, or at once when the ghost moves a cell. The result goes
  to `world/depositHighlight.ts` (the ground), to `$deposits` as each deposit's optional `lit`, and to
  `$hubLight` (the plain pits and the stake). The overlay's labels and the Lunar Map read those two atoms.
- **Restore:**
  1. Regenerate the terrain from `(siteId, seed)`.
  2. Apply the delta grid.
  3. Replay the flattens.
  4. Rebuild the pit zones, the chunk meshes (once each), the rocks, the
     instances.
  5. An old save's `player` block (a pose and mode, from before the player
     stopped walking) is ignored: every save loads in the command view. The
     camera preset comes from `SaveBlob.camera` when the save has one.

## 10. Debug API (`debug.ts`) — the testability keystone

`?debug` attaches `window.__game`:

`getState()` (JSON snapshot) · `selectSite` · `placeBuilding` (runs the real
`checkPlacement`) · `grantResources / grantData / grantCrew / grantPower` ·
`completeTech` · `research` / `launch` / `setSpeed` / `setPaused` (via the
real action queue) · `advanceGameMinutes / advanceGameSeconds` (synchronous
economy ticks) · `setMode` (instant, no tween) · `getPlayer` · `save`. The
Builder adds `order` · `cancelOrder` · `orderNext` · `setRule` ·
`setReserve` · `moveFamily` · `freezeRules` · `setFeedPlan` (all through the
action queue) · `getAutomation()` (the [B] view) · `planSite(type, intent)`
(a dry run of the chooser) · `setWear(id, wear)`. The destiny tracks add
`pickDestiny(era, side)` (completes an era's pick) · `getDestiny()` (the
meter, the band, the next volley's terms, the gates) · `setDust(id, dust)`.
The hazards add `getHazards()` (the panel's view plus the raw state, deaths,
losses, grief) · `forceHazard(kind, target?, {drill, tier})` ·
`setHazardClock(seconds, id?)` (the next window, or a live hazard's clock) ·
`holdHazards(on)` (tests not about hazards, and the probe's
`--hazards=off`) · `counter(counter, id?)` · `airGap(id, on)` (both through
the action queue). Transit adds `instantTravel(on)` (every trip ends as it
starts, and a new goal is reached in the tick that sets it: tests where the
drive is not the point) and `getZones()` (each
extraction zone, its cells and gates). On-board power adds
`forceGridDark(on)` (the grid at 0 — no supply, the bank out of reach: a
forced brownout) and `setCharge(kind, id, kWh)` (a rover's or an
excavator's pack); `roadAccess()` gives a Relay Mast's off-road `stand`.
The hubs add `getHubs()` · `hubChoices(hub)` · `queueUnit` · `queueBay` ·
`cancelJob` · `assignPit` · `openPit` · `plainPitWhy(x, z)` · `sendUnit` ·
`recallUnit` · `dispatchUnit` · `autoUnit` · `selectUnit` · `unitHub`.
The pits add `getPits()` (every pit with its derived numbers, the grid
encoded, the rebuild queue) · `pitDig(x, z, tonnes)` (a dig at a point,
into that ground's pit) · `terrainSample(ix, iz)` · `terrainRelief(…)` ·
`terrainHash()` · `canGrade(gx, gz)`.
Space weather adds `forceFlare(cls, {drill})` · `getSpaceWeather(slider?)`
(the chip, pop-up and panel view) · `flarePreview(choice)` ·
`flareChoice(choice, {repair, remember})` · `flareRemember` ·
`flareAutoRepair` · `fieldOverride(id, mode)` · `wreckAction(how, id?)` ·
`repairArrays(id?)` (all through the action queue) · `setFlareMode('legacy' |
'on')` (the probe's `--flares`) · `setWeatherStub({arrayHard, sigma})` (Rad-Hard
Cells' and F4's shields' stand-ins) · `weatherCycle(T)` · `classOdds` · `drawClass` ·
`arrayInfo(id)` · `arrayFields()` · `forceEra(n)`. Forecasting (F3) adds
`flareAhead(choice | null, {repair, remember})` · `setForecastAhead(open)` ·
`launchSentinel()` · `predictFlares(n)` · `trueClass()`; `getSpaceWeather()`
carries its `forecast`. F2b adds `flareCounter(id, target?)` (Recall machines,
Checkpoint research, Shut down exposed, Replace, Re-print a rover or a unit,
Replace worst: the buttons' action) · `flareScarred()` · `flareCapability(id)` ·
`setCapability(kind, id, cap)` · `setFlareIndex(n)`; `getSpaceWeather()` carries `fx`.
`&hzpause` lets the pause-on settings pause a debug run, and `&flarepause`
the flare pop-up's; without them they never do.
The render path adds `getRenderInfo()` (the one renderer's report: `style`,
`safe`, `drawCalls`, `triangles`, `camera`, `outlines`, `ramp`, `ink`,
`frame`, `life`) · `enableSafeMode()` / `disableSafeMode()` ·
`holdBlackFrameCheck(on)` · `probeNext()` · `breakInk()` (the outline program
fails to compile on the next frame) · `setInkVariant('A' | 'B' | 'C' | null)`.
The roads, traffic, grading and survey streams add `planHaul`, `planRoad`,
`layRoad`, `holdOf`, `setRoadFlags`, `getTraffic()`, `patchHauler`,
`trafficBypass(on)`, `gradeBox`, `finishGrading`, `getGrading()`,
`getPitLook()` and `getPitMarks()` (see docs/19's "As shipped" subsections).

**Why it exists**: real-time waits make tests slow and flaky.
`advanceGameMinutes` makes hours of economy synchronous. Every Playwright
assertion drives this surface (plus real DOM clicks for UI-owned flows), so
tests exercise the same code paths as play — `placeBuilding` cannot bypass
validity, `launch` goes through the same action the button pushes.

## 11. Testing strategy (`tests/smoke.spec.ts`)

Five serial tests, one full game loop, against `vite` on 5173 (Playwright
boots it; a preinstalled Chromium is used when present). Screenshots
`01-site-select` … `07-restored` land in `test-results/` for visual review.

| Test | Proves |
|---|---|
| 1 · Site selection | Title renders, all 3 site cards with pros/cons/ratings, Land gates on selection, **zero page errors** on boot |
| 2 · Landing | HUD mounts (resource strip, swarm meter, milestone panel), state has exactly the pre-placed Lander on the chosen site |
| 3 · Economy & night | Placement API respects validity; regolith/metals/O₂ flow; at Mare night the smelter idles with reason `power` while the lander's trickle keeps the excavator alive — brownout triage works end-to-end |
| 4 · Tech tree | 6 era columns render; researching drains granted data and completes; era 2 opens at two era-1 techs — gating math verified |
| 5 · Endgame | Full tech ladder → milestones in order → real Launch button → victory overlay ("FIRST LIGHT") → **save, reload, Continue restores** launches and buildings |

## 12. The renderer (`world/renderer.ts`, `world/materials.ts`, `world/cel.ts`)

One way to draw the world: the **cel style** (docs/06). There is no style
switch, no quality ladder, no post chain, no shadow map and no render report.
The renderer only reads the state: the simulation, the heightfield, the
building kit, picking, overlays, the HUD and the save format do not depend on
it.

| | The cel renderer |
|---|---|
| Renderer | MSAA canvas, no shadow map, no tone mapping, sRGB out, DPR ≤ 1.5 |
| Frame | one forward render straight to the canvas (`drawFrame()`); a throwing scene render skips the frame and is reported once |
| Materials | the registry (`materials.define`): the ground program (`celSurface.ts`: vertex colours, faceted normals, two light steps) for the terrain, ring, berms, rocks, roads and the ghost, stock points for dust, one small building shader (`celBuilding.ts`: palette, three-step ramp, glow, beacons, print reveal), and the ink program (`ink.ts`: an inverted-hull outline twin of every instanced class) |
| Lights | `CelLighting`: one key + one hemisphere fill; the base's own light is `iGlow` windows and draped pools at each structure's darkness |
| Command camera | `IsoCam` (the only camera) |
| Safety | the black-frame check (`probeGround`) reads frames wherever the ground cannot be black; a black frame or a compile error in any program but the cel and ink ones turns **safe mode** on (unlit twins of every material, no dust, no outlines; kept in `mbb-settings`, one menu row); a compile error in a cel program swaps in stock Lambert in the same palette for all of them (`materials.replaceCustom`); a compile error in the ink program hides the outlines (docs/06 §15) |

**How the meshes get their material.** Every creator asks the registry
(`materials.get(key)`, keys `building | terrain | rock | ghost | dust | road`),
so a fault fallback or safe mode reaches meshes made at any time. The cel
palette and per-instance light level are installed as a hook on
`withInstanceState()` (`installCel()`), so trackers, rovers, hub units and the
cargo lander pick them up (and `inked()` adds each class's outline twin).
`getRenderInfo()` reports `style: 'cel'`, `safe`, `drawCalls`, `triangles`,
`camera: {rot, tilt, zoom}` (from `IsoCam.info()`), `outlines` (the outline
meshes drawing), `ramp` (the steps of the light ramp), `ink`, the last frame
(`frame`) and the context attributes, beside the fields the older specs read
(`life`, `base`, `rocks`, `terrain`, `buildingMaterials`, `probes`,
`firstFrame`). `?style`, `?fx` and `?lowfx` in the address are ignored;
`?cel=A|B|C` picks a look variant (docs/06 §3.1).

## 13. Known limitations (accepted for the slice)

- **No terrain LOD** — all 64 chunk meshes stay resident at full density.
  Fine at 1,024 m; a bigger map needs the roadmap's LOD + worker work.
- **Terrain generation on the main thread** — a one-time hitch on new
  game/load (257² samples × crater list). Loading also rebuilds all 64 chunks
  rather than only flattened ones.
- **Instancing cap: 96 per building type** — matrices beyond the cap are
  silently not drawn (state still simulates them). No player-facing limit UI.
- **Economy is O(buildings) per tick** with several passes and a per-tick
  sort; negligible at slice scale, and the 120-tick guard bounds catch-up
  cost, but thousand-building saves want incremental bookkeeping.
- **Single save slot, no migration** — `version !== 1` saves are ignored,
  not upgraded.
- **Contact decals and flood pools follow footprints**, rebuilt when
  the set of structures changes; a structure that moves on its own each
  frame would leave its decal at its pad.

---

*Related: [06-art-direction.md](06-art-direction.md) (render values) ·
[07-ui-design.md](07-ui-design.md) (store contracts, re-render rules) ·
[10-slice-scope.md](10-slice-scope.md) (verification story).*
