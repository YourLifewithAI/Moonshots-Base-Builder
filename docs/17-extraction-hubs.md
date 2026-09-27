# 17 · Extraction hubs: hubs that build their own robots, and strip mines that reshape the ground

**Status:** Phase A design, revision 2, on `work/hubs` from main `97e1373`. No code
yet. Revision 2 takes in the player's answers (§23) and redesigns extraction as
**strip mining that deforms the terrain** (Part 2). Phase B starts after
**work/unitpower** (machine battery packs) merges, since it changes the same files.
Check these borrowed names again at merge: `homeOf`, `chargeSpotOf` and Rover Power
Packs (work/unitpower), docs/16 and its shelter rule (work/flares), and tap
placement (work/touch).

**Code today:** `src/data/buildings.ts` (the placed Excavator and Ice Harvester),
`src/core/haul.ts` (the haul cycle), `src/data/deposits.ts` and
`src/terrain/heightfield.ts` (deposits, the heightfield, `flatten`),
`src/terrain/chunks.ts` (terrain meshes), `src/core/exploration.ts` (reveals,
surveys), `src/core/zones.ts` (extraction zones), `src/core/roads.ts` (spurs, A*,
gates), `src/core/siting.ts` and `src/core/automation.ts` (the Builder),
`src/ui/depositCard.ts`.
**Code to come:** `src/data/hubs.ts` (hub, unit, pit and grade tables),
`src/core/hubs.ts` (printing, bays, assignment), `src/core/pits.ts` (pit growth,
grade, reserves, faces, surveys), `src/terrain/pitCarve.ts` (the height-delta grid),
`src/ui/hubPanel.ts`, and changes to the files above.

If a number here disagrees with the code once it ships, the code wins.

**Glyphs:** ▲ regolith · ◆ metals · ◇ silicon · ≈ water · ○ O₂ · ⚙ parts · ≡ data.
Costs are base costs. Placed costs scale by the site's `buildCostMult`: mare ×0.8,
pole ×1.25, lava tube ×1.1. Tech costs are shown after `ERA_COST_SCALE`.

**Words.** A **deposit** is a mapped patch of one kind of ground (today's extraction
zone). A **pit** is where units dig: every deposit that is worked becomes one, and so
does every patch of plain ground a hub is given. A **face** is one working bench in a
pit. A **hub** is a processing building that owns robots, and **units** (or haulers)
are those robots. **▲ is one tonne of dug regolith.** This doc never says "site" for
a deposit or a pit, because the code uses "site" for a landing site and a
construction site.

---

## 0. What the player asked for

> "I think I want the regolith excavators to be built by and managed by the
> smelters. We should rearrange the research tree such that you start with the
> smelter as part of your basic initial tech, as well as the excavator, but that
> you have to build more from the smelter. If there's a resource specific to a
> given industrial hub (ice, silicon, etc) then they should each be the site from
> which we build and send out the robots. That way there's a strategic advantage
> to building those hubs near various resources because the time it'll take for
> the excavators to go to and from the resource bed to the hub/refinery is either
> shorter or longer. That makes its placement a real strategic choice. Then
> research makes more sense later on, because you can choose to increase how fast
> the excavators move, how much they can haul, how quickly they extract, etc.
> And when selecting a smelter, silicon refinery, or water management plant
> (let's make a facility specifically for water management. This makes sense in
> prep for humans to come live on the moon, or simply as future rocket fuel for
> the Dyson swarm) the relevant resource should light up on the map to help the
> player see where they should place that particular building."

> "There should also be a limit to how many excavators can be present on a given
> resource site and the resource sites should have limited amounts of a given
> resource. That should be part of the survey process. It tells the player how
> much is at a given site, how many excavators that site can handle, and so on."

> "What does this look based on actual lunar regolith? If yes, that's fine but it
> should be proportionally slower and more destructive to the lunar surface. They
> should excavate, and this should apply to both resourced and unresourced sites.
> With humans involved, it should be demoralizing. With bots only it should be much
> slower and more destructive. Think of each resource extraction location as a strip
> mine. The excavators slowly and concentrically extract the resources from a given
> site. Low resources in a given area means they have to dig a wider, deeper hole for
> less resource gain. Does that make sense? So it should deform the map as they go,
> which also makes building the base more challenging around those sites since the
> terrain gets much more uneven as they go deeper."

It does make sense, and it is how the design now works (Part 2).

## 1. Decisions

| Topic | Decision | Why |
|---|---|---|
| Who owns the diggers | **Hubs.** The Regolith Smelter, the Silicon Refinery and a new **Water Management Plant** each print, dock, charge and dispatch their own units. Excavators and Ice Harvesters are no longer placed. | The player's first request. |
| Regolith storage | **Each hub's units feed that hub's own hopper.** There is no shared pool. The ▲ chip shows the sum of the hoppers. | Placement only matters if a hub eats what its own robots bring (§3.2). |
| **Every extraction site is a pit** | Deposits and plain ground alike. Units dig concentrically, outward and down from the pit's centre, in 2 m benches with 1:2 walls. Each pit has a ramp and a tailings heap beside it. | The player's third request: "Think of each resource extraction location as a strip mine." |
| **Grade** | A hub's output per tonne is proportional to the grade of what it is fed (`q`). The hole dug per unit of product is proportional to 1/q. Deposits are rich at the centre and lean at the edge. | "Low resources in a given area means they have to dig a wider, deeper hole for less resource gain." The lean tail falls out of the geometry. |
| **Plain ground** | Allowed, at plain grade: q 0.45–0.8 against 1.05–1.4 for a deposit's average. **Robots dig it in bulk**; **crews high-grade it** (×1.25), but it costs their morale. Molten Regolith Electrolysis digs any ground at q 1.0. | "Proportionally slower and more destructive." Crews: demoralizing. Bots only: slower and more destructive. MRE is the real-world answer to poor ground (§9). |
| **The loose layer** | Pits widen at the loose-regolith depth: mare 4–5 m, highlands 10–15 m, ice-bearing layer 3–6 m. Bedrock can only be dug with Deep Coring, at ×0.3 dig rate. | The physical basis the player was given (§7). |
| **Faces** | A pit's working benches: `floor(free rim / 30 m)`, 1–6. They grow as the pit widens, and a blocked rim counts for nothing. **Research never adds faces** (the player's answer to Q4). | "How many excavators that site can handle." |
| **Depletion** | A deposit is **exhausted** when its cut falls to the cutoff grade: plain plus 15% of its enrichment. A pit is **boxed in** when it can neither widen nor deepen. **1–3 exhaustions a mare run, the first in Era 4–5** (the answer to Q2). | "Depletion is the pit reaching its limits." |
| **The terrain deforms** | The sim heightfield is edited as pits and heaps grow. It is stored as a **sparse height-delta grid**. Everything that reads the terrain reads it. Only the affected chunks are rebuilt, throttled. | "It should deform the map as they go." |
| Building near pits | Never on a pit or heap, nor within 4 m of a rim. A warning inside a deposit's full-size pit ring. Site Grading levels heaps but never fills pits. **Reclaim** backfills a worked-out pit. | "Building the base more challenging around those sites." |
| Roads | Never cross a pit. Units reach the floor by its ramp. | Road A*'s step limit already forbids it. |
| Morale | Crewed bases lose morale to pits near homes: −1 per 1,000 m² of plain-pit scar, −0.4 for a deposit pit, capped at −12. | "With humans involved, it should be demoralizing." |
| The cut's colour | **Brighter** than the ground around it. | Fresh regolith is immature: not yet darkened by space weathering, like a young crater's rays (§20). |
| The first unit | **Every hub comes with its first unit, priced in.** | No hub ever stands useless, and today's opener costs the same (§4.2). |
| More units | Printed by the hub from a queue, with no construction rover. | "You have to build more from the smelter." |
| Cap | **Bays**: Level I has 2, Level II 3, Level III 4. **Each level is bought at a hub** once research allows it (the answer to Q3). | "A cap per hub level." |
| Where units dig | The pit that feeds the hub most. Usually that is the nearest rich deposit by haul time; plain pits count too. Or the player sends them. | §4.4. |
| Reach | 90 s one way at the unit's current speed. | Reach is by haul time. Speed research extends it. |
| Surveys | A rover job from landing: 30 stored energy, 2⚙, 40 rover-seconds. It reveals ore tonnage (±30%), centre grade, loose depth, faces now and at full size, and the life. | §13. |
| `regolithProcessing` | **Retired** for **Pit Mapping** (off-road ×1.3 in pits and deposits), at the same slot and price. | §14.1. |
| `iceHarvester` · `propellantPlant` | The harvester is retired; old ones become legacy pads. The propellant plant is kept as the launcher, fed by water plants. | §3.3. |
| Future hubs | One row in `HUB_DEFS` each. A KREEP works is next. | §3.4. |
| Highlight | Picking or selecting a hub lights its deposits and pits: trip time, faces, ore left, the pit's extent now and at full size. It works on tap. | §6. |
| Old saves | Excavators join the nearest hub, else stay legacy pads. **Deposits start full and no pit is carved on load** (the answer to Q5). | §19. |

---

## 2. Measured today

`scripts/probe-pacing.mjs` on main `97e1373`, reasonable policy, natural destiny,
seeds 42, 7 and 1234, 260 min, with an instrumented copy that samples every
excavator's haul every 120 s (`getFleet().hauls`). Deposits come from the
heightfield over 12 seeds.

**When things go up** (game-minutes after landing, medians over three seeds):

| Run | 1st excavator placed · done | 1st smelter placed · done | 2nd excavator | Excavators at E2 · E4 · end | FIRST LIGHT |
|---|---|---|---|---|---|
| mare robotic | 2.9 · 4.6 | 7.6 · 8.8 | 19.3 | 2 · 2–4 · 4–5 | 193.3 [191, 193, 202] |
| mare crewed | 2.9 · 4.6 | 7.6 · 8.8 | 17.9 | 2 · 2 · 2–3 | 208.9 [209, 211, 201] |
| pole crewed | 3.3 · 5.2 | 8.6 · 10.7 | 13.6 | 2–3 · 3–4 · 3–4 | 161.3 [161, 169, 158] |
| pole robotic | 3.3 · 5.2 | 8.6 · 11.1 | 14.6 | 2–3 · 3–4 · 4–5 | 185.7 [182, 190, 186] |
| lava tube robotic | 2.9 · 4.9 | 8.3 · 10.6 | 17.6 | 2–3 · 4–5 · 4–5 | 211.3 [211, 256, 209] |

- The first smelter waits on Regolith Smelting (48≡, done at 7.3–8.3 min).
- Era 2 opens by the 450◆ deed in 14 of 15 runs (at 25–29 min).
- **Every excavator dug its own pad in all 15 runs** (4,525 samples, none away).
  The bot never uses Dig at…. Mare and lava tube excavators sit on the guaranteed
  ilmenite patch. At the pole they sit on plain ground, the starter ice, or the
  near anorthosite.
- The pole researches MRE late, at 88–107 min (Era 4–5). A pole that needs it early
  will have to take it earlier (§9.4).

**Hauls** (the pad to the nearest smelter or refinery, by road):

| Run | Route m (p10 · p50 · p90) | Cycle s (p10 · p50 · p90) | Longest haul |
|---|---|---|---|
| mare robotic | 30–94 · 45–114 · 61–126 | 76–102 · 82–110 · 88–115 | 70–206 m |
| pole crewed | 28–38 · 54–66 · 70–104 | 75–79 · 86–90 · 92–106 | 94–114 m |
| lava tube robotic | 20–45 · 30–105 · 36–120 | 72–82 · 76–106 · 78–112 | 81–128 m |

A cycle is 60 s of digging, 4 s of unloading and the drive both ways at 5 m/s
(`HAUL`, `src/data/balance.ts:40-46`).

**What a run digs:**

| Run | ▲ by E2 · E3 · E4 · E5 | ▲ per run | ≈ per run | Where it came from |
|---|---|---|---|---|
| mare robotic | 1.3k · 4.2–4.5k · 7.9–9.4k · 11.8–18.6k | 32.6–36.0k | 1.2k | all from ilmenite #0 |
| mare crewed | 1.2–1.3k · 5.6–6.1k · 8.8–9.8k · 12.5–14.2k | 27.4–29.1k | 1.4–1.5k | all from ilmenite #0 |
| pole crewed | 2.0k · 5.5–6.2k · 9.4–10.7k · 13.5–14.4k | 24.3–24.8k | 3.2–3.6k | plain ground; up to 10k▲ dug on the starter ice |
| lava tube robotic | 1.6k · 4.1–4.6k · 11.7–12.0k · 20.2–21.7k | 44.3–52.1k | 1.3–1.5k | all from ilmenite #0 |

At 1.5 t/m³, a mare run today moves 22–24k m³ of regolith, and a lava tube run
30–35k m³. Today none of it leaves a mark.

**Deposits** (`DEPOSIT_PLAN`, `src/data/deposits.ts:41-58`; 12 seeds; "rim" is the
distance from the Lander to the ring):

| Site | Kind | Count | Radius | Area (median) | Nearest rim (median, range) |
|---|---|---|---|---|---|
| mare | ◆ high-Ti basalt | 4 | 16–26 m | 1,466 m² | 16 m (5–25) · 2 within 120 m |
| mare | ◇ anorthosite | 1 | 22–34 m | 2,578 m² | 282 m (223–385) |
| mare | ≈ mature soil | 3 | 24–36 m | 2,769 m² | 92 m (35–174) |
| pole | ❄ cold-trap ice | 7 | 10–13 m (starter), 18–34 m | 2,108 m² | 35 m (30–40) · the rest 90–310 m |
| pole | ◇ anorthosite | 3 | 22–34 m | 2,765 m² | 21 m (12–28) |
| lava tube | ◆ high-Ti basalt | 2 | 16–26 m | 1,481 m² | 21 m (5–33) |
| lava tube | ○ pyroclastic glass | 2 | 16–24 m | 1,293 m² | 29 m (7–36) |
| lava tube | ☢ KREEP | 1 | 18 m | 1,018 m² | 89 m (45–128) |
| lava tube | ≈ mature soil | 1 | 24–36 m | 2,417 m² | 132 m (32–179) |

The mare's only anorthosite lies 220–390 m out, and the lava tube has none.

---

# Part 1 · Hubs

## 3. The three hubs

### 3.1 What each hub is

| Hub | id | Footprint | Cost with its first unit | Build | Crew | Power | Recipe at q 1 (per s) | Hopper | Unit | Wants |
|---|---|---|---|---|---|---|---|---|---|---|
| **Regolith Smelter** | `smelter` | 3×2 | **60◆ 15⚙** (was 40◆ 10⚙) | 150 s (was 120) | 2 | −12 kW | 2▲ → 0.5◆ 0.25○ 0.05≈ | 315▲ | Regolith Excavator | ◆ high-Ti basalt (H₂). With MRE: any ground |
| **Silicon Refinery** | `refinery` | 3×2 | **70◆ 20⚙** (was 50◆ 15⚙) | 150 s (was 120) | 2 | −14 kW | 2▲ → 0.4◇ | 315▲ | Regolith Excavator | ◇ highland anorthosite |
| **Water Management Plant** (new) | `waterPlant` | 3×2 | **60◆ 15⚙** | 140 s | 1 | −6 kW (−9 on mature soil) | 2▲ icy regolith → 0.4≈ · or 2▲ mature soil → 0.08≈ | 315▲ | **Ice Miner** at the pole · Regolith Excavator elsewhere | ❄ cold-trap ice · ≈ mature soil |

- **Output scales with grade** (§9): a smelter fed at q 1.3 makes 0.65◆/s from the
  same 2▲/s. Every hub eats 2▲/s whatever the grade, so poor feed means less
  product, not more throughput.
- **Unlocks.** The smelter is unlocked from landing (`unlockedFromStart`), as the
  excavator was. The refinery stays behind Silicon Refining (E2). The water plant
  comes with Cryo Ice Extraction at the pole and Solar-Wind Volatiles at the mare
  and lava tube (both E1, both already there, re-pointed; §14.4).
- **Each price is the old building plus one unit.** The smelter is 40◆ 10⚙ and an
  excavator 20◆ 5⚙. The water plant is 35◆ 10⚙ and an ice miner 25◆ 5⚙ (the old
  harvester's price). The extra 30 s is the unit's assembly.
- **Recipes at q 1 are today's.** The ice recipe at q 1 (5 wt% ice) gives 0.4≈/s,
  which is today's harvester. The mature-soil recipe replaces the Solar-Wind
  Volatiles excavator retort.
- **Hubs are docks** (docs/15 §2, §5a): a spur and parking bays beside the door. A
  hub is refused inside an extraction zone (`src/core/roads.ts:631`), with no room
  for a bay (`:684`), or on a pit or heap (§11.3).
- **Priority** stays 2 for the smelter and refinery. The water plant is 1, like the
  harvester. Units run at their hub's priority.

### 3.2 Hoppers, not a pool

**Each hub's robots feed that hub directly.** Regolith lives in hub hoppers and
nowhere else.

| Concern | Shared pool (today) | Hub hoppers (chosen) |
|---|---|---|
| Strategy | A unit's trip only sets how fast the pool fills. A good hub covers for a bad one. | Every hub lives on its own haul and its own pit. |
| Legibility | "Regolith 180▲" says nothing about which furnace starves. | "Smelter #3 · hopper 40/315▲ · feed q 1.24 · starved 31%" says which. |
| Grade | One feed EMA for smelters and refineries. | Per hub: the EMA of the grade of its own loads. |
| Storage | The Lander (300▲) and yards (400▲ each). | 3 buckets (315▲) a hub. A full hopper leaves its units waiting at the face with a full bucket, as today (docs/15 §5). |
| The Builder's flow book | Regolith made against wanted; a starved furnace reads about 0 net (docs/13 §0). | Regolith stays in the book as a sum. The unit rule reads each hub's starved share, which is exact. |

- `s.resources.regolith` stays. It is **the sum of the hoppers**, written once a tick
  by the hub step. The HUD chip, the regolith panel, the Dig In milestone and the
  `siliconRefining` insight keep working unchanged.
- The ▲ chip reads `180/630▲ in 2 hoppers`. The regolith panel lists each hub: its
  hopper, its feed grade and kind shares, its units, its pit and its starved share.
- The Storage Yard keeps its other caps; its pro text loses "400 regolith".
- `s.feed` (the kind-share EMA) stays, as the draw-weighted mean of the hub feeds.
  The KREEP reactor rule (15% of your digging) reads it.
- Grading's 6▲ goes to the nearest smelter or refinery with room. There is no Lander
  drop any more.

### 3.3 The Ice Harvester and the Propellant Plant

| Building | Fate | Details |
|---|---|---|
| `iceHarvester` | **Retired** from the palette and `BUILD_ORDER`. Its id stays for old saves. | Its price, crew seat and techs move to the water plant and its Ice Miners. Old harvesters keep working as legacy pads until a water plant stands (§19). |
| `propellantPlant` | **Kept**, unchanged: water 0.30 + O₂ 0.05 → launch 0.01. | Water plants are its supply. Water Electrolysis (§14.3) cuts its inputs by 40%. Its tanks gain a propellant dewar at the plant (§20). |

### 3.4 Future hubs follow the pattern

A hub is one entry in `HUB_DEFS` (`src/data/hubs.ts`): its unit, the kinds it
wants, the grade table it reads (§9.1), its hopper, and whether it may dig plain
ground.

```ts
export const HUB_DEFS: Partial<Record<BuildingId, HubDef>> = {
  smelter:    { unit: 'excavator', wants: ['ilmenite'], grade: 'ilmeniteH2', plain: true, hopper: 315 },
  refinery:   { unit: 'excavator', wants: ['anorthosite'], grade: 'plagioclase', plain: true, hopper: 315 },
  waterPlant: { unit: (site) => site.hasIce ? 'iceMiner' : 'excavator',
                wants: (site) => site.hasIce ? ['ice'] : ['volatiles'], grade: (site) => site.hasIce ? 'ice' : 'solarWind',
                plain: (site) => !site.hasIce, hopper: 315 },
};
```

- **Next candidate: a KREEP works.** Its units dig ☢ KREEP soil for the reactor's
  thorium make-up (today a 15% feed share). It fits when Rare Earths return
  (docs/02, docs/09).
- Every hub gets the same bays, queue, pits, highlight, reach and Builder rule.

---

## 4. Units: robots that belong to a hub

### 4.1 The two unit types

| | Regolith Excavator | Ice Miner (new) |
|---|---|---|
| Built by | Smelter, Refinery, and a water plant off the ice | Water plant on the ice |
| Cost · print time | 20◆ 5⚙ · 60 s | 25◆ 5⚙ · 70 s |
| Draw | −6 kW while it works (as today); +25% on bedrock benches (§8.5) | −6 kW; the same |
| Upkeep | 2⚙ a lunar day (as today) | 2⚙ a lunar day |
| Bucket | 105▲ (`HAUL.bucket`), scaled by its output multipliers: 131▲ at the mare | 105▲ of icy regolith |
| Dig · unload · heap dump | 60 s · 4 s · 4 s | 75 s (ice-cemented ground, a heated auger) · 6 s · 4 s |
| Speed | 5 m/s on roads, 2.5 m/s off-road in a pit or deposit | 4 m/s, 2 m/s off-road (a tracked crawler) |
| Width | 3.8 m, a wide load (docs/15 §6) | 3.6 m, a wide load |

- **Both stay in `BUILDINGS`**, flagged `unit: true`: not placeable, not in the
  palette, never on the Builder's placement list. Every tech effect that names
  `excavator` keeps working through `effectiveDef` and `Mods`.
- Units have **no crew** and **no overclock**.
- A unit digs tonnes. Its hub turns them into product at the grade they carry.

### 4.2 Printing, the queue and the cap

| Rule | How |
|---|---|
| The first unit | Comes with the hub, in its price and build time. It rolls out when the hub commissions. |
| Printing more | **+ Excavator** (or **+ Ice Miner**) in the hub's inspector adds a job to its queue. |
| When it pays | When the job reaches the head of the queue. Short of stock, it waits: `waiting: 16◆ (have 9)`. |
| While it prints | Print time × `buildCostMult`, at 4 kW (`CONSTRUCTION_KW`). It pauses in a brownout. The hub keeps processing. |
| The queue | Up to 3 jobs a hub. Cancel refunds all that was paid. |
| The cap | Units ≤ bays. A full hub reads `BAYS FULL 2/2 — + Bay (Bay Extensions)`. |
| Levels | Level I: 2 bays, from landing. Level II: 3, with **Bay Extensions** (E2). Level III: 4, with **Depot Halls** (E5). **+ Bay** is a queue job at that hub: 30◆ 10⚙, 60 s, 4 kW. Research only allows a level; each hub buys its own. |
| Room for a bay | A free cell beside the hub's bays. With none: `NO ROOM FOR A THIRD BAY — beside its bays is road or a structure`. The ghost dots the Level II and III bay cells. |
| Fleet OS (◉ E5) | +1 bay on every hub, free (§16.6). |

**Why every hub gets its first unit, priced in:**

| | Every hub, priced in (chosen) | The first hub only, free |
|---|---|---|
| Opener cost | Same as today: 2 arrays, smelter + unit, lab = 96◆ at the mare | 20◆ cheaper |
| A second smelter | Works the moment it stands | Stands idle until you print a unit |
| New trap | None | A hub built with the last metals, and no stock for its unit |
| The Builder | Places hubs that work | Must place a hub **and** order its unit |

### 4.3 Bays: parking and charging

- A hub's bays are **road bay cells beside its door**, the dock pattern of the
  Robotics Bay (`SpurPlan.bays`, `src/core/roads.ts:670-684`). Level I lays two, left
  and right of the door. Level II and III add one cell each along the front.
- **One unit per bay cell, nose to the wall.** A unit is 6 m long, so its tail holds
  the cell in front of its bay too, as a wide load's overhang does (docs/15 §6). The
  ghost keeps that cell free: the **bay apron**.
- A unit parks only with nothing to do: new, recalled, sheltering from a flare,
  waiting out a long brownout, charging, or with no pit in reach. With its hopper
  full, it waits at its face with a full bucket, as today.
- **Charging** (work/unitpower): `homeOf(unit)` is its hub and `chargeSpotOf(unit)`
  its bay cell. It tops up while it tips each load and fully in its bay. The load
  shows under the hub in the power panel: `Smelter #3 · charging 2 units · 4.2 kW`.
- The hub's **tipping stand** is its door cell. Units queue there and tip nose to the
  hopper chute (`standFor`, `stopShort` in `src/core/haul.ts:120-154`).

### 4.4 Where a unit digs

**Auto (the default).** A unit without work takes, in order:

1. the pit its hub was assigned (**Assign**), if it has a free face;
2. else the pit with the best **hub intake**: `min(units × rate, the hub's hunger) ×
   q`. `rate` comes from `tripFor` and `q` is the grade of the pit's cut now. Ties go
   to the nearer. Every mapped wanted deposit in reach counts: a deposit not yet dug
   is a pit of size 0. So does the hub's **plain pit** (§8.6);
3. else it parks: `IDLE — no pit in reach with a free face`.

All of a hub's auto units make the same choice. Splitting them across pits is Feed
Planner's job (§14.4).

**Two examples.** One mare excavator, full-depth pits (§5.1):

- **A far deposit loses to the plain pit until a second unit.** A mare refinery near
  the Lander, with anorthosite 260 m out (12 m deep, so a 50 m ramp), compares
  0.58▲/s × 1.35 = 0.79 there against 1.33▲/s × 0.8 = 1.07 at its plain pit. The
  plain pit wins. With two units it is 1.58 against 1.60: still the plain pit, just.
  The inspector says so: `◇ anorthosite #0 · 1:18 · worth 0.8 a unit against the
  plain pit's 1.1 — build a Refinery by it`.
- **A rich deposit wins at once.** A smelter with ilmenite 100 m out: 0.97▲/s ×
  1.3 = 1.26 there, against 1.33 × 0.62 = 0.82 at its plain pit.

**Reach** is 90 s one way (`HUB.reachS`) at the unit's current speed: roads × the
roadway tiers, off-road and ramps × Pit Mapping. At base speed that is about 400 m of
road with a shallow pit. A deeper pit's longer ramp eats reach. **Send…** goes to 2×
reach.

**Faces are reserved at assignment**, so an auto unit never arrives at a full pit. A
unit the player sends to one waits at its gate: `WAITING AT THE GATE — high-Ti
basalt #0 has 3/3 faces working`. Faces are shared by every hub.

**By hand**, in the hub's inspector and the unit's:

| Button | Does |
|---|---|
| **Assign** (on a pit or deposit row) | The hub's preferred pit: its auto units go there as faces allow. |
| **Open pit…** | Stakes a new plain pit on mapped open ground (§8.6). |
| **Send…** (on a unit) | Targets a pit or deposit on the map, as Dig at… did. Pinned until it is exhausted or you press Auto. |
| **Recall** · **Dispatch** | Home to the bay and hold there; back to work. |
| **Auto** | Unpins a unit. |

### 4.5 The cycle in the sim

The cycle is today's `haulTick` (`src/core/haul.ts:360-450`) with new ends.

```
bay ─ road → hub door ─ road → pit gate ─ off-road → ramp ↓ → face ─ dig ─ ramp ↑ → gate ─ road → hub door ─ tip
                                                                    └─ on the way back out: dump tailings at the heap
```

| Leg | Rule |
|---|---|
| Out and back | `groundWay` (`src/core/roads.ts:433`): road from the hub's door to the pit's gate, then off-road at `ROAD.offroad` (0.5) of road speed to the ramp, down it and along the bench to the face. The ramp adds 4 m of off-road driving per metre of depth (§8.3). |
| Digging | `digS / digMult` fills the bucket from the face's bench. The bucket carries the grade of the ground it cut (§9). Bedrock benches dig at ×0.3 (§8.5). |
| Tipping | Into the hub's hopper, credited on unload. The hub's grade EMA moves. The pit's dug volume grows by the load ÷ 1.5 t/m³. |
| The heap | On the way back out, the unit tips the hub's tailings at its pit's heap (4 s): 70% of what it last hauled (§8.4). |
| Hopper full | The unit waits at its face with a full bucket (today's rule). |
| No road to the gate | `NO HAUL ROAD — …`: it takes its next choice, else parks. |
| Exhausted or boxed in mid-dig | It leaves with a part bucket and re-routes (§10.2). |
| The hub dark or off | Units finish their trip, tip and park. |
| Power | Each working unit is a −6 kW load at its hub's priority. |

**Tick order.** Economy step 4 runs `'excavator', 'iceHarvester'` first today
(`PROD_ORDER`, `src/core/economy.ts:42-48`). That step becomes **hub units**: every
unit in id order, hub by hub. Hubs then draw from their own hoppers. A new step
**4.2, pits**, grows each pit by what was dug this tick and carves the terrain when a
rim has moved 0.5 m (§11.1).

### 4.6 State

```ts
/** A hub's robot (core/hubs.ts). */
interface Hauler {
  id: number;
  type: 'excavator' | 'iceMiner';
  hub: number;                   // its hub's building id: work/unitpower's homeOf
  bay: number;                   // its bay at the hub
  pit: number | null;            // the pit it works (null: parked)
  face: number | null;           // the bench it holds
  pinned?: boolean;
  parked?: 'new' | 'recalled' | 'flare' | 'brownout' | 'charge' | 'noPit';
  haul: HaulState;               // today's cycle; drop = its hub
  wear: number;
  brickedUntil?: number; heldUntil?: number;
  junk?: number;                 // a runaway rule's print (never commissions)
  feedPlanOff?: boolean;
  auto?: { by: 'rule' | 'order'; at: number };
}
interface HubState {             // on BuildingState.hub
  level: 1 | 2 | 3;
  hopper: number;                // ▲
  q: number;                     // grade EMA of delivered loads
  feed: FeedGrade;               // kind-share EMA (KREEP rule, panels)
  queue: HubJob[];
  prefer?: number;               // Assign: a pit id
  plainPit?: number;             // its staked plain pit
  starved: number;               // 120 s EMA: share of ticks idle for inputs
  electrolysis?: boolean;
}
interface PitState {             // s.pits (core/pits.ts)
  id: number;
  deposit: string | null;        // null: a plain pit
  cx: number; cz: number;        // its centre (a deposit's centre, or the stake)
  R: number;                     // rim radius, m (grows only)
  dugM3: number;                 // volume dug
  heapM3: number;                // tailings dumped
  heap: { x: number; z: number };// the heap's centre
  gateDir: number;               // radians: the ramp's side
  bedrock: number;               // benches below the loose layer (Deep Coring)
  state: 'open' | 'exhausted' | 'boxed' | 'reclaiming' | 'reclaimed';
  surveyed?: { at: number; precision: number };
}
// GameState: haulers, nextHaulerId, pits, nextPitId, terrain: { rev: number; delta: string }, hubSchema: 1, pile?: number
```

The pit's depth, loose layer, grade profile, ore halo and face points are derived
from `(seed, deposit id)` or `(seed, pit id)`, never stored (§10.5). The shape it
has actually been carved to lives in the height-delta grid (§11.1).

### 4.7 The hub's inspector

```
REGOLITH SMELTER #3 · Level I · 2 bays                      RUNNING · 12 kW · 2 crew
hopper ▮▮▮▮▮▯▯▯ 180/315▲ · feed q 1.24 (86% high-Ti) · starved 12% (last 2 min)

UNITS 2/2                      [+ Excavator  16◆ 4⚙ · 0:48]   [+ Bay · needs Bay Extensions]
QUEUE  —

ROBOTS
 E1 Excavator · DIGGING high-Ti basalt #0, bench 2 (−4 m) · 78/131▲ · trip 0:15 · 1.3▲/s   [Send…] [Recall]
 E2 Excavator · HAULING 131▲ to the hub · 0:06                                               [Send…] [Recall]

PITS IN REACH (one way, now)
 ◆ high-Ti basalt #0 · pit 18 m of 28 · 0:15 · faces 2/3 · ore 8.4k▲ left (±30%) · ~5.8 lunar days  [Assigned]
 ◆ high-Ti basalt #3 · not dug · 0:41 · faces 0/1 · unsurveyed                                    [Survey] [Assign]
 plain pit P4 · 0:15 · q 0.62 · 3 faces                                                            [Assign]
```

- The status line takes today's words (`STARVED — the hopper is empty: its units
  deliver 1.4▲/s of the 2▲/s it burns`).
- **The hint under UNITS** answers "is another worth it?": `A 2nd excavator would fill
  the hopper: +0.6▲/s → +13◆/min for 16◆ 4⚙ and 6 kW · pays back in 1:15`. It shows
  while the hub is starved ≥ 10%, a face is free and a bay is free. With no free
  face: `the pit's 2nd bench opens at 9.6 m (now 7.1 m)`.
- **Life** is ore left ÷ what is really dug: the units' rate, capped by the hub's
  hunger.
- **The unit's inspector** shows its line, hub, pit, bench and depth, wear, charge
  (with work/unitpower), and Send… / Recall / Auto.
- **Robots panel.** The fleet panel gains a HAULERS tab listing every unit by hub.
- On touch the inspector is the side sheet (docs/07 §13); every button is 44 px.

**Alerts.**

| When | Alert | Kind |
|---|---|---|
| A unit rolls out | `EXCAVATOR E3 READY — Smelter #3 sends it to high-Ti basalt #0 (bench 3, trip 0:15)` | info · select |
| Printing waits | `PRINT WAITING — Smelter #3's excavator needs 16◆ (have 9)` | condition · info |
| A hub starves | `SMELTER #3 STARVED — its hopper ran dry 30% of the last 2 min: a unit, a nearer pit, or a new bench` | condition · warn, after 120 s |
| No pit | `REFINERY #9 IDLE — no pit in reach with a free face: Open pit… or build nearer` | condition · warn |
| Water plant with no ice | `WATER PLANT #12 DRY — no ice in reach: the nearest mapped cold trap is 2:10 away` | condition · warn |

---

## 5. Placement is the strategy

### 5.1 Haul time

One way, from the hub's door:

```
t     = road m / v + (off-road m + 4 × pit depth m) / (v × 0.5 × offroadMult)
v     = HAUL.speed (5 m/s) × haulSpeedMult × roadSpeedMult × roadHaulMult (× roadNightMult after dark)
cycle = digS / digMult + unloadS + heapS + 2t
rate  = bucket / cycle        (▲/s per unit)
yield = rate × recipe × q     (product per unit)
```

This is `tripFor` (`src/core/haul.ts:217-227`) measured from the hub, with the ramp
added. **Typical numbers**, one mare excavator (bucket 131▲, isru ×1.25) with no
research, pits at their full 4.5 m depth, 15 m off-road to the face:

| Where it digs | One way | Cycle | ▲/s | ◆/min it feeds | Units to fill one smelter |
|---|---|---|---|---|---|
| its plain pit, 20 m of road (q 0.62) | 0:15 | 98 s | 1.33 | 12 | 1.5 |
| a deposit, 10 m of road (q 1.3) | 0:15 | 98 s | 1.33 | 26 | 1.5 |
| a deposit, 40 m | 0:21 | 110 s | 1.19 | 23 | 1.7 |
| a deposit, 100 m | 0:33 | 134 s | 0.97 | 19 | 2.1 |
| a deposit, 250 m | 1:03 | 194 s | 0.67 | 13 | 3.0 (the cap is 2: starved) |

- The trip barely separates a near deposit from the plain pit. **The grade does**: a
  smelter on a deposit makes twice the metals, from the same furnace, crew and
  12 kW, and digs half the hole for them (§9.2).
- So the furnace is the scarce thing and the units are cheap. **Put the hub where a
  rich pit can feed it**, and a second unit pays for itself fast.
- MRE smelting is feed-insensitive (q 1.0 anywhere). An MRE smelter still wants a
  short trip, but it never needs a deposit.

### 5.2 The ghost

A hub's ghost adds a HUB block under the ROAD line (docs/15 §3). It updates when the
ghost moves a cell.

```
HUB  ◆ high-Ti basalt #0 · 12 m by road + 19 m off-road · trip 0:15 · faces 1 now, 5 at full size
     ~1.3▲/s at q 1.4–1.9 (centre first) ≈ 30◆/min per excavator · ore ~12k▲ (±30%) ≈ 8 lunar days at 2▲/s
     the full-size pit (R 28 m) stops 6 m short of this wall — clear
ROAD 6 cells + a 3-cell haul road to its gate · 18 rover-s to sinter, before it rises
```

- **Unsurveyed:** `… · faces ? · ore ? — survey it first [the deposit's card]`.
- **Full:** `◆ #0 is full (3/3 faces) — its units would go to ◆ #3, 0:41`.
- **In the pit's way** (a warning; the first click asks, the second builds, as
  `smelterWarning` does, `src/buildings/placement.ts:59-68`): `IN THE PIT'S WAY —
  high-Ti basalt #0's pit will reach 28 m from its centre; here it stops at your
  wall and ~20% of its ore stays in the ground`.
- **No wanted deposit in reach:** the ghost stakes the hub's **plain pit** too (§8.6):
  `no high-Ti basalt in reach: its excavator opens a plain pit here (q 0.62 — about
  half the metals, twice the hole)`. On a crewed base it adds the morale line
  (§12.1): `… 80 m from Habitat #2: −1 morale by the next dusk, −4 in an era`.
- **MRE smelting:** `MRE melts any soil: a plain pit serves it as well as a deposit`.
- **A water plant with no ice in reach** is a warning: `NO ICE IN REACH — the nearest
  mapped cold trap is 2:10 away (reach 1:30); map further or build nearer`.
- Dotted cells show the Level II and III bays and the bay apron. A faint ring shows
  each lit deposit's **full-size pit** and its heap (§6).

### 5.3 The hub's own roads

- Placing a hub plans its **spur** (docs/15 §3) **and a haul road** to the gate of the
  pit its first unit will take. Its rovers sinter both before they weld.
- A later pit's road is a haul-road job for free rovers (docs/15 §5), laid when a
  unit is first assigned there.
- **Auto roads keep out of a deposit's full-size pit ring** where they can: +2 per
  cell inside it in the A* (a soft cost). A road there would box the pit in
  (§11.4).

---

## 6. Resource highlighting

### 6.1 What lights, and how

It shows while **placing** a hub and while one is **selected**. On touch, the first
tap on the hub's card or on the hub is enough.

| Hub | Lit | Also shown, dimmer |
|---|---|---|
| Regolith Smelter (H₂) | ◆ high-Ti basalt | ○ glass (`O₂ +60%`), ☢ KREEP (`reactor make-up at 15%`) |
| Regolith Smelter (MRE) | its plain pit and any pit it works: `MRE melts any soil` | — |
| Silicon Refinery | ◇ anorthosite | — |
| Water Management Plant | ❄ cold-trap ice · ≈ mature soil (off the ice) | — |

| State | Drawn | Label |
|---|---|---|
| Lit, not dug | the kind's own ring pattern (docs/05), **twice as thick**, with a faint fill; the full-size pit ring dashed outside it | `◆ 0:15 · 1/5 · 12k▲` (one way · faces now/at full size · ore) |
| Lit, a pit | as above, plus the pit's **current rim** as a solid line and the ore still in the ground as a hatched band | `◆ 0:15 · 2/3 · 8.4k▲ · pit 18 m` |
| Lit, unsurveyed | the same rings | `◆ 0:15 · ?/? · ?▲` |
| Lit, out of reach | half weight | `◆ > 1:30` |
| **Full** | the ring broken into long dashes | `◆ FULL 3/3 · 0:15` |
| **Exhausted** or **boxed in** | cross-hatched | `◆ EXHAUSTED` · `◆ BOXED IN — Deep Coring` |
| A plain pit | a plain solid rim with its heap outline | `P4 · q 0.62 · 3/3` |
| Not this hub's kind | the usual ring at 30% | none |

- **Never colour alone** (docs/07 §6a): weight, pattern, fill and label carry every
  state. Classic palette keys: `depositLit`, `depositFull`, `depositSpent`,
  `pitRim`.
- **Time.** The nearest lit deposit's time comes from the planned haul road (§5.3).
  Other labels use the straight line × 1.3 plus the off-road leg, marked `≈`.
- **The Lunar Map's SITE view** draws the same states from `$deposits`, which gains
  `lit`, `state`, `eta`, `faces`, `ore`, `pitR` and `fullR`. Opening the map with a
  hub selected keeps the highlight.
- **Classic and High detail** share the overlay's draped line segments
  (`Game.rebuildDepositOverlay`); High adds an emissive rim line. Nothing depends on
  hover.
- The overlay turns itself on for a hub's ghost, as it does for an excavator's today
  (`src/core/game.ts:695`).

### 6.2 Cost

- Rings are today's merged line mesh; lighting swaps materials. Rim lines are re-draped
  when a pit is carved (§11.6), at most once a second.
- Labels are the overlay's DOM markers (`updateDepositMarkers`,
  `src/core/game.ts:1864-1886`) with a longer string.
- ETAs are recomputed when the ghost changes cell, and at most 4 times a second for a
  selected hub.

---

# Part 2 · Strip mines: pits, grade, reserves and surveys

## 7. The physical basis

| Fact | Value | What the game does with it |
|---|---|---|
| Loose regolith depth | maria 4–5 m; highlands 10–15 m; over harder, fractured bedrock (the megaregolith) | a pit's loose layer: mare ground 4–5 m, highland ground 10–15 m (§8.5) |
| Oxygen | about 40% of regolith by mass, in oxides | Molten Regolith Electrolysis gets O₂, Fe, Si and Al from any regolith: MRE is q 1.0 everywhere |
| Hydrogen reduction | needs ilmenite (FeTiO₃) | the H₂ smelter's grade is ilmenite content |
| Mare ilmenite | 1–10%+ | plain mare ground 4%; high-Ti basalt 9–13% at the centre |
| Highlands | anorthosite-rich (plagioclase feldspar), poor in iron | good refinery feed; poor H₂ feed (3% ilmenite equivalent) |
| Polar ice | about 5 wt% (LCROSS 5.6 ± 2.9%) | the water plant's grade is ice wt% ÷ 5 |
| Water per tonne | 1 t of water needs about 20 t of regolith, about 13 m³ | why ice pits are big |
| Bulk density | about 1.5 t/m³ (loose 1.3, compacted 1.8) | ▲ = 1 t; a pit's volume is tonnes ÷ 1.5; a heap stacks at 1.3 |
| Angle of repose | about 35° for loose regolith | heap sides at 35°; pit walls at 1:2 (27°), safely below it |
| Space weathering | darkens the surface over millions of years (nanophase iron, agglutinates); fresh material is brighter | the cut and the heap are brighter than the ground around them (§20) |

**Game units.** ▲ is a tonne. Products (◆ ○ ≈ ◇) stay game units: each hub's recipe
at q 1 is today's. A smelter eats 2 t/s, about 1.3 m³/s. One lunar day (720 s) of one
smelter at full hunger is 960 m³ of hole.

## 8. Every extraction site is a pit

### 8.1 Shape and growth

A pit is an inverted, terraced cone around its centre. Units dig it **concentrically**:
down first, then outward.

| Phase | Shape | Volume |
|---|---|---|
| Opening | a cone with 1:2 walls, deepening as it widens, until it reaches the loose layer's depth L (rim radius 2L) | π R² (R/2) / 3 |
| Widening | a flat floor at depth L, the walls retreating outward at 1:2 | π L/3 × (R² + R·r + r²), with r = R − 2L |
| Deepening | with Deep Coring only: benches below L into bedrock (§8.5) | + the bedrock benches |

- **The rim radius R** follows the dug volume: R is solved from `dugM3` by bisection,
  over the samples the pit may dig.
- **What a pit may not dig** (its no-dig mask): building pads and their two-sample
  skirts (`padMask`, `src/terrain/heightfield.ts`), a sample either side of any road
  cell but its own approach stub, other pits and every heap, samples graded by Site
  Grading, and the map's border ring.
- **Near a wall** the pit's depth is capped at half its distance to the nearest
  no-dig sample, so its walls stay 1:2 everywhere. A blocked side makes the pit grow
  faster on the free sides: it is no longer round.
- **Monotone.** A carved sample never rises again, except by Reclaim (§12.2).

### 8.2 Benches are the faces

- **Faces = floor(free rim length / 30 m), clamped to 1–6.** The free rim is the part
  not against a no-dig sample. A bucket wheel needs about 30 m of bench to work.
- A new pit has **1 face**. The 2nd opens at R 9.6 m (about 680▲ dug), the 3rd at
  14.3 m, the 4th at 19.1 m, the 5th at 23.9 m and the 6th at 28.6 m. A full-size
  mare deposit pit (R 24–34 m) holds 5–6. A pit boxed in on half its rim has half as
  many.
- **One unit per face.** A face is held from assignment until the unit leaves, so
  auto units never find a pit full.
- **Face points** are evenly spaced on the rim from a seeded angle. Each unit works
  its bench: the floor while the pit opens, then the wall's toe as it widens.
- The UI shows `faces used/now · at full size`: `2/2 · 5`. An unsurveyed deposit
  shows `?`.
- This is the old slot rule with the right cause: a small pit cannot hold many
  diggers. **Research never adds faces** (the player's answer to Q4).

### 8.3 The ramp

- Every pit keeps a ramp on its gate side: an 8 m wide band spiralling down the wall
  at 1:4 (1 m per 4 m cell, inside the road A*'s 1.6 m step, so units can climb it).
- **It costs trip time:** 4 m of off-road driving per metre of depth. A 4.5 m mare
  pit adds 18 m (7 s each way at base speed); a 12 m highland pit adds 48 m (19 s).
  A deeper hole is a slower one.
- The ramp is one lane. Units yield at its top as at a junction (docs/15 §6).

### 8.4 The tailings heap

- Most of what a hub is fed comes back out: **70% of the mass returns as tailings**
  (slag, spent regolith, the rejects of beneficiation). Units carry it back and dump
  it at their pit's heap on the way out (4 s a trip). The heap's volume is therefore
  **0.81 × the pit's volume** (70% of the mass, stacked loose at 1.3 t/m³).
- **Where:** beside the pit, a quarter turn from its gate, just outside its full-size
  ring (a deposit's) or its three-lunar-day ring (a plain pit's). It is chosen when
  the pit opens, on mapped open ground clear of structures and roads.
- **Shape:** a flat-topped dump, at most 6 m high, sides at 35°.
- A heap is no-dig for every pit and no-build (§11.3). So the pit and its heap
  together are the scar: about 1.6× the pit's own area.

### 8.5 The loose layer and bedrock

| Ground | Loose layer L | Below it |
|---|---|---|
| Mare plain ground; high-Ti basalt, glass, KREEP deposits (mare and lava tube) | 4–5 m, seeded per pit | fractured basalt |
| Highland plain ground (the pole); anorthosite deposits anywhere | 10–15 m | fractured anorthosite |
| Cold-trap ice | the ice-bearing layer, 3–6 m (the pole's starter trap 5–6 m) | dry regolith: nothing to gain |
| Mature soil (solar-wind volatiles) | the volatile-bearing top 2 m | regolith with too little volatiles: nothing to gain |

- A pit **widens at L**. It goes no deeper without Deep Coring.
- **Deep Coring** (E4, §14.3) lets units cut **2 more benches (4 m) into bedrock**, and
  Deep Sounding (E7) one more. Bedrock digs at **×0.3**, draws +25% while units are on
  it, and carries **80% of the grade** above it. That is the ore under the bed:
  slow, costly and there.
- Ice and mature soil have no bedrock bonus: below their layer there is nothing to
  dig for.

### 8.6 Plain pits: where they go

- A smelter or refinery with no wanted deposit worth more in reach digs a **plain
  pit**. The hub's ghost stakes one when it is placed. **Open pit…** stakes another
  later.
- **The proposal:** the nearest mapped open ground 20–60 m from the hub's door, on the
  side away from the base's centre, whose three-lunar-day extent and heap are clear
  of structures, roads, other pits and extraction zones. On a crewed base it also
  prefers ground away from habitats (§12.1).
- **Refusals:** `TOO CLOSE — a pit needs 8 m from structures and roads` ·
  `A DEPOSIT — Assign it instead` · `UNMAPPED GROUND`.
- A plain pit is an extraction zone of its own (kind `plain`): auto roads stop at its
  rim and units drive off-road inside (docs/15 §5a).
- A plain pit is never exhausted by grade. It ends only when it is **boxed in** (§10.2).
- Water plants never dig plain ground at the pole: there is no ice outside the
  shadows.

## 9. Grade and yield

### 9.1 The grade table

**q** is a load's grade against the recipe's reference. The hub's output is recipe ×
q, and it holds a q EMA of its loads.

| Hub (process) | Measure | Reference (q 1) | Plain ground, robots | Plain, crewed (×1.25) | Deposits (centre → edge) |
|---|---|---|---|---|---|
| Smelter, H₂ reduction | ilmenite wt% | 6.5% | mare 0.62 · highland (pole) 0.45 | 0.77 · 0.56 | high-Ti basalt 9–13% → q 1.4–2.0 at the centre, falling to plain at 1.3× its ring · glass: metals 1.0–1.3 and O₂ ×1.6 · anorthosite 0.3 · KREEP 0.5 |
| Smelter, MRE | oxide content | any regolith | 1.0 | 1.0 | 1.0 everywhere |
| Refinery | plagioclase, iron-poor | 75% | highland 1.0 · mare 0.8 | 1.25 · 1.0 | anorthosite 92–100% → q 1.23–1.33 · high-Ti basalt 0.6 |
| Water plant, ice | ice wt% | 5% | 0 (no ice outside cold traps) | 0 | cold traps 3–9% → q 0.6–1.8 (the starter trap 8–10%) |
| Water plant, solar wind | volatile content | mature soil's centre | 0.4 | 0.5 | mature soil 1.0 at the centre |

- **Mare regolith is as rich in silica as any.** Its iron and titanium contaminate the
  wafer-grade route, which is why mare ground is 0.8 for a refinery.
- **Beneficiation** (the mare's smelting doctrine) concentrates ilmenite at the face:
  the H₂ smelter's q ×1.25, on any ground. Its other effects stay (inputs ×0.8,
  excavator draw ×1.3). Its rejects go to the heap.
- **Optical Ore Sorting** (E4): every pit's q ×1.1. It sorts at the face.
- The kind-share feed EMA stays alongside q, for the KREEP reactor rule and the
  panels.

### 9.2 One over grade: how much hole a product costs

The hole dug for 1,000◆ at the H₂ smelter's recipe (0.25◆ per ▲ at q 1), and its
heap:

| Fed from | q | Tonnes dug | Hole | Floor area at mare depth (4.5 m) | Heap |
|---|---|---|---|---|---|
| a deposit's centre | 1.8 | 2.2k▲ | 1.5k m³ | 330 m² | 1.2k m³ |
| a deposit, on average | 1.3 | 3.1k▲ | 2.1k m³ | 460 m² | 1.7k m³ |
| mare plain, crewed | 0.77 | 5.2k▲ | 3.5k m³ | 770 m² | 2.8k m³ |
| mare plain, robots | 0.62 | 6.5k▲ | 4.3k m³ | 960 m² | 3.5k m³ |
| pole plain, H₂, robots | 0.45 | 8.9k▲ | 5.9k m³ | 490 m² (12 m deep) | 4.8k m³ |
| pole, MRE (0.325◆ per ▲) | 1.0 | 3.1k▲ | 2.1k m³ | 170 m² (12 m deep) | 1.7k m³ |

So plain ground is **proportionally slower**: the furnace makes half the metals. It
is also **proportionally more destructive**: the pit is two to three times wider per
metal.

### 9.3 Crews and robots on plain ground

| | Robots only | With crew (2 or more aboard) |
|---|---|---|
| How they dig plain ground | in bulk: every bench as it comes | a field geologist **high-grades** the pit: fresh ejecta, darker patches, the better seams. q ×1.25 |
| Yield · hole per product | the lowest · the biggest | +25% · 20% smaller |
| Morale | none | strip mines near homes cost morale (§12.1) |
| On deposits | the same for both | the same for both: the whole bench is ore |

So a crewed base digs plain ground better but feels it, and a robotic base digs it
worse and just pays in time and ground: "much slower and more destructive".

### 9.4 What it means for the early game

**Does the starter smelter still work with no deposit in reach? Yes.** It stakes a
plain pit and digs at plain grade. It is never zero, only slower.

| Site | Smelter's first ground | What changes |
|---|---|---|
| Mare, lava tube | the guaranteed high-Ti basalt 30–50 m out | Better than today at first: the centre is the richest ground (q 1.4–2.0 against today's 1.3). Metals start about 3 min earlier, since the smelter needs no research. |
| Pole | a plain pit: there is no ilmenite at the pole | H₂ on highland ground is poor: q 0.45 (robots) or 0.56 (crew). **MRE**, the pole's natural doctrine, fixes it (q 1.0), so the pole researches it **first in Era 2**, not in Era 4 as the probe does today. Until then its metals run at about half. |

The pole reaches Era 2 by four techs as easily as by the metals deed (one of three
pole robotic runs did so today). So its Era 1 stretches by 0–4 min, not by half. The
cost is fewer metals for its first builds (§17.3).

## 10. Reserves and exhaustion

### 10.1 How much ore a deposit holds

Every deposit's ore is derived from the seed and its id:

```
rng       = mulberry32(seed ^ 0x7e5e ^ hashString(deposit.id))
L         = loose-layer depth, from its range (§8.5)
g_centre  = centre grade, from its range (§9.1)
g(ρ)      = g_plain + (g_centre − g_plain) × max(0, 1 − (ρ / 1.3 r)²)    — the ore halo reaches 1.3 × the ring
cutoff    = g_plain + 15% × (g_centre − g_plain)
ore       = every tonne the pit cuts, from its opening to the cutoff, with its grade
```

- **The ring is where the ore shows at the surface.** The bed thins out past it, to
  1.3× the ring. A survey draws that halo.
- **The grade of the cut** is the mean grade across the wall being cut: the floor's
  ground while the pit opens, then the band from R − 2L to R as it widens. So a pit
  starts rich and gets leaner as it grows: **the lean tail is the geometry**, not a
  rule.

**What that makes on the probe's seeds** (full-size pit radius, ore tonnes, the
average q of it all, the product it holds, and faces at full size):

| Seed | Mare ◆ | Pole ❄ (starter · the rest) | Lava ◆ |
|---|---|---|---|
| 42 | #0 r19 @45: R28 · 12.2k▲ · q 1.08 · 3.3k◆ · 5 faces · #3 @131: 10.5k▲ · #2 @141: 8.8k▲ · #1 @302: 17.6k▲ | #0: R19 · 5.0k▲ · 930≈ · the rest 1.6–3.9k≈ each | #0 r24 @49: R34 · 19.4k▲ · 5.3k◆ · #1 @141: 8.0k▲ |
| 7 | #0 r19 @32: R27 · 11.2k▲ · q 1.20 · 3.4k◆ · 5 faces · #1 @53: 14.0k▲ · #3 @65: 12.3k▲ · #2 @234: 10.8k▲ | #0: R19 · 4.9k▲ · 830≈ · 1.8–5.6k≈ | #0 r19 @32: R27 · 11.2k▲ · 3.4k◆ · #1 @53: 14.0k▲ |
| 1234 | #0 r25 @41: R34 · 17.7k▲ · q 1.35 · 6.0k◆ · 6 faces · #1 @71: 16.9k▲ · #2 @118: 15.8k▲ · #3 @242: 10.7k▲ | #0: R22 · 7.4k▲ · 1,360≈ · 1.9–4.6k≈ | #0 r23 @36: R32 · 15.5k▲ · 5.2k◆ · #1 @106: 14.8k▲ |

- **Mare ilmenite:** 48–61k▲ across four deposits, against 18–24k▲ that mare smelters
  dig in a run. There is room to expand, and no room to stay put.
- **Pole ice:** the starter trap holds 830–1,360≈ (it is seeded rich: 8–10 wt%, 5–6 m).
  The other six hold 18–20k≈ together, against 2.6–2.9k≈ of ice water a crewed run
  uses. Ice is scarce near the Lander, not on the map.
- **Anorthosite** is deep highland ground (10–15 m): 64–114k▲ a deposit. A refinery's
  anorthosite pit never runs out in a run. It gets **deep**: 12 m, six benches.
- **The lava tube** holds 25–30k▲ of ilmenite in two deposits, against about 30k▲ its
  smelters dig. After them come its glass beds (metals q 1.0–1.3), then Deep Coring,
  then plain ground (§18.3).

### 10.2 When a pit is done

| State | When | What happens | Alert |
|---|---|---|---|
| running out | 1 lunar day of ore left at the current dig | the card and the hub show it | `DEPOSIT RUNNING OUT — high-Ti basalt #0: ~1 lunar day of ore left at 2 units · survey the next one [I]` (warn, once) |
| **exhausted** | the cut's grade has fallen to the cutoff | its ore is gone. Units re-route to the best choice left (§4.4). The pit stays open: a smelter or refinery may keep digging it as a plain pit. A water plant's never does | `DEPOSIT EXHAUSTED — high-Ti basalt #0's ore is dug out · Smelter #3's 2 excavators go to high-Ti basalt #3 (0:41) · feed q 1.1 → 1.3` (warn, select the hub) |
| **boxed in** | it can neither widen (its whole rim is against no-dig ground) nor deepen (bedrock without Deep Coring, or at Deep Coring's limit) | its units re-route; ore may still lie under the structures that hem it in | `PIT BOXED IN — high-Ti basalt #0 is hemmed in by Solar Array #7, the Lander's apron and a road; 2.1k▲ of ore stays in the ground · Deep Coring digs 4 m below it` |
| no other choice | nothing else in reach | a smelter or refinery keeps the exhausted pit, or opens a plain pit; a water plant's units park | `… nothing richer in reach: they dig on at plain grade (q 0.62) — a Smelter by high-Ti basalt #3 would feed q 1.3` |
| unsurveyed | the same, with no warning | | `… (never surveyed — a survey would have warned you a lunar day ahead)` |

- **Re-routing is base behaviour**, with or without the Builder.
- Exhausted and boxed-in pits stay extraction zones, with their gate and roads.

### 10.3 Deep Coring and Deep Sounding

- **Deep Coring** (E4): every pit may cut 2 benches (4 m) into bedrock. Exhausted
  and boxed-in pits reopen for it: `DEEPER BENCHES — high-Ti basalt #0 reopens:
  ~5.6k▲ of ore in bedrock at ×0.3 dig (Deep Coring)`.
- **Deep Sounding** (E7): one bench more.
- Bedrock ore is slow ore: a unit on a bedrock bench delivers under half of what it
  delivered above, at +25% draw. It saves a hemmed-in pit next to the base; it does
  not replace moving on.

### 10.4 Expansion: the map is the answer

| Pressure | The answer | System |
|---|---|---|
| The near deposits are dug out | Map further: T1 REGIONAL shows deposits to 320 m, T2 the whole map | Prospecting Rovers (E1), Orbital Prospector (E4); docs/05 |
| The next deposit is outside the build network | Grow the network toward it | Relay Masts (45 m, chaining), Habitats (60 m) |
| It is too far to haul from the old hub | Build a new hub by it | §5; the Builder's relocation (§15) |
| Every local ilmenite is gone | Claim an ilmenite outpost: 0.20◆ 0.08○ a second with no pit | Lunar Map outposts (T2+, docs/11) |
| The base hems its pits in | Deep Coring, or build clear of full-size rings next time | §10.3, §11.3 |
| The base is scarred | Reclaim worked-out pits | §12.2 |

### 10.5 Determinism

- Depth, grades, the halo, face angles and the survey's estimate offset are functions
  of `(seed, deposit id)`, or `(seed, pit id)` for plain pits. They are derived, never
  stored.
- A pit's growth depends only on its dug volume and the no-dig mask at each carve.
  Carving runs in the economy tick, pits in id order, in integer decimetres.
- Unit choices run in id order with fixed tie-breaks (time, then pit id, then face).
  There is no randomness.

## 11. The terrain deforms

### 11.1 The height-delta grid

The sim heightfield (`Heightfield.h`, 257 × 257 samples at 4 m) gains a companion
**delta grid**: an `Int16Array` of decimetres, 0 almost everywhere.

- **Carving.** When a pit's rim moves 0.5 m, step 4.2 computes the target depth of
  each sample in the pit's bounding box (the cone or floor, the walls near no-dig
  ground, the ramp band) and writes `delta = min(delta, −target)`. The heap does the
  same upward: `delta = max(delta, +height)`. `h` changes by the same amount.
- **A carve step touches about 80–200 samples** (the band being cut) and happens every
  few minutes a pit: 0.5 m of rim on a 20 m mare pit is about 280 m³, or 3.5 min of
  one smelter's hunger.
- `s.terrain.rev` counts carves. Every terrain-keyed cache keys on it (§11.2).

**Why a delta grid, not per-pit parameters.** Per-pit parameters (centre, R, dug
volume) are smaller, but they cannot rebuild the true shape. The shape depends on the
no-dig mask at the moment of each carve, and that mask changes. A building that was
demolished no longer shields the ground it stood on, so replaying the pit from its
parameters today would carve under the old pad. The delta grid records what was
actually dug, exactly, and costs little (§11.5). Pits keep their parameters too, to
go on growing.

**Order with flattens.** Building pads keep their `s.flattens` replay (absolute pad
heights). Pits and heaps never touch a pad or its skirt, and a flatten never lands on
a pit. Site Grading may level a heap, and those samples are never dumped on again.
So on load: **base → deltas → flattens**, and the result is exact.

### 11.2 What reads the terrain

| Reader | How it sees pits | Change |
|---|---|---|
| Placement's relief check (`maxDelta`, `MAX_SLOPE_DELTA` 2.5 m, large pads 0.8 m) | a footprint across a rim or on a heap fails on relief | plus explicit refusals and warnings (§11.3) |
| Road A* (step ≤ 1.6 m per cell, +0.6 per m) and `roadReach` | pit walls (2 m a cell) and heaps (up to 2.8 m a cell) are walls | `roadReach` and route caches key on `terrain.rev` as well as the network (§11.4) |
| Zones and gates (`src/core/zones.ts`) | a pit's zone is its deposit's ring or its rim + 4 m, whichever is bigger; plain pits are zones | `zonesFrom` gains pits; a zone that grows bumps `roadRev` |
| Transit and traffic | 2D, as now; the ramp is a lane with a junction at its top | the sim adds the ramp to off-road legs (§8.3) |
| Unit and rover visuals | height from `hf.sample` | none: they follow the ground |
| Walk mode | the same | none |
| Shadows | terrain chunks cast them | `onShadowCastersChanged` after a rebuild, throttled (§11.6) |
| Rocks (`src/terrain/rocks.ts`) | none inside a pit or heap | re-scatter the affected chunk, skipping carved samples |
| The deposit overlay, road mesh and decals | draped on the ground | re-drape rings and rims after a carve; roads are never carved, so they don't move |
| The horizon ring | outside the map | none |

### 11.3 Building near pits, and Site Grading

| Where | Placement says |
|---|---|
| on a pit or heap sample | refused: `ON A PIT — its benches go 4.5 m down; build 4 m back from the rim` · `ON SPOIL — a tailings heap; level it with Site Grading, or build elsewhere` |
| within 4 m (one cell) of a rim | refused: the same words |
| inside a deposit's **full-size pit ring** or a plain pit's three-lunar-day ring | a **warning**: `IN THE PIT'S WAY — the pit stops at this wall; ~20% of its ore stays in the ground` (the first click asks, the second builds) |
| beside a heap | nothing new: the relief check decides |

**Site Grading** (the grade action, 40 stored energy a 16 m pass):

- **On a heap: allowed.** A pass levels the heap's samples in its square to their
  mean, spreading the spoil. It costs 40 energy × (1 + the square's relief ÷ 2 m).
  Those samples are never dumped on again.
- **On a pit: refused.** `CANNOT GRADE — a pit (4.5 m deep): grading cannot fill it;
  Reclaim it once it is worked out`. Filling a hole needs the spoil hauled back, which
  is Reclaim's job (§12.2).
- **On reclaimed ground: allowed**, as on any ground.

### 11.4 Roads, zones and gates

- **Roads never cross a pit.** Auto roads never enter a zone. The road tool may, but
  its A* cannot step down a 2 m bench or a heap's side, so it reaches the rim and
  stops. Only units go down, by the ramp.
- **A pit never digs a road cell.** It stops a sample short of any road, with one
  exception: its own haul road's last cells. As the rim advances over them, they are
  removed and the gate steps back.
- **Every other road is a wall** for the pit. That is how a careless base boxes in its
  own pits. The A*'s soft cost keeps auto roads out of full-size rings (§5.3).
- **Gates** are recomputed when a zone grows: the rim cell nearest the network, as
  today (docs/15 §5a).

### 11.5 Saving

- `s.terrain.delta` holds the grid as sorted `(index gap, value)` pairs: varint gaps,
  int16 values, base64.
- **Size:** a full-size mare deposit pit and its heap touch about 250–400 samples,
  about 1 KB raw and 1.3 KB in base64. A base with 8 pits comes to about 10 KB.
- `s.pits` stores each pit's growth parameters (§4.6). Nothing derived is stored.
- A save from before pits has no delta: nothing is carved (§19).

### 11.6 Rendering and cost

- **Only the affected chunks are rebuilt.** A carve marks its bounding box. The
  renderer rebuilds the 1–4 chunks it overlaps (`TerrainChunks.rebuildAround`,
  `src/terrain/chunks.ts:110-123`), at most one chunk a frame and two a second, from
  a queue. A chunk is 33 × 33 vertices, so a rebuild is cheap.
- **Shadows** refresh at most once every 2 s.
- **Classic and High detail** both build from `h`. Classic's faceted triangles show the
  benches as facets. High's smooth normals show them as rings, and bench lips add
  the edges (§20).
- The sim never waits on the renderer. A carve is a state change like any other.
  Sim time the visuals never showed (a load, a debug advance) rebuilds every changed
  chunk once.

## 12. Strip mines and morale

### 12.1 Morale

A crewed base minds the scars it lives beside.

| | Morale target |
|---|---|
| Plain pit and its heap | −1 per 1,000 m² of scar |
| A deposit's pit and its heap | −0.4 per 1,000 m²: the mine they came for |
| An exhausted or boxed-in deposit pit | counts as plain: a dead hole |
| Reclaimed ground | ×0.2 |
| Distance | full within 100 m of a habitat or the crewed Lander, fading to 0 at 250 m |
| Cap | −12 in all (crowding is −20, a blackout −15) |

- A mare deposit pit at full size (with its heap, 4–6k m²) next to the base costs −2.
  A plain refinery pit of the same size costs −5.
- The morale panel shows the term and its worst pit: `Strip mines −4 · plain pit P4,
  80 m from Habitat #2`.
- **Robotic bases have no morale.** Their cost is time and ground (§9.3).
- **Why deposits cost less:** a deposit pit is the purpose of the base, and it closes
  up once it is worked out. A plain pit near a home is scraping the view for scraps.

### 12.2 Reclaim

- **Reclaim** on a pit's card, for an exhausted, boxed-in or unworked pit. Its hub's
  units (or the nearest hub's) push its heap back into it instead of digging.
- **Rate:** a unit's dig rate with no haul, about 840 m³ a lunar day. Two units push
  a full-size mare pit's heap (about 6.5k m³) back in about 4 lunar days.
- **Result:** the heap is gone and the pit is filled to about −1 m. The
  unrecovered 19% is the product that left, plus settling. The ground is buildable.
  The scar counts ×0.2.
- The zone closes; the deposit, if any, stays mapped and EXHAUSTED.
- Units on Reclaim draw power and wear, and make nothing. Solar fields on old pits
  are the natural reuse.

## 13. Surveys

### 13.1 What the player knows, in three steps

| Step | Shows | How |
|---|---|---|
| **Lead** `?` | "possible high-Ti basalt", roughly where | orbital data within 400 m (`LEAD_RANGE_M`) |
| **Mapped** | the kind, its ring and zone, a **size class** (`a small patch` < 1,000 m² · `a bed` · `a broad bed` ≥ 2,000 m²); ore and faces `?` | the survey tier's radius, a Relay Mast, or building on it (`depositRevealed`, `src/core/exploration.ts:69-73`) |
| **Surveyed** | ore tonnes (a range), centre grade, the loose layer's depth, the ore halo, faces now and at full size, the full-size pit ring, the life at the current dig | a **deposit survey** |

### 13.2 The deposit survey

| | |
|---|---|
| Verb | **Survey** on the deposit's card, on a lit label, or in a hub's pit list. Action `surveyDeposit { id }`. |
| Who | A **free construction rover**, as a job taken before road jobs (docs/15 §3). It drives to the gate, off-road to the centre, and cores. A Drone Hive's drone flies straight to it. |
| Cost | 30 stored energy (the core drill), 2⚙ (bits), 40 rover-seconds at the deposit. |
| Pays | +5≡: the cores go to the labs. |
| Road | The rover needs the gate. With none, the survey plans the road a hub will use later. |
| One at a time | Per deposit. They queue, and do not use the Lunar Map's survey slot. |
| Result | `SURVEYED — high-Ti basalt #0: 8.5k–15.9k▲ of ore (±30%) · centre 11% ilmenite (q 1.7) · loose to 4.4 m · 1 face now, 5 at full size (R 27 m) · ~8 lunar days at one smelter · +5≡` |
| Refusals | `UNMAPPED — map it first (Prospecting Rovers, a Relay Mast)` · `ALREADY SURVEYED (±15%)` · `SURVEY NEEDS 30 STORED ENERGY — have 12` · `SURVEY NEEDS A FREE ROVER — it waits in the queue` |

**What it reuses:** `surveyIce` (retired, `src/core/game.ts:912-915`) had the survey
paid in stored energy (`ICE_SURVEY_COST`), and its action now points to the new verb.
The Lunar Map's local survey (`SURVEY_CLASS.local`: 60 energy, 60 s) had the
lent-rover model. Map prospects keep their own survey, slot and data. Relay Masts keep
mapping within 45 m, and with Neutron Spectrometry they also survey ice and
mature-soil deposits in their radius.

### 13.3 Precision

| Source | Ore and centre grade shown as |
|---|---|
| A first survey | ±30% |
| Sample-Return Caches (E1) | ±15% |
| Gravity Gradiometry (E5) | ±5% |
| Digging it | the grade of the cut is always shown; the ore left stays an estimate |

- The estimate's centre sits off the truth by a seeded share of up to half the
  precision, so the truth is always inside the range.
- A deposit surveyed before a precision tech is re-read free when it completes:
  `SURVEYS RE-READ — 4 deposits now ±15%`.

### 13.4 The deposit and pit card

`src/ui/depositCard.ts` gains an ore block and a pit block above its guide lines.

```
◆ HIGH-TI BASALT #0 · surveyed 3:12 · ±15%
ore     ▮▮▮▮▮▮▯▯▯▯  8.4k▲ left of 12.2k (±15%) · cut now q 1.3, centre q 1.5 · ~2.3k◆ at your smelter
pit     R 18 m of 28 · 4.4 m deep (loose to 4.4, then basalt) · faces 2/3 now, 5 at full size · heap 2.0k m³
life    ~5.8 lunar days at 2▲/s (2 units)
served  Smelter #3 (2 excavators, trip 0:15)
[Survey] [Select Smelter #3] [Show on the map] [Reclaim — once worked out]
```

- **Unsurveyed:** `ore ? · a bed (1,466 m²) · faces ?`, with **Survey** first.
- **Exhausted:** `EXHAUSTED at 1:24:10 · dug 12.2k▲ · the pit stays open (plain grade) ·
  Deep Coring: ~5.6k▲ more in bedrock · Reclaim`.
- **A plain pit's card:** `PLAIN PIT P4 · q 0.62 (robots) · R 22 m · 4.5 m deep · 3/3
  faces · scar 2.6k m² (−2 morale)` (the last only on a crewed base).
- The card's `todo` lines name the hub: `Build a Regolith Smelter by it: its
  excavators dig it`. The ice guide names the water plant.

---

# Part 3 · Everything it touches

## 14. Research

### 14.1 Regolith Smelting retires

`regolithProcessing` ("Regolith Smelting", E1 ◆, 30 → 48≡,
`src/data/techs.ts:214-221`) unlocks the smelter. The smelter is now known from
landing, so the tech has no job left.

**The replacement is Pit Mapping** (`pitMapping`, E1 ◆), in the old slot at the old
price, 30 (48≡). That is below the Era 1 median (90) on purpose: the first research
stays the cheap one, so Era 1's charter, the bot's opening and the tutorial keep
their timing.

| Where | Today | After |
|---|---|---|
| `src/data/techs.ts` | the tech; `requires` of Silicon Refining, Parts Fabrication, MRE, Beneficiation, Heat-Recovery Jackets, Basalt Paving | replaced by `pitMapping`; those six require nothing new (Beneficiation keeps Prospecting Rovers); `TECH_ALIASES.regolithProcessing = 'pitMapping'` |
| Charters | E1: 8 visible at the mare, 9 at the pole and lava tube | unchanged: one out, one in |
| `migrateTechSchema` (`src/core/research.ts:985`) | techSchema 4 | **5**: done, queued, spent and insight entries move to `pitMapping` |
| Milestone First Metal (`src/data/milestones.ts:81-88`) | Lab · research Regolith Smelting · Smelter · 100◆ | **Lab · Smelter · 100◆**. Hint: `Smelt 100 metals. Build a Research Lab too: research is how your hubs' robots dig faster, haul more and go deeper.` |
| Milestone Dig In (`:75-80`) | Excavator · 50▲ in stock | **Smelter · 50▲ delivered** (`stats.produced.regolith`). Hint: `Raise a Regolith Smelter by the high-Ti basalt (it lights up when you pick it): its excavator opens the pit and brings in the first 50▲. Survey the deposit first to see what it holds.` |
| The smelter trap (`src/core/game.ts:1013-1022`, `smelterWarning`, `src/buildings/placement.ts:59-68`) | `METALS LOW — research Regolith Smelting, then build a smelter` | the research half goes; the metals half stays: `METALS LOW — a Regolith Smelter costs 48◆ with its excavator; without one you cannot make more` |
| Discovery (`smelterFirst`, `src/ui/discovery.ts:152-157`) | "No smelter yet: research Regolith Smelting next" | deleted |
| `placement.ts:66` | "research Regolith Smelting to unlock it" | deleted |
| The probe (`scripts/probe-pacing.mjs:142`, `:284`) | first in the order; the smelter's unlock | `pitMapping` first; at the pole, MRE first in Era 2 (§9.4) |
| Tests: 71 references in 14 specs | about 20 unlock the smelter; about 30 use it as the cheapest E1 tech; about 20 sit in E1 charter sets and old-id lists | unlock lines deleted; the rest use `pitMapping` (same era, cost and lane); the alias covers stragglers with a warning |
| Docs | docs/03's generated tables, docs/11's tech table | regenerated (`scripts/gen-tech-doc.mjs`); docs/11 points here |

### 14.2 The extraction ladder

Faster, more, quicker and deeper, era by era. New techs are in bold.

| Era | Speed | Capacity | Dig and grade | Hubs and bays | Surveys, reserves, pits | Water |
|---|---|---|---|---|---|---|
| E1 | **Pit Mapping** (off-road and ramps ×1.3) | Grizzly Screens (load ×1.1) | — | smelter and first unit from landing | Prospecting Rovers (surveys 2× faster, T1) · Sample-Return Caches (±15%) | Cryo Ice Extraction (pole) · Solar-Wind Volatiles (mare, lava) |
| E2 | — | — | **Hardfaced Teeth** (dig ×1.25) · Beneficiation (H₂ q ×1.25) · MRE (q 1.0 anywhere) | **Bay Extensions** (Level II) | Neutron Spectrometry (masts survey ice and soil) | Sublimation Tents (pole) |
| E3 | Basalt Paving (roads ×1.25) | — | Dust Mitigation (unit upkeep ×0.5) | Automated Excavation (the Builder) | Site Survey AI (the Builder surveys, plans pits) | **Water Reclamation** (⌂) |
| E4 | — | — | Optical Ore Sorting (q ×1.1) | — | **Deep Coring** (+2 bedrock benches) · Orbital Prospector (T2) | **Water Electrolysis** (⌂) · Heated Augers (pole) |
| E5 | Autonomous Haulage (speed ×1.3) | Autonomous Haulage (bucket ×1.25) | Feed Planner (multi-pit routing) | **Depot Halls** (Level III) · Fleet OS ◉ (+1 bay) | Gravity Gradiometry (±5%) | — |
| E6 | Guideway Rails (hauls on roads ×1.3) | — | Condition Optimization (×1.15) | — | — | — |
| E7 | Maglev Freight (roads ×1.3) | — | Self-Replicating Systems (×1.3) | Replicator Stacks ◉ (print ×0.5) | Deep Sounding (+1 bedrock bench) | Propellant Depot (the launcher water plants feed) |

- Every lever the player named has a rung in Eras 1–2: speed (Pit Mapping), haul
  (Grizzly Screens), dig (Hardfaced Teeth) and more units (Bay Extensions).
- **No renames.** Autonomous Haulage, Grizzly Screens and Guideway Rails already say
  what they do to a unit. Only their card lines change, to name the units they now
  reach.

### 14.3 The seven new techs

Costs are the era's median (docs/12 §2.4) after `ERA_COST_SCALE`: E2 240≡, E3 278≡,
E4 456≡, E5 580≡. Pit Mapping is the one exception (§14.1). Every con is numeric
and passes `auditTechs` (|m − 1| ≥ 0.05, or ≥ 1 kW).

| id · name | Era · lane | Cost | Requires | Effect (pro) | Con (numeric first) | `visual` | Builder · destiny · hazards |
|---|---|---|---|---|---|---|---|
| `pitMapping` · **Pit Mapping** | E1 · ◆ | 48≡ | — | `{ kind: 'haul', offroadMult: 1.3 }`: off-road legs and ramps at 0.65 of road speed (from 0.5) | +10% draw: Excavator, Ice Miner (`powerMult` 1.1) | "Excavators and Ice Miners mount a stereo camera boom over the cab." | shorter cycles, fewer units wanted · neutral · none |
| `bayExtensions` · **Bay Extensions** | E2 · ◉ | 240≡ | — | `{ kind: 'hubLevel', level: 2 }`: **+ Bay** at any hub (3 bays) | −1 kW each: Smelter, Refinery, Water Plant (`powerDelta`) | "Hubs raise a bay canopy over a third charging post." | the unit rule's holding line asks for a bay; only you or an order buy one · neutral · none |
| `hardfacedTeeth` · **Hardfaced Teeth** | E2 · ◆ | 240≡ | — | `{ kind: 'haul', digMult: 1.25 }`: a bucket fills in 48 s | +25% upkeep: Excavator, Ice Miner (`upkeepMult`) | "Bucket wheels and augers wear a band of hardfaced teeth." | faster cycles · neutral · pits grow and run out sooner |
| `waterReclamation` · **Water Reclamation** | E3 · ⌂ (crew tech) | 278≡ | any of Cryo Ice Extraction, Solar-Wind Volatiles | `{ kind: 'reclaim', water: 0.6 }`: while any Water Plant runs, crew and farm water ×0.6 | −4 kW: Water Management Plant (`powerDelta`) | "Water Management Plants add a greywater still: a squat tank with a vent stack." | the water rule builds fewer plants · ⌂ smaller ice pits · Contamination: the still is a loop (docs/14 §3.4) |
| `waterElectrolysis` · **Water Electrolysis** | E4 · ⌂ | 456≡ + 10⚙ | any of Cryo Ice Extraction, Solar-Wind Volatiles | a per-plant **Electrolysis** toggle (`{ kind: 'action', id: 'electrolysis' }`): 40% of the plant's water split into O₂, 0.89○ per ≈ · −40% inputs: Propellant Plant (`inputMult` 0.6) | −10 kW: Water Management Plant with the toggle on (`powerDelta`) · the H₂ is vented until a Propellant Plant stands | "Water Management Plants raise an electrolysis stack with heavy busbars and a flare mast." | the O₂ rule may pick a water plant at the pole · ⌂ air without a smelter · none |
| `deepCoring` · **Deep Coring** | E4 · ◎ | 456≡ + 10⚙ | Prospecting Rovers | `{ kind: 'pitDepth', benches: 2 }`: every pit may cut 4 m into bedrock (×0.3 dig, 80% grade); exhausted and boxed-in pits reopen | +10% draw: Excavator, Ice Miner (`powerMult`) · units on bedrock draw +25% more | "Excavators carry a rock-breaker arm, and deep pits get a bedrock bench with a drill rig." | reopened pits come back into reach · neutral · none |
| `depotHalls` · **Depot Halls** | E5 · ◉ | 580≡ + 20⚙ | Bay Extensions | `{ kind: 'hubLevel', level: 3 }` (4 bays) · `{ kind: 'hubPrint', timeMult: 0.75 }` | +15% upkeep: Smelter, Refinery, Water Plant (`upkeepMult`) | "Hubs roof their bays into a depot hall with a gantry." | the unit rule's per-hub cap grows · ◉ Fleet OS adds one more · Rogue drones: a depot hall is a priority-2 target |

**New effect kinds and fields.**

| Kind | Mods | Pro line | Con line |
|---|---|---|---|
| `haul` gains `offroadMult`, `digMult` | `haulOffroadMult`, `haulDigMult` | `+30% speed off-road and on pit ramps: Excavator, Ice Miner` · `+25% dig rate: …` | — |
| `{ kind: 'hubLevel', level }` | `hubLevel` (1) | `LEVEL II HUBS: + Bay at any hub (3 bays)` | `a bay costs 30◆ 10⚙ at the hub` (use) |
| `{ kind: 'hubBays', delta }` | `hubBays` (0) | `+1 bay: every hub` | — |
| `{ kind: 'hubPrint', timeMult?, costMult? }` | `hubPrintTime`, `hubPrintCost` (1) | `units print ×0.75 as fast` | — |
| `{ kind: 'pitDepth', benches }` | `pitBedrockBenches` (0) | `pits cut 2 benches (4 m) into bedrock; worked-out pits reopen` | `bedrock digs at ×0.3` (flag) |
| `{ kind: 'grade', mult, process? }` | `gradeMult` (1) | `+25% ore grade: the H₂ smelter` | — |
| `survey` gains `precision`, `depositTimeMult`, `mastSurvey` | `surveyPrecision` (0.3), `surveyTimeMult`, `mastSurveyKinds` | `deposit surveys ±15%` · `deposit surveys take 20 rover-s` · `Relay Masts survey ice and mature soil` | — |
| `{ kind: 'reclaim', water }` | `reclaimWater` (1) | `−40% water: crew and farms, while a Water Plant runs` | — |
| `action` gains `'electrolysis'` | `actions` | `ELECTROLYSIS: split water into O₂` | — |

`techRelevance`: `haul`, `hubLevel`, `hubBays`, `hubPrint`, `pitDepth`, `grade` and
`survey` are always relevant. `reclaim` and the electrolysis action are relevant
wherever a Water Management Plant can stand.

**Discovery `nextStep` lines** (`src/ui/discovery.ts`):

| Kind | Next |
|---|---|
| `unlock waterPlant` | `Pick the Water Management Plant: the ice lights up. Place it by the cold trap.` |
| `haul` | `Your units cross pits faster: shorter trips.` · `Buckets fill faster, and pits grow faster.` |
| `hubLevel` · `hubBays` · `hubPrint` | `Select a hub and press + Bay: a Level II hub holds 3 units.` · `Every hub has one more bay.` · `Hubs print their units faster.` |
| `pitDepth` | `Pits can cut into bedrock now: slow ore under dug-out and hemmed-in pits. See their cards [I].` |
| `grade` | `The ore grade your units bring in is better now.` |
| `survey` precision | `Surveyed deposits are re-read: their ranges are tighter.` |
| `reclaim` · `action electrolysis` | `Water Plants recover the base's water: less ice to dig.` · `Select a Water Plant and switch Electrolysis on: O₂ without a smelter.` |

### 14.4 Changed techs

| Tech | Era · lane | Change |
|---|---|---|
| Grizzly Screens | E1 ◆ | Unchanged (load ×1.1, draw ×1.15): the first capacity rung. |
| Prospecting Rovers · Sample-Return Caches · Gravity Gradiometry | E1 · E1 · E5 ◎ | + deposit surveys in 20 rover-s · ±15% · ±5%. |
| Cryo Ice Extraction | E1 ⌂ (pole) | Unlocks the **Water Management Plant** (ice, Ice Miners) instead of the Ice Harvester. |
| Solar-Wind Volatiles | E1 ⌂ (mare, lava) | Unlocks the **Water Management Plant** (mature soil, excavators) instead of the excavator's retort. Its −9 kW moves to the plant. |
| Silicon Refining, Parts Fabrication, MRE, Heat-Recovery Jackets, Basalt Paving | E2–E3 | `requires` loses `regolithProcessing`. |
| Molten Regolith Electrolysis | E2 ◆ (doctrine) | `feedInsensitive` now means q 1.0 on any ground. Unchanged otherwise. It is the pole's answer to poor ground (§9.4). |
| Ilmenite Beneficiation | E2 ◆ (doctrine) | `feedBonus ilmenite ×2` becomes `{ kind: 'grade', mult: 1.25, process: 'H2' }`. Its inputs ×0.8 and excavator draw ×1.3 stay. |
| Neutron Spectrometry | E2 ◎ | + Relay Masts survey ice and mature-soil deposits within their radius, free. |
| Sublimation Tents · Heated Augers | E2 · E4 (pole) | Re-pointed from `iceHarvester` to `iceMiner` (bucket ×1.15 each). |
| Dust Mitigation | E3 ◆ | Its excavator upkeep ×0.5 covers the Ice Miner too. |
| Automated Excavation | E3 ◉ | Its rule becomes "a hub prints a unit" (§15). Its con moves to −1 kW per hub (a dispatch mast). |
| Site Survey AI | E3 ▣ | + siting weighs haul time, grade and pit room for hubs; stakes plain pits clear of the base; queues surveys (§15). |
| Optical Ore Sorting | E4 ◆ | Output ×1.1 becomes `{ kind: 'grade', mult: 1.1 }`: the same number, said as what it is. |
| Orbital Prospector | E4 ◎ | + every mapped deposit shows a grade band (`lean` · `rich`) before a survey. |
| Rover Autonomy | E4 ◉ | Unchanged: it speeds rovers' welding, not units. |
| Autonomous Haulage | E5 ◉ | Unchanged (speed ×1.3, bucket ×1.25). |
| Feed Planner | E5 ▣ | **Multi-pit routing**: re-aims each unit, across hubs and pits, by intake (rate × q × the hub's hunger), and moves units off a pit before its cut reaches the cutoff. Its opt-out is per unit. |
| Fleet OS (◉ pick) | E5 | + `{ kind: 'hubBays', delta: 1 }`. Its CONTROL PLANE exposure also stops hub units. |
| Guideway Rails · Maglev Freight Lines | E6 ◆ · E7 ◉ | Unchanged: they speed every hub unit on roads. |
| Condition Optimization · Self-Replicating Systems | E6 · E7 | `iceHarvester` → `iceMiner` and `waterPlant` in their lists. |
| Settler Charter · Lunar Commonwealth (⌂) | E6 · E8 | + `waterPlant` in their crewed-output lists. |
| Replicator Stacks (◉ pick) | E7 | + `{ kind: 'hubPrint', timeMult: 0.5 }`. Its RUNAWAY exposure now over-prints units. |
| Deep Sounding | E7 ◎ | + `{ kind: 'pitDepth', benches: 1 }`. |
| Propellant Depot | E7 export | Unchanged; its card names water plants as the supply. |

### 14.5 Tree fit

- 129 techs → 135: one retired, seven added.
- Cards per page (robotic mare; docs/14 §1.8): E1 8 (unchanged) · E2 12 → 14 ·
  E3 13 → 14 · E4 15 → 17 · E5 14 → 15. The busiest rows are E2 ◉ and ◆ (4 each),
  E4 ⌂ at the pole (3) and E5 ◉ (4). No row passes 5, and every page keeps 7 lanes or
  fewer, so every page fits 1280×720 (`tests/techtree.spec.ts:142`).
- Every new tech sits at its era's median, so none is a charter shortcut.

## 15. The Builder

**The excavation family** (Automated Excavation, E3 ◉) keeps its name. Its two rules,
`excavator` and `iceHarvester` (`src/data/automation.ts:63-72`), merge into one.

| Rule | Builds | Shown as | Trigger | Guards | Cap | Dwell · cooldown · settle |
|---|---|---|---|---|---|---|
| `hubUnit` | a unit at the hub that needs it | KEEP every hub fed → +1 unit | a hub's `starved` ≥ 25% (10–60%) over 120 s | every unit it has is working · a **free face** in reach · that pit has ≥ 1 lunar day of ore at +1 unit (a plain pit always has) · a **free bay** · the budget's reserve | per hub: its bays · base-wide: 12 units (0–60) | 60 s · 120 s · 1 cycle + 60 s |

- **It prints; it never places.** A unit is a queue job at the hub: no pad, road or
  rover.
- **Holding lines:** `holding · Smelter #3 — no free face in reach (◆ #0 2/2; its 3rd
  bench opens at 14.3 m)` · `holding · Refinery #9 — every bay full (2/2): + Bay` ·
  `holding · ◆ #0 has 0.6 lunar days of ore at +1 unit`.
- **Bays** are never bought by a rule. An order can (`Order + Bay`).
- **Re-routing** from exhausted or boxed-in pits is base behaviour.
- **Relocation.** Automated Smelting & Refining (E5) places **new hubs** and never
  moves old ones. Its smelter rule gains a trigger: a hub whose feed has fallen to
  plain grade while a surveyed wanted deposit with ≥ 2 lunar days of ore lies more
  than 45 s away. It places a new hub by that deposit: `Smelter #3 — its pit is dug
  out: feeding at q 0.62 · a Smelter by high-Ti basalt #3 would feed q 1.3`.
  Demolishing the old hub stays yours. Its units drive to the nearest same-type hub
  with a free bay; the rest are scrapped for half.
- **Siting** (`src/core/siting.ts:176-187`):

| Hub | Base chooser (from landing) | Site Survey AI |
|---|---|---|
| Smelter, Refinery, Water Plant | the nearest valid pad just outside the full-size pit ring of the nearest mapped wanted deposit in the network, door toward it; the Lander if none | of the wanted deposits in reach, the best by `ore × q − one-way seconds × 30`, surveyed first; the pad whose haul time to the gate is least outside the full-size ring |
| Every type | pads inside any pit, heap or 4 m rim margin are struck (placement refuses them) | the same, plus pads inside a full-size pit ring are struck, and pads inside a plain pit's three-day ring cost +40 |

  The old anchors ("the centroid of the excavators' dig sites"; the excavator's own)
  retire.
- **Plain pits.** When a rule's hub has nothing wanted in reach, Site Survey AI stakes
  its plain pit as §8.6 says, away from the base's centre and, on a crewed base, from
  habitats. The base chooser takes the nearest valid stake.
- **Site Survey AI surveys.** Before a rule sends units to, or places a hub by, an
  unsurveyed deposit, it queues its survey: `AUTO SURVEY — high-Ti basalt #3, for
  Smelter #3's next unit`.
- **Feed Planner** routes units as §14.4 says.
- **The flow book** keeps its regolith row as a sum.
- **Old saves:** the `excavator` and `iceHarvester` rule states merge into `hubUnit`:
  on if either was, caps summed (§19).

## 16. Interplay with the rest of the game

### 16.1 Roads and zones

See §11.4. A hub is a dock (§3.1, §4.3). Units drive off-road only inside zones,
from the gate down the ramp to their face (docs/15 §5a). Old saves keep every road.

### 16.2 Traffic and transit

- Units are wide loads (docs/15 §6). Right of way stays: loaded unit > empty unit >
  rover, then the lower id.
- A pit's gate and its ramp top are junctions. Units queue there, whatever hub they
  come from.
- Units travel on haul legs (`src/core/haul.ts`), not rover trips. The visuals follow
  the sim, as diggers do today (`src/world/haulers.ts`), down the ramp's spiral. The
  48-digger draw limit (`MAX`) becomes 64, since docked units are drawn too.
- Surveys are rover work, on transit's trips.

### 16.3 Machine batteries (work/unitpower)

- Units are machines in unitpower's sense: `homeOf` is the hub and `chargeSpotOf` the
  bay cell.
- They top up while tipping and fully in the bay. A long brownout at the hub stalls
  them in the bay, not in the field.
- **Reach** is the lesser of 90 s one way and what the pack covers for two cycles.
  Deep pits' ramps and bedrock benches (+25% draw) eat the pack too. Rover Power
  Packs (E2), Fuel-Cell Packs (E4) and Radioisotope Power Units (E5/E6) extend it.

### 16.4 Flares (work/flares, docs/16)

- A unit in the open, in a zone or in a pit when a flare turns active takes docs/16's
  glitch. A pit's walls give no shelter from particles overhead. A unit docked in a
  **shielded** hub's bay (Regolith Shielding, as docs/16 defines) is sheltered.
- **Recall.** On the telegraph (60 s), each hub recalls every unit whose trip home is
  shorter than the time left: `FLARE IN 1:00 — Smelter #3 recalls 1 of 2 excavators;
  E2 is 1:10 out, at the bottom of a 12 m pit`.
- A far or deep pit is also a flare risk.

### 16.5 Hazards (docs/14 §3)

| Hazard | With hub units and pits |
|---|---|
| FIRMWARE | Units are fleet machines: the window's share includes them. A bricked unit drives home and waits in its bay. Its hub re-flashes 1 every 30 s. A unit still bricked at the deadline is **lost** (`LossRecord.what: 'unit'`); the hub reprints at the unit price. |
| CONTROL PLANE (Fleet OS) | Hub units stop where they are until a Data Center has run 30 s. |
| MALWARE | Hubs are nodes as agent-run stations. An infected hub's units work at ×0.5. |
| ROGUE DRONES | A hub can be a strip target (priority 2). Its units park meanwhile. |
| RUNAWAY RULE | The hijacked rule, often `hubUnit`, **over-prints units** every 20 s, ignoring bays and caps, never the weld debt or life-support stock. Junk units never commission, stand on the bay apron and cost upkeep until scrapped for half. Counters unchanged: Freeze rules, cancel a junk job in its first 20 s, Budget Governor, Rule attestation. Printing uses no rover, so no `CONSTRUCTION STALLED` comes from it. |
| DUST (⌂) | Airlock dust sources (`src/core/hazards.ts:843`) are pits' working faces and heaps within 60 m of pressurized buildings, instead of excavator pads. A base that mines beside its habitats clogs its airlocks sooner. |
| Wear, Maintenance Automation | Units wear like buildings. Maintenance Automation reprints a worn unit at its hub, for its price less half. |
| Pit-wall slumps | **Not included.** 1:2 walls sit well below the angle of repose, and a slump would add a rule without adding a decision. |

### 16.6 Destiny (docs/14)

- **◉ Automation** gets the fleet: Fleet OS (+1 bay on every hub, with the control
  plane risk) and Replicator Stacks (print ×0.5, with the runaway risk). Its bases
  dig plain ground in bulk (§9.3).
- **⌂ Colony** gets the water and pays for its pits: Water Reclamation and Water
  Electrolysis are ⌂-lane techs, crews high-grade plain ground, and strip mines cost
  them morale (§12.1).
- **Drone Hive drones do not dig.** They build, sinter and survey (a drone survey
  flies straight).
- Both destinies keep every extraction tech.

### 16.7 Work animations (`src/world/workAnim.ts`, `src/buildings/rigs.ts`)

| Unit | Digging | Tipping | Heap | Driving | Parked |
|---|---|---|---|---|---|
| Regolith Excavator | on its **bench** in the pit: the wheel turns, the boom dips, spoil flies (today's rig, `DIGGER_RIG`) | at the **hub's tipping stand**: boom up, wheel back, a spill into the chute (today's dump, `DUMP_S`) | the same dump at the heap's edge | boom high, down and up the ramp | boom stowed, charge lamp lit |
| Ice Miner (new rig) | the auger drum turns and dips; frost puffs | the bin tips into the melt-hall chute | the bin tips at the heap | auger stowed | charge lamp lit |

- `Hauler.mode: 'dig' | 'tip' | 'heap' | 'reclaim' | null`, which the sim sets and the
  animation reads (the pattern since `5b797b6`). Reclaim reuses the dig state with
  the boom pushing.
- The hub shows its hopper: a gauge lamp at the chute in quarter steps.

## 17. The first 30 minutes

Game-minutes after landing. The first dusk comes at 6.5 and dawn at 10.5. These are
**design targets** that Phase 7's probe checks. Mare prices ×0.8, pole ×1.25, lava
tube ×1.1.

### 17.1 Mare, robotic (112◆ 112⚙ · 2 rovers · the Lander 6 kW, 800 stored)

| Min | What happens | Stock after |
|---|---|---|
| 0:00 | Land. The overlay shows ◆ high-Ti basalt #0 30–50 m out, "a bed · unsurveyed", and one or two more ◆ within 120 m. | 112◆ |
| 0:05 | **The first survey:** Survey ◆ #0 (30 stored energy, 2⚙). A rover drives out, cores for 40 s, and is back by about 1:30: `8.5k–15.9k▲ of ore · centre 11% (q 1.7) · loose to 4.4 m · 1 face now, 5 at full size (R 27 m)`. The other rover welds the first array. The full-size ring now shows on the ground: keep the first roads out of it. | 110⚙ |
| 0:30–1:30 | Two Solar Arrays (12◆ each). | 88◆ |
| 1:40 | **The smelter:** pick it and ◆ #0 lights. Place it just outside the full-size ring, door toward the gate. The ghost: `◆ #0 · trip 0:15 · 1 face now, 5 at full size · ~30◆/min per excavator (centre first) · ~8 lunar days at 2▲/s`. 48◆ 12⚙. | 40◆ 98⚙ |
| ~4:30 | The smelter stands, and its excavator rolls out. It drives to the deposit's centre and opens the pit. | |
| 4:40 | Research Lab (24◆ 8⚙). | 16◆ 90⚙ |
| ~5:50 | The first bucket tips, from the centre: q 1.7. Metals begin at about 0.55◆/s with one unit. **Dig In** completes. | |
| ~6:30 | The lab stands. First research: **Pit Mapping** (48≡, about 1:05). About 25◆ smelted before dusk. | ~40◆ |
| 6:30–10:30 | Night. The bank carries the loads for under a minute; then the smelter and its excavator stand by until dawn (priority 2). The pit is a 6 m cone, 3 m deep. | |
| ~11:00 | Dawn. A third array (12◆). The hub reads `STARVED 30% · the pit's 2nd bench opens at 9.6 m (now 6 m)`. | |
| ~12:45 | **First Metal** (100◆, a smelter, a lab). | |
| ~18:00 | The 2nd bench opens. **The 2nd excavator** (16◆ 4⚙, 0:48): `+0.6▲/s → +15◆/min · pays back in 1:05`. | |
| 18–30 | More arrays, a yard, a second and third lab. Prospecting Rovers maps to 320 m. Survey ◆ #1 or #3. By 30 min the pit is a 14 m bowl, 4.4 m deep, with its first heap beside it. Era 2 opens by the 450◆ deed around 22–24 min (§18.2). | |

- Metals start about 3 min earlier than today (5:50 against 8.8–10.1), and richer:
  the centre is the best ground on the deposit.
- **No new trap.** The second unit waits on the second bench, not on metals. A 16◆
  unit is under a minute of daylight smelting.

### 17.2 Mare, crewed (7 crew · 120○ lasts 14 min at 0.14○/s)

The same opening, with a Hydroponics Farm by 7 min.

- The smelter's O₂ (0.25○/s × q at full feed) starts at ~5:50 instead of ~9–12. The
  O₂ margin grows by about 4 min, and more from the rich centre.
- Crew seats: smelter 2, lab 2, farm 1, of 7. Units need none.
- The deposit pit is 30–50 m from the Lander, where the crew lives: by Era 2 its
  scar (pit and heap) is about 900 m², **−0.4 morale**. It grows to about −2 at full
  size.
- Crewed labs are slower, so Pit Mapping lands around 9 min.

### 17.3 South pole, crewed (175◆ 175⚙ · 50≈ lasts 24 min for 7 crew)

| Min | What happens |
|---|---|
| 0:00 | The overlay: ❄ cold-trap ice #0 at a 30–40 m rim, "a small patch". ◇ anorthosite #0 at a 12–28 m rim. No ilmenite anywhere. |
| 0:05 | **The first survey: ❄ #0**, for example `0.7k–1.2k≈ of water (±30%) · 9% ice, 5.3 m deep · 1 face now, 3 at full size`. |
| 0:30–2:00 | Two arrays (19◆ each). |
| 2:10 | **The smelter**, with its **plain pit** staked by the ghost. Nothing lights: H₂ on highland ground is poor. The ghost: `no high-Ti basalt at this site: a plain pit, q 0.56 with crew high-grading · MRE melts any soil (Era 2)` and `… 55 m from the Lander: −0.5 morale by the next dusk`. 75◆ 19⚙. |
| 5:00 | Lab (38◆ 13⚙). Stock about 24◆. |
| ~6:30 | Metals begin at about 0.2◆/s (today about 0.4). The smelter's water trickle (0.05≈ × q at full feed) covers about half of the crew's 0.035≈/s. |
| ~8:00 | Research **Cryo Ice Extraction** (208≡, about 12 min at a crewed lab). |
| ~20:00 | **The Water Management Plant** by ❄ #0 (75◆ 19⚙). One Ice Miner: about 0.3≈/s from the rich starter trap. It has one face until its pit reaches 9.6 m. |
| 20–30 | Prospecting Rovers maps ice #1–#6 (90–310 m out). Era 2 opens by four techs around 26–30 min, and **MRE** is its first research: the smelter's pit goes to q 1.0 around 33–36 min. |
| ~50–80 | The starter trap's ice runs out (§18.3). The second water plant by the best far trap must be standing by then, and the alert gives a lunar day's warning. |

- **No new trap**, but a tighter start: the pole's first metals are about 45% fewer
  until MRE. The Lander cache (175◆) and the four-tech charter carry Era 1.
- Water stays safe until MRE ends the trickle. By then the water plant stands.

### 17.4 South pole, robotic

The same geology without crew: the plain pit digs at q 0.45, with no morale cost.
There is no water rush; the first water plant waits for the Propellant Plant or
outposts' hopper fuel. ◇ anorthosite #0 at a 12–28 m rim is **where the pole's
refinery belongs** in Era 2. Its pit will be 12 m deep and close to the Lander, so the
ghost's full-size ring (R 45–52 m) is the pole's first planning problem: build the
early base on the far side.

### 17.5 Lava tube, robotic (154◆ 154⚙ · build radius 220 m)

- ◆ #0 lies 30–50 m out and ○ glass #0 30–56 m out, both guaranteed. The smelter lights
  both: ◆ bright, ○ dimmer (`O₂ +60%`).
- Place the smelter between them if they are close (66◆ 17⚙) and clear of both
  full-size rings. Its units take ◆ first.
- Only two ilmenite beds exist (25–30k▲ of ore). **Survey both before Era 3.** After
  them come the glass beds, then Deep Coring's bedrock benches (§18.3).

## 18. Pacing

### 18.1 Targets

The baselines are docs/14 §6's shipped numbers (reasonable, `--auto=on`, seeds 42,
7, 1234). This branch's own run (§2, `--auto=off`, natural destiny) is within 7 min
of them.

| Run | Baseline FIRST LIGHT | Target |
|---|---|---|
| mare robotic · ⌂ Colony | 213.3 | 203–230 |
| mare robotic · ◉ Automation | 200.3 | 190–216 |
| mare robotic · Concord | 217.6 | 207–235 |
| pole crewed · ⌂ Colony | 162.9 | 155–179 |
| pole crewed · ◉ Automation | 172.9 | 164–190 |
| pole crewed · Concord | 177.9 | 169–196 |

The mare is held to −5% to +8% of its baseline. The pole gets +10%: H₂ on highland
ground is poor until MRE, and the pole was already 25% faster than the mare. docs/14's
rules stay: robotic mare 210 ± 25 with max/min ≤ 1.08 across destinies, every era
22–32 min, and the longest idle ≤ 5 min.

**Extraction acceptance:**

| Measure | Target |
|---|---|
| Exhaustions per run | mare 1–3, **the first in Era 4–5** on robotic mare · lava tube 1–3 · pole 1–2 (❄ #0) |
| Hubs placed by a second deposit because the first ran out | ≥ 1 on every mare run |
| A hub with no pit in reach | ≤ 5% of its run time |
| A hub's starved share (median over the run) | ≤ 25% |
| Metals begin (mare) | by 6 min |
| The second unit | by 20 min (it waits for the second bench) |
| Deaths from water or O₂ | none, under reasonable and attentive |
| Surveys per run | ≥ 3 |
| Pits boxed in by the base | ≤ 1 per run under reasonable (the ghost's ring warns) |
| A structure undermined | never (pits do not dig pads) |
| Crewed strip-mine morale | ≥ −6 median over the run under reasonable |

### 18.2 Expected direction

- **Earlier (Era 1, −3 to −6 min on the mare).** The smelter runs 3 min sooner and
  from the deposit's richest ground: metals in Era 1 run 8–42% above today. **Lever:**
  the E2 deed 450 → 550◆ (docs/12 §2.1).
- **Later (Eras 3–6, 0 to +8 min).** Deposit pits get leaner as they grow, they run
  out, and hubs move. Every trip now includes the pit's ramp.
- **The pole:** Era 1 metals about −45% until MRE. If MRE is taken first in Era 2,
  the pole loses about 300◆ of early building. Expected FIRST LIGHT +2 to +8%.
- **The lava tube:** after its ilmenite (gone by 157–175 min), glass keeps metals near
  today; without glass or Deep Coring they would halve. Expected +5 to +12%.

### 18.3 The pit model on the baseline's dig curves

The model: the grades of §9.1, a 1.3× ore halo, a cutoff at 15% of the enrichment, and
the loose layers of §8.5. It is run against each baseline run's regolith and water
curves. The smelters' share of regolith is 100% until the first refinery, then 62%.
Ice gives 80% of pole water. The nearest wanted deposit is dug first, and a hub moves
to the next one 10 min after an exhaustion. The model ignores trips, so it measures
grade and exhaustion, not time.

| Run | Exhaustions [seeds 42 · 7 · 1234] | First (game-min) | Metals or ice water vs today, over the run |
|---|---|---|---|
| mare robotic | 2 · 2 · 1 | 84 · 82 · 120 (Era 4 · 4 · 5) | 0.86 · 0.94 · 1.07 (Era 1: 1.08 · 1.23 · 1.42) |
| mare crewed | 2 · 2 · 1 | 92 · 86 · 119 | 0.91 · 0.97 · 1.12 |
| lava tube robotic | 2 · 3 · 2 | 124 · 90 · 101 | 0.83 · 0.85 · 0.99 |
| pole crewed (❄ #0) | 1 · 1 · 1 | 51 · 49 · 80 | 0.92 · 0.94 · 0.92 (the move to a far trap) |
| pole robotic (❄ #0) | 1 · 1 · 1 | 71 · 70 · 85 | 0.93 · 0.93 · 0.88 |

**How big the holes get** by the end of a run:

- a mare deposit pit at exhaustion: R 27–34 m, 4.1–5.0 m deep, with a heap of about
  6–10k m³ beside it;
- a mare or lava tube refinery's plain pit: R 27–35 m, 4.5 m deep;
- the pole refinery's pit (anorthosite or plain): R 24–27 m, **12 m deep**, six
  benches;
- a pole ice pit: R 19–22 m (the starter), 30–45 m for the far traps.

The first exhaustion lands in Era 4 or 5 on every robotic mare seed, as the player
chose. The crewed mare's longer eras put it in late Era 3.

### 18.4 Levers, in this order

1. **Centre grades and the H₂ reference** (9–13%, 6.5%): Era 1's head start and the
   run's metals.
2. **The halo and the cutoff** (1.3×, 15%): when exhaustion comes.
3. **Plain-ground grades** (robots and crew) and the crew's ×1.25.
4. **The pole:** MRE a site-era earlier (Era 1), if Era 1 there runs past 32 min.
5. **The loose layer**, only within its physical range (mare 4–5 m, highland
   10–15 m).
6. **The tailings share and heap height** (70%, 6 m): how much ground a pit scars.
7. **Morale per 1,000 m²** and its cap.
8. **The bedrock dig rate** (×0.3) and Deep Coring's benches.
9. **Unit cost and print time; bay levels' eras; off-road and ramp speed.**
10. **The lava tube's ilmenite count** (2 → 3). The generator places ilmenite first,
    so this moves the tube's other deposits.
11. **The E2 deed** (450 → 550◆), for Era 1 only.

Never `ERA_COST_SCALE`: the tree's calibration belongs to the tree (docs/14 §6).

### 18.5 The probe (`scripts/probe-pacing.mjs`)

The bot plays pits as a thinking player would, reading only what the HUD shows.

| Step | What the bot does |
|---|---|
| Survey | At landing, the nearest wanted deposit. Later, before placing a hub by a deposit, and when a pit has under 1 lunar day of ore. |
| Place a hub | Just outside the full-size ring of the wanted deposit with the best `ore × q − one-way seconds × 30` in the network, door toward the gate. With nothing wanted: near the Lander, with the ghost's plain-pit stake. |
| Keep rings clear | It never places a structure inside a full-size ring, and it takes the ghost's warning as a no. |
| Print units | When the hub's hint offers one (starved ≥ 10%, a free face, a free bay). |
| Levels | + Bay when a hub is full, starved and a face is free. |
| Relocate | A new hub by the next wanted deposit when a hub's feed falls to plain grade, or has been under 75% of its best for 5 min, with a surveyed deposit of ≥ 2 lunar days of ore in the network. It demolishes the old hub only once it idles. |
| The pole | MRE first in Era 2. |
| Crewed | Stakes plain pits away from habitats when the network allows. Reclaims exhausted pits within 150 m of a habitat once it has two idle units. |
| With `--auto=on` | Units go to the `hubUnit` rule and relocation to the Smelting rule. |

**New report fields:** exhaustions and their times, boxed-in pits, relocations,
surveys, units per hub over time, each hub's starved share and grade, median trip
time, minutes a hub had no pit, ▲ dug per pit, pit radii and depths at the end, heap
volume, strip-mine morale, and the height-delta grid's size.

## 19. Save migration

`hubSchema: 1` and `techSchema: 5`, in `Game.load`, after `migrateTechSchema` and
before `migrateRoads`.

| Step | Old save | After |
|---|---|---|
| 1 · tech | `regolithProcessing` done, queued, spent or with an insight | the same on `pitMapping` |
| 2 · terrain | no delta grid | an empty one: **nothing is carved on load** |
| 3 · deposits | no ore state | every deposit **full** (the player's answer to Q5), from the seed |
| 4 · hubs | smelters and refineries | hub state: Level I, an empty hopper, `q` from today's feed factor |
| 5 · excavators | placed buildings with a pad | each becomes a unit of the **nearest complete Smelter or Refinery by road**. It works a new pit at the deposit it dug (V = 0, at the deposit's centre), else the hub's new plain pit (staked by §8.6). It keeps its wear; its overclock is dropped. Over the bay cap it is kept (`3/2 · 1 over cap`). The pad building goes. Its flatten entry stays for its heights but is marked `free`, so pits may dig there. |
| 5b · no hub yet | excavators with nothing to join | each stays a **legacy pad** (`legacy: true`, not buildable), digging and hauling to the Lander as today, **without carving**. When the first Smelter or Refinery completes, each joins it as a free unit and its pad goes. |
| 6 · ice harvesters | placed harvesters | **legacy harvesters** keep working, without carving, and draw on their deposit's ore. When the first Water Plant completes, each within reach joins it as a free Ice Miner. Its crew seat moves to the plant. |
| 7 · regolith | one capped stock | fills hoppers in hub order; the rest becomes `s.pile`, which smelters and refineries draw first |
| 8 · surveys | none | every deposit being dug on load counts as surveyed, at the save's precision |
| 9 · the Builder | `excavator` and `iceHarvester` rules | one `hubUnit` rule: on if either was, caps summed |
| 10 · morale | — | no pits, so no strip-mine term on load |
| 11 · the alert | — | `EXTRACTION HUBS — your 3 excavators now belong to Smelter #4 and Refinery #9 · they dig pits now, and deposits run out: survey them [I]` |

**Why a legacy pad, not a free hub.** A free smelter would need a 3×2 pad, a spur and a
door where the old 2×2 pad stood, and could fail to fit. A legacy pad keeps exactly
what the player had until a hub stands, which is always within reach now.

**Why deposits start full and nothing is carved.** A save never recorded how much came
from which deposit, or where. Carving a guessed pit on load could open a hole beside a
building, or hem in a road, and a base that worked yesterday would break today.
Starting fresh only makes old saves generous for an era or two.

## 20. Look

All parts use `meshKit` primitives and stay monochrome; state is carried by lamps and
tone (docs/06). Triangle budgets follow docs/04's table.

| Thing | What you see | Budget |
|---|---|---|
| **Pits** | Terraced rings: each 4 m sample ring sits a 2 m bench lower. Classic's faceted ground shows each bench as a facet ring; High detail adds a thin instanced **bench lip** on each ring's edge. The ramp spirals down the gate side. | lips: 1 instanced strip mesh for the map |
| **The cut** | **Brighter** than the ground around it: +20% albedo on carved samples in `regolithAlbedo` and `classicGround`, fading over the first 2 m of the rim. **Why brighter:** freshly exposed regolith is immature, not yet darkened by space weathering, as a young crater's rays show. Rover tracks look dark because trampling changes how the surface scatters light, not its maturity. A pit exposes metres of fresh material, so maturity wins. It also matches the game's own "fresh bright rim" crater rule. | no geometry |
| **Bedrock benches** (Deep Coring) | Rock tone by site: fractured basalt a shade darker at the mare and lava tube, anorthosite brighter still at the pole, with rubble instanced on the bench. | 1 instanced rubble mesh |
| **Tailings heaps** | Flat-topped dumps with 35° sides, bright like the cut, with tip lines on the top. | the terrain itself |
| **Units on the benches** | Each digs at its face on its bench, at the bench's height; others climb the ramp nose-up. | — |
| **Hub bays** | A charge post (a 1.2 m bollard with a lamp) per bay cell against the hub's front wall, and stall lines. Parked units stand nose-in, charge lamps lit. Level II: a lattice canopy (Bay Extensions). Level III: a roofed depot hall with a gantry (Depot Halls). | +120 △ a bay; +300 canopy; +500 hall |
| **Hopper chute** | A sloped chute at the door with a four-step gauge lamp. | +80 △ |
| **Water Management Plant** | A melt hall (7 × 4 × 5.4 m, a radiator pair), three banded water tanks and a sublimation chimney. Upgrades: a greywater still (Water Reclamation), an electrolysis stack with busbars and a flare mast (Water Electrolysis), a spherical propellant dewar on legs (Propellant Depot). | ~1,500 △ stock · ~2,600 upgraded |
| **Ice Miner** | A tracked crawler (the excavator's hull and track pods), an insulated ore bin in FOIL finish, a heated auger drum on a short boom (its rig), a frost vent and two lamps. | ~1,000 △ |
| **The highlight** | §6.1: double-weight rings, the full-size ring dashed, the rim solid, the ore band hatched, and label chips. | no new geometry |
| **Survey markers** | An unsurveyed deposit shows its `?` chip. A surveyed one gets four stake flags on its full-size ring (1.5 m poles with pennants) and core-hole dots at its centre. | 1 instanced stake mesh |
| **Exhausted and boxed in** | The ring cross-hatched, the ramp's top barred with a lamp-lit gate arm. | +40 △ |
| **Reclaimed** | Raked, levelled ground, like Site Grading's pads, a shade brighter than the land around it. | none |

- Classic palette keys: `depositLit`, `depositFull`, `depositSpent`, `pitRim`, `cut`,
  `bedrock`, `stake`. High detail: an emissive rim line on lit rings; lamps use
  `LAMP`.
- The excavator's research parts (`src/buildings/upgrades.ts:308`) stay on the unit.
  The Solar-Wind Volatiles retort moves to the water plant, where the baking now
  happens.
- Retired from the palette: the Excavator pad (its recipe becomes the unit's body) and
  the Ice Harvester (kept only for legacy pads).

## 21. Tests

**New: `tests/hubs.spec.ts` and `tests/pits.spec.ts`.**

| Area | Checks |
|---|---|
| Hubs | The smelter is placeable at landing. A hub commissions with one unit. + Excavator queues, pays at the head, prints in 60 s × bcm at 4 kW, pauses in a brownout, and cancels for a full refund. The cap follows bays. + Bay needs its level's tech and a free cell. |
| Units | A unit leaves by the door, drives road then off-road, descends the ramp, digs its bench, returns, tips into its own hub's hopper and dumps at its heap. `s.resources.regolith` equals the sum of the hoppers. A smelter's `q` follows its loads. |
| Choice | The auto choice follows hub intake. A mare refinery keeps to its plain pit against far anorthosite with one or two units; a smelter goes to ilmenite 100 m out. Assign, Open pit…, Send…, Recall and Auto work. A unit sent to a full pit waits at the gate. Reach is 90 s. |
| Pit growth | Dug volume sets R exactly (cone, then floor). The pit widens at L and goes deeper only with Deep Coring. Walls stay 1:2 against no-dig samples. A carved sample never rises (except by Reclaim). |
| Faces | 1 face at first; the 2nd at R 9.6 m; never more than 6; a half-blocked rim halves them. No pit ever holds more units than faces. |
| Grade | A deposit's cut starts at its centre grade and falls as the pit grows. Output = recipe × q. MRE is q 1.0 on any ground. Crewed plain pits dig at ×1.25; robotic ones at ×1.0. |
| Exhaustion | At the cutoff the deposit is EXHAUSTED, its units re-route, and the pit stays open as plain. A pit against structures on every side is BOXED IN. Deep Coring reopens both for bedrock benches at ×0.3. |
| Terrain | Carving changes `h` in the pit's box only, in decimetres. The same seed and inputs give the same delta grid, byte for byte, after 60 min. A save and load reproduce `h` exactly (base → deltas → flattens). A demolished building's ground is not carved by the reload. |
| Readers | Placement refuses pit and heap samples and the 4 m rim margin, and warns inside a full-size ring. Road A* cannot cross a pit or heap. The road tool stops at the rim. A zone grows with its pit and its gate steps back. `roadReach` refreshes on `terrain.rev`. Rocks are gone from carved chunks. |
| Grading and Reclaim | Site Grading refuses a pit and levels a heap. Reclaim fills a pit to about −1 m and removes its heap; the ground becomes buildable. |
| Morale | On a crewed base, a plain pit within 100 m of a habitat costs −1 per 1,000 m² of scar, a deposit's pit −0.4, reclaimed ground ×0.2, capped at −12. A robotic base shows no term. |
| Rendering | Carving rebuilds only the chunks it touches, at most two a second. The cut is brighter in Classic and High detail. A load rebuilds each changed chunk once. |
| Surveys | The job waits for a free rover, drives, cores for 40 s, pays 30 energy and 2⚙, and reveals ore, grade, depth, faces and the full-size ring. Precision ±30/15/5%; the truth is always inside the range. A mast with Neutron Spectrometry surveys ice. |
| The ghost and highlight | The HUB line: trip, faces now and at full size, rate, grade, ore and life. The IN THE PIT'S WAY warning asks once. A hub with nothing wanted stakes a plain pit. Picking a smelter lights ◆ only; full, exhausted and boxed-in states show. It works in Classic, in High detail, and on touch with no hover. The Lunar Map shows the same. |
| Migration | Old excavators become units, each on a fresh pit (V = 0) at the deposit it dug. With no hub they stay legacy pads and convert later. Nothing is carved on load. Old ▲ fills hoppers, then the pile. The old rules merge into `hubUnit`. |
| Determinism | Two runs of the same seed and inputs give the same state hash, delta grid included, after 30 min. |

**Updated specs:**

- The 71 `regolithProcessing` references (§14.1): `smoke`, `techtree`, `research`,
  `playability`, `destiny`, `avoidance`, `automation`, `ui`, `map`, `look`,
  `guidance`, `hazards`, `fleet`, `crew`.
- `automation.spec`: the `hubUnit` rule, relocation, and siting that keeps out of pit
  rings.
- `avoidance.spec`: two excavators become two hub units, and the ramp is a junction.
- `zones.spec`: pits as zones; a growing zone moves its gate.
- `fleet.spec`: `getFleet().hauls` reads units.
- `look.spec` and `upgrades.spec`: the new recipes, bays, bench lips, the cut's tone,
  and each new tech's part (`recipeTriangles` differs).
- `anim.spec`: dig on the bench, tip at the hub, dump at the heap.
- `guidance.spec`: Dig In and First Metal.
- `destiny.spec` and `hazards.spec`: units bricked and lost, runaway junk units, the
  control plane stopping units, and pit dust at airlocks.
- `crew.spec`: strip-mine morale.
- `touch.spec` (after work/touch): the tap highlight.
- `auditTechs`: the seven new techs each pass.

## 22. Phases

Each phase merges on its own and leaves the game playable.

| # | Phase | Contents | Leaves the game |
|---|---|---|---|
| 1 | **Data and hub units** | `src/data/hubs.ts`; `waterPlant`; unit defs; the smelter from landing; `s.haulers`; the queue, printing, bays and Level I; the inspector's UNITS and ROBOTS; the palette drops the Excavator and Ice Harvester; the minimal migration | Units printed by hubs, hauling by today's rules into the old pool |
| 2 | **Haul to hub** | hoppers; ▲ as their sum; the pile; per-hub grade and feed; trips hub → gate → face → hub; plain pits as staked points (no carving yet); reach; the auto choice; Assign, Open pit…, Send…, Recall; the haul road with the spur; power per unit | Hubs live on their own hauls |
| 3 | **Heightfield editing and pits** | `src/terrain/pitCarve.ts`: the delta grid, carving, heaps, ramps, no-dig and no-build masks; `s.pits` and step 4.2; saving (base → deltas → flattens); the chunk rebuild queue and shadow throttle; placement, road A*, `roadReach`, zones and gates on the new terrain; Site Grading on pits and heaps; rocks | The ground deforms as units dig |
| 4 | **Grade, reserves, faces, surveys and morale** | the grade tables and q; the ore halo and cutoff; exhaustion and boxed-in pits; bedrock benches; faces as benches; the survey job, precision and the card; strip-mine morale; Reclaim | Pits run out and you can see why |
| 5 | **The preview and the highlight** | the ghost's HUB block, its plain-pit stake and ring warnings; lit rings, rims and labels; the Lunar Map; touch | Placement shows its strategy |
| 6 | **The research reshuffle** | Pit Mapping and the six other new techs; §14.4's changes; techSchema 5; milestones; discovery; the 71 test references | The ladder is in |
| 7 | **The Builder and the probe** | `hubUnit`; siting's anchors and ring-keeping; plain-pit staking; relocation; Site Survey AI surveys; Feed Planner routing; the probe bot, its metrics and the pacing pass against §18 | Automation and pacing are tuned |
| 8 | **The look and the migration** | recipes (the water plant, the ice miner, bays, chutes, stakes); bench lips, the cut's tone, bedrock and rubble; the ice miner rig and work animations; the full migration | Finished |

Phases 1–2 touch `src/core/haul.ts`, `src/core/economy.ts` and `src/core/fleet.ts`,
which work/unitpower also changes; that is why Phase B waits for it. Design the units
against `homeOf` and `chargeSpotOf` from Phase 1. Phase 3 touches
`src/terrain/heightfield.ts` and `src/terrain/chunks.ts`, which no in-flight branch
changes.

## 23. The player's answers

| # | Question | Answer | Where |
|---|---|---|---|
| 1 | Should smelters and refineries always be able to dig plain ground? | **Yes, but it is realistic only if it is proportionally slower and more destructive**: every site is a strip mine that deforms the ground. Crews find it demoralizing; robots dig it slower and bigger. | Part 2, §9.3, §12 |
| 2 | How often should deposits run out? | **1–3 times a run on the mare, the first in Era 4–5.** | §18.1, §18.3 |
| 3 | Hub levels: bought per hub, or granted by research? | **Bought per hub**, once research allows each level. | §4.2 |
| 4 | Should research add working faces? | **No.** No Bench Mining. | §8.2 |
| 5 | Old saves: deposits full, or part-dug? | **Full.** Nothing is carved on load either. | §19 |
| 6 | The pole's first era: keep hydrogen reduction poor on highland soil, or MRE from landing? | **Keep it realistic.** MRE stays an Era 2 research, taken first at the pole. | §9.4, §17.3 |

**Question 6, decided: keep it.** Hydrogen reduction barely works on highland
soil, so the pole's starter smelter digs its plain pit at about half of today's
metals until Molten Regolith Electrolysis. MRE stays an Era 2 research, taken first there. The pole's Era 1
runs 0–4 min longer and its first builds come slower (§9.4, §17.3). The alternative
moves MRE to Era 1 at the pole only. That makes the pole's start as quick as today,
but it takes away the pole's first real choice.
