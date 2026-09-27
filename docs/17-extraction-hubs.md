# 17 · Extraction hubs: hubs that build their own robots, and deposits that run out

**Status:** Phase A design, on `work/hubs` from main `97e1373`. No code yet.
Phase B starts after **work/unitpower** (machine battery packs) merges, since it
changes the same files. Check the names this doc borrows from other branches
again at merge: `homeOf`, `chargeSpotOf`, Rover Power Packs (work/unitpower),
docs/16 and its shelter rule (work/flares), tap placement (work/touch).

**Code today:** `src/data/buildings.ts` (the placed Excavator and Ice Harvester),
`src/core/haul.ts` (the haul cycle), `src/data/deposits.ts` and
`src/terrain/heightfield.ts` (deposits), `src/core/exploration.ts` (reveals,
surveys), `src/core/zones.ts` (extraction zones), `src/core/siting.ts` and
`src/core/automation.ts` (the Builder), `src/ui/depositCard.ts`.
**Code to come:** `src/data/hubs.ts` (hub and unit tables, reserves), `src/core/hubs.ts`
(printing, bays, assignment), `src/core/reserves.ts` (reserves, faces, surveys),
`src/ui/hubPanel.ts`, and changes to the files above.

If a number here disagrees with the code once it ships, the code wins.

**Glyphs:** ▲ regolith · ◆ metals · ◇ silicon · ≈ water · ○ O₂ · ⚙ parts · ≡ data.
Costs are base costs. Placed costs scale by the site's `buildCostMult`: mare ×0.8,
pole ×1.25, lava tube ×1.1. Tech costs are shown after `ERA_COST_SCALE`.

**Words.** A **deposit** is a mapped patch of one kind of ground (today's
extraction zone). A **working face** is one digger's place in it. A **hub** is a
processing building that owns robots. **Units** (or haulers) are those robots. This
doc never says "site" for a deposit, because the code already uses "site" for a
landing site and for a construction site.

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

## 1. Decisions

| Topic | Decision | Why |
|---|---|---|
| Who owns the diggers | **Hubs.** The Regolith Smelter, the Silicon Refinery and a new **Water Management Plant** each print, dock, charge and dispatch their own units. Excavators and Ice Harvesters are no longer placed. | The player's first request. |
| Regolith storage | **Each hub's units feed that hub's own hopper.** There is no shared regolith pool. The ▲ chip shows the sum of the hoppers. | Placement only matters if a hub eats what its own robots bring. A pool lets a well-placed hub cover for a badly placed one (§3.2). |
| Feed grade | **Per hub.** Each hub keeps its own feed EMA. | A smelter on ilmenite reads 100% high-Ti even while the refinery scrapes plain ground. Today one EMA mixes both. |
| Plain ground | Smelters and refineries can always **scrape** plain ground beside the hub: unlimited, base grade, no survey. Water plants cannot. | Exhaustion must never starve the run. Deposits are the +30–60% on top. Ice is the one hard limit, as on the real Moon. |
| The first unit | **Every hub comes with its first unit, priced into the hub.** The smelter costs what a smelter and an excavator cost today. | No hub ever stands useless, and today's opener costs the same. "Free with the first hub only" leaves a second hub dead until you print a unit (§4.2). |
| More units | Printed by the hub from a queue: the unit's cost, a print time, 4 kW while printing. **No construction rover is needed.** | "You have to build more from the smelter." Extraction stops competing with the build queue. |
| Cap | **Bays.** A hub has 2 bays at Level I, 3 at Level II and 4 at Level III. Units ≤ bays. You buy each level at the hub once research allows it. | "A cap per hub level." A level is a decision about one hub: you grow the hub that sits at the good ground. |
| Where units dig | Auto: the choice that fills the hub with the most feed-weighted regolith, its hunger capped. In practice that is the nearest wanted deposit by haul time, unless the scrape feeds the hub as well. Or the player sends them. | The nearest by haul time is what the player predicts. The scrape guard stops a refinery from starving itself on a far deposit (§4.4). |
| Reach | A unit works deposits up to **90 s one way** at its current speed. The player can send it up to 2× that. | Reach is by haul time, not by the build network. Speed research extends it. |
| Deposits | **Finite.** Each holds a seeded reserve. The last quarter is a lean tail at falling grade. At zero the deposit is exhausted and its units re-route. | The second quote. The lean tail is the early warning. |
| Slots | **Working faces**: 1–6 per deposit, by area (one per 500 m²). One unit per face. | "A limit to how many excavators can be present on a given resource site." |
| Surveys | A **deposit survey** is a rover job from landing: 30 stored energy, 2⚙, 40 rover-seconds. It reveals the reserve (±30%), the grade, the faces and the life. Research tightens it. | It builds on `surveyIce`'s energy cost and the Lunar Map's lent-rover survey. It is not a third copy of either (§9). |
| Unsurveyed deposits | They can be dug. The card shows the kind and a size class; reserve and faces read `?`. Faces are enforced anyway. | Surveying is information, not a gate. Digging blind is a real risk with a clear lesson. |
| `regolithProcessing` | **Retired.** Its slot and its price (30) go to **Pit Mapping**: off-road speed inside deposits ×1.3. An alias maps the old id. | The smelter is known from landing. The first research stays the cheap one, so Era 1 keeps its pace (§10.1). |
| `iceHarvester` | **Retired.** Placed harvesters in old saves become legacy pads, then the first water plant's miners. | Water now comes from a hub like everything else. |
| `propellantPlant` | **Kept** as the rocket launcher. Water plants feed it. With Water Electrolysis done, its inputs fall 40%. | It is the pole's launch doctrine. Electrolysis at the water plant is the "future rocket fuel" link the player asked for. |
| Future hubs | **The pattern holds.** A hub is one row in `HUB_DEFS`. A KREEP works (thorium make-up for reactors) is the next candidate, when Rare Earths return (docs/09). | One mechanism for every resource family. |
| Highlight | Picking or selecting a hub **lights its deposits** in the world and on the Lunar Map's SITE view, with a trip time, faces and reserve on each. Full and exhausted deposits look different. It works on tap. | The end of the first quote. |
| Old saves | Placed excavators become units of the nearest matching hub. Without one, each stays a legacy pad until a hub stands. **Reserves start full.** | Nothing is stranded, and no base breaks on load (§15). |

---

## 2. Measured today

`scripts/probe-pacing.mjs` on main `97e1373`, reasonable policy, natural destiny,
seeds 42, 7 and 1234, 260 min, with an instrumented copy that samples every
excavator's haul every 120 s (`getFleet().hauls`). Deposits from the heightfield
over 12 seeds.

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
  The bot never uses Dig at…. Mare and lava tube excavators sit on the
  guaranteed ilmenite patch. At the pole they sit on plain ground, the starter
  ice, or the near anorthosite.

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

**Deposits** (`DEPOSIT_PLAN`, `src/data/deposits.ts:41-58`; 12 seeds; "rim" is
the distance from the Lander to the ring):

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

Two facts shape the design. The mare's only anorthosite lies 220–390 m out,
so a mare refinery is a real placement question. The lava tube has no
anorthosite at all.

---

# Part 1 · Hubs

## 3. The three hubs

### 3.1 What each hub is

| Hub | id | Footprint | Cost with its first unit | Build | Crew | Power | Recipe (per s) | Hopper | Unit | Wanted ground |
|---|---|---|---|---|---|---|---|---|---|---|
| **Regolith Smelter** | `smelter` | 3×2 | **60◆ 15⚙** (was 40◆ 10⚙) | 150 s (was 120) | 2 | −12 kW | 2▲ → 0.5◆ 0.25○ 0.05≈ | 315▲ | Regolith Excavator | ◆ high-Ti basalt (H₂ smelting). With MRE: none, since it melts any soil |
| **Silicon Refinery** | `refinery` | 3×2 | **70◆ 20⚙** (was 50◆ 15⚙) | 150 s (was 120) | 2 | −14 kW | 2▲ → 0.4◇ | 315▲ | Regolith Excavator | ◇ highland anorthosite |
| **Water Management Plant** (new) | `waterPlant` | 3×2 | **60◆ 15⚙** | 140 s | 1 | −6 kW (−9 on mature soil) | ice ore → water, up to 0.9≈/s · or 2▲ mature soil → 0.12≈ | 120≈ ore · or 315▲ | **Ice Miner** at the pole · Regolith Excavator elsewhere | ❄ cold-trap ice · ≈ mature soil |

- **Unlocks.** The smelter is unlocked from landing (`unlockedFromStart`), as the
  excavator was. The refinery stays behind Silicon Refining (E2). The water plant
  comes with Cryo Ice Extraction at the pole and Solar-Wind Volatiles at the mare
  and lava tube (both E1, both already there, re-pointed; §10.4).
- **Each price is the old building plus one unit.** The smelter is 40◆ 10⚙ and an
  excavator is 20◆ 5⚙. The water plant is 35◆ 10⚙ and an ice miner is 25◆ 5⚙
  (the old harvester's price). The extra 30 s of build time is the unit's
  assembly. It rolls out of its bay when the hub stands.
- **Recipes are today's.** The smelter's and the refinery's numbers do not move.
  The water plant's ice recipe processes what its miners bring, up to 0.9≈/s
  (two miners). Its mature-soil recipe bakes 2▲/s into 0.12≈/s on mature soil,
  or 0.05≈/s on plain ground (×0.4). Two Solar-Wind Volatiles excavators on mature
  soil make 0.10≈/s today; the retort at the plant does a little better.
- **Hubs are docks** (docs/15 §2, §5a). Each lays a spur and its parking bays
  beside the door. Each is refused inside an extraction zone
  (`src/core/roads.ts:631`) and with no room for a bay (`:684`).
- **Priority** stays 2 for the smelter and refinery. The water plant is 1, like
  the harvester. Units run at their hub's priority, so a brownout sheds a hub and
  its robots together.

### 3.2 Hoppers, not a pool

**Recommendation: each hub's robots feed that hub directly.** Regolith lives in
hub hoppers and nowhere else.

| Concern | Shared pool (today) | Hub hoppers (recommended) |
|---|---|---|
| Strategy | A unit's trip only sets how fast the pool fills. A good hub covers for a bad one. | Every hub lives on its own haul. A badly placed hub shows it, alone. |
| Legibility | "Regolith 180▲" says nothing about which furnace starves. | "Smelter #3 · hopper 40/315▲ · starved 31%" says which. |
| Feed grade | One EMA for smelters and refineries: anorthosite dug for the refinery hurts the smelter (FEED −0.30). | Per hub. The refinery's anorthosite never reaches a smelter. |
| Storage | The Lander (300▲) and yards (400▲ each) cap one stock. | Each hub holds 3 buckets (315▲). A full hopper sends its units to wait at the face with a full bucket, as today (docs/15 §5). |
| The Builder's flow book | Regolith made against wanted. A starved furnace reads about 0 net (docs/13 §0). | Regolith stays in the book as a sum. The unit rule reads each hub's starved share instead, which is exact. |
| Cost to build | — | The HUD chip, milestones and insights read the hopper sum. Grading's 6▲ goes to the nearest smelter or refinery with room. Yards and the Lander lose their ▲ cap. |

- `s.resources.regolith` stays in the state. It becomes **the sum of the hoppers**,
  written once per tick by the hub step and by nothing else. So the HUD chip, the
  regolith panel, the Dig In milestone and the `siliconRefining` insight keep
  working unchanged.
- The ▲ chip reads `180/630▲ in 2 hoppers`. The regolith panel lists each hub:
  its hopper, its feed shares, its units and its starved share.
- The Storage Yard keeps its other caps. Its pro text loses "400 regolith".
- `s.feed` (the global EMA) stays, as the draw-weighted mean of the hub feeds. The
  KREEP reactor rule (15% of your digging, `FEED.kreepReactorShare`) and the
  regolith panel read it.
- There is no Lander drop any more. A unit always belongs to a hub.

### 3.3 The Ice Harvester and the Propellant Plant

| Building | Fate | Details |
|---|---|---|
| `iceHarvester` | **Retired** from the palette and `BUILD_ORDER`. Its id stays for old saves. | Its price, crew seat and techs move to the water plant and its Ice Miners. Old harvesters keep working as legacy pads until a water plant stands (§15). |
| `propellantPlant` | **Kept**, unchanged: water 0.30 + O₂ 0.05 → launch 0.01. | Water plants are its supply. Water Electrolysis (§10.3) cuts its inputs by 40%: it takes split gases by pipe instead of splitting water itself. Its tanks gain a propellant dewar on the plant (§16). |

### 3.4 Future hubs follow the pattern

A hub is one entry in `HUB_DEFS` (`src/data/hubs.ts`): the building, its unit,
its wanted kinds, its hopper and whether it may scrape.

```ts
export const HUB_DEFS: Partial<Record<BuildingId, HubDef>> = {
  smelter:    { unit: 'excavator', wants: ['ilmenite'], scrape: true,  hopper: 315 },
  refinery:   { unit: 'excavator', wants: ['anorthosite'], scrape: true, hopper: 315 },
  waterPlant: { unit: (site) => site.hasIce ? 'iceMiner' : 'excavator',
                wants: (site) => site.hasIce ? ['ice'] : ['volatiles'], scrape: (site) => !site.hasIce, hopper: 120 },
};
```

- **Next candidate: a KREEP works.** Its units dig ☢ KREEP soil, and it makes the
  reactor's fuel make-up (today a 15% feed share). It fits when Rare Earths
  return (docs/02, docs/09).
- A glass works (O₂ from pyroclastic beads) would be another, but the smelter's
  O₂ bonus covers glass well enough today.
- Every hub gets the same bays, queue, highlight, reach and Builder rule for free.

---

## 4. Units: robots that belong to a hub

### 4.1 The two unit types

| | Regolith Excavator | Ice Miner (new) |
|---|---|---|
| Built by | Smelter, Refinery, and a water plant off the ice | Water plant on the ice |
| Cost | 20◆ 5⚙ (as today) | 25◆ 5⚙ |
| Print time | 60 s | 70 s |
| Draw | −6 kW while it works (as today) | −6 kW |
| Upkeep | 2⚙ a lunar day (as today) | 2⚙ a lunar day |
| Bucket | 105▲ (`HAUL.bucket`), scaled by its output multipliers | 40≈ of ice ore × the deposit's grade |
| Dig · unload | 60 s · 4 s | 60 s (heated auger) · 6 s |
| Speed | 5 m/s on roads, 2.5 m/s off-road in a deposit | 4 m/s, 2 m/s off-road (a tracked crawler) |
| Width | 3.8 m, a wide load (docs/15 §6) | 3.6 m, a wide load |

- **Both stay in `BUILDINGS`**, flagged `unit: true`: not placeable, not in the
  palette, never on the Builder's placement list. That keeps every tech effect that
  names `excavator` (Grizzly Screens, Dust Mitigation, Autonomous Haulage, …)
  working, through the same `effectiveDef` and `Mods` machinery.
- Units have **no crew** and **no overclock**. Dynamic Clocking still applies to
  the hub.
- The ice ore is counted in water-equivalents, so the plant's hopper and the
  deposit's reserve both read in ≈.

### 4.2 Printing, the queue and the cap

| Rule | How |
|---|---|
| The first unit | Comes with the hub: in its price and its build time. It rolls out when the hub commissions. |
| Printing more | **+ Excavator** (or **+ Ice Miner**) in the hub's inspector adds a job to the hub's queue. |
| When it pays | When the job reaches the head of the queue. Short of stock, it waits and says so: `waiting: 16◆ (have 9)`. Nothing is paid at enqueue. |
| While it prints | The unit's print time × `buildCostMult`, at 4 kW (`CONSTRUCTION_KW`). It pauses in a brownout. The hub keeps processing. |
| The queue | Up to 3 jobs a hub. Cancel refunds all that was paid. |
| The cap | Units ≤ bays. A full hub's button reads `BAYS FULL 2/2 — + Bay (Bay Extensions)`. |
| Levels | Level I: 2 bays, from landing. Level II: 3 bays, **Bay Extensions** (E2). Level III: 4 bays, **Depot Halls** (E5). **+ Bay** is a queue job too: 30◆ 10⚙, 60 s, 4 kW. |
| Room for a bay | A new bay needs a free cell beside the hub's bays. With none: `NO ROOM FOR A THIRD BAY — beside its bays is road or a structure`. The placement ghost dots the Level II and III bay cells, so you can leave room. |
| Fleet OS (◉ E5) | +1 bay on every hub, free (§12.6). |

**Why every hub gets its first unit.** Both options were tried on paper:

| | Every hub, priced in (recommended) | The first hub only, free |
|---|---|---|
| Opener cost | Same as today: 2 arrays, smelter + unit, lab = 96◆ at mare | 20◆ cheaper: an extra array |
| A second smelter | Works the moment it stands | Stands idle until you print a unit |
| New trap | None | A hub built with the last metals, and no stock for its unit |
| The Builder | Places hubs that work | Must place a hub **and** order its unit |
| Price reads | "A smelter is 60◆ 15⚙: that includes its excavator" | "A smelter is 40◆ 10⚙, but it does nothing alone" |

### 4.3 Bays: parking and charging

- A hub's bays are **road bay cells beside its door**, the dock pattern of the
  Robotics Bay (`SpurPlan.bays`, `src/core/roads.ts:670-684`). Level I lays two:
  left and right of the door. Level II and III add one cell each, further along the
  front.
- **One unit per bay cell, nose to the wall.** A unit is 6 m long. Its tail holds
  the cell in front of its bay too, which traffic already treats as a wide load's
  overhang (docs/15 §6). The ghost keeps that cell free: the **bay apron**.
- A unit parks only when it has nothing to do: a new unit with no deposit, a
  recalled unit, a flare shelter, a long brownout, a charge, or no deposit in reach.
  **It does not park while its hopper is full.** It waits at its face with a full
  bucket, as today (docs/15 §5).
- **Charging** (work/unitpower): `homeOf(unit)` is its hub and `chargeSpotOf(unit)`
  is its bay cell. It tops up at the hub's charge post while it tips each load (a
  4–6 s stop) and fully in its bay. The charging load shows in the power panel
  under the hub: `Smelter #3 · charging 2 units · 4.2 kW` (§12.3).
- The hub's **tipping stand** is its door cell. Units queue for it and tip nose to
  the hopper chute (`standFor`, `stopShort` in `src/core/haul.ts:120-154`).

### 4.4 Where a unit digs

**Auto (the default).** Each tick a unit without work takes, in order:

1. the deposit the player assigned to its hub (**Assign**), if it has a free face;
2. otherwise, the choice with the best **hub intake**: `min(units × rate, the hub's
   hunger) × feed factor`, with `rate` from `tripFor` and ties to the nearer. In
   practice that is the nearest wanted deposit by haul time. The scrape counts as a
   candidate at 6 s each way and plain grade. All of a hub's auto units make the
   same choice; splitting them is Feed Planner's job (§10.4);
3. otherwise, it parks: `IDLE — no deposit in reach with a free face`.

- **The scrape guard matters.** A mare refinery near the Lander could reach the
  anorthosite 260 m out (a 58 s trip one way, inside 90 s). One unit there delivers
  0.75▲/s at grade 0.85 (×1.34): an intake worth 1.0. On the scrape it delivers
  1.73▲/s at ×1.0. Two units tie at 2.0 each way, and the tie goes to the nearer
  scrape. The auto rule keeps the units home and the inspector says why:
  `◇ anorthosite #0 · 0:58 · worth 1.0 a unit against the scrape's 1.7 — build a
  Refinery by it`.
- **The furnace cap matters too.** A smelter with ilmenite 100 m out: one unit
  there is worth 1.43 against the scrape's 1.73, so the scrape wins. With two units,
  the deposit fills the hopper (2.26▲/s, capped at 2) at ×1.26: 2.5 against the
  scrape's 2.0, so the deposit wins. The second unit is what makes the far bed pay.
- **Reach** is 90 s one way (`HUB.reachS`) at the unit's current speed: roads ×
  the roadway tiers, off-road × Pit Mapping. At base speed that is about 400 m of
  road plus 25 m off-road. A deposit beyond reach is never auto-chosen. **Send…**
  goes up to 2× reach.
- **Faces are reserved at assignment**, so an auto unit never arrives at a full
  deposit. A unit the player sends to a full one waits at its gate:
  `WAITING AT THE GATE — high-Ti basalt #0 has 3/3 faces working`.
- A deposit's faces are shared by every hub. The first unit to be assigned holds a
  face until it leaves.

**By hand**, in the hub's inspector and the unit's:

| Button | Does |
|---|---|
| **Assign** (on a deposit row) | The hub's preferred deposit: its auto units go there as faces allow. **Assign scrape** keeps them home. |
| **Send…** (on a unit) | Targets a deposit on the map, as Dig at… did. The unit is pinned there until the deposit is exhausted, or you press Auto. |
| **Recall** (a unit, or all) | Home to the bay, where it stays until **Dispatch**. |
| **Auto** | Unpins a unit. |

### 4.5 The cycle in the sim

The cycle is today's `haulTick` (`src/core/haul.ts:360-450`) with new ends.

```
bay ─(road)→ hub door ─(road)→ deposit gate ─(off-road)→ face ─ dig ─(off-road)→ gate ─(road)→ hub door ─ tip ─→ next trip
```

| Leg | Rule |
|---|---|
| Out and back | `groundWay` (`src/core/roads.ts:433`): the road route from the hub's door to the deposit's gate, then straight over the regolith to the face at `ROAD.offroad` (0.5) of road speed. |
| The scrape | No route. 6 s each way (`HUB.scrapeS`), drawn as a shuffle to the hub's side. |
| Digging | `digS / digMult` fills the bucket. The deposit's grade decides how much of it is the deposit's kind; the rest is plain (§7.2). |
| Tipping | Into the hub's hopper, credited on unload. The hub's feed EMA moves (`creditFeed`). The reserve falls by what was dug. |
| Hopper full | The unit waits at its face with a full bucket (today's rule). |
| No road to the gate | `NO HAUL ROAD — …`: it takes its next choice, else parks. Placing a hub plans that road with its spur (§5.3). |
| Exhausted mid-dig | It leaves with a part bucket and re-routes (§7.3). |
| The hub dark or off | Units finish their trip, tip, and park. |
| Power | Each working unit is a −6 kW load at its hub's priority, as an excavator was (economy step 2). |

**Tick order.** Economy step 4 runs `'excavator', 'iceHarvester'` first today
(`PROD_ORDER`, `src/core/economy.ts:42-48`). That step becomes **hub units**: every
unit in id order, hub by hub. Hubs then draw from their own hoppers in the same
step. Old legacy pads keep their place.

### 4.6 State

```ts
/** A hub's robot (core/hubs.ts). */
interface Hauler {
  id: number;
  type: 'excavator' | 'iceMiner';
  hub: number;                   // its hub's building id: work/unitpower's homeOf
  bay: number;                   // its bay at the hub
  deposit: string | 'scrape' | null;  // where it works (null: parked)
  face: number | null;           // the working face it holds
  pinned?: boolean;              // Sent by the player
  parked?: 'new' | 'recalled' | 'flare' | 'brownout' | 'charge' | 'noDeposit';
  haul: HaulState;               // today's cycle, drop = its hub
  wear: number;
  brickedUntil?: number; heldUntil?: number;   // hazards, as a rover
  junk?: number;                 // a runaway rule's print (never commissions)
  feedPlanOff?: boolean;
  auto?: { by: 'rule' | 'order'; at: number };
}
interface HubState {               // on BuildingState.hub
  level: 1 | 2 | 3;
  hopper: number;                // ▲, or ≈ of ice ore
  feed: FeedGrade;               // this hub's feed EMA
  queue: HubJob[];               // units and bays, head first
  prefer?: string | 'scrape';    // Assign
  starved: number;               // 120 s EMA: share of ticks idle for inputs
  electrolysis?: boolean;        // a water plant with Water Electrolysis
}
interface HubJob { kind: 'unit' | 'bay'; paid: boolean; left: number; total: number; auto?: boolean; junk?: number }
// GameState: haulers: Hauler[]; nextHaulerId: number; hubSchema: 1; pile?: number (a migrated save's loose ▲)
```

`HaulState` loses `pad`, `roadJob` and `drop` choice. It gains `face`. Wear, upkeep
and hazards read haulers as they read rovers. `stats.haulMaxM` stays.

### 4.7 The hub's inspector

```
REGOLITH SMELTER #3 · Level I · 2 bays                    RUNNING · 12 kW · 2 crew
hopper ▮▮▮▮▮▯▯▯ 180/315▲ · feed 86% high-Ti · starved 12% (last 2 min)

UNITS 2/2                     [+ Excavator  16◆ 4⚙ · 0:48]   [+ Bay · needs Bay Extensions]
QUEUE  —

ROBOTS
 E1 Excavator · DIGGING high-Ti basalt #0, face 2 · 78/131▲ · trip 0:08 · 1.6▲/s   [Send…] [Recall]
 E2 Excavator · HAULING 131▲ to the hub · 0:05                                       [Send…] [Recall]

DEPOSITS IN REACH (one way, now)
 ◆ high-Ti basalt #0 · 0:08 · faces 2/2 · 6.1k▲ left of 7.8k (±30%) · ~4.2 lunar days     [Assigned]
 ◆ high-Ti basalt #3 · 0:41 · faces 0/2 · unsurveyed                                       [Survey] [Assign]
 plain ground (the scrape) · 0:06 · unlimited · feed plain                                 [Assign]
```

- The top line takes today's status words (`IDLE — inputs` becomes
  `STARVED — the hopper is empty: its units deliver 1.4▲/s of the 2▲/s it burns`).
- **The hint under UNITS** answers "is another worth it?":
  `A 2nd excavator would fill the hopper: +0.57▲/s → +14◆/min for 16◆ 4⚙ and 6 kW ·
  pays back in 1:10` (a smelter 40 m from its deposit). It shows while the hub is
  starved ≥ 10%, a face is free and a bay is free.
- **Life** everywhere is reserve left ÷ what is really dug: the units' rate, capped
  by the hub's hunger. Two units at a mare smelter dig its 2▲/s, not their 3.3.
- **The unit's own inspector** (a click on the unit in the world) shows its line,
  its hub, its deposit and face, its wear, its charge (with work/unitpower) and
  Send… / Recall / Auto.
- **Robots panel.** The fleet panel gains a HAULERS tab: every unit by hub, with
  the same line.
- On touch the inspector is the side sheet (docs/07 §13). Every button is 44 px.

**Alerts.**

| When | Alert | Kind |
|---|---|---|
| A unit rolls out | `EXCAVATOR E3 READY — Smelter #3 sends it to high-Ti basalt #0 (face 3, trip 0:14)` | info · select |
| Printing waits | `PRINT WAITING — Smelter #3's excavator needs 16◆ (have 9)` | condition · info |
| A hub starves | `SMELTER #3 STARVED — its hopper ran dry 30% of the last 2 min: a unit, a nearer deposit, or Assign scrape` | condition · warn, after 120 s |
| No deposit | `REFINERY #9 IDLE — no deposit in reach with a free face; it scrapes plain ground` | condition · info |
| Water plant with nothing | `WATER PLANT #12 DRY — no ice in reach: the nearest mapped cold trap is 2:10 away` | condition · warn |

---

## 5. Placement is the strategy

### 5.1 Haul time

One way, from the hub's door:

```
t = road metres / v  +  off-road metres / (v × 0.5 × offroadMult)
v = HAUL.speed (5 m/s) × haulSpeedMult × roadSpeedMult × roadHaulMult (× roadNightMult after dark)
cycle = digS / digMult  +  unloadS  +  2 t
rate per unit = bucket / cycle
```

This is `tripFor`'s formula today (`src/core/haul.ts:217-227`), measured from the
hub instead of from a pad. The off-road leg is from the gate to the face.

**Typical numbers.** One Regolith Excavator at the mare (isru ×1.25), no research,
H₂ smelting, a deposit at grade 0.88 (feed factor 1.26), 15 m off-road:

| Hub to gate by road | One way | Cycle | ▲/s delivered | ◆/min it feeds | Units to fill one smelter (2▲/s) |
|---|---|---|---|---|---|
| the scrape (plain, grade 1.0) | 0:06 | 76 s | 1.73 | 32 | 1.2 |
| 10 m | 0:08 | 80 s | 1.64 | 39 | 1.2 |
| 40 m | 0:14 | 92 s | 1.43 | 34 | 1.4 |
| 100 m | 0:26 | 116 s | 1.13 | 27 | 1.8 |
| 250 m | 0:56 | 176 s | 0.75 | 18 | 2.7 (the cap is 2: starved) |

- **Per unit**, a deposit 10–40 m out beats the scrape by only 5–20%. **Per
  smelter**, it wins by the feed factor: +26% metals from the same furnace, 12 kW and
  2 crew. With Ilmenite Beneficiation (the mare's doctrine), +53%, on 20% less
  regolith.
- So the furnace is the scarce thing, and the units are cheap. **Put the hub at the
  rim of the good ground**, and the second unit becomes cheap to justify.
- MRE smelting is feed-insensitive: an MRE smelter has no reason to move. That is
  the doctrine's point (docs/05).

### 5.2 The ghost

A hub's ghost adds a HUB block under the ROAD line (docs/15 §3). It updates when
the ghost moves a cell.

```
HUB  ◆ high-Ti basalt #0 · 12 m by road + 15 m off-road · faces 2 of 2 free · trip 0:08
     ~1.6▲/s ≈ 39◆/min per excavator · 7.8k▲ (±30%) ≈ 5.4 lunar days at this smelter's 2▲/s
     next: ◆ high-Ti basalt #3 · 0:41 · unsurveyed
ROAD 6 cells + a 3-cell haul road to its gate · 18 rover-s to sinter, before it rises
```

- **Unsurveyed:** `… · faces ? · reserve ? — survey it first [the deposit's card]`.
- **Full:** `◆ #0 is full (3/3 faces) — its units would go to ◆ #3, 0:41`.
- **Nothing wanted in reach:** `no high-Ti basalt in reach: its excavator scrapes
  plain ground (feed plain, 32◆/min)`.
- **MRE smelting:** `MRE melts any soil: the scrape serves it as well as a deposit`.
- **Water plant with no ice in reach** is a **warning**, not a refusal: `NO ICE IN
  REACH — the nearest mapped cold trap is 2:10 away (reach 1:30); map further or
  build nearer`. The first click asks and the second builds, as the smelter
  warning does (`smelterWarning`, `src/buildings/placement.ts:59-68`). Ice may lie
  unmapped inside reach, so a hard refusal could be wrong.
- The Level II and III bay cells show as dotted cells, and so does the bay apron.

### 5.3 The hub's own roads

- Placing a hub plans its **spur** (docs/15 §3) **and a haul road** from the network
  to the gate of the deposit its first unit will take. One A* each. The ghost's ROAD
  line counts both.
- The hub's rovers sinter both before they weld. A hub never stands with its first
  unit unable to reach its deposit.
- A later deposit's road is a haul-road job for free rovers (docs/15 §5), laid when
  a unit is first assigned there. Until it opens, the unit takes its next choice.
- Old `Dig at…` haul roads to plain cells are no longer made. The scrape replaces
  them.

---

## 6. Resource highlighting

### 6.1 What lights, and how

It shows while **placing** a hub (the ghost) and while a hub is **selected**. On
touch, the first tap on the hub's card or on the hub is enough.

| Hub | Lit | Also shown, dimmer |
|---|---|---|
| Regolith Smelter (H₂) | ◆ high-Ti basalt | ○ glass (`O₂ +60%`), ☢ KREEP (`reactor make-up at 15%`) |
| Regolith Smelter (MRE) | none: `MRE melts any soil` on the ghost | — |
| Silicon Refinery | ◇ anorthosite | — |
| Water Management Plant | ❄ cold-trap ice · ≈ mature soil (off the ice) | — |

| State | Ring | Label |
|---|---|---|
| Lit, in reach | the kind's own pattern (docs/05), **twice as thick**, and a faint fill | `◆ 0:14 · 2/3 · 7.8k▲` (one way from the ghost or hub · free/total faces · reserve left) |
| Lit, unsurveyed | the same ring | `◆ 0:14 · ?/? · ?▲` |
| Lit, out of reach | the same ring, half weight | `◆ > 1:30` |
| **Full** | the ring broken into a long dash | `◆ FULL 3/3 · 0:14` |
| **Exhausted** | cross-hatched, with the pit drawn (§16) | `◆ EXHAUSTED` |
| Not this hub's kind | the usual ring at 30% | none |

- **Never colour alone** (docs/07 §6a). Weight, pattern, the fill and the label carry
  every state. Classic palette keys: `depositLit`, `depositFull`, `depositSpent`.
- **Reach and time.** The nearest lit deposit's time comes from the planned haul
  road (§5.3). The other labels use the straight line × 1.3 plus the off-road leg,
  marked `≈`. There are no reach rings: haul time follows roads, not circles.
- **The Lunar Map's SITE view** (there is no minimap) draws the same states from the
  same `$deposits` payload, which gains `lit`, `state`, `eta`, `faces` and `left`.
  Opening the map with a hub selected keeps the highlight.
- **Classic and High detail** share the overlay's line segments
  (`Game.rebuildDepositOverlay`). High detail adds an emissive rim line. Nothing
  depends on hover.
- The overlay turns itself on for a hub's ghost, as it does for an excavator's today
  (`src/core/game.ts:695`), and back off when placing ends if it was off before.

### 6.2 Cost

- The rings are today's merged line mesh. Lighting a kind swaps its material: no
  new geometry, rebuilt only on reveal or survey.
- Labels are the overlay's DOM markers (`updateDepositMarkers`,
  `src/core/game.ts:1864-1886`) with a longer string. The signature check already
  skips frames where nothing moved.
- ETAs are recomputed when the ghost changes cell, and at most 4 times a second for
  a selected hub. That is one extra A* per cell change (the haul road), plus a
  straight-line estimate per lit deposit.

---

# Part 2 · Finite deposits, faces and surveys

## 7. Finite reserves

### 7.1 How much a deposit holds

Every deposit of a zone kind holds a reserve, derived from the seed and its id.

```
rng     = mulberry32(seed ^ 0x7e5e ^ hashString(deposit.id))
depth   = depth range, from rng           (m)
grade   = grade range, from rng           (the share of a bucket that is the deposit's kind)
reserve = π r² × depth × per-m³           (▲, or ≈ for ice)
guaranteed starters: at least the floor
```

| Kind | Depth | Per m³ | Grade | Starter floor | Reserve range | Why |
|---|---|---|---|---|---|---|
| ◆ high-Ti basalt | 2.5–5 m | 1.6▲ | 0.75–1.0 | 6,000▲ | 3k–17k▲ | a mare bed a few metres thick at 1.6 t/m³ (▲ ≈ a tonne) |
| ◇ anorthosite | 3–6 m | 1.6▲ | 0.75–1.0 | 6,000▲ | 7k–35k▲ | broad highland beds |
| ○ pyroclastic glass | 2–4 m | 1.6▲ | 0.7–1.0 | 5,000▲ | 3k–12k▲ | thin bead mantles |
| ☢ KREEP | 3–5 m | 1.6▲ | 0.6–0.9 | — | 5k–8k▲ | one small patch |
| ≈ mature soil | 1–2 m | 1.6▲ | 0.7–1.0 | — | 3k–13k▲ | only the weathered top layer holds solar-wind volatiles |
| ❄ cold-trap ice | 2–4 m | 1.0≈ | 0.7–1.0 | 1,200≈ | 1.2k–15k≈ | ice-cemented regolith in the shadows |

A peak of light holds nothing: it is not a zone.

**What that makes on the probe's seeds:**

| Seed | Mare ◆ (r, distance, reserve, grade, faces) | Pole ❄ starter · the next six | Lava ◆ |
|---|---|---|---|
| 42 | #0 r19 @45: 7.8k▲ g0.79 f2 · #3 @131: 5.1k · #2 @141: 5.5k · #1 @302: 9.6k | #0: 1.3k≈ g0.73 f1 · 3.1k–10.2k each | #0 r24 @49: 12.6k · #1 @141: 4.2k |
| 7 | #0 r19 @32: 6.4k▲ g0.88 f2 · #1 @53: 10.2k · #3 @65: 6.9k · #2 @234: 7.4k | #0: 1.3k≈ g0.87 f1 · 3.1k–9.6k | #0 r19 @32: 6.4k · #1 @53: 10.2k |
| 1234 | #0 r25 @41: 8.9k▲ g0.97 f3 · #1 @71: 10.9k · #2 @118: 8.5k · #3 @242: 5.6k | #0: 1.7k≈ g0.81 f1 · 5.4k–10.3k | #0 r23 @36: 7.7k · #1 @106: 9.5k |

- Total mare ilmenite: 28–34k▲. Mare smelters dig about 18–24k▲ a run (two
  thirds of all regolith). There is room to expand, and no room to stay put.
- Total pole ice: 38–50k≈, against at most 3.6k≈ a run. Ice is scarce near the
  Lander, not scarce on the map.
- The lava tube holds 17k▲ of ilmenite in two deposits, against about 30k▲ its
  smelters dig. By mid-game its smelters live on glass and the scrape. That is a
  pacing risk to watch (§14).

**"An era or two."** Worked at every face (2–3 units, 3.3–4.9▲/s at the mare), a
starter lasts 30–45 min: an era and a half. Worked at one smelter's hunger (2▲/s),
a mare starter lasts about 55–75 min. On the baseline's dig curves the first exhaustion
lands in Era 4 or 5 (§14.3). A lunar day is 720 s at 1× (docs/00).

### 7.2 Grade, and the lean tail

- **Grade** is the share of each bucket that is the deposit's kind. The rest is
  plain. A 0.88 ilmenite bed feeds the hub 88% high-Ti. That is what the hub's feed
  EMA sees, so the smelter bonus is `1 + 0.30 × 0.88`.
- **The lean tail.** Once less than a quarter of the reserve is left, the grade falls
  linearly to half: `grade × (0.5 + 2 × left/total)`.
- The hub's feed line shows it: `feed 64% high-Ti — the bed thins (18% left)`. This
  is the early warning, and it reads even on an unsurveyed deposit.
- The ice miner's bucket scales by grade in the same way.

### 7.3 Exhaustion

| Moment | What happens | Alert |
|---|---|---|
| 1 lunar day left at the current dig | the deposit card and hub show it | `DEPOSIT RUNNING OUT — high-Ti basalt #0: ~1 lunar day left at 2 units · survey the next one [I]` (warn, once) |
| 25% left | the lean tail begins | the hub's feed line |
| 0 left | **exhausted**: faces close; units leave with part buckets | `DEPOSIT EXHAUSTED — high-Ti basalt #0 is dug out · Smelter #3's 2 excavators go to high-Ti basalt #3 (0:41) · feed 88% → 81%, output −22%` (warn, select the hub) |
| no other deposit in reach | smelter and refinery units take the scrape; water-plant units park | `… no other ilmenite in reach: they scrape plain ground (feed plain) — a Smelter by high-Ti basalt #3 would feed 100%` |
| an unsurveyed deposit runs out | the same, with no 1-day warning | `… (never surveyed — a survey would have warned you a lunar day ahead)` |

- **Re-routing is base behaviour.** Every unit re-routes by §4.4 whether or not the
  Builder is on.
- An exhausted deposit stays an extraction zone (the pit, its gate, its roads). It
  lights as `EXHAUSTED`.
- **Research revives it.** Deep Coring (E4) adds 25% of each deposit's original
  reserve, and Deep Sounding (E7) adds 15% more. An exhausted deposit reopens its
  faces: `DEEPER BED — high-Ti basalt #0 reopens: +1.9k▲ (Deep Coring)`.

### 7.4 Expansion: the map is the answer

Exhaustion is meant to push the base outward. Everything it pushes toward already
exists:

| Pressure | The answer | System |
|---|---|---|
| The near deposits are dug out | Map further: T1 REGIONAL shows deposits to 320 m, and T2 the whole map | Prospecting Rovers (E1), Orbital Prospector (E4); docs/05 survey tiers |
| The next deposit is outside the build network | Grow the network toward it | Relay Masts (45 m each, chaining), Habitats (60 m) |
| It is too far to haul from the old hub | Build a new hub at its rim | §5, and the Builder's relocation line (§11) |
| Every local ilmenite is gone | Claim an outpost: an ilmenite outpost streams 0.20◆ 0.08○ per second with no dig | Lunar Map outposts (T2+, docs/11) |
| Beds run thin | Research deeper beds | Deep Coring (E4), Deep Sounding (T4, E7) |

The exhaustion alert names the next step that the base can take now. Once a
local-ilmenite exhaustion happens with T2 known, it adds `· an ilmenite outpost
(Lunar Map [M]) streams metals without a dig`.

### 7.5 Determinism

- The reserve, depth, grade, faces, face positions and the survey's estimate offset
  are functions of `(seed, deposit id)`. They are never stored, only derived.
- The state stores only what changes: `s.reserves[id] = { left, total, dug,
  surveyed?: { at, precision }, exhaustedAt? }`. `total` grows with Deep Coring.
- Unit choices are in id order with fixed tie-breaks (time, then deposit id, then
  face index). No randomness.

## 8. Working faces

- **Faces = clamp(floor(area / 500 m²), 1, 6).** r16 → 1, r19 → 2, r22 → 3,
  r25 → 3, r30 → 5, r34 → 6. The pole's starter ice (r10–13) has 1.
- **Face positions** are fixed points on a ring at 0.55 r, evenly spaced from a
  seeded angle. A unit takes the free face nearest the deposit's gate.
- **One unit per face.** A face is held from assignment until the unit leaves. So
  auto units never find a deposit full. Only a unit you Send can, and it waits at
  the gate.
- The UI always shows `faces used/total`: on the ghost, the label, the card and the
  hub's list. Unsurveyed deposits show `?/?`, and the rule still holds.
- **Research never adds faces.** A face is ground. Bays, speed and bucket size are
  the levers. (Open question 4 offers Bench Mining if the player wants one.)

## 9. Surveys

### 9.1 What the player knows, in three steps

| Step | Shows | How it happens |
|---|---|---|
| **Lead** `?` | "possible high-Ti basalt", roughly where | orbital data within 400 m (today, `LEAD_RANGE_M`) |
| **Mapped** | the kind, its ring and zone, a **size class** (`a small patch` < 1,000 m² · `a bed` · `a broad bed` ≥ 2,000 m²); reserve and faces `?` | the survey tier's radius, a Relay Mast, or building on it (today's `depositRevealed`, `src/core/exploration.ts:69-73`) |
| **Surveyed** | the reserve as a range, the grade, the faces, the life at the current dig | a **deposit survey** (below) |

### 9.2 The deposit survey

| | |
|---|---|
| Verb | **Survey** on the deposit's card, on a lit label, or in a hub's deposit list. Action `surveyDeposit { id }`. |
| Who | A **free construction rover**. The survey is a job, like a road job (docs/15 §3), taken before road jobs. It drives to the gate, off-road to the centre, and cores. A Drone Hive's drone flies straight to it and needs no road. |
| Cost | 30 stored energy (the core drill), 2⚙ (bits), 40 rover-seconds at the deposit. |
| Pays | +5≡: the cores go to the labs. |
| Road | The rover needs the deposit's gate. If no road reaches it, the survey plans one (the same road a hub will use later). With work/unitpower's off-road rule for masts, the rover may drive to a survey the same way. |
| One at a time | Per deposit. Several may queue. They do not use the Lunar Map's survey slot. |
| Result | `SURVEYED — high-Ti basalt #0: 5.5k–10.1k▲ (±30%), grade 88%, 2 faces · ~5 lunar days at one smelter's draw · +5≡` |
| Refusals | `UNMAPPED — map it first (Prospecting Rovers, a Relay Mast)` · `ALREADY SURVEYED (±15%)` · `SURVEY NEEDS 30 STORED ENERGY — have 12` · `SURVEY NEEDS A FREE ROVER — every rover is building; it waits in the queue` |

**What it reuses.**

- `surveyIce` (retired: `src/core/game.ts:912-915`): its idea of a survey paid in
  stored energy (`ICE_SURVEY_COST`). The old action alerts, pointing to the new
  verb.
- The Lunar Map's local survey (`SURVEY_CLASS.local`: a lander micro-rover, 60
  energy, 60 s): the lent-rover model. The deposit survey is its smaller, on-site
  cousin. Map prospects keep their own survey, slot and data.
- Relay Masts keep mapping (not surveying) within 45 m. With Neutron Spectrometry,
  they also survey ice and mature-soil deposits in their radius (§10.4).

### 9.3 Precision

| Source | Reserve shown as |
|---|---|
| A first survey | the estimate ±30% |
| Sample-Return Caches (E1) | ±15% |
| Gravity Gradiometry (E5) | ±5% |
| Digging it | nothing better: digging shows what is gone, not what is left |

- The estimate's centre sits off the truth by a seeded share of up to half the
  precision, so the truth is always inside the range. Better precision narrows
  around the same truth.
- A deposit surveyed before a precision tech is re-read for free when the tech
  completes: `SURVEYS RE-READ — 4 deposits now ±15%`.
- **Life** = left ÷ what is really dug (§4.7). It updates live: `~4.1 lunar days
  at 2▲/s (2 units)`.
- **Deep Coring** reveals deeper beds on every deposit, surveyed or not, and adds to
  `left` (§7.3).

### 9.4 The deposit card

`src/ui/depositCard.ts` gains a reserve block above the guide lines.

```
◆ HIGH-TI BASALT #0 · surveyed 3:12 · ±15%
reserve ▮▮▮▮▮▮▯▯▯▯  5.9k▲ left of 7.8k (±15%) · grade 88% · faces 2/2 working
life    ~4.1 lunar days at 2▲/s (2 units) · the lean tail begins at 1.9k
served  Smelter #3 (2 excavators, trip 0:08)
[Survey] [Select Smelter #3] [Show on the map]
```

- **Unsurveyed:** `reserve ? · a bed (1,466 m²) · faces ?` with **Survey** first.
- **Exhausted:** `EXHAUSTED at 1:34:10 · dug 7.8k▲ · Deep Coring reopens it (+1.9k▲)`.
- The card's `todo` lines change from "Put a Regolith Excavator on it" to the hub:
  `Build a Regolith Smelter at its rim: its excavators dig it`.
- The ice guide names the water plant instead of the Ice Harvester (`use:
  'waterPlant'`).

---

# Part 3 · Everything it touches

## 10. Research

### 10.1 Regolith Smelting retires

`regolithProcessing` ("Regolith Smelting", E1 ◆, 30 → 48≡,
`src/data/techs.ts:214-221`) unlocks the smelter. The smelter is now known from
landing, so the tech has no job left.

**The replacement is Pit Mapping** (new id `pitMapping`, E1 ◆). It takes the old
slot and the old price, 30 (48≡). That is below the Era 1 median (90), on purpose:
the first research stays the cheap one, so Era 1's charter, the bot's opening order
and the tutorial's first research keep their timing. It is the only cost below its
era's median in this doc.

**What refers to `regolithProcessing`, and its repair:**

| Where | Today | After |
|---|---|---|
| `src/data/techs.ts` | the tech; `requires` of Silicon Refining, Parts Fabrication, MRE, Beneficiation, Heat-Recovery Jackets, Basalt Paving | replaced by `pitMapping`. Those six require nothing new (Beneficiation keeps Prospecting Rovers). `TECH_ALIASES.regolithProcessing = 'pitMapping'` |
| Charters | E1: 8 visible at the mare, 9 at the pole and lava tube | unchanged counts: one out, one in |
| `migrateTechSchema` (`src/core/research.ts:985`) | techSchema 4 | **5**: the done, queued, spent and insight entries of `regolithProcessing` move to `pitMapping` |
| Milestone First Metal (`src/data/milestones.ts:81-88`) | Research Lab · research Regolith Smelting · Smelter · 100◆ | **Research Lab · Smelter · 100◆**. Hint: `Smelt 100 metals. Build a Research Lab too: research is how your hubs' robots get faster, haul more and dig deeper.` |
| Milestone Dig In (`:75-80`) | Excavator · 50▲ in stock | **Smelter · 50▲ delivered** (`stats.produced.regolith`, since a hopper is drawn as it fills). Hint: `Raise a Regolith Smelter at the rim of the high-Ti basalt (it lights up when you pick it): its excavator brings in the first 50▲. Survey the deposit first to see how much it holds.` |
| The smelter trap (`src/core/game.ts:1013-1022`, `smelterWarning` in `src/buildings/placement.ts:59-68`) | `METALS LOW — research Regolith Smelting, then build a smelter` | The research half is moot and goes. The metals half stays, re-priced at the hub: `METALS LOW — a Regolith Smelter costs 48◆ with its excavator; without one you cannot make more` |
| Discovery (`smelterFirst`, `src/ui/discovery.ts:152-157`) | "No smelter yet: research Regolith Smelting next" | deleted |
| `placement.ts:66` | "research Regolith Smelting to unlock it" | deleted |
| The probe (`scripts/probe-pacing.mjs:142`, `:284`) | first in the order; the smelter's unlock | `pitMapping` first in the order; the smelter needs no unlock |
| Tests: 71 references in 14 specs | about 20 `completeTech('regolithProcessing')` to unlock the smelter; about 30 use it as the cheapest E1 tech in queue, card and cancel tests; about 20 sit in E1 charter sets and old-id lists (some lines are both) | unlock lines deleted; queue and charter tests use `pitMapping` (same era, cost and lane, so their numbers hold); the alias covers stragglers with a warning |
| Docs | docs/03's generated tables, docs/11's tech table (15 mentions) | regenerated (`scripts/gen-tech-doc.mjs`); docs/11 gains a pointer here |

### 10.2 The extraction ladder

The player asked for research that makes units move faster, haul more and dig
quicker. Here is the whole ladder, era by era. **New** techs are in bold; the rest
exist and are folded in (§10.4).

| Era | Speed | Capacity | Dig and grade | Hubs and bays | Surveys and reserves | Water |
|---|---|---|---|---|---|---|
| E1 | **Pit Mapping** (off-road ×1.3) | Grizzly Screens (load ×1.1) | — | smelter and first unit from landing | Prospecting Rovers (surveys 2× faster, T1 map) · Sample-Return Caches (±15%) | Cryo Ice Extraction (pole) · Solar-Wind Volatiles (mare, lava): the water plant |
| E2 | — | — | **Hardfaced Teeth** (dig ×1.25) · Beneficiation (doctrine) | **Bay Extensions** (Level II) | Neutron Spectrometry (masts survey ice and soil) | Sublimation Tents (pole) |
| E3 | Basalt Paving (roads ×1.25) | — | Dust Mitigation (unit upkeep ×0.5) | Automated Excavation (the Builder) | Site Survey AI (the Builder surveys) | **Water Reclamation** (⌂) |
| E4 | — | — | Optical Ore Sorting (×1.1) | — | **Deep Coring** (+25% reserve) · Orbital Prospector (T2) | **Water Electrolysis** (⌂) · Heated Augers (pole) |
| E5 | Autonomous Haulage (speed ×1.3) | Autonomous Haulage (bucket ×1.25) | Feed Planner (multi-deposit routing) | **Depot Halls** (Level III, print ×0.75) · Fleet OS ◉ (+1 bay) | Gravity Gradiometry (±5%) | — |
| E6 | Guideway Rails (hauls on roads ×1.3) | — | Condition Optimization (×1.15) | — | — | — |
| E7 | Maglev Freight (roads ×1.3) | — | Self-Replicating Systems (×1.3) | Replicator Stacks ◉ (print ×0.5) | Deep Sounding (+15% reserve, T4) | Propellant Depot (the launcher water plants feed) |

- Every lever the player named has a rung in Eras 1–2, so the first choices come
  early: speed (Pit Mapping), haul (Grizzly Screens), dig (Hardfaced Teeth) and more
  units (Bay Extensions).
- **Multi-deposit routing** is Feed Planner's job (E5). **Ore sorting** is Optical
  Ore Sorting (E4). Neither needs a new card.
- **No renames.** Autonomous Haulage, Grizzly Screens and Guideway Rails already
  say what they do to a unit. Only their card lines change, from "Excavators …" to
  the units they now reach (the Ice Miner too, where it applies).

### 10.3 The seven new techs

Costs are the era's median (docs/12 §2.4) after `ERA_COST_SCALE`: E2 120 → 240≡,
E3 150 → 278≡, E4 240 → 456≡, E5 400 → 580≡. The exception is Pit Mapping (§10.1).
Every con is numeric and passes `auditTechs` (|m − 1| ≥ 0.05, or ≥ 1 kW).

| id · name | Era · lane | Cost | Requires | Effect (pro) | Con (numeric first) | `visual` and its part | Builder · destiny · hazards |
|---|---|---|---|---|---|---|---|
| `pitMapping` · **Pit Mapping** | E1 · ◆ | 48≡ | — | `{ kind: 'haul', offroadMult: 1.3 }`: units drive the off-road leg in a deposit at 0.65 of road speed (from 0.5) | +10% draw: Excavator, Ice Miner (`powerMult` 1.1) | "Excavators and Ice Miners mount a stereo camera boom over the cab." A 1.2 m boom with twin camera heads | shorter cycles, so the unit rule orders fewer units · neutral · none |
| `bayExtensions` · **Bay Extensions** | E2 · ◉ | 240≡ | — | `{ kind: 'hubLevel', level: 2 }`: **+ Bay** at any hub: Level II, 3 bays | −1 kW each: Smelter, Refinery, Water Plant (the bay's charge post; `powerDelta`) | "Hubs raise a bay canopy over a third charging post." A lattice canopy over the bays | the unit rule's holding line asks for a bay; only you or an order buy one · neutral · none |
| `hardfacedTeeth` · **Hardfaced Teeth** | E2 · ◆ | 240≡ | — | `{ kind: 'haul', digMult: 1.25 }`: a bucket fills in 48 s (from 60) | +25% upkeep: Excavator, Ice Miner (the teeth wear; `upkeepMult`) | "Bucket wheels and augers wear a band of hardfaced teeth." A toothed ring on the wheel and on the auger | faster cycles · neutral · faster dig also burns reserves faster: exhaustion comes sooner |
| `waterReclamation` · **Water Reclamation** | E3 · ⌂ (crew tech) | 278≡ | any of Cryo Ice Extraction, Solar-Wind Volatiles | `{ kind: 'reclaim', water: 0.6 }`: while any Water Plant runs, crew and farm water ×0.6 | −4 kW: Water Management Plant (`powerDelta`) | "Water Management Plants add a greywater still: a squat tank with a vent stack." | the water rule builds fewer plants · ⌂ settlers need less ice · Contamination: the still is a loop (docs/14 §3.4) |
| `waterElectrolysis` · **Water Electrolysis** | E4 · ⌂ | 456≡ + 10⚙ | any of Cryo Ice Extraction, Solar-Wind Volatiles | a per-plant **Electrolysis** toggle (`{ kind: 'action', id: 'electrolysis' }`): 40% of the plant's water is split, 0.89○ per ≈ · −40% inputs: Propellant Plant (`inputMult` 0.6: it runs the same stack design) | −10 kW: Water Management Plant, with the toggle on (`powerDelta`) · the H₂ is vented until a Propellant Plant stands | "Water Management Plants raise an electrolysis stack with heavy busbars and a flare mast." | the O₂ rule may choose a water plant as the O₂ maker at the pole · ⌂ air without a smelter · none |
| `deepCoring` · **Deep Coring** | E4 · ◎ | 456≡ + 10⚙ | Prospecting Rovers | `{ kind: 'reserve', mult: 0.25 }`: every deposit's reserve +25% of its original; exhausted ones reopen | +10% draw: Excavator, Ice Miner (deeper benches, longer ramps; `powerMult`) | "Construction rovers carry a core-drill mast, and surveyed deposits keep a core rack." | reopened deposits come back into reach · neutral · none |
| `depotHalls` · **Depot Halls** | E5 · ◉ | 580≡ + 20⚙ | Bay Extensions | `{ kind: 'hubLevel', level: 3 }` (4 bays) · `{ kind: 'hubPrint', timeMult: 0.75 }` | +15% upkeep: Smelter, Refinery, Water Plant (`upkeepMult`) | "Hubs roof their bays into a depot hall with a gantry." | the unit rule's per-hub cap grows · ◉ Fleet OS stacks one more bay · Rogue drones: a depot hall is a priority-2 target |

**New effect kinds and fields.**

| Kind | Mods | Pro line | Con line |
|---|---|---|---|
| `haul` gains `offroadMult`, `digMult` | `haulOffroadMult`, `haulDigMult` | `+30% off-road speed in deposits: Excavator, Ice Miner` · `+25% dig rate: …` | — |
| `{ kind: 'hubLevel', level }` | `hubLevel` (1) | `LEVEL II HUBS: + Bay at any hub (3 bays)` | `a bay costs 30◆ 10⚙ at the hub` (use) |
| `{ kind: 'hubBays', delta }` | `hubBays` (0) | `+1 bay: every hub` | — |
| `{ kind: 'hubPrint', timeMult?, costMult? }` | `hubPrintTime`, `hubPrintCost` (1) | `units print ×0.75 as fast` | — |
| `{ kind: 'reserve', mult }` | applied once in `onTechComplete` | `+25% reserve: every deposit (exhausted ones reopen)` | `faster digging uses it up the same` (flag) |
| `survey` gains `precision`, `depositTimeMult`, `mastSurvey` | `surveyPrecision` (0.3), `surveyTimeMult`, `mastSurveyKinds` | `deposit surveys ±15%` · `deposit surveys take 20 rover-s` · `Relay Masts survey ice and mature soil` | — |
| `{ kind: 'reclaim', water }` | `reclaimWater` (1) | `−40% water: crew and farms, while a Water Plant runs` | — |
| `action` gains `'electrolysis'` | `actions` | `ELECTROLYSIS: split water into O₂` | — |

`techRelevance`: `haul`, `hubLevel`, `hubBays`, `hubPrint`, `reserve` and `survey`
are always relevant. `reclaim` and the electrolysis action are relevant wherever a
Water Management Plant can stand (every site, through one of its two unlocks).

**Discovery `nextStep` lines** (`src/ui/discovery.ts`), one per new kind:

| Kind | Next |
|---|---|
| `unlock waterPlant` | `Pick the Water Management Plant: the ice lights up. Place it at the rim.` |
| `haul` (off-road, dig) | `Your units cross deposits faster: shorter trips.` · `Buckets fill faster, and deposits run out sooner.` |
| `hubLevel` | `Select a hub and press + Bay: a Level II hub holds 3 units.` |
| `hubBays` | `Every hub has one more bay: print a unit into it.` |
| `hubPrint` | `Hubs print their units faster.` |
| `reserve` | `Every deposit holds more, and exhausted ones reopen: see their cards [I].` |
| `survey` precision | `Surveyed deposits are re-read: their ranges are tighter now.` |
| `reclaim` | `Water Plants now recover the base's water: the crew and farms drink less ice.` |
| `action electrolysis` | `Select a Water Plant and switch Electrolysis on: O₂ without a smelter.` |

### 10.4 Changed techs: folds, renames and re-points

| Tech | Era · lane | Change |
|---|---|---|
| Grizzly Screens | E1 ◆ | Numbers unchanged (load ×1.1, draw ×1.15). It now reads as the first capacity rung. |
| Prospecting Rovers | E1 ◎ | + deposit surveys take 20 rover-s (from 40). |
| Sample-Return Caches | E1 ◎ | + deposit surveys ±15% (from ±30%). "Rovers bring cores home" was already this tech. |
| Cryo Ice Extraction | E1 ⌂ (pole) | Unlocks the **Water Management Plant** (ice recipe, Ice Miners) instead of the Ice Harvester. Visual: `Water Management Plants can rise: a melt hall and a tank farm, Ice Miners in its bays.` |
| Solar-Wind Volatiles | E1 ⌂ (mare, lava) | Unlocks the **Water Management Plant** (mature-soil recipe, excavators) instead of the excavator's retort recipe. Visual: `Water Management Plants can rise, baking mature soil in a volatiles retort.` Its −9 kW moves from each excavator to the plant. |
| Silicon Refining, Parts Fabrication, MRE, Heat-Recovery Jackets, Basalt Paving | E2–E3 | `requires` loses `regolithProcessing` (§10.1). |
| Ilmenite Beneficiation | E2 ◆ (doctrine) | Unchanged. It is the mare's strongest reason to put the smelter on the ore (§5.1). |
| Neutron Spectrometry | E2 ◎ | + Relay Masts survey ice and mature-soil deposits within their radius, free. |
| Sublimation Tents · Heated Augers | E2 · E4 (pole) | Re-pointed from `iceHarvester` to `iceMiner` (bucket ×1.15 each). |
| Dust Mitigation | E3 ◆ | Its excavator upkeep ×0.5 covers the Ice Miner too. |
| Automated Excavation | E3 ◉ | Its rule becomes "a hub prints a unit" (§11). The con moves from −1 kW per Robotics Bay to −1 kW per hub (a dispatch mast). Visual: `Every hub grows a dispatch mast with a beacon.` |
| Site Survey AI | E3 ▣ | + siting weighs haul time and reserve for hubs · + the Builder queues deposit surveys (§11). |
| Optical Ore Sorting | E4 ◆ | Unchanged numbers: the ore-sorting rung. |
| Orbital Prospector | E4 ◎ | + every mapped deposit's size class shows a grade band (`lean` < 0.8 · `rich` ≥ 0.9) before a survey. |
| Autonomous Haulage | E5 ◉ | Unchanged (speed ×1.3, bucket ×1.25). The E5 speed and capacity rung for every unit. |
| Feed Planner | E5 ▣ | Now **multi-deposit routing**: it re-aims each unit, across hubs and deposits, by delivered value (rate × feed factor × the hub's hunger), and hands a deposit's faces over before its lean tail. Its per-excavator opt-out becomes per unit. |
| Gravity Gradiometry | E5 ◎ | + deposit surveys ±5%. |
| Fleet OS (◉ pick) | E5 | + `{ kind: 'hubBays', delta: 1 }`: a bay on every hub. Its CONTROL PLANE exposure now also stops hub units (§12.5). |
| Rover Autonomy | E4 ◉ | Unchanged. It speeds construction rovers' welding, not units. |
| Guideway Rails | E6 ◆ | Unchanged: `haulMult` ×1.3 now speeds every hub unit on roads. |
| Condition Optimization · Self-Replicating Systems | E6 · E7 | `iceHarvester` → `iceMiner` and `waterPlant` in their lists. |
| Settler Charter · Lunar Commonwealth (⌂) | E6 · E8 | + `waterPlant` in their crewed-output lists. |
| Replicator Stacks (◉ pick) | E7 | + `{ kind: 'hubPrint', timeMult: 0.5 }`. Its RUNAWAY exposure now over-prints units (§12.5). |
| Deep Sounding | E7 ◎ | + `{ kind: 'reserve', mult: 0.15 }`. |
| Maglev Freight Lines | E7 ◉ | Unchanged: road ×1.3 moves units too. |
| Propellant Depot | E7 export | Unchanged. The card names water plants as the supply. |

### 10.5 Tree fit

- 129 techs → 135: one retired, seven added.
- Cards per page (robotic mare; docs/14 §1.8): E1 8 (unchanged) · E2 12 → 14 ·
  E3 13 → 14 · E4 15 → 17 · E5 14 → 15. The busiest rows are E2 ◉ and ◆ (4 each),
  E4 ⌂ at the pole (3), and E5 ◉ (4). No row passes 5, and every page keeps 7 lanes
  or fewer, so every page fits 1280×720 (`tests/techtree.spec.ts:142`).
- Every new tech sits at its era's median, so none is a charter shortcut
  (docs/13 §4).

## 11. The Builder

**The excavation family** (Automated Excavation, E3 ◉) keeps its name. Its two
rules, `excavator` and `iceHarvester` (`src/data/automation.ts:63-72`), merge into
one:

| Rule | Builds | Shown as | Trigger | Guards | Cap | Dwell · cooldown · settle |
|---|---|---|---|---|---|---|
| `hubUnit` | a unit at the hub that needs it | KEEP every hub fed → +1 unit | a hub's `starved` ≥ 25% (10–60%) over 120 s | every unit it has is working (none waiting at a full hopper, none without a deposit) · a **free face** in reach, or the scrape · that deposit has ≥ 1 lunar day left at +1 unit · a **free bay** · the budget's reserve | per hub: its bays · base-wide: 12 units (0–60) | 60 s · 120 s · 1 cycle + 60 s |

- **It prints; it never places.** A unit is a queue job at the hub, so the rule
  needs no pad, no road and no rover. The first-of-a-type rule is moot: every hub
  already has its first unit.
- **Holding lines** say why: `holding · Smelter #3 — no free face in reach (◆ #0
  2/2, ◆ #3 2/2)` · `holding · Refinery #9 — every bay full (2/2): + Bay` ·
  `holding · ◆ #0 has 0.6 lunar days left at +1 unit`.
- **Bays** are never bought by a rule. An order can (`Order + Bay`).
- **Re-routing from exhausted deposits** is base behaviour (§7.3), with or without
  the Builder.
- **Relocation.** Automated Smelting & Refining (E5) places **new hubs**, never moves
  old ones. Its smelter rule gains a trigger: a hub on the scrape (or on a deposit
  under 25%) while a surveyed wanted deposit with ≥ 2 lunar days lies more than 45 s
  away. It places a new hub at that deposit's rim. The panel says:
  `Smelter #3 — its deposits are dug out: scraping at feed plain · a Smelter by
  high-Ti basalt #3 would feed 88%`. Demolishing the old hub stays yours. Its units
  then drive to the nearest same-type hub with a free bay; the rest are scrapped for
  half.
- **Siting** (`src/core/siting.ts:176-187`). Hub anchors change:

| Hub | Base chooser (from landing) | Site Survey AI |
|---|---|---|
| Smelter, Refinery, Water Plant | the rim of the nearest mapped deposit of a wanted kind inside the network, by distance only; the Lander if none | of the wanted deposits in reach, the best by `life × grade − one-way seconds / 60`, surveyed first. The pad whose planned haul time to its gate is least, door toward the gate. Others' deposits still +25. |

  The old anchor, "the centroid of the excavators' dig sites", retires. So does the
  excavator's anchor.
- **Site Survey AI surveys.** Before a rule sends units or places a hub at an
  unsurveyed deposit, it queues that deposit's survey:
  `AUTO SURVEY — high-Ti basalt #3, for Smelter #3's next unit`.
- **Feed Planner** routes units as §10.4 says.
- **The flow book** keeps its regolith row as a sum. The regolith panel's demand line
  still reads `made 112▲/min · wanted 130▲/min`.
- **Old saves:** `excavator` and `iceHarvester` rule states merge into `hubUnit`. It
  is on if either was, and its cap is their sum (§15).

## 12. Interplay with the rest of the game

### 12.1 Roads and zones

- A hub is a dock: its spur, bays and bay apron, refused inside a zone (§3.1, §4.3).
- Placing a hub lays its haul road to the first deposit's gate (§5.3). Later ones
  are haul-road jobs.
- Units drive off-road only inside deposits, from the gate to their face (docs/15
  §5a). The scrape is no leg at all.
- Old saves keep every road. An old pad's spur stays as road (§15).

### 12.2 Traffic and transit

- Units are wide loads, as excavators are (docs/15 §6). Right of way stays: loaded
  unit > empty unit > rover, then the lower id.
- A deposit's gate is a junction for traffic. Units queue there. Several hubs'
  units may share a gate.
- Units travel on haul legs (`src/core/haul.ts`), not rover trips (`src/core/transit.ts`).
  The visuals follow the sim as diggers do today (`src/world/haulers.ts`). The 48
  drawn-digger limit (`MAX`) becomes 64, since docked units are drawn now too.
- Surveys are rover work: they use transit's trips.

### 12.3 Machine batteries (work/unitpower)

- Units are machines in unitpower's sense. `homeOf(unit)` is its hub and
  `chargeSpotOf(unit)` is its bay cell.
- They top up at the tipping stand on every load, and fully in the bay.
- A long brownout at the hub stalls its units in the bay, not in the field: they
  go home when the hub goes dark.
- **Reach** becomes the lesser of 90 s one way and what the pack covers for two
  cycles. So a far deposit can be out of a small pack's reach. Rover Power Packs
  (E2), Fuel-Cell Packs (E4) and Radioisotope Power Units (E5/E6) extend it.
- The charging load shows under the hub in the power panel.

### 12.4 Flares (work/flares, docs/16)

- A unit in the open or in a deposit when a flare turns active takes docs/16's
  glitch. A unit docked in a **shielded** hub's bay is sheltered. A hub is shielded
  once Regolith Shielding (E2) berms it, as docs/16 defines.
- **Recall.** On the telegraph (60 s), each hub recalls every unit whose trip home is
  shorter than the time left. The rest finish in the field. The telegraph line says
  so: `FLARE IN 1:00 — Smelter #3 recalls 1 of 2 excavators; E2 is 1:10 out`.
- So a far deposit is also a flare risk. That is another cost of a long haul.

### 12.5 Hazards (docs/14 §3)

| Hazard | With hub units |
|---|---|
| FIRMWARE | Units are fleet machines: the window's share includes them. A bricked unit drives home and waits in its bay. Its hub re-flashes 1 every 30 s (a Hive's rule does not apply). A unit still bricked at the deadline is **lost** (`LossRecord.what: 'unit'`) and its bay is empty. The hub reprints at the normal unit price. |
| CONTROL PLANE (Fleet OS) | Hub units stop where they are and wait until a Data Center has run 30 s. |
| MALWARE | Hubs are agent-run stations, so they are nodes as today. An infected hub's units work at ×0.5. |
| ROGUE DRONES | Hubs are priority 2, so a hub can be a strip target. Its units park while it is stripped. |
| RUNAWAY RULE | The hijacked rule is the one that has built most, often `hubUnit`. It **over-prints units** at its hubs every 20 s, ignoring bays and caps, never the weld debt or life-support stock. Junk units never commission (wrong firmware). They stand on the bay apron and cost upkeep until scrapped for half. Counters are unchanged: Freeze rules, cancel a junk job in its first 20 s (full refund), Budget Governor, Rule attestation. Printing uses no rover, so no `CONSTRUCTION STALLED` can come from it. |
| DUST (⌂) | Airlock dust sources (`src/core/hazards.ts:843`) are units' faces and hubs, instead of excavator pads. |
| Wear, Maintenance Automation | Units wear like buildings. Maintenance Automation's replacement reprints a unit worn past its threshold, at the hub, for its price less half. |

### 12.6 Destiny (docs/14)

- **◉ Automation** gets the fleet: Fleet OS (+1 bay on every hub, and the control
  plane risk), Replicator Stacks (print ×0.5, and the runaway risk).
- **Drone Hive drones do not dig.** Hub units are ground machines. Drones build,
  sinter and survey. A drone survey flies straight and needs no road (§9.2).
- **⌂ Colony** gets the water: Water Reclamation and Water Electrolysis are ⌂-lane
  techs (not picks) aimed at settlers. The crewed-output picks (Settler Charter,
  Commonwealth) now include the water plant.
- Both destinies keep every extraction tech. The ladder is lane research, not a pick.

### 12.7 Work animations (`src/world/workAnim.ts`, `src/buildings/rigs.ts`)

| Unit | Digging | Tipping | Driving | Parked |
|---|---|---|---|---|
| Regolith Excavator | at its **face**, in the deposit: the wheel turns, the boom dips, spoil flies (today's rig, `DIGGER_RIG`) | at the **hub's tipping stand**: boom up, wheel back, a spill into the hopper chute (today's dump, `DUMP_S`) | boom carried high | boom stowed, the charge lamp lit |
| Ice Miner (new rig) | the auger drum turns and dips; frost puffs | the bin tips into the melt-hall chute | auger stowed | charge lamp lit |

- The scrape shows as a short dig at the hub's side: the same dig state, beside the
  hub.
- The hub shows its hopper: a gauge lamp at the chute, lit in steps of a quarter.
- `Rover.mode`-style words: `Hauler.mode: 'dig' | 'tip' | null`, which the sim sets
  and the animation reads (as since `5b797b6`).

## 13. The first 30 minutes

Game-minutes after landing. The first dusk comes at 6.5, and dawn at 10.5. These
are **design targets**: Phase 6's probe checks them. Mare prices are ×0.8, pole
×1.25, lava tube ×1.1.

### 13.1 Mare, robotic (112◆ 112⚙ · 2 rovers · the Lander 6 kW, 800 stored)

| Min | What happens | Stock after |
|---|---|---|
| 0:00 | Land. The overlay shows ◆ high-Ti basalt #0 at 30–50 m, "a bed · unsurveyed", and one or two more ◆ within 120 m. | 112◆ |
| 0:05 | **The first survey:** Survey ◆ #0 (30 stored energy, 2⚙). One rover drives out (the gate road is 3–6 cells), cores for 40 s, and is back by about 1:30. `SURVEYED — 5.5k–10.1k▲ (±30%), grade 88%, 2 faces`. The other rover welds the first Solar Array. | 110⚙ |
| 0:30–1:30 | Two Solar Arrays (12◆ each). | 88◆ |
| 1:40 | **The smelter:** pick it and ◆ #0 lights. Place it at the rim, door to the gate. The ghost: `◆ #0 · 0:08 · faces 2/2 · 1.6▲/s ≈ 39◆/min per excavator · ~5 lunar days at this smelter's 2▲/s`. 48◆ 12⚙. | 40◆ 98⚙ |
| ~4:30 | The smelter stands. Its excavator rolls out of the bay. | |
| 4:40 | Research Lab (24◆ 8⚙). | 16◆ 90⚙ |
| ~5:45 | The first bucket tips. Metals begin: about 0.65◆/s with one unit (an 82% fed smelter). **Dig In** completes. | |
| ~6:30 | The lab stands. First research: **Pit Mapping** (48≡, about 1:05 at 0.75≡/s). About 30◆ smelted before dusk. | ~45◆ |
| 6:30–10:30 | Night. The bank carries the loads for under a minute. Then the smelter and its excavator stand by until dawn (priority 2), as the smelter does today. | |
| ~11:00 | Dawn. A 3rd array (12◆), then **the 2nd excavator** (16◆ 4⚙, 0:48). The hub read `STARVED 18% · a 2nd excavator +0.36▲/s → +8◆/min · pays back in 1:55`. | |
| ~12:30 | **First Metal** (100◆, a smelter, a lab). | |
| 12–30 | More arrays, a yard, a 2nd and 3rd lab. Prospecting Rovers maps to 320 m. Survey ◆ #1 or #3 (the next bed). Era 2 opens by the 450◆ deed around 20–23 min (§14.2). | |

- Metals start about 3 min earlier than today (5:45 against 8.8–10.1 on the mare).
- **No new trap.** The 2nd unit costs 16◆, and the smelter makes that in under
  30 s of daylight. The METALS LOW warning still fires if the lab goes before the
  smelter.

### 13.2 Mare, crewed (7 crew · 120○ lasts 14 min at 0.14○/s)

The same opening, with a Hydroponics Farm by 7 min (the probe builds one after 400 s).

- The smelter's O₂ (0.31○/s at full feed) starts at ~5:45 instead of ~9–12. The
  O₂ margin grows by about 4 min.
- Crew seats: smelter 2, lab 2, farm 1, of 7. Units need none.
- The first survey is the same. Crewed labs are slower (0.3≡/s × morale), so Pit
  Mapping lands around 9 min.

### 13.3 South pole, crewed (175◆ 175⚙ · 50≈ lasts 24 min for 7 crew)

| Min | What happens |
|---|---|
| 0:00 | The overlay: ❄ cold-trap ice #0 at a 30–40 m rim, "a small patch", 1 face. ◇ anorthosite #0 at a 12–28 m rim. No ilmenite anywhere. |
| 0:05 | **The first survey: ❄ #0** (the water plant's future). For example `1.0k–1.9k≈ (±30%), grade 81%, 1 face`. |
| 0:30–2:00 | Two arrays (19◆ each). |
| 2:10 | **The smelter** by the Lander. Nothing lights: H₂ on anorthosite is −30%. The ghost: `no high-Ti basalt at this site: its excavator scrapes plain ground (1.5▲/s)`. 75◆ 19⚙. |
| 5:00 | Lab (38◆ 13⚙). Stock about 24◆. |
| ~6:30 | Metals begin. The smelter's water trickle (0.05≈/s) covers the crew's 0.035. |
| ~8:00 | Research **Cryo Ice Extraction** (208≡, about 12 min at a crewed lab). |
| ~20:00 | **The Water Management Plant** at ❄ #0's rim (75◆ 19⚙). One Ice Miner: 0.35–0.45≈/s, about today's harvester (0.4). ❄ #0 has one face, so **a 2nd miner has nowhere to dig here**: the pole's first placement puzzle. |
| 20–30 | Prospecting Rovers (about 9 more minutes of research) maps most of ice #1–#6 (120–340 m out). The next water plant goes by the best of them in Era 2 or 3. MRE (E2) will end the smelter's water trickle, and the plan must be in place by then. |

- The water plant arrives at about the time the first harvester does today (the
  probe: 1 harvester at the E2 opening, 25–28 min).
- **No new trap.** Water stays safe until MRE, and MRE is an Era 2 choice the
  player makes with the plant already built.

### 13.4 South pole, robotic

The pole's opening without the crew. There is no water rush: the first water plant
waits for the Propellant Plant's water or for outposts' hopper fuel. The ◇
anorthosite #0 at a 12–28 m rim is **where the pole's refinery belongs** in Era 2. It is the
nearest wanted deposit on the map.

### 13.5 Lava tube, robotic (154◆ 154⚙ · build radius 220 m)

- ◆ #0 lies 30–50 m out and ○ glass #0 30–56 m out, both guaranteed. The smelter
  lights both: ◆ bright, ○ dimmer (`O₂ +60%`).
- Place the smelter between them if they are close (66◆ 17⚙). Its units take ◆ by
  default, and the O₂ rule or Feed Planner can send one to ○.
- Only two ilmenite beds exist, 17k▲ together. **Survey both before Era 3:** the
  second is the tube's last ilmenite (§14.3).

## 14. Pacing

### 14.1 Baselines and targets

The baselines are docs/14 §6's shipped numbers (reasonable, `--auto=on`, seeds 42,
7, 1234). This branch's own run (§2, `--auto=off`, natural destiny) is within 7 min
of them.

| Run | Baseline FIRST LIGHT | Target after hubs |
|---|---|---|
| mare robotic · ⌂ Colony | 213.3 | 203–230 |
| mare robotic · ◉ Automation | 200.3 | 190–216 |
| mare robotic · Concord | 217.6 | 207–235 |
| pole crewed · ⌂ Colony | 162.9 | 155–176 |
| pole crewed · ◉ Automation | 172.9 | 164–187 |
| pole crewed · Concord | 177.9 | 169–192 |

That is −5% to +8% of each baseline. The player values realism and strategy over
speed, so a little slower is acceptable, but no slower than that. docs/14's rules
stay: robotic mare 210 ± 25 with max/min ≤ 1.08 across destinies, every era 22–32
min, and the longest idle ≤ 5 min.

**Extraction acceptance:**

| Measure | Target |
|---|---|
| Exhaustion events per run | mare 1–3 · lava tube 1–3 · pole crewed ≥ 1 (❄ #0) · pole robotic 0–1 |
| Hubs placed at a second deposit because the first ran out | ≥ 1 on every mare run |
| A hub idle for "no deposit in reach" | ≤ 5% of its run time |
| A hub's starved share (median over the run) | ≤ 25% |
| Metals begin (mare) | by 6 min |
| The 2nd unit | by 15 min |
| Deaths from water or O₂ | none, under reasonable and attentive |
| Surveys per run | ≥ 3 |

### 14.2 Expected direction

- **Earlier (Era 1 −3 to −5 min).** The smelter runs about 3 min sooner, and Era 2
  opens by the 450◆ deed in 14 of 15 runs. That could push Era 1 below 22 min.
  **Lever:** the E2 deed 450 → 550◆ (docs/12 §2.1's dial).
- **Later (Eras 4–6, 0 to +8 min).** Units now drive to a face and back to the hub,
  instead of digging a pad next to the smelter. The first exhaustion lands in
  Eras 4–5. On the lava tube both ilmenite beds are gone by about 140 min.
- **The pole** moves least: its smelters scrape anyway, and ice was a harvester
  either way.

### 14.3 Exhaustion on the baseline's dig curves

These use the reserves of §7.1 against each baseline run's regolith and water, with
the nearest wanted deposit dug first. Two thirds of mare and lava tube regolith goes
to smelters, and 80% of pole water comes from ice.

| Run | Exhaustions | When (game-min) |
|---|---|---|
| mare robotic | 3 · 3 · 2 | ◆ #0 at 87, 83, 120 · the next at 109–192 |
| mare crewed | 3 · 2 · 1 | ◆ #0 at 111, 100, 122 |
| lava tube robotic | 2 · 2 · 2 | ◆ #0 at 86–114 · ◆ #1 at 135–140 (no ilmenite left) |
| pole crewed | 1 · 1 · 1 | ❄ #0 at 86–108 |
| pole robotic | 0 · 0 · 0 | ❄ #0 lasts the run |

That is inside the targets, before the new game changes the curves. The probe must
measure the real counts (§14.5).

### 14.4 Levers, in this order

1. **Reserve depth ranges**, in ±25% steps (§7.1). This decides when exhaustion
   comes.
2. **Faces per area** (500 m²). This decides how many units a deposit holds.
3. **The scrape's dig rate** (×1.0). If players ignore deposits, try 0.85 ("thin,
   blocky regolith").
4. **Unit cost and print time.**
5. **Bay levels' eras** (Level II at E2, Level III at E5).
6. **Off-road speed for units** (0.5 of road).
7. **The lava tube's ilmenite count** (2 → 3). This moves the tube's other deposits,
   because the generator places ilmenite first, so it comes last.
8. **The E2 deed** (450 → 550◆), for Era 1 only.

Never `ERA_COST_SCALE`: the tree's calibration belongs to the tree (docs/14 §6).

### 14.5 The probe (`scripts/probe-pacing.mjs`)

The bot must play hubs as a thinking player would, reading only what the HUD shows.

| Step | What the bot does |
|---|---|
| Survey | At landing, it surveys the nearest wanted deposit for its first hub. Later, it surveys a wanted deposit before placing a hub there, and whenever a hub's deposits drop under 1 lunar day. |
| Place a hub | At the rim of the wanted deposit with the best `life × grade − one-way seconds / 60` in reach of the network, door toward the gate (the ghost's HUB line). With nothing wanted: near the Lander. |
| Print units | When the hub's hint line offers one (starved ≥ 20%, a face free, a bay free), within its budget rules. |
| Levels | + Bay when a hub is full, starved and a face is free. |
| Relocate | A new hub at the next wanted deposit when a hub's feed falls under 75% of its best, or it has been on the scrape for 5 min with a surveyed wanted deposit ≥ 2 lunar days in reach of the network. It demolishes the old hub only if it idles. |
| With `--auto=on` | It hands units to the `hubUnit` rule and relocation to the Smelting rule, as it hands the rest today. |

**New report fields:** exhaustion events (and their times), relocations, surveys,
units per hub over time, each hub's starved share, the median trip time, minutes a
hub had no deposit in reach, and ▲ dug by deposit.

## 15. Save migration

`hubSchema: 1` and `techSchema: 5`, run in `Game.load` after `migrateTechSchema` and
before `migrateRoads`.

| Step | Old save | After |
|---|---|---|
| 1 · tech | `regolithProcessing` done, queued, spent or with an insight | the same on `pitMapping` (techSchema 5) |
| 2 · reserves | none | `s.reserves` for every deposit, **full**, from the seed |
| 3 · hubs | smelters and refineries | `hub` state: Level I, an empty hopper, `feed` copied from `s.feed` |
| 4 · excavators | placed buildings with a pad | each becomes a unit of the **nearest complete Smelter or Refinery by road** (by straight line with no road). Its deposit is the one under its dig point, else the scrape. It keeps its wear; its overclock is dropped. Over the bay cap it is kept (`3/2 · 1 over cap`), and the hub prints no more until it is under. The pad building goes; its flattened ground and spur stay. |
| 4b · no hub yet | excavators with nothing to join | each stays a **legacy pad** (`legacy: true`, not buildable) and hauls to the Lander as today. When the first Smelter or Refinery completes, each joins it as a free unit and its pad goes. |
| 5 · ice harvesters | placed harvesters | **legacy harvesters** keep working as today, drawing their deposit's reserve. When the first Water Plant completes, each within reach joins it as a free Ice Miner and its building goes. Its crew seat moves to the plant. |
| 6 · regolith | one stock, capped by the Lander and yards | fills hoppers in hub order. The rest becomes `s.pile`, which any smelter or refinery draws first until it is empty. |
| 7 · surveys | none | every deposit being dug on load counts as surveyed, at the save's precision. The rest are mapped, not surveyed. |
| 8 · the Builder | `excavator` and `iceHarvester` rules | one `hubUnit` rule: on if either was, the caps summed, the dwell and log kept |
| 9 · stats | `haulMaxM` | kept |
| 10 · the alert | — | `EXTRACTION HUBS — your 3 excavators now belong to Smelter #4 and Refinery #9 · deposits hold finite reserves: survey them [I]` |

**Why a legacy pad, not a free hub.** A free smelter would need a 3×2 pad, a spur
and a door where the old 2×2 pad stood. It could fail to fit, and it would hand out
40◆ of building. A legacy pad keeps exactly what the player had and converts
itself the moment a hub stands. Smelters are unlocked from landing now, so that
moment is always within reach.

**Why reserves start full.** A save never recorded how much came from which
deposit. A guess from `stats.produced.regolith` × pad shares could exhaust a deposit
on load, and a base that worked yesterday would stall today. Starting full only
makes old saves generous for one or two eras. By the late game every base has more
beds than it digs.

## 16. Look

All parts use `meshKit` primitives, stay monochrome, and state is carried by lamps
(docs/06). Triangle budgets follow docs/04's table.

| Thing | What you see | Budget |
|---|---|---|
| **Hub bays** | Each bay cell has a charge post (a 1.2 m bollard with a lamp) against the hub's front wall, and painted stall lines. A parked unit stands nose-in, charge lamp lit. Level II adds a lattice canopy over the posts (Bay Extensions), and Level III roofs them into a depot hall with a gantry (Depot Halls). | +120 △ a bay; +300 canopy; +500 hall |
| **Hopper chute** | A sloped chute at the door with a four-step gauge lamp. | +80 △ |
| **Water Management Plant** | A melt hall (7 × 4 × 5.4 m box, a radiator pair), three vertical water tanks with bands, and a sublimation chimney. Its upgrades: a greywater still (Water Reclamation), an electrolysis stack with busbars and a flare mast (Water Electrolysis), and a spherical propellant dewar on legs (Propellant Depot). | ~1,500 △ stock · ~2,600 upgraded |
| **Ice Miner** | A tracked crawler (the excavator's hull and track pods), an insulated ore bin in FOIL finish, a heated auger drum on a short boom (its rig), a frost vent and two lamps. | ~1,000 △ (the excavator is 1,060) |
| **The highlight** | §6.1: double-weight rings of the kind's own pattern, a faint fill, and label chips. | no new geometry |
| **Working faces** | Each face in use gets a pit decal (`contactDecals`) that darkens with the dug share, and a spoil cone beside it (instanced) that grows from 1 m to 4 m. | 1 instanced cone mesh for the whole map |
| **Exhausted** | The zone's ring cross-hatched, every face a dark pit with a full spoil cone, and a low berm ring on the rim. | reuses the above |
| **Survey markers** | An unsurveyed deposit shows its `?` chip. A surveyed one gets four stake flags on the rim (1.5 m poles with a pennant) and a cluster of core-hole dots at the centre, and its label shows the reserve bar. | 1 instanced stake mesh |

- **The heightfield is never cut.** Pits are decals and cones, so digging costs no
  chunk rebuilds and stays deterministic.
- Classic palette keys: `depositLit`, `depositFull`, `depositSpent`, `pit`, `spoil`,
  `stake`. High detail: an emissive rim line on lit rings; the charge lamps and
  gauge lamps use the existing `LAMP` finish.
- Retired from the palette: the Excavator pad (its recipe becomes the unit's body)
  and the Ice Harvester (kept only for legacy pads).
- The excavator's research parts (`src/buildings/upgrades.ts:308`) stay on the unit:
  the grizzly screen, the separator drum, the ore-sorting hood, dust skirts, the
  assay drill. One moves: the Solar-Wind Volatiles retort goes to the water plant,
  where the baking now happens.

## 17. Tests

**New: `tests/hubs.spec.ts`.**

| Area | Checks |
|---|---|
| Hubs | The smelter is placeable at landing. A hub commissions with one unit in a bay. + Excavator queues, pays at the head, prints in 60 s × bcm at 4 kW, pauses in a brownout, and cancels for a full refund. The cap follows bays. + Bay needs its level's tech and a free cell. |
| Units | A unit docks, leaves by the door, drives road then off-road to a face, digs, returns and tips into its own hub's hopper. `s.resources.regolith` equals the sum of hoppers. Per-hub feed: a smelter on ilmenite and a refinery on the scrape read different feeds. |
| Choice | The auto choice follows the best hub intake. The scrape guard keeps a mare refinery home, and two units take a smelter to ilmenite 100 m out. Assign, Send…, Recall and Auto work. A unit sent to a full deposit waits at the gate. Reach is 90 s. |
| Reserves | The same seed gives the same reserves, grades, faces and face points, across a save and load. Digging lowers `left` by what was tipped. The lean tail lowers grade. At zero, faces close, units re-route, and the alert names where they went. Deep Coring reopens an exhausted deposit. |
| Faces | No deposit ever has more units than faces. Faces free up when a unit leaves. |
| Surveys | The job waits for a free rover, drives, cores for 40 s, pays 30 energy and 2⚙, and reveals the range, grade and faces. Precision ±30/15/5%. The truth is always inside the range. A mast with Neutron Spectrometry surveys ice. A drone survey needs no road. |
| The ghost | The HUB line: trip, faces, rate, reserve and life for the nearest wanted deposit. The water plant's NO ICE IN REACH warning asks once. Bay cells are dotted. |
| Highlight | Picking a smelter lights ◆ only. Full and exhausted deposits have their own labels. It works in Classic and in High detail. In touch mode, a tap on the card or the hub lights it, with no hover. The Lunar Map's SITE view shows the same states. |
| Migration | An old save's excavators become units of the nearest hub. With no hub they stay legacy pads and convert when one stands. Harvesters convert when a water plant stands. Old ▲ fills hoppers and then the pile. Reserves start full. The old rules merge into `hubUnit`. |
| Determinism | Two runs of the same seed and inputs give the same state hash after 30 min. |

**Updated specs:**

- The 71 `regolithProcessing` references (§10.1): `smoke`, `techtree`, `research`,
  `playability`, `destiny`, `avoidance`, `automation`, `ui`, `map`, `look`,
  `guidance`, `hazards`, `fleet`, `crew`.
- `automation.spec`: the `hubUnit` rule (trigger, guards, holding lines, caps) and
  relocation.
- `avoidance.spec`: its two excavators become two hub units.
- `zones.spec`: a hub's haul road stops at the gate; units go off-road inside.
- `fleet.spec`: `getFleet().hauls` reads units.
- `look.spec` and `upgrades.spec`: the water plant and ice miner recipes, bays, and
  each new tech's part (`recipeTriangles` differs).
- `anim.spec`: dig at the face, tip at the hub.
- `guidance.spec`: Dig In and First Metal.
- `destiny.spec` and `hazards.spec`: units bricked and lost, runaway junk units, the
  control plane stopping units.
- `touch.spec` (after work/touch): the tap highlight.
- `auditTechs`: the seven new techs each pass (a pro, a numeric con).

## 18. Phases

Each phase merges on its own and leaves the game playable.

| # | Phase | Contents | Leaves the game |
|---|---|---|---|
| 1 | **Data and hub units** | `src/data/hubs.ts`; `waterPlant`; `excavator` and `iceMiner` as unit defs; the smelter unlocked from landing; `s.haulers`; the hub queue, printing, bays and Level I; the hub inspector's UNITS and ROBOTS; the palette drops the Excavator and Ice Harvester; the minimal migration (excavators to units, harvesters to legacy) | Units printed by hubs, hauling by today's rules to the nearest consumer, into the old pool |
| 2 | **Haul to hub** | hoppers; ▲ as their sum; the pile; per-hub feed; trips hub → gate → face → hub; the scrape; reach; the auto choice with the scrape guard; Assign, Send…, Recall; the haul road with the spur; the flow book; power and priority per unit | Hubs live on their own hauls |
| 3 | **Reserves, faces and surveys** | `src/core/reserves.ts`; the generator; depletion and the lean tail; exhaustion and re-routing; faces; the survey job, precision and the deposit card | Deposits run out, and surveys tell you when |
| 4 | **The preview and the highlight** | the ghost's HUB block and warnings; lit rings and labels; the Lunar Map's SITE view; touch | Placement shows its strategy |
| 5 | **The research reshuffle** | Pit Mapping and the other six new techs; the folds of §10.4; techSchema 5; milestones; discovery; the 71 test references | The ladder is in |
| 6 | **The Builder and the probe** | `hubUnit`; siting's hub anchors; relocation; Site Survey AI surveys; Feed Planner routing; the probe bot and its metrics; the pacing pass against §14 | Automation and pacing are tuned |
| 7 | **The look and the migration** | recipes (the water plant, the ice miner, bays, chutes, pits, spoil, stakes); the ice miner rig and work animations; the full migration (legacy pads converting, the pile, the merged rules, the alert) | Finished |

Phases 1–2 touch `src/core/haul.ts`, `src/core/economy.ts` and
`src/core/fleet.ts`, which work/unitpower also changes. That is why Phase B waits for
it. Design the units against unitpower's `homeOf` and `chargeSpotOf` from Phase 1.

## 19. Questions for the player

Only the ones that are yours. Each has the default this doc assumes.

1. **Should smelters and refineries always be able to scrape plain ground?**
   Default: **yes**, unlimited, at plain grade. Deposits are then a +30–60% bonus
   that runs out, and no run can starve. The alternative makes every hub need a
   deposit, as the water plant already does. That is harsher and more realistic, but
   it risks dead ends on the lava tube.
2. **How often should deposits run out?** Default: **1–3 times a run on the mare**,
   with the first in Era 4 or 5. Rarer (once, late) is gentler. Harsher (3–5, the
   first in Era 3) means more moving and more micromanagement.
3. **Hub levels: bought per hub, or granted by research?** Default: **bought per
   hub** (+ Bay, 30◆ 10⚙) once research allows the level, so you grow the hub at the
   good ground. The alternative raises every hub's bays the moment the tech lands.
4. **Should research add working faces?** Default: **no**: a face is ground, and the
   levers are speed, bucket, dig rate and bays. If you want it, a "Bench Mining" tech
   (E4, +1 face on deposits of 1,500 m² or more) would fit.
5. **Old saves: start deposits full, or part-dug?** Default: **full**, so no base
   breaks on load (§15).
