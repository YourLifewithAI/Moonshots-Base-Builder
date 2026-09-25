# 13 · Construction automation: orders, standing rules and the research that grows them

> "As we progress through the game, part of the research should involve
> automation. Instead of manually building various buildings, the construction
> drones should begin to build based on objectives that we set. So if we're
> running low on regolith, we tell them to build more excavators. Eventually we
> should be able to unlock automated regolith excavation. That way if we run
> below regolith production vs. consumption, that should trigger the
> construction drone to go build another excavator. This expands significantly
> the type of research that can be added to the research tree."

This is the implementation spec for that request. It has two layers:

- **Orders.** They need no research. The player says "build N more of this", and the builder picks the sites.
- **Standing rules.** Research unlocks them one building family at a time. Each rule watches a number and orders a build when the number crosses a threshold.

The research ladder in §4 grows both layers, and makes them smarter and safer.

**Status.** This document is the Phase A design. Phase B implements it after two other branches merge:

- **work/fleet** makes construction rovers into sim units and turns excavators into hauling diggers.
- **work/tree** grows the tree to about 90 techs, each with a `visual` line, and makes eras about 2× longer.

Names borrowed from those branches were correct at the time of writing and must be checked again at merge: `s.rovers`, `assignRovers`, `tripFor`, `dropFor`, `setDigSite`, `digRefusal`, `plan`, `HAUL` and `TechDef.visual`. The rule from [00-index.md](00-index.md) applies: once this is implemented, the code wins over this document.

**Glyphs:** ▲ regolith · ◆ metals · ◇ silicon · ≈ water · ○ O₂ · ✳ food · ⚙ parts · ▣ chips · ≡ data. Costs are quoted at mare (build cost ×0.8). Rates in the UI are shown per minute, like every resource panel. Internally they are per second.

---

## 0. Decisions

| Topic | Decision | Why |
|---|---|---|
| Two layers | **Orders** are one-shot and need no research. **Standing rules** are researched per building family. | These are the user's two steps: first "we tell them to build more excavators", then "eventually … automated regolith excavation". |
| Orders before research | One-shot orders of ×1–3 are available from landing. **Build Orders** (Era 2) adds *held* orders, an order book and counts up to ×10. | The user asked to tell the drones "build more excavators" before automation exists. The verb is free; the convenience is the research. (Coordinator decision.) |
| Who picks the site | One pure chooser, `core/siting.ts`, serves both orders and rules. Research improves it (Site Survey AI). | One source of truth, as `checkPlacement` is for validity. |
| Site choice before Site Survey AI | **Distance to the anchor only**: no deposit preference and no haul-lane preference. There is no randomness. Site Survey AI adds deposits, peaks of light and lane avoidance. | A random "planner error" reads as the game being wrong, not as a trade-off. A naive, deterministic chooser is a con the player can see and understand. (Coordinator decision.) |
| Rules on by default | A family's rules switch **on** when its tech completes, with **conservative default caps**. The discovery card's Next line names the new behaviour and [B]. A loaded save never switches a rule on. | The user wants a deficit to trigger a build without further setup, and conservative caps keep an unattended rule from sprawling. (Coordinator decision.) |
| Sim/renderer split | The economy decides **what** to build and **when**: a pure new step, 12. The Game decides **where**, by running the chooser over the heightfield, and commits through the same `commitPlace` a click uses. | Placing a building flattens terrain and rebuilds chunks and instances, and that is Game's job. The decision stays pure and testable. |
| The signal | Rules watch **supply against demand** in a new flow book (§3.1), not only how the stock changes. | A smelter starved of regolith idles for `inputs`. The stock never falls, so net regolith reads about 0 while half the furnace stands cold. Demand still counts its 2▲/s. |
| Capacity, not trouble | A rule builds only when the buildings it would add to are all running. If they are dark, short of crew or starved of inputs, the rule **holds** and says why. | Building more consumers into a brownout is the classic automation death spiral. |
| Limits | Dwell, hysteresis, cooldown, a settle wait, a cap, a reserve, one pending auto-site per family, and at most 2 auto placements per tick. | Every genre automation that lacks one of these either oscillates or runs away. |
| The builder extends what you founded | A rule never builds the **first** of a type. Orders can. | The first smelter, battery or yard is a milestone and a decision, so it stays the player's. |
| Never rule-built | Labs, Data Centers, the Rec Dome, Foil Factory, Mass Driver, Propellant Plant and the Lander. Relay Masts only through Self-Expanding Base. | Research pace, doctrine and the endgame stay with the player. Orders can place any of these except the Lander and masts. |
| Spending | The normal build cost, paid at placement. A rule never spends below its reserve or the welding parts the queue needs. | The brief says "normal build costs": automation carries no markup. |
| Cons | Every tech has a **numeric** con (kW or upkeep) that passes `auditTechs`, plus a behavioural one: it spends your stock unasked, and reserves make it slower. Before Site Survey AI, sites are chosen by distance only. | Pillar 7 of [11](11-research-and-map-spec.md): every card is a trade-off. |
| Name | The UI calls the system **the Builder**, with a panel on **[B]**. "Autonomous" remains the name of the station-crewing toggle. | `mods.automation` already means agent-run stations (Construction Robotics). Two systems called "automation" would confuse players. |

## 1. The builder's rules

These lines are the header copy of the Builder panel. Each one has a mechanism behind it in §2–3.

1. **It builds what you would, close to where it is needed, at the price you would pay.**
2. **It keeps back what you need**: never below the reserve, and never the parts the welders need.
3. **It builds for capacity, not for trouble.** It adds nothing to a brownout.
4. **One site per family at a time**, and after each site it waits for the numbers to settle.
5. **It extends what you founded.** It never builds the first of a type.
6. **It always says what it did, and why it didn't.**
7. **Any auto site can be cancelled for a full refund**, and the builder takes the hint.

---

## 2. Orders

### 2.1 Where the player orders

| Surface | Gesture | What it orders |
|---|---|---|
| **Resource panel** (click a chip) | Under *Produced by*, each unlocked producer row carries **`+1` `+3`** buttons. With Build Orders they become a `− N +` stepper (up to 10) and an **Order** button. | That producer, with the panel's resource as the **intent**: from the regolith panel, an excavator the feed can use. |
| **Power panel** | The same buttons on the Solar Array, Battery Bank and Thorium Reactor rows. | |
| **Crew panel** | Habitat and Hydroponics rows. | |
| **Robots panel** (the ◉ chip) | The Robotics Bay row. | |
| **Palette card** | **Ctrl/⌘-click** orders ×1; **Ctrl/⌘+Shift-click** orders ×3. The tooltip gains `Ctrl-click: the rovers choose the site`. | That building, with its main output as the intent. |
| **Placement** | **Enter** while the ghost is up orders ×1 of that type. Placement ends unless ⇧ is held, as for a click. | |
| **Inspector** (a completed building) | **`＋ Build another`**. | ×1 with intent *like #id*: the same kind of deposit, near that building. |

The action is `{ kind: 'order'; type; count; intent?: { res?: ResourceId; like?: number } }`. It is applied in the frame, like a click, so it works while the game is paused and the sites appear at once.

### 2.2 What an order does

- **Without Build Orders, orders are one-shot.**
  - The chooser (§2.3) places up to `count` sites, one after another. Each site sees the ones placed before it, and each is paid in full as it is placed.
  - Anything that cannot be placed is **skipped**. One alert reports the whole order:
    `ORDER — 2 Excavators placed (#7 on high-Ti basalt, 38 m from Smelter #3; #8 22 m from Smelter #3) · 1 skipped: needs 16◆, have 9`.
  - The sites join the normal rover queue at the back, in placement order, exactly as clicked sites do. **Build next** still works on them.
- **With Build Orders, orders are held.**
  - Whatever cannot be placed now waits in the **order book** (up to 4 open orders).
  - Economy step 12 places one site per order per tick, as soon as the budget allows.
  - The book shows each order's progress and what it lacks, for example `Excavator ×3 · 2 placed · waiting: 16◆ (have 9)`, with **Build next** (moves the order's unbuilt sites to the queue head) and **✕** (cancel the remainder).

| | Without Build Orders | With Build Orders |
|---|---|---|
| Count per order | 1–3 | 1–10 |
| Open (held) orders | none: an order places what it can and skips the rest | 4 |
| Spends down to | the welding parts the queue needs (§3.3) | the same, plus the Governor's floors once researched |
| Intents | the panel's resource, the card's output, *like #id* | the same |

**Orders obey exactly what a click obeys.** Their only hard refusals are the `checkPlacement` refusals: locked, not at this site, no valid ground, can't afford. The first-smelter caution and a shortage of free crew become **warnings in the alert**, just as the ghost shows them:

- `· leaves 12◆; a Smelter needs 32◆`
- `· no free hands: it idles until crewed (or set Autonomous)`

Orders are the player's command, so they do not use rule reserves. Refusals:

- `ORDER REFUSED — Silicon Refinery is locked: Silicon Refining`
- `ORDER REFUSED — no polar ice at this site`
- `ORDER REFUSED — the Lander is one of a kind`
- `ORDER REFUSED — Relay Masts need a direction: place them yourself (Self-Expanding Base plants them)`
- `ORDER REFUSED — no valid ground for a Smelter inside the build network; a Relay Mast or Habitat extends it`
- `ORDER BOOK FULL — 4/4 open; cancel one first`

### 2.3 Choosing a site (`src/core/siting.ts`, shared by orders and rules)

`chooseSite(s, mods, site, ground, type, intent, opts)` is pure. `ground` is `Pick<Heightfield, 'depositAt' | 'maxDelta' | 'deposits'>`, and the live `Heightfield` satisfies it. The function returns either `{ gx, gz, rot, why, dig? }` or `{ refusal }`. There is **no randomness**: the same state always gives the same site.

**Two choosers, one function.**

- **The base chooser** (from landing) picks by **distance to the anchor only**. It has no deposit preference and no haul-lane preference.
- **Site Survey AI** (Era 3, ▣) adds the deposit preference, peaks of light for solar, planned dig sites, and lane avoidance.

The base chooser's naivety is deterministic and visible: an auto Smelter may sit on ilmenite an excavator would have dug, and an auto Excavator digs plain ground next to the furnace. Anyone who looks can see why the site was chosen, and Site Survey AI is the fix.

**The pipeline:**

1. **Candidates.** Every footprint origin whose footprint centre lies inside a network node's radius (`networkNodes`, taken in building order). Cells are scanned row-major (gz, then gx). Non-square footprints try both rotations. The base chooser tests every second cell; Site Survey AI tests every cell.
2. **Fast filters**, on an occupancy raster built once per call (256×256 bytes). A candidate is rejected if it:
   - overlaps a footprint;
   - covers a **door apron** (the 1-cell strip in front of each building's door side, +z rotated by `rot`). This applies to both choosers: it keeps every door clear and is not a site preference;
   - falls outside the lava tube footprint or off the map edge;
   - crosses a **haul lane** (Site Survey AI only).

   Then what placement would refuse on sight (docs/15-roads.md). Both choosers strike these before the ranking:
   - covers a **road cell**, open or still sintering;
   - is **too rough**: relief over `MAX_SLOPE_DELTA` (2.5 m);
   - has **no road route**: no road could reach it. A field type not served already needs a reachable cell in its ring; any other type needs its door cell reachable. `roadReach` floods the cells a new road could reach from the open network, walked as the A* walks. It is memoised on the network and the buildings.
3. **Score.** Lower is better; the terms are in the table below.
4. **Validate** every pad left, in score order, with the real `checkPlacement`, which stays the one truth. The walk stops once six pass. Of those six, the pick is the one whose score plus 1.5 m per new road cell is least (docs/15 §3). The caller has already checked the cost against its budget. Placement's own hard rules still apply to both choosers: an Ice Harvester only on confirmed ice, never a Habitat on KREEP.
5. **Refuse**, if none passes, with a count of the open pads by reason (next table). An open pad is a candidate clear of footprints and door aprons.

**Why there is no fixed window.** The walk used to stop after the first 200 pads by score. The raster did not know roads or relief, so near a crowded base those 200 could all be roads and rough ground. On the crewed pole (seed 1234, pure Automation) the solar rule sat in `nosite` for 38 min. 628 valid pads lay past the window (docs/14 §6). Now the cheap refusals never reach the walk. The walk's `checkPlacement` calls are cheap, since pads no road can reach are already struck and the A* only runs on the rest.

**The refusal's count.**

| Reason | Words |
|---|---|
| relief over the limit, or a large pad on rough ground | `too rough` |
| covers a road cell | `on roads` |
| no road could reach it | `no road route` |
| crosses a haul lane | `on haul lanes` |
| a player's veto | `vetoed` |
| outside the lava tube | `outside the lava tube` |
| anything else `checkPlacement` says | `refused (…)`, with the first such reason |

Largest first: `no valid ground for a Solar Array inside the build network (of 412 open pads: 229 too rough, 150 on roads, 33 no road route) — a Relay Mast or Habitat extends it`.

A pick that lays a road says so at the end of its `why`: `nearest free pad to the base centre · 23 m · a 9-cell road to it`.

**Score terms.**

| Term | Base | Site Survey AI | Meaning |
|---|---|---|---|
| Anchor distance *d* | +1 per m, straight line | +1 per m, planned path (`plan`) round footprints | from the footprint centre to the type's anchor (next table) |
| Wanted deposit | — | −40 | the footprint centre is on the revealed deposit the intent wants (the feed-target table) |
| Someone else's deposit | — | +25 | ground reserved for another family: ilmenite or anorthosite an excavator should dig, ice for harvesters, a ridge for solar |
| Peak of light (solar only) | — | −40 | never shaded, ×1.2 output |
| Haul lane | — | rejected | the footprint crosses an excavator's dig → drop leg, widened by `HAUL.clear` |
| Relief | +2 per m of `maxDelta` | the same | flatter pads first; mostly a tie-break |
| Tie | (score, gz, gx, rot) | the same | makes the choice deterministic |

**Site Survey AI knows only what the overlay shows.** Deposits count only when `depositRevealed` says so, and hidden ground is never scored. The base chooser reads no deposits at all. With either chooser, a site that lands on hidden ground **strikes** it (`PROSPECT STRUCK`), exactly as a click would.

**Anchors, and what Site Survey AI adds, by type.**

| Type | Anchor (both choosers) | Site Survey AI adds |
|---|---|---|
| Regolith Excavator | the nearest regolith consumer (Smelter or Refinery; the Lander if there is none) | the **feed target** (next table), scored by delivered rate; planned dig sites |
| Ice Harvester | the Lander (water is tanked, not hauled) | — (placement already requires ice) |
| Solar Array | the base centroid (keeps the base compact) | peaks of light first; off reserved deposits |
| Battery Bank | the Lander | off reserved deposits |
| Smelter, Refinery | the centroid of the excavators' dig sites, so every haul is short | off reserved deposits: a furnace on ilmenite buries the ore |
| Parts Fabricator, Chip Fab | the nearest Smelter or Refinery (a compact industry block) | off reserved deposits |
| Storage Yard | the centroid of the full resource's producers | off reserved deposits |
| Robotics Bay | the centroid of the pending sites | off reserved deposits |
| Habitat | the Lander. Growing the network is the player's choice. | off reserved deposits |
| Hydroponics | the nearest Habitat | off reserved deposits |
| Relay Mast (Self-Expanding Base) | the network edge, toward the target (§3.4) | — |

**The excavator feed target** is what "the deposit the feed wants" means. Site Survey AI and Feed Planner use it:

| Situation | Wanted deposit | What it does |
|---|---|---|
| H₂ smelting (Regolith Smelting, or no smelter tech yet), and more so with Beneficiation | ilmenite | smelter feed +30% per unit share, ×2 with Beneficiation |
| MRE smelting | none (feed-insensitive) | the nearest plain pad |
| Silicon balance worse than metals, with Refineries present | anorthosite | refinery +40% |
| The O₂ rule (life support) with H₂ smelting | glass, if revealed | smelter O₂ +60% |
| The water rule with Solar-Wind Volatiles | mature soil (volatiles) | water ×2.5 |

**Excavators and fleet hauls.**

- **Base chooser:** the pad nearest the consumer. The excavator digs its own pad, whatever ground that is.
- **Site Survey AI:** it scores two options and takes the better, preferring (a) on a tie:
  - (a) a pad on the wanted deposit, digging home;
  - (b) a pad beside the consumer, digging the deposit's nearest mapped point.

  The score is `tripFor(…).rate × (1 + ½ feedGain)`. Option (b) stores `auto.dig`, and `setDigSite` applies it when the excavator completes, because an excavator cannot dig while it is still a site.

**`why` strings** feed the alert and the inspector. They state the reason, and never call a site wrong:

- base: `nearest free pad to Smelter #3 · 18 m`
- base: `nearest free pad to the Lander · 12 m`
- Site Survey AI: `on high-Ti basalt · 38 m haul to Smelter #3`
- Site Survey AI: `on a peak of light · never shaded`
- Site Survey AI: `nearest free pad to Smelter #3 (no revealed high-Ti in the network)`

### 2.4 The base chooser against Site Survey AI

| | Base (from landing) | Site Survey AI (Era 3, ▣) |
|---|---|---|
| Picks by | distance to the anchor only | distance, deposits, peaks of light, haul lanes |
| Candidate grid | every 2nd cell | every cell |
| Distance | straight line | planned path (`plan`) round footprints |
| Deposits | not read (placement's ice and KREEP rules still hold) | wanted deposit −40, others' deposits +25; excavators scored by delivered rate × feed value (`tripFor`) |
| Peaks of light | ignored | solar goes there first |
| Haul lanes | ignored | never crossed |
| Door aprons | kept clear | kept clear |
| Excavator dig sites | digs its own pad | may dig a deposit from a pad beside the consumer |

Neither chooser reads terrain shade. `b.shaded` is computed on the renderer side at frame cadence, and reading it would break determinism (§6.3).

---

## 3. Standing rules

### 3.1 Signals

| Signal | Definition | Source | Smoothing |
|---|---|---|---|
| `balance(r)` | `made(r) − want(r) − spend(r)`, per second | the flow book (§6.2) | `made` and `want`: a 20 s EMA (`RATE_SMOOTH_S`). `spend`: a 300 s EMA. |
| `stock(r)` | `s.resources[r]`, and its share of the cap | state | none |
| `runway(r)` | `stock ÷ −net(r)` when `net < 0`, else ∞ (`net` = `s.rates`) | state | 20 s, through `s.rates` |
| `dayMargin` | `(supplyFull − load) ÷ load`, where `load` = demand minus construction draw | steps 1–2 (new `power.supplyFull` and `power.construction`) | a 20 s EMA of daytime samples only (sun ≥ 95% of peak, no flare) |
| `nightCover` | `capacity ÷ (nightNeed × NIGHT_S)` | `nightForecast()`, shared with the dusk alert | recomputed every tick |
| `bankRanDry` | the night just ended shed or browned out while the bank was below 1 | step 10 (new `stats.nightBankEmpty`) | one per night |
| `freeBeds` | `housingActive − crew`, counted only while arrivals are otherwise possible (morale > 60, `boardingShortfall` is '') | step 5 | none |
| `backlog` | enabled sites waiting for a rover | step 0 | none (the dwell smooths it) |
| `worn(b)` | seconds a building has spent at wear ≥ the threshold | step 6 | none |

**What the flow book counts:**

- **`want(r)` counts what consumers asked for, not what they got.** Every building eligible to run this tick (enabled, complete, powered, staffed, not standing by `full`) adds its inputs, whether or not the stock covered them. The crew adds its life support; upkeep and welding add parts.
- **`made(r)`** counts the outputs credited. For an excavator that is its cycle average, as `s.rates` already treats it.
- **`spend(r)`** counts lump spending: placements (manual and auto), research goods, outpost claims and survey costs.
- **Deliveries never count as made**: resupply and downlink cargo are windfalls, not production.

Why `made − want − spend` and not the net rate:

- A starved consumer hides its deficit from the net rate (see §0).
- **Build currencies are consumed in lumps.** The furnace makes metals continuously, but they leave at placement. A base spending metals faster than it smelts them needs another smelter even while `net` looks positive between placements.

### 3.2 The rule state machine

The states are: `off` · `locked` · `ok` · `watching` · `building` · `settling` · `waiting` · `holding` · `capped` · `nosite` · `vetoed`.

Every tick, in step 12, each rule runs the following. Rules go in family priority order (§3.3), and each family's rules in table order (§3.4).

```
off      ← !rule.on
locked   ← its family tech, or its building's unlock, is missing
building ← this family has a pending auto site (until it completes or is cancelled)
settling / vetoed ← now < rule.nextAt
dwell    ← past(T) ? dwell + dt : rearmed(H) ? 0 : max(0, dwell − dt)
ok       ← dwell = 0 and not past(T)
watching ← dwell < dwellS
then, in order, the first that applies:
  capped   ← count(type) ≥ cap
  founded? ← no complete building of this type yet → ok ("found the first yourself")
  holding  ← capacity check fails (below)
  holding / request ← prerequisite check fails (below)
  waiting  ← budget fails (§3.3)
  nosite   ← chooseSite refused
  → REQUEST: one site, handed to Game.econStep
```

- **No ground stays no ground.** A rule in `nosite` whose signal cannot be read (the solar margin out of full sun, the night) stays in `nosite`, with the same line. It does not fall back to `watching`. So its refusal alert holds, and the Network rule's 60 s clock runs on.

- **Dwell and hysteresis.** The dwell counts up while the signal is past the trigger T. Between T and the re-arm level H it decays instead of resetting, so a signal hovering near T neither fires nor forgets. It resets only when the signal comes back past H.
- **Cooldown and settle.**
  - When the site is placed: `nextAt = now + cooldownS`.
  - When the site completes: `nextAt = max(nextAt, now + settleS)` and the dwell is zeroed. The next build therefore needs a fresh dwell after the averages have caught up.
  - The settle wait includes one haul cycle for excavators, since the first bucket arrives late.
- **One pending auto-site per family.** A family is busy while any site one of its rules placed is still under construction.
  - Orders do not take the family's slot. However, a rule will not fire while an order for **the same type** still has unbuilt sites, because the player has already asked for more.
  - Across all families, step 12 makes at most 2 placements per tick.
- **Capacity, not trouble.** If any complete, enabled building of the rule's type is idle for `power`, `crew`, `reserve`, or `inputs` of a resource other than the one the rule watches, the rule holds:
  `holding · 2 of 5 Excavators dark (power) — more would not help`.
- **Prerequisites.** Before requesting a consumer:
  - **Power headroom.** `headroom = supplyFull − load − pendingDraw` must be at least 1.1 × the new building's draw. The draw comes from `effectiveRates` and includes the agent tax. If headroom is short:
    - with the Power family on, the solar rule is raised at once. The dwell is bypassed, but its cap, budget and pending slot still apply. This rule then waits: `waiting for power · Solar Array #31 first`;
    - otherwise it holds: `holding · a Smelter's 12 kW would brown the grid out — build power first (Automated Power does)`.
  - **Input supply.** A processor rule (Smelter, Refinery, Parts Fabricator, Chip Fab, Hydroponics) checks that its main input can carry one more building: `balance(input) − its demand ≥ 0`, or the stock covers 10 minutes of it. If not, it requests that input's rule (Excavation for regolith, Smelting for metals) when that family is on; otherwise it holds.
  - **Chain limit.** A request chain goes at most 2 deep per tick. A rule raised by a request that cannot act does not request anything further.
- **Crew** (human runs). A crewed station is placed crewed if enough hands are free. If they are not, it is placed Autonomous (`automated: true`) when the base allows it (`mods.automation`), with that draw counted in the headroom. Otherwise the rule holds: `holding · no free hands for a Smelter (2 crew) — Construction Robotics lets agents run it`.
- **Player vetoes.**
  - **Cancelling an auto site** refunds it in full, as any untouched site. It also vetoes that footprint (grown by 1 cell) for that rule for one lunar day (720 s) and sets `nextAt = now + 720`: `vetoed · you cancelled Excavator #9 — resumes in 11:20`.
  - **Demolishing** any building of the rule's type also sets `nextAt = now + 720`. The builder does not rebuild what the player just removed.
- **Pause, night and flares.** Rules run only in economy ticks, so a paused game places nothing. The solar rule reads only daytime margins. Nights and flares idle producers, and the capacity check then holds the other rules.

### 3.3 The budget: reserves, welding, priorities

A rule spends only if, for every resource in the cost, `stock − cost ≥ reserve(r)`.

| Reserve term | Before the Governor | With Budget Governor |
|---|---|---|
| The base floor | one more of the same build (the cost again) | the **player's floor** per resource (defaults: 25% of cap for ◆ ◇ ⚙, 10▣), or the cost again, whichever is larger |
| Research goods | the goods of queued techs in `researchStalled` | those, plus the goods of queued techs at least 60% paid |
| Welding (parts only) | **weld debt** + 20 | the same |
| Priority holds | none: first come, first served in family order | the cost of each higher-priority rule that is waiting, or watching past half its dwell |

- **Weld debt** is `Σ over sites of (construction left ÷ weldRateMult) × CONSTRUCTION_PARTS_PER_S × weldPartsMult`: the parts the queue still needs to finish welding. With fleet, a build's weld total does not change with crew size, so this is the same number. The builder never causes `CONSTRUCTION STALLED`.
- **Life-support resources** are never build costs, so the crew's reserve (`crewReserve`) is never at risk.
- **Priority.** The default family order runs upstream first:
  **life support → power → excavation → smelting → fabrication → maintenance → network**.
  The Budget Governor makes it reorderable (⇅ in the panel) and adds the holds. It also moves a **crisis** auto site to the head of the rover queue (Build next): a life-support rule with a runway under 5 minutes, or a daytime brownout the solar rule is answering.

### 3.4 The rule table

Rates are shown per minute in the UI; the per-second values are in brackets. T is the trigger and H the re-arm level. All thresholds and caps can be set in the Builder panel, within the stated range.

| Family (tech) | Rule | Builds | Shown as | Trigger T | Re-arm H | Dwell | Cooldown / settle | Cap (default, range) | Also |
|---|---|---|---|---|---|---|---|---|---|
| **Excavation** (Automated Excavation) | `excavator` | Regolith Excavator | KEEP regolith supply ≥ demand | balance < −6▲/min (−0.10/s) | ≥ 0 | 60 s | 120 s / 60 s + 1 haul cycle | 6 (0–30) | only while regolith < 50% of cap |
| | `iceHarvester` (pole) | Ice Harvester | KEEP water supply ≥ demand | balance < −1.2≈/min (−0.02/s) | ≥ 0 | 60 s | 120 / 60 | 3 (0–12) | needs revealed ice in the network |
| **Power** (Automated Power) | `solar` | Solar Array | KEEP the day's grid margin ≥ 10% | dayMargin < 10% (5–50%) | ≥ margin + 10% | 30 s | 60 / 30 | 24 (0–150) | by day only; also answers headroom requests |
| | `battery` | Battery Bank | CARRY the night | reactive: `bankRanDry`, acted on at dawn. Predictive: nightCover < 100% (50–150%) | ≥ target + 10% | — (at dawn) / 60 s | 60 / 30 | 6 (0–40) | never builds at night |
| | `reactor` | Thorium Reactor | BASELOAD for the night | nightNeed > 25 kW with batteries at their cap | — | 120 s | 600 / 120 | 1 (0–6): with the first-of-a-type rule it adds none until you raise it | Thorium; mare and lava tube |
| **Smelting & Refining** (Automated Smelting) | `smelter` | Regolith Smelter | KEEP metals supply ≥ demand (builds included) | balance < 0 **and** stock < 50% of cap | balance ≥ +3◆/min or stock ≥ 60% | 90 s | 180 / 90 | 4 (0–12) | starved of regolith → requests Excavation |
| | `refinery` | Silicon Refinery | KEEP silicon supply ≥ demand | the same, or research stalled on silicon | the same | 90 s | 180 / 90 | 3 (0–12) | |
| | `storageYard` | Storage Yard | ROOM at the top | a capped stock ≥ 95% of cap while one of its producers stands by `full` | < 85% | 60 s | 120 / 30 | 4 (0–20) | |
| **Fabrication** (Automated Fabrication) | `partsFab` | Parts Fabricator | KEEP parts supply ≥ demand | balance < 0 and stock < 50% of cap | ≥ +1.2⚙/min | 90 s | 180 / 90 | 3 (0–10) | starved of metals → requests Smelting |
| | `chipFab` | Chip Fab | CHIPS for what's queued | research stalled on chips for 120 s, or queued chip goods > 1.5 × the next 10 minutes of production | — | 120 s | 300 / 120 | 3 (0–6) | Wafer Fab |
| | `roboticsBay` | Robotics Bay | NO site waits for a rover | backlog ≥ 2 | 0 | 120 s | 300 / 60 | 3 (0–8) | |
| **Life support** (Automated Life Support) | `oxygen` | the O₂ producer (`producerOf`: usually a Smelter) | KEEP ≥ 20 min of oxygen | runway < 20 min (5–60), or balance < 0, with crew aboard | ≥ T + 10 min and balance ≥ 0 | 30 s | 120 / 60 | 5 smelters (0–12) | ranks above every other family |
| | `food` | Hydroponics Farm | KEEP ≥ 20 min of food | the same, for food | the same | 30 s | 120 / 60 | 4 (0–16) | |
| | `water` | the water producer (Ice Harvester / Excavator with Volatiles / Smelter) | KEEP ≥ 20 min of water | the same, for water | the same | 30 s | 120 / 60 | 3 (0–12) | |
| | `habitat` | Habitat Module | A BED for the next settler | freeBeds < 1 | ≥ 2 | 120 s | 300 / 60 | 4 (0–20) | never on KREEP |
| **Maintenance** (Maintenance Automation) | `replace` | the same type | REPLACE worn-out machines | a building at wear ≥ 40% (20–80%) for a lunar day | — | 720 s | one at a time | — | §4, tech 11 |
| **Network** (Self-Expanding Base) | `relayMast` | Relay Mast | REACH the ground the rules need | a rule in `nosite` for 60 s, or the best deposit Site Survey AI found for a rule lies ≤ 90 m outside the network | — | 60 s | 300 / 60 | 4 masts (0–20) | placed at the network edge, toward the target |

**Caps count every building of the type**: manual, ordered and auto-built. A rule reads only its own cap. That is how the O₂ rule can grow smelters to 5 while the Smelting rule stops at 4: life support is never capped by industry.

**Default caps are conservative.** Each is a few buildings above what a base typically has when the tech completes, going by the probe's build logs on the current tree (§8.2). Examples: 1–3 excavators at Era 3 against a cap of 6; 14–19 arrays at Era 4 against 24; 2–3 smelters at Era 5 against 4. Recheck them against the 2× tree's logs at merge. An unattended rule therefore grows the base a little and then stops with `AUTO CAP`, which names the cap and [B]. It never sprawls. The player raises caps as the base grows.

**Rules switch on when their tech completes** (coordinator decision), with the defaults above. Two messages say so:

- the alert: `BUILDER — the Excavation rule is on: +1 Excavator when regolith demand outruns supply for 60 s · cap 6 · [B] to tune`;
- the discovery card's **Next** line (§5.4).

The reactor rule switches on too, but with cap 1. Together with the first-of-a-type rule, that means it adds nothing until the player raises the cap: a 96◆ 32⚙ reactor stays the player's call. A loaded save never switches a rule on by itself.

### 3.5 What rules never build, and why

| Building | Why it stays manual |
|---|---|
| Research Lab, Data Center | Research pace is the player's first strategic lever, and a rule would pick the pace for them. |
| Recreation Dome | A pure morale purchase. Morale has no clean "shortfall" signal. |
| Foil Factory, Mass Driver, Propellant Plant | The endgame, and the launch doctrine, stay hands-on. |
| Relay Mast | Its placement is a direction, and only the player knows it. Self-Expanding Base plants masts toward what the rules need. |
| Lander | There is only one. |
| The first of any type | See §1, rule 5. |

Orders can place every one of these except the Lander and Relay Masts. Masts become orderable ("Extend network") with Self-Expanding Base.

---

## 4. The research ladder

There are twelve techs. **◉ ROBOTS & FAB** holds the physical families, **▣ SILICON & COMPUTE** the planning techs, and **⚡ POWER** holds Automated Power (coordinator decision). They span Eras 2–7.

- Every tech has a generated pro, a **numeric** con that passes `auditTechs`, a `visual` line, and one visible mesh change, following work/tree's convention.
- **Costs** are the shipped tree's median data cost for each era (coordinator decision; the displayed costs after `ERA_COST_SCALE`, as docs/03 generates them). Goods are small and fixed.
- Median costs keep the techs **charter-neutral**: researching one instead of another tech of its era opens the next era no sooner and no later. A cheap automation tech would otherwise become a charter shortcut.

| # | id · name | Era · lane | Cost | Requires | Pros (generated) | Cons (generated; numeric first) | `visual` |
|---|---|---|---|---|---|---|---|
| 1 | `buildOrders` · **Build Orders** | E2 · ◉ | 240≡ | teleoperation | ORDER BOOK: 4 held orders, up to ×10 each; orders wait for stock instead of skipping; Build next for a whole order | −1 kW: Lander (planning console) · held orders take stock the moment it lands | The Lander raises a planning mast: a lattice pole with a work lamp over its top deck. |
| 2 | `autoExcavation` · **Automated Excavation** | E3 · ◉ | 278≡ + 10⚙ | buildOrders | NEW RULE Excavation: +1 Excavator when regolith demand outruns supply for 60 s (cap 6); Ice Harvester on water at the pole | −1 kW per Robotics Bay (dispatch) · the builder spends your stock unasked (16◆ 4⚙ per Excavator) | Every Robotics Bay grows a dispatch mast: a lattice tower with a beacon on the roof. |
| 3 | `siteSurveyAI` · **Site Survey AI** | E3 · ▣ | 278≡ | buildOrders, prospectingRovers | auto sites weigh the overlay: the feed's deposits, peaks of light for solar, others' ground kept clear, haul lanes never crossed; planned dig sites | +20% upkeep: Robotics Bay (survey drones) | A survey drone rests on a pad on each Robotics Bay roof. |
| 4 | `autoPower` · **Automated Power** | E4 · ⚡ | 456≡ + 20◆ | autoExcavation | NEW RULE Power: +1 Solar Array when the day's margin < 10% (cap 24); +1 Battery Bank at dawn after the bank ran dry (cap 6); reactor rule (cap 1: raise it to let the builder add reactors) | +10% upkeep: Solar Array (combiner boxes) · spends your stock (12◆ per array, 40◆ 8◇ per bank) | Each Solar Array gains a combiner box with a status lamp at its foot. |
| 5 | `budgetGovernor` · **Budget Governor** | E4 · ▣ | 456≡ + 5▣ | autoExcavation | RESERVES and PRIORITIES: floors per resource; queued research goods kept; rules act in your order; crisis sites jump the rover queue | +50% upkeep: Storage Yard (manifest gantries) · rules wait for your floors, so the builder acts later | Storage Yards get a manifest gantry: a scanner bar on two legs spanning the racks. |
| 6 | `autoLifeSupport` · **Automated Life Support** (crew tech) | E4 human · E7 robotic (1294≡) · ◉ | 456≡ + 10⚙ | autoExcavation | NEW RULE Life support: the O₂, food and water makers when a supply's runway falls under 20 min; a Habitat when no bed is free for the next settler | +10% draw: Habitat Module (air monitors) · spends your stock | Each Habitat gets an air-monitor mast by its door. |
| 7 | `autoSmelting` · **Automated Smelting & Refining** | E5 · ◉ | 580≡ + 20⚙ | autoExcavation, siliconRefining | NEW RULE Smelting: Smelters and Refineries when metals or silicon demand (builds included) outruns supply; Storage Yards when a full stock idles its producers | +10% upkeep: Smelter, Refinery (samplers) · spends your stock (32◆ 8⚙ per Smelter) | Smelters and Refineries grow an ore-sampler arm over the hopper. |
| 8 | `feedPlanner` · **Feed Planner** | E5 · ▣ | 580≡ | siteSurveyAI | every excavator (manual or auto, with a per-excavator opt-out) re-aimed at the feed the furnaces want, trading haul distance for grade | +10% draw: Excavator (assay drills) · longer hauls carry less | Excavators carry an assay drill beside the bucket. |
| 9 | `predictiveScheduling` · **Predictive Scheduling** | E6 · ▣ | 1700≡ + 10▣ | autoPower, lunarDataCenter | rules act on forecasts: batteries before dusk, sites under construction counted, dwell halved (needs an operating Data Center) | +10% draw: Data Center · reactive again whenever no Data Center runs | Each Data Center adds a scheduling antenna: a tall whip mast beside its dish. |
| 10 | `autoFabrication` · **Automated Fabrication** | E6 · ◉ | 1700≡ + 10▣ | autoSmelting, partsFabrication | NEW RULE Fabrication: Parts Fabricators on parts demand; Chip Fabs when research waits on chips; Robotics Bays when sites wait for a rover | +20% upkeep: Parts Fabricator (gantry cranes) · spends your stock (a Chip Fab is 48◆ 24◇ 16⚙) | Parts Fabricators get a gantry crane over the roof. |
| 11 | `maintenanceAutomation` · **Maintenance Automation** | E7 · ▣ | 1294≡ + 30⚙ | autoFabrication | parts triage (below); worn machines replaced; tripped overclocks re-armed once healed | +30% upkeep: Robotics Bay · a replacement costs a new build less half the old one's price | Robotics Bays get a service crane arm at the side door. |
| 12 | `selfExpandingBase` · **Self-Expanding Base** | E7 · ◉ | 1294≡ + 10▣ 40⚙ | autoFabrication, siteSurveyAI | NEW RULE Network: Relay Masts at the network edge toward ground a rule needs (cap 4); "Extend network" orders | +30% draw: Relay Mast (beacon crowns) · spends your stock (16◆ 4⚙ and 1.5 kW per mast) | Relay Masts wear a beacon crown and a cable reel at the foot. |

**Per era, as shipped.** The 2× tree left one free ◉ and one free ▣ cell per era (docs/12 §5), so the ladder takes at most one of each per era: ◉ gets Build Orders (E2), Automated Excavation (E3), Automated Life Support (E4 human; E7 robotic, after Human Cohabitation), Automated Smelting & Refining (E5), Automated Fabrication (E6) and Self-Expanding Base (E7); ▣ gets Site Survey AI (E3), Budget Governor (E4), Feed Planner (E5), Predictive Scheduling (E6) and Maintenance Automation (E7). Automated Power is a fourth ⚡ card on the Era 4 page where that lane already held three; every era page still fits 1280×720 (`tests/techtree.spec.ts`). Automated Excavation needs only Build Orders (Construction Robotics would have pulled it behind a crewed-run tech).

**Maintenance Automation in detail.** These are the only three ways the builder ever changes existing buildings. They use the current wear rules; if work/tree adds building aging, replacement switches to aging (coordinator decision).

- **Parts triage.** When parts cannot cover every building's upkeep this tick, economy step 6 pays in `(priority, id)` order. Life support and power are therefore the last to wear. Today the order is `id`, which is arbitrary.
- **Replacement.** A building that has stayed at wear ≥ 40% for a lunar day is replaced. Healing has been losing: parts are short, it runs overclocked, or Regolith Shielding halves repair.
  - The builder places a new building of the same type with intent *like #id*.
  - When the new one completes, step 12 demolishes the old one for the usual ½ refund.
  - Alert: `REPLACED — Chip Fab #12 (WORN 46%) by #40; #12 demolished, ½ refunded`.
  - Only one replacement is in flight at a time, and each goes through the budget.
- **Overclock re-arm.** A building whose overclock tripped at WORN is switched back to overclock once its wear is below 5% and the day margin is at least 20%.

### 4.1 New effect kinds (`TechEffect`), mods and generated lines

| Kind | Mods | Pro line | Con line (the audit unit) |
|---|---|---|---|
| `{ kind: 'orders'; book: 4; maxCount: 10 }` | `orderBook`, `orderMax` (defaults 0 and 3) | `NEW ORDER BOOK: 4 held orders, up to ×10 each — orders wait for stock instead of skipping` | `held orders take stock the moment it lands` (use) |
| `{ kind: 'autoRule'; family }` | `autoFamilies: Set<AutoFamily>` | `NEW RULE <Family>: <each rule's objective and default trigger, cap>` | `the builder spends your stock unasked: <the main building's site-scaled cost>` (use) |
| `{ kind: 'siting'; survey: true }` | `siteSurvey` (default false: the distance-only base chooser) | `auto sites weigh deposits, peaks of light and haul lanes` | — (its con is a separate `upkeepMult`) |
| `{ kind: 'governor' }` | `governor` | `RESERVES and PRIORITIES: …` | `rules wait for your floors — the builder acts later` (flag) |
| `{ kind: 'predictive' }` | `predictive` | `rules act on forecasts: …` | `reactive again whenever no Data Center runs` (flag) |
| `{ kind: 'feedPlanner' }` | `feedPlanner` | `excavators re-aimed at the feed the furnaces want` | `longer hauls carry less` (flag) |
| `{ kind: 'maintenance'; wear: 0.4 }` | `maintenanceWear` (0 = off) | `parts triage · worn machines replaced · overclocks re-armed` | `a replacement costs a new build less half the old one's price` (use) |

Each tech's numeric con uses an existing kind: `powerDelta`, `upkeepMult` or `powerMult`. All of them have |m − 1| ≥ 0.05 or at least 1 kW, so the audit rule holds without adding a new unit. `techRelevance` treats the new kinds as follows:

- `autoRule` is relevant where any building of that family can be placed at the site. At mare, the Excavation family is relevant through the excavator even though the ice harvester can't be built.
- `orders`, `siting`, `governor`, `predictive` and `maintenance` are always relevant.
- `feedPlanner` is relevant wherever `DEPOSIT_PLAN` holds a feed deposit, which is true at all three sites.

### 4.2 Mesh changes (`buildings/recipes.ts`)

Each `visual` line maps to one recipe part, gated on the tech in `techsDone` by whatever mechanism work/tree establishes. For example, a `TECH_PARTS` table of `{ tech, building, parts }`, with instances rebuilt when a tech completes. The parts reuse `meshKit` primitives only: `lattice`, `antenna`, `box`, `cyl`, `bar`, `LAMP` and `BEACON`.

**Size and art direction.** Every part must be at least 1 m tall or wide, so it reads from the build camera's home distance. The parts stay monochrome ([06](06-art-direction.md)): state is carried by a lamp, never a hue.

**Test.** `recipeTriangles()`, with and without each tech, differs for the building named in its `visual` line.

---

## 5. UI

### 5.1 The Builder panel ([B], or `Builder ▸` in the robots panel)

It opens in `#hud-left`, where resource panels open, as the panel key `builder`, so only one panel is open at a time. Its component is `src/ui/builderPanel.ts`, not the resource-panel body.

It follows the rule from [07](07-ui-design.md) §11: its structure is rebuilt only when its **signature** changes (rules unlocked or on/off, thresholds, caps, order ids, reserve keys). Status text is updated in place with `setText`, so a click is never lost under a running 10× sim.

```
BUILDER                                                 [B] ✕
It builds what you would, near where it's needed, at your price.
1 auto site pending · spends to the reserve · Governor ON

ORDERS                                              (Build Orders)
  Excavator ×3 · 2 placed · waiting: 16◆ (have 9)     [Build next] [✕]

RULES                                          ⇅ order (Governor)
 [●] KEEP regolith supply ≥ demand → Excavator     T [−] −6/min [+]  cap [−] 6 [+]
     watching · regolith 18▲/min short for 42 s of 60 · last: Excavator #7 12:40
 [●] KEEP the day's grid margin ≥ 10% → Solar Array   T [−] 10% [+]  cap [−] 24 [+]
     ok · margin +18%
 [○] CARRY the night → Battery Bank
     locked — Battery Banks
 …
RESERVES (Governor)     ◆ [120]  ◇ [40]  ⚙ [60]  ▣ [10]
LOG   12:40 Excavator #7 · Excavation · on high-Ti basalt, 38 m from Smelter #3 …
```

**Status lines** follow the brief's shape (state · signal for how long → what it is doing), with rates per minute as everywhere else in the UI:

| State | Line |
|---|---|
| ok | `ok · regolith supply 12▲/min over demand` |
| watching | `watching · regolith 18▲/min short for 42 s of 60` |
| building | `→ building Excavator #7 · 38%`, or `→ Excavator #7 queued for a rover` |
| settling | `settling 0:40 — letting the rates catch up` |
| waiting | `waiting · needs 16◆ above the 40◆ reserve (have 44)`, or `waiting for power · Solar Array #31 first` |
| holding | `holding · 2 of 5 Excavators dark (power) — more would not help` |
| capped | `cap 6/6 Excavators — raise the cap to let it build more` |
| nosite | `no valid ground for a Solar Array inside the build network (of 412 open pads: 229 too rough, 150 on roads, 33 no road route) — a Relay Mast or Habitat extends it` (§2.3) |
| vetoed | `you cancelled Excavator #9 — resumes in 11:20` |
| founded? | `found the first Battery Bank yourself — the builder extends what you found` |
| locked / off | `locked — Battery Banks` / `off` |

The panel shows how long `watching` has run as `for 42 s of 60`. The brief's example ("watching · net −0.3▲/s for 42 s → building Excavator #7") is the two lines above it in sequence: the watching line, then the building line.

**Actions:**

- `setRule { rule, on?, threshold?, cap? }`
- `cancelOrder { id }`
- `orderNext { id }`
- `setReserve { res, amount }`
- `moveFamily { family, delta }`
- `setFeedPlan { id, on }` (Feed Planner's per-excavator opt-out)

### 5.2 Resource panels

Each resource panel gains a **BUILDER** section, built outside the re-rendered body so a click is never eaten:

- the **order** controls for its producers (§2.1);
- the rules whose signal is this resource: an on/off toggle, the status line, and `Builder ▸`.

Thresholds and caps are edited only in the Builder panel. Where the section appears:

- **Regolith:** the Excavation rule.
- **Metals, silicon:** the Smelting rules.
- **Parts, chips:** the Fabrication rules.
- **O₂, food, water:** the Life support rules.
- **Power panel:** the solar, battery and reactor rules, with the day margin and night cover as numbers.
- **Crew panel:** the habitat rule.
- **Robots panel:** the Robotics Bay rule and `Builder ▸`.

The resource panel's header also gains a demand line that shows the flow book (§3.1): `made 112▲/min · wanted 130▲/min`. This is the number the Excavation rule reads, shown where the player already looks.

### 5.3 The inspector

- **Head.** `#7 · AUTO` beside the id, for every building placed by an order or a rule. Completed buildings keep the tag.
- **Body.**
  - `AUTO · Excavation rule · 12:40 — nearest free pad to Smelter #3 · 18 m` (with Site Survey AI: `— on high-Ti basalt, 38 m haul to Smelter #3`), or `AUTO · your order #3 (2 of 3)`;
  - before Site Survey AI, one quiet line under the reason: `sites by distance only — Site Survey AI weighs deposits and haul lanes`. It states what the chooser does, and never calls the site wrong;
  - for a replacement: `replaces Chip Fab #12 (WORN 46%)`.
- **Foot.**
  - The existing **Cancel ↩** (a full refund while no rover has welded on it; this is also the veto, §3.2) and **Demolish ½↩**.
  - A rule's site adds **Pause rule**.
  - Completed buildings of an orderable type add **＋ Build another**.

### 5.4 Alerts

The builder speaks through the existing stack.

- **Acts** are events: repeats merge ×N, and clicking one selects the building.
- **Refusals** are conditions: they are re-raised each tick while they hold and clear themselves when they stop.
- Refusals are raised only after they have **persisted for 60 s**, so a rule that waits one tick for a bucket of regolith says nothing.
- Power and life-support refusals are `warn`; every other refusal is `info`. Clicking a refusal opens the Builder panel, `{ panel: 'builder' }`.

| When | Text | Kind |
|---|---|---|
| a rule places | `AUTO — Excavator #7 placed, nearest free pad to Smelter #3 · 18 m · regolith 18▲/min short` (with Site Survey AI: `on high-Ti basalt, 38 m from Smelter #3`) | info · select |
| an order resolves | `ORDER — 2 Excavators placed (…) · 1 skipped: needs 16◆, have 9` | info, or warn if anything was skipped |
| a held order waits | `ORDER WAITING — Excavator 3 of 3 needs 16◆ (have 9)` | condition · info |
| a rule holds | `AUTO HOLD — Power: a Smelter's 12 kW would brown the grid out` | condition · warn |
| a rule waits for budget | `AUTO WAITING — Life support: Hydroponics needs 20◆ above the reserve (have 12)` | condition · warn |
| no site | `AUTO NO SITE — Power: no valid ground for a Solar Array inside the build network (of 412 open pads: …) — a Relay Mast or Habitat extends it` | condition · warn for Power and Life support, else info |
| cap reached | `AUTO CAP — 6/6 Excavators: the Excavation rule stops here · raise the cap in [B]` | event · info, once |
| veto | `AUTO SITE CANCELLED — the Excavation rule leaves that ground alone for a lunar day` | event · info |
| replacement | `REPLACED — Chip Fab #12 (WORN 46%) by #40; #12 demolished, ½ refunded` | event · info |
| tech done | `BUILDER — the Excavation rule is on: … · [B] to tune` | event · info |

**The discovery card** (main's `src/ui/discovery.ts`) shows every finished tech with a **Next** line from `nextStep(effects)`. That function returns the line for the first effect that asks something of the player. Two consequences for the ladder:

- `nextStep` gains a case for each new kind, below.
- Each automation tech lists its new-kind effect **first** in `effects`, ahead of its `powerDelta` or `upkeepMult` con, so the card never falls through to "It takes effect at once".

| Kind | Next line |
|---|---|
| `autoRule` excavation | `The Builder now keeps regolith supplied: tune it with [B].` |
| `autoRule` power | `The Builder now keeps the day's grid margin and the night covered: tune it with [B].` |
| `autoRule` smelting | `The Builder now keeps metals and silicon supplied, and adds yards when stock tops out: tune it with [B].` |
| `autoRule` fabrication | `The Builder now keeps parts and chips coming, and adds Robotics Bays when sites wait: tune it with [B].` |
| `autoRule` life | `The Builder now keeps oxygen, food and water ahead of the crew, and a bed free: tune it with [B].` |
| `autoRule` network | `The Builder now plants Relay Masts toward ground its rules need: tune it with [B].` |
| `orders` | `Order more than you can afford: the Builder places the rest as stock arrives. Open the order book with [B].` |
| `siting` | `Orders and rules now weigh deposits, peaks of light and haul lanes when they pick a site.` |
| `governor` | `Set reserve floors and the order rules act in: [B].` |
| `predictive` | `While a Data Center runs, rules act on forecasts: batteries before dusk.` |
| `feedPlanner` | `Excavators now re-aim at the feed the furnaces want; opt one out in its panel.` |
| `maintenance` | `Short of parts, upkeep now goes to priority 0 first, and worn machines are replaced: see the log in [B].` |

**Feedback.** The price floats up from each auto site, as it does for a click, so the spending is seen. The placement cue plays 6 dB quieter for auto sites and is rate-limited to one every 2 real seconds.

### 5.5 In the world

`$autoMarkers` puts an **AUTO** tag in DOM over each pending auto site, using the same mechanism as `$wearMarkers`. Clicking a tag selects the site. Tags are hidden in walk mode.

### 5.6 Controls and docs

**Menu `CONTROLS`** gains:

- `['B', 'Builder — orders and standing rules']`
- `['Ctrl-click a card', 'order one: the rovers choose the site (⇧ ×3)']`
- `['Enter while placing', 'let the rovers choose the site']`

**[07-ui-design.md](07-ui-design.md) updates:**

- §4 contextual elements: the Builder panel, the resource-panel BUILDER section, and AUTO tags.
- §4 inspector paragraph: the AUTO tag, Pause rule, Build another.
- §5 tooltip: the Ctrl-click line.
- §12: the controls list.

**[08-architecture.md](08-architecture.md) updates:**

- the module map (`automation.ts`, `siting.ts`, `builderPanel.ts`, `data/automation.ts`);
- the tick table (step 12);
- the actions list;
- the save format;
- the debug API.

**[03-tech-tree.md](03-tech-tree.md)**: regenerate it (`scripts/gen-tech-doc.mjs`) and add rows for the new verbs (orders, rules).

**[02-economy.md](02-economy.md)**: add a short "Construction automation" paragraph under *Resource loops*.

---

## 6. Sim integration

### 6.1 Modules

| File | Work |
|---|---|
| `src/data/automation.ts` (new) | `AutoFamily`, `AutoRuleId`, the `RULES` table (§3.4: building, signal, T, H, dwell, cooldown, settle, cap, range, units, objective text), and the default family priority |
| `src/core/automation.ts` (new, pure) | the flow-book helpers, the signals, `automationTick`, the budget, order-book filling, `recordAuto` (writes a placement or refusal back to rule state), and `automationView` (the `$automation` payload) |
| `src/core/siting.ts` (new, pure over `Ground`) | `chooseSite`, the occupancy and haul-lane raster, and the dry-run `planSite` for tests |
| `src/core/economy.ts` | flow-book capture in steps 2.5, 4, 5, 6 and 8.7; `power.supplyFull` and `power.construction`; `stats.nightBankEmpty`; parts triage (Maintenance); **step 12**; `nightForecast` shared with the dusk alert |
| `src/core/game.ts` | `econStep()`, shared by the live loop and `debugAdvance` (§6.2); the `order` action; `commitPlace(…, auto?)` tags the building and records spend; cancel and demolish vetoes; Enter-to-order; the [B] key |
| `src/core/state.ts`, `src/core/actions.ts`, `src/core/mods.ts`, `src/data/techs.ts` | the state fields (§6.4), actions, effect kinds and mods (§4.1), and the 12 techs |
| `src/ui/builderPanel.ts` (new), `infoPanel.ts`, `palette.ts`, `hud.ts`, `menu.ts`, `stores.ts` | §5; the new stores are `$automation` and `$autoMarkers` |
| `src/ui/discovery.ts` (main) | `nextStep()` cases for the new effect kinds (§5.4) |
| `src/buildings/recipes.ts` | §4.2 |
| `src/debug.ts` | `order(type, count, intent?)`, `cancelOrder`, `setRule(rule, patch)`, `setReserve`, `getAutomation()`, `planSite(type, intent?)` (a dry run: the best 5 candidates with scores and `why`, no state change), `autoLog()` |

### 6.2 Where it runs in the tick

| Step | The builder's part |
|---|---|
| 0 · rovers | `backlog`: sites waiting for a rover. With the Governor, a crisis auto site is given Build next. |
| 1–2 · power | records `power.supplyFull = supply − solarNow + solarFull × site.solarDayMult` and `power.construction` (the construction kW drawn) |
| 2.5 · construction | weld parts go into `want(parts)`. A completed auto site sets its rule to `settling` in step 12, which reads `construction === 0`. |
| 4 · production | inputs of eligible buildings go into `want`; outputs credited go into `made`. Excavators count by cycle average, as `s.rates` does with fleet. |
| 5 · life support | the crew's O₂, food and water go into `want`; `freeBeds` |
| 6 · upkeep | upkeep goes into `want(parts)`; parts triage runs in `(priority, id)` order when Maintenance Automation is done; `worn(b)` timers |
| 6.5 · rates | the flow book's EMAs are updated alongside `s.rates` |
| 8.7 · exploration | continuous outpost and hopper flows go into `made` or `want` |
| 9 · research | `researchStalled` goods are what the reserve reads |
| 10 · night | `stats.nightBankEmpty` is latched and becomes `bankRanDry` at dawn |
| 11 · charters, milestones | unchanged |
| **12 · automation** (new, last) | `automationTick(s, site, mods, day, dt)`. It settles rule states (completions, cancellations), finishes Maintenance replacements (demolishing the old building), fills held orders, and evaluates the rules in priority order. It returns up to 2 **requests** in `EconEvents.build`. |
| `Game.econStep` | right after `economyTick` returns, and before `syncDeposits`, so an auto site on hidden ground strikes it in this same tick. For each request: `chooseSite` → recheck the budget → `commitPlace(type, gx, gz, rot, false, auto)` → `recordAuto` → alert. Then `modsFor` if a tech completed. |

**Lump spending** (`spend`) is recorded where it happens:

- `commitPlace`, for both manual and auto placements;
- research goods in `researchTick`;
- `claimOutpost`;
- `startSurvey`.

**Rules come after the rest of the tick.** Step 12 sees the whole tick: power, production, life support, research stalls, the era. A site it places enters the rover queue in the next tick's step 0. A tech completed this tick unlocks its family from the next tick on, after `modsFor` runs in `econStep`.

**Performance.** `chooseSite` builds its raster once per call. It is called at most twice per tick, plus once per order site. Its candidate count is bounded by the network area (about 700 cells per node). At 20 network nodes and 150 buildings a call takes a few milliseconds. The road reach is one flood of the map (65 536 cells), memoised until the network or the buildings change. On the pole with 440 road cells round the Lander, a pick past them takes about 25 ms (the flood included). With every pad on a road, the refusal takes about 3 ms.

### 6.3 Determinism

**The same seed and the same player actions give the same auto sites.**

- Auto sites are a pure function of three things:
  - the state;
  - the terrain, which regenerates from `(siteId, seed)` with the flatten history replayed;
  - the mods.
- The design keeps it that way:
  - **No randomness at all**: no `Math.random`, no seeded draws, no wall clock.
  - The live loop and `debugAdvance` call the same `econStep`, once per economy tick, so frame timing cannot change the order.
  - Candidates are iterated in a fixed order (network nodes in building order, cells row-major, rotation 0 then 1). Ties break on (score, gz, gx, rot).
  - Rules run in family-priority order.
- **Caveat.** Solar shading (`b.shaded`) is renderer-side, and the live loop updates it every 0.5 real seconds. The power numbers therefore already depend on frame rate in live play. They do not under `debugAdvance`, which updates shading every 5 game-seconds.
- **Consequences:**
  - The chooser never reads shade.
  - The determinism test runs under `debugAdvance`, as every sim test does.

### 6.4 State, save format and migration

```ts
// GameState
auto: AutoState;
flowBook: Partial<Record<ResourceId, { made: number; want: number; spend: number }>>;  // EMAs, per s
power: { …; supplyFull: number; construction: number };
stats: { …; nightBankEmpty: boolean };

// BuildingState
auto?: {
  by: 'order' | 'rule';
  rule?: AutoRuleId;
  order?: number;
  at: number;                 // game time placed
  why: string;
  dig?: { x: number; z: number };   // planned dig site, applied on completion (fleet)
  replaces?: number;          // Maintenance: the worn building it replaces
};

interface AutoState {
  schema: 1;
  rules: Partial<Record<AutoRuleId, RuleState>>;
  orders: AutoOrder[];
  nextOrderId: number;
  reserve: Partial<Record<ResourceId, number>>;   // the Governor's floors
  priority: AutoFamily[];                         // the Governor's order
  vetoes: { rule: AutoRuleId; gx0: number; gz0: number; gx1: number; gz1: number; until: number }[];
  log: { at: number; text: string; id?: number }[];   // the last 8, for the panel
}
interface RuleState {
  on: boolean;
  threshold: number;          // in the signal's own unit (per s, fraction, s, count)
  cap: number;
  phase: RulePhase;
  dwell: number;
  site: number | null;        // pending auto site
  nextAt: number;             // cooldown, settle or veto end (game time)
  night?: boolean;            // battery: the bank ran dry last night, act at dawn
  built: number;              // lifetime count
}
interface AutoOrder {
  id: number;
  type: BuildingId;
  count: number;
  placed: number[];
  intent: { res?: ResourceId; like?: number };
  at: number;
}
```

**Migration** lives in `fillStateDefaults` and never overwrites:

- `s.auto ??= defaultAuto()`. The rules map is merged by id, so rules added in a later version get their defaults.
- Every rule of a family whose tech is not done stays `on: false`.
- **A loaded save never switches a rule on by itself.** Rules switch on only when their tech completes in play.
- `s.flowBook ??= {}`. The book rebuilds in about 60 s, and until then rules read `ok`, because a missing entry never triggers.
- `power.supplyFull` and `power.construction` are refilled by the first tick. `stats.nightBankEmpty ??= false`.
- `b.auto` is optional, and old buildings simply have none.
- `state.version` stays **1**, because `save.ts` accepts only 1.
- The 12 techs are new ids with no renames, so this spec needs no `techSchema` bump. If work/tree bumps it for its own reasons, these ids ride along.

### 6.5 Coordination

| With | What this spec needs from it |
|---|---|
| **work/fleet** | `assignRovers` and the rover queue (auto sites are ordinary sites); `crewKW` for `power.construction`; `tripFor`, `dropFor` and `plan` for Site Survey AI; `setDigSite` and `digRefusal` for planned dig sites and Feed Planner; the haul legs for the lane raster; the cycle-average excavator output for `made`. **If fleet does not land**: Site Survey AI uses straight-line distance, and Feed Planner is cut. |
| **work/tree** | the `visual` field and the tech-gated recipe-part mechanism; each era's median cost; lane occupancy (§4, per-era note); `techSchema` if it bumps. The 12 techs are added **after** the tree merges, in its format. |
| **work/classic**, **work/lights** | The AUTO markers are DOM, and the mesh parts use `meshKit` materials, so both render styles pick them up. The beacon parts use `LAMP` and `BEACON` and join the lights branch's per-structure darkness like any other lamp. |
| **main** (discovery pop-ups, era explainers) | The `BUILDER — the … rule is on` alert is also a discovery moment. If main's pop-up system has a "new verb" template, the first rule of each family uses it. |
| **work/avoid** (roads, unit movement) | Every Builder placement dispatches the player's own `place` action (with a `builder` flag: crew choice, no CANNOT BUILD alert), so a placement's road spur applies to auto sites unchanged. A site the action refuses — "no road route" or anything else — is skipped and the chooser offers the next best, up to `AUTO.placeTries` (6). The Builder never touches `paths.ts`, `haul.ts`, `rovers.ts` or `haulers.ts`; it calls `tripFor`, `setDigSite`, `digRefusal` and `plan` as they stand. |

---

## 7. Tests: `tests/automation.spec.ts`

Run with `PWTEST_CACHE_DIR=$SP/pwcache-auto PORT=5471`. Every test uses `?debug&seed=42&nolock&lowfx`, pauses the game, and drives time only with `advanceGameSeconds`, as `research.spec.ts` does.

| # | Test | Assertions |
|---|---|---|
| 1 | **One-shot order from the UI** (robotic mare, start) | Click the ▲ chip, then `+3` on the Excavator row: 3 sites with `auto.by === 'order'`; metals −48 and parts −12 exactly; every site in the network; the sites are `planSite`'s top 3 by distance to the Lander (the anchor while there is no consumer), whatever deposits lie there; one `ORDER —` alert; the inspector head reads `AUTO`. |
| 2 | **Order skip** | With metals for 1 excavator, `order('excavator', 3)` places 1. The alert matches `/1 placed.*2 skipped: needs 16◆, have \d+/`, and nothing else is deducted. |
| 3 | **Order refusals** | A locked refinery, an ice harvester at mare, the Lander, a relay mast: each raises `ORDER REFUSED` with its reason, and the state is unchanged. |
| 4 | **Held orders** (after `buildOrders`) | Order ×3 with metals for 1: the book shows 1/3. After `grantResources` and 3 ticks, 3/3. Cancel removes the rest; a 5th open order refuses `ORDER BOOK FULL`. |
| 5 | **Siting validity** (property test, all 3 sites) | Across 40 auto placements from mixed orders and rules, each site passes `canPlace` on the pre-placement state (checked through `planSite`), lies in the network, never covers a door apron, is never a habitat on KREEP, is an ice harvester only on ice, and never crosses a haul lane with Site Survey AI. |
| 6 | **Distance only, then Site Survey AI** | Without Site Survey AI, on mare with revealed ilmenite 30 m from the Smelter, an auto excavator takes the nearest free pad to the Smelter. Its `why` reads `nearest free pad to Smelter #… · … m`, and the inspector shows the distance-only line. With Site Survey AI: the next one lands on ilmenite (`why` names it); at the pole an auto solar array is on a ridge when one is in the network; no site crosses a haul lane. An ice harvester is on revealed ice under both choosers (placement's rule). |
| 7 | **The Excavation rule** (robotic mare) | Completing `autoExcavation` switches the rule on at once, with cap 6. With 2 smelters and 1 excavator: after dwell + ≤ 5 s, one AUTO excavator site. While it is pending there is no second site, although the deficit persists. After completion + settle, another if still short. It stops at the cap with one `AUTO CAP`. The status line matches `/watching · regolith \d+▲\/min short for \d+ s of 60/`. |
| 8 | **Hysteresis and cooldown** | Toggle a smelter every 30 s so the balance crosses T back and forth: no placement in 5 min, and the dwell never exceeds 60. Force a placement, then keep the deficit: the next one waits `cooldownS` and settle. |
| 9 | **Capacity, not trouble** | Brown the grid out at night (excavators dark): the rule is `holding` with `dark (power)`, and nothing is placed through the night. |
| 10 | **The first of a type** | With `autoPower` and batteries unlocked but none built, and the bank running dry: no battery, and the status reads `found the first Battery Bank yourself`. Place one by hand: the next dawn adds one. |
| 11 | **Reserve and weld debt** | Metals = 2 × cost − 1: `waiting · needs`. Grant 1: it places. With 3 sites mid-weld and parts at weld debt + 20 + cost − 1: waiting. No `CONSTRUCTION STALLED` in the whole run. |
| 12 | **Budget Governor** | A floor of 200◆ holds every rule under 200 + cost. A stalled tech's 40◇ is never spent. A higher-priority rule that is waiting blocks a lower one's spending on the same resource. Reordering priority flips which fires first in a shared tick. |
| 13 | **Power rules** | Day margin 5% for 30 s → solar. A night with the bank at 0 and shedding → one battery at dawn (never at night). With `predictiveScheduling` and an active DC, forecast cover < 100% → a battery ordered by day, completing before dusk. Without an active DC, the status reads `reactive`. |
| 14 | **Prerequisite requests** | With the Smelting and Power families on and headroom < 12 kW: the solar rule fires first (no dwell), and the smelter follows in a later tick. With Power off, the smelter holds with the brownout reason. |
| 15 | **Life support** (human mare) | O₂ runway < 20 min → a smelter (the O₂ producer) placed ahead of an excavation rule firing in the same tick. With no free hands and no Construction Robotics: holds `no free hands`. With it: placed Autonomous. |
| 16 | **Cancel veto** | Cancel an auto site: full refund, `AUTO SITE CANCELLED`, the rule `vetoed`. Nothing is placed on that footprint for 720 s. Demolishing a manual excavator also defers the rule 720 s. |
| 17 | **Determinism** | Two fresh page loads, same seed and scripted actions, 30 game-min with the Excavation, Power and Smelting rules on: identical `(type, gx, gz, rot)` lists. Seed 7 differs. Without Site Survey AI, every rule site equals a brute-force nearest-valid-pad search from its anchor (distance, then the relief and (gz, gx, rot) tie-breaks). Re-running the same 30 minutes from a save gives the same list. |
| 18 | **Save and load** | Rules (on, threshold, cap), the order book, pending `b.auto` and vetoes survive `save()` and a reload. A legacy blob with no `auto` or `flowBook` loads with every rule off and no console errors. |
| 19 | **Builder panel** | [B] opens `#builder-panel`. The toggle, threshold and cap steppers dispatch `setRule`, and the state follows. At 10× for 20 s the rule buttons keep their DOM nodes (no rebuild per tick), and a click during it lands. |
| 20 | **Techs** | `auditTechs()`: each of the 12 has ≥ 1 pro and ≥ 1 numeric con (mult ≥ 0.05, kW ≥ 1, or use). `techRelevanceMatrix()` is true wherever the tech is visible. Each has a non-empty `visual`. Its mesh part changes `recipeTriangles()` for its building. `autoLifeSupport` is `crewLocked` on robotic runs until Cohabitation. |
| 21 | **Maintenance** | With parts short, priority-0 buildings keep wear 0 while priority-3 ones wear. A chip fab held at wear 0.5 for 720 s gets a replacement placed; when the new one completes, the old one is gone with a ½ refund and `REPLACED`. |
| 22 | **Self-Expanding Base** | Fill the network so the Excavation rule is `nosite` for 60 s: a mast is placed at the edge toward the target, and after it completes the excavator follows. |
| 23 | **No silent failures** | Loop over every refusal path (§2.2 and §3.2): each raises an alert or shows a status line with its reason. |
| 24 | **Flow book** | Mare, 2 smelters and 1 excavator for 120 s: `flowBook.regolith.want` ≈ 4.0/s ± 3%, and `made` within 5% of that excavator's delivered cycle rate (1.875/s on its own pad without fleet hauls), while `s.rates.regolith` is within ±0.1 of 0. This is the case the flow book exists for. |
| 25 | **Discovery card** | For each of the 12 techs, `completeTech` puts a discovery card up whose **Next** line is its §5.4 line, never `It takes effect at once`. The reactor rule is on with cap 1, and with one reactor built it reads `capped`. |
| 26 | **Siting on rough pole ground** (crewed pole, seed 1234) | At landing the Lander's own ground is rough: an order walks out and its `why` ends `· a N-cell road to it`, and once built it is served and linked. Then every pad within 14 cells of the Lander is put on a road (a crafted save): `planSite('solar')` still finds a pad past them (the old 200-pad window refused), and the solar rule places there, served and linked. |
| 27 | **No ground a road can serve** (crewed pole, seed 1234) | Every pad in the network on a road: the refusal reads `(of N open pads: … on roads …)`, the solar rule is `nosite` with that line, it stays `nosite` at every sample the margin cannot be read, `AUTO NO SITE — Power:` is a `warn`, and the [B] row shows the line. |

---

## 8. Pacing impact

### 8.1 What automation should do to FIRST LIGHT

work/tree's 2× target is **FIRST LIGHT at about 210 game-min on robotic mare**. That target is calibrated on the pacing probe's *reasonable* bot, which already behaves like an automation system: it decides every 20 game-s, knows the power model, and builds by need.

Automation therefore **must not buy game time for that bot**. Its game-time benefit goes to players slower than the bot, and its main benefit is **real** time.

| Player | Automation's effect on FIRST LIGHT (game-min) | Why |
|---|---|---|
| Probe, *reasonable* or *attentive* | −5% to +8% | The automation techs cost research. The rules react about as fast as the bot. A result below −5% means the rules are too strong or too cheap: raise dwell or cost. A result above +8% means the techs cost more than they return: lower the E2–E4 costs. |
| Probe, *distracted* (new, §8.3) | expected: about +25% or more manual, about +12% or less with automation, relative to reasonable-manual. **Measured and reported, not a gate.** | This measures the gap a slow human leaves, and how much of it automation closes. |
| A human | toward the target, and in less real time | Deficits are caught 60 s after they start, not when the player notices them. From Era 5 the decision load halves, so 3× stops being frantic and 10× becomes usable in stretches. |

### 8.2 What the build log says

This is the probe's action log on the current tree (`probe-pacing.mjs`, seed 42, before the tree grows). It counts every placement the bot made before FIRST LIGHT, by the family that would automate it.

| Run | FIRST LIGHT | Placements | Power | Excavation | Smelting | Fabrication | Life | Manual-only (labs, DCs, export, Rec) |
|---|---|---|---|---|---|---|---|---|
| robotic mare · reasonable | 105.9 | 110 | 72 (65%) | 5 | 8 | 6 | 2 | 17 |
| robotic mare · attentive | 98.1 | 142 | 99 (70%) | 4 | 10 | 9 | 2 | 18 |
| robotic pole · reasonable | 102.3 | 101 | 61 | 7 | 8 | 6 | 2 | 17 |
| robotic lava · reasonable | 123.9 | 121 | 81 | 5 | 9 | 7 | 2 | 17 |
| human mare · reasonable | 109.9 | 99 | 62 | 3 | 6 | 6 | 5 | 17 |

On robotic mare (reasonable), 79 of the 110 placements come from Era 4 on, and 56 of those are power.

**What the log means for the ladder:**

- **Automated Power is the big attention saver.** Solar Arrays and Battery Banks are two-thirds of all placements. They come from Era 4 on, where Automated Power sits.
- **Automated Excavation is about 5% of placements, but it is the most consequential early rule.** A starved furnace stalls the metals that everything costs. That is why it comes first (Era 3), and it matches the user's example.
- **About 15% of placements stay manual by design**: labs, Data Centers and the export chain (§3.5).
- **Scaling to the 2× tree.** If placements grow 1.6–2× (about 180–220 on robotic mare), the rules can take roughly 75–80% of them from Era 4 on.

### 8.3 What the honest probe should model (`scripts/probe-pacing.mjs`)

The probe is honest when it plays like a human with these tools: it pays for what it uses, reads only what the UI shows, and never tunes per seed.

1. **`--auto=on|off`**. The default is `off`, which keeps the old baselines comparable.
2. **With `--auto=on`, the bot researches the automation techs a human would take.** They go into its order ahead of the optional techs of their era, never ahead of the critical path:
   - Build Orders, after Parts Fabrication;
   - Automated Excavation and Site Survey AI, in Era 3;
   - Automated Power and Budget Governor, in Era 4;
   - Predictive Scheduling (after the Lunar Data Center) and Automated Smelting & Refining, in Era 5;
   - Automated Fabrication, in Era 6.

   It pays their data and goods like any other tech, and they count toward charters.
3. **No double building.** Once a family's rule is on, `decideBuilds` skips the bot's own branch for that family. The bot still founds the first of each type and places the manual-only buildings.
4. **No tuning.** Rules run with the panel defaults, except one documented setting per policy: *attentive* sets the power margin to 15%. When an `AUTO CAP` alert fires, the bot raises that cap by a fixed step (+3; +8 for solar), as a player reading the alert would. The bot never tunes per seed. It reads `getAutomation()` only for what the panel shows.
5. **A new *distracted* policy, for measurement only.** It decides every 120 game-s, makes at most 1 placement per decision, keeps no reserve logic, and reacts only to warn and crit alerts. It models a human at 10× who glances at the HUD. Run it with `--auto` on and off and report the results; the acceptance gate does not use it (coordinator decision).
6. **New metrics:**
   - data and goods spent on automation techs;
   - auto placements by family;
   - refusals by reason (count and seconds);
   - cancelled auto sites;
   - `min(stock − reserve)`;
   - **player decisions per game-minute, by era** (the attention metric);
   - brownout %, goods-stall minutes, era durations.
7. **Acceptance** (robotic, 3 sites, seeds 42, 7 and 1234, medians). It gates on the *reasonable* and *attentive* policies only:
   - reasonable-auto FIRST LIGHT is within −5% / +8% of reasonable-manual, and the same for attentive;
   - from Era 4 on, the bot's placements per game-minute fall by ≥ 60% with `--auto`;
   - brownout % and goods-stall minutes are no worse than manual + 2 points;
   - no auto site fails validity, and the builder never cancels its own site;
   - `min(stock − reserve) ≥ 0` for every rule placement;
   - no auto-caused `CONSTRUCTION STALLED`.
8. **Levers, in this order:**
   - costs of the E2–E4 core (Build Orders, Automated Excavation, Automated Power);
   - the dwell and cooldown defaults;
   - the default caps.

   Never `ERA_COST_SCALE`: the tree's calibration belongs to the tree.

### 8.4 When the player gains time

**Game time stays near-neutral for an optimal player. The gain is real time.**

**The model: the speed a player can sustain.** A player can sustain the game speed at which decisions arrive no faster than they can make them. This model assumes a comfortable pace of 4 decisions per real minute (one every 15 s). Then:

> sustainable speed = 4 ÷ decisions per game-minute

**The decision rate, from the probe log** (robotic mare, reasonable, seed 42):

- 167 decisions over 104 game-min: 1.6 per game-minute overall.
- Eras 1–3 run at 1.25 per game-minute, and Era 4 on at **1.8**.
- From Era 5 on, 34 of 93 decisions are not placements (research, surveys, claims, crew, the launch). That is 0.66 per game-minute.
- The rest are placements. Manual play at 3× in Era 5+ therefore means one decision every 11 real seconds: faster than the comfortable pace, so a human falls behind and deficits go unanswered.

**With automation.**

- With the four core families on by Era 5 (excavation, power, smelting, fabrication), the placements left from Era 5 on are the manual-only ones and the firsts of their type: 14 of 59.
- That leaves about **0.9 decisions per game-minute**, half the manual load.

**The projection for the 2× tree** on robotic mare, with eras of roughly 24 / 26 / 28 / 28 / 29 / 24 / 29 / 22 game-min. It assumes the 2× tree scales game time and decisions together, so the per-minute rates hold.

| Stretch | Game-min | Decisions per game-min: manual → automated | Sustainable speed: manual → automated | Real minutes: manual → automated |
|---|---|---|---|---|
| E1–E4 | ≈ 106 | 1.25 → ≈ 1.1 (Power arrives mid-E4) | 3.2× → 3.6× | ≈ 33 → ≈ 29 |
| E5–E8 | ≈ 104 | 1.8 → ≈ 0.9 | 2.2× → 4.4× | ≈ 47 → **≈ 24** |
| Whole run | 210 | | | ≈ 80 → **≈ 53, about a third less** |

**When the gains arrive:**

- **E2–E3:** little. Orders save clicks, not minutes, and the Excavation rule covers a handful of builds. Its value is that it catches a starved furnace a human would miss.
- **From E4:** most of the gain. Automated Power takes the solar and battery treadmill, and the Budget Governor makes it safe to leave alone.
- **E5–E6:** the rest. Industry scale-up and Predictive Scheduling mean nights need no babysitting.

**These are projections from the probe's decision rate, not measurements.** The attention metric in §8.3 measures them in Phase B.

---

## 9. Decisions on the Phase A questions

The coordinator settled these after Phase A. The rest of this document already follows them.

| # | Question | Decision |
|---|---|---|
| 1 | Orders before research | Keep free one-shot orders (×1–3) from landing. Build Orders (E2) adds the held order book. The user asked to tell the drones "build more excavators" before automation exists. |
| 2 | Status units | Per minute, matching the resource panels. |
| 3 | Planner error | **Dropped.** A random worse site reads as the game being wrong, not as a trade-off. Before Site Survey AI, sites are chosen by distance to the anchor only, deterministically (§2.3–2.4). Site Survey AI adds the deposit preference and lane avoidance. Every tech keeps its numeric kW or upkeep con. |
| 4 | Automated Life Support era | E4 on crewed runs is fine; E6 on robotic runs (a crew tech). |
| 5 | Rules on by default | A rule switches **on** when its tech completes, with conservative default caps (§3.4). The discovery card's Next line covers every new effect kind (§5.4). A loaded old save never switches rules on. |
| 6 | Lane for Automated Power | ⚡ POWER. |
| 7 | Costs | At merge, each tech's cost is the new tree's median for its era. |
| 8 | Feed Planner | Stays, contingent on fleet's dig sites landing. |
| 9 | Maintenance semantics | The current wear rules; switch to aging if the tree adds it. |
| 10 | Key [B] | Fine; the coordinator checks for conflicts at merge. |
| 11 | The *distracted* probe policy | Fine as a measurement. The acceptance gate stays on the *reasonable* and *attentive* policies. |

**Still to settle at merge:**

- the costs (the tree's era medians);
- the recheck of the default caps against the 2× tree's build logs;
- work/tree's recipe-part mechanism for the `visual` meshes;
- whether fleet's dig-site API matches the names used here.

## 10. Phase B: order of work

1. **Data and contracts.** `data/automation.ts`; the `AutoState`, `flowBook` and `b.auto` types; actions; the mods and effect kinds; the 12 techs in work/tree's format; `describeEffect` and `techRelevance`.
2. **Sim.**
   - flow-book capture and power-book fields in the economy;
   - `automation.ts` (signals, state machine, budget, orders);
   - `siting.ts`;
   - `Game.econStep`, the `order` action, `commitPlace(auto)`, vetoes;
   - Maintenance triage and replacement; migration defaults.
3. **UI.** `builderPanel.ts`, the BUILDER section of resource panels, palette Ctrl-click and Enter, the inspector AUTO tag, alerts, `$autoMarkers`, [B] and the menu controls.
4. **Meshes.** The 12 parts, through work/tree's mechanism.
5. **Tests.** Everything in §7, then the full suite.
6. **Probe.** `--auto` and the *distracted* policy; run §8.3's acceptance and tune only §8.3's levers.
7. **Docs.** 07, 08, 03 (regenerated), 02, and the index; the discovery card's `nextStep()` cases ship with step 3.

---

## 11. Phase B: as shipped

What changed from the text above while building it, and why. Where this section and an earlier one disagree, this one describes the code.

**Placement and the ladder.** The eras, lanes, costs and prerequisites in §4's table are the shipped ones: one ◉ and one ▣ per era in the free cells, Automated Life Support at E7 on robotic runs (◉ E6 holds Automated Fabrication), Maintenance Automation in ▣ E7, Predictive Scheduling in ▣ E6, Automated Excavation after Build Orders alone. Automated Power is a fourth ⚡ card on the E4 page where the lane already held three; the page still fits 1280×720. Since main's one-page-per-era tree (PR #24) reads `researchView`, the twelve techs appear on their era's page with no tree code of their own.

**Rules.**

- *Holding comes before the dwell.* When the signal is past its trigger but the producers are dark or short of crew, the rule holds and its dwell is zeroed. When the trouble clears, the averages get a full dwell before anything is built (otherwise the stale deficit fired at once).
- *The day's margin pays the bank.* The solar rule's margin is `(full-sun supply − load − recharge) / load`, where `recharge` is what refilling the bank by dusk takes over the sunlit hours. Without it a 10% margin never refilled the bank: it ran dry every night, the battery rule kept adding banks, and the labs went dark (+23% FIRST LIGHT in the first probe run).
- *Yards for research.* The Storage Yard rule adds a yard only when a store is ≥ 95% full with a producer standing by **and** its capacity is under 1.5× the largest research payment queued in that resource. A surplus that tops out a store is not a shortage of storage: the first probe run built 20 yards.
- *Maintenance is a family.* The `maintenance` effect adds `'maintenance'` to `autoFamilies`, so its rule switches on with the family like any other.
- *Held orders place one site per order per tick* (still ≤ 2 placements a tick in all).

**The inspector.** The Builder's one button sits at the right end of the idle-priority row — *Pause rule* on a rule's site, **＋1** on a finished building — so the foot grows no taller and nothing leaves the 280 px frame. Feed Planner's per-excavator switch sits in the body.

**Extension points for the destiny tracks** (work/destiny `docs/14` §0, §2.5; not implemented here):

| Hook | Where | For |
|---|---|---|
| `mods.builderDwellMult`, `mods.builderCapMult` | `{ kind: 'builder'; dwellMult?; capMult?; families? }` effect | faster or bolder rules |
| families `research`, `export` | `AutoFamily`; hidden in the panel until unlocked; rules `lab`, `foilFactory` | a builder that also grows science and the launch chain |
| `freezeRules(s, seconds, rule?)` | `core/automation.ts`; the `freezeRules` action | MALWARE, CONTROL PLANE, *Freeze rules* |
| `AutoRequest.bypass { cap?, reserve? }`, `BudgetOpts.bypassReserve` | the request and budget | RUNAWAY RULE |

**Pacing** (`scripts/probe-pacing.mjs --minutes=280`, seeds 42, 7 and 1234, medians of FIRST LIGHT in game-min; placements are the bot's own per game-minute from Era 4 on — the attention metric):

| Run | Manual | `--auto=on` | Δ | placements/min E4+ | `--savers=early` | Δ | placements/min E4+ |
|---|---|---|---|---|---|---|---|
| robotic mare · reasonable | 200.6 | 212.3 | **+5.8%** | 0.30 → 0.21 (−30%) | 220.6 | +10.0% | 0.14 (−53%) |
| robotic mare · attentive | 180.9 | 191.4 | **+5.8%** | 0.55 → 0.41 (−25%) | 202.1 | +11.7% | 0.19 (−65%) |
| crewed pole · reasonable | 176.3 | 190.3 | **+7.9%** | 0.53 → 0.34 (−36%) | 200.6 | +13.8% | 0.19 (−64%) |
| crewed pole · attentive | 168.4 | 176.6 | **+4.9%** | 0.98 → 0.59 (−40%) | 185.4 | +10.1% | 0.32 (−67%) |
| robotic mare · distracted (measured, not gated) | 233.6 | 243.6 | +4.3% | 0.26 → 0.17 | 249.6 | +6.8% | 0.17 |
| crewed pole · distracted (measured, not gated) | 205.6 | 219.6 | +6.8% | 0.34 → 0.26 | 221.6 | +7.8% | 0.19 |

- **The gate** (−5% / +8% on reasonable and attentive) **passes** with the default `--auto=on`: the Builder techs taken after their era's critical techs, as §8.3 item 2 reads. The manual baselines match the targets (≈ 200 robotic mare, ≈ 176 crewed pole). Brownout stays ≤ 1.1% everywhere; goods-stall minutes fall (pole reasonable 4.8 → 2.1).
- **The attention gate (≥ 60% fewer placements from Era 4) does not pass together with it.** Taken after the critical path, Automated Power lands in Era 6 on the bot's list, so the rules run only the last third of the game (−25% to −40%). `--savers=early` (Automated Excavation and Power closing their era's critical block) cuts placements by 53–67% but costs +10% to +14%: the chain to Automated Power is about 970≡ researched at 1.3–1.4≡/s, ahead of the Data Center that multiplies the research rate.
- **The cost lever is weak.** Halving Build Orders, Automated Excavation and Automated Power (§8.3's first lever, measured in a scratch build, not shipped) gains only 2–3 points: early savers become +7.5% / +8.8% / +12.1% / +12.3%. What remains is reaction: the bot builds power ahead of need from its own projection (pending sites, recharge), the rules after a deficit has held for its dwell. Costs therefore stay at the era medians (decision 7).
- **The *distracted* bot does not gain game time either** (+4% to +8%): it still builds by need, only less often, so the rules have little to catch. The gain automation offers a human is real time and attention, which the probe's decision rate shows falling; it does not show up as FIRST LIGHT minutes for a scripted player.
- The probe fix that made attentive runs measurable: an attentive player waiting on a next-era priority tech with an **empty** queue deadlocked robotic mare in Era 6 (main too); it now waits only while something is queued.

**Debug API.** `order`, `cancelOrder`, `orderNext`, `setRule`, `setReserve`, `moveFamily`, `freezeRules`, `setFeedPlan`, `getAutomation`, `planSite(type, intent)`, `setWear(id, wear)`.

**Tests.** `tests/automation.spec.ts` covers §7 in fifteen tests. Not covered as a separate test: §7 #8's hysteresis toggle, and SSAI lane avoidance; the chooser's determinism test compares two page loads.

