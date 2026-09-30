# 15 · Roads: the network the robots drive

**Status:** shipped on `work/avoid`; rovers in transit, traffic yielding and
extraction zones on `work/transit` (§5a, §6, §6a); Relay Masts off-road and
the fleet on packs on `work/unitpower` (§5b, §6a).
**Code:** `src/core/roads.ts` (the network, spurs, routes, gates, ground
ways), `src/data/roads.ts` (tuning, the apron, field and dock types, the
rover's speed), `src/core/spots.ts` (where rovers stand), `src/core/transit.ts`
(rovers in the sim), `src/core/zones.ts` (extraction zones),
`src/world/roads.ts` (the mesh), `src/world/traffic.ts` (units on the lanes),
`src/world/rovers.ts` and `src/world/haulers.ts` (the drivers),
`src/player/roadTool.ts` (the tool). Tests: `tests/avoidance.spec.ts`,
`tests/transit.spec.ts`, `tests/zones.spec.ts`.
If a number here disagrees with the code, the code wins.

## 1. What the player asked for

> The excavators just kind of move around all over the place without regard
> for the physical space of other objects. There should be a system of roads
> or paths that the rovers build that determine where the rovers/extractors
> can go. The solar panels won't need a lot of space or any roads between
> them, but there should be a dedicated pathway system. Improvements in the
> roadways, in terms of speed, could be another thing to add to the research
> tree.

Chosen answers:

| Question | Answer |
|---|---|
| Who lays roads? | **Auto spurs + a road tool.** Placing a building plans a road from the network to its door; rovers build it first. The tool draws extra links. |
| Off-road driving? | **None.** Rovers and excavators move only on road cells (and an excavator on its own pad). |
| Fields? | Solar arrays and battery banks need **no** roads between them. |
| Relay masts? | **No road at all** (the player, later: "relay masts shouldn't need a road"). A rover drives out to one off-road (§5b). |
| Speed? | A ladder of four road techs, each a speed multiplier with a side effect. |

## 2. The network

Roads live on the build grid: one road cell is one 4 m grid cell.

- **State.** `s.roads` is a list of cells `{ gx, gz, left, bay?, closed? }`
  in the order they were laid. `left` is the sintering left (rover-seconds;
  0 = open). `bay` marks a parking cell; `closed` a cell no new road joins
  (the apron short of its stub's end). A structure's spur is `b.spur`, its
  cells in order from the network; drawn roads and haul roads are jobs in
  `s.roadJobs` (`{ id, kind: 'draw' | 'haul', cells, by? }`). `s.roadRev`
  counts changes: routes and meshes cache on it.
- **Graph.** Open cells that share an edge are joined. No diagonals.
- **Landing.** Every base lands with an apron at the Lander's door: a run of
  three cells straight out from the door, a parking bay either side of the
  first, then the stub's end. All open. New roads join only at the stub's
  end, so nothing drives through the apron, and an excavator unloading at the
  door (nose to the wall, 6 m long) passes the bays by.
- **Footprints.** Nothing is built on a road cell. A road never crosses a footprint.

### Doors

Every structure except the field types has a **door cell**: the cell in the
middle of its front side (local +z), rotated with it. Its spur ends there.
A door inside another footprint, off the map or too steep refuses the spot.

| Type | Door | Served by |
|---|---|---|
| Most structures | front middle | a spur to the door |
| Lander | front middle | the apron |
| Robotics Bay, Drone Hive (docs/14) | front middle | a spur, plus parking bays beside the door |
| **Field:** Solar Array, Battery Bank | none | a road cell within 1 cell of the footprint, **or** an edge shared with a served field structure of the same type |
| **Off-road:** Relay Mast (`OFFROAD_TYPES`) | none | no road: a rover drives out from the nearest road cell across open ground (§5b) |

A field of arrays is served from its edge. Rovers build and service it from
the nearest road cell; they never drive onto the field.

## 3. Spurs

On placement, **A\*** runs from every road cell (built or planned) to the
door (for a field type: to any cell within reach).

| Cost term | Value |
|---|---|
| A new cell | 1 |
| An open road cell | 0.05 (reusing road is nearly free) |
| A road cell still being sintered | 0.5 |
| Height step between cell centres | +0.6 per metre |
| Step steeper than `ROAD.maxStep` (1.6 m per cell) | forbidden |
| Footprints, the new building included | forbidden |
| Doors, bays and closed apron cells | forbidden (only a door's own spur ends there) |

- Every open road cell is a start.
- The ghost previews the spur and its cost: `ROAD 4 cells · 8 rover-s to
  sinter, before it rises`, its cells drawn on the ground.
- No route: the spot is refused with the reason, e.g. `NO ROAD ROUTE — its
  door (the front) is against a structure; R rotates`. A spot on a road is
  refused too (`On a road — pick open ground beside it`).
- The same rule runs for every caller of placement (the palette, the debug
  API, the Builder). The Builder's site chooser also weighs the road: of its
  first six valid pads it takes the one whose score plus 1.5 m a new road
  cell is least, so its bases do not sprawl roads. Its `why` names a road it
  lays: `nearest free pad to the base centre · 23 m · a 9-cell road to it`.

### Refusals: the reason and the way out

| Spot | Refusal |
|---|---|
| on a road cell | `On a road — pick open ground beside it` |
| too rough | `Terrain too rough (3.1 m relief > 2.5 m) — find flatter ground, or grade it (Grade Site)` (the Grade Site tool is on every site from landing, docs/19 S5) |
| a door against a structure, off the map, on the apron, on a door | `NO ROAD ROUTE — its door (the front) is against a structure; R rotates`, and so on |
| a structure no road reaches | `NO ROAD ROUTE — the rovers cannot reach it by road (walled in, or too steep)` |
| a field type, every cell round it taken | `NO ROAD ROUTE — boxed in: no ground beside it for a road; set it edge to edge with a served Solar Array (no road needed)` |
| a field type no road reaches | `NO ROAD ROUTE — no road can reach its edge (walled in, or steps over 1.6 m); set it edge to edge with a served Solar Array (no road needed)` |

A field type's way out names its own field when one is served, else `set it
within a cell of a road`. A Relay Mast is never refused for its road: it
has none (its other rules — the network, slope, footprint — stand).

### Where a road can go (the Builder's reach)

`roadReach` floods every cell a new road could reach from the open network,
walked as the A\* walks: footprints, doors, bays and the closed apron are
walls, and so is a step over 1.6 m. The Builder's chooser strikes a pad whose
road would end outside it before it runs the A\* (docs/13 §2.3). The flood
ignores the new structure's own footprint, so it can only be too generous;
the A\* has the last word.

What the flood shows at the pole (crewed landing, seeds 42, 7, 1234):

| Measure | Value |
|---|---|
| Cells a road can reach | 64 439–64 501 of 65 536 (the rest is the map's border ring) |
| Flat pads (relief ≤ 2.5 m) no road can reach | 0 |
| Peak-of-light pads no road can reach | 0 of 99–111 |
| Solar pads in the Lander's 60 m refused as too rough | 110–409 of 716 |

So the 1.6 m step never walls off good ground there. Rough pads, and the
roads a base lays, are what the pole takes away.

### Building it

- A site's own rovers sinter its spur first, cell by cell from the network
  outward, then weld the building. Sintering draws the crew's construction
  power but no weld parts.
- **At the frontier.** A cell is sintered only by a rover standing on the
  cell behind it: the last finished cell of its road, or the network for the
  first. It drives out on the cells it opens, one step each (a 4 m step:
  2.3 s at the base cruise), sinters the next, and so on; then it steps up
  to the door and welds. The frontier cell is its own road's crew's before
  any other stand.
- **Two rovers on one road work side by side at the one frontier**, in the
  two halves of the cell behind it (n^0.85, as on a site). Only the network
  end can be reached: the far end is the door, with no road to it yet. A
  third and fourth wait behind them (they weld once the road is done).
- A drone sinters from the air, over the frontier cell itself.
- `ROAD.cellS` (2) rover-seconds a cell, × each roadway tier's sintering con.
- Roads cost no metals: the early smelter trap is unchanged.
- Free rovers (no site to go to) sinter the other jobs: drawn roads and haul
  roads, oldest first, one rover a job, from its frontier the same way.

## 4. The road tool

| Input | Does |
|---|---|
| **N** or the palette's ROAD button | start the tool |
| drag from a road cell | preview a road (the same A\*) and its cost |
| release | lay it (a job for free rovers) |
| Alt-drag | mark road cells to remove; release removes them |
| right-click · Esc | stop |

While you drag a removal, the hint warns when the box holds a structure's
door (`strands Research Lab #9: no road to its door`), and the alert says so
after (`ROAD REMOVED — 1 cell · Research Lab #9 no longer has a road to its
door`). A structure without a road keeps working; its rovers and excavators
cannot reach it until a road returns. The Lander's door cell stays.

## 5. Excavators on roads

**Hub units** (docs/17 Phases 1–2, `core/hubs.ts`) replace the placed
excavator. Hubs (the Regolith Smelter, the Silicon Refinery and the Water
Management Plant) are **docks**:

| Rule | How |
|---|---|
| Bays | a hub's units park in the spur's bay cells beside its door (Level I: 2) |
| Tipping | a unit tips at the hub's door cell, nose a pace short of the wall |
| Haul road | placing a hub plans a haul road to the zone of the deposit it will dig, laid with its spur; a plain pit's (below) too |
| The way in | road → the zone's gate (its pit's zone's gates count too) → off-road → once its pit is cut, down the ramp to a face on the floor |
| Plain pits | a hub with no wanted deposit in reach stakes a **plain pit**: a zone of kind `plain` (r 12 m), 20–60 m from its door. Its zone keeps 12 m from structures' walls and 8 m from roads (the pits' setbacks) |
| Zone order | deposits, then plain pits, then carved pits: a cell in two stays the first's |

The rest of this section describes the legacy pads an old save keeps until a
hub joins them.

- The excavator leaves its pad by its door and drives only on road cells.
- It unloads at its consumer's **stand**: an open road cell beside the
  consumer's footprint (the door first), one a digger, nose a pace short of
  the wall.
- **Dig at…** plans a **haul road** from the network to the dig spot (the
  spot snaps to its cell's centre; a spot on a road is refused: `ON A ROAD —
  pick open ground beside it; the haul road will end there`). Free rovers
  build it; until then the excavator keeps digging its own pad. The Builder's
  planned digs (Site Survey AI, Feed Planner) lay theirs the same way.
- Trip time in the sim is the road route's length over
  `haul speed × road tier` (× the beacons' night bonus after dark), plus
  any off-road leg inside an extraction zone at half that (§5a). The
  visuals follow the same route, so they stay in step.
- **It never waits on the road.** Short of room in the store, it waits at
  its dig spot with a full bucket — its pad, or its haul road's end — and
  sets off when there is room. One that finds no room at the stand turns
  back to wait there. (It used to wait at the consumer's door: at the
  Lander, before any smelter, that held the apron and kept the parked
  rovers in.)

## 5a. Extraction zones

The deposit areas the player sees are **extraction zones**
(`core/zones.ts`): every revealed deposit but a peak of light, its circle
the ring the [I] overlay draws. A cell is in a zone when its centre is.

| Rule | How |
|---|---|
| Auto roads stop at the rim | door spurs, haul roads and the Builder's roads never run inside a zone. For a structure or a dig inside one, the A\* ends at a **gate**: a free cell on the rim, the one nearest the network by road cost (the off-road distance on counts 0.9 a cell, a tie-breaker; a new road cell costs 1) |
| The road tool may | the player can still draw a road inside a zone |
| Off-road inside | excavators and rovers drive straight over the regolith between a gate and their work in that zone, at `ROAD.offroad` (0.5) of road speed; nowhere else |
| Timing | a trip or haul leg is road metres / road speed + off-road metres / (road speed × 0.5) |
| Construction | a structure inside a zone gets its spur to the gate; its rovers then drive off-road to its door (a field structure's wall nearest the gate) and weld from there, side by side. Its door needs no road |
| Fields | the same: an array inside a zone is served by the zone's gate |
| Docks | refused inside a zone (`IN AN EXTRACTION ZONE — a dock parks its rovers on the road; …`): a Robotics Bay's or Drone Hive's rovers park in bays, on the road. A dock with no room for a single bay beside its door (a zone's ring there, a structure, its own road along its front) is refused too: `NO ROOM FOR ITS PARKING BAYS — …; R rotates` |
| Traffic | zone cells are traffic ground: the same holds keep units apart inside, and they queue at the gate |
| The Builder | a pad inside a zone costs 1 m of score per metre of off-road drive from the gate, on top of its road |
| The ghost | `ROAD 3 cells · 6 rover-s to sinter, before it rises · to its zone's rim, then 12 m off-road` |
| Gates | a striped line across the gate's edge facing into the zone |

- A building on unmapped ground maps its deposit first, then plans its
  road, so the rule holds for a strike too. The ghost of such a spot shows
  a road into the unmapped ground (unmapped ground says nothing). If the zone
  it maps would refuse the road the placement approved (a dock's parking
  bays on the ring), that road is laid with the new zone set aside, as a
  save's migration does: a site with no road would wait for its rover forever.
- **Old saves keep their roads** inside zones: removing them could strand
  a structure, and they do no harm. A save from before roads gets its
  spurs laid to every door as before, zones aside.

## 5b. Relay masts off-road

A Relay Mast gets no road (`OFFROAD_TYPES` in `data/roads.ts`,
`mastStand` in `core/roads.ts`): not from placement, the Builder, or a
save's migration.

| Rule | How |
|---|---|
| Its gate | the open road cell nearest it: never a bay, the closed apron or another structure's door. With no road yet, the Lander apron's stub end |
| Its stand | the clear cell beside it that gate reaches straightest (a footprint, a bay or the closed apron is not clear). The pair is the shortest leg whose straight line crosses no footprint (else the shortest) |
| The drive | the road to the gate, then off-road straight to the stand at `ROAD.offroad` (0.5) of road speed; the trip's time counts the off-road metres ×2 |
| Construction | its rovers weld from the stand, side by side, as at a zone's door |
| Refusals | never `NO ROAD ROUTE`: slope, footprint and the network still apply. Every cell round it taken: `NO ROOM BESIDE IT — its rover works it from a free cell beside it` |
| The ghost | the off-road metres from the gate (`offM`) |
| Upkeep, a replacement | the same off-road trip (a worn mast replaced by Maintenance is a new site) |
| Inside a zone | with a gate, the zone's way on (§5a); without one, its own gate as above |
| Old saves | their roads to masts stay; a mast site with an unfinished spur still has its rover sinter it first |

The gate and stand are memoised on the network: a road opening nearer a
mast moves its gate. A unit stopped on the way out (a flat pack) sets off
again from the nearest road cell.

## 6. Traffic on the lanes

Visual only: the sim never waits on traffic. The visuals follow the sim
(§6a), and the traffic is the local adjustment. Every rule is cell-keyed (no
pair tests), in a fixed order, with no randomness.

| Rule | How |
|---|---|
| Two lanes | a rover drives 1 m right of the road's centre line; leaving a cell where another stands, it keeps to its half |
| Holds | a unit holds every road cell its body covers, plus its braking distance, whole or in one half |
| Sharing a cell | two rovers in opposite halves, standing or passing — never two driving the same way (nobody overtakes) or two turning on the spot |
| Wide loads | an excavator (3.8 m wide) holds cells whole, and every cell its box overhangs on a corner |
| Excavator gates | before an excavator enters a junction (or comes onto the road) it takes the whole run to the next junction, or to its way's end, at once; anyone in it, and it waits short of the junction |
| Queues | a unit that cannot take the next cell stops 0.25 m short of it; short of a junction, if it is not in it yet |
| Turning on the spot | a rover whose way sets off more than 1 rad from its heading turns on the spot first, and squares up along its road at its slot the same way; it holds its own half (a turn there stays clear of a rover in the other half). A turn needs every road cell its body sweeps, but one standing still in such a cell does not stop it if its body is 0.1 m clear of the turn's circle (an excavator's turn at a corner reaches into the diagonal cells, where rovers may stand parked) |
| Parking | bays, nose in, two a bay cell, each rover its own slot by its place in its dock's roster — so one leaving moves nobody; it backs out into the opening, and comes in by it |
| Right of way | loaded excavator > empty excavator > rover; then the lower id |
| Corners | a rover's corners where its way leaves the lane (a diagonal, a turn) claim the cells they reach, and an exact check keeps any two bodies 0.1 m apart under the cell holds |
| Deadlock breaker | a wait cycle held 1 s: its lowest unit gives way — a rover over into the other half of its cell if the others' ways keep to this half, else back (reversing, if it lies behind) to the nearest free cell off their ways, through free cells only, and out of a cell it shares in its own half; an excavator back along its way until it is clear. A unit standing in another's way 3 s steps aside, **with every standing unit in the cells just ahead** (two parked in one bay cell otherwise take turns). Nothing for 8 s: the lowest is set down — a rover where the sim has it (else inside its dock), an excavator where the sim has it, if that ground is clear |
| Detours | a unit held up 2 s by one that is not moving takes another road to its slot if the network has one, no more than 3 × the way it had left (+40 m); a rover that must turn first backs up to its cell's centre. The player's side roads work as a detour. A unit giving way keeps to its refuge until its time there is up: no detour back to its slot |
| Catching up | an excavator's visual drives up to 1.6 × haul speed to close on the sim; held up more than 12 s of driving, it is set down where the sim has it, if that ground is clear. A rover's: §6a. A unit set down holds the half of the cell it stands in, not its slot's |

On the crowded base of `avoidance.spec` (8 rovers, 2 excavators, 5 sites,
600 s at 10×; one Robotics Bay's parking cell diagonal to an excavator's
corner): closest pair 0.09–0.10 m (the box check's lower bound), 57–59
wait cycles broken, no detour needed, no last-resort rescue, 6–7 rovers
set down, no overlap, nobody off the ground, everyone home at the end, on
eight runs in each style. (Without the turn and refuge rules above, the
excavator's turn at that corner sent both parked rovers out of their bay on
every pass, and one's refuge crossed the other's half, so neither got
home.)

## 6a. Rovers in transit

Construction waits for its rover to get there (`core/transit.ts`). Every
unit has a place in the sim: its slot at its dock, at a site or behind a
road's frontier (`core/spots.ts`, the visuals' slots too), or a point on the
way between.

| | Rule |
|---|---|
| A trip | a new goal (an assignment, Send, Summon, a survey loan, the frontier's next cell, a new slot, home) plans one trip from where the unit is now: the road route (`roadRoute`, cached on the network), off-road inside a zone; a drone straight |
| Speed | `ROVER.speed` 4.5 m/s (`data/roads.ts`) × the roadway tiers (× the beacons at night); a drone `DRONE.speed` 6 m/s |
| Time | L / v + v / a rest to rest (a = 3 m/s²; 2·√(L/a) when too short to reach v): the route ÷ cruise, plus a 1.5 s start-and-stop allowance. A speed change on the way waits for the next trip |
| The tick | step 0 advances every trip a second and counts arrivals; the tick's end plans new trips, which set off that second. No search per tick |
| Work | a site draws power and builds only with the units that have arrived; n^0.85 counts only them. A cell sinters only with one behind its frontier |
| Reassigned mid-trip | it replans from where it is |
| Who goes | an auto site, and Summon, take the unit soonest there by road from where it is now (a drone by the straight line), not the lowest id |
| Survey | the lent rover drives to the Lander and leaves by its door; it comes back there |
| Hazards | a unit held or bricked goes home (a drone sets down where it is) |
| Power | a unit drives on its trip's clock at the share of the tick its pack carries (docs/02, On-board power): 1 on the grid or a charged pack, 0 flat (it waits where it stands; a drone sets down), ¼ on an RPU's trickle alone. `trip.rate` carries the share to the visuals |
| Off-road | inside a zone (§5a), or out to a Relay Mast (§5b): the leg's metres count ×2 |
| Words | a site: `ROVER EN ROUTE — arrives in 0:24` (inspector, site tags, the Builder panel; `QUEUED — waiting for a free robot` with none assigned; `NO ROAD — …` when none reaches it). A rover: `EN ROUTE to Habitat Module #5 · 0:24`, `RETURNING to Lander #1 · 0:08`. The ghost: `ROVER 0:12 away — the nearest free one, by road` |

**Typical trips** at the base cruise (4.5 m/s), road length L:

| Trip | L | Time |
|---|---|---|
| a frontier step | 4 m | 2.3 s |
| Lander to a site next to the apron | 20 m | 5.9 s |
| to a site across a young base | 50 m | 12.6 s |
| across a grown base | 150 m | 34.8 s |
| the same, every roadway tier (×1.79; ×2.23 at night; Guideway Rails speeds excavators only) | 150 m | 21.3 s (18.3 s) |

**The visuals follow the sim.** Each visual rover's progress along its own
lane way is matched to the sim's along the route (real metres, with the tick
fraction added). It drives the sim's pace, chases up to 1.6 × cruise when
the traffic held it back, and never runs ahead of the sim. It is set down
where the sim has it (never onto another unit) when it trails more than 6 s
of driving on a trip, or when the sim has it at work and it is not at its
stand after a second (or after 6 s while it visibly drives up). Sim time the
visuals never showed (a debug advance, a load) sets every unit down where
the sim has it. A drone chases the sim's point on the straight line the same
way. The visual rover exposes `mode: 'weld' | 'sinter' | null` (what the sim
has it doing at its stand), read by the work animations.

**Tests** use `instantTravel(true)` where the drive is not the point: every
trip ends as it starts, and a new goal is reached in the tick that sets it
(the timing from before transit). The smoke spec sets it for all its tests,
as it opens roads as they are laid.

## 7. Research: the roadway ladder

The first tier is the start. Each tech is a speed multiplier on road travel
(rovers' drive and the sim's haul trips) with one side effect, at its era's
median cost, and changes how the roads look.

| Tech | Era · lane | Cost | Effect | Side effect | The roads |
|---|---|---|---|---|---|
| Sintered Roads | start | — | ×1 | — | pale sintered strips, dashed edges |
| **Basalt Paving** | E3 · ◆ | 150 | ×1.25 | road dust −50% | dark pavers, a pale centre line |
| **Guidance Beacons** | E5 · ◆ | 400 | ×1.1 | ×1.25 more at night | beacon posts light the edges |
| **Guideway Rails** | E6 · ◆ | 1000 | excavators ×1.3 | — | twin rails down the centre |
| **Maglev Freight Lines** | E7 · ◉ | 1100 | ×1.3 | no road dust | a glowing coil strip |

◆ MATERIALS has a free row in E3, E5 and E6; the last tier sits in ◉ ROBOTICS,
whose E7 has room, so no lane grows.

## 8. Saves

- `s.roadSchema = 1`. A save without it gets roads on load: the apron, then
  a spur for every structure in building order, all open, zones aside.
- `s.fleetSchema = 1`: each rover's `x`, `z` and `trip` (goal, kind, route,
  off-road weights, length, cruise, elapsed and total). A save without it
  settles each rover where its work is, arrived, so nothing waits on a drive
  after the load. A rover new to the fleet rolls out of its dock's door.
- `s.fleetSchema = 2`: packs (docs/02, On-board power) on every rover and
  excavator haul: `charge`, `pw`, `src`, `chg`, `flatT`, and `trip.rate`.
  A save from before starts every unit fully charged.
- An excavator's haul keeps `full` (waiting at its dig) and `w` (off-road
  weights).
- `s.zones` is rebuilt from the heightfield and the reveals on every load.

## 9. Looks and cost

- One merged, draped mesh for open cells, one for cells being sintered
  (outlined, filling as they open). Rebuilt on change only.
- Classic palette keys: `road`, `roadMark`.
- Beacon posts are one instanced mesh, lit at night from Guidance Beacons.
- Routes are cached per network version; spurs are planned on placement only.
